import { join } from 'node:path';
import { db, DATA_DIR, DB_PATH, now } from './db.mjs';
import { makeDriver, resolveDriverName, cleanupStalePrintFiles } from './printer-drivers.mjs';
import { closeLabelBrowser, getLabelBrowser } from './label-pdf.mjs';
import { acquireLock } from './process-lock.mjs';
import { appendLog } from './log.mjs';
const release = acquireLock(DB_PATH + '.worker.lock');
process.on('exit', release);
const log = (msg) => { const line = `[${now()}] ${msg}\n`; process.stdout.write(line); appendLog(join(DATA_DIR, 'worker.log'), line); };
const driverName = resolveDriverName(), driver = makeDriver();
await cleanupStalePrintFiles();
if (driverName === 'windows') await getLabelBrowser();
db.prepare("UPDATE print_jobs SET status='failed',error=? WHERE status='printing'").run('ระบบหยุดระหว่างส่งพิมพ์ กรุณาตรวจฉลากก่อนเลือกพิมพ์ซ้ำ');
const heartbeat = () => db.prepare('INSERT INTO worker_state(id,pid,heartbeat,driver) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid,heartbeat=excluded.heartbeat,driver=excluded.driver').run(process.pid, now(), driverName);
heartbeat();
const pulse = setInterval(heartbeat, 2000);
let stopping = false, busy = false, timer;
export async function tick() {
  if (busy || stopping) return;
  busy = true;
  try {
    const job = db.transaction(() => {
      if (db.prepare("SELECT 1 FROM print_jobs WHERE status='printing'").get()) return null;
      const row = db.prepare("SELECT * FROM print_jobs WHERE status='queued' ORDER BY id LIMIT 1").get();
      if (row) db.prepare("UPDATE print_jobs SET status='printing' WHERE id=?").run(row.id);
      return row;
    }).immediate();
    if (job) {
      log(`printing job #${job.id} (${job.copies} copies)`);
      try {
        await driver.print(job);
        db.prepare("UPDATE print_jobs SET status='done',printed_at=?,error=NULL WHERE id=?").run(now(), job.id);
        log(`job #${job.id} sent (driver=${driverName})`);
      } catch (error) {
        db.prepare("UPDATE print_jobs SET status='failed',error=? WHERE id=?").run(String(error.message), job.id);
        log(`job #${job.id} FAILED: ${error.message}`);
      }
    }
  } catch (error) { log('worker error: ' + error.message); }
  finally { busy = false; if (!stopping) timer = setTimeout(tick, Number(process.env.LABELPRO_POLL_MS || 1000)); }
}
async function stop() {
  if (stopping) return;
  stopping = true; clearTimeout(timer);
  while (busy) await new Promise((resolve) => setTimeout(resolve, 100));
  clearInterval(pulse); db.prepare('DELETE FROM worker_state WHERE pid=?').run(process.pid);
  await closeLabelBrowser(); db.close(); release(); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('message', (msg) => { if (msg?.type === 'stop') stop(); });
log(`print worker started (driver=${driverName})`);
process.send?.({ type: 'ready' });
tick();
