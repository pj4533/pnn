// Finance (stocks, indices, bond yields, oil, gold) on PNN: reads state.finance defensively and normalizes it ONE way for the
// MARKETS card, the 3D finance widget, the chyron ticker and the director. Prices are facts (delayed quotes), the paired prediction
// markets are odds: the card and the widget keep those two apart.
//
// Contract read from state.finance (every name below has aliases; absent or malformed items are skipped, never thrown on):
//   The server's shape (server/finance.mjs): state.finance = { moves: [move], quotes: [quote], session, asOf, note, stats }
//     move  = { symbol, name, short, kind, price, change, changePct (yields: points), prevClose, session: 'open'|'closed'|'pre'|'post', asOf (ISO), source, delayed,
//               copy: { headline, price, change }, headline: { title, outlet, publishedAt, url }, markets: [pair], history5d: [{t,p}], history1mo: [{t,p}] }
//     quote = { symbol, name, short, kind, price, change, changePct, session, asOf }                          (ticker rows; moves are the card-worthy ones)
//     pair  = { id, label, yesPrice, change1d (may be null), source, volume24h, thin, url }
//   Also accepted (aliases): an array, or { items | stories | cards | list: [...] }; per item intraday | history5d | series5d, month | history1mo, news | headline{}, pairs | markets | odds,
//   marketState | session, updatedAt | asOf | at. t = epoch seconds, ms or ISO.
// Yields are in percent (4.90 = 4.90%); their day move is in percentage points. Everything else moves in percent.
import { ago } from './util.js';

const KNOWN = {
  '^GSPC': { name: 'S&P 500', kind: 'index' }, '^NDX': { name: 'Nasdaq-100', kind: 'index' }, '^IXIC': { name: 'Nasdaq', kind: 'index' }, '^DJI': { name: 'Dow Jones', kind: 'index' },
  '^VIX': { name: 'Wall Street fear gauge (VIX)', kind: 'index' }, '^RUT': { name: 'Russell 2000', kind: 'index' },
  '^TNX': { name: '10-year Treasury yield', kind: 'yield' }, '^FVX': { name: '5-year Treasury yield', kind: 'yield' }, '^TYX': { name: '30-year Treasury yield', kind: 'yield' }, '^IRX': { name: '13-week Treasury yield', kind: 'yield' },
  'CL=F': { name: 'Oil (WTI)', kind: 'commodity', per: 'a barrel' }, 'GC=F': { name: 'Gold', kind: 'commodity', per: 'an ounce' }, 'DX-Y.NYB': { name: 'US dollar index', kind: 'currency' },
  NVDA: { name: 'Nvidia' }, AAPL: { name: 'Apple' }, MSFT: { name: 'Microsoft' }, GOOGL: { name: 'Alphabet' }, AMZN: { name: 'Amazon' }, META: { name: 'Meta' }, TSLA: { name: 'Tesla' },
  AVGO: { name: 'Broadcom' }, JPM: { name: 'JPMorgan' }, LLY: { name: 'Eli Lilly' }, V: { name: 'Visa' }, 'BRK-B': { name: 'Berkshire Hathaway' },
};
const num = (v) => (v == null || v === '' ? NaN : Number(v));
const first = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return undefined; };
const toMs = (t) => (t == null ? NaN : typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t));
const FIXTURE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fixture');

function series(raw, shiftMs = 0) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    const t = toMs(Array.isArray(r) ? r[0] : first(r, ['t', 'time', 'ts', 'date', 'timestamp']));
    const p = num(Array.isArray(r) ? r[1] : first(r, ['p', 'c', 'close', 'price', 'v', 'value']));
    if (Number.isFinite(t) && Number.isFinite(p)) out.push({ t: t + shiftMs, p });
  }
  return out.sort((a, b) => a.t - b.t);
}

