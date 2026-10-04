// Real central authentication and delegated Pointage management, on a disposable local DB.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
let puppeteer;try{puppeteer=require('puppeteer-core');}catch{}
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT=path.join(__dirname,'..'),PORT=8974,BASE=`http://127.0.0.1:${PORT}`,PASSWORD='Pointer-E2E-Test-1234',ARTIFACTS=process.env.ATLAS_POINTER_E2E_ARTIFACTS||'/tmp/atlas-pointer-users';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(route,{token,method='GET',body,host}={}){const response=await fetch(BASE+'/api'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(host?{Host:host}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:response.status,data:await response.json()};}
async function fill(page,selector,value){await page.click(selector,{clickCount:3});await page.keyboard.press('Backspace');await page.type(selector,value);}
async function textButton(page,selector,label){for(const b of await page.$$(selector)){if((await b.evaluate(x=>x.textContent)).includes(label)){await b.click();return;}}throw Error(label);}
test('Pointeurs : Chrome réel, utilisateur central, authentification, scope, modification et désactivation',{skip:!puppeteer||!fs.existsSync(CHROME),timeout:180000},async t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'atlas_pointer_users_'));fs.mkdirSync(ARTIFACTS,{recursive:true});
 const env={...process.env,PYTHONPATH:ROOT,DATABASE_URL:'sqlite:///'+path.join(tmp,'db.sqlite'),APP_ENV:'test',JWT_SECRET:'pointer-e2e-local-only-secret',ADMIN_SYSTEM_USERNAME:'UIADMIN',ADMIN_SYSTEM_PASSWORD:PASSWORD,SGDI_UPLOADS_DIR:path.join(tmp,'uploads'),LOGIN_MAX_ATTEMPTS:'1000000',LOG_LEVEL:'ERROR',STARTUP_MAINTENANCE_ENABLED:'false',BIOMETRIC_ENABLED:'false',BIOMETRIC_MODELS_DIR:'/nonexistent',SMTP_HOST:''};
 const log=fs.openSync(path.join(ARTIFACTS,'server.log'),'w'),server=spawn('python3',['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(PORT)],{cwd:ROOT,env,stdio:['ignore',log,log]});fs.closeSync(log);let browser;const errors=[];
 t.after(async()=>{if(browser)await browser.close();server.kill('SIGTERM');await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});});
 let admin;for(let i=0;i<120;i++){try{admin=await api('/auth/admin-system-login',{method:'POST',body:{username:'UIADMIN',password:PASSWORD}});if(admin.status===200)break;}catch{}await sleep(250);}assert.equal(admin?.status,200);
 const ids=JSON.parse(execFileSync('python3',['-c',`import app.main
import json
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User,UserFeaturePermission
from app.modules.ops.models import Site
with SessionLocal() as db:
 sites=[Site(name=n,active=1,equipment_plan={'societe':s}) for n,s in [('HAMOUL 01','IRON GLOBAL SOLUTION'),('HAMOUL 02','IRON GLOBAL SOLUTION'),('INTERDIT','OTHER')]]
 db.add_all(sites);db.flush()
 manager=User(username='PTG_MANAGER',full_name='Responsable Pointage',role='agent',password_hash=hash_password('${PASSWORD}'),is_active=True,authorized_modules=['pointage'],authorized_actions=['read','create','update'],authorized_societies=['IRON GLOBAL SOLUTION'],authorized_sites=[s.id for s in sites[:2]])
 db.add(manager);db.flush()
 for action in ['read','create','update']:db.add(UserFeaturePermission(user_id=manager.id,module_key='administration',feature_key='users',action_key=action))
 admin=db.query(User).filter(User.username=='UIADMIN').one();admin.email='admin@example.com';admin.validation_password_hash=hash_password('${PASSWORD}')
 db.commit();print(json.dumps([s.id for s in sites]))`],{cwd:ROOT,env}).toString().trim().split('\n').pop());
 browser=await puppeteer.launch({executablePath:CHROME,headless:'new',userDataDir:path.join(tmp,'chrome'),args:['--no-first-run','--no-proxy-server',`--host-resolver-rules=MAP pointeur.irongs.com 127.0.0.1`]});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
 await page.goto(BASE+'/static/pointage/index.html');await page.type('#login-user','PTG_MANAGER');await page.type('#login-pass',PASSWORD);await page.click('#login-btn');await page.waitForSelector('#app:not(.hidden)');await page.click('#pointer-nav');await page.waitForFunction(()=>document.querySelector('#pointer-state').textContent==='');
 await page.click('#pointer-add');await page.waitForSelector('#pointer-form');for(const width of [390,1440]){await page.setViewport({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(ARTIFACTS,`pointer-form-${width}.png`),fullPage:true});}await page.type('#pointer-form [name="full_name"]','Pointeur Oran');await page.type('#pointer-form [name="username"]','PTG01');await page.type('#pointer-form [name="password"]',PASSWORD);
 assert.equal(await page.$$eval('#pointer-form [name="site_ids"]',x=>x.length),2);await page.click('#pointer-form [name="societies"]');await page.click(`#pointer-form [name="site_ids"][value="${ids[0]}"]`);await page.click('#pointer-form [type="submit"]');await page.waitForSelector('[data-pointer-id]');
 const manager=await api('/auth/login',{method:'POST',body:{username:'PTG_MANAGER',password:PASSWORD}}),mt=manager.data.access_token;
 const created=(await api('/attendance/pointers',{token:mt})).data.items.find(u=>u.username==='PTG01');assert.ok(created);
 await page.click(`[data-pointer-edit="${created.id}"]`);await page.waitForSelector('#pointer-form');await fill(page,'#pointer-form [name="full_name"]','Pointeur Oran modifié');await page.click(`#pointer-form [name="site_ids"][value="${ids[1]}"]`);await page.click('#pointer-form [type="submit"]');await page.waitForFunction(()=>document.querySelector('#pointer-rows').textContent.includes('modifié'));
 for(const width of [1440,1024,768,390]){await page.setViewport({width,height:1000});await page.screenshot({path:path.join(ARTIFACTS,`pointers-${width}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}await page.setViewport({width:1440,height:1000});
 await page.click('#logout-btn');await page.goto(`http://pointeur.irongs.com:${PORT}/static/pointeur.html`);await page.type('#username','PTG01');await page.type('#password',PASSWORD);await page.click('#loginBtn');await page.waitForSelector('#loginView.hidden');await page.waitForFunction(()=>document.querySelector('#siteSelector').options.length===2);
 assert.deepEqual(await page.$$eval('#siteSelector option',els=>els.map(e=>Number(e.value))),ids.slice(0,2));await page.screenshot({path:path.join(ARTIFACTS,'pointeur-authenticated.png'),fullPage:true});
 const authenticated=await api('/auth/login',{method:'POST',host:'pointeur.irongs.com',body:{username:'PTG01',password:PASSWORD}});assert.equal(authenticated.status,200);const pt=authenticated.data.access_token;
 assert.equal((await api('/portal/attendance-manual/search?site_id='+ids[2]+'&q=XX',{token:pt,host:'pointeur.irongs.com'})).status,403);
 for(const route of ['/drh/employees','/ops/sites','/auth/users','/attendance/pointers'])assert.equal((await api(route,{token:pt})).status,403);
 await page.goto(BASE+'/static/pointage/index.html');await page.type('#login-user','PTG_MANAGER');await page.type('#login-pass',PASSWORD);await page.click('#login-btn');await page.waitForSelector('#app:not(.hidden)');await page.click('#pointer-nav');await page.waitForSelector(`[data-pointer-id="${created.id}"]`);page.once('dialog',d=>d.accept());await page.click(`[data-pointer-disable="${created.id}"]`);await page.waitForFunction(()=>document.querySelector('#pointer-rows').textContent.includes('Désactivé'));
 assert.equal((await api('/auth/login',{method:'POST',host:'pointeur.irongs.com',body:{username:'PTG01',password:PASSWORD}})).status,401);assert.equal((await api('/auth/me',{token:pt})).status,401);
 await page.click('#logout-btn');await page.goto(BASE+'/#/login',{waitUntil:'networkidle0'});await page.waitForFunction(()=>!('serviceWorker' in navigator)||navigator.serviceWorker.controller,{timeout:30000});await page.waitForNetworkIdle({idleTime:700,timeout:15000});await page.waitForSelector('.login-admin-system-shortcut');await page.click('.login-admin-system-shortcut');await fill(page,'#modal-host [name="username"]','UIADMIN');await page.type('#modal-host [name="password"]',PASSWORD);await textButton(page,'#modal-host button','Valider');await page.waitForSelector('#sidebar-nav [data-route="admin/users"]');await page.waitForNetworkIdle({idleTime:700,timeout:15000});await page.locator('#sidebar-nav [data-route="admin/users"]').click();await page.waitForSelector('.admin-users-page');
 assert.ok((await api('/auth/users',{token:admin.data.access_token})).data.some(u=>u.id===created.id&&u.role==='pointeur'&&!u.is_active));
 await page.evaluate(()=>{const search=document.querySelector('#admin-users-search');if(search){search.value='PTG01';search.dispatchEvent(new Event('input',{bubbles:true}));}});await sleep(300);assert.match(await page.$eval('.admin-users-page',e=>e.textContent),/PTG01/);await page.screenshot({path:path.join(ARTIFACTS,'central-administration.png'),fullPage:true});assert.deepEqual(errors,[]);
 t.diagnostic('Captures : '+ARTIFACTS);
});
