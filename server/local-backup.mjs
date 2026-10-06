import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { BACKUPS_DIR } from './paths.mjs';
export async function createLocalBackup(database, directory = BACKUPS_DIR, reason = 'manual') {
  await mkdir(directory, { recursive: true });
  const file = join(directory, `label-pro-max-local-${reason}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.db`);
  let check;
  try {
    await database.backup(file);
    check = new Database(file, { readonly: true });
    if (check.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('ไฟล์สำรองไม่ผ่านการตรวจสอบ');
    return file;
  } catch (error) {
    check?.close(); check = null;
    await rm(file, { force: true }).catch(() => {});
    throw error;
  } finally { check?.close(); }
}
// Dump a completed online snapshot: every row belongs to the same point in time.
export function dumpSql(database) {
  const objects = database.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
  const quoteId = (s) => '"' + s.replaceAll('"', '""') + '"';
  const quote = (v) => v === null ? 'NULL' : Buffer.isBuffer(v) ? `X'${v.toString('hex')}'` : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
  const lines = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
  for (const item of objects.filter((o) => o.type === 'table')) {
    lines.push(item.sql + ';');
    const cols = database.prepare(`PRAGMA table_info(${quoteId(item.name)})`).all().map((c) => c.name);
    const statement = database.prepare(`SELECT * FROM ${quoteId(item.name)}`);
    statement.safeIntegers(true);
    for (const row of statement.iterate()) lines.push(`INSERT INTO ${quoteId(item.name)} (${cols.map(quoteId).join(',')}) VALUES (${cols.map((c) => quote(row[c])).join(',')});`);
  }
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) {
    lines.push('DELETE FROM sqlite_sequence;');
    for (const row of database.prepare('SELECT name,seq FROM sqlite_sequence').all()) lines.push(`INSERT INTO sqlite_sequence VALUES (${quote(row.name)},${quote(row.seq)});`);
  }
  for (const item of objects.filter((o) => o.type !== 'table')) lines.push(item.sql + ';');
  lines.push('COMMIT;');
  return lines.join('\n');
}
