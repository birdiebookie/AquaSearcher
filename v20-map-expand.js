/* V20 map expand/shrink control
   Restores the map enlarge/shrink arrows and keeps the search-pin popup
   from covering the map controls.
*/
(function(){
  function install(){
    try{
      if(window.__aquaV20MapControlInstalled) return;
      const map=window.__aquaMap || window.map;
      const wrap=document.querySelector('.mapwrap');
      if(!map || !wrap || !window.L) return;
      window.__aquaV20MapControlInstalled=true;

      const Control=L.Control.extend({
        options:{position:'topright'},
        onAdd:function(){
          const box=L.DomUtil.create('div','leaflet-bar aqua-map-size-control');
          const btn=L.DomUtil.create('a','aqua-map-size-btn',box);
          btn.href='#';
          btn.title='Enlarge map';
          btn.setAttribute('aria-label','Enlarge map');
          btn.innerHTML='↗';
          L.DomEvent.disableClickPropagation(box);
          L.DomEvent.on(btn,'click',function(e){
            L.DomEvent.stop(e);
            const expanded=wrap.classList.toggle('aqua-map-expanded');
            document.body.classList.toggle('aqua-map-expanded-body',expanded);
            btn.innerHTML=expanded?'↙':'↗';
            btn.title=expanded?'Shrink map':'Enlarge map';
            btn.setAttribute('aria-label',expanded?'Shrink map':'Enlarge map');
            setTimeout(function(){ map.invalidateSize(); },80);
          });
          return box;
        }
      });

      const style=document.createElement('style');
      style.textContent=
        '.aqua-map-size-control{margin-top:10px;margin-right:10px}'+
        '.aqua-map-size-btn{width:34px!important;height:34px!important;line-height:32px!important;text-align:center;font-size:22px;font-weight:900;text-decoration:none!important;background:#fff;color:#06243a!important;display:block}'+
        '.aqua-map-expanded{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2500!important}'+
        '.aqua-map-expanded-body{overflow:hidden!important}'+
        '.aqua-map-expanded .aqua-map-size-control{z-index:5000}';
      document.head.appendChild(style);
      new Control().addTo(map);

      // Safety: never leave the instructional pin popup sitting over the map controls.
      document.addEventListener('click',function(){
        try{
          const pin=window.pin;
          if(pin && pin.isPopupOpen && pin.isPopupOpen()) pin.closePopup();
        }catch(e){}
      },{passive:true});
    }catch(e){ console.warn('AquaSearcher V20 map control',e); }
  }
  let tries=0;
  const timer=setInterval(function(){
    tries++;
    install();
    if(window.__aquaV20MapControlInstalled || tries>40) clearInterval(timer);
  },250);
})();
