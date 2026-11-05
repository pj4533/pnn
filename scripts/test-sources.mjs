// Self-test for server/sources/*: live fetch once each + offline parse of research/samples.
// If server/http.mjs does not exist yet, the sources are copied to a temp dir next to a tiny fallback http.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let srcDir = path.join(root, 'server/sources');
if (!fs.existsSync(path.join(root, 'server/http.mjs'))) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pnn-src-'));
  fs.mkdirSync(path.join(tmp, 'sources'));
  for (const f of fs.readdirSync(srcDir)) fs.copyFileSync(path.join(srcDir, f), path.join(tmp, 'sources', f));
  fs.writeFileSync(path.join(tmp, 'http.mjs'), `
export class HttpError extends Error { constructor(s, u) { super('HTTP ' + s + ' ' + u); this.status = s; } }
async function go(url, { timeoutMs = 15000 } = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'pnn-test', accept: '*/*' } });
  if (!r.ok) throw new HttpError(r.status, url);
  return r;
}
export const getJSON = async (u, o) => (await go(u, o)).json();
export const getText = async (u, o) => (await go(u, o)).text();
`);
  srcDir = path.join(tmp, 'sources');
  console.log('[fallback http.mjs in use]', tmp);
}
const imp = (f) => import(pathToFileURL(path.join(srcDir, f)).href);
const [pm, ks, news] = await Promise.all([imp('polymarket.mjs'), imp('kalshi.mjs'), imp('news.mjs')]);

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('  FAIL', msg); } };
const show = (ms) => ms.slice(0, 3).forEach((m) => console.log('   ', JSON.stringify({ ...m, title: m.title.slice(0, 70) })));
function validate(ms, label) {
  for (const m of ms) {
    check(/^(pm|ks):/.test(m.id) && m.eventId && m.title && m.url.startsWith('https://'), `${label} shape ${m.id}`);
    check(m.yesPrice >= 0 && m.yesPrice <= 1, `${label} price ${m.id}`);
    check(m.change1d === null || Number.isFinite(m.change1d), `${label} change ${m.id}`);
    check(Number.isFinite(m.volume24h) && Array.isArray(m.tags), `${label} vol/tags ${m.id}`);
  }
}

console.log('== offline samples');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'research/samples', f), 'utf8'));
const pmOff = pm.parsePolymarketEvents(rd('polymarket-events-top20-2026-11-04.json'), new Date());
console.log(' polymarket events sample ->', pmOff.length, 'markets'); show(pmOff); validate(pmOff, 'pm-offline');
check(pmOff.length > 0, 'pm offline nonempty');
const series = rd('kalshi-recurring-series-2026-11-04.json');
const sMap = new Map(series.map((s) => [s.ticker, { category: s.category, tags: s.tags || [] }]));
console.log(' kalshi series sample ->', sMap.size, 'series (no markets in sample; parse a synthetic event)');
const synth = { events: [{ event_ticker: 'KXNOTE30-26NOV', series_ticker: 'KXNOTE30', title: '30Y yield', category: 'Financials', markets: [
  { ticker: 'KXNOTE30-26NOV-T4.95', title: 'Above 4.95%?', yes_sub_title: '4.95%', status: 'active', last_price_dollars: '0.4000', previous_price_dollars: '0.3000', volume_24h_fp: '120.00', volume_fp: '900', close_time: '2026-11-30T00:00:00Z' },
  { ticker: 'KXNOTE30-26NOV-T5', title: 'Above 5%?', yes_sub_title: '5%', status: 'active', last_price_dollars: '0.0000', yes_bid_dollars: '0.10', yes_ask_dollars: '0.20', previous_price_dollars: '0.0000', volume_24h_fp: '5.00' },
  { ticker: 'KXNOTE30-26NOV-T6', title: 'dead', status: 'active', last_price_dollars: '0.5', volume_24h_fp: '0.00' } ] }] };
const kOff = ks.parseKalshiMarkets(synth, sMap, new Date());
show(kOff); validate(kOff, 'ks-offline');
check(kOff.length === 2, 'ks synthetic keeps only volume>0');
check(Math.abs(kOff[0].change1d - 0.1) < 1e-9 && kOff[1].change1d === null && Math.abs(kOff[1].yesPrice - 0.15) < 1e-9, 'ks change/mid fallback');
check(kOff[0].tags.includes('financials') && kOff[0].tags.includes('interest rates') && kOff[0].outcome === '4.95%', 'ks tags/outcome');

