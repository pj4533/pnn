// Finance quote source (QUEUED-FIXES item 12, research/financial-data.md).
// Yahoo /v8/finance/chart (unofficial, no key, no crumb; one symbol per request) for stocks, indices, yields, oil, gold
// and the dollar, plus the official Treasury.gov daily par yield curve (XML) for the 2Y and closing yields.
// Pure parsers (parseChart, parseTreasuryXml, sessionAt) are exported for scripts/test-finance.mjs.
// The `quoteSource` shape (fetchQuote/fetchHistory) is the swap point if Yahoo breaks.
import { getJSON, getText } from '../http.mjs';
import config from '../config.mjs';

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const TREASURY = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=';
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const headers = () => ({ 'User-Agent': config.finance?.userAgent || 'PNN/0.1 (local news display)' });

/** Yahoo chart JSON -> { symbol, name, price, prevClose, change, changePct, dayHigh, dayLow, high52, low52, volume,
 *  time (epoch s), period {pre, regular, post: {start, end}}, instrument, points [{t, p}] } | null */
export function parseChart(json) {
  const r = json?.chart?.result?.[0];
  const m = r?.meta;
  if (!m) return null;
  const price = num(m.regularMarketPrice);
  const prevClose = num(m.chartPreviousClose) ?? num(m.previousClose);
  const ts = Array.isArray(r.timestamp) ? r.timestamp : [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const points = [];
  for (let i = 0; i < ts.length; i++) { const p = num(closes[i]); if (p != null && Number.isFinite(ts[i])) points.push({ t: ts[i], p: Math.round(p * 1e4) / 1e4 }); }
  const per = (k) => { const x = m.currentTradingPeriod?.[k]; return x && Number.isFinite(x.start) ? { start: x.start, end: x.end } : null; };
  const change = price != null && prevClose != null ? price - prevClose : null;
  return {
    symbol: m.symbol,
    name: m.longName || m.shortName || m.symbol,
    price,
    prevClose,
    change,
    changePct: change != null && prevClose ? (change / prevClose) * 100 : null,
    dayHigh: num(m.regularMarketDayHigh),
    dayLow: num(m.regularMarketDayLow),
    high52: num(m.fiftyTwoWeekHigh),
    low52: num(m.fiftyTwoWeekLow),
    volume: num(m.regularMarketVolume),
    time: num(m.regularMarketTime),
    period: { pre: per('pre'), regular: per('regular'), post: per('post') },
    instrument: m.instrumentType || null,
    points,
  };
}

/** One symbol's quote with the intraday 5-minute series (used for the 60-minute swing). */
export async function fetchQuote(symbol) {
  const j = await getJSON(`${YAHOO}/${encodeURIComponent(symbol)}?range=1d&interval=5m`, { timeoutMs: 12_000, headers: headers() });
  const q = parseChart(j);
  if (!q || q.price == null) throw new Error(`yahoo: no price for ${symbol}`);
  return q;
}

/** Price history for a sparkline: '5d' (15-minute bars) or '1mo' (daily) -> [{t, p}]. */
export async function fetchHistory(symbol, range = '5d') {
  const interval = range === '5d' ? '15m' : '1d';
  const j = await getJSON(`${YAHOO}/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`, { timeoutMs: 12_000, headers: headers() });
  return parseChart(j)?.points || [];
}

/** Treasury.gov daily par yield curve Atom XML -> [{date: 'YYYY-MM-DD', BC_2YEAR: 4.59, ...}] oldest first. */
export function parseTreasuryXml(xml) {
  const out = [];
  for (const block of String(xml || '').split(/<entry>/).slice(1)) {
    const date = block.match(/<d:NEW_DATE[^>]*>([^<]+)</)?.[1];
    if (!date) continue;
    const row = { date: date.slice(0, 10) };
    for (const [, k, v] of block.matchAll(/<d:(BC_\w+)[^>]*>([^<]*)</g)) { const n = num(v); if (n != null) row[k] = n; }
    out.push(row);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** This month's and last month's curve rows (the first days of a month need last month for "previous close"). */
export async function fetchTreasury(now = new Date()) {
  const ym = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const rows = [];
  for (const m of [ym(prev), ym(now)]) {
    const xml = await getText(`${TREASURY}${m}`, { timeoutMs: 20_000, headers: headers(), accept: 'application/xml' });
    rows.push(...parseTreasuryXml(xml));
  }
  const seen = new Set();
  return rows.filter((r) => !seen.has(r.date) && seen.add(r.date)).sort((a, b) => a.date.localeCompare(b.date));
}

// --- US market clock (ET) ---------------------------------------------------
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });
/** ET wall clock: { day: 'Mon'..'Sun', minutes since midnight, date 'YYYY-MM-DD' } */
export function etClock(now = Date.now()) {
  const parts = Object.fromEntries(ET.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { day: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}
/** 'regular' (9:30-16:00 weekdays), 'extended' (4:00-9:30, 16:00-20:00 weekdays) or 'overnight' (otherwise). */
export function sessionAt(now = Date.now()) {
  const { day, minutes } = etClock(now);
  if (day === 'Sat' || day === 'Sun') return 'overnight';
  if (minutes >= 570 && minutes < 960) return 'regular';
  if (minutes >= 240 && minutes < 1200) return 'extended';
  return 'overnight';
}
/** Per-quote state from Yahoo's own trading period: 'open' | 'pre' | 'post' | 'closed'. */
export function quoteSession(q, nowSec = Date.now() / 1000) {
  const p = q?.period || {};
  const inP = (x) => x && nowSec >= x.start && nowSec < x.end;
  if (inP(p.regular)) return 'open';
  if (inP(p.pre)) return 'pre';
  if (inP(p.post)) return 'post';
  return 'closed';
}

export default { parseChart, fetchQuote, fetchHistory, parseTreasuryXml, fetchTreasury, sessionAt, quoteSession, etClock };
