/* AquaSearcher V18 — historical-change coordinate targeting.
   When historical imagery identifies a localized change, vehicle/object screening
   follows the exact change coordinates instead of relying only on the water centroid.
*/
(function(){
'use strict';
const $=id=>document.getElementById(id);
const near=(a,b)=>{
  if(!a||!b)return Infinity;
  const R=3958.7613,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180;
  const dl=(b.lat-a.lat)*Math.PI/180,dg=(b.lng-a.lng)*Math.PI/180;
  const h=Math.sin(dl/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dg/2)**2;
  return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
};
function historicalTargetPoints(f){
  const out=[];
  const add=(lat,lng,why,score)=>{
    if(!Number.isFinite(+lat)||!Number.isFinite(+lng))return;
    const p={lat:+lat,lng:+lng,why,score:Number(score)||0};
    if(!out.some(x=>Math.abs(x.lat-p.lat)<.00001&&Math.abs(x.lng-p.lng)<.00001))out.push(p);
  };
  const ht=f?.hist?.heroTransition;
  if(ht){
    add(ht.lat,ht.lng,'exact historical transition',ht.heroScore||ht.score);
  }
  for(const c of (f?.hist?.comparisons||[]).slice().sort((a,b)=>(b.heroScore||0)-(a.heroScore||0))){
    if((c.localized||0)>=55 || (c.heroScore||0)>=65)add(c.lat,c.lng,'localized historical change',c.heroScore||c.score);
    if(out.length>=12)break;
  }
  if(f?.lat!=null)add(f.lat,f.lng,'water-feature center',0);
  return out;
}
function expand(p){
  const a=1/111320,z=1/(111320*Math.max(.2,Math.cos(p.lat*Math.PI/180))),o=[p];
  for(const m of [6,12,20,30,45])for(const [x,y] of [[1,0],[-1,0],[0,1],[0,-1],[.707,.707],[-.707,.707],[.707,-.707],[-.707,-.707]]){
    o.push({lat:p.lat+x*m*a,lng:p.lng+y*m*z,why:p.why,score:p.score});
  }
  return o;
}
function patchVehiclePoints(f){
  const original=window.v17Pts;
  if(typeof original!=='function'||original.__v18)return;
  const wrapped=function(ff){
    const base=original(ff)||[],hist=historicalTargetPoints(ff),all=[];
    for(const p of hist)all.push(...expand(p));
    for(const p of base)all.push(p);
    const unique=[];
    for(const p of all){
      if(!Number.isFinite(+p.lat)||!Number.isFinite(+p.lng))continue;
      if(!unique.some(q=>Math.abs(q.lat-p.lat)<.00001&&Math.abs(q.lng-p.lng)<.00001)){
        unique.push({lat:+p.lat,lng:+p.lng,why:p.why||'search point',score:p.score||0});
      }
      if(unique.length>=96)break;
    }
    return unique;
  };
  wrapped.__v18=true;
  window.v17Pts=wrapped;
}
function wrapVehicle(){
  const old=window.vehicleScan;
  if(typeof old!=='function'||old.__v18)return;
  const wrapped=async function(f,rs,silent){
    const hist=historicalTargetPoints(f);
    const strongHist=hist.filter(p=>p.score>=60);
    if(strongHist.length){
      f.v18HistoricalTargets=strongHist.slice(0,8).map(p=>({lat:p.lat,lng:p.lng,score:p.score,why:p.why}));
    }
    const out=await old.apply(this,arguments);
    if(f?.veh){
      f.veh.historicalTargetCount=hist.length;
      f.veh.historicalTargetPoints=hist.slice(0,12);
      f.veh.model=(f.veh.model||'')+' + exact historical-change targeting';
    }
    if(typeof window.aquaScoreFinding==='function')window.aquaScoreFinding(f);
    return out;
  };
  wrapped.__v18=true;
  window.vehicleScan=wrapped;
}
function rescanTop(){
  const arr=window.__aquaFindings||window.findings||[];
  return arr.filter(f=>!f?.isPinTest&&!f?.accessPoint).sort((a,b)=>{
    const ah=Number(a?.hist?.heroScore||a?.hist?.best||0),bh=Number(b?.hist?.heroScore||b?.hist?.best||0);
    return (bh-ah);
  }).slice(0,10);
}
async function install(){
  if(window.__aquaV18Installed)return;
  window.__aquaV18Installed=true;
  patchVehiclePoints();
  wrapVehicle();
  const logo=document.querySelector('.logo small');if(logo)logo.textContent='V18';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,1200));
else setTimeout(install,1200);
window.addEventListener('load',()=>setTimeout(install,1500));
})();
