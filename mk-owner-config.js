/* مكتبي — إعدادات الهيكل بيد المالك (migration-06)
   - يقرأ من Supabase: app_modules / feature_flags / ui_overrides ويطبّقها على التطبيق.
   - يخزّن نسخة محلية (mk_cfg_v1) فيعمل أوفلاين، وإن لم يوجد الجدول بعد يعمل التطبيق كما كان.
   - لوحة المالك تظهر في صفحة «الحسابات» لحساب المالك فقط. لا يمس بيانات المكاتب.
   يُحمَّل بعد mk-cloud.js */
(function () {
  'use strict';
  const LSKEY = 'mk_cfg_v1';
  const PROTECTED = ['dashboard', 'settings', 'accounts'];          // لا يمكن إيقافها
  const FLAGS = [['ai_assistant', '🤖 مساعد الصياغة (الذكاء الاصطناعي)'], ['defenses', '🛡️ دفوع قضيتي'], ['toolkit', '🧰 مساعد المحامي']];
  const THEME = [['--primary-brown', 'اللون الأساسي (الشريط الجانبي)'], ['--accent-gold', 'اللون الذهبي'], ['--bg-beige', 'لون الخلفية']];
  const ZERO = '00000000-0000-0000-0000-000000000000';

  let cfg = { modules: [], flags: [], overrides: [], fields: [] };
  try { const c = JSON.parse(localStorage.getItem(LSKEY)); if (c && Array.isArray(c.modules)) cfg = Object.assign({ fields: [] }, c); } catch (e) { }

  const $ = id => document.getElementById(id);
  // dqCurrentAccount معرّف بـ let في index.html فلا يظهر على window
  const acct = () => { try { return dqCurrentAccount || null; } catch (e) { return null; } };
  const isOwner = () => { const a = acct(); return !!(a && a.role === 'owner'); };
  const myOffice = () => { const a = acct(); return (a && a.officeId) || null; };

  /* ---------- القيمة الفعالة: صف المكتب يغلب الصف العام ---------- */
  function pick(rows, key, office, keyField) {
    keyField = keyField || 'key';
    const mine = rows.find(r => r[keyField] === key && office && r.office_id === office);
    return mine || rows.find(r => r[keyField] === key && !r.office_id) || null;
  }
  const modRow = (key, office) => pick(cfg.modules, key, office === undefined ? myOffice() : office);
  function modEnabled(key, office) { const r = modRow(key, office); return !r || r.enabled !== false || PROTECTED.includes(key); }
  function flagEnabled(key, office) { const r = pick(cfg.flags, key, office === undefined ? myOffice() : office); return !r || r.enabled !== false; }

  /* ---------- أسماء الأقسام الأصلية (تُلتقط مرة واحدة قبل أي تعديل) ---------- */
  function baseLabel(btn) {
    const c = btn.cloneNode(true);
    c.querySelectorAll('.icon,.badge-count').forEach(n => n.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  }
  function scanNav() {
    document.querySelectorAll('.nav-item[data-page]').forEach(b => { if (b.dataset.mkOrig == null) b.dataset.mkOrig = baseLabel(b); });
  }
  function setLabel(btn, text) {
    for (const n of btn.childNodes) {
      if (n.nodeType === 3 && n.nodeValue.trim()) { n.nodeValue = ' ' + text + ' '; return; }
    }
  }

  /* ---------- التطبيق على الواجهة ---------- */
  function applyTheme() {
    let st = $('mkCfgStyle');
    if (!st) { st = document.createElement('style'); st.id = 'mkCfgStyle'; document.head.appendChild(st); }
    const off = myOffice(), seen = {}, rules = [];
    cfg.overrides.filter(o => o.kind === 'theme' && o.enabled !== false).forEach(o => {
      const p = pick(cfg.overrides.filter(x => x.kind === 'theme' && x.enabled !== false), o.target, off, 'target');
      if (p && !seen[o.target] && /^--[a-z0-9-]{1,40}$/.test(o.target) && !/[;{}<>]|url\s*\(/i.test(p.value)) {
        seen[o.target] = 1; rules.push(o.target + ':' + p.value);
        if (o.target === '--primary-brown') rules.push('--wood-deep:' + p.value, '--wood:' + p.value);
      }
    });
    st.textContent = rules.length ? ':root{' + rules.join(';') + '}' : '';
  }
  function applyTexts() {
    const off = myOffice(), list = cfg.overrides.filter(o => o.kind === 'text' && o.enabled !== false), done = {};
    list.forEach(o => {
      if (done[o.target]) return; done[o.target] = 1;
      const p = pick(list, o.target, off, 'target'); if (!p) return;
      try { const el = document.querySelector(o.target); if (el) el.textContent = p.value; } catch (e) { }
    });
  }
  function refreshNav() {
    if (!acct() || isOwner()) return;               // المالك لا تتأثر شاشته
    const btns = Array.from(document.querySelectorAll('.nav-item[data-page]'));
    btns.forEach(b => {
      const page = b.dataset.page, r = modRow(page);
      b.style.display = (typeof dqHasPerm === 'function' && dqHasPerm(page)) ? 'flex' : 'none';
      if (r && r.label && b.dataset.mkOrig != null) setLabel(b, r.label);
      else if (b.dataset.mkOrig != null && b.dataset.mkRenamed) setLabel(b, b.dataset.mkOrig);
      b.dataset.mkRenamed = r && r.label ? '1' : '';
    });
    // الترتيب داخل كل مجموعة (بين عناوين الأقسام)
    document.querySelectorAll('.nav-section').forEach(sec => {
      const group = []; let n = sec.nextElementSibling;
      while (n && !n.classList.contains('nav-section')) { if (n.classList.contains('nav-item') && n.dataset.page) group.push(n); n = n.nextElementSibling; }
      if (group.length < 2 || !group.some(g => { const r = modRow(g.dataset.page); return r && r.sort_order != null; })) return;
      const idx = g => group.indexOf(g), key = g => { const r = modRow(g.dataset.page); return r && r.sort_order != null ? r.sort_order : 1000 + idx(g); };
      const sorted = group.slice().sort((a, b) => key(a) - key(b));
      const anchor = group[group.length - 1].nextSibling;
      sorted.forEach(g => sec.parentNode.insertBefore(g, anchor));
    });
    document.querySelectorAll('.nav-section').forEach(sec => {
      let n = sec.nextElementSibling, any = false;
      while (n && !n.classList.contains('nav-section')) { if (n.classList.contains('nav-item') && n.style.display !== 'none') any = true; n = n.nextElementSibling; }
      sec.style.display = any ? 'block' : 'none';
    });
    // لو القسم المفتوح حاليًا أُوقف: عُد للوحة التحكم
    const active = document.querySelector('.page.active');
    if (active && active.id.startsWith('page-')) {
      const pg = active.id.slice(5);
      if (typeof dqHasPerm === 'function' && !dqHasPerm(pg) && typeof showPage === 'function') { try { showPage('dashboard'); } catch (e) { } }
    }
  }
  function applyAll() { applyTheme(); applyTexts(); refreshNav(); }

  /* ---------- حارس الصلاحيات: القسم/الميزة الموقوفة تُغلق حتى بالرابط المباشر ---------- */
  const _hp = window.dqHasPerm;
  if (typeof _hp === 'function') {
    window.dqHasPerm = function (m) {
      if (!isOwner()) {
        const mod = (m === 'defenses' || m === 'toolkit') ? 'lawsuits' : m;
        if (!modEnabled(mod)) return false;
        if ((m === 'defenses' || m === 'toolkit') && !flagEnabled(m)) return false;
      }
      return _hp.apply(this, arguments);
    };
    try { dqHasPerm = window.dqHasPerm; } catch (e) { }
  }
  if (window.MK_AI && typeof MK_AI.open === 'function') {
    const _o = MK_AI.open;
    MK_AI.open = function () {
      if (!isOwner() && !flagEnabled('ai_assistant')) { alert('هذه الميزة متوقفة من إدارة النظام.'); return; }
      return _o.apply(this, arguments);
    };
  }

  /* ---------- التحميل من Supabase ---------- */
  let loading = false;
  async function load() {
    if (loading || !window.MK || !MK.rest || !acct() || !navigator.onLine) return false;
    loading = true;
    try {
      const [m, f, o, cf] = await Promise.all([
        MK.rest('/rest/v1/app_modules?select=*'),
        MK.rest('/rest/v1/feature_flags?select=*'),
        MK.rest('/rest/v1/ui_overrides?select=*'),
        MK.rest('/rest/v1/custom_fields?select=*').catch(() => cfg.fields || [])]);   // migration-07 اختياري
      cfg = { modules: m || [], flags: f || [], overrides: o || [], fields: cf || [] };
      try { localStorage.setItem(LSKEY, JSON.stringify(cfg)); } catch (e) { }
      applyAll(); return true;
    } catch (e) { return false; }                                      // الجداول غير موجودة أو أوفلاين: نكمل بالنسخة المحلية
    finally { loading = false; }
  }

  const _enter = window.dqEnterApp;
  window.dqEnterApp = function () {
    const r = _enter.apply(this, arguments);
    scanNav(); applyAll(); load();
    return r;
  };


  /* ================= الحقول المخصصة (migration-07) ================= */
  const CF_ENT = { clients: { anchor: 'clientNotes', body: 'clientDetailBody', name: 'العملاء' }, cases: { anchor: 'caseNotes', body: 'caseDetailBody', name: 'القضايا' } };
  function fieldDefs(entity) {
    const off = myOffice(), rows = (cfg.fields || []).filter(f => f.entity === entity);
    const keys = Array.from(new Set(rows.map(f => f.key)));
    return keys.map(k => pick(rows, k, off)).filter(f => f && f.enabled !== false)
      .sort((a, b) => (a.sort_order == null ? 1000 : a.sort_order) - (b.sort_order == null ? 1000 : b.sort_order));
  }
  const itemOf = (entity, id) => { try { return (id && DB.get(entity).find(x => x.id === id)) || {}; } catch (e) { return {}; } };
  function cfRender(entity, id) {
    const old = $('mkCf_' + entity); if (old) old.remove();
    const defs = fieldDefs(entity), meta = CF_ENT[entity]; if (!defs.length || !meta) return;
    const anchor = $(meta.anchor); if (!anchor || !anchor.closest('.form-group')) return;
    const vals = itemOf(entity, id).custom || {};
    const box = el('div'); box.id = 'mkCf_' + entity;
    box.append(el('div', 'حقول إضافية', 'font-weight:700;margin:10px 0 6px;font-size:13px;opacity:.8'));
    defs.forEach(d => {
      const g = el('div'); g.className = 'form-group';
      g.append(el('label', d.label + (d.required ? ' *' : '')));
      let inp;
      if (d.ftype === 'textarea') { inp = el('textarea'); }
      else if (d.ftype === 'select') { inp = el('select'); inp.append(new Option('— اختر —', '')); (d.options || []).forEach(o => inp.append(new Option(String(o), String(o)))); }
      else { inp = el('input'); inp.type = d.ftype === 'number' ? 'number' : d.ftype === 'date' ? 'date' : 'text'; }
      inp.dataset.cfKey = d.key; inp.value = vals[d.key] == null ? '' : vals[d.key];
      g.append(inp); box.append(g);
    });
    anchor.closest('.form-group').after(box);
  }
  function cfOk(entity) {
    const box = $('mkCf_' + entity); if (!box) return true;
    for (const d of fieldDefs(entity)) {
      if (!d.required) continue;
      const inp = box.querySelector('[data-cf-key="' + d.key + '"]');
      if (inp && !String(inp.value).trim()) { alert('الحقل «' + d.label + '» مطلوب.'); inp.focus(); return false; }
    }
    return true;
  }
  function cfCollect(entity, id) {
    const out = Object.assign({}, itemOf(entity, id).custom || {}), box = $('mkCf_' + entity);
    if (box) box.querySelectorAll('[data-cf-key]').forEach(i => { const v = String(i.value).trim(); if (v) out[i.dataset.cfKey] = v; else delete out[i.dataset.cfKey]; });
    return Object.keys(out).length ? out : undefined;
  }
  function cfShow(entity, id) {
    const meta = CF_ENT[entity], body = meta && $(meta.body); if (!body) return;
    const vals = itemOf(entity, id).custom || {}, defs = fieldDefs(entity).filter(d => vals[d.key] != null && vals[d.key] !== '');
    const old = body.querySelector('.mk-cf-view'); if (old) old.remove();
    if (!defs.length) return;
    const box = el('div', null, 'margin:12px 0;padding:10px;border:1px solid var(--border,#ddd);border-radius:10px'); box.className = 'mk-cf-view';
    box.append(el('div', 'حقول إضافية', 'font-weight:700;font-size:13px;margin-bottom:6px'));
    defs.forEach(d => { const r = el('div', null, 'font-size:14px;padding:2px 0'); r.append(el('strong', d.label + ': '), document.createTextNode(String(vals[d.key]))); box.append(r); });
    body.append(box);
  }
  function wrapFn(name, make) { try { const f = window[name]; if (typeof f === 'function') window[name] = make(f); } catch (e) { } }
  wrapFn('openClientModal', f => function (id) { const r = f.apply(this, arguments); cfRender('clients', id); return r; });
  wrapFn('openCaseModal', f => function (id) { const r = f.apply(this, arguments); cfRender('cases', id); return r; });
  wrapFn('saveClient', f => function () { if (!cfOk('clients')) return; return f.apply(this, arguments); });
  wrapFn('saveCase', f => function () { if (!cfOk('cases')) return; return f.apply(this, arguments); });
  wrapFn('viewClient', f => function (id) { const r = f.apply(this, arguments); cfShow('clients', id); return r; });
  wrapFn('viewCase', f => function (id) { const r = f.apply(this, arguments); cfShow('cases', id); return r; });
  window.MK_CF = { collect: cfCollect, defs: fieldDefs };

  /* ================= لوحة المالك ================= */
  function el(tag, text, css) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (css) e.style.cssText = css; return e; }
  function btn(text, fn, cls) { const b = el('button', text); b.type = 'button'; b.className = 'btn btn-sm ' + (cls || 'btn-outline'); b.onclick = fn; return b; }
  const friendly = e => (window.MK && MK.friendly ? MK.friendly(e) : String((e && e.message) || e)).replace('protected_module', 'هذا القسم أساسي ولا يمكن إيقافه.').replace('too_many_fields', 'الحد الأقصى 25 حقلًا لكل نموذج.');
  // نافذة تأكيد بكلمة المرور قبل أي إيقاف شامل لكل المكاتب
  function askPassword(msg) {
    return new Promise(resolve => {
      const ov = el('div', null, 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px');
      const box = el('div', null, 'background:var(--card-bg,#fff);color:var(--text-dark,#222);border-radius:12px;padding:16px;max-width:360px;width:100%;direction:rtl');
      const pw = el('input'); pw.type = 'password'; pw.autocomplete = 'current-password'; pw.style.cssText = 'width:100%;padding:8px;margin:10px 0;box-sizing:border-box';
      const done = v => { ov.remove(); resolve(v); };
      const go = btn('تأكيد', () => done(pw.value || null), 'btn-primary');
      pw.onkeydown = e => { if (e.key === 'Enter') go.click(); if (e.key === 'Escape') done(null); };
      const row = el('div', null, 'display:flex;gap:8px'); row.append(go, btn('إلغاء', () => done(null)));
      box.append(el('strong', '🔒 تأكيد بكلمة المرور'), el('p', msg, 'font-size:13px;margin:6px 0 0;line-height:1.7'), pw, row);
      ov.append(box); document.body.append(ov); pw.focus();
    });
  }
  async function confirmGlobal(what) {
    if (sc()) return true;                                  // مكتب محدد: لا حاجة
    const pw = await askPassword('هذا التغيير يؤثر على كل المكاتب: ' + what + '. أدخل كلمة مرور المالك للمتابعة.');
    if (!pw) return false;
    try { await MK.verifyPassword(pw); return true; } catch (e) { alert(friendly(e)); return false; }
  }
  async function run(fn, okMsg, guard) {
    try {
      if (guard && !(await confirmGlobal(guard))) { await reloadOwner(); return; }
      await fn(); await reloadOwner(); if (okMsg && typeof toast === 'function') toast(okMsg);
    } catch (e) { alert(friendly(e)); }
  }
  let offices = [], audit = [], scope = '', hasFields = true;
  async function reloadOwner() {
    const [m, f, o, a, offs, cf] = await Promise.all([
      MK.rest('/rest/v1/app_modules?select=*'), MK.rest('/rest/v1/feature_flags?select=*'),
      MK.rest('/rest/v1/ui_overrides?select=*'),
      MK.rest('/rest/v1/config_audit?select=*&order=id.desc&limit=30'),
      MK.rest('/rest/v1/offices?select=id,name&order=name'),
      MK.rest('/rest/v1/custom_fields?select=*').then(r => { hasFields = true; return r; }).catch(() => { hasFields = false; return []; })]);
    cfg = { modules: m, flags: f, overrides: o, fields: cf }; audit = a; offices = offs;
    renderPanel();
  }
  const sc = () => scope || null;

  function renderPanel() {
    const host = $('mkCfgPanel'); if (!host) return;
    host.textContent = '';
    const card = el('div', null, 'border:1px solid var(--border,#ddd);border-radius:12px;padding:14px;margin:12px 0;background:var(--card-bg,#fff)');
    card.append(el('h3', '🧩 هيكل التطبيق (للمالك)', 'margin:0 0 4px'),
      el('p', 'تعديل الأقسام والميزات والمظهر لكل المكاتب أو لمكتب محدد. لا يمس بيانات العملاء والقضايا. التغييرات تظهر للمستخدمين عند فتح التطبيق متصلين.', 'font-size:13px;opacity:.75;margin:0 0 10px;line-height:1.8'));

    const sel = el('select'); sel.style.cssText = 'padding:6px;border-radius:8px;margin-inline-start:8px';
    sel.append(new Option('كل المكاتب', ''));
    offices.forEach(o => sel.append(new Option('مكتب: ' + o.name, o.id)));
    sel.value = scope; sel.onchange = () => { scope = sel.value; renderPanel(); };
    const top = el('div', null, 'margin-bottom:12px'); top.append(el('strong', 'نطاق التعديل:'), sel);
    card.append(top);

    /* --- الأقسام --- */
    const d1 = document.createElement('details'); d1.open = true; d1.append(el('summary', 'الأقسام (تفعيل / إيقاف / اسم / ترتيب)', 'font-weight:700;cursor:pointer;margin:6px 0'));
    const tbl = el('div', null, 'display:grid;gap:6px;margin:8px 0');
    const seenKeys = {};
    document.querySelectorAll('.nav-item[data-page]').forEach(b => {
      const key = b.dataset.page; if (seenKeys[key]) return; seenKeys[key] = 1;
      const r = pick(cfg.modules, key, sc()), own = cfg.modules.find(x => x.key === key && (x.office_id || null) === sc());
      const orig = b.dataset.mkOrig || baseLabel(b);
      const row = el('div', null, 'display:grid;grid-template-columns:24px 1.2fr 1.4fr 70px auto;gap:6px;align-items:center;padding:6px;border-radius:8px;background:rgba(0,0,0,.03)');
      const en = el('input'); en.type = 'checkbox'; en.checked = !r || r.enabled !== false; if (PROTECTED.includes(key)) { en.checked = true; en.disabled = true; en.title = 'قسم أساسي'; }
      const lab = el('input'); lab.type = 'text'; lab.maxLength = 60; lab.placeholder = orig; lab.value = (r && r.label) || '';
      const so = el('input'); so.type = 'number'; so.min = 0; so.max = 9999; so.placeholder = 'ترتيب'; so.value = r && r.sort_order != null ? r.sort_order : '';
      const code = el('span', orig + (own ? '' : (r ? ' ↩ (موروث)' : '')), 'font-size:13px');
      const save = btn('حفظ', () => run(() => MK.rpc('owner_cfg_save_module', { p_key: key, p_office: sc(), p_label: lab.value.trim() || null, p_enabled: en.checked, p_sort: so.value === '' ? null : parseInt(so.value, 10) }), 'تم الحفظ', en.checked ? null : 'إيقاف قسم «' + orig + '»'), 'btn-primary');
      row.append(en, code, lab, so, own ? (() => { const w = el('span', null, 'display:flex;gap:4px'); w.append(save, btn('استرجاع', () => run(() => MK.rpc('owner_cfg_delete', { p_table: 'app_modules', p_id: own.id }), 'عاد للأصل'))); return w; })() : save);
      tbl.append(row);
    });
    d1.append(tbl); card.append(d1);

    /* --- الميزات --- */
    const d2 = document.createElement('details'); d2.append(el('summary', 'الميزات (مفاتيح التشغيل)', 'font-weight:700;cursor:pointer;margin:6px 0'));
    FLAGS.forEach(([key, name]) => {
      const r = pick(cfg.flags, key, sc()), row = el('div', null, 'display:flex;gap:10px;align-items:center;padding:6px 0');
      const en = el('input'); en.type = 'checkbox'; en.checked = !r || r.enabled !== false;
      en.onchange = () => run(() => MK.rpc('owner_cfg_save_flag', { p_key: key, p_office: sc(), p_enabled: en.checked }), 'تم الحفظ', en.checked ? null : 'إيقاف ميزة «' + name + '»');
      row.append(en, el('span', name)); d2.append(row);
    });
    card.append(d2);

    /* --- المظهر والنصوص --- */
    const d3 = document.createElement('details'); d3.append(el('summary', 'المظهر والنصوص', 'font-weight:700;cursor:pointer;margin:6px 0'));
    THEME.forEach(([v, name]) => {
      const cur = cfg.overrides.find(o => o.kind === 'theme' && o.target === v && (o.office_id || null) === sc());
      const row = el('div', null, 'display:flex;gap:8px;align-items:center;padding:4px 0');
      const c = el('input'); c.type = 'color'; c.value = (cur && /^#[0-9a-f]{6}$/i.test(cur.value)) ? cur.value : (getComputedStyle(document.documentElement).getPropertyValue(v).trim().match(/^#[0-9a-f]{6}$/i) || ['#888888'])[0];
      row.append(el('span', name, 'min-width:190px;font-size:13px'), c,
        btn('حفظ', () => run(() => MK.rpc('owner_cfg_save_override', { p_kind: 'theme', p_target: v, p_value: c.value, p_office: sc(), p_enabled: true }), 'تم الحفظ'), 'btn-primary'));
      if (cur) row.append(btn('استرجاع', () => run(() => MK.rpc('owner_cfg_delete', { p_table: 'ui_overrides', p_id: cur.id }), 'عاد للأصل')));
      d3.append(row);
    });
    d3.append(el('h4', 'تعديل نص في الواجهة', 'margin:12px 0 4px'),
      el('p', 'اكتب محدد CSS للعنصر (مثل #dqCurrentUser أو .sidebar h1) ثم النص الجديد. يُكتب كنص عادي فقط.', 'font-size:12px;opacity:.7;margin:0 0 6px'));
    const tsel = el('input'); tsel.type = 'text'; tsel.placeholder = 'محدد CSS'; tsel.style.cssText = 'flex:1;min-width:140px';
    const tval = el('input'); tval.type = 'text'; tval.placeholder = 'النص الجديد'; tval.maxLength = 300; tval.style.cssText = 'flex:2;min-width:160px';
    const addRow = el('div', null, 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px');
    addRow.append(tsel, tval, btn('إضافة', () => {
      const s = tsel.value.trim(), v = tval.value.trim();
      if (!s || !v) return alert('اكتب المحدد والنص.');
      try { document.querySelector(s); } catch (e) { return alert('محدد CSS غير صالح.'); }
      if (/[;{}<>]/.test(v)) return alert('النص يحتوي رموزًا غير مسموحة.');
      run(() => MK.rpc('owner_cfg_save_override', { p_kind: 'text', p_target: s, p_value: v, p_office: sc(), p_enabled: true }), 'تمت الإضافة (حدّث الصفحة لرؤيتها)');
    }, 'btn-primary'));
    d3.append(addRow);
    cfg.overrides.filter(o => o.kind === 'text').forEach(o => {
      const row = el('div', null, 'display:flex;gap:8px;align-items:center;padding:3px 0;font-size:13px');
      row.append(el('code', o.target), el('span', '← ' + o.value, 'flex:1'),
        el('span', o.office_id ? 'مكتب محدد' : 'الكل', 'opacity:.6;font-size:12px'),
        btn('حذف', () => run(() => MK.rpc('owner_cfg_delete', { p_table: 'ui_overrides', p_id: o.id }), 'تم الحذف (حدّث الصفحة)'), 'btn-danger'));
      d3.append(row);
    });
    card.append(d3);


    /* --- الحقول المخصصة --- */
    const d5 = document.createElement('details'); d5.append(el('summary', 'الحقول المخصصة (نماذج العملاء والقضايا)', 'font-weight:700;cursor:pointer;margin:6px 0'));
    if (!hasFields) d5.append(el('p', '⚠️ نفّذ ملف supabase-migration-07-custom-fields.sql أولًا.', 'color:#b3261e;font-size:13px'));
    else {
      d5.append(el('p', 'تظهر الحقول في نموذج العميل/القضية وفي صفحة تفاصيله. حذف الحقل يخفيه فقط، والقيم المحفوظة تبقى في السجلات.', 'font-size:12px;opacity:.7;margin:0 0 8px;line-height:1.7'));
      const ent = el('select'); ent.append(new Option('العملاء', 'clients'), new Option('القضايا', 'cases'));
      const lab = el('input'); lab.type = 'text'; lab.placeholder = 'اسم الحقل'; lab.maxLength = 60;
      const ty = el('select'); [['text', 'نص قصير'], ['textarea', 'نص طويل'], ['number', 'رقم'], ['date', 'تاريخ'], ['select', 'قائمة اختيار']].forEach(x => ty.append(new Option(x[1], x[0])));
      const op = el('input'); op.type = 'text'; op.placeholder = 'خيارات القائمة مفصولة بفاصلة'; op.style.display = 'none';
      ty.onchange = () => { op.style.display = ty.value === 'select' ? '' : 'none'; };
      const rq = el('input'); rq.type = 'checkbox'; const rql = el('label', 'مطلوب'); rql.prepend(rq);
      const add = el('div', null, 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px');
      add.append(ent, lab, ty, op, rql, btn('إضافة حقل', () => {
        const label = lab.value.trim(); if (!label) return alert('اكتب اسم الحقل.');
        const options = ty.value === 'select' ? op.value.split(/[,،]/).map(x => x.trim()).filter(Boolean).slice(0, 30) : [];
        if (ty.value === 'select' && options.length < 2) return alert('أدخل خيارين على الأقل.');
        const key = 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        run(() => MK.rpc('owner_cfg_save_field', { p_entity: ent.value, p_key: key, p_label: label, p_ftype: ty.value, p_options: options, p_required: rq.checked, p_sort: null, p_office: sc(), p_enabled: true }), 'تمت إضافة الحقل');
      }, 'btn-primary'));
      d5.append(add);
      (cfg.fields || []).filter(f => (f.office_id || null) === sc()).forEach(f => {
        const row = el('div', null, 'display:flex;gap:8px;align-items:center;padding:4px 0;font-size:13px;flex-wrap:wrap');
        const en = el('input'); en.type = 'checkbox'; en.checked = f.enabled !== false; en.title = 'ظاهر';
        en.onchange = () => run(() => MK.rpc('owner_cfg_save_field', { p_entity: f.entity, p_key: f.key, p_label: f.label, p_ftype: f.ftype, p_options: f.options || [], p_required: f.required, p_sort: f.sort_order, p_office: f.office_id || null, p_enabled: en.checked }), 'تم الحفظ');
        row.append(en, el('strong', f.label), el('span', (CF_ENT[f.entity] || {}).name + ' · ' + f.ftype + (f.required ? ' · مطلوب' : ''), 'opacity:.65;font-size:12px'),
          btn('حذف', () => { if (confirm('حذف تعريف هذا الحقل؟ القيم المحفوظة تبقى في السجلات.')) run(() => MK.rpc('owner_cfg_delete', { p_table: 'custom_fields', p_id: f.id }), 'تم الحذف'); }, 'btn-danger'));
        d5.append(row);
      });
    }
    card.append(d5);

    /* --- السجل --- */
    const d4 = document.createElement('details'); d4.append(el('summary', 'سجل التغييرات والتراجع', 'font-weight:700;cursor:pointer;margin:6px 0'));
    if (!audit.length) d4.append(el('p', 'لا توجد تغييرات بعد.', 'opacity:.7;font-size:13px'));
    const TN = { app_modules: 'قسم', feature_flags: 'ميزة', ui_overrides: 'مظهر/نص', custom_fields: 'حقل مخصص' }, AN = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' };
    audit.forEach(a => {
      const r = a.new_row || a.old_row || {}, row = el('div', null, 'display:flex;gap:8px;align-items:center;padding:3px 0;font-size:13px;flex-wrap:wrap');
      row.append(el('span', new Date(a.at).toLocaleString('ar-EG'), 'opacity:.6;font-size:12px'),
        el('span', (AN[a.action] || a.action) + ' ' + (TN[a.table_name] || a.table_name) + ': ' + (r.label || r.key || r.target || '')),
        btn('تراجع', () => { if (confirm('التراجع عن هذا التغيير؟')) run(() => MK.rpc('owner_cfg_undo', { p_audit_id: a.id }), 'تم التراجع'); }));
      d4.append(row);
    });
    card.append(d4);
    host.append(card);
  }

  function ensureHost() {
    let host = $('mkCfgPanel');
    if (!host) {
      const page = $('page-accounts'); if (!page) return null;
      host = el('div'); host.id = 'mkCfgPanel';
      page.insertBefore(host, page.firstChild);
    }
    return host;
  }
  function showOwnerPanel() {
    const host = ensureHost(); if (!host) return;
    if (!isOwner()) { host.textContent = ''; return; }
    if (!window.MK || !MK.rest) return;
    host.textContent = ''; host.append(el('p', 'جارٍ تحميل إعدادات الهيكل…', 'opacity:.7'));
    reloadOwner().catch(e => {
      host.textContent = '';
      const msg = /PGRST205|schema cache|does not exist|could not find/i.test(String((e && e.message) || '') + JSON.stringify((e && e.data) || ''))
        ? 'لم يُنفَّذ ملف supabase-migration-06-owner-config.sql بعد في Supabase.' : friendly(e);
      host.append(el('p', '⚠️ ' + msg, 'color:#b3261e;font-size:13px'));
    });
  }
  const _rda = window.renderDQAccounts;
  window.renderDQAccounts = function () {
    const r = _rda.apply(this, arguments);
    if (isOwner()) showOwnerPanel();
    return r;
  };

  window.MK_CFG = { fields: fieldDefs, get: () => cfg, flag: flagEnabled, moduleEnabled: modEnabled, reload: load, apply: applyAll };
  document.addEventListener('DOMContentLoaded', scanNav);
  scanNav();
})();
