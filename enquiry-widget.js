/* Shared enquiry experience for the floating contact button and /contact page. */
(function(){
'use strict';
if(window.OTGGEnquiryWidgetLoaded)return;
window.OTGGEnquiryWidgetLoaded=true;
var ENDPOINT='/.netlify/functions/submit-enquiry';
var activePanel=null,chatButton=null,initialised=false;
var ICON='<svg aria-hidden="true" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
function uuid(){if(window.crypto&&typeof crypto.randomUUID==='function')return crypto.randomUUID();return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var v=Math.random()*16|0;return (c==='x'?v:(v&3|8)).toString(16);});}
function consented(){try{return !!(window.OTGGConsent&&window.OTGGConsent.getChoice().analytics);}catch(e){return false;}}
function analytics(eventName,source){
 if(!consented())return;
 try{if(window.OTGGAnalytics&&typeof window.OTGGAnalytics.track==='function')window.OTGGAnalytics.track(eventName,{detail:source});}catch(e){}
}
function readIdentity(){
 if(!consented())return {};
 try{
  var visitor=localStorage.getItem('otgg_analytics_visitor_v1');
  var sess=JSON.parse(localStorage.getItem('otgg_analytics_session_v1')||'null');
  return {visitorId:visitor||null,sessionId:sess&&sess.id||null};
 }catch(e){return {};}
}
function normalPath(){return (location.pathname||'/').toLowerCase().replace(/\.html$/,'').replace(/\/$/,'')||'/';}
function css(){
 if(document.getElementById('otgg-enquiry-style'))return;
 var style=document.createElement('style');style.id='otgg-enquiry-style';
 style.textContent=[
 '.otgg-enquiry-toggle{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:10015;display:grid;place-items:center;width:56px;height:56px;border-radius:50%;border:0;background:#1E4734;color:#fff;cursor:pointer;box-shadow:0 7px 22px rgba(23,48,35,.28);transition:transform .16s ease,background .16s ease}',
 '.otgg-enquiry-toggle:hover{background:#2F6B4F;transform:translateY(-2px)}',
 '.otgg-enquiry-toggle:focus-visible,.otgg-enquiry button:focus-visible,.otgg-enquiry input:focus-visible,.otgg-enquiry textarea:focus-visible{outline:3px solid #c0913c;outline-offset:3px}',
 '.otgg-enquiry-panel{position:fixed;right:18px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:10020;width:min(410px,calc(100vw - 24px));height:min(560px,calc(100dvh - 112px));border-radius:17px;border:1px solid #dce2d8;background:#fffefa;color:#1E4734;padding:16px;box-shadow:0 18px 55px rgba(18,41,28,.27);font-family:Inter,Arial,sans-serif}',
 '.otgg-enquiry-panel[hidden]{display:none!important}',
 '.otgg-enquiry{display:flex;flex-direction:column;height:100%;min-height:0;gap:8px;font-family:Inter,Arial,sans-serif}',
 '.otgg-enquiry *{box-sizing:border-box}',
 '.otgg-enquiry__header{display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;gap:10px}',
 '.otgg-enquiry__brand{display:flex;align-items:center;gap:7px;font-size:10px;font-weight:700;letter-spacing:.07em;color:#1E4734}',
 '.otgg-enquiry__brand svg{width:17px;height:17px}',
 '.otgg-enquiry__close{background:none;border:0;color:#6a7b6e;font-size:26px;line-height:1;cursor:pointer;padding:3px 7px}',
 '.otgg-enquiry__intro{flex:0 0 auto}',
 '.otgg-enquiry__title{margin:0 0 4px!important;font-family:"Playfair Display",Georgia,serif;font-size:26px;line-height:1.15;letter-spacing:-.015em;color:#1E4734;font-weight:600}',
 '.otgg-enquiry__subtitle{font-size:12px;line-height:1.45;color:#5c6c60;margin:0!important}',
 '.otgg-enquiry__form{display:flex;flex-direction:column;flex:1;min-height:0;margin:0}',
 '.otgg-enquiry__scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding-right:3px}',
 '.otgg-enquiry__field{margin:0 0 9px}',
 '.otgg-enquiry__grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}',
 '.otgg-enquiry__label{display:block;margin:0 0 4px;font-size:12px;font-weight:600;line-height:1.3;color:#1E4734}',
 '.otgg-enquiry__control{width:100%;min-width:0;border:1px solid #c5d0c5!important;border-radius:8px!important;padding:9px 10px!important;background:#fff!important;color:#1E4734!important;font:400 16px/1.35 Inter,Arial,sans-serif!important;box-shadow:none!important;min-height:38px}',
 '.otgg-enquiry__control::placeholder{color:#849087}',
 '.otgg-enquiry__message{min-height:94px;max-height:210px;resize:vertical}',
 '.otgg-enquiry__privacy{font-size:10px;line-height:1.45;color:#69786b;margin:2px 0 8px}',
 '.otgg-enquiry__privacy a{text-decoration:underline;text-underline-offset:2px}',
 '.otgg-enquiry__footer{flex:0 0 auto;padding-top:6px}',
 '.otgg-enquiry__submit{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid #1E4734;background:#1E4734;color:#fff!important;border-radius:9px;min-height:41px;padding:10px 12px;font:700 13px Inter,Arial,sans-serif;cursor:pointer}',
 '.otgg-enquiry__submit:disabled{opacity:.55;cursor:wait}',
 '.otgg-enquiry__error{font-size:12px;color:#a12828;margin:6px 0 0}',
 '.otgg-enquiry__success{display:flex;flex:1;flex-direction:column;justify-content:center;align-items:center;gap:14px;text-align:center;color:#1E4734;padding:20px 6px}',
 '.otgg-enquiry__success h2{font-size:25px;line-height:1.2}',
 '.otgg-enquiry__success p{font-size:13px;line-height:1.5;color:#596a5e}',
 '.otgg-enquiry__honeypot{position:absolute!important;left:-9999px!important;opacity:0!important;pointer-events:none!important;height:0!important}',
 '.otgg-enquiry-page{max-width:700px;margin:0 auto;padding:28px 0 68px}',
 '.otgg-enquiry-page .otgg-enquiry{gap:20px}',
 '.otgg-enquiry-page .otgg-enquiry__title{font-size:34px}',
 '.otgg-enquiry-page .otgg-enquiry__subtitle{font-size:15px}',
 '.otgg-enquiry-page .otgg-enquiry__scroll{overflow:visible;padding-right:0}',
 '.otgg-enquiry-page .otgg-enquiry__field{margin-bottom:18px}',
 '.otgg-enquiry-page .otgg-enquiry__control{min-height:45px;padding:11px 12px!important}',
 '.otgg-enquiry-page .otgg-enquiry__message{min-height:160px}',
 '.otgg-enquiry-page .otgg-enquiry__footer{padding-top:0}',
 '.otgg-enquiry-page .otgg-enquiry__submit{min-height:46px}',
 '@media(max-width:600px){.otgg-enquiry-toggle{right:13px;bottom:calc(13px + env(safe-area-inset-bottom,0px));width:52px;height:52px}.otgg-enquiry-panel{left:12px;right:12px;bottom:calc(77px + env(safe-area-inset-bottom,0px));width:auto;height:min(590px,calc(100dvh - 94px));max-height:calc(100dvh - 94px);padding:12px;border-radius:14px}.otgg-enquiry__title{font-size:24px}.otgg-enquiry__field{margin-bottom:7px}.otgg-enquiry__grid{gap:8px}.otgg-enquiry__label{font-size:11px;margin-bottom:3px}.otgg-enquiry__control{padding:7px 9px!important;min-height:35px}.otgg-enquiry__message{min-height:80px}.otgg-enquiry__submit{min-height:37px;padding:8px}.otgg-enquiry-page{padding:18px 0 50px}.otgg-enquiry-page .otgg-enquiry__grid{grid-template-columns:1fr}.otgg-enquiry-page .otgg-enquiry__field{margin-bottom:12px}.otgg-enquiry-page .otgg-enquiry__title{font-size:30px}}',
 '@media(prefers-reduced-motion:reduce){.otgg-enquiry-toggle{transition:none}}'
 ].join('\n');document.head.appendChild(style);
}
function field(id,label,type,placeholder,required,extra){
 var attrs=(required?' required':'')+(extra||'');
 return '<div class="otgg-enquiry__field"><label class="otgg-enquiry__label" for="'+id+'">'+label+(required?' *':'')+'</label><input class="otgg-enquiry__control" id="'+id+'" name="'+id+'" type="'+type+'"'+(placeholder?' placeholder="'+placeholder+'"':'')+attrs+'></div>';
}
function markup(prefix,standalone){
 var id=function(k){return prefix+'-'+k;};
 var x='<div class="otgg-enquiry">'+(standalone?'':'<div class="otgg-enquiry__intro"><h2 class="otgg-enquiry__title">Get in touch</h2><p class="otgg-enquiry__subtitle">Have a question about your wedding entertainment? We’d love to help.</p></div>');
 x+='<form class="otgg-enquiry__form" novalidate><div class="otgg-enquiry__scroll">';
 x+=field(id('email'),'Email address','email','you@example.com',true,' autocomplete="email" maxlength="254"');
 x+='<div class="otgg-enquiry__grid">';
 x+=field(id('first'),'First name','text','First name',true,' autocomplete="given-name" maxlength="100"');
 x+=field(id('last'),'Last name','text','Last name',true,' autocomplete="family-name" maxlength="100"');
 x+='</div>';
 x+=field(id('date'),'Event date','date','',false,'');
 x+=field(id('venue'),'Venue','text','Venue name, if known',false,' maxlength="180"');
 x+='<div class="otgg-enquiry__field"><label class="otgg-enquiry__label" for="'+id('message')+'">Your message *</label><textarea class="otgg-enquiry__control otgg-enquiry__message" id="'+id('message')+'" name="'+id('message')+'" maxlength="3000" minlength="5" required placeholder="What would you like to know?"></textarea></div>';
 x+='<input class="otgg-enquiry__honeypot" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">';
 x+='<p class="otgg-enquiry__privacy">We’ll use these details only to respond to your enquiry, not for marketing. See our <a href="/privacy" target="_blank" rel="noopener noreferrer">privacy policy</a>.</p>';
 x+='</div><div class="otgg-enquiry__footer"><button class="otgg-enquiry__submit" type="submit">Send enquiry <span aria-hidden="true">→</span></button><p class="otgg-enquiry__error" role="alert" hidden></p></div></form></div>';
 return x;
}
function formHandler(root,source){
 root.innerHTML=markup(source==='contact_page'?'otgg-contact':'otgg-chat',source==='contact_page');
 var form=root.querySelector('form');
 var submit=form.querySelector('.otgg-enquiry__submit'),error=form.querySelector('.otgg-enquiry__error'),pending=false,done=false,started=false,submissionId=uuid();
 function recordStart(){if(!started){started=true;analytics('enquiry_form_started',source);}}
 form.addEventListener('input',recordStart,{once:true});
 form.addEventListener('submit',function(event){
  event.preventDefault();
  if(pending||done)return;
  if(!form.reportValidity())return;
  var values={
   submissionId:submissionId,
   email:form.querySelector('[type=email]').value.trim(),
   firstName:form.querySelector('[autocomplete="given-name"]').value.trim(),
   lastName:form.querySelector('[autocomplete="family-name"]').value.trim(),
   eventDate:form.querySelector('[type=date]').value||null,
   venue:form.querySelector('[name$="-venue"]').value.trim(),
   message:form.querySelector('textarea').value.trim(),
   website:form.querySelector('[name=website]').value,
   source:source,
   pagePath:normalPath(),
   analyticsConsent:consented()
  };
  if(!values.firstName||!values.lastName||!values.message||values.message.length<5){error.textContent='Please complete the required fields.';error.hidden=false;return;}
  if(values.analyticsConsent)Object.assign(values,readIdentity());
  pending=true;submit.disabled=true;submit.textContent='Sending…';error.hidden=true;
  fetch(ENDPOINT,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)})
   .then(function(resp){return resp.json().catch(function(){return {};}).then(function(body){if(!resp.ok||!body.ok)throw Error(body.error||'We could not send your enquiry.');return body;});})
   .then(function(){
     done=true;analytics('enquiry_form_submitted',source);
     root.innerHTML='<div class="otgg-enquiry"><div class="otgg-enquiry__success" role="status"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#1E4734" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg><h2>Thanks for getting in touch!</h2><p>We’ve received your enquiry and will get back to you by email as soon as we can.</p></div></div>';
   }).catch(function(e){analytics('enquiry_form_error',source);error.textContent=e.message||'Please try again.';error.hidden=false;})
   .finally(function(){pending=false;if(submit.isConnected){submit.disabled=false;submit.textContent='Send enquiry →';}});
 });
 return {abandoned:function(){if(started&&!done)analytics('enquiry_form_abandoned',source);}};
}
function init(){
 if(initialised||!document.body)return;
 initialised=true;css();
 var page=document.querySelector('[data-otgg-contact-page]');
 if(page){page.classList.add('otgg-enquiry-page');formHandler(page,'contact_page');analytics('enquiry_form_opened','contact_page');}
 // The standalone page already has the form in full. No redundant floating duplicate there.
 if(normalPath()==='/contact')return;
 chatButton=document.createElement('button');chatButton.type='button';chatButton.className='otgg-enquiry-toggle';chatButton.setAttribute('aria-label','Open contact form');chatButton.setAttribute('aria-expanded','false');chatButton.setAttribute('aria-controls','otgg-enquiry-panel');chatButton.innerHTML=ICON;chatButton.title='Get in touch';
 activePanel=document.createElement('section');activePanel.className='otgg-enquiry-panel';activePanel.id='otgg-enquiry-panel';activePanel.hidden=true;activePanel.setAttribute('role','dialog');activePanel.setAttribute('aria-label','Contact On The Green Games');activePanel.setAttribute('aria-modal','false');
 var hdr=document.createElement('div');hdr.className='otgg-enquiry__header';
 hdr.innerHTML='<span class="otgg-enquiry__brand">'+ICON+' ON THE GREEN GAMES</span><button class="otgg-enquiry__close" type="button" aria-label="Close contact form">&times;</button>';
 hdr.style.marginBottom='7px';
 var contents=document.createElement('div');contents.style.cssText='height:calc(100% - 32px);min-height:0;';
 activePanel.appendChild(hdr);activePanel.appendChild(contents);document.body.appendChild(activePanel);document.body.appendChild(chatButton);
 var formState=null;
 function close(){
  if(activePanel.hidden)return;
  if(formState)formState.abandoned();
  activePanel.hidden=true;chatButton.setAttribute('aria-expanded','false');chatButton.setAttribute('aria-label','Open contact form');analytics('enquiry_form_closed','floating_form');chatButton.focus();
 }
 function open(){
  activePanel.hidden=false;formState=formHandler(contents,'floating_form');chatButton.setAttribute('aria-expanded','true');chatButton.setAttribute('aria-label','Close contact form');analytics('enquiry_form_opened','floating_form');
  var first=activePanel.querySelector('input[type=email]');if(first)first.focus({preventScroll:true});
 }
 chatButton.addEventListener('click',function(){if(activePanel.hidden)open();else close();});
 hdr.querySelector('button').addEventListener('click',close);
 document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!activePanel.hidden)close();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();