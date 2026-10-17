const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..','app','static');
const html=fs.readFileSync(path.join(root,'emploi.html'),'utf8'),script=fs.readFileSync(path.join(root,'emploi-web.js'),'utf8');
const reply=(items)=>({ok:true,json:async()=>({items,total:items.length,page:1,pages:1,facets:{wilayas:['Alger'],contract_types:['CDI'],companies:[{id:4,name:'Société test'}]}})});
const offer={id:7,title:'Superviseur <script>inert</script>',wilaya:'Alger',location:'Hydra',positions:2,contract_type:'CDI',company:{id:4,name:'Société test'},salary:null};
const flush=()=>new Promise(resolve=>setTimeout(resolve,20));
function app(fetch){const dom=new JSDOM(html,{url:'https://emploi.irongs.com',runScripts:'outside-only'});dom.window.fetch=fetch;dom.window.eval(script);return dom;}
test('web catalogue: real API filters, safe offer content, direct application route',async()=>{
  const calls=[];const dom=app(async url=>{calls.push(url);if(/offers\/7$/.test(url))return {ok:true,json:async()=>({...offer,missions:'Missions <script>inert</script>',profile:'Profil attendu'})};return reply([offer]);});await flush();
  assert.doesNotMatch(calls[1],/company_id=/);const d=dom.window.document;assert.equal(d.querySelectorAll('.offer-card').length,1);assert.equal(d.querySelector('.offer-card h3').textContent,offer.title);assert.equal(d.querySelector('.offer-card script'),null);
  assert.equal(d.querySelector('.offer-link').getAttribute('href'),'/espace/offers/7');
  d.querySelector('[name=q]').value='superviseur';d.querySelector('[name=wilaya]').value='Alger';d.querySelector('[name=company_id]').value='4';
  d.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();
  const search=calls.filter(x=>x.includes('offers?')).at(-1);assert.match(search,/q=superviseur/);assert.match(search,/wilaya=Alger/);assert.match(search,/company_id=4/);assert.match(d.querySelector('#offer-detail').textContent,/Missions <script>inert<\/script>/);assert.equal(d.querySelector('#offer-detail script'),null);dom.window.close();
});
test('web catalogue: no false empty state on network error; retry and empty result are distinct',async()=>{
  let fail=true;const dom=app(async()=>{if(fail)throw new Error('Connexion indisponible');return reply([]);});await flush();const d=dom.window.document;
  assert.equal(d.querySelector('#offer-error').hidden,false);assert.match(d.querySelector('#offer-error').textContent,/Connexion indisponible/);assert.equal(d.querySelector('#offer-status').textContent,'');
  fail=false;d.querySelector('#offers-retry').click();await flush();assert.equal(d.querySelector('#offer-error').hidden,true);assert.match(d.querySelector('#offer-status').textContent,/Aucune offre ne correspond/);dom.window.close();
});

test('web detail: unavailable offer has no apply action and displays the reason',async()=>{
 const dom=app(async url=>url.includes('offers/7')?{ok:false,status:404}:reply([offer]));try{await flush();const d=dom.window.document;assert.match(d.querySelector('#offer-detail').textContent,/plus disponible/);assert.equal(d.querySelector('#offer-detail a'),null);assert.equal(d.querySelector('#offer-detail [role=alert]')!==null,true);}finally{dom.window.close();}
});
test('web favorites and detail selection preserve the real application route',async()=>{
 const dom=app(async url=>url.includes('offers/7')?{ok:true,json:async()=>({...offer,missions:'Mission',profile:'Profil'})}:reply([offer]));try{await flush();const d=dom.window.document;d.querySelector('.bookmark').click();assert.equal(d.querySelector('.bookmark').getAttribute('aria-pressed'),'true');d.querySelector('#offers-favorites').click();assert.equal(d.querySelectorAll('.offer-card').length,1);d.querySelector('.offer-select').click();await flush();assert.equal(d.querySelector('.offer-workspace').classList.contains('detail-open'),true);assert.equal(d.querySelector('#offer-detail a').getAttribute('href'),'/espace/offers/7');d.querySelector('.detail-back').click();assert.equal(d.querySelector('.offer-workspace').classList.contains('detail-open'),false);}finally{dom.window.close();}
});
