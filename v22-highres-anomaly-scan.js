/* AquaSearcher V22 — high-resolution known-vehicle/object pass.
   Uses z20/z19 imagery when the archive supports it, then falls back to z18.
   Adds a water-aware visual anomaly pass because submerged/low-contrast cars
   are often too small for COCO-SSD to recognize as "car".
*/
(function(){
'use strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function wait(ms){return new Promise(r=>setTimeout(r,ms))}
function hav(a,b){const R=3958.7613,p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dl=(b.lat-a.lat)*Math.PI/180,dg=(b.lng-a.lng)*Math.PI/180,h=Math.sin(dl/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dg/2)**2;return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))}
function addPt(out,lat,lng,score,why){if(!Number.isFinite(+lat)||!Number.isFinite(+lng))return;const p={lat:+lat,lng:+lng,score:+score||0,why:why||'target'};if(!out.some(x=>hav(x,p)<0.003))out.push(p)}
function targets(f){
 const out=[];
 addPt(out,f?.lat,f?.lng,100,f?.isPinTest?'exact supplied coordinate':'water-feature center');
 for(const c of (f?.hist?.comparisons||[]).slice().sort((a,b)=>(b.heroScore||0)-(a.heroScore||0))){
   if((c.heroScore||0)>=45||(c.localized||0)>=45)addPt(out,c.lat,c.lng,c.heroScore||c.score,'historical anomaly');
   if(out.length>=5)break;
 }
 if(f?.isPinTest){
   const ft=.3048/111320,lonFt=ft/Math.max(.15,Math.cos(f.lat*Math.PI/180));
   for(const [n,e] of [[25,0],[-25,0],[0,25],[0,-25],[50,0],[-50,0],[0,50],[0,-50],[75,0],[-75,0],[0,75],[0,-75]])
     addPt(out,f.lat+n*ft,f.lng+e*lonFt,90,'exact-pin search ring');
 }
 return out.slice(0,f?.isPinTest?13:5);
}
function tileUrl(r,lat,lng,z){
 const n=2**z,x=(lng+180)/360*n,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;
 return(r.itemURL||'').replace('{level}',z).replace('{row}',Math.floor(y)).replace('{col}',Math.floor(x));
}
async function loadImage(url,ms=6000){return new Promise((ok,no)=>{const i=new Image(),tm=setTimeout(()=>{i.src='';no(Error('timeout'))},ms);i.crossOrigin='anonymous';i.onload=()=>{clearTimeout(tm);ok(i)};i.onerror=()=>{clearTimeout(tm);no(Error('failed'))};i.src=url})}
async function mosaic(r,lat,lng){
 for(const z of [20,19,18]){
   try{
     const n=2**z,x=(lng+180)/360*n,y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n,cx=Math.floor(x),cy=Math.floor(y);
     const c=document.createElement('canvas');c.width=768;c.height=768;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
     let got=0;
     const jobs=[];
     for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
       const yy=cy+dy;if(yy<0||yy>=n)continue;const xx=((cx+dx)%n+n)%n;
       jobs.push(loadImage((r.itemURL||'').replace('{level}',z).replace('{row}',yy).replace('{col}',xx).replace(/\\{row\\}/g,yy).replace(/\\{col\\}/g,xx).replace(/\\{level\\}/g,z)).then(im=>({im,dx,dy})).catch(()=>null));
     }
     for(const q of (await Promise.all(jobs)).filter(Boolean)){ctx.drawImage(q.im,(q.dx+1)*256,(q.dy+1)*256,256,256);got++}
     if(got>=5){c.__aquaZoom=z;c.__aquaSourceSize=768;return c}
   }catch(e){}
 }
 throw Error('No high-resolution imagery available');
}
function brightWaterAnomaly(src){
 const ctx=src.getContext('2d'),w=src.width,h=src.height,d=ctx.getImageData(0,0,w,h).data;
 const mask=new Uint8Array(w*h);
 for(let y=64;y<h-64;y++)for(let x=64;x<w-64;x++){
   const i=(y*w+x)*4,r=d[i],g=d[i+1],b=d[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b),sat=mx?((mx-mn)/mx):0,lum=(r+g+b)/3;
   // Bright/neutral pixels are a useful first-pass signature for a white/light
   // vehicle against green/blue water. Keep the threshold conservative.
   if(lum>135 && sat<0.42 && mx-mn<75)mask[y*w+x]=1;
 }
 let best=null;
 for(let y=70;y<h-70;y+=3)for(let x=70;x<w-70;x+=3){
   if(!mask[y*w+x])continue;
   let minx=x,maxx=x,miny=y,maxy=y,n=0;
   for(let yy=Math.max(0,y-22);yy<=Math.min(h-1,y+22);yy+=2)for(let xx=Math.max(0,x-22);xx<=Math.min(w-1,x+22);xx+=2)if(mask[yy*w+xx]){n++;minx=Math.min(minx,xx);maxx=Math.max(maxx,xx);miny=Math.min(miny,yy);maxy=Math.max(maxy,yy)}
   const ww=maxx-minx+1,hh=maxy-miny+1,area=ww*hh,ratio=ww/Math.max(1,hh);
   if(n>=12&&area>=120&&area<=3000&&ratio>=1.2&&ratio<=5.5){
     const score=Math.min(100,Math.round(25+n*2.2+Math.min(30,area/60)));
     if(!best||score>best.score)best={score,x,y,width:ww,height:hh,pixels:n,zoom:src.__aquaZoom||18};
   }
 }
 return best;
}
async function install(){
 if(window.__aquaV22Installed)return;window.__aquaV22Installed=true;
 const old=window.vehicleScan;
 if(typeof old!=='function'||(!old.__v21&&typeof cocoSsd!=='undefined'&&(window.__aquaV22Tries=(window.__aquaV22Tries||0)+1)<30)){window.__aquaV22Installed=false;setTimeout(install,1000);return}
 const scan=async function(f,rs,silent){
   let baseBest=null;try{baseBest=await old.apply(this,arguments)}catch(e){}
   const use=(f?.isPinTest?rs:rs.filter((r,i)=>i===0||i===rs.length-1||/2018|2019/.test(String(r.date))).slice(0,8));
   const pts=targets(f),hits=[],visual=[];
   for(const r of use)for(const p of pts){
     try{
       if(window.paused)while(window.paused)await sleep(150);
       const m=await mosaic(r,p.lat,p.lng),a=brightWaterAnomaly(m);
       if(a){
         visual.push({...a,year:r.date,lat:p.lat,lng:p.lng,targetReason:p.why});
         hits.push({label:'visual anomaly',confidence:Math.min(.95,a.score/100),year:r.date,lat:p.lat,lng:p.lng,estimatedSizeFt:Math.round((a.width*0.44)*10)/10,sizeQualified:a.width*0.44>=15,highResolution:true,visualAnomaly:true,targetReason:p.why,zoom:a.zoom});
       }
       // COCO remains secondary evidence, not the gatekeeper.
       if(typeof cocoSsd!=='undefined'){
         if(!window.__aquaV22Model)window.__aquaV22Model=await cocoSsd.load({base:'mobilenet_v2'});
         for(const c of [m]){
           const ds=await window.__aquaV22Model.detect(c,20,.08);
           for(const d of ds)if(['car','truck','boat','bus','motorcycle'].includes(d.class)){
             const px=Math.max(d.bbox?.[2]||0,d.bbox?.[3]||0),mpp=(156543.03392*Math.cos(p.lat*Math.PI/180)/(2**(m.__aquaZoom||18))),ft=px*mpp*3.28084;
             if(ft>=6)hits.push({label:d.class,confidence:d.score,year:r.date,lat:p.lat,lng:p.lng,estimatedSizeFt:Math.round(ft*10)/10,sizeQualified:ft>=15,highResolution:true,targetReason:p.why,zoom:m.__aquaZoom});
           }
         }
       }
     }catch(e){}
     if(document.getElementById('scan'))document.getElementById('scan').textContent='V22 high-resolution object/anomaly scan: '+r.date;
   }
   const visualYears=new Set(visual.map(x=>x.year)).size;
   const visualBest=visual.slice().sort((a,b)=>b.score-a.score)[0]||null;
   const strong=hits.filter(h=>h.sizeQualified||h.visualAnomaly&&h.confidence>=.55);
   const years=new Set(strong.map(h=>h.year)).size;
   const best=strong.slice().sort((a,b)=>(b.visualAnomaly-a.visualAnomaly)||(b.confidence-a.confidence))[0]||baseBest;
   const score=Math.min(100,Math.round(Math.max(visualYears>=2?60:visualYears?35:0,(best?.confidence||0)*55)));
   f.veh=f.veh||{};f.veh.hits=[...(f.veh.hits||[]),...hits];f.veh.best=best||null;f.veh.model='V22 z20/z19 high-resolution + water-aware anomaly scan';f.veh.historicalReleasesWithHits=years;f.veh.highResolutionHits=strong.length;f.veh.visualAnomalies=visual.length;f.veh.visualYears=visualYears;
   f.objectScore=Math.max(Number(f.objectScore)||0,score);
   f.vehicleEvidence={score:f.objectScore,model:'V22 high-resolution visual anomaly + MobileNet secondary',temporalConsensus:years,visualAnomalies:visual.length,visualYears,exactPinHits:hits.filter(h=>Math.abs(h.lat-f.lat)<.0008&&Math.abs(h.lng-f.lng)<.001).length,sizeThresholdFt:15,highResolution:true,status:visualBest?'High-resolution visual anomaly detected in '+visualYears+' release(s) near the target. This is a candidate anomaly, not yet proof of a vehicle.':best?'Vehicle-class evidence found.':'No high-resolution object/anomaly evidence returned.'};
   if(visualBest&&f.isPinTest)f.label='HIGH';
   if(typeof window.aquaScoreFinding==='function')window.aquaScoreFinding(f);
   if(typeof window.render==='function')window.render();if(typeof window.redraw==='function')window.redraw();
   return best||baseBest;
 };
 scan.__v22=true;window.vehicleScan=scan;
 const logo=document.querySelector('.logo small');if(logo)logo.textContent='V22';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,3200));else setTimeout(install,3200);
window.addEventListener('load',()=>setTimeout(install,3400));
})();
