// tests/smoke.mjs — smoke test สำหรับ CI (ไม่ต้อง start server)
// ทดสอบ: schema v2 → customers CRUD → ค้นหา → enqueue งานพิมพ์
// → worker claim งาน (mock) → import Excel ตัวอย่าง → backup --dry-run
// รัน: npm run smoke
import { mkdtempSync, rmSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
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
