/* ============================== REDIGERA SIDAN ==============================
   All redigering av gästsidan på ett ställe: admin öppnar sidan i helskärm (Hantera › Redigera sidan)
   och trycker på det som ska ändras. Två slags innehåll:
   1. Fasta texter, bilder och avsnitt i index.html. Skriptet laddas FÖRE ui.js och app.js och sparar originalen
      innan något hinner ändras. Varje text får en nyckel av sitt ursprungliga innehåll (hash + ordningsnummer);
      ändras originalet i koden slutar den gamla ändringen att gälla i stället för att hamna fel.
      Sparas i en post i Apps Script (siteContentV1) och läggs ovanpå originalen hos alla besökare:
        { v:1, t:{nyckel:html}, i:{nyckel:{src,alt}}, h:{avsnittsId:true}, o:{nyckel:{x:utdrag}}, at, by }
   2. Inställningar som app.js redan visar (SETTINGS nedan): rubrikerna i hero, säsongsmeddelandet, frågorna och
      länkarna till sociala medier. De sparas i sina gamla nycklar, så att äldre kod och ändringsloggen fungerar som förut.
   Allt som läses från servern tvättas (bara enkla textelement och säkra länkar), eftersom posterna kan skrivas utan riktig inloggning.
   Sidan redigeras i en iframe (index.html?preview&redigera) som sparar via föräldern, där admin är inloggad. */

/* Bilderna flyttades från roten till bilder/ (3 okt 2026). Sparade adresser på servern (skärmarnas bilder,
   ändrade bilder på gästsidan) kan peka på den gamla platsen; den här pekar om dem. Används även av app.js och admin.js. */
