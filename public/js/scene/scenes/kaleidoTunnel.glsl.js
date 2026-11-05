// kaleidoTunnel shaders. KIFS corridor raymarch (quarter-res layer), upsample backdrop, streak dust.
// The layer writes raw HDR glow (no guard: it renders off-screen at 1/4 res); guard/alert/fade are applied
// in the full-res backdrop via finish().

export const FS_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

// Kaleido corridor. Shared uniforms come from the header (COMMON).
export const LAYER_FRAG = /* glsl */`
varying vec2 vUv;
uniform vec3 uRayOrigin;
uniform mat3 uRayBasis;
uniform vec2 uVP;
uniform float uSteps, uFolds, uScale, uSquash, uOver, uGlow;
uniform vec4 uRot;          // cos/sin of fold angle A (xy) and B (xz)
uniform vec3 uOff;
uniform vec3 uRing;         // x = distance ahead, y = amplitude, z = radius
uniform vec3 uRingCol;
uniform float uDrift, uLand;
// the corridor converges on the widget: calm eye at the vanishing point, bright eye-wall rim (layer res, so uv-based)
float ktEye(vec2 q){ return smoothstep(0.78, 1.18, length((q - uHero.xy) / max(uHero.zw, vec2(1e-3)))); }
float ktRim(vec2 q){ float r = length((q - uHero.xy) / max(uHero.zw, vec2(1e-3))); return exp(-pow(abs((r - 1.35) * 3.2), 2.0)); }

const float PER = 2.0;          // slice spacing; slices alternate lace / counter-rotated echo

float ktHash(float n){ n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }

// 2D kaleido-IFS lace: polar 8-fold, then abs/rotate/scale folds. Returns line distance; trap = orbit trap; node = fold-centre distance.
float lace(vec2 xy, out float trap, out float node){
  float r = length(xy);
  // 16-fold mirror (8 sectors, each mirrored) without atan: octant fold then a 22.5 deg reflection
  vec2 v = abs(xy);
  v = v.y > v.x ? v.yx : v;
  const vec2 N = vec2(-0.38268343, 0.92387953);
  v -= 2.0 * min(dot(v, N), 0.0) * N;
  float sa = v.y / max(r, 1e-3);
  v.x -= 3.6;
  float s = 1.0;
  trap = 10.0; node = 10.0;
  for (int i = 0; i < 4; i++){
    if (float(i) >= uFolds) break;
    v = abs(v) - uOff.xy;
    v = mat2(uRot.x, uRot.y, -uRot.y, uRot.x) * v;
    v *= uScale; s *= uScale;
    trap = min(trap, abs(v.x) * 0.5 + abs(v.y));
    if (i == 1) node = length(v) / s;
  }
  float d = min(abs(v.x), abs(v.y)) / s;
  // structural arch ring + outer nave wall
  d = min(d, abs(r * (0.95 + 0.25 * sa * sa) - 2.6));
  return d;
}

void main(){
  vec2 uv = (vUv - uVP) * vec2(uRes.x / uRes.y, 1.0);
  vec3 rd = uRayBasis * normalize(vec3(uv, -1.05));
  vec3 ro = uRayOrigin;
  vec3 MAG = mix(vec3(1.0, 0.10, 0.72), uAccent, 0.35);
  vec3 CYA = mix(vec3(0.0, 0.80, 1.0), uAccent2, 0.35);
  vec3 AMB = vec3(1.0, 0.52, 0.10);
  vec3 VIO = vec3(0.30, 0.10, 0.55);
  float ad = abs(uStory.x), dn = max(-uStory.x, 0.0);
  MAG = mix(MAG, uStoryCol, 0.15 + 0.25 * ad); CYA = mix(CYA, uStoryCol, 0.10 + 0.2 * ad);      // the story colour owns the cathedral
  MAG = mix(MAG, vec3(1.0, 0.12, 0.08), dn * 0.35); CYA = mix(CYA, vec3(1.0, 0.4, 0.2), dn * 0.45);   // down: red-shift
  vec3 col = vec3(0.0);
  float fz = max(-rd.z, 1e-3);
  float k0 = floor(ro.z / PER);
  float pxw = 1.15 / (1.05 * uRes.y * 0.25);        // world size of ~1.6 layer px at unit distance
  for (int i = 0; i < 48; i++){
    if (float(i) >= uSteps) break;
    float k = k0 - float(i);
    float t = (ro.z - k * PER) / fz;
    if (t < 0.2) continue;
    float fog = exp(-t * 0.05);
    float fw = pxw * t + 0.004;
    float lod = clamp(0.022 / fw, 0.0, 1.0);        // far slices: lines would become area, fade them
    if (fog * lod < 0.05) break;                      // everything further is invisible
    vec2 hp = (ro + rd * t).xy;
    float r = length(hp);
    if (uSquash > 0.99 && (r < 1.75 || r > 5.5)) continue;   // outside the lace annulus
    float even = mod(k, 2.0);
    // odd slices: counter-rotated echo of the lace (layered kaleidoscope)
    hp = even > 0.5 ? mat2(uRot.z, uRot.w, -uRot.w, uRot.z) * hp : hp;
    hp.y /= uSquash;                                 // enter/exit: lattice pressed into a horizontal seam
    r = length(hp);
    float tr, nd;
    float d = lace(hp, tr, nd) * uSquash;
    float line = exp(-d * d / (fw * fw)) + 0.05 / (1.0 + d * d / (fw * fw * 30.0));
    float nodeG = exp(-nd * nd / (fw * fw * 4.0)) * 0.8;
    float ann = smoothstep(1.8, 2.25, r) * (1.0 - smoothstep(3.9, 5.4, r));   // open axis, lace stops at the nave wall
    float cell = mod(k, 64.0);
    float h = fract(ktHash(cell + 3.0) * 0.5 + tr * 0.35 + uDrift);
    vec3 c = mix(MAG, mix(MAG, AMB, 0.6), smoothstep(0.35, 0.85, h));
    c = mix(c, AMB * 1.4, exp(-tr * 6.0) * 0.7);       // amber seams on the fold planes
    c = even > 0.5 ? mix(c, CYA, 0.75) : c;           // echo slices run cyan
    c = mix(c, vec3(0.85, 0.75, 0.85), uOver * uOver);  // over-fold: white-hot seam
    vec3 add = c * line + CYA * nodeG * (1.0 - even * 0.5) + VIO * 0.05 * exp(-tr * 1.5);   // + chrome-violet glass
    col += add * ann * fog * lod * smoothstep(0.2, 1.2, t);
  }
  col *= uGlow * 0.55 * (1.0 - 0.8 * uOver);
  // ring of light racing down the corridor (analytic plane hit)
  float tp = uRing.x / fz;
  vec2 hq = (ro + rd * tp).xy;
  float ring = exp(-pow(abs((length(hq) - uRing.z) * 3.2), 2.0)) * uRing.y * step(0.0, uRing.x);
  col += uRingCol * ring * (0.9 + 0.7 * exp(-uRing.x * 0.15));
  // eye: ribs fall to a calm glow inside it and gather brightest on the eye-wall, in the story colour
  float ey = ktEye(vUv), rm = ktRim(vUv);
  col *= mix(0.12, 1.0, ey);
  col *= 1.0 + rm * (0.5 + 1.1 * uStory.y + 0.8 * uStory.w);
  col = mix(col, uStoryCol * dot(col, vec3(0.34)) * 1.9, 0.35 * rm);
  col += uStoryCol * rm * uLand * 1.5;
  gl_FragColor = vec4(min(col, vec3(2.2)), 1.0);
}`;

