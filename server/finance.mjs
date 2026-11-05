// Stock and bond moves (QUEUED-FIXES item 12, research/financial-data.md, config.finance).
// One server poller: Yahoo chart quotes for the watchlist on a market-hours cadence (spaced requests, backoff), the
// Treasury.gov curve hourly (2Y + official closes). Each sweep: detect BIG MOVES (thresholds + hysteresis), then for
// each one (a) find a wire headline (alias table), (b) pick paired prediction markets from the EXPLICIT pairing table
// (ingest index first, else fetched by slug/series), (c) fetch 5d + 1mo history. Publishes
//   state.finance = { moves: [...gated...], quotes: [...ticker...], session, asOf, note, stats }
// News-driven rule: a move airs only with a headline AND >= 1 well-traded paired market; otherwise ticker only.
import { fetchQuote, fetchHistory, fetchTreasury, sessionAt, quoteSession, etClock } from './sources/finance.mjs';
import { parsePolymarketEvents } from './sources/polymarket.mjs';
import { parseKalshiMarkets } from './sources/kalshi.mjs';
import { getJSON } from './http.mjs';
import { rankFinanceMoves } from './editorial/rank.mjs';
import { log } from './log.mjs';

const GAMMA = 'https://gamma-api.polymarket.com';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e) => String(e?.message || e).slice(0, 200);
const abs = Math.abs;
const KIND_ORDER = { index: 0, yield: 1, commodity: 2, stock: 3 };

// ---- thresholds + hysteresis (pure) ------------------------------------------------------------------------------
export function thresholdFor(w, F) {
  const T = F.thresholds || {};
  return T[w.tier] || T[w.kind] || (w.kind === 'stock' ? T.stock : null) || { day: 3 };
}
/** Day move in the threshold's unit: points for yields, % otherwise. */
export const dayMove = (w, q) => (w.kind === 'yield' ? q.change : q.changePct);
/** Move over the last ~60 minutes of the intraday series, same unit. */
export function swingMove(w, q) {
  const pts = q.points || [];
  if (pts.length < 4) return null;
  const last = pts[pts.length - 1];
  let base = null;
  for (let i = pts.length - 1; i >= 0; i--) { if (last.t - pts[i].t >= 3600) { base = pts[i]; break; } }
  if (!base || last.t - base.t > 5400) return null;
  return w.kind === 'yield' ? last.p - base.p : base.p ? ((last.p - base.p) / base.p) * 100 : null;
}
/** severity >= 1 is a big move; 0.5 highlights in the ticker. */
export function severityOf(w, q, F) {
  const thr = thresholdFor(w, F);
  const d = dayMove(w, q);
  const s = thr.swing ? swingMove(w, q) : null;
  const sd = d != null && thr.day ? abs(d) / thr.day : 0;
  const ss = s != null ? abs(s) / thr.swing : 0;
  const dir = (sd >= ss ? d : s) ?? 0;
  return { sev: Math.max(sd, ss), by: ss > sd ? 'swing' : 'day', direction: dir >= 0 ? 'up' : 'down', day: d, swing: s, thr };
}
/** One hysteresis step. st = {active, firedSev, firedAt, level}. Returns {st, fired} (fired = (re)enters the air). */
export function stepHysteresis(st, sev, nowMs, H = {}) {
  const grow = H.grow ?? 1.5, reairMs = (H.reairHours ?? 4) * 36e5, exit = H.exit ?? 0.8;
  const s = { ...(st || { active: false, firedSev: 0, firedAt: 0, level: 0 }) };
  if (!s.active) {
    if (sev >= 1) return { st: { active: true, firedSev: sev, firedAt: nowMs, level: s.level + 1 }, fired: true };
    return { st: s, fired: false };
  }
  if (sev < exit) return { st: { ...s, active: false }, fired: false };
  if (sev >= s.firedSev * grow || nowMs - s.firedAt >= reairMs) return { st: { active: true, firedSev: Math.max(sev, 1), firedAt: nowMs, level: s.level + 1 }, fired: true };
  return { st: s, fired: false };
}

