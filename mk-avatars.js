/* مكتبي — لوجو المكتب وصورة الحساب (migration-06-avatars)
   - كل مستخدم: صورته الشخصية. مدير المكتب: لوجو المكتب أيضًا.
   - الصورة تظهر: في الهيدر (دائرة صغيرة)، لوجو المكتب مكان رمز الشريط الجانبي، صور الحسابات في إدارة الحسابات،
     ولوجو كل مكتب في شاشة المالك.
   - الصور تُضغط هنا (256px) وتُحفظ كنص data:image، وتُخزَّن محليًا للعرض أوفلاين.
   يُحمَّل بعد mk-cloud.js */
(function () {
  'use strict';
  const OK_IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
  const MAX_CHARS = 55000;                                           // الخادم يقبل حتى 60000
  const $ = id => document.getElementById(id);
  const acct = () => { try { return dqCurrentAccount || null; } catch (e) { return null; } };
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { } };
  const safeImg = s => (typeof s === 'string' && OK_IMG.test(s)) ? s : '';

  let myAvatar = '', officeLogo = '';

  /* ---------- عنصر الصورة (صورة أو حرف أول) ---------- */
  function badge(src, name, size) {
    size = size || 36;
    const w = document.createElement('span');
    w.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:none;overflow:hidden;border-radius:50%;' +
      'width:' + size + 'px;height:' + size + 'px;background:var(--accent-gold,#C5A869);color:var(--primary-brown,#2D1E12);font-weight:700;font-size:' + Math.round(size * 0.45) + 'px';
    const ok = safeImg(src);
    if (ok) { const i = document.createElement('img'); i.src = ok; i.alt = ''; i.style.cssText = 'width:100%;height:100%;object-fit:cover'; w.append(i); }
    else w.textContent = (String(name || '').trim()[0]) || '•';
    return w;
  }

  /* ---------- ضغط الصورة في المتصفح ---------- */
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('تعذر قراءة الصورة.')); };
      img.src = url;
    });
  }
  async function compress(file, mode) {                              // mode: avatar (قص مربع) / logo (يحفظ النسبة)
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('اختر صورة بصيغة PNG أو JPG أو WEBP.');
    if (file.size > 10 * 1024 * 1024) throw new Error('حجم الصورة كبير (الحد 10 ميجا).');
    const img = await loadImage(file);
    for (const dim of [256, 192, 128, 96, 64]) {
      const c = document.createElement('canvas'), g = c.getContext('2d');
      if (mode === 'avatar') {
        c.width = c.height = dim; const s = Math.min(img.width, img.height);
        g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, dim, dim);
      } else {
        const k = Math.min(1, dim / Math.max(img.width, img.height));
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        g.drawImage(img, 0, 0, c.width, c.height);
      }
      const tries = mode === 'logo' ? [['image/webp', 0.9], ['image/webp', 0.7], ['image/png']] : [['image/webp', 0.85], ['image/jpeg', 0.8], ['image/jpeg', 0.6]];
      for (const [type, q] of tries) {
        let src = c;
        if (type === 'image/jpeg') {                                  // JPEG بلا شفافية: خلفية بيضاء
          src = document.createElement('canvas'); src.width = c.width; src.height = c.height;
          const g2 = src.getContext('2d'); g2.fillStyle = '#fff'; g2.fillRect(0, 0, c.width, c.height); g2.drawImage(c, 0, 0);
        }
        const out = src.toDataURL(type, q);
        if (OK_IMG.test(out) && out.length <= MAX_CHARS) return out;
      }
    }
    throw new Error('الصورة معقدة جدًا. اختر صورة أبسط أو أصغر.');
  }

  /* ---------- حفظ/تحميل ---------- */
  const friendly = e => {
    const m = (window.MK && MK.friendly) ? MK.friendly(e) : String((e && e.message) || e);
    return m.replace('bad_image', 'الصورة غير صالحة أو كبيرة.')
      .replace(/PGRST202|could not find the function/i, 'ميزة الصور لم تُفعَّل بعد على الخادم. تواصل مع مسؤول النظام.');
  };
  async function loadMine() {
    const a = acct(); if (!a) return;
    myAvatar = safeImg(lsGet('mk_av_' + a.id));
    officeLogo = a.officeId ? safeImg(lsGet('mk_logo_' + a.officeId)) : '';
    paint();
    if (!navigator.onLine || !window.MK || !MK.rest) return;
    try {
      const p = await MK.rest('/rest/v1/profiles?user_id=eq.' + a.id + '&select=avatar');
      myAvatar = safeImg(p && p[0] && p[0].avatar); lsSet('mk_av_' + a.id, myAvatar);
      if (a.officeId) {
        const o = await MK.rest('/rest/v1/offices?id=eq.' + a.officeId + '&select=logo');
        officeLogo = safeImg(o && o[0] && o[0].logo); lsSet('mk_logo_' + a.officeId, officeLogo);
      }
    } catch (e) { /* العمود غير موجود بعد أو أوفلاين: نكمل بالنسخة المحلية */ }
    paint();
  }

  /* ---------- الرسم: الهيدر + الشريط الجانبي ---------- */
  function paint() {
    const a = acct();
    let btn = $('mkAvBtn');
    if (!a) { if (btn) btn.style.display = 'none'; resetLogo(); return; }
    if (!btn) {
      const pill = $('dqCurrentUser'); if (!pill) return;
      btn = document.createElement('button'); btn.type = 'button'; btn.id = 'mkAvBtn'; btn.title = 'ملفي الشخصي';
      btn.style.cssText = 'border:0;background:none;padding:0;cursor:pointer;display:inline-flex';
      btn.onclick = openModal; pill.parentNode.insertBefore(btn, pill);
    }
    btn.style.display = 'inline-flex'; btn.textContent = ''; btn.append(badge(myAvatar, a.name, 34));
    const li = document.querySelector('.sidebar-header .logo-icon');
    if (li) {
      if (officeLogo && a.role !== 'owner') {
        if (li.dataset.mkLogo !== officeLogo) {
          if (li.dataset.mkOrig == null) li.dataset.mkOrig = li.textContent;
          li.textContent = ''; const i = document.createElement('img'); i.src = officeLogo; i.alt = '';
          i.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:inherit'; li.append(i); li.dataset.mkLogo = officeLogo;
        }
      } else resetLogo();
    }
  }
  function resetLogo() {
    const li = document.querySelector('.sidebar-header .logo-icon');
    if (li && li.dataset.mkLogo) { li.textContent = li.dataset.mkOrig || '⚖'; delete li.dataset.mkLogo; }
  }

  /* ---------- نافذة «ملفي الشخصي» ---------- */
  function el(tag, text, css) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (css) e.style.cssText = css; return e; }
  function button(text, fn, cls) { const b = el('button', text); b.type = 'button'; b.className = 'btn btn-sm ' + (cls || 'btn-outline'); b.onclick = fn; return b; }
  function pickFile(cb) {
    const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp';
    f.onchange = () => { if (f.files && f.files[0]) cb(f.files[0]); }; f.click();
  }
  function openModal() {
    const a = acct(); if (!a) return;
    const old = $('mkAvModal'); if (old) old.remove();
    const ov = el('div', null, 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px');
    ov.id = 'mkAvModal'; ov.onclick = e => { if (e.target === ov) ov.remove(); };
    const box = el('div', null, 'background:var(--card-bg,#fff);color:var(--text-dark,#222);border-radius:14px;padding:18px;max-width:380px;width:100%;direction:rtl;max-height:90vh;overflow:auto');
    const msg = el('div', '', 'font-size:12px;color:#b3261e;min-height:16px;margin-top:8px');
    const section = (title, cur, name, size, onPick, onRemove, note) => {
      const s = el('div', null, 'padding:10px 0;border-top:1px solid var(--border,#ddd)');
      s.append(el('strong', title));
      if (note) s.append(el('div', note, 'font-size:12px;opacity:.7;margin:2px 0 8px'));
      const row = el('div', null, 'display:flex;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap');
      row.append(badge(cur, name, size), button(cur ? 'تغيير' : 'رفع صورة', onPick, 'btn-primary'));
      if (cur) row.append(button('حذف', onRemove, 'btn-danger'));
      s.append(row); return s;
    };
    const act = async (fn) => { msg.style.color = '#555'; msg.textContent = 'جارٍ الحفظ…'; try { await fn(); ov.remove(); if (typeof toast === 'function') toast('تم الحفظ'); } catch (e) { msg.style.color = '#b3261e'; msg.textContent = friendly(e); } };
    const saveAvatar = v => act(async () => { await MK.rpc('set_my_avatar', { p_avatar: v }); myAvatar = v; lsSet('mk_av_' + a.id, v); paint(); });
    const saveLogo = v => act(async () => { await MK.rpc('set_office_logo', { p_logo: v }); officeLogo = v; lsSet('mk_logo_' + a.officeId, v); paint(); });
    const head = el('div', null, 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px');
    head.append(el('h3', 'ملفي الشخصي', 'margin:0'), button('✕', () => ov.remove()));
    box.append(head, el('div', a.name + ' · ' + (typeof dqRoleLabel === 'function' ? dqRoleLabel(a.role) : a.role), 'font-size:13px;opacity:.75;margin-bottom:8px'));
    box.append(section('صورتي الشخصية', myAvatar, a.name, 64,
      () => pickFile(f => compress(f, 'avatar').then(saveAvatar).catch(e => { msg.textContent = friendly(e); })),
      () => saveAvatar(''), 'تظهر بجوار اسمك وفي قوائم الحسابات.'));
    if (a.role === 'manager') {
      box.append(section('لوجو المكتب', officeLogo, 'م', 64,
        () => pickFile(f => compress(f, 'logo').then(saveLogo).catch(e => { msg.textContent = friendly(e); })),
        () => saveLogo(''), 'يظهر لكل أعضاء المكتب مكان الرمز في الشريط الجانبي، ويظهر لمالك النظام كصورة لحساب المكتب.'));
    }
    if (!navigator.onLine) msg.textContent = 'الحفظ يحتاج اتصالًا بالإنترنت.';
    box.append(msg); ov.append(box); document.body.append(ov);
  }

  /* ---------- صور الحسابات داخل «إدارة الحسابات» (للمدير) ---------- */
  async function decorateAccounts() {
    const a = acct(); if (!a || a.role !== 'manager' || !navigator.onLine || !window.MK || !MK.rest) return;
    let rows = []; try { rows = await MK.rest('/rest/v1/profiles?select=user_id,avatar&avatar=not.is.null'); } catch (e) { return; }
    const map = {}; rows.forEach(r => { map[r.user_id] = r.avatar; });
    document.querySelectorAll('#dqAccountsList .dq-user-row').forEach(row => {
      if (row.querySelector('.mk-av')) return;
      const m = /dqEditAccount\('([^']+)'\)/.exec(row.innerHTML); if (!m || !map[m[1]]) return;
      const b = badge(map[m[1]], '', 38); b.classList.add('mk-av'); b.style.marginInlineEnd = '10px';
      const first = row.firstElementChild; if (first) { first.style.flex = '1'; row.insertBefore(b, first); }
    });
  }
  const _rda = window.renderDQAccounts;
  if (typeof _rda === 'function') window.renderDQAccounts = function () { const r = _rda.apply(this, arguments); setTimeout(decorateAccounts, 400); return r; };

  /* ---------- ربط الدخول والخروج ---------- */
  const _enter = window.dqEnterApp;
  window.dqEnterApp = function () { const r = _enter.apply(this, arguments); loadMine(); return r; };
  const _out = window.dqLogout;
  window.dqLogout = function () { const r = _out.apply(this, arguments); myAvatar = ''; officeLogo = ''; paint(); return r; };

  window.MK_AV = { badge: badge, compress: compress, open: openModal };
})();
