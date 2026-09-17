/* V16 map hook: capture the existing Leaflet map before AquaSearcher uses it. */
(function(){
  try{
    if(!window.L || !window.L.Map || window.__aquaMapHooked) return;
    window.__aquaMapHooked=true;
    window.__aquaMaps=[];
    window.L.Map.addInitHook(function(){
      window.__aquaMaps.push(this);
      window.__aquaMap=this;
    });
  }catch(e){ console.warn('AquaSearcher map hook',e); }
})();
