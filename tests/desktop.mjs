import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
if(process.platform!=='win32')process.exit(0);
const scratch=mkdtempSync(join(tmpdir(),'Label Pro Max Local ทางลัด '));
const desktop=join(scratch,'Desktop'),startup=join(scratch,'Startup');
const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
const base=`http://127.0.0.1:${port}`;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env,PORT:String(port),PRINT_DRIVER:'mock',LABELPRO_AUTO_BACKUP:'0',LABELPRO_DB:join(scratch,'data','ทดสอบ.db')};
async function health(){try{return await(await fetch(base+'/api/health')).json();}catch{return null;}}
try {
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/install-desktop.ps1')],{env:{...process.env,LABELPRO_DESKTOP_DIR:desktop,LABELPRO_STARTUP_DIR:startup},windowsHide:true});
  const ps=`$s=New-Object -ComObject WScript.Shell; @($s.CreateShortcut($env:TEST_DESKTOP),$s.CreateShortcut($env:TEST_STARTUP)) | Select-Object TargetPath,Arguments,IconLocation,WorkingDirectory | ConvertTo-Json`;
  const links=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',ps],{env:{...process.env,TEST_DESKTOP:join(desktop,'Label Pro Max Local.lnk'),TEST_STARTUP:join(startup,'Label Pro Max Local.lnk')},encoding:'utf8',windowsHide:true}));
  assert(links.every(x=>x.TargetPath.toLowerCase().endsWith('wscript.exe')));
  assert(links.every(x=>x.IconLocation.endsWith('labelpro-transparent.ico,0')));
  assert(links[1].Arguments.endsWith('/startup'));
  assert(links.every(x=>x.WorkingDirectory.toLowerCase()===resolve('.').toLowerCase()));
  console.log('Desktop and startup shortcuts verified in isolated folders; hidden launcher and current logo selected.');
  execFileSync('wscript.exe',[resolve('start-label-pro-max-local.vbs'),'/startup'],{env,windowsHide:true});
  let ready=false;
  for(let i=0;i<1200;i++){if((await health())?.worker.ready){ready=true;break;}await wait(250);}
  assert(ready,'Startup VBS failed to start the isolated service');
  console.log('Startup VBS starts server and worker with isolated data and mock printer.');
} finally {
  if(await health())await fetch(base+'/api/runtime/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  for(let i=0;i<100;i++){if(!await health())break;await wait(100);}
  await wait(500);
  assert(resolve(scratch).startsWith(resolve(tmpdir())));rmSync(scratch,{recursive:true,force:true});
}
