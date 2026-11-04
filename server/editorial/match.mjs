// News-to-market matcher: given a news cluster (server/sources/wire.mjs), find the prediction markets that price it.
//
// await matchMarkets(cluster, marketIndex, opts?) -> [{market, score, why}] best first (empty when nothing is relevant)
//   cluster      {title, items:[{title}], category?}  (a wire Cluster; a bare {title} works too)
//   marketIndex  Market[] (docs/ARCHITECTURE.md contract) PNN already holds; raw or filtered, both fine
//   opts.search  true (default) | false   live search fallback (Polymarket public-search + Kalshi v1 search)
//                when the local index has no strong hit
//   opts.config  PNN config for filter.classify (default: server/config.mjs)
//   opts.now     epoch ms
//   opts.limit   max results (default 6), at most opts.perEvent (default 2) outcomes per event
//   opts.searchWaitMs  how long a live search may wait for its rate-limit slot (default 0 = skip when busy)
//
// Scoring (see DECISIONS "2026-11-04: news wire"):
//   - Topic dictionary (Fed/FOMC/Powell -> Fed rates, CPI/inflation, Banxico, Putin/Kremlin, SCOTUS + justices,
//     OpenAI/GPT, Google/Gemini, Anthropic/Claude, SpaceX/Starship, Oscars, Billboard, hurricanes by name,
//     country -> leader ...). A topic counts when it hits BOTH the news and the market text.
//   - Content-token overlap weighted by IDF over the market index (event-level document frequency), so a word that
//     appears in many markets ("Trump", "election", "2026") counts little and a rare one ("Talarico") counts a lot.
//   - A match needs >= 2 independent signals (topic hits + shared distinctive tokens; tokens a topic already
//     covers do not count twice) and at least one of them must be a topic or a rare token. One shared word
//     ("Texas") never matches on its own.
//   - Boosts: 24h volume (log), closes within 30 days; markets pinned near 0/100 are damped.
//   - Every candidate goes through filter.classify, so noise and sensitive markets never match.
import { classify } from './filter.mjs';
import { tokens, tokenSet } from './text.mjs';
import { log } from '../log.mjs';

const DAY = 86_400_000;

