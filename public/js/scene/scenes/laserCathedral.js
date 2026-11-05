// laserCathedral: retro arena laser show. 96 billboarded beams from off-frame emitters (GPU pattern engine),
// quarter-res haze layer, glitter sparks, rolling smoke floor. All motion in shaders; 5 draws.
import * as THREE from '../../../vendor/three/three.module.js';

// ---- hero kit: reads the shared hero uniforms (uHero/uHeroW/uStory/uStoryCol) from ctx.common(); stubs them (stage-rect centre) when the stage core is absent
const HERO_STUB_GLSL = `uniform vec4 uHero; uniform vec4 uHeroW; uniform vec4 uStory; uniform vec3 uStoryCol; uniform vec3 uStoryColA;
vec2 heroD(vec2 q){ return (q-uHero.xy)/max(uHero.zw,vec2(1e-3)); }
float heroR(vec2 q){ return length(heroD(q)); }
float eye(){ return smoothstep(0.78,1.18,heroR(gl_FragCoord.xy/uRes)); }
float rim(){ float r=heroR(gl_FragCoord.xy/uRes); return exp(-sqf((r-1.35)*3.2)); }`;
const HV = `uniform vec4 uHero; uniform vec4 uStory; uniform vec3 uStoryCol;`;
function heroKit(ctx, P) {
  const c = ctx.common(), stub = !c.uHero || !/uniform\s+vec4\s+uHero\b/.test(P);
  const hu = {
    uHero: c.uHero || { value: new THREE.Vector4(0.64, 0.6, 0.2, 0.25) }, uHeroW: c.uHeroW || { value: new THREE.Vector4(0, 0, -100, 10) },
    uStory: c.uStory || { value: new THREE.Vector4(0, 0.35, 0, 0) }, uStoryCol: c.uStoryCol || { value: new THREE.Color(0.2, 0.9, 1) },
    uStoryColA: c.uStoryColA || { value: new THREE.Color(1, 0.2, 0.8) },
  };
  if (stub && !c.uHero) { hu.uStoryCol.value.copy(ctx.accent2.value); hu.uStoryColA.value.copy(ctx.accent.value); }
  const sync = () => { if (!stub || ctx.hero) return; const r = ctx.guardRect.value; hu.uHero.value.set((r.x + r.z) / 2, (r.y + r.w) / 2, (r.z - r.x) * 0.3, (r.w - r.y) * 0.3); };
  return { hu, sync, P: (!stub ? P : P + '\n' + HERO_STUB_GLSL) };
}

const F = 1.55; // virtual focal length (ndc per unit slope)
const PRO = `float sqf(float x){ return x*x; }
float uAsp_(){return uRes.x/uRes.y;}
vec2 prj(vec3 p){ float z=max(-p.z,0.25); return p.xy/z*vec2(${F.toFixed(2)}/uAsp_(),${F.toFixed(2)}); }`;
const EMS = `const vec3 EMS[5]=vec3[5](vec3(-9.,6.5,-6.),vec3(9.,6.5,-6.),vec3(-6.5,-6.5,-6.),vec3(1.5,-7.,-6.),vec3(7.,-6.5,-6.));
const float BA[5]=float[5](0.1,3.04,1.25,1.8,1.4);`;
const FS_VERT = `varying vec2 vUv; void main(){ vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,1.,1.); }`;
const E_POS = [[-9, 6.5, -6], [9, 6.5, -6], [-6.5, -6.5, -6], [1.5, -7, -6], [7, -6.5, -6]];

