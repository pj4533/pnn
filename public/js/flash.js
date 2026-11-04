// NEWS MEETS MARKETS: a side takeover over the left column (~10s) when a breaking news story trades somewhere.
// Only live SSE 'flash' events play; state.flashes is never replayed. Queued, deduped by id (and by story within
// 10 min), capped at 3, stale (> 10 min) dropped. Paused while a BREAKING takeover is on air.
import { el, esc, pctNum, moveText, moveCls, money, exchangeName, ago } from './util.js';
import { fitText, fitStack } from './fit.js';

// ?fixture=1&hold=1 keeps a flash up for 60s (screenshots and layout checks).
const DUR = new URLSearchParams(location.search).has('hold') ? 60000 : 10000;
const MAX_QUEUE = 3;
const STALE_MS = 10 * 60000;

function sinceText(d) {
  if (d == null || Math.abs(d) < 0.01) return '';
  const n = Math.sign(d) * Math.round(Math.abs(d) * 100); // magnitude rounding, matches server copy
  return `${n > 0 ? 'UP' : 'DOWN'} ${Math.abs(n)} ${Math.abs(n) === 1 ? 'PT' : 'PTS'} SINCE THE NEWS`;
}

function row(m, i) {
  const mv = moveText(m.change1d);
  const since = sinceText(m.changeSinceNews);
  return `<div class="fl-row${i === 0 ? ' lead' : ''}" style="--i:${i}" ${i >= 2 ? 'data-drop="2"' : i === 1 ? 'data-drop="3"' : ''}>
    <div class="fl-lab fit" data-fit-h>${esc(m.label)}</div>
    <div class="fl-nums">
      <span class="fl-p">${esc(pctNum(m.yesPrice))}<small>%</small></span>
      <span class="fl-mvs">
        ${mv ? `<span class="fl-mv ${moveCls(m.change1d)} fit">${esc(mv.toUpperCase())}</span>` : ''}
        ${since ? `<span class="fl-sn ${moveCls(m.changeSinceNews)} fit">${esc(since)}</span>` : ''}
      </span>
    </div>
    <div class="fl-src"><span class="fit"><b>${esc(exchangeName(m.source).toUpperCase())}</b> · ${esc(m.volumeText || money(m.volume24h))} TRADED IN 24 HRS · UPDATED ${esc(ago(m.updatedAt).toUpperCase())}</span>${m.thin ? '<span class="thin sm">THIN MARKET</span>' : ''}</div>
  </div>`;
}

export function createFlashes(root, { onStart, onEnd, onClick } = {}) {
  root.innerHTML = '';
  const seen = new Set();
  const recent = new Map();   // story/market key -> ms
  const queue = [];
  let showing = null, timer = 0, paused = false;

  function finish(cut) {
    clearTimeout(timer);
    const f = showing?.f, wrap = showing?.wrap;
    if (!showing) return;
    showing = null;
    wrap.classList.add('out');
    setTimeout(() => wrap.remove(), 450);
    try { onEnd?.(f, { cut }); } catch (e) { console.error(e); }
    if (!cut) setTimeout(next, 500);
  }

  function play(f) {
    const ms = (f.markets || []).slice(0, 3);
    const wrap = el('div', 'fl');
    wrap.style.setProperty('--dur', `${DUR}ms`);
    wrap.innerHTML = `
      <div class="fl-kick"><span class="fl-k1">NEWS</span><span class="fl-k2">MEETS MARKETS</span><i class="fl-pulse"></i></div>
      <div class="fl-body fit-stack">
        <div class="fl-news">
          <div class="fl-lbl">ON THE WIRE</div>
          <div class="fl-head fit" data-fit-h>${esc(f.headline)}</div>
          <div class="fl-credit fit">${esc((f.credit || 'News wire').toUpperCase())}${f.newsAt ? ` · ${esc(ago(f.newsAt).toUpperCase())}` : ''}</div>
        </div>
        <div class="fl-sec">WHAT THE MARKETS ARE PRICING</div>
        ${ms.map(row).join('')}
        ${f.line ? `<div class="fl-line fit" data-fit-h data-drop="1">${esc(f.line)}</div>` : ''}
        <div class="fl-note fit">ODDS ARE NOT FACTS · MARKET PRICES, NOT CALLS</div>
      </div>
      <div class="fl-prog"></div>`;
    wrap.addEventListener('click', () => { try { onClick?.(f); } catch (e) { console.error(e); } });
    root.append(wrap);
    showing = { f, wrap };
    const fit = () => { wrap.querySelectorAll('.fit').forEach(fitText); wrap.querySelectorAll('.fit-stack').forEach(fitStack); };
    requestAnimationFrame(() => requestAnimationFrame(fit));
    document.fonts?.ready?.then(fit).catch(() => {});
    try { onStart?.(f); } catch (e) { console.error(e); }
    timer = setTimeout(() => finish(false), DUR);
  }

  function next() {
    if (showing || paused) return;
    while (queue.length) {
      const f = queue.shift();
      if (f.at && Date.now() - Date.parse(f.at) > STALE_MS) continue;
      play(f);
      return;
    }
  }

  window.addEventListener('resize', () => {
    const w = showing?.wrap;
    if (w) setTimeout(() => { w.querySelectorAll('.fit').forEach(fitText); w.querySelectorAll('.fit-stack').forEach(fitStack); }, 150);
  });

  return {
    /** Flashes already in a state snapshot: page loads and reconnects never replay them. */
    markSeen(list) { for (const f of list || []) if (f?.id != null) seen.add(f.id); },
    /** A live SSE 'flash' event. */
    enqueue(f) {
      if (!f || f.id == null || seen.has(f.id) || !f.markets?.length) return;
      seen.add(f.id);
      if (f.at && Date.now() - Date.parse(f.at) > STALE_MS) return;
      const keys = [f.storyId && `s:${f.storyId}`, `m:${f.markets[0].id}`].filter(Boolean);
      if (keys.some((k) => recent.has(k) && Date.now() - recent.get(k) < 10 * 60000)) return;
      for (const k of keys) recent.set(k, Date.now());
      queue.push(f);
      while (queue.length > MAX_QUEUE) queue.shift();
      next();
    },
    /** Pause for a BREAKING takeover: cuts the flash on air (it is not replayed) and holds the queue. */
    pause(on) {
      paused = !!on;
      if (paused && showing) finish(true);
      if (!paused) setTimeout(next, 600);
    },
    /** End the current flash now (e.g. it was clicked). */
    cut() { if (showing) finish(true); },
    get showing() { return showing?.f || null; },
  };
}
