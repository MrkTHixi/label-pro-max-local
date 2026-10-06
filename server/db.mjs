// server/db.mjs — เปิดฐานข้อมูล SQLite + รัน schema ครั้งแรก
// ไฟล์ DB อยู่ที่ data/labelpro.db (ต่อสาขา 1 ไฟล์ = แยกข้อมูลกันโดยธรรมชาติ)
// ตั้ง env LABELPRO_DB เพื่อชี้ไปไฟล์อื่นได้ (ใช้ตอนเทส)
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
export const DATA_DIR = join(ROOT, 'data');
export const DB_PATH = process.env.LABELPRO_DB || join(DATA_DIR, 'labelpro.db');

mkdirSync(DATA_DIR, { recursive: true });

function openDb(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

let db = openDb(DB_PATH);

// ถ้าเจอ DB เก่า (schema v1: มี customer_name แต่ไม่มี attention_name)
// → ย้ายไฟล์เก่าไปเป็น .bak แล้วสร้างใหม่จาก schema v2
// (โปรเจกต์ยังไม่มีข้อมูล production — ปลอดภัย; ไฟล์เก่าไม่หาย กู้ได้)
function needsReschema() {
  try {
    const cols = db.prepare('PRAGMA table_info(customers)').all().map((c) => c.name);
    return cols.length > 0 && !cols.includes('attention_name');
  } catch {
    return false;
  }
}
if (needsReschema()) {
  db.close();
  const bak = `${DB_PATH}.bak-${Date.now()}`;
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) renameSync(f, bak + suffix);
  }
  console.log(`[db] พบ schema เก่า → ย้ายไป ${bak} แล้วสร้างใหม่`);
  db = openDb(DB_PATH);
}

export { db };

// รัน schema.sql ถ้ายังไม่มีตาราง customers (first start)
const hasTables = db.prepare(
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='customers'"
).get().n === 1;
if (!hasTables) {
  const schema = readFileSync(join(ROOT, 'schema.sql'), 'utf8');
  db.exec(schema);
  console.log('[db] schema created at', DB_PATH);
}

// migration เบา ๆ สำหรับ DB ที่สร้างจาก schema เก่า:
//  - sender_profile.sender_subdistrict → sender_address_extra (เก็บข้อมูลเดิมไว้)
//  - ลบ settings ที่เลิกใช้แล้ว (blessings → ย้ายไป blessings.json, dirty/backup_interval_min → เลิกสำรองตามเวลา)
for (const table of ['sender_profile', 'print_jobs']) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (cols.includes('sender_subdistrict') && !cols.includes('sender_address_extra')) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN sender_subdistrict TO sender_address_extra`);
    console.log(`[db] migrated ${table}.sender_subdistrict → sender_address_extra`);
  }
}
const hasSettings = db.prepare(
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='settings'"
).get().n === 1;
if (hasSettings) {
  db.prepare("DELETE FROM settings WHERE key IN ('blessings', 'dirty', 'backup_interval_min')").run();
}

export const now = () => new Date().toISOString();

// ---- settings helpers ----
export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}
