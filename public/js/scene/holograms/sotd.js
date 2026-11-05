// SOTD (Story of the Day): a ranked BAR RACE, one row per related market, biggest mover on top.
// Every row: name | 0-100% track with a bar (cyan = yesterday's chance, green/red = what it gained/lost since) and a white tick at yesterday's
// value | today's % (counts up) | a '▲ 30 PTS' chip with 'WAS 61%'. One shared scale, so rows compare directly. Rows slide in 0.1s apart,
// each bar grows to yesterday, pauses, then runs to today; the biggest mover gets a frame, a BIGGEST MOVE tag, a ring, and the camera pulls in.
// Input: story.markets = state.sotd.markets [{ label, yesPrice, change1d, source }], story.eventTitle. Missing fields never throw.
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, ease, boxAt } from '../holo.js';
import { lineSeg } from './parts.js';

const MAX = 8;
const P = 2.0;                       // row pitch
const BAR_H = 0.8;
const TX0 = -4.2, TW = 9.0;          // track left edge and width (world units): 0..100%
const NAME_X = TX0 - 0.45;           // names are right-aligned to here
const PCT_X = 8.8;                   // today's % is right-aligned to here
const CHIP_X = 9.1;                 // delta chip starts here
const X_L = -12.0, X_R = 12.6;
const Y_BOT = 3.4;                   // centre of the bottom row