const BEAM_VERT = `precision highp float;
attribute vec2 aInst; uniform vec2 uRes; uniform float uTime,uPT,uBlend,uPer,uPatA,uPatB,uConv,uRipStr,uK;
uniform float uEm[5]; uniform vec2 uRipC; uniform vec3 uPar,uAccent,uAccent2,uRipCol;
${HV}
varying float vAlong,vSide,vSeed,vK,vDash,vDn,vCrown; varying vec3 vCol;
${PRO}
${EMS}
void pat(float p,int e,float u,float f,float t,out vec3 O,out vec2 T){
  O=EMS[e]; float fe=float(e); float ba=BA[e];
  if(p<0.5){ float a=ba+u*1.0+0.4*sin(t*0.55+fe*1.3); float r=1.0+0.35*sin(t*0.4+f*3.+fe); T=r*vec2(cos(a),sin(a)); }
  else if(p<1.5){ float s=mod(fe,2.)*2.-1.; float an=f*6.2832+t*0.7*s; float R=0.42+0.16*sin(t*0.5+fe); vec2 c=vec2(mix(-0.45,0.35,fe/4.),0.32); T=c+R*vec2(cos(an)*1.3,sin(an)*0.8); }
  else if(p<2.5){ T=vec2((floor(f*5.)-2.)*0.38+0.3*sin(t*0.5+fe*.5),(fract(f*5.)-0.5)*0.8+0.32+0.2*cos(t*0.45)); }
  else if(p<3.5){ float a=f*6.2832+fe*1.1+t*0.25; float R=4.5+fe*0.8+0.8*sin(t*0.8+fe); O=vec3(cos(a)*R*1.5,sin(a)*R*0.85,-2.5); T=vec2(-0.25,0.15)+0.03*vec2(cos(a+t),sin(a+t)); }
  else { T=vec2((f-0.5)*2.4+0.2*sin(t*.3+fe), 0.4+0.32*sin(f*8.+t*1.6+fe)); }
}
float h1(float n){ return fract(sin(n*91.345)*47453.5453); }
void main(){
  float k=aInst.x; int e=int(mod(k,5.)); float fe=float(e); float j=floor(k/5.); float f=(j+0.5)/uPer; float u=f-0.5;
  float bl=smoothstep(0.,1.,uBlend);
  vec3 OA,OB; vec2 TA,TB; pat(uPatA,e,u,f,uPT,OA,TA); pat(uPatB,e,u,f,uPT,OB,TB);
  vec3 O=mix(OA,OB,bl); vec2 T=mix(TA,TB,bl);
  vec3 par=uPar; O-=par;
  vec3 D=normalize(vec3(T,-1.)); float L=60.;
  float cv=uConv;
  float sd=h1(aInst.y);
  // CROWN: ~70% of beams (all of them while converging) re-aim at the eye-wall ellipse around the widget and END there
  vec2 hc=uHero.xy*2.-1., hr=uHero.zw*2.;
  vec2 tn=T*vec2(${F.toFixed(2)}/uAsp_(),${F.toFixed(2)});
  vec2 dh=(tn-hc)/hr; float a0=length(dh)>0.02?atan(dh.y,dh.x):sd*6.2832;
  vec2 em=(prj(O)-hc)/hr; vec2 dR=vec2(cos(a0),sin(a0)); vec2 dE=em/max(length(em),1e-3);
  vec2 dn=normalize(mix(dR,dE,0.5)+1e-4);                       // bias to the emitter-facing side so beams arrive instead of crossing
  float Rr=1.32+0.1*sin(uPT*0.8+fe+f*10.)+0.06*uStory.w;
  vec2 pt0=hc+hr*Rr*dn;
  float a1=f*6.2832+fe*1.26+uPT*0.05; vec2 pt1=hc+hr*1.2*vec2(cos(a1),sin(a1));
  float crown=step(sd,0.86);
  vCrown=max(crown,cv);
  vec2 tg=mix(tn,mix(pt0,pt1,cv),vCrown);
  if(vCrown>0.001){ float dz=24.; vec3 Pc=vec3(tg.x/(${F.toFixed(2)}/uAsp_())*dz,tg.y/${F.toFixed(2)}*dz,-dz); vec3 dc=Pc-O; D=normalize(mix(D,normalize(dc),vCrown)); L=mix(L,length(dc),vCrown); }
  float ig=smoothstep(0.,1.,uEm[e]); L*=ig;
  vec3 B=O+D*L;
  vec2 a=prj(O), b=prj(B);
  vec2 asp=vec2(uAsp_(),1.); vec2 d2=(b-a)*asp; float dl=length(d2); d2=dl>1e-5?d2/dl:vec2(1.,0.);
  vec2 pr=vec2(-d2.y,d2.x);
  float pxn=1./(uRes.y*.5); float hw=14.*(uRes.y/1080.)*pxn*mix(1.,.5,cv);
  float cap=hw*1.5;
  vec2 pos=mix(a,b,position.x)+(d2*cap*(position.x*2.-1.)+pr*hw*position.y)/asp;
  gl_Position=vec4(pos,0.,1.);
  vSeed=sd; vAlong=position.x; vSide=position.y; vDn=dl*position.x;
  vec3 c;
  if(sd<0.34) c=vec3(0.1,1.,0.75); else if(sd<0.62) c=vec3(1.,0.1,0.8); else if(sd<0.8) c=vec3(0.5,0.25,1.); else if(sd<0.9) c=uAccent*1.2; else c=uAccent2*1.2;
  { float up=max(uStory.x,0.), dn_=max(-uStory.x,0.); c=mix(c,mix(vec3(0.15,1.,0.45),vec3(1.,0.12,0.35),dn_/(up+dn_+1e-3)),0.4*(up+dn_)); }   // up: green leads, down: magenta/red
  vCol=mix(c,uRipCol,cv*0.7);
  float st=0.82+0.18*sqf(0.5+0.5*sin(uPT*7.2+float(e)*1.26));
  vK=st*mix(1.,.12,cv)*step(0.001,ig)*0.62*uK*(dl>1e-4?1.:0.);
  vDash=mix(step(abs(uPatA-3.),.5),step(abs(uPatB-3.),.5),bl);
}`;
const BEAM_FRAG = (P) => `precision highp float;
${P}
varying float vAlong,vSide,vSeed,vK,vDash,vDn,vCrown; varying vec3 vCol; uniform float uPT;
void main(){
  vec2 suv=gl_FragCoord.xy/uRes; float hrr=heroR(suv); float clipEye=smoothstep(1.02,1.14,hrr);   // nothing crosses the calm eye
  if(clipEye<0.002){ gl_FragColor=vec4(0.,0.,0.,1.); return; }
  float s=abs(vSide); float core=exp(-sqf(s/0.075)); float glow=exp(-sqf(s/0.4));
  float n=vnoise(vec3(vAlong*5.+vSeed*30.,vSeed*9.,uTime*0.4));
  float dash=mix(1.,0.45+0.55*smoothstep(0.2,0.8,sin(vAlong*40.-uPT*7.+vSeed*6.)*0.5+0.5),vDash);
  float al=mix(1.-smoothstep(0.55,1.,vAlong),0.35+0.65*smoothstep(0.,0.5,vAlong),vCrown)*smoothstep(0.,0.04,vAlong)*(1.-smoothstep(0.97,1.,vAlong)*vCrown);   // crown beams stay lit all the way to the rim
  float nf=0.4+0.6*smoothstep(0.,1.5,vDn);
  float dsg=uStory.x<-0.01?1.:-1.;
  float pk=0.72+0.28*sin(vAlong*16.-uPT*(2.+4.*uStory.y)*dsg+vSeed*20.);                // packets run toward the widget (up) or away (down)
  float endg=vCrown*exp(-sqf((1.-vAlong)*9.))*(0.8+uStory.w);                       // bright landing on the eye-wall
  float I=(core*1.0+glow*0.14)*vK*(0.55+0.9*n)*(al+endg*0.6)*dash*nf*mix(1.,pk,0.6); I=I/(1.+0.45*I);
  vec3 bc=mix(vCol,uStoryCol*1.4,smoothstep(0.55,1.,vAlong)*vCrown*0.85);
  vec3 col=bc*I*clipEye*guard();
  gl_FragColor=vec4(finish(col),1.);
}`;

