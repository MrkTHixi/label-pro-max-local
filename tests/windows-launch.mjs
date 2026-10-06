// Cold-copy setup, portable Node, hidden launcher, duplicate open and graceful restart/stop.
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
if(process.platform!=='win32'){console.log('Windows launcher test skipped on this OS');process.exit(0);}
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=mkdtempSync(join(tmpdir(),'LabelPro clone ภาษาไทย '));
const execute=promisify(execFile);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));
const base=`http://127.0.0.1:${port}`;
const env={...process.env,PORT:String(port),PRINT_DRIVER:'mock',LABELPRO_AUTO_BACKUP:'0',LABELPRO_DB:join(scratch,'data','ทดสอบ.db')};
const launch=async(...extra)=>execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(scratch,'scripts','launch.ps1'),'-NoDialogs','-NoBrowser',...extra],{cwd:scratch,env,windowsHide:true,timeout:300000});
const health=async()=>{try{return await(await fetch(base+'/api/health')).json();}catch{return null;}};
async function ready(){for(let i=0;i<100;i++){const h=await health();if(h?.worker.ready)return h;await wait(200);}throw new Error('Runtime did not become ready');}
try{
  const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:ROOT,encoding:'utf8'}).trim().split(/\r?\n/);
  for(const file of files){if(!existsSync(join(ROOT,file)))continue;const dest=join(scratch,file);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(ROOT,file),dest);}
  console.log('Cold copy created in a path containing Thai and spaces. Preparing runtime...');
  await launch('-ForcePortableNode');
  const first=await ready();assert(first.managed);console.log('✓ cold setup without installed Node selection; server and worker ready');
  await launch();const second=await ready();assert.equal(second.pid,first.pid);console.log('✓ duplicate launch reuses the running server');
  const git=(args,cwd=scratch)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-b','main']);git(['config','user.name','LabelPro Test']);git(['config','user.email','test@labelpro.invalid']);
  git(['add','.']);git(['commit','-m','test initial version']);
  const remote=join(scratch,'.runtime','test-origin.git');git(['init','--bare',remote]);git(['remote','add','origin',remote]);git(['push','-u','origin','main']);
  const editor=join(scratch,'.runtime','test-editor');git(['clone',remote,editor]);git(['checkout','main'],editor);git(['config','user.name','LabelPro Test'],editor);git(['config','user.email','test@labelpro.invalid'],editor);
  const {writeFileSync}=await import('node:fs');writeFileSync(join(editor,'test-update-marker.txt'),'verified update fixture');git(['add','.'],editor);git(['commit','-m','test newer version'],editor);git(['push','origin','main'],editor);
  const update=await(await fetch(base+'/api/update',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();assert(update.ok);
  let applied=false;for(let i=0;i<600;i++){const h=await health();if(h?.worker.ready&&h.pid!==first.pid&&existsSync(join(scratch,'test-update-marker.txt'))){applied=true;break;}await wait(200);}assert(applied,'prepared update did not finish');
  console.log('✓ update prepares dependencies separately, applies fast-forward and restarts');
  const beforeRestart=await ready();
  const restart=await(await fetch(base+'/api/runtime/restart',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();assert(restart.ok);
  let changed=false;for(let i=0;i<100;i++){const h=await health();if(h?.worker.ready&&h.pid!==beforeRestart.pid){changed=true;break;}await wait(200);}assert(changed);console.log('✓ restart replaces server and worker');
  await launch('-Stop');for(let i=0;i<100;i++){if(!await health())break;await wait(100);}assert.equal(await health(),null);console.log('✓ hidden stop closes the managed runtime');
  console.log('Windows launcher tests passed. No real customer database or printer was used.');
}catch(error){console.error(error.stack);for(const name of ['launcher.log','runtime.log']){const file=join(scratch,'data',name);if(existsSync(file))console.error(readFileSync(file,'utf8').slice(-5000));}process.exitCode=1;}
finally{
  try{await launch('-Stop');}catch{}
  await wait(500);
  const h=await health();
  if(!h)rmSync(scratch,{recursive:true,force:true});else console.error('Temporary test runtime is still running at '+base+'; preserved '+scratch);
}
