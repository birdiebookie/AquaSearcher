/* AquaSearcher access gate — temporary pilot credentials.
   IMPORTANT: these credentials are intentionally client-side for the pilot.
   Replace with real server-side authentication before handling sensitive case data. */
(function(){
'use strict';
const USER='LAWENFORCEMENT';
const PASS='DIVETEAM';
const KEY='aquaLawEnforcementSession';
function css(){
  const s=document.createElement('style');
  s.textContent=`#aquaLoginGate{position:fixed;inset:0;background:linear-gradient(135deg,#061d2e,#0b3852);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,sans-serif}#aquaLoginBox{width:min(420px,94vw);background:#fff;border-radius:14px;padding:30px;box-shadow:0 15px 60px #0008;text-align:center}#aquaLoginBox .aquaLock{font-size:42px;margin-bottom:8px}#aquaLoginBox h1{margin:0;color:#06243a;font-size:25px}#aquaLoginBox .sub{color:#667784;font-size:12px;margin:7px 0 22px}#aquaLoginBox label{display:block;text-align:left;font-size:11px;font-weight:900;color:#536674;margin:12px 0 5px}#aquaLoginBox input{width:100%;padding:12px;border:1px solid #cbd9e3;border-radius:8px;font-size:16px;box-sizing:border-box;text-transform:uppercase}#aquaLoginBox button{width:100%;margin-top:18px;padding:13px;border:0;border-radius:8px;background:#168ee8;color:#fff;font-weight:900;font-size:15px;cursor:pointer}#aquaLoginError{display:none;color:#c62828;font-size:12px;font-weight:700;margin-top:12px}#aquaLoginBox .notice{font-size:10px;color:#8998a2;margin-top:18px;line-height:1.4}`;
  document.head.appendChild(s);
}
function show(){
  css();
  const gate=document.createElement('div');gate.id='aquaLoginGate';
  gate.innerHTML=`<div id="aquaLoginBox"><div class="aquaLock">🔒</div><h1>AQUASEARCHER</h1><div class="sub">AQUASEARCHER PILOT ACCESS</div><form id="aquaLoginForm"><label>USER NAME</label><input id="aquaLoginUser" autocomplete="username" autocapitalize="characters" spellcheck="false" required><label>PASSWORD</label><input id="aquaLoginPass" type="password" autocomplete="current-password" required><button type="submit">ENTER AQUASEARCHER</button><div id="aquaLoginError">Incorrect user name or password.</div></form><div class="notice">Authorized use only. AquaSearcher results are investigative screening evidence and should be independently verified.</div></div>`;
  document.body.appendChild(gate);
  const form=document.getElementById('aquaLoginForm');
  form.addEventListener('submit',e=>{e.preventDefault();const u=document.getElementById('aquaLoginUser').value.trim().toUpperCase();const p=document.getElementById('aquaLoginPass').value;if(u===USER&&p===PASS){sessionStorage.setItem(KEY,'1');gate.remove();document.getElementById('aquaLoginUser')?.blur()}else{const er=document.getElementById('aquaLoginError');er.style.display='block';document.getElementById('aquaLoginPass').value='';document.getElementById('aquaLoginPass').focus()}});
  setTimeout(()=>document.getElementById('aquaLoginUser')?.focus(),50);
}
function init(){if(sessionStorage.getItem(KEY)==='1')return;show()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
