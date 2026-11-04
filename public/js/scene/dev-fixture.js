// Offline fixture for the scene harness: one story per visual type, a movers list and an alert. Shapes follow docs/ARCHITECTURE.md.
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
function mk(id, outcome, yes, d1, { title = outcome, eventId = 'ev', eventTitle = '', category = 'politics', closesAt = iso(now + 20 * 86400e3), vol = 400000, source = 'polymarket' } = {}) {
  return { id, source, title, outcome, eventId, eventTitle, category, tags: [category], yesPrice: yes, change1d: d1, change1w: d1 * 1.6, volume24h: vol, volumeTotal: vol * 40, liquidity: 50000, closesAt, url: 'https://example.invalid', tokenId: null, updatedAt: iso(now) };
}
function history(days, start, end, wobble = 0.08, seed = 1) {
  const out = []; let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const n = days * 12;
  for (let i = 0; i <= n; i++) { const k = i / n; const p = start + (end - start) * (k * k) + Math.sin(k * 9 + seed) * wobble * (1 - k * 0.5) + (rnd() - 0.5) * 0.02; out.push({ t: Math.round((now - (days - days * k) * 86400e3) / 1000), p: Math.min(0.99, Math.max(0.01, p)) }); }
  out[out.length - 1].p = end;
  return out;
}
function story(id, eventTitle, category, markets, visual, extra = {}) {
  const lead = markets[0];
  return { id, eventTitle, category, sources: ['polymarket'], lead, markets, score: 10, kind: 'mover', headline: eventTitle, dek: '', thin: false, history: null, news: [], visual: { region: null, theme: category, ...visual }, ...extra };
}

export const STORIES = [
  story('pm:dem-nominee-2028', 'Who wins the 2028 Democratic nomination?', 'politics', [
    mk('pm:d1', 'Gavin Newsom', 0.31, 0.03), mk('pm:d2', 'Jon Ossoff', 0.27, 0.09), mk('pm:d3', 'Alexandria Ocasio-Cortez', 0.14, -0.02), mk('pm:d4', 'Josh Shapiro', 0.11, -0.01), mk('pm:d5', 'Pete Buttigieg', 0.07, 0),
  ], { type: 'outcomes', region: { name: 'Washington, D.C.', lat: 38.9, lon: -77.04 } }),
  story('pm:fed-december', 'Fed decision in December?', 'economy', [
    mk('pm:f1', 'Hike 25', 0.8, 0.07, { category: 'economy' }), mk('pm:f2', 'Hold', 0.18, -0.06, { category: 'economy' }), mk('pm:f3', 'Cut 25', 0.02, -0.01, { category: 'economy' }),
  ], { type: 'outcomes' }),
  story('ks:gas-4', 'Will US gas average $4 by March?', 'economy', [mk('ks:g1', null, 0.62, 0.12, { category: 'economy', source: 'kalshi' })], { type: 'dial' }),
  story('pm:scotus-retire', 'Will a Supreme Court justice retire by July?', 'courts', [mk('pm:s1', null, 0.23, -0.05, { category: 'courts' })], { type: 'dial' }),
  story('pm:anthropic-ipo', 'Anthropic IPO before 2027?', 'tech', [mk('pm:a1', null, 0.44, 0.06, { category: 'tech' })], { type: 'ribbon', region: { name: 'San Francisco', lat: 37.77, lon: -122.42 } }, { history: history(14, 0.22, 0.44, 0.06, 3) }),
  story('pm:oil-90', 'Oil above $90 by year end?', 'economy', [mk('pm:o1', null, 0.37, -0.09, { category: 'economy' })], { type: 'ribbon' }, { history: history(30, 0.6, 0.37, 0.1, 7) }),
  story('pm:china-taiwan-talks', 'China and Taiwan hold formal talks in 2026?', 'world', [mk('pm:c1', null, 0.12, 0.04, { category: 'world' })], { type: 'globe', region: { name: 'China', lat: 35.86, lon: 104.2 } }),
  story('pm:uk-election', 'UK general election before 2028?', 'world', [mk('pm:u1', null, 0.71, 0.11, { category: 'world' })], { type: 'globe', region: { name: 'United Kingdom', lat: 54.0, lon: -2.5 } }),
  story('pm:brazil-rate', 'Brazil cuts rates in December?', 'economy', [mk('pm:b1', null, 0.58, -0.03, { category: 'economy' })], { type: 'globe', region: { name: 'Brazil', lat: -14.2, lon: -51.9 } }),
  story('ks:billboard', 'Taylor Swift #1 on Billboard this week?', 'culture', [mk('ks:bb1', 'Taylor Swift', 0.86, 0.04, { category: 'culture', closesAt: iso(now + 2.3 * 86400e3), source: 'kalshi' }), mk('ks:bb2', 'Bad Bunny', 0.09, -0.03, { category: 'culture', closesAt: iso(now + 2.3 * 86400e3), source: 'kalshi' }), mk('ks:bb3', 'Olivia Rodrigo', 0.04, 0, { category: 'culture', closesAt: iso(now + 2.3 * 86400e3), source: 'kalshi' })], { type: 'countdown' }),
  story('ks:nyc-snow', 'Snow in Central Park by Friday?', 'weather', [mk('ks:sn1', null, 0.33, 0.14, { category: 'weather', closesAt: iso(now + 0.6 * 86400e3), source: 'kalshi' })], { type: 'countdown', region: { name: 'New York City', lat: 40.71, lon: -74.01 } }),
  story('ks:cpi', 'CPI above 3.2% for October?', 'economy', [mk('ks:cpi1', 'Above 3.2%', 0.41, 0.05, { category: 'economy', closesAt: iso(now + 5 * 86400e3), source: 'kalshi' }), mk('ks:cpi2', 'Above 3.4%', 0.12, 0.02, { category: 'economy', closesAt: iso(now + 5 * 86400e3), source: 'kalshi' }), mk('ks:cpi3', 'Above 3.0%', 0.78, 0.03, { category: 'economy', closesAt: iso(now + 5 * 86400e3), source: 'kalshi' }), mk('ks:cpi4', 'Above 3.6%', 0.03, 0, { category: 'economy', closesAt: iso(now + 5 * 86400e3), source: 'kalshi' })], { type: 'countdown' }),
];

