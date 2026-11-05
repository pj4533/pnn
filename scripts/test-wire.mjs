#!/usr/bin/env node
// Live check of the news wire + news-to-market matcher.
//   node scripts/test-wire.mjs [--top N] [--no-search] [--kalshi] [--no-probes] [--probe-search]
// 1. one live poll of every wire feed (ok / items kept / newest age / conditional GET support)
// 2. clustering + breaking detection on the result
// 3. matchMarkets for the top N clusters against a live Polymarket index (fetchPolymarket, read-only) plus live
//    search, and the flash each would produce
// 4. probe headlines (synthetic, known answers) to catch false positives
// Never touches the PNN server or port 4180. Logs go to logs/ (LOG_DIR to override).
import { createWire } from '../server/sources/wire.mjs';
import { matchMarkets } from '../server/editorial/match.mjs';
import { buildFlash } from '../server/editorial/flash.mjs';
import { fetchPolymarket } from '../server/sources/polymarket.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const topN = Number(args[args.indexOf('--top') + 1]) || 10;
const search = !flag('--no-search');
const probeSearch = search && flag('--probe-search');   // probes use the local index only unless asked

const pad = (s, n) => String(s ?? '').padEnd(n);

// --stories [--state URL] [--index-cache FILE]: story -> news relevance audit (2026-11-05). Reads the aired stories from a
// PNN server (read-only GET of /api/state, default http://localhost:4180), fetches a live market index (Polymarket +
// Kalshi, or a cached copy), and re-runs matchStoryNews over data/news-archive.json (wire, 48h) and the saved Google
// News results in data/news-search.json (7d), printing each story's best headline with its age and why it matched.
if (flag('--stories')) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { matchStoryNews, buildHeadlineIndex } = await import('../server/editorial/match.mjs');
  const { classify } = await import('../server/editorial/filter.mjs');
  const config = (await import('../server/config.mjs')).default;
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const stateUrl = args.includes('--state') ? args[args.indexOf('--state') + 1] : 'http://localhost:4180/api/state';
  const cacheFile = args.includes('--index-cache') ? args[args.indexOf('--index-cache') + 1] : null;
  const st = await (await fetch(stateUrl)).json();
  let index = null;
  if (cacheFile && fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < 3 * 3_600_000) index = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  if (!index) {
    const { fetchKalshi } = await import('../server/sources/kalshi.mjs');
    index = [...await fetchPolymarket(), ...await fetchKalshi().catch(() => [])];
    if (cacheFile) fs.writeFileSync(cacheFile, JSON.stringify(index));
  }
  const now = Date.now();
  index = index.filter((m) => { try { return classify(m, config, { now }).keep; } catch { return false; } });
  const archive = JSON.parse(fs.readFileSync(path.join(root, 'data', 'news-archive.json'), 'utf8'));
  const search = new Map(JSON.parse(fs.readFileSync(path.join(root, 'data', 'news-search.json'), 'utf8')));
  const seen = new Set();
  const stories = [...(st.stories || []), ...(st.desks || []).flatMap((d) => d.stories || [])].filter((s) => !seen.has(s.id) && seen.add(s.id));
  const H = 3_600_000;
  let withNews = 0;
  console.log(`=== STORY -> NEWS (${stories.length} stories, ${index.length} airable markets, archive ${archive.length}, searched ${search.size})`);
  for (const s of stories) {
    const gated = ['sports', 'games', 'esports'].includes(s.category);
    const wireHits = matchStoryNews(s, buildHeadlineIndex(archive), index, { now, max: 3, entity: gated, maxAgeMs: 48 * H });
    const sr = (search.get(s.id)?.items || []).map((x) => ({ ...x, outlet: x.outlet || x.source }));
    const srHits = gated || !sr.length ? [] : matchStoryNews(s, buildHeadlineIndex(sr), index, { now, max: 3, maxAgeMs: 7 * 24 * H });
    const best = [...wireHits.map((r) => ({ ...r, via: 'wire' })), ...srHits.map((r) => ({ ...r, via: 'search' }))]
      .sort((a, b) => (now - Date.parse(a.item.publishedAt)) / H + (a.via === 'wire' ? 0 : 3) - (now - Date.parse(b.item.publishedAt)) / H - (b.via === 'wire' ? 0 : 3))[0];
    const was = s.news?.[0]?.title;
    if (best) withNews++;
    console.log(`\n[${s.category}] ${s.headline}`);
    console.log(best ? `   -> ${best.via} ${best.item.outlet || best.item.source}: ${best.item.title} (${Math.round((now - Date.parse(best.item.publishedAt)) / H)}h, score ${best.score}${process.env.PNN_MATCH_DEBUG ? `, ${best.why}` : ''})` : '   -> (no news: would not air)');
    if (was && was !== best?.item.title) console.log(`   (live server had: ${was})`);
  }
  console.log(`\n${withNews}/${stories.length} stories keep a news item`);
  process.exit(0);
}

