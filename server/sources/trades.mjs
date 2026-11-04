// Polymarket data-api trades, for MONEY MOVING. v1 (/trades?market=) was retired; v2 verified 2026-11-04:
//   GET https://data-api.polymarket.com/v2/trades?condition=<id,id,... (max 20)>&limit=100&filterType=CASH&filterAmount=10000
//   -> {data: [{condition_id, token_id, side, size, price, timestamp, outcome, outcome_index, transaction_hash, ...}], pagination}
// The response also carries trader handles (name, pseudonym, proxy_wallet). They are dropped here and never leave this file.
import { getJSON } from '../http.mjs';

const BASE = 'https://data-api.polymarket.com/v2/trades';

/**
 * Big trades on a set of Polymarket markets (one request per 10 markets).
 * @returns [{key, conditionId, amount (USD), yesPrice (0..1, YES-equivalent), side, outcomeIndex, at (epoch sec)}], newest first
 */
export async function fetchBigTrades(conditionIds, { minCash = 10_000, limit = 100, timeoutMs = 15_000, paceMs = 600, chunk = 10 } = {}) {
  const ids = [...new Set((conditionIds || []).filter((c) => /^0x[0-9a-f]+$/i.test(String(c))))];
  if (!ids.length) return [];
  // The API takes at most 20 condition ids per request (HTTP 400 otherwise) and a big filtered query can 503 after ~5s
  // (live 2026-11-04): chunks of 10, paced; a failed chunk is skipped, and only an all-failed poll throws.
  const out = [];
  let ok = 0, lastErr = null;
  for (let i = 0; i < ids.length; i += chunk) {
    if (i) await new Promise((r) => setTimeout(r, paceMs));
    const url = `${BASE}?condition=${ids.slice(i, i + chunk).join(',')}&limit=${limit}&filterType=CASH&filterAmount=${Math.round(minCash)}`;
    try { out.push(...parseTrades(await getJSON(url, { timeoutMs }))); ok++; } catch (e) { lastErr = e; }
  }
  if (!ok && lastErr) throw lastErr;
  return out.sort((a, b) => b.at - a.at);
}

/** Pure: data-api v2 response -> normalized trades (no trader identity). */
export function parseTrades(j) {
  const out = [];
  for (const t of (Array.isArray(j) ? j : j?.data) || []) {
    const size = Number(t.size), price = Number(t.price), ts = Number(t.timestamp);
    if (!Number.isFinite(size) || !Number.isFinite(price) || !Number.isFinite(ts) || !t.condition_id) continue;
    const idx = Number(t.outcome_index ?? (String(t.outcome).toLowerCase() === 'no' ? 1 : 0));
    out.push({
      key: `${t.transaction_hash || ''}:${t.token_id || ''}:${size}:${ts}`,
      conditionId: t.condition_id,
      amount: Math.round(size * price),
      // A NO trade at 9% is money changing hands at a 91% YES price; everything airs as the YES side.
      yesPrice: idx === 1 ? 1 - price : price,
      side: t.side || null,
      outcomeIndex: idx,
      at: ts,
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

export default { fetchBigTrades, parseTrades };
