// Hyperspeed Highway: curving neon motorway, twin light-trail streams, flicking gates, hyperspace star streaks.
// 6 draws: backdrop haze, road, tail-lights, head-lights, gates, stars. Shared vertex-shader bend keeps everything glued to the road.
const L = 3200;          // wrap length for every flowing thing (flow wraps at 8*L so speeds in multiples of 1/8 stay continuous)
const W = L * 8;
const ROOT_Y = -120, REF_Z = 150, BASE_FLOW = 520;

const BEND = /* glsl */`
uniform float uTime, uFlow, uSq, uEnter, uExit; uniform vec2 uRes;
const float X0 = -165.;
float h11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
vec3 bendPos(vec3 p){
  float d = max(${REF_Z}. - p.z, 0.); float f = d/3300.;
  float sw = sin(uTime*0.6 + d*0.0011), sw2 = sin(uTime*0.37 + d*0.0007 + 2.0);
  p.x = p.x*uSq + X0 - 1450.*f*f + sw*d*0.05*min(1., f*3.);
  p.y += sin(uTime*0.5 + d*0.002)*d*0.011 + sw2*d*0.004;
  return p;
}`;

const TRAIL_VS = BEND + /* glsl */`
attribute vec4 aT; uniform float uSign; uniform vec2 uShock; uniform vec3 uCol0, uCol1; uniform vec3 uAcc;
varying vec4 vC; varying vec2 vUv;
void main(){
  float lat=aT.x, spd=aT.y, len=aT.z, seed=aT.w;
  float c = seed*${L}. - uFlow*spd; float dc = c - ${L}.*floor(c/${L}.);
  float le = len*(1.+uExit*7.);
  vec3 ph = bendPos(vec3(lat, 3., ${REF_Z}. - dc));
  vec3 pt = bendPos(vec3(lat, 3., ${REF_Z}. - dc - uSign*le));
  vec4 vh = modelViewMatrix*vec4(ph,1.), vt = modelViewMatrix*vec4(pt,1.);
  vh.z = min(vh.z,-15.); vt.z = min(vt.z,-15.);
  vec4 ch = projectionMatrix*vh, ct = projectionMatrix*vt;
  vec2 sd = (ct.xy/ct.w - ch.xy/ch.w)*uRes*0.5; float sl = length(sd);
  vec2 dir = sl>1e-3 ? sd/sl : vec2(0.,1.); vec2 perp = vec2(-dir.y, dir.x);
  float pxw = clamp(3.2*0.5*uRes.y*projectionMatrix[1][1]/ch.w, 1.3, 5.5)*uRes.y/1080.;
  vec4 cp = mix(ch, ct, position.y);
  float hw = pxw*1.7;
  cp.xy += (perp*position.x*hw + dir*(position.y*2.-1.)*hw*0.6)*2./uRes*cp.w;
  float ign = smoothstep(0., .12, uEnter - (0.25 + 0.1*abs(lat)/30.));
  float ring = exp(-pow((dc-uShock.x)/70.,2.))*uShock.y;
  float fade = exp(-dc/2300.)*smoothstep(${L}.,2900.,dc)*smoothstep(25.,160.,-vh.z)*ign;
  fade *= 1.-0.7*uExit;
  float s2 = fract(seed*91.7);
  vec3 col = mix(uCol0, uCol1, s2); col = mix(col, uAcc, 0.22);
  vC = vec4(col, fade*(0.8+0.5*s2)*(1.+3.*ring)); vUv = vec2(position.x*2., position.y);
  gl_Position = cp;
}`;
const TRAIL_FS = (G) => `${G}
varying vec4 vC; varying vec2 vUv;
void main(){
  float core = exp(-vUv.x*vUv.x*3.2), taper = pow(1.-vUv.y, 1.4), hot = exp(-vUv.y*10.);
  vec3 col = mix(vC.rgb, vec3(1.), hot*0.55)*core*(0.28*taper + 1.7*hot)*vC.a*0.85;
  gl_FragColor = vec4(finish(col), 1.);
}`;

