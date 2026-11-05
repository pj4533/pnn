// PNN news wire: polls ~30 news feeds, keeps a bounded ring of recent headlines, clusters them into stories and
// emits 'breaking' when a story is corroborated. Standalone; feed list, intervals and patterns live in
// server/wire-config.mjs.
//
// API
//   const wire = createWire(overrides?)       overrides are shallow-merged over wire-config (feeds, breaking, ...)
//   wire.start()                              staggered first polls, then each feed on its own jittered timer
//   wire.stop()
//   await wire.pollAll()                      one poll of every feed now (tests / warm start); returns status()
//   wire.items({limit, since, category})      newest-first WireItem[] from the ring
//   wire.clusters({limit, minOutlets})        current clusters (last 45 min window kept for 6h), best first
//   wire.detect({now})                        run breaking detection now; returns newly fired Cluster[] (also emitted)
//   wire.status()                             per-feed {id, outlet, ok, lastOk, lastError, items, newestAgeMin, status, backoffSec}
//   wire.on('breaking', fn(cluster)) / wire.on('items', fn(newItems)) / wire.off(...)
//
// WireItem  { id, title, url, source (feed id), outlet, category, publishedAt (ISO), official, aggregator, marker, seenAt }
// Cluster   { id, title, outlets[], items[], firstSeen (ISO), lastSeen (ISO), official, category, marker, reason, firedAt? }
//   reason: why it fired: 'corroborated' | 'strong' | 'marker' | 'official'
//
// Polling: conditional GET (If-None-Match / If-Modified-Since), per-host backoff x2 (60s..10min) on 429/5xx/network
// errors with Retry-After honored, response size cap, AbortSignal timeouts. Implemented here (not http.mjs) because
// http.mjs only replays ETags and has no Last-Modified support.
import { EventEmitter } from 'node:events';
import baseConfig from '../wire-config.mjs';
import { log } from '../log.mjs';
import { decodeEntities, tokenSet, jaccard, overlapCoef, sharedCount } from '../editorial/text.mjs';

const MIN = 60_000;

// ---------- parsing (pure) ----------
const BOM = /^﻿/;
function inner(xml, names) {
  for (const n of names) {
    const m = xml.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m) return m[1];
  }
  return '';
}
function atomLink(xml) {
  const links = [...xml.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  let best = null;
  for (const a of links) {
    const href = a.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const rel = a.match(/rel\s*=\s*["']([^"']+)["']/i)?.[1] || 'alternate';
    if (rel === 'alternate') return href;
    best ||= href;
  }
  return best;
}
const parseDate = (s) => {
  const t = Date.parse(String(s || '').trim());
  return Number.isFinite(t) ? t : null;
};
function canonicalUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|cmpid|ref|src|at_|mod$|ncid|taid|cid$|guccounter)/i.test(k)) x.searchParams.delete(k);
    return x.toString();
  } catch { return String(u || ''); }
}
// Bluesky posts have no <title>: use the post text without links/hashtags, first sentence-ish.
function titleFromPost(text) {
  let t = decodeEntities(text).replace(/https?:\/\/\S+/g, '').replace(/(^|\s)#\w+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{40,220}?[.!?])(\s|$)/);
  if (m) t = m[1];
  return t;
}

/** Parse RSS 2.0 / RDF (RSS 1.0) / Atom XML into raw items [{title, url, guid, ts, desc}]. Pure. */
export function parseFeedXml(xml) {
  const s = String(xml || '').replace(BOM, '');
  const isAtom = /<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(s) && !/<item[\s>]/i.test(s);
  const chunks = isAtom ? s.split(/<entry[\s>]/i).slice(1) : s.split(/<item[\s>]/i).slice(1);
  const out = [];
  for (let c of chunks) {
    c = c.split(isAtom ? /<\/entry>/i : /<\/item>/i)[0];
    const desc = decodeEntities(inner(c, ['description', 'summary', 'media:description'])).slice(0, 600);
    let title = decodeEntities(inner(c, ['title']));
    let url = isAtom ? atomLink(c) : decodeEntities(inner(c, ['link'])) || atomLink(c);
    const guid = decodeEntities(inner(c, ['guid', 'id']));
    if (!url && /^https?:/.test(guid)) url = guid;
    if (!title && desc) title = titleFromPost(inner(c, ['description']));
    const ts = parseDate(decodeEntities(inner(c, ['pubDate', 'dc:date', 'published', 'updated', 'a10:updated', 'dcterms:modified'])));
    if (title && url) out.push({ title, url: url.trim(), guid: guid || null, ts, desc });
  }
  return out;
}

/** Parse api.weather.gov alerts GeoJSON into raw items, keeping only eventRe event types. Pure. */
export function parseNws(json, eventRe) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const out = [];
  for (const f of j?.features || []) {
    const p = f?.properties || {};
    if (!p.event || (eventRe && !eventRe.test(String(p.event).trim()))) continue;
    const area = String(p.areaDesc || '').split(';').map((x) => x.trim()).filter(Boolean);
    const where = area.length > 3 ? `${area.slice(0, 3).join(', ')} and ${area.length - 3} more areas` : area.join(', ');
    out.push({
      title: `${p.event}${where ? ` for ${where}` : ''}`,
      url: p['@id'] || f.id || 'https://www.weather.gov/alerts',
      guid: p.id || f.id || null,
      ts: parseDate(p.sent || p.effective || p.onset),
      desc: decodeEntities(p.headline || ''),
      extreme: p.severity === 'Extreme',
      event: p.event,
    });
  }
  return out;
}

