// scripts/update.mjs — อัปเดตแอปจาก GitHub (รันโดยปุ่มใน UI หรือ Windows Task Scheduler)
// ใช้: node scripts/update.mjs
// ทำ: git pull --ff-only ในโฟลเดอร์โปรเจกต์ แล้วบอกให้ restart server/worker
// หมายเหตุ: ใช้ git pull ธรรมดา (ไม่ต้องใช้ account ส่วนตัวในตัวแอป)
// แนะนำให้ repo อยู่ใต้ GitHub Organization ของร้าน ไม่ใช่ account ส่วนตัว
// (กันปัญหาคนลาออกแล้ว repo หาย/เข้าไม่ได้)
import { execSync } from 'node:child_process';
import { ROOT } from '../server/db.mjs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: ROOT, stdio: 'pipe', timeout: 120_000 }).trim();
}

try {
  console.log('[update] fetching from GitHub…');
  const before = sh('git rev-parse --short HEAD');
  const out = sh('git pull --ff-only');
  const after = sh('git rev-parse --short HEAD');
  console.log(out);
  if (before === after) {
    console.log('[update] เป็นเวอร์ชันล่าสุดแล้ว ไม่มีการเปลี่ยนแปลง');
  } else {
    console.log(`[update] อัปเดต ${before} → ${after} สำเร็จ`);
    console.log('[update] กรุณา restart: ปิดแล้วเปิด npm start / npm run worker ใหม่ (หรือ restart service)');
  }
} catch (e) {
  console.error('[update] ล้มเหลว:', String(e?.message || e).split('\n').slice(0, 5).join('\n'));
  console.error('[update] ถ้าเน็ตใช้ไม่ได้ ให้ลองใหม่ภายหลัง — ระบบเดิมยังใช้งานได้ปกติ');
  process.exitCode = 1;
}
