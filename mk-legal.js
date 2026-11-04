/* مكتبي — شاشة الدخول: تعريف بالتطبيق + تحميل التطبيق + الشروط والأحكام وسياسة الخصوصية
   + إقرار الموافقة عند إنشاء مكتب (يُسجَّل في الخادم كسند إلكتروني: migration-07-legal).
   • روابط التحميل: عدّلها في mk-config.js (downloads.android / ios / windows) متى جهزت.
   • عند أي تعديل جوهري في نصوص الشروط أو الخصوصية غيّر VERSION أدناه.
   • النصوص مسودة عامة أعدّها المساعد وتحتاج مراجعتك القانونية قبل الاعتماد.
   يُحمَّل قبل mk-cloud.js */
(function () {
  'use strict';
  const VERSION = '2026-11-04';                       // غيّره عند تعديل أي نص أدناه
  const OPERATOR = 'الأستاذ علي حسن علي — المحامي';
  const PHONE = '01098848735';

  /* ===================== النصوص ===================== */
  const ABOUT = {
    title: 'عن مكتبي الإلكتروني',
    sections: [
      { h: 'ما هو التطبيق؟', p: ['«مكتبي الإلكتروني» نظام لإدارة مكتب المحاماة، يعمل على الإنترنت وبدونه، ويمكن تثبيته على الهاتف والحاسوب كتطبيق.'] },
      { h: 'ماذا يقدّم؟', ul: [
        'إدارة العملاء والقضايا والجلسات والمواعيد والمهام والتوكيلات والمحضرين.',
        'المستندات والمرفقات، ومحرر مستندات بالنماذج وصحف الدعاوى، والفواتير والحسابات.',
        'مكتبة قانونية بنصوص التشريعات المصرية مع بحث، وحاسبات ومدد قانونية، وفحص تعارض المصالح.',
        'تنبيهات وتذكيرات بالجلسات والمواعيد والمهام.',
        'مكاتب منفصلة تمامًا: كل مكتب يرى بياناته وحساباته فقط، ويحدد مديره صلاحيات المحامين والموكلين.'] },
      { h: 'مهم', p: ['التطبيق أداة مساعدة للمحامي ولا يقدّم استشارات قانونية، والتحقق من النصوص والمدد والإجراءات مسؤولية المستخدم.'] }
    ]
  };

  const TERMS = {
    title: 'الشروط والأحكام',
    sections: [
      { h: '1. القبول', p: [
        'باستعمالك «مكتبي الإلكتروني» أو إنشائك مكتبًا عليه، فإنك تقرّ بأنك قرأت هذه الشروط وسياسة الخصوصية وتوافق عليها. ويقرّ من ينشئ المكتب بأن له الصفة والصلاحية للتعاقد باسم المكتب وإلزامه بهذه الشروط، وأنه سيعرّفها لمن يضيفهم من محامين وموكلين.',
        'إن لم توافق على أي بند فلا تُنشئ مكتبًا ولا تستعمل التطبيق.'] },
      { h: '2. طبيعة الخدمة وحدودها', p: [
        'التطبيق برنامج لإدارة أعمال المكتب. وما يتضمنه من مكتبة قانونية وحاسبات ومدد ومواعيد طعن وصيغ ونماذج ومساعد آلي وتذكيرات هو مساعدة للمحامي وليس بديلًا عن اجتهاده المهني.',
        'قد لا تكون النصوص والمدد محدّثة أو خالية من الخطأ. على المستخدم مراجعتها بالمصادر الرسمية (مثل الجريدة الرسمية) قبل الاعتماد عليها في أي إجراء أو مذكرة أو ميعاد. ولا يُعدّ التطبيق ولا مخرجاته استشارة قانونية.'] },
      { h: '3. الحسابات وكلمات المرور', ul: [
        'مدير المكتب مسؤول عن الحسابات التي ينشئها وصلاحياتها وعن سرية كلمات المرور، وكل إجراء يتم من حساب يُنسب إلى صاحبه.',
        'يلتزم المستخدم بصحة البيانات التي يقدمها وبإبلاغنا فور اشتباهه في اختراق حسابه.',
        'لا يجوز مشاركة الحساب ولا استعماله خارج المكتب المسجَّل له.'] },
      { h: '4. الاشتراك والدفع', p: [
        'يبدأ كل مكتب جديد بتجربة مجانية مدتها 14 يومًا. بعد انتهائها ومدة التنبيه يتحول المكتب إلى «عرض فقط» لمدة يومين ثم يُوقف حتى تجديد الاشتراك. يتم التجديد من إدارة التطبيق بعد الدفع.',
        'تُحدَّد قيمة الاشتراك وطرق الدفع وسياسة الاسترداد من إدارة التطبيق عند التجديد، ولها تعديلها مستقبلًا دون أثر رجعي على مدة مدفوعة.'] },
      { h: '5. بيانات المكتب والموكلين', ul: [
        'تبقى بيانات المكتب وموكليه ملكًا للمكتب. ويمنح المكتب التطبيق ترخيصًا محدودًا لاستضافتها ومعالجتها لغرض تشغيل الخدمة فقط.',
        'المكتب وحده مسؤول عن مشروعية جمعه لبيانات موكليه وخصومه ومعالجتها، وعن حصوله على الموافقات أو الأسس القانونية اللازمة، وعن التزامه بسرية المهنة وبقانون حماية البيانات الشخصية رقم 151 لسنة 2020.',
        'تفاصيل المعالجة في «سياسة الخصوصية».'] },
      { h: '6. الاستخدام المحظور', ul: [
        'محاولة الوصول إلى بيانات مكتب آخر أو تجاوز الصلاحيات أو إعدادات الأمان.',
        'استعمال التطبيق في نشاط غير مشروع، أو رفع محتوى ضار أو مخالف للقانون.',
        'نسخ التطبيق أو هندسته العكسية أو إعادة بيعه دون إذن كتابي.',
        'تعطيل الخدمة أو إثقالها بصورة غير معتادة.'] },
      { h: '7. الملكية الفكرية', p: [
        'البرنامج وتصميمه ومحتواه محميّان بموجب قانون حماية حقوق الملكية الفكرية رقم 82 لسنة 2002، ولا يجوز نسخه أو تعديله أو توزيعه أو استغلاله كليًا أو جزئيًا دون إذن كتابي مسبق من صاحب الحق. وتبقى نصوص التشريعات المنشورة ملكًا لجهاتها الرسمية.'] },
      { h: '8. الأمان والنسخ الاحتياطي', p: [
        'نتخذ تدابير معقولة لحماية البيانات، منها عزل المكاتب عن بعضها بقواعد في قاعدة البيانات وتشفير الاتصال. ولا يمكن ضمان أمان مطلق على الإنترنت.',
        'ينبغي للمستخدم الاحتفاظ بنسخ احتياطية من بياناته المهمة، وتسجيل الخروج من الأجهزة المشتركة، واختيار كلمة مرور قوية.'] },
      { h: '9. إخلاء المسؤولية وحدودها', p: [
        'تُقدَّم الخدمة «كما هي» دون ضمان خلوها من الأعطال أو الانقطاع أو الأخطاء. ولا نكون مسؤولين عن أضرار ناتجة عن: فوات ميعاد أو مدة أو جلسة، أو الاعتماد على نص أو حاسبة أو تذكير أو مخرج آلي دون تحقق، أو إدخال بيانات خاطئة، أو فقد بيانات سببه جهاز المستخدم أو مشاركة حسابه، أو انقطاع الإنترنت أو خدمات الأطراف الثالثة.',
        'كل ذلك إلى أقصى حد يسمح به القانون، ولا يمتد إلى ما لا يجوز الإعفاء منه قانونًا كالغش والخطأ الجسيم.'] },
      { h: '10. التعليق والإنهاء', p: [
        'يجوز لإدارة التطبيق تعليق المكتب أو إنهاؤه عند مخالفة هذه الشروط أو عدم سداد الاشتراك أو لحماية النظام. وللمكتب التوقف عن الاستعمال في أي وقت، وطلب تصدير بياناته أو حذفها وفق سياسة الخصوصية.'] },
      { h: '11. تعديل الشروط', p: [
        'قد نُصدر نسخة جديدة من الشروط أو السياسة. تسري النسخة الجديدة من تاريخ نشرها، وقد نطلب قبولها من جديد. استمرارك في الاستعمال بعد النشر يُعدّ قبولًا لها.'] },
      { h: '12. القانون الواجب التطبيق', p: [
        'تخضع هذه الشروط للقانون المصري، وتختص المحاكم المصرية المختصة بنظر أي نزاع ينشأ عنها.'] },
      { h: '13. الإثبات الإلكتروني للموافقة', p: [
        'تتم الموافقة بتأشير خانة الإقرار عند إنشاء المكتب. ويُسجَّل لدى الخادم: نص الشروط والسياسة الذي وافقت عليه حرفيًا وبصمته الرقمية (SHA-256) وإصداره، وتاريخ ووقت الموافقة من ساعة الخادم، وعنوان IP ونوع المتصفح، واسم المكتب واسم المدير واسم الدخول.',
        'يُحفظ هذا السجل دون إمكانية تعديله أو حذفه من التطبيق، ويجوز الاحتجاج به كدليل على موافقتك. ويمكنك طلب نسخة من سجل موافقتك من إدارة التطبيق.'] },
      { h: '14. التواصل', p: ['إدارة التطبيق: ' + OPERATOR + ' — هاتف: ' + PHONE + '.'] }
    ]
  };

  const PRIVACY = {
    title: 'سياسة الخصوصية',
    sections: [
      { h: '1. من نحن', p: [
        'مشغّل التطبيق: ' + OPERATOR + '. بالنسبة لبيانات الموكلين والقضايا التي يدخلها المكتب، يكون المكتب هو المسؤول عن تحديد أغراضها ووسائل معالجتها، ونعالجها نيابة عنه لتشغيل الخدمة. أما بيانات الحسابات والاشتراك والموافقات فنحدد أغراض معالجتها بأنفسنا.'] },
      { h: '2. البيانات التي نعالجها', ul: [
        'بيانات الحساب: الاسم واسم الدخول والدور والصلاحيات، والصورة الشخصية ولوجو المكتب إن أضفتهما، وكلمة المرور (تُحفظ مشفّرة لدى مزود المصادقة ولا نطّلع عليها).',
        'بيانات المكتب والاشتراك: اسم المكتب وحالة التجربة والاشتراك وسجل الدفعات.',
        'بيانات العمل التي يدخلها المكتب: عملاء وقضايا وجلسات ومواعيد ومهام وتوكيلات ومحضرون وفواتير وملاحظات ومستندات، وقد تتضمن بيانات شخصية وحساسة تخص الموكلين والخصوم.',
        'بيانات الموافقة: نص الموافقة وبصمته والوقت وعنوان IP ونوع المتصفح عند إنشاء المكتب.',
        'بيانات تقنية محلية على جهازك: إعدادات وتفضيلات ونسخ مؤقتة لتعمل بدون إنترنت.'] },
      { h: '3. أين تُخزَّن؟', ul: [
        'على جهازك (في المتصفح) لتعمل بدون إنترنت.',
        'على خوادم مزود الاستضافة وقواعد البيانات «Supabase» لمزامنة بيانات المكتب بين أجهزته. ويعني ذلك انتقال البيانات إلى خوادم قد تقع خارج مصر.',
        'المرفقات (الملفات) تُحفظ حاليًا على الجهاز الذي أُضيفت منه ولا تُرفع إلى الخادم، وبياناتها الوصفية فقط هي التي تتزامن. وقد يتغير ذلك مستقبلًا ونعلنه.'] },
      { h: '4. لماذا نعالجها؟', ul: [
        'تشغيل التطبيق وتوفير الحسابات والصلاحيات والمزامنة.',
        'إدارة الاشتراك والدعم الفني والتنبيهات الإدارية.',
        'حفظ سند موافقتك على الشروط.',
        'حماية النظام ومنع إساءة الاستعمال.',
        'لا نبيع البيانات ولا نستعملها في الإعلانات ولا نتتبّعك.'] },
      { h: '5. من يطّلع عليها؟', ul: [
        'مكتبك فقط: يرى كل مكتب بياناته، ويحدد المدير ما يراه المحامون والموكلون.',
        'مالك النظام: يدير المكاتب والاشتراكات والتنبيهات، ولا تعرض واجهته بيانات القضايا والعملاء حسب تصميم الصلاحيات الحالي. ومع ذلك فالبيانات مخزنة لدى مزود الاستضافة، وقد يلزم وصول فني لأغراض الصيانة أو الأمن أو تنفيذًا لأمر قانوني مختص.',
        'مزودو الخدمة التقنية: «Supabase» للاستضافة والمصادقة، وخدمة الخطوط من «Google Fonts»، وشبكة «jsDelivr» لتحميل مكتبة المساعد الآلي عند تفعيله.',
        'المساعد الآلي (إن فعّلته) يعمل داخل متصفحك، ولا تُرسل نصوصك إلى خادم خارجي؛ ويُحمَّل نموذجه مرة واحدة من شبكة توزيع خارجية.',
        'الجهات الرسمية عند وجود أمر قانوني ملزم.'] },
      { h: '6. الإشعارات', p: ['تعمل التنبيهات والتذكيرات محليًا على جهازك، ولا تُرسل إلى خوادم خارجية. ويمكنك إيقافها من الإعدادات.'] },
      { h: '7. التخزين المحلي وملفات الارتباط', p: ['نستعمل التخزين المحلي في المتصفح لتشغيل التطبيق وحفظ بياناتك وتفضيلاتك ولعمل الجلسة، ولا نستعمل ملفات تتبع إعلانية.'] },
      { h: '8. المدة والحذف', p: [
        'نحتفظ ببيانات المكتب طوال مدة اشتراكه، وبعدها لمدة معقولة لإتاحة التجديد أو التصدير. ويمكن للمكتب طلب تصدير بياناته أو حذفها من إدارة التطبيق.',
        'يُحفظ سجل موافقة الشروط مدة تقادم المطالبات المحتملة، ولا يُحذف بطلب حذف البيانات الأخرى لأننا نحتاجه لإثبات حقوقنا.'] },
      { h: '9. حقوقك', p: [
        'وفق قانون حماية البيانات الشخصية رقم 151 لسنة 2020 يحق لصاحب البيانات الاطلاع عليها وتصحيحها وطلب محوها أو تقييد معالجتها أو الاعتراض عليها في الحالات التي يقررها القانون. ولطلب ذلك تواصل معنا، وإن كانت بياناتك لدى مكتب محاماة فتواصل أولًا مع المكتب.'] },
      { h: '10. الأمان', p: ['نستعمل اتصالًا مشفّرًا، وعزلًا بين المكاتب في قاعدة البيانات، وصلاحيات حسب الدور، وانتهاء الجلسة بعد 10 دقائق من عدم التفاعل. ولا يوجد نظام آمن بالكامل؛ فاحرص على قوة كلمة المرور وعلى تأمين أجهزتك.'] },
      { h: '11. الأطفال', p: ['التطبيق موجّه للمحامين ومكاتبهم وموكليهم البالغين، وليس للأطفال.'] },
      { h: '12. التعديلات والتواصل', p: [
        'قد نحدّث هذه السياسة بإصدار جديد يُعلن داخل التطبيق. وللاستفسار أو ممارسة حقوقك: ' + OPERATOR + ' — هاتف: ' + PHONE + '.'] }
    ]
  };

  /* ===================== أدوات ===================== */
  const $ = id => document.getElementById(id);
  function el(tag, text, css) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (css) e.style.cssText = css; return e; }
  function plain(doc) {
    const out = [doc.title];
    doc.sections.forEach(s => { out.push(s.h); (s.p || []).forEach(x => out.push(x)); (s.ul || []).forEach(x => out.push('- ' + x)); });
    return out.join('\n');
  }
  const fullText = () => 'مكتبي الإلكتروني — إصدار الشروط والسياسة: ' + VERSION + '\n\n' + plain(TERMS) + '\n\n' + plain(PRIVACY);
  async function sha256(text) {
    if (!(window.crypto && crypto.subtle)) throw new Error('يلزم فتح التطبيق عبر https لتسجيل الموافقة.');
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function renderDoc(doc) {
    const w = el('div', null, 'line-height:1.9;font-size:14px');
    doc.sections.forEach(s => {
      w.append(el('h4', s.h, 'margin:14px 0 4px;color:var(--primary-brown,#2D1E12)'));
      (s.p || []).forEach(x => w.append(el('p', x, 'margin:4px 0')));
      if (s.ul) { const u = el('ul', null, 'margin:4px 0;padding-inline-start:22px'); s.ul.forEach(x => u.append(el('li', x))); w.append(u); }
    });
    return w;
  }

  /* ===================== نافذة العرض ===================== */
  function open(which) {
    const old = $('mkLegalModal'); if (old) old.remove();
    const ov = el('div', null, 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100010;display:flex;align-items:center;justify-content:center;padding:14px');
    ov.id = 'mkLegalModal'; ov.onclick = e => { if (e.target === ov) ov.remove(); };
    const box = el('div', null, 'background:#fff;color:#2B2B2B;border-radius:14px;max-width:640px;width:100%;max-height:88vh;display:flex;flex-direction:column;direction:rtl;overflow:hidden');
    const bar = el('div', null, 'display:flex;gap:8px;align-items:center;padding:12px 14px;border-bottom:1px solid #E5D9C8;flex-wrap:wrap');
    const body = el('div', null, 'padding:4px 18px 18px;overflow:auto');
    const tabs = [['terms', 'الشروط والأحكام', TERMS], ['privacy', 'سياسة الخصوصية', PRIVACY], ['about', 'عن التطبيق', ABOUT]];
    const show = k => {
      const t = tabs.find(x => x[0] === k) || tabs[0];
      body.textContent = ''; body.append(renderDoc(t[2]));
      if (k !== 'about') body.append(el('p', 'إصدار النصوص: ' + VERSION, 'font-size:12px;opacity:.6;margin-top:16px'));
      body.scrollTop = 0;
      Array.from(bar.querySelectorAll('button[data-k]')).forEach(b => { b.style.fontWeight = b.dataset.k === k ? '800' : '400'; b.style.borderColor = b.dataset.k === k ? '#C5A869' : '#E5D9C8'; });
    };
    tabs.forEach(t => { const b = el('button', t[1], 'border:1px solid #E5D9C8;background:#fff;border-radius:18px;padding:5px 12px;cursor:pointer;font:inherit;font-size:13px'); b.type = 'button'; b.dataset.k = t[0]; b.onclick = () => show(t[0]); bar.append(b); });
    const x = el('button', '✕', 'margin-inline-start:auto;border:0;background:none;font-size:18px;cursor:pointer'); x.type = 'button'; x.onclick = () => ov.remove(); bar.append(x);
    box.append(bar, body); ov.append(box); document.body.append(ov); show(which || 'terms');
  }

  /* ===================== شاشة الدخول ===================== */
  function dl() { const c = (window.MK_CONFIG && MK_CONFIG.downloads) || {}; return { android: c.android, ios: c.ios, windows: c.windows }; }
  const okUrl = u => typeof u === 'string' && /^https?:\/\//i.test(u.trim());
  function decorate() {
    const gate = $('dqAuthGate'); if (!gate) return;
    const card = gate.querySelector('.auth-card'); if (!card || $('mkGateExtras')) return;
    const box = el('div', null, 'margin-top:18px;padding-top:14px;border-top:1px solid #E5D9C8;font-size:13px');
    box.id = 'mkGateExtras';
    // عن التطبيق
    const d = document.createElement('details'); d.style.cssText = 'margin-bottom:12px';
    d.append(el('summary', 'ℹ️ عن التطبيق', 'cursor:pointer;font-weight:700;font-size:14px'));
    const ab = el('div', null, 'margin-top:6px'); ab.append(renderDoc(ABOUT)); d.append(ab); box.append(d);
    // التحميل
    box.append(el('div', '⬇️ حمّل التطبيق', 'font-weight:700;font-size:14px;margin-bottom:8px'));
    const row = el('div', null, 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px');
    const links = dl();
    [['android', '🤖', 'Android'], ['ios', '🍎', 'iPhone / iOS'], ['windows', '🪟', 'Windows']].forEach(([k, ic, nm]) => {
      const u = links[k], ok = okUrl(u);
      const a = el(ok ? 'a' : 'span', null, 'display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 4px;border:1px solid #E5D9C8;border-radius:10px;text-decoration:none;color:#2B2B2B;text-align:center;font-size:12px;' + (ok ? 'background:#fff;cursor:pointer' : 'background:#f4f0e8;opacity:.65'));
      if (ok) { a.href = u.trim(); a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.append(el('span', ic, 'font-size:22px'), el('strong', nm), el('span', ok ? 'تحميل' : 'قريبًا', 'font-size:11px;color:#8C6D48'));
      row.append(a);
    });
    box.append(row);
    // السياسات
    const lg = el('div', null, 'text-align:center;font-size:13px');
    [['terms', 'الشروط والأحكام'], ['privacy', 'سياسة الخصوصية']].forEach((x, i) => {
      if (i) lg.append(document.createTextNode('  ·  '));
      const a = el('a', x[1], 'cursor:pointer;text-decoration:underline;color:#8C6D48'); a.href = '#'; a.onclick = e => { e.preventDefault(); open(x[0]); }; lg.append(a);
    });
    box.append(lg);
    const credit = card.querySelector('.dq-gate-credit');
    if (credit) card.insertBefore(box, credit); else card.append(box);
  }
  const _sg = window.dqSetGate;
  if (typeof _sg === 'function') window.dqSetGate = function () { const r = _sg.apply(this, arguments); try { decorate(); } catch (e) { console.warn(e); } return r; };

  /* ===================== إقرار الموافقة عند إنشاء مكتب ===================== */
  function consentHtml() {
    return '<div class="form-group" style="display:flex;gap:10px;align-items:flex-start;margin-top:14px">' +
      '<input type="checkbox" id="mkAgree" style="width:auto;margin-top:5px;flex:none">' +
      '<label for="mkAgree" style="font-size:13px;line-height:1.9;margin:0">أقرّ بأنني قرأت ' +
      '<a href="#" onclick="MK_LEGAL.open(\'terms\');return false" style="color:#8C6D48">الشروط والأحكام</a> و' +
      '<a href="#" onclick="MK_LEGAL.open(\'privacy\');return false" style="color:#8C6D48">سياسة الخصوصية</a> ' +
      'وأوافق عليهما، وأن لي صفة التعاقد باسم هذا المكتب.</label></div>';
  }
  // يعيد دليل الموافقة، أو null إن لم تُؤشَّر الخانة
  async function evidence() {
    const cb = $('mkAgree'); if (!cb || !cb.checked) return null;
    const text = fullText(), hash = await sha256(text);
    return {
      version: VERSION, hash: hash, text: text,
      info: { lang: navigator.language || '', tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''), screen: screen.width + 'x' + screen.height, client_time: new Date().toISOString(), ui: 'checkbox:mkAgree' }
    };
  }

  /* ===================== بطاقة داخل الإعدادات ===================== */
  function settingsCard() {
    const page = $('page-settings'); if (!page || $('mkLegalCard')) return;
    const c = el('div', null, 'margin-top:16px'); c.className = 'card'; c.id = 'mkLegalCard';
    const h = el('div'); h.className = 'card-header'; h.append(el('h2', 'الشروط وسياسة الخصوصية'));
    const b = el('div'); b.className = 'card-body';
    const r = el('div', null, 'display:flex;gap:8px;flex-wrap:wrap');
    [['terms', 'الشروط والأحكام'], ['privacy', 'سياسة الخصوصية'], ['about', 'عن التطبيق']].forEach(x => {
      const btn = el('button', x[1]); btn.type = 'button'; btn.className = 'btn btn-outline btn-sm'; btn.onclick = () => open(x[0]); r.append(btn);
    });
    b.append(r, el('p', 'إصدار النصوص: ' + VERSION, 'font-size:12px;color:var(--text-muted);margin-top:8px'));
    c.append(h, b); page.append(c);
  }
  const _sp = window.showPage;
  if (typeof _sp === 'function') window.showPage = function (id) { const r = _sp.apply(this, arguments); if (id === 'settings') try { settingsCard(); } catch (e) { } return r; };

  window.MK_LEGAL = { VERSION: VERSION, open: open, consentHtml: consentHtml, evidence: evidence, fullText: fullText, sha256: sha256 };
  document.addEventListener('DOMContentLoaded', function () { try { decorate(); } catch (e) { } });
})();
