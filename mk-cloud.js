/* مكتبي الإلكتروني — طبقة Supabase
   حسابات المكاتب (معزولة) + مزامنة البيانات بين الأجهزة + دخول أوفلاين.
   تعمل فقط إذا ضُبط mk-config.js؛ وإلا يبقى التطبيق بوضعه المحلي القديم. */
(function () {
  'use strict';
  const CFG = window.MK_CONFIG || {};
  CFG.url = String(CFG.url || '').trim(); CFG.anonKey = String(CFG.anonKey || '').trim();
  const ENABLED = !!(CFG.url && CFG.anonKey);
  if (!ENABLED) { console.info('[mk] Supabase غير مضبوط — الوضع المحلي'); return; }

  // نأخذ أصل الرابط فقط (https://xxxx.supabase.co) حتى لو لُصق معه مسار زائد مثل /rest/v1
  const BASE = (function () {
    try { let u = String(CFG.url).trim(); if (!/^https?:\/\//i.test(u)) u = 'https://' + u; return new URL(u).origin; }
    catch (e) { return String(CFG.url).trim().replace(/\/+$/, ''); }
  })();
  const DOMAIN = '@maktaby.app';
  const COLLS = ['attachments','bailiffs','cases','clients','docs','events','fin_entries','invoices',
    'ld_cases','ld_checklist','notes','poas','sessions','tasks','workdays','comments','drafts'];
  const META = ['dq_office_profile', 'dq_doc_categories'];
  const $ = id => document.getElementById(id);
  const _setItem = Storage.prototype.setItem;
  let applying = false;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { _setItem.call(localStorage, k, JSON.stringify(v)); }
  };
  const uerr = m => { const e = new Error(m); e.user = true; return e; };
  const netErr = () => { const e = new Error('network'); e.network = true; return e; };
  const validUser = u => /^[a-z0-9._-]{3,30}$/.test(u);
  const arDigits = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

  let session = LS.get('mk_session', null);
  let me = null;               // الحساب الحالي (نفس شكل dqCurrentAccount)
  let expired = false, lastError = '', pushing = false, syncing = false;
  let pollTimer = null, pushTimer = null;

  /* ---------------- HTTP ---------------- */
  async function api(path, { method = 'GET', body, token, prefer } = {}) {
    const headers = { apikey: CFG.anonKey, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    else if (String(CFG.anonKey).startsWith('eyJ')) headers.Authorization = 'Bearer ' + CFG.anonKey;
    if (prefer) headers.Prefer = prefer;
    let res;
    try {
      res = await fetch(BASE + path,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw netErr(); }
    const text = await res.text(); let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!res.ok) {
      const msg = (data && (data.msg || data.message || data.error_description || data.error)) || ('HTTP ' + res.status);
      const e = new Error(msg); e.status = res.status; e.data = data; throw e;
    }
    return data;
  }
  function saveSession(r) {
    const exp = r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600);
    session = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: exp,
      user_id: (r.user && r.user.id) || (session && session.user_id) };
    LS.set('mk_session', session); expired = false;
  }
  async function token() {
    if (!session) throw uerr('لا توجد جلسة. سجّل الدخول وأنت متصل بالإنترنت.');
    if (session.expires_at * 1000 - Date.now() > 60000) return session.access_token;
    if (!navigator.onLine) throw netErr();
    try {
      const r = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
      saveSession(r); return session.access_token;
    } catch (e) {
      if (e.status === 400 || e.status === 401 || e.status === 403) { expired = true; setStatus(); }
      throw e;
    }
  }
  async function rest(path, opts = {}) { const t = await token(); return api(path, { ...opts, token: t }); }
  const rpc = (name, args) => rest('/rest/v1/rpc/' + name, { method: 'POST', body: args || {} });

  function friendly(e) {
    if (e && e.user) return e.message;
    if (e && e.network) return 'تعذر الاتصال بالإنترنت.';
    const m = String((e && e.message) || e);
    if (/email_provider_disabled|logins? (are|is) disabled/i.test(m + ' ' + JSON.stringify((e && e.data) || ''))) return 'مزوّد Email معطّل في Supabase. فعّل «Enable Email provider» من Authentication ← Sign In / Providers ← Email ثم احفظ.';
    if (/signups? (are|is) disabled|signup_disabled/i.test(m + ' ' + JSON.stringify((e && e.data) || ''))) return 'التسجيل معطّل في Supabase. فعّل «Allow new users to sign up» وفعّل مزوّد Email من Authentication ← Sign In / Providers.';
    if (/email not confirmed|email_not_confirmed/i.test(m + ' ' + JSON.stringify((e && e.data) || ''))) return 'هذا الحساب غير مؤكد في Supabase. نفّذ في SQL Editor: update auth.users set email_confirmed_at = now() where email_confirmed_at is null;';
    if (/invalid path specified/i.test(m)) return 'رابط Supabase في mk-config.js غير صحيح. يجب أن يكون هكذا فقط: https://xxxx.supabase.co';
    if (/invalid api key|no api key/i.test(m)) return 'المفتاح في mk-config.js غير صحيح. استخدم المفتاح العام (anon / publishable).';
    if (/PGRST205|schema cache|could not find the (table|function)|does not exist/i.test(m + ' ' + JSON.stringify((e && e.data) || ''))) return 'قاعدة البيانات لم تُجهَّز بعد. نفّذ ملف supabase-schema.sql في Supabase أولًا.';
    const map = { forbidden: 'غير مسموح لك بهذه العملية.', not_found: 'الحساب غير موجود.', office_inactive: 'المكتب موقوف.',
      bad_role: 'دور غير صالح.', client_required: 'اربط حساب الموكل بسجل العميل.', bad_username: 'اسم الدخول غير صالح.',
      invalid_target: 'تعذر ربط الحساب الجديد. أعد المحاولة.', profile_exists: 'الحساب موجود بالفعل.',
      username_mismatch: 'اسم الدخول لا يطابق الحساب.', office_readonly: 'المكتب في وضع العرض فقط. جدّد الاشتراك أولًا.',
      bad_duration: 'حدّد مدة أو تاريخًا صحيحًا.' };
    for (const k in map) if (m.includes(k)) return map[k];
    return m;
  }

  /* ---------------- تشفير الدخول الأوفلاين (PBKDF2) ---------------- */
  const b64e = u8 => btoa(String.fromCharCode.apply(null, Array.from(u8)));
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(pw, salt, iter) {
    if (!(window.crypto && crypto.subtle)) throw uerr('المتصفح لا يدعم التشفير المطلوب (يلزم رابط https).');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64d(salt), iterations: iter }, key, 256);
    return b64e(new Uint8Array(bits));
  }
  async function saveOffline(username, password, prof, off) {
    const all = LS.get('mk_offline_auth', {});
    const salt = b64e(crypto.getRandomValues(new Uint8Array(16))), iter = 150000;
    all[username] = { salt, iter, hash: await derive(password, salt, iter), profile: prof,
      office: off ? { id: off.id, name: off.name } : null, savedAt: Date.now() };
    LS.set('mk_offline_auth', all);
  }
  function removeOffline(username) { const a = LS.get('mk_offline_auth', {}); delete a[username]; LS.set('mk_offline_auth', a); }

  /* ---------------- الحساب/المكتب ---------------- */
  const officeId = () => (me && me.role !== 'owner' && me.officeId) || null;
  function toAccount(p) {
    const x = p.extra || {};
    return { id: p.user_id, name: p.full_name, username: p.username, role: p.role,
      permissions: p.role === 'owner' ? DQ_MODULES.map(m => m[0]) : (Array.isArray(p.permissions) ? p.permissions : []),
      clientId: p.client_id || null, active: p.active !== false, officeId: p.office_id || null,
      regNo: x.regNo || '', nationalId: x.nationalId || '', regGrade: x.regGrade || '', createdAt: p.created_at, pwVersion: p.pw_version || 0 };
  }

  /* ---------------- عزل بيانات الأجهزة بين المكاتب ---------------- */
  const readRaw = k => { try { const v = JSON.parse(localStorage.getItem('dq_' + k)); return Array.isArray(v) ? v : []; } catch { return []; } };
  const hasLocalData = () => COLLS.some(c => readRaw(c).length) || META.some(k => localStorage.getItem(k));
  function wipeLocalData() {
    Object.keys(localStorage).filter(k => k.startsWith('dq_') && k !== 'dq_theme').forEach(k => localStorage.removeItem(k));
    try { if (typeof FileStore !== 'undefined') { if (FileStore.db) FileStore.db.close(); FileStore.db = null; } indexedDB.deleteDatabase('dq_files'); } catch { }
    LS.set('mk_queue', {});
  }
  function queueAll() {
    COLLS.forEach(c => readRaw(c).forEach(it => { if (it && it.id) enqueue(c, it.id, it, false); }));
    META.forEach(k => { const v = localStorage.getItem(k); if (v != null) enqueue('_meta', k, { v }, false); });
  }
  function switchOfficeData(off) {
    const cur = localStorage.getItem('mk_data_office');
    if (cur === off.id) return true;
    const q = LS.get('mk_queue', {});
    if (cur && Object.keys(q).length) throw uerr('توجد تغييرات غير مرفوعة لمكتب آخر على هذا الجهاز. اتصل بالإنترنت وسجّل الدخول بحساب ذلك المكتب أولًا لرفعها.');
    if (cur) wipeLocalData();
    else if (hasLocalData()) {
      if (!confirm('توجد بيانات على هذا الجهاز من الإصدار المحلي.\nموافق = رفعها إلى مكتب «' + off.name + '».\nإلغاء = عدم الدخول الآن (تبقى بياناتك كما هي).')) throw uerr('لم يتم الدخول. خُذ نسخة احتياطية أو اعتمد رفع البيانات.');
      _setItem.call(localStorage, 'mk_data_office', off.id); LS.set('mk_queue', {});
      LS.set('mk_office', { id: off.id, name: off.name }); me && (me.officeId = off.id);
      queueAll(); return true;
    }
    _setItem.call(localStorage, 'mk_data_office', off.id);
    localStorage.removeItem('mk_cursor_' + off.id);
    return true;
  }

  /* ---------------- طابور التغييرات ---------------- */
  function enqueue(c, id, data, deleted) {
    const q = LS.get('mk_queue', {});
    q[c + '|' + id] = { c, id, data: data || {}, deleted: !!deleted, ts: Date.now() + Math.random() };
    LS.set('mk_queue', q);
  }
  function diffQueue(c, oldArr, newArr) {
    const om = new Map(oldArr.filter(x => x && x.id).map(x => [x.id, x]));
    const seen = new Set();
    newArr.forEach(x => {
      if (!x || !x.id) return; seen.add(x.id);
      if (!om.has(x.id) || JSON.stringify(om.get(x.id)) !== JSON.stringify(x)) enqueue(c, x.id, x, false);
    });
    // عند الحذف نُبقي مفاتيح الملكية فقط (تحتاجها قواعد الصلاحيات)، لا محتوى السجل
    om.forEach((old, id) => { if (!seen.has(id)) enqueue(c, id, { lawyerId: old.lawyerId, createdById: old.createdById }, true); });
    schedulePush(); setStatus();
  }
  function hookStorage() {
    const prevSet = DB.set;
    DB.set = function (key, data) {
      if (me && me.role !== 'owner' && isRO()) { toast('المكتب في وضع العرض فقط. جدّد الاشتراك للتعديل.'); throw new Error('المكتب في وضع العرض فقط'); }
      if (COLLS.includes(key) && me && !canWrite(key)) { toast('ليست لديك صلاحية التعديل في هذا القسم.'); throw new Error('ليست لديك صلاحية التعديل'); }
      const tracked = COLLS.includes(key) && officeId() && !applying;
      if (tracked && Array.isArray(data)) data.forEach(x => { if (x && typeof x === 'object' && !x.id) x.id = DB.uid(); });
      const old = tracked ? readRaw(key) : null;
      const r = prevSet.call(DB, key, data);
      if (tracked) diffQueue(key, old, Array.isArray(data) ? data : []);
      return r;
    };
    Storage.prototype.setItem = function (k, v) {
      _setItem.call(this, k, v);
      if (this === localStorage && !applying && META.includes(k) && officeId()) { enqueue('_meta', k, { v: String(v) }, false); schedulePush(); setStatus(); }
    };
  }

  /* ---------------- الرفع والسحب ---------------- */
  const schedulePush = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => push(), 1500); };
  const isDenied = e => !!e && (e.status === 403 || /row-level security|42501/i.test((e.message || '') + JSON.stringify(e.data || '')));
  async function sendRows(items) {   // يُرجع العناصر التي رفضتها قاعدة البيانات (صلاحيات)
    const oid = officeId();
    const rows = items.map(it => ({ office_id: oid, collection: it.c, id: it.id, data: it.data || {}, deleted: !!it.deleted }));
    try {
      await rest('/rest/v1/records?on_conflict=office_id,collection,id', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
      return [];
    } catch (e) {
      if (!isDenied(e)) throw e;
      if (items.length === 1) return items;
      const mid = items.length >> 1;
      return (await sendRows(items.slice(0, mid))).concat(await sendRows(items.slice(mid)));
    }
  }
  function setLocalRecord(c, id, data) {   // data=null → حذف محلي
    applying = true;
    try {
      if (c === '_meta') { if (data && data.v != null) _setItem.call(localStorage, id, data.v); return; }
      const arr = readRaw(c).filter(x => x && x.id !== id);
      if (data) arr.push(data);
      _setItem.call(localStorage, 'dq_' + c, JSON.stringify(arr));
    } finally { applying = false; }
  }
  async function revertDenied(denied) {
    for (const it of denied) {
      try {
        const r = await rest('/rest/v1/records?office_id=eq.' + officeId() + '&collection=eq.' + it.c + '&id=eq.' + encodeURIComponent(it.id) + '&select=data,deleted');
        setLocalRecord(it.c, it.id, r[0] && !r[0].deleted ? r[0].data : null);
      } catch (e) { console.warn('[mk revert]', e.message); }
    }
    rerender(); toast('رُفضت ' + denied.length + ' تعديلات ليست لديك صلاحية عليها، وأُعيدت لحالتها.');
  }
  async function push() {
    if (pushing || !me || !officeId() || !navigator.onLine || !session || session.user_id !== me.id || isRO()) return;
    pushing = true;
    try {
      const items = Object.values(LS.get('mk_queue', {}));
      for (let i = 0; i < items.length; i += 100) {
        const chunk = items.slice(i, i + 100);
        const denied = await sendRows(chunk);
        if (denied.length) {
          await syncStatus(true);                 // قد يكون الرفض بسبب الاشتراك لا الصلاحية
          if (isRO()) return;                     // نُبقي التعديلات في الطابور
        }
        const q2 = LS.get('mk_queue', {});
        chunk.forEach(it => { const k = it.c + '|' + it.id; if (q2[k] && q2[k].ts === it.ts) delete q2[k]; });
        LS.set('mk_queue', q2);
        if (denied.length) await revertDenied(denied);
      }
      lastError = '';
    } catch (e) { onSyncError(e); } finally { pushing = false; setStatus(); }
  }
  function applyRows(rows) {
    const q = LS.get('mk_queue', {}); let changed = false;
    const by = {};
    rows.forEach(r => { (by[r.collection] = by[r.collection] || []).push(r); });
    applying = true;
    try {
      Object.keys(by).forEach(c => {
        if (c === '_meta') {
          by[c].forEach(r => { if (q['_meta|' + r.id] || !META.includes(r.id) || r.deleted) return;
            const v = r.data && r.data.v; if (v != null && localStorage.getItem(r.id) !== v) { _setItem.call(localStorage, r.id, v); changed = true; } });
          return;
        }
        if (!COLLS.includes(c)) return;
        let arr = readRaw(c); const idx = new Map(arr.map((x, i) => [x && x.id, i])); let dirty = false;
        by[c].forEach(r => {
          if (q[c + '|' + r.id]) return;                    // تغيير محلي لم يُرفع بعد: نحتفظ به
          const i = idx.get(r.id);
          if (r.deleted) { if (i !== undefined) { arr[i] = null; dirty = true; } }
          else if (i !== undefined) { if (JSON.stringify(arr[i]) !== JSON.stringify(r.data)) { arr[i] = r.data; dirty = true; } }
          else { arr.push(r.data); idx.set(r.id, arr.length - 1); dirty = true; }
        });
        if (dirty) { arr = arr.filter(Boolean); _setItem.call(localStorage, 'dq_' + c, JSON.stringify(arr)); changed = true; }
      });
    } finally { applying = false; }
    return changed;
  }
  async function pull() {
    const oid = officeId(); if (!oid || !navigator.onLine || !session || session.user_id !== me.id) return;
    let cursor = localStorage.getItem('mk_cursor_' + oid) || '1970-01-01T00:00:00Z', changed = false;
    try {
      for (let guard = 0; guard < 200; guard++) {
        const rows = await rest('/rest/v1/records?office_id=eq.' + oid + '&updated_at=gte.' + encodeURIComponent(cursor) +
          '&order=updated_at.asc,collection.asc,id.asc&limit=1000&select=collection,id,data,deleted,updated_at');
        if (!rows.length) break;
        if (applyRows(rows)) changed = true;
        const last = rows[rows.length - 1].updated_at;
        if (rows.length < 1000 || last === cursor) { cursor = last; break; }
        cursor = last;
      }
      _setItem.call(localStorage, 'mk_cursor_' + oid, cursor); lastError = '';
      if (changed) rerender();
    } catch (e) { onSyncError(e); }
  }
  async function syncMembers() {
    const oid = officeId(); if (!oid || !navigator.onLine || !session || session.user_id !== me.id) return;
    try {
      const rows = await rest('/rest/v1/profiles?office_id=eq.' + oid + '&select=*&order=created_at.asc');
      const accts = rows.map(toAccount);
      applying = true; _setItem.call(localStorage, 'dq_local_accounts', JSON.stringify(accts)); applying = false;
      const mine = accts.find(a => a.id === me.id);
      if (!mine || mine.active === false) { alert('تم إيقاف حسابك أو حذفه من قبل مدير المكتب.'); removeOffline(me.username); dqLogout(); return; }
      const rec = LS.get('mk_offline_auth', {})[me.username];
      if (rec && rec.profile && (mine.pwVersion || 0) > (rec.profile.pw_version || 0)) {
        alert('غيّر مدير المكتب كلمة مرورك. سجّل الدخول من جديد بكلمة المرور الجديدة.'); removeOffline(me.username); dqLogout(); return;
      }
      const permsChanged = JSON.stringify(mine.permissions) !== JSON.stringify(me.permissions) || mine.role !== me.role;
      Object.assign(me, mine);
      if (typeof dqCurrentAccount !== 'undefined' && dqCurrentAccount) { Object.assign(dqCurrentAccount, mine); if (permsChanged) { refreshNav(); syncPerms(true); } }
    } catch (e) { onSyncError(e); }
  }
  async function syncAll() {
    if (syncing || !me || !officeId()) return; syncing = true;
    try { await syncStatus(); await push(); await pull(); await syncMembers(); await syncPerms(); await syncAnnouncements(); } finally { syncing = false; setStatus(); }
  }
  function onSyncError(e) {
    if (e && e.network) { lastError = ''; return; }
    if (e && (e.status === 401 || e.status === 403) && /jwt|expired|token/i.test(e.message || '')) expired = true;
    lastError = (e && e.message) || 'خطأ';
    console.warn('[mk sync]', e && e.message, e && e.stack);
  }
  function rerender() {
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    const p = document.querySelector('.page.active');
    if (p && typeof showPage === 'function') { try { showPage(p.id.replace('page-', '')); } catch { } }
  }
  function refreshNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(b => { b.style.display = dqHasPerm(b.dataset.page) ? 'flex' : 'none'; });
    document.querySelectorAll('.nav-section').forEach(sec => {
      let n = sec.nextElementSibling, any = false;
      while (n && !n.classList.contains('nav-section')) { if (n.classList.contains('nav-item') && n.style.display !== 'none') any = true; n = n.nextElementSibling; }
      sec.style.display = any ? 'block' : 'none';
    });
    const acc = $('dqAccountsNav'); if (acc) acc.style.display = ['owner', 'manager'].includes(me.role) ? 'flex' : 'none';
  }

  /* ---------------- مؤشر الحالة ---------------- */
  function ensurePill() {
    if ($('mkPill')) return;
    const d = document.createElement('div'); d.id = 'mkPill';
    d.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:90;background:rgba(11,31,51,.93);color:#fff;font-size:12px;padding:6px 11px;border-radius:999px;cursor:pointer;direction:rtl;box-shadow:0 2px 10px rgba(0,0,0,.25)';
    d.onclick = () => { if (expired) alert('انتهت الجلسة. اخرج ثم سجّل الدخول وأنت متصل بالإنترنت لإكمال المزامنة.'); else syncAll(); };
    document.body.appendChild(d);
  }
  function setStatus() {
    const d = $('mkPill'); if (!d) return;
    if (!me || !officeId()) { d.style.display = 'none'; return; }
    d.style.display = 'block';
    const n = Object.keys(LS.get('mk_queue', {})).length;
    d.textContent = isRO() ? '🔒 وضع العرض فقط' + (n ? ' · ' + n + ' معلّق' : '')
      : expired ? '🔒 سجّل الدخول متصلًا لإكمال المزامنة'
      : !navigator.onLine ? '📴 غير متصل' + (n ? ' · ' + n + ' بانتظار الرفع' : '')
      : lastError ? '⚠️ تعذرت المزامنة' + (n ? ' (' + n + ')' : '')
      : n ? '⏳ جارٍ الرفع (' + n + ')' : '☁️ متزامن';
  }
  function startSync() {
    stopSync(); ensurePill(); setStatus();
    pollTimer = setInterval(() => { if (!document.hidden) syncAll(); }, 20000);
    clearInterval(subTimer); subTimer = setInterval(renderSub, 1000); renderSub();
    syncAll();
  }
  function stopSync() { clearInterval(pollTimer); clearInterval(subTimer); clearTimeout(pushTimer); pollTimer = null; subTimer = null; }
  window.addEventListener('online', () => { setStatus(); syncAll(); });
  window.addEventListener('offline', setStatus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAll(); });

  /* ---------------- شاشة الدخول ---------------- */
  const origInit = window.dqInitAuth, origSubmit = window.dqSubmitAuth, origEnter = window.dqEnterApp, origLogout = window.dqLogout;
  const F = (id, label, extra) => '<div class="form-group"><label>' + label + '</label><input id="' + id + '" ' + extra + ' /></div>';
  function gate(mode) {
    const link = (m, t) => '<div style="text-align:center;margin-top:12px"><a href="#" onclick="mkGate(\'' + m + '\');return false">' + t + '</a></div>';
    if (mode === 'register') {
      dqSetGate('إنشاء حساب مدير مكتب', 'سيُنشأ مكتب جديد بياناته وحساباته منفصلة تمامًا عن باقي المكاتب، وحسابك هو حساب المدير. هذه الخطوة تحتاج إنترنت.',
        F('mkOfficeName', 'اسم المكتب', 'required placeholder="مثال: مكتب الأستاذ ..."') +
        F('dqAuthName', 'اسم المدير', 'required autocomplete="name"') +
        F('dqAuthUsername', 'اسم الدخول (إنجليزي: حروف وأرقام)', 'required dir="ltr" autocapitalize="none" autocomplete="username" placeholder="مثال: ahmed.law"') +
        F('dqAuthPassword', 'كلمة المرور (8 أحرف على الأقل)', 'type="password" required autocomplete="new-password"') +
        F('dqAuthPassword2', 'تأكيد كلمة المرور', 'type="password" required autocomplete="new-password"') +
        link('login', 'لدي حساب بالفعل — تسجيل الدخول'), 'إنشاء المكتب');
      $('dqAuthForm').dataset.mode = 'mk-register';
    } else {
      dqSetGate('تسجيل الدخول', 'أدخل اسم الدخول وكلمة المرور. يعمل الدخول بدون إنترنت على الأجهزة التي سجّلت منها الدخول مسبقًا.',
        F('dqAuthUsername', 'اسم الدخول', 'required dir="ltr" autocapitalize="none" autocomplete="username"') +
        F('dqAuthPassword', 'كلمة المرور', 'type="password" required autocomplete="current-password"') +
        link('register', 'إنشاء مكتب جديد (مدير مكتب)'), 'دخول');
      $('dqAuthForm').dataset.mode = 'mk-login';
    }
  }
  window.mkGate = gate;
  /* ---------------- صلاحية الجلسة ----------------
     تُطلب كلمة المرور من جديد عند: تسجيل الخروج، أو إغلاق التطبيق/التبويب (sessionStorage تزول)،
     أو عدم أي تفاعل 10 دقائق. إعادة تحميل الصفحة أو العودة للتطبيق ضمن المهلة لا تطلب الدخول. */
  const IDLE_MS = 10 * 60 * 1000, SKEY = 'mk_app_session';
  let lastAct = Date.now(), lastWrite = 0, idleTimer = null, sessionNotice = '', restoring = false;
  const sget = () => { try { return JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch { return null; } };
  const sset = v => { try { if (v) sessionStorage.setItem(SKEY, JSON.stringify(v)); else sessionStorage.removeItem(SKEY); } catch { } };
  function touch(force) {
    const n = Date.now(); lastAct = n;
    if (me && (force || n - lastWrite > 5000)) { lastWrite = n; sset({ u: me.username, t: n }); }
  }
  function forceLogout(msg) { sessionNotice = msg || ''; window.dqLogout(); }
  function idleCheck() {
    if (!me) return;
    if (Date.now() - lastAct > IDLE_MS) forceLogout('انتهت الجلسة لعدم التفاعل أكثر من 10 دقائق. سجّل الدخول مرة أخرى.');
  }
  ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'mousemove'].forEach(ev =>
    window.addEventListener(ev, () => touch(false), { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) idleCheck(); });
  window.addEventListener('pageshow', idleCheck);
  function startIdleWatch() { touch(true); if (!idleTimer) idleTimer = setInterval(idleCheck, 15000); }
  function stopIdleWatch() { clearInterval(idleTimer); idleTimer = null; sset(null); }

  window.dqInitAuth = function () {
    const hasAccts = Object.keys(LS.get('mk_offline_auth', {})).length;
    const rec = sget(), acct = rec && rec.u && LS.get('mk_offline_auth', {})[rec.u];
    if (restoring) return;   // الدالة تُستدعى مرتين عند التحميل (index.html وهذا الملف)
    if (acct && acct.profile && Date.now() - (rec.t || 0) < IDLE_MS) {
      restoring = true; gate('login'); const m = $('dqAuthMessage'); if (m) m.textContent = 'جارٍ استعادة جلستك…';
      lastAct = rec.t;
      enter(acct.profile, acct.office, !navigator.onLine).then(startIdleWatch).catch(e => {
        console.warn('restore session failed', e); sset(null); gate('login');
      }).then(() => { restoring = false; });
      return;
    }
    sset(null);
    gate(hasAccts ? 'login' : 'register');
    if (sessionNotice) { const m = $('dqAuthMessage'); if (m) m.textContent = sessionNotice; sessionNotice = ''; }
  };
  window.dqSubmitAuth = async function (ev) {
    ev.preventDefault();
    const mode = $('dqAuthForm').dataset.mode;
    if (mode !== 'mk-login' && mode !== 'mk-register') return origSubmit(ev);
    const btn = $('dqAuthSubmit'), label = btn.textContent; btn.disabled = true; btn.textContent = 'جارٍ المعالجة…';
    try { if (mode === 'mk-register') await register(); else await login(); }
    catch (e) { if (!(e && (e.user || e.network))) console.error(e); alert(friendly(e)); }
    finally { btn.disabled = false; btn.textContent = label; }
    return false;
  };

  async function login() {
    const username = ($('dqAuthUsername').value || '').trim().toLowerCase(), password = $('dqAuthPassword').value || '';
    if (!validUser(username) || !password) throw uerr('أدخل اسم الدخول وكلمة المرور.');
    let r;
    try { r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: username + DOMAIN, password } }); }
    catch (e) {
      if (e.network) return offlineLogin(username, password);
      if (e.status === 400 || e.status === 401 || e.status === 422) {
        if (/not confirmed|email_not_confirmed|email_provider_disabled|disabled/i.test(e.message + ' ' + JSON.stringify(e.data || ''))) throw e;
        throw uerr('بيانات الدخول غير صحيحة. تأكد من اسم الدخول وكلمة المرور، وأن المستخدم موجود في Supabase ببريد ' + username + DOMAIN);
      }
      throw e;
    }
    await finishLogin(r, username, password);
  }
  async function offlineLogin(username, password) {
    const rec = LS.get('mk_offline_auth', {})[username];
    if (!rec) throw uerr('لا يمكن الدخول بدون إنترنت لأول مرة على هذا الجهاز. اتصل بالإنترنت وسجّل الدخول مرة واحدة.');
    if (await derive(password, rec.salt, rec.iter) !== rec.hash) throw uerr('بيانات الدخول غير صحيحة.');
    await enter(rec.profile, rec.office, true);
  }
  async function register() {
    const office = ($('mkOfficeName').value || '').trim(), name = ($('dqAuthName').value || '').trim();
    const username = ($('dqAuthUsername').value || '').trim().toLowerCase();
    const pw = $('dqAuthPassword').value || '', pw2 = $('dqAuthPassword2').value || '';
    if (office.length < 2 || !name) throw uerr('أكمل اسم المكتب واسم المدير.');
    if (!validUser(username)) throw uerr('اسم الدخول: حروف إنجليزية صغيرة وأرقام ونقطة وشرطة فقط (من 3 إلى 30).');
    if (pw.length < 8) throw uerr('كلمة المرور 8 أحرف على الأقل.');
    if (pw !== pw2) throw uerr('كلمتا المرور غير متطابقتين.');
    if (!navigator.onLine) throw uerr('إنشاء مكتب جديد يحتاج اتصالًا بالإنترنت.');
    const email = username + DOMAIN; let r;
    try { r = await api('/auth/v1/signup', { method: 'POST', body: { email, password: pw } }); }
    catch (e) {
      if (e.network) throw e;
      if (/registered|already|exists/i.test(e.message + ' ' + JSON.stringify(e.data || ''))) {
        try { r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: pw } }); }
        catch { throw uerr('اسم الدخول مستخدم بالفعل، اختر اسمًا آخر.'); }
      } else throw e;
    }
    if (!r || !r.access_token) throw uerr('إعداد Supabase: عطّل خيار «Confirm email» من Authentication ← Providers ← Email ثم أعد المحاولة.');
    saveSession(r);
    const exist = await api('/rest/v1/profiles?user_id=eq.' + r.user.id + '&select=user_id', { token: r.access_token });
    if (exist.length) throw uerr('هذا الحساب موجود بالفعل. استخدم «تسجيل الدخول».');
    await api('/rest/v1/rpc/create_office', { method: 'POST', token: r.access_token,
      body: { p_office_name: office, p_full_name: name, p_username: username, p_permissions: DQ_MODULES.map(m => m[0]) } });
    await finishLogin(r, username, pw);
  }
  async function finishLogin(r, username, password) {
    saveSession(r);
    const tok = r.access_token, uid = r.user.id;
    const prof = (await api('/rest/v1/profiles?user_id=eq.' + uid + '&select=*', { token: tok }))[0];
    if (!prof) throw uerr('هذا الحساب غير مكتمل. إن كنت مدير مكتب جديدًا فاستخدم «إنشاء مكتب جديد» بنفس البيانات.');
    if (prof.active === false) { removeOffline(username); throw uerr('هذا الحساب موقوف. تواصل مع مدير المكتب.'); }
    let office = null;
    if (prof.role !== 'owner') {
      office = (await api('/rest/v1/offices?id=eq.' + prof.office_id + '&select=*', { token: tok }))[0];
      if (!office || office.active === false) { removeOffline(username); throw uerr('المكتب موقوف. تواصل مع مالك النظام.'); }
    }
    await saveOffline(username, password, prof, office);
    await enter(prof, office, false);
  }
  async function enter(prof, office, offline) {
    const acct = toAccount(prof);
    me = acct;
    if (office) {
      switchOfficeData(office);
      LS.set('mk_office', { id: office.id, name: office.name });
      acct.officeId = office.id;
    }
    if (status && office && status.office_id !== office.id) { status = null; localStorage.removeItem('mk_status'); }
    if (acct.role === 'manager') anns = LS.get('mk_ann_' + acct.id, []);
    perms = acct.role === 'manager' ? null : LS.get('mk_perms_' + acct.id, null); lastPermAt = 0;
    dqCurrentAccount = Object.assign({}, acct);
    if (office && !offline) {
      $('dqAuthMessage').textContent = 'جارٍ تحميل بيانات المكتب…';
      try { await Promise.race([syncAll(), new Promise(res => setTimeout(res, 15000))]); } catch { }
    }
    dqEnterApp();
    if (office) startSync();
  }

  window.dqEnterApp = function () {
    origEnter();
    startIdleWatch();
    if (me && me.role !== 'owner') { ensureBell(); renderSub(); }
    if (dqCurrentAccount && dqCurrentAccount.role === 'owner') {
      document.querySelectorAll('.nav-item[data-page]').forEach(b => { b.style.display = b.dataset.page === 'accounts' ? 'flex' : 'none'; });
      document.querySelectorAll('.nav-section').forEach(s => { s.style.display = 'none'; });
      showPage('accounts');
    }
  };
  window.dqLogout = function () {
    if (me && officeId()) { syncAll().catch(() => { }); }
    stopSync(); stopIdleWatch(); me = null; hideSubUI(); annShown = false; anns = []; origLogout(); setStatus();
    if (sessionNotice) { const m = $('dqAuthMessage'); if (m) m.textContent = sessionNotice; sessionNotice = ''; }
  };

  /* ---------------- إدارة الحسابات (المدير) ---------------- */
  const _rda = window.renderDQAccounts;
  window.renderDQAccounts = function () {
    const u = dqCurrentAccount;
    if (u && u.role === 'owner') return renderOwner();
    _rda.apply(this, arguments);
    if (!u || u.role !== 'manager') return;
    const sel = $('dqAccRole');
    if (sel && !sel.querySelector('option[value="client"]')) {
      const o = document.createElement('option'); o.value = 'client'; o.textContent = 'موكل'; sel.appendChild(o);
      const ed = dqAccounts().find(x => x.id === dqEditingAccountId);
      if (ed) sel.value = ed.role;
      dqRenderClientLink((ed && ed.clientId) || ''); dqRenderPermEditor((ed && ed.permissions) || dqDefaultPerms(sel.value));
    }
    if (dqEditingAccountId) {
      const un = $('dqAccUsername'); if (un) un.disabled = true;
      const pw = $('dqAccPassword'); if (pw) { pw.required = false; const g = pw.closest('.form-group'); if (g) g.style.display = 'none'; }
    }
    document.querySelectorAll('.dq-user-row').forEach(row => {
      if (row.querySelector('.mk-del')) return;
      const m = /dqEditAccount\('([^']+)'\)/.exec(row.innerHTML); if (!m) return;
      const box = row.lastElementChild; if (!box) return;
      const b = document.createElement('button'); b.className = 'btn btn-danger btn-sm mk-del'; b.textContent = 'حذف';
      b.onclick = () => dqDeleteAccount(m[1]); box.appendChild(b);
    });
  };
  window.dqSaveAccount = async function (id) {
    const g = i => ($(i) || {}).value || '', cur = dqCurrentAccount;
    if (!cur || cur.role !== 'manager') return alert('إدارة الحسابات لمدير المكتب فقط.');
    if (isRO()) return alert('المكتب في وضع العرض فقط. جدّد الاشتراك أولًا.');
    const name = g('dqAccName').trim(), username = g('dqAccUsername').trim().toLowerCase(), password = g('dqAccPassword'), role = g('dqAccRole') || 'lawyer';
    if (!name || !username) return alert('أدخل الاسم واسم الدخول.');
    if (!validUser(username)) return alert('اسم الدخول: حروف إنجليزية صغيرة وأرقام ونقطة وشرطة فقط (من 3 إلى 30).');
    if (!['lawyer', 'client'].includes(role)) return alert('يمكنك إنشاء حسابات المحامين والموكلين فقط.');
    if (!id && password.length < 8) return alert('كلمة المرور يجب ألا تقل عن 8 أحرف.');
    const clientId = role === 'client' ? g('dqAccClientId') : '';
    if (role === 'client' && !clientId) return alert('اربط حساب الموكل بسجل العميل الخاص به.');
    const nid = arDigits(g('dqLawNid')).replace(/\s/g, '');
    if (role === 'lawyer' && nid && !/^\d{14}$/.test(nid)) return alert('الرقم القومي يجب أن يكون 14 رقمًا.');
    if (!navigator.onLine) return alert('إنشاء الحسابات وتعديلها يحتاج اتصالًا بالإنترنت.');
    const perms = Array.from(document.querySelectorAll('.dqPermCheck:checked')).map(c => c.value);
    const extra = role === 'lawyer' ? { regNo: g('dqLawNo').trim(), nationalId: nid, regGrade: g('dqLawGrade') } : {};
    try {
      let newId = id;
      if (!id) {
        let r;
        try { r = await api('/auth/v1/signup', { method: 'POST', body: { email: username + DOMAIN, password } }); }
        catch (e) { if (!e.network && /registered|already|exists/i.test(e.message + ' ' + JSON.stringify(e.data || ''))) return alert('اسم الدخول مستخدم بالفعل، اختر اسمًا آخر.'); throw e; }
        if (!r || !r.access_token) return alert('إعداد Supabase: عطّل خيار «Confirm email» ثم أعد المحاولة.');
        newId = r.user.id;
        await rpc('add_member', { p_user_id: newId, p_username: username, p_full_name: name, p_role: role, p_permissions: perms, p_client_id: clientId || null, p_extra: extra });
      } else {
        const ex = dqAccounts().find(x => x.id === id) || {};
        await rpc('update_member', { p_user_id: id, p_full_name: name, p_permissions: perms, p_client_id: clientId || null, p_extra: extra, p_active: ex.active !== false });
      }
      if (role === 'lawyer') {
        const nt = v => String(v || '').trim().toLocaleLowerCase('ar'); const ts = DB.get('tasks'); let ch = false;
        ts.forEach(t => { if (!t.assignedAccountId && t.assignee && (nt(t.assignee) === nt(name) || nt(t.assignee).includes(nt(name)) || nt(name).includes(nt(t.assignee)))) { t.assignedAccountId = newId; t.assignee = name; t.updatedAt = new Date().toISOString(); ch = true; } });
        if (ch) DB.set('tasks', ts);
      }
      try { const lg = JSON.parse(localStorage.getItem('dq_activity_log') || '[]'); lg.unshift({ id: DB.uid(), at: new Date().toISOString(), accountId: cur.id, accountName: cur.name, role: cur.role, section: 'accounts', operation: id ? 'تعديل حساب' : 'إنشاء حساب', targetName: name }); localStorage.setItem('dq_activity_log', JSON.stringify(lg.slice(0, 1000))); } catch { }
      await syncMembers(); dqEditingAccountId = null; renderDQAccounts();
      alert(id ? 'تم حفظ التعديلات.' : 'تم إنشاء الحساب. سلّم اسم الدخول وكلمة المرور لصاحبه؛ يستطيع تغيير كلمة المرور بعد الدخول.');
    } catch (e) { console.error(e); alert(friendly(e)); }
  };
  window.dqToggleAccount = async function (id) {
    const u = dqAccounts().find(x => x.id === id); if (!u) return;
    if (isRO()) return alert('المكتب في وضع العرض فقط. جدّد الاشتراك أولًا.');
    if (!navigator.onLine) return alert('هذه العملية تحتاج اتصالًا بالإنترنت.');
    try {
      await rpc('update_member', { p_user_id: id, p_full_name: u.name, p_permissions: u.permissions, p_client_id: u.clientId || null,
        p_extra: { regNo: u.regNo || '', nationalId: u.nationalId || '', regGrade: u.regGrade || '' }, p_active: u.active === false });
      await syncMembers(); renderDQAccounts();
    } catch (e) { alert(friendly(e)); }
  };
  window.dqDeleteAccount = async function (id) {
    if (isRO()) return alert('المكتب في وضع العرض فقط. جدّد الاشتراك أولًا.');
    if (!confirm('حذف هذا الحساب نهائيًا؟ لن تُحذف بيانات القضايا.')) return;
    if (!navigator.onLine) return alert('هذه العملية تحتاج اتصالًا بالإنترنت.');
    try { await rpc('delete_member', { p_user_id: id }); await syncMembers(); renderDQAccounts(); } catch (e) { alert(friendly(e)); }
  };
  async function callAdmin(action, payload) {
    const t = await token();
    let res;
    try {
      res = await fetch(BASE + '/functions/v1/admin-members', { method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.anonKey, Authorization: 'Bearer ' + t },
        body: JSON.stringify(Object.assign({ action }, payload)) });
    } catch (e) { throw netErr(); }
    let d = null; try { d = await res.json(); } catch (e) { }
    if (res.ok && d && d.ok) return d;
    const code = d && d.error;
    const map = { forbidden: 'غير مسموح لك بهذه العملية.', not_found: 'الحساب غير موجود في مكتبك.',
      weak_password: 'كلمة المرور من 8 إلى 72 حرفًا.', office_readonly: 'المكتب في وضع العرض فقط. جدّد الاشتراك أولًا.',
      rate_limited: 'محاولات كثيرة. حاول بعد ساعة.', unauthorized: 'انتهت الجلسة. اخرج وسجّل الدخول من جديد.',
      update_failed: 'رفض Supabase كلمة المرور' + (d && d.detail ? ': ' + d.detail : '') };
    if (res.status === 404 && !code) throw uerr('دالة admin-members غير منشورة في Supabase بعد. انشرها أولًا (خطوات النشر في README).');
    throw uerr(map[code] || ('تعذر التنفيذ (HTTP ' + res.status + ')'));
  }
  window.dqResetAccountPassword = function (id) {
    const cur = dqCurrentAccount;
    if (!cur || cur.role !== 'manager') return alert('تغيير كلمات المرور لمدير المكتب فقط.');
    if (isRO()) return alert('المكتب في وضع العرض فقط. جدّد الاشتراك أولًا.');
    const u = dqAccounts().find(x => x.id === id); if (!u) return;
    if (!navigator.onLine) return alert('هذه العملية تحتاج اتصالًا بالإنترنت.');
    const p1 = inp('password', 'كلمة المرور الجديدة (8 أحرف على الأقل)'), p2 = inp('password', 'تأكيد كلمة المرور');
    p1.autocomplete = p2.autocomplete = 'new-password'; p1.style.direction = p2.style.direction = 'ltr';
    const body = el('div');
    body.append(el('p', 'سيدخل «' + u.name + '» بكلمة المرور الجديدة. سلّمها له بطريقة آمنة.', 'font-size:13px;opacity:.8'),
      fld('كلمة المرور الجديدة', p1), fld('تأكيد كلمة المرور', p2));
    mkModal('تغيير كلمة مرور: ' + u.name, body, 'تغيير', async () => {
      if (p1.value.length < 8) { alert('كلمة المرور 8 أحرف على الأقل.'); return false; }
      if (p1.value !== p2.value) { alert('كلمتا المرور غير متطابقتين.'); return false; }
      await callAdmin('reset_password', { user_id: id, new_password: p1.value });
      alert('تم تغيير كلمة المرور. يلزم صاحب الحساب الدخول بها من جديد.');
      syncMembers();
    });
  };
  window.dqChangeOwnPassword = async function () {
    if (!dqCurrentAccount) return;
    const oldP = ($('dqOwnOldPassword') || {}).value || '', newP = ($('dqOwnNewPassword') || {}).value || '';
    if (newP.length < 8) return alert('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.');
    if (!navigator.onLine) return alert('تغيير كلمة المرور يحتاج اتصالًا بالإنترنت.');
    try {
      let r;
      try { r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: dqCurrentAccount.username + DOMAIN, password: oldP } }); }
      catch (e) { if (e.network) throw e; return alert('كلمة المرور الحالية غير صحيحة.'); }
      await api('/auth/v1/user', { method: 'PUT', token: r.access_token, body: { password: newP } });
      saveSession(r);
      const a = LS.get('mk_offline_auth', {})[dqCurrentAccount.username];
      await saveOffline(dqCurrentAccount.username, newP, a ? a.profile : toRaw(dqCurrentAccount), a && a.office);
      $('dqOwnOldPassword').value = ''; $('dqOwnNewPassword').value = '';
      alert('تم تغيير كلمة المرور.');
    } catch (e) { alert(friendly(e)); }
  };
  const toRaw = a => ({ user_id: a.id, office_id: a.officeId, username: a.username, full_name: a.name, role: a.role, permissions: a.permissions, client_id: a.clientId, active: a.active, pw_version: a.pwVersion || 0, extra: { regNo: a.regNo, nationalId: a.nationalId, regGrade: a.regGrade } });

  /* ---------------- الاشتراك (تجربة/مدفوع/عرض فقط/إيقاف) ---------------- */
  const PAY_NUMBER = '01098848735', DAY = 86400000;
  let status = LS.get('mk_status', null);
  let hwm = Number(localStorage.getItem('mk_hwm')) || 0, hwmSaved = 0, lastStatusAt = 0, lastAnnAt = 0;
  let subTimer = null, lastSubState = '', anns = [], annShown = false, ownerOffices = [];
  let perms = null, lastPermAt = 0;   // صلاحيات الكتابة/القراءة كما تحسبها القاعدة

  // أعلى وقت شوهد (جهاز أو خادم): يقلّل أثر إرجاع ساعة الجهاز أوفلاين
  function nowMs() {
    const n = Date.now();
    if (n > hwm) { hwm = n; if (n - hwmSaved > 30000) { hwmSaved = n; _setItem.call(localStorage, 'mk_hwm', String(n)); } }
    return hwm;
  }
  function calcState(o, now) {   // o: {active, trial_ends_at, paid_until}
    const t = Date.parse(o.trial_ends_at), p = o.paid_until ? Date.parse(o.paid_until) : 0, end = Math.max(t, p);
    if (o.active === false || o.manual_stop) return 'suspended';
    if (now > end + 2 * DAY) return 'suspended';
    if (now > end) return 'readonly';
    if (end - now <= 7 * DAY) return 'expiring';
    return p && p >= t ? 'active' : 'trial';
  }
  function subState() {
    if (!me || me.role === 'owner' || !status || !status.ends_at) return 'trial';
    return calcState({ trial_ends_at: status.trial_ends_at, paid_until: status.paid_until, manual_stop: status.manual_stop }, nowMs());
  }
  const isRO = () => { const s = subState(); return s === 'readonly' || s === 'suspended'; };
  function fmtLeft(ms) {
    ms = Math.max(0, ms); const p = x => String(x).padStart(2, '0');
    const d = Math.floor(ms / DAY), h = Math.floor(ms % DAY / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
    return (d ? d + ' يوم ' : '') + p(h) + ':' + p(m) + ':' + p(s);
  }
  let toastT = 0;
  function toast(m) {
    let t = $('mkToast');
    if (!t) { t = document.createElement('div'); t.id = 'mkToast';
      t.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px 16px;border-radius:10px;z-index:9997;font-size:13px;max-width:90%;text-align:center;direction:rtl';
      document.body.appendChild(t); }
    t.textContent = m; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 3500);
  }
  function canWrite(c) {
    if (!me || me.role === 'manager' || me.role === 'owner' || !perms || !Array.isArray(perms.write)) return true;
    return perms.write.includes(c);
  }
  async function syncPerms(force) {
    if (!me || !officeId() || me.role === 'manager' || !navigator.onLine || !session || session.user_id !== me.id) return;
    if (!force && Date.now() - lastPermAt < 60000) return;
    try {
      const r = await rpc('my_permissions'); lastPermAt = Date.now();
      if (r && Array.isArray(r.write)) { perms = r; LS.set('mk_perms_' + me.id, r); }
    } catch (e) { if (!e.network) console.warn('[mk perms]', e.message); }
  }
  async function syncStatus(force) {
    if (!me || !officeId() || !navigator.onLine || !session || session.user_id !== me.id) return;
    if (!force && Date.now() - lastStatusAt < 60000) return;
    try {
      const r = await rpc('my_office_status'); lastStatusAt = Date.now();
      if (r && r.state && r.state !== 'none') {
        status = r; LS.set('mk_status', r);
        const sn = Date.parse(r.server_now); if (sn > hwm) { hwm = sn; _setItem.call(localStorage, 'mk_hwm', String(hwm)); }
      }
    } catch (e) { if (!e.network) console.warn('[mk status]', e.message); }
    renderSub();
  }
  function ensureBar() {
    let b = $('mkSubBar'); if (b) return b;
    b = document.createElement('div'); b.id = 'mkSubBar';
    b.style.cssText = 'position:sticky;top:0;z-index:60;display:none;text-align:center;padding:8px 12px;font-size:13px;font-weight:600;color:#fff;line-height:1.7';
    const host = document.querySelector('.main') || document.body; host.insertBefore(b, host.firstChild);
    if (!$('mkSubCss')) { const st = document.createElement('style'); st.id = 'mkSubCss'; st.textContent = '.topbar{top:var(--mk-bar-h,0px)!important}'; document.head.appendChild(st); }
    return b;
  }
  function renderSub() {
    if (!me || me.role === 'owner') { hideSubUI(); return; }
    const st = subState(), b = ensureBar();
    if (st !== lastSubState) { lastSubState = st; setStatus(); }
    const mgr = me.role === 'manager', n = nowMs(), end = status && status.ends_at ? Date.parse(status.ends_at) : 0;
    let txt = '', bg = '';
    if (st === 'expiring' && mgr) {
      const paid = status.paid_until && Date.parse(status.paid_until) >= Date.parse(status.trial_ends_at);
      bg = '#b45309';
      txt = '⏳ ' + (paid ? 'اشتراكك' : 'الفترة المجانية') + ' تنتهي بعد ' + fmtLeft(end - n) + ' — للتجديد حوّل إلى ' + PAY_NUMBER + ' (فودافون كاش أو فوري) وأبلغ المالك.';
    } else if (st === 'readonly') {
      bg = '#b3261e';
      txt = mgr ? '🔒 انتهى الاشتراك: المكتب في وضع العرض فقط، ويُوقف الحساب بعد ' + fmtLeft(end + 2 * DAY - n) + ' — للتجديد حوّل إلى ' + PAY_NUMBER + ' (فودافون كاش أو فوري) وأبلغ المالك.'
        : '🔒 المكتب في وضع العرض فقط حاليًا. تواصل مع مدير المكتب.';
    }
    if (txt) { b.style.display = 'block'; b.style.background = bg; if (b.textContent !== txt) b.textContent = txt; } else b.style.display = 'none';
    document.documentElement.style.setProperty('--mk-bar-h', txt ? b.offsetHeight + 'px' : '0px');
    showLock(st === 'suspended');
  }
  function showLock(on) {
    let l = $('mkLock');
    if (!on) { if (l && l.remove) l.remove(); return; }
    if (l) return;
    l = document.createElement('div'); l.id = 'mkLock';
    l.style.cssText = 'position:fixed;inset:0;z-index:9998;background:#0b1f33;color:#fff;display:flex;align-items:center;justify-content:center;padding:20px;direction:rtl;text-align:center;overflow:auto';
    const box = document.createElement('div'); box.style.cssText = 'max-width:440px;line-height:1.9';
    const mgr = me.role === 'manager', manual = status && status.manual_stop;
    const mk = (tag, txt, css) => { const e = document.createElement(tag); e.textContent = txt; if (css) e.style.cssText = css; return e; };
    box.append(mk('div', '🔒', 'font-size:44px'), mk('h2', 'الحساب موقوف', 'margin:6px 0 12px'));
    if (manual) box.append(mk('p', 'تم إيقاف هذا المكتب من قبل إدارة النظام. للاستفسار تواصل مع المالك على الرقم ' + PAY_NUMBER + '.'));
    else if (mgr) {
      box.append(mk('p', 'انتهى اشتراك مكتبك وانتهت فترة العرض فقط. لتجديد الاشتراك حوّل المبلغ عبر فودافون كاش أو فوري إلى الرقم:'),
        mk('div', PAY_NUMBER, 'font-size:26px;font-weight:800;letter-spacing:2px;direction:ltr;margin:8px 0'),
        mk('p', 'ثم أرسل إيصال التحويل إلى المالك على الرقم نفسه ليتم التجديد، وبعدها اضغط «تحديث الحالة».', 'opacity:.9'));
    } else box.append(mk('p', 'هذا المكتب موقوف حاليًا. تواصل مع مدير المكتب.'));
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:14px';
    const btn = (t, fn) => { const x = mk('button', t, 'padding:10px 16px;border:0;border-radius:8px;font:inherit;background:#c99a3e;color:#0b1f33;font-weight:700'); x.onclick = fn; return x; };
    row.append(btn('🔄 تحديث الحالة', async () => { await syncStatus(true); if (!isRO()) syncAll(); }));
    if (mgr && !manual) row.append(btn('📋 نسخ الرقم', () => { try { navigator.clipboard.writeText(PAY_NUMBER); toast('تم نسخ الرقم'); } catch { } }));
    row.append(btn('خروج', () => dqLogout()));
    box.append(row); l.append(box); document.body.appendChild(l);
  }
  function hideSubUI() {
    ['mkSubBar', 'mkLock', 'mkBell'].forEach(id => { const e = $(id); if (e && e.remove) e.remove(); });
    document.documentElement.style.setProperty('--mk-bar-h', '0px'); lastSubState = '';
  }

  /* ---------------- تنبيهات المالك (جهة المدير) ---------------- */
  const readSet = () => new Set(me ? LS.get('mk_ann_read_' + me.id, []) : []);
  const unread = () => { const r = readSet(); return anns.filter(a => !r.has(a.id)); };
  async function syncAnnouncements(force) {
    if (!me || me.role !== 'manager' || !navigator.onLine || !session || session.user_id !== me.id) return;
    if (!force && Date.now() - lastAnnAt < 60000) return;
    try {
      anns = await rest('/rest/v1/announcements?select=*&order=created_at.desc&limit=100'); lastAnnAt = Date.now();
      LS.set('mk_ann_' + me.id, anns); ensureBell(); renderBell();
      if (!annShown && unread().length) { annShown = true; openAnn(); }
    } catch (e) { if (!e.network) console.warn('[mk ann]', e.message); }
  }
  function ensureBell() {
    if (!me || me.role !== 'manager') { const b = $('mkBell'); if (b && b.remove) b.remove(); return; }
    if ($('mkBell')) return;
    const host = document.querySelector('.topbar-actions'); if (!host) return;
    const b = document.createElement('button'); b.id = 'mkBell'; b.className = 'btn btn-outline'; b.title = 'تنبيهات الإدارة';
    b.style.cssText = 'position:relative;padding:6px 10px'; b.textContent = '🔔';
    const n = document.createElement('span'); n.id = 'mkBellN';
    n.style.cssText = 'display:none;position:absolute;top:-6px;left:-6px;background:#b3261e;color:#fff;border-radius:999px;font-size:11px;min-width:18px;height:18px;line-height:18px;text-align:center';
    b.appendChild(n); b.onclick = openAnn; host.insertBefore(b, host.firstChild); renderBell();
  }
  function renderBell() { const n = $('mkBellN'); if (!n) return; const c = unread().length; n.style.display = c ? 'block' : 'none'; n.textContent = String(c); }
  function openAnn() {
    const r = readSet(), ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow:auto;direction:rtl';
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--card,#fff);color:var(--text,#111);border-radius:12px;max-width:520px;width:100%;padding:16px;margin-top:40px';
    const h = document.createElement('h3'); h.textContent = '🔔 تنبيهات الإدارة'; card.appendChild(h);
    if (!anns.length) { const p = document.createElement('p'); p.textContent = 'لا توجد تنبيهات.'; card.appendChild(p); }
    anns.forEach(a => {
      const col = { info: '#1d6fb8', warning: '#b45309', urgent: '#b3261e' }[a.severity] || '#1d6fb8';
      const d = document.createElement('div'); d.style.cssText = 'border-right:4px solid ' + col + ';background:rgba(0,0,0,.04);padding:10px 12px;border-radius:8px;margin:10px 0';
      const t = document.createElement('div'); t.style.fontWeight = '700'; t.textContent = (r.has(a.id) ? '' : '🆕 ') + a.title;
      const bd = document.createElement('div'); bd.style.whiteSpace = 'pre-wrap'; bd.textContent = a.body;
      const dt = document.createElement('div'); dt.style.cssText = 'font-size:12px;opacity:.7;margin-top:4px'; dt.textContent = new Date(a.created_at).toLocaleString('ar-EG');
      d.append(t, bd, dt); card.appendChild(d);
    });
    const c = document.createElement('button'); c.className = 'btn btn-primary'; c.textContent = 'إغلاق'; c.onclick = () => ov.remove(); card.appendChild(c);
    ov.appendChild(card); ov.onclick = e => { if (e.target === ov) ov.remove(); }; document.body.appendChild(ov);
    if (me) LS.set('mk_ann_read_' + me.id, anns.map(a => a.id)); renderBell();
  }

  /* ---------------- لوحة المالك: المكاتب + الاشتراكات + التنبيهات ---------------- */
  const el = (tag, txt, css) => { const e = document.createElement(tag); if (txt != null) e.textContent = txt; if (css) e.style.cssText = css; return e; };
  const fld = (label, ctl) => { const g = el('div'); g.className = 'form-group'; g.append(el('label', label), ctl); return g; };
  const inp = (type, ph) => { const i = el('input'); i.type = type; if (ph) i.placeholder = ph; return i; };
  const sel = opts => { const s = el('select'); opts.forEach(([v, t]) => { const o = el('option', t); o.value = v; s.appendChild(o); }); return s; };
  const obtn = (t, fn, cls) => { const b = el('button', t); b.className = 'btn ' + (cls || 'btn-outline') + ' btn-sm'; b.onclick = fn; return b; };
  function mkModal(title, body, okText, onOk) {
    const ov = el('div', null, 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow:auto;direction:rtl');
    const card = el('div', null, 'background:var(--card,#fff);color:var(--text,#111);border-radius:12px;max-width:480px;width:100%;padding:16px;margin-top:30px');
    const row = el('div', null, 'display:flex;gap:8px;margin-top:12px');
    const no = obtn('إغلاق', () => ov.remove());
    if (onOk) {
      const ok = obtn(okText || 'حفظ', async () => {
        ok.disabled = true;
        try { if (await onOk() !== false) ov.remove(); } catch (e) { alert(friendly(e)); } finally { ok.disabled = false; }
      }, 'btn-primary'); row.append(ok);
    }
    row.append(no); card.append(el('h3', title, 'margin-bottom:10px'), body, row); ov.appendChild(card);
    ov.onclick = e => { if (e.target === ov) ov.remove(); }; document.body.appendChild(ov); return ov;
  }
  const fmtDate = v => v ? new Date(v).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const toLocalInput = v => { if (!v) return ''; const d = new Date(v), p = x => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const STATE_AR = { trial: 'تجريبي', active: 'مدفوع', expiring: 'ينتهي قريبًا', readonly: 'عرض فقط', suspended: 'موقوف' };

  async function renderOwner() {
    const wrap = $('dqAccountFormWrap'), list = $('dqAccountsList'), log = $('dqActivityLog');
    if (!wrap || !list) return;
    if (log) log.textContent = '';
    wrap.textContent = ''; list.textContent = 'جارٍ التحميل…';
    try {
      const [offs, profs, annList] = await Promise.all([
        rest('/rest/v1/offices?select=*&order=created_at.desc'),
        rest('/rest/v1/profiles?select=office_id,full_name,username,role,active'),
        rest('/rest/v1/announcements?select=*&order=created_at.desc&limit=50').catch(() => [])]);
      ownerOffices = offs;
      // ---- نموذج التنبيه ----
      const box = el('div'); box.append(el('h3', '📣 إرسال تنبيه للمديرين', 'margin-bottom:6px'),
        el('p', 'يظهر التنبيه في حساب المدير حتى تحذفه أنت.', 'font-size:13px;opacity:.75;margin-bottom:8px'));
      const t = inp('text', 'عنوان التنبيه'), b = el('textarea'); b.rows = 3; b.placeholder = 'نص التنبيه'; b.style.width = '100%';
      const sv = sel([['info', 'معلومة'], ['warning', 'تحذير'], ['urgent', 'عاجل']]);
      const tg = sel([['', 'كل المديرين']].concat(offs.map(o => [o.id, 'مكتب: ' + o.name])));
      box.append(fld('العنوان', t), fld('النص', b), fld('الأهمية', sv), fld('المستهدف', tg));
      box.append(obtn('إرسال التنبيه', async () => {
        if (!t.value.trim() || !b.value.trim()) return alert('اكتب العنوان والنص.');
        try { await rpc('create_announcement', { p_title: t.value, p_body: b.value, p_severity: sv.value, p_target_office_id: tg.value || null }); renderOwner(); }
        catch (e) { alert(friendly(e)); }
      }, 'btn-primary'));
      box.append(el('h4', 'التنبيهات الحالية', 'margin:16px 0 6px'));
      if (!annList.length) box.append(el('p', 'لا توجد تنبيهات.', 'opacity:.7'));
      annList.forEach(a => {
        const o = offs.find(x => x.id === a.target_office_id);
        const row = el('div', null, 'border-right:4px solid ' + ({ info: '#1d6fb8', warning: '#b45309', urgent: '#b3261e' }[a.severity] || '#1d6fb8') + ';background:rgba(0,0,0,.04);padding:8px 10px;border-radius:8px;margin:6px 0');
        row.append(el('div', a.title, 'font-weight:700'), el('div', a.body, 'white-space:pre-wrap;font-size:13px'),
          el('div', (o ? 'إلى: ' + o.name : 'إلى: كل المديرين') + ' · ' + fmtDate(a.created_at), 'font-size:12px;opacity:.7;margin:4px 0'),
          obtn('حذف', async () => { if (!confirm('حذف هذا التنبيه؟ سيختفي من حسابات المديرين.')) return;
            try { await rpc('delete_announcement', { p_id: a.id }); renderOwner(); } catch (e) { alert(friendly(e)); } }, 'btn-danger'));
        box.append(row);
      });
      wrap.append(box);
      // ---- المكاتب ----
      list.textContent = '';
      list.append(el('h3', 'المكاتب المسجلة', 'margin:6px 0'));
      if (!offs.length) list.append(el('p', 'لا توجد مكاتب بعد.', 'opacity:.7'));
      const now = Date.now();
      offs.forEach(o => {
        const mem = profs.filter(p => p.office_id === o.id), mgr = mem.find(p => p.role === 'manager');
        const st = calcState(o, now), end = Math.max(Date.parse(o.trial_ends_at), o.paid_until ? Date.parse(o.paid_until) : 0);
        const left = Math.ceil((end - now) / DAY);
        const row = el('div'); row.className = 'dq-user-row';
        const info = el('div'); info.append(el('strong', o.name));
        const meta = el('div', 'المدير: ' + (mgr ? mgr.full_name + ' (' + mgr.username + ')' : '—') + ' · ' + mem.length + ' حساب · الحالة: ' +
          (o.active === false ? 'موقوف يدويًا' : STATE_AR[st]) + ' · ينتهي: ' + fmtDate(end) + (left >= 0 ? ' (باقي ' + left + ' يوم)' : ' (منتهٍ)'));
        meta.className = 'dq-user-meta'; info.append(meta);
        const act = el('div', null, 'display:flex;gap:6px;flex-wrap:wrap');
        act.append(obtn('تجديد', () => mkRenew(o.id), 'btn-primary'), obtn('الدفعات', () => mkPays(o.id)), obtn('تصحيح التواريخ', () => mkAdjust(o.id)),
          obtn(o.active ? 'إيقاف يدوي' : 'إلغاء الإيقاف', () => window.mkToggleOffice(o.id, !o.active)));
        row.append(info, act); list.append(row);
      });
    } catch (e) { list.textContent = friendly(e); }
  }
  function mkRenew(id) {
    const o = ownerOffices.find(x => x.id === id); if (!o) return;
    const dur = sel([['30', '30 يومًا'], ['90', '90 يومًا (3 شهور)'], ['180', '180 يومًا (6 شهور)'], ['365', 'سنة'], ['custom', 'عدد أيام مخصص'], ['until', 'حتى تاريخ محدد']]);
    const days = inp('number', 'عدد الأيام'), until = inp('date'), amount = inp('number', 'المبلغ (اختياري)');
    const method = sel([['فودافون كاش', 'فودافون كاش'], ['فوري', 'فوري'], ['أخرى', 'أخرى']]), ref = inp('text', 'رقم العملية / المرجع'), note = inp('text', 'ملاحظة');
    const gd = fld('عدد الأيام', days), gu = fld('تاريخ الانتهاء', until); gd.style.display = gu.style.display = 'none';
    dur.onchange = () => { gd.style.display = dur.value === 'custom' ? '' : 'none'; gu.style.display = dur.value === 'until' ? '' : 'none'; };
    const body = el('div'); body.append(fld('المدة', dur), gd, gu, fld('المبلغ', amount), fld('وسيلة الدفع', method), fld('المرجع', ref), fld('ملاحظة', note));
    mkModal('تجديد اشتراك: ' + o.name, body, 'تأكيد التجديد', async () => {
      let d = null, u = null;
      if (dur.value === 'until') { if (!until.value) { alert('اختر التاريخ.'); return false; } u = new Date(until.value + 'T23:59:59').toISOString(); }
      else { d = dur.value === 'custom' ? parseInt(days.value, 10) : parseInt(dur.value, 10); if (!(d > 0)) { alert('أدخل عدد أيام صحيحًا.'); return false; } }
      const r = await rpc('renew_subscription', { p_office_id: id, p_days: d, p_until: u, p_amount: amount.value ? Number(amount.value) : null,
        p_method: method.value, p_reference: ref.value, p_note: note.value });
      alert('تم التجديد. ينتهي الاشتراك: ' + fmtDate(r && r.ends_at)); renderOwner();
    });
  }
  async function mkPays(id) {
    const o = ownerOffices.find(x => x.id === id); if (!o) return;
    const body = el('div', 'جارٍ التحميل…');
    mkModal('دفعات: ' + o.name, body);
    try {
      const rows = await rest('/rest/v1/subscription_payments?office_id=eq.' + id + '&select=*&order=created_at.desc&limit=50');
      body.textContent = ''; if (!rows.length) body.append(el('p', 'لا توجد دفعات مسجلة.'));
      rows.forEach(p => body.append(el('div', fmtDate(p.created_at) + ' — ' + (p.amount != null ? p.amount + ' ج.م' : 'بدون مبلغ') + ' · ' + (p.method || '') + (p.reference ? ' · ' + p.reference : '') +
        ' · +' + (p.days_added || 0) + ' يوم ← ينتهي ' + fmtDate(p.ends_at_after) + (p.note ? ' · ' + p.note : ''), 'padding:6px 0;border-bottom:1px solid rgba(0,0,0,.1);font-size:13px')));
    } catch (e) { body.textContent = friendly(e); }
  }
  function mkAdjust(id) {
    const o = ownerOffices.find(x => x.id === id); if (!o) return;
    const tr = inp('datetime-local'), pd = inp('datetime-local'); tr.value = toLocalInput(o.trial_ends_at); pd.value = toLocalInput(o.paid_until);
    const body = el('div'); body.append(el('p', 'استخدمها لتصحيح خطأ فقط. اترك «نهاية الاشتراك المدفوع» فارغة لإلغائه.', 'font-size:13px;opacity:.75'),
      fld('نهاية الفترة المجانية', tr), fld('نهاية الاشتراك المدفوع', pd));
    mkModal('تصحيح تواريخ: ' + o.name, body, 'حفظ', async () => {
      if (!tr.value) { alert('حدّد نهاية الفترة المجانية.'); return false; }
      await rpc('adjust_office_dates', { p_office_id: id, p_trial_ends_at: new Date(tr.value).toISOString(), p_paid_until: pd.value ? new Date(pd.value).toISOString() : null });
      renderOwner();
    });
  }
  window.mkToggleOffice = async function (id, active) {
    try { await rpc('set_office_active', { p_office_id: id, p_active: active }); renderOwner(); } catch (e) { alert(friendly(e)); }
  };

  /* ---------------- تشغيل ---------------- */
  hookStorage();
  document.removeEventListener('DOMContentLoaded', origInit);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.dqInitAuth());
  else window.dqInitAuth();
  window.MK = { callAdmin, canWrite, syncPerms, syncStatus, calcState, subState, fmtLeft, setStatus_: v => { status = v; }, setMe_: v => { me = v; }, renderSub, diffQueue, enqueue, applyRows, push, pull, syncAll, derive, saveOffline, offlineLogin };
})();
