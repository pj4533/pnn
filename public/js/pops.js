// Corner pops: ON THE MOVE / STILL MOVING ('move'), JUST LISTED ('listed'), MONEY MOVING ('money'). Small, top-right of
// the 3D stage, 4s each, no takeover. Queued (max 3, freshest kept), at least 60s between pops, paused while a BREAKING
// alert or a NEWS MEETS MARKETS flash is up, stale (>5 min) dropped. Only live SSE events pop: ids already in a state
// snapshot (state.moves / listed / money) are marked seen, so a page load or reconnect never replays them.
// Copy rules: no "bet"/"wager"/"Bettors", never "will", no trader names; MONEY MOVING only for prices 5%–95%.
import { esc, pct, money, exchangeName, ptsOf } from './util.js';
import { fitText } from './fit.js';

const DUR = 4000, MAX_QUEUE = 3, STALE = 5 * 60000;
const hhmm = (t) => new Date(Date.parse(t) || Date.now()).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const pts = (d) => { const n = Math.abs(ptsOf(d) ?? 0); return `${n} ${n === 1 ? 'point' : 'points'}`; };

/** HTML for one pop, or '' when the event can't be shown under the copy rules. */
export function popHtml(type, e) {
  if (type === 'move') {
    const n = ptsOf(e.change1h);
    if (!n || e.yesPrice == null) return '';
    const kick = e.kind === 'still' ? 'STILL MOVING' : 'ON THE MOVE';
    return `<div class="pop-k">${kick}</div>
      <div class="pop-t fit" data-fit-h>${esc(e.short || e.title || 'A market on the board')}</div>
      <div class="pop-row"><span class="pop-big">${esc(pct(e.yesPrice))}</span><span class="pop-mv ${n > 0 ? 'up' : 'down'} fit">${n > 0 ? 'up' : 'down'} ${pts(e.change1h)} in the last hour</span></div>
      <div class="pop-s fit">Market prices, not facts · ${esc(hhmm(e.at))} ET</div>`;
  }
  if (type === 'listed') {
    if (!e.title) return '';
    return `<div class="pop-k">JUST LISTED</div>
      <div class="pop-t fit" data-fit-h>${esc(e.title)}</div>
      <div class="pop-row"><span class="pop-big">${esc(pct(e.yesPrice))}</span><span class="pop-mv fit">first price on the board</span></div>
      <div class="pop-s fit">${esc(exchangeName(e.source))} · ${esc(money(e.volume24h))} traded in 24 hrs · ${esc(hhmm(e.at))} ET</div>`;
  }
  if (type === 'money') {
    if (!(e.price >= 0.05 && e.price <= 0.95) || !(e.amount > 0) || !e.label) return '';
    const note = (e.isLargestToday ?? e.largestToday === true) ? 'Largest trade on this story today' : e.countToday > 1 ? `${e.countToday} large trades on this story today` : 'Large trade on this story';
    return `<div class="pop-k">MONEY MOVING</div>
      <div class="pop-t fit" data-fit-h><b class="pop-amt" data-to="${Math.round(e.amount)}">$0</b> traded on ${esc(e.label)} at ${esc(pct(e.price))}</div>
      <div class="pop-s fit">${esc(note)} · ${esc(exchangeName(e.source))} · ${esc(hhmm(e.at))} ET</div>`;
  }
  return '';
}

export function createPops(root, { onClick } = {}) {
  const seen = new Set();
  const queue = [];
  let showing = false, lastAt = 0, timer = 0;
  let gap = 60000;
  const blocked = () => document.body.classList.contains('alerting') || document.body.classList.contains('flashing');

  function countUp(elm) {
    const to = Number(elm.dataset.to) || 0, t0 = performance.now(), D = 1400;
    const f = (t) => {
      const k = Math.min(1, (t - t0) / D), v = Math.round(to * (1 - (1 - k) ** 3));
      elm.textContent = `$${v.toLocaleString('en-US')}`;
      if (k < 1) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }

  function show(type, e) {
    const html = popHtml(type, e);
    if (!html) return false;
    showing = true; lastAt = Date.now();
    const box = document.createElement('div');
    box.className = `pop pop-${type}${e.kind === 'still' ? ' pop-still' : ''}`;
    if (e.storyId) box.dataset.story = e.storyId;
    box.style.setProperty('--dur', `${DUR}ms`);
    box.innerHTML = html;
    root.append(box);
    box.addEventListener('click', () => { if (e.storyId) onClick?.(e.storyId); });
    requestAnimationFrame(() => box.querySelectorAll('.fit').forEach(fitText));
    box.querySelectorAll('.pop-amt').forEach(countUp);
    setTimeout(() => { box.remove(); showing = false; schedule(); }, DUR + 50);
    return true;
  }

  function schedule() {
    clearTimeout(timer);
    if (showing || !queue.length) return;
    const wait = Math.max(0, lastAt + gap - Date.now());
    timer = setTimeout(() => {
      if (showing) return;
      if (blocked()) { timer = setTimeout(schedule, 2000); return; } // paused during BREAKING / NEWS MEETS MARKETS
      while (queue.length) {
        const { type, e } = queue.shift();
        if (e.at && Date.now() - Date.parse(e.at) > STALE) continue;
        if (show(type, e)) return;
      }
    }, wait);
  }

  return {
    /** Ids already in a state snapshot are history, never pops. */
    markSeen(state) { for (const k of ['moves', 'listed', 'money']) for (const x of state?.[k] || []) if (x?.id != null) seen.add(x.id); },
    /** A live SSE event: type 'move' | 'listed' | 'money'. */
    enqueue(type, e) {
      if (!e || e.id == null || seen.has(e.id)) return;
      seen.add(e.id);
      if (e.at && Date.now() - Date.parse(e.at) > STALE) return;
      if (!popHtml(type, e)) return;
      queue.push({ type, e });
      while (queue.length > MAX_QUEUE) queue.shift();
      schedule();
    },
    /** Dev/test: show one now, ignoring the queue and pacing. */
    show,
    set gap(ms) { gap = ms; schedule(); },
    get queue() { return queue.map((x) => x.type); },
    get showing() { return showing; },
  };
}
