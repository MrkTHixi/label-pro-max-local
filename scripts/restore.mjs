// Stop LabelPro first. Do not import db.mjs and migrate/create the destination.
import Database from 'better-sqlite3';
import { readFileSync, copyFileSync, existsSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DB_PATH } from '../server/paths.mjs';
import { createLocalBackup } from '../server/local-backup.mjs';
import { isLockActive } from '../server/process-lock.mjs';
const file = process.argv[2];
const temp = `${DB_PATH}.restore-${process.pid}`;
let restored, current;
try {
  if (!file || !existsSync(file) || !/\.(db|sql\.gz)$/.test(file)) throw new Error('ใช้: npm run restore -- <ไฟล์.db หรือ .sql.gz>');
  if (['runtime','worker','server'].some((role) => isLockActive(`${DB_PATH}.${role}.lock`))) throw new Error('กรุณาปิดระบบด้วย stop-labelpro.vbs ก่อนกู้คืน');
  mkdirSync(dirname(DB_PATH), { recursive: true });
  if (file.endsWith('.db')) copyFileSync(file, temp);
  restored = new Database(temp);
  if (file.endsWith('.sql.gz')) restored.exec(gunzipSync(readFileSync(file)).toString('utf8'));
  if (restored.pragma('integrity_check', { simple: true }) !== 'ok' || !restored.prepare("SELECT 1 FROM sqlite_master WHERE name='customers'").get()) throw new Error('ไฟล์สำรองไม่ใช่ฐานข้อมูล LabelPro ที่สมบูรณ์');
  restored.pragma('wal_checkpoint(TRUNCATE)'); restored.close(); restored = null;
  if (existsSync(DB_PATH)) {
    current = new Database(DB_PATH);
    console.log('สำรองก่อนกู้คืน:', await createLocalBackup(current, undefined, 'before-restore'));
    current.pragma('wal_checkpoint(TRUNCATE)'); current.close(); current = null;
    renameSync(DB_PATH, DB_PATH + '.before-restore-' + Date.now());
  }
  for (const suffix of ['-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
  renameSync(temp, DB_PATH);
  console.log('กู้คืนสำเร็จ เปิด LabelPro และตรวจข้อมูลได้เลย');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { restored?.close(); current?.close(); for (const suffix of ['', '-wal', '-shm']) rmSync(temp + suffix, { force: true }); }
