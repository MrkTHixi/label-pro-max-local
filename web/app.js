// web/app.js — Label Pro Max Local frontend (vanilla JS, ไม่ต้อง build)
// โฟลว์หลัก: ค้นหา (ชื่อสถานที่) → ดับเบิลคลิกเปิด popup ตัวเลือกการพิมพ์
// → สั่งพิมพ์ → popup สำเร็จ (กลางจอ + คำอวยพรตามวันจริง)
import { previewDocument } from './label-template.js';
const $ = (id) => document.getElementById(id);
async function request(path, method = 'GET', body) {
  try {
    const response = await fetch(path, { method, ...(body !== undefined ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {}) });
    return await response.json();
  } catch { return {ok:false,message:'ติดต่อระบบไม่ได้ กรุณาเปิด start-label-pro-max-local.vbs แล้วลองใหม่'}; }
}
const api = {
  get: (p) => request(p),
  post: (p, body = {}) => request(p, 'POST', body),
  put: (p, body = {}) => request(p, 'PUT', body),
  del: (p) => request(p, 'DELETE'),
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg, isErr = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- navigation (ปุ่มด้านบนทั้งหมด) ----------
document.querySelectorAll('.top-actions .btn').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.screen').forEach((x) => x.classList.remove('active'));
    $('view-' + b.dataset.view).classList.add('active');
    document.querySelectorAll('.top-actions .btn').forEach((x) => {
      x.classList.remove('btn-primary'); x.classList.add('btn-ghost');
    });
    b.classList.add('btn-primary'); b.classList.remove('btn-ghost');
    window.scrollTo({ top: 0 });
    if (b.dataset.view === 'queue') loadQueue();
    if (b.dataset.view === 'customers') loadCustomers();
    if (b.dataset.view === 'settings') loadSettings();
  });
});

// ---------- พิมพ์ฉลาก: ค้นหา ----------
let customersCache = [];   // ผลค้นหาล่าสุด
let selectedCustomer = null;
let senderPreview = {}, dataGeneration = 0, searchSequence = 0, listSequence = 0;

let searchTimer;
let favoritesSequence=0;
function starButton(c) { return `<button class="starbtn" aria-label="${c.is_favorite?'เลิกปักหมุด':'ปักหมุด'} ${esc(c.place_name)}" aria-pressed="${!!c.is_favorite}" title="ปักหมุดที่อยู่ที่ใช้บ่อย">${c.is_favorite?'★':'☆'}</button>`; }
async function toggleFavorite(c,button) {
  button.disabled=true;
  const result=await api.put(`/api/customers/${c.id}/favorite`,{favorite:!c.is_favorite});
  if(!result.ok){button.disabled=false;toast(result.message,true);return;}
  await Promise.all([loadFavorites(),searchCustomers($('q').value),loadCustomers()]);
}
async function loadFavorites() {
  const sequence=++favoritesSequence,generation=dataGeneration;
  const d=await api.get('/api/customers/favorites');
  if(sequence!==favoritesSequence||generation!==dataGeneration)return;
  const box=$('favorites');
  if(!d.ok){box.textContent='โหลดรายการปักหมุดไม่สำเร็จ';return;}
  box.innerHTML=d.customers.length?d.customers.map(c=>`<div class="cust" data-id="${c.id}" title="ดับเบิลคลิกเพื่อเปิดตัวเลือกพิมพ์">${starButton(c)}<b>${esc(c.place_name)}</b><button class="pbtn" title="เปิดตัวเลือกพิมพ์">🖨️</button></div>`).join(''):'<div class="sub">กดดาวข้างชื่อลูกค้าเพื่อปักหมุด · ดับเบิลคลิกเพื่อเปิดตัวเลือกพิมพ์</div>';
  box.querySelectorAll('.cust').forEach(el=>bindCustomer(el,d.customers.find(c=>c.id===Number(el.dataset.id))));
}
function bindCustomer(el,c) {
  el.addEventListener('click',e=>{if(!e.target.closest('button'))selectCustomer(c);});
  el.addEventListener('dblclick',e=>{if(!e.target.closest('button'))openPrintModal(c);});
  el.querySelector('.pbtn').addEventListener('click',e=>{e.stopPropagation();openPrintModal(c);});
  el.querySelector('.starbtn').addEventListener('click',e=>{e.stopPropagation();toggleFavorite(c,e.currentTarget);});
}
$('q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchCustomers(e.target.value), 250);
});

