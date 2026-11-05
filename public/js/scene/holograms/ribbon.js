// RIBBON: the lead market's price history as a glowing 3D ribbon with echo ridges behind it, a grid and a beacon on the current price.
// With >= 8 history points it becomes a PRICE REPLAY: the ribbon scans in, rewinds, and a glowing tracer redraws the last 24h over ~3s
// (camera follows via holo.camFocus), pulsing a marker where each wire headline (story.newsMarks) landed, with ghost lines at the 1h-ago
// and 24h-ago levels, and ends on the live price.
import * as THREE from '../../../vendor/three/three.module.js';
import { Holo, COL, clamp01, pctText, ptsText, boxAt, reveal } from '../holo.js';
import { lineSeg, lineStrip } from './parts.js';

export function createRibbon(ctx, story, opts = {}) {
  const { pal, rnd, fx } = ctx;
  const lead = story.lead || story.markets?.[0] || { yesPrice: 0.5 };
  const L = 40, H = 13, Y0 = 1.8;
  const holo = new Holo(ctx, { axis: 'x', width: L + 4, height: Y0 + H + 4 });
  holo.revealDur = 2.2;
  const root = holo.root;

  // ---- history -> evenly sampled points ----
  let hist = Array.isArray(story.history) ? story.history.filter((h) => h && Number.isFinite(h.t) && Number.isFinite(h.p)) : [];
  const nowS = Date.now() / 1000;
  const replay = hist.length >= 8;
  if (hist.length < 3) {
    const v = clamp01(lead.yesPrice ?? 0.5);
    hist = [{ t: nowS - 7 * 86400, p: clamp01(v - (lead.change1w || 0)) }, { t: nowS - 86400, p: clamp01(v - (lead.change1d || 0)) }, { t: nowS, p: v }];
  }
  hist.sort((a, b) => a.t - b.t);
  if (replay) holo.revealDur = 1.4;
  if (replay) {   // replay the last 24h when the series is longer and still dense enough
    const win = hist.filter((h) => h.t >= hist[hist.length - 1].t - 86400);
    if (win.length >= 8) hist = win;
  }
  const t0 = hist[0].t, t1 = hist[hist.length - 1].t, span = Math.max(1, t1 - t0);
  // auto-scaled y axis: the ribbon's own range (plus padding) fills the height, like a chart
  const pMin = Math.min(...hist.map((h) => h.p)), pMax = Math.max(...hist.map((h) => h.p));
  const pad = Math.max(0.03, (pMax - pMin) * 0.3);
  const lo = Math.max(0, pMin - pad), hi = Math.min(1, pMax + pad);
  const yOf = (p) => Y0 + ((clamp01(p) - lo) / Math.max(0.01, hi - lo)) * H;
  const N = 140, pts = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const tt = t0 + (span * i) / (N - 1);
    while (j < hist.length - 2 && hist[j + 1].t < tt) j++;
    const a = hist[j], b = hist[Math.min(hist.length - 1, j + 1)];
    const f = b.t === a.t ? 0 : clamp01((tt - a.t) / (b.t - a.t));
    const p = clamp01(a.p + (b.p - a.p) * f);
    pts.push(new THREE.Vector3(-L / 2 + (L * i) / (N - 1), yOf(p), 0));
  }
  const last = pts[pts.length - 1], first = pts[0];

  // ---- the ribbon: tube + area fill ----
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 300, 0.17, 8, false), holo.mat(pal.a, { flat: 1, glow: 1.7 }));
  root.add(tube);
  let fillMesh = null;
  {
    const pos = new Float32Array(N * 2 * 3), av = new Float32Array(N * 2), idx = [];
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      pos.set([p.x, Y0 - 0.6, 0], i * 6); pos.set([p.x, p.y, 0], i * 6 + 3); av[i * 2] = 0; av[i * 2 + 1] = 1;
      if (i < N - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aV', new THREE.BufferAttribute(av, 1)); g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { ...reveal.uniforms(), uColor: { value: pal.b.clone() }, uColor2: { value: pal.a.clone() } },
      vertexShader: `attribute float aV; varying float vV; varying vec3 vW; void main(){ vV = aV; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uColor; uniform vec3 uColor2; varying float vV;
        ${reveal.glsl}
        void main(){ float rv; float scan = revealScan(rv);
          float lines = 0.75 + 0.25 * sin(vW.y * 14.0 + uTime * 1.5);
          float cols = 0.9 + 0.1 * sin(vW.x * 2.0 - uTime * 3.0);
          float a = mix(0.05, 0.8, pow(max(vV, 1e-4), 1.5)) * lines * cols;
          gl_FragColor = vec4(mix(uColor, uColor2, vV) * (a + scan * 0.8) * uFade, 1.0); }`,
    });
    holo.reg(m);
    fillMesh = new THREE.Mesh(g, m);
    root.add(fillMesh);
  }
  // echo ridges behind (and one faint in front)
  const echoLines = [];
  const echoes = 3 + Math.floor(rnd() * 2);
  for (let k = 1; k <= echoes; k++) {
    const sc = 1 - k * 0.05;
    const ep = pts.map((p) => new THREE.Vector3(p.x, Y0 + (p.y - Y0) * sc, -k * 1.9));
    const ln = lineStrip(ep, holo.line(pal.b, { alpha: 0.8 / k, glow: 1.6 })); root.add(ln); echoLines.push(ln);
  }
  { const ln = lineStrip(pts.map((p) => new THREE.Vector3(p.x, Y0 + (p.y - Y0) * 0.97, 1.6)), holo.line(pal.a, { alpha: 0.18 })); root.add(ln); echoLines.push(ln); }

  // ---- grid: day boundaries, 50% line, frame ----
  {
    const arr = [];
    const dayS = 86400;
    let step = dayS;
    if (replay && span <= 1.6 * dayS) step = 6 * 3600;
    if (span > 16 * dayS) step = 7 * dayS;
    if (span > 120 * dayS) step = 30 * dayS;
    const startDay = Math.ceil(t0 / step) * step;
    for (let tt = startDay; tt <= t1; tt += step) {
      const x = -L / 2 + (L * (tt - t0)) / span;
      arr.push(x, 0.05, -echoes * 1.9 - 1, x, 0.05, 2, x, 0.05, 0.3, x, Y0 + H + 1, 0.3);
    }
    if (arr.length) root.add(lineSeg(new Float32Array(arr), holo.line(pal.b, { alpha: 0.16 })));
    // horizontal gridlines at round percentages inside the visible range, with tiny axis labels on the left
    const pStep = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5].find((st) => (hi - lo) / st <= 6) || 0.5;
    const hl = [];
    for (let p = Math.ceil(lo / pStep) * pStep; p <= hi + 1e-9; p += pStep) {
      const y = yOf(p);
      hl.push(-L / 2 - 1, y, 0.2, L / 2 + 1, y, 0.2);
      const al = holo.label(pctText(p), { w: 256, h: 128, height: 2.3, font: '800 92px Rajdhani', color: '#f4f7ff', glow: pal.hexB, align: 'right' });
      al.sprite.position.set(-L / 2 - 1.1, y, 0.3); al.yFrac = 0.02;
    }
    root.add(lineSeg(new Float32Array(hl), holo.line(COL.white, { alpha: 0.16 })));
    // floor frame
    const z0 = -echoes * 1.9 - 1, z1 = 2;
    const fr = [-L / 2 - 1, 0.05, z0, L / 2 + 1, 0.05, z0, L / 2 + 1, 0.05, z0, L / 2 + 1, 0.05, z1, L / 2 + 1, 0.05, z1, -L / 2 - 1, 0.05, z1, -L / 2 - 1, 0.05, z1, -L / 2 - 1, 0.05, z0];
    root.add(lineSeg(new Float32Array(fr), holo.line(pal.a, { alpha: 0.5 })));
  }

  // ---- current price beacon ----
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 12), holo.mat(COL.white, { flat: 1, glow: 1.8 }));
  beacon.position.copy(last); root.add(beacon);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, last.y, 6, 1, true), holo.mat(pal.a, { flat: 1, alpha: 0.6, glow: 1.6, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.set(last.x, last.y / 2, 0); root.add(beam);
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const rg = new THREE.RingGeometry(0.9, 1, 40);
    const r = new THREE.Mesh(rg, holo.mat(pal.a, { flat: 1, alpha: 0.8, glow: 1.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    r.position.copy(last); r.userData.phase = i / 2; root.add(r); rings.push(r);
  }
  const delta = (lead.change1d || 0);
  const lblNow = holo.label(pctText(lead.yesPrice ?? last.y), { w: 900, h: 350, height: 4.1, font: '900 150px Orbitron', color: '#ffffff', glow: pal.hexA, sub: ptsText(delta), subColor: delta >= 0 ? '#3dff8a' : '#ff2e55', subFont: '800 118px Rajdhani', mainY: 0.3, subY: 0.8, plate: true });
  lblNow.sprite.position.set(last.x - 2.5, Math.min(Y0 + H + 3.2, last.y + 3.8), 0.5); lblNow.yFrac = 0.96;
  const lblStart = holo.label(pctText(hist[0].p), { w: 512, h: 256, height: 2.5, font: '700 120px Orbitron', color: '#dfe8ff', glow: pal.hexB, sub: spanLabel(span), subColor: '#cfe8ff', subFont: '700 82px Rajdhani', mainY: 0.34, subY: 0.8 });
  lblStart.sprite.position.set(first.x + 2.2, first.y + 3.0, 0.5); lblStart.yFrac = 0.04;
  // what is measured: the lead outcome (or the question) as a chip over the top-left of the chart
  {
    const evt = String(story.eventTitle || story.headline || lead.title || '').replace(/\s+/g, ' ').trim();
    const oc = String(lead.outcome || '').trim();
    const useOc = oc && !/^(yes|no)$/i.test(oc) && oc.toUpperCase() !== evt.toUpperCase();
    const main = (useOc ? oc : evt || 'THE CHANCE').toUpperCase(), sub = useOc ? evt.toUpperCase() : 'CHANCE OF YES';
    const tl = holo.label(main, { w: 1600, h: 230, height: 4.4, font: '900 88px Orbitron', color: '#ffffff', glow: pal.hexA, sub, subColor: '#eef3ff', subFont: '700 84px Rajdhani', align: 'left', mainY: 0.3, subY: 0.77 });
    tl.sprite.position.set(-L / 2 - 1.6, Y0 + H + 4.6, 0.5); tl.yFrac = 0.98;
    // a zoomed axis must say so, or a 6-point wobble reads like a landslide
    if (hi - lo < 0.4) {
      const zl = holo.label(`ZOOMED IN: ${Math.round(lo * 100)}-${Math.round(hi * 100)}% SHOWN`, { w: 768, h: 96, height: 1.35, font: '700 66px Rajdhani', color: '#ffe28a', glow: '#ffd23f', align: 'left' });
      zl.sprite.position.set(-L / 2 - 0.6, Y0 + H + 1.3, 0.4); zl.yFrac = 0.9;
    }
    const vol = Number(lead.volume24h), vtxt = !Number.isFinite(vol) || vol <= 0 ? '' : vol >= 1e6 ? `$${(vol / 1e6).toFixed(1).replace(/\.0$/, '')}M` : vol >= 1e3 ? `$${Math.round(vol / 1e3)}K` : `$${Math.round(vol)}`;
    const thin = !!story.thin;
    const ft = holo.label(`${lead.source === 'kalshi' ? 'KALSHI' : 'POLYMARKET'}${vtxt ? ` · ${vtxt} TRADED TODAY` : ''}${thin ? ' · THIN MARKET' : ''}`, { w: 1400, h: 112, height: 1.45, font: '700 74px Rajdhani', color: thin ? '#ffab2e' : '#eef3ff', glow: thin ? '#ffab2e' : pal.hexB });
    ft.sprite.position.set(0, -1.1, 2.4); ft.yFrac = 0.02;
  }
  // high / low markers
  if (!replay && pMax - pMin > 0.03) {
    const iMax = pts.reduce((b, p, i) => (p.y > pts[b].y ? i : b), 0), iMin = pts.reduce((b, p, i) => (p.y < pts[b].y ? i : b), 0);
    for (const [i, txt, up] of [[iMax, 'HIGH', 1], [iMin, 'LOW', -1]]) {
      if (i === N - 1 || i === 0) continue;
      const l = holo.label(pctText(lo + ((pts[i].y - Y0) / H) * (hi - lo)), { w: 384, h: 192, height: 1.1, font: '700 100px Orbitron', color: '#ffffff', glow: pal.hexB, sub: txt, subColor: pal.hexB, subFont: '600 64px Rajdhani' });
      l.sprite.position.set(pts[i].x, pts[i].y + up * 1.4, 0.5); l.yFrac = clamp01((pts[i].x + L / 2) / (L + 4));
      const mk = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), holo.mat(pal.b, { flat: 1, glow: 1.6 })); mk.position.copy(pts[i]); root.add(mk);
    }
  }

  // ---- price replay (tracer, ghost lines, news markers) ----
  const TUBE_SEGS = 300, TUBE_IDX = 8 * 6;
  let headAt = null, marks = [], rp = null;
  if (replay) {
    const cum = [0];
    for (let i = 1; i < N; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = Math.max(1e-6, cum[N - 1]);
    const arcAt = (sx) => { const f = Math.min(1, Math.max(0, sx)) * (N - 1), i = Math.min(N - 2, Math.floor(f)), u = f - i; return (cum[i] + (cum[i + 1] - cum[i]) * u) / total; };
    const tmp = new THREE.Vector3();
    headAt = (sx) => curve.getPointAt(arcAt(sx), tmp);
    rp = { arcAt, head: new THREE.Vector3(last.x, last.y, 0), sx: 1, emit: 0 };
    // ghost lines: where the price stood 24h ago (window start) and 1h ago
    const pAt = (tt) => { let k = 0; while (k < hist.length - 2 && hist[k + 1].t < tt) k++; const a = hist[k], b = hist[k + 1]; return clamp01(a.p + (b.p - a.p) * clamp01((tt - a.t) / Math.max(1, b.t - a.t))); };
    const ghostLine = (y, color, alpha) => root.add(lineSeg(new Float32Array([-L / 2 - 1, y, 0.35, L / 2 + 1, y, 0.35]), holo.line(color, { alpha, glow: 1.4 })));
    ghostLine(first.y, pal.b, 0.55);
    if (span >= 5400) {
      const p1h = pAt(t1 - 3600), y1h = yOf(p1h);
      ghostLine(y1h, COL.gold, 0.6);
      const gl = holo.label(`1H AGO ${pctText(p1h)}`, { w: 640, h: 128, height: 1.9, font: '900 84px Orbitron', color: '#fff0a8', glow: '#ffd23f' });
      gl.sprite.position.set(L / 2 - 11, y1h + (y1h <= last.y ? -1.2 : 1.2), 0.4); gl.yFrac = 0.5;
    }
    // news markers: a pulsing diamond on the curve where each wire headline landed
    const nm = (Array.isArray(story.newsMarks) ? story.newsMarks : []).filter((m) => m && Number.isFinite(m.t) && m.t >= t0 && m.t <= t1 + 900).sort((a, b) => a.t - b.t).slice(-5);
    nm.forEach((m, i) => {
      const sx = Math.min(1, (m.t - t0) / span), x = -L / 2 + L * sx, y = pts[Math.round(sx * (N - 1))].y;
      const dm = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), holo.mat(COL.gold, { flat: 1, glow: 2 })); dm.position.set(x, y, 0.3); root.add(dm);
      const rg = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), holo.mat(COL.gold, { flat: 1, alpha: 0.9, glow: 2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); rg.position.set(x, y, 0.3); rg.scale.setScalar(0.001); root.add(rg);
      const ly = Y0 + 1.1 + (i % 2) * 2.0;
      root.add(lineSeg(new Float32Array([x, ly + 0.5, 0.3, x, y, 0.3]), holo.line(COL.gold, { alpha: 0.45 })));
      const ago = Math.max(0, (t1 - m.t) / 3600);
      const lb = holo.label(String(m.outlet || 'NEWS').toUpperCase(), { w: 512, h: 210, height: 2.5, font: '900 84px Orbitron', color: '#fff3c4', glow: '#ffd23f', mainY: 0.34, subY: 0.8, sub: ago < 1 ? `${Math.max(1, Math.round(ago * 60))} MIN AGO` : `${Math.round(ago)}H AGO`, subColor: '#ffd23f', subFont: '700 78px Rajdhani' });
      lb.sprite.position.set(x, ly, 0.5); lb.yFrac = 0.3; lb.bright = 0;
      marks.push({ x, dm, rg, lb, passed: true, pulse: -1 });
    });
  }
  const setDraw = (sx) => {
    const u = rp.arcAt(sx);
    tube.geometry.setDrawRange(0, Math.floor(u * TUBE_SEGS) * TUBE_IDX);
    if (fillMesh) fillMesh.geometry.setDrawRange(0, Math.floor(sx * (N - 1)) * 6);
    const n = Math.floor(sx * N);
    for (const ln of echoLines) ln.geometry.setDrawRange(0, n);
  };
  const T_REW0 = 1.5, T_REW1 = 2.1, T_PLAY0 = 2.2, T_PLAY1 = 5.2;
  const inOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

  let emitAcc = 0;
  holo.tick = function (dt, t) {
    this.baseTick(dt);
    if (replay) {
      const ts = this.tShow;
      const sx = ts < T_REW0 ? 1 : ts < T_REW1 ? 1 - inOut((ts - T_REW0) / (T_REW1 - T_REW0)) : ts < T_PLAY0 ? 0 : ts < T_PLAY1 ? (ts - T_PLAY0) / (T_PLAY1 - T_PLAY0) : 1;
      rp.sx = sx;
      setDraw(sx);
      const hd = headAt(sx); rp.head.copy(hd);
      const on = clamp01((ts - 0.9) * 2);
      const running = ts >= T_REW0 && ts < T_PLAY1;
      beacon.position.copy(hd); beacon.scale.setScalar(on * (running ? 1.35 : 1 + 0.15 * Math.sin(t * 5)));
      beacon.material.uniforms.uFade.value = this.fade * on;
      beam.position.set(hd.x, hd.y / 2, 0); beam.scale.y = Math.max(0.01, hd.y / last.y);
      beam.material.uniforms.uFade.value = this.fade * on * (running ? 1 : 0.6 + 0.4 * Math.sin(t * 3));
      for (const r of rings) { const k = (t * 0.7 + r.userData.phase) % 1; r.position.copy(hd); r.scale.setScalar(0.5 + k * 3.5); r.material.uniforms.uFade.value = (1 - k) * this.fade * on; r.rotation.y = t * 0.5; }
      lblNow.bright = ts < T_REW0 ? 1 : ts >= T_PLAY1 ? clamp01((ts - T_PLAY1) * 2.5) : 0;
      for (const m of marks) {
        const passed = hd.x >= m.x - 0.01;
        if (passed && !m.passed && ts >= T_PLAY0) m.pulse = 0;
        m.passed = passed;
        m.dm.scale.setScalar(passed ? 1 + 0.12 * Math.sin(t * 4) : 0.001);
        m.lb.bright = passed ? 1 : 0;
        if (m.pulse >= 0) { m.pulse += dt; const k = m.pulse / 1.0; m.rg.scale.setScalar(0.3 + k * 3.5); m.rg.material.uniforms.uFade.value = Math.max(0, 1 - k) * this.fade; if (k >= 1) { m.pulse = -1; m.rg.scale.setScalar(0.001); } }
      }
      // camera follows the tracer, then pulls back to the whole 24h path
      this.camFocus = ts >= 1.9 && ts < T_PLAY1 + 0.3 ? { dx: hd.x, dy: (hd.y - (Y0 + H * 0.45)) * 0.7, zoom: 0.62 } : null;
      root.rotation.y = Math.sin(t * 0.15) * 0.05;
      emitAcc += dt;
      if (this.visible && running && emitAcc > 0.07) { emitAcc = 0; fx.stream(root.localToWorld(hd.clone()), pal.a, 4, new THREE.Vector3(0, 1, 0), { speed: 2.2, lifeS: 1.2, sz: 0.7 }); }
      else if (this.visible && !running && ts > T_PLAY1 && emitAcc > 0.5) { emitAcc = 0; fx.stream(root.localToWorld(last.clone()), pal.a, 5, new THREE.Vector3(0, 1, 0), { speed: 1.5, lifeS: 1.8, sz: 0.7 }); }
      return;
    }
    const on = clamp01((this.tShow - 2.0) * 1.5);
    beacon.scale.setScalar(on * (1 + 0.15 * Math.sin(t * 5)));
    beacon.material.uniforms.uFade.value = this.fade * on;
    beam.material.uniforms.uFade.value = this.fade * on * (0.6 + 0.4 * Math.sin(t * 3));
    for (const r of rings) { const k = (t * 0.7 + r.userData.phase) % 1; r.scale.setScalar(0.5 + k * 3.5); r.material.uniforms.uFade.value = (1 - k) * this.fade * on; r.rotation.y = t * 0.5; }
    root.rotation.y = Math.sin(t * 0.15) * 0.05;
    emitAcc += dt;
    if (this.visible && on > 0.9 && emitAcc > 0.5) { emitAcc = 0; fx.stream(root.localToWorld(last.clone()), pal.a, 5, new THREE.Vector3(0, 1, 0), { speed: 1.5, lifeS: 1.8, sz: 0.7 }); }
  };
  holo.pose = function () {
    const tgt = this.station.clone().add(new THREE.Vector3(0, Y0 + H * 0.45, -2));
    return { target: tgt, position: tgt.clone().add(new THREE.Vector3(-3, 2.5, 44)), orbit: 0.07, box: boxAt(this.station, -L / 2 - 4.6, -2, -echoes * 1.9 - 1.5, L / 2 + 2, Y0 + H + 7.0, 2.5) };
  };
  return holo;
}

function spanLabel(spanS) {
  const d = spanS / 86400;
  if (d < 1.5) return `${Math.max(1, Math.round(spanS / 3600))} HOURS AGO`;
  if (d < 13) return `${Math.round(d)} DAYS AGO`;
  if (d < 60) return `${Math.round(d / 7)} WEEKS AGO`;
  return `${Math.round(d / 30)} MONTHS AGO`;
}
