// web/app.js — LabelPro Local frontend (vanilla JS, ไม่ต้อง build)
// โฟลว์หลัก: ค้นหา (ชื่อสถานที่) → ดับเบิลคลิกเปิด popup ตัวเลือกการพิมพ์
// → สั่งพิมพ์ → popup สำเร็จ (กลางจอ + คำอวยพรตามวันจริง)
const $ = (id) => document.getElementById(id);
const api = {
  async get(p) { const r = await fetch(p); return r.json(); },
  async post(p, body) {
    const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return r.json();
  },
  async put(p, body) {
    const r = await fetch(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return r.json();
  },
  async del(p) { const r = await fetch(p, { method: 'DELETE' }); return r.json(); },
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

let searchTimer;
$('q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchCustomers(e.target.value), 250);
});

async function searchCustomers(q) {
  const d = await api.get('/api/customers?q=' + encodeURIComponent(q || ''));
  const box = $('results');
  if (!d.ok) { box.innerHTML = '<div class="empty">โหลดไม่สำเร็จ</div>'; return; }
  customersCache = d.customers;
  if (!d.customers.length) {
    box.innerHTML = '<div class="empty">ไม่พบลูกค้า — ลองค้นหาด้วยชื่อย่ออื่น หรือเพิ่มลูกค้าใหม่ในหน้า 👥 ลูกค้า</div>';
    return;
  }
  box.innerHTML = d.customers.map((c) => `
    <div class="cust" data-id="${c.id}">
      <button class="pbtn" title="สั่งพิมพ์ (จอสัมผัส)">🖨️</button>
      <span class="place">📍 ${esc(c.place_name)}</span>
      <span class="who">${esc(c.attention_name || '')}${c.contact ? ' · ' + esc(c.contact) : ''}</span>
      <span class="go">ดับเบิลคลิกเพื่อเปิดตัวเลือกการพิมพ์ »</span>
    </div>`).join('');
  box.querySelectorAll('.cust').forEach((el) => {
    const id = Number(el.dataset.id);
    const c = d.customers.find((x) => x.id === id);
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('pbtn')) return;
      selectCustomer(c);
    });
    el.addEventListener('dblclick', () => openPrintModal(c));
    el.querySelector('.pbtn').addEventListener('click', (e) => { e.stopPropagation(); openPrintModal(c); });
  });
}

function selectCustomer(c) {
  selectedCustomer = c;
  document.querySelectorAll('#results .cust').forEach((el) =>
    el.classList.toggle('sel', Number(el.dataset.id) === c.id));
  updatePreview(c);
}

function updatePreview(c) {
  $('pv-place').textContent = c ? (c.place_name || '—') : '— เลือกลูกค้า —';
  $('pv-name').textContent = c ? (c.attention_name || '') : '';
  $('pv-addr').textContent = c ? (c.address || '') : '';
  $('pv-contact').textContent = c && c.contact ? 'ติดต่อ: ' + c.contact : '';
}

