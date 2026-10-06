import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = resolve(process.env.LABELPRO_DB || join(ROOT, 'data', 'labelpro.db'));
export const DATA_DIR = process.env.LABELPRO_DATA_DIR ? resolve(process.env.LABELPRO_DATA_DIR) : dirname(DB_PATH);
export const BACKUPS_DIR = resolve(process.env.LABELPRO_BACKUPS_DIR || (process.env.LABELPRO_DB ? join(DATA_DIR, 'backups') : join(ROOT, 'backups')));
export const BACKUP_REPO = resolve(process.env.LABELPRO_BACKUP_REPO || (process.env.LABELPRO_DB ? join(DATA_DIR, 'data-backup') : join(ROOT, 'data-backup')));
export const APP_ID = createHash('sha256').update(`${ROOT}|${DB_PATH}`).digest('hex').slice(0, 24);
