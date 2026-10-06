// server/index.mjs — Label Pro Max Local web server
// รัน: npm start  →  http://localhost:3000
import express from 'express';
import { readCustomerBackup,replaceCustomers } from './customer-transfer.mjs';
import { downloadGithubBackup } from './github-backup.mjs';
import multer from 'multer';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { APP_ID } from './paths.mjs';
import { createLocalBackup } from './local-backup.mjs';
import { renderLabelPdf, closeLabelBrowser } from './label-pdf.mjs';
import { acquireLock } from './process-lock.mjs';
import { listWindowsPrinters } from './windows-printers.mjs';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import {
  db, ROOT, DB_PATH, now,
  getSetting, setSetting,
} from './db.mjs';

const app = express();
const PORT = Number(process.env.PORT || 3000);
let APP_REVISION=null;
try{APP_REVISION=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:5000}).trim();}catch{}
const APP_VERSION = JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8')).version;
app.use(express.json({ limit: '1mb' }));
let clearing = false, importing = false, updating = false;
const clearTokens = new Map();
const customerRevision = () => createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM customers ORDER BY id').all())).digest('hex');
app.use('/api', (req, res, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return err(res, 403, 'คำสั่งต้องมาจากหน้า Label Pro Max Local บนเครื่องนี้');
    if ((clearing || updating) && ['/customers','/print','/import-excel','/sender','/settings','/update','/backup'].some((p) => req.path.startsWith(p))) return err(res, 409, 'ระบบกำลังจัดการข้อมูล กรุณารอสักครู่');
  }
  next();
});
const upload = multer({ dest: join(tmpdir(), 'labelpro-uploads'), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- helpers ----------
const ok = (res, data) => res.json({ ok: true, ...data });
const err = (res, code, message) => res.status(code).json({ ok: false, message });

// ---------- health ----------
app.get('/api/health', (_req, res) => {
  const worker = db.prepare('SELECT * FROM worker_state WHERE id=1').get();
  ok(res, { revision: APP_REVISION, project_root: ROOT, database_path: DB_PATH, app_id: APP_ID, version: APP_VERSION, pid: process.pid, time: now(), branch: getSetting('branch_name'), managed: !!process.send,
    worker: { ready: !!worker && Date.now() - Date.parse(worker.heartbeat) < 10000, driver: worker?.driver || null } });
});

// ---------- customers ----------
// ค้นหาหลัก = place_name (ชื่อย่อที่พนักงานจำ) รองด้วย attention_name/contact
app.get('/api/customers', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(
      `SELECT * FROM customers
       WHERE is_active = 1 AND (place_name LIKE ? OR attention_name LIKE ? OR contact LIKE ?)
       ORDER BY place_name, id`
    ).all(like, like, like);
  } else {
    rows = db.prepare(
      'SELECT * FROM customers WHERE is_active = 1 ORDER BY place_name, id'
    ).all();
  }
  ok(res, { customers: rows, total: db.prepare('SELECT COUNT(*) n FROM customers WHERE is_active=1').get().n });
});

app.get('/api/customers/favorites', (_req, res) => {
  ok(res, {customers: db.prepare('SELECT * FROM customers WHERE is_active=1 AND is_favorite=1 ORDER BY attention_name, place_name, id').all()});
});
app.put('/api/customers/:id/favorite', (req, res) => {
  if (typeof req.body?.favorite !== 'boolean') return err(res,400,'กรุณาระบุสถานะดาว');
  const result=db.prepare('UPDATE customers SET is_favorite=?, updated_at=? WHERE id=? AND is_active=1').run(Number(req.body.favorite),now(),req.params.id);
  if (!result.changes) return err(res,404,'ไม่พบลูกค้าที่ใช้งาน');
  ok(res, {});
});

