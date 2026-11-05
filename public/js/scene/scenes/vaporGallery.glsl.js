// Shaders for vaporGallery. All fragment shaders end with finish().
export const HASH = `
float vh1(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float vh21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 vh2(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3 vh3(vec3 p3){ p3=fract(p3*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yxz+33.33); return fract((p3.xxy+p3.yxx)*p3.zyx); }
mat3 vrot(vec3 a,float t){ float c=cos(t),s=sin(t),o=1.-c; return mat3(o*a.x*a.x+c,o*a.x*a.y+s*a.z,o*a.z*a.x-s*a.y, o*a.x*a.y-s*a.z,o*a.y*a.y+c,o*a.y*a.z+s*a.x, o*a.z*a.x+s*a.y,o*a.y*a.z-s*a.x,o*a.z*a.z+c); }
vec3 vpal(float t){ return .5+.5*cos(6.28318*(t+vec3(0.,.33,.67))); }
float vbounce(float x){ x=clamp(x,0.,1.); float e=1.-pow(1.-x,3.); return x<.82? e : 1.-.05*sin((x-.82)/.18*3.14159)*(1.-x); }
`;
export const FHEAD = `uniform float uP;\n` + HASH;
export const VHEAD = `uniform float uP; uniform vec2 uRes;\n` + HASH;

export const BACK_VS = `void main(){ gl_Position=vec4(position.xy,1.,1.); }`;
export const BACK_FS = `uniform float uFloor; uniform vec4 uRip; uniform vec3 uRipCol; uniform vec2 uPar;
void main(){
  vec2 q=gl_FragCoord.xy/uRes; float asp=uRes.x/uRes.y; const float H=.285;
  // ---- lavender to peach wall
  float wy=clamp((q.y-H)/(1.-H),0.,1.);
  vec3 wall=mix(vec3(.30,.15,.15),vec3(.22,.09,.24),smoothstep(0.,.35,wy)); wall=mix(wall,vec3(.10,.065,.23),smoothstep(.25,1.,wy));
  wall+=vec3(.02,.012,.02)*smoothstep(.3,1.,sin((q.x*asp*2.2+q.y*1.4-uP*.04)*3.)*.5+.5);
  // pixel stars on the wall (static grid, twinkling)
  vec2 sg=floor(vec2(q.x*asp,q.y)*vec2(150.)); float sh=vh21(sg);
  float st=step(.985,sh)*step(H+.03,q.y)*(.4+.6*pow(.5+.5*sin(uP*(1.+sh*3.)+sh*60.),2.));
  wall+=vec3(1.,.8,1.)*st*.9*smoothstep(.5,.9,q.y);
  // halftone moon + dashed neon ring
  vec2 mp=(q-vec2(.19-uPar.x*.5,.64))*vec2(asp,1.); float md=length(mp);
  float rr=.5*(.25+.75*clamp(.5+mp.y/.42,0.,1.));
  float dots=smoothstep(rr+.12,rr-.12,length(fract(mp*58.)-.5));
  wall=mix(wall,vec3(.46,.17,.34)*(.5+.5*dots),smoothstep(.215,.205,md)*.8);
  float ang=atan(mp.y,mp.x); float ring=exp(-pow((md-.245)/.0035,2.))*step(.5,fract(ang*3.+uP*.12));
  wall+=vec3(.9,.45,1.)*ring*1.3+vec3(.3,.9,.9)*exp(-pow((md-.265)/.002,2.))*step(.3,fract(-ang*5.+uP*.2))*1.1;
  vec3 col=wall*.6;
  if(q.y<H){
    float t=1./max(H-q.y,.004); float xw=(q.x-.5+uPar.x)*asp*t;
    vec2 p=vec2(xw*.9,t*1.6)+vec2(uP*.30,uP*.55);
    vec2 w=fwidth(p)+1e-4;
    vec2 i=2.*(abs(fract((p-.5*w)*.5)-.5)-abs(fract((p+.5*w)*.5)-.5))/w; float chk=.5-.5*i.x*i.y;
    vec3 pk=vec3(.20,.045,.13), tl=vec3(.03,.13,.16);
    float fy=(H-q.y)/H; vec3 fc=mix(tl,pk,chk); float inside=1.;
    if(uFloor<.999){
      vec2 id=floor(p),f=fract(p); float s=vh21(id)*.4+(1.-fy)*.35;
      float pr=clamp(uFloor*1.5-s,0.,1.); float a=(1.-pr)*1.5708; float c=max(cos(a),.001);
      float fx=(f.x-.5)/c+.5; inside=step(0.,fx)*step(fx,1.)*step(.001,pr)*(1.-step(.999,1.-pr)*0.);
      fc*=.35+.65*c; float edge=exp(-abs(fx-.5)*.0)*smoothstep(0.,.3,pr)*(1.-smoothstep(.6,1.,pr));
      fc+=mix(uRipCol*0.+vec3(.9,.3,.8),vec3(.3,.9,1.),chk)*edge*inside*.5;
      fc=mix(vec3(.02,.01,.05),fc,inside);
    }
    vec3 hz=vec3(.34,.17,.16);
    fc=mix(fc,hz*.8,pow(1.-clamp(fy,0.,1.),2.)*.55);
    float streak=exp(-pow((q.x-.19)/(.02+.09*(1.-fy)+.01*sin(fy*30.-uP*2.)),2.))*smoothstep(0.,.5,fy)*(1.-smoothstep(.5,1.,fy));
    fc+=vec3(.5,.2,.4)*streak*(.5+.5*chk)*.7;
    // ripple ring across the floor
    float cx=(uRip.x-.5)*asp*(1./(H-.13)); float d=length(vec2(xw-cx,(t-1./(H-.13))*.9)); float R=uRip.y*7.;
    float rg=exp(-pow((d-R)/.32,2.))*(1.-smoothstep(0.,1.7,uRip.y))*uRip.z;
    fc+=uRipCol*rg*(.5+.9*chk)*1.4;
    fc*=smoothstep(.0,.04,fy);
    col=fc+vec3(.34,.17,.16)*exp(-abs(q.y-H)*220.)*1.8*smoothstep(0.,.2,uFloor);
  }
  // wall shock ring
  float rr2=length((q-vec2(uRip.x,.55))*vec2(asp,1.)); float R2=uRip.y*1.1;
  col+=uRipCol*exp(-pow((rr2-R2)/.008,2.))*(1.-smoothstep(0.,1.4,uRip.y))*uRip.z*2.;
  gl_FragColor=vec4(finish(col),1.);
}`;

