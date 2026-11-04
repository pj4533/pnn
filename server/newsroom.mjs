// Newsroom: runs the news wire inside the server and turns breaking clusters into NEWS MEETS MARKETS flashes.
//   wire 'breaking' cluster -> matchMarkets (against ALL latest markets) -> buildFlash -> store.addFlash (SSE 'flash')
//   -> a temporary boost so the matched story leads the board for flash.boostMin minutes ("worked in").
// Also keeps state.wire (the headline crawl) and store.feeds.wire (health) current.
// SIM: no network. A canned wire (a few headlines) and a canned breaking cluster every flash.simEverySec,
// matched against the SIM markets with live search off.
//
// API (used by ingest.mjs)
//   const nr = startNewsroom(store, config, {sim, getMarkets, getAliases, rebuild})
//   nr.applyBoosts(stories, markets) -> stories   boosted stories moved to the front, with story.flash + story.tags 'news'
//   nr.newsFor(story, list) -> list               prepends the flash headline to story.news when the story is boosted
//   nr.stop()
import { log } from './log.mjs';
import wireConfig from './wire-config.mjs';
import { createWire } from './sources/wire.mjs';
import { matchMarkets, analyzeCluster } from './editorial/match.mjs';
import { tokenSet, jaccard } from './editorial/text.mjs';
import { isMarginBracket } from './editorial/rank.mjs';
import { buildFlash, marketDataLine } from './editorial/flash.mjs';

const errMsg = (e) => String(e?.message || e).slice(0, 300);
const THEME = { elections: 'politics', politics: 'politics', geopolitics: 'world', world: 'world', economy: 'economy', courts: 'courts',
  tech: 'tech', science: 'science', health: 'health', culture: 'culture', weather: 'weather' };

