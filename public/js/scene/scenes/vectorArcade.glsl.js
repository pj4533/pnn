// Vector Arcade Void shaders. Vertex stages declare their own uniforms (COMMON is fragment-only: it uses gl_FragCoord).
// Everything is composed around the hero widget: uHero (cx,cy,rx,ry bottom-up uv) is the calm eye, the eye-wall rim sits at 1.35 hero radii.
export const GUARDV = /* glsl */`
float sqf(float x){ return x*x; }
uniform vec4 uHero; uniform vec4 uHeroW; uniform vec4 uStory; uniform vec3 uStoryCol; varying float vG;
float rhoV(vec2 q){ return length((q - uHero.xy) / max(uHero.zw, vec2(1e-3))); }
float guardV(vec4 cp){ return mix(.08, 1., smoothstep(.85, 1.25, rhoV(cp.xy / cp.w * .5 + .5))); }   // calm eye: wireframes fade out inside the widget
float rimZ(float rho){ return exp(-sqf((rho - 1.35) * 2.2)); }
vec3 rotA(vec3 v, vec3 a, float g){ float c=cos(g), s=sin(g); return v*c + cross(a,v)*s + a*dot(a,v)*(1.-c); }
// view-space point that projects to the given ndc at the given distance (respects the camera view offset)
vec3 viewAt(vec2 ndc, float dist){ return vec3((ndc.x + projectionMatrix[2][0]) * dist / projectionMatrix[0][0], (ndc.y + projectionMatrix[2][1]) * dist / projectionMatrix[1][1], -dist); }
`;
export const LINE_FS = /* glsl */`
varying vec3 vCol; varying float vA, vG;
void main(){ vec3 col = vCol * vA * vG; gl_FragColor = vec4(finish(col), 1.0); }
`;
// Polyhedra: spawn in the outer field, spiral toward the eye-wall (up) or drift out from it (down), orbit the rim, vanish.
// aOffset = (angle0, rho0, phase0); everything is placed in hero-ellipse polar coordinates then lifted into view space.
export const POLY_VS = GUARDV + /* glsl */`
attribute float aIdx; attribute vec3 aMid; attribute vec3 aDir; attribute vec3 aOffset; attribute vec4 aAxis; attribute vec4 aSeed;
uniform float uTravel, uSpin, uReveal, uExit, uK, uPulse, uOrbit, uWaveRho, uWaveA;
uniform vec3 uAccent, uAccent2;
varying vec3 vCol; varying float vA;
void main(){
  float sc = aSeed.x * (1. + uPulse * .12);
  float ph = fract(aOffset.z + uTravel * aSeed.y);
  bool giant = aSeed.x > 110.;
  float inw = uStory.x >= 0. ? 1. : -1.;
  float e = smoothstep(0., .72, ph);
  float rhoR = giant ? 3.4 : 1.3 + 1.5 * aSeed.w * aSeed.w;                 // orbit shell around the eye-wall
  float rho = inw > 0. ? mix(aOffset.y, rhoR, e) : mix(rhoR, aOffset.y, e);
  float twist = inw > 0. ? 2.4 * (1. - e) : -2.4 * e;              // spiral path
  float th = aOffset.x + twist * (aAxis.w > 0. ? 1. : -1.) + uOrbit * (.3 + aSeed.w * .5) * (aAxis.w > 0. ? 1. : -1.) / (.6 + rho * .5);
  float rv = clamp(uReveal * 1.7 - aSeed.w * .7, 0., 1.);          // per-instance stagger
  float vis = step(aIdx, rv + .0001);                               // vertex-order draw-on
  float head = vis * (1. - smoothstep(0., .14, rv - aIdx)) * step(rv, .999);
  float ex = uExit;
  rho *= 1. + ex * ex * 6. * (aSeed.z + .4);
  vec2 uv = uHero.xy + vec2(cos(th), sin(th)) * uHero.zw * rho;
  float dist = giant ? 2300. : 520. + 700. * fract(aSeed.z * 13.7);
  vec3 cv = viewAt(uv * 2. - 1., dist);
  vec3 p = mix(position, aMid, .5 * ex) + aDir * ex * ex * 3.2;     // exit: edges fly apart as loose segments
  float ang = uSpin * aAxis.w + aSeed.z * 40.;
  p = rotA(p * sc, aAxis.xyz, ang); p = rotA(p, vec3(0., 1., 0.), ang * .31);
  gl_Position = projectionMatrix * vec4(cv + p, 1.);
  float s = aSeed.z;
  vec3 col = s < .5 ? mix(vec3(0., .9, 1.), uAccent2, .35) : (s < .9 ? mix(vec3(1., .1, .7), uAccent, .35) : vec3(1., .65, .1));
  col = mix(col, uStoryCol * (.5 + .5 * dot(col, vec3(.4, .4, .4))), rimZ(rho) * .55);   // phosphor on the rim = story colour
  float wave = uWaveA * exp(-sqf((rho - uWaveRho) * 2.4));
  float fin = smoothstep(0., .07, ph) * (1. - smoothstep(.78, .95, ph));
  float I = (.3 + .35 * e) * (1. + head * 2.5) * (1. + uPulse * .5) + wave * 3.5;
  vCol = col * min(I, 2.0) * (giant ? .6 : 1.);
  vA = fin * vis * (1. - smoothstep(.5, 1., ex)) * smoothstep(0., 1., uK);
  vG = guardV(gl_Position);
}`;
// Battlezone saucers/tanks fly a tilted orbit around the widget (ring plane tilted toward the camera, front dips below the plinth).
// aArc = (orbitK, 0, signed rate, phase); aSeed = (kind, dist, tilt, scale 0..1).
export const SAUCER_VS = GUARDV + /* glsl */`
attribute float aModel; attribute float aIdx; attribute vec4 aArc; attribute vec4 aSeed;
uniform float uSauT, uReveal, uExit, uK, uPulse, uSpin;
uniform vec3 uAccent, uAccent2;
varying vec3 vCol; varying float vA;
void main(){
  float on = 1. - abs(aModel - aSeed.x);                // only the model matching this instance's kind draws
  float t = uSauT * aArc.z + aArc.w;
  float dist = aSeed.y;
  vec2 hc = uHero.xy * 2. - 1.;
  vec3 cc = viewAt(hc, dist);
  float rx = uHero.z * 2. * dist / projectionMatrix[0][0], ry = uHero.w * 2. * dist / projectionMatrix[1][1];
  float R = (rx + ry) * .5 * (1.55 + aArc.x);
  float zr = R * cos(t), tl = aSeed.z;
  vec3 o = vec3(R * 1.12 * sin(t), -zr * sin(tl) - ry * .22 + .06 * R * sin(t * 1.7 + aArc.w * 2.), zr * cos(tl));
  vec3 v = vec3(R * 1.12 * cos(t), zr * 0. + R * sin(t) * sin(tl), -R * sin(t) * cos(tl)) * sign(aArc.z);
  float yaw = atan(-v.x, -v.z), bank = .5 * sin(t);
  float re = smoothstep(.35, 1., uReveal) * (1. - uExit);
  float vis = step(aIdx, clamp(uReveal * 1.3, 0., 1.) + .0001);
  float scl = ry * (.1 + .12 * aSeed.w);
  vec3 p = rotA(position * scl * re, vec3(0., 0., 1.), bank);
  p = rotA(p, vec3(0., 1., 0.), yaw);
  o.y += uExit * uExit * dist * 1.2; o.x *= 1. + uExit * 1.5;
  gl_Position = projectionMatrix * vec4(cc + o + p, 1.);
  bool tank = aSeed.x > .5;
  vCol = (tank ? mix(vec3(1., .1, .7), uAccent, .3) : mix(vec3(0., .95, 1.), uAccent2, .3)) * (1.5 + uPulse);
  vCol = mix(vCol, uStoryCol * 1.6, .45);
  vA = on * vis * smoothstep(0., 1., uK) * (1. - smoothstep(.5, 1., uExit));
  vG = guardV(gl_Position);
}`;
// Tempest tube: its FAR rim is the eye-wall ellipse around the widget; lanes fan outward (perspective) to the screen edges.
export const WEB_VS = GUARDV + /* glsl */`
attribute float aLane; attribute float aDepth; attribute float aAng;
uniform float uReveal, uExit, uK, uWebRot;
varying float vLane, vDepth, vA;
void main(){
  float e = uExit, dj = aDepth;                                   // 0 = far rim (eye-wall), 1 = near end (off-screen)
  float a = aAng + uWebRot, c = cos(a), s = sin(a);
  float sq = 1. / pow(pow(abs(c), 4.) + pow(abs(s), 4.), .25);    // supercircle factor
  float m = 1. / (1. - .93 * pow(dj, .85));                       // rings equally spaced in z => radius 1..14
  float rho = 1.35 * m * mix(1., sq, smoothstep(0., .7, dj)) * (1. - .85 * e * e);
  vec2 uv = uHero.xy + vec2(c, s) * uHero.zw * rho;
  gl_Position = vec4(uv * 2. - 1., 0., 1.);
  vLane = aLane; vDepth = dj;
  vA = step(dj, uReveal * 1.12 + .0001) * smoothstep(0., 1., uK) * (1. - smoothstep(.4, 1., e));
  vG = guardV(gl_Position);
}`;
export const WEB_FS = /* glsl */`
varying float vLane, vDepth, vA, vG;
uniform float uWebWave, uWaveA, uWebClk;
void main(){
  float inw = uStory.x >= 0. ? 1. : 0.;                           // up: shots climb toward the widget; down: run outward
  float sh = 0.;
  for (int i = 0; i < 5; i++) {
    float fi = float(i), tt = uWebClk / (2.1 + fi * .65) + fi * .37, id = floor(tt), f = fract(tt);
    float lane = floor(hash12(vec2(id, fi + 3.)) * 16.);
    float pos = mix(f * 1.15 - .1, 1.05 - f * 1.15, inw);
    sh += step(abs(vLane - lane), .5) * exp(-sqf((vDepth - pos) * 11.));
  }
  float ring = uWaveA * exp(-sqf((vDepth - uWebWave) * 9.));
  float nearRim = smoothstep(.5, 0., vDepth);
  vec3 base = mix(vec3(0., .75, 1.), uAccent2, .3) * (.55 - .35 * vDepth);
  base = mix(base, uStoryCol * .9, nearRim * .8);
  vec3 hot = mix(mix(vec3(1., .2, .8), uAccent, .35) * 3. + vec3(.3), uStoryCol * 3.2, nearRim * .5);
  vec3 col = base + hot * sh + vec3(.9, .4, 1.) * ring * 2.5 + uStoryCol * exp(-sqf(vDepth * 10.)) * (.5 + .9 * uStory.y + 1.2 * uStory.w);
  gl_FragColor = vec4(finish(col * vA * vG), 1.0);
}`;
export const STAR_VS = /* glsl */`
attribute vec4 aStar; // xyz = unit direction, w = seed
uniform float uTime, uReveal, uExit, uK, uRes_y; uniform vec2 uRes; uniform float uSpin;
uniform vec3 uAccent2; uniform vec4 uHero; varying vec3 vCol; varying float vA, vG;
void main(){
  float a = uTime * .006; vec3 d = aStar.xyz; d.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * d.xy;
  vec4 cp = projectionMatrix * vec4(mat3(viewMatrix) * d * 100., 1.);
  gl_Position = cp; gl_Position.z = cp.w * .9999;
  float sd = aStar.w, tw = .65 + .35 * sin(uTime * (1.5 + sd * 3.) + sd * 60.);
  gl_PointSize = min(48., (1.1 + 2.2 * step(.88, sd)) * uRes.y / 1080.);
  vCol = mix(vec3(.55, .9, 1.), mix(vec3(1., .5, .95), uAccent2, .4), step(.5, fract(sd * 7.))) * tw * (.5 + step(.88, sd));
  vA = smoothstep(.2, 1., uReveal) * (1. - uExit) * smoothstep(0., 1., uK);
  vec2 q = cp.xy / cp.w * .5 + .5;
  vG = smoothstep(.8, 1.3, length((q - uHero.xy) / max(uHero.zw, vec2(1e-3))));   // sparse field masked by the eye
}`;
export const WAVE_VS = /* glsl */`
uniform vec3 uWaveC; uniform float uWaveR, uWaveT; varying float vA;
void main(){ gl_Position = projectionMatrix * viewMatrix * vec4(uWaveC + position * uWaveR, 1.); vA = pow(1. - uWaveT, 1.4); }`;
export const WAVE_FS = /* glsl */`
uniform vec3 uWaveCol; varying float vA;
void main(){ gl_FragColor = vec4(finish(uWaveCol * vA * 1.4), 1.0); }`;