const wire = createWire();
const t0 = Date.now();
const status = await wire.pollAll();
console.log(`\n=== FEEDS (${Date.now() - t0}ms)`);
let ok = 0;
for (const s of status) {
  if (s.ok && s.items > 0) ok++;
  const f = s.stats?.filtered ? Object.entries(s.stats.filtered).map(([k, v]) => `${k}:${v}`).join(' ') : '';
  console.log(`${s.ok ? 'ok ' : 'ERR'} ${pad(s.id, 20)} ${pad(s.status, 4)} kept ${String(s.items).padStart(3)}  newest ${s.newestAgeMin == null ? '-' : s.newestAgeMin + 'm'}`.padEnd(62) +
    `${s.conditional ? 'cond ' : '     '}${s.lastError || ''} ${f ? `[dropped ${f}]` : ''}`);
}
console.log(`${ok}/${status.length} feeds returned fresh items; ring holds ${wire.items({ limit: 5000 }).length} items`);

// Sports and gaming feeds (2026-11-05): they bypass the blanket 'sports' filter, so show what they contributed.
{
  const cats = {};
  for (const i of wire.items({ limit: 5000 })) cats[i.category] = (cats[i.category] || 0) + 1;
  console.log(`items by category: ${Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  for (const c of ['sports', 'games']) {
    const feedsOk = status.filter((x) => x.ok && x.items > 0 && wire.items({ limit: 5000, category: c }).some((i) => i.source === x.id)).length;
    console.log(` ${c}: ${wire.items({ limit: 5000, category: c }).length} headlines from ${feedsOk} feeds, e.g. ${wire.items({ limit: 2, category: c }).map((i) => `"${i.title.slice(0, 60)}"`).join(', ')}`);
  }
}

const fired = wire.detect();
console.log(`\n=== BREAKING (fired now: ${fired.length})`);
for (const c of fired) console.log(` * [${c.reason}] ${c.title}  (${c.outlets.join(', ')})`);

const clusters = wire.clusters({ limit: topN, minOutlets: 2 });
console.log(`\n=== TOP ${clusters.length} CLUSTERS`);
for (const c of clusters) console.log(` - [${c.independentOutlets} indep${c.reason ? `, ${c.reason}` : ''}] ${c.title}  (${c.outlets.join(', ')})`);

let index = [];
try {
  index = await fetchPolymarket();
} catch (e) { console.log('polymarket fetch failed', e.message); }
if (flag('--kalshi')) {
  try { const { fetchKalshi } = await import('../server/sources/kalshi.mjs'); index = index.concat(await fetchKalshi()); } catch (e) { console.log('kalshi fetch failed', e.message); }
}
console.log(`\n=== MATCHING against ${index.length} markets (${new Set(index.map((m) => m.eventId)).size} events), live search ${search ? 'on' : 'off'}`);

async function show(c, label, useSearch = search) {
  const res = await matchMarkets(c, index, { search: useSearch, searchWaitMs: 11_000, debug: true });
  console.log(`\n${label} ${c.title}  (${(c.outlets || []).join(', ')})`);
  if (res.queries?.length) console.log(`   search: ${res.queries.map((q) => `"${q}"`).join(', ')}`);
  if (!res.length) { console.log('   (no market match)'); return; }
  for (const r of res) {
    const m = r.market;
    console.log(`   ${String(r.score).padStart(5)}  ${m.source === 'kalshi' ? 'KS' : 'PM'} ${r.origin === 'search' ? 's' : ' '} ${Math.round(m.yesPrice * 100)}%  ${m.eventTitle}${m.outcome ? ` / ${m.outcome}` : ''}   [${r.why}]`);
  }
  const f = buildFlash(c, res);
  if (f) console.log(`   FLASH: "${f.headline}" — ${f.credit}\n          ${f.markets.map((m) => m.line).join('  |  ')}`);
}

for (const c of clusters) await show(c, '>>');

if (!flag('--no-probes')) {
  console.log('\n=== PROBES (synthetic headlines; first group should match, second should NOT)');
  const probe = (title, outlets = ['Probe']) => ({ id: `probe:${title}`, title, outlets, items: [{ title, outlet: outlets[0] }], firstSeen: new Date().toISOString() });
  for (const t of [
    'Fed holds rates steady but signals a December hike is possible',
    'Powell says inflation remains elevated as Fed weighs next move',
    'Bank of Mexico cuts interest rate by a quarter point',
    'OpenAI unveils GPT-6 in surprise launch',
    'Supreme Court agrees to hear challenge to Trump tariffs',
    'Putin says he has no plans to step down',
    'Hurricane Melissa strengthens to Category 4 in the Caribbean',
    'Mississippi River levels fall to record lows near Baton Rouge',
    'Fed’s Powell says a December rate cut is not a foregone conclusion',
  ]) await show(probe(t), 'P+', probeSearch);
  for (const t of [
    'Texas floods force evacuations near Austin',
    'Apple unveils new iPad lineup',
    'Kansas City chiefs of police meet for annual conference',
    'Starmer visits Paris for talks with Macron on trade',
    'Federation of unions calls for strike over pay',
    'New York restaurant week returns with record bookings',
  ]) await show(probe(t), 'P-', probeSearch);
}

// ---- independence + quality rules (offline, deterministic; 2026-11-05 news-quality pass)
{
  const { badNewsSource, looksCut, learnWords, garbledTitle } = await import('../server/sources/news.mjs');
  const { matchStoryNews, buildHeadlineIndex, scopeMismatch, geoMiss } = await import('../server/editorial/match.mjs');
  let fails = 0;
  const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); };
  console.log('\n=== INDEPENDENCE + QUALITY (offline)');
  for (const [o, t] of [['Kalshi News', "Hegseth's cabinet exit odds hit 57% after midterms"], ['Polymarket', 'Fed hike odds'], ['Robinhood', 'Mortgage rate this week Prediction Market'],
    ['DraftKings Network', 'NFL picks'], ['Facebook', "'Godzilla Minus Zero' with a $60M opening"], ['NewzTodays', 'Russian diesel imports blocked by New Jersey'], ['Patch', 'Fairfield Gas Prices Run A Little Above State Average'],
    ['Yahoo Finance', 'Kalshi traders bet on the next Fed chair'], ['Reuters', 'russian diesel imports blocked by new jersey despite trump']]) {
    check(!!badNewsSource({ title: t, outlet: o }), `blocked: ${o} / ${t.slice(0, 50)}`);
  }
  for (const [o, t] of [['Reuters', 'Fed holds rates steady and signals a December hike is possible'], ['Gold Derby', 'Best Actor Oscar odds: John Malkovich leads'], ['The Verge', 'iPhone 18 launch date leaks'], ['CNBC', 'Gold climbs above $4,000 after Democrats win Congress']]) {
    check(!badNewsSource({ title: t, outlet: o }), `allowed: ${o} / ${t.slice(0, 50)}`);
  }
  check(!!badNewsSource({ title: 'Gold climbs', outlet: 'Investing News Network', sourceUrl: 'https://kalshi.com/x' }), 'blocked by source domain');
  check(garbledTitle('russian diesel imports blocked by new jersey despite trump') && !garbledTitle('Russian diesel imports blocked by New Jersey'), 'garbled lowercase title');
  learnWords(['Parties form a coalition government after the election', 'coalition talks stall again today', 'hostilities resume near the border while leaders meet'].concat(Array.from({ length: 400 }, (_, i) => `Word${'abcdefghij'[i % 10]}ing test headline number ${'qrstuvwxyz'[i % 10]}ample item ${i}`)));
  check(looksCut('Israel’s Election Ended With No Clear Winner. These Parties Are Trying to Form a Coalitio'), 'cut: "... Form a Coalitio"');
  check(looksCut('Trump says he will meet the leaders of the Gulf states and'), 'cut: dangling "and"');
  check(looksCut('Senators weigh a new plan for the budget …'), 'cut: ellipsis');
  check(!looksCut('Israel’s Election Ended With No Clear Winner. These Parties Are Trying to Form a Coalition.'), 'not cut: full headline');
  check(!looksCut('Iran’s Khamenei warns Trump loss at polls won’t end US hostility'), 'not cut: "hostility" (inflection of a known word)');
  // weak-match rules on a synthetic index
  const mk = (i, eventTitle, outcome, extra = {}) => ({ id: `m${i}`, eventId: `e${i}`, eventTitle, title: eventTitle, outcome, yesPrice: 0.4, volume24h: 50000, category: 'economy', source: 'polymarket', ...extra });
  const filler = Array.from({ length: 80 }, (_, i) => mk(100 + i, `Filler topic ${i} number ${i * 7} ${['alpha', 'bravo', 'charlie', 'delta', 'echo'][i % 5]}${i}`, 'Yes'));
  const nat = mk(1, 'National gas price above $3.80 in November?', 'Yes');
  const idxM = [nat, ...filler];
  const story = (m, extra = {}) => ({ id: `s${m.id}`, lead: m, markets: [m], eventTitle: m.eventTitle, category: m.category, ...extra });
  const now = Date.now();
  const hl = (title, outlet = 'Probe') => ({ title, outlet, publishedAt: new Date(now - 3_600_000).toISOString(), category: 'general' });
  check(scopeMismatch(nat.eventTitle, 'Fairfield Gas Prices Run A Little Above State Average'), 'local story on a national market is a scope mismatch');
  check(!scopeMismatch(nat.eventTitle, 'AAA: national average gas price falls to $3.52'), 'national headline on a national market is fine');
  check(geoMiss("Canada's GDP growth rate MoM in September", 'Czech Retail Sales Rise 0.1% MoM in September'), 'other country on a named-country question');
  check(!geoMiss("Canada's GDP growth rate MoM in September", 'Canada economy grows 0.1% in September, Statistics Canada says'), 'same country passes');
  const hits = matchStoryNews(story(nat), buildHeadlineIndex([hl('Fairfield Gas Prices Run A Little Above State Average'), hl('National gas price falls for the fourth week, AAA says')]), idxM, { now });
  check(hits.length <= 1 && !hits.some((h) => /Fairfield/.test(h.item.title)), 'story matcher drops the Patch-style local gas story');
  // flash matcher: key entity (rarest words of the market must be in the news)
  const la = mk(2, 'Louisiana data center moratorium by June 30?', 'Yes');
  const idx2 = [la, ...filler];
  const { matchMarkets } = await import('../server/editorial/match.mjs');
  const loose = await matchMarkets({ title: 'Data Center IPOs surge as AI demand grows', items: [{ title: 'Data Center IPOs surge as AI demand grows' }] }, idx2, { search: false });
  check(!loose.length, 'flash: "Data Center IPOs" does not land on a Louisiana data-center moratorium market');
  const tight = await matchMarkets({ title: 'Louisiana lawmakers weigh a data center moratorium', items: [{ title: 'Louisiana lawmakers weigh a data center moratorium' }] }, idx2, { search: false });
  check(tight.length > 0, 'flash: the Louisiana moratorium headline still matches its market');
  // ---- relevance pass (2026-11-05): reference / evergreen pages, question types, price recency, lead subject
  for (const [o, t] of [['Britannica', '2026 Iran war | Oil, Explained, United States, Israel, Strait of Hormuz, Map, & Conflict'],
    ['The Sunday Guardian', 'Diwali Decoration AI Prompts 2026: Copy-Paste These Trending ChatGPT and Gemini Prompts'],
    ['Kalkine', 'Why Did Brent Swing Over USD 6 in One Day for United States Oil Fund (NYSEARCA:USO)?'], ['qz.com', "10 things to know about Google's Gemini 4 Carbon"],
    ['Benzinga', 'JD Vance, Jon Ossoff or Kamala Harris? Crypto Bettors Assign Highest Odds of Winning'], ['IMDb', 'Oscar Predictions: Documentary Feature']]) {
    check(!!badNewsSource({ title: t, outlet: o }), `blocked (reference/evergreen/bettors): ${o} / ${t.slice(0, 50)}`);
  }
  check(!badNewsSource({ title: 'What Is SpaceX Planning With Its Reported Move Into U.S. Mobile?', outlet: 'Yahoo Finance' }), 'allowed: a news question that starts "What Is"');
  const ago = (h) => new Date(now - h * 3_600_000).toISOString();
  const hlA = (title, h = 1, outlet = 'Probe') => ({ title, outlet, publishedAt: ago(h), category: 'general' });
  const qcase = (m, good, bad, what) => {
    const idxQ = [m, ...filler];
    const titles = (rs) => rs.map((r) => r.item.title);
    const g = titles(matchStoryNews(story(m), buildHeadlineIndex(good.map((x) => hlA(...x))), idxQ, { now, maxAgeMs: 7 * 24 * 3_600_000 }));
    const b = titles(matchStoryNews(story(m), buildHeadlineIndex(bad.map((x) => hlA(...x))), idxQ, { now, maxAgeMs: 7 * 24 * 3_600_000 }));
    check(g.length === good.length && !b.length, `${what}${b.length ? ` (wrongly kept: ${b.join(' / ')})` : ''}${g.length < good.length ? ` (lost: ${good.map((x) => x[0]).filter((t) => !g.includes(t)).join(' / ')})` : ''}`);
  };
  qcase(mk(3, 'The Cat in the Hat Rotten Tomatoes score?', 'Above 50', { category: 'culture' }),
    [['The Cat in the Hat reviews: critics split on the Dr. Seuss remake']], [["The Cat in the Hat's box office tracking is way below the Mike Myers movie"]], 'Rotten Tomatoes score needs a reviews headline');
  qcase(mk(4, 'Brent oil price above $97.99 a barrel on November 6?', 'Yes'),
    [['Brent crude slips toward $97 as supply fears ease', 2]], [['Brent Crude $104, Lowest Since 7 Oct', 32], ['Gold climbs as Brent and Treasury yields fall', 2]], 'price level needs a fresh (< 24h) headline about that asset');
  qcase(mk(5, 'Traffic through the Strait of Hormuz? More than 20 transit calls', 'Above 20', { category: 'politics' }),
    [['Tanker traffic through the Strait of Hormuz picks up as insurers return']], [['Iran says Strait of Hormuz talks with Oman went well']], 'Hormuz transits need a shipping headline');
  console.log(fails ? `\n${fails} FAILED` : '\nall independence/quality checks passed');
  if (fails) process.exitCode = 1;
}
process.exit(process.exitCode || 0);
