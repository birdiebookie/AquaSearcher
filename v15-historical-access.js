/* AquaSearcher V15 — historical access evidence layer. */
(function(){
'use strict';
const $=id=>document.getElementById(id), sleep=ms=>new Promise(r=>setTimeout(r,ms));
function stats(canvas){
 const c=canvas.getContext('2d',{willReadFrequently:true});if(!c)return null;
 const w=canvas.width,h=canvas.height,d=c.getImageData(0,0,w,h).data;let sum=0,sum2=0,edges=0,n=0;
 for(let y=2;y<h-2;y+=3)for(let x=2;x<w-2;x+=3){const i=(y*w+x)*4,lum=.299*d[i]+.587*d[i+1]+.114*d[i+2];const a=(y-2)*w+x,b=(y+2)*w+x,u=y*w+x-2,v=y*w+x+2;const lv=.299*d[a*4]+.587*d[a*4+1]+.114*d[a*4+2],rv=.299*d[b*4]+.587*d[b*4+1]+.114*d[b*4+2],uv=.299*d[u*4]+.587*d[u*4+1]+.114*d[u*4+2],dv=.299*d[v*4]+.587*d[v*4+1]+.114*d[v*4+2];sum+=lum;sum2+=lum*lum;if(Math.abs(lv-rv)+Math.abs(uv-dv)>55)edges++;n++}
 const mean=sum/n,variance=Math.max(0,sum2/n-mean*mean);return{mean,texture:Math.min(100,Math.round(Math.sqrt(variance))),edge:Math.min(100,Math.round(edges/n*420))};
}
async function scan(f,releases){
 if(!f||!releases?.length||typeof window.tile!=='function'||typeof window.img!=='function')return null;
 const lat=+f.lat,lng=+f.lng;if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
 const rs=releases.length<=8?releases:[releases[0],releases[Math.floor(releases.length*.2)],releases[Math.floor(releases.length*.4)],releases[Math.floor(releases.length*.6)],releases[Math.floor(releases.length*.8)],releases[releases.length-1]];
 const newest=rs[rs.length-1],points=[];
 for(const m of [35,70,110,150])for(let bearing=0;bearing<360;bearing+=45){const r=bearing*Math.PI/180;points.push({lat:lat+m*Math.cos(r)/111320,lng:lng+m*Math.sin(r)/(111320*Math.max(.2,Math.cos(lat*Math.PI/180))),bearing,m});}
 const rows=[];
 for(let ri=0;ri<rs.length;ri++){const rel=rs[ri];if($('scan'))$('scan').textContent=`Historical access screening: ${rel.date} · ${ri+1}/${rs.length}`;for(const p of points)try{const s=stats(await window.img(window.tile(rel,p.lat,p.lng,18)));if(s)rows.push({date:rel.date,bearing:p.bearing,m:p.m,score:Math.min(100,Math.round(s.edge*.65+s.texture*.35+(s.mean>70&&s.mean<205?20:0))),stats:s});}catch(e){}}
 const dirs=[];for(let bearing=0;bearing<360;bearing+=45){const a=rows.filter(x=>x.bearing===bearing),old=a.filter(x=>x.date!==newest.date),recent=a.filter(x=>x.date===newest.date).reduce((v,x)=>Math.max(v,x.score),0);if(!old.length)continue;const top=old.sort((x,y)=>y.score-x.score).slice(0,3),oldAvg=top.reduce((v,x)=>v+x.score,0)/top.length,score=Math.round(Math.max(0,Math.min(100,oldAvg-recent*.55)));if(score>=18)dirs.push({bearing,score,oldPeak:Math.round(oldAvg),recentPeak:recent,periods:top.map(x=>x.date)});}
 dirs.sort((a,b)=>b.score-a.score);const repeated=new Set(dirs.flatMap(x=>x.periods||[])).size,best=dirs[0]||null;
 f.histAccess={scannedReleases:rs.map(x=>x.date),sampleCount:rows.length,candidates:dirs.slice(0,8),best,historicalPeriods:repeated,score:best?Math.min(100,Math.round(best.score+Math.min(25,repeated*5))):0,status:best?'Possible historical access signature detected — review imagery':'No strong historical access signature detected by automated screening',note:'This searches historical imagery for possible former approach corridors and ramp-like access. It cannot prove a road or ramp; vegetation, shadows, water level, image quality and shoreline change can hide access.'};
 const oldAccess=f.access||0,a=f.histAccess.score||0;f.access=Math.round(Math.min(100,a*.65+oldAccess*.35));f.priority=Math.round((f.anomaly||0)*.55+f.access*.45);f.label=f.priority>=80?'HIGH':f.priority>=55?'MEDIUM':'LOW';return f.histAccess;
}
const oldHist=window.histScan;
if(typeof oldHist==='function')window.histScan=async function(f,rs,silent,fast){const out=await oldHist(f,rs,silent,fast);try{await scan(f,rs||[])}catch(e){console.error('V15 historical access',e)}if(typeof window.render==='function')window.render();return out;};
const oldShow=window.showCandidate;
if(typeof oldShow==='function')window.showCandidate=function(f){oldShow(f);const d=$('detailText');if(!d||!f.histAccess)return;d.textContent=(d.textContent||'')+` Historical access ${f.histAccess.score}/100 — ${f.histAccess.status}. ${f.histAccess.historicalPeriods} historical period(s) showed possible directional evidence.`;};
window.addEventListener('load',()=>{const s=document.querySelector('.logo small');if(s)s.textContent='V15';const h=document.querySelector('header');if(h&&!document.getElementById('v15badge')){const b=document.createElement('span');b.id='v15badge';b.textContent='Historical access layer active';b.style.cssText='font-size:10px;color:#b9e7ff;margin-left:8px;opacity:.9';h.appendChild(b)}const r=$('access');if(r)r.parentElement.innerHTML='<input id="access" type="checkbox" checked>Analyze current AND historical access points';});
})();
