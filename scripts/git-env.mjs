// scripts/git-env.mjs — helper กลางสำหรับรัน git แบบ non-interactive ผ่าน SSH
//
// บริบท: เครื่องสาขาใช้ SSH deploy key (ไม่มีการล็อกอิน GitHub ด้วย account ส่วนตัว)
//  - StrictHostKeyChecking=accept-new → รับ host key ของ github.com อัตโนมัติครั้งแรก
//    (ไม่ค้างถาม yes/no ตอน clone/pull/push ครั้งแรก)
//  - BatchMode=yes → ถ้า auth ไม่ผ่านให้ fail ทันทีพร้อม error ชัด ๆ
//    (ไม่ค้างถาม password/passphrase — สำคัญมากเพราะรันเบื้องหลังไม่มีคนตอบ)
// ทุกที่ที่ spawn `git` ต้องผ่าน helper ในไฟล์นี้ (git-update.mjs, update.mjs, backup.mjs)
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const GIT_SSH_COMMAND = 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes';

/** env สำหรับ spawn git — รวม env เดิมของ process ด้วยเสมอ */
export function gitEnv(extra = {}) {
  return { ...process.env, ...extra, GIT_SSH_COMMAND };
}

/** แปล error ทั่วไปของ git เป็นภาษาไทย — อ่านแล้วรู้ว่าต้องแก้ตรงไหน */
export function thaiGitHint(output = '') {
  const t = String(output);
  if (/Permission denied \(publickey\)/i.test(t))
    return 'GitHub ปฏิเสธ SSH key — ยังไม่ได้เพิ่ม deploy key ที่ repo → Settings → Deploy keys หรือ key บนเครื่องนี้ไม่ตรงกับที่เพิ่มไว้';
  if (/Could not resolve hostname|Temporary failure in name resolution|Network is unreachable|Connection timed out|Connection refused|Connection reset|Connection closed|kex_exchange_identification/i.test(t))
    return 'ต่ออินเทอร์เน็ตไม่ได้ — เช็กสาย LAN / WiFi แล้วลองใหม่';
  if (/Host key verification failed/i.test(t))
    return 'ยืนยัน host key ของ GitHub ไม่ผ่าน — ลองลบไฟล์ known_hosts เก่าแล้ว clone ใหม่';
  if (/Repository not found/i.test(t))
    return 'หา repo ไม่เจอ — ชื่อ repo ผิด หรือ deploy key ไม่มีสิทธิ์อ่าน repo นี้ (labelpro-local ต้องการสิทธิ์ read, labelpro-backups ต้องการสิทธิ์ write)';
  if (/non-fast-forward|fetch first|\[rejected\]/i.test(t))
    return 'มี commit ในเครื่องที่ GitHub ไม่มี — อย่าแก้โค้ดบนเครื่องสาขาโดยตรง ให้แก้บนเครื่องหลักแล้ว push ขึ้น GitHub';
  return '';
}

/** สกัดข้อความ error ภาษาไทยสั้น ๆ จาก exception ของ git */
export function shortGitErr(e, maxLen = 400) {
  const raw = String(e?.stderr || e?.message || e);
  const tail = raw.split('\n').filter((l) => l.trim()).slice(-6).join(' ').slice(0, maxLen).trim();
  const hint = thaiGitHint(raw);
  return hint ? `${tail} — ${hint}` : tail;
}

/**
 * รัน git แบบ async + hardened — ไม่ throw, คืน { ok, stdout, stderr }
 * stderr เป็นข้อความภาษาไทยพร้อมคำแนะนำวิธีแก้
 */
export async function runGit(args, cwd, { timeout = 60_000 } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout,
      env: gitEnv(),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout || '').trim(), stderr: '' };
  } catch (e) {
    return { ok: false, stdout: '', stderr: shortGitErr(e) };
  }
}

/** รัน git แบบ sync (throw ถ้าล้มเหลว) — สำหรับสคริปต์ CLI อย่าง update.mjs */
export function shGit(cmd, cwd, { timeout = 120_000 } = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd, stdio: 'pipe', timeout, env: gitEnv() }).trim();
  } catch (e) {
    const err = new Error(shortGitErr(e));
    err.cause = e;
    throw err;
  }
}
