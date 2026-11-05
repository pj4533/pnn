// Google News RSS search -> recent headlines for one story (ingest.mjs: the per-story news search behind the news
// gate, run on a per-cycle request budget). Fails soft ([]) unless opts.throwOnError.
import fs from 'node:fs';
import { getText } from '../http.mjs';

const TTL_MS = 10 * 60_000;
const cache = new Map(); // key -> {at, items}

const decode = (s) => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };

// ---------- what never airs as the news item ----------
// English broadcast: an outlet or headline in a non-Latin script ("Судово-юридична газета") never airs as the news item.
export const nonLatin = (s) => /[Ͱ-ϿЀ-ԯ֐-ۿऀ-෿฀-໿぀-鿿가-힯]/.test(String(s || ''));

// Independence (CLAUDE.md "Stay independent", user 2026-11-05): PNN reports what markets price, so a prediction-market
// operator's own "news" (Kalshi News, Polymarket, Robinhood prediction markets, sportsbook odds pages) is never the
// independent news item. Social posts, hyperlocal rewrites and scraper farms are not broadcast sources either.
const EXCHANGE_OUTLET = /\b(kalshi|polymarket|robinhood|draftkings|fanduel|betmgm|bet365|caesars|prizepicks|underdog fantasy|novig|manifold|metaculus|predictit|crypto\.com|coinbase|action network|oddsshark|vegasinsider|sportsbook ?review|covers\.com|bookies\.com|sportsbook|prediction markets?)\b/i;
const SOCIAL_OUTLET = /^(facebook|instagram|x|twitter|x \(formerly twitter\)|tiktok|reddit|youtube|threads|linkedin|pinterest|quora|telegram|bluesky|mastodon|medium|substack|tumblr|truth social)$|\b(facebook|instagram|tiktok|reddit)\b/i;
const SCRAPER_OUTLET = /\b(just jared|tmz|radar ?online|ok! magazine|okmagazine|perez hilton|hollywoodlife|daily star|rotten tomatoes|wikipedia|metacritic|box office mojo|newztodays?|newscord|newsbreak|dailyhunt|devdiscourse|opoyi|bignewsnetwork|indexbox|patch|breaking ?news ?today|latestly|newsx|menafn|bharat express)\b/i;
const BLOCK_DOMAINS = /(^|\.)(kalshi\.com|polymarket\.com|robinhood\.com|draftkings\.com|fanduel\.com|betmgm\.com|prizepicks\.com|predictit\.org|manifold\.markets|metaculus\.com|facebook\.com|fb\.com|fb\.watch|instagram\.com|x\.com|twitter\.com|tiktok\.com|reddit\.com|youtube\.com|youtu\.be|threads\.net|linkedin\.com|pinterest\.com|quora\.com|t\.me|bsky\.app|medium\.com|substack\.com|newztodays\.com|newscord\.com|newsbreak\.com|patch\.com|actionnetwork\.com|oddsshark\.com|vegasinsider\.com|covers\.com|bookies\.com)$/i;
// Promo / betting-odds / exchange-coverage headlines: the news item must not be about the markets themselves.
const PROMO_TITLE = /\((photos?|pics|video|slideshow)\)|\|\s*(rotten tomatoes|imdb|wikipedia|metacritic)$|\b(kalshi|polymarket|predictit|prediction markets?|betting (odds|sites?|apps?|promos?)|sportsbooks?|promo codes?|bonus bets?|sign-?up bonus|best bets?|parlays?|odds (boost|today)|dfs|draftkings|fanduel|betmgm)\b/i;
// Sensitive (CLAUDE.md, DECISIONS D4): the news item next to a market never carries graphic death / violence wording.
const SENSITIVE_TITLE = /\b(dead|dies|died|killed|kills|killing|murders?|murdered|manslaughter|assassinat\w*|massacre|genocide|suicide|shooting|shot dead|stabbed|stabbing|bomb(s|ing|ed)?|terror\w*|beheaded|hostages?|death toll|corpses?|bodies)\b/i;
// "russian diesel imports blocked by new jersey despite trump": a feed that lowercases every headline is a scraper.
export function garbledTitle(title) {
  const t = String(title || '').trim();
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 16) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (upper === 0) return true;                                  // no capital at all
  if (/^[a-z]{4,}\b/.test(t) && !/^(iphone|ipad|ipod|imac|ios|ipados|macos|ebay|eurosport|iowa|iran|iraq)\b/i.test(t) && upper / letters.length < 0.06) return true;   // starts lowercase, almost no capitals
  return false;
}
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** Why this news item must never air as the news item (null = fine). `it`: {title, outlet?, source?, sourceUrl?, url?} */
export function badNewsSource(it) {
  if (!it) return 'empty';
  const outlet = String(it.outlet || it.source || '').replace(/ via .*$/, '').trim();
  const outlets = [outlet, ...String(it.outlet || it.source || '').split(/ via | and /)].filter(Boolean);
  if (outlets.some((o) => EXCHANGE_OUTLET.test(o))) return 'exchange';
  if (outlets.some((o) => SOCIAL_OUTLET.test(o))) return 'social';
  if (outlets.some((o) => SCRAPER_OUTLET.test(o))) return 'scraper';
  const d = domainOf(it.sourceUrl) || (/news\.google\.com/.test(String(it.url || '')) ? '' : domainOf(it.url));
  if (d && BLOCK_DOMAINS.test(d)) return /kalshi|polymarket|robinhood|draftkings|fanduel|betmgm|prizepicks|predictit|manifold|metaculus|actionnetwork|oddsshark|vegasinsider|covers|bookies/.test(d) ? 'exchange' : 'social';
  if (PROMO_TITLE.test(String(it.title || ''))) return 'promo';
  if (SENSITIVE_TITLE.test(String(it.title || ''))) return 'sensitive';
  if (garbledTitle(it.title)) return 'garbled';
  return null;
}

