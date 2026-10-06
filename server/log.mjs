import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
export function appendLog(file, message) {
  try {
    if (existsSync(file) && statSync(file).size > 2 * 1024 * 1024) {
      rmSync(file + '.1', { force: true }); renameSync(file, file + '.1');
    }
    appendFileSync(file, message);
  } catch { /* logging must not stop printing */ }
}
