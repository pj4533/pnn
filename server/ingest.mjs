// Ingest: schedules each source independently (jitter + exponential backoff), then rebuilds
// the broadcast state: merge markets -> record samples -> breaking -> stories -> flash boosts -> attach news/history.
// The news wire (NEWS MEETS MARKETS flashes, state.wire) runs in newsroom.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.mjs';
import { fetchPolymarket, parsePolymarketEvents, fetchPriceHistory, sweepPolymarketTags, mergedPolymarket } from './sources/polymarket.mjs';
import { fetchKalshi, fetchKalshiHistory } from './sources/kalshi.mjs';
import { fetchHeadlines, badNewsSource } from './sources/news.mjs';
import { detectBreaking } from './editorial/breaking.mjs';
import { buildStories } from './editorial/rank.mjs';
import { newsQuery } from './editorial/copy.mjs';
import * as copy from './editorial/copy.mjs';
import { classify } from './editorial/filter.mjs';
import { filterHeadlinesForStory } from './editorial/match.mjs';
import { startNewsroom } from './newsroom.mjs';
import { createNewsdesk } from './newsdesk.mjs';
import { createMoments } from './moments.mjs';
import { createFinance } from './finance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errMsg = (e) => String(e?.message || e).slice(0, 300);

const newsMsLog = [];   // [timestamp, newsMs] of the last 10 minutes of builds (health: newsMsMax10m / newsMsP50)
export function startIngest(store, config, { sim = false } = {}) {
  const P = config.poll;
  const latest = { polymarket: [], kalshi: [], airable: [] };
  // News gate (DECISIONS 2026-11-05 news-driven PNN): every story that airs carries a matching headline. The newsdesk
  // matches stories to the wire archive and to per-story Google News searches; stories with none wait in `pending`.
  const newsdesk = createNewsdesk({ getArchive: () => newsroom?.archive?.() || [], getMarkets: () => latest.airable });
  const gateNews = !sim;
  const SEARCH_FILE = path.resolve(ROOT, 'data', 'news-search.json');
  if (!sim) { try { newsdesk.load(JSON.parse(fs.readFileSync(SEARCH_FILE, 'utf8'))); } catch { /* first run */ } }
  const saveSearch = () => { if (sim) return; try { fs.mkdirSync(path.dirname(SEARCH_FILE), { recursive: true }); fs.writeFileSync(SEARCH_FILE, JSON.stringify(newsdesk.dump())); } catch (e) { log('warn', 'news search save failed', { error: errMsg(e) }); } };
  let pending = [];
  let coverage = { onAir: 0, withNews: 0, pct: null, pending: 0 };
  const historyCache = new Map();   // marketId -> {points, at}
  const timers = [];
  let built = false;
  let lastAliases = {};
  let lastBuild = {};
  let newsroom = null;

  store.setState({ sim });
  // Corner pops (ON THE MOVE, JUST LISTED, MONEY MOVING) and the Next Big Decision countdown (moments.mjs).
  const moments = createMoments(store, config, { sim });
  store.momentsHealth = () => moments.stats();
  store.buildHealth = () => lastBuild;
  store.newsCoverage = () => coverage;
  store.newsdeskStats = () => newsdesk.stats();

  function feedOk(name, count) {
    Object.assign(store.feeds[name], { ok: true, lastOk: new Date().toISOString(), lastError: null, count });
  }
  function feedErr(name, e) {
    const was = store.feeds[name].ok;
    Object.assign(store.feeds[name], { ok: false, lastError: errMsg(e) });
    log(was ? 'error' : 'warn', 'feed error', { feed: name, error: errMsg(e), status: e?.status });
  }

  // --- scheduler -----------------------------------------------------------
  function schedule(name, intervalSec, fn, { initialDelayMs = 0 } = {}) {
    let fails = 0;
    const jitter = P.jitter ?? 0.15;
    const next = () => {
      const base = fails ? Math.min(intervalSec * 2 ** fails, P.backoffMaxSec ?? 1800) : intervalSec;
      const ms = Math.max(1000, base * 1000 * (1 + jitter * (Math.random() * 2 - 1)));
      const t = setTimeout(run, ms);
      t.unref?.();
      timers.push(t);
      if (timers.length > 50) timers.splice(0, timers.length - 50);
      if (fails) log('warn', 'backoff', { task: name, fails, nextSec: Math.round(ms / 1000) });
    };
    const run = async () => {
      const t0 = Date.now();
      try {
        await fn();
        fails = 0;
        log('debug', 'task ok', { task: name, ms: Date.now() - t0 });
      } catch (e) {
        fails += 1;
        log('warn', 'task failed', { task: name, fails, error: errMsg(e) });
      }
      next();
    };
    const t = setTimeout(run, initialDelayMs);
    t.unref?.();
    timers.push(t);
  }

  // --- attach + rebuild ----------------------------------------------------
  function historyFor(story) {
    const lead = story.lead;
    if (!lead) return null;
    const cached = historyCache.get(lead.id);
    if (cached?.points?.length >= 2) return cached.points;
    const own = store.history(lead.id);
    return own.length >= 2 ? own.slice() : null;
  }

  function attach(list) {
    return (list || []).map((s) => {
      let news = s.news || [];
      try { const n = newsdesk.newsFor(s); if (n.length) news = n; } catch { /* keep */ }
      let newsMarks = s.newsMarks || [];
      try { if (newsroom?.marksFor) newsMarks = newsroom.marksFor(s) || newsMarks; } catch { /* keep */ }
      // D4 / independence once more at the last step: no attached headline (wire, search, flash) carries war, violence or death wording
      const attached = (newsroom ? newsroom.newsFor(s, news) : news).filter((n) => !badNewsSource(n));
      return { ...s, news: attached, history: historyFor(s), newsMarks };
    });
  }
  const attachDesks = (desks) => (desks || []).map((d) => ({ ...d, stories: attach(d.stories) }));
  // Stories that get fetched news + exchange history: the top of the board plus each desk's lead (deduped).
  function enrichTargets(state, n) {
    const out = [...(state.stories || []).slice(0, n)];
    for (const d of state.desks || []) { const s = d.stories?.[0]; if (s && !out.some((x) => x.id === s.id)) out.push(s); }
    return out;
  }

  function rebuild(reason) {
    const t0 = Date.now();
    const now = new Date();
    const markets = [...latest.polymarket, ...latest.kalshi];
    if (!markets.length) return;
    // Only markets that can air are sampled: breaking and sparklines never read the rest, and sampling all
    // ~40k markets was a large share of memory.
    // The same airable set (both exchanges, every market that passes the filter, not just the board) is the
    // news-to-market match index; a stable array per rebuild lets match.mjs cache its index.
    const airable = markets.filter((m) => { try { return classify(m, config, { now }).keep; } catch { return false; } });
    latest.airable = airable;
    store.recordPrices(airable);
    // "What's moving now": attach PNN's own short-window motion (change1h, change15m, flatMin) to each airable
    // market before ranking. Only airable markets are sampled; the rest carry nulls.
    const nowSec = now.getTime() / 1000;
    const tm = Date.now();
    for (const m of airable) Object.assign(m, store.motion ? store.motion(m.id, nowSec) : { change1h: null, change15m: null, flatMin: null });
    const motionMs = Date.now() - tm;
    const tb = Date.now();
    let out;
    try {
      const enrich = {
        ...(gateNews ? { newsLookup: (s) => newsdesk.lookup(s, now.getTime()) } : {}),
        hasNews: (id) => (newsdesk.searched(id)?.items?.length || 0) > 0,
        historyLen: (leadId) => Math.max(historyCache.get(leadId)?.points?.length || 0, store.history(leadId).length),
      };
      out = buildStories(markets, config, { now, enrich });
      const dead = Object.fromEntries(Object.entries(out?.stats?.dropped || {}).filter(([k]) => k.startsWith('dead:')));
      const ns = out?.stats?.news || {};
      if (ns.ms != null) { const t = Date.now(); newsMsLog.push([t, ns.ms]); while (newsMsLog.length && t - newsMsLog[0][0] > 600_000) newsMsLog.shift(); }
      const nm = newsMsLog.map((x) => x[1]).sort((a, b) => a - b);
      lastBuild = { motionMs, buildMs: Date.now() - tb, airable: airable.length, dead, newsMs: ns.ms ?? null, newsMsMax10m: nm.length ? nm[nm.length - 1] : null, newsMsP50: nm.length ? nm[nm.length >> 1] : null, newsDropped: { none: out?.stats?.dropped?.['news:none'] || 0, sportsGames: ns.sgDropped || 0, sgScore: ns.sgScoreDropped || 0, movingFirstCapped: out?.stats?.dropped?.['news:moving-first-capped'] || 0, headlinesBlocked: ns.headlinesBlocked || 0 } };
      pending = out?.pending || [];
    } catch (e) {
      log('error', 'buildStories failed', { error: errMsg(e), stack: String(e?.stack || '').slice(0, 800) });
    }
    try {
      // An event merged into the other exchange's story airs under that story's id: detectBreaking keys its
      // per-event dedupe and cooldown on the aired id, and we keep only the biggest move per story here too.
      const raw = detectBreaking(markets, store, config, { now, aliases: out?.aliases }) || [];
      const byStory = new Map();
      for (const a of raw) {
        a.storyId = out?.aliases?.[a.storyId] || a.storyId;
        const prev = byStory.get(a.storyId);
        if (!prev || Math.abs(a.to - a.from) > Math.abs(prev.to - prev.from)) byStory.set(a.storyId, a);
      }
      const alerts = [...byStory.values()];
      if (alerts.length) store.addAlerts(alerts);
    } catch (e) {
      log('error', 'detectBreaking failed', { error: errMsg(e), stack: String(e?.stack || '').slice(0, 800) });
    }
    if (!out) return;
    lastAliases = out.aliases || {};
    // Flash-matched stories lead the board for a few minutes (newsroom.mjs). rank.mjs has no boost option,
    // so the boost is applied here, after ranking.
    let board = out.stories;
    try {
      if (newsroom) board = newsroom.applyBoosts(out.stories, airable, [...(out.desks || []).map((d) => d.stories), out.closing]);
    } catch (e) {
      log('error', 'applyBoosts failed', { error: errMsg(e), stack: String(e?.stack || '').slice(0, 800) });
    }
    const stories = attach(board);
    const closing = attach(out?.closing);
    const desks = attachDesks(out?.desks);
    store.setState({ stories, movers: out?.movers || [], closing, desks });
    coverage = newsCoverage({ stories, closing, desks, movers: out?.movers || [] });
    lastBuild.newsCoverage = coverage;
    if (!built) log('info', 'first build', { markets: markets.length, stories: stories.length });
    built = true;
    maybeBackfill({ stories, desks });
    try { moments.onRebuild({ stories, desks, closing, airable, aliases: lastAliases, newsFor: (m) => newsdesk.newsFor({ id: `cd:${m.id}`, lead: m, markets: [m], eventTitle: m.eventTitle, category: m.category }) }); } catch (e) { log('error', 'moments failed', { error: errMsg(e), stack: String(e?.stack || '').slice(0, 800) }); }
    log('debug', 'rebuild', { reason, markets: markets.length, stories: stories.length, ms: Date.now() - t0, ...lastBuild });
  }

  // When the lineup changes (e.g. Kalshi's first sweep lands), fetch news/history for new leads now
  // instead of waiting up to a full interval. Rate-limited to once per 2 minutes per task.
  const lastKick = { news: 0, history: 0 };
  const running = { news: false, history: false };
  function kick(name, fn) {
    if (running[name] || Date.now() - lastKick[name] < 120_000) return;
    lastKick[name] = Date.now();
    running[name] = true;
    fn().catch((e) => log('warn', 'backfill failed', { task: name, error: errMsg(e) })).finally(() => { running[name] = false; });
  }
  function maybeBackfill(state) {
    if (sim) return;
    const newsN = P.newsTopN ?? 10, histN = P.historyTopN ?? 8;
    const missNews = newsdesk.searchTargets(pending, enrichTargets(state, newsN), { max: 3 }).length;
    const missHist = enrichTargets(state, histN).filter((s) => s.lead && !historyCache.has(s.lead.id)).length;
    if (missNews >= 3) kick('news', refreshNews);
    if (missHist >= 3) kick('history', refreshHistory);
  }

  function reattach() {
    const s = store.getState();
    store.setState({ stories: attach(s.stories), closing: attach(s.closing), desks: attachDesks(s.desks) });
  }

  const SG = new Set(['sports', 'games', 'esports']);
  // on-air stories by news tier: exact (default), event-level, markets moving first (no headline yet)
  const tiers = (on) => {
    const t = { exact: 0, event: 0, movingFirst: 0 };
    for (const s of on) {
      if (s.newsTier === 'none-moving-first') t.movingFirst++;
      else if ((s.newsTier || s.news?.[0]?.tier) === 'event') t.event++;
      else if (s.news?.length) t.exact++;
    }
    return t;
  };
  function newsCoverage(st) {
    const seen = new Map();
    for (const s of [...(st.stories || []), ...(st.closing || []), ...(st.desks || []).flatMap((d) => d.stories || [])]) if (s?.id && !seen.has(s.id)) seen.set(s.id, s);
    const on = [...seen.values()];
    const withNews = on.filter((s) => s.news?.length).length;
    const movers = st.movers || [];
    const ageH = (s) => { const t = Date.parse(s.news?.[0]?.publishedAt); return Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : null; };
    const ages = on.map(ageH).filter((x) => x != null).sort((a, b) => a - b);
    return {
      pool: newsdesk.poolStats(pending),
      tiers: tiers(on),
      movingFirstPct: on.length ? Math.round((on.filter((s) => s.newsTier === 'none-moving-first').length / on.length) * 1000) / 1000 : null,
      onAir: on.length, withNews, pct: on.length ? Math.round((withNews / on.length) * 1000) / 10 : null, pending: pending.length,
      movers: movers.length, moversWithNews: movers.filter((m) => m.news?.length).length,
      viaWire: on.filter((s) => s.news?.[0]?.via === 'wire' || s.news?.[0]?.flash).length,
      viaSearch: on.filter((s) => s.news?.[0]?.via === 'search').length,
      medianNewsAgeH: ages.length ? Math.round(ages[Math.floor(ages.length / 2)] * 10) / 10 : null,
      sportsGames: { board: (st.stories || []).filter((s) => SG.has(s.category)).length,
        desk: (st.desks || []).find((d) => d.id === 'sports')?.stories?.length || 0 },
      gated: gateNews,
      archive: (newsroom?.archive?.() || []).length,
    };
  }

  // --- news + history ------------------------------------------------------
  // Per-story Google News search for stories the wire did not cover: pending (held off air) first, best rank first,
  // then aired stories whose only headline is an hour-old search hit. A request budget per cycle, 1.5s apart; a 429 /
  // 5xx stops the cycle and the scheduler backs off (http.mjs also backs the host off). Results are kept only when
  // they pass the same strict story scorer as the wire (match.mjs), so an unrelated search hit never airs.
  let searching = false;
  // Rate-limit reaction (option 1): a 429 halves the per-cycle budget for 30 min, then it is restored.
  let budgetScale = 1, rateLimitedAt = 0;
  const searchLog = [];   // {at, searched, found}: feeds.news searched1h / found1h
  let lastBudget = P.newsBudget ?? 14;
  async function refreshNews() {
    if (searching) return;
    searching = true;
    try { await searchCycle(); } finally { searching = false; }
  }
  function updateNewsFeed() {
    const cut = Date.now() - 3_600_000;
    while (searchLog.length && searchLog[0].at < cut) searchLog.shift();
    const pool = newsdesk.poolStats(pending);
    Object.assign(store.feeds.news, {
      budget: lastBudget, scale: budgetScale, searched1h: searchLog.reduce((a, x) => a + x.searched, 0), found1h: searchLog.reduce((a, x) => a + x.found, 0),
      pool: pool.size, neverSearched: pool.neverSearched, retrying: pool.retrying,
    });
  }
  async function searchCycle() {
    if (budgetScale < 1 && Date.now() - rateLimitedAt > 30 * 60_000) { budgetScale = 1; log('info', 'news budget restored', { budget: P.newsBudget ?? 14 }); }
    const st = store.getState();
    const aired = [...(st.stories || []), ...(st.desks || []).flatMap((d) => d.stories || [])];
    // a short board (just after a restart, or a quiet news day) searches a little harder
    const short = (st.stories || []).length < (config.limits?.stories ?? 30);
    const budget = Math.max(1, Math.round((short ? (P.newsBudgetShort ?? 20) : (P.newsBudget ?? 14)) * budgetScale));
    lastBudget = budget;
    const targets = newsdesk.searchTargets(pending, aired, {
      max: budget, retryMin: P.newsRetryMin ?? 90, retryMaxMin: P.newsRetryMaxMin ?? 360, refreshMin: P.newsRefreshMin ?? 120,
    });
    if (!targets.length) { updateNewsFeed(); return; }
    const ttlMs = (P.newsCacheMin ?? 45) * 60_000;
    const pace = () => new Promise((r) => setTimeout(r, 1500));
    const hitsFor = async (q, s) => {
      const raw = await fetchHeadlines(q, { max: 10, throwOnError: true, ttlMs });
      const items = (Array.isArray(raw) ? raw : []).map((it) => ({ ...it, outlet: it.source, category: 'search' }));
      return filterHeadlinesForStory(s, items, latest.airable, { maxAgeMs: 7 * 24 * 3_600_000 });
    };
    let ok = 0, found = 0, spent = 0, never = 0, retry = 0, eventQ = 0, lastErr = null, limited = false;
    for (const s of targets) {
      if (spent >= budget) break;
      // lead-outcome query first; when it finds nothing and the story has an event-level phrase, one more search (counted
      // against the budget) for "next James Bond" / "Fed December meeting"; hits are scored by the same strict matcher
      const qs = ((typeof copy.newsQueries === 'function' ? copy.newsQueries(s) : null) ?? [newsQuery(s)]).filter(Boolean);
      if (!qs.length) { newsdesk.setSearch(s.id, [], { found: false }); continue; }
      if (newsdesk.searched(s.id)) retry++; else never++;
      try {
        spent++;
        let hits = await hitsFor(qs[0], s);
        if (!hits.length && qs[1] && spent < budget) {
          await pace();
          spent++; eventQ++;
          hits = await hitsFor(qs[1], s);
        }
        newsdesk.setSearch(s.id, hits);
        ok++;
        if (hits.length) found++;
      } catch (e) {
        lastErr = e;
        if (e?.status === 429) { limited = true; break; }
        if (e?.status >= 500) break;
      }
      await pace();
    }
    searchLog.push({ at: Date.now(), searched: ok, found });
    if (limited) {
      budgetScale = 0.5; rateLimitedAt = Date.now();
      log('warn', 'news budget halved', { budget: Math.max(1, Math.round((P.newsBudget ?? 14) * budgetScale)), restoreMin: 30 });
    }
    log('info', 'news search', { targets: targets.length, ok, found, never, retry, event: eventQ, spent, budget, pending: pending.length, error: lastErr ? errMsg(lastErr) : undefined });
    if (ok) feedOk('news', newsdesk.stats().searchFound);
    else if (lastErr) feedErr('news', lastErr);
    // every cycle that searched anything is saved, so misses survive a restart and are not searched again
    if (ok) saveSearch();
    if (found) rebuild('news'); else reattach();
    updateNewsFeed();
    if (!ok && lastErr) throw lastErr;
  }

  async function refreshHistory() {
    const leads = enrichTargets(store.getState(), P.historyTopN ?? 8).map((s) => s.lead)
      .filter((m) => m && ((m.source === 'polymarket' && m.tokenId) || m.source === 'kalshi'));
    if (!leads.length) return;
    let ok = 0, lastErr = null;
    for (const m of leads) {
      try {
        const pts = m.source === 'kalshi' ? await fetchKalshiHistory(m.id)
          : await fetchPriceHistory(m.tokenId, P.history || { interval: '1d', fidelity: 30 });
        if (Array.isArray(pts) && pts.length >= 2) historyCache.set(m.id, { points: pts, at: Date.now() });
        ok++;
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    const cutoff = Date.now() - 3 * (P.historySec ?? 600) * 1000;
    for (const [k, v] of historyCache) if (v.at < cutoff) historyCache.delete(k);
    reattach();
    if (!ok && lastErr) throw lastErr;
  }

  // --- live sources --------------------------------------------------------
  async function pollPolymarket() {
    try {
      const ms = await fetchPolymarket();
      latest.polymarket = Array.isArray(ms) ? ms : [];
      feedOk('polymarket', latest.polymarket.length);
    } catch (e) {
      feedErr('polymarket', e);
      throw e;
    }
    rebuild('polymarket');
  }

  // Slow per-tag Polymarket sweep for non-election breadth; the cached result merges into every main poll.
  async function sweepPolymarketTagsTask() {
    const S = config.sources?.polymarket || {};
    const t0 = Date.now();
    const ms = await sweepPolymarketTags({ tags: S.tagSlugs || [], limit: S.tagLimit ?? 50, paceMs: S.tagPaceMs ?? 350 });
    log('info', 'polymarket tag sweep', { markets: ms.length, events: new Set(ms.map((m) => m.eventId)).size, ms: Date.now() - t0 });
    if (store.feeds.polymarket.ok) {
      latest.polymarket = mergedPolymarket();
      store.feeds.polymarket.count = latest.polymarket.length;
      rebuild('polymarket-tags');
    }
  }

  async function pollKalshi() {
    try {
      const ms = await fetchKalshi();
      latest.kalshi = Array.isArray(ms) ? ms : [];
      feedOk('kalshi', latest.kalshi.length);
    } catch (e) {
      feedErr('kalshi', e);
      throw e;
    }
    rebuild('kalshi');
  }

  try {
    newsroom = startNewsroom(store, config, {
      sim,
      getMarkets: () => latest.airable,
      getAliases: () => lastAliases,
      rebuild,
    });
  } catch (e) {
    log('error', 'newsroom start failed', { error: errMsg(e), stack: String(e?.stack || '').slice(0, 800) });
  }

  // Stock and bond moves (finance.mjs, QUEUED-FIXES item 12): its own market-hours poller publishes state.finance.
  // Headlines come from the newsroom's wire archive; paired markets from the airable index, else fetched by slug/series.
  let finance = null;
  if (!sim && config.finance?.enabled !== false) {
    try {
      finance = createFinance(store, config, { getArchive: () => newsroom?.archive?.() || [], getMarkets: () => latest.airable });
      store.financeHealth = () => finance.stats();
      finance.start({ initialDelayMs: 6000 });
    } catch (e) {
      log('error', 'finance start failed', { error: errMsg(e), stack: String(e?.stack || '').slice(0, 800) });
    }
  } else store.setState({ finance: { moves: [], quotes: [], session: null, asOf: null, note: sim ? 'SIM: no market quotes' : 'finance off', stats: null } });

  if (sim) { startSim(); moments.startSim(); }
  else {
    schedule('polymarket', P.polymarketSec, pollPolymarket, { initialDelayMs: 0 });
    schedule('kalshi', P.kalshiSec, pollKalshi, { initialDelayMs: 2000 });
    if (config.sources?.polymarket?.tagSlugs?.length) {
      schedule('polymarket-tags', config.sources.polymarket.tagSweepSec ?? 900, sweepPolymarketTagsTask, { initialDelayMs: 8000 });
    }
    schedule('history', P.historySec, refreshHistory, { initialDelayMs: 15_000 });
    // MONEY MOVING: big Polymarket trades on the top board/desk stories (one data-api request per 20 markets).
    schedule('money', config.moments?.moneyPollSec ?? 120, () => moments.pollMoney(), { initialDelayMs: 60_000 });
  }
  schedule('news', P.newsSearchSec ?? 90, refreshNews, { initialDelayMs: sim ? 5000 : 25_000 });

  // --- SIM -----------------------------------------------------------------
  function loadSimMarkets() {
    const S = config.sim || {};
    const now = new Date();
    const readJSON = (rel) => JSON.parse(fs.readFileSync(path.resolve(ROOT, rel), 'utf8'));
    const events = readJSON(S.eventsFile || 'research/samples/polymarket-events-top20-2026-11-04.json');
    const evList = Array.isArray(events) ? events : events?.events || events?.data || [];
    const known = new Set(evList.map((e) => String(e.id)));
    // The markets file is an array of markets, each with its parent in .events[0]. Regroup into events.
    let extra = [];
    try {
      const mk = readJSON(S.marketsFile || 'research/samples/polymarket-markets-top100-2026-11-04.json');
      const byEvent = new Map();
      for (const m of Array.isArray(mk) ? mk : []) {
        const ev = m.events?.[0];
        if (!ev?.id || known.has(String(ev.id))) continue;
        if (!byEvent.has(ev.id)) byEvent.set(ev.id, { ...ev, tags: ev.tags || [], markets: [] });
        const { events: _drop, ...rest } = m;
        byEvent.get(ev.id).markets.push(rest);
      }
      extra = [...byEvent.values()];
    } catch (e) {
      log('warn', 'sim: markets sample unreadable', { error: errMsg(e) });
    }
    const markets = parsePolymarketEvents([...evList, ...extra], now) || [];
    log('info', 'sim loaded', { events: evList.length + extra.length, markets: markets.length });
    return markets;
  }

  function startSim() {
    const S = config.sim || {};
    let markets;
    try {
      markets = loadSimMarkets().map((m) => ({ ...m }));
    } catch (e) {
      feedErr('polymarket', e);
      log('error', 'sim load failed', { error: errMsg(e), stack: String(e?.stack || '').slice(0, 800) });
      return;
    }
    Object.assign(store.feeds.kalshi, { ok: false, lastOk: null, lastError: 'SIM: no Kalshi market sample (series list only)', count: 0 });

    // Backfill 24h of samples so sparklines and breaking windows have a baseline. The path ends at
    // the current price, so the start state never fires a fake breaking alert.
    const nowSec = Math.round(Date.now() / 1000);
    const steps = 48;
    for (let i = steps; i >= 1; i--) {
      const t = nowSec - i * 1800;
      const frac = 1 - i / steps;
      const batch = markets.map((m) => {
        const start = clamp(m.yesPrice - (m.change1d ?? 0));
        const p = i === 1 ? m.yesPrice : clamp(start + (m.yesPrice - start) * frac + (Math.random() - 0.5) * 0.01);
        return { id: m.id, yesPrice: p };
      });
      store.recordPrices(batch, { t });
    }
    store.recordPrices(markets);

    let tick = 0;
    const step = () => {
      tick++;
      const now = new Date().toISOString();
      const n = S.jitterMarkets ?? 5;
      for (let i = 0; i < n && markets.length; i++) {
        const m = markets[Math.floor(Math.random() * markets.length)];
        if (m.yesPrice <= 0.005 || m.yesPrice >= 0.995) continue;
        nudge(m, (Math.random() * 2 - 1) * (S.jitterPoints ?? 0.025), now);
      }
      const every = S.jumpEveryTicks ?? 8;
      if (tick % every === 0 || Math.random() < 1 / (every * 3)) {
        const pool = markets.filter((m) => m.volume24h >= (config.breaking?.minVolume ?? 50_000)
          && m.yesPrice > 0.08 && m.yesPrice < 0.92 && safeKeep(m));
        if (pool.length) {
          const m = pool[Math.floor(Math.random() * pool.length)];
          const [lo, hi] = S.jumpPoints || [0.1, 0.16];
          const size = lo + Math.random() * (hi - lo);
          const dir = m.yesPrice > 0.5 ? -1 : 1;
          const from = m.yesPrice;
          nudge(m, dir * size, now);
          log('info', 'sim jump', { marketId: m.id, title: m.title, from: round(from), to: round(m.yesPrice) });
        }
      }
      latest.polymarket = markets.map((m) => ({ ...m }));
      feedOk('polymarket', markets.length);
      rebuild('sim');
    };
    latest.polymarket = markets.map((m) => ({ ...m }));
    feedOk('polymarket', markets.length);
    rebuild('sim-start');
    const iv = setInterval(() => {
      try { step(); } catch (e) { log('error', 'sim tick failed', { error: errMsg(e), stack: String(e?.stack || '').slice(0, 800) }); }
    }, (P.simTickSec ?? 15) * 1000);
    iv.unref?.();
    timers.push(iv);
  }

  function safeKeep(m) {
    try { return classify(m, config)?.keep !== false; } catch { return true; }
  }

  return {
    rebuild,
    newsroom: () => newsroom,
    moments: () => moments,
    finance: () => finance,
    stop() { saveSearch(); newsroom?.stop(); moments.stop(); finance?.stop(); timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); },
  };
}

function nudge(m, delta, nowIso) {
  const before = m.yesPrice;
  m.yesPrice = clamp(before + delta);
  const d = m.yesPrice - before;
  if (typeof m.change1d === 'number') m.change1d += d; else m.change1d = d;
  if (typeof m.change1w === 'number') m.change1w += d;
  m.updatedAt = nowIso;
}

function clamp(p) {
  return Math.min(0.995, Math.max(0.005, Number.isFinite(p) ? p : 0.5));
}

function round(p) {
  return Math.round(p * 1000) / 1000;
}
