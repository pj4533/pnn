// Kalshi public market data (no auth) -> normalized Market[] (see docs/ARCHITECTURE.md).
// Kalshi has no volume ordering, so we page open events with nested markets and keep
// only contracts that traded in the last 24h. volume24h is in contracts (each pays $1,
// so contracts are roughly dollars of notional; we use it as the USD figure).
import { getJSON } from '../http.mjs';
import config from '../config.mjs';
import { stripRulesText } from '../editorial/text.mjs';

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const PAGE = 200;
const MAX_PAGES = 150;            // full sweep: Kalshi has ~15k+ open events and no volume ordering
const SWEEP_MS = 20 * 60_000;     // full sweep at most this often
const HOT_N = 40;                 // the busiest events, re-polled one by one between sweeps
const SKIP_CATS = new Set(['sports', 'crypto', 'mentions']);
const PACE_MS = 400;
const SERIES_TTL_MS = 6 * 3600_000;
const FRESH_MS = 24 * 3600_000;      // a market younger than this has no real 24h baseline
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const iso = (v) => {
  const t = Date.parse(v);
  if (!Number.isFinite(t) || new Date(t).getUTCFullYear() >= 2090) return null; // 2099 placeholders
  return new Date(t).toISOString();
};
const lc = (s) => String(s).trim().toLowerCase();
const clean = (s) => String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(); // Kalshi titles carry markdown bold
// Kalshi's title templates produce broken grammar ("Will Democratics win ...", "Will Democratic win the House race
// for NC-03?", "Will Pete Hegseth leaves Secretary of Defense in before 2027?"). Fix the grammar only, never the meaning.
const fixTitle = (s) => stripRulesText(clean(s))
  .replace(/\bDemocratics\b/g, 'Democrats')
  .replace(/^Will Democratic win\b/, 'Will the Democrat win')
  .replace(/^Will Republican win\b/, 'Will the Republican win')
  .replace(/^Democratic wins\b/, 'The Democrat wins')
  .replace(/^Republican wins\b/, 'The Republican wins')
  .replace(/\bin before (\d{4})\b/g, 'before $1')
  // stray capitals from Kalshi's templates ("Susie WIles"): a name word with two leading capitals then lowercase
  .replace(/\b([A-Z])([A-Z])([a-z]{3,})\b/g, (_, a, b, c) => a + b.toLowerCase() + c)
  .replace(/^Will ([A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,3}) (leaves|wins|holds|loses|becomes) /, (_, a, v) => `Will ${a} ${v.replace(/s$/, '')} `);

function seriesInfo(map, ticker) {
  if (!map || !ticker) return null;
  return map instanceof Map ? map.get(ticker) : map[ticker];
}

// Distinct numeric strikes in an event: a real ladder has several ("Above $4.00 / $4.02 / ..."); "Where will it rain?"
// has one strike (0) shared by every city and is not a ladder.
const ladderStrikesCache = new WeakMap();
function ladderStrikes(ev) {
  if (ladderStrikesCache.has(ev)) return ladderStrikesCache.get(ev);
  const set = new Set();
  for (const x of ev.markets || []) { const k = num(/^less/.test(x.strike_type || '') ? x.cap_strike : x.floor_strike); if (k != null) set.add(k); }
  ladderStrikesCache.set(ev, set.size);
  return set.size;
}

const seriesOfTicker = new Map(); // market ticker -> series ticker, for candlestick history