// ---- watchability fixtures: swing / price replay / news marks / Story of the Day ----
function hist24(start, end, seed = 5) {
  const out = []; const n = 48;
  for (let i = 0; i <= n; i++) { const k = i / n; const p = start + (end - start) * (k < 0.55 ? k * 0.45 : 0.25 + (k - 0.55) * 1.67) + Math.sin(k * 14 + seed) * 0.02; out.push({ t: Math.round((now - (1 - k) * 86400e3) / 1000), p: Math.min(0.99, Math.max(0.01, p)) }); }
  out[n].p = end; return out;
}
const nmk = (hAgo, title, outlet) => ({ t: Math.round((now - hAgo * 3600e3) / 1000), title, outlet });
STORIES.push(
  story('ks:colom-swing', 'Colombia presidential race: leading candidate wins', 'politics', [mk('ks:co1', 'Candidate A', 0.92, 0.78, { source: 'kalshi' })], { type: 'dial' }, { swing: { from: 0.14, to: 0.92, delta: 0.78, flipped: true, shape: 'longshot' } }),
  story('pm:ms-senate-swing', 'Mississippi Senate: who wins?', 'politics', [mk('pm:ms1', 'Democrats', 0.91, -0.3), mk('pm:ms2', 'Republicans', 0.09, 0.3)], { type: 'outcomes' }, { swing: { from: 0.61, to: 0.91, delta: 0.3, flipped: false, shape: 'swing' } }),
  story('pm:fall-swing', 'Government shutdown ends by Friday?', 'politics', [mk('pm:sh1', null, 0.31, -0.42)], { type: 'dial' }, { swing: { from: 0.73, to: 0.31, delta: -0.42, flipped: true, shape: 'slipping' } }),
  story('pm:replay-swing', 'Fed cuts rates in December?', 'economy', [mk('pm:rp1', null, 0.64, 0.38, { category: 'economy' })], { type: 'dial', theme: 'economy' }, {
    swing: { from: 0.26, to: 0.64, delta: 0.38, flipped: true, shape: 'longshot' }, history: hist24(0.26, 0.64, 2),
    newsMarks: [nmk(15, 'Fed official signals openness to cut', 'Reuters'), nmk(9, 'Jobs report misses', 'Bloomberg'), nmk(4.5, 'Chair speech', 'AP'), nmk(1.2, 'CPI cooler than expected', 'WSJ')],
  }),
);
export const SOTD = { id: 'sotd:blue-wave', title: 'THE BLUE WAVE', credit: 'Reuters', headline: 'Democrats surge across 12 races', leadStoryId: 'pm:ms-senate-swing', markets: [
  { storyId: 'a', label: 'Democrats win Mississippi Senate', yesPrice: 0.91, change1d: 0.3, source: 'polymarket' }, { storyId: 'b', label: 'Democrats win Texas Senate', yesPrice: 0.34, change1d: 0.12, source: 'kalshi' },
  { storyId: 'c', label: 'Democrats win House', yesPrice: 0.82, change1d: 0.07, source: 'kalshi' }, { storyId: 'd', label: 'Ohio Senate', yesPrice: 0.27, change1d: 0.18, source: 'polymarket' },
  { storyId: 'e', label: 'Maine Senate', yesPrice: 0.64, change1d: 0.09, source: 'polymarket' }, { storyId: 'f', label: 'Iowa Senate', yesPrice: 0.22, change1d: 0.05, source: 'polymarket' },
  { storyId: 'g', label: 'Alaska Senate', yesPrice: 0.18, change1d: -0.04, source: 'polymarket' }, { storyId: 'h', label: 'Florida Governor', yesPrice: 0.41, change1d: 0.06, source: 'kalshi' },
  { storyId: 'i', label: 'Georgia Governor', yesPrice: 0.58, change1d: 0.1, source: 'kalshi' }, { storyId: 'j', label: 'Arizona Governor', yesPrice: 0.69, change1d: 0.08, source: 'kalshi' },
  { storyId: 'k', label: 'Wisconsin Governor', yesPrice: 0.52, change1d: 0.11, source: 'kalshi' }, { storyId: 'l', label: 'Nevada Governor', yesPrice: 0.47, change1d: 0.07, source: 'kalshi' },
] };

