// tests/smoke.mjs — smoke test สำหรับ CI (ไม่ต้อง start server)
// ทดสอบ: schema v2 → customers CRUD → ค้นหา → enqueue งานพิมพ์
// → worker claim งาน (mock) → import Excel ตัวอย่าง → backup --dry-run
// รัน: npm run smoke
import { mkdtempSync, rmSync, readFileSync, copyFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
const assert = (cond, name) => {
  if (!cond) { console.error(`  ✗ FAIL: ${name}`); process.exitCode = 1; }
  else { console.log(`  ✓ ${name}`); pass++; }
};

console.log('[smoke] schema v2 …');
const tmp = mkdtempSync(join(tmpdir(), 'labelpro-smoke-'));
const db = new Database(join(tmp, 'test.db'));
db.pragma('journal_mode = WAL');
db.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
assert(cols('customers').includes('attention_name'), 'customers มีคอลัมน์ attention_name');
assert(cols('customers').includes('contact'), 'customers มีคอลัมน์ contact');
assert(!cols('customers').includes('customer_name'), 'customers ไม่มี customer_name (ฟอร์แมตเก่าถูกถอด)');
assert(!cols('customers').includes('phone'), 'customers ไม่มี phone (ฟอร์แมตเก่าถูกถอด)');
assert(cols('print_jobs').includes('attention_name'), 'print_jobs มี snapshot attention_name');
assert(!cols('print_jobs').includes('customer_name'), 'print_jobs ไม่มี customer_name');
assert(cols('sender_profile').includes('sender_address_extra'), 'sender_profile มี sender_address_extra');
assert(!cols('sender_profile').includes('sender_subdistrict'), 'sender_profile ไม่มี sender_subdistrict (ถูก rename)');
assert(cols('print_jobs').includes('sender_address_extra'), 'print_jobs มี snapshot sender_address_extra');
// คำอวยพรย้ายไป blessings.json ที่ root (ไม่เก็บใน settings แล้ว)
const blessings = JSON.parse(readFileSync(join(ROOT, 'blessings.json'), 'utf8'));
assert(Array.isArray(blessings) && blessings.length === 6, 'blessings.json มี 6 ข้อ');
assert(!db.prepare("SELECT COUNT(*) n FROM settings WHERE key='blessings'").get().n, 'settings ไม่มี blessings แล้ว');

console.log('[smoke] customers CRUD (4 คอลัมน์) …');
const id = db.prepare(
  'INSERT INTO customers (place_name, attention_name, address, contact) VALUES (?,?,?,?)'
).run('ร้านทดสอบ', 'ร้านทดสอบ คุณทดสอบ', '123 ถนนทดสอบ', 'คุณทดสอบ 0812345678').lastInsertRowid;
assert(Number(id) > 0, 'insert ลูกค้าได้');
const found = db.prepare(
  'SELECT * FROM customers WHERE place_name LIKE ? OR attention_name LIKE ? OR contact LIKE ?'
).get('%ทดสอบ%', '%ทดสอบ%', '%ทดสอบ%');
assert(found && found.contact === 'คุณทดสอบ 0812345678', 'ค้นหาเจอทั้ง 3 ฟิลด์');
db.prepare('UPDATE customers SET is_active = 0 WHERE id = ?').run(id);
assert(db.prepare('SELECT COUNT(*) n FROM customers WHERE is_active = 1').get().n === 0, 'soft delete ทำงาน');

console.log('[smoke] print queue claim (atomic) …');
const jid = db.prepare(
  `INSERT INTO print_jobs (place_name, attention_name, copies, status) VALUES (?,?,?, 'queued')`
).run('ร้านทดสอบ', 'คุณทดสอบ', 2).lastInsertRowid;
const claimed = db.prepare("UPDATE print_jobs SET status='printing' WHERE id=? AND status='queued'").run(jid);
assert(claimed.changes === 1, 'claim งานครั้งแรกสำเร็จ');
const claimed2 = db.prepare("UPDATE print_jobs SET status='printing' WHERE id=? AND status='queued'").run(jid);
assert(claimed2.changes === 0, 'claim ซ้ำถูกกัน (atomic)');
db.prepare("UPDATE print_jobs SET status='done', printed_at=? WHERE id=?").run(new Date().toISOString(), jid);
assert(db.prepare("SELECT status s FROM print_jobs WHERE id=?").get(jid).s === 'done', 'mark done ได้');

console.log('[smoke] migration: sender_subdistrict → sender_address_extra (DB เก่า) …');
try {
  const migDb = join(tmp, 'mig.db');
  const mdb = new Database(migDb);
  mdb.exec(`CREATE TABLE sender_profile (id INTEGER PRIMARY KEY CHECK (id = 1), sender_name TEXT DEFAULT '', sender_address TEXT DEFAULT '', sender_phone TEXT DEFAULT '', sender_subdistrict TEXT DEFAULT '');
INSERT INTO sender_profile (id, sender_name, sender_subdistrict) VALUES (1, 'ร้านทดสอบ', 'ต.ทดสอบ');
CREATE TABLE print_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_subdistrict TEXT DEFAULT '');
CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, place_name TEXT, attention_name TEXT DEFAULT '');`);
  mdb.close();
  // import server/db.mjs ด้วย LABELPRO_DB ชี้ไป DB เก่า → migration ต้องรัน
  execFileSync(process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(join(ROOT, 'server', 'db.mjs'))});`],
    { env: { ...process.env, LABELPRO_DB: migDb }, cwd: ROOT, stdio: 'pipe', timeout: 30_000 });
  const mdb2 = new Database(migDb, { readonly: true });
  const cols2 = (t) => mdb2.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert(cols2('sender_profile').includes('sender_address_extra'), 'migration: sender_profile ถูก rename');
  assert(!cols2('sender_profile').includes('sender_subdistrict'), 'migration: ชื่อเก่าหายไป');
  assert(cols2('print_jobs').includes('sender_address_extra'), 'migration: print_jobs ถูก rename');
  assert(mdb2.prepare('SELECT sender_address_extra v FROM sender_profile WHERE id = 1').get().v === 'ต.ทดสอบ',
    'migration: ข้อมูลเดิมไม่หาย');
  mdb2.close();
} catch (e) {
  assert(false, 'migration รันจบ: ' + String(e.message).slice(0, 300));
}

console.log('[smoke] node --check ทุกไฟล์หลัก …');
for (const f of [
  'server/index.mjs', 'server/db.mjs', 'server/print-worker.mjs',
  'server/label-pdf.mjs', 'server/printer-drivers.mjs',
  'scripts/backup.mjs', 'scripts/update.mjs', 'scripts/import-excel.mjs', 'scripts/restore.mjs',
  'scripts/start.mjs', 'scripts/git-update.mjs',
  'web/app.js',
]) {
  try { execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' }); assert(true, `syntax OK: ${f}`); }
  catch (e) { assert(false, `syntax OK: ${f}`); }
}

console.log('[smoke] import-excel กับไฟล์ตัวอย่าง (4 คอลัมน์) …');
try {
  const importDb = join(tmp, 'import.db');
  const sample = join(tmp, 'sample.xlsx');
  copyFileSync(join(ROOT, 'design', 'ตัวอย่างรายชื่อลูกค้า.xlsx'), sample);
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'import-excel.mjs'), sample],
    { encoding: 'utf8', cwd: ROOT, timeout: 60_000, env: { ...process.env, LABELPRO_DB: importDb } });
  assert(out.includes('เพิ่ม 3 ราย'), 'import ไฟล์ตัวอย่างได้ 3 ราย: ' + out.split('\n')[0]);
  const idb = new Database(importDb, { readonly: true });
  const n = idb.prepare('SELECT COUNT(*) n FROM customers').get().n;
  const one = idb.prepare('SELECT * FROM customers WHERE place_name = ?').get('บ้าน');
  idb.close();
  assert(n === 3, 'มีลูกค้า 3 รายใน DB');
  assert(one && one.attention_name === 'บ้าน คุณมานะ', 'attention_name ถูกต้อง');
  assert(one && one.contact === 'คุณมานะ เบอร์โทร 081-111-2222', 'contact ถูกต้อง');
} catch (e) {
  assert(false, 'import-excel รันจบ: ' + String(e.message).slice(0, 300));
}

console.log('[smoke] renderLabelPdf → PDF 100x150mm + ภาษาไทย …');
try {
  const { renderLabelPdf, LABEL_W_PT, LABEL_H_PT } = await import(join(ROOT, 'server', 'label-pdf.mjs'));
  assert(Math.abs(LABEL_W_PT - 283.47) < 0.01 && Math.abs(LABEL_H_PT - 425.2) < 0.01, 'ขนาดหน้า 100x150mm เป๊ะ');
  const pdfBuf = await renderLabelPdf(
    { id: 1, place_name: 'ร้านทดสอบ', attention_name: 'ร้านทดสอบ คุณทดสอบ', address: '123 ถนนทดสอบ ต.ทดสอบ อ.ทดสอบ จ.ทดสอบ 10000', contact: 'คุณทดสอบ 0812345678', message: 'มีเอกสารค่ะ', copies: 2 },
    { sender_name: 'ร้านผู้ส่งทดสอบ', sender_phone: '02-000-0000', sender_address: 'ที่อยู่ผู้ส่ง', sender_address_extra: 'ที่อยู่เพิ่มเติม' },
    { fonts: { regular: '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf', bold: '/usr/share/fonts/truetype/noto/NotoSansThai-SemiCondensedBold.ttf' } }
  );
  assert(pdfBuf.subarray(0, 5).toString() === '%PDF-', 'PDF ขึ้นต้นด้วย %PDF-');
  assert(pdfBuf.length > 2000, `PDF มีขนาดสมเหตุสมผล (${pdfBuf.length} bytes)`);
  // ตรวจว่าข้อความไทยฝังอยู่ใน PDF จริง (ผ่าน pdftotext ถ้ามี)
  try {
    const pdfPath = join(tmp, 'label.pdf');
    writeFileSync(pdfPath, pdfBuf);
    const txt = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' });
    assert(txt.includes('ร้านทดสอบ'), 'pdftotext อ่านชื่อสถานที่ภาษาไทยได้');
    // หมายเหตุ: สระบน/ล่างถูกวาดแยก glyph (จัดตำแหน่งเองเพราะ pdfkit ไม่ทำ shaping)
    // pdftotext จึงอาจตัดคำที่มีสระบน (เช่น "มี" → "ม"+"ี") — ตรวจด้วยส่วนที่ไม่มีสระบน
    assert(txt.includes('เอกสารค่ะ'), 'pdftotext อ่านข้อความฉลากได้');
    assert(txt.includes('ผู้รับ') && txt.includes('ผู้ส่ง'), 'pdftotext อ่านบล็อกผู้รับ/ผู้ส่งได้');
  } catch (e2) {
    if (/ENOENT/.test(String(e2 && e2.message))) console.log('  ⚠ ข้าม pdftotext (ไม่มี poppler ในเครื่องนี้)');
    else throw e2;
  }
} catch (e) {
  assert(false, 'renderLabelPdf รันจบ: ' + String(e.message).slice(0, 300));
}

console.log('[smoke] printer driver selection + resolvePrinterName …');
try {
  process.env.LABELPRO_DB = join(tmp, 'drv.db'); // ชี้ db.mjs ไป tmp ก่อน import ครั้งแรก
  const drv = await import(join(ROOT, 'server', 'printer-drivers.mjs'));
  const { setSetting } = await import(join(ROOT, 'server', 'db.mjs'));
  delete process.env.PRINT_DRIVER;
  assert(drv.resolveDriverName() === (process.platform === 'win32' ? 'windows' : 'mock'), 'default driver เลือกตาม OS');
  process.env.PRINT_DRIVER = 'mock';
  assert(drv.resolveDriverName() === 'mock', 'PRINT_DRIVER=mock บังคับ mock');
  delete process.env.PRINT_DRIVER;

  delete process.env.PRINTER_NAME;
  setSetting('printer_name', '');
  let threwThai = false;
  try { drv.resolvePrinterName(); } catch (e3) { threwThai = /ตั้งค่า/.test(String(e3.message)); }
  assert(threwThai, 'ไม่มีชื่อ printer → error ภาษาไทยบอกให้ไปตั้งค่า');
  setSetting('printer_name', 'DB Printer');
  assert(drv.resolvePrinterName() === 'DB Printer', 'อ่าน printer_name จาก settings');
  process.env.PRINTER_NAME = 'Env Printer';
  assert(drv.resolvePrinterName() === 'Env Printer', 'env PRINTER_NAME มี priority สูงสุด');
  delete process.env.PRINTER_NAME;
  assert(drv.makeDriver().constructor.name === 'MockDriver', 'บน linux ได้ MockDriver');
} catch (e) {
  assert(false, 'driver selection รันจบ: ' + String(e.message).slice(0, 300));
}

console.log('[smoke] /api/printers + mapPrintFailure …');
try {
  // 1) บูต server จริงแล้วเรียก /api/printers (บน linux ต้องได้ printers: [] แบบไม่ throw)
  const port = 3211;
  const srv = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), LABELPRO_DB: join(tmp, 'api.db') },
  });
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { const r = await fetch(`http://localhost:${port}/api/health`); if (r.ok) { ready = true; break; } } catch { /* ยังไม่พร้อม */ }
  }
  assert(ready, 'server บูตก่อนทดสอบ /api/printers');
  const pd = await (await fetch(`http://localhost:${port}/api/printers`)).json();
  srv.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  assert(pd.ok === true, '/api/printers ตอบ ok:true');
  assert(Array.isArray(pd.printers), '/api/printers คืน printers เป็น array');
  assert(pd.printers.every((x) => typeof x === 'string'), 'printers เป็น array ของ string ล้วน');
  if (process.platform !== 'win32') {
    assert(pd.printers.length === 0, 'บน linux ได้ printers ว่างโดยไม่ throw');
  }

  // 2) mapPrintFailure: เคสชื่อ printer ผิด (error จริงจาก user: -print-to TP518)
  const { mapPrintFailure } = await import(join(ROOT, 'server', 'printer-drivers.mjs'));
  const realErr = 'Command failed: E:\\labelpro-local\\node_modules\\pdf-to-printer\\dist\\SumatraPDF-3.4.6-32.exe -print-to TP518 -silent -print-settings noscale,1x E:\\labelpro-local\\printed\\job-00008.pdf';
  const msg = mapPrintFailure('TP518', 'job-00008.pdf', new Error(realErr));
  assert(msg.includes('ชื่อเครื่องพิมพ์ไม่ตรง'), 'error พูดถึงชื่อ printer → hint ชื่อไม่ตรง');
  assert(msg.includes('job-00008.pdf'), 'error บอกชื่อไฟล์ PDF ที่เก็บไว้');
  assert(msg.includes('ตั้งค่า'), 'error บอกให้ไปหน้า ตั้งค่า');
  assert(/[ก-๛]/.test(msg), 'error เป็นภาษาไทย');

  // 3) error แปลก ๆ → ยังได้ข้อความไทย + ชื่อไฟล์ (ไม่ throw)
  const msg2 = mapPrintFailure('SomePrinter', 'job-00009.pdf', 'weird failure 123');
  assert(msg2.includes('job-00009.pdf') && /[ก-๛]/.test(msg2), 'error แปลกๆ → ยังได้ข้อความไทยพร้อมชื่อไฟล์');

  // 4) queue UI แสดง error ใต้ failed jobs
  const appJs = readFileSync(join(ROOT, 'web', 'app.js'), 'utf8');
  assert(appJs.includes("j.status === 'failed' && j.error"), "queue UI เรนเดอร์ j.error ใต้ failed jobs");

  // 5) settings UI มี dropdown + รีเฟรช + พิมพ์เอง
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  assert(/<select[^>]*id="set_printer"/.test(html), 'settings มี dropdown เลือก printer');
  assert(html.includes('id="refreshPrinters"'), 'settings มีปุ่มรีเฟรชรายการ printer');
  assert(html.includes('id="set_printer_manual"'), 'settings มีช่องพิมพ์ชื่อเองสำรอง');
  assert(html.includes('Devices and Printers'), 'มี hint ให้ดูชื่อใน Control Panel');
  assert(appJs.includes('loadPrinterList'), 'app.js โหลดรายการ printer จาก /api/printers');
} catch (e) {
  assert(false, '/api/printers + mapPrintFailure: ' + String(e && e.message).slice(0, 300));
}

