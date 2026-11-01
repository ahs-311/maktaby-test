/* =========================================================================
   مساعد المحامي الرقمي الشامل — مدمج في مشروع maktaby-test
   يعتمد على: showPage / DB / toast / dqHasPerm الموجودة مسبقاً
   ========================================================================= */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- 1) بيانات المنصات ---------- */
  const PLATFORMS = [
    { name: 'بوابة المحاكم المصرية', desc: 'الاستعلام عن القضايا والجلسات ورفع الدعاوى', category: 'court', badge: 'المحاكم', link: 'https://www.court.gov.eg' },
    { name: 'وزارة العدل المصرية', desc: 'التوثيق والشهر العقاري والتصديق', category: 'ministry', badge: 'الوزارة', link: 'https://www.moj.gov.eg' },
    { name: 'الجريدة الرسمية', desc: 'نشر القوانين والقرارات', category: 'gazette', badge: 'الجريدة', link: 'https://www.cc.gov.eg' },
    { name: 'محكمة النقض', desc: 'أحكام النقض والمبادئ القانونية', category: 'cassation', badge: 'النقض', link: 'https://www.cc.gov.eg/cassation' },
    { name: 'النيابة العامة', desc: 'خدمات النيابة والمحاضر', category: 'ministry', badge: 'النيابة', link: 'https://www.publicprosecution.gov.eg' },
    { name: 'الشهر العقاري', desc: 'تسجيل العقارات والتوثيق', category: 'service', badge: 'خدمة', link: 'https://www.realestate.gov.eg' },
    { name: 'مجلس الدولة', desc: 'قضاء الإلغاء والفتوى', category: 'court', badge: 'المحاكم', link: 'https://www.council.gov.eg' },
    { name: 'المحكمة الدستورية', desc: 'الرقابة على دستورية القوانين', category: 'court', badge: 'المحاكم', link: 'https://www.scc.gov.eg' }
  ];

  /* ---------- 2) مولدات الصيغ ---------- */
  const DOC_LABELS = { lawsuit:'صحيفة دعوى', defense:'مذكرة دفاع', appeal:'استئناف', cassation_memo:'مذكرة نقض', objection:'اعتراض' };
  const CASE_LABELS = { civil:'مدني', commercial:'تجاري', family:'أحوال شخصية', criminal:'جنائي', administrative:'إداري', labor:'عمالي' };
  const NOTICE_LABELS = { payment:'تكليف بالوفاء', hand_to_hand:'إنذار يد بيد', evacuation:'إنذار بالإخلاء', termination:'إنذار بفسخ العقد' };
  const REQUEST_LABELS = { no_appeal_cert:'شهادة عدم حصول استئناف', document_permit:'تصريح بمستند', official_copy:'صورة رسمية من حكم', case_status:'استعلام عن حالة قضية', execution_request:'طلب تنفيذ', adjournment:'طلب تأجيل جلسة' };

  function today() { return new Date().toLocaleDateString('ar-EG'); }

  function buildDoc() {
    const docType = $('mkDocType').value, caseType = $('mkCaseType').value;
    const plaintiff = $('mkPlaintiff').value.trim(), defendant = $('mkDefendant').value.trim();
    const facts = $('mkFacts').value.trim(), reqs = $('mkRequests').value.trim();
    if (!docType || !caseType || !facts) return alert('يرجى استكمال الحقول الإلزامية');
    let t = `بسم الله الرحمن الرحيم\n\n${DOC_LABELS[docType]} — قضية ${CASE_LABELS[caseType]}\nالتاريخ: ${today()}\n\n`;
    t += `المدعي/الطاعن: ${plaintiff || '................'}\nالمدعى عليه: ${defendant || '................'}\n\n`;
    t += `الوقائع:\n${facts}\n\nالطلبات:\n${reqs || 'إلزام المدعى عليه بالطلبات مع المصاريف وأتعاب المحاماة.'}\n\nلذلك نلتمس القضاء بما سبق.\n\nالمحامي:\n........................\n`;
    $('mkDocResult').textContent = t;
    $('mkDocActions').style.display = 'flex';
  }

  function buildNotice() {
    const type = $('mkNoticeType').value, notifier = $('mkNotifier').value.trim(), notified = $('mkNotified').value.trim();
    const amount = $('mkNoticeAmount').value.trim(), deadline = $('mkNoticeDeadline').value.trim(), reason = $('mkNoticeReason').value.trim();
    if (!type || !notifier || !notified || !deadline || !reason) return alert('يرجى استكمال الحقول الإلزامية');
    let t = `بسم الله الرحمن الرحيم\n\n${NOTICE_LABELS[type]}\nالتاريخ: ${today()}\n\n`;
    t += `المُنذِر: ${notifier}\nالمُنذَر إليه: ${notified}\n\nالموضوع: ${NOTICE_LABELS[type]}\n`;
    if (amount) t += `المبلغ/الالتزام: ${amount}\n`;
    t += `المهلة: ${deadline}\n\nالأسباب:\n${reason}\n\n`;
    t += `وبناءً على ما سبق، ننذركم بضرورة تنفيذ التزاماتكم خلال المهلة المحددة، وإلا سنضطر لاتخاذ كافة الإجراءات القانونية.\n\nالمُنذِر:\n........................\nالمحضر:\n........................\n`;
    $('mkNoticeResult').textContent = t;
    $('mkNoticeActions').style.display = 'flex';
  }

  function buildRequest() {
    const type = $('mkRequestType').value, applicant = $('mkReqApplicant').value.trim();
    const caseNo = $('mkReqCaseNo').value.trim(), court = $('mkReqCourt').value.trim(), details = $('mkReqDetails').value.trim();
    if (!type || !applicant || !court) return alert('يرجى استكمال الحقول الإلزامية');
    let t = `بسم الله الرحمن الرحيم\n\nإلى السيد/ رئيس ${court}\nالتاريخ: ${today()}\n\nمقدم الطلب: ${applicant}\n`;
    if (caseNo) t += `رقم القضية/المحضر: ${caseNo}\n`;
    t += `\nالموضوع: ${REQUEST_LABELS[type]}\n\nأتقدم لسيادتكم بطلب ${REQUEST_LABELS[type]}`;
    if (caseNo) t += ` بخصوص القضية/المحضر رقم ${caseNo}`;
    t += `.\n`;
    if (details) t += `\nتفاصيل إضافية:\n${details}\n`;
    t += `\nوتفضلوا بقبول وافر الاحترام.\n\nمقدم الطلب:\n${applicant}\nالتوقيع: ........................\n`;
    $('mkRequestResult').textContent = t;
    $('mkRequestActions').style.display = 'flex';
  }

  /* ---------- 3) نسخ إلى الحافظة ---------- */
  function copyEl(id) {
    const el = $(id); if (!el) return;
    const txt = el.innerText.trim();
    if (!txt) return toast('لا يوجد نص لنسخه');
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('تم النسخ')).catch(() => fallback(txt));
    else fallback(txt);
  }
  function fallback(txt) {
    const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('تم النسخ'); } catch { toast('تعذر النسخ'); }
    ta.remove();
  }

  /* ---------- 4) تصفية المنصات ---------- */
  let currentFilter = 'all', currentSearch = '';
  function renderPlatforms() {
    const grid = $('mkPlatformsGrid'); if (!grid) return;
    const filtered = PLATFORMS.filter(p => {
      const matchF = currentFilter === 'all' || p.category === currentFilter;
      const matchS = !currentSearch || p.name.includes(currentSearch) || p.desc.includes(currentSearch);
      return matchF && matchS;
    });
    grid.innerHTML = filtered.length ? filtered.map(p => `
      <div class="platform-card" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <h3 style="font-size:14px;margin:0;">${esc(p.name)}</h3>
          <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:var(--accent,#C5A869);color:#fff;white-space:nowrap;">${esc(p.badge)}</span>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin:6px 0;">${esc(p.desc)}</p>
        <a href="${p.link}" target="_blank" rel="noopener" style="color:var(--accent,#C5A869);font-weight:700;font-size:12px;text-decoration:none;">زيارة المنصة ←</a>
      </div>`).join('') : '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;">لا توجد نتائج</p>';
  }

  /* ---------- 5) بناء الصفحة ---------- */
  function buildPage() {
    if ($('page-lawyer-assistant')) return;
    if (!$('mkLA-style')) {
      const st = document.createElement('style'); st.id = 'mkLA-style';
      st.textContent = `
        .mkLA-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; border-bottom:1px solid var(--border); padding-bottom:8px; }
        .mkLA-tab { padding:7px 14px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--text); cursor:pointer; font-family:inherit; font-size:13px; font-weight:600; }
        .mkLA-tab.active { background:var(--accent,#C5A869); color:#1a1a1a; border-color:var(--accent,#C5A869); font-weight:700; }
        .mkLA-panel { display:none; }
        .mkLA-panel.active { display:block; }
        .mkLA-card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:14px; }
        .mkLA-card h2 { font-size:15px; margin:0 0 12px; color:var(--accent,#C5A869); padding-bottom:6px; border-bottom:2px solid var(--accent,#C5A869); }
        .mkLA-field { margin-bottom:10px; }
        .mkLA-field label { display:block; font-size:12px; font-weight:600; margin-bottom:4px; }
        .mkLA-field input, .mkLA-field select, .mkLA-field textarea { width:100%; padding:8px 10px; border:1px solid var(--border); border-radius:8px; font-family:inherit; font-size:13px; background:var(--card); color:var(--text); box-sizing:border-box; }
        .mkLA-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
        @media (max-width:600px){ .mkLA-row { grid-template-columns:1fr; } }
        .mkLA-result { margin-top:12px; padding:12px; background:var(--bg); border:1px dashed var(--border); border-radius:8px; white-space:pre-wrap; font-size:13px; line-height:1.9; min-height:50px; }
        .mkLA-result:empty::before { content:'سيظهر النص هنا…'; color:var(--text-muted); font-style:italic; }
        .mkLA-search { width:100%; padding:9px 12px; border:1px solid var(--border); border-radius:8px; margin-bottom:10px; font-family:inherit; background:var(--card); color:var(--text); box-sizing:border-box; }
        .mkLA-chips { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
        .mkLA-chip { padding:4px 12px; border-radius:16px; border:1px solid var(--border); background:var(--card); color:var(--text); cursor:pointer; font-family:inherit; font-size:12px; }
        .mkLA-chip.active { background:var(--accent,#C5A869); color:#1a1a1a; border-color:var(--accent,#C5A869); }
        #mkPlatformsGrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; }
      `;
      document.head.appendChild(st);
    }
    const pg = document.createElement('div');
    pg.className = 'page'; pg.id = 'page-lawyer-assistant';
    pg.innerHTML = `
      <div class="mkLA-card">
        <div class="mkLA-tabs">
          <button class="mkLA-tab active" data-la="platforms">🏛️ المنصات الحكومية</button>
          <button class="mkLA-tab" data-la="generator">📝 مولد الصيغ</button>
          <button class="mkLA-tab" data-la="notices">📢 الإنذارات</button>
          <button class="mkLA-tab" data-la="requests">📄 الطلبات</button>
        </div>

        <div class="mkLA-panel active" id="mkLA-platforms">
          <h2>دليل المنصات الحكومية والقضائية</h2>
          <input type="text" class="mkLA-search" id="mkPlatformSearch" placeholder="🔍 ابحث عن منصة أو خدمة…" />
          <div class="mkLA-chips" id="mkPlatformChips">
            <button class="mkLA-chip active" data-f="all">الكل</button>
            <button class="mkLA-chip" data-f="court">المحاكم</button>
            <button class="mkLA-chip" data-f="ministry">الوزارات</button>
            <button class="mkLA-chip" data-f="gazette">الجريدة</button>
            <button class="mkLA-chip" data-f="cassation">النقض</button>
            <button class="mkLA-chip" data-f="service">خدمات</button>
          </div>
          <div id="mkPlatformsGrid"></div>
        </div>

        <div class="mkLA-panel" id="mkLA-generator">
          <h2>مولد الصيغ والمذكرات والدعاوى</h2>
          <div class="mkLA-row">
            <div class="mkLA-field"><label>نوع المستند *</label>
              <select id="mkDocType"><option value="">اختر…</option>${Object.entries(DOC_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
            </div>
            <div class="mkLA-field"><label>نوع القضية *</label>
              <select id="mkCaseType"><option value="">اختر…</option>${Object.entries(CASE_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
            </div>
          </div>
          <div class="mkLA-field"><label>المدعي / الطاعن</label><input type="text" id="mkPlaintiff" /></div>
          <div class="mkLA-field"><label>المدعى عليه</label><input type="text" id="mkDefendant" /></div>
          <div class="mkLA-field"><label>الوقائع *</label><textarea id="mkFacts" rows="4"></textarea></div>
          <div class="mkLA-field"><label>الطلبات</label><textarea id="mkRequests" rows="3"></textarea></div>
          <button class="btn btn-primary" onclick="MK_LA.buildDoc()">⚙️ توليد الصياغة</button>
          <div class="mkLA-result" id="mkDocResult"></div>
          <div id="mkDocActions" style="display:none;margin-top:8px;"><button class="btn btn-outline btn-sm" onclick="MK_LA.copy('mkDocResult')">📋 نسخ</button></div>
        </div>

        <div class="mkLA-panel" id="mkLA-notices">
          <h2>مولّد الإنذارات والإعلانات القانونية</h2>
          <div class="mkLA-field"><label>نوع الإنذار *</label>
            <select id="mkNoticeType"><option value="">اختر…</option>${Object.entries(NOTICE_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
          </div>
          <div class="mkLA-row">
            <div class="mkLA-field"><label>المُنذِر *</label><input type="text" id="mkNotifier" /></div>
            <div class="mkLA-field"><label>المُنذَر إليه *</label><input type="text" id="mkNotified" /></div>
          </div>
          <div class="mkLA-field"><label>المبلغ / الالتزام</label><input type="text" id="mkNoticeAmount" /></div>
          <div class="mkLA-field"><label>المهلة *</label><input type="text" id="mkNoticeDeadline" placeholder="مثال: 15 يومًا" /></div>
          <div class="mkLA-field"><label>الأسباب *</label><textarea id="mkNoticeReason" rows="4"></textarea></div>
          <button class="btn btn-primary" onclick="MK_LA.buildNotice()">⚙️ توليد الإنذار</button>
          <div class="mkLA-result" id="mkNoticeResult"></div>
          <div id="mkNoticeActions" style="display:none;margin-top:8px;"><button class="btn btn-outline btn-sm" onclick="MK_LA.copy('mkNoticeResult')">📋 نسخ</button></div>
        </div>

        <div class="mkLA-panel" id="mkLA-requests">
          <h2>الطلبات الجاهزة</h2>
          <div class="mkLA-field"><label>نوع الطلب *</label>
            <select id="mkRequestType"><option value="">اختر…</option>${Object.entries(REQUEST_LABELS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select>
          </div>
          <div class="mkLA-row">
            <div class="mkLA-field"><label>مقدم الطلب *</label><input type="text" id="mkReqApplicant" /></div>
            <div class="mkLA-field"><label>رقم القضية</label><input type="text" id="mkReqCaseNo" /></div>
          </div>
          <div class="mkLA-field"><label>المحكمة / الجهة *</label><input type="text" id="mkReqCourt" /></div>
          <div class="mkLA-field"><label>تفاصيل إضافية</label><textarea id="mkReqDetails" rows="3"></textarea></div>
          <button class="btn btn-primary" onclick="MK_LA.buildRequest()">⚙️ توليد الطلب</button>
          <div class="mkLA-result" id="mkRequestResult"></div>
          <div id="mkRequestActions" style="display:none;margin-top:8px;"><button class="btn btn-outline btn-sm" onclick="MK_LA.copy('mkRequestResult')">📋 نسخ</button></div>
        </div>
      </div>`;
    // إضافتها بجانب باقي الصفحات
    const ref = $('page-lawsuits') || $('page-cases') || document.querySelector('.content');
    if (ref && ref.parentNode) ref.parentNode.appendChild(pg);
    else document.body.appendChild(pg);

    // ربط التبويبات
    pg.querySelectorAll('.mkLA-tab').forEach(b => {
      b.onclick = () => {
        pg.querySelectorAll('.mkLA-tab').forEach(x => x.classList.remove('active'));
        pg.querySelectorAll('.mkLA-panel').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const target = $('mkLA-' + b.dataset.la);
        if (target) target.classList.add('active');
      };
    });

    // ربط البحث والفلاتر
    $('mkPlatformSearch').oninput = e => { currentSearch = e.target.value.trim(); renderPlatforms(); };
    $('mkPlatformChips').querySelectorAll('.mkLA-chip').forEach(c => {
      c.onclick = () => {
        $('mkPlatformChips').querySelectorAll('.mkLA-chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        currentFilter = c.dataset.f;
        renderPlatforms();
      };
    });
    renderPlatforms();
  }

  /* ---------- 6) إضافة عنصر للـ Sidebar ---------- */
  function ensureNav() {
    if (document.querySelector('.nav-item[data-page="lawyer-assistant"]')) return;
    const ref = document.querySelector('.nav-item[data-page="deadlines"]') ||
                document.querySelector('.nav-item[data-page="library"]');
    if (!ref) return;
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.page = 'lawyer-assistant';
    btn.innerHTML = '<span class="icon">⚖️</span> مساعد المحامي الشامل';
    btn.addEventListener('click', () => window.showPage('lawyer-assistant'));
    ref.parentNode.insertBefore(btn, ref.nextSibling);
  }

  /* ---------- 7) تمكين الصلاحيات ---------- */
  function grantPermission() {
    // إضافة مساعد المحامي لصلاحيات المالك/المدير/المحامي
    if (typeof dqDefaultPerms === 'function' && !dqDefaultPerms.__la) {
      const _orig = dqDefaultPerms;
      window.dqDefaultPerms = function (role) {
        const p = _orig(role);
        if (['owner','manager','lawyer'].includes(role) && !p.includes('lawyer-assistant')) p.push('lawyer-assistant');
        return p;
      };
    }
  }

  /* ---------- 8) ربط showPage ---------- */
  function hookShowPage() {
    if (!window.showPage || window.showPage.__laHooked) return;
    const orig = window.showPage;
    const wrapped = function (id) {
      const r = orig.apply(this, arguments);
      if (id === 'lawyer-assistant') {
        buildPage();
        const title = document.getElementById('pageTitle');
        if (title) title.textContent = '⚖️ مساعد المحامي الشامل';
      }
      return r;
    };
    wrapped.__laHooked = true;
    window.showPage = wrapped;
  }

  /* ---------- 9) التهيئة ---------- */
  function init() {
    ensureNav();
    grantPermission();
    hookShowPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // تعريض الدوال للاستدعاء من onclick
  window.MK_LA = {
    buildDoc,
    buildNotice,
    buildRequest,
    copy: copyEl
  };
})();
