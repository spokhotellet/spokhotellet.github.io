/* ============================== HANTERA OCH PERSONALENS VERKTYG ==============================
   Laddas efter app.js och använder dess datalager (dbGet/dbSet/_mutateShared) och globala tillstånd.
   Här finns: personalmenyn, Hanteras meny och paneler (Läget, Öppna & stäng, Öppetdagar, Schema,
   Recensioner, Checklistor, Ändringslogg), förhandsvisningen av gästsidan, notisen till personalen,
   enheternas livstecken, övningsläget, jämförelser och export i statistiken samt "Kan du jobba?" på Min sida.
   Allt sparas i vanliga nycklar i Apps Script; inget kräver ändringar på servern. */

  const ADM={ panel:localStorage.getItem('admPanelV1')||'lage', menu:'', timer:null, devTimer:null, devices:[], devAt:0, revAt:0, revFilter:'alla', undoing:false, pendingLog:null, logTimer:null, todaySig:'' };
  const AVAIL_KEY='availabilityV1', CHECK_KEY='checklistsV1', LOG_KEY='adminLogV1', REVIEW_SETTINGS_KEY='reviewSettingsV1', DEVICE_DIR_KEY='deviceDirV1';
  const admById=id=>document.getElementById(id);
  const admEsc=s=>escapeHtml(String(s??''));
  const ADM_WD=['sön','mån','tis','ons','tor','fre','lör'];
  const ADM_WDL=['söndag','måndag','tisdag','onsdag','torsdag','fredag','lördag'];
  const ADM_MON=['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];
  const admDate=d=>new Date(d+'T12:00:00');
  function admDayShort(d){ const x=admDate(d); return `${ADM_WD[x.getDay()]} ${x.getDate()}/${x.getMonth()+1}`; }
  function admDayLong(d){ const x=admDate(d); return `${ADM_WDL[x.getDay()]} ${x.getDate()} ${ADM_MON[x.getMonth()]}`; }
  function admTime(ts){ const x=new Date(ts); return isNaN(x)?'':x.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'}); }
  function admAgo(ts){ const s=Math.max(0,Math.round((Date.now()-ts)/1000)); if(s<60) return `för ${s} s sedan`; const m=Math.round(s/60); if(m<60) return `för ${m} min sedan`; const h=Math.round(m/60); return `för ${h} tim sedan`; }
  const admKr=n=>`${Number(n||0).toLocaleString('sv-SE')} kr`;
  const HOUR_PRESETS=['18:00–21:00','10:00–17:00','10:00–22:00'];

  // Delad post som flera enheter kan ändra samtidigt (se _mutateShared i app.js). apply() måste tåla att köras flera gånger.
  function admMutate(key,fallback,apply){
    const norm=p=>Array.isArray(fallback)?(Array.isArray(p)?p:_clone(fallback)):((p&&typeof p==='object'&&!Array.isArray(p))?p:_clone(fallback));
    return _mutateShared(key,{load:()=>norm(dbGet(key,fallback)),normalize:norm,save:o=>dbSet(key,o).catch(()=>{})},apply);
  }

  /* ---------- Gemensamma uppgifter ---------- */
  function admStaff(){ return Object.entries(users||{}).map(([id,u])=>({id,...u})).filter(u=>u.name).sort((a,b)=>a.name.localeCompare(b.name,'sv')); }
  const admIsCashier=t=>/kass/i.test(t||'');
  function admUpcoming(n=10){
    const today=todayStr();
    const list=loadOpenDates().map(e=>typeof e==='string'?{date:e,hours:''}:{date:e.date,hours:e.hours||''}).filter(e=>e.date>=today);
    const oh=loadOpeningHours();
    if(oh!=='Stängt'&&!list.some(e=>e.date===today)) list.push({date:today,hours:oh});
    return list.sort((a,b)=>a.date.localeCompare(b.date)).slice(0,n);
  }
  function admCoverage(date){
    const plan=loadShiftPlan()[date]||{};
    const byName=Object.fromEntries(admStaff().map(u=>[u.name,u]));
    const on=Object.entries(plan).filter(([n,v])=>v&&(v.hours||v.task)&&byName[n]);
    const warn=[];
    if(!on.length) warn.push('Ingen i schemat');
    else{
      if(!on.some(([,v])=>admIsCashier(v.task))) warn.push('Ingen kassör');
      if(!on.some(([n])=>byName[n].hasInslepp||byName[n].admin)) warn.push('Ingen med insläpp');
    }
    return {on,warn};
  }
  function admDayGuests(d){ const a=Array.isArray(d.admissionsEntries)?d.admissionsEntries.reduce((s,e)=>s+Number(e.n||0),0):0; return a||(Number(d.adult||0)+Number(d.child||0)); }
  // Prognos: snittet av upp till sex tidigare dagar, i första hand med samma veckodag och öppettid
  function admForecast(date,hours){
    const hist=loadSalesHistory(); const today=todayStr(); const wd=admDate(date).getDay();
    const past=Object.entries(hist).filter(([k,d])=>k<today&&d&&!d._deleted&&admDayGuests(d)>0);
    const tries=[[([k,d])=>hours&&d.hours===hours&&admDate(k).getDay()===wd,`${ADM_WDL[wd]}ar med samma öppettid`],[([,d])=>hours&&d.hours===hours,'dagar med samma öppettid'],[([k])=>admDate(k).getDay()===wd,`${ADM_WDL[wd]}ar`],[()=>true,'alla tidigare dagar']];
    for(const [f,how] of tries){ const base=past.filter(f); if(base.length>=2||(how==='alla tidigare dagar'&&base.length)){ const b=base.sort((a,c)=>c[0].localeCompare(a[0])).slice(0,6); return {guests:Math.round(b.reduce((s,[,d])=>s+admDayGuests(d),0)/b.length),income:Math.round(b.reduce((s,[,d])=>s+Number(d.income||0),0)/b.length),n:b.length,how}; } }
    return null;
  }
  function admQueued(){ const items=(loadOpenTickets().items||[]).filter(t=>!t.used&&(Number(t.adult||0)+Number(t.child||0))>0); return {tickets:items.length,people:items.reduce((s,t)=>s+Number(t.adult||0)+Number(t.child||0),0),items}; }
  function admHoursOptions(current,extra=[]){
    const opts=[...new Set([current,...extra,...HOUR_PRESETS,...loadOpenDates().map(e=>e&&e.hours).filter(Boolean)].filter(v=>v&&v!=='Stängt'))];
    return opts.map(v=>`<option value="${admEsc(v)}"${v===current?' selected':''}>${admEsc(v)}</option>`).join('');
  }
  async function admAskHours(current){
    const raw=await uiPrompt('Öppettid, t.ex. 16:30–20:00',current||'',{title:'Annan öppettid'});
    if(raw==null) return null;
    const norm=normalizeRangeStr(raw);
    if(!norm){ notify('Skriv tiden som 16:30–20:00.','error'); return null; }
    return norm;
  }
  function admTextDialog(title,label,value,{okLabel='Spara',placeholder=''}={}){
    const wrap=document.createElement('label'); wrap.className='ui-dialog-field';
    const span=document.createElement('span'); span.className='ui-dialog-label'; span.textContent=label;
    const ta=document.createElement('textarea'); ta.className='ui-dialog-input ui-dialog-textarea'; ta.rows=4; ta.value=value||''; ta.placeholder=placeholder;
    wrap.append(span,ta);
    return openDialog({title,body:wrap,dismissValue:null,actions:[{label:'Avbryt',value:null},{label:okLabel,value:()=>ta.value,primary:true}]});
  }

  /* ============================== PERSONALMENYN ============================== */
  function rxView(){
    if(document.querySelector('.field-view')) return 'Insläpp';
    if(admById('customerDisplayView')?.style.display&&admById('customerDisplayView').style.display!=='none') return 'Kundskärm';
    if(document.querySelector('.display-view')) return 'Kötidsskärm';
    const vis=id=>{ const e=admById(id); return e&&e.style.display&&e.style.display!=='none'; };
    if(vis('kassaContainer')) return 'Kassa';
    if(vis('adminSettings')) return 'Hantera';
    if(vis('statsContainer')) return 'Statistik';
    if(vis('profileContainer')) return 'Min sida';
    return 'Gästsidan';
  }
  function rxNavUpdate(){
    const nav=admById('staffNav'); if(!nav) return;
    const welcomeShown=admById('welcomeMessage')?.style.display!=='none';
    const on=!!loggedInUser&&!welcomeShown&&!PREVIEW;
    nav.hidden=!on; document.body.classList.toggle('staff-on',on);
    const show=(id,v)=>{ const b=admById(id); if(b) b.hidden=!v; };
    show('snKassa',isAdmin||currentHasAccess); show('snInslapp',isAdmin||currentHasInslepp); show('snAdmin',isAdmin);
    const view=rxView();
    document.body.dataset.staffView=view;
    nav.querySelectorAll('button[data-go]').forEach(b=>{ const map={profile:'Min sida',kassa:'Kassa',inslapp:'Insläpp',stats:'Statistik',admin:'Hantera'}; if(map[b.dataset.go]===view) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  }
  admById('staffNav')?.addEventListener('click',e=>{
    const b=e.target.closest('button[data-go]'); if(!b) return;
    const fv=document.querySelector('.field-view');
    if(b.dataset.go==='inslapp'){ if(!fv) openRecentTicketsFull(); return; }
    fv?._close?.();
    selectMenu(b.dataset.go);
    window.scrollTo({top:0});
  });
  const _admOpenInslapp0=openRecentTicketsFull;
  openRecentTicketsFull=function(){ document.querySelector('.field-view')?._close?.(); hideDropdown(); _admOpenInslapp0.apply(this,arguments); rxNavUpdate(); };
  // Statusknapparna i topraden: admin går till Översikt, övrig personal får kötidsmenyn som förut
  function maybeEditHours(ev){ if(ev){ ev.stopPropagation(); ev.preventDefault(); } if(!isAdmin) return; document.querySelector('.field-view')?._close?.(); selectMenu('admin'); admOpen('lage'); }
  const _admEditQueue0=maybeEditQueueTime;
  maybeEditQueueTime=function(ev){ if(isAdmin){ maybeEditHours(ev); return; } _admEditQueue0(ev); };
  function rxStatusUpdate(){
    const dot=admById('tbOpenDot'); if(!dot) return;
    const st=admTodayState(); dot.className='status-dot '+(st.open?'live':'dead');
    admById('openBlock')?.classList.toggle('is-open',st.open);
  }
  // Märken för olästa meddelanden: på Min sida för personalen, på Hantera och Meddelanden för admin
  const _admUpdateMsgBadge0=updateMsgBadge;
  updateMsgBadge=function(){
    _admUpdateMsgBadge0.apply(this,arguments);
    const has=admById('msgBadgeDot')?.style.display==='inline-block';
    const set=(id,v)=>{ const e=admById(id); if(e) e.hidden=!v; };
    set('snProfileBadge',has&&!isAdmin); set('snAdminBadge',has&&isAdmin); set('admMsgBadge',has&&isAdmin);
  };

  const _admSelectMenu0=selectMenu;
  selectMenu=function(menu){
    _admSelectMenu0(menu);
    ADM.menu=menu;
    admPlaceMessages();
    rxNavUpdate();
    if(menu==='admin'&&isAdmin) admOpen(ADM.panel,{keepScroll:true}); else admStopTimers();
    rxBeatSoon();
  };
  const _admUpdateTopbar0=updateTopbar;
  updateTopbar=function(){ _admUpdateTopbar0.apply(this,arguments); rxNavUpdate(); rxStatusUpdate(); };

  /* ============================== HANTERAS MENY OCH PANELER ============================== */
  const ADM_RENDER={
    lage:()=>admRenderLage(),
    oppnastang:()=>admRenderOpenClose(),
    meddelanden:()=>admRenderMessages(),
    dagar:()=>admRenderDays(),
    schema:()=>admRenderSchema(),
    produkter:()=>renderProductsManager(),
    recensioner:()=>renderReviewsAdmin(),
    loner:()=>initLonPanel(),
    personal:()=>{ if(admById('persPanel_laggTill')?.style.display==='block') closeAddUserPanel(); initUserSelect(); admRenderStaffTable(); },
    katalog:()=>{ renderCatalogManager(); selectCatalogTab('kompetenser'); },
    skarmar:()=>{ selectDisplayTab('enheter'); loadDisplayAdminStatus(); admRenderImagePicker(); admRefreshDevices(); },
    checklistor:()=>admRenderChecklistEditor(),
    logg:()=>admRenderLog(),
    sidan:()=>window.siteText?.openPanel()
  };
  function admOpen(name,{keepScroll=false}={}){
    if(!ADM_RENDER[name]) name='lage';
    ADM.panel=name; localStorage.setItem('admPanelV1',name);
    document.querySelectorAll('#adminSettings .adm-panel').forEach(p=>{ p.hidden=p.dataset.panel!==name; });
    document.querySelectorAll('#admNav button[data-adm]').forEach(b=>{ if(b.dataset.adm===name) b.setAttribute('aria-current','true'); else b.removeAttribute('aria-current'); });
    const line=admById('admDateLine'); if(line) line.textContent=`Receptionen · ${admDayLong(todayStr())}`;
    try{ ADM_RENDER[name](); }catch(e){ console.error(e); }
    admStopTimers();
    if(name==='lage'){ ADM.timer=setInterval(()=>{ if(admVisible()) admUpdateLage(); },4000); ADM.devTimer=setInterval(()=>{ if(admVisible()) admRefreshDevices(); },30000); }
    if(name==='meddelanden') ADM.timer=setInterval(()=>{ if(admVisible()){ renderStaffMsgSection(); markMsgSeen(); } },15000);
    if(name==='skarmar') ADM.devTimer=setInterval(()=>{ if(admVisible()) admRefreshDevices(); },30000);
    admUpdateReviewBadge();
    if(!keepScroll&&window.matchMedia('(max-width: 979px)').matches){ const p=document.querySelector(`#adminSettings .adm-panel[data-panel="${name}"]`); p?.scrollIntoView({block:'start',behavior:'smooth'}); }
  }
  const admVisible=()=>admById('adminSettings')?.style.display==='block'&&!document.hidden;
  function admStopTimers(){ clearInterval(ADM.timer); clearInterval(ADM.devTimer); ADM.timer=ADM.devTimer=null; }
  // Äldre anrop (knappar som tidigare fällde ut en sektion) öppnar motsvarande panel
  function adminAccordion(id){ const map={personalContent:'personal',catalogContent:'katalog',productsContent:'produkter',displayAdminContent:'skarmar',welcomeEditContent:'sidan',reviewsContent:'recensioner',lonContent:'loner'}; admOpen(map[id]||'lage'); }
  admById('admNav')?.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.dataset.admGo){ selectMenu(b.dataset.admGo); return; }
    if(b.dataset.adm) admOpen(b.dataset.adm);
  });
  // Länkar inne i panelerna: <button data-adm-open="schema">
  admById('adminSettings')?.addEventListener('click',e=>{ const b=e.target.closest('[data-adm-open]'); if(b){ e.preventDefault(); admOpen(b.dataset.admOpen); } });

  /* ============================== LÄGET ============================== */
  function admRenderLage(){
    const el=admById('admLage'); if(!el) return;
    el.innerHTML=`<div class="adm-grid">
      <article class="rx-card rx-card--wide" id="lgToday"></article>
      <article class="rx-card" id="lgNow"></article>
      <article class="rx-card" id="lgAttention"></article>
      <article class="rx-card" id="lgStaff"></article>
      <article class="rx-card" id="lgNext"></article>
    </div>`;
    ADM.todaySig='';
    admUpdateLage(); admRefreshDevices();
    if(Date.now()-ADM.revAt>60000){ ADM.revAt=Date.now(); dbFetch(REVIEWS_KEY,[]).then(()=>{ admRenderAttention(); admUpdateReviewBadge(); }).catch(()=>{}); }
    dbEnsure(AVAIL_KEY,{}).catch(()=>{});
  }
  function admTodayState(){
    const oh=loadOpeningHours(); const q=getEffectiveQueueTime(); const qd=loadQueueData();
    const auto=qd.value===null||(qd.until!==null&&Date.now()>=qd.until);
    const evening=q==='Stängt för kvällen'; const open=oh!=='Stängt'&&!evening&&q!=='Stängt';
    const sched=loadOpenDates().find(e=>(typeof e==='string'?e:e.date)===todayStr());
    return {oh,q,auto,open,evening,hidden:loadGuestHidden(),scheduled:sched&&typeof sched!=='string'?sched.hours:''};
  }
  function admRenderToday(force){
    const el=admById('lgToday'); if(!el) return;
    const st=admTodayState(); const sig=JSON.stringify(st);
    if(!force&&sig===ADM.todaySig) return;
    if(!force&&el.contains(document.activeElement)&&document.activeElement.tagName==='SELECT') return;
    ADM.todaySig=sig;
    const today=todayStr();
    const statusTxt=st.open?`Öppet ${st.oh}`:(st.evening?'Stängt för idag':'Stängt');
    const sub=st.open?`Kötid ${admEsc(queueLabel(st.q))} · ${st.auto?'räknas från biljetterna':'inställd för hand'}`:(st.scheduled?`Enligt öppetdagarna öppnar ni ${admEsc(st.scheduled)}.`:'Ingen öppettid inlagd för idag.');
    const qOpts=['0–5 min','5–10 min','10–15 min','15–20 min','20–25 min','25–30 min','Tillfälligt Stängt','Stängt för kvällen'];
    el.innerHTML=`<p class="rx-card-kicker">Idag</p>
      <div class="rx-bigstatus ${st.open?'is-open':'is-closed'}"><span class="status-dot ${st.open?'live':'dead'}"></span>${admEsc(statusTxt)}</div>
      <p class="rx-sub">${sub}${st.hidden?' <span class="rx-chip rx-chip--warn">Gästerna ser "Stängt" (test)</span>':''}</p>
      <div class="rx-fields">
        <label class="rx-field"><span>Öppettid</span><select id="lgHours">${st.oh==='Stängt'?'<option value="Stängt" selected>Stängt</option>':''}${admHoursOptions(st.oh==='Stängt'?'':st.oh,[st.scheduled])}${st.oh!=='Stängt'?'<option value="Stängt">Stängt</option>':''}<option value="__custom__">Annan tid…</option></select></label>
        <label class="rx-field"><span>Kötid</span><select id="lgQueue"${st.oh==='Stängt'?' disabled':''}><option value="__auto__"${st.auto?' selected':''}>Automatisk (${admEsc(computeAutoQueueTime())})</option>${qOpts.map(v=>`<option value="${v}"${!st.auto&&v===st.q?' selected':''}>${queueLabel(v)}</option>`).join('')}</select></label>
      </div>
      ${!st.auto&&st.open?'<p class="tiny muted">En handinställd kötid gäller i fem minuter. Sedan räknas den från biljetterna igen.</p>':''}
      <label class="rx-switch"><input type="checkbox" id="lgHidden"${st.hidden?' checked':''}><span>Visa "Stängt" för gästerna, till exempel under en testdag</span></label>
      <div class="rx-actions"><button type="button" class="btn ${st.open?'':'btn-green'}" data-adm-open="oppnastang">${st.open?'Stäng dagen…':'Öppna dagen…'}</button></div>`;
    admById('lgHours').onchange=async e=>{ let v=e.target.value; if(v==='__custom__'){ v=await admAskHours(st.oh==='Stängt'?'':st.oh); if(!v){ admRenderToday(true); return; } } await presetSelected(v); notify(v==='Stängt'?'Dagen är stängd.':`Öppettiden är ${v}.`,'ok'); admRenderToday(true); admUpdateLage(); };
    admById('lgQueue').onchange=e=>{ applyQueuePreset(e.target.value); admRenderToday(true); };
    admById('lgHidden').onchange=async()=>{ await toggleGuestHidden(); admRenderToday(true); };
  }
  function admUpdateLage(){
    if(!admById('lgToday')) return;
    admRenderToday(false);
    loadDailyStats();
    const q=admQueued(); const hist=loadSalesHistory()[todayStr()]||{}; const entries=Array.isArray(hist.entries)?hist.entries:[];
    const last=entries.length?entries[entries.length-1].time:'';
    const now=admById('lgNow');
    if(now) now.innerHTML=`<p class="rx-card-kicker">Just nu</p>
      <div class="rx-tiles">
        <div class="rx-tile"><span>Sålda biljetter</span><strong>${guestCount}</strong></div>
        <div class="rx-tile"><span>Insläppta</span><strong>${admittedToday()}</strong></div>
        <div class="rx-tile ${q.people?'is-hot':''}"><span>I kön</span><strong>${q.people}</strong></div>
        <div class="rx-tile"><span>Intäkt</span><strong>${Number(totalIncome||0).toLocaleString('sv-SE')}<small> kr</small></strong></div>
      </div>
      <p class="rx-sub">${entries.length} köp idag${last?` · senaste kl ${admEsc(String(last).slice(0,5))}`:''}</p>`;
    admRenderAttention(); admRenderStaffCard(); admRenderNextCard();
  }
  function admAttentionItems(){
    const items=[]; const st=admTodayState();
    const reviews=dbGet(REVIEWS_KEY,[])||[];
    const pending=reviews.filter(r=>r.status==='pending').length;
    const seen=localStorage.getItem('admReviewsSeenV1')||'';
    const fresh=reviews.filter(r=>(r.ts||'')>seen&&r.status!=='pending').length;
    if(pending) items.push({lvl:'warn',text:`${pending} ${pending>1?'omdömen väntar':'omdöme väntar'} på granskning`,btn:'Granska',go:'recensioner'});
    else if(fresh) items.push({lvl:'info',text:`${fresh} ${fresh>1?'nya omdömen':'nytt omdöme'} i gästboken`,btn:'Läs',go:'recensioner'});
    const cutoff=Date.now()-3600000; const stale=admQueued().items.filter(t=>Date.parse(t.createdAt||'')<cutoff);
    if(stale.length){ const p=stale.reduce((s,t)=>s+Number(t.adult||0)+Number(t.child||0),0); items.push({lvl:'warn',text:`${stale.length} ${stale.length>1?'biljetter':'biljett'} (${p} ${p>1?'gäster':'gäst'}) har stått i kön över en timme`,btn:'Ta bort ur kön',act:'stale'}); }
    if(st.open&&!admCoverage(todayStr()).on.length) items.push({lvl:'warn',text:'Ingen personal är inlagd i schemat idag',btn:'Schema',go:'schema'});
    if(st.open){ const w=admCoverage(todayStr()).warn.filter(x=>x!=='Ingen i schemat'); if(w.length) items.push({lvl:'info',text:`Idag: ${w.join(', ').toLowerCase()}`,btn:'Schema',go:'schema'}); }
    if(admById('msgBadgeDot')?.style.display==='inline-block') items.push({lvl:'info',text:'Nytt meddelande från personalen',btn:'Läs',go:'meddelanden'});
    if(st.open){ const reg=loadRegisteredDevices(); ADM.devices.filter(d=>reg[d.id]&&Date.now()-d.ts>3*60000&&Date.now()-d.ts<12*3600000).forEach(d=>items.push({lvl:'warn',text:`Kassaenheten ${d.name} hördes senast av ${admAgo(d.ts)}`,btn:'Enheter',go:'skarmar'})); }
    if(PRACTICE) items.push({lvl:'info',text:'Övningsläget är på i den här enheten',btn:'Avsluta',act:'practice'});
    const next=admUpcoming(3).find(d=>d.date>todayStr());
    if(next){ const w=admCoverage(next.date).warn; if(w.length) items.push({lvl:'info',text:`${admDayShort(next.date)}: ${w.join(', ').toLowerCase()}`,btn:'Schema',go:'schema'}); }
    return items;
  }
  function admRenderAttention(){
    const el=admById('lgAttention'); if(!el) return;
    const items=admAttentionItems();
    el.innerHTML=`<p class="rx-card-kicker">Kräver åtgärd</p>${items.length?`<ul class="rx-list">${items.map((it,i)=>`<li class="rx-att rx-att--${it.lvl}"><span>${admEsc(it.text)}</span><button type="button" class="btn" data-att="${i}">${admEsc(it.btn)}</button></li>`).join('')}</ul>`:'<p class="rx-empty">Inget kräver åtgärd just nu.</p>'}`;
    el.onclick=e=>{ const b=e.target.closest('[data-att]'); if(!b) return; const it=items[Number(b.dataset.att)]; if(!it) return; if(it.go) admOpen(it.go); else if(it.act==='stale') admClearStale(); else if(it.act==='practice') rxStopPractice(); };
  }
  async function admClearStale(){
    if(!(await uiConfirm('Ta bort biljetterna som stått i kön i över en timme? Gästerna räknas inte som insläppta.',{okLabel:'Ta bort ur kön'}))) return;
    const cutoff=Date.now()-3600000;
    await mutateOpenTickets(o=>{ o.items.forEach(t=>{ if(!t.used&&Date.parse(t.createdAt||'')<cutoff&&(Number(t.adult||0)+Number(t.child||0))>0){ t.used=true; t.stale=true; } }); });
    queueTime=getEffectiveQueueTime(); updateTopbar(); admUpdateLage();
    notify('Biljetterna är borttagna ur kön.','ok');
  }
  function admRenderStaffCard(){
    const el=admById('lgStaff'); if(!el) return;
    const {on,warn}=admCoverage(todayStr());
    const rows=on.sort((a,b)=>String(a[1].hours).localeCompare(String(b[1].hours)));
    el.innerHTML=`<p class="rx-card-kicker">Personal idag</p>${rows.length?`<ul class="rx-list rx-list--plain">${rows.map(([n,v])=>`<li class="rx-person"><strong>${admEsc(n)}</strong><span>${admEsc(v.hours||'–')}${v.task?` · ${admEsc(v.task)}`:''}</span></li>`).join('')}</ul>`:'<p class="rx-empty">Ingen är inlagd i schemat idag.</p>'}${rows.length&&warn.length?`<div class="rx-chips">${warn.map(w=>`<span class="rx-chip rx-chip--warn">${admEsc(w)}</span>`).join('')}</div>`:''}<button type="button" class="adm-linkbtn" data-adm-open="schema">Ändra i schemat ›</button>`;
  }
  function admRenderNextCard(){
    const el=admById('lgNext'); if(!el) return;
    const next=admUpcoming(5).find(d=>d.date>todayStr());
    if(!next){ el.innerHTML=`<p class="rx-card-kicker">Nästa öppetdag</p><p class="rx-empty">Inga fler öppetdagar är inlagda.</p><button type="button" class="adm-linkbtn" data-adm-open="dagar">Lägg till öppetdagar ›</button>`; return; }
    const fc=admForecast(next.date,next.hours); const cov=admCoverage(next.date);
    el.innerHTML=`<p class="rx-card-kicker">Nästa öppetdag</p>
      <p class="rx-card-title">${admDayLong(next.date)}</p><p class="rx-sub">${admEsc(next.hours||'Ingen tid inlagd')}</p>
      ${fc?`<p class="rx-forecast"><strong>ca ${fc.guests} gäster</strong> · ${admKr(fc.income)}<span>Snitt av ${fc.n} ${admEsc(fc.how)}</span></p>`:'<p class="rx-sub">För lite historik för en prognos ännu.</p>'}
      <div class="rx-chips"><span class="rx-chip">${cov.on.length} i schemat</span>${cov.warn.filter(w=>w!=='Ingen i schemat').map(w=>`<span class="rx-chip rx-chip--warn">${admEsc(w)}</span>`).join('')}</div>
      <button type="button" class="adm-linkbtn" data-adm-open="schema">Schemat ›</button>`;
  }
  /* ---------- Meddelanden: anslag, direktmeddelanden och notis på allas skärmar ----------
     Meddelandefunktionen (renderStaffMsgSection i app.js) ligger på Min sida för personalen. För admin flyttas samma
     ruta hit, och när anslaget går till alla kan det också visas som notis överst på skärmarna (staffBroadcastV1). */
  const ADM_MSG_HOME={parent:admById('staffMsgSection')?.parentNode,next:admById('staffMsgSection')?.nextSibling};
  function admPlaceMessages(){
    const box=admById('staffMsgSection'); if(!box) return;
    const target=isAdmin?admById('admMeddelanden'):ADM_MSG_HOME.parent;
    if(target&&box.parentNode!==target){ if(isAdmin) target.appendChild(box); else target.insertBefore(box,ADM_MSG_HOME.next||null); }
  }
  function admRenderMessages(){ admPlaceMessages(); renderStaffMsgSection(); markMsgSeen(); }
  const _admRenderMsg0=renderStaffMsgSection;
  renderStaffMsgSection=function(){
    _admRenderMsg0.apply(this,arguments);
    if(!isAdmin) return;
    const inp=admById('adminMsgInput'); if(!inp||admById('adminMsgNotify')) return;
    inp.insertAdjacentHTML('afterend','<label class="rx-switch" id="adminMsgNotifyRow"><input type="checkbox" id="adminMsgNotify" checked><span>Visa också som notis överst på allas skärmar just nu</span></label>');
    const title=document.querySelector('#staffMsgSection .staff-msg-section-title'); if(title) title.textContent='Skriv';
    admMsgLabels();
  };
  function admMsgLabels(){
    const all=(admById('adminMsgTo')?.value||'all')==='all';
    const row=admById('adminMsgNotifyRow'); if(row) row.hidden=!all;
    const send=admById('adminMsgSendBtn'); if(send) send.textContent=all?'Spara anslaget':'Skicka';
    const clr=admById('adminMsgClearBtn'); if(clr) clr.textContent='Ta bort anslaget';
  }
  const _admMsgTo0=onAdminMsgToChange;
  onAdminMsgToChange=function(){ _admMsgTo0.apply(this,arguments); admMsgLabels(); };
  const _admSendMsg0=sendAdminMsg;
  sendAdminMsg=async function(){
    const to=admById('adminMsgTo')?.value; const txt=(admById('adminMsgInput')?.value||'').trim(); const pop=!!admById('adminMsgNotify')?.checked;
    await _admSendMsg0.apply(this,arguments);
    if(to==='all'&&txt&&pop){ const bc={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),text:txt,by:_myCanonName(),ts:Date.now()}; localStorage.setItem('rxBcSeenV1',bc.id); dbSet(STAFF_BROADCAST_KEY,bc).then(()=>notify('Anslaget är sparat och visas som notis.','ok')).catch(()=>notify('Anslaget sparades, men notisen kunde inte skickas.','error')); }
    else if(to==='all'&&txt) notify('Anslaget är sparat.','ok');
  };
  function rxBroadcastCheck(){
    const bc=dbGet(STAFF_BROADCAST_KEY,null);
    const staffish=(loggedInUser&&!PREVIEW)||document.querySelector('.field-view');
    let el=admById('rxBroadcast');
    if(!staffish||!bc||!bc.id||!bc.text||Date.now()-Number(bc.ts||0)>12*3600000||localStorage.getItem('rxBcSeenV1')===bc.id){ el?.remove(); return; }
    if(el&&el.dataset.id===bc.id) return;
    el?.remove(); el=document.createElement('div'); el.id='rxBroadcast'; el.className='rx-broadcast'; el.dataset.id=bc.id; el.setAttribute('role','alert');
    el.innerHTML=`<div class="rx-broadcast-in"><p class="rx-broadcast-from">Meddelande från ${admEsc(bc.by||'receptionen')} · kl ${admTime(bc.ts)}</p><p class="rx-broadcast-text">${admEsc(bc.text)}</p><button type="button" class="rx-broadcast-ok">Uppfattat</button></div>`;
    el.querySelector('button').onclick=()=>{ localStorage.setItem('rxBcSeenV1',bc.id); el.remove(); };
    document.body.appendChild(el);
    try{ KorpenSound.chime(); }catch(_e){} uiVibrate([80,60,80]);
  }
  setInterval(rxBroadcastCheck,3000);

  /* ---------- Enheternas livstecken ----------
     Varje inloggad enhet (och kötids- och kundskärmar) skriver en egen nyckel seen_<id> ungefär varje minut.
     En egen nyckel per enhet gör att de aldrig skriver över varandra. Listan över enheter ändras sällan. */
  function rxDeviceLabel(){
    const reg=loadRegisteredDevices()[getDeviceId()]; if(reg&&reg.name) return reg.name;
    const ua=navigator.userAgent; const kind=/iPad|Macintosh.*Mobile|Macintosh.*Safari.*Version\/1[3-9]/.test(ua)&&navigator.maxTouchPoints>1?'iPad':/iPhone/.test(ua)?'iPhone':/Android/.test(ua)?(/Mobile/.test(ua)?'Android-telefon':'Android-platta'):'Dator';
    return `${kind} ${getDeviceId().slice(0,4)}`;
  }
  let _rxBeatAt=0;
  async function rxBeat(){
    if(PREVIEW||PRACTICE) return;
    const display=!!localStorage.getItem('overlayModeV1')||new URLSearchParams(location.search).has('display');
    if(!loggedInUser&&!display&&!document.querySelector('.field-view')) return;
    _rxBeatAt=Date.now();
    const id=getDeviceId();
    const rec={id,name:rxDeviceLabel(),user:loggedInUser?_myCanonName():'',view:rxView(),ts:Date.now()};
    apiSet('seen_'+id,JSON.stringify(rec)).catch(()=>{});
    if(localStorage.getItem('rxDirV1')!==id){ localStorage.setItem('rxDirV1',id); admMutate(DEVICE_DIR_KEY,[],arr=>{ if(!arr.includes(id)) arr.push(id); if(arr.length>30) arr.splice(0,arr.length-30); }); }
  }
  function rxBeatSoon(){ if(Date.now()-_rxBeatAt>15000) setTimeout(rxBeat,800); }
  setInterval(()=>{ if(!document.hidden) rxBeat(); },60000);
  async function admRefreshDevices(){
    try{
      const ids=(await dbFetch(DEVICE_DIR_KEY,[]))||[];
      const recs=await Promise.all(ids.slice(-15).map(id=>apiGet('seen_'+id).then(v=>{ try{ return v?JSON.parse(v):null; }catch(_e){ return null; } }).catch(()=>null)));
      ADM.devices=recs.filter(r=>r&&r.id&&r.ts).sort((a,b)=>b.ts-a.ts);
    }catch(_e){}
    admRenderAttention();
    const el=admById('admDeviceSeen'); if(!el) return;
    const reg=loadRegisteredDevices();
    const list=ADM.devices.filter(d=>Date.now()-d.ts<12*3600000);
    el.innerHTML=`${list.length?`<ul class="rx-list rx-list--plain">${list.map(d=>{ const age=Date.now()-d.ts; const cls=age<150000?'live':age<600000?'warn':'dead'; return `<li class="rx-device"><span class="status-dot ${cls}"></span><div><strong>${admEsc(d.name)}${reg[d.id]?' <span class="rx-chip">Kassa</span>':''}${d.id===getDeviceId()?' <span class="rx-chip">Den här</span>':''}</strong><span>${admEsc([d.user,d.view].filter(Boolean).join(' · '))} · ${admAgo(d.ts)}</span></div></li>`; }).join('')}</ul>`:'<p class="rx-empty">Ingen enhet har hörts av de senaste timmarna.</p>'}<p class="tiny muted">Enheter med personal inloggad, kötidsskärmar och kundskärmar hör av sig ungefär en gång i minuten.</p>`;
  }

  /* ============================== ÖPPNA OCH STÄNG DAGEN ============================== */
  const ADM_DEFAULT_CHECKS={
    open:['Ljus, ljud och effekter påslagna','Nödutgångar fria och skyltarna tända','Växelkassan räknad','Kassan och insläppet inloggade','Kötidsskärmen igång'],
    close:['Alla gäster har gått ut','Kassan räknad','Ljus, ljud och effekter avstängda','Dörrar låsta']
  };
  function admChecklists(){ const v=dbGet(CHECK_KEY,null); return (v&&Array.isArray(v.open)&&Array.isArray(v.close))?v:_clone(ADM_DEFAULT_CHECKS); }
  function admChecks(){ try{ const o=JSON.parse(localStorage.getItem('admChecksV1')||'{}'); if(o&&o.date===todayStr()) return {open:o.open||[],close:o.close||[],date:o.date}; }catch(_e){} return {date:todayStr(),open:[],close:[]}; }
  function admSetCheck(kind,item,on){ const o=admChecks(); o[kind]=o[kind].filter(x=>x!==item); if(on) o[kind].push(item); localStorage.setItem('admChecksV1',JSON.stringify(o)); }
  function admChecklistHtml(kind){
    const items=admChecklists()[kind]; const done=admChecks()[kind];
    if(!items.length) return '<p class="rx-empty">Ingen checklista. Lägg till punkter under Checklistor.</p>';
    return `<ul class="rx-checklist" data-kind="${kind}">${items.map(t=>`<li><label><input type="checkbox" value="${admEsc(t)}"${done.includes(t)?' checked':''}><span>${admEsc(t)}</span></label></li>`).join('')}</ul>`;
  }
  function admCheckProgress(kind){ const items=admChecklists()[kind]; const done=admChecks()[kind].filter(x=>items.includes(x)); return {done:done.length,total:items.length}; }
  function admCashSales(date){ const d=loadSalesHistory()[date]||{}; return (Array.isArray(d.entries)?d.entries:[]).filter(e=>e.payType==='Kontant').reduce((s,e)=>s+Number(e.sum||0),0); }
  async function admRenderOpenClose(){
    const el=admById('admOppnaStang'); if(!el) return;
    await dbEnsure(CHECK_KEY,null).catch(()=>{});
    const today=todayStr(); const day=loadSalesHistory()[today]||{}; const st=admTodayState();
    const op=day.opening||null, cl=day.closing||null;
    const {on}=admCoverage(today); const q=admQueued();
    const pOpen=admCheckProgress('open'), pClose=admCheckProgress('close');
    const cashStart=cl?.cashStart??op?.cashStart??'';
    el.innerHTML=`<p class="adm-intro">Gå igenom stegen uppifrån. Bockarna sparas på den här enheten under dagen och kommer med i dagens rapport.</p>
    <div class="adm-grid adm-grid--2">
      <article class="rx-card rx-paper">
        <p class="rx-card-kicker">Före första gästen</p><h4 class="rx-card-title">Öppna dagen</h4>
        ${op?`<p class="rx-stamp">Öppnad kl ${admTime(op.ts)} av ${admEsc(op.by)}</p>`:''}
        <ol class="rx-steps">
          <li><strong>Öppettid idag</strong><select id="ocHours" class="input">${admHoursOptions(st.oh!=='Stängt'?st.oh:(st.scheduled||HOUR_PRESETS[0]),[st.scheduled])}<option value="__custom__">Annan tid…</option></select></li>
          <li><strong>Personal idag</strong>${on.length?`<ul class="rx-mini">${on.map(([n,v])=>`<li>${admEsc(n)} <span>${admEsc(v.hours||'')}${v.task?' · '+admEsc(v.task):''}</span></li>`).join('')}</ul>`:'<p class="rx-empty">Ingen inlagd.</p>'}<button type="button" class="adm-linkbtn" data-adm-open="schema">Ändra i schemat ›</button></li>
          <li><strong>Checklista</strong> <span class="rx-prog" id="ocOpenProg">${pOpen.done} av ${pOpen.total}</span>${admChecklistHtml('open')}</li>
          <li><strong>Växelkassa vid start</strong><label class="rx-inline"><input id="ocCashStart" class="input" type="number" inputmode="numeric" min="0" step="1" value="${admEsc(cashStart)}" placeholder="0"> kr</label></li>
        </ol>
        <button type="button" class="btn btn-green rx-big" onclick="admDoOpen()">${st.open?'Spara öppningen':'Öppna dagen'}</button>
      </article>
      <article class="rx-card rx-paper">
        <p class="rx-card-kicker">Efter sista gästen</p><h4 class="rx-card-title">Stäng dagen</h4>
        ${cl?`<p class="rx-stamp">Stängd kl ${admTime(cl.ts)} av ${admEsc(cl.by)}</p>`:''}
        <ol class="rx-steps">
          <li><strong>Räkna kassan</strong>
            <table class="rx-cash"><tbody>
              <tr><th>Växelkassa vid start</th><td><input id="ocCashStart2" class="input" type="number" inputmode="numeric" min="0" step="1" value="${admEsc(cashStart)}" placeholder="0"></td></tr>
              <tr><th>Kontant försäljning idag</th><td id="ocCashSales">${admKr(admCashSales(today))}</td></tr>
              <tr><th>Ska finnas i kassan</th><td id="ocCashExpected"></td></tr>
              <tr><th>Räknat</th><td><input id="ocCounted" class="input" type="number" inputmode="numeric" min="0" step="1" value="${admEsc(cl?.cashCounted??'')}" placeholder="0"></td></tr>
              <tr class="rx-cash-diff"><th>Skillnad</th><td id="ocCashDiff">–</td></tr>
            </tbody></table></li>
          <li><strong>Kön</strong>${q.people?`<p>${q.people} ${q.people>1?'gäster':'gäst'} på ${q.tickets} ${q.tickets>1?'biljetter':'biljett'} står kvar i kön.</p><button type="button" class="btn" onclick="admEmptyQueue()">Töm kön</button>`:'<p>Ingen står kvar i kön.</p>'}</li>
          <li><strong>Checklista</strong> <span class="rx-prog" id="ocCloseProg">${pClose.done} av ${pClose.total}</span>${admChecklistHtml('close')}</li>
          <li><strong>Anteckningar</strong><textarea id="ocNotes" class="admin-textarea" rows="3" placeholder="Något som hänt under dagen? T.ex. rökmaskinen krånglade kl 20.10.">${admEsc(cl?.notes||'')}</textarea></li>
        </ol>
        <button type="button" class="btn btn-green rx-big" onclick="admDoClose()">Stäng dagen och spara rapporten</button>
      </article>
    </div>`;
    el.querySelectorAll('.rx-checklist').forEach(ul=>ul.addEventListener('change',e=>{ if(e.target.type!=='checkbox') return; admSetCheck(ul.dataset.kind,e.target.value,e.target.checked); const p=admCheckProgress(ul.dataset.kind); const prog=admById(ul.dataset.kind==='open'?'ocOpenProg':'ocCloseProg'); if(prog) prog.textContent=`${p.done} av ${p.total}`; }));
    const syncCash=src=>{ const a=admById('ocCashStart'), b=admById('ocCashStart2'); if(src===a&&b) b.value=a.value; if(src===b&&a) a.value=b.value; admCashCalc(); };
    ['ocCashStart','ocCashStart2','ocCounted'].forEach(id=>admById(id)?.addEventListener('input',e=>syncCash(e.target)));
    admById('ocHours').onchange=async e=>{ if(e.target.value==='__custom__'){ const v=await admAskHours(''); if(v){ const o=document.createElement('option'); o.value=o.textContent=v; e.target.prepend(o); e.target.value=v; } else e.target.selectedIndex=0; } };
    admCashCalc();
  }
  function admCashCalc(){
    const start=Number(admById('ocCashStart2')?.value||0); const sales=admCashSales(todayStr()); const exp=start+sales;
    const ex=admById('ocCashExpected'); if(ex) ex.textContent=admKr(exp);
    const cRaw=admById('ocCounted')?.value; const d=admById('ocCashDiff'); if(!d) return;
    if(cRaw===''||cRaw==null){ d.textContent='–'; d.className=''; return; }
    const diff=Number(cRaw)-exp; d.textContent=diff===0?'Stämmer':`${diff>0?'+':'−'}${admKr(Math.abs(diff))}`; d.className=diff===0?'is-ok':'is-off';
  }
  async function admDoOpen(){
    let hrs=admById('ocHours')?.value; if(!hrs||hrs==='__custom__'){ notify('Välj en öppettid.','error'); return; }
    const p=admCheckProgress('open');
    if(p.done<p.total&&!(await uiConfirm(`${p.total-p.done} ${p.total-p.done>1?'punkter':'punkt'} på checklistan är inte avbockade. Öppna ändå?`,{okLabel:'Öppna ändå'}))) return;
    const cashStart=Number(admById('ocCashStart')?.value||0);
    await presetSelected(hrs);
    const rec={by:_myCanonName(),ts:new Date().toISOString(),cashStart,checklist:p};
    mutateSalesHistory(h=>{ const d=ensureHistDay(h,todayStr()); d.opening=Object.assign({},d.opening||{},rec,{ts:(d.opening&&d.opening.ts)||rec.ts}); });
    notify(`Dagen är öppnad, ${hrs}.`,'ok');
    admRenderOpenClose();
  }
  async function admEmptyQueue(){
    if(!(await uiConfirm('Töm kön? Biljetterna som står kvar tas bort ur kön utan att räknas som insläppta.',{okLabel:'Töm kön'}))) return;
    await mutateOpenTickets(o=>{ o.items.forEach(t=>{ if(!t.used&&(Number(t.adult||0)+Number(t.child||0))>0){ t.used=true; t.stale=true; } }); });
    queueTime=getEffectiveQueueTime(); updateTopbar(); admRenderOpenClose();
  }
  async function admDoClose(){
    const p=admCheckProgress('close');
    const counted=admById('ocCounted')?.value;
    if(counted===''&&!(await uiConfirm('Kassan är inte räknad. Stäng dagen ändå?',{okLabel:'Stäng ändå'}))) return;
    if(p.done<p.total&&!(await uiConfirm(`${p.total-p.done} ${p.total-p.done>1?'punkter':'punkt'} på checklistan är inte avbockade. Stäng ändå?`,{okLabel:'Stäng ändå'}))) return;
    const today=todayStr(); const cashStart=Number(admById('ocCashStart2')?.value||0); const cashSales=admCashSales(today);
    const rec={by:_myCanonName(),ts:new Date().toISOString(),cashStart,cashSales,cashExpected:cashStart+cashSales,cashCounted:counted===''?null:Number(counted),notes:(admById('ocNotes')?.value||'').trim(),checklist:p};
    rec.cashDiff=rec.cashCounted==null?null:rec.cashCounted-rec.cashExpected;
    await mutateSalesHistory(h=>{ const d=ensureHistDay(h,today); d.closing=rec; });
    if(loadOpeningHours()!=='Stängt') applyQueuePreset('Stängt för kvällen');
    updateTopbar();
    notify('Dagen är stängd och rapporten sparad.','ok');
    admRenderOpenClose();
    showDaySummaryModal(today);
  }

  // Dagssammanfattningen får dagens rapport (öppning, kassaräkning, anteckningar) och en utskriftsknapp
  function admReportHtml(date){
    const d=loadSalesHistory()[date]||{}; const op=d.opening, cl=d.closing; if(!op&&!cl) return '';
    const row=(k,v)=>`<tr><th>${k}</th><td>${v}</td></tr>`;
    let rows='';
    if(op) rows+=row('Öppnad',`kl ${admTime(op.ts)} av ${admEsc(op.by)}${op.checklist?` · checklista ${op.checklist.done} av ${op.checklist.total}`:''}`);
    if(cl){
      rows+=row('Stängd',`kl ${admTime(cl.ts)} av ${admEsc(cl.by)}${cl.checklist?` · checklista ${cl.checklist.done} av ${cl.checklist.total}`:''}`);
      rows+=row('Växelkassa vid start',admKr(cl.cashStart))+row('Kontant försäljning',admKr(cl.cashSales))+row('Ska finnas i kassan',admKr(cl.cashExpected));
      rows+=row('Räknat',cl.cashCounted==null?'Inte räknat':admKr(cl.cashCounted));
      if(cl.cashDiff!=null) rows+=row('Skillnad',cl.cashDiff===0?'Stämmer':`<b class="${cl.cashDiff?'is-off':''}">${cl.cashDiff>0?'+':'−'}${admKr(Math.abs(cl.cashDiff))}</b>`);
    }
    return `<hr class="day-summary-divider"><div class="day-summary-section"><div class="day-summary-section-title">Dagens rapport</div><table class="rx-report">${rows}</table>${cl&&cl.notes?`<p class="rx-report-notes">${admEsc(cl.notes).replace(/\n/g,'<br>')}</p>`:''}</div>`;
  }
  const _admShowDaySummary0=showDaySummaryModal;
  showDaySummaryModal=function(date){
    _admShowDaySummary0(date);
    const c=admById('daySummaryContent'); if(c) c.insertAdjacentHTML('beforeend',admReportHtml(date));
    const a=document.querySelector('#daySummaryModal .actions'); if(a&&!a.querySelector('.rx-print')) a.insertAdjacentHTML('afterbegin','<button class="btn rx-print" type="button" onclick="admPrintSummary()">Skriv ut</button>');
  };
  function admPrintSummary(){ document.body.classList.add('rx-printing'); const done=()=>{ document.body.classList.remove('rx-printing'); window.removeEventListener('afterprint',done); }; window.addEventListener('afterprint',done); window.print(); setTimeout(done,1500); }
  const _admBuildExport0=buildDayExportText;
  buildDayExportText=function(date){
    let t=_admBuildExport0(date); const d=loadSalesHistory()[date]||{}; const cl=d.closing;
    if(cl){ t+=`\n\nDagens rapport\nStängd kl ${admTime(cl.ts)} av ${cl.by}\nKassa: start ${cl.cashStart} kr, kontant ${cl.cashSales} kr, ska finnas ${cl.cashExpected} kr, räknat ${cl.cashCounted==null?'–':cl.cashCounted+' kr'}${cl.cashDiff!=null?`, skillnad ${cl.cashDiff} kr`:''}`; if(cl.notes) t+=`\nAnteckningar: ${cl.notes}`; }
    return t;
  };

  /* ============================== ÖPPETDAGAR ============================== */
  function admRenderDays(){
    const el=admById('admDagar'); if(!el) return;
    const days=admUpcoming(40);
    el.innerHTML=`<div class="adm-grid adm-grid--2 adm-grid--main">
      <article class="rx-card">
        <h4 class="rx-card-title">Kommande öppetdagar</h4>
        ${days.length?`<ul class="adm-rows">${days.map(d=>{ const cov=admCoverage(d.date); const fc=admForecast(d.date,d.hours); return `<li class="adm-row"><div class="adm-row-main"><strong>${d.date===todayStr()?'Idag, ':''}${admDayLong(d.date)}</strong><span>${admEsc(d.hours||'Ingen tid inlagd')}</span></div>
          <div class="rx-chips"><span class="rx-chip">${cov.on.length} i schemat</span>${cov.warn.filter(w=>w!=='Ingen i schemat').map(w=>`<span class="rx-chip rx-chip--warn">${w}</span>`).join('')}${fc?`<span class="rx-chip">ca ${fc.guests} gäster</span>`:''}</div>
          <div class="adm-row-actions"><button type="button" class="btn" data-dayedit="${d.date}">Ändra tid</button><button type="button" class="btn btn-danger" data-dayrm="${d.date}">Ta bort</button></div></li>`; }).join('')}</ul>`:'<p class="rx-empty">Inga öppetdagar är inlagda.</p>'}
      </article>
      <article class="rx-card">
        <h4 class="rx-card-title">Lägg till öppetdag</h4>
        <div class="rx-fields rx-fields--stack">
          <label class="rx-field"><span>Datum</span><input type="date" id="odDate" class="input" min="${todayStr()}"></label>
          <label class="rx-field"><span>Öppettid</span><select id="odHours" class="input">${admHoursOptions(HOUR_PRESETS[0])}<option value="__custom__">Annan tid…</option></select></label>
        </div>
        <button type="button" class="btn btn-green" onclick="admAddDay()">Lägg till</button>
        <p class="tiny muted">Dagen öppnar av sig själv när öppettiden börjar och visas för gästerna under "Kommande dagar".</p>
      </article></div>`;
    admById('odHours').onchange=async e=>{ if(e.target.value==='__custom__'){ const v=await admAskHours(''); if(v){ const o=document.createElement('option'); o.value=o.textContent=v; e.target.prepend(o); e.target.value=v; } else e.target.selectedIndex=0; } };
    el.onclick=async e=>{
      const ed=e.target.closest('[data-dayedit]'), rm=e.target.closest('[data-dayrm]');
      if(ed){ const date=ed.dataset.dayedit; const cur=days.find(x=>x.date===date)?.hours||''; const v=await admAskHours(cur); if(!v) return; admSetDay(date,v); }
      if(rm){ const date=rm.dataset.dayrm; if(!(await uiConfirm(`Ta bort ${admDayLong(date)} från öppetdagarna?`,{okLabel:'Ta bort',danger:true}))) return; const before=loadOpenDates(); await saveOpenDates(before.filter(x=>(typeof x==='string'?x:x.date)!==date)); admAfterDays(); showUndoToast(`${admDayLong(date)} borttagen`,async()=>{ await saveOpenDates(before); admAfterDays(); }); }
    };
  }
  async function admSetDay(date,hours){
    const list=loadOpenDates().filter(x=>(typeof x==='string'?x:x.date)!==date); list.push(hours?{date,hours}:date);
    list.sort((a,b)=>(typeof a==='string'?a:a.date).localeCompare(typeof b==='string'?b:b.date));
    await saveOpenDates(list);
    if(date===todayStr()&&loadOpeningHours()!=='Stängt'&&hours) await presetSelected(hours);
    admAfterDays(); notify('Sparat.','ok');
  }
  async function admAddDay(){
    const date=admById('odDate')?.value; const hours=admById('odHours')?.value;
    if(!date){ notify('Välj ett datum.','error'); return; }
    if(date<todayStr()){ notify('Datumet har redan passerat.','error'); return; }
    if(!hours||hours==='__custom__'){ notify('Välj en öppettid.','error'); return; }
    await admSetDay(date,hours);
  }
  function admAfterDays(){ renderUpcomingDates(); updateTopbar(); admRenderDays(); }

  /* ============================== SCHEMA ============================== */
  // Schemat visas på två sätt. Bred skärm: en tabell med personer som rader och öppetdagar som kolumner, så att hela
  // perioden syns på en gång. Smal skärm: ett kort per dag med bara dem som har pass eller har svarat; övriga bakom "Visa alla".
  function admRenderSchema(){
    const el=admById('admSchema'); if(!el) return;
    const days=admUpcoming(10); const staff=admStaff(); const plan=loadShiftPlan(); const av=dbGet(AVAIL_KEY,{})||{};
    if(!ADM.schemaAll) ADM.schemaAll=new Set();
    const has=(d,n)=>{ const s=(plan[d]||{})[n]; return !!(s&&(s.hours||s.task)); };
    const cell=(d,u)=>{ const s=(plan[d]||{})[u.name]; const a=(av[d]||{})[u.name]||''; const on=has(d,u.name);
      const pend=on&&shiftNeedsConfirm(s);
      return `<button type="button" class="adm-cell${on?' is-on':''}${on&&!s.task?' is-notask':''}${pend?' is-pending':''}${!on&&a==='no'?' is-no':''}" data-date="${d}" data-name="${admEsc(u.name)}" aria-label="${admEsc(u.name)}, ${admDayLong(d)}">${on?`<span class="adm-cell-h">${admEsc(s.hours||'Tid?')}</span><span class="adm-cell-t">${s.task?admEsc(s.task):'Uppgift saknas'}</span>${pend?'<span class="adm-cell-p">Ej bekräftat</span>':''}`:a==='no'?'<span class="adm-cell-no">Kan inte</span>':'<span class="adm-cell-empty">–</span>'}</button>`; };
    const dayHead=d=>{ const cov=admCoverage(d.date); const withPass=staff.filter(u=>has(d.date,u.name)); const ok=withPass.filter(u=>!shiftNeedsConfirm(plan[d.date][u.name])).length; const nej=staff.filter(u=>!has(d.date,u.name)&&(av[d.date]||{})[u.name]==='no').length;
      return `<div class="adm-dh"><strong>${d.date===todayStr()?'Idag':admDayShort(d.date)}</strong><span>${admEsc(d.hours||'')}</span></div>
        <div class="adm-dh-chips">${cov.warn.length?cov.warn.map(w=>`<span class="rx-chip rx-chip--warn">${w}</span>`).join(''):'<span class="rx-chip rx-chip--ok">Bemannad</span>'}</div>
        <div class="adm-ask"><span>${withPass.length?`${ok} av ${withPass.length} bekräftade`:'Inga pass'}${nej?` · ${nej} tackade nej`:''}</span>${withPass.length?`<button type="button" class="adm-linkbtn" data-ask="${d.date}">Fråga igen</button>`:''}</div>`; };
    const noTask=days.reduce((c,d)=>c+staff.filter(u=>has(d.date,u.name)&&!plan[d.date][u.name].task).length,0);
    const notConf=days.reduce((c,d)=>c+staff.filter(u=>has(d.date,u.name)&&shiftNeedsConfirm(plan[d.date][u.name])).length,0);
    el.innerHTML=`<p class="adm-intro">Tryck på en ruta för att tilldela eller ändra ett pass. Personen bekräftar eller tackar nej på Min sida, och ändrar du tiden får hen frågan igen. ${noTask?`<span class="adm-notask-note">${noTask} pass saknar uppgift.</span>`:''} ${notConf?`<span class="adm-notask-note">${notConf} pass är inte ${notConf===1?'bekräftat':'bekräftade'} än.</span>`:''}</p>
      ${days.length?`<div class="adm-matrix-wrap"><table class="adm-matrix"><thead><tr><th scope="col" class="adm-mx-name">Person</th>${days.map(d=>`<th scope="col">${dayHead(d)}</th>`).join('')}</tr></thead>
        <tbody>${staff.map(u=>`<tr><th scope="row" class="adm-mx-name">${admEsc(u.name)}</th>${days.map(d=>`<td>${cell(d.date,u)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="adm-daycards">${days.map(d=>{ const rel=staff.filter(u=>has(d.date,u.name)||(av[d.date]||{})[u.name]); const rest=staff.filter(u=>!rel.includes(u)); const all=ADM.schemaAll.has(d.date);
        const row=u=>`<li><span class="adm-dc-name">${admEsc(u.name)}</span>${cell(d.date,u)}</li>`;
        return `<article class="rx-card adm-day">${dayHead(d)}<ul class="adm-dc">${rel.map(row).join('')}${all?rest.map(row).join(''):''}</ul>${!rel.length&&!all?'<p class="adm-dc-empty">Ingen har tilldelats pass än.</p>':''}${rest.length?`<button type="button" class="adm-linkbtn" data-all="${d.date}">${all?'Visa färre':`Visa alla (${rest.length} till)`}</button>`:''}</article>`; }).join('')}</div>`
      :'<p class="rx-empty">Lägg in öppetdagar först, så visas de här.</p>'}
      <p class="tiny muted">Tidigare pass och schemat för en person i taget finns under Personal.</p>`;
    el.onclick=e=>{ const a=e.target.closest('[data-ask]'); if(a){ admAskAgain(a.dataset.ask); return; }
      const m=e.target.closest('[data-all]'); if(m){ const d=m.dataset.all; ADM.schemaAll.has(d)?ADM.schemaAll.delete(d):ADM.schemaAll.add(d); admRenderSchema(); return; }
      const b=e.target.closest('.adm-cell'); if(b) admEditShift(b.dataset.date,b.dataset.name); };
    if(!ADM.availFetched){ ADM.availFetched=true; dbFetch(AVAIL_KEY,{}).then(()=>{ if(!admById('admSchema')?.hidden) admRenderSchema(); }).catch(()=>{}); }
  }
  // Alla med pass den dagen får frågan igen på Min sida och måste bekräfta passet på nytt
  async function admAskAgain(date){
    const ok=await uiConfirm(`Alla som har pass ${admDayLong(date)} får frågan igen på Min sida och måste bekräfta passet på nytt.`,{title:'Fråga igen?',okLabel:'Fråga igen'});
    if(!ok) return;
    await admMutate(SHIFT_PLAN_KEY,{},o=>{ const d=o[date]; if(!d) return; Object.values(d).forEach(v=>{ if(v&&(v.hours||v.task)) v.confirmed=false; }); });
    await admMutate(AVAIL_KEY,{},o=>{ delete o[date]; });
    notify('Frågan är utskickad igen.','ok');
    admRenderSchema();
  }
  async function admEditShift(date,name){
    const plan=loadShiftPlan(); const cur=(plan[date]||{})[name]||{hours:'',task:''};
    const curAv=((dbGet(AVAIL_KEY,{})||{})[date]||{})[name]||'';
    const hadPass=!!(cur.hours||cur.task); const curSt=shiftNeedsConfirm(cur)?'':'yes';
    const openHrs=admUpcoming(40).find(d=>d.date===date)?.hours||'';
    const body=document.createElement('div'); body.className='adm-shift-form';
    body.innerHTML=`<label class="ui-dialog-field"><span class="ui-dialog-label">Arbetstid</span><input class="ui-dialog-input" id="shHours" value="${admEsc(cur.hours||'')}" placeholder="t.ex. 17:30–21:30" autocomplete="off"></label>
      ${openHrs?`<button type="button" class="adm-linkbtn" id="shFill">Hela öppettiden (${admEsc(openHrs)})</button>`:''}
      <label class="ui-dialog-field"><span class="ui-dialog-label">Uppgift</span><select class="ui-dialog-input" id="shTask"><option value="">Ingen uppgift</option>${(cur.task&&!loadTaskCatalog().includes(cur.task)?[cur.task,...loadTaskCatalog()]:loadTaskCatalog()).map(t=>`<option${t===cur.task?' selected':''}>${admEsc(t)}</option>`).join('')}</select></label>
      ${hadPass?`<div class="ui-dialog-field"><span class="ui-dialog-label">${admEsc(name)}s svar</span><div class="adm-seg adm-seg--wide" role="group" aria-label="Svar på passet" id="shAv">${[['yes','Bekräftat'],['','Inte bekräftat – fråga igen']].map(([v,l])=>`<button type="button" data-v="${v}" aria-pressed="${curSt===v}">${l}</button>`).join('')}</div></div>`
        :curAv==='no'?`<p class="adm-shift-no">${admEsc(name)} har tackat nej till den här dagen. Lägger du in ett pass får hen frågan igen.</p>`:''}
      <p class="tiny muted">Ett nytt pass, eller en ny tid, måste ${admEsc(name)} bekräfta på Min sida.</p>`;
    const had=cur.hours||cur.task;
    const res=await openDialog({title:`${name}, ${admDayLong(date)}`,body,dismissValue:null,onOpen:box=>{ box.querySelector('#shFill')?.addEventListener('click',()=>{ box.querySelector('#shHours').value=openHrs; });
        box.querySelector('#shAv')?.addEventListener('click',e=>{ const b=e.target.closest('[data-v]'); if(!b) return; box.querySelectorAll('#shAv [data-v]').forEach(x=>x.setAttribute('aria-pressed',x===b)); }); },
      actions:[...(had?[{label:'Ta bort passet',value:'del',danger:true}]:[]),{label:'Avbryt',value:null},{label:'Spara',primary:true,value:box=>({hours:box.querySelector('#shHours').value.trim(),task:box.querySelector('#shTask').value,st:box.querySelector('#shAv [aria-pressed="true"]')?.dataset.v??curSt})}]});
    if(!res) return;
    const p=loadShiftPlan(); if(!p[date]) p[date]={}; const before=JSON.stringify(p[date][name]||null);
    if(res==='del'||(!res.hours&&!res.task)) delete p[date][name];
    else{ const next=shiftAfterAdminEdit(p[date][name],res.hours,res.task);
      // Admin kan själv markera passet som bekräftat eller be om ett nytt svar; en ny tid kräver alltid ett nytt svar
      const timeSame=(res.hours||'')===(cur.hours||'');
      if(hadPass&&res.st!==curSt&&timeSame){ if(res.st==='yes') delete next.confirmed; else next.confirmed=false; }
      p[date][name]=next; }
    if(JSON.stringify(p[date][name]||null)===before){ admRenderSchema(); return; }
    if(!Object.keys(p[date]).length) delete p[date];
    saveShiftPlan(p);
    if(date===todayStr()){ ensureProfileDefaults(name); const v=p[date][name]||{hours:'',task:''}; userData[name].hours=v.hours; userData[name].task=v.task; userData[name].hoursDate=todayStr(); saveUserData(); snapshotStaffHoursToday(); if(_myCanonName()===name) loadProfile(); }
    refreshLonIfOpen?.();
    admRenderSchema();
  }

  /* ============================== PERSONAL ============================== */
  function admRenderStaffTable(){
    const el=admById('admStaffTable'); if(!el) return;
    const plan=loadShiftPlan(); const today=todayStr();
    const next=name=>Object.keys(plan).filter(d=>d>=today&&plan[d][name]&&(plan[d][name].hours||plan[d][name].task)).sort()[0];
    const core=n=>n==='Adam'||n==='Casper';
    el.innerHTML=`<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Namn</th><th>Kassa</th><th>Insläpp</th><th>Kompetenser</th><th>Nästa pass</th></tr></thead><tbody>
      ${admStaff().map(u=>{ const n=next(u.name); const skills=(userData[u.name]?.skills||[]); return `<tr data-id="${admEsc(u.id)}"><th scope="row"><button type="button" class="adm-linkbtn" data-edit>${admEsc(u.name)}</button>${u.admin?'<span class="rx-chip">Admin</span>':''}${u.isVoluntar?'<span class="rx-chip">Volontär</span>':''}</th>
        <td><input type="checkbox" aria-label="Kassa för ${admEsc(u.name)}" data-perm="hasAccess"${u.hasAccess||core(u.name)?' checked':''}${core(u.name)?' disabled':''}></td>
        <td><input type="checkbox" aria-label="Insläpp för ${admEsc(u.name)}" data-perm="hasInslepp"${u.hasInslepp||u.name==='Casper'?' checked':''}${u.name==='Casper'?' disabled':''}></td>
        <td>${skills.length?admEsc(skills.join(', ')):'<span class="muted">–</span>'}</td>
        <td>${n?`${admDayShort(n)} <span class="muted">${admEsc(plan[n][u.name].hours||'')}</span>`:'<span class="muted">–</span>'}</td></tr>`; }).join('')}
      </tbody></table></div><p class="tiny muted">Bocka i direkt i tabellen, eller tryck på ett namn för att redigera allt om personen.</p>`;
    el.onchange=e=>{ const cb=e.target.closest('input[data-perm]'); if(!cb) return; const id=cb.closest('tr').dataset.id; const u=users[id]; if(!u) return; u[cb.dataset.perm]=cb.checked; saveUsers(); const sel=admById('userSelect'); if(sel&&sel.value===id) sel.onchange?.(); notify(`Sparat för ${u.name}.`,'ok'); };
    el.onclick=e=>{ const b=e.target.closest('[data-edit]'); if(!b) return; const id=b.closest('tr').dataset.id; const sel=admById('userSelect'); if(!sel) return; sel.value=id; sel.onchange?.(); selectPersonalTab('idag'); admById('userSelectSection')?.scrollIntoView({block:'start',behavior:'smooth'}); };
  }
  // Lösenorden sparas förvrängda på servern och kan inte visas, bara bytas.
  async function admSetPassword(){
    const sel=admById('userSelect'); const id=sel?.value; const u=users[id]; if(!u) return;
    const pw=await uiPrompt(`Nytt lösenord för ${u.name}. Minst 4 tecken, längre är säkrare. Berätta det för ${u.name} själv.`,'',{okLabel:'Spara lösenord',title:'Byt lösenord'});
    if(pw==null) return;
    const v=String(pw).trim();
    if(v.length<4){ notify('Lösenordet måste ha minst 4 tecken.'); return; }
    try{ const r=await apiAction('setPassword',{ id, pw:v }); if(!r||!r.ok) throw new Error(r&&r.error||'fel'); notify(`Nytt lösenord sparat för ${u.name}.`,'ok'); }
    catch(_e){ notify('Lösenordet kunde inte sparas. Kontrollera anslutningen och försök igen.'); }
  }
  // Tabellen hålls i takt med redigeringen nedanför
  admById('saveAdminBtn')?.addEventListener('click',()=>setTimeout(admRenderStaffTable,50));
  admById('addUserBtn')?.addEventListener('click',()=>setTimeout(admRenderStaffTable,50));
  const _admExecDeleteUser0=executeDeleteUser;
  executeDeleteUser=function(){ _admExecDeleteUser0.apply(this,arguments); setTimeout(admRenderStaffTable,50); };

  /* ============================== LISTREDIGERARE ============================== */
  // Enkel listredigerare: rader med ett eller flera fält, knappar för att flytta och ta bort
  function admListEditor(root,items,{fields,addLabel,onChange}){
    const list=items.map(x=>({...x}));
    const draw=()=>{ root.innerHTML=list.map((it,i)=>`<div class="adm-li"><div class="adm-li-fields">${fields.map(f=>f.type==='textarea'?`<textarea class="admin-textarea" rows="2" data-f="${f.key}" placeholder="${f.ph}" aria-label="${f.ph}">${admEsc(it[f.key]||'')}</textarea>`:`<input class="input" data-f="${f.key}" placeholder="${f.ph}" aria-label="${f.ph}" value="${admEsc(it[f.key]||'')}">`).join('')}</div><div class="adm-li-tools"><button type="button" data-mv="-1" aria-label="Flytta upp"${i===0?' disabled':''}>↑</button><button type="button" data-mv="1" aria-label="Flytta ned"${i===list.length-1?' disabled':''}>↓</button><button type="button" data-rm aria-label="Ta bort">✕</button></div></div>`).join('')+`<button type="button" class="btn adm-li-add">${addLabel}</button>`; };
    root.oninput=e=>{ const row=e.target.closest('.adm-li'); if(!row) return; const i=[...root.querySelectorAll('.adm-li')].indexOf(row); if(list[i]) list[i][e.target.dataset.f]=e.target.value; onChange(list); };
    root.onclick=e=>{ const b=e.target.closest('button'); if(!b) return;
      if(b.classList.contains('adm-li-add')){ list.push({}); draw(); const rows=root.querySelectorAll('.adm-li'); rows[rows.length-1]?.querySelector('input,textarea')?.focus(); onChange(list); return; }
      const row=b.closest('.adm-li'); if(!row) return; const i=[...root.querySelectorAll('.adm-li')].indexOf(row);
      if(b.hasAttribute('data-rm')) list.splice(i,1); else if(b.dataset.mv){ const j=i+Number(b.dataset.mv); if(j<0||j>=list.length) return; [list[i],list[j]]=[list[j],list[i]]; }
      draw(); onChange(list); };
    draw(); return {get:()=>list};
  }
  /* ---------- Skärmar: välj bland hotellets bilder ---------- */
  function admRenderImagePicker(){
    const el=admById('admImagePicker'), ta=admById('displayImagesInput'); if(!el||!ta) return;
    const base=location.origin+location.pathname.replace(/[^/]*$/,'');
    const imgs=[['hotellarkiv-1936.jpg','Hotellet 1936'],['personalen-1936.jpg','Personalen'],['vykort-korpen.jpg','Vykortet'],['hotell-korpen.png','Loggan, ljus'],['korpen.png','Loggan, mörk']];
    const lines=()=>ta.value.split('\n').map(s=>s.trim()).filter(Boolean);
    const draw=()=>{ const cur=lines(); el.innerHTML=imgs.map(([f,l])=>`<button type="button" class="adm-img" data-url="${base+f}" aria-pressed="${cur.includes(base+f)}"><img src="${f}" alt="" loading="lazy"><span>${l}</span></button>`).join(''); };
    el.onclick=e=>{ const b=e.target.closest('.adm-img'); if(!b) return; const cur=lines(); const u=b.dataset.url; ta.value=(cur.includes(u)?cur.filter(x=>x!==u):[...cur,u]).join('\n'); draw(); };
    ta.oninput=draw; draw();
  }

  /* ============================== RECENSIONER ============================== */
  function admUpdateReviewBadge(){
    const b=admById('admReviewBadge'); if(!b) return;
    const reviews=dbGet(REVIEWS_KEY,[])||[]; const seen=localStorage.getItem('admReviewsSeenV1')||'';
    const n=reviews.filter(r=>r.status==='pending'||(r.ts||'')>seen).length;
    b.hidden=!n; b.textContent=n;
  }
  async function renderReviewsAdmin(){
    const el=admById('reviewsContent'); if(!el) return;
    if(!el.innerHTML.trim()) el.innerHTML='<p class="rx-empty">Hämtar omdömena…</p>';
    await Promise.all([dbFetch(REVIEWS_KEY,[]).catch(()=>{}),dbFetch(REVIEW_SETTINGS_KEY,{}).catch(()=>{})]);
    admDrawReviews();
    const reviews=dbGet(REVIEWS_KEY,[])||[]; const latest=reviews.reduce((m,r)=>(r.ts||'')>m?r.ts:m,'');
    if(latest) localStorage.setItem('admReviewsSeenV1',latest);
    admUpdateReviewBadge();
  }
  function admReviewUrl(){ return location.origin+location.pathname+'?review'; }
  function admDrawReviews(){
    const el=admById('reviewsContent'); if(!el) return;
    const reviews=(dbGet(REVIEWS_KEY,[])||[]).filter(r=>r&&r.ts);
    const moderate=!!(dbGet(REVIEW_SETTINGS_KEY,{})||{}).moderate;
    const avg=reviews.length?reviews.reduce((s,r)=>s+Number(r.rating||0),0)/reviews.length:0;
    const dist=[5,4,3,2,1].map(s=>{ const n=reviews.filter(r=>Number(r.rating)===s).length; const pct=reviews.length?Math.round(n/reviews.length*100):0; return `<div class="adm-dist"><span>${s}</span><div><i style="width:${pct}%"></i></div><span>${n}</span></div>`; }).join('');
    const pending=reviews.filter(r=>r.status==='pending'), hidden=reviews.filter(r=>r.status==='hidden');
    const f=ADM.revFilter;
    const shown=[...reviews].reverse().filter(r=>f==='granska'?r.status==='pending':f==='dolda'?r.status==='hidden':true);
    const url=admReviewUrl();
    const qr=`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=160x160&color=1d1f1c&bgcolor=e1ddcf&margin=8`;
    el.innerHTML=`<div class="adm-grid adm-grid--3">
      <article class="rx-card"><p class="rx-card-kicker">Snittbetyg</p><div class="adm-avg"><strong>${avg?avg.toFixed(1).replace('.',','):'–'}</strong><span>${reviews.length} ${reviews.length===1?'omdöme':'omdömen'}</span></div>${dist}</article>
      <article class="rx-card adm-qr"><p class="rx-card-kicker">Gästbokens QR-kod</p><img src="${qr}" width="140" height="140" alt="QR-kod till gästboken"><input class="input" value="${admEsc(url)}" readonly onclick="this.select()" aria-label="Länk till gästboken"><button type="button" class="btn" onclick="admPrintQrCard()">Skriv ut QR-kort (A5)</button></article>
      <article class="rx-card"><p class="rx-card-kicker">Granskning</p>
        <label class="rx-switch"><input type="checkbox" id="revModerate"${moderate?' checked':''}><span>Granska nya kommentarer innan de visas i gästboken</span></label>
        <p class="tiny muted">${moderate?'Nya kommentarer väntar här tills du godkänner dem. Betyget räknas direkt.':'Nya kommentarer visas direkt. Du kan dölja eller ta bort dem i efterhand.'}</p></article>
    </div>
    <div class="ui-tabs adm-rev-tabs" role="tablist">
      <button type="button" class="ui-tab${f==='alla'?' is-active':''}" data-rf="alla">Alla (${reviews.length})</button>
      <button type="button" class="ui-tab${f==='granska'?' is-active':''}" data-rf="granska">Att granska (${pending.length})</button>
      <button type="button" class="ui-tab${f==='dolda'?' is-active':''}" data-rf="dolda">Dolda (${hidden.length})</button>
    </div>
    ${shown.length?`<ul class="adm-reviews">${shown.map(r=>{ const c=(r.comment||'').trim(); const rep=(r.reply&&r.reply.text)||''; const n=Math.round(Number(r.rating)||0);
      return `<li class="adm-review${r.status?' is-'+r.status:''}" data-ts="${admEsc(r.ts)}"><div class="adm-review-top"><span class="adm-stars" aria-label="${n} av 5">${'★'.repeat(n)}<i>${'★'.repeat(5-n)}</i></span><span class="adm-review-date">${r.date?admDayShort(r.date):''} kl ${admTime(r.ts)}</span>${r.status==='pending'?'<span class="rx-chip rx-chip--warn">Väntar</span>':r.status==='hidden'?'<span class="rx-chip">Dold</span>':''}</div>
        ${c?`<p class="adm-review-text">${admEsc(c)}</p>`:'<p class="adm-review-text is-empty">Betyg utan kommentar.</p>'}
        ${rep?`<p class="adm-review-reply"><b>Receptionen:</b> ${admEsc(rep)}</p>`:''}
        <div class="adm-review-actions">${r.status==='pending'?'<button type="button" class="btn btn-green" data-rv="approve">Godkänn</button>':''}${r.status==='hidden'?'<button type="button" class="btn" data-rv="show">Visa i gästboken</button>':(c&&r.status!=='pending'?'<button type="button" class="btn" data-rv="hide">Dölj</button>':'')}${c&&r.status!=='hidden'?`<button type="button" class="btn" data-rv="reply">${rep?'Ändra svaret':'Svara'}</button>`:''}<button type="button" class="btn btn-danger" data-rv="delete">Ta bort</button></div></li>`; }).join('')}</ul>`:`<p class="rx-empty">${f==='granska'?'Inget väntar på granskning.':f==='dolda'?'Inga dolda omdömen.':'Inga omdömen än.'}</p>`}
    ${reviews.length?'<button type="button" class="adm-linkbtn adm-linkbtn--danger" id="revClearAll">Ta bort alla omdömen…</button>':''}`;
    admById('revModerate').onchange=async e=>{ await dbSet(REVIEW_SETTINGS_KEY,{moderate:e.target.checked}).catch(()=>{}); admDrawReviews(); };
    el.onclick=async e=>{
      const t=e.target.closest('[data-rf]'); if(t){ ADM.revFilter=t.dataset.rf; admDrawReviews(); return; }
      if(e.target.id==='revClearAll'){ if(!(await uiConfirm('Ta bort alla omdömen? Det går inte att ångra.',{okLabel:'Ta bort alla',danger:true}))) return; await dbSet(REVIEWS_KEY,[]).catch(()=>{}); renderWelcomeReviews(); admDrawReviews(); return; }
      const b=e.target.closest('[data-rv]'); if(!b) return; admReviewAction(b.closest('.adm-review').dataset.ts,b.dataset.rv);
    };
  }
  async function admReviewAction(ts,act){
    const r=(dbGet(REVIEWS_KEY,[])||[]).find(x=>x.ts===ts); if(!r) return;
    if(act==='delete'){
      if(!(await uiConfirm('Ta bort omdömet? Betyget räknas då inte heller i snittet.',{okLabel:'Ta bort',danger:true}))) return;
      const saved=_clone(r);
      await admMutate(REVIEWS_KEY,[],arr=>{ const i=arr.findIndex(x=>x.ts===ts); if(i>=0) arr.splice(i,1); });
      showUndoToast('Omdömet är borttaget',async()=>{ await admMutate(REVIEWS_KEY,[],arr=>{ if(!arr.some(x=>x.ts===ts)){ arr.push(saved); arr.sort((a,b)=>String(a.ts).localeCompare(String(b.ts))); } }); renderWelcomeReviews(); admDrawReviews(); });
    }else if(act==='reply'){
      const txt=await admTextDialog('Svar från receptionen','Visas under omdömet i gästboken. Lämna tomt för att ta bort svaret.',r.reply?.text||'',{placeholder:'T.ex. Tack för besöket! Rum 13 väntar på er nästa höst.'});
      if(txt==null) return; const t=txt.trim();
      // Svaret skapas en gång, så att ändringen blir densamma när den görs om efter en krock
      const reply=t?{text:t,by:_myCanonName(),ts:new Date().toISOString()}:null;
      await admMutate(REVIEWS_KEY,[],arr=>{ const x=arr.find(y=>y.ts===ts); if(!x) return; if(reply){ if(!x.reply||x.reply.text!==reply.text) x.reply=reply; } else delete x.reply; });
    }else{
      await admMutate(REVIEWS_KEY,[],arr=>{ const x=arr.find(y=>y.ts===ts); if(!x) return; if(act==='hide') x.status='hidden'; else delete x.status; });
    }
    renderWelcomeReviews(); admDrawReviews(); admUpdateReviewBadge();
  }
  function admPrintQrCard(){
    const url=admReviewUrl(); const base=location.origin+location.pathname.replace(/[^/]*$/,'');
    const qr=`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(url)}&size=480x480&margin=0&color=1d1f1c&bgcolor=e1ddcf`;
    const w=window.open('','_blank'); if(!w){ notify('Tillåt popup-fönster för att skriva ut kortet.','error'); return; }
    w.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Gästboken – QR-kort</title>
<link href="https://fonts.googleapis.com/css2?family=Gloock&family=Big+Shoulders+Display:wght@600&family=Newsreader:ital,wght@0,400;1,400&display=swap" rel="stylesheet">
<style>@page{size:A5 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#e1ddcf;color:#1d1f1c;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.card{width:148mm;height:209mm;padding:12mm;display:flex}.frame{flex:1;border:1.4px solid #1d1f1c;outline:0.6px solid #1d1f1c;outline-offset:-5px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;padding:12mm 10mm 9mm}
.logo{width:52mm}.kicker{font:600 11pt 'Big Shoulders Display',sans-serif;letter-spacing:.3em;text-transform:uppercase;margin:0}h1{font:400 25pt/1.1 Gloock,serif;margin:3mm 0 2mm}.lead{font:italic 12pt/1.4 Newsreader,serif;margin:0 6mm}
.qr{width:62mm;height:62mm;border:1px solid #1d1f1c;padding:3mm;background:#e1ddcf}.url{font:9pt Newsreader,serif;opacity:.7;margin:0}.foot{font:600 10pt 'Big Shoulders Display',sans-serif;letter-spacing:.25em;text-transform:uppercase;border-top:1px solid #1d1f1c;padding-top:3mm;margin:0;width:70%}</style></head>
<body><div class="card"><div class="frame"><img class="logo" src="${base}hotell-korpen.png" alt="Hotell Korpen"><div><p class="kicker">Spökhotellet Korpen</p><h1>Var god signera gästboken</h1><p class="lead">Hur var ert besök? Skanna koden och lämna ett betyg och en rad till receptionen.</p></div><img class="qr" src="${qr}" alt="QR-kod"><p class="url">${url.replace(/^https?:\/\//,'')}</p><p class="foot">Receptionen tackar</p></div></div>
<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`);
    w.document.close();
  }

  /* ============================== CHECKLISTOR ============================== */
  async function admRenderChecklistEditor(){
    const el=admById('admChecklistor'); if(!el) return;
    await dbEnsure(CHECK_KEY,null).catch(()=>{});
    const cur=admChecklists(); const edit={open:cur.open.map(t=>({t})),close:cur.close.map(t=>({t}))};
    el.innerHTML=`<p class="adm-intro">Punkterna visas under Öppna &amp; stäng. Skriv dem som ni vill ha dem i driftpärmen.</p>
      <div class="adm-grid adm-grid--2">
        <article class="rx-card"><h4 class="rx-card-title">Öppning</h4><div class="adm-list-editor" id="clOpen"></div></article>
        <article class="rx-card"><h4 class="rx-card-title">Stängning</h4><div class="adm-list-editor" id="clClose"></div></article>
      </div>
      <div class="rx-actions"><button type="button" class="btn btn-green" id="clSave">Spara checklistorna</button></div>`;
    const a=admListEditor(admById('clOpen'),edit.open,{fields:[{key:'t',ph:'Punkt',type:'input'}],addLabel:'+ Lägg till punkt',onChange:()=>{}});
    const b=admListEditor(admById('clClose'),edit.close,{fields:[{key:'t',ph:'Punkt',type:'input'}],addLabel:'+ Lägg till punkt',onChange:()=>{}});
    admById('clSave').onclick=async()=>{ const clean=l=>l.get().map(x=>(x.t||'').trim()).filter(Boolean); try{ await dbSet(CHECK_KEY,{open:clean(a),close:clean(b)}); notify('Checklistorna är sparade.','ok'); }catch(_e){ notify('Kunde inte spara. Försök igen.','error'); } };
  }

  /* ============================== ÄNDRINGSLOGG OCH ÅNGRA ==============================
     Ändringar som en admin gör för hand (inom några sekunder efter ett tryck) loggas med värdet före ändringen,
     så att de kan återställas. Personalposten (lösenord) och stora poster sparas inte i loggen. */
  const ADM_LOG_LABELS={
    [PRODUCTS_KEY]:'Produkter och priser',[WELCOME_HOTEL_NAME_KEY]:'Gästsidans rubriker',[WELCOME_HEADLINE_KEY]:'Gästsidans rubriker',[WELCOME_TAGLINE_KEY]:'Gästsidans rubriker',
    [WELCOME_TEXT_KEY]:'Säsongstexten',[WELCOME_FAQ_KEY]:'Frågor och svar',[SOCIAL_IG_KEY]:'Sociala länkar',[SOCIAL_FB_KEY]:'Sociala länkar',
    [OPENING_KEY]:'Öppettid idag',[OPEN_DATES_KEY]:'Öppetdagar',[GUEST_HIDDEN_KEY]:'Gästsidans öppettider',[SKILL_CATALOG_KEY]:'Kompetenser',[TASK_CATALOG_KEY]:'Uppgifter',
    [TASK_DESCRIPTIONS_KEY]:'Uppgiftsbeskrivningar',[WAGE_SETTINGS_KEY]:'Löneinställningar',[SHIFT_PLAN_KEY]:'Schema',[USERS_KEY]:'Personal',[CHECK_KEY]:'Checklistor',[REVIEW_SETTINGS_KEY]:'Granskning av omdömen',siteContentV1:'Sidans texter'
  };
  const ADM_NO_UNDO=new Set([USERS_KEY]);
  let _admLastInput=0;
  ['pointerdown','keydown'].forEach(ev=>document.addEventListener(ev,()=>{ _admLastInput=Date.now(); },true));
  const _admDbSet0=dbSet;
  dbSet=function(key,value){ try{ admMaybeLog(key,value); }catch(_e){} return _admDbSet0(key,value); };
  function admMaybeLog(key,value){
    if(ADM.undoing||!loggedInUser||!isAdmin||PREVIEW||PRACTICE||!(key in ADM_LOG_LABELS)||Date.now()-_admLastInput>4000) return;
    const prev=dbGet(key,null); if(JSON.stringify(prev)===JSON.stringify(value??null)) return;
    const label=ADM_LOG_LABELS[key];
    if(ADM.pendingLog&&ADM.pendingLog.label!==label) admFlushLog();
    if(!ADM.pendingLog) ADM.pendingLog={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),ts:Date.now(),by:_myCanonName(),label,changes:[]};
    const ch=ADM.pendingLog.changes.find(c=>c.key===key);
    if(ch) ch.next=_clone(value); else ADM.pendingLog.changes.push({key,prev:_clone(prev),next:_clone(value)});
    clearTimeout(ADM.logTimer); ADM.logTimer=setTimeout(admFlushLog,1500);
  }
  function admFlushLog(){
    clearTimeout(ADM.logTimer); const e=ADM.pendingLog; ADM.pendingLog=null; if(!e) return;
    e.text=e.changes.map(c=>admDescribe(c.key,c.prev,c.next)).filter(Boolean).join(' · ');
    let changes=e.changes.filter(c=>!ADM_NO_UNDO.has(c.key)).map(c=>({key:c.key,prev:c.prev}));
    if(!changes.length||JSON.stringify(changes).length>9000) changes=null;
    const entry={id:e.id,ts:e.ts,by:e.by,label:e.label,text:e.text,changes};
    admMutate(LOG_KEY,[],arr=>{ if(arr.some(x=>x.id===entry.id)) return; arr.unshift(entry); if(arr.length>60) arr.length=60; }).then(()=>{ if(ADM.panel==='logg'&&!admById('admLogg')?.hidden) admRenderLog(true); });
  }
  const admShort=(s,n=48)=>{ s=String(s??'').replace(/\s+/g,' ').trim(); return s.length>n?s.slice(0,n-1)+'…':s; };
  function admDescribe(key,prev,next){
    try{
      if(key===PRODUCTS_KEY){ const p=Array.isArray(prev)?prev:[], n=Array.isArray(next)?next:[]; const out=[];
        n.forEach(x=>{ const o=p.find(y=>y.id===x.id); if(!o) out.push(`La till ${x.name} (${x.price} kr)`); else{ if(o.name!==x.name) out.push(`${o.name} → ${x.name}`); if(Number(o.price)!==Number(x.price)) out.push(`${x.name} ${o.price} → ${x.price} kr`); if(!!o.internal!==!!x.internal) out.push(`${x.name} ${x.internal?'intern':'inte intern'}`); } });
        p.forEach(o=>{ if(!n.some(x=>x.id===o.id)) out.push(`Tog bort ${o.name}`); }); return out.join(', '); }
      if(key===OPENING_KEY) return `${prev||'Stängt'} → ${next||'Stängt'}`;
      if(key===GUEST_HIDDEN_KEY) return next?'Gästerna ser "Stängt"':'Gästerna ser öppettiderna';
      if(key===OPEN_DATES_KEY){ const f=a=>(Array.isArray(a)?a:[]).map(e=>typeof e==='string'?e:`${e.date}|${e.hours||''}`); const p=f(prev), n=f(next); const add=n.filter(x=>!p.includes(x)).map(x=>'+ '+admDayShort(x.split('|')[0])+(x.split('|')[1]?' '+x.split('|')[1]:'')); const rm=p.filter(x=>!n.includes(x)&&x.split('|')[0]>=todayStr()).map(x=>'− '+admDayShort(x.split('|')[0])); return [...add,...rm].join(', '); }
      if([WELCOME_HOTEL_NAME_KEY,WELCOME_HEADLINE_KEY,WELCOME_TAGLINE_KEY].includes(key)) return next?`"${admShort(next)}"`:'Standardtext';
      if(key===WELCOME_TEXT_KEY) return next?`"${admShort(next)}"`:'Texten borttagen';
      if(key===WELCOME_FAQ_KEY){ const n=String(next||'').trim()?String(next).trim().split(/\n{2,}/).length:0; return n?`${n} ${n===1?'fråga':'frågor'}`:'Alla frågor borttagna'; }
      if(key===SOCIAL_IG_KEY||key===SOCIAL_FB_KEY) return `${key===SOCIAL_IG_KEY?'Instagram':'Facebook'}: ${next?admShort(next,40):'ingen länk'}`;
      if(key===USERS_KEY){ const p=prev||{}, n=next||{}; const pn=Object.values(p).map(u=>u.name), nn=Object.values(n).map(u=>u.name); const out=[...nn.filter(x=>!pn.includes(x)).map(x=>'La till '+x),...pn.filter(x=>!nn.includes(x)).map(x=>'Tog bort '+x)];
        Object.values(n).forEach(u=>{ const o=Object.values(p).find(x=>x.name===u.name); if(!o) return; if(!!o.hasAccess!==!!u.hasAccess) out.push(`${u.name}: kassa ${u.hasAccess?'på':'av'}`); if(!!o.hasInslepp!==!!u.hasInslepp) out.push(`${u.name}: insläpp ${u.hasInslepp?'på':'av'}`); if(!!o.isVoluntar!==!!u.isVoluntar) out.push(`${u.name}: ${u.isVoluntar?'volontär':'inte volontär'}`); }); return out.join(', '); }
      if(key===REVIEW_SETTINGS_KEY) return next&&next.moderate?'Granskning på':'Granskning av';
      if(key==='siteContentV1'){ const p=prev||{}, n=next||{}; const diff=s=>{ const a=p[s]||{}, b=n[s]||{}; return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).length; };
        const t=diff('t'), i=diff('i'), h=diff('h'); return [t&&`${t} ${t===1?'text':'texter'}`,i&&`${i} ${i===1?'bild':'bilder'}`,h&&`${h} avsnitt visat eller dolt`].filter(Boolean).join(', '); }
    }catch(_e){}
    return '';
  }
  async function admRenderLog(skipFetch){
    const el=admById('admLogg'); if(!el) return;
    if(!skipFetch){ if(!el.innerHTML.trim()) el.innerHTML='<p class="rx-empty">Hämtar loggen…</p>'; await dbFetch(LOG_KEY,[]).catch(()=>{}); }
    const log=(dbGet(LOG_KEY,[])||[]).filter(e=>e&&e.id);
    const byDay={}; log.forEach(e=>{ const d=new Date(e.ts); const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; (byDay[k]=byDay[k]||[]).push(e); });
    const seenKeys=new Set();
    el.innerHTML=`<p class="adm-intro">De senaste ändringarna som gjorts i Hantera. Den senaste ändringen av varje sak går att ångra.</p>
      ${log.length?Object.entries(byDay).map(([day,list])=>`<h5 class="adm-log-day">${day===todayStr()?'Idag':admDayLong(day)}</h5><ul class="adm-log">${list.map(e=>{ const keys=(e.changes||[]).map(c=>c.key); const latest=keys.length&&keys.every(k=>!seenKeys.has(k)); keys.forEach(k=>seenKeys.add(k)); const canUndo=latest&&!e.undone&&e.changes;
        return `<li class="adm-log-row${e.undone?' is-undone':''}"><span class="adm-log-time">${admTime(e.ts)}</span><div><strong>${admEsc(e.label)}</strong><span>${admEsc(e.text||'Ändrad')}</span><em>${admEsc(e.by||'')}${e.undone?` · ångrad av ${admEsc(e.undone.by)} kl ${admTime(e.undone.ts)}`:''}</em></div>${canUndo?`<button type="button" class="btn" data-undo="${admEsc(e.id)}">Ångra</button>`:''}</li>`; }).join('')}</ul>`).join(''):'<p class="rx-empty">Inga ändringar loggade ännu.</p>'}`;
    el.onclick=e=>{ const b=e.target.closest('[data-undo]'); if(b) admUndo(b.dataset.undo); };
  }
  async function admUndo(id){
    const e=(dbGet(LOG_KEY,[])||[]).find(x=>x.id===id); if(!e||!e.changes) return;
    if(!(await uiConfirm(`Återställ ${e.label.toLowerCase()} till hur det var före ändringen kl ${admTime(e.ts)}?`,{okLabel:'Ångra ändringen'}))) return;
    ADM.undoing=true;
    try{ for(const c of e.changes) await _admDbSet0(c.key,c.prev); }catch(_e){ notify('Kunde inte ångra. Försök igen.','error'); ADM.undoing=false; return; }
    ADM.undoing=false;
    await admMutate(LOG_KEY,[],arr=>{ const x=arr.find(y=>y.id===id); if(x&&!x.undone) x.undone={by:_myCanonName(),ts:Date.now()}; });
    openingHours=loadOpeningHours(); queueTime=openingHours==='Stängt'?'Stängt':getEffectiveQueueTime(); guestHidden=loadGuestHidden();
    updateTopbar(); loadWelcomeHeroTexts(); loadWelcomeText(); loadWelcomeFAQ(); loadSocialLinks(); renderProductButtons(); renderWelcomePrices(); renderUpcomingDates(); window.siteText?.refresh();
    notify('Ändringen är ångrad.','ok'); admRenderLog(true);
  }

  /* ============================== ÖVNINGSLÄGE ============================== */
  async function rxStartPractice(){
    if(!(await uiConfirm('I övningsläget kan du sälja biljetter och släppa in gäster utan att något sparas på riktigt. Det gäller bara den här enheten tills du avslutar. Sidan laddas om.',{title:'Starta övningsläge?',okLabel:'Starta övningen'}))) return;
    const h=new Date().getHours(); const pad=n=>String(n).padStart(2,'0');
    const hrs=`${pad(h)}:00–${pad(Math.min(h+3,23))}:${h+3>23?'59':'00'}`;
    localStorage.setItem('practiceStoreV1',JSON.stringify({openingHoursV1:JSON.stringify(hrs),queueTimeV1:JSON.stringify({value:null,until:null})}));
    localStorage.setItem('practiceModeV1','1');
    location.reload();
  }
  async function rxStopPractice(){
    if(!(await uiConfirm('Avsluta övningen? Övningsköpen och insläppen raderas från enheten.',{okLabel:'Avsluta övningen'}))) return;
    ['practiceModeV1','practiceStoreV1'].forEach(k=>localStorage.removeItem(k));
    Object.keys(localStorage).filter(k=>k.startsWith('practice_')).forEach(k=>localStorage.removeItem(k));
    location.reload();
  }
  (function rxPracticeBanner(){
    if(!PRACTICE) return;
    document.body.classList.add('is-practice');
    const b=document.createElement('div'); b.className='rx-practice'; b.setAttribute('role','status');
    b.innerHTML='<span><b>Övningsläge</b> Köp, kö och insläpp sparas bara på den här enheten.</span><button type="button">Avsluta övningen</button>';
    b.querySelector('button').onclick=rxStopPractice; document.body.appendChild(b);
  })();

  /* ============================== STATISTIK: JÄMFÖRELSER, TIMMAR OCH EXPORT ============================== */
  function rxStatsExtraHtml(){
    const hist=loadSalesHistory(); const g=v=>Number(v.adult||0)+Number(v.child||0);
    const days=Object.entries(hist).filter(([,v])=>v&&!v._deleted&&(g(v)+Number(v.income||0))>0).sort((a,b)=>b[0].localeCompare(a[0]));
    if(!days.length) return '';
    const [ld,lv]=days[0]; const wd=admDate(ld).getDay();
    const same=days.slice(1).filter(([d])=>admDate(d).getDay()===wd).slice(0,6); const others=days.slice(1,9);
    const base=same.length>=2?same:others; const baseLbl=same.length>=2?`snittet för ${ADM_WDL[wd]}ar`:'snittet för tidigare dagar';
    const avg=f=>base.length?base.reduce((s,[,v])=>s+f(v),0)/base.length:null;
    const cmp=(val,a)=>{ if(a==null||!a) return ''; const p=Math.round((val-a)/a*100); return `<span class="rx-cmp ${p>=0?'is-up':'is-down'}">${p>=0?'+':'−'}${Math.abs(p)} %</span>`; };
    const perGuest=v=>g(v)?Number(v.income||0)/g(v):0;
    const tiles=[['Gäster',g(lv),avg(g),x=>Math.round(x)],['Intäkt',Number(lv.income||0),avg(v=>Number(v.income||0)),x=>admKr(Math.round(x))],['Per gäst',perGuest(lv),avg(perGuest),x=>admKr(Math.round(x))],['Köp',Number(lv.count||0),avg(v=>Number(v.count||0)),x=>Math.round(x)]];
    // Gäster per timme i snitt, räknat från köpens klockslag
    const buckets=new Array(24).fill(0); let nd=0;
    days.slice(0,12).forEach(([,v])=>{ const es=Array.isArray(v.entries)?v.entries:[]; if(!es.length) return; nd++; es.forEach(e=>{ const h=parseHourFromTimeStr(e.time); if(h!=null&&h>=0&&h<24) buckets[h]+=Number(e.adult||0)+Number(e.child||0); }); });
    const avgB=buckets.map(x=>nd?Math.round(x/nd*10)/10:0);
    const used=avgB.map((v,i)=>v>0?i:-1).filter(i=>i>=0);
    let hourHtml='';
    if(used.length){ const s=Math.max(0,used[0]), e=Math.min(24,used[used.length-1]+1); const slice=avgB.slice(s,e); const peak=s+slice.indexOf(Math.max(...slice));
      hourHtml=`<div class="rx-card"><p class="rx-card-kicker">Gäster per timme i snitt</p><div class="rx-chart">${svgBars24(slice,Math.max(...slice,1),80,{id:'rxHourChart',unit:'gäster',startHour:s})}</div><p class="rx-sub">Flest gäster köper biljett mellan kl ${String(peak).padStart(2,'0')} och ${String(peak+1).padStart(2,'0')}, i snitt ${String(avgB[peak]).replace('.',',')} per öppetdag (${nd} dagar).</p></div>`; }
    const next=admUpcoming(5).find(d=>d.date>todayStr()); const fc=next?admForecast(next.date,next.hours):null;
    return `<div class="rx-stats-extra">
      <div class="rx-card"><p class="rx-card-kicker">${ld===todayStr()?'Idag hittills':admDayLong(ld)} jämfört med ${baseLbl}</p><div class="rx-tiles">${tiles.map(([l,v,a,f])=>`<div class="rx-tile"><span>${l}</span><strong>${f(v)}</strong>${cmp(v,a)}${a!=null?`<small>snitt ${f(a)}</small>`:''}</div>`).join('')}</div></div>
      ${hourHtml}
      ${fc?`<div class="rx-card"><p class="rx-card-kicker">Prognos, ${admDayLong(next.date)}</p><p class="rx-forecast"><strong>ca ${fc.guests} gäster</strong> · ${admKr(fc.income)}<span>Snitt av ${fc.n} ${admEsc(fc.how)}</span></p></div>`:''}
      ${isAdmin?`<div class="rx-actions rx-export"><span class="tiny muted">Exportera för bokföringen:</span><button type="button" class="btn" onclick="rxExportDays()">Dagar (CSV)</button><button type="button" class="btn" onclick="rxExportSales()">Alla köp (CSV)</button></div>`:''}
    </div>`;
  }
  const _admRenderStats0=renderStats;
  renderStats=function(){ _admRenderStats0.apply(this,arguments); const root=admById('statsList'); if(!root||!loggedInUser) return; root.querySelector('.rx-stats-extra')?.remove(); root.insertAdjacentHTML('afterbegin',rxStatsExtraHtml()); };
  function rxCsv(rows){ return '﻿'+rows.map(r=>r.map(c=>{ const s=String(c??''); return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(';')).join('\r\n'); }
  function rxDownload(name,text){ const blob=new Blob([text],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },0); }
  function rxExportDays(){
    const hist=loadSalesHistory(); const rows=[['Datum','Veckodag','Öppettid','Vuxna','Barn','Gäster','Köp','Intäkt (kr)','Swish (kr)','Kort (kr)','Kontant (kr)','Utgifter (kr)','Resultat (kr)','Kassa räknad (kr)','Kassa skillnad (kr)','Anteckningar']];
    Object.keys(hist).filter(d=>hist[d]&&!hist[d]._deleted).sort().forEach(d=>{ const v=hist[d]; const pay=paymentTotalsForDate(d)||{}; const costs=Number(getCostsForDate(d)||0); const cl=v.closing||{};
      rows.push([d,ADM_WDL[admDate(d).getDay()],v.hours||'',v.adult||0,v.child||0,Number(v.adult||0)+Number(v.child||0),v.count||0,v.income||0,pay.Swish||0,pay.Kort||0,pay.Kontant||0,costs,Number(v.income||0)-costs,cl.cashCounted??'',cl.cashDiff??'',cl.notes||'']); });
    rxDownload(`korpen-dagar-${todayStr()}.csv`,rxCsv(rows));
  }
  function rxExportSales(){
    const hist=loadSalesHistory(); const rows=[['Datum','Tid','Summa (kr)','Vuxna','Barn','Betalning','Säljare','Produkter']];
    Object.keys(hist).filter(d=>hist[d]&&!hist[d]._deleted).sort().forEach(d=>{ (hist[d].entries||[]).forEach(e=>{ const items=(Array.isArray(e.items)?e.items:[]).map(i=>typeof i==='string'?i:`${i.qty||1} × ${i.name}`).join(', ');
      rows.push([d,e.time||'',e.sum||0,e.adult||0,e.child||0,e.payType||'',e.seller||'',items]); }); });
    rxDownload(`korpen-kop-${todayStr()}.csv`,rxCsv(rows));
  }

  /* ============================== MIN SIDA: KAN DU JOBBA? ============================== */
  const _admLoadProfile0=loadProfile;
  loadProfile=function(){ const r=_admLoadProfile0.apply(this,arguments); try{ rxRenderProfileExtras(); }catch(e){ console.error(e); } return r; };
  // Min sida byggs som ett passkort: dagens pass först, sedan kommande pass, frågan om kommande öppetdagar och sist
  // kompetenser och övningsläge. De gamla blocken från app.js (arbetstid, uppgift, kommande pass) göms.
  function rxRenderProfileExtras(){
    const box=admById('profileContainer'); if(!box||!loggedInUser) return;
    box.classList.add('rx-me-on');
    let host=admById('rxAvail');
    if(!host){ host=document.createElement('div'); host.id='rxAvail'; host.className='rx-me'; const cols=box.querySelector('.profile-columns'); box.insertBefore(host,cols||null); }
    let kick=admById('rxProfileKicker');
    if(!kick){ kick=document.createElement('p'); kick.id='rxProfileKicker'; kick.className='rx-kicker'; admById('welcomeUser')?.before(kick); }
    kick.textContent=`Personalens rum · ${admDayLong(todayStr())}`;
    const name=_myCanonName(); const today=todayStr();
    const av=dbGet(AVAIL_KEY,{})||{}; const plan=loadShiftPlan();
    // Dagens pass tas från schemat. userData.hours är en ögonblicksbild som inte nollställs när dagen byts, så den
    // används bara om den sparades idag och schemat saknar posten (äldre data).
    const ud=(userData&&userData[loggedInUser])||{}; const todayPlan=(plan[today]||{})[name];
    const fromPlan=todayPlan&&((todayPlan.hours||'').trim()||(todayPlan.task||'').trim());
    const fromUd=!todayPlan&&ud.hoursDate===today;
    const hours=fromPlan?(todayPlan.hours||'').trim():fromUd?(ud.hours||'').trim():'';
    const task=fromPlan?(todayPlan.task||'').trim():fromUd?(ud.task||'').trim():'';
    const mine=Object.keys(plan).filter(d=>d>today&&plan[d][name]&&((plan[d][name].hours||'').trim()||(plan[d][name].task||'').trim())).sort();
    // Personalen anmäler sig inte själv. Admin tilldelar pass i schemat, och den anställda bekräftar eller nekar dem här.
    const days=admUpcoming(12).filter(d=>d.date>today);
    const saidNo=days.filter(d=>(av[d.date]||{})[name]==='no'&&!mine.includes(d.date));

    // Pass som admin lagt in eller ändrat tiden på (confirmed:false) ställs som en fråga i "Kan du jobba?" tills personen svarat
    const pending=[...(shiftNeedsConfirm((plan[today]||{})[name])?[today]:[]),...mine.filter(d=>shiftNeedsConfirm(plan[d][name]))];
    const confirmed=mine.filter(d=>!pending.includes(d));

    // Dagens pass
    let tonight;
    if(hours){
      const others=Object.entries(plan[today]||{}).filter(([n,v])=>n!==name&&v&&(v.hours||v.task)).sort((a,b)=>a[0].localeCompare(b[0],'sv'));
      const desc=(loadTaskDescriptions()[task]||'').trim();
      const goKassa=/kass/i.test(task)&&(currentHasAccess||isAdmin), goIn=/insl/i.test(task)&&(currentHasInslepp||isAdmin);
      tonight=`<section class="rx-me-tonight"><p class="rx-me-kicker">Ditt pass idag</p><p class="rx-me-hours">${admEsc(hours)}</p><p class="rx-me-task">${task?admEsc(task):'Uppgiften är inte bestämd än'}</p>${desc?`<p class="rx-me-desc">${admEsc(desc)}</p>`:''}
        ${others.length?`<p class="rx-me-with"><span>Med dig idag</span>${others.map(([n,v])=>`${admEsc(n)}${v.task?` <em>${admEsc(v.task)}</em>`:''}`).join(' · ')}</p>`:''}
        ${goKassa||goIn?`<div class="rx-me-go">${goKassa?'<button type="button" class="btn btn-green" data-go-kassa>Till kassan</button>':''}${goIn?'<button type="button" class="btn btn-green" data-go-in>Till insläppet</button>':''}</div>`:''}</section>`;
    }else{
      const n=confirmed[0];
      tonight=`<section class="rx-me-tonight is-free"><p class="rx-me-kicker">Idag</p><p class="rx-me-hours">Ledig</p><p class="rx-me-task">${n?`Nästa pass: ${admDayLong(n)}${plan[n][name].hours?`, ${admEsc(plan[n][name].hours)}`:''}`:'Du har inga inlagda pass.'}</p></section>`;
    }

    // Kommande pass
    const upcoming=confirmed.length?`<section class="rx-me-block"><h3 class="rx-me-h">Dina pass</h3><ul class="rx-me-shifts">${confirmed.map(d=>{ const v=plan[d][name]; return `<li><strong>${admDayLong(d)}</strong><span class="rx-me-shift-h">${admEsc(v.hours||'Tid bestäms senare')}</span><span class="rx-me-shift-t">${v.task?admEsc(v.task):'Uppgift bestäms senare'}</span></li>`; }).join('')}</ul></section>`:'';

    // Kan du jobba? Visar bara pass som tilldelats en och som inte är bekräftade (nya pass, eller pass vars tid ändrats).
    const rows=pending.map(d=>({date:d})).sort((a,b)=>a.date.localeCompare(b.date));
    const nOpen=rows.length;
    const rowHtml=r=>{ const v=plan[r.date][name]; const changed=((av[r.date]||{})[name])==='yes';
      return `<li class="is-assigned"><div><strong>${r.date===today?'Idag':admDayLong(r.date)}</strong><span class="rx-avail-pass">${changed?'Ny tid':'Inlagt åt dig'}: <b>${admEsc(v.hours||'tid bestäms senare')}</b>${v.task?` · ${admEsc(v.task)}`:''}</span></div><div class="adm-seg" role="group" aria-label="${admDayLong(r.date)}"><button type="button" data-pconf="yes" data-date="${r.date}">Kan</button>${r.date===today?'':`<button type="button" data-pconf="no" data-date="${r.date}">Kan inte</button>`}</div>${r.date===today?'<p class="rx-avail-today">Kan du inte idag? Ring den som lägger schemat.</p>':''}</li>`; };
    const askHtml=(nOpen||saidNo.length)?`<section class="rx-me-block rx-avail${nOpen?' has-open':''}"><h3 class="rx-me-h">Kan du jobba?${nOpen?`<span class="rx-me-count">${nOpen}</span>`:''}</h3>
      ${nOpen?`<p class="rx-me-note">Du har blivit tilldelad ${nOpen===1?'ett pass':'pass'}. Svara <strong>Kan</strong> eller <strong>Kan inte</strong>. Vill du ändra ett svar efteråt, hör av dig till den som lägger schemat.</p>
      <ul class="rx-avail-list">${rows.map(rowHtml).join('')}</ul>`
      :'<p class="rx-me-note">Inga nya pass att svara på.</p>'}
      ${saidNo.length?`<p class="rx-me-no"><svg viewBox="0 0 16 18" width="11" height="12" aria-hidden="true"><rect x="2" y="8" width="12" height="9" rx="1"/><path d="M5 8V5a3 3 0 0 1 6 0v3"/></svg>Du har tackat nej: ${saidNo.map(d=>admDayShort(d.date)).join(', ')}</p>`:''}</section>`:'';

    // Kompetenser och övningsläge
    const skills=(ud.skills||[]);
    const foot=`<section class="rx-me-foot"><div><span class="rx-me-label">Kompetenser</span>${skills.length?skills.map(x=>`<span class="tag">${admEsc(x)}</span>`).join(''):'<span class="muted">Inga inlagda</span>'}</div>
      ${(currentHasAccess||currentHasInslepp||isAdmin)?`<div class="rx-practice-box"><p><strong>Övningsläge</strong> ${PRACTICE?'är på i den här enheten.':'Öva i kassan och på insläppet utan att något sparas på riktigt.'}</p><button type="button" class="btn" onclick="${PRACTICE?'rxStopPractice()':'rxStartPractice()'}">${PRACTICE?'Avsluta övningen':'Starta övning'}</button></div>`:''}</section>`;

    host.innerHTML=`<div class="rx-me-grid"><div class="rx-me-main">${tonight}${upcoming}</div><div class="rx-me-side">${askHtml}${foot}</div></div>`;

    host.onclick=async e=>{
      if(e.target.closest('[data-go-kassa]')){ selectMenu('kassa'); return; }
      if(e.target.closest('[data-go-in]')){ openRecentTicketsFull(); return; }
      // Svar på ett pass som lagts in åt en: Kan = bekräftat, Kan inte = passet tas bort och svaret blir "Kan inte".
      // Båda gäller tiden personen såg; har admin hunnit ändra tiden kommer frågan tillbaka med den nya tiden.
      const pc=e.target.closest('[data-pconf]');
      if(pc){ const d=pc.dataset.date, val=pc.dataset.pconf; const cur=(loadShiftPlan()[d]||{})[name]||{}; const seen=cur.hours||'';
        const what=`${d===today?'idag':admDayLong(d)}${seen?`, ${seen}`:''}${cur.task?` (${cur.task})`:''}`;
        const ok=val==='yes'
          ?await uiConfirm(`Du bekräftar passet ${what}. Vill du ändra dig efteråt får du höra av dig till en admin.`,{title:'Ta passet?',okLabel:'Ja, jag kan'})
          :await uiConfirm(`Du svarar att du inte kan ${what}. Passet tas bort och den som lägger schemat ser ditt svar.`,{title:'Kan inte?',okLabel:'Skicka svaret'});
        if(!ok) return;
        // Efterkontrollen gör om ändringen efter några sekunder. Ett senare svar för samma dag får inte skrivas över av ett äldre.
        const tok=Date.now()+Math.random(); (ADM.ansTok||(ADM.ansTok={}))[d]=tok;
        admMutate(AVAIL_KEY,{},o=>{ if(ADM.ansTok[d]!==tok) return; if(!o[d]) o[d]={}; o[d][name]=val; });
        admMutate(SHIFT_PLAN_KEY,{},o=>{ const x=(o[d]||{})[name]; if(!x||x.confirmed!==false||(x.hours||'')!==seen) return; if(val==='yes') x.confirmed=true; else { delete o[d][name]; if(!Object.keys(o[d]).length) delete o[d]; } });
        notify(val==='yes'?'Passet är bekräftat.':'Svaret är skickat.','ok'); rxRenderProfileExtras(); return; }
    };

    if(!ADM.availProfileFetched){ ADM.availProfileFetched=true; dbFetch(AVAIL_KEY,{}).then(()=>{ if(admById('profileContainer')?.style.display==='block') rxRenderProfileExtras(); }).catch(()=>{}); }
  }

  /* ---------- Start ---------- */
  rxNavUpdate();
  if(loggedInUser&&isAdmin&&admById('adminSettings')?.style.display==='block') admOpen(ADM.panel,{keepScroll:true});
  setTimeout(rxBeat,2500);
