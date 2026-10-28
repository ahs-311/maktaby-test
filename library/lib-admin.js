/* مكتبي — إدارة المكتبة القانونية (طبقة فوق الفهرس الثابت) */
(function (global) {
  'use strict';
  const KEY = 'mk_library_overlay_v1';
  const PAGE_SIZE = 40;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      return {
        items: Array.isArray(raw.items) ? raw.items : [],
        categories: Array.isArray(raw.categories) ? raw.categories : []
      };
    } catch (e) {
      return { items: [], categories: [] };
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify({
      items: data.items || [],
      categories: data.categories || []
    }));
  }

  function uid() {
    return 'lib-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function canManage() {
    try {
      if (typeof isMgr === 'function' && isMgr()) return true;
      if (typeof dqCurrentAccount !== 'undefined' && dqCurrentAccount) {
        const r = dqCurrentAccount.role || '';
        if (r === 'owner' || r === 'admin' || r === 'manager' || r === 'مدير' || r === 'مالك') return true;
      }
    } catch (e) {}
    // بدون حسابات: السماح بالإدارة المحلية على هذا الجهاز
    return true;
  }

  function customItems(includeHidden) {
    return load().items.filter(function (it) {
      if (!includeHidden && it.hidden) return false;
      return true;
    });
  }

  function mergedCatalog() {
    const base = (global.MK_LIBRARY_CATALOG || []).map(function (c) {
      return Object.assign({}, c, { custom: false, hidden: false });
    });
    const hide = {};
    const overlay = load();
    overlay.items.forEach(function (it) {
      if (it.baseId && it.hidden) hide[it.baseId] = true;
    });
    const out = base.filter(function (c) { return !hide[c.id]; });
    customItems(false).forEach(function (it) {
      out.push({
        id: it.id,
        file: '',
        title: it.title || 'بدون عنوان',
        category: it.category || 'إضافات المكتب',
        size: (it.content || '').length,
        chars: (it.content || '').length,
        custom: true,
        source: it.source || '',
        notes: it.notes || ''
      });
    });
    return out;
  }

  function mergedSearchDocs() {
    const base = (global.MK_LIBRARY_SEARCH || []).slice();
    const byId = {};
    base.forEach(function (d) { byId[d.id] = d; });
    customItems(false).forEach(function (it) {
      byId[it.id] = {
        id: it.id,
        title: it.title || '',
        category: it.category || 'إضافات المكتب',
        file: '',
        text: (it.content || '').slice(0, 80000),
        custom: true
      };
    });
    // إخفاء عناصر أساس مخفية
    const overlay = load();
    overlay.items.forEach(function (it) {
      if (it.baseId && it.hidden) delete byId[it.baseId];
    });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function extraCategories() {
    const set = {};
    load().categories.forEach(function (c) { if (c) set[c] = 1; });
    customItems(true).forEach(function (it) { if (it.category) set[it.category] = 1; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ar'); });
  }

  function getItem(id) {
    return load().items.find(function (x) { return x.id === id; }) || null;
  }

  function upsertItem(fields) {
    const data = load();
    const id = fields.id || uid();
    const existing = data.items.findIndex(function (x) { return x.id === id; });
    const row = {
      id: id,
      title: (fields.title || '').trim(),
      category: (fields.category || 'إضافات المكتب').trim(),
      content: fields.content || '',
      source: (fields.source || '').trim(),
      notes: (fields.notes || '').trim(),
      hidden: !!fields.hidden,
      custom: true,
      updatedAt: new Date().toISOString(),
      createdAt: existing >= 0 ? (data.items[existing].createdAt || new Date().toISOString()) : new Date().toISOString()
    };
    if (!row.title) throw new Error('العنوان مطلوب');
    if (existing >= 0) data.items[existing] = Object.assign({}, data.items[existing], row);
    else data.items.unshift(row);
    if (row.category && data.categories.indexOf(row.category) < 0) data.categories.push(row.category);
    save(data);
    return row;
  }

  function hideBase(baseId, hidden) {
    const data = load();
    let row = data.items.find(function (x) { return x.baseId === baseId && !x.custom; });
    if (!row) {
      const base = (global.MK_LIBRARY_CATALOG || []).find(function (c) { return c.id === baseId; });
      row = {
        id: 'hide-' + baseId,
        baseId: baseId,
        title: base ? base.title : baseId,
        category: base ? base.category : '',
        content: '',
        hidden: !!hidden,
        custom: false,
        updatedAt: new Date().toISOString()
      };
      data.items.push(row);
    } else {
      row.hidden = !!hidden;
      row.updatedAt = new Date().toISOString();
    }
    save(data);
  }

  function removeItem(id) {
    const data = load();
    data.items = data.items.filter(function (x) { return x.id !== id; });
    save(data);
  }

  function exportOverlay() {
    return JSON.stringify(load(), null, 2);
  }

  function importOverlay(jsonText, mode) {
    const incoming = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
    if (!incoming || !Array.isArray(incoming.items)) throw new Error('ملف غير صالح');
    const data = mode === 'replace' ? { items: [], categories: [] } : load();
    const map = {};
    data.items.forEach(function (it, i) { map[it.id] = i; });
    incoming.items.forEach(function (it) {
      if (!it || !it.id) it.id = uid();
      if (map[it.id] != null) data.items[map[it.id]] = it;
      else data.items.unshift(it);
    });
    (incoming.categories || []).forEach(function (c) {
      if (c && data.categories.indexOf(c) < 0) data.categories.push(c);
    });
    save(data);
  }

  // ——— UI ———
  let adminPage = 0;
  let adminFilter = '';
  let adminCat = '';

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function renderAdmin() {
    const root = document.getElementById('libAdminRoot');
    if (!root) return;
    if (!canManage()) {
      root.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">إدارة المكتبة متاحة لحساب المدير على هذا الجهاز.</p>';
      return;
    }
    const data = load();
    const baseCount = (global.MK_LIBRARY_CATALOG || []).length;
    let rows = data.items.slice();
    if (adminFilter) {
      const q = adminFilter.toLowerCase();
      rows = rows.filter(function (it) {
        return (it.title || '').toLowerCase().indexOf(q) >= 0 ||
          (it.category || '').toLowerCase().indexOf(q) >= 0 ||
          (it.content || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    if (adminCat) rows = rows.filter(function (it) { return it.category === adminCat || it.baseId && adminCat === '__hidden_base__'; });
    const total = rows.length;
    const start = adminPage * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    const cats = extraCategories();

    root.innerHTML = `
      <div class="card" style="margin-top:12px;">
        <div class="card-header" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">
          <h2 style="margin:0;font-size:16px;">إدارة المكتبة</h2>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button type="button" class="btn btn-primary btn-sm" onclick="LIB_ADMIN.openForm()">+ إضافة نص</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="LIB_ADMIN.exportFile()">تصدير الإضافات</button>
            <label class="btn btn-outline btn-sm" style="cursor:pointer;margin:0;">
              استيراد
              <input type="file" accept=".json,application/json" style="display:none" onchange="LIB_ADMIN.importFile(event)" />
            </label>
          </div>
        </div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
            الأساس المضمّن: <strong>${baseCount}</strong> نصًا (للقراءة فقط).
            الإضافات/التعديلات المحلية: <strong>${data.items.length}</strong>.
            تُحفظ على هذا الجهاز وتدخل في التصفح والبحث والنسخ الاحتياطي عبر التصدير.
          </p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
            <input type="search" id="libAdminQ" placeholder="بحث في العناصر المُدارة..." value="${esc(adminFilter)}"
              style="flex:1;min-width:160px;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);"
              onkeydown="if(event.key==='Enter')LIB_ADMIN.applyFilter()" />
            <select id="libAdminCat" onchange="LIB_ADMIN.applyFilter()" style="padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);">
              <option value="">كل التصنيفات المُدارة</option>
              ${cats.map(function (c) { return '<option value="' + esc(c) + '"' + (adminCat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('')}
            </select>
            <button type="button" class="btn btn-outline btn-sm" onclick="LIB_ADMIN.applyFilter()">تصفية</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>العنوان</th><th>التصنيف</th><th>النوع</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                ${pageRows.map(function (it) {
                  const kind = it.baseId && !it.content ? 'إخفاء أساس' : (it.custom !== false ? 'إضافة' : 'إدارة');
                  const st = it.hidden ? '<span class="badge badge-yellow">مخفي</span>' : '<span class="badge badge-green">ظاهر</span>';
                  return '<tr>' +
                    '<td><strong>' + esc(it.title) + '</strong></td>' +
                    '<td>' + esc(it.category || '—') + '</td>' +
                    '<td>' + kind + '</td>' +
                    '<td>' + st + '</td>' +
                    '<td class="actions-cell">' +
                      (it.custom !== false && !it.baseId ? '<button type="button" class="btn btn-outline btn-sm" onclick="LIB_ADMIN.openForm(\'' + it.id + '\')">تعديل</button>' : '') +
                      (it.custom !== false && !it.baseId ? '<button type="button" class="btn btn-outline btn-sm" onclick="LIB_ADMIN.toggleHide(\'' + it.id + '\')">' + (it.hidden ? 'إظهار' : 'إخفاء') + '</button>' : '') +
                      (it.baseId ? '<button type="button" class="btn btn-outline btn-sm" onclick="LIB_ADMIN.unhideBase(\'' + it.baseId + '\')">إظهار الأساس</button>' : '') +
                      '<button type="button" class="btn btn-danger btn-sm" onclick="LIB_ADMIN.remove(\'' + it.id + '\')">حذف</button>' +
                    '</td></tr>';
                }).join('') || '<tr><td colspan="5">لا عناصر مُدارة بعد. أضف نصًا أو اخفِ عنصرًا من التصفح.</td></tr>'}
              </tbody>
            </table>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" ${start <= 0 ? 'disabled' : ''} onclick="LIB_ADMIN.prevPage()">السابق</button>
            <span style="font-size:12px;color:var(--text-muted);">${total ? (start + 1) + '–' + Math.min(start + PAGE_SIZE, total) + ' من ' + total : '0'}</span>
            <button type="button" class="btn btn-outline btn-sm" ${start + PAGE_SIZE >= total ? 'disabled' : ''} onclick="LIB_ADMIN.nextPage()">التالي</button>
          </div>
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
            <h3 style="font-size:14px;margin-bottom:8px;">إخفاء نص من المكتبة الأساسية</h3>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              <input type="text" id="libHideBaseId" placeholder="معرّف العنصر من الفهرس (id)" style="flex:1;min-width:140px;padding:8px;border-radius:10px;border:1px solid var(--border);" />
              <button type="button" class="btn btn-outline btn-sm" onclick="LIB_ADMIN.hideBaseFromInput()">إخفاء من التصفح</button>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:6px;">لا يحذف الملف من المشروع؛ يخفيه فقط من عرض هذا الجهاز.</p>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="libAdminModal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3 id="libAdminModalTitle">إضافة نص للمكتبة</h3>
            <button type="button" class="modal-close" onclick="LIB_ADMIN.closeForm()">×</button>
          </div>
          <div class="modal-body">
            <input type="hidden" id="libAdmId" />
            <div class="form-group"><label>العنوان *</label><input type="text" id="libAdmTitle" /></div>
            <div class="form-grid">
              <div class="form-group"><label>التصنيف</label>
                <input type="text" id="libAdmCategory" list="libAdmCatList" placeholder="مثال: إضافات المكتب" />
                <datalist id="libAdmCatList"></datalist>
              </div>
              <div class="form-group"><label>المصدر (اختياري)</label><input type="text" id="libAdmSource" /></div>
            </div>
            <div class="form-group"><label>المحتوى *</label>
              <textarea id="libAdmContent" rows="12" placeholder="الصق النص القانوني هنا..."></textarea>
            </div>
            <div class="form-group"><label>ملاحظات داخلية</label><input type="text" id="libAdmNotes" /></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" onclick="LIB_ADMIN.saveForm()">حفظ</button>
            <button type="button" class="btn btn-outline" onclick="LIB_ADMIN.closeForm()">إلغاء</button>
          </div>
        </div>
      </div>
    `;
  }

  function applyFilter() {
    adminFilter = (document.getElementById('libAdminQ') || {}).value || '';
    adminCat = (document.getElementById('libAdminCat') || {}).value || '';
    adminPage = 0;
    renderAdmin();
  }

  function openForm(id) {
    renderAdmin();
    const modal = document.getElementById('libAdminModal');
    const dl = document.getElementById('libAdmCatList');
    if (dl) {
      const cats = [...new Set([
        ...((global.MK_LIBRARY_CATALOG || []).map(function (c) { return c.category; })),
        ...extraCategories(),
        'إضافات المكتب'
      ])].filter(Boolean).sort(function (a, b) { return a.localeCompare(b, 'ar'); });
      dl.innerHTML = cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
    }
    document.getElementById('libAdmId').value = id || '';
    document.getElementById('libAdminModalTitle').textContent = id ? 'تعديل نص' : 'إضافة نص للمكتبة';
    if (id) {
      const it = getItem(id);
      if (it) {
        document.getElementById('libAdmTitle').value = it.title || '';
        document.getElementById('libAdmCategory').value = it.category || '';
        document.getElementById('libAdmSource').value = it.source || '';
        document.getElementById('libAdmContent').value = it.content || '';
        document.getElementById('libAdmNotes').value = it.notes || '';
      }
    } else {
      document.getElementById('libAdmTitle').value = '';
      document.getElementById('libAdmCategory').value = 'إضافات المكتب';
      document.getElementById('libAdmSource').value = '';
      document.getElementById('libAdmContent').value = '';
      document.getElementById('libAdmNotes').value = '';
    }
    if (modal) modal.classList.add('show');
  }

  function closeForm() {
    const modal = document.getElementById('libAdminModal');
    if (modal) modal.classList.remove('show');
  }

  function saveForm() {
    try {
      upsertItem({
        id: document.getElementById('libAdmId').value || undefined,
        title: document.getElementById('libAdmTitle').value,
        category: document.getElementById('libAdmCategory').value,
        source: document.getElementById('libAdmSource').value,
        content: document.getElementById('libAdmContent').value,
        notes: document.getElementById('libAdmNotes').value
      });
      closeForm();
      if (typeof toast === 'function') toast('تم حفظ عنصر المكتبة');
      refreshBrowse();
      renderAdmin();
    } catch (e) {
      alert(e.message || e);
    }
  }

  function toggleHide(id) {
    const data = load();
    const it = data.items.find(function (x) { return x.id === id; });
    if (!it) return;
    it.hidden = !it.hidden;
    it.updatedAt = new Date().toISOString();
    save(data);
    refreshBrowse();
    renderAdmin();
  }

  function remove(id) {
    if (!confirm('حذف هذا العنصر من طبقة الإدارة؟')) return;
    removeItem(id);
    refreshBrowse();
    renderAdmin();
  }

  function hideBaseFromInput() {
    const id = ((document.getElementById('libHideBaseId') || {}).value || '').trim();
    if (!id) return alert('أدخل معرّف العنصر');
    hideBase(id, true);
    if (typeof toast === 'function') toast('تم الإخفاء من التصفح على هذا الجهاز');
    refreshBrowse();
    renderAdmin();
  }

  function unhideBase(baseId) {
    const data = load();
    data.items = data.items.filter(function (x) { return !(x.baseId === baseId && !x.content); });
    save(data);
    refreshBrowse();
    renderAdmin();
  }

  function refreshBrowse() {
    try {
      if (typeof initLibraryUI === 'function') {
        const sel = document.getElementById('libraryCategory');
        if (sel) {
          const keep = sel.value;
          while (sel.options.length > 1) sel.remove(1);
          sel.dataset.filled = '';
        }
        initLibraryUI();
      } else if (typeof renderLibraryBrowse === 'function') renderLibraryBrowse();
    } catch (e) {}
  }

  function exportFile() {
    const blob = new Blob([exportOverlay()], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'maktaby-library-overlay.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function importFile(ev) {
    const f = ev.target && ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        importOverlay(String(reader.result || ''), 'merge');
        if (typeof toast === 'function') toast('تم استيراد إضافات المكتبة');
        refreshBrowse();
        renderAdmin();
      } catch (e) {
        alert('فشل الاستيراد: ' + (e.message || e));
      }
    };
    reader.readAsText(f);
    ev.target.value = '';
  }

  function openCustomContent(item) {
    const titleEl = document.getElementById('libViewerTitle');
    if (titleEl) titleEl.textContent = item.title || 'نص';
    const frame = document.getElementById('libViewerFrame');
    const html = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>body{font-family:Tahoma,Arial,sans-serif;padding:16px;line-height:1.8;color:#222;} pre{white-space:pre-wrap;}</style></head><body><h1>' +
      esc(item.title) + '</h1>' +
      (item.source ? '<p style="color:#666">المصدر: ' + esc(item.source) + '</p>' : '') +
      '<pre>' + esc(item.content || '') + '</pre></body></html>';
    if (frame) {
      frame.src = 'about:blank';
      frame.srcdoc = html;
    }
    const ov = document.getElementById('libViewerOverlay');
    if (ov) ov.style.display = 'block';
    document.body.style.overflow = 'hidden';
    global._libCurrentFile = null;
    global._libCurrentCustom = item.id;
  }

  global.LIB_ADMIN = {
    load: load,
    save: save,
    canManage: canManage,
    mergedCatalog: mergedCatalog,
    mergedSearchDocs: mergedSearchDocs,
    getItem: getItem,
    renderAdmin: renderAdmin,
    applyFilter: applyFilter,
    openForm: openForm,
    closeForm: closeForm,
    saveForm: saveForm,
    toggleHide: toggleHide,
    remove: remove,
    hideBaseFromInput: hideBaseFromInput,
    unhideBase: unhideBase,
    exportFile: exportFile,
    importFile: importFile,
    openCustomContent: openCustomContent,
    prevPage: function () { if (adminPage > 0) { adminPage--; renderAdmin(); } },
    nextPage: function () { adminPage++; renderAdmin(); },
    KEY: KEY
  };
})(window);
