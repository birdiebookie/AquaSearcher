/* AquaSearcher V14 accuracy layer. Loaded after V13 so the original app remains intact while screening logic is strengthened. */
(function(){
  'use strict';
  const q=id=>document.getElementById(id), sleep=ms=>new Promise(r=>setTimeout(r,ms));
  window.center=function(f){
    const g=f&&f.geometry;if(!g)return null;const pts=[];
    if(Array.isArray(g.rings))for(const ring of g.rings||[])for(const p of ring||[])if(Array.isArray(p)&&Number.isFinite(+p[0])&&Number.isFinite(+p[1]))pts.push({x:+p[0],y:+p[1]});
    else if(Array.isArray(g))for(const p of g)if(p&&Number.isFinite(+p.x)&&Number.isFinite(+p.y))pts.push({x:+p.x,y:+p.y});
    if(!pts.length)return null;let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const p of pts){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y)}
    return{lat:(minY+maxY)/2,lng:(minX+maxX)/2};
  };
  const originalMakeFinding=window.makeFinding;
  if(typeof originalMakeFinding==='function')window.makeFinding=function(w,i,a){const f=originalMakeFinding(w,i,a);if(f){f.geometry=w.geometry||null;f.source=w._osm?'OpenStreetMap':'USGS National Hydrography Dataset'}return f};
  const originalHistScan=window.histScan;
  if(typeof originalHistScan==='function')window.histScan=async function(f,rs,silent,fast){
    const result=await originalHistScan(f,rs,silent,fast);if(!f.hist||!Array.isArray(f.hist.comparisons))return result;const comps=f.hist.comparisons;if(!comps.length)return result;
    const raw=Math.max(...comps.map(x=>x.score||0)),threshold=Math.max(48,raw-15),persistent=comps.filter(x=>(x.score||0)>=threshold),uniquePeriods=new Set(persistent.map(x=>x.from+'>'+x.to)).size,persistence=Math.min(1,uniquePeriods/4);
    const adjusted=Math.round(Math.min(100,raw*(.68+.32*persistence)));f.hist.rawBest=raw;f.hist.persistenceCount=uniquePeriods;f.hist.best=adjusted;
    f.hist.interpretation=uniquePeriods>=3?'Repeated change across multiple imagery periods':uniquePeriods===2?'Change repeated in two imagery periods':'Single/limited imagery change; seasonal or imaging effects remain possible';
    f.anomaly=adjusted;f.priority=Math.round(adjusted*.65+(f.access||0)*.35);if(f.isPinTest)f.priority=Math.max(70,f.priority);f.label=f.priority>=80?'HIGH':f.priority>=55?'MEDIUM':'LOW';return result;
  };
  const originalVehicleScan=window.vehicleScan;
  if(typeof originalVehicleScan==='function')window.vehicleScan=async function(f,rs,silent){
    if(typeof cocoSsd==='undefined')throw Error('Vehicle detector library unavailable');
    if(!window.coco)window.coco=await cocoSsd.load({base:'lite_mobilenet_v2'});
    const use=(rs||[]).length<=10?(rs||[]):[rs[0],rs[Math.floor(rs.length*.25)],rs[Math.floor(rs.length*.5)],rs[Math.floor(rs.length*.75)],rs[rs.length-1]];
    const base=(f.samples||[{lat:f.lat,lng:f.lng}]).slice(0,9),hits=[];
    for(let i=0;i<use.length;i++){
      if(q('pause')?.textContent?.includes('RESUME'))await sleep(250);
      if(q('scan'))q('scan').textContent=`Vehicle/object screening: ${use[i].date} · ${i+1}/${use.length}`;
      for(const p of base)try{const d=await coco.detect(await window.img(window.tile(use[i],p.lat,p.lng,18)));d.filter(o=>['car','truck','boat','bus','motorcycle'].includes(o.class)&&o.score>=.20).forEach(o=>hits.push({label:o.class,confidence:o.score,year:use[i].date,lat:p.lat,lng:p.lng}))}catch(e){}
    }
    hits.sort((a,b)=>b.confidence-a.confidence);f.veh={hits,best:hits[0]||null,releases:use.map(x=>x.date),samplePoints:base.length,detected:hits.length>0,status:hits.length?'Automated object candidate detected':'No conventional vehicle object detected by automated screening; this does not rule out a vehicle',confidence:hits[0]?Math.round(hits[0].confidence*100):0};
    if(typeof window.render==='function')window.render();if(!silent&&typeof window.showCandidate==='function')window.showCandidate(f);return hits[0]||null;
  };
  const originalRender=window.render;
  if(typeof originalRender==='function')window.render=function(){originalRender();document.querySelectorAll('.card').forEach(card=>{const old=card.querySelector('.v14evidence');if(old)old.remove();const div=document.createElement('div');div.className='v14evidence small';div.textContent='V14: scores are screening evidence; historical/seasonal imagery effects can create false positives.';card.appendChild(div)})};
  const originalShow=window.showCandidate;
  if(typeof originalShow==='function')window.showCandidate=function(f){originalShow(f);const d=q('detailText');if(!d)return;const parts=[`Priority ${f.priority}/100`,`Mapped access ${f.access}/100`];if(f.hist){parts.push(`Historical change ${f.hist.best}/100`);if(f.hist.persistenceCount!=null)parts.push(`${f.hist.persistenceCount} repeated period(s)`)}if(f.veh)parts.push(f.veh.status);d.textContent=parts.join(' · ')+'. '+(f.why||'')+' Automated screening is evidence for review, not proof of an object or event.'};
  window.addEventListener('load',()=>{const logo=document.querySelector('.logo small');if(logo)logo.textContent='V14';const header=document.querySelector('header');if(header&&!document.getElementById('v14badge')){const b=document.createElement('span');b.id='v14badge';b.textContent='Accuracy layer active';b.style.cssText='font-size:10px;color:#b9e7ff;margin-left:auto;opacity:.9';header.appendChild(b)}});
})();
