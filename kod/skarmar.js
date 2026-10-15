/* ============================== SKÄRMAR & ENHETER ==============================
   Hantera → Skärmar & enheter. Laddas efter app.js och före admin.js; funktionerna anropas först när panelen öppnas.
   Fyra flikar:
   - Översikt: vilka enheter som hörs av just nu (livstecknen, admRefreshDevices i admin.js) och webbesöken (admRenderWebb).
   - Kassaenheter: vilka enheter som får använda kassan (registeredDevicesV1, renderDevicesAdmin i app.js).
   - Köskärm: infotexter (displayTickerTextV1, " | " mellan texterna), bilder (displayImagesV1, en adress per rad) samt
     tid per bild och prislistan (displaySettingsV1).
   - Kundskärm: Swish-numret (swishNumberV1), texterna (displaySettingsV1) och vilken kassa som har kopplat skärmen.
   Ändringar görs i ett utkast som syns direkt i förhandsvisningen och sparas först med Spara. Förhandsvisningen är den
   riktiga skärmen (index.html?preview&skarm=ko|kund, startScreenPreview i app.js) i en nedskalad iframe, så den ritas
   av samma kod som skärmen. I ?preview sparar sidan ingenting. */

  const SK={ tab:localStorage.getItem('skTabV1')||'oversikt', saved:null, draft:null, swishLocalOnly:false, owner:'', loadedAt:0,
    frames:{}, ko:{i:0,count:1,types:['queue'],play:false}, kundState:'cart', saving:'', sendTimer:{} };
  const SK_TABS=[['oversikt','Översikt'],['kassa','Kassaenheter'],['ko','Köskärm'],['kund','Kundskärm']];
  // Skärmstorlekar i förhandsvisningen: [id, namn, bredd, höjd] i CSS-pixlar
  const SK_SIZES={
    ko:[['tv','TV eller datorskärm (16:9)',1920,1080],['platta','Surfplatta, liggande',1180,820],['dator','Bärbar dator (16:10)',1440,900]],
    kund:[['platta','Surfplatta, liggande',1180,820],['telefon','Telefon, liggande',844,390],['tv','Skärm (16:9)',1280,720]]
  };
  const SK_HOTEL_IMAGES=[['bilder/hotellarkiv-1936.jpg','Hotellet 1936'],['bilder/personalen-1936.jpg','Personalen'],['bilder/vykort-korpen.jpg','Vykortet'],['bilder/hotell-korpen.png','Loggan, ljus'],['bilder/korpen.png','Loggan, mörk']];
  const SK_KO_FIELDS=['ticker','images','slideSec','prices'], SK_KUND_FIELDS=['swish','cdWelcome','cdThanks','cdThanksSub'];
  const SK_STATES=[['idle','Väntar'],['cart','Varukorg'],['swish','Swish'],['kontant','Kontant'],['tack','Tack']];

  const skEl=id=>document.getElementById(id);
  const skEsc=s=>escapeHtml(String(s??''));
  const skBase=()=>new URL('.',location.href).href;

  function skSetTab(t){ if(!SK_TABS.some(x=>x[0]===t)) return; SK.tab=t; localStorage.setItem('skTabV1',t); }

  /* ---------- Data: sparat läge och utkast ---------- */
  function skParse(v){ try{ return JSON.parse(v||'null'); }catch(_e){ return null; } }
  function skState(ticker,images,settings,swish){
    const st=normDisplaySettings(settings);
    return { ticker:String(ticker||'').split('|').map(s=>s.trim()).filter(Boolean), images:String(images||'').split('\n').map(s=>s.trim()).filter(Boolean),
      slideSec:st.slideSec, prices:st.prices, cdWelcome:st.cdWelcome, cdThanks:st.cdThanks, cdThanksSub:st.cdThanksSub, swish:normSwishNumber(swish) };
  }
  const skNorm=(o,f)=>f==='ticker'?skTickerStr(o.ticker):f==='images'?skImagesStr(o.images):o[f];
  const skSame=(a,b,fields)=>fields.every(f=>skNorm(a,f)===skNorm(b,f));
  function skDirty(tab){ if(!SK.saved||!SK.draft) return false; return !skSame(SK.saved,SK.draft,tab==='ko'?SK_KO_FIELDS:SK_KUND_FIELDS)||(tab==='kund'&&SK.swishLocalOnly&&!!SK.draft.swish); }
  // Inställningsposten delas av båda skärmarna: den flik som sparas skriver sina fält och behåller den andras sparade
  function skSettingsJson(ko,kund){ return JSON.stringify({slideSec:ko.slideSec,prices:ko.prices,cdWelcome:kund.cdWelcome,cdThanks:kund.cdThanks,cdThanksSub:kund.cdThanksSub}); }
  const skTickerStr=list=>list.map(t=>String(t||'').replace(/\|/g,'/').trim()).filter(Boolean).join(' | ');
  const skImagesStr=list=>list.map(u=>String(u||'').trim()).filter(Boolean).join('\n');

  async function skLoad(){
    const keys=[DISPLAY_TICKER_KEY,DISPLAY_IMAGES_KEY,DISPLAY_SETTINGS_KEY,SWISH_NUMBER_KEY];
    let ok=true;
    try{ await dbRefreshMany(keys.map(key=>({key,fallback:''}))); }catch(_e){ ok=false; }
    // Nås inte servern används det som den här webbläsaren senast fick
    const local={[DISPLAY_TICKER_KEY]:localStorage.getItem(DISPLAY_TICKER_KEY),[DISPLAY_IMAGES_KEY]:localStorage.getItem(DISPLAY_IMAGES_KEY),[DISPLAY_SETTINGS_KEY]:localStorage.getItem(DISPLAY_SETTINGS_KEY),[SWISH_NUMBER_KEY]:''};
    const v=k=>ok?(dbGet(k,'')||''):(local[k]||'');
    if(!ok) notify('Kunde inte hämta skärmarnas inställningar från servern. Det som visas är den här enhetens senaste kopia.','error');
    const serverSwish=normSwishNumber(v(SWISH_NUMBER_KEY)), localSwish=getSwishNumber();
    // Tidigare sparades Swish-numret bara i den egna webbläsaren. Finns det bara här föreslås det, så att det kan sparas för alla kassor.
    SK.swishLocalOnly=ok&&!serverSwish&&!!localSwish;
    const saved=skState(v(DISPLAY_TICKER_KEY),v(DISPLAY_IMAGES_KEY),skParse(v(DISPLAY_SETTINGS_KEY)),serverSwish);
    const keepKo=SK.draft&&skDirty('ko'), keepKund=SK.draft&&skDirty('kund');
    const draft=_clone(saved);
    if(keepKo) SK_KO_FIELDS.forEach(f=>draft[f]=SK.draft[f]);
    if(keepKund) SK_KUND_FIELDS.forEach(f=>draft[f]=SK.draft[f]); else if(SK.swishLocalOnly) draft.swish=localSwish;
    SK.saved=saved; SK.draft=draft; SK.loadedAt=ok?Date.now():0;
    // Skärmen på den här enheten (om den startas här) ska visa samma sak som servern
    if(ok){ localStorage.setItem(DISPLAY_TICKER_KEY,v(DISPLAY_TICKER_KEY)); localStorage.setItem(DISPLAY_IMAGES_KEY,v(DISPLAY_IMAGES_KEY)); if(v(DISPLAY_SETTINGS_KEY)) localStorage.setItem(DISPLAY_SETTINGS_KEY,v(DISPLAY_SETTINGS_KEY)); }
    if(serverSwish) localStorage.setItem(SWISH_NUMBER_KEY,serverSwish);
  }
  async function skLoadOwner(){ try{ SK.owner=String(await apiGet(CUSTOMER_DISPLAY_OWNER_KEY)||''); }catch(_e){} }

  /* ---------- Panelen ---------- */
  async function admRenderSkarmar(){
    const el=skEl('admSkarmar'); if(!el) return;
    if(!SK_TABS.some(x=>x[0]===SK.tab)) SK.tab='oversikt';
    el.innerHTML=`<h4 class="adm-panel-title">Skärmar &amp; enheter</h4>
      <div class="ui-tabs sk-tabs" role="tablist" aria-label="Skärmar och enheter">${SK_TABS.map(([id,l])=>`<button type="button" class="ui-tab" role="tab" data-sk-tab="${id}">${l}<span class="sk-dot" data-sk-dirty="${id}" hidden aria-label="osparade ändringar"></span></button>`).join('')}</div>
      <div class="sk-body" id="skBody"></div>`;
    el.onclick=skOnClick; el.oninput=skOnInput; el.onchange=skOnChange;
    skDrawTab();
    if(!SK.saved||Date.now()-SK.loadedAt>20000){ await Promise.all([skLoad(),skLoadOwner()]); if(ADM.panel==='skarmar') skDrawTab(); }
    else skLoadOwner().then(()=>{ if(ADM.panel==='skarmar') skUpdateOwner(); });
    admRefreshDevices();
  }
  function skDrawTab(){
    const body=skEl('skBody'); if(!body) return;
    document.querySelectorAll('#admSkarmar [data-sk-tab]').forEach(b=>{ const on=b.dataset.skTab===SK.tab; b.classList.toggle('is-active',on); b.setAttribute('aria-selected',String(on)); });
    skUpdateDirty();
    Object.values(SK.frames).forEach(f=>f.ro?.disconnect()); SK.frames={};
    if(SK.tab==='oversikt'){ body.innerHTML=skOverviewHtml(); skDrawStatus(); admRefreshDevices(); admRenderWebb(); return; }
    if(SK.tab==='kassa'){ body.innerHTML=skKassaHtml(); renderDevicesAdmin(); return; }
    if(!SK.draft){ body.innerHTML='<p class="rx-empty">Hämtar skärmarnas inställningar…</p>'; return; }
    body.innerHTML=SK.tab==='ko'?skKoHtml():skKundHtml();
    if(SK.tab==='ko'){ skDrawTicker(); skDrawImages(); }
    else skValidateSwish();
    skMountPreview(SK.tab);
    skUpdateSaveBar(SK.tab);
    if(SK.tab==='kund') skUpdateOwner();
    skDevicesUpdated();
  }
  function skUpdateDirty(){
    ['ko','kund'].forEach(t=>{ const d=document.querySelector(`#admSkarmar [data-sk-dirty="${t}"]`); if(d) d.hidden=!skDirty(t); });
  }

  /* ---------- Översikt ---------- */
  function skOverviewHtml(){
    return `<p class="adm-intro">Vilka enheter som är igång just nu och hur många som har besökt hemsidan.</p>
      <div class="sk-status" id="skStatus"></div>
      <div class="adm-grid adm-grid--2">
        <article class="rx-card"><p class="rx-card-kicker">Enheter som hörts av</p><div id="admDeviceSeen" class="rx-seen"><p class="rx-empty">Hämtar enheterna…</p></div></article>
        <article class="rx-card" id="admWebb"></article>
      </div>`;
  }
  // Senaste livstecknet för en sorts enhet: kassa (registrerad eller i kassavyn), köskärm eller kundskärm
  function skLatest(kind){
    const reg=loadRegisteredDevices();
    const list=(ADM.devices||[]).filter(d=>Date.now()-d.ts<12*3600000).filter(d=>kind==='kassa'?(reg[d.id]||d.view==='Kassa'):d.view===(kind==='ko'?'Kötidsskärm':'Kundskärm'));
    return list.sort((a,b)=>b.ts-a.ts)[0]||null;
  }
  const skLive=d=>{ if(!d) return 'dead'; const age=Date.now()-d.ts; return age<150000?'live':age<600000?'warn':'dead'; };
  function skHeardText(kind){
    const d=skLatest(kind); const name=kind==='ko'?'köskärm':kind==='kund'?'kundskärm':'kassa';
    if(!d) return {cls:'dead',text:`Ingen ${name} har hörts av de senaste timmarna.`};
    const cls=skLive(d);
    return {cls,text:`${cls==='live'?'Igång':'Tyst'}: ${d.name} hördes av ${admAgo(d.ts)}.`};
  }
  function skDrawStatus(){
    const el=skEl('skStatus'); if(!el) return;
    const tile=(kind,label,go)=>{ const h=skHeardText(kind); const extra=kind==='kund'?`<small>${SK.owner?`Kopplad till ${skEsc(SK.owner)}s kassa`:'Ingen kassa kopplad'}</small>`:'';
      return `<button type="button" class="sk-tile" data-sk-go="${go}"><span class="sk-tile-label">${label}</span><strong><span class="status-dot ${h.cls}"></span>${h.cls==='live'?'Igång':h.cls==='warn'?'Tyst en stund':'Inte igång'}</strong><small>${skEsc(h.text.replace(/^(Igång|Tyst): /,''))}</small>${extra}</button>`; };
    el.innerHTML=tile('kassa','Kassan','kassa')+tile('ko','Köskärmen','ko')+tile('kund','Kundskärmen','kund');
  }
  // Anropas av admRefreshDevices (admin.js) när livstecknen har hämtats
  function skDevicesUpdated(){
    if(ADM.panel!=='skarmar') return;
    skDrawStatus();
    ['ko','kund'].forEach(k=>{ const el=skEl('skHeard_'+k); if(!el) return; const h=skHeardText(k); el.innerHTML=`<span class="status-dot ${h.cls}"></span>${skEsc(h.text)}`; });
  }
  function skUpdateOwner(){
    skDrawStatus();
    const el=skEl('skOwner'); if(!el) return;
    el.innerHTML=SK.owner?`<p class="rx-sub">Kundskärmen är kopplad till <strong>${skEsc(SK.owner)}</strong>s kassa.</p><button type="button" class="btn" data-sk-disconnect>Koppla från</button>`:'<p class="rx-sub">Ingen kassa är kopplad till kundskärmen. Kassan kopplar den med kundskärmsknappen i kassan.</p>';
    skSendKund();
  }

  /* ---------- Kassaenheter ---------- */
  function skKassaHtml(){
    return `<p class="adm-intro">Bara registrerade enheter kan använda kassan. Öppna Hantera på den enhet som ska bli kassa och registrera den här.</p>
      <article class="rx-card sk-narrow"><p class="rx-card-kicker">Registrerade kassaenheter</p>
        <div id="devicesAdminList"></div>
        <button id="registerThisDeviceBtn" class="btn btn-green" onclick="registerThisDevice()" style="display:none;">Registrera den här enheten som kassaenhet</button>
        <p id="deviceRegisteredNote" class="rx-sub sk-ok" style="display:none;">✓ Den här enheten är registrerad som kassaenhet.</p>
        <button type="button" class="adm-linkbtn" data-sk-go="oversikt">Se vilka enheter som är igång ›</button>
      </article>`;
  }

  /* ---------- Köskärmen ---------- */
  function skHowTo(kind){
    const ko=kind==='ko';
    return `<details class="sk-howto"><summary>Så startar du ${ko?'köskärmen':'kundskärmen'}</summary><ol>
      <li>Öppna hemsidan på ${ko?'skärmen eller datorn som ska visa kötiden':'surfplattan eller telefonen som står vänd mot gästerna'}.</li>
      <li>Tryck <strong>Personalingång</strong>, skriv <strong>${ko?'kö':'pos'}</strong> som namn och ditt eget lösenord.</li>
      ${ko?'<li>Skärmen visar kötiden och bildspelet direkt. Kötiden uppdateras av sig själv från kassan och insläppet.</li>':'<li>I kassan: tryck på kundskärmsknappen för att koppla skärmen till just den kassan. Varukorgen, Swish-koden och växeln visas då för gästen.</li>'}
      <li>Avsluta med <strong>Esc</strong> på ett tangentbord eller tre snabba tryck på skärmen.</li>
    </ol><p class="tiny">${ko?'Köskärmen':'Kundskärmen'} hämtar ändringar som sparas här inom ett par minuter.</p></details>`;
  }
  function skPreviewHtml(kind){
    const sizes=SK_SIZES[kind]; const cur=localStorage.getItem('skSize_'+kind)||sizes[0][0];
    const ctl=kind==='ko'
      ?`<div class="sk-prev-ctl"><button type="button" class="btn" data-ko-step="-1" aria-label="Föregående bild">‹</button><span class="sk-prev-pos" id="skKoPos" aria-live="polite">Bild 1</span><button type="button" class="btn" data-ko-step="1" aria-label="Nästa bild">›</button><button type="button" class="btn" data-ko-play aria-pressed="${SK.ko.play}">${SK.ko.play?'Pausa':'Spela upp'}</button></div>`
      :`<div class="adm-seg adm-seg--wide sk-states" role="group" aria-label="Vad kundskärmen visar">${SK_STATES.map(([id,l])=>`<button type="button" data-kund-state="${id}" aria-pressed="${SK.kundState===id}">${l}</button>`).join('')}</div><p class="tiny sk-prev-note" id="skKundNote" hidden></p>`;
    return `<aside class="sk-preview" aria-label="Förhandsvisning">
      <div class="adm-preview-bar"><span class="adm-preview-label">Förhandsvisning</span>
        <label class="sk-size"><select data-sk-size="${kind}" aria-label="Skärmstorlek i förhandsvisningen">${sizes.map(([id,l])=>`<option value="${id}"${id===cur?' selected':''}>${l}</option>`).join('')}</select></label></div>
      <div class="adm-preview-frame sk-frame" id="skFrame_${kind}"><span class="sk-frame-tag" id="skTag_${kind}"></span></div>
      ${ctl}
      <p class="tiny">${kind==='ko'?'Kötiden, öppettiden och priserna är dagens riktiga.':'Köpet är ett påhittat exempel.'} Förhandsvisningen sparar ingenting.</p>
    </aside>`;
  }
  function skSaveBar(kind){
    return `<div class="sk-savebar" id="skSave_${kind}"><span class="sk-save-status" id="skSaveStatus_${kind}" aria-live="polite"></span>
      <button type="button" class="btn" data-sk-revert="${kind}">Ångra ändringarna</button><button type="button" class="btn btn-green" data-sk-save="${kind}">Spara ${kind==='ko'?'köskärmen':'kundskärmen'}</button></div>`;
  }
  function skKoHtml(){
    const d=SK.draft;
    return `<p class="adm-intro">Köskärmen visar kötiden och däremellan prislistan, infotexterna och bilderna i tur och ordning.</p>
      <div class="adm-split sk-split"><div class="adm-split-main sk-edit">
        <p class="sk-heard" id="skHeard_ko"></p>
        ${skHowTo('ko')}
        <article class="rx-card"><p class="rx-card-kicker">Bildspelet</p>
          <label class="rx-switch"><input type="checkbox" data-sk-f="prices"${d.prices?' checked':''}><span>Visa prislistan<small class="sk-sub">Priserna hämtas från Produkter &amp; priser. Interna produkter visas inte.</small></span></label>
          <label class="rx-field sk-sec"><span>Tid per bild</span><select data-sk-f="slideSec">${[5,8,10,12,15,20,30].map(n=>`<option value="${n}"${n===d.slideSec?' selected':''}>${n} sekunder</option>`).join('')}</select></label>
          <p class="tiny">Kötiden visas mellan varje bild. Med fler bilder tar det längre tid innan samma bild kommer tillbaka.</p>
        </article>
        <article class="rx-card"><p class="rx-card-kicker">Infotexter</p>
          <p class="rx-sub">Varje text blir en egen bild med loggan ovanför. Korta texter syns bäst på avstånd.</p>
          <div class="adm-list-editor sk-ticker" id="skTicker"></div>
        </article>
        <article class="rx-card"><p class="rx-card-kicker">Bilder</p>
          <p class="rx-sub">Bilderna visas över hela skärmen i den här ordningen.</p>
          <div id="skImages"></div>
          <p class="sk-pick-label">Hotellets bilder</p>
          <div class="adm-image-picker" id="skPicker"></div>
          <button type="button" class="btn sk-add-link" data-sk-addimg>Lägg till egen bildlänk</button>
        </article>
        ${skSaveBar('ko')}
      </div>${skPreviewHtml('ko')}</div>`;
  }
  function skDrawTicker(){
    const root=skEl('skTicker'); if(!root) return;
    admListEditor(root,SK.draft.ticker.map(t=>({t})),{fields:[{key:'t',ph:'T.ex. Välkommen in i värmen!'}],addLabel:'Lägg till text',onChange:list=>{
      SK.draft.ticker=list.map(x=>String(x.t||'').replace(/\|/g,'/'));
      skChanged('ko');
      // "|" skiljer texterna åt i posten och byts därför mot "/"
      const ae=document.activeElement; if(ae&&root.contains(ae)&&ae.value.includes('|')){ const p=ae.selectionStart; ae.value=ae.value.replace(/\|/g,'/'); ae.setSelectionRange(p,p); }
      const i=[...root.querySelectorAll('.adm-li')].indexOf(ae?.closest('.adm-li'));
      if(i>=0) skKoShow('info',i);
    }});
    root.querySelectorAll('input').forEach(i=>i.maxLength=140);
    if(!SK.draft.ticker.length) root.insertAdjacentHTML('afterbegin','<p class="rx-empty">Inga infotexter. Lägg till en om du vill.</p>');
    // Skriver man i en text visar förhandsvisningen den bilden
    root.onfocusin=e=>{ const row=e.target.closest('.adm-li'); if(!row) return; const i=[...root.querySelectorAll('.adm-li')].indexOf(row); skKoShow('info',i); };
  }
  function skImgName(u){ const hit=SK_HOTEL_IMAGES.find(([f])=>movedImageUrl(u).endsWith(f)); if(hit) return hit[1]; const s=String(u).replace(/^https?:\/\//,'').split('?')[0]; return s.length>34?'…'+s.slice(-32):s; }
  function skDrawImages(){
    const list=SK.draft.images; const el=skEl('skImages'), pick=skEl('skPicker'); if(!el||!pick) return;
    el.innerHTML=list.length?`<ol class="sk-thumbs">${list.map((u,i)=>`<li class="sk-thumb" data-img="${i}"><button type="button" class="sk-thumb-img" data-img-show="${i}" aria-label="Visa ${skEsc(skImgName(u))} i förhandsvisningen"><img src="${skEsc(movedImageUrl(u))}" alt="" loading="lazy" onerror="this.closest('.sk-thumb').classList.add('is-broken')"></button>
      <span class="sk-thumb-name">${skEsc(skImgName(u))}</span><span class="sk-thumb-bad">Bilden kunde inte laddas. Kontrollera länken.</span>
      <div class="adm-li-tools"><button type="button" data-img-mv="-1" aria-label="Flytta tidigare"${i===0?' disabled':''}>↑</button><button type="button" data-img-mv="1" aria-label="Flytta senare"${i===list.length-1?' disabled':''}>↓</button><button type="button" data-img-rm aria-label="Ta bort bilden">✕</button></div></li>`).join('')}</ol>`:'<p class="rx-empty">Inga bilder i bildspelet. Välj bland hotellets bilder nedan.</p>';
    const cur=list.map(u=>movedImageUrl(u));
    pick.innerHTML=SK_HOTEL_IMAGES.map(([f,l])=>{ const on=cur.includes(skBase()+f); return `<button type="button" class="adm-img" data-pick="${f}" aria-pressed="${on}"><img src="${f}" alt="" loading="lazy"><span>${l}</span></button>`; }).join('');
  }
  async function skAddImageLink(){
    const raw=await uiPrompt('Adress till bilden (börjar med https://)','',{title:'Egen bildlänk',okLabel:'Lägg till',inputMode:'url'});
    if(raw==null) return; const u=String(raw).trim(); if(!u) return;
    if(!/^https?:\/\/\S+$/i.test(u)){ notify('Skriv hela adressen, till exempel https://exempel.se/bild.jpg.','error'); return; }
    if(SK.draft.images.includes(u)){ notify('Bilden finns redan i bildspelet.','info'); return; }
    SK.draft.images.push(u); skDrawImages(); skChanged('ko'); skKoShow('image',SK.draft.images.length-1);
  }
  // Vilken bild i bildspelet som visar en viss infotext eller bild. Ordningen följer buildDisplaySlides i app.js:
  // prislistan, infotexterna, bilderna – med kötiden före var och en.
  function skKoShow(type,i){
    const d=SK.draft; const prices=d.prices&&loadProducts().some(p=>Number(p.price)>0&&!p.internal);
    const texts=d.ticker.filter(t=>String(t).trim()); let c;
    if(type==='prices') c=0; else if(type==='info'){ const before=d.ticker.slice(0,i).filter(t=>String(t).trim()).length; if(!String(d.ticker[i]||'').trim()) return; c=(prices?1:0)+before; }
    else c=(prices?1:0)+texts.length+i;
    SK.ko.play=false; skSyncPlayBtn(); skSendKo(2*c+1);
  }

  /* ---------- Kundskärmen ---------- */
  function skKundHtml(){
    const d=SK.draft;
    return `<p class="adm-intro">Kundskärmen står vänd mot gästerna vid kassan och visar köpet, Swish-koden och växeln.</p>
      <div class="adm-split sk-split"><div class="adm-split-main sk-edit">
        <p class="sk-heard" id="skHeard_kund"></p>
        ${skHowTo('kund')}
        <article class="rx-card"><p class="rx-card-kicker">Koppling</p><div id="skOwner"><p class="rx-sub">Kollar vilken kassa som är kopplad…</p></div></article>
        <article class="rx-card"><p class="rx-card-kicker">Swish</p>
          <label class="rx-field"><span>Swish-nummer</span><input data-sk-f="swish" inputmode="numeric" autocomplete="off" placeholder="t.ex. 123 456 78 90" value="${skEsc(d.swish)}"></label>
          <p class="sk-hint" id="skSwishHint" aria-live="polite"></p>
          <p class="tiny">Numret sparas för alla kassor. Kundskärmen gör en QR-kod av numret och köpets summa.</p>
        </article>
        <article class="rx-card"><p class="rx-card-kicker">Texter</p>
          <div class="rx-fields rx-fields--stack">
            <label class="rx-field"><span>När ingen handlar</span><input data-sk-f="cdWelcome" maxlength="140" placeholder="${skEsc(DISPLAY_DEFAULTS.cdWelcome)}" value="${skEsc(d.cdWelcome)}"></label>
            <label class="rx-field"><span>Efter köpet, rubrik</span><input data-sk-f="cdThanks" maxlength="140" placeholder="${skEsc(DISPLAY_DEFAULTS.cdThanks)}" value="${skEsc(d.cdThanks)}"></label>
            <label class="rx-field"><span>Efter köpet, undertext</span><input data-sk-f="cdThanksSub" maxlength="140" placeholder="${skEsc(DISPLAY_DEFAULTS.cdThanksSub)}" value="${skEsc(d.cdThanksSub)}"></label>
          </div>
          <p class="tiny">Lämna en ruta tom för att använda texten som står i den.</p>
        </article>
        ${skSaveBar('kund')}
      </div>${skPreviewHtml('kund')}</div>`;
  }
  // Ett Swish-nummer har tio siffror: ett företagsnummer (123…) eller ett vanligt mobilnummer (07…). Båda godtas.
  function skSwishCheck(n){
    if(!n) return {ok:true,lvl:'warn',text:'Inget Swish-nummer. Utan nummer kan kundskärmen inte visa någon QR-kod; gästen ser varukorgen i stället.'};
    if(!/^\d{10}$/.test(n)) return {ok:false,lvl:'err',text:`Ett Swish-nummer har tio siffror. Det här har ${n.length}.`};
    if(/^123/.test(n)) return {ok:true,lvl:'ok',text:`Ser rätt ut: ${n.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/,'$1 $2 $3 $4')}.`};
    if(/^07/.test(n)) return {ok:true,lvl:'ok',text:`Ser rätt ut: ${n.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/,'$1-$2 $3 $4')}.`};
    return {ok:true,lvl:'warn',text:'Swish-nummer börjar oftast på 123 (företag) eller 07 (mobil). Kontrollera att numret stämmer.'};
  }
  function skValidateSwish(){
    const el=skEl('skSwishHint'); if(!el) return;
    const c=skSwishCheck(SK.draft.swish);
    const local=SK.swishLocalOnly&&SK.draft.swish===getSwishNumber()?' Numret fanns bara i den här webbläsaren. Spara för att alla kassor ska få det.':'';
    el.className='sk-hint sk-hint--'+c.lvl; el.textContent=c.text+local;
  }
  // Ett påhittat köp av det som finns i kassan, för förhandsvisningen
  function skExampleSale(){
    const prods=loadProducts().filter(p=>Number(p.price)>0);
    const adult=prods.find(p=>/vuxen/i.test(p.name))||prods[0], child=prods.find(p=>/barn/i.test(p.name)&&p!==adult)||prods.find(p=>p!==adult);
    const items=[adult&&{name:adult.name,qty:2,price:Number(adult.price)},child&&{name:child.name,qty:1,price:Number(child.price)}].filter(Boolean);
    if(!items.length) items.push({name:'Vuxenbiljett',qty:2,price:50});
    const total=items.reduce((s,it)=>s+it.qty*it.price,0);
    return {items,total};
  }
  function skKundData(){
    const {items,total}=skExampleSale(); const st=SK.kundState; const n=SK.draft.swish; const okNum=/^\d{10}$/.test(n);
    const note=skEl('skKundNote');
    if(note){ const show=st==='swish'&&!okNum; note.hidden=!show; note.textContent=show?'Utan ett giltigt Swish-nummer visar kundskärmen varukorgen i stället för QR-koden.':''; }
    if(st==='idle') return {state:'idle'};
    if(st==='tack') return {state:'tack'};
    if(st==='swish'&&okNum) return {state:'swish',total,qrUrl:buildSwishQrUrl(n,total)};
    if(st==='kontant'){ const got=Math.ceil((total+1)/100)*100; return {state:'kontant',items,total,change:got-total}; }
    return {state:'cart',items,total};
  }

  /* ---------- Förhandsvisningen ---------- */
  function skMountPreview(kind){
    const wrap=skEl('skFrame_'+kind); if(!wrap) return;
    const sizes=SK_SIZES[kind]; const id=localStorage.getItem('skSize_'+kind); const [,,w,h]=sizes.find(s=>s[0]===id)||sizes[0];
    wrap.style.aspectRatio=`${w} / ${h}`;
    let fr=wrap.querySelector('iframe');
    if(!fr){ fr=document.createElement('iframe'); fr.title=kind==='ko'?'Förhandsvisning av köskärmen':'Förhandsvisning av kundskärmen'; fr.tabIndex=-1; fr.setAttribute('aria-hidden','true'); fr.src=`index.html?preview&skarm=${kind}`; wrap.prepend(fr); }
    fr.style.width=w+'px'; fr.style.height=h+'px';
    const fit=()=>{ const k=wrap.clientWidth/w; fr.style.transform=`scale(${k})`; };
    fit();
    if(SK.frames[kind]?.ro) SK.frames[kind].ro.disconnect();
    const ro=new ResizeObserver(fit); ro.observe(wrap);
    const was=SK.frames[kind];
    SK.frames[kind]={el:fr,ready:!!(was&&was.el===fr&&was.ready),ro,w,h};
    skUpdateTag(kind);
    if(SK.frames[kind].ready){ if(kind==='ko') skSendKo(SK.ko.i); else skSendKund(); }
  }
  function skPost(kind,msg){ const f=SK.frames[kind]; if(!f||!f.ready||!f.el.contentWindow) return; f.el.contentWindow.postMessage({korpenSkarm:1,toPreview:1,...msg},SKARM_MSG_ORIGIN); }
  function skKoCfg(){ const d=SK.draft; return {ticker:skTickerStr(d.ticker),images:skImagesStr(d.images),settings:{slideSec:d.slideSec,prices:d.prices}}; }
  function skSendKo(slide){ skPost('ko',{cfg:skKoCfg(),slide:typeof slide==='number'?slide:undefined,play:SK.ko.play}); }
  function skSendKund(){ const d=SK.draft; if(!d) return; skPost('kund',{settings:{cdWelcome:d.cdWelcome,cdThanks:d.cdThanks,cdThanksSub:d.cdThanksSub},owner:SK.owner,data:skKundData()}); }
  // Fördröjd sändning medan man skriver, så att förhandsvisningen inte ritas om vid varje tangent
  function skSendSoon(kind,ms=180){ clearTimeout(SK.sendTimer[kind]); SK.sendTimer[kind]=setTimeout(()=>kind==='ko'?skSendKo():skSendKund(),ms); }
  window.addEventListener('message',e=>{
    if(!e.data||e.data.korpenSkarm!==1||e.data.toPreview) return;
    const kind=e.data.kind; const f=SK.frames[kind]; if(!f||e.source!==f.el.contentWindow) return;
    if(e.data.ready){ f.ready=true; if(kind==='ko') skSendKo(0); else skSendKund(); return; }
    if(kind==='ko'&&typeof e.data.i==='number'){ Object.assign(SK.ko,{i:e.data.i,count:e.data.count,types:e.data.types||[]}); skKoPos(); }
  });
  const SK_SLIDE_NAMES={queue:'Kötid',prices:'Prislistan',info:'Infotext',image:'Bild'};
  function skKoPos(){ const el=skEl('skKoPos'); if(!el) return; el.textContent=`Bild ${SK.ko.i+1} av ${SK.ko.count} · ${SK_SLIDE_NAMES[SK.ko.types[SK.ko.i]]||''}`; }
  function skSyncPlayBtn(){ const b=document.querySelector('#admSkarmar [data-ko-play]'); if(b){ b.textContent=SK.ko.play?'Pausa':'Spela upp'; b.setAttribute('aria-pressed',String(SK.ko.play)); } }
  function skUpdateTag(kind){ const t=skEl('skTag_'+kind); if(t) t.textContent=skDirty(kind)?'Utkast · inte sparat':'Så ser skärmen ut'; const fr=skEl('skFrame_'+kind); if(fr) fr.classList.toggle('is-draft',skDirty(kind)); }

  /* ---------- Ändringar och sparande ---------- */
  function skChanged(kind){ skUpdateSaveBar(kind); skUpdateDirty(); skUpdateTag(kind); skSendSoon(kind); }
  function skUpdateSaveBar(kind){
    const st=skEl('skSaveStatus_'+kind), bar=skEl('skSave_'+kind); if(!st||!bar) return;
    const dirty=skDirty(kind); const bad=kind==='kund'&&!skSwishCheck(SK.draft.swish).ok;
    bar.classList.toggle('is-dirty',dirty);
    st.textContent=SK.saving===kind?'Sparar…':bad?'Rätta Swish-numret innan du sparar.':dirty?'Du har ändringar som inte är sparade.':'Allt är sparat.';
    const save=bar.querySelector('[data-sk-save]'), rev=bar.querySelector('[data-sk-revert]');
    save.hidden=rev.hidden=!dirty&&SK.saving!==kind;
    save.disabled=bad||SK.saving===kind; rev.disabled=SK.saving===kind;
  }
  async function skSave(kind){
    if(!skDirty(kind)||SK.saving) return;
    const d=SK.draft, s=SK.saved;
    if(kind==='kund'&&!skSwishCheck(d.swish).ok){ notify('Rätta Swish-numret först.','error'); return; }
    if(kind==='kund'&&s.swish&&!d.swish&&!(await uiConfirm('Ta bort Swish-numret? Kundskärmen kan då inte visa någon QR-kod.',{okLabel:'Ta bort numret',danger:true}))) return;
    SK.saving=kind; skUpdateSaveBar(kind);
    const writes=[];
    const settingsNew=kind==='ko'?skSettingsJson(d,s):skSettingsJson(s,d), settingsOld=skSettingsJson(s,s);
    if(kind==='ko'){
      if(skTickerStr(d.ticker)!==skTickerStr(s.ticker)) writes.push([DISPLAY_TICKER_KEY,skTickerStr(d.ticker)]);
      if(skImagesStr(d.images)!==skImagesStr(s.images)) writes.push([DISPLAY_IMAGES_KEY,skImagesStr(d.images)]);
    }else if(d.swish!==s.swish||SK.swishLocalOnly) writes.push([SWISH_NUMBER_KEY,d.swish]);
    if(settingsNew!==settingsOld) writes.push([DISPLAY_SETTINGS_KEY,settingsNew]);
    try{
      await Promise.all(writes.map(([k,v])=>dbSet(k,v)));
      writes.forEach(([k,v])=>localStorage.setItem(k,v));
      const fields=kind==='ko'?SK_KO_FIELDS:SK_KUND_FIELDS; fields.forEach(f=>{ s[f]=_clone(d[f]); });
      if(kind==='kund') SK.swishLocalOnly=false;
      document.querySelector('.display-view')?._rebuildSlides?.();
      notify(kind==='ko'?'Köskärmen är sparad. Skärmen visar ändringen inom ett par minuter.':'Kundskärmen är sparad. Skärmen och kassorna får ändringen inom ett par minuter.','ok');
    }catch(_e){ notify('Det gick inte att spara. Kontrollera uppkopplingen och försök igen.','error'); }
    SK.saving=''; skUpdateSaveBar(kind); skUpdateDirty(); skUpdateTag(kind); if(kind==='kund') skValidateSwish();
  }
  function skRevert(kind){
    (kind==='ko'?SK_KO_FIELDS:SK_KUND_FIELDS).forEach(f=>{ SK.draft[f]=_clone(SK.saved[f]); });
    if(kind==='kund'&&SK.swishLocalOnly) SK.swishLocalOnly=false;
    skDrawTab();
  }
  async function skDisconnect(){
    if(!(await uiConfirm(`Koppla från kundskärmen från ${SK.owner}s kassa? Skärmen visar då välkomsttexten tills en kassa kopplar den igen.`,{okLabel:'Koppla från'}))) return;
    try{ await apiSet(CUSTOMER_DISPLAY_OWNER_KEY,''); await apiSet(CUSTOMER_DISPLAY_CART_KEY,''); _displayActive=false; updateDisplayBtn(); SK.owner=''; notify('Kundskärmen är frånkopplad.','ok'); }
    catch(_e){ notify('Det gick inte att koppla från. Försök igen.','error'); }
    skUpdateOwner();
  }

  /* ---------- Händelser ---------- */
  function skOnClick(e){
    const t=e.target.closest('[data-sk-tab]'); if(t){ skSetTab(t.dataset.skTab); skDrawTab(); return; }
    const go=e.target.closest('[data-sk-go]'); if(go){ skSetTab(go.dataset.skGo); skDrawTab(); admById('admSkarmar')?.scrollIntoView({block:'start',behavior:'smooth'}); return; }
    const sv=e.target.closest('[data-sk-save]'); if(sv){ skSave(sv.dataset.skSave); return; }
    const rv=e.target.closest('[data-sk-revert]'); if(rv){ skRevert(rv.dataset.skRevert); return; }
    if(e.target.closest('[data-sk-disconnect]')){ skDisconnect(); return; }
    if(e.target.closest('[data-sk-addimg]')){ skAddImageLink(); return; }
    const pk=e.target.closest('[data-pick]'); if(pk){ const u=skBase()+pk.dataset.pick; const list=SK.draft.images; const i=list.findIndex(x=>movedImageUrl(x)===u); if(i>=0) list.splice(i,1); else list.push(u); skDrawImages(); skChanged('ko'); if(i<0) skKoShow('image',list.length-1); return; }
    const im=e.target.closest('[data-img]');
    if(im){ const i=Number(im.dataset.img); const list=SK.draft.images;
      if(e.target.closest('[data-img-show]')){ skKoShow('image',i); return; }
      if(e.target.closest('[data-img-rm]')){ list.splice(i,1); skDrawImages(); skChanged('ko'); return; }
      const mv=e.target.closest('[data-img-mv]'); if(mv){ const j=i+Number(mv.dataset.imgMv); if(j<0||j>=list.length) return; [list[i],list[j]]=[list[j],list[i]]; skDrawImages(); skChanged('ko'); skKoShow('image',j); return; }
    }
    const st=e.target.closest('[data-ko-step]'); if(st){ SK.ko.play=false; skSyncPlayBtn(); skSendKo(SK.ko.i+Number(st.dataset.koStep)); return; }
    if(e.target.closest('[data-ko-play]')){ SK.ko.play=!SK.ko.play; skSyncPlayBtn(); skSendKo(); return; }
    const ks=e.target.closest('[data-kund-state]'); if(ks){ SK.kundState=ks.dataset.kundState; document.querySelectorAll('#admSkarmar [data-kund-state]').forEach(b=>b.setAttribute('aria-pressed',String(b===ks))); skSendKund(); return; }
  }
  function skOnInput(e){
    const f=e.target.dataset?.skF; if(!f||!SK.draft) return;
    if(f==='swish'){ SK.draft.swish=normSwishNumber(e.target.value); skValidateSwish(); skSetKundState('swish'); skChanged('kund'); return; }
    if(f==='cdWelcome'||f==='cdThanks'||f==='cdThanksSub'){ SK.draft[f]=e.target.value.trim().slice(0,140); skSetKundState(f==='cdWelcome'?'idle':'tack'); skChanged('kund'); return; }
  }
  function skOnChange(e){
    const sz=e.target.dataset?.skSize; if(sz){ localStorage.setItem('skSize_'+sz,e.target.value); skMountPreview(sz); return; }
    const f=e.target.dataset?.skF; if(!f||!SK.draft) return;
    if(f==='prices'){ SK.draft.prices=e.target.checked; skChanged('ko'); if(e.target.checked) skKoShow('prices'); return; }
    if(f==='slideSec'){ SK.draft.slideSec=Number(e.target.value)||8; skChanged('ko'); return; }
  }
  function skSetKundState(s){ if(SK.kundState===s) return; SK.kundState=s; document.querySelectorAll('#admSkarmar [data-kund-state]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kundState===s))); }
