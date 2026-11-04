// Breaking takeovers: "BREAKING: MARKET MOVE", ~8s, only for live SSE 'alert' events.
// Queued, deduped by id (and by market within 10 min), capped at 3, stale (>5 min) dropped. state.alerts is never replayed.
import { el, esc, pct, pctNum, exchangeName } from './util.js';
import { fitText } from './fit.js';

const DUR = 8000;
const MAX_QUEUE = 3;

export function createAlerts(root, { onStart, onEnd } = {}) {
  root.innerHTML = '';
  const seen = new Set();
  const recentByMarket = new Map();
  const queue = [];
  let showing = false;

  function play(a) {
    showing = true;
    const up = (a.to ?? 0) >= (a.from ?? 0);
    const pts = Math.round(Math.abs((a.to ?? 0) - (a.from ?? 0)) * 100);
    const wrap = el('div', `al ${up ? 'up' : 'down'}`);
    wrap.style.setProperty('--dur', `${DUR}ms`);
    wrap.innerHTML = `<div class="al-bg"></div>
      <div class="al-edge t"></div><div class="al-edge b"></div>
      <div class="al-bar" style="top:24vh"></div><div class="al-bar r" style="top:76vh;animation-delay:.25s"></div>
      <div class="al-ring"></div>
      <div class="al-stage">
        <div class="al-kick">BREAKING: MARKET MOVE</div>
        <div class="al-title fit" data-fit-h>${esc(a.short || a.headline || 'Sharp move in the markets')}</div>
        <div class="al-move">
          <span class="al-from">${esc(pctNum(a.from))}<small>%</small></span>
          <span class="al-arrow">▶</span>
          <span class="al-to">${esc(pctNum(a.to))}<small>%</small></span>
          <span class="al-delta"><b>${up ? 'UP' : 'DOWN'} ${pts} ${pts === 1 ? 'PT' : 'PTS'}</b><small>IN ${esc(String(Math.max(1, Math.round(a.minutes || 0))))} MIN</small></span>
        </div>
        ${a.line ? `<div class="al-sub fit" data-fit-h>${esc(a.line)}</div>` : ''}
        <div class="al-src fit">${esc(exchangeName(a.source).toUpperCase())} · MARKET ODDS, NOT A CALL · FROM ${esc(pct(a.from))} TO ${esc(pct(a.to))}</div>
      </div>
      <div class="al-flash"></div>`;
    root.append(wrap);
    requestAnimationFrame(() => wrap.querySelectorAll('.fit').forEach(fitText));
    try { onStart?.(a); } catch (e) { console.error(e); }
    setTimeout(() => {
      wrap.remove(); showing = false;
      try { onEnd?.(a); } catch (e) { console.error(e); }
      next();
    }, DUR + 100);
  }

  function next() {
    if (showing) return;
    while (queue.length) {
      const a = queue.shift();
      if (Date.now() - Date.parse(a.at || 0) > 5 * 60000 && a.at) continue;
      play(a);
      return;
    }
  }

  return {
    /** Mark alerts already in a state snapshot as seen: page loads and reconnects never replay them. */
    markSeen(alerts) { for (const a of alerts || []) if (a?.id != null) seen.add(a.id); },
    /** A live SSE 'alert' event. */
    enqueue(a) {
      if (!a || a.id == null || seen.has(a.id)) return;
      seen.add(a.id);
      if (a.at && Date.now() - Date.parse(a.at) > 5 * 60000) return;
      // one takeover per market AND per story (the same race on two exchanges is one story)
      const keys = [a.marketId && `m:${a.marketId}`, a.storyId && `s:${a.storyId}`].filter(Boolean);
      if (keys.some((k) => recentByMarket.has(k) && Date.now() - recentByMarket.get(k) < 10 * 60000)) return;
      for (const k of keys) recentByMarket.set(k, Date.now());
      queue.push(a);
      while (queue.length > MAX_QUEUE) queue.shift(); // keep the freshest
      next();
    },
    get showing() { return showing; },
  };
}