// Fresh Kalshi listings have no 24h baseline: previous_price is the listing price (variety pass, 2026-11-04).
const nowT = Date.parse('2026-11-04T18:00:00Z');
const fresh = ks.parseKalshiMarkets({ events: [{ event_ticker: 'KXAAAGASW-26NOV09', series_ticker: 'KXAAAGASW', title: 'Gas', category: 'Economics', mutually_exclusive: true, markets: [
  { ticker: 'F-NEW', title: 'new', status: 'active', last_price_dollars: '0.95', previous_price_dollars: '0.05', volume_24h_fp: '900', open_time: '2026-11-04T10:00:00Z' },
  { ticker: 'F-OLD', title: 'old', status: 'active', last_price_dollars: '0.60', previous_price_dollars: '0.50', volume_24h_fp: '900', open_time: '2026-11-01T10:00:00Z' },
  { ticker: 'F-NOTIME', title: 'no open_time', status: 'active', last_price_dollars: '0.60', previous_price_dollars: '0.50', volume_24h_fp: '900' } ] }] }, {}, new Date(nowT));
check(fresh[0].change1d === null, 'ks fresh listing has no change1d');
check(Math.abs(fresh[1].change1d - 0.1) < 1e-9 && Math.abs(fresh[2].change1d - 0.1) < 1e-9, 'ks old listing keeps change1d');

// Strike ladders (polish pass): one event, grouped, numeric strikes; a shared strike (Where will it rain?) is not a ladder.
{
  const r = (t, k, extra = {}) => ({ ticker: t, title: `Will average gas prices be above $${k}?`, yes_sub_title: `Above ${k}`, strike_type: 'greater', floor_strike: k,
    status: 'active', last_price_dollars: '0.5', previous_price_dollars: '0.4', volume_24h_fp: '2000', open_time: '2026-11-01T10:00:00Z', ...extra });
  const lad = ks.parseKalshiMarkets({ events: [{ event_ticker: 'KXAAAGASW-26NOV09', series_ticker: 'KXAAAGASW', title: 'US gas prices this week', sub_title: 'On Nov 9, 2026',
    mutually_exclusive: false, markets: [r('L1', 4.0), r('L2', 4.02), r('L3', 4.04)] }] }, {}, new Date(nowT));
  check(lad.length === 3 && lad.every((m) => m.tags.includes('kalshi:ladder') && m.eventId === 'ks:KXAAAGASW-26NOV09' && m.outcome), 'ks ladder grouped by event with rung outcomes');
  check(lad[1].strike === 4.02 && lad[1].strikeDir === 'above' && lad[1].eventSub === 'On Nov 9, 2026', 'ks ladder strike/eventSub');
  const rain = ks.parseKalshiMarkets({ events: [{ event_ticker: 'KXRAIN-26NOV04', series_ticker: 'KXRAIN', title: 'Where will it rain on Nov 4, 2026?', mutually_exclusive: false,
    markets: ['NYC', 'CHI', 'AUS'].map((c) => r(c, 0, { title: `Will it rain in ${c} on Nov 4, 2026?`, yes_sub_title: c })) }] }, {}, new Date(nowT));
  check(rain.every((m) => !m.tags.includes('kalshi:ladder') && m.eventId === `ks:${m.id.slice(3)}`), 'ks shared-strike event is not a ladder');
}

