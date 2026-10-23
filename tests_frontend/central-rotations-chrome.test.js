const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const puppeteer=require('puppeteer-core');
const chrome=[process.env.PUPPETEER_EXECUTABLE_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
const fragment='/* OPS owns official planning.'+fs.readFileSync('app/static/js/modules/ops.js','utf8').split('/* OPS owns official planning.')[1];
test('OPS central rotations — responsive form and dynamic regimes in real Chrome',{skip:!chrome,timeout:120000},async t=>{
 const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});t.after(()=>browser.close());
 const output=process.env.ATLAS_CENTRAL_ARTIFACTS||path.join(os.tmpdir(),'atlas-central-chrome');fs.mkdirSync(output,{recursive:true});
 for(const width of [1920,1440,1024,820,390]){
  const page=await browser.newPage();await page.setViewport({width,height:900});
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font:14px sans-serif}*{box-sizing:border-box}label{display:block}input,select,textarea{display:block;width:100%;max-width:100%}input[type=checkbox]{display:inline;width:auto}[hidden]{display:none!important}table{border-collapse:collapse}td,th{padding:8px}</style><main id="view"></main>');
  await page.evaluate(()=>{window.escapeHTML=s=>String(s).replace(/[<>]/g,'');window.sgdiApi=async()=>[{id:100,name:'Site synthétique',equipment_plan:{societe:'Structure test'},client_id:1}];});
  await page.addScriptTag({content:fragment});await page.evaluate(()=>renderCentralRotations(document.getElementById('view')));
  await page.waitForSelector('#centralForm');
  for(const regime of ['3X8','24H48','1/2','1/3']){
   await page.select('#centralForm [name=regime]',regime);
   const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,publish:document.querySelector('[data-publish]').disabled,visible:[...document.querySelectorAll('[data-regimes]')].filter(e=>!e.hidden).map(e=>e.dataset.regimes)}));
   assert.ok(state.overflow<=1,`${width}: overflow ${state.overflow}`);assert.equal(state.publish,true);assert.ok(state.visible.length>0);
  }
  await page.screenshot({path:path.join(output,`ops-central-${width}.png`),fullPage:true});await page.close();
 }
});
