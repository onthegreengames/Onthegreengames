// Public website enquiry endpoint: validates, rate-limits, stores in Supabase and notifies by Resend.
'use strict';
const crypto = require('crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const ALLOWED_ORIGINS = new Set(['https://onthegreengames.co.uk','https://www.onthegreengames.co.uk']);
const ALLOWED_SOURCES = new Set(['floating_form','contact_page','returning_visitor_popup']);
const POPUP_END = Date.parse('2026-11-01T00:00:00Z');
function response(statusCode,body){return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)};}
function text(value,max){return String(value||'').trim().slice(0,max);}
function cleanDate(value){
  if(!value)return null;
  const raw=String(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return undefined;
  const d=new Date(raw+'T12:00:00Z');
  return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===raw?raw:undefined;
}
function verifiedPopupIdentity(data,key){
  // Signed by returning-help-eligibility; do not trust a client-supplied source alone.
  if(Date.now()>=POPUP_END)return {error:'This enquiry popup has ended.',status:410};
  const token=String(data.token||'');
  if(!token||token.length>512)return {error:'Please reopen the enquiry form.',status:403};
  let parts;
  try{parts=Buffer.from(token,'base64url').toString('utf8').split('.');}
  catch(_){return {error:'Please reopen the enquiry form.',status:403};}
  if(parts.length!==5||!UUID.test(parts[0])||!UUID.test(parts[1])||!/^\\d{13}$/.test(parts[2])||! /^[0-9a-f]{16}$/.test(parts[3])||! /^[0-9a-f]{64}$/.test(parts[4]))return {error:'Please reopen the enquiry form.',status:403};
  const age=Date.now()-Number(parts[2]);
  if(!Number.isFinite(age)||age<0||age>60*60*1000)return {error:'Session expired. Please reopen the enquiry form.',status:403};
  const payload=parts.slice(0,4).join('.');
  const mac=crypto.createHmac('sha256',key).update('otgg-popup-v1:'+payload).digest('hex');
  const expected=Buffer.from(mac,'hex'),received=Buffer.from(parts[4],'hex');
  if(expected.length!==received.length||!crypto.timingSafeEqual(expected,received))return {error:'Please reopen the enquiry form.',status:403};
  return {visitorId:parts[0],sessionId:parts[1]};
}
function headers(key){return {'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json','Accept':'application/json'};}
async function supa(base,key,method,path,body,prefer){
 const opts={method,headers:{...headers(key),...(prefer?{Prefer:prefer}:{})}};
 if(body!==undefined)opts.body=JSON.stringify(body);
 return fetch(base+'/rest/v1/'+path,opts);
}
function ipHash(event,secret){
 const ip=String(event.headers?.['x-nf-client-connection-ip']||event.headers?.['x-forwarded-for']||'unknown').split(',')[0].trim().slice(0,90);
 return crypto.createHmac('sha256',secret).update('otgg-enquiry-rate-v1:'+ip).digest('hex');
}
exports.handler=async function(event){
 if(event.httpMethod!=='POST')return response(405,{error:'Method not allowed'});
 const origin=String(event.headers?.origin||event.headers?.Origin||'');
 if(origin&&!ALLOWED_ORIGINS.has(origin))return response(403,{error:'Invalid origin'});
 try{
  const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):(event.body||'');
  if(Buffer.byteLength(raw)>10000)return response(413,{error:'Your message is too long.'});
  const data=JSON.parse(raw||'{}');
  if(data.website)return response(202,{ok:true}); // hidden honeypot
  const submissionId=text(data.submissionId,36);
  const email=text(data.email,254);
  const source=text(data.source,25);
  const isPopup=source==='returning_visitor_popup';
  const firstName=isPopup?null:text(data.firstName,100);
  const lastName=isPopup?null:text(data.lastName,100);
  const venue=text(data.venue,180)||null;
  const message=text(data.message,3001);
  const eventDate=cleanDate(data.eventDate);
  const pagePath=(text(data.pagePath,240).split('?')[0].split('#')[0]||'/');
  const allowAnalytics=data.analyticsConsent===true;
  let visitorId=allowAnalytics&&UUID.test(data.visitorId||'')?data.visitorId:null;
  let sessionId=allowAnalytics&&UUID.test(data.sessionId||'')?data.sessionId:null;
  if(!UUID.test(submissionId)||!EMAIL.test(email)||(!isPopup&&(!/^[^\r\n]{1,100}$/.test(firstName)||!/^[^\r\n]{1,100}$/.test(lastName)))||message.length<5||message.length>3000||eventDate===undefined||!ALLOWED_SOURCES.has(source)||!pagePath.startsWith('/')){
    return response(400,{error:'Please complete the required fields and check your details.'});
  }
  const base=String(process.env.SUPABASE_URL||'').trim().replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!base||!key)return response(503,{error:'Enquiries are temporarily unavailable. Please try again.'});
  if(isPopup){
    const verified=verifiedPopupIdentity(data,key);
    if(verified.error)return response(verified.status,{error:verified.error});
    visitorId=verified.visitorId;
    sessionId=verified.sessionId;
  }
  // Idempotent retries must not create a second email.
  const existing=await supa(base,key,'GET','enquiries?submission_id=eq.'+encodeURIComponent(submissionId)+'&select=id,email_status',undefined);
  if(!existing.ok)throw new Error('Existing enquiry lookup failed: '+existing.status);
  if((await existing.json()).length)return response(200,{ok:true,alreadyReceived:true});
  const hash=ipHash(event,key);
  const since=new Date(Date.now()-3600000).toISOString();
  const recent=await supa(base,key,'GET','enquiries?ip_hash=eq.'+encodeURIComponent(hash)+'&created_at=gte.'+encodeURIComponent(since)+'&select=id&limit=6');
  if(!recent.ok)throw new Error('Rate lookup failed: '+recent.status);
  if((await recent.json()).length>=5)return response(429,{error:'Too many enquiries from this connection. Please try again later.'});
  if(isPopup){
    const popupRecent=await supa(base,key,'GET','enquiries?ip_hash=eq.'+encodeURIComponent(hash)+'&source=eq.returning_visitor_popup&created_at=gte.'+encodeURIComponent(since)+'&select=id&limit=4');
    if(!popupRecent.ok)throw new Error('Popup rate limit lookup failed: '+popupRecent.status);
    if((await popupRecent.json()).length>=3)return response(429,{error:'Too many questions. Please try again later.'});
  }
  const row={submission_id:submissionId,email,first_name:firstName,last_name:lastName,event_date:eventDate,venue,message,source,page_path:pagePath,
    visitor_id:visitorId,session_id:sessionId,ip_hash:hash,status:'new',email_status:'pending'};
  const inserted=await supa(base,key,'POST','enquiries?on_conflict=submission_id',row,'resolution=ignore-duplicates,return=representation');
  if(!inserted.ok)throw new Error('Enquiry save failed: '+inserted.status);
  const saved=await inserted.json();
  if(!Array.isArray(saved)||saved.length===0)return response(200,{ok:true,alreadyReceived:true});
  const enquiryId=saved[0].id;
  // Enquiry was saved successfully. A notification failure must not lose the customer's message.
  let sent=false,providerId=null;
  const resendKey=process.env.RESEND_API_KEY;
  const from=String(process.env.RESEND_FROM_EMAIL||'').trim();
  // Send straight to the same Gmail inbox used by inbound forwarding. An
  // email addressed to bookings@ on our own sending domain may not complete
  // the separate inbound/forwarding route even after Resend accepts it.
  const notificationTo=String(process.env.BOOKINGS_FORWARD_TO||'onthegreengames@gmail.com').trim();
  if(resendKey&&from&&EMAIL.test(notificationTo)){
    const body=[
      'New website enquiry','',
      'From: '+(isPopup?'Returning visitor (name not requested)':firstName+' '+lastName),
      'Email: '+email,
      'Event date: '+(eventDate||'Not provided'),
      'Venue: '+(venue||'Not provided'),
      'Form: '+(isPopup?'Returning visitor popup':source==='floating_form'?'Floating chat':'Contact page'),
      'Page: '+pagePath,'',
      'Message:',message,'',
      'Reference: '+enquiryId,
      'This enquiry is for a reply only; it is not marketing consent.'
    ].join('\n');
    try{
      const sentResponse=await fetch('https://api.resend.com/emails',{
       method:'POST',
       headers:{'Authorization':'Bearer '+resendKey,'Content-Type':'application/json','Idempotency-Key':'otgg-enquiry-'+submissionId},
       body:JSON.stringify({
        from:'On The Green Games <'+from+'>',
        to:[notificationTo],
        reply_to:email,
        subject:isPopup?'New website enquiry: Returning visitor':'New website enquiry: '+firstName+' '+lastName,
        text:body
       })
      });
      if(sentResponse.ok){const result=await sentResponse.json();providerId=result.id||null;sent=true;}
      else console.error('Enquiry notification delivery failed',sentResponse.status);
    }catch(e){console.error('Enquiry email delivery unavailable',e.message);}
  }else{console.error('Enquiry email credentials not configured');}
  try{
    const updated=await supa(base,key,'PATCH','enquiries?id=eq.'+encodeURIComponent(enquiryId),
      {email_status:sent?'sent':'failed',email_sent_at:sent?new Date().toISOString():null,provider_email_id:providerId,updated_at:new Date().toISOString()},'return=minimal');
    if(!updated.ok)console.error('Enquiry email status update failed',updated.status);
  }catch(e){console.error('Enquiry status update unavailable',e.message);}
  return response(201,{ok:true,notificationSent:sent});
 }catch(e){
  console.error('Enquiry submission error',e.message);
  return response(503,{error:'We could not save your enquiry. Please try again.'});
 }
};