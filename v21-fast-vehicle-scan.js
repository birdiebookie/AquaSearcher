/* AquaSearcher V21 — bounded high-resolution vehicle scan.
   The previous detector could take hours because it stacked V16/V17/V18/V19
   scans. V21 replaces that chain with a bounded scan focused on exact and
   historical target coordinates.
*/
(function(){
'use strict';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function hav(a,b){const R=3958.7613,p=a.lat*Math.PI/180,q=b.lat*Math.PI/180,dl=(b.lat-a.lat)*Math.PI/180,dg=(b.lng-a.lng)*Math.PI/180,h=Math.sin(dl/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(dg/2)**2;return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))}
function tileUrl(r,lat,lng,z=18){const n=2**z,x=(lng+180)/360*n,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;return(r.itemURL||'').replace('{level}',z).replace('{row}',Math.floor(y)).replace('{col}',Math.floor(x))}
function load(url){return new Promise((ok,no)=>{const i=new Image(),tm=setTimeout(()=>{i.src='';no(Error('tile timeout'))},5000);i.crossOrigin='anonymous';i.onload=()=>{clearTimeout(tm);ok(i)};i.onerror=()=>{clearTimeout(tm);no(Error('tile failed'))};i.src=url})}
async function mosaic(r,lat,lng){
 const z=18,n=2**z,x=(lng+180)/360*n,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n,cx=Math.floor(x),cy=Math.floor(y);
 const c=document.createElement('canvas');c.width=768;c.height=768;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
 const jobs=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=cy+dy;if(yy<0||yy>=n)continue;const xx=((cx+dx)%n+n)%n,url=(r.itemURL||'').replace('{level}',z).replace('{row}',yy).replace('{col}',xx);jobs.push(load(url).then(im=>({im,dx,dy})).catch(()=>null))}
 const got=(await Promise.all(jobs)).filter(Boolean);if(!got.length)throw Error('No imagery tiles loaded');
 for(const q of got)ctx.drawImage(q.im,(q.dx+1)*256,(q.dy+1)*256,256,256);
 return c;
}
function crops(src){
 const out=[src];
 for(const size of [512,384]){
   const c=document.createElement('canvas');c.width=512;c.height=512;
   c.__aquaSourceSize=size;c.getContext('2d').drawImage(src,384-size/2,384-size/2,size,size,0,0,512,512);out.push(c);
 }
 return out;
}
function sizeFt(d,lat,src){const px=Math.max(d.bbox?.[2]||0,d.bbox?.[3]||0),mpp=(156543.03392*Math.cos(lat*Math.PI/180)/(2**18))*(src/512);return px*mpp*3.28084}
function releasesFor(rs,f){
 const s=rs.slice().sort((a,b)=>+a.releaseDatetime-+b.releaseDatetime),want=[];
 const add=r=>{if(r&&!want.includes(r))want.push(r)};
 add(s[0]);add(s[s.length-1]);
 const years=f?.isPinTest?[1997,1998,2017,2018,2019,2020]:[2018,2019];
 for(const y of years){let best=s.reduce((a,r)=>Math.abs(+String(r.date).slice(0,4)-y)<Math.abs(+String(a.date).slice(0,4)-y)?r:a,s[0]);add(best)}
 for(const r of s){if(want.length>=8)break;add(r)}
 return want.slice(0,f?.isPinTest?8:6);
}
function targets(f){
 const out=[],add=(lat,lng,score,why)=>{if(!Number.isFinite(+lat)||!Number.isFinite(+lng))return;const p={lat:+lat,lng:+lng,score:+score||0,why:why||'target'};if(!out.some(x=>hav(x,p)<0.003))out.push(p)};
 add(f?.lat,f?.lng,100,f?.isPinTest?'exact supplied coordinate':'water-feature center');
 for(const c of (f?.hist?.comparisons||[]).slice().sort((a,b)=>(b.heroScore||0)-(a.heroScore||0))){if((c.heroScore||0)>=55||(c.localized||0)>=55)add(c.lat,c.lng,c.heroScore||c.score,'historical target');if(out.length>=3)break}
 return out.slice(0,3);
}
async function install(){
 if(window.__aquaV21Installed)return;window.__aquaV21Installed=true;
 if(typeof cocoSsd==='undefined')return;
 const model=await cocoSsd.load({base:'mobilenet_v2'});
 const scan=async function(f,rs,silent){
   const use=releasesFor(rs,f),pts=targets(f),hits=[];
   for(const r of use)for(const p of pts){
     if(window.paused)while(window.paused)await wait(150);
     if(document.getElementById('scan'))document.getElementById('scan').textContent='Fast vehicle scan: '+r.date;
     try{
       const m=await mosaic(r,p.lat,p.lng);
       for(const c of crops(m)){
         const ds=await model.detect(c,20,.08);
         for(const d of ds)if(['car','truck','boat','bus','motorcycle'].includes(d.class)){
           const ft=sizeFt(d,p.lat,c.__aquaSourceSize||768);
           if(ft>=8)hits.push({label:d.class,confidence:d.score,year:r.date,lat:p.lat,lng:p.lng,estimatedSizeFt:Math.round(ft*10)/10,sizeQualified:ft>=15,highResolution:true,historicalTarget:p.score<100,targetScore:p.score,targetReason:p.why});
         }
       }
     }catch(e){}
   }
   hits.sort((a,b)=>(b.sizeQualified-a.sizeQualified)||(b.confidence-a.confidence));
   const strong=hits.filter(h=>h.confidence>=.20&&h.sizeQualified),years=new Set(strong.map(h=>h.year)).size,best=strong[0]||hits[0]||null;
   const score=best?Math.min(100,Math.round(Math.min(1,years/2)*55+Math.min(1,best.confidence/.7)*45)):0;
   f.veh={hits,best,releases:use.map(x=>x.date),samplePoints:pts.length,model:'V21 bounded high-resolution MobileNet v2',historicalReleasesWithHits:years,exactPinHits:hits.filter(h=>Math.abs(h.lat-f.lat)<.0008&&Math.abs(h.lng-f.lng)<.001).length,detectionScore:score,sizeThresholdFt:15,highResolutionHits:hits.filter(h=>h.sizeQualified).length};
   f.objectScore=score;f.vehicleEvidence={score,model:'V21 bounded high-resolution MobileNet v2',temporalConsensus:years,exactPinHits:f.veh.exactPinHits,sizeThresholdFt:15,highResolution:true,highResolutionHits:f.veh.highResolutionHits,status:best?('High-resolution '+best.label+' candidate '+best.estimatedSizeFt+' ft at '+Math.round(best.confidence*100)+'% confidence.'):'No vehicle-class detection returned.'};
   if(typeof window.aquaScoreFinding==='function')window.aquaScoreFinding(f);
   if(typeof window.render==='function')window.render();if(typeof window.redraw==='function')window.redraw();
   return best;
 };
 scan.__v21=true;window.vehicleScan=scan;
 const logo=document.querySelector('.logo small');if(logo)logo.textContent='V21';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,2200));else setTimeout(install,2200);
window.addEventListener('load',()=>setTimeout(install,2400));
})();