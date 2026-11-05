#!/usr/bin/env node
// Offline check of the editorial engine against the saved Polymarket samples.
// Prints the top headlines/deks/kinds, the drop-reason histogram, rule-violation checks, and a breaking test.
// Usage: node scripts/test-editorial.mjs [--all]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStories, boardCat } from '../server/editorial/rank.mjs';
import { detectBreaking, resetBreaking } from '../server/editorial/breaking.mjs';
import { pct, pts, newsQuery, questionToClause, storyHeadline, shortHeadline, marketLabel } from '../server/editorial/copy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'research/samples', f), 'utf8'));
const NOW = Date.parse('2026-11-04T15:00:00Z');

let config;
try { config = (await import('../server/config.mjs')).default; } catch { config = {}; }

// Merge the two samples into Gamma-style events: the top-100 markets carry their event (without tags),
// so attach tags from the top-20 events file when the event matches.
const events = S('polymarket-events-top20-2026-11-04.json');
const top = S('polymarket-markets-top100-2026-11-04.json');
const byEv = new Map(events.map((e) => [String(e.id), { ...e, markets: [...(e.markets || [])] }]));
for (const m of top) {
  const ev = m.events?.[0];
  if (!ev) continue;
  const key = String(ev.id);
  if (!byEv.has(key)) byEv.set(key, { ...ev, tags: ev.tags || [], markets: [] });
  const e = byEv.get(key);
  if (!e.markets.some((x) => String(x.id) === String(m.id))) e.markets.push(m);
}
const merged = [...byEv.values()];

let markets;
try {
  const { parsePolymarketEvents } = await import('../server/sources/polymarket.mjs');
  markets = parsePolymarketEvents(merged, new Date(NOW));
  console.log(`normalizer: sources/polymarket.mjs parsePolymarketEvents -> ${markets.length} markets`);
} catch (e) {
  console.log(`normalizer: local fallback (${e.message})`);
  markets = localNormalize(merged);
}

const out = buildStories(markets, config, { now: NOW });
const all = process.argv.includes('--all');
const N = all ? out.stories.length : 15;
console.log(`\nkept ${out.stats.kept}/${out.stats.input} markets in ${out.stats.events} events\n`);
console.log('=== TOP STORIES ===');
out.stories.slice(0, N).forEach((s, i) => {
  console.log(`${String(i + 1).padStart(2)}. [${s.kind}/${s.category}/${s.visual.type}${s.visual.region ? ' @' + s.visual.region.name : ''}] score ${s.score}${s.thin ? ' THIN' : ''}`);
  console.log(`    ${s.headline}  (${s.headline.length})`);
  console.log(`    ${s.dek}`);
  console.log(`    news: "${newsQuery(s)}"`);
});
const mix = (l) => Object.entries(l.reduce((a, s) => ((a[s.category] = (a[s.category] || 0) + 1), a), {}))
  .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`\n=== BOARD MIX (${out.stories.length}) === ${mix(out.stories)}  |  for quotas: ${mix(out.stories.map((s) => ({ category: boardCat(s) })))}`);
