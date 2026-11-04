// Polymarket (Gamma + CLOB, public, no auth) -> normalized Market[] (see docs/ARCHITECTURE.md).
import { getJSON } from '../http.mjs';
import config from '../config.mjs';

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
const PAGE = 100;
const MAX_EVENTS = 300;           // main sweep: the top events by 24h volume, every poll (300s)
// Markets quieter than this can never air (filter.mjs lowVolume24h is the lowest floor), so they are not held in memory.
const sourceFloor = () => config.filter?.lowVolume24h ?? 200;
const slimMarkets = (ms) => { const f = sourceFloor(); return ms.filter((m) => (m.volume24h || 0) >= f); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
// Gamma returns some arrays as JSON strings ("[\"Yes\",\"No\"]"); tolerate real arrays too.
const jarr = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
};
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

function eventTags(ev) {
  const out = new Set();
  for (const t of ev.tags || []) {
    for (const s of [t?.label, t?.slug]) if (s) out.add(String(s).toLowerCase());
  }
  return [...out];
}

// Pure: Gamma /events JSON (array) -> Market[]
export function parsePolymarketEvents(json, now = new Date()) {
  const events = Array.isArray(json) ? json : (json?.events || []);
  const updatedAt = new Date(now).toISOString();
  const out = [];
  for (const ev of events) {
    if (!ev || ev.closed || ev.archived || ev.active === false) continue;
    const mkts = (ev.markets || []).filter((m) => m && !m.closed && !m.archived && m.active !== false);
    if (!mkts.length) continue;
    const multi = (ev.markets || []).length > 1;
    const tags = eventTags(ev);
    for (const m of mkts) {
      const prices = jarr(m.outcomePrices).map(Number);
      let yes = prices.length ? prices[0] : NaN;
      if (!Number.isFinite(yes)) yes = num(m.lastTradePrice) ?? NaN;
      if (!Number.isFinite(yes)) continue;
      const tokens = jarr(m.clobTokenIds);
      out.push({
        id: `pm:${m.id}`,
        source: 'polymarket',
        title: m.question || ev.title || '',
        outcome: multi ? (m.groupItemTitle || null) : null,
        eventId: `pm:${ev.id}`,
        eventTitle: ev.title || m.question || '',
        category: '',
        tags,
        yesPrice: Math.min(1, Math.max(0, yes)),
        change1d: num(m.oneDayPriceChange),
        change1w: num(m.oneWeekPriceChange),
        volume24h: num(m.volume24hr) ?? 0,
        volumeTotal: num(m.volumeNum) ?? num(m.volume) ?? 0,
        liquidity: num(m.liquidityNum) ?? num(m.liquidity),
        closesAt: iso(m.endDate || ev.endDate),
        url: `https://polymarket.com/event/${ev.slug}`,
        tokenId: tokens[0] != null ? String(tokens[0]) : null,
        conditionId: m.conditionId || null,                       // data-api trades filter (MONEY MOVING)
        createdAt: iso(m.createdAt || m.startDate) || null,       // JUST LISTED: genuinely new markets
        updatedAt,
      });
    }
  }
  return out;
}

// Gamma pages by offset while volume ranks shift, so one event can land on two pages: keep the first copy.
const uniqEvents = (list) => { const seen = new Set(); return list.filter((e) => e?.id != null && !seen.has(e.id) && seen.add(e.id)); };

async function fetchPages(url0, max, paceMs) {
  const events = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    let page;
    try {
      page = await getJSON(`${url0}&limit=${Math.min(PAGE, max)}&offset=${offset}`, { timeoutMs: 30_000 });
    } catch (e) {
      if (events.length) break; // partial sweep is better than none
      throw e;
    }
    if (!Array.isArray(page) || !page.length) break;
    events.push(...page);
    if (page.length < PAGE) break;
    await sleep(paceMs);
  }
  return uniqEvents(events);
}

// Per-tag breadth sweep. The top-300-by-volume sweep is mostly elections, so non-election desks (economy, tech,
// science, culture, weather, courts, world) also get the top events of each of these Gamma tags. It runs on a slow
// cadence (config.sources.polymarket.tagSweepSec, ~15 min), requests spaced >= 300ms, and stops early on a
// 429/5xx (http.mjs then backs the host off). Results are cached as parsed Market[] and merged into every main poll.
let tagCache = { at: 0, markets: [], perTag: {}, running: null };
export const polymarketTagCache = () => ({ at: tagCache.at, markets: tagCache.markets.length, perTag: tagCache.perTag });

