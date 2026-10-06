import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { gzipSync,gunzipSync } from 'node:zlib';
import { backupRemote,downloadGithubBackup } from '../server/github-backup.mjs';
assert.equal(backupRemote('https://github.com/team/backups.git'),'git@github.com:team/backups.git');
assert.equal(backupRemote('git@github.com:team/backups.git'),'git@github.com:team/backups.git');
for(const url of ['file:///tmp/repo','https://example.com/team/repo','git@github.com:team/repo;bad'])assert.throws(()=>backupRemote(url));
let scratch;const archive=gzipSync('CREATE TABLE customers(id INTEGER);');
const run=async(command,args,options)=>{
  assert.equal(command,'git');scratch=options.cwd;
  assert(options.env.GIT_SSH_COMMAND.includes('BatchMode=yes'));
  if(args[0]==='ls-tree')return {stdout:'label-pro-max-local-backup-2025-01-01.sql.gz\nlabelpro-backup-2026-01-01.sql.gz\nunsafe.txt\n'};
  if(args[0]==='show'){assert.equal(args[1],'FETCH_HEAD:labelpro-backup-2026-01-01.sql.gz');return {stdout:archive};}
  return {stdout:''};
};
const result=await downloadGithubBackup('https://github.com/team/backups',run);
assert.equal(result.name,'labelpro-backup-2026-01-01.sql.gz');
assert(gunzipSync(result.data).toString().includes('CREATE TABLE'));assert(!existsSync(scratch));
await assert.rejects(()=>downloadGithubBackup('https://github.com/team/backups',async(_c,_a,o)=>{scratch=o.cwd;throw Object.assign(new Error('git failed'),{stderr:'Repository not found'});}),/SSH key/);
assert(!existsSync(scratch));
console.log('Backup URL validation, latest archive selection, binary transfer, SSH failure and temporary cleanup passed.');
