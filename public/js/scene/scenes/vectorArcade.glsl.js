// Vector Arcade Void shaders. Vertex stages declare their own uniforms (COMMON is fragment-only: it uses gl_FragCoord).
export const GUARDV = /* glsl */`
uniform vec4 uGuardRect; varying float vG;
float guardV(vec4 cp){ vec2 q=cp.xy/cp.w*.5+.5; vec2 m=smoothstep(uGuardRect.xy-.08,uGuardRect.xy,q)*(1.-smoothstep(uGuardRect.zw,uGuardRect.zw+.08,q)); return 1.-.55*m.x*m.y; }
vec3 rotA(vec3 v, vec3 a, float g){ float c=cos(g), s=sin(g); return v*c + cross(a,v)*s + a*dot(a,v)*(1.-c); }
`;
export const LINE_FS = /* glsl */`
varying vec3 vCol; varying float vA, vG;
void main(){ vec3 col = vCol * vA * vG; gl_FragColor = vec4(finish(col), 1.0); }
`;
export const POLY_VS = GUARDV + /* glsl */`
attribute float aIdx; attribute vec3 aMid; attribute vec3 aDir; attribute vec3 aOffset; attribute vec4 aAxis; attribute vec4 aSeed;
uniform float uTravel, uSpin, uReveal, uExit, uK, uPulse, uZNear, uZFar, uWaveR, uWaveA;
uniform vec3 uWaveC, uAccent, uAccent2;
varying vec3 vCol; varying float vA;
void main(){
  float sc = aSeed.x * (1. + uPulse * .12);
  float ph = fract(aOffset.z + uTravel * aSeed.y);
  vec3 c = vec3(aOffset.xy, mix(uZFar, uZNear, ph));
  float rv = clamp(uReveal * 1.7 - aSeed.w * .7, 0., 1.);          // per-instance stagger
  float vis = step(aIdx, rv + .0001);                               // vertex-order draw-on
  float head = vis * (1. - smoothstep(0., .14, rv - aIdx)) * step(rv, .999);
  float e = uExit;
  vec3 p = mix(position, aMid, .5 * e) + aDir * e * e * 3.2;       // exit: edges fly apart as loose segments
  c.xy += normalize(c.xy + .001) * e * e * 700.; c.z += e * e * 260.;
  float ang = uSpin * aAxis.w + aSeed.z * 40.;
  p = rotA(p * sc, aAxis.xyz, ang); p = rotA(p, vec3(0., 1., 0.), ang * .31);
  vec3 w = c + p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.);
  float s = aSeed.z;
  vec3 col = s < .5 ? mix(vec3(0., .9, 1.), uAccent2, .35) : (s < .9 ? mix(vec3(1., .1, .7), uAccent, .35) : vec3(1., .65, .1));
  float wave = uWaveA * exp(-pow((length(w - uWaveC) - uWaveR) / 110., 2.));
  float fin = smoothstep(0., .07, ph) * (1. - smoothstep(.62, .85, ph));
  float I = (.35 + .55 * ph) * (1. + head * 2.5) * (1. + uPulse * .5) + wave * 3.5;
  vCol = col * min(I, 2.0) * (aSeed.x > 110. ? .6 : 1.);
  vA = fin * vis * (1. - smoothstep(.5, 1., e)) * smoothstep(0., 1., uK);
  vG = guardV(gl_Position);
}`;
export const SAUCER_VS = GUARDV + /* glsl */`
attribute float aModel; attribute float aIdx; attribute vec4 aArc; attribute vec4 aSeed;
uniform float uTime, uReveal, uExit, uK, uPulse, uSpin;
uniform vec3 uAccent, uAccent2;
varying vec3 vCol; varying float vA;
void main(){
  float on = 1. - abs(aModel - aSeed.x);                // only the model matching this instance's kind draws
  float w = aArc.z, ph = aArc.w, t = uTime * w + ph;
  vec3 c = vec3(aArc.x * sin(t), aSeed.z + 45. * sin(t * 1.7 + ph * 2.), aSeed.y - 380. * cos(t));
  vec3 v = vec3(aArc.x * cos(t), 0., 380. * sin(t));
  float yaw = atan(-v.x, -v.z), bank = .5 * sin(t);
  float re = smoothstep(.35, 1., uReveal) * (1. - uExit);
  float vis = step(aIdx, clamp(uReveal * 1.3, 0., 1.) + .0001);
  vec3 p = rotA(position * aSeed.w * re, vec3(0., 0., 1.), bank);
  p = rotA(p, vec3(0., 1., 0.), yaw);
  c.y += uExit * uExit * 500.; c.x *= 1. + uExit * 1.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(c + p, 1.);
  bool tank = aSeed.x > .5;
  vCol = (tank ? mix(vec3(1., .1, .7), uAccent, .3) : mix(vec3(0., .95, 1.), uAccent2, .3)) * (1.5 + uPulse);
  vA = on * vis * smoothstep(0., 1., uK) * (1. - smoothstep(.5, 1., uExit));
  vG = guardV(gl_Position);
}`;
export const WEB_VS = GUARDV + /* glsl */`
attribute float aLane; attribute float aDepth;
uniform float uReveal, uExit, uK;
varying float vLane, vDepth, vA;
void main(){
  vec3 p = position; float e = uExit;
  p.xy *= 1. - .85 * e * e; p.z *= 1. - .5 * e;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
  vLane = aLane; vDepth = aDepth;
  vA = step(aDepth, uReveal * 1.12 + .0001) * smoothstep(0., 1., uK) * (1. - smoothstep(.4, 1., e));
  vG = guardV(gl_Position);
}`;
export const WEB_FS = /* glsl */`
varying float vLane, vDepth, vA, vG;
uniform float uWebWave; uniform float uWaveA;
void main(){
  float sh = 0.;
  for (int i = 0; i < 5; i++) {
    float fi = float(i), tt = uTime / (2.1 + fi * .65) + fi * .37, id = floor(tt), f = fract(tt);
    float lane = floor(hash12(vec2(id, fi + 3.)) * 16.);
    sh += step(abs(vLane - lane), .5) * exp(-pow((vDepth - f * 1.15) * 11., 2.));   // shot travelling down one lane
  }
  float ring = uWaveA * exp(-pow((vDepth - uWebWave) * 9., 2.));
  vec3 base = mix(vec3(0., .75, 1.), uAccent2, .3) * (.55 - .35 * vDepth);
  vec3 hot = mix(vec3(1., .2, .8), uAccent, .35) * 3. + vec3(.3);
  vec3 col = base + hot * sh + vec3(.9, .4, 1.) * ring * 2.5;
  gl_FragColor = vec4(finish(col * vA * vG), 1.0);
}`;
export const STAR_VS = /* glsl */`
attribute vec4 aStar; // xyz = unit direction, w = seed
uniform float uTime, uReveal, uExit, uK, uRes_y; uniform vec2 uRes; uniform float uSpin;
uniform vec3 uAccent2; varying vec3 vCol; varying float vA, vG;
uniform vec4 uGuardRect;
void main(){
  float a = uTime * .006; vec3 d = aStar.xyz; d.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * d.xy;
  vec4 cp = projectionMatrix * vec4(mat3(viewMatrix) * d * 100., 1.);
  gl_Position = cp; gl_Position.z = cp.w * .9999;
  float sd = aStar.w, tw = .65 + .35 * sin(uTime * (1.5 + sd * 3.) + sd * 60.);
  gl_PointSize = min(48., (1.1 + 2.2 * step(.88, sd)) * uRes.y / 1080.);
  vCol = mix(vec3(.55, .9, 1.), mix(vec3(1., .5, .95), uAccent2, .4), step(.5, fract(sd * 7.))) * tw * (.5 + step(.88, sd));
  vA = smoothstep(.2, 1., uReveal) * (1. - uExit) * smoothstep(0., 1., uK);
  vec2 q = cp.xy / cp.w * .5 + .5; vec2 m = smoothstep(uGuardRect.xy - .08, uGuardRect.xy, q) * (1. - smoothstep(uGuardRect.zw, uGuardRect.zw + .08, q));
  vG = 1. - .55 * m.x * m.y;
}`;
export const WAVE_VS = /* glsl */`
uniform vec3 uWaveC; uniform float uWaveR, uWaveT; varying float vA;
void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(uWaveC + position * uWaveR, 1.); vA = pow(1. - uWaveT, 1.4); }`;
export const WAVE_FS = /* glsl */`
uniform vec3 uWaveCol; varying float vA;
void main(){ gl_FragColor = vec4(finish(uWaveCol * vA * 1.4), 1.0); }`;
