// PNN ranking: Market[] -> {stories, movers, closing}. The "what leads the newscast" judgment.
//
// buildStories(markets, config, {now}) -> { stories: Story[], movers: Market[], closing: Story[], desks: Desk[], stats, aliases }
//   - stories: the board, picked with category quotas (see selectBoard); desks: per-category best, from the full pool.
//   - classify() each market, drop noise, group by eventId, pick a lead market, score, fill copy and visual hints.
//   - stats ({kept, dropped: {reason: count}}) is an addition to the contract for logging.
//   - movers entries are Market objects plus a `line` string (marketLine) and `storyId` for the ticker.
//   - history is left null and news [] (ingest fills those).
//
// Config keys read (all optional):
//   thinVolume (25000), limits.stories (30), limits.movers (20), limits.closing (8), limits.closingDays (7),
//   limits.marketsPerStory (5), plus everything filter.classify reads.
//
// Scoring in one paragraph: a story's score is driven by the lead's 24h move in points (diminishing above 30),
// a bit of its weekly move, times a volume factor (log of the event's 24h volume, $1K = 0, $1M = 1), plus a
// volume-only baseline so heavy markets still air when quiet. Then damping: "by <date>" markets drifting
// toward zero (decay, not news), near-certain markets that did not just get there, thin markets, and
// low-priority categories (weather, fallback) unless they move on real volume. Culture/entertainment is NOT damped.
// Freshness: the 24h move is weighted by freshness() (fades once flat for an hour+) and a 3+ point move in the last
// hour on $10K+ adds hourBoost(); change1h/flatMin come from PNN's own samples via ingest (null = no effect).

import { classify } from './filter.mjs';
import { storyHeadline, storyDek, marketLine, outcomeLabel, moverName, rungLabel, ladderParts, shortHeadline, shapeTitle } from './copy.mjs';

const DAY = 864e5;

