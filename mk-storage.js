/* مكتبي الإلكتروني — حصة التخزين + حفظ الملفات + تفاصيل الاشتراك (للعرض فقط)
   يُحمَّل بعد mk-cloud.js. لا يغيّر شيئًا في الوضع المحلي (بدون حساب مكتب).
   - الملفات تبقى محليًا كما هي، وتُرفع نسخة منها تلقائيًا إلى مخزن المكتب (وتُنزَّل عند فتحها من جهاز آخر).
   - الحصة تُفحص على الخادم قبل الرفع؛ المتصفح لا يستطيع تجاوزها. */
(function () {
  'use strict';
  if (!window.MK_CLOUD || typeof FileStore === 'undefined') return;
  const C = () => window.MK_CLOUD;
  const $ = id => document.getElementById(id);
  const MB = 1048576;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MSG = {
    quota_files_full: 'امتلأت مساحة الملفات في باقتك. احذف بعض الملفات أو جدّد/رقِّ الباقة لرفع ملفات جديدة.',
    quota_db_full: 'امتلأت مساحة بيانات القضايا في باقتك. احذف بيانات غير لازمة أو جدّد/رقِّ الباقة.',
    file_too_big: 'حجم الملف أكبر من الحد المسموح (19 ميجابايت للملف الواحد).',
    office_readonly: 'المكتب في وضع العرض فقط. جدّد الاشتراك لرفع ملفات.',
    forbidden: 'ليست لديك صلاحية رفع الملفات.'
  };
  const SOFT = new Set(['storage_not_configured', 'server_error', 'bad_action']);   // الخدمة غير جاهزة: لا نعطّل التطبيق

  /* ---------------- نداء الخادم ---------------- */
  let unavailableUntil = 0;
  async function fn(action, body) {
    const c = C(), t = await c.token();
    let res;
    try {
      res = await fetch(c.base + '/functions/v1/storage', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + t, apikey: c.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ action }, body))
      });
    } catch (e) { const x = new Error('network'); x.network = true; throw x; }
    let d = null; try { d = await res.json(); } catch { }
    if (!res.ok) {
      const e = new Error((d && d.error) || ('http_' + res.status)); e.code = e.message; e.status = res.status;
      if (res.status === 404 && !(d && d.error)) { e.code = 'storage_not_configured'; }   // الدالة غير منشورة بعد
      if (SOFT.has(e.code)) unavailableUntil = Date.now() + 5 * 60000;
      throw e;
    }
    return d;
  }
  async function authHeaders() { const c = C(), t = await c.token(); return { Authorization: 'Bearer ' + t, apikey: c.anonKey }; }
  async function readErr(res) {
    let d = null; try { d = await res.json(); } catch { }
    const e = new Error((d && d.error) || ('http_' + res.status)); e.code = e.message; e.status = res.status;
    if (res.status === 404 && !(d && d.error)) e.code = 'storage_not_configured';
    if (SOFT.has(e.code)) unavailableUntil = Date.now() + 5 * 60000;
    return e;
  }
  async function upload(id, blob) {
    let res;
    try {
      res = await fetch(C().base + '/functions/v1/storage?action=upload&id=' + encodeURIComponent(id), {
        method: 'POST', headers: Object.assign(await authHeaders(), { 'Content-Type': 'application/octet-stream' }), body: blob
      });
    } catch (e) { const x = new Error('network'); x.network = true; throw x; }
    if (!res.ok) throw await readErr(res);
  }
  async function download(id) {
    let res;
    try {
      res = await fetch(C().base + '/functions/v1/storage', {
        method: 'POST', headers: Object.assign(await authHeaders(), { 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'get', id })
      });
    } catch (e) { const x = new Error('network'); x.network = true; throw x; }
    if (!res.ok) throw await readErr(res);
    return await res.blob();
  }
  const enabled = () => { const c = C(); return !!(c && c.officeId() && ['manager', 'lawyer'].includes(c.role())); };
  const canRead = () => { const c = C(); return !!(c && c.officeId()); };
  const online = () => navigator.onLine && Date.now() > unavailableUntil;

  let toastT = 0;
  function note(msg, bad) {
    let t = $('mkStToast');
    if (!t) {
      t = document.createElement('div'); t.id = 'mkStToast';
      t.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);color:#fff;padding:10px 16px;border-radius:10px;z-index:9998;font-size:13px;max-width:92%;text-align:center;direction:rtl;line-height:1.7';
      document.body.appendChild(t);
    }
    t.style.background = bad ? '#b3261e' : '#222'; t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, bad ? 6000 : 3500);
  }
  function userError(e) {
    const err = new Error(MSG[e.code] || 'تعذر رفع الملف الآن. حاول مرة أخرى.');
    err.quota = e.code === 'quota_files_full' || e.code === 'file_too_big'; err.code = e.code;
    note(err.message, true);
    return err;
  }

  /* ---------------- الرفع والحذف (طوابير تتحمل انقطاع الإنترنت) ---------------- */
  const rawPut = FileStore.put.bind(FileStore), rawGet = FileStore.get.bind(FileStore), rawDel = FileStore.del.bind(FileStore);
  const upQ = () => LS.get('mk_up_queue', {}), delQ = () => LS.get('mk_del_queue', []);
  const setUpQ = q => LS.set('mk_up_queue', q), setDelQ = q => LS.set('mk_del_queue', q);
  function enqueueUp(id, size) { const q = upQ(); if (!q[id]) { q[id] = { size, tries: 0 }; setUpQ(q); } }
  function dequeueUp(id) { const q = upQ(); if (q[id]) { delete q[id]; setUpQ(q); } }
  function enqueueDel(id) { const q = delQ(); if (!q.includes(id)) { q.push(id); setDelQ(q); } }

  let busy = false, kickT = 0;
  async function processQueue() {
    if (busy || !online() || !canRead()) return;
    busy = true;
    try {
      // 1) الحذف المؤجل
      for (const id of delQ().slice()) {
        try { await fn('delete', { id }); }
        catch (e) { if (e.network || SOFT.has(e.code) || e.code === 'forbidden') break; if (e.code !== 'not_found') console.warn('[mk files]', e.code); }
        setDelQ(delQ().filter(x => x !== id));
      }
      // 2) الرفع المؤجل
      if (enabled()) {
        for (const id of Object.keys(upQ())) {
          const blob = await rawGet(id);
          if (!blob) { dequeueUp(id); continue; }
          try {
            await upload(id, blob);
            dequeueUp(id);
          } catch (e) {
            if (e.code === 'file_exists') { dequeueUp(id); continue; }
            if (e.network || SOFT.has(e.code) || e.code === 'telegram_busy') break;     // نكمل لاحقًا
            if (e.code === 'quota_files_full' || e.code === 'file_too_big' || e.code === 'office_readonly' || e.code === 'forbidden') {
              note(MSG[e.code] || MSG.quota_files_full, true); break;            // يبقى محليًا ويُعاد المحاولة لاحقًا
            }
            const q = upQ(); if (q[id]) { q[id].tries = (q[id].tries || 0) + 1; if (q[id].tries >= 6) delete q[id]; setUpQ(q); }
          }
        }
      }
    } finally { busy = false; refreshCards(); }
  }
  const kick = () => { clearTimeout(kickT); kickT = setTimeout(processQueue, 600); };

  /* ---------------- ربط مخزن الملفات المحلي ---------------- */
  FileStore.put = async function (id, blob) {
    if (enabled() && online()) {
      try { await fn('check', { size: blob.size }); }                 // فحص سريع للحصة قبل حفظ أي شيء
      catch (e) {
        if (e.network || SOFT.has(e.code)) { /* يُحفظ محليًا ويُرفع لاحقًا */ }
        else throw userError(e);
      }
    }
    const r = await rawPut(id, blob);
    if (enabled()) {
      enqueueUp(id, blob.size);
      if (online()) upload(id, blob).then(() => { dequeueUp(id); refreshCards(); }).catch(() => kick());
      else kick();
    }
    return r;
  };
  FileStore.del = async function (id) {
    const r = await rawDel(id);
    if (enabled()) { dequeueUp(id); enqueueDel(id); kick(); }
    return r;
  };
  const inflight = new Map();
  FileStore.get = async function (id) {
    const local = await rawGet(id);
    if (local || !canRead() || !online()) return local;
    const meta = (typeof DB !== 'undefined' ? DB.get('attachments') : []).find(a => a && a.id === id);
    if (!meta) return local;
    if (!inflight.has(id)) {
      inflight.set(id, (async () => {
        try {
          const raw = await download(id);
          const blob = meta.type ? new Blob([raw], { type: meta.type }) : raw;
          await rawPut(id, blob);                       // نخزّنها محليًا لفتحها لاحقًا بدون إنترنت
          return blob;
        } catch (e) { return null; } finally { inflight.delete(id); }
      })());
    }
    return (await inflight.get(id)) || local;
  };

  async function scanLocal() {
    if (!enabled() || !online()) { note('اتصل بالإنترنت أولًا.', true); return 0; }
    let ready = []; try { ready = await C().rpc('my_files_list'); } catch (e) { note('تعذر قراءة حالة الملفات الآن.', true); return 0; }
    const have = new Set(ready); let n = 0;
    for (const m of (DB.get('attachments') || [])) {
      if (!m || !m.id || have.has(m.id)) continue;
      const blob = await rawGet(m.id); if (!blob) continue;
      enqueueUp(m.id, blob.size); n++;
    }
    note(n ? 'جارٍ رفع ' + n + ' ملف إلى مساحة المكتب…' : 'كل ملفات هذا الجهاز مرفوعة بالفعل.');
    if (n) kick();
    return n;
  }

  /* ---------------- الاستهلاك ---------------- */
  async function usage() {
    try { const u = await C().rpc('my_storage_usage'); LS.set('mk_usage', u); return u; }
    catch (e) { return LS.get('mk_usage', null); }
  }
  let warnAt = 0;
  async function watch() {
    if (!enabled() || !online()) return;
    const u = await usage();
    if (u && u.percent >= 90 && Date.now() - warnAt > 3600000) {
      warnAt = Date.now();
      note('تنبيه: اقتربت من امتلاء باقتك (' + u.percent + '%). احذف ملفات غير لازمة أو جدّد/رقِّ الباقة.', true);
    }
  }

  /* ---------------- الواجهة ---------------- */
  const fmt = b => {
    b = Number(b) || 0;
    if (b < MB) return (b / 1024).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' كيلوبايت';
    return (b / MB).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' ميجابايت';
  };
  const day = s => s ? new Date(s).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  const color = p => p >= 90 ? '#b3261e' : p >= 70 ? '#b45309' : 'var(--success,#2e7d32)';
  const bar = (pct, h) => '<div style="height:' + h + 'px;background:var(--border,#e5d9c8);border-radius:' + h + 'px;overflow:hidden"><div style="height:100%;width:' + Math.min(100, Math.max(0, pct)) + '%;background:' + color(pct) + ';transition:width .3s"></div></div>';
  const pct = (u, l) => l ? Math.min(100, Math.round(1000 * u / l) / 10) : 0;

  function storageHTML(u, stale) {
    if (!u) return '<p style="color:var(--text-muted)">تعذر تحميل بيانات المساحة. تأكد من الاتصال بالإنترنت.</p>';
    const dp = pct(u.db_used, u.db_limit), fp = pct(u.file_used, u.file_limit), tp = u.percent || 0;
    const warns = [];
    if (u.file_used >= u.file_limit) warns.push('🚫 امتلأت مساحة الملفات: لا يمكن رفع ملفات جديدة حتى تحذف ملفات أو تجدّد/ترقّي الباقة.');
    else if (fp >= 90) warns.push('⚠️ اقتربت من امتلاء مساحة الملفات (' + fp + '%).');
    if (u.db_used >= u.db_limit) warns.push('🚫 امتلأت مساحة بيانات القضايا: لا يمكن إضافة بيانات جديدة حتى تحذف بيانات أو تجدّد/ترقّي الباقة.');
    else if (dp >= 90) warns.push('⚠️ اقتربت من امتلاء مساحة بيانات القضايا (' + dp + '%).');
    return '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
      '<strong>مستخدم ' + fmt(u.total_used) + ' من أصل ' + fmt(u.total_limit) + '</strong><span style="font-weight:700;color:' + color(tp) + '">' + tp + '%</span></div>' +
      bar(tp, 14) +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:14px">' +
      '<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>🗂️ بيانات القضايا</span><span>' + fmt(u.db_used) + ' / ' + fmt(u.db_limit) + '</span></div>' + bar(dp, 8) + '</div>' +
      '<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>📎 الملفات والمستندات</span><span>' + fmt(u.file_used) + ' / ' + fmt(u.file_limit) + '</span></div>' + bar(fp, 8) + '</div></div>' +
      (warns.length ? '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:#fdecea;color:#7a1c14;font-size:13px;line-height:1.9">' + warns.map(esc).join('<br>') + '</div>' : '') +
      (stale ? '<p style="font-size:12px;color:var(--text-muted);margin-top:8px">آخر قيم محفوظة (لا يوجد اتصال الآن).</p>' : '');
  }

  function subHTML(d, stale) {
    if (!d) return '<p style="color:var(--text-muted)">تعذر تحميل تفاصيل الاشتراك. تأكد من الاتصال بالإنترنت.</p>';
    const paid = d.plan === 'paid', left = Math.ceil((Date.parse(d.renewal_at) - Date.now()) / 86400000);
    const stateTxt = { trial: 'فترة تجريبية', active: 'نشط', expiring: 'ينتهي قريبًا', readonly: 'منتهٍ — عرض فقط', suspended: 'موقوف' }[d.state] || d.state;
    const renewed = !paid ? 'غير منطبق (فترة تجريبية)' : (d.is_renewed ? '✅ تم التجديد' + (d.renewals_count > 1 ? ' (' + d.renewals_count + ' مرات)' : '') : '❌ لم يتم التجديد بعد');
    const rows = [
      ['الباقة الحالية', paid ? 'مدفوعة (300 ميجابايت)' : 'تجريبية — 15 يومًا (30 ميجابايت)'],
      ['حالة الاشتراك', stateTxt],
      ['تاريخ البداية', day(d.starts_at)],
      ['تاريخ النهاية', day(d.ends_at)],
      ['موعد التجديد القادم', day(d.renewal_at) + (left > 0 ? ' — بعد ' + left + ' يوم' : ' — حان الموعد')],
      ['هل تم التجديد؟', renewed]
    ];
    return '<table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>' +
      rows.map(r => '<tr><td style="padding:9px 6px;border-bottom:1px solid var(--border,#e5d9c8);color:var(--text-muted);width:42%">' + esc(r[0]) + '</td><td style="padding:9px 6px;border-bottom:1px solid var(--border,#e5d9c8);font-weight:600">' + esc(r[1]) + '</td></tr>').join('') +
      '</tbody></table><p style="font-size:12px;color:var(--text-muted);margin-top:10px;line-height:1.8">🔒 هذه التفاصيل للعرض فقط ولا يمكن تعديلها من حسابك. لتجديد الاشتراك أو تغيير الباقة تواصل مع إدارة المنصة.' + (stale ? ' (آخر قيم محفوظة — لا يوجد اتصال الآن)' : '') + '</p>';
  }

  async function fillCards() {
    const sb = $('mkStorageBody'), ub = $('mkSubBody');
    if (!sb && !ub) return;
    const isOn = navigator.onLine;
    if (sb) { const u = await usage(); if ($('mkStorageBody')) $('mkStorageBody').innerHTML = storageHTML(u, !isOn); }
    if (ub) {
      let d = null;
      try { d = await C().rpc('my_subscription_details'); LS.set('mk_subdet', d); } catch (e) { d = LS.get('mk_subdet', null); }
      if ($('mkSubBody')) $('mkSubBody').innerHTML = subHTML(d, !isOn);
    }
  }
  const refreshCards = () => { if ($('mkStorageBody') || $('mkSubBody')) fillCards(); };

  function mount() {
    const page = $('page-settings'); const c = C();
    if (!page || !c || c.role() !== 'manager' || !c.officeId()) return;
    if (!$('mkStorageCard')) {
      const d = document.createElement('div'); d.className = 'card'; d.id = 'mkStorageCard'; d.style.marginTop = '20px';
      d.innerHTML = '<div class="card-header"><h2>مساحة التخزين</h2></div><div class="card-body">' +
        '<div id="mkStorageBody" style="font-size:14px;line-height:1.9">جارٍ التحميل…</div>' +
        '<div style="margin-top:12px"><button class="btn btn-outline btn-sm" id="mkStUpBtn">☁️ رفع ملفات هذا الجهاز إلى مساحة المكتب</button></div></div>';
      page.insertBefore(d, page.children[1] || null);
      $('mkStUpBtn').onclick = () => scanLocal();
    }
    if (!$('mkSubCard')) {
      const d = document.createElement('div'); d.className = 'card'; d.id = 'mkSubCard'; d.style.marginTop = '20px';
      d.innerHTML = '<div class="card-header"><h2>تفاصيل الاشتراك</h2></div><div class="card-body"><div id="mkSubBody">جارٍ التحميل…</div></div>';
      page.insertBefore(d, $('mkStorageCard').nextSibling);
    }
    fillCards();
  }
  const _sp = window.showPage;
  if (typeof _sp === 'function') window.showPage = function (id) { const r = _sp.apply(this, arguments); if (id === 'settings') try { mount(); } catch (e) { } return r; };

  window.addEventListener('online', kick);
  setInterval(() => { processQueue(); }, 60000);
  setInterval(watch, 5 * 60000);
  setTimeout(() => { processQueue(); watch(); }, 8000);
  window.MK_STORAGE = { usage, scanLocal, processQueue };
})();
