#!/usr/bin/env node
// Stock and bond moves (server/finance.mjs, sources/finance.mjs): offline rule tests, then optionally a live pass.
// Usage: node scripts/test-finance.mjs            offline only (parsers, thresholds, hysteresis, copy, pairing, headlines)
//        node scripts/test-finance.mjs --live     + Yahoo/Treasury/exchange fetch and a full evaluate against
//                                                  data/news-archive.json (never touches a running server)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../server/config.mjs';
import { parseChart, parseTreasuryXml, sessionAt, quoteSession } from '../server/sources/finance.mjs';
import { matchHeadline, headlineDirection, pickPaired, severityOf, stepHysteresis, moveCopy, cleanOutcome, fedPhrase, whenOf, marketLine, createFinance } from '../server/finance.mjs';
import { rankFinanceMoves } from '../server/editorial/rank.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const F = config.finance;
const W = (s) => F.watchlist.find((w) => w.symbol === s);
let fails = 0, n = 0;
const ok = (cond, msg, extra = '') => { n++; if (!cond) { fails++; console.log(`FAIL ${msg} ${extra}`); } };
const eq = (a, b, msg) => ok(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const BAD_COPY = /\bbps\b|basis points?|¢|\bYES\b|\bNO\b|\bwill\b|\bcrash|\bbuy\b|\bsell\b(?!-?off)/i;

// --- parsers ---
const chart = { chart: { result: [{ meta: { symbol: 'NVDA', longName: 'NVIDIA Corporation', regularMarketPrice: 190.76, chartPreviousClose: 200.13, regularMarketTime: 1793891350, fiftyTwoWeekHigh: 243.37, fiftyTwoWeekLow: 164.27, regularMarketDayHigh: 196.25, regularMarketDayLow: 189.1, currentTradingPeriod: { regular: { start: 1793889000, end: 1793912400 }, pre: { start: 1793869200, end: 1793889000 }, post: { start: 1793912400, end: 1793926800 } } }, timestamp: [1793889000, 1793889300, 1793889600], indicators: { quote: [{ close: [195, null, 190.76] }] } }] } };
const q = parseChart(chart);
eq(q.points.length, 2, 'parseChart drops null closes');
eq(Math.round(q.changePct * 100) / 100, -4.68, 'parseChart day change %');
eq(quoteSession(q, 1793891350), 'open', 'quoteSession open inside regular period');
eq(quoteSession(q, 1793880000), 'pre', 'quoteSession pre');
const xml = `<feed><entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-11-03T00:00:00</d:NEW_DATE><d:BC_2YEAR m:type="Edm.Double">4.61</d:BC_2YEAR><d:BC_10YEAR m:type="Edm.Double">4.95</d:BC_10YEAR></m:properties></content></entry><entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-11-02T00:00:00</d:NEW_DATE><d:BC_2YEAR m:type="Edm.Double">4.59</d:BC_2YEAR></m:properties></content></entry></feed>`;
const rows = parseTreasuryXml(xml);
eq(rows.length, 2, 'treasury rows'); eq(rows[0].date, '2026-11-02', 'treasury sorted oldest first'); eq(rows[1].BC_10YEAR, 4.95, 'treasury 10Y value');
eq(sessionAt(Date.parse('2026-11-05T15:00:00Z')), 'regular', 'ET 10:00 Thu is regular');
eq(sessionAt(Date.parse('2026-11-05T13:00:00Z')), 'extended', 'ET 8:00 Thu is extended');
eq(sessionAt(Date.parse('2026-11-08T15:00:00Z')), 'overnight', 'Sunday is overnight');

// --- thresholds ---
const sv = severityOf(W('NVDA'), q, F);
ok(sv.sev >= 2 && sv.direction === 'down', 'NVDA -4.7% is big for a top-5 name (2% threshold)', JSON.stringify(sv));
ok(severityOf(W('JPM'), { ...q, symbol: 'JPM', changePct: -2.5, points: [] }, F).sev < 1, 'JPM -2.5% is under the 3% mega-cap threshold');
ok(severityOf(W('^TNX'), { change: 0.12, changePct: 2.5, points: [] }, F).sev >= 1, '10Y +0.12 points is big');
ok(severityOf(W('^TNX'), { change: 0.04, changePct: 0.9, points: [] }, F).sev < 1, '10Y +0.04 points is not big');
ok(severityOf(W('^GSPC'), { change: -105, changePct: -1.4, points: [] }, F).sev < 1, 'S&P -1.4% is not big (1.5%)');
ok(severityOf(W('^NDX'), { change: -900, changePct: -3.2, points: [] }, F).sev >= 1, 'NDX -3.2% is big');
// 60-minute swing: +2.2% in an hour on a stock that is flat on the day
const swingPts = Array.from({ length: 14 }, (_, i) => ({ t: 1793889000 + i * 300, p: i < 2 ? 100 : 102.2 }));
ok(severityOf(W('JPM'), { change: 0.5, changePct: 0.5, points: swingPts }, F).by === 'swing', 'intraday 60-min swing fires');

// --- hysteresis ---
const H = F.hysteresis, t0 = 1_000_000_000_000;
let h = stepHysteresis(null, 1.2, t0, H); ok(h.fired && h.st.level === 1, 'fires on crossing');
h = stepHysteresis(h.st, 1.4, t0 + 60_000, H); ok(!h.fired, 'no refire on small growth');
h = stepHysteresis(h.st, 1.85, t0 + 120_000, H); ok(h.fired && h.st.level === 2, 'refires at 1.5x growth');
h = stepHysteresis(h.st, 1.9, t0 + 4.1 * 36e5, H); ok(h.fired && h.st.level === 3, 'refires after 4h');
h = stepHysteresis(h.st, 0.9, t0 + 4.2 * 36e5, H); ok(h.st.active && !h.fired, 'stays on between exit and threshold');
h = stepHysteresis(h.st, 0.7, t0 + 4.3 * 36e5, H); ok(!h.st.active, 'leaves under 80%');

// --- copy ---
const NOW = Date.parse('2026-11-05T15:30:00Z');
const live = { session: 'open', now: NOW };
eq(moveCopy(W('NVDA'), { ...q, time: NOW / 1000 }, { ...live, sev: 2.3 }).headline, 'NVIDIA slides 4.7% today', 'stock copy');
eq(moveCopy(W('^TNX'), { price: 4.902, change: 0.12, time: NOW / 1000 }, live).headline, '10-year yield rises to 4.90%, up 0.12 points today', 'yield copy');
eq(moveCopy(W('^TNX'), { price: 4.902, change: 0.12, time: NOW / 1000 }, live).change, 'up 0.12 points today', 'yield change text');
eq(moveCopy(W('^GSPC'), { price: 7580.84, change: -120, changePct: -1.56, time: NOW / 1000 }, live).headline, 'S&P 500 falls 1.6% today to 7,580.84', 'index copy');
eq(moveCopy(W('CL=F'), { price: 89.69, change: 2.8, changePct: 3.2, time: NOW / 1000 }, { session: 'closed', now: NOW }).headline, 'WTI oil rises 3.2% today to $89.69', 'oil still prints when the stock session is closed');
eq(moveCopy(W('NVDA'), { ...q, time: NOW / 1000 - 600 }, { session: 'post', now: NOW }).headline, 'NVIDIA closes down 4.7%', 'stock copy after the close');
eq(cleanOutcome('Above $89.99'), 'above $90', 'outcome money rounding');
eq(cleanOutcome('Above 4.00%'), 'above 4%', 'outcome percent');
eq(cleanOutcome('26,699.99 or below'), 'below 26,700', 'outcome or-below');
eq(cleanOutcome('7,575 or above'), '7,575 or above', 'outcome or-above');
eq(cleanOutcome('28,200 to 28,299.99'), 'between 28,200 and 28,300', 'outcome range');
eq(cleanOutcome('5% or above'), '5% or above', 'yield outcome');
eq(fedPhrase('25 bps increase'), 'a quarter-point Fed hike', 'fed hike'); eq(fedPhrase('Hike 25bps'), 'a quarter-point Fed hike', 'kalshi fed hike');
eq(fedPhrase('No change'), 'the Fed holding rates', 'fed hold'); eq(fedPhrase('50+ bps increase'), 'a half-point or bigger Fed hike', 'fed 50+');
eq(fedPhrase('Fed maintains rate'), 'the Fed holding rates', 'kalshi fed hold');
eq(whenOf({ eventSub: 'On Nov 5, 2026 at 11am EST' }, NOW), 'at 11am today', 'when: hourly');
eq(whenOf({ eventSub: 'On Nov 6, 2026' }, NOW), 'tomorrow', 'when: tomorrow');
eq(whenOf({ closesAt: '2026-11-05T21:00:00Z' }, NOW), 'at 4pm today', 'when: from close time');
eq(marketLine("Apple being the world's largest company at the end of December", 0.6305, 0.095), "63% chance of Apple being the world's largest company at the end of December, up 10 points today", 'market line');

// --- pairing ---
const mk = (o) => ({ source: 'polymarket', volume24h: 5000, closesAt: '2026-12-31T00:00:00Z', url: 'u', eventId: 'pm:1', ...o });
const lc = [mk({ id: 'a', outcome: 'Apple', yesPrice: 0.63, change1d: 0.095 }), mk({ id: 'n', outcome: 'NVIDIA', yesPrice: 0.335, change1d: -0.1 }), mk({ id: 'h', outcome: 'Company H', yesPrice: 0.5, volume24h: 0 })];
let rowsP = pickPaired(F.pairings.lcDec, lc, W('NVDA'), { now: NOW, minVolume: F.minPairVolume });
eq(rowsP.map((r) => r.id).join(','), 'n,a', 'company pick: own outcome then the leader');
ok(!rowsP.some((r) => r.id === 'h'), 'placeholder outcome with no volume never pairs');
eq(pickPaired(F.pairings.lcDec, lc, W('TSLA'), { now: NOW, minVolume: F.minPairVolume }).length, 0, 'no company outcome -> no pairing');
const ks = (o) => ({ source: 'kalshi', volume24h: 2000, url: 'k', ...o });
const inxu = [ks({ id: 'k1', eventId: 'ks:KXINXU-26NOV05H1100', eventSub: 'On Nov 5, 2026 at 11am EST', closesAt: '2026-11-05T16:00:00Z', outcome: '7,575 or above', yesPrice: 0.45 }),
  ks({ id: 'k2', eventId: 'ks:KXINXU-26NOV05H1100', eventSub: 'On Nov 5, 2026 at 11am EST', closesAt: '2026-11-05T16:00:00Z', outcome: '7,660 or above', yesPrice: 0.06 }),
  ks({ id: 'k3', eventId: 'ks:KXINXU-26NOV05H1200', eventSub: 'On Nov 5, 2026 at 12pm EST', closesAt: '2026-11-05T17:00:00Z', outcome: '7,520 or above', yesPrice: 0.5 }),
  ks({ id: 'k4', eventId: 'ks:KXINXU-26NOV05H1000', closesAt: '2026-11-05T15:00:00Z', outcome: '7,500 or above', yesPrice: 0.5 })];
rowsP = pickPaired(F.pairings.kInxu, inxu, W('^GSPC'), { now: NOW, minVolume: F.minPairVolume });
eq(rowsP[0]?.id, 'k1', 'line pick: soonest open event, rung nearest 50%');
eq(rowsP[0]?.label, 'the S&P 500 at 7,575 or above at 11am today', 'kalshi line label');
const fed = [mk({ id: 'f1', outcome: '25 bps increase', yesPrice: 0.755, change1d: -0.07 }), mk({ id: 'f2', outcome: 'No change', yesPrice: 0.235 })];
eq(pickPaired(F.pairings.pmFedDec, fed, W('^TNX'), { now: NOW, minVolume: F.minPairVolume })[0]?.line, '76% chance of a quarter-point Fed hike at the December meeting, down 7 points today', 'fed pairing line (no bps)');

// --- headlines ---
const items = [
  { title: 'Stock Rotation Rolls On as Chipmakers Retreat: Markets Wrap', outlet: 'Bloomberg', publishedAt: '2026-11-05T14:35:00Z', category: 'markets' },
  { title: 'Box taps Nvidia’s Nemotron for new agent-first content retrieval system', outlet: 'TechCrunch', publishedAt: '2026-11-05T15:00:00Z', category: 'tech' },
  { title: 'Nvidia shares slide as AI selloff deepens', outlet: 'CNBC', publishedAt: '2026-11-05T15:10:00Z', category: 'economy' },
  { title: "World's largest olive oil company plummets 20% after rivals agree to takeover deal", outlet: 'CNBC', publishedAt: '2026-11-05T15:20:00Z', category: 'economy' },
  { title: 'European Stocks Hit Record as AI Trade Unwinds', outlet: 'Bloomberg', publishedAt: '2026-11-05T15:20:00Z', category: 'markets' },
  { title: 'Nvidia stock surges to record', outlet: 'X', publishedAt: '2026-11-04T01:00:00Z', category: 'markets' },
];
const down = { direction: 'down' };
eq(matchHeadline(W('NVDA'), down, items, { now: NOW, hours: 6 })?.title, 'Nvidia shares slide as AI selloff deepens', 'NVDA picks the direct, same-direction headline');
eq(matchHeadline(W('CL=F'), { direction: 'down' }, items, { now: NOW, hours: 6 }), null, 'olive oil is not oil');
eq(matchHeadline(W('^GSPC'), down, items.slice(4, 5), { now: NOW, hours: 6 }), null, 'European stocks are not the S&P 500');
eq(matchHeadline(W('NVDA'), down, items.slice(1, 2), { now: NOW, hours: 6 }), null, 'a product headline without a market word still needs score');
eq(matchHeadline(W('NVDA'), down, items.slice(5), { now: NOW, hours: 6 }), null, 'stale headline outside the window');

// direction: a headline never contradicts the move; prefer the one naming the specific symbol/company
const mkIt = (title, min = 5, category = 'markets') => ({ title, outlet: 'X', publishedAt: new Date(NOW - min * 60_000).toISOString(), category });
const mh = (sym, dir, titles) => matchHeadline(W(sym), { direction: dir }, titles.map((t) => (typeof t === 'string' ? mkIt(t) : t)), { now: NOW, hours: 6 })?.title ?? null;
eq(mh('^DJI', 'down', ['Dow rises 200 points as Nvidia rallies']), null, 'Dow down move does not pair with "Dow rises"');
eq(mh('^DJI', 'down', ['Dow rises 200 points as Nvidia rallies', 'Dow falls 1.6% as tech sells off']), 'Dow falls 1.6% as tech sells off', 'Dow down picks the falling headline');
eq(mh('^DJI', 'up', ['Dow falls 1.6% as tech sells off']), null, 'Dow up move does not pair with "Dow falls"');
eq(mh('^DJI', 'down', ['Stocks: Dow Jones down 1.6%, Nasdaq slides']), 'Stocks: Dow Jones down 1.6%, Nasdaq slides', 'explicit "down 1.6%" is down');
eq(mh('^DJI', 'down', ['Wall Street rallies, Dow up 1.2% on trade hopes']), null, 'explicit "up 1.2%" is up, rejected on a down move');
eq(mh('^DJI', 'down', ['Dow falls as Nvidia rises']), 'Dow falls as Nvidia rises', 'clause naming the subject decides ("Dow falls as Nvidia rises")');
eq(mh('NVDA', 'up', ['Dow falls as Nvidia rises']), 'Dow falls as Nvidia rises', 'Nvidia up reads its own clause in the same headline');
eq(mh('NVDA', 'down', ['Dow falls as Nvidia rises']), null, 'Nvidia down rejects "Nvidia rises"');
eq(mh('^DJI', 'up', ['Dow rises after falling from record high']), 'Dow rises after falling from record high', 'subject clause beats trailing "falling"');
eq(mh('^DJI', 'down', ['Dow slips from a record high']), 'Dow slips from a record high', '"from a record high" is not an up verb');
eq(mh('^GSPC', 'down', ['Dow rises 200 points']), null, 'another index headline (Dow) is not the S&P 500 move');
eq(mh('^NDX', 'down', ['Dow Jones falls 300 points, Nasdaq slides 3%']), 'Dow Jones falls 300 points, Nasdaq slides 3%', 'a headline naming both indexes still pairs');
eq(mh('^GSPC', 'down', ['Stocks rise as Treasury yields fall']), null, 'S&P down: "Stocks rise" rejected even with "fall" later');
eq(mh('^TNX', 'down', ['Treasury yields fall as inflation cools', 'Treasury yields rise on strong jobs data']), 'Treasury yields fall as inflation cools', 'yield down picks yields-fall headline');
eq(mh('^TNX', 'down', ['Stocks rise as Treasury yields fall']), 'Stocks rise as Treasury yields fall', 'yield move reads the yields clause');
eq(mh('NVDA', 'down', ['Nvidia shares tumble 6%', 'Chipmakers retreat: markets wrap']), 'Nvidia shares tumble 6%', 'prefers the headline naming Nvidia over a sector one');
eq(headlineDirection('Oil jumps 3% as OPEC cuts', [W('CL=F') && new RegExp('oil', 'i')]), 'up', 'headlineDirection oil up');

// --- news question types (match.mjs): App Store rank questions and shutdown questions need on-question headlines ---
{
  const { matchStoryNews, buildHeadlineIndex } = await import('../server/editorial/match.mjs');
  const H = 3_600_000;
  const at = (h) => new Date(NOW - h * H).toISOString();
  const mkm = (o) => ({ source: 'polymarket', tags: [], change1w: null, closesAt: new Date(NOW + 2 * 24 * H).toISOString(), volumeTotal: 1e6, liquidity: 1e5, outcome: null, updatedAt: new Date(NOW).toISOString(), ...o, eventId: o.eventId || o.id, eventTitle: o.eventTitle || o.title });
  const story = (title, category, extra = {}) => { const lead = mkm({ id: 'pm:t1', title, category, yesPrice: 0.6, change1d: 0.1, volume24h: 5e5, ...extra }); return { id: lead.id, category, eventTitle: lead.eventTitle, lead, markets: [lead] }; };
  const filler = ['Fed hike December', 'Oil above $90', 'Senate control 2026', 'Bitcoin above 100k', 'Nobel Peace Prize winner', 'Super Bowl champion', 'Ceasefire Ukraine Russia', 'Apple largest company', 'Recession 2026', 'Mamdani approval', 'Tariffs Supreme Court', 'Gold above $5000', 'Government shutdown November', 'Next Fed chair', 'Movie box office weekend', 'Spotify top song', 'Tesla robotaxi launch', 'Netflix subscribers', 'Starship launch', 'World Series winner'];
  const noise = filler.map((t, i) => ({ outlet: 'X', category: 'misc', url: 'https://n/' + i, title: t + ' story update today', publishedAt: at(2) }));
  const run = (st, arch) => matchStoryNews(st, buildHeadlineIndex([...arch.map((a) => ({ outlet: 'Reuters', category: 'tech', url: 'https://x/' + Math.random(), ...a, publishedAt: at(a.h ?? 1) })), ...noise]), [st.lead, ...filler.map((t, i) => mkm({ id: 'pm:f' + i, title: 'Will ' + t + '?', category: 'misc' }))], { now: NOW, entity: st.category === 'sports' }).map((h) => h.item.title);
  const tt = story('TikTok Pro - Events are #1 Free App in the US Apple App Store on Nov 6', 'tech');
  const shop = run(tt, [{ title: 'TikTok quietly launches a standalone TikTok Shop app' }, { title: 'TikTok Pro launches Events in the US as the free app expands to more users' }, { title: 'TikTok Shop app launches in the US with free shipping events' }]);
  eq(shop.length, 0, 'App Store #1 question does not take the TikTok Shop launch story', JSON.stringify(shop));
  const rank = run(tt, [{ title: 'TikTok Pro tops the Apple App Store free app chart after new events launch' }, { title: 'TikTok quietly launches a standalone TikTok Shop app' }]);
  eq(rank.length, 1, 'App Store #1 question still takes a headline about the app-store ranking', JSON.stringify(rank));
  const liv = story('Will LIV Golf announce shutdown in 2026?', 'sports', { yesPrice: 0.98, change1w: 0.46 });
  const livIt = run(liv, [{ title: "LIV Golf timeline: From the league's beginning to where things now stand", category: 'sports' }, { title: 'Is this the end of the road for LIV Golf?', category: 'sports' }]);
  eq(livIt.includes("LIV Golf timeline: From the league's beginning to where things now stand"), false, 'LIV Golf shutdown question never takes the timeline retrospective', JSON.stringify(livIt));
  eq(livIt.includes('Is this the end of the road for LIV Golf?'), true, 'LIV Golf shutdown question takes "end of the road"', JSON.stringify(livIt));
  const livIt2 = run(liv, [{ title: 'LIV Golf funding in doubt as Saudi PIF reviews its spending', category: 'sports' }]);
  eq(livIt2.length, 1, 'LIV Golf shutdown question takes a funding-in-doubt headline', JSON.stringify(livIt2));
}

// --- rank ---
const mv = (symbol, kind, severity, thin = false) => ({ symbol, kind, severity, at: '2026-11-05T15:00:00Z', markets: [{ thin }] });
eq(rankFinanceMoves([mv('NVDA', 'stock', 2.8), mv('AAPL', 'stock', 2.5), mv('TSLA', 'stock', 2.4), mv('^TNX', 'yield', 1.2)], { max: 3 }).map((m) => m.symbol).join(','), 'NVDA,AAPL,^TNX', 'rank: one per class first, then by severity');

console.log(`offline: ${n - fails}/${n} passed`);

// --- live ---
if (process.argv.includes('--live')) {
  const store = { state: {}, setState(p) { Object.assign(this.state, p); } };
  let archive = [];
  try { archive = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/news-archive.json'), 'utf8')); } catch { console.log('no data/news-archive.json; headlines will be empty'); }
  const fin = createFinance(store, config, { getArchive: () => archive, getMarkets: () => [] });
  const t0 = Date.now();
  await fin._tick();
  const st = store.state.finance;
  console.log(`\nlive sweep ${Date.now() - t0}ms, session ${st.session}, quotes ${st.quotes.length}, errors ${st.stats.quoteErrors} ${st.stats.lastError || ''}`);
  for (const r of st.quotes) console.log(`  ${r.big ? (r.aired ? 'AIR ' : 'BIG ') : r.half ? 'half' : '    '} ${r.symbol.padEnd(9)} ${String(r.priceText).padStart(10)}  ${r.changeText.padEnd(28)} sev ${r.severity}${r.why ? `  (${r.why})` : ''}${r.officialClose ? `  treasury ${r.officialClose.date} ${r.officialClose.value}` : ''}`);
  console.log(`\nmoves (${st.moves.length}):`);
  for (const m of st.moves) {
    console.log(`  ${m.copy.headline}  [${m.copy.price}; sev ${m.severity}; 5d ${m.history5d.length} pts, 1mo ${m.history1mo.length} pts]`);
    console.log(`    In the news: ${m.headline.title} (${m.headline.outlet}, ${m.headline.publishedAt})`);
    for (const x of m.markets) console.log(`    ${x.source}: ${x.line}  ($${x.volume24h.toLocaleString()} 24h${x.thin ? ', thin' : ''})`);
    for (const s of [m.copy.headline, m.copy.change, ...m.markets.map((x) => x.line)]) ok(!BAD_COPY.test(s), 'live copy has no jargon/call words', s);
  }
  console.log(`live copy checks: ${fails ? 'FAILED' : 'ok'}`);
}
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('all finance checks passed');