// ---------- topic dictionary ----------
// news: RegExp on the news text; market: RegExp on market text; covers: tokens (text.mjs tokens) the topic
// already accounts for; query: live-search query; w: weight.
const T = (key, news, market, covers, query, w = 5, group = key) => ({ key, news, market, covers: new Set(covers), query, w, group });
export const TOPICS = [
  T('fed-rates', /\b(Fed|FED|Federal Reserve|FOMC|Powell|Warsh|Hassett|Waller|Bowman)\b/,
    /\b(fed|federal reserve|fomc|fed chair)\b/i, ['fed', 'powell', 'warsh', 'hassett', 'waller', 'bowman'], 'fed rate', 6),
  // Generic rate words: context only (weight 2, half a signal), so "Bank of Mexico cuts rates" never pulls Fed markets
  // on its own and "Fed signals December hike" gets credit for "hike".
  T('rates', /\b(rate (cut|hike)s?|interest rates?|cuts? rates|raises? rates|hikes? rates|holds? rates|rates steady|basis points?|quarter point|half point)\b/i,
    /\b(rates?|bps|cut|hike|increase|decrease|no change)\b/i, ['rate', 'cut', 'hike', 'bps', 'increase', 'decrease', 'steady', 'hold'], null, 2),
  T('inflation', /\b(CPI|inflation|consumer prices?|PCE)\b/i, /\b(cpi|inflation|pce)\b/i, ['cpi', 'inflation', 'consumer', 'price', 'pce'], 'inflation', 6),
  T('jobs', /\b(jobs report|payrolls?|unemployment|jobless)\b/i, /\b(unemployment|payrolls?|jobs report|jobless)\b/i, ['job', 'payroll', 'unemployment', 'jobless'], 'unemployment rate', 6),
  T('gdp', /\b(GDP|gross domestic product|recession)\b/i, /\b(gdp|recession)\b/i, ['gdp', 'gross', 'domestic', 'product', 'recession'], 'gdp', 6),
  T('tariffs', /\btariffs?\b/i, /\btariffs?\b/i, ['tariff'], 'tariffs', 5),
  T('shutdown', /\b(government shutdown|shutdown)\b/i, /\bshutdown\b/i, ['shutdown', 'government'], 'government shutdown', 6),
  T('banxico', /\b(Bank of Mexico|Banxico)\b/i, /\b(bank of mexico|banxico)\b/i, ['bank', 'mexico', 'banxico'], 'bank of mexico', 7),
  T('boe', /\bBank of England\b|\bBoE\b/, /\bbank of england\b/i, ['bank', 'england', 'boe'], 'bank of england', 7),
  T('boj', /\bBank of Japan\b|\bBoJ\b/, /\bbank of japan\b/i, ['bank', 'japan', 'boj'], 'bank of japan', 7),
  T('ecb', /\b(ECB|European Central Bank|Lagarde)\b/, /\b(ecb|european central bank)\b/i, ['ecb', 'european', 'central', 'bank', 'lagarde'], 'ecb', 7),
  T('putin', /\b(Putin|Kremlin)\b/, /\bputin\b/i, ['putin', 'kremlin'], 'putin', 6),
  T('scotus', /\b(Supreme Court|SCOTUS|Chief Justice|Justices?\s+(Roberts|Thomas|Alito|Sotomayor|Kagan|Gorsuch|Kavanaugh|Barrett|Jackson))\b/i,
    /\b(supreme court|scotus|justice|roberts|alito|sotomayor|kagan|gorsuch|kavanaugh|barrett)\b/i,
    ['scotus', 'justice', 'chief', 'roberts', 'thomas', 'alito', 'sotomayor', 'kagan', 'gorsuch', 'kavanaugh', 'barrett', 'court'], 'supreme court', 6),
  T('openai', /\b(OpenAI|ChatGPT|GPT-?\d[\w.]*|Sam Altman|Altman)\b/i, /\b(openai|chatgpt|gpt-?\d|altman)\b/i, ['openai', 'chatgpt', 'altman', 'sam', 'gpt'], 'openai', 7),
  T('google-ai', /\b(Gemini|DeepMind|Google|Alphabet)\b/, /\b(google|gemini|alphabet|deepmind)\b/i, ['google', 'gemini', 'alphabet', 'deepmind'], 'google gemini', 5),
  T('anthropic', /\b(Anthropic|Claude)\b/, /\b(anthropic|claude)\b/i, ['anthropic', 'claude'], 'anthropic', 7),
  T('nvidia', /\bNvidia\b/i, /\b(nvidia|nvda)\b/i, ['nvidia', 'nvda'], 'nvidia', 6),
  T('tesla', /\b(Tesla|Musk)\b/, /\b(tesla|musk|tsla)\b/i, ['tesla', 'musk', 'elon', 'tsla'], 'tesla', 4, 'musk'),
  T('spacex', /\b(SpaceX|Starship|Falcon 9)\b/i, /\b(spacex|starship)\b/i, ['spacex', 'starship', 'falcon'], 'spacex starship', 6, 'musk'),
  T('oscars', /\b(Oscars?|Academy Awards?)\b/i, /\b(oscars?|academy awards?)\b/i, ['oscar', 'academy', 'award'], 'oscars', 7),
  T('grammys', /\bGrammys?\b/i, /\bgrammys?\b/i, ['grammy'], 'grammys', 7),
  T('emmys', /\bEmmys?\b/i, /\bemmys?\b/i, ['emmy'], 'emmys', 7),
  T('billboard', /\b(Billboard|Hot 100)\b/i, /\b(billboard|hot 100)\b/i, ['billboard', 'hot', '100'], 'billboard hot 100', 6),
  T('box-office', /\bbox office\b/i, /\bbox office\b|\bopening weekend\b/i, ['box', 'office', 'opening', 'weekend'], 'box office', 6),
  T('time-poy', /\bperson of the year\b/i, /\bperson of the year\b/i, ['person'], 'time person of the year', 7),
  T('pope', /\b(Pope|Vatican)\b/, /\b(pope|vatican)\b/i, ['pope', 'vatican'], 'pope', 6),
  T('epstein', /\bEpstein\b/, /\bepstein\b/i, ['epstein'], 'epstein', 6),
  T('measles', /\b(measles|bird flu|H5N1)\b/i, /\b(measles|bird flu|h5n1)\b/i, ['measle', 'measles', 'bird', 'flu', 'h5n1'], 'measles', 6),
  T('aliens', /\b(UFOs?|UAPs?|aliens?|extraterrestrial)\b/i, /\b(ufos?|uaps?|aliens?)\b/i, ['ufo', 'uap', 'alien'], 'aliens', 6),
  T('leaves-office', /\b(steps? down|stepping down|resign\w*|ousted|ouster|out as|leaves? office|impeach\w*|removed from office|no-confidence|confidence vote)\b/i,
    /\b(out as|out by|resign\w*|leaves? office|step down|removed|impeach\w*|no-confidence|ousted)\b/i, ['out', 'resign', 'resignation', 'step', 'leave', 'office', 'ousted', 'impeach', 'impeachment', 'removed'], null, 4),
  T('ai', /\b(AI|artificial intelligence)\b/, /\b(ai|artificial intelligence)\b/i, ['ai'], null, 3),
  // country -> leader (low weight: a country name alone is never enough)
  T('uk-leader', /\b(UK|U\.K\.|Britain|British|Starmer|Downing Street|Burnham)\b/, /\b(uk|britain|british|starmer|burnham|prime minister of the united kingdom)\b/i, ['uk', 'starmer', 'burnham', 'downingstreet'], null, 3),
  T('france-leader', /\b(France|French|Macron|Élysée|Elysee)\b/, /\b(france|french|macron)\b/i, ['france', 'french', 'macron'], null, 3),
  T('germany-leader', /\b(Germany|German|Merz|Bundestag)\b/, /\b(germany|german|merz)\b/i, ['germany', 'german', 'merz', 'bundestag'], null, 3),
  T('canada-leader', /\b(Canada|Canadian|Carney|Poilievre)\b/, /\b(canada|canadian|carney|poilievre)\b/i, ['canada', 'canadian', 'carney', 'poilievre'], null, 3),
  T('japan-leader', /\b(Japan|Japanese|Takaichi|Ishiba)\b/, /\b(japan|japanese|takaichi|ishiba)\b/i, ['japan', 'japanese', 'takaichi', 'ishiba'], null, 3),
  T('israel-leader', /\b(Israel|Israeli|Netanyahu|Knesset|Herzog)\b/, /\b(israel|israeli|netanyahu|knesset)\b/i, ['israel', 'israeli', 'netanyahu', 'knesset', 'herzog'], null, 3),
  T('ukraine-leader', /\b(Ukraine|Ukrainian|Zelensky[iy]?)\b/, /\b(ukraine|zelensky[iy]?)\b/i, ['ukraine', 'ukrainian', 'zelensky', 'zelenskiy', 'zelenskyy'], null, 3),
  T('china-leader', /\b(China|Chinese|Xi Jinping|Beijing)\b/, /\b(china|chinese|xi jinping|xi)\b/i, ['china', 'chinese', 'xi', 'jinping', 'beijing'], null, 3),
  T('venezuela', /\b(Venezuela|Maduro|Machado)\b/, /\b(venezuela|maduro|machado)\b/i, ['venezuela', 'maduro', 'machado'], null, 4),
  T('argentina', /\b(Argentina|Milei)\b/, /\b(argentina|milei)\b/i, ['argentina', 'milei'], null, 4),
  T('brazil', /\b(Brazil|Lula|Bolsonaro)\b/, /\b(brazil|lula|bolsonaro)\b/i, ['brazil', 'lula', 'bolsonaro'], null, 4),
  T('iran-leader', /\b(Iran|Iranian|Khamenei|Tehran)\b/, /\b(iran|khamenei)\b/i, ['iran', 'iranian', 'khamenei', 'tehran'], null, 3),
];

