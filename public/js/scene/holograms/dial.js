// DIAL: a labelled radial ODDS METER for single-market yes/no stories (and 1-market fallbacks).
// Reads on its own: a question chip on top, a 0-100% scale with UNLIKELY / TOSS-UP / LIKELY bands, a WAS notch (where the price stood
// yesterday / an hour ago), a needle that sweeps from then to now while a coloured delta arc fills behind it, the current % in the
// centre with a FROM line, and a footer with source, 24h volume and a thin-market flag.
import * as THREE from '../../../vendor/three/three.module.js';
import * as AH from '../holo.js'; // alias imports for the alert dial below (kept separate from the plain-dial imports)
import * as AP from './parts.js';
import { Holo, COL, clamp01, ease, pctText } from '../holo.js';
import { arcMesh, floorRing, lineSeg } from './parts.js';

const D2R = Math.PI / 180;
const T_SCALE = 0.8, T_WAS = 0.85, T_SW0 = 1.2, T_SW1 = 3.2;   // scale draws in, notch pops, needle sweeps (seconds since show)

function money(v) {
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}
// split a question into at most two balanced lines on word boundaries (never truncates)
function twoLines(raw, maxOne = 20) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const words = s.split(' ');
  if (s.length <= maxOne || words.length < 2) return [s, null];
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length, b = words.slice(i).join(' ').length;
    if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}
const ago = (mins) => (!mins ? 'EARLIER' : mins >= 90 ? `${Math.round(mins / 60)} HRS AGO` : `${Math.max(1, Math.round(mins))} MIN AGO`);

