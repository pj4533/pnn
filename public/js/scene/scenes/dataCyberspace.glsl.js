// dataCyberspace shaders: tower field, links, packets, helix, glyph-rain backdrop.
// Vertex stages declare only their own uniforms (COMMON uses gl_FragCoord and is fragment-only).

const ENTER = `clamp((uEnter*1.5 - dn)/0.35,0.,1.)`;
const EXIT = `clamp((uExit*1.5 - dn*0.8)/0.35,0.,1.)`;

export const TOWER_VERT = /* glsl */`
attribute vec3 iPos; attribute vec3 iSize; attribute vec4 iSeed; attribute vec2 iAux;
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
  float flare = uRipAmp * exp(-pow((d-r)/75.,2.)) * step(0.,uRipAge) * (1.-smoothstep(2.,3.5,uRipAge));
  float sx = smoothstep(0.,0.08,grow);
  vec3 p = vec3(position.x*iSize.x*sx, position.y*iSize.y*grow*(1.+pulse*0.07+flare*0.25), position.z*iSize.z*sx) + iPos;
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

export const LINK_VERT = /* glsl */`
attribute vec3 aB; attribute float aT; attribute vec2 aInfo;
uniform float uEnter, uExit, uRipAge, uRipAmp; uniform vec3 uRipO;
varying float vF; varying float vFog;
void main(){
  float dn = aInfo.x;
  float dr = ${ENTER} * (1.-${EXIT});
  vec3 p = mix(position, aB, aT*dr);
  vec4 w = modelMatrix*vec4(p,1.);
  float d = length(w.xz - uRipO.xz), r = uRipAge*650.;
  vF = uRipAmp * exp(-pow((d-r)/90.,2.)) * step(0.,uRipAge) * (1.-smoothstep(2.,3.5,uRipAge));
  vec4 mv = viewMatrix*w;
  vFog = 0.25 + 0.75*exp(-length(mv.xyz)*0.0011);
  gl_Position = projectionMatrix*mv;
}`;

export const LINK_FRAG = /* glsl */`
varying float vF; varying float vFog;
void main(){
  vec3 col = (mix(vec3(0.0,0.5,1.0), uAccent2, 0.25)*0.85 + mix(vec3(0.0,0.9,1.0),uAccent,0.5)*vF*2.2)*vFog*calm();
  gl_FragColor = vec4(finish(col), 1.0);
}`;

export const PACKET_VERT = /* glsl */`
attribute vec3 aA; attribute vec3 aB; attribute vec4 aP; attribute vec4 aD;
uniform float uT, uEnter, uExit, uStormAge, uStormMax, uPx; uniform vec3 uRipO;
varying vec3 vC; varying float vFog;
void main(){
  float dn = aD.w;
  float f = fract(uT/aP.y + aP.x);
  float dr = ${ENTER}, ex = ${EXIT};
  vec3 p = mix(aA, aB, f*dr);
  float sz = aP.z*dr;
  p += aD.xyz*(ex*ex*700.);
  sz *= 1. - smoothstep(0.75,1.,ex);
  float isS = step(aP.w, uStormMax);
  float act = step(0.,uStormAge)*step(uStormAge,2.4)*isS;
  vec3 sp = uRipO + aD.xyz*(uStormAge*(240.+420.*fract(aP.w*37.1)));
  float env = smoothstep(0.,0.06,uStormAge)*(1.-smoothstep(1.4,2.4,uStormAge));
  p = mix(p, sp, act); sz = mix(sz, aP.z*1.5*env, act);
  sz *= mix(1., smoothstep(2.4,2.8,uStormAge), isS*step(2.4,uStormAge));
  vec4 mv = viewMatrix*(modelMatrix*vec4(p,1.));
  gl_Position = projectionMatrix*mv;
  if(sz < 0.02) gl_Position = vec4(2.,2.,2.,1.);
  gl_PointSize = clamp(sz*uPx*(380./-mv.z), 1., 48.);
  vFog = 0.35 + 0.65*exp(-length(mv.xyz)*0.0009);
  vec3 amber = vec3(1.0,0.62,0.12);
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
uniform float uT, uEnter, uExit, uClimb; uniform vec3 uHash;
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vK;
float ez(float x){ x = clamp(x,0.,1.); return x*x*(3.-2.*x); }
void main(){
  const float H = 520.;
  float y = mod(hI.y*H + uT*uClimb, H);
  float yn = y/H; y -= H*.5;
  float hAs = ez(uEnter*1.7 - yn*0.7) * (1. - ez(uExit*1.7 - (1.-yn)*0.7));
  float ang = y*0.021 + uT*0.9;
  float R = 26.*(1. + (1.-hAs)*2.5);
  vec3 pa = vec3(cos(ang)*R, y, sin(ang)*R);
  vec3 pb = vec3(-pa.x, y, -pa.z);
  vec3 c = hI.x < .5 ? pa : hI.x < 1.5 ? pb : mix(pa, pb, hI.z);
  c += (hS*2.-1.)*(1.-hAs)*240.;
  float fade = smoothstep(0.,.12,yn)*smoothstep(1.,.88,yn);
  float sz = (hI.x < 1.5 ? 3.0 : 1.3)*hAs*fade;
  vec4 w = modelMatrix*vec4(c + position*sz, 1.);
  vW = w.xyz; vUv = uv; vN = normal;
  float bit = pow(fract(yn*5. - uT*0.3 + hI.x*0.5), 14.);
  vK = vec3(hI.x, bit, fade*hAs);
  gl_Position = projectionMatrix*viewMatrix*w;
}`;

export const HELIX_FRAG = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vK;
void main(){
  vec2 e = min(vUv, 1.-vUv);
  float edge = smoothstep(0.2,0.0,min(e.x,e.y));
  vec3 V = normalize(cameraPosition - vW);
  float fr = pow(1.-abs(dot(normalize(vN),V)), 2.);
  vec3 ca = mix(vec3(0.0,0.85,1.0), uAccent2, 0.3), cb = mix(vec3(1.0,0.15,0.75), uAccent, 0.4);
  vec3 c = vK.x < .5 ? ca : vK.x < 1.5 ? cb : mix(ca,cb,0.5)*0.6;
  vec3 col = c*(0.1 + 0.3*edge + 0.1*fr) + vec3(1.0,0.75,0.4)*vK.y*0.45;
  gl_FragColor = vec4(finish(col*vK.z), 1.0);
}`;

export const FS_VERT = /* glsl */`
void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }`;

export const BACK_FRAG = /* glsl */`
uniform sampler2D tAtlas; uniform float uT, uRainEnv; uniform vec3 uLayers; uniform vec2 uParPx;
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
  float m = (1.-guard())/max(uGuardAmt,0.001);
  rn *= (1. - 0.75*m)*(0.7+0.6*smoothstep(0.4,1.,q.y))*uRainEnv;
  vec3 rc = mix(vec3(0.05,0.8,0.85), uAccent2, 0.3);
  col += rc*rn;
  gl_FragColor = vec4(finish(col), 1.0);
}`;