// Hurricanes / tropical storms by name: "Hurricane Melissa" -> market text must contain "melissa".
function dynamicTopics(text) {
  const out = [];
  for (const m of text.matchAll(/\b(?:Hurricane|Tropical Storm|Typhoon|Cyclone)\s+([A-Z][a-z]+)\b/g)) {
    const name = m[1].toLowerCase();
    if (out.some((t) => t.key === `storm:${name}`)) continue;
    out.push(T(`storm:${name}`, /./, new RegExp(`\\b${name}\\b`, 'i'), [name, 'hurricane', 'storm', 'tropical'], `hurricane ${name}`, 7));
  }
  return out;
}

// Words that carry no matching signal even when rare in the index.
const WEAK = new Set(['candidate', 'backed', 'senator', 'governor', 'lawmaker', 'trump', 'biden', 'vance', 'us', 'american', 'america', 'democrat', 'republican', 'gop', 'president', 'say', 'says', 'win', 'won', 'wins', 'lose', 'lost', 'race', 'vote', 'voter', 'poll', 'call', 'result',
  'leader', 'party', 'state', 'government', 'official', 'people', 'time', 'end', 'high', 'low', 'rise', 'fall', 'jump', 'drop',
  'deal', 'move', 'record', 'major', 'world', 'country', 'nation', 'public', 'bill', 'law', 'plan', 'group', 'talk', 'meeting',
  'next', 'former', 'top', 'help', 'push', 'face', 'seek', 'run', 'back', 'amid', 'over', 'after', 'reveal', 'hit', 'take',
  'november', 'december', 'october', 'january', '2026', '2027', '2028', 'month', 'end', 'live', 'night', 'stock', 'share', 'market']);

