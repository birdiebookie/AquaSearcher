/* AquaSearcher Phase 1 — final foundation layer.
   - recover the old crawl failure
   - filter/deduplicate low-value water
   - strengthen mapped access evidence
   - transparent scoring
   - final investigator map colors
*/
(function(){
'use strict';
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const FEET=5280;

function distFt(a,b){
 if(!a||!b)return Infinity;
 const R=3958.7613,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180;
 const dlat=(b.lat-a.lat)*Math.PI/180,dlng=(b.lng-a.lng)*Math.PI/180;
 const q=Math.sin(dlat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dlng/2)**2;
 return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q))*FEET;
}
function scoreReason(f){
 const r=[];
 if(f.isPinTest)r.push('Exact search-pin test area');
 if(f.accessType&&f.accessType!=='none')r.push((f.accessType||'access')+' nearby');
 if(Number.isFinite(f.accessDistance))r.push(Math.round(f.accessDistance*FEET)+' ft from mapped access');
 if(f.hist?.persistence>=2)r.push(f.hist.persistence+' repeated historical periods');
 else if(f.hist?.best>=48)r.push('historical visual change');
 if(f.veh?.best)r.push('vehicle-class detection');
 if(f.waterSuitability!=null)r.push('water suitability '+f.waterSuitability+'/100');
 return r.length?r:['screening evidence pending'];
}
function waterSuitability(f){
 const s0=65,type=String(f.ftype||'').toLowerCase(),name=String(f.name||'').toLowerCase();
 let s=s0;
 if(/stream|river|canal|ditch|drain|waterway/.test(type))s-=25;
 if(/canal|ditch|drain|fountain|pool|swimming|ornamental|decorative/.test(name+' '+type))s-=35;
 if(Number.isFinite(f.waterWidthFt)){if(f.waterWidthFt<25)s-=50;else if(f.waterWidthFt<40)s-=25;else if(f.waterWidthFt>=75)s+=15}
 if((f.access||0)>75)s+=10;
 if(f.nearPin)s+=5;
 return Math.max(0,Math.min(100,Math.round(s)));
}
function usableWater(f){
 if(!f||f.isPinTest)return true;
 const type=String(f.ftype||'').toLowerCase(),name=String(f.name||'').toLowerCase();
 if(/fountain|swimming pool|ornamental pond|decorative pond/.test(name))return false;
 if(/canal|ditch|drainageway/.test(name+' '+type)&&(f.access||0)<75)return false;
 if(Number.isFinite(f.waterWidthFt)&&f.waterWidthFt<25)return false;
 if(/streamriver|stream|canal/.test(type)&&Number.isFinite(f.waterWidthFt)&&f.waterWidthFt<40&&(f.access||0)<80)return false;
 return true;
}
function dedupeWater(arr){
 const kept=[];
 for(const f of arr){
  const dup=kept.find(k=>distFt(f,k)<=175&&((f.name&&k.name&&f.name===k.name)||String(f.ftype)===String(k.ftype)||f.nearPin||k.nearPin));
  if(!dup){kept.push(f);continue}
  const winner=(f.priority||0)>(dup.priority||0)?f:dup,loser=winner===f?dup:f;
  winner.groupedCount=(winner.groupedCount||1)+(loser.groupedCount||1);
  winner.groupedEvidence=winner.groupedEvidence||[];
  winner.groupedEvidence.push({name:loser.name,lat:loser.lat,lng:loser.lng});
  if((loser.access||0)>(winner.access||0)){winner.access=loser.access;winner.accessType=loser.accessType;winner.accessDistance=loser.accessDistance}
  if((loser.hist?.best||0)>(winner.hist?.best||0))winner.hist=loser.hist;
  if(loser.veh?.best&&!winner.veh?.best)winner.veh=loser.veh;
  if(winner!==dup){kept.splice(kept.indexOf(dup),1);kept.push(winner)}
 }
 return kept;
}
function dedupeAccess(arr){
 const kept=[];
 for(const f of arr||[]){
  const dup=kept.find(k=>distFt(f,k)<=125&&(f.type===k.type||f.sourceId===k.sourceId));
  if(!dup)kept.push(f);
  else{
   const winner=(f.access||0)>(dup.access||0)?f:dup;
   winner.groupedCount=(winner.groupedCount||1)+1;
  }
 }
 return kept;
}
function recalc(f){
 f.waterSuitability=waterSuitability(f);
 const access=Number(f.access)||0,hist=Number(f.hist?.best)||0,vehicle=f.veh?.best?Math.round((Number(f.veh.best.confidence)||0)*100):0;
 const pin=f.isPinTest?90:(f.nearPin?70:0);
 f.priority=Math.max(0,Math.min(100,Math.round(access*.40+hist*.30+vehicle*.15+f.waterSuitability*.10+pin*.05)));
 if(f.isPinTest)f.priority=Math.max(f.priority,70);
 f.label=f.priority>=80?'HIGH':f.priority>=55?'MEDIUM':'LOW';
 f.scoring={access:40,historical:30,object:15,waterSuitability:10,location:5,note:'Phase 1 screening score; access and historical evidence lead.'};
 f.scoreReasons=scoreReason(f);
 return f;
}
function decorateAll(){
 const arr=window.__aquaFindings||[];
 document.querySelectorAll('#cards .card').forEach(card=>{
  const text=card.textContent||'',f=arr.find(x=>x?.name&&text.includes(x.name));
  if(!f)return;
  const old=card.querySelector('.phase1-evidence');if(old)old.remove();
  const d=document.createElement('div');d.className='phase1-evidence small';
  d.style.cssText='margin-top:6px;padding-top:5px;border-top:1px solid #d7e2ea';
  d.innerHTML='<b>Why:</b> '+f.scoreReasons.slice(0,4).join(' · ')+(f.groupedCount>1?' · '+f.groupedCount+' nearby detections grouped':'')+
   '<br><b>Score:</b> Access '+(f.access??0)+'/100 · Historical '+(f.hist?.best??0)+'/100 · Object '+(f.objectScore??(f.veh?.best?Math.round((f.veh.best.confidence||0)*100):0))+'/100 · Water '+f.waterSuitability+'/100';
  card.appendChild(d);
 });
}
function renderAccessPhase1(list){
 const old=document.querySelector('[data-phase1-access]');if(old)old.remove();
 const host=$('cards');if(!host||!list?.length)return;
 const wrap=document.createElement('div');wrap.dataset.phase1Access='1';
 wrap.style.cssText='margin:10px 0 0;padding-top:8px;border-top:2px solid #b9ccd8';
 wrap.innerHTML='<div><b style="color:#0a4565">🚤 ACCESS POINTS — PHASE 1</b> <span class="small">('+list.length+')</span></div>';
 list.slice().sort((a,b)=>(b.access||0)-(a.access||0)).forEach(f=>{
  const d=document.createElement('div');d.className='card';
  d.innerHTML='<span class="pill">'+(f.type||'access')+'</span><b>'+String(f.name||'WATER ACCESS POINT')+'</b>'+
   '<div class="small">'+(f.source||'mapped source')+' · Access '+(f.access||0)+'/100'+(f.accessDistance!=null?' · '+Math.round(f.accessDistance*FEET)+' ft from candidate':'')+'</div>'+
   '<div class="phase1-evidence small"><b>Current mapped access evidence only.</b> '+scoreReason(f).slice(0,2).join(' · ')+'</div>';
  wrap.appendChild(d);
 });
 host.prepend(wrap);
}
function applyMapColors(){
 window.__phase1MapColors=true;
 if(typeof window.redraw==='function')window.redraw();
 // redraw is a lexical function in index.html, so call it indirectly through
 // the public helper when available; the flag is also honored by base mark().
}
function normalizeAccessList(list){
 return (list||[]).map(x=>{
  if(!x)return null;
  if(x.accessPoint){
   return {
    lat:+x.lat,lng:+x.lng,
    type:x.accessType||'access',
    source:x.source||'mapped source',
    sourceId:x.sourceId||null,
    name:String(x.name||'').replace(/^🚤\\s*/,'')||'WATER ACCESS POINT',
    access:Number(x.access)||0,
    boost:Number(x.access)||0,
    accessDistance:Number.isFinite(Number(x.waterDistance))?Number(x.waterDistance)/5280:null
   };
  }
  return x;
 }).filter(x=>x&&Number.isFinite(x.lat)&&Number.isFinite(x.lng));
}
function phase1Process(){
 const arr=window.__aquaFindings;
 if(!Array.isArray(arr)||!arr.length)return false;
 const pin=arr.find(x=>x?.isPinTest),mapped=arr.filter(x=>x&&!x.isPinTest&&!x.accessPoint);
 const filtered=mapped.filter(usableWater),grouped=dedupeWater(filtered);
 if(pin)grouped.unshift(pin);
 grouped.forEach(recalc);
 arr.splice(0,arr.length,...grouped);
 if(Array.isArray(window.aquaV16Access)){
  const access=dedupeAccess(normalizeAccessList(window.aquaV16Access));
  access.forEach(recalc);
  window.aquaV16Access=access;
 }
 grouped.sort((a,b)=>(b.priority||0)-(a.priority||0));
 if(typeof window.render==='function')window.render();
 applyMapColors();
 setTimeout(()=>{decorateAll();renderAccessPhase1(window.aquaV16Access||[]);applyMapColors()},80);
 const removed=mapped.length-filtered.length;
 if($('status'))$('status').textContent='Phase 1 complete — '+grouped.length+' water candidates after filtering/grouping'+(removed?' · '+removed+' low-utility water features removed':'')+'.';
 return true;
}
async function recoverOldFailure(){
 const status=String($('status')?.textContent||'');
 if(!/f is not defined/i.test(status))return false;
 try{
  const m=String($('loc')?.value||'').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if(!m||typeof window.getWater!=='function'||typeof window.makeFinding!=='function')return false;
  const p={lat:+m[1],lng:+m[2]},r=+$('radius')?.value||1;
  if($('status'))$('status').textContent='Phase 1 recovery: rerunning the failed search path…';
  const ws=await window.getWater(p,r),access=typeof window.getAccess==='function'?await window.getAccess(p,r):[];
  const aa=(access||[]).map(window.accPoint).filter(Boolean);
  window.aquaV16Access=aa;
  const fs=ws.map((w,i)=>window.makeFinding(w,i,aa)).filter(Boolean);
  fs.unshift({id:'phase1-pin-recovery',lat:p.lat,lng:p.lng,name:'Exact search-pin test area',ftype:'known-coordinate test',access:100,priority:70,isPinTest:true,nearPin:true});
  window.__aquaFindings=fs;
  if(typeof window.render==='function')window.render();
  phase1Process();
  return true;
 }catch(e){console.error('Phase 1 recovery failed',e);return false}
}
function install(){
 const start=$('start');if(!start||start.__phase1Installed)return;
 const old=start.onclick;if(typeof old!=='function')return;
 start.__phase1Installed=true;
 start.onclick=async function(ev){
  try{await old.call(this,ev)}catch(e){console.error('Phase 1 caught search error',e)}
  await sleep(250);await recoverOldFailure();phase1Process();
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