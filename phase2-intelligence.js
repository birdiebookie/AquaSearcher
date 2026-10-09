/* AquaSearcher Phase 2 — intelligence layer.
   IMPORTANT: this layer is additive. It reads Phase 1 results and enriches them;
   it does not replace Phase 1 filtering, historical evidence, or vehicle rules.
*/
(function(){
'use strict';

const P2={
  hydroBase:'https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/FeatureServer',
  bathyBase:'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/USGS_Inland_Bathymetry_Survey_Invent_v3Update/FeatureServer/0',
  ohioBathyBase:'https://gis2.ohiodnr.gov/ArcGIS/rest/services/DOW_Services/DOW_Lakes_Bathymetry/MapServer/0',
  elevBase:'https://epqs.nationalmap.gov/v1/json',
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
async function elevationAt(p){
  const key=cacheKey('elev',p,0);
  if(P2.cache.has(key))return P2.cache.get(key);
  try{
    const u=P2.elevBase+'?x='+encodeURIComponent(p.lng)+'&y='+encodeURIComponent(p.lat)+'&units=Feet&output=json';
    const res=await fetch(u,{signal:AbortSignal.timeout(10000),cache:'no-store'});
    const j=await res.json();
    const v=num(j?.value);
    P2.cache.set(key,v); return v;
  }catch(e){P2.cache.set(key,null);return null}
}
async function queryTopography(p){
  const key=cacheKey('topo',p,0),cached=P2.cache.get(key);if(cached)return cached;
  const m=18,a=m/111320,z=m/(111320*Math.max(.2,Math.cos(p.lat*Math.PI/180)));
  const pts=[p,{lat:p.lat+a,lng:p.lng},{lat:p.lat-a,lng:p.lng},{lat:p.lat,lng:p.lng+z},{lat:p.lat,lng:p.lng-z}];
  const vals=[]; for(const q of pts){const v=await elevationAt(q);if(v!=null)vals.push(v)}
  const out={sampleCount:vals.length,min:vals.length?Math.min(...vals):null,max:vals.length?Math.max(...vals):null,reliefFt:vals.length?Math.max(...vals)-Math.min(...vals):null};
  P2.cache.set(key,out);return out;
}
function vehicleHidingSuitability(f,topo){
  const p=f.phase2||{}, cls=p.waterClass, area=p.waterAreaSqKm, width=num(f.waterWidthFt);
  let score=100, reasons=[];
  if(['STREAM','CANAL'].includes(cls)){
    if(width!=null&&width<60){score-=70;reasons.push('narrow flowline')}
    else score-=35;
  }
  if(area!=null){
    if(area<0.002){score-=55;reasons.push('very small water area')}
    else if(area<0.01){score-=35;reasons.push('small water area')}
    else if(area<0.05){score-=15;reasons.push('small basin')}
  }
  if(['POND','WATERBODY'].includes(cls)&&area!=null&&area<0.01&&!p.bathymetryAvailable){score-=20;reasons.push('small basin with no bathymetry')}
  if(topo?.reliefFt!=null&&topo.reliefFt<2&&area!=null&&area<0.01){score-=10;reasons.push('very low local relief')}
  return{score:clamp(score),reasons};
}
async function queryOhioBathymetry(p,r){
  // Ohio DNR provides actual lake/reservoir depth contours and depth attributes.
  // Use it as a live supplemental source when the search point is in Ohio.
  if(p.lng>-80.45||p.lng<-84.95||p.lat<38.35||p.lat>42.05)return[];
  const key=cacheKey('ohio-bathy',p,r),cached=P2.cache.get(key);
  if(cached)return cached;
  try{
    const meters=Math.round(Math.min(r,5)*1609.344);
    const j=await arcQuery(P2.ohioBathyBase,{
      where:'1=1',
      geometry:p.lng+','+p.lat,
      geometryType:'esriGeometryPoint',
      inSR:'4326',
      spatialRel:'esriSpatialRelIntersects',
      distance:meters,
      units:'esriSRUnit_Meter',
      outFields:'LAKE_NAME,DEPTH,RES,DT_ADDED',
      returnGeometry:'true',
      outSR:'4326',
      f:'json'
    });
    const out=(j.features||[]).map(f=>({...f,_bathySource:'Ohio DNR'}));
    P2.cache.set(key,out); return out;
  }catch(e){
    console.warn('Ohio DNR bathymetry query failed',e);
    P2.cache.set(key,[]); return[];
  }
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
  for(const k of ['AREASQKM','AREA_SQKM','AreaSqKm','AREA_KM2','AREA']){const n=num(a[k]);if(n!=null)return n}
  return null;
}
function depthValues(f){
  const a=attrs(f),out=[];
  for(const [k,v] of Object.entries(a)){
    if(!/depth|depth_ft|depth_m|bathym/i.test(k))continue;
    const n=num(v);if(n!=null&&Math.abs(n)<100000)out.push({field:k,value:n});
  }
  return out;
}
function bathyEvidence(records){
  const values=[];
  for(const f of records||[])values.push(...depthValues(f));
  if(!values.length)return{available:(records||[]).length>0,values:[],min:null,max:null,summary:(records||[]).length?'Survey inventory coverage found; no numeric depth field was exposed by the returned records.':'No bathymetry-inventory coverage found at this screening radius.'};
  const nums=values.map(x=>x.value);
  return{available:true,values,min:Math.min(...nums),max:Math.max(...nums),summary:'Numeric bathymetry depth field(s) were returned by the survey inventory.'};
}
function hydroType(f){
  const a=attrs(f);
  const v=a.WB_TYPE||a.WATERBODY_TYPE||a.FEATURE||a.FTYPE||'';return String(v||(_isWaterbody(f)?'waterbody':'flowline')).toLowerCase();
}
function