// opts.alert: { from, to, minutes } renders the breaking-move variant
export function createDial(ctx, story, opts = {}) {
  if (opts.alert) return createAlertDial(ctx, story, opts);
  const { pal, rnd, fx } = ctx;
  const lead = story?.lead || story?.markets?.[0] || { yesPrice: 0.5, change1d: 0 };
  const isAlert = !!opts.alert;
  const sw = !isAlert && story?.swing && Number.isFinite(story.swing.from) && Number.isFinite(story.swing.to) ? story.swing : null;
  const value = clamp01(isAlert ? opts.alert.to : sw ? sw.to : lead.yesPrice);
  const prev = clamp01(isAlert ? opts.alert.from : sw ? sw.from : value - (lead.change1d || 0));
  const delta = value - prev;
  const hasDelta = Math.abs(delta) >= 0.005;
  const up = delta >= 0;
  const nPts = Math.round(Math.abs(delta) * 100);
  const swFlip = !!(sw && sw.flipped && hasDelta);          // swing crossed 50%: stamp FLIPPED, flash the TOSS-UP line as the needle passes
  const swNews = sw && Array.isArray(story?.newsMarks) ? story.newsMarks.filter((m) => m && m.outlet && Number.isFinite(m.t)).sort((a, b) => b.t - a.t).slice(0, 3) : [];
  const minutes = isAlert ? Math.round(opts.alert.minutes || 0) : 0;
  // how the "then" is worded
  const thenWord = isAlert ? ago(minutes) : sw?.window === '1h' ? 'AN HOUR AGO' : 'YESTERDAY';
  const whenTxt = isAlert ? `in ${minutes >= 90 ? Math.round(minutes / 60) + ' hrs' : Math.max(1, minutes) + ' min'}` : sw?.window === '1h' ? 'in the last hour' : 'today';
  const R = 8.0, CY = 8.8;
  const TOP = CY + R + 7.2;
  const holo = new Holo(ctx, { height: TOP });
  const root = holo.root;
  const accent = isAlert ? COL.alert : pal.a;
  const accentHex = isAlert ? '#ff3a2e' : pal.hexA;

  const spanDeg = 230 + rnd() * 20;
  const span = spanDeg * D2R;
  const start = (90 - spanDeg / 2) * D2R; // value-1 end (right, below the horizon); value-0 end = start + span (left)
  const angOf = (v) => start + span * (1 - v);
  const pt = (v, r) => [Math.cos(angOf(v)) * r, Math.sin(angOf(v)) * r];
  const dial = new THREE.Group(); dial.position.y = CY; root.add(dial);
  const additive = { flat: 1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending };

  // ---- track in three bands (UNLIKELY / TOSS-UP / LIKELY), drawn in clockwise from 0% ----
  const bandDefs = [[0, 0.25, 0.3], [0.25, 0.75, 0.5], [0.75, 1, 0.3]];
  const bands = bandDefs.map(([lo, hi, a]) => {
    const m = arcMesh(R - 0.3, R, pal.b, { start, span, lo, hi: lo, glow: 0.9, alpha: a });
    holo.reg(m.material); dial.add(m); return { m, lo, hi };
  });
  // ticks: every 5% (long at 0/25/50/75/100), also drawn clockwise
  const tickArr = [];
  for (let i = 0; i <= 20; i++) { const l = i % 5 === 0 ? 0.95 : 0.4, [x0, y0] = pt(i / 20, R + 0.15), [x1, y1] = pt(i / 20, R + 0.15 + l); tickArr.push(x0, y0, 0, x1, y1, 0); }
  const ticks = lineSeg(new Float32Array(tickArr), holo.line(pal.b, { alpha: 0.85 })); dial.add(ticks);
  ticks.geometry.setDrawRange(0, 0);

  // ---- fills: current value, and the change since "then" ----
  const fillMain = arcMesh(R - 1.35, R - 0.45, accent, { start, span, lo: 0, hi: 0, glow: 1.3, alpha: 0.85 });
  const upDown = up ? COL.up : COL.down;
  const fillDelta = arcMesh(R - 2.4, R - 1.45, upDown, { start, span, lo: 0, hi: 0, glow: 1.9, alpha: 0.95 });
  holo.reg(fillMain.material); holo.reg(fillDelta.material);
  dial.add(fillMain, fillDelta);

  // ---- needle, hub, one slow ring ----
  const ndGeo = new THREE.BoxGeometry(0.26, R - 1.2, 0.16); ndGeo.translate(0, (R - 1.2) / 2, 0);
  const nd = new THREE.Group(); nd.add(new THREE.Mesh(ndGeo, holo.mat(COL.white, { flat: 1, alpha: 1, glow: 1.8 }))); dial.add(nd);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), holo.mat(accent, { flat: 1, glow: 1.5 }));
  dial.add(hub);
  const hubRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.15, 48), holo.mat(COL.white, { ...additive, alpha: 0.8, glow: 1.5 }));
  dial.add(hubRing);
  const orbit = new THREE.Group();
  {
    const r = R + 4.4, segs = 3, gap = 0.9;
    for (let s = 0; s < segs; s++) {
      const len = (Math.PI * 2) / segs - gap / r;
      orbit.add(new THREE.Mesh(new THREE.RingGeometry(r, r + 0.07, 64, 1, (s * Math.PI * 2) / segs, len), holo.mat(pal.a, { ...additive, alpha: 0.35, glow: 1.4 })));
    }
    orbit.userData.speed = 0.08 + rnd() * 0.06;
    dial.add(orbit);
  }

  // ---- WAS notch (where it stood) with a pop ring ----
  let notch = null, popRing = null;
  if (hasDelta) {
    const g = new THREE.BoxGeometry(0.3, 2.2, 0.24);
    notch = new THREE.Mesh(g, holo.mat(pal.b, { flat: 1, alpha: 1, glow: 2.1 }));
    notch.position.set(0, R - 0.1, 0.1);
    const piv = new THREE.Group(); piv.add(notch); piv.rotation.z = angOf(prev) - Math.PI / 2; dial.add(piv);
    notch.scale.setScalar(0.001);
    popRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), holo.mat(pal.b, { ...additive, alpha: 0.95, glow: 2 }));
    const [px, py] = pt(prev, R - 0.1); popRing.position.set(px, py, 0.2); popRing.scale.setScalar(0.001); dial.add(popRing);
  }
  // end caps
  const capMat = holo.mat(COL.white, { flat: 1, alpha: 0.9, glow: 1.4 });
  for (const v of [0, 1]) { const [cx, cy] = pt(v, R - 0.15); const c = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), capMat); c.position.set(cx, cy, 0.1); dial.add(c); }

  // ---- floor ----
  const floorMat = holo.mat(pal.b, { ...additive, alpha: 0.6, glow: 1.6 });
  root.add(floorRing(R + 2.2, R + 2.35, floorMat));

  // ---- labels (world position = dial centre + polar offset; the dial group wobbles a hair, labels stay put) ----
  const at = (v, r) => { const [x, y] = pt(v, r); return [x, CY + y]; };
  // (A) question chip
  const evt = String(story?.eventTitle || story?.headline || lead.title || '').replace(/\s+/g, ' ').trim();
  const oc = String(lead.outcome || '').trim();
  const useOutcome = oc && !/^(yes|no)$/i.test(oc) && oc.toUpperCase() !== evt.toUpperCase();
  let chip;
  if (useOutcome) {
    chip = holo.label(oc.toUpperCase(), { w: 1400, h: 200, height: 2.4, font: '900 86px Orbitron', color: '#ffffff', glow: accentHex, sub: evt.toUpperCase(), subColor: '#dfe8ff', subFont: '700 76px Rajdhani', mainY: 0.3, subY: 0.76 });
  } else {
    const [l1, l2] = twoLines(evt || 'THE CHANCE');
    chip = holo.label(l1, { w: 1400, h: 200, height: 2.4, font: '900 80px Orbitron', color: '#ffffff', glow: accentHex, sub: l2, subColor: '#ffffff', subFont: '900 80px Orbitron', mainY: l2 ? 0.28 : 0.5, subY: 0.74 });
  }
  chip.sprite.position.set(0, CY + R + 5.8, 0.5); chip.yFrac = 0.86;
  // (B) scale labels, 0 / 25 / 50 / 75 / 100
  const scaleLbls = [0, 0.25, 0.5, 0.75, 1].map((v) => {
    // swings name the 50% line (crossing it is the story); the rest stay plain
    const l = sw && v === 0.5
      ? holo.label('50%', { w: 384, h: 192, height: 2.5, font: '700 84px Rajdhani', color: '#eef3ff', glow: pal.hexB, sub: 'TOSS-UP', subColor: '#ffe28a', subFont: '700 64px Rajdhani', mainY: 0.34, subY: 0.78 })
      : holo.label(`${Math.round(v * 100)}%`, { w: 256, h: 128, height: 1.7, font: '700 84px Rajdhani', color: '#eef3ff', glow: pal.hexB });
    const [x, y] = at(v, R + (sw && v === 0.5 ? 2.5 : 2.05)); l.sprite.position.set(x, y, 0.3); l.yFrac = 0.1; l.bright = 0; l.v = v;
    if (hasDelta && Math.abs(v - prev) < (sw ? 0.06 : 0.04)) { l.hidden = true; }   // the WAS label sits right there
    if (sw && hasDelta && Math.abs(v - value) < 0.06) { l.hidden = true; }           // ... and the NOW label here
    if (isAlert && Math.abs(v - value) < 0.04) { l.hidden = true; }
    return l;
  });
  const bandLbls = [['UNLIKELY', 0.125], ['TOSS-UP', 0.5], ['LIKELY', 0.875]].map(([txt, v]) => {
    const l = holo.label(txt, { w: 384, h: 128, height: 1.35, font: '700 74px Rajdhani', color: '#c4d0ff', glow: pal.hexB });
    const [x, y] = at(v, R - 3.0); l.sprite.position.set(x, y, 0.2); l.yFrac = 0.1; l.bright = 0; l.target = 0.9;
    if (sw && txt === 'TOSS-UP') l.hidden = true;   // swings label the 50% line on the rim instead
    return l;
  });
  // (C) WAS label outside the rim, aligned outward so it never runs over the dial
  let wasLbl = null;
  if (hasDelta) {
    const cx = Math.cos(angOf(prev));
    const align = cx > 0.4 ? 'left' : cx < -0.4 ? 'right' : 'center';
    wasLbl = holo.label(`WAS ${pctText(prev)}`, { w: 400, h: 160, height: 2.1, font: '800 88px Rajdhani', color: '#ffffff', glow: pal.hexB, sub: thenWord, subColor: '#dfe8ff', subFont: '700 62px Rajdhani', align, mainY: 0.32, subY: 0.76 });
    const [x, y] = at(prev, R + 3.5);
    wasLbl.sprite.position.set(x + (align === 'left' ? -0.4 : align === 'right' ? 0.4 : 0), y, 0.4); wasLbl.yFrac = 0.1; wasLbl.bright = 0;
  }
  // alert: NOW label at the needle
  let nowLbl = null;
  if (isAlert) {
    const cx = Math.cos(angOf(value));
    const align = cx > 0.4 ? 'left' : cx < -0.4 ? 'right' : 'center';
    nowLbl = holo.label(`NOW ${pctText(value)}`, { w: 400, h: 128, height: 1.5, font: '900 84px Rajdhani', color: '#ffffff', glow: '#ff3a2e', align });
    const [x, y] = at(value, R + 3.5);
    nowLbl.sprite.position.set(x + (align === 'left' ? -0.4 : align === 'right' ? 0.4 : 0), y, 0.4); nowLbl.yFrac = 0.1; nowLbl.bright = 0;
  }
  // swing extras: NOW label at the needle's landing, FLIPPED / LONGSHOT / SLIPPING badge, 50% line + crossing flash, arrowhead, headline strip
  let swNow = null, swBadge = null, swBadgeScale = null, swNews0 = null, swHead = null, swMark = null, swFlipRing = null, swCross = null;
  if (sw && hasDelta) {
    const dcol = up ? '#3dff8a' : '#ff2e55';
    { const cx = Math.cos(angOf(value)), align = cx > 0.4 ? 'left' : cx < -0.4 ? 'right' : 'center';
      swNow = holo.label(`NOW ${pctText(value)}`, { w: 400, h: 160, height: 2.1, font: '900 88px Rajdhani', color: '#ffffff', glow: dcol, sub: sw.window === '1h' ? 'LAST HOUR' : 'TODAY', subColor: up ? '#b6ffd2' : '#ffc0cc', subFont: '700 62px Rajdhani', align, mainY: 0.32, subY: 0.76 });
      const [x, y] = at(value, R + 3.5); swNow.sprite.position.set(x + (align === 'left' ? -0.4 : align === 'right' ? 0.4 : 0), y, 0.4); swNow.yFrac = 0.1; swNow.bright = 0; }
    // badge: FLIPPED (crossed 50%) beats the shape word
    const shapeTxt = sw.shape === 'longshot' ? 'LONGSHOT SURGES' : sw.shape === 'slipping' ? 'FAVORITE SLIPPING' : up ? 'BIG JUMP' : 'BIG DROP';
    const ptsW = `${up ? '+' : '-'}${nPts} PTS`, bMain = swFlip ? 'FLIPPED' : shapeTxt, bSub = swFlip ? `${ptsW} · ${sw.shape === 'swing' ? 'CROSSED 50%' : shapeTxt}` : `${ptsW} ${sw.window === '1h' ? 'IN AN HOUR' : 'IN 24 HOURS'}`;
    swBadge = holo.label(bMain, { w: 900, h: 200, height: 2.4, font: '900 96px Orbitron', color: '#ffffff', glow: swFlip ? '#ffd23f' : dcol, sub: bSub, subColor: swFlip ? '#ffe28a' : '#dfe8ff', subFont: '700 60px Rajdhani', mainY: 0.34, subY: 0.8 });
    swBadge.sprite.position.set(0, CY + 3.2, 0.7); swBadge.yFrac = 0.6; swBadge.bright = 0; swBadgeScale = swBadge.sprite.scale.clone();
    // 50% line across the track (flashes when the needle crosses it) + crossing ring
    swMark = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.2, 0.1), holo.mat(new THREE.Color('#ffe28a'), { flat: 1, alpha: 0.7, glow: 1.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    swMark.position.set(0, R - 1.3, 0.05); const mp = new THREE.Group(); mp.add(swMark); mp.rotation.z = angOf(0.5) - Math.PI / 2; dial.add(mp);
    if (swFlip) {
      swCross = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), holo.mat(new THREE.Color('#ffd23f'), { ...additive, alpha: 0.95, glow: 2 }));
      const [px, py] = pt(0.5, R - 0.2); swCross.position.set(px, py, 0.2); swCross.scale.setScalar(0.001); dial.add(swCross);
      // slow pulse ring that keeps breathing out from the hub once the needle has landed
      swFlipRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), holo.mat(new THREE.Color('#ffd23f'), { ...additive, alpha: 0, glow: 1.6 }));
      swFlipRing.position.z = 0.1; swFlipRing.scale.setScalar(0.001); dial.add(swFlipRing);
    }
    // arrowhead riding the delta arc in the direction of travel
    swHead = new THREE.Group(); const hd = new THREE.Mesh(new THREE.CircleGeometry(0.85, 3), holo.mat(up ? COL.up : COL.down, { flat: 1, glow: 2.1, alpha: 1 }));
    hd.position.y = R - 1.925; hd.rotation.z = up ? 0 : Math.PI; swHead.add(hd); dial.add(swHead);
    // headlines that landed (outlet + age); no position claim, the dial has no timeline
    if (swNews.length) {
      const nowS = Date.now() / 1000, ageTxt = (t) => { const h = (nowS - t) / 3600; return h < 1.5 ? `${Math.max(1, Math.round(h * 60))} MIN AGO` : `${Math.round(h)}H AGO`; };
      swNews0 = holo.label(`NEWS: ${swNews.map((m) => `${String(m.outlet).toUpperCase()} ${ageTxt(m.t)}`).join(' · ')}`, { w: 1792, h: 112, height: 1.4, font: '700 64px Rajdhani', color: '#ffe28a', glow: '#ffd23f' });
      swNews0.sprite.position.set(0, -1.3, 1.2); swNews0.yFrac = 0.02; swNews0.bright = 0;
    }
  }
  // (D) centre readout: big %, FROM line, then the change in points
  const big = holo.label(pctText(isAlert || sw ? prev : value), { w: 1024, h: 256, height: 3.2, font: '900 190px Orbitron', color: '#ffffff', glow: accentHex, sub: hasDelta ? `FROM ${pctText(prev)} ${thenWord}` : 'UNCHANGED TODAY', subColor: '#dfe8ff', subFont: '700 84px Rajdhani', mainY: 0.4, subY: 0.86 });
  big.sprite.position.set(0, CY - R * 0.55, 0.6); big.yFrac = 0.3;
  const ptsTxt = hasDelta ? `${up ? '▲' : '▼'} ${nPts} pts ${whenTxt}` : 'flat today';
  const ptsLbl = holo.label(ptsTxt, { w: 900, h: 150, height: 1.7, font: '700 90px Rajdhani', color: hasDelta ? (up ? '#3dff8a' : '#ff2e55') : '#dfe8ff', glow: hasDelta ? (up ? '#3dff8a' : '#ff2e55') : pal.hexB });
  ptsLbl.sprite.position.set(0, CY - R * 0.55 - 2.5, 0.6); ptsLbl.yFrac = 0.22;
  // delta label on the delta arc midpoint
  let dLbl = null, dScale = null;
  if (hasDelta && !(sw && swBadge)) {   // swings: the badge carries the +N PTS (two labels inside the arc collided)
    const mid = (prev + value) / 2;
    dLbl = holo.label(`${up ? '+' : '-'}${nPts} PTS`, { w: 640, h: 190, height: 2.7, crisp: true, plateAlpha: 0.7, font: '900 104px Orbitron', color: '#ffffff', glow: up ? '#3dff8a' : '#ff2e55', sub: isAlert ? `IN ${Math.max(1, minutes)} MIN` : null, subColor: '#ffffff', subFont: '700 62px Rajdhani', mainY: isAlert ? 0.32 : 0.5, subY: 0.8 });
    let [x, y] = at(mid, R - 4.3);
    if (sw && Math.abs(x) < 3.6 && y - CY < 4.5) y = CY + 4.5;   // swings: keep the +N PTS above the badge, under the arc
    dLbl.sprite.position.set(x, y, 0.5); dLbl.yFrac = 0.1; dLbl.bright = 0;
    dScale = dLbl.sprite.scale.clone();
    const w = dScale.x, h = dScale.y;
    for (const b of bandLbls) {   // dodge the faint band words rather than overlap them
      const dx = Math.abs(b.sprite.position.x - x), dy = Math.abs(b.sprite.position.y - y);
      if (dx < (b.sprite.scale.x * 0.45 + w * 0.4) && dy < (b.sprite.scale.y * 0.5 + h * 0.5)) b.hidden = true;
    }
  }
  // (F) footer: source, size, thin flag
  const srcName = lead.source === 'kalshi' ? 'KALSHI' : 'POLYMARKET';
  const vol = money(lead.volume24h);
  const thin = !!story?.thin;
  const footTxt = `${srcName}${vol ? ` · ${vol} TODAY` : ''}${thin ? ' · THIN MARKET' : ''}`;
  const foot = holo.label(footTxt, { w: 1400, h: 128, height: 1.6, font: '700 74px Rajdhani', color: thin ? '#ffab2e' : '#dfe8ff', glow: thin ? '#ffab2e' : pal.hexB });
  foot.sprite.position.set(0, 0.6, 1.2); foot.yFrac = 0.02;

  // ---- animation ----
  let shownTxt = '', popped = false, popT = -1;
  const counting = !!(isAlert || sw);
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    // phase 1: scale draws in clockwise 0 -> 100%
    const k1 = clamp01(ts / T_SCALE);
    ticks.geometry.setDrawRange(0, Math.floor(k1 * 21 + 0.001) * 2);
    for (const b of bands) b.m.material.uniforms.uHi.value = Math.min(b.hi, Math.max(b.lo, k1 * 1.0));
    for (const l of scaleLbls) l.bright = l.hidden ? 0 : clamp01((k1 - l.v) * 8 + (k1 >= 1 ? 1 : 0));
    for (const l of bandLbls) l.bright = l.hidden ? 0 : clamp01((k1 - 0.9) * 10) * l.target;
    chip.bright = clamp01(ts * 3);
    foot.bright = clamp01((ts - 0.3) * 3);
    // phase 2: WAS notch pops with a ring pulse
    const kp = clamp01((ts - T_WAS) / 0.3);
    if (notch) {
      notch.scale.setScalar(Math.max(0.001, ease.back(kp)));
      wasLbl.bright = clamp01((ts - T_WAS) * 4);
      if (!popped && ts >= T_WAS && this.visible) {
        popped = true; popT = 0;
        if (fx) { const p = new THREE.Vector3(...pt(prev, R - 0.1), 0.1); dial.localToWorld(p); fx.burst(p, pal.b, 36, { speed: 5, up: 1.5, lifeS: 0.9, sz: 0.7 }); }
      }
      if (popT >= 0) { popT += dt; const k = popT / 0.8; popRing.scale.setScalar(0.4 + k * 3.2); popRing.material.uniforms.uFade.value = Math.max(0, 1 - k) * this.fade; if (k >= 1) { popT = -1; popRing.scale.setScalar(0.001); } }
    }
    // phase 3: needle sweeps then -> now; delta arc fills behind it; the centre % counts along on swing/alert cards
    const k = clamp01((ts - T_SW0) / (T_SW1 - T_SW0));
    const from = hasDelta ? prev : 0;
    const shown = from + (value - from) * ease.inOut(k);
    nd.rotation.z = angOf(shown) - Math.PI / 2;
    fillMain.material.uniforms.uHi.value = shown;
    if (hasDelta) { fillDelta.material.uniforms.uLo.value = Math.min(prev, shown); fillDelta.material.uniforms.uHi.value = Math.max(prev, shown); }
    if (counting) { const txt = pctText(shown); if (txt !== shownTxt) { shownTxt = txt; big.set(txt); } }
    big.bright = clamp01(ts * 2.5); ptsLbl.bright = clamp01((ts - T_SW0) * 2);
    if (swHead) {
      const a = angOf(shown); swHead.rotation.z = a - Math.PI / 2; swHead.visible = ts >= T_SW0 && Math.abs(shown - prev) > 0.02;
      if (k > 0 && k < 1 && fx && this.visible && (this._sp = (this._sp || 0) + dt) > 0.07) { this._sp = 0; const p = new THREE.Vector3(Math.cos(a) * (R - 1), Math.sin(a) * (R - 1), 0.1); dial.localToWorld(p); fx.burst(p, up ? COL.up : COL.down, 4, { speed: 2.5, up: 0.5, lifeS: 0.7, sz: 0.5 }); }
    }
    if (swMark) swMark.material.uniforms.uAlpha.value = 0.55 + (swCross && k > 0 && k < 1 && Math.abs(shown - 0.5) < 0.08 ? 0.45 : 0.1 * Math.sin(t * 3));
    if (swCross) {
      if (!this._crossed && k > 0 && (prev - 0.5) * (shown - 0.5) <= 0) { this._crossed = true; this._crossT = 0; if (fx && this.visible) { const p = new THREE.Vector3(...pt(0.5, R - 0.2), 0.1); dial.localToWorld(p); fx.burst(p, new THREE.Color('#ffd23f'), 40, { speed: 5.5, up: 1.5, lifeS: 1, sz: 0.8 }); } }
      if (this._crossT !== undefined) { this._crossT += dt; const kk = this._crossT / 0.9; swCross.scale.setScalar(0.4 + kk * 3.6); swCross.material.uniforms.uFade.value = Math.max(0, 1 - kk) * this.fade; if (kk >= 1) { swCross.scale.setScalar(0.001); this._crossT = undefined; } }
    }
    // phase 4: settled -> delta label scales in, the needle quivers
    const ks = clamp01((ts - T_SW1) / 0.45);
    if (dLbl) { dLbl.bright = ks; dLbl.sprite.scale.set(dScale.x * ease.back(ks), dScale.y * ease.back(ks), 1); }
    if (nowLbl) nowLbl.bright = ks;
    if (swNow) swNow.bright = clamp01((ts - T_SW1 + 0.3) / 0.3);
    if (swBadge) { const bk = ease.back(clamp01((ts - T_SW1 - 0.1) / 0.5)); swBadge.bright = bk > 0.02 ? 1 : 0; const pu = 1 + (swFlip ? 0.05 * Math.sin(t * 4) : 0); swBadge.sprite.scale.set(swBadgeScale.x * Math.max(0.001, bk) * pu, swBadgeScale.y * Math.max(0.001, bk) * pu, 1); }
    if (swNews0) swNews0.bright = clamp01((ts - T_SW1) * 2);
    if (swFlipRing && ks >= 1) { const c = ((ts - T_SW1) % 2.4) / 2.4; swFlipRing.scale.setScalar(1.5 + c * (R - 2.8)); swFlipRing.material.uniforms.uAlpha.value = 0.55 * (1 - c); }
    if (k >= 1) {
      const sT = ts - T_SW1;
      nd.rotation.z += Math.exp(-3 * sT) * Math.sin(sT * 22) * 0.05 + Math.sin(t * 9) * 0.004 + Math.sin(t * 2.3) * 0.003;
    }
    hub.scale.setScalar(1 + 0.08 * Math.sin(t * 4));
    hubRing.rotation.z = t * 0.9; hubRing.scale.setScalar(1 + 0.05 * Math.sin(t * 2.3));
    orbit.rotation.z += orbit.userData.speed * dt;
    dial.rotation.y = Math.sin(t * 0.21) * 0.08;
    root.rotation.y = Math.sin(t * 0.13) * 0.03;
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, CY + 1.2, 0));
    const x = R + 8;
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 2, 40)), orbit: 0.1, box: new THREE.Box3(this.station.clone().add(new THREE.Vector3(-x, swNews0 ? -2 : 0, -1.5)), this.station.clone().add(new THREE.Vector3(x, TOP, 1.5))) };
  };
  return holo;
}

