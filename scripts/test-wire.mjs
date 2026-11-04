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
process.exit(0);
