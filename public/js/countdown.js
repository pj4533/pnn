// NEXT BIG DECISION: a persistent small chip (lower right) for state.countdown[0] with its market's live odds.
// Shows "IN 2H 14M" (or "IN 3 DAYS"), switching to a ticking mm:ss in the last hour. Hidden when nothing is scheduled.
import { esc, pct } from './util.js';
import { fitText } from './fit.js';

/** Time left as chip text: "3 DAYS", "2H 14M", "39:12" (last hour), "NOW". */
export function countText(at, now = Date.now()) {
  const ms = Date.parse(at) - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'NOW';
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 2) return `${d} DAYS`;
  if (h >= 1) return `${h}H ${String(m % 60).padStart(2, '0')}M`;
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The next scheduled decision that is still ahead of us, or null. */
export const nextDecision = (state, now = Date.now()) => (Array.isArray(state?.countdown) ? state.countdown : [])
  .filter((c) => c?.at && Date.parse(c.at) > now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] || null;

export function createCountdownChip(root) {
  let state = null, sig = '';
  function paint() {
    const now = Date.now(), c = nextDecision(state, now);
    if (!c) { if (sig) { root.innerHTML = ''; sig = ''; } return; }
    const left = Date.parse(c.at) - now, soon = left < 3600000;
    const olabel = c.eventTitle && c.eventTitle !== c.title ? `${c.eventTitle}: ${c.label}` : c.label;
    const odds = c.label && c.yesPrice != null ? `${esc(olabel)} <b>${esc(pct(c.yesPrice))}</b>` : '';
    const k = `${c.id}|${c.title}|${odds}|${soon}`;
    if (k !== sig) {
      sig = k;
      root.innerHTML = `<div class="chip${soon ? ' soon' : ''}" ${c.storyId ? `data-story="${esc(c.storyId)}"` : ''}>
        <div class="chip-k"><b>NEXT BIG DECISION</b><span class="chip-n"></span></div>
        <div class="chip-b"><div class="chip-t fit">${esc(c.title)}</div>${odds ? `<div class="chip-o fit">${odds}</div>` : ''}</div></div>`;
      requestAnimationFrame(() => root.querySelectorAll('.fit').forEach(fitText));
    }
    const n = root.querySelector('.chip-n');
    if (n) n.textContent = `IN ${countText(c.at, now)}`.replace('IN NOW', 'NOW');
  }
  setInterval(() => {
    paint();
    for (const e of document.querySelectorAll('[data-count-at]')) e.textContent = `IN ${countText(e.dataset.countAt)}`.replace('IN NOW', 'NOW');
  }, 1000);
  return { update(s) { state = s; paint(); } };
}
