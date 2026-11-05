// Newsdesk: which headline goes with which story. User directive (2026-11-05): "News and predictions. The news feeds
// drive the market content. Each market content you show should have an accompanying news item."
//
//   const nd = createNewsdesk({ getArchive, getMarkets })
//   nd.lookup(story) -> { items: News[], outlets24, freshH, wire24, via }   cached per story until the archive changes
//   nd.newsFor(story) -> News[]                  up to 3, freshest strong match first ([] = this story does not air)
//   nd.setSearch(storyId, items, {found})        Google News results (already strictly filtered) for one story
//   nd.searchTargets(pending, aired, {max}) -> Story[]   who to search next (pending first, then stale search-only)
//   nd.stats()
// News = { title, source, outlet, url, publishedAt, via: 'wire'|'search', score, tier: 'exact'|'event', about, ageH }
//
// Sources, in order of preference: the wire archive (newsroom.mjs keeps 72h of wire headlines), then a strict
// Google News search per story (ingest.mjs runs it on a per-cycle budget). Relevance is the flash matcher's own
// scorer (editorial/match.mjs matchStoryNews), never a loose keyword hit. Sports / games stories also match by
// entity (a sports or gaming feed headline that names a team, player or game in the story) and may only air with a
// wire headline <= 24h old (rank.mjs enforces that through `wire24`).
import { buildHeadlineIndex, matchStoryNews } from './editorial/match.mjs';
import { looksCut, nonLatin, badNewsSource } from './sources/news.mjs';

const H = 3_600_000;
export const NEWS_GATED = new Set(['sports', 'games', 'esports']);

