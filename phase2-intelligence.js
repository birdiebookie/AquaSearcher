/* AquaSearcher Phase 2 — intelligence layer.
   IMPORTANT: this layer is additive. It reads Phase 1 results and enriches them;
   it does not replace Phase 1 filtering, historical evidence, or vehicle rules.
*/
(function(){
'use strict';

const P2={
  hydroBase:'https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/FeatureServer',
  bathyBase:'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/USGS_Inland_Bathymetry_Survey_Invent_v3Update/FeatureServer/0',
  cache:new Map(),
  running:false
};
const $=id=>document.getElementById(id);

function miles(a,b,c,d){
  const R=3958.7613,x=(b-d)*Math.PI/180,y=(a-c)*Math.PI/180;
  const q=Math.sin(y/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(x/2)**2;
  return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}
function clamp(v){return Math.max(0,Math.min(100,Math.round(Number(v)||0)))}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function cacheKey(kind,p,r){return kind+':'+p.lat.toFixed(4)+':'+p.lng.toFixed(4)+':'+r}
async function arcQuery(url,params){
  const qs=Object.entries(params).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
  const res=await fetch(url+'?'+qs,{signal:AbortSignal.timeout(18000),cache:'no-store'});
  if(!res.ok)throw Error('Phase 2 data service HTTP '+res.status);
  const j=await res.json();
  if(j.error)throw Error(j.error.message||'Phase 2 data service error');
  return j;
}
async function query3DHP(p,r){
  const key=cacheKey('3dhp',p,r),cached=P2.cache.get(key);
  if(cached)return cached;
  const meters=Math.round(r*1609.344),out=[];
  for(const layer of [60,50]){
    try{
      const j=await arcQuery(P2.hydroBase+'/'+layer,{
        where:'1=1',
        geometry:p.lng+','+p.lat,
        geometryType:'esriGeometryPoint',
        inSR:'4326',
        spatialRel:'esriSpatialRelIntersects',
        distance:meters,
        units:'esriSRUnit_Meter',
        outFields:'*',
        returnGeometry:'true',
        outSR:'4326',
        f:'json'
      });
      for(const f of j.features||[])out.push({...f,_p2Layer:layer});
    }catch(e){console.warn('Phase 2 3DHP layer failed',layer,e)}
  }
  P2.cache.set(key,out);
  return out;
}
async function queryBathymetry(p,r){
  const key=cacheKey('bathy',p,r),cached=P2.cache.get(key);
  if(cached)return cached;
  try{
    const meters=Math.round(Math.min(r,5)*1609.344);
    const j=await arcQuery(P2.bathyBase,{
      where:'1=1',
      geometry:p.lng+','+p.lat,
      geometryType:'esriGeometryPoint',
      inSR:'4326',
      spatialRel:'esriSpatialRelIntersects',
      distance:meters,
      units:'esriSRUnit_Meter',
      outFields:'*',
      returnGeometry:'true',
      outSR:'4326',
      f:'json'
    });
    const out=j.features||[];
    P2.cache.set(key,out);
    return out;
  }catch(e){
    console.warn('Phase 2 bathymetry inventory failed',e);
    P2.cache.set(key,[]);
    return[];
  }
}
function featurePoint(f){
  const g=f.geometry||{},p=g;
  if(p.x!=null&&p.y!=null)return{lat:+p.y,lng:+p.x};
  if(Array.isArray(g.rings)){
    let n=0,lat=0,lng=0;
    for(const ring of g.rings)for(const q of ring||[])if(Array.isArray(q)&&q.length>=2){lng+=+q[0];lat+=+q[1];n++}
    return n?{lat:lat/n,lng:lng/n}:null;
  }
  if(Array.isArray(g.paths)){
    const q=g.paths?.[0]?.[0];return q?{lat:+q[1],lng:+q[0]}:null;
  }
  return null;
}
function attrs(f){return f?.attributes||{}}
function hydroName(f){
  const a=attrs(f);
  return String(a.GNIS_NAME||a.GNIS_NAME||a.NAME||a.NHDPlusID||'').trim();
}
function hydroArea(f){
  const a=attrs(f);
  for(const k of ['AREASQKM','AREA_SQKM','AreaSqKm','AREA_KM2']){const n=num(a[k]);if(n!=null)return n}
  return null;
}
function hydroType(f){
  const a=attrs(f);
  const v=a.WB_TYPE||a.WATERBODY_TYPE||a.FEATURE||a.FTYPE||'';return String(v||(_isWaterbody(f)?'waterbody':'flowline')).toLowerCase();
}
function waterClass(f,h){
  const s=(String(f.name||'')+' '+hydroName(h)+' '+String(hydroType(h))).toLowerCase();
  if(/reservoir/.test(s))return'RESERVOIR';
  if(/lake/.test(s))return'LAKE';
  if(/pond/.test(s))return'POND';
  if(/river/.test(s))return'RIVER';
  if(/canal/.test(s))return'CANAL';
  if(/stream|creek|tributary/.test(s))return'STREAM';
  return h?(_isWaterbody(h)?'WATERBODY':'FLOWLINE'):'UNCLASSIFIED';
}
function _isWaterbody(h){return h?._p2Layer===60}
function nearestHydro(f,hydro){
  let best=null,bd=Infinity;
  for(const h of hydro||[]){
    const p=featurePoint(h);if(!p)continue;
    const d=miles(f.lat,f.lng,p.lat,p.lng);
    const sameName=f.name&&hydroName(h)&&String(f.name).toLowerCase()===hydroName(h).toLowerCase();
    const limit=sameName?.25:.08;
    if(d<=limit&&d<bd){bd=d;best=h}
  }
  return{best,distance:best?bd:null}
}
function nearestAccess(f,list){
  let best=null,bd=Infinity;
  for(const a of list||[]){
    const p=a.accessPoint?{lat:+a.lat,lng:+a.lng}:a;
    if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng))continue;
    const d=miles(f.lat,f.lng,p.lat,p.lng);
    if(d<bd){bd=d;best=a}
  }
  return{best,distance:best?bd:null}
}
function accessQuality(f,list){
  let best=null,bd=Infinity;
  for(const a of list||[]){
    const p=a.accessPoint?{lat:+a.lat,lng:+a.lng}:a;
    if(!p)continue;
    const d=miles(f.lat,f.lng,p.lat,p.lng);
    if(d<bd){bd=d;best=a}
  }
  if(!best)return{score:0,distance:null,type:'none',name:''};
  const t=String(best.accessType||best.type||'').toLowerCase();
  let s=45;
  if(/official boat ramp|official access|official dock/.test(t))s=96;
  else if(/boat ramp|launch|slipway/.test(t))s=88;
  else if(/dock|pier|marina/.test(t))s=78;
  else if(/road-end|road-shore/.test(t))s=72;
  else if(/water access|named/.test(t))s=68;
  const distPenalty=Math.min(35,Math.max(0,d*45));
  return{score:clamp(s-distPenalty),distance:d,type:t||'mapped',name:best.name||''};
}
function historicalQuality(f){
  const h=f.hist||{};
  const comparisons=Array.isArray(h.comparisons)?h.comparisons:[];
  const established=!!h.changeEstablished;
  const persistent=num(h.persistenceCount??h.persistence)||0;
  const best=clamp(h.best??f.historicalChange??0);
  let score=best*.55;
  if(established)score+=20;
  if(persistent>=3)score+=20;else if(persistent>=2)score+=10;
  return clamp(score);
}
function objectQuality(f){
  const v=f.vehicleEvidence||{},best=f.veh?.best;
  if(!best)return clamp((f.objectScore||0)*.7);
  let s=clamp((v.score||f.objectScore||0));
  if(best.sizeQualified)s+=15;
  if((v.temporalConsensus||f.veh?.historicalReleasesWithHits||0)>=2)s+=10;
  if(best.confidence>=.5)s+=8;
  return clamp(s);
}
function enrichFinding(f,hydro,bathy,access){
  const hm=nearestHydro(f,hydro),h=hm.best,aq=accessQuality(f,access);
  const area=h?hydroArea(h):num(f.waterAreaSqKm);
  const cls=waterClass(f,h);
  const width=num(f.waterWidthFt);
  let suitability=Number(f.waterSuitability||0);
  if(area!=null){if(area>=1)suitability+=12;else if(area>=.05)suitability+=6}
  if(width!=null&&width>=100)suitability+=8;
  if(['LAKE','RESERVOIR','RIVER'].includes(cls))suitability+=8;
  if(['STREAM','CANAL'].includes(cls)&&width!=null&&width<60)suitability-=12;
  suitability=clamp(suitability);
  const bathyMatches=(bathy||[]).filter(b=>{
    const p=featurePoint(b);return p?miles(f.lat,f.lng,p.lat,p.lng)<=Math.max(.08,(aq.distance||0)+.15):false;
  });
  const hist=historicalQuality(f),obj=objectQuality(f);
  const phase2Score=clamp(aq.score*.35+hist*.25+obj*.25+suitability*.10+(f.nearPin?5:0));
  f.phase2={
    waterClass:cls,
    waterAreaSqKm:area,
    waterSource:h?'USGS 3DHP':(f.source||'legacy/OSM'),
    hydroDistanceMi:hm.distance,
    suitability,
    accessScore:aq.score,
    accessDistanceMi:aq.distance,
    accessType:aq.type,
    accessName:aq.name,
    historicalScore:hist,
    historicalPersistence:Number(f.hist?.persistenceCount??f.hist?.persistence??0)||0,
    objectScore:obj,
    bathymetryAvailable:bathyMatches.length>0,
    bathymetryRecords:bathyMatches.length,
    phase2Score,
    status:'Phase 2 enrichment complete'
  };
  f.waterAreaSqKm=area;
  f.phase2Priority=phase2Score;
  f.phase2Reasons=[
    'Water: '+cls+(area!=null?' · '+area.toFixed(3)+' km²':''),
    'Access: '+aq.score+'/100'+(aq.distance!=null?' · '+aq.distance.toFixed(2)+' mi':''),
    'Historical: '+hist+'/100',
    'Object: '+obj+'/100'
  ];
  return f;
}
function ensureBar(){
  if($('phase2bar'))return;
  const host=document.querySelector('.findings h3');
  if(!host)return;
  const b=document.createElement('div');b.id='phase2bar';
  b.style.cssText='margin:7px 0 9px;padding:8px;background:#eef7fb;border:1px solid #c6dbe6;border-radius:8px;font-size:10px';
  b.innerHTML='<b>PHASE 2 INTELLIGENCE</b><div id="phase2status" style="margin-top:4px;color:#60717f">Waiting for Phase 1.</div><div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap"><button id="p2run" class="btn2" style="width:auto">Run Phase 2</button><button id="p2csv" class="btn2" style="width:auto">CSV</button><button id="p2kml" class="btn2" style="width:auto">KML</button></div>';
  host.parentElement.insertBefore(b,host.nextSibling);
  $('p2run').onclick=()=>runPhase2(true);
  $('p2csv').onclick=downloadCSV;
  $('p2kml').onclick=downloadKML;
}
function csvEscape(v){const s=String(v??'');return'"'+s.replace(/"/g,'""')+'"'}
function exportRows(){
  return (window.__aquaFindings||[]).filter(f=>!f.isPinTest&&!f.accessPoint).map((f,i)=>({
    rank:i+1,name:f.name,lat:f.lat,lng:f.lng,phase1Priority:f.priority,phase2Score:f.phase2Priority||0,
    waterClass:f.phase2?.waterClass||'',areaSqKm:f.phase2?.waterAreaSqKm??'',waterSuitability:f.phase2?.suitability??'',
    accessScore:f.phase2?.accessScore??f.access??0,accessType:f.phase2?.accessType||f.accessType||'',
    accessDistanceMi:f.phase2?.accessDistanceMi??f.accessDistance??'',historicalScore:f.phase2?.historicalScore??f.hist?.best??0,
    persistence:f.phase2?.historicalPersistence??f.hist?.persistenceCount??0,objectScore:f.phase2?.objectScore??f.objectScore??0,
    bathymetryAvailable:f.phase2?.bathymetryAvailable?'YES':'NO'
  }));
}
function download(name,type,data){
  const blob=new Blob([data],{type}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)
}
function downloadCSV(){
  const rows=exportRows();if(!rows.length){toast('No Phase 2 water candidates to export.');return}
  const cols=Object.keys(rows[0]),csv=[cols.map(csvEscape).join(',')].concat(rows.map(r=>cols.map(k=>csvEscape(r[k])).join(','))).join('\n');
  download('AquaSearcher-Phase2.csv','text/csv;charset=utf-8',csv);
}
function downloadKML(){
  const rows=exportRows();if(!rows.length){toast('No Phase 2 water candidates to export.');return}
  const placemarks=rows.map((r,i)=>'<Placemark><name>#'+(i+1)+' '+String(r.name).replace(/[<&>]/g,'')+'</name><description><![CDATA[Phase 2 '+r.phase2Score+'/100 · '+r.waterClass+' · Access '+r.accessScore+'/100 · Historical '+r.historicalScore+'/100 · Object '+r.objectScore+'/100 · Bathymetry '+r.bathymetryAvailable+']]></description><Point><coordinates>'+r.lng+','+r.lat+',0</coordinates></Point></Placemark>').join('');
  const kml='<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>AquaSearcher Phase 2</name>'+placemarks+'</Document></kml>';
  download('AquaSearcher-Phase2.kml','application/vnd.google-earth.kml+xml',kml);
}
function renderPhase2Evidence(){
  const arr=window.__aquaFindings||[];
  document.querySelectorAll('#cards .card').forEach(card=>{
    const id=card.dataset.findingId||card.dataset.id,f=arr.find(x=>x.id===id);if(!f?.phase2)return;
    let d=card.querySelector('.phase2-evidence');if(d)d.remove();
    d=document.createElement('div');d.className='phase2-evidence small';
    d.style.cssText='margin-top:6px;padding-top:5px;border-top:1px solid #d7e2ea';
    d.innerHTML='<b>Phase 2:</b> '+f.phase2Reasons.join(' · ')+' · <b>Score '+f.phase2.phase2Score+'/100</b>'+
      (f.phase2.bathymetryAvailable?' · 🗺 bathymetry coverage found':'');
    card.appendChild(d);
  });
}
async function runPhase2(manual){
  if(P2.running)return;
  const arr=window.__aquaFindings;
  const p=(typeof pin!=='undefined'&&pin?.getLatLng)?pin.getLatLng():null,r=+$('radius')?.value||1;
  if(!Array.isArray(arr)||!arr.length||!p){
    if(manual)toast('Run the Phase 1 search first.');
    return;
  }
  P2.running=true;ensureBar();
  if($('phase2status'))$('phase2status').textContent='Loading current USGS 3DHP hydrography and bathymetry inventory…';
  try{
    const [hydro,bathy]=await Promise.all([query3DHP(p,r),queryBathymetry(p,r)]);
    const access=window.aquaV16Access||[];
    const candidates=arr.filter(f=>!f.isPinTest&&!f.accessPoint);
    for(const f of candidates)enrichFinding(f,hydro,bathy,access);
    candidates.sort((a,b)=>(b.phase2Priority||0)-(a.phase2Priority||0));
    window.__aquaPhase2Findings=candidates;
    window.__aquaPhase2HydroCount=hydro.length;
    window.__aquaPhase2BathyCount=bathy.length;
    renderPhase2Evidence();
    if($('phase2status'))$('phase2status').textContent='Complete — '+candidates.length+' water candidates enriched · '+hydro.length+' 3DHP features · '+bathy.length+' bathymetry-inventory records. Phase 1 markers and filtering were preserved.';
    if($('status'))$('status').textContent+=' Phase 2 intelligence added.';
    toast('Phase 2 intelligence complete. Phase 1 results were preserved.');
  }catch(e){
    console.error('Phase 2 failed',e);
    if($('phase2status'))$('phase2status').textContent='Data services were unavailable; Phase 1 results were left unchanged.';
    if(manual)toast('Phase 2 could not finish, but Phase 1 was preserved.');
  }finally{P2.running=false}
}
function install(){
  ensureBar();
  const logo=document.querySelector('.logo small');if(logo)logo.textContent='PHASE 2';
  const header=document.querySelector('header');
  if(header&&!document.getElementById('phase2badge')){
    const b=document.createElement('span');b.id='phase2badge';b.textContent='Phase 2 intelligence layer ready';
    b.style.cssText='font-size:10px;color:#b9e7ff;margin-left:8px;opacity:.9';header.appendChild(b)
  }
  if(window.__aquaPhase2Auto)return;
  const start=$('start');
  if(!start||typeof start.onclick!=='function')return;
  window.__aquaPhase2Auto=true;
  const oldClick=start.onclick;
  start.onclick=async function(...args){
    const out=await oldClick.apply(this,args);
    await new Promise(r=>setTimeout(r,150));
    await runPhase2(false);
    return out;
  };
}
window.aquaPhase2={run:runPhase2,downloadCSV,downloadKML,version:'2.0'};
window.addEventListener('load',()=>setTimeout(install,2600));
setTimeout(install,3200);
})();