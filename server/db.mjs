import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, DATA_DIR, DB_PATH } from './paths.mjs';
export { ROOT, DATA_DIR, DB_PATH };
mkdirSync(dirname(DB_PATH), { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
// Extend old databases in place; never replace an existing customer database.
db.transaction(() => {
  for (const table of ['customers', 'print_jobs']) {
    const cols = columns(table);
    if (!cols.length) continue;
    for (const [name, old] of [['place_name', null], ['attention_name', 'customer_name'], ['contact', 'phone'], ['address', null]]) {
      if (cols.includes(name)) continue;
      if (old && cols.includes(old)) db.exec(`ALTER TABLE ${table} RENAME COLUMN ${old} TO ${name}`);
      else db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT DEFAULT ''`);
    }
    if (table === 'customers') {
      if (!cols.includes('is_favorite')) db.exec('ALTER TABLE customers ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
      if (!cols.includes('is_active')) db.exec('ALTER TABLE customers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
      for (const name of ['created_at', 'updated_at']) {
        if (!cols.includes(name)) {
          db.exec(`ALTER TABLE customers ADD COLUMN ${name} TEXT DEFAULT ''`);
          db.prepare(`UPDATE customers SET ${name} = ?`).run(new Date().toISOString());
        }
      }
      db.exec("UPDATE customers SET place_name = attention_name WHERE COALESCE(place_name, '') = ''");
    }
  }
  for (const table of ['sender_profile', 'print_jobs']) {
    const cols = columns(table);
    if (cols.includes('sender_subdistrict') && !cols.includes('sender_address_extra')) db.exec(`ALTER TABLE ${table} RENAME COLUMN sender_subdistrict TO sender_address_extra`);
    if (cols.length) for (const name of ['sender_name','sender_phone','sender_address','sender_address_extra']) {
      if (!columns(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT DEFAULT ''`);
    }
  }
  db.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
  db.exec(`CREATE TABLE IF NOT EXISTS worker_state (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER, heartbeat TEXT, driver TEXT)`);
  db.prepare("DELETE FROM settings WHERE key IN ('blessings', 'dirty', 'backup_interval_min')").run();
})();
export const now = () => new Date().toISOString();
export function getSetting(key, fallback = '') {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