export const BUST_VS = `attribute vec3 aBary; attribute vec3 aC; attribute float aR; uniform float uBreak; uniform vec2 uY;
varying vec3 vB; varying vec3 vV; varying float vYh; varying float vR;
void main(){
  vec3 p=position; vB=aBary; vR=aR; vYh=(position.y-uY.x)/(uY.y-uY.x);
  float k=clamp(uBreak*1.3-aR*.3,0.,1.);
  if(k>0.){ vec3 h=vh3(vec3(aR*91.7,aR*13.1,5.)); vec3 dir=normalize(aC-vec3(0.,.5,0.)+.01)+(h-.5)*1.4; vec3 ax=normalize(h-.5+.01);
    p=aC+vrot(ax,k*7.*(aR+.4))*(p-aC)+dir*k*k*8.; }
  vec4 mv=modelViewMatrix*vec4(p,1.); vV=mv.xyz; gl_Position=projectionMatrix*mv;
}`;
export const BUST_FS = `uniform float uBuild,uBreak,uFlare;
varying vec3 vB; varying vec3 vV; varying float vYh; varying float vR;
vec3 env(vec3 R){ float e=R.y;
  vec3 c=mix(vec3(.06,.35,.42),vec3(.95,.42,.78),smoothstep(-.25,.75,e));
  c=mix(c,vec3(.12,.05,.25),smoothstep(.05,-.5,e)*.7);
  c+=vec3(1.,.8,.65)*exp(-pow(e*7.,2.))*.7; c*=.55*(.8+.2*sin(R.x*9.+R.z*5.)); return c; }
void main(){
  vec3 N=normalize(cross(dFdx(vV),dFdy(vV))); vec3 V=normalize(vV); if(dot(N,V)>0.) N=-N;
  vec3 R=reflect(V,N); float f=pow(1.-abs(dot(N,-V)),2.2);
  vec3 col=env(R); vec3 film=vpal(f*1.4+R.x*.35+uP*.04+uFlare*.6);
  col=mix(col,film*.7,.3+.45*f+.35*uFlare);
  vec3 L=normalize(vec3(-.4,.6,.7)); col+=vec3(1.,.9,1.)*pow(max(dot(R,L),0.),90.)*.45;
  col+=uAccent*uFlare*.8*f;
  vec3 dv=fwidth(vB); vec3 e3=smoothstep(vec3(0.),dv*1.6,vB); float edge=1.-min(e3.x,min(e3.y,e3.z));
  float sc=uBuild*1.35-.1; float filled=smoothstep(sc,sc-.1,vYh)*step(.0001,uBuild);
  float line=exp(-abs(vYh-sc)*45.)*step(.001,uBuild)*step(uBuild,.999);
  vec3 ec=mix(uAccent2*1.4+vec3(.2),uAccent*1.6,vR);
  float shat=smoothstep(.0,.3,uBreak);
  col=mix(ec*(.5+edge*1.2),col,filled); col+=ec*edge*(.25+shat*1.6)*filled;
  col+=vec3(.8,1.,1.)*line*1.5;
  float a=max(filled,edge*.9)*(1.-smoothstep(.7,1.,uBreak))+line*.5;
  gl_FragColor=vec4(finish(col),clamp(a,0.,1.));
}`;

