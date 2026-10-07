/* AquaSearcher V17 — access-first ranking + conservative water filtering.
   Additive safety layer: preserves existing Phase 1/2/3 findings and imagery scans.
*/
(function(){
'use strict';
const $=id=>document.getElementById(id);
const clamp=v=>Math.max(0,Math.min(100,Math.round(Number(v)||0)));
const distFt=(a,b)=>{
  if(!a||!b)return Infinity;
  const R=20902260.5,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180;
  const dp=(b.lat-a.lat)*Math.PI/180,dl=(b.lng-a.lng)*Math.PI/180;
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
};

function accessInfo(f){
  const arr=(window.aquaV16Access||[]).filter(x=>Number.isFinite(+x.lat)&&Number.isFinite(+(x.lng??x.lon)));
  let best=null,d=Infinity;
  for(const a of arr){const n=distFt(f,{lat:+a.lat,lng:+(a.lng??a.lon)});if(n<d){d=n;best=a}}
  return {best,distanceFt:d};
}

function waterInfo(f){
  const p=f.phase2||{};
  const cls=String(p.waterClass||f.ftype||f.waterType||'').toUpperCase();
  const width=Number(f.waterWidthFt??p.waterWidthFt);
  const area=Number(f.waterAreaSqKm??p.waterAreaSqKm);
  const named=!!String(f.name||'').trim();
  const linear=['STREAM','CANAL','FLOWLINE','DRAINAGE DITCH','DITCH'].some(x=>cls.includes(x));
  return {cls,width:Number.isFinite(width)?width:null,area:Number.isFinite(area)?area:null,named,linear};
}

function waterPenalty(f){
  const w=waterInfo(f),a=accessInfo(f);
  let penalty=0,reasons=[];
  if(w.width!=null){
    if(w.width<25){penalty+=55;reasons.push('very narrow water');}
    else if(w.width<35){penalty+=32;reasons.push('narrow water');}
    else if(w.width<45){penalty+=14;reasons.push('borderline width');}
  }
  if(w.area!=null){
    if(w.area<0.005){penalty+=32;reasons.push('very small water area');}
    else if(w.area<0.01){penalty+=18;reasons.push('small water area');}
  }
  if(w.linear && a.distanceFt>250){
    penalty+=35;reasons.push('linear water without close access');
  }
  if(!a.best && w.linear){
    penalty+=20;reasons.push('no mapped entry');
  }
  // Strong evidence can rescue a small body: never hard-delete a candidate.
  const hist=clamp(f.hist?.heroScore??f.hist?.best??f.historicalChange??f.changeScore);
  const access=clamp(f.access??f.phase2?.accessScore);
  if(hist>=70 && access>=45){
    penalty=Math.round(penalty*.35);
    reasons.push('strong anomaly/access override');
  }
  return {penalty,reasons,water:w,access:a};
}

function accessStrength(a){
  if(!a)return 0;
  const t=String(a.type||a.kind||'').toLowerCase(),n=String(a.name||'').toLowerCase();
  let s=55;
  if(t==='official')s=92;
  else if(t==='road-end')s=86;
  else if(t==='mapped')s=78;
  else if(t==='road-shore-approach')s=70;
  if(/ramp|launch|slipway|marina|boat/.test(n))s=Math.max(s,95);
  if(/dock|pier/.test(n))s=Math.max(s,88);
  return s;
}

function rescore(f){
  if(!f||f.isPinTest)return f;
  const ai=accessInfo(f), aScore=clamp(f.access);
  const hist=clamp(f.hist?.heroScore??f.hist?.best??f.historicalChange??f.changeScore);
  const localized=clamp(f.hist?.heroScore??f.hist?.changeConfidence??f.hist?.best);
  const veh=clamp(f.vehicleEvidence?.score??f.veh?.detectionScore??f.objectScore);
  const phase2=clamp(f.phase2?.phase2Score);
  const wf=waterPenalty(f);
  const nearAccess=ai.distanceFt<=250;
  const accessQuality=Math.max(aScore,accessStrength(ai.best));
  const strongHero=!!f.hist?.changeEstablished || localized>=70;
  let score = accessQuality*.28 + hist*.28 + veh*.14 + phase2*.10 + aScore*.10;
  if(strongHero && nearAccess)score+=24;
  else if(strongHero && ai.distanceFt<=500)score+=12;
  if(nearAccess)score+=Math.max(0,10-Math.min(10,ai.distanceFt/25));
  score-=wf.penalty;
  f.v17={
    accessDistanceFt:Number.isFinite(ai.distanceFt)?Math.round(ai.distanceFt):null,
    accessType:ai.best?.type||ai.best?.kind||'',
    accessName:ai.best?.name||'',
    accessQuality,
    historicalScore:hist,
    vehicleScore:veh,
    waterPenalty:wf.penalty,
    waterReasons:wf.reasons,
    heroNearAccess:strongHero&&nearAccess
  };
  f.priority=clamp(score);
  f.label=f.priority>=80?'HIGH':f.priority>=55?'MEDIUM':'LOW';
  if(f.v17.heroNearAccess){
    f.why='TOP PRIORITY: localized historical change near '+(ai.best?.name||ai.best?.type||'mapped access')+
      ' ('+Math.round(ai.distanceFt)+' ft). Historical imagery is screening evidence, not proof of a vehicle.';
  }else if(wf.reasons.length){
    f.why=(f.why||'')+' Water screening: '+wf.reasons.join(', ')+'.';
  }
  return f;
}

function setVehicleThreshold(){
  // Make the UI's 15+ ft setting control the actual detector threshold.
  if(window.__aquaVehicleThresholdPatch)return;
  window.__aquaVehicleThresholdPatch=true;
  const old=window.vehicleScan;
  if(typeof old!=='function')return;
  const wrapped=async function(f,rs,silent){
    const out=await old.apply(this,arguments);
    const threshold=$('vehicle')?.checked?15:10;
    if(f?.veh){
      if(Array.isArray(f.veh.hits))f.veh.hits.forEach(h=>{h.sizeQualified=Number(h.estimatedSizeFt)>=threshold});
      f.veh.sizeThresholdFt=threshold;
      const strong=(f.veh.hits||[]).filter(h=>h.confidence>=.25&&h.sizeQualified);
      const years=new Set(strong.map(h=>h.year)).size;
      const best=strong[0]||null;
      f.veh.historicalReleasesWithHits=years;
      f.veh.best=best;
      f.objectScore=Math.min(100,Math.round(Math.min(1,years/3)*55+Math.min(1,(best?.confidence||0)/.7)*45));
      f.vehicleEvidence=f.vehicleEvidence||{};
      f.vehicleEvidence.score=f.objectScore;
      f.vehicleEvidence.sizeThresholdFt=threshold;
      f.vehicleEvidence.temporalConsensus=years;
      f.vehicleEvidence.status=best?threshold+'+ ft vehicle-class detection(s) found in '+years+' release(s).':'No '+threshold+'+ ft vehicle-class detection returned.';
    }
    return out;
  };
  wrapped.__v17=true;window.vehicleScan=wrapped;
}

function renderWhy(){
  const arr=window.__aquaFindings||window.findings||[];
  const byId=new Map(arr.map(f=>[f.id,f]));
  document.querySelectorAll('#cards .card').forEach(card=>{
    const id=card.dataset.findingId||card.dataset.id;
    const f=byId.get(id);
    if(!f?.v17)return;
    let box=card.querySelector('.v17-evidence');if(box)box.remove();
    box=document.createElement('div');box.className='v17-evidence small';
    box.style.cssText='margin-top:6px;padding:6px;background:#f7fbfd;border-top:1px solid #d7e2ea';
    const access=f.v17.accessDistanceFt!=null?(' · Access '+f.v17.accessDistanceFt+' ft'):'';
    const hist=f.v17.historicalScore?(' · Historical '+f.v17.historicalScore+'/100'):'';
    box.innerHTML='<b>Why ranked here:</b> '+(f.v17.heroNearAccess?'🚨 YEAR-CHANGE + ACCESS':'Access/historical screening')+
      access+hist+(f.v17.waterPenalty?' · Water penalty '+f.v17.waterPenalty:'')+
      (f.v17.accessName?' · '+f.v17.accessName:'');
    card.appendChild(box);
  });
}

function sortFindings(){
  const arr=window.__aquaFindings||window.findings||[];
  arr.forEach(rescore);
  arr.sort((a,b)=>(b.priority||0)-(a.priority||0));
  window.__aquaFindings=arr;
  window.findings=arr;
  if(typeof window.redraw==='function')window.redraw();
  if(typeof window.render==='function')window.render();
  setTimeout(renderWhy,80);
}

async function afterSearch(){
  setVehicleThreshold();
  // V16 already creates dense access corridors. Make those corridors explicit,
  // high-priority findings and guarantee the best few are screened.
  const arr=window.__aquaFindings||window.findings||[];
  const access=(window.aquaV16Access||[]).filter(x=>x&&Number.isFinite(+x.lat));
  for(const a of access){
    if(!a.corridor && typeof window.makeCorridor==='function')window.makeCorridor(a);
  }
  sortFindings();
  // Re-run the final ranking after V16/Phase 2/Phase 3 have had time to attach evidence.
  setTimeout(sortFindings,250);
  setTimeout(sortFindings,1000);
}

function install(){
  if(window.__aquaV17Installed)return;
  const start=$('start');
  if(!start||typeof start.onclick!=='function')return;
  window.__aquaV17Installed=true;
  const old=start.onclick;
  start.onclick=async function(...args){
    const r=await old.apply(this,args);
    await afterSearch();
    return r;
  };
  setVehicleThreshold();
  const logo=document.querySelector('.logo small');if(logo)logo.textContent='V17';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,500));
else setTimeout(install,500);
window.addEventListener('load',()=>setTimeout(install,800));
})();
