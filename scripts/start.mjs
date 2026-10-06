// scripts/start.mjs — จุดเริ่มหลักของแอป (npm start / ดับเบิลคลิก start-labelpro.bat)
// ทำ 3 อย่างตามลำดับ:
//   1) ลอง git pull อัตโนมัติ (ถ้าล้มเหลวก็รันเวอร์ชันเดิมต่อ — ไม่พัง ไม่บล็อก)
//   2) สตาร์ท server (API+เว็บ) และ print worker พร้อมกันใน process เดียว
//   3) บน Windows: รอ server พร้อมแล้วเปิด browser ให้เอง
// สำหรับ dev ที่ไม่อยากให้ pull: ใช้ `npm run server` + `npm run worker` แยกกัน
import { spawn, exec } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { tryAutoPull } from './git-update.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const BASE = `http://localhost:${PORT}`;

console.log('==============================================');
console.log('  LabelPro Local — กำลังเริ่มระบบ…');
console.log('==============================================');

// ---------- 1) อัปเดตโค้ดอัตโนมัติ ----------
const upd = await tryAutoPull(ROOT);
const icon = {
  'up-to-date': '✅',
  pulled: '⬆️',
  'skipped-no-git': '⏭️',
  'skipped-dirty': '⚠️',
  failed: '⚠️',
}[upd.status] || 'ℹ️';
console.log(`[อัปเดต] ${icon} ${upd.detail}`);

// ---------- 2) สตาร์ท server + worker ----------
const children = [];
function startChild(name, script) {
  const child = spawn(process.execPath, [join(ROOT, script)], {
    cwd: ROOT,
    stdio: 'inherit', // ให้ log ของลูกโผล่ในหน้าต่างนี้เลย
    env: { ...process.env, PORT: String(PORT) },
  });
  child.on('exit', (code, signal) => {
    console.log(`[${name}] หยุดทำงาน (code=${code}, signal=${signal})`);
  });
  children.push({ name, child });
  return child;
}

startChild('server', 'server/index.mjs');
startChild('worker', 'server/print-worker.mjs');

// ปิดลูกให้สะอาดเมื่อโดน Ctrl+C / ปิดหน้าต่าง
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[ระบบ] ได้รับสัญญาณ ${signal} — กำลังปิด server และ worker…`);
  for (const { child } of children) {
    try { child.kill(signal); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------- 3) เปิด browser ให้เอง (เฉพาะ Windows) ----------
async function waitForHealth(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* server ยังไม่พร้อม — รอต่อ */ }
    await delay(1000);
  }
  return false;
}

if (process.platform === 'win32') {
  const ok = await waitForHealth(`${BASE}/api/health`, 20_000);
  if (ok) {
    console.log(`[ระบบ] ✅ เปิด browser: ${BASE}`);
    exec(`start "" "${BASE}"`, (err) => {
      if (err) console.log(`[ระบบ] เปิด browser อัตโนมัติไม่ได้ — เปิดเองที่ ${BASE}`);
    });
  } else {
    console.log(`[ระบบ] ⚠️ รอ server นานเกินไป — เปิด browser เองที่ ${BASE}`);
  }
} else {
  console.log(`[ระบบ] เปิด browser ที่ ${BASE}`);
}