// Filter: the variety-pass categories and noise rules.
const { classify } = await import(pathToFileURL(path.join(root, 'server/editorial/filter.mjs')).href);
const config = (await import(pathToFileURL(path.join(root, 'server/config.mjs')).href)).default;
const mk = (title, tags = [], extra = {}) => ({ id: 'pm:t', eventId: 'pm:e', title, eventTitle: title, tags, yesPrice: 0.4, change1d: 0.01, volume24h: 20_000, closesAt: null, ...extra });
const cases = [
  [mk('Bank of Japan Decision in December?', ['boj', 'japan', 'world', 'economy']), true, 'economy'],
  [mk('Measles cases in U.S. in 2026?', ['climate & science', 'weather', 'pandemics']), true, 'health'],
  [mk('Human moon landing in 2026?', ['tech', 'culture', 'science']), true, 'science'],
  [mk('Largest IPO by market cap in 2026?', ['climate & science', 'ipo', 'science', 'business']), true, 'economy'],
  [mk('Oscars 2027: Best Picture Winner', ['movies', 'culture', 'awards']), true, 'culture'],
  [mk('Which company has best AI model end of 2026?', ['ai', 'tech']), true, 'tech'],
  [mk('Will Clarence Thomas announce his retirement by...?', ['courts', 'scotus']), true, 'courts'],
  [mk('1 megaton meteor strike in 2026?', ['science']), true, 'science'],
  [mk('Don Cheadle as James Rhodes / War Machine?', ['movies', 'culture']), true, 'culture'],
  [mk('Oil Price (WTI) on Nov 6, 2026?', ['commodities', 'freq:weekly']), true, 'economy'],
  [mk('S&P price range on Nov 4, 2026 at 4pm EST?', ['financials', 'freq:daily']), true, 'economy'],
  [mk('Highest temperature in NYC on November 4?', ['climate and weather', 'freq:daily']), false],
  [mk('Highest temperature in Warsaw on November 5?', ['weather']), false],
  [mk('Highest temperature in Warsaw on November 5?', ['weather'], { volume24h: 80_000 }), true, 'weather'],
  [mk('Trump approval hourly', ['politics', 'freq:hourly']), false],
  [mk('S&P 500 Daily Up/Down', ['financials', 'freq:daily']), false],
  [mk('# of views of next MrBeast video on week 1?', ['youtube', 'mrbeast']), false],
  [mk('Will Ukraine recapture Crimean territory by...?', ['world', 'geopolitics']), false],
  [mk('Israel x Iran ceasefire continues through December 31?', ['geopolitics']), false],
  [mk('Elon Musk # tweets November 2 - November 9, 2026?', ['pop culture', 'elon tweets']), false],
  [mk('NBA: 2026-27 MVP', ['sports', 'nba', 'awards']), true, 'sports'],   // sports futures air now (news-gated downstream)
  // pool widening: the low daily floor ($200) for non-election markets with a big lifetime volume or liquidity
  [mk('Will OpenAI release GPT-6 in 2026?', ['ai', 'tech'], { volume24h: 300, volumeTotal: 400_000 }), true, 'tech'],
  [mk('Will OpenAI release GPT-6 in 2026?', ['ai', 'tech'], { volume24h: 300, volumeTotal: 4_000 }), false],
  [mk('Will OpenAI release GPT-6 in 2026?', ['ai', 'tech'], { volume24h: 300, volumeTotal: 4_000, liquidity: 60_000 }), true, 'tech'],
  [mk('Will OpenAI release GPT-6 in 2026?', ['ai', 'tech'], { volume24h: 150, volumeTotal: 400_000 }), false],
  [mk('Will OpenAI release GPT-6 in 2026?', ['ai', 'tech'], { volume24h: 300, volumeTotal: 400_000, yesPrice: 0.01 }), false],
  [mk('Will Democrats win the Georgia Senate race?', ['elections'], { volume24h: 300, volumeTotal: 400_000 }), false],
  [mk('Will Trump sign the bill by December?', ['politics'], { volume24h: 300, volumeTotal: 400_000 }), false],
  [mk('Will Trump sign the bill by December?', ['politics'], { volume24h: 1_500, volumeTotal: 400_000 }), true, 'politics'],
  [mk('Highest temperature in Warsaw on November 5?', ['weather'], { volume24h: 300, volumeTotal: 400_000 }), false],       // daily noise stays off
  [mk('S&P 500 Daily Up/Down', ['financials', 'freq:daily'], { volume24h: 300, volumeTotal: 400_000 }), false],
  [mk('Hourly oil', ['commodities', 'freq:hourly'], { volume24h: 300, volumeTotal: 400_000 }), false],
  // ladders air (rank picks the line); vendor-index ladders and crypto price ladders stay off
  [mk('Will average gas prices be above $4.0200?', ['economics', 'freq:weekly', 'kalshi:ladder']), true, 'economy'],
  [mk('Will Kroger Credit Card Spend for October 2026 be above 86 ?', ['financials', 'credit card spend', 'kalshi:ladder']), false],
  [mk('Will Bitcoin be above $120,000 on Nov 7?', ['crypto', 'kalshi:ladder']), false],
  [mk('Will the WTI price be above $90 at 3pm?', ['commodities', 'freq:hourly', 'kalshi:ladder']), false],
];
for (const [m, keep, cat] of cases) {
  const r = classify(m, config);
  check(r.keep === keep && (!cat || r.category === cat), `classify "${m.title}" -> ${JSON.stringify(r)} (want keep=${keep}${cat ? ' ' + cat : ''})`);
}
console.log(' filter cases:', cases.length);