// ---------- index (cached per marketIndex array) ----------
const indexCache = new WeakMap();
function docText(m) { return `${m.eventTitle || ''} ${m.title || ''} ${m.outcome || ''}`; }
function buildIndex(markets) {
  if (indexCache.has(markets)) return indexCache.get(markets);
  const df = new Map();
  const byEvent = new Map();
  const docs = new Map();
  for (const m of markets) {
    if (!m?.id) continue;
    const tok = tokenSet(docText(m));
    docs.set(m.id, tok);
    let ev = byEvent.get(m.eventId);
    if (!ev) { ev = new Set(); byEvent.set(m.eventId, ev); }
    for (const t of tok) ev.add(t);
  }
  for (const ev of byEvent.values()) for (const t of ev) df.set(t, (df.get(t) || 0) + 1);
  const N = Math.max(byEvent.size, 50);
  // A word is "rare" when it is in at most ~1% of events (floor 7). A fixed 7-event cut stopped working once the
  // index held Polymarket AND Kalshi (~5.5k events): "Mississippi" is in 21 events there, so a Mississippi Senate
  // headline no longer matched the Mississippi Senate markets (2026-11-04).
  const rareDf = Math.max(7, Math.round(N / 100));
  const idx = { N, df, docs, rareIdf: Math.log((N + 1) / (rareDf + 1)), idf: (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) };
  indexCache.set(markets, idx);
  return idx;
}

