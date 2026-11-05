// Midnight Aurora shaders. Everything is screen-space (uv, bottom-up); the scene is camera independent.
// H = water line (uv y), K = vertical compression of reflections, shared by the backdrop and the mirrored fireworks.
export const HK = 'const float H=0.27; const float K=0.4;';

const HASH = /* glsl */`
float ax_sq(float x){ return x*x; }
float ax_h(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 ax_h2(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }`;

const ZONE = /* glsl */`
float zoneAtt(vec2 q){ vec2 m=smoothstep(uGuardRect.xy-.04,uGuardRect.xy+.02,q)*(1.-smoothstep(uGuardRect.zw-.02,uGuardRect.zw+.04,q)); return 1.-.75*m.x*m.y; }`;

// ---------- backdrop: sky, stars, moon, aurora wash, skyline, water (sky(mirrored)) ----------
export const BACK_VS = 'void main(){ gl_Position = vec4(position.xy, 1.0, 1.0); }';
export const BACK_FS = (G) => `${G}
${HK}${HASH}
uniform float uT, uEnter, uExit, uStars, uAur; uniform vec4 uRip; uniform vec2 uPar;
vec3 ax_stars(vec2 q, float a){
  vec2 g=vec2(q.x*a,q.y)*190.; vec2 id=floor(g), f=fract(g)-.5;
  float h=ax_h(id); if(h>.075) return vec3(0.);
  float vis=step(h/.075, uStars); if(vis<.5) return vec3(0.);
  vec2 off=(ax_h2(id+3.)-.5)*.6; vec2 dv=f-off; float d=length(dv);
  float h2=ax_h(id+7.7); float sz=mix(.05,.15,h2*h2*h2);
  float tw=.5+.5*sin(uT*(.8+h*30.)+h*200.);
  float core=exp(-d*d/(sz*sz))*(.25+.75*tw);
  float big=step(.88,h2);
  core+=big*tw*(exp(-abs(dv.x)*38.)*exp(-abs(dv.y)*7.)+exp(-abs(dv.y)*38.)*exp(-abs(dv.x)*7.))*.45;
  vec3 c=mix(vec3(.65,.8,1.),vec3(1.,.65,.9),fract(h2*9.));
  return c*core*(.35+1.7*big)*(.3+.7*h2);
}
vec3 ax_wash(vec2 p, float a){
  vec3 acc=vec3(0.);
  float nz=vnoise(vec3(p.x*a*4.,uT*.06,1.7));
  for(int k=0;k<3;k++){
    float i=float(k);
    float yc=.76+.055*i+.03*sin(p.x*4.5+uT*.25+i*2.1)+.014*sin(p.x*12.-uT*.4+i);
    float n=.5+.5*sin(p.x*a*9.+i*7.3+uT*.3+nz*3.);
    float g=exp(-ax_sq((p.y-yc)/(.075+.02*i)))*(.45+1.1*n);
    vec3 c=i<.5?vec3(.1,.85,.95):(i<1.5?vec3(.45,.25,1.):vec3(1.,.3,.75));
    c=mix(c,i<1.5?uAccent2:uAccent,.3);
    acc+=c*g;
  }
  return acc*.1*uAur;
}
vec3 ax_sky(vec2 p, float a){
  float y=p.y;
  vec3 c=mix(vec3(.022,.007,.055),vec3(.004,.003,.02),smoothstep(H,.9,y));
  float hg=exp(-(y-H)*13.);
  c+=vec3(.30,.05,.24)*.42*hg*(.65+.35*cos((p.x-.15)*5.));
  c+=ax_stars(p,a)*smoothstep(H+.01,H+.14,y)*uStars;
  // moon (dim, haloed)
  vec2 md=(p-vec2(.15,.43))*vec2(a,1.); float mr=length(md);
  if(mr<.4){
  float disc=(1.-smoothstep(.03,.052,mr));
  float cr=.5+.5*sin(md.x*90.)*sin(md.y*70.+1.);
  c+=vec3(.55,.5,.85)*disc*(.2+.14*cr)*uStars;
  c+=vec3(.35,.2,.7)*exp(-mr*mr*260.)*.08*uStars+vec3(.25,.15,.5)*exp(-mr*9.)*.05*uStars;
  }
  c+=ax_wash(p,a);
  // distant skyline
  float dy=p.y-H;
  if(dy>0.&&dy<.05){
  float cx=p.x*a*95.; float id=floor(cx);
  float hh=ax_h(vec2(id,3.));
  float tall=step(.94,ax_h(vec2(id,9.)));
  float eb=mix(.35,1.,smoothstep(.2,.85,abs(p.x-.5)*2.));
  float bh=(.003+.02*hh*hh+tall*.024)*eb*smoothstep(.05,.65,uEnter)*uStars;
  float inside=step(0.,dy)*step(dy,bh);
  vec2 wc=floor(vec2(cx*3.,dy*820.));
  float lit=step(.9,ax_h(wc+11.))*step(.5,fract(cx))*.0+step(.9,ax_h(wc+11.));
  vec3 win=mix(vec3(1.,.6,.25),vec3(.3,.9,1.),ax_h(wc+5.))*lit*(.14+.1*sin(uT*.5+wc.x));
  vec3 sil=vec3(.004,.003,.014)+win;
  sil+=vec3(.5,.1,.45)*exp(-clamp(bh-dy,0.,1.)*420.)*.16;
  c=mix(c,sil,inside);
  }
  return c;
}
void main(){
  vec2 q=gl_FragCoord.xy/uRes; float a=uRes.x/uRes.y;
  float w=step(q.y,H);
  float dep=max(H-q.y,0.);
  vec2 m=vec2(q.x, mix(q.y, H+dep/K, w));
  // water shimmer + ripple rings (elliptic, in perspective)
  float sh=vnoise(vec3(q.x*a*26.,q.y*260.,uT*.45))-.5;
  m.x+=w*(sin(q.y*210.+uT*1.4)*.0012+sh*.006)*(.4+dep*5.);
  float rd=length(vec2((q.x-uRip.x)*a,(q.y-uRip.y)*3.4));
  float rr=0.;
  for(int k=0;k<3;k++){ float f=float(k); rr+=exp(-ax_sq((rd-(uRip.z-f*.17)*.62)/.011))*step(0.,uRip.z-f*.17)*(1.-.28*f); }
  rr*=uRip.w*exp(-uRip.z*.8)*w;
  m.x+=rr*.012; m.y+=rr*.05;
  vec2 pm=m-vec2(uPar.x*.3,0.);
  vec3 col=ax_sky(pm,a);
  // water body
  float fres=mix(.12,.6,exp(-dep*14.));
  vec3 wcol=col*fres*(1.+2.2*pow(max(sh+.5,0.),5.)*smoothstep(.0,.1,col.b+col.r));
  wcol+=vec3(.004,.006,.02)+vec3(.35,.08,.4)*exp(-dep*60.)*.1;
  wcol+=mix(uAccent2,uAccent,.5)*rr*.7;
  col=mix(col,wcol,w);
  // horizon sheen + mist
  col+=vec3(.5,.15,.55)*exp(-abs(q.y-H)*520.)*.22;
  float mist=smoothstep(.3,1.,.5+.5*sin(q.x*a*7.+uT*.05)*sin(q.x*a*2.3-uT*.03+q.y*20.));
  col+=vec3(.25,.08,.32)*mist*exp(-abs(q.y-H)*22.)*.14*uStars;
  gl_FragColor=vec4(finish(col),1.);
}`;

