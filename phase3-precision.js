/* AquaSearcher Phase 3 — precision target verification.
   Purpose: turn Phase 1/2 candidates into evidence-backed target checks without
   allowing generic imagery change or a generic vehicle hit to masquerade as proof.
   This layer is additive and preserves the existing search, scoring and map.
*/
(function(){
'use strict';
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clamp=v=>Math.max(0,Math.min(100,Math.round(Number(v)||0)));

function miles(a,b){
  if(!a||!b)return Infinity;
  const R=3958.7613,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180;
  const dl=(b.lng-a.lng)*Math.PI/180,dp=(b.lat-a.lat)*Math.PI/180;
  const q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

function nearestAccess(f){
  const list=(window.aquaV16Access||[]).filter(x=>Number.isFinite(+x.lat)&&Number.isFinite(+x.lng));
  let best=null,d=Infinity;
  for(const a of list){
    const n=miles(f,{lat:+a.lat,lng:+a.lng});
    if(n<d){d=n;best=a}
  }
  return {best,distance:d};
}

function classifyGroundRisk(f){
  const a=nearestAccess(f), p2=f.phase2||{};
  const waterClass=String(p2.waterClass||f.ftype||'').toUpperCase();
  let risk=0,reasons=[];
  if(a.distance>0.20){risk+=30;reasons.push('no close mapped entry');}
  else if(a.distance>0.08){risk+=12;reasons.push('entry is not immediately adjacent');}
  if(['STREAM','CANAL','FLOWLINE'].includes(waterClass)){risk+=25;reasons.push('small/linear water feature');}
  if(p2.suitability!=null&&p2.suitability<45){risk+=25;reasons.push('low water suitability');}
  if(p2.accessScore!=null&&p2.accessScore<45){risk+=15;reasons.push('weak access evidence');}
  return {risk:clamp(risk),reasons};
}

function targetConsistency(f){
  const hits=Array.isArray(f.veh?.hits)?f.veh.hits:[];
  const strong=hits.filter(h=>h&&h.sizeQualified&&Number(h.confidence)>=.25);
  const years=[...new Set(strong.map(h=>String(h.year)))];
  const labels=[...new Set(strong.map(h=>String(h.label||'').toLowerCase()))];
  const exact=strong.filter(h=>miles(f,{lat:+h.lat,lng:+h.lng})<=0.10);
  const sizes=strong.map(h=>Number(h.estimatedSizeFt)||0).filter(Boolean);
  const avg=sizes.length?sizes.reduce((a,b)=>a+b,0)/sizes.length:0;
  let score=0;
  score+=Math.min(35,years.length*12);
  score+=Math.min(25,exact.length*8);
  if(labels.includes('truck'))score+=25;
  else if(labels.length)score+=10;
  if(avg>=15)score+=15;
  return {score:clamp(score),years,labels,exactHits:exact.length,avgSizeFt:avg};
}

function temporalStability(f){
  const h=f.hist||{}, c=Array.isArray(h.comparisons)?h.comparisons:[];
  if(!c.length)return {score:0,stable:false};
  const strong=c.filter(x=>Number(x.score)>=48);
  const localized=c.filter(x=>Number(x.localized)>=55);
  const score=clamp(Math.min(50,strong.length*8)+Math.min(50,localized.length*10));
  return {score,stable:strong.length>=2&&localized.length>=1};
}

function scoreTarget(f){
  const p2=f.phase2||{}, obj=targetConsistency(f), temp=temporalStability(f), ground=classifyGroundRisk(f);
  const vehicle=clamp(f.vehicleEvidence?.score??f.objectScore??f.veh?.detectionScore??0);
  const access=clamp(p2.accessScore??f.access??0);
  const history=clamp(p2.historicalScore??f.hist?.best??f.historicalChange??0);
  const suitability=clamp(p2.suitability??f.waterSuitability??0);
  const raw=vehicle*.30+obj.score*.20+access*.18+history*.12+suitability*.10+temp.score*.10-ground.risk*.20;
  const precision=clamp(raw);
  let status='SCREENING ONLY';
  if(vehicle>=60&&obj.score>=55&&access>=55&&ground.risk<35)status='TARGET CANDIDATE';
  if(vehicle>=70&&obj.score>=70&&access>=70&&temp.stable&&ground.risk<25)status='STRONG TARGET CANDIDATE';
  f.phase3={
    precisionScore:precision,
    status,
    targetClass:obj.labels.join(', ')||'none',
    temporalYears:obj.years,
    exactHits:obj.exactHits,
    averageDetectedSizeFt:obj.avgSizeFt?Math.round(obj.avgSizeFt*10)/10:null,
    temporalScore:temp.score,
    groundRisk:ground.risk,
    groundRiskReasons:ground.reasons,
    accessDistanceMi:Number.isFinite(p2.accessDistanceMi)?p2.accessDistanceMi:(Number.isFinite(f.accessDistance)?f.accessDistance:null),
    method:'Phase 3 multi-factor precision verification',
    note:'Automated screening; imagery and target identity still require human verification.'
  };
  f.phase3Priority=precision;
  return f;
}

function renderPhase3Evidence(){
  const arr=window.__aquaFindings||[];
  document.querySelectorAll('#cards .card').forEach(card=>{
    const id=card.dataset.findingId||card.dataset.id;
    const f=arr.find(x=>x.id===id);
    if(!f?.phase3)return;
    const old=card.querySelector('.phase3-evidence');if(old)old.remove();
    const d=document.createElement('div');d.className='phase3-evidence small';
    d.style.cssText='margin-top:6px;padding:6px;border-top:1px solid #d7e2ea;background:#f8fbfd';
    d.innerHTML='<b>Phase 3 precision:</b> '+f.phase3.status+' · Score '+f.phase3.precisionScore+'/100'+
      ' · Target '+(f.phase3.targetClass||'none')+
      ' · Temporal '+f.phase3.temporalScore+'/100'+
      ' · Ground risk '+f.phase3.groundRisk+'/100'+
      (f.phase3.averageDetectedSizeFt?' · Avg size '+f.phase3.averageDetectedSizeFt+' ft':'');
    card.appendChild(d);
  });
}

function drawPhase3Markers(){
  if(typeof L==='undefined'||!resultLayer)return;
  const arr=(window.__aquaFindings||[]).filter(f=>!f.isPinTest&&!f.accessPoint&&f.phase3);
  arr.sort((a,b)=>(b.phase3Priority||0)-(a.phase3Priority||0));
  arr.slice(0,60).forEach((f,i)=>{
    const s=f.phase3Priority||0;
    const color=s>=75?'#dc2626':s>=55?'#f59e0b':'#eab308';
    const m=L.circleMarker([f.lat,f.lng],{radius:s>=75?10:8,color:'#fff',weight:2,fillColor:color,fillOpacity:.9});
    m.bindTooltip('#'+(i+1)+' · Phase 3 '+s+'/100 · '+(f.name||'candidate'));
    m.on('click',()=>{if(typeof selectF==='function')selectF(f.id)});
    m.addTo(resultLayer);
  });
}

function exportRows(){
  return (window.__aquaFindings||[]).filter(f=>!f.isPinTest&&!f.accessPoint).map((f,i)=>({
    rank:i+1,name:f.name,lat:f.lat,lng:f.lng,
    phase2Score:f.phase2Priority||0,phase3Score:f.phase3Priority||0,
    phase3Status:f.phase3?.status||'',
    targetClass:f.phase3?.targetClass||'',
    exactHits:f.phase3?.exactHits??0,
    temporalYears:(f.phase3?.temporalYears||[]).join('|'),
    averageDetectedSizeFt:f.phase3?.averageDetectedSizeFt??'',
    groundRisk:f.phase3?.groundRisk??'',
    accessScore:f.phase2?.accessScore??f.access??0,
    historicalScore:f.phase2?.historicalScore??f.hist?.best??0,
    waterClass:f.phase2?.waterClass||'',
    note:f.phase3?.note||''
  }));
}

function downloadCSV(){
  const rows=exportRows();if(!rows.length){toast('No Phase 3 candidates to export.');return}
  const cols=Object.keys(rows[0]),esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv=[cols.map(esc).join(',')].concat(rows.map(r=>cols.map(k=>esc(r[k])).join(','))).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download='AquaSearcher-Phase3-precision.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
}

async function runPhase3(manual){
  const arr=window.__aquaFindings;
  if(!Array.isArray(arr)||!arr.length){if(manual)toast('Run Phase 1/2 first.');return}
  const candidates=arr.filter(f=>!f.isPinTest&&!f.accessPoint);
  if(!candidates.length){if(manual)toast('No water candidates available for Phase 3.');return}
  const top=candidates.slice().sort((a,b)=>(b.phase2Priority||b.priority||0)-(a.phase2Priority||a.priority||0)).slice(0,40);
  if($('phase3status'))$('phase3status').textContent='Running precision verification across Phase 2 candidates…';
  for(let i=0;i<top.length;i++){
    scoreTarget(top[i]);
    if($('phase3status'))$('phase3status').textContent='Phase 3 precision: '+(i+1)+'/'+top.length;
    await sleep(2);
  }
  top.sort((a,b)=>(b.phase3Priority||0)-(a.phase3Priority||0));
  window.__aquaPhase3Findings=top;
  renderPhase3Evidence();
  drawPhase3Markers();
  if($('phase3status'))$('phase3status').textContent='Complete — '+top.length+' candidates precision-checked. No Phase 1/2 findings were removed.';
  if(manual)toast('Phase 3 precision verification complete.');
}

function ensureBar(){
  if($('phase3bar'))return;
  const host=document.querySelector('.findings h3');if(!host)return;
  const b=document.createElement('div');b.id='phase3bar';
  b.style.cssText='margin:7px 0 9px;padding:8px;background:#fff8e6;border:1px solid #e6d39a;border-radius:8px;font-size:10px';
  b.innerHTML='<b>PHASE 3 PRECISION VERIFICATION</b><div id="phase3status" style="margin-top:4px;color:#60717f">Waiting for Phase 1/2.</div><div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap"><button id="p3run" class="btn2" style="width:auto">Run Phase 3</button><button id="p3csv" class="btn2" style="width:auto">CSV</button></div>';
  host.parentElement.insertBefore(b,host.nextSibling);
  $('p3run').onclick=()=>runPhase3(true);$('p3csv').onclick=downloadCSV;
}

function install(){
  ensureBar();
  if(window.__aquaPhase3Installed)return;
  window.__aquaPhase3Installed=true;
  const old=window.aquaPhase2?.run;
  if(typeof old==='function'){
    window.aquaPhase2.run=async function(...args){const r=await old.apply(this,args);await runPhase3(false);return r};
  }
  window.aquaPhase3={run:runPhase3,version:'3.0'};
}

window.addEventListener('load',()=>setTimeout(install,3500));
setTimeout(install,4200);
})();