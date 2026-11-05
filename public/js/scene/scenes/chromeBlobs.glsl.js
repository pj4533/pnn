// chromeBlobs shaders. Every program gets the ctx preamble (COMMON + guard/alertMix/finish) prepended by chromeBlobs.js.
// Shared virtual camera: ro = uRayOrigin + uPar, basis uRayBasis (right, up, back), focal uFocal, principal point uCenter.

export const CAM = /* glsl */`
uniform vec3 uRayOrigin; uniform mat3 uRayBasis; uniform vec3 uPar; uniform vec2 uCenter; uniform float uFocal; uniform float uST;
vec3 camRO(){ return uRayOrigin + uPar; }
// world (virtual) -> screen uv; w = view depth (<0 = behind)
vec3 project(vec3 P){
  vec3 v = transpose(uRayBasis) * (P - camRO());
  float dz = max(-v.z, 0.05);
  vec2 q = v.xy * uFocal / dz;
  return vec3(uCenter + q / vec2(uRes.x / uRes.y, 1.0), -v.z);
}
float boxIn(vec2 uv){ vec2 m = smoothstep(uGuardRect.xy - 0.06, uGuardRect.xy + 0.02, uv) * (1.0 - smoothstep(uGuardRect.zw - 0.02, uGuardRect.zw + 0.06, uv)); return m.x * m.y; }
`;

export const FS_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

// ---------- low-res raymarch layer: rgb = chrome, a = hit distance (0 = miss) ----------
export const MARCH_FRAG = /* glsl */`
varying vec2 vUv;
uniform vec4 uB[6]; uniform float uNB, uSteps, uWob, uRim, uMaskR, uK; uniform vec4 uBound;
float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float map(vec3 p){
  float d = 1e3;
  for (int i = 0; i < 6; i++){ if (float(i) >= uNB) break; vec4 b = uB[i]; d = smin(d, length(p - b.xyz) - b.w, uK); }
  return d + uWob * sin(p.x * 3.1 + uST * 2.3) * sin(p.y * 2.7 - uST * 1.7) * sin(p.z * 3.3 + uST * 1.9);
}
vec3 nrm(vec3 p){
  const vec2 e = vec2(1.0, -1.0) * 0.004;
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}
// fake neon studio: gradient horizon, sun band with scrolling slits, cyan strip lights, softbox, floor grid
vec3 env(vec3 r){
  float y = r.y, az = atan(r.x, r.z);
  vec3 c = mix(vec3(0.018, 0.003, 0.045), vec3(0.0, 0.0, 0.004), smoothstep(0.0, 0.6, y));
  vec3 sunA = mix(vec3(2.6, 0.1, 1.2), uAccent * 2.4, 0.3), sunB = vec3(2.8, 1.2, 0.18);
  float band = smoothstep(0.0, 0.015, y) * (1.0 - smoothstep(0.2, 0.3, y));            // the sun disc band on the horizon
  float slit = step(0.42, fract(y * 20.0 - uST * 0.4));
  float lit = mix(slit, 1.0, smoothstep(0.08, 0.16, y));                               // slits only on its lower half
  c += mix(sunA, sunB, smoothstep(0.0, 0.26, y)) * band * lit * (0.55 + 0.45 * cos(az * 1.5 - uST * 0.25));
  vec3 cy = mix(vec3(0.15, 1.8, 2.4), uAccent2 * 2.3, 0.35);
  c += cy * pow(abs(sin(az * 2.5 + uST * 0.4)), 120.0) * smoothstep(0.25, 0.32, y) * smoothstep(0.9, 0.6, y) * 1.4;
  c += vec3(1.3, 1.2, 1.6) * smoothstep(0.93, 0.985, y);                                    // overhead softbox
  c += vec3(2.0, 0.3, 1.6) * pow(abs(sin(az * 6.0 - uST * 0.9)), 260.0) * smoothstep(0.6, 0.68, y) * smoothstep(0.8, 0.7, y);
  if (y < 0.0){
    vec2 g = r.xz / max(-y, 0.12) * 0.28 + vec2(0.0, uST * 0.6);
    vec2 gl = abs(fract(g) - 0.5);
    float line = smoothstep(0.4, 0.48, max(gl.x, gl.y)) * smoothstep(-0.9, -0.3, y) * smoothstep(-0.02, -0.12, y);
    c = vec3(0.004, 0.0, 0.012) + mix(vec3(2.0, 0.12, 1.5), cy, 0.3) * line * 0.9 + sunA * 0.35 * exp(y * 14.0);
  }
  return c;
}
void main(){
  vec2 q = (vUv - uCenter) * vec2(uRes.x / uRes.y, 1.0);
  float rr = length(q);
  if (rr > uMaskR){ gl_FragColor = vec4(0.0); return; }
  float mask = 1.0 - smoothstep(uMaskR * 0.7, uMaskR, rr);
  vec3 ro = camRO(), rd = uRayBasis * normalize(vec3(q, -uFocal));
  vec3 oc = ro - uBound.xyz; float b = dot(oc, rd), h = b * b - dot(oc, oc) + uBound.w * uBound.w;
  vec3 col = vec3(0.0); float hitT = 0.0;
  if (h > 0.0){
    float sh = sqrt(h), t = max(-b - sh, 0.0), tmax = -b + sh, md = 1e3; bool hit = false;
    for (int i = 0; i < 24; i++){
      if (float(i) >= uSteps) break;
      float d = map(ro + rd * t); md = min(md, d);
      if (d < 0.003 * t){ hit = true; break; }
      t += d * 0.92; if (t > tmax) break;
    }
    vec3 rim = mix(uAccent, uAccent2, 0.5 + 0.5 * sin(uST * 0.7 + q.y * 6.0));
    if (hit){
      vec3 p = ro + rd * t, n = nrm(p), rf = reflect(rd, n);
      float fr = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);
      col = env(rf) * mix(vec3(0.7, 0.68, 0.78), vec3(1.0), fr);                            // chrome = env, slightly tinted
      col += rim * fr * (0.35 + uRim * 2.2);                                                   // fresnel neon rim
      col += vec3(0.012, 0.0, 0.02) * (0.5 + 0.5 * n.y);                                      // dark ambient lift
      hitT = t;
    } else {
      col = rim * exp(-md * 9.0) * (0.08 + uRim * 0.8);                                       // neon halo near the surface
    }
  }
  gl_FragColor = vec4(col * mask, hitT);
}`;

