// server/printer-drivers.mjs — PrinterDriver ทั้งหมดของ print worker
//
// โมเดลเครื่องพิมพ์ของผู้ใช้: Grozziie TP518 (thermal 4x6"/100x150mm, 203dpi, USB)
// → เป็นเครื่องแบบ "Windows-driver-based" ไม่มีภาษา TSPL/ZPL ให้ส่งตรง
//   จึงพิมพ์ผ่าน driver ของ Windows: เรนเดอร์ฉลากเป็น PDF (100×150mm เป๊ะ)
//   แล้วส่งเข้า print spooler แบบเงียบด้วย pdf-to-printer (SumatraPDF)
//   (โครง TsplDriver เดิมถูกลบออก — เครื่องรุ่นนี้ไม่รองรับ TSPL)
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getSetting, ROOT } from './db.mjs';
import { renderLabelPdf } from './label-pdf.mjs';

const PRINTED_DIR = join(ROOT, 'printed');
mkdirSync(PRINTED_DIR, { recursive: true });

// ============================================================================
// MockDriver: เขียนฉลากเป็นไฟล์ .txt ลง printed/ (dev/test บนเครื่องที่ไม่มี printer)
// ============================================================================
export class MockDriver {
  async print(job) {
    const msg = job.message || '';
    const lines = [
      '================ ฉลากพัสดุ 100x150 มม. (MOCK) ================',
      `งาน #${job.id}  วันที่: ${job.created_at}`,
      '',
      `**** ${msg} ****`,
      `ผู้ส่ง: ${job.sender_name || '-'}`,
      `เบอร์โทร ${job.sender_phone || '-'}`,
      `${job.sender_address || ''}`,
      `${job.sender_address_extra || ''}`,
      '------------------------------------------------',
      'ผู้รับ',
      `${job.place_name || '-'}`,
      `${job.attention_name || ''}`,
      `${job.address || ''}`,
      '',
      `ติดต่อ: ${job.contact || '-'}`,
      `**** ${msg} ****`,
      '',
      `จำนวน: ${job.copies} ใบ`,
      `พิมพ์โดย: ${job.printed_by || '-'}`,
      '================================================',
    ];
    const fname = `job-${String(job.id).padStart(5, '0')}.txt`;
    writeFileSync(join(PRINTED_DIR, fname), lines.join('\n'), 'utf8');
  }
}

// ============================================================================
// WindowsPdfDriver: เรนเดอร์ PDF → ส่งพิมพ์เงียบผ่าน Windows print spooler
// ใช้บน PC ที่ต่อเครื่องพิมพ์ (ค่าเริ่มต้นบน win32)
// ============================================================================

// ลำดับการหาชื่อเครื่องพิมพ์: env PRINTER_NAME → settings.printer_name → error ภาษาไทย
export function resolvePrinterName() {
  const fromEnv = (process.env.PRINTER_NAME || '').trim();
  if (fromEnv) return fromEnv;
  const fromDb = String(getSetting('printer_name') || '').trim();
  if (fromDb) return fromDb;
  throw new Error(
    'ยังไม่ได้ตั้งชื่อเครื่องพิมพ์ — เปิดหน้า "ตั้งค่า" แล้วเลือกจากรายการเครื่องพิมพ์ ' +
    '(หรือตั้ง env PRINTER_NAME)'
  );
}

// แปลง error ตอนสั่งพิมพ์เป็นข้อความภาษาไทยพร้อมวิธีแก้
// (worker เก็บข้อความนี้ลงคอลัมน์ error → โชว์ในหน้าคิวงาน)
// export ไว้ให้ smoke test เรียกตรง ๆ
export function mapPrintFailure(printerName, fname, rawErr) {
  const raw = String(rawErr?.message ?? rawErr ?? '');
  const low = raw.toLowerCase();
  const nameMentioned = printerName && low.includes(String(printerName).toLowerCase());
  const looksLikeBadName = /not found|invalid|cannot find|could not find|no printer|unknown printer|failed to (open|find)/i.test(raw);
  const spoolerDead = /enoent|spawn|econnrefused|eacces/i.test(low);
  let hint;
  if (nameMentioned || looksLikeBadName) {
    hint = `ชื่อเครื่องพิมพ์ไม่ตรง — เปิดหน้า "ตั้งค่า" แล้วเลือกจากรายการ (ตอนนี้ตั้งไว้ว่า "${printerName}")`;
  } else if (spoolerDead) {
    hint = 'ติดต่อตัวสั่งพิมพ์ไม่ได้ — เช็กว่าเครื่องพิมพ์เสียบสาย/เปิดอยู่ แล้วกด "พิมพ์ซ้ำ" ในหน้าคิวงาน';
  } else {
    hint = 'เช็กว่าเครื่องพิมพ์เปิดอยู่ กระดาษไม่ติด แล้วกด "พิมพ์ซ้ำ" ในหน้าคิวงาน';
  }
  return `สั่งพิมพ์ไป "${printerName}" ไม่สำเร็จ (เก็บไฟล์ ${fname} ไว้ตรวจสอบ)\n💡 ${hint}\nรายละเอียด: ${raw.slice(0, 400)}`;
}

export class WindowsPdfDriver {
  async print(job, sender) {
    const printerName = resolvePrinterName(); // โยน error ภาษาไทยถ้ายังไม่ตั้ง
    // 1) เรนเดอร์ฉลากเป็น PDF 100×150mm เป๊ะ
    const pdf = await renderLabelPdf(job, sender || {});
    const fname = `job-${String(job.id).padStart(5, '0')}.pdf`;
    const pdfPath = join(PRINTED_DIR, fname);
    writeFileSync(pdfPath, pdf);
    // 2) ส่งพิมพ์เงียบ (lazy import — pdf-to-printer เป็น optionalDependency เฉพาะ Windows)
    let printFn;
    try {
      const mod = await import('pdf-to-printer');
      printFn = mod.print || mod.default?.print;
      if (typeof printFn !== 'function') throw new Error('no print export');
    } catch (e) {
      throw new Error('ไม่พบ pdf-to-printer — รัน `npm install` บนเครื่อง Windows ก่อน: ' + (e?.message || e));
    }
    try {
      // scale:'noscale' = พิมพ์ขนาดจริงตาม PDF (100×150mm) ไม่ย่อ/ขยายตามกระดาษ
      await printFn(pdfPath, {
        printer: printerName,
        copies: Math.min(20, Math.max(1, Number(job.copies) || 1)),
        scale: 'noscale',
        silent: true,
      });
      rmSync(pdfPath, { force: true }); // สำเร็จแล้วลบไฟล์ temp
    } catch (e) {
      // พิมพ์ล้มเหลว → เก็บ PDF ไว้ดู (debug) แล้วโยน error ภาษาไทยให้ worker mark failed
      throw new Error(mapPrintFailure(printerName, fname, e));
    }
  }
}

// เลือก driver: PRINT_DRIVER=mock บังคับ mock; ค่าเริ่มต้น = windows บน win32, mock ที่อื่น
export function resolveDriverName() {
  const which = (process.env.PRINT_DRIVER || '').toLowerCase();
  if (which === 'mock') return 'mock';
  if (which === 'windows') return 'windows';
  return process.platform === 'win32' ? 'windows' : 'mock';
}

export function makeDriver() {
  return resolveDriverName() === 'windows' ? new WindowsPdfDriver() : new MockDriver();
}