// ---------- news side ----------
export function analyzeCluster(cluster) {
  const items = (cluster?.items?.length ? cluster.items : [{ title: cluster?.title || '' }]).filter((i) => !i.aggregator || cluster.items.length < 2);
  const titles = [cluster?.title, ...items.map((i) => i.title)].filter(Boolean);
  const uniq = [...new Set(titles)];
  const n = uniq.length;
  // Token weight = share of headlines in the cluster that carry it (consensus words matter most), floor 0.5 for
  // the representative title's own words.
  const tw = new Map();
  for (const t of uniq) for (const k of new Set(tokens(t))) tw.set(k, (tw.get(k) || 0) + 1 / n);
  for (const k of tokenSet(cluster?.title || '')) tw.set(k, Math.max(tw.get(k) || 0, 0.5));
  const text = uniq.join(' \n ');
  const topics = [...TOPICS.filter((t) => t.news.test(text)), ...dynamicTopics(text)];
  // Surface words for live-search queries: token -> original word from the representative title.
  const surface = new Map();
  for (const w of String(cluster?.title || '').split(/[\s,;:!?()“”"‘’']+/)) {
    const k = tokens(w)[0];
    if (k && !surface.has(k)) surface.set(k, w.replace(/[^\w.&-]/g, ''));
  }
  return { tw, topics, text, surface };
}

// ---------- scoring ----------
// Months, years and other context words: half a signal (they pick the right market inside a topic, they never
// make a match on their own).
const CONTEXT = /^(january|february|march|april|may|june|july|august|september|october|november|december|20\d\d|q[1-4])$/;
function scoreMarket(m, doc, news, idx, now) {
  const mtext = docText(m);
  const topicHits = news.topics.filter((t) => t.market.test(mtext));
  const covered = new Set();
  for (const t of topicHits) for (const c of t.covers) covered.add(c);
  let tokScore = 0, signals = 0, rareHits = 0;
  const hit = [];
  for (const [t, w] of news.tw) {
    if (!doc.has(t)) continue;
    const idf = news.idf(t);
    if (idf < 1) continue;                      // in most events: no signal
    tokScore += w * idf;
    if (w < 0.34) continue;                     // a word only one minor headline in the cluster used
    if (CONTEXT.test(t)) { signals += 0.5; hit.push(t); continue; }
    if (covered.has(t)) continue;               // already counted through its topic
    if (WEAK.has(t) || /^\d+$/.test(t)) continue;
    if (idf >= 1.8) { signals++; hit.push(t); }
    if (idf >= idx.rareIdf) rareHits++;
  }
  // Topics count once per group (Tesla + SpaceX = one Musk signal); weak topics (w < 4) count half.
  const groups = new Map();
  for (const t of topicHits) groups.set(t.group, Math.max(groups.get(t.group) || 0, t.w >= 4 ? 1 : 0.5));
  for (const v of groups.values()) signals += v;
  const topicScore = topicHits.reduce((s, t) => s + t.w, 0);
  const strongTopic = topicHits.some((t) => t.w >= 5);
  // Needs a topic or a rare word: two weak country-level topics with nothing else ("UK" + "France") never match.
  if (!(strongTopic || rareHits >= 1)) return null;
  // Coverage: how much of the market's distinctive wording the news accounts for (prefers the precise market).
  let mSum = 0, mHit = 0;
  for (const t of doc) { const i = idx.idf(t); if (i < 1.8) continue; mSum += i; if (news.tw.has(t) || covered.has(t)) mHit += i; }
  const coverage = mSum ? mHit / mSum : 0;
  // >= 2 independent signals, or 1.5 when the news covers most of what the market is about.
  if (!(signals >= 2 || (signals >= 1.5 && coverage >= 0.4))) return null;
  let score = tokScore + topicScore;
  score += 6 * coverage;
  if (score < 9) return null;
  const vol = Number(m.volume24h) || 0;
  score *= 1 + Math.min(0.6, 0.15 * Math.log10(1 + vol / 10_000));
  const closes = m.closesAt ? Date.parse(m.closesAt) : NaN;
  if (Number.isFinite(closes) && closes > now && closes - now < 30 * DAY) score *= 1.15;
  if (m.yesPrice != null && (m.yesPrice < 0.03 || m.yesPrice > 0.97)) score *= 0.6;
  const why = [
    ...topicHits.map((t) => `topic:${t.key}`),
    hit.length ? `words:${hit.join(',')}` : null,
    `cover:${coverage.toFixed(2)}`,
  ].filter(Boolean).join(' ');
  return { score: Math.round(score * 10) / 10, why, coverage, signals };
}

// ---------- live search ----------
const SEARCH_TTL = 15 * 60_000;
const SEARCH_GAP = 10_000;
const searchCache = new Map();   // `${host}|${q}` -> {at, markets}
const lastCall = new Map();      // host -> epoch ms
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let UA = 'PNN/0.1 (Pre News Network; local broadcast display)';

async function slot(host, waitMs) {
  const next = (lastCall.get(host) || 0) + SEARCH_GAP;
  const wait = next - Date.now();
  if (wait > 0) { if (wait > waitMs) return false; await sleep(wait); }
  lastCall.set(host, Date.now());
  return true;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) { try { await res.arrayBuffer(); } catch {} throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status }); }
  return res.json();
}

