// megacity shaders. V* = vertex, F* = fragment. HEAD_V/HEAD_F are prepended by megacity.js.
// City constants (must match megacity.js).
const K = `#define GROUND -250.0
#define ZNEAR 250.0
#define SPAN 2700.0
#define ZFAR -2450.0
`;
const U = `uniform vec3 uFogA; uniform vec3 uFogB; uniform float uHz; uniform float uBuild; uniform float uSink; uniform float uTravel;
uniform vec4 uRip; uniform vec3 uRipCol; uniform float uBrake; uniform float uCarPh; uniform float uRainPh; uniform vec2 uPar; uniform float uOct; uniform float uRootX;
float mh11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float mh12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float mh13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
`;
export const HEAD_V = K + `uniform float uTime; uniform float uAlert; uniform float uPulse; uniform float uFade; uniform vec3 uAccent; uniform vec3 uAccent2; uniform vec2 uRes;
` + U;
export const HEAD_F = K + U + `
float gmask(){ return clamp((1.0-guard())/max(uGuardAmt,1e-3),0.,1.); }
float nz(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); vec2 uv=(i.xy+vec2(37.,17.)*i.z+f.xy+.5)/256.; vec2 rg=texture2D(uNoise,uv).yx; return mix(rg.x,rg.y,f.z); }
vec3 fogOf(float d, float wy, float zl){
  float f = 1.0 - exp(-d * 0.00125);
  f = max(f, smoothstep(ZFAR + 420.0, ZFAR + 60.0, zl));
  return vec3(f, smoothstep(400.0, 2300.0, d), smoothstep(-180.0, -250.0, wy));
}
vec3 fogCol(vec3 fo){ return mix(uFogA, uFogB, fo.y); }
`;

// ---------------- towers (+ instance 0 = ground slab) ----------------
export const V_TOWER = `
attribute vec4 aBase; attribute vec4 aPar;
varying vec3 vW; varying vec3 vL; varying vec3 vN; varying vec4 vP; varying vec4 vS;
void main(){
  float ground = step(aPar.z, -0.5);
  float z = mix(ZFAR + mod(aBase.y - ZFAR + uTravel, SPAN), aBase.y, ground);
  float st = aPar.w;
  float rise = clamp((uBuild * 1.7 - st) / 0.7, 0.0, 1.0); rise = 1.0 - pow(1.0 - rise, 3.0);
  float sink = clamp((uSink * 1.7 - st) / 0.7, 0.0, 1.0);
  float hf = mix(rise * (1.0 - sink * sink), 1.0, ground);
  float H = aPar.x; float h = H * max(hf, 0.003);
  vec3 lp = position;
  vec3 p = vec3(aBase.x + lp.x * aBase.z, GROUND - ground + lp.y * h, z + lp.z * aBase.w);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz; vL = vec3(lp.x * aBase.z, lp.y * h + (H - h), lp.z * aBase.w); vN = normal;
  vP = vec4(H, aPar.y, aPar.z, z);
  vS = vec4(aBase.z, aBase.w, rise, sink);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const F_TOWER = `
