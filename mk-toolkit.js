/* مكتبي — «مساعد المحامي الرقمي»: دليل المنصات + مولد الصيغ + الإنذارات + الطلبات الجاهزة
   أُدمجت الأداة المستقلة كصفحة داخل التطبيق بنفس الألوان والوضع، مع:
   - اختيار قضية لتعبئة الأطراف والوقائع تلقائيًا
   - زر «فتح في المحرر» لكل نص مولّد (للتعديل والطباعة والتصدير)
   - إضافة/حذف منصات خاصة بك (تُحفظ على هذا الجهاز) */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ================= بيانات المنصات (كما وردت في الأداة الأصلية) ================= */
  /* v: ok = موثّق من مصادر منشورة (موقع المحكمة نفسه أو أخبار تنقل الرابط الرسمي)، sec = مصدر ثانوي؛ بدون رابط = غير مؤكد فعُطّل
     آخر مراجعة للروابط: 3 نوفمبر 2026 */
  const PLATFORMS = [
    { name: 'وزارة العدل المصرية', desc: 'الموقع الرسمي للوزارة وخدماتها الإلكترونية', category: 'ministry', link: 'https://moj.gov.eg/ar/Pages/Home.aspx', v: 'ok' },
    { name: 'الاستعلام عن رول الجلسات والدعاوى', desc: 'استعلام عن رول جلسة، رول دعوى، موقف دعوى، ووجود استئناف من عدمه (وزارة العدل)', category: 'service', link: 'https://moj.gov.eg/ar/Pages/Services/ServicesCatalog.aspx?UserCategory=4', v: 'ok' },
    { name: 'محكمة النقض المصرية', desc: 'الموقع الرسمي: المبادئ المدنية والجنائية والبحث المتقدم في أحكام النقض', category: 'cassation', link: 'https://cc.gov.eg', v: 'ok' },
    { name: 'النيابة العامة', desc: 'الموقع الرسمي: خدمات إلكترونية للمحامين (حساب، استعلام، طلبات) والعرائض', category: 'ministry', badge: 'النيابة', link: 'https://www.ppo.gov.eg', v: 'ok' },
    { name: 'المحكمة الدستورية العليا', desc: 'الرقابة على دستورية القوانين وتفسير النصوص التشريعية', category: 'court', link: 'http://sccourt.gov.eg/', v: 'sec' },
    { name: 'الجريدة الرسمية والوقائع المصرية', desc: 'القوانين والقرارات (الناشر: الهيئة العامة لشئون المطابع الأميرية)', category: 'gazette', link: '', note: 'لم يُتأكد من الرابط الرسمي (الرابط القديم كان لموقع محكمة النقض)' },
    { name: 'بوابة المحاكم المصرية', desc: 'الاستعلام عن القضايا والجلسات ورفع الدعاوى', category: 'court', link: '', note: 'لم يُتأكد من الرابط؛ الاستعلامات متاحة عبر موقع وزارة العدل أعلاه' },
    { name: 'مجلس الدولة المصري', desc: 'قضاء الإلغاء والتأديب والفتوى', category: 'court', link: '', note: 'لم يُتأكد من الرابط الرسمي' },
    { name: 'مصلحة الشهر العقاري', desc: 'تسجيل العقارات والتوثيق', category: 'service', link: '', note: 'لم يُتأكد من الرابط الرسمي' },
    { name: 'الهيئة العامة للاستعلامات', desc: 'بوابة المعلومات الحكومية', category: 'ministry', link: '', note: 'لم يُتأكد من الرابط الرسمي' },
    { name: 'استخراج صور رسمية من الأحكام', desc: 'طلب صور رسمية من قلم المحكمة', category: 'service', link: '', note: 'لا يوجد رابط مؤكد' },
    { name: 'رفع دعوى إلكترونياً', desc: 'خدمة رفع الدعاوى إلكترونيًا', category: 'service', link: '', note: 'لا يوجد رابط مؤكد' }
  ];
  const BADGE = { court: 'المحاكم', ministry: 'الوزارة', gazette: 'الجريدة', cassation: 'النقض', service: 'خدمة' };
  const FILTERS = [['all', 'الكل'], ['court', 'المحاكم'], ['ministry', 'الوزارات'], ['gazette', 'الجريدة الرسمية'], ['cassation', 'النقض'], ['service', 'خدمات']];

  const DOC_TYPES = { lawsuit: 'صحيفة دعوى', defense: 'مذكرة دفاع', appeal: 'استئناف', cassation_memo: 'مذكرة نقض', objection: 'اعتراض' };
  const CASE_TYPES = { civil: 'مدني', commercial: 'تجاري', family: 'أحوال شخصية', criminal: 'جنائي', administrative: 'إداري', labor: 'عمالي' };
  const APP_TYPE = { 'مدني': 'civil', 'تجاري': 'commercial', 'أسرة': 'family', 'جنائي': 'criminal', 'إداري': 'administrative', 'عمالي': 'labor' };
  const NOTICE_TYPES = { payment: 'تكليف بالوفاء', hand_to_hand: 'إنذار يد بيد', evacuation: 'إنذار بالإخلاء', termination: 'إنذار بفسخ العقد' };
  const REQ_TYPES = { no_appeal_cert: 'شهادة عدم حصول استئناف', document_permit: 'تصريح بمستند', official_copy: 'صورة رسمية من حكم', case_status: 'استعلام عن حالة قضية', execution_request: 'طلب تنفيذ', adjournment: 'طلب تأجيل جلسة' };

  const CSS = '#page-toolkit .tk-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}' +
    '#page-toolkit .tk-tab{flex:1;min-width:120px;padding:10px 12px;border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit}' +
    '#page-toolkit .tk-tab.on{background:var(--primary);color:#fff;border-color:var(--primary)}' +
    '#page-toolkit .tk-pane{display:none}#page-toolkit .tk-pane.on{display:block}' +
    '#page-toolkit .tk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}' +
    '#page-toolkit .tk-card{border:1px solid var(--border);background:var(--card);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px}' +
    '#page-toolkit .tk-card h3{font-size:15px;margin:0}#page-toolkit .tk-card p{font-size:13px;color:var(--text-muted);margin:0}' +
    '#page-toolkit .tk-badge{font-size:11px;border-radius:10px;padding:2px 9px;background:var(--accent);color:#2D1E12;font-weight:700;white-space:nowrap}' +
    '#page-toolkit .tk-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}' +
    '#page-toolkit .tk-chip{border:1px solid var(--border);background:var(--card);color:var(--text);border-radius:16px;padding:4px 14px;font-size:13px;cursor:pointer;font-family:inherit}' +
    '#page-toolkit .tk-chip.on{background:var(--primary);color:#fff;border-color:var(--primary)}' +
    '#page-toolkit .tk-res{margin-top:14px;padding:14px;border:1.5px dashed var(--border);border-radius:10px;white-space:pre-wrap;line-height:2;font-size:14px;min-height:60px}' +
    '#page-toolkit .tk-res:empty::before{content:"سيظهر النص المولّد هنا…";color:var(--text-muted);font-style:italic}' +
    '#page-toolkit .tk-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}#page-toolkit .tk-muted{font-size:12px;color:var(--text-muted)}' +
    '#page-toolkit .tk-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:600px){#page-toolkit .tk-row{grid-template-columns:1fr}}';

  const optList = o => Object.keys(o).map(k => `<option value="${k}">${esc(o[k])}</option>`).join('');
  const field = (id, label, ph, req, area) => `<div class="form-group"><label for="${id}">${label}${req ? ' <span style="color:var(--danger)">*</span>' : ''}</label>` +
    (area ? `<textarea id="${id}" rows="4" placeholder="${esc(ph)}"></textarea>` : `<input type="text" id="${id}" placeholder="${esc(ph)}">`) + '</div>';
  const out = (id, title) => `<div class="tk-res" id="${id}"></div><div class="tk-act" id="${id}Act" style="display:none">` +
    `<button class="btn btn-success btn-sm" data-act="copy" data-t="${id}">📋 نسخ النص</button><button class="btn btn-primary btn-sm" data-act="editor" data-t="${id}" data-title="${esc(title)}">📝 فتح في المحرر</button></div>`;

  function skeleton() {
    return '<div class="tk-tabs">' + [['platforms', '🏛️ المنصات الحكومية'], ['generator', '✍️ مولد الصيغ'], ['notices', '📢 الإنذارات'], ['requests', '📄 الطلبات الجاهزة']]
      .map((t, i) => `<button class="tk-tab${i ? '' : ' on'}" data-act="tab" data-v="${t[0]}">${t[1]}</button>`).join('') + '</div>' +

      /* المنصات */
      '<div class="tk-pane on card" data-pane="platforms"><div class="card-header"><h2>دليل المنصات الحكومية والقضائية</h2></div><div class="card-body">' +
      '<input type="text" id="tkSearch" placeholder="ابحث عن منصة أو خدمة…" style="width:100%">' +
      '<div class="tk-chips" id="tkChips">' + FILTERS.map((f, i) => `<button class="tk-chip${i ? '' : ' on'}" data-act="filter" data-v="${f[0]}">${f[1]}</button>`).join('') + '</div>' +
      '<div class="tk-grid" id="tkGrid"></div>' +
      '<details style="margin-top:14px"><summary style="cursor:pointer;font-weight:700">＋ إضافة منصة خاصة بك</summary><div style="margin-top:10px">' +
      '<div class="tk-row">' + field('tkPName', 'اسم المنصة', 'مثال: بوابة النيابة الإدارية', true) + field('tkPLink', 'الرابط', 'https://…', false) + '</div>' +
      '<div class="tk-row">' + field('tkPDesc', 'الوصف', 'وصف قصير', false) +
      `<div class="form-group"><label for="tkPCat">التصنيف</label><select id="tkPCat">${Object.keys(BADGE).map(k => `<option value="${k}">${BADGE[k]}</option>`).join('')}</select></div></div>` +
      '<button class="btn btn-primary btn-sm" data-act="addp">حفظ المنصة</button><span class="tk-muted"> تُحفظ على هذا الجهاز فقط.</span></div></details>' +
      '<p class="tk-muted" style="margin-top:12px">الروابط المعروضة مدخلة يدويًا: تحقق منها قبل الاعتماد، وصحّح أي رابط بحذف المنصة الخاصة وإضافتها بالرابط الصحيح.</p></div></div>' +

      /* مولد الصيغ */
      '<div class="tk-pane card" data-pane="generator"><div class="card-header"><h2>مولد الصيغ والمذكرات والدعاوى</h2></div><div class="card-body">' +
      '<div class="form-group"><label for="tkCase">تعبئة من قضية (اختياري)</label><select id="tkCase"><option value="">— بدون —</option></select></div>' +
      '<div class="tk-row"><div class="form-group"><label for="tkDocType">نوع المستند <span style="color:var(--danger)">*</span></label><select id="tkDocType"><option value="">اختر…</option>' + optList(DOC_TYPES) + '</select></div>' +
      '<div class="form-group"><label for="tkCaseType">نوع القضية <span style="color:var(--danger)">*</span></label><select id="tkCaseType"><option value="">اختر…</option>' + optList(CASE_TYPES) + '</select></div></div>' +
      '<div id="tkDefHint" class="tk-muted" style="display:none;margin-bottom:10px">💡 للدفوع المخصصة لمجريات قضيتك استخدم أداة <a href="#" data-act="defenses">🛡️ دفوع قضيتي</a>.</div>' +
      field('tkPlaintiff', 'المدعي / الطاعن', 'اسم المدعي أو الطاعن…') + field('tkDefendant', 'المدعى عليه / المطعون ضده', 'اسم المدعى عليه أو المطعون ضده…') +
      field('tkFacts', 'الوقائع', 'اكتب وقائع القضية بالتفصيل…', true, true) + field('tkReqs', 'المطلوب (الطلبات)', 'اكتب الطلبات المطلوبة…', false, true) +
      '<button class="btn btn-primary" data-act="gen_doc">✨ توليد الصياغة القانونية</button>' + out('tkDocRes', 'صياغة قانونية') + '</div></div>' +

      /* الإنذارات */
      '<div class="tk-pane card" data-pane="notices"><div class="card-header"><h2>مولّد الإنذارات والإعلانات القانونية</h2></div><div class="card-body">' +
      `<div class="form-group"><label for="tkNType">نوع الإنذار <span style="color:var(--danger)">*</span></label><select id="tkNType"><option value="">اختر…</option>${optList(NOTICE_TYPES)}</select></div>` +
      '<div class="tk-row">' + field('tkNotifier', 'المُنذِر (الطرف الأول)', 'اسم المُنذِر…', true) + field('tkNotified', 'المُنذَر إليه (الطرف الثاني)', 'اسم المُنذَر إليه…', true) + '</div>' +
      field('tkNAmount', 'المبلغ / قيمة الالتزام (إن وجد)', 'مثال: 50,000 جنيه') + field('tkNDeadline', 'المهلة الزمنية الممنوحة', 'مثال: 15 يومًا من تاريخ الإعلان', true) +
      field('tkNReason', 'الأسباب والتفاصيل', 'اكتب أسباب الإنذار والتفاصيل…', true, true) +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:6px 0"><input type="checkbox" id="tkNRent" style="width:auto"> العلاقة إيجارية (تكليف بالوفاء بالأجرة)</label>' +
      '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:6px 0"><input type="checkbox" id="tkNExpress" style="width:auto"> العقد يتضمن شرطًا فاسخًا صريحًا (لإنذار الفسخ)</label>' +
      '<button class="btn btn-gold" data-act="gen_notice">⚖️ توليد صيغة الإنذار</button>' + out('tkNRes', 'إنذار') + '</div></div>' +

      /* الطلبات */
      '<div class="tk-pane card" data-pane="requests"><div class="card-header"><h2>الطلبات الجاهزة</h2></div><div class="card-body">' +
      `<div class="form-group"><label for="tkRType">نوع الطلب <span style="color:var(--danger)">*</span></label><select id="tkRType"><option value="">اختر…</option>${optList(REQ_TYPES)}</select></div>` +
      '<div class="tk-row">' + field('tkRApplicant', 'مقدم الطلب', 'اسم مقدم الطلب…', true) + field('tkRCaseNo', 'رقم القضية / المحضر', 'مثال: 1234 لسنة 2024') + '</div>' +
      field('tkRCourt', 'المحكمة / الجهة المختصة', 'مثال: محكمة جنوب القاهرة الابتدائية', true) + field('tkRDetails', 'تفاصيل إضافية', 'أي تفاصيل إضافية…', false, true) +
      '<button class="btn btn-primary" data-act="gen_req">📤 توليد الطلب</button>' + out('tkRRes', 'طلب') + '</div></div>';
  }

  /* ================= المنصات ================= */
  const state = { filter: 'all', search: '', caseId: '' };
  const safeUrl = u => /^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '';
  function customPlatforms() { try { return DB.get('platforms') || []; } catch (e) { return []; } }
  function renderPlatforms() {
    const g = $('tkGrid'); if (!g) return;
    const all = PLATFORMS.map(p => Object.assign({ custom: false }, p)).concat(customPlatforms().map(p => Object.assign({ custom: true }, p)));
    const q = state.search;
    const list = all.filter(p => (state.filter === 'all' || p.category === state.filter) && (!q || (p.name || '').indexOf(q) >= 0 || (p.desc || '').indexOf(q) >= 0));
    if (!list.length) { g.innerHTML = '<p class="tk-muted" style="grid-column:1/-1;text-align:center;padding:30px">لا توجد نتائج مطابقة لبحثك.</p>'; return; }
    g.innerHTML = list.map(p => {
      const url = safeUrl(p.link);
      return `<div class="tk-card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h3>${esc(p.name)}</h3><span class="tk-badge">${esc(p.badge || BADGE[p.category] || '')}</span></div><p>${esc(p.desc)}</p>` +
        (url ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:var(--accent-deep);font-weight:700;font-size:13px;text-decoration:none">زيارة المنصة ←</a>` + (p.v === 'ok' ? ' <span class="tk-muted">✓ موثّق</span>' : p.v === 'sec' ? ' <span class="tk-muted">⚠️ من مصادر ثانوية</span>' : '') : `<span class="tk-muted">⚠️ ${esc(p.note || 'الرابط غير محدد')} — أضفه من «إضافة منصة» إن وجدته</span>`) +
        (p.custom ? `<button class="btn btn-outline btn-sm" data-act="delp" data-id="${esc(p.id)}">حذف</button>` : '') + '</div>';
    }).join('');
  }

  /* ================= المولدات ================= */
  const today = () => new Date().toLocaleDateString('ar-EG');
  const val = id => ($(id) ? $(id).value.trim() : '');
  const warn = () => toast('يرجى استكمال الحقول الإلزامية (*)');
  function show(id, text) { $(id).textContent = text; $(id + 'Act').style.display = 'flex'; }

  function genDoc() {
    const dt = val('tkDocType'), ct = val('tkCaseType'), pl = val('tkPlaintiff'), df = val('tkDefendant'), facts = val('tkFacts'), reqs = val('tkReqs');
    if (!dt || !ct || !facts) return warn();
    let t = 'بسم الله الرحمن الرحيم\n\n' + DOC_TYPES[dt] + ' — قضية ' + CASE_TYPES[ct] + '\nالتاريخ: ' + today() + '\n\n';
    t += 'المدعي/الطاعن: ' + (pl || '................') + '\nالمدعى عليه/المطعون ضده: ' + (df || '................') + '\n\n';
    t += 'الوقائع:\n' + facts + '\n\nالطلبات:\n' + (reqs || 'إلزام المدعى عليه بالطلبات المذكورة أعلاه مع تحميله المصاريف وأتعاب المحاماة.') + '\n\n';
    t += 'لذلك نلتمس من عدالتكم القضاء بما سبق.\n\nمقدمه المحامي:\n........................\n';
    show('tkDocRes', t);
  }
  /* ---------- الإنذارات: صياغة + سند قانوني موثّق من المكتبة ---------- */
  const NOTICE_BASES = {
    payment: [{ sc: 'مدني', art: 218, must: 'اعذار', label: 'الإعذار شرط لاستحقاق التعويض' }, { sc: 'مدني', art: 219, must: 'اعذار', label: 'طرق الإعذار' }],
    hand_to_hand: [{ sc: 'مدني', art: 219, must: 'اعذار', label: 'الإعذار بالإنذار' }],
    evacuation: [{ sc: 'مدني', art: 563, must: 'بالاخلاء', label: 'التنبيه بالإخلاء' }, { sc: 'مدني', art: 600, must: 'بالاخلاء', label: 'أثر استمرار الانتفاع بعد التنبيه' }],
    termination: [{ sc: 'مدني', art: 157, must: 'فسخ', label: 'الفسخ بعد الإعذار' }, { sc: 'مدني', art: 158, must: 'مفسوخا', label: 'الاتفاق على الفسخ التلقائي' }, { sc: 'مدني', art: 219, must: 'اعذار', label: 'طرق الإعذار' }]
  };
  const RENT_BASIS = { sc: 'ايجار136', art: 18, must: 'خمسه عشر يوما', from: '(ب)', to: 'ولا يحكم', len: 420, label: 'التكليف بالوفاء بالأجرة (مدة الـ15 يومًا)' };
  const NOTICE_NOTES = {
    payment: ['تأكد من ثبوت الدين وحلول أجله ومن بيان المبلغ والمهلة بوضوح.', 'يجوز إعلان الإنذار على يد محضر أو بكتاب موصى عليه بعلم الوصول (راجع المادة 219 أعلاه).'],
    hand_to_hand: ['يُسلَّم الأصل باليد مع أخذ توقيع المستلم على صورة الإنذار بالاستلام مع التاريخ والوقت.', 'احتفظ بصورة موقّعة؛ وفي حال الرفض أثبت الرفض بشاهد أو بإعلان رسمي.'],
    evacuation: ['حدّد القانون الحاكم للعلاقة: القانون المدني أم قوانين الإيجار الاستثنائية، فمواعيد التنبيه وأسباب الإخلاء تختلف.', 'راجع مواعيد التنبيه بالإخلاء في المادة 563 المقتبسة أعلاه وتأكد من استيفائها قبل الإرسال.'],
    termination: ['حتى مع وجود شرط فاسخ صريح يلزم الإعذار ما لم يُعفَ منه صراحةً (المادة 158 أعلاه).', 'حدّد البند المخالف تحديدًا وأرفق ما يثبت الإخلال.']
  };
  function noticeActions(ty, o) {
    const dl = o.dl, amt = o.amt;
    if (ty === 'payment' || ty === 'hand_to_hand') {
      const what = o.rent ? 'سداد الأجرة المستحقة' + (amt ? ' وقدرها ' + amt : '') : 'سداد ' + (amt || 'المبلغ المستحق');
      const cons = o.rent ? 'وإلا اعتُبر ذلك تقصيرًا في الوفاء بالأجرة يخوّلنا المطالبة بالإخلاء والطرد وفقًا لأحكام القانون، مع الرجوع عليكم بالأجرة والمصاريف والأتعاب.'
        : 'وإلا اضطررنا إلى اتخاذ الإجراءات القانونية للمطالبة بالمبلغ والتعويض الجابر لما لحق بنا من ضرر وكافة المصاريف وأتعاب المحاماة.';
      return 'ننذركم بضرورة ' + what + ' خلال ' + dl + ' من تاريخ تسلّمكم هذا الإنذار، ' + cons;
    }
    if (ty === 'evacuation') return 'ننبّه عليكم بإخلاء العين المؤجرة وتسليمها خالية من الشواغل خلال ' + dl + ' من تاريخ تسلّمكم هذا الإنذار، وإلا لجأنا إلى القضاء لطلب الإخلاء والتسليم والتعويض عن مدة التأخير مع المصاريف والأتعاب.';
    return 'ننذركم بتنفيذ التزاماتكم الناشئة عن العقد خلال ' + dl + ' من تاريخ تسلّمكم هذا الإنذار، ' +
      (o.express ? 'وإلا اعتُبر العقد مفسوخًا من تلقاء نفسه دون حاجة إلى حكم قضائي إعمالًا للشرط الفاسخ الصريح الوارد به، مع حفظ حقنا في التعويض.' : 'وإلا لجأنا إلى القضاء لطلب فسخ العقد مع التعويض وكافة المصاريف والأتعاب.');
  }
  function buildNotice(ty, o, bases) {
    const L = NOTICE_TYPES[ty], ok = (bases || []).filter(b => b.ok);
    let t = 'بسم الله الرحمن الرحيم\n\n' + L + '\nالتاريخ: ' + today() + '\n\nالمُنذِر: ' + o.a + '\nالمُنذَر إليه: ' + o.b + '\n\nالموضوع: ' + L + '\n\n';
    t += 'الوقائع والأسباب:\n' + o.rs + '\n\n';
    if (o.amt) t += 'المبلغ/الالتزام: ' + o.amt + '\n\n';
    if (ok.length) t += 'السند القانوني:\n' + ok.map(b => '- المادة (' + b.art + ') من ' + b.law + ': «' + (b.text.length > 450 ? b.text.slice(0, 450) + ' …' : b.text) + '»').join('\n') + '\n\n';
    t += 'المطلوب والمهلة:\n' + noticeActions(ty, o) + '\n\n';
    t += (ty === 'hand_to_hand' ? 'سُلِّم أصل هذا الإنذار يدًا بيد.' : 'يُعلن هذا الإنذار على يد محضر أو بكتاب موصى عليه بعلم الوصول.') + '\n\n';
    t += 'وإلا كان هذا الإنذار حجةً عليكم بما ورد فيه.\n\nالمُنذِر / وكيله المحامي:\n........................\n';
    if (ty === 'hand_to_hand') t += '\nإقرار بالاستلام:\nأقر أنا / ........................ باستلام أصل هذا الإنذار بتاريخ ..../..../........ الساعة ........\nالتوقيع: ........................\n';
    t += '\n— ملاحظات للمراجعة (احذفها قبل الإرسال) —\n' + (NOTICE_NOTES[ty] || []).map(n => '• ' + n).join('\n');
    const miss = (bases || []).filter(b => !b.ok);
    if (miss.length || !ok.length) t += '\n• تعذّر إدراج السند من المكتبة' + (miss.length ? ' لـ: ' + miss.map(b => b.label).join('، ') : ' (وحدة الدفوع غير محمّلة)') + ' — راجع النص يدويًا.';
    if (o.rent && !/15|١٥|خمسة عشر|خمسه عشر/.test(o.dl)) t += '\n• المهلة المدخلة قد تقل عن خمسة عشر يومًا المنصوص عليها في سند التكليف بالوفاء أعلاه — راجعها.';
    return t;
  }
  async function genNotice() {
    const ty = val('tkNType'), a = val('tkNotifier'), b = val('tkNotified'), amt = val('tkNAmount'), dl = val('tkNDeadline'), rs = val('tkNReason');
    if (!ty || !a || !b || !dl || !rs) return warn();
    const o = { a: a, b: b, amt: amt, dl: dl, rs: rs, rent: !!($('tkNRent') && $('tkNRent').checked) && (ty === 'payment' || ty === 'hand_to_hand'), express: !!($('tkNExpress') && $('tkNExpress').checked) && ty === 'termination' };
    let defs = (NOTICE_BASES[ty] || []).slice(); if (o.rent) defs.unshift(RENT_BASIS);
    const rb = window.MK_DEF && MK_DEF._t && MK_DEF._t.resolveBasis;
    let bases = [];
    if (rb) { try { bases = await Promise.all(defs.map(rb)); } catch (e) { bases = []; } }
    show('tkNRes', buildNotice(ty, o, bases));
  }
  function genReq() {
    const ty = val('tkRType'), ap = val('tkRApplicant'), no = val('tkRCaseNo'), ct = val('tkRCourt'), dt = val('tkRDetails');
    if (!ty || !ap || !ct) return warn();
    const L = REQ_TYPES[ty];
    let t = 'بسم الله الرحمن الرحيم\n\nإلى السيد/ رئيس ' + ct + '\nالتاريخ: ' + today() + '\n\nمقدم الطلب: ' + ap + '\n';
    if (no) t += 'رقم القضية/المحضر: ' + no + '\n';
    t += '\nالموضوع: ' + L + '\n\nالطلب:\nأتقدم لسيادتكم بطلب ' + L + (no ? ' بخصوص القضية/المحضر رقم ' + no : '') + '.\n';
    if (dt) t += '\nتفاصيل إضافية:\n' + dt + '\n';
    t += '\nوتفضلوا بقبول وافر الاحترام والتقدير.\n\nمقدم الطلب:\n' + ap + '\nالتوقيع: ........................\n';
    show('tkRRes', t);
  }

  /* ================= ربط القضايا والمحرر ================= */
  function fillCases() {
    const s = $('tkCase'); if (!s) return;
    let cases = []; try { cases = DB.get('cases'); } catch (e) { }
    s.innerHTML = '<option value="">— بدون —</option>' + cases.map(c => `<option value="${esc(c.id)}"${c.id === state.caseId ? ' selected' : ''}>${esc((c.number ? c.number + ' — ' : '') + (c.subject || '').slice(0, 50))}</option>`).join('');
  }
  function prefillFromCase(id) {
    state.caseId = id; if (!id) return;
    const c = DB.get('cases').find(x => x.id === id); if (!c) return;
    const set = (k, v) => { const e = $(k); if (e && v) e.value = v; };
    const ps = c.parties || [], side = r => { try { return partySide(r); } catch (e) { return ''; } };
    const names = fn => ps.filter(p => fn(side(p.role))).map(p => p.name).join('، ');
    set('tkPlaintiff', names(s => s === 'P') || (ps[0] || {}).name);
    let def = names(s => s === 'D'); if (!def) { try { def = opponentsText(c); } catch (e) { def = c.opponent || ''; } }
    set('tkDefendant', def);
    set('tkFacts', [c.subject, c.notes].filter(Boolean).join('\n'));
    if (APP_TYPE[c.type]) { $('tkCaseType').value = APP_TYPE[c.type]; }
  }
  function toEditor(resId, title) {
    const text = ($(resId).textContent || '').trim(); if (!text) return toast('لا يوجد نص');
    if (!window.DQ_EDITOR || !DQ_EDITOR.ui) return toast('المحرر غير متاح');
    const lines = text.split(/\n/), html = lines.map((l, i) => l.trim() ? (i === 0 ? `<p style="text-align:center">${esc(l)}</p>` : `<p>${esc(l)}</p>`) : '').join('');
    let clientId = ''; if (state.caseId && resId === 'tkDocRes') { try { clientId = (DB.get('cases').find(c => c.id === state.caseId) || {}).clientId || ''; } catch (e) { } }
    DQ_EDITOR.ui.open({ kind: 'form', title: title, html: html, tpl: title, caseId: resId === 'tkDocRes' ? state.caseId : '', clientId: clientId });
  }
  function copyText(resId) {
    const text = ($(resId).textContent || '').trim(); if (!text) return toast('لا يوجد نص لنسخه');
    const done = () => toast('تم النسخ بنجاح');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fb(text, done)); else fb(text, done);
  }
  function fb(text, done) { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('تعذّر النسخ'); } document.body.removeChild(ta); }

  /* ================= الصفحة ================= */
  function ensurePage() {
    let p = $('page-toolkit'); if (p) return p;
    const ref = $('page-lawsuits') || $('page-cases'); if (!ref) return null;
    if (!$('tkStyle')) { const s = document.createElement('style'); s.id = 'tkStyle'; s.textContent = CSS; document.head.appendChild(s); }
    p = document.createElement('div'); p.className = 'page'; p.id = 'page-toolkit'; p.innerHTML = skeleton(); ref.parentNode.appendChild(p);
    p.addEventListener('click', onClick);
    p.addEventListener('input', e => { if (e.target.id === 'tkSearch') { state.search = e.target.value.trim(); renderPlatforms(); } });
    p.addEventListener('change', e => {
      if (e.target.id === 'tkCase') prefillFromCase(e.target.value);
      if (e.target.id === 'tkDocType') $('tkDefHint').style.display = e.target.value === 'defense' ? 'block' : 'none';
    });
    renderPlatforms(); return p;
  }
  function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
    if (a === 'tab') {
      document.querySelectorAll('#page-toolkit .tk-tab').forEach(x => x.classList.toggle('on', x === b));
      document.querySelectorAll('#page-toolkit .tk-pane').forEach(x => x.classList.toggle('on', x.dataset.pane === b.dataset.v));
    } else if (a === 'filter') {
      state.filter = b.dataset.v; document.querySelectorAll('#tkChips .tk-chip').forEach(x => x.classList.toggle('on', x === b)); renderPlatforms();
    } else if (a === 'gen_doc') genDoc(); else if (a === 'gen_notice') genNotice(); else if (a === 'gen_req') genReq();
    else if (a === 'copy') copyText(b.dataset.t); else if (a === 'editor') toEditor(b.dataset.t, b.dataset.title);
    else if (a === 'addp') {
      const name = val('tkPName'); if (!name) return toast('اكتب اسم المنصة');
      const raw = val('tkPLink'), url = raw ? safeUrl(raw) : ''; if (raw && !url) return toast('الرابط يجب أن يبدأ بـ http:// أو https://');
      const arr = customPlatforms(); arr.push({ id: 'p' + Date.now().toString(36), name: name, link: url, desc: val('tkPDesc'), category: val('tkPCat') || 'service' });
      DB.set('platforms', arr); ['tkPName', 'tkPLink', 'tkPDesc'].forEach(k => { $(k).value = ''; }); renderPlatforms(); toast('تمت إضافة المنصة');
    } else if (a === 'delp') {
      if (confirm('حذف هذه المنصة؟')) { DB.set('platforms', customPlatforms().filter(p => p.id !== b.dataset.id)); renderPlatforms(); }
    } else if (a === 'defenses') { e.preventDefault(); if (window.MK_DEF) MK_DEF.open(state.caseId); else toast('أداة الدفوع غير مثبتة'); }
  }
  function ensureNav() {
    if (document.querySelector('.nav-item[data-page="toolkit"]')) return;
    const ref = document.querySelector('.nav-item[data-page="defenses"]') || document.querySelector('.nav-item[data-page="lawsuits"]'); if (!ref) return;
    const b = document.createElement('button'); b.className = 'nav-item'; b.dataset.page = 'toolkit';
    b.innerHTML = '<span class="icon">🧰</span> مساعد المحامي';
    b.addEventListener('click', () => window.showPage('toolkit'));
    ref.parentNode.insertBefore(b, ref.nextSibling);
  }
  function boot() {
    ensureNav(); ensurePage();
    const sp = window.showPage;
    if (typeof sp === 'function' && !sp.__mkt) {
      const w = function (id) {
        const r = sp.apply(this, arguments);
        if (id === 'toolkit') { ensurePage(); fillCases(); const t = $('pageTitle'); if (t) t.textContent = '🧰 مساعد المحامي'; }
        return r;
      }; w.__mkt = true; w.__mkd = sp.__mkd; window.showPage = w;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.MK_TOOLKIT = { open: function () { window.showPage('toolkit'); }, _t: { buildNotice: buildNotice, NOTICE_BASES: NOTICE_BASES, RENT_BASIS: RENT_BASIS } };
})();
