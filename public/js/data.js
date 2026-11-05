// Data client: SSE from /api/events ('state' + 'alert' + 'flash' + corner pops 'move' / 'listed' / 'money'), fallback fetch('/api/state'), reconnect with backoff.
// ?fixture=1 loads /dev/state.sample.json (times rebased to now), adds a fake news wire, fakes a live alert after 5s
// and a NEWS MEETS MARKETS flash after 12s (it waits for the alert to finish). ?fixture=1&flash=1 fires the flash at 2s, no alert.
import { report } from './util.js';

const params = new URLSearchParams(location.search);
export const FIXTURE = params.has('fixture');

const TIME_KEYS = new Set(['generatedAt', 'updatedAt', 'closesAt', 'lastOk', 'publishedAt', 'newsAt', 'at']);
/** Shift every timestamp in the fixture so "updated 2m ago" reads right whenever it is loaded. */
function rebase(obj, offsetMs) {
  if (Array.isArray(obj)) return obj.map((x) => rebase(x, offsetMs));
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (TIME_KEYS.has(k) && typeof v === 'string' && !Number.isNaN(Date.parse(v))) out[k] = new Date(Date.parse(v) + offsetMs).toISOString();
    else if ((k === 'history' || k === 'newsMarks') && Array.isArray(v)) out[k] = v.map((h) => ({ ...h, t: h.t + Math.round(offsetMs / 1000) }));
    else out[k] = rebase(v, offsetMs);
  }
  return out;
}

const FIXTURE_WIRE = [
  ['Reuters', 'Fed officials signal a December rate hike remains on the table', 'economy', 2],
  ['AP', 'Mississippi Senate race remains too close to call as counting continues', 'politics', 5],
  ['BBC', 'Los Angeles mayoral race heads toward a runoff, early returns show', 'politics', 9],
  ['CNBC', 'Treasury yields climb after strong services data', 'economy', 14],
  ['The Hill', 'California billionaire tax measure trails in early returns', 'politics', 21],
  ['TechCrunch', 'Anthropic weighs a funding round at a higher valuation', 'tech', 33],
  ['NPR', 'Alaska Senate count could take days, election officials say', 'politics', 47],
];
const vol = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);
function fixtureFlash(state) {
  const s = state.stories.find((x) => x.id === 'pm:fed-decision-in-december') || state.stories[0];
  const labels = ['The Fed raises rates by a quarter point in December', 'No change in Fed rates in December'];
  const markets = s.markets.slice(0, 2).map((m, i) => ({
    id: m.id, label: labels[i] || m.outcome || m.title, yesPrice: m.yesPrice, change1d: m.change1d,
    ...(i === 0 ? { changeSinceNews: 0.04 } : {}), source: m.source, volume24h: m.volume24h, volumeText: vol(m.volume24h),
    thin: m.volume24h < 10000, url: m.url, closesAt: m.closesAt, updatedAt: new Date().toISOString(), eventId: m.eventId, line: '',
  }));
  markets[0].line = `${markets[0].label}: ${Math.round(markets[0].yesPrice * 100)}%, up 4 points since the news`;
  return {
    id: `flash:fixture-${Date.now()}`, kind: 'flash', at: new Date().toISOString(), newsAt: new Date(Date.now() - 2 * 60000).toISOString(),
    headline: FIXTURE_WIRE[0][1], credit: 'Reuters, CNBC and 2 others', outlets: ['Reuters', 'CNBC', 'BBC', 'Bloomberg'], url: null,
    category: 'economy', official: false, markets, line: markets[0].line, storyId: s.id, cluster: 'wc:fixture',
  };
}

// Fake corner-pop events (SSE 'move' / 'listed' / 'money'), fresh ids and times each call.
export function fixturePop(type) {
  const at = new Date().toISOString(), id = `${type}:fixture-${Date.now()}`;
  if (type === 'move') return { id, at, storyId: 'pm:fed-decision-in-december', marketId: 'pm:fed-dec-hike25', short: 'Fed hike odds', yesPrice: 0.8, change1h: 0.06, kind: 'move' };
  if (type === 'still') return { id, at, storyId: 'pm:fed-decision-in-december', marketId: 'pm:fed-dec-hike25', short: 'Fed hike odds', yesPrice: 0.84, change1h: 0.04, kind: 'still' };
  if (type === 'listed') return { id, at, storyId: null, marketId: 'ks:KXNEW', title: 'Which party controls the Senate after the Alaska count?', yesPrice: 0.34, source: 'kalshi', volume24h: 64000 };
  return { id, at, storyId: 'pm:fed-decision-in-december', marketId: 'pm:fed-dec-hike25', label: 'a December Fed rate hike', amount: 30000, price: 0.8, source: 'polymarket', largestToday: 30000, isLargestToday: true, countToday: 4 };
}

