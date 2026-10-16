// Own only the two child processes started by this supervisor; never kill unrelated Node apps.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, DATA_DIR, DB_PATH, APP_ID } from '../server/paths.mjs';
import { acquireLock, ALREADY_RUNNING_CODE, ALREADY_RUNNING_EXIT_CODE } from '../server/process-lock.mjs';
import { appendLog } from '../server/log.mjs';

// Classify how a child process ended so the supervisor never mistakes
// "another instance is already running" for a crash — and never restarts
// in a loop because of it. Pure function, unit-tested.
// Exit code 2 (ALREADY_RUNNING_EXIT_CODE) is honored even when the
// 'already-running' IPC message was lost, so the classification does not
// depend on IPC delivery timing.
export function describeChildExit({ role, code, signal, alreadyRunning }) {
  if (alreadyRunning || code === ALREADY_RUNNING_EXIT_CODE) {
    return { action: 'reuse', message: `${role}: ${(alreadyRunning && alreadyRunning.message) || 'มีระบบเดิมทำงานอยู่แล้ว'} — ใช้ระบบเดิมต่อ ไม่เริ่มซ้ำ` };
  }
  return { action: 'fail', message: `${role} หยุดทำงาน (${code ?? signal ?? 'unknown'})` };
}


// True when this file is executed directly (`node scripts/runtime.mjs`);
// false when imported (e.g. by tests importing describeChildExit).
const isMain = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; } })();

if (process.argv.includes('--identity')) { console.log(APP_ID); process.exit(0); }
mkdirSync(dirname(DB_PATH), { recursive: true }); mkdirSync(DATA_DIR, { recursive: true });
const log = (text) => appendLog(join(DATA_DIR,'runtime.log'), `[${new Date().toISOString()}] ${text}\n`);
let release;
try {
  release = acquireLock(DB_PATH + '.runtime.lock', {
    role: 'runtime',
    expected: { root: ROOT, script: 'scripts/runtime.mjs' },
    logger: log,
  });
}
catch (error) {
  console.error(error.message);
  try { log(error.message); } catch { /* ignore */ }
  process.exit(error.code === ALREADY_RUNNING_CODE ? ALREADY_RUNNING_EXIT_CODE : 1);
}
process.on('exit', release);
const children = new Map();
let stopping = false, restarting = false;
async function start(role) {
  const child = spawn(process.execPath, [join(ROOT,'server', role === 'server' ? 'index.mjs' : 'print-worker.mjs')], {
    cwd:ROOT, windowsHide:true, stdio:['ignore','pipe','pipe','ipc'], env:{...process.env}
  });
  children.set(role,child);
  child.stdout.on('data', (chunk) => log(`${role}: ${chunk}`)); child.stderr.on('data', (chunk) => log(`${role}: ${chunk}`));
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error(role + ' ไม่พร้อมภายใน 45 วินาที')),45000);
    child.on('message', (message) => {
      if (message?.type==='ready') { clearTimeout(timer); resolve(); }
      if (message?.type==='already-running') { child.alreadyRunning = message; }
      if (role==='server' && message?.type==='stop') stop();
      if (role==='server' && message?.type==='restart') restart();
      if (role==='server' && message?.type==='apply-update') restart(message.manifest);
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer); children.delete(role);
      const outcome = describeChildExit({ role, code, signal, alreadyRunning: child.alreadyRunning });
      if (outcome.action === 'reuse') {
        // A live instance already owns the lock — reuse it instead of
        // reporting a crash, and never restart in a loop because of it.
        log(outcome.message);
        reject(Object.assign(new Error(outcome.message), { code: 'ALREADY_RUNNING' }));
        return;
      }
      reject(new Error(outcome.message));
      if (!stopping && !restarting) { log(`${role} exited unexpectedly`); stop(1); }
    });
  });
}
async function stopChildren() {
  // Stop intake first, then wait for an in-progress send to finish.
  await Promise.all([...children.values()].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill(); resolve(); },130000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    if (child.connected) child.send({type:'stop'}); else child.kill();
  })));
  children.clear();
}
async function stop(code=0) {
  if (stopping) return;
  stopping=true; log('stopping'); await stopChildren(); release(); process.exit(code);
}
async function restart(manifest) {
  if (stopping || restarting) return;
  restarting=true; log('restarting');
  try {
    await stopChildren();
    if(manifest){
      try { const result=await promisify(execFile)(process.execPath,[join(ROOT,'scripts','apply-update.mjs'),manifest],{cwd:ROOT,windowsHide:true,timeout:120000}); log(result.stdout); }
      catch(error){log('Update failed: '+error.message);}
    }
    await start('server'); await start('worker');
  }
  catch (error) { log(error.message); await stop(1); }
  finally { restarting=false; }
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
process.on('message', (message) => { if(message?.type==='stop')stop(); });
async function main() {
  try { await start('server'); await start('worker'); log('ready'); }
  catch (error) {
    if (error.code === 'ALREADY_RUNNING') {
      // The existing healthy instance keeps serving; this supervisor exits
      // cleanly (code 0) so the launcher reuses it instead of failing.
      log(error.message);
      await stop(0);
      return;
    }
    log(error.stack || error.message); await stop(1);
  }
}
if (isMain) await main();
