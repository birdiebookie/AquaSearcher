/* AquaSearcher V16.4 investigator links.
   Any finding at priority >= 60 gets exact coordinates and a one-click
   Google Earth Web link so an investigator/diver can go directly to it. */
(function(){
'use strict';
const THRESHOLD=60;
function earthUrl(lat,lng){return `https://earth.google.com/web/search/${encodeURIComponent(lat+','+lng)}/`}
function validPoint(f){return f&&Number.isFinite(+f.lat)&&Number.isFinite(+(f.lng??f.lon))}
function addLink(card,f){
  if(!card||!validPoint(f)||(+f.priority||0)<THRESHOLD)return;
  if(card.querySelector('[data-earth-link]'))return;
  const lat=+f.lat,lng=+(f.lng??f.lon);
  const box=document.createElement('div');
  box.dataset.earthLink='1';
  box.style.cssText='margin-top:8px;padding-top:7px;border-top:1px solid #d7e2ea;display:flex;align-items:center;gap:8px;flex-wrap:wrap';
  const changeYear=f?.hist?.changeEstablished&&f?.hist?.changeYear?String(f.hist.changeYear):'';
  box.innerHTML=`<div style="width:100%;padding:8px;background:#fff4bf;border:2px solid #eab308;border-radius:7px"><div style="font-size:10px;font-weight:900;color:#765b00;letter-spacing:.4px">🚨 YEAR OF CHANGE DETECTED</div><div style="font-size:24px;font-weight:900;color:#06243a;line-height:1.05">${changeYear}</div><div style="font-size:10px;font-weight:900;color:#765b00;margin-top:4px">New localized anomaly detected in the later release.</div></div><span style="font-size:11px;font-weight:900;color:#284b5e">📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}</span><a href="${earthUrl(lat,lng)}" target="_blank" rel="noopener noreferrer" style="font-size:11px;font-weight:900;color:#168ee8;text-decoration:none">🌎 OPEN IN GOOGLE EARTH ↗</a>`;
  card.appendChild(box);
}
function candidates(){
  const a=Array.isArray(window.__aquaFindings)?window.__aquaFindings:[];
  const b=Array.isArray(window.__aquaV16Access)?window.__aquaV16Access:[];
  return a.concat(b).filter(validPoint).filter(f=>(+f.priority||0)>=THRESHOLD);
}
function decorate(){
  const cs=[...document.querySelectorAll('#cards .card')];
  const fs=candidates();
  if(!cs.length||!fs.length)return;
  const used=new Set();
  for(const card of cs){
    if(card.querySelector('[data-earth-link]'))continue;
    const directId=card.dataset.findingId||card.getAttribute('data-finding-id');
    let f=directId?fs.find(x=>String(x.id)===String(directId)):null;
    if(!f){
      const text=(card.innerText||'').toLowerCase();
      const score=(text.match(/(?:priority|score)\s*(?:[: ]\s*)?(\d+)\s*\/\s*100/i)||[])[1];
      f=fs.find(x=>!used.has(x)&&x.name&&text.includes(String(x.name).toLowerCase().replace(/^🚤\s*/,''))&&(!score||+x.priority===+score));
      if(!f&&score)f=fs.find(x=>!used.has(x)&&+x.priority===+score);
      if(!f)f=fs.find(x=>!used.has(x));
    }
    if(f){used.add(f);addLink(card,f)}
  }
}
function install(){
  if(window.__aquaInvestigatorLinks)return;
  window.__aquaInvestigatorLinks=true;
  const wrap=()=>{
    if(typeof window.render==='function'&&!window.render.__aquaWrapped){
      const original=window.render;
      const w=function(){const r=original.apply(this,arguments);setTimeout(decorate,0);return r};
      w.__aquaWrapped=true;
      window.render=w;
    }
    decorate();
  };
  wrap();
  setInterval(wrap,500);
  new MutationObserver(()=>decorate()).observe(document.getElementById('cards')||document.body,{childList:true,subtree:true});
}
window.addEventListener('load',()=>setTimeout(install,50));
setTimeout(install,250);
})();
