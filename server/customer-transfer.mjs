import Database from 'better-sqlite3';
export function readCustomerBackup(file){
  const source=new Database(file,{readonly:true,fileMustExist:true});
  try{
    if(source.pragma('integrity_check',{simple:true})!=='ok')throw new Error('ไฟล์สำรองไม่สมบูรณ์');
    if(!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customers'").get())throw new Error('ไม่พบตารางลูกค้าในไฟล์สำรอง');
    const columns=source.prepare('PRAGMA table_info(customers)').all().map(x=>x.name);
    for(const name of ['place_name','attention_name','address','contact','is_active'])if(!columns.includes(name))throw new Error('รูปแบบฐานข้อมูลลูกค้าไม่รองรับ');
    const rows=source.prepare(`SELECT place_name,attention_name,address,contact,is_active,${columns.includes('is_favorite')?'is_favorite':'0 AS is_favorite'} FROM customers`).all();
    if(!rows.length)throw new Error('ไฟล์สำรองไม่มีลูกค้า จึงไม่นำเข้า');
    if(rows.some(row=>typeof row.place_name!=='string'||!row.place_name.trim()))throw new Error('ข้อมูลลูกค้าไม่ถูกต้อง');
    return rows;
  }finally{source.close();}
}
export function replaceCustomers(database,rows){
  return database.transaction(()=>{
    if(database.prepare("SELECT 1 FROM print_jobs WHERE status IN ('queued','printing')").get())throw new Error('กรุณาจัดการงานรอพิมพ์ก่อนนำเข้า');
    database.prepare('UPDATE print_jobs SET customer_id=NULL WHERE customer_id IS NOT NULL').run();
    database.prepare('DELETE FROM customers').run();
    const insert=database.prepare('INSERT INTO customers(place_name,attention_name,address,contact,is_active,is_favorite) VALUES(?,?,?,?,?,?)');
    for(const row of rows)insert.run(row.place_name,row.attention_name||'',row.address||'',row.contact||'',row.is_active?1:0,row.is_favorite?1:0);
    return rows.length;
  }).immediate();
}