function movedImageUrl(u){
  u=String(u||'').trim();
  if(/^https?:/i.test(u)&&!u.startsWith(location.origin+'/')&&!/^https?:\/\/spokhotellet\.github\.io\//i.test(u)) return u;
  if(/(^|\/)bilder\//.test(u)) return u;
  return u.replace(/(^|\/)(lager\/[^/?#]+|(?:hotellarkiv-1936(?:-mobil|-staende)?|personalen-1936|vykort-korpen)\.jpg|(?:hotell-korpen|korpen|REP)\.png)$/,'$1bilder/$2');
}

(function(){
  'use strict';
  const KEY='siteContentV1';
  const QS=new URLSearchParams(location.search);
  const IN_FRAME=QS.has('redigera')&&QS.has('preview')&&window.parent!==window;
  const INLINE=new Set(['EM','STRONG','B','I','U','S','BR','SMALL','SPAN','A','SUP','SUB','MARK','ABBR','TIME','Q','CITE']);
  const UNIT=new Set(['H1','H2','H3','H4','H5','H6','P','LI','DT','DD','FIGCAPTION','BLOCKQUOTE','TD','TH','CAPTION','LEGEND','LABEL','SUMMARY','BUTTON','A','SPAN','SMALL','EM','STRONG','B','I','Q','CITE','TIME','DIV']);
  const SKIP='script,style,noscript,template,svg,select,textarea,option,iframe,canvas,[contenteditable],[data-st-skip],.st-ui';
  const SETTINGS=[
    {k:'welcomeHotelNameV1',sel:'#welcomeHotelName',type:'line',label:'Liten rubrik över loggan',def:'Välkommen'},
    {k:'welcomeHeadlineV1',sel:'#welcomeHeadline',type:'line',label:'Rubrik',ph:'Tryck för att skriva en rubrik'},
    {k:'welcomeTaglineV1',sel:'#welcomeTagline',type:'line',label:'Undertext',ph:'Tryck för att skriva en undertext'},
    {k:'welcomeTextV1',sel:'#welcomeInfoText',type:'text',label:'Säsongsmeddelande',ph:'Inget säsongsmeddelande just nu. Tryck för att skriva ett.'},
    {k:'welcomeFaqV1',sel:'#welcomeInfoPanel',type:'faq',label:'Frågor och svar',ph:'Inga frågor ännu. Tryck för att lägga till.'},
    {k:'social',sel:'.js-social-ig,.js-social-fb,#socialIgBtn,#socialFbBtn',type:'social',label:'Sociala medier'}
  ];
  const S_KEYS=['welcomeHotelNameV1','welcomeHeadlineV1','welcomeTaglineV1','welcomeTextV1','welcomeFaqV1','socialInstagramV1','socialFacebookV1'];
  const REG=new Map();          // nyckel → {key, kind:'t'|'i', el, orig, applied}
  let CONTENT=blank();          // det som är sparat på servern
  let DRAFT=blankDraft();       // osparade ändringar i redigeringsläget
  const ED={on:false, cur:null, bar:null, pop:null};

  function blank(){ return {v:1,t:{},i:{},h:{},o:{},at:0,by:''}; }
  function blankDraft(){ return {t:{},i:{},h:{},s:{}}; }
  const PARTS=['t','i','h'];
  const obj=x=>(x&&typeof x==='object'&&!Array.isArray(x))?x:{};
  function normalize(c){
    if(typeof c==='string'){ try{ c=JSON.parse(c); }catch(_e){ c=null; } }
    c=JSON.parse(JSON.stringify(obj(c))); return {v:1,t:obj(c.t),i:obj(c.i),h:obj(c.h),o:obj(c.o),at:Number(c.at)||0,by:String(c.by||'')};
  }
  const squash=s=>String(s||'').replace(/\s+/g,' ').trim();
  function hash(s){ let h=0x811c9dc5; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193); } return (h>>>0).toString(36); }
  function textOf(html){ const d=document.createElement('div'); d.innerHTML=html; return squash(d.textContent); }
  const cut=(s,n=70)=>s.length>n?s.slice(0,n-1)+'…':s;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- Säkerhet: bara enkla textelement och säkra adresser ---------- */
  function safeUrl(u){
    u=String(u||'').trim();
    if(/^https?:\/\/[^\s"'<>]+$/i.test(u)||/^(mailto:|tel:)[^\s"'<>]+$/i.test(u)||/^#[\w-]*$/.test(u)||/^[\w\-./%?=&~]+$/.test(u)) return u;
    return '';
  }
  const webUrl=u=>/^https?:\/\/[^\s"'<>]+\.[^\s"'<>]+$/i.test(String(u||'').trim());
  function clean(html){
    const doc=new DOMParser().parseFromString('<body>'+String(html??'')+'</body>','text/html');
    const out=document.createElement('div');
    (function copy(src,dst){
      for(const n of src.childNodes){
        if(n.nodeType===3){ dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if(n.nodeType!==1) continue;
        if(/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|IFRAME|OBJECT|EMBED|SVG|MATH|TEXTAREA|SELECT)$/i.test(n.tagName)) continue;
        if(!INLINE.has(n.tagName)){ if(dst.lastChild&&/^(DIV|P|LI)$/.test(n.tagName)) dst.appendChild(document.createElement('br')); copy(n,dst); continue; }
        const e=document.createElement(n.tagName);
        ['class','aria-hidden','title','lang'].forEach(a=>{ if(n.hasAttribute(a)) e.setAttribute(a,n.getAttribute(a)); });
        if(n.tagName==='A'){ const h=safeUrl(n.getAttribute('href')); if(h) e.setAttribute('href',h); if(n.getAttribute('target')==='_blank'){ e.target='_blank'; e.rel='noopener'; } }
        copy(n,e); dst.appendChild(e);
      }
    })(doc.body,out);
    return out.innerHTML.replace(/(<br>)+$/,'');
  }

  /* ---------- Inventering av gästsidan (körs innan app.js ändrar något) ---------- */
  function hasJsHook(el){ return !!el.id||/(^|\s)js-/.test(el.getAttribute('class')||'')||[...el.attributes].some(a=>/^on/i.test(a.name)); }
  function isUnit(el){
    if(!UNIT.has(el.tagName)||hasJsHook(el)&&el.tagName!=='BUTTON'||el.id) return false;
    if(!squash(el.textContent)) return false;
    for(const d of el.querySelectorAll('*')){ if(!INLINE.has(d.tagName)||hasJsHook(d)) return false; }
    if(el.tagName==='BUTTON'&&el.children.length) return false;
    if(el.tagName==='DIV'||el.tagName==='SPAN'){ if(![...el.childNodes].some(n=>n.nodeType===3&&n.nodeValue.trim())) return false; }
    return true;
  }
  function scan(){
    const root=document.getElementById('welcomeMessage'); if(!root) return;
    const seen=new Map();
    const add=(kind,base,el,orig)=>{ const n=(seen.get(kind+base)||0)+1; seen.set(kind+base,n); const key=kind+base+'-'+n; el.dataset.st=key; REG.set(key,{key,kind,el,orig,applied:null}); };
    (function walk(el){
      for(const c of el.children){
        if(c.matches(SKIP)) continue;
        if(c.tagName==='IMG'){ const src=c.getAttribute('src')||''; if(src) add('i',hash(src.replace(/^bilder\//,'')),c,{src,alt:c.getAttribute('alt')||'',srcset:c.getAttribute('srcset')}); continue; }
        if(isUnit(c)){ const h=squash(c.innerHTML); add('t',hash(h),c,c.innerHTML); continue; }
        walk(c);
      }
    })(root);
  }
  const sections=()=>[...document.querySelectorAll('#ghMain > section[id]')];
  function sectionName(id){ const s=document.getElementById(id); const h=s&&s.querySelector('h2,h3'); return h?squash(h.textContent):id; }

  /* ---------- Lägg ändringarna ovanpå originalen ---------- */
  function effective(){
    const c=normalize(CONTENT);
    PARTS.forEach(s=>Object.entries(DRAFT[s]).forEach(([k,v])=>{ if(v==null||(s==='h'&&!v)) delete c[s][k]; else c[s][k]=v; }));
    return c;
  }
  function applyAll(){
    const c=ED.on?effective():CONTENT;
    for(const r of REG.values()){
      if(ED.cur&&ED.cur.r===r) continue;
      if(r.kind==='t'){
        const cur=r.el.innerHTML;
        if(cur!==r.orig&&cur!==r.applied) continue; // koden har själv skrivit om texten, låt den vara
        const want=c.t[r.key];
        if(want==null){ if(r.applied!=null){ r.el.innerHTML=r.orig; r.applied=null; } }
        else if(r.src!==want||r.applied==null){ r.el.innerHTML=clean(want); r.applied=r.el.innerHTML; r.src=want; }
        r.el.classList.toggle('st-changed',ED.on&&want!=null);
      }else{
        const want=c.i[r.key]; const src=want&&safeUrl(movedImageUrl(want.src));
        if(r.el.getAttribute('src')!==r.orig.src&&r.el.getAttribute('src')!==r.applied) continue;
        if(src){ r.el.setAttribute('src',src); r.el.removeAttribute('srcset'); if(want.alt!=null) r.el.alt=String(want.alt); r.applied=src; }
        else if(r.applied!=null){ r.el.setAttribute('src',r.orig.src); r.el.alt=r.orig.alt; if(r.orig.srcset) r.el.setAttribute('srcset',r.orig.srcset); r.applied=null; }
        r.el.classList.toggle('st-changed',ED.on&&!!src);
      }
    }
    for(const s of sections()){
      const off=!!c.h[s.id];
      s.classList.toggle('st-sec-off',off&&!ED.on);
      s.classList.toggle('st-sec-dim',off&&ED.on);
      document.querySelectorAll(`#ghLinks a[href="#${s.id}"]`).forEach(a=>a.classList.toggle('st-sec-off',off&&!ED.on));
      const chip=s.querySelector(':scope > .st-sec-chip');
      if(chip){ chip.innerHTML=off?'<span>Dolt för gästerna</span><button type="button">Visa avsnittet</button>':'<button type="button">Dölj avsnittet</button>'; chip.classList.toggle('is-off',off); }
    }
    updateBar();
  }

  /* ---------- Inställningar: rubriker, säsongsmeddelande, frågor och sociala medier ---------- */
  function sSaved(k){ try{ const v=dbGet(k,''); return v==null?'':String(v); }catch(_e){ return ''; } }
  const sGet=k=>Object.prototype.hasOwnProperty.call(DRAFT.s,k)?DRAFT.s[k]:sSaved(k);
  function sSet(k,v){ v=String(v??''); if(v===sSaved(k)) delete DRAFT.s[k]; else DRAFT.s[k]=v; renderSettings(); updateBar(); }
  function renderSettings(){
    try{
      setWelcomeHeroTexts(sGet('welcomeHotelNameV1'),sGet('welcomeHeadlineV1'),sGet('welcomeTaglineV1'));
      setWelcomeText(sGet('welcomeTextV1')); setWelcomeFAQText(sGet('welcomeFaqV1'));
      setSocialLinks(sGet('socialInstagramV1'),sGet('socialFacebookV1'));
    }catch(_e){}
    const changed=k=>k==='social'?['socialInstagramV1','socialFacebookV1'].some(x=>x in DRAFT.s):(k in DRAFT.s);
    SETTINGS.forEach(cfg=>document.querySelectorAll(cfg.sel).forEach(el=>el.classList.toggle('st-changed',ED.on&&changed(cfg.k))));
  }
  function markSettings(on){
    SETTINGS.forEach(cfg=>document.querySelectorAll(cfg.sel).forEach(el=>{
      if(on){ el.dataset.sts=cfg.k; if(cfg.ph) el.dataset.stPh=cfg.ph; }
      else { delete el.dataset.sts; delete el.dataset.stPh; el.classList.remove('st-changed'); }
    }));
  }
  const cfgOf=k=>SETTINGS.find(c=>c.k===k);
  function beginSetting(cfg,el,ev){
    if(ED.cur) commit();
    if(cfg.type==='line') return beginLine(cfg,el,ev);
    if(cfg.type==='text') return editSeasonText(cfg);
    if(cfg.type==='faq') return editFaq();
    if(cfg.type==='social') return editSocial();
  }
  function beginLine(cfg,el,ev){
    const r={kind:'s',cfg,key:cfg.k,el};
    ED.cur={r,inline:true,before:el.innerHTML};
    el.textContent=sGet(cfg.k)||cfg.def||'';
    el.style.opacity='';
    startInline(el,ev);
    showPop(r,`<span class="st-pop-hint">${esc(cfg.label)} · Enter sparar raden</span>
      <div class="st-pop-actions">${sGet(cfg.k)?`<button type="button" class="st-btn st-btn--link" data-p="orig">${cfg.def?'Standardtext':'Ta bort texten'}</button>`:''}<button type="button" class="st-btn" data-p="cancel">Avbryt</button><button type="button" class="st-btn st-btn--primary" data-p="done">Klar</button></div>`);
  }
  function field(label,el){ const w=document.createElement('label'); w.className='ui-dialog-field'; const s=document.createElement('span'); s.className='ui-dialog-label'; s.textContent=label; w.append(s,el); return w; }
  async function editSeasonText(cfg){
    const ta=document.createElement('textarea'); ta.className='ui-dialog-input ui-dialog-textarea'; ta.rows=6; ta.value=sGet(cfg.k);
    ta.placeholder='Till exempel: Nu öppnar vi för säsongen! Välkomna till hotellet.';
    const body=document.createElement('div'); body.append(field('Visas som ett telegram överst på sidan. Lämna tomt för att dölja det.',ta));
    const v=await openDialog({title:'Säsongsmeddelande',body,className:'st-dialog',dismissValue:null,actions:[{label:'Avbryt',value:null},{label:'Använd',value:()=>ta.value,primary:true}]});
    if(v!=null) sSet(cfg.k,v.replace(/\r/g,'').trim());
  }
  const faqParse=t=>String(t||'').trim().split(/\n{2,}/).map(b=>b.trim()).filter(Boolean).map(b=>{ const [q,...a]=b.split('\n'); return {q:q.trim(),a:a.join('\n').trim()}; });
  const faqJoin=l=>l.filter(x=>x.q.trim()||x.a.trim()).map(x=>`${x.q.trim().replace(/\n+/g,' ')}\n${x.a.trim().replace(/\n{2,}/g,'\n')}`).join('\n\n');
  async function editFaq(){
    let list=faqParse(sGet('welcomeFaqV1'));
    const box=document.createElement('div'); box.className='st-faq';
    const read=()=>{ box.querySelectorAll('.st-faq-row').forEach((row,i)=>{ list[i]={q:row.querySelector('input').value,a:row.querySelector('textarea').value}; }); };
    const draw=()=>{
      box.innerHTML=`<p class="st-pop-hint st-faq-hint">Visas under "Bra att veta", i den här ordningen.</p>${list.map((x,i)=>`<div class="st-faq-row"><div class="st-faq-fields"><input class="ui-dialog-input" placeholder="Fråga" value="${esc(x.q)}" aria-label="Fråga ${i+1}"><textarea class="ui-dialog-input ui-dialog-textarea" rows="2" placeholder="Svar" aria-label="Svar ${i+1}">${esc(x.a)}</textarea></div>
        <div class="st-faq-tools"><button type="button" class="st-faq-btn" data-mv="-1" aria-label="Flytta upp"${i?'':' disabled'}>↑</button><button type="button" class="st-faq-btn" data-mv="1" aria-label="Flytta ned"${i<list.length-1?'':' disabled'}>↓</button><button type="button" class="st-faq-btn" data-rm aria-label="Ta bort frågan">✕</button></div></div>`).join('')}
        <button type="button" class="st-faq-add">+ Lägg till fråga</button>`;
    };
    box.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; read();
      if(b.classList.contains('st-faq-add')){ list.push({q:'',a:''}); draw(); const rows=box.querySelectorAll('.st-faq-row input'); rows[rows.length-1]?.focus(); return; }
      const i=[...box.querySelectorAll('.st-faq-row')].indexOf(b.closest('.st-faq-row')); if(i<0) return;
      if(b.hasAttribute('data-rm')) list.splice(i,1); else { const j=i+Number(b.dataset.mv); if(j<0||j>=list.length) return; [list[i],list[j]]=[list[j],list[i]]; }
      draw(); });
    if(!list.length) list.push({q:'',a:''});
    draw();
    const v=await openDialog({title:'Frågor och svar',body:box,className:'st-dialog st-dialog--wide',dismissValue:null,actions:[{label:'Avbryt',value:null},{label:'Använd',value:()=>{ read(); return faqJoin(list); },primary:true}]});
    if(v!=null) sSet('welcomeFaqV1',v);
  }
  async function editSocial(){
    let ig=sGet('socialInstagramV1'), fb=sGet('socialFacebookV1');
    for(;;){
      const a=document.createElement('input'); a.type='url'; a.className='ui-dialog-input'; a.placeholder='https://instagram.com/ert_konto'; a.value=ig;
      const b=document.createElement('input'); b.type='url'; b.className='ui-dialog-input'; b.placeholder='https://facebook.com/er_sida'; b.value=fb;
      const body=document.createElement('div'); body.append(field('Instagram',a),field('Facebook',b));
      const p=document.createElement('p'); p.className='st-pop-hint'; p.textContent='Länkarna används i hero, i receptionens brev och under Kontakt. Lämna tomt om ni inte har kontot.'; body.append(p);
      const v=await openDialog({title:'Sociala medier',body,className:'st-dialog',dismissValue:null,actions:[{label:'Avbryt',value:null},{label:'Använd',value:()=>({ig:a.value.trim(),fb:b.value.trim()}),primary:true}]});
      if(!v) return;
      ig=v.ig; fb=v.fb;
      if((ig&&!webUrl(ig))||(fb&&!webUrl(fb))){ notify('Länken ska vara en hel adress som börjar med https://','error'); continue; }
      sSet('socialInstagramV1',ig); sSet('socialFacebookV1',fb); return;
    }
  }

  function readCache(){
    for(const p of ['dbcache_v1__','practice_dbcache__']){ try{ const raw=localStorage.getItem(p+KEY); if(raw){ const o=JSON.parse(raw); if(o&&'v' in o) return o.v; } }catch(_e){} }
    return null;
  }
  async function refresh(fetchServer=true){
    try{ if(typeof SERVER_JSON_KEYS!=='undefined') SERVER_JSON_KEYS.add(KEY); }catch(_e){}
    if(fetchServer){ try{ await dbFetch(KEY,null); }catch(_e){ return; } }
    try{ CONTENT=normalize(dbGet(KEY,null)); }catch(_e){}
    applyAll(); renderPanel();
  }

  /* ---------- Spara (körs i fönstret där admin är inloggad) ---------- */
  async function save(p){
    if(typeof loggedInUser==='undefined'||!loggedInUser||!isAdmin) throw new Error('Endast admin kan ändra sidan.');
    if(typeof PRACTICE!=='undefined'&&PRACTICE) throw new Error('Avsluta övningsläget först. Ändringar av sidan sparas inte under övningen.');
    p=JSON.parse(JSON.stringify(p||{}));
    const s=obj(p.s);
    for(const [k,v] of Object.entries(s)){
      if(!S_KEYS.includes(k)) delete s[k];
      else if(/^social/.test(k)&&v&&!webUrl(v)) throw new Error('Länken ska vara en hel adress som börjar med https://');
      else s[k]=String(v??'').slice(0,6000);
    }
    const touch=()=>{ try{ _admLastInput=Date.now(); }catch(_e){} }; // så att ändringsloggen tar med sparningen
    for(const [k,v] of Object.entries(s)){ touch(); await dbSet(k,v); }
    if(Object.keys(s).length){ try{ loadWelcomeHeroTexts(); loadWelcomeText(); loadWelcomeFAQ(); loadSocialLinks(); }catch(_e){} }
    const hasContent=PARTS.some(x=>Object.keys(obj(p[x])).length);
    if(hasContent){
      SERVER_JSON_KEYS.add(KEY);
      await dbFetch(KEY,null);
      const cur=normalize(dbGet(KEY,null));
      PARTS.forEach(x=>Object.entries(obj(p[x])).forEach(([k,v])=>{ if(v==null||(x==='h'&&!v)) delete cur[x][k]; else cur[x][k]=x==='t'?clean(v):v; }));
      Object.assign(cur.o,obj(p.o));
      Object.keys(cur.o).forEach(k=>{ if(!(k in cur.t)&&!(k in cur.i)) delete cur.o[k]; });
      cur.at=Date.now(); try{ cur.by=_myCanonName(); }catch(_e){}
      touch(); await dbSet(KEY,cur);
      CONTENT=cur;
    }
    applyAll(); renderPanel();
    return JSON.parse(JSON.stringify({content:CONTENT,s}));
  }
  window.siteTextSave=save;

  /* ---------- Redigeringsläget (i iframen) ---------- */
  function dirtyCount(){
    let n=0;
    Object.entries(DRAFT.t).forEach(([k,v])=>{ if((v??null)!==(CONTENT.t[k]??null)) n++; });
    Object.entries(DRAFT.i).forEach(([k,v])=>{ if(JSON.stringify(v??null)!==JSON.stringify(CONTENT.i[k]??null)) n++; });
    Object.entries(DRAFT.h).forEach(([k,v])=>{ if(!!v!==!!CONTENT.h[k]) n++; });
    Object.entries(DRAFT.s).forEach(([k,v])=>{ if(v!==sSaved(k)) n++; });
    return n;
  }
  function start(){
    if(ED.on) return;
    ED.on=true; DRAFT=blankDraft();
    document.body.classList.add('st-editing');
    const bar=document.createElement('div'); bar.className='st-bar st-ui'; bar.setAttribute('role','region'); bar.setAttribute('aria-label','Redigeringsläge');
    bar.innerHTML=`<div class="st-bar-text"><strong>Redigeringsläge</strong><span class="st-bar-hint">Tryck på det du vill ändra: texter, bilder, rubriker, frågor eller länkar.</span></div>
      <span class="st-bar-count" aria-live="polite"></span>
      <div class="st-bar-actions"><button type="button" class="st-btn" data-st-act="discard">Släng</button><button type="button" class="st-btn st-btn--primary" data-st-act="save">Spara och publicera</button></div>`;
    bar.addEventListener('click',e=>{ const b=e.target.closest('[data-st-act]'); if(!b) return; ({discard,save:saveDraft})[b.dataset.stAct](); });
    document.body.appendChild(bar); ED.bar=bar;
    sections().forEach(s=>{ const c=document.createElement('div'); c.className='st-sec-chip st-ui'; s.prepend(c); c.addEventListener('click',e=>{ if(!e.target.closest('button')) return; const off=!effective().h[s.id]; DRAFT.h[s.id]=off; applyAll(); }); });
    markSettings(true);
    applyAll(); renderSettings();
  }
  async function stop(force){
    if(!ED.on) return true;
    commit();
    if(!force&&dirtyCount()&&!(await uiConfirm('Du har ändringar som inte är sparade. Vill du slänga dem?',{okLabel:'Släng ändringarna',danger:true}))) return false;
    DRAFT=blankDraft(); ED.on=false;
    ED.bar?.remove(); ED.bar=null; closePop();
    document.querySelectorAll('.st-sec-chip').forEach(c=>c.remove());
    document.body.classList.remove('st-editing');
    markSettings(false); renderSettings(); applyAll();
    return true;
  }
  function updateBar(){
    if(!ED.bar) return;
    const n=dirtyCount();
    ED.bar.querySelector('.st-bar-count').textContent=n?`${n} ${n===1?'ändring':'ändringar'} att spara`:'Inga osparade ändringar';
    ED.bar.querySelector('[data-st-act="save"]').disabled=!n;
    ED.bar.querySelector('[data-st-act="discard"]').disabled=!n;
    try{ if(IN_FRAME) window.parent.postMessage({type:'st-dirty',n},location.origin); }catch(_e){}
  }
  async function discard(){
    commit();
    if(!dirtyCount()) return;
    if(!(await uiConfirm('Släng alla ändringar som inte är sparade?',{okLabel:'Släng',danger:true}))) return;
    DRAFT=blankDraft(); applyAll(); renderSettings();
  }
  async function saveDraft(){
    commit();
    if(!dirtyCount()) return;
    const o={};
    ['t','i'].forEach(s=>Object.keys(DRAFT[s]).forEach(k=>{ const r=REG.get(k); if(!r) return; o[k]={x:cut(r.kind==='t'?textOf(r.orig):'Bild: '+(r.orig.alt||r.orig.src))}; }));
    const payload={t:DRAFT.t,i:DRAFT.i,h:DRAFT.h,s:DRAFT.s,o};
    const btn=ED.bar?.querySelector('[data-st-act="save"]'); if(btn){ btn.disabled=true; btn.textContent='Sparar…'; }
    try{
      const res=await window.parent.siteTextSave(payload);
      CONTENT=normalize(res.content);
      for(const [k,v] of Object.entries(obj(res.s))){ try{ await dbSet(k,v); }catch(_e){} } // förhandsvisningen sparar bara i minnet
      DRAFT=blankDraft(); applyAll(); renderSettings();
      notify('Sparat. Gästerna ser ändringarna nu.','ok');
    }catch(e){ notify(e&&/admin|övning|https/i.test(e.message)?e.message:'Kunde inte spara till servern. Kontrollera nätet och försök igen.','error'); }
    finally{ if(btn){ btn.textContent='Spara och publicera'; } updateBar(); }
  }

  // Tryck på en text, bild eller inställning
  const TARGET='[data-st],[data-sts]';
  document.addEventListener('pointerdown',e=>{ if(ED.on&&e.target.closest?.(TARGET)&&!e.target.closest('.st-ui')) e.stopPropagation(); },true);
  document.addEventListener('click',e=>{
    if(!ED.on) return;
    const t=e.target; if(!t.closest) return;
    if(t.closest('.st-ui,.ui-dialog-overlay,#uiToasts')) return;
    if(ED.cur&&ED.cur.r.el.contains(t)&&ED.cur.inline) return;
    const u=t.closest(TARGET);
    if(u&&u.getClientRects().length){
      if(u.dataset.sts&&cfgOf(u.dataset.sts)){ e.preventDefault(); e.stopPropagation(); beginSetting(cfgOf(u.dataset.sts),u,e); return; }
      if(REG.has(u.dataset.st)){ e.preventDefault(); e.stopPropagation(); begin(REG.get(u.dataset.st),e); return; }
    }
    if(ED.cur) commit();
    const a=t.closest('a[href]'); if(a&&!/^#/.test(a.getAttribute('href')||'')){ e.preventDefault(); e.stopPropagation(); }
  },true);

  function startInline(el,ev){
    el.contentEditable='true'; el.spellcheck=true; el.classList.add('st-active');
    el.focus({preventScroll:true});
    try{
      let range=null;
      if(ev&&document.caretRangeFromPoint) range=document.caretRangeFromPoint(ev.clientX,ev.clientY);
      else if(ev&&document.caretPositionFromPoint){ const p=document.caretPositionFromPoint(ev.clientX,ev.clientY); if(p){ range=document.createRange(); range.setStart(p.offsetNode,p.offset); } }
      if(!range||!el.contains(range.startContainer)){ range=document.createRange(); range.selectNodeContents(el); range.collapse(false); }
      const sel=getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }catch(_e){}
    el.addEventListener('keydown',onKey); el.addEventListener('paste',onPaste); el.addEventListener('input',placePop);
  }
  function begin(r,ev){
    if(ED.cur) commit();
    if(r.kind==='i'||r.el.tagName==='BUTTON'){ openForm(r); return; }
    ED.cur={r,inline:true,before:r.el.innerHTML};
    startInline(r.el,ev);
    showPop(r,`<span class="st-pop-hint">Enter sparar raden · Skift+Enter ger ny rad</span>
      <div class="st-pop-actions">${isChanged(r)?'<button type="button" class="st-btn st-btn--link" data-p="orig">Originaltexten</button>':''}<button type="button" class="st-btn" data-p="cancel">Avbryt</button><button type="button" class="st-btn st-btn--primary" data-p="done">Klar</button></div>`);
  }
  function isChanged(r){ const c=effective(); return r.kind==='t'?c.t[r.key]!=null:c.i[r.key]!=null; }
  function onKey(e){
    e.stopPropagation();
    const line=ED.cur&&ED.cur.r.kind==='s';
    if(e.key==='Enter'&&(!e.shiftKey||line)){ e.preventDefault(); commit(); }
    else if(e.key==='Enter'){ e.preventDefault(); if(!document.execCommand('insertLineBreak')) document.execCommand('insertHTML',false,'<br>'); }
    else if(e.key==='Escape'){ e.preventDefault(); cancel(); }
  }
  function onPaste(e){ e.preventDefault(); const txt=(e.clipboardData||window.clipboardData).getData('text/plain')||''; document.execCommand('insertText',false,txt.replace(/\r?\n+/g,' ')); }
  function endInline(){
    const c=ED.cur; if(!c||!c.inline) return;
    const el=c.r.el; el.removeAttribute('contenteditable'); el.classList.remove('st-active');
    el.removeEventListener('keydown',onKey); el.removeEventListener('paste',onPaste); el.removeEventListener('input',placePop);
    ED.cur=null; closePop();
  }
  function setText(r,html){
    const same=squash(html)===squash(r.orig);
    if(same) DRAFT.t[r.key]=null; else DRAFT.t[r.key]=html;
    if(same&&CONTENT.t[r.key]==null) delete DRAFT.t[r.key];
    if(!same&&CONTENT.t[r.key]===html) delete DRAFT.t[r.key];
  }
  function commit(){
    const c=ED.cur; if(!c) return;
    if(!c.inline){ closePop(); ED.cur=null; return; }
    const r=c.r;
    if(r.kind==='s'){ let v=squash(r.el.textContent); if(r.cfg.def&&v===r.cfg.def) v=''; endInline(); sSet(r.key,v); return; }
    const html=clean(r.el.innerHTML);
    endInline();
    if(squash(html)!==squash(c.before)) setText(r,html);
    r.applied=null; r.src=undefined; r.el.innerHTML=r.orig; // applyAll lägger på rätt version igen
    applyAll();
  }
  function cancel(){ const c=ED.cur; if(!c) return; if(c.inline) c.r.el.innerHTML=c.before; const s=c.r.kind==='s'; endInline(); if(s) renderSettings(); else applyAll(); }

  // Formulär för bilder och knappar
  function openForm(r){
    const isImg=r.kind==='i'; const c=effective();
    ED.cur={r,inline:false};
    const cur=isImg?(c.i[r.key]||{src:r.orig.src,alt:r.orig.alt}):null;
    const btnText=isImg?'':textOf(c.t[r.key]!=null?c.t[r.key]:r.orig);
    showPop(r,isImg?`<label class="st-field"><span>Bildlänk</span><input type="url" data-f="src" value="${esc(cur.src)}" placeholder="https://… eller lager/bild.jpg"></label>
      <label class="st-field"><span>Beskrivning för skärmläsare</span><input type="text" data-f="alt" value="${esc(cur.alt||'')}"></label>
      <p class="st-pop-hint">Lägg bilden på GitHub eller en annan webbplats och klistra in länken här.</p>`
      :`<label class="st-field"><span>Knappens text</span><input type="text" data-f="txt" value="${esc(btnText)}"></label>`,
      `<div class="st-pop-actions">${isChanged(r)?`<button type="button" class="st-btn st-btn--link" data-p="orig">${isImg?'Originalbilden':'Originaltexten'}</button>`:''}<button type="button" class="st-btn" data-p="cancel">Avbryt</button><button type="button" class="st-btn st-btn--primary" data-p="use">Använd</button></div>`);
    const first=ED.pop.querySelector('input'); setTimeout(()=>{ first.focus(); first.select(); },20);
    ED.pop.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter'){ e.preventDefault(); useForm(); } if(e.key==='Escape'){ e.preventDefault(); closePop(); ED.cur=null; } });
  }
  function useForm(){
    const c=ED.cur; if(!c||c.inline) return; const r=c.r; const f=n=>ED.pop.querySelector(`[data-f="${n}"]`)?.value??'';
    if(r.kind==='i'){
      const src=f('src').trim(), alt=f('alt').trim();
      if(!safeUrl(src)){ notify('Bildlänken fungerar inte. Den ska börja med https:// eller vara en fil på sidan, till exempel lager/bild.jpg.','error'); return; }
      if(src===r.orig.src&&alt===r.orig.alt){ DRAFT.i[r.key]=null; if(CONTENT.i[r.key]==null) delete DRAFT.i[r.key]; }
      else DRAFT.i[r.key]={src,alt};
    }else setText(r,esc(f('txt').trim()));
    closePop(); ED.cur=null; applyAll();
  }
  function toOriginal(){
    const c=ED.cur; if(!c) return; const r=c.r;
    if(c.inline) endInline(); else { closePop(); ED.cur=null; }
    if(r.kind==='s'){ sSet(r.key,''); return; }
    if(r.kind==='t'){ if(CONTENT.t[r.key]!=null) DRAFT.t[r.key]=null; else delete DRAFT.t[r.key]; r.applied=null; r.src=undefined; r.el.innerHTML=r.orig; }
    else { if(CONTENT.i[r.key]!=null) DRAFT.i[r.key]=null; else delete DRAFT.i[r.key]; }
    applyAll();
  }

  // Liten ruta vid det som redigeras
  function showPop(r,...html){
    closePop();
    const p=document.createElement('div'); p.className='st-pop st-ui'; p.innerHTML=html.join('');
    p.addEventListener('mousedown',e=>{ if(e.target.closest('button')) e.preventDefault(); }); // behåll markören i texten
    p.addEventListener('click',e=>{ const b=e.target.closest('[data-p]'); if(!b) return; ({done:commit,cancel:()=>{ if(ED.cur?.inline) cancel(); else { closePop(); ED.cur=null; } },orig:toOriginal,use:useForm})[b.dataset.p](); });
    document.body.appendChild(p); ED.pop=p; ED.popFor=r.el; placePop();
  }
  function placePop(){
    const p=ED.pop, el=ED.popFor; if(!p||!el) return;
    const b=el.getBoundingClientRect(), vw=document.documentElement.clientWidth, ph=p.offsetHeight;
    const left=Math.max(8,Math.min(b.left,vw-p.offsetWidth-8));
    let top=b.bottom+10; if(top+ph>innerHeight-90&&b.top-ph-10>8) top=b.top-ph-10;
    p.style.left=left+'px'; p.style.top=Math.max(8,Math.min(top,innerHeight-ph-8))+'px';
  }
  function closePop(){ ED.pop?.remove(); ED.pop=null; ED.popFor=null; }
  addEventListener('scroll',()=>placePop(),{passive:true,capture:true});
  addEventListener('resize',()=>placePop());

  /* ---------- Hantera › Redigera sidan (i förälderns fönster) ---------- */
  function listRows(){
    const rows=[];
    Object.entries(CONTENT.t).forEach(([k,v])=>{ const r=REG.get(k); rows.push({k,s:'t',kind:'Text',from:r?cut(textOf(r.orig)):(CONTENT.o[k]?.x||''),to:cut(textOf(clean(v))||'(tom)'),gone:!r}); });
    Object.entries(CONTENT.i).forEach(([k,v])=>{ const r=REG.get(k); rows.push({k,s:'i',kind:'Bild',from:r?cut(r.orig.alt||r.orig.src,40):(CONTENT.o[k]?.x||'Bild'),to:cut(String(v&&v.src||''),50),gone:!r}); });
    return rows.sort((a,b)=>a.gone-b.gone);
  }
  function renderPanel(){
    const el=document.getElementById('admSidan'); if(!el||el.hidden) return;
    const rows=listRows(); const hidden=Object.keys(CONTENT.h).filter(id=>CONTENT.h[id]);
    const when=CONTENT.at?`Senast sparat ${new Date(CONTENT.at).toLocaleString('sv-SE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}${CONTENT.by?' av '+esc(CONTENT.by):''}.`:'';
    const val=k=>sSaved(k).trim();
    const faqN=faqParse(val('welcomeFaqV1')).length;
    const setRow=(label,v,empty)=>`<div class="st-set"><dt>${label}</dt><dd${v?'':' class="is-empty"'}>${v?esc(cut(v,80)):empty}</dd></div>`;
    el.innerHTML=`<p class="adm-intro">Här ändrar du allt på gästsidan. Tryck på <strong>Redigera gästsidan</strong> och sedan på det du vill ändra: rubriker, texter, bilder, säsongsmeddelandet, frågorna och länkarna till Instagram och Facebook. Du kan också dölja hela avsnitt. Inget syns för gästerna förrän du sparar.</p>
      <div class="rx-actions st-open"><button type="button" class="btn btn-green" id="stOpenGuest">Redigera gästsidan</button></div>
      <article class="rx-card st-settings"><p class="rx-card-kicker">Just nu på gästsidan</p>
        <dl>${setRow('Rubrik',val('welcomeHeadlineV1'),'Ingen')}${setRow('Undertext',val('welcomeTaglineV1'),'Ingen')}${setRow('Över loggan',val('welcomeHotelNameV1'),'Välkommen (standard)')}
          ${setRow('Säsongsmeddelande',val('welcomeTextV1'),'Inget')}${setRow('Frågor och svar',faqN?`${faqN} ${faqN===1?'fråga':'frågor'}`:'','Inga')}
          ${setRow('Instagram',val('socialInstagramV1'),'Ingen länk')}${setRow('Facebook',val('socialFacebookV1'),'Ingen länk')}</dl></article>
      <h5 class="adm-log-day">Ändrade texter och bilder${rows.length+hidden.length?` (${rows.length+hidden.length})`:''}</h5>
      ${rows.length||hidden.length?`<ul class="adm-log st-list">${rows.map(x=>`<li class="adm-log-row st-row${x.gone?' is-gone':''}"><span class="adm-log-time">${x.kind}</span><div><strong>${esc(x.to)}</strong><span>${x.gone?'Originalet finns inte längre på sidan, så ändringen visas inte. Var: '+esc(x.from):'Original: '+esc(x.from)}</span></div><button type="button" class="btn" data-st-reset="${esc(x.s+':'+x.k)}">${x.gone?'Ta bort':'Återställ'}</button></li>`).join('')}
        ${hidden.map(id=>`<li class="adm-log-row st-row"><span class="adm-log-time">Avsnitt</span><div><strong>”${esc(sectionName(id))}” är dolt</strong><span>Syns inte för gästerna, och länken i menyn är borttagen.</span></div><button type="button" class="btn" data-st-reset="${esc('h:'+id)}">Visa igen</button></li>`).join('')}</ul>`
        :'<p class="rx-empty">Inga fasta texter eller bilder är ändrade. Sidan visar originalen.</p>'}
      ${when?`<p class="tiny muted">${when}</p>`:''}
      <details class="st-help"><summary>Vad ändras på andra ställen?</summary>
        <p>Öppettider och kötid (Översikt och Öppetdagar), priser (Produkter &amp; priser) och gästbokens omdömen (Recensioner) räknas fram från sina egna uppgifter. Layout, nya avsnitt och nya funktioner kräver ändringar i koden.</p></details>
      ${rows.length||hidden.length?'<p><button type="button" class="adm-linkbtn adm-linkbtn--danger" id="stResetAll">Återställ alla texter, bilder och avsnitt till originalet…</button></p>':''}`;
    el.onclick=async e=>{
      const t=e.target;
      if(t.closest('#stOpenGuest')) return openGuestEditor();
      const rb=t.closest('[data-st-reset]');
      if(rb){ const [s,...rest]=rb.dataset.stReset.split(':'); const k=rest.join(':'); rb.disabled=true;
        try{ await save({[s]:{[k]:s==='h'?false:null}}); notify(s==='h'?'Avsnittet visas igen.':'Återställd till originalet.','ok'); }catch(err){ rb.disabled=false; notify(err.message||'Kunde inte spara. Försök igen.','error'); } return; }
      if(t.closest('#stResetAll')){
        if(!(await uiConfirm('Alla ändrade texter och bilder går tillbaka till originalet, och dolda avsnitt visas igen. Rubrikerna, säsongsmeddelandet, frågorna och länkarna påverkas inte. Ändringen kan ångras i ändringsloggen.',{title:'Återställ till originalet?',okLabel:'Återställ',danger:true}))) return;
        const p={t:{},i:{},h:{}}; Object.keys(CONTENT.t).forEach(k=>p.t[k]=null); Object.keys(CONTENT.i).forEach(k=>p.i[k]=null); Object.keys(CONTENT.h).forEach(k=>p.h[k]=false);
        try{ await save(p); notify('Sidan visar originalen igen.','ok'); }catch(err){ notify(err.message||'Kunde inte spara. Försök igen.','error'); }
      }
    };
  }
  async function openPanel(){ renderPanel(); await Promise.all([refresh(true),...S_KEYS.map(k=>dbFetch(k,'').catch(()=>{}))]); renderPanel(); }

  // Helskärm med gästsidan i en iframe
  const GE={wrap:null,frame:null,n:0,mode:'desktop'};
  function openGuestEditor(){
    if(GE.wrap) return;
    const w=document.createElement('div'); w.className='st-guest st-ui'; w.setAttribute('role','dialog'); w.setAttribute('aria-label','Redigera gästsidan');
    const narrow=matchMedia('(max-width: 760px)').matches; GE.mode=narrow?'mobile':'desktop';
    w.innerHTML=`<div class="st-guest-bar"><strong>Redigera gästsidan</strong>
      ${narrow?'':'<div class="adm-seg" role="group" aria-label="Skärmstorlek"><button type="button" data-gv="mobile" aria-pressed="false">Mobil</button><button type="button" data-gv="desktop" aria-pressed="true">Dator</button></div>'}
      <button type="button" class="st-btn" data-gv="close">Stäng</button></div>
      <div class="st-guest-stage"><iframe title="Gästsidan i redigeringsläge" src="index.html?preview&amp;redigera"></iframe></div>`;
    document.body.appendChild(w); document.body.classList.add('st-guest-open');
    GE.wrap=w; GE.frame=w.querySelector('iframe'); GE.n=0; sizeGuest();
    w.addEventListener('click',async e=>{ const b=e.target.closest('[data-gv]'); if(!b) return;
      if(b.dataset.gv==='close') return closeGuestEditor();
      GE.mode=b.dataset.gv; w.querySelectorAll('.adm-seg [data-gv]').forEach(x=>x.setAttribute('aria-pressed',String(x===b))); sizeGuest(); });
  }
  function sizeGuest(){ if(GE.frame) GE.frame.parentElement.classList.toggle('is-mobile',GE.mode==='mobile'); }
  async function closeGuestEditor(){
    if(!GE.wrap) return;
    let ok=true; try{ const api=GE.frame.contentWindow.siteText; if(api) ok=await api.stop(); }catch(_e){}
    if(!ok) return;
    GE.wrap.remove(); GE.wrap=GE.frame=null; GE.n=0; document.body.classList.remove('st-guest-open');
    refresh(false);
  }
  addEventListener('message',e=>{ if(e.origin===location.origin&&e.data&&e.data.type==='st-dirty') GE.n=e.data.n; });
  addEventListener('beforeunload',e=>{ if((ED.on&&dirtyCount())||GE.n){ e.preventDefault(); e.returnValue=''; } });

  /* ---------- Start ---------- */
  scan();
  CONTENT=normalize(readCache());
  applyAll();
  document.addEventListener('DOMContentLoaded',()=>{
    refresh(true).then(async()=>{
      if(!(IN_FRAME&&typeof window.parent.siteTextSave==='function')) return;
      await Promise.all(S_KEYS.map(k=>dbFetch(k,'').catch(()=>{}))); // senaste versionen innan redigeringen börjar
      start();
    });
  });
  window.siteText={refresh:()=>refresh(false),openPanel,stop,dirty:dirtyCount};
})();
