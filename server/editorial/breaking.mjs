// PNN breaking-move detector. Uses PNN's OWN observed price samples (store.recordPrices), not exchange deltas.
//
// detectBreaking(markets, historyStore, config, {now}) -> Alert[]
//   historyStore: a function (marketId) -> [{t, p}] or an object with .history(marketId). t may be epoch
//   seconds or ms. Alert = { id, at, storyId, marketId, headline, line, from, to, minutes, source }.
//
// Rules:
//   - Only markets that pass filter.classify and have volume24h >= breaking.minVolume.
//   - Needs >= 2 samples whose overall span is >= 5 minutes (never fire on the first sight of a market).
//   - Compares the current price with the min/max inside the last breaking.minutes; fires when the gap is
//     >= breaking.points.
//   - Cooldown per market (breaking.cooldownMin) and per event (so both sides of one race do not fire twice),
//     kept in module-level Maps. Only the biggest move per event fires in a single call.
//   - Alert id is stable: marketId + direction + rounded to-price + hour bucket.
//
//   - Watchability #3 (2026-11-04): only markets of a story on the board or a desk (rank.mjs airedSet(), or
//     opts.aired) or with >= breaking.bigVolume ($250K) 24h. Never a margin/seat-count bracket or a ladder rung
//     other than the story's line, and only when the alert reads as a plain headline (no quoted-question fallback).
//
// Config keys read (all optional): breaking.bigVolume (250000), breaking.points (0.08; values > 1 are read as points and divided by 100),
//   breaking.minutes (60), breaking.minVolume (50000), breaking.cooldownMin (90), plus filter.classify keys.

import { classify } from './filter.mjs';
import { alertCopy, shortHeadline } from './copy.mjs';
import { airedSet } from './rank.mjs';

const BRACKET_FAMILY = new Set(['margin', 'seat-count']);
const BRACKET_RE = /margin|\bby \d+(\.\d+)?\+? ?(points?|pts)\b|\bby (between )?\d+(\.\d+)?%|\d+\s*[-–]\s*\d+%?|\bseats?\b|\b(above|below|over|under|at least|more than|less than|between)\s+\$?\d/i;
const BRACKET_OUTCOME = /^(above|below|over|under|at least|more than|less than|between|[↑↓<>]|\$?\d[\d,.]*\s*([-–+%]|$))/i;
// A rung or bracket is not a readable BREAKING lead.
function bracketish(m, evKey, aired) {
  const fam = aired?.families?.get?.(evKey);
  if (fam && BRACKET_FAMILY.has(fam)) return true;
  const ladderLead = aired?.ladderLeads?.get?.(evKey);
  if (ladderLead) return ladderLead !== m.id;   // a ladder story fires only on its line
  if ((m.tags || []).includes('kalshi:ladder')) return true;
  if (BRACKET_OUTCOME.test(String(m.outcome || '').trim())) return true;
  return BRACKET_RE.test(`${m.title || ''} ${m.eventTitle || ''}`);
}
const readable = (h) => !!h && h.length <= 80 && !/[“”]/.test(h) && !/undefined|NaN|null/.test(h);

const lastFiredMarket = new Map(); // marketId -> ms
const lastFiredEvent = new Map();  // eventId -> ms
const MIN_SPAN_SEC = 5 * 60;

function getSamples(historyStore, id) {
  try {
    const arr = typeof historyStore === 'function' ? historyStore(id)
      : historyStore && typeof historyStore.history === 'function' ? historyStore.history(id)
      : historyStore instanceof Map ? historyStore.get(id) : null;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s) => ({ t: s.t > 1e12 ? s.t / 1000 : s.t, p: s.p }))
      .filter((s) => Number.isFinite(s.t) && Number.isFinite(s.p))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

// aliases: {eventId -> aired storyId} from buildStories. The same race on Kalshi and Polymarket airs as one story,
// so it gets one alert (the bigger move) and one cooldown.
export function detectBreaking(markets, historyStore, config = {}, { now = Date.now(), aliases = null, aired = null } = {}) {
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  const nowSec = nowMs / 1000;
  const B = config.breaking || {};
  let points = B.points ?? 0.08;
  if (points > 1) points /= 100;
  const windowSec = (B.minutes ?? 60) * 60;
  const minVolume = B.minVolume ?? 50_000;
  const cooldownMs = (B.cooldownMin ?? 90) * 60_000;
  const bigVolume = B.bigVolume ?? 250_000;
  let air = aired;
  if (!air) { try { air = airedSet(); } catch { air = null; } }
  const known = !!(air && air.storyIds && air.storyIds.size);

  const bestByEvent = new Map();
  for (const m of markets || []) {
    if (!m || !Number.isFinite(m.yesPrice) || (m.volume24h || 0) < minVolume) continue;
    if (!classify(m, config, { now: nowMs }).keep) continue;
    const last = lastFiredMarket.get(m.id);
    if (last && nowMs - last < cooldownMs) continue;
    const evKey = (aliases && aliases[m.eventId || m.id]) || m.eventId || m.id;
    const onAir = known && air.storyIds.has(evKey);
    if (!onAir && (m.volume24h || 0) < bigVolume) continue;
    if (bracketish(m, evKey, air)) continue;
    const lastEv = lastFiredEvent.get(evKey);
    if (lastEv && nowMs - lastEv < cooldownMs) continue;

    const samples = getSamples(historyStore, m.id);
    if (samples.length < 2) continue;
    if (Math.max(samples[samples.length - 1].t, nowSec) - samples[0].t < MIN_SPAN_SEC) continue;
    const win = samples.filter((s) => s.t >= nowSec - windowSec && s.t <= nowSec + 60);
    if (!win.length) continue;
    const cur = m.yesPrice;
    let lo = win[0], hi = win[0];
    for (const s of win) { if (s.p < lo.p) lo = s; if (s.p > hi.p) hi = s; }
    const up = cur - lo.p, down = hi.p - cur;
    let from, ref;
    if (up >= down && up >= points) { from = lo.p; ref = lo; }
    else if (down > up && down >= points) { from = hi.p; ref = hi; }
    else continue;
    const move = Math.abs(cur - from);
    const prev = bestByEvent.get(evKey);
    if (!prev || move > prev.move) bestByEvent.set(evKey, { m, from, ref, move });
  }

  const alerts = [];
  for (const [evKey, { m, from, ref }] of bestByEvent) {
    const to = m.yesPrice;
    const dir = to > from ? 'up' : 'down';
    const minutes = Math.max(1, Math.round((nowSec - ref.t) / 60));
    const hourBucket = Math.floor(nowMs / 3_600_000);
    const { headline, line } = alertCopy(m, from, to, minutes);
    if (!readable(headline)) continue;
    alerts.push({
      id: `${m.id}:${dir}:${Math.round(to * 100)}:${hourBucket}`,
      at: new Date(nowMs).toISOString(),
      storyId: evKey,
      marketId: m.id,
      headline,
      short: shortHeadline(headline),   // the takeover shows from→to big, so its title only says what moved
      line,
      from,
      to,
      minutes,
      source: m.source,
    });
    lastFiredMarket.set(m.id, nowMs);
    lastFiredEvent.set(evKey, nowMs);
  }
  alerts.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  return alerts;
}

// For tests: forget cooldowns.
export function resetBreaking() {
  lastFiredMarket.clear();
  lastFiredEvent.clear();
}

export default { detectBreaking, resetBreaking };