const SPARK_VERT = `precision highp float;
attribute vec4 aS; uniform vec2 uRes,uRipC; uniform float uTime,uPT,uAsm,uRipAge,uRipStr,uK; uniform vec3 uPar,uAccent,uAccent2;
${HV}
varying vec3 vCol; varying float vB;
${PRO}
void main(){
  vec4 s=aS; float t=uPT;
  float d=5.+mod(s.z*40.+t*1.1,40.);
  vec3 p=vec3(mix(-1.,1.,s.x)*d*0.62, 0., -d);
  float yy=pow(s.y,1.5); float rise=mod(yy*2.+t*mix(.01,.03,s.w)*(s.x>.5?1.:-1.)*0.5+1.,1.);
  p.y=mix(-.55,.6,rise)*d*0.6; p.x+=sin(t*.3+s.x*40.)*1.2; p.y+=cos(t*.27+s.y*37.)*.8;
  float as_=smoothstep(s.w*.5,s.w*.5+.5,uAsm);
  vec3 q=p*(1.+(1.-as_)*1.8)+(1.-as_)*vec3((s.xy-.5)*60.,-35.);
  q-=uPar;
  vec2 n=prj(q);
  // glitter orbits the widget (differential swirl along heroFlow), vanishes inside the eye, ignites on the eye-wall
  vec2 hc=uHero.xy*2.-1., hr=uHero.zw*2.; vec2 dn=(n-hc)/hr; float r0=length(dn)+1e-3;
  float sw=uPT*0.11*(0.4+1.2*uStory.y)/(0.55+r0*0.6); float cs=cos(sw), sn=sin(sw);
  dn=mat2(cs,-sn,sn,cs)*dn; dn*=1.-uStory.x*0.07*sin(uPT*0.7+s.z*30.); n=hc+dn*hr;
  float rr=length(dn); float inRim=exp(-sqf((rr-1.35)*2.5));
  float fa=smoothstep(5.,9.,d)*(1.-smoothstep(36.,45.,d));
  float tw=pow(.5+.5*sin(t*(2.+s.w*6.)+s.x*100.),6.);
  float dr=length((n-uRipC)*vec2(uRes.x/uRes.y,1.)); float front=exp(-sqf((dr-uRipAge*1.8)*6.))*uRipStr*3.*max(0.,1.-uRipAge/1.2);
  float c=fract(s.z*7.3);
  vCol=c<.4?vec3(.2,1.,.9):c<.75?vec3(1.,.3,.9):mix(vec3(.9,.8,1.),uAccent,.4);
  if(c>.93) vCol=uAccent2;
  vCol=mix(vCol,uStoryCol,inRim*0.7);
  vB=(0.25+tw*2.+front)*fa*as_*uK*smoothstep(0.92,1.16,rr)*(1.+inRim*(1.8+uStory.w*2.));
  gl_Position=vec4(n,0.,1.);
  gl_PointSize=min(48.,(1.2+2.5*s.w+front*2.)*clamp(10./d,.5,2.)*uRes.y/1080.);
}`;
const SPARK_FRAG = (P) => `precision highp float;
${P}
varying vec3 vCol; varying float vB;
void main(){
  vec2 q=gl_PointCoord-.5; float g=exp(-dot(q,q)*40.);
  float cr=exp(-abs(q.x)*14.-abs(q.y)*120.)+exp(-abs(q.y)*14.-abs(q.x)*120.);
  vec3 col=vCol*(g+cr*.7)*vB*guard();
  gl_FragColor=vec4(finish(col),1.);
}`;

