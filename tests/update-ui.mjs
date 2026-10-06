import assert from 'node:assert/strict';
import express from 'express';
import { chromium } from 'playwright';
import { once } from 'node:events';
import { resolve } from 'node:path';
const app=express();app.use(express.static(resolve('web')));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({serviceWorkers:'block'});page.setDefaultTimeout(8000);let mode='restart',started=false,polls=0,reloads=0;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())reloads++;});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data={ok:true,printers:[],customers:[],favorites:[],jobs:[],stats:{waiting:0,done_today:0,failed:0,done_copies_total:0},failed_ids:[],settings:{},sender:{},version:'0.3.0',managed:true,worker:{ready:true,driver:'mock'}};
    if(path==='/api/update'&&route.request().method()==='POST'){started=true;data={ok:true,started:true};}
    else if(path==='/api/update'){
      polls++;
      if(mode==='restart'&&polls===2)return route.abort();
      data=mode==='failed'?{ok:false,running:false,message:'ทดสอบดาวน์โหลดล้มเหลว'}:mode==='latest'?{ok:true,running:false,message:'เป็นเวอร์ชันล่าสุดแล้ว'}:polls<4?{ok:true,running:polls===1,restarting:polls===3,target:'new',message:'กำลังดาวน์โหลด'}:{ok:null,running:false,message:''};
    }else if(path==='/api/health'){
      if(mode==='restart'&&started&&polls===2)return route.abort();
      const updated=mode==='restart'&&started&&polls>=4;
      Object.assign(data,{app_id:'same',pid:updated?2:1,revision:updated?'new':'old'});
    }
    await route.fulfill({json:data});
  });
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);await page.locator('[data-view="settings"]').click();
  await page.locator('#updateNow').click();await page.locator('#updateProgressModal.open').waitFor();
  await page.locator('#toast').filter({hasText:'อัปเดตสำเร็จ พร้อมใช้งานแล้ว'}).waitFor({timeout:20000});
  assert(reloads>=2);assert.deepEqual(errors,[]);
  assert(!await page.locator('#updateProgressModal').evaluate(el=>el.classList.contains('open')));
  console.log('Restart disconnection stays in progress, checks revision/readiness, and reloads automatically.');
  for(const current of ['failed','latest']){
    mode=current;started=false;polls=0;await page.goto(base);
    await page.locator('[data-view="settings"]').click();await page.locator('#updateNow').click();
    await page.locator('#updateStatus').filter({hasText:current==='failed'?'ทดสอบดาวน์โหลดล้มเหลว':'เป็นเวอร์ชันล่าสุดแล้ว'}).waitFor();
    assert(!await page.locator('#updateProgressModal').evaluate(el=>el.classList.contains('open')));assert(await page.locator('#updateNow').isEnabled());
  }
  console.log('Failed preparation and up-to-date cases release the progress screen.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

