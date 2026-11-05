#!/usr/bin/env node
// Rank perf hotspots from the client 'perf' lines (public/js/perf.js, item 11) in logs/pnn.log.
// Usage: node scripts/perf-report.mjs [--file logs/pnn.log] [--since 90m|2h|2026-11-05T12:00] [--device iPad|Mac]
//        [--browser Safari] [--headless] (include headless/webdriver runs; excluded by default) [--min 120] (min frames per row) [--top 25]
// Per device+browser: overall fps/p95/long-frame rates, then scenes / transitions / widgets / segments / events ranked
// by long-frame (>33 ms) rate and p95, frame-section and post-pass CPU averages, hitch causes and the worst hitches.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const file = path.resolve(ROOT, opt('file', path.join(process.env.LOG_DIR || 'logs', 'pnn.log')));
const sinceArg = opt('since', null), devArg = opt('device', null), brArg = opt('browser', null);
const withHeadless = !!opt('headless', false), MIN = +opt('min', 120), TOP = +opt('top', 25);
let since = 0;
if (typeof sinceArg === 'string') {
  const m = sinceArg.match(/^(\d+(?:\.\d+)?)([mhd])$/);
  since = m ? Date.now() - m[1] * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]] : Date.parse(sinceArg) || 0;
}

if (!fs.existsSync(file)) { console.error('no log file: ' + file); process.exit(1); }
const groups = new Map();
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.includes('"perf"')) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.kind !== 'perf' || !e.frames) continue;
  if (since && Date.parse(e.ts) < since) continue;
  if (!withHeadless && (e.headless || /Headless/.test(e.ua || ''))) continue;
  if (devArg && e.device !== devArg) continue;
  if (brArg && e.browser !== brArg) continue;
  const g = `${e.device || '?'} ${e.browser || '?'} ${e.screen || ''}@${e.dpr || '?'}x`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(e);
}
if (!groups.size) { console.log(`no perf lines in ${file}${since ? ' since ' + new Date(since).toISOString() : ''}${withHeadless ? '' : ' (headless excluded; --headless to include)'}`); process.exit(0); }

const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
const pc = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
function table(head, rows) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  console.log('  ' + head.map((h, i) => (i ? lpad(h, w[i]) : pad(h, w[i]))).join('  '));
  for (const r of rows) console.log('  ' + r.map((c, i) => (i ? lpad(c, w[i]) : pad(c, w[i]))).join('  '));
}