export function startNewsroom(store, config, { sim = false, getMarkets, getAliases, rebuild } = {}) {
  const F = { retryEveryMin: 2, retryForMin: 30, dupJaccard: 0.5, dupHours: 6, storyFlashCooldownMin: 90,
    sotdEveryMin: 5, sotdMinStories: 3, sotdMinScore: 9, sotdMaxRows: 8, sotdKeepHours: 12, marksMax: 6,
    boostMin: 10, maxFlashes: 10, wireItems: 30, crawlMaxAgeHours: 3, matchTimeoutMs: 30_000, minScore: 11, otherEventRel: 0.8, simFirstSec: 40, simEverySec: 180, ...(wireConfig.flash || {}) };
  const boosts = new Map();          // flash id -> {until, flash, marketIds:Set, eventIds:Set, storyId}
  const stats = { clustersFired: 0, clustersMatched: 0, flashesMade: 0, lastFlashAt: null, lastFlash: null,
    retryQueued: 0, retried: 0, retryDropped: 0, dupesSkipped: 0, sotdPasses: 0, sotdId: null, sotdStories: 0, marks: 0 };
  const pending = [];                // clusters that fired before markets loaded: {cluster, firstAt}
  const recentFired = [];            // {id, tok, at, cluster} for repeat-fire dedupe and the SOTD pass
  const storyFlashAt = new Map();    // storyId -> ms of its last flash
  const marks = new Map();           // storyId -> [{t, title, outlet}] wire headlines matched to the story (replay markers)
  let sotd = null, sotdScore = 0, sotdAt = 0;
  const timers = [];
  let queue = Promise.resolve();
  let wire = null;

  store.feeds.wire = { ok: false, lastOk: null, lastError: null, count: 0 };
  Object.assign(store.feeds.wire, { feedsOk: 0, feedsTotal: 0, lastPoll: null, items: 0, ...statsView() });
  function statsView() { return { clustersFired: stats.clustersFired, clustersMatched: stats.clustersMatched, flashesMade: stats.flashesMade, lastFlashAt: stats.lastFlashAt,
    retryQueued: stats.retryQueued, retryPending: pending.length, retried: stats.retried, retryDropped: stats.retryDropped, dupesSkipped: stats.dupesSkipped,
    sotdId: stats.sotdId, sotdStories: stats.sotdStories, sotdPasses: stats.sotdPasses, marks: stats.marks }; }

  // ---- story lookup: market/event id -> aired story id (board, desks, closing; merged-event aliases)
  function storyIdFor(id) {
    if (!id) return undefined;
    const aliases = getAliases?.() || {};
    if (aliases[id]) return aliases[id];
    const s = store.getState();
    const pools = [s.stories || [], ...(s.desks || []).map((d) => d.stories || []), s.closing || []];
    for (const list of pools) {
      for (const st of list) {
        if (st.id === id || st.lead?.id === id || st.lead?.eventId === id || st.markets?.some((m) => m.id === id || m.eventId === id)) return st.id;
      }
    }
    return undefined;
  }

  // PNN's own observed price at (or just before) the news time, from the store's samples.
  function priceAt(marketId, ms) {
    const arr = store.history(marketId);
    if (!arr?.length) return null;
    const t = ms / 1000;
    let p = null;
    for (const s of arr) { if (s.t <= t) p = s.p; else break; }
    return p;
  }

  async function onBreaking(cluster, { retry = false } = {}) {
    const now0 = Date.now();
    if (!retry) {
      // Repeat fires of the same story (a new cluster id for near-identical headlines) are dropped.
      const tok = tokenSet(cluster.title || '');
      for (let i = recentFired.length - 1; i >= 0; i--) if (recentFired[i].at < now0 - F.dupHours * 3_600_000) recentFired.splice(i, 1);
      const dup = recentFired.find((r) => r.id === cluster.id || jaccard(r.tok, tok) >= F.dupJaccard);
      if (dup) { stats.dupesSkipped++; Object.assign(store.feeds.wire, statsView()); log('info', 'wire repeat skipped', { title: cluster.title, sameAs: dup.cluster?.title }); return; }
      recentFired.push({ id: cluster.id, tok, at: now0, cluster });
      if (recentFired.length > 200) recentFired.splice(0, recentFired.length - 200);
      stats.clustersFired++;
    }
    const markets = getMarkets?.() || [];
    if (!markets.length) {
      // Fired before the first market poll landed: retry every couple of minutes instead of dropping it.
      if (!retry) { pending.push({ cluster, firstAt: now0 }); stats.retryQueued++; Object.assign(store.feeds.wire, statsView()); log('info', 'wire queued: no markets yet', { cluster: cluster.id, title: cluster.title }); }
      return 'nomarkets';
    }
    const t0 = Date.now();
    let matches = [];
    try {
      matches = await Promise.race([
        matchMarkets(cluster, markets, { config, search: !sim, searchWaitMs: 11_000 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('match timeout')), F.matchTimeoutMs).unref?.()),
      ]);
    } catch (e) {
      log('warn', 'flash match failed', { cluster: cluster.id, title: cluster.title, error: errMsg(e) });
      return;
    }
    const ms = Date.now() - t0;
    if (!matches?.length) { log('info', 'wire no market', { title: cluster.title, outlets: cluster.outlets, ms }); return; }
    // On-air bar: a weak best match is noise; rows from other events must be nearly as strong as the lead; a market
    // pinned near 0/100 that barely moved today is dead content (CLAUDE.md: interesting content only).
    const top = matches[0].score;
    const leadEvent = matches[0].market.eventId;
    const dead = (m) => (m.yesPrice < 0.03 || m.yesPrice > 0.97) && Math.abs(m.change1d || 0) < 0.05;
    const kept = matches.filter((r) => (r.market.eventId === leadEvent || r.score >= top * F.otherEventRel) && !dead(r.market));
    if (top < F.minScore || !kept.length) {
      log('info', 'wire weak match', { title: cluster.title, top, rows: matches.slice(0, 3).map((r) => `${r.score} ${r.market.eventTitle} / ${r.market.outcome || ''} ${Math.round(r.market.yesPrice * 100)}%`) });
      return;
    }
    stats.clustersMatched++;
    const flash = buildFlash(cluster, kept, { priceAt, storyId: storyIdFor });
    if (!flash) return;
    // newsMarks: the headline lands on every aired story it matched, even when the flash itself is deduped.
    for (const r of kept) addMark(storyIdFor(r.market.id) || storyIdFor(r.market.eventId), cluster);
    if (flash.storyId && (storyFlashAt.get(flash.storyId) || 0) > Date.now() - F.storyFlashCooldownMin * 60_000) {
      stats.dupesSkipped++;
      Object.assign(store.feeds.wire, statsView());
      log('info', 'flash skipped: story flashed recently', { storyId: flash.storyId, headline: flash.headline });
      return;
    }
    if (flash.storyId) storyFlashAt.set(flash.storyId, Date.now());
    const added = store.addFlash(flash);
    if (!added) return;
    stats.flashesMade++;
    stats.lastFlashAt = flash.at;
    stats.lastFlash = { headline: flash.headline, markets: flash.markets.map((m) => m.line) };
    Object.assign(store.feeds.wire, statsView());
    log('info', 'flash', {
      id: flash.id, headline: flash.headline, credit: flash.credit, storyId: flash.storyId || null, ms,
      markets: flash.markets.map((m) => `${m.source}:${m.id} ${m.line}`),
    });
    boosts.set(flash.id, {
      until: Date.now() + F.boostMin * 60_000, flash, storyId: flash.storyId || null,
      marketIds: new Set(flash.markets.map((m) => m.id)), eventIds: new Set(flash.markets.map((m) => m.eventId).filter(Boolean)),
    });
    try { rebuild?.('flash'); } catch (e) { log('warn', 'flash rebuild failed', { error: errMsg(e) }); }
    refreshSotd(sim ? simSotdClusters : null).catch((e) => log('warn', 'sotd failed', { error: errMsg(e) }));
  }
  const handle = (cluster, opts) => {
    queue = queue.then(() => onBreaking(cluster, opts)).catch((e) => log('error', 'flash failed', { error: errMsg(e), stack: String(e?.stack || '').slice(0, 600) }));
  };
  function retryPending() {
    if (!pending.length) return;
    const now = Date.now();
    const have = (getMarkets?.() || []).length > 0;
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (now - p.firstAt > F.retryForMin * 60_000) { pending.splice(i, 1); stats.retryDropped++; log('info', 'wire retry dropped', { title: p.cluster.title }); continue; }
      if (!have) continue;
      pending.splice(i, 1);
      stats.retried++;
      log('info', 'wire retry', { title: p.cluster.title, waitedSec: Math.round((now - p.firstAt) / 1000) });
      handle(p.cluster, { retry: true });
    }
    Object.assign(store.feeds.wire, statsView());
  }
  const retryIv = setInterval(() => { try { retryPending(); } catch (e) { log('warn', 'wire retry failed', { error: errMsg(e) }); } }, F.retryEveryMin * 60_000);
  retryIv.unref?.();
  timers.push(retryIv);

  // ---- newsMarks (replay markers): wire headlines matched to a story, with times
  function addMark(storyId, cluster) {
    if (!storyId || !cluster?.title) return;
    const t = Math.round((Date.parse(cluster.firstSeen || cluster.firedAt || '') || Date.now()) / 1000);
    const list = (marks.get(storyId) || []).filter((m) => m.t >= Date.now() / 1000 - 86_400 && m.title !== cluster.title);
    list.push({ t, title: cluster.title, outlet: String(cluster.outlets?.[0] || cluster.items?.[0]?.outlet || '').replace(/ via .*$/, '') });
    list.sort((a, b) => a.t - b.t);
    marks.set(storyId, list.slice(-F.marksMax));
    if (marks.size > 300) marks.delete(marks.keys().next().value);
    stats.marks = [...marks.values()].reduce((a, l) => a + l.length, 0);
  }
  function marksFor(story) {
    const list = marks.get(story?.id);
    if (!list?.length) return [];
    const cutoff = Date.now() / 1000 - 86_400;
    return list.filter((m) => m.t >= cutoff);
  }

  // ---- Story of the Day: the biggest recent wire cluster that matches >= 3 board/desk stories ("IN THE NEWS")
  const credit = (outlets) => {
    const o = [...new Set((outlets || []).map((x) => String(x).replace(/ via .*$/, '')).filter(Boolean))];
    if (o.length <= 2) return o.join(' and ');
    return `${o.slice(0, 2).join(', ')} and ${o.length - 2} other${o.length - 2 > 1 ? 's' : ''}`;
  };
  // Deterministic short title: the cluster's consensus words that also appear in the matched markets, in headline order.
  function sotdTitle(cluster, matched) {
    let a;
    try { a = analyzeCluster(cluster); } catch { a = null; }
    const words = String(cluster.title || '').split(/\s+/).map((w) => w.replace(/^[^\w]+|[^\w%]+$/g, '').replace(/['’]s$/i, ''));
    if (!a || !words.length) return 'IN THE NEWS';
    const mcount = new Map();
    for (const m of matched) for (const k of tokenSet(`${m.eventTitle || ''} ${m.title || ''} ${m.outcome || ''}`)) mcount.set(k, (mcount.get(k) || 0) + 1);
    const pos = new Map();
    words.forEach((w, i) => { const k = tokenSetFirst(w); if (k && !pos.has(k)) pos.set(k, i); });
    const ranked = [...pos.keys()].filter((k) => !/^\d+$/.test(k) && k.length > 2 && !GENERIC.has(k))
      .map((k) => ({ k, s: (a.tw.get(k) || 0) * (1 + (mcount.get(k) || 0)) }))
      .filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
    if (!ranked.length) return 'IN THE NEWS';
    const [p1, p2] = [pos.get(ranked[0].k), ranked[1] ? pos.get(ranked[1].k) : null];
    let span = [p1, p1];
    if (p2 != null && Math.abs(p2 - p1) <= 3) span = [Math.min(p1, p2), Math.max(p1, p2)];
    const out = words.slice(span[0], span[1] + 1).filter(Boolean).join(' ').toUpperCase();
    return out || 'IN THE NEWS';
  }
  const tokenSetFirst = (w) => [...tokenSet(w)][0] || null;
  const airingPool = () => {
    const s = store.getState();
    const seen = new Set(), out = [];
    for (const st of [...(s.stories || []), ...(s.desks || []).flatMap((d) => d.stories || [])]) if (st?.id && !seen.has(st.id)) { seen.add(st.id); out.push(st); }
    return out;
  };
  const GENERIC = new Set(['win', 'rise', 'fall', 'begin', 'control', 'flip', 'say', 'new', 'plan', 'make', 'take', 'after', 'first', 'big',
    'top', 'high', 'low', 'back', 'more', 'over', 'amid', 'key', 'race', 'vote', 'result', 'day', 'week', 'year', 'news', 'report', 'live', 'update',
    'what', 'how', 'why', 'who', 'says', 'set', 'get', 'could', 'would', 'still', 'next', 'end', 'state', 'us', 'america', 'american']);
  const EXPAND = {
    congress: ['house', 'senate', 'midterm', 'congress'], midterm: ['house', 'senate', 'congress', 'midterm'], senate: ['senate', 'midterm'], house: ['house', 'midterm'],
    democrat: ['democrat', 'democratic', 'dem'], democratic: ['democrat', 'democratic'], republican: ['republican', 'gop'], gop: ['republican', 'gop'],
    fed: ['fed', 'fomc', 'powell', 'rate'], powell: ['fed', 'powell'], inflation: ['inflation', 'cpi'], cpi: ['inflation', 'cpi'],
    jobs: ['jobs', 'payroll', 'unemployment'], tariff: ['tariff', 'trade'], ai: ['ai', 'openai', 'anthropic'],
  };
  function looseStories(cluster, pool) {
    let a;
    try { a = analyzeCluster(cluster); } catch { return []; }
    const keys = [...a.tw.entries()].filter(([k, w]) => w >= 0.34 && k.length > 2 && !GENERIC.has(k) && !/^\d+$/.test(k)).map(([k]) => k);
    if (keys.length < 2) return [];
    const out = [];
    for (const st of pool) {
      const tok = tokenSet([st.eventTitle, st.lead?.title, ...(st.markets || []).map((m) => m.outcome || '')].filter(Boolean).join(' '));
      const hits = keys.filter((k) => (EXPAND[k] || [k]).some((x) => tok.has(x))).length;
      if (hits >= 2) out.push(st);
    }
    // A cluster that touches a large share of the whole board is generic, not a topic.
    return out.length > Math.max(12, pool.length * 0.3) ? [] : out;
  }
  const deadRow = (m) => !m || ((m.yesPrice < 0.03 || m.yesPrice > 0.97) && Math.abs(m.change1d || 0) < 0.03);
  let sotdRunning = false;
  async function refreshSotd(simClusters = null) {
    if (sotdRunning) return;
    sotdRunning = true;
    try {
      stats.sotdPasses++;
      const now = Date.now();
      const pool = airingPool();
      const byMarket = new Map();
      for (const st of pool) for (const m of [st.lead, ...(st.markets || [])]) if (m?.id && !byMarket.has(m.id)) byMarket.set(m.id, { st, m });
      const poolMarkets = [...byMarket.values()].map((x) => x.m);
      if (!poolMarkets.length) return;
      const live = wire ? wire.clusters({ limit: 15, minOutlets: 2 }) : [];
      const fired = recentFired.filter((r) => r.at >= now - F.sotdKeepHours * 3_600_000).map((r) => r.cluster);
      const seen = new Set();
      const cands = [...(simClusters || []), ...live, ...fired].filter((c) => c?.id && !seen.has(c.id) && seen.add(c.id));
      let best = null;
      for (const c of cands) {
        let rows = [];
        try { rows = await matchMarkets(c, poolMarkets, { config, search: false, limit: 20, perEvent: 1, now }); } catch { rows = []; }
        if (!rows.length || rows[0].score < F.minScore) rows = [];
        const stories = new Map();
        for (const r of rows) {
          if (r.score < F.sotdMinScore) continue;
          const hit = byMarket.get(r.market.id);
          if (!hit) continue;
          addMark(hit.st.id, c);
          if (!stories.has(hit.st.id)) stories.set(hit.st.id, { st: hit.st, m: hit.m });
        }
        // The flash matcher is strict (one best market); a Story of the Day is a topic: also take every aired story
        // that shares >= 2 of the cluster's (expanded) key words.
        for (const st of looseStories(c, pool)) if (!stories.has(st.id)) { addMark(st.id, c); stories.set(st.id, { st, m: st.lead }); }
        for (const [id, x] of stories) if (deadRow(x.m)) stories.delete(id);
        if (stories.size < F.sotdMinStories) continue;
        const outlets = c.outlets?.length || c.independentOutlets || 1;
        const score = stories.size * 10 + outlets;
        if (!best || score > best.score) best = { c, stories: [...stories.values()], score };
      }
      if (best) {
        const switchOk = !sotd || sotd.id === `sotd:${best.c.id}` || best.score >= sotdScore || now - sotdAt > 3 * 3_600_000;
        if (switchOk) {
          const rows = best.stories.sort((x, y) => Math.abs(y.m.change1d || 0) - Math.abs(x.m.change1d || 0)).slice(0, F.sotdMaxRows);
          const isNew = !sotd || sotd.id !== `sotd:${best.c.id}`;
          sotd = {
            id: `sotd:${best.c.id}`, title: sotdTitle(best.c, rows.map((r) => r.m)), credit: credit(best.c.outlets),
            headline: best.c.title, url: best.c.url || null, newsAt: best.c.firstSeen || null, leadStoryId: (rows.find((r) => !isMarginBracket(r.st)) || rows[0]).st.id,
            count: best.stories.length,
            markets: rows.map(({ st, m }) => ({ storyId: st.id, label: st.short || st.eventTitle || m.eventTitle || m.title, outcome: m.outcome || null,
              yesPrice: m.yesPrice, change1d: m.change1d ?? null, source: m.source, marketId: m.id })),
            updatedAt: new Date(now).toISOString(),
          };
          if (isNew) { sotdAt = now; log('info', 'story of the day', { id: sotd.id, title: sotd.title, headline: sotd.headline, stories: sotd.count, credit: sotd.credit }); }
          sotdScore = best.score;
        }
      } else if (sotd && now - sotdAt > F.sotdKeepHours * 3_600_000) {
        sotd = null; sotdScore = 0;
      } else if (sotd) {
        // keep the card, refresh its rows' live prices from the board
        const byStory = new Map(pool.map((st) => [st.id, st]));
        sotd = { ...sotd, markets: sotd.markets.map((r) => { const st = byStory.get(r.storyId); const m = st && [st.lead, ...(st.markets || [])].find((x) => x?.id === r.marketId); return m ? { ...r, yesPrice: m.yesPrice, change1d: m.change1d ?? null } : r; }) };
      }
      stats.sotdId = sotd?.id || null;
      stats.sotdStories = sotd?.count || 0;
      Object.assign(store.feeds.wire, statsView());
      store.setState({ sotd });
    } finally {
      sotdRunning = false;
    }
  }

  // ---- boosts ("worked in")
  const flashNews = (f) => ({ title: f.headline, source: f.credit || f.outlets?.[0] || 'News', url: f.url, publishedAt: f.newsAt, flash: true });
  function activeBoosts() {
    const now = Date.now();
    for (const [k, b] of boosts) if (b.until < now) boosts.delete(k);
    return [...boosts.values()].sort((a, b) => b.until - a.until); // newest first
  }
  function matchesBoost(st, b) {
    if (b.storyId && st.id === b.storyId) return true;
    if (b.eventIds.has(st.id)) return true;
    return !!st.markets?.some((m) => b.marketIds.has(m.id) || b.eventIds.has(m.eventId)) || (st.lead && b.marketIds.has(st.lead.id));
  }
  // A flash market whose event isn't on the board or a desk: a minimal one-event story from the fresh markets.
  function adhocStory(b, byId, allMarkets) {
    const lead0 = b.flash.markets[0];
    const lead = byId.get(lead0.id);
    if (!lead) return null;
    const siblings = allMarkets.filter((m) => m.eventId === lead.eventId).sort((a, c) => c.yesPrice - a.yesPrice).slice(0, 5);
    const markets = siblings.length ? siblings : [lead];
    if (!markets.includes(lead)) markets[markets.length - 1] = lead;
    return {
      id: b.storyId || lead.eventId, eventTitle: lead.eventTitle || lead.title, category: lead.category,
      sources: [...new Set(markets.map((m) => m.source))], lead, markets, score: 0, kind: 'news',
      headline: marketDataLine(lead), dek: `In the news: ${b.flash.credit || 'the wire'} reported it`,
      thin: !!lead0.thin, history: null, news: [],
      visual: { type: markets.length > 2 ? 'outcomes' : 'dial', region: null, theme: THEME[lead.category] || 'world' },
    };
  }
  function applyBoosts(stories, allMarkets = [], extraPools = []) {
    const list = activeBoosts();
    if (!list.length || !Array.isArray(stories)) return stories;
    const n = stories.length;
    let rest = stories.slice();
    const front = [];
    let byId = null;
    for (const b of list) {
      if (front.some((s) => matchesBoost(s, b))) continue;
      let st = null;
      const i = rest.findIndex((s) => matchesBoost(s, b));
      if (i >= 0) st = rest.splice(i, 1)[0];
      else {
        for (const pool of extraPools) { st = (pool || []).find((s) => matchesBoost(s, b)) || null; if (st) break; }
        if (!st) { byId ||= new Map(allMarkets.map((m) => [m.id, m])); st = adhocStory(b, byId, allMarkets); }
      }
      if (!st) continue;
      const f = b.flash;
      front.push({ ...st, tags: [...new Set([...(st.tags || []), 'news'])], flash: { id: f.id, headline: f.headline, credit: f.credit, newsAt: f.newsAt, url: f.url } });
    }
    if (!front.length) return stories;
    rest = rest.filter((s) => !front.some((f) => f.id === s.id));
    return [...front, ...rest].slice(0, Math.max(n, front.length));
  }
  function newsFor(story, list) {
    if (!story?.flash) return list;
    const top = flashNews({ ...story.flash, newsAt: story.flash.newsAt });
    return [top, ...(list || []).filter((x) => x.title !== top.title)].slice(0, 2);
  }

  // ---- state.wire (headline crawl) + feeds.wire (health)
  let lastWireKey = '';
  function crawlItems(items) {
    const cutoff = Date.now() - F.crawlMaxAgeHours * 3_600_000;
    const seen = new Set();
    const out = [];
    for (const it of items) {
      if (Date.parse(it.publishedAt) < cutoff) continue;
      const k = String(it.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ title: it.title, outlet: String(it.outlet || '').replace(/ via .*$/, ''), publishedAt: it.publishedAt, category: it.category, url: it.url });
      if (out.length >= F.wireItems) break;
    }
    return out;
  }
  function publishWire(items) {
    const list = crawlItems(items);
    const key = list.map((x) => x.title).join('|');
    if (key === lastWireKey) return;
    lastWireKey = key;
    store.setState({ wire: list });
  }
  function refreshHealth() {
    if (!wire) return;
    const st = wire.status();
    const ok = st.filter((s) => s.ok).length;
    const lastOk = st.map((s) => s.lastOk).filter(Boolean).sort().pop() || null;
    const errs = st.filter((s) => !s.ok && s.lastError);
    Object.assign(store.feeds.wire, {
      ok: ok > 0 && ok >= st.length / 2, lastOk, lastPoll: lastOk, feedsOk: ok, feedsTotal: st.length,
      lastError: ok >= st.length / 2 ? null : (errs[0] ? `${errs[0].id}: ${errs[0].lastError}` : 'no feed ok yet'),
      items: wire.items({ limit: 5000 }).length, count: ok, ...statsView(),
    });
  }

  let simSotdClusters = null;
  const sotdIv = setInterval(() => { refreshSotd(sim ? simSotdClusters : null).catch((e) => log('warn', 'sotd failed', { error: errMsg(e) })); }, F.sotdEveryMin * 60_000);
  sotdIv.unref?.();
  timers.push(sotdIv);
  const sotdFirst = setTimeout(() => { refreshSotd(sim ? simSotdClusters : null).catch((e) => log('warn', 'sotd failed', { error: errMsg(e) })); }, sim ? 20_000 : 90_000);
  sotdFirst.unref?.();
  timers.push(sotdFirst);

  if (sim) startSimWire();
  else {
    wire = createWire();
    wire.on('breaking', handle);
    let pend = 0;
    wire.on('items', () => {
      if (pend) return;
      pend = setTimeout(() => { pend = 0; try { publishWire(wire.items({ limit: 120 })); refreshHealth(); } catch (e) { log('warn', 'wire state failed', { error: errMsg(e) }); } }, 3000);
      pend.unref?.();
    });
    wire.start();
    const iv = setInterval(() => { try { refreshHealth(); publishWire(wire.items({ limit: 120 })); } catch (e) { log('warn', 'wire health failed', { error: errMsg(e) }); } }, 30_000);
    iv.unref?.();
    timers.push(iv);
  }

  // ---- SIM: canned wire, no network
  function startSimWire() {
    const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
    const canned = [
      ['Reuters', 'Fed officials signal a December rate hike remains on the table', 'economy', 3],
      ['CNBC', 'Powell says the Fed is watching inflation data closely ahead of December', 'economy', 6],
      ['AP', 'Mississippi Senate race remains too close to call as counting continues', 'politics', 9],
      ['BBC', 'Los Angeles mayoral race heads toward a runoff, early returns show', 'politics', 14],
      ['The Hill', 'California billionaire tax measure trails in early returns', 'politics', 18],
      ['Bloomberg', 'Treasury yields climb after strong services data', 'economy', 25],
      ['NPR', 'Alaska Senate count could take days, officials say', 'politics', 31],
      ['TechCrunch', 'Anthropic weighs funding round at a higher valuation', 'tech', 44],
    ];
    const items = () => canned.map(([outlet, title, category, min]) => ({ title, outlet, category, publishedAt: ago(min), url: 'https://example.invalid/sim' }));
    store.setState({ wire: crawlItems(items()) });
    Object.assign(store.feeds.wire, { ok: true, lastOk: new Date().toISOString(), lastPoll: new Date().toISOString(), lastError: 'SIM: canned wire', feedsOk: 1, feedsTotal: 1, items: canned.length, count: 1 });
    const clusters = [
      { title: 'Fed officials signal a December rate hike remains on the table', outlets: ['Reuters', 'CNBC'], category: 'economy' },
      { title: 'Mississippi Senate race remains too close to call as counting continues', outlets: ['AP', 'NBC News'], category: 'politics' },
    ];
    // SIM Story of the Day: a canned multi-outlet midterms cluster (never flashed; only the SOTD pass reads it).
    const sotdTitles = [
      ['AP', 'Senate election results: Mississippi and Alaska races tighten as midterm counting continues'],
      ['Reuters', 'Midterm election results: Senate balance of power hinges on Mississippi, Alaska and Kansas'],
      ['BBC', 'US midterm elections: Senate control still in play as Republicans and Democrats split key races'],
    ];
    simSotdClusters = [{ id: 'wc:simsotd', title: sotdTitles[0][1], url: 'https://example.invalid/sim', outlets: sotdTitles.map((x) => x[0]),
      items: sotdTitles.map(([outlet, title]) => ({ title, outlet, publishedAt: ago(20) })), firstSeen: ago(20), lastSeen: ago(5),
      official: false, marker: false, reason: 'corroborated', independentOutlets: 3, category: 'politics' }];
    let n = 0;
    const fire = () => {
      const c = clusters[n % clusters.length];
      const id = `wc:sim${n++}-${Date.now().toString(36)}`;
      const now = new Date().toISOString();
      handle({ id, ...c, url: 'https://example.invalid/sim', items: c.outlets.map((o) => ({ title: c.title, outlet: o, publishedAt: now })), firstSeen: ago(4), lastSeen: now, official: false, marker: false, reason: 'corroborated', independentOutlets: c.outlets.length });
      store.setState({ wire: crawlItems(items()) });
      Object.assign(store.feeds.wire, { lastOk: now, lastPoll: now });
    };
    const t = setTimeout(() => {
      fire();
      const iv = setInterval(fire, F.simEverySec * 1000);
      iv.unref?.();
      timers.push(iv);
    }, F.simFirstSec * 1000);
    t.unref?.();
    timers.push(t);
  }

  return {
    applyBoosts,
    newsFor,
    marksFor,
    refreshSotd: (clusters) => refreshSotd(clusters ?? (sim ? simSotdClusters : null)),
    stats: () => ({ ...stats, boosts: activeBoosts().length }),
    wire: () => wire,
    stop() { wire?.stop(); timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); },
  };
}
