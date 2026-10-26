// Sends an enquiry from an eligible returning browser. No email/message is logged in analytics.
'use strict';
const crypto=require('crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const END=Date.parse('2026-11-01T00:00:00Z');
function send(statusCode,body){return {statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)};}
function safeEqual(a,b){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
async function api(base,key,method,route,body,extra){
  return fetch(base+'/rest/v1/'+route,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json',...(extra||{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
exports.handler=async function(event){
  if(event.httpMethod!=='POST')return send(405,{error:'Method not allowed'});
  if(Date.now()>=END)return send(410,{error:'This offer has ended.'});
  try{
    const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):(event.body||'');
    if(Buffer.byteLength(raw)>6000)return send(413,{error:'Message too long.'});
    const req=JSON.parse(raw||'{}');
    if(req.website)return send(202,{ok:true});
    const email=String(req.email||'').trim(),message=String(req.message||'').trim(),impression=String(req.impressionId||''),token=String(req.token||'');
    if(!UUID.test(impression)||!EMAIL.test(email)||email.length>254||message.length<5||message.length>1600)return send(400,{error:'Please enter a valid email and a message (5–1600 characters).'});
    if(token.length>512||!token)return send(403,{error:'Please reopen the enquiry form and try again.'});
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const resendKey=process.env.RESEND_API_KEY,from=process.env.RESEND_FROM_EMAIL;
    if(!key||!base||!resendKey||!from)return send(503,{error:'Enquiries are temporarily unavailable.'});
    const decoded=Buffer.from(token,'base64url').toString('utf8');
    const parts=decoded.split('.');
    if(parts.length!==5||!UUID.test(parts[0])||!UUID.test(parts[1]))return send(403,{error:'Please reopen the form.'});
    const payload=parts.slice(0,4).join('.');
    const expected=crypto.createHmac('sha256',key).update('otgg-popup-v1:'+payload).digest('hex');
    if(!safeEqual(expected,parts[4]))return send(403,{error:'Please reopen the form.'});
    const age=Date.now()-Number(parts[2]);
    if(!Number.isFinite(age)||age<0||age>60*60*1000)return send(403,{error:'Session expired. Please reopen the form.'});
    // Reject cross-origin posting where the browser provides an Origin header.
    const origin=String(event.headers?.origin||event.headers?.Origin||'');
    if(origin&&!['https://onthegreengames.co.uk','https://www.onthegreengames.co.uk'].includes(origin))return send(403,{error:'Invalid origin'});
    const ip=String(event.headers?.['x-nf-client-connection-ip']||event.headers?.['x-forwarded-for']||'unknown').split(',')[0].trim().slice(0,100);
    const ipHash=crypto.createHash('sha256').update('popup-enquiry:'+key+':'+ip).digest('hex');
    const since=new Date(Date.now()-60*60*1000).toISOString();
    const limit=await api(base,key,'GET','popup_enquiry_requests?ip_hash=eq.'+ipHash+'&created_at=gte.'+encodeURIComponent(since)+'&select=impression_id&limit=4');
    if(!limit.ok)return send(503,{error:'Please try again later.'});
    if((await limit.json()).length>=3)return send(429,{error:'Too many requests. Please try again later.'});
    const already=await api(base,key,'GET','popup_enquiry_requests?impression_id=eq.'+impression+'&select=status');
    if(!already.ok)return send(503,{error:'Please try again.'});
    const prior=await already.json();
    if(prior[0]?.status==='sent')return send(200,{ok:true});
    if(prior[0]?.status==='processing')return send(409,{error:'Your message is already being sent.'});
    const upsert=await api(base,key,'POST','popup_enquiry_requests?on_conflict=impression_id',
      {impression_id:impression,ip_hash:ipHash,status:'processing',updated_at:new Date().toISOString()},
      {Prefer:'resolution=merge-duplicates,return=minimal'});
    if(!upsert.ok)return send(503,{error:'Please try again later.'});
    // Explicitly do not use the customer's email as the verified sender.
    const outgoing=await fetch('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:'Bearer '+resendKey,'Content-Type':'application/json'},
      body:JSON.stringify({from:'On The Green Games <'+from+'>',to:['bookings@onthegreengames.co.uk'],reply_to:email,
        subject:'Website question from a returning visitor',
        text:'A visitor has asked a question through the website.\n\nReply to: '+email+'\n\nMessage:\n'+message+'\n\nSent: '+new Date().toISOString()+
          '\n\nThis is a customer service enquiry, not marketing consent.'})
    });
    const status=outgoing.ok?'sent':'failed';
    await api(base,key,'PATCH','popup_enquiry_requests?impression_id=eq.'+impression,
      {status,updated_at:new Date().toISOString()},{Prefer:'return=minimal'});
    if(!outgoing.ok){console.error('Resend enquiry failed:',outgoing.status);return send(502,{error:'We could not send your question. Please try again.'});}
    return send(200,{ok:true});
  }catch(e){console.error('Popup enquiry error:',e.message);return send(500,{error:'Something went wrong. Please try again.'});}
};