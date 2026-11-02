// Campaign copy and event tracking tests. No external requests or persistent changes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const popup=fs.readFileSync('returning-offer.js','utf8');
const nav=fs.readFileSync('nav.js','utf8');
const booking=fs.readFileSync('booking.js','utf8');
const html=fs.readFileSync('booking.html','utf8');
assert.match(nav,/FREE mini golf with games bookings this November/);
assert(!nav.includes('Free hole ends 30 November.'));
assert.match(booking,/FREE mini golf<\/strong> with games bookings this November/);
assert(!booking.includes('Free hole ends 30 November.'));
assert.match(html,/Build Your Own requires a £300 minimum after the free-hole saving/);
assert.match(popup,/var OFFER_CODE = 'BIRDIE30'/);
assert.match(popup,/30% OFF/);
assert(!popup.includes('40% OFF'));
assert.match(popup,/aria-label="Promo code BIRDIE30">BIRDIE30/);
assert.match(popup,/Promo code BIRDIE30 copied/);
assert.match(popup,/offerCode: OFFER_CODE/);
// Retain existing visitor memory, don't reset popup caps on the new offer.
assert.match(popup,/otgg_birdie40_show_count_v1/);
const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>',{
 url:'https://onthegreengames.co.uk/packages',pretendToBeVisual:true,runScripts:'outside-only'
});
const w=dom.window;
const now=Date.now();
w.localStorage.setItem('otgg_cookie_consent_v1',JSON.stringify({version:3,personalisation:true}));
w.localStorage.setItem('otgg_first_seen_v1',String(now-86400000));
w.localStorage.setItem('otgg_last_seen_v1',String(now-3600000));
const events=[];
w.fetch=async (_url,options)=>{events.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})}};
w.eval(popup);
(async()=>{
 await new Promise(resolve=>setTimeout(resolve,75));
 const card=w.document.querySelector('.otgg-return-offer__card');
 assert(card,'Returning visitor popup did not display');
 assert.match(card.textContent,/30% OFF/);
 assert.match(card.textContent,/BIRDIE30/);
 assert(!card.textContent.includes('BIRDIE40'));
 assert(events.some(event=>event.eventType==='impression'&&event.offerCode==='BIRDIE30'),
  'Popup analytics must record the new code');
 w.document.querySelector('.otgg-return-offer__copy').click();
 assert(events.some(event=>event.eventType==='copy_code_click'&&event.offerCode==='BIRDIE30'));
 console.log('PASS: November banner, upfront terms, BIRDIE30 popup copy, consent and event attribution');
 dom.window.close();
})().catch(error=>{console.error(error);process.exitCode=1;dom.window.close()});
