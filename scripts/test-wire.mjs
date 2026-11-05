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
  console.log(fails ? `\n${fails} FAILED` : '\nall independence/quality checks passed');
  if (fails) process.exitCode = 1;
}
process.exit(process.exitCode || 0);