app.post('/api/desktop/install', (_req, res) => {
  if(process.platform!=='win32') return err(res,400,'ทางลัดนี้ใช้สำหรับ Windows');
  execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(ROOT,'scripts','install-desktop.ps1')],{windowsHide:true,timeout:15000},(error)=>{
    if(error) return err(res,500,'ติดตั้งทางลัดไม่สำเร็จ: '+error.message);
    ok(res, {message:'สร้างทางลัดบน Desktop และตั้งให้ระบบเปิดเบื้องหลังเมื่อเข้า Windows แล้ว'});
  });
});

app.get('/api/customers/clear-info', (_req, res) => {
  for (const [key, value] of clearTokens) if (value.expires < Date.now()) clearTokens.delete(key);
  if (clearTokens.size >= 20) clearTokens.delete(clearTokens.keys().next().value);
  const token = randomUUID();
  const counts = db.prepare('SELECT COUNT(*) total, COALESCE(SUM(is_active=1),0) active FROM customers').get();
  clearTokens.set(token, { revision: customerRevision(), expires: Date.now() + 5 * 60 * 1000 });
  ok(res, { ...counts, token, pending: db.prepare("SELECT COUNT(*) n FROM print_jobs WHERE status IN ('queued','printing')").get().n });
});

app.post('/api/customers/clear', async (req, res) => {
  const approval = clearTokens.get(req.body?.token);
  if (req.body?.confirmation !== 'ล้างข้อมูล' || !approval || approval.expires < Date.now()) return err(res, 400, 'กรุณาเปิดคำเตือนและพิมพ์ ล้างข้อมูล เพื่อยืนยันอีกครั้ง');
  if (importing || db.prepare("SELECT 1 FROM print_jobs WHERE status IN ('queued','printing')").get()) return err(res, 409, 'กรุณารอการนำเข้าและจัดการงานที่ยังรอหรือกำลังพิมพ์ก่อนล้าง');
  if (approval.revision !== customerRevision()) return err(res, 409, 'ข้อมูลลูกค้าเปลี่ยนแล้ว กรุณาเปิดคำเตือนเพื่อตรวจจำนวนอีกครั้ง');
  clearing = true;
  clearTokens.delete(req.body.token);
  try {
    const backup = await createLocalBackup(db, undefined, 'before-clear');
    const deleted = db.transaction(() => {
      if (customerRevision() !== approval.revision) throw new Error('ข้อมูลลูกค้าเปลี่ยนระหว่างสำรอง กรุณาตรวจจำนวนและยืนยันใหม่');
      if (db.prepare("SELECT 1 FROM print_jobs WHERE status IN ('queued','printing')").get()) throw new Error('มีงานพิมพ์ใหม่ กรุณาจัดการคิวก่อนล้าง');
      // Historical snapshots are intentionally preserved. Detach links to removed customers.
      db.prepare('UPDATE print_jobs SET customer_id=NULL WHERE customer_id IS NOT NULL').run();
      const count = db.prepare('DELETE FROM customers').run().changes;
      db.prepare('INSERT INTO backup_log(started_at,finished_at,ok,message) VALUES(?,?,1,?)').run(now(),now(), 'สำรองก่อนล้างลูกค้า: ' + basename(backup));
      return count;
    }).immediate();
    ok(res, { deleted, backup: basename(backup) });
  } catch (error) { err(res, 500, 'ไม่ได้ล้างข้อมูล: ' + error.message); }
  finally { clearing = false; }
});

app.post('/api/customers', (req, res) => {
  if (importing) return err(res, 409, 'กำลังนำเข้าลูกค้า กรุณารอสักครู่');
  const { place_name, attention_name = '', address = '', contact = '' } = req.body || {};
  if (!place_name || !place_name.trim()) return err(res, 400, 'กรุณากรอกชื่อสถานที่');
  const r = db.prepare(
    'INSERT INTO customers (place_name, attention_name, address, contact) VALUES (?, ?, ?, ?)'
  ).run(place_name.trim(), attention_name.trim(), address.trim(), contact.trim());
  // สำรองลง git ทันทีเมื่อเพิ่มลูกค้าใหม่ (รันเบื้องหลัง ไม่บล็อก response)
  if (process.env.LABELPRO_AUTO_BACKUP !== '0') runDetached('backup.mjs');
  ok(res, { id: r.lastInsertRowid });
});

