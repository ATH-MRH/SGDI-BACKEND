const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const puppeteer=require('puppeteer-core');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root=path.join(__dirname,'../app/static');
const societies=['IRON GLOBAL SÉCURITÉ','IRON GLOBAL SOLUTION'];
const sites=societies.map((society,i)=>({id:i+1,name:'SITE TEST '+(i+1),society}));
const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#dbeafe"/><circle cx="40" cy="28" r="14" fill="#64748b"/><path d="M10 80V65a30 30 0 0 1 60 0v15" fill="#19375b"/></svg>');
const employee={photo,id:10,matricule:'TEST10',nom:'EMPLOYÉ TEST',prenom:'Fixture',poste:'Agent',societe:societies[0],site:sites[0].name};
const captures='/private/tmp/pointeur-validation-20261006';fs.mkdirSync(captures,{recursive:true});
let revision=1;
const event=()=>({...employee,employee_id:10,nom:'EMPLOYÉ TEST '+revision,action:'arrivee',scanned_at:new Date().toISOString().slice(0,10)+'T08:00:00+01:00',site_id:1,source:'MANUAL'});
const post=()=>({site:'SITE TEST',status:'NORMAL',current:null,next:null,maintien:null,kpi:{expected:12,present:revision,absent:2,maintien:0,anomalies:0},present:Array.from({length:40},(_,i)=>({employee:{...employee,id:10+i,nom:'Agent '+i,fonction:'Agent'},entry:'08:00',badge:'EN_POSTE',badge_label:'EN POSTE'})),todo:[],movements:[],activity:{refused_today:0},permissions:{manual_entry:true}});
function scopedRows(url){return Array.from({length:40},(_,i)=>({...event(),employee_id:10+i,matricule:'TEST'+(10+i),nom:i?'Agent '+i:event().nom,societe:societies[i<20?0:1],site_id:i<20?1:2,site:sites[i<20?0:1].name})).filter(row=>(!url.searchParams.get('society')||row.societe===url.searchParams.get('society'))&&(!url.searchParams.get('site_id')||String(row.site_id)===url.searchParams.get('site_id')))}
function scopedPost(url){const rows=scopedRows(url),data=post();data.kpi.present=rows.length;data.kpi.expected=rows.length+2;data.present=rows.map(row=>({employee:{...row,id:row.employee_id,fonction:'Agent'},entry:'08:00',badge:'EN_POSTE',badge_label:'EN POSTE'}));return data}
async function configure(page){
 await page.evaluateOnNewDocument(()=>localStorage.setItem('atlas_pointer_session',JSON.stringify({token:'fixture',user:{username:'FIXTURE',full_name:'AGENT POINTEUR 01'}})));
 await page.setRequestInterception(true);page.on('request',req=>{
  const url=new URL(req.url());if(url.pathname.startsWith('/api/')){
   let data={};if(url.pathname.endsWith('attendance-sites'))data=sites;
   else if(url.pathname.endsWith('attendance-live'))data={latest_event_id:revision,latest_refusal_id:0,events:revision>1?[{id:revision,type:'ENTREE',employee,site:'SITE TEST',heure:'08:00:00'}]:[],refusals:[],summary:{entries_today:revision,exits_today:0,present_now:revision,absent_today:0},post:scopedPost(url)};
   else if(url.pathname.endsWith('attendance-feed'))data=scopedRows(url);
   else if(url.pathname.endsWith('attendance-manual/search'))data=[{...employee,societe:url.searchParams.get('society')||employee.societe,site:url.searchParams.get('society')===societies[1]?sites[1].name:sites[0].name}];
   else if(url.pathname.endsWith('attendance-sheet'))data={configured:false};
   else if(url.pathname.endsWith('attendance-staffing'))data={sites:[],contractual:{source:'dc-unconfigured'}};
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  if(url.hostname!=='127.0.0.1')return req.respond({status:200,contentType:'application/javascript',body:''});
  req.continue();
 });
}
test('Chrome : deux blocs, sociétés, suivi indépendant et synchronisation', {skip:!fs.existsSync(chrome),timeout:60000},async()=>{
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local');const file=url.pathname.startsWith('/static/')?path.join(root,url.pathname.slice(8)):path.join(root,'pointeur.html');if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);return res.end()}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await configure(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url='http://127.0.0.1:'+server.address().port;
  await page.goto(url);await page.waitForSelector('#trackingBody tr');
  assert.deepEqual(await page.$$eval('#societySelector option',opts=>opts.map(o=>o.textContent.trim())),['Toutes les sociétés',...societies]);
  for(const [society,expected] of [[societies[0],['','1']],[societies[1],['','2']],['',['','1','2']]]){
   await page.select('#societySelector',society);
   assert.deepEqual(await page.$$eval('#siteSelector option',opts=>opts.map(o=>o.value)),expected);
   await page.waitForFunction(n=>document.querySelectorAll('#trackingBody tr').length===n,{},society?20:40);
   const state=await page.evaluate(()=>({rows:document.querySelectorAll('#presentNowList .v5-person').length,present:document.querySelectorAll('#postKpis b')[1].textContent}));assert.equal(state.rows,society?20:40);assert.equal(Number(state.present),society?20:40);
  }
  await page.select('#societySelector',societies[0]);
  await page.click('#manualQuery');await page.type('#manualQuery','TEST10');await page.waitForSelector('.manual-result-row');await page.click('.manual-result-row');
  for(const [width,height] of [[1920,1080],[1600,900],[1440,900],[1366,768],[390,844]]){
   await page.setViewport({width,height});await new Promise(r=>setTimeout(r,150));
   const layout=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width}};return {header:rect(document.querySelector('.top')),upper:rect(document.querySelector('.station-upper')),lower:rect(document.getElementById('movementsCard')),height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth}});
   assert.ok(layout.lower.bottom<=height+1,JSON.stringify(layout));assert.ok(layout.lower.height>height*.2,JSON.stringify(layout));assert.ok(layout.scroll<=height+1,JSON.stringify(layout));assert.ok(layout.scrollWidth<=width+1,JSON.stringify(layout));assert.ok(layout.upper.height/layout.lower.height>1.8&&layout.upper.height/layout.lower.height<2.2,JSON.stringify(layout));
   for(const selector of ['#societySelector','#siteSelector','.manual-actions']){const r=await page.$eval(selector,e=>({height:e.getBoundingClientRect().height,right:e.getBoundingClientRect().right}));assert.ok(r.height>0&&r.right<=width+1,selector+JSON.stringify(r))}
   const buttons=await page.$$eval('.manual-actions button',items=>items.map(b=>({text:b.textContent,height:b.getBoundingClientRect().height})));assert.equal(buttons.length,3);assert.ok(buttons.every(b=>b.height<=42));
   assert.equal(await page.$('#shiftBanner'),null);
   assert.ok(await page.$eval('.employee-photo',e=>e.complete&&e.naturalWidth>0));
   assert.equal(await page.$eval('.tracking-scroll',e=>e.scrollHeight>e.clientHeight),true);
   if(width>700)assert.equal(await page.$eval('#presentNowList',e=>e.scrollHeight>e.clientHeight),true);
   await page.screenshot({path:captures+'/poste-'+width+'x'+height+'.png'});
  }
  await page.setViewport({width:1920,height:1080});
  for(const [tab,column] of [['entries','Mode'],['exits','Durée de présence'],['anomalies','Type anomalie']]){
   await page.evaluate(t=>setTrackingTab(t),tab);assert.ok((await page.$eval('#trackingHead',e=>e.textContent)).includes(column));
  }
  await page.evaluate(()=>setTrackingTab('today'));
  await page.select('#societySelector',societies[1]);
  await page.click('#qrModeBtn');
  const targetPromise=browser.waitForTarget(t=>t.url().endsWith('/pointeur/suivi'));
  await page.click('#detachTracking');const target=await targetPromise;const child=await target.page();await configure(child);await child.reload();await child.waitForSelector('#trackingBody tr');
  await child.setViewport({width:1920,height:1080});
  assert.equal(await child.$eval('.station-upper',e=>getComputedStyle(e).display),'none');
  assert.equal(await child.$eval('.brand-sub',e=>getComputedStyle(e).display),'block');
  assert.equal(await child.$eval('.brand-sub',e=>e.textContent.trim()),'Suivi détaillé des pointages');
  assert.ok(await child.$eval('#trackingDate',e=>e.getBoundingClientRect().height>0));
  await child.screenshot({path:captures+'/suivi-detache-1920x1080.png'});
  await child.select('#societySelector',societies[0]);await page.waitForFunction(()=>document.getElementById('societySelector').value==='IRON GLOBAL SÉCURITÉ');
  await child.select('#siteSelector','1');await page.waitForFunction(()=>document.getElementById('siteSelector').value==='1');
  assert.deepEqual(await child.$$eval('#societySelector option',opts=>opts.map(o=>o.textContent.trim())),['Toutes les sociétés',...societies]);
  const count=(await browser.pages()).length;await page.click('#detachTracking');assert.equal((await browser.pages()).length,count);
  revision=2;await page.waitForFunction(()=>document.getElementById('trackingBody').textContent.includes('EMPLOYÉ TEST 2'));await child.waitForFunction(()=>document.getElementById('trackingBody').textContent.includes('EMPLOYÉ TEST 2'));assert.equal(await page.$eval('#postKpis',e=>e.textContent),await child.$eval('#postKpis',e=>e.textContent));
  await child.close();await page.click('#detachTracking');await browser.waitForTarget(t=>t.url().endsWith('/pointeur/suivi'));
  await page.evaluate(()=>togglePointerFullscreen());assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);await page.evaluate(()=>togglePointerFullscreen());assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r))}
});