export const MOVERS = [
  mk('pm:m1', 'Nithya Raman', 0.98, 0.59), mk('pm:m2', 'Jon Ossoff', 0.27, 0.09), mk('ks:m3', 'Gas $4', 0.62, 0.12, { source: 'kalshi' }), mk('pm:m4', 'Hike 25', 0.8, 0.07), mk('pm:m5', 'Anthropic IPO', 0.44, 0.06),
  mk('pm:m6', 'Snow NYC', 0.33, 0.14), mk('pm:m7', 'UK election', 0.71, 0.11), mk('pm:m8', 'Taylor #1', 0.86, 0.04), mk('pm:m9', 'Shutdown ends', 0.55, 0.03),
  mk('pm:m10', 'Oil $90', 0.37, -0.09), mk('pm:m11', 'Hold', 0.18, -0.06), mk('pm:m12', 'SCOTUS retire', 0.23, -0.05), mk('pm:m13', 'Xi out 2026', 0.06, -0.04), mk('pm:m14', 'Putin out 2026', 0.11, -0.07),
  mk('pm:m15', 'Brazil cut', 0.58, -0.03), mk('pm:m16', 'AOC nominee', 0.14, -0.02), mk('pm:m17', 'Bad Bunny #1', 0.09, -0.03), mk('pm:m18', 'Rate cut Jan', 0.21, -0.12),
];

export const ALERT = { id: 'al-1', at: iso(now), storyId: 'pm:dem-nominee-2028', marketId: 'pm:d2', headline: 'Jon Ossoff jumps 9 points in 40 minutes', line: 'Ossoff is at 27%, up from 18%.', from: 0.18, to: 0.27, minutes: 40, source: 'polymarket' };

export const STATE = { generatedAt: iso(now), sim: true, feeds: {}, stories: STORIES, movers: MOVERS, closing: STORIES.filter((s) => s.visual.type === 'countdown'), alerts: [ALERT], sotd: SOTD };
