/* ============================== UI: DIALOGER, NOTISER OCH LJUD ==============================
   Ersätter webbläsarens alert/confirm/prompt med rutor i hotellets stil.
   Laddas före app.js och används av både personalvyerna och gästsidan (guest.js). */

  /* ---------- Notiser (ersätter alert) ---------- */
  function _toastStack(){
    let el=document.getElementById('uiToasts');
    if(!el){ el=document.createElement('div'); el.id='uiToasts'; el.className='ui-toasts'; el.setAttribute('role','status'); el.setAttribute('aria-live','polite'); document.body.appendChild(el); }
    return el;
  }
  // Tonen gissas från texten så att gamla anrop kan bytas rakt av; kind kan också anges.
  function _guessKind(msg){
    if(/^(Kunde inte|Du har inte|Endast|Ogiltig|Tomt|Finns redan|Det finns redan|Datumet har)/i.test(msg)) return 'error';
    if(/(sparad|sparade|Sparat|kopierad|återlagd|borttagen|Borttaget)/i.test(msg)) return 'ok';
    return 'info';
  }
  function notify(msg, opts){
    const o=(typeof opts==='string')?{kind:opts}:(opts||{});
    const text=String(msg??'');
    const kind=o.kind||_guessKind(text);
    const t=document.createElement('div');
    t.className='ui-toast ui-toast--'+kind;
    if(kind==='error') t.setAttribute('role','alert');
    const icon={ok:'✓',error:'!',info:'i'}[kind]||'i';
    t.innerHTML=`<span class="ui-toast-icon" aria-hidden="true">${icon}</span><span class="ui-toast-msg"></span><button type="button" class="ui-toast-close" aria-label="Stäng">×</button>`;
    t.querySelector('.ui-toast-msg').textContent=text;
    const close=()=>{ if(t._closed) return; t._closed=true; t.classList.remove('is-in'); setTimeout(()=>t.remove(),260); };
    t.querySelector('.ui-toast-close').addEventListener('click',close);
    _toastStack().appendChild(t);
    requestAnimationFrame(()=>t.classList.add('is-in'));
    const ms=o.duration??(kind==='error'?7000:Math.min(9000,2800+text.length*45));
    setTimeout(close,ms);
    return close;
  }

  /* ---------- Dialogruta ---------- */
  // openDialog({title, body (html-sträng eller nod), actions:[{label,value,primary,danger}], className, dismissValue})
  // Löser ut med värdet på knappen som trycks, eller dismissValue vid Esc/klick utanför.
  const _dialogStack=[];
  // Esc stänger översta rutan även om fokus hamnat utanför den (t.ex. efter klick på text i rutan)
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&_dialogStack.length){ e.preventDefault(); e.stopPropagation(); _dialogStack[_dialogStack.length-1](); } },true);
  function openDialog({title='', body='', actions=[{label:'OK',value:true,primary:true}], className='', dismissValue=null, onOpen=null, labelledBy=null}={}){
    return new Promise(resolve=>{
      const prevFocus=document.activeElement;
      const overlay=document.createElement('div');
      overlay.className='ui-dialog-overlay';
      const box=document.createElement('div');
      box.className='ui-dialog '+className;
      box.setAttribute('role','dialog'); box.setAttribute('aria-modal','true');
      const titleId='uiDlg'+Math.random().toString(36).slice(2,8);
      if(title){ const h=document.createElement('h3'); h.className='ui-dialog-title'; h.id=titleId; h.textContent=title; box.appendChild(h); box.setAttribute('aria-labelledby',titleId); }
      else if(labelledBy){ box.setAttribute('aria-labelledby',labelledBy); }
      const content=document.createElement('div'); content.className='ui-dialog-body';
      if(typeof body==='string') content.innerHTML=body; else if(body) content.appendChild(body);
      box.appendChild(content);
      if(actions&&actions.length){
        const row=document.createElement('div'); row.className='ui-dialog-actions';
        actions.forEach(a=>{ const b=document.createElement('button'); b.type='button'; b.className='ui-dialog-btn'+(a.primary?' is-primary':'')+(a.danger?' is-danger':''); b.textContent=a.label; b.addEventListener('click',()=>done(typeof a.value==='function'?a.value(box):a.value)); row.appendChild(b); });
        box.appendChild(row);
      }
      overlay.appendChild(box);
      // Tangenter hanteras i rutan och stoppas där, så att kassans kortkommandon inte reagerar under tiden
      function onKey(e){
        e.stopPropagation();
        if(e.key==='Escape'){ e.preventDefault(); done(dismissValue); }
        if(e.key==='Tab'){ // håll fokus inne i rutan
          const f=[...box.querySelectorAll('button,input,textarea,select,a[href]')].filter(x=>!x.disabled&&x.offsetParent!==null);
          if(!f.length) return; const first=f[0], last=f[f.length-1];
          if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
          else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
        }
      }
      let finished=false;
      const dismiss=()=>done(dismissValue);
      function done(v){
        if(finished) return; finished=true;
        const i=_dialogStack.indexOf(dismiss); if(i>=0) _dialogStack.splice(i,1);
        overlay.classList.remove('is-in');
        setTimeout(()=>overlay.remove(),220);
        try{ prevFocus&&prevFocus.focus&&prevFocus.focus({preventScroll:true}); }catch(_e){}
        resolve(v);
      }
      overlay.addEventListener('mousedown',e=>{ if(e.target===overlay) done(dismissValue); });
      box.addEventListener('keydown',onKey);
      _dialogStack.push(dismiss);
      document.body.appendChild(overlay);
      requestAnimationFrame(()=>overlay.classList.add('is-in'));
      box._close=done;
      if(onOpen) onOpen(box,done);
      const focusEl=box.querySelector('input,textarea')||box.querySelector('.ui-dialog-btn.is-primary')||box.querySelector('button');
      setTimeout(()=>{ focusEl&&focusEl.focus(); if(focusEl&&focusEl.select&&focusEl.tagName==='INPUT') focusEl.select(); },30);
    });
  }

  // Ersätter confirm(): await uiConfirm('Ta bort?') → true/false
  function uiConfirm(message,{okLabel='OK',cancelLabel='Avbryt',danger=false,title=''}={}){
    const p=document.createElement('p'); p.className='ui-dialog-text'; p.textContent=message;
    return openDialog({title,body:p,dismissValue:false,actions:[{label:cancelLabel,value:false},{label:okLabel,value:true,primary:!danger,danger}]});
  }

  // Ersätter prompt(): await uiPrompt('Dagens utgifter (kr)', '0') → sträng eller null
  function uiPrompt(message,defaultValue='',{okLabel='Spara',cancelLabel='Avbryt',inputMode='text',title=''}={}){
    const wrap=document.createElement('label'); wrap.className='ui-dialog-field';
    const span=document.createElement('span'); span.className='ui-dialog-label'; span.textContent=message;
    const inp=document.createElement('input'); inp.type='text'; inp.className='ui-dialog-input'; inp.value=defaultValue??''; inp.inputMode=inputMode; inp.autocomplete='off';
    wrap.append(span,inp);
    return openDialog({title,body:wrap,dismissValue:null,onOpen:(box,done)=>{ inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); done(inp.value); } }); },
      actions:[{label:cancelLabel,value:null},{label:okLabel,value:()=>inp.value,primary:true}]});
  }

  // Visar text att kopiera när urklipp inte är tillgängligt
  function uiCopyDialog(message,text){
    const wrap=document.createElement('div');
    const p=document.createElement('p'); p.className='ui-dialog-text'; p.textContent=message;
    const ta=document.createElement('textarea'); ta.className='ui-dialog-input ui-dialog-textarea'; ta.readOnly=true; ta.value=text;
    wrap.append(p,ta);
    return openDialog({body:wrap,dismissValue:true,onOpen:()=>setTimeout(()=>{ ta.focus(); ta.select(); },40),actions:[{label:'Stäng',value:true,primary:true}]});
  }

  /* ---------- Ljud ----------
     Allt ljud skapas med Web Audio, så det behövs inga ljudfiler. Ljud spelas bara när
     användaren själv gör något (bläddrar, river, stämplar); det finns inget bakgrundsljud. */
  const KorpenSound=(()=>{
    let ctx=null, master=null, noise=null;
    function ac(){
      if(!ctx){ const C=window.AudioContext||window.webkitAudioContext; if(!C) return null; ctx=new C(); master=ctx.createGain(); master.gain.value=0.9; master.connect(ctx.destination); }
      if(ctx.state==='suspended') ctx.resume().catch(()=>{});
      return ctx;
    }
    // Två sekunder brus som återanvänds; varje ljud startar på ett slumpat ställe
    function noiseSrc(){
      const c=ac();
      if(!noise){ const len=c.sampleRate*2; noise=c.createBuffer(1,len,c.sampleRate); const d=noise.getChannelData(0); for(let i=0;i<len;i++) d[i]=Math.random()*2-1; }
      const n=c.createBufferSource(); n.buffer=noise; n.loop=true; n.loopStart=0; n.loopEnd=2; return n;
    }
    function band(c,type,freq,q){ const f=c.createBiquadFilter(); f.type=type; f.frequency.value=freq; if(q!=null) f.Q.value=q; return f; }
    function env(c,points){ const g=c.createGain(); g.gain.setValueAtTime(0,points[0][0]); points.forEach(([t,v])=>g.gain.linearRampToValueAtTime(v,t)); return g; }

    // Kort bekräftelse i kassan: två toner uppåt
    function chime(){
      const c=ac(); if(!c) return; const t=c.currentTime;
      [[880,0],[1318.5,0.09]].forEach(([fr,dt])=>{ const o=c.createOscillator(); o.type='triangle'; o.frequency.value=fr; const g=c.createGain(); g.gain.setValueAtTime(0,t+dt); g.gain.linearRampToValueAtTime(0.18,t+dt+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+dt+0.45); o.connect(g).connect(master); o.start(t+dt); o.stop(t+dt+0.5); });
    }

    // Papper som rivs längs en perforering: en rad små ryck i ljust brus
    function tear(){
      const c=ac(); if(!c) return; const t=c.currentTime;
      const n=noiseSrc(); const f=band(c,'bandpass',2200,0.9); f.frequency.linearRampToValueAtTime(4200,t+0.35);
      const g=c.createGain(); g.gain.setValueAtTime(0,t);
      for(let i=0;i<11;i++){ const tt=t+i*0.028+Math.random()*0.01; g.gain.linearRampToValueAtTime(0.2+Math.random()*0.25,tt+0.006); g.gain.linearRampToValueAtTime(0.02,tt+0.024); }
      g.gain.linearRampToValueAtTime(0,t+0.38);
      n.connect(f).connect(g).connect(master); n.start(t,Math.random()*1.5); n.stop(t+0.4);
    }

    // Ett blad i en gammal bok vänds.
    // 1) prassel när bladet lyfts, 2) luftdraget när det sveper över, 3) en torr smäll när det lägger sig.
    function pageTurn(dur=0.8){
      const c=ac(); if(!c) return; const t=c.currentTime;
      // Prassel: ljust brus som fladdrar i styrka
      const r=noiseSrc(); const rh=band(c,'highpass',1800); const rp=band(c,'peaking',4200,0.7); rp.gain.value=6;
      const rg=c.createGain(); rg.gain.setValueAtTime(0,t);
      for(let k=0;k<dur*0.75;k+=0.018){ rg.gain.linearRampToValueAtTime((0.03+Math.random()*0.09)*(1-k/dur),t+k); }
      rg.gain.linearRampToValueAtTime(0,t+dur*0.8);
      r.connect(rh).connect(rp).connect(rg).connect(master); r.start(t,Math.random()*1.5); r.stop(t+dur);
      // Luftdrag: mörkare brus som sveper upp och ned
      const a=noiseSrc(); const af=band(c,'bandpass',500,0.8); af.frequency.setValueAtTime(350,t); af.frequency.linearRampToValueAtTime(1300,t+dur*0.5); af.frequency.linearRampToValueAtTime(450,t+dur*0.9);
      const ag=env(c,[[t,0],[t+dur*0.45,0.22],[t+dur*0.85,0.05],[t+dur,0]]);
      a.connect(af).connect(ag).connect(master); a.start(t,Math.random()*1.5); a.stop(t+dur+0.05);
      // Bladet lägger sig
      const lt=t+dur*0.86;
      const s=noiseSrc(); const sf=band(c,'bandpass',1100,1.2);
      const sg=c.createGain(); sg.gain.setValueAtTime(0,lt); sg.gain.linearRampToValueAtTime(0.28,lt+0.004); sg.gain.exponentialRampToValueAtTime(0.0001,lt+0.07);
      s.connect(sf).connect(sg).connect(master); s.start(lt,Math.random()*1.5); s.stop(lt+0.1);
      const o=c.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(95,lt); o.frequency.exponentialRampToValueAtTime(50,lt+0.1);
      const og=c.createGain(); og.gain.setValueAtTime(0,lt); og.gain.linearRampToValueAtTime(0.1,lt+0.005); og.gain.exponentialRampToValueAtTime(0.0001,lt+0.12);
      o.connect(og).connect(master); o.start(lt); o.stop(lt+0.15);
    }

    // En gummistämpel mot ett kort på en bänk: kort knack, dov duns och ett litet skrap
    function stamp(){
      const c=ac(); if(!c) return; const t=c.currentTime;
      const k=noiseSrc(); const kf=band(c,'bandpass',1600,1.4);
      const kg=c.createGain(); kg.gain.setValueAtTime(0,t); kg.gain.linearRampToValueAtTime(0.35,t+0.003); kg.gain.exponentialRampToValueAtTime(0.0001,t+0.05);
      k.connect(kf).connect(kg).connect(master); k.start(t,Math.random()*1.5); k.stop(t+0.07);
      const o=c.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(140,t); o.frequency.exponentialRampToValueAtTime(55,t+0.14);
      const og=c.createGain(); og.gain.setValueAtTime(0,t); og.gain.linearRampToValueAtTime(0.45,t+0.004); og.gain.exponentialRampToValueAtTime(0.0001,t+0.2);
      o.connect(og).connect(master); o.start(t); o.stop(t+0.22);
      const w=noiseSrc(); const wf=band(c,'lowpass',900);
      const wg=env(c,[[t+0.02,0],[t+0.05,0.05],[t+0.16,0]]);
      w.connect(wf).connect(wg).connect(master); w.start(t,Math.random()*1.5); w.stop(t+0.18);
    }

    return { chime, tear, pageTurn, stamp };
  })();

  function uiVibrate(pattern){ try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch(_e){} }
