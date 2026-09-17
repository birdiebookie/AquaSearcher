/* V16 bootstrap: expose the selected imagery releases to the access crawler. */
(function(){
'use strict';
const old=window.histScan;
if(typeof old==='function'&&!window.__v16HistCapture){
  window.__v16HistCapture=true;
  window.histScan=async function(f,releases,silent,fast){
    window.__aquaReleases=releases||[];
    return old.apply(this,arguments);
  };
}
})();
