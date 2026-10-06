// server/label-pdf.mjs — เรนเดอร์ฉลาก 100×150 มม. เป็น PDF (สำหรับพิมพ์ผ่าน Windows driver)
//
// ปัญหาที่แก้: pdfkit ไม่ทำ Thai shaping (สระบน/ล่าง วรรณยุกต์ จะหลุดตำแหน่ง)
// → โมดูลนี้จัดวางสระ/วรรณยุกต์เองแบบง่าย (cluster: พยัญชนะ + เครื่องหมายตามหลัง
//   วาดทับกึ่งกลางพยัญชนะ) ซึ่งเพียงพอสำหรับข้อความบนฉลาก
// เลย์เอาต์อิงเทมเพลตเดิม (LabelPrintService ของ WPF):
//   **** ข้อความ **** → ผู้ส่ง → เส้นคั่น → ผู้รับ(ชื่อสถานที่ใหญ่→ชื่อลูกค้า→ที่อยู่→ติดต่อ) → **** ข้อความ ****
//
// ฟอนต์: บน Windows ใช้ Tahoma (มีไทย+ละตินครบ ติดมากับ Windows)
// นอก Windows (เช่นตอนเทสบน Linux) fallback เป็น Helvetica — ส่ง fonts ผ่าน opts ได้
import PDFDocument from 'pdfkit';
import * as fontkit from 'fontkit';
import { existsSync } from 'node:fs';

// ---- หน้ากระดาษ 100×150 มม. (72pt = 1 นิ้ว) ----
export const LABEL_W_PT = 283.47;
export const LABEL_H_PT = 425.2;

// เครื่องหมายสระ/วรรณยุกต์ที่ต้องจัดวางเหนือ-ใต้พยัญชนะ (ไม่มี advance ของตัวเอง)
const ABOVE = new Set([0x0E31, 0x0E34, 0x0E35, 0x0E36, 0x0E37, 0x0E47, 0x0E48, 0x0E49, 0x0E4A, 0x0E4B, 0x0E4C, 0x0E4D, 0x0E4E]);
const BELOW = new Set([0x0E38, 0x0E39, 0x0E3A]);
const isMark = (cp) => ABOVE.has(cp) || BELOW.has(cp);

// แตกข้อความเป็น cluster: [อักษรหลัก + เครื่องหมายตามหลัง] (สระ เ- แ- โ- ใ- ไ- อยู่หน้า
// พยัญชนะตามลำดับ logical อยู่แล้ว วาดตามลำดับได้เลยไม่ต้องสลับ)
function clusterize(text) {
  const clusters = [];
  let cur = null;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (isMark(cp) && cur) cur.marks.push({ ch, cp, above: ABOVE.has(cp) });
    else { cur = { base: ch, cp, marks: [] }; clusters.push(cur); }
  }
  return clusters;
}

// ---- ฟอนต์ ----
export function resolveLabelFonts() {
  if (process.platform === 'win32') {
    const reg = 'C:\\Windows\\Fonts\\tahoma.ttf';
    const bold = 'C:\\Windows\\Fonts\\tahomabd.ttf';
    if (existsSync(reg)) return { regular: reg, bold: existsSync(bold) ? bold : reg };
  }
  return { regular: null, bold: null }; // → Helvetica fallback (ไม่มีไทย ใช้กัน crash นอก Windows)
}

// แบ่งบรรทัดแบบ greedy ตาม cluster (ตัดที่ช่องว่างก่อน ถ้าคำยาวเกินค่อยตัดกลางคำ —
// ภาษาไทยตัดบรรทัดกลางคำได้อยู่แล้ว)
function wrapClusters(clusters, maxW, advOf) {
  const lines = [];
  let i = 0;
  while (i < clusters.length) {
    let w = 0, j = i, lastSpace = -1;
    while (j < clusters.length) {
      const cw = advOf(clusters[j]);
      if (w + cw > maxW) break;
      w += cw;
      if (clusters[j].base === ' ') lastSpace = j;
      j++;
    }
    if (j >= clusters.length) { lines.push(clusters.slice(i)); break; }
    if (lastSpace >= i) { lines.push(clusters.slice(i, lastSpace)); i = lastSpace + 1; }
    else { if (j === i) j = i + 1; lines.push(clusters.slice(i, j)); i = j; }
  }
  return lines;
}

// วาดย่อหน้า (รองรับ \n) แบบจัดกึ่งกลาง คืนค่า y ของบรรทัดถัดไป
function drawPara(p, text, cx, y, maxW, size, bold) {
  p.size = size; // ต้องตั้งก่อน wrap — ความกว้างบรรทัดขึ้นกับ size
  const paras = String(text).split('\n');
  for (const para of paras) {
    if (!para.trim()) { y += size * 0.7; continue; }
    const clusters = clusterize(para);
    const lines = p.fk ? wrapClusters(clusters, maxW, (c) => p.adv(c.cp, bold)) : [clusters];
    for (const line of lines) {
      y = p.drawLine(line, cx, y, maxW, size, bold);
    }
  }
  return y;
}

