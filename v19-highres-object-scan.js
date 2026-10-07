/* AquaSearcher V19 — high-resolution historical object scan.
   Fixes the core limitation of the V16/V18 vehicle detector: a single 256px
   tile is too coarse for small/submerged vehicles. V19 builds a 3x3 mosaic
   around the exact historical target at native tile resolution, then runs
   COCO-SSD on the larger image and focused crops.
*/
(function(){
'use strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clamp=v=>Math.max(0,Math.min(100,Math.round(Number(v)||0)));

function hav(a,b){
  const R=3958.7613,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180;
  const dl=(b.lat-a.lat)*Math.PI/180,dg=(b.lng-a.lng)*Math.PI/180;
  const h=Math.sin(dl/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dg/2)**2;
  return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

function targetPoints(f){
  const out=[], add=(lat,lng,score,why)=>{
    if(!Number.isFinite(+lat)||!Number.isFinite(+lng))return;
    if(!out.some(p=>hav(p,{lat:+lat,lng:+lng})<0.003)){
      out.push({lat:+lat,lng:+lng,score:+score||0,why:why||'historical target'});
    }
  };
  const h=f?.hist?.heroTransition;
  if(h)add(h.lat,h.lng,h.heroScore||h.score,'exact historical transition');
  for(const c of (f?.hist?.comparisons||[]).slice().sort((a,b)=>(b.heroScore||0)-(a.heroScore||0))){
    if((c.localized||0)>=55||(c.heroScore||0)>=60)add(c.lat,c.lng,c.heroScore||c.score,'localized historical change');
    if(out.length>=5)break;
  }
  if(f?.lat!=null)add(f.lat,f.lng,0,'water-feature center');
  return out.filter(p=>p.score>=60).slice(0,3);
}

function tileUrl(r,lat,lng,z=18){
  const n=2**z,x=(lng+180)/360*n,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;
  return(r.itemURL||'').replace('{level}',z).replace('{row}',Math.floor(y)).replace('{col}',Math.floor(x));
}
async function loadImage(url){
  return new Promise((resolve,reject)=>{
    const im=new Image();im.crossOrigin='anonymous';
    const tm=setTimeout(()=>{im.src='';reject(Error('tile timeout'))},7000);
    im.onload=()=>{clearTimeout(tm);resolve(im)};
    im.onerror=()=>{clearTimeout(tm);reject(Error('tile failed'))};
    im.src=url;
  });
}
async function mosaic(r,lat,lng){
  const z=18,n=2**z;
  const x=(lng+180)/360*n,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;
  const cx=Math.floor(x),cy=Math.floor(y),fx=x-cx,fy=y-cy;
  const c=document.createElement('canvas');c.width=768;c.height=768;
  const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
  let ok=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    try{
      const xx=((cx+dx)%n+n)%n,yy=cy+dy;
      if(yy<0||yy>=n)continue;
      const url=(r.itemURL||'').replace('{level}',z).replace('{row}',yy).replace('{col}',xx);
      const im=await loadImage(url);
      ctx.drawImage(im,(dx+1)*256,(dy+1)*256,256,256);ok++;
    }catch(e){}
  }
  if(!ok)throw Error('No imagery tiles loaded');
  c.__aquaSourceSize=768;c.__aquaCenterOffset={x:(1+fx)*256,y:(1+fy)*256};
  return c;
}
function crops(src){
  const out=[src];
  // Center and overlapping 384/512px windows preserve enough context while
  // giving the detector a much larger vehicle footprint than the old 256px tile.
  for(const size of [512,384,320]){
    for(const [x,y] of [[384,384],[256,384],[512,384],[384,256],[384,512]]){
      const c=document.createElement('canvas');c.width=512;c.height=512;
      c.__aquaSourceSize=size;
      c.getContext('2d').drawImage(src,x-size/2,y-size/2,size,size,0,0,512,512);
      out.push(c);
    }
  }
  return out;
}
function estimateFt(det,lat,sourcePx){
  const px=Math.max(det.bbox?.[2]||0,det.bbox?.[3]||0);
  const mpp=(156543.03392*Math.cos(lat*Math.PI/180)/(2**18))*(sourcePx/512);
  return px*mpp*3.28084;
}

async function install(){
  if(window.__aquaV19Installed)return;
  window.__aquaV19Installed=true;
  if(typeof cocoSsd==='undefined')return;
  let model=null;
  async function getModel(){if(!model)model=await cocoSsd.load({base:'mobilenet_v2'});return model;}

  const old=window.vehicleScan;
  if(typeof old!=='function'||old.__v19)return;

  const wrapped=async function(f,rs,silent){
    // Keep the existing V16/V17/V18 scan. V19 is an additive high-resolution pass.
    let baseBest=null;
    try{baseBest=await old.apply(this,arguments)}catch(e){console.warn('V19 base scan',e)}

    const targets=targetPoints(f);
    if(!targets.length)return baseBest;

    const model=await getModel();
    const historical=rs.slice().sort((a,b)=>+a.releaseDatetime-+b.releaseDatetime);
    // Prefer the releases surrounding the strongest historical transition, then
    // add a couple of additional releases for persistence.
    const preferred=[];
    for(const t of targets.slice(0,1)){
      // The target score itself identifies the strongest transition; use up to
      // four representative releases, including the newest/oldest available.
      if(f.hist?.heroTransition){
        const from=String(f.hist.heroTransition.from),to=String(f.hist.heroTransition.to);
        for(const r of historical)if(r.date===from||r.date===to)preferred.push(r);
      }
    }
    for(const r of historical)if(!preferred.includes(r)&&preferred.length<4)preferred.push(r);
    const use=preferred.slice(0,4);
    const hits=[];
    for(const t of targets){
      for(const r of use){
        try{
          if(window.paused)while(window.paused)await sleep(150);
          if(document.getElementById('scan'))document.getElementById('scan').textContent=
            'V19 high-resolution object scan: '+r.date;
          const m=await mosaic(r,t.lat,t.lng);
          for(const c of crops(m)){
            const ds=await model.detect(c,30,.08);
            for(const d of ds){
              if(!['car','truck','boat','bus','motorcycle'].includes(d.class))continue;
              const ft=estimateFt(d,t.lat,c.__aquaSourceSize||768);
              if(ft<8)continue;
              hits.push({
                label:d.class,confidence:d.score,year:r.date,lat:t.lat,lng:t.lng,
                estimatedSizeFt:Math.round(ft*10)/10,sizeQualified:ft>=15,
                highResolution:true,historicalTarget:true,
                targetScore:t.score,targetReason:t.why
              });
            }
          }
        }catch(e){console.warn('V19 HR target',e)}
      }
    }

    const all=[...(f.veh?.hits||[])];
    const seen=new Set(all.map(h=>[h.year,h.lat,h.lng,h.label,h.estimatedSizeFt,h.highResolution].join('|')));
    for(const h of hits){const k=[h.year,h.lat,h.lng,h.label,h.estimatedSizeFt,h.highResolution].join('|');if(!seen.has(k)){seen.add(k);all.push(h)}}
    all.sort((a,b)=>(b.sizeQualified-a.sizeQualified)||(b.highResolution-a.highResolution)||(b.confidence-a.confidence));
    const strong=all.filter(h=>h.confidence>=.20&&h.estimatedSizeFt>=15);
    const years=new Set(strong.map(h=>h.year)).size;
    const best=strong[0]||null;
    const score=Math.min(100,Math.round(Math.min(1,years/2)*55+Math.min(1,(best?.confidence||0)/.7)*45));
    f.veh=f.veh||{};
    f.veh.hits=all;f.veh.best=best;f.veh.sizeThresholdFt=15;
    f.veh.highResolutionHits=hits.filter(h=>h.sizeQualified).length;
    f.veh.highResolutionTargets=targets.length;
    f.objectScore=Math.max(Number(f.objectScore)||0,score);
    f.vehicleEvidence=f.vehicleEvidence||{};
    f.vehicleEvidence.score=f.objectScore;
    f.vehicleEvidence.sizeThresholdFt=15;
    f.vehicleEvidence.highResolution=true;
    f.vehicleEvidence.highResolutionHits=hits.filter(h=>h.sizeQualified).length;
    f.vehicleEvidence.status=best?
      ('High-resolution historical scan found a '+best.label+' candidate at about '+best.estimatedSizeFt+
       ' ft ('+Math.round(best.confidence*100)+'% confidence).'):
      'No 15+ ft vehicle-class detection found in the high-resolution historical scan.';
    if(typeof window.aquaScoreFinding==='function')window.aquaScoreFinding(f);
    if(typeof window.render==='function')window.render();
    if(typeof window.redraw==='function')window.redraw();
    return best||baseBest;
  };
  wrapped.__v19=true;
  window.vehicleScan=wrapped;
  const logo=document.querySelector('.logo small');if(logo)logo.textContent='V19';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,1800));
else setTimeout(install,1800);
window.addEventListener('load',()=>setTimeout(install,2000));
})();