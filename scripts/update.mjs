// Prepare everything in isolation. Supervisor stops children before applying the prepared update.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../server/paths.mjs';
const execute = promisify(execFile);
const options = { cwd:ROOT, windowsHide:true, timeout:240000, env:{...process.env,GIT_TERMINAL_PROMPT:'0'}, maxBuffer:8*1024*1024 };
const git = async (args) => (await execute('git',args,options)).stdout.trim();
let stage;
try {
  if(await git(['status','--porcelain'])) throw new Error('มีไฟล์แก้ไขในโปรเจค กรุณาบันทึกงานหรือจัดการไฟล์ก่อนอัปเดต');
  const before=await git(['rev-parse','HEAD']);
  const upstream=await git(['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}']);
  await git(['fetch','origin']);
  const target=await git(['rev-parse',upstream]);
  if(before===target){console.log('เป็นเวอร์ชันล่าสุดแล้ว');process.exit(0);}
  await git(['merge-base','--is-ancestor',before,target]);
  stage=join(ROOT,'.runtime','update-'+randomUUID()); await mkdir(dirname(stage),{recursive:true});
  await git(['clone','--shared','--no-checkout',ROOT,stage]);
  await execute('git',['checkout','--detach',target],{...options,cwd:stage});
  const npmCli=join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  await execute(process.execPath,[npmCli,'ci','--no-audit','--no-fund'],{...options,cwd:stage});
  await execute(process.execPath,[join(stage,'node_modules','playwright','cli.js'),'install','chromium','--only-shell'],{...options,cwd:stage});
  await execute(process.execPath,[join(stage,'scripts','check-setup.mjs')],{...options,cwd:stage});
  const manifest=join(stage,'labelpro-update.json');
  await writeFile(manifest,JSON.stringify({before,target,stage}));
  console.log('LABELPRO_UPDATE_READY='+manifest);
}catch(error){
  if(stage)await rm(stage,{recursive:true,force:true}).catch(()=>{});
  console.error('อัปเดตไม่สำเร็จ ระบบเดิมยังใช้งานได้: '+error.message);process.exitCode=1;
}
