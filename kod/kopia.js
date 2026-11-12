/* ============================== SÄKERHETSKOPIA AV ALLT OCH KATASTROFÖVNING ==============================
   Laddas efter admin.js. Ritar överst i Hantera → Säkerhetskopia (före kopian av statistiken i app.js, renderLocalBackup).

   - Fullständig kopia på enheten (FULL_BACKUP_LS i app.js): varje admin-enhet hämtar var tionde minut allt som går att
     återställa (KP_KEYS) och sparar det i webbläsaren. En tom post från servern skriver aldrig över kopian, så om servern
     tappar allt finns det senaste innehållet kvar här.
   - Ladda ned som fil: hela kopian som en JSON-fil, att spara utanför enheten (mejl, Drive).
   - Återställ från kopian / från fil: Visar vad servern har och vad kopian har, och lägger tillbaka
     de valda delarna. Statistiken slås ihop dag för dag (inget som finns på servern försvinner). Personallistan behåller den
     som är inloggad. Det senaste läget före återställningen sparas, så att den kan ångras.
   - Katastrofövning: enheten låtsas att servern är tom (DRILL i app.js). Inget på den riktiga servern läses eller ändras.
     Man återställer från kopian och ser att allt kommer tillbaka, och avslutar sedan övningen.
   Lösenorden finns bara på servern och kan inte kopieras härifrån. Se docs/NODRUTIN.md. */

  const KP_KEYS=['usersV1','userData','shiftPlanV1','availabilityV1','openDatesV1','productsV1','salesHistoryV1','seasonCostsV1',
    'wageSettingsV1','skillCatalogV1','taskCatalogV1','taskDescriptionsV1','siteContentV1','welcomeTextV1','welcomeFaqV1',
    'welcomeHotelNameV1','welcomeHeadlineV1','welcomeTaglineV1','socialInstagramV1','socialFacebookV1','reviewsV1','reviewSettingsV1',
    'bookingsV1','bookingSettingsV1','displayTickerTextV1','displaySettingsV1','displayImagesV1','swishNumberV1','registeredDevicesV1',
    'deviceDirV1','staffMsgV1','staffRepliesV1'];
  const KP_LABELS={usersV1:'Personal (namn och behörigheter)',userData:'Personalens kompetenser och teman',shiftPlanV1:'Schema',availabilityV1:'Svar på pass',
    openDatesV1:'Öppetdagar',productsV1:'Produkter och priser',salesHistoryV1:'Statistik',seasonCostsV1:'Säsongskostnader',wageSettingsV1:'Löneinställningar',
    skillCatalogV1:'Kompetenser',taskCatalogV1:'Uppgifter',taskDescriptionsV1:'Uppgiftsbeskrivningar',siteContentV1:'Gästsidans texter och bilder',
    welcomeTextV1:'Säsongsmeddelandet',welcomeFaqV1:'Frågor och svar',welcomeHotelNameV1:'Gästsidans namn',welcomeHeadlineV1:'Gästsidans rubrik',
    welcomeTaglineV1:'Gästsidans undertext',socialInstagramV1:'Instagram-länk',socialFacebookV1:'Facebook-länk',reviewsV1:'Gästboken',
    reviewSettingsV1:'Granskning av omdömen',bookingsV1:'Bokningar',bookingSettingsV1:'Bokningsinställningar',displayTickerTextV1:'Köskärmens text',
    displaySettingsV1:'Skärmarnas inställningar',displayImagesV1:'Skärmarnas bilder',swishNumberV1:'Swishnummer',registeredDevicesV1:'Kassaenheter',
    deviceDirV1:'Enheternas namn',staffMsgV1:'Anslaget till personalen',staffRepliesV1:'Meddelanden'};
  const KP_REFRESH_MS=10*60000, KP_REMIND_DAYS=14;
  const KP_DL_LS='fullBackupDownloadedV1', KP_UNDO_LS=DRILL?'drill_kpUndoV1':'kpUndoV1';
  const kpEsc=s=>escapeHtml(String(s??''));
  const kpEmpty=raw=>{ if(raw==null) return true; const t=String(raw).trim(); return !t||t==='null'||t==='{}'||t==='[]'||t==='""'; };
  const kpSize=raw=>{ const n=String(raw||'').length; return n<1000?`${n} tecken`:`${(n/1024).toFixed(n<10240?1:0).replace('.',',')} kB`; };
  const kpWhen=t=>t?new Date(t).toLocaleString('sv-SE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'aldrig';
  // Vad en del innehåller, i ord: "12 öppetdagar", "5 personer: Adam, Casper …". Okänt innehåll visas som storlek.
  function kpSummary(k,raw){
    if(kpEmpty(raw)) return 'tomt';
    let v=raw; try{ v=JSON.parse(raw); }catch(_e){}
    const n=(x,one,many)=>`${x} ${x===1?one:many}`;
    const names=list=>{ const l=list.filter(Boolean).map(String); return l.length?`: ${l.slice(0,4).join(', ')}${l.length>4?' …':''}`:''; };
    try{
      if(k==='usersV1'){ const u=Object.values(v||{}); return n(u.length,'person','personer')+names(u.map(x=>x&&x.name)); }
      if(k==='userData') return n(Object.keys(v||{}).length,'person','personer');
      if(k==='shiftPlanV1') return n(Object.keys(v||{}).length,'dag med pass','dagar med pass');
      if(k==='availabilityV1') return n(Object.keys(v||{}).length,'dag med svar','dagar med svar');
      if(k==='openDatesV1'){ const t=todayStr(), a=(v||[]).map(e=>typeof e==='string'?e:e&&e.date).filter(Boolean); const up=a.filter(d=>d>=t).length; return n(a.length,'öppetdag','öppetdagar')+(up?`, ${up} kommande`:''); }
      if(k==='productsV1') return n((v||[]).length,'produkt','produkter')+names((v||[]).map(p=>p&&p.name));
      if(k==='salesHistoryV1'){ const d=Object.entries(v||{}).filter(([,x])=>x&&!x._deleted); const g=d.reduce((s2,[,x])=>s2+Number(x.adult||0)+Number(x.child||0),0); return `${n(d.length,'dag','dagar')}, ${g.toLocaleString('sv-SE')} gäster`; }
      if(k==='seasonCostsV1') return n(Object.values(v||{}).reduce((s2,a)=>s2+(Array.isArray(a)?a.length:0),0),'kostnad','kostnader');
      if(k==='skillCatalogV1'||k==='taskCatalogV1') return n((v||[]).length,'st','st')+names(v||[]);
      if(k==='taskDescriptionsV1') return n(Object.keys(v||{}).length,'beskrivning','beskrivningar');
      if(k==='reviewsV1') return n((v||[]).length,'omdöme','omdömen');
      if(k==='bookingsV1') return n(Object.values(v||{}).reduce((s2,a)=>s2+(Array.isArray(a)?a.length:0),0),'bokning','bokningar');
      if(k==='siteContentV1') return n(Object.keys(v||{}).length,'ändrad text eller bild','ändrade texter och bilder');
      if(k==='welcomeFaqV1') return n((v||[]).length,'fråga','frågor');
      if(k==='registeredDevicesV1'||k==='deviceDirV1') return n(Object.keys(v||{}).length,'enhet','enheter');
      if(k==='staffRepliesV1') return n((v||[]).length,'meddelande','meddelanden');
      if(typeof v==='string'||typeof v==='number'){ const t=String(v).replace(/\s+/g,' ').trim(); return `"${t.slice(0,40)}${t.length>40?' …':''}"`; }
    }catch(_e){}
    return kpSize(raw);
  }
  function kpRead(){ try{ const b=JSON.parse(localStorage.getItem(FULL_BACKUP_LS)||'null'); if(b&&b.keys) return Object.assign({t:0,at:{},skipped:[]},b); }catch(_e){} return {t:0,keys:{},at:{},skipped:[]}; }
  function kpWrite(b){ try{ localStorage.setItem(FULL_BACKUP_LS,JSON.stringify(b)); return true; }catch(_e){ return false; } }

  /* ---------- Kopian på enheten ---------- */
  let _kpBusy=false;
  async function kpRefresh({force=false}={}){
    if(!loggedInUser||!isAdmin||PREVIEW||PRACTICE||DRILL||_kpBusy) return false;
    const b=kpRead(); if(!force&&Date.now()-b.t<KP_REFRESH_MS) return true;
    _kpBusy=true;
    try{
      const v=await apiGetMany(KP_KEYS);
      KP_KEYS.forEach(k=>{ const raw=v[k]; if(kpEmpty(raw)) return; if(b.keys[k]!==raw){ b.keys[k]=String(raw); b.at[k]=Date.now(); } });
      b.t=Date.now(); b.skipped=[];
      // Får kopian inte plats tas de största delarna som går att vara utan bort först
      if(!kpWrite(b)){ ['displayImagesV1','siteContentV1'].some(k=>{ if(!b.keys[k]) return false; delete b.keys[k]; b.skipped.push(k); return kpWrite(b); }); }
      return true;
    }catch(_e){ return false; }finally{ _kpBusy=false; }
  }
  setTimeout(()=>kpRefresh(),15000);
  setInterval(()=>{ if(!document.hidden) kpRefresh(); },60000);

  function kpDownload(){
    const b=kpRead(); if(!Object.keys(b.keys).length){ notify('Kopian är tom. Tryck Uppdatera kopian först.'); return; }
    const file={app:'korpen-kopia',version:1,t:b.t,keys:b.keys};
    const blob=new Blob([JSON.stringify(file)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`korpen-sakerhetskopia-${todayStr()}.json`;
    document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
    if(!DRILL) localStorage.setItem(KP_DL_LS,String(Date.now()));
    notify('Säkerhetskopian är nedladdad. Spara filen utanför enheten, till exempel i mejlen eller på Drive.','ok');
    kpRender();
  }
  function kpPickFile(){
    const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,application/json';
    inp.onchange=()=>{ const f=inp.files&&inp.files[0]; if(!f) return; const r=new FileReader();
      r.onload=()=>{ let j=null; try{ j=JSON.parse(r.result); }catch(_e){}
        if(!j||j.app!=='korpen-kopia'||!j.keys||typeof j.keys!=='object'){ notify('Filen är ingen säkerhetskopia från Korpen.','error'); return; }
        kpRestoreDialog({keys:j.keys,t:j.t||0,from:`filen ${f.name}`}); };
      r.readAsText(f); };
    inp.click();
  }

  /* ---------- Återställ ---------- */
  async function kpRestoreDialog(src){
    let server={};
    try{ server=await apiGetMany(KP_KEYS); }catch(_e){ notify('Kunde inte läsa servern. Försök igen.','error'); return; }
    const rows=KP_KEYS.filter(k=>!kpEmpty(src.keys[k])).map(k=>{
      const s=server[k], has=!kpEmpty(s), same=has&&String(s)===String(src.keys[k]);
      // Förval: det som saknas på servern, och statistiken (den slås ihop och tappar inget)
      const pre=!has||(k==='salesHistoryV1'&&!same);
      return {k,has,same,pre};
    });
    if(!rows.length){ notify('Kopian innehåller inget att återställa.'); return; }
    const missing=rows.filter(r=>!r.has).length;
    const body=document.createElement('div');
    body.innerHTML=`<p class="kp-dlg-note">Jämförelse mellan servern just nu och ${kpEsc(src.from)} (${kpEsc(kpWhen(src.t))}). ${missing?`<strong>${missing} ${missing===1?'del saknas':'delar saknas'} på servern</strong> och är förbockade.`:'Servern har redan något i alla delar.'} Det som finns på båda ställena byts bara ut om du bockar i det. Statistiken slås ihop dag för dag, så inget som redan finns försvinner. Ingenting ändras förrän du trycker Återställ valda.</p>${rows.some(r=>r.k==='usersV1')?'<p class="kp-dlg-note">Lösenorden finns bara på servern och följer inte med. Har de försvunnit: ge personalen nya under Hantera → Personal → Byt lösenord.</p>':''}
      <ul class="kp-rows">${rows.map(r=>`<li><label><input type="checkbox" data-kp="${r.k}"${r.pre?' checked':''}${r.same?' disabled':''}><span><strong>${kpEsc(KP_LABELS[r.k]||r.k)}</strong><small>${r.same?`Samma på servern och i kopian: ${kpEsc(kpSummary(r.k,src.keys[r.k]))}`:`Servern: ${kpEsc(kpSummary(r.k,server[r.k]))}<br>Kopian: ${kpEsc(kpSummary(r.k,src.keys[r.k]))}`}</small></span></label></li>`).join('')}</ul>`;
    const pick=await openDialog({title:'Återställ från säkerhetskopian',body,className:'kp-dialog',dismissValue:null,
      actions:[{label:'Avbryt',value:null},{label:'Återställ valda',primary:true,value:box=>[...box.querySelectorAll('input[data-kp]:checked')].map(i=>i.dataset.kp)}]});
    if(!pick||!pick.length) return;
    await kpRestore(src,pick,server);
  }
  async function kpRestore(src,keys,server){
    const undo={t:Date.now(),keys:{}}; let ok=0, fail=[];
    // Personallistan sist: den kontrolleras hårdast på servern, och allt annat ska vara på plats om den skulle nekas
    const order=keys.filter(k=>k!=='usersV1').concat(keys.includes('usersV1')?['usersV1']:[]);
    for(const k of order){
      let raw=String(src.keys[k]);
      try{
        if(k==='salesHistoryV1'){
          // Dag för dag: dagar som saknas läggs till, dagar som finns på båda slås ihop köp för köp
          const cur=(()=>{ try{ return JSON.parse(server[k]||'{}')||{}; }catch(_e){ return {}; } })(), bk=JSON.parse(raw)||{};
          const out=Object.assign({},cur);
          Object.keys(bk).forEach(d=>{ const s=cur[d], l=bk[d]; if(!l||l._deleted) return; out[d]=(!s||s._deleted)?l:_histDayUnion(s,l); });
          raw=JSON.stringify(out);
        }
        if(k==='usersV1'){
          // Den som är inloggad måste finnas kvar, annars gäller inte inloggningen längre. Finns samma namn i kopian
          // under ett annat id får personen kopians uppgifter men behåller sitt id.
          const list=JSON.parse(raw)||{}; const me=users[loggedInKey]||{name:loggedInUser,admin:true};
          if(loggedInKey&&!list[loggedInKey]){ const twin=Object.keys(list).find(id=>String(list[id]?.name||'').toLowerCase()===String(me.name||'').toLowerCase());
            if(twin){ list[loggedInKey]=Object.assign({},list[twin],{admin:true}); delete list[twin]; } else list[loggedInKey]=Object.assign({},me,{admin:true}); }
          raw=JSON.stringify(list);
        }
        undo.keys[k]=server[k]==null?'':String(server[k]);
        await apiSet(k,raw); ok++;
      }catch(_e){ fail.push(KP_LABELS[k]||k); }
    }
    try{ localStorage.setItem(KP_UNDO_LS,JSON.stringify(undo)); }catch(_e){}
    if(fail.length) notify(`${ok} delar återställda. Gick inte: ${fail.join(', ')}.`,'error');
    else notify(`${ok} ${ok===1?'del är återställd':'delar är återställda'}. Sidan laddas om.`,'ok');
    setTimeout(()=>location.reload(),fail.length?4000:2500);
  }
  async function kpUndo(){
    let u=null; try{ u=JSON.parse(localStorage.getItem(KP_UNDO_LS)||'null'); }catch(_e){}
    if(!u||!u.keys) return;
    if(!(await uiConfirm(`Lägga tillbaka det som fanns på servern före återställningen ${kpWhen(u.t)}? ${Object.keys(u.keys).length} delar ändras.`,{title:'Ångra återställningen',okLabel:'Ångra'}))) return;
    for(const k of Object.keys(u.keys)){ try{ await apiSet(k,u.keys[k]); }catch(_e){} }
    localStorage.removeItem(KP_UNDO_LS); notify('Återställningen är ångrad. Sidan laddas om.','ok'); setTimeout(()=>location.reload(),2000);
  }

  /* ---------- Katastrofövning ---------- */
  async function kpStartDrill(){
    if(PRACTICE){ notify('Avsluta övningsläget först.'); return; }
    if(!(await uiConfirm('Den här enheten låtsas att servern har tömts, som när allt försvann. Inget på den riktiga servern ändras, och andra enheter märker inget. Gå sedan till Säkerhetskopia, tryck Återställ från kopian och kontrollera att allt kommer tillbaka. Sidan laddas om.',{title:'Starta katastrofövning?',okLabel:'Starta övningen'}))) return;
    await kpRefresh({force:true});
    try{
      Object.keys(localStorage).filter(k=>k.startsWith('drill_')).forEach(k=>localStorage.removeItem(k));
      const snap=localStorage.getItem('saleshistory_protected_v1'); if(snap) localStorage.setItem('drill_protected',snap);
      const full=localStorage.getItem('fullBackupV1'); if(full) localStorage.setItem('drill_fullBackupV1',full);
      localStorage.setItem('drillStoreV1','{}'); localStorage.setItem('drillModeV1','1');
      localStorage.setItem('admPanelV1','kopia');
    }catch(_e){ notify('Enheten har inte plats för övningen.','error'); return; }
    location.reload();
  }
  async function kpStopDrill(){
    if(!(await uiConfirm('Avsluta katastrofövningen? Allt som gjorts under övningen raderas från enheten, och sidan visar den riktiga servern igen.',{okLabel:'Avsluta övningen'}))) return;
    ['drillModeV1','drillStoreV1'].forEach(k=>localStorage.removeItem(k));
    Object.keys(localStorage).filter(k=>k.startsWith('drill_')).forEach(k=>localStorage.removeItem(k));
    location.reload();
  }
  (function kpDrillBanner(){
    if(!DRILL) return;
    document.body.classList.add('is-practice','is-drill');
    const b=document.createElement('div'); b.className='rx-practice kp-drill'; b.setAttribute('role','status');
    b.innerHTML='<span><b>Katastrofövning</b> <span class="rx-practice-text">Enheten låtsas att servern är tom. Inget sparas på riktigt.</span></span><button type="button" data-kp-go>Säkerhetskopia</button><button type="button" data-kp-stop>Avsluta</button>';
    b.querySelector('[data-kp-go]').onclick=()=>{ if(!isAdmin){ notify('Logga in som admin.'); return; } selectMenu('admin'); admOpen('kopia'); };
    b.querySelector('[data-kp-stop]').onclick=kpStopDrill; document.body.appendChild(b);
  })();

  /* ---------- Panelen ---------- */
  function kpHtml(){
    const b=kpRead(), n=Object.keys(b.keys).length, dl=Number(localStorage.getItem(KP_DL_LS)||0);
    let undo=null; try{ undo=JSON.parse(localStorage.getItem(KP_UNDO_LS)||'null'); }catch(_e){}
    const old=!dl||Date.now()-dl>KP_REMIND_DAYS*864e5;
    return `<div class="kp">
      ${DRILL?`<article class="rx-card rx-card--wide kp-drill-card"><p class="rx-card-kicker">Katastrofövning pågår</p><h4 class="rx-card-title">Servern låtsas vara tom</h4>
        <p class="adm-intro">Så här ser det ut när allt har försvunnit. Tryck <strong>Återställ från kopian</strong> nedan och kontrollera sedan Kalender, Personal, Produkter, statistiken och gästsidan. Inget sparas på den riktiga servern.</p>
        <div class="rx-actions"><button type="button" class="btn" data-kp="stop">Avsluta övningen</button></div></article>`:''}
      <article class="rx-card rx-card--wide"><p class="rx-card-kicker">Säkerhetskopia av allt</p>
        <p class="adm-intro">Den här enheten sparar var tionde minut en kopia av allt som går att återställa: personal, schema, öppetdagar, produkter, statistik, gästsidan, bokningar och inställningar. En tom server skriver aldrig över kopian. Lösenorden finns bara på servern.</p>
        <dl class="kp-facts"><div><dt>Kopian på enheten</dt><dd>${n?`${n} delar · ${kpEsc(kpWhen(b.t))}`:'Ingen kopia än'}</dd></div><div><dt>Senast nedladdad</dt><dd class="${old?'is-warn':''}">${kpEsc(kpWhen(dl))}</dd></div></dl>
        ${b.skipped&&b.skipped.length?`<p class="sx-note">Fick inte plats på enheten: ${b.skipped.map(k=>kpEsc(KP_LABELS[k]||k)).join(', ')}. Ladda ned kopian som fil från en dator för att få med allt.</p>`:''}
        ${old&&!DRILL?`<p class="sx-note kp-warn">Ladda ned kopian som fil minst varannan vecka och spara den utanför enheten. Försvinner allt och telefonen samtidigt rensas, är filen det enda som finns kvar.</p>`:''}
        ${n?`<details class="kp-what"><summary>Vad finns i kopian? (${n} delar)</summary>
          <ul>${KP_KEYS.filter(k=>b.keys[k]).map(k=>`<li><strong>${kpEsc(KP_LABELS[k]||k)}</strong><span>${kpEsc(kpSummary(k,b.keys[k]))}</span><small>${b.at&&b.at[k]?`ändrad ${kpEsc(kpWhen(b.at[k]))}`:''}</small></li>`).join('')}</ul>
          <p class="sx-note">Ingår inte: lösenorden (finns bara på servern) och det som bara gäller idag: kön, väntande biljetter och dagens insläpp.</p></details>`:''}
        <p class="kp-how"><strong>Återställ från kopian</strong> jämför kopian med servern och visar en lista. Det som saknas på servern är förbockat, och ingenting ändras förrän du trycker Återställ valda.</p>
        <div class="rx-actions">
          <button type="button" class="btn btn-green" data-kp="restore">Återställ från kopian…</button>
          <button type="button" class="btn" data-kp="file">Återställ från fil…</button>
          ${DRILL?'':'<button type="button" class="btn" data-kp="download">Ladda ned som fil</button><button type="button" class="btn" data-kp="refresh">Uppdatera kopian nu</button>'}
          ${undo&&undo.keys?`<button type="button" class="btn" data-kp="undo">Ångra återställningen ${kpEsc(kpWhen(undo.t))}</button>`:''}
        </div></article>
      ${DRILL?'':`<article class="rx-card rx-card--wide"><p class="rx-card-kicker">Katastrofövning</p>
        <p class="adm-intro">Pröva att allt går att få tillbaka om servern töms. Enheten låtsas att servern är tom, och du återställer från kopian. Den riktiga servern och de andra enheterna påverkas inte.</p>
        <div class="rx-actions"><button type="button" class="btn" data-kp="drill">Starta katastrofövning</button></div></article>`}
      <p class="kp-sub">Kopian av statistiken</p></div>`;
  }
  function kpRender(){ const el=document.getElementById('admKopia'); if(!el||!isAdmin) return; el.querySelector('.kp')?.remove(); el.insertAdjacentHTML('afterbegin',kpHtml()); }
  const _kpRenderLocal0=renderLocalBackup;
  renderLocalBackup=function(){ const r=_kpRenderLocal0.apply(this,arguments); try{ kpRender(); }catch(e){ console.error(e); } return r; };
  document.getElementById('admKopia')?.addEventListener('click',async e=>{
    const b=e.target.closest('[data-kp]'); if(!b||b.tagName==='INPUT') return;
    const a=b.dataset.kp;
    if(a==='restore') kpRestoreDialog({keys:kpRead().keys,t:kpRead().t,from:DRILL?'kopian på enheten (som den var när övningen startade)':'kopian på enheten'});
    else if(a==='download') kpDownload();
    else if(a==='file') kpPickFile();
    else if(a==='refresh'){ b.disabled=true; const ok=await kpRefresh({force:true}); notify(ok?'Kopian är uppdaterad.':'Kunde inte uppdatera kopian.',ok?'ok':'error'); kpRender(); }
    else if(a==='undo') kpUndo();
    else if(a==='drill') kpStartDrill();
    else if(a==='stop') kpStopDrill();
  });

  // Kräver åtgärd på Min sida: påminnelse om nedladdning och att övningen pågår
  const _kpAttention0=admAttentionItems;
  admAttentionItems=function(){
    const items=_kpAttention0.apply(this,arguments);
    if(DRILL) items.unshift({lvl:'warn',text:'Katastrofövningen pågår på den här enheten',btn:'Säkerhetskopia',go:'kopia'});
    else if(isAdmin){ const dl=Number(localStorage.getItem(KP_DL_LS)||0); if(!dl||Date.now()-dl>KP_REMIND_DAYS*864e5) items.push({lvl:'info',text:dl?`Säkerhetskopian laddades senast ned ${kpWhen(dl)}`:'Ingen säkerhetskopia är nedladdad som fil',btn:'Ladda ned',go:'kopia'}); }
    return items;
  };