app.put('/api/customers/:id', (req, res) => {
  const { place_name, attention_name = '', address = '', contact = '' } = req.body || {};
  if (!place_name || !place_name.trim()) return err(res, 400, 'กรุณากรอกชื่อสถานที่');
  db.prepare(
    `UPDATE customers SET place_name = ?, attention_name = ?, address = ?, contact = ?,
     updated_at = ? WHERE id = ?`
  ).run(place_name.trim(), attention_name.trim(), address.trim(), contact.trim(), now(), req.params.id);
  ok(res, {});
});

// soft delete: ปิดใช้งาน ไม่ลบจริง (กู้คืนได้)
app.delete('/api/customers/:id', (req, res) => {
  db.prepare('UPDATE customers SET is_active = 0, updated_at = ? WHERE id = ?')
    .run(now(), req.params.id);
  ok(res, {});
});

// ---------- sender profile ----------
app.get('/api/sender', (_req, res) => {
  const row = db.prepare('SELECT * FROM sender_profile WHERE id = 1').get();
  ok(res, { sender: row });
});

app.put('/api/sender', (req, res) => {
  const { sender_name = '', sender_address = '', sender_phone = '', sender_address_extra = '' } = req.body || {};
  db.prepare('UPDATE sender_profile SET sender_name = ?, sender_address = ?, sender_phone = ?, sender_address_extra = ? WHERE id = 1')
    .run(sender_name.trim(), sender_address.trim(), sender_phone.trim(), sender_address_extra.trim());
  ok(res, {});
});

// ---------- print queue (non-blocking) ----------
// กดพิมพ์ = insert แถว status='queued' แล้วตอบกลับทันที
// print-worker (process แยกต่างหาก) จะมา claim แล้วพิมพ์เอง UI ไม่เคยรอเครื่องพิมพ์
app.post('/api/print', (req, res) => {
  const { customer_id = null, message = '', copies = 1, printed_by = '', snapshot = null } = req.body || {};
  const n = Math.min(20, Math.max(1, Math.floor(Number(copies) || 1)));

  let c = null;
  if (customer_id) {
    c = db.prepare('SELECT * FROM customers WHERE id = ? AND is_active = 1').get(customer_id);
    if (!c) return err(res, 404, 'ไม่พบลูกค้า');
  }
  const sender = db.prepare('SELECT * FROM sender_profile WHERE id = 1').get();
  // snapshot: ใช้พิมพ์ซ้ำจากงานเก่า (ไม่ต้องมี customer_id)
  const snap = snapshot || {};

  const r = db.prepare(
    `INSERT INTO print_jobs
     (customer_id, place_name, attention_name, address, contact,
      sender_name, sender_address, sender_phone, sender_address_extra,
      message, copies, printed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    customer_id,
    snap.place_name ?? c?.place_name ?? '',
    snap.attention_name ?? c?.attention_name ?? '',
    snap.address ?? c?.address ?? '',
    snap.contact ?? c?.contact ?? '',
    sender.sender_name, sender.sender_address, sender.sender_phone, sender.sender_address_extra,
    message, n, (printed_by || '').trim()
  );
  ok(res, { job_id: r.lastInsertRowid, status: 'queued' });
});

app.get('/api/queue', (_req, res) => {
  const rows = db.prepare(
    'SELECT * FROM print_jobs ORDER BY id DESC LIMIT 50'
  ).all();
  const stats = db.prepare(`SELECT
    COALESCE(SUM(status IN ('queued','printing')),0) waiting,
    COALESCE(SUM(status='failed'),0) failed,
    COALESCE(SUM(CASE WHEN status='done' THEN copies ELSE 0 END),0) done_copies_total,
    COALESCE(SUM(status='done' AND date(printed_at,'+7 hours')=date('now','+7 hours')),0) done_today
    FROM print_jobs`).get();
  const failed_ids = db.prepare("SELECT id FROM print_jobs WHERE status='failed' ORDER BY id").all().map(row=>row.id);
  const clearable_ids=db.prepare("SELECT id FROM print_jobs WHERE status IN ('failed','cancelled') ORDER BY id").all().map(row=>row.id);
  ok(res, { jobs: rows, stats, failed_ids, clearable_ids });
});

app.post('/api/queue/clear-failed', (req,res) => {
  if (req.body?.confirmation !== 'ล้างงานล้มเหลว') return err(res,400,'กรุณายืนยันล้างงานล้มเหลว');
  const ids=req.body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.some(id=>!Number.isSafeInteger(id)||id<1) || new Set(ids).size!==ids.length) return err(res,400,'กรุณาเลือกงานล้มเหลวหรือยกเลิกให้ถูกต้อง');
  if(clearing || updating) return err(res,409,'ระบบกำลังจัดการข้อมูล กรุณารอสักครู่');
  try {
    const deleted=db.transaction(()=>{
      const status=db.prepare('SELECT status FROM print_jobs WHERE id=?');
      if(ids.some(id=>!['failed','cancelled'].includes(status.get(id)?.status))) throw new Error('รายการเปลี่ยนแล้ว กรุณาเลือกงานล้มเหลวหรือยกเลิกอีกครั้ง');
      const remove=db.prepare("DELETE FROM print_jobs WHERE id=? AND status IN ('failed','cancelled')");
      return ids.reduce((count,id)=>count+remove.run(id).changes,0);
    }).immediate();
    ok(res,{deleted});
  } catch(error){err(res,409,error.message);}
});

app.get('/api/queue/:id/pdf', async (req, res) => {
  const job = db.prepare('SELECT * FROM print_jobs WHERE id=?').get(req.params.id);
  if (!job) return err(res, 404, 'ไม่พบงานพิมพ์');
  try {
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="label-${job.id}.pdf"`);
    res.send(await renderLabelPdf(job));
  } catch (error) { res.removeHeader('Content-Disposition'); res.removeHeader('Content-Type'); err(res, 500, error.message); }
});