// ---------- aurora curtains: 128x16 strip, instanced x7 ----------
export const AUR_VS = /* glsl */`
attribute vec4 aC;                      // index, base y, height, seed
uniform float uT, uEnter, uExit; uniform vec2 uPar;
varying vec4 vA; varying vec3 vB;
void main(){
  float u=position.x+.5, v=position.y+.5;
  float i=aC.x, base=aC.y, hg=aC.z, sd=aC.w;
  float grow=smoothstep(i*.08,i*.08+.45,uEnter);
  float t=uT*(.6+.25*fract(sd*7.)); float ph=sd*40.;
  float wy=.03*sin(u*4.2+t*.5+ph)+.018*sin(u*9.1-t*.8+ph*1.7)+.008*sin(u*21.-t*1.3+ph);
  float sl=.03*4.2*cos(u*4.2+t*.5+ph)+.018*9.1*cos(u*9.1-t*.8+ph*1.7)+.008*21.*cos(u*21.-t*1.3+ph);
  float hh=hg*(.75+.25*sin(u*3.+t*.35+ph*2.))*grow;
  float y=base+wy+v*hh+uExit*uExit*.14*v;
  float x=-.25+u*1.5+.04*sin(u*6.+t*.4+ph)+v*.05*sin(u*2.+ph)+uPar.x*(.25+.05*i);
  gl_Position=vec4(vec2(x,y)*2.-1.,0.,1.);
  vA=vec4(u,v,grow,i); vB=vec3(sd,abs(sl),hh);
}`;
export const AUR_FS = (G) => `${G}${HASH}
uniform float uT, uExit; uniform vec4 uRip;
varying vec4 vA; varying vec3 vB;
void main(){
  float u=vA.x, v=vA.y, grow=vA.z, i=vA.w, sd=vB.x;
  float rx=u*(55.+sd*30.)+v*2.5*sin(sd*9.+uT*.2);
  float n1=vnoise(vec3(rx,sd*13.,uT*.35));
  float n2=.5+.5*sin(u*17.+sd*5.+uT*.3+v*2.)*sin(u*6.-uT*.2+sd);
  float rays=smoothstep(.28,.85,n1)*(.45+.9*n2);
  float edge=smoothstep(0.,.05,v);
  float br=rays*pow(max(1.-v,0.),1.35)*edge+.3*exp(-v*14.)*(.4+.6*n2)*edge;
  br*=.7+.8*clamp(vB.y*3.,0.,1.);
  br*=smoothstep(0.,.12,u)*(1.-smoothstep(.88,1.,u));
  float odd=mod(i,2.);
  vec3 cLow=mix(vec3(.1,.95,.85),uAccent2,.35*odd);
  vec3 cMid=vec3(.45,.2,1.);
  vec3 cTop=mix(vec3(1.,.25,.75),uAccent,.35*(1.-odd));
  vec3 c=mix(mix(cLow,cMid,smoothstep(0.,.4,v)),cTop,smoothstep(.4,1.,v));
  float sweep=smoothstep(u,u+.25,grow*1.5);
  float d=v*.7+ax_h(vec2(floor(rx*.5),sd*50.))*.3;
  float dis=smoothstep(uExit*1.15-.15,uExit*1.15,d);
  float sx=gl_FragCoord.x/uRes.x;
  float front=exp(-ax_sq((abs(sx-uRip.x)-uRip.z*.9)/.1))*uRip.w*exp(-uRip.z*1.2);
  br*=1.+2.5*front;
  float dim=mix(1.,.55,i/6.);
  vec3 col=c*br*.42*dim*grow*sweep*dis;
  gl_FragColor=vec4(finish(col),1.);
}`;