console.log(`  top 6: ${out.stories.slice(0, 6).map((s) => boardCat(s)).join(', ')} (${new Set(out.stories.slice(0, 6).map((s) => boardCat(s))).size} categories)`);
console.log(`\n=== DESKS (${(out.desks || []).length}) ===`);
for (const d of out.desks || []) {
  console.log(`  ${d.title} [${d.categories.join('+')}] ${mix(d.stories)}`);
  for (const s of d.stories) console.log(`    ${s.headline}`);
}
console.log('\n=== MOVERS (ticker) ===');
for (const m of out.movers.slice(0, 12)) console.log(`  ${m.line}`);
console.log('\n=== CLOSING THIS WEEK ===');
for (const s of out.closing) console.log(`  ${s.headline}`);
console.log('\n=== DROP REASONS ===');
for (const [r, n] of Object.entries(out.stats.dropped).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`);

// Rule checks over everything that would air.
const problems = [];
const deskStories = (out.desks || []).flatMap((d) => d.stories);
const airText = [...out.stories, ...deskStories].flatMap((s) => [s.headline, s.dek]).concat(out.movers.map((m) => m.line));
for (const t of airText) {
  const unquoted = t.replace(/“[^”]*”/g, '');
  if (/\bwill\b/i.test(unquoted)) problems.push(`"will": ${t}`);
  if (/¢|\bbps\b|\bYES\b|\bNO\b/.test(t)) problems.push(`jargon: ${t}`);
  if (/…|\.\.\./.test(unquoted)) problems.push(`ellipsis: ${t}`);
  if (/undefined|NaN|null/.test(t)) problems.push(`bad value: ${t}`);
  if (/\bBettors\b/.test(t)) problems.push(`"Bettors": ${t}`);
  if (/\b(is|are) expected to\b/i.test(unquoted)) problems.push(`prediction: ${t}`);
}
for (const s of [...out.stories, ...deskStories]) {
  // every headline must read as a probability, never as a fact
  if (!/%|\bodds\b|\bchance\b/i.test(s.headline)) problems.push(`not a probability: ${s.headline}`);
  if (s.headline.length > 90) problems.push(`long headline (${s.headline.length}): ${s.headline}`);
  const txt = `${s.eventTitle} ${s.lead.title}`;
  // sports/games futures (e.g. Champions League winner) are allowed since 2026-11-05 (news-gated in ingest); game-level noise is not
  if (/\bvs\.?\s|bitcoin|tweets|ceasefire|invade|military/i.test(txt)) problems.push(`noise aired: ${txt}`);
  if ((s.category === 'sports' || s.category === 'games') && /\b(spread|over\/under|o\/u|total (points|goals)|player props?|both teams to score|map \d)\b/i.test(txt)) problems.push(`sports micro-prop aired: ${txt}`);
}
// Board/desk structure checks
const cnt = out.stories.reduce((a, s) => ((a[boardCat(s)] = (a[boardCat(s)] || 0) + 1), a), {});
// quotas only bind when there are enough stories to fill the board without relaxing them
if (out.stories.length >= (config.limits?.stories ?? 30)) {
  if ((cnt.elections || 0) > 7) problems.push(`quota: elections ${cnt.elections} > 7`);
  for (const [c, n] of Object.entries(cnt)) if (c !== 'elections' && n > 6) problems.push(`quota: ${c} ${n} > 6`);
}
for (const d of out.desks || []) {
  if (d.stories.length < 2 || d.stories.length > 12) problems.push(`desk ${d.id} has ${d.stories.length} stories`);
  for (const s of d.stories) if (!d.categories.includes(boardCat(s))) problems.push(`desk ${d.id} has ${boardCat(s)}`);
}
console.log(`\n=== RULE CHECKS: ${problems.length ? problems.length + ' problem(s)' : 'clean'} ===`);
for (const p of problems) console.log('  ' + p);

// Unit-ish checks for copy helpers.
const eq = (a, b, label) => { if (a !== b) { console.log(`  FAIL ${label}: got "${a}" want "${b}"`); process.exitCode = 1; } };
eq(pct(0.004), '<1%', 'pct low'); eq(pct(0.996), '>99%', 'pct high'); eq(pct(0.724), '72%', 'pct mid');
eq(pts(0.12, 'today'), 'up 12 points today', 'pts up'); eq(pts(-0.04, 'this week'), 'down 4 points this week', 'pts down'); eq(pts(0.01), 'up 1 point', 'pts singular');
eq(questionToClause('Will the Fed cut rates in December?'), 'the Fed cuts rates in December', 'clause fed');
eq(questionToClause('Will Republicans win the Senate?'), 'Republicans win the Senate', 'clause plural');
eq(questionToClause('Will there be no change in Fed interest rates after the December 2026 meeting?'), 'there is no change in Fed interest rates in December', 'clause there');
eq(questionToClause('Will Anthropic IPO by November 25, 2026?'), 'Anthropic goes public by November 25, 2026', 'clause IPO');
eq(questionToClause('Will Texas US Senate have the smallest margin of victory in the November 3, 2026 general elections for Alaska US Senate and Texas US Senate?'), "the Texas Senate race is closer than Alaska's", 'clause closer race');
eq(questionToClause('Will the Bank of Mexico Cut 25bps at the December Bank of Mexico Governing Board meeting?'), 'the Bank of Mexico cuts a quarter point in December', 'clause banxico');
eq(questionToClause('GPT Astra 6.1+ released by November 6?'), 'GPT Astra 6.1+ is released by November 6', 'clause participle');
{
  const mk = (o) => ({ id: 'x', source: 'kalshi', change1w: null, volume24h: 1e5, closesAt: null, ...o });
  const hl = (m, kind = 'mover') => storyHeadline({ lead: m, kind, markets: [m] });
  const h1 = hl(mk({ title: 'Will Mississippi US Senate have the smallest margin of victory in the November 3, 2026 general elections for Minnesota US Senate and Mississippi US Senate?', outcome: 'Mississippi US Senate', eventTitle: 'Closer Senate Race: Minnesota or Mississippi?', yesPrice: 0.99, change1d: 0.2 }));
  if (!/Mississippi Senate race is closer than Minnesota's/.test(h1)) { console.log('  FAIL closer race headline: ' + h1); process.exitCode = 1; }
  const h2 = hl(mk({ title: 'Best AI on Dec 31, 2026?', outcome: 'Claude', eventTitle: 'Best AI at the end of 2026?', yesPrice: 0.39, change1d: 0.01 }), 'favorite');
  if (!/^Claude .*39% chance .*best AI/.test(h2)) { console.log('  FAIL best AI headline: ' + h2); process.exitCode = 1; }
  for (const h of [h1, h2]) if (/Bettors|\bwill\b/i.test(h)) { console.log('  FAIL voice: ' + h); process.exitCode = 1; }
}
eq(questionToClause('Will the Fed increase interest rates by 25 bps after the December 2026 meeting?'), 'the Fed hikes rates a quarter point in December', 'clause bps');

// Kalshi/Polymarket title grammar (polish pass 2026-11-04)
eq(questionToClause('Bank of Mexico decreases interest rates by 25 bps after November 2026 meeting?'), 'the Bank of Mexico cuts rates a quarter point in November', 'clause banxico statement');
eq(questionToClause('Will the Federal Reserve Hike rates by 0bps at their December 2026 meeting?'), 'the Federal Reserve leaves rates unchanged in December', 'clause fed 0bps');
eq(questionToClause('Will the Federal Reserve Hike rates by >25bps at their December 2026 meeting?'), 'the Federal Reserve hikes rates more than a quarter point in December', 'clause fed >25bps');
eq(questionToClause('Will Sarah Huckabee Sanders receive at least 56% of the popular vote in the Arkansas gubernatorial election?'), 'Sarah Huckabee Sanders receives at least 56% of the popular vote in the Arkansas gubernatorial election', 'clause name ending in s');
eq(questionToClause('Will there be at least 4 presidential actions in the week of Nov 1, 2026?'), 'there are at least 4 presidential actions in the week of Nov 1, 2026', 'clause there are');
{
  const mk = (o) => ({ id: 'pm:np', source: 'polymarket', change1w: null, volume24h: 1e5, closesAt: null, outcome: null, ...o });
  const h = storyHeadline({ lead: mk({ title: 'US-Iran Hormuz Agreement by December 31?', eventTitle: 'US-Iran Hormuz Agreement by December 31?', yesPrice: 0.41, change1d: 0.09 }), kind: 'mover' });
  eq(h, 'Chance of a US-Iran Hormuz agreement by December 31: 41%, up 9 points today', 'noun-phrase headline');
  const h2 = storyHeadline({ lead: mk({ title: 'Bank of Mexico decreases interest rates by 25 bps after November 2026 meeting?', eventTitle: 'Bank of Mexico Decision in November?', outcome: '25 bps decrease', yesPrice: 0.29, change1d: 0.02 }), kind: 'favorite' });
  if (!/the Bank of Mexico cuts rates a quarter point in November/.test(h2)) { console.log('  FAIL banxico headline: ' + h2); process.exitCode = 1; }
}

// Strike ladders: a Kalshi "Above $X" event airs as ONE yes/no story on the rung nearest 50%, with the neighbors in the dek.
{
  const { parseKalshiMarkets } = await import('../server/sources/kalshi.mjs');
  const rung = (k, last, prev, vol) => ({ ticker: `KXAAAGASW-26NOV09-${k.toFixed(4)}`, title: `Will average **gas prices** be above $${k.toFixed(4)}?`,
    yes_sub_title: `Above ${k.toFixed(4)}`, strike_type: 'greater', floor_strike: k, status: 'active', last_price_dollars: String(last),
    previous_price_dollars: String(prev), volume_24h_fp: String(vol), volume_fp: String(vol * 5), open_time: '2026-11-02T13:00:00Z', close_time: '2026-11-09T12:00:00Z' });
  const gas = parseKalshiMarkets({ events: [{ event_ticker: 'KXAAAGASW-26NOV09', series_ticker: 'KXAAAGASW', title: 'US gas prices this week', sub_title: 'On Nov 9, 2026',
    category: 'Economics', mutually_exclusive: false, markets: [rung(3.98, 0.97, 0.97, 9000), rung(4.00, 0.92, 0.93, 27918), rung(4.02, 0.69, 0.76, 25083),
      rung(4.04, 0.08, 0.48, 20407), rung(4.06, 0.02, 0.28, 38231)] }] }, new Map([['KXAAAGASW', { category: 'Economics', tags: ['Oil and energy'], frequency: 'weekly' }]]), new Date(NOW));
  const lo = buildStories(gas, config, { now: NOW });
  const st = [...lo.stories, ...lo.desks.flatMap((d) => d.stories)].filter((s) => s.id === 'ks:KXAAAGASW-26NOV09');
  eq(lo.stories.length, 1, 'ladder airs as one story');
  const s0 = st[0] || {};
  eq(s0.lead?.id, 'ks:KXAAAGASW-26NOV09-4.0200', 'ladder line is the rung nearest 50%');
  eq(s0.headline, 'National gas price above $4.02 this week: 69% chance, down 7 points today', 'ladder headline');
  if (!/^Above \$4\.00: 92% · above \$4\.04: 8%\./.test(s0.dek || '')) { console.log('  FAIL ladder dek: ' + s0.dek); process.exitCode = 1; }
  if (!['dial', 'ribbon'].includes(s0.visual?.type)) { console.log('  FAIL ladder visual: ' + s0.visual?.type); process.exitCode = 1; }
  eq(lo.movers.length, 1, 'ladder movers: only the line');
  eq(lo.movers[0]?.id, 'ks:KXAAAGASW-26NOV09-4.0200', 'ladder mover is the line');
  eq(s0.sourceVolumes?.[0]?.volume24h, 9000 + 27918 + 25083 + 20407 + 38231, 'ladder volume is the whole event');
  eq(s0.markets?.[0]?.label, 'National gas price above $4.02 this week', 'ladder board label');
  console.log('\n=== LADDER ===\n  ' + s0.headline + '\n  ' + s0.dek + '\n  ticker: ' + lo.movers[0]?.line);
  for (const t of [s0.headline, s0.dek, lo.movers[0]?.line]) if (/\bwill\b|Bettors|undefined|NaN|¢|\bbps\b/i.test(t || '')) { console.log('  FAIL ladder voice: ' + t); process.exitCode = 1; }
}

// Rotation & freshness (2026-11-04): movers caps, closing caps, desk size, 1h motion in scoring and copy.
{
  const { freshness } = await import('../server/editorial/rank.mjs');
  const soon = new Date(NOW + 3 * 864e5).toISOString();
  let n = 0;
  const mk = (cat, title, change1d, extra = {}) => {
    n++;
    return { id: `pm:t${n}`, source: 'polymarket', title, outcome: null, eventId: `pm:te${n}`, eventTitle: title.replace(/^Will /, '').replace(/\?$/, ''),
      category: '', tags: [cat], yesPrice: 0.45, change1d, change1w: change1d, volume24h: 4e5, volumeTotal: 2e6, liquidity: null, closesAt: soon,
      url: 'https://polymarket.com/event/x', tokenId: null, updatedAt: new Date(NOW).toISOString(), ...extra };
  };
  const set = [];
  for (let i = 0; i < 5; i++) set.push(mk('elections', `Will Candidate${i} win the State${i} Senate race?`, 0.4 - i * 0.01));
  for (let i = 0; i < 20; i++) set.push(mk('elections', `Will Mayor${i} win the City${i} mayoral election?`, 0.35 - i * 0.005));
  for (let i = 0; i < 8; i++) set.push(mk('economy', `Will Index${i} close above level ${i} in December?`, 0.1 - i * 0.005));
  for (let i = 0; i < 3; i++) set.push(mk('tech', `Will Gadget${i} launch in December?`, 0.08 - i * 0.005));
  for (let i = 0; i < 2; i++) set.push(mk('culture', `Will Film${i} win Best Picture?`, 0.07 - i * 0.005));
  for (let i = 0; i < 6; i++) set.push(mk('politics', `Will Official${i} sign Bill${i} in December?`, 0.09 - i * 0.005));
  for (let i = 0; i < 4; i++) set.push(mk('geopolitics', `Will Country${i} hold talks with Country${i + 10} in December?`, 0.06 - i * 0.005));
  const r = buildStories(set, config, { now: NOW });
  const byId = new Map(set.map((m) => [m.id, m]));
  const cats = r.movers.reduce((a, m) => ((a[byId.get(m.id)?.tags[0]] = (a[byId.get(m.id)?.tags[0]] || 0) + 1), a), {});
  const senate = r.movers.filter((m) => /Senate/.test(m.title)).length;
  eq(r.movers.length, 20, 'movers: 20 when enough candidates');
  if (Object.values(cats).some((v) => v > 6)) { console.log('  FAIL movers category cap: ' + JSON.stringify(cats)); process.exitCode = 1; }
  if (senate > 2) { console.log(`  FAIL movers family cap: ${senate} Senate races`); process.exitCode = 1; }
  const ccats = r.closing.reduce((a, s) => ((a[boardCat(s)] = (a[boardCat(s)] || 0) + 1), a), {});
  if (Object.values(ccats).some((v) => v > 3)) { console.log('  FAIL closing category cap: ' + JSON.stringify(ccats)); process.exitCode = 1; }
  for (const d of r.desks) if (d.stories.length > 12) { console.log(`  FAIL desk ${d.id} has ${d.stories.length}`); process.exitCode = 1; }
  console.log(`\n=== ROTATION ===\n  movers mix ${JSON.stringify(cats)}, senate family ${senate}; closing mix ${JSON.stringify(ccats)}; desks ${r.desks.map((d) => `${d.id} ${d.stories.length}`).join(', ')}`);

  // freshness: flat for 6h fades the 24h move to 60%; a move in the last hour restores it
  eq(Math.round(freshness({ change1h: 0, flatMin: 360 }) * 100), 60, 'freshness flat 6h');
  eq(freshness({ change1h: 0.04, flatMin: 0 }), 1, 'freshness moving');
  eq(freshness({ change1h: null, flatMin: null }), 1, 'freshness unknown');
  // a 6-point day that moved 5 points in the last hour outranks a 15-point day that has been flat for 8 hours
  const stale = mk('economy', 'Will Stale Corp IPO in December?', 0.15, { change1h: 0, flatMin: 480, closesAt: null });
  const hot = mk('tech', 'Will Hot Gadget ship in December?', 0.06, { change1h: 0.05, flatMin: 0, closesAt: null });
  const r2 = buildStories([stale, hot], config, { now: NOW });
  eq(r2.stories[0]?.lead?.id, hot.id, 'hot 1h move outranks a stale 24h move');
  const hh = r2.stories.find((s) => s.lead.id === hot.id);
  if (!/in the last hour/.test(`${hh?.headline} ${hh?.dek}`)) { console.log('  FAIL hourly copy: ' + hh?.headline + ' / ' + hh?.dek); process.exitCode = 1; }
  if (/in the last hour/.test(hh?.short || '')) { console.log('  FAIL short headline keeps the hour: ' + hh?.short); process.exitCode = 1; }
  for (const t of [hh?.headline, hh?.dek]) if (/\bwill\b|Bettors|undefined|NaN/i.test(t || '')) { console.log('  FAIL hourly voice: ' + t); process.exitCode = 1; }
  console.log(`  hot: ${hh?.headline} | ${hh?.short} | ${hh?.dek}`);
}

// Breaking: synthesize PNN samples for the lead of the top story and check one alert + cooldown.
resetBreaking();
const lead = out.stories[0].lead;
const nowSec = NOW / 1000;
const hist = new Map([[lead.id, [{ t: nowSec - 1800, p: lead.yesPrice - 0.12 }, { t: nowSec - 600, p: lead.yesPrice - 0.05 }, { t: nowSec - 60, p: lead.yesPrice }]]]);
const fresh = new Map([[lead.id, [{ t: nowSec - 30, p: lead.yesPrice - 0.2 }, { t: nowSec - 10, p: lead.yesPrice }]]]);
const a1 = detectBreaking([lead], (id) => hist.get(id), config, { now: NOW });
const a2 = detectBreaking([lead], (id) => hist.get(id), config, { now: NOW + 60_000 });
resetBreaking();
const a3 = detectBreaking([lead], (id) => fresh.get(id), config, { now: NOW });
console.log('\n=== BREAKING ===');
for (const a of a1) console.log(`  ${a.id}\n  ${a.headline}\n  ${a.line}`);
eq(a1.length, 1, 'breaking fires'); eq(a2.length, 0, 'breaking cooldown'); eq(a3.length, 0, 'breaking needs 5 min span');

// ---------- watchability (2026-11-04): dead content, swings, settling, exchanges, tighter BREAKING ----------
{
  const { swingLine, shapeTitle } = await import('../server/editorial/copy.mjs');
  const { swingOf, airedSet } = await import('../server/editorial/rank.mjs');
  const all6 = [...out.stories, ...(out.desks || []).flatMap((d) => d.stories)];
  const shapes = all6.filter((s) => s.swing).reduce((a, s) => ((a[s.swing.shape] = (a[s.swing.shape] || 0) + 1), a), {});
  const dead = Object.entries(out.stats.dropped).filter(([k]) => k.startsWith('dead:')).reduce((a, [, n]) => a + n, 0);
  console.log(`\n=== WATCHABILITY (samples) === board ${out.stories.length}, swings ${JSON.stringify(shapes)}, settling ${all6.filter((s) => s.settling).length}, agree ${all6.filter((s) => s.agree === 'agree').length}, disagree ${all6.filter((s) => s.agree === 'disagree').length}, dead ${dead}`);
  for (const s of out.stories.filter((x) => x.swing).slice(0, 5)) console.log(`  ${s.swing.title}${s.swing.flipped ? ' FLIPPED' : ''}${s.settling ? ' SETTLING' : ''}: ${s.short} | ${swingLine(s)}`);

  eq(shapeTitle('longshot'), 'LONGSHOTS ON THE MOVE', 'shapeTitle longshot'); eq(shapeTitle('slipping'), 'FAVORITES SLIPPING', 'shapeTitle slipping');
  eq(shapeTitle('swing'), 'BIGGEST SWINGS', 'shapeTitle swing'); eq(shapeTitle(undefined), 'BIGGEST SWINGS', 'shapeTitle default');
  const sw = swingOf({ yesPrice: 0.92, change1d: 0.78 }, 1e6);
  eq(sw.shape, 'longshot', 'swing longshot'); eq(sw.flipped, true, 'swing flipped'); eq(swingLine({ swing: sw }), 'Yesterday 14%, now 92%', 'swingLine');
  eq(swingOf({ yesPrice: 0.40, change1d: -0.30 }, 1e6).shape, 'slipping', 'swing slipping');
  eq(swingOf({ yesPrice: 0.55, change1d: 0.15 }, 1e6).shape, 'swing', 'swing plain');
  eq(swingOf({ yesPrice: 0.55, change1d: 0.15 }, 5_000), null, 'swing needs real volume');
  eq(swingOf({ yesPrice: 0.55, change1d: 0.02 }, 1e6), null, 'no swing on small move');
  const hs = swingOf({ yesPrice: 0.46, change1d: 0.03, change1h: 0.06 }, 50_000);
  eq(hs?.window, '1h', 'hour swing'); eq(swingLine({ swing: hs }), 'An hour ago 40%, now 46%', 'swingLine hour');
  eq(swingLine({}), '', 'swingLine none');

  // synthetic board: dead content, settling, top-6 floor, THIS WEEK non-thin, cross-source agree/disagree
  const H = 36e5;
  const iso = (ms) => new Date(NOW + ms).toISOString();
  const mk = (o) => ({ source: 'kalshi', tags: [], change1w: null, closesAt: iso(60 * 24 * H), volumeTotal: 1e7, liquidity: 1e6, outcome: null, ...o, eventId: o.eventId || o.id, eventTitle: o.eventTitle || o.title });
  const syn = [
    mk({ id: 'ks:RAIN', title: 'Will it rain in Seattle this week?', yesPrice: 0.97, change1d: 0.2, volume24h: 2e5 }),
    mk({ id: 'ks:CPI', title: 'Will CPI rise more than 0.3% in October?', yesPrice: 0.5, change1d: 0.02, volume24h: 12_000, closesAt: iso(6 * H) }),
    mk({ id: 'ks:GOVKS', title: 'Will the Democrat win the Kansas governor race?', yesPrice: 0.99, change1d: 0.01, volume24h: 5e5 }),
    mk({ id: 'ks:GOVKY', title: 'Will the Democrat win the Kentucky governor race?', yesPrice: 0.98, change1d: 0.4, volume24h: 5e5 }),
    mk({ id: 'ks:FED', title: 'Will the Fed cut rates in December?', yesPrice: 0.62, change1d: 0.12, volume24h: 3e5, closesAt: iso(3 * 24 * H) }),
    mk({ id: 'pm:FED', source: 'polymarket', title: 'Will the Fed cut rates in December?', yesPrice: 0.64, change1d: 0.1, volume24h: 2e5 }),
    mk({ id: 'ks:GDP', title: 'Will GDP growth beat 2% in Q3?', yesPrice: 0.40, change1d: -0.05, volume24h: 9e4, closesAt: iso(2 * 24 * H) }),
    mk({ id: 'pm:GDP', source: 'polymarket', title: 'Will GDP growth beat 2% in Q3?', yesPrice: 0.48, change1d: -0.01, volume24h: 3e4 }),
    mk({ id: 'ks:TINY', title: 'Will the Supreme Court hear the tariff case?', yesPrice: 0.5, change1d: 0.2, volume24h: 6_000, closesAt: iso(4 * 24 * H) }),
  ];
  const so = buildStories(syn, config, { now: NOW });
  const ids = (l) => l.map((x) => x.id);
  const board = [...so.stories, ...(so.desks || []).flatMap((d) => d.stories)];
  const has = (id) => board.some((x) => x.id === id || x.sources && so.aliases[id] === x.id);
  const fed = board.find((x) => x.id === 'ks:FED' || x.id === 'pm:FED');
  const gdp = board.find((x) => x.id === 'ks:GDP' || x.id === 'pm:GDP');
  const ky = board.find((x) => x.id === 'ks:GOVKY');
  console.log(`  synthetic: board ${ids(so.stories).join(', ')} | closing ${ids(so.closing).join(', ')} | dropped ${JSON.stringify(so.stats.dropped)}`);
  eq(has('ks:RAIN'), false, 'near-certain weather dropped');
  eq(has('ks:CPI'), false, 'closing <12h under $25K dropped');
  eq(has('ks:GOVKS'), false, 'decided race dropped');
  eq(!!ky?.settling, true, 'settling marked');
  eq(ky?.swing?.shape, 'swing', 'settling swing shape');
  eq(fed?.agree, 'agree', 'exchanges agree'); eq(fed?.exchanges?.length, 2, 'exchanges listed'); eq(fed?.exchanges?.[0]?.source, 'kalshi', 'kalshi first');
  eq(gdp?.agree, 'disagree', 'exchanges disagree');
  eq(so.stories.slice(0, 3).some((x) => x.id === 'ks:TINY') && so.stories.length > 6, false, 'tiny story not top-6 when others exist');
  eq(so.closing.some((x) => x.thin), false, 'THIS WEEK non-thin only');
  for (const s of board) if (s.swing && !/^(BIGGEST SWINGS|LONGSHOTS ON THE MOVE|FAVORITES SLIPPING)$/.test(s.swing.title)) { console.log('  FAIL swing title ' + s.swing.title); process.exitCode = 1; }

  // BREAKING eligibility: on-air story fires; off-air under $250K does not; off-air $250K+ does; brackets never
  resetBreaking();
  const ramp = (m) => [{ t: nowSec - 1800, p: m.yesPrice - 0.15 }, { t: nowSec - 60, p: m.yesPrice }];
  const air = airedSet();
  const fedLead = fed.lead;
  const off = mk({ id: 'ks:OFF', title: 'Will the Senate pass the farm bill this year?', yesPrice: 0.6, change1d: 0.15, volume24h: 1e5 });
  const offBig = mk({ id: 'ks:OFFBIG', title: 'Will the House pass the budget this year?', yesPrice: 0.6, change1d: 0.15, volume24h: 3e5 });
  const margin = mk({ id: 'ks:MARGIN', title: 'Will the Democrat win the Texas Senate race by 12 points or more?', yesPrice: 0.6, change1d: 0.15, volume24h: 9e5 });
  const fired = detectBreaking([fedLead, off, offBig, margin], (id) => ramp([fedLead, off, offBig, margin].find((x) => x.id === id)), config, { now: NOW, aired: air });
  const fid = new Set(fired.map((a) => a.marketId));
  eq(fid.has(fedLead.id), true, 'breaking: on-air story fires'); eq(fid.has('ks:OFF'), false, 'breaking: off-air <$250K skipped');
  eq(fid.has('ks:OFFBIG'), true, 'breaking: $250K+ fires'); eq(fid.has('ks:MARGIN'), false, 'breaking: margin bracket skipped');
  for (const a of fired) if (a.headline.length > 80 || /[“”]/.test(a.headline)) { console.log('  FAIL alert headline ' + a.headline); process.exitCode = 1; }
  resetBreaking();
}

// ---------- question-titled events and "this week" placement (2026-11-05) ----------
{
  const mk = (o) => ({ id: 'cp:' + (o.outcome || o.title), source: 'polymarket', yesPrice: 0.94, change1d: 0, change1w: null, volume24h: 50000, ...o });
  const hdl = (m, kind = 'mover') => { const h = storyHeadline({ lead: m, kind }); return [h, shortHeadline(h)]; };
  const bad = (label, str) => {
    if (/\b(Where|Who|Which|When|What) (will|has|is)\b/i.test(str) || /\bwill\b/i.test(str) || / x [A-Z]/.test(str)) { console.log(`  FAIL ${label}: raw question/will/x in "${str}"`); process.exitCode = 1; }
  };
  const subjWeek = (label, str) => {
    // "this week" may only appear inside a move phrase ("up 24 points this week") or a settle window, never right after a name/race
    if (/\b(race|next PM|prime minister|James Bond|Company[^,:]*|2026) this week\b/i.test(str)) { console.log(`  FAIL ${label}: glued "this week" in "${str}"`); process.exitCode = 1; }
  };
  const talks = { eventTitle: 'Where will next Russia x Ukraine peace talks take place this week?', title: 'Will the next Russia x Ukraine peace talks take place in UAE this week?', outcome: 'UAE' };
  for (const [tag, extra] of [['still', {}], ['day', { change1d: 0.1 }], ['week', { change1w: 0.2 }]]) {
    for (const [i, str] of hdl(mk({ ...talks, ...extra })).entries()) { bad(`where-${tag}-${i}`, str); eq(/UAE/.test(str) && /host/.test(str), true, `where ${tag} ${i} names UAE as host: "${str}"`); }
  }
  eq(marketLabel(mk(talks)), 'UAE to host the next Russia-Ukraine peace talks this week', 'where label');
  eq(hdl(mk({ ...talks, change1d: 0.1 }))[1].includes('Russia-Ukraine'), true, 'where short keeps the topic');
  for (const m of [
    mk({ eventTitle: 'Next James Bond actor', title: 'Will Callum Turner be the next James Bond?', outcome: 'Callum Turner', yesPrice: 0.3, change1w: 0.2 }),
    mk({ eventTitle: 'Prime Minister of Israel after the next election?', title: 'Will Gadi Eizenkot be the next PM', outcome: 'Gadi Eizenkot', yesPrice: 0.56, change1w: 0.24 }),
    mk({ eventTitle: '2nd Largest Company end of Dec 2026?', title: 'Will NVIDIA be the 2nd largest company end of Dec 2026?', outcome: 'NVIDIA', yesPrice: 0.5, change1w: 0.2 }),
    mk({ eventTitle: 'Largest Company end of November 2026?', title: 'Will Apple be the largest company end of Nov 2026?', outcome: 'Apple', yesPrice: 0.5, change1w: 0.2 }),
    mk({ eventTitle: 'Who will win the Nobel Peace Prize?', title: 'Foo Bar', outcome: 'Foo Bar', yesPrice: 0.6, change1w: 0.2 }),
    mk({ eventTitle: 'Which country will host the 2030 Olympics?', title: 'France', outcome: 'France', yesPrice: 0.6, change1d: 0.2 }),
  ]) {
    for (const [i, str] of hdl(m).entries()) { bad(`q-${m.outcome}-${i}`, str); subjWeek(`wk-${m.outcome}-${i}`, str); }
  }
  const eiz = hdl(mk({ eventTitle: 'Prime Minister of Israel after the next election?', title: 'Will Gadi Eizenkot be the next PM', outcome: 'Gadi Eizenkot', yesPrice: 0.56, change1w: 0.24 }))[0];
  eq(/up 24 points this week/.test(eiz), true, `week move reads as a move phrase: "${eiz}"`);
  eq(/year end/.test(hdl(mk({ eventTitle: 'Largest Company end of November 2026?', title: 'Will Apple be the largest company end of Nov 2026?', outcome: 'Apple', yesPrice: 0.5, change1w: 0.2 }))[0]), false, 'November is not year end');
  eq(marketLabel(mk({ eventTitle: 'Who will win the Nobel Peace Prize?', title: 'Foo Bar', outcome: 'Foo Bar' })), 'Foo Bar to win the Nobel Peace Prize', 'who label');
}

// ---------- news gate: every aired story carries a matching headline (2026-11-05 news-driven PNN) ----------
{
  const { createNewsdesk } = await import('../server/newsdesk.mjs');
  const { matchStoryNews, buildHeadlineIndex } = await import('../server/editorial/match.mjs');
  const H = 3_600_000;
  const at = (h) => new Date(NOW - h * H).toISOString();
  const mk = (o) => ({ source: 'kalshi', tags: [], change1w: null, closesAt: new Date(NOW + 40 * 24 * H).toISOString(), volumeTotal: 1e7, liquidity: 1e6,
    outcome: null, updatedAt: new Date(NOW).toISOString(), ...o, eventId: o.eventId || o.id, eventTitle: o.eventTitle || o.title });
  const mkts = [
    mk({ id: 'ks:FEDDEC', title: 'Will the Fed hike rates at the December FOMC meeting?', yesPrice: 0.62, change1d: 0.08, volume24h: 2e6 }),
    mk({ id: 'ks:OPENAIIPO', title: 'Will OpenAI announce an IPO before 2027?', yesPrice: 0.31, change1d: 0.06, volume24h: 4e5 }),
    mk({ id: 'ks:NONEWS', title: 'Will Zorblaxian tariffs on widgets exceed 40% in 2026?', yesPrice: 0.45, change1d: 0.09, volume24h: 9e5 }),
    mk({ id: 'ks:QUIET', title: 'Will Quuxland adopt a four-day work week in 2026?', yesPrice: 0.35, change1d: 0.02, volume24h: 6e5 }),
  ];
  const archive = [
    { title: 'Fed signals December rate hike as Powell warns on inflation', outlet: 'Reuters', publishedAt: at(1), category: 'economy', url: 'https://x/1' },
    { title: 'Powell: Fed ready to raise rates in December if inflation persists', outlet: 'CNBC', publishedAt: at(3), category: 'economy', url: 'https://x/2' },
    { title: 'OpenAI weighs IPO as Altman eyes trillion-dollar valuation', outlet: 'Bloomberg', publishedAt: at(5), category: 'tech', url: 'https://x/3' },
    { title: 'Taylor Swift announces new stadium dates', outlet: 'Variety', publishedAt: at(2), category: 'culture', url: 'https://x/4' },
    { title: 'Thunder rout Lakers as Gilgeous-Alexander scores 41', outlet: 'ESPN', publishedAt: at(2), category: 'sports', url: 'https://x/5' },
    { title: 'Thunder storms expected across the Plains', outlet: 'NWS', publishedAt: at(2), category: 'weather', url: 'https://x/6' },
  ];
  const nd = createNewsdesk({ getArchive: () => archive, getMarkets: () => mkts });
  const out = buildStories(mkts, config, { now: NOW, enrich: { newsLookup: (s) => nd.lookup(s, NOW) } });
  const aired = new Set([...out.stories, ...out.desks.flatMap((d) => d.stories), ...out.closing].map((s) => s.id));
  eq(aired.has('ks:FEDDEC'), true, 'news gate: Fed story with Fed headlines airs');
  eq(aired.has('ks:QUIET'), false, 'news gate: story without a headline (and no big move) does not air');
  eq(out.pending.some((s) => s.id === 'ks:QUIET'), true, 'news gate: newsless story waits in pending');
  // a 9-point move on $900K with no headline is MARKETS MOVING FIRST (PLAN-news-gate section 5): airs labelled, stays in the search queue
  const nonews = [...out.stories, ...out.desks.flatMap((d) => d.stories)].find((s) => s.id === 'ks:NONEWS');
  eq(nonews?.newsTier, 'none-moving-first', 'moving first: big newsless move airs as moving-first');
  eq(nonews?.movingFirst?.line, 'No headline yet · up 9 points today on $900K traded', 'moving first: copy line');
  eq(out.stories[0]?.newsTier === 'none-moving-first', false, 'moving first: never #1');
  eq(out.pending.some((s) => s.id === 'ks:NONEWS'), true, 'moving first: still searched (pending)');
  const fed = out.stories.find((s) => s.id === 'ks:FEDDEC');
  eq(/Fed/.test(fed?.news?.[0]?.title || ''), true, `news gate: Fed news[0] is a Fed headline ("${fed?.news?.[0]?.title}")`);
  eq(fed?.news?.[0]?.via, 'wire', 'news gate: wire headline preferred');
  eq(fed?.newsTier, 'exact', 'news gate: matched story is exact tier');
  eq(fed?.news?.some((n) => /Swift|Thunder/.test(n.title)), false, 'news gate: no unrelated headline attached');
  const mfOk = (x) => x.newsTier === 'none-moving-first' && x.movingFirst?.line;
  for (const s of [...out.stories, ...out.closing]) if (!s.news?.length && !mfOk(s)) { console.log(`  FAIL news gate: ${s.id} aired without news`); process.exitCode = 1; }
  for (const m of out.movers) if (!m.news?.length && !mfOk(m)) { console.log(`  FAIL news gate: mover ${m.id} without news`); process.exitCode = 1; }
  eq(fed.newsScore > 1, true, `news gate: fresh multi-outlet coverage boosts (factor ${fed.newsScore})`);
  const ungated = buildStories(mkts, config, { now: NOW });
  eq(ungated.stories.some((s) => s.id === 'ks:NONEWS'), true, 'news gate: off without enrich.newsLookup');
  // sports entity matching: a sports-feed headline naming an outcome matches; a weather "thunder" headline never does
  const nba = { id: 'ks:KXNBA-27', category: 'sports', eventTitle: '2027 Pro Basketball Champion',
    lead: mk({ id: 'ks:NBA-OKC', eventId: 'ks:KXNBA-27', eventTitle: '2027 Pro Basketball Champion', title: 'Will Oklahoma City win the 2027 Pro Basketball Finals?', outcome: 'Oklahoma City Thunder', yesPrice: 0.3, change1d: 0.02, volume24h: 3e5 }),
    markets: [] };
  nba.markets = [nba.lead];
  const hits = matchStoryNews(nba, buildHeadlineIndex(archive), mkts, { now: NOW, entity: true });
  eq(hits.length, 1, `sports entity match: one headline (${hits.map((h) => h.item.title).join(' | ')})`);
  eq(hits[0]?.item?.outlet, 'ESPN', 'sports entity match: the ESPN headline, not the weather one');
  // strictness: a shared frame word never matches; the subject has to be in the headline
  const strictArch = [
    { title: 'Cristiano Ronaldo announces international retirement', outlet: 'Sky Sports', publishedAt: at(1), category: 'sports', url: 'https://y/1' },
    { title: "World's largest olive oil company plummets 18% after rivals agree to takeover deal", outlet: 'CNBC', publishedAt: at(1), category: 'economy', url: 'https://y/2' },
    { title: 'Samuel Alito weighs retirement as conservatives urge him to step down', outlet: 'Politico', publishedAt: at(2), category: 'politics', url: 'https://y/3' },
    { title: 'Nvidia overtakes Apple as the largest company in the world', outlet: 'Reuters', publishedAt: at(3), category: 'economy', url: 'https://y/4' },
  ];
  const alito = { id: 'pm:alito', category: 'courts', eventTitle: 'Will Samuel Alito announce his retirement by...?',
    lead: mk({ id: 'pm:alito1', eventId: 'pm:alito', eventTitle: 'Will Samuel Alito announce his retirement by...?', title: 'Will Samuel Alito announce his retirement by December 31?', outcome: 'December 31', yesPrice: 0.2, change1d: 0.05, volume24h: 2e5 }), markets: [] };
  alito.markets = [alito.lead];
  const big = { id: 'pm:big', category: 'economy', eventTitle: 'Largest Company end of December 2026?', markets: ['Apple', 'NVIDIA', 'Microsoft'].map((o, i) =>
    mk({ id: `pm:big${i}`, eventId: 'pm:big', eventTitle: 'Largest Company end of December 2026?', title: `Will ${o} be the largest company in the world by market cap on December 31?`, outcome: o, yesPrice: 0.5 - i * 0.2, change1d: 0.03, volume24h: 3e5 })) };
  big.lead = big.markets[0];
  const sIdx = buildHeadlineIndex(strictArch);
  const idxM = [...mkts, alito.lead, ...big.markets];
  const aHits = matchStoryNews(alito, sIdx, idxM, { now: NOW }).map((h) => h.item.outlet);
  eq(aHits.join(','), 'Politico', `strict: Alito story takes the Alito headline only (${aHits})`);
  const bHits = matchStoryNews(big, sIdx, idxM, { now: NOW }).map((h) => h.item.outlet);
  eq(bHits.join(','), 'Reuters', `strict: largest-company story ignores "largest olive oil company" (${bHits})`);
  const stale = createNewsdesk({ getArchive: () => archive.map((a) => ({ ...a, publishedAt: at(30) })), getMarkets: () => mkts }).lookup(nba, NOW);
  eq(stale.wire24, false, 'sports gate: a 30h-old headline is not enough to air');
  // board cap: <= 4 sports + games stories, SPORTS & GAMES desk <= 8 (only when filter.mjs files these as sports)
  // (news gate build: caps 4/8 with a 3.3 match-score floor; the headlines here are stubbed at score 4.5 so only the caps act)
  const teams = ['Celtics', 'Knicks', 'Nuggets', 'Bucks', 'Warriors', 'Spurs', 'Rockets', 'Pacers'];
  const sm = teams.map((t, i) => mk({ id: `pm:sp${i}`, source: 'polymarket', eventId: `pm:spev${i}`, eventTitle: `NBA: 2027 Champion (${t})`, outcome: t, title: `Will the ${t} win the 2027 NBA Finals?`,
    tags: ['sports', 'nba', 'nba-finals'], yesPrice: 0.2 + i * 0.02, change1d: 0.06, volume24h: 5e5 }));
  const sArch = [...archive, ...teams.map((t, i) => ({ title: `${t} win again as playoff race tightens in NBA`, outlet: 'ESPN', publishedAt: at(1 + i * 0.1), category: 'sports', url: `https://s/${i}` }))];
  const all = [...mkts, ...sm];
  const nd2 = createNewsdesk({ getArchive: () => sArch, getMarkets: () => all });
  const sgStub = (s) => {
    const k = teams.findIndex((t) => (s.eventTitle || '').includes(t));
    if (k < 0) return nd2.lookup(s, NOW);
    // two teams share one headline: the board takes only one of them
    const title = k === 1 ? `${teams[0]} win again as playoff race tightens in NBA` : `${teams[k]} win again as playoff race tightens in NBA`;
    return { items: [{ title, outlet: 'ESPN', source: 'ESPN', publishedAt: at(1 + k * 0.1), via: 'wire', score: 4.5 }], outlets24: 1, freshH: 1 + k * 0.1, wire24: true };
  };
  const o2 = buildStories(all, config, { now: NOW, enrich: { newsLookup: sgStub } });
  const sg = (l) => l.filter((s) => ['sports', 'games', 'esports'].includes(s.category)).length;
  const desk = o2.desks.find((d) => d.id === 'sports');
  if (o2.stats.kept > mkts.length) {
    eq(sg(o2.stories), 4, `sports cap: ${sg(o2.stories)} sports/games stories on the board (want 4)`);
    eq(['sports', 'games', 'esports'].includes(o2.stories[0]?.category), false, 'sports never lead the board');
    eq(!!desk && desk.stories.length <= 8 && desk.stories.length >= 6 && desk.title === 'SPORTS & GAMES', true, `SPORTS & GAMES desk (${desk?.stories?.length})`);
    const sgHeads = o2.stories.filter((s) => ['sports', 'games', 'esports'].includes(s.category)).map((s) => s.news?.[0]?.title);
    eq(new Set(sgHeads).size, sgHeads.length, 'sports: no two board SG stories share a headline');
    eq(o2.closing.filter((s) => ['sports', 'games', 'esports'].includes(s.category)).length <= 3, true, 'sports: <= 3 in THIS WEEK');
    eq(o2.movers.filter((m) => ['sports', 'games', 'esports'].includes(m.category)).length <= 3, true, 'sports: <= 3 movers');
    // score floor: the same stories at matcher score 3.0 (the measured wrong matches all scored < 3.3) never air
    const weak = buildStories(all, config, { now: NOW, enrich: { newsLookup: (s) => { const r = sgStub(s); return teams.some((t) => (s.eventTitle || '').includes(t)) ? { ...r, items: r.items.map((i) => ({ ...i, score: 3 })) } : r; } } });
    eq(sg([...weak.stories, ...weak.desks.flatMap((d) => d.stories)]), 0, 'sports: score floor 3.3 drops weak matches');
    eq(weak.stats.dropped['news:sg-score'] >= 8, true, `sports: floor counted in news:sg-score (${weak.stats.dropped['news:sg-score']})`);
  } else console.log('  (sports cap test skipped: filter.mjs does not keep NBA futures yet)');
  console.log(`  news gate: board ${out.stories.map((s) => s.id).join(', ')} | pending ${out.pending.map((s) => s.id).join(', ')} | sports board ${sg(o2.stories)}, desk ${desk?.stories?.length ?? 0}`);
}

