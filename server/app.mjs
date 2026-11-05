// HTTP handler: static public/, /api/state, /api/events (SSE), /api/health, POST /api/client-log.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};
const NO_CACHE = new Set(['.html', '.js', '.mjs', '.css', '.json']);

function json(res, status, body, pretty = false) {
  const s = JSON.stringify(body, null, pretty ? 2 : 0);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end('bad path'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': NO_CACHE.has(ext) && !file.includes(`${path.sep}vendor${path.sep}`) ? 'no-cache' : 'max-age=3600',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}

export function health(store, config) {
  const now = Date.now();
  const P = config.poll;
  const intervals = { polymarket: P.polymarketSec, kalshi: P.kalshiSec, news: P.newsSec, wire: 300 };
  if (store.getState().sim) intervals.polymarket = P.simTickSec;
  const feeds = {};
  for (const [name, f] of Object.entries(store.feeds)) {
    const ageSec = f.lastOk ? Math.round((now - Date.parse(f.lastOk)) / 1000) : null;
    const limit = (intervals[name] || 300) * (config.staleFactor || 3);
    const stale = ageSec == null || ageSec > limit;
    feeds[name] = { ok: !!f.ok && !stale, stale, ageSec, staleAfterSec: limit, lastOk: f.lastOk, lastError: f.lastError, count: f.count };
    if (name === 'wire') {
      // the news wire: count = feeds ok; plus ring size and what the matcher made of breaking clusters
      const { feedsOk, feedsTotal, lastPoll, items, clustersFired, clustersMatched, flashesMade, lastFlashAt,
        retryQueued, retryPending, retried, retryDropped, dupesSkipped, sotdId, sotdStories, sotdPasses, marks } = f;
      Object.assign(feeds[name], { feedsOk, feedsTotal, lastPoll, items, clustersFired, clustersMatched, flashesMade, lastFlashAt,
        retryQueued, retryPending, retried, retryDropped, dupesSkipped, sotdId, sotdStories, sotdPasses, marks });
    }
  }
  const s = store.getState();
  return {
    ok: feeds.polymarket.ok || feeds.kalshi.ok,
    sim: !!s.sim,
    uptimeSec: Math.round(process.uptime()),
    generatedAt: s.generatedAt,
    clients: store.clientCount?.() ?? null,
    stories: s.stories.length,
    movers: s.movers.length,
    closing: s.closing.length,
    alerts: s.alerts.length,
    flashes: s.flashes?.length ?? 0,
    wireItems: s.wire?.length ?? 0,
    // watchability: corner pops (store counters + detector state), Story of the Day, Next Big Decision
    moments: (() => { try { return { ...(store.momentStats?.() || {}), ...(store.momentsHealth?.() || {}) }; } catch { return null; } })(),
    build: (() => { try { return store.buildHealth?.() || null; } catch { return null; } })(),
    newsCoverage: (() => { try { return store.newsCoverage?.() || null; } catch { return null; } })(),
    moves: s.moves?.length ?? 0,
    listed: s.listed?.length ?? 0,
    money: s.money?.length ?? 0,
    sotd: s.sotd ? { id: s.sotd.id, title: s.sotd.title, stories: s.sotd.count ?? s.sotd.markets?.length ?? 0, credit: s.sotd.credit } : null,
    countdown: (s.countdown || []).map((c) => `${c.title} ${c.at} ${Math.round((c.yesPrice || 0) * 100)}% ${c.label}`),
    finance: (() => { try { const f = s.finance; return { moves: (f?.moves || []).map((m) => `${m.symbol} ${m.copy?.headline || ''}`.trim()), quotes: f?.quotes?.length ?? 0, session: f?.session ?? null, asOf: f?.asOf ?? null, note: f?.note ?? null, stats: store.financeHealth?.() ?? null }; } catch { return null; } })(),
    sampledMarkets: store.sampleCount?.() ?? null,
    memory: (() => { const u = process.memoryUsage(); return { rssMB: Math.round(u.rss / 1e6), heapUsedMB: Math.round(u.heapUsed / 1e6) }; })(),
    feeds,
  };
}

export function createHandler(store, config) {
  return function handler(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
    const p = url.pathname;

    if (p === '/api/events') return store.subscribe(res, req);
    if (p === '/api/state') {
      // ?client=1: the slim v2 payload the browser reads (same as the SSE 'state'); default is the full state (scripts, tools)
      if (url.searchParams.has('client')) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(store.getClientJson()); }
      return json(res, 200, store.getState());
    }
    if (p === '/api/health') return json(res, 200, health(store, config), true);
    if (p === '/api/client-log') {
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      let body = '';
      let over = false;
      req.on('data', (c) => { if (body.length + c.length > 32_000) over = true; else body += c; });
      req.on('end', () => {
        let entry;
        try { entry = JSON.parse(body || '{}'); } catch { entry = { raw: body.slice(0, 2000) }; }
        const list = Array.isArray(entry) ? entry : [entry];
        for (const e of list.slice(0, 20)) {
          const level = ['debug', 'info', 'warn', 'error'].includes(e?.level) ? e.level : 'warn';
          const { level: _l, msg, ...rest } = e && typeof e === 'object' ? e : { value: e };
          log(level, 'client', { client: String(msg ?? rest.kind ?? 'log').slice(0, 300), ...rest, truncated: over || undefined, ua: String(req.headers['user-agent'] || '').slice(0, 120) });
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, p);
  };
}