// ---------- backdrop composite: dark studio void + layer + shockwave ring + exit glint ----------
export const BACK_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D uLayer; uniform vec2 uRip; uniform float uGlint, uEnter;
void main(){
  vec2 uv = vUv, asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 q = (uv - project(vec3(0.0)).xy) * asp; float r = length(q);
  // void: deep violet, soft studio pool of light under the cluster, faint drifting caustics (upper/left only)
  vec3 col = mix(vec3(0.003, 0.001, 0.008), vec3(0.008, 0.002, 0.016), smoothstep(1.0, 0.0, uv.y));
  col += mix(uAccent, vec3(0.5, 0.1, 0.9), 0.5) * 0.035 * exp(-r * 6.0) * uEnter;
  float cz = vnoise(vec3(uv * vec2(5.0, 3.0) + vec2(uST * 0.05, -uST * 0.03), uST * 0.05));
  float cs = smoothstep(0.55, 0.75, cz) * (1.0 - smoothstep(0.42, 0.6, uv.x)) * smoothstep(0.35, 0.9, uv.y);
  col += mix(vec3(0.6, 0.1, 0.9), uAccent2, 0.4) * cs * 0.03;
  // distant strip lights in the top band: thin horizontal neon tubes slowly drifting
  float yb = uv.y - 0.86;
  float tube = exp(-abs(fract((uv.y - 0.8) * 9.0 - uST * 0.04) - 0.5) * 120.0) * smoothstep(0.8, 0.9, uv.y) * (1.0 - smoothstep(0.2, 0.55, uv.x));
  col += mix(vec3(0.1, 0.9, 1.3), uAccent2, 0.4) * tube * 0.25 * (0.6 + 0.4 * sin(uv.x * 7.0 + uST * 0.3));
  // the chrome
  vec4 L = texture2D(uLayer, uv);
  col += L.rgb;
  // splash shockwave: expanding neon ring from the cluster
  float rr = uRip.x * 0.75;
  float ring = exp(-abs(r - rr) * 150.0) * uRip.y * smoothstep(0.0, 0.05, uRip.x);
  col += mix(uAccent2, vec3(1.2, 1.2, 1.4), 0.3) * ring * 1.3 * (1.0 - smoothstep(0.3, 0.75, rr));
  // exit glint: four-point star
  vec2 g = abs(q);
  float star = (exp(-g.y * 260.0) * exp(-g.x * 22.0) + exp(-g.x * 260.0) * exp(-g.y * 22.0) + exp(-r * 45.0)) * uGlint * (1.0 - 0.8 * boxIn(uv));
  col += vec3(1.6, 1.4, 1.8) * star * 1.6;
  gl_FragColor = vec4(finish(col), 1.0);
}`;

// ---------- neon tori: projected through the virtual camera, occluded by the chrome via layer depth ----------
export const TORUS_VERT = /* glsl */`
uniform mat3 uRot; uniform float uRad, uScale;
varying vec2 vUv2; varying vec3 vScr; varying float vD;
void main(){
  vec3 P = uRot * (position * uRad * uScale);
  vec3 s = project(P);
  vScr = s; vUv2 = uv; vD = length(P - camRO());
  gl_Position = vec4(s.xy * 2.0 - 1.0, 0.5, s.z > 0.1 ? 1.0 : -1.0);
}`;
export const TORUS_FRAG = /* glsl */`
uniform sampler2D uLayer; uniform float uFlare, uHue, uScale;
varying vec2 vUv2; varying vec3 vScr; varying float vD;
void main(){
  float a = vUv2.x;                                                    // around the ring
  vec3 col = mix(mix(vec3(1.9, 0.15, 1.2), uAccent * 1.8, 0.4), mix(vec3(0.15, 1.5, 2.1), uAccent2 * 1.8, 0.4), 0.5 + 0.5 * sin(a * 6.2832 + uHue));
  float dash = pow(fract(a * 3.0 - uST * 0.35), 6.0);                  // light packets chasing around the ring
  col *= 0.45 + 1.6 * dash + uFlare * 1.5;
  vec4 L = texture2D(uLayer, vScr.xy);
  col *= (L.a > 0.0 && L.a < vD) ? 0.08 : 1.0;                          // passes behind the chrome
  col *= 1.0 - 0.85 * boxIn(vScr.xy);                                   // only a faint arc over the hologram
  col *= smoothstep(0.0, 0.2, uScale);
  gl_FragColor = vec4(finish(col), 1.0);
}`;

// ---------- glitter dust: 3k points swirling around the cluster, 1 in 5 is a fast comet ----------
export const DUST_VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uSpread, uDustA, uPunch, uSize;
varying vec3 vCol; varying float vA; varying vec3 vScr; varying float vD;
void main(){
  float fast = step(0.8, aSeed.w);
  float ang = position.x + uST * (mix(0.05, 0.6, fast) + aSeed.z * 0.06) / (0.4 + position.y * 0.15);
  float rad = position.y * uSpread * (1.0 + uPunch * (0.6 + aSeed.x));
  float yy = mod(position.z + uST * mix(0.12, -0.5, fast) * (0.5 + aSeed.y) + 6.0, 12.0) - 6.0;
  vec3 P = vec3(cos(ang) * rad, yy * (0.35 + 0.2 * aSeed.x), sin(ang) * rad);
  P.y += sin(ang * 2.0 + aSeed.y * 6.28) * 0.4;
  vec3 s = project(P);
  vScr = s; vD = length(P - camRO());
  float tw = pow(fract(aSeed.z * 13.7 + uST * (0.3 + aSeed.x * 1.2)), 24.0);  // glitter flash
  float g = 1.0 - 0.88 * boxIn(s.xy);
  vA = (0.5 + 3.0 * tw + fast * 0.9) * g * uDustA * smoothstep(1.0, 3.0, s.z);
  vCol = mix(mix(vec3(1.0, 0.75, 0.4), vec3(1.0, 0.4, 0.95), aSeed.y), mix(vec3(0.5, 1.0, 1.2), uAccent2, 0.5), step(0.6, aSeed.x));
  float sz = uSize * (0.6 + 1.2 * tw + fast * 0.8) * 9.0 / max(s.z, 1.0);
  gl_PointSize = clamp(sz * uRes.y / 1080.0, 1.0, 48.0);
  gl_Position = vec4(s.xy * 2.0 - 1.0, 0.5, s.z > 0.5 ? 1.0 : -1.0);
}`;
export const DUST_FRAG = /* glsl */`
uniform sampler2D uLayer;
varying vec3 vCol; varying float vA; varying vec3 vScr; varying float vD;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  float k = exp(-d * d * 30.0) + 0.6 * exp(-abs(c.x) * 40.0) * exp(-abs(c.y) * 6.0) * step(1.2, vA);   // sparkle cross on flashes
  vec4 L = texture2D(uLayer, vScr.xy);
  float occ = (L.a > 0.0 && L.a < vD) ? 0.05 : 1.0;
  vec3 col = vCol * vA * k * occ;
  gl_FragColor = vec4(finish(col), 1.0);
}`;