// ---------- fireworks: 12 bursts x 400 points, ballistic in the vertex shader ----------
export const FW_VS = /* glsl */`
attribute vec4 aD; attribute vec3 aI;   // dir.xyz + rnd ; burst, rocket rank (-1 = spark), spare
uniform vec4 uB0[12]; uniform vec4 uB1[12]; uniform vec4 uB2[12];
uniform float uT, uMirror; uniform vec2 uRes, uPar; uniform vec4 uGuardRect;
varying vec4 vC;
${HK}${ZONE}
const float L=.85;
void main(){
  int bi=int(aI.x+.5);
  vec4 b0=uB0[bi], b1=uB1[bi], b2=uB2[bi];
  float age=b0.z, kind=b0.w, R=b1.w, a=uRes.x/uRes.y, rnd=aD.w;
  vec2 pos=b0.xy; float alpha=0., size=2.; vec3 col=vec3(1.);
  if(aI.y>=0.){
    float r=aI.y; float p=clamp((age+L)/L,0.,1.)-r*.14;
    float vis=step(0.,p)*step(age,0.)*step(-L,age);
    float pc=clamp(p,0.,1.); float e=1.-(1.-pc)*(1.-pc);
    pos=mix(vec2(b2.w,H+.012),b0.xy,e); pos.x+=sin(pc*30.+rnd*6.)*.002*r;
    alpha=vis*(1.-r)*1.3; size=3.4*(1.-r*.6); col=vec3(1.,.8,.5);
  } else {
    float willow=step(1.5,kind)*step(kind,2.5);
    float k=mix(2.4,1.6,willow), life=mix(2.5,3.6,willow);
    float ag=max(age,0.);
    vec3 dd=aD.xyz, d3=dd; float s=mix(.62,1.,step(.5,rnd));
    float ang=atan(dd.y,dd.x);
    if(kind>.5&&kind<1.5){ d3=vec3(cos(ang),sin(ang)*.75,sin(ang)*.55); s=1.; }
    else if(willow>.5){ s=.5+.4*rnd; }
    else if(kind>2.5){ float arm=floor(ang/6.28318*7.+.5); float a2=arm*6.28318/7.+(rnd-.5)*.14; d3=vec3(cos(a2),sin(a2),dd.z*.3); s=.35+.65*fract(rnd*13.); }
    float disp=(1.-exp(-k*ag))/k;
    vec2 off=d3.xy*s*R*k*disp;
    off.y-=.5*mix(.045,.06,willow)*ag*ag;
    pos=b0.xy+vec2(off.x/a,off.y);
    float lf=ag/life;
    float tw=.6+.4*sin(ag*(18.+rnd*26.)+rnd*50.); tw=mix(1.,tw,smoothstep(.3,.7,lf));
    float flash=1.+1.1*exp(-ag*9.);
    alpha=step(0.,age)*(1.-smoothstep(.55,1.,lf))*tw*flash*1.05;
    col=mix(b1.rgb,b2.rgb,step(.5,fract(rnd*7.3)));
    col=mix(col,vec3(1.,.7,.25),willow*.7);
    col=mix(vec3(1.),col,smoothstep(0.,.3,ag));
    size=(4.6+3.2*rnd)*(1.+.35*d3.z)*(.55+.45*(1.-lf))*smoothstep(0.,.12,ag+.02);
  }
  vec2 p=pos+vec2(uPar.x*.5,0.);
  float mir=uMirror;
  float vis2=mix(1.,step(H,pos.y),mir);
  vec2 pr=vec2(p.x+sin((H-(pos.y-H)*K)*260.+uT*2.+rnd*6.)*.0015, H-(pos.y-H)*K);
  p=mix(p,pr,mir);
  alpha*=mix(1.,.42,mir)*vis2*zoneAtt(p);
  size*=mix(1.,.8,mir);
  if(alpha<.003){ gl_Position=vec4(2.,2.,2.,1.); gl_PointSize=1.; vC=vec4(0.); return; }
  vC=vec4(col,alpha);
  gl_Position=vec4(p*2.-1.,0.,1.);
  gl_PointSize=min(size*uRes.y/1080.,48.);
}`;
export const FW_FS = (G) => `${G}
varying vec4 vC;
void main(){
  float d=length(gl_PointCoord-.5)*2.;
  float g=exp(-d*d*3.5)*(1.-smoothstep(.85,1.,d));
  gl_FragColor=vec4(finish(vC.rgb*vC.a*g*1.5),1.);
}`;

