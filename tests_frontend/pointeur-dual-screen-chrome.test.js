const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const puppeteer=require('puppeteer-core');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root=path.join(__dirname,'../app/static');
const societies=['IRON GLOBAL SÉCURITÉ','IRON GLOBAL SOLUTION'];
const sites=societies.map((society,i)=>({id:i+1,name:'SITE TEST '+(i+1),society}));
const employee={id:10,matricule:'TEST10',nom:'EMPLOYÉ TEST',prenom:'Fixture',poste:'Agent',societe:societies[0],site:sites[0].name};
let revision=1;
const event=()=>({...employee,employee_id:10,nom:'EMPLOYÉ TEST '+revision,action:'arrivee',scanned_at:new Date().toISOString().slice(0,10)+'T08:00:00+01:00',site_id:1,source:'MANUAL'});
const post=()=>({site:'SITE TEST',status:'NORMAL',current:null,next:null,maintien:null,kpi:{expected:12,present:revision,absent:2,maintien:0,anomalies:0},present:[{employee:{...employee,fonction:'Agent'},entry:'08:00',badge:'EN_POSTE',badge_label:'EN POSTE'}],todo:[],movements:[],activity:{refused_today:0},permissions:{manual_entry:true}});
async function configure(page){
 await page.evaluateOnNewDocument(()=>localStorage.setItem('atlas_pointer_session',JSON.stringify({token:'fixture',user:{username:'FIXTURE',full_name:'Agent test'}})));
 await page.setRequestInterception(true);page.on('request',req=>{
  const url=new URL(req.url());if(url.pathname.startsWith('/api/')){
   let data={};if(url.pathname.endsWith('attendance-sites'))data=sites;
   else if(url.pathname.endsWith('attendance-live'))data={latest_event_id:revision,latest_refusal_id:0,events:revision>1?[{id:revision,type:'ENTREE',employee,site:'SITE TEST',heure:'08:00:00'}]:[],refusals:[],summary:{entries_today:revision,exits_today:0,present_now:revision,absent_today:0},post:post()};
   else if(url.pathname.endsWith('attendance-feed'))data=[event()];
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
  for(const [width,height] of [[1920,1080],[1600,900],[1440,900],[1366,768],[390,844]]){
   await page.setViewport({width,height});await new Promise(r=>setTimeout(r,100));
   const layout=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width}};return {header:rect(document.querySelector('.top')),upper:rect(document.querySelector('.station-upper')),lower:rect(document.getElementById('movementsCard')),height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth}});
   assert.ok(layout.lower.bottom<=height+1,JSON.stringify(layout));assert.ok(layout.lower.height>height*.2,JSON.stringify(layout));assert.ok(layout.scroll<=height+1,JSON.stringify(layout));assert.ok(layout.scrollWidth<=width+1,JSON.stringify(layout));assert.ok(layout.upper.height/layout.lower.height>1.8&&layout.upper.height/layout.lower.height<2.2,JSON.stringify(layout));
  }
  await page.setViewport({width:1920,height:1080});await page.select('#societySelector',societies[1]);
  assert.deepEqual(await page.$$eval('#siteSelector option',opts=>opts.map(o=>o.value)),['','2']);
  assert.equal(await page.$('#shiftBanner'),null);
  await page.screenshot({path:'/private/tmp/pointeur-dual-screen-desktop.png'});
  await page.click('#manualQuery');await page.type('#manualQuery','TEST10');await page.waitForSelector('.manual-result-row');await page.click('.manual-result-row');
  const buttons=await page.$$eval('.manual-actions button',items=>items.map(b=>({text:b.textContent,height:b.getBoundingClientRect().height})));
  assert.equal(buttons.length,3);assert.ok(buttons.every(b=>b.height<=42),JSON.stringify(buttons));
  await page.screenshot({path:'/private/tmp/pointeur-dual-screen-manual.png'});
  await page.click('#qrModeBtn');
  const targetPromise=browser.waitForTarget(t=>t.url().endsWith('/pointeur/suivi'));
  await page.click('#detachTracking');const target=await targetPromise;const child=await target.page();await configure(child);await child.reload();await child.waitForSelector('#trackingBody tr');
  assert.equal(await child.$eval('.station-upper',e=>getComputedStyle(e).display),'none');
  await child.select('#societySelector',societies[0]);await page.waitForFunction(()=>document.getElementById('societySelector').value==='IRON GLOBAL SÉCURITÉ');
  const count=(await browser.pages()).length;await page.click('#detachTracking');assert.equal((await browser.pages()).length,count);
  revision=2;await page.waitForFunction(()=>document.getElementById('trackingBody').textContent.includes('EMPLOYÉ TEST 2'));await child.waitForFunction(()=>document.getElementById('trackingBody').textContent.includes('EMPLOYÉ TEST 2'));assert.equal(await page.$eval('#postKpis',e=>e.textContent),await child.$eval('#postKpis',e=>e.textContent));
  await child.close();await page.click('#detachTracking');await browser.waitForTarget(t=>t.url().endsWith('/pointeur/suivi'));
  await page.evaluate(()=>togglePointerFullscreen());assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);await page.evaluate(()=>togglePointerFullscreen());assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r))}
});