// input: {events:[...nested markets]} | {markets:[...]} | array of events or markets
// seriesByTicker: Map or object, ticker -> {category, tags[]}
export function parseKalshiMarkets(json, seriesByTicker = {}, now = new Date()) {
  const updatedAt = new Date(now).toISOString();
  const nowMs = new Date(now).getTime();
  let list = Array.isArray(json) ? json : (json?.events || json?.markets || []);
  const out = [];
  const push = (m, ev) => {
    if (!m || (m.status && !['active', 'open', 'initialized'].includes(m.status))) return;
    const vol24 = num(m.volume_24h_fp) ?? (num(m.volume_24h) ?? 0);
    if (!(vol24 > 0)) return;
    const bid = num(m.yes_bid_dollars), ask = num(m.yes_ask_dollars);
    const last = num(m.last_price_dollars);
    let yes = last;
    if ((yes == null || yes === 0) && bid != null && ask != null) yes = (bid + ask) / 2;
    if (yes == null) return;
    const prev = num(m.previous_price_dollars);
    // previous_price on a market listed less than a day ago is its listing price, not yesterday's: a fresh weekly or
    // daily bracket would read as a 90-point move. No baseline until the market has traded for ~24h.
    const opened = Date.parse(m.open_time || m.created_time || '');
    const fresh = Number.isFinite(opened) && nowMs - opened < FRESH_MS;
    const change1d = !fresh && last != null && prev != null && prev > 0 ? last - prev : null;
    const eventTicker = m.event_ticker || ev?.event_ticker || m.ticker;
    const seriesTicker = ev?.series_ticker || m.series_ticker || String(eventTicker).split('-')[0];
    const s = seriesInfo(seriesByTicker, seriesTicker);
    seriesOfTicker.set(m.ticker, seriesTicker);
    const tags = new Set();
    for (const t of [ev?.category, s?.category, ...(s?.tags || []), ev?._tag]) if (t) tags.add(lc(t));   // _tag: sportsSeries hint ('video games')
    // Structural tags the filter reads: series recurrence, and cumulative strike ladders ("Above 20",
    // "Above 30", ...) whose outcomes are not mutually exclusive and so can't be read as a race.
    if (s?.frequency) tags.add(`freq:${lc(s.frequency)}`);
    let multi = (ev?.markets?.length ?? 0) > 1;
    // Cumulative strike ladders ("Above $4.00", "Above $4.02", ...): one event, many nested thresholds. They stay
    // grouped by event so rank can air the whole ladder as ONE yes/no story on the rung nearest 50% (the line).
    const ladder = !!ev && ev.mutually_exclusive === false && /^(greater|less)/.test(m.strike_type || '') && ladderStrikes(ev) > 2;
    if (ladder) { tags.add('kalshi:ladder'); tags.add(`group:${lc(eventTicker)}`); }
    // Other non-exclusive multi-market events ("Which counties will X win?") are independent yes/no questions:
    // air them as their own stories, never as a race with a 'next is' runner-up.
    const independent = multi && !ladder && ev.mutually_exclusive === false;
    if (independent) { multi = false; tags.add(`group:${lc(eventTicker)}`); }
    // An independent group market often carries only the event's wh-question as its title, with the answer in the
    // sub-title ("Who will run for the Democratic presidential nomination in 2028?" + "Gavin Newsom"): make it the
    // yes/no question it is ("Will Gavin Newsom run for ...?").
    const sub = stripRulesText(clean(m.yes_sub_title));
    const wh = independent && sub && String(m.title || '').match(/^Who will (.+?)\??$/i);
    if (wh) m = { ...m, title: `Will ${sub} ${wh[1]}?` };
    const strike = ladder ? num(/^less/.test(m.strike_type) ? m.cap_strike : m.floor_strike) : null;
    out.push({
      id: `ks:${m.ticker}`,
      source: 'kalshi',
      title: fixTitle(m.title || ev?.title || ''),
      outcome: multi ? (stripRulesText(clean(m.yes_sub_title)) || null) : null,
      eventId: independent ? `ks:${m.ticker}` : `ks:${eventTicker}`,
      // Independent group markets ("Who will leave the Trump administration?") air as their own yes/no story, so
      // their own question is the event for matching and display.
      eventTitle: independent ? fixTitle(m.title || ev?.title || '') : fixTitle(ev?.title || m.title || ''),
      category: '',
      tags: [...tags],
      yesPrice: Math.min(1, Math.max(0, yes)),
      change1d,
      change1w: null,
      volume24h: vol24,
      volumeTotal: num(m.volume_fp) ?? 0,
      liquidity: num(m.liquidity_dollars) || num(m.open_interest_fp) || null, // open interest when the book-depth field is empty
      closesAt: iso(m.close_time || m.expected_expiration_time),
      url: `https://kalshi.com/markets/${lc(seriesTicker)}`,
      tokenId: null,
      createdAt: iso(m.open_time) || null,                        // JUST LISTED: genuinely new markets
      updatedAt: ev?._fetchedAt || updatedAt,
      // Additions to the Market contract (ladders only): the rung's numeric threshold and direction, and the
      // event's date line ("On Nov 9, 2026", "In Oct 2026") so copy can say when the line settles.
      ...(ladder ? { strike, strikeDir: /^less/.test(m.strike_type) ? 'below' : 'above', eventSub: clean(ev.sub_title) || null } : {}),
    });
  };
  for (const item of list) {
    if (Array.isArray(item?.markets)) for (const m of item.markets) push(m, item);
    else push(item, null);
  }
  return out;
}

