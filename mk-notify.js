/* مكتبي — تفضيلات الإشعارات (إعدادات واحدة) + جدولة محلية بتوقيت القاهرة + سلوك الإذن
   يُحمَّل بعد index.html وقبل/بعد mk-cloud.js. لا يغيّر بيانات القضايا ولا Supabase. */
(function () {
  'use strict';
  const KEY = 'mk_notif_types_v1';
  const TZ = 'Africa/Cairo';
  const LEADS = [[5, '5 دقائق'], [15, '15 دقيقة'], [30, '30 دقيقة'], [60, 'ساعة'], [1440, 'يوم']];
  const TYPES = [
    { k: 'sessions', label: 'جلسات المحكمة' },
    { k: 'events', label: 'المواعيد العامة' },
    { k: 'tasks', label: 'المهام (استحقاق / متأخرة)' },
    { k: 'deadlines', label: 'المهل القانونية (مواعيد الطعن)' },
    { k: 'status', label: 'تغيّر حالة موعد (إكمال / إلغاء)', noLead: true }
  ];
  const DEFAULTS = {
    appOn: true, asked: false,
    sessions: { on: true, lead: [60, 1440] },
    events: { on: true, lead: [15] },
    tasks: { on: true, lead: [60] },
    deadlines: { on: true, lead: [1440] },
    status: { on: true, lead: [] }
  };

  /* ---------- التفضيلات ---------- */
  function prefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { }
    const out = JSON.parse(JSON.stringify(DEFAULTS));
    Object.keys(out).forEach(k => {
      if (p[k] === undefined) return;
      out[k] = (typeof out[k] === 'object') ? Object.assign(out[k], p[k]) : p[k];
    });
    return out;
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { } }

  /* ---------- حالة الإذن ---------- */
  function secure() { try { return !!window.isSecureContext; } catch (e) { return false; } }
  function permState() {
    if (!('Notification' in window)) return 'unsupported';
    if (!secure()) return 'insecure';
    return Notification.permission; // default | granted | denied
  }
  const PERM_LABEL = {
    granted: ['مسموح', '#15803d'], denied: ['مرفوض من المتصفح', '#b91c1c'], default: ['لم يُطلب بعد', '#b45309'],
    unsupported: ['غير مدعوم في هذا المتصفح', '#6b7280'], insecure: ['يتطلب فتح التطبيق عبر https', '#6b7280']
  };
  function canSystem() { return permState() === 'granted' && prefs().appOn; }

  /* ---------- توقيت القاهرة ---------- */
  function tzOffsetMs(utcMs) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const o = {}; f.formatToParts(new Date(utcMs)).forEach(x => { o[x.type] = x.value; });
    return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second) - Math.floor(utcMs / 1000) * 1000;
  }
  function cairoMs(date, time) {
    if (!date) return null;
    const t = (time && /^\d{2}:\d{2}/.test(time)) ? time : '09:00';
    const d = date.split('-').map(Number), h = t.split(':').map(Number);
    if (d.length < 3 || d.some(isNaN)) return null;
    const guess = Date.UTC(d[0], d[1] - 1, d[2], h[0], h[1]);
    let ms = guess - tzOffsetMs(guess);
    ms = guess - tzOffsetMs(ms); // تصحيح عند حدود التوقيت الصيفي
    return ms;
  }

  /* ---------- الإرسال: نظام إن أمكن وإلا داخل التطبيق ---------- */
  function deliver(title, body, tag) {
    if (canSystem() && typeof window.mkShowNotification === 'function') return window.mkShowNotification(title, body, tag);
    if (typeof window.mkInAppAlert === 'function') window.mkInAppAlert(title, body, { tag: tag });
  }

  /* ---------- الجدولة المحلية (تستبدل الدالة القديمة) ---------- */
  let timers = [];
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  const done = k => ['مكتمل', 'ملغى', 'منتهية'].indexOf(k) >= 0;
  const leadLabel = m => (LEADS.find(x => x[0] === m) || [m, m + ' دقيقة'])[1];

  function schedule() {
    clearTimers();
    let ev = [], se = [], ta = [];
    try { ev = DB.get('events') || []; se = DB.get('sessions') || []; ta = DB.get('tasks') || []; } catch (e) { return; }
    const p = prefs(), now = Date.now(), horizon = now + 36 * 3600e3;
    const fired = (typeof mkWasFired === 'function') ? mkWasFired : () => false;
    const mark = (typeof mkMarkFired === 'function') ? mkMarkFired : () => { };

    function plan(id, startMs, leads, title, body) {
      if (!startMs) return;
      (leads || []).forEach(function (m) {
        const when = startMs - m * 60e3, slot = 'L' + m;
        if (when < now - 60e3 || when > horizon || fired(id, slot)) return;
        timers.push(setTimeout(function () {
          if (fired(id, slot)) return;
          mark(id, slot);
          deliver(title + ' — بعد ' + leadLabel(m), body, 'mk-' + id + '-' + slot);
        }, Math.max(500, when - now)));
      });
    }

    if (p.events.on) ev.forEach(function (e) {
      if (done(e.status)) return;
      const own = (e.remindMins != null && Number(e.remindMins) > 0) ? [Number(e.remindMins)] : null;
      plan('ev-' + e.id, cairoMs(e.date, e.time), own || p.events.lead, e.type || 'موعد', (e.desc || '') + (e.place ? ' — ' + e.place : ''));
    });
    if (p.sessions.on) se.forEach(function (s) {
      if (!s.date || s.outcome) return;
      plan('se-' + s.id, cairoMs(s.date, s.time), p.sessions.lead, 'جلسة محكمة', s.prep || s.notes || 'جلسة قادمة');
    });
    ta.forEach(function (t) {
      if (!t.due || done(t.status)) return;
      const isDl = typeof t.autoKey === 'string' && t.autoKey.indexOf('appeal:') === 0;
      const grp = isDl ? p.deadlines : p.tasks;
      if (!grp.on) return;
      const own = (!isDl && t.remindMins != null && Number(t.remindMins) > 0) ? [Number(t.remindMins)] : null;
      plan('ta-' + t.id, cairoMs(t.due, '09:00'), own || grp.lead, isDl ? 'مهلة قانونية' : 'مهمة مستحقة', t.title || t.desc || '');
      // متأخرة: مرة واحدة يوميًا عند أول فحص
      if (p.tasks.on && !isDl && t.due < (typeof isoToday === 'function' ? isoToday() : '')) {
        const slot = 'late' + (typeof isoToday === 'function' ? isoToday() : '');
        if (!fired('ta-' + t.id, slot)) { mark('ta-' + t.id, slot); deliver('مهمة متأخرة', t.title || '', 'mk-late-' + t.id); }
      }
    });
    statusWatch(ev, p);
  }

  /* تغيّر حالة موعد: مقارنة بلقطة سابقة (أول مرة تُسجَّل بصمت) */
  function statusWatch(ev, p) {
    const K = 'mk_status_seen_v1';
    let seen = null; try { seen = JSON.parse(localStorage.getItem(K) || 'null'); } catch (e) { }
    const cur = {}; ev.forEach(e => { cur[e.id] = e.status || ''; });
    if (seen && p.status.on) ev.forEach(function (e) {
      const before = seen[e.id];
      if (before !== undefined && before !== (e.status || '') && done(e.status)) {
        const slot = 'st-' + e.status;
        if (typeof mkWasFired === 'function' && mkWasFired('ev-' + e.id, slot)) return;
        if (typeof mkMarkFired === 'function') mkMarkFired('ev-' + e.id, slot);
        deliver('تغيّرت حالة موعد: ' + e.status, (e.type || 'موعد') + (e.desc ? ' — ' + e.desc : ''), 'mk-st-' + e.id);
      }
    });
    try { localStorage.setItem(K, JSON.stringify(cur)); } catch (e) { }
  }

  window.mkScheduleLocalReminders = schedule;

  /* ---------- طلب الإذن ---------- */
  async function requestOnce(force) {
    if (permState() !== 'default') return permState();
    const p = prefs();
    if (!force && p.asked) return 'default';
    p.asked = true; save(p);
    try { await Notification.requestPermission(); } catch (e) { }
    schedule(); render();
    return permState();
  }
  // أول زيارة: نطلب الإذن مرة واحدة عند أول لمسة بعد الدخول (المتصفح يشترط تفاعلًا)
  function armFirstAsk() {
    const p = prefs();
    if (p.asked || !p.appOn || permState() !== 'default') return;
    const h = function () {
      document.removeEventListener('click', h, true);
      if (document.getElementById('dqAuthGate') && document.getElementById('dqAuthGate').style.display !== 'none') { armFirstAsk(); return; }
      requestOnce(false);
    };
    document.addEventListener('click', h, true);
  }

  /* ---------- واجهة الإعدادات ---------- */
  function denyHelp() {
    const ios = /iphone|ipad/i.test(navigator.userAgent);
    return ios
      ? 'على آيفون: أضف التطبيق إلى الشاشة الرئيسية أولًا، ثم من «الإعدادات ← الإشعارات ← مكتبي» اسمح بالإشعارات.'
      : 'افتح قفل/معلومات الموقع بجوار الرابط في المتصفح ← «الإشعارات» ← «السماح»، أو من إعدادات الهاتف ← التطبيقات ← المتصفح (أو مكتبي) ← الإشعارات. ثم ارجع وأعد تفعيل المفتاح. التطبيق لا يستطيع فرض الإذن بنفسه.';
  }
  function ensureCard() {
    let c = document.getElementById('mkNotifCard');
    if (c) return c;
    const anchor = document.getElementById('mkDailySummaryOn');
    const old = anchor && anchor.closest('.card');
    if (!old) return null;
    c = document.createElement('div'); c.className = 'card'; c.id = 'mkNotifCard'; c.style.marginTop = '16px';
    old.parentNode.insertBefore(c, old);
    return c;
  }
  function render() {
    const c = ensureCard(); if (!c) return;
    const p = prefs(), st = permState(), lab = PERM_LABEL[st] || ['—', '#6b7280'];
    let h = '<div class="card-header"><h2>🔔 الإشعارات</h2></div><div class="card-body">';
    h += '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">' +
      '<span>حالة إذن المتصفح: <strong style="color:' + lab[1] + '">' + lab[0] + '</strong></span>' +
      '<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" style="width:auto" ' + (p.appOn ? 'checked' : '') + ' onchange="mkNtToggleApp(this.checked)"> تفعيل إشعارات التطبيق على هذا الجهاز</label></div>';
    if (st === 'denied') h += '<div class="alert-banner" style="margin-bottom:10px;">' + denyHelp() + '</div>';
    if (st === 'insecure') h += '<div class="alert-banner" style="margin-bottom:10px;">الإشعارات لا تعمل من ملف محلي؛ افتح التطبيق عبر رابط https.</div>';
    h += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">مركز التنبيهات (الجرس) يعمل دائمًا حتى لو رفضت إذن النظام. أوقات التذكير بتوقيت القاهرة.</p>';
    TYPES.forEach(function (t) {
      const g = p[t.k];
      h += '<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px;">' +
        '<label style="display:flex;gap:8px;align-items:center;font-weight:600;"><input type="checkbox" style="width:auto" ' + (g.on ? 'checked' : '') + ' onchange="mkNtSetType(\'' + t.k + '\',this.checked)"> ' + t.label + '</label>';
      if (!t.noLead) {
        h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">';
        LEADS.forEach(function (l) {
          h += '<label style="display:flex;gap:4px;align-items:center;font-size:12px;border:1px solid var(--border);border-radius:14px;padding:3px 9px;"><input type="checkbox" style="width:auto" ' +
            ((g.lead || []).indexOf(l[0]) >= 0 ? 'checked' : '') + (g.on ? '' : ' disabled') + ' onchange="mkNtSetLead(\'' + t.k + '\',' + l[0] + ',this.checked)"> قبل ' + l[1] + '</label>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;"><button type="button" class="btn btn-primary btn-sm" onclick="mkNtTest()">تجربة إشعار</button></div>';
    h += '<p style="font-size:12px;color:var(--text-muted);margin-top:10px;">الملخص اليومي وساعات الهدوء في البطاقة التالية. ساعات الهدوء تكتم إشعارات النظام وتسجّلها داخل التطبيق.</p>';
    h += '<div id="mkNtPushBox"></div></div>';
    c.innerHTML = h;
    if (typeof window.mkPushRenderBox === 'function') window.mkPushRenderBox();
  }

  window.mkNtToggleApp = async function (on) {
    const p = prefs(); p.appOn = !!on; save(p);
    if (on && permState() === 'default') await requestOnce(true);
    schedule(); render();
  };
  window.mkNtSetType = function (k, on) { const p = prefs(); p[k].on = !!on; save(p); schedule(); render(); };
  window.mkNtSetLead = function (k, m, on) {
    const p = prefs(), s = new Set(p[k].lead || []); if (on) s.add(m); else s.delete(m);
    p[k].lead = Array.from(s).sort((a, b) => a - b); save(p); schedule();
  };
  window.mkNtTest = async function () {
    if (permState() === 'default') await requestOnce(true);
    const st = permState();
    if (st !== 'granted') { toast(st === 'denied' ? 'الإذن مرفوض — راجع التعليمات أعلاه' : 'الإشعارات غير متاحة هنا'); render(); return; }
    if (!prefs().appOn) { toast('فعّل إشعارات التطبيق أولًا'); return; }
    const ok = await window.mkShowNotification('مكتبي — إشعار تجريبي', 'إن ظهر هذا في مركز إشعارات الجهاز فالإعداد سليم.', 'mk-test-' + Date.now());
    toast(ok ? 'أُرسل إشعار تجريبي' : 'تعذّر إظهار إشعار النظام');
  };

  /* بدون لافتة مزعجة: نخفي اللافتة القديمة ونزيل أزرار الإذن المبعثرة */
  window.mkUpdateNotifBanner = function () { const b = document.getElementById('notifBanner'); if (b) b.classList.remove('show'); };
  window.mkRequestNotifPermission = async function () { const s = await requestOnce(true); render(); return s === 'granted'; };

  /* ربط بعرض صفحة الإعدادات */
  const _sp = window.showPage;
  if (typeof _sp === 'function') {
    window.showPage = function (id) { const r = _sp.apply(this, arguments); if (id === 'settings') setTimeout(render, 50); return r; };
  }
  document.addEventListener('DOMContentLoaded', function () { setTimeout(function () { render(); armFirstAsk(); schedule(); }, 1500); });
  window.addEventListener('focus', function () { schedule(); });
  window.MK_NOTIFY = { prefs: prefs, permState: permState, cairoMs: cairoMs, render: render, schedule: schedule };
})();