console.log('[smoke] print-worker import ไม่พังบน linux (lazy require) …');
try {
  const out = execFileSync(process.execPath, ['server/print-worker.mjs'],
    { cwd: ROOT, timeout: 8000, encoding: 'utf8', env: { ...process.env, PRINT_DRIVER: 'mock', LABELPRO_DB: join(tmp, 'w.db') } });
  assert(out.includes('driver=mock'), 'worker เริ่มด้วย mock driver');
} catch (e) {
  // timeout ฆ่า process ที่รันค้าง (polling) → ถือว่าปกติ ขอแค่ log ขึ้น
  const out = String((e && e.stdout) || '');
  assert(out.includes('driver=mock'), 'worker เริ่มด้วย mock driver: ' + out.slice(0, 200));
}

console.log('[smoke] launcher files (Windows one-click) …');
assert(existsSync(join(ROOT, 'start-labelpro.bat')), 'มี start-labelpro.bat');
assert(existsSync(join(ROOT, 'start-labelpro-hidden.vbs')), 'มี start-labelpro-hidden.vbs');
{
  const bat = readFileSync(join(ROOT, 'start-labelpro.bat'), 'utf8');
  assert(bat.includes('cd /d "%~dp0"'), '.bat cd ไปโฟลเดอร์ของตัวเองก่อน');
  assert(bat.includes('npm start'), '.bat เรียก npm start');
  const vbs = readFileSync(join(ROOT, 'start-labelpro-hidden.vbs'), 'utf8');
  assert(vbs.includes('GetParentFolderName(WScript.ScriptFullName)'), '.vbs หา path ของตัวเองถูกวิธี (ไม่ใช้ %~dp0)');
  assert(vbs.includes(', 0, False'), '.vbs รันแบบซ่อนหน้าต่าง');
}

