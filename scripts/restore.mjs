// scripts/restore.mjs — กู้ฐานข้อมูลจากไฟล์สำรอง .sql.gz
// ใช้: node scripts/restore.mjs <ไฟล์.sql.gz>
// ขั้นตอน: 1) copy data/labelpro.db ปัจจุบันเป็น .bak กันพลาด
//          2) gunzip dump → pipe เข้า sqlite3 สร้าง db ใหม่
//          3) แทนที่ไฟล์เดิม
import { execFileSync } from 'node:child_process';
import {
  createReadStream, createWriteStream, readFileSync,
  copyFileSync, existsSync, renameSync, rmSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { ROOT, DATA_DIR, DB_PATH } from '../server/db.mjs';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('ใช้: node scripts/restore.mjs <ไฟล์.sql.gz>');
  process.exit(1);
}
if (!file.endsWith('.sql.gz')) {
  console.error('รองรับเฉพาะไฟล์ .sql.gz (ถ้าเป็น .db binary ให้ copy ทับ data/labelpro.db ตรง ๆ)');
  process.exit(1);
}

const tag = Date.now();
const tmpSql = join(DATA_DIR, `_restore_${tag}.sql`);
const tmpDb = join(DATA_DIR, `_restore_${tag}.db`);
const bakDb = join(DATA_DIR, `labelpro.bak_${new Date().toISOString().replace(/[:.]/g, '-')}.db`);

try {
  // 1. gunzip dump ลงไฟล์ .sql ชั่วคราว
  await pipeline(createReadStream(file), createGunzip(), createWriteStream(tmpSql));
  // 2. สร้าง db ใหม่จาก dump (ผ่าน sqlite3 CLI)
  execFileSync('sqlite3', [tmpDb], { input: readFileSync(tmpSql, 'utf8') });
  // 3. สำรองของเดิมก่อนทับ (รวมไฟล์ -wal/-shm)
  if (existsSync(DB_PATH)) {
    copyFileSync(DB_PATH, bakDb);
    console.log('สำรอง db เดิมไว้ที่:', basename(bakDb));
    for (const ext of ['', '-wal', '-shm']) {
      try { rmSync(DB_PATH + ext); } catch { /* ไม่มีไฟล์ก็ข้าม */ }
    }
  }
  renameSync(tmpDb, DB_PATH);
  console.log('กู้คืนสำเร็จจาก:', basename(file));
  console.log('เปิดแอปแล้วตรวจข้อมูล — ถ้าผิดพลาด กู้ไฟล์ .bak กลับได้');
} catch (e) {
  console.error('กู้คืนล้มเหลว:', e.message);
  process.exitCode = 1;
} finally {
  try { rmSync(tmpSql); } catch { /* ignore */ }
  try { rmSync(tmpDb); } catch { /* ignore */ }
}
