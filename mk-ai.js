/* مكتبي — المساعد الذكي (llama3.2:3b يعمل داخل المتصفح عبر WebLLM/WebGPU)
   - لا سيرفر ولا حساب: يُنزَّل النموذج مرة واحدة (~2GB) ويُخزَّن في المتصفح ثم يعمل بدون إنترنت.
   - بيانات الموكلين لا تغادر الجهاز؛ المتصفح يحمّل فقط مكتبة WebLLM وأوزان النموذج.
   - الاستشهاد بالمواد من نصوص المكتبة المحلية (library/search-index.js) فقط، لا من ذاكرة النموذج.
   - لإضافة «الدفوع» لاحقًا: MK_AI.registerTask({...}) ثم أضف نصوصها لفهرس المكتبة. */
(function () {
  'use strict';
  const MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';
  const WEBLLM_VERSIONS = ['0.2.79', '0.2.78', '0.2.77'];       // تُجرَّب بالترتيب (مثبّتة، لا @latest)
  const WEBLLM_URL = v => 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@' + v + '/+esm';
  const CTX = 4096, MAX_OUT = 800;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SYSTEM = 'أنت مساعد صياغة قانونية لمحامٍ مصري. اكتب بالعربية الفصحى بصياغة قضائية رسمية موجزة. ' +
    'قواعد صارمة: (1) لا تذكر رقم مادة أو قانونًا أو حكمًا إلا إذا ورد حرفيًا في «نصوص المكتبة» المرفقة. ' +
    '(2) إن لم تجد سندًا في النصوص المرفقة فاكتب «لا يوجد سند في نصوص المكتبة المرفقة» ولا تخمّن. ' +
    '(3) لا تخترع وقائع أو أسماء أو تواريخ أو أرقام قضايا؛ اترك الخانات كما هي مثل {{اسم_الموكل}}. ' +
    '(4) أنت لا تعطي رأيًا نهائيًا؛ المخرج مسودة يراجعها المحامي.';

  /* ---------- المهام (الدفوع تُضاف هنا لاحقًا) ---------- */
  const TASKS = [
    { id: 'demands', label: 'صياغة الطلبات الختامية', lib: true, instr: 'صغ «الطلبات الختامية» لصحيفة دعوى بناءً على النص المرفق، في بنود مرقمة، ولا تضف طلبات لم يذكرها المحامي.' },
    { id: 'facts', label: 'صياغة الوقائع', lib: false, instr: 'أعد صياغة الوقائع المرفقة في فقرات متسلسلة زمنيًا بأسلوب قضائي، دون إضافة أي واقعة جديدة.' },
    { id: 'polish', label: 'تحسين الصياغة القانونية', lib: false, instr: 'حسّن الصياغة القانونية للنص المرفق مع الحفاظ على المعنى والخانات كما هي.' },
    { id: 'basis', label: 'اقتراح أسانيد من المكتبة', lib: true, instr: 'اعرض الأسانيد القانونية الواردة في نصوص المكتبة المرفقة والمتصلة بالموضوع، مع ذكر رقم المادة واسم القانون كما وردا، واشرح صلة كل مادة في سطر.' },
    { id: 'ask', label: 'سؤال عن نص في المكتبة', lib: true, instr: 'أجب عن سؤال المحامي من نصوص المكتبة المرفقة فقط، واذكر رقم المادة.' }
  ];

  /* ---------- البحث في المكتبة المحلية (استرجاع) ---------- */
  function norm(s) {
    return String(s || '').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g, ' ').toLowerCase();
  }
  const STOP = new Set(['ماده', 'قانون', 'من', 'في', 'علي', 'عن', 'الي', 'او', 'ما', 'هل', 'هو', 'هي', 'مع', 'ان', 'رقم', 'لسنه', 'بشان']);
  let libReady = null;
  function loadLib() {
    if (window.MK_LIBRARY_SEARCH) return Promise.resolve(window.MK_LIBRARY_SEARCH);
    if (libReady) return libReady;
    libReady = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'library/search-index.js';
      s.onload = () => res(window.MK_LIBRARY_SEARCH || []); s.onerror = () => rej(new Error('تعذر تحميل فهرس المكتبة'));
      document.head.appendChild(s);
    });
    return libReady;
  }
  const chunkCache = new Map(), headCache = new Map();
  function head(d) { if (!headCache.has(d.id)) headCache.set(d.id, norm((d.title || '') + ' ' + (d.category || '') + ' ' + String(d.text || '').slice(0, 700))); return headCache.get(d.id); }
  function chunks(d) {
    if (chunkCache.has(d.id)) return chunkCache.get(d.id);
    const t = String(d.text || ''), re = /(?:^|\n)\s*مادة\s*(?:\(\s*)?\r?\n?\s*([٠-٩0-9]+)/g, idx = [];
    let m; while ((m = re.exec(t))) idx.push({ at: m.index, no: norm(m[1]) });
    const out = idx.map((x, i) => {
      const raw = t.slice(x.at, i + 1 < idx.length ? idx[i + 1].at : t.length).replace(/\s+/g, ' ').trim();
      return { no: x.no, text: raw, n: norm(raw) };
    });
    if (!out.length) out.push({ no: '', text: t.slice(0, 3000).replace(/\s+/g, ' ').trim(), n: norm(t.slice(0, 3000)) });
    chunkCache.set(d.id, out); return out;
  }
  async function retrieve(query, k) {
    const lib = await loadLib(); if (!lib.length) return [];
    const q = norm(query), artM = q.match(/ماده\s*\(?\s*(\d+)/) || q.match(/\bم\s*(\d+)/), artNo = artM ? artM[1] : '';
    const toks = q.replace(/\d+/g, ' ').split(' ').map(w => w.replace(/^(ال|وال|بال|لل)/, '')).filter(w => w.length > 2 && !STOP.has(w));
    const meta = d => norm((d.title || '') + ' ' + (d.category || ''));
    let sc = lib.map(d => ({ d, s: toks.reduce((a, t) => a + (meta(d).indexOf(t) >= 0 ? 3 : 0) + (head(d).indexOf(t) >= 0 ? 1 : 0), 0) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    let docs;
    if (sc.length && sc[0].s >= 3) docs = sc.filter(x => x.s >= 3).slice(0, 30).map(x => x.d);   // القانون محدّد بالاسم/التصنيف: نبحث في كل أجزائه
    else if (sc.length) docs = sc.slice(0, 3).map(x => x.d);
    else docs = lib.map(d => ({ d, s: toks.reduce((a, t) => a + (norm(String(d.text).slice(0, 40000)).indexOf(t) >= 0 ? 1 : 0), 0) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map(x => x.d);
    const hits = [];
    docs.forEach(d => chunks(d).forEach(c => {
      let s = toks.reduce((a, t) => a + (c.n.indexOf(t) >= 0 ? 3 : 0), 0);
      if (artNo && c.no === artNo) s += 100;
      if (s > 0) hits.push({ d, c, s });
    }));
    return hits.sort((a, b) => b.s - a.s).slice(0, k || 4);
  }
  const lawName = d => ((d.category || '') + ' — ' + (d.title || '')).slice(0, 120);

  /* ---------- المحرك (WebLLM) ---------- */
  let engine = null, loading = null, state = 'idle', progressText = '';
  const listeners = [];
  function setState(s, t) { state = s; progressText = t || ''; listeners.forEach(f => { try { f(); } catch (e) { } }); }
  function support() {
    if (!window.isSecureContext) return 'يتطلب فتح التطبيق عبر https.';
    if (!navigator.gpu) return 'هذا المتصفح/الجهاز لا يدعم WebGPU (جرّب Chrome حديث على أندرويد أو حاسوب).';
    return '';
  }
  async function importWebLLM() {
    let last;
    for (const v of WEBLLM_VERSIONS) { try { return await import(WEBLLM_URL(v)); } catch (e) { last = e; } }
    throw last || new Error('تعذر تحميل مكتبة WebLLM (تحقق من الإنترنت)');
  }
  function load() {
    if (engine) return Promise.resolve(engine);
    if (loading) return loading;
    const why = support(); if (why) { setState('error', why); return Promise.reject(new Error(why)); }
    setState('loading', 'جارٍ تحميل مكتبة التشغيل…');
    loading = (async () => {
      const w = await importWebLLM();
      const list = (w.prebuiltAppConfig && w.prebuiltAppConfig.model_list) || [];
      const id = list.some(m => m.model_id === MODEL) ? MODEL : ((list.find(m => /Llama-3\.2-3B-Instruct.*q4f16/.test(m.model_id)) || {}).model_id);
      if (!id) throw new Error('نموذج Llama 3.2 3B غير متاح في هذه النسخة من WebLLM.');
      engine = await w.CreateMLCEngine(id, { initProgressCallback: r => setState('loading', (r && r.text) || '…') }, { context_window_size: CTX });
      setState('ready', 'النموذج جاهز'); return engine;
    })().catch(e => { engine = null; loading = null; setState('error', (e && e.message) || String(e)); throw e; });
    return loading;
  }
  async function unload() { try { if (engine && engine.unload) await engine.unload(); } catch (e) { } engine = null; loading = null; setState('idle'); }
  async function clearCache() {
    try { await unload(); const ks = await caches.keys(); await Promise.all(ks.filter(k => /webllm|mlc/i.test(k)).map(k => caches.delete(k))); } catch (e) { }
    toastSafe('تم حذف النموذج من هذا الجهاز');
  }
  const toastSafe = m => { try { toast(m); } catch (e) { alert(m); } };

  /* ---------- توليد ---------- */
  async function run(task, userText, docText, onToken) {
    const e = await load();
    let ctxTxt = '', sources = [];
    if (task.lib) {
      const hits = await retrieve(userText + ' ' + (docText || '').slice(0, 300), 4);
      let budget = 3000;
      hits.forEach(h => { const t = h.c.text.slice(0, 900); if (budget - t.length < 0) return; budget -= t.length; ctxTxt += '[' + lawName(h.d) + (h.c.no ? ' — مادة ' + h.c.no : '') + ']\n' + t + '\n\n'; sources.push(lawName(h.d) + (h.c.no ? ' — مادة ' + h.c.no : '')); });
      if (!hits.length) ctxTxt = '(لم يُعثر على نصوص مطابقة في المكتبة)';
    }
    const user = 'المهمة: ' + task.instr + (ctxTxt ? '\n\nنصوص المكتبة (المصدر الوحيد للاستشهاد):\n' + ctxTxt : '') +
      (docText ? '\nالنص المرفق:\n' + docText.slice(0, 2000) + '\n' : '') + '\nطلب المحامي: ' + (userText || '').slice(0, 600);
    const stream = await e.chat.completions.create({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], stream: true, temperature: 0.3, max_tokens: MAX_OUT });
    let out = '';
    for await (const ch of stream) { const d = ch.choices && ch.choices[0] && ch.choices[0].delta && ch.choices[0].delta.content; if (d) { out += d; onToken && onToken(out); } }
    return { text: out, sources: sources };
  }

  /* ---------- الواجهة ---------- */
  let range = null, cur = null;
  function editorSel() {
    const pg = $('mkePage'); if (!pg) return { sel: '', all: '' };
    const s = window.getSelection(); range = null;
    if (s && s.rangeCount && pg.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange();
    return { sel: s && range ? s.toString().trim() : '', all: (pg.innerText || '').trim() };
  }
  function panel() {
    let p = $('mkAiPanel'); if (p) return p;
    p = document.createElement('div'); p.id = 'mkAiPanel';
    p.style.cssText = 'display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);align-items:flex-end;justify-content:center;';
    p.innerHTML = '<div dir="rtl" style="background:var(--card,#fff);color:var(--text,#222);width:min(720px,100%);max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:14px;font-family:inherit">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong>🤖 مساعد الصياغة (llama3.2:3b — يعمل على جهازك)</strong><button class="btn btn-outline btn-sm" onclick="MK_AI.close()">✕</button></div>' +
      '<div id="mkAiStatus" style="font-size:12px;margin-bottom:8px"></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px" id="mkAiTasks"></div>' +
      '<textarea id="mkAiIn" rows="3" placeholder="اكتب طلبك أو انسخ الوقائع… (يُستخدم النص المحدد في المحرر تلقائيًا)" style="width:100%;box-sizing:border-box"></textarea>' +
      '<div style="display:flex;gap:8px;margin:8px 0;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="mkAiGo" onclick="MK_AI.go()">توليد</button><button class="btn btn-outline btn-sm" onclick="MK_AI.stop()">إيقاف</button>' +
      '<button class="btn btn-outline btn-sm" id="mkAiIns" style="display:none" onclick="MK_AI.insert()">⬇️ إدراج في المستند</button><button class="btn btn-outline btn-sm" id="mkAiCp" style="display:none" onclick="MK_AI.copy()">نسخ</button></div>' +
      '<div id="mkAiOut" style="white-space:pre-wrap;line-height:1.9;border:1px solid var(--border,#ddd);border-radius:10px;padding:10px;min-height:60px;font-size:14px"></div>' +
      '<div id="mkAiSrc" style="font-size:12px;color:var(--text-muted,#666);margin-top:8px"></div>' +
      '<p style="font-size:11px;color:var(--text-muted,#666);margin-top:8px">مسودة آلية من نموذج صغير: راجع كل جملة، وطابق أرقام المواد بنص المكتبة قبل الاعتماد. لا تُرسل بيانات الموكلين لأي خادم.</p></div>';
    document.body.appendChild(p);
    listeners.push(function () { const s = $('mkAiStatus'); if (s) s.innerHTML = statusHtml(); });
    return p;
  }
  function statusHtml() {
    if (state === 'ready') return '✅ النموذج جاهز على هذا الجهاز.';
    if (state === 'loading') return '⏳ ' + esc(progressText);
    if (state === 'error') return '⚠️ ' + esc(progressText);
    const w = support();
    return w ? '⚠️ ' + esc(w) : 'أول تشغيل ينزّل نحو 2 جيجابايت (يُفضّل Wi-Fi وجهاز بذاكرة 6GB+) ثم يعمل بدون إنترنت. <button class="btn btn-outline btn-sm" onclick="MK_AI.enable()">تحميل وتفعيل</button>';
  }
  function open(opts) {
    opts = opts || {}; const p = panel(), e = opts.editor ? editorSel() : { sel: '', all: '' };
    cur = { task: TASKS.find(t => t.id === (opts.task || (opts.editor ? 'demands' : 'ask'))) || TASKS[0], sel: e.sel, all: e.all };
    $('mkAiTasks').innerHTML = TASKS.map(t => '<button class="btn ' + (t.id === cur.task.id ? 'btn-primary' : 'btn-outline') + ' btn-sm" onclick="MK_AI.pick(\'' + t.id + '\')">' + esc(t.label) + '</button>').join('');
    $('mkAiOut').textContent = ''; $('mkAiSrc').textContent = ''; $('mkAiIns').style.display = $('mkAiCp').style.display = 'none';
    $('mkAiIns').dataset.ed = opts.editor ? '1' : '';
    $('mkAiStatus').innerHTML = statusHtml(); p.style.display = 'flex';
  }
  const api = {
    open: open, close: function () { const p = $('mkAiPanel'); if (p) p.style.display = 'none'; },
    pick: function (id) { cur.task = TASKS.find(t => t.id === id) || cur.task; open({ editor: !!$('mkAiIns').dataset.ed, task: id }); },
    enable: function () { load().catch(function () { }); },
    stop: function () { try { engine && engine.interruptGenerate(); } catch (e) { } },
    go: async function () {
      const txt = $('mkAiIn').value.trim(), doc = cur.sel || cur.all;
      if (!txt && !doc) return toastSafe('اكتب طلبك أو حدّد نصًا في المحرر');
      const out = $('mkAiOut'); out.textContent = 'جارٍ التوليد…'; $('mkAiGo').disabled = true;
      try {
        const r = await run(cur.task, txt, doc, t => { out.textContent = t; });
        cur.result = r.text; $('mkAiCp').style.display = ''; if ($('mkAiIns').dataset.ed) $('mkAiIns').style.display = '';
        $('mkAiSrc').innerHTML = r.sources.length ? '<strong>المصادر من المكتبة:</strong><br>' + r.sources.map(esc).join('<br>') : (cur.task.lib ? 'لم تُستخدم نصوص من المكتبة.' : '');
      } catch (e) { out.textContent = 'تعذّر التوليد: ' + ((e && e.message) || e); }
      $('mkAiGo').disabled = false;
    },
    copy: function () { try { navigator.clipboard.writeText(cur.result || ''); toastSafe('تم النسخ'); } catch (e) { } },
    insert: function () {
      const pg = $('mkePage'); if (!pg || !cur || !cur.result) return;
      api.close(); pg.focus();
      if (range) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); }
      const html = cur.result.split(/\n+/).filter(Boolean).map(l => '<p>' + esc(l) + '</p>').join('');
      document.execCommand('insertHTML', false, html);
      pg.dispatchEvent(new Event('input', { bubbles: true }));
    },
    registerTask: function (t) { if (t && t.id && !TASKS.some(x => x.id === t.id)) TASKS.push(t); },
    retrieve: retrieve, enableState: function () { return state; }, clearCache: clearCache, unload: unload
  };
  window.MK_AI = api;

  /* زر داخل المحرر */
  function hookEditor() {
    const ed = window.DQ_EDITOR; if (!ed || !ed.ui) return false;
    ed.ui.ai = function () { open({ editor: true }); };
    return true;
  }
  function injectEditorButton() {
    const row = document.querySelectorAll('#mkEditorModal .mke-row')[1];
    if (!row || $('mkeAiBtn')) return;
    const b = document.createElement('button'); b.id = 'mkeAiBtn'; b.dataset.a = 'ai'; b.textContent = '🤖 مساعد الصياغة'; row.appendChild(b);
  }
  /* بطاقة الإعدادات */
  function settingsCard() {
    const pg = $('page-settings'); if (!pg || $('mkAiCard')) return;
    const c = document.createElement('div'); c.className = 'card'; c.id = 'mkAiCard'; c.style.marginTop = '16px';
    c.innerHTML = '<div class="card-header"><h2>🤖 المساعد الذكي (llama3.2:3b)</h2></div><div class="card-body">' +
      '<p style="font-size:13px;color:var(--text-muted);margin-bottom:10px">يعمل داخل المتصفح بدون سيرفر، ويخدم المكتبة والنماذج وصحف الدعاوى (والدفوع لاحقًا). التنزيل الأول نحو 2GB.</p>' +
      '<div id="mkAiCardStatus" style="font-size:13px;margin-bottom:10px"></div><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-primary btn-sm" onclick="MK_AI.enable()">تحميل وتفعيل</button><button class="btn btn-outline btn-sm" onclick="MK_AI.open({task:\'ask\'})">اسأل عن نص في المكتبة</button>' +
      '<button class="btn btn-danger btn-sm" onclick="if(confirm(\'حذف النموذج المحمّل من هذا الجهاز؟\'))MK_AI.clearCache()">حذف النموذج</button></div></div>';
    (pg.querySelector('.card') ? pg.querySelector('.card').parentNode : pg).appendChild(c);
    listeners.push(function () { const s = $('mkAiCardStatus'); if (s) s.innerHTML = statusHtml(); });
    $('mkAiCardStatus').innerHTML = statusHtml();
  }
  document.addEventListener('DOMContentLoaded', function () {
    let n = 0; const t = setInterval(function () { hookEditor(); injectEditorButton(); settingsCard(); if (++n > 40) clearInterval(t); }, 1000);
  });
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-page="settings"]')) setTimeout(settingsCard, 100); }, true);
  // المحرر يُنشأ عند أول فتح؛ نعيد محاولة الحقن عند ظهوره
  new MutationObserver(function () { if ($('mkEditorModal')) { hookEditor(); injectEditorButton(); } }).observe(document.documentElement, { childList: true, subtree: true });
})();