async function searchCustomers(q) {
  const sequence = ++searchSequence, generation = dataGeneration;
  const d = await api.get('/api/customers?q=' + encodeURIComponent(q || ''));
  if (sequence !== searchSequence || generation !== dataGeneration) return;
  const box = $('results');
  if (!d.ok) { box.innerHTML = '<div class="empty">โหลดไม่สำเร็จ</div>'; return; }
  customersCache = d.customers;
  if (!d.customers.length) {
    box.innerHTML = '<div class="empty">ไม่พบลูกค้า — ลองค้นหาด้วยชื่อย่ออื่น หรือเพิ่มลูกค้าใหม่ในหน้า 👥 ลูกค้า</div>';
    return;
  }
  box.innerHTML = d.customers.map((c) => `
    <div class="cust" data-id="${c.id}">
      ${starButton(c)}
      <button class="pbtn" title="สั่งพิมพ์ (จอสัมผัส)">🖨️</button>
      <span class="place">📍 ${esc(c.place_name)}</span>
      <span class="who">${esc(c.attention_name || '')}${c.contact ? ' · ' + esc(c.contact) : ''}</span>
      <span class="go">ดับเบิลคลิกเพื่อเปิดตัวเลือกการพิมพ์ »</span>
    </div>`).join('');
  box.querySelectorAll('.cust').forEach((el) => {
    const id = Number(el.dataset.id);
    const c = d.customers.find((x) => x.id === id);
    bindCustomer(el,c);
  });
}

function selectCustomer(c) {
  selectedCustomer = c;
  document.querySelectorAll('#results .cust').forEach((el) =>
    el.classList.toggle('sel', Number(el.dataset.id) === c.id));
  updatePreview(c);
}

function updatePreview(c) {
  $('labelPreview').srcdoc = previewDocument({ ...(c || {}), message: msg }, senderPreview);
}

async function loadSenderPreview() {
  const d = await api.get('/api/sender');
  if (!d.ok) return;
  senderPreview = d.sender || {};
  updatePreview(selectedCustomer);
}

// ---------- POPUP: ตัวเลือกการพิมพ์ ----------
let qty = 1, msg = 'มีเอกสารค่ะ', modalCustomer = null;
function renderQty() {
  qty = Math.min(20, Math.max(1, qty));
  $('qty').textContent = qty;
  $('confirmBtn').textContent = `🖨️ สั่งพิมพ์ ${qty} ใบ`;
}
function openPrintModal(c) {
  modalCustomer = c;
  selectedCustomer = c;
  document.querySelectorAll('#results .cust').forEach((el) =>
    el.classList.toggle('sel', Number(el.dataset.id) === c.id));
  updatePreview(c);
  $('m-sub').innerHTML = `📍 <b>${esc(c.place_name)}</b> · ${esc(c.attention_name || '')}`;
  document.querySelectorAll('.msgbtn').forEach((x) => x.classList.toggle('sel', x.dataset.msg === 'มีเอกสารค่ะ'));
  msg = 'มีเอกสารค่ะ';
  updatePreview(c);
  qty = 1; renderQty();
  $('printModal').classList.add('open');
}
function closePrintModal() { $('printModal').classList.remove('open'); }
document.querySelectorAll('.msgbtn').forEach((b) => {
  b.addEventListener('click', () => {
    msg = b.dataset.msg;
    updatePreview(selectedCustomer);
    document.querySelectorAll('.msgbtn').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
  });
});
$('qMinus').addEventListener('click', () => { qty--; renderQty(); });
$('qPlus').addEventListener('click', () => { qty++; renderQty(); });
document.querySelectorAll('.qbtn').forEach((b) =>
  b.addEventListener('click', () => { qty += Number(b.dataset.add); renderQty(); }));
$('qReset').addEventListener('click', () => { qty = 1; renderQty(); });
$('printX').addEventListener('click', closePrintModal);
$('printCancel').addEventListener('click', closePrintModal);
$('printModal').addEventListener('click', (e) => { if (e.target.id === 'printModal') closePrintModal(); });

