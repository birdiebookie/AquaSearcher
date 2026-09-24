/* AquaSearcher Phase 3 — target detection / known-object validation.
   Purpose: improve detection of small man-made objects that are easy to miss at
   water-feature scale. This layer deliberately searches dry land around access
   points and the exact search pin; it does NOT require the target to be inside
   a mapped water polygon.

   Uses higher-resolution historical tiles (z19), 3x3 tile mosaics, multi-release
   consensus, COCO-SSD when available, and a conservative localized-change signal.
*/
(function(){
'use strict';
const P3={running:false};
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MILE=1609.344;

function distM(a,b){
  const R=6371000,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180;
  const dp=(b.lat-a.lat)*Math.PI/180,dl=(b.lng-a.lng)*Math.PI/180;
  const q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
}
function point(lat,lng){return Number.isFinite(+lat)&&Number.isFinite(+lng)?{lat:+lat,lng:+lng}:null}
function uniquePts(arr){
  const out=[],seen=new Set();
  for(const p of arr||[]){
    if(!p)continue;
    const k=p.lat.toFixed(5)+','+p.lng.toFixed(5);
    if(seen.has(k))continue;seen.add(k);out.push(p);
  }
  return out;
}
function around(p,m){
  const a=m/111320,z=m/(111320*Math.max(.2,Math.cos(p.lat*Math.PI/180)));
  return [
    p,{lat:p.lat+a,lng:p.lng},{lat:p.lat-a,lng:p.lng},
    {lat:p.lat,lng:p.lng+z},{lat:p.lat,lng:p.lng-z},
    {lat:p.lat+a,lng:p.lng+z},{lat:p.lat+a,lng:p.lng-z},
    {lat:p.lat-a,lng:p.lng+z},{lat:p.lat-a,lng:p.lng-z}
  ];
}
const NAIP_PLUS='https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';
function mercator(lat,lng){
  const R=6378137, x=R*lng*Math.PI/180;
  const y=R*Math.log(Math.tan(Math.PI/4+Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/360));
  return {x,y};
}
async function naipPlusImage(p){
  const m=mercator(p.lat,p.lng), half=115;
  const url=NAIP_PLUS+'?bbox='+encodeURIComponent((m.x-half)+','+(m.y-half)+','+(m.x+half)+','+(m.y+half))+'&bboxSR=3857&size=768,768&imageSR=3857&format=png&pixelType=U8&interpolation=RSP_Bilinear&f=image';
  return await image(url);
}
function tile19(rel,lat,lng){
  const z=19,n=2**z,x=(lng+180)/360*n,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;
  return(rel.itemURL||'').replace(/\\{level\\}/g,z).replace(/\\{row\\}/g,Math.floor(y)).replace(/\\{col\\}/g,Math.floor(x));
}
async function image(url){
  return await new Promise((resolve,reject)=>{
    const i=new Image(),tm=setTimeout(()=>{i.src='';reject(Error('tile timeout'))},7000);
    i.crossOrigin='anonymous';
    i.onload=()=>{clearTimeout(tm);const c=document.createElement('canvas');c.width=256;c.height=256;c.getContext('2d').drawImage(i,0,0);resolve(c)};
    i.onerror=()=>{clearTimeout(tm);reject(Error('tile failed'))};i.src=url;
  });
}
async function mosaic(rel,p){
  const z=19,n=2**z,x=(p.lng+180)/360*n,y=(1-Math.asinh(Math.tan(p.lat*Math.PI/180))/Math.PI)/2*n;
  const tx=Math.floor(x),ty=Math.floor(y),c=document.createElement('canvas');c.width=768;c.height=768;
  const ctx=c.getContext('2d');
  let good=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    try{
      const lon=(tx+dx+.5)/n*360-180;
      const lat=180/Math.PI*Math.atan(Math.sinh(Math.PI*(1-2*(ty+dy+.5)/n)));
      const u=tile19(rel,lat,lon),im=await image(u);
      ctx.drawImage(im,(dx+1)*256,(dy+1)*256);good++;
    }catch(e){}
  }
  if(good<4)throw Error('insufficient imagery tiles');
  return c;
}
function centerCrop(src,x,y,w,h){
  const c=document.createElement('canvas');c.width=512;c.height=512;
  c.getContext('2d').drawImage(src,Math.max(0,x-w/2),Math.max(0,y-h/2),w,h,0,0,512,512);
  return c;
}
function changeScore(a,b){
  const A=a.getContext('2d',{willReadFrequently:true}).getImageData(0,0,768,768).data;
  const B=b.getContext('2d',{willReadFrequently:true}).getImageData(0,0,768,768).data;
  let sum=0,hot=0,n=0;
  for(let y=32;y<736;y+=6)for(let x=32;x<736;x+=6){
    const i=(y*768+x)*4,d=(Math.abs(A[i]-B[i])+Math.abs(A[i+1]-B[i+1])+Math.abs(A[i+2]-B[i+2]))/3;
    sum+=d;n++;if(d>55)hot++;
  }
  return Math.min(100,Math.round(sum/Math.max(1,n)*1.25+hot/Math.max(1,n)*180));
}
function localObjectness(src){
  const d=src.getContext('2d',{willReadFrequently:true}).getImageData(0,0,src.width,src.height).data,w=src.width,h=src.height;
  let edge=0,contrast=0,n=0;
  for(let y=8;y<h-8;y+=8)for(let x=8;x<w-8;x+=8){
    const i=(y*w+x)*4,lum=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    const r=(y*w+x+8)*4,l=(y*w+x-8)*4,u=((y+8)*w+x)*4,v=((y-8)*w+x)*4;
    const lr=.299*d[r]+.587*d[r+1]+.114*d[r+2],ll=.299*d[l]+.587*d[l+1]+.114*d[l+2],lu=.299*d[u]+.587*d[u+1]+.114*d[u+2],lv=.299*d[v]+.587*d[v+1]+.114*d[v+2];
    edge+=Math.min(1,(Math.abs(lr-ll)+Math.abs(lu-lv))/220);
    contrast+=Math.min(1,Math.abs(lum-128)/128);n++;
  }
  return Math.round(Math.min(100,(edge/n*.65+contrast/n*.35)*100));
}
async function detectCanvas(src,lat,lng){
  if(typeof cocoSsd==='undefined')return[];
  try{
    if(!window.__aquaP3Coco)window.__aquaP3Coco=await cocoSsd.load({base:'mobilenet_v2'});
    const views=[src,centerCrop(src,384,384,384,384),centerCrop(src,384,384,256,256)];
    const out=[];
    for(const v of views){
      const ds=await window.__aquaP3Coco.detect(v,25,.12);
      for(const o of ds.filter(x=>['car','truck','boat','bus','motorcycle'].includes(x.class))){
        const px=Math.max(o.bbox?.[2]||0,o.bbox?.[3]||0);
        const mPerPx=(156543.03392*Math.cos(lat*Math.PI/180)/(2**19))*(v===src?1:384/512);
        const ft=px*mPerPx*3.28084;
        out.push({label:o.class,confidence:o.score,estimatedSizeFt:Math.round(ft*10)/10,sizeQualified:ft>=8,lat,lng});
      }
    }
    return out;
  }catch(e){return[]}
}
async function rowNAIP(p,m,hits,obj){
  try{
    const n=await naipPlusImage(p),nh=await detectCanvas(n,p.lat,p.lng);
    const key=p.lat.toFixed(5)+','+p.lng.toFixed(5),r=records.get(key)||{lat:p.lat,lng:p.lng,years:[],hits:[],changes:[],objectness:[],naipHits:[],naipObjectness:[]};
    r.naipHits.push(...nh.map(h=>({...h,source:'USGS NAIP Plus'})));r.naipObjectness.push(localObjectness(n));records.set(key,r);
  }catch(e){/* NAIP Plus is supplemental; never block the historical scan */}
}
function candidatePoints(){
  const out=[];
  if(window.__aquaPinTest)out.push(point(window.__aquaPinTest.lat,window.__aquaPinTest.lng));
  const pin=window.pin?.getLatLng?.();if(pin)out.push(point(pin.lat,pin.lng));
  for(const a of window.aquaV16Access||[])out.push(point(a.lat,a.lng));
  for(const f of window.__aquaFindings||[])if(!f.isPinTest&&!f.accessPoint)out.push(point(f.lat,f.lng));
  const base=uniquePts(out),expanded=[];
  for(const p of base.slice(0,24))expanded.push(...around(p,0),...around(p,12),...around(p,28));
  return uniquePts(expanded).slice(0,96);
}
async function run(manual){
  if(P3.running)return;
  const rs=typeof window.releases==='function'?window.releases(window.waybackCatalog||[]):[];
  if(!rs.length){if(manual)toast('Run the main search first so historical imagery releases are loaded.');return}
  const pts=candidatePoints();
  if(!pts.length){if(manual)toast('No target/search points are available.');return}
  P3.running=true;
  const use=typeof window.pick==='function'?window.pick(rs,Math.min(10,rs.length)):rs.slice(0,10);
  const records=new Map();
  try{
    for(let ri=0;ri<use.length;ri++){
      const rel=use[ri];
      for(let pi=0;pi<pts.length;pi++){
        const p=pts[pi];
        if($('scan'))$('scan').textContent='Phase 3 target search: '+rel.date+' · point '+(pi+1)+'/'+pts.length;
        try{
          const m=await mosaic(rel,p),hits=await detectCanvas(m,p.lat,p.lng),obj=localObjectness(m);
          rowNAIP(p,m,hits,obj);
          const key=p.lat.toFixed(5)+','+p.lng.toFixed(5);
          const row=records.get(key)||{lat:p.lat,lng:p.lng,years:[],hits:[],changes:[],objectness:[],naipHits:[],naipObjectness:[]};
          row.years.push(rel.date);row.hits.push(...hits);row.objectness.push(obj);
          records.set(key,row);
        }catch(e){}
        await sleep(2);
      }
    }
    // Compare selected adjacent releases for localized change.
    const pts2=[...records.values()].slice(0,48);
    for(const row of pts2){
      let prev=null;
      for(const rel of use){
        try{
          const m=await mosaic(rel,{lat:row.lat,lng:row.lng});
          if(prev)row.changes.push({from:prev.date,to:rel.date,score:changeScore(prev.m,m)});
          prev={date:rel.date,m};
        }catch(e){}
      }
    }
    const hits=[...records.values()].map(r=>{
      const strong=[...r.hits,...r.naipHits].filter(h=>h.confidence>=.25&&h.sizeQualified);
      const best=strong.sort((a,b)=>b.confidence-a.confidence)[0]||null;
      const years=new Set(strong.map(h=>h.year)).size;
      const change=Math.max(0,...r.changes.map(x=>x.score));
      const obj=Math.max(0,...r.objectness,...r.naipObjectness);
      const score=Math.min(100,Math.round(Math.min(1,years/3)*42+(best?Math.min(1,best.confidence/.7)*30:0)+change*.20+obj*.08));
      return {...r,best,years,change,obj,score,naipPlusHits:r.naipHits.length};
    }).filter(r=>r.score>=18).sort((a,b)=>b.score-a.score);
    window.__aquaPhase3Targets=hits;
    const pin=window.pin?.getLatLng?.();
    const nearest=pin?hits.slice().sort((a,b)=>distM(a,pin)-distM(b,pin))[0]:null;
    if(pin&&nearest)window.__aquaPhase3KnownTarget={...nearest,distanceM:distM(nearest,pin)};
    render(hits);
    if($('phase3status'))$('phase3status').textContent='Complete — '+hits.length+' target zones screened across '+use.length+' imagery releases. Dry-land areas and mapped access corridors were included.';
    if($('status'))$('status').textContent+=' Phase 3 target detection added.';
    toast('Phase 3 target search complete.');
  }catch(e){
    console.error('Phase 3',e);
    if($('phase3status'))$('phase3status').textContent='Target scan stopped; earlier Phase 1/2 results were preserved.';
    if(manual)toast('Phase 3 could not finish, but earlier results were preserved.');
  }finally{P3.running=false}
}
function render(hits){
  const old=document.getElementById('phase3panel');if(old)old.remove();
  const host=document.querySelector('.findings');if(!host)return;
  const p=document.createElement('div');p.id='phase3panel';p.style.cssText='margin-top:10px;padding:10px;background:#fff7e8;border:1px solid #ead39c;border-radius:9px;font-size:11px';
  p.innerHTML='<b>PHASE 3 — TARGET DETECTION</b><div id="phase3status" style="margin-top:4px;color:#60717f">Target zones detected: '+hits.length+'</div><div id="phase3list" style="margin-top:6px"></div><button id="p3run" class="btn2" style="margin-top:7px">Re-run Phase 3 Target Search</button>';
  host.appendChild(p);
  const list=$('phase3list');
  list.innerHTML=hits.slice(0,10).map((h,i)=>{
    const d=h.best?(' · '+h.best.label+' '+Math.round(h.best.confidence*100)+'% · '+h.best.estimatedSizeFt+' ft'+(h.best.source?' · '+h.best.source:'')):'';
    return '<div style="padding:5px 0;border-top:1px solid #eadfc8"><b>#'+(i+1)+' '+h.score+'/100</b>'+d+' · '+h.years+' release(s) · NAIP+ '+h.naipPlusHits+' detection(s) · change '+h.change+'/100</div>';
  }).join('')||'<div class="small">No target-like zone cleared the conservative threshold.</div>';
  $('p3run').onclick=()=>run(true);
}
function install(){
  const host=document.querySelector('.findings');if(!host)return;
  if(document.getElementById('phase3panel'))return;
  const p=document.createElement('div');p.id='phase3panel';p.style.cssText='margin-top:10px;padding:10px;background:#fff7e8;border:1px solid #ead39c;border-radius:9px;font-size:11px';
  p.innerHTML='<b>PHASE 3 — TARGET DETECTION</b><div id="phase3status" style="margin-top:4px;color:#60717f">Ready — searches dry land, access corridors and the exact pin at higher resolution.</div><button id="p3run" class="btn2" style="margin-top:7px">Run Phase 3 Target Search</button>';
  host.appendChild(p);$('p3run').onclick=()=>run(true);
  const start=$('start');if(start&&!start.__p3){
    start.__p3=true;const old=start.onclick;
    start.onclick=async function(...args){const out=await old.apply(this,args);await sleep(250);await run(false);return out};
  }
}
window.aquaPhase3={run};
window.addEventListener('load',()=>setTimeout(install,3600));
setTimeout(install,4200);
})();