/* OTGG October returning-visitor enquiry panel. Runs only with analytics + personalisation consent. */
(function(){
'use strict';
var CAMPAIGN='RETURNING_VISITOR_HELP';
var END=Date.parse('2026-11-01T00:00:00Z');
var GAP=30*60*1000;
var STORAGE={last:'otgg_help_last_active_v1',visit:'otgg_help_visit_id_v1',shown:'otgg_help_show_count_v1',session:'otgg_help_shown_visit_v1',dismissed:'otgg_help_dismissed_v1',done:'otgg_help_submitted_v1'};
var activeVisit='',panel=null,timer=null,loading=false,started=false,impressionId='',eligibilityToken='',inFlight=false,everVisitedThisPage=false;
function get(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function set(k,v){try{localStorage.setItem(k,String(v));}catch(e){}}
function allowed(){try{var c=window.OTGGConsent&&window.OTGGConsent.getChoice();return !!(c&&c.analytics&&c.personalisation);}catch(e){return false;}}
function path(){return (location.pathname||'/').toLowerCase().replace(/\.html$/,'').replace(/\/$/,'')||'/';}
function excluded(){var p=path();return p==='/booking'||p==='/check-date'||p==='/booking-confirmed'||p==='/additional-details'||p.indexOf('/payment')===0||p.indexOf('/balance')===0||p==='/pay-balance';}
function nowOK(){return Date.now()<END&&allowed()&&!excluded()&&!get(STORAGE.dismissed)&&!get(STORAGE.done)&&Number(get(STORAGE.shown)||0)<2;}
function uuid(){if(crypto&&typeof crypto.randomUUID==='function')return crypto.randomUUID();return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var n=Math.random()*16|0;return (c==='x'?n:(n&3|8)).toString(16);});}
function report(type,detail){
 if(!impressionId||!allowed())return;
 try{fetch('/.netlify/functions/track-returning-offer',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',keepalive:true,body:JSON.stringify({impressionId:impressionId,offerCode:CAMPAIGN,eventType:type,eventDetail:detail||null,pagePath:path()})}).catch(function(){});}catch(e){}
}
function identity(){
 try{var visitor=get('otgg_analytics_visitor_v1');var raw=JSON.parse(get('otgg_analytics_session_v1')||'null');
  if(!visitor||!raw||!raw.id)return null;return {visitorId:visitor,sessionId:raw.id,lastActivity:Number(raw.lastActivity)||0};
 }catch(e){return null;}
}
function isNewVisit(time){
 var old=Number(get(STORAGE.last)||0);
 return !old||time-old>=GAP;
}
function clearTimer(){if(timer){clearTimeout(timer);timer=null;}}
function hide(){
 clearTimer();if(panel&&panel.parentNode)panel.parentNode.removeChild(panel);panel=null;
 document.body.classList.remove('otgg-help-open');
}
function trackActivity(){
 if(!allowed()||document.visibilityState==='hidden')return;
 var t=Date.now(),last=Number(get(STORAGE.last)||0);
 if(last&&t-last>=GAP){activate(true);return;}
 if(t-last>30000)set(STORAGE.last,t);
}
function initVisit(force){
 if(!nowOK())return false;
 var t=Date.now(),fresh=isNewVisit(t);
 if(!activeVisit||fresh){activeVisit=fresh?uuid():(get(STORAGE.visit)||uuid());set(STORAGE.visit,activeVisit);}
 set(STORAGE.last,t);
 return fresh;
}
function styles(){
 if(document.getElementById('otgg-help-style'))return;
 var css=document.createElement('style');css.id='otgg-help-style';
 css.textContent=[
 '.otgg-help{position:fixed;right:19px;bottom:19px;z-index:9000;width:min(390px,calc(100vw - 24px));height:388px;max-height:calc(100dvh - 32px);box-sizing:border-box;border:1px solid #e0e0d8;border-radius:18px;background:#fffefa;color:#1e4734;box-shadow:0 15px 46px rgba(17,45,31,.23);padding:18px;display:flex;flex-direction:column;gap:10px;overflow:hidden;animation:otggHelpIn .22s ease both;font-family:Inter,Arial,sans-serif}',
 '@keyframes otggHelpIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}',
 '.otgg-help *{box-sizing:border-box}', '.otgg-help button,.otgg-help input,.otgg-help textarea{font:inherit}',
 '.otgg-help__top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-shrink:0}',
 '.otgg-help__brand{font-size:11px;font-weight:700;letter-spacing:.08em;color:#1e4734}',
 '.otgg-help__close{border:0;background:none;color:#586e61;font-size:22px;cursor:pointer;padding:3px 6px;line-height:1}',
 '.otgg-help__body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}',
 '.otgg-help__title{font-family:Georgia,"Times New Roman",serif;font-size:28px;line-height:1.12;color:#1e4734;margin:4px 0 10px}',
 '.otgg-help__copy{margin:0;color:#59695e;font-size:14px;line-height:1.5}',
 '.otgg-help__offer{margin:14px 0 0;border:1px solid #e9d9b3;border-radius:9px;background:#f5ebd3;padding:11px 10px;font-size:11px;line-height:1.35;font-weight:700;letter-spacing:.015em;text-align:center;color:#806022}',
 '.otgg-help__actions{display:flex;flex-direction:column;gap:8px;flex-shrink:0}',
 '.otgg-help__button{display:flex;align-items:center;justify-content:center;min-height:39px;width:100%;border-radius:9px;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer;padding:8px 12px}',
 '.otgg-help__primary{background:#1e4734;border:1px solid #1e4734;color:#fff!important}',
 '.otgg-help__secondary{border:1px solid #1e4734;background:transparent;color:#1e4734!important}',
 '.otgg-help__back{border:0;background:transparent;color:#1e4734;font-size:13px;font-weight:600;padding:0 0 7px;cursor:pointer}',
 '.otgg-help__label{display:block;font-size:12px;font-weight:600;color:#1e4734;margin:8px 0 4px}',
 '.otgg-help__input{width:100%;border:1px solid #c4d0c5;border-radius:8px;background:white;color:#1e4734;padding:9px;font-size:16px!important;min-height:36px}',
 '.otgg-help__textarea{min-height:70px;resize:vertical;max-height:130px;font-size:16px!important}',
 '.otgg-help__error{color:#9a2929;font-size:12px;margin:7px 0 0}',
 '.otgg-help__note{color:#647368;font-size:11px;line-height:1.35;margin:7px 0 0}',
 '.otgg-help__honeypot{display:none!important}',
 '.otgg-help__top{min-height:44px}',
 '@media(max-width:600px){body.otgg-help-open{overflow:hidden}.otgg-help{inset:0;z-index:10030;width:100%;height:100vh;height:100dvh;max-height:none;min-height:0;border:0;border-radius:0;box-shadow:none;padding:calc(15px + env(safe-area-inset-top,0px)) 20px calc(20px + env(safe-area-inset-bottom,0px));gap:16px}.otgg-help__close{min-width:44px;min-height:44px;font-size:27px}.otgg-help__body{padding:6px 2px}.otgg-help--intro .otgg-help__body,.otgg-help--success .otgg-help__body{display:flex;flex-direction:column;justify-content:center}.otgg-help__title{font-size:32px;margin:6px 0 16px}.otgg-help__copy{font-size:16px;line-height:1.55}.otgg-help__offer{margin-top:25px;padding:15px 12px;font-size:12px}.otgg-help__actions{gap:11px;padding-top:8px}.otgg-help__button{min-height:50px;font-size:15px;padding:12px 14px}.otgg-help__back{margin-bottom:10px}.otgg-help__label{font-size:13px;margin:20px 0 7px}.otgg-help__input{min-height:46px;padding:11px}.otgg-help__textarea{min-height:140px;max-height:40dvh}.otgg-help__note{margin-top:15px;font-size:12px}.otgg-help__brand{font-size:12px}}',
 '@media(prefers-reduced-motion:reduce){.otgg-help{animation:none}}'
 ].join('\n');document.head.appendChild(css);
}
function shell(){
 styles();panel=document.createElement('section');panel.className='otgg-help';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','On The Green Games, can we help?');
 panel.innerHTML='<div class="otgg-help__top"><span class="otgg-help__brand">ON THE GREEN GAMES</span><button class="otgg-help__close" type="button" aria-label="Dismiss message">&times;</button></div><div class="otgg-help__body"></div><div class="otgg-help__actions"></div>';
 panel.querySelector('.otgg-help__close').addEventListener('click',function(){report('dismiss','close_button');set(STORAGE.dismissed,'1');hide();});
 document.body.appendChild(panel);
 document.body.classList.add('otgg-help-open');
}
function intro(){
 if(!panel)return;
 panel.classList.remove('otgg-help--form','otgg-help--success');panel.classList.add('otgg-help--intro');
 panel.querySelector('.otgg-help__body').innerHTML='<h2 class="otgg-help__title">Any questions before booking?</h2><p class="otgg-help__copy">We’re happy to help with packages, delivery or anything else you’re unsure about.</p><div class="otgg-help__offer">OCT50 50% OFF CODE ENDS OCTOBER 31ST</div>';
 panel.querySelector('.otgg-help__actions').innerHTML='<button type="button" class="otgg-help__button otgg-help__primary" data-action="question">Ask us a question</button><a href="/booking" class="otgg-help__button otgg-help__secondary" data-action="booking">Continue booking</a>';
 panel.querySelector('[data-action="question"]').addEventListener('click',function(){report('form_open','ask_question');form();});
 panel.querySelector('[data-action="booking"]').addEventListener('click',function(){report('book_now_click','continue_booking');});
}
function form(){
 if(!panel)return;
 panel.classList.remove('otgg-help--intro','otgg-help--success');panel.classList.add('otgg-help--form');
 var b=panel.querySelector('.otgg-help__body');
 b.innerHTML='<button class="otgg-help__back" type="button">← Back</button><h2 class="otgg-help__title">Ask us anything</h2><p class="otgg-help__copy">Send us a quick question and we’ll get back to you by email.</p><form id="otgg-help-form"><label class="otgg-help__label" for="otgg-help-email">Email address</label><input class="otgg-help__input" id="otgg-help-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"><label class="otgg-help__label" for="otgg-help-message">Your question</label><textarea class="otgg-help__input otgg-help__textarea" id="otgg-help-message" name="message" required minlength="5" maxlength="1600" placeholder="What would you like to know?"></textarea><input class="otgg-help__honeypot" tabindex="-1" autocomplete="off" name="website" aria-hidden="true"><p class="otgg-help__note">We’ll use your email only to respond to your question. <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a>.</p><p id="otgg-help-error" class="otgg-help__error" role="alert" hidden></p></form>';
 panel.querySelector('.otgg-help__actions').innerHTML='<button class="otgg-help__button otgg-help__primary" type="submit" form="otgg-help-form">Send question</button>';
 b.querySelector('.otgg-help__back').addEventListener('click',intro);
 b.querySelector('form').addEventListener('submit',sendQuestion);
}
function successful(){
 if(!panel)return;
 panel.classList.remove('otgg-help--intro','otgg-help--form');panel.classList.add('otgg-help--success');
 panel.querySelector('.otgg-help__body').innerHTML='<h2 class="otgg-help__title">Thank you!</h2><p class="otgg-help__copy">Your question has been sent. We’ll get back to you by email.</p>';
 panel.querySelector('.otgg-help__actions').innerHTML='<button class="otgg-help__button otgg-help__secondary" type="button">Close</button>';
 panel.querySelector('.otgg-help__actions button').addEventListener('click',hide);
}
function sendQuestion(ev){
 ev.preventDefault();if(inFlight||!eligibilityToken||Date.now()>=END||!allowed()||!panel)return;
 var formEl=ev.currentTarget,email=formEl.elements.email.value.trim(),message=formEl.elements.message.value.trim();
 var error=panel.querySelector('#otgg-help-error'),button=panel.querySelector('[type="submit"][form]');
 if(!formEl.reportValidity())return;
 inFlight=true;button.disabled=true;button.textContent='Sending…';error.hidden=true;
 fetch('/.netlify/functions/submit-popup-enquiry',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,message:message,website:formEl.elements.website.value,impressionId:impressionId,token:eligibilityToken,pagePath:path()})})
 .then(function(r){return r.json().catch(function(){return {};}).then(function(b){if(!r.ok||!b.ok)throw Error(b.error||'Could not send your question.');});})
 .then(function(){report('form_submit','sent');set(STORAGE.done,'1');successful();})
 .catch(function(e){report('form_error','send_failed');error.textContent=e.message||'Please try again.';error.hidden=false;})
 .finally(function(){inFlight=false;if(button&&button.isConnected){button.disabled=false;button.textContent='Send question';}});
}
function reveal(){
 if(!nowOK()||panel||document.visibilityState==='hidden'||get(STORAGE.session)===activeVisit)return;
 // Eligible visitors are returned by Supabase after confirming two prior sessions.
 impressionId=uuid();
 set(STORAGE.session,activeVisit);set(STORAGE.shown,Number(get(STORAGE.shown)||0)+1);
 shell();intro();report('impression','shown');
}
function checkVisit(){
 if(!nowOK()||loading||get(STORAGE.session)===activeVisit||!activeVisit)return;
 var who=identity();if(!who){window.setTimeout(function(){if(!panel&&nowOK())checkVisit();},350);return;}
 loading=true;
 var lastActivity=who.lastActivity;
 // Safari can resume an existing tab without generating a fresh analytics session.
 var resumed=!!(lastActivity&&Date.now()-lastActivity>=GAP);
 fetch('/.netlify/functions/returning-help-eligibility',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitorId:who.visitorId,sessionId:who.sessionId,resumedAfterIdle:resumed})})
 .then(function(r){if(!r.ok)throw Error('Unavailable');return r.json();})
 .then(function(data){if(data.eligible&&data.token&&nowOK()){eligibilityToken=data.token;if(everVisitedThisPage)reveal();}})
 .catch(function(){})
 .finally(function(){loading=false;});
}
function activate(resumed){
 if(!nowOK()){hide();return;}
 var t=Date.now(),isNew=isNewVisit(t);
 if(!activeVisit||isNew){
  activeVisit=isNew?uuid():(get(STORAGE.visit)||uuid());
  set(STORAGE.visit,activeVisit);
  eligibilityToken='';everVisitedThisPage=false;
 }
 set(STORAGE.last,t);
 if(get(STORAGE.session)===activeVisit||panel)return;
 clearTimer();
 // Start a fresh 3-second delay whenever a new page loads or a dormant tab returns.
 timer=setTimeout(function(){timer=null;everVisitedThisPage=true;if(eligibilityToken)reveal();},3000);
 checkVisit();
}
function onConsent(){
 if(!allowed()||Date.now()>=END){hide();clearTimer();return;}
 if(!started){started=true;activate(false);}else if(!panel)activate(false);
}
document.addEventListener('visibilitychange',function(){
 if(document.visibilityState==='hidden')clearTimer();
 else if(Date.now()>=END||!allowed()){hide();}
 else if(panel&&isNewVisit(Date.now())){hide();activate(true);}
 else if(!panel)activate(true);
});
window.setTimeout(function(){if(Date.now()>=END)hide();},Math.max(0,END-Date.now()+100));
window.addEventListener('pageshow',function(e){if(Date.now()>=END){hide();return;}if(e.persisted&&!panel)activate(true);});
window.addEventListener('focus',function(){if(!panel&&document.visibilityState==='visible')trackActivity();});
['pointerdown','keydown','scroll','touchmove'].forEach(function(name){
 window.addEventListener(name,trackActivity,{passive:true});
});
window.addEventListener('otgg:consent-changed',onConsent);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',onConsent,{once:true});else onConsent();
})();
