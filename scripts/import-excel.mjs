// scripts/import-excel.mjs — ย้ายข้อมูลลูกค้าออกจาก Excel เข้า SQLite (รันครั้งเดียวตอนเริ่มใช้)
// ใช้: node scripts/import-excel.mjs <ไฟล์.xlsx>
// อ่านชีตชื่อ "PrintLabel" ตามฟอร์แมตจริงของร้าน (4 คอลัมน์):
//   A=ชื่อสถานที่ B=กรุณาส่ง C=ที่อยู่ D=ติดต่อ
// - ตรวจจับแถวหัวตารางอัตโนมัติ (แถวที่มีคำว่า "ชื่อสถานที่") แล้วข้าม
// - ข้ามแถวที่ A ว่าง
import { readFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { db } from '../server/db.mjs';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('ใช้: node scripts/import-excel.mjs <ไฟล์.xlsx>');
  process.exit(1);
}

// หมายเหตุ: xlsx build แบบ ESM ไม่มี XLSX.readFile → อ่านเป็น buffer แล้วใช้ XLSX.read แทน
const wb = XLSX.read(readFileSync(file));
const sheet = wb.Sheets['PrintLabel'];
if (!sheet) {
  console.error('ไม่พบชีตชื่อ "PrintLabel" ในไฟล์');
  process.exit(1);
}
// header:1 → ได้ array แถว ๆ (รวมแถวหัวตาราง — จะตรวจจับแล้วข้ามเอง)
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

const insert = db.prepare(
  'INSERT INTO customers (place_name, attention_name, address, contact) VALUES (?, ?, ?, ?)'
);
let added = 0, skipped = 0;
const tx = db.transaction((list) => {
  for (const r of list) {
    const place = String(r[0] ?? '').trim();
    // ข้ามแถวหัวตาราง (มีคำว่า "ชื่อสถานที่") และแถวที่ A ว่าง
    if (!place || place.includes('ชื่อสถานที่')) { skipped++; continue; }
    insert.run(
      place,
      String(r[1] ?? '').trim(), // กรุณาส่ง
      String(r[2] ?? '').trim(), // ที่อยู่
      String(r[3] ?? '').trim()  // ติดต่อ (ข้อความอิสระ เก็บดิบ ๆ)
    );
    added++;
  }
});
tx(rows);

console.log(`นำเข้าเสร็จ: เพิ่ม ${added} ราย, ข้าม ${skipped} แถว (หัวตาราง/ชื่อสถานที่ว่าง)`);
console.log('Excel ต้นฉบับไม่ถูกแตะต้อง — เก็บไฟล์ไว้เป็น backup อย่างเดียวก็พอ');
