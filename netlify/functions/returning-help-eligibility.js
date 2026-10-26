// Returns eligibility based on consented historical sessions, without exposing visitor history.
'use strict';
const crypto=require('crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const END=Date.parse('2026-11-01T00:00:00Z');
function send(code,data){return {statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)};}
exports.handler=async function(event){
  if(event.httpMethod!=='POST')return send(405,{eligible:false});
  if(Date.now()>=END)return send(200,{eligible:false});
  try{
    const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):(event.body||'');
    if(Buffer.byteLength(raw)>1024)return send(413,{eligible:false});
    const body=JSON.parse(raw||'{}'),visitor=String(body.visitorId||''),session=String(body.sessionId||'');
    if(!UUID.test(visitor)||!UUID.test(session))return send(400,{eligible:false});
    const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!base||!key)return send(503,{eligible:false});
    const api=base+'/rest/v1/site_analytics_events?visitor_id=eq.'+encodeURIComponent(visitor)+'&select=session_id,event_name&order=created_at.desc&limit=1500';
    const r=await fetch(api,{headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}});
    if(!r.ok){console.error('Eligibility query',r.status);return send(503,{eligible:false});}
    const events=await r.json();
    // Historical session IDs count even when sessions predate deployment.
    const previous=new Set(),completed=events.some(e=>e.event_name==='booking_completed');
    // iOS may resume the same analytics session ID after a long dormant tab.
    const resumed=body.resumedAfterIdle===true;
    for(const e of events){if(e.session_id && (resumed||e.session_id!==session))previous.add(e.session_id);}
    const eligible=!completed&&previous.size>=2;
    if(!eligible)return send(200,{eligible:false});
    // Short-lived signed token prevents the public enquiry endpoint being an open mail relay.
    const issued=Date.now(),nonce=crypto.randomBytes(8).toString('hex');
    const payload=visitor+'.'+session+'.'+issued+'.'+nonce;
    const signature=crypto.createHmac('sha256',key).update('otgg-popup-v1:'+payload).digest('hex');
    return send(200,{eligible:true,token:Buffer.from(payload+'.'+signature).toString('base64url')});
  }catch(e){console.error('Eligibility error',e.message);return send(400,{eligible:false});}
};