// fetch wrapper: timeouts, ETag/304 (by etagKey), per-host backoff on 429/5xx.
import config from './config.mjs';
import { log } from './log.mjs';

export class HttpError extends Error {
  constructor(message, status, url) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

const etags = new Map();       // etagKey -> { etag, body }
const hosts = new Map();       // host -> { until: epochMs, n: consecutive failures }
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60_000;

function hostOf(url) {
  try { return new URL(url).host; } catch { return 'unknown'; }
}

function penalize(host, retryAfter) {
  const h = hosts.get(host) || { until: 0, n: 0 };
  h.n += 1;
  let wait = Math.min(BASE_BACKOFF_MS * 2 ** (h.n - 1), MAX_BACKOFF_MS);
  const ra = Number(retryAfter);
  if (Number.isFinite(ra) && ra > 0) wait = Math.max(wait, Math.min(ra * 1000, MAX_BACKOFF_MS));
  h.until = Date.now() + wait;
  hosts.set(host, h);
  return wait;
}

/** Seconds until a host may be called again (0 when it is not backing off). */
export function hostBackoffSec(url) {
  const h = hosts.get(hostOf(url));
  return h ? Math.max(0, Math.ceil((h.until - Date.now()) / 1000)) : 0;
}

async function request(url, { timeoutMs = 15_000, etagKey, accept = 'application/json', headers = {} } = {}, parse) {
  const host = hostOf(url);
  const h = hosts.get(host);
  if (h && h.until > Date.now()) {
    throw new HttpError(`backing off ${host} for ${Math.ceil((h.until - Date.now()) / 1000)}s`, 429, url);
  }
  const hdrs = { 'User-Agent': config.userAgent, Accept: accept, ...headers };
  const cached = etagKey ? etags.get(etagKey) : null;
  if (cached?.etag) hdrs['If-None-Match'] = cached.etag;
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    log('warn', 'http fail', { host, url, ms, error: String(e?.message || e) });
    throw new HttpError(String(e?.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : e?.message || e), 0, url);
  }
  const ms = Math.round(performance.now() - t0);
  if (res.status === 304 && cached) {
    hosts.delete(host);
    log('debug', 'http 304', { host, url, ms });
    return cached.body;
  }
  if (!res.ok) {
    let wait = 0;
    if (res.status === 429 || res.status >= 500) wait = penalize(host, res.headers.get('retry-after'));
    try { await res.arrayBuffer(); } catch {}
    log('warn', 'http error', { host, url, status: res.status, ms, backoffSec: Math.round(wait / 1000) });
    throw new HttpError(`HTTP ${res.status}`, res.status, url);
  }
  const text = await res.text();
  hosts.delete(host);
  let body;
  try {
    body = parse(text);
  } catch (e) {
    log('warn', 'http parse error', { host, url, ms, error: String(e?.message || e) });
    throw new HttpError(`bad body: ${e?.message || e}`, res.status, url);
  }
  const etag = res.headers.get('etag');
  if (etagKey && etag) etags.set(etagKey, { etag, body });
  log('debug', 'http ok', { host, url, status: res.status, ms, bytes: text.length });
  return body;
}

export function getJSON(url, opts = {}) {
  return request(url, { accept: 'application/json', ...opts }, (t) => JSON.parse(t));
}

export function getText(url, opts = {}) {
  return request(url, { accept: '*/*', ...opts }, (t) => t);
}