async function loadFixture({ onState, onAlert, onFlash, onStatus, onPop }) {
  const res = await fetch('/dev/state.sample.json', { cache: 'no-store' });
  const raw = await res.json();
  const state = rebase(raw, Date.now() - Date.parse(raw.generatedAt));
  state.wire ||= FIXTURE_WIRE.map(([outlet, title, category, min]) => ({ title, outlet, category, publishedAt: new Date(Date.now() - min * 60000).toISOString(), url: null }));
  state.flashes ||= [];
  onStatus(true);
  onState(state);
  const mk = (n) => {
    const s = state.stories.find((x) => x.id === 'pm:democratic-nominee-2028') || state.stories[0];
    return {
      id: `fixture-alert-${n}-${Date.now()}`, at: new Date().toISOString(), storyId: s.id, marketId: s.lead.id,
      headline: n % 2 ? 'Fed hike odds jump 9 points in 35 minutes' : 'Jon Ossoff jumps 9 points in 40 minutes',
      line: n % 2
        ? 'December Fed hike odds are at 80%, up from 71% about 35 minutes ago.'
        : 'Ossoff is at 29% for the 2028 Democratic nomination, up from 20% about 40 minutes ago.',
      from: n % 2 ? 0.71 : 0.2, to: n % 2 ? 0.8 : 0.29, minutes: n % 2 ? 35 : 40, source: 'polymarket',
      ...(n % 2 ? { storyId: 'pm:fed-decision-in-december', marketId: 'pm:fed-dec-hike25' } : {}),
    };
  };
  let n = 0;
  const flashOnly = params.has('flash');
  if (!flashOnly) setTimeout(() => onAlert(mk(n++)), 5000);
  setTimeout(() => onFlash?.(fixtureFlash(state)), flashOnly ? 2000 : 12000);
  window.__pnnFakeFlash = () => onFlash?.(fixtureFlash(state));
  if (params.has('alerts')) setInterval(() => onAlert(mk(n++)), 60000); // ?fixture=1&alerts=1 → one every minute
  window.__pnnFakeAlert = () => onAlert(mk(n++));
  // corner pops: a move at 20s, money and a listing queued behind it (the client spaces them >= 60s apart)
  const pop = (t) => onPop?.(t === 'still' ? 'move' : t, fixturePop(t));
  if (!flashOnly) { setTimeout(() => pop('move'), 20000); setTimeout(() => pop('money'), 22000); setTimeout(() => pop('listed'), 24000); }
  window.__pnnFakePop = pop;
}

/** Rebuild the full shape from the server's slim v2 state (server/clientstate.mjs): stories/closing/desks arrive as indexes into
 *  `pool`, a lead that is one of the story's markets as `leadIdx`. Shared objects, same field names the UI always read. */
export function hydrate(s) {
  if (!s || s.v !== 2 || !Array.isArray(s.pool)) return s;
  const pool = s.pool;
  for (const st of pool) {
    if (!st || typeof st !== 'object') continue;
    const ms = st.markets;
    if (st.md && Array.isArray(ms)) { // fields every market repeats from its story: bit i of md = MDUP[i] (see server/clientstate.mjs)
      const md = st.md;
      for (const m of ms) {
        if (md & 1) m.eventTitle = st.eventTitle;
        if (md & 2) m.eventId = st.id;
        if (md & 4) m.category = st.category;
        if (md & 8) m.label = m.outcome;
        if (md & 16) m.updatedAt = st.mu;
      }
      delete st.md; delete st.mu;
    }
    if (st.leadIdx != null && !st.lead) { st.lead = ms?.[st.leadIdx]; delete st.leadIdx; }
    if (Array.isArray(st.hp)) { // flat [t0, p0, dt1, p1, ...] -> [{t, p}]
      const hp = st.hp, h = new Array(hp.length >> 1);
      let t = 0;
      for (let i = 0, j = 0; i < hp.length; i += 2, j++) { t = i ? t + hp[i] : hp[i]; h[j] = { t, p: hp[i + 1] }; }
      st.history = h; delete st.hp;
    }
  }
  const pick = (a) => (Array.isArray(a) ? a.map((i) => pool[i]).filter(Boolean) : []);
  s.stories = pick(s.stories);
  s.closing = pick(s.closing);
  if (s.segments && typeof s.segments === 'object') s.segments = Object.fromEntries(Object.entries(s.segments).map(([k, l]) => [k, pick(l)]));
  s.desks = (s.desks || []).map((d) => ({ ...d, stories: pick(d.stories) }));
  delete s.pool;
  return s;
}

export function connect(handlers) {
  const { onAlert, onFlash, onStatus, onPop } = handlers;
  const onState = (s) => handlers.onState(hydrate(s));
  if (FIXTURE) { loadFixture(handlers).catch((e) => { report('fixture', e); onStatus(false); }); return; }

  let es = null, backoff = 1000, timer = 0, lastMsg = 0;
  const parse = (ev, fn) => { try { fn(JSON.parse(ev.data)); } catch (e) { report('sse-parse', e); } };

  async function fallback() {
    try {
      const r = await fetch('/api/state?client=1', { cache: 'no-store' });
      if (r.ok) { onState(await r.json()); lastMsg = Date.now(); }
    } catch { /* still down; the indicator stays on */ }
  }

  function open() {
    clearTimeout(timer);
    try { es?.close(); } catch {}
    es = new EventSource('/api/events');
    es.addEventListener('open', () => { backoff = 1000; onStatus(true); });
    es.addEventListener('state', (ev) => { lastMsg = Date.now(); onStatus(true); parse(ev, onState); });
    es.addEventListener('alert', (ev) => { lastMsg = Date.now(); parse(ev, onAlert); });
    es.addEventListener('flash', (ev) => { lastMsg = Date.now(); if (onFlash) parse(ev, onFlash); });
    for (const t of ['move', 'listed', 'money']) es.addEventListener(t, (ev) => { lastMsg = Date.now(); if (onPop) parse(ev, (x) => onPop(t, x)); });
    es.addEventListener('ping', () => { lastMsg = Date.now(); });
    es.addEventListener('error', () => {
      onStatus(false);
      try { es.close(); } catch {}
      fallback();
      timer = setTimeout(open, backoff);
      backoff = Math.min(30000, backoff * 2);
    });
  }
  fallback(); // paint something immediately even before the first SSE frame
  open();
  // Watchdog: if the stream goes silent for 3 min, reconnect.
  setInterval(() => { if (lastMsg && Date.now() - lastMsg > 180000) { onStatus(false); open(); lastMsg = Date.now(); } }, 30000);
}
