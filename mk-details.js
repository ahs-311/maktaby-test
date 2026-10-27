/* مكتبي الإلكتروني — نافذة تفاصيل المهام والمواعيد والجلسات (المرحلة D)
   النتيجة + التأجيل مع السجل + سلسلة التعليقات. المنطق (logic) منفصل عن الواجهة (ui) ليُختبر بـ Node. */
(function (root) {
  'use strict';

  const KINDS = {
    task:    { coll: 'tasks',    dateField: 'due',  label: 'مهمة',  title: 'تفاصيل المهمة' },
    event:   { coll: 'events',   dateField: 'date', label: 'موعد',  title: 'تفاصيل الموعد' },
    session: { coll: 'sessions', dateField: 'date', label: 'جلسة',  title: 'تفاصيل الجلسة' }
  };
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_COMMENT = 2000;
  const err = m => ({ ok: false, error: m });

  /* ====================== المنطق (يعتمد على ctx فقط) ====================== */
  // ctx: { DB, account(), canWrite(coll), officeReadOnly(), uid(), now(), log(op), saveOutcome(id, vals), toggleTask(id) }
  const logic = {
    getItem(ctx, kind, id) {
      const k = KINDS[kind]; if (!k) return null;
      return ctx.DB.get(k.coll).find(x => x && x.id === id) || null;
    },
    isClient(ctx) { const a = ctx.account(); return !a || a.role === 'client'; },
    canEdit(ctx, kind) {
      const k = KINDS[kind];
      return !!k && !logic.isClient(ctx) && !ctx.officeReadOnly() && ctx.canWrite(k.coll);
    },
    canComment(ctx) { return !logic.isClient(ctx) && !ctx.officeReadOnly() && ctx.canWrite('comments'); },

    // من/إلى/السبب/بواسطة/متى — لكل التأجيلات المرتبطة بالعنصر (وللجلسة: سلسلة الجلسات السابقة أيضًا)
    postponementHistory(ctx, kind, rec) {
      if (!rec) return [];
      const out = [];
      const add = r => (Array.isArray(r.postponements) ? r.postponements : []).forEach(p => out.push(p));
      add(rec);
      if (kind === 'session') {
        const all = ctx.DB.get('sessions'); const seen = new Set([rec.id]); let cur = rec;
        for (let i = 0; i < 30 && cur.prevId && !seen.has(cur.prevId); i++) {
          cur = all.find(x => x && x.id === cur.prevId); if (!cur) break;
          seen.add(cur.id); add(cur);
        }
      }
      return out.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    },

    listComments(ctx, kind, id) {
      const client = logic.isClient(ctx);
      return ctx.DB.get('comments')
        .filter(c => c && c.parentType === kind && c.parentId === id && (!client || c.visibleToClient === true))
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    },

    addComment(ctx, kind, id, text, visibleToClient) {
      if (!logic.canComment(ctx)) return err('ليست لديك صلاحية التعليق.');
      const rec = logic.getItem(ctx, kind, id); if (!rec) return err('العنصر غير موجود.');
      text = String(text || '').trim();
      if (!text) return err('اكتب نص التعليق أولًا.');
      if (text.length > MAX_COMMENT) return err('التعليق أطول من ' + MAX_COMMENT + ' حرفًا.');
      const acc = ctx.account();
      const caseId = rec.caseId || null;
      let clientId = rec.clientId || null;
      if (!clientId && caseId) { const c = ctx.DB.get('cases').find(x => x && x.id === caseId); clientId = (c && c.clientId) || null; }
      const c = { id: ctx.uid(), parentType: kind, parentId: id, text, authorId: acc.id, authorName: acc.name,
        createdAt: ctx.now(), visibleToClient: !!visibleToClient, caseId, clientId };
      ctx.DB.set('comments', ctx.DB.get('comments').concat([c]));
      ctx.log('تعليق على ' + KINDS[kind].label + ': ' + (rec.title || rec.desc || rec.date || ''));
      return { ok: true, comment: c };
    },

    // تأجيل ليوم آخر. المهمة والموعد: تتغير التاريخ مباشرة. الجلسة: نتيجتها «تأجيل» وتُنشأ جلسة بالتاريخ الجديد (كما في يوم المحكمة).
    postpone(ctx, kind, id, toDate, reason) {
      const k = KINDS[kind];
      if (!logic.canEdit(ctx, kind)) return err('ليست لديك صلاحية التعديل في هذا القسم.');
      const rec = logic.getItem(ctx, kind, id); if (!rec) return err('العنصر غير موجود.');
      toDate = String(toDate || '').trim(); reason = String(reason || '').trim();
      if (!ISO.test(toDate)) return err('اختر تاريخ التأجيل.');
      const from = rec[k.dateField] || '';
      if (toDate === from) return err('التاريخ الجديد هو نفسه التاريخ الحالي.');
      if (kind === 'session') {
        const ok = ctx.saveOutcome(id, { so: 'تأجيل', sn: toDate, sp: rec.nextNote || '', sx: rec.notes || '', reason });
        if (!ok) return err('لم يُحفظ التأجيل.');
        ctx.log('تأجيل جلسة من ' + from + ' إلى ' + toDate);
        return { ok: true };
      }
      const acc = ctx.account();
      const list = ctx.DB.get(k.coll); const cur = list.find(x => x.id === id);
      cur.postponements = Array.isArray(cur.postponements) ? cur.postponements : [];
      cur.postponements.push({ id: ctx.uid(), from, to: toDate, reason, byId: acc.id, byName: acc.name, at: ctx.now() });
      cur[k.dateField] = toDate; cur.updatedAt = ctx.now();
      ctx.DB.set(k.coll, list);
      ctx.log('تأجيل ' + k.label + ' من ' + from + ' إلى ' + toDate + ': ' + (cur.title || cur.desc || ''));
      return { ok: true };
    },

    // تسجيل النتيجة. v: المهمة/الموعد {text, finish}، الجلسة {outcome, nextDate, nextNote, notes}
    setResult(ctx, kind, id, v) {
      const k = KINDS[kind];
      if (!logic.canEdit(ctx, kind)) return err('ليست لديك صلاحية التعديل في هذا القسم.');
      const rec = logic.getItem(ctx, kind, id); if (!rec) return err('العنصر غير موجود.');
      v = v || {};
      if (kind === 'session') {
        if (!v.outcome) return err('اختر نتيجة الجلسة.');
        const ok = ctx.saveOutcome(id, { so: v.outcome, sn: v.nextDate || '', sp: v.nextNote || '', sx: v.notes || '', reason: '' });
        if (!ok) return err('لم تُحفظ النتيجة.');
        ctx.log('تسجيل نتيجة جلسة: ' + v.outcome);
        return { ok: true };
      }
      const text = String(v.text || '').trim();
      if (!text) return err('اكتب النتيجة أولًا.');
      const acc = ctx.account();
      const list = ctx.DB.get(k.coll); const cur = list.find(x => x.id === id);
      cur.result = text; cur.resultAt = ctx.now(); cur.resultById = acc.id; cur.resultBy = acc.name; cur.updatedAt = ctx.now();
      ctx.DB.set(k.coll, list);
      if (kind === 'task' && v.finish && cur.status !== 'منتهية') ctx.toggleTask(id);
      ctx.log('تسجيل نتيجة ' + k.label + ': ' + (cur.title || cur.desc || ''));
      return { ok: true };
    }
  };

  /* ====================== الواجهة (متصفح فقط) ====================== */
  const ui = {};
  let cur = null;   // {kind, id}

  function browserCtx() {
    const acc = () => (typeof dqCurrentAccount !== 'undefined' ? dqCurrentAccount : null);
    return {
      DB: DB,
      account: acc,
      canWrite: c => (root.MK && root.MK.canWrite ? root.MK.canWrite(c) : true),
      officeReadOnly: () => { try { return !!(root.MK && root.MK.subState && ['readonly', 'suspended'].includes(root.MK.subState())); } catch (e) { return false; } },
      uid: () => DB.uid(),
      now: () => new Date().toISOString(),
      log: op => {
        const a = acc(); if (!a) return;
        try {
          const lg = JSON.parse(localStorage.getItem('dq_activity_log') || '[]');
          lg.unshift({ id: DB.uid(), at: new Date().toISOString(), accountId: a.id, accountName: a.name, role: a.role, section: 'details', operation: op });
          localStorage.setItem('dq_activity_log', JSON.stringify(lg.slice(0, 1000)));
        } catch (e) { }
      },
      saveOutcome: (id, vals) => saveOutcome(id, vals),
      toggleTask: id => toggleTask(id)
    };
  }

  const E = s => esc(s == null ? '' : s);
  const fmtAt = iso => { try { return iso ? new Date(iso).toLocaleString('ar-EG') : ''; } catch (e) { return ''; } };
  const $ = id => document.getElementById(id);

  function ensureModal() {
    if ($('dqItemModal')) return;
    const st = document.createElement('style');
    st.textContent = '.dqi-sec{border:1px solid var(--border);border-radius:10px;padding:10px;margin:10px 0}' +
      '.dqi-sec h4{margin:0 0 8px;font-size:14px}.dqi-row{display:flex;gap:8px;padding:3px 0;font-size:13px;overflow-wrap:anywhere}' +
      '.dqi-row b{min-width:92px;color:var(--text-muted);font-weight:600}.dqi-sec textarea,.dqi-sec input[type=text],.dqi-sec input[type=date],.dqi-sec select{width:100%;margin:4px 0}' +
      '.dqi-cm{border-bottom:1px dashed var(--border);padding:6px 0;font-size:13px;overflow-wrap:anywhere}.dqi-cm small{color:var(--text-muted)}' +
      '.dqi-cm p{margin:3px 0;white-space:pre-wrap}';
    document.head.appendChild(st);
    const d = document.createElement('div'); d.className = 'modal-overlay'; d.id = 'dqItemModal';
    d.innerHTML = '<div class="modal"><div class="modal-header"><h3 id="dqItemTitle"></h3><button class="modal-close" onclick="closeModal(\'dqItemModal\')">×</button></div>' +
      '<div class="modal-body" id="dqItemBody"></div><div class="modal-footer" id="dqItemFoot"></div></div>';
    document.body.appendChild(d);
  }

  function row(label, val) { return val ? '<div class="dqi-row"><b>' + label + '</b><span>' + val + '</span></div>' : ''; }

  function detailsHTML(ctx, kind, r) {
    const cs = DB.get('cases').find(x => x.id === r.caseId);
    const cl = DB.get('clients').find(x => x.id === (r.clientId || (cs && cs.clientId)));
    const caseTxt = cs ? E(cs.number || 'لم يصدر رقم بعد') + ' — ' + E(cs.subject) : '';
    let h = '';
    if (kind === 'task') {
      const late = r.status !== 'منتهية' && r.due && r.due < isoToday();
      h = row('المهمة', '<strong>' + E(r.title) + '</strong>') + row('القضية', caseTxt) + row('الموكل', cl ? E(cl.name) : '') +
        row('المسؤول', E(r.assignee) || 'غير مسندة') + row('الاستحقاق', E(r.due || '—') + (late ? ' <span class="badge badge-red">متأخرة</span>' : '')) +
        row('الحالة', E(r.status)) + row('أنشأها', E(r.createdByName) + (r.createdAt ? ' · ' + fmtAt(r.createdAt) : ''));
    } else if (kind === 'event') {
      h = row('النوع', E(r.type)) + row('الوصف', '<strong>' + E(r.desc) + '</strong>') + row('التاريخ', E(r.date) + (r.time ? ' · ' + E(r.time) : '')) +
        row('القضية', caseTxt) + row('الموكل', cl ? E(cl.name) : '') + row('التذكير', r.remind ? 'قبل ' + E(r.remind) + ' يوم' : '');
    } else {
      h = row('القضية', caseTxt) + row('الموكل', cl ? E(cl.name) : '') + row('التاريخ', E(r.date) + (r.time ? ' · ' + E(r.time) : '')) +
        row('التحضير', E(r.prep)) + row('النتيجة', r.outcome ? '<strong>' + E(r.outcome) + '</strong>' : 'لم تُسجَّل بعد') +
        row('ملاحظات', E(r.notes)) + row('الجلسة القادمة', r.nextDate ? E(r.nextDate) + (r.nextNote ? ' — ' + E(r.nextNote) : '') : '');
    }
    return '<div class="dqi-sec">' + h + '</div>';
  }

  function resultHTML(ctx, kind, r, edit) {
    let shown = '';
    if (kind !== 'session' && r.result) shown = '<p style="white-space:pre-wrap;margin:0 0 6px">' + E(r.result) + '</p><small style="color:var(--text-muted)">' + E(r.resultBy) + ' · ' + fmtAt(r.resultAt) + '</small>';
    else if (kind === 'session' && r.outcome) shown = '<p style="margin:0 0 6px"><strong>' + E(r.outcome) + '</strong>' + (r.notes ? ' — ' + E(r.notes) : '') + '</p>';
    else shown = '<p style="margin:0;color:var(--text-muted)">لم تُسجَّل نتيجة بعد.</p>';
    let form = '';
    if (edit) {
      if (kind === 'session') {
        form = '<select id="dqiOutcome"><option value="">— اختر النتيجة —</option>' + OUTCOMES.map(o => '<option' + (r.outcome === o ? ' selected' : '') + '>' + E(o) + '</option>').join('') + '</select>' +
          '<input type="date" id="dqiNext" value="' + E(r.nextDate || '') + '" title="تاريخ الجلسة القادمة"><input type="text" id="dqiNextNote" placeholder="تحضير الجلسة القادمة (اختياري)" value="' + E(r.nextNote || '') + '">' +
          '<textarea id="dqiNotes" rows="2" placeholder="ملاحظات/قرار الجلسة">' + E(r.notes || '') + '</textarea>';
      } else {
        form = '<textarea id="dqiResult" rows="3" placeholder="اكتب النتيجة">' + E(r.result || '') + '</textarea>' +
          (kind === 'task' && r.status !== 'منتهية' ? '<label style="font-size:13px"><input type="checkbox" id="dqiFinish"> تحديد المهمة كمنتهية</label>' : '');
      }
      form += '<button class="btn btn-primary btn-sm" onclick="DQ_DETAILS.ui.saveResult()">حفظ النتيجة</button>';
    }
    return '<div class="dqi-sec"><h4>النتيجة</h4>' + shown + form + '</div>';
  }

  function postponeHTML(ctx, kind, r, edit) {
    const hist = logic.postponementHistory(ctx, kind, r);
    const list = hist.length ? hist.map(p => '<div class="dqi-cm"><strong>' + E(p.from) + ' ← ' + E(p.to) + '</strong>' + (p.reason ? '<p>' + E(p.reason) + '</p>' : '') +
      '<small>' + E(p.byName) + ' · ' + fmtAt(p.at) + '</small></div>').join('') : '<p style="margin:0;color:var(--text-muted)">لا توجد تأجيلات.</p>';
    let form = '';
    if (edit) {
      form = '<input type="date" id="dqiPostTo" title="التاريخ الجديد"><input type="text" id="dqiPostReason" placeholder="سبب التأجيل (اختياري)">' +
        (kind === 'session' ? '<small style="color:var(--text-muted)">تأجيل الجلسة يسجّل نتيجتها «تأجيل» وينشئ جلسة بالتاريخ الجديد.</small><br>' : '') +
        '<button class="btn btn-outline btn-sm" onclick="DQ_DETAILS.ui.postpone()">تأجيل</button>';
    }
    return '<div class="dqi-sec"><h4>سجل التأجيلات</h4>' + list + form + '</div>';
  }

  function commentsHTML(ctx, kind, id, can) {
    const cm = logic.listComments(ctx, kind, id);
    const list = cm.length ? cm.map(c => '<div class="dqi-cm"><strong>' + E(c.authorName) + '</strong> <small>' + fmtAt(c.createdAt) + '</small>' +
      (c.visibleToClient ? ' <span class="badge badge-green">يظهر للموكل</span>' : '') + '<p>' + E(c.text) + '</p></div>').join('') :
      '<p style="margin:0;color:var(--text-muted)">لا توجد تعليقات.</p>';
    let form = '';
    if (can) {
      form = '<textarea id="dqiComment" rows="2" maxlength="' + MAX_COMMENT + '" placeholder="اكتب تعليقًا"></textarea>' +
        '<label style="font-size:13px"><input type="checkbox" id="dqiCmClient"> يظهر للموكل</label> ' +
        '<button class="btn btn-primary btn-sm" onclick="DQ_DETAILS.ui.comment()">إرسال</button>';
    }
    return '<div class="dqi-sec"><h4>التعليقات (' + cm.length + ')</h4>' + list + form + '</div>';
  }

  ui.open = function (kind, id) {
    if (typeof kind === 'string' && kind.indexOf('task:') === 0) { id = kind.slice(5); kind = 'task'; }
    if (id && typeof id === 'string' && id.indexOf('task:') === 0) { id = id.slice(5); kind = 'task'; }
    if (!KINDS[kind]) return;
    ensureModal(); cur = { kind, id }; ui.render();
    $('dqItemModal').classList.add('show');
  };
  ui.render = function () {
    if (!cur) return;
    const ctx = browserCtx(), k = KINDS[cur.kind], r = logic.getItem(ctx, cur.kind, cur.id);
    if (!r) { closeModal('dqItemModal'); return; }
    const edit = logic.canEdit(ctx, cur.kind), cm = logic.canComment(ctx);
    $('dqItemTitle').textContent = k.title;
    $('dqItemBody').innerHTML = detailsHTML(ctx, cur.kind, r) + resultHTML(ctx, cur.kind, r, edit) + postponeHTML(ctx, cur.kind, r, edit) + commentsHTML(ctx, cur.kind, cur.id, cm);
    $('dqItemFoot').innerHTML = (edit ? '<button class="btn btn-outline" onclick="DQ_DETAILS.ui.edit()">تعديل البيانات</button>' : '') +
      '<button class="btn btn-outline" onclick="closeModal(\'dqItemModal\')">إغلاق</button>';
  };
  function refreshViews() {
    const a = document.querySelector('.page.active'); const p = a ? a.id.replace('page-', '') : '';
    const fn = { dashboard: 'renderDashboard', tasks: 'renderTasks', agenda: 'renderAgenda', calendar: 'renderEvents', courtday: 'renderCourtDay' }[p];
    try { if (fn && typeof root[fn] === 'function') root[fn](); } catch (e) { }
    try { updateNavCounts(); } catch (e) { }
  }
  function run(fn) {
    let r;
    try { r = fn(); } catch (e) { alert(e && e.message ? e.message : 'تعذر الحفظ.'); ui.render(); return; }
    if (!r || !r.ok) { if (r && r.error) alert(r.error); return; }
    refreshViews(); ui.render();
  }
  const val = id => ($(id) || {}).value || '';
  ui.saveResult = function () {
    const ctx = browserCtx();
    run(() => cur.kind === 'session'
      ? logic.setResult(ctx, 'session', cur.id, { outcome: val('dqiOutcome'), nextDate: val('dqiNext'), nextNote: val('dqiNextNote'), notes: val('dqiNotes') })
      : logic.setResult(ctx, cur.kind, cur.id, { text: val('dqiResult'), finish: !!($('dqiFinish') || {}).checked }));
  };
  ui.postpone = function () {
    const ctx = browserCtx(), r = logic.getItem(ctx, cur.kind, cur.id);
    if (cur.kind === 'session' && r && r.outcome && r.outcome !== 'تأجيل' && !confirm('لهذه الجلسة نتيجة مسجلة («' + r.outcome + '»). سيتم استبدالها بـ «تأجيل». متابعة؟')) return;
    run(() => logic.postpone(ctx, cur.kind, cur.id, val('dqiPostTo'), val('dqiPostReason')));
  };
  ui.comment = function () {
    const ctx = browserCtx();
    run(() => logic.addComment(ctx, cur.kind, cur.id, val('dqiComment'), !!($('dqiCmClient') || {}).checked));
  };
  ui.edit = function () {
    const c = cur; closeModal('dqItemModal');
    if (c.kind === 'task') openTaskModal({ id: c.id });
    else if (c.kind === 'event') openEventModal(c.id);
    else openSessionModal({ id: c.id });
  };

  const api = { KINDS, logic, ui, open: ui.open };
  root.DQ_DETAILS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
