// scripts/update.mjs — อัปเดตแอปจาก GitHub (รันโดยปุ่มใน UI หรือ Windows Task Scheduler)
// ใช้: node scripts/update.mjs
// ทำ: git pull --ff-only ในโฟลเดอร์โปรเจกต์ แล้วบอกให้ restart server/worker
// SSH: ใช้ helper จาก git-env.mjs → ทำงานผ่าน deploy key แบบ non-interactive
//      ไม่ต้องล็อกอิน GitHub ด้วย account ส่วนตัวบนเครื่องนี้
import { shGit } from './git-env.mjs';
import { ROOT } from '../server/db.mjs';

try {
  console.log('[update] กำลังดึงโค้ดล่าสุดจาก GitHub…');
  const before = shGit('git rev-parse --short HEAD', ROOT);
  const out = shGit('git pull --ff-only', ROOT);
  const after = shGit('git rev-parse --short HEAD', ROOT);
  console.log(out);
  if (before === after) {
    console.log('[update] เป็นเวอร์ชันล่าสุดแล้ว ไม่มีการเปลี่ยนแปลง');
  } else {
    console.log(`[update] อัปเดต ${before} → ${after} สำเร็จ`);
    console.log('[update] กรุณา restart: ปิดแล้วเปิดแอปใหม่ (ดับเบิลคลิก start-labelpro.bat)');
  }
} catch (e) {
  console.error('[update] ล้มเหลว:', String(e?.message || e).split('\n').slice(0, 5).join('\n'));
  console.error('[update] ถ้าเน็ตใช้ไม่ได้ ให้ลองใหม่ภายหลัง — ระบบเดิมยังใช้งานได้ปกติ');
  process.exitCode = 1;
}