function kindOf(sym, raw) {
  if (KNOWN[sym]?.kind) return KNOWN[sym].kind;       // our table wins (the server files the dollar index under commodity; it is not "$ per ounce")
  const k = String(first(raw, ['kind', 'type', 'assetClass', 'class']) || '').toLowerCase();
  if (/yield|bond|treasury|rate/.test(k)) return 'yield';
  if (/index|indices/.test(k)) return 'index';
  if (/commod|future|oil|gold/.test(k)) return 'commodity';
  if (/curr|fx|dollar/.test(k)) return 'currency';
  if (/stock|equity/.test(k)) return 'stock';
  if (/^\^/.test(sym)) return 'index';
  if (/=F$/.test(sym)) return 'commodity';
  return 'stock';
}

/** One raw item -> the normalized quote, or null when it has no usable price. */
function norm(raw, state, nowMs) {
  if (!raw || typeof raw !== 'object') return null;
  const symbol = String(first(raw, ['symbol', 'sym', 'ticker', 'id']) || '').trim();
  if (!symbol) return null;
  const price = num(first(raw, ['price', 'last', 'value', 'regularMarketPrice']));
  if (!(price > 0)) return null;
  const known = KNOWN[symbol] || {};
  const kind = kindOf(symbol, raw);
  const prev = num(first(raw, ['prevClose', 'previousClose', 'chartPreviousClose', 'prev']));
  const hasPrev = prev > 0;
  const chg = hasPrev ? price - prev : num(first(raw, ['change', 'changeAbs', 'chg', 'regularMarketChange']));
  let pct = hasPrev ? ((price - prev) / prev) * 100 : num(first(raw, ['changePct', 'pctChange', 'changePercent', 'pct', 'regularMarketChangePercent']));
  if (!Number.isFinite(pct)) pct = 0;
  const updated = toMs(first(raw, ['updatedAt', 'asOf', 'at', 'regularMarketTime'])) || toMs(state?.finance?.asOf) || toMs(state?.generatedAt) || nowMs;
  let intraday = series(first(raw, ['intraday', 'history5d', 'series5d', 'chart5d', 'spark5d', 'd5', 'history']));
  let month = series(first(raw, ['month', 'history1mo', 'series1mo', 'chart1mo', 'monthly', 'm1']));
  if (FIXTURE && intraday.length) { // the static fixture's series are fixed in time: slide them by whole weeks toward today
    const shift = Math.round((updated - intraday[intraday.length - 1].t) / 6048e5) * 6048e5; // whole weeks: weekdays and the ET trading-day grouping stay intact
    intraday = intraday.map((x) => ({ ...x, t: x.t + shift })); month = month.map((x) => ({ ...x, t: x.t + shift }));
  }
  const hl = raw.headline && typeof raw.headline === 'object' && !Array.isArray(raw.headline) ? raw.headline : null;   // the server's wire headline for the move
  const nw = first(raw, ['news', 'headline_news', 'newsItem']) || (hl ? { title: hl.title, source: hl.outlet || hl.source, publishedAt: hl.publishedAt, url: hl.url } : null);
  const news = (Array.isArray(nw) ? nw : nw ? [nw] : []).find((x) => x && String(x.title || '').trim()) || null;
  const pairsRaw = first(raw, ['pairs', 'markets', 'odds', 'related', 'predictions']);
  const pairs = (Array.isArray(pairsRaw) ? pairsRaw : []).map((m) => {
    const yes = num(first(m, ['yesPrice', 'price', 'p', 'prob']));
    if (!(yes >= 0 && yes <= 1)) return null;
    return {
      id: String(first(m, ['id', 'marketId']) || ''), label: String(first(m, ['label', 'outcome', 'title', 'eventTitle']) || '').trim(),
      yesPrice: yes, change1d: num(first(m, ['change1d', 'd1', 'move'])) || 0, source: first(m, ['source', 'exchange']) || 'polymarket',
      volume24h: num(first(m, ['volume24h', 'volume', 'vol24h'])) || 0, thin: !!first(m, ['thin']), url: first(m, ['url']) || null, storyId: first(m, ['storyId', 'eventId']) || null,
      updatedAt: first(m, ['updatedAt', 'at']) || null,
    };
  }).filter((m) => m && m.label).slice(0, 3);
  return {
    id: `fin:${symbol}`, symbol, name: String(first(raw, ['name', 'title', 'label', 'shortName', 'longName']) || known.name || symbol), kind, per: known.per || '',
    price, prev: hasPrev ? prev : NaN, chg: Number.isFinite(chg) ? chg : 0, pct, updated,
    market: String(first(raw, ['marketState', 'market', 'session']) || '').toLowerCase() || null, source: first(raw, ['source', 'provider']) || state?.finance?.source || null,
    delayed: raw.delayed !== false && !raw.official && state?.finance?.delayed !== false, headline: String(raw.copy?.headline || (typeof raw.headline === 'string' ? raw.headline : '') || raw.line || '').trim(),
    intraday, month, news, pairs, thin: pairs.length > 0 && pairs.every((m) => m.thin),
  };
}

