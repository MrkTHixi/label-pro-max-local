// Own only the two child processes started by this supervisor; never kill unrelated Node apps.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT, DATA_DIR, DB_PATH, APP_ID } from '../server/paths.mjs';
import { acquireLock } from '../server/process-lock.mjs';
import { appendLog } from '../server/log.mjs';
if (process.argv.includes('--identity')) { console.log(APP_ID); process.exit(0); }
mkdirSync(dirname(DB_PATH), { recursive: true }); mkdirSync(DATA_DIR, { recursive: true });
let release;
try { release = acquireLock(DB_PATH + '.runtime.lock'); }
catch (error) { console.error(error.message); process.exit(1); }
process.on('exit', release);
const log = (text) => appendLog(join(DATA_DIR,'runtime.log'), `[${new Date().toISOString()}] ${text}\n`);
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
      if (role==='server' && message?.type==='stop') stop();
      if (role==='server' && message?.type==='restart') restart();
      if (role==='server' && message?.type==='apply-update') restart(message.manifest);
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer); children.delete(role); reject(new Error(role + ' หยุดทำงาน (' + code + ')'));
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
try { await start('server'); await start('worker'); log('ready'); }
catch (error) { log(error.stack || error.message); await stop(1); }