// ---------- news gate build 2026-11-05 (PLAN-news-gate.md options 4-6, QUEUED-FIXES 16) ----------
{
  const { headlineBlocked, newsFactor, movingFirstOf } = await import('../server/editorial/rank.mjs');
  const { newsQueries, movingFirstLine } = await import('../server/editorial/copy.mjs');
  const H = 3_600_000;
  const at = (h) => new Date(NOW - h * H).toISOString();
  const mk = (o) => ({ source: 'kalshi', tags: ['economics'], change1w: null, closesAt: new Date(NOW + 40 * 24 * H).toISOString(), volumeTotal: 1e7, liquidity: 1e6,
    outcome: null, updatedAt: new Date(NOW).toISOString(), ...o, eventId: o.eventId || o.id, eventTitle: o.eventTitle || o.title });
  // (16) every attached headline passes D4 and is a headline, not a site title
  eq(headlineBlocked('Vladimir Putin, Rezaei meet as Turkey probes deadly Iran border fire', config), 'sensitive', 'headline: "deadly" is D4');
  eq(headlineBlocked('Putin, Rezaei meet as Turkey probes deadly Iran border fire'), 'sensitive', 'headline: D4 fallback without config');
  eq(headlineBlocked('Federal Reserve Board - Home', config), 'junk', 'headline: site title "- Home" is junk');
  eq(headlineBlocked('Calendar', config), 'junk', 'headline: one-word page title is junk');
  eq(headlineBlocked('Missile strikes hit Kyiv overnight', config), 'sensitive', 'headline: war wording');
  eq(headlineBlocked('US-China trade war heats up as new tariffs take effect', config), null, 'headline: "trade war" is not D4');
  eq(headlineBlocked('Arizona Senate race remains a dead heat as counting continues', config), null, 'headline: "dead heat" is not D4');
  eq(headlineBlocked('Fed signals December rate hike as Powell warns on inflation', config), null, 'headline: ordinary headline passes');
  {
    const m = [mk({ id: 'ks:PUTINMEET', title: 'Will Putin meet Pezeshkian in Ankara before 2027?', tags: ['politics'], yesPrice: 0.4, change1d: 0.02, volume24h: 5e5 })];
    const look = () => ({ items: [{ title: 'Vladimir Putin, Rezaei meet as Turkey probes deadly Iran border fire', outlet: 'Reuters', source: 'Reuters', publishedAt: at(1), via: 'wire', score: 9 }], outlets24: 1, freshH: 1, wire24: true });
    const o = buildStories(m, config, { now: NOW, enrich: { newsLookup: look } });
    const on = [...o.stories, ...o.desks.flatMap((d) => d.stories)].find((s) => s.id === 'ks:PUTINMEET');
    eq(!!on?.news?.some((n) => /deadly/.test(n.title)), false, 'headline: a D4 headline never rides along');
    eq(o.stats.news.headlinesBlocked?.sensitive, 1, 'headline: blocked count in stats.news');
  }
  // (4) freshness weights: steeper tail, event tier x 0.9
  const nf = (h, tier) => Math.round(newsFactor({ items: [{ tier }], freshH: h, outlets24: 1 }) * 1000) / 1000;
  eq([2, 6, 12, 24, 48, 72, 96, 120].map((h) => nf(h)).join(','), '1.35,1.2,1.1,1,0.85,0.7,0.55,0.4', 'newsFactor freshness tiers');
  eq(nf(24, 'event'), 0.9, 'newsFactor: event tier x 0.9');
  // newsQueries: lead query first, event phrase second for a multi-outcome story, deduped
  {
    const ms = ['Josh O\'Connor', 'Callum Turner', 'Jacob Elordi'].map((o, i) => mk({ id: `pm:bond${i}`, eventId: 'pm:bond', source: 'polymarket', eventTitle: 'Next James Bond actor?', title: `Will ${o} be the next James Bond?`, outcome: o, yesPrice: 0.3 - i * 0.05, change1d: 0.01 }));
    const qs = newsQueries({ lead: ms[0], markets: ms, eventTitle: 'Next James Bond actor?' });
    eq(qs.length, 2, `newsQueries: two queries (${qs.join(' | ')})`);
    eq(/James Bond/.test(qs[1] || '') && !/O'Connor/.test(qs[1] || ''), true, `newsQueries: event phrase second ("${qs[1]}")`);
    eq(newsQueries({ lead: mk({ id: 'ks:one', title: 'Will the Fed hike in December?' }), markets: [] }).length, 1, 'newsQueries: single question has one query');
  }
  // (5) MARKETS MOVING FIRST: guards
  const mfOf = (o, extra = {}) => { const lead = mk(o); const st = { id: lead.eventId, category: extra.category || 'economy', eventTitle: lead.eventTitle, lead, markets: [lead], closesAt: lead.closesAt, ...extra };
    Object.defineProperty(st, '_evVol', { value: lead.volume24h, enumerable: false }); return movingFirstOf(st, NOW, config); };
  eq(!!mfOf({ id: 'ks:A', title: 'Will US gas average above $3.50 this week?', yesPrice: 0.6, change1d: -0.23, volume24h: 6.2e4 }), true, 'moving first: a 23-point move on $62K qualifies');
  eq(mfOf({ id: 'ks:B', title: 'Will Texas turnout exceed 60%?', yesPrice: 0.03, change1d: -0.84, volume24h: 2e5 }), null, 'moving first: settled bracket at 3% (-84) excluded');
  eq(mfOf({ id: 'ks:C', title: 'Will the FL-24 winner get over 70%?', yesPrice: 0.99, change1d: 0.84, volume24h: 2e5 }), null, 'moving first: settled bracket at 99% (+84) excluded');
  eq(mfOf({ id: 'ks:C2', title: 'Will widgets ship 10M units in 2027?', yesPrice: 0.5, change1d: 0.48, volume24h: 2e5 }), null, 'moving first: prior price 2% (outside band) excluded');
  eq(mfOf({ id: 'ks:D', title: 'Will Iran and the US sign a nuclear deal in 2026?', yesPrice: 0.3, change1d: 0.1, volume24h: 2e5 }, { category: 'politics' }), null, 'moving first: conflict wording excluded');
  eq(mfOf({ id: 'ks:E', title: 'Will the Pope visit Lebanon in 2027?', yesPrice: 0.3, change1d: 0.1, volume24h: 2e5 }, { category: 'geopolitics' }), null, 'moving first: geopolitics excluded');
  eq(mfOf({ id: 'ks:F', title: 'Will the Celtics win the 2027 NBA Finals?', yesPrice: 0.3, change1d: 0.1, volume24h: 2e5 }, { category: 'sports' }), null, 'moving first: sports excluded');
  eq(mfOf({ id: 'ks:G', title: 'Will the Senate pass the widget bill?', yesPrice: 0.3, change1d: 0.1, volume24h: 2e5, closesAt: new Date(NOW + 3 * H).toISOString() }), null, 'moving first: closing within 6h excluded');
  eq(mfOf({ id: 'ks:H', title: 'Will Trump insult Paxton by November 30?', yesPrice: 0.1, change1d: -0.06, volume24h: 2e5 }), null, 'moving first: deadline decay excluded');
  eq(mfOf({ id: 'ks:I', title: 'Will widgets cost $5 in 2027?', yesPrice: 0.98, change1d: 0.12, volume24h: 2e5 }), null, 'moving first: near-certain excluded');
  eq(mfOf({ id: 'ks:J', title: 'Will widgets cost $5 in 2027?', yesPrice: 0.5, change1d: 0.03, volume24h: 2e5 }), null, 'moving first: 3 points is not enough');
  eq(mfOf({ id: 'ks:K', title: 'Will widgets cost $5 in 2027?', yesPrice: 0.5, change1d: 0.06, volume24h: 8e3 }), null, 'moving first: under $10K excluded');
  const strong = mfOf({ id: 'ks:L', title: 'Will widgets cost $5 in 2027?', yesPrice: 0.5, change1d: 0.09, volume24h: 4.2e4 });
  eq(`${strong?.strong}|${strong?.since}|${strong?.points}`, 'true|today|0.09', 'moving first: strong tier at 9 pts / $42K');
  eq(movingFirstLine({ movingFirst: strong }), 'No headline yet · up 9 points today on $42K traded', 'moving first: line');
  eq(movingFirstLine({ movingFirst: { points: -0.06, volume24h: 15000, since: 'past hour' } }), 'No headline yet · down 6 points in the past hour on $15K traded', 'moving first: past-hour line');
  for (const t of [movingFirstLine({ movingFirst: strong })]) if (/\bwill\b|bettors|because|after /i.test(t)) { console.log(`  FAIL moving first copy implies a cause/prediction: ${t}`); process.exitCode = 1; }
  // (5) caps: 12 newsless movers + 40 stories with news across categories
  {
    const cats = [['economics', 'economy'], ['politics', 'politics'], ['science and technology', 'tech'], ['entertainment', 'culture'], ['health', 'health']];
    const news = [], mfs = [];
    for (let i = 0; i < 40; i++) { const [tag] = cats[i % 5]; news.push(mk({ id: `ks:N${i}`, tags: [tag], title: `Will widget index ${i} rise above ${100 + i} in 2027?`, yesPrice: 0.3 + (i % 5) * 0.08, change1d: 0.03 + (i % 4) * 0.01, volume24h: 3e5 - i * 4e3 })); }
    for (let i = 0; i < 12; i++) { const [tag] = cats[i % 5]; mfs.push(mk({ id: `ks:M${i}`, tags: [tag], title: `Will gizmo maker ${i} file for an IPO in 2027?`, yesPrice: 0.4, change1d: 0.12 + i * 0.01, volume24h: 2e6 })); }
    const look = (s) => (/^ks:N/.test(s.id) ? { items: [{ title: `Widget index ${s.id} climbs on strong demand data`, outlet: 'Reuters', source: 'Reuters', publishedAt: at(2), via: 'wire', score: 8, tier: 'exact' }], outlets24: 1, freshH: 2, wire24: true } : { items: [], outlets24: 0, freshH: null, wire24: false });
    const o = buildStories([...news, ...mfs], config, { now: NOW, enrich: { newsLookup: look } });
    const isMF = (s) => s?.newsTier === 'none-moving-first';
    eq(isMF(o.stories[0]), false, 'moving first caps: never #1 even when the newsless moves are the biggest');
    eq(o.stories.slice(0, 6).filter(isMF).length <= 1, true, `moving first caps: <= 1 in the top 6 (${o.stories.slice(0, 6).filter(isMF).length})`);
    eq(o.stories.filter(isMF).length, 4, `moving first caps: 4 on the board (${o.stories.filter(isMF).length})`);
    for (const d of o.desks) if (d.stories.filter(isMF).length > 2) { console.log(`  FAIL moving first caps: ${d.id} desk has ${d.stories.filter(isMF).length}`); process.exitCode = 1; }
    eq(o.closing.filter(isMF).length <= 1, true, 'moving first caps: <= 1 in THIS WEEK');
    eq(o.movers.filter(isMF).length <= 3, true, `moving first caps: <= 3 movers (${o.movers.filter(isMF).length})`);
    const onAir = new Set([...o.stories, ...o.desks.flatMap((d) => d.stories)]);
    eq([...onAir].filter(isMF).length <= Math.max(1, Math.floor(0.15 * onAir.size)), true, `moving first caps: share <= 15% (${[...onAir].filter(isMF).length}/${onAir.size})`);
    eq(o.stats.dropped['news:moving-first-capped'] > 0, true, `moving first caps: overflow counted (${o.stats.dropped['news:moving-first-capped']})`);
    eq(mfs.every((m) => o.pending.some((s) => s.id === m.id)), true, 'moving first: every candidate stays in the search queue');
    for (const s of onAir) if (isMF(s) && (s.news?.length || !/^No headline yet · up \d+ points today on \$\d+(\.\d)?[KM]? traded$/.test(s.movingFirst?.line || ''))) { console.log(`  FAIL moving first: ${s.id} line "${s.movingFirst?.line}"`); process.exitCode = 1; }
    // (6) the four baseline wrong sports matches never air (match-score floor 3.3 or the matcher itself)
    {
      const { createNewsdesk } = await import('../server/newsdesk.mjs');
      // multi-outcome events as they trade (one market per outcome), real headlines from the 2026-11-05 archive
      const sp = (id, ev, outs, t, tags) => outs.map((o, i) => mk({ id: `${id}${i}`, eventId: `${id}-ev`, source: 'polymarket', eventTitle: ev, outcome: o, title: t.replace('{o}', o), tags,
        yesPrice: 0.3 - i * 0.05, change1d: i ? 0.01 : 0.06, volume24h: 4e5 }));
      const sm = [
        ...sp('pm:barca', 'La Liga Winner', ['Barcelona', 'Real Madrid', 'Atletico Madrid'], 'Will {o} win La Liga?', ['sports', 'soccer', 'la-liga']),
        ...sp('pm:faker', 'LoL Worlds 2026: Finals MVP', ['Faker', 'Chovy', 'Keria'], 'Will {o} be the LoL Worlds 2026 Finals MVP?', ['esports', 'league-of-legends']),
        ...sp('pm:messi', 'MLS: 2026 MVP', ['Lionel Messi', 'Sam Surridge', 'Anders Dreyer'], 'Will {o} win the 2026 MLS MVP?', ['sports', 'soccer', 'mls']),
        ...sp('pm:giants', 'NFC Champion', ['New York Giants', 'Philadelphia Eagles', 'Detroit Lions'], 'Will the {o} win the NFC Championship?', ['sports', 'nfl']),
      ];
      const arch = [
        { title: 'Champions League: team of the week, no Barça or Real Madrid', outlet: 'Yahoo Sports', publishedAt: at(2), category: 'sports', url: 'https://w/1' },
        { title: '“William Contreras Doesn’t Trust a Lot of People” – Brewers Manager Shares Insight on 2026 World Series MVP’s Tough Nature', outlet: 'Yahoo Sports', publishedAt: at(2), category: 'sports', url: 'https://w/2' },
        { title: 'Cristiano Ronaldo vs. Lionel Messi by the numbers', outlet: 'Yahoo Sports', publishedAt: at(2), category: 'sports', url: 'https://w/3' },
        { title: 'New Rumor Suggests NY Giants Being Forced To Wait on Jonathan Taylor Trade Until Specific Date', outlet: 'Yahoo Sports', publishedAt: at(2), category: 'sports', url: 'https://w/4' },
      ];
      const ndw = createNewsdesk({ getArchive: () => arch, getMarkets: () => sm });
      const ow = buildStories(sm, config, { now: NOW, enrich: { newsLookup: (s) => ndw.lookup(s, NOW) } });
      const onw = [...ow.stories, ...ow.desks.flatMap((d) => d.stories), ...ow.closing].map((s) => `${s.id} <- ${s.news?.[0]?.title} (${s.news?.[0]?.score})`);
      eq(onw.length, 0, `sports: baseline wrong matches stay off air (${onw.join(' | ')})`);
    }
    // flips to exact once a headline arrives
    const look2 = (s) => (s.id === 'ks:M11' ? { items: [{ title: 'Gizmo maker 11 files confidentially for IPO', outlet: 'Bloomberg', source: 'Bloomberg', publishedAt: at(1), via: 'search', score: 9 }], outlets24: 1, freshH: 1, wire24: false } : look(s));
    const o2 = buildStories([...news, ...mfs], config, { now: NOW, enrich: { newsLookup: look2 } });
    const m11 = [...o2.stories, ...o2.desks.flatMap((d) => d.stories)].find((s) => s.id === 'ks:M11');
    eq(`${m11?.newsTier}|${m11?.movingFirst}`, 'exact|null', 'moving first: flips to exact when a headline arrives');
    // (4) top 6 prefers a fresher story of the same category over one whose news is > 48h old
    const look3 = (s) => { const r = look(s); if (s.id === 'ks:N0') return { ...r, items: [{ ...r.items[0], publishedAt: at(60) }], freshH: 60 }; return r; };
    const o3 = buildStories(news, config, { now: NOW, enrich: { newsLookup: look3 } });
    eq(o3.stories.slice(0, 6).some((s) => s.id === 'ks:N0'), false, 'top 6: a 60h-old headline yields to fresher same-category news');
  }
}

// Polish queue 2026-11-05: ladder rung wording, raw-question leftovers, photo-count novelty, swing = card.
{
  const { moverName, outcomeLabel, marketLine } = await import('../server/editorial/copy.mjs');
  const { classify } = await import('../server/editorial/filter.mjs');
  const { swingOf } = await import('../server/editorial/rank.mjs');
  const mk = (o) => ({ id: 'ks:x', source: 'kalshi', change1w: null, volume24h: 1e5, closesAt: null, tags: [], ...o });
  // (3) a Kalshi "reach $115.01" rung: no cent artifact, no "in <question>", gerund label for the "<label> slips to 22%" glue
  const wti = mk({ id: 'ks:KXWTIMAX-26DEC31-T115', title: 'Will the maximum WTI front month settle price reach $115.01 by Dec 31, 2026?', outcome: '$115.01 or above',
    eventTitle: 'How high will oil (WTI) get by Dec 31, 2026?', tags: ['kalshi:ladder'], strike: 115, strikeDir: 'above', yesPrice: 0.22, change1d: -0.04 });
  const wh = storyHeadline({ lead: wti, kind: 'mover', markets: [wti] });
  eq(wh, 'WTI oil reaches $115 by Dec 31: 22% chance, down 4 points today', 'wti headline');
  eq(shortHeadline(wh), 'WTI oil hits $115 by Dec 31', 'wti short headline');
  eq(moverName(wti).label, 'WTI oil reaching $115 by Dec 31', 'wti mover label');
  eq(moverName(wti).context, '', 'wti mover context');
  // "How high will unemployment get" with an "Above 8%" rung
  const un = mk({ id: 'ks:KXU3MAX-27-8', title: 'How high will unemployment get before 2027?', outcome: 'Above 8%', eventTitle: 'How high will unemployment get in 2026?', tags: ['kalshi:ladder'], strike: 8, yesPrice: 0.04, change1d: -0.03 });
  eq(outcomeLabel(un), 'Unemployment above 8% before 2027', 'how-high rung label');
  // No raw question or ellipsis ever lands in a mover label/context, a headline or a ticker line
  const RAW = /\b(?:in|:)\s+(?:How|Where|Who|Which|What|When|Will)\b|\?|\.\.\.|…|\bby\? /;
  const samples = [
    mk({ id: 'pm:1', title: 'Gemini Carbon released on November 10?', outcome: 'November 10', eventTitle: 'Gemini Carbon released on...?', yesPrice: 0.23, change1d: -0.33, source: 'polymarket' }),
    mk({ id: 'pm:2', title: 'Houthis capture Taiz city by November 30?', outcome: 'November 30', eventTitle: 'Houthis capture Taiz by...? (castle)', yesPrice: 0.08, change1d: -0.08, source: 'polymarket' }),
    mk({ id: 'pm:3', title: 'Will Pete Hegseth leave Trump\'s Cabinet next?', outcome: 'Pete Hegseth', eventTitle: 'Who will leave Trump\'s Cabinet next?', yesPrice: 0.68, change1d: 0.26, source: 'polymarket' }),
    mk({ id: 'pm:4', title: 'Will the Democrats win 5 House seats in Arizona?', outcome: '5', eventTitle: 'How many House seats will the Democrats win in Arizona?', yesPrice: 0.83, change1d: 0.1, source: 'polymarket' }),
    mk({ id: 'ks:KXPRIMEENGCONSUMPTION-30-OIL', title: 'What will be the largest source of global primary energy consumption in 2030?', outcome: 'Oil', eventTitle: 'What will be the largest source of global primary energy consumption in 2030?', yesPrice: 0.63, change1d: 0.02 }),
    mk({ id: 'pm:6', title: 'Will the Democrats win the Mississippi governor race?', outcome: 'Democratic', eventTitle: 'Mississippi Governor winner? (2027)', yesPrice: 0.38, change1d: -0.05, source: 'polymarket' }),
  ];
  for (const m of samples) {
    const nm = moverName(m);
    const glued = `${nm.label} slips to ${Math.round(m.yesPrice * 100)}%${nm.context ? ' in ' + nm.context : ''}`;
    const lines = [glued, storyHeadline({ lead: m, kind: 'mover', markets: [m] }), shortHeadline(storyHeadline({ lead: m, kind: 'mover', markets: [m] })), marketLine(m)];
    for (const t of lines) if (RAW.test(t)) { console.log('  FAIL raw question leftover: ' + t); process.exitCode = 1; }
  }
  eq(moverName(samples[0]).label, 'Gemini Carbon is released on November 10', 'date outcome says the whole clause');
  eq(moverName(samples[2]).context, '', 'question event is folded into the label');
  eq(outcomeLabel(samples[4]) !== '' && /Oil is the largest source/.test(storyHeadline({ lead: samples[4], kind: 'mover', markets: [samples[4]] })), true, 'what-will-be + outcome -> statement');
  // (4) photo-count series is novelty; an outcome-less wh-question cannot be said as a probability
  const photo = mk({ id: 'ks:KXTRUMPPHOTO-26NOV08-2-4', title: 'Will the number of distinct days with a Getty Images editorial photo of Trump be exactly 4 between Nov 2, 2026 and Nov 8, 2026?', outcome: '4',
    eventTitle: 'How many days will Trump be photographed this week? (11/2-11/8)', tags: ['politics', 'recurring', 'freq:weekly'], yesPrice: 0.4, change1d: 0.18, volume24h: 1470 });
  const cf = classify(photo, config, { now: NOW });
  eq(`${cf.keep}:${cf.category}`, 'false:novelty', 'Getty photo-count series is novelty');
  const cf2 = classify(photo, {}, { now: NOW });
  eq(`${cf2.keep}:${cf2.category}`, 'false:novelty', 'Getty photo-count series is novelty (builtin, no config)');
  const wq = classify(mk({ id: 'ks:KXIPOOPENAI-27JAN01', title: 'When will OpenAI IPO?', outcome: null, eventTitle: 'When will OpenAI IPO?', tags: ['economics', 'financials'], yesPrice: 0.03 }), config, { now: NOW });
  eq(`${wq.keep}:${wq.reason}`, 'false:unstatable', 'outcome-less wh-question never airs');
  // (6) swing.from/delta/points agree with lead.change1d under the widget arithmetic, including exact-half moves
  let bad = 0;
  for (let to = 3; to <= 97; to++) for (let c = 10; c <= 90; c += 1) for (const sgn of [1, -1]) for (const half of [0, 0.5]) {
    const t = to / 100, ch = sgn * (c + half) / 100, prev = t - ch;
    if (prev < 0 || prev > 1) continue;
    const lead = { yesPrice: t, change1d: t - prev };
    const sw = swingOf(lead, 1e6);
    if (!sw) { if (Math.abs(lead.change1d) >= 0.1) bad++; continue; }   // (a 0.0999999 move is under the 10-point gate)
    const card = Math.sign(lead.change1d) * Math.round(Math.abs(lead.change1d) * 100);
    const widget = Math.sign(sw.to - sw.from) * Math.round(Math.abs(sw.to - sw.from) * 100);
    const cardSw = Math.sign(sw.delta) * Math.round(Math.abs(sw.delta) * 100);
    if (card !== widget || card !== cardSw || card !== sw.points) bad++;
  }
  eq(bad, 0, 'swing from/to/delta/points agree with the card');
}

// ---------- local fallback normalizer (mirrors the contract Market shape) ----------
function localNormalize(evs) {
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const jarr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v); } catch { return []; } };
  const res = [];
  for (const ev of evs) {
    const tags = [...new Set((ev.tags || []).flatMap((t) => [t.label, t.slug]).filter(Boolean).map((s) => s.toLowerCase()))];
    const multi = (ev.markets || []).length > 1;
    for (const m of ev.markets || []) {
      if (m.closed) continue;
      const yes = Number(jarr(m.outcomePrices)[0]);
      if (!Number.isFinite(yes)) continue;
      res.push({
        id: `pm:${m.id}`, source: 'polymarket', title: m.question, outcome: multi ? m.groupItemTitle || null : null,
        eventId: `pm:${ev.id}`, eventTitle: ev.title, category: '', tags, yesPrice: yes,
        change1d: num(m.oneDayPriceChange), change1w: num(m.oneWeekPriceChange), volume24h: num(m.volume24hr) ?? 0,
        volumeTotal: num(m.volumeNum) ?? 0, liquidity: num(m.liquidityNum), closesAt: m.endDate || null,
        url: `https://polymarket.com/event/${ev.slug}`, tokenId: jarr(m.clobTokenIds)[0] || null, updatedAt: new Date(NOW).toISOString(),
      });
    }
  }
  return res;
}

