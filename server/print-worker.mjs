// server/print-worker.mjs — Print Worker (process แยกจาก web server)
// รัน: npm run worker
//
// หน้าที่: ทุก 3 วินาที ดึงงาน status='queued' มาทีละ 1 งานแบบ atomic
// (UPDATE ... WHERE status='queued' → กัน worker ซ้อนกันดึงงานเดียวกัน)
// แล้ว "พิมพ์" ผ่าน PrinterDriver ที่เลือก แล้ว mark done/failed
// → UI ไม่เคยรอเครื่องพิมพ์เลย กดพิมพ์ปุ๊บตอบกลับปั๊บ
//
// เลือก driver ผ่าน env PRINT_DRIVER:
//   mock     → MockDriver (เขียนไฟล์ .txt ลง printed/ — dev/test)
//   windows  → WindowsPdfDriver (เรนเดอร์ PDF 100×150mm → ส่งเข้า Windows spooler)
//   (ไม่ตั้ง) → windows บน win32, mock บน OS อื่น
// ชื่อเครื่องพิมพ์: env PRINTER_NAME → settings.printer_name (ตั้งในหน้าเว็บ)
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, ROOT, now } from './db.mjs';
import { makeDriver, resolveDriverName } from './printer-drivers.mjs';

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(join(ROOT, 'data', 'worker.log'), line); } catch { /* ignore */ }
};

// --- claim งานแบบ atomic: กัน worker 2 ตัวดึงงานเดียวกัน ---
function claimJob() {
  // หา id งานที่ queued เก่าสุดก่อน แล้ว UPDATE แบบมีเงื่อนไข status='queued'
  const row = db.prepare(
    "SELECT id FROM print_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1"
  ).get();
  if (!row) return null;
  const r = db.prepare(
    "UPDATE print_jobs SET status = 'printing' WHERE id = ? AND status = 'queued'"
  ).run(row.id);
  if (r.changes === 0) return null; // มี worker ตัวอื่น claim ไปก่อน
  return db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(row.id);
}

async function tick(driver) {
  try {
    const job = claimJob();
    if (!job) return;
    log(`printing job #${job.id} (${job.copies} copies)…`);
    try {
      const sender = db.prepare('SELECT * FROM sender_profile WHERE id = 1').get();
      await driver.print(job, sender);
      db.prepare("UPDATE print_jobs SET status = 'done', printed_at = ? WHERE id = ?")
        .run(now(), job.id);
      log(`job #${job.id} done`);
    } catch (e) {
      db.prepare("UPDATE print_jobs SET status = 'failed', error = ? WHERE id = ?")
        .run(String(e?.message || e), job.id);
      log(`job #${job.id} FAILED: ${e?.message || e}`);
    }
  } catch (e) {
    log(`tick error: ${e?.message || e}`);
  }
}

const driverName = resolveDriverName();
const driver = makeDriver();
log(`print worker started (driver=${driverName}, platform=${process.platform}) — polling every 3s`);
if (driverName === 'windows' && !((process.env.PRINTER_NAME || '').trim())) {
  log('หมายเหตุ: จะใช้ชื่อเครื่องพิมพ์จากหน้า ตั้งค่า (settings.printer_name)');
}
setInterval(() => tick(driver), 3000);
tick(driver); // รันทันทีรอบแรก

process.on('SIGINT', () => { log('worker stopped'); process.exit(0); });