// ---- headline match (pure) ---------------------------------------------------------------------------------------
const MARKET_WORDS = /\b(falls?|fell|drops?|dropped|slides?|slid|slips?|tumbles?|tumbled|sinks?|sank|plunges?|plunged|plummets?|slumps?|retreats?|sell-?offs?|rout|losses|lower|jumps?|jumped|surges?|surged|soars?|soared|rall(y|ies|ied)|rises?|rose|climbs?|climbed|gains?|gained|rebounds?|higher|records?|futures|shares|stocks?|prices?|yields?|markets?|trading|investors|wrap|pressure|unwind|selloff|earnings|revenue|guidance|forecast|outlook|valuation|market cap|analysts?|downgrades?|upgrades?|bonds?|treasurys|declines?|declined|dips?|dipped|sheds?|skids?|tanks?|tanked|spikes?|spiked|advances?|edges)\b/i;
const UP_RE = /\b(jumps?|jumped|surges?|surged|soars?|soared|rall(y|ies|ied)|rises?|rose|rising|climbs?|climbed|gains?|gained|rebounds?|rebounded|higher|record high|tops|spikes?|spiked|advances?|advanced|pops?|popped|edges? up|inches up|recovers?|recovered)\b/i;
const DOWN_RE = /\b(falls?|fell|falling|drops?|dropped|slides?|slid|slips?|slipped|tumbles?|tumbled|sinks?|sank|plunges?|plunged|plummets?|slumps?|slumped|retreats?|sell-?offs?|selloff|rout|losses|lower|under pressure|unwind|declines?|declined|dips?|dipped|sheds?|skids?|skidded|tanks?|tanked|sags?|craters?|cratered|edges? down|loses?|lost)\b/i;
const FOREIGN_RE = /\b(european|europe's|asian|asia's|chinese|china's|japan(ese)?|nikkei|hang seng|ftse|london|south african|indian|australian|canadian|german|dax|korean?|brazil(ian)?|stoxx|tsx|global)\b/i;
const SKIP_CATS = new Set(['sports', 'games', 'culture', 'weather']);
const aliasRe = (list) => (list?.length ? new RegExp(`(?<![\\w&])(?:${list.join('|')})(?!\\w)`, 'i') : null);
const reCache = new WeakMap();
function aliasesOf(w) {
  if (!reCache.has(w)) reCache.set(w, { strong: aliasRe(w.strong), broad: aliasRe(w.broad) });
  return reCache.get(w);
}
// ---- headline direction (pure) -------------------------------------------------------------------------------------
// A headline airs only when it does not contradict the move: a Dow "down 1.6%" move never pairs with "Dow rises...".
// The verb is read from the clause that names the move's subject ("Dow falls as Nvidia rises" -> down for the Dow), and an
// explicit "up/down X%" or "+/-X%" wins over verbs. Mixed or unreadable clauses are neutral (no reject, no bonus).
const CLAUSE_SPLIT = /\s+(?:as|while|but|even as|after|amid|with|despite|before|though|and)\s+|[;:|]|\s[-\u2013\u2014]\s/i;
const PCT_UP = /\b(?:up|higher|gains?|gained|adds?|rises?|rose|climbs?|climbed|jumps?|jumped|surges?|surged)\s+(?:by\s+)?(?:about\s+|nearly\s+|more than\s+|over\s+)?\d+(?:\.\d+)?\s?%|(?:^|[\s(])\+\d+(?:\.\d+)?\s?%/i;
const PCT_DOWN = /\b(?:down|lower|loses?|lost|sheds?|shed|falls?|fell|drops?|dropped|slides?|slid|sinks?|sank|slips?|slipped|slumps?|slumped|tumbles?|tumbled|declines?|declined)\s+(?:by\s+)?(?:about\s+|nearly\s+|more than\s+|over\s+)?\d+(?:\.\d+)?\s?%|(?:^|[\s(])[-\u2212\u2013]\d+(?:\.\d+)?\s?%/i;
const FROM_HIGH = /\b(?:from|off|below|near|after (?:hitting|touching|reaching)|following)\s+(?:its\s+|a\s+|an\s+|the\s+)?(?:all-time|record|\d+-?(?:week|month|year))\s+(?:highs?|peaks?|records?)\b/gi;
function dirOf(text) {
  const t = String(text).replace(FROM_HIGH, ' ');
  const pu = PCT_UP.test(t), pd = PCT_DOWN.test(t);
  if (pu !== pd) return pu ? 'up' : 'down';
  const up = UP_RE.test(t), down = DOWN_RE.test(t);
  if (up === down) return null;
  return up ? 'up' : 'down';
}
/** 'up' | 'down' | null: the direction the headline gives the thing the move is about. */
export function headlineDirection(title, aliasRes = []) {
  const parts = String(title).split(CLAUSE_SPLIT);
  for (const re of aliasRes) {
    if (!re) continue;
    for (const part of parts) {
      if (!re.test(part)) continue;
      const d = dirOf(part);
      if (d) return d;
    }
  }
  // no readable clause names the subject: fall back to the whole title only when it reads one way
  return dirOf(title);
}
const INDEX_NAMES = { '^GSPC': /s&p|spx/i, '^NDX': /nasdaq/i, '^DJI': /\bdow\b/i };
const idxOthers = (sym) => Object.entries(INDEX_NAMES).filter(([k]) => k !== sym).map(([, re]) => re);

/** Best wire headline for a move, or null. items: newsroom archive [{title, outlet, url, publishedAt, category}]. */
export function matchHeadline(w, sv, items, { now = Date.now(), hours = 6, prev = null } = {}) {
  const A = aliasesOf(w);
  const windowMs = hours * 36e5;
  let best = null;
  for (const it of items || []) {
    const t = Date.parse(it?.publishedAt);
    if (!it?.title || !Number.isFinite(t) || now - t > windowMs || t - now > 10 * 60_000) continue;
    if (SKIP_CATS.has(it.category)) continue;
    const title = String(it.title);
    const strong = A.strong?.test(title);
    const broad = !strong && A.broad?.test(title);
    if (!strong && !broad) continue;
    const marketish = MARKET_WORDS.test(title);
    if (!marketish) continue;   // the move needs a market story, not a product launch that names the company
    // a foreign-market headline ("European Stocks Hit Record") is not the US index / sector move
    if (!strong && FOREIGN_RE.test(title) && w.kind !== 'commodity') continue;
    let score = strong ? 3 : 1.5;
    if (marketish) score += 1;
    // another index's headline ("Dow rises") is not this index's move unless it names this one as well
    if (w.kind === 'index' && INDEX_NAMES[w.symbol] && !INDEX_NAMES[w.symbol].test(title) && idxOthers(w.symbol).some((re) => re.test(title))) continue;
    // direction: a headline that gives the subject the opposite direction never airs on this move. For yields only when
    // the clause is about yields ("Treasurys gain" means yields fell); the VIX is not direction-tested (stocks stories).
    const want = w.symbol === '^VIX' ? null : sv.direction;
    if (want) {
      const hd = headlineDirection(title, strong ? [A.strong] : [A.broad]);
      const yieldsOk = w.kind !== 'yield' || /\byields?\b/i.test(title);
      if (hd && yieldsOk) { if (hd !== want) continue; score += 1; }
    }
    // prefer the headline that names the specific thing (company / index / symbol), and as its subject
    if (strong) {
      const m = A.strong.exec(title);
      if (m && m.index <= 12) score += 0.5;
      if (w.name && title.toLowerCase().includes(String(w.name).toLowerCase())) score += 0.5;
    }
    score += 2 * (1 - (now - t) / windowMs);
    if (it.category === 'markets' || it.category === 'economy') score += 0.5;
    if (prev && prev.title === title) score += 0.75;   // stickiness: keep the headline on air unless a clearly better one lands
    if (score < 3.5) continue;
    if (!best || score > best.score) best = { score, item: it };
  }
  if (!best) return null;
  const it = best.item;
  return { title: it.title, outlet: String(it.outlet || '').replace(/ via .*$/, ''), publishedAt: it.publishedAt, url: it.url || null, score: Math.round(best.score * 10) / 10 };
}

// ---- paired markets (pure) ----------------------------------------------------------------------------------------
const fmtNum = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
/** "Above $89.99" -> "above $90", "26,699.99 or below" -> "below 26,700", "28,200 to 28,299.99" -> "between 28,200 and 28,300". */
export function cleanOutcome(o) {
  const s = String(o || '').trim();
  const val = (raw, money, pct) => {
    let n = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(n)) return raw;
    if (pct) return `${n.toFixed(2).replace(/\.?0+$/, (x) => (x.startsWith('.') ? '' : x)).replace(/^(\d+)$/, '$1')}%`;
    const frac = n - Math.floor(n);
    if (frac >= 0.98) n = Math.ceil(n);
    const d = Number.isInteger(n) || (money && n >= 10) ? 0 : 2;
    return `${money ? '$' : ''}${fmtNum(money && n >= 10 ? Math.round(n) : n, d)}`;
  };
  let m = s.match(/^(above|below|over|under)\s+(\$?)([\d,.]+)\s*(%?)$/i);
  if (m) return `${m[1].toLowerCase()} ${val(m[3], !!m[2], !!m[4])}`;
  m = s.match(/^(\$?)([\d,.]+)\s*(%?)\s+or (above|below|higher|lower)$/i);
  if (m) {
    const raw = Number(m[2].replace(/,/g, ''));
    if (/below|lower/i.test(m[4]) && raw - Math.floor(raw) >= 0.98) return `below ${val(m[2], !!m[1], !!m[3])}`;
    return `${val(m[2], !!m[1], !!m[3])} or ${m[4].toLowerCase()}`;
  }
  m = s.match(/^(\$?)([\d,.]+)\s*(%?)\s+to\s+\$?([\d,.]+)\s*%?$/i);
  if (m) return `between ${val(m[2], !!m[1], !!m[3])} and ${val(m[4], !!m[1], !!m[3])}`;
  return s;
}
/** Fed outcome -> plain English ("25 bps increase" / "Hike 25bps" -> "a quarter-point Fed hike"). Never "bps". */
export function fedPhrase(o) {
  const s = String(o || '').toLowerCase();
  if (/no change|maintain|hold|unchanged|pause/.test(s)) return 'the Fed holding rates';
  const n = Number(s.match(/(\d+)\s*\+?\s*bps?/)?.[1] || 25);
  const plus = /\d+\s*\+/.test(s);
  const size = n >= 50 ? (plus ? 'a half-point or bigger' : 'a half-point') : n >= 25 ? 'a quarter-point' : 'a small';
  if (/increase|hike|raise/.test(s)) return `${size} Fed hike`;
  if (/decrease|cut|lower/.test(s)) return `${size} Fed cut`;
  return s;
}
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const etTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
/** "On Nov 5, 2026 at 11am EST" (Kalshi event sub-title) or the close time -> "at 11am today" / "tomorrow" / "on Nov 6". */
export function whenOf(m, now = Date.now()) {
  const today = etClock(now).date;
  const tomorrow = etClock(now + 864e5).date;
  let date = null, time = null;
  const sub = String(m?.eventSub || '');
  const d = sub.match(/\b([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})/);
  if (d && MON[d[1].toLowerCase()] != null) date = `${d[3]}-${String(MON[d[1].toLowerCase()] + 1).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}`;
  const tm = sub.match(/\bat (\d{1,2}(?::\d\d)?\s*[ap]m)\b/i);
  if (tm) time = tm[1].replace(/\s+/g, '').toLowerCase();
  if (!date && m?.closesAt) {
    const t = Date.parse(m.closesAt);
    if (Number.isFinite(t)) { date = etClock(t).date; time = etTime.format(new Date(t)).replace(':00', '').replace(/\s+/g, '').toLowerCase(); }
  }
  if (!date) return '';
  const day = date === today ? 'today' : date === tomorrow ? 'tomorrow' : `on ${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)} ${Number(date.slice(8))}`;
  return time ? `at ${time} ${day}` : day;
}
const monthOf = (m) => { const t = Date.parse(m?.closesAt); return Number.isFinite(t) ? MONTHS[Number(etClock(t).date.slice(5, 7)) - 1] : ''; };
export function pairLabel(def, m, now = Date.now()) {
  const o = cleanOutcome(m.outcome || '');
  return String(def.phrase || '{o}')
    .replace('{o}', o).replace('{fed}', fedPhrase(m.outcome || m.title)).replace('{when}', whenOf(m, now)).replace('{month}', monthOf(m))
    .replace(/\s+/g, ' ').trim();
}
const ptsOf = (d) => (d == null ? null : Math.sign(d) * Math.round(abs(d) * 100));
/** "63% chance of Apple being the world's largest company at the end of December, up 10 points today" */
export function marketLine(label, yes, change1d) {
  const p = Math.round(yes * 100);
  const pct = yes < 0.01 ? 'Under 1%' : yes > 0.99 ? 'Over 99%' : `${p}%`;
  const pts = ptsOf(change1d);
  const chg = pts ? `, ${pts > 0 ? 'up' : 'down'} ${abs(pts)} point${abs(pts) === 1 ? '' : 's'} today` : '';
  return `${pct} chance of ${label}${chg}`;
}
/** Pick the paired market rows for one pairing definition from a candidate market list (normalized Market shape). */
export function pickPaired(def, markets, w, { now = Date.now(), minVolume = {}, thinVolume = 25_000 } = {}) {
  const min = minVolume[def.source] ?? 500;
  let ms = (markets || []).filter((m) => m && m.source === def.source && (m.volume24h || 0) >= min && m.yesPrice != null
    && !(m.closesAt && Date.parse(m.closesAt) <= now + 5 * 60_000));
  if (def.event) ms = ms.filter((m) => m.eventId === `ks:${def.event}`);
  if (!ms.length) return [];
  // multi-event series (Kalshi daily/hourly ladders): the soonest event that still has a well-traded market
  const byEv = new Map();
  for (const m of ms) { if (!byEv.has(m.eventId)) byEv.set(m.eventId, []); byEv.get(m.eventId).push(m); }
  if (byEv.size > 1 && def.pick !== 'single') {
    const evs = [...byEv.values()].sort((a, b) => (Date.parse(a[0].closesAt) || Infinity) - (Date.parse(b[0].closesAt) || Infinity));
    ms = evs[0];
  }
  const top = (arr, f) => arr.reduce((a, b) => (f(b) > f(a) ? b : a));
  let picked = [];
  if (def.pick === 'company') {
    const re = w.company ? new RegExp(`\\b(${w.company})\\b`, 'i') : null;
    const own = re ? ms.find((m) => re.test(m.outcome || m.title)) : null;
    const leader = top(ms, (m) => m.yesPrice);
    // a long shot that is not moving says nothing about this company's day ("under 1% chance of Tesla ...")
    const telling = own && (own.yesPrice >= 0.03 || abs(own.change1d || 0) >= 0.02);
    picked = telling ? (own === leader ? [own] : [own, leader]) : [];
  } else if (def.pick === 'outcome') {
    const re = new RegExp(`\\b(${def.outcome})\\b`, 'i');
    picked = ms.filter((m) => re.test(m.outcome || m.title)).slice(0, 1);
  } else if (def.pick === 'leader') picked = [top(ms, (m) => m.yesPrice)];
  else if (def.pick === 'line') picked = [top(ms, (m) => -abs(m.yesPrice - 0.5) * 1e6 + (m.volume24h || 0) / 1e9)];
  else picked = [top(ms, (m) => m.volume24h || 0)];   // topvol, single
  return picked.map((m) => {
    const label = pairLabel(def, m, now);
    const evVol = (byEv.get(m.eventId) || [m]).reduce((a, x) => a + (x.volume24h || 0), 0);
    return {
      id: m.id, label, line: marketLine(label, m.yesPrice, m.change1d), yesPrice: m.yesPrice, change1d: m.change1d ?? null,
      source: m.source, url: m.url, volume24h: Math.round(m.volume24h || 0), thin: evVol < thinVolume, closesAt: m.closesAt || null,
      updatedAt: m.updatedAt || null,
    };
  });
}

// ---- copy (pure) --------------------------------------------------------------------------------------------------
const WEEKDAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' });
export function priceText(w, price) {
  if (price == null) return '';
  if (w.kind === 'yield') return `${price.toFixed(2)}%`;
  if (w.unit === '$' || w.kind === 'stock') return `$${fmtNum(price, 2)}`;
  return fmtNum(price, 2);
}
/** Plain-English copy for a quote. when: 'today' (session open), 'close' (closed today), or a weekday name. */
export function moveCopy(w, q, { session = 'open', now = Date.now(), sev = 1 } = {}) {
  const name = w.short || w.name;
  const d = w.kind === 'yield' ? q.change : q.changePct;
  if (d == null) return { headline: `${name} at ${priceText(w, q.price)}`, change: '', price: priceText(w, q.price) };
  const up = d >= 0;
  const mag = w.kind === 'yield' ? `${abs(d).toFixed(2)} point${abs(d).toFixed(2) === '1.00' ? '' : 's'}` : `${abs(d).toFixed(1)}%`;
  const sameDay = q.time ? etClock(q.time * 1000).date === etClock(now).date : true;
  // live: the regular session is open, or a future/FX that is still printing (oil, gold, dollar trade nearly 24h)
  const ticking = q.time && now / 1000 - q.time < 1800;
  const live = session === 'open' || (w.kind === 'commodity' && ticking);
  const when = live ? 'today' : sameDay ? 'at the close' : `on ${WEEKDAY.format(new Date(q.time * 1000))}`;
  const verb = up ? (sev >= 2 ? 'jumps' : 'rises') : (sev >= 2 ? 'slides' : 'falls');
  const price = priceText(w, q.price);
  let headline;
  if (w.kind === 'yield') {
    headline = live ? `${name} ${up ? 'rises' : 'falls'} to ${price}, ${up ? 'up' : 'down'} ${mag} today`
      : `${name} ${when === 'at the close' ? 'ends at' : 'ended at'} ${price}, ${up ? 'up' : 'down'} ${mag}${when === 'at the close' ? '' : ` ${when}`}`;
  } else if (w.kind === 'stock') {
    headline = live ? `${name} ${verb} ${mag} today` : when === 'at the close' ? `${name} closes ${up ? 'up' : 'down'} ${mag}` : `${name} closed ${up ? 'up' : 'down'} ${mag} ${when}`;
  } else {
    headline = live ? `${name} ${verb} ${mag} today to ${price}` : when === 'at the close' ? `${name} closes ${up ? 'up' : 'down'} ${mag} at ${price}` : `${name} closed ${up ? 'up' : 'down'} ${mag} at ${price} ${when}`;
  }
  const change = `${up ? 'up' : 'down'} ${mag}${live ? ' today' : when === 'at the close' ? ' at the close' : ` ${when}`}`;
  return { headline, change, price, when };
}

// ---- engine -------------------------------------------------------------------------------------------------------
export function createFinance(store, config, { getArchive = () => [], getMarkets = () => [] } = {}) {
  const F = config.finance || {};
  const W = (F.watchlist || []).filter((w) => w.source !== 'treasury');
  const T2 = (F.watchlist || []).filter((w) => w.source === 'treasury');
  const bySym = new Map((F.watchlist || []).map((w) => [w.symbol, w]));
  const quotes = new Map();        // symbol -> parsed quote (+ at)
  const hyst = new Map();          // symbol -> hysteresis state
  const hist = new Map();          // `${symbol}:${range}` -> {points, at}
  const pairCache = new Map();     // `${source}:${slug|series}` -> {markets, at}
  const headlines = new Map();     // symbol -> last aired headline
  const gateLog = new Map();       // symbol -> last logged gate reason
  let treasury = { rows: [], at: 0 };
  let timer = null, stopped = false, fails = 0, lastSweepAt = 0, sweeps = 0;
  const stats = { sweeps: 0, quoteErrors: 0, lastError: null, lastSweepMs: null, pairFetches: 0, histFetches: 0, session: null };

  async function sweepQuotes(session) {
    const list = session === 'overnight' && quotes.size ? W.filter((w) => (F.overnightSymbols || []).includes(w.symbol)) : W;
    let ok = 0;
    for (const w of list) {
      try {
        const q = await fetchQuote(w.symbol);
        quotes.set(w.symbol, { ...q, at: Date.now() });
        ok++;
      } catch (e) {
        stats.quoteErrors++;
        stats.lastError = `${w.symbol}: ${errMsg(e)}`;
        if (e?.status === 429 || e?.status >= 500) throw e;   // http.mjs backs the host off; the loop backs off too
      }
      await sleep(F.spacingMs ?? 220);
    }
    if (!ok && list.length) throw new Error(stats.lastError || 'finance: no quotes');
  }

  async function refreshTreasury() {
    if (Date.now() - treasury.at < (F.treasurySec ?? 3600) * 1000 && treasury.rows.length) return;
    try {
      const rows = await fetchTreasury(new Date());
      if (rows.length) treasury = { rows, at: Date.now() };
    } catch (e) {
      treasury.at = Date.now() - ((F.treasurySec ?? 3600) * 1000) / 2;   // retry in half an interval
      log('warn', 'finance treasury failed', { error: errMsg(e) });
    }
    // 2Y (and any treasury-only symbol) as a daily quote: latest close vs the previous close
    const rows = treasury.rows;
    for (const w of T2) {
      const series = rows.filter((r) => r[w.treasury] != null);
      if (series.length < 2) continue;
      const last = series[series.length - 1], prev = series[series.length - 2];
      const t = Math.round(Date.parse(`${last.date}T21:00:00Z`) / 1000);   // ~4-5pm ET close
      quotes.set(w.symbol, {
        symbol: w.symbol, name: w.name, price: last[w.treasury], prevClose: prev[w.treasury], change: last[w.treasury] - prev[w.treasury],
        changePct: null, time: t, period: {}, points: [], official: true, at: Date.now(),
        daily: series.slice(-24).map((r) => ({ t: Math.round(Date.parse(`${r.date}T21:00:00Z`) / 1000), p: r[w.treasury] })),
      });
    }
  }

  async function history(symbol, range) {
    const key = `${symbol}:${range}`;
    const c = hist.get(key);
    if (c && Date.now() - c.at < (F.historyTtlSec ?? 1200) * 1000) return c.points;
    const q = quotes.get(symbol);
    if (q?.daily) {   // treasury-only symbol: daily closes
      const pts = range === '5d' ? q.daily.slice(-5) : q.daily.slice(-22);
      hist.set(key, { points: pts, at: Date.now() });
      return pts;
    }
    try {
      const pts = await fetchHistory(symbol, range);
      stats.histFetches++;
      hist.set(key, { points: pts, at: Date.now() });
      await sleep(F.spacingMs ?? 220);
      return pts;
    } catch (e) {
      log('warn', 'finance history failed', { symbol, range, error: errMsg(e) });
      return c?.points || [];
    }
  }

  function fromIndex(def) {
    const all = getMarkets() || [];
    if (def.source === 'polymarket') { const u = `https://polymarket.com/event/${def.slug}`; return all.filter((m) => m.url === u); }
    const p = `ks:${def.series}-`;
    return all.filter((m) => m.source === 'kalshi' && (String(m.eventId).startsWith(p) || m.eventId === `ks:${def.series}`));
  }
  async function fetchPair(def) {
    const key = `${def.source}:${def.slug || def.series}`;
    const c = pairCache.get(key);
    if (c && Date.now() - c.at < (F.pairingTtlSec ?? 300) * 1000) return c.markets;
    try {
      let markets;
      if (def.source === 'polymarket') markets = parsePolymarketEvents(await getJSON(`${GAMMA}/events?slug=${encodeURIComponent(def.slug)}`, { timeoutMs: 15_000 }), new Date());
      else markets = parseKalshiMarkets((await getJSON(`${KALSHI}/events?series_ticker=${encodeURIComponent(def.series)}&status=open&with_nested_markets=true&limit=25`, { timeoutMs: 15_000 }))?.events || [], {}, new Date());
      stats.pairFetches++;
      pairCache.set(key, { markets, at: Date.now() });
      await sleep(400);
      return markets;
    } catch (e) {
      log('warn', 'finance pairing fetch failed', { key, error: errMsg(e) });
      if (c) c.at = Date.now() - ((F.pairingTtlSec ?? 300) * 1000) / 2;
      return c?.markets || [];
    }
  }
  async function pairedFor(w, now) {
    const out = [];
    const seen = new Set();
    const opts = { now, minVolume: F.minPairVolume || {}, thinVolume: config.thinVolume ?? 25_000 };
    for (const key of w.pair || []) {
      const def = F.pairings?.[key];
      if (!def) continue;
      let rows = pickPaired(def, fromIndex(def), w, opts);
      // the ingest index holds only airable markets (no hourly Kalshi series, filtered rungs): fetch by slug/series
      if (!rows.length) rows = pickPaired(def, await fetchPair(def), w, opts);
      for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, pairing: key }); }
      if (out.length >= (F.marketsPerMove ?? 3)) break;
    }
    return out.slice(0, F.marketsPerMove ?? 3);
  }

  async function evaluate() {
    const now = Date.now();
    const nowSec = now / 1000;
    const archive = getArchive() || [];
    const candidates = [];
    const quoteRows = [];
    for (const w of F.watchlist || []) {
      const q = quotes.get(w.symbol);
      if (!q || q.price == null) continue;
      const sv = severityOf(w, q, F);
      const session = q.official ? 'closed' : quoteSession(q, nowSec);
      // a move older than 18h (yesterday's close before the open, Friday on Saturday) never fires
      const fresh = q.time && nowSec - q.time < 18 * 3600;
      const { st, fired } = stepHysteresis(hyst.get(w.symbol), fresh ? sv.sev : 0, now, F.hysteresis);
      hyst.set(w.symbol, st);
      const copy = moveCopy(w, q, { session, now, sev: sv.sev });
      quoteRows.push({
        symbol: w.symbol, name: w.name, short: w.short || w.name, kind: w.kind, price: q.price,
        change: q.change, changePct: w.kind === 'yield' ? q.change : q.changePct, unit: w.kind === 'yield' ? 'points' : '%',
        priceText: copy.price, changeText: copy.change, direction: sv.direction,
        big: st.active, half: sv.sev >= 0.5, severity: Math.round(sv.sev * 100) / 100, session,
        asOf: q.time ? new Date(q.time * 1000).toISOString() : null, aired: false,
        ...(q.official ? { official: true } : {}),
      });
      if (st.active) candidates.push({ w, q, sv, st, fired, session, copy, row: quoteRows[quoteRows.length - 1] });
    }
    const moves = [];
    for (const c of candidates) {
      const { w, q, sv, st, session } = c;
      const hours = session === 'open' ? (F.headlineHours?.open ?? 6) : (F.headlineHours?.closed ?? 16);
      const headline = matchHeadline(w, sv, archive, { now, hours, prev: headlines.get(w.symbol) });
      const markets = headline ? await pairedFor(w, now) : [];
      const why = !headline ? 'no headline' : !markets.length ? 'no paired market' : null;
      if (gateLog.get(w.symbol) !== `${st.level}:${why}`) {
        gateLog.set(w.symbol, `${st.level}:${why}`);
        log('info', why ? 'finance big move (ticker only)' : 'finance move', { symbol: w.symbol, copy: c.copy.headline, sev: Math.round(sv.sev * 100) / 100, why, headline: headline?.title, markets: markets.map((m) => m.line) });
      }
      if (why) { c.row.why = why; continue; }
      headlines.set(w.symbol, headline);
      const [h5, h1] = [await history(w.symbol, '5d'), await history(w.symbol, '1mo')];
      c.row.aired = true;
      moves.push({
        symbol: w.symbol, name: w.name, short: w.short || w.name, kind: w.kind,
        price: q.price, change: q.change, changePct: w.kind === 'yield' ? q.change : q.changePct, unit: w.kind === 'yield' ? 'points' : '%',
        direction: sv.direction, severity: Math.round(sv.sev * 100) / 100, by: sv.by,
        threshold: sv.thr, session, asOf: q.time ? new Date(q.time * 1000).toISOString() : null,
        dayHigh: q.dayHigh ?? null, dayLow: q.dayLow ?? null, high52: q.high52 ?? null, low52: q.low52 ?? null, prevClose: q.prevClose ?? null,
        copy: { headline: c.copy.headline, price: c.copy.price, change: c.copy.change },
        history5d: h5, history1mo: h1,
        headline: { title: headline.title, outlet: headline.outlet, publishedAt: headline.publishedAt, url: headline.url },
        markets,
        at: new Date(st.firedAt).toISOString(), level: st.level, key: `${w.symbol}:${st.level}`,
        source: q.official ? 'U.S. Treasury' : 'Yahoo Finance', delayed: !q.official,
      });
    }
    // Treasury.gov official close alongside Yahoo's ^FVX/^TNX/^TYX
    const lastRow = treasury.rows[treasury.rows.length - 1];
    if (lastRow) for (const r of quoteRows) { const w = bySym.get(r.symbol); if (w?.treasury && !r.official && lastRow[w.treasury] != null) r.officialClose = { date: lastRow.date, value: lastRow[w.treasury] }; }
    quoteRows.sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));
    return { moves: rankFinanceMoves(moves, { max: F.maxMoves ?? 3 }), quotes: quoteRows };
  }

  function publish(out, session) {
    store.setState({
      finance: {
        moves: out.moves, quotes: out.quotes, session, asOf: new Date().toISOString(),
        note: 'Prices delayed up to 15 min. Source: Yahoo Finance; yields also U.S. Treasury.',
        stats: { sweeps: stats.sweeps, big: out.quotes.filter((q) => q.big).length, aired: out.moves.length, quoteErrors: stats.quoteErrors, lastError: stats.lastError },
      },
    });
  }

  async function tick() {
    const session = sessionAt();
    stats.session = session;
    const t0 = Date.now();
    await sweepQuotes(session);
    await refreshTreasury();
    const out = await evaluate();
    stats.sweeps++;
    stats.lastSweepMs = Date.now() - t0;
    lastSweepAt = Date.now();
    publish(out, session);
    log('debug', 'finance sweep', { session, quotes: quotes.size, big: out.quotes.filter((q) => q.big).map((q) => q.symbol), moves: out.moves.map((m) => m.symbol), ms: stats.lastSweepMs });
  }

  function loop() {
    if (stopped) return;
    const session = sessionAt();
    const base = (F.cadenceSec?.[session] ?? 300) * 1000;
    const ms = fails ? Math.min(base * 2 ** fails, 600_000) : base;
    timer = setTimeout(async () => {
      try { await tick(); fails = 0; } catch (e) {
        fails++;
        log('warn', 'finance sweep failed', { fails, error: errMsg(e) });
      }
      loop();
    }, Math.max(1000, ms));
    timer.unref?.();
  }

  return {
    start({ initialDelayMs = 4000 } = {}) {
      timer = setTimeout(async () => {
        try { await tick(); } catch (e) { fails = 1; log('warn', 'finance first sweep failed', { error: errMsg(e) }); }
        loop();
      }, initialDelayMs);
      timer.unref?.();
    },
    stop() { stopped = true; clearTimeout(timer); },
    stats: () => ({ ...stats, quotes: quotes.size, active: [...hyst].filter(([, s]) => s.active).map(([k]) => k), pairCache: pairCache.size, lastSweepAt: lastSweepAt ? new Date(lastSweepAt).toISOString() : null }),
    // tests / tools
    _evaluate: evaluate, _tick: tick, _quotes: quotes,
  };
}

export default { createFinance, matchHeadline, headlineDirection, pickPaired, severityOf, stepHysteresis, moveCopy, cleanOutcome, fedPhrase, whenOf, marketLine };
