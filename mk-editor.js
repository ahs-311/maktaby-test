/* مكتبي الإلكتروني — محرر المستندات (المرحلة F)
   محرر RTL خفيف يعمل أوفلاين + خانات {{...}} + طباعة A4 + تصدير/استيراد docx + مسودات بنسخ.
   المنطق (logic) منفصل عن الواجهة (ui) ليُختبر بـ Node. لا يعتمد على DOM إلا في ui. */
(function (root) {
  'use strict';

  /* ====================== 1) محلل HTML/XML صغير (يعمل في Node والمتصفح) ====================== */
  const VOID = { br: 1, hr: 1, img: 1, input: 1, meta: 1, link: 1, col: 1 };
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    const v = ENT[e.toLowerCase()]; return v === undefined ? m : v;
  });
  const escT = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escA = s => escT(s).replace(/"/g, '&quot;');

  function parseAttrs(s) {
    const out = {}; const re = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let m;
    while ((m = re.exec(s))) out[m[1].toLowerCase()] = decode(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '');
    return out;
  }
  // يعيد شجرة {tag, attrs, children} ؛ النص عقدة {text}
  function parseMarkup(src, xml) {
    const rootN = { tag: '#root', attrs: {}, children: [] };
    const stack = [rootN];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|([^<]+)|</g;
    let m; const s = String(src == null ? '' : src);
    while ((m = re.exec(s))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined && m[0].indexOf('CDATA') > -1) { top.children.push({ text: m[1] }); continue; }
      if (m[6] !== undefined) { top.children.push({ text: decode(m[6]) }); continue; }
      if (m[3] === undefined) { if (m[0] === '<') top.children.push({ text: '<' }); continue; }
      const closing = m[2] === '/', tag = xml ? m[3] : m[3].toLowerCase();
      if (closing) {
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
        continue;
      }
      const node = { tag, attrs: parseAttrs(m[4] || ''), children: [] };
      top.children.push(node);
      if (m[5] === '/' || (!xml && VOID[tag])) continue;
      stack.push(node);
    }
    return rootN;
  }

  /* ====================== 2) تنقية HTML (قائمة بيضاء) ====================== */
  const ALLOW = { p: 1, div: 1, span: 1, br: 1, b: 1, strong: 1, i: 1, em: 1, u: 1, s: 1, strike: 1, sub: 1, sup: 1,
    h1: 1, h2: 1, h3: 1, h4: 1, ul: 1, ol: 1, li: 1, table: 1, thead: 1, tbody: 1, tr: 1, td: 1, th: 1 };
  const DROP_WITH_CONTENT = { script: 1, style: 1, head: 1, title: 1, iframe: 1, object: 1, embed: 1, noscript: 1, template: 1, svg: 1, math: 1 };
  const FONT_SIZES = { 1: 10, 2: 13, 3: 16, 4: 18, 5: 24, 6: 32, 7: 48 };

  function cleanStyle(st) {
    const out = [];
    String(st || '').split(';').forEach(d => {
      const i = d.indexOf(':'); if (i < 0) return;
      const p = d.slice(0, i).trim().toLowerCase(), v = d.slice(i + 1).trim().toLowerCase();
      if (p === 'text-align' && /^(left|right|center|justify)$/.test(v)) out.push('text-align:' + v);
      else if (p === 'font-size' && /^\d{1,3}(\.\d+)?(px|pt)$/.test(v)) out.push('font-size:' + v);
      else if (p === 'font-weight' && /^(bold|700|800|900)$/.test(v)) out.push('font-weight:bold');
      else if (p === 'font-style' && v === 'italic') out.push('font-style:italic');
      else if (p === 'text-decoration' || p === 'text-decoration-line') {
        const t = []; if (/underline/.test(v)) t.push('underline'); if (/line-through/.test(v)) t.push('line-through');
        if (t.length) out.push('text-decoration:' + t.join(' '));
      } else if (p === 'font-family') {
        const raw = d.slice(i + 1).trim();
        if (/^[\w\s,'"\-؀-ۿ]{1,80}$/.test(raw)) out.push('font-family:' + raw.replace(/"/g, "'"));
      } else if (p === 'page-break-after' && v === 'always') out.push('page-break-after:always');
    });
    return out.join(';');
  }
  function sanitizeNodes(nodes, out) {
    nodes.forEach(n => {
      if (n.text !== undefined) { out.push(escT(n.text)); return; }
      let tag = n.tag;
      if (DROP_WITH_CONTENT[tag]) return;
      let attrs = n.attrs || {};
      if (tag === 'font') {   // ناتج execCommand القديم → span
        const st = []; const sz = FONT_SIZES[String(attrs.size || '').replace(/[^1-7]/g, '')]; if (sz) st.push('font-size:' + sz + 'px');
        if (attrs.face && /^[\w\s,'"\-؀-ۿ]{1,60}$/.test(attrs.face)) st.push('font-family:' + attrs.face);
        tag = 'span'; attrs = { style: st.join(';') };
      }
      if (!ALLOW[tag]) { sanitizeNodes(n.children, out); return; }   // نفكّ الوسم ونبقي المحتوى
      if (tag === 'strong') tag = 'b'; else if (tag === 'em') tag = 'i'; else if (tag === 'strike') tag = 's';
      let a = '';
      const st = cleanStyle(attrs.style); if (st) a += ' style="' + escA(st) + '"';
      const cls = String(attrs.class || '').split(/\s+/).filter(c => c === 'mk-ph' || c === 'mk-pb');
      if (cls.length) a += ' class="' + cls.join(' ') + '"';
      if (tag === 'td' || tag === 'th') {
        const cs = parseInt(attrs.colspan, 10), rs = parseInt(attrs.rowspan, 10);
        if (cs > 1 && cs < 30) a += ' colspan="' + cs + '"'; if (rs > 1 && rs < 30) a += ' rowspan="' + rs + '"';
      }
      if (tag === 'br') { out.push('<br>'); return; }
      out.push('<' + tag + a + '>'); sanitizeNodes(n.children, out); out.push('</' + tag + '>');
    });
  }
  function sanitize(html) {
    const out = []; sanitizeNodes(parseMarkup(html, false).children, out); return out.join('');
  }

  /* ====================== 3) الخانات {{...}} ====================== */
  const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
  const normKey = k => String(k).trim().replace(/\s+/g, '_');
  const PLACEHOLDERS = [
    ['اسم_الموكل', 'اسم الموكل'], ['رقم_هوية_الموكل', 'رقم هوية الموكل'], ['هاتف_الموكل', 'هاتف الموكل'], ['عنوان_الموكل', 'عنوان الموكل'],
    ['رقم_القضية', 'رقم القضية'], ['موضوع_القضية', 'موضوع القضية'], ['المحكمة', 'المحكمة'], ['الدائرة', 'الدائرة'],
    ['اسم_الخصم', 'اسم الخصم'], ['نوع_القضية', 'نوع القضية'], ['درجة_التقاضي', 'درجة التقاضي'],
    ['اسم_المحامي', 'اسم المحامي'], ['اسم_المكتب', 'اسم المكتب'], ['عنوان_المكتب', 'عنوان المكتب'], ['هاتف_المكتب', 'هاتف المكتب'],
    ['تاريخ_اليوم', 'تاريخ اليوم']
  ];
  const pad2 = n => String(n).padStart(2, '0');
  const fmtDate = d => pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();

  // يلف الخانات العارية في span ليظهرها المحرر بتمييز
  function wrapTokens(html) {
    return String(html).replace(/(<span class="mk-ph">)?\{\{\s*([^{}]+?)\s*\}\}(<\/span>)?/g, (m, a, k) => '<span class="mk-ph">{{' + normKey(k) + '}}</span>');
  }
  function findTokens(html) {
    const seen = []; String(html).replace(TOKEN, (m, k) => { k = normKey(k); if (seen.indexOf(k) < 0) seen.push(k); return m; });
    return seen;
  }
  function fill(html, values) {
    const filled = [], missing = [];
    const out = String(html).replace(/(<span class="mk-ph">)?\{\{\s*([^{}]+?)\s*\}\}(<\/span>)?/g, (m, a, k) => {
      k = normKey(k); const v = values && values[k];
      if (v === undefined || v === null || String(v).trim() === '') { if (missing.indexOf(k) < 0) missing.push(k); return '<span class="mk-ph">{{' + k + '}}</span>'; }
      if (filled.indexOf(k) < 0) filled.push(k);
      return escT(String(v));
    });
    return { html: out, filled, missing };
  }
  // ctx.officeProfile() ، ctx.account() ، ctx.today()
  function valuesFor(ctx, sel) {
    sel = sel || {};
    const cases = ctx.DB.get('cases'), clients = ctx.DB.get('clients');
    const cs = sel.caseId ? cases.find(c => c && c.id === sel.caseId) : null;
    const cl = clients.find(c => c && c.id === (cs ? cs.clientId : sel.clientId)) || null;
    const off = (ctx.officeProfile && ctx.officeProfile()) || {}, acc = (ctx.account && ctx.account()) || {};
    const v = {};
    if (cl) { v['اسم_الموكل'] = cl.name; v['رقم_هوية_الموكل'] = cl.idNum; v['هاتف_الموكل'] = cl.phone; v['عنوان_الموكل'] = cl.address; }
    if (cs) {
      v['رقم_القضية'] = cs.numberPending ? '' : cs.number; v['موضوع_القضية'] = cs.subject; v['المحكمة'] = cs.court; v['الدائرة'] = cs.circuit;
      v['اسم_الخصم'] = cs.opponent; v['نوع_القضية'] = cs.type; v['درجة_التقاضي'] = cs.degree;
    }
    v['اسم_المحامي'] = (cs && cs.lawyer) || off.lawyer || (acc.role === 'lawyer' ? acc.name : '') || '';
    v['اسم_المكتب'] = off.name; v['عنوان_المكتب'] = off.address; v['هاتف_المكتب'] = off.phones;
    v['تاريخ_اليوم'] = fmtDate(ctx.today ? ctx.today() : new Date());
    return v;
  }

  /* ====================== 4) نص عادي ← HTML ====================== */
  const RULE_LINE = /^[\s═─━\-_=*]{6,}$/;
  function textToHtml(text, opts) {
    opts = opts || {}; const out = []; let titled = false;
    String(text || '').replace(/\r/g, '').split('\n').forEach(line => {
      if (RULE_LINE.test(line)) return;
      const t = line.replace(/\s+$/, '');
      if (!t.trim()) { out.push('<p><br></p>'); return; }
      const lead = t.match(/^ */)[0].length;
      const body = escT(t.trim()).replace(/ {2,}/g, m => ' '.repeat(m.length));
      if (!titled && (opts.titleFirst || lead >= 4)) { titled = true; out.push('<h2 style="text-align:center">' + body + '</h2>'); return; }
      if (lead >= 4) { out.push('<p style="text-align:center"><b>' + body + '</b></p>'); return; }
      out.push('<p>' + body + '</p>');
    });
    return wrapTokens(out.join('').replace(/^(<p><br><\/p>)+/, ''));
  }
  function htmlToText(html) {
    const t = []; (function walk(ns) {
      ns.forEach(n => {
        if (n.text !== undefined) { t.push(n.text); return; }
        if (n.tag === 'br') { t.push('\n'); return; }
        const blk = /^(p|div|h[1-4]|li|tr)$/.test(n.tag);
        walk(n.children); if (blk) t.push('\n');
        else if (n.tag === 'td' || n.tag === 'th') t.push('\t');
      });
    })(parseMarkup(html, false).children);
    return t.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ====================== 5) صفحة الطباعة A4 ====================== */
  function printDocument(o) {
    o = o || {};
    const css = '@page{size:A4;margin:18mm 16mm 20mm;@bottom-center{content:counter(page) " / " counter(pages);font:10pt Tahoma,Arial,sans-serif;color:#555}}' +
      'html,body{margin:0;padding:0}body{font-family:' + (o.font || "'Traditional Arabic','Simplified Arabic',Tahoma,'Noto Naskh Arabic',Arial,sans-serif") + ';font-size:14pt;line-height:1.9;color:#000;direction:rtl;text-align:right}' +
      'h1{font-size:20pt;margin:8pt 0}h2{font-size:17pt;margin:8pt 0}h3{font-size:15pt;margin:6pt 0}p{margin:0 0 4pt}' +
      'table{border-collapse:collapse;width:100%;margin:6pt 0}td,th{border:1px solid #000;padding:4pt 6pt;vertical-align:top}' +
      '.mk-pb{page-break-after:always;height:0;margin:0}.mk-ph{background:none}ul,ol{margin:0 0 4pt;padding-right:24pt}' +
      '@media screen{body{padding:16px}}';
    return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
      escT(o.title || 'مستند') + '</title><style>' + css + '</style></head><body>' + (o.headerHtml || '') + '<main>' + sanitize(o.bodyHtml || '') + '</main>' + (o.footerHtml || '') + '</body></html>';
  }

  /* ====================== 6) تصدير docx ====================== */
  const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const FONT = 'Arial';
  const HAS_AR = /[֐-ࣿיִ-﷿ﹰ-﻿]/, HAS_LAT = /[A-Za-z]/;
  const xe = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

  function runXml(text, st) {
    if (!text) return '';
    const rtl = HAS_AR.test(text) || !HAS_LAT.test(text);
    const font = st.font || FONT;
    let rp = '<w:rFonts w:ascii="' + xe(font) + '" w:hAnsi="' + xe(font) + '" w:cs="' + xe(font) + '"/>';
    if (st.b) rp += '<w:b/><w:bCs/>'; if (st.i) rp += '<w:i/><w:iCs/>'; if (st.s) rp += '<w:strike/>';
    if (st.sz) rp += '<w:sz w:val="' + st.sz + '"/><w:szCs w:val="' + st.sz + '"/>';
    if (st.u) rp += '<w:u w:val="single"/>';
    if (st.va) rp += '<w:vertAlign w:val="' + st.va + '"/>';
    if (rtl) rp += '<w:rtl/>';
    return '<w:r><w:rPr>' + rp + '</w:rPr><w:t xml:space="preserve">' + xe(text) + '</w:t></w:r>';
  }
  const brXml = '<w:r><w:br/></w:r>';
  function sizeHalfPts(v) { const m = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(v || ''); if (!m) return 0; const pt = m[2] === 'px' ? parseFloat(m[1]) * 0.75 : parseFloat(m[1]); return Math.max(2, Math.min(400, Math.round(pt * 2))); }
  function styleOf(n, st) {
    const o = Object.assign({}, st), t = n.tag, s = {};
    String((n.attrs && n.attrs.style) || '').split(';').forEach(d => { const i = d.indexOf(':'); if (i > 0) s[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
    if (t === 'b' || /bold/.test(s['font-weight'] || '')) o.b = true;
    if (t === 'i' || s['font-style'] === 'italic') o.i = true;
    if (t === 'u' || /underline/.test(s['text-decoration'] || '')) o.u = true;
    if (t === 's' || /line-through/.test(s['text-decoration'] || '')) o.s = true;
    if (t === 'sub') o.va = 'subscript'; if (t === 'sup') o.va = 'superscript';
    if (s['font-size']) { const z = sizeHalfPts(s['font-size']); if (z) o.sz = z; }
    if (s['font-family']) { const f = s['font-family'].split(',')[0].replace(/['"]/g, '').trim(); if (f) o.font = f; }
    return o;
  }
  const BLOCK = { p: 1, div: 1, h1: 1, h2: 1, h3: 1, h4: 1, ul: 1, ol: 1, li: 1, table: 1 };
  const HEAD = { h1: ['Heading1', 40], h2: ['Heading2', 34], h3: ['Heading3', 30], h4: ['Heading3', 28] };
  function alignOf(n, inherit) {
    const m = /text-align:\s*(left|right|center|justify)/.exec((n.attrs && n.attrs.style) || ''); return m ? m[1] : inherit;
  }
  // في فقرة bidi: القيمة "left" في Word تعني بداية السطر (اليمين)، لذا نعكس
  function jcXml(a) { return a === 'center' ? '<w:jc w:val="center"/>' : a === 'justify' ? '<w:jc w:val="both"/>' : a === 'left' ? '<w:jc w:val="right"/>' : ''; }

  function inlineRuns(nodes, st, out) {
    nodes.forEach(n => {
      if (n.text !== undefined) { const t = n.text.replace(/[\r\n\t]+/g, ' '); if (t) out.push(runXml(t, st)); return; }
      if (n.tag === 'br') { out.push(brXml); return; }
      if (BLOCK[n.tag]) { inlineRuns(n.children, st, out); return; }
      inlineRuns(n.children, styleOf(n, st), out);
    });
  }
  function hasBlockChild(n) { return n.children.some(c => c.tag && BLOCK[c.tag]); }
  function paraXml(runs, o) {
    o = o || {};
    let pp = (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') + '<w:bidi/>' + (o.before ? '<w:spacing w:before="' + o.before + '"/>' : '') + jcXml(o.align);
    return '<w:p><w:pPr>' + pp + '</w:pPr>' + runs + '</w:p>';
  }
  function blocks(nodes, st, align, out, ctxn) {
    ctxn = ctxn || {}; let buf = [];
    const flush = () => {
      const s = buf.join(''); buf = [];
      if (s.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, '').replace(/<[^>]+>/g, '').trim() === '' && s.indexOf('<w:br/>') < 0) return;
      out.push(paraXml(s, { align }));
    };
    nodes.forEach(n => {
      if (n.text !== undefined) { if (n.text.trim()) { const t = n.text.replace(/[\r\n\t]+/g, ' '); buf.push(runXml(t, st)); } else if (buf.length) buf.push(runXml(' ', st)); return; }
      if (!BLOCK[n.tag]) { inlineRuns([n], st, buf); return; }
      flush();
      const cls = (n.attrs && n.attrs.class) || '';
      if (cls.indexOf('mk-pb') > -1 || /page-break-after:\s*always/.test((n.attrs && n.attrs.style) || '')) {
        out.push('<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>'); return;
      }
      const nst = styleOf(n, st), al = alignOf(n, align);
      if (n.tag === 'table') { tableXml(n, nst, out); return; }
      if (n.tag === 'ul' || n.tag === 'ol') {
        let i = 0;
        n.children.forEach(li => {
          if (!li.tag) return; if (li.tag !== 'li') { blocks([li], nst, al, out); return; }
          i++; const runs = []; const prefix = n.tag === 'ol' ? i + '. ' : '• ';
          runs.push(runXml(prefix, nst));
          if (hasBlockChild(li)) { const tmp = []; blocks(li.children, styleOf(li, nst), alignOf(li, al), tmp); out.push.apply(out, tmp.length ? [tmp.shift().replace('</w:pPr>', '</w:pPr>' + runs.join(''))].concat(tmp) : [paraXml(runs.join(''), { align: al })]); }
          else { inlineRuns(li.children, styleOf(li, nst), runs); out.push(paraXml(runs.join(''), { align: al })); }
        });
        return;
      }
      if (n.tag === 'div' && hasBlockChild(n)) { blocks(n.children, nst, al, out); return; }
      const h = HEAD[n.tag]; const runs = [];
      const hst = h ? Object.assign({ b: true, sz: h[1] }, nst, { b: true }) : nst;
      if (h && !nst.sz) hst.sz = h[1];
      inlineRuns(n.children, hst, runs);
      out.push(paraXml(runs.join(''), { align: al, style: h ? h[0] : '' }));
    });
    flush();
  }
  function tableXml(t, st, out) {
    const rows = []; (function collect(ns) { ns.forEach(n => { if (n.tag === 'tr') rows.push(n); else if (n.children) collect(n.children); }); })(t.children);
    const cellsOf = r => r.children.filter(c => c.tag === 'td' || c.tag === 'th');
    let cols = 1; rows.forEach(r => { let c = 0; cellsOf(r).forEach(td => { c += Math.max(1, parseInt(td.attrs.colspan, 10) || 1); }); cols = Math.max(cols, c); });
    const total = 9638, w = Math.floor(total / cols);
    let x = '<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => '<w:' + b + ' w:val="single" w:sz="4" w:space="0" w:color="000000"/>').join('') +
      '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' + ('<w:gridCol w:w="' + w + '"/>').repeat(cols) + '</w:tblGrid>';
    rows.forEach(r => {
      x += '<w:tr>';
      const cells = cellsOf(r);
      cells.forEach(td => {
        const span = Math.max(1, Math.min(cols, parseInt(td.attrs.colspan, 10) || 1)), inner = [];
        blocks(td.children, td.tag === 'th' ? Object.assign({}, st, { b: true }) : st, alignOf(td, ''), inner);
        x += '<w:tc><w:tcPr><w:tcW w:w="' + (w * span) + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') + '</w:tcPr>' + (inner.join('') || '<w:p><w:pPr><w:bidi/></w:pPr></w:p>') + '</w:tc>';
      });
      if (!cells.length) x += '<w:tc><w:tcPr><w:tcW w:w="' + total + '" w:type="dxa"/></w:tcPr><w:p/></w:tc>';
      x += '</w:tr>';
    });
    x += '</w:tbl>'; out.push(x); out.push('<w:p><w:pPr><w:bidi/></w:pPr></w:p>');
  }

  function docxParts(html, opts) {
    opts = opts || {}; const body = [];
    if (opts.letterhead) {
      const L = opts.letterhead;
      if (L.name) body.push(paraXml(runXml(L.name, { b: true, sz: 36 }), { align: 'center' }));
      [L.lawyer, L.address].filter(Boolean).forEach(t => body.push(paraXml(runXml(t, { sz: 24 }), { align: 'center' })));
      body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="000000"/></w:pBdr><w:bidi/></w:pPr></w:p>'.replace('<w:pBdr>', '<w:pBdr>'));
    }
    blocks(parseMarkup(sanitize(html), false).children, {}, '', body);
    const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W_NS + '><w:body>' + body.join('') +
      '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + W_NS + '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + FONT + '" w:hAnsi="' + FONT + '" w:cs="' + FONT + '"/><w:sz w:val="28"/><w:szCs w:val="28"/><w:lang w:val="en-US" w:bidi="ar-EG"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="80" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      [['Heading1', 'heading 1', 40], ['Heading2', 'heading 2', 34], ['Heading3', 'heading 3', 30]].map(h =>
        '<w:style w:type="paragraph" w:styleId="' + h[0] + '"><w:name w:val="' + h[1] + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="' + (h[2] === 40 ? 0 : h[2] === 34 ? 1 : 2) + '"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="' + h[2] + '"/><w:szCs w:val="' + h[2] + '"/></w:rPr></w:style>').join('') + '</w:styles>';
    const footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + W_NS + '><w:p><w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';
    return {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
      'word/document.xml': document, 'word/styles.xml': styles, 'word/footer1.xml': footer
    };
  }
  // JSZip يُمرَّر من الخارج (المتصفح: window.JSZip بعد تحميل vendor/jszip.min.js)
  async function htmlToDocx(JSZip, html, opts) {
    const z = new JSZip(); const parts = docxParts(html, opts);
    Object.keys(parts).forEach(k => z.file(k, parts[k]));
    return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ====================== 7) استيراد docx ====================== */
  const wv = (n, name) => { const x = (n.children || []).find(c => c.tag === name); return x ? x : null; };
  const onv = e => e && !/^(0|false|off|none)$/i.test(e.attrs['w:val'] || 'true');
  function importRun(r, w, out) {
    const rp = wv(r, 'w:rPr'); const st = [];
    let b = false, i = false, u = false, s = false, va = '';
    if (rp) {
      b = onv(wv(rp, 'w:b')); i = onv(wv(rp, 'w:i')); s = onv(wv(rp, 'w:strike'));
      const ue = wv(rp, 'w:u'); u = !!ue && !/^none$/i.test(ue.attrs['w:val'] || 'single');
      const sz = wv(rp, 'w:sz'); if (sz && +sz.attrs['w:val'] > 0) st.push('font-size:' + (sz.attrs['w:val'] / 2) + 'pt');
      const v = wv(rp, 'w:vertAlign'); if (v) va = v.attrs['w:val'] === 'superscript' ? 'sup' : v.attrs['w:val'] === 'subscript' ? 'sub' : '';
    }
    let txt = '';
    r.children.forEach(c => {
      if (c.tag === 'w:t') txt += c.children.map(x => x.text || '').join('');
      else if (c.tag === 'w:tab') txt += '    ';
      else if (c.tag === 'w:noBreakHyphen') txt += '-';
      else if (c.tag === 'w:br') { if (txt) { out.push(wrapRun(txt, b, i, u, s, va, st)); txt = ''; } out.push(c.attrs['w:type'] === 'page' ? { pageBreak: true } : '<br>'); }
      else if (c.tag === 'w:drawing' || c.tag === 'w:pict' || c.tag === 'w:object') w.images++;
    });
    if (txt) out.push(wrapRun(txt, b, i, u, s, va, st));
  }
  function wrapRun(txt, b, i, u, s, va, st) {
    let h = escT(txt);
    if (va) h = '<' + va + '>' + h + '</' + va + '>'; if (b) h = '<b>' + h + '</b>'; if (i) h = '<i>' + h + '</i>'; if (u) h = '<u>' + h + '</u>'; if (s) h = '<s>' + h + '</s>';
    return st.length ? '<span style="' + st.join(';') + '">' + h + '</span>' : h;
  }
  function importInline(nodes, w, out) {
    nodes.forEach(n => {
      if (n.tag === 'w:r') importRun(n, w, out);
      else if (n.tag === 'w:hyperlink' || n.tag === 'w:ins' || n.tag === 'w:smartTag' || n.tag === 'w:fldSimple' || n.tag === 'w:sdt' || n.tag === 'w:sdtContent' || n.tag === 'w:customXml') importInline(n.children, w, out);
      else if (n.tag === 'w:del') w.deleted++;
    });
  }
  function importPara(p, w, out) {
    const pp = wv(p, 'w:pPr'); let bidi = false, jc = '', style = '', list = false;
    if (pp) {
      bidi = onv(wv(pp, 'w:bidi')); const j = wv(pp, 'w:jc'); jc = j ? j.attrs['w:val'] : '';
      const ps = wv(pp, 'w:pStyle'); style = ps ? ps.attrs['w:val'] || '' : ''; list = !!wv(pp, 'w:numPr');
    }
    const parts = []; importInline(p.children, w, parts);
    let html = ''; const pieces = [];
    parts.forEach(x => { if (x && x.pageBreak) { pieces.push(html); html = ''; pieces.push({ pageBreak: true }); } else html += x; });
    pieces.push(html);
    let align = '';
    if (jc === 'center') align = 'center'; else if (jc === 'both' || jc === 'distribute') align = 'justify';
    else if (jc === 'left' || jc === 'start') align = bidi ? 'right' : 'left';
    else if (jc === 'right' || jc === 'end') align = bidi ? 'left' : 'right';
    const plain = pieces.filter(x => typeof x === 'string').join('').replace(/<[^>]+>/g, '');
    if (!align && !bidi && !HAS_AR.test(plain)) align = 'left';
    const tag = /^Heading1$|^Title$/i.test(style) ? 'h1' : /^Heading2$/i.test(style) ? 'h2' : /^Heading[3-9]$/i.test(style) ? 'h3' : 'p';
    pieces.forEach(x => {
      if (typeof x !== 'string') { out.push('<div class="mk-pb" style="page-break-after:always"></div>'); return; }
      if (!x && pieces.length > 1) return;
      const st = align ? ' style="text-align:' + align + '"' : '';
      if (list && tag === 'p') out.push({ li: '<li' + st + '>' + x + '</li>' });
      else out.push('<' + tag + st + '>' + (x || '<br>') + '</' + tag + '>');
    });
  }
  function importBlocks(nodes, w, out) {
    nodes.forEach(n => {
      if (n.tag === 'w:p') importPara(n, w, out);
      else if (n.tag === 'w:tbl') {
        let h = '<table>';
        n.children.filter(r => r.tag === 'w:tr').forEach(r => {
          h += '<tr>';
          r.children.filter(c => c.tag === 'w:tc').forEach(tc => {
            const tp = wv(tc, 'w:tcPr'), gs = tp && wv(tp, 'w:gridSpan'), span = gs ? parseInt(gs.attrs['w:val'], 10) : 1;
            const inner = []; importBlocks(tc.children, w, inner);
            h += '<td' + (span > 1 ? ' colspan="' + span + '"' : '') + '>' + groupLists(inner).join('') + '</td>';
          }); h += '</tr>';
        });
        out.push(h + '</table>');
      } else if (n.tag === 'w:sdt' || n.tag === 'w:sdtContent') importBlocks(n.children, w, out);
    });
  }
  function groupLists(items) {
    const out = []; let cur = null;
    items.forEach(x => {
      if (x && x.li) { if (!cur) { cur = []; out.push(cur); } cur.push(x.li); }
      else { cur = null; out.push(x); }
    });
    return out.map(x => Array.isArray(x) ? '<ul>' + x.join('') + '</ul>' : x);
  }
  async function docxToHtml(JSZip, data) {
    const z = await JSZip.loadAsync(data);
    const f = z.file('word/document.xml'); if (!f) throw new Error('الملف ليس مستند Word صالحًا (docx).');
    const xml = await f.async('string');
    const w = { images: 0, deleted: 0 };
    const tree = parseMarkup(xml, true); const doc = (function find(ns) { for (const n of ns) { if (n.tag === 'w:body') return n; if (n.children) { const r = find(n.children); if (r) return r; } } return null; })(tree.children);
    if (!doc) throw new Error('تعذرت قراءة محتوى المستند.');
    const out = []; importBlocks(doc.children, w, out);
    const html = sanitize(groupLists(out).join(''));
    const warnings = [];
    if (w.images) warnings.push('تم تجاهل ' + w.images + ' صورة/شكل (المحرر لا يدعم الصور).');
    if (w.deleted) warnings.push('توجد تعديلات محذوفة (Track Changes) لم تُستورد.');
    if (Object.keys(z.files).some(k => /^word\/(header|footer)\d*\.xml$/.test(k))) warnings.push('الرؤوس والتذييلات لم تُستورد.');
    if (/<w:numPr>/.test(xml)) warnings.push('القوائم المرقمة قد تظهر كنقاط.');
    return { html, warnings };
  }

  /* ====================== 8) المسودات والنسخ (مجموعة drafts) ====================== */
  const MAX_VERSIONS = 15, MAX_HTML = 400000;
  const err = m => ({ ok: false, error: m });
  const logic = {
    isClient(ctx) { const a = ctx.account(); return !a || a.role === 'client'; },
    canEdit(ctx) { return !logic.isClient(ctx) && !ctx.officeReadOnly() && ctx.canWrite('drafts'); },
    list(ctx, kind) {
      return ctx.DB.get('drafts').filter(d => d && d.type === 'draft' && (!kind || d.kind === kind))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    get(ctx, id) { return ctx.DB.get('drafts').find(d => d && d.id === id && d.type === 'draft') || null; },
    versions(ctx, id) {
      return ctx.DB.get('drafts').filter(d => d && d.type === 'version' && d.draftId === id)
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    },
    save(ctx, v) {
      if (!logic.canEdit(ctx)) return err('ليست لديك صلاحية حفظ المسودات.');
      const title = String(v.title || '').trim().slice(0, 150); if (!title) return err('اكتب عنوان المسودة.');
      const html = sanitize(v.html || ''); if (html.length > MAX_HTML) return err('المستند كبير جدًا.');
      const acc = ctx.account(), now = ctx.now(); let list = ctx.DB.get('drafts');
      let head = v.id ? list.find(d => d && d.id === v.id && d.type === 'draft') : null;
      if (v.id && !head) return err('المسودة غير موجودة.');
      if (!head) {
        head = { id: ctx.uid(), type: 'draft', kind: v.kind || 'form', createdAt: now, createdById: acc.id, createdBy: acc.name };
        list = [head].concat(list);
      }
      head.title = title; head.html = html; head.caseId = v.caseId || ''; head.clientId = v.clientId || '';
      head.tpl = v.tpl || head.tpl || ''; head.updatedAt = now; head.updatedById = acc.id; head.updatedBy = acc.name;
      const vs = list.filter(d => d && d.type === 'version' && d.draftId === head.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
      if (!vs.length || vs[0].html !== html || vs[0].title !== title) {
        list.push({ id: ctx.uid(), type: 'version', draftId: head.id, title, html, at: now, byId: acc.id, by: acc.name, note: v.note || '' });
        const all = list.filter(d => d && d.type === 'version' && d.draftId === head.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
        const drop = new Set(all.slice(MAX_VERSIONS).map(d => d.id));
        if (drop.size) list = list.filter(d => !drop.has(d.id));
      }
      ctx.DB.set('drafts', list);
      if (ctx.log) ctx.log('حفظ مسودة: ' + title);
      return { ok: true, id: head.id };
    },
    remove(ctx, id) {
      if (!logic.canEdit(ctx)) return err('ليست لديك صلاحية الحذف.');
      const h = logic.get(ctx, id); if (!h) return err('المسودة غير موجودة.');
      ctx.DB.set('drafts', ctx.DB.get('drafts').filter(d => d && d.id !== id && d.draftId !== id));
      if (ctx.log) ctx.log('حذف مسودة: ' + h.title);
      return { ok: true };
    }
  };


  /* ====================== 8-ب) نسخ مرفقات docx (المرحلة F1) ======================
     كل حفظ ينتج سجل مرفق جديدًا (id جديد) مربوطًا بالأصل عبر versionOf؛ لا يُستبدل الأصل أبدًا.
     الحقول: versionOf, versionNo, baseId, editedBy, editedById, editedAt. (storagePath/sha256 تُضاف في المرحلة E) */
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const MAX_ATT_VERSIONS = 10;
  const EDIT_WARNING = 'تنبيه قبل التعديل داخل التطبيق:\n\nيحوّل التطبيق الملف إلى نص منسّق ثم يعيد بناءه كملف docx جديد، وقد تضيع تنسيقات معقدة مثل الرؤوس والتذييلات والجداول المركبة والصور والخطوط الخاصة وتتبع التغييرات.\n\nالملف الأصلي لا يتغير أبدًا؛ كل حفظ ينتج نسخة جديدة. وللحفاظ على التنسيق الكامل نزّل الأصل وعدّله في Word.\n\nهل تريد المتابعة بالتعديل داخل التطبيق؟';
  const att = {
    MAX_VERSIONS: MAX_ATT_VERSIONS, DOCX_MIME, EDIT_WARNING,
    isDocx(m) { return !!m && (/\.docx$/i.test(m.name || '') || m.type === DOCX_MIME); },
    rootId(m) { return m.versionOf || m.id; },
    isVersion(m) { return !!(m && m.versionOf); },
    denyReason(ctx) {
      if (logic.isClient(ctx)) return 'الموكل لا يستطيع تعديل المرفقات.';
      if (ctx.officeReadOnly()) return 'المكتب في وضع العرض فقط حاليًا، فلا يمكن التعديل.';
      if (!ctx.canWrite('attachments')) return 'ليست لديك صلاحية تعديل المرفقات.';
      return '';
    },
    canEdit(ctx) { return !att.denyReason(ctx); },
    chain(ctx, id) {
      const list = ctx.DB.get('attachments'), m = list.find(a => a && a.id === id); if (!m) return [];
      const rid = att.rootId(m);
      return list.filter(a => a && (a.id === rid || a.versionOf === rid))
        .sort((a, b) => (a.versionNo || 1) - (b.versionNo || 1) || String(a.editedAt || a.createdAt || '').localeCompare(String(b.editedAt || b.createdAt || '')));
    },
    baseName(name) { return String(name || 'مستند').replace(/\.docx$/i, '').replace(/\s*\(نسخة\s*\d+\)\s*$/, '').trim() || 'مستند'; },
    nextNo(ctx, id) { return att.chain(ctx, id).reduce((n, a) => Math.max(n, a.versionNo || 1), 1) + 1; },
    nextName(ctx, id) {
      const m = ctx.DB.get('attachments').find(a => a && a.id === id); if (!m) return '';
      const ch = att.chain(ctx, id), root = ch.find(a => !a.versionOf) || m;
      return att.baseName(root.name) + ' (نسخة ' + att.nextNo(ctx, id) + ').docx';
    },
    addVersion(ctx, v) {
      const why = att.denyReason(ctx); if (why) return err(why);
      let list = ctx.DB.get('attachments'); const src = list.find(a => a && a.id === v.sourceId);
      if (!src) return err('المرفق الأصلي غير موجود.');
      if (!att.isDocx(src)) return err('التعديل متاح لملفات Word بصيغة docx فقط.');
      if (!v.id) return err('معرّف النسخة مفقود.');
      const rid = att.rootId(src), acc = ctx.account(), now = ctx.now(), name = att.nextName(ctx, v.sourceId), no = att.nextNo(ctx, v.sourceId);
      const meta = { id: v.id, caseId: src.caseId == null ? null : src.caseId, clientId: src.clientId == null ? null : src.clientId, name, type: DOCX_MIME, size: v.size || 0, createdAt: now,
        versionOf: rid, versionNo: no, baseId: src.id, editedById: acc.id, editedBy: acc.name, editedAt: now };
      list = [meta].concat(list);
      const vs = list.filter(a => a && a.versionOf === rid).sort((a, b) => (a.versionNo || 1) - (b.versionNo || 1) || String(a.editedAt || '').localeCompare(String(b.editedAt || '')));
      const dropIds = vs.length > MAX_ATT_VERSIONS ? vs.slice(0, vs.length - MAX_ATT_VERSIONS).map(a => a.id) : [];
      if (dropIds.length) { const dz = new Set(dropIds); list = list.filter(a => !dz.has(a.id)); }
      ctx.DB.set('attachments', list);
      if (ctx.log) ctx.log('حفظ نسخة مرفق: ' + name);
      return { ok: true, id: v.id, meta, dropIds };
    },
    // هل يجوز حذف هذا السجل؟ الأصل الذي له نسخ لا يُحذف قبل نسخه.
    canDelete(ctx, id) {
      const m = ctx.DB.get('attachments').find(a => a && a.id === id); if (!m) return err('المرفق غير موجود.');
      if (!att.isVersion(m) && ctx.DB.get('attachments').some(a => a && a.versionOf === id)) return err('لا يمكن حذف الملف الأصلي وله نسخ معدّلة. احذف النسخ أولًا.');
      return { ok: true };
    },
    // ids كل نسخ ملف أصلي (للحذف مع صاحبه: مستند/توكيل/قضية)
    versionIds(ctx, rootId) { return ctx.DB.get('attachments').filter(a => a && a.versionOf === rootId).map(a => a.id); },
    warnedHas(ctx, rid) { try { return !!(ctx.warned && ctx.warned.has(rid)); } catch (e) { return false; } },
    warnedAdd(ctx, rid) { try { if (ctx.warned) ctx.warned.add(rid); } catch (e) { } }
  };

  /* ====================== 9) الواجهة (متصفح فقط) ====================== */
  const ui = {};
  let S = null;            // حالة المحرر المفتوح
  let savedRange = null;
  let lhDraft = null;      // حالة خيار الترويسة قبل دخول وضع المرفق
  const $ = id => document.getElementById(id);
  const E = s => escT(s == null ? '' : s);
  const fmtAt = iso => { try { return iso ? new Date(iso).toLocaleString('ar-EG') : ''; } catch (e) { return ''; } };
  const say = m => { try { if (typeof toast === 'function') toast(m); else alert(m); } catch (e) { alert(m); } };

  function browserCtx() {
    const acc = () => (typeof dqCurrentAccount !== 'undefined' ? dqCurrentAccount : null);
    return {
      DB: DB, account: acc,
      canWrite: c => (root.MK && root.MK.canWrite ? root.MK.canWrite(c) : true),
      officeReadOnly: () => { try { return !!(root.MK && root.MK.subState && ['readonly', 'suspended'].includes(root.MK.subState())); } catch (e) { return false; } },
      warned: {
        has: id => { try { return JSON.parse(localStorage.getItem('dq_att_edit_warned') || '[]').indexOf(id) >= 0; } catch (e) { return false; } },
        add: id => { try { const a = JSON.parse(localStorage.getItem('dq_att_edit_warned') || '[]'); if (a.indexOf(id) < 0) { a.push(id); localStorage.setItem('dq_att_edit_warned', JSON.stringify(a.slice(-500))); } } catch (e) { } }
      },
      uid: () => DB.uid(), now: () => new Date().toISOString(), today: () => new Date(),
      officeProfile: () => (typeof dqOfficeProfile === 'function' ? dqOfficeProfile() : {}),
      log: op => {
        const a = acc(); if (!a) return;
        try {
          const lg = JSON.parse(localStorage.getItem('dq_activity_log') || '[]');
          lg.unshift({ id: DB.uid(), at: new Date().toISOString(), accountId: a.id, accountName: a.name, role: a.role, section: 'editor', operation: op });
          localStorage.setItem('dq_activity_log', JSON.stringify(lg.slice(0, 1000)));
        } catch (e) { }
      }
    };
  }
  function loadJSZip() {
    if (root.JSZip) return Promise.resolve(root.JSZip);
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/jszip.min.js';
      s.onload = () => (root.JSZip ? res(root.JSZip) : rej(new Error('jszip')));
      s.onerror = () => rej(new Error('تعذر تحميل مكتبة الملفات. افتح التطبيق مرة واحدة متصلًا بالإنترنت ثم أعد المحاولة.'));
      document.head.appendChild(s);
    });
  }
  const CSS = '.mke-overlay{position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:none;align-items:stretch;justify-content:center}' +
    '.mke-overlay.show{display:flex}.mke-box{background:var(--bg,#f4f6f9);color:var(--text,#111);width:min(1000px,100%);display:flex;flex-direction:column;height:100dvh}' +
    '.mke-top{display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border,#ddd);background:var(--card,#fff)}' +
    '.mke-top input{flex:1;min-width:0;padding:8px;border:1px solid var(--border,#ccc);border-radius:8px;font:inherit;background:var(--bg,#fff);color:inherit}' +
    '.mke-tb{display:flex;gap:4px;flex-wrap:nowrap;overflow-x:auto;padding:6px 8px;background:var(--card,#fff);border-bottom:1px solid var(--border,#ddd);-webkit-overflow-scrolling:touch}' +
    '.mke-tb button,.mke-tb select,.mke-row button,.mke-top button{min-height:36px;min-width:36px;padding:4px 9px;border:1px solid var(--border,#ccc);border-radius:7px;background:var(--bg,#fff);color:inherit;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}' +
    '.mke-tb .sep{width:1px;background:var(--border,#ccc);margin:0 3px;flex:none}.mke-tb button.pri,.mke-top button.pri{background:var(--accent,#c99a3e);color:#fff;border-color:transparent}' +
    '.mke-row{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;align-items:center;padding:6px 10px;-webkit-overflow-scrolling:touch;background:var(--card,#fff);border-bottom:1px solid var(--border,#ddd);font-size:13px}' +
    '.mke-row>*{flex:none}.mke-row select{min-height:34px;max-width:46vw;border:1px solid var(--border,#ccc);border-radius:7px;background:var(--bg,#fff);color:inherit;font:inherit;font-size:13px}' +
    '.mke-scroll{flex:1;overflow:auto;padding:14px 8px;-webkit-overflow-scrolling:touch}' +
    '.mke-page{background:#fff;color:#000;width:min(210mm,100%);min-height:297mm;box-sizing:border-box;padding:18mm 16mm;margin:0 auto;box-shadow:0 2px 12px rgba(0,0,0,.18);direction:rtl;text-align:right;' +
    "font:14pt/1.9 'Traditional Arabic','Simplified Arabic',Tahoma,'Noto Naskh Arabic',Arial,sans-serif;outline:none;overflow-wrap:anywhere}" +
    '@media(max-width:700px){.mke-page{padding:14px 12px;min-height:60vh}}' +
    '.mke-page table{border-collapse:collapse;width:100%}.mke-page td,.mke-page th{border:1px solid #000;padding:4px 6px;min-width:30px}' +
    '.mke-page .mk-ph{background:#fff3b0;border-radius:3px;padding:0 2px}.mke-page .mk-pb{border-top:2px dashed #999;margin:18px 0;height:0;position:relative}' +
    ".mke-page .mk-pb::after{content:'فاصل صفحة';position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:#fff;color:#888;font:11px Tahoma;padding:0 8px}" +
    '.mke-page h1{font-size:20pt}.mke-page h2{font-size:17pt}.mke-page h3{font-size:15pt}.mke-page p{margin:0 0 4pt}' +
    '.mke-status{padding:6px 12px;font-size:12px;color:var(--text-muted,#666);background:var(--card,#fff);border-top:1px solid var(--border,#ddd);display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap}' +
    '.mke-vers{position:absolute;top:96px;left:8px;right:8px;max-width:420px;max-height:50vh;overflow:auto;background:var(--card,#fff);border:1px solid var(--border,#ccc);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);z-index:3;padding:8px;display:none}' +
    '.mke-vers div{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--border,#eee);font-size:13px}';

  function ensureModal() {
    if ($('mkEditorModal')) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const ph = PLACEHOLDERS.map(p => '<option value="' + p[0] + '">' + p[1] + '</option>').join('');
    const m = document.createElement('div'); m.id = 'mkEditorModal'; m.className = 'mke-overlay';
    m.innerHTML = '<div class="mke-box" dir="rtl">' +
      '<div class="mke-top"><input id="mkeTitle" placeholder="عنوان المستند" maxlength="150"><button class="pri" id="mkeSave" onclick="DQ_EDITOR.ui.save()">💾 حفظ</button><button onclick="DQ_EDITOR.ui.close()" aria-label="إغلاق">✕</button></div>' +
      '<div class="mke-tb" id="mkeTb">' +
      '<button data-c="undo" title="تراجع">↶</button><button data-c="redo" title="إعادة">↷</button><span class="sep"></span>' +
      '<select id="mkeBlock" title="النمط"><option value="p">نص</option><option value="h1">عنوان 1</option><option value="h2">عنوان 2</option><option value="h3">عنوان 3</option></select>' +
      '<select id="mkeFont" title="الخط"><option value="">الخط</option><option>Tahoma</option><option>Arial</option><option>Traditional Arabic</option><option>Simplified Arabic</option></select>' +
      '<select id="mkeSize" title="الحجم"><option value="">الحجم</option>' + [10, 12, 14, 16, 18, 20, 24, 28, 36].map(n => '<option value="' + n + '">' + n + '</option>').join('') + '</select><span class="sep"></span>' +
      '<button data-c="bold"><b>غ</b></button><button data-c="italic"><i>م</i></button><button data-c="underline"><u>س</u></button><span class="sep"></span>' +
      '<button data-c="justifyRight" title="يمين">⇥</button><button data-c="justifyCenter" title="وسط">≡</button><button data-c="justifyLeft" title="يسار">⇤</button><button data-c="justifyFull" title="ضبط">☰</button><span class="sep"></span>' +
      '<button data-c="insertUnorderedList" title="نقاط">• ≡</button><button data-c="insertOrderedList" title="ترقيم">1.</button><button data-a="table" title="جدول">▦</button><button data-a="pagebreak" title="فاصل صفحة">⏎ صفحة</button><span class="sep"></span>' +
      '<select id="mkePh" title="إدراج خانة"><option value="">+ خانة</option>' + ph + '</select></div>' +
      '<div class="mke-row" id="mkeRow"><span>تعبئة من:</span><select id="mkeCase"></select><select id="mkeClient"></select>' +
      '<button data-a="fill" class="pri">تعبئة الخانات</button><button data-a="unfill" id="mkeUnfill" style="display:none">↩ تراجع التعبئة</button></div>' +
      '<div class="mke-row"><button data-a="print">🖨️ طباعة A4</button><button data-a="export">⬇️ تصدير Word</button><button data-a="import">⬆️ استيراد Word</button><button data-a="versions" id="mkeVerBtn">🕘 النسخ</button>' +
      '<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="mkeLH" checked> ترويسة المكتب</label>' +
      '<input type="file" id="mkeFile" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="display:none"></div>' +
      '<div class="mke-vers" id="mkeVers"></div>' +
      '<div class="mke-scroll"><div class="mke-page" id="mkePage" contenteditable="true" spellcheck="false"></div></div>' +
      '<div class="mke-status"><span id="mkeInfo"></span><span id="mkeMissing"></span></div></div>';
    document.body.appendChild(m);

    const page = $('mkePage');
    $('mkeTb').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    $('mkeRow').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    m.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c) { cmd(b.dataset.c); }
      else if (b.dataset.a && ui[b.dataset.a]) ui[b.dataset.a]();
    });
    $('mkeBlock').onchange = e => { cmd('formatBlock', e.target.value === 'p' ? '<p>' : '<' + e.target.value + '>'); e.target.value = 'p'; };
    $('mkeFont').onchange = e => { if (e.target.value) cmd('fontName', e.target.value); e.target.value = ''; };
    $('mkeSize').onchange = e => { const v = e.target.value; e.target.value = ''; if (!v) return; cmd('fontSize', '7'); fixFonts(v); };
    $('mkePh').onchange = e => { const k = e.target.value; e.target.value = ''; if (k) cmd('insertHTML', '<span class="mk-ph">{{' + k + '}}</span>&nbsp;'); };
    $('mkeCase').onchange = () => { const c = ctxCase(); if (c) $('mkeClient').value = c.clientId || ''; };
    page.addEventListener('input', () => { if (S) { S.dirty = true; } updateStatus(); });
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection(); if (sel.rangeCount && page.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
    });
    $('mkeFile').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      if (S && !S.readOnly && htmlToText($('mkePage').innerHTML) && !confirm('سيُستبدل محتوى المستند الحالي بمحتوى ملف Word. متابعة؟')) return;
      try { const r = await ui.readDocx(f); setHtml(r.html); if (S && !S.readOnly) S.dirty = true; if (r.warnings.length) alert('تم الاستيراد مع ملاحظات:\n• ' + r.warnings.join('\n• ')); else say('تم استيراد الملف'); }
      catch (err) { alert(err.message || 'تعذر استيراد الملف'); }
    };
  }
  function restore() {
    const page = $('mkePage'); page.focus();
    if (savedRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
  }
  function cmd(name, val) {
    if (!S || S.readOnly) return;
    restore(); try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { }
    document.execCommand(name, false, val === undefined ? null : val);
    S.dirty = true; updateStatus();
  }
  function fixFonts(pt) {
    $('mkePage').querySelectorAll('font[size="7"]').forEach(f => {
      const sp = document.createElement('span'); sp.style.fontSize = pt + 'pt';
      while (f.firstChild) sp.appendChild(f.firstChild); f.replaceWith(sp);
    });
  }
  function setHtml(html) { $('mkePage').innerHTML = wrapTokens(sanitize(html)) || '<p><br></p>'; savedRange = null; updateStatus(); }
  function getHtml() { return sanitize($('mkePage').innerHTML); }
  function updateStatus() {
    if (!S) return; const html = getHtml(), miss = findTokens(html);
    $('mkeMissing').textContent = miss.length ? 'خانات بدون بيانات: ' + miss.length + ' (' + miss.slice(0, 4).map(k => k.replace(/_/g, ' ')).join('، ') + (miss.length > 4 ? '…' : '') + ')' : 'لا توجد خانات ناقصة';
    $('mkeInfo').textContent = S.readOnly ? 'عرض فقط' : (S.mode === 'attachment' ? (S.dirty ? 'تعديلات غير محفوظة — ستُحفظ كنسخة جديدة' : 'تعديل مرفق — الحفظ ينتج نسخة جديدة') : (S.dirty ? 'تعديلات غير محفوظة' : (S.id ? 'محفوظ' : 'لم يُحفظ بعد')));
  }
  function ctxCase() { const id = $('mkeCase').value; return id ? DB.get('cases').find(c => c.id === id) : null; }
  function fillSelectors(sel) {
    const cases = DB.get('cases'), clients = DB.get('clients'), nm = id => (clients.find(c => c.id === id) || {}).name || '';
    $('mkeCase').innerHTML = '<option value="">— القضية —</option>' + cases.map(c => '<option value="' + E(c.id) + '">' + E((c.numberPending || !c.number ? 'بدون رقم' : c.number) + ' — ' + (c.subject || '') + (nm(c.clientId) ? ' (' + nm(c.clientId) + ')' : '')) + '</option>').join('');
    $('mkeClient').innerHTML = '<option value="">— الموكل —</option>' + clients.map(c => '<option value="' + E(c.id) + '">' + E(c.name) + '</option>').join('');
    $('mkeCase').value = sel.caseId || ''; $('mkeClient').value = sel.clientId || '';
  }

  ui.open = function (o) {
    o = o || {}; ensureModal(); const ctx = browserCtx();
    const attMode = o.mode === 'attachment';
    let d = !attMode && o.draftId ? logic.get(ctx, o.draftId) : null;
    if (!attMode && o.draftId && !d) return alert('المسودة غير موجودة.');
    const canEdit = attMode ? att.canEdit(ctx) : logic.canEdit(ctx);
    S = { id: d ? d.id : '', kind: d ? d.kind : (o.kind || 'form'), tpl: d ? d.tpl : (o.tpl || ''), dirty: !d && !!(o.text || o.html), readOnly: !canEdit, undoFill: null, mode: attMode ? 'attachment' : 'draft', attId: attMode ? o.attId : '' };
    // وضع المرفق: لا تعبئة خانات ولا ترويسة افتراضيًا (حتى لا تتكرر مع التعديل المتكرر)، والعنوان للقراءة فقط
    if (attMode) { if (lhDraft === null) lhDraft = $('mkeLH').checked; $('mkeLH').checked = false; }
    else if (lhDraft !== null) { $('mkeLH').checked = lhDraft; lhDraft = null; }
    $('mkeRow').style.display = attMode ? 'none' : '';
    $('mkeTitle').value = d ? d.title : (o.title || 'مستند جديد'); $('mkeTitle').disabled = !canEdit || attMode;
    const sel = { caseId: d ? d.caseId : (o.caseId || ''), clientId: d ? d.clientId : (o.clientId || '') };
    fillSelectors(sel);
    const html = d ? d.html : (o.html || (o.text ? textToHtml(o.text, { titleFirst: o.titleFirst !== false }) : ''));
    setHtml(html);
    $('mkePage').contentEditable = canEdit ? 'true' : 'false';
    ['mkeTb', 'mkeRow'].forEach(id => { $(id).querySelectorAll('button[data-c],button[data-a="table"],button[data-a="pagebreak"],button[data-a="fill"],button[data-a="import"],select').forEach(b => { if (id === 'mkeRow' && b.tagName === 'SELECT') return; b.disabled = !canEdit; }); });
    $('mkeSave').style.display = canEdit ? '' : 'none'; $('mkeUnfill').style.display = 'none'; $('mkeVers').style.display = 'none';
    if (!canEdit) say('لا تملك صلاحية التعديل — المستند للعرض والطباعة فقط.');
    if (!d && !attMode && (sel.caseId || sel.clientId)) ui.fill(true);
    if (attMode) {
      const n = att.chain(ctx, S.attId).length;
      $('mkeVerBtn').style.display = ''; $('mkeVerBtn').dataset.n = n; $('mkeVerBtn').textContent = '🕘 سجل النسخ (' + n + ')';
    } else {
      $('mkeVerBtn').style.display = S.id ? '' : 'none';
      $('mkeVerBtn').dataset.n = S.id ? logic.versions(ctx, S.id).length : 0;
      $('mkeVerBtn').textContent = '🕘 النسخ' + (S.id ? ' (' + $('mkeVerBtn').dataset.n + ')' : '');
    }
    $('mkEditorModal').classList.add('show'); updateStatus();
    if (canEdit) setTimeout(() => $('mkePage').focus(), 50);
  };
  ui.close = function () {
    if (S && S.dirty && !S.readOnly && !confirm('توجد تعديلات غير محفوظة. هل تريد الإغلاق دون حفظ؟')) return;
    $('mkEditorModal').classList.remove('show'); S = null;
  };
  ui.save = function () {
    if (!S || S.readOnly) return;
    if (S.mode === 'attachment') return ui.saveAtt();
    const ctx = browserCtx();
    const r = logic.save(ctx, { id: S.id, kind: S.kind, title: $('mkeTitle').value, html: getHtml(), caseId: $('mkeCase').value, clientId: $('mkeClient').value, tpl: S.tpl });
    if (!r.ok) return alert(r.error);
    S.id = r.id; S.dirty = false; say('تم حفظ المسودة'); updateStatus(); ui.refreshLists();
    const n = logic.versions(ctx, S.id).length; $('mkeVerBtn').style.display = ''; $('mkeVerBtn').textContent = '🕘 النسخ (' + n + ')';
  };
  ui.fill = function (silent) {
    if (!S || S.readOnly) return;
    const ctx = browserCtx(); const sel = { caseId: $('mkeCase').value, clientId: $('mkeClient').value };
    if (!sel.caseId && !sel.clientId) return silent === true ? null : alert('اختر القضية أو الموكل أولًا.');
    const before = $('mkePage').innerHTML, r = fill(getHtml(), valuesFor(ctx, sel));
    if (!r.filled.length) return silent === true ? null : alert('لا توجد خانات يمكن تعبئتها بهذه البيانات.');
    S.undoFill = before; setHtml(r.html); S.dirty = true; $('mkeUnfill').style.display = ''; updateStatus();
    say('تمت تعبئة ' + r.filled.length + ' خانة' + (r.missing.length ? ' — وبقي ' + r.missing.length + ' بدون بيانات' : ''));
  };
  ui.unfill = function () { if (S && S.undoFill != null) { $('mkePage').innerHTML = S.undoFill; S.undoFill = null; $('mkeUnfill').style.display = 'none'; updateStatus(); } };
  ui.table = function () {
    if (!S || S.readOnly) return;
    const r = parseInt(prompt('عدد الصفوف؟', '3'), 10), c = parseInt(prompt('عدد الأعمدة؟', '3'), 10);
    if (!(r > 0 && r <= 40 && c > 0 && c <= 10)) return;
    const row = '<tr>' + '<td><br></td>'.repeat(c) + '</tr>';
    cmd('insertHTML', '<table>' + row.repeat(r) + '</table><p><br></p>');
  };
  ui.pagebreak = function () { cmd('insertHTML', '<div class="mk-pb" style="page-break-after:always"></div><p><br></p>'); };
  ui.print = function () {
    if (!S) return; const html = getHtml(), miss = findTokens(html);
    if (miss.length && !confirm('بقيت ' + miss.length + ' خانة بدون بيانات وستُطبع كما هي ({{...}}). متابعة الطباعة؟')) return;
    const lh = $('mkeLH').checked;
    const doc = printDocument({ title: $('mkeTitle').value, bodyHtml: html,
      headerHtml: lh && typeof dqPrintHeaderHTML === 'function' ? dqPrintHeaderHTML() : '', footerHtml: lh && typeof dqPrintFooterHTML === 'function' ? dqPrintFooterHTML() : '' });
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f); const d = f.contentWindow.document; d.open(); d.write(doc); d.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { alert('تعذرت الطباعة من هذا المتصفح.'); } setTimeout(() => f.remove(), 120000); }, 400);
  };
  ui.export = async function () {
    if (!S) return;
    try {
      const Z = await loadJSZip(), off = browserCtx().officeProfile();
      const u8 = await htmlToDocx(Z, getHtml(), { letterhead: $('mkeLH').checked ? off : null });
      const blob = new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (String($('mkeTitle').value || 'مستند').replace(/[\\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'مستند') + '.docx';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      say('تم تصدير ملف Word');
    } catch (e) { alert(e.message || 'تعذر التصدير'); }
  };
  ui.import = function () { if (S && !S.readOnly) $('mkeFile').click(); };
  ui.readDocx = async function (file) {
    if (file.size > 15 * 1024 * 1024) throw new Error('ملف Word كبير جدًا (الحد 15 ميجا).');
    const Z = await loadJSZip(); return docxToHtml(Z, await file.arrayBuffer());
  };
  // استيراد ملف Word كمسودة جديدة (من صفحة النماذج/الدعاوى)
  ui.importAsDraft = async function (input, kind) {
    const f = input.files && input.files[0]; input.value = ''; if (!f) return;
    try {
      const r = await ui.readDocx(f);
      ui.open({ kind: kind || 'form', title: f.name.replace(/\.docx$/i, ''), html: r.html, tpl: 'docx' });
      if (r.warnings.length) setTimeout(() => alert('تم الاستيراد مع ملاحظات:\n• ' + r.warnings.join('\n• ')), 100);
    } catch (e) { alert(e.message || 'تعذر استيراد الملف'); }
  };
  ui.versions = function () {
    if (S && S.mode === 'attachment') return ui.attVersions();
    if (!S || !S.id) return; const box = $('mkeVers');
    if (box.style.display === 'block') { box.style.display = 'none'; return; }
    const vs = logic.versions(browserCtx(), S.id);
    box.innerHTML = vs.length ? vs.map(v => '<div><span>' + E(fmtAt(v.at)) + ' — ' + E(v.by || '') + '</span><button onclick="DQ_EDITOR.ui.restoreVersion(\'' + E(v.id) + '\')">استرجاع</button></div>').join('') : '<div>لا توجد نسخ</div>';
    box.style.display = 'block';
  };

  /* ---- تعديل مرفقات docx بالنسخ (F1) ---- */
  // فتح مرفق docx للتعديل (من عارض المرفقات أو قائمة المرفقات)
  ui.openAttachment = async function (id) {
    const ctx = browserCtx(), m = DB.get('attachments').find(a => a.id === id);
    if (!m) return alert('المرفق غير موجود.');
    if (!att.isDocx(m)) return alert('التعديل متاح لملفات Word بصيغة docx فقط.');
    const why = att.denyReason(ctx); if (why) return alert(why);
    let blob = null; try { blob = await FileStore.get(id); } catch (e) { }
    if (!blob) return alert('ملف هذه النسخة غير موجود على هذا الجهاز، فلا يمكن تعديله هنا. الملفات لا تتزامن بين الأجهزة بعد (بياناتها الوصفية فقط). افتح التطبيق على الجهاز الذي رُفع منه، أو استورد المرفقات من الإعدادات.');
    const rid = att.rootId(m);
    if (!att.warnedHas(ctx, rid)) { if (!confirm(EDIT_WARNING)) return; att.warnedAdd(ctx, rid); }
    let r; try { const Z = await loadJSZip(); r = await docxToHtml(Z, await blob.arrayBuffer()); } catch (e) { return alert(e.message || 'تعذر قراءة الملف'); }
    if (typeof closeDocumentViewer === 'function') { try { closeDocumentViewer(); } catch (e) { } }
    ui.open({ mode: 'attachment', attId: id, title: att.nextName(ctx, id).replace(/\.docx$/i, ''), html: r.html });
    if (r.warnings.length) setTimeout(() => alert('تم فتح الملف مع ملاحظات:\n• ' + r.warnings.join('\n• ')), 100);
  };
  ui.saveAtt = async function () {
    if (!S || S.readOnly || S.busy || S.mode !== 'attachment') return;
    const ctx = browserCtx(); S.busy = true;
    try {
      const why = att.denyReason(ctx); if (why) return alert(why);
      const html = getHtml(); if (html.length > MAX_HTML) return alert('المستند كبير جدًا.');
      const Z = await loadJSZip();
      const u8 = await htmlToDocx(Z, html, { letterhead: $('mkeLH').checked ? ctx.officeProfile() : null });
      const blob = new Blob([u8], { type: DOCX_MIME });
      if (blob.size > 20 * 1024 * 1024) return alert('الملف الناتج أكبر من 20 ميجا.');
      const id = ctx.uid(); await FileStore.put(id, blob);
      const r = att.addVersion(ctx, { sourceId: S.attId, id, size: blob.size });
      if (!r.ok) { try { await FileStore.del(id); } catch (e) { } return alert(r.error); }
      (r.dropIds || []).forEach(d => { try { FileStore.del(d).catch(() => { }); } catch (e) { } });
      const meta = r.meta; S.dirty = false; ui.close(); say('تم حفظ ' + meta.name + (r.dropIds.length ? ' (حُذفت أقدم نسخة لبلوغ الحد ' + MAX_ATT_VERSIONS + ')' : ''));
      if (typeof dqAfterAttachmentVersion === 'function') dqAfterAttachmentVersion(meta);
    } catch (e) { alert('تعذر حفظ النسخة (قد تكون مساحة المتصفح ممتلئة).'); }
    finally { if (S) S.busy = false; }
  };
  ui.attVersions = function () {
    if (!S || S.mode !== 'attachment') return; const box = $('mkeVers');
    if (box.style.display === 'block') { box.style.display = 'none'; return; }
    const ctx = browserCtx(), ch = att.chain(ctx, S.attId);
    box.innerHTML = ch.map(a => '<div><span>' + (a.versionOf ? 'نسخة ' + (a.versionNo || '') : 'الأصل') + ' — ' + E(fmtAt(a.editedAt || a.createdAt)) + (a.editedBy ? ' — ' + E(a.editedBy) : '') + ' — ' + Math.max(1, Math.round((a.size || 0) / 1024)) + ' ك.ب' + (a.id === S.attId ? ' ✔ (الحالية)' : '') + '</span>' +
      '<button onclick="DQ_EDITOR.ui.attLoad(\'' + E(a.id) + '\')">تعديل منها</button></div>').join('');
    box.style.display = 'block';
  };
  // تحميل محتوى نسخة أخرى داخل المحرر لتكون أساس النسخة القادمة
  ui.attLoad = async function (id) {
    if (!S || S.mode !== 'attachment' || S.readOnly) return;
    if (id === S.attId) { $('mkeVers').style.display = 'none'; return; }
    if (S.dirty && !confirm('ستُستبدل تعديلاتك غير المحفوظة بمحتوى هذه النسخة. متابعة؟')) return;
    let blob = null; try { blob = await FileStore.get(id); } catch (e) { }
    if (!blob) return alert('ملف هذه النسخة غير موجود على هذا الجهاز.');
    try {
      const Z = await loadJSZip(), r = await docxToHtml(Z, await blob.arrayBuffer());
      setHtml(r.html); S.attId = id; S.dirty = false; $('mkeVers').style.display = 'none'; updateStatus();
      $('mkeTitle').value = att.nextName(browserCtx(), id).replace(/\.docx$/i, '');
      if (r.warnings.length) alert('تم فتح النسخة مع ملاحظات:\n• ' + r.warnings.join('\n• ')); else say('تم تحميل النسخة — الحفظ ينتج نسخة جديدة');
    } catch (e) { alert(e.message || 'تعذر قراءة الملف'); }
  };
  ui.canEditAttachment = function () { try { return att.canEdit(browserCtx()); } catch (e) { return false; } };
  ui.restoreVersion = function (id) {
    if (!S || S.readOnly) return; const v = logic.versions(browserCtx(), S.id).find(x => x.id === id); if (!v) return;
    if (S.dirty && !confirm('ستُستبدل تعديلاتك غير المحفوظة بهذه النسخة. متابعة؟')) return;
    setHtml(v.html); $('mkeTitle').value = v.title || $('mkeTitle').value; S.dirty = true; $('mkeVers').style.display = 'none'; updateStatus();
    say('تم استرجاع النسخة — اضغط حفظ لتثبيتها كنسخة جديدة');
  };
  ui.refreshLists = function () {
    [['formDrafts', 'form'], ['lawsuitDrafts', 'lawsuit']].forEach(p => {
      const el = $(p[0]); if (!el) return; const ctx = browserCtx(), list = logic.list(ctx, p[1]), can = logic.canEdit(ctx);
      const cs = DB.get('cases');
      el.innerHTML = '<h4 style="margin:14px 0 8px;font-size:15px;">📝 مسوداتي (' + list.length + ')</h4>' + (list.length ? list.map(d => {
        const c = cs.find(x => x.id === d.caseId);
        return '<div class="note-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;"><span><strong style="cursor:pointer;color:var(--accent);" onclick="DQ_EDITOR.ui.open({draftId:\'' + E(d.id) + '\'})">' + E(d.title) + '</strong>' +
          '<span style="font-size:12px;color:var(--text-muted);"> — ' + E(fmtAt(d.updatedAt)) + (d.updatedBy ? ' — ' + E(d.updatedBy) : '') + (c ? ' — ' + E(c.number || c.subject) : '') + '</span></span>' +
          (can ? '<button class="btn btn-danger btn-sm" onclick="DQ_EDITOR.ui.removeDraft(\'' + E(d.id) + '\')">×</button>' : '') + '</div>';
      }).join('') : '<p style="font-size:13px;color:var(--text-muted);">لا مسودات محفوظة بعد.</p>');
    });
  };
  ui.removeDraft = function (id) {
    if (!confirm('حذف المسودة وجميع نسخها؟')) return; const r = logic.remove(browserCtx(), id);
    if (!r.ok) return alert(r.error); ui.refreshLists();
  };

  const api = { parseMarkup, sanitize, wrapTokens, findTokens, fill, valuesFor, textToHtml, htmlToText, printDocument,
    htmlToDocx, docxToHtml, docxParts, logic, att, ui, PLACEHOLDERS, fmtDate, MAX_VERSIONS };
  root.DQ_EDITOR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
