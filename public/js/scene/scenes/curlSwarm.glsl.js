export const SIM_N = 384;
// curlSwarm shaders: GPGPU sim (velocity + position), point draw, nebula layer, backdrop composite.
// Sim space: 1 unit = 0.15 screen height, origin = the widget centre (uHero). uEdge = (xL, xR, yBot, yTop).

export const SIM_COMMON = /* glsl */`
uniform sampler2D tPos, tVel;
uniform float uDt, uSpd, uMorph, uTA, uTB, uAsm, uScat, uInit, uLT, uKick;
uniform mat3 uRot;
uniform vec4 uImp, uEdge;
uniform vec2 uHS;   // widget ellipse half extents in sim units (1.0 = widget edge)
const float SIMN = ${SIM_N}.0;
float csH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

// shared with the point vertex shader so class/life seeds agree
export const SEEDS = /* glsl */`
float csH2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// x: class (<.66 core, <.985 streamer, else comet)  y: life  z,w: misc
vec4 seeds(vec2 id){ return vec4(csH2(id), csH2(id + 71.3), csH2(id + 143.9), csH2(id * 1.7 + 9.1)); }
float lifeOf(vec4 s){ return s.x < 0.66 ? 1e4 : (s.x < 0.985 ? 6.0 + 8.0 * s.y : 3.5 + 3.0 * s.y); }
`;

export const SIM_VEL = /* glsl */`
// analytic divergence-free flow: curl( e_i * sin(k_i.p + w_i t) ) = cos(...) * (k_i x e_i)
vec3 curlFlow(vec3 p, float t){
  p += 0.35 * sin(p.yzx * 1.7 + vec3(0.3, 1.1, 2.0) * t * 0.21);
  vec3 c = vec3(0.0);
  vec3 k = vec3(1.3, 0.7, -0.9);  c += cos(dot(k, p) + t * 0.31) * cross(k, vec3(0.2, 0.9, 0.4));
  k = vec3(-0.8, 1.5, 0.6);       c += cos(dot(k, p) - t * 0.23 + 1.7) * cross(k, vec3(0.9, -0.1, 0.4));
  k = vec3(2.1, -1.7, 1.2);       c += 0.5 * cos(dot(k, p) + t * 0.47 + 4.1) * cross(k, vec3(0.3, 0.5, -0.8));
  k = vec3(-2.9, 2.3, 3.1);       c += 0.28 * cos(dot(k, p) - t * 0.61 + 2.3) * cross(k, vec3(0.7, 0.6, 0.3));
  return c * 0.45;
}
vec3 attr(float ty, vec3 s){
  vec3 q = s * uRot;                       // undo the slow display rotation
  vec3 f;
  if (ty < 0.5) {                          // Lorenz (native z = sim y)
    vec3 a = vec3(q.x, q.z, q.y) * 22.0 + vec3(0.0, 0.0, 25.0);
    vec3 d = vec3(10.0 * (a.y - a.x), a.x * (28.0 - a.z) - a.y, a.x * a.y - 2.6667 * a.z);
    f = vec3(d.x, d.z, d.y) * (0.095 / 22.0);
  } else if (ty < 1.5) {                   // Aizawa
    vec3 a = vec3(q.x, q.z, q.y) * 1.3 + vec3(0.0, 0.0, 0.7);
    float z = a.z;
    vec3 d = vec3((z - 0.7) * a.x - 3.5 * a.y, 3.5 * a.x + (z - 0.7) * a.y,
      0.6 + 0.95 * z - z * z * z / 3.0 - (a.x * a.x + a.y * a.y) * (1.0 + 0.25 * z) + 0.1 * z * a.x * a.x * a.x);
    f = vec3(d.x, d.z, d.y) * (0.75 / 1.3);
  } else {                                 // Thomas
    vec3 a = vec3(q.x, q.z, q.y) * 3.3;
    vec3 d = vec3(sin(a.y) - 0.208186 * a.x, sin(a.z) - 0.208186 * a.y, sin(a.x) - 0.208186 * a.z);
    f = vec3(d.x, d.z, d.y) * (2.6 / 3.3);
  }
  f = uRot * f;
  float L = length(f);
  return L > 2.4 ? f * (2.4 / L) : f;
}
void main(){
  vec2 id = floor(gl_FragCoord.xy), uv = gl_FragCoord.xy / SIMN;
  vec4 P = texture2D(tPos, uv), V = texture2D(tVel, uv);
  if (uInit > 0.5) { gl_FragColor = vec4(0.0); return; }
  vec4 sd = seeds(id);
  vec3 p = P.xyz;
  float t = uLT * uSpd;
  vec3 cn = curlFlow(p * 0.9, t);
  float dr = uStory.x, en = uStory.y, upk = clamp(dr * 0.5 + 0.5, 0.0, 1.0);
  // elliptical hero coordinates: hr = 1 at the widget edge; hdir/tang are unit-ish vectors in sim units
  vec2 hd = p.xy / uHS;
  float hr = length(hd);
  vec2 hdir = hd / max(hr, 1e-3);
  vec2 hpx = normalize(hdir * uHS);                       // outward, in isotropic sim units
  vec2 tang = vec2(-hpx.y, hpx.x);
  // soft radial wall: nothing crosses into the calm core
  vec3 wall = vec3(hdir * uHS * max(1.12 - hr, 0.0) * 5.0, 0.0);
  vec2 drift = vec2(0.0, 0.55 * dr * (0.3 + en));        // up rises, down sinks
  float vt = (0.7 + 1.5 * en) * (0.8 + 0.4 * sd.w);       // orbit speed grows with energy
  float aw = smoothstep(0.0, 1.0, uAsm);
  // (a) accretion ring: orbit + spring to a band around the eye-wall; up spirals in, down spreads out
  float rt = 1.38 + (sd.w - 0.5) * (0.22 + 0.5 * en) - 0.1 * dr - 0.06 * en;
  vec3 disk = vec3(tang * vt + hdir * uHS * (rt - hr) * 2.2 + drift, -p.z * 0.8) + cn * (0.2 + 0.35 * en) * vec3(1.0, 1.0, 0.4);
  disk.xy += hdir * uHS * (-0.16 * max(dr, 0.0) + 0.14 * max(-dr, 0.0)) * (0.5 + en);
  // (b) the strange attractor, stretched to span the ring (fa is evaluated in its native space)
  vec3 S = vec3(uHS, 0.5 * (uHS.x + uHS.y)) * (1.35 / 1.7);
  vec3 fa = attr(uTA, p / S);
  if (uMorph > 0.001) fa = mix(fa, attr(uTB, p / S), uMorph);
  vec3 tether = -p * max(length(p / S) - 1.7, 0.0) * 1.2;
  vec3 att = fa * S * 0.7 + tether + cn * 0.14 + vec3(tang * vt * 0.35, 0.0) + wall;
  float halo = sd.z < 0.45 ? 1.0 : 0.0;
  vec3 core = mix(cn * 0.6 - p * 0.35 + wall, mix(att, disk + wall, halo), aw);
  vec3 tgt = core;
  float resp = halo > 0.5 ? 6.0 : 24.0;
  if (sd.x >= 0.66) {
    float life = lifeOf(sd), age = P.w, f = clamp(age / life, 0.0, 1.0);
    if (sd.x < 0.985) {
      // ribbons peel off the ring: up arcs out then spirals back in, down keeps spreading out
      float rtr = mix(1.45 + 1.7 * f, 1.45 + 1.1 * sin(3.14159 * f), upk);
      vec3 str = vec3(tang * (1.1 + 1.4 * en + 0.6 * sd.w) * (0.9 + 0.3 * f) + hdir * uHS * (rtr - hr) * 1.6 + drift * 0.5, -p.z * 0.5) + cn * 0.5 + wall;
      tgt = mix(core, str, smoothstep(0.12, 0.4, f) * aw);
      resp = 3.2;
    } else {
      // comets: dive toward the widget (up), erupt away from it (down), with a little swirl
      float io = mix(1.0, -1.0, upk);
      vec3 jet = vec3(hpx * io * (3.0 + 2.6 * sd.w) + tang * 1.0 * (0.4 + en), -p.z * 0.3) + cn * 0.4;
      tgt = mix(cn * 0.4, jet, aw);
      resp = 3.4;
    }
  }
  // exit: release toward a radial scatter with turbulence
  vec3 outward = (p / max(length(p), 0.05)) * (1.0 + 2.2 * sd.w) + cn * 1.6 + vec3(0.6, 0.0, 0.0);
  tgt = mix(tgt, outward, uScat);
  vec3 v = (P.w < uDt * 1.5) ? tgt : mix(V.xyz, tgt, 1.0 - exp(-uDt * uSpd * mix(2.2, resp, uKick)));
  // pulse: a one-step radial kick from the widget -> the ring is thrown out and relaxes back (the spring + wall return it)
  if (uImp.w > 0.0) {
    vec3 d = p - uImp.xyz; float L = length(d);
    v += (d / max(L, 0.05)) * uImp.w * (2.2 + 1.0 * sd.z) * smoothstep(9.0, 0.0, L);
  }
  gl_FragColor = vec4(v, sd.x);
}`;

export const SIM_POS = /* glsl */`
void main(){
  vec2 id = floor(gl_FragCoord.xy), uv = gl_FragCoord.xy / SIMN;
  vec4 P = texture2D(tPos, uv), V = texture2D(tVel, uv);
  vec4 sd = seeds(id);
  float h1 = csH(id + uLT), h2 = csH(id * 1.31 + uLT * 1.7), h3 = csH(id * 0.73 - uLT * 2.3);
  if (uInit > 0.5) {   // fine dust over the whole frame
    vec3 q0 = vec3(mix(uEdge.x, uEdge.y, sd.y), mix(uEdge.z, uEdge.w, sd.z), (sd.w - 0.5) * 4.0);
    if (sd.x < 0.66 && sd.z < 0.45 && sd.y < 0.5) {   // half the ring is born in place so the eye-wall is lit from the first frame
      float a0 = sd.w * 6.28318 * 7.0;
      q0 = vec3(vec2(cos(a0), sin(a0)) * uHS * (1.38 + (sd.y - 0.25) * 0.5), 0.0);
    }
    gl_FragColor = vec4(q0, sd.z * lifeOf(sd) * 0.9);
    return;
  }
  vec3 p = P.xyz + V.xyz * uDt * uSpd;
  float age = P.w + uDt * uSpd;
  if (uScat < 0.001) {
    vec2 hd = p.xy / uHS; float hr = length(hd);
    bool comet = sd.x >= 0.985;
    float io = uStory.x < -0.3 ? -1.0 : 1.0;   // comets dive in unless the story is falling
    bool gone = sd.x >= 0.66 && (age > lifeOf(sd) || (comet && (io > 0.0 ? hr < 1.22 : hr > 4.2)));
    gone = gone || length(p) > 14.0;
    if (gone) {
      float a = h1 * 6.28318;
      if (sd.x < 0.985) {   // ribbons are reborn on the ring
        p = vec3(vec2(cos(a), sin(a)) * uHS * (1.36 + (h2 - 0.5) * 0.18), (h3 - 0.5) * 0.5);
      } else if (io > 0.0) { // comets enter from outside and streak toward the widget
        p = vec3(vec2(cos(a), sin(a)) * uHS * (3.0 + h2 * 1.3), (h3 - 0.5) * 1.5);
      } else {               // ...or erupt from the eye-wall
        p = vec3(vec2(cos(a), sin(a)) * uHS * (1.3 + h2 * 0.2), (h3 - 0.5) * 1.0);
      }
      age = 0.0;
    }
  }
  gl_FragColor = vec4(p, age);
}`;

export const PTS_VERT = /* glsl */`
uniform sampler2D tPos, tVel;
uniform vec3 uAnchor; uniform float uScale, uSize, uAsm, uScat; uniform vec4 uEdge; uniform vec2 uVis;
varying vec3 vCol; varying float vA; varying vec2 vDir; varying float vStr;
void main(){
  vec4 P = texture2D(tPos, position.xy), V = texture2D(tVel, position.xy);
  vec4 sd = seeds(floor(position.xy * ${SIM_N}.0));
  vec3 vp = uAnchor + P.xyz * uScale;
  vec4 c0 = projectionMatrix * vec4(vp, 1.0);
  vec4 c1 = projectionMatrix * vec4(vp + V.xyz * uScale * 0.16, 1.0);
  gl_Position = c0;
  vec2 s0 = c0.xy / c0.w, s1 = c1.xy / c1.w;
  vec2 dpx = (s1 - s0) * uRes * 0.5;
  float dl = length(dpx);
  vDir = dl > 1e-4 ? dpx / dl : vec2(1.0, 0.0);
  vStr = clamp(dl / 7.0, 0.0, 1.0);
  float sp = length(V.xyz);
  float spn = clamp(sp / 2.2, 0.0, 1.0);
  vec3 mag = mix(vec3(1.0, 0.16, 0.78), uAccent, 0.3);
  vec3 cya = mix(vec3(0.05, 0.85, 1.0), uAccent2, 0.3);
  vec3 amb = vec3(1.0, 0.62, 0.18);
  vec3 col = mix(mag, cya, smoothstep(0.08, 0.45, spn));
  col = mix(col, amb, smoothstep(0.55, 1.0, spn));
  float a = (0.2 + 0.36 * spn) * (sd.z < 0.45 ? 0.85 : 0.7);
  bool comet = sd.x >= 0.985, streamer = sd.x >= 0.66 && !comet;
  float core = 0.0;   // white-hot ribbon core
  if (sd.x >= 0.66) {
    float life = lifeOf(sd);
    a *= smoothstep(0.0, 0.6, P.w) * (1.0 - smoothstep(life - 1.5, life, P.w));
    // ribbons leave the visible right half: lane 0 fades past the left bound, lane 1 below the bottom bound
    a *= sd.z < 0.5 || comet ? smoothstep(uVis.x - 1.8, uVis.x, P.x) : smoothstep(uVis.y - 1.4, uVis.y, P.y);
  }
  if (comet) { col = mix(cya, vec3(0.8, 0.95, 1.0), 0.5); a = 0.6 * a + 0.25; core = 0.35; }
  if (streamer) { a *= 0.8; col = mix(sd.z < 0.5 ? cya : mag, amb, 0.25 * spn); core = 0.05 + 0.12 * sd.y; }
  // calm eye over the widget, luminous band at the eye-wall in the story colour
  vec2 sc = s0 * 0.5 + 0.5;
  float hrr = hR(sc);
  float hf = mix(0.1, 1.0, smoothstep(0.8, 1.2, hrr));
  float rimB = exp(-pow(abs((hrr - 1.35) * 3.0), 2.0));
  hf *= 1.0 + 0.3 * rimB * (0.5 + uStory.y);
  col = mix(col, uStoryCol * (0.9 + 0.9 * spn) + 0.15, (0.22 + 0.3 * rimB) * (0.6 + 0.4 * uStory.y));
  col = mix(col, mix(col, uStoryColA * 1.4, 0.5), step(0.5, sd.y) * 0.25);
  float dust = mix(0.45, 1.0, uAsm);
  float sz = mix(1.4, 2.6, sd.y * sd.y) * (comet ? 3.4 : streamer ? 1.35 : 1.45) * dust * hf * (1.0 - 0.4 * uScat);
  gl_PointSize = clamp(uSize * sz * uRes.y / 1080.0, 1.0, 48.0);
  vA = a * hf * dust * (1.0 + 0.5 * uPulse + 0.6 * uStory.w * rimB);
  vCol = mix(col, vec3(1.0, 0.97, 1.0), core * smoothstep(0.1, 0.6, spn + 0.25)) * (0.85 + 0.7 * spn);
}`;

export const PTS_FRAG = /* glsl */`
varying vec3 vCol; varying float vA; varying vec2 vDir; varying float vStr;
void main(){
  vec2 c = gl_PointCoord - 0.5; c.y = -c.y;
  float al = dot(c, vDir); vec2 pe = c - vDir * al;
  float m = exp(-dot(pe, pe) * mix(14.0, 46.0, vStr) - al * al * mix(14.0, 5.5, vStr));
  vec3 col = vCol * m * vA;
  gl_FragColor = vec4(finish(col), 1.0);
}`;

export const FS_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

// domain-warped nebula, fbm(p + fbm(p)), 3 octaves of smoothed value noise from uNoise
export const NEB = /* glsl */`
uniform vec2 uPar; uniform float uOct; uniform vec2 uAsp;
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return texture2D(uNoise, (i + f + 0.5) / 256.0).x; }
float fbm3(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { if (float(i) >= uOct) break; s += a * vn2(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; } return s; }
vec3 nebula(vec2 uv){
  float t = uTime;
  vec2 p = vec2(uv.x * uAsp.x, uv.y) * 3.2 + uPar * vec2(1.0, 0.6) + vec2(t * 0.012, 0.0);
  vec2 q = vec2(fbm3(p + vec2(0.0, t * 0.02)), fbm3(p + vec2(5.2, 1.3) - t * 0.015));
  float n = fbm3(p + 2.6 * q);
  vec3 col = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) * 0.6 + n * 0.9 + q.x * 0.5 + vec3(0.62, 0.78, 0.92)));
  col = mix(col, uAccent, 0.18) * vec3(0.9, 0.55, 1.0);
  float dens = smoothstep(0.32, 0.85, n) * (0.5 + q.y);
  // lives around the widget's eye-wall; the core stays near black
  vec2 d = (uv - uHero.xy) * vec2(uAsp.x, 1.0);
  float hrr = hR(uv);
  float band = exp(-pow(abs((hrr - 1.4) * 2.0), 2.0));
  float mask = 0.2 + 1.3 * exp(-dot(d, d) * 3.4) + 0.9 * band;
  mask *= 0.12 + 0.88 * smoothstep(0.75, 1.25, hrr);          // dark at the core
  col = mix(col, uStoryCol * 1.3, 0.4 * band);
  return col * dens * mask * 0.1 + uStoryCol * band * (0.02 + 0.03 * uStory.y);
}`;

export const NEB_FRAG = /* glsl */`varying vec2 vUv; void main(){ gl_FragColor = vec4(nebula(vUv), 1.0); }`;

export const BACK_FRAG = /* glsl */`
uniform sampler2D tLayer; uniform float uHasLayer; uniform vec4 uRing; uniform vec3 uRingCol;
varying vec2 vUv;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = uHasLayer > 0.5 ? texture2D(tLayer, uv).rgb : nebula(uv);
  col *= 1.0 + 0.6 * uPulse;
  // travelling shockwave ring from the attractor (ripple)
  float asp = uRes.x / uRes.y;
  float d = length((uv - uRing.xy) * vec2(asp, 1.0));
  float rr = uRing.z * 0.75;
  float ring = exp(-pow(abs((d - rr) * 110.0), 2.0)) + 0.25 * exp(-pow(abs((d - rr * 0.9) * 40.0), 2.0));
  col += uRingCol * ring * uRing.w * (1.0 - smoothstep(0.3, 1.5, uRing.z)) * 0.9;
  gl_FragColor = vec4(finish(col), 1.0);
}`;
