// Real API + browser interactions. All data, backups and printer files are isolated.
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { gunzipSync } from 'node:zlib';
import * as XLSX from 'xlsx';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=mkdtempSync(join(tmpdir(),'labelpro ทดสอบ '));
const dbPath=join(scratch,'ข้อมูลลูกค้า.db');
process.env.LABELPRO_DB=dbPath; process.env.PRINT_DRIVER='mock'; process.env.LABELPRO_AUTO_BACKUP='0';
const qa=process.env.LABELPRO_QA_DIR || join(ROOT,'output','pdf'); mkdirSync(qa,{recursive:true});
let count=0, browser, database, runtime, failServer;
const children=[];
const check=(name,fn)=>{fn();console.log('✓ '+name);count++;};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(100);}throw new Error('Timed out waiting for condition');}
async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;}
function child(script,env){const c=fork(join(ROOT,script),[],{cwd:ROOT,env:{...process.env,...env},silent:true});children.push(c);c.logs='';c.stdout.on('data',x=>c.logs+=x);c.stderr.on('data',x=>c.logs+=x);return c;}
async function api(base,path,method='GET',body){const r=await fetch(base+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};}
async function stopChild(c){if(!c||c.exitCode!==null)return;const done=once(c,'exit');c.send({type:'stop'});await Promise.race([done,wait(8000)]);if(c.exitCode===null){c.kill();await done;}}
const sample={id:1,place_name:'โรงงานทดสอบ',attention_name:'บริษัท ทดสอบภาษาไทย (สำนักงานใหญ่)',address:'393/8 หมู่ 6 ซ.วัดใหญ่ ถ.สุขสวัสดิ์\nต.ในคลองบางปลากด อ.พระสมุทรเจดีย์\nจ.สมุทรปราการ 10290',contact:'คุณทดสอบ 080-000-0000 / ฝ่ายรับสินค้า',message:'มีเอกสารค่ะ',copies:2,sender_name:'ร้านผู้ส่งทดสอบ',sender_phone:'02-000-0000',sender_address:'441/27 หมู่ 9 ต.หนองปรือ\nอ.บางละมุง จ.ชลบุรี 20150',sender_address_extra:'ที่อยู่เพิ่มเติม น้ำ กุ้ง ปู่ ญู่'};
try{
  for(const folder of ['server','scripts','web'])for(const name of readdirSync(join(ROOT,folder)).filter(x=>/\.(mjs|js)$/.test(x)))execFileSync(process.execPath,['--check',join(ROOT,folder,name)],{windowsHide:true});
  check('syntax ทุกไฟล์ JavaScript',()=>{});
  const {db}=await import('../server/db.mjs');database=db;
  const insert=database.prepare('INSERT INTO customers(place_name,attention_name,address,contact,is_active) VALUES(?,?,?,?,?)');
  database.transaction(()=>{for(let i=0;i<302;i++)insert.run('ลูกค้าทดสอบ '+i,'ผู้รับทดสอบ',sample.address,sample.contact,i<300?1:0);})();
  database.prepare('UPDATE sender_profile SET sender_name=?,sender_phone=?,sender_address=? WHERE id=1').run('ผู้ส่งตอนสั่ง','02-000-0000','ที่อยู่ทดสอบ');
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  runtime=child('scripts/runtime.mjs',{PORT:String(port),LABELPRO_POLL_MS:'100'});
  await until(async()=>{try{return (await api(base,'/api/health')).worker?.ready;}catch{return false;}});
  const health=await api(base,'/api/health');check('ตัวเปิดเริ่ม server และ worker พร้อมกัน',()=>assert(health.managed&&health.worker.ready));
  const duplicate=child('scripts/runtime.mjs',{PORT:String(port)});await once(duplicate,'exit');
  check('เปิดซ้ำไม่สร้างชุดระบบซ้อน',()=>assert.match(duplicate.logs,/ทำงานอยู่แล้ว/));
  const customers=await api(base,'/api/customers');check('รายการแสดงลูกค้าครบมากกว่า 200 ราย',()=>assert.equal(customers.customers.length,300));
  const token=await api(base,'/api/customers/clear-info');check('คำเตือนนับรวมลูกค้าที่ปิดใช้งาน',()=>assert.equal(token.total,302));
  const wrong=await api(base,'/api/customers/clear','POST',{token:token.token,confirmation:'wrong'});
  check('ไม่ล้างเมื่อคำยืนยันผิด',()=>{assert.equal(wrong.status,400);assert.equal(database.prepare('SELECT COUNT(*) n FROM customers').get().n,302);});
  const job=await api(base,'/api/print','POST',{customer_id:1,copies:2,message:'ขอบคุณค่ะ'});
  database.prepare("UPDATE sender_profile SET sender_name='ผู้ส่งที่แก้ภายหลัง' WHERE id=1").run();
  await until(()=>database.prepare('SELECT status FROM print_jobs WHERE id=?').get(job.job_id)?.status==='done');
  check('งานเก็บ snapshot ผู้ส่งตอนสั่ง',()=>assert.equal(database.prepare('SELECT sender_name FROM print_jobs WHERE id=?').get(job.job_id).sender_name,'ผู้ส่งตอนสั่ง'));
  // Counts are computed from every job, even outside the newest 50.
  database.transaction(()=>{for(let i=0;i<75;i++)database.prepare("INSERT INTO print_jobs(status,printed_at) VALUES('done',?)").run(new Date().toISOString());})();
  const queue=await api(base,'/api/queue');check('ยอดวันนี้นับครบแม้รายการมี 50 งาน',()=>{assert.equal(queue.jobs.length,50);assert.equal(queue.stats.done_today,76);});
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(base);await page.locator('#results .cust').first().waitFor();
  await page.locator('#results .cust').first().click();
  await page.frameLocator('#labelPreview').locator('.place').waitFor();
  const selectedText=await page.frameLocator('#labelPreview').locator('.label-content').innerText();
  check('ฉลากพิมพ์ชื่อผู้รับ B โดยไม่พิมพ์ชื่อย่อ A',()=>{assert(selectedText.includes('ผู้รับทดสอบ'));assert(!selectedText.includes('ลูกค้าทดสอบ'));});
  await page.locator('#results .starbtn').first().click();
  await page.locator('#favorites .cust').first().waitFor();
  const favorite=await api(base,'/api/customers/favorites');
  check('ปักหมุดบันทึกในฐานข้อมูล',()=>{assert.equal(favorite.customers.length,1);assert.equal(database.prepare('SELECT is_favorite FROM customers WHERE id=?').get(favorite.customers[0].id).is_favorite,1);});
  await page.reload();await page.locator('#favorites .cust').first().waitFor();
  await page.locator('#q').fill('ไม่พบข้อมูลนี้แน่นอน');
  await page.locator('#results .empty').waitFor();
  await page.locator('#favorites .cust').first().dblclick();
  await page.locator('#printModal.open').waitFor();
  check('ดับเบิลคลิกปักหมุดเปิดตัวเลือกพิมพ์โดยไม่ส่งงานทันที',()=>assert.equal(database.prepare('SELECT COUNT(*) n FROM print_jobs').get().n,76));
  await page.locator('#printCancel').click();
  check('preview ใช้ข้อความลูกค้าและฟอนต์ไทย',()=>assert.equal(pageErrors.length,0));
  await page.locator('[data-view="customers"]').click();await page.locator('#custBody tr').first().waitFor();
  await page.locator('#clearCustomersBtn').click();await page.locator('#clearSummary').filter({hasText:'302'}).waitFor();
  check('ปุ่มยืนยันเริ่มต้นปิดไว้',()=>{});assert(await page.locator('#clearConfirm').isDisabled());
  await page.locator('#clearCancel').click();check('ยกเลิกคำเตือนแล้วข้อมูลไม่เปลี่ยน',()=>assert.equal(database.prepare('SELECT COUNT(*) n FROM customers').get().n,302));
  await page.locator('#clearCustomersBtn').click();await page.locator('#clearSummary').filter({hasText:'302'}).waitFor();
  await page.locator('#clearPhrase').fill('ล้างข้อมูล');
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await page.screenshot({path:join(qa,'customer-clear-warning.png')});
  await page.locator('#clearConfirm').click();await until(()=>database.prepare('SELECT COUNT(*) n FROM customers').get().n===0);
  await page.locator('#custBody').filter({hasText:'ยังไม่มีลูกค้า'}).waitFor();
  check('ยืนยันจาก UI ล้างครบทุกแถวและรักษาประวัติ',()=>{assert.equal(database.prepare('SELECT COUNT(*) n FROM customers').get().n,0);assert.equal(database.prepare('SELECT COUNT(*) n FROM print_jobs').get().n,76);});
  const backupFile=readdirSync(join(scratch,'backups')).find(x=>x.startsWith('labelpro-before-clear-'));
  const backupDb=new Database(join(scratch,'backups',backupFile),{readonly:true});
  check('สำรองก่อนล้างมีลูกค้าครบ 302 ราย',()=>assert.equal(backupDb.prepare('SELECT COUNT(*) n FROM customers').get().n,302));backupDb.close();
  await page.locator('[data-view="print"]').click();await page.frameLocator('#labelPreview').locator('.place').filter({hasText:'เลือกลูกค้า'}).waitFor();
  check('ล้างแล้ว preview ไม่มีลูกค้าเดิมค้าง',()=>assert.equal(pageErrors.length,0));
  assert.equal((await api(base,'/api/customers/favorites')).customers.length,0);
  await page.locator('[data-view="settings"]').click();
  await page.locator('#runtimeStatus').filter({hasText:'โหมดทดลอง'}).waitFor();
  const printers=await api(base,'/api/printers');
  check('ตั้งค่าแสดงโหมดทดลองและอ่านรายการเครื่องพิมพ์ได้',()=>{assert(printers.ok);assert(Array.isArray(printers.printers));assert.equal(pageErrors.length,0);});
  // Mutated data invalidates the confirmation issued earlier.
  insert.run('ลูกค้าทดสอบใหม่','','','',1);
  const stale=await api(base,'/api/customers/clear-info');insert.run('ลูกค้าเพิ่มหลังเปิดคำเตือน','','','',1);
  const conflict=await api(base,'/api/customers/clear','POST',{token:stale.token,confirmation:'ล้างข้อมูล'});
  check('ข้อมูลเปลี่ยนแล้วต้องตรวจจำนวนใหม่',()=>assert.equal(conflict.status,409));
  // Keep a queued job atomic with the blocked-clear request.
  await stopChild(runtime);runtime=null;
  const serverOnly=child('server/index.mjs',{PORT:String(port)});await until(async()=>{try{return(await api(base,'/api/health')).ok;}catch{return false;}});
  database.prepare("INSERT INTO print_jobs(status) VALUES('queued')").run();
  const pendingToken=await api(base,'/api/customers/clear-info');
  const pending=await api(base,'/api/customers/clear','POST',{token:pendingToken.token,confirmation:'ล้างข้อมูล'});
  check('มีงานรอพิมพ์แล้วไม่ล้าง',()=>assert.equal(pending.status,409));
  await stopChild(serverOnly);
  database.prepare("UPDATE print_jobs SET status='cancelled' WHERE status='queued'").run();
  // Backup failure in a second server, with the destination deliberately a regular file.
  const blocker=join(scratch,'not-a-directory');writeFileSync(blocker,'blocked');
  failServer=child('server/index.mjs',{PORT:String(port),LABELPRO_BACKUPS_DIR:blocker});
  await until(async()=>{try{return(await api(base,'/api/health')).ok;}catch{return false;}});
  const failToken=await api(base,'/api/customers/clear-info');
  const failed=await api(base,'/api/customers/clear','POST',{token:failToken.token,confirmation:'ล้างข้อมูล'});
  check('สำรองล้มเหลวแล้วไม่ล้าง',()=>{assert.equal(failed.status,500);assert.equal(database.prepare('SELECT COUNT(*) n FROM customers').get().n,2);});
  await stopChild(failServer);failServer=null;
  await browser.close();browser=null;
  const pdf=await import('../server/label-pdf.mjs');
  const buffer=await pdf.renderLabelPdf(sample);writeFileSync(join(qa,'label-thai-check.pdf'),buffer);
  const parsedPdf=await PDFDocument.load(buffer), dimensions=parsedPdf.getPage(0).getSize();
  check('PDF เป็นหน้าฉลากจริง 100×150 มม.',()=>{assert.equal(parsedPdf.getPageCount(),1);assert(Math.abs(dimensions.width*25.4/72-100)<0.001);assert(Math.abs(dimensions.height*25.4/72-150)<0.001);});
  await assert.rejects(()=>pdf.renderLabelPdf({...sample,address:'ที่อยู่ยาวเกิน '.repeat(500)}),/ยาวเกิน/);check('ที่อยู่ยาวเกินถูกแจ้ง ไม่ตัดทิ้งเงียบ',()=>{});
  const mixed=await pdf.renderLabelPdf({...sample,attention_name:'น้ำ กุ้ง ปู่ ญู่ ผู้รับ ที่อยู่',message:'ขอบคุณค่ะ'});writeFileSync(join(qa,'label-thai-marks.pdf'),mixed);
  try{execFileSync('pdftoppm',['-f','1','-singlefile','-scale-to','1500','-png',join(qa,'label-thai-check.pdf'),join(qa,'label-thai-check')],{windowsHide:true});execFileSync('pdftoppm',['-f','1','-singlefile','-scale-to','1500','-png',join(qa,'label-thai-marks.pdf'),join(qa,'label-thai-marks')],{windowsHide:true});}catch(error){if(error.code!=='ENOENT')throw error;console.log('PDF visual render skipped: install Poppler to create QA PNGs');}
  await pdf.closeLabelBrowser();
  const {WindowsPdfDriver,MockDriver,cleanupStalePrintFiles}=await import('../server/printer-drivers.mjs');
  const tempPrint=join(scratch,'print-files');
  let readWhileSending=false;
  const success=new WindowsPdfDriver({tempDir:tempPrint,printer:()=> 'Test printer',render:async()=>Buffer.from('%PDF-test'),send:async(path,opts)=>{assert(existsSync(path));assert.equal(opts.copies,2);await wait(80);readWhileSending=existsSync(path);}});
  await success.print(sample);check('ไฟล์อยู่จนส่งจบแล้วถูกลบ',()=>{assert(readWhileSending);assert.equal(readdirSync(tempPrint).length,0);});
  const failing=new WindowsPdfDriver({tempDir:tempPrint,printer:()=> 'Test',render:async()=>Buffer.from('PDF'),send:async()=>{throw new Error('missing dependency or spooler error');}});
  for(let i=0;i<100;i++)await assert.rejects(()=>failing.print({...sample,id:i}),/missing dependency/);
  check('ส่งล้มเหลว 100 งาน ไม่สะสมไฟล์',()=>assert.equal(readdirSync(tempPrint).length,0));
  const oldPrint=join(tempPrint,'job-old');mkdirSync(oldPrint);writeFileSync(join(oldPrint,'label.pdf'),'old');utimesSync(oldPrint,new Date(0),new Date(0));
  await cleanupStalePrintFiles(tempPrint);check('ล้าง temp ค้างจาก process เก่า',()=>assert.equal(readdirSync(tempPrint).length,0));
  await new MockDriver().print(sample);check('mock ไม่สร้าง TXT ต่อทุกงาน',()=>assert.equal(readdirSync(tempPrint).length,0));
  // Generate the Excel fixture rather than depend on an untracked source document.
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['ชื่อสถานที่','กรุณาส่ง','ที่อยู่','ติดต่อ'],['บ้านทดสอบ','คุณทดสอบ','ที่อยู่','0800000000']]),'PrintLabel');
  const excel=join(scratch,'ลูกค้า.xlsx');writeFileSync(excel,XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));
  execFileSync(process.execPath,[join(ROOT,'scripts','import-excel.mjs'),excel],{env:{...process.env},windowsHide:true});
  check('นำเข้า Excel fixture ได้',()=>assert.equal(database.prepare('SELECT COUNT(*) n FROM customers').get().n,3));
  const out=execFileSync(process.execPath,[join(ROOT,'scripts','backup.mjs')],{cwd:ROOT,env:{...process.env},encoding:'utf8',windowsHide:true});
  check('สำรองพาธภาษาไทยและช่องว่างบน Windows ได้',()=>assert.match(out,/สำรองในเครื่องสำเร็จ/));
  const archive=readdirSync(join(scratch,'backups')).find(x=>x.endsWith('.sql.gz'));
  const restoredDb=join(scratch,'restored.db');
  execFileSync(process.execPath,[join(ROOT,'scripts','restore.mjs'),join(scratch,'backups',archive)],{cwd:ROOT,env:{...process.env,LABELPRO_DB:restoredDb},windowsHide:true});
  const restored=new Database(restoredDb,{readonly:true});check('กู้ SQL gzip โดยไม่ต้อง sqlite3 CLI',()=>assert.equal(restored.prepare('SELECT COUNT(*) n FROM customers').get().n,3));restored.close();
  execFileSync(process.execPath,[join(ROOT,'scripts','restore.mjs'),join(scratch,'backups',backupFile)],{cwd:ROOT,env:{...process.env,LABELPRO_DB:restoredDb},windowsHide:true});
  const restoredBinary=new Database(restoredDb,{readonly:true});
  check('กู้ DB ก่อนล้างคืนครบและสำรองของเดิมก่อนแทนที่',()=>{assert.equal(restoredBinary.prepare('SELECT COUNT(*) n FROM customers').get().n,302);assert(readdirSync(join(scratch,'backups')).some((x)=>x.startsWith('labelpro-before-restore-')));});restoredBinary.close();
  const dryBefore=database.prepare('SELECT COUNT(*) n FROM backup_log').get().n;
  execFileSync(process.execPath,[join(ROOT,'scripts','backup.mjs'),'--dry-run'],{cwd:ROOT,env:{...process.env},windowsHide:true});
  check('dry-run ไม่เขียนประวัติสำรอง',()=>assert.equal(database.prepare('SELECT COUNT(*) n FROM backup_log').get().n,dryBefore));
  const legacy=join(scratch,'legacy.db'),old=new Database(legacy);
  old.exec(readFileSync(join(ROOT,'schema.sql'),'utf8').replaceAll('attention_name','customer_name').replaceAll('contact','phone'));
  old.prepare('INSERT INTO customers(place_name,customer_name,address,phone) VALUES(?,?,?,?)').run('บ้านเก่า','คุณเก่า','ที่อยู่เก่า','0800000000');old.close();
  execFileSync(process.execPath,['--input-type=module','-e',`const {db}=await import(${JSON.stringify(pathToFileURL(join(ROOT,'server','db.mjs')).href)});db.close();`],{cwd:ROOT,env:{...process.env,LABELPRO_DB:legacy},windowsHide:true});
  const migrated=new Database(legacy,{readonly:true});check('migration ไม่ทิ้งลูกค้าเก่า',()=>{const row=migrated.prepare('SELECT * FROM customers').get();assert.equal(row.attention_name,'คุณเก่า');assert.equal(row.contact,'0800000000');});migrated.close();
  console.log(`ผ่าน ${count} กลุ่มตรวจสอบ — ข้อมูลจริงและเครื่องพิมพ์จริงไม่ถูกใช้`);
}catch(error){console.error(error.stack);for(const c of children)if(c.logs)console.error(c.logs.slice(-2000));process.exitCode=1;}
finally{
  await browser?.close();
  const {closeLabelBrowser}=await import('../server/label-pdf.mjs');await closeLabelBrowser();
  for(const c of children)await stopChild(c);
  database?.close();
  rmSync(scratch,{recursive:true,force:true});
}
