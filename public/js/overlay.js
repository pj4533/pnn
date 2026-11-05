// Overlay layer: top bar (PNN bug, LIVE, segment title, ET clock), left column, bottom strip, stage frame.
import { etClock, etDate } from './util.js';
import { leadCard, miniCard, focusCard, standbyCard } from './panels.js';
import { segmentCard, sotdCard, countdownCard, marketsCard } from './cards.js';
import { esc } from './util.js';
import { scheduleFit } from './fit.js';

export const SEG_TITLES = { top: 'TOP STORIES', focus: 'STORY FOCUS', movers: 'BIGGEST MOVERS', week: 'THIS WEEK', desk: 'DESK', sotd: 'STORY OF THE DAY', countdown: 'COUNTDOWN DESK', markets: 'MARKETS', standby: 'STANDING BY' };

export function createOverlay(root) {
  root.innerHTML = `
    <header class="ov-top">
      <div class="bug"><div class="bug-mark">PNN</div><div class="bug-txt"><b>PRE NEWS NETWORK</b><span>WHAT THE MARKETS ARE PRICING</span></div></div>
      <div class="live"><i></i>LIVE</div>
      <div class="seg"><span class="seg-t"></span><span class="seg-s fit"></span><span class="nx"></span></div>
      <div class="feeds"></div>
      <div class="clock"><span class="clock-t"></span><span class="clock-z">ET</span><span class="clock-d"></span></div>
    </header>
    <div class="conn" hidden>RECONNECTING</div>
    <div class="ov-left fit-stack"></div>
    <div class="ov-strip"></div>
    <div class="frame"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i></div><!-- no "LIVE 3D //" tag: the widgets name their own subject (user, 2026-11-05) -->`;
  const $ = (s) => root.querySelector(s);
  const left = $('.ov-left'), strip = $('.ov-strip'), frame = $('.frame');
  const segT = $('.seg-t'), segS = $('.seg-s'), feedsEl = $('.feeds'), conn = $('.conn');
  const clockT = $('.clock-t'), clockD = $('.clock-d'), nx = $('.nx'), top = $('.ov-top');

  const tick = () => { clockT.textContent = etClock(); clockD.textContent = etDate().toUpperCase(); };
  tick(); setInterval(tick, 1000);

  let lastKey = '';
  // Background beats (scene/index.js dispatches 'pnn:beat' when a scene transition fires on a card change): the card
  // swap that goes with it animates in the transition's style, landing at the background reveal (dur * peak).
  const BEAT_CLS = ['beat', 'beat-morph', 'beat-warp', 'beat-vhs', 'beat-scanwipe', 'beat-inkbleed', 'beat-gridfold', 'beat-wormhole', 'beat-whip'];
  let pendingBeat = null, lastFreshAt = -1e9;
  function applyBeat(host, b) {
    host.classList.remove('in', ...BEAT_CLS); void host.offsetWidth;
    host.style.setProperty('--beat-dur', `${b.dur}s`);
    host.style.setProperty('--beat-at', `${(b.dur * b.peak).toFixed(2)}s`);
    host.classList.add('beat', 'beat-' + b.type);
  }
  document.addEventListener('pnn:beat', (e) => {
    const b = e.detail; if (!b?.type) return;
    if (performance.now() - lastFreshAt < 300) { applyBeat(left, b); applyBeat(strip, b); pendingBeat = null; }
    else pendingBeat = { ...b, recv: performance.now() };
  });
  function takeBeat() {
    const b = pendingBeat; pendingBeat = null;
    return b && performance.now() - b.recv < 1500 ? b : null;
  }
  let lastNext = [null, null];   // re-fit the NEXT tease on resize / iPad rotation (its shrink is width-dependent)
  window.addEventListener('resize', () => { if (lastNext[0]) api.setNext(...lastNext); });
  function settle(host) {
    for (const a of host.getAnimations({ subtree: true })) {
      const it = a.effect?.getTiming?.().iterations;
      if (it !== Infinity) { try { a.finish(); } catch { /* not finishable */ } }
    }
  }
  // THEN vs NOW count-up, driven by JS: the old CSS @property counter didn't interpolate in Safari (it sat at 0 for 2s,
  // then popped to the final number). Counts from yesterday's value to today's over 2s after a 0.3s beat.
  function countUps(host, animate) {
    host.querySelectorAll('.sw-nv[data-to]').forEach((el) => {
      const from = Number(el.dataset.from), to = Number(el.dataset.to);
      if (!animate || !Number.isFinite(from) || !Number.isFinite(to)) { el.textContent = String(to); return; }
      el.textContent = String(from);
      const t0 = performance.now() + 300, dur = 2000;
      const ease = (k) => 1 - Math.pow(1 - k, 3);
      const step = (t) => {
        if (!el.isConnected) return;
        const k = Math.min(1, Math.max(0, (t - t0) / dur));
        el.textContent = String(Math.round(from + (to - from) * ease(k)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  // The glass sheen (stage.css .sheen) is a real element so its moving layer is clipped by its own box: one <i class="sheen"> first in every
  // .card / .mini. --sheen-d puts every panel at the shared phase of the 3 s sweep (set once per render, not on every 10 Hz hero event).
  const SHEEN = '<i class="sheen" aria-hidden="true"></i>';
  function sheen(host) {
    host.style.setProperty('--sheen-d', `-${((performance.now() / 1000) % 3).toFixed(2)}s`);
    for (const el of host.children) if ((el.classList.contains('card') || el.classList.contains('mini')) && !el.firstElementChild?.classList.contains('sheen')) el.insertAdjacentHTML('afterbegin', SHEEN);
  }
  function swap(host, html, key, beat = null) {
    if (host.dataset.key === key) {
      // Same card, fresh numbers (an SSE state update): swap the content but don't replay entrance animations,
      // which made the card "display again" a second or two after it appeared. Looping effects keep running.
      host.innerHTML = html;
      sheen(host);
      settle(host);
      return;
    }
    host.dataset.key = key;
    host.classList.remove('in', ...BEAT_CLS); void host.offsetWidth;
    host.innerHTML = html;
    sheen(host);
    if (beat) applyBeat(host, beat); else host.classList.add('in');
  }

  // The stage link, one per card kind: a port on the card's stage-facing edge at the height of the card's key row (lit row, big %, dial,
  // board...), with a pulse running out of it. The long connector beam (stagelink.js) only fits where the free gap is wide (TOP STORIES);
  // the dock is the equivalent link everywhere else, so every card visibly feeds the widget.
  const LINK_ROWS = ['.row.on', '.big', '.bc-num', '.fin-num', '.sw', '.bc-dl', '.sotd-board', '.cd-i.first', '.headline', '.bc-head'];
  function addLink(host) {
    const card = host.querySelector('.card');
    if (!card || card.querySelector(':scope > .lk')) return;
    let y = card.offsetHeight * 0.4;
    for (const sel of LINK_ROWS) {
      const r = card.querySelector(sel);
      if (r && r.offsetHeight > 4) { let t = 0, n = r; while (n && n !== card) { t += n.offsetTop; n = n.offsetParent; } y = t + r.offsetHeight / 2; break; }
    }
    card.style.setProperty('--lk-y', `${Math.round(y)}px`);
    card.insertAdjacentHTML('beforeend', '<i class="lk" aria-hidden="true"><b></b></i>');
  }

  function setTitle(id, sub, title) {
    const t = title || SEG_TITLES[id] || '';
    if (segT.textContent !== t) { segT.textContent = t; segT.classList.remove('glitch'); void segT.offsetWidth; segT.classList.add('glitch'); }
    segS.textContent = sub || '';
  }

  function feeds(state) {
    const f = state?.feeds || {};
    const row = ['polymarket', 'kalshi'].filter((k) => f[k]).map((k) => {
      const ok = f[k].ok !== false;
      return `<span class="feed ${ok ? 'ok' : 'bad'}"><i></i>${k === 'polymarket' ? 'POLYMARKET' : 'KALSHI'}</span>`;
    }).join('');
    feedsEl.innerHTML = row + (state?.sim ? '<span class="feed sim">REPLAY DATA</span>' : '');
  }

  function baseStage() {
    // viewport fractions of the open 3D area for the current layout
    const seg = document.body.dataset.segment;
    if (seg === 'top') return { x0: 0.308, x1: 0.992, y0: 0.084, y1: 0.63 };
    if (seg === 'desk' || seg === 'movers' || seg === 'week' || seg === 'focus' || seg === 'sotd' || seg === 'countdown' || seg === 'markets') return { x0: 0.49, x1: 0.992, y0: 0.084, y1: 0.78 }; // full-screen cards take the left 48%
    return { x0: 0.308, x1: 0.992, y0: 0.084, y1: 0.78 };
  }
  const api = {
    /** seg: {id, story?, index?, count?}. */
    render(seg, state, now = Date.now()) {
      document.body.dataset.segment = seg.id;
      if (seg.desk) document.body.dataset.desk = seg.desk.id; else delete document.body.dataset.desk;
      // every card (desk, movers, this week) animates in on its own
      const key = `${seg.id}|${seg.desk?.id || ''}|${seg.story?.id || ''}|${seg.index ?? ''}`;
      const fresh = key !== lastKey; lastKey = key;
      let html = '', stripHtml = '', label = '', sub = '', title = '';
      if (seg.id === 'top') {
        const [lead, ...rest] = state.stories;
        html = leadCard(lead, now);
        const n = window.innerWidth / window.innerHeight > 2.1 ? 3 : 4;
        stripHtml = rest.slice(0, n).map((s, i) => miniCard(s, now, i + 1)).join('');
        label = lead.eventTitle; sub = `${state.stories.length} stories on the board`;
      } else if (seg.id === 'focus') {
        html = segmentCard(seg, now);   // full-height card like desk/movers/week (user: the compact focus card left half the column empty)
        label = seg.story.eventTitle; sub = seg.story.eventTitle;
      } else if (seg.id === 'movers' && seg.story) {
        html = segmentCard(seg, now);
        label = seg.story.eventTitle || 'Biggest movers'; sub = `Largest 24-hour swings · #${seg.index + 1} of ${seg.count}`;
      } else if (seg.id === 'week' && seg.story) {
        html = segmentCard(seg, now);
        label = seg.story.eventTitle || 'This week'; sub = `Resolving within 7 days · #${seg.index + 1} of ${seg.count}`;
      } else if (seg.id === 'sotd') {
        html = sotdCard(seg.sotd, state, now);
        label = seg.story?.eventTitle || seg.sotd?.title || ''; sub = seg.sotd?.credit || '';
      } else if (seg.id === 'countdown') {
        html = countdownCard(state?.countdown, now, (id) => [...(state.stories || []), ...(state.closing || []), ...(state.desks || []).flatMap((d) => d.stories || [])].find((x) => x.id === id)?.news);
        label = seg.story?.eventTitle || 'Next big decisions'; sub = 'Next scheduled decisions';
      } else if (seg.id === 'markets' && seg.story?.fin) {
        html = marketsCard(seg, now);
        label = seg.story.eventTitle || 'Markets'; sub = 'Stocks, bonds and what the markets are pricing';
      } else if (seg.id === 'desk') {
        html = segmentCard(seg, now);
        label = seg.story.eventTitle; title = seg.desk.title || `${seg.desk.id.toUpperCase()} DESK`;
        sub = `#${seg.index + 1} of ${seg.count} on the desk`;
      } else {
        html = standbyCard();
      }
      if (seg.story?.swing && /^(focus|movers|week|desk)$/.test(seg.id)) title = seg.story.swing.title || { swing: 'BIGGEST SWINGS', longshot: 'LONGSHOTS ON THE MOVE', slipping: 'FAVORITES SLIPPING' }[seg.story.swing.shape] || 'BIGGEST SWINGS';
      if (!html) html = standbyCard();
      setTitle(seg.id, sub, title);
      feeds(state);
      if (fresh) { const b = takeBeat(); swap(left, html, key, b); swap(strip, stripHtml, key, b); countUps(left, true); lastFreshAt = performance.now(); }
      else { left.innerHTML = html; strip.innerHTML = stripHtml; sheen(left); sheen(strip); settle(left); settle(strip); countUps(left, false); }  // in-place refresh: no replayed entrances
      if (seg.id !== 'standby') addLink(left);
      frame.classList.toggle('short', seg.id === 'top');
      scheduleFit(root);
      // the connector beam (stagelink.js) re-measures the card once the fit pass has resized it (fit runs 2 frames after this; this fires on the 3rd)
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => document.dispatchEvent(new Event('pnn:cardfit')))));
    },
    /** Top-bar tease: "NEXT: <a> · then <b>". The "then" part drops when the pair doesn't fit. */
    setNext(a, b) {
      lastNext = [a, b];
      if (!a) { nx.innerHTML = ''; top.classList.remove('has-next'); return; }
      top.classList.add('has-next');
      const full = `<b>NEXT</b>${esc(a)}${b ? `<i> · then ${esc(b)}</i>` : ''}`;
      nx.dataset.html = full; // refit every time: the room changes when the top-bar title shows/hides
      // one line, never wrapped: full pair, else the pair shrunk (floor .7vw), else just the next card (shrunk if needed)
      requestAnimationFrame(() => {
        const floor = window.innerWidth * 0.007;
        const tryFit = (html) => {
          nx.innerHTML = html; nx.style.fontSize = '';
          let size = parseFloat(getComputedStyle(nx).fontSize), g = 0;
          while (nx.scrollWidth > nx.clientWidth + 1 && size > floor && g++ < 30) { size = Math.max(floor, size * 0.93); nx.style.fontSize = `${size}px`; }
          return nx.scrollWidth <= nx.clientWidth + 1;
        };
        if (!tryFit(full) && b) tryFit(`<b>NEXT</b>${esc(a)}`);
      });
    },
    /** While something other than the card drives the 3D (a news flash), the frame label names that story. null restores. */
    setFrameLabel() {},   // the LIVE 3D tag was removed; kept as a no-op for callers
    setConnected(ok) { conn.hidden = !!ok; },
    get stageRect() {
      const r = baseStage();
      // the NEXT BIG DECISION chip (position: fixed, lower-right) sits over the stage: frame the hologram above it. offsetParent is null for
      // every fixed element, so the old `chip.offsetParent !== null` test never passed; measure the box and the computed style instead.
      const chip = document.getElementById('chip');
      if (chip && chip.childElementCount) {
        const cs = getComputedStyle(chip), c = chip.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
        const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && c.width > 0 && c.height > 0;
        const top = c.top / H;
        if (shown && c.right / W > r.x0 && c.left / W < r.x1 && top > r.y0 + 0.25 && top < r.y1) r.y1 = top - 0.01;
      }
      return r;
    },
  };
  return api;
}