export async function sweepPolymarketTags({ tags = [], limit = 50, paceMs = 350 } = {}) {
  if (tagCache.running) return tagCache.running;
  tagCache.running = (async () => {
    const byEvent = new Map();
    const perTag = {};
    let ok = 0, lastErr = null;
    for (const slug of tags) {
      try {
        const url = `${GAMMA}/events?tag_slug=${encodeURIComponent(slug)}&active=true&closed=false&order=volume24hr&ascending=false&limit=${limit}`;
        const page = await getJSON(url, { timeoutMs: 30_000 });
        const list = Array.isArray(page) ? page : [];
        perTag[slug] = list.length;
        for (const ev of list) if (ev?.id != null && !byEvent.has(ev.id)) byEvent.set(ev.id, ev);
        ok++;
      } catch (e) {
        lastErr = e;
        perTag[slug] = `err ${e?.status ?? ''}`.trim();
        if (e?.status === 429 || e?.status >= 500) break; // host is backing off; finish with what we have
      }
      await sleep(paceMs);
    }
    if (!ok) throw lastErr || new Error('polymarket: tag sweep failed');
    // Parse now and drop the raw events (they carry descriptions and dozens of fields per market).
    const markets = slimMarkets(parsePolymarketEvents([...byEvent.values()], new Date()));
    // A sweep cut short keeps the previous sweep's markets for events it did not reach.
    if (ok < tags.length) {
      const seen = new Set(markets.map((m) => m.eventId));
      for (const m of tagCache.markets) if (!seen.has(m.eventId)) markets.push(m);
    }
    tagCache = { ...tagCache, at: Date.now(), markets, perTag };
    return markets;
  })().finally(() => { tagCache.running = null; });
  return tagCache.running;
}

// Live: top events by 24h volume, paged (gamma caches ~300s, so be gentle), plus a deeper slice and the cached
// per-tag sweep for events the top sweep did not reach (deduped by event id; the fresher, higher-priority copy wins:
// main > deep > tags).
//   main: events 0..300 every poll (3 pages, 500ms apart).
//   deep: events 300..800 (config.sources.polymarket.deepEvents) every deepSec (900s, same cadence as the tag sweep),
//         5 pages 500ms apart, cached as parsed markets. At that depth an event still trades $5K-20K a day.
let lastMain = [];
let deepCache = { at: 0, markets: [], events: 0, running: null };
export const polymarketDeepCache = () => ({ at: deepCache.at, markets: deepCache.markets.length, events: deepCache.events });
export function mergedPolymarket() {
  const out = lastMain.slice();
  const seen = new Set(out.map((m) => m.eventId));
  for (const pool of [deepCache.markets, tagCache.markets]) {
    const add = [];
    for (const m of pool) if (!seen.has(m.eventId)) add.push(m);
    for (const m of add) { out.push(m); seen.add(m.eventId); }
  }
  return out;
}

async function refreshDeep({ from, to, paceMs }) {
  if (deepCache.running) return deepCache.running;
  deepCache.running = (async () => {
    const events = [];
    for (let offset = from; offset < to; offset += PAGE) {
      let page;
      try {
        page = await getJSON(`${GAMMA}/events?active=true&closed=false&order=volume24hr&ascending=false&limit=${Math.min(PAGE, to - offset)}&offset=${offset}`, { timeoutMs: 45_000 });
      } catch (e) {
        if (!events.length) throw e;
        break; // partial deep sweep beats none; http.mjs backs the host off on 429/5xx
      }
      if (!Array.isArray(page) || !page.length) break;
      events.push(...page);
      if (page.length < PAGE) break;
      await sleep(paceMs);
    }
    const markets = slimMarkets(parsePolymarketEvents(uniqEvents(events), new Date()));
    // A sweep cut short keeps the previous deep markets for events it did not reach.
    if (events.length < to - from && deepCache.markets.length) {
      const seen = new Set(markets.map((m) => m.eventId));
      for (const m of deepCache.markets) if (!seen.has(m.eventId)) markets.push(m);
    }
    deepCache = { ...deepCache, at: Date.now(), markets, events: new Set(markets.map((m) => m.eventId)).size };
  })().finally(() => { deepCache.running = null; });
  return deepCache.running;
}

export async function fetchPolymarket({ maxEvents = MAX_EVENTS, deepEvents, deepSec } = {}) {
  const S = config.sources?.polymarket || {};
  const deepTo = deepEvents ?? S.deepEvents ?? 800;
  const deepEvery = (deepSec ?? S.deepSec ?? 900) * 1000;
  const events = await fetchPages(`${GAMMA}/events?active=true&closed=false&order=volume24hr&ascending=false`, maxEvents, 500);
  lastMain = slimMarkets(parsePolymarketEvents(events, new Date()));
  if (deepTo > maxEvents && Date.now() - deepCache.at > deepEvery * 0.85) {
    try { await refreshDeep({ from: maxEvents, to: deepTo, paceMs: 500 }); } catch { /* keep the previous deep cache; the main sweep still succeeded */ }
  }
  return mergedPolymarket();
}

// CLOB price history for one outcome token -> [{t: epochSec, p: 0..1}]
export async function fetchPriceHistory(tokenId, { interval = '1d', fidelity = 60 } = {}) {
  if (!tokenId) return [];
  const url = `${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&interval=${interval}&fidelity=${fidelity}`;
  const j = await getJSON(url, { timeoutMs: 20_000 });
  return (j?.history || []).map((h) => ({ t: Number(h.t), p: Number(h.p) })).filter((h) => Number.isFinite(h.t) && Number.isFinite(h.p));
}
