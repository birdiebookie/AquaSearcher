/* AquaSearcher V23 — Known-Car Recovery Benchmark
   Preserves the original V17 detector as an isolated benchmark.
   Ground truth: Moon Bay Circle submerged 1994 Saturn.
*/
(function(){
'use strict';
const MOON={lat:26.6249982,lng:-80.2276219};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function v17Patch(src,size){
  const c=document.createElement('canvas');c.width=512;c.height=512;
  const x=c.getContext('2d');x.imageSmoothingQuality='high';
  x.drawImage(src,Math.max(0,128-size/2),Math.max(0,128-size/2),size,size,0,0,512,512);
  c.__aquaSourceSize=size;return c;
}
function pts(lat,lng){
  const a=1/111320,z=1/(111320*Math.max(.2,Math.cos(lat*Math.PI/180))),o=[{lat,lng}];
  for(const m of [8,16,28,45])for(const [x,y] of [[1,0],[-1,0],[0,1],[0,-1]])
    o.push({lat:lat+x*m*a,lng:lng+y*m*z});
  return o.slice(0,13);
}
function pick12(rs){
  if(rs.length<=12)return rs.slice();
  const out=[],seen=new Set();
  for(let i=0;i<12;i++){const k=Math.round(i*(rs.length-1)/11);if(!seen.has(k)){seen.add(k);out.push(rs[k])}}
  return out;
}
async function v17Scan(rs){
  if(typeof cocoSsd==='undefined')throw Error('Vehicle detector library unavailable');
  const model=await cocoSsd.load({base:'mobilenet_v1'});
  const use=pick12(rs),ps=pts(MOON.lat,MOON.lng),hits=[];
  for(let i=0;i<use.length;i++){
    for(let j=0;j<ps.length;j++){
      try{
        $('scan').textContent='V17 KNOWN-CAR BENCHMARK: '+use[i].date+' · point '+(j+1)+'/13';
        const base=await img(tile(use[i],ps[j].lat,ps[j].lng,18));
        for(const c of [base,v17Patch(base,160),v17Patch(base,96)]){
          const ds=await model.detect(c,20,.15);
          ds.filter(o=>['car','truck','boat','bus','motorcycle'].includes(o.class))
            .forEach(o=>hits.push({label:o.class,confidence:o.score,year:use[i].date,lat:ps[j].lat,lng:ps[j].lng}));
        }
      }catch(e){}
    }
  }
  hits.sort((a,b)=>b.confidence-a.confidence);
  const strong=hits.filter(h=>h.confidence>=.25);
  const years=[...new Set(strong.map(h=>h.year))];
  return {hits,best:strong[0]||null,years,releaseDates:use.map(r=>r.date),points:ps.length,model:'V17 MobileNet v1 multi-scale'};
}
function report(v17,current){
  const best=v17.best;
  const html='<h2>🚗 KNOWN-CAR RECOVERY BENCHMARK</h2>'+
    '<p><b>Ground truth:</b> Moon Bay Circle, Wellington, FL — '+MOON.lat+', '+MOON.lng+'</p>'+
    '<p>This is a benchmark location where a submerged vehicle is known to be visible in historical Google Earth imagery. AquaSearcher imagery is labeled separately as Esri Wayback.</p>'+
    '<hr><h3>V17 detector</h3>'+
    '<p><b>Model:</b> MobileNet v1 multi-scale<br><b>Historical releases tested:</b> '+v17.releaseDates.length+
    '<br><b>Search points:</b> '+v17.points+'<br><b>Releases with vehicle-class hits:</b> '+v17.years.length+
    (best?'<br><b>Best hit:</b> '+best.label+' · '+Math.round(best.confidence*100)+'% · '+best.year:'<br><b>Result:</b> NO VEHICLE-CLASS HIT')+
    '</p>'+
    '<hr><h3>Current detector</h3>'+
    '<p>'+ (current?'Current V22/V23 detector returned <b>'+((current.best&&current.best.label)||'no vehicle-class hit')+
      '</b> with '+((current.historicalReleasesWithHits)||0)+' historical release(s) showing hits.':'Current detector result unavailable.')+'</p>'+
    '<p style="font-size:11px;color:#60717f"><b>Interpretation:</b> A failed detector result does not prove the car is absent from AquaSearcher imagery. The next question is whether the Esri Wayback image itself contains the car.</p>';
  showModal(html);
  $('scan').textContent=best?'BENCHMARK COMPLETE — V17 found vehicle-class evidence.':'BENCHMARK COMPLETE — V17 did not classify the known car.';
}
async function run(){
  try{
    setPin(MOON.lat,MOON.lng,true);
    $('from').value='1995';$('to').value='2024';$('depth').value='all';
    const rs=releases(await getCatalog());
    if(!rs.length)throw Error('No Esri Wayback releases available.');
    toast('Running the original V17 known-car detector at Moon Bay…');
    const v17=await v17Scan(rs);
    let current=null;
    try{
      const f={id:'moon-benchmark',name:'MOON BAY KNOWN CAR',ftype:'known submerged vehicle',lat:MOON.lat,lng:MOON.lng,
        priority:100,access:100,anomaly:0,isPinTest:true,samples:microSamples({lat:MOON.lat,lng:MOON.lng}),label:'TEST'};
      if(typeof window.vehicleScan==='function')current=await window.vehicleScan(f,rs,true);
      report(v17,f.veh||{best:current,historicalReleasesWithHits:0});
      $('loc').value=MOON.lat.toFixed(7)+', '+MOON.lng.toFixed(7);
    }catch(e){report(v17,null)}
  }catch(e){toast('Known-car benchmark failed: '+e.message);$('scan').textContent='KNOWN-CAR BENCHMARK ERROR: '+e.message}
}
window.runMoonBayBenchmark=run;
function install(){
  if(document.getElementById('knownCarBenchmarkBtn'))return;
  const host=document.querySelector('.detail > div:nth-child(2) > div:last-child');
  if(!host)return;
  const b=document.createElement('button');b.id='knownCarBenchmarkBtn';b.className='report';
  b.textContent='🚗 RUN MOON BAY BENCHMARK';
  b.onclick=run;host.appendChild(b);
}
function boot(){setTimeout(install,250);setTimeout(install,1500);setTimeout(install,3500)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();