// dataCyberspace shaders: tower field, links, packets, helix, glyph-rain backdrop.
// Vertex stages declare only their own uniforms (COMMON uses gl_FragCoord and is fragment-only).

const ENTER = `clamp((uEnter*1.5 - dn)/0.35,0.,1.)`;
const EXIT = `clamp((uExit*1.5 - dn*0.8)/0.35,0.,1.)`;

// projector-stage helpers for vertex stages (the fragment side gets heroD/eye/rim from the shared COMMON chunk)
const HERO_V = /* glsl */`
uniform vec4 uHero; uniform vec4 uHeroW; uniform vec4 uStory; uniform vec3 uStoryCol;
vec3 heroRayV(vec2 uv){ vec2 n = uv*2.-1.; return vec3((n.x+projectionMatrix[2][0])/projectionMatrix[0][0], (n.y+projectionMatrix[2][1])/projectionMatrix[1][1], -1.); }
float heroRv(vec2 q){ return length((q-uHero.xy)/max(uHero.zw,vec2(1e-3))); }
vec2 viewUv(vec3 vc){ float d = max(1e-3,-vc.z); return vec2((projectionMatrix[0][0]*vc.x+projectionMatrix[2][0]*vc.z)/d, (projectionMatrix[1][1]*vc.y+projectionMatrix[2][1]*vc.z)/d)*.5+.5; }
// push a model-space point sideways (view x) out of the calm eye; points inside land in a ring just outside the eye-wall
vec4 clearShift4(vec3 mp){
  if (uHero.z < 1e-4) return vec4(0.);
  vec3 vc = (viewMatrix*modelMatrix*vec4(mp,1.)).xyz; float d = -vc.z; if (d < 40.) return vec4(0.);
  vec2 e = (viewUv(vc)-uHero.xy)/max(uHero.zw,vec2(1e-3));
  float X = sqrt(max(2.89 - e.y*e.y, 0.)); float ax = abs(e.x);
  if (ax >= X) return vec4(0.);
  float nx = (e.x < 0. ? -1. : 1.) * mix(X*0.8, X, ax/X);
  return vec4(transpose(mat3(viewMatrix)) * vec3(2.*(nx-e.x)*uHero.z*d/projectionMatrix[0][0], 0., 0.), 1. - ax/X);
}
vec3 clearShift(vec3 mp){ return clearShift4(mp).xyz; }
`;

export const TOWER_VERT = /* glsl */`
attribute vec3 iPos; attribute vec3 iSize; attribute vec4 iSeed; attribute vec2 iAux;
${HERO_V}
uniform float uT, uEnter, uExit, uRipAge, uRipAmp; uniform vec3 uRipO;
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec4 vE; varying float vY;
void main(){
  float dn = iAux.x;
  float en = smoothstep(0.,1.,${ENTER});
  float ex = smoothstep(0.,1.,${EXIT});
  float c = fract(uT/(90.+iSeed.x*60.) + iSeed.x);
  float life = iSeed.w > 0.5 ? smoothstep(0.,.05,c)*(1.-smoothstep(.94,1.,c)) : 1.;
  float grow = en*(1.-ex)*life;
  float pulse = exp(-fract(uT/iSeed.y + iSeed.z)*7.);
  float d = length(iPos.xz - uRipO.xz), r = uRipAge*650.;
  float flare = uRipAmp * exp(-pow(abs((d-r)/75.),2.)) * step(0.,uRipAge) * (1.-smoothstep(2.,3.5,uRipAge));
  float sx = smoothstep(0.,0.08,grow);
  vec4 cs = clearShift4(iPos + vec3(0., iSize.y, 0.));
  float sq = 1. - 0.6*cs.w;     // towers pushed out of the eye are squat, so the eye-wall reads as a low ring, not a bright pile
  vec3 p = vec3(position.x*iSize.x*sx*sq, position.y*iSize.y*grow*(1.+pulse*0.07+flare*0.25)*sq, position.z*iSize.z*sx*sq) + iPos + cs.xyz;
  vec4 w = modelMatrix*vec4(p,1.);
  vW = w.xyz; vUv = uv; vN = normal; vY = position.y;
  vE = vec4(pulse, flare, iAux.y, iSeed.x);
  gl_Position = projectionMatrix*viewMatrix*w;
}`;

export const TOWER_FRAG = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec4 vE; varying float vY;
void main(){
  vec2 e = min(vUv, 1.-vUv); float ed = min(e.x,e.y);
  float edge = smoothstep(0.08,0.0,ed);
  vec3 V = normalize(cameraPosition - vW);
  float fr = pow(1.-abs(dot(normalize(vN),V)), 2.2);
  float mag = step(0.5, vE.z);
  vec3 cy = vec3(0.0,0.8,1.0), bl = vec3(0.02,0.12,0.7), mg = vec3(1.0,0.1,0.7);
  vec3 ec = mix(mix(cy, uAccent2, 0.3), mg, mag);
  ec = mix(ec, uStoryCol, clamp(rim()*0.8, 0., 0.8));
  float blink = mag*(0.6+0.4*sin(uTime*3.+vE.w*40.));
  float rows = pow(1.-abs(fract(vW.y*0.09 - uTime*0.12 + vE.w*5.)*2.-1.), 12.);
  vec3 col = bl*(0.1+0.2*fr)*(0.4+0.6*vY) + ec*edge*(0.3+0.3*vY+blink*0.7) + ec*fr*0.1 + ec*rows*0.09*(0.3+vY);
  col += ec*step(0.5,vN.y)*0.05;
  col += (ec*0.6+vec3(0.4,0.6,0.7))*vE.x*(0.5*edge+0.06+0.12*fr);
  col += mix(cy, uAccent, 0.5)*vE.y*(edge*1.6+0.3*fr+0.12);
  col *= calm();
  float dist = distance(cameraPosition, vW);
  col *= 0.12 + 0.88*exp(-dist*0.0016);
  gl_FragColor = vec4(finish(col), 1.0);
}`;

// shared curve: both link ends are cleared out of the eye, then the link bows toward the hub (the widget's screen
// position at the link's own depth), so the whole web leans into the widget. Returns VIEW-space position.
const LINK_FN = /* glsl */`
vec3 linkView(vec3 a, vec3 b, float t, float s){
  a += clearShift(a); b += clearShift(b);
  vec3 va = (viewMatrix*modelMatrix*vec4(a,1.)).xyz, vb = (viewMatrix*modelMatrix*vec4(b,1.)).xyz;
  vec3 vm = (va+vb)*.5;
  vec3 hub = heroRayV(uHero.xy) * max(1., -vm.z);
  float ok = step(va.z, -60.) * step(vb.z, -60.);     // both ends well in front of the camera, else the bow smears across the screen
  float nb = smoothstep(5.0, 1.8, heroRv(viewUv(vm)));   // only the web around the widget leans in
  vec3 hv = hub - vm; float hl = length(hv);
  float bow = min(hl * 0.5, length(vb - va) * (0.28 + 0.2*uStory.y));   // bow scales with the link, never swoops across the screen
  return mix(va, vb, t) + hv / max(hl, 1e-3) * bow * nb * 4.*s*(1.-s) * ok;
}
`;
export const LINK_VERT = /* glsl */`
attribute vec3 aB; attribute float aT; attribute vec2 aInfo;
${HERO_V}
${LINK_FN}
uniform float uEnter, uExit, uRipAge, uRipAmp; uniform vec3 uRipO;
varying float vF; varying float vFog; varying float vHub;
void main(){
  float dn = aInfo.x;
  float dr = ${ENTER} * (1.-${EXIT});
  vec3 mv = linkView(position, aB, aT*dr, aT);
  vec4 w = modelMatrix*vec4(mix(position, aB, aT*dr),1.);
  float d = length(w.xz - uRipO.xz), r = uRipAge*650.;
  vF = uRipAmp * exp(-pow(abs((d-r)/90.),2.)) * step(0.,uRipAge) * (1.-smoothstep(2.,3.5,uRipAge));
  vFog = 0.25 + 0.75*exp(-length(mv)*0.0011);
  vHub = smoothstep(3.2, 1.3, heroRv(viewUv(mv)));
  gl_Position = projectionMatrix*vec4(mv,1.);
}`;

export const LINK_FRAG = /* glsl */`
varying float vF; varying float vFog; varying float vHub;
void main(){
  vec3 lc = mix(mix(vec3(0.0,0.5,1.0), uAccent2, 0.25), uStoryCol, vHub*0.7);
  vec3 col = (lc*(0.85+0.5*vHub*(0.5+uStory.y)) + mix(vec3(0.0,0.9,1.0),uAccent,0.5)*vF*2.2)*vFog*calm();
  gl_FragColor = vec4(finish(col), 1.0);
}`;

export const PACKET_VERT = /* glsl */`
attribute vec3 aA; attribute vec3 aB; attribute vec4 aP; attribute vec4 aD;
${HERO_V}
${LINK_FN}
uniform float uT, uPT, uEnter, uExit, uStormAge, uStormMax, uPx; uniform vec3 uRipO; uniform vec2 uPul;
varying vec3 vC; varying float vFog;
void main(){
  float dn = aD.w;
  float f = fract(uPT/aP.y + aP.x);
  float dr = ${ENTER}, ex = ${EXIT};
  // direction: up-moves race packets INTO the widget along their link, down-moves carry them OUT; flat keeps the mix
  float rA = heroRv(viewUv((viewMatrix*modelMatrix*vec4(aA,1.)).xyz)), rB = heroRv(viewUv((viewMatrix*modelMatrix*vec4(aB,1.)).xyz));
  float fl = uStory.x;
  float flip = step(0.3, abs(fl)) * (((fl > 0.) == (rB < rA)) ? 0. : 1.);
  float sp = mix(f, 1.-f, flip) * dr;
  vec3 vp = linkView(aA, aB, sp, sp);
  float sz = aP.z*dr * step(aP.w, 0.4 + 0.6*uStory.y);
  vp += mat3(viewMatrix) * (aD.xyz*(ex*ex*700.));
  sz *= 1. - smoothstep(0.75,1.,ex);
  // heroPulse: a share of the packets floods toward the hub, shrinks into it, then streams back out
  float fa = step(aP.w, 0.7*uPul.y) * step(0.001, uPul.y);
  float kk = smoothstep(0., .9, uPul.x) * (1. - smoothstep(1.0, 1.4, uPul.x));
  vp = mix(vp, heroRayV(uHero.xy) * max(1., -vp.z), fa*kk);
  sz *= 1. - fa * smoothstep(.55,.95,uPul.x) * (1. - smoothstep(1.0,1.4,uPul.x));
  sz *= 1. + fa * 0.6 * sin(kk * 3.14159);
  float isS = step(aP.w, uStormMax);
  float act = step(0.,uStormAge)*step(uStormAge,2.4)*isS;
  vec3 sp3 = uRipO + aD.xyz*(uStormAge*(240.+420.*fract(aP.w*37.1)));
  float env = smoothstep(0.,0.06,uStormAge)*(1.-smoothstep(1.4,2.4,uStormAge));
  vp = mix(vp, (viewMatrix*modelMatrix*vec4(sp3,1.)).xyz, act); sz = mix(sz, aP.z*1.5*env, act);
  sz *= mix(1., smoothstep(2.4,2.8,uStormAge), isS*step(2.4,uStormAge));
  gl_Position = projectionMatrix*vec4(vp,1.);
  if(sz < 0.02) gl_Position = vec4(2.,2.,2.,1.);
  gl_PointSize = clamp(sz*uPx*(380./-vp.z), 1., 48.);
  vFog = 0.35 + 0.65*exp(-length(vp)*0.0009);
  float nr = smoothstep(3.6, 1.3, heroRv(viewUv(vp)));
  vec3 amber = mix(vec3(1.0,0.62,0.12), uStoryCol*1.25, nr*0.9);
  vC = mix(amber, vec3(1.0,0.2,0.75), act*0.6 + ex*0.3) * (1.+ex*0.8);
}`;

export const PACKET_FRAG = /* glsl */`
varying vec3 vC; varying float vFog;
void main(){
  float r = length(gl_PointCoord-0.5)*2.;
  float a = smoothstep(1.,0.,r); a *= a;
  vec3 col = (vC*a*1.7 + vec3(1.0,0.9,0.7)*pow(a,6.)*0.9)*vFog*calm();
  gl_FragColor = vec4(finish(col), 1.0);
}`;

export const HELIX_VERT = /* glsl */`
attribute vec4 hI; attribute vec3 hS;
uniform float uT, uEnter, uExit, uClimbPh, uHLen, uHR; uniform vec4 uStory;
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vK;
float ez(float x){ x = clamp(x,0.,1.); return x*x*(3.-2.*x); }
void main(){
  // the data stream wraps the light cone: it rises from the plinth to the widget's base (up-moves climb, down-moves fall)
  float yn = fract(hI.y + uClimbPh);
  float hAs = ez(uEnter*1.7 - yn*0.7) * (1. - ez(uExit*1.7 - (1.-yn)*0.7));
  float ang = yn*6.2832*2.5 + uT*(0.6+0.8*uStory.y);
  float R = mix(uHR*1.08, uHR*0.74, yn) * (1. + (1.-hAs)*2.5);
  float y = yn*uHLen;
  vec3 pa = vec3(cos(ang)*R, y, sin(ang)*R);
  vec3 pb = vec3(-pa.x, y, -pa.z);
  vec3 c = hI.x < .5 ? pa : hI.x < 1.5 ? pb : mix(pa, pb, hI.z);
  c += (hS*2.-1.)*(1.-hAs)*240.;
  float fade = smoothstep(0.,.1,yn)*smoothstep(1.,.9,yn);
  float sz = (hI.x < 1.5 ? 1.1 : 0.45)*hAs*fade*clamp(uHR/15.,0.8,2.5);
  vec4 w = modelMatrix*vec4(c + position*sz, 1.);
  vW = w.xyz; vUv = uv; vN = normal;
  float bit = pow(fract(yn*5. - uClimbPh*5. + hI.x*0.5), 14.);
  vK = vec3(hI.x, bit, fade*hAs);
  gl_Position = projectionMatrix*viewMatrix*w;
}`;

export const HELIX_FRAG = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vK;
void main(){
  vec2 e = min(vUv, 1.-vUv);
  float edge = smoothstep(0.2,0.0,min(e.x,e.y));
  vec3 V = normalize(cameraPosition - vW);
  float fr = pow(abs(1.-abs(dot(normalize(vN),V))), 2.);
  vec3 ca = mix(mix(vec3(0.0,0.85,1.0), uAccent2, 0.3), uStoryCol, 0.55), cb = mix(mix(vec3(1.0,0.15,0.75), uAccent, 0.4), uStoryColA, 0.3);
  vec3 c = vK.x < .5 ? ca : vK.x < 1.5 ? cb : mix(ca,cb,0.5)*0.6;
  vec3 col = c*(0.1 + 0.3*edge + 0.1*fr) + vec3(1.0,0.75,0.4)*vK.y*0.45;
  gl_FragColor = vec4(finish(col*vK.z), 1.0);
}`;