// Sports / video games (2026-11-05): futures, awards, coach/transfer moves, release dates and esports majors air as
// category 'sports' / 'games'; per-game, props, per-map and live in-game markets, crypto/mentions/promo and sensitive stay off.
{
  const sg = (title, tags, keep, category, kind, extra = {}) => ({ m: mk(title, tags, extra), keep, category, kind });
  const T = ['sports', 'games', 'nba'];
  const sgCases = [
    // kept
    sg('NBA: 2027 Champion', T, true, 'sports', 'championship'),
    sg('UEFA Champions League: 2027 Champion', ['sports', 'soccer', 'champions-league'], true, 'sports', 'championship'),
    sg('Pro Football: 2027 Champion', ['sports', 'nfl', 'super-bowl', 'nfl-team-futures'], true, 'sports', 'championship'),
    sg('NBA: 2026-27 MVP', ['sports', 'nba', 'mvp'], true, 'sports', 'award'),
    sg('MLB: NL Rookie of the Year', ['sports', 'mlb', 'rookie'], true, 'sports', 'award'),
    sg('NCAA Football: 2026 Heisman Award Winner', ['sports', 'cfb-awards'], true, 'sports', 'award'),
    sg("Ballon d'Or Winner 2027", ['sports', 'soccer', 'ballon-dor'], true, 'sports', 'award'),
    sg('Michael Carrick out as Manchester United manager by...?', ['sports', 'soccer', 'epl'], true, 'sports', 'coach'),
    sg('Will Cristiano Ronaldo announce his retirement in 2026?', ['sports', 'soccer'], true, 'sports', 'transfer'),
    sg('Will LIV Golf announce shutdown in 2026?', ['sports', 'golf'], true, 'sports', 'transfer'),
    sg('Worlds 2026: Winner', ['esports', 'lol', 'games'], true, 'games', 'esports'),
    sg('IEM Beijing 2026: Winner', ['esports', 'cs2'], true, 'games', 'esports'),
    sg('The Game Awards: Game of the Year', ['video-games', 'game-awards'], true, 'games', 'award'),
    sg('GTA 6 launch postponed again?', ['video-games', 'gta-vi'], true, 'games', 'release'),
    sg('GTA VI released by...?', ['gta-vi'], true, 'games', 'release'),
    sg('Grand Theft Auto VI: Release date', ['entertainment', 'video games'], true, 'games', 'release', { id: 'ks:GTA6-26', eventId: 'ks:GTA6' }),
    sg('NFL: 2026 regular season passing yards leader', ['sports', 'nfl', 'nfl-team-futures'], false),
    // dropped micro markets
    sg('Heat vs. Warriors', T, false), sg('Jaguars vs. Ravens - Spread: Jaguars (-3.5)', ['sports', 'nfl'], false),
    sg('Heat vs. Warriors: O/U 220.5', T, false), sg('Arsenal FC vs. Hull City AFC - Exact Score', ['sports', 'epl'], false),
    sg('Dota 2: CyberHero vs HULIGANI (BO3)', ['esports', 'dota-2'], false), sg('LoL: Dplus KIA vs Bilibili Gaming (BO5)', ['esports', 'lol'], false),
    sg('Will Josh Allen have 3,500+ Passing Yards in the 2026 season?', ['sports', 'nfl'], false),
    sg('Regular Season Passing Yards Leader', ['sports', 'nfl'], false), sg('NCAA Football: Nebraska 2026 Win Total', ['sports', 'ncaa-football'], false),
    sg('Most Kills at Worlds 2026', ['esports', 'lol'], false), sg('Worlds 2026: Team to Make Grand Finals', ['esports', 'lol'], false),
    sg('Top Goalscorer: Premier League 2026-27', ['sports', 'epl'], false), sg('Chennai Open: Sinner vs Alcaraz', ['sports', 'atp'], false),
    sg("GTA VI: The Album First Week Sales?", ['video-games', 'gta-vi'], false), sg("Epic Games' valuation hit $50B?", ['video-games'], false),
    sg('The Game Awards: Best Multiplayer', ['video-games', 'game-awards'], false),
    sg('Will the Lakers win the 2027 NBA title? Props', ['sports', 'nba', 'props'], false),
    sg('Fantasy Football: Most Points', ['sports', 'nfl', 'fantasy-football'], false),
    sg('Will the Lakers beat the Celtics on 2026-11-06?', ['sports', 'nba'], false),
    sg('Pro Basketball 1H Spread', ['sports'], false, null, null, { id: 'ks:KXNBA1HSPREAD-26NOV06-LAL', eventId: 'ks:KXNBA1HSPREAD-26NOV06' }),
    // thin / not-an-allowed-kind
    sg('Will Tiger Woods play in a PGA Tournament in 2026?', ['sports', 'golf'], false),
    sg('Will Taylor Swift attend the Super Bowl?', ['sports', 'nfl', 'super-bowl'], false),
    sg('Stanley Cup Final Winner 2026-27', ['sports', 'nhl'], true, 'sports', 'championship'),
    // other exclusions still hold for sports-tagged markets
    sg('Will an NFL player be killed in 2026?', ['sports', 'nfl'], false),
    sg('Bitcoin price above $120,000 for Super Bowl Sunday?', ['sports', 'crypto'], false),
  ];
  for (const { m, keep, category, kind } of sgCases) {
    const r = classify(m, config);
    check(r.keep === keep && (!category || r.category === category) && (!kind || r.kind === kind), `sports/gaming "${m.title}" -> ${JSON.stringify(r)} (want keep=${keep}${category ? ' ' + category : ''}${kind ? ' ' + kind : ''})`);
  }
  // blanket toggle: with sportsGaming.enabled=false the old exclusion returns
  const off = { ...config, sportsGaming: { ...config.sportsGaming, enabled: false } };
  check(classify(mk('NBA: 2027 Champion', ['sports', 'nba']), off).keep === false, 'sportsGaming.enabled=false excludes sports again');
  check(classify(mk('NBA: 2027 Champion', ['sports', 'nba']), config).kind === 'championship', 'sports kind present');
  // Gamma parse drops per-game events before they take memory (one NBA game event carries 230+ markets)
  const ev = (title, tags = ['sports']) => ({ id: title, title, slug: 'x', active: true, closed: false, tags: tags.map((t) => ({ label: t, slug: t })),
    markets: [{ id: title + '1', question: title, outcomePrices: '["0.5","0.5"]', volume24hr: 5000, active: true, closed: false }] });
  const parsed = pm.parsePolymarketEvents([ev('Heat vs. Warriors'), ev('NBA: 2027 Champion'), ev('Props night', ['sports', 'props']), ev('Dota 2: A vs B (BO3)', ['esports']), ev('The Game Awards: Game of the Year', ['video-games'])], new Date());
  check(parsed.length === 2 && parsed.every((m) => /Champion|Game Awards/.test(m.title)), `pm parse pre-drops per-game events (${parsed.map((m) => m.title).join('; ')})`);
  // Kalshi sports series parse + hint tag
  const ksSports = ks.parseKalshiMarkets({ events: [{ event_ticker: 'GTA6', series_ticker: 'KXGTA6', title: 'Grand Theft Auto VI: Release date', category: 'Entertainment', _tag: 'video games',
    mutually_exclusive: true, markets: [{ ticker: 'GTA6-26', title: 'Will GTA VI release before Jan 2027?', yes_sub_title: 'Before 2027', status: 'active', last_price_dollars: '0.3', previous_price_dollars: '0.2', volume_24h_fp: '5000', open_time: '2026-01-01T00:00:00Z' }] }] }, {}, new Date());
  check(ksSports[0].tags.includes('video games') && classify(ksSports[0], config).category === 'games', 'kalshi series hint tag -> games');
}

