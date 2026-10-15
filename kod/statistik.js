/* ============================== STATISTIK ==============================
   Laddas före app.js, men funktionerna anropas först när sidan visas. Då finns app.js datalager (loadSalesHistory,
   paymentTotalsForDate …) och globala tillstånd (isAdmin, openingHours).
   Statistiken tittar bakåt; det som händer just nu finns i Hantera → Översikt. Sidan (#statsList, renderStats) har:
   säsongen i siffror med jämförelse mot samma tid i fjol, kväll för kväll, mönster (veckodag, timme, sällskapens
   storlek, betalsätt) och en tabell med alla kvällar. En kväll öppnas som sammanfattning (sxSummaryHtml).
   "Gäster" betyder sålda biljetter (vuxna + barn) överallt. Kronor visas bara för admin. Inget nytt sparas. */

  const SX_WD=['söndag','måndag','tisdag','onsdag','torsdag','fredag','lördag'];
  const SX_MON=['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];
  const SX_MON_S=['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
  const SX_PAGE=20;
  const SX={ shown:SX_PAGE, year:null };

  const sxDate=d=>new Date(d+'T12:00:00');
  const sxEsc=s=>escapeHtml(String(s??''));
  const sxNum=n=>Math.round(Number(n||0)).toLocaleString('sv-SE');
  const sxKr=n=>`${sxNum(n)} kr`;
  const sxDec=v=>(v>0&&v<10&&Math.round(v)!==v)?(Math.round(v*10)/10).toString().replace('.',','):sxNum(v);
  const sxGuests=v=>Number(v?.adult||0)+Number(v?.child||0);
  const sxEntryGuests=e=>Number(e?.adult||0)+Number(e?.child||0);
  const sxHasData=v=>!!v&&!v._deleted&&(sxGuests(v)+Number(v.income||0))>0;
  const sxHasEntries=v=>Array.isArray(v?.entries)&&v.entries.length>0;
  const sxH2=h=>String(h%24).padStart(2,'0');
  function sxDayLong(d){ const x=sxDate(d); return `${SX_WD[x.getDay()]} ${x.getDate()} ${SX_MON[x.getMonth()]}${x.getFullYear()!==new Date().getFullYear()?' '+x.getFullYear():''}`; }
  function sxDayShort(d){ const x=sxDate(d); return `${SX_WD[x.getDay()].slice(0,3)} ${x.getDate()} ${SX_MON_S[x.getMonth()]}${x.getFullYear()!==new Date().getFullYear()?' '+x.getFullYear():''}`; }
  const sxPlural=wd=>SX_WD[wd]+'ar';

  // Minuter efter midnatt för ett köp. Klockslaget sparas med toLocaleTimeString, så både "19:05:12" och "7:05:12 PM"
  // förekommer. Saknas klockslaget används biljettens skapandetid.
  function sxMinute(e){
    const t=e&&e.time; const m=typeof t==='string'&&t.match(/(\d{1,2})[:.](\d{2})/);
    if(m){ let h=+m[1]; if(/pm/i.test(t)&&h<12) h+=12; if(/am/i.test(t)&&h===12) h=0; return (h%24)*60+(+m[2]); }
    const iso=Date.parse((e&&e.ticketUid)||''); if(iso){ const x=new Date(iso); return x.getHours()*60+x.getMinutes(); }
    return null;
  }
  function sxHourly(entries){ const out=new Array(24).fill(0); (entries||[]).forEach(e=>{ const m=sxMinute(e); if(m!=null) out[Math.floor(m/60)]+=sxEntryGuests(e); }); return out; }
  function sxAvgHourly(days){ const withE=days.filter(([,v])=>sxHasEntries(v)); if(!withE.length) return null; const sum=new Array(24).fill(0); withE.forEach(([,v])=>sxHourly(v.entries).forEach((x,i)=>{ sum[i]+=x; })); return {avg:sum.map(x=>x/withE.length),n:withE.length}; }
  function sxRange(hours){ const r=typeof getOpenHourRange==='function'?getOpenHourRange(hours):null; return r&&r.end>r.start?r:null; }
  // Timmarna ett diagram ska visa: öppettiden, utökad med timmar som har köp utanför den. [-1,-1] om det inte finns något.
  function sxSpan(vals,range){
    const used=vals.map((v,i)=>v>0?i:-1).filter(i=>i>=0);
    let s=range?range.start:-1, e=range?range.end:-1;
    if(used.length){ s=s<0?used[0]:Math.min(s,used[0]); e=Math.max(e,used[used.length-1]+1); }
    return [s,e];
  }

  // Tidigare avslutade kvällar som liknar ett datum: i första hand samma veckodag och öppettid, sedan samma öppettid,
  // sedan samma veckodag och sist alla. Högst sex, de senaste först.
  function sxSimilar(date,hours){
    const hist=loadSalesHistory(), today=todayStr(), wd=sxDate(date).getDay();
    const past=Object.entries(hist).filter(([k,v])=>k<today&&k!==date&&sxHasData(v)).sort((a,b)=>b[0].localeCompare(a[0]));
    const tries=[
      [([k,v])=>hours&&v.hours===hours&&sxDate(k).getDay()===wd,`${sxPlural(wd)} med samma öppettid`],
      [([,v])=>hours&&v.hours===hours,'kvällar med samma öppettid'],
      [([k])=>sxDate(k).getDay()===wd,sxPlural(wd)],
      [()=>true,'tidigare kvällar']];
    for(const [f,how] of tries){ const b=past.filter(f); if(b.length>=2||(how==='tidigare kvällar'&&b.length)) return {days:b.slice(0,6),how}; }
    return {days:[],how:''};
  }
  // Prognos för ett datum: snittet av liknande kvällar. Används också av Hantera (admForecast).
  function sxForecast(date,hours){
    const {days,how}=sxSimilar(date,hours); if(!days.length) return null; const n=days.length;
    return { guests:Math.round(days.reduce((s,[,v])=>s+sxGuests(v),0)/n), income:Math.round(days.reduce((s,[,v])=>s+Number(v.income||0),0)/n),
      n, how, days, text:n===1?'Bygger på en tidigare kväll':`Snitt av ${n} ${how}` };
  }
  /* ---------- Stapeldiagram per timme ---------- */
  // vals och ghost är 24 timmar. ghost ritas som en streckad ram bakom stapeln ("brukar").
  function sxChart(vals,ghost,start,end,{label='',unit='biljetter',now=-1}={}){
    const n=end-start; if(n<=0) return '';
    const slot=Math.max(40,Math.floor(340/n)), bw=Math.min(52,Math.round(slot*0.58)), h=120, top=22, bottom=26, W=n*slot, H=top+h+bottom;
    const span=[...vals.slice(start,end),...(ghost?ghost.slice(start,end):[])]; const max=Math.max(1,...span);
    let s='';
    for(let i=0;i<n;i++){
      const hr=start+i, cx=i*slot+slot/2, x=cx-bw/2, v=vals[hr]||0, g=ghost?(ghost[hr]||0):0;
      const bh=v?Math.max(3,Math.round(v/max*h)):0, gh=g?Math.max(3,Math.round(g/max*h)):0;
      const tip=`${sxH2(hr)}–${sxH2(hr+1)}: ${sxDec(v)} ${unit}${ghost?`, brukar ${sxDec(g)}`:''}`;
      s+=`<g><title>${tip}</title><rect x="${i*slot}" y="0" width="${slot}" height="${H}" fill="transparent"/>`;
      if(gh) s+=`<rect class="sx-ghost" x="${x-4}" y="${top+h-gh}" width="${bw+8}" height="${gh}"/>`;
      if(bh) s+=`<rect class="sx-bar${hr===now?' is-now':''}" x="${x}" y="${top+h-bh}" width="${bw}" height="${bh}"/><text class="sx-val" x="${cx}" y="${top+h-Math.max(bh,gh)-6}">${sxDec(v)}</text>`;
      s+=`<text class="sx-hr${hr===now?' is-now':''}" x="${cx}" y="${H-7}">${sxH2(hr)}</text></g>`;
    }
    s+=`<line class="sx-base" x1="0" x2="${W}" y1="${top+h+0.5}" y2="${top+h+0.5}"/>`;
    return `<svg class="sx-chart" viewBox="0 0 ${W} ${H}" style="max-width:${Math.round(W*1.6)}px" role="img" aria-label="${sxEsc(label)}">${s}</svg>`;
  }

  /* ============================== SIDAN ============================== */
  // Statistiken tittar bakåt. Det som händer just nu (kö, insläpp, kassan, nästa öppetdag) finns i Hantera → Översikt.
  // renderCockpit finns kvar för att app.js anropar den vid varje uppdatering, men den har inget eget innehåll längre.
  function renderCockpit(){ const w=document.getElementById('cockpitWrap'); if(w&&w.innerHTML) w.innerHTML=''; }

  function renderStats(){
    const root=document.getElementById('statsList'); if(!root) return;
    if(!loggedInUser){ root.innerHTML='<p class="sx-note">Logga in för att se statistiken.</p>'; return; }
    const hist=loadSalesHistory(), today=todayStr();
    const all=Object.entries(hist).filter(([,v])=>sxHasData(v)).sort((a,b)=>b[0].localeCompare(a[0]));
    const years=[...new Set(all.map(([d])=>d.slice(0,4)))];
    if(!years.length){ root.innerHTML=`<p class="sx-empty">Ingen historik än. Kvällarna dyker upp här när kassan har sålt något.</p>${sxToolsHtml()}`; root.onclick=sxListClick; return; }
    if(!SX.year||!years.includes(SX.year)) SX.year=years[0];
    const y=SX.year;
    const inYear=all.filter(([d])=>d.startsWith(y));
    const done=inYear.filter(([d])=>d<today);                 // avslutade kvällar; den som pågår räknas in när den är slut
    const chips=years.length>1?`<div class="sx-years" role="group" aria-label="Välj år">${years.map(x=>`<button type="button" class="sx-year" data-year="${x}" aria-pressed="${x===y}">${x}</button>`).join('')}</div>`:'';
    root.innerHTML=`${chips}${sxSeasonHtml(done,y,hist)}${sxSeriesHtml(done)}${sxPatternsHtml(done)}${sxTableHtml(inYear)}${sxToolsHtml()}`;
    root.onclick=sxListClick;
  }

  /* ---------- Säsongen i siffror ---------- */
  function sxSeasonHtml(done,y,hist){
    if(!done.length) return `<p class="sx-empty">Inga avslutade kvällar ${y} än.</p>`;
    const sum=(rows,f)=>rows.reduce((s,[,v])=>s+f(v),0);
    // Jämförelse med samma period året före: hela året om det valda året är slut, annars fram till samma datum
    const py=String(+y-1), cut=y===todayStr().slice(0,4)?py+todayStr().slice(4):py+'-12-31';
    const prev=Object.entries(hist).filter(([d,v])=>d.startsWith(py)&&d<=cut&&sxHasData(v));
    const st=rows=>{ const g=sum(rows,sxGuests), c=sum(rows,v=>Number(v.child||0)), k=sum(rows,v=>Number(v.income||0)); return {n:rows.length,g,avg:rows.length?g/rows.length:0,kids:g?c/g*100:0,kr:k,per:g?k/g:0}; };
    const a=st(done), b=prev.length?st(prev):null;
    const cmp=(x,o)=>{ if(!b||!o) return ''; const p=Math.round((x-o)/o*100); return `<span class="sx-cmp ${p>=0?'is-up':'is-down'}">${p>0?'▲ +':p<0?'▼ −':'± '}${Math.abs(p)} %</span>`; };
    const tile=(l,v,c,o)=>`<div class="sx-tile"><span>${l}</span><strong>${v}</strong>${c}${o!=null&&b?`<small>i fjol ${o}</small>`:''}</div>`;
    const tiles=[
      tile('Kvällar',sxNum(a.n),'',b?sxNum(b.n):null),
      tile('Gäster',sxNum(a.g),cmp(a.g,b&&b.g),b?sxNum(b.g):null),
      tile('Per kväll',sxNum(a.avg),cmp(a.avg,b&&b.avg),b?sxNum(b.avg):null),
      tile('Barn',`${Math.round(a.kids)} %`,'',b?`${Math.round(b.kids)} %`:null)];
    if(isAdmin) tiles.push(tile('Intäkt',sxKr(a.kr),cmp(a.kr,b&&b.kr),b?sxKr(b.kr):null),tile('Per gäst',sxKr(a.per),cmp(a.per,b&&b.per),b?sxKr(b.per):null));
    return `<section class="sx-sec"><h4 class="sx-h">Säsongen ${y}${b?`<small>jämfört med samma tid ${py}</small>`:''}</h4><div class="sx-tiles${tiles.length>4?' is-6':''}">${tiles.join('')}</div></section>`;
  }

  /* ---------- Kväll för kväll ---------- */
  // En stapel per avslutad kväll i tidsordning, en streckad linje för snittet och månadens namn under första kvällen i
  // varje månad. Byggd med vanliga element så att text och tryckytor behåller sin storlek på mobilen.
  function sxSeriesHtml(done){
    if(done.length<2) return '';
    const days=done.slice().reverse(), vals=days.map(([,v])=>sxGuests(v)), max=Math.max(...vals,1), avg=vals.reduce((s,x)=>s+x,0)/vals.length;
    const top=vals.indexOf(Math.max(...vals));
    let lastMon=-1;
    const bars=days.map(([d,v],i)=>{ const x=sxDate(d), m=x.getMonth(), g=vals[i];
      const lbl=m!==lastMon?SX_MON_S[m]:''; lastMon=m;
      return `<div class="sx-sb"><button type="button" data-day="${d}" style="height:${Math.max(2,g/max*100)}%" title="${sxDayShort(d)}: ${g} gäster" aria-label="${sxDayLong(d)}, ${g} gäster">${i===top?`<b>${g}</b>`:''}</button><span>${lbl}</span></div>`; }).join('');
    return `<section class="sx-sec"><h4 class="sx-h">Kväll för kväll<small>gäster per kväll, tryck på en stapel för kvällen</small></h4>
      <div class="sx-series" style="--sx-avg:${(avg/max).toFixed(3)}"><i class="sx-avgline" aria-hidden="true"><em>snitt ${sxNum(avg)}</em></i>${bars}</div></section>`;
  }

  /* ---------- Mönster ---------- */
  function sxHbars(rows){ const max=Math.max(...rows.map(r=>r.v),1);
    return `<ul class="sx-hbars">${rows.map(r=>`<li${r.hot?' class="is-hot"':''}><span class="sx-hb-l">${r.l}</span><span class="sx-hb-b"><i style="width:${Math.max(1,r.v/max*100)}%"></i></span><span class="sx-hb-v">${r.t}</span></li>`).join('')}</ul>`; }
  function sxPatternsHtml(done){
    if(!done.length) return '';
    const cards=[];
    // Bästa veckodag: snitt gäster per veckodag, måndag först
    const wd={}; done.forEach(([d,v])=>{ const w=sxDate(d).getDay(); (wd[w]||(wd[w]=[])).push(sxGuests(v)); });
    const wrows=[1,2,3,4,5,6,0].filter(w=>wd[w]).map(w=>({w,v:wd[w].reduce((s,x)=>s+x,0)/wd[w].length,n:wd[w].length}));
    if(wrows.length){ const best=Math.max(...wrows.map(r=>r.v));
      cards.push(`<article class="sx-card"><p class="sx-card-h">Bästa veckodag</p>${sxHbars(wrows.map(r=>({l:SX_WD[r.w].charAt(0).toUpperCase()+SX_WD[r.w].slice(1),v:r.v,t:`${sxNum(r.v)}<small>${r.n} ${r.n===1?'kväll':'kvällar'}</small>`,hot:r.v===best&&wrows.length>1})))}<p class="sx-note">Snitt gäster per kväll.</p></article>`); }
    // När kommer gästerna: snitt per timme
    const ah=sxAvgHourly(done);
    if(ah){ const [s,e]=sxSpan(ah.avg,null); if(s>=0){ const peak=ah.avg.indexOf(Math.max(...ah.avg));
      cards.push(`<article class="sx-card"><p class="sx-card-h">När kommer gästerna</p>${sxChart(ah.avg,null,s,e,{label:'Gäster per timme i snitt',unit:'gäster'})}<p class="sx-note">Flest mellan ${sxH2(peak)} och ${sxH2(peak+1)}. Snitt per kväll, ${ah.n} ${ah.n===1?'kväll':'kvällar'}.</p></article>`); } }
    // Sällskapens storlek: hur många gäster ett köp gäller
    const sizes=[0,0,0,0,0]; let gs=0,ns=0;
    done.forEach(([,v])=>(v.entries||[]).forEach(e=>{ const g=sxEntryGuests(e); if(g>0){ sizes[Math.min(g,5)-1]++; gs+=g; ns++; } }));
    if(ns){ cards.push(`<article class="sx-card"><p class="sx-card-h">Sällskapens storlek</p>${sxHbars(sizes.map((c,i)=>({l:i===4?'5 eller fler':i===0?'1 gäst':`${i+1} gäster`,v:c,t:`${Math.round(c/ns*100)} %`})))}<p class="sx-note">I snitt ${sxDec(Math.round(gs/ns*10)/10)} gäster per köp med biljetter.</p></article>`); }
    // Betalsätt, bara admin
    if(isAdmin){ const pay={}; let tot=0; done.forEach(([,v])=>(v.entries||[]).forEach(e=>{ const p=e.payType; const x=Number(e.sum||0); if(['Swish','Kort','Kontant'].includes(p)&&x>0){ pay[p]=(pay[p]||0)+x; tot+=x; } }));
      if(tot) cards.push(`<article class="sx-card"><p class="sx-card-h">Betalsätt</p>${sxHbars(['Swish','Kort','Kontant'].filter(m=>pay[m]).map(m=>({l:m,v:pay[m],t:`${Math.round(pay[m]/tot*100)} %<small>${sxKr(pay[m])}</small>`})))}<p class="sx-note">Andel av intäkten.</p></article>`); }
    return cards.length?`<section class="sx-sec"><h4 class="sx-h">Mönster</h4><div class="sx-cards">${cards.join('')}</div></section>`:'';
  }

  /* ---------- Alla kvällar ---------- */
  // En rad per kväll, den som pågår överst. Pilen jämför med vad liknande kvällar brukar ha (sxForecast).
  function sxTableHtml(rows){
    if(!rows.length) return '';
    const today=todayStr();
    const body=rows.slice(0,SX.shown).map(([d,v])=>{ const g=sxGuests(v), live=d===today, fc=live?null:sxForecast(d,v.hours);
      let mark='<span class="sx-vs">–</span>';
      if(live) mark='<span class="sx-vs is-live">pågår</span>';
      else if(fc&&fc.guests){ const p=Math.round((g-fc.guests)/fc.guests*100); mark=Math.abs(p)<5?'<span class="sx-vs">som vanligt</span>':`<span class="sx-vs ${p>0?'is-up':'is-down'}" title="Brukar vara ca ${fc.guests}">${p>0?'▲ +':'▼ −'}${Math.abs(p)} %</span>`; }
      return `<tr data-day="${d}" tabindex="0"><th scope="row">${live?'Idag':sxDayShort(d)}${v.hours&&v.hours!=='Stängt'?`<small>${sxEsc(v.hours)}</small>`:''}</th><td class="sx-t-g">${sxNum(g)}</td><td class="sx-t-vs">${mark}</td><td>${sxNum(v.count)}</td>${isAdmin?`<td>${sxNum(v.income)}</td>`:''}</tr>`; }).join('');
    const more=rows.length>SX.shown?`<button type="button" class="btn sx-more" data-more>Visa fler (${rows.length-SX.shown} till)</button>`:'';
    return `<section class="sx-sec"><h4 class="sx-h">Alla kvällar<small>tryck på en kväll för sammanfattningen</small></h4>
      <table class="sx-nights"><thead><tr><th scope="col">Kväll</th><th scope="col">Gäster</th><th scope="col"><span class="sx-sr">Jämfört med </span>vanligt</th><th scope="col">Köp</th>${isAdmin?'<th scope="col">Kronor</th>':''}</tr></thead><tbody>${body}</tbody></table>${more}</section>`;
  }

  function sxToolsHtml(){
    if(!isAdmin) return '';
    return `<div class="sx-foot"><div class="sx-tools"><button type="button" class="btn" onclick="rxExportDays()">Exportera kvällar (CSV)</button><button type="button" class="btn" onclick="rxExportSales()">Exportera alla köp (CSV)</button><button type="button" class="btn" onclick="toggleAddDayPanel()">Lägg till en kväll för hand</button></div>
      <p class="sx-note">Exporten öppnas i Excel. Lägg till för hand är till för kvällar som inte gick genom kassan.</p>
      <div id="addDayPanel" class="sx-add" style="display:none;"><div class="sx-add-fields">
        <label>Datum<input type="date" id="addDayDate"></label><label>Vuxna<input type="number" id="addDayAdult" value="0" min="0" inputmode="numeric"></label><label>Barn<input type="number" id="addDayChild" value="0" min="0" inputmode="numeric"></label>
        <label>Intäkt (kr)<input type="number" id="addDayIncome" value="0" min="0" inputmode="numeric"></label><label>Öppettid<input type="text" id="addDayHours" placeholder="18:00–21:00"></label><label>Utgifter (kr)<input type="number" id="addDayCosts" value="0" min="0" inputmode="numeric"></label>
      </div><div class="sx-tools"><button type="button" class="btn btn-green" onclick="saveNewDay()">Spara kvällen</button><button type="button" class="btn" onclick="toggleAddDayPanel()">Avbryt</button></div></div></div>`;
  }

  function sxListClick(e){
    const yb=e.target.closest('[data-year]'); if(yb){ SX.year=yb.dataset.year; SX.shown=SX_PAGE; renderStats(); return; }
    if(e.target.closest('[data-more]')){ SX.shown+=30; renderStats(); return; }
    const d=e.target.closest('[data-day]'); if(d) showDaySummaryModal(d.dataset.day);
  }
  // Raderna i tabellen går att öppna med Enter från tangentbordet
  document.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.matches&&e.target.matches('.sx-nights tr[data-day]')) showDaySummaryModal(e.target.dataset.day); });

  // Köpen under en kväll (admin): klockslag, varor, säljare, betalsätt och om biljetten är använd
  function sxReceiptsHtml(date){
    const s=loadSalesHistory()[date]||{}, entries=Array.isArray(s.entries)?s.entries:[], passes=Array.isArray(s.reEntryPasses)?s.reEntryPasses:[];
    if(!entries.length) return '';
    if(!window._reactivateTickets) window._reactivateTickets={};
    const list=entries.map(e=>{
      let badge='';
      if(Number(e?.reEntryCreated||0)>0||Number(e?.breakdown?.reEntry||0)>0){
        const ids=Array.isArray(e.reEntryIds)?e.reEntryIds:[];
        badge=ids.length?ids.map(id=>{ const p=passes.find(x=>x.id===id); return `<span class="sx-badge is-re">${sxEsc(p?.label||'Re-entry')}: ${Number(p?.count||0)} gånger</span>`; }).join(' '):'<span class="sx-badge is-re">Re-entry</span>';
      }else if(typeof e.used==='boolean'){
        const rk='_re_'+(e.ticketUid||'').replace(/\W/g,'_')+'_'+date;
        window._reactivateTickets[rk]={ticketUid:e.ticketUid,adult:e.adult,child:e.child,label:e.ticketLabel,sum:e.sum};
        badge=e.used?'<span class="sx-badge is-used">Använd</span>':`<button type="button" class="sx-badge is-unused" onclick="reactivateTicketFromHistory('${rk}')" title="Lägg tillbaka bland aktiva biljetter">Ej använd ↩</button>`;
      }
      return `<li><span class="sx-r-time">${sxEsc(String(e.time||'').slice(0,5))}</span><span class="sx-r-items">${(e.items||[]).map(i=>sxEsc(typeof i==='string'?i:`${i.qty||1} × ${i.name}`)).join('<br>')}${e.ticketLabel?`<small>${sxEsc(e.ticketLabel)}</small>`:''}<small>${sxEsc(e.seller||'—')} · ${sxEsc(e.payType||'—')}</small></span><span class="sx-r-sum">${sxKr(e.sum)}${badge?`<span>${badge}</span>`:''}</span></li>`;
    }).join('');
    return `<details class="sx-receipts-wrap"><summary>Köpen (${entries.length})</summary><ol class="sx-receipts">${list}</ol></details>`;
  }

  /* ============================== SAMMANFATTNING AV EN KVÄLL ============================== */
  // Innehållet i dagssammanfattningen (showDaySummaryModal i app.js): sålda biljetter som stort tal, gäster per timme med
  // liknande kvällar som ram och för admin kassan och köpen. För dagens kväll finns också Stäm av
  // insläppen. Siffror som admin rättat för hand (_ov_*) gäller.
  function sxSummaryHtml(date){
    const sv=_getDaySummaryValues(date), day=loadSalesHistory()[date]||{}, today=todayStr();
    const hours=sv.hours&&sv.hours!=='Stängt'?sv.hours:(date===today&&openingHours&&openingHours!=='Stängt'?openingHours:'');
    const sold=sv.adult+sv.child, fled=fledForDate(date), fc=sxForecast(date,hours);
    const perH=sxHourly(day.entries), typical=fc?sxAvgHourly(fc.days):null, range=sxRange(hours);
    const [s,e]=sxSpan(perH,range);
    const chart=s>=0&&e>s&&perH.some(v=>v>0)?`<figure class="sx-fig"><figcaption>Gäster per timme${typical?'<span class="sx-key"><i aria-hidden="true"></i>brukar</span>':''}</figcaption>${sxChart(perH,typical&&typical.avg,s,e,{label:'Gäster per timme',unit:'gäster'})}</figure>`:'';
    // Kronor per timme (admin). Siffror som rättats för hand gäller före köpen.
    const iph=isAdmin?(Array.isArray(day._ov_intakePerHour)?day._ov_intakePerHour:intakeBucketsByHour(date)):null;
    let till='';
    if(isAdmin){
      const pay=paymentTotalsForDate(date), net=sv.intakeTotal-sv.costs;
      const fact=(l,v,cls='')=>`<div><dt>${l}</dt><dd${cls?` class="${cls}"`:''}>${v}</dd></div>`;
      const kinds=[['Vuxna',sv.intakeAdult],['Barn',sv.intakeChild],['Re-entry',sv.intakeReEntry],['Övrigt',sv.intakeOther]].filter(([,v])=>v).map(([l,v])=>fact(l,sxKr(v))).join('');
      const paid=['Swish','Kort','Kontant'].filter(m=>pay[m]).map(m=>fact(m,sxKr(pay[m]))).join('');
      // Utgifterna skrivs in under Hantera → Ekonomi
      // Kvällens andel av säsongskostnaderna (Hantera → Ekonomi), bara för kvällar med intäkt
      const share=typeof admSeasonShare==='function'&&sv.intakeTotal>0?Math.round(admSeasonShare(date.slice(0,4)).share):0;
      const costs=sxKr(sv.costs);
      const [is,ie]=sxSpan(iph,range);
      till=`<div class="sx-till"><p class="sx-till-h">Kassan</p>
        <div class="sx-big sx-big--kr"><strong>${sxKr(sv.intakeTotal)}</strong><span>intäkt${fc&&fc.income?` · brukar ${sxKr(fc.income)}`:''}</span></div>
        ${kinds?`<dl class="sx-facts sx-facts--sm" aria-label="Sålt">${kinds}</dl>`:''}
        <dl class="sx-facts sx-facts--sm" aria-label="Betalt">${paid}${fact('Utgifter',costs)}${fact('Resultat',sxKr(net),net>=0?'is-up':'is-down')}${share?fact('Andel säsongskostnader',sxKr(share))+fact('Efter andel',sxKr(net-share),net-share>=0?'is-up':'is-down'):''}</dl>
        ${is>=0&&ie>is&&iph.some(v=>v>0)?`<figure class="sx-fig"><figcaption>Intäkt per timme</figcaption>${sxChart(iph,null,is,ie,{label:'Intäkt per timme',unit:'kr'})}</figure>`:''}
        ${date===today?'<div class="sx-tools"><button type="button" class="btn" onclick="showAdmissionReconcile()">Stäm av insläppen</button></div><div id="admitReconcilePanel"></div>':''}
        ${sxReceiptsHtml(date)}</div>`;
    }
    return `<div class="sx-sum">
      <div class="sx-live">
        <div class="sx-big"><strong>${sxNum(sold)}</strong><span>sålda biljetter</span></div>
        <dl class="sx-facts"><div><dt>Insläppta</dt><dd>${sxNum(sv.totalInslapp)}</dd></div><div><dt>Re-entry</dt><dd>${sxNum(sv.reEntryInslapp)}</dd></div>${fled?`<div><dt>Fegade ur</dt><dd>${sxNum(fled)}</dd></div>`:''}<div><dt>Köp</dt><dd>${sxNum(sv.buys)}</dd></div></dl>
      </div>
      <p class="sx-sum-sub">${sxNum(sv.adult)} vuxna · ${sxNum(sv.child)} barn${sv.reEntryBuys?` · ${sxNum(sv.reEntryBuys)} re-entry-köp`:''}${fc?`<small>Brukar vara ca ${sxNum(fc.guests)} · ${sxEsc(fc.text.charAt(0).toLowerCase()+fc.text.slice(1))}</small>`:''}</p>
      ${chart}${till}
    </div>`;
  }