const STAR_VS = BEND + /* glsl */`
attribute float aEnd; uniform vec3 uAcc2;
varying vec4 vC;
void main(){
  float seed = position.z, r = fract(seed*13.7);
  float spd = 0.5 + floor(r*12.)/8.;
  float c = seed*${L}. - uFlow*spd; float D = c - ${L}.*floor(c/${L}.) + 100.;
  float len = (0.08 + 0.3*fract(seed*7.3))*D*(1.+uExit*4.);
  float DD = D + aEnd*len; float z = ${REF_Z}. - DD;
  float spread = smoothstep(0.2, 1., uEnter + r*0.4 - 0.2);
  vec3 off = bendPos(vec3(0.,0.,z));
  vec3 p = vec3(position.x*DD*spread + off.x, 160. + position.y*DD*spread, z);
  float h = fract(seed*31.1);
  vec3 col = h<0.55 ? vec3(0.75,0.9,1.) : h<0.85 ? vec3(1.,0.3,0.9) : vec3(1.,0.7,0.25);
  col = mix(col, uAcc2, 0.2);
  float fade = smoothstep(120.,500.,D)*smoothstep(3300.,2500.,D)*spread;
  vC = vec4(col, fade*mix(1.8, 0.0, aEnd));
  gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;
const STAR_FS = (G) => `${G}
varying vec4 vC;
void main(){ gl_FragColor = vec4(finish(vC.rgb*vC.a), 1.); }`;

const ROAD_VS = BEND + /* glsl */`
varying vec2 vR;
void main(){
  float u = position.z + 0.5; float dc = u*u*3500. - 100.;
  float lat = position.x*620.;
  vec3 p = bendPos(vec3(lat, 0., ${REF_Z}. - dc));
  vR = vec2(lat, dc);
  gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;
const ROAD_FS = (G) => `${G}
uniform float uFlow, uEnter, uExit, uSq; uniform vec2 uShock; uniform vec3 uShockCol;
varying vec2 vR;
void main(){
  float lat = vR.x/max(uSq,0.02), dc = vR.y, al = abs(lat);
  float reach = 3400.*(1.-uEnter);
  float vis = smoothstep(reach-80., reach+120., dc);
  float front = exp(-pow((dc-reach)/40.,2.))*step(uEnter,0.999)*step(0.001,uEnter);
  vec3 col = vec3(0.012,0.006,0.03);
  float c0 = dc + uFlow;
  // dashes on lane boundaries, solid amber median edges
  float dash = step(fract(c0/32.), 0.42);
  float ln = (1.-smoothstep(0.,0.9,abs(al-40.)))+(1.-smoothstep(0.,0.9,abs(al-70.)));
  col += vec3(0.5,0.55,0.8)*0.35*ln*dash;
  col += vec3(1.,0.55,0.12)*0.5*(1.-smoothstep(0.,0.9,abs(al-10.)))*step(al,12.);
  // neon edges + shoulder glow
  float eL = abs(lat+100.), eR = abs(lat-100.);
  vec3 cL = mix(vec3(1.,0.1,0.6), uAccent, 0.35), cR = mix(vec3(0.1,0.85,1.), uAccent2, 0.35);
  col += cL*(1.6*exp(-eL*eL*0.7)+0.22*exp(-eL*0.05)*step(lat,-100.)+0.1*exp(-eL*0.05));
  col += cR*(1.6*exp(-eR*eR*0.7)+0.22*exp(-eR*0.05)*step(100.,lat)+0.1*exp(-eR*0.05));
  // wet reflections of passing lights
  float inRoad = 1.-smoothstep(96.,104.,al);
  float nL = vnoise(vec3(lat*0.1, (dc+uFlow*0.4)*0.006, 0.3)), nR = vnoise(vec3(lat*0.1, (dc+uFlow*1.4)*0.004, 7.1));
  col += inRoad*(vec3(1.,0.12,0.25)*smoothstep(0.55,0.95,nL)*0.35*step(lat,0.) + vec3(0.5,0.9,1.)*smoothstep(0.55,0.95,nR)*0.45*step(0.,lat));
  // shockwave ring along the road
  float ring = exp(-pow((dc-uShock.x)/55.,2.))*uShock.y;
  col += uShockCol*ring*(0.6+ln*1.5+inRoad*0.4);
  col += (uAccent2+vec3(0.5))*front*inRoad*2.0;
  float fogA = 1.-exp(-dc/2600.);
  float shd = smoothstep(104.,170.,al);
  col = mix(col, vec3(0.16,0.03,0.24)*0.4, fogA*0.55*(1.-shd));
  col *= vis*(1.-0.85*shd)*smoothstep(3350.,2500.,dc);
  gl_FragColor = vec4(finish(col), 1.-smoothstep(120.,230.,al));
}`;

const GATE_VS = BEND + /* glsl */`
attribute float aG; uniform vec2 uShock;
varying vec2 vUv; varying vec3 vG;
void main(){
  float seed = aG; float c = seed*${L}. - uFlow; float cyc = floor(c/${L}.); float dc = c - cyc*${L}.;
  float lit = step(0.84, h11(seed*17.3 + mod(cyc,8.)*3.17));
  float ring = exp(-pow((dc-uShock.x)/90.,2.))*uShock.y;
  lit = max(lit, ring*0.9);
  float zc = ${REF_Z}. - dc;
  vec3 o0 = bendPos(vec3(0.,0.,zc)), o1 = bendPos(vec3(0.,0.,zc-30.));
  float a = (o1.x-o0.x)/30.; vec3 ld = normalize(vec3(1.,0.,a));
  vec3 p = o0 + ld*(position.x*250.*uSq) + vec3(0., (position.y+0.5)*115., 0.);
  float fade = smoothstep(250.,550.,dc)*smoothstep(${L}.,2300.,dc)*lit;
  fade *= smoothstep(0.35,0.7,uEnter + fract(seed*5.1)*0.3 - 0.15);
  vUv = position.xy + 0.5; vG = vec3(fade, dc, ring);
  gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;
const GATE_FS = (G) => `${G}
varying vec2 vUv; varying vec3 vG;
void main(){
  vec2 fw = fwidth(vUv);
  float dxL = abs(vUv.x-0.04)/fw.x, dxR = abs(vUv.x-0.96)/fw.x;
  float dT = abs(vUv.y-0.97)/fw.y, dT2 = abs(vUv.y-0.9)/fw.y;
  vec3 cL = mix(vec3(1.,0.1,0.6), uAccent, 0.4), cR = mix(vec3(0.1,0.85,1.), uAccent2, 0.4);
  float inX = step(0.04,vUv.x)*step(vUv.x,0.96);
  float seg = step(fract(vUv.y*9.), 0.62);
  vec3 col = cL*(exp(-dxL*0.5)*0.6+smoothstep(1.4,0.3,dxL))*step(vUv.y,0.98)*mix(0.5,1.,seg);
  col += cR*(exp(-dxR*0.5)*0.6+smoothstep(1.4,0.3,dxR))*step(vUv.y,0.98)*mix(0.5,1.,seg);
  vec3 cT = mix(cL, cR, vUv.x);
  col += cT*(exp(-dT*0.5)*0.6+smoothstep(1.4,0.3,dT))*step(0.03,vUv.x)*step(vUv.x,0.97);
  col += cT*0.5*(exp(-dT2*0.6)*0.5+smoothstep(1.2,0.3,dT2))*inX*step(fract(vUv.x*22.),0.55);
  col *= 2.0*vG.x*(1.+2.*vG.z);
  gl_FragColor = vec4(finish(col), 1.);
}`;

const BACK_VS = 'void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }';
const BACK_FS = (G) => `${G}
uniform vec2 uVP; uniform float uFlow;
void main(){
  vec2 q = gl_FragCoord.xy/uRes; float asp = uRes.x/uRes.y;
  vec2 dv = (q-uVP)*vec2(asp,1.);
  float band = exp(-pow((q.y-uVP.y)/0.09,2.));
  float up = smoothstep(0.,0.7,q.y-uVP.y)*exp(-(q.y-uVP.y)*2.5);
  vec3 col = vec3(0.10,0.02,0.16)*(band*0.9 + up*0.5);
  col += mix(vec3(1.,0.15,0.6),uAccent,0.35)*0.12/(1.+dot(dv,dv)*70.);
  float cl = vnoise(vec3(q.x*3.+uTime*0.02, q.y*9., uTime*0.03));
  col += vec3(0.14,0.03,0.2)*cl*band*0.6;
  col += uAccent2*0.015*smoothstep(0.5,1.,q.y);
  col *= 1.+uPulse*0.5*exp(-length(dv)*2.);
  gl_FragColor = vec4(finish(col), 1.);
}`;

function ease(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }

export function create(ctx) {
  const { THREE, rnd } = ctx;
  const G0 = ctx.GLSL, COMMON = G0.COMMON || '';
  const part = (k, sig) => (typeof G0[k] === 'string' && !COMMON.includes(sig) ? G0[k] : '');
  const GL = COMMON + part('guard', 'float guard(') + part('alertMix', 'vec3 alertMix(') + part('finish', 'vec3 finish(');
  const uni = ctx.common();
  const U = {
    uFlow: { value: 0 }, uSq: { value: 1 }, uEnter: { value: 1 }, uExit: { value: 0 },
    uShock: { value: new THREE.Vector2(-9999, 0) }, uShockCol: { value: new THREE.Color(0.1, 0.9, 1) },
    uVP: { value: new THREE.Vector2(0.25, 0.42) },
  };
  const root = new THREE.Group(); ctx.stage.add(root);
  ctx.anchor(root, { parallax: 0.1, y: ROOT_Y, z: 0 });
  const mk = (vs, fs, extra, o = {}) => ctx.track(new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: fs, uniforms: { ...uni, ...U, ...extra },
    transparent: true, depthWrite: !!o.opaque, blending: o.opaque ? THREE.NormalBlending : THREE.AdditiveBlending, depthTest: true, side: THREE.DoubleSide,
  }));
  const add = (m) => { m.frustumCulled = false; root.add(m); return m; };

  // road: u^2 distributed rows so detail stays near the camera
  const rg = ctx.track(new THREE.PlaneGeometry(1, 1, 1, 200)); rg.rotateX(-Math.PI / 2);
  const road = add(new THREE.Mesh(rg, mk(ROAD_VS, ROAD_FS(GL), {}, { opaque: true })));
  road.renderOrder = 1;

  // quad base shared by trails + gates
  const quad = (() => { const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, -.5, 1, 0, .5, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]); return ctx.track(g); })();
  const N = 600;
  const trail = (sign, c0, c1, lanes, spdFn) => {
    const g = quad.clone(); ctx.track(g);
    const a = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      a[i * 4] = lanes[(rnd() * 3) | 0] + (rnd() - 0.5) * 9;
      a[i * 4 + 1] = spdFn();
      a[i * 4 + 2] = sign > 0 ? 40 + rnd() * 130 : 25 + rnd() * 80;
      a[i * 4 + 3] = rnd();
    }
    g.setAttribute('aT', new THREE.InstancedBufferAttribute(a, 4)); g.instanceCount = N;
    const m = add(new THREE.Mesh(g, mk(TRAIL_VS, TRAIL_FS(GL), { uSign: { value: sign }, uCol0: { value: c0 }, uCol1: { value: c1 }, uAcc: sign > 0 ? uni.uAccent2 : uni.uAccent })));
    m.renderOrder = 2; return m;
  };
  const tail = trail(-1, new THREE.Color(1, 0.04, 0.1), new THREE.Color(1, 0.1, 0.55), [-85, -55, -25], () => { let k = 0; while (!k) k = ((rnd() * 8) | 0) - 3; return k / 8; });
  const head = trail(1, new THREE.Color(0.55, 0.95, 1), new THREE.Color(1, 1, 1), [25, 55, 85], () => (8 + ((rnd() * 9) | 0)) / 8);

  const gg = quad.clone(); ctx.track(gg);
  gg.attributes.position.array.set([-.5, -.5, 0, .5, -.5, 0, -.5, .5, 0, .5, .5, 0]);
  const gs = new Float32Array(40); for (let i = 0; i < 40; i++) gs[i] = (i + rnd() * 0.6) / 40;
  gg.setAttribute('aG', new THREE.InstancedBufferAttribute(gs, 1)); gg.instanceCount = 40;
  add(new THREE.Mesh(gg, mk(GATE_VS, GATE_FS(GL), {}))).renderOrder = 3;

  const NS = 3000, sg = ctx.track(new THREE.BufferGeometry());
  const sp = new Float32Array(NS * 6), se = new Float32Array(NS * 2);
  for (let i = 0; i < NS; i++) {
    const ax = (rnd() * 2 - 1) * 1.35, ay = 0.07 + Math.pow(rnd(), 0.8) * 0.6, sd = (i + rnd()) / NS;
    for (let e = 0; e < 2; e++) { sp.set([ax, ay, sd], (i * 2 + e) * 3); se[i * 2 + e] = e; }
  }
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aEnd', new THREE.BufferAttribute(se, 1));
  const stars = add(new THREE.LineSegments(sg, mk(STAR_VS, STAR_FS(GL), { uAcc2: uni.uAccent2 }))); stars.renderOrder = 4;

  const back = new THREE.ShaderMaterial({ vertexShader: BACK_VS, fragmentShader: BACK_FS(GL), uniforms: { ...uni, ...U }, depthTest: false, depthWrite: false });
  ctx.track(back); ctx.backdrop(back);

  // state
  const S = { punch: 0, enterT: -1, enterD: 1, exitT: -1, exitD: 1, shockT: -1, dirty: 0, k: 1, flow: 0, vp: new THREE.Vector3(), q: ctx.quality };
  const gradeCol = new THREE.Color(0.92, 0.86, 1.0);
  const api = {
    grade: { bloom: 0.9, bloomThreshold: 0.55, bloomRadius: 0.7, tint: gradeCol, tintAmt: 0.05, sat: 1.1, contrast: 1.05, ca: 0.0012, grain: 0.04, vignette: 0.35, scan: 0.12 },
    cameraBias: { orbitScale: 1.0, bob: 0.9 },
    setIntensity(a) { S.k = a; },
    enter(d) { S.enterT = 0; S.enterD = Math.max(0.1, d); U.uEnter.value = 0; S.exitT = -1; U.uExit.value = 0; U.uSq.value = 1; },
    exit(d) { S.exitT = 0; S.exitD = Math.max(0.1, d); },
    ripple(o) {
      S.punch = Math.min(1.5, 0.6 + (o.strength ?? 1) * 0.9); S.shockT = 0; ctx.pulse.value = Math.max(ctx.pulse.value, o.strength ?? 1);
      if (o.color) U.uShockCol.value.copy(o.color); U.uShock.value.set(0, 1);
    },
    shockwave(x, z, color) { api.ripple({ strength: 1, color }); },
    event() {},
    setQuality(q) {
      S.q = q; const n = q >= 2 ? N : N / 2;
      tail.geometry.instanceCount = head.geometry.instanceCount = n;
      sg.setDrawRange(0, q >= 2 ? NS * 2 : q === 1 ? NS : 0); stars.visible = q > 0;
    },
    update(dt, t, info) {
      let spd = 1 + 0.4 * ctx.alert.value;
      S.punch *= Math.exp(-dt * 1.5);
      spd *= (1 + 1.5 * (S.punch / 1.5) * 1.0 + 0.0) * (0.55 + 0.45 * S.k);
      if (S.enterT >= 0) { S.enterT += dt; const p = Math.min(1, S.enterT / S.enterD); U.uEnter.value = ease(p); spd *= 1 + 2.5 * (1 - p); if (p >= 1) S.enterT = -1; }
      if (S.exitT >= 0) { S.exitT += dt; const p = Math.min(1, S.exitT / S.exitD); U.uExit.value = p * p; U.uSq.value = 1 - ease(Math.max(0, p * 1.15 - 0.15)) * 0.97; spd *= 1 + 5 * p * p; if (p >= 1) S.exitT = -1; }
      S.flow = (S.flow + dt * BASE_FLOW * spd) % W; U.uFlow.value = S.flow;
      if (S.shockT >= 0) { S.shockT += dt; U.uShock.value.x = S.shockT * 5200; U.uShock.value.y = Math.max(0, 1 - S.shockT * 1.1); if (S.shockT > 1) { S.shockT = -1; U.uShock.value.set(-9999, 0); } }
      // vanishing point (road far end) in screen uv, so the haze glows exactly where the road ends
      const d = 3300, f = d / 3300;
      const sw = Math.sin(t * 0.6 + d * 0.0011), sw2 = Math.sin(t * 0.37 + d * 0.0007 + 2);
      S.vp.set(root.position.x + (-165 - 1450 * f * f + sw * d * 0.05), ROOT_Y + Math.sin(t * 0.5 + d * 0.002) * d * 0.011 + sw2 * d * 0.004, REF_Z - d).project(info.camera);
      U.uVP.value.set(S.vp.x * 0.5 + 0.5, Math.min(0.7, Math.max(0.2, S.vp.y * 0.5 + 0.5)));
    },
    morphPoints(out, n) {
      const o = { x: 0, y: 0 };
      for (let i = 0; i < n; i++) {
        const r = rnd(), dc = 200 + Math.pow(rnd(), 1.6) * 2600, f = dc / 3300, t = ctx.localTime.value;
        const lat = r < 0.7 ? [-85, -55, -25, 25, 55, 85][(rnd() * 6) | 0] : r < 0.9 ? (rnd() < 0.5 ? -100 : 100) : (rnd() * 2 - 1) * 120;
        const z = REF_Z - dc;
        out[i * 3] = root.position.x + lat - 165 - 1450 * f * f + Math.sin(t * 0.6 + dc * 0.0011) * dc * 0.05 * Math.min(1, f * 3);
        out[i * 3 + 1] = ROOT_Y + (r < 0.9 ? 3 : rnd() * 110) + Math.sin(t * 0.5 + dc * 0.002) * dc * 0.011 + Math.sin(t * 0.37 + dc * 0.0007 + 2) * dc * 0.004;
        out[i * 3 + 2] = z;
      }
      return true;
    },
  };
  api.setQuality(ctx.quality);
  return api;
}