// ---------- gazetteer (keyword -> region) ----------
// Order matters: more specific first. us: true marks US places (globe is only used for non-US regions).
const GAZ = [
  [/\b(putin|kremlin|russia|russian|moscow)\b/i, 'Moscow, Russia', 55.76, 37.62],
  [/\b(xi jinping|\bxi\b|china|chinese|beijing|ccp)\b/i, 'Beijing, China', 39.90, 116.40],
  [/\b(taiwan|taipei)\b/i, 'Taipei, Taiwan', 25.03, 121.57],
  [/\b(hong kong)\b/i, 'Hong Kong', 22.32, 114.17],
  [/\b(israel|israeli|netanyahu|knesset|jerusalem|tel aviv|eizenkot|gantz|lapid|bennett)\b/i, 'Jerusalem, Israel', 31.77, 35.21],
  [/\b(iran|iranian|tehran|khamenei)\b/i, 'Tehran, Iran', 35.69, 51.39],
  [/\b(hormuz)\b/i, 'Strait of Hormuz', 26.57, 56.25],
  [/\b(gaza|palestin\w*|west bank)\b/i, 'Gaza', 31.50, 34.47],
  [/\b(lebanon|beirut|hezbollah)\b/i, 'Beirut, Lebanon', 33.89, 35.50],
  [/\b(saudi|riyadh)\b/i, 'Riyadh, Saudi Arabia', 24.71, 46.68],
  [/\b(ukraine|ukrainian|kyiv|zelensky)\b/i, 'Kyiv, Ukraine', 50.45, 30.52],
  [/\b(uk|united kingdom|britain|british|london|starmer|labour|tory|tories|reform uk)\b/i, 'London, UK', 51.51, -0.13],
  [/\b(france|french|paris|macron|lagarde|le pen|bardella)\b/i, 'Paris, France', 48.86, 2.35],
  [/\b(germany|german|berlin|merz|bundestag)\b/i, 'Berlin, Germany', 52.52, 13.40],
  [/\b(italy|italian|rome|meloni)\b/i, 'Rome, Italy', 41.90, 12.50],
  [/\b(spain|spanish|madrid)\b/i, 'Madrid, Spain', 40.42, -3.70],
  [/\b(vatican|pope)\b/i, 'Vatican City', 41.90, 12.45],
  [/\b(eu|european union|brussels|ecb)\b/i, 'Brussels, EU', 50.85, 4.35],
  [/\b(poland|polish|warsaw)\b/i, 'Warsaw, Poland', 52.23, 21.01],
  [/\b(hungary|orban|budapest)\b/i, 'Budapest, Hungary', 47.50, 19.04],
  [/\b(turkey|turkish|erdogan|ankara)\b/i, 'Ankara, Turkey', 39.93, 32.86],
  [/\b(india|indian|modi|delhi)\b/i, 'New Delhi, India', 28.61, 77.21],
  [/\b(pakistan|islamabad)\b/i, 'Islamabad, Pakistan', 33.68, 73.05],
  [/\b(japan|japanese|tokyo)\b/i, 'Tokyo, Japan', 35.68, 139.69],
  [/\b(south korea|korean|seoul)\b/i, 'Seoul, South Korea', 37.57, 126.98],
  [/\b(north korea|pyongyang|kim jong)\b/i, 'Pyongyang, North Korea', 39.04, 125.76],
  [/\b(australia|australian|canberra|sydney)\b/i, 'Canberra, Australia', -35.28, 149.13],
  [/\b(canada|canadian|ottawa|carney|poilievre|trudeau)\b/i, 'Ottawa, Canada', 45.42, -75.70],
  [/\b(mexico|mexican|sheinbaum)\b/i, 'Mexico City, Mexico', 19.43, -99.13],
  [/\b(brazil|brazilian|lula|bolsonaro|brasilia)\b/i, 'Brasília, Brazil', -15.79, -47.88],
  [/\b(argentina|milei|buenos aires)\b/i, 'Buenos Aires, Argentina', -34.60, -58.38],
  [/\b(venezuela|maduro|caracas)\b/i, 'Caracas, Venezuela', 10.48, -66.90],
  [/\b(colombia|bogota)\b/i, 'Bogotá, Colombia', 4.71, -74.07],
  [/\b(chile|santiago)\b/i, 'Santiago, Chile', -33.45, -70.67],
  [/\b(south africa|pretoria|johannesburg)\b/i, 'Pretoria, South Africa', -25.75, 28.19],
  [/\b(nigeria|abuja)\b/i, 'Abuja, Nigeria', 9.08, 7.40],
  [/\b(egypt|cairo)\b/i, 'Cairo, Egypt', 30.04, 31.24],
  [/\b(greenland|nuuk)\b/i, 'Nuuk, Greenland', 64.18, -51.72],
  // US cities before states (LA mayor -> Los Angeles)
  [/\b(los angeles|\bla mayor|\bl\.a\.)\b/i, 'Los Angeles, CA', 34.05, -118.24, true],
  [/\b(new york city|nyc|mamdani)\b/i, 'New York, NY', 40.71, -74.01, true],
  [/\b(chicago|o'hare)\b/i, 'Chicago, IL', 41.88, -87.63, true],
  [/\b(houston)\b/i, 'Houston, TX', 29.76, -95.37, true],
  [/\b(miami)\b/i, 'Miami, FL', 25.76, -80.19, true],
  [/\b(seattle)\b/i, 'Seattle, WA', 47.61, -122.33, true],
  [/\b(san francisco)\b/i, 'San Francisco, CA', 37.77, -122.42, true],
  [/\b(newark)\b/i, 'Newark, NJ', 40.74, -74.17, true],
  [/\b(alaska|peltola|sullivan)\b/i, 'Alaska', 61.22, -149.90, true],
  [/\b(mississippi|hyde-smith|colom)\b/i, 'Mississippi', 32.30, -90.18, true],
  [/\b(texas|talarico)\b/i, 'Texas', 30.27, -97.74, true],
  [/\b(kansas)\b/i, 'Kansas', 39.05, -95.68, true],
  [/\b(california|newsom)\b/i, 'California', 38.58, -121.49, true],
  [/\b(florida|desantis)\b/i, 'Florida', 30.44, -84.28, true],
  [/\b(georgia|ossoff|kemp)\b/i, 'Georgia', 33.75, -84.39, true],
  [/\b(north carolina|nc-\d+)\b/i, 'North Carolina', 35.78, -78.64, true],
  [/\b(pennsylvania|shapiro)\b/i, 'Pennsylvania', 40.27, -76.88, true],
  [/\b(michigan)\b/i, 'Michigan', 42.73, -84.56, true],
  [/\b(ohio)\b/i, 'Ohio', 39.96, -83.00, true],
  [/\b(iowa)\b/i, 'Iowa', 41.59, -93.62, true],
  [/\b(maine)\b/i, 'Maine', 44.31, -69.78, true],
  [/\b(arizona)\b/i, 'Arizona', 33.45, -112.07, true],
  [/\b(nevada)\b/i, 'Nevada', 39.16, -119.77, true],
  [/\b(wisconsin)\b/i, 'Wisconsin', 43.07, -89.40, true],
  [/\b(minnesota|minneapolis)\b/i, 'Minnesota', 44.95, -93.09, true],
  [/\b(virginia)\b/i, 'Virginia', 37.54, -77.44, true],
  [/\b(new jersey)\b/i, 'New Jersey', 40.22, -74.76, true],
  [/\b(new york)\b/i, 'New York', 42.65, -73.76, true],
  [/\b(maryland|wes moore)\b/i, 'Maryland', 38.98, -76.49, true],
  [/\b(illinois|pritzker)\b/i, 'Illinois', 39.80, -89.65, true],
  [/\b(colorado)\b/i, 'Colorado', 39.74, -104.99, true],
  [/\b(fed|fomc|federal reserve|congress|senate|house|white house|trump|president|supreme court|scotus|us|u\.s\.|united states|america)\b/i, 'Washington, DC', 38.90, -77.04, true],
];

export function inferRegion(text) {
  const t = String(text || '');
  // Several US states named (e.g. a Senate map combo) -> the country, not the first state.
  const usStates = GAZ.filter(([re, name, , , us]) => us && !/,|Washington/.test(name) && re.test(t)).length;
  if (usStates >= 3) return { name: 'United States', lat: 39.83, lon: -98.58, us: true };
  for (const [re, name, lat, lon, us] of GAZ) if (re.test(t)) return { name, lat, lon, us: !!us };
  return null;
}

const THEME = { politics: 'politics', elections: 'politics', geopolitics: 'world', world: 'world', economy: 'economy', courts: 'courts', tech: 'tech', science: 'science', health: 'health', culture: 'culture', weather: 'weather' };
const CATEGORY_WEIGHT = { weather: 0.45, world: 0.8 }; // culture/entertainment is full weight (user, 2026-11-04)

// ---------- helpers ----------
const abs = (x) => Math.abs(x ?? 0);
const log10 = (x) => Math.log10(Math.max(1, x));
const volFactor = (v) => Math.max(0, Math.min(1.4, (log10(v + 1) - 3) / 3)); // $1K -> 0, $1M -> 1, $16M -> 1.4
const weightedMove = (m) => abs(m.change1d) * log10(10 + (m.volume24h || 0));
// "What's moving now" (DECISIONS 2026-11-04 rotation & freshness). ingest attaches PNN's own short-window motion
// (change1h, flatMin) before ranking; null/absent means no information and changes nothing.
//   freshness(m): weight on the 24h move. A move that has sat flat (within 1.5 pts) for over an hour fades
//     gradually through the day, 8%/hour down to 45%; any motion in the last hour restores it.
//   hotNow(m, vol): moved >= 3 points in the last hour on real volume ($10K+): a meaningful boost.
const HOT_POINTS = 0.03;
const HOT_VOLUME = 10_000;
export function freshness(m) {
  if (m?.change1h == null || m?.flatMin == null) return 1;
  const decay = Math.max(0.45, 1 - 0.08 * Math.max(0, m.flatMin / 60 - 1));
  const live = Math.min(1, abs(m.change1h) / HOT_POINTS);
  return decay + (1 - decay) * live;
}
export const hotNow = (m, vol = m?.volume24h || 0) => m?.change1h != null && abs(m.change1h) >= HOT_POINTS && vol >= HOT_VOLUME;
const hourBoost = (m, vol) => (hotNow(m, vol) ? Math.min(abs(m.change1h) * 100, 20) * 2 : 0);   // in points of "move"
const DEADLINE_RE = /\b(by|before|through|until|end of)\b|\.\.\.|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b|\b20\d\d\b/i;

function isDecay(m, now = Date.now()) {
  const text = `${m.title} ${m.eventTitle} ${m.outcome || ''}`;
  if (!DEADLINE_RE.test(text)) return false;
  const d1 = m.change1d ?? 0;
  if (!(d1 < 0) || m.yesPrice >= 0.15) return false;
  // A "by <date>" market whose deadline is hours away falls to zero because time ran out, not because of news.
  const closesMs = m.closesAt ? Date.parse(m.closesAt) - now : NaN;
  if (closesMs > -DAY && closesMs <= 2 * DAY) return true;
  if (d1 <= -0.10) return false; // a big single-day drop is news
  return true;
}

// Polymarket groups whose outcomes are cumulative/independent ("released by Nov 4 / Nov 15 / Dec 31",
// "above 70,000 / 72,000") rather than one race. Their prices sum well past 100%.
const MONTH_RE = /^(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const THRESH_RE = /^(above|below|over|under|at least|more than|less than|[↑↓]|\$?\d[\d,.]*\+?%?$|\d+\+)/i;
function nonExclusive(group) {
  if (group.length < 2 || group[0].source !== 'polymarket') return false;
  const sum = group.reduce((a, m) => a + (m.yesPrice || 0), 0);
  // "by <date>" rungs are cumulative even when every price is low and the sum stays under 100%
  const byDate = group.filter((m) => MONTH_RE.test(m.outcome || '') && /\b(by|before|through)\b/i.test(m.title || '')).length;
  if (byDate * 2 >= group.length) return true;
  if (sum <= 1.1) return false;
  const ladderish = group.filter((m) => MONTH_RE.test(m.outcome || '') || THRESH_RE.test(m.outcome || '') || /\b\d{4}$/.test(m.outcome || '')).length;
  const ladderTitle = /(\b(by|through|before|after|above|below)\s*(\.\.\.|…|_+)|_{2,})/i.test(group[0].eventTitle || '');
  return ladderish * 2 >= group.length || ladderTitle || sum > 1.5;
}
// Strike ladders: Kalshi cumulative "Above X" events (tagged by sources/kalshi.mjs) and Polymarket threshold groups
// ("↑ $100", "Above 4%"). They air as ONE yes/no story on the line: the rung nearest 50%. 'date' ladders ("by Nov 15 /
// Dec 31") keep the move-led pick below.
const isKalshiLadder = (m) => (m.tags || []).includes('kalshi:ladder');
function ladderKind(group) {
  if (group.some(isKalshiLadder)) return 'strike';
  if (!nonExclusive(group)) return null;
  const strikes = group.filter((m) => THRESH_RE.test(m.outcome || '') && !MONTH_RE.test(m.outcome || '') && !/^(19|20)\d\d$/.test(m.outcome || '')).length;
  return strikes * 2 >= group.length ? 'strike' : 'date';
}
const strikeOf = (m) => {
  if (Number.isFinite(m.strike)) return m.strike;
  const x = String(m.outcome || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return x ? Number(x[0]) : NaN;
};
const dirOf = (m) => m.strikeDir || (/^(below|under|less|↓)/i.test(String(m.outcome || '').trim()) ? 'below' : 'above');
// The line: the rung nearest even money, among rungs with some real trading (a stale rung's last price is noise).
function pickLine(group, evVol) {
  const floor = Math.max(100, 0.01 * evVol);
  const pool = group.filter((m) => (m.volume24h || 0) >= floor);
  const cands = pool.length ? pool : group;
  return cands.reduce((a, b) => {
    const da = abs(a.yesPrice - 0.5), db = abs(b.yesPrice - 0.5);
    return db < da - 1e-9 || (abs(db - da) <= 1e-9 && (b.volume24h || 0) > (a.volume24h || 0)) ? b : a;
  });
}
// The rungs either side of the line, same direction, skipping any rung whose price contradicts the ladder's order
// (an "above" rung higher up must not be priced above the line).
function neighborRungs(group, lead) {
  const dir = dirOf(lead);
  const k = strikeOf(lead);
  if (!Number.isFinite(k)) return [];
  const same = group.filter((m) => m !== lead && dirOf(m) === dir && Number.isFinite(strikeOf(m)));
  const up = dir === 'above';
  const lower = same.filter((m) => strikeOf(m) < k && (up ? m.yesPrice >= lead.yesPrice : m.yesPrice <= lead.yesPrice))
    .sort((a, b) => strikeOf(b) - strikeOf(a))[0];
  const higher = same.filter((m) => strikeOf(m) > k && (up ? m.yesPrice <= lead.yesPrice : m.yesPrice >= lead.yesPrice))
    .sort((a, b) => strikeOf(a) - strikeOf(b))[0];
  const row = (m, isLead = false) => ({ id: m.id, label: rungLabel(m), yesPrice: m.yesPrice, change1d: m.change1d ?? null, lead: isLead });
  return [lower && row(lower), row(lead, true), higher && row(higher)].filter(Boolean);
}

// One family per thing a ladder measures, across its daily/weekly/monthly series and places: every gas-price line
// (national, Texas, this week, tomorrow) is 'ladder:gas', every Rotten Tomatoes film 'ladder:rt'.
function ladderFamily(m) {
  const n = String(ladderParts(m)?.noun || '');
  const k = /\b(gas|diesel) price$/i.exec(n)?.[1] || (/Rotten Tomatoes/i.test(n) ? 'rt' : /\b(WTI|Brent) oil$/i.test(n) ? 'oil' : /^(Gold|Silver|Copper)$/i.test(n) ? 'metals' : null);
  return `ladder:${(k || String(m.eventId || '').replace(/^ks:/, '').split('-')[0].replace(/(MON|[DWM])$/, '')).toLowerCase()}`;
}

function nearCertain(m) {
  return m.yesPrice >= 0.97 || m.yesPrice <= 0.03;
}
function justArrived(m) {
  // moved to the extreme today: e.g. 60% -> 99%, or 40% -> 1%
  return abs(m.change1d) >= 0.10;
}

function pickLead(group, { ladder = false, now = Date.now() } = {}) {
  if (group.length === 1) return group[0];
  if (ladder) {
    // skip rungs that are expiring or decaying; the story is the live part of the ladder
    const live = group.filter((m) => !isDecay(m, now) && !(m.closesAt && Date.parse(m.closesAt) - now < 2 * DAY));
    if (live.length) group = live;
    if (group.length === 1) return group[0];
  }
  const maxMove = Math.max(...group.map((m) => Math.max(abs(m.change1d), abs(m.change1h))));
  if (maxMove < 0.03) {
    // a quiet ladder: the rung nearest even money is the interesting one, not the 99% far end
    if (ladder) return group.reduce((a, b) => (abs(b.yesPrice - 0.5) < abs(a.yesPrice - 0.5) ? b : a));
    return group.reduce((a, b) => (b.yesPrice > a.yesPrice ? b : a));
  }
  // biggest volume-weighted move; prefer the riser when the two sides of a race move together
  const score = (m) => (weightedMove(m) * freshness(m) + hourBoost(m, m.volume24h || 0) / 100 * log10(10 + (m.volume24h || 0)))
    * (((hotNow(m) ? m.change1h : m.change1d) ?? 0) > 0 ? 1.2 : 1) * (isDecay(m, now) ? 0.3 : 1);
  return group.reduce((a, b) => (score(b) > score(a) ? b : a));
}

function scoreStory(lead, group, evVol, cat, { now, closingMs, thinVolume }) {
  const mv = abs(lead.change1d) * 100;
  const mvEff = Math.min(mv, 30) + Math.max(0, mv - 30) * 0.3;
  const wk = abs(lead.change1w) * 100;
  const wkEff = Math.min(wk, 30) * 0.25;
  const vf = volFactor(evVol);
  // the 24h move fades when it has gone flat; a move in the last hour on real money adds on top
  let s = (mvEff * freshness(lead) + wkEff + hourBoost(lead, evVol)) * (0.3 + vf) + 8 * vf;
  const closesMs = lead.closesAt ? Date.parse(lead.closesAt) - now : NaN;
  if (closesMs > 0 && closesMs <= closingMs) s += 3 * vf;
  // A genuinely open question (15–85%) with real money is interesting even on a quiet day.
  if (lead.yesPrice >= 0.15 && lead.yesPrice <= 0.85 && evVol >= thinVolume) s += 4 * vf;
  // damping
  if (isDecay(lead, now)) s *= 0.2;
  // Near-certain and static is not news ("interesting content only"): it should sit below any competitive
  // market with real volume, however much money is parked on it.
  if (nearCertain(lead) && !justArrived(lead)) s *= abs(lead.change1d) >= 0.03 ? 0.35 : 0.15;
  if (evVol < thinVolume) s *= 0.5;
  const cw = CATEGORY_WEIGHT[cat];
  if (cw && !(mv >= 5 && evVol >= 50_000)) s *= cw;
  return s;
}

function meaningfulOutcomes(group) {
  return group.filter((m) => m.yesPrice >= 0.02).length;
}

function visualFor(story, { now }) {
  const lead = story.lead;
  const text = `${story.eventTitle} ${lead.title} ${lead.outcome || ''}`;
  const region = inferRegion(text);
  // A strike ladder is one yes/no line: a dial, or a ribbon when it has trended this week.
  if (story.ladderKind === 'strike') {
    return {
      type: abs(lead.change1w) >= 0.08 ? 'ribbon' : 'dial',
      region: region ? { name: region.name, lat: region.lat, lon: region.lon } : null,
      theme: THEME[story.category] || 'world',
    };
  }
  const multi = story._groupSize > 1 && lead.outcome != null && !story.ladder;
  const closesMs = lead.closesAt ? Date.parse(lead.closesAt) - now : NaN;
  let type = 'dial';
  if (multi && meaningfulOutcomes(story._group) >= 3) type = 'outcomes';
  else if (closesMs > 0 && closesMs <= 2 * DAY) type = 'countdown';
  else if (region && !region.us && !multi) type = 'globe';
  else if (!multi && abs(lead.change1w) >= 0.08) type = 'ribbon';
  return {
    type,
    region: region ? { name: region.name, lat: region.lat, lon: region.lon } : null,
    theme: THEME[story.category] || 'world',
  };
}

// ---------- cross-source merge + diversity ----------
// The same race often trades on both exchanges. Keep the higher-scoring story and credit both sources.
const STOP = new Set(['will', 'who', 'what', 'the', 'a', 'an', 'in', 'of', 'to', 'for', 'and', 'or', 'be', 'win', 'wins', 'winner',
  'election', 'elections', 'race', 'next', 'after', 'by', 'on', 'is', 'us', 'u', 's', '2026', 'midterms', 'midterm']);
const tokens = (t) => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
  .map((w) => w.replace(/s$/, '')).filter((w) => w && !STOP.has(w)));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}
// Watchability #10: the same question priced on both exchanges. Only compare like with like: the other side's
// market for the SAME outcome (matching outcome names, or both binary with matching titles). Otherwise no badge.
const AGREE_PTS = 0.05, MAX_GAP = 0.20;
const normName = (x) => tokens(String(x || '').replace(/\b(democrat(ic|s)?|republican(s)?|party|gop|dem(s)?)\b/gi, (w) => w.toLowerCase().startsWith('d') ? 'dem' : 'rep'));
function sameSide(a, b) {
  if (!a || !b || !Number.isFinite(a.yesPrice) || !Number.isFinite(b.yesPrice)) return false;
  if (a.outcome == null && b.outcome == null) return jaccard(tokens(a.title), tokens(b.title)) >= 0.5;
  if (a.outcome == null || b.outcome == null) return false;
  const ta = normName(a.outcome), tb = normName(b.outcome);
  if (!ta.size || !tb.size) return false;
  // "Colom" vs "Scott Colom": the shorter name is contained in the longer one
  const [sm, lg] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  return [...sm].every((w) => lg.has(w));
}
function setExchanges(keep, drop) {
  const a = keep.lead;
  const pool = drop._group || [drop.lead];
  const b = pool.find((m) => sameSide(a, m));
  if (!b || a.source === b.source) return;
  // a 20+ point gap on "matching" titles is nearly always two different questions (another leaderboard, another
  // deadline): no badge rather than a false EXCHANGES DISAGREE
  if (Math.abs(a.yesPrice - b.yesPrice) > MAX_GAP) return;
  const volOf = (src, m) => (keep.sourceVolumes || []).find((x) => x.source === src)?.volume24h ?? m.volume24h ?? 0;
  keep.exchanges = [a, b].map((m) => ({ source: m.source, yesPrice: m.yesPrice, volume24h: volOf(m.source, m) }))
    .sort((x, y) => (x.source === 'kalshi' ? -1 : 1) - (y.source === 'kalshi' ? -1 : 1));
  keep.agree = Math.abs(a.yesPrice - b.yesPrice) < AGREE_PTS ? 'agree' : 'disagree';
}

// ---------- watchability #1/#2: swings, settling, dead content ----------
// swing: the THEN vs NOW card. From the price ~24h ago (yesPrice - change1d) when it moved 10+ points on real money,
// else from an hour ago when it moved 5+ points in the last hour on $10K+ (swing.window says which).
const SWING_DAY = 0.10, SWING_HOUR = 0.05;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
export function swingOf(lead, evVol, { thinVolume = 25_000, elections = false } = {}) {
  if (!lead || !Number.isFinite(lead.yesPrice)) return null;
  const to = lead.yesPrice;
  let from = null, window = '24h';
  if (Number.isFinite(lead.change1d) && abs(lead.change1d) >= SWING_DAY && evVol >= thinVolume) from = to - lead.change1d;
  else if (Number.isFinite(lead.change1h) && abs(lead.change1h) >= SWING_HOUR && evVol >= HOT_VOLUME) { from = to - lead.change1h; window = '1h'; }
  if (from == null) return null;
  from = clamp01(from);
  const delta = to - from;
  if (abs(delta) < 0.005) return null;
  const shape = from < 0.25 && delta > 0 ? 'longshot' : from > 0.6 && delta < 0 ? 'slipping' : 'swing';
  return {
    from: Math.round(from * 1000) / 1000, to, delta: Math.round(delta * 1000) / 1000,
    flipped: (from - 0.5) * (to - 0.5) < 0, shape, title: shapeTitle(shape), window,
    ...(elections ? { note: 'Market prices, not official results' } : {}),
  };
}
// settling: pinned at 95%+ / 5%- after a 10+ point move today. Airs once as a swing card (the client's job).
export const isSettling = (lead) => !!lead && (lead.yesPrice >= 0.95 || lead.yesPrice <= 0.05) && abs(lead.change1d) >= SWING_DAY;
const DEAD_CLOSE_MS = 12 * 36e5, DEAD_CLOSE_VOL = 25_000;
// Dead content never airs (board, desks, THIS WEEK, ticker). Returns a drop code or null.
function deadReason(s, now) {
  const lead = s.lead;
  if (!lead) return 'dead:no-lead';
  const vol = s._evVol ?? lead.volume24h ?? 0;
  // near-certain weather ("98% chance of rain in Seattle") is not news, whatever moved
  if (s.category === 'weather' && (lead.yesPrice >= 0.9 || lead.yesPrice <= 0.1)) return 'dead:weather-certain';
  const closesMs = lead.closesAt ? Date.parse(lead.closesAt) - now : NaN;
  if (closesMs > 0 && closesMs <= DEAD_CLOSE_MS && vol < DEAD_CLOSE_VOL) return 'dead:closing-thin';
  // a decided race (pinned, no move today) is not a race any more; a fresh big move airs once as SETTLING
  if (boardCat(s) === 'elections' && nearCertain(lead) && !isSettling(lead) && abs(lead.change1d) < SWING_DAY) return 'dead:decided';
  return null;
}
// Top-6 floor: no lead/secondary/focus slot for a story with no news, a 3-point-or-shorter history and < $10K.
// rank.mjs runs before news/history are attached, so ingest may pass opts.enrich = { hasNews(storyId), historyLen(leadId) };
// without it the story is treated as having neither (which leaves the $10K test).
const TOP_MIN_VOL = 10_000;
function topWorthy(s, enrich) {
  if ((s._evVol ?? s.lead?.volume24h ?? 0) >= TOP_MIN_VOL) return true;
  try {
    if (enrich?.hasNews?.(s.id)) return true;
    if ((enrich?.historyLen?.(s.lead?.id) ?? 0) > 3) return true;
  } catch { /* enrichment is optional */ }
  return false;
}
// Last build's aired set, for breaking.mjs (board + desk story ids, and the lead market of each ladder story).
let lastAired = { storyIds: new Set(), ladderLeads: new Map(), families: new Map(), at: 0 };
export const airedSet = () => lastAired;

const absorbed = new Map(); // merged-away story id -> kept story id (rebuilt every buildStories call)
function mergeCrossSource(stories) {
  absorbed.clear();
  const out = [];
  // tokens are cached per story: re-tokenizing every kept story for every candidate was the rebuild's hot spot
  const tkOf = new Map();
  const tkFor = (x) => { let t = tkOf.get(x); if (!t) tkOf.set(x, (t = tokens(x.eventTitle))); return t; };
  for (const s of stories) {
    const tk = tkFor(s);
    const region = s.visual?.region?.name || null;
    const dup = out.find((o) => !o.sources.some((x) => s.sources.includes(x))
      && (o.visual?.region?.name || null) === region && jaccard(tk, tkFor(o)) >= 0.5);
    if (dup) {
      // Keep the version with more money behind it, unless its copy fell back to a quoted question and the
      // other's did not. Either way the story credits both exchanges with their own 24h volume, and is only
      // "thin" if every exchange is thin.
      const quoted = (x) => /[“”]/.test(x.headline);
      const vol = (x) => Math.max(0, ...(x.sourceVolumes || []).map((v) => v.volume24h || 0), x.lead?.volume24h || 0);
      const better = (quoted(dup) && !quoted(s)) || (quoted(dup) === quoted(s) && vol(s) > vol(dup));
      const keep = better ? s : dup, drop = better ? dup : s;
      const sv = new Map();
      for (const x of [...(keep.sourceVolumes || []), ...(drop.sourceVolumes || [])]) if (!sv.has(x.source) || x.volume24h > sv.get(x.source).volume24h) sv.set(x.source, x);
      keep.sourceVolumes = [...sv.values()].sort((a, b) => b.volume24h - a.volume24h);
      keep.sources = keep.sourceVolumes.map((x) => x.source);
      keep.thin = keep.thin && drop.thin;
      keep.score = Math.max(keep.score, drop.score);
      if (better) { out[out.indexOf(dup)] = s; }
      setExchanges(keep, drop);
      absorbed.set(drop.id, keep.id);
      for (const [k, v] of absorbed) if (v === drop.id) absorbed.set(k, keep.id);
      keep.dek = storyDek(keep);
      continue;
    }
    out.push(s);
  }
  return out.sort((a, b) => b.score - a.score);
}
// Day-after-election walls of near-identical House races are not a newscast. Let two of a family through
// at full score, then damp the rest so other news can lead.
// "Pete Hegseth out as Secretary of Defense by Nov 30 / by Dec 31 / before 2027" are one story.
const OUT_RE = /^(?:Will )?((?:[A-Z][\w.'-]*\.? ){0,3}[A-Z][\w'-]+) (?:be |is )?(?:out\b|leaves?\b|resigns?\b|(?:be )?fired\b|step down\b)/;
function subjectFamily(s) {
  for (const t of [s.lead?.title, s.eventTitle]) {
    const m = String(t || '').match(OUT_RE);
    if (m) return `out:${m[1].split(' ').pop().toLowerCase()}`;
  }
  return null;
}
function familyOf(s) {
  const sub = subjectFamily(s);
  if (sub) return sub;
  const grp = (s.lead?.tags || []).find((x) => x.startsWith('group:'));
  // a Kalshi margin/seat ladder is still part of the margin/seat family, not a family of its own
  if (grp && !isKalshiLadder(s.lead)) return grp;
  // ladders of one series family (KXAAAGASW / KXAAAGASD / KXAAAGASM, every KXRT film) are one family
  const lfam = s.lead && isKalshiLadder(s.lead) ? ladderFamily(s.lead) : null;
  const t = `${s.eventTitle} ${s.lead?.title || ''}`;
  if (/\b[A-Z]{2}-\d{1,2}\b/.test(t) || /\bhouse (race|seat|winner)\b/i.test(t) && !/seats? after/i.test(t)) return 'house-race';
  if (/margin|\bby (between )?\d+(\.\d+)?%|\d+\s*-\s*\d+%/i.test(t)) return 'margin';
  if (/\bseats?\b/i.test(t)) return 'seat-count';
  if (/governor|gubernatorial/i.test(t)) return 'gov-race';
  if (/\bsenate\b/i.test(t)) return 'senate-race';
  return lfam || grp || `event:${s.id}`;
}
// Margin-of-victory brackets ("wins Texas Senate race by 12+ pts", "popular vote margin between...") are not a lead.
export const MARGIN_RE = /margin|\bby (between )?\d+(\.\d+)?\+?\s*(%|points?|pts)|\bby \d+(\.\d+)?\+|popular vote .*\b(between|over|under|above|below)\b|\d+\s*[-–]\s*\d+\s*(%|points?|pts)/i;
export const isMarginBracket = (s) => MARGIN_RE.test(`${s?.eventTitle || ''} ${s?.lead?.title || ''} ${s?.lead?.outcome || ''}`);
function diversify(stories) {
  const seen = {};
  const first = {};
  const adj = [];
  for (const s of stories) {
    const f = familyOf(s);
    const k = (seen[f] = (seen[f] || 0) + 1);
    // one person's departure is one story: air the best-scoring deadline, point the others at it
    if (f.startsWith('out:')) {
      if (k > 1) { absorbed.set(s.id, first[f]); for (const [a, b] of absorbed) if (b === s.id) absorbed.set(a, first[f]); continue; }
      first[f] = s.id;
    }
    adj.push({ s, v: s.score * (k <= 2 ? 1 : 0.6 ** (k - 2)) * (isMarginBracket(s) ? 0.2 : 1) });
  }
  return adj.sort((a, b) => b.v - a.v).map((x) => x.s);
}

// ---------- board variety + desks ----------
// The day after an election, pure move x volume puts 19 races on a 30-story board. The score still decides
// order, but the board is picked with category quotas, every category with something worth airing gets a seat,
// and the top 6 (lead, secondaries, STORY FOCUS pool) span several categories.
const QUOTA = { elections: 7, politics: 6 };
const QUOTA_DEFAULT = 6;
const MIN_LIVE_VOLUME = 5_000;
// Minimal quality floor for a reserved seat or a desk slot: some money trading, not deadline decay,
// not pinned near-certain without a move.
// The filter sometimes tags a House race or seat count 'politics'. For quotas, the top-6 spread and desks
// such stories count as elections (story.category itself is unchanged).
const ELECTION_FAMILY = new Set(['house-race', 'margin', 'seat-count', 'gov-race', 'senate-race']);
export function boardCat(s) {
  if (s.category !== 'politics') return s.category;
  if (ELECTION_FAMILY.has(familyOf(s))) return 'elections';
  const t = `${s.eventTitle} ${s.lead?.title || ''}`;
  if (/\b(mayor(al)?|election winner|midterms?|primary|popular vote|electoral)\b/i.test(t) && !/\b(prime minister|nominee|nomination|presidential run)\b/i.test(t)) return 'elections';
  return s.category;
}
function qualifies(s, now) {
  const lead = s.lead;
  if (!lead) return false;
  const floor = s.category === 'elections' || s.category === 'politics' ? MIN_LIVE_VOLUME : 2_000; // quieter non-election questions can take desk slots (bigger-pool pass)
  if ((s._evVol ?? lead.volume24h ?? 0) < floor) return false;
  if (isDecay(lead, now)) return false;
  if (nearCertain(lead) && !justArrived(lead)) return false;
  return true;
}

function selectBoard(ranked, limit, now, enrich) {
  const quota = (c) => QUOTA[c] ?? QUOTA_DEFAULT;
  const picked = new Set();
  const counts = {};
  const take = (s) => { picked.add(s); counts[boardCat(s)] = (counts[boardCat(s)] || 0) + 1; };
  // 1. reserve a seat for the best qualifying story in every category
  const bestByCat = new Map();
  for (const s of ranked) if (!bestByCat.has(boardCat(s)) && qualifies(s, now)) bestByCat.set(boardCat(s), s);
  for (const s of bestByCat.values()) if (picked.size < limit) take(s);
  // 2. fill by rank within quotas, qualifying stories first, then anything within quota
  for (const pass of [true, false]) {
    for (const s of ranked) {
      if (picked.size >= limit) break;
      if (picked.has(s) || (counts[boardCat(s)] || 0) >= quota(boardCat(s))) continue;
      if (pass && !qualifies(s, now)) continue;
      take(s);
    }
  }
  // 3. not enough candidates: relax the quotas
  for (const s of ranked) { if (picked.size >= limit) break; if (!picked.has(s)) take(s); }
  const order = new Map(ranked.map((s, i) => [s, i]));
  const board = [...picked].sort((a, b) => order.get(a) - order.get(b));
  return orderTop(board, 6, 4, (s) => qualifies(s, now) && topWorthy(s, enrich), (s) => qualifies(s, now));
}

// #1 stays the strongest story. The rest of the top `n` is the best story of each other category (in rank
// order) until `minCats` categories are covered, then the next best with at most 2 per category, then
// interleaved so the same category never sits back to back when it can be avoided.
function orderTop(board, n = 6, minCats = 4, ok = () => true, okLoose = ok) {
  if (board.length <= 2) return board;
  // #1 is the best story that clears the floor (quiet nights relax it below)
  const first = board.find(ok) || board.find(okLoose) || board[0];
  const top = [first];
  const cats = new Set([boardCat(first)]);
  for (const s of board) {
    if (top.length >= n || cats.size >= minCats) break;
    if (!cats.has(boardCat(s)) && ok(s)) { top.push(s); cats.add(boardCat(s)); }
  }
  const per = (c) => top.filter((x) => boardCat(x) === c).length;
  for (const s of board) { if (top.length >= n) break; if (!top.includes(s) && per(boardCat(s)) < 2 && ok(s)) top.push(s); }
  // quiet night: relax to the old floor, then to anything, so the top 6 still fills
  for (const s of board) { if (top.length >= n) break; if (!top.includes(s) && okLoose(s)) top.push(s); }
  for (const s of board) { if (top.length >= n) break; if (!top.includes(s)) top.push(s); }
  // interleave (keep #1 first): repeatedly take the best remaining whose category differs from the previous
  const rest = top.slice(1).sort((a, b) => board.indexOf(a) - board.indexOf(b));
  const out = [top[0]];
  while (rest.length) {
    const prev = boardCat(out[out.length - 1]);
    const i = rest.findIndex((s) => boardCat(s) !== prev);
    out.push(rest.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return [...out, ...board.filter((s) => !top.includes(s))];
}

export const DESKS = [
  { id: 'economy', title: 'ECONOMY DESK', categories: ['economy'] },
  { id: 'tech', title: 'TECH & SCIENCE', categories: ['tech', 'science', 'health'] },
  { id: 'world', title: 'WORLD DESK', categories: ['geopolitics', 'world'] },
  { id: 'culture', title: 'CULTURE DESK', categories: ['culture', 'weather'] },
  { id: 'politics', title: 'POLITICS DESK', categories: ['politics', 'courts'] },
];
function buildDesks(ranked, now, { max = 12, min = 2 } = {}) {
  const desks = [];
  for (const d of DESKS) {
    const fam = {};
    const picks = [];
    for (const s of ranked) {
      if (picks.length >= max) break;
      if (!d.categories.includes(boardCat(s)) || !qualifies(s, now)) continue;
      const f = familyOf(s);
      if ((fam[f] = (fam[f] || 0) + 1) > (f.startsWith('ladder:') ? 1 : 2)) continue;   // no desk of six Fed-rate brackets or two gas lines
      picks.push(s);
    }
    if (picks.length >= min) desks.push({ id: d.id, title: d.title, categories: d.categories, stories: picks });
  }
  return desks;
}

// Pick up to `limit` items (already in rank order) in passes. A pass returns 'caps' to take items within the caps
// (per x.cat <= caps.cat, per x.fam <= caps.fam), true to take them regardless, false to skip. Rank order is kept.
function capPick(items, limit, passes, caps = {}) {
  const picked = new Set();
  const nCat = {}, nFam = {};
  for (const pass of passes) {
    for (const x of items) {
      if (picked.size >= limit) break;
      if (picked.has(x)) continue;
      const ok = pass(x);
      if (!ok) continue;
      if (ok === 'caps' && ((caps.cat && (nCat[x.cat] || 0) >= caps.cat) || (caps.fam && x.fam && (nFam[x.fam] || 0) >= caps.fam))) continue;
      picked.add(x);
      nCat[x.cat] = (nCat[x.cat] || 0) + 1;
      if (x.fam) nFam[x.fam] = (nFam[x.fam] || 0) + 1;
    }
  }
  return items.filter((x) => picked.has(x));
}

// ---------- main ----------
export function buildStories(markets, config = {}, { now = Date.now(), enrich = null } = {}) {
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  const thinVolume = config.thinVolume ?? 25_000;
  const L = config.limits || {};
  const limStories = L.stories ?? 30;
  const limMovers = L.movers ?? 20;
  const limClosing = Math.min(L.closing ?? 8, 8);
  const closingMs = (L.closingDays ?? 7) * DAY;
  const perStory = L.marketsPerStory ?? 5;

  const dropped = {};
  const groups = new Map();
  let kept = 0;
  const seen = new Set();
  for (const raw of markets || []) {
    if (!raw || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const c = classify(raw, config, { now: nowMs });
    if (!c.keep) { dropped[c.reason] = (dropped[c.reason] || 0) + 1; continue; }
    kept++;
    const m = { ...raw, category: c.category };
    const key = m.eventId || m.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  const stories = [];
  for (const [eventId, group] of groups) {
    const lk = ladderKind(group);
    const ladder = !!lk;
    const evVol = group.reduce((a, m) => a + (m.volume24h || 0), 0);
    const lead = lk === 'strike' ? pickLine(group, evVol) : pickLead(group, { ladder, now: nowMs });
    // category: the lead's, but an event-level majority would be nicer; lead is fine for one source/event
    const category = lead.category;
    const score = scoreStory(lead, group, evVol, category, { now: nowMs, closingMs, thinVolume });
    const closesMs = lead.closesAt ? Date.parse(lead.closesAt) - nowMs : NaN;
    const isMover = (abs(lead.change1d) >= 0.05 || hotNow(lead, evVol)) && evVol >= thinVolume && !isDecay(lead, nowMs);
    const kind = isMover ? 'mover' : closesMs > 0 && closesMs <= closingMs ? 'closing' : 'favorite';
    const sorted = [...group].sort((a, b) => b.yesPrice - a.yesPrice);
    let board = sorted.slice(0, perStory);
    if (!board.includes(lead)) board = [...board.slice(0, perStory - 1), lead].sort((a, b) => b.yesPrice - a.yesPrice);
    // a non-exclusive ladder is not a race: show the lead rung on its own, never as competing bars
    if (ladder) board = [lead];
    for (const m of board) m.label = outcomeLabel(m);
    const rungs = lk === 'strike' ? neighborRungs(group, lead) : null;
    // a ladder's size is the whole event's 24h volume, not one rung's
    const vol = lk === 'strike' ? evVol : lead.volume24h || 0;
    const story = {
      id: eventId,
      eventTitle: lead.eventTitle,
      category,
      sources: [...new Set(group.map((m) => m.source))],
      lead,
      markets: board,
      score: Math.round(score * 100) / 100,
      kind,
      headline: '',
      dek: '',
      thin: vol < thinVolume,
      ladder,
      ...(lk ? { ladderKind: lk } : {}),
      ...(rungs && rungs.length > 1 ? { rungs } : {}),
      sourceVolumes: [{ source: lead.source, volume24h: vol }],
      closesAt: lead.closesAt || null,
      history: null,
      news: [],
      visual: null,
    };
    Object.defineProperty(story, '_group', { value: group, enumerable: false });
    Object.defineProperty(story, '_groupSize', { value: group.length, enumerable: false });
    Object.defineProperty(story, '_now', { value: nowMs, enumerable: false });
    Object.defineProperty(story, '_evVol', { value: evVol, enumerable: false });
    story.headline = storyHeadline(story);
    story.short = shortHeadline(story.headline);   // number-free version for cards that show the big % separately
    story.dek = storyDek(story);
    story.visual = visualFor(story, { now: nowMs });
    story.swing = swingOf(lead, evVol, { thinVolume, elections: boardCat(story) === 'elections' });
    story.settling = isSettling(lead);
    story.exchanges = null;
    story.agree = null;
    stories.push(story);
  }
  stories.sort((a, b) => b.score - a.score);
  const merged = diversify(mergeCrossSource(stories));
  const deadIds = new Set();
  const ranked = merged.filter((s) => {
    const r = deadReason(s, nowMs);
    if (!r) return true;
    dropped[r] = (dropped[r] || 0) + 1;
    deadIds.add(s.id);
    return false;
  });

  // movers: one per event, by weighted |change1d| (faded when flat, boosted by a move in the last hour), skipping
  // decay drift and trivial moves. Then picked with caps so the ticker is not 20 election races: any one category
  // (boardCat, so House/seat/margin markets count as elections) <= 6, <= 2 per story family. Strong movers ($10K+
  // and 3+ points) fill first; the caps relax only when there are not enough candidates.
  const pool = [];
  const lineOf = new Map(stories.filter((s) => s.ladderKind === 'strike').map((s) => [s.id, s.lead]));
  for (const [eventId, group] of groups) {
    // a ladder's far rungs swing 40 points when the line moves a cent through them: only the line is a mover
    const lp = lineOf.has(eventId) ? [lineOf.get(eventId)] : group;
    const cands = lp.filter((m) => abs(m.change1d) >= 0.02 && !isDecay(m, nowMs));
    if (!cands.length) continue;
    const w = (m) => weightedMove(m) * freshness(m) + hourBoost(m, m.volume24h || 0) / 100 * log10(10 + (m.volume24h || 0));
    const best = cands.reduce((a, b) => (w(b) > w(a) ? b : a));
    const nm = moverName(best);
    pool.push({ ...best, storyId: eventId, thin: (best.volume24h || 0) < thinVolume, line: marketLine(best), label: nm.label, context: nm.context, _w: w(best) * (best.volume24h < thinVolume ? 0.5 : 1) });
  }
  pool.sort((a, b) => b._w - a._w);
  // One mover per race across exchanges: point merged-away events at the story that aired, keep the first.
  const storyById = new Map(stories.map((s) => [s.id, s]));
  const moverSeen = new Set();
  const uniq = [];
  for (const m of pool) {
    m.storyId = absorbed.get(m.storyId) || m.storyId;
    if (moverSeen.has(m.storyId) || deadIds.has(m.storyId)) continue;
    moverSeen.add(m.storyId);
    const st = storyById.get(m.storyId);
    uniq.push({ m, cat: st ? boardCat(st) : m.category, fam: st ? familyOf(st) : `event:${m.storyId}` });
  }
  const strongMover = (m) => (m.volume24h || 0) >= HOT_VOLUME && (abs(m.change1d) >= 0.03 || hotNow(m));
  const movers = capPick(uniq, limMovers, [
    (x) => strongMover(x.m) && 'caps',
    (x) => strongMover(x.m),
    (x) => 'caps',
    () => true,
  ], { cat: 6, fam: 2 }).map((x) => { delete x.m._w; return x.m; });

  // THIS WEEK: thin markets sink below ones with real money behind them; decaying deadlines are not news.
  // At most 3 per category (relaxed only when there are not enough).
  const closingRanked = ranked
    .filter((s) => { const ms = s.closesAt ? Date.parse(s.closesAt) - nowMs : NaN; return ms > 0 && ms <= closingMs && !isDecay(s.lead, nowMs); })
    .map((s, i) => ({ s, v: s.score * (s.thin ? 0.35 : 1), i }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((x) => ({ s: x.s, cat: boardCat(x.s), fam: null }));
  // Only non-thin stories, unless there are none at all (then the thin ones, ranked, rather than nothing).
  const solid = closingRanked.filter((x) => !x.s.thin);
  const closing = capPick(solid.length ? solid : closingRanked, limClosing, [() => 'caps', () => true], { cat: 3 }).map((x) => x.s);
  const board = selectBoard(ranked, limStories, nowMs, enrich);
  const desks = buildDesks(ranked, nowMs, { max: L.deskStories ?? 12 });
  const aired = [...board, ...desks.flatMap((d) => d.stories)];
  lastAired = {
    storyIds: new Set(aired.map((s) => s.id)),
    ladderLeads: new Map(aired.filter((s) => s.ladder).map((s) => [s.id, s.lead.id])),
    families: new Map(aired.map((s) => [s.id, familyOf(s)])),
    at: nowMs,
  };

  return {
    stories: board,
    desks,
    movers,
    closing,
    stats: { input: (markets || []).length, kept, events: groups.size, dropped },
    aliases: Object.fromEntries(absorbed),   // merged-away event id -> aired story id
  };
}

export { familyOf };
export default { buildStories, inferRegion, airedSet, swingOf, isSettling };