// The source floor drops markets the filter could never keep; the deep slice is a pure add-on.
{
  const cfg = (await import(pathToFileURL(path.join(root, 'server/config.mjs')).href)).default;
  check(cfg.sources.polymarket.deepEvents > 300 && cfg.sources.polymarket.tagLimit >= 100, 'config: deep sweep and tag limit widened');
  check(cfg.filter.lowVolume24h < cfg.filter.minVolume24h, 'config: low floor below the main floor');
}

console.log('== live');
// Per-tag Polymarket sweep (small slice of config.sources.polymarket.tagSlugs) merged into the main sweep.
{
  const t0 = Date.now();
  const tagMs = await pm.sweepPolymarketTags({ tags: ['economy', 'movies', 'ai'], limit: 20, paceMs: 300 });
  const tagEvents = new Set(tagMs.map((m) => m.eventId));
  console.log(` polymarket tag sweep: ${tagMs.length} markets, ${tagEvents.size} events in ${Date.now() - t0}ms`, JSON.stringify(pm.polymarketTagCache().perTag));
  check(tagEvents.size > 20, 'pm tag sweep events');
  validate(tagMs, 'pm-tags');
}

for (const [name, fn, v] of [['polymarket', pm.fetchPolymarket, 'pm-live'], ['kalshi', ks.fetchKalshi, 'ks-live']]) {
  const t0 = Date.now();
  try {
    const ms = await fn();
    console.log(` ${name}: ${ms.length} markets in ${Date.now() - t0}ms, events=${new Set(ms.map((m) => m.eventId)).size}, withChange1d=${ms.filter((m) => m.change1d != null).length}`);
    show(ms); validate(ms, v); check(ms.length > 20, `${name} count`);
    if (name === 'polymarket') {
      const deep = pm.polymarketDeepCache();
      console.log(`  deep slice: ${deep.markets} markets, ${deep.events} events`);
      check(deep.events > 150, 'pm deep slice (events 300..800) loaded');
      check(ms.every((m) => m.volume24h >= 200), 'pm source floor ($200/24h) applied');
      const ids = ms.map((m) => m.id);
      check(new Set(ids).size === ids.length, 'pm merged sweep has no duplicate market ids');
      const merged = ms.length - (await import(pathToFileURL(path.join(srcDir, 'polymarket.mjs')).href)).mergedPolymarket().length;
      check(merged === 0, 'pm mergedPolymarket matches fetchPolymarket');
      const tok = ms.find((m) => m.tokenId)?.tokenId;
      const h = await pm.fetchPriceHistory(tok, { interval: '1d', fidelity: 60 });
      console.log(`  price history: ${h.length} points`, JSON.stringify(h[0])); check(h.length > 0, 'history');
      // MONEY MOVING: conditionId on markets, and the data-api v2 trades filter (one request for many markets)
      const conds = ms.filter((m) => m.conditionId).sort((x, y) => y.volume24h - x.volume24h).slice(0, 15).map((m) => m.conditionId);
      check(conds.length > 0, 'pm conditionId present');
      const tr = await imp('trades.mjs');
      const big = await tr.fetchBigTrades(conds, { minCash: 1000 });
      console.log(`  big trades (>= $1K, top 15 markets): ${big.length}`, JSON.stringify(big[0] || null));
      check(big.every((t) => t.amount >= 900 && t.yesPrice >= 0 && t.yesPrice <= 1 && !('name' in t)), 'trades normalized, no handles');
    }
  } catch (e) { fail++; console.log(`  FAIL ${name}`, e.message); }
}
const t0 = Date.now();
const h1 = await news.fetchHeadlines('Federal Reserve rate decision', { max: 3 });
console.log(` news: ${h1.length} headlines in ${Date.now() - t0}ms`); h1.forEach((h) => console.log('   ', JSON.stringify(h)));
check(h1.length > 0 && h1[0].source && !/ - /.test(h1[0].title.slice(-(h1[0].source.length + 3))), 'news parsed/source split');
const t1 = Date.now(); await news.fetchHeadlines('Federal Reserve rate decision'); check(Date.now() - t1 < 50, 'news cached');
console.log(fail ? `\n${fail} FAILURES` : '\nALL OK');
process.exit(fail ? 1 : 0);
