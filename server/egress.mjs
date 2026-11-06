// Outbound-bytes budget and compression for public hosting (hosts bill egress; none of them offer a hard cap).
// EGRESS_GB_PER_DAY (0/unset = off): once today's (UTC) bytes pass the budget, live streams close, new streams get 503
// and pages get a small "at capacity" notice until midnight UTC. Bytes are counted after compression.
import zlib from 'node:zlib';
import { log } from './log.mjs';

const BUDGET = Number(process.env.EGRESS_GB_PER_DAY || 0) * 1e9;
let day = '', bytes = 0, overSince = null;
const onOver = new Set();
const today = () => new Date().toISOString().slice(0, 10);

export function count(n) {
  const d = today();
  if (d !== day) { if (day) log('info', 'egress day', { day, gb: +(bytes / 1e9).toFixed(3) }); day = d; bytes = 0; overSince = null; }
  bytes += n;
  if (BUDGET && !overSince && bytes >= BUDGET) {
    overSince = new Date().toISOString();
    log('warn', 'egress budget reached: closing streams until midnight UTC', { gb: +(bytes / 1e9).toFixed(3), budgetGB: BUDGET / 1e9 });
    for (const f of onOver) { try { f(); } catch { /* ignore */ } }
  }
}
export const over = () => { count(0); return !!overSince; };
export const whenOver = (f) => onOver.add(f);
export const stats = () => { count(0); return { day, gb: +(bytes / 1e9).toFixed(3), budgetGB: BUDGET ? BUDGET / 1e9 : null, over: !!overSince, overSince }; };

const accepts = (req) => /\bgzip\b/.test(String(req?.headers?.['accept-encoding'] || ''));

/** An SSE sink: gzip when the client accepts it (about 5x smaller), counting compressed bytes. write(str) sends and flushes. */
export function sseSink(req, res, headers) {
  if (!accepts(req)) {
    res.writeHead(200, headers);
    return { write: (s) => { count(Buffer.byteLength(s)); return res.write(s); }, end: () => res.end() };
  }
  res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
  const gz = zlib.createGzip({ level: 6 });
  gz.on('data', (c) => { count(c.length); res.write(c); });
  gz.on('error', () => res.destroy());
  res.on('close', () => gz.destroy());
  return { write: (s) => { gz.write(s); gz.flush(zlib.constants.Z_SYNC_FLUSH); return true; }, end: () => { gz.end(); res.end(); } };
}

// Static text files gzipped once and cached by path + mtime.
const cache = new Map();
const TEXT = /\.(html|js|mjs|css|json|svg|txt|map)$/i;
export function staticBody(req, file, st, raw) {
  if (!TEXT.test(file) || !accepts(req)) return null;
  const key = `${file}:${st.mtimeMs}`;
  let b = cache.get(key);
  if (!b) { b = zlib.gzipSync(raw(), { level: 9 }); cache.set(key, b); }
  return b;
}

/** A one-off JSON body, gzipped when accepted. */
export function jsonBody(req, str) {
  if (!accepts(req)) return { buf: Buffer.from(str), headers: {} };
  return { buf: zlib.gzipSync(str, { level: 6 }), headers: { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } };
}

export const CAPACITY_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PNN</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0618;color:#f3e9ff;font:18px/1.5 system-ui,sans-serif;text-align:center">
<div><h1 style="color:#ff2bd6;letter-spacing:.1em">PNN</h1><p>The Pre News Network is at capacity for today.<br>Back after midnight UTC.</p>
<p><a style="color:#3dd6ff" href="https://github.com/pj4533/pnn">Run your own copy</a></p></div>`;
