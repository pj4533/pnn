// Formatting helpers. Plain English only: percentages, "up 7 pts today". Never ¢, YES/NO or bps.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const toMs = (t) => (t == null ? NaN : typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t));

/** 0..1 → "72%". Never shows 0% or 100% for a live market: uses "<1%" / ">99%". */
export function pct(p) {
  if (p == null || Number.isNaN(p)) return '–';
  if (p > 0 && p < 0.005) return '<1%';
  if (p < 1 && p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}
/** Number only, for big displays where the % sign is styled separately. */
export function pctNum(p) {
  if (p == null || Number.isNaN(p)) return '–';
  if (p > 0 && p < 0.005) return '<1';
  if (p < 1 && p > 0.995) return '>99';
  return String(Math.round(p * 100));
}

/** Absolute delta in probability → whole points (rounded). */
// Round the magnitude (like server copy.mjs pts()), so -29.5 shows as 30 on screen and in the headline alike.
export const ptsOf = (d) => (d == null || Number.isNaN(d) ? null : Math.sign(d) * Math.round(Math.abs(d) * 100));

/** "up 7 pts today" / "down 20 pts today" / "unchanged today". */
export function moveText(d, when = 'today') {
  const n = ptsOf(d);
  if (n == null) return '';
  if (n === 0) return `unchanged ${when}`.trim();
  return `${n > 0 ? 'up' : 'down'} ${Math.abs(n)} ${Math.abs(n) === 1 ? 'pt' : 'pts'} ${when}`.trim();
}
/** Compact signed form for tickers: "▲ 12", "▼ 4", "● 0". */
export function moveShort(d) {
  const n = ptsOf(d);
  if (n == null) return '';
  if (n === 0) return '● 0';
  return `${n > 0 ? '▲' : '▼'} ${Math.abs(n)}`;
}
export const moveCls = (d) => { const n = ptsOf(d); return n == null || n === 0 ? 'flat' : n > 0 ? 'up' : 'down'; };

/** USD volume → "$1.5M", "$640K", "$9K". */
export function money(n) {
  if (n == null || Number.isNaN(n)) return '$0';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

export const EXCHANGE = { polymarket: 'Polymarket', kalshi: 'Kalshi' };
export const exchangeName = (s) => EXCHANGE[s] || (s ? s[0].toUpperCase() + s.slice(1) : 'Exchange');

/** "3m ago", "just now", "2h ago". */
export function ago(t, now = Date.now()) {
  const ms = toMs(t);
  if (Number.isNaN(ms)) return 'time unknown';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Time until an ISO date in plain words: "in 2 days 4 hrs", "in 5 hrs", "in 40 min". */
export function until(t, now = Date.now()) {
  const ms = toMs(t) - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'closing now';
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `in ${d} ${d === 1 ? 'day' : 'days'}${h % 24 ? ` ${h % 24} hr${h % 24 === 1 ? '' : 's'}` : ''}`;
  if (h >= 1) return `in ${h} hr${h === 1 ? '' : 's'}${m % 60 ? ` ${m % 60} min` : ''}`;
  return `in ${Math.max(1, m)} min`;
}

export const etClock = (t = Date.now()) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });
export const etDate = (t = Date.now()) => new Date(t).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
export const etShort = (t) => new Date(toMs(t)).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** Human label for one market inside a story. */
export const marketLabel = (m) => m?.label || (m?.outcome ? m.outcome : m?.title || m?.eventTitle || '');

/** "$10M Kalshi · $1.4M Polymarket" for a story on both exchanges, else "$1.4M". */
export function storyVolume(story) {
  const sv = (story?.sourceVolumes || []).filter((x) => x && Number.isFinite(x.volume24h));
  if (sv.length > 1) return sv.map((x) => `${money(x.volume24h)} ${exchangeName(x.source)}`).join(' · ');
  return money(sv[0]?.volume24h ?? story?.lead?.volume24h);
}

export const CATEGORY = {
  politics: 'Politics', geopolitics: 'World', economy: 'Economy', courts: 'Courts', tech: 'Tech', science: 'Science',
  health: 'Health', culture: 'Culture', weather: 'Weather', world: 'World', sports: 'Sports', games: 'Games',
};
export const categoryName = (c) => CATEGORY[c] || (c ? c[0].toUpperCase() + c.slice(1) : 'Markets');

/** The accompanying news item of a story (the first with a headline), or null. The server should always attach one. */
export function newsOf(story) {
  const n = Array.isArray(story?.news) ? story.news : story?.news ? [story.news] : [];
  return n.find((x) => x && String(x.title || '').trim()) || null;
}
export const newsOutlet = (n) => String(n?.source || n?.outlet || 'News');
/** "Reuters · 12m ago" (outlet + age; age omitted when the item has no time). */
export const newsMeta = (n, now = Date.now()) => `${newsOutlet(n)}${n?.publishedAt ? ` · ${ago(n.publishedAt, now)}` : ''}`;
/** The standard IN THE NEWS block, same markup on every card kind. '' when the item has no headline (the block hides). */
export function newsLineHtml(n, now = Date.now(), attrs = 'data-drop="6"') {
  if (!n || !String(n.title || '').trim()) return '';
  return `<div class="bc-newsline" ${attrs}><span class="bc-nl-h">IN THE NEWS</span><span class="bc-nl-t fit" data-fit-h>${esc(n.title)}</span><span class="bc-nl-s fit">${esc(newsMeta(n, now))}</span></div>`;
}

/** Distinct neon colors for outcome bars. */
export const OUTCOME_COLORS = ['#00f0ff', '#ff2bd6', '#ffb13b', '#a78bff', '#3dffb0'];

/** Source + time + size line shown with every story (editorial rule). */
export function metaParts(m, now = Date.now()) {
  return { exchange: exchangeName(m?.source), updated: `updated ${ago(m?.updatedAt, now)}`, volume: `${money(m?.volume24h)} traded in 24 hrs` };
}

export function report(kind, err, extra = {}) {
  try {
    console.error('[pnn]', kind, err);
    const body = JSON.stringify({ kind, error: String(err?.stack || err?.message || err), url: location.href, at: new Date().toISOString(), ...extra });
    fetch('/api/client-log', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* never throw from the reporter */ }
}

export const safe = (kind, fn) => { try { return fn(); } catch (e) { report(kind, e); return undefined; } };

/** Screen text never shows an ellipsis (house rule). Source titles like "Putin out by…?" become "Putin out?". */
export function noEllipsis(t) {
  if (typeof t !== 'string') return t;
  return t.replace(/\s+(by|before|through|until|in|after|on)?\s*(\.\.\.|\u2026)\s*(\?)?\s*$/i, (m, w, e, q) => (q ? '?' : ''))
    .replace(/\s*(\.\.\.|\u2026)\s*/g, ' ').replace(/\s+\?$/, '?').trim();
}
const TEXT_KEYS = new Set(['title', 'eventTitle', 'outcome', 'headline', 'dek', 'line', 'label']);
/** Deep-clean the text fields of a State or Alert in place. */
export function cleanText(o) {
  if (Array.isArray(o)) { o.forEach(cleanText); return o; }
  if (!o || typeof o !== 'object') return o;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && TEXT_KEYS.has(k)) o[k] = noEllipsis(v);
    else if (v && typeof v === 'object' && k !== 'history') cleanText(v);
  }
  return o;
}
