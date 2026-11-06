#!/usr/bin/env node
// News-unlock scout tool (2026-11-05): which new feeds would let news-gated stories air? Dev tool; never touches the server.
//   node scripts/news-unlock.mjs --baseline [--dir DIR] [--refresh-index]
//     Rebuilds the board the way ingest.mjs does (Polymarket main+deep+tag sweep, Kalshi, classify, buildStories with the
//     real newsdesk over data/news-archive.json + data/news-search.json) and writes DIR/gated.json: the airable stories
//     dropped for having no matching news (rank.mjs 'news:none'). The market index is cached in DIR/index.json (6h).
//   node scripts/news-unlock.mjs --feeds feeds.json [--dir DIR] [--refresh]
//     feeds.json = [{name, url, category?}]. Fetches each feed once (raw cached in DIR/cache, reused for 6h unless
//     --refresh), parses and filters it like the wire (parseFeedXml, normalizeItems + wire filters, newsroom badItem),
//     then runs matchStoryNews (newsdesk wire options: 72h, max 24) over gated.json and drops headlines rank.mjs blocks.
//     Prints JSON: {feeds:[{name,url,ok,error?,items,kept,newestAgeH,unlocked:[{storyId,short,tier,score,headline,ageH}]}],
//     totalUnlocked, byCategory}.
// DIR (--dir or --out) defaults to $PNN_UNLOCK_DIR or data/unlock (gitignored). The tool writes nothing else.
// Google News / Bing News search URLs are treated as aggregators (title ' - Outlet' split off), as the wire does.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import config from '../server/config.mjs';
import wireCfg from '../server/wire-config.mjs';
import { classify } from '../server/editorial/filter.mjs';
import { buildStories, headlineBlocked } from '../server/editorial/rank.mjs';
import { matchStoryNews, buildHeadlineIndex, headlineReject } from '../server/editorial/match.mjs';
import { createNewsdesk, NEWS_GATED } from '../server/newsdesk.mjs';
import { parseFeedXml, normalizeItems, compileFilters } from '../server/sources/wire.mjs';
import { badNewsSource, looksCut, nonLatin, learnWords } from '../server/sources/news.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const DIR = path.resolve(opt('--dir', opt('--out', process.env.PNN_UNLOCK_DIR || path.join(ROOT, 'data', 'unlock'))));
const CACHE = path.join(DIR, 'cache');
fs.mkdirSync(CACHE, { recursive: true });
const H = 3_600_000;
const UA = 'PNN/0.1 (local news display)';
const now = Date.now();
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const fresh = (f, ms) => fs.existsSync(f) && now - fs.statSync(f).mtimeMs < ms;
const err = (...a) => console.error(...a);

// the same headline gate the newsroom applies before a wire item enters the archive (newsroom.mjs badItem)
const badItem = (it) => !it || !it.title || !!badNewsSource(it) || !!headlineReject(it) || looksCut(it.title) || nonLatin(it.title) || nonLatin(it.outlet);
const archive = () => {
  const raw = readJson(path.join(ROOT, 'data', 'news-archive.json'));
  learnWords(raw.map((x) => x?.title));   // looksCut vocabulary, as newsroom.archiveAdd does
  return raw.filter((it) => Date.parse(it.publishedAt) >= now - 72 * H && !badItem(it));
};

async function marketIndex() {
  const f = path.join(DIR, 'index.json');
  if (!flag('--refresh-index') && fresh(f, 6 * H)) return readJson(f);
  const pm = await import('../server/sources/polymarket.mjs');
  const { fetchKalshi } = await import('../server/sources/kalshi.mjs');
  const S = config.sources?.polymarket || {};
  err('fetching Polymarket (main + deep + tag sweep) and Kalshi ...');
  await pm.fetchPolymarket();
  try { await pm.sweepPolymarketTags({ tags: S.tagSlugs || [], limit: S.tagLimit ?? 50, paceMs: S.tagPaceMs ?? 350 }); } catch (e) { err('tag sweep failed', e.message); }
  const markets = [...pm.mergedPolymarket(), ...await fetchKalshi().catch((e) => (err('kalshi failed', e.message), []))];
  fs.writeFileSync(f, JSON.stringify(markets));
  return markets;
}
const airableOf = (markets) => markets.filter((m) => { try { return classify(m, config, { now: new Date(now) }).keep; } catch { return false; } });
const slimM = (m) => m && ({ id: m.id, eventId: m.eventId, title: m.title, eventTitle: m.eventTitle, outcome: m.outcome, category: m.category, source: m.source, yesPrice: m.yesPrice, volume24h: m.volume24h, tags: m.tags, closesAt: m.closesAt });

