import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { ROOT } from '../server/paths.mjs';
const git=(args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:60000}).trim();
const manifest=JSON.parse(readFileSync(process.argv[2],'utf8'));
const stage=resolve(manifest.stage), allowed=join(ROOT,'.runtime');
const rel=relative(allowed,stage);
if(!rel.startsWith('update-')||rel.includes('..')||rel.includes('/')||rel.includes('\\'))throw new Error('พาธอัปเดตไม่ถูกต้อง');
if(git(['status','--porcelain'])||git(['rev-parse','HEAD'])!==manifest.before)throw new Error('โปรเจคเปลี่ยนระหว่างเตรียมอัปเดต');
git(['merge-base','--is-ancestor',manifest.before,manifest.target]);
const modules=join(ROOT,'node_modules'),old=join(stage,'previous-node_modules');
let moved=false, installed=false;
try{
  if(existsSync(modules)){renameSync(modules,old);moved=true;}
  renameSync(join(stage,'node_modules'),modules);
  installed=true;
  git(['merge','--ff-only',manifest.target]);
  console.log('อัปเดตและเตรียม dependency สำเร็จ');
}catch(error){
  if(installed && existsSync(modules))renameSync(modules,join(stage,'failed-node_modules'));
  if(moved)renameSync(old,modules);
  throw error;
}
// Keep a recoverable staged checkout; maintenance can remove it later.
