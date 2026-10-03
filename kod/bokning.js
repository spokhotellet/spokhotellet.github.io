/* ============================== BOKNING ==============================
   Laddas efter admin.js och före guest.js. Gäster bokar en halvtimme en öppen dag; varje halvtimme tar emot
   ett visst antal sällskap (bookingSettingsV1). Bokningen bär bara ett namn och betalas på plats.
   Gästen bokar och avbokar via serverns åtgärder (addBooking, cancelBooking i Kod.gs), eftersom gäster
   inte får skriva i den delade datan. Personalen markerar anlända och tar bort via bookingStaff.
   Delar:
     - gästsidan: bokningssidan index.html?boka, knapparna på startsidan och gästens egna bokningar (myBookingsV1)
     - kassan: kvällens bokningar över produktknapparna; ett tryck lägger sällskapet i kassan
     - Hantera: kort på Översikt och panelen Bokningar (inställningar, tider, kommande dagar)
   Gula tider är populära (vald i Hantera, med förslag från kassans statistik) eller har en plats kvar.
   Röda är fullbokade. Tomma tider visas neutrala; sidan säger aldrig hur många som har bokat. */

  const BK_KEY='bookingsV1', BK_SET_KEY='bookingSettingsV1', BK_MINE_LS='myBookingsV1';
  const BK_DEFAULTS={enabled:false,limit:3,maxPersons:6,closeMin:60,limits:{},off:[],popular:[]};
  const BK={date:'',slot:'',adult:2,child:0,busy:false,fetchedAt:0,setTry:Date.now(),kassaId:null,kassaShowAll:false,tidied:''};
  const bkEsc=s=>escapeHtml(String(s??''));
  const BK_WD=['Söndag','Måndag','Tisdag','Onsdag','Torsdag','Fredag','Lördag'];
  const BK_WDS=['Sön','Mån','Tis','Ons','Tor','Fre','Lör'];
  const BK_MON=['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];
  const bkDate=d=>new Date(d+'T12:00:00');
  const bkDayLong=d=>{ const x=bkDate(d); return `${BK_WD[x.getDay()]} ${x.getDate()} ${BK_MON[x.getMonth()]}`; };
  const bkDayShort=d=>{ const x=bkDate(d); return `${BK_WDS[x.getDay()]} ${x.getDate()}/${x.getMonth()+1}`; };
  const bkMin=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
  const bkHHMM=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const bkSlotEnd=s=>bkHHMM(bkMin(s)+30);
  const bkParty=b=>[b.adult?`${b.adult} ${b.adult>1?'vuxna':'vuxen'}`:'',b.child?`${b.child} barn`:''].filter(Boolean).join(', ');
  const bkPartyShort=b=>[b.adult?`${b.adult} v`:'',b.child?`${b.child} b`:''].filter(Boolean).join(' + ');
  const bkPeople=b=>Number(b.adult||0)+Number(b.child||0);

  /* ---------- Data ---------- */
  function bkSettings(){ const s=dbGet(BK_SET_KEY,null)||{}; const o=_clone(BK_DEFAULTS); Object.keys(BK_DEFAULTS).forEach(k=>{ if(s[k]!==undefined&&s[k]!==null) o[k]=s[k]; }); return o; }
  function bkAll(){ const v=dbGet(BK_KEY,{}); return v&&typeof v==='object'&&!Array.isArray(v)?v:{}; }
  function bkDay(date){ const d=bkAll()[date]; return Array.isArray(d)?d:[]; }
  // Ändrar bara den lokala kopian; servern har redan gjort ändringen genom en åtgärd
  function bkLocal(apply){ const all=bkAll(); apply(all); _db.cache.set(BK_KEY,all); _db.loaded.add(BK_KEY); }
  async function bkFetch(){ BK.fetchedAt=Date.now(); try{ await dbFetch(BK_KEY,{}); }catch(_e){} }

  // "18:00–21:00" → 18:00, 18:30 … 20:30 (samma regel som servern)
  function bkSlots(hours){
    const m=String(hours||'').match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/); if(!m) return [];
    const start=Number(m[1])*60+Number(m[2]); let end=Number(m[3])*60+Number(m[4]); if(end<=start) end=24*60;
    const out=[]; for(let t=start;t+30<=end;t+=30) out.push(bkHHMM(t)); return out;
  }
  function bkHours(date){
    if(date===todayStr()){ const oh=loadOpeningHours(); if(bkSlots(oh).length) return oh; }
    const e=loadOpenDates().find(x=>x&&typeof x==='object'&&x.date===date); return e?String(e.hours||''):'';
  }
  function bkLimit(slot,st=bkSettings()){ return Number((st.limits||{})[slot])||Number(st.limit)||3; }
  function bkTooLate(date,slot,st=bkSettings()){ if(date<todayStr()) return true; if(date>todayStr()) return false; const n=new Date(); return n.getHours()*60+n.getMinutes()+Number(st.closeMin||0)>bkMin(slot); }
  function bkSlotState(date,slot,st=bkSettings()){
    const taken=bkDay(date).filter(b=>b.slot===slot).length, left=bkLimit(slot,st)-taken;
    return {full:left<=0, few:left===1, popular:(st.popular||[]).includes(slot), left};
  }
  // Dagar som gästen kan boka: öppna, med öppettid, inte avstängda och med minst en tid kvar
  function bkDates(){
    const st=bkSettings(); const today=todayStr();
    const dates=new Set(loadOpenDates().map(e=>typeof e==='string'?e:e&&e.date).filter(d=>d&&d>=today));
    if(bkSlots(loadOpeningHours()).length) dates.add(today);
    return [...dates].sort().filter(d=>!(st.off||[]).includes(d)&&bkSlots(bkHours(d)).some(s=>!bkTooLate(d,s,st))).slice(0,10);
  }

  /* ---------- Övningsläget ----------
     Bokningarna ligger då i enhetens övningslager (practiceStoreV1, se PRACTICE_KEYS i app.js) och når aldrig servern.
     Första gången en dag fylls den med påhittade bokningar runt nuvarande tid, så att kassan och Hantera går att öva på.
     Även en bokning som görs på gästsidan stannar i övningslagret. */
  const BK_FAKE_NAMES=['Andersson','Lindqvist','Öberg','Nyström','Berg','Holm','Sjöberg','Ek','Lund','Wallin'];
  function bkPracticeRead(){ try{ const v=JSON.parse(_practiceStore()[BK_KEY]||'null'); return v&&typeof v==='object'&&!Array.isArray(v)?v:{}; }catch(_e){ return {}; } }
  function bkPracticeWrite(all){ const st=_practiceStore(); st[BK_KEY]=JSON.stringify(all); try{ localStorage.setItem('practiceStoreV1',JSON.stringify(st)); }catch(_e){} }
  function bkFakeCode(day){ const used=new Set(day.map(b=>b.code)); let c; do{ c=101+Math.floor(Math.random()*899); }while(used.has(c)); return c; }
  function bkPracticeSeed(){
    const today=todayStr(); const all=bkPracticeRead(); if(Array.isArray(all[today])) return;
    const n=new Date(); const base=Math.floor((n.getHours()*60+n.getMinutes())/30)*30;
    // [minuter från nu, redan kommit]: en som har kommit, en sen, två just nu och resten senare
    const plan=[[-60,true],[-60,false],[0,false],[0,false],[30,false],[60,false],[90,false],[90,false],[120,false]];
    const day=[];
    plan.forEach(([off,arrived],i)=>{ const m=Math.min(23*60+30,Math.max(0,base+off));
      day.push({id:'bovn'+i+Date.now().toString(36),code:bkFakeCode(day),slot:bkHHMM(m),adult:1+Math.floor(Math.random()*3),child:Math.random()<0.4?1+Math.floor(Math.random()*2):0,name:BK_FAKE_NAMES[i],ts:new Date(Date.now()-(10-i)*3600e3).toISOString(),...(arrived?{arrived:true}:{})}); });
    all[today]=day; bkPracticeWrite(all);
  }
  function bkPracticeOp(op,date,id){
    const all=bkPracticeRead(); const day=Array.isArray(all[date])?all[date]:[];
    if(op==='delete') all[date]=day.filter(b=>b.id!==id);
    else day.forEach(b=>{ if(b.id!==id) return; if(op==='arrived') b.arrived=true; if(op==='unarrived') delete b.arrived; });
    bkPracticeWrite(all);
  }
  function bkPracticeBook(p){
    const all=bkPracticeRead(); const day=Array.isArray(all[p.date])?all[p.date]:[];
    const b={id:'bovn'+Date.now().toString(36),code:bkFakeCode(day),slot:p.slot,adult:p.adult,child:p.child,name:p.name,key:'ovning',ts:new Date().toISOString()};
    day.push(b); all[p.date]=day; bkPracticeWrite(all);
    return {ok:true,booking:{...b,date:p.date}};
  }
  if(PRACTICE) bkPracticeSeed();

  /* ---------- Gästens egna bokningar ---------- */
  function bkMine(){ let a=[]; try{ a=JSON.parse(localStorage.getItem(BK_MINE_LS)||'[]'); }catch(_e){} return (Array.isArray(a)?a:[]).filter(b=>b&&b.date>=todayStr()); }
  function bkSaveMine(list){ try{ localStorage.setItem(BK_MINE_LS,JSON.stringify(list)); }catch(_e){} }

  /* ============================== GÄSTSIDAN ============================== */
  // Bokningen är en egen sida: index.html?boka. Där döljs resten av gästsidan (html.bk-page i app.css),
  // och menyns länkar leder tillbaka till startsidan. På startsidan finns bara knapparna hit.
  const BK_PAGE=new URLSearchParams(location.search).has('boka');
  function bkSetupPage(){
    if(!BK_PAGE) return;
    document.documentElement.classList.add('bk-page');
    document.title='Boka besök – Spökhotellet Korpen';
    const home=location.pathname;
    document.querySelectorAll('#ghLinks a[href^="#"], .gh-brand, .gh-status, .gh-footer a[href^="#"]').forEach(a=>a.setAttribute('href',home+a.getAttribute('href')));
    document.querySelectorAll('.bk-back').forEach(a=>a.setAttribute('href',home));
    document.querySelectorAll('#ghLinks .js-book-link').forEach(a=>a.setAttribute('aria-current','page'));
    window.scrollTo(0,0);
  }
  const bkGuestEls=()=>({sec:document.getElementById('boka'),card:document.getElementById('bkCard')});
  function bkGuestToggle(){
    const st=bkSettings(); const on=!!st.enabled&&bkDates().length>0;
    const {sec}=bkGuestEls(); if(sec) sec.hidden=!BK_PAGE;
    document.querySelectorAll('.js-book-link').forEach(a=>{ a.hidden=!on; });
    return on;
  }
  function bkRenderGuest(){
    const {card}=bkGuestEls(); if(!card) return;
    const on=bkGuestToggle();
    if(card.dataset.view==='confirm') return; // bekräftelsen ligger kvar tills gästen stänger den
    if(!card.querySelector('#bkForm')) bkBuildForm(card);
    bkRenderMine();
    const form=card.querySelector('#bkForm'); form.hidden=!on;
    const closed=card.querySelector('#bkClosed'); if(closed) closed.hidden=on;
    if(!on) return;
    const dates=bkDates();
    if(!dates.includes(BK.date)){ BK.date=dates[0]; BK.slot=''; }
    bkRenderDays(dates); bkRenderTimes(); bkRenderParty(); bkRenderSummary();
  }
  function bkBuildForm(card){
    card.innerHTML=`<div class="bk-head"><span>Hotell Korpen</span><span>Reservationsbok</span></div>
      <div class="bk-mine" id="bkMine" hidden></div>
      <p class="bk-closed" id="bkClosed" hidden>Det finns inga tider att boka just nu. Ni är välkomna utan bokning när vi har öppet.</p>
      <form class="bk-form" id="bkForm" novalidate autocomplete="off">
        <fieldset class="bk-step"><legend><span class="bk-no">1</span>Vilken dag?</legend><div class="bk-days" id="bkDays" role="group" aria-label="Dag"></div></fieldset>
        <fieldset class="bk-step"><legend><span class="bk-no">2</span>Vilken tid?</legend>
          <p class="bk-legend"><span class="bk-key bk-key--hot">Populär tid / få platser kvar</span><span class="bk-key bk-key--full">Fullbokat</span></p>
          <div id="bkTimes"></div></fieldset>
        <fieldset class="bk-step"><legend><span class="bk-no">3</span>Hur många kommer?</legend><div class="bk-party" id="bkParty"></div></fieldset>
        <div class="bk-step"><label class="bk-legend-label" for="bkName"><span class="bk-no">4</span>Namn på bokningen</label>
          <input class="bk-name" id="bkName" name="name" maxlength="40" autocomplete="family-name" placeholder="Till exempel Andersson" enterkeyhint="done">
          <p class="bk-hint">Ett efternamn räcker. Namnet tas bort när dagen är slut.</p></div>
        <p class="bk-summary" id="bkSummary" aria-live="polite"></p>
        <p class="bk-error" id="bkError" role="alert" hidden></p>
        <div class="bk-foot"><button type="submit" class="gh-btn gh-btn-small" id="bkSubmit">Boka tiden</button><p class="bk-note">Betalning sker på plats i receptionen.</p></div>
      </form>`;
    const form=card.querySelector('#bkForm');
    form.addEventListener('submit',e=>{ e.preventDefault(); bkSubmit(); });
    form.addEventListener('click',e=>{
      const d=e.target.closest('[data-bk-date]'); if(d){ BK.date=d.dataset.bkDate; BK.slot=''; bkHideError(); bkRenderDays(bkDates()); bkRenderTimes(); bkRenderSummary(); if(Date.now()-BK.fetchedAt>30000) bkFetch().then(()=>{ bkRenderTimes(); bkRenderSummary(); }); return; }
      const s=e.target.closest('[data-bk-slot]'); if(s&&!s.disabled){ BK.slot=s.dataset.bkSlot; bkHideError(); bkRenderTimes(); bkRenderSummary(); return; }
      const p=e.target.closest('[data-bk-inc]'); if(p){ bkStep(p.dataset.bkInc,Number(p.dataset.d)); }
    });
    card.querySelector('#bkName').addEventListener('input',()=>{ bkHideError(); bkRenderSummary(); });
    card.addEventListener('click',e=>{ const b=e.target.closest('[data-bk-mine]'); if(!b) return; const m=bkMine().find(x=>x.id===b.dataset.id); if(!m) return; if(b.dataset.bkMine==='show') bkShowConfirm(m); else bkCancel(m); });
  }
  function bkRenderMine(){
    const el=document.getElementById('bkMine'); if(!el) return;
    const mine=bkMine().sort((a,b)=>(a.date+a.slot).localeCompare(b.date+b.slot));
    el.hidden=!mine.length;
    el.innerHTML=mine.length?`<p class="bk-mine-title">${mine.length>1?'Era bokningar':'Er bokning'}</p>${mine.map(m=>`<div class="bk-mine-row"><span><strong>${bkEsc(bkDayLong(m.date))} kl ${bkEsc(m.slot)}</strong><small>N:o ${bkEsc(m.code)} · ${bkEsc(m.name)} · ${bkEsc(bkParty(m))}</small></span><span class="bk-mine-tools"><button type="button" class="bk-link" data-bk-mine="show" data-id="${bkEsc(m.id)}">Visa</button><button type="button" class="bk-link" data-bk-mine="cancel" data-id="${bkEsc(m.id)}">Avboka</button></span></div>`).join('')}`:'';
  }
  function bkRenderDays(dates){
    const el=document.getElementById('bkDays'); if(!el) return;
    el.innerHTML=dates.map(d=>{ const x=bkDate(d); const today=d===todayStr(); return `<button type="button" class="bk-day" data-bk-date="${d}" aria-pressed="${d===BK.date}"><span>${today?'Idag':BK_WDS[x.getDay()]}</span><strong>${x.getDate()}</strong><small>${BK_MON[x.getMonth()].slice(0,3)}</small></button>`; }).join('');
  }
  function bkRenderTimes(){
    const el=document.getElementById('bkTimes'); if(!el||!BK.date) return;
    const st=bkSettings(); const hours=bkHours(BK.date);
    const slots=bkSlots(hours).filter(s=>!bkTooLate(BK.date,s,st));
    if(BK.slot&&(!slots.includes(BK.slot)||bkSlotState(BK.date,BK.slot,st).full)) BK.slot='';
    const groups=[['Förmiddag',s=>bkMin(s)<12*60],['Eftermiddag',s=>bkMin(s)>=12*60&&bkMin(s)<17*60],['Kväll',s=>bkMin(s)>=17*60]];
    const html=groups.map(([label,f])=>{ const list=slots.filter(f); if(!list.length) return '';
      return `<div class="bk-group"><p class="bk-group-label">${label}</p><div class="bk-slots">${list.map(s=>{ const x=bkSlotState(BK.date,s,st); const cls=x.full?' is-full':((x.popular||x.few)?' is-hot':''); const note=x.full?'Fullbokat':x.few?'Få platser kvar':x.popular?'Populär tid':'';
        return `<button type="button" class="bk-slot${cls}" data-bk-slot="${s}" aria-pressed="${s===BK.slot}"${x.full?' disabled':''}${note?` aria-label="${s}, ${note.toLowerCase()}"`:''}>${s}${note&&!x.full?'<i aria-hidden="true">●</i>':''}</button>`; }).join('')}</div></div>`; }).join('');
    el.innerHTML=html||'<p class="bk-hint">Inga fler tider idag.</p>';
  }
  function bkRenderParty(){
    const el=document.getElementById('bkParty'); if(!el) return;
    const max=Number(bkSettings().maxPersons)||6; const tot=BK.adult+BK.child;
    const row=(k,label,v,min)=>`<div class="bk-count"><span>${label}</span><div class="bk-stepper"><button type="button" data-bk-inc="${k}" data-d="-1" aria-label="En ${label.toLowerCase()} färre"${v<=min?' disabled':''}>−</button><output aria-live="polite">${v}</output><button type="button" data-bk-inc="${k}" data-d="1" aria-label="En ${label.toLowerCase()} till"${tot>=max?' disabled':''}>+</button></div></div>`;
    el.innerHTML=row('adult','Vuxna',BK.adult,0)+row('child','Barn',BK.child,0)+(tot>=max?`<p class="bk-hint">Fler än ${max}? Hör av er till receptionen, så ordnar vi det. <a href="#kontakt">Kontakt ↓</a></p>`:'');
  }
  function bkStep(k,d){ const max=Number(bkSettings().maxPersons)||6; const v=BK[k]+d; if(v<0||(d>0&&BK.adult+BK.child>=max)) return; BK[k]=v; bkHideError(); bkRenderParty(); bkRenderSummary(); }
  function bkRenderSummary(){
    const el=document.getElementById('bkSummary'); if(!el) return;
    const n=BK.adult+BK.child;
    el.textContent=BK.date&&BK.slot&&n?`${bkDayLong(BK.date)} kl ${BK.slot}–${bkSlotEnd(BK.slot)}, ${bkParty(BK)}.`:'';
  }
  function bkShowError(msg){ const el=document.getElementById('bkError'); if(el){ el.textContent=msg; el.hidden=false; } }
  function bkHideError(){ const el=document.getElementById('bkError'); if(el) el.hidden=true; }
  const BK_ERRORS={
    full:'Tiden hann bli fullbokad. Välj en annan tid.',
    too_late:'Den tiden går inte längre att boka. Välj en senare tid.',
    closed:'Bokningen är stängd för den dagen. Ni är välkomna utan bokning.',
    busy:'Många bokar just nu. Försök igen om en liten stund.',
    no_name:'Skriv ett namn på bokningen.',
    bad_party:'Kontrollera hur många ni är.'
  };
  async function bkSubmit(){
    if(BK.busy) return;
    const name=(document.getElementById('bkName')?.value||'').replace(/\s+/g,' ').trim();
    if(!BK.date) return bkShowError('Välj en dag.');
    if(!BK.slot){ bkShowError('Välj en tid.'); document.getElementById('bkTimes')?.querySelector('button:not([disabled])')?.focus(); return; }
    if(BK.adult+BK.child<1) return bkShowError('Ni behöver vara minst en person.');
    if(!name){ bkShowError(BK_ERRORS.no_name); document.getElementById('bkName')?.focus(); return; }
    BK.busy=true; const btn=document.getElementById('bkSubmit'); if(btn){ btn.disabled=true; btn.textContent='Bokar …'; }
    let res=null;
    try{
      res=PREVIEW?{ok:true,booking:{id:'bpreview',code:101,date:BK.date,slot:BK.slot,adult:BK.adult,child:BK.child,name,key:''}}
        :PRACTICE?bkPracticeBook({date:BK.date,slot:BK.slot,adult:BK.adult,child:BK.child,name})
        :await apiAction('addBooking',{date:BK.date,slot:BK.slot,adult:String(BK.adult),child:String(BK.child),name});
    }catch(_e){ res=null; }
    BK.busy=false; if(btn){ btn.disabled=false; btn.textContent='Boka tiden'; }
    if(!res){ bkShowError('Kunde inte nå receptionen. Kontrollera anslutningen och försök igen.'); return; }
    if(!res.ok){
      bkShowError(BK_ERRORS[res.error]||'Bokningen gick inte igenom. Försök igen, eller kom förbi utan bokning.');
      if(res.error==='full'||res.error==='too_late'){ await bkFetch(); bkRenderTimes(); bkRenderSummary(); }
      return;
    }
    const b={...res.booking,date:res.booking.date||BK.date};
    bkSaveMine([...bkMine().filter(x=>x.id!==b.id),b]);
    bkLocal(all=>{ (all[b.date]=Array.isArray(all[b.date])?all[b.date]:[]).push({slot:b.slot}); });
    const inp=document.getElementById('bkName'); if(inp) inp.value='';
    BK.slot='';
    bkShowConfirm(b,true);
  }
  function bkShowConfirm(b,fresh=false){
    const {card}=bkGuestEls(); if(!card) return;
    card.dataset.view='confirm';
    const form=card.querySelector('#bkForm'), mine=card.querySelector('#bkMine'), closed=card.querySelector('#bkClosed');
    [form,mine,closed].forEach(x=>{ if(x) x.hidden=true; });
    card.querySelector('.bk-confirm')?.remove();
    const box=document.createElement('div'); box.className='bk-confirm'; box.setAttribute('tabindex','-1');
    box.innerHTML=`<p class="bk-confirm-kicker">Bokningsbekräftelse</p>
      <p class="bk-confirm-no">Bokning N:o <strong>${bkEsc(b.code)}</strong></p>
      <dl class="bk-confirm-list">
        <div><dt>Dag</dt><dd>${bkEsc(bkDayLong(b.date))}</dd></div>
        <div><dt>Tid</dt><dd>${bkEsc(b.slot)}–${bkEsc(bkSlotEnd(b.slot))}</dd></div>
        <div><dt>Sällskap</dt><dd>${bkEsc(bkParty(b))}</dd></div>
        <div><dt>Namn</dt><dd>${bkEsc(b.name)}</dd></div>
      </dl>
      <span class="gh-regcard-stamp bk-stamp" aria-hidden="true">Bokad</span>
      <p class="bk-confirm-text">Er tid är reserverad. Kom till receptionen vid er tid och visa kortet. Betalning sker på plats.</p>
      <div class="bk-keep" role="group" aria-label="Spara bokningen">
        <button type="button" class="bk-keep-btn" data-bk-ics><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="13" rx="1"/><path d="M2.5 8h15M6.5 2v4M13.5 2v4"/></svg>Lägg till i kalendern</button>
        <button type="button" class="bk-keep-btn" data-bk-img><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="1"/><circle cx="7.5" cy="8" r="1.6"/><path d="M3 15l4.5-4.5 3 3 2.5-2.5 4 4"/></svg>Spara som bild</button>
      </div>
      <p class="bk-hint">Kalendern påminner er två timmar innan. Bokningen finns också kvar i den här webbläsaren. <a href="${bkEsc(bkGoogleUrl(b))}" target="_blank" rel="noopener">Google Kalender ↗</a></p>
      <div class="bk-foot"><button type="button" class="gh-btn gh-btn-small" data-bk-close>Klar</button><button type="button" class="bk-link" data-bk-cancel>Avboka</button></div>`;
    card.appendChild(box);
    box.querySelector('[data-bk-close]').onclick=()=>bkCloseConfirm();
    box.querySelector('[data-bk-cancel]').onclick=()=>bkCancel(b);
    box.querySelector('[data-bk-ics]').onclick=()=>bkSaveIcs(b);
    box.querySelector('[data-bk-img]').onclick=e=>bkSaveImage(b,e.currentTarget);
    if(fresh){ try{ KorpenSound.stamp(); }catch(_e){} uiVibrate?.(30); }
    box.scrollIntoView({block:'nearest',behavior:'smooth'}); setTimeout(()=>box.focus({preventScroll:true}),50);
  }
  function bkCloseConfirm(){ const {card}=bkGuestEls(); if(!card) return; delete card.dataset.view; card.querySelector('.bk-confirm')?.remove(); bkRenderGuest(); }
  async function bkCancel(b){
    if(!(await uiConfirm(`Avboka ${bkDayLong(b.date).toLowerCase()} kl ${b.slot}?`,{okLabel:'Avboka',cancelLabel:'Behåll',danger:true}))) return;
    let res=null;
    try{ res=PREVIEW?{ok:true}:PRACTICE?(bkPracticeOp('delete',b.date,b.id),{ok:true}):await apiAction('cancelBooking',{date:b.date,id:b.id,key:b.key||''}); }catch(_e){ res=null; }
    if(!res){ notify('Kunde inte nå receptionen. Försök igen.','error'); return; }
    if(!res.ok&&res.error!=='not_found'){ notify('Avbokningen gick inte igenom. Försök igen.','error'); return; }
    bkSaveMine(bkMine().filter(x=>x.id!==b.id));
    if(res.ok) bkLocal(all=>{ const d=all[b.date]; if(Array.isArray(d)){ const i=d.findIndex(x=>x.id===b.id||(!x.id&&x.slot===b.slot)); if(i>=0) d.splice(i,1); } });
    notify(res.ok?'Bokningen är avbokad.':'Bokningen fanns inte längre kvar hos receptionen.','ok');
    bkCloseConfirm();
  }
  /* ---------- Spara bokningen: kalender och bild ---------- */
  const bkStamp=(date,slot)=>date.replace(/-/g,'')+'T'+slot.replace(':','')+'00';
  const bkEndSlot=b=>{ const e=bkSlotEnd(b.slot); return e>='24:00'?'23:59':e; };
  function bkEventText(b){ return {title:`Spökhotellet Korpen – bokning N:o ${b.code}`,details:`${bkParty(b)}, ${b.name}. Kom till receptionen vid er tid och visa bokningen. Betalning sker på plats.`}; }
  function bkGoogleUrl(b){ const t=bkEventText(b); return 'https://calendar.google.com/calendar/render?'+new URLSearchParams({action:'TEMPLATE',text:t.title,dates:`${bkStamp(b.date,b.slot)}/${bkStamp(b.date,bkEndSlot(b))}`,ctz:'Europe/Stockholm',details:t.details}); }
  function bkDownload(blob,name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },4000); }
  const bkIcsEsc=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/([,;])/g,'\\$1');
  const bkIcsFold=l=>l.length<=60?l:l.match(/.{1,60}/gu).join('\r\n ');
  // Kalenderfil med påminnelse två timmar innan. Tiden anges utan tidszon och tolkas som telefonens egen tid.
  function bkSaveIcs(b){
    const t=bkEventText(b); const now=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
    const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Spökhotellet Korpen//Bokning//SV','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
      `UID:${b.id}@spokhotelletkorpen`,`DTSTAMP:${now}`,`DTSTART:${bkStamp(b.date,b.slot)}`,`DTEND:${bkStamp(b.date,bkEndSlot(b))}`,
      `SUMMARY:${bkIcsEsc(t.title)}`,`DESCRIPTION:${bkIcsEsc(t.details)}`,
      'BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:-PT2H',`DESCRIPTION:${bkIcsEsc('Om två timmar: Spökhotellet Korpen')}`,'END:VALARM','END:VEVENT','END:VCALENDAR'].map(bkIcsFold).join('\r\n');
    // Safari på iPhone öppnar kalendern direkt från en data-länk; övriga laddar ner filen och öppnar den i kalendern
    if(/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)){ location.href='data:text/calendar;charset=utf-8,'+encodeURIComponent(ics); return; }
    bkDownload(new Blob([ics],{type:'text/calendar;charset=utf-8'}),`korpen-bokning-${b.code}.ics`);
  }
  function bkWrap(x,text,maxW){ const words=String(text).split(' '); const lines=[]; let line=''; words.forEach(w=>{ const t=line?line+' '+w:w; if(x.measureText(t).width>maxW&&line){ lines.push(line); line=w; } else line=t; }); if(line) lines.push(line); return lines; }
  // Bokningskortet som bild (1080 × 1440), ritat efter samma mall som kortet på sidan
  async function bkCardCanvas(b){
    const fonts=['600 28px "Big Shoulders Display"','700 52px "Big Shoulders Display"','400 92px Gloock','40px "Cutive Mono"','36px Newsreader'];
    try{ await Promise.race([Promise.all(fonts.map(f=>document.fonts.load(f))),new Promise(r=>setTimeout(r,2000))]); }catch(_e){}
    const W=1080,H=1440,c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d');
    const sp=px=>{ if('letterSpacing' in x) x.letterSpacing=px+'px'; };
    const L=70,T=80,R=W-70,B=H-140,P=L+70,PR=R-70,ink='#1d1f1c',soft='#4d524b';
    x.fillStyle='#182024'; x.fillRect(0,0,W,H);
    x.save(); x.shadowColor='rgba(0,0,0,0.5)'; x.shadowBlur=50; x.shadowOffsetY=20; x.fillStyle='#e3dfd1'; x.fillRect(L,T,R-L,B-T); x.restore();
    x.fillStyle='rgba(31,61,107,0.07)'; for(let y=T+66;y<B;y+=48) x.fillRect(L,y,R-L,2);
    x.fillStyle='#2a3538'; x.fillRect(L,T,R-L,16);
    x.font='600 28px "Big Shoulders Display", "Arial Narrow", sans-serif'; sp(5); x.fillStyle=soft;
    x.textAlign='left'; x.fillText('HOTELL KORPEN',P,T+100); x.textAlign='right'; x.fillText('RESERVATIONSBOK',PR,T+100);
    x.fillStyle='rgba(29,31,28,0.45)'; x.fillRect(P,T+122,PR-P,2);
    x.textAlign='left'; x.fillStyle=soft; x.fillText('BOKNINGSBEKRÄFTELSE',P,T+200);
    sp(0); x.fillStyle=ink; x.font='400 92px Gloock, Georgia, serif'; x.fillText(`Bokning N:o ${b.code}`,P,T+300);
    const rows=[['DAG',bkDayLong(b.date)],['TID',`${b.slot}–${bkSlotEnd(b.slot)}`],['SÄLLSKAP',bkParty(b)],['NAMN',b.name]];
    let y=T+410;
    rows.forEach(([k,v])=>{
      x.font='600 26px "Big Shoulders Display", "Arial Narrow", sans-serif'; sp(4); x.fillStyle=soft; x.fillText(k,P,y);
      sp(0); let fs=40; do{ x.font=`${fs}px "Cutive Mono", "Courier New", monospace`; fs-=2; }while(fs>22&&x.measureText(String(v)).width>PR-P-250);
      x.fillStyle=ink; x.fillText(String(v),P+250,y);
      x.setLineDash([3,7]); x.strokeStyle='rgba(29,31,28,0.4)'; x.lineWidth=2; x.beginPath(); x.moveTo(P,y+32); x.lineTo(PR,y+32); x.stroke(); x.setLineDash([]);
      y+=92;
    });
    x.font='36px Newsreader, Georgia, serif'; x.fillStyle=ink;
    const lines=bkWrap(x,'Er tid är reserverad. Kom till receptionen vid er tid och visa kortet. Betalning sker på plats.',PR-P);
    lines.forEach((l,i)=>x.fillText(l,P,y+50+i*54));
    // Stämpeln i den tomma ytan under texten, snett till höger
    x.save(); x.translate(PR-150,Math.min(B-110,y+50+lines.length*54+120)); x.rotate(-4*Math.PI/180); x.globalAlpha=0.85; x.strokeStyle='#8a3b36';
    x.lineWidth=5; x.strokeRect(-118,-46,236,92); x.lineWidth=2; x.strokeRect(-108,-36,216,72);
    x.fillStyle='#8a3b36'; x.font='700 52px "Big Shoulders Display", sans-serif'; sp(8); x.textAlign='center'; x.textBaseline='middle'; x.fillText('BOKAD',4,3); x.restore();
    sp(0); x.textAlign='center'; x.textBaseline='alphabetic'; x.fillStyle='#dde3dc'; x.font='400 46px Gloock, Georgia, serif'; x.fillText('Spökhotellet Korpen',W/2,H-62);
    return c;
  }
  async function bkSaveImage(b,btn){
    if(btn) btn.disabled=true;
    try{
      const c=await bkCardCanvas(b); const blob=await new Promise(r=>c.toBlob(r,'image/png')); if(!blob) throw new Error('ingen bild');
      const name=`korpen-bokning-${b.code}.png`; const file=new File([blob],name,{type:'image/png'});
      // På mobilen öppnas delningsmenyn (där finns Spara bild); på datorn laddas bilden ner
      if(matchMedia('(pointer: coarse)').matches&&navigator.canShare&&navigator.canShare({files:[file]})){
        try{ await navigator.share({files:[file],title:'Bokning – Spökhotellet Korpen'}); }catch(e){ if(!e||e.name!=='AbortError') bkDownload(blob,name); }
      }else bkDownload(blob,name);
    }catch(_e){ notify('Kunde inte skapa bilden. Ta en skärmbild av kortet i stället.','error'); }
    finally{ if(btn) btn.disabled=false; }
  }

  async function bkInitGuest(){
    if(!document.getElementById('boka')) return;
    bkSetupPage();
    // Inställningarna och bokningarna kommer med i sidans startanrop (BOOT_KEYS i app.js): det senast sparade visas direkt,
    // anropet provas flera gånger, och renderUpcomingDates ritar om kortet när svaret kommit (se längst ned).
    bkRenderGuest();
  }
  // Nådde inget svar fram alls provar gästsidan igen var 20:e sekund, så att knapparna inte försvinner för hela besöket
  function bkRetrySettings(){
    if(loggedInUser||document.hidden||_db.serverLoaded.has(BK_SET_KEY)||Date.now()-(BK.setTry||0)<20000) return;
    BK.setTry=Date.now();
    Promise.all([dbFetch(BK_SET_KEY,null),bkFetch()]).then(()=>bkRenderGuest()).catch(()=>{});
  }

  /* ============================== KASSAN ============================== */
  const bkKassaVisible=()=>document.getElementById('kassaContainer')?.style.display==='block';
  // Ordningen i kassan: först de som ska komma nu (halvtimmen har börjat eller börjar inom 30 min), sedan de som kommer
  // senare och sist de som är sena (mer än en kvart efter sin halvtimme). Med många bokningar visas ett sökfält.
  const BK_SEARCH_FROM=6;
  function bkKassaWhen(b,nowMin){ const s=bkMin(b.slot); if(s+30+15<nowMin) return 'late'; if(s<=nowMin+30) return 'now'; return 'later'; }
  function bkRenderKassa(){
    const el=document.getElementById('kassaBookings'); if(!el) return;
    const list=bkDay(todayStr()).slice().sort((a,b)=>a.slot.localeCompare(b.slot)||String(a.ts).localeCompare(String(b.ts)));
    if(!list.length||!loggedInUser){ el.hidden=true; el.innerHTML=''; return; }
    const n=new Date(); const nowMin=n.getHours()*60+n.getMinutes();
    const waiting=list.filter(b=>!b.arrived), came=list.filter(b=>b.arrived);
    const groups={now:[],later:[],late:[]}; waiting.forEach(b=>groups[bkKassaWhen(b,nowMin)].push(b));
    const q=(BK.kassaQ||'').trim().toLowerCase(); const search=waiting.length>=BK_SEARCH_FROM;
    const match=b=>!q||String(b.name||'').toLowerCase().includes(q)||String(b.code||'')===q.replace(/\D/g,'');
    const soonPeople=groups.now.reduce((s,b)=>s+bkPeople(b),0);
    const btn=(b,when)=>{ const sel=BK.kassaId===b.id; const note=sel?'i kassan':when==='late'?'sen':when==='now'?'nu':'';
      return `<button type="button" class="bk-kassa-btn is-${when}${sel?' is-selected':''}" data-bk-kassa="${bkEsc(b.id)}" aria-pressed="${sel}"><strong>${bkEsc(b.slot)}</strong><span>${bkEsc(b.name||'–')}</span><small>${b.code?`N:o ${bkEsc(b.code)} · `:''}${bkEsc(bkPartyShort(b))}${note?` · ${note}`:''}</small></button>`; };
    const sec=(label,arr,when)=>{ const shown=arr.filter(match); return shown.length?`<p class="bk-kassa-sub">${label}</p><div class="bk-kassa-list">${shown.map(b=>btn(b,when)).join('')}</div>`:''; };
    const body=sec('Nu',groups.now,'now')+sec('Senare',groups.later,'later')+sec('Sena',groups.late,'late');
    // Sökfältet behåller fokus och text när listan ritas om (t.ex. vid den löpande hämtningen)
    const had=document.activeElement?.id==='bkKassaQ'; const caret=had?document.activeElement.selectionStart:0;
    el.hidden=false;
    el.innerHTML=`<div class="bk-kassa-head"><span>Bokningar idag${PRACTICE?' <em class="bk-kassa-practice">Övning</em>':''}</span><small>${groups.now.length?`${groups.now.length} nu (${soonPeople} pers) · `:''}${waiting.length} kvar${came.length?` · ${came.length} har kommit`:''}</small></div>
      ${search?`<input type="search" class="bk-kassa-search" id="bkKassaQ" placeholder="Sök namn eller bokningsnummer" value="${bkEsc(BK.kassaQ||'')}" autocomplete="off" enterkeyhint="search" aria-label="Sök bokning">`:''}
      ${waiting.length?(body||'<p class="bk-kassa-empty">Ingen bokning matchar sökningen.</p>'):'<p class="bk-kassa-empty">Alla bokade har kommit.</p>'}
      ${came.length?`<button type="button" class="bk-kassa-more" data-bk-more>${BK.kassaShowAll?'Dölj de som har kommit':'Visa de som har kommit'}</button>${BK.kassaShowAll?`<ul class="bk-kassa-came">${came.map(b=>`<li><span>✓ ${bkEsc(b.slot)} ${bkEsc(b.name||'–')} · ${bkEsc(bkPartyShort(b))}</span><button type="button" class="bk-link" data-bk-undo="${bkEsc(b.id)}">Ångra</button></li>`).join('')}</ul>`:''}`:''}`;
    if(had){ const inp=document.getElementById('bkKassaQ'); if(inp){ inp.focus(); try{ inp.setSelectionRange(caret,caret); }catch(_e){} } }
  }
  function bkProduct(re){ return loadProducts().find(p=>re.test(p.name)&&!/re[-\s]?entry|återinträde/i.test(p.name)); }
  async function bkToKassa(id){
    const b=bkDay(todayStr()).find(x=>x.id===id); if(!b) return;
    if(BK.kassaId===id){ BK.kassaId=null; cart={}; cartHistory=[]; renderCart(); bkRenderKassa(); return; }
    if(Object.keys(cart).length&&!(await uiConfirm('Kassan innehåller redan varor. Byt ut dem mot bokningen?',{okLabel:'Byt ut'}))) return;
    const ad=bkProduct(/vuxen/i), ch=bkProduct(/barn/i);
    if((b.adult&&!ad)||(b.child&&!ch)){ notify('Hittar ingen vuxen- eller barnbiljett bland produkterna. Lägg in biljetterna för hand.','error'); return; }
    cart={}; cartHistory=[];
    if(b.adult) cart[ad.name]={qty:Number(b.adult),price:Number(ad.price)};
    if(b.child) cart[ch.name]={qty:Number(b.child),price:Number(ch.price)};
    BK.kassaId=id; renderCart(); bkRenderKassa();
  }
  async function bkStaffOp(op,date,id){
    if(PREVIEW) return {ok:true};
    if(PRACTICE){ if(op!=='tidy') bkPracticeOp(op,date,id); return {ok:true}; }
    try{ return await apiAction('bookingStaff',{op,date,id}); }catch(_e){ return null; }
  }
  async function bkMarkArrived(date,id,on=true){
    bkLocal(all=>{ (all[date]||[]).forEach(b=>{ if(b.id===id){ if(on) b.arrived=true; else delete b.arrived; } }); });
    bkRefreshStaff();
    const r=await bkStaffOp(on?'arrived':'unarrived',date,id);
    if(!r||!r.ok){ notify(on?'Bokningen kunde inte markeras som anländ på servern. Köpet är sparat.':'Kunde inte ångra på servern. Försök igen.','error'); bkFetch().then(bkRefreshStaff); }
  }
  document.getElementById('kassaBookings')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-bk-kassa]'); if(b){ bkToKassa(b.dataset.bkKassa); return; }
    if(e.target.closest('[data-bk-more]')){ BK.kassaShowAll=!BK.kassaShowAll; bkRenderKassa(); return; }
    const u=e.target.closest('[data-bk-undo]'); if(u) bkMarkArrived(todayStr(),u.dataset.bkUndo,false);
  });
  document.getElementById('kassaBookings')?.addEventListener('input',e=>{ if(e.target.id!=='bkKassaQ') return; BK.kassaQ=e.target.value; bkRenderKassa(); });
  // Enter i sökfältet lägger den enda träffen i kassan, Esc tömmer sökningen
  document.getElementById('kassaBookings')?.addEventListener('keydown',e=>{
    if(e.target.id!=='bkKassaQ') return;
    if(e.key==='Escape'&&BK.kassaQ){ e.preventDefault(); e.stopPropagation(); BK.kassaQ=''; bkRenderKassa(); document.getElementById('bkKassaQ')?.focus(); }
    if(e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); /* annars öppnar kassans Enter betalningen */ const hits=[...document.querySelectorAll('#kassaBookings .bk-kassa-list .bk-kassa-btn')]; if(hits.length===1){ BK.kassaQ=''; e.target.blur(); bkToKassa(hits[0].dataset.bkKassa); } }
  });
  // Köpet gick igenom med en bokning i kassan: bokningen räknas som anländ
  const _bkCheckout0=performCheckout;
  performCheckout=function(){
    const id=BK.kassaId; const had=Object.keys(cart).length;
    const r=_bkCheckout0.apply(this,arguments);
    if(id&&had&&!Object.keys(cart).length){ BK.kassaId=null; BK.kassaQ=''; bkMarkArrived(todayStr(),id,true); }
    return r;
  };
  const _bkRenderCart0=renderCart;
  renderCart=function(){ const r=_bkRenderCart0.apply(this,arguments); if(BK.kassaId&&!Object.keys(cart).length){ BK.kassaId=null; bkRenderKassa(); } return r; };
  const _bkSelectMenu0=selectMenu;
  selectMenu=function(menu){ const r=_bkSelectMenu0.apply(this,arguments); if(menu==='kassa'){ bkRenderKassa(); bkFetch().then(bkRenderKassa); } return r; };

  /* ============================== HANTERA ============================== */
  function bkRefreshStaff(){
    if(bkKassaVisible()) bkRenderKassa();
    if(document.getElementById('lgBookings')) bkRenderLageCard();
    if(ADM.panel==='bokning'&&!document.getElementById('admBokning')?.hidden) bkRenderAdminDays();
  }
  // Namnen från passerade dagar städas bort på servern, en gång per dag och enhet
  function bkMaybeTidy(){
    const today=todayStr(); if(BK.tidied===today||!isAdmin) return;
    const all=bkAll(); if(!Object.keys(all).some(d=>d<today&&(all[d]||[]).some(b=>b.name))) return;
    BK.tidied=today; bkStaffOp('tidy','','').then(()=>bkFetch());
  }

  /* ---------- Översikt: kortet Bokningar ---------- */
  const _bkRenderLage0=admRenderLage;
  admRenderLage=function(){
    const r=_bkRenderLage0.apply(this,arguments);
    const grid=document.querySelector('#admLage .adm-grid');
    if(grid&&!document.getElementById('lgBookings')){ const a=document.createElement('article'); a.className='rx-card'; a.id='lgBookings'; grid.appendChild(a); }
    bkRenderLageCard(); bkFetch().then(()=>{ bkRenderLageCard(); bkMaybeTidy(); });
    return r;
  };
  function bkDaySummary(list){ const p=list.reduce((s,b)=>s+bkPeople(b),0); return `${list.length} sällskap, ${p} ${p===1?'gäst':'gäster'}`; }
  function bkRenderLageCard(){
    const el=document.getElementById('lgBookings'); if(!el) return;
    const st=bkSettings(); const today=todayStr();
    const todays=bkDay(today).slice().sort((a,b)=>a.slot.localeCompare(b.slot));
    const upcoming=Object.keys(bkAll()).filter(d=>d>today&&bkDay(d).length).sort().slice(0,3);
    if(!st.enabled&&!todays.length&&!upcoming.length){ el.innerHTML=`<p class="rx-card-kicker">Bokningar</p><p class="rx-empty">Gästerna kan inte boka besök just nu.</p><button type="button" class="adm-linkbtn" data-adm-open="bokning">Slå på bokning ›</button>`; return; }
    const came=todays.filter(b=>b.arrived).length;
    const daySlots=bkSlots(bkHours(today)); const lateFrom=daySlots.length?bkMin(daySlots[daySlots.length-1])+30-120:24*60;
    const late=todays.filter(b=>bkMin(b.slot)>=lateFrom);
    el.innerHTML=`<p class="rx-card-kicker">Bokningar</p>
      ${todays.length?`<p class="rx-sub"><strong>Idag:</strong> ${bkDaySummary(todays)}${came?` · ${came} har kommit`:''}</p>
        <ul class="rx-list rx-list--plain bk-lage-list">${bkGroupBySlot(todays).map(([slot,l])=>`<li class="rx-person"><strong>${bkEsc(slot)}</strong><span>${l.map(b=>`${b.arrived?'✓ ':''}${bkEsc(b.name||'–')} (${bkEsc(bkPartyShort(b))})`).join(', ')}</span></li>`).join('')}</ul>
        ${late.length?`<p class="tiny muted">${late.length} sällskap har bokat de två sista timmarna (från kl ${bkHHMM(lateFrom)}).</p>`:''}`
        :`<p class="rx-empty">Inga bokningar idag.</p>`}
      ${upcoming.length?`<ul class="rx-list rx-list--plain">${upcoming.map(d=>{ const l=bkDay(d); const last=l.map(b=>b.slot).sort().pop(); return `<li class="rx-person"><strong>${bkEsc(bkDayShort(d))}</strong><span>${bkDaySummary(l)} · senast kl ${bkEsc(last)}</span></li>`; }).join('')}</ul>`:''}
      ${st.enabled?'':'<p class="tiny muted">Bokningen är avstängd för gästerna.</p>'}
      <button type="button" class="adm-linkbtn" data-adm-open="bokning">Alla bokningar ›</button>`;
  }
  function bkGroupBySlot(list){ const m=new Map(); list.forEach(b=>{ if(!m.has(b.slot)) m.set(b.slot,[]); m.get(b.slot).push(b); }); return [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0])); }

  /* ---------- Panelen Bokningar ---------- */
  ADM_RENDER.bokning=()=>bkRenderAdmin();
  function bkSaveSettings(patch,card){
    const st=bkSettings(); Object.assign(st,patch);
    dbSet(BK_SET_KEY,st).then(()=>admSavedFlash(card)).catch(()=>notify('Kunde inte spara. Kontrollera anslutningen.','error'));
    bkGuestToggle();
  }
  function bkAdminDays(){
    const today=todayStr();
    const dates=new Set(loadOpenDates().map(e=>typeof e==='string'?e:e&&e.date).filter(d=>d&&d>=today));
    if(bkSlots(loadOpeningHours()).length) dates.add(today);
    Object.keys(bkAll()).forEach(d=>{ if(d>=today&&bkDay(d).length) dates.add(d); });
    return [...dates].sort().slice(0,12);
  }
  function bkAllSlotTimes(st){
    const s=new Set(); bkAdminDays().forEach(d=>bkSlots(bkHours(d)).forEach(x=>s.add(x)));
    Object.keys(st.limits||{}).forEach(x=>s.add(x)); (st.popular||[]).forEach(x=>s.add(x));
    return [...s].sort();
  }
  function bkRenderAdmin(){
    const el=document.getElementById('admBokning'); if(!el) return;
    const st=bkSettings();
    el.innerHTML=`<p class="adm-intro">Gästerna bokar en halvtimme och betalar på plats. Bokningen är frivillig, och den som kommer utan bokning släpps in som vanligt.</p>
      <div class="adm-grid">
        <article class="rx-card" id="bkSetCard"><p class="rx-card-kicker">Inställningar <span class="adm-saved" aria-live="polite"></span></p>
          <label class="rx-switch"><input type="checkbox" id="bkOn"${st.enabled?' checked':''}><span>Gästerna kan boka besök på sidan</span></label>
          <div class="rx-fields">
            <label class="rx-field"><span>Sällskap per halvtimme</span><select id="bkLimit">${[1,2,3,4,5,6,8,10].map(n=>`<option${n===Number(st.limit)?' selected':''}>${n}</option>`).join('')}</select></label>
            <label class="rx-field"><span>Högst antal per bokning</span><select id="bkMax">${[2,3,4,5,6,8,10,12].map(n=>`<option${n===Number(st.maxPersons)?' selected':''}>${n}</option>`).join('')}</select></label>
            <label class="rx-field"><span>Sista bokning</span><select id="bkClose">${[[0,'Fram till tiden'],[30,'30 min före'],[60,'1 timme före'],[120,'2 timmar före'],[240,'4 timmar före']].map(([v,l])=>`<option value="${v}"${v===Number(st.closeMin)?' selected':''}>${l}</option>`).join('')}</select></label>
          </div>
          <p class="tiny muted">Gränsen gäller antal sällskap, oavsett hur många de är. Den som vill komma med fler än högsta antalet hänvisas till receptionen.</p>
        </article>
        <article class="rx-card" id="bkTimeCard"></article>
        <article class="rx-card rx-card--wide" id="bkDaysCard"></article>
      </div>`;
    const card=document.getElementById('bkSetCard');
    document.getElementById('bkOn').onchange=e=>bkSaveSettings({enabled:e.target.checked},card);
    document.getElementById('bkLimit').onchange=e=>{ bkSaveSettings({limit:Number(e.target.value)},card); bkRenderAdminTimes(); };
    document.getElementById('bkMax').onchange=e=>bkSaveSettings({maxPersons:Number(e.target.value)},card);
    document.getElementById('bkClose').onchange=e=>bkSaveSettings({closeMin:Number(e.target.value)},card);
    bkRenderAdminTimes(); bkRenderAdminDays();
    bkFetch().then(()=>{ bkRenderAdminDays(); bkMaybeTidy(); });
  }
  function bkRenderAdminTimes(){
    const el=document.getElementById('bkTimeCard'); if(!el) return;
    const st=bkSettings(); const times=bkAllSlotTimes(st);
    el.innerHTML=`<p class="rx-card-kicker">Tider <span class="adm-saved" aria-live="polite"></span></p>
      ${times.length?`<p class="tiny muted">Populära tider visas gula för gästerna, precis som tider med en plats kvar. Ändra gränsen för en enskild tid om den ska ta emot färre eller fler sällskap.</p>
      <div class="bk-adm-times">${times.map(t=>{ const lim=(st.limits||{})[t]; return `<div class="bk-adm-time" data-t="${t}"><strong>${t}</strong>
        <label class="bk-adm-pop"><input type="checkbox" data-pop${(st.popular||[]).includes(t)?' checked':''}><span>Populär</span></label>
        <select data-lim aria-label="Gräns kl ${t}"><option value="">Standard (${Number(st.limit)})</option>${[1,2,3,4,5,6,8,10].map(n=>`<option value="${n}"${Number(lim)===n?' selected':''}>${n} sällskap</option>`).join('')}</select></div>`; }).join('')}</div>
      <div class="rx-actions"><button type="button" class="btn" id="bkSuggest">Föreslå populära tider från statistiken</button></div>`
      :'<p class="rx-empty">Lägg in öppetdagar med öppettid i kalendern, så visas tiderna här.</p><button type="button" class="adm-linkbtn" data-adm-open="schema">Kalendern ›</button>'}`;
    el.onchange=e=>{
      const row=e.target.closest('[data-t]'); if(!row) return; const t=row.dataset.t; const st=bkSettings();
      if(e.target.matches('[data-pop]')){ const pop=new Set(st.popular||[]); if(e.target.checked) pop.add(t); else pop.delete(t); bkSaveSettings({popular:[...pop].sort()},el); }
      if(e.target.matches('[data-lim]')){ const lim={...(st.limits||{})}; if(e.target.value) lim[t]=Number(e.target.value); else delete lim[t]; bkSaveSettings({limits:lim},el); }
    };
    const sug=document.getElementById('bkSuggest'); if(sug) sug.onclick=()=>bkSuggestPopular(times);
  }
  // Halvtimmarna med flest sålda biljetter tidigare dagar. Bara tider som finns i öppettiderna kan föreslås.
  async function bkSuggestPopular(times){
    try{ await dbEnsure(SALESHISTORY_KEY,defaultSalesHistory()); }catch(_e){}
    const hist=loadSalesHistory(); const today=todayStr(); const per={}; let days=0;
    Object.entries(hist).forEach(([d,day])=>{
      if(d>=today||!day||day._deleted||!Array.isArray(day.entries)) return; let any=false;
      day.entries.forEach(e=>{ const n=Number(e.adult||0)+Number(e.child||0); if(!n) return; const m=String(e.time||'').match(/(\d{1,2})[:.](\d{2})/); if(!m) return;
        let h=Number(m[1]); if(/pm/i.test(e.time)&&h<12) h+=12; if(/am/i.test(e.time)&&h===12) h=0;
        const slot=bkHHMM(h*60+(Number(m[2])>=30?30:0)); per[slot]=(per[slot]||0)+n; any=true; });
      if(any) days++;
    });
    const cand=times.filter(t=>per[t]>0).sort((a,b)=>per[b]-per[a]);
    if(days<2||!cand.length){ notify('Det finns för lite försäljning från tidigare dagar för att föreslå tider ännu. Markera dem för hand.','info'); return; }
    const top=per[cand[0]]; const pick=cand.filter(t=>per[t]>=top*0.6).slice(0,Math.max(1,Math.round(times.length/4))).sort();
    const ok=await uiConfirm(`Förslag från ${days} tidigare dagar: ${pick.join(', ')}. Markera de tiderna som populära? Tidigare markeringar ersätts.`,{okLabel:'Markera'});
    if(!ok) return;
    bkSaveSettings({popular:pick},document.getElementById('bkTimeCard')); bkRenderAdminTimes();
  }
  function bkRenderAdminDays(){
    const el=document.getElementById('bkDaysCard'); if(!el) return;
    const st=bkSettings(); const today=todayStr(); const days=bkAdminDays();
    el.innerHTML=`<p class="rx-card-kicker">Kommande dagar</p>${days.length?days.map(d=>{
      const list=bkDay(d).slice().sort((a,b)=>a.slot.localeCompare(b.slot)||String(a.ts).localeCompare(String(b.ts)));
      const off=(st.off||[]).includes(d); const hours=bkHours(d);
      return `<section class="bk-adm-day" data-date="${d}">
        <header class="bk-adm-day-head"><strong>${bkEsc(bkDayLong(d))}${d===today?' · idag':''}</strong><span>${bkEsc(hours||'ingen öppettid')}${list.length?` · ${bkDaySummary(list)}`:''}</span>
          <label class="rx-switch bk-adm-off"><input type="checkbox" data-off${off?'':' checked'}${hours?'':' disabled'}><span>Går att boka</span></label></header>
        ${list.length?`<ul class="bk-adm-list">${list.map(b=>`<li class="${b.arrived?'is-arrived':''}"><span class="bk-adm-slot">${bkEsc(b.slot)}</span><span class="bk-adm-who"><strong>${bkEsc(b.name||'–')}</strong><small>${b.code?`N:o ${bkEsc(b.code)} · `:""}${bkEsc(bkParty(b))}${b.arrived?' · har kommit':''}</small></span>
          <span class="bk-adm-tools">${d===today?`<button type="button" class="btn" data-op="${b.arrived?'unarrived':'arrived'}" data-id="${bkEsc(b.id)}">${b.arrived?'Ångra':'Har kommit'}</button>`:''}<button type="button" class="adm-linkbtn adm-linkbtn--danger" data-op="delete" data-id="${bkEsc(b.id)}">Ta bort</button></span></li>`).join('')}</ul>`:'<p class="rx-empty">Inga bokningar ännu.</p>'}
      </section>`; }).join(''):'<p class="rx-empty">Inga kommande öppetdagar. Lägg in dem i kalendern.</p>'}`;
    el.onchange=e=>{ const sec=e.target.closest('[data-date]'); if(!sec||!e.target.matches('[data-off]')) return; const off=new Set(bkSettings().off||[]); if(e.target.checked) off.delete(sec.dataset.date); else off.add(sec.dataset.date); bkSaveSettings({off:[...off].filter(x=>x>=todayStr()).sort()},null); };
    el.onclick=async e=>{
      const b=e.target.closest('[data-op]'); if(!b) return; const date=b.closest('[data-date]').dataset.date; const id=b.dataset.id; const op=b.dataset.op;
      if(op==='delete'){
        const bk=bkDay(date).find(x=>x.id===id); if(!bk) return;
        if(!(await uiConfirm(`Ta bort bokningen för ${bk.name||'gästen'} kl ${bk.slot}? Gästen får inget besked om det.`,{okLabel:'Ta bort',danger:true}))) return;
        const r=await bkStaffOp('delete',date,id);
        if(!r||!r.ok){ notify('Kunde inte ta bort bokningen. Försök igen.','error'); return; }
        bkLocal(all=>{ all[date]=(all[date]||[]).filter(x=>x.id!==id); }); bkRefreshStaff(); notify('Bokningen är borttagen.','ok'); return;
      }
      bkMarkArrived(date,id,op==='arrived');
    };
  }

  /* ---------- Uppdatering ---------- */
  const _bkUpcoming0=renderUpcomingDates;
  renderUpcomingDates=function(){ const r=_bkUpcoming0.apply(this,arguments); if(!loggedInUser) bkRenderGuest(); return r; };
  // Gästernas bokningar ändrar inte driftstämpeln, så personalens vyer hämtar bokningarna själva
  setInterval(()=>{
    bkRetrySettings();
    if(document.hidden||!loggedInUser) return;
    const adminOpen=document.getElementById('adminSettings')?.style.display==='block'&&(ADM.panel==='bokning'||ADM.panel==='lage');
    if(!bkKassaVisible()&&!adminOpen) return;
    if(Date.now()-BK.fetchedAt<25000) return;
    bkFetch().then(bkRefreshStaff);
  },5000);

  bkInitGuest();