// Google News titles end with " - Outlet".
function splitAggregatorTitle(title) {
  const i = title.lastIndexOf(' - ');
  if (i > 15) return { title: title.slice(0, i).trim(), via: title.slice(i + 3).trim() };
  return { title, via: null };
}

export function compileFilters(cfg) {
  const f = cfg.filters || {};
  return Object.entries(f).map(([name, list]) => ({ name, list: (list || []).map((r) => (r instanceof RegExp ? r : new RegExp(String(r), 'i'))) }));
}
/** Returns the filter group name that rejects this text ('sensitive', 'sports', ...) or null. */
export function rejectReason(text, compiled, skip = null) {
  for (const g of compiled) {
    if (skip && skip.includes(g.name)) continue;   // feed.skipFilters: e.g. sports/gaming feeds skip the 'sports' group
    for (const r of g.list) if (r.test(text)) return g.name;
  }
  return null;
}

/** Raw items -> WireItem[] for one feed (dedup ids, age checks, filters). Pure except for `now`. */
export function normalizeItems(feed, raw, cfg, compiledFilters, now = Date.now(), stats = null) {
  const out = [];
  const maxAge = (cfg.maxItemAgeHours ?? 24) * 3_600_000;
  const maxFuture = (cfg.maxFutureMin ?? 10) * MIN;
  for (const r of raw) {
    let title = r.title.replace(/\s+/g, ' ').trim();
    let outlet = feed.outlet;
    if (feed.aggregator) {
      const s = splitAggregatorTitle(title);
      title = s.title;
      if (s.via) outlet = `${s.via} via ${feed.outlet}`;
    }
    if (!title || r.ts == null) { if (stats) stats.undated++; continue; }
    if (now - r.ts > maxAge || r.ts - now > maxFuture) { if (stats) stats.old++; continue; }
    const why = rejectReason(`${title} ${feed.kind === 'nws' ? '' : r.desc || ''}`, compiledFilters, feed.skipFilters);
    if (why) { if (stats) stats.filtered[why] = (stats.filtered[why] || 0) + 1; continue; }
    const marker = cfg.markers ? cfg.markers.test(title) || cfg.markers.test((r.desc || '').slice(0, 40)) : false;
    let official = false;
    if (feed.official) official = feed.kind === 'nws' ? !!r.extreme : (feed.officialPattern ? feed.officialPattern.test(title) : true);
    const url = canonicalUrl(r.url);
    out.push({
      id: `${feed.outlet}|${url || r.guid}`,
      title: title.replace(/^\s*(breaking( news)?|just in)\s*[:|-]\s*/i, ''),
      url,
      source: feed.id,
      outlet,
      category: feed.category || 'general',
      publishedAt: new Date(r.ts).toISOString(),
      official,
      aggregator: !!feed.aggregator,
      marker,
      ts: r.ts,
    });
  }
  return out;
}

// ---------- clustering ----------
// Outlet identity for corroboration: aggregator items never count; "BBC" feeds are one outlet.
const independentOutlet = (it) => (it.aggregator ? null : it.outletKey || it.outlet);

