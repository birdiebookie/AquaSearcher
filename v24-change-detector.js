/* AquaSearcher V24 - change-over-time detector.
   Finds car-sized spots in water that APPEAR or DISAPPEAR between photos
   and then STAY that way in later photos. Optional "missing since" year. */
(function(){
'use strict';
let Z=19;
async function get(u){try{return await img(u)}catch(e){return null}}
function mpp(lat,z){return 156543.03392*Math.cos(lat*Math.PI/180)/2**z}
function txy(lat,lng,z){const n=2**z;return{x:(lng+180)/360*n,y:(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n}}
function toLL(X,Y,z){const n=2**z;return{lat:Math.atan(Math.sinh(Math.PI*(1-2*Y/n)))*180/Math.PI,lng:X/n*360-180}}
function url(r,z,x,y){return(r.itemURL||'').replace('{level}',z).replace('{row}',y).replace('{col}',x)}
function pin(){const p=window.__aquaPinTest;if(p&&isFinite(+p.lat))return{lat:+p.lat,lng:+p.lng};const m=String($('loc').value).match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);return m?{lat:+m[1],lng:+m[2]}:null}
function sig(c){const d=c.getContext('2d').getImageData(0,0,256,256).data,s=[];for(let y=0;y<256;y+=16)for(let x=0;x<256;x+=16){const i=(y*256+x)*4;s.push(d[i]+d[i+1]+d[i+2])}return s}
function same(a,b){let t=0;for(let i=0;i<a.length;i++)t+=Math.abs(a[i]-b[i]);return t/a.length<6}
async function frame(r,cx,cy,center,OM){
  const c=document.createElement('canvas');c.width=c.height=768;const g=c.getContext('2d');
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const t=(dx||dy)?await get(url(r,Z,cx+dx,cy+dy)):center;
    if(t)g.drawImage(t,(dx+1)*256,(dy+1)*256);
  }
  const d=g.getImageData(0,0,768,768).data,N=768*768,G=new Int16Array(N),W=new Uint8Array(N),wl=[];
  for(let p=0,i=0;p<N;p++,i+=4){const r0=d[i],g0=d[i+1],b0=d[i+2],l=(r0+g0+b0)/3;G[p]=l;
    if(l>8&&l<125&&g0+b0>=2*r0-10&&Math.max(r0,g0,b0)-Math.min(r0,g0,b0)<80){W[p]=1;if(p%5===0)wl.push(l)}}
  for(let p=0;p<N-1540;p++)if(W[p]&&Math.abs(G[p]-G[p+2])+Math.abs(G[p]-G[p+1536])>14)W[p]=0;
  if(OM){wl.length=0;for(let p=0;p<N;p++){W[p]=OM[p];if(OM[p]&&p%5===0)wl.push(G[p])}}
  wl.sort((a,b)=>a-b);const med=wl.length?wl[wl.length>>1]:100;
  for(let p=0;p<N;p++)G[p]-=med;
  return{r,G,W,water:wl.length};
}
function blobs(A,B,m,SW,NW){
  const N=768*768,on=new Uint8Array(N),seen=new Uint8Array(N),out=[];
  for(let y=20;y<748;y++)for(let x=20;x<748;x++){const p=y*768+x;if(NW[p]&&Math.abs(B.G[p]-A.G[p])>20)on[p]=1}
  for(let s=0;s<N;s++){if(!on[s]||seen[s])continue;
    const q=[s];seen[s]=1;let n=0,x0=768,x1=0,y0=768,y1=0;
    while(q.length){const p=q.pop(),x=p%768,y=(p/768)|0;n++;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
      for(const o of[1,-1,768,-768]){const k=p+o;if(k>=0&&k<N&&on[k]&&!seen[k]){seen[k]=1;q.push(k)}}}
    const L=Math.max(x1-x0+1,y1-y0+1)*m*3.281,Wd=Math.min(x1-x0+1,y1-y0+1)*m*3.281,fill=n/((x1-x0+1)*(y1-y0+1));
    if(L<9||L>26||Wd<3.5||Wd>12||fill<.35)continue;
    const cx=(x0+x1)>>1,cy=(y0+y1)>>1,ring=[[cx,y0-12],[cx,y1+12],[x0-12,cy],[x1+12,cy]].filter(([a,b])=>a>=0&&b>=0&&a<768&&b<768&&SW[b*768+a]).length;
    if(ring<2)continue;
    out.push({x0,x1,y0,y1,cx,cy,L,Wd});
  }
  return out;
}
function stableWater(frames){
  const N=768*768,cnt=new Uint8Array(N),need=Math.max(2,Math.ceil(frames.length*.6)),S=new Uint8Array(N),SW=new Uint8Array(N),seen=new Uint8Array(N);
  for(const F of frames)for(let p=0;p<N;p++)cnt[p]+=F.W[p];
  for(let p=0;p<N;p++)S[p]=cnt[p]>=need?1:0;
  for(let s=0;s<N;s++){if(!S[s]||seen[s])continue;const q=[s],comp=[];seen[s]=1;
    while(q.length){const p=q.pop();comp.push(p);for(const o of[1,-1,768,-768]){const k=p+o;if(k>=0&&k<N&&S[k]&&!seen[k]){seen[k]=1;q.push(k)}}}
    if(comp.length>=3000)for(const p of comp)SW[p]=1}
  return{SW,NW:dilate(SW)};
}
function dilate(SW){
  const N=768*768,H=new Uint8Array(N),NW=new Uint8Array(N);
  for(let y=0;y<768;y++){let run=-99;for(let x=0;x<768;x++){if(SW[y*768+x])run=x;if(x-run<=10)H[y*768+x]=1}run=999;for(let x=767;x>=0;x--){if(SW[y*768+x])run=x;if(run-x<=10)H[y*768+x]=1}}
  for(let x=0;x<768;x++){let run=-99;for(let y=0;y<768;y++){if(H[y*768+x])run=y;if(y-run<=10)NW[y*768+x]=1}run=999;for(let y=767;y>=0;y--){if(H[y*768+x])run=y;if(run-y<=10)NW[y*768+x]=1}}
  return NW;
}
async function osmWater(cx,cy,m){
  try{
    const a=toLL(cx-1,cy-1,Z),b=toLL(cx+2,cy+2,Z),bb='('+b.lat+','+a.lng+','+a.lat+','+b.lng+')';
    const j=await overpass('[out:json][timeout:25];(way["natural"="water"]'+bb+';relation["natural"="water"]'+bb+';way["landuse"="reservoir"]'+bb+';way["waterway"~"canal|river|stream|ditch|drain"]'+bb+';);out geom;');
    const c=document.createElement('canvas');c.width=c.height=768;const g=c.getContext('2d');g.fillStyle=g.strokeStyle='#fff';
    const P=q=>{const t=txy(q.lat,q.lon,Z);return[(t.x-cx+1)*256,(t.y-cy+1)*256]};
    const path=pts=>pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));
    for(const e of j.elements||[]){
      if(e.type==='way'&&e.geometry){g.beginPath();path(e.geometry.map(P));if(e.tags&&e.tags.waterway){g.lineWidth=Math.max(3,8/m);g.stroke()}else{g.closePath();g.fill()}}
      if(e.type==='relation'&&e.members){g.beginPath();for(const mm of e.members)if(mm.geometry){path(mm.geometry.map(P));g.closePath()}g.fill('evenodd')}
    }
    const d=g.getImageData(0,0,768,768).data,M=new Uint8Array(768*768);let n=0;
    for(let p=0;p<M.length;p++)if(d[p*4+3]>128){M[p]=1;n++}
    return n>2000?M:null;
  }catch(e){return null}
}
function strength(F,b,ox=0,oy=0){let t=0,n=0;for(let y=b.y0+oy;y<=b.y1+oy;y++)for(let x=b.x0+ox;x<=b.x1+ox;x++){if(x<0||y<0||x>767||y>767)continue;t+=Math.abs(F.G[y*768+x]);n++}return n?t/n:0}
function shifted(F,b,target){for(const ox of[-6,0,6])for(const oy of[-6,0,6])if((ox||oy)&&strength(F,b,ox,oy)>=target*.6)return true;return false}
async function crop(F,b,cx,cy){const c=document.createElement('canvas');c.width=c.height=150;const g=c.getContext('2d');for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const t=await get(url(F.r,Z,cx+dx,cy+dy));if(t)g.drawImage(t,((dx+1)*256-b.cx+60)*1.25,((dy+1)*256-b.cy+60)*1.25,320,320)}
  try{return c.toDataURL('image/jpeg',.8)}catch(e){return''}}
