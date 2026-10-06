// server/index.mjs — LabelPro Local web server
// รัน: npm start  →  http://localhost:3000
import express from 'express';
import multer from 'multer';
import { spawn, execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import {
  db, ROOT, now,
  getSetting, setSetting,
} from './db.mjs';

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.use(express.json({ limit: '1mb' }));
const upload = multer({ dest: join(tmpdir(), 'labelpro-uploads'), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- helpers ----------
const ok = (res, data) => res.json({ ok: true, ...data });
const err = (res, code, message) => res.status(code).json({ ok: false, message });

// ---------- health ----------
app.get('/api/health', (_req, res) => {
  ok(res, { time: now(), branch: getSetting('branch_name') });
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
       ORDER BY place_name LIMIT 200`
    ).all(like, like, like);
  } else {
    rows = db.prepare(
      'SELECT * FROM customers WHERE is_active = 1 ORDER BY place_name LIMIT 200'
    ).all();
  }
  ok(res, { customers: rows });
});

app.post('/api/customers', (req, res) => {
  const { place_name, attention_name = '', address = '', contact = '' } = req.body || {};
  if (!place_name || !place_name.trim()) return err(res, 400, 'กรุณากรอกชื่อสถานที่');
  const r = db.prepare(
    'INSERT INTO customers (place_name, attention_name, address, contact) VALUES (?, ?, ?, ?)'
  ).run(place_name.trim(), attention_name.trim(), address.trim(), contact.trim());
  // สำรองลง git ทันทีเมื่อเพิ่มลูกค้าใหม่ (รันเบื้องหลัง ไม่บล็อก response)
  runDetached('backup.mjs');
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
  const n = Math.min(20, Math.max(1, Number(copies) || 1));

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
  ok(res, { jobs: rows });
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

// ---------- รายการเครื่องพิมพ์ (Windows) ----------
// ดึงชื่อเครื่องพิมพ์จริงจาก Windows spooler ให้ user เลือกใน dropdown
// (กันพิมพ์ชื่อผิด — สาเหตุยอดฮิตของงาน failed)
// ตอบ: { printers: ["ชื่อ1", ...] } — normalize เป็น array ของ string เสมอ ไม่เคย throw
app.get('/api/printers', async (_req, res) => {
  if (process.platform !== 'win32') return ok(res, { printers: [] }); // dev บน Linux/macOS
  let getPrinters;
  try {
    // lazy import — pdf-to-printer เป็น optionalDependency เฉพาะ Windows, Linux ไม่โหลด
    const mod = await import('pdf-to-printer');
    getPrinters = mod.getPrinters || mod.default?.getPrinters;
    if (typeof getPrinters !== 'function') throw new Error('no getPrinters export');
  } catch {
    return ok(res, { printers: [], error: 'ยังไม่ติดตั้ง pdf-to-printer — รัน `npm install` บนเครื่อง Windows นี้ก่อน' });
  }
  try {
    const list = await getPrinters(); // [{ deviceId, name, paperSizes }]
    const names = [...new Set(
      (Array.isArray(list) ? list : [])
        .map((p) => String(p && p.name ? p.name : '').trim())
        .filter(Boolean)
    )];
    ok(res, { printers: names });
  } catch (e) {
    // หมายเหตุ: pdf-to-printer บางเวอร์ชัน throw เป็น string ("Operating System not supported") ไม่ใช่ Error
    ok(res, { printers: [], error: 'อ่านรายการเครื่องพิมพ์ไม่สำเร็จ: ' + String(e?.message || e) });
  }
});

// ---------- import Excel ----------
// อัปโหลด .xlsx (ชีต PrintLabel, 4 คอลัมน์) → รัน scripts/import-excel.mjs กับไฟล์นั้น
app.post('/api/import-excel', upload.single('file'), (req, res) => {
  if (!req.file) return err(res, 400, 'กรุณาแนบไฟล์ .xlsx');
  const tmp = req.file.path;
  execFile(
    process.execPath, [join(ROOT, 'scripts', 'import-excel.mjs'), tmp],
    { cwd: ROOT, timeout: 120_000, encoding: 'utf8', env: { ...process.env } },
    (error, stdout, stderr) => {
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
    stdio: 'ignore',
    cwd: ROOT,
    env: { ...process.env },
  });
  child.unref();
}

app.post('/api/backup', (_req, res) => {
  runDetached('backup.mjs');
  ok(res, { started: true });
});

// ---------- update from GitHub ----------
app.post('/api/update', (_req, res) => {
  runDetached('update.mjs');
  ok(res, { started: true, note: 'กำลัง git pull จาก GitHub เบื้องหลัง กรุณารอสักครู่แล้วรีเฟรช' });
});

// ---------- static web UI (no build step — แก้ไฟล์แล้วรีเฟรชได้เลย) ----------
app.use(express.static(join(ROOT, 'web')));

app.listen(PORT, () => {
  console.log(`[labelpro] http://localhost:${PORT}`);
  console.log('[labelpro] อย่าลืมรัน print worker อีก terminal: npm run worker');
});