// name -> [line1, line2?]: split long names across two lines instead of shrinking or cutting them
function nameLines(raw) {
  const name = String(raw || 'MARKET').toUpperCase().trim() || 'MARKET';
  if (name.length <= 14) return [name, null];
  const words = name.split(/\s+/);
  if (words.length < 2) return [name, null];
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length, b = words.slice(i).join(' ').length;
    if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

export function createSotd(ctx, story) {
  const { pal, fx } = ctx;
  const all = (story?.markets || []).filter((m) => m && Number.isFinite(m.yesPrice));
  const mk = all.slice().sort((a, b) => Math.abs(b.change1d || 0) - Math.abs(a.change1d || 0)).slice(0, MAX);
  const n = mk.length;
  const rowY = (r) => Y_BOT + (n - 1 - r) * P;
  const topEdge = rowY(0) + P / 2;
  const axisY = topEdge + 1.0, titleY = axisY + 2.0, topY = titleY + 1.3;
  const holo = new Holo(ctx, { height: topY });
  holo.revealDur = 1.2;
  const root = holo.root;
  const midY = topY / 2;
  const yFr = (y) => clamp01(y / topY);

  // generic label helper: placed in root, hidden until its row/part drives .bright
  const lab = (text, opts, x, y, z = 0.5) => {
    const l = holo.label(text, opts); l.sprite.position.set(x, y, z); l.yFrac = yFr(y) * 0.8; l.bright = 0;
    l.bx = x; l.sx = l.sprite.scale.x; l.sy = l.sprite.scale.y; return l;
  };
  const flatBox = (color, w, h, { glow = 1.2, alpha = 0.9, left = true, depth = 0.3, additive = false } = {}) => {
    const geo = new THREE.BoxGeometry(w, h, depth); if (left) geo.translate(w / 2, 0, 0);
    return new THREE.Mesh(geo, holo.mat(color, { flat: 1, glow, alpha, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  };

  // ---- shared scale: gridlines at 0/25/50/75/100% labelled once at the top ----
  {
    const arr = [];
    for (const q of [0, 0.25, 0.5, 0.75, 1]) { const x = TX0 + q * TW; arr.push(x, Y_BOT - P / 2, 0.1, x, topEdge + 0.35, 0.1); }
    root.add(lineSeg(new Float32Array(arr), holo.line(COL.white, { alpha: 0.2 })));
    for (const q of [0, 0.25, 0.5, 0.75, 1]) {
      const l = lab(`${Math.round(q * 100)}%`, { w: 256, h: 128, height: 1.05, font: '700 84px Orbitron', color: '#dfe8ff', glow: pal.hexB }, TX0 + q * TW, axisY, 0.4);
      l.bright = 0.85; l.axis = true;
    }
  }

  // ---- header + footer ----
  const title = String(story?.eventTitle || story?.title || 'STORY OF THE DAY').toUpperCase();
  const head = lab(title, { w: 1400, h: 256, height: 2.5, font: '900 112px Orbitron', color: '#ffffff', glow: pal.hexA, sub: 'CHANCE TODAY VS YESTERDAY', subColor: pal.hexB, subFont: '700 70px Orbitron', mainY: 0.34, subY: 0.8 }, 0.1, titleY, 0.5);
  head.bright = 1;
  const mix = {};
  for (const m of mk) { const s = String(m.source || '').toUpperCase(); if (s) mix[s] = (mix[s] || 0) + 1; }
  const mixTxt = Object.entries(mix).map(([k, v]) => `${k} ${v}`).join('  ·  ');
  const foot = lab(`SOURCE  ${mixTxt || 'PREDICTION MARKETS'}`, { w: 900, h: 128, height: 1.35, font: '700 70px Rajdhani', color: '#dfe8ff', glow: pal.hexB, align: 'left' }, X_L, 1.25, 0.5);
  foot.bright = 0.9; foot.sprite.position.x = X_L;
  const legend = [[0, 'YESTERDAY', COL.white, 0.14], [5.0, 'GAINED', COL.up, 0.5], [8.7, 'LOST', COL.down, 0.5]];
  for (const [dx, txt, color, w] of legend) {
    const sw = flatBox(color, w, 0.55, { glow: 0.75, alpha: 1, depth: 0.2 }); sw.position.set(0.3 + dx, 1.25, 0.2); root.add(sw);
    const l = lab(txt, { w: 420, h: 128, height: 1.15, font: '700 70px Rajdhani', color: '#dfe8ff', glow: pal.hexB, align: 'left' }, 1.0 + dx, 1.25, 0.5);
    l.bright = 0.9;
  }
  const base = new THREE.Mesh(new THREE.PlaneGeometry(X_R - X_L + 1, 0.08), holo.mat(pal.a, { flat: 1, alpha: 0.9, glow: 1.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  base.position.set((X_L + X_R) / 2, 0.2, 0.2); root.add(base);

  // ---- rows ----
  const rows = [];
  mk.forEach((m, i) => {
    const y = rowY(i), lead = i === 0;
    const value = clamp01(m.yesPrice), d = Number.isFinite(m.change1d) ? m.change1d : 0, prev = clamp01(value - d);
    const col = d >= 0 ? COL.up : COL.down, colHex = d > 0 ? '#3dff8a' : d < 0 ? '#ff2e55' : '#cfd8ff';
    const g = new THREE.Group(); g.position.set(0, y, 0); root.add(g);
    const track = flatBox(pal.b, TW, BAR_H, { glow: 1.0, alpha: 0.16, depth: 0.1, additive: true }); track.position.x = TX0; g.add(track);
    const bar = flatBox(pal.a, 1, lead ? BAR_H * 1.12 : BAR_H, { glow: lead ? 0.95 : 0.7, alpha: lead ? 1 : 0.88 }); bar.position.set(TX0, 0, 0.1); bar.scale.x = 1e-4; g.add(bar);
    const dbar = flatBox(col, 1, lead ? BAR_H * 1.12 : BAR_H, { glow: lead ? 0.9 : 0.72, alpha: 1 }); dbar.position.set(TX0, 0, 0.12); dbar.scale.x = 1e-4; g.add(dbar);
    const tick = flatBox(COL.white, 0.14, 1.5, { glow: 0.7, alpha: 1, left: false, depth: 0.2 }); tick.position.set(TX0 + prev * TW, 0, 0.25); tick.scale.set(1, 1e-4, 1); g.add(tick);

    const [l1, l2] = nameLines(m.label || m.outcome || m.title);
    const nm = lab(l1, { w: 760, h: 192, height: 1.95, font: `900 ${l2 ? 66 : 74}px Orbitron`, color: lead ? '#ffffff' : '#dfe8ff', glow: lead ? pal.hexA : pal.hexB, align: 'right',
      sub: l2, subColor: lead ? '#ffffff' : '#dfe8ff', subFont: '900 66px Orbitron', mainY: l2 ? 0.3 : 0.5, subY: 0.72 }, NAME_X, y, 0.5);
    const pct = lab(`${Math.round(prev * 0)}%`, { w: 380, h: 128, height: 1.7, font: '900 104px Orbitron', color: '#ffffff', glow: lead ? pal.hexA : pal.hexB, align: 'right' }, PCT_X, y, 0.5);
    const pts = Math.round(Math.abs(d) * 100);
    const chip = lab(pts ? `${d > 0 ? '▲' : '▼'} ${pts} PTS` : 'FLAT', { w: 400, h: 192, height: 2.0, font: '800 84px Rajdhani', color: colHex, glow: colHex, align: 'left',
      sub: `WAS ${Math.round(prev * 100)}%`, subColor: '#dfe8ff', subFont: '700 76px Rajdhani', mainY: 0.32, subY: 0.78 }, CHIP_X, y, 0.5);
    rows.push({ g, bar, dbar, tick, nm, pct, chip, value, prev, delay: 0.45 + i * 0.1, lead, y, shown: -1, done: false });
  });

  // ---- spotlight on the biggest mover: frame, glow, tag ----
  let frame = null, glowPlane = null, tag = null;
  if (n > 0) {
    const y = rowY(0), x0 = X_L - 0.4, x1 = X_R + 0.3, y0 = y - P / 2 + 0.05, y1 = y + P / 2 - 0.05;
    frame = lineSeg(new Float32Array([x0, y0, 0.3, x1, y0, 0.3, x1, y0, 0.3, x1, y1, 0.3, x1, y1, 0.3, x0, y1, 0.3, x0, y1, 0.3, x0, y0, 0.3]), holo.line(pal.a, { alpha: 0, glow: 2.0 }));
    root.add(frame);
    glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), holo.mat(pal.a, { flat: 1, alpha: 0, glow: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    glowPlane.position.set((x0 + x1) / 2, y, -0.1); root.add(glowPlane);
    tag = lab('▶ BIGGEST MOVE', { w: 700, h: 128, height: 1.1, font: '900 70px Orbitron', color: '#ffffff', glow: pal.hexA, align: 'left' }, X_L + 0.2, axisY, 0.5);
  }

  let pulsed = false, streamAcc = 0;
  const wp = new THREE.Vector3();
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    for (const r of rows) {
      const s0 = ts - r.delay;
      const kIn = clamp01(s0 / 0.45), off = -3.2 * (1 - ease.out(kIn));
      const kA = ease.out(clamp01((s0 - 0.15) / 0.6));             // 0 -> yesterday
      const kB = ease.inOut(clamp01((s0 - 1.05) / 0.9));            // yesterday -> today
      const inB = s0 >= 1.05;
      const cur = inB ? r.prev + (r.value - r.prev) * kB : r.prev * kA;
      const mainLen = inB ? Math.min(cur, r.prev) : cur;
      r.g.position.x = off;
      r.bar.scale.x = Math.max(1e-4, mainLen * TW);
      r.dbar.position.x = TX0 + Math.min(cur, r.prev) * TW;
      r.dbar.scale.x = inB ? Math.max(1e-4, Math.abs(cur - r.prev) * TW) : 1e-4;
      r.tick.scale.y = Math.max(1e-4, ease.out(clamp01((s0 - 0.2) / 0.5)));
      const shown = Math.round(cur * 100);
      if (shown !== r.shown) { r.shown = shown; r.pct.set(`${shown}%`); }
      const kC = clamp01((s0 - 1.95) / 0.35);
      r.nm.bright = kIn; r.nm.sprite.position.x = r.nm.bx + off;
      r.pct.bright = kIn; r.pct.sprite.position.x = r.pct.bx + off * 0.5;
      const pop = kC > 0 ? ease.back(kC) : 0;
      r.chip.bright = kC; r.chip.sprite.position.x = r.chip.bx + off * 0.5;
      r.chip.sprite.scale.set(r.chip.sx * Math.max(0.01, pop), r.chip.sy * Math.max(0.01, pop), 1);
      if (r.lead && s0 > 1.05 && s0 < 2.0 && this.visible) {   // sparks trail the leader's bar head
        streamAcc += dt;
        if (streamAcc > 0.06) { streamAcc = 0; wp.set(TX0 + cur * TW, r.y, 0.3); fx.stream(root.localToWorld(wp), r.value >= r.prev ? COL.up : COL.down, 3, new THREE.Vector3(0, 1, 0), { speed: 2, lifeS: 1, sz: 0.6 }); }
      }
    }
    if (rows[0]) {
      const kH = clamp01((ts - (rows[0].delay + 1.95)) / 0.4);
      const pulse = 0.65 + 0.35 * Math.sin(t * 3.2);
      frame.material.uniforms.uAlpha.value = kH * (0.55 + 0.4 * pulse);
      glowPlane.material.uniforms.uAlpha.value = kH * 0.1 * pulse;
      tag.bright = kH;
      if (!pulsed && this.visible && kH > 0) {
        pulsed = true;
        fx.ring(root.localToWorld(new THREE.Vector3(TX0 + rows[0].value * TW, rows[0].y, 0)), pal.a, { radius: 9, dur: 1.4, bright: 1.6 });
      }
      // camera eases to the top row (vertical only), holds, then returns to the whole board
      const t0 = rows[0].delay + 2.1;
      this.camFocus = ts >= t0 && ts < t0 + 3.2 ? { dx: 0, dy: (rows[0].y - midY) * 0.75, zoom: 0.78 } : null;
    }
    root.rotation.y = Math.sin(t * 0.13) * 0.02;
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, midY, 0));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 1.5, 40)), orbit: 0.05, box: boxAt(this.station, X_L - 1.8, 0, -3, X_R + 0.8, topY + 0.2, 3) };
  };
  return holo;
}
