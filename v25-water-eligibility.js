/* AquaSearcher V25 — fail-closed water eligibility guard.
   Final safety layer for historical anomalies and vehicle detections.
   A candidate only contributes vehicle/anomaly evidence when its coordinate is
   inside a mapped water AREA. Missing/failed map verification is UNKNOWN, not water.
*/
(function(){
'use strict';
const cache=new Map();
const endpoints=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
const waterTags=t=>{
  if(!t)return false;
  const natural=String(t.natural||'').toLowerCase(),water=String(t.water||'').toLowerCase();
  const landuse=String(t.landuse||'').toLowerCase(),waterway=String(t.waterway||'').toLowerCase();
  return natural==='water'||landuse==='reservoir'||
    ['lake','pond','reservoir','lagoon','basin','oxbow'].includes(water)||waterway==='riverbank';
};
async function isMappedWater(lat,lng){
  lat=Number(lat);lng=Number(lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return false;
  const key=lat.toFixed(5)+','+lng.toFixed(5);
  if(cache.has(key))return cache.get(key);
  let result=false,answered=false;
  const q='[out:json][timeout:12];is_in('+lat+','+lng+');out tags;';
  for(const endpoint of endpoints){
    try{
      const r=await fetch(endpoint+'?data='+encodeURIComponent(q),{method:'GET',cache:'no-store',signal:AbortSignal.timeout(14000)});
      if(!r.ok)continue;
      const j=await r.json();
      if(j&&Array.isArray(j.elements)){answered=true;result=j.elements.some(e=>e.type==='area'&&waterTags(e.tags));break}
    }catch(e){}
  }
  const verified=answered&&result;
  cache.set(key,verified);
  return verified;
}
async function guardHistorical(f){
  const h=f&&f.hist;
  if(!h)return f;
  if(h.heroTransition&&Number.isFinite(+h.heroTransition.lat)&&Number.isFinite(+(h.heroTransition.lng))){
    if(!await isMappedWater(h.heroTransition.lat,h.heroTransition.lng))h.heroTransition=null;
  }
  if(!Array.isArray(h.comparisons)||!h.comparisons.length){
    // An aggregate change score without a verified, water-located coordinate
    // cannot be used as underwater anomaly evidence.
    if(!h.heroTransition){
      h.best=0;h.heroScore=0;h.changeConfidence=0;h.changeEstablished=false;
      h.waterEligibility='No coordinate-level anomaly verified inside mapped water; anomaly evidence excluded.';
      f.historicalChange=0;f.changeScore=0;f.anomaly=0;
    }
    return f;
  }
  const verified=[];
  for(const c of h.comparisons){
    const lat=Number(c.lat),lng=Number(c.lng??c.lon);
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&await isMappedWater(lat,lng))verified.push(c);
  }
  h.comparisons=verified;
  if(!verified.length){
    h.best=0;h.heroScore=0;h.changeConfidence=0;h.changeEstablished=false;
    h.waterEligibility='No historical anomaly coordinate verified inside mapped water; anomaly evidence excluded.';
    f.historicalChange=0;f.changeScore=0;f.anomaly=0;
  }else{
    h.best=Math.max(0,...verified.map(c=>Number(c.score)||0));
    h.heroScore=Math.max(0,...verified.map(c=>Number(c.heroScore)||0));
    h.changeConfidence=Math.max(0,...verified.map(c=>Number(c.localized)||0));
    h.waterEligibility='Historical anomaly coordinates verified inside mapped water.';
    f.historicalChange=h.heroScore||h.best;f.changeScore=f.historicalChange;
  }
  return f;
}
async function guardVehicle(f){
  if(!f||!f.veh||!Array.isArray(f.veh.hits))return f;
  const verified=[];
  for(const hit of f.veh.hits){
    const lat=Number(hit.lat),lng=Number(hit.lng??hit.lon);
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&await isMappedWater(lat,lng))verified.push(hit);
  }
  f.veh.hits=verified;
  const strong=verified.filter(h=>h.sizeQualified||(h.visualAnomaly&&Number(h.confidence)>=.55));
  const years=new Set(strong.map(h=>String(h.year||''))).size;
  f.veh.best=strong.slice().sort((a,b)=>(Number(b.confidence)||0)-(Number(a.confidence)||0))[0]||null;
  f.veh.historicalReleasesWithHits=years;
  f.veh.visualAnomalies=verified.filter(h=>h.visualAnomaly).length;
  f.veh.visualYears=new Set(verified.filter(h=>h.visualAnomaly).map(h=>String(h.year||''))).size;
  const best=f.veh.best;
  const score=best?Math.min(100,Math.round(Math.min(1,years/3)*55+Math.min(1,(Number(best.confidence)||0)/.7)*45)):0;
  f.objectScore=score;
  f.vehicleEvidence=f.vehicleEvidence||{};
  f.vehicleEvidence.score=score;f.vehicleEvidence.temporalConsensus=years;
  f.vehicleEvidence.waterVerified=!!best;
  f.vehicleEvidence.status=best?'Vehicle/object evidence retained only after mapped-water verification.':'No detections passed mapped-water verification; land/unknown detections excluded.';
  if(!f.isPinTest&&typeof window.aquaScoreFinding==='function')window.aquaScoreFinding(f);
  return f;
}
function refresh(){if(typeof window.render==='function')window.render();if(typeof window.redraw==='function')window.redraw()}
let installChecks=0;
function install(){
  // Some legacy layers install/wrap themselves several seconds after page load.
  // Re-assert this final guard during startup so a late V18/V22 wrapper cannot bypass it.
  const oldVehicle=window.vehicleScan,oldHist=window.histScan;
  if(typeof oldVehicle==='function'&&!oldVehicle.__v25){
    const wrapped=async function(f,...args){
      // Remove unverified historical target coordinates BEFORE the detector scans them.
      try{await guardHistorical(f)}catch(e){
        if(f?.hist){f.hist.comparisons=[];f.hist.heroTransition=null;f.hist.best=0;f.hist.heroScore=0;f.hist.changeEstablished=false}
      }
      await oldVehicle.apply(this,[f,...args]);
      try{await guardVehicle(f)}catch(e){
        if(f?.veh){f.veh.hits=[];f.veh.best=null;f.objectScore=0}
        f.vehicleEvidence={...(f.vehicleEvidence||{}),score:0,waterVerified:false,status:'Water verification failed; detections excluded.'};
      }
      refresh();return f?.veh?.best||null;
    };
    wrapped.__v25=true;window.vehicleScan=wrapped;
  }
  if(typeof oldHist==='function'&&!oldHist.__v25){
    const wrapped=async function(f,...args){
      const result=await oldHist.apply(this,[f,...args]);
      try{await guardHistorical(f)}catch(e){
        if(f?.hist){f.hist.best=0;f.hist.heroScore=0;f.hist.changeEstablished=false;f.hist.waterEligibility='Water verification failed; anomaly excluded.'}
        if(f){f.historicalChange=0;f.changeScore=0;f.anomaly=0}
      }
      if(f&&!f.isPinTest&&typeof window.aquaScoreFinding==='function')window.aquaScoreFinding(f);
      refresh();return result;
    };
    wrapped.__v25=true;window.histScan=wrapped;
  }
  window.aquaIsMappedWater=isMappedWater;
  window.aquaWaterEligibilityVersion='V25 fail-closed mapped-water gate';
  const logo=document.querySelector('.logo small');if(logo)logo.textContent='V25';
  const guarded=typeof window.vehicleScan==='function'&&window.vehicleScan.__v25&&
    typeof window.histScan==='function'&&window.histScan.__v25;
  window.__aquaV25Installed=!!guarded;
  installChecks++;
  if(installChecks<24)setTimeout(install,500);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
else install();
window.addEventListener('load',install);
setTimeout(install,1200);
})();