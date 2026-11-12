/* ============================== MIN SIDA SOM STARTSIDA ==============================
   Laddas efter admin.js. Min sida är startsidan för alla efter inloggning, även för admin, och visar läget för dagen.
   - Admin ser läget överst: Idag (öppettid, kötid, Stäng nu/Öppna nu), Just nu, Hur går dagen, Kräver åtgärd,
     Personal idag och Nästa öppetdag. Korten ritas av funktionerna i admin.js (admRenderToday, admUpdateLage …).
     Meddelandena ligger längst ned på sidan.
   - Personalen ser Hur går dagen utan kronor, under sitt passkort, när det är öppet eller har sålts något idag.
   - Hantera är till för att planera och ställa in. Där finns ingen översikt, inga steg för att öppna och stänga och
     ingen egen flik för meddelanden; gamla vägar dit leder hit (admOpen nedan). Inget nytt sparas på servern. */

  const MS={ timer:null, devTimer:null, revAt:0 };
  const msById=id=>document.getElementById(id);
  const msVisible=()=>msById('profileContainer')?.style.display==='block'&&!document.hidden;
  /* ---------- Hantera utan översikt, öppna & stäng och meddelanden ---------- */
  const MS_TO_HOME=new Set(['lage','oppnastang']);
  if(MS_TO_HOME.has(ADM.panel)||ADM.panel==='meddelanden'||ADM.panel==='listor'){ ADM.panel='schema'; localStorage.setItem('admPanelV1','schema'); }
  const _msAdmOpen0=admOpen;
  // admOpen('lage') och ('oppnastang') (statusknappen i topraden, gamla länkar) går till Min sida, ('meddelanden') till
  // meddelandena längst ned där. Öppnas en panel från Min sida visas Hantera först.
  admOpen=function(name,opts){
    if(MS_TO_HOME.has(ADM_ALIAS[name]||name)){ selectMenu('profile'); window.scrollTo({top:0}); return; }
    if(name==='meddelanden'){ admGoMessages(); return; }
    if(msById('adminSettings')?.style.display!=='block'){ ADM.panel=name; selectMenu('admin'); window.scrollTo({top:0}); return; }
    return _msAdmOpen0.call(this,name,opts);
  };

  /* ---------- Hur går dagen ---------- */
  // Jämför dagens sålda biljetter med liknande dagar vid samma klockslag (sxForecast och sxAvgHourly i statistik.js)
  // bare: utan rubriken, när statistiken visar samma sak under Idag (statistik.js, sxTodayHtml)
  function msPace({bare=false}={}){
    const today=todayStr(), st=admTodayState(), day=loadSalesHistory()[today]||{};
    const hours=st.oh!=='Stängt'?st.oh:(day.hours&&day.hours!=='Stängt'?day.hours:'');
    const sold=Number(guestCount)||sxGuests(day), income=Number(totalIncome)||Number(day.income||0);
    if(!st.open&&!sold) return null;
    const fc=sxForecast(today,hours), typ=fc?sxAvgHourly(fc.days):null, range=sxRange(hours);
    const now=new Date(), h=now.getHours(), nm=h*60+now.getMinutes();
    const over=st.closedDone||st.evening||(!!range&&nm>=range.end*60)||(!st.open&&sold>0);
    const typTotal=typ?typ.avg.reduce((a,b)=>a+b,0):0;
    const expNow=typ?(over?typTotal:typ.avg.reduce((s,v,i)=>s+(i<h?v:i===h?v*now.getMinutes()/60:0),0)):0;
    const cmp=(a,b)=>{ if(!b) return ''; const p=Math.round((a-b)/b*100); if(Math.abs(p)<=5) return '<span class="rx-cmp">som vanligt</span>'; return `<span class="rx-cmp ${p>0?'is-up':'is-down'}">${p>0?'▲':'▼'} ${Math.abs(p)} % ${p>0?'före':'efter'}</span>`; };
    const cmpEnd=(a,b)=>{ if(!b) return ''; const p=Math.round((a-b)/b*100); if(Math.abs(p)<=5) return '<span class="rx-cmp">som vanligt</span>'; return `<span class="rx-cmp ${p>0?'is-up':'is-down'}">${p>0?'▲':'▼'} ${Math.abs(p)} %</span>`; };
    let lines='';
    if(over){
      lines+=`<p class="ms-pace-lead"><strong>${sxNum(sold)}</strong> sålda biljetter${fc?` · brukar bli ca ${sxNum(fc.guests)} ${cmpEnd(sold,fc.guests)}`:''}</p>`;
      if(isAdmin) lines+=`<p class="ms-pace-line">Intäkt <strong>${sxKr(income)}</strong>${fc&&fc.income?` · brukar bli ca ${sxKr(fc.income)} ${cmpEnd(income,fc.income)}`:''}</p>`;
    }else{
      lines+=`<p class="ms-pace-lead"><strong>${sxNum(sold)}</strong> sålda hittills${typ&&expNow>=3?` ${cmp(sold,expNow)}`:''}</p>`;
      if(typ&&expNow>=3) lines+=`<p class="ms-pace-line">Liknande dagar hade sålt ca <strong>${sxNum(expNow)}</strong> vid den här tiden.</p>`;
      if(typ&&typTotal>0&&sold>0&&expNow>=typTotal*0.15) lines+=`<p class="ms-pace-line">Med det här tempot blir det ca <strong>${sxNum(sold*typTotal/expNow)}</strong> gäster idag.</p>`;
      else if(fc) lines+=`<p class="ms-pace-line">Liknande dagar brukar sluta på ca <strong>${sxNum(fc.guests)}</strong> gäster.</p>`;
      if(isAdmin){ const incNow=fc&&fc.income&&typTotal?fc.income*expNow/typTotal:0;
        lines+=`<p class="ms-pace-line">Intäkt hittills <strong>${sxKr(income)}</strong>${incNow>=100?` ${cmp(income,incNow)}`:''}</p>`; }
    }
    if(!fc) lines+='<p class="rx-sub">För lite historik för att jämföra med liknande dagar ännu.</p>';
    const perH=sxHourly(day.entries), [s,e]=sxSpan(perH,range);
    const chart=s>=0&&e>s?`<figure class="sx-fig"><figcaption>Gäster per timme${typ?'<span class="sx-key"><i aria-hidden="true"></i>brukar</span>':''}</figcaption>${sxChart(perH,typ&&typ.avg,s,e,{label:'Gäster per timme idag',unit:'gäster',now:over?-1:h})}</figure>`:'';
    return `${bare?'':'<p class="rx-card-kicker">Hur går dagen</p>'}<div class="ms-pace">${lines}${fc?`<p class="ms-pace-note">${sxEsc(fc.text)}.</p>`:''}</div>${chart}`;
  }

  /* ---------- Min sida ---------- */
  function msEnsureHost(){
    const box=msById('profileContainer'); if(!box) return null;
    let host=msById('msHome');
    if(!host){ host=document.createElement('section'); host.id='msHome'; host.className='ms-home'; host.setAttribute('aria-label','Läget idag');
      host.addEventListener('click',msClick); }
    // Admin får läget först. Personalen får sitt pass först och Hur går dagen under.
    const mine=msById('rxAvail');
    if(isAdmin){ const ref=mine||box.querySelector('.profile-columns'); if(host.nextSibling!==ref) box.insertBefore(host,ref||null); }
    else if(mine){ if(mine.nextSibling!==host) mine.after(host); }
    else if(!host.parentNode) box.insertBefore(host,box.querySelector('.profile-columns'));
    return host;
  }
  function msRender(){
    const box=msById('profileContainer'); if(!box||!loggedInUser) return;
    const host=msEnsureHost(); if(!host) return;
    box.classList.toggle('ms-admin',!!isAdmin);
    // loadProfile körs också vid bakgrundsuppdateringar. Då uppdateras bara siffrorna, så att en öppen kötidsmeny inte stängs.
    const mode=isAdmin?'admin':'staff';
    if(host.dataset.mode===mode&&host.dataset.user===loggedInUser){ msUpdate(); if(!MS.timer) msStartTimers(); return; }
    host.dataset.mode=mode; host.dataset.user=loggedInUser;
    if(isAdmin){
      // Kassa, Insläpp och Statistik finns redan i menyn; genvägarna är det man annars letar efter i Hantera
      host.innerHTML=`<div class="ms-quick" role="group" aria-label="Genvägar">
          <button type="button" class="btn" data-ms-go="msg">Meddelanden</button><button type="button" class="btn" data-adm-open="schema">Kalender</button></div>
        <div class="adm-grid ms-grid">
          <article class="rx-card rx-card--wide" id="lgToday"></article>
          <article class="rx-card" id="lgNow"></article>
          <article class="rx-card ms-pace-card" id="msPace"></article>
          <article class="rx-card" id="lgAttention"></article>
          <article class="rx-card" id="lgStaff"></article>
          <article class="rx-card" id="lgNext"></article>
        </div>
        <h3 class="ms-me-h">Ditt eget</h3>`;
      ADM.todaySig='';
      admRefreshDevices();
      if(Date.now()-MS.revAt>60000){ MS.revAt=Date.now(); dbFetch(REVIEWS_KEY,[]).then(()=>{ msUpdate(); admUpdateReviewBadge(); }).catch(()=>{}); }
      dbEnsure(AVAIL_KEY,{}).catch(()=>{});
    }else{
      host.innerHTML='<article class="rx-card ms-pace-card" id="msPace"></article>';
    }
    msUpdate(); msStartTimers();
  }
  function msUpdate(){
    if(!msById('msHome')) return;
    if(isAdmin&&msById('lgToday')){
      admUpdateLage();
      const att=msById('lgAttention'); if(att) att.hidden=!!att.querySelector('.rx-empty');
    }
    const pace=msById('msPace'); if(!pace) return;
    let html=null; try{ html=msPace(); }catch(e){ console.error(e); }
    pace.hidden=!html; if(html&&pace.innerHTML!==html) pace.innerHTML=html;
    // Just nu är bara intressant när dagen är öppen eller något har sålts
    const now=msById('lgNow'); if(now) now.hidden=!html;
  }
  function msStartTimers(){
    msStopTimers();
    MS.timer=setInterval(()=>{ if(msVisible()) msUpdate(); },5000);
    if(isAdmin) MS.devTimer=setInterval(()=>{ if(msVisible()) admRefreshDevices(); },30000);
  }
  function msStopTimers(){ clearInterval(MS.timer); clearInterval(MS.devTimer); MS.timer=MS.devTimer=null; }
  function msClick(e){
    const a=e.target.closest('[data-adm-open]'); if(a){ e.preventDefault(); admOpen(a.dataset.admOpen); return; }
    const g=e.target.closest('[data-ms-go]'); if(!g) return;
    if(g.dataset.msGo==='inslapp'){ openRecentTicketsFull(); return; }
    if(g.dataset.msGo==='msg'){ admGoMessages(); return; }
    selectMenu(g.dataset.msGo); window.scrollTo({top:0});
  }

  const _msLoadProfile0=loadProfile;
  loadProfile=function(){ const r=_msLoadProfile0.apply(this,arguments); try{ msRender(); }catch(e){ console.error(e); } return r; };
  const _msSelectMenu0=selectMenu;
  selectMenu=function(menu){ _msSelectMenu0.apply(this,arguments); if(menu!=='profile') msStopTimers(); };
  if(loggedInUser&&msVisible()) msRender();
