import { openSync, readFileSync, writeFileSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
export function isLockActive(file) {
  try { return isProcessAlive(JSON.parse(readFileSync(file, 'utf8')).pid); } catch { return false; }
}
export function acquireLock(file) {
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token, created: Date.now() })); closeSync(fd);
      return () => { try { if (JSON.parse(readFileSync(file, 'utf8')).token === token) unlinkSync(file); } catch { /* already removed */ } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const lock = JSON.parse(readFileSync(file, 'utf8'));
        if (isProcessAlive(lock.pid)) throw new Error('Label Pro Max Local กำลังทำงานอยู่แล้ว');
        unlinkSync(file);
      } catch (readError) {
        if (readError instanceof SyntaxError) {
          if(Date.now()-statSync(file).mtimeMs > 30000){unlinkSync(file);continue;}
          throw new Error('Label Pro Max Local กำลังเริ่มระบบ กรุณารอสักครู่');
        }
        if (readError.code !== 'ENOENT') throw readError;
      }
    }
  }
  throw new Error('ไม่สามารถล็อกการเริ่มระบบ');
}