async function baseline() {
  const markets = await marketIndex();
  const airable = airableOf(markets);
  const arch = archive();
  const nd = createNewsdesk({ getArchive: () => arch, getMarkets: () => airable });
  try { nd.load(readJson(path.join(ROOT, 'data', 'news-search.json'))); } catch { /* none */ }
  const looked = new Map();
  const newsLookup = (s) => { looked.set(s.id, s); return nd.lookup(s, now); };
  const out = buildStories(markets, config, { now: new Date(now), enrich: { newsLookup, hasNews: () => false, historyLen: () => 0 } });
  // rank.newsGate: a looked-up non sports/games story with no newsTier was dropped as 'news:none'
  const gated = [...looked.values()].filter((s) => !NEWS_GATED.has(s.category) && !s.newsTier).map((s) => ({
    id: s.id, category: s.category, short: s.lead?.title || s.eventTitle, outcome: s.lead?.outcome || null, eventTitle: s.eventTitle,
    volume: Math.round(s._evVol ?? s.lead?.volume24h ?? 0), yesPrice: s.lead?.yesPrice ?? null, source: s.lead?.source,
    _story: { id: s.id, category: s.category, eventTitle: s.eventTitle, ladder: s.ladder, lead: slimM(s.lead), markets: (s.markets || []).map(slimM) },
  })).sort((a, b) => b.volume - a.volume);
  fs.writeFileSync(path.join(DIR, 'gated.json'), JSON.stringify(gated));
  const cats = {};
  for (const g of gated) cats[g.category] = (cats[g.category] || 0) + 1;
  const SCI = /^(science|ai|tech|technology|space|health|climate|weather)$/;
  console.log(`markets ${markets.length}, airable ${airable.length}, archive ${arch.length}, stories looked up ${looked.size}, aired ${out.stories?.length}`);
  console.log(`news:none (rank.mjs) ${out.stats?.dropped?.['news:none'] || 0}; gated.json ${gated.length} -> ${path.join(DIR, 'gated.json')}`);
  console.log('by category:', Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
  console.log(`science/AI/tech/space/health/climate: ${gated.filter((g) => SCI.test(g.category)).length}`);
}

async function fetchCached(url, refresh) {
  const f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.txt');
  if (!refresh && fresh(f, 6 * H)) return { body: fs.readFileSync(f, 'utf8'), cached: true };
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  fs.writeFileSync(f, body);
  return { body, cached: false };
}

async function scoutFeeds(file) {
  const feeds = readJson(file);
  const gf = path.join(DIR, 'gated.json');
  if (!fs.existsSync(gf)) throw new Error(`${gf} missing: run --baseline first`);
  const gated = readJson(gf);
  const airable = airableOf(await marketIndex());
  archive();   // learn the archive vocabulary so looksCut judges new headlines as the server would
  const filters = compileFilters(wireCfg);
  const unlockedAll = new Map();
  const results = [];
  for (const [i, fd] of feeds.entries()) {
    const r = { name: fd.name, url: fd.url, ok: false, items: 0, kept: 0, newestAgeH: null, unlocked: [] };
    results.push(r);
    try {
      const { body } = await fetchCached(fd.url, flag('--refresh'));
      const raw = parseFeedXml(body);
      r.items = raw.length;
      const aggregator = fd.aggregator ?? /news\.google\.com|bing\.com\/news/.test(fd.url);
      const feed = { id: `scout${i}`, outlet: aggregator ? 'Google News' : fd.name, url: fd.url, category: fd.category || 'general', skipFilters: fd.skipFilters, aggregator };
      const stats = { undated: 0, old: 0, filtered: {} };
      const items = normalizeItems(feed, raw, wireCfg, filters, now, stats).filter((it) => !badItem(it))
        .map((it) => ({ title: it.title, outlet: it.outlet, url: it.url, publishedAt: it.publishedAt, category: it.category, source: it.source, aggregator: it.aggregator }));
      r.ok = true;
      r.kept = items.length;
      r.dropped = { undated: stats.undated, old: stats.old, ...stats.filtered, quality: normalizeItems(feed, raw, wireCfg, filters, now).length - items.length };
      const newest = Math.max(...raw.map((x) => x.ts || 0));
      r.newestAgeH = newest > 0 ? Math.round((now - newest) / H * 10) / 10 : null;
      if (!items.length) continue;
      const idx = buildHeadlineIndex(items);
      for (const g of gated) {
        let hits = [];
        try { hits = matchStoryNews(g._story, idx, airable, { now, max: 3, entity: false, maxAgeMs: 72 * H }); } catch { hits = []; }
        hits = hits.filter((h) => !looksCut(h.item.title) && !headlineBlocked(h.item.title, config));
        if (!hits.length) continue;
        const h = hits[0];
        const u = { storyId: g.id, category: g.category, short: g.outcome && !String(g.short).includes(g.outcome) ? `${g.short} / ${g.outcome}` : g.short, volume: g.volume,
          tier: h.tier || 'exact', score: Math.round(h.score * 10) / 10, headline: h.item.title, ageH: Math.round((now - Date.parse(h.item.publishedAt)) / H * 10) / 10 };
        r.unlocked.push(u);
        if (!unlockedAll.has(g.id)) unlockedAll.set(g.id, u);
      }
    } catch (e) { r.error = String(e?.message || e).slice(0, 200); }
  }
  const byCategory = {};
  for (const u of unlockedAll.values()) byCategory[u.category] = (byCategory[u.category] || 0) + 1;
  console.log(JSON.stringify({ gated: gated.length, feeds: results, totalUnlocked: unlockedAll.size, byCategory }, null, 1));
}

if (flag('--baseline')) await baseline();
else if (flag('--feeds')) await scoutFeeds(path.resolve(opt('--feeds')));
else { err('usage: node scripts/news-unlock.mjs --baseline | --feeds feeds.json  [--dir|--out DIR] [--refresh] [--refresh-index]'); process.exitCode = 2; }
process.exit(process.exitCode || 0);