export const COL_VS = `attribute vec4 iA; attribute vec4 iB; uniform float uBuild,uBreak; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vL; varying float vAl;
void main(){
  float dl=iB.z, ph=iB.y;
  float lb=clamp(uBuild*1.8-dl*.8,0.,1.); float lx=clamp(uBreak*1.6-dl*.6,0.,1.);
  vec3 p=position*iA.w; vec3 n=normal;
  float tz=iB.x+sin(uP*.35+ph)*.07+(1.-lb)*(dl-.5)*1.4+lx*(dl-.5)*3.;
  float ty=uP*.12*(iB.w)+lx*4.; mat3 R=vrot(vec3(0.,1.,0.),ty)*vrot(vec3(0.,0.,1.),tz)*vrot(vec3(1.,0.,0.),sin(uP*.27+ph*2.)*.06);
  p=R*p; n=R*n;
  vec3 c=iA.xyz; c.y+=sin(uP*.55+ph)*3.5+(1.-vbounce(lb))*(260.)+lx*lx*320.;
  vL=lb*(1.-lx); vAl=lb*(1.-smoothstep(.55,1.,lx));
  vec3 w=c+p; vW=w; vN=n; vUv=uv; gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);
}`;
export const COL_FS = `varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vL; varying float vAl;
void main(){
  vec3 N=normalize(vN); vec3 V=normalize(cameraPosition-vW);
  float fl=.55+.45*cos(vUv.x*6.28318*14.); float nz=vnoise(vW*.045);
  float vein=pow(1.-abs(sin((vUv.y*3.+nz*5.)*3.14159)),6.);
  vec3 base=mix(vec3(.82,.72,.88),vec3(.95,.8,.82),nz)*(.86+.14*fl)-vein*.12;
  float dif=max(dot(N,normalize(vec3(-.5,.6,.6))),0.)*.7+.3;
  float rim=pow(1.-max(dot(N,V),0.),3.);
  vec3 col=base*dif*.55+uAccent2*rim*.7+uAccent*pow(max(dot(N,normalize(vec3(.8,.1,.3))),0.),3.)*.25;
  col+=uAccent*1.2*smoothstep(.0,.15,vL)*(1.-smoothstep(.15,.4,vL))*.5;
  gl_FragColor=vec4(finish(col),vAl);
}`;

export const QUAD_VS = `attribute vec4 iA; attribute vec4 iB; uniform float uKind,uBuild,uBreak; varying vec2 vUv; varying vec4 vX;
void main(){
  vec3 p=position; vec2 q=vec2(position.x+.5,position.y); vUv=q; float e=1.; vec3 c=iA.xyz; vec2 sz=vec2(iA.w,iA.w*iB.x);
  float lb=clamp(uBuild*1.6-iB.z*.6,0.,1.), lx=clamp(uBreak*1.6-iB.z*.6,0.,1.);
  vX=vec4(0.);
  if(uKind<.5){
    float per=iB.w, cyc=floor((uP+iB.y*per)/per), u=fract((uP+iB.y*per)/per); vec2 hh=vh2(vec2(iB.y*77.,cyc));
    float o=smoothstep(0.,.1,u)*(1.-smoothstep(.84,.95,u)); e=o*o*(3.-2.*o)*lb*(1.-lx);
    c.xy+=(hh-.5)*vec2(70.,26.)*vec2(1.,1.)+vec2(sin(uP*.2+iB.y*6.)*10.,sin(uP*.33+iB.y*9.)*3.);
    float tile=floor(vh21(vec2(cyc,iB.y*13.))*8.); vX=vec4(tile,e,u,hh.x);
    float wf=mix(.04,1.,smoothstep(0.,1.,e*1.35-(1.-q.y)*.35*(1.-e))); p.x*=sz.x*wf; p.y=q.y*sz.y*e; p.x+=(1.-e)*sz.x*.15*(q.y-.3);
  } else {
    float sw=sin(uP*.9+iB.y*6.28)*.6+sin(uP*1.7+iB.y*3.)*.4; e=lb*(1.-lx*.9); vX=vec4(sw,iB.y,e,0.);
    p.x*=sz.x*.9; p.y=q.y*sz.y*e*(1.-lx*.5); p.x+=sw*q.y*q.y*sz.y*.1*e; p.x+=lx*q.y*q.y*sz.y*.9*(iB.y-.5)*2.;
  }
  vec3 w=c+vec3(p.xy,0.); gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);
}`;
export const QUAD_FS = `uniform float uKind; uniform sampler2D uAtlas; varying vec2 vUv; varying vec4 vX;
float frondField(vec2 p,float sw){ float leaf=0.;
  for(int k=0;k<7;k++){ float th=-.45+float(k)*4.04/6.+sw*.09*(1.+float(k-(k/2)*2)); vec2 d=vec2(cos(th),sin(th)); vec2 n=vec2(-d.y,d.x);
    float u0=dot(p,d); vec2 p2=p+vec2(0.,.55*u0*u0); float u=dot(p2,d),v=dot(p2,n); float L=.46;
    float w=.042*sin(3.14159*clamp(u/L,0.,1.))*(.55+.45*abs(sin(u*75.)));
    leaf=max(leaf,step(0.,u)*step(u,L)*smoothstep(w,w*.55,abs(v))); }
  return leaf; }
void main(){
  vec3 col; float a;
  if(uKind<.5){
    float e=vX.y; float tile=vX.x; vec2 tuv=vec2((mod(tile,4.)+vUv.x)/4.,(floor(tile/4.)+vUv.y/1.)/2.);
    vec4 t=texture2D(uAtlas,tuv); vec2 b=min(vUv,1.-vUv); float bd=smoothstep(.0,.03,min(b.x*.8,b.y));
    float edge=1.-smoothstep(0.,.025,min(vUv.x,1.-vUv.x)*.7); edge=max(edge,1.-smoothstep(0.,.02,abs(vUv.y-1.)));
    col=t.rgb*.62+uAccent*.05+mix(uAccent,uAccent2,vX.w)*(max(edge,1.-smoothstep(0.,.02,vUv.y))*1.1);
    a=t.a*.62*smoothstep(0.,.25,e);
  } else {
    vec2 uv=vUv; float sw=vX.x; float cxp=.5+.05*sin(uv.y*3.)+sw*uv.y*uv.y*.05;
    vec2 cr=vec2(.5+.05*sin(.76*3.)+sw*.76*.76*.05,.76);
    float f=frondField((uv-cr)*vec2(.9,1.),sw);
    float tw=mix(.034,.016,uv.y); float tr=smoothstep(tw,tw*.6,abs(uv.x-(.5+.05*sin(uv.y*3.)+sw*uv.y*uv.y*.05)))*step(uv.y,.78);
    float m=max(f,tr);
    col=mix(vec3(.025,.008,.06),mix(vec3(.55,.12,.4),uAccent*.55,.4),smoothstep(.45,1.,uv.y)*.55*(1.-f*.4));
    col+=mix(uAccent2,uAccent,.5)*.25*pow(max(f-tr,0.),1.)*smoothstep(.5,.9,uv.y)*(.5+.5*sin(uv.x*40.+uP));
    a=m*.96*smoothstep(0.,.3,vX.z);
  }
  gl_FragColor=vec4(finish(col),a);
}`;

export const POLY_VS = `attribute vec3 aBary; attribute vec4 iO; attribute vec4 iP; uniform vec3 uC,uAccent,uAccent2; uniform float uOrb,uBuild,uBreak; varying vec3 vB; varying vec3 vCol; varying float vAl;
void main(){
  float lb=clamp(uBuild*1.5-iP.z*.5,0.,1.), lx=clamp(uBreak*1.5-iP.z*.5,0.,1.);
  float a=uOrb*iO.y+iO.z+lx*5.; float R=iO.x*(1.+(1.-lb)*(1.-lb)*6.+lx*lx*7.);
  vec3 b=vec3(cos(a)*R*.8,0.,sin(a)*R*.6);
  b=vrot(vec3(1.,0.,0.),iO.w)*vrot(vec3(0.,0.,1.),iO.w*.7-.3)*b;
  float s=iP.x*lb*(1.-lx);
  vec3 ax=normalize(vh3(vec3(iP.y*31.,iP.y*7.,3.))-.5+.01);
  vec3 p=vrot(ax,uP*(.4+iP.y*.8)+iP.y*20.)*position*s;
  vec3 w=uC+b+p; w.y+=sin(uP*.5+iO.z*3.)*3.; vB=aBary; vAl=lb*(1.-lx);
  float cs=iP.w; vCol=cs<.25?uAccent:(cs<.5?uAccent2:(cs<.75?vec3(.35,1.,.95):vec3(1.,.8,.4)));
  gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);
}`;
export const POLY_FS = `varying vec3 vB; varying vec3 vCol; varying float vAl;
void main(){ vec3 dv=fwidth(vB); vec3 e3=smoothstep(vec3(0.),dv*1.5,vB); float edge=1.-min(e3.x,min(e3.y,e3.z));
  vec3 col=vCol*(edge*.55+.02)*vAl; gl_FragColor=vec4(finish(col),(edge+.1)*vAl); }`;

export const STAR_VS = `attribute vec4 aS; uniform vec3 uBox; uniform float uBuild,uBreak,uPunch; varying float vTw; varying float vK; varying vec3 vCol;
void main(){
  vec3 p=position; float k=aS.z;
  if(k>.82){ p.xy+=vec2(.7,.35)*aS.w*uP*7.; p.xy=mod(p.xy+uBox.xy*.5,uBox.xy)-uBox.xy*.5; }
  vec2 ctr=vec2(-uBox.x*.3,uBox.y*.15); float lb=clamp(uBuild*1.4-aS.y*.4,0.,1.), lx=clamp(uBreak*1.2-aS.y*.2,0.,1.);
  p.xy=ctr+(p.xy-ctr)*(.15+.85*smoothstep(0.,1.,lb))*(1.+lx*lx*3.);
  float tw=pow(.5+.5*sin(uP*(1.5+aS.w*4.)+aS.y*40.),3.); vTw=tw; vK=aS.x;
  vCol=vpal(aS.y*.3+.85)*.5+.5;
  gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
  gl_PointSize=min(48.,aS.x*(1.+tw*.8)*uRes.y/1080.*lb*(1.-lx));
}`;
export const STAR_FS = `varying float vTw; varying float vK; varying vec3 vCol;
void main(){ vec2 c=abs(gl_PointCoord-.5); float a;
  if(vK>3.5){ a=max(smoothstep(.07,0.,c.x)*(1.-c.y*2.),smoothstep(.07,0.,c.y)*(1.-c.x*2.)); } else a=step(max(c.x,c.y),.5);
  vec3 col=vCol*(.5+1.6*vTw); gl_FragColor=vec4(finish(col),a*(.35+.65*vTw)); }`;
