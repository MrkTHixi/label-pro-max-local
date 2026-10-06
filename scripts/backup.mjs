// Online snapshot + portable SQL gzip. No sqlite3 CLI or shell interpolation.
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, copyFileSync, existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { db, now, getSetting } from '../server/db.mjs';
import { BACKUPS_DIR, BACKUP_REPO } from '../server/paths.mjs';
import { createLocalBackup, dumpSql } from '../server/local-backup.mjs';
const dry = process.argv.includes('--dry-run');
const scratch = dry ? mkdtempSync(join(tmpdir(), 'label-pro-max-local-backup-check-')) : null;
let snapshot, snapshotDb;
const logId = dry ? null : db.prepare('INSERT INTO backup_log (started_at,ok,message) VALUES (?,0,?)').run(now(), 'กำลังสำรอง').lastInsertRowid;
const git = (args) => execFileSync('git', args, { cwd: BACKUP_REPO, encoding: 'utf8', windowsHide: true, timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();
try {
  snapshot = await createLocalBackup(db, scratch || BACKUPS_DIR, 'backup');
  snapshotDb = new Database(snapshot, { readonly: true });
  const sql = dumpSql(snapshotDb);
  snapshotDb.close(); snapshotDb = null;
  const artifact = snapshot.replace(/\.db$/, '.sql.gz');
  writeFileSync(artifact, gzipSync(sql, { level: 9 }));
  if (dry) console.log('[backup] --dry-run: snapshot และ SQL ผ่าน; ไม่ commit/push หรือเขียน backup_log');
  else {
    let note = 'สำรองในเครื่องสำเร็จ';
    try {
      mkdirSync(BACKUP_REPO, { recursive: true });
      if (!existsSync(join(BACKUP_REPO, '.git'))) {
        git(['init']); git(['branch', '-M', 'main']);
        git(['config', 'user.name', 'label-pro-max-local-backup']); git(['config', 'user.email', 'label-pro-max-local-backup@local']);
      }
      copyFileSync(artifact, join(BACKUP_REPO, basename(artifact)));
      git(['add', '--', basename(artifact)]);
      git(['commit', '-m', `backup ${now()} [${getSetting('branch_name') || 'local'}]`]);
      const remote = getSetting('backup_repo_url').trim();
      if (remote) {
        if (git(['remote']).split(/\r?\n/).includes('origin')) git(['remote', 'set-url', 'origin', remote]);
        else git(['remote', 'add', 'origin', remote]);
        git(['push', '-u', 'origin', 'main']); note += ' และส่งขึ้น Git แล้ว';
      } else note += ' และ commit Git ในเครื่องแล้ว';
    } catch (error) { note += '; Git ยังไม่สำเร็จ เก็บไฟล์ไว้แล้ว: ' + String(error.message).split('\n')[0]; }
    const files = readdirSync(BACKUPS_DIR).filter((f) => /^(labelpro|label-pro-max-local)-backup-.*\.(db|sql\.gz)$/.test(f)).map((f) => ({ f, t: statSync(join(BACKUPS_DIR, f)).mtimeMs })).sort((a,b) => b.t-a.t);
    for (const { f } of files.slice(60)) rmSync(join(BACKUPS_DIR, f));
    db.prepare('UPDATE backup_log SET finished_at=?,ok=1,message=? WHERE id=?').run(now(), `${basename(artifact)} — ${note}`, logId);
    console.log('[backup] ' + note);
  }
} catch (error) {
  if (!dry) db.prepare('UPDATE backup_log SET finished_at=?,ok=0,message=? WHERE id=?').run(now(), String(error.message).slice(0,1000), logId);
  console.error('[backup] ' + error.message); process.exitCode = 1;
} finally {
  snapshotDb?.close(); db.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