async function loadSenderPreview() {
  const d = await api.get('/api/sender');
  if (!d.ok) return;
  const s = d.sender;
  if (s && s.sender_name) {
    $('pv-sender').innerHTML =
      `<b>ผู้ส่ง: ${esc(s.sender_name)}</b><br>เบอร์โทร ${esc(s.sender_phone || '-')}<br>` +
      `${esc(s.sender_address || '')}${s.sender_address_extra ? '<br>' + esc(s.sender_address_extra) : ''}`;
  }
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
  qty = 1; renderQty();
  $('printModal').classList.add('open');
}
function closePrintModal() { $('printModal').classList.remove('open'); }
document.querySelectorAll('.msgbtn').forEach((b) => {
  b.addEventListener('click', () => {
    msg = b.dataset.msg;
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
  if (!modalCustomer) { toast('❌ กรุณาเลือกลูกค้าก่อน', true); return; }
  const d = await api.post('/api/print', {
    customer_id: modalCustomer.id,
    message: msg,
    copies: qty,
    printed_by: $('m_by').value.trim(),
  });
  closePrintModal();
  if (!d.ok) { toast('❌ ' + (d.message || 'สั่งพิมพ์ไม่สำเร็จ'), true); return; }
  showSuccess(modalCustomer.place_name, msg, qty);
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
  done: ['✅ สำเร็จ', 'p-done'],
  failed: ['❌ ล้มเหลว', 'p-fail'],
  cancelled: ['🚫 ยกเลิกแล้ว', 'p-cancel'],
};
async function loadQueue() {
  const d = await api.get('/api/queue');
  const tb = $('queueBody');
  if (!d.ok) { tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">โหลดไม่สำเร็จ</td></tr>'; return; }
  const today = new Date().toISOString().slice(0, 10);
  $('stWait').textContent = d.jobs.filter((j) => j.status === 'queued' || j.status === 'printing').length;
  $('stDone').textContent = d.jobs.filter((j) => j.status === 'done' && (j.printed_at || '').slice(0, 10) === today).length;
  $('stFail').textContent = d.jobs.filter((j) => j.status === 'failed').length;
  if (!d.jobs.length) {
    tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">ยังไม่มีงานพิมพ์</td></tr>';
    return;
  }
  tb.innerHTML = d.jobs.map((j) => {
    const [label, cls] = STATUS[j.status] || [j.status, 'p-wait'];
    const time = new Date(j.created_at).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
    const acts = [];
    if (j.status === 'queued') acts.push(`<button class="mini" data-act="cancel" data-id="${j.id}">ยกเลิก</button>`);
    if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled') acts.push(`<button class="mini" data-act="reprint" data-id="${j.id}">พิมพ์ซ้ำ</button>`);
    return `<tr>
      <td style="white-space:nowrap">${esc(time)}</td>
      <td><b>📍 ${esc(j.place_name || '')}</b><br><span class="muted" style="font-size:12.5px">${esc(j.attention_name || '')}</span></td>
      <td>${esc(j.message || '—')}</td>
      <td>${j.copies} ใบ</td>
      <td>${esc(j.printed_by || '—')}</td>
      <td><span class="pill ${cls}">${label}</span>${j.status === 'failed' && j.error ? `<div class="muted" style="font-size:12px;white-space:pre-line;word-break:break-word">${esc(j.error)}</div>` : ''}</td>
      <td style="white-space:nowrap">${acts.join('')}</td>
    </tr>`;
  }).join('');
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
  const n = d.jobs.filter((j) => j.status === 'queued' || j.status === 'printing').length;
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
  const q = $('custQ').value.trim();
  const d = await api.get('/api/customers?q=' + encodeURIComponent(q));
  const tb = $('custBody');
  if (!d.ok) { tb.innerHTML = '<tr><td colspan="5" style="text-align:center">โหลดไม่สำเร็จ</td></tr>'; return; }
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
      <button class="mini" data-act="print" data-id="${c.id}">🖨️</button>
      <button class="mini" data-act="edit" data-id="${c.id}">✏️</button>
      <button class="mini" data-act="del" data-id="${c.id}">🗑️</button>
    </td></tr>`).join('');
  tb.querySelectorAll('[data-act]').forEach((b) => {
    const id = Number(b.dataset.id);
    const c = d.customers.find((x) => x.id === id);
    if (b.dataset.act === 'edit') b.addEventListener('click', () => openCustModal(c));
    if (b.dataset.act === 'print') b.addEventListener('click', () => openPrintModal(c));
    if (b.dataset.act === 'del') b.addEventListener('click', async () => {
      if (!confirm(`ปิดใช้งาน “${c.place_name}”? (ข้อมูลไม่ถูกลบถาวร)`)) return;
      const r = await api.del('/api/customers/' + id);
      if (r.ok) { toast('ปิดใช้งานแล้ว'); loadCustomers(); }
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
  if (r.ok) { closeCustModal(); toast('💾 บันทึกแล้ว'); loadCustomers(); searchCustomers($('q').value); }
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
async function loadPrinterList(preselect) {
  const sel = $('set_printer');
  sel.innerHTML = '<option value="">— กำลังโหลด —</option>';
  let names = [];
  try {
    const d = await api.get('/api/printers');
    if (d && d.ok && Array.isArray(d.printers)) names = d.printers;
    else if (d && d.error) toast('⚠️ ' + d.error, true);
  } catch { /* เซิร์ฟเวอร์ไม่ตอบ — ให้ user พิมพ์ชื่อเอง */ }
  if (!names.length) {
    sel.innerHTML = '<option value="">(ไม่พบเครื่องพิมพ์ — กด "พิมพ์ชื่อเอง" ด้านล่าง)</option>';
  } else {
    sel.innerHTML = '<option value="">— เลือกเครื่องพิมพ์ —</option>' +
      names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  }
  if (preselect) {
    // ค่าที่บันทึกไว้ (อาจเป็นชื่อที่พิมพ์เอง) → เก็บเป็น option เสริมกันค่าหาย
    if (![...sel.options].some((o) => o.value === preselect)) {
      const o = document.createElement('option');
      o.value = preselect;
      o.textContent = preselect + ' (ค่าที่บันทึกไว้)';
      sel.appendChild(o);
    }
    sel.value = preselect;
  }
}
// ชื่อ printer ที่จะบันทึก: ช่องพิมพ์เอง (ถ้าเปิดอยู่และมีค่า) ไม่งั้นค่าจาก dropdown
function currentPrinterValue() {
  const m = $('set_printer_manual');
  if (m.style.display !== 'none' && m.value.trim()) return m.value.trim();
  return $('set_printer').value.trim();
}
$('refreshPrinters').addEventListener('click', async () => {
  await loadPrinterList(currentPrinterValue());
  toast('🔄 โหลดรายการเครื่องพิมพ์ใหม่แล้ว');
});
$('printerManualToggle').addEventListener('click', (e) => {
  e.preventDefault();
  const m = $('set_printer_manual');
  const show = m.style.display === 'none';
  m.style.display = show ? '' : 'none';
  e.target.textContent = show ? 'ซ่อนช่องพิมพ์เอง' : 'พิมพ์ชื่อเอง';
  if (show) m.focus();
});
async function loadSettings() {
  const d = await api.get('/api/settings');
  if (!d.ok) return;
  $('set_branch').value = d.settings.branch_name || '';
  $('set_backup_url').value = d.settings.backup_repo_url || '';
  $('set_printer_manual').value = '';
  $('set_printer_manual').style.display = 'none';
  $('printerManualToggle').textContent = 'พิมพ์ชื่อเอง';
  await loadPrinterList(d.settings.printer_name || '');
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
    const t = new Date(lb.started_at).toLocaleString('th-TH');
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
    printer_name: currentPrinterValue(),
  });
  if (r.ok) { toast('💾 บันทึกตั้งค่าแล้ว'); loadBranch(); }
  else toast('❌ ' + r.message, true);
});
$('backupNow').addEventListener('click', async () => {
  const r = await api.post('/api/backup');
  toast(r.ok ? '💾 เริ่มสำรองข้อมูลเบื้องหลังแล้ว' : '❌ สั่งสำรองไม่สำเร็จ', !r.ok);
  setTimeout(loadSettings, 8000);
});
$('updateNow').addEventListener('click', async () => {
  if (!confirm('อัปเดตแอปจาก GitHub? (ต้อง restart server/worker หลังอัปเดต)')) return;
  const r = await api.post('/api/update');
  toast(r.ok ? '⬇️ ' + r.note : '❌ สั่งอัปเดตไม่สำเร็จ', !r.ok);
});

// ---------- branch chip ----------
async function loadBranch() {
  const d = await api.get('/api/health');
  $('branchChip').textContent = '📍 สาขา: ' + ((d.ok && d.branch) ? d.branch : '—');
}

// ---------- init ----------
loadBranch();
loadSenderPreview();
searchCustomers('');
loadQueueBadge();