function makePainter(doc, fonts) {
  const shaped = !!(fonts.fkReg && fonts.fkBold);
  const fkOf = (bold) => (bold ? fonts.fkBold : fonts.fkReg);
  const nameOf = (bold) => (bold ? fonts.boldName : fonts.regName);
  const p = {
    fk: shaped,
    size: 12,
    adv(cp, bold) {
      const fk = fkOf(bold);
      if (!fk) return 0;
      return (fk.glyphForCodePoint(cp).advanceWidth * this.size) / fk.unitsPerEm;
    },
    markBox(cp, bold) {
      const fk = fkOf(bold);
      const g = fk.glyphForCodePoint(cp);
      const s = this.size / fk.unitsPerEm;
      return { w: Math.max(0, g.bbox.maxX - g.bbox.minX) * s };
    },
    drawLine(line, cx, y, maxW, size, bold) {
      this.size = size;
      const fontName = nameOf(bold);
      if (!shaped) {
        // fallback: ไม่มี fontkit (Helvetica) — วาดธรรมดา ไม่จัด shaping
        doc.font(fontName).fontSize(size);
        const s = line.map((c) => c.base + c.marks.map((m) => m.ch).join('')).join('');
        doc.text(s, cx - maxW / 2, y, { width: maxW, align: 'center', lineBreak: false });
        return y + size * 1.3;
      }
      const widths = line.map((c) => this.adv(c.cp, bold));
      const lineW = widths.reduce((a, b) => a + b, 0);
      let x = cx - lineW / 2;
      doc.font(fontName).fontSize(size);
      line.forEach((c, k) => {
        doc.text(c.base, x, y, { lineBreak: false });
        let aStack = 0, bStack = 0;
        for (const m of c.marks) {
          const mw = this.markBox(m.cp, bold).w;
          const mx = x + (widths[k] - mw) / 2;
          let my = y;
          if (m.above) { my = y - aStack * size * 0.45; aStack++; }
          else { my = y + bStack * size * 0.45; bStack++; }
          doc.text(m.ch, mx, my, { lineBreak: false });
        }
        x += widths[k];
      });
      return y + size * 1.45;
    },
  };
  p.drawPara = (text, cx, y, maxW, size, bold) => drawPara(p, text, cx, y, maxW, size, bold);
  return p;
}

// job: แถวจาก print_jobs | sender: {sender_name, sender_phone, sender_address, sender_address_extra}
// opts.fonts: {regular, bold} path ฟอนต์ (สำหรับเทส) — ไม่ส่ง = resolve อัตโนมัติ
export function renderLabelPdf(job, sender = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const W = LABEL_W_PT, H = LABEL_H_PT, M = 14;
      const doc = new PDFDocument({
        size: [W, H], margin: 0,
        info: { Title: `LabelPro #${job.id || ''} ${job.place_name || ''}`, Creator: 'LabelPro Local' },
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const f = opts.fonts || resolveLabelFonts();
      let fonts;
      if (f.regular) {
        doc.registerFont('lbl-reg', f.regular);
        doc.registerFont('lbl-bold', f.bold || f.regular);
        fonts = {
          regName: 'lbl-reg', boldName: 'lbl-bold',
          fkReg: fontkit.openSync(f.regular), fkBold: fontkit.openSync(f.bold || f.regular),
        };
      } else {
        fonts = { regName: 'Helvetica', boldName: 'Helvetica-Bold', fkReg: null, fkBold: null };
      }
      const p = makePainter(doc, fonts);

      const cx = W / 2;
      const left = M + 8, right = W - M - 8;
      const maxW = right - left;
      const msg = job.message || '';
      const val = (v) => (v == null ? '' : String(v).trim());

      // กรอบนอก
      doc.lineWidth(2).rect(M, M, W - M * 2, H - M * 2).stroke();

      let y = M + 14;

      // หัว: **** ข้อความ ****
      y = p.drawPara(`**** ${msg} ****`, cx, y, maxW, 18, true);
      y += 8;

      // บล็อกผู้ส่ง
      const sName = val(sender.sender_name), sPhone = val(sender.sender_phone);
      const sAddr = val(sender.sender_address), sExtra = val(sender.sender_address_extra);
      if (sName) y = p.drawPara(`ผู้ส่ง: ${sName}`, cx, y, maxW, 12, true);
      if (sPhone) y = p.drawPara(`เบอร์โทร ${sPhone}`, cx, y, maxW, 12, false);
      if (sAddr) y = p.drawPara(sAddr, cx, y, maxW, 12, false);
      if (sExtra) y = p.drawPara(sExtra, cx, y, maxW, 12, false);
      if (!sName && !sPhone && !sAddr && !sExtra) y = p.drawPara('ผู้ส่ง: -', cx, y, maxW, 12, true);
      y += 6;

      // เส้นคั่น
      doc.lineWidth(1.5).moveTo(left + 12, y).lineTo(right - 12, y).stroke();
      y += 10;

      // บล็อกผู้รับ (v3: ชื่อสถานที่ตัวใหญ่ → ชื่อลูกค้า → ที่อยู่ → ติดต่อ)
      y = p.drawPara('ผู้รับ', cx, y, maxW, 16, true);
      y += 2;
      const place = val(job.place_name) || '-';
      y = p.drawPara(place, cx, y, maxW, 18, true);
      y += 2;
      const attn = val(job.attention_name);
      if (attn) y = p.drawPara(attn, cx, y, maxW, 13, true);
      const addr = val(job.address);
      if (addr) y = p.drawPara(addr, cx, y, maxW, 12.5, false);
      const contact = val(job.contact);
      y = p.drawPara(`ติดต่อ: ${contact || '-'}`, cx, y, maxW, 12, false);

      // ท้าย: **** ข้อความ **** (ตรึงด้านล่างแบบเทมเพลตเดิม)
      p.drawPara(`**** ${msg} ****`, cx, H - M - 34, maxW, 18, true);

      doc.end();
    } catch (e) { reject(e); }
  });
}