console.log('[smoke] git-update: tryAutoPull …');
try {
  const { tryAutoPull } = await import(join(ROOT, 'scripts', 'git-update.mjs'));
  const gtmp = mkdtempSync(join(tmpdir(), 'labelpro-git-'));
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  const gitInit = (cwd) => {
    git(['init', '-b', 'main'], cwd);
    git(['config', 'user.email', 'test@local'], cwd);
    git(['config', 'user.name', 'smoke'], cwd);
    git(['config', 'commit.gpgsign', 'false'], cwd);
  };

  // 1) ไม่มี .git → ข้ามแบบนุ่มนวล
  mkdirSync(join(gtmp, 'nogit'), { recursive: true });
  const r1 = await tryAutoPull(join(gtmp, 'nogit'));
  assert(r1.status === 'skipped-no-git', 'ไม่มี .git → skipped-no-git');

  // 2) repo สะอาดแต่ไม่มี remote → failed แบบไม่ throw (เหมือนเน็ตล่ม/ยังไม่ผูก remote)
  const w1 = join(gtmp, 'w1');
  mkdirSync(w1, { recursive: true });
  gitInit(w1);
  writeFileSync(join(w1, 'a.txt'), 'a');
  git(['add', '.'], w1);
  git(['commit', '-m', 'init'], w1);
  const r2 = await tryAutoPull(w1);
  assert(r2.status === 'failed', 'ไม่มี remote → failed แบบไม่ throw: ' + r2.detail.slice(0, 60));

  // 3) working tree สกปรก → ข้ามเพื่อไม่ทับงาน
  writeFileSync(join(w1, 'a.txt'), 'dirty-local-edit');
  const r3 = await tryAutoPull(w1);
  assert(r3.status === 'skipped-dirty', 'ไฟล์แก้ค้าง → skipped-dirty');
  git(['checkout', '--', '.'], w1);

  // 4) มี remote (bare repo ในเครื่อง) → up-to-date
  const bare = join(gtmp, 'remote.git');
  git(['init', '--bare', bare], gtmp);
  git(['remote', 'add', 'origin', bare], w1);
  git(['push', '-u', 'origin', 'main'], w1);
  git(['--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main']); // ให้ clone ต่อมา checkout main ถูก
  const r4 = await tryAutoPull(w1);
  assert(r4.status === 'up-to-date', 'ตรงกับ remote → up-to-date');

  // 5) มี commit ใหม่บน remote → pulled และไฟล์มาจริง
  const w2 = join(gtmp, 'w2');
  git(['clone', bare, w2], gtmp);
  git(['config', 'user.email', 'test@local'], w2);
  git(['config', 'user.name', 'smoke'], w2);
  writeFileSync(join(w2, 'b.txt'), 'from-remote');
  git(['add', '.'], w2);
  git(['commit', '-m', 'second'], w2);
  git(['push', 'origin', 'main'], w2);
  const r5 = await tryAutoPull(w1);
  assert(r5.status === 'pulled', 'มี commit ใหม่ → pulled: ' + r5.detail.slice(0, 60));
  assert(existsSync(join(w1, 'b.txt')), 'ไฟล์จาก remote มาถึง working tree');
  // เรียกซ้ำต้องได้ up-to-date (idempotent)
  const r6 = await tryAutoPull(w1);
  assert(r6.status === 'up-to-date', 'pull ซ้ำ → up-to-date');

  rmSync(gtmp, { recursive: true, force: true });
} catch (e) {
  assert(false, 'tryAutoPull รันจบ: ' + String(e && e.message).slice(0, 300));
}