// Full-res composite: soft sharpen near the vanishing point, distance blur + 30% in the guard (hologram) side.
export const BACK_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tLayer;
uniform vec2 uVP;
uniform float uLayerScale, uSeam;
float ktRect(vec2 q){ return 1.0 - smoothstep(0.78, 1.18, length((q - uHero.xy) / max(uHero.zw, vec2(1e-3)))); }   // 1 in the calm eye
void main(){
  vec2 px = 1.0 / max(uRes * uLayerScale, vec2(1.0));
  float m = ktRect(vUv);
  float rad = mix(1.0, 3.6, m);
  vec3 c = texture2D(tLayer, vUv).rgb;
  vec3 n = texture2D(tLayer, vUv + vec2(px.x, 0.0) * rad).rgb + texture2D(tLayer, vUv - vec2(px.x, 0.0) * rad).rgb
         + texture2D(tLayer, vUv + vec2(0.0, px.y) * rad).rgb + texture2D(tLayer, vUv - vec2(0.0, px.y) * rad).rgb;
  vec3 sharp = c + (c * 4.0 - n) * 0.22;
  vec3 blur = (c + n) * 0.2;
  vec3 col = max(mix(sharp, blur, m), 0.0);
  vec2 d = (vUv - uVP) * vec2(uRes.x / uRes.y, 1.0);
  col *= mix(1.0, 0.3, m);
  // deep violet base + vanishing-point core
  float r2 = dot(d, d);
  col += vec3(0.012, 0.003, 0.026) * (1.2 - vUv.y * 0.6);
  col += mix(mix(vec3(1.0, 0.25, 0.7), uStoryCol, 0.6), vec3(1.0, 0.55, 0.15), 0.5 * uAlert) * (0.004 / (0.002 + r2 * 6.0)) * 0.12;
  col += uStoryCol * rim() * (0.03 + 0.05 * uStory.y + 0.1 * uStory.w);
  // horizontal white seam on enter/exit
  col += vec3(1.2, 1.0, 1.15) * uSeam * exp(-abs(d.y) * 260.0) * smoothstep(1.4, 0.0, abs(d.x));
  col *= 0.93 + 0.07 * step(0.5, fract(gl_FragCoord.y * 0.5));
  gl_FragColor = vec4(finish(col), 1.0);
}`;

// Streak dust: camera-independent clip-space points on the tunnel's virtual camera.
export const DUST_VERT = /* glsl */`
attribute vec4 aSeed;
uniform vec3 uRayOrigin;
uniform mat3 uRayBasis;
uniform vec2 uVP;
uniform float uFly, uSpeed, uScatter, uDustK;
varying vec2 vDir;
varying float vSize, vBri, vHue;
void main(){
  float D = mix(38.0, 0.35, fract(aSeed.z + uFly / 32.0));
  float ang = aSeed.x * 6.2831853;
  float rad = mix(1.25, 2.9, aSeed.y) * (1.0 + uScatter * 4.0 * aSeed.w);
  vec3 wp = vec3(cos(ang) * rad, sin(ang) * rad, uRayOrigin.z - D);
  vec3 cp = (wp - uRayOrigin) * uRayBasis;          // = transpose(basis) * v
  float z = max(-cp.z, 0.05);
  vec2 sp = uVP + cp.xy * 1.05 / z * vec2(uRes.y / uRes.x, 1.0);
  gl_Position = vec4(sp * 2.0 - 1.0, 0.0, 1.0);
  float len = length(cp.xy) * 1.05 / (z * z) * uSpeed * 0.022 * uRes.y;
  vSize = clamp(len + 2.5, 2.5, 48.0);
  gl_PointSize = vSize;
  vDir = normalize(cp.xy + 1e-4);
  vBri = smoothstep(22.0, 7.0, D) * smoothstep(0.35, 1.2, D) * uDustK;
  vHue = aSeed.w;
}`;

export const DUST_FRAG = /* glsl */`
uniform vec2 uVP;
varying vec2 vDir;
varying float vSize, vBri, vHue;
void main(){
  vec2 pc = gl_PointCoord - 0.5; pc.y = -pc.y;
  float along = dot(pc, vDir);
  float perp = dot(pc, vec2(-vDir.y, vDir.x)) * vSize;
  float a = exp(-perp * perp * 1.4) * (1.0 - smoothstep(0.30, 0.5, abs(along))) * (0.35 + 0.65 * (along + 0.5));
  vec3 c = mix(mix(vec3(0.2, 0.9, 1.0), uAccent2, 0.3), mix(vec3(1.0, 0.25, 0.8), uAccent, 0.3), step(0.62, vHue));
  c = mix(c, vec3(1.0, 0.65, 0.25), step(0.92, vHue));
  vec2 q = gl_FragCoord.xy / uRes;
  float e = smoothstep(0.78, 1.18, length((q - uHero.xy) / max(uHero.zw, vec2(1e-3))));
  c = mix(c, uStoryCol, 0.25 + 0.3 * rim());
  vec3 col = c * a * vBri * 1.8 * mix(0.15, 1.0, e) * (1.0 + 1.2 * rim());
  gl_FragColor = vec4(finish(col), 1.0);
}`;