const SMOKE_VERT = `precision highp float;
uniform vec2 uRes; uniform vec3 uPar; varying vec2 vXZ; varying float vD;
${PRO}
void main(){ vec3 p=vec3(position.x,-7.5,position.z); vXZ=p.xz; vD=-p.z; vec3 q=p-uPar; float z=max(-q.z,.25); gl_Position=vec4(prj(q)*z,0.,z); }`;
const SMOKE_FRAG = (P) => `precision highp float;
${P}
varying vec2 vXZ; varying float vD; uniform float uPT,uPulse2;
void main(){
  vec2 pq=(gl_FragCoord.xy/uRes-vec2(uHero.x,uHero.y-uHero.w*1.0))/vec2(uHero.z*1.9,uHero.w*0.34); float pg=exp(-dot(pq,pq));
  float t=uPT;
  float n=vnoise(vec3(vXZ.x*.07+t*.03,vXZ.y*.09-t*.1,t*.05))*.65+vnoise(vec3(vXZ.x*.18-t*.05,vXZ.y*.2-t*.22,3.))*.35;
  float dens=smoothstep(.3,.85,n)*(1.-smoothstep(10.,24.,vD))*smoothstep(4.,8.,vD);
  vec3 tint=mix(vec3(.2,.04,.32),vec3(.0,.18,.28),smoothstep(.3,.8,vnoise(vec3(vXZ*.05,t*.04))));
  float lit=exp(-sqf((vXZ.x-1.5)/6.))*.5+exp(-sqf((vXZ.x+6.5)/5.))*.35+exp(-sqf((vXZ.x-7.)/5.))*.35;
  vec3 col=(tint*(.4+lit*1.0)+uAccent*.04+uStoryCol*pg*.55)*dens*.16*(1.+uPulse*.5)+uStoryCol*pg*(.05+.05*uStory.y)*smoothstep(.1,.6,n);
  gl_FragColor=vec4(finish(col),1.);
}`;

