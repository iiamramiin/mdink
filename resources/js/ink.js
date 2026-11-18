/*
 * mdink — annotations (highlights, pen/marker strokes, text notes).
 *
 * Strokes and notes are anchored to a block of the rendered document
 * (paragraph, list item, heading, code block...). Their coordinates are stored
 * relative to that block, so they follow it when the font, size, theme or the
 * file itself changes, and when printing they are re-attached inside the block
 * so they land on the right spot of the right page.
 *
 * Highlights are stored as character offsets into the document text, plus the
 * highlighted text to re-locate them if the file changes.
 */
(function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const ANCHOR_SEL = ':scope > *, li, blockquote > *, dd, tr';
  const SKIP_SEL = '.mermaid-block, .katex, .code-head, .ink-print, .front-matter, .math-block';

  let page, article, svg, notesLayer, getScale, onChange, onToolChange;
  let items = [];
  let undoStack = [], redoStack = [];
  let tool = 'select';
  const preStates = new Map(); // note id -> items state before the note was created
  let visible = true;
  const opts = {
    pen: { color: 'ink', width: 2.5 },
    marker: { color: '#ffd43b', width: 16 },
    highlight: { color: '#ffe066' },
    note: { color: '#e03131' }
  };

  const uid = () => Math.random().toString(36).slice(2, 10);
  const r1 = (v) => Math.round(v * 10) / 10;

  // ---------- geometry ----------
  function pageRect() { return page.getBoundingClientRect(); }
  function toPage(clientX, clientY) {
    const pr = pageRect(), s = getScale();
    return { x: (clientX - pr.left) / s, y: (clientY - pr.top) / s };
  }
  function relBox(el) {
    const pr = pageRect(), r = el.getBoundingClientRect(), s = getScale();
    return { x: (r.left - pr.left) / s, y: (r.top - pr.top) / s, w: r.width / s, h: r.height / s };
  }

  // ---------- anchors ----------
  function anchors() { return Array.from(article.querySelectorAll(ANCHOR_SEL)).filter((el) => !el.closest('.ink-print') && !el.classList.contains('ink-print')); }
  function sigOf(el) { return el.tagName + ':' + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); }

  function pickAnchor(x, y) {
    const list = anchors();
    let best = -1, bestH = Infinity, near = -1, nearD = Infinity;
    list.forEach((el, i) => {
      const b = relBox(el);
      if (b.h === 0 && b.w === 0) return;
      if (y >= b.y && y <= b.y + b.h) {
        if (b.h < bestH) { bestH = b.h; best = i; }
      } else {
        const d = y < b.y ? b.y - y : y - (b.y + b.h);
        if (d < nearD) { nearD = d; near = i; }
      }
    });
    const i = best >= 0 ? best : near;
    if (i < 0) return { a: null, box: { x: 0, y: 0 } };
    return { a: { i, sig: sigOf(list[i]) }, box: relBox(list[i]), el: list[i] };
  }

  function resolveAnchor(a, list) {
    if (!a) return null;
    list = list || anchors();
    if (list[a.i] && sigOf(list[a.i]) === a.sig) return list[a.i];
    let best = null, bestD = Infinity;
    list.forEach((el, i) => {
      if (sigOf(el) === a.sig && Math.abs(i - a.i) < bestD) { bestD = Math.abs(i - a.i); best = el; }
    });
    if (best) return best;
    return list[Math.min(a.i, list.length - 1)] || null;
  }
  function originOf(item, list) {
    const el = resolveAnchor(item.a, list);
    return el ? relBox(el) : { x: 0, y: 0, w: 0, h: 0 };
  }

  // ---------- path helpers ----------
  function pathD(pts) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]}l0.01 0`;
    if (pts.length === 2) return `M${pts[0][0]} ${pts[0][1]}L${pts[1][0]} ${pts[1][1]}`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += `Q${r1(pts[i][0])} ${r1(pts[i][1])} ${r1(mx)} ${r1(my)}`;
    }
    const l = pts[pts.length - 1];
    return d + `L${l[0]} ${l[1]}`;
  }
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const sq = (a, b, p) => {
      let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
      if (dx || dy) {
        const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
      }
      dx = p[0] - x; dy = p[1] - y; return dx * dx + dy * dy;
    };
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [f, l] = stack.pop(); let max = 0, idx = 0;
      for (let i = f + 1; i < l; i++) { const d = sq(pts[f], pts[l], pts[i]); if (d > max) { max = d; idx = i; } }
      if (max > eps * eps) { keep[idx] = 1; stack.push([f, idx], [idx, l]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function strokeColor(c) { return c === 'ink' ? 'var(--ink)' : c; }

  // ---------- rendering ----------
  function sizeSvg() {
    svg.setAttribute('width', page.offsetWidth);
    svg.setAttribute('height', page.offsetHeight);
  }

  function render() {
    if (!article) return;
    sizeSvg();
    svg.replaceChildren();
    notesLayer.replaceChildren();
    const list = anchors();
    for (const it of items) {
      if (it.t === 'pen' || it.t === 'marker') {
        const o = originOf(it, list);
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', pathD(it.p));
        p.setAttribute('transform', `translate(${r1(o.x)} ${r1(o.y)})`);
        p.setAttribute('stroke-width', it.w);
        p.style.stroke = strokeColor(it.c);
        if (it.t === 'marker') { p.classList.add('marker'); p.setAttribute('stroke-opacity', '0.4'); }
        p.dataset.id = it.id;
        svg.appendChild(p);
      } else if (it.t === 'note') {
        const o = originOf(it, list);
        notesLayer.appendChild(noteEl(it, o.x + it.x, o.y + it.y));
      }
    }
  }

  function noteEl(it, x, y) {
    const n = document.createElement('div');
    n.className = 'ink-note';
    n.dataset.id = it.id;
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    n.style.setProperty('--nc', strokeColor(it.c));
    n.innerHTML = '<div class="nbar"><span title="Drag to move">⠿ note</span><button title="Delete note"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div><div class="nbody" contenteditable="plaintext-only" spellcheck="false"></div>';
    const body = n.querySelector('.nbody');
    body.textContent = it.text || '';
    let before = null;
    body.addEventListener('focus', () => {
      before = preStates.has(it.id) ? preStates.get(it.id) : JSON.stringify(items);
      preStates.delete(it.id);
    });
    body.addEventListener('input', () => { it.text = body.textContent; onChange(items, true); });
    body.addEventListener('blur', () => {
      it.text = body.textContent.replace(/\s+$/, '');
      if (!it.text) { items = items.filter((x) => x !== it); render(); if (before && before !== JSON.stringify(items)) pushUndo(before); }
      else if (before && before !== JSON.stringify(items)) pushUndo(before);
      before = null; onChange(items);
    });
    body.addEventListener('keydown', (e) => { if (e.key === 'Escape') body.blur(); e.stopPropagation(); });
    n.querySelector('.nbar button').addEventListener('click', () => { snapshot(); items = items.filter((x) => x !== it); render(); onChange(items); });
    // drag
    const handle = n.querySelector('.nbar span');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const start = toPage(e.clientX, e.clientY), sx = parseFloat(n.style.left), sy = parseFloat(n.style.top);
      const prev = JSON.stringify(items);
      const move = (ev) => { const p = toPage(ev.clientX, ev.clientY); n.style.left = sx + p.x - start.x + 'px'; n.style.top = sy + p.y - start.y + 'px'; };
      const up = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
        const nx = parseFloat(n.style.left), ny = parseFloat(n.style.top);
        if (nx === sx && ny === sy) return;
        const pk = pickAnchor(nx, ny);
        it.a = pk.a; it.x = r1(nx - pk.box.x); it.y = r1(ny - pk.box.y);
        pushUndo(prev); onChange(items);
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
    });
    return n;
  }

  // ---------- highlights ----------
  function textNodes() {
    const out = [];
    const w = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest(SKIP_SEL)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n, off = 0;
    while ((n = w.nextNode())) { out.push({ n, s: off }); off += n.data.length; }
    return out;
  }
  function fullText(nodes) { return nodes.map((x) => x.n.data).join(''); }
  const BAD_PARENTS = /^(TABLE|THEAD|TBODY|TFOOT|TR|UL|OL|DL|COLGROUP)$/;

  function wrapRange(it, nodes) {
    for (const { n, s } of nodes) {
      const e = s + n.data.length;
      if (e <= it.s || s >= it.e) continue;
      if (BAD_PARENTS.test(n.parentElement.tagName)) continue;
      const a = Math.max(0, it.s - s), b = Math.min(n.data.length, it.e - s);
      if (b <= a || !n.data.slice(a, b).trim()) continue;
      let target = n;
      if (a > 0) target = target.splitText(a);
      if (b - a < target.data.length) target.splitText(b - a);
      const m = document.createElement('mark');
      m.className = 'ink-hl'; m.dataset.id = it.id;
      m.style.setProperty('--hl', it.c);
      target.parentNode.insertBefore(m, target);
      m.appendChild(target);
    }
  }
  function unwrapAll() {
    article.querySelectorAll('mark.ink-hl').forEach((m) => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m); p.normalize();
    });
  }
  function applyHighlights() {
    unwrapAll();
    const hls = items.filter((x) => x.t === 'hl');
    if (!hls.length) return;
    let nodes = textNodes();
    const text = fullText(nodes);
    for (const it of hls) {
      if (text.slice(it.s, it.e) !== it.txt) {
        // file changed: find the closest occurrence of the same text
        let best = -1, bestD = Infinity, i = text.indexOf(it.txt);
        while (i !== -1 && it.txt) { const d = Math.abs(i - it.s); if (d < bestD) { bestD = d; best = i; } i = text.indexOf(it.txt, i + 1); }
        if (best < 0) continue;
        it.s = best; it.e = best + it.txt.length;
      }
      wrapRange(it, nodes);
      nodes = textNodes();
    }
  }

  function rangeOffsets(range) {
    const nodes = textNodes();
    let s = -1, e = -1;
    for (const { n, s: off } of nodes) {
      if (!range.intersectsNode(n)) continue;
      const a = n === range.startContainer ? range.startOffset : 0;
      const b = n === range.endContainer ? range.endOffset : n.data.length;
      if (b <= a) continue;
      if (s < 0) s = off + a;
      e = off + b;
    }
    if (s < 0 || e <= s) return null;
    return { s, e, txt: fullText(nodes).slice(s, e) };
  }

  function highlightSelection(color) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return false;
    const o = rangeOffsets(range);
    if (!o || !o.txt.trim()) return false;
    snapshot();
    // replace overlapping highlights
    items = items.filter((x) => !(x.t === 'hl' && x.s < o.e && x.e > o.s));
    items.push({ id: uid(), t: 'hl', c: color || opts.highlight.color, s: o.s, e: o.e, txt: o.txt });
    sel.removeAllRanges();
    applyHighlights(); onChange(items);
    return true;
  }

  // ---------- undo ----------
  function pushUndo(state) { undoStack.push(state); if (undoStack.length > 200) undoStack.shift(); redoStack = []; updateButtons(); }
  function snapshot() { pushUndo(JSON.stringify(items)); }
  function restore(state) { items = JSON.parse(state); applyHighlights(); render(); onChange(items); }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(items)); restore(undoStack.pop()); updateButtons(); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(items)); restore(redoStack.pop()); updateButtons(); }
  function updateButtons() {
    const u = document.getElementById('ink-undo'), r = document.getElementById('ink-redo');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }

  // ---------- drawing / erasing / notes ----------
  let drawing = null;

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (tool === 'pen' || tool === 'marker') {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const o = opts[tool];
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('stroke-width', o.width);
      p.style.stroke = strokeColor(o.color);
      if (tool === 'marker') { p.classList.add('marker'); p.setAttribute('stroke-opacity', '0.4'); }
      svg.appendChild(p);
      const pt = toPage(e.clientX, e.clientY);
      drawing = { el: p, pts: [[r1(pt.x), r1(pt.y)]], id: e.pointerId };
      p.setAttribute('d', pathD(drawing.pts));
    } else if (tool === 'eraser') {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      drawing = { erase: true, before: JSON.stringify(items), changed: false, id: e.pointerId };
      eraseAt(e);
    } else if (tool === 'note') {
      e.preventDefault();
      const pt = toPage(e.clientX, e.clientY);
      const pk = pickAnchor(pt.y < 0 ? 0 : pt.x, pt.y);
      const it = { id: uid(), t: 'note', c: opts.note.color, a: pk.a, x: r1(pt.x - pk.box.x), y: r1(pt.y - pk.box.y - 10), text: '' };
      preStates.set(it.id, JSON.stringify(items)); // the note's blur handler records the undo step
      items.push(it);
      render();
      const body = notesLayer.querySelector(`.ink-note[data-id="${it.id}"] .nbody`);
      setTimeout(() => body && body.focus(), 0);
      if (onToolChange) setTool('select');
    }
  }
  function onPointerMove(e) {
    if (!drawing || e.pointerId !== drawing.id) return;
    if (drawing.erase) { eraseAt(e); return; }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const pt = toPage(ev.clientX, ev.clientY);
      const last = drawing.pts[drawing.pts.length - 1];
      if (Math.abs(pt.x - last[0]) + Math.abs(pt.y - last[1]) < 0.8) continue;
      drawing.pts.push([r1(pt.x), r1(pt.y)]);
    }
    drawing.el.setAttribute('d', pathD(drawing.pts));
  }
  function onPointerUp(e) {
    if (!drawing || e.pointerId !== drawing.id) return;
    const d = drawing; drawing = null;
    if (d.erase) {
      if (d.changed) { pushUndo(d.before); onChange(items); }
      return;
    }
    d.el.remove();
    let pts = simplify(d.pts, 0.6);
    let minX = Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { if (x < minX) minX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const pk = pickAnchor(minX, (minY + maxY) / 2);
    pts = pts.map(([x, y]) => [r1(x - pk.box.x), r1(y - pk.box.y)]);
    snapshot();
    items.push({ id: uid(), t: tool, c: opts[tool].color, w: opts[tool].width, a: pk.a, p: pts });
    render(); onChange(items);
  }

  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    let t = dx || dy ? ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy) : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx - px, y = ay + t * dy - py;
    return Math.sqrt(x * x + y * y);
  }
  function eraseAt(e) {
    const pt = toPage(e.clientX, e.clientY);
    const list = anchors();
    const before = items.length;
    const tol = 6 / getScale();
    items = items.filter((it) => {
      if (it.t !== 'pen' && it.t !== 'marker') return true;
      const o = originOf(it, list);
      const lim = it.w / 2 + tol;
      for (let i = 0; i < it.p.length; i++) {
        const a = it.p[i], b = it.p[Math.min(i + 1, it.p.length - 1)];
        if (distSeg(pt.x, pt.y, a[0] + o.x, a[1] + o.y, b[0] + o.x, b[1] + o.y) <= lim) return false;
      }
      return true;
    });
    // highlights / notes under the pointer
    const hit = document.elementsFromPoint(e.clientX, e.clientY);
    const ids = new Set();
    for (const el of hit) {
      const m = el.closest && el.closest('mark.ink-hl, .ink-note');
      if (m) ids.add(m.dataset.id);
    }
    if (ids.size) items = items.filter((it) => !ids.has(it.id));
    if (items.length !== before) {
      drawing.changed = true;
      if (ids.size) applyHighlights();
      render();
    }
  }

  // ---------- printing ----------
  const printed = [];
  function beforePrint() {
    afterPrint();
    if (!visible) return;
    const list = anchors();
    for (const it of items) {
      if (it.t !== 'pen' && it.t !== 'marker' && it.t !== 'note') continue;
      const anchor = resolveAnchor(it.a, list);
      if (!anchor) continue;
      // table rows cannot host positioned children reliably: use the first cell, shifted
      let el = anchor, sx = 0, sy = 0;
      if (anchor.tagName === 'TR' && anchor.cells[0]) {
        el = anchor.cells[0];
        const a = relBox(anchor), h = relBox(el); sx = a.x - h.x; sy = a.y - h.y;
      }
      if (getComputedStyle(el).position === 'static') { el.style.position = 'relative'; printed.push({ restore: el }); }
      const cl = (el.clientLeft || 0) - sx, ct = (el.clientTop || 0) - sy;
      if (it.t === 'note') {
        const n = document.createElement('div');
        n.className = 'ink-note ink-print';
        n.style.cssText = `left:${it.x - cl}px;top:${it.y - ct}px;--nc:${strokeColor(it.c)};z-index:3`;
        const b = document.createElement('div'); b.className = 'nbody'; b.textContent = it.text || '';
        n.appendChild(b);
        el.appendChild(n); printed.push({ node: n });
      } else {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of it.p) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
        const pad = it.w;
        const s = document.createElementNS(SVGNS, 'svg');
        s.setAttribute('class', 'ink-print');
        s.setAttribute('width', maxX - minX + pad * 2);
        s.setAttribute('height', maxY - minY + pad * 2);
        s.style.cssText = `position:absolute;left:${minX - pad - cl}px;top:${minY - pad - ct}px;overflow:visible;pointer-events:none;z-index:3`;
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', pathD(it.p));
        p.setAttribute('transform', `translate(${pad - minX} ${pad - minY})`);
        p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
        p.setAttribute('stroke-width', it.w);
        p.setAttribute('stroke', it.c === 'ink' ? '#1d2533' : it.c);
        if (it.t === 'marker') { p.setAttribute('stroke-opacity', '0.4'); p.style.mixBlendMode = 'multiply'; }
        s.appendChild(p);
        el.appendChild(s); printed.push({ node: s });
      }
    }
  }
  function afterPrint() {
    while (printed.length) {
      const x = printed.pop();
      if (x.node) x.node.remove();
      if (x.restore) x.restore.style.position = '';
    }
  }

  // ---------- public API ----------
  function setTool(t) {
    tool = t;
    if (onToolChange) onToolChange(t);
  }

  window.Ink = {
    init(o) {
      page = o.page; article = o.article; svg = o.svg; notesLayer = o.notes;
      getScale = o.getScale; onChange = o.onChange; onToolChange = o.onToolChange;
      svg.addEventListener('pointerdown', onPointerDown);
      svg.addEventListener('pointermove', onPointerMove);
      svg.addEventListener('pointerup', onPointerUp);
      svg.addEventListener('pointercancel', onPointerUp);
      window.addEventListener('beforeprint', beforePrint);
      window.addEventListener('afterprint', afterPrint);
      updateButtons();
    },
    /** Load annotations for the freshly rendered document. */
    load(list) {
      items = Array.isArray(list) ? list : [];
      undoStack = []; redoStack = []; updateButtons();
      applyHighlights(); render();
    },
    /** Re-apply after the document was re-rendered (same file). */
    reapply() { applyHighlights(); render(); },
    relayout() { render(); },
    items: () => items,
    count: () => items.length,
    setTool,
    get tool() { return tool; },
    opts,
    highlightSelection,
    undo, redo,
    clear() { if (!items.length) return; snapshot(); items = []; applyHighlights(); render(); onChange(items); },
    setVisible(v) { visible = v; },
    beforePrint, afterPrint
  };
})();