// A headline the publisher (or Google) cut mid-word ("... Trying to Form a Coalitio") or with an ellipsis never airs:
// the on-screen rule is no truncated text. Generic detection: a final word that is no word of its own but the start of
// a longer word seen elsewhere in the headlines we have read (learnWords), or a dangling function word / dash / comma.
const vocab = new Set();        // full words (lowercase, >= 4 letters) seen anywhere but at the end of a headline
const prefixes = new Set();     // every proper prefix (>= 4 letters) of a vocab word
const known = new Set();        // inflection bases of vocab words ("hostilities" -> "hostility"): valid words too
const VOCAB_MAX = 80_000;
const VOCAB_MIN = 1500;         // the prefix test is meaningless on a handful of headlines
const bases = (w) => {
  const b = [];
  if (w.endsWith('ies')) b.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('ied')) b.push(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) b.push(w.slice(0, -2));
  if (w.endsWith('s')) b.push(w.slice(0, -1));
  if (w.endsWith('ed')) b.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) b.push(w.slice(0, -3), `${w.slice(0, -3)}e`);
  if (w.endsWith('ly')) b.push(w.slice(0, -2));
  if (w.endsWith('er') || w.endsWith('or')) b.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ers') || w.endsWith('ors')) b.push(w.slice(0, -3), w.slice(0, -1));
  return b;
};
let dict = null;   // /usr/share/dict/words when the host has it (macOS, most Linux)
function loadDict() {
  if (dict !== null) return;
  dict = false;
  try {
    const f = ['/usr/share/dict/words', '/usr/dict/words'].find((x) => fs.existsSync(x));
    if (f) dict = new Set(fs.readFileSync(f, 'utf8').toLowerCase().split('\n').filter((x) => /^[a-z]{3,}$/.test(x)));
  } catch { dict = false; }
}
const inDict = (w) => { loadDict(); return dict ? (dict.has(w) || bases(w).some((b) => dict.has(b))) : false; };
export function learnWords(titles) {
  for (const title of titles || []) {
    const ws = String(title || '').toLowerCase().replace(/[’']s\b/g, '').split(/[^a-zà-ÿ]+/).filter(Boolean);
    for (let i = 0; i < ws.length - 1; i++) {
      const w = ws[i];
      if (w.length < 4 || w.length > 18 || vocab.has(w) || vocab.size >= VOCAB_MAX) continue;
      vocab.add(w);
      for (const b of bases(w)) known.add(b);
      for (let k = 4; k < w.length; k++) prefixes.add(w.slice(0, k));
    }
  }
}
const DANGLING = /\b(of|the|and|to|a|an|with|from|that|his|her|their|its|than|into)$/i;
export function looksCut(title) {
  const t = String(title || '').trim();
  if (/(\.\.\.|…)$/.test(t) || /[,;:–—-]$/.test(t)) return true;
  if (t.length >= 80 && /\s[A-Z][a-z]?$/.test(t) && !/\s(A|I|US|UK|EU|UN)$/.test(t)) return true;
  if (t.length >= 30 && DANGLING.test(t)) return true;
  // two sentences with no full stop at the end ("... No Clear Winner. These Parties Are Trying to Form a Coalitio"): the second one was cut
  if (/[a-z]{3,}\. [A-Z][^.?!]{12,}[A-Za-z0-9]$/.test(t)) {
    const last = t.split(/\s+/).pop().toLowerCase();
    if (/^[a-zà-ÿ]{5,18}$/.test(last) && !vocab.has(last) && !known.has(last) && !inDict(last)) return true;
  }
  if (t.length >= 30 && /[A-Za-z]$/.test(t)) {
    const last = t.split(/\s+/).pop().toLowerCase();
    // a word that is no word of its own (not seen whole, not an inflection of one, not in the dictionary) but the start of a
    // longer one ("Coalitio" -> coalition) was cut by the feed
    if (/^[a-zà-ÿ]{5,18}$/.test(last) && !vocab.has(last) && !known.has(last) && !inDict(last)
      && vocab.size >= VOCAB_MIN && prefixes.has(last)) return true;
  }
  return false;
}
export function parseRss(xml) {
  const items = String(xml).split(/<item[\s>]/).slice(1);
  const out = items.map((it) => {
    let title = tag(it, 'title');
    let source = tag(it, 'source');
    const sourceUrl = (it.match(/<source[^>]*\surl="([^"]+)"/) || [])[1] || null;
    const i = title.lastIndexOf(' - ');
    if (i > 0) { if (!source) source = title.slice(i + 3); title = title.slice(0, i); }
    const t = Date.parse(tag(it, 'pubDate'));
    return { title, source, sourceUrl, url: tag(it, 'link'), publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null };
  }).filter((x) => x.title && x.url);
  learnWords(out.map((x) => x.title));
  // Google's own relevance order is kept (its first hits are the story, its tail is whatever else was recent); callers
  // that want freshness sort themselves (newsdesk / matchStoryNews do).
  return out.filter((x) => !looksCut(x.title) && !nonLatin(x.title) && !nonLatin(x.source) && !badNewsSource(x));
}

// Google News search operators: leave the exchanges, social networks and scraper farms out of the result list, so the
// 10-item window fills with real outlets instead of being spent on items parseRss then drops.
// (Four operators at most: a longer list makes Google drop its relevance ranking, tested 2026-11-05. The rest is dropped in parseRss.)
const EXCLUDE_SITES = ['kalshi.com', 'polymarket.com', 'robinhood.com', 'facebook.com'];
const EXCLUDE_OPS = EXCLUDE_SITES.map((d) => `-site:${d}`).join(' ');

// Query hygiene (2026-11-05): market wording is full of thresholds that never appear in a headline ("above 3.80",
// "closes price above 97.99 USD t.oz", "receives least 52% popular vote"). Drop them so the search finds the story.
const QUERY_DROP = /^(above|below|closes?|closing|least|most|between|exceeds?|exceeding|reach(es)?|hits?|usd|eur|gbp|t\.oz|oz|ounce|barrel|bbl|pts|points?|percent|mom|yoy|qoq)$/i;
const QUERY_NUM = /^[$€£<>≥≤~+–-]*\d[\d.,]*[%kmbt]*$/i;
export function refineQuery(q) {
  const words = String(q || '').trim().split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !QUERY_DROP.test(w) && !(QUERY_NUM.test(w) && !/^(19|20)\d\d$/.test(w)));
  return (kept.length >= 2 || (kept.length === 1 && kept[0].length >= 4) ? kept : words).join(' ');
}

// opts.throwOnError: rethrow fetch errors (HttpError with .status) so the caller can stop its cycle and back off;
// http.mjs already backs the host off on 429 / 5xx. opts.ttlMs overrides the per-query cache (default 10 min).
// A result list thinner than `thin` clean items (the exchanges, social posts and scraper farms are dropped) gets one
// broader retry on the query's leading words, so a strict source filter refills the pool instead of starving it.
async function searchOnce(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} ${EXCLUDE_OPS}`)}&hl=en-US&gl=US&ceid=US:en`;
  return parseRss(await getText(url, { timeoutMs: 12_000 }));
}
export async function fetchHeadlines(query, { max = 2, throwOnError = false, ttlMs = TTL_MS, thin = 4 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const hit = cache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < ttlMs) return hit.items.slice(0, max);
  try {
    const rq = refineQuery(q);
    let items = await searchOnce(rq);
    const lead = rq.split(/\s+/).slice(0, 3).join(' ');
    if (items.length < thin && lead && lead.toLowerCase() !== rq.toLowerCase()) {
      await new Promise((r) => setTimeout(r, 800));
      try {
        const seen = new Set(items.map((x) => x.url));
        items = items.concat((await searchOnce(lead)).filter((x) => !seen.has(x.url)));
      } catch (e) { if (throwOnError && (e?.status === 429 || e?.status >= 500)) throw e; }
    }
    items = items.slice(0, 25);
    cache.set(q.toLowerCase(), { at: Date.now(), items });
    // one entry per distinct query would otherwise grow forever
    if (cache.size > 300) { const cut = Date.now() - 6 * TTL_MS; for (const [k, v] of cache) if (v.at < cut) cache.delete(k); }
    if (cache.size > 300) for (const k of [...cache.keys()].slice(0, cache.size - 300)) cache.delete(k);
    return items.slice(0, max);
  } catch (e) {
    if (throwOnError) throw e;
    return hit ? hit.items.slice(0, max) : [];
  }
}
