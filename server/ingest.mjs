// Ingest: schedules each source independently (jitter + exponential backoff), then rebuilds
// the broadcast state: merge markets -> record samples -> breaking -> stories -> flash boosts -> attach news/history.
// The news wire (NEWS MEETS MARKETS flashes, state.wire) runs in newsroom.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.mjs';
import { fetchPolymarket, parsePolymarketEvents, fetchPriceHistory, sweepPolymarketTags, mergedPolymarket } from './sources/polymarket.mjs';
import { fetchKalshi, fetchKalshiHistory } from './sources/kalshi.mjs';
import { fetchHeadlines } from './sources/news.mjs';
import { detectBreaking } from './editorial/breaking.mjs';
import { buildStories } from './editorial/rank.mjs';
import { newsQuery } from './editorial/copy.mjs';
import { classify } from './editorial/filter.mjs';
import { startNewsroom } from './newsroom.mjs';
import { createMoments } from './moments.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errMsg = (e) => String(e?.message || e).slice(0, 300);

export function startIngest(store, config, { sim = false } = {}) {
  const P = config.poll;
  const latest = { polymarket: [], kalshi: [], airable: [] };
  const newsCache = new Map();      // storyId -> [{title, source, url, publishedAt}]
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
      const news = newsCache.get(s.id) || s.news || [];
      let newsMarks = s.newsMarks || [];
      try { if (newsroom?.marksFor) newsMarks = newsroom.marksFor(s) || newsMarks; } catch { /* keep */ }
      return { ...s, news: newsroom ? newsroom.newsFor(s, news) : news, history: historyFor(s), newsMarks };
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
        hasNews: (id) => (newsCache.get(id) || []).length > 0,
        historyLen: (leadId) => Math.max(historyCache.get(leadId)?.points?.length || 0, store.history(leadId).length),
      };
      out = buildStories(markets, config, { now, enrich });
      const dead = Object.fromEntries(Object.entries(out?.stats?.dropped || {}).filter(([k]) => k.startsWith('dead:')));
      lastBuild = { motionMs, buildMs: Date.now() - tb, airable: airable.length, dead };
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
    if (!built) log('info', 'first build', { markets: markets.length, stories: stories.length });
    built = true;
    maybeBackfill({ stories, desks });
    try { moments.onRebuild({ stories, desks, closing, airable, aliases: lastAliases }); } catch (e) { log('error', 'moments failed', { error: errMsg(e), stack: String(e?.stack || '').slice(0, 800) }); }
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
    const missNews = enrichTargets(state, newsN).filter((s) => !newsCache.has(s.id)).length;
    const missHist = enrichTargets(state, histN).filter((s) => s.lead && !historyCache.has(s.lead.id)).length;
    if (missNews >= 3) kick('news', refreshNews);
    if (missHist >= 3) kick('history', refreshHistory);
  }

  function reattach() {
    const s = store.getState();
    store.setState({ stories: attach(s.stories), closing: attach(s.closing), desks: attachDesks(s.desks) });
  }

  // --- news + history ------------------------------------------------------
  async function refreshNews() {
    const stories = enrichTargets(store.getState(), P.newsTopN ?? 10);
    if (!stories.length) return;
    let ok = 0, lastErr = null;
    for (const s of stories) {
      try {
        const q = newsQuery(s);
        if (!q) continue;
        const items = await fetchHeadlines(q, { max: P.newsMax ?? 2 });
        newsCache.set(s.id, Array.isArray(items) ? items : []);
        ok++;
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 750));
    }
    if (newsCache.size > 200) for (const k of [...newsCache.keys()].slice(0, newsCache.size - 200)) newsCache.delete(k);
    if (ok) feedOk('news', [...newsCache.values()].filter((v) => v.length).length);
    else if (lastErr) feedErr('news', lastErr);
    reattach();
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
  schedule('news', P.newsSec, refreshNews, { initialDelayMs: sim ? 5000 : 25_000 });

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
    stop() { newsroom?.stop(); moments.stop(); timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); },
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