/** Normalized finance rows from state: { items } = every quote (ticker) with moves merged in, { cards } = the moves (or legacy items) that can carry a MARKETS card.
 *  Empty arrays when state.finance is absent or malformed. Cached per state object. */
const cache = new WeakMap();
function parsed(state) {
  if (!state || typeof state !== 'object') return { items: [], cards: [] };
  if (cache.has(state)) return cache.get(state);
  let out = { items: [], cards: [] };
  try {
    const f = state.finance, arr = (v) => (Array.isArray(v) ? v : []);
    const legacy = Array.isArray(f) ? f : arr(f?.items).length ? f.items : arr(f?.stories).length ? f.stories : arr(f?.cards).length ? f.cards : arr(f?.list);
    const now = Date.now(), n = (r) => norm(r, state, now);
    const moves = [...arr(f?.moves), ...legacy].map(n).filter(Boolean);
    const seenM = new Set(), cards = moves.filter((x) => !seenM.has(x.id) && seenM.add(x.id));
    const seen = new Set(cards.map((x) => x.id)), items = [...cards];
    for (const q of arr(f?.quotes).map(n)) if (q && !seen.has(q.id) && seen.add(q.id)) items.push(q);
    out = { items, cards };
  } catch { out = { items: [], cards: [] }; }
  cache.set(state, out);
  return out;
}
export const finItems = (state) => parsed(state).items;
/** Items worth a full MARKETS card (a real chart, or paired odds to show). Quotes without either only feed the ticker. */
export const finCards = (state) => parsed(state).cards.filter((x) => x.intraday.length >= 8 || x.pairs.length > 0);

