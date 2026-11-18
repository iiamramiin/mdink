/* mdink — main application */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const IS_NL = typeof window.NL_PORT !== 'undefined';

  // ======================================================================
  // Platform layer: Neutralino (desktop) or plain browser (fallback / dev)
  // ======================================================================
  const P = {
    async init() { if (IS_NL) Neutralino.init(); },
    async readText(path) {
      if (IS_NL) return Neutralino.filesystem.readFile(path);
      const r = await fetch(path); if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.text();
    },
    async readBinary(path) { return Neutralino.filesystem.readBinaryFile(path); },
    async stat(path) {
      if (!IS_NL) return null;
      const s = await Neutralino.filesystem.getStats(path);
      return s.size + ':' + s.modifiedAt;
    },
    async get(key) {
      try {
        if (IS_NL) return JSON.parse(await Neutralino.storage.getData(key));
        const v = localStorage.getItem('mdink.' + key); return v == null ? null : JSON.parse(v);
      } catch (e) { return null; }
    },
    async set(key, val) {
      try {
        if (IS_NL) {
          if (val == null) await Neutralino.storage.removeData(key).catch(() => {});
          else await Neutralino.storage.setData(key, JSON.stringify(val));
        }
        else if (val == null) localStorage.removeItem('mdink.' + key);
        else localStorage.setItem('mdink.' + key, JSON.stringify(val));
      } catch (e) { console.warn('storage', e); }
    },
    setTitle(t) { document.title = t; if (IS_NL) Neutralino.window.setTitle(t).catch(() => {}); },
    openExternal(url) { if (IS_NL) Neutralino.os.open(url); else window.open(url, '_blank', 'noopener'); },
    async openDialog() {
      if (IS_NL) {
        const r = await Neutralino.os.showOpenDialog('Open Markdown file', {
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'txt'] }, { name: 'All files', extensions: ['*'] }]
        });
        return r && r[0] ? { path: r[0] } : null;
      }
      return new Promise((res) => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.md,.markdown,.mdown,.mkd,.mdx,.txt,text/markdown,text/plain';
        inp.onchange = async () => { const f = inp.files[0]; res(f ? { file: f } : null); };
        inp.click();
      });
    },
    startupFile() {
      if (IS_NL) {
        const a = (window.NL_ARGS || []).slice(1).find((x) => !x.startsWith('--'));
        if (!a) return null;
        return isAbsolute(a) ? a : joinPath(window.NL_CWD || '', a);
      }
      return new URLSearchParams(location.search).get('file');
    }
  };

  // ---------- path helpers (Windows / POSIX / URL) ----------
  function isAbsolute(p) { return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/'); }
  function isUrl(p) { return /^[a-z][a-z0-9+.-]*:\/\//i.test(p) && !/^[a-zA-Z]:[\\/]/.test(p); }
  function sepOf(p) { return p.includes('\\') && !p.includes('/') ? '\\' : (p.includes('\\') ? '\\' : '/'); }
  function dirname(p) { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i >= 0 ? p.slice(0, i) : ''; }
  function basename(p) { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return p.slice(i + 1); }
  function joinPath(base, rel) {
    if (isUrl(base)) return new URL(rel, base.endsWith('/') ? base : base + '/').href;
    if (isAbsolute(rel)) return rel;
    const sep = /^[a-zA-Z]:/.test(base) || base.includes('\\') ? '\\' : sepOf(base);
    const parts = base.split(/[\\/]/);
    for (const seg of rel.split(/[\\/]/)) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { if (parts.length > 1) parts.pop(); } else parts.push(seg);
    }
    return parts.join(sep);
  }
  function resolveRef(docPath, ref) {
    if (isUrl(docPath)) return new URL(ref, docPath).href;
    return joinPath(dirname(docPath), ref);
  }
  function fileUrlToPath(u) {
    let p = decodeURIComponent(u.replace(/^file:\/\/\/?/i, ''));
    if (/^[a-zA-Z]:/.test(p)) p = p.replace(/\//g, '\\');
    else if (!p.startsWith('/')) p = '/' + p;
    return p;
  }
  function hash(str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ======================================================================
  // State & settings
  // ======================================================================
  const DEFAULTS = {
    theme: 'light', font: 'auto', codeFont: 'auto', size: 16, lh: 1.7,
    paper: 'A4', zoom: 1, autoReload: true, printInk: true, sidebar: false
  };
  const PAPERS = { A4: ['210mm', '297mm'], Letter: ['8.5in', '11in'], Legal: ['8.5in', '14in'], A5: ['148mm', '210mm'] };
  let S = { ...DEFAULTS };
  let doc = null;            // { path, name, text, key, stamp }
  let history = [];          // back stack of paths
  let recent = [];
  const blobUrls = [];
  let renderSeq = 0;

  const el = {
    body: document.body, viewport: $('#viewport'), sizer: $('#sizer'), page: $('#page'), content: $('#content'),
    toc: $('#toc'), sidebar: $('#sidebar'), title: $('#doc-title'), stPath: $('#st-path'), stStats: $('#st-stats')
  };

  // ======================================================================
  // Lazy loaders
  // ======================================================================
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Cannot load ' + src));
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  function loadCss(href) {
    if (!loaded[href]) loaded[href] = new Promise((res) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = res; l.onerror = res;
      document.head.appendChild(l);
    });
    return loaded[href];
  }
  async function ensureKatex() {
    await Promise.all([loadScript('vendor/katex/katex.min.js'), loadCss('vendor/katex/katex.min.css')]);
    await loadScript('vendor/marked-katex.umd.js');
  }
  async function ensureMermaid() {
    await loadScript('vendor/mermaid.min.js');
  }

  // ======================================================================
  // Markdown rendering
  // ======================================================================
  let mdPlain = null, mdMath = null;
  function getMarked(math) {
    const make = () => {
      const m = new marked.Marked({ gfm: true, breaks: false });
      m.use(markedAlert());
      m.use(markedFootnote());
      return m;
    };
    if (math) {
      if (!mdMath) { mdMath = make(); mdMath.use(markedKatex({ throwOnError: false, output: 'htmlAndMathml' })); }
      return mdMath;
    }
    if (!mdPlain) mdPlain = make();
    return mdPlain;
  }

  const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
  const LTR_RE = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
  function firstStrongDir(text) {
    for (const ch of text) {
      if (RTL_RE.test(ch)) return 'rtl';
      if (LTR_RE.test(ch)) return 'ltr';
    }
    return null;
  }
  function slugify(text) {
    return text.toLowerCase().trim()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section';
  }

  async function renderDoc(opts = {}) {
    if (!doc) return;
    const seq = ++renderSeq;
    let src = doc.text.replace(/^﻿/, '');
    let front = '';
    const fm = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
    if (fm) { front = fm[1]; src = src.slice(fm[0].length); }

    const math = /\$|```\s*math/.test(src);
    if (math) { try { await ensureKatex(); } catch (e) { console.warn(e); } }
    const md = getMarked(math && !!window.markedKatex);
    let html;
    try { html = md.parse(src); } catch (e) { html = '<pre>' + esc(String(e)) + '</pre>'; }
    if (front) html = `<details class="front-matter"><summary>Front matter</summary><pre><code>${esc(front)}</code></pre></details>` + html;
    html = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'align'], FORBID_TAGS: ['form', 'object', 'embed', 'iframe'] });
    if (seq !== renderSeq) return;

    const keepScroll = opts.keepScroll ? el.viewport.scrollTop : 0;
    blobUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    el.content.innerHTML = html;
    decorate(el.content);
    resolveImages(el.content);
    await renderDiagrams(el.content);
    if (seq !== renderSeq) return;
    buildToc();
    updateStats();
    if (opts.reapplyInk) Ink.reapply(); else Ink.load(await P.get('ink_' + doc.key));
    el.viewport.scrollTop = keepScroll;
    if (opts.anchor) scrollToId(opts.anchor);
    sizeSizer();
  }

  function decorate(root) {
    // headings: ids for anchors + outline
    const used = new Set();
    $$('h1,h2,h3,h4,h5,h6', root).forEach((h) => {
      let id = h.id || slugify(h.textContent), base = id, i = 1;
      while (used.has(id) || (document.getElementById(id) && document.getElementById(id) !== h)) id = base + '-' + i++;
      used.add(id); h.id = id;
    });
    // bidi: let each block pick its own direction (Persian / Arabic / Hebrew friendly)
    $$('p,h1,h2,h3,h4,h5,h6,li,td,th,dt,dd,summary,.markdown-alert-title', root).forEach((n) => n.setAttribute('dir', 'auto'));
    $$('ul,ol,blockquote,table,.markdown-alert,details', root).forEach((n) => {
      const d = firstStrongDir(n.textContent); if (d) n.setAttribute('dir', d);
    });
    // task lists
    $$('li > input[type=checkbox]', root).forEach((c) => c.parentElement.classList.add('task'));
    // tables: scroll wrapper
    $$('table', root).forEach((t) => {
      const w = document.createElement('div'); w.className = 'table-wrap';
      if (t.getAttribute('dir')) w.setAttribute('dir', t.getAttribute('dir'));
      t.parentNode.insertBefore(w, t); w.appendChild(t);
    });
    // code blocks
    $$('pre > code', root).forEach((code) => {
      const pre = code.parentElement;
      const m = (code.className || '').match(/language-([\w+#.-]+)/);
      const lang = m ? m[1].toLowerCase() : '';
      if (lang === 'mermaid') {
        const d = document.createElement('div');
        d.className = 'mermaid-block pending'; d.dataset.src = code.textContent; d.textContent = 'Rendering diagram…';
        pre.replaceWith(d); return;
      }
      if ((lang === 'math' || lang === 'latex' || lang === 'tex') && window.katex && lang === 'math') {
        const d = document.createElement('div'); d.className = 'math-block';
        try { katex.render(code.textContent, d, { displayMode: true, throwOnError: false }); pre.replaceWith(d); return; } catch (e) { /* fall through */ }
      }
      if (lang && window.hljs && hljs.getLanguage(lang)) { try { hljs.highlightElement(code); } catch (e) { /* ignore */ } }
      const wrap = document.createElement('div'); wrap.className = 'code-block';
      const head = document.createElement('div'); head.className = 'code-head';
      head.innerHTML = `<span>${esc(lang || 'text')}</span><button type="button" title="Copy code"><svg><use href="#i-copy"/></svg>Copy</button>`;
      head.querySelector('button').addEventListener('click', (e) => {
        copyText(code.textContent); const b = e.currentTarget; b.lastChild.textContent = 'Copied';
        setTimeout(() => (b.lastChild.textContent = 'Copy'), 1200);
      });
      pre.parentNode.insertBefore(wrap, pre); wrap.append(head, pre);
    });
  }

  function resolveImages(root) {
    for (const img of $$('img', root)) {
      const src = img.getAttribute('src');
      if (!src || /^(https?:|data:|blob:)/i.test(src)) continue;
      img.loading = 'eager';
      let target;
      if (/^file:/i.test(src)) target = fileUrlToPath(src);
      else {
        let rel = src.split('#')[0].split('?')[0];
        try { rel = decodeURIComponent(rel); } catch (e) { /* keep */ }
        if (!doc.path) continue;
        target = isUrl(doc.path) ? resolveRef(doc.path, src) : resolveRef(doc.path, rel);
      }
      if (!IS_NL || isUrl(target)) { img.src = target; continue; }
      img.removeAttribute('src');
      P.readBinary(target).then((buf) => {
        const ext = (target.split('.').pop() || '').toLowerCase();
        const type = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' }[ext] || '';
        const url = URL.createObjectURL(new Blob([buf], { type }));
        blobUrls.push(url); img.src = url;
      }).catch(() => { img.classList.add('broken'); img.title = 'Image not found: ' + target; });
    }
  }

  let mermaidTheme = null, mermaidCount = 0;
  async function renderDiagrams(root) {
    const blocks = $$('.mermaid-block', root);
    if (!blocks.length) return;
    try { await ensureMermaid(); } catch (e) {
      blocks.forEach((b) => (b.innerHTML = `<div class="diagram-error"><b>Mermaid could not be loaded.</b></div>`)); return;
    }
    const theme = S.theme === 'dark' ? 'dark' : S.theme === 'sepia' ? 'neutral' : 'default';
    if (mermaidTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', theme,
        fontFamily: getComputedStyle(el.content).fontFamily, flowchart: { htmlLabels: true }
      });
      mermaidTheme = theme;
    }
    for (const b of blocks) {
      const id = 'mmd-' + (++mermaidCount);
      try {
        const { svg } = await mermaid.render(id, b.dataset.src);
        b.innerHTML = svg; b.classList.remove('pending');
      } catch (e) {
        b.classList.remove('pending');
        b.innerHTML = `<div class="diagram-error"><b>Diagram error:</b> ${esc((e && e.message) || e).split('\n')[0]}<pre>${esc(b.dataset.src)}</pre></div>`;
        const stray = document.getElementById('d' + id); if (stray) stray.remove();
      }
    }
  }

  // ======================================================================
  // Opening documents
  // ======================================================================
  async function openPath(path, opts = {}) {
    try {
      const text = await P.readText(path);
      if (doc && doc.path && !opts.noHistory && doc.path !== path) { history.push(doc.path); $('#btn-back').disabled = false; }
      doc = { path, name: basename(isUrl(path) ? decodeURIComponent(path.split(/[?#]/)[0]) : path), text, key: hash(path.toLowerCase()) };
      try { doc.stamp = await P.stat(path); } catch (e) { doc.stamp = null; }
      afterOpen();
      await renderDoc({ anchor: opts.anchor });
      addRecent(path);
    } catch (e) {
      toast('Could not open ' + basename(path) + (e && e.message ? ' — ' + e.message : ''), 4000);
    }
  }
  async function openFileObject(file) {
    const text = await file.text();
    doc = { path: null, name: file.name, text, key: hash('file:' + file.name + ':' + file.size) };
    afterOpen();
    await renderDoc();
  }
  async function openWelcome() {
    let text = '# mdink\n\nOpen a Markdown file with **Ctrl+O** or drop it on this window.';
    try { text = await (await fetch('sample/welcome.md')).text(); } catch (e) { /* fallback */ }
    doc = { path: null, name: 'Welcome', text, key: 'welcome', welcome: true };
    afterOpen();
    await renderDoc();
  }
  function afterOpen() {
    el.title.innerHTML = `<span class="name">${esc(doc.name)}</span>`;
    el.title.title = doc.path || doc.name;
    el.stPath.textContent = doc.path || doc.name;
    P.setTitle(doc.welcome ? 'mdink' : doc.name + ' — mdink');
    closeFind(true);
  }
  async function reloadDoc(silent) {
    if (!doc || !doc.path) return;
    try {
      const text = await P.readText(doc.path);
      doc.stamp = await P.stat(doc.path).catch(() => null);
      if (text === doc.text && silent) return;
      doc.text = text;
      await renderDoc({ keepScroll: true, reapplyInk: true });
      toast(silent ? 'File changed — reloaded' : 'Reloaded', 1400);
    } catch (e) { if (!silent) toast('Could not reload: ' + (e.message || e)); }
  }
  function goBack() {
    const p = history.pop();
    $('#btn-back').disabled = !history.length;
    if (p) openPath(p, { noHistory: true });
  }

  async function addRecent(path) {
    recent = [path, ...recent.filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, 15);
    await P.set('recent', recent);
  }
  function showRecent() {
    const m = $('#recent-menu');
    if (!recent.length) m.innerHTML = '<div class="empty">No recent files yet</div>';
    else {
      m.innerHTML = recent.map((p, i) => `<button class="item" data-i="${i}" title="${esc(p)}">${esc(basename(p))}<small>${esc(dirname(p))}</small></button>`).join('') +
        '<hr><button class="item" data-clear>Clear list</button>';
    }
    toggleMenu(m);
  }

  // ======================================================================
  // Links
  // ======================================================================
  el.content.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    e.preventDefault();
    if (href.startsWith('#')) { scrollToId(decodeURIComponent(href.slice(1))); return; }
    if (/^(https?:|mailto:|tel:)/i.test(href)) { P.openExternal(href); return; }
    const [pathPart, anchor] = href.split('#');
    let target;
    if (/^file:/i.test(pathPart)) target = fileUrlToPath(pathPart);
    else if (doc && doc.path) { let rel = pathPart; try { rel = decodeURIComponent(rel); } catch (err) { /* keep */ } target = isUrl(doc.path) ? resolveRef(doc.path, pathPart) : resolveRef(doc.path, rel); }
    else return;
    if (/\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(target.split('?')[0])) openPath(target, { anchor: anchor ? decodeURIComponent(anchor) : null });
    else P.openExternal(isUrl(target) ? target : target);
  });

  function scrollToId(id) {
    const t = document.getElementById(id) || el.content.querySelector(`[name="${CSS.escape(id)}"]`);
    if (!t) return;
    const vr = el.viewport.getBoundingClientRect(), tr = t.getBoundingClientRect();
    el.viewport.scrollTo({ top: el.viewport.scrollTop + tr.top - vr.top - 16, behavior: 'smooth' });
  }

  // ======================================================================
  // Outline (TOC) & stats
  // ======================================================================
  let tocLinks = [];
  function buildToc() {
    const hs = $$('h1,h2,h3,h4,h5,h6', el.content).filter((h) => !h.closest('.footnotes, .markdown-alert'));
    if (!hs.length) { el.toc.innerHTML = '<div class="empty">No headings</div>'; tocLinks = []; return; }
    el.toc.innerHTML = hs.map((h) => `<a href="#${esc(h.id)}" class="l${h.tagName[1]}" dir="auto" title="${esc(h.textContent)}">${esc(h.textContent)}</a>`).join('');
    tocLinks = $$('a', el.toc).map((a, i) => ({ a, h: hs[i] }));
  }
  el.toc.addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return; e.preventDefault();
    scrollToId(decodeURIComponent(a.getAttribute('href').slice(1)));
  });
  let tocRaf = 0;
  el.viewport.addEventListener('scroll', () => {
    hideSelPop();
    if (el.sidebar.hidden || tocRaf) return;
    tocRaf = requestAnimationFrame(() => {
      tocRaf = 0;
      const top = el.viewport.getBoundingClientRect().top + 90;
      let cur = null;
      for (const t of tocLinks) { if (t.h.getBoundingClientRect().top <= top) cur = t; else break; }
      tocLinks.forEach((t) => t.a.classList.toggle('active', t === cur));
    });
  });
  function updateStats() {
    const text = el.content.innerText || '';
    const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu) || []).length;
    const mins = Math.max(1, Math.round(words / 220));
    el.stStats.textContent = `${words.toLocaleString()} words · ${mins} min read`;
  }

  // ======================================================================
  // Zoom & layout
  // ======================================================================
  function sizeSizer() {
    const z = S.zoom;
    el.sizer.style.width = el.page.offsetWidth * z + 'px';
    el.sizer.style.height = el.page.offsetHeight * z + 'px';
  }
  function setZoom(z, anchor) {
    z = Math.min(4, Math.max(0.3, Math.round(z * 100) / 100));
    const vp = el.viewport, old = S.zoom;
    const ax = anchor ? anchor.x : vp.clientWidth / 2, ay = anchor ? anchor.y : vp.clientHeight / 2;
    const cx = (vp.scrollLeft + ax), cy = (vp.scrollTop + ay - 28);
    S.zoom = z;
    document.documentElement.style.setProperty('--zoom', z);
    sizeSizer();
    vp.scrollLeft = cx * (z / old) - ax;
    vp.scrollTop = cy * (z / old) + 28 - ay;
    $('#btn-zoom-reset').textContent = Math.round(z * 100) + '%';
    saveSettings();
  }
  function fitWidth() {
    const avail = el.viewport.clientWidth - 48 - ($('#inkbar').offsetWidth + 20) * 2;
    setZoom(Math.max(0.3, avail / el.page.offsetWidth));
  }
  new ResizeObserver(() => { sizeSizer(); Ink.relayout(); }).observe(el.page);
  new ResizeObserver(() => Ink.relayout()).observe(el.content);

  el.viewport.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const vr = el.viewport.getBoundingClientRect();
    setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX - vr.left, y: e.clientY - vr.top });
  }, { passive: false });

  // ======================================================================
  // Settings / appearance
  // ======================================================================
  const TEXT_FONTS = [
    'Segoe UI', 'Segoe UI Variable Text', 'Aptos', 'Calibri', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Bahnschrift', 'Candara', 'Corbel',
    'Century Gothic', 'Georgia', 'Cambria', 'Constantia', 'Times New Roman', 'Palatino Linotype', 'Book Antiqua', 'Garamond', 'Sitka Text',
    'Inter', 'Roboto', 'Open Sans', 'Noto Sans', 'Source Sans 3', 'IBM Plex Sans', 'Lato', 'Merriweather', 'Lora', 'Literata',
    'B Nazanin', 'B Mitra', 'B Lotus', 'B Yekan', 'B Zar', 'IRANSans', 'IRANSansX', 'IRANYekan', 'Sahel', 'Shabnam', 'Samim', 'Tanha', 'Parastoo', 'Estedad',
    'Noto Naskh Arabic', 'Noto Sans Arabic', 'Sakkal Majalla', 'Traditional Arabic', 'Simplified Arabic', 'Arial Unicode MS',
    'Cascadia Code', 'Consolas'
  ];
  const CODE_FONTS = ['Cascadia Mono', 'Cascadia Code', 'Consolas', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'IBM Plex Mono', 'Hack', 'Courier New', 'Lucida Console', 'DejaVu Sans Mono', 'Ubuntu Mono'];

  function fontInstalled(name) {
    const c = fontInstalled.c || (fontInstalled.c = document.createElement('canvas').getContext('2d'));
    const sample = 'mmmmmmmmmmlli1WQ@#&% سلام کتاب';
    return ['monospace', 'serif', 'sans-serif'].some((base) => {
      c.font = `40px ${base}`; const w0 = c.measureText(sample).width;
      c.font = `40px "${name}", ${base}`; return c.measureText(sample).width !== w0;
    });
  }
  function fillFontSelects() {
    const tf = TEXT_FONTS.filter(fontInstalled);
    const cf = CODE_FONTS.filter(fontInstalled);
    const sel = $('#sel-font');
    sel.innerHTML = `<option value="auto">Auto (Segoe UI + Vazirmatn)</option><option value="Vazirmatn">Vazirmatn (built-in)</option>` +
      `<optgroup label="Installed">${tf.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</optgroup>` +
      `<option value="__custom">Other…</option>`;
    $('#sel-code-font').innerHTML = `<option value="auto">Auto (Cascadia / Consolas)</option>` + cf.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  }
  function fontStack(name, fallback) {
    if (!name || name === 'auto') return null;
    return `"mdink-fa", "${name.replace(/"/g, '')}", ${fallback}`;
  }

  function applySettings(rerender) {
    const root = document.documentElement.style;
    const prevTheme = el.body.dataset.theme;
    el.body.dataset.theme = S.theme;
    $('#hljs-light').disabled = S.theme === 'dark';
    $('#hljs-dark').disabled = S.theme !== 'dark';
    const tf = fontStack(S.font, '"Segoe UI", system-ui, sans-serif');
    if (tf) root.setProperty('--doc-font', S.font === 'Vazirmatn' ? '"Vazirmatn", "Segoe UI", sans-serif' : tf); else root.removeProperty('--doc-font');
    const cf = S.codeFont && S.codeFont !== 'auto' ? `"${S.codeFont}", Consolas, monospace` : null;
    if (cf) root.setProperty('--code-font', cf); else root.removeProperty('--code-font');
    root.setProperty('--doc-size', S.size + 'px');
    root.setProperty('--doc-lh', S.lh);
    const [pw, ph] = PAPERS[S.paper] || PAPERS.A4;
    root.setProperty('--paper-w', pw);
    root.setProperty('--paper-pad', S.paper === 'A5' ? '14mm' : '18mm');
    $('#page-style').textContent = `@page { size: ${pw} ${ph}; margin: 15mm 0 16mm; }`;
    root.setProperty('--zoom', S.zoom);
    $('#btn-zoom-reset').textContent = Math.round(S.zoom * 100) + '%';
    el.body.classList.toggle('print-ink', !!S.printInk);
    el.sidebar.hidden = !S.sidebar;
    $('#btn-toc').classList.toggle('on', !!S.sidebar);
    syncSettingsUI();
    requestAnimationFrame(sizeSizer);
    if (rerender && prevTheme !== S.theme && $('.mermaid-block', el.content)) renderDoc({ keepScroll: true, reapplyInk: true });
  }
  function syncSettingsUI() {
    $$('#seg-theme button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.theme));
    const sel = $('#sel-font');
    const known = $$('option', sel).some((o) => o.value === S.font);
    sel.value = known ? S.font : '__custom';
    $('#inp-font').hidden = known;
    if (!known) $('#inp-font').value = S.font;
    $('#sel-code-font').value = $$('option', $('#sel-code-font')).some((o) => o.value === S.codeFont) ? S.codeFont : 'auto';
    $('#rng-size').value = S.size; $('#out-size').textContent = S.size + 'px';
    $('#rng-lh').value = S.lh; $('#out-lh').textContent = Number(S.lh).toFixed(2);
    $('#sel-paper').value = S.paper;
    $('#chk-reload').checked = !!S.autoReload;
    $('#chk-print-ink').checked = !!S.printInk;
  }
  let saveT = 0;
  function saveSettings() { clearTimeout(saveT); saveT = setTimeout(() => P.set('settings', S), 300); }
  function setS(k, v, rerender = true) { S[k] = v; applySettings(rerender); saveSettings(); }

  $('#seg-theme').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setS('theme', b.dataset.v); });
  $('#sel-font').addEventListener('change', (e) => {
    if (e.target.value === '__custom') { $('#inp-font').hidden = false; $('#inp-font').focus(); return; }
    setS('font', e.target.value);
  });
  $('#inp-font').addEventListener('change', (e) => { const v = e.target.value.trim(); if (v) setS('font', v); });
  $('#sel-code-font').addEventListener('change', (e) => setS('codeFont', e.target.value));
  $('#rng-size').addEventListener('input', (e) => setS('size', +e.target.value));
  $('#rng-lh').addEventListener('input', (e) => setS('lh', +e.target.value));
  $('#sel-paper').addEventListener('change', (e) => setS('paper', e.target.value));
  $('#chk-reload').addEventListener('change', (e) => setS('autoReload', e.target.checked));
  $('#chk-print-ink').addEventListener('change', (e) => setS('printInk', e.target.checked));
  $('#btn-reset-settings').addEventListener('click', () => { const z = S.zoom; S = { ...DEFAULTS, zoom: z }; applySettings(true); saveSettings(); });

  // ======================================================================
  // Printing / PDF
  // ======================================================================
  let printThemeRestore = null;
  async function doPrint(pdfHint) {
    closeMenus(); hideSelPop();
    if (S.theme === 'dark') {
      // paper is white: print with the light palette (and light diagrams)
      printThemeRestore = S.theme;
      S.theme = 'light'; applySettings(false);
      if ($('.mermaid-block', el.content)) await renderDoc({ keepScroll: true, reapplyInk: true });
    }
    if (pdfHint) toast('Choose “Save as PDF” (or “Microsoft Print to PDF”) as the printer', 3500);
    await new Promise((r) => setTimeout(r, pdfHint ? 250 : 30));
    window.print();
  }
  window.addEventListener('afterprint', () => {
    if (printThemeRestore) {
      S.theme = printThemeRestore; printThemeRestore = null;
      applySettings(true);
    }
  });

  // ======================================================================
  // Annotations wiring
  // ======================================================================
  const PEN_COLORS = ['ink', '#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5'];
  const MARKER_COLORS = ['#ffd43b', '#69db7c', '#74c0fc', '#f783ac', '#ffa94d'];
  const HL_COLORS = ['#ffe066', '#b2f2bb', '#a5d8ff', '#fcc2d7', '#ffc9a9'];
  const NOTE_COLORS = ['#e03131', 'ink', '#1971c2', '#2f9e44', '#9c36b5'];
  const WIDTHS = { pen: [1.5, 2.5, 4], marker: [10, 16, 24] };

  let inkSaveT = 0;
  Ink.init({
    page: el.page, article: el.content, svg: $('#ink-svg'), notes: $('#ink-notes'),
    getScale: () => S.zoom,
    onChange(items, typing) {
      if (!doc) return;
      const key = 'ink_' + doc.key, val = items.length ? items : null;
      clearTimeout(inkSaveT);
      inkSaveT = setTimeout(() => P.set(key, val), typing ? 600 : 50);
    },
    onToolChange: (t) => reflectTool(t)
  });

  function reflectTool(t) {
    el.body.className = el.body.className.replace(/\btool-\w+/g, '').trim() + ' tool-' + t;
    $$('#inkbar .tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    const sw = $('#swatches'), wd = $('#widths');
    const colors = { pen: PEN_COLORS, marker: MARKER_COLORS, highlight: HL_COLORS, note: NOTE_COLORS }[t];
    if (colors) {
      const cur = Ink.opts[t].color;
      sw.innerHTML = colors.map((c) => `<button data-c="${c}" class="${c === cur ? 'on' : ''}" style="--c:${c === 'ink' ? 'var(--ink)' : c}" title="${c === 'ink' ? 'Ink (black / white)' : c}"></button>`).join('');
      sw.hidden = false;
    } else sw.hidden = true;
    if (WIDTHS[t]) {
      const cur = Ink.opts[t].width;
      wd.innerHTML = WIDTHS[t].map((w) => `<button data-w="${w}" class="${w === cur ? 'on' : ''}" title="Size ${w}"><span style="height:${Math.min(12, Math.max(2, t === 'marker' ? w / 2 : w))}px"></span></button>`).join('');
      wd.hidden = false;
    } else wd.hidden = true;
    $$('.ink-sep')[0].hidden = !colors && !WIDTHS[t];
    if (t !== 'select') hideSelPop();
  }
  $('#inkbar').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) { Ink.setTool(t.dataset.tool); return; }
    const c = e.target.closest('#swatches button');
    if (c) { Ink.opts[Ink.tool].color = c.dataset.c; reflectTool(Ink.tool); return; }
    const w = e.target.closest('#widths button');
    if (w) { Ink.opts[Ink.tool].width = +w.dataset.w; reflectTool(Ink.tool); }
  });
  $('#ink-undo').addEventListener('click', () => Ink.undo());
  $('#ink-redo').addEventListener('click', () => Ink.redo());
  let inkVisible = true;
  $('#ink-toggle').addEventListener('click', (e) => {
    inkVisible = !inkVisible; Ink.setVisible(inkVisible);
    el.body.classList.toggle('ink-hidden', !inkVisible);
    e.currentTarget.querySelector('use').setAttribute('href', inkVisible ? '#i-eye' : '#i-eye-off');
    toast(inkVisible ? 'Annotations shown' : 'Annotations hidden', 1100);
  });
  let clearArm = 0;
  $('#ink-clear').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!Ink.count()) { toast('No annotations on this file', 1300); return; }
    if (!clearArm) {
      b.classList.add('armed'); toast('Click again to remove all annotations on this file', 2500);
      clearArm = setTimeout(() => { b.classList.remove('armed'); clearArm = 0; }, 2500);
      return;
    }
    clearTimeout(clearArm); clearArm = 0; b.classList.remove('armed');
    Ink.clear(); toast('Annotations cleared — Ctrl+Z to undo', 2200);
  });

  // selection popup / highlighter tool
  const selPop = $('#sel-pop');
  function hideSelPop() { selPop.hidden = true; }
  el.content.addEventListener('mouseup', () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !el.content.contains(sel.anchorNode)) { hideSelPop(); return; }
      if (Ink.tool === 'highlight') { Ink.highlightSelection(Ink.opts.highlight.color); return; }
      if (Ink.tool !== 'select') return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (!r.width && !r.height) return;
      selPop.hidden = false;
      const w = selPop.offsetWidth;
      selPop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
      selPop.style.top = (r.top > 70 ? r.top - selPop.offsetHeight - 8 : r.bottom + 8) + 'px';
    }, 0);
  });
  selPop.addEventListener('mousedown', (e) => e.preventDefault());
  selPop.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'copy') { copyText(window.getSelection().toString()); toast('Copied', 900); }
    else if (b.dataset.c) Ink.highlightSelection(b.dataset.c);
    hideSelPop();
  });
  document.addEventListener('mousedown', (e) => { if (!selPop.contains(e.target)) hideSelPop(); });

  // ======================================================================
  // Find
  // ======================================================================
  const findbar = $('#findbar'), findInput = $('#find-input'), findStatus = $('#find-status');
  function openFind() {
    findbar.hidden = false;
    const s = window.getSelection().toString().trim();
    if (s && s.length < 80) findInput.value = s;
    findInput.select(); findInput.focus();
  }
  function closeFind(silent) { findbar.hidden = true; findStatus.textContent = ''; if (!silent) el.viewport.focus(); }
  function countMatches(q) {
    if (!q) return 0;
    const t = el.content.innerText.toLowerCase(), n = q.toLowerCase();
    let c = 0, i = t.indexOf(n); while (i !== -1) { c++; i = t.indexOf(n, i + n.length); } return c;
  }
  function findNext(back) {
    const q = findInput.value;
    if (!q) { findStatus.textContent = ''; return; }
    const sel = window.getSelection();
    if (!el.content.contains(sel.anchorNode)) {
      // start from the top (or bottom) of the document
      const r = document.createRange(); r.selectNodeContents(el.content); r.collapse(!back);
      sel.removeAllRanges(); sel.addRange(r);
    }
    let ok = window.find(q, false, !!back, false, false, false, false);
    if (!ok || !el.content.contains(window.getSelection().anchorNode)) {
      const r = document.createRange(); r.selectNodeContents(el.content); r.collapse(!back);
      sel.removeAllRanges(); sel.addRange(r);
      ok = window.find(q, false, !!back, false, false, false, false) && el.content.contains(window.getSelection().anchorNode);
    }
    const n = countMatches(q);
    findStatus.textContent = ok ? `${n} match${n === 1 ? '' : 'es'}` : 'No results';
    findStatus.classList.toggle('miss', !ok);
    findInput.focus();
  }
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  findInput.addEventListener('input', () => { const n = countMatches(findInput.value); findStatus.textContent = findInput.value ? `${n} match${n === 1 ? '' : 'es'}` : ''; findStatus.classList.toggle('miss', !!findInput.value && !n); });
  $('#find-next').addEventListener('click', () => findNext(false));
  $('#find-prev').addEventListener('click', () => findNext(true));
  $('#find-close').addEventListener('click', () => closeFind());

  // ======================================================================
  // Menus, toast, modal, clipboard
  // ======================================================================
  function closeMenus(except) { $$('.menu').forEach((m) => { if (m !== except) m.hidden = true; }); }
  function toggleMenu(m) { const show = m.hidden; closeMenus(); m.hidden = !show; }
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu-wrap')) closeMenus(); });
  $('#recent-menu').addEventListener('click', (e) => {
    const b = e.target.closest('.item'); if (!b) return;
    closeMenus();
    if (b.hasAttribute('data-clear')) { recent = []; P.set('recent', recent); return; }
    openPath(recent[+b.dataset.i]);
  });
  let toastT = 0;
  function toast(msg, ms = 2200) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(() => fallbackCopy(t));
    else fallbackCopy(t);
  }
  function fallbackCopy(t) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) $('#modal').hidden = true; });

  // ======================================================================
  // Toolbar buttons
  // ======================================================================
  async function pickAndOpen() {
    const r = await P.openDialog();
    if (!r) return;
    if (r.path) openPath(r.path); else if (r.file) openFileObject(r.file);
  }
  $('#btn-open').addEventListener('click', pickAndOpen);
  $('#btn-recent').addEventListener('click', showRecent);
  $('#btn-back').addEventListener('click', goBack);
  $('#btn-toc').addEventListener('click', () => setS('sidebar', !S.sidebar, false));
  $('#btn-zoom-in').addEventListener('click', () => setZoom(S.zoom * 1.1));
  $('#btn-zoom-out').addEventListener('click', () => setZoom(S.zoom / 1.1));
  $('#btn-zoom-reset').addEventListener('click', () => setZoom(1));
  $('#btn-fit').addEventListener('click', fitWidth);
  $('#btn-find').addEventListener('click', () => (findbar.hidden ? openFind() : closeFind()));
  $('#btn-settings').addEventListener('click', () => toggleMenu($('#settings-panel')));
  $('#btn-print').addEventListener('click', () => doPrint(false));
  $('#btn-pdf').addEventListener('click', () => doPrint(true));
  $('#btn-shortcuts').addEventListener('click', () => { closeMenus(); $('#modal').hidden = false; });

  // ======================================================================
  // Keyboard
  // ======================================================================
  document.addEventListener('keydown', (e) => {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
    if (ctrl && !e.altKey) {
      const lk = k.toLowerCase();
      if (lk === 'o') { e.preventDefault(); pickAndOpen(); return; }
      if (lk === 'p') { e.preventDefault(); doPrint(false); return; }
      if (lk === 's' && e.shiftKey) { e.preventDefault(); doPrint(true); return; }
      if (lk === 's') { e.preventDefault(); return; }
      if (lk === 'f') { e.preventDefault(); openFind(); return; }
      if (lk === 'r') { e.preventDefault(); reloadDoc(false); return; }
      if (k === '=' || k === '+') { e.preventDefault(); setZoom(S.zoom * 1.1); return; }
      if (k === '-' || k === '_') { e.preventDefault(); setZoom(S.zoom / 1.1); return; }
      if (k === '0') { e.preventDefault(); setZoom(1); return; }
      if (k === '\\') { e.preventDefault(); setS('sidebar', !S.sidebar, false); return; }
      if (typing) return;
      if (lk === 'z' && !e.shiftKey) { e.preventDefault(); Ink.undo(); return; }
      if (lk === 'y' || (lk === 'z' && e.shiftKey)) { e.preventDefault(); Ink.redo(); return; }
      return;
    }
    if (k === 'F5') { e.preventDefault(); reloadDoc(false); return; }
    if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); goBack(); return; }
    if (typing) return;
    if (k === 'Escape') {
      if (!$('#modal').hidden) { $('#modal').hidden = true; return; }
      if (!findbar.hidden) { closeFind(); return; }
      closeMenus(); hideSelPop(); Ink.setTool('select'); return;
    }
    if (e.altKey) return;
    const tools = { v: 'select', h: 'highlight', p: 'pen', m: 'marker', t: 'note', e: 'eraser' };
    const lk = k.toLowerCase();
    if (tools[lk] && !e.shiftKey) {
      if (lk === 'h' && Ink.tool === 'select' && !window.getSelection().isCollapsed) { Ink.highlightSelection(Ink.opts.highlight.color); hideSelPop(); return; }
      Ink.setTool(tools[lk]); return;
    }
    if (lk === 'd') { setS('theme', S.theme === 'dark' ? 'light' : 'dark'); return; }
    if (k === '?') { $('#modal').hidden = false; }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 3) goBack(); });

  // ======================================================================
  // Drag & drop
  // ======================================================================
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop-hint').hidden = false; });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-hint').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#drop-hint').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) openFileObject(f);
  });

  // ======================================================================
  // Startup
  // ======================================================================
  async function start() {
    await P.init();
    if (IS_NL) {
      Neutralino.events.on('filesDropped', (ev) => {
        const files = (ev.detail || []).filter((p) => !/\.(png|jpe?g|gif|exe|zip)$/i.test(p));
        if (files[0]) openPath(files[0]);
      });
    }
    S = { ...DEFAULTS, ...(await P.get('settings') || {}) };
    recent = (await P.get('recent')) || [];
    fillFontSelects();
    applySettings(false);
    reflectTool('select');
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => Ink.relayout());

    const first = P.startupFile();
    if (first) await openPath(first); else await openWelcome();
    if (!(await P.get('settings')) && el.viewport.clientWidth < el.page.offsetWidth * S.zoom + 140) fitWidth();

    // watch the open file for changes
    setInterval(async () => {
      if (!IS_NL || !doc || !doc.path || !S.autoReload || document.hidden) return;
      try { const st = await P.stat(doc.path); if (st && doc.stamp && st !== doc.stamp) reloadDoc(true); } catch (e) { /* file may be mid-save */ }
    }, 1200);
  }
  start();
})();
