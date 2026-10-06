const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
const paragraph = (value, cls = '') => value ? `<p class="${cls}">${escapeHtml(value)}</p>` : '';
export function labelMarkup(job = {}, sender = job) {
  const message = `**** ${job.message || 'มีเอกสารค่ะ'} ****`;
  return `<article class="label"><div class="label-frame"><div class="label-message">${escapeHtml(message)}</div>
    <div class="label-main"><div class="label-content">
      ${paragraph('ผู้ส่ง: ' + (sender.sender_name || '-'), 'sender-name')}
      ${paragraph(sender.sender_phone ? 'เบอร์โทร ' + sender.sender_phone : '')}
      ${paragraph(sender.sender_address)}${paragraph(sender.sender_address_extra)}
      <hr><p class="recipient">ผู้รับ</p>${paragraph(job.place_name || '— เลือกลูกค้า —', 'place')}
      ${paragraph(job.attention_name, 'attention')}${paragraph(job.address)}${paragraph('ติดต่อ: ' + (job.contact || '-'), 'contact')}
    </div></div><div class="label-message">${escapeHtml(message)}</div></div></article>`;
}
export async function fitLabel() {
  await document.fonts.ready;
  const main = document.querySelector('.label-main'), content = document.querySelector('.label-content');
  for (let size = 1; size >= 0.74; size -= 0.02) {
    main.style.setProperty('--size', size.toFixed(2));
    if (content.scrollHeight <= main.clientHeight + 1) return true;
  }
  return false;
}
export function previewDocument(job, sender) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><link rel="stylesheet" href="/label.css"></head><body>${labelMarkup(job, sender)}<script type="module">import {fitLabel} from '/label-template.js'; if(!await fitLabel()){document.querySelector('.label-content').innerHTML='<p class="label-error">ข้อความยาวเกินฉลาก กรุณาย่อที่อยู่ก่อนสั่งพิมพ์</p>';}</script></body></html>`;
}