// ---------- BREAKING alert dial ----------
// Self-contained so the plain dial can evolve without touching it. opts.alert = { from, to, minutes, label }.
// Reads stand-alone: title chip (which market), a labelled 0-100 scale, "WAS 18%" notch, solid red delta arc with "+9 PTS",
// and a big FROM -> TO readout. The needle holds at FROM, then snaps to TO with overshoot, a ring pulse and a count-up.
const A_R = 8.6, A_CY = 10.0;
function createAlertDial(ctx, story, opts) {
  const { Holo: HoloC, COL: C, clamp01: c01, ease: E, pctText: pct, boxAt: bx } = AH;
  const { pal } = ctx;
  const al = opts.alert;
  const value = c01(al.to), prev = c01(al.from), delta = value - prev;
  const R = A_R, CY = A_CY;
  const H = CY + R + 5.4;
  const holo = new HoloC(ctx, { height: H });
  const root = holo.root;
  const spanDeg = 240, span = spanDeg * D2R, start = (90 - spanDeg / 2) * D2R;
  const angOf = (v) => start + span * (1 - v);
  const dial = new THREE.Group(); dial.position.y = CY; root.add(dial);
  const REDTXT = '#ff3a2e';

  // track + ticks + faint spokes
  dial.add(new THREE.Mesh(new THREE.RingGeometry(R - 0.3, R, 160, 1, start, span), holo.mat(pal.b, { flat: 1, alpha: 0.35, glow: 1.2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
  dial.add(AP.lineSeg(AP.tickPositions(R + 0.35, start, span), holo.line(pal.b, { alpha: 0.75 })));
  { const arr = []; for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; arr.push(Math.cos(a) * 1.4, Math.sin(a) * 1.4, -0.3, Math.cos(a) * (R - 2.4), Math.sin(a) * (R - 2.4), -0.3); }
    dial.add(AP.lineSeg(new Float32Array(arr), holo.line(pal.b, { alpha: 0.1 }))); }
  // fills: dim base up to the lower of FROM/TO, solid red delta between, thin red bracket outside the ticks
  const fillBase = AP.arcMesh(R - 1.35, R - 0.45, pal.b, { start, span, lo: 0, hi: 0, glow: 1.1, alpha: 0.5 });
  const fillDelta = AP.arcMesh(R - 1.95, R - 0.45, C.alert, { start, span, lo: prev, hi: prev, glow: 1.9, alpha: 0.95 });
  const bracket = AP.arcMesh(R + 1.6, R + 1.85, C.alert, { start, span, lo: prev, hi: prev, glow: 2.1, alpha: 0.95 });
  holo.reg(fillBase.material); holo.reg(fillDelta.material); holo.reg(bracket.material);
  dial.add(fillBase, fillDelta, bracket);
  // needle (white, red beacon at the tip) + thin ghost needle at FROM + rim notch at FROM
  function needle(color, alpha, len, w, beacon) {
    const g = new THREE.BoxGeometry(w, len, w * 0.6); g.translate(0, len / 2, 0);
    const pivot = new THREE.Group(); pivot.add(new THREE.Mesh(g, holo.mat(color, { flat: 1, alpha, glow: 0.95 })));
    if (beacon) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), holo.mat(C.alert, { flat: 1, glow: 2 })); b.position.y = len; pivot.add(b); }
    dial.add(pivot); return pivot;
  }
  const NDL = new THREE.Color('#ffd0cb');
  const ghost = needle(NDL, 0.3, R - 1.8, 0.08);
  const nd = needle(NDL, 1, R - 1.0, 0.2, true);
  const notch = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.9, 0.2), holo.mat(NDL, { flat: 1, alpha: 0.9, glow: 0.9 }));
  notch.position.set(0, R, 0.1);
  const nGrp = new THREE.Group(); nGrp.add(notch); nGrp.rotation.z = angOf(prev) - Math.PI / 2; dial.add(nGrp);
  dial.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), holo.mat(pal.a, { flat: 1, glow: 1.0 })));
  const hubRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.15, 48), holo.mat(NDL, { flat: 1, alpha: 0.6, glow: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  dial.add(hubRing);
  // landing pulse: a flat ring that expands from the needle tip (in the dial plane)
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 48), holo.mat(C.alert, { flat: 1, alpha: 1, glow: 2.4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  pulse.visible = false; pulse.position.z = 0.2; dial.add(pulse);
  // floor rings + base line
  const floorMat = holo.mat(pal.b, { flat: 1, alpha: 0.6, glow: 1.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  root.add(AP.floorRing(R + 2.2, R + 2.35, floorMat)); root.add(AP.floorRing(3.2, 3.3, floorMat, 64));

  // ----- labels -----
  const ext = (a, hw, hh) => ({ rad: hw * Math.abs(Math.cos(a)) + hh * Math.abs(Math.sin(a)), tan: hw * Math.abs(Math.sin(a)) + hh * Math.abs(Math.cos(a)) });
  // centre of a hw x hh box sitting outside (+1) or inside (-1) of radius rb at angle a, optionally slid along the arc by `slide` (+ = toward lower values)
  function atRim(a, rb, side, hw, hh, gap = 0.25, slide = 0) {
    const e = ext(a, hw, hh), r = rb + side * (e.rad + gap), s = slide;
    return [Math.cos(a) * r - Math.sin(a) * s, Math.sin(a) * r + Math.cos(a) * s];
  }
  function mk(text, o, x, y, z = 0.6) {
    const l = holo.label(text, o); l.sprite.position.set(x, CY + y, z); l.yFrac = c01((CY + y) / H);
    l.base = { x: l.sprite.scale.x, y: l.sprite.scale.y }; return l;
  }
  const RAJ = '700 96px Rajdhani';
  // scale labels
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    if (Math.abs(v - (prev + value) / 2) < 0.055 && v > 0 && v < 1) continue; // the +N PTS label owns this spot
    const a = angOf(v), [x, y] = atRim(a, R + 1.45, 1, 0.8, 0.4);
    mk(Math.round(v * 100) + '%', { w: 256, h: 128, height: 1.15, font: RAJ, color: '#e8eeff', glow: pal.hexB, bright: 0.5 }, x, y);
  }
  // WAS notch label, just inside the rim on the side away from the move
  const aFrom = angOf(prev), aTo = angOf(value);
  const away = delta === 0 ? 1 : Math.sign(aFrom - aTo); // angle direction pointing away from TO
  const [wx, wy] = atRim(aFrom, R - 2.0, -1, 1.55, 0.5, 0.2, away * (ext(aFrom, 1.55, 0.5).tan + 0.35));
  const was = mk('WAS ' + pct(prev), { w: 384, h: 128, height: 1.3, font: '700 92px Rajdhani', color: '#ffd9d5', glow: '#000000', bright: 0.5 }, wx, wy);
  // delta label outside the bracket at the midpoint (own tier, beyond the scale labels)
  const aMid = angOf((prev + value) / 2), dN = Math.round(Math.abs(delta) * 100);
  const [dx, dy] = atRim(aMid, R + 2.9, 1, 1.9, 0.6, 0.1);
  const dlab = mk(`${delta >= 0 ? '▲' : '▼'} ${dN} PTS`, { w: 512, h: 160, height: 1.7, crisp: true, font: '800 118px Rajdhani', color: '#ffffff', glow: REDTXT, bright: 0.5 }, dx, dy);
  // readout under the hub: FROM  ->  TO, then the time window
  const RY = -4.5;
  const fromL = mk(pct(prev), { w: 512, h: 256, height: 2.3, font: '900 150px Orbitron', color: '#ffc4be', glow: '#000000', bright: 0.46 }, -5.0, RY);
  const toL = mk(pct(prev), { w: 640, h: 256, height: 3.4, font: '900 170px Orbitron', color: '#ffffff', glow: '#600008', bright: 0.5 }, 3.9, RY - 0.1);
  const mins = al.minutes | 0;
  const winTxt = mins <= 0 ? 'JUST NOW' : mins < 60 ? `IN ${mins} MIN` : `IN ${Math.floor(mins / 60)} HR${mins % 60 ? ' ' + (mins % 60) + ' MIN' : ''}`;
  mk(winTxt, { w: 512, h: 128, height: 1.5, font: '700 96px Orbitron', color: '#ffffff', glow: REDTXT, bright: 0.5 }, 0, -7.0);
  // arrow FROM -> TO between the numbers
  const arrow = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 0.1), holo.mat(C.alert, { flat: 1, glow: 2 }));
  const head = new THREE.Mesh(new THREE.CircleGeometry(0.62, 3), holo.mat(C.alert, { flat: 1, glow: 2 })); head.position.x = 0.95;
  arrow.add(shaft, head); arrow.position.set(-1.5, RY - 0.1, 0.5); dial.add(arrow); arrow.position.y = RY - 0.1;
  // title chip: which market moved
  const title = String(al.label || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const TY = -9.0;
  if (title) {
    const chip = new THREE.Mesh(new THREE.PlaneGeometry(15.6, 2.3), holo.mat(new THREE.Color('#14000a'), { flat: 1, alpha: 0.72, glow: 1, depthWrite: false }));
    chip.position.set(0, TY, 0.3); dial.add(chip);
    const hw = 7.8, hh = 1.15, z = 0.35;
    dial.add(AP.lineSeg(new Float32Array([-hw, TY - hh, z, hw, TY - hh, z, hw, TY - hh, z, hw, TY + hh, z, hw, TY + hh, z, -hw, TY + hh, z, -hw, TY + hh, z, -hw, TY - hh, z]), holo.line(C.alert, { glow: 2, alpha: 0.9 })));
    mk(title, { w: 1800, h: 200, height: 1.9, font: '800 118px Orbitron', color: '#ffffff', glow: REDTXT, bright: 0.5 }, 0, TY);
  }

  // ----- animation -----
  const T_SNAP = 1.0, SNAP = 0.9;
  let landed = false, tLand = 0, shownTxt = '';
  const lo = Math.min(prev, value), hi = Math.max(prev, value);
  const tip = (v) => [Math.cos(angOf(v)) * (R - 1.0), Math.sin(angOf(v)) * (R - 1.0)];
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    const k = c01((ts - T_SNAP) / SNAP);
    const shown = prev + (value - prev) * E.back(k);
    const vis = c01(shown);
    nd.rotation.z = angOf(vis) - Math.PI / 2;
    ghost.rotation.z = angOf(prev) - Math.PI / 2;
    const grow = E.out(c01(ts / 1.1));
    fillBase.material.uniforms.uHi.value = Math.min(prev, vis) * grow;
    const dlo = Math.min(prev, vis), dhi = Math.max(prev, vis);
    for (const f of [fillDelta, bracket]) { f.material.uniforms.uLo.value = dlo; f.material.uniforms.uHi.value = dhi; }
    fillDelta.material.uniforms.uGlow.value = landed ? 1.9 + 0.35 * Math.sin(t * 6) : 1.9;
    // count-up in the TO readout
    const txt = pct(Math.min(hi, Math.max(lo, shown)));
    if (txt !== shownTxt) { shownTxt = txt; toL.set(txt); }
    toL.sprite.scale.set(toL.base.x, toL.base.y, 1);
    // FROM readout, scale and arrow build in with the reveal; WAS appears as the needle leaves; delta label lands with the needle
    was.bright = c01((ts - T_SNAP) / 0.35);
    arrow.scale.setScalar(1 + (k > 0 && k < 1 ? 0.25 : 0.06 * Math.sin(t * 5)));
    arrow.position.x = -1.5 + (k < 1 ? 0 : 0.12 * Math.sin(t * 5));
    if (!landed && k >= 1) {
      landed = true; tLand = ts;
      const [px, py] = tip(value);
      pulse.position.x = px; pulse.position.y = py; pulse.visible = true;
      ctx.fx?.ring?.(new THREE.Vector3(root.position.x, root.position.y + CY + py, root.position.z + 0.5).add(new THREE.Vector3(px, 0, 0)), C.alert, { radius: 16, dur: 1.3, bright: 2.5 });
    }
    const la = landed ? ts - tLand : -1;
    dlab.bright = landed ? c01(la / 0.25) : 0;
    const pop = landed ? 1 + 0.5 * Math.max(0, 1 - la / 0.5) * Math.cos(la * 14) : 1;
    dlab.sprite.scale.set(dlab.base.x * pop, dlab.base.y * pop, 1);
    const tp = landed ? 1 + 0.35 * Math.max(0, 1 - la / 0.6) : 1;
    toL.sprite.scale.set(toL.base.x * tp, toL.base.y * tp, 1);
    if (pulse.visible) {
      const pk = c01(la / 0.9);
      pulse.scale.setScalar(1 + 6 * E.out(pk));
      pulse.material.uniforms.uAlpha.value = 1 - pk;
      if (pk >= 1) pulse.visible = false;
    }
    hubRing.rotation.z = t * 0.9; hubRing.scale.setScalar(1 + 0.05 * Math.sin(t * 2.3));
    if (k >= 1) nd.rotation.z += Math.sin(t * 9) * 0.004 + Math.sin(t * 2.3) * 0.003;
    dial.rotation.y = Math.sin(t * 0.21) * 0.05;
    root.rotation.y = Math.sin(t * 0.13) * 0.02;
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, CY - 2.2, 0));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 2, 42)), orbit: 0.08, box: bx(this.station, -(R + 6.5), CY - 10.5, -1.5, R + 6.5, CY + R + 5.2, 1.5) };
  };
  return holo;
}
