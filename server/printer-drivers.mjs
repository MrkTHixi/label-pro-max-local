import { mkdir, mkdtemp, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { getSetting } from './db.mjs';
import { APP_ID } from './paths.mjs';
import { renderLabelPdf } from './label-pdf.mjs';
import { listWindowsPrinters } from './windows-printers.mjs';
const require = createRequire(import.meta.url), execute = promisify(execFile);
export const PRINT_TEMP = process.env.LABELPRO_PRINT_TEMP || join(tmpdir(), 'labelpro-print-' + APP_ID);
export async function cleanupStalePrintFiles(directory = PRINT_TEMP, maxAge = 24 * 60 * 60 * 1000) {
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory)) {
    if (!name.startsWith('job-')) continue;
    const path = join(directory, name);
    if ((await stat(path)).mtimeMs < Date.now() - maxAge) await rm(path, { recursive: true, force: true });
  }
}
export class MockDriver { async print() {} }
export function resolvePrinterName() {
  const name = (process.env.PRINTER_NAME || getSetting('printer_name')).trim();
  if (!name) throw new Error('ยังไม่ได้ตั้งชื่อเครื่องพิมพ์ กรุณาเปิดหน้า ตั้งค่า และกรอกชื่อให้ตรงกับ Windows');
  return name;
}
export async function sendWindowsPdf(path, options) {
  const printers=await listWindowsPrinters();
  const printer=printers.find((p)=>p.name===options.printer);
  if(!printer)throw new Error('ไม่พบชื่อเครื่องพิมพ์ที่ตั้งไว้ กรุณาเลือกชื่อจากรายการในหน้า ตั้งค่า');
  if(printer.offline)throw new Error('เครื่องพิมพ์อยู่ในโหมด offline กรุณาตรวจสาย USB และสถานะใน Windows');
  let binary;
  try { binary = join(dirname(require.resolve('pdf-to-printer')), 'SumatraPDF-3.4.6-32.exe'); }
  catch { throw new Error('ไม่พบโปรแกรมส่งพิมพ์ กรุณาเปิด start-labelpro.vbs เพื่อเตรียมระบบ'); }
  if (!existsSync(binary)) throw new Error('ไม่พบ SumatraPDF กรุณาติดตั้ง dependency ใหม่');
  await execute(binary, ['-print-to', options.printer, '-silent', '-print-settings', `noscale,${options.copies}x`, path], { windowsHide: true, timeout: 120_000 });
}
export class WindowsPdfDriver {
  constructor({ render = renderLabelPdf, send = sendWindowsPdf, printer = resolvePrinterName, tempDir = PRINT_TEMP } = {}) { Object.assign(this, { render, send, printer, tempDir }); }
  async print(job) {
    const printer = this.printer(), pdf = await this.render(job, job);
    await mkdir(this.tempDir, { recursive: true });
    const directory = await mkdtemp(join(this.tempDir, `job-${job.id}-`));
    try {
      const path = join(directory, 'label.pdf'); await writeFile(path, pdf);
      await this.send(path, { printer, copies: Math.min(20, Math.max(1, Math.floor(Number(job.copies) || 1))) });
    } catch (error) { throw new Error(`ส่งงานไป "${printer}" ไม่สำเร็จ: ${error.message}`); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}
export function resolveDriverName() {
  const name = (process.env.PRINT_DRIVER || '').toLowerCase();
  if (name && !['mock','windows'].includes(name)) throw new Error('PRINT_DRIVER ต้องเป็น mock หรือ windows');
  return name || (process.platform === 'win32' ? 'windows' : 'mock');
}
export function makeDriver() { return resolveDriverName() === 'windows' ? new WindowsPdfDriver() : new MockDriver(); }