// IDF-weighted similarity between an item and a cluster's core tokens. Today's common words ("midterm",
// "Democrats", "Trump") weigh little, so two different stories that share only them do not merge.
//   wj = sum(idf shared) / sum(idf union) >= bc.jaccard with >= 2 shared tokens and >= 1 rare shared token, or
//   wo = sum(idf shared) / min(sum idf a, sum idf b) >= bc.overlap with >= overlapMinShared shared and
//        >= overlapMinRare rare tokens. Two shared rare tokens inside the window ("cvs" + "split",
//        "mike" + "johnson") are a strong same-story signal on their own; real cross-outlet headlines share little else.
function similarity(a, b, idf, rare, bc) {
  let shared = 0, nShared = 0, nRare = 0, sa = 0, sb = 0;
  for (const t of a) { const w = idf(t); sa += w; if (b.has(t)) { shared += w; nShared++; if (rare(t)) nRare++; } }
  for (const t of b) sb += idf(t);
  if (nShared < 2 || !nRare) return 0;
  const wj = shared / (sa + sb - shared);
  if (wj >= bc.jaccard) return wj;
  const wo = shared / Math.min(sa, sb);
  if (nShared >= (bc.overlapMinShared ?? 2) && nRare >= (bc.overlapMinRare ?? 2) && wo >= bc.overlap) return bc.jaccard;
  return 0;
}

function coreOf(c) {
  if (c.items.length <= 2) return new Set(c.items.flatMap((i) => [...i.tok]));
  const need = Math.ceil(c.items.length / 2);
  const counts = new Map();
  for (const it of c.items) for (const t of it.tok) counts.set(t, (counts.get(t) || 0) + 1);
  const core = new Set();
  for (const [t, n] of counts) if (n >= need) core.add(t);
  return core.size >= 2 ? core : new Set(representativeTok(c));
}
const representativeTok = (c) => c.items[0].tok;

function addToClusters(clusters, item, bc, idf, rare) {
  const win = bc.clusterWindowMin * MIN;
  let best = null, bestSim = 0;
  for (const c of clusters.values()) {
    if (item.ts < c.firstTs - win || item.ts > c.lastTs + win) continue;
    // Max over members within the window, but a cluster of 3+ must also share rare tokens with its core, which
    // keeps one loose link from chaining distinct stories into a mega-cluster.
    let s = 0;
    for (const o of c.items) if (Math.abs(o.ts - item.ts) <= win) s = Math.max(s, similarity(item.tok, o.tok, idf, rare, bc));
    if (s && c.items.length >= 3 && !similarity(item.tok, c.core, idf, rare, { ...bc, jaccard: bc.jaccard / 2, overlap: bc.overlap / 2 })) s = 0;
    if (s > bestSim) { bestSim = s; best = c; }
  }
  if (best) {
    best.items.push(item);
    best.firstTs = Math.min(best.firstTs, item.ts);
    best.lastTs = Math.max(best.lastTs, item.ts);
    best.core = coreOf(best);
    item.clusterId = best.id;
    return best;
  }
  const c = { id: `wc:${hash(item.id)}`, items: [item], firstTs: item.ts, lastTs: item.ts, firedAt: null, core: new Set(item.tok) };
  clusters.set(c.id, c);
  item.clusterId = c.id;
  return c;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// Best representative title: an independent outlet's title sharing the most tokens with the rest of the cluster.
function representative(c) {
  const pool = c.items.filter((i) => !i.aggregator).length ? c.items.filter((i) => !i.aggregator) : c.items;
  let best = pool[0], bestScore = -1;
  for (const it of pool) {
    let s = 0;
    for (const o of c.items) if (o !== it) s += jaccard(it.tok, o.tok);
    s += it.official ? 0.5 : 0;
    s -= Math.max(0, it.title.length - 110) / 200;   // prefer tighter headlines
    if (s > bestScore) { bestScore = s; best = it; }
  }
  return best;
}

/** Why a cluster should fire now, or null. */
export function fireReason(c, bc, now) {
  if (now - c.lastTs > bc.freshMin * MIN) return null;
  const items = c.items;
  if (items.some((i) => i.official && now - i.ts <= bc.freshMin * MIN)) return 'official';
  const indep = new Map(); // outlet -> earliest ts
  for (const it of items) {
    const o = independentOutlet(it);
    if (o && (!indep.has(o) || it.ts < indep.get(o))) indep.set(o, it.ts);
  }
  if (indep.size >= bc.strongOutlets) return 'strong';
  const outletsAll = new Set(items.map((i) => i.outletKey || i.outlet));
  if (bc.markerPlusOther && items.some((i) => i.marker && !i.aggregator) && outletsAll.size >= 2) return 'marker';
  // >= 2 independent outlets whose items land within corroborateMin of each other
  const byOutlet = [...items].filter((i) => independentOutlet(i)).sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < byOutlet.length; i++) {
    for (let k = i + 1; k < byOutlet.length && byOutlet[k].ts - byOutlet[i].ts <= bc.corroborateMin * MIN; k++) {
      if (independentOutlet(byOutlet[k]) !== independentOutlet(byOutlet[i])) return 'corroborated';
    }
  }
  return null;
}

