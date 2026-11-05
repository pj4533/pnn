// COUNTDOWN: a labelled "race to the deadline" panel. TOP = a fuse that burns toward the close (big "CLOSES IN 2 DAYS 7 HRS" + the ET
// resolution time, a day scale with a marker at the time left, or the market's own life when createdAt is known). BELOW = one bar per
// market (lead first, the rest by price): outcome name, bar on a 0-100% axis, the % counting up, a gold tick at yesterday's level and a
// green/red segment + "▲ 5 PTS TODAY" chip. Chips say whether the outcomes add to 100% or are separate questions. Footer = source, age, volume, THIN.
// Used for visual.type 'countdown' (cluster:false) and the week segment (cluster:true, same panel). No rings, so it is also much cheaper.
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, ease, boxAt, reveal } from '../holo.js';
import { lineSeg } from './parts.js';
import { OUTCOME_COLORS, money, ago, exchangeName } from '../../util.js';
import { createWeekBoard } from './weekboard.js';

const X0 = -19.5, X1 = 19.5;                       // panel / fuse extent
const T0 = -7.6, TW = 16.4;                    // bar track: 0% .. 100%
const NAME_R = -8.4, CHIP_X = 13.1;           // name column right edge, change-chip column left edge
const Y_BAR_TOP = 14.0, Y_BAR_BOT = 3.4, Y_AXIS = 2.5, Y_FOOT = 0.85;
const Y_FUSE = 16.2, Y_FUSE_LBL = 15.0, Y_TITLE = 18.6;
const UP = '#3dff8a', DOWN = '#ff2e55', FLAT = '#cfd8ff', GOLD = '#ffd23f';

// left-anchored unit box: position.x = left edge, scale = (width, height, depth)
const BOX = new THREE.BoxGeometry(1, 1, 1); BOX.translate(0.5, 0, 0);

function closeText(ms) {
  if (ms <= 0) return 'CLOSING NOW';
  const d = Math.floor(ms / 86400e3), h = Math.floor((ms % 86400e3) / 3600e3), m = Math.floor((ms % 3600e3) / 60e3), s = Math.floor((ms % 60e3) / 1e3);
  if (d >= 2) return `CLOSES IN ${d} DAYS ${h} HRS`;
  if (d === 1) return `CLOSES IN 1 DAY ${h} HRS`;
  if (h >= 1) return `CLOSES IN ${h} HRS ${m} MIN`;
  return `CLOSES IN ${m} MIN ${String(s).padStart(2, '0')} SEC`;
}
function etClose(iso, nowMs) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d).map((x) => [x.type, x.value]));
  const hm = p.minute === '00' ? `${p.hour}${p.dayPeriod}` : `${p.hour}:${p.minute}${p.dayPeriod}`;
  const day = (d.getTime() - nowMs) / 86400e3 < 6 ? p.weekday : `${p.month} ${p.day}`;
  return `${day} ${hm} ET`.toUpperCase();
}
function spanText(ms) {
  const d = ms / 86400e3;
  return d >= 1.5 ? `${Math.round(d)} DAYS` : `${Math.max(1, Math.round(ms / 3600e3))} HRS`;
}

