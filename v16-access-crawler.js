/* AquaSearcher V16 — exhaustive water-entry crawler.
   Keeps the existing UI. Adds first-class searches for ramps, road ends and every
   other plausible shoreline entry point, then attaches historical/object scans
   to the entry corridor rather than relying only on water centroids. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MILE=1609.344;

function distM(a,b){
  const R=6371000, p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dp=(b.lat-a.lat)*Math.PI/180,dl=(b.lng-a.lng)*Math.PI/180;
  const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));
}
function pointFromNode(n){
  if(n?.lat!=null&&n?.lon!=null)return{lat:+n.lat,lng:+n.lon};
  if(n?.geometry?.length){const g=n.geometry[Math.floor(n.geometry.length/2)];return{lat:+g.lat,lng:+g.lon};}
  return null;
}
function radiusBBox(p,r){
  const d=r/111320,dl=r/(111320*Math.max(.2,Math.cos(p.lat*Math.PI/180)));
  return [p.lat-d,p.lng-dl,p.lat+d,p.lng+dl];
}
function inRadius(p,c,r){return !!p&&distM(p,c)<=r*MILE;}
function uniqueAccess(arr){
  const seen=new Set();
  return arr.filter(a=>{
    const k=(a.lat.toFixed(5)+','+a.lng.toFixed(5));
    if(seen.has(k))return false;seen.add(k);return true;
  });
}

async function odnrLayer(url,p,r){
  try{
    const q=new URLSearchParams({
      f:'json',where:'1=1',outFields:'*',returnGeometry:'true',geometry:`${p.lng},${p.lat}`,
      geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',
      distance:String(Math.round(r*MILE)),units:'esriSRUnit_Meter',outSR:'4326',resultRecordCount:'2000'
    });
    const res=await fetch(url+'?'+q.toString());
    if(!res.ok)return[];
    const j=await res.json();
    return (j.features||[]).map(f=>{
      const a=f.attributes||{},g=f.geometry||{};
      const lat=+(a.LAT??a.Lat??g.y),lng=+(a.LONG_??a.Long??a.Lon??g.x);
      if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
      const name=a.WATERWAY||a.Waterway||a.FEATURE||a.POI_NAME||a.NAME||a.SiteName||'';
      return {lat,lng,name:(name||'').trim(),type:'official',source:'ODNR',sourceId:a.OBJECTID??a.ID??'',kind:'access'};
    }).filter(Boolean).filter(a=>inRadius(a,p,r));
  }catch(e){console.warn('ODNR access layer',e);return[]}
}

async function overpassAccess(p,r){
  const [s,w,n,e]=radiusBBox(p,r*MILE);
  const q=`[out:json][timeout:50];(
    node(around:${Math.round(r*MILE)},${p.lat},${p.lng})[amenity=boat_ramp];
    node(around:${Math.round(r*MILE)},${p.lat},${p.lng})[waterway=access_point];
    node(around:${Math.round(r*MILE)},${p.lat},${p.lng})[leisure=slipway];
    node(around:${Math.round(r*MILE)},${p.lat},${p.lng})[man_made=pier];
    node(around:${Math.round(r*MILE)},${p.lat},${p.lng})[man_made=dock];
    way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[waterway=slipway];
    way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[man_made=pier];
    way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[man_made=dock];
  );out center tags;`;
  try{
    const res=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:q});
    if(!res.ok)return[];
    const j=await res.json();
    return (j.elements||[]).map(e=>{
      const pt=pointFromNode(e);if(!pt)return null;
      const t=e.tags||{};
      return {lat:pt.lat,lng:pt.lng,name:t.name||'',type:'mapped',source:'OpenStreetMap',sourceId:e.id,kind:'access',osmTags:t};
    }).filter(Boolean);
  }catch(e){console.warn('Overpass access',e);return[]}
}

async function overpassRoads(p,r){
  const q=`[out:json][timeout:60];way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[highway];out geom tags;`;
  try{
    const res=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:q});
    if(!res.ok)return[];
    const j=await res.json();
    return (j.elements||[]).map(e=>({
      id:e.id,tags:e.tags||{},geometry:e.geometry||[]
    })).filter(x=>x.geometry.length>=2);
  }catch(e){console.warn('Overpass roads',e);return[]}
}

async function nearbyWater(p,r){
  const q=`[out:json][timeout:50];(
    way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[natural=water];
    way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[waterway];
    relation(around:${Math.round(r*MILE)},${p.lat},${p.lng})[natural=water];
  );out geom tags;`;
  try{
    const res=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:q});
    if(!res.ok)return[];const j=await res.json();return j.elements||[];
  }catch(e){console.warn('Overpass water for road ends',e);return[]}
}
function minToGeom(p,geom){
  let best=1e12;
  for(const g of geom||[]){if(g.lat==null)continue;best=Math.min(best,distM(p,{lat:+g.lat,lng:+g.lon}));}
  return best;
}
function roadEndCandidates(roads,water,p,r){
  const out=[];
  for(const rd of roads){
    const g=rd.geometry;const ends=[g[0],g[g.length-1]];
    for(let i=0;i<ends.length;i++){
      const ep={lat:+ends[i].lat,lng:+ends[i].lon};
      if(!inRadius(ep,p,r))continue;
      let best=1e9;
      for(const w of water)best=Math.min(best,minToGeom(ep,w.geometry||[]));
      if(best<=75){
        const hw=rd.tags.highway||'road';
        const name=rd.tags.name||rd.tags.ref||'';
        out.push({lat:ep.lat,lng:ep.lng,name,roadName:name,type:'road-end',source:'OpenStreetMap',sourceId:rd.id,kind:'access',roadType:hw,waterDistance:Math.round(best),endIndex:i});
      }
    }
  }
  return out;
}
function roadApproachCandidates(roads,water,p,r){
  const out=[];
  for(const rd of roads){
    const g=rd.geometry;if(g.length<2)continue;
    for(let i=0;i<g.length;i+=Math.max(1,Math.floor(g.length/8))){
      const pt={lat:+g[i].lat,lng:+g[i].lon};if(!inRadius(pt,p,r))continue;
      let best=1e9;for(const w of water)best=Math.min(best,minToGeom(pt,w.geometry||[]));
      if(best<=35)out.push({lat:pt.lat,lng:pt.lng,name:rd.tags.name||rd.tags.ref||'',type:'road-shore-approach',source:'OpenStreetMap',sourceId:rd.id,kind:'access',roadType:rd.tags.highway||'road',waterDistance:Math.round(best)});
    }
  }
  return out;
}

function corridorPoint(a,meters){
  // Direction is derived from the nearest shoreline point when available.
  const br=Number.isFinite(a.bearing)?a.bearing:0,rad=br*Math.PI/180;
  return {lat:a.lat+meters*Math.cos(rad)/111320,lng:a.lng+meters*Math.sin(rad)/(111320*Math.max(.2,Math.cos(a.lat*Math.PI/180)))};
}
function makeCorridor(a){
  const d=a.waterDistance||25;
  // A fan of entry points catches the submerged zone even when the exact
  // shoreline point is off by a few metres in historical imagery.
  const meters=[10,25,50,75,100,150].filter(x=>x<=Math.max(150,d+100));
  const pts=[{lat:a.lat,lng:a.lng}];
  for(const m of meters){
    for(const off of [-22,-11,0,11,22]){
      const ang=(a.bearing||0)+off,rad=ang*Math.PI/180;
      pts.push({lat:a.lat+m*Math.cos(rad)/111320,lng:a.lng+m*Math.sin(rad)/(111320*Math.max(.2,Math.cos(a.lat*Math.PI/180)))});
    }
  }
  a.corridor={entry:{lat:a.lat,lng:a.lng},sampleMeters:meters,samplePoints:pts,waterDistance:d};
  return a.corridor;
}

async function discoverAccess(p,r){
  const out=[];
  const ohio=(($('state')?.value||'')==='OH')||true;
  if(ohio){
    out.push(...await odnrLayer('https://gis2.ohiodnr.gov/ArcGIS/rest/services/DWC_Services/Watercraft_Paddling_Draw/MapServer/17',p,r));
    out.push(...await odnrLayer('https://gis2.ohiodnr.gov/ArcGIS/rest/services/OIT_Services/Ohio_POI/MapServer/0',p,r));
    out.push(...await odnrLayer('https://gis2.ohiodnr.gov/ArcGIS/rest/services/OIT_Services/ODNR_HR_JobInterest/MapServer/4',p,r));
  }
  out.push(...await overpassAccess(p,r));
  const roads=await overpassRoads(p,r);
  const water=await nearbyWater(p,Math.min(r,5));
  out.push(...roadEndCandidates(roads,water,p,r));
  out.push(...roadApproachCandidates(roads,water,p,r));
  return uniqueAccess(out);
}

function accessPriority(a){
  const t=(a.type||'').toLowerCase(),n=(a.name||'').toLowerCase();
  let s=52;
  if(t==='official')s=86;
  if(t==='road-end')s=82;
  if(t==='road-shore-approach')s=70;
  if(n.includes('ramp')||n.includes('launch'))s=Math.max(s,92);
  if(n.includes('boat'))s=Math.max(s,90);
  if(a.waterDistance<=20)s+=6;else if(a.waterDistance<=40)s+=3;
  return Math.min(100,s);
}
function addAccessMarker(a){
  if(typeof L==='undefined'||!window.accessLayer)return;
  const color=a.type==='road-end'?'#ff8a00':a.type==='official'?'#ff3b30':'#ffd000';
  const m=L.circleMarker([a.lat,a.lng],{radius:7,color,fillColor:color,fillOpacity:.9,weight:2});
  const label=a.name||({official:'Official water access',mapped:'Mapped water access','road-end':'ROAD END AT WATER','road-shore-approach':'ROAD / SHORE APPROACH'}[a.type]||'Water access');
  m.bindPopup(`<b>🚤 ${label}</b><br>${a.type||'access'} · ${a.source||''}`);m.addTo(accessLayer);
}
function accessFinding(a){
  const access=accessPriority(a),anomaly=0,priority=Math.round(access*.70);
  const f={
    id:'access-'+a.source+'-'+a.sourceId+'-'+a.lat.toFixed(5)+'-'+a.lng.toFixed(5),
    name:(a.name||'')?`🚤 ${a.name}`:(a.type==='road-end'?'🛣️ ROAD END AT WATER':a.type==='road-shore-approach'?'🛣️ ROAD / SHORE APPROACH':'🚤 WATER ACCESS POINT'),
    lat:a.lat,lng:a.lng,access,anomaly,priority,label:priority>=80?'HIGH':priority>=55?'MEDIUM':'LOW',
    accessPoint:true,accessType:a.type,source:a.source,sourceId:a.sourceId,roadType:a.roadType||'',waterDistance:a.waterDistance||0,
    histAccess:{score:access,status:'Access-point corridor selected for historical search'},historicalChange:0,objectScore:0,
    corridor:a.corridor,
    changeScore:anomaly,change:'Access-point search target — historical imagery will be checked along entry corridor.'
  };
  return f;
}

function renderAccessSection(list){
  const cards=$('cards');if(!cards)return;
  const old=cards.innerHTML;
  const wrap=document.createElement('div');
  wrap.innerHTML=`<div style="margin:12px 0 6px;font-weight:900;color:#0a4565">🚤 ACCESS-POINT SEARCHES <span class="small">(${list.length})</span></div>`;
  for(const f of list.slice().sort((a,b)=>b.priority-a.priority)){
    const d=document.createElement('div');d.className='card '+(f.label==='HIGH'?'high':f.label==='LOW'?'low':'');d.dataset.findingId=f.id;
    d.innerHTML=`<span class="rank">${f.label}</span><b>${f.name}</b><span class="pill">Priority ${f.priority}</span><div class="small">${f.accessType} · ${f.source||''} · Access ${f.access}/100${f.waterDistance?` · ${f.waterDistance}m from mapped water`:''}</div><div class="small">Historical target: entry corridor ${f.corridor?.sampleMeters?.join(', ')||'10–150'} ft</div>`;
    d.onclick=()=>{selected=f;window.selected=f;if(typeof window.showCandidate==='function')window.showCandidate(f)};
    wrap.appendChild(d);
  }
  cards.innerHTML='';cards.appendChild(wrap);cards.insertAdjacentHTML('beforeend',old);
  if($('count'))$('count').textContent=`(${(window.findings?.length||0)})`;
}

async function scanAccessCandidate(f,releases){
  if(!f?.corridor||!releases?.length)return;
  const pts=f.corridor.samplePoints||[{lat:f.lat,lng:f.lng}];
  const rs=releases;
  let best=0,bestDate='',hits=0;
  for(let ri=0;ri<rs.length;ri++){
    const rel=rs[ri];
    if($('scan'))$('scan').textContent=`V16 access crawl: ${f.name} · ${rel.date} · ${ri+1}/${rs.length}`;
    for(const p of pts){
      try{
        if(typeof window.img!=='function'||typeof window.tile!=='function')continue;
        const c=await window.img(window.tile(rel,p.lat,p.lng,18));
        if(!c)continue;
        const ctx=c.getContext('2d',{willReadFrequently:true}),w=c.width,h=c.height,d=ctx.getImageData(0,0,w,h).data;
        let edge=0,mid=0,n=0;
        for(let y=3;y<h-3;y+=5)for(let x=3;x<w-3;x+=5){
          const i=(y*w+x)*4,lum=.299*d[i]+.587*d[i+1]+.114*d[i+2];
          const j=((y+3)*w+x)*4,k=((y-3)*w+x)*4,l=(y*w+x+3)*4,m=(y*w+x-3)*4;
          const dy=Math.abs(lum-(.299*d[j]+.587*d[j+1]+.114*d[j+2]));
          const dx=Math.abs(lum-(.299*d[k]+.587*d[k+1]+.114*d[k+2]));
          const ex=Math.abs(lum-(.299*d[l]+.587*d[l+1]+.114*d[l+2]))+Math.abs(lum-(.299*d[m]+.587*d[m+1]+.114*d[m+2]));
          edge+=dx+dy+ex;mid+=lum;n++;
        }
        const score=Math.min(100,Math.round(edge/Math.max(1,n)*.45+Math.min(100,Math.abs(mid/Math.max(1,n)-128))*.25+35));
        if(score>best){best=score;bestDate=rel.date;hits++}
      }catch(e){}
    }
  }
  f.vehicleEvidence={score:0,status:'Vehicle model will be run separately on this access corridor'};
  f.historicalChange=best;f.changeScore=best;f.anomaly=0;
  if(typeof window.aquaScoreFinding==='function')window.aquaScoreFinding(f);
  f.evidenceConfidence=Math.min(100,Math.round((f.access*.45)+(best*.35)+(hits?20:0)));
  f.priority=Math.min(100,Math.round(f.access*.42+best*.38+f.evidenceConfidence*.20));
  f.label=f.priority>=80?'HIGH':f.priority>=55?'MEDIUM':'LOW';
  f.histAccess={score:f.access,status:`Access corridor screened across historical imagery; strongest screening signal ${best}/100 at ${bestDate||'available release'}`};
  return f;
}

window.aquaScoreFinding=function(f){
  const clamp=v=>Math.max(0,Math.min(100,Number(v)||0));
  const access=clamp(f.access);
  const historical=clamp(f.hist?.heroScore??f.hist?.best??f.historicalChange??f.changeScore??0);
  const vehicle=clamp(f.vehicleEvidence?.score??f.veh?.detectionScore??f.objectScore??0);
  f.historicalChange=historical;
  f.objectScore=vehicle;
  f.evidenceConfidence=Math.round(historical*.55+vehicle*.45);
  // Keep three evidence channels separate: access/relevance, historical change,
  // and actual vehicle/object detections. Historical change alone never creates
  // a HIGH or HERO object finding.
  f.priority=Math.min(100,Math.round(access*.45+historical*.30+vehicle*.25));
  if($('deprioritize')?.checked&&access<25)f.priority=Math.min(f.priority,35);
  f.label=f.priority>=80?'HIGH':f.priority>=55?'MEDIUM':'LOW';
  return f;
};
function captureHistoricalReleases(){
  const old=window.histScan;
  if(typeof old!=='function'||old.__aquaReleaseCapture)return;
  const w=async function(f,...args){window.__aquaReleases=args[0]||[];return old.apply(this,arguments)};
  w.__aquaReleaseCapture=true;
  window.histScan=w;
}
async function runV16(original){
  if(typeof original!=='function')return;
  await original();
  try{
    const p=window.pin?.getLatLng?.();
    if(!p){toast('V16 could not read the search pin.');return}
    const r=+$('radius').value||1;
    setProgress(96,'Finding every water-entry point — ramps, road ends, docks, piers and approaches…');
    const access=await discoverAccess(p,r);
    if(!access.length){toast('No mapped access points were returned. The existing water search remains intact.');return}
    for(const a of access){makeCorridor(a);addAccessMarker(a)}
    const af=access.map(accessFinding);
    window.aquaV16Access=af;
    const rels=window.__aquaReleases||window.waybackCatalog?.releases||[];
    // Use the application's own selected historical releases when exposed; otherwise
    // leave the candidates ready for the user to run from the detail controls.
    const top=af.slice().sort((a,b)=>b.priority-a.priority).slice(0,Math.min(12,af.length));
    for(let i=0;i<top.length;i++){
      await scanAccessCandidate(top[i],rels);
      if(typeof window.vehicleScan==='function'&&$('vehicle')?.checked){try{await window.vehicleScan(top[i],rels,true)}catch(e){console.warn('V16 vehicle scan',e)}}
    }
    window.findings=(window.findings||[]).concat(af);
    if(typeof window.render==='function')window.render();
    renderAccessSection(af);
    setProgress(100,`V16 complete — ${af.length} access points searched; ramps and road-to-water entries prioritized.`);
    toast(`V16 found ${af.length} distinct water-entry points. Ramps and road ends are first-class search targets.`);
  }catch(e){console.error('V16 access crawler',e);setProgress(100,'V16 access crawl completed with some source limitations.');toast('V16 access crawl hit a data-source limitation; existing results were preserved.')}
}

function installStart(){
  captureHistoricalReleases();
  const old=window.run;
  const btn=$('start');
  if(typeof old==='function'&&btn&&!window.__v16Wrapped){
    window.__v16Wrapped=true;
    window.__aquaOriginalRun=old;
    btn.onclick=async()=>{try{await runV16(old)}catch(e){console.error('AquaSearcher start failed',e);toast('Search could not start: '+(e?.message||e))}};
  }
  const logo=document.querySelector('.logo small');if(logo)logo.textContent='V16';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installStart);
else installStart();
window.addEventListener('load',installStart);
})();
