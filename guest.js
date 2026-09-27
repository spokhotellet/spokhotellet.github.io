/* ============================== GÄSTSIDAN: INTERAKTIVA ELEMENT ==============================
   Registerkortet, kontrollavin, gästboken som bok och sällsynta avvikelser.
   Laddas efter app.js och startar sig själv. Använder ui.js för dialoger och ljud.
   Inget här skriver till den delade datan; val sparas bara i gästens egen webbläsare. */

  const ghReduceMotion=()=>window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ghGuestVisible=()=>{ const w=document.getElementById('welcomeMessage'); return !!w&&w.style.display!=='none'&&getComputedStyle(w).display!=='none'; };
  const ghOnce=(key,p)=>{ // slumpar en gång per besök och minns svaret
    let v=sessionStorage.getItem(key);
    if(v===null){ v=Math.random()<p?'1':'0'; try{ sessionStorage.setItem(key,v); }catch(_e){} }
    return v==='1';
  };
  const ghSound=(name,...args)=>{ try{ KorpenSound[name](...args); }catch(_e){} };

  /* ---------- Registerkortet: Hur läskigt är det? ---------- */
  const GH_QUIZ_RESULTS=[
    { stamp:'Välkommen in', text:'Ni verka väl rustade. Håll ihop i korridorerna och njut av besöket.' },
    { stamp:'Med försiktighet', text:'Det är mörkt därinne, och det kan komma plötsliga ljud och överraskningar. Gå tätt tillsammans och håll gärna i varandra.' },
    { stamp:'Tala med receptionen', text:'Korpen är mörk och kan skrämma på riktigt. Tala gärna med personalen i receptionen innan ni löser biljett, så berättar de vad som väntar.' },
  ];
  function initQuiz(){
    const form=document.getElementById('ghQuiz'); if(!form) return;
    const no=document.getElementById('ghQuizNo'); if(no) no.textContent=String(1000+Math.floor(Math.random()*8999));
    const out=document.getElementById('ghQuizResult');
    form.addEventListener('submit',e=>{
      e.preventDefault();
      const val=n=>{ const r=form.querySelector(`input[name="${n}"]:checked`); return r?Number(r.value):null; };
      const who=val('who'), fear=val('fear'), dark=val('dark');
      if(who===null||fear===null||dark===null){
        const first=[...form.querySelectorAll('.gh-regcard-q')].find(fs=>!fs.querySelector('input:checked'));
        first?.classList.add('is-missing'); setTimeout(()=>first?.classList.remove('is-missing'),1600);
        first?.querySelector('input')?.focus();
        return;
      }
      const score=who+fear+dark;
      const r=GH_QUIZ_RESULTS[score<=1?0:score<=3?1:2];
      out.innerHTML=`<span class="gh-regcard-stamp">${r.stamp}</span><p>${r.text}</p>${who===2?'<p>För yngre barn rekommenderar vi att en vuxen går med hela vägen.</p>':''}`;
      out.hidden=false; form.classList.add('is-stamped'); // knappen "Lämna in kortet" göms via CSS tills kortet fylls i på nytt
      form.querySelector('.gh-regcard-reset')?.focus({preventScroll:true});
      ghSound('stamp');
      out.scrollIntoView({behavior:ghReduceMotion()?'auto':'smooth',block:'nearest'});
    });
    form.addEventListener('reset',()=>{ out.hidden=true; out.innerHTML=''; form.classList.remove('is-stamped'); });
  }

  /* ---------- Kontrollavin på tariffkortet ----------
     Perforeringen sitter på kortet och rör sig aldrig. Ett klick eller ett drag river loss avin;
     den vänds i luften och läggs åt sidan med baksidan upp. Ingen ledtråd visas i förväg. */
  function initStub(){
    const stub=document.getElementById('ghStub'); const no=document.getElementById('ghStubNo'); if(!stub||!no) return;
    no.textContent=String(1+Math.floor(Math.random()*400)).padStart(4,'0');
    const ticket=stub.closest('.gh-ticket');
    let start=null, moved=0, torn=false, pos={x:0,y:0,r:0};
    const place=(x,y,r,extra='',ms=0,ease='ease')=>{ stub.style.transition=ms?`transform ${ms}ms ${ease}`:'none'; stub.style.transform=`translate(${x}px, ${y}px) rotate(${r}deg) ${extra}`; };
    const tear=()=>{
      if(torn) return; torn=true; start=null;
      ghSound('tear');
      stub.classList.add('is-torn'); stub.setAttribute('aria-label','Kontrollavi, avriven'); ticket?.classList.add('is-torn');
      const w=stub.offsetWidth, h=stub.offsetHeight, narrow=window.innerWidth<700;
      const rest={ x:narrow?-w*0.03:-w*0.14, y:h*0.95, r:narrow?3:-6 };
      if(ghReduceMotion()){ place(rest.x,rest.y,rest.r,'rotateY(180deg)'); return; }
      // Ryck, upp i luften medan den vänds, och ned på bordet
      place(pos.x+4,pos.y+3,pos.r+2,'',90,'ease-out');
      setTimeout(()=>place((pos.x+rest.x)/2+w*0.08,rest.y*0.3-10,(rest.r+pos.r)/2+8,'rotateY(95deg) translateZ(50px)',330,'cubic-bezier(0.2,0.6,0.4,1)'),90);
      setTimeout(()=>place(rest.x,rest.y,rest.r,'rotateY(180deg)',460,'cubic-bezier(0.5,0,0.7,1)'),420);
      setTimeout(()=>{ ghSound('pageTurn',0.25); },860);
    };
    stub.addEventListener('pointerdown',e=>{ if(torn) return; start={x:e.clientX,y:e.clientY}; moved=0; stub.setPointerCapture(e.pointerId); });
    stub.addEventListener('pointermove',e=>{
      if(!start||torn) return;
      const dx=e.clientX-start.x, dy=Math.max(0,e.clientY-start.y); moved=Math.max(moved,Math.hypot(dx,dy));
      pos={x:dx*0.3,y:dy*0.3,r:Math.max(-12,Math.min(12,dx/9+(dx>=0?1:-1)*dy/12))};
      stub.style.transformOrigin=dx>=0?'0 0':'100% 0';
      place(pos.x,pos.y,pos.r);
      if(Math.hypot(dx,dy)>80) tear();
    });
    const release=()=>{ if(!start||torn) return; start=null; if(moved<6){ tear(); return; } pos={x:0,y:0,r:0}; place(0,0,0,'',350,'cubic-bezier(0.3,1.6,0.5,1)'); };
    stub.addEventListener('pointerup',release);
    stub.addEventListener('pointercancel',()=>{ if(torn) return; start=null; pos={x:0,y:0,r:0}; place(0,0,0,'',350); });
    stub.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); tear(); } });
  }

  /* ---------- Gästboken som en riktig bok ----------
     Alla omdömen, fem per sida. På bredare skärmar ligger boken uppslagen med två sidor,
     på mobilen visas en sida i taget. Man bläddrar genom att ta tag i sidans nederkant och dra,
     klicka på hörnet eller använda knapparna under boken. */
  const GB={ reviews:[], page:0, busy:false, pending:false, perPage:5 };
  const gbDouble=()=>window.matchMedia('(min-width: 760px)').matches;
  const gbStep=()=>gbDouble()?2:1;
  const gbEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const gbFmt=d=>{ const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(d||''); return m?`${Number(m[3])}/${Number(m[2])} ${m[1]}`:''; };
  function gbStars(n,cls=''){ return `<span class="gh-stars ${cls}" role="img" aria-label="${n} av 5 stjärnor">${[1,2,3,4,5].map(i=>`<span class="${i<=n?'is-on':''}">★</span>`).join('')}</span>`; }

  function gbBuildPages(){
    // Omdömen som väntar på granskning eller dolts i Hantera syns inte i boken, men betyget räknas i snittet
    const rows=[...GB.reviews].reverse().filter(r=>r.status!=='pending'&&r.status!=='hidden').map(r=>{
      const c=(r.comment||'').trim(); const n=Math.max(0,Math.min(5,Math.round(Number(r.rating)||0)));
      const reply=(r.reply&&r.reply.text||'').trim();
      return `<li class="gb-row"><div class="gb-row-top"><span class="gb-date">${gbEsc(gbFmt(r.date))}</span>${gbStars(n)}</div>${c?`<p class="gb-text" title="${gbEsc(c)}">${gbEsc(c)}</p>`:'<p class="gb-text is-empty">Lämnade betyg utan anteckning.</p>'}${reply?`<p class="gb-reply"><span>Receptionen:</span> ${gbEsc(reply)}</p>`:''}</li>`;
    });
    // Sällan: en rad som inte borde stå där (bestäms en gång per besök)
    if(rows.length&&ghOnce('korpenLedgerGhost',0.2)) rows.splice(Math.min(2,rows.length),0,'<li class="gb-row is-ghost"><div class="gb-row-top"><span class="gb-date">23/11 1936</span></div><p class="gb-text">Tack för gästfriheten. Vi stanna ännu en tid. — Rum 13</p></li>');
    const pages=[];
    for(let i=0;i<rows.length;i+=GB.perPage) pages.push(rows.slice(i,i+GB.perPage).join(''));
    if(!pages.length) pages.push('<li class="gb-empty">Ännu inga anteckningar i gästboken.<br>Bli den första att skriva.</li>');
    return pages;
  }
  function gbPageHtml(pages,i){
    if(i<0||i>=pages.length) return '<div class="gb-page-inner is-blank"></div>';
    return `<div class="gb-page-inner"><ol class="gb-rows">${pages[i]}</ol><span class="gb-num">— ${i+1} —</span></div>`;
  }

  function renderGuestbook(reviews){
    GB.reviews=Array.isArray(reviews)?reviews:[];
    if(GB.busy){ GB.pending=true; return; }
    const el=document.getElementById('welcomeReviews'); if(!el) return;
    const pages=gbBuildPages(); GB.pages=pages;
    const step=gbStep();
    GB.page=Math.max(0,Math.min(GB.page-(GB.page%step),(Math.ceil(pages.length/step)-1)*step));
    // Snittbetyg ovanför boken och betygsraden i hero
    const hero=document.getElementById('ghHeroRating');
    let score='';
    if(GB.reviews.length){
      const avg=GB.reviews.reduce((s,r)=>s+Number(r.rating||0),0)/GB.reviews.length;
      const avgTxt=avg.toFixed(1).replace('.',','); const countTxt=`${GB.reviews.length} omdöme${GB.reviews.length!==1?'n':''}`;
      score=`<div class="gh-ledger-score"><span class="gh-ledger-avg">${avgTxt}</span><div>${gbStars(Math.round(avg),'gh-stars--big')}<p>av 5 i snitt · ${countTxt}</p></div></div>`;
      if(hero){ hero.innerHTML=`${gbStars(Math.round(avg))}<span><b>${avgTxt}</b> av 5 i gästboken · ${countTxt}</span>`; hero.hidden=false; }
    }else if(hero) hero.hidden=true;
    const dbl=step===2;
    el.innerHTML=`${score}
      <div class="gb-book ${dbl?'is-double':'is-single'}">
        ${dbl?`<div class="gb-page gb-left">${gbPageHtml(pages,GB.page)}</div>`:''}
        <div class="gb-page gb-right">${gbPageHtml(pages,GB.page+(dbl?1:0))}</div>
        ${dbl?'<span class="gb-spine" aria-hidden="true"></span>':''}
        <button type="button" class="gb-grab gb-grab-prev" data-dir="-1" aria-label="Föregående sida"></button>
        <button type="button" class="gb-grab gb-grab-next" data-dir="1" aria-label="Nästa sida"></button>
      </div>
      <nav class="gh-ledger-pager" aria-label="Bläddra i gästboken"><button type="button" data-gb="-1">‹ Föregående</button><span aria-live="polite"></span><button type="button" data-gb="1">Nästa ›</button></nav>`;
    el.style.display='block';
    gbSyncControls();
    // Långa anteckningar kortas till två rader; de går att klicka upp i sin helhet
    el.querySelectorAll('.gb-page .gb-text').forEach(t=>{ if(t.scrollHeight>t.clientHeight+2){ t.classList.add('is-long'); t.tabIndex=0; t.setAttribute('role','button'); } });
    if(!el._gbBound){ el._gbBound=true; gbBind(el); }
  }
  function gbOpenFull(t){
    const row=t.closest('.gb-row'); const body=document.createElement('div'); body.className='gb-full';
    body.innerHTML=`<div class="gb-row-top">${row.querySelector('.gb-row-top').innerHTML}</div>`;
    const p=document.createElement('p'); p.className='gb-full-text'; p.textContent=t.getAttribute('title')||t.textContent; body.appendChild(p);
    openDialog({title:'Ur gästboken',body,className:'ui-dialog--paper',dismissValue:true,actions:[{label:'Stäng',value:true,primary:true}]});
  }
  function gbSyncControls(){
    const el=document.getElementById('welcomeReviews'); if(!el||!GB.pages) return;
    const step=gbStep(), n=GB.pages.length;
    const canPrev=GB.page>0, canNext=GB.page+step<n;
    el.querySelector('.gb-grab-prev')?.toggleAttribute('hidden',!canPrev);
    el.querySelector('.gb-grab-next')?.toggleAttribute('hidden',!canNext);
    const [p,nx]=el.querySelectorAll('[data-gb]'); if(p) p.disabled=!canPrev; if(nx) nx.disabled=!canNext;
    const pager=el.querySelector('.gh-ledger-pager'); if(pager) pager.hidden=n<=step;
    const lbl=el.querySelector('.gh-ledger-pager span');
    if(lbl){ const a=GB.page+1, b=Math.min(n,GB.page+step); lbl.textContent=a===b?`Sida ${a} av ${n}`:`Sida ${a}–${b} av ${n}`; }
  }

  // Ett blad som vänds. t går från 0 (utgångsläge) till 1 (bladet har lagt sig på andra sidan).
  function gbStartTurn(dir){
    const el=document.getElementById('welcomeReviews'); const book=el?.querySelector('.gb-book'); if(!book||GB.busy) return null;
    const step=gbStep(), pages=GB.pages, p=GB.page, dbl=step===2;
    if(dir>0&&p+step>=pages.length) return null;
    if(dir<0&&p<=0) return null;
    GB.busy=true;
    const leaf=document.createElement('div'); leaf.className='gb-leaf'; leaf.setAttribute('aria-hidden','true');
    let front,back,from,to;
    const right=book.querySelector('.gb-right'), left=book.querySelector('.gb-left');
    if(dbl&&dir>0){ leaf.classList.add('gb-leaf--right'); front=pages&&gbPageHtml(pages,p+1); back=gbPageHtml(pages,p+2); right.innerHTML=gbPageHtml(pages,p+3); from=0; to=-180; }
    else if(dbl&&dir<0){ leaf.classList.add('gb-leaf--left'); front=gbPageHtml(pages,p); back=gbPageHtml(pages,p-1); left.innerHTML=gbPageHtml(pages,p-2); from=0; to=180; }
    else if(dir>0){ leaf.classList.add('gb-leaf--full'); front=gbPageHtml(pages,p); back='<div class="gb-page-inner is-blank"></div>'; right.innerHTML=gbPageHtml(pages,p+1); from=0; to=-180; }
    else { leaf.classList.add('gb-leaf--full'); front=gbPageHtml(pages,p-1); back='<div class="gb-page-inner is-blank"></div>'; from=-180; to=0; }
    leaf.innerHTML=`<div class="gb-face gb-front">${front}</div><div class="gb-face gb-back">${back}</div>`;
    book.appendChild(leaf); book.classList.add('is-turning');
    const turn={dir,leaf,book,from,to,t:0,
      apply(t){ this.t=t; const a=from+(to-from)*t; const lift=Math.sin(Math.PI*t);
        leaf.style.transform=`rotateY(${a}deg) rotateZ(${(dir>0?-1:1)*lift*2.5}deg)`;
        leaf.style.setProperty('--shade',(lift*0.5).toFixed(3)); leaf.style.setProperty('--lift',lift.toFixed(3)); },
      animate(target,ms,done){ const t0=this.t, s=performance.now(); const ease=x=>x<0.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
        if(ghReduceMotion()) ms=1;
        const tick=now=>{ const k=Math.min(1,(now-s)/ms); this.apply(t0+(target-t0)*ease(k)); if(k<1) requestAnimationFrame(tick); else done(); };
        requestAnimationFrame(tick); },
      finish(committed){ if(committed) GB.page+=dir*step; leaf.remove(); book.classList.remove('is-turning'); GB.busy=false; renderGuestbook(GB.reviews); GB.pending=false; }
    };
    turn.apply(0);
    return turn;
  }
  function gbTurn(dir){
    const turn=gbStartTurn(dir); if(!turn) return;
    ghSound('pageTurn',0.75);
    turn.animate(1,900,()=>turn.finish(true));
  }
  function gbBind(el){
    el.addEventListener('click',e=>{ const b=e.target.closest('[data-gb]'); if(b&&!b.disabled) gbTurn(Number(b.dataset.gb)); const t=e.target.closest('.gb-text.is-long'); if(t&&!GB.busy) gbOpenFull(t); });
    // Ta tag i nederkanten och dra för att vända bladet
    let drag=null;
    el.addEventListener('pointerdown',e=>{
      const g=e.target.closest('.gb-grab'); if(!g||GB.busy) return;
      e.preventDefault();
      const dir=Number(g.dataset.dir); const turn=gbStartTurn(dir); if(!turn) return;
      drag={turn,dir,x0:e.clientX,moved:0,w:turn.book.getBoundingClientRect().width};
      g.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove',e=>{
      if(!drag) return;
      const dx=(e.clientX-drag.x0)*(drag.dir>0?-1:1); drag.moved=Math.max(drag.moved,Math.abs(e.clientX-drag.x0));
      drag.turn.apply(Math.max(0,Math.min(1,dx/(drag.w*(gbDouble()?0.9:0.8)))));
    });
    const end=()=>{
      if(!drag) return; const {turn,moved}=drag; drag=null;
      if(moved<6||turn.t>0.3){ ghSound('pageTurn',0.6); turn.animate(1,Math.max(250,700*(1-turn.t)),()=>turn.finish(true)); }
      else turn.animate(0,300,()=>turn.finish(false));
    };
    el.addEventListener('pointerup',end); el.addEventListener('pointercancel',end);
    el.addEventListener('keydown',e=>{ if(e.key!=='Enter'&&e.key!==' ') return; const g=e.target.closest('.gb-grab'); if(g){ e.preventDefault(); gbTurn(Number(g.dataset.dir)); } const t=e.target.closest('.gb-text.is-long'); if(t){ e.preventDefault(); gbOpenFull(t); } });
    window.matchMedia('(min-width: 760px)').addEventListener?.('change',()=>{ if(!GB.busy) renderGuestbook(GB.reviews); });
  }

  /* ---------- Sällsynta avvikelser ---------- */
  function initAnomalies(){
    // Fliktiteln när gästen lämnar fliken, ungefär vart tredje besök
    if(ghOnce('korpenTitleAnomaly',0.35)){
      const orig=document.title;
      document.addEventListener('visibilitychange',()=>{ if(!ghGuestVisible()) return; document.title=document.hidden?'Vi väntar på er …':orig; });
    }
    if(ghReduceMotion()||!('IntersectionObserver' in window)) return;
    // Personalfotot blinkar till som ett negativ när man kommer tillbaka till det
    const photo=document.querySelector('.gh-photo-img');
    if(photo&&ghOnce('korpenPhotoAnomaly',0.5)){
      let seen=0; const io=new IntersectionObserver(es=>es.forEach(e=>{ if(!e.isIntersecting) return; seen++; if(seen===2){ io.disconnect(); setTimeout(()=>{ photo.classList.add('is-flicker'); setTimeout(()=>photo.classList.remove('is-flicker'),520); },600); } }),{threshold:0.6});
      io.observe(photo);
    }
    // Sista raden i tidningsurklippet ändras en kort stund
    const last=document.getElementById('ghClipLast');
    if(last){
      const orig=last.textContent; let timer=null, done=false;
      const swap=()=>{ if(done) return; done=true; last.classList.add('is-changed'); last.textContent='Hotellet mottager gäster. Ingen har ännu lämnat.'; setTimeout(()=>{ last.textContent=orig; last.classList.remove('is-changed'); },2600); };
      const clip=last.closest('.gh-clipping');
      clip?.addEventListener('pointerenter',()=>{ clearTimeout(timer); timer=setTimeout(swap,3200); });
      clip?.addEventListener('pointerleave',()=>clearTimeout(timer));
      if(clip&&window.matchMedia('(hover: none)').matches&&ghOnce('korpenClipAnomaly',0.5)){
        const io=new IntersectionObserver(es=>es.forEach(e=>{ clearTimeout(timer); if(e.isIntersecting) timer=setTimeout(()=>{ swap(); io.disconnect(); },7000); }),{threshold:0.7});
        io.observe(last);
      }
    }
  }

  function initGuestExtras(){
    if(initGuestExtras._done) return; initGuestExtras._done=true;
    try{
      initQuiz(); initStub(); initAnomalies();
      if(typeof renderWelcomeReviews==='function') renderWelcomeReviews(); // gästboken ritades inte innan guest.js laddats
    }catch(e){ console.warn('Gästsidans extrafunktioner kunde inte starta',e); }
  }

  if(document.getElementById('welcomeMessage')) initGuestExtras();