let pmParse = null, ksParse = null;
async function parsers() {
  if (!pmParse) try { pmParse = (await import('../sources/polymarket.mjs')).parsePolymarketEvents; } catch (e) { log('warn', 'match: polymarket parser unavailable', { error: String(e?.message || e) }); }
  if (!ksParse) try { ksParse = (await import('../sources/kalshi.mjs')).parseKalshiMarkets; } catch (e) { log('warn', 'match: kalshi parser unavailable', { error: String(e?.message || e) }); }
}

async function cached(host, q, waitMs, fn) {
  const key = `${host}|${q.toLowerCase()}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.markets;
  if (!(await slot(host, waitMs))) return hit?.markets || [];
  try {
    const markets = await fn();
    searchCache.set(key, { at: Date.now(), markets });
    if (searchCache.size > 400) for (const k of [...searchCache.keys()].slice(0, 100)) searchCache.delete(k);
    return markets;
  } catch (e) {
    log('warn', 'match: live search failed', { host, q, error: String(e?.message || e) });
    if (e?.status === 429) lastCall.set(host, Date.now() + 60_000);
    return hit?.markets || [];
  }
}

export async function searchPolymarket(q, { waitMs = 0 } = {}) {
  await parsers();
  return cached('gamma-api.polymarket.com', q, waitMs, async () => {
    const url = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=5&events_status=active&search_tags=false&search_profiles=false`;
    const j = await getJson(url);
    const events = (j?.events || []).filter((e) => e && !e.closed && e.active !== false && !(e.endDate && Date.parse(e.endDate) < Date.now() - 2 * DAY));
    return pmParse ? pmParse(events, new Date()) : [];
  });
}

// Kalshi's site search (undocumented v1) -> v2-like event/market objects -> parseKalshiMarkets.
// v1 hits carry no per-market 24h volume, so the event's recent_volume is split by each market's share of total volume.
export function kalshiSearchToV2(hits) {
  const out = [];
  for (const h of hits || []) {
    const ms = (h.markets || []).filter((m) => !m.result);
    if (!ms.length) continue;
    const totalVol = ms.reduce((s, m) => s + (Number(m.volume) || 0), 0) || 1;
    out.push({
      event_ticker: h.event_ticker, series_ticker: h.series_ticker, title: h.event_title, category: h.category,
      mutually_exclusive: ms.length > 1 ? true : undefined,
      markets: ms.map((m) => ({
        ticker: m.ticker, event_ticker: h.event_ticker, title: m.title, yes_sub_title: m.yes_subtitle, status: 'active',
        last_price_dollars: m.last_price_dollars, yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars,
        previous_price_dollars: m.previous_price_dollars,
        volume_24h_fp: Math.round((Number(h.recent_volume) || 0) * ((Number(m.volume) || 0) / totalVol)),
        volume_fp: m.volume, close_time: m.close_ts, expected_expiration_time: m.expected_expiration_ts, open_time: m.open_ts,
      })),
    });
  }
  return out;
}