async function run(){
  const p=pin();if(!p){toast('Set a pin or location first.');return}
  const since=parseInt($('v24since').value)||null;
  try{
    const rs=(await getCatalog()).slice();Z=19;const t9=txy(p.lat,p.lng,19);if(!await get(url(rs[rs.length-1],19,Math.floor(t9.x),Math.floor(t9.y))))Z=18;
    const t=txy(p.lat,p.lng,Z),cx=Math.floor(t.x),cy=Math.floor(t.y),m=mpp(p.lat,Z),frames=[];let last=null;
    $('scan').textContent='V24 CHANGE CHECK: loading mapped water from OpenStreetMap…';
    const OM=await osmWater(cx,cy,m);
    for(let i=0;i<rs.length;i++){
      $('scan').textContent='V24 CHANGE CHECK: photo '+(i+1)+'/'+rs.length+' · '+frames.length+' different photos found';
      const c=await get(url(rs[i],Z,cx,cy));if(!c)continue;
      const s=sig(c);if(last&&same(s,last.s)){last.to=rs[i].date;continue}
      const F=await frame(rs[i],cx,cy,c,OM);F.s=s;F.date=rs[i].date;F.to=rs[i].date;frames.push(F);last=F;
    }
    const ev=[],{SW,NW}=OM?{SW:OM,NW:dilate(OM)}:stableWater(frames);
    let wp=0;for(let q=0;q<SW.length;q++)wp+=SW[q];
    for(let i=1;i<frames.length;i++){const A=frames[i-1],B=frames[i];if(A.water<200||B.water<200)continue;
      for(const b of blobs(A,B,m,SW,NW)){
        const sa=strength(A,b),sb=strength(B,b),type=sb>sa?'APPEARED':'DISAPPEARED';
        if(type==='APPEARED'?shifted(A,b,sb):shifted(B,b,sa))continue;
        let keep=0;
        if(type==='APPEARED'){for(let j=i+1;j<frames.length;j++)if(strength(frames[j],b)>Math.max(18,sa+12))keep++;else break}
        else{for(let j=i-2;j>=0;j--)if(strength(frames[j],b)>Math.max(18,sb+12))keep++;else break}
        const y=+String(B.date).slice(0,4),near=since&&Math.abs(y-since)<=3;
        const score=Math.min(100,Math.round(25+keep*15+Math.abs(sb-sa)/2+(near?20:0)));
        const ll=toLL(cx-1+b.cx/256,cy-1+b.cy/256,Z);
        ev.push({type,before:A.to,after:B.date,keep,score,near,L:b.L,Wd:b.Wd,lat:ll.lat,lng:ll.lng,A,B,b});
      }}
    ev.sort((a,b)=>b.score-a.score);
    const top=(ev.some(e=>e.keep>=1)?ev.filter(e=>e.keep>=1):ev).slice(0,6);
    for(const e of top){e.ia=await crop(e.A,e.b,cx,cy);e.ib=await crop(e.B,e.b,cx,cy)}
    let h='<h2>🔎 V24 CHANGE-OVER-TIME CHECK</h2><p><b>Spot:</b> '+p.lat.toFixed(6)+', '+p.lng.toFixed(6)+'<br><b>Photo dates checked:</b> '+rs.length+' · <b>Truly different photos:</b> '+frames.length+'<br><b>Raw changes found:</b> '+ev.length+' · <b>Changes that stayed put:</b> '+ev.filter(e=>e.keep>=1).length+(since?'<br><b>Missing since:</b> '+since:'')+'<br><b>Water used:</b> '+(OM?'OpenStreetMap water map':'photo colors (no OSM water found)')+' · '+Math.round(wp*100/SW.length)+'% of the view'+'<br><b>The different photos:</b> '+frames.map((F,i)=>(i+1)+') '+F.date+(F.to!==F.date?' → '+F.to:'')).join(' · ')+'</p>';
    h+=top.length?top.map((e,i)=>'<hr><p><b>#'+(i+1)+' '+e.type+'</b> · score '+e.score+'/100'+(e.near?' · ⭐ near missing date':'')+'<br>Between <b>'+e.before+'</b> and <b>'+e.after+'</b> · '+(e.type==='APPEARED'?'stayed for '+e.keep+' later':'was there in '+e.keep+' earlier')+' photo(s) · about '+Math.round(e.L)+' × '+Math.round(e.Wd)+' ft<br>'+e.lat.toFixed(6)+', '+e.lng.toFixed(6)+'</p><div style="display:flex;gap:8px"><div><small>BEFORE</small><br><img src="'+e.ia+'"></div><div><small>AFTER</small><br><img src="'+e.ib+'"></div></div>').join(''):'<p><b>No car-sized change that stayed put was found.</b> This does not prove no car is there: deep or murky water can hide one.</p>';
    h+=await strip(frames,cx,cy,t);showModal(h);$('scan').textContent='V24 CHANGE CHECK COMPLETE — '+top.length+' lasting change(s).';
  }catch(e){toast('V24 change check failed: '+e.message);$('scan').textContent='V24 ERROR: '+e.message}
}
window.runV24ChangeCheck=run;
async function strip(frames,cx,cy,t){const out=[];for(const F of frames){const c=document.createElement('canvas');c.width=c.height=180;const g=c.getContext('2d'),px=(t.x-cx+1)*256,py=(t.y-cy+1)*256,k=180/240;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const im=await get(url(F.r,Z,cx+dx,cy+dy));if(im)g.drawImage(im,((dx+1)*256-px+120)*k,((dy+1)*256-py+120)*k,256*k,256*k)}g.strokeStyle='red';g.lineWidth=2;g.strokeRect(80,80,20,20);let s='';try{s=c.toDataURL('image/jpeg',.85)}catch(e){}out.push('<div><small>'+F.date+'</small><br><img src="'+s+'"></div>')}return'<hr><p><b>Photo strip at your pin</b> (red box = pin). Can you see the car in any of these?</p><div style="display:flex;flex-wrap:wrap;gap:6px">'+out.join('')+'</div>'}
function install(){
  if($('v24btn'))return;const host=document.querySelector('.detail > div:nth-child(2) > div:last-child');if(!host)return;
  const i=document.createElement('input');i.id='v24since';i.placeholder='Missing since year (optional)';i.style.cssText='width:100%;padding:8px;margin:4px 0;border-radius:6px;border:1px solid #9ab';
  const b=document.createElement('button');b.id='v24btn';b.className='report';b.textContent='🔎 RUN CHANGE CHECK (V24)';b.onclick=run;
  host.appendChild(i);host.appendChild(b);
}
function boot(){setTimeout(install,400);setTimeout(install,2000);setTimeout(install,4000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