// ---- plain-English formatting (no cents, bps, tickers-as-jargon)
const group = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
/** A price or axis value: "$190.76", "7,580.84", "4.90%". dec: forced decimals (axis ticks). */
export function fmtVal(fi, v, dec) {
  if (!Number.isFinite(v)) return '–';
  switch (fi.kind) {
    case 'yield': return `${group(v, dec ?? 2)}%`;
    case 'index': case 'currency': return group(v, dec ?? (v >= 1000 ? 2 : 2));
    case 'commodity': return `$${group(v, dec ?? 2)}`;
    default: return `$${group(v, dec ?? 2)}`;
  }
}
/** Price with its unit phrase: "$89.69 a barrel", "4.90%". */
export const priceText = (fi) => `${fmtVal(fi, fi.price)}${fi.per ? ` ${fi.per}` : ''}`;
const dir = (fi) => { const d = fi.kind === 'yield' ? Math.round(fi.chg * 100) : Math.round(fi.pct * 10); return d > 0 ? 1 : d < 0 ? -1 : 0; };
export const finDir = dir;
/** The size of the day's move: yields "0.08 points", everything else "4.7%". */
export function moveSize(fi) {
  if (fi.kind === 'yield') { const n = Math.abs(fi.chg); return `${group(n, 2)} ${Math.round(n * 100) === 100 ? 'point' : 'points'}`; }
  const n = Math.abs(fi.pct); return `${group(n, 1)}%`;   // one decimal always, same as server copy (server/finance.mjs) so card and headline agree
}
/** "down 4.7% today" / "up 0.08 points today" / "unchanged today". */
export const moveWords = (fi, when = 'today') => (dir(fi) === 0 ? `unchanged ${when}` : `${dir(fi) > 0 ? 'up' : 'down'} ${moveSize(fi)} ${when}`);
/** Compact: "▼ 4.7%" / "▲ 0.08 pts". */
export function moveShortFin(fi) {
  const d = dir(fi);
  if (!d) return '● 0';
  return `${d > 0 ? '▲' : '▼'} ${fi.kind === 'yield' ? `${group(Math.abs(fi.chg), 2)} pts` : moveSize(fi)}`;
}
/** The dollar/point change for the sub line: "$9.37", "0.08 points". '' when unknown. */
export function changeAbs(fi) {
  if (!Number.isFinite(fi.chg) || dir(fi) === 0) return '';
  return fi.kind === 'yield' ? `${group(Math.abs(fi.chg), 2)} points` : fi.kind === 'index' || fi.kind === 'currency' ? group(Math.abs(fi.chg), 2) : `$${group(Math.abs(fi.chg), 2)}`;
}
/** Headline, plain English. The server's own copy wins. */
export function finHeadline(fi) {
  if (fi.headline) return fi.headline;
  const d = dir(fi), v = priceText(fi);
  if (fi.kind === 'yield') return d === 0 ? `${fi.name} holds at ${v}` : `${fi.name} ${d > 0 ? 'rises' : 'falls'} to ${v}, ${moveWords(fi)}`;
  if (d === 0) return `${fi.name} is flat at ${v}`;
  return `${fi.name} ${d > 0 ? 'climbs' : 'slips'} ${moveSize(fi)} today to ${v}`;
}
export const finShort = (fi) => (dir(fi) === 0 ? `${fi.name} flat` : `${fi.name} ${dir(fi) > 0 ? 'up' : 'down'} ${moveSize(fi)}`);
export const finKindLabel = (fi) => ({ stock: 'STOCK', index: 'STOCK INDEX', yield: 'BOND YIELD', commodity: 'COMMODITY', currency: 'CURRENCY' }[fi.kind] || 'MARKET');
const MARKET_WORDS = { open: 'Market open', closed: 'Market closed', pre: 'Before the open', post: 'After hours' };
export const marketWord = (fi) => MARKET_WORDS[fi.market] || '';
/** "Prices delayed · Yahoo Finance · updated 4m ago" */
export const finMeta = (fi, now = Date.now()) => [fi.delayed ? 'Prices delayed' : '', fi.source ? String(fi.source) : '', `updated ${ago(fi.updated, now)}`, marketWord(fi)].filter(Boolean).join(' · ');

/** The pseudo-story the director, chyron and 3D scene share for a finance item. `lead` carries the day's move as a fraction (the scene reads
 *  lead.change1d for the stage tint and energy); yesPrice is a placeholder, never shown. */
export function finStory(fi) {
  const lead = fi.pairs[0];
  return {
    id: fi.id, kind: 'finance', eventTitle: fi.name, category: 'economy', sources: [...new Set(fi.pairs.map((m) => m.source))], fin: fi,
    headline: finHeadline(fi), short: finShort(fi), dek: '', thin: fi.thin, history: null, news: fi.news ? [fi.news] : [], swing: null, exchanges: null,
    lead: { id: fi.id, title: fi.name, outcome: fi.name, source: lead?.source || 'finance', yesPrice: 0.5, change1d: Math.max(-0.15, Math.min(0.15, fi.kind === 'yield' ? fi.chg / 10 : fi.pct / 100)), updatedAt: new Date(fi.updated).toISOString(), volume24h: lead?.volume24h || 0, closesAt: null },
    markets: fi.pairs.map((m) => ({ ...m, title: m.label, outcome: m.label })),
    visual: { type: 'finance', region: null, theme: 'tech' }, finance: fi,
  };
}