export async function searchKalshi(q, { waitMs = 0 } = {}) {
  await parsers();
  return cached('api.elections.kalshi.com', q, waitMs, async () => {
    const url = `https://api.elections.kalshi.com/v1/search/series?query=${encodeURIComponent(q)}&status=open&page_size=5`;
    const j = await getJson(url);
    const events = kalshiSearchToV2(j?.current_page || []);
    if (!ksParse) return [];
    const series = {};
    for (const h of j?.current_page || []) series[h.series_ticker] = { category: h.category, tags: h.tags || [], frequency: h.product_metadata?.series_frequency };
    return ksParse(events, series, new Date());
  });
}

/** 1-3 short keyword queries for live search: topic queries first, then the rarest words of the headline. */
export function searchQueries(news, idx) {
  const qs = [];
  for (const t of news.topics) if (t.query && !qs.includes(t.query)) qs.push(t.query);
  const words = [...news.tw.entries()]
    .filter(([t, w]) => w >= 0.34 && !WEAK.has(t) && !/^\d+$/.test(t) && news.surface.has(t))
    .map(([t, w]) => ({ t, s: w * idx.idf(t) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => news.surface.get(x.t));
  if (words.length >= 2) qs.push(words.slice(0, 3).join(' '));
  return [...new Set(qs)].slice(0, 2);
}

// ---------- main ----------
let defaultConfig = null;
export async function matchMarkets(cluster, marketIndex = [], opts = {}) {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 6;
  const perEvent = opts.perEvent ?? 2;
  let config = opts.config;
  if (!config) { if (!defaultConfig) defaultConfig = (await import('../config.mjs')).default; config = defaultConfig; }
  if (config?.userAgent) UA = config.userAgent;
  const idx = buildIndex(marketIndex);
  const news = analyzeCluster(cluster);
  news.idf = idx.idf;

  const keep = new Map(); // market id -> classify result (memo per call)
  const allowed = (m) => {
    if (!keep.has(m.id)) keep.set(m.id, classify(m, config, { now }));
    return keep.get(m.id).keep;
  };
  const score = (list, docsFor) => {
    const out = [];
    for (const m of list) {
      const doc = docsFor(m);
      if (!doc) continue;
      const s = scoreMarket(m, doc, news, idx, now);
      if (!s || !allowed(m)) continue;
      const c = keep.get(m.id);
      out.push({ market: c.category && !m.category ? { ...m, category: c.category } : m, score: s.score, why: s.why, origin: 'index' });
    }
    return out;
  };

  let results = score(marketIndex, (m) => idx.docs.get(m.id));
  const best = results.reduce((b, r) => Math.max(b, r.score), 0);
  let queries = [];
  if (opts.search !== false && best < (opts.strongScore ?? 16)) {
    queries = searchQueries(news, idx);
    const have = new Set(results.map((r) => r.market.id));
    const found = [];
    for (const q of queries) {
      const [pm, ks] = await Promise.all([searchPolymarket(q, { waitMs: opts.searchWaitMs ?? 0 }), searchKalshi(q, { waitMs: opts.searchWaitMs ?? 0 })]);
      for (const m of [...pm, ...ks]) if (!have.has(m.id)) { have.add(m.id); found.push(m); }
    }
    const extra = score(found, (m) => tokenSet(docText(m))).map((r) => ({ ...r, origin: 'search' }));
    results = results.concat(extra);
  }

  // Rank, keep the strongest few outcomes per event, drop anything far below the best.
  results.sort((a, b) => b.score - a.score);
  const top = results[0]?.score || 0;
  const perEv = new Map();
  const out = [];
  for (const r of results) {
    if (r.score < top * (opts.relCut ?? 0.45)) break;
    const n = perEv.get(r.market.eventId) || 0;
    if (n >= perEvent) continue;
    perEv.set(r.market.eventId, n + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  if (opts.debug) out.queries = queries;
  return out;
}

export default { matchMarkets, analyzeCluster, searchQueries, searchPolymarket, searchKalshi, kalshiSearchToV2, TOPICS };
