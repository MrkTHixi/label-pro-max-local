// scripts/backup.mjs — สำรองฐานข้อมูลขึ้น git (รันโดย server แบบ debounce หรือกดปุ่มใน UI)
// ใช้: node scripts/backup.mjs [--dry-run]
//
// ออกแบบตามโจทย์:
//  1. ไม่ backup ไฟล์ .db binary ตรง ๆ (diff ไม่ได้, merge ไม่ได้, เปลือง)
//     → dump เป็น SQL *text* แล้ว gzip (.sql.gz) — git diff อ่านรู้เรื่อง
//  2. ไม่ backup ทุกครั้งที่เขียน → server ตั้ง dirty flag + debounce (ค่าเริ่มต้น 10 นาที)
//  3. ใช้ git repo *แยก* (data-backup/) ไม่ปนกับ repo โค้ด → ประวัติ backup ไม่รกโค้ด
//     และ push ไป remote แยก (backup_repo_url ใน settings)
//  4. เน็ตล่ม push ไม่ได้ → เก็บไฟล์ + commit ไว้ในเครื่อง รันครั้งหน้าจะ push
//     commit ที่ค้างทั้งหมดให้เอง (git push ส่งทุก commit ที่ยังไม่ขึ้น remote)
import { execFileSync, execSync } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { mkdirSync, readdirSync, copyFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { db, ROOT, DATA_DIR, DB_PATH, now, getSetting } from '../server/db.mjs';

const DRY = process.argv.includes('--dry-run');
const BACKUPS_DIR = join(ROOT, 'backups');
const BACKUP_REPO = join(ROOT, 'data-backup'); // git repo แยก — อยู่ใน .gitignore ของ repo โค้ด

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}
function hasSqlite3() {
  try { execFileSync('sqlite3', ['--version'], { stdio: 'pipe' }); return true; }
  catch { return false; }
}

async function main() {
  mkdirSync(BACKUPS_DIR, { recursive: true });
  const startedAt = now();
  const logId = DRY ? null : db.prepare(
    'INSERT INTO backup_log (started_at, ok, message) VALUES (?, 0, ?)'
  ).run(startedAt, 'started').lastInsertRowid;

  const finish = (ok, message) => {
    console.log(`[backup] ${ok ? 'OK' : 'FAIL'}: ${message}`);
    if (!DRY) {
      db.prepare('UPDATE backup_log SET finished_at = ?, ok = ?, message = ? WHERE id = ?')
        .run(now(), ok ? 1 : 0, message, logId);
    }
  };

  try {
    // 1. checkpoint WAL → snapshot นิ่งก่อน dump
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { console.log('[backup] checkpoint skip:', e.message); }

    // 2. dump เป็น SQL text (ดีกว่า binary: diff ได้, อ่านได้)
    const name = `labelpro-${stamp()}`;
    let artifact, isText;
    if (hasSqlite3()) {
      const sql = execFileSync('sqlite3', [DB_PATH, '.dump'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      const gzPath = join(BACKUPS_DIR, `${name}.sql.gz`);
      await pipeline(
        (async function* () { yield sql; })(),
        createGzip({ level: 9 }),
        createWriteStream(gzPath)
      );
      artifact = gzPath; isText = true;
    } else {
      // fallback: ไม่มี sqlite3 CLI → VACUUM INTO ไฟล์ .db แล้ว commit binary พร้อม warning
      const tmpDb = join(BACKUPS_DIR, `${name}.db`);
      db.exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);
      artifact = tmpDb; isText = false;
      console.log('[backup] WARNING: ไม่พบ sqlite3 CLI — สำรองเป็น binary .db แทน (ติดตั้ง sqlite3 เพื่อให้ได้ SQL text)');
    }
    const sizeKb = Math.round(statSync(artifact).size / 1024);
    console.log(`[backup] dump → ${artifact} (${sizeKb} KB, ${isText ? 'sql.gz text' : 'binary db'})`);

    if (DRY) {
      console.log('[backup] --dry-run: ไม่ทำ git commit/push, ไม่เขียน backup_log');
      rmSync(artifact);
      return;
    }

    // 3. repo backup แยก (git init ครั้งแรก)
    mkdirSync(BACKUP_REPO, { recursive: true });
    if (!existsSync(join(BACKUP_REPO, '.git'))) {
      sh('git init', { cwd: BACKUP_REPO });
      sh('git branch -M main', { cwd: BACKUP_REPO });
      sh('git config user.name "labelpro-backup"', { cwd: BACKUP_REPO });
      sh('git config user.email "labelpro-backup@local"', { cwd: BACKUP_REPO });
      writeFileSync(join(BACKUP_REPO, 'README.md'),
        '# LabelPro backup repo\n\nที่เก็บไฟล์สำรองฐานข้อมูล (.sql.gz) แยกจาก repo โค้ด\nกู้คืน: ดู scripts/restore.mjs ใน repo โค้ด\n');
      sh('git add README.md', { cwd: BACKUP_REPO });
      sh('git commit -m "init backup repo"', { cwd: BACKUP_REPO });
    }

    // 4. copy artifact → commit
    const dest = join(BACKUP_REPO, artifact.split('/').pop());
    copyFileSync(artifact, dest);
    sh(`git add "${dest.split('/').pop()}"`, { cwd: BACKUP_REPO });
    const branch = getSetting('branch_name') || 'local';
    const msg = `backup ${stamp()} [${branch}]${isText ? '' : ' (binary fallback: no sqlite3 CLI)'}`;
    sh(`git commit -m "${msg.replace(/"/g, '')}"`, { cwd: BACKUP_REPO });

    // 5. push (ถ้ามี remote; ถ้าเน็ตล่ม/ไม่มี remote ก็ข้าม — commit อยู่ในเครื่อง รันหน้าค่อย push)
    const remote = getSetting('backup_repo_url').trim();
    let pushNote = 'no remote configured — เก็บ commit ไว้ในเครื่อง';
    if (remote) {
      try {
        const hasOrigin = sh('git remote', { cwd: BACKUP_REPO }).split('\n').includes('origin');
        if (!hasOrigin) sh(`git remote add origin "${remote.replace(/"/g, '')}"`, { cwd: BACKUP_REPO });
        // push ส่งทุก commit ที่ค้างอยู่ให้เอง = retry อัตโนมัติ
        sh('git push -u origin main', { cwd: BACKUP_REPO, timeout: 60_000 });
        pushNote = `pushed to ${remote}`;
      } catch (e) {
        pushNote = `push ล้มเหลว (เก็บไว้ push ครั้งหน้า): ${String(e.message).split('\n')[0]}`;
      }
    }

    // 6. prune: เก็บไฟล์ local แค่ 30 ไฟล์ล่าสุด (git history คือ archive ตัวจริง)
    const files = readdirSync(BACKUPS_DIR)
      .filter((f) => f.startsWith('labelpro-'))
      .map((f) => ({ f, t: statSync(join(BACKUPS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(30)) rmSync(join(BACKUPS_DIR, f));

    finish(true, `${dest.split('/').pop()} (${sizeKb} KB). ${pushNote}`);
  } catch (e) {
    finish(false, String(e?.message || e).slice(0, 500));
    process.exitCode = 1;
  }
}

main();