// ยกเลิกงานที่ยังรอคิว (worker จะไม่ดึงงาน cancelled)
app.post('/api/queue/:id/cancel', (req, res) => {
  const r = db.prepare(
    "UPDATE print_jobs SET status = 'cancelled' WHERE id = ? AND status = 'queued'"
  ).run(req.params.id);
  if (r.changes === 0) return err(res, 409, 'ยกเลิกไม่ได้ — งานเริ่มพิมพ์ไปแล้ว');
  ok(res, {});
});

// ---------- blessings (คำอวยพรสุ่มหลังสั่งพิมพ์) ----------
// อ่าน blessings.json สดจาก disk ทุกครั้ง → git pull อัปเดตไฟล์แล้วเห็นผลทันที ไม่ต้อง restart
import { readFileSync } from 'node:fs';
const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
function bangkokDayName() {
  // วันตามเวลา Asia/Bangkok (ไม่ใช่เวลาของ server ตรง ๆ)
  const bkk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  return THAI_DAYS[bkk.getDay()];
}
app.get('/api/blessings', (_req, res) => {
  let blessings = ['ขอบคุณที่ใช้งานค่ะ'];
  try {
    const arr = JSON.parse(readFileSync(join(ROOT, 'blessings.json'), 'utf8'));
    if (Array.isArray(arr) && arr.length) blessings = arr;
  } catch { /* ใช้ค่าเริ่มต้น */ }
  const day = bangkokDayName();
  ok(res, { blessings, day, greeting: `สวัสดีวัน${day}` });
});

// ---------- settings ----------
app.get('/api/printers', async (_req,res) => {
  try { ok(res,{printers:await listWindowsPrinters()}); }
  catch(error){err(res,500,'ตรวจชื่อเครื่องพิมพ์ไม่ได้: '+error.message);}
});
const SETTING_KEYS = ['branch_name', 'backup_repo_url', 'printer_name'];
app.get('/api/settings', (_req, res) => {
  const s = {};
  for (const k of SETTING_KEYS) s[k] = getSetting(k);
  const last = db.prepare(
    'SELECT * FROM backup_log ORDER BY id DESC LIMIT 1'
  ).get();
  ok(res, { settings: s, last_backup: last || null });
});

