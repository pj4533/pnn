// Projector stage, 2D side: listens to the 3D scene's 'pnn:hero' (10 Hz) and 'pnn:heropulse' events and makes the cards, connector
// beam, eye-wall reticle, frame label and chyron share the hero's accent and position. See css/stage.css.
// pnn:hero detail: { x, y, rx, ry (CSS px, top-down), color, colorA, colorB, dir, energy, alert }.
const E = 1.15;                 // eye-wall radius in widget radii (matches the 3D halo ring)
const SVG = 'http://www.w3.org/2000/svg';
const UP = '#3dff8a', DOWN = '#ff2e55';

export function createStageLink(root, overlay) {
  const doc = document.documentElement, body = document.body;
  const frame = root.querySelector('.frame'), lbl = root.querySelector('.frame-lbl'), left = root.querySelector('.ov-left');
  const link = document.createElementNS(SVG, 'svg');
  link.id = 'heroLink';
  link.setAttribute('aria-hidden', 'true');
  link.innerHTML = `
    <defs><linearGradient id="hlGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0"/><stop offset=".5" stop-color="#fff"/><stop offset="1"/></linearGradient></defs>
    <ellipse class="hl-ret" pathLength="100" cx="0" cy="0" rx="10" ry="10"/>
    <g class="hl-conn">
      <path class="hl-glow" pathLength="100" d=""/>
      <path class="hl-line" pathLength="100" stroke="url(#hlGrad)" d=""/>
      <path class="hl-run" pathLength="100" d=""/>
      <rect class="hl-tab" x="0" y="0" width="0" height="0" rx="1"/>
      <path class="hl-arc" d=""/>
      <circle class="hl-dot" r="2.5" cx="0" cy="0"/>
    </g>`;
  // z just below the cards: first child of the overlay
  const spill = document.createElement('div'); spill.className = 'hl-spill';
  root.prepend(spill); root.prepend(link);
  const $ = (s) => link.querySelector(s);
  const ret = $('.hl-ret'), glow = $('.hl-glow'), line = $('.hl-line'), run = $('.hl-run'), tab = $('.hl-tab'), arc = $('.hl-arc'), dot = $('.hl-dot'), grad = $('#hlGrad');

  const tgt = { x: 0, y: 0, rx: 1, ry: 1 }, cur = { x: 0, y: 0, rx: 1, ry: 1 };
  let have = false, alert = false, raf = 0, linkHidden = null, lastHero = null;
  const set = (el, k, v) => el.setAttribute(k, v);

  // ---- card measurement: right edge x, and the y of the big-% / headline row (or the lit board row)
  const ROWS = ['.row.on', '.big', '.bc-num', '.sw', '.bc-dl', '.headline', '.bc-head', '.sotd-board'];
  let card = null;   // { right, top, bottom, y }
  // untransformed layout position of el inside #overlay (the cards animate in with transforms; the beam wants the settled spot)
  function layoutBox(el) {
    let x = 0, y = 0, n = el;
    while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }
  function measureCard() {
    const c = left?.querySelector('.card');
    if (!c || document.body.dataset.segment === 'standby') { card = null; return; }
    const r = layoutBox(c);
    if (r.w < 10 || r.h < 10) { card = null; return; }
    let y = r.y + r.h * 0.4;
    for (const s of ROWS) { const el = c.querySelector(s); if (el && el.offsetHeight > 4) { const e = layoutBox(el); y = e.y + e.h / 2; break; } }
    card = { right: r.x + r.w, top: r.y, bottom: r.y + r.h, y };
  }

  function drawLink() {
    const W = window.innerWidth, H = window.innerHeight;
    link.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const RX = cur.rx * E, RY = cur.ry * E;
    set(ret, 'cx', cur.x); set(ret, 'cy', cur.y); set(ret, 'rx', RX); set(ret, 'ry', RY);
    // frame label: left-aligned to the hero's left edge, just above the ellipse top, clamped inside the frame
    if (frame && lbl && lbl.textContent) {
      const f = frame.getBoundingClientRect(), lw = lbl.offsetWidth, lh = lbl.offsetHeight;
      const lx = Math.min(Math.max(cur.x - cur.rx - f.left, 6), Math.max(6, f.width - lw - 6));
      const ly = Math.min(Math.max(cur.y - RY - lh - 4 - f.top, 2), Math.max(2, f.height - lh - 2));
      lbl.style.left = `${lx.toFixed(1)}px`; lbl.style.top = `${ly.toFixed(1)}px`;
    }
    // connector
    const gap = card ? (cur.x - cur.rx * E) - card.right : -1;
    const hide = !card || alert || gap < W * 0.03;
    if (hide !== linkHidden) { linkHidden = hide; link.classList.toggle('hl-hide', hide); spill.classList.toggle('on', !hide); }
    if (card) {
      // spill: the light the projector throws onto the glass edge (width limited by the free gap)
      spill.style.left = `${card.right}px`; spill.style.top = `${card.top}px`; spill.style.height = `${card.bottom - card.top}px`;
      spill.style.width = `${Math.max(0, Math.min(W * 0.03, gap * 0.5)).toFixed(1)}px`;
    }
    if (hide) return;
    const x0 = card.right, y0 = card.y;
    const yc = Math.min(Math.max(y0, cur.y - 0.7 * RY), cur.y + 0.7 * RY);
    const u = (yc - cur.y) / RY;
    const x1 = cur.x - RX * Math.sqrt(Math.max(0, 1 - u * u));
    const dx = (x1 - x0) * 0.5;
    const d = `M${x0.toFixed(1)} ${y0.toFixed(1)}C${(x0 + dx).toFixed(1)} ${y0.toFixed(1)} ${(x1 - dx).toFixed(1)} ${yc.toFixed(1)} ${x1.toFixed(1)} ${yc.toFixed(1)}`;
    for (const p of [glow, line, run]) set(p, 'd', d);
    set(grad, 'x1', x0); set(grad, 'x2', x1);
    const tw = Math.max(3, W * 0.005), th = Math.max(14, H * 0.02);
    set(tab, 'x', x0 - tw + 1); set(tab, 'y', y0 - th / 2); set(tab, 'width', tw); set(tab, 'height', th);
    // reticle arc ON the eye-wall (never inside the widget): ~1.2vw long, centred on the connector's end point
    const t0 = Math.atan2((yc - cur.y) / RY, (x1 - cur.x) / RX), half = (W * 0.006) / Math.max(1, (RX + RY) / 2);
    let a = '';
    for (let i = 0; i <= 8; i++) { const t = t0 - half + (2 * half * i) / 8; a += `${i ? 'L' : 'M'}${(cur.x + RX * Math.cos(t)).toFixed(1)} ${(cur.y + RY * Math.sin(t)).toFixed(1)}`; }
    set(arc, 'd', a); set(dot, 'cx', x1.toFixed(1)); set(dot, 'cy', yc.toFixed(1));
  }

  // glide toward the 10 Hz targets so camera flights track smoothly (SVG path `d` can't use a CSS transition in Safari)
  function step() {
    raf = 0;
    let moving = false;
    for (const k of ['x', 'y', 'rx', 'ry']) {
      const dlt = tgt[k] - cur[k];
      if (Math.abs(dlt) > 0.15) { cur[k] += dlt * 0.3; moving = true; } else cur[k] = tgt[k];
    }
    drawLink();
    if (moving) raf = requestAnimationFrame(step);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(step); };

  // ---- show/hide choreography: fade out during a transition beat / arrival, draw in left to right once the widget lands
  let showT = 0;
  function hideThenShow(ms) {
    link.classList.add('hl-off'); link.classList.remove('draw');
    clearTimeout(showT);
    showT = setTimeout(() => {
      measureCard(); drawLink();
      link.classList.remove('hl-off'); void link.getBoundingClientRect(); link.classList.add('draw');
    }, ms);
  }
  document.addEventListener('pnn:beat', (e) => {
    const b = e.detail || {}; hideThenShow(800 + Math.max(0, (b.dur || 0.9) * (b.peak ?? 0.5) * 1000 - 400));
  });

  // ---- hero events
  function onHero(e) {
    const h = e.detail; if (!h) return;
    lastHero = h; have = true;
    tgt.x = h.x; tgt.y = h.y; tgt.rx = Math.max(8, h.rx); tgt.ry = Math.max(8, h.ry);
    if (!cur.rx || cur.rx === 1) Object.assign(cur, tgt);
    alert = !!h.alert;
    const st = doc.style;
    st.setProperty('--story', h.color || '#00f0ff'); st.setProperty('--story-a', h.colorA || h.color || '#7a2cff'); st.setProperty('--story-b', h.colorB || h.color || '#ff2bd6');
    st.setProperty('--move', h.dir > 0 ? UP : h.dir < 0 ? DOWN : (h.color || '#00f0ff'));
    st.setProperty('--energy', Math.max(0, Math.min(1, h.energy ?? 0.3)).toFixed(2));
    st.setProperty('--hero-x', `${h.x.toFixed(0)}px`); st.setProperty('--hero-y', `${h.y.toFixed(0)}px`);
    st.setProperty('--hero-rx', `${h.rx.toFixed(0)}px`); st.setProperty('--hero-ry', `${h.ry.toFixed(0)}px`);
    st.setProperty('--sheen-d', `-${((performance.now() / 1000) % 6).toFixed(2)}s`);   // new card nodes join the sheen at the shared phase
    doc.classList.toggle('hero-alert', alert);
    link.classList.add('on');
    measureCard(); kick();
  }
  let pulseT = 0;
  function onPulse(e) {
    const p = e.detail || {};
    doc.classList.add('hero-pulse'); link.classList.add('pulse');
    clearTimeout(pulseT); pulseT = setTimeout(() => { doc.classList.remove('hero-pulse'); link.classList.remove('pulse'); }, 600);
    if (p.type === 'arrive') hideThenShow(900);
  }
  document.addEventListener('pnn:hero', onHero);
  document.addEventListener('pnn:heropulse', onPulse);

  // ---- re-measure when the card changes or the window resizes
  let mq = 0;
  const remeasure = () => { if (mq) return; mq = requestAnimationFrame(() => { mq = 0; measureCard(); if (have) { drawLink(); } }); };
  if (left) new MutationObserver(remeasure).observe(left, { childList: true });
  window.addEventListener('resize', remeasure);
  if (lbl) new MutationObserver(remeasure).observe(lbl, { childList: true, characterData: true, subtree: true });
  // the beam also needs re-measuring after the entrance animation has settled
  setInterval(() => { if (have) { measureCard(); drawLink(); } }, 1000);

  const api = { get hero() { return lastHero; }, get card() { return card; }, cur, get hidden() { return linkHidden; } };
  window.__pnnStageLink = api;
  return api;
}

/** iPad / low-fps hooks: body.ipad on coarse-pointer devices, body.lowfx when the 3D fps guard has shed env quality to 0. */
export function watchFx() {
  const q = new URLSearchParams(location.search);
  if (q.has('ipad') || (matchMedia('(hover: none) and (pointer: coarse)').matches)) document.body.classList.add('ipad');
  const apply = () => {
    let low = q.get('lowfx') === '1';
    try { const st = window.__pnnScene?.world?.env?.getState?.(); if (st && st.quality === 0) low = true; } catch { /* scene not ready */ }
    document.body.classList.toggle('lowfx', low);
  };
  apply(); setInterval(apply, 2000);
}