function publicCluster(c, reason = null) {
  const rep = representative(c);
  const outlets = [];
  for (const it of [...c.items].sort((a, b) => a.ts - b.ts)) {
    const o = it.aggregator ? it.outlet.replace(/ via .*$/, '') : it.outlet;
    if (!outlets.includes(o)) outlets.push(o);
  }
  const cats = {};
  for (const it of c.items) if (it.category !== 'general') cats[it.category] = (cats[it.category] || 0) + 1;
  const category = Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] || rep.category;
  return {
    id: c.id,
    title: rep.title,
    url: rep.url,
    outlets,
    independentOutlets: new Set(c.items.map(independentOutlet).filter(Boolean)).size,
    items: c.items.map(({ tok, ts, clusterId, outletKey, ...rest }) => rest).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)),
    firstSeen: new Date(c.firstTs).toISOString(),
    lastSeen: new Date(c.lastTs).toISOString(),
    official: c.items.some((i) => i.official),
    marker: c.items.some((i) => i.marker),
    category,
    reason: reason || c.reason || null,
    firedAt: c.firedAt ? new Date(c.firedAt).toISOString() : null,
  };
}

// ---------- the wire ----------
export function createWire(overrides = {}) {
  const cfg = { ...baseConfig, ...overrides, breaking: { ...baseConfig.breaking, ...(overrides.breaking || {}) } };
  const bc = cfg.breaking;
  const filters = compileFilters(cfg);
  const ua = cfg.userAgent;
  const emitter = new EventEmitter();
  const feeds = new Map(cfg.feeds.map((f) => [f.id, {
    feed: f, etag: null, lastModified: null, timer: null, ok: false, lastOk: null, lastError: null,
    items: 0, newestTs: null, status: null, polls: 0, notModified: 0, stats: null,
  }]));
  const hosts = new Map();       // host -> {until, n}
  const ring = new Map();        // item id -> item (insertion order ~ arrival)
  const clusters = new Map();    // cluster id -> internal cluster
  const fired = [];              // [{at, tok}] for near-duplicate refire suppression
  const df = new Map();          // token -> number of ring items containing it (for IDF weighting)
  let running = false;
  const dfAdd = (it, d) => { for (const t of it.tok) { const n = (df.get(t) || 0) + d; if (n > 0) df.set(t, n); else df.delete(t); } };
  // Floor N so a cold ring (first poll) does not make every word look rare.
  const idf = (t) => Math.log((Math.max(ring.size, 400) + 1) / ((df.get(t) || 0) + 0.5));
  const rare = (t) => (df.get(t) || 0) <= Math.max(5, 0.03 * Math.max(ring.size, 300));

  const hostOf = (u) => { try { return new URL(u).host; } catch { return 'unknown'; } };
  const backoffLeft = (host) => Math.max(0, (hosts.get(host)?.until || 0) - Date.now());
  function penalize(host, retryAfter) {
    const h = hosts.get(host) || { until: 0, n: 0 };
    h.n += 1;
    let wait = Math.min(cfg.backoff.baseSec * 1000 * 2 ** (h.n - 1), cfg.backoff.maxSec * 1000);
    const ra = Number(retryAfter);
    if (Number.isFinite(ra) && ra > 0) wait = Math.max(wait, Math.min(ra * 1000, cfg.backoff.maxSec * 1000));
    h.until = Date.now() + wait;
    hosts.set(host, h);
    return wait;
  }

  async function fetchFeed(st) {
    const f = st.feed;
    const host = hostOf(f.url);
    const left = backoffLeft(host);
    if (left > 0) throw Object.assign(new Error(`backing off ${host} ${Math.ceil(left / 1000)}s`), { status: 429, skipped: true });
    const headers = { 'User-Agent': ua, Accept: f.kind === 'nws' ? 'application/geo+json' : 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' };
    if (st.etag) headers['If-None-Match'] = st.etag;
    if (st.lastModified) headers['If-Modified-Since'] = st.lastModified;
    let res;
    try {
      res = await fetch(f.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(cfg.timeoutMs) });
    } catch (e) {
      penalize(host);
      throw new Error(e?.name === 'TimeoutError' ? `timeout ${cfg.timeoutMs}ms` : String(e?.cause?.code || e?.message || e));
    }
    st.status = res.status;
    if (res.status === 304) { hosts.delete(host); try { await res.arrayBuffer(); } catch {} return null; }
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) penalize(host, res.headers.get('retry-after'));
      try { await res.arrayBuffer(); } catch {}
      throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    }
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > cfg.maxBodyBytes) { try { await res.body?.cancel(); } catch {} throw new Error(`too large ${len}`); }
    const text = await res.text();
    hosts.delete(host);
    st.etag = res.headers.get('etag') || st.etag;
    st.lastModified = res.headers.get('last-modified') || st.lastModified;
    return text.length > cfg.maxBodyBytes ? text.slice(0, cfg.maxBodyBytes) : text;
  }

  function ingest(newItems) {
    const now = Date.now();
    const fresh = [];
    for (const it of newItems) {
      if (ring.has(it.id)) continue;
      it.seenAt = new Date(now).toISOString();
      it.tok = tokenSet(it.title);
      it.outletKey = it.outlet;
      if (!it.tok.size) continue;
      ring.set(it.id, it);
      dfAdd(it, 1);
      fresh.push(it);
    }
    for (const it of fresh.sort((a, b) => a.ts - b.ts)) addToClusters(clusters, it, bc, idf, rare);
    prune(now);
    if (fresh.length) emitter.emit('items', fresh.map(({ tok, ts, outletKey, clusterId, ...rest }) => rest));
    return fresh.length;
  }

  function prune(now) {
    const maxAge = cfg.ring.maxAgeHours * 3_600_000;
    for (const [id, it] of ring) if (now - it.ts > maxAge) { ring.delete(id); dfAdd(it, -1); }
    if (ring.size > cfg.ring.maxItems) {
      const sorted = [...ring.values()].sort((a, b) => a.ts - b.ts);
      for (const it of sorted.slice(0, ring.size - cfg.ring.maxItems)) { ring.delete(it.id); dfAdd(it, -1); }
    }
    for (const [id, c] of clusters) {
      c.items = c.items.filter((i) => ring.has(i.id));
      if (!c.items.length) { clusters.delete(id); continue; }
      c.firstTs = Math.min(...c.items.map((i) => i.ts));
      c.lastTs = Math.max(...c.items.map((i) => i.ts));
      c.core = coreOf(c);
    }
    const refire = bc.refireHours * 3_600_000;
    while (fired.length && now - fired[0].at > refire) fired.shift();
  }

  async function pollFeed(id) {
    const st = feeds.get(id);
    if (!st) return;
    st.polls++;
    try {
      const body = await fetchFeed(st);
      if (body == null) { st.notModified++; st.ok = true; st.lastOk = new Date().toISOString(); st.lastError = null; return; }
      const raw = st.feed.kind === 'nws' ? parseNws(body, cfg.nwsEvents) : parseFeedXml(body);
      const stats = { raw: raw.length, undated: 0, old: 0, filtered: {} };
      const items = normalizeItems(st.feed, raw, cfg, filters, Date.now(), stats);
      st.stats = stats;
      st.items = items.length;
      st.newestTs = raw.reduce((m, r) => (r.ts && r.ts <= Date.now() + 600_000 && r.ts > (m || 0) ? r.ts : m), null);
      if (!raw.length && st.feed.kind !== 'nws') throw new Error('no items parsed');
      st.ok = true; st.lastOk = new Date().toISOString(); st.lastError = null;
      const n = ingest(items);
      log('debug', 'wire poll', { feed: id, status: st.status, raw: raw.length, kept: items.length, fresh: n });
    } catch (e) {
      st.ok = false;
      st.lastError = String(e?.message || e);
      if (!e?.skipped) log('warn', 'wire feed error', { feed: id, url: st.feed.url, error: st.lastError, backoffSec: Math.round(backoffLeft(hostOf(st.feed.url)) / 1000) });
    }
  }

  function detect({ now = Date.now() } = {}) {
    const out = [];
    for (const c of clusters.values()) {
      if (c.firedAt) continue;
      const reason = fireReason(c, bc, now);
      if (!reason) continue;
      const tok = new Set(c.items.flatMap((i) => [...i.tok]));
      const repTok = representative(c).tok;
      if (fired.some((f) => jaccard(f.tok, repTok) >= bc.jaccard || overlapCoef(f.tok, tok) >= 0.8 && sharedCount(f.tok, tok) >= 4)) {
        c.firedAt = now; c.reason = `${reason}:suppressed`;
        continue;
      }
      c.firedAt = now;
      c.reason = reason;
      fired.push({ at: now, tok: repTok });
      const pub = publicCluster(c, reason);
      out.push(pub);
    }
    for (const pub of out) {
      log('info', 'wire breaking', { id: pub.id, title: pub.title, outlets: pub.outlets, reason: pub.reason });
      emitter.emit('breaking', pub);
    }
    return out;
  }

  function schedule(id, firstDelayMs) {
    const st = feeds.get(id);
    const every = st.feed.everySec * 1000;
    const next = (ms) => {
      if (!running) return;
      st.timer = setTimeout(async () => {
        await pollFeed(id);
        detect();
        const j = 1 + (Math.random() * 2 - 1) * cfg.jitter;
        const wait = Math.max(every * j, backoffLeft(hostOf(st.feed.url)));
        next(wait);
      }, ms);
      st.timer.unref?.();
    };
    next(firstDelayMs);
  }

  return {
    config: cfg,
    start() {
      if (running) return;
      running = true;
      // Staggered start: fast feeds (<=90s) begin within ~20s so the ring warms quickly, the rest across their interval.
      for (const [id, st] of feeds) {
        const every = st.feed.everySec * 1000;
        const delay = every <= 90_000 ? Math.random() * 20_000 : Math.random() * Math.min(every, 120_000);
        schedule(id, delay);
      }
      log('info', 'wire start', { feeds: feeds.size });
    },
    stop() {
      running = false;
      for (const st of feeds.values()) if (st.timer) clearTimeout(st.timer);
    },
    async pollAll({ concurrency = 6 } = {}) {
      const ids = [...feeds.keys()];
      let i = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => { while (i < ids.length) await pollFeed(ids[i++]); }));
      return this.status();
    },
    detect,
    items({ limit = 50, since = 0, category = null } = {}) {
      const sinceMs = typeof since === 'string' ? Date.parse(since) : since;
      return [...ring.values()]
        .filter((i) => i.ts >= (sinceMs || 0) && (!category || i.category === category))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit)
        .map(({ tok, ts, outletKey, clusterId, ...rest }) => rest);
    },
    clusters({ limit = 50, minOutlets = 1, now = Date.now() } = {}) {
      return [...clusters.values()]
        .map((c) => ({ c, n: new Set(c.items.map((i) => i.outletKey)).size }))
        .filter((x) => x.n >= minOutlets)
        .sort((a, b) => b.n - a.n || b.c.lastTs - a.c.lastTs)
        .slice(0, limit)
        .map(({ c }) => publicCluster(c, c.reason));
    },
    status() {
      const now = Date.now();
      return [...feeds.values()].map((st) => ({
        id: st.feed.id, outlet: st.feed.outlet, ok: st.ok, lastOk: st.lastOk, lastError: st.lastError, items: st.items,
        newestAgeMin: st.newestTs ? Math.round((now - st.newestTs) / MIN) : null, status: st.status,
        backoffSec: Math.ceil(backoffLeft(hostOf(st.feed.url)) / 1000), conditional: !!(st.etag || st.lastModified),
        notModified: st.notModified, stats: st.stats,
      }));
    },
    on: (ev, fn) => { emitter.on(ev, fn); return () => emitter.off(ev, fn); },
    off: (ev, fn) => emitter.off(ev, fn),
  };
}

export default { createWire, parseFeedXml, parseNws, normalizeItems, fireReason };