let seriesCache = { at: 0, map: null };
async function loadSeries() {
  if (seriesCache.map && Date.now() - seriesCache.at < SERIES_TTL_MS) return seriesCache.map;
  try {
    const j = await getJSON(`${BASE}/series`, { timeoutMs: 60_000 }); // no limit: returns all ~15.7k series
    const map = new Map();
    for (const s of j?.series || []) map.set(s.ticker, { category: s.category || '', tags: s.tags || [], frequency: s.frequency || '' });
    seriesCache = { at: Date.now(), map };
    return map;
  } catch (e) {
    return seriesCache.map || new Map(); // category/tags are a nice-to-have; keep going
  }
}

// Slow full sweep + fast hot set (CLAUDE.md data rules). The sweep pages every open event (~60s,
// paced) and remembers the traded ones; between sweeps only the HOT_N busiest events are re-fetched.
let cache = { at: 0, events: new Map(), hot: [], partial: false };
// Keep only what parseKalshiMarkets reads: the raw events carry rules text and dozens of fields per market,
// which across ~30k markets was most of the server's memory.
const MKT_KEYS = ['ticker', 'event_ticker', 'series_ticker', 'status', 'title', 'yes_sub_title', 'strike_type',
  'volume_24h_fp', 'volume_24h', 'yes_bid_dollars', 'yes_ask_dollars', 'last_price_dollars', 'previous_price_dollars',
  'volume_fp', 'liquidity_dollars', 'open_interest_fp', 'close_time', 'expected_expiration_time', 'open_time',
  'floor_strike', 'cap_strike'];
function slim(e, at) {
  return {
    event_ticker: e.event_ticker, series_ticker: e.series_ticker, title: e.title, sub_title: e.sub_title, category: e.category,
    mutually_exclusive: e.mutually_exclusive, _fetchedAt: at, ...(e._tag ? { _tag: e._tag } : {}),
    markets: (e.markets || []).map((m) => { const o = {}; for (const k of MKT_KEYS) if (m[k] != null) o[k] = m[k]; return o; }),
  };
}
const evVol = (e) => (e.markets || []).reduce((a, m) => a + (num(m.volume_24h_fp) ?? num(m.volume_24h) ?? 0), 0);

// Series recurrences that can never air (config.filter.excludeFrequencies: 15-min, hourly) are not held in memory
// and never take a hot-set slot.
function skipFreq(series, e) {
  const f = lc(seriesInfo(series, e.series_ticker || String(e.event_ticker).split('-')[0])?.frequency || '');
  return f && (config.filter?.excludeFrequencies || []).includes(f);
}

