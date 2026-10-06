import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execute=promisify(execFile);
export function backupRemote(value){
  const match=String(value).trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if(!match)throw new Error('กรุณาตั้งค่า repository สำรองบน GitHub ให้ถูกต้อง');
  return `git@github.com:${match[1]}/${match[2]}.git`;
}
export async function downloadGithubBackup(remote, run=execute){
  const url=backupRemote(remote);
  const scratch=await mkdtemp(join(tmpdir(),'label-pro-max-local-download-'));
  const options={cwd:scratch,windowsHide:true,timeout:120000,maxBuffer:128*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_SSH_COMMAND:'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'}};
  try{
    await run('git',['init','--bare','.'],options);
    await run('git',['fetch','--depth=1',url,'refs/heads/main'],options);
    const {stdout}=await run('git',['ls-tree','--name-only','FETCH_HEAD'],options);
    const files=stdout.split(/\r?\n/).filter(name=>/^(labelpro|label-pro-max-local)-backup-.*\.sql\.gz$/.test(name)).sort().reverse();
    if(!files.length)throw new Error('ไม่พบไฟล์สำรอง .sql.gz ใน repository');
    // Sort by the timestamp, independent of the historical product prefix.
    files.sort((a,b)=>b.split('-backup-')[1].localeCompare(a.split('-backup-')[1]));
    const name=files[0];
    const result=await run('git',['show',`FETCH_HEAD:${name}`],{...options,encoding:'buffer'});
    return {name,data:result.stdout};
  }catch(error){
    if(error.message.startsWith('ไม่พบ'))throw error;
    if(String(error.stderr||'').includes('Repository not found'))throw new Error('SSH key ของเครื่องนี้ไม่มีสิทธิ์อ่าน repository สำรอง หรือ URL ไม่ถูกต้อง กรุณาให้ผู้ดูแลตั้งสิทธิ์อ่าน repository สำรอง');
    throw new Error('ดาวน์โหลดไม่สำเร็จ กรุณาตรวจ URL, สิทธิ์ SSH และการยืนยัน github.com บนเครื่องนี้');
  }finally{await rm(scratch,{recursive:true,force:true});}
}
