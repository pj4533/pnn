// Google News RSS search -> recent headlines for one story (ingest.mjs: the per-story news search behind the news
// gate, run on a per-cycle request budget). Fails soft ([]) unless opts.throwOnError.
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

// A headline the publisher (or Google) cut mid-word ("... the Secretary of De") or with an ellipsis never airs: the
// on-screen rule is no truncated text.
// English broadcast: an outlet or headline in a non-Latin script ("Судово-юридична газета") never airs as the news item.
export const nonLatin = (s) => /[\u0370-\u03ff\u0400-\u052f\u0590-\u06ff\u0900-\u0dff\u0e00-\u0eff\u3040-\u9fff\uac00-\ud7af]/.test(String(s || ''));
export function looksCut(title) {
  const t = String(title || '').trim();
  return /(\.\.\.|…)$/.test(t) || (t.length >= 80 && /\s[A-Z][a-z]?$/.test(t) && !/\s(A|I|US|UK|EU|UN)$/.test(t));
}
export function parseRss(xml) {
  const items = String(xml).split(/<item[\s>]/).slice(1);
  return items.map((it) => {
    let title = tag(it, 'title');
    let source = tag(it, 'source');
    const i = title.lastIndexOf(' - ');
    if (i > 0) { if (!source) source = title.slice(i + 3); title = title.slice(0, i); }
    const t = Date.parse(tag(it, 'pubDate'));
    return { title, source, url: tag(it, 'link'), publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null };
  }).filter((x) => x.title && x.url && !looksCut(x.title) && !nonLatin(x.title) && !nonLatin(x.source))
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
}

// opts.throwOnError: rethrow fetch errors (HttpError with .status) so the caller can stop its cycle and back off;
// http.mjs already backs the host off on 429 / 5xx. opts.ttlMs overrides the per-query cache (default 10 min).
export async function fetchHeadlines(query, { max = 2, throwOnError = false, ttlMs = TTL_MS } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const hit = cache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < ttlMs) return hit.items.slice(0, max);
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const xml = await getText(url, { timeoutMs: 12_000 });
    const items = parseRss(xml).slice(0, 10);
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