const LAYER_FRAG = (P) => `precision highp float;
${P}
varying vec2 vUv; uniform float uOct,uPT,uAsp,uHz; uniform vec2 uEN[5]; uniform float uEm[5];
float hz(vec3 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ if(float(i)>=uOct) break; s+=a*vnoise(p); p=p*2.03+17.; a*=.5; } return s; }
void main(){
  vec2 p=(vUv*2.-1.)*vec2(uAsp,1.); float t=uPT;
  float f=hz(vec3(p*.9+vec2(t*.03,0.),t*.05)); float f2=hz(vec3(p*1.7-vec2(0.,t*.04)+f,t*.04+9.));
  vec3 fog=mix(vec3(.10,.02,.20),vec3(0.,.12,.2),f2)*smoothstep(.3,.85,f)*.7;
  { float f3=hz(vec3(p*.9+vec2(t*.03,-t*.06*uStory.x),t*.05)); fog*=.7+.6*f3; }          // haze rises (up) / sinks (down)
  vec3 col=fog;
  for(int e=0;e<5;e++){
    vec2 v=p-uEN[e]*vec2(uAsp,1.); float r=length(v); float ang=atan(v.y,v.x);
    vec2 hcn=uHero.xy*2.-1.; float aim=atan(hcn.y-uEN[e].y,(hcn.x-uEN[e].x)*uAsp); float da=abs(mod(ang-aim+3.1416,6.2832)-3.1416);
    float wedge=1.-smoothstep(.5,1.3,da);
    float rays=pow(.5+.5*cos(ang*9.-t*(.35+float(e)*.07)+float(e)*2.),3.);
    vec3 c=e==0||e==4?vec3(.1,1.,.75):e==1||e==3?vec3(1.,.15,.8):vec3(.5,.25,1.);
    col+=c*(.14*rays*wedge*exp(-r*.8)+.07*exp(-r*1.5))*(.4+f*1.2)*uEm[e];
  }
  float hrr=heroR(vUv); float rimb=exp(-sqf((hrr-1.35)*3.2));
  col*=mix(.2,1.,smoothstep(.8,1.2,hrr));                                              // haze stays dark in the core
  col+=uStoryCol*rimb*(.05+.09*uStory.y+.1*uStory.w)*(.5+f2);                          // and gathers on the eye-wall
  gl_FragColor=vec4(min(col*uHz*.6,vec3(.3)),1.);
}`;

