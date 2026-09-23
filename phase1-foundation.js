/* AquaSearcher Phase 1 — foundation cleanup.
   Goals:
   1) recover from the old "f is not defined" crawl failure;
   2) filter/deduplicate low-value water/access candidates;
   3) group nearby candidates so one location is not counted repeatedly;
   4) expose transparent scoring reasons without changing the existing UI.
*/
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const FEET_PER_MILE=5280;

  function distFt(a,b){
    if(!a||!b)return Infinity;
    const R=3958.7613, p1=a.lat*Math.PI/180, p2=b.lat*Math.PI/180;
    const dlat=(b.lat-a.lat)*Math.PI/180, dlng=(b.lng-a.lng)*Math.PI/180;
    const q=Math.sin(dlat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dlng/2)**2;
    return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q))*FEET_PER_MILE;
  }

  function scoreReason(f){
    const reasons=[];
    if(f.isPinTest)reasons.push('Exact search-pin test area');
    if(f.accessType&&f.accessType!=='none')reasons.push((f.accessType||'access')+' nearby');
    if(Number.isFinite(f.accessDistance))reasons.push(Math.round(f.accessDistance*5280)+' ft from mapped access');
    if(f.hist?.persistenceCount>=2)reasons.push(f.hist.persistenceCount+' repeated historical periods');
    else if(f.hist?.best>=48)reasons.push('historical visual change');
    if(f.veh?.best)reasons.push('vehicle-class detection');
    if(f.waterSuitability!=null)reasons.push('water suitability '+f.waterSuitability+'/100');
    if(!reasons.length)reasons.push('screening evidence pending');
    return reasons;
  }

  function waterSuitability(f){
    const type=String(f.ftype||'').toLowerCase();
    const name=String(f.name||'').toLowerCase();
    let s=65;
    if(/stream|river|canal|ditch|drain|waterway/.test(type))s-=25;
    if(/canal|ditch|drain|fountain|pool|swimming|ornamental|decorative/.test(name+' '+type))s-=35;
    if(Number.isFinite(f.waterWidthFt)){
      if(f.waterWidthFt<25)s-=50;
      else if(f.waterWidthFt<40)s-=25;
      else if(f.waterWidthFt>=75)s+=15;
    }
    if(f.access>75)s+=10;
    if(f.nearPin)s+=5;
    return Math.max(0,Math.min(100,Math.round(s)));
  }

  function usableWater(f){
    if(!f||f.isPinTest)return true;
    const type=String(f.ftype||'').toLowerCase();
    const name=String(f.name||'').toLowerCase();
    if(/fountain|swimming pool|ornamental pond|decorative pond/.test(name))return false;
    if(/canal|ditch|drainageway/.test(name+' '+type) && (f.access||0)<75)return false;
    if(Number.isFinite(f.waterWidthFt)&&f.waterWidthFt<25)return false;
    if(/streamriver|stream|canal/.test(type) && Number.isFinite(f.waterWidthFt) && f.waterWidthFt<40 && (f.access||0)<80)return false;
    return true;
  }

  function dedupeWater(arr){
    const kept=[];
    for(const f of arr){
      let duplicate=null;
      for(const k of kept){
        const sameName=f.name&&k.name&&f.name===k.name;
        const sameType=String(f.ftype)===String(k.ftype);
        const near=distFt(f,k)<=175;
        if(near&&(sameName||sameType||f.nearPin||k.nearPin)){duplicate=k;break;}
      }
      if(!duplicate)kept.push(f);
      else{
        const winner=(f.priority||0)>(duplicate.priority||0)?f:duplicate;
        const loser=winner===f?duplicate:f;
        winner.groupedCount=(winner.groupedCount||1)+(loser.groupedCount||1);
        winner.groupedEvidence=winner.groupedEvidence||[];
        winner.groupedEvidence.push({name:loser.name,lat:loser.lat,lng:loser.lng});
        if((loser.access||0)>(winner.access||0))winner.access=loser.access;
        if((loser.hist?.best||0)>(winner.hist?.best||0))winner.hist=loser.hist;
        if((loser.veh?.best)&&!winner.veh?.best)winner.veh=loser.veh;
        if(winner!==duplicate){kept.splice(kept.indexOf(duplicate),1);kept.push(winner);}
      }
    }
    return kept;
  }

  function dedupeAccess(arr){
    const kept=[];
    for(const f of arr||[]){
      const dup=kept.find(k=>distFt(f,k)<=125 && (f.type===k.type || f.sourceId===k.sourceId));
      if(!dup)kept.push(f);
      else{
        const winner=(f.priority||0)>(dup.priority||0)?f:dup;
        winner.groupedCount=(winner.groupedCount||1)+1;
        if((f.access||0)>(winner.access||0))winner.access=f.access;
      }
    }
    return kept;
  }

  function recalc(f){
    f.waterSuitability=waterSuitability(f);
    const access=Number(f.access)||0;
    const hist=Number(f.hist?.best)||0;
    const vehicle=f.veh?.best?Math.round((Number(f.veh.best.confidence)||0)*100):0;
    const pin=f.isPinTest?90:(f.nearPin?70:0);
    // Foundation score: access and historical evidence lead; object evidence is supporting evidence.
    f.priority=Math.max(0,Math.min(100,Math.round(
      access*.40 + hist*.30 + vehicle*.15 + f.waterSuitability*.10 + pin*.05
    )));
    if(f.isPinTest)f.priority=Math.max(f.priority,70);
    f.label=f.priority>=80?'HIGH':f.priority>=55?'MEDIUM':'LOW';
    f.scoring={
      access:40,historical:30,object:15,waterSuitability:10,location:5,
      note:'Phase 1 screening score. Access and historical evidence lead; object detection is supporting evidence.'
    };
    f.scoreReasons=scoreReason(f);
    return f;
  }

  function decorateCard(card,f){
    if(!card||!f)return;
    const old=card.querySelector('.phase1-evidence');if(old)old.remove();
    const d=document.createElement('div');
    d.className='phase1-evidence small';
    d.style.cssText='margin-top:6px;padding-top:5px;border-top:1px solid #d7e2ea';
    d.innerHTML='<b>Why:</b> '+f.scoreReasons.slice(0,4).join(' · ')+
      (f.groupedCount>1?' · '+f.groupedCount+' nearby detections grouped':'')+
      '<br><b>Score:</b> Access '+(f.access??0)+'/100 · Historical '+(f.hist?.best??0)+'/100 · Object '+(f.veh?.best?Math.round((f.veh.best.confidence||0)*100):0)+'/100 · Water '+f.waterSuitability+'/100';
    card.appendChild(d);
  }

  function decorateAll(){
    const arr=window.__aquaFindings||[];
    const cards=[...document.querySelectorAll('#cards .card')];
    for(const card of cards){
      const text=(card.textContent||'');
      const f=arr.find(x=>x&&x.name&&text.includes(x.name));
      if(f)decorateCard(card,f);
    }
  }

  function phase1Process(){
    const arr=window.__aquaFindings;
    if(!Array.isArray(arr)||!arr.length)return false;
    const pin=arr.find(x=>x&&x.isPinTest);
    const mapped=arr.filter(x=>x&&!x.isPinTest);
    const filtered=mapped.filter(usableWater);
    const grouped=dedupeWater(filtered);
    if(pin)grouped.unshift(pin);
    grouped.forEach(recalc);

    // Keep the original array object so the existing render() closure sees our changes.
    arr.splice(0,arr.length,...grouped);

    if(Array.isArray(window.aquaV16Access)){
      const access=dedupeAccess(window.aquaV16Access);
      access.forEach(recalc);
      window.aquaV16Access=access;
      renderAccessPhase1(access);
    }

    grouped.sort((a,b)=>(b.priority||0)-(a.priority||0));
    if(typeof window.render==='function')window.render();
    setTimeout(decorateAll,50);

    const removed=mapped.length-filtered.length;
    const groupedAway=Math.max(0,mapped.length-filtered.length?filtered.length-grouped.length:filtered.length-grouped.length);
    const status=$('status');
    if(status)status.textContent='Phase 1 complete — '+grouped.length+' water candidates after filtering/grouping'+(removed?' · '+removed+' low-utility water features removed':'')+'.';
    return true;
  }

  function renderAccessPhase1(list){
    const old=document.querySelector('[data-phase1-access]');
    if(old)old.remove();
    const host=$('cards');if(!host)return;
    const wrap=document.createElement('div');
    wrap.dataset.phase1Access='1';
    wrap.style.cssText='margin:10px 0 0;padding-top:8px;border-top:2px solid #b9ccd8';
    const h=document.createElement('div');
    h.innerHTML='<b style="color:#0a4565">🚤 ACCESS POINTS — PHASE 1</b> <span class="small">('+list.length+')</span>';
    wrap.appendChild(h);
    list.slice().sort((a,b)=>(b.priority||0)-(a.priority||0)).forEach(f=>{
      const d=document.createElement('div');
      d.className='card '+(f.label==='HIGH'?'high':f.label==='LOW'?'low':'');
      d.innerHTML='<span class="pill">'+f.label+'</span><b>'+String(f.name||'WATER ACCESS POINT')+'</b>'+
        '<div class="small">'+(f.type||'access')+' · '+(f.source||'unknown')+' · Access '+(f.access||0)+'/100'+
        (f.waterDistance!=null?' · '+f.waterDistance+'m to mapped water':'')+'</div>'+
        '<div class="phase1-evidence small"><b>Why:</b> '+scoreReason(f).slice(0,3).join(' · ')+
        '<br><b>Score:</b> Access '+(f.access||0)+'/100 · Historical '+(f.histAccess?.score||0)+'/100</div>';
      wrap.appendChild(d);
    });
    host.prepend(wrap);
  }

  async function recoverOldFailure(){
    // The V16 stack has several wrappers. If the old handler fails before it reaches
    // "Search complete", run the base water/access discovery directly when available.
    const status=String($('status')?.textContent||'');
    if(!/f is not defined/i.test(status))return false;
    try{
      const raw=$('loc')?.value||'';
      const m=raw.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
      if(!m||typeof window.getWater!=='function'||typeof window.makeFinding!=='function'){
        if($('status'))$('status').textContent='Search stopped. The previous JavaScript error was caught; no fallback location/search function was available.';
        return false;
      }
      const p={lat:+m[1],lng:+m[2]},r=+$('radius')?.value||1;
      if($('status'))$('status').textContent='Phase 1 recovery: rerunning the water search without the failed wrapper…';
      const ws=await window.getWater(p,r);
      const access=typeof window.getAccess==='function'?await window.getAccess(p,r):[];
      const aa=(access||[]).map(window.accPoint).filter(Boolean);
      const fs=ws.map((w,i)=>window.makeFinding(w,i,aa)).filter(Boolean);
      fs.unshift({id:'phase1-pin-recovery',lat:p.lat,lng:p.lng,name:'Exact search-pin test area',ftype:'known-coordinate test',access:100,anomaly:0,priority:70,label:'HIGH',isPinTest:true,nearPin:true});
      window.__aquaFindings=fs;
      if(typeof window.render==='function')window.render();
      phase1Process();
      if($('status'))$('status').textContent='Phase 1 recovery complete — '+fs.length+' candidates rebuilt after the old JavaScript error.';
      return true;
    }catch(e){
      console.error('Phase 1 recovery failed',e);
      if($('status'))$('status').textContent='Search recovery failed: '+(e?.message||e);
      return false;
    }
  }

  function install(){
    const start=$('start');
    if(!start||start.__phase1Installed)return;
    const old=start.onclick;
    if(typeof old!=='function')return;
    start.__phase1Installed=true;
    start.onclick=async function(ev){
      try{await old.call(this,ev);}catch(e){console.error('Phase 1 caught search error',e)}
      await sleep(250);
      await recoverOldFailure();
      phase1Process();
    };
    const logo=document.querySelector('.logo small');if(logo)logo.textContent='PHASE 1';
    const header=document.querySelector('header');
    if(header&&!document.getElementById('phase1badge')){
      const b=document.createElement('span');b.id='phase1badge';b.textContent='Phase 1 foundation active';
      b.style.cssText='font-size:10px;color:#b9e7ff;margin-left:auto;opacity:.9';header.appendChild(b);
    }
  }

  window.addEventListener('load',()=>setTimeout(install,1200));
  setTimeout(install,1800);
})();