export function createCountdown(ctx, story, { cluster = false } = {}) {
  if (cluster) return createWeekBoard(ctx, story);   // week segment: the close-time calendar strip (weekboard.js)
  const { pal, fx } = ctx;
  const lead = story.lead || story.markets?.[0] || { yesPrice: 0.5 };
  const now = Date.now();
  const holo = new Holo(ctx, { height: 20 });
  const root = holo.root;

  // ---- which markets, in what order ----
  const all = (story.markets && story.markets.length ? story.markets : [lead]);
  const leadIdx = Math.max(0, all.findIndex((m) => m === lead || (m.id != null && m.id === lead.id)));
  const rest = all.filter((_, i) => i !== leadIdx).sort((a, b) => (b.yesPrice ?? 0) - (a.yesPrice ?? 0));
  const ordered = [all[leadIdx] || lead, ...rest].slice(0, 4);
  const n = ordered.length, single = n === 1;
  const sum = all.reduce((s, m) => s + clamp01(m.yesPrice ?? 0), 0);
  const exclusive = !story.ladder && all.length >= 2 && sum >= 0.85 && sum <= 1.15;

  const flatMat = (color, o = {}) => holo.mat(color, { flat: 1, ...o });
  const add = (mesh, x, y, z, w, h, d) => { mesh.position.set(x, y, z); mesh.scale.set(w, h, d); root.add(mesh); return mesh; };
  const yOfFrac = (y) => clamp01(y / 20 - 0.04);

  // ---- backing panel + frame (also keeps the text readable on bright backgrounds) ----
  {
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 + 3, 20.4), holo.mat(new THREE.Color(0.02, 0.0, 0.09), { flat: 1, alpha: 0.62, depthWrite: false }));
    bg.position.set(0, 10.1, -0.9); root.add(bg);
    const a = X0 - 1.5, b = X1 + 1.5, y0 = -0.1, y1 = 20.3, L = 1.6;
    const br = [a, y0, -0.8, a + L, y0, -0.8, a, y0, -0.8, a, y0 + L, -0.8, b, y0, -0.8, b - L, y0, -0.8, b, y0, -0.8, b, y0 + L, -0.8,
      a, y1, -0.8, a + L, y1, -0.8, a, y1, -0.8, a, y1 - L, -0.8, b, y1, -0.8, b - L, y1, -0.8, b, y1, -0.8, b, y1 - L, -0.8];
    root.add(lineSeg(new Float32Array(br), holo.line(pal.b, { alpha: 0.8, glow: 1.6 })));
  }

  // ---- bar region: 0-100% gridlines + axis labels ----
  {
    const g = [];
    for (let k = 0; k <= 4; k++) {
      const x = T0 + (TW * k) / 4;
      g.push(x, Y_BAR_BOT - 0.4, -0.3, x, Y_BAR_TOP + 0.3, -0.3);
      const al = holo.label(`${k * 25}%`, { w: 256, h: 96, height: 1.3, font: '700 72px Rajdhani', color: '#e4eaff', glow: pal.hexB });
      al.sprite.position.set(x, Y_AXIS, 0.3); al.yFrac = yOfFrac(Y_AXIS); al.bright = 0.9;
    }
    root.add(lineSeg(new Float32Array(g), holo.line(COL.white, { alpha: 0.2 })));
    const base = [T0, Y_BAR_BOT - 0.4, -0.3, T0 + TW, Y_BAR_BOT - 0.4, -0.3];
    root.add(lineSeg(new Float32Array(base), holo.line(pal.b, { alpha: 0.55 })));
  }

  // ---- one row per market ----
  const pitch = single ? 0 : Math.min(3.4, (Y_BAR_TOP - Y_BAR_BOT) / n);
  const rows = ordered.map((m, i) => {
    const p = clamp01(m.yesPrice ?? 0.5);
    const d = Number.isFinite(m.change1d) ? m.change1d : 0;
    const pts = Math.round(Math.abs(d) * 100);
    const was = clamp01(p - d);
    const yc = single ? (Y_BAR_TOP + Y_BAR_BOT) / 2 : Y_BAR_TOP - pitch * (i + 0.5);
    const th = single ? 3.4 : Math.min(2.0, pitch * 0.58);
    const idx = Math.max(0, all.indexOf(m));
    const hex = single ? pal.hexA : OUTCOME_COLORS[idx % OUTCOME_COLORS.length];
    const col = new THREE.Color(hex);
    const name = single ? 'YES' : String(m.outcome || m.label || m.title || '').toUpperCase();
    const nl = holo.label(name, single
      ? { w: 1024, h: 192, height: 2.3, font: '900 110px Orbitron', color: '#ffffff', glow: hex, align: 'right', sub: 'ODDS IT HAPPENS', subColor: '#cfd8ff', subFont: '700 62px Rajdhani' }
      : { w: 896, h: 128, height: 1.7, font: name.length > 14 ? '700 104px Rajdhani' : '800 78px Orbitron', color: '#ffffff', glow: hex, align: 'right' });
    nl.sprite.position.set(NAME_R, yc, 0.9); nl.yFrac = yOfFrac(yc); nl.bright = 1;

    const track = add(new THREE.Mesh(BOX, holo.mat(col, { flat: 1, alpha: 0.13, glow: 1, depthWrite: false, blending: THREE.AdditiveBlending })), T0, yc, -0.1, TW, th, 0.1);
    const bar = add(new THREE.Mesh(BOX, holo.mat(col, { flat: 1, alpha: 0.9, glow: 0.95 })), T0, yc, 0, 0.001, th, 0.6);
    const head = add(new THREE.Mesh(BOX, holo.mat(col.clone().lerp(COL.white, 0.55), { flat: 1, glow: 1.0 })), T0, yc, 0.15, 0.2, th * 1.1, 0.7);

    const pl = holo.label('0%', { w: 512, h: 128, height: single ? 2.6 : 1.9, font: `900 ${single ? 110 : 96}px Orbitron`, color: '#ffffff', glow: hex, align: 'left' });
    pl.sprite.position.set(T0 + 0.6, yc, 0.9); pl.yFrac = yOfFrac(yc); pl.bright = 0;

    const col2 = pts === 0 ? FLAT : d > 0 ? UP : DOWN;
    const cl = holo.label(pts === 0 ? 'FLAT TODAY' : `${d > 0 ? '▲' : '▼'} ${pts} ${pts === 1 ? 'PT' : 'PTS'} TODAY`, { w: 640, h: 128, height: 1.4, font: '800 90px Rajdhani', color: col2, glow: col2, align: 'left' });
    cl.sprite.position.set(CHIP_X, yc, 0.9); cl.yFrac = yOfFrac(yc); cl.bright = 0;

    // yesterday: a gold tick through the bar, and a green/red segment from yesterday to now
    let tick = null, seg = null, wasLbl = null;
    const xWas = T0 + TW * was, xNow = T0 + TW * p;
    if (pts >= 1) {
      tick = add(new THREE.Mesh(BOX, holo.mat(COL.gold, { flat: 1, glow: 1.15 })), xWas - 0.09, yc, 0.8, 0.18, th * 1.55, 0.2);
      seg = add(new THREE.Mesh(BOX, holo.mat(new THREE.Color(d > 0 ? UP : DOWN), { flat: 1, alpha: 0.9, glow: 1.0, side: THREE.DoubleSide })), xWas, yc, 0.6, 0.001, th * 0.46, 0.35);
      if (single) {
        wasLbl = holo.label(`WAS ${Math.round(was * 100)}%`, { w: 512, h: 128, height: 1.2, font: '800 78px Orbitron', color: '#ffe27a', glow: GOLD });
        wasLbl.sprite.position.set(xWas, yc + th / 2 + 1.1, 0.9); wasLbl.yFrac = yOfFrac(yc); wasLbl.bright = 0;
      }
    }
    return { m, p, d, was, yc, th, nl, track, bar, head, pl, cl, tick, seg, wasLbl, xWas, xNow, t0: 0.55 + i * 0.4, lastTxt: '0%' };
  });

  // ---- the fuse: time to the close ----
  const closeMs = lead.closesAt ? new Date(lead.closesAt).getTime() : NaN;
  const hasClose = Number.isFinite(closeMs);
  const createdMs = lead.createdAt ? Date.parse(lead.createdAt) : NaN;
  const life = closeMs - createdMs;
  const lifeMode = hasClose && Number.isFinite(createdMs) && life > 3600e3 && life <= 45 * 86400e3 && createdMs < now;
  let markFrac = 1, ticks = [];
  if (lifeMode) {
    markFrac = clamp01((now - createdMs) / life);
    ticks = [[0, `OPENED ${spanText(now - createdMs)} AGO`], [0.25, ''], [0.5, ''], [0.75, ''], [1, 'CLOSES']];
  } else {
    const days = hasClose ? Math.max(0, closeMs - now) / 86400e3 : 30;
    const maxD = days <= 2 ? 2 : days <= 7 ? 7 : 30;
    markFrac = clamp01(days / maxD);
    if (maxD === 2) ticks = [[0, 'NOW'], [0.25, '12 HRS'], [0.5, '24 HRS'], [0.75, '36 HRS'], [1, '48 HRS']];
    else if (maxD === 7) ticks = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k / 7, k === 0 ? 'NOW' : `${k} ${k === 1 ? 'DAY' : 'DAYS'}`]);
    else ticks = [[0, 'NOW'], [7 / 30, '1 WEEK'], [14 / 30, '2 WEEKS'], [21 / 30, '3 WEEKS'], [1, days > 30 ? '30+ DAYS' : '30 DAYS']];
  }
  const markX = X0 + (X1 - X0) * markFrac;
  const fuseDim = add(new THREE.Mesh(BOX, holo.mat(pal.b, { flat: 1, alpha: 0.38, glow: 1.2 })), X0, Y_FUSE, 0, X1 - X0, 0.22, 0.25);
  const fuseLit = add(new THREE.Mesh(BOX, holo.mat(pal.a, { flat: 1, alpha: 0.95, glow: 1.6 })), X0, Y_FUSE, 0.1, 0.001, 0.4, 0.35);
  {
    const tk = [];
    for (const [f, txt] of ticks) {
      const x = X0 + (X1 - X0) * f;
      tk.push(x, Y_FUSE - 0.45, 0.1, x, Y_FUSE + 0.45, 0.1);
      if (!txt) continue;
      const al = f === 0 ? 'left' : f === 1 ? 'right' : 'center';
      const l = holo.label(txt, { w: 512, h: 96, height: 1.3, font: '700 72px Rajdhani', color: '#e4eaff', glow: pal.hexB, align: al });
      l.sprite.position.set(f === 0 ? x - 0.2 : f === 1 ? x + 0.2 : x, Y_FUSE_LBL, 0.3); l.yFrac = yOfFrac(Y_FUSE_LBL); l.bright = 0.9;
    }
    root.add(lineSeg(new Float32Array(tk), holo.line(COL.white, { alpha: 0.5 })));
  }
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), holo.mat(COL.white, { flat: 1, glow: 1.25 }));
  marker.position.set(X1, Y_FUSE, 0.5); root.add(marker);
  const beat = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), holo.mat(pal.a, { flat: 1, alpha: 0.6, glow: 1.2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beat.position.copy(marker.position); root.add(beat);
  const ping = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), holo.mat(COL.white, { flat: 1, alpha: 0.7, glow: 1.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  ping.position.copy(marker.position); ping.scale.setScalar(0.001); root.add(ping);
  marker.visible = beat.visible = hasClose;

  const titleTxt = hasClose ? closeText(closeMs - now) : 'CLOSE DATE NOT SET';
  const title = holo.label(titleTxt, { w: 2048, h: 160, height: 2.1, font: '900 108px Orbitron', color: '#ffffff', glow: pal.hexA, align: 'left' });
  title.sprite.position.set(X0 - 0.4, Y_TITLE, 0.9); title.yFrac = yOfFrac(Y_TITLE); title.bright = 1;
  if (hasClose) {
    const rt = holo.label(etClose(closeMs, now), { w: 1024, h: 192, height: 2.4, font: '900 100px Orbitron', color: '#ffe27a', glow: GOLD, align: 'right', sub: 'RESOLVES', subColor: '#cfd8ff', subFont: '700 60px Rajdhani', mainY: 0.4, subY: 0.82 });
    rt.sprite.position.set(X1 + 0.4, Y_TITLE, 0.9); rt.yFrac = yOfFrac(Y_TITLE); rt.bright = 1;
  }

  // ---- chips + footer ----
  if (!single) {
    const chip = holo.label(exclusive ? 'OUTCOMES ADD TO 100%' : 'EACH LINE IS A SEPARATE QUESTION', { w: 1280, h: 128, height: 1.5, font: '800 80px Rajdhani', color: exclusive ? '#9ff6ff' : '#ffe27a', glow: exclusive ? pal.hexB : GOLD, align: 'right' });
    chip.sprite.position.set(X1 + 0.4, Y_FOOT, 0.9); chip.yFrac = yOfFrac(Y_FOOT); chip.bright = 1;
  } else if (rows[0].tick) {
    const chip = holo.label('GOLD TICK = YESTERDAY', { w: 1024, h: 128, height: 1.5, font: '800 80px Rajdhani', color: '#ffe27a', glow: GOLD, align: 'right' });
    chip.sprite.position.set(X1 + 0.4, Y_FOOT, 0.9); chip.yFrac = yOfFrac(Y_FOOT); chip.bright = 1;
  }
  {
    const srcs = (story.sources && story.sources.length ? story.sources : [lead.source]).filter(Boolean);
    const vol = (story.sourceVolumes || []).length ? story.sourceVolumes.reduce((s, x) => s + (x.volume24h || 0), 0) : Math.max(...all.map((m) => m.volume24h || 0), 0);
    const parts = [srcs.map(exchangeName).join(' + '), lead.updatedAt ? `updated ${ago(lead.updatedAt, now)}` : null, `${money(vol)} traded in 24 hrs`].filter(Boolean);
    const ft = holo.label(parts.join(' · ').toUpperCase(), { w: 1792, h: 128, height: 1.5, font: '700 68px Rajdhani', color: '#e4eaff', glow: pal.hexB, align: 'left' });
    ft.sprite.position.set(X0 - 0.4, Y_FOOT, 0.9); ft.yFrac = yOfFrac(Y_FOOT); ft.bright = 1;
    if (story.thin) {
      const th = holo.label('THIN MARKET', { w: 512, h: 128, height: 1.4, font: '900 70px Orbitron', color: '#ffab2e', glow: '#ffab2e', align: 'left' });
      th.sprite.position.set(1.6, Y_FOOT, 0.9); th.yFrac = yOfFrac(Y_FOOT); th.bright = 1;
    }
  }

  // ---- floor: a subtle radar sweep ----
  const sweepR = 17;
  const sweep = new THREE.Mesh(new THREE.CircleGeometry(sweepR, 72), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { ...reveal.uniforms(), uColor: { value: pal.a.clone() }, uSpeed: { value: 0.5 } },
    vertexShader: `varying vec2 vL; varying vec3 vW; void main(){ vL = position.xy; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uSpeed; varying vec2 vL;
      ${reveal.glsl}
      void main(){ float rv; float scan = revealScan(rv);
        float ang = atan(vL.y, vL.x); float r = length(vL) / ${sweepR.toFixed(1)};
        float trail = pow(max(fract((ang) / 6.2831853 - uTime * uSpeed), 1e-4), 5.0);
        float a = trail * smoothstep(1.0, 0.2, r) * 0.14 + exp(-abs(r - 0.98) * 70.0) * 0.07;
        gl_FragColor = vec4(uColor * a * uFade, 1.0); }`,
  }));
  holo.reg(sweep.material);
  sweep.rotation.x = -Math.PI / 2; sweep.position.y = 0.06; root.add(sweep);

  // ---- animation ----
  const T_MARK0 = 1.0, T_MARK1 = 2.8;
  let pinged = false, pingT = -1, curTitle = titleTxt, emitAcc = 0, titleAcc = 0;
  const _v = new THREE.Vector3();
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    const ts = this.tShow;
    // bars grow in rank order, % counts up; then yesterday's tick + the move segment + the change chip
    for (const r of rows) {
      const k = ease.out(clamp01((ts - r.t0) / 1.15));
      const w = Math.max(0.001, TW * r.p * k);
      r.bar.scale.x = w;
      r.head.position.x = T0 + w - 0.14; r.head.visible = k > 0.01;
      const txt = `${Math.round(r.p * 100 * k)}%`;
      if (txt !== r.lastTxt) { r.lastTxt = txt; r.pl.set(txt); }
      r.pl.sprite.position.x = T0 + w + 0.6;
      r.pl.bright = k > 0.02 ? 1 : 0;
      const k2 = ease.out(clamp01((ts - r.t0 - 1.1) / 0.7));
      r.cl.bright = k2 > 0.05 ? 1 : 0;
      if (r.tick) {
        r.tick.scale.y = Math.max(0.001, r.th * 1.55 * k2);
        r.seg.scale.x = Math.max(0.001, (r.xNow - r.xWas) * k2);
        r.seg.material.uniforms.uPulse.value = k2 >= 1 ? 0.05 + 0.05 * Math.sin(t * 3.2) : 0;
        if (r.wasLbl) r.wasLbl.bright = k2 > 0.3 ? 1 : 0;
      }
    }
    // fuse marker slides in from the far end, burning the fuse behind it
    const km = ease.inOut(clamp01((ts - T_MARK0) / (T_MARK1 - T_MARK0)));
    const mx = X1 + (markX - X1) * km;
    marker.position.x = mx; beat.position.x = mx; ping.position.x = mx;
    fuseLit.scale.x = Math.max(0.001, mx - X0);
    const sliding = ts >= T_MARK0 && ts < T_MARK1;
    const on = clamp01((ts - 0.6) * 3);
    const pulse = Math.pow(1 - (t % 1), 6);            // once per second: the marker flashes and a ring leaves it
    marker.scale.setScalar(on * (1 + 0.55 * pulse)); marker.rotation.y = t * 1.6;
    marker.material.uniforms.uPulse.value = 0.25 * pulse;
    const bk = t % 1;
    beat.scale.setScalar(0.6 + bk * 1.4);
    beat.material.uniforms.uFade.value = (1 - bk) * this.fade * on * (ts > T_MARK1 ? 1 : 0.4);
    if (!pinged && ts >= T_MARK1) { pinged = true; pingT = 0; }
    if (pingT >= 0) {
      pingT += dt; const pk = pingT / 1.1;
      ping.scale.setScalar(0.5 + pk * 4.0);
      ping.material.uniforms.uFade.value = Math.max(0, 1 - pk) * this.fade;
      if (pk >= 1) { pingT = -1; ping.scale.setScalar(0.001); }
    }
    // title ticks down live (minutes granular; seconds in the last hour)
    titleAcc += dt;
    if (hasClose && titleAcc > 0.5) {
      titleAcc = 0;
      const s = closeText(closeMs - Date.now());
      if (s !== curTitle) { curTitle = s; title.set(s); }
    }
    // sparks off the burning end
    emitAcc += dt;
    if (this.visible && hasClose) {
      if (sliding && emitAcc > 0.06) { emitAcc = 0; _v.copy(marker.position); fx.stream(root.localToWorld(_v), pal.a, 4, new THREE.Vector3(0, 1, 0), { speed: 2.4, lifeS: 1.0, sz: 0.65 }); }
      else if (!sliding && ts > T_MARK1 && emitAcc > 0.7) { emitAcc = 0; _v.copy(marker.position); fx.stream(root.localToWorld(_v), pal.a, 3, new THREE.Vector3(0, 1, 0), { speed: 1.6, lifeS: 1.4, sz: 0.6 }); }
    }
    root.rotation.y = Math.sin(t * 0.14) * 0.06;
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, 10.1, 0));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(-2, 2, 44)), orbit: 0.07, box: boxAt(this.station, X0 - 1.6, -0.2, -1.5, X1 + 1.6, 20.4, 2.5) };
  };
  return holo;
}