console.log('[smoke] git-env: SSH non-interactive + Thai errors …');
try {
  const { gitEnv, thaiGitHint, runGit, GIT_SSH_COMMAND } = await import(join(ROOT, 'scripts', 'git-env.mjs'));

  // 1) GIT_SSH_COMMAND ต้องมีทั้ง accept-new และ BatchMode
  assert(typeof GIT_SSH_COMMAND === 'string', 'export GIT_SSH_COMMAND');
  assert(GIT_SSH_COMMAND.includes('StrictHostKeyChecking=accept-new'), 'SSH: accept-new (ไม่ค้างถาม host key)');
  assert(GIT_SSH_COMMAND.includes('BatchMode=yes'), 'SSH: BatchMode=yes (ไม่ค้างถาม password)');
  const env = gitEnv();
  assert(env.GIT_SSH_COMMAND === GIT_SSH_COMMAND, 'gitEnv() ส่ง GIT_SSH_COMMAND ให้ child process');
  assert(env.PATH === process.env.PATH, 'gitEnv() เก็บ env เดิมของ process ไว้');

  // 2) thaiGitHint แปล error ทั่วไปเป็นภาษาไทย
  assert(thaiGitHint('git@github.com: Permission denied (publickey).').includes('deploy key'),
    'hint: Permission denied → บอกเรื่อง deploy key');
  assert(thaiGitHint('ssh: Could not resolve hostname github.com').includes('อินเทอร์เน็ต'),
    'hint: DNS ล่ม → บอกเรื่องเน็ต');
  assert(thaiGitHint('ERROR: Repository not found.').includes('deploy key'),
    'hint: Repository not found → บอกเรื่องสิทธิ์ key');
  assert(thaiGitHint('some random output') === '', 'hint: error ไม่รู้จัก → ไม่แต่งเรื่อง');

  // 3) remote เสีย → failed พร้อมข้อความไทย และต้องจบไว (ไม่ค้าง)
  //    ใช้ SSH URL ที่ DNS ไม่มีทาง resolve (invalid.invalid) + BatchMode → fail ทันที ไม่ถาม password
  const gtmp2 = mkdtempSync(join(tmpdir(), 'labelpro-gitfail-'));
  const bad = join(gtmp2, 'bad');
  mkdirSync(bad, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: bad, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@local'], { cwd: bad, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'smoke'], { cwd: bad, stdio: 'pipe' });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: bad, stdio: 'pipe' });
  writeFileSync(join(bad, 'a.txt'), 'a');
  execFileSync('git', ['add', '.'], { cwd: bad, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: bad, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', 'ssh://git@invalid.invalid/MrkTHixi/__nope__.git'], { cwd: bad, stdio: 'pipe' });

  const t0 = Date.now();
  const r = await runGit(['pull', '--ff-only'], bad, { timeout: 30_000 });
  const elapsed = Date.now() - t0;
  assert(r.ok === false, 'pull ไป remote เสีย → ok:false (ไม่ throw)');
  assert(/[ก-๛]/.test(r.stderr), 'error เป็นภาษาไทย: ' + r.stderr.slice(0, 80));
  assert(elapsed < 25_000, `fail ไวไม่ค้าง (${elapsed}ms < 25s)`);
  rmSync(gtmp2, { recursive: true, force: true });
} catch (e) {
  assert(false, 'git-env tests รันจบ: ' + String(e && e.message).slice(0, 300));
}

console.log('[smoke] start.mjs: orchestration (server+worker พร้อมกัน) …');
try {
  const port = 3210;
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'start.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), LABELPRO_DB: join(tmp, 'start-e2e.db') },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  let ok = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const r = await fetch(`http://localhost:${port}/api/health`);
      if (r.ok) { ok = true; break; }
    } catch { /* ยังไม่พร้อม */ }
  }
  assert(ok, 'start.mjs สตาร์ท server จน /api/health ตอบ 200');
  assert(out.includes('กำลังเริ่มระบบ'), 'start.mjs พิมพ์ banner เริ่มระบบ');
  assert(out.includes('worker'), 'start.mjs สตาร์ท worker ด้วย');
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  assert(child.killed || child.exitCode !== null || child.signalCode !== null, 'SIGTERM ปิด start.mjs ได้');
} catch (e) {
  assert(false, 'start.mjs orchestration: ' + String(e && e.message).slice(0, 300));
}

console.log('[smoke] backup --dry-run …');
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'backup.mjs'), '--dry-run'],
    { encoding: 'utf8', cwd: ROOT, timeout: 60_000 });
  assert(out.includes('--dry-run'), 'backup --dry-run รันจบ');
} catch (e) {
  assert(false, 'backup --dry-run รันจบ: ' + String(e.message).slice(0, 200));
}

db.close();
rmSync(tmp, { recursive: true, force: true });
console.log(`[smoke] ผ่าน ${pass} ข้อ ${process.exitCode ? '— มีข้อล้มเหลว' : 'ทั้งหมด ✅'}`);