// ---------- สั่งพิมพ์ → POPUP สำเร็จ ----------
$('confirmBtn').addEventListener('click', async () => {
  if ($('confirmBtn').disabled) return;
  if (!modalCustomer) { toast('❌ กรุณาเลือกลูกค้าก่อน', true); return; }
  const customer = modalCustomer, message = msg, copies = qty;
  $('confirmBtn').disabled = true;
  const d = await api.post('/api/print', {
    customer_id: customer.id,
    message,
    copies,
    printed_by: $('m_by').value.trim(),
  });
  $('confirmBtn').disabled = false;
  closePrintModal();
  if (!d.ok) { toast('❌ ' + (d.message || 'สั่งพิมพ์ไม่สำเร็จ'), true); return; }
  showSuccess(customer.place_name, message, copies);
  loadQueueBadge();
});

const DAY_EMOJI = ['🌤️', '🌤️', '🌤️', '🌤️', '🌤️', '🎉', '🛋️'];
const DAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
async function showSuccess(place, message, copies) {
  // คำอวยพร + ชื่อวัน อ่านสดจาก server (blessings.json ใน repo — git pull แล้วเปลี่ยนทันที)
  let list = ['ขอบคุณที่ใช้งานค่ะ'], dayText = '';
  try {
    const d = await api.get('/api/blessings');
    if (d.ok) {
      if (Array.isArray(d.blessings) && d.blessings.length) list = d.blessings;
      dayText = d.greeting || '';
    }
  } catch { /* ใช้ค่าเริ่มต้น */ }
  const d = new Date().getDay();
  $('s-detail').textContent = `📍 ${place} · ${message} · ${copies} ใบ — เข้าคิวพิมพ์แล้ว`;
  $('s-day').textContent = dayText || `สวัสดีวัน${DAY_NAMES[d]} ${DAY_EMOJI[d]}`;
  $('s-bless').textContent = list[Math.floor(Math.random() * list.length)];
  $('successModal').classList.add('open');
  let left = 5;
  const el = $('s-count');
  el.textContent = `ปิดอัตโนมัติใน ${left} วินาที`;
  clearInterval(window._sTimer);
  window._sTimer = setInterval(() => {
    left--;
    if (left <= 0) { closeSuccess(); return; }
    el.textContent = `ปิดอัตโนมัติใน ${left} วินาที`;
  }, 1000);
}
function closeSuccess() {
  clearInterval(window._sTimer);
  $('successModal').classList.remove('open');
}
$('successOk').addEventListener('click', closeSuccess);
$('successModal').addEventListener('click', (e) => { if (e.target.id === 'successModal') closeSuccess(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePrintModal(); closeSuccess(); closeCustModal(); }
});