const COMP_FRAG = (P) => `precision highp float;
${P}
varying vec2 vUv; uniform sampler2D tHaze; uniform float uUse,uHz,uAsp,uRipAge,uRipStr,uPT; uniform vec2 uRipC; uniform vec3 uRipCol;
void main(){
  vec2 uv=vUv;
  vec3 col=mix(vec3(.05,.008,.10),vec3(.012,.0,.05),smoothstep(0.,.7,uv.y));
  col+=vec3(.02,.003,.035)*exp(-uv.y*5.);
  col+=texture2D(tHaze,uv).rgb*uUse*uHz;
  float hrr=heroR(uv);
  col+=uStoryCol*exp(-sqf((hrr-1.35)*3.2))*(.015+.035*uStory.y+.1*uStory.w);          // eye-wall halo
  vec2 pq=(uv-vec2(uHero.x,uHero.y-uHero.w))/vec2(uHero.z*1.9,uHero.w*.3); col+=uStoryCol*exp(-dot(pq,pq))*(.1+.1*uStory.y)*uHz;   // floor glow under the plinth
  col*=mix(.55,1.,smoothstep(.8,1.2,hrr));
  float d=length((uv*2.-1.-uRipC)*vec2(uAsp,1.));
  col+=uRipCol*exp(-sqf((d-uRipAge*1.8)*10.))*uRipStr*.3*max(0.,1.-uRipAge/1.3);
  gl_FragColor=vec4(finish(col),1.);
}`;

