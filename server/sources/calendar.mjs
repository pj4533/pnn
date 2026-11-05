// Next Big Decision: the next scheduled resolutions (data releases, Fed decisions, award shows) within 14 days,
// built from markets PNN already has (no extra network). Pure.
//   buildCountdown(markets, {now, storyIdFor, days=14, max=3, minVolume=5000}) -> state.countdown
//   [{ id, title, at: ISO, storyId|null, label, yesPrice, change1d, source }]

// Scheduled decision kinds: what the market text must match, and the chip title.
const KINDS = [
  { re: /\b(cpi|consumer price index|inflation rate|core inflation)\b/i, title: 'Inflation report' },
  { re: /\b(fed|fomc|federal reserve)\b.*\b(rate|rates|decision|cut|hike|meeting)\b|\b(rate|rates)\b.*\b(fed|fomc)\b|\bfed funds\b/i, title: 'Fed decision' },
  { re: /\b(nonfarm|non-farm|payrolls|jobs report|unemployment rate|jobless rate)\b/i, title: 'Jobs report' },
  { re: /\bgdp\b/i, title: 'GDP report' },
  { re: /\b(pce|retail sales|ppi|producer price)\b/i, title: 'Data release' },
  { re: /\b(ecb|bank of england|boe|bank of japan|boj|bank of canada)\b.*\b(rate|rates|decision)\b/i, title: 'Central bank decision' },
  { re: /\b(oscars?|academy awards?)\b/i, title: 'The Oscars' },
  { re: /\bgrammys?\b/i, title: 'The Grammys' },
  { re: /\bemmys?\b/i, title: 'The Emmys' },
  { re: /\bgolden globes?\b/i, title: 'The Golden Globes' },
  { re: /\b(game awards|ballon d'or|nobel|time person of the year|person of the year)\b/i, title: 'Award announcement' },
  { re: /\b(earnings|eps)\b/i, title: 'Earnings report' },
];

const kindOf = (m) => {
  const text = `${m.eventTitle || ''} ${m.title || ''}`;
  return KINDS.find((k) => k.re.test(text)) || null;
};

export function buildCountdown(markets, { now = Date.now(), storyIdFor = () => null, days = 14, max = 3, minVolume = 5000 } = {}) {
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
  const end = nowMs + days * 86_400_000;
  const byEvent = new Map();   // eventId -> {kind, at, markets[]}
  for (const m of markets || []) {
    if (!m?.closesAt || !(m.yesPrice > 0.02 && m.yesPrice < 0.98)) continue;
    const at = Date.parse(m.closesAt);
    if (!(at > nowMs + 60_000 && at <= end)) continue;
    const k = kindOf(m);
    if (!k) continue;
    const ev = byEvent.get(m.eventId) || { kind: k, at, markets: [], vol: 0 };
    ev.at = Math.min(ev.at, at);
    ev.markets.push(m);
    ev.vol += m.volume24h || 0;
    byEvent.set(m.eventId, ev);
  }
  const events = [...byEvent.entries()].filter(([, e]) => e.vol >= minVolume);
  // Per decision kind and day keep the busiest event (Kalshi and Polymarket both list the Fed meeting).
  const best = new Map();
  for (const [id, e] of events) {
    const key = `${e.kind.title}|${new Date(e.at).toISOString().slice(0, 10)}`;
    const prev = best.get(key);
    if (!prev || e.vol > prev[1].vol) best.set(key, [id, e]);
  }
  const out = [];
  for (const [id, e] of [...best.values()].sort((a, b) => a[1].at - b[1].at)) {
    // The line: the outcome nearest a coin flip among the busier half (the ladder rung that is actually in play).
    const ms = e.markets.slice().sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
    const pool = ms.slice(0, Math.max(1, Math.ceil(ms.length / 2)));
    const lead = pool.reduce((b, m) => (Math.abs(m.yesPrice - 0.5) < Math.abs(b.yesPrice - 0.5) ? m : b), pool[0]);
    let storyId = null;
    try { storyId = storyIdFor(lead.id) || storyIdFor(id) || null; } catch { storyId = null; }
    out.push({
      id: `cd:${id}`,
      title: e.kind.title,
      at: new Date(e.at).toISOString(),
      storyId,
      marketId: lead.id,
      label: labelOf(lead),
      yesPrice: lead.yesPrice,
      change1d: lead.change1d ?? null,
      source: lead.source,
      eventTitle: lead.eventTitle || null,
      volume24h: Math.round(e.vol),
    });
    if (out.length >= max) break;
  }
  return out;
}

// "Will the Fed cut rates in December?" -> "The Fed cutting rates in December" (never "will", no question mark), so it
// reads after "traded on ..." / "on the move: ...". Multi-outcome markets use the outcome name ("Gavin Newsom").
const GERUND = { be: 'being', win: 'winning', hit: 'hitting', cut: 'cutting', get: 'getting', put: 'putting', set: 'setting',
  run: 'running', stop: 'stopping', drop: 'dropping', ban: 'banning', plan: 'planning', see: 'seeing', lie: 'lying', die: 'dying' };
const VERBS = /^(be|win|hit|cut|get|put|set|run|stop|drop|ban|plan|see|reach|pass|raise|hike|lower|lose|beat|announce|sign|leave|become|remain|have|make|say|visit|meet|end|launch|release|approve|confirm|return|close|finish|happen|occur|default|resign|stay|join|receive|exceed|fall|rise|increase|decrease|top|lead|break|declare|nominate|endorse|tweet|post|attend|change|hold|keep|go|take|move|open|record|surpass|flip|pardon|veto|impose|lift|enter|exit|file|face|testify|announce|introduce|acquire|buy|sell|list|ipo|land|reopen|agree|sanction|recognize|reduce|announce)$/i;
function gerund(v) {
  const l = v.toLowerCase();
  if (GERUND[l]) return GERUND[l];
  if (/ie$/.test(l)) return l.slice(0, -2) + 'ying';
  if (/[^aeiou]e$/.test(l) && l !== 'be') return l.slice(0, -1) + 'ing';
  return l + 'ing';
}
export function labelOf(m) {
  let raw = String(m.outcome || m.title || m.eventTitle || '').trim();
  if (!m.outcome && /^will\s+/i.test(raw)) {
    const words = raw.replace(/^will\s+/i, '').replace(/\?$/, '').split(/\s+/);
    const i = words.findIndex((w, k) => k > 0 && k <= 6 && VERBS.test(w));
    if (i > 0) { words[i] = gerund(words[i]); raw = words.join(' '); }
  }
  const bps = (n) => (n === 25 ? 'a quarter point' : n === 50 ? 'half a point' : n === 75 ? 'three quarters of a point' : `${n / 100} points`);
  return raw.replace(/^will\s+/i, '').replace(/\?$/, '')
    .replace(/(\d+)\s*\+?\s*bps?\b/gi, (_, n) => bps(Number(n)))
    .replace(/^./, (c) => c.toUpperCase());
}

export default { buildCountdown, labelOf };
