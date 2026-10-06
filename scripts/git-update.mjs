// scripts/git-update.mjs — ดึงโค้ดล่าสุดจาก GitHub แบบปลอดภัย
// ใช้โดย scripts/start.mjs (auto-pull ตอนเปิดแอป)
// หลักการ: ไม่ throw เด็ดขาด — ถ้าดึงไม่ได้ (เน็ตหล่ม/ไม่มี remote/ไฟล์แก้ค้าง)
//         ก็แค่รายงานสถานะ แล้วให้แอปรันเวอร์ชันเดิมต่อ
// SSH: ใช้ helper จาก git-env.mjs → ทำงานผ่าน deploy key แบบ non-interactive
//      (ไม่มีการถาม password/passphrase ค้าง — BatchMode=yes fail ทันทีพร้อมข้อความไทย)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from './git-env.mjs';

const shortErr = (e) => String(e?.message || e).split('\n').slice(0, 3).join(' ').slice(0, 200);

/**
 * พยายาม git pull --ff-only แบบปลอดภัย
 * @param {string} cwd - โฟลเดอร์โปรเจกต์ (ที่มี .git)
 * @returns {Promise<{status: 'up-to-date'|'pulled'|'skipped-no-git'|'skipped-dirty'|'failed', detail: string}>}
 */
export async function tryAutoPull(cwd) {
  if (!existsSync(join(cwd, '.git'))) {
    return { status: 'skipped-no-git', detail: 'ไม่พบ .git — ข้ามการอัปเดต (น่าจะรันจากไฟล์ zip ที่ยังไม่ได้ git init)' };
  }
  const st = await runGit(['status', '--porcelain'], cwd);
  if (!st.ok) {
    return { status: 'failed', detail: `ตรวจ git status ไม่ได้: ${st.stderr || shortErr(st)}` };
  }
  if (st.stdout.trim()) {
    return {
      status: 'skipped-dirty',
      detail: 'มีไฟล์ที่แก้ไขค้างไว้ — ข้ามการ pull เพื่อไม่ให้ทับงาน (commit หรือ stash เองก่อน)',
    };
  }
  let before = '';
  const head = await runGit(['rev-parse', 'HEAD'], cwd);
  if (head.ok) before = head.stdout.trim();
  const pull = await runGit(['pull', '--ff-only'], cwd);
  if (!pull.ok) {
    return { status: 'failed', detail: `pull ไม่สำเร็จ: ${pull.stderr} — รันเวอร์ชันเดิมต่อ` };
  }
  let after = '';
  const head2 = await runGit(['rev-parse', 'HEAD'], cwd);
  if (head2.ok) after = head2.stdout.trim();
  if (before && after && before !== after) {
    return { status: 'pulled', detail: `อัปเดตโค้ด ${before.slice(0, 7)} → ${after.slice(0, 7)} สำเร็จ` };
  }
  const out = pull.stdout.split('\n')[0];
  return { status: 'up-to-date', detail: 'โค้ดเป็นเวอร์ชันล่าสุดแล้ว' + (out ? ` (${out})` : '') };
}
