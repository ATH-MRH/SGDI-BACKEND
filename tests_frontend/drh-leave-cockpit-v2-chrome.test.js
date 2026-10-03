// Chrome réel, shell de production, fixtures déterministes exclusivement dans ce test.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const puppeteer=require('puppeteer-core');
const root=path.join(__dirname,'..'),staticRoot=path.join(root,'app/static');
test('Congés V2: Chrome, shell V4 et six largeurs',async t=>{
 const server=http.createServer((req,res)=>{if(req.url.startsWith('/test')){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+['responsive-baseline.css','tailwind.min.css','sgdi-app.css','admin-users-v2.css','admin-users-shell.css','design-system/atlas.css'].map(file=>'<link rel="stylesheet" href="/static/'+file+'">').join('')+'</head><body class="atlas-ui" data-atlas-surface="legacy"><div id="app"></div><div id="modal-host"></div></body></html>')}const file=path.join(staticRoot,decodeURIComponent(req.url.split('?')[0]).replace(/^\/static\//,''));if(!file.startsWith(staticRoot)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});t.after(()=>browser.close());
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/test#/drh/conges`,{waitUntil:'domcontentloaded'});
 // Réseau neutralisé dans le banc; les assets et le rendu du shell restent ceux du projet.
 await page.evaluate(()=>{window.fetch=async()=>({ok:true,json:async()=>({}),text:async()=>''});window.setInterval=()=>0;window.EventSource=function(){this.close=()=>{};this.addEventListener=()=>{}};window.BroadcastChannel=function(){this.close=()=>{};this.postMessage=()=>{}}});
 for(const file of ['js/core/utils.js','js/core/module-registry.js','js/core/files.js','sgdi-app.js'])await page.addScriptTag({content:fs.readFileSync(path.join(staticRoot,file),'utf8')});
 for(const file of fs.readdirSync(path.join(staticRoot,'js/modules')).filter(f=>f.endsWith('.js')).sort())await page.addScriptTag({content:fs.readFileSync(path.join(staticRoot,'js/modules',file),'utf8')});
 await page.addScriptTag({content:`db=emptyDB();session={username:'RH-TEST',nom:'Contrôle visuel',role:'rh',transverse:'drh',societe:'IRON GLOBAL SOLUTION',actionsAutorisees:['read','create','update','validate','export']};sgdiHydrated=true;sgdiFullDataReady=true;
 db.agents=[{id:'a',nom:'ALPHA',prenom:'Amine',societe:'IRON GLOBAL SOLUTION',statut:'actif',dateRecrutement:'2020-01-01'},{id:'b',nom:'BETA',prenom:'Sara',societe:'IRON GLOBAL SOLUTION',statut:'actif',dateRecrutement:today()}];
 db.conges=[{id:'approved',agentId:'a',type:'Annuel',du:today(),au:congeAttribAddDays(today(),3),createdAt:today(),statut:'approuve'},{id:'pending',agentId:'b',type:'Exceptionnel',du:congeAttribAddDays(today(),2),au:congeAttribAddDays(today(),4),createdAt:today(),statut:'en_attente'}];renderInternal();`});
 await page.waitForSelector('.leave-cockpit-grid');
 const artifacts=process.env.ATLAS_LEAVE_ARTIFACTS||'/tmp/atlas-leave-cockpit-v2';fs.mkdirSync(artifacts,{recursive:true});
 for(const width of [1440,1280,1024,768,430,390]){
  await page.setViewport({width,height:1024});await page.evaluate(()=>renderInternal());await page.waitForSelector('.leave-cockpit-grid');
  const geometry=await page.evaluate(()=>{const card=document.querySelector('.leave-cockpit-grid'),kpis=document.querySelector('.leave-cockpit-kpis'),shell=document.querySelector('.atlas-shell-v4'),side=document.querySelector('.sidebar'),header=document.querySelector('.sgdi-topbar');return {width:innerWidth,doc:document.documentElement.scrollWidth,view:document.querySelector('#view').scrollWidth,viewClient:document.querySelector('#view').clientWidth,grid:card.getBoundingClientRect().toJSON(),columns:getComputedStyle(kpis).gridTemplateColumns.split(' ').length,shell:!!shell,side:getComputedStyle(side).backgroundColor,header:getComputedStyle(header).backgroundColor}});
  assert.ok(geometry.shell);assert.equal(geometry.header,'rgb(255, 255, 255)');assert.notEqual(geometry.side,'rgb(255, 255, 255)');assert.ok(geometry.doc<=width+2,JSON.stringify(geometry));assert.ok(geometry.view<=geometry.viewClient+2,JSON.stringify(geometry));assert.equal(geometry.columns,width>1100?4:width>600?2:1);
  if([1440,1024,768,390].includes(width)){
   // Augmenter la hauteur du viewport pour photographier tout le contenu;
   // les assertions ci-dessus sont effectuées à la hauteur réelle de 1024 px.
   const height=await page.$eval('#view',el=>Math.ceil(el.scrollHeight+el.getBoundingClientRect().top+30));
   await page.setViewport({width,height});await page.screenshot({path:path.join(artifacts,`conges-${width}.png`),fullPage:true});await page.setViewport({width,height:1024});
  }
  console.log(JSON.stringify(geometry));
 }
 // Les véritables handlers de la page sont exécutés.
 await page.click('.leave-latest tbody button');await page.waitForSelector('.modal-bg');assert.match(await page.$eval('.modal-bg',el=>el.textContent),/ALPHA|BETA/);await page.evaluate(()=>closeModal());
 await page.evaluate(()=>{session.actionsAutorisees=['read'];renderInternal()});assert.equal(await page.$$eval('.leave-cockpit-hero button',els=>els.some(e=>/Nouvelle demande|Attribuer|Exporter/.test(e.textContent))),false);
 await page.evaluate(()=>{db.agents=[];db.conges=[];renderInternal()});assert.equal(await page.$('.leave-donut'),null);assert.match(await page.$eval('.leave-cockpit-grid',el=>el.textContent),/Aucune priorité/);
 assert.deepEqual(errors,[],'Aucune erreur JavaScript dans Chrome');
});
