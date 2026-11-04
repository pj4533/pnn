// "NEWS MEETS MARKETS" flash: a breaking news cluster plus the 1-3 markets that price it.
//
// buildFlash(cluster, matches, opts?) -> Flash | null (null when there is no usable match)
//   cluster  wire Cluster {id, title, url, outlets[], firstSeen, category}
//   matches  matchMarkets() output [{market, score, why}]
//   opts.now      epoch ms (default Date.now())
//   opts.priceAt  optional (marketId, epochMs) -> 0..1 | null, PNN's own observed price at that time
//                 (e.g. from the store's history). Gives changeSinceNews.
//   opts.storyId  optional (marketOrEventId) -> aired story id (rank.mjs aliases), sets flash.storyId
//   opts.max      markets on the flash (default 3)
//
// Flash {
//   id, at (ISO), kind: 'flash',
//   headline,           the news headline as the outlet wrote it (it is news, not PNN copy)
//   credit,             "BBC, The Hill and 2 others" (who reported it)
//   outlets[], url, category, official,
//   markets: [{id, label, yesPrice, change1d, changeSinceNews?, source, volume24h, thin, url, closesAt, updatedAt, line}],
//   line,               data line for the lead market in the house style: subject + number + change,
//                       always a %, never "will", no "Bettors" ("Fed decision in December, hike a quarter point: 80%, up 6 points today")
//   storyId?, newsAt (ISO, when the story first appeared on the wire), cluster: cluster.id
// }
import { pct, pts, money, marketLabel } from './copy.mjs';

const THIN = 10_000;

function attribution(outlets) {
  const o = (outlets || []).filter(Boolean);
  if (!o.length) return '';
  if (o.length === 1) return o[0];
  if (o.length === 2) return `${o[0]} and ${o[1]}`;
  if (o.length === 3) return `${o[0]}, ${o[1]} and ${o[2]}`;
  return `${o[0]}, ${o[1]} and ${o.length - 2} others`;
}

// PNN copy never says "will" (a "will" may only appear inside a quoted market question, as in copy.mjs).
// When the house label still carries one, fall back to: outcome + the exchange's question in quotes.
function labelFor(m) {
  let label = '';
  try { label = marketLabel(m); } catch { label = ''; }
  label = String(label || '').replace(/:\s*$/, '').trim();
  // copy.mjs drops the verb from wh-questions ("Who run for House Republican leader"); quote those as asked.
  const whQuestion = m.outcome && /^(.*:\s*)?(who|which|what|how many|how much|when)\b.*\bwill\b/i.test(m.eventTitle || '');
  if (!label || whQuestion || /\bwill\b|\bwon['’]t\b/i.test(label)) {
    const q = String(m.outcome ? m.eventTitle : m.title || m.eventTitle || '').trim();
    label = m.outcome ? `${m.outcome}, “${q}”` : `“${q}”`;
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// One row per outcome: the same candidate on both exchanges shows once (the busier market).
const outcomeKey = (m) => String(m.outcome || m.title || '').toLowerCase().replace(/\((d|r|i)\)|\b(democrat|republican)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function moveText(m, sinceNews) {
  if (sinceNews != null && Math.abs(sinceNews) >= 0.01) return pts(sinceNews, 'since the news');
  if (m.change1d != null && Math.abs(m.change1d) >= 0.005) return pts(m.change1d, 'today');
  return '';
}

export function marketDataLine(m, sinceNews = null) {
  const mv = moveText(m, sinceNews);
  return `${labelFor(m)}: ${pct(m.yesPrice)}${mv ? `, ${mv}` : ''}`;
}

export function buildFlash(cluster, matches, opts = {}) {
  if (!cluster || !matches?.length) return null;
  const now = opts.now ?? Date.now();
  const newsAt = Date.parse(cluster.firstSeen) || now;
  const max = opts.max ?? 3;
  const markets = [];
  const seen = new Map(); // outcome key -> chosen market
  for (const { market: m } of matches) {
    if (!m || m.yesPrice == null || !Number.isFinite(m.yesPrice)) continue;
    const k = outcomeKey(m);
    if (seen.has(k) && (seen.get(k).volume24h || 0) >= (m.volume24h || 0)) continue;
    const replaceAt = seen.has(k) ? markets.findIndex((x) => x.id === seen.get(k).id) : -1;
    seen.set(k, m);
    let since = null;
    if (typeof opts.priceAt === 'function') {
      const p0 = opts.priceAt(m.id, newsAt);
      if (p0 != null && Number.isFinite(p0)) since = Math.round((m.yesPrice - p0) * 1000) / 1000;
    }
    const entry = {
      id: m.id,
      label: labelFor(m),
      yesPrice: m.yesPrice,
      change1d: m.change1d ?? null,
      source: m.source,
      volume24h: Number(m.volume24h) || 0,
      volumeText: money(Number(m.volume24h) || 0),
      thin: (Number(m.volume24h) || 0) < THIN,
      url: m.url,
      closesAt: m.closesAt || null,
      updatedAt: m.updatedAt || null,
      eventId: m.eventId,
      line: marketDataLine(m, since),
    };
    if (since != null) entry.changeSinceNews = since;
    if (replaceAt >= 0) { markets[replaceAt] = entry; continue; }
    if (markets.length >= max) continue;   // keep scanning: a busier duplicate of a shown outcome may follow
    markets.push(entry);
  }
  if (!markets.length) return null;
  const lead = markets[0];
  let storyId;
  if (typeof opts.storyId === 'function') storyId = opts.storyId(lead.eventId) || opts.storyId(lead.id) || undefined;
  return {
    id: `flash:${cluster.id}`,
    kind: 'flash',
    at: new Date(now).toISOString(),
    newsAt: new Date(newsAt).toISOString(),
    headline: cluster.title,
    credit: attribution(cluster.outlets),
    outlets: cluster.outlets || [],
    url: cluster.url || cluster.items?.[0]?.url || null,
    category: cluster.category || null,
    official: !!cluster.official,
    markets,
    line: lead.line,
    ...(storyId ? { storyId } : {}),
    cluster: cluster.id,
  };
}

export default { buildFlash, marketDataLine };