export function createNewsdesk({ getArchive = () => [], getMarkets = () => [] } = {}) {
  const cache = new Map();     // storyId -> {key, archive, res}
  const search = new Map();    // storyId -> {at, items, found}
  const stats = { lookups: 0, computed: 0, searchSet: 0, searchFound: 0, full: 0, incremental: 0 };

  const outletOf = (n) => String(n.outlet || n.source || '').replace(/ via .*$/, '').trim();
  // r: the matcher result ({item, score, tier, about}); tier/about default to 'exact'/null (missing on old state shapes)
  const toNews = (it, via, score, r = null, now = Date.now()) => {
    const t = Date.parse(it.publishedAt);
    return {
      title: it.title, source: outletOf(it) || 'News', outlet: outletOf(it) || 'News', url: it.url || null,
      publishedAt: it.publishedAt || null, via, score: Math.round((score || 0) * 10) / 10,
      tier: r?.tier || it.tier || 'exact', about: (r?.tier || it.tier) === 'event' ? (r?.about || it.about || null) : null,
      ageH: Number.isFinite(t) ? Math.round(Math.max(0, now - t) / H * 10) / 10 : null,
    };
  };
  // every attached headline (wire, search, saved search hits, flash) passes the D4 sensitive patterns and the junk / retail
  // outlet drops, even if it was saved before those filters existed
  const cleanMemo = new WeakMap();   // archive item -> verdict (the sensitive / junk / retail patterns are a dozen regexes per headline)
  const clean = (n) => { let v = cleanMemo.get(n); if (v === undefined) cleanMemo.set(n, (v = !badNewsSource(n))); return v; };
  const cutMemo = new WeakMap();
  const cut = (it) => { let v = cutMemo.get(it); if (v === undefined) cutMemo.set(it, (v = looksCut(it.title))); return v; };
  const marketKey = (s) => [s.lead?.id, ...(s.markets || []).map((m) => m.id)].join(',');

  // Wire matching is incremental per story (build.newsMs, news gate leftovers 2026-11-05): the archive is a new array on
  // every revision but its items are the same objects, so a story re-scores only the items that arrived since its last
  // match and keeps its earlier results (those still in the archive). A full re-match runs when the story's markets change
  // and every 30 minutes (corroboration bonuses and the market index drift slowly). A delta index is shared by every story.
  const archSets = new WeakMap();      // archive array -> Set of its items
  const deltas = new WeakMap();        // previous archive -> {archive, items, index}
  const setOf = (a) => { let x = archSets.get(a); if (!x) archSets.set(a, (x = new Set(a))); return x; };
  function deltaFor(prevArchive, archive) {
    const d = deltas.get(prevArchive);
    if (d && d.archive === archive) return d;
    const had = setOf(prevArchive);
    const items = archive.filter((x) => !had.has(x));
    const nd = { archive, items, index: items.length ? buildHeadlineIndex(items) : null };
    deltas.set(prevArchive, nd);
    return nd;
  }
  const RAW_MAX = 24;
  function wireMatches(story, archive, now, gated, prev) {
    const opts = { now, max: RAW_MAX, entity: gated, maxAgeMs: 72 * H };
    const mk = getMarkets() || [];
    const key = marketKey(story);
    let raw;
    if (!prev || prev.mkey !== key || !prev.raw || now - prev.fullAt > 30 * 60_000) {
      raw = matchStoryNews(story, buildHeadlineIndex(archive), mk, opts);
      stats.full++;
      wireFullAt = now;
    } else {
      const cur = setOf(archive);
      const d = deltaFor(prev.archive, archive);
      const keep = prev.raw.filter((r) => cur.has(r.item) && now - (Date.parse(r.item.publishedAt) || 0) <= 72 * H);
      const add = d.index ? matchStoryNews(story, d.index, mk, opts) : [];
      stats.incremental++;
      const ts = (x) => Date.parse(x.item.publishedAt) || 0;
      const k = (x) => ts(x) / H + x.score * 0.5 - (x.tier === 'event' ? 6 : 0);
      const seen = new Set();
      raw = [...keep, ...add].sort((a, b) => k(b) - k(a)).filter((x) => { const t = String(x.item.title).toLowerCase(); if (seen.has(t)) return false; seen.add(t); return true; }).slice(0, RAW_MAX);
      wireFullAt = prev.fullAt;
    }
    wireRaw = raw;
    return raw.slice(0, 8);
  }
  let wireRaw = null, wireFullAt = 0, srOut = null;

  function compute(story, archive, now, prev = null) {
    const gated = NEWS_GATED.has(story.category);
    let wire = [];
    try {
      wire = wireMatches(story, archive, now, gated, prev)
        .filter((r) => !cut(r.item) && clean(r.item))
        .map((r) => toNews(r.item, 'wire', r.score, r, now));
    } catch { wire = []; }
    // saved search hits only change with the search entry (the cache key carries its time): reuse the last verdict
    const srKey = `${marketKey(story)}|${search.get(story.id)?.at || 0}`;
    let sr;
    if (prev?.srKey === srKey && prev.sr) sr = prev.sr;
    else {
      sr = gated ? [] : (search.get(story.id)?.items || []).filter((n) => !looksCut(n.title) && !nonLatin(n.title) && !nonLatin(n.source) && clean(n) && now - (Date.parse(n.publishedAt) || 0) <= 7 * 24 * H);
      // re-check saved search hits with the current matcher (data/news-search.json outlives matcher fixes)
      if (sr.length) {
        try {
          const ok = new Map(matchStoryNews(story, buildHeadlineIndex(sr), getMarkets() || [], { now, max: 10, maxAgeMs: 7 * 24 * H }).map((r) => [r.item, r]));
          sr = sr.filter((n) => ok.has(n)).map((n) => toNews(n, 'search', ok.get(n).score, ok.get(n), now));
        } catch { /* keep */ }
      }
    }
    srOut = { srKey, sr };
    const ageH = (n) => (now - (Date.parse(n.publishedAt) || 0)) / H;
    const all = [...wire, ...sr];
    const seen = new Set();
    const uniq = all.filter((n) => { const k = n.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    // wire first when it is as fresh as the search hit (independent outlets over an aggregator), else freshest
    // an exact match outranks an event-level one of similar age (event tier counts as 6h older)
    const rankH = (n) => ageH(n) + (n.via === 'wire' ? 0 : 3) + (n.tier === 'event' ? 6 : 0);
    uniq.sort((a, b) => rankH(a) - rankH(b));
    const recent = uniq.filter((n) => ageH(n) <= 24);
    return {
      items: uniq.slice(0, 3),
      outlets24: new Set(recent.map((n) => n.outlet.toLowerCase())).size,
      freshH: uniq.length ? Math.max(0, Math.min(...uniq.map(ageH))) : null,
      wire24: wire.some((n) => ageH(n) <= 24),
      via: uniq[0]?.via || null,
    };
  }

  function lookup(story, now = Date.now()) {
    if (!story?.id) return { items: [], outlets24: 0, freshH: null, wire24: false, via: null };
    stats.lookups++;
    const archive = getArchive() || [];
    const sAt = search.get(story.id)?.at || 0;
    const key = `${marketKey(story)}|${sAt}`;
    const hit = cache.get(story.id);
    if (hit && hit.archive === archive && hit.key === key) return hit.res;
    stats.computed++;
    wireRaw = null; wireFullAt = 0; srOut = null;
    const res = compute(story, archive, now, hit?.raw ? { archive: hit.archive, raw: hit.raw, mkey: hit.mkey, fullAt: hit.fullAt, srKey: hit.srKey, sr: hit.sr } : null);
    const fullAt = wireFullAt || now;
    cache.set(story.id, { key, archive, res, raw: wireRaw, mkey: marketKey(story), fullAt, srKey: srOut?.srKey, sr: srOut?.sr });
    if (cache.size > 6000) for (const k of [...cache.keys()].slice(0, 1000)) cache.delete(k);
    return res;
  }

  function setSearch(storyId, items, { found = items?.length > 0 } = {}) {
    stats.searchSet++;
    if (found) stats.searchFound++;
    // `misses` counts consecutive searches that found nothing (drives the retry backoff, persisted across restarts)
    const prev = search.get(storyId);
    const misses = found ? 0 : (prev?.misses || (prev && !prev.found ? 1 : 0)) + 1;
    search.set(storyId, { at: Date.now(), found, misses, items: (items || []).map((r) => (r.item ? toNews(r.item, 'search', r.score, r) : { ...r, via: 'search' })) });
    if (search.size > 3000) for (const k of [...search.keys()].slice(0, 500)) search.delete(k);
  }

  // Who to search next (DECISIONS 2026-11-05 news gate build, option 1):
  //   1. pending stories never searched, rank order (a story whose market is moving first goes ahead of the rest);
  //   2. pending stories whose retry is due, oldest due first. A miss waits retryMin (90), doubling per consecutive miss
  //      (90 / 180 / 360), so retries no longer eat the budget;
  //   3. aired stories whose only news is a search hit older than refreshMin (120).
  // Sports / games are wire-only and never searched.
  const missesOf = (r) => (r ? (r.misses ?? (r.found ? 0 : 1)) : 0);
  const retryWaitMs = (r, retryMin, retryMaxMin) => Math.min(retryMaxMin, retryMin * 2 ** Math.max(0, missesOf(r) - 1)) * 60_000;
  function searchTargets(pending = [], aired = [], { max = 14, retryMin = 90, retryMaxMin = 360, refreshMin = 120 } = {}) {
    const now = Date.now();
    const out = [];
    const used = new Set();
    const ok = (s) => s?.id && !NEWS_GATED.has(s.category) && !used.has(s.id);
    const add = (s) => { out.push(s); used.add(s.id); };
    const fresh = pending.filter((s) => ok(s) && !search.get(s.id));
    for (const s of [...fresh.filter((x) => x.movingFirst), ...fresh.filter((x) => !x.movingFirst)]) { if (out.length >= max) break; add(s); }
    const due = pending.filter((s) => { const r = search.get(s.id); return ok(s) && r && now - r.at > retryWaitMs(r, retryMin, retryMaxMin); })
      .sort((a, b) => (search.get(a.id).at + retryWaitMs(search.get(a.id), retryMin, retryMaxMin)) - (search.get(b.id).at + retryWaitMs(search.get(b.id), retryMin, retryMaxMin)));
    for (const s of due) { if (out.length >= max) break; add(s); }
    for (const s of aired) {
      if (out.length >= max) break;
      const r = search.get(s.id);
      const l = cache.get(s.id)?.res;
      if (ok(s) && l?.via === 'search' && (!r || now - r.at > refreshMin * 60_000)) add(s);
    }
    return out;
  }

  // the pending pool as the search sees it (health / feeds.news): searchable stories never searched, and ones waiting on a retry
  function poolStats(pending = []) {
    let neverSearched = 0, retrying = 0, size = 0;
    for (const s of pending) {
      if (!s?.id || NEWS_GATED.has(s.category)) continue;
      size++;
      if (search.get(s.id)) retrying++; else neverSearched++;
    }
    return { size, neverSearched, retrying };
  }

  // persistence (ingest.mjs saves to data/news-search.json): a restart keeps the last two days of search hits and misses (a miss is not searched again after a restart)
  function dump() { const cut = Date.now() - 48 * H; return [...search.entries()].filter(([, v]) => v.at >= cut); }
  function load(entries) { for (const [k, v] of entries || []) if (v?.at && Array.isArray(v.items) && !search.has(k)) search.set(k, v); }

  return {
    dump,
    load,
    lookup,
    newsFor: (s) => lookup(s).items,
    setSearch,
    searchTargets,
    poolStats,
    searched: (id) => search.get(id) || null,
    stats: () => ({ ...stats, cached: cache.size, searched: search.size, archive: (getArchive() || []).length }),
  };
}

export default { createNewsdesk, NEWS_GATED };
