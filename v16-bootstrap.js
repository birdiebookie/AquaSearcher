/* AquaSearcher V16 bootstrap.
   This is the integration layer: the access crawler is run as part of the
   real START button flow, not as a second decorative scan.
   V16.3: make coordinate entry tolerant of harmless trailing punctuation. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const MILE=1609.344;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let accessResults=[];
function distM(a,b){const R=6371000,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dp=(b.lat-a.lat)*Math.PI/180,dl=(b.lng-a.lng)*Math.PI/180,x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(x)))}
function inRadius(p,c,r){return p&&distM(p,c)<=r*MILE}
function point(e){if(e.lat!=null&&e.lon!=null)return{lat:+e.lat,lng:+e.lon};if(e.geometry?.length){const g=e.geometry[Math.floor(e.geometry.length/2)];return{lat:+g.lat,lng:+g.lon}}if(e.geometry?.x!=null)return{lat:+e.geometry.y,lng:+e.geometry.x};return null}
async function odnr(url,p,r){try{const q=new URLSearchParams({f:'json',where:'1=1',outFields:'*',returnGeometry:'true',geometry:`${p.lng},${p.lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:String(Math.round(r*MILE)),units:'esriSRUnit_Meter',outSR:'4326',resultRecordCount:'2000'}),j=await fetch(url+'?'+q).then(x=>x.ok?x.json():{features:[]});return(j.features||[]).map(f=>{const a=f.attributes||{},g=f.geometry||{},pt={lat:+(a.LAT??a.Lat??g.y),lng:+(a.LONG_??a.Lon??a.Long??g.x)};if(!Number.isFinite(pt.lat)||!Number.isFinite(pt.lng))return null;const name=(a.LAUNCHRAMP||a.WATERWAY||a.FEATURE||a.POI_NAME||a.NAME||a.SiteName||'').trim();return{...pt,name,type:'official',source:'ODNR',sourceId:a.OBJECTID??a.ID??'',waterDistance:0}}).filter(x=>x&&inRadius(x,p,r))}catch(e){console.warn('ODNR access',e);return[]}}
async function overpass(q){try{const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:q});return r.ok?await r.json():{elements:[]}}catch(e){console.warn('Overpass',e);return{elements:[]}}}
async function mappedAccess(p,r){const q=`[out:json][timeout:50];(node(around:${Math.round(r*MILE)},${p.lat},${p.lng})[amenity=boat_ramp];node(around:${Math.round(r*MILE)},${p.lat},${p.lng})[waterway=access_point];node(around:${Math.round(r*MILE)},${p.lat},${p.lng})[leisure=slipway];node(around:${Math.round(r*MILE)},${p.lat},${p.lng})[man_made=pier];node(around:${Math.round(r*MILE)},${p.lat},${p.lng})[man_made=dock];way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[waterway=slipway];way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[man_made=pier];way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[man_made=dock];);out center tags;`;const j=await overpass(q);return(j.elements||[]).map(e=>{const pt=point(e);if(!pt)return null;const t=e.tags||{};return{...pt,name:t.name||'',type:'mapped',source:'OpenStreetMap',sourceId:e.id,waterDistance:0}}).filter(Boolean)}
async function roads(p,r){const q=`[out:json][timeout:60];way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[highway];out geom tags;`;const j=await overpass(q);return(j.elements||[]).filter(e=>e.geometry?.length>=2)}
async function water(p,r){const q=`[out:json][timeout:50];(way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[natural=water];way(around:${Math.round(r*MILE)},${p.lat},${p.lng})[waterway];);out geom tags;`;const j=await overpass(q);return j.elements||[]}
function nearestWater(pt,ws){let best=1e9;for(const w of ws)for(const g of w.geometry||[])if(g.lat!=null)best=Math.min(best,distM(pt,{lat:+g.lat,lng:+g.lon}));return best}
async function accessDiscover(p,r){
  const out=[];
  if(($('state')?.value||'')==='OH'){
    out.push(...await odnr('https://gis2.ohiodnr.gov/ArcGIS/rest/services/DWC_Services/Watercraft_Paddling_Draw/MapServer/17',p,r));
    out.push(...await odnr('https://gis2.ohiodnr.gov/ArcGIS/rest/services/OIT_Services/Ohio_POI/MapServer/0',p,r));
  }
  out.push(...await mappedAccess(p,r));
  const rr=Math.min(r,5),rs=await roads(p,rr),ws=await water(p,rr);
  for(const rd of rs){
    const geom=rd.geometry||[];
    for(const ep of [geom[0],geom[geom.length-1]]){
      if(!ep)continue;const q={lat:+ep.lat,lng:+ep.lon};if(!inRadius(q,p,r))continue;
      const d=nearestWater(q,ws);
      if(d<=75)out.push({...q,name:rd.tags?.name||rd.tags?.ref||'',type:'road-end',source:'OpenStreetMap',sourceId:rd.id,roadType:rd.tags?.highway||'road',waterDistance:Math.round(d),connectivity:'road terminates near mapped water'});
    }
    if(geom.length>=3)for(let i=1;i<geom.length-1;i++){
      const g=geom[i],q={lat:+g.lat,lng:+g.lon};if(!inRadius(q,p,r))continue;
      const d=nearestWater(q,ws),before=nearestWater({lat:+geom[i-1].lat,lng:+geom[i-1].lon},ws),after=nearestWater({lat:+geom[i+1].lat,lng:+geom[i+1].lon},ws);
      if(d<=25&&(before-d>=5||after-d>=5))out.push({...q,name:rd.tags?.name||rd.tags?.ref||'',type:'road-shore-approach',source:'OpenStreetMap',sourceId:rd.id,roadType:rd.tags?.highway||'road',waterDistance:Math.round(d),connectivity:'road segment approaches mapped water'});
    }
  }
  const seen=new Set();return out.filter(a=>{const k=a.lat.toFixed(5)+','+a.lng.toFixed(5)+','+a.type;if(seen.has(k))return false;seen.add(k);return true});
}
function priority(a){const n=(a.name||'').toLowerCase();let s=a.type==='official'?86:a.type==='road-end'?82:a.type==='road-shore-approach'?70:52;if(n.includes('ramp')||n.includes('launch'))s=Math.max(s,94);if(n.includes('boat'))s=Math.max(s,92);if(a.waterDistance<=20)s+=6;else if(a.waterDistance<=40)s+=3;return Math.min(100,s)}
function corridor(a){const pts=[{lat:a.lat,lng:a.lng}];for(const m of [10,25,50,75,100,150])for(const off of [-22,-11,0,11,22]){const rad=off*Math.PI/180;pts.push({lat:a.lat+m*Math.cos(rad)/111320,lng:a.lng+m*Math.sin(rad)/(111320*Math.max(.2,Math.cos(a.lat*Math.PI/180)))})}return pts}
function makeFinding(a){const s=priority(a);return{...a,id:'v16-'+a.source+'-'+a.sourceId+'-'+a.lat.toFixed(5),name:a.name?`🚤 ${a.name}`:(a.type==='road-end'?'🛣️ ROAD END AT WATER':a.type==='road-shore-approach'?'🛣️ ROAD / SHORE APPROACH':'🚤 WATER ACCESS POINT'),accessPoint:true,access:s,anomaly:45,priority:s,label:s>=80?'HIGH':s>=55?'MEDIUM':'LOW',corridor:corridor(a),changeScore:45}}
function captureReleases(){return Array.isArray(window.__aquaReleases)?window.__aquaReleases:[]}
function addMapMarkers(list){const m=window.__aquaMap;if(!m||!window.L)return;if(!window.__v16AccessLayer)window.__v16AccessLayer=L.layerGroup().addTo(m);else window.__v16AccessLayer.clearLayers();for(const f of list){const color=f.type==='road-end'?'#ff8a00':f.type==='official'?'#ff3b30':'#ffd000';L.circleMarker([f.lat,f.lng],{radius:7,color,fillColor:color,fillOpacity:.95,weight:2}).bindPopup(`<b>${f.name}</b><br>${f.type} · ${f.source}<br><strong>PRIORITY ${f.priority}/100</strong><br>Access score ${f.access}/100`).addTo(window.__v16AccessLayer)}}
function priorityStyles(){if(window.__aquaPriorityStyles)return;window.__aquaPriorityStyles=true;const s=document.createElement('style');s.textContent=`#cards .pill{font-size:20px!important;font-weight:900!important;line-height:1.05!important;padding:7px 10px!important;min-width:108px!important;text-align:center!important;border-radius:9px!important;background:#06243a!important;color:#fff!important;border:2px solid #168ee8!important;letter-spacing:.2px!important}#cards .priority-badge{display:inline-block;font-size:22px;font-weight:900;line-height:1;padding:8px 11px;border-radius:9px;background:#06243a;color:#fff;border:2px solid #168ee8;float:right;min-width:105px;text-align:center}.card{min-height:58px}`;document.head.appendChild(s)}
function renderAccess(list){priorityStyles();const cards=$('cards');if(!cards)return;const old=cards.querySelector('[data-v16-access]');if(old)old.remove();const wrap=document.createElement('div');wrap.dataset.v16Access='1';wrap.innerHTML=`<div style="margin:12px 0 6px;font-weight:900;color:#0a4565">🚤 ACCESS-POINT SEARCHES <span class="small">(${list.length})</span></div>`;list.slice().sort((a,b)=>b.priority-a.priority).forEach(f=>{const d=document.createElement('div');d.className='card '+(f.label==='HIGH'?'high':f.label==='LOW'?'low':'');d.innerHTML=`<span class="rank">${f.label}</span><b>${f.name}</b><span class="priority-badge">${f.priority}/100</span><div class="small">${f.type} · ${f.source} · Access ${f.access}/100${f.waterDistance?` · ${f.waterDistance}m to mapped water`:''}</div><div class="small">Historical corridor: 10–150m from entry point · ${f.histAccess?.score!=null?`Historical access ${f.histAccess.score}/100`:'historical access pending'}</div>`;d.onclick=()=>{window.selected=f;if(typeof window.showCandidate==='function')window.showCandidate(f)};wrap.appendChild(d)});cards.insertBefore(wrap,cards.firstChild)}
async function scanHistory(list){
  const rel=captureReleases();if(!rel.length||typeof window.histScan!=='function')return;
  const top=list.slice().sort((a,b)=>b.priority-a.priority).slice(0,12);
  for(let i=0;i<top.length;i++)try{
    if($('scan'))$('scan').textContent=`V16 access history: ${i+1}/${top.length} · ${top[i].name}`;
    await window.histScan(top[i],rel,true,true);
    const hist=Math.max(0,Math.min(100,top[i].hist?.best??top[i].histAccess?.score??45));
    let veh=0;
    if(typeof window.vehicleScan==='function'&&$('vehicle')?.checked){await window.vehicleScan(top[i],rel,true);veh=Math.round(top[i].veh?.confidence||0);}
    top[i].priority=Math.min(100,Math.round(top[i].access*.72+hist*.18+veh*.10));
    top[i].label=top[i].priority>=80?'HIGH':top[i].priority>=55?'MEDIUM':'LOW';
    top[i].scoring='Access-led: physical water entry 72%, historical evidence 18%, vehicle/object evidence 10%.';
  }catch(e){console.warn('V16 historical access',e)}
  renderAccess(list);addMapMarkers(list)
}
function cleanCoordinateInput(){const el=$('loc');if(!el)return;let s=(el.value||'').trim();s=s.replace(/[\u00A0]/g,' ').replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"');s=s.replace(/\s*([.!?;,])\s*$/,'');el.value=s}
async function afterSearch(){cleanCoordinateInput();const raw=$('loc')?.value||'',m=raw.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);if(!m)return;const p={lat:+m[1],lng:+m[2]},r=+$('radius')?.value||1;$('status').textContent='V16: finding every ramp, road end, dock, pier and shoreline approach…';const list=(await accessDiscover(p,r)).map(makeFinding);accessResults=list;window.aquaV16Access=list;addMapMarkers(list);renderAccess(list);if(list.length){$('status').textContent=`V16: ${list.length} distinct access points found. Now checking historical access evidence…`;await scanHistory(list)}$('status').textContent=`Search complete — ${list.length} access points were separately searched in addition to the water candidates.`;if($('count'))$('count').textContent=`(${document.querySelectorAll('#cards .card').length})`}
function patchLegend(){const l=document.querySelector('.legend');if(l){l.style.left='auto';l.style.right='10px'}}
function install(){patchLegend();priorityStyles();cleanCoordinateInput();const find=$('find');if(find&&!find.__v16CoordinateFix){const originalFind=find.onclick;find.onclick=async function(ev){cleanCoordinateInput();if(typeof originalFind==='function')return originalFind.call(this,ev)};find.__v16CoordinateFix=true}const start=$('start');if(!start||start.__v16Installed)return;const original=start.onclick;if(typeof original!=='function')return;start.__v16Installed=true;window.__v16OriginalStart=original;start.onclick=async function(ev){cleanCoordinateInput();await original.call(this,ev);let tries=0;while(tries++<120){if($('status')?.textContent?.toLowerCase().includes('search complete'))break;await sleep(500)}try{await afterSearch()}catch(e){console.error('V16 integration',e);$('status').textContent='Base search complete; V16 access sources had a temporary limitation.'}}}
const oldHist=window.histScan;if(typeof oldHist==='function'&&!oldHist.__v16Capture){const w=async function(f,...args){window.__aquaReleases=args[0]||[];return oldHist.apply(this,arguments)};w.__v16Capture=true;window.histScan=w}
window.addEventListener('load',()=>setTimeout(install,0));setTimeout(install,500);
})();
