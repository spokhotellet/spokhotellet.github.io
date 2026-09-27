/* ============================== EXPERIMENT: SKRIVBORDET I FICKLAMPANS SKEN (three.js) ==============================
   En WebGL-scen bakom texten i hero:
   - Skrivbordsfotot ritas som en yta med relief räknad ur bildens ljushet. En ficklampa följer pekaren (på telefon vandrar den
     långsamt av sig själv) och får nyckeln, klockan och pennan att glänsa.
   - Damm svävar i tre dimensioner framför fotot, med skärpedjup: korn nära eller långt bort blir mjuka ljusringar.
     Dammet syns mest i ljuskäglan. Ingen parallax: kameran står still.
   Vanligt skript (inte modul), så att det fungerar även när index.html öppnas direkt som fil. Laddas bara när WebGL finns, "minska rörelse" är av och Spara data inte är på. Stängs av med ?3d=av (eller ?lager=av).
   Om något misslyckas ligger CSS-versionen av hero kvar orörd. Skriver ingenting till delad data. */
(async()=>{
  const q=new URLSearchParams(location.search);
  if(q.get('lager')==='av') document.documentElement.classList.add('lx-off'); // stänger även av lagren i lager.css
  if(q.get('3d')==='av'||q.get('lager')==='av') return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if(navigator.connection&&navigator.connection.saveData) return;
  const hero=document.querySelector('.gh-hero'); if(!hero) return;
  const probe=document.createElement('canvas');
  if(!(probe.getContext('webgl2')||probe.getContext('webgl'))) return;

  let THREE;
  try{ THREE=await import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js'); }
  catch(e){ return; }

  const mobile=matchMedia('(max-width: 800px)').matches;
  const finePointer=matchMedia('(hover: hover) and (pointer: fine)');
  // Stående skärm får skrivbordet vridet ett kvarts varv (samma val som i app.css)
  const portrait=matchMedia('(orientation: portrait)');
  const photoFor=()=>portrait.matches?'hotellarkiv-1936-staende.jpg':mobile?'hotellarkiv-1936-mobil.jpg':'hotellarkiv-1936.jpg';
  let photoUrl=photoFor();

  // Öppnad som fil: hämta inbäddade kopior av bilderna (korpen3d-lokalt.js), eftersom WebGL inte får läsa file://-bilder
  if(location.protocol==='file:'&&!window.KORPEN3D_BILDER){
    await new Promise(res=>{ const s=document.createElement('script'); s.src='korpen3d-lokalt.js'; s.onload=s.onerror=res; document.head.appendChild(s); });
  }
  const local=window.KORPEN3D_BILDER||{};
  const loadImage=src=>new Promise((res,rej)=>{ const im=new Image(); im.decoding='async'; im.onload=()=>res(im); im.onerror=rej; im.src=local[src]||src; });
  let photo;
  try{ photo=await loadImage(photoUrl); }
  catch(e){ return; }

  /* ---------- Renderare och kamera ---------- */
  let renderer;
  try{ renderer=new THREE.WebGLRenderer({antialias:false, alpha:false, powerPreference:'low-power'}); }
  catch(e){ return; }
  renderer.outputColorSpace=THREE.LinearSRGBColorSpace; // shaders räknar direkt i bildens sRGB-värden, som CSS gör
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, mobile?1.5:1.75));
  const canvas=renderer.domElement;
  canvas.className='k3-canvas'; canvas.setAttribute('aria-hidden','true');
  hero.insertBefore(canvas, hero.firstChild);

  const scene=new THREE.Scene();
  const FOV=38, CAM_Z=6;
  const camera=new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.set(0,0,CAM_Z);
  let viewW=1, viewH=1;

  /* ---------- Skrivbordet ---------- */
  const tex=new THREE.Texture(photo);
  tex.colorSpace=THREE.NoColorSpace; tex.anisotropy=4; tex.needsUpdate=true;
  let photoAspect=photo.naturalWidth/photo.naturalHeight;

  const deskMat=new THREE.ShaderMaterial({
    uniforms:{
      uMap:{value:tex}, uTexel:{value:new THREE.Vector2(1/photo.naturalWidth, 1/photo.naturalHeight)},
      uUvScale:{value:new THREE.Vector2(1,1)}, uUvOffset:{value:new THREE.Vector2(0,0)},
      uLight:{value:new THREE.Vector3(0,0,1.8)}, uCam:{value:camera.position}, uRadius:{value:1.4}
    },
    vertexShader:`
      varying vec2 vUv; varying vec3 vPos;
      uniform vec2 uUvScale, uUvOffset;
      void main(){
        vUv=uv*uUvScale+uUvOffset;
        vec4 wp=modelMatrix*vec4(position,1.0); vPos=wp.xyz;
        gl_Position=projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader:`
      precision highp float;
      uniform sampler2D uMap; uniform vec2 uTexel; uniform vec3 uLight, uCam; uniform float uRadius;
      varying vec2 vUv; varying vec3 vPos;
      float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
      float h(vec2 o){ return lum(texture2D(uMap, vUv+o*uTexel).rgb); }
      void main(){
        vec3 c=texture2D(uMap, vUv).rgb;
        // samma ton som CSS-filtret: saturate(1.2) brightness(0.95) contrast(1.05)
        float l=lum(c); c=mix(vec3(l), c, 1.2)*0.95; c=(c-0.5)*1.05+0.5;
        // relief ur ljusheten (Sobel), så att papperskanter, nyckeln och klockan fångar ljuset
        float s=1.6;
        float dx=(h(vec2(s,-s))+2.0*h(vec2(s,0.))+h(vec2(s,s)))-(h(vec2(-s,-s))+2.0*h(vec2(-s,0.))+h(vec2(-s,s)));
        float dy=(h(vec2(-s,s))+2.0*h(vec2(0.,s))+h(vec2(s,s)))-(h(vec2(-s,-s))+2.0*h(vec2(0.,-s))+h(vec2(s,-s)));
        vec3 n=normalize(vec3(-dx*2.2, -dy*2.2, 1.0));
        vec3 L=uLight-vPos; float d=length(L.xy); L=normalize(L);
        float pool=exp(-d*d/(uRadius*uRadius));
        float edge=smoothstep(uRadius*0.95, uRadius*0.6, d)*0.12;           // svagt skarpare kant, som en riktig lykta
        float diff=max(dot(n,L),0.0);
        vec3 V=normalize(uCam-vPos); vec3 H=normalize(L+V);
        float spec=pow(max(dot(n,H),0.0), 48.0)*smoothstep(0.35,0.8,l);     // bara ljusa ytor (metall, papper) glänser
        float lit=0.92+pool*(0.62*diff+0.1)+edge*pool;
        vec3 col=c*lit + vec3(0.96,0.97,0.93)*spec*pool*0.8;
        gl_FragColor=vec4(col,1.0);
      }`
  });
  const desk=new THREE.Mesh(new THREE.PlaneGeometry(1,1), deskMat);
  scene.add(desk);

  /* ---------- Dammet ---------- */
  const COUNT=mobile?1300:2800;
  const pos=new Float32Array(COUNT*3), rnd=new Float32Array(COUNT*3);
  for(let i=0;i<COUNT;i++){
    pos[i*3]=Math.random()-0.5; pos[i*3+1]=Math.random()-0.5; pos[i*3+2]=-0.3+Math.pow(Math.random(),1.4)*3.6;
    rnd[i*3]=Math.random(); rnd[i*3+1]=Math.random(); rnd[i*3+2]=0.4+Math.random()*0.9;
  }
  const dustGeo=new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  dustGeo.setAttribute('aRnd', new THREE.BufferAttribute(rnd,3));

  const dustMat=new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    uniforms:{
      uTime:{value:0}, uBox:{value:new THREE.Vector2(1,1)}, uLight:{value:new THREE.Vector3()}, uRadius:{value:1.4},
      uPR:{value:renderer.getPixelRatio()}, uScale:{value:1}
    },
    vertexShader:`
      attribute vec3 aRnd;
      uniform float uTime, uRadius, uPR, uScale;
      uniform vec2 uBox; uniform vec3 uLight;
      varying float vAlpha, vBlur;
      const float FOCUS=1.0;
      void main(){
        float r0=aRnd.x, r1=aRnd.y, spd=aRnd.z;
        // långsam drift: lätt nedåt, sidledes pendling och en mjuk virvel; kornen går runt i en låda som täcker bilden
        vec3 p=vec3(position.xy*uBox, position.z);
        p.x+=sin(uTime*0.07*spd+r0*31.0)*0.35 + uTime*0.012*(r1-0.5);
        p.y+=-uTime*0.018*spd + sin(uTime*0.11+r1*17.0)*0.12;
        p.xy=mod(p.xy+uBox*0.5, uBox)-uBox*0.5;
        p+=0.07*vec3(sin(p.y*1.9+uTime*0.23+r0*6.0), sin(p.x*1.4+uTime*0.19+r1*5.0), sin(p.x*0.8+p.y*1.2+uTime*0.15));
        vec4 mv=modelViewMatrix*vec4(p,1.0);
        float coc=abs(p.z-FOCUS);
        float size=(0.010+0.012*r1)*(1.0+coc*5.5);
        gl_PointSize=max(size*uScale*uPR/-mv.z, 1.0);
        gl_Position=projectionMatrix*mv;
        float beam=exp(-dot(p.xy-uLight.xy,p.xy-uLight.xy)/(uRadius*uRadius*0.9));
        float a=(0.08+0.92*beam)*(0.35+0.65*r0);
        a/=(1.0+coc*coc*6.0);
        vAlpha=a;
        vBlur=clamp(coc*0.8,0.0,1.0);
      }`,
    fragmentShader:`
      precision highp float;
      varying float vAlpha, vBlur;
      void main(){
        float r=length(gl_PointCoord-0.5)*2.0;
        if(r>1.0) discard;
        float core=smoothstep(1.0, mix(0.2,0.85,vBlur), r);
        float ring=mix(0.0, smoothstep(0.6,0.95,r)*smoothstep(1.0,0.95,r)*0.6, vBlur); // bokeh: ljusare kant på oskarpa korn
        float a=(core*(1.0-vBlur*0.55)+ring)*vAlpha;
        gl_FragColor=vec4(vec3(0.88,0.91,0.88)*a, a);
      }`
  });
  const dust=new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled=false;
  scene.add(dust);

  /* ---------- Storlek ---------- */
  function resize(){
    const w=hero.clientWidth, hh=hero.clientHeight; if(!w||!hh) return;
    renderer.setSize(w,hh,false);
    camera.aspect=w/hh; camera.updateProjectionMatrix();
    viewH=2*CAM_Z*Math.tan(THREE.MathUtils.degToRad(FOV/2)); viewW=viewH*camera.aspect;
    // Fotot täcker ytan (som background-size: cover)
    const pw=viewW, ph=viewH; desk.scale.set(pw,ph,1);
    const planeAspect=pw/ph, sc=deskMat.uniforms.uUvScale.value, off=deskMat.uniforms.uUvOffset.value;
    if(planeAspect>photoAspect){ sc.set(1, photoAspect/planeAspect); off.set(0,(1-sc.y)/2); }
    else { sc.set(planeAspect/photoAspect, 1); off.set((1-sc.x)/2, 0); }
    dustMat.uniforms.uBox.value.set(viewW*1.25, viewH*1.25);
    dustMat.uniforms.uScale.value=hh/(2*Math.tan(THREE.MathUtils.degToRad(FOV/2)));
    const radius=Math.max(viewW,viewH)*(mobile?0.26:0.2);
    deskMat.uniforms.uRadius.value=radius; dustMat.uniforms.uRadius.value=radius;
  }
  new ResizeObserver(resize).observe(hero);
  resize();

  // Telefonen vrids: byt till fotot för den nya ledden
  portrait.addEventListener('change',async()=>{
    const url=photoFor(); if(url===photoUrl) return; photoUrl=url;
    let im; try{ im=await loadImage(url); }catch(e){ return; }
    if(url!==photoUrl) return;
    tex.image=im; tex.needsUpdate=true;
    deskMat.uniforms.uTexel.value.set(1/im.naturalWidth, 1/im.naturalHeight);
    photoAspect=im.naturalWidth/im.naturalHeight;
    resize();
  });

  /* ---------- Ficklampan ---------- */
  const target=new THREE.Vector2(0.15,0.1), light=new THREE.Vector2(0.15,0.1);
  let lastMove=-1e9, hasPointer=false;
  hero.addEventListener('pointermove',e=>{
    if(e.pointerType==='mouse'&&!finePointer.matches) return;
    const r=hero.getBoundingClientRect();
    target.set(((e.clientX-r.left)/r.width-0.5)*viewW, (0.5-(e.clientY-r.top)/r.height)*viewH);
    lastMove=performance.now(); hasPointer=true;
  },{passive:true});
  hero.addEventListener('pointerleave',()=>{ lastMove=performance.now()-4000; });

  /* ---------- Loop ---------- */
  let clock=0, last=performance.now(), raf=0, visible=true, faded=false;
  function frame(now){
    raf=0;
    const dt=Math.min(0.05,(now-last)/1000); last=now; clock+=dt;

    // Ficklampan: följer pekaren, annars en långsam vandring över skrivbordet
    if(!hasPointer||now-lastMove>3500){
      // på stående skärm ligger föremålen upptill och nedtill, så vandringen går mer på höjden
      const ax=portrait.matches?0.2:0.34, ay=portrait.matches?0.34:0.26;
      const wx=Math.sin(clock*0.13)*ax+Math.sin(clock*0.051+1.3)*0.1, wy=Math.sin(clock*0.097+0.6)*ay;
      target.set(wx*viewW, wy*viewH);
    }
    light.lerp(target, 1-Math.pow(0.02, dt));

    dustMat.uniforms.uTime.value=clock; dustMat.uniforms.uLight.value.set(light.x,light.y,0);
    deskMat.uniforms.uLight.value.set(light.x,light.y,1.8);
    renderer.render(scene,camera);

    if(!faded){ faded=true; requestAnimationFrame(()=>hero.classList.add('k3-live')); }
    if(visible&&!document.hidden) raf=requestAnimationFrame(frame);
  }
  const start=()=>{ if(!raf){ last=performance.now(); raf=requestAnimationFrame(frame); } };

  // Pausa när hero inte syns eller fliken är dold
  new IntersectionObserver(es=>{ visible=es[0].isIntersecting; if(visible) start(); }).observe(hero);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&visible) start(); });
  canvas.addEventListener('webglcontextlost',e=>{ e.preventDefault(); hero.classList.remove('k3-live'); cancelAnimationFrame(raf); raf=0; visible=false; });

  start();
})();
