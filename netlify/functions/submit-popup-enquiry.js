// Adapt the existing October popup to the shared enquiries pipeline.
// Signed token validation, deduplication, spam controls, Supabase and Gmail
// notifications all live in submit-enquiry so both forms follow one process.
'use strict';
const shared=require('./submit-enquiry');
exports.handler=async function(event){
  if(event.httpMethod!=='POST')return {statusCode:405,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'Method not allowed'})};
  try{
    const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):(event.body||'');
    if(Buffer.byteLength(raw,'utf8')>6000)return {statusCode:413,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'Question too long.'})};
    const data=JSON.parse(raw||'{}');
    const adapted={
      email:data.email,
      message:data.message,
      website:data.website,
      token:data.token,
      submissionId:data.impressionId,
      source:'returning_visitor_popup',
      pagePath:data.pagePath||'/',
      analyticsConsent:true
    };
    return shared.handler({...event,body:JSON.stringify(adapted),isBase64Encoded:false});
  }catch(e){
    console.error('Popup enquiry adapter error',e.message);
    return {statusCode:400,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'Please check your details and try again.'})};
  }
};
