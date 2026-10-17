// Real candidate web export + real isolated server. No SMS, push, email or production access.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const ROOT=path.join(__dirname,'..'),PYTHON=process.env.ATLAS_E2E_PYTHON||'python3',CHROME=process.env.PUPPETEER_EXECUTABLE_PATH;
let puppeteer;try{puppeteer=require('puppeteer-core');}catch{}
const skip=!CHROME||!puppeteer||!fs.existsSync(path.join(ROOT,'app/static/emploi-app/index.html'))?'Requires Chrome, puppeteer-core and the web export':false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function click(page,text){for(const button of await page.$$('[role=button],button'))if((await button.evaluate(el=>el.textContent.trim()))===text){await button.click();return;}assert.fail('Missing button: '+text);}
test('candidate website: catalogue, filters, real SMS authentication, CV upload and application in the recruiter inbox',{skip,timeout:180000},async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'emploi-web-')),port=8973,base=`http://127.0.0.1:${port}`,gateway='web-test-gateway-not-a-production-key';
 const env={...process.env,PYTHONPATH:ROOT,DATABASE_URL:`sqlite:///${tmp}/db.sqlite`,JWT_SECRET:'emploi-web-isolated-test-secret-key-2026',APP_ENV:'test',LOG_LEVEL:'ERROR',SGDI_UPLOADS_DIR:path.join(tmp,'uploads'),STARTUP_MAINTENANCE_ENABLED:'false',RECRUITMENT_SMS_ENABLED:'true',RECRUITMENT_SMS_PROVIDER:'poll',RECRUITMENT_SMS_GATEWAY_KEY:gateway,RECRUITMENT_PUSH_ENABLED:'false',SMTP_HOST:'',SMTP_USERNAME:'',SMTP_PASSWORD:'',SMTP_FROM_EMAIL:'',CONVOCATION_SMTP_HOST:'',LOGIN_MAX_ATTEMPTS:'1000000'};
 const log=fs.openSync(path.join(tmp,'server.log'),'w');let server,browser;
 t.after(async()=>{if(browser)await browser.close();if(server){server.kill('SIGTERM');await delay(400);if(server.exitCode===null)server.kill('SIGKILL');}fs.closeSync(log);fs.rmSync(tmp,{recursive:true,force:true});});
 execFileSync(PYTHON,['-c',`import app.main\nfrom app.db.base import Base\nfrom app.db.session import engine,SessionLocal\nfrom app.modules.auth.models import User\nfrom app.core.security import hash_password\nBase.metadata.create_all(engine)\ns=SessionLocal();s.add(User(username='WebQA',full_name='Recruteur Web Test',email='webqa@example.test',validation_password_hash=hash_password('validation-test'),password_hash=hash_password('WebQa-local-only'),role='recruteur',access_level='H3',authorized_modules=['recrute'],authorized_actions=['read','create','update'],authorized_societies=['IRON GLOBAL SÉCURITÉ'],is_active=True));s.commit()`],{cwd:tmp,env,stdio:['ignore','ignore','pipe']});
 server=spawn(PYTHON,['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(port)],{cwd:tmp,env,stdio:['ignore',log,log]});
 for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await delay(250);}
 const api=async(route,{token,body,method,headers={}}={})=>{const r=await fetch(base+'/api'+route,{method:method||(body===undefined?'GET':'POST'),headers:{...headers,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.ok(r.ok,`${route}: ${r.status} ${JSON.stringify(data)}`);return data;};
 const staff=(await api('/auth/login',{body:{username:'WebQA',password:'WebQa-local-only'}})).access_token;
 const offer=await api('/drh/job-offers',{token:staff,body:{title:'Superviseur web de test',society:'IRON GLOBAL SÉCURITÉ',wilaya:'Alger',contract_type:'CDI',missions:'Mission de démonstration',profile:'Profil de démonstration'}});
 await api(`/drh/job-offers/${offer.id}/publish`,{token:staff,method:'POST'});
 await api('/public/mobile/gateway/poll',{body:{},headers:{'X-SMS-Gateway-Key':gateway}});
 browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.setViewport({width:1440,height:950});await page.goto(base+'/emploi',{waitUntil:'networkidle0'});await page.waitForSelector('.offer-card');
 if(process.env.EMPLOI_SCREENSHOT_DIR){fs.mkdirSync(process.env.EMPLOI_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.EMPLOI_SCREENSHOT_DIR,'emploi-1440.png'),fullPage:true});}
 assert.match(await page.$eval('.offer-card',el=>el.textContent),/Superviseur web de test/);
 await page.select('select[name=wilaya]','Alger');await page.click('#offer-search button[type=submit]');await page.waitForFunction(()=>document.querySelector('#offer-results').getAttribute('aria-busy')==='false');
 await page.click('.offer-link');await page.waitForSelector('[role=button]');await page.waitForFunction(()=>document.body.textContent.includes('Postuler'));
 await click(page,'Postuler');await page.waitForSelector('input[aria-label="Nom"]');
 await page.type('input[aria-label="Nom"]','Webtest');await page.type('input[aria-label="Prénom"]','Nadia');await page.type('input[aria-label="Numéro de téléphone, sans l’indicatif"]','0551234567');
 await click(page,'Recevoir le code par SMS');await page.waitForSelector('input[aria-label="Code de validation"]');
 const job=(await api('/public/mobile/gateway/poll',{body:{},headers:{'X-SMS-Gateway-Key':gateway}})).job;assert.ok(job);
 const sessionResponse=page.waitForResponse(r=>r.url().endsWith('/api/public/emploi/session')&&r.request().method()==='POST');
 await page.type('input[aria-label="Code de validation"]',/\b\d{6}\b/.exec(job.message)[0]);await click(page,'Valider mon accès');
 const token=(await(await sessionResponse).json()).session_token;assert.ok(token);
 const config=await api('/public/emploi/config');await api('/public/emploi/me/profile',{token,method:'PUT',body:{desired_position:'Superviseur',wilaya:'Alger',commune:'Hydra',address:'Adresse fictive',birth_date:'1994-03-12',sex:'F',privacy_consent:true,privacy_version:config.privacy_version}});
 // Profile fields share the existing form; prefill here to isolate web file selection and submission.
 await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>document.body.textContent.includes('Envoyer ma candidature'));
 execFileSync(PYTHON,[path.join(ROOT,'mobile/recruitment/scripts/test-env/cv_fictif.py'),tmp],{cwd:tmp});const cv=path.join(tmp,'CV-web.pdf');fs.copyFileSync(path.join(tmp,'cv-fictif.pdf'),cv);
 const chooser=page.waitForFileChooser();await page.click('[aria-label="Ajouter un CV, PDF, JPG ou PNG, 5 Mo maximum"]');await(await chooser).accept([cv]);await page.waitForFunction(()=>document.body.textContent.includes('CV-web.pdf'));
 await click(page,'Envoyer ma candidature');await page.waitForFunction(()=>document.body.textContent.includes('Candidature envoyée')||document.body.textContent.includes('candidature a bien'));
 const list=await api(`/drh/job-offers/${offer.id}/applications`,{token:staff});assert.equal(list.items.length,1);
 const dossier=await api(`/drh/job-offers/applications/${list.items[0].application_id}`,{token:staff});assert.ok(dossier.documents.some(doc=>doc.name==='CV-web.pdf'));
 await page.goto(base+`/espace/offers/${offer.id}`,{waitUntil:'networkidle0'});assert.match(await page.$eval('body',el=>el.textContent),/Superviseur web de test/);
 await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.goto(base+'/emploi',{waitUntil:'networkidle0'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.EMPLOI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.EMPLOI_SCREENSHOT_DIR,'emploi-390.png'),fullPage:true});
 assert.deepEqual(errors,[]);
});