export function create(ctx) {
  const { THREE: T = THREE } = ctx;
  const q0 = ctx.quality;
  const G = ctx.GLSL;
  // Assemble shader prelude: COMMON plus any guard/alertMix/finish chunks it does not already include.
  let P = G.COMMON;
  for (const k of ['GUARD', 'guard', 'ALERT', 'alertMix', 'FINISH', 'finish']) { const v = G[k]; if (typeof v === 'string' && !P.includes(v)) P += '\n' + v; }
  P += '\nfloat sqf(float x){ return x*x; }\n';
  const kit = heroKit(ctx, P); P = kit.P; const hu = kit.hu;
  const cm = () => ({ ...ctx.common(), ...hu });
  const parU = { value: new THREE.Vector3() };
  const U = {
    uPT: { value: 0 }, uK: { value: 1 }, uPar: parU, uAsm: { value: 1 },
    uBlend: { value: 0 }, uPatA: { value: 0 }, uPatB: { value: 0 }, uPer: { value: 19 },
    uConv: { value: 0 }, uRipStr: { value: 0 }, uRipAge: { value: 9 }, uRipC: { value: new THREE.Vector2(0.28, 0.23) },
    uRipCol: { value: new THREE.Color(0, 1, 1) }, uEm: { value: [1, 1, 1, 1, 1] }, uHz: { value: 1 },
  };
  const S = { quality: q0, phase: 'live', pt: 0, tNext: 15 + ctx.rnd() * 10, blendT: -1, ph: 0, pd: 1, ripT: 9, ripStr: 0 };
  const forced = ctx.opts && ctx.opts.pat != null ? +ctx.opts.pat : null;
  if (forced != null) { U.uPatA.value = U.uPatB.value = forced; }

  // Beams
  const MAXB = 95, PER = [8, 13, 19];
  const bg = new THREE.InstancedBufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  bg.setIndex([0, 1, 2, 0, 2, 3]);
  const inst = new Float32Array(MAXB * 2);
  for (let i = 0; i < MAXB; i++) { inst[i * 2] = i; inst[i * 2 + 1] = ctx.rnd() * 100 + 1; }
  bg.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 2));
  bg.instanceCount = MAXB;
  const beamMat = ctx.track(new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG(P),
    uniforms: { ...cm(), ...U }, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }));
  const beams = new THREE.Mesh(ctx.track(bg), beamMat); beams.frustumCulled = false; beams.renderOrder = 2; ctx.stage.add(beams);

  // Sparks
  const NS = 4000, sd = new Float32Array(NS * 4);
  for (let i = 0; i < sd.length; i++) sd[i] = ctx.rnd();
  const sg = ctx.track(new THREE.BufferGeometry());
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 3), 3));
  sg.setAttribute('aS', new THREE.BufferAttribute(sd, 4));
  const sparkMat = ctx.track(new THREE.ShaderMaterial({
    vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG(P), uniforms: { ...cm(), ...U },
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  }));
  const sparks = new THREE.Points(sg, sparkMat); sparks.frustumCulled = false; sparks.renderOrder = 3; ctx.stage.add(sparks);

  // Smoke floor
  const fg = ctx.track(new THREE.PlaneGeometry(1, 1)); // placeholder replaced below
  const fl = new Float32Array([-45, 0, -4.5, 45, 0, -4.5, 45, 0, -70, -45, 0, -70]);
  const smg = ctx.track(new THREE.BufferGeometry());
  smg.setAttribute('position', new THREE.BufferAttribute(fl, 3)); smg.setIndex([0, 2, 1, 0, 3, 2]);
  fg.dispose();
  const smokeMat = ctx.track(new THREE.ShaderMaterial({
    vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG(P), uniforms: { ...cm(), ...U },
    transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  }));
  const smoke = new THREE.Mesh(smg, smokeMat); smoke.frustumCulled = false; smoke.renderOrder = 1; ctx.stage.add(smoke);

  // Haze layer (q1+ at create) and backdrop composite
  const EN = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
  const lU = { uOct: { value: q0 >= 2 ? 4 : 2 }, uAsp: { value: 1.78 }, uEN: { value: EN } };
  let layer = null;
  if (q0 >= 1) {
    const lm = ctx.track(new THREE.ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: LAYER_FRAG(P), uniforms: { ...cm(), ...U, ...lU }, depthTest: false, depthWrite: false,
    }));
    layer = ctx.layer(lm, { scale: 0.25 });
  }
  const dummy = ctx.track(new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1));
  dummy.needsUpdate = true;
  const compU = { tHaze: { value: layer ? layer.texture : dummy }, uUse: { value: layer ? 1 : 0 }, uAsp: lU.uAsp };
  ctx.backdrop(ctx.track(new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader: COMP_FRAG(P), uniforms: { ...cm(), ...U, ...compU }, depthTest: false, depthWrite: false,
  })));

  const nextPat = () => { let p; do { p = Math.floor(ctx.rnd() * 5); } while (p === U.uPatB.value); return p; };
  const sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
  const cl = (x) => Math.min(1, Math.max(0, x));
  const ndc = (e, i, asp) => { const z = Math.max(-E_POS[e][2], 0.25); EN[e].set((E_POS[e][0] - parU.value.x) / z * F / asp, (E_POS[e][1] - parU.value.y) / z * F); };

  const api = {
    update(dt, t, info) {
      info = info || {};
      const al = ctx.alert.value, sp = 1 + 0.4 * al;
      kit.sync();
      S.pt += dt * sp * (0.75 + 0.9 * hu.uStory.value.y); U.uPT.value = S.pt;
      U.uRipC.value.set(hu.uHero.value.x * 2 - 1, hu.uHero.value.y * 2 - 1);   // ripples/converge always aim at the widget
      const par = info.par; if (par) parU.value.set(par.x * 0.004, par.y * 0.004, 0);
      const asp = ctx.res.value.x / ctx.res.value.y; lU.uAsp.value = asp;
      // pattern engine
      if (forced == null) {
        S.tNext -= dt;
        if (S.blendT < 0 && S.tNext <= 0) { U.uPatB.value = nextPat(); S.blendT = 0; }
        if (S.blendT >= 0) { S.blendT += dt / 3.5; U.uBlend.value = S.blendT; if (S.blendT >= 1) { U.uPatA.value = U.uPatB.value; U.uBlend.value = 0; S.blendT = -1; S.tNext = 15 + ctx.rnd() * 10; } }
      }
      // enter / exit choreography
      const em = U.uEm.value;
      if (S.phase === 'enter' || S.phase === 'exit') {
        S.ph += dt; const p = cl(S.ph / S.pd);
        if (S.phase === 'enter') { for (let e = 0; e < 5; e++) em[e] = sm(0, 1, (p - e * 0.13) / 0.45); U.uAsm.value = p; U.uHz.value = sm(0, 0.7, p); if (p >= 1) S.phase = 'live'; }
        else { for (let e = 0; e < 5; e++) em[e] = 1 - sm(0, 1, (p - (4 - e) * 0.1) / 0.5); U.uAsm.value = 1 - p; U.uHz.value = 1 - sm(0.2, 1, p); }
      }
      // ripple: converge 0.6 s then fan out
      S.ripT += dt; const a = S.ripT; U.uRipAge.value = a;
      U.uConv.value = S.ripStr * (a < 0.6 ? sm(0, 0.08, a) : 1 - sm(0.6, 1.4, a));
      for (let e = 0; e < 5; e++) ndc(e, 0, asp);
      U.uK.value = api._k;
    },
    _k: 1,
    setIntensity(a) { api._k = a; },
    enter(d) { S.phase = 'enter'; S.ph = 0; S.pd = Math.max(0.1, d); },
    exit(d) { S.phase = 'exit'; S.ph = 0; S.pd = Math.max(0.1, d); },
    ripple(o) {
      o = o || {};
      if (o.color) { if (o.color.isColor) U.uRipCol.value.copy(o.color); else U.uRipCol.value.set(o.color); }
      S.ripT = 0; S.ripStr = Math.max(0.3, o.strength == null ? 1 : o.strength); U.uRipStr.value = S.ripStr;
    },
    shockwave(x, z, color) { api.ripple({ x, z, color, strength: 1, screen: null }); },
    event(type, p) { if (type === 'heroPulse') api.ripple({ strength: Math.max(0.5, (p && p.strength) || 1), color: p && p.color }); },
    setQuality(qq) {
      S.quality = qq; U.uPer.value = PER[qq]; bg.instanceCount = PER[qq] * 5;
      sg.setDrawRange(0, [1500, 2500, 4000][qq]); lU.uOct.value = qq >= 2 ? 4 : 2;
      compU.uUse.value = layer && qq >= 1 ? 1 : 0;
      if (layer) layer.uniforms && layer.uniforms.uOct && (layer.uniforms.uOct.value = lU.uOct.value);
    },
    morphPoints(out, n) {
      // sample points along the current fan beams, projected then unprojected through the main camera at depth 260
      const cam = ctx.camera, v = new THREE.Vector3(), o = cam.position, asp = ctx.res.value.x / ctx.res.value.y;
      for (let i = 0; i < n; i++) {
        const e = i % 5, f = ((i * 0.618) % 1), u = f - 0.5, tt = S.pt;
        const ba = [-0.3, 3.44, 0.7, 1.57, 2.4][e], an = ba + u * 1.5 + 0.55 * Math.sin(tt * 0.55 + e * 1.3), r = 0.7 + 0.3 * Math.sin(tt * 0.4 + f * 3 + e);
        const s = Math.pow(Math.random(), 1.5) * 40, dz = 1 / Math.sqrt(1 + r * r);
        const px = E_POS[e][0] + Math.cos(an) * r * dz * s, py = E_POS[e][1] + Math.sin(an) * r * dz * s, pz = E_POS[e][2] - dz * s, z = Math.max(-pz, 0.25);
        const nx = Math.max(-1.2, Math.min(1.2, px / z * F / asp)), ny = Math.max(-1.2, Math.min(1.2, py / z * F));
        v.set(nx, ny, 0.5).unproject(cam).sub(o).normalize().multiplyScalar(260).add(o);
        out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
      }
      return true;
    },
    grade: { bloom: 0.8, bloomThreshold: 0.6, bloomRadius: 0.8, tint: new THREE.Color(0.85, 0.8, 1.0), tintAmt: 0.05, sat: 1.1, contrast: 1.05, ca: 0.0015, grain: 0.04, vignette: 0.35, scan: 0.2 },
    cameraBias: { orbitScale: 1.0, bob: 0.9 },
    dispose() { bg.dispose(); },
  };
  api.setQuality(q0);
  return api;
}