app.put('/api/settings', (req, res) => {
  for (const k of SETTING_KEYS) {
    if (req.body && req.body[k] !== undefined) {
      setSetting(k, req.body[k]);
    }
  }
  ok(res, {});
});

// ---------- import Excel ----------
// อัปโหลด .xlsx (ชีต PrintLabel, 4 คอลัมน์) → รัน scripts/import-excel.mjs กับไฟล์นั้น
app.post('/api/import-excel', upload.single('file'), (req, res) => {
  if (!req.file) return err(res, 400, 'กรุณาแนบไฟล์ .xlsx');
  const tmp = req.file.path;
  if (importing || clearing || updating) { rm(tmp, { force: true }).catch(() => {}); return err(res, 409, 'กำลังจัดการข้อมูลอยู่ กรุณารอสักครู่'); }
  importing = true;
  execFile(
    process.execPath, [join(ROOT, 'scripts', 'import-excel.mjs'), tmp],
    { cwd: ROOT, timeout: 120_000, encoding: 'utf8', windowsHide: true, env: { ...process.env } },
    (error, stdout, stderr) => {
      importing = false;
      rm(tmp, { force: true }).catch(() => {});
      const out = (stdout || '') + (stderr || '');
      if (error) return err(res, 500, 'นำเข้าไม่สำเร็จ: ' + out.slice(0, 500));
      const m = out.match(/เพิ่ม (\d+) ราย, ข้าม (\d+) แถว/);
      ok(res, {
        added: m ? Number(m[1]) : null,
        skipped: m ? Number(m[2]) : null,
        log: out.trim().slice(0, 1000),
      });
    }
  );
});

// ---------- backup ----------
// สำรองลง git เกิดได้ 2 ทางเท่านั้น:
//   (1) เพิ่มลูกค้าใหม่สำเร็จ (POST /api/customers)
//   (2) กดปุ่ม "สำรองข้อมูลตอนนี้" (POST /api/backup)
// ไม่มีสำรองตามเวลาอัตโนมัติ — รันแบบ detached ไม่บล็อก request
function runDetached(script, args = []) {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', script), ...args], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    cwd: ROOT,
    env: { ...process.env },
  });
  child.on('error', (error) => console.error('[background]', error.message));
  child.unref();
}

app.post('/api/backup/export',async(_req,res)=>{
  try{
    const file=await createLocalBackup(db,undefined,'transfer');
    res.download(file,basename(file));
  }catch(error){err(res,500,'สร้างไฟล์สำรองไม่สำเร็จ: '+error.message);}
});
app.post('/api/customers/import-backup',upload.single('file'),async(req,res)=>{
  let ownsLock=false;
  try{
    if(req.body?.confirmation!=='นำเข้าลูกค้า')return err(res,400,'กรุณายืนยันการแทนรายชื่อลูกค้า');
    if(!req.file||!req.file.originalname.toLowerCase().endsWith('.db'))return err(res,400,'กรุณาเลือกไฟล์สำรอง .db');
    if(clearing||updating||importing||db.prepare("SELECT 1 FROM print_jobs WHERE status IN ('queued','printing')").get())return err(res,409,'กรุณารอการจัดการข้อมูลและคิวพิมพ์ก่อนนำเข้า');
    clearing=true;ownsLock=true;
    const rows=readCustomerBackup(req.file.path);
    const backup=await createLocalBackup(db,undefined,'before-import-customers');
    const imported=replaceCustomers(db,rows);
    ok(res,{imported,backup:basename(backup)});
  }catch(error){err(res,400,'ไม่ได้นำเข้าข้อมูล: '+error.message);}
  finally{if(ownsLock)clearing=false;if(req.file)await rm(req.file.path,{force:true}).catch(()=>{});}
});