// ---------- meteors: 64 instanced streak quads ----------
export const MET_VS = /* glsl */`
attribute vec4 aM;                      // seed, phase offset, r2, r3
uniform float uT; uniform vec4 uSh; uniform vec2 uRes, uPar; uniform vec4 uGuardRect; uniform vec3 uAccent2;
varying vec4 vC; varying vec2 vUv;
${ZONE}
void main(){
  float sd=aM.x;
  float cyc=3600./floor(3600./(110.+sd*170.));
  float tt=uT+aM.y*cyc;
  float cn=floor(tt/cyc); float ph=mod(tt,cyc);
  float dur=.7+aM.z*.7;
  float r1=fract(aM.w+cn*.618), r2=fract(aM.z*7.1+cn*.381), r3=fract(aM.y*3.7+cn*.733);
  float shw=step(sd,uSh.x*.35)*step(0.,uSh.y);
  if(shw>.5){ ph=uSh.y-r3*.6; dur=.8; r1=fract(r1+uSh.z*.37); r2=fract(r2+uSh.z*.61); }
  float pr=ph/dur;
  float act=step(0.,ph)*step(ph,dur);
  if(act<.5){ gl_Position=vec4(2.,2.,2.,1.); vC=vec4(0.); vUv=vec2(0.); return; }
  float a=uRes.x/uRes.y;
  float left=step(r1,.5);
  float x0=mix(.8+(r1-.5)*.7,.02+r1*.5,left);
  float y0=.74+r2*.3;
  float ang=.35+r3*.35; float sg=mix(-1.,1.,left);
  vec2 dir=vec2(sg*cos(ang)/a,-sin(ang));
  float e=1.-pow(max(1.-pr,0.),1.6);
  vec2 head=vec2(x0+uPar.x*.15,y0)+dir*.45*e;
  float len=.17*smoothstep(0.,.2,pr);
  vec2 tail=head-dir*len;
  float env=pow(max(sin(pr*3.14159),0.),.8);
  vec2 hp=head*uRes, tp=tail*uRes;
  vec2 dv=hp-tp; vec2 dn=dv/max(length(dv),1e-3); vec2 pe=vec2(-dn.y,dn.x);
  float wpx=2.6*uRes.y/1080.;
  vec2 px=mix(hp,tp,position.y)+pe*position.x*2.*wpx;
  gl_Position=vec4(px/uRes*2.-1.,0.,1.);
  vec3 tc=mix(uAccent2,vec3(1.,.3,.8),r2);
  vC=vec4(tc,env*zoneAtt(head));
  vUv=vec2(position.x*2.,position.y);
}`;
export const MET_FS = (G) => `${G}
varying vec4 vC; varying vec2 vUv;
void main(){
  float core=exp(-vUv.x*vUv.x*4.), taper=pow(max(1.-vUv.y,0.),1.6), hot=exp(-vUv.y*9.);
  vec3 col=(vC.rgb*taper*.9+vec3(1.,.95,1.)*hot*1.7)*core*vC.a;
  gl_FragColor=vec4(finish(col),1.);
}`;