// ---------- time phrases say it once (news gate leftovers 2026-11-05) ----------
{
  const { dedupeTimePhrases: dd } = await import('../server/editorial/copy.mjs');
  eq(dd('Google market share this week above 15.1% this week'), 'Google market share this week above 15.1%', 'dedupe plain repeat');
  eq(dd('Chance Google share this week above 15.1% this week: 52%, up 6 points this week'), 'Chance Google share above 15.1%: 52%, up 6 points this week', 'dedupe keeps the move phrase');
  eq(dd('Gas price today: 52%, up 4 points today'), 'Gas price: 52%, up 4 points today', 'dedupe today');
  eq(dd('Fed holds at 80% chance this week, up 4 points today'), 'Fed holds at 80% chance this week, up 4 points today', 'different phrases untouched');
  const h = storyHeadline({ kind: 'mover', lead: { id: 'x1', source: 'kalshi', title: 'Will Google market share be above 15.1% this week?', eventTitle: 'Google market share this week', yesPrice: 0.52, change1w: 0.1, change1d: 0, volume24h: 50000 } });
  eq((h.match(/this week/gi) || []).length <= 1, true, `storyHeadline repeats no time phrase: "${h}"`);
}

// ---------- moving-first near-duplicates (news gate leftovers 2026-11-05) ----------
{
  const { mfSubjectKey } = await import('../server/editorial/rank.mjs');
  const st = (id, eventTitle) => ({ id, eventTitle, lead: { id, title: eventTitle, tags: [] } });
  eq(mfSubjectKey(st('a', 'Avengers: Doomsday best opening weekend')), mfSubjectKey(st('b', 'Avengers: Doomsday best opening week')), 'moving-first dup: opening weekend and week share a subject key');
  eq(mfSubjectKey(st('a', 'Avengers: Doomsday best opening weekend')) === mfSubjectKey(st('c', 'Supergirl best opening weekend')), false, 'moving-first dup: different films differ');
}

// ---------- variety segments (2026-11-05) ----------
{
  const { buildStories, buildSegments } = await import('../server/editorial/rank.mjs');
  const { segmentLine } = await import('../server/editorial/copy.mjs');
  const mk = (id, over = {}) => ({
    id: `ks:${id}`, source: 'kalshi', title: `Will ${id} announce alpha${id} beta${id} merger?`, outcome: null, eventId: `ks:${id}`, eventTitle: `${id} alpha${id} beta${id} merger`,
    category: '', tags: ['business'], yesPrice: 0.5, change1d: 0, change1w: 0, volume24h: 200_000, volumeTotal: 900_000, liquidity: 50_000,
    closesAt: new Date(NOW + 30 * 864e5).toISOString(), updatedAt: new Date(NOW).toISOString(), ...over,
  });
  const ms = [
    mk('TOSS', { yesPrice: 0.51, change1d: 0.01, change1w: 0.02 }),
    mk('TOSSMOVE', { yesPrice: 0.5, change1d: 0.06, change1w: 0.06 }),
    mk('TOSSTHIN', { yesPrice: 0.5, change1d: 0, volume24h: 3_000 }),
    mk('WEEK', { yesPrice: 0.61, change1d: 0.01, change1w: 0.12 }),
    mk('WEEKTODAY', { yesPrice: 0.7, change1d: 0.09, change1w: 0.2 }),
    mk('QUIET', { yesPrice: 0.82, change1d: 0.005, change1w: 0.01 }),
    mk('QUIETMOVE', { yesPrice: 0.82, change1d: 0.01, change1w: 0.09 }),
    mk('QUIETHIGH', { yesPrice: 0.96, change1d: 0, change1w: 0 }),
    mk('DIS', { yesPrice: 0.41, change1d: 0.0, change1w: 0.0 }),
    { ...mk('DIS'), id: 'pm:DIS', source: 'polymarket', eventId: 'pm:DIS', yesPrice: 0.49, volume24h: 150_000 },
    mk('AGREE', { yesPrice: 0.3 }), { ...mk('AGREE'), id: 'pm:AGREE', source: 'polymarket', eventId: 'pm:AGREE', yesPrice: 0.31 },
  ];
  // gated: every story has a headline except the moving-first-less ones listed below
  const newsLookup = (s) => (/NOHEAD/.test(s.eventTitle) ? { items: [] } : { items: [{ title: `${s.eventTitle} headline`, source: 'Wire', publishedAt: new Date(NOW - 36e5).toISOString(), ageH: 1, score: 5, tier: 'exact' }], wire24: true });
  const out = buildStories([...ms, mk('NOHEADTOSS', { yesPrice: 0.5, change1d: 0.0 })], config, { now: NOW, enrich: { newsLookup } });
  const sg = out.segments || {};
  const idsOf = (a) => (a || []).map((s) => s.id);
  console.log(`\n=== SEGMENTS === ${Object.entries(sg).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  for (const [k, v] of Object.entries(sg)) for (const s of v) console.log(`  ${k}: ${s.segment.line}`);
  eq(Object.keys(sg).join(','), 'tossups,weekSwings,quietFavorites,disagreements', 'segments keys');
  eq(idsOf(sg.tossups).includes('ks:TOSS'), true, 'tossup: 51% steady airs');
  eq(idsOf(sg.tossups).some((i) => /TOSSMOVE|TOSSTHIN|NOHEAD/.test(i)), false, 'tossup: movers, thin, headline-less stay off');
  eq(idsOf(sg.weekSwings).includes('ks:WEEK'), true, 'weekSwing: +12 this week airs');
  eq(idsOf(sg.weekSwings).includes('ks:WEEKTODAY'), false, 'weekSwing: today mover excluded');
  eq(idsOf(sg.quietFavorites).includes('ks:QUIET'), true, 'quiet: 82% steady airs');
  eq(idsOf(sg.quietFavorites).some((i) => /QUIETMOVE|QUIETHIGH/.test(i)), false, 'quiet: week mover and 96% excluded');
  const dis = [...(sg.disagreements || [])].find((s) => /DIS/.test(s.id));
  eq(!!dis, true, 'disagreement: 8 point gap airs');
  eq(/Kalshi 41% vs Polymarket 49%/.test(dis?.segment?.line || ''), true, `disagreement line: ${dis?.segment?.line}`);
  eq(idsOf(sg.disagreements).some((i) => /AGREE/.test(i)), false, 'agreeing exchanges are not a disagreement');
  const all = Object.values(sg).flat();
  eq(new Set(all.map((s) => s.id)).size, all.length, 'segments are disjoint');
  for (const [k, v] of Object.entries(sg)) { eq(v.length <= 8, true, `${k} <= 8`); for (const s of v) if (!s.news?.length && s.newsTier !== 'none-moving-first') eq('no news', 'news', `${k} story carries news or MF`); }
  for (const s of all) if (/\bwill\b|Bettors|undefined|NaN|¢|\bbps\b/i.test(s.segment.line) || !/\d+%/.test(s.segment.line)) { console.log('  FAIL segment line: ' + s.segment.line); process.exitCode = 1; }
  eq(segmentLine('tossups', sg.tossups?.[0]).startsWith('Toss-up: '), true, 'tossup copy');
  eq(/ steady at \d+%$/.test(segmentLine('quietFavorites', sg.quietFavorites?.[0])), true, 'quiet copy');
  eq(/, (up|down) \d+ points this week$/.test(segmentLine('weekSwings', sg.weekSwings?.[0])), true, 'weekSwing copy');
  // family cap: three toss-ups of one family yield one
  const fam = ['A', 'B', 'C'].map((x) => mk(`FAM${x}`, { yesPrice: 0.5, tags: ['elections'], title: `Will Dem win ${x}-0${1} House race?`, eventTitle: `${x}-01 House race` }));
  const o2 = buildSegments(buildStories(fam, config, { now: NOW }).stories, NOW, config, { gated: false });
  eq(o2.tossups.length <= 1, true, `family cap: ${o2.tossups.length} toss-ups from one family`);
  eq(buildStories(ms, config, { now: NOW }).segments.tossups.length >= 1, true, 'segments also build without a news gate');
}
{
  const o = buildStories(markets, config, { now: NOW });
  console.log(`  samples (ungated): ${Object.entries(o.segments).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  for (const s of Object.values(o.segments).flat().slice(0, 6)) console.log(`    ${s.segment.type}: ${s.segment.line}`);
}

// ---- rules text never airs as a ticker / card subject (2026-11-05: "Any member of the Cabinet (defined as: the Vice President, ...")
console.log('\n== rules text in subjects ==');
{
  const { stripRulesText } = await import('../server/editorial/text.mjs');
  const { moverName } = await import('../server/editorial/copy.mjs');
  const { parseKalshiMarkets } = await import('../server/sources/kalshi.mjs');
  const RULES = 'Any member of the Cabinet (defined as: the Vice President, Secretary of State, Secretary of the Treasury, Secretary of Defense, Attorney General)';
  eq(stripRulesText(RULES), 'Any member of the Cabinet', 'strip defined-as parenthetical');
  eq(stripRulesText('Will any member of the Cabinet (defined as: the Vice President, Secretary of State) be impeached?'), 'Will any member of the Cabinet be impeached?', 'strip mid-question');
  eq(stripRulesText('Scott Colom (D)'), 'Scott Colom (D)', 'short party parenthetical stays');
  eq(stripRulesText('Any member of the Cabinet (defined as: the Vice President, Secretary of State, ...'), 'Any member of the Cabinet', 'unclosed rules parenthetical dropped');
  const evs = [{ event_ticker: 'KXIMPEACH', series_ticker: 'KXIMPEACH', title: 'Who will be impeached before 2027?', mutually_exclusive: false,
    markets: [{ ticker: 'KXIMPEACH-CAB', event_ticker: 'KXIMPEACH', title: 'Who will be impeached before 2027?', yes_sub_title: RULES, status: 'active', market_type: 'binary',
      last_price_dollars: '0.38', previous_price_dollars: '0.30', yes_bid_dollars: '0.37', yes_ask_dollars: '0.39', volume_24h_fp: '50000', close_time: '2027-01-01T15:00:00Z' },
    { ticker: 'KXIMPEACH-VP', event_ticker: 'KXIMPEACH', title: 'Who will be impeached before 2027?', yes_sub_title: 'JD Vance', status: 'active', market_type: 'binary',
      last_price_dollars: '0.08', previous_price_dollars: '0.07', yes_bid_dollars: '0.07', yes_ask_dollars: '0.09', volume_24h_fp: '20000', close_time: '2027-01-01T15:00:00Z' }] }];
  const ks = parseKalshiMarkets(evs, {}, new Date(NOW));
  for (const m of ks) {
    const nm = moverName(m);
    const all = `${m.title} ${m.outcome || ''} ${m.eventTitle} ${nm.label} ${nm.context}`;
    eq(/defined as|Vice President|Secretary/.test(all), false, `kalshi subject clean: ${nm.label} | ${m.title}`);
    eq(nm.label.length <= 80, true, `mover label short: ${nm.label}`);
  }
  // a raw over-long label never reaches the ticker: falls back to the story's short title or drops
  const long = { id: 'pm:long', source: 'polymarket', title: 'Will it?', eventId: 'pm:ev-long', eventTitle: 'Cabinet impeachment', outcome: 'X'.repeat(30) + ' ' + 'Y'.repeat(60),
    category: 'politics', tags: ['politics'], yesPrice: 0.4, change1d: 0.1, volume24h: 90000, updatedAt: new Date(NOW).toISOString(), closesAt: '2027-01-01T00:00:00Z' };
  const o = buildStories([long], config, { now: NOW });
  for (const m of o.movers || []) eq((m.label || '').length <= 80, true, `ticker label short: ${m.label}`);
}

// ---- Story of the Day: loose rows must be about the headline's subject (2026-11-05: "Head of DOJ Civil Rights Division resigns
// after GOP midterms loss" pulled in "Republican Eli Crane in AZ-02" and "Greg Murphy NC-03" through "GOP" + "midterms")
console.log('\n== Story of the Day relevance ==');
{
  const { looseStories } = await import('../server/newsroom.mjs');
  const cluster = { id: 'wc:test', title: 'Head of DOJ Civil Rights Division resigns after GOP midterms loss', items: [
    { title: 'Head of DOJ Civil Rights Division resigns after GOP midterms loss', outlet: 'NBC News' },
    { title: 'DOJ civil rights chief resigns days after Republicans lose House in midterms', outlet: 'CBS News' },
    { title: 'Justice Department civil rights head steps down after GOP midterm defeat', outlet: 'AP' },
  ] };
  const story = (id, eventTitle, title, outcome) => ({ id, eventTitle, category: 'elections', lead: { id: `m:${id}`, title, outcome, yesPrice: 0.6, change1d: 0.1 }, markets: [] });
  const pool = [
    story('az02', 'AZ-02 House race', 'Will the Republican win the House race for AZ-02?', 'Eli Crane'),
    story('nc03', 'NC-03 House race', 'Will the Republican win the House race for NC-03?', 'Greg Murphy'),
    story('house', 'Which party wins the House in the 2026 midterms?', 'Will Republicans win the House?', 'Republicans'),
    story('doj', 'Who will leave the DOJ before 2027?', 'Will the head of the DOJ Civil Rights Division resign before 2027?', null),
  ];
  const ids = looseStories(cluster, pool).map((s) => s.id);
  eq(ids.some((x) => ['az02', 'nc03', 'house'].includes(x)), false, `party/midterm words alone do not join: ${ids.join(',')}`);
  eq(ids.includes('doj'), true, `subject story joins: ${ids.join(',')}`);
  const ctxOnly = { id: 'wc:ctx', title: 'GOP midterms loss', items: [{ title: 'GOP midterms loss' }, { title: 'Republicans react to midterm loss' }] };
  eq(looseStories(ctxOnly, pool).length, 0, 'a cluster of context words only has no loose stories');
  // the matcher's rows pass the same subject check (refreshSotd drops rows not about the headline's subject)
  const { clusterKeys, aboutSubject } = await import('../server/newsroom.mjs');
  const { subject } = clusterKeys(cluster);
  eq(pool.filter((st) => aboutSubject(st, subject)).map((st) => st.id).join(','), 'doj', `only the subject story is about the headline: ${subject.join(',')}`);
}
