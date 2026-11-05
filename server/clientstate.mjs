// The browser's view of the state (SSE 'state' and GET /api/state?client=1): the same data the UI reads, minus what it never reads.
// The full state stays on the server (getState); this builds a slim v2 payload. Why: the full state was ~500 KB, and
// JSON.parse + the deep text clean ran on the main thread every update (8-33 ms in Safari, in long frames).
//
// Shape (v:2): { ...everything else as before, v:2, pool:[story...], stories:[poolIdx...], closing:[poolIdx...],
//                desks:[{...desk, stories:[poolIdx...]}] }. A story shown on the board and on a desk is sent once.
// A pool story whose `lead` is one of its `markets` carries `leadIdx` (index in markets) instead of a second copy of the lead.
// A story's markets repeat story fields: `md` (bitmask over MDUP) flags the market fields that equal the story's on EVERY market of it
// (eventTitle, eventId (= story id), category, label (= the market's outcome), updatedAt (= story `mu`)), so they are sent once. `history` goes as `hp`, a flat
// [t0, p0, dt1, p1, ...] (time deltas) when every point is {t integer, p number}. public/js/data.js hydrate() turns all of this back into
// the exact shape the UI always read (shared objects, same field names).
// Dropped, because no client code reads them (grep public/js before adding anything here): market tokenId, conditionId, createdAt,
// volumeTotal, liquidity, flatMin, change15m, url, tags (only 'elections' survives: cards.js isElection); story newsScore, ladderKind,
// rungs, and every news item but the first with a headline (util.js newsOf) minus its url/via/score; wire item urls. Floats are rounded.

const MARKET_DROP = ['tokenId', 'conditionId', 'createdAt', 'volumeTotal', 'liquidity', 'flatMin', 'change15m', 'url', 'tags'];
const STORY_DROP = ['newsScore', 'ladderKind', 'rungs'];

// 4 decimals (prices, deltas), whole numbers from 100k up (volumes); integers untouched
export function roundNum(v) {
  if (!Number.isFinite(v) || Number.isInteger(v)) return v;
  return Math.abs(v) >= 1e5 ? Math.round(v) : Math.round(v * 1e4) / 1e4;
}
const replacer = (_k, v) => (typeof v === 'number' ? roundNum(v) : v);
const stringify = (x) => JSON.stringify(x, replacer);

function slimMarket(m) {
  if (!m || typeof m !== 'object') return m;
  const o = { ...m };
  for (const k of MARKET_DROP) delete o[k];
  if (Array.isArray(m.tags) && m.tags.includes('elections')) o.tags = ['elections'];
  return o;
}

/** util.js newsOf: the first item with a headline. The UI never reads the rest, the url, via or score. */
function slimNews(news) {
  const list = Array.isArray(news) ? news : news ? [news] : [];
  const n = list.find((x) => x && String(x.title || '').trim());
  if (!n) return Array.isArray(news) ? [] : news;
  const out = { title: n.title, source: n.source, outlet: n.outlet === n.source ? undefined : n.outlet, publishedAt: n.publishedAt };   // util.js newsOutlet reads source || outlet
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return [out];
}

const MDUP = ['eventTitle', 'eventId', 'category', 'label', 'updatedAt'];   // bit i of `md` = MDUP[i]  (mirrored in public/js/data.js hydrate)
const isStr = (v) => typeof v === 'string' && v !== '';

/** [{t,p}] -> flat [t0, p0, dt1, p1, ...] (null when any point is not a plain {t integer, p number}). */
function packHistory(h) {
  if (!Array.isArray(h) || !h.length) return null;
  const out = [];
  let prev = 0;
  for (const x of h) {
    if (!x || !Number.isInteger(x.t) || typeof x.p !== 'number' || !Number.isFinite(x.p) || Object.keys(x).length !== 2) return null;
    out.push(out.length ? x.t - prev : x.t, x.p);
    prev = x.t;
  }
  return out;
}

