/* ============================== LÖNER ==============================
   Laddas efter app.js och före admin.js. En lekfull uppskattning av vad kvällarna gav personalen, inte ett riktigt löneunderlag.
   Varje kväll räknas för sig med samma formel, och en period är summan av sina kvällar:
     intäkter − utgifter = överskott → minus skatt → minus verksamhetens andel = lönepott
     grundlön per arbetad kväll, resten fördelas efter hur stor del av öppettiden man täckte gånger uppgiftens vikt.
   Volontärer får ingen grundlön. Har de en uppgift som räknas efter försäljning får de en del efter hur mycket de sålde.
   Inställningarna ligger i wageSettingsV1 (bassumma, verksamhetsandel, skatteprocent, task_vikter, task_kassaboost). */

  const LON={ tab:'lon', mode:'senaste', from:'', to:'', open:new Set(), draft:null };
  const lonEsc=s=>escapeHtml(String(s??''));
  const lonKr=n=>`${Math.round(Number(n)||0).toLocaleString('sv-SE')} kr`;
  const LON_WD=['sön','mån','tis','ons','tor','fre','lör'], LON_MON=['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
  const lonDay=d=>{ const x=new Date(d+'T12:00:00'); return isNaN(x)?d:`${LON_WD[x.getDay()]} ${x.getDate()} ${LON_MON[x.getMonth()]}`; };
  const lonNum=v=>Number(String(v??'').replace(',','.'));
  const lonHrsTxt=h=>{ const r=Math.round(h*10)/10; return `${String(r).replace('.',',')} tim`; };

  function lonSettings(){ return LON.draft||loadWageSettings(); }
  function lonVikt(task,st){ const v=Number((st.task_vikter||{})[task||'']); return v>0?v:1; }
  function lonIsVol(name){ return Object.values(users||{}).some(u=>u.name===name&&u.isVoluntar); }

  // Vem som jobbade en kväll: idag från Min sida/schemat, annars det som sparades i historiken, annars schemat
  function lonStaffFor(date,day){
    const today=todayStr(); const plan=loadShiftPlan()[date]||{};
    if(date===today){ const out={}; Object.entries(plan).forEach(([n,v])=>{ if(v&&(v.hours||v.task)) out[n]={hours:v.hours||'',task:v.task||''}; });
      Object.entries(userData||{}).forEach(([n,v])=>{ if(v&&v.hoursDate===today&&(v.hours||v.task)) out[n]={hours:v.hours||'',task:v.task||''}; });
      return {staff:out,src:'idag'}; }
    if(day.staffHours&&Object.values(day.staffHours).some(v=>v&&v.hours)) return {staff:day.staffHours,src:'sparat'};
    if(Object.keys(plan).length) return {staff:plan,src:'schema'};
    return {staff:{},src:'saknas'};
  }

  // Kvällar som räknas: dagar i historiken med intäkter eller arbetstider, och idag om dagen är öppen
  function lonNights(from,to){
    const hist=loadSalesHistory(); const today=todayStr();
    return Object.keys(hist).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>=from&&d<=to&&d<=today&&hist[d]&&!hist[d]._deleted)
      .filter(d=>{ const h=hist[d]; return Number(h.income||0)>0||(Array.isArray(h.entries)&&h.entries.length)||(h.staffHours&&Object.values(h.staffHours).some(v=>parseWorkHoursStr(v&&v.hours)>0))||(d===today&&loadOpeningHours()!=='Stängt'); })
      .sort();
  }

  function lonNight(date,st){
    const hist=loadSalesHistory(); const day=hist[date]||{}; const today=todayStr();
    const income=Math.max(0,Number(day.income||0)||(date===today?Number(totalIncome||0):0));
    const costs=Math.max(0,Number(date===today?getCostsForDate(date):day.costs||0));
    const skattP=Math.max(0,Math.min(100,Number(st.skatteprocent??50)))/100, verkP=Math.max(0,Math.min(100,Number(st.verksamhetsandel||0)))/100;
    const over=Math.max(0,income-costs); const tax=Math.round(over*skattP); const netto=over-tax; const verk=Math.round(netto*verkP); const pott=netto-verk;
    const entries=Array.isArray(day.entries)?day.entries:[];
    const trans={}, sold={}; entries.forEach(e=>{ const s=e.seller||''; if(!s||s==='—') return; trans[s]=(trans[s]||0)+1; sold[s]=(sold[s]||0)+Number(e.sum||0); });
    const totalTrans=Object.values(trans).reduce((a,b)=>a+b,0), totalSold=Object.values(sold).reduce((a,b)=>a+b,0);
    const {staff,src}=lonStaffFor(date,day);
    const warn=[];
    if(src==='saknas') warn.push('Inga arbetstider sparade');
    if(src==='schema') warn.push('Tiderna är hämtade från schemat');
    let people=Object.entries(staff).map(([name,v])=>{ const hours=(v&&v.hours)||''; const hrs=parseWorkHoursStr(hours); if(hours&&!hrs) warn.push(`Kunde inte läsa tiden "${hours}" för ${name}`); return {name,task:(v&&v.task)||'',hours,hrs,vol:lonIsVol(name)}; }).filter(p=>p.hrs>0);
    const openHrs=parseWorkHoursStr(date===today&&loadOpeningHours()!=='Stängt'?loadOpeningHours():day.hours)||Number(day.openingHrs||0)||Math.max(0,...people.map(p=>p.hrs));
    people.forEach(p=>{ const base=lonVikt(p.task,st); p.boost=!!(st.task_kassaboost||{})[p.task]; p.trans=trans[p.name]||0; p.sold=sold[p.name]||0;
      p.share=p.boost&&totalTrans>0?p.trans/totalTrans:0; p.vikt=+(base*(1+p.share)).toFixed(2); p.baseVikt=base;
      p.cover=openHrs>0?Math.min(1,p.hrs/openHrs):1; p.points=p.cover*p.vikt; });
    const normal=people.filter(p=>!p.vol), vols=people.filter(p=>p.vol);
    const bas=Math.max(0,Number(st.bassumma||0)); const basEach=normal.length?Math.floor(Math.min(bas,Math.max(0,pott)/normal.length)):0;
    if(normal.length&&basEach<bas) warn.push('Potten räckte inte till full grundlön');
    const deln=Math.max(0,pott-basEach*normal.length);
    vols.forEach(p=>{ p.bas=0; p.extra=p.boost&&totalSold>0?Math.round(deln*p.sold/totalSold):0; });
    const rest=Math.max(0,deln-vols.reduce((a,p)=>a+p.extra,0)); const totalPts=normal.reduce((a,p)=>a+p.points,0);
    normal.forEach(p=>{ p.bas=basEach; p.extra=Math.round(rest*(totalPts>0?p.points/totalPts:1/normal.length)); });
    people.forEach(p=>{ p.total=p.bas+p.extra; });
    const paid=people.reduce((a,p)=>a+p.total,0);
    if(!people.length&&src!=='saknas') warn.push('Ingen hade en arbetstid som gick att räkna');
    return {date,income,costs,tax,netto,verk,pott,paid,left:netto-paid,openHrs,people,warn:[...new Set(warn)],src,skattP,verkP};
  }

  function lonPeriod(){
    const today=todayStr(); const ym=today.slice(0,7);
    const prev=(()=>{ const x=new Date(today+'T12:00:00'); x.setDate(1); x.setMonth(x.getMonth()-1); return x.toISOString().slice(0,7); })();
    if(LON.mode==='senaste'){ const all=lonNights('0000-00-00',today); const last=all[all.length-1]||today; return {from:last,to:last,label:last===today?'Ikväll':lonDay(last)}; }
    if(LON.mode==='manad') return {from:ym+'-01',to:ym+'-31',label:'Denna månad'};
    if(LON.mode==='forra') return {from:prev+'-01',to:prev+'-31',label:'Förra månaden'};
    if(LON.mode==='allt') return {from:'0000-00-00',to:today,label:'Alla kvällar'};
    const from=LON.from||today, to=LON.to&&LON.to>=from?LON.to:from;
    return {from,to,label:from===to?lonDay(from):`${lonDay(from)} – ${lonDay(to)}`};
  }

  function lonSum(from,to,st){
    const nights=lonNights(from,to).map(d=>lonNight(d,st));
    const sum=k=>nights.reduce((a,n)=>a+n[k],0);
    const per={};
    nights.forEach(n=>n.people.forEach(p=>{ const o=per[p.name]||(per[p.name]={name:p.name,vol:p.vol,total:0,bas:0,extra:0,hrs:0,nights:[],tasks:{}}); o.total+=p.total; o.bas+=p.bas; o.extra+=p.extra; o.hrs+=p.hrs; o.nights.push({date:n.date,...p}); o.tasks[p.task||'Ingen uppgift']=(o.tasks[p.task||'Ingen uppgift']||0)+1; }));
    const people=Object.values(per).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'sv'));
    return {nights,people,income:sum('income'),costs:sum('costs'),tax:sum('tax'),netto:sum('netto'),verk:sum('verk'),pott:sum('pott'),paid:sum('paid'),left:sum('left')};
  }

  /* ---------- Visning ---------- */
  function initLonPanel(){ LON.draft=null; renderLonPanel(); }
  function refreshLonIfOpen(){ const p=document.querySelector('#adminSettings .adm-panel[data-panel="loner"]'); if(!p||p.hidden||document.getElementById('adminSettings')?.style.display!=='block') return; if(p.contains(document.activeElement)&&document.activeElement.matches('input,select')) return; renderLonPanel(); }

  function renderLonPanel(){
    const el=document.getElementById('lonContent'); if(!el) return;
    el.innerHTML=`<div class="ui-tabs u-mb-16"><button type="button" class="ui-tab${LON.tab==='lon'?' is-active':''}" data-lon-tab="lon">Lönen</button><button type="button" class="ui-tab${LON.tab==='regler'?' is-active':''}" data-lon-tab="regler">Så räknas den</button></div><div id="lonBody"></div>`;
    el.onclick=lonClick; el.oninput=lonInput; el.onchange=lonChange;
    LON.tab==='regler'?lonRenderRules():lonRenderMain();
  }

  function lonReceipt(s,label,st){
    const row=(k,v,cls='')=>`<div class="lon-rc-row ${cls}"><span>${k}</span><i></i><b>${v}</b></div>`;
    return `<article class="rx-paper lon-receipt"><p class="rx-card-kicker">Kvittot · ${lonEsc(label)}</p>
      ${row(`Intäkter, ${s.nights.length} ${s.nights.length===1?'kväll':'kvällar'}`,lonKr(s.income))}
      ${s.costs?row('Utgifter','−'+lonKr(s.costs)):''}
      ${row(`Skatt och avgifter (${Math.round(Number(st.skatteprocent??50))} %)`,'−'+lonKr(s.tax))}
      ${row(`Verksamhetens andel (${Math.round(Number(st.verksamhetsandel||0))} %)`,'−'+lonKr(s.verk))}
      ${row('Lönepott',lonKr(s.pott),'is-sum')}
      ${row('Utdelat till personalen','−'+lonKr(s.paid))}
      ${row('Kvar till hotellet',lonKr(s.left),'is-sum')}
    </article>`;
  }

  function lonWhy(p){
    const n=p.nights.length; const bits=[`${n} ${n===1?'kväll':'kvällar'}`,lonHrsTxt(p.hrs)];
    const tasks=Object.entries(p.tasks).sort((a,b)=>b[1]-a[1]).map(([t])=>t); if(tasks.length) bits.push(tasks.slice(0,2).join(', ')+(tasks.length>2?' m.fl.':''));
    if(p.vol) bits.push('volontär');
    return bits.join(' · ');
  }

  function lonNightLine(p,openHrs){
    const parts=[`${lonEsc(p.hours)}${openHrs?` (${Math.round(p.cover*100)} % av öppettiden)`:''}`,lonEsc(p.task||'Ingen uppgift')+(p.vikt!==1?` ×${String(p.vikt).replace('.',',')}`:'')];
    if(p.boost) parts.push(`${p.trans} ${p.trans===1?'köp':'köp'} i kassan`);
    const money=p.vol?(p.extra?`${lonKr(p.extra)} efter försäljning`:'volontär, ingen lön'):`${lonKr(p.bas)} grundlön + ${lonKr(p.extra)}`;
    return `${parts.join(' · ')} → ${money}`;
  }

  function lonRenderMain(){
    const body=document.getElementById('lonBody'); if(!body) return;
    const per=lonPeriod(); const st=loadWageSettings(); const s=lonSum(per.from,per.to,st);
    const modes=[['senaste','Senaste kvällen'],['manad','Denna månad'],['forra','Förra månaden'],['allt','Alla kvällar'],['egen','Välj datum']];
    const warnNights=s.nights.filter(n=>n.warn.length);
    const nightsById=Object.fromEntries(s.nights.map(n=>[n.date,n]));
    body.innerHTML=`<div class="adm-seg adm-seg--wide lon-modes" role="group" aria-label="Period">${modes.map(([v,l])=>`<button type="button" data-lon-mode="${v}" aria-pressed="${LON.mode===v}">${l}</button>`).join('')}</div>
      ${LON.mode==='egen'?`<div class="rx-fields lon-dates"><label class="rx-field"><span>Från</span><input type="date" class="input" id="lonFrom" value="${lonEsc(per.from)}"></label><label class="rx-field"><span>Till</span><input type="date" class="input" id="lonTo" value="${lonEsc(per.to)}"></label></div>`:''}
      ${!s.nights.length?`<p class="rx-empty lon-empty">Inga kvällar med försäljning eller arbetstider ${LON.mode==='senaste'?'ännu':'under perioden'}.</p>`:`
      ${warnNights.length?`<ul class="rx-list lon-warn">${warnNights.map(n=>`<li class="rx-att rx-att--${n.src==='schema'&&n.warn.length===1?'info':'warn'}"><span><strong>${lonEsc(lonDay(n.date))}:</strong> ${n.warn.map(lonEsc).join('. ')}.</span></li>`).join('')}</ul>`:''}
      <div class="adm-grid adm-grid--2 lon-grid">
        ${lonReceipt(s,per.label,st)}
        <article class="rx-card lon-people"><p class="rx-card-kicker">Lönekuverten</p>
          ${s.people.length?`<ul class="lon-plist">${s.people.map(p=>{ const open=LON.open.has(p.name); return `<li class="lon-p${open?' is-open':''}"><button type="button" class="lon-p-head" data-lon-person="${lonEsc(p.name)}" aria-expanded="${open}"><span class="lon-p-name">${lonEsc(p.name)}<small>${lonEsc(lonWhy(p))}</small></span><strong>${lonKr(p.total)}</strong></button>
            ${open?`<ul class="lon-p-nights">${p.nights.map(x=>`<li><span>${lonEsc(lonDay(x.date))}</span><p>${lonNightLine(x,nightsById[x.date]?.openHrs)}</p><b>${lonKr(x.total)}</b></li>`).join('')}</ul>`:''}</li>`; }).join('')}</ul>`:'<p class="rx-empty">Ingen hade en arbetstid som gick att räkna.</p>'}
        </article>
      </div>
      ${s.nights.length>1?`<article class="rx-card lon-nights"><p class="rx-card-kicker">Kvällarna</p><ul class="adm-rows">${[...s.nights].reverse().map(n=>`<li class="adm-row"><div class="adm-row-main"><strong>${lonEsc(lonDay(n.date))}</strong><span>Intäkter ${lonKr(n.income)} · lönepott ${lonKr(n.pott)} · ${n.people.length} ${n.people.length===1?'person':'personer'}</span></div><div class="adm-row-actions"><button type="button" class="btn" data-lon-night="${n.date}">Visa kvällen</button></div></li>`).join('')}</ul></article>`:''}`}
      <p class="tiny muted lon-foot">En lekfull uppskattning av vad kvällarna gav, inget riktigt löneunderlag. Hur det räknas ser du under "Så räknas den".</p>`;
  }

  function lonRenderRules(){
    const body=document.getElementById('lonBody'); if(!body) return;
    const st=lonSettings(); const tasks=loadTaskCatalog();
    const per=lonPeriod(); const s=lonSum(per.from,per.to,st);
    body.innerHTML=`<div class="adm-grid adm-grid--2 lon-grid">
      <article class="rx-card lon-rules">
        <ol class="lon-steps">
          <li><strong>Kvällens överskott</strong><p>Intäkterna minus utgifterna som förts in i statistiken.</p></li>
          <li><label class="lon-set"><span>Skatt och avgifter</span><input class="input" type="number" inputmode="numeric" min="0" max="100" step="1" data-lon-set="skatteprocent" value="${lonEsc(st.skatteprocent??50)}"><em>%</em></label><p>Dras från överskottet.</p></li>
          <li><label class="lon-set"><span>Verksamhetens andel</span><input class="input" type="number" inputmode="numeric" min="0" max="100" step="1" data-lon-set="verksamhetsandel" value="${lonEsc(st.verksamhetsandel||0)}"><em>%</em></label><p>Går till hotellet. Resten är kvällens lönepott.</p></li>
          <li><label class="lon-set"><span>Grundlön per kväll</span><input class="input" type="number" inputmode="numeric" min="0" step="10" data-lon-set="bassumma" value="${lonEsc(st.bassumma||0)}"><em>kr</em></label><p>Till var och en som jobbade, men inte till volontärer. Räcker inte potten delas den lika.</p></li>
          <li><strong>Resten fördelas</strong><p>Efter hur stor del av öppettiden var och en jobbade, gånger uppgiftens vikt nedan.</p></li>
        </ol>
        <h4 class="u-mt-16">Uppgifterna</h4>
        <p class="tiny muted">Vikt 1 är normalt. Vikt 1,5 ger en och en halv gång så stor del av resten. "Efter försäljning" höjer vikten med personens andel av kvällens köp i kassan, upp till det dubbla, och ger volontärer en del av det de sålt.</p>
        ${tasks.length?`<table class="lon-tasks"><thead><tr><th>Uppgift</th><th>Vikt</th><th>Efter försäljning</th></tr></thead><tbody>${tasks.map(t=>`<tr><th scope="row">${lonEsc(t)}</th><td><input class="input" type="number" inputmode="decimal" min="0.1" max="5" step="0.1" data-lon-vikt="${lonEsc(t)}" value="${lonEsc((st.task_vikter||{})[t]||1)}" aria-label="Vikt för ${lonEsc(t)}"></td><td><input type="checkbox" data-lon-boost="${lonEsc(t)}"${(st.task_kassaboost||{})[t]?' checked':''} aria-label="${lonEsc(t)} räknas efter försäljning"></td></tr>`).join('')}</tbody></table>`:'<p class="rx-empty">Inga uppgifter ännu. Lägg till dem under Listor.</p>'}
        <div class="rx-actions lon-rule-actions"><button type="button" class="btn btn-green" data-lon-save${LON.draft?'':' disabled'}>Spara</button><button type="button" class="btn" data-lon-reset${LON.draft?'':' disabled'}>Ångra ändringarna</button></div>
      </article>
      <article class="rx-card lon-preview"><p class="rx-card-kicker">${LON.draft?'Så blir det med ändringarna':'Så blir det nu'} · ${lonEsc(per.label)}</p>
        ${s.people.length?`<ul class="rx-list rx-list--plain lon-prev">${s.people.map(p=>`<li><span>${lonEsc(p.name)}</span><b>${lonKr(p.total)}</b></li>`).join('')}<li class="is-sum"><span>Kvar till hotellet</span><b>${lonKr(s.left)}</b></li></ul>`:'<p class="rx-empty">Ingen kväll att visa för den valda perioden.</p>'}
        ${LON.draft?'<p class="tiny muted">Inte sparat än.</p>':'<p class="tiny muted">Ändra en siffra till vänster så räknas det om direkt.</p>'}
      </article></div>`;
  }

  function lonDraftFromForm(){
    const cur=lonSettings(); const d={...cur,task_vikter:{...(cur.task_vikter||{})},task_kassaboost:{...(cur.task_kassaboost||{})}};
    document.querySelectorAll('#lonBody [data-lon-set]').forEach(i=>{ const v=lonNum(i.value); if(Number.isFinite(v)&&v>=0) d[i.dataset.lonSet]=i.dataset.lonSet==='bassumma'?Math.round(v):Math.min(100,Math.round(v)); });
    document.querySelectorAll('#lonBody [data-lon-vikt]').forEach(i=>{ const v=lonNum(i.value); if(Number.isFinite(v)&&v>0) d.task_vikter[i.dataset.lonVikt]=Math.min(5,+v.toFixed(2)); });
    document.querySelectorAll('#lonBody [data-lon-boost]').forEach(i=>{ if(i.checked) d.task_kassaboost[i.dataset.lonBoost]=true; else delete d.task_kassaboost[i.dataset.lonBoost]; });
    return d;
  }
  function lonRefreshPreview(){ const pv=document.querySelector('#lonBody .lon-preview'); if(!pv) return; const keep=document.activeElement; const id=keep&&(keep.dataset.lonSet||keep.dataset.lonVikt||keep.dataset.lonBoost); lonRenderRules(); if(id){ const back=document.querySelector(`#lonBody [data-lon-set="${CSS.escape(id)}"],#lonBody [data-lon-vikt="${CSS.escape(id)}"],#lonBody [data-lon-boost="${CSS.escape(id)}"]`); if(back){ back.focus(); if(back.type==='number'){ try{ const n=back.value.length; back.setSelectionRange?.(n,n); }catch(_e){} } } } }

  function lonInput(e){ if(e.target.matches('[data-lon-set],[data-lon-vikt]')){ LON.draft=lonDraftFromForm(); clearTimeout(LON.t); LON.t=setTimeout(lonRefreshPreview,350); } }
  function lonChange(e){
    if(e.target.matches('[data-lon-boost]')){ LON.draft=lonDraftFromForm(); lonRefreshPreview(); return; }
    if(e.target.id==='lonFrom'||e.target.id==='lonTo'){ LON.from=document.getElementById('lonFrom')?.value||''; LON.to=document.getElementById('lonTo')?.value||''; lonRenderMain(); }
  }
  function lonClick(e){
    const t=e.target.closest('button'); if(!t) return;
    if(t.dataset.lonTab){ if(LON.tab==='regler'&&LON.draft&&t.dataset.lonTab==='lon'){ /* utkastet ligger kvar tills det sparas eller ångras */ } LON.tab=t.dataset.lonTab; renderLonPanel(); return; }
    if(t.dataset.lonMode){ LON.mode=t.dataset.lonMode; if(LON.mode==='egen'&&!LON.from){ const p=lonPeriod(); LON.from=p.from; LON.to=p.to; } LON.open.clear(); lonRenderMain(); return; }
    if(t.dataset.lonPerson!=null){ const n=t.dataset.lonPerson; LON.open.has(n)?LON.open.delete(n):LON.open.add(n); lonRenderMain(); return; }
    if(t.dataset.lonNight){ LON.mode='egen'; LON.from=LON.to=t.dataset.lonNight; LON.open.clear(); lonRenderMain(); document.getElementById('lonContent')?.scrollIntoView({block:'start',behavior:'smooth'}); return; }
    if(t.hasAttribute('data-lon-save')){ const d=lonDraftFromForm(); saveWageSettings(d); LON.draft=null; notify('Löneinställningarna är sparade.','ok'); lonRenderRules(); return; }
    if(t.hasAttribute('data-lon-reset')){ LON.draft=null; lonRenderRules(); return; }
  }