// ---------- คิวงานพิมพ์ ----------
const STATUS = {
  queued: ['⏳ รอพิมพ์', 'p-wait'],
  printing: ['🖨️ กำลังพิมพ์', 'p-run'],
  done: ['✅ ส่งงานพิมพ์แล้ว', 'p-done'],
  failed: ['❌ ล้มเหลว', 'p-fail'],
  cancelled: ['🚫 ยกเลิกแล้ว', 'p-cancel'],
};
const selectedFailedJobs=new Set();
let failedJobIds=[],clearFailedBusy=false;
function updateFailedSelection(){
  const count=selectedFailedJobs.size;
  $('failedSelectionCount').textContent=`เลือก ${count} งาน จากงานล้มเหลว/ยกเลิก ${failedJobIds.length} งาน`;
  $('clearFailedJobs').disabled=!count||clearFailedBusy;
  $('selectAllFailed').disabled=!failedJobIds.length||clearFailedBusy;
  $('selectAllFailed').checked=!!failedJobIds.length&&count===failedJobIds.length;
  $('selectAllFailed').indeterminate=count>0&&count<failedJobIds.length;
  document.querySelectorAll('.failed-job-select').forEach(input=>{input.checked=selectedFailedJobs.has(Number(input.dataset.id));input.disabled=clearFailedBusy;});
}
$('selectAllFailed').addEventListener('change',()=>{
  selectedFailedJobs.clear();
  if($('selectAllFailed').checked)failedJobIds.forEach(id=>selectedFailedJobs.add(id));
  updateFailedSelection();
});
$('clearFailedJobs').addEventListener('click',async()=>{
  if(clearFailedBusy||!selectedFailedJobs.size)return;
  const ids=[...selectedFailedJobs];
  if(!confirm(`ลบประวัติงานล้มเหลวหรือยกเลิกที่เลือก ${ids.length} งานถาวร?\nงานสำเร็จ งานรอพิมพ์ และยอดรวมจำนวนใบจะยังอยู่`))return;
  clearFailedBusy=true;updateFailedSelection();
  const result=await api.post('/api/queue/clear-failed',{ids,confirmation:'ล้างงานล้มเหลว'});
  clearFailedBusy=false;
  if(result.ok){selectedFailedJobs.clear();toast(`ล้างงานล้มเหลว/ยกเลิก ${result.deleted} งานแล้ว`);}
  else toast(result.message,true);
  await loadQueue();loadQueueBadge();
});
async function loadQueue() {
  const d = await api.get('/api/queue');
  const tb = $('queueBody');
  if (!d.ok) { tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted)">โหลดไม่สำเร็จ</td></tr>'; return; }
  $('stWait').textContent = d.stats.waiting;
  $('stDone').textContent = d.stats.done_today;
  $('stFail').textContent = d.stats.failed;
  $('stTotalCopies').textContent = Number(d.stats.done_copies_total||0).toLocaleString('th-TH');
  failedJobIds=d.clearable_ids||d.failed_ids||[];
  for(const id of selectedFailedJobs)if(!failedJobIds.includes(id))selectedFailedJobs.delete(id);
  updateFailedSelection();
  if (!d.jobs.length) {
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted)">ยังไม่มีงานพิมพ์</td></tr>';
    return;
  }
  tb.innerHTML = d.jobs.map((j) => {
    const [label, cls] = STATUS[j.status] || [j.status, 'p-wait'];
    const time = new Date(j.created_at).toLocaleString('th-TH', { timeZone:'Asia/Bangkok', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    const acts = [];
    acts.push(`<a class="mini" href="/api/queue/${j.id}/pdf" download title="ดาวน์โหลดไฟล์ฉลากเมื่อต้องการ">PDF</a>`);
    if (j.status === 'queued') acts.push(`<button class="mini" data-act="cancel" data-id="${j.id}">ยกเลิก</button>`);
    if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled') acts.push(`<button class="mini" data-act="reprint" data-id="${j.id}">พิมพ์ซ้ำ</button>`);
    return `<tr>
      <td>${['failed','cancelled'].includes(j.status)?`<input type="checkbox" class="failed-job-select" data-id="${j.id}" aria-label="เลือกงาน ${j.id}" ${selectedFailedJobs.has(j.id)?'checked':''}>`:'—'}</td>
      <td style="white-space:nowrap">${esc(time)}</td>
      <td><b>📍 ${esc(j.place_name || '')}</b><br><span class="muted" style="font-size:12.5px">${esc(j.attention_name || '')}</span></td>
      <td>${esc(j.message || '—')}</td>
      <td>${j.copies} ใบ</td>
      <td>${esc(j.printed_by || '—')}</td>
      <td><span class="pill ${cls}">${label}</span>${j.status === 'failed' && j.error ? `<div class="muted" style="font-size:12px">${esc(j.error)}</div>` : ''}</td>
      <td style="white-space:nowrap">${acts.join('')}</td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('.failed-job-select').forEach(input=>input.addEventListener('change',()=>{const id=Number(input.dataset.id);if(input.checked)selectedFailedJobs.add(id);else selectedFailedJobs.delete(id);updateFailedSelection();}));
  updateFailedSelection();
  tb.querySelectorAll('[data-act]').forEach((b) => {
    const id = Number(b.dataset.id);
    if (b.dataset.act === 'cancel') b.addEventListener('click', async () => {
      if (!confirm('ยกเลิกงานพิมพ์นี้?')) return;
      const r = await api.post(`/api/queue/${id}/cancel`);
      if (r.ok) { toast('ยกเลิกงานแล้ว'); loadQueue(); loadQueueBadge(); }
      else toast('❌ ' + r.message, true);
    });
    if (b.dataset.act === 'reprint') b.addEventListener('click', async () => {
      const j = d.jobs.find((x) => x.id === id);
      const r = await api.post('/api/print', {
        customer_id: null,
        message: j.message, copies: j.copies, printed_by: $('m_by').value.trim(),
        snapshot: { place_name: j.place_name, attention_name: j.attention_name, address: j.address, contact: j.contact },
      });
      if (r.ok) { showSuccess(j.place_name, j.message || '—', j.copies); loadQueue(); loadQueueBadge(); }
      else toast('❌ ' + r.message, true);
    });
  });
}
async function loadQueueBadge() {
  const d = await api.get('/api/queue');
  if (!d.ok) return;
  const n = d.stats.waiting;
  const b = $('queueBadge');
  b.textContent = n;
  b.classList.toggle('hidden', n === 0);
}
setInterval(() => {
  if ($('view-queue').classList.contains('active')) loadQueue();
  loadQueueBadge();
}, 5000);

// ---------- ลูกค้า ----------
async function loadCustomers() {
  const sequence = ++listSequence, generation = dataGeneration;
  const q = $('custQ').value.trim();
  const d = await api.get('/api/customers?q=' + encodeURIComponent(q));
  if (sequence !== listSequence || generation !== dataGeneration) return;
  const tb = $('custBody');
  if (!d.ok) { tb.innerHTML = '<tr><td colspan="5" style="text-align:center">โหลดไม่สำเร็จ</td></tr>'; return; }
  $('customerCount').textContent = `ลูกค้าที่ใช้งานทั้งหมด ${d.total} ราย · แสดง ${d.customers.length} ราย`;
  if (!d.customers.length) {
    tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted)">ยังไม่มีลูกค้า — กด “➕ เพิ่มลูกค้าใหม่” หรือ “📥 นำเข้า Excel”</td></tr>';
    return;
  }
  tb.innerHTML = d.customers.map((c) => `<tr>
    <td><b>📍 ${esc(c.place_name)}</b></td>
    <td>${esc(c.attention_name || '—')}</td>
    <td>${esc(c.address || '—')}</td>
    <td>${esc(c.contact || '—')}</td>
    <td style="white-space:nowrap">
      <button class="mini" data-act="favorite" data-id="${c.id}" aria-pressed="${!!c.is_favorite}" title="ปักหมุดที่อยู่ที่ใช้บ่อย">${c.is_favorite?'★':'☆'}</button>
      <button class="mini" data-act="print" data-id="${c.id}">🖨️</button>
      <button class="mini" data-act="edit" data-id="${c.id}">✏️</button>
      <button class="mini" data-act="del" data-id="${c.id}">🗑️</button>
    </td></tr>`).join('');
  tb.querySelectorAll('[data-act]').forEach((b) => {
    const id = Number(b.dataset.id);
    const c = d.customers.find((x) => x.id === id);
    if (b.dataset.act === 'favorite') b.addEventListener('click', () => toggleFavorite(c,b));
    if (b.dataset.act === 'edit') b.addEventListener('click', () => openCustModal(c));
    if (b.dataset.act === 'print') b.addEventListener('click', () => openPrintModal(c));
    if (b.dataset.act === 'del') b.addEventListener('click', async () => {
      if (!confirm(`ปิดใช้งาน “${c.place_name}”? (ข้อมูลไม่ถูกลบถาวร)`)) return;
      const r = await api.del('/api/customers/' + id);
      if (r.ok) { toast('ปิดใช้งานแล้ว'); if(selectedCustomer?.id===c.id){ selectedCustomer=null; modalCustomer=null; updatePreview(null); } loadFavorites(); loadCustomers(); searchCustomers($('q').value); }
      else toast('❌ ' + r.message, true);
    });
  });
}
let custTimer;
$('custQ').addEventListener('input', () => {
  clearTimeout(custTimer);
  custTimer = setTimeout(loadCustomers, 250);
});
function openCustModal(c) {
  $('custDialogTitle').textContent = c ? '✏️ แก้ไขลูกค้า' : '➕ เพิ่มลูกค้าใหม่';
  $('c_id').value = c?.id || '';
  $('c_place').value = c?.place_name || '';
  $('c_attention').value = c?.attention_name || '';
  $('c_address').value = c?.address || '';
  $('c_contact').value = c?.contact || '';
  $('custModal').classList.add('open');
}
function closeCustModal() { $('custModal').classList.remove('open'); }
$('addCustomerBtn').addEventListener('click', () => openCustModal(null));
$('custX').addEventListener('click', closeCustModal);
$('custCancel').addEventListener('click', closeCustModal);
$('custModal').addEventListener('click', (e) => { if (e.target.id === 'custModal') closeCustModal(); });
$('custSave').addEventListener('click', async () => {
  const body = {
    place_name: $('c_place').value.trim(),
    attention_name: $('c_attention').value.trim(),
    address: $('c_address').value.trim(),
    contact: $('c_contact').value.trim(),
  };
  if (!body.place_name) { toast('❌ กรุณากรอกชื่อสถานที่', true); return; }
  const id = $('c_id').value;
  const r = id ? await api.put('/api/customers/' + id, body) : await api.post('/api/customers', body);
  if (r.ok) { closeCustModal(); toast('💾 บันทึกแล้ว'); loadFavorites(); loadCustomers(); searchCustomers($('q').value); }
  else toast('❌ ' + (r.message || 'บันทึกไม่สำเร็จ'), true);
});

// ---------- นำเข้า Excel ----------
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  toast('📥 กำลังนำเข้าไฟล์ ' + f.name + ' ...');
  try {
    const r = await fetch('/api/import-excel', { method: 'POST', body: fd });
    const d = await r.json();
    if (d.ok) {
      toast(`✅ นำเข้าเสร็จ: เพิ่ม ${d.added} ราย${d.skipped ? `, ข้าม ${d.skipped} แถว` : ''}`);
      loadCustomers(); searchCustomers($('q').value);
    } else toast('❌ ' + (d.message || 'นำเข้าไม่สำเร็จ'), true);
  } catch (err2) {
    toast('❌ อัปโหลดไม่สำเร็จ: ' + String(err2.message || err2), true);
  }
});

// ---------- ตั้งค่า ----------
async function loadSettings() {
  loadRuntimeStatus();
  const d = await api.get('/api/settings');
  if (!d.ok) return;
  $('set_branch').value = d.settings.branch_name || '';
  $('set_backup_url').value = d.settings.backup_repo_url || '';
  $('set_printer').value = d.settings.printer_name || '';
  const printers=await api.get('/api/printers');
  if(printers.ok){
    $('printerNames').innerHTML=printers.printers.map((p)=>`<option value="${esc(p.name)}">${p.default?'เครื่องพิมพ์เริ่มต้น':''}${p.offline?' · offline':''}</option>`).join('');
    $('printerHint').textContent=printers.printers.length?'เลือกชื่อจากรายการของ Windows เพื่อป้องกันพิมพ์ผิดเครื่อง':'ยังไม่พบเครื่องพิมพ์ใน Windows';
  }else $('printerHint').textContent=printers.message;
  const s = await api.get('/api/sender');
  if (s.ok) {
    $('s_name').value = s.sender.sender_name || '';
    $('s_phone').value = s.sender.sender_phone || '';
    $('s_address').value = s.sender.sender_address || '';
    $('s_address_extra').value = s.sender.sender_address_extra || '';
  }
  const box = $('backupStatus');
  const lb = d.last_backup;
  if (!lb) {
    box.className = 'status-box muted';
    box.textContent = 'ยังไม่เคยสำรองข้อมูล';
  } else {
    const t = new Date(lb.started_at).toLocaleString('th-TH', {timeZone:'Asia/Bangkok'});
    box.className = 'status-box ' + (lb.ok ? 'ok' : 'fail');
    box.textContent = (lb.ok ? '✅ สำรองล่าสุด: ' : '❌ สำรองล้มเหลว: ') + t + ' — ' + (lb.message || '');
  }
}
$('saveSender').addEventListener('click', async () => {
  const r = await api.put('/api/sender', {
    sender_name: $('s_name').value, sender_phone: $('s_phone').value,
    sender_address: $('s_address').value, sender_address_extra: $('s_address_extra').value,
  });
  if (r.ok) { toast('💾 บันทึกข้อมูลผู้ส่งแล้ว'); loadSenderPreview(); }
  else toast('❌ ' + r.message, true);
});
$('saveSettings').addEventListener('click', async () => {
  const r = await api.put('/api/settings', {
    branch_name: $('set_branch').value,
    backup_repo_url: $('set_backup_url').value.trim(),
    printer_name: $('set_printer').value.trim(),
  });
  if (r.ok) { toast('💾 บันทึกตั้งค่าแล้ว'); loadBranch(); }
  else toast('❌ ' + r.message, true);
});
$('exportBackup').addEventListener('click',async()=>{
  const button=$('exportBackup');button.disabled=true;
  try{
    const response=await fetch('/api/backup/export',{method:'POST'});
    if(!response.ok){const error=await response.json();throw new Error(error.message);}
    const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');
    link.href=url;link.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'backup.db';
    link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('ส่งไฟล์ .db นี้ให้อีกเครื่องแล้วนำเข้าได้เลย');
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
$('importBackup').addEventListener('click',()=>$('backupFile').click());
$('backupFile').addEventListener('change',async(event)=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  if(!confirm('แทนรายชื่อลูกค้าทั้งหมดด้วยข้อมูลในไฟล์นี้? ระบบจะสำรองข้อมูลเดิมก่อนนำเข้า\nดาวที่ปักหมุดจะตามไฟล์มา ผู้ส่ง การตั้งค่า และประวัติพิมพ์บนเครื่องนี้ยังคงอยู่'))return;
  const button=$('importBackup');button.disabled=true;
  try{
    const form=new FormData();form.append('file',file);form.append('confirmation','นำเข้าลูกค้า');
    const response=await fetch('/api/customers/import-backup',{method:'POST',body:form});const result=await response.json();
    if(!result.ok)throw new Error(result.message);
    toast(`นำเข้าลูกค้า ${result.imported} รายแล้ว`);location.reload();
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
$('backupNow').addEventListener('click', async () => {
  const r = await api.post('/api/backup');
  toast(r.ok ? '💾 เริ่มสำรองข้อมูลเบื้องหลังแล้ว' : '❌ สั่งสำรองไม่สำเร็จ', !r.ok);
  setTimeout(loadSettings, 8000);
});
$('updateNow').addEventListener('click', async () => {
  if (!confirm('อัปเดตแอปจาก GitHub? ระบบจะเริ่มใหม่เมื่ออัปเดตสำเร็จ กรุณาจัดการคิวงานก่อน')) return;
  const r = await api.post('/api/update');
  toast(r.ok ? '⬇️ ' + r.note : '❌ สั่งอัปเดตไม่สำเร็จ', !r.ok);
  if (r.ok) pollUpdate();
});

async function loadRuntimeStatus() {
  const d = await api.get('/api/health');
  $('projectLocation').textContent=d.ok?`โฟลเดอร์ระบบ: ${d.project_root||'—'} · ฐานข้อมูล: ${d.database_path||'—'}`:'';
  $('runtimeStatus').textContent = d.ok ? (d.worker.ready ? (d.worker.driver==='mock' ? '🧪 โหมดทดลอง ไม่มีการพิมพ์จริง' : '✅ ระบบพิมพ์พร้อม') : '⚠️ ตัวพิมพ์ยังไม่พร้อม กรุณาเปิด start-label-pro-max-local.vbs') : d.message;
  $('restartRuntime').disabled = !d.managed; $('stopRuntime').disabled = !d.managed;
}
async function pollUpdate() {
  $('updateStatus').classList.remove('hidden');
  const d = await api.get('/api/update');
  $('updateStatus').textContent = d.message || 'ระบบกำลังเริ่มใหม่ กรุณารอสักครู่แล้วรีเฟรช';
  if (d.running) setTimeout(pollUpdate,2000);
}
$('restartRuntime').addEventListener('click', async () => {
  const d=await api.post('/api/runtime/restart'); toast(d.ok?'กำลังเริ่มระบบใหม่ กรุณารอสักครู่แล้วรีเฟรช':d.message,!d.ok);
});
$('stopRuntime').addEventListener('click', async () => {
  if(!confirm('ปิดระบบ Label Pro Max Local? งานที่กำลังส่งพิมพ์จะทำให้เสร็จก่อนปิด')) return;
  const d=await api.post('/api/runtime/stop'); toast(d.ok?'กำลังปิดระบบ เปิดอีกครั้งด้วย start-label-pro-max-local.vbs':d.message,!d.ok);
});

let clearInfo = null, clearBusy = false, clearPreviousFocus;
function closeClearModal() {
  if(clearBusy) return;
  $('clearCustomersModal').classList.remove('open'); clearInfo=null; clearPreviousFocus?.focus();
}
function updateClearButton() { $('clearConfirm').disabled = clearBusy || !clearInfo?.total || clearInfo.pending>0 || $('clearPhrase').value.trim()!=='ล้างข้อมูล'; }
$('clearCustomersBtn').addEventListener('click', async () => {
  clearPreviousFocus=document.activeElement; clearInfo=null;
  $('clearPhrase').value=''; $('clearError').textContent=''; $('clearSummary').textContent='กำลังตรวจจำนวนลูกค้าทั้งหมด…';
  $('clearCustomersModal').classList.add('open'); updateClearButton();
  const info=await api.get('/api/customers/clear-info');
  if(!$('clearCustomersModal').classList.contains('open')) return;
  if(!info.ok){$('clearError').textContent=info.message;return;}
  clearInfo=info;
  $('clearSummary').textContent=`จะลบลูกค้าทั้งหมด ${info.total} ราย (ใช้งาน ${info.active} ราย · ปิดใช้งาน ${info.total-info.active} ราย)`;
  if(info.pending) $('clearError').textContent=`มีงานรอหรือกำลังพิมพ์ ${info.pending} งาน กรุณาจัดการคิวก่อนล้าง`;
  updateClearButton(); $('clearPhrase').focus();
});
$('clearPhrase').addEventListener('input',updateClearButton);
['clearCancel','clearX'].forEach((id)=>$(id).addEventListener('click',closeClearModal));
$('clearCustomersModal').addEventListener('click',(e)=>{if(e.target.id==='clearCustomersModal')closeClearModal();});
document.addEventListener('keydown',(e)=>{
  if(!$('clearCustomersModal').classList.contains('open'))return;
  if(e.key==='Escape')closeClearModal();
  if(e.key==='Tab'){
    const inputs=[...$('clearCustomersModal').querySelectorAll('button:not(:disabled),input:not(:disabled)')],first=inputs[0],last=inputs.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
});
$('clearConfirm').addEventListener('click',async()=>{
  if($('clearConfirm').disabled||clearBusy)return;
  clearBusy=true; updateClearButton(); $('clearPhrase').disabled=true; $('clearCancel').disabled=true; $('clearX').disabled=true;
  $('clearConfirm').textContent='กำลังสำรองและล้างข้อมูล…';
  const result=await api.post('/api/customers/clear',{token:clearInfo.token,confirmation:$('clearPhrase').value.trim()});
  clearBusy=false; $('clearPhrase').disabled=false; $('clearCancel').disabled=false; $('clearX').disabled=false; $('clearConfirm').textContent='ยืนยันล้างลูกค้าทั้งหมด';
  if(!result.ok){$('clearError').textContent=result.message+' กรุณาปิดคำเตือนแล้วเปิดใหม่';clearInfo=null;updateClearButton();return;}
  dataGeneration++; clearTimeout(searchTimer); clearTimeout(custTimer);
  selectedCustomer=null; modalCustomer=null; customersCache=[]; $('q').value=''; $('custQ').value='';
  closePrintModal(); closeCustModal(); closeClearModal(); updatePreview(null);
  await Promise.all([loadCustomers(),searchCustomers(''),loadFavorites()]);
  toast(`ล้างลูกค้า ${result.deleted} รายแล้ว สำรองไว้ที่ backups/${result.backup}`);
});

// ---------- branch chip ----------
async function loadBranch() {
  const d = await api.get('/api/health');
  $('appVersion').textContent = d.ok && d.version ? 'v'+d.version : '';
  $('branchChip').textContent = '📍 สาขา: ' + ((d.ok && d.branch) ? d.branch : '—');
}

// ---------- init ----------
loadBranch();
loadSenderPreview();
searchCustomers('');
loadFavorites();
loadQueueBadge();
let installPrompt;
if('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installApp').classList.remove('hidden');});
$('installApp').addEventListener('click',async()=>{if(!installPrompt)return;await installPrompt.prompt();installPrompt=null;$('installApp').classList.add('hidden');});
$('installDesktop').addEventListener('click',async()=>{const button=$('installDesktop');button.disabled=true;const d=await api.post('/api/desktop/install');button.disabled=false;toast(d.message,!d.ok);});