export const FS_VERT = /* glsl */`
void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }`;

export const BACK_FRAG = /* glsl */`
uniform sampler2D tAtlas; uniform float uT, uRainEnv, uEnter; uniform vec3 uLayers; uniform vec2 uParPx;
float hs2(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float rain(vec2 fc, float cell, float spd, float sd, float dens, float tail, float par){
  vec2 p = fc + vec2(uParPx.x*par, 0.);
  vec2 cid = floor(p/cell), f = fract(p/cell);
  float h0 = hs2(vec2(cid.x, sd));
  if(h0 > dens) return 0.;
  float rows = uRes.y/cell;
  float sp = (0.6+0.8*hs2(vec2(cid.x+11., sd)))*spd;
  float cyc = rows + tail*2.;
  float head = rows + tail - mod(uT*sp*0.5 + h0*cyc*3., cyc);
  float d = cid.y - head;
  if(d < -1. || d > tail) return 0.;
  float b = d < 0. ? 1.+d*0.0 : exp(-d*(3.2/tail));
  float hd = 1. - smoothstep(0.,1.5,abs(d));
  float gid = floor(hs2(vec2(cid.x*1.3+sd, cid.y + floor(uT*(1.5+h0*2.)))) * 64.);
  vec2 gv = (vec2(mod(gid,8.), floor(gid/8.)) + (f*0.8+0.1))/8.;
  float g = textureLod(tAtlas, gv, max(0., log2(64./cell)+0.5)).r;
  return g*(b*0.3 + hd*0.5);
}
void main(){
  vec2 q = gl_FragCoord.xy/uRes; float s = uRes.y/1080.;
  vec2 fc = gl_FragCoord.xy;
  vec3 col = mix(vec3(0.004,0.006,0.03), vec3(0.012,0.02,0.085), smoothstep(0.,1.,q.y));
  vec2 nq = q*vec2(uRes.x/uRes.y,1.)*0.25 + vec2(uT*0.004, -uT*0.002);
  float n = textureLod(uNoise, nq, 0.).r*0.6 + textureLod(uNoise, nq*2.3+3.1, 0.).g*0.4;
  col += mix(vec3(0.0,0.05,0.25), vec3(0.3,0.0,0.3), q.x)*smoothstep(0.45,0.95,n)*0.07;
  float rn = 0.;
  if(uLayers.x > .5) rn += rain(fc, 54.*s, 4.5, 3., .3, 14., 0.9)*0.6;
  if(uLayers.y > .5) rn += rain(fc, 34.*s, 3.2, 17., .4, 16., 0.45)*0.6;
  if(uLayers.z > .5) rn += rain(fc, 20.*s, 2.2, 31., .45, 20., 0.18)*0.45;
  rn *= eye()*(0.7+0.6*smoothstep(0.4,1.,q.y))*uRainEnv;
  vec3 rc = mix(mix(vec3(0.05,0.8,0.85), uAccent2, 0.3), uStoryCol, 0.5*rim());
  col += rc*rn;
  // the hub: a dashed eye-wall ring orbiting the widget (flat/up spins one way, down the other), flashing on pulses
  vec2 hd = heroD(q); float hr = length(hd); float an = atan(hd.y, hd.x);
  float spin = uT*(0.25+0.6*uStory.y)*(uStory.x < -0.3 ? -1. : 1.);
  float ring = exp(-pow(abs((hr-1.32)*16.),2.)) * (0.4 + 0.6*step(0.5, fract(an*3.8197 + spin)));
  col += uStoryCol*(ring*(0.09+0.22*uStory.y+0.55*uStory.w) + 0.025*exp(-hr*hr*0.3)) * smoothstep(0.,0.6,uEnter);
  gl_FragColor = vec4(finish(col), 1.0);
}`;