for (const [g, ws] of groups) {
  ws.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const F = ws.reduce((a, w) => a + w.frames, 0), S = ws.reduce((a, w) => a + (w.secs || 30), 0);
  const L33 = ws.reduce((a, w) => a + w.long33, 0), L50 = ws.reduce((a, w) => a + w.long50, 0);
  const wavg = (k) => (ws.reduce((a, w) => a + (w[k] || 0) * w.frames, 0) / F).toFixed(1);
  const stalls = ws.reduce((a, w) => a + (w.stalls || 0), 0);
  const q = [...new Set(ws.map((w) => (w.quality ? `q${w.quality.envQ}/pr${w.quality.pr}` : '?')))].join(' ');
  console.log(`\n=== ${g}  (${ws.length} windows, ${(S / 60).toFixed(1)} min, ${ws[0].ts.slice(0, 16)} .. ${ws[ws.length - 1].ts.slice(11, 16)})`);
  console.log(`  fps ${(F / S).toFixed(1)}  p50 ${wavg('p50')}ms  p95 ${wavg('p95')}ms  p99 ${wavg('p99')}ms  long>33 ${L33} (${pc(L33, F)})  >50 ${L50} (${pc(L50, F)})  worst ${Math.max(...ws.map((w) => w.worst))}ms  unattributed stalls ${stalls}  quality ${q}`);
  // ---- attribution rows
  const by = new Map();
  for (const w of ws) for (const [k, s] of Object.entries(w.by || {})) {
    const r = by.get(k) || { n: 0, l33: 0, l50: 0, worst: 0, p95w: 0, avgw: 0 };
    r.n += s.n; r.l33 += s.l33; r.l50 += s.l50; r.worst = Math.max(r.worst, s.worst); r.p95w += s.p95 * s.n; r.avgw += s.avg * s.n;
    by.set(k, r);
  }
  for (const [title, pre] of [['SCENES', 'scene:'], ['TRANSITIONS', 'trans:'], ['WIDGETS (type and type:phase)', 'widget:'], ['RUNDOWN SEGMENTS', 'seg:'], ['FRAMES CONTAINING EVENT', 'ev:']]) {
    const rows = [...by.entries()].filter(([k, r]) => k.startsWith(pre) && (r.n >= (pre === 'ev:' || pre === 'trans:' ? 1 : MIN)))
      .sort((a, b) => b[1].l33 / b[1].n - a[1].l33 / a[1].n || b[1].p95w / b[1].n - a[1].p95w / a[1].n).slice(0, TOP)
      .map(([k, r]) => [k.slice(pre.length), r.n, pc(r.l33, r.n), pc(r.l50, r.n), (r.avgw / r.n).toFixed(1), (r.p95w / r.n).toFixed(1), r.worst]);
    if (!rows.length) continue;
    console.log(`\n  ${title} by long-frame rate`);
    table(['key', 'frames', '>33ms', '>50ms', 'avg', 'p95~', 'worst'], rows);
  }
  // ---- named events (timed): count, total / avg / max ms, how often they landed in a long frame
  const ev = new Map();
  for (const w of ws) for (const e of w.events || []) {
    const r = ev.get(e.n) || { n: 0, ms: 0, max: 0, inLong: 0, ex: '' };
    r.n++; r.ms += e.ms || 0; if ((e.ms || 0) >= r.max) { r.max = e.ms || 0; r.ex = e.d || ''; } if (e.f) r.inLong++;
    ev.set(e.n, r);
  }
  if (ev.size) {
    console.log('\n  NAMED EVENTS (logged when >= 2 ms or structural; capped 60 per window)');
    table(['event', 'count', 'in long frame', 'avg ms', 'max ms', 'max example'],
      [...ev.entries()].sort((a, b) => b[1].inLong - a[1].inLong || b[1].ms - a[1].ms).slice(0, TOP).map(([k, r]) => [k, r.n, r.inLong, (r.ms / r.n).toFixed(1), Math.round(r.max), r.ex]));
  }
  // ---- hitch causes from the per-window top hitches
  const cause = new Map();
  let hn = 0;
  for (const w of ws) for (const h of w.hitches || []) {
    hn++;
    const names = new Set((h.ev || []).map((x) => x.split(/[:(]/)[0]));
    if (h.stall) names.add('(stall: no measured JS: GPU/GC/layout)');
    if (h.trans) names.add('(during transition)');
    if (h.phase) names.add('(widget ' + h.phase + ')');
    const topSec = Object.entries(h.sec || {}).sort((a, b) => b[1] - a[1])[0];
    if (topSec && topSec[1] > 8) names.add('(section ' + topSec[0] + ' > 8ms)');
    const topPass = Object.entries(h.pass || {}).sort((a, b) => b[1] - a[1])[0];
    if (topPass && topPass[1] > 8) names.add('(pass ' + topPass[0] + ' > 8ms)');
    for (const n of names) { const r = cause.get(n) || { n: 0, ms: 0 }; r.n++; r.ms += h.ms; cause.set(n, r); }
  }
  if (hn) {
    console.log(`\n  HITCH CAUSES (${hn} top hitches; a hitch can have several)`);
    table(['cause', 'hitches', 'share', 'avg hitch ms'], [...cause.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, TOP).map(([k, r]) => [k, r.n, pc(r.n, hn), Math.round(r.ms / r.n)]));
    console.log('\n  WORST HITCHES');
    const all = ws.flatMap((w) => (w.hitches || []).map((h) => ({ ...h, at: w.start })));
    for (const h of all.sort((a, b) => b.ms - a.ms).slice(0, 10)) {
      const ts = new Date(Date.parse(h.at) + h.t * 1000).toISOString().slice(11, 19);
      console.log(`  ${ts} ${lpad(h.ms, 4)}ms cpu ${h.cpu} js ${h.js} scene=${h.scene} ${h.trans ? 'trans=' + h.trans + ' ' : ''}widget=${h.widget}:${h.phase} seg=${h.seg}${h.stall ? ' STALL' : ''}`);
      const parts = [Object.entries(h.sec || {}).map(([k, v]) => k + ' ' + v).join(', '), Object.entries(h.pass || {}).map(([k, v]) => 'pass.' + k + ' ' + v).join(', '), (h.ev || []).join(' ')].filter(Boolean);
      if (parts.length) console.log('        ' + parts.join(' | '));
    }
  }
  // ---- frame budget: CPU sections + post passes (ms/frame)
  const secs = {}, passes = {};
  for (const w of ws) { for (const [k, v] of Object.entries(w.sec || {})) { secs[k] = secs[k] || { a: 0, m: 0 }; secs[k].a += v.avg * w.frames; secs[k].m = Math.max(secs[k].m, v.max); } for (const [k, v] of Object.entries(w.pass || {})) passes[k] = (passes[k] || 0) + v * w.frames; }
  const cpu = ws.reduce((a, w) => a + (w.cpu?.avg || 0) * w.frames, 0) / F;
  console.log(`\n  CPU per frame: scene frame avg ${cpu.toFixed(2)}ms (max ${Math.max(...ws.map((w) => w.cpu?.max || 0))})`);
  console.log('    sections: ' + Object.entries(secs).sort((a, b) => b[1].a - a[1].a).map(([k, v]) => `${k} ${(v.a / F).toFixed(2)} (max ${v.m})`).join(', '));
  console.log('    post passes: ' + Object.entries(passes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / F).toFixed(2)}`).join(', '));
  const gl = ws.reduce((a, w) => { for (const [k, v] of Object.entries(w.gl || {})) if (k !== 'programs') a[k] = (a[k] || 0) + (v || 0); return a; }, {});
  console.log(`    gl: ${Object.entries(gl).map(([k, v]) => k + ' ' + v).join(', ')}, programs now ${ws[ws.length - 1].gl?.programs}; label redraws ${ws.reduce((a, w) => a + (w.labels || 0), 0)} (${ws.reduce((a, w) => a + (w.label2dMs || 0), 0)}ms canvas text)`);
  const loaf = ws.flatMap((w) => w.loaf || []);
  if (loaf.length) { console.log('\n  LONG ANIMATION FRAMES (Chromium only)'); for (const l of loaf.sort((a, b) => b.ms - a.ms).slice(0, 8)) console.log(`  ${l.ms}ms block ${l.block} style ${l.style}  ${l.scripts.join('  ')}`); }
}
