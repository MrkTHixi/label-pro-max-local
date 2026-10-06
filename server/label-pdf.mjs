import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';
import { labelMarkup, fitLabel } from '../web/label-template.js';
export const LABEL_W_PT = 100 * 72 / 25.4;
export const LABEL_H_PT = 150 * 72 / 25.4;
let pendingBrowser;
export async function getLabelBrowser() {
  if (!pendingBrowser) pendingBrowser = chromium.launch({ headless: true }).catch((error) => {
    pendingBrowser = null;
    throw new Error('ตัวสร้างฉลากยังไม่พร้อม กรุณาเปิด start-labelpro.vbs เพื่อเตรียมระบบ: ' + error.message);
  });
  const browser = await pendingBrowser;
  if (!browser.isConnected()) { pendingBrowser = null; return getLabelBrowser(); }
  return browser;
}
export async function closeLabelBrowser() {
  const pending = pendingBrowser; pendingBrowser = null;
  if (pending) await (await pending.catch(() => null))?.close();
}
const css = readFileSync(join(ROOT, 'web', 'label.css'), 'utf8').replace(/url\('\/fonts\/([^']+)'\)/g, (_match, name) => `url('data:font/woff2;base64,${readFileSync(join(ROOT, 'web', 'fonts', name)).toString('base64')}')`);
export async function renderLabelPdf(job, sender = job) {
  const browser = await getLabelBrowser(), page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><html lang="th"><head><meta charset="utf-8"><style>${css}</style></head><body>${labelMarkup(job, sender)}</body></html>`);
    if (!await page.evaluate(fitLabel)) throw new Error('ข้อความยาวเกินฉลาก กรุณาย่อชื่อหรือที่อยู่ก่อนสั่งพิมพ์');
    const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
    // Chromium rounds CSS page sizes to pixels. Normalize the PDF box to exact millimetres.
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() !== 1) throw new Error('ฉลากเกินหนึ่งหน้า กรุณาย่อข้อความก่อนสั่งพิมพ์');
    pdf.getPage(0).setSize(LABEL_W_PT, LABEL_H_PT);
    return Buffer.from(await pdf.save({ useObjectStreams: false }));
  } finally { await page.close(); }
}