varying vec3 vW; varying vec3 vL; varying vec3 vN; varying vec4 vP; varying vec4 vS;
vec3 winCol(float h){ vec3 c = mix(vec3(1.0,0.52,0.16), vec3(0.25,0.85,1.0), step(0.45,h)); c = mix(c, vec3(1.0,0.28,0.72), step(0.72,h)); return mix(c, vec3(0.85,0.8,1.0), step(0.9,h)); }
void main(){
  vec3 n = normalize(vN); float seed = vP.z; float H = vP.x; float zl = vP.w;
  float d = distance(cameraPosition, vW);
  vec3 fo = fogOf(d, vW.y, zl);
  float m = gmask();
  // ripple front (world xz)
  float rd = distance(vW.xz, uRip.xy); float front = uRip.z * 380.0;
  float rip = uRip.w * exp(-uRip.z * 0.55) * (exp(-pow((rd - front) / 42.0, 2.0)) + 0.35 * step(rd, front) * exp(-(front - rd) / 260.0));
  vec3 col;
  if (seed < -0.5) {
    // ground: sodium streets, light rivers in the canyons, moving traffic dots
    float lx = vW.x - uRootX; float lz = vW.z - uTravel;
    float xs = abs(fract((lx + 900.0) / 150.0 + 0.5) - 0.5) * 150.0;
    float zs = abs(fract((ZNEAR - lz) / 150.0 + 0.5) - 0.5) * 150.0;
    float st = exp(-xs / 2.5) + exp(-zs / 2.5);
    float dots = step(0.82, fract(lz / 11.0 + uTime * 2.2 * sign(fract((lx + 900.0) / 150.0) - 0.5))) * exp(-xs / 2.0);
    col = vec3(1.0, 0.45, 0.12) * (st * 0.18 + dots * 0.7);
    float c1 = abs(lx + 230.0), c2 = abs(lx - 250.0);
    float dash1 = smoothstep(0.55, 1.0, fract(lz / 16.0 + uTime * 3.0 * sign(lx + 230.0)));
    float dash2 = smoothstep(0.55, 1.0, fract(lz / 16.0 - uTime * 3.0 * sign(lx - 250.0)));
    col += mix(vec3(0.2,0.9,1.0), uAccent2, 0.3) * (exp(-c1 / 14.0) * 0.25 + exp(-abs(c1 - 14.0) / 2.5) * dash1 * 1.2);
    col += mix(vec3(1.0,0.2,0.75), uAccent, 0.3) * (exp(-c2 / 14.0) * 0.25 + exp(-abs(c2 - 14.0) / 2.5) * dash2 * 1.2);
    col += uRipCol * rip * exp(-abs(rd - front) / 8.0) * 1.5;
    col *= (1.0 - 0.5 * m) * smoothstep(0.0, 0.3, uBuild) * (1.0 - uSink * 0.8);
    col = mix(col + vec3(0.02, 0.005, 0.03), fogCol(fo), fo.x);
    gl_FragColor = vec4(finish(col), 1.0);
    return;
  }
  float top = step(0.5, n.y);
  vec2 c = abs(n.x) > 0.5 ? vec2(vL.z, vL.y) : vec2(vL.x, vL.y);
  vec2 g = c / vec2(2.4, 3.1); vec2 id = floor(g); vec2 f = fract(g);
  float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.78);
  float rate = 0.03 + 0.2 * mh11(seed * 91.7);
  float on = step(0.6, mh13(vec3(id, seed * 173.0 + floor(uTime * rate + mh12(id + seed * 7.0) * 9.0))));
  on *= step(0.22, mh12(vec2(id.y, seed * 31.0))) * step(1.2, vL.y);
  float lvl = 0.45 + 0.9 * mh12(id + 3.7);
  vec2 fw = fwidth(g);
  float aa = smoothstep(0.3, 0.85, max(fw.x, fw.y));
  float wv = mix(win * on * lvl, 0.15, aa) * (1.0 - top);
  float rise = vS.z, sink = vS.w;
  wv *= smoothstep(0.55, 1.0, rise);
  float blow = smoothstep(0.0, 0.12, sink) * (1.0 - smoothstep(0.12, 0.4, sink));
  wv *= (1.0 + 4.0 * blow) * (1.0 - smoothstep(0.25, 0.5, sink));
  vec3 wc = winCol(mh11(seed * 13.1 + floor(id.y / 7.0) * 0.37) * 0.6 + vP.y * 0.4);
  float wr = rip * mix(win, 0.3, aa) * (1.0 - top);
  col = vec3(0.010, 0.007, 0.022) + uFogA * 0.12 * (vL.y / H) * (1.0 - top);
  col += wc * wv * 0.95 * (1.0 - 0.7 * m) + uRipCol * wr * 2.4 * (1.0 - 0.4 * m);
  // neon roof outline + some corner strips
  float hasNeon = step(0.38, vP.y);
  vec3 nc = mix(mix(vec3(1.0,0.16,0.78), uAccent, 0.45), mix(vec3(0.1,0.9,1.0), uAccent2, 0.45), step(0.69, vP.y));
  float fy = fwidth(vL.y) + 0.05;
  float eTop = 1.0 - smoothstep(0.0, 0.45 + fy, H - vL.y);
  float half1 = abs(n.x) > 0.5 ? vS.y * 0.5 : vS.x * 0.5;
  float ec = abs(n.x) > 0.5 ? abs(vL.z) : abs(vL.x);
  float eCorner = (1.0 - smoothstep(0.0, 0.35 + fwidth(ec), half1 - ec)) * step(0.8, mh11(seed * 5.3)) * smoothstep(0.0, H * 0.6, vL.y);
  float eRoof = 1.0 - smoothstep(0.0, 0.6 + fwidth(vL.x), min(vS.x * 0.5 - abs(vL.x), vS.y * 0.5 - abs(vL.z)));
  float neon = hasNeon * max(max(eTop * (1.0 - top), eRoof * top), eCorner * 0.6);
  float npulse = 0.75 + 0.25 * sin(uTime * (0.7 + seed * 1.3) + seed * 40.0);
  col += nc * neon * 1.9 * npulse * (1.0 - 0.55 * m) * smoothstep(0.7, 1.0, rise) * (1.0 - smoothstep(0.0, 0.3, sink)) * (1.0 + rip * 2.0);
  // street smog pooling + distance fog
  col = mix(col, uFogB * 1.25, fo.z * 0.55 * (1.0 - fo.x));
  col = mix(col, fogCol(fo), fo.x);
  gl_FragColor = vec4(finish(col), 1.0);
}`;

// ---------------- sky backdrop: smog gradient, far arcology skyline, lit smog banks ----------------
export const V_SKY = `void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }`;
export const F_SKY = `
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { if (float(i) >= uOct) break; s += a * nz(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes; float asp = uRes.x / uRes.y;
  float y = uv.y - uHz; float m = gmask();
  vec3 col = mix(uFogB * 1.1, vec3(0.05, 0.011, 0.065), smoothstep(0.0, 0.09, y));
  col = mix(col, vec3(0.005, 0.002, 0.014), smoothstep(0.07, 0.5, y));
  col = mix(col, uFogB * 0.75, smoothstep(0.0, -0.25, y));
  float px = uv.x * asp + uPar.x * 0.6;
  // smog banks lit from below by the city
  float cl = fbm3(vec3(px * 1.4 + uTime * 0.004, y * 7.0 - uTime * 0.002, uTime * 0.012));
  col += vec3(0.22, 0.05, 0.15) * smoothstep(0.42, 0.85, cl) * exp(-max(y, 0.0) * 6.0) * (1.0 - 0.4 * m);
  // far skyline (dense, low)
  float xs = px * 70.0; float id = floor(xs); float fx = fract(xs);
  float hg = 0.006 + 0.035 * pow(mh11(id * 1.37), 2.2) + 0.03 * step(0.93, mh11(id * 7.1));
  hg *= smoothstep(-0.02, 0.6, uBuild) * (1.0 - uSink * 0.7);
  float sil = step(y, hg) * step(0.08, fx) * step(fx, 0.92);
  vec2 wg = floor(vec2(fx * 4.0, (y * uRes.y) / 3.0));
  float wl = step(0.86, mh13(vec3(wg, id + floor(uTime * 0.2 + mh11(id) * 5.0)))) * step(0.15, y * 100.0);
  vec3 scol = uFogB * 0.42 + vec3(0.012, 0.0, 0.025) + vec3(1.0, 0.55, 0.2) * wl * 0.35 * (1.0 - 0.5 * m);
  col = mix(col, scol, sil * 0.9);
  // megastructure arcologies, mostly at the sides (behind the overlay / right strip)
  float xs2 = px * 7.0 + 0.3; float id2 = floor(xs2); float f2 = fract(xs2);
  float side = max(1.0 - smoothstep(0.18, 0.34, uv.x), smoothstep(0.86, 0.97, uv.x));
  float w2 = 0.18 + 0.3 * mh11(id2 * 4.1);
  float h2 = (0.05 + 0.22 * pow(mh11(id2 * 2.9), 1.5)) * mix(0.22, 1.0, side);
  h2 *= smoothstep(0.1, 0.9, uBuild) * (1.0 - smoothstep(0.0, 0.6, uSink));
  float tw = 1.0 - smoothstep(0.0, 0.02, y - h2 * (1.0 - 0.35 * smoothstep(0.5 - w2, 0.5, abs(f2 - 0.5) + 0.5 - w2)));
  float in2 = step(abs(f2 - 0.5), w2) * tw;
  float edge = exp(-abs(abs(f2 - 0.5) - w2) * 900.0 / asp) * step(y, h2) * step(-0.02, y);
  vec3 ecol = mix(mix(vec3(1.0, 0.2, 0.75), uAccent, 0.4), mix(vec3(0.15, 0.9, 1.0), uAccent2, 0.4), step(0.5, mh11(id2 * 9.3)));
  float bands = step(0.7, fract(y * 60.0 + mh11(id2) * 3.0)) * 0.5 + 0.5;
  col = mix(col, vec3(0.008, 0.004, 0.02) + uFogB * 0.18 * smoothstep(h2, 0.0, y), in2 * 0.95);
  col += ecol * edge * 1.3 * bands * (1.0 - 0.6 * m);
  float bx = abs(f2 - 0.5) / w2; float beac = exp(-pow((y - h2) * uRes.y / 3.0, 2.0) - bx * bx * 60.0) * step(0.55, fract(uTime * 0.8 + mh11(id2 * 3.3)));
  col += vec3(1.0, 0.1, 0.12) * beac * 1.8 * step(abs(f2 - 0.5), w2);
  // ripple: a travelling ring along the horizon glow
  float rr = abs(abs(uv.x - 0.64) * asp - uRip.z * 0.9) ;
  col += uRipCol * exp(-rr * 30.0) * exp(-abs(y) * 14.0) * uRip.w * exp(-uRip.z * 0.9) * 0.6;
  gl_FragColor = vec4(finish(col), 1.0);
}`;

// ---------------- flying cars: streak quads on 3 sky lanes ----------------
export const V_CAR = `
attribute vec4 aCar; attribute vec4 aCar2;
varying vec2 vUv; varying vec3 vC; varying float vA;
vec3 lane(float li, float x){
  return vec3(x, li * 34.0 + (16.0 + li * 7.0) * sin(x * 0.0021 + li * 2.1), -540.0 - li * 340.0 + (70.0 + li * 40.0) * sin(x * 0.0013 + li * 1.3));
}
void main(){
  float li = aCar.y, dir = aCar.z;
  float s = fract(aCar.x + uCarPh * aCar.w * dir / 3200.0 + dir * uSink * uSink * 0.35);
  float x = mix(-1600.0, 1600.0, s);
  vec3 P = lane(li, x) + vec3(0.0, dir * 2.5, dir * 6.0 + aCar2.w * 10.0);
  vec3 T = normalize(lane(li, x + 3.0) - lane(li, x - 3.0)) * dir;
  vec3 wc = (modelMatrix * vec4(P, 1.0)).xyz;
  vec3 V = normalize(cameraPosition - wc);
  vec3 S = normalize(cross(T, V));
  float dist = distance(cameraPosition, wc);
  float w = max(1.1, dist * 0.0019);
  float len = aCar2.x * (1.0 - 0.45 * uBrake) * (1.0 + uSink * 3.0);
  vec3 wp = wc + T * position.x * len + S * position.y * w;
  vUv = position.xy + 0.5;
  vec3 c = dir > 0.0 ? mix(vec3(0.55, 0.95, 1.0), uAccent2, 0.35) : mix(vec3(1.0, 0.18, 0.5), uAccent, 0.35);
  c = mix(c, vec3(1.0, 0.6, 0.15), step(0.86, aCar2.y));
  float blink = step(0.9, aCar2.z) * step(0.5, fract(uTime * 1.3 + aCar2.z * 7.0));
  c += vec3(1.0, 0.3, 0.9) * blink * 1.5;
  c = mix(c, vec3(1.0, 0.08, 0.06) * 1.6, uBrake);
  vC = c;
  float vis = step(aCar2.y, uBuild * 1.05) * (1.0 - smoothstep(0.4, 1.0, uSink));
  vA = vis * smoothstep(0.0, 0.06, s) * (1.0 - smoothstep(0.94, 1.0, s));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
export const F_CAR = `
varying vec2 vUv; varying vec3 vC; varying float vA;
void main(){
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float a = (pow(vUv.x, 2.5) * 0.8 + smoothstep(0.82, 1.0, vUv.x) * 1.4) * across * across;
  vec3 col = vC * a * vA * 1.5 * (1.0 - 0.45 * gmask());
  gl_FragColor = vec4(finish(col), 1.0);
}`;

// ---------------- searchlights: instanced open cones ----------------
export const V_BEAM = `
attribute vec4 aL; attribute vec4 aL2;
varying vec3 vW; varying vec3 vN; varying float vY; varying float vK;
void main(){
  float ang = uTime * 6.2832 / aL2.x * (1.0 + 0.4 * uAlert) + aL2.y;
  float yaw = sin(ang) * 0.85;
  float tilt = aL2.z + 0.16 * sin(ang * 0.71 + 1.3);
  float e = smoothstep(0.0, 1.0, clamp(uBuild * 1.4 - aL.w * 0.4, 0.0, 1.0));
  tilt = mix(1.5, tilt, e) + uSink * uSink * 1.2;
  vec3 d = normalize(vec3(sin(yaw) * sin(tilt), cos(tilt), -0.4 * sin(tilt)));
  vec3 r = normalize(cross(d, vec3(0.0, 0.0, 1.0))); vec3 f = cross(r, d);
  float L = aL2.w; float R = L * 0.075;
  vec3 lp = position;
  vec3 p = aL.xyz + d * lp.y * L + (r * lp.x + f * lp.z) * R;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz; vN = r * normal.x + d * normal.y + f * normal.z; vY = lp.y;
  vK = e * (1.0 - smoothstep(0.3, 1.0, uSink));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
export const F_BEAM = `
varying vec3 vW; varying vec3 vN; varying float vY; varying float vK;
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float th = pow(abs(dot(normalize(vN), V)), 1.6);
  float a = th * pow(1.0 - vY, 1.7) * smoothstep(0.0, 0.04, vY);
  float smog = 0.45 + 1.1 * nz(vW * 0.007 + vec3(0.0, uTime * 0.06, uTime * 0.03));
  vec3 bc = mix(vec3(0.7, 0.85, 1.0), uAccent2, 0.35);
  vec3 col = bc * a * smog * 0.17 * vK * (1.0 - 0.5 * gmask());
  gl_FragColor = vec4(finish(col), 1.0);
}`;

// ---------------- rain: world-wrapped LineSegments around the camera ----------------
export const V_RAIN = `
attribute float aEnd;
varying float vA; varying float vE;
void main(){
  vec3 B = vec3(576.0, 320.0, 440.0);
  vec3 C = cameraPosition + vec3(0.0, 0.0, -240.0);
  vec3 dirv = normalize(vec3(0.18, -1.0, 0.0));
  vec3 p = position * B + vec3(0.18, -1.0, 0.0) * uRainPh;
  p = mod(p - C + B * 0.5, B) - B * 0.5 + C;
  float len = 4.0 + 5.0 * fract(position.x * 37.0);
  p -= dirv * len * aEnd;
  float dist = distance(cameraPosition, p);
  vA = (0.1 + 0.18 * fract(position.y * 53.0)) * smoothstep(30.0, 90.0, dist) * (1.0 - smoothstep(330.0, 440.0, dist));
  vA *= smoothstep(0.2, 0.8, uBuild) * (1.0 - uSink);
  vE = aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
export const F_RAIN = `
varying float vA; varying float vE;
void main(){
  vec3 col = mix(vec3(0.55, 0.7, 1.0), uAccent2, 0.25) * vA * (1.0 - vE * 0.8) * (1.0 - 0.7 * gmask());
  gl_FragColor = vec4(finish(col), 1.0);
}`;

// ---------------- holographic ad panels: abstract shapes only ----------------
export const V_AD = `
attribute vec4 aA; attribute vec4 aA2;
varying vec2 vUv; varying vec4 vI;
void main(){
  float e = clamp(uBuild * 1.5 - aA2.z * 0.5, 0.0, 1.0);
  float sy = smoothstep(0.0, 0.6, e) * (1.0 - smoothstep(0.0, 0.5, uSink));
  float sx = mix(0.02, 1.0, smoothstep(0.3, 1.0, e)) * (1.0 - smoothstep(0.45, 0.9, uSink));
  sy = max(sy, 0.004 * step(uSink, 0.9) * step(0.01, e));
  vec3 p = aA.xyz + vec3(position.x * aA2.x * sx, position.y * aA2.y * sy, 0.0);
  vUv = position.xy + 0.5; vI = vec4(aA.w, aA2.x / aA2.y, aA2.z, e);
  gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(p, 1.0));
}`;
export const F_AD = `
varying vec2 vUv; varying vec4 vI;
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * p; }
void main(){
  float seed = vI.z; float t = uTime;
  float kk = mod(vI.x + floor(t / 9.0 + seed * 3.0), 3.0);
  float sw = fract(t / 9.0 + seed * 3.0);
  vec2 uv = vUv;
  float gl = step(0.985, sw) + step(sw, 0.015) + uPulse * 0.6;
  uv.x += (mh12(vec2(floor(uv.y * 40.0), floor(t * 20.0))) - 0.5) * 0.12 * min(gl, 1.0);
  vec2 p = (uv - 0.5) * vec2(vI.y, 1.0);
  float r = length(p); float an = atan(p.y, p.x);
  vec3 cA = mix(vec3(1.0, 0.2, 0.78), uAccent, 0.4), cB = mix(vec3(0.15, 0.9, 1.0), uAccent2, 0.4), cC = vec3(1.0, 0.6, 0.2);
  // A: iris rings
  float rings = exp(-abs(fract(r * 6.0 - t * 0.25) - 0.5) * 22.0) * step(r, 0.46);
  float ticks = step(0.6, fract(an * 3.8197 + t * 0.15)) * step(0.36, r) * step(r, 0.44);
  vec3 dA = cA * rings * 0.7 + cB * ticks * 0.9 + cB * exp(-r * 14.0) * 1.2;
  // B: equalizer bars + abstract glyph column
  float bx = floor(uv.x * 9.0); float bh = 0.15 + 0.75 * nz(vec3(bx * 3.1, t * 0.9, seed * 9.0));
  float bars = step(uv.y, bh) * step(0.18, fract(uv.x * 9.0)) * step(fract(uv.y * 30.0), 0.7) * step(0.3, uv.x);
  vec2 gc = floor(vec2(uv.x * 14.0, uv.y * 26.0 + t * 1.5));
  float gly = step(0.55, mh13(vec3(gc, floor(t * 0.7)))) * step(uv.x, 0.22) * step(0.04, uv.x) * step(0.25, fract(uv.y * 26.0 + t * 1.5));
  vec3 dB = mix(cB, cA, uv.y) * bars * 0.8 + cC * gly * 0.8;
  // C: nested rotating diamonds with a sweep
  vec2 q1 = rot(p, t * 0.4), q2 = rot(p, -t * 0.27 + 0.6);
  float d1 = abs(abs(q1.x) + abs(q1.y) - 0.3), d2 = abs(max(abs(q2.x), abs(q2.y)) - 0.18);
  float sweep = exp(-abs(fract(uv.y - t * 0.2) - 0.5) * 30.0);
  vec3 dC = cA * exp(-d1 * 70.0) * 1.2 + cB * exp(-d2 * 80.0) * 1.0 + cB * sweep * 0.12;
  vec3 col = dA * step(kk, 0.5) + dB * step(0.5, kk) * step(kk, 1.5) + dC * step(1.5, kk);
  // holographic frame + fill + scanlines + flicker
  vec2 fe = min(vUv, 1.0 - vUv) * vec2(vI.y, 1.0);
  float frame = exp(-min(fe.x, fe.y) * 160.0);
  col += (cA * 0.5 + cB * 0.5) * frame * 1.1 + cB * 0.035;
  col *= 0.72 + 0.28 * step(0.5, fract(gl_FragCoord.y * 0.33));
  col *= 0.88 + 0.12 * step(0.08, mh11(floor(t * 11.0) + seed * 50.0));
  col += uRipCol * uRip.w * exp(-uRip.z * 1.3) * exp(-abs(vUv.y - fract(uRip.z * 0.8)) * 25.0) * 0.8;
  col *= smoothstep(0.4, 1.0, vI.w) * (1.0 - 0.6 * gmask());
  gl_FragColor = vec4(finish(col), 1.0);
}`;