let downloadingBackup=false;
app.post('/api/backup/download', async (_req,res)=>{
  if(downloadingBackup)return err(res,409,'กำลังดาวน์โหลด กรุณารอสักครู่');
  downloadingBackup=true;
  try{
    const file=await downloadGithubBackup(getSetting('backup_repo_url'));
    res.set('Content-Type','application/gzip');
    res.set('Content-Disposition',`attachment; filename="${file.name}"`);
    res.send(file.data);
  }catch(error){err(res,400,error.message);}
  finally{downloadingBackup=false;}
});

app.post('/api/backup', (_req, res) => {
  runDetached('backup.mjs');
  ok(res, { started: true });
});

// ---------- update from GitHub ----------
let updateResult = { running: false, ok: null, message: '' };
app.get('/api/update', (_req, res) => ok(res, updateResult));
app.post('/api/update', (_req, res) => {
  if (clearing || importing || db.prepare("SELECT 1 FROM print_jobs WHERE status IN ('queued','printing')").get()) return err(res,409,'กรุณารอการนำเข้าและจัดการคิวงานก่อนอัปเดต');
  if (!process.send) return err(res,409,'กรุณาเปิดด้วย start-label-pro-max-local.vbs เพื่อให้อัปเดตและเริ่มระบบใหม่ได้อัตโนมัติ');
  updating = true; updateResult = { running: true, ok: null, message: 'กำลังตรวจและดาวน์โหลดอัปเดต' };
  execFile(process.execPath, [join(ROOT,'scripts','update.mjs')], { cwd: ROOT, windowsHide:true, timeout:300000, env:{...process.env} }, (error,stdout,stderr) => {
    updating = false;
    updateResult = { running:false, ok:!error, message: String(stdout || stderr || error?.message || '').trim().slice(-1000) };
    const prepared = stdout?.match(/LABELPRO_UPDATE_READY=(.+)/);
    if (!error && prepared) {
      updating = true;
      updateResult.message = 'เตรียมอัปเดตแล้ว กำลังเริ่มระบบใหม่';
      updateResult.restarting=true;
      try{updateResult.target=JSON.parse(readFileSync(prepared[1].trim(),'utf8')).target;}catch{}
      setTimeout(() => process.send?.({type:'apply-update',manifest:prepared[1].trim()}),1000);
    }
  });
  ok(res, { started: true, note: 'กำลังอัปเดต ระบบจะเริ่มใหม่เมื่อสำเร็จ' });
});

app.post('/api/runtime/stop', (_req,res) => {
  if (!process.send) return err(res,409,'ระบบนี้เปิดด้วยวิธีเดิม กรุณาปิด process ที่เปิดไว้');
  ok(res,{stopping:true}); setTimeout(() => process.send?.({type:'stop'}),300);
});
app.post('/api/runtime/restart', (_req,res) => {
  if (updating || clearing || importing || db.prepare("SELECT 1 FROM print_jobs WHERE status='printing'").get()) return err(res,409,'กรุณารองานปัจจุบันก่อนเริ่มใหม่');
  if (!process.send) return err(res,409,'กรุณาเปิดด้วย start-label-pro-max-local.vbs');
  ok(res,{restarting:true}); setTimeout(() => process.send?.({type:'restart'}),300);
});

// ---------- static web UI (no build step — แก้ไฟล์แล้วรีเฟรชได้เลย) ----------
app.use(express.static(join(ROOT, 'web')));

const release = acquireLock(DB_PATH + '.server.lock');
process.on('exit', release);
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[labelpro] http://localhost:${PORT}`);
  process.send?.({type:'ready'});
});
server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? 'พอร์ตถูกใช้งานอยู่ กรุณาปิดระบบเดิมก่อนเปิด Label Pro Max Local' : error.message); release(); process.exit(1); });
async function stop() {
  server.close(async () => { await closeLabelBrowser(); db.close(); release(); process.exit(0); });
  server.closeIdleConnections();
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('message', (msg) => { if (msg?.type==='stop') stop(); });
app.use((error,_req,res,_next) => err(res,400,error.message || 'คำสั่งไม่ถูกต้อง'));
