// Pop-up interaction collection. Legacy clients still default to BIRDIE40.
'use strict';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const TYPES = new Set(['impression','book_now_click','copy_code_click','dismiss','form_open','form_submit','form_error']);
const CODES = new Set(['BIRDIE40','RETURNING_VISITOR_HELP']);
function response(statusCode,body){return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)};}
exports.handler = async function(event) {
  if(event.httpMethod!=='POST')return response(405,{error:'Method not allowed'});
  try {
    const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):(event.body||'');
    if(Buffer.byteLength(raw)>8192)return response(413,{error:'Request too large'});
    const input=JSON.parse(raw||'{}');
    const impressionId=String(input.impressionId||input.impression_id||'');
    const type=String(input.eventType||input.event_type||'').slice(0,40);
    const code=String(input.offerCode||input.offer_code||'BIRDIE40').trim().toUpperCase();
    const detail=input.eventDetail||input.event_detail;
    const path=String(input.pagePath||input.page_path||'/').split('?')[0].split('#')[0].slice(0,240);
    if(!UUID_RE.test(impressionId)||!TYPES.has(type)||!CODES.has(code))return response(400,{error:'Invalid pop-up event'});
    if(code==='RETURNING_VISITOR_HELP'&&Date.now()>=Date.parse('2026-11-01T00:00:00Z'))return response(410,{error:'Campaign ended'});
    const url=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
    if(!url||!key)return response(500,{error:'Tracking unavailable'});
    const post=await fetch(url+'/rest/v1/returning_offer_events?on_conflict=impression_id,event_type',{
      method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=minimal'},
      body:JSON.stringify({impression_id:impressionId,offer_code:code,event_type:type,event_detail:detail?String(detail).slice(0,80):null,page_path:path.startsWith('/')?path:'/'+path})
    });
    if(!post.ok){console.error('Popup track failed',post.status,(await post.text()).slice(0,200));return response(502,{error:'Tracking temporarily unavailable'});}
    return response(202,{ok:true});
  }catch(e){console.error('Popup tracking error:',e.message);return response(400,{error:'Invalid event'});}
};