#!/usr/bin/env node
// Offline check of the editorial engine against the saved Polymarket samples.
// Prints the top headlines/deks/kinds, the drop-reason histogram, rule-violation checks, and a breaking test.
// Usage: node scripts/test-editorial.mjs [--all]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStories, boardCat } from '../server/editorial/rank.mjs';
import { detectBreaking, resetBreaking } from '../server/editorial/breaking.mjs';
import { pct, pts, newsQuery, questionToClause, storyHeadline } from '../server/editorial/copy.mjs';

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
  if (/\bvs\.?\s|bitcoin|tweets|ceasefire|invade|military|champions league/i.test(txt)) problems.push(`noise aired: ${txt}`);
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
