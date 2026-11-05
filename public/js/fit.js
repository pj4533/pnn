// Text and panel fitting. Hard rules: no ellipsis, min font 0.7vw, text must fit (scrollWidth <= clientWidth),
// stacked panels never overflow into each other at any aspect ratio.
//
// 1. fitText(el): shrinks an element's font until it fits its own box, never below 0.7vw.
//    Elements marked `.fit` are fitted. Add `data-fit-h` when the element has a fixed height and may wrap.
// 2. fitStack(box): for a fixed-height stacked container (`.fit-stack`): first hides optional blocks
//    (`[data-drop="1"]` goes first, then 2, ...), then applies a uniform zoom floored so no text drops below 0.7vw.

const minPx = () => (window.innerWidth * 0.7) / 100;

function overflows(e, checkH) {
  if (e.scrollWidth > e.clientWidth + 1) return true;
  if (!checkH) return false;
  // Glyph ascenders poke a few px past tight line boxes, so allow a quarter line of slack.
  const cs = getComputedStyle(e);
  // Only tight line boxes (line-height < 1.1) get that slack. With normal leading, extra height is real overflow, and
  // overflow:hidden clips it (this cut off the last line of BREAKING titles).
  const fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight);
  const tight = Number.isFinite(lh) ? lh / fs < 1.1 : false;
  const slack = tight ? Math.max(2, fs * 0.25) : 2;
  const cap = cs.maxHeight !== 'none' ? Math.min(parseFloat(cs.maxHeight), e.clientHeight) : e.clientHeight;
  return e.scrollHeight > cap + slack;
}

/** One-line "OUTLET · headline" text: the optional headline part ([data-opt]) is hidden whole when it doesn't fit (never truncated). */
export function fitOptional(e) {
  if (!e || !e.isConnected || !e.clientWidth) return;
  const opt = e.querySelector('[data-opt]');
  if (opt) opt.hidden = false;
  e.style.fontSize = '';
  if (opt && e.scrollWidth > e.clientWidth + 1) opt.hidden = true;
  let size = parseFloat(getComputedStyle(e).fontSize), g = 0;
  const floor = minPx();
  while (e.scrollWidth > e.clientWidth + 1 && size > floor && g++ < 30) { size = Math.max(floor, size * 0.93); e.style.fontSize = `${size}px`; }
}

export function fitText(e) {
  if (!e || !e.isConnected) return;
  e.style.fontSize = '';
  e.style.whiteSpace = '';
  const checkH = e.hasAttribute('data-fit-h');
  if (!e.clientWidth) return;
  let size = parseFloat(getComputedStyle(e).fontSize);
  const floor = minPx();
  let guard = 0;
  while (overflows(e, checkH) && size > floor && guard++ < 40) {
    size = Math.max(floor, size * 0.93);
    e.style.fontSize = `${size}px`;
  }
  // Still too wide at the minimum size: wrap instead (never truncate).
  if (e.scrollWidth > e.clientWidth + 1) e.style.whiteSpace = 'normal';
}

function smallestFont(box) {
  let min = Infinity;
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.textContent.trim()) continue;
    const p = n.parentElement;
    if (!p || p.offsetParent === null) continue;
    min = Math.min(min, parseFloat(getComputedStyle(p).fontSize));
  }
  return min;
}

export function fitStack(box) {
  if (!box || !box.isConnected || !box.clientHeight) return;
  const kids = [...box.children];
  kids.forEach((k) => (k.style.zoom = ''));
  const drops = [...box.querySelectorAll('[data-drop]')];
  drops.forEach((d) => d.classList.remove('dropped'));
  const fits = () => box.scrollHeight <= box.clientHeight + 1;
  if (fits()) return;
  const levels = [...new Set(drops.map((d) => Number(d.dataset.drop)))].sort((a, b) => a - b);
  for (const lv of levels) {
    drops.filter((d) => Number(d.dataset.drop) === lv).forEach((d) => d.classList.add('dropped'));
    if (fits()) return;
  }
  // Still too tall: uniform zoom, floored so the smallest text stays at or above 0.7vw.
  const sm = smallestFont(box);
  const floorZ = Number.isFinite(sm) ? Math.min(1, minPx() / sm) : 0.8;
  const z = Math.max(floorZ, (box.clientHeight / box.scrollHeight) * 0.985);
  if (z < 0.999) kids.forEach((k) => (k.style.zoom = String(Math.round(z * 1000) / 1000)));
}

/** Fit everything under root: texts first, then stacks (stack zoom keeps text proportions). */
export function fitAll(root = document) {
  root.querySelectorAll('.fit').forEach(fitText);
  root.querySelectorAll('[data-opt-parent]').forEach(fitOptional);
  root.querySelectorAll('.fit-stack').forEach(fitStack);
}

let raf = 0;
export function scheduleFit(root = document) {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => fitAll(root)); });
}

export function startAutoFit() {
  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => fitAll(), 120); });
  document.fonts?.ready?.then(() => fitAll()).catch(() => {});
}

/** Dev check used by tests: lists text that overflows or is smaller than 0.7vw. */
export function fitReport() {
  const bad = [];
  const floor = minPx() - 0.5;
  for (const e of document.querySelectorAll('#overlay *, #chyron *, #alerts *, #flash *')) {
    if (e.closest('.cy-view') || e.offsetParent === null) continue;
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') bad.push({ el: describe(e), why: 'overflow-x', sw: e.scrollWidth, cw: e.clientWidth });
    else if (hasText && e.clientWidth && e.scrollWidth > e.clientWidth + 1) bad.push({ el: describe(e), why: 'overflow-x', sw: e.scrollWidth, cw: e.clientWidth });
    if (hasText && /\u2026|\.\.\./.test(e.textContent)) bad.push({ el: describe(e), why: 'ellipsis' });
    if (hasText) {
      let z = 1; for (let a = e; a; a = a.parentElement) z *= Number(a.style?.zoom || 1);
      const fs = parseFloat(getComputedStyle(e).fontSize) * z;
      if (fs < floor) bad.push({ el: describe(e), why: 'font<0.7vw', px: Math.round(fs * 10) / 10, min: Math.round(minPx() * 10) / 10 });
    }
  }
  for (const s of document.querySelectorAll('.fit-stack')) if (s.scrollHeight > s.clientHeight + 1) bad.push({ el: describe(s), why: 'stack-overflow', sh: s.scrollHeight, ch: s.clientHeight });
  return bad;
}
const describe = (e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} "${(e.textContent || '').trim().slice(0, 40)}"`;