/** Pull the fields every market repeats from the story into the story (see the header). Mutates the slim copy `o`. */
function dedupeMarkets(o) {
  const ms = o.markets;
  if (!Array.isArray(ms) || !ms.length || ms.some((m) => !m || typeof m !== 'object')) return;
  const mdup = [];
  const all = (f) => ms.every(f);
  if (isStr(o.eventTitle) && all((m) => m.eventTitle === o.eventTitle)) mdup.push('eventTitle');
  if (isStr(o.id) && all((m) => m.eventId === o.id)) mdup.push('eventId');
  if (isStr(o.category) && all((m) => m.category === o.category)) mdup.push('category');
  if (all((m) => isStr(m.label) && m.label === m.outcome)) mdup.push('label');
  if (isStr(ms[0].updatedAt) && all((m) => m.updatedAt === ms[0].updatedAt)) { mdup.push('updatedAt'); o.mu = ms[0].updatedAt; }
  if (!mdup.length) return;
  o.md = mdup.reduce((b, k) => b | (1 << MDUP.indexOf(k)), 0);
  o.markets = ms.map((m) => { const x = { ...m }; for (const k of mdup) delete x[k]; return x; });
}

function slimStory(st) {
  const o = { ...st };
  for (const k of STORY_DROP) delete o[k];
  if (Array.isArray(st.markets)) o.markets = st.markets.map(slimMarket);
  if (st.lead) {
    const lead = slimMarket(st.lead);
    const i = Array.isArray(o.markets) ? o.markets.findIndex((m) => m?.id === lead.id) : -1;
    if (i >= 0 && stringify(o.markets[i]) === stringify(lead)) { o.leadIdx = i; delete o.lead; } else o.lead = lead;
  }
  if ('news' in st) o.news = slimNews(st.news);
  const hp = packHistory(st.history);
  if (hp) { o.hp = hp; delete o.history; }
  dedupeMarkets(o);
  return o;
}

function slimMover(m) {
  const o = slimMarket(m);
  if ('news' in m) o.news = slimNews(m.news);
  return o;
}

// finance.js reads only: symbol, name, kind, price, prevClose, change, changePct, session, asOf (at/updatedAt), source, delayed, official,
// line, copy.headline, headline, news, markets, history5d, history1mo. Its series reader takes [t, p] pairs natively.
const FIN_DROP = ['priceText', 'changeText', 'big', 'half', 'aired', 'severity', 'by', 'threshold', 'dayHigh', 'dayLow', 'high52', 'low52', 'level', 'key', 'direction', 'unit', 'short'];
const pairs = (a) => (Array.isArray(a) && a.every((x) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 2 && 't' in x && 'p' in x) ? a.map((x) => [x.t, x.p]) : a);
function slimFinRow(r) {
  if (!r || typeof r !== 'object') return r;
  const x = { ...r };
  for (const k of FIN_DROP) delete x[k];
  if (x.copy && typeof x.copy === 'object') x.copy = { headline: x.copy.headline };
  if (x.headline && typeof x.headline === 'object' && !Array.isArray(x.headline)) { const { url: _u, ...h } = x.headline; x.headline = h; }
  if (Array.isArray(x.markets)) x.markets = x.markets.map(slimMarket);
  if (x.history5d) x.history5d = pairs(x.history5d);
  if (x.history1mo) x.history1mo = pairs(x.history1mo);
  return x;
}
function slimFinance(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return f;
  const o = { ...f };
  delete o.stats;
  if (Array.isArray(f.moves)) o.moves = f.moves.map(slimFinRow);
  if (Array.isArray(f.quotes)) o.quotes = f.quotes.map(slimFinRow);
  return o;
}

/** Build the slim state as one JSON string (the pool is spliced in as already-stringified stories: one stringify per story). */
export function clientStateJson(state) {
  const poolJson = [];
  const seen = new Map();   // story json -> pool index (the same story on the board and a desk is sent once)
  const ref = (st) => {
    const j = stringify(slimStory(st));
    let i = seen.get(j);
    if (i === undefined) { i = poolJson.length; poolJson.push(j); seen.set(j, i); }
    return i;
  };
  const refs = (list) => (Array.isArray(list) ? list.filter((s) => s && typeof s === 'object').map(ref) : []);
  const { stories, closing, desks, movers, finance, wire, ...rest } = state;
  const head = {
    ...rest,
    v: 2,
    stories: refs(stories),
    closing: refs(closing),
    desks: (desks || []).map((d) => ({ ...d, stories: refs(d.stories) })),
    movers: (movers || []).map(slimMover),
    finance: slimFinance(finance),
    wire: (wire || []).map((w) => { if (!w || typeof w !== 'object') return w; const { url: _u, ...r } = w; return r; }),
  };
  const h = stringify(head);
  return `${h.slice(0, -1)},"pool":[${poolJson.join(',')}]}`;
}