async function sweep(series) {
  const events = new Map();
  let cursor = '', partial = false;
  for (let p = 0; p < MAX_PAGES; p++) {
    const url = `${BASE}/events?status=open&with_nested_markets=true&limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    let j;
    try {
      j = await getJSON(url, { timeoutMs: 30_000 });
    } catch (e) {
      if (events.size) { partial = true; break; }
      throw e;
    }
    const at = new Date().toISOString();
    for (const e of j?.events || []) {
      // sports/crypto/mentions never air (D5): don't hold them in memory
      if (evVol(e) > 0 && !SKIP_CATS.has(lc(e.category || '')) && !skipFreq(series, e)) events.set(e.event_ticker, slim(e, at));
    }
    cursor = j?.cursor || '';
    if (!cursor || !(j?.events || []).length) break;
    await sleep(PACE_MS);
  }
  // A sweep cut short (timeout, 429) keeps the previous sweep's events for the tickers it never reached,
  // and is retried after ~5 min instead of waiting a full SWEEP_MS.
  if (partial) for (const [k, v] of cache.events) if (!events.has(k)) events.set(k, v);
  const hot = [...events.values()]
    .sort((a, b) => evVol(b) - evVol(a))
    .slice(0, HOT_N)
    .map((e) => e.event_ticker);
  cache = { at: partial ? Date.now() - SWEEP_MS + 5 * 60_000 : Date.now(), events, hot, partial };
}

async function refreshHot() {
  let ok = 0;
  for (const t of cache.hot) {
    try {
      const j = await getJSON(`${BASE}/events/${encodeURIComponent(t)}?with_nested_markets=true`, { timeoutMs: 15_000 });
      const ev = j?.event;
      if (ev) {
        if (!ev.markets?.length && Array.isArray(j.markets)) ev.markets = j.markets;
        cache.events.set(t, slim(ev, new Date().toISOString()));
        ok++;
      }
    } catch (e) {
      if (e?.status === 429) break;
    }
    await sleep(PACE_MS);
  }
  if (!ok && cache.hot.length) throw new Error('kalshi: hot refresh failed');
}

// Sports futures / awards / release dates (config.sources.kalshi.sportsSeries). The generic sweep skips Kalshi's
// 'Sports' category (4,000 mostly per-game series), so a fixed list of futures series is fetched by series_ticker on its
// own slow cadence (sportsSec) and merged into every poll. A series that returns nothing (or 429) keeps its last events.
let sgCache = { at: 0, events: new Map(), per: {}, running: null };
export const kalshiSportsCache = () => ({ at: sgCache.at, events: sgCache.events.size, per: sgCache.per });
async function refreshSports() {
  const K = config.sources?.kalshi || {};
  const list = (K.sportsSeries || []).map((x) => (Array.isArray(x) ? { ticker: x[0], tag: x[1] } : { ticker: x, tag: null }));
  if (!list.length) return;
  const dropRe = config.sportsGaming?.dropTickers;
  const events = new Map(), per = {};
  let ok = 0;
  for (const { ticker, tag } of list) {
    try {
      const j = await getJSON(`${BASE}/events?series_ticker=${encodeURIComponent(ticker)}&status=open&with_nested_markets=true&limit=50`, { timeoutMs: 20_000 });
      const at = new Date().toISOString();
      let n = 0;
      for (const e of j?.events || []) {
        if (!(evVol(e) > 0) || (dropRe && dropRe.test(`KS:${e.event_ticker}`.toUpperCase()))) continue;
        events.set(e.event_ticker, slim(tag ? { ...e, _tag: tag } : e, at));
        n++;
      }
      per[ticker] = n;
      ok++;
    } catch (e) {
      per[ticker] = `err ${e?.status ?? ''}`.trim();
      if (e?.status === 429 || e?.status >= 500) break;   // http.mjs backs the host off; finish with what we have
    }
    await sleep(K.sportsPaceMs ?? 450);
  }
  if (!ok) throw new Error('kalshi: sports series fetch failed');
  // series the pass did not reach keep their previous events
  for (const [k, v] of sgCache.events) if (!events.has(k) && typeof per[String(v.series_ticker || k.split('-')[0])] !== 'number') events.set(k, v);
  sgCache = { ...sgCache, at: Date.now(), events, per };
}

export async function fetchKalshi() {
  const series = await loadSeries();
  if (!cache.events.size || Date.now() - cache.at > SWEEP_MS) await sweep(series);
  else await refreshHot();
  const K = config.sources?.kalshi || {};
  if (K.sportsSeries?.length && Date.now() - sgCache.at > (K.sportsSec ?? 600) * 1000 * 0.85) {
    if (!sgCache.running) sgCache.running = refreshSports().catch(() => { sgCache.at = Date.now() - ((K.sportsSec ?? 600) * 1000) * 0.5; }).finally(() => { sgCache.running = null; });
    if (!sgCache.events.size) await sgCache.running;   // first poll waits so sports futures are there from the start
  }
  const merged = new Map(cache.events);
  for (const [k, v] of sgCache.events) merged.set(k, v);
  return parseKalshiMarkets([...merged.values()], series, new Date());
}

/** The slimmed raw events held by the sweep (for offline replay/tests). */
export const kalshiRawEvents = () => [...cache.events.values()];

/** Hourly price history for a Kalshi market over the last ~24h -> [{t, p}] (t epoch sec). */
export async function fetchKalshiHistory(marketId, { hours = 24, periodMin = 60 } = {}) {
  const ticker = String(marketId).replace(/^ks:/, '');
  const series = seriesOfTicker.get(ticker) || ticker.split('-')[0];
  const end = Math.floor(Date.now() / 1000), start = end - hours * 3600;
  const j = await getJSON(`${BASE}/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=${periodMin}`, { timeoutMs: 15_000 });
  const out = [];
  for (const c of j?.candlesticks || []) {
    let p = num(c?.price?.close_dollars);
    if (p == null) { const b = num(c?.yes_bid?.close_dollars), a = num(c?.yes_ask?.close_dollars); if (b != null && a != null) p = (a + b) / 2; }
    if (p != null && Number.isFinite(c.end_period_ts)) out.push({ t: c.end_period_ts, p: Math.min(1, Math.max(0, p)) });
  }
  return out;
}
