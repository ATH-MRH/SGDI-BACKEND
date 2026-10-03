// ATLAS Administration Utilisateurs V2 — recette Chrome réelle, serveur et SQLite isolés.
// Lancer : node --test tests_frontend/admin-users-v2-e2e.test.js
// Chrome/Puppeteer suivent le même contrat que site-workforce-e2e.test.js.
// Aucun mock réseau, aucune injection dans le store applicatif. Les API ne servent
// qu'à vérifier le démarrage et à relire le résultat des actions effectuées dans l'UI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { once } = require('events');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const PORT = Number(process.env.ATLAS_ADMIN_USERS_E2E_PORT || 8957);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'AtlasLocalV2!2026'; // Compte jetable de la base E2E exclusivement.
const SOC_A = 'IRON GLOBAL SOLUTION';
const SOC_B = 'IRON GLOBAL SÉCURITÉ';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(p => fs.existsSync(p));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite ci-dessous */ }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(endpoint, { method = 'GET', token, body } = {}) {
  const response = await fetch(BASE + '/api' + endpoint, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
async function replaceInput(page, selector, text) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (text) await page.type(selector, text);
}
async function clickText(page, selector, text) {
  const handles = await page.$$(selector);
  let selected;
  for (const handle of handles) {
    if ((await handle.evaluate(el => el.textContent.trim())).includes(text)) { selected = handle; break; }
  }
  assert.ok(selected, `bouton absent : ${selector} / ${text}`);
  await selected.click();
  await Promise.all(handles.map(handle => handle.dispose()));
}
async function usersReady(page) {
  await page.waitForSelector('.admin-users-page', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#admin-user-visible-count')?.textContent.includes('19') && !document.querySelector('#admin-users-status')?.textContent.trim(), { timeout: 15000 });
}
async function resetFilters(page) {
  if (!await page.$eval('.admin-users-advanced-toggle', el => el.getAttribute('aria-expanded') === 'true')) await page.click('.admin-users-advanced-toggle');
  await page.click('#admin-users-advanced button');
  await usersReady(page);
}
async function visibleNames(page) {
  return page.$$eval('#admin-users-rows .admin-user-identity b', els => els.map(el => el.textContent));
}

test('Administration User Wizard V3 — Chrome réel', { timeout: 180000, skip: !CHROME ? 'Chrome introuvable : PUPPETEER_EXECUTABLE_PATH requis' : !puppeteer ? 'puppeteer-core absent' : false }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-admin-users-v2-'));
  const artifacts = process.env.ATLAS_ADMIN_USERS_ARTIFACTS || path.join(os.tmpdir(), 'atlas-admin-user-wizard-v3');
  fs.mkdirSync(artifacts, { recursive: true });
  const env = {
    ...process.env, PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR',
    DATABASE_URL: `sqlite:///${path.join(tmp, 'test.db')}`, JWT_SECRET: 'atlas-users-v2-e2e-temporary-secret-2026',
    ADMIN_SYSTEM_USERNAME: 'UIADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000',
    STARTUP_MAINTENANCE_ENABLED: 'false', SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '',
  };
  const output = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  let server, browser, page, adminToken, siteIds;
  const pageErrors = [], consoleErrors = [], requests = [];
  t.after(async () => {
    if (page) await page.screenshot({ path: path.join(artifacts, 'last-state.png'), fullPage: true }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(4000)]); if (server.exitCode === null) server.kill('SIGKILL'); }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test('serveur isolé + fixtures sociétés/sites/19 comptes et BEO canonique', async () => {
    assert.ok(Number.isInteger(PORT) && PORT > 1024 && PORT < 65536);
    // CWD temporaire = aucune lecture implicite d'un .env du dépôt.
    server = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PORT)], { cwd: tmp, env, stdio: ['ignore', output, output] });
    let login;
    for (let attempt = 0; attempt < 70; attempt++) {
      assert.equal(server.exitCode, null, 'échec serveur : consulter server.log');
      try { login = await api('/auth/admin-system-login', { method: 'POST', body: { username: 'UIADMIN', password: PASSWORD } }); if (login.status === 200) break; } catch (_) {}
      await delay(200);
    }
    assert.equal(login?.status, 200, 'administrateur temporaire non disponible');
    adminToken = login.data.access_token;
    const seed = `
import json
import app.main
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.ops.models import Site
from app.modules.auth.service import _validate_beo_scope
s=SessionLocal()
a,b=${JSON.stringify(SOC_A)},${JSON.stringify(SOC_B)}
sites=[Site(name=n,active=1,equipment_plan={'societe':soc}) for n,soc in [('TEST DHL Alger',a),('TEST DHL Oran',a),('TEST DHL Blida',a),('TEST Sécurité Alger',b),('TEST Sécurité Oran',b)]]
s.add_all(sites);s.flush()
ids=[x.id for x in sites]
pwh=hash_password(${JSON.stringify(PASSWORD)})
admin=s.query(User).filter_by(username='UIADMIN').one()
admin.email='admin@example.com';admin.full_name='Administration TEST';admin.validation_password_hash=pwh
fixtures=[('CE01','Chargé effectifs TEST','charge_effectifs_site','H2',[a],[ids[0]],['site_workforce'],True),('OPS01','Opérations TEST','ops','H3',[a],ids[:3],['ops'],True),('DRH01','Ressources humaines TEST','drh','H3',[a,b],[],['drh'],True)]
fixtures += [(f'USR{i:02d}',f'Utilisateur test {i:02d}','agent','H1',[a if i%2 else b],[ids[1 if i%2 else 4]],['ops'],i not in (4,8)) for i in range(1,16)]
for name,full,role,level,societies,scope,modules,active in fixtures:
    _validate_beo_scope(s,role=role,modules=modules,societies=societies,sites=scope,global_society_access=False)
    s.add(User(username=name,full_name=full,email=None if name=='USR05' else name.lower()+'@example.com',role=role,access_level=level,authorized_societies=societies,authorized_sites=scope,authorized_modules=modules,authorized_structures=['ops'] if modules==['ops'] else [],authorized_actions=['read','create','update'],global_society_access=False,is_active=active,password_hash=pwh,validation_password_hash=pwh))
s.commit()
print(json.dumps(ids))
s.close()
`;
    siteIds = JSON.parse(execFileSync(PYTHON, ['-c', seed], { cwd: tmp, env, encoding: 'utf8' }).trim().split('\n').pop());
    const users = await api('/auth/users', { token: adminToken });
    assert.equal(users.data.length, 19);
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'chrome'), args: ['--no-first-run', '--no-default-browser-check', '--ignore-certificate-errors'] });
    page = await browser.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('request', request => { const url = new URL(request.url()); if (url.origin === BASE && url.pathname.startsWith('/api/')) requests.push({ method: request.method(), path: url.pathname }); });
    page.on('dialog', async dialog => { if (dialog.type() === 'prompt') await dialog.accept(PASSWORD); else await dialog.accept(); });
    await page.setViewport({ width: 1440, height: 900 });
  });

  await t.test('connexion Administration système par le bouton dédié et hiérarchie de la page', async () => {
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.login-admin-system-shortcut');
    await page.click('.login-admin-system-shortcut');
    await replaceInput(page, '#modal-host input[name="username"]', 'UIADMIN');
    await page.type('#modal-host input[name="password"]', PASSWORD);
    await clickText(page, '#modal-host button', 'Valider');
    await page.waitForSelector('#sidebar-nav');
    await page.waitForSelector('#sidebar-nav [data-route="admin/users"]');
    await page.waitForNetworkIdle({idleTime:500,timeout:10000});
    await page.locator('#sidebar-nav [data-route="admin/users"]').click();
    await usersReady(page);
    assert.equal(await page.$eval('.admin-users-title h1', el => el.textContent), 'Gestion des utilisateurs');
    assert.equal(await page.$$eval('.admin-users-kpi', els => els.length), 5);
    assert.equal(await page.$$eval('.admin-users-head-actions button', els => els.length), 3);
    assert.match(await page.$eval('.admin-users-breadcrumb', el => el.textContent), /Administration système.*Identités & accès.*Utilisateurs/);
    assert.equal(await page.$$eval('[data-admin-user-row]', els => els.length), 10);
    assert.equal(await page.$eval('.admin-users-kpi strong', el => el.textContent), '19');
  });


  await t.test('assistant création réel et six largeurs sans débordement', async()=>{
    await page.click('.admin-users-head-actions button:last-child');
    await page.waitForSelector('.admin-user-wizard');
    for(const width of [1440,1280,1024,768,430,390]){
      await page.setViewport({width,height:1000});
      await delay(100);
      const measure=await page.evaluate(()=>{const f=document.querySelector('.admin-user-wizard'),m=f.closest('.modal');return{document:document.documentElement.scrollWidth,width:innerWidth,form:f.scrollWidth,formClient:f.clientWidth,modal:m.scrollWidth,modalClient:m.clientWidth,panels:[...f.querySelectorAll('[data-panel]')].filter(p=>!p.hidden).length}});
      assert.ok(measure.document<=width,JSON.stringify(measure));assert.ok(measure.form<=measure.formClient+1,JSON.stringify(measure));assert.equal(measure.panels,1);
      await page.screenshot({path:path.join(artifacts,'wizard-'+width+'.png'),fullPage:true});
    }
    await page.setViewport({width:1440,height:1000});
    await replaceInput(page,'.admin-user-wizard [name="nom"]','WIZARD LOCAL');
    await replaceInput(page,'.admin-user-wizard [name="email"]','wizard@example.com');
    await replaceInput(page,'.admin-user-wizard [name="password"]',PASSWORD);
    await replaceInput(page,'.admin-user-wizard [name="validationPassword"]',PASSWORD);
    await page.click('#auw-next');
    await page.waitForSelector('[data-panel="1"]:not([hidden])');
    await page.click('[name="module_ops"]');
    await page.screenshot({path:path.join(artifacts,'wizard-modules-1440.png'),fullPage:true});
    await page.click('#auw-prev');assert.equal(await page.$eval('[name="nom"]',e=>e.value),'WIZARD LOCAL');await page.click('#auw-next');
    await page.click('#auw-next');await page.waitForSelector('[data-panel="2"]:not([hidden])');
    await page.screenshot({path:path.join(artifacts,'wizard-roles-1440.png'),fullPage:true});
    await page.click('#auw-next');await page.waitForSelector('[data-panel="3"]:not([hidden])');
    await page.screenshot({path:path.join(artifacts,'wizard-sites-1440.png'),fullPage:true});
    await page.click('#auw-next');await page.waitForSelector('[data-panel="4"]:not([hidden])');
    assert.ok(!(await page.$eval('#auw-recap',e=>e.textContent)).includes(PASSWORD));
    const username=await page.$eval('[name="username"]',e=>e.value);
    await page.screenshot({path:path.join(artifacts,'wizard-recap-1440.png'),fullPage:true});
    const before=requests.length;
    await page.click('#auw-submit');await page.waitForFunction(()=>!document.querySelector('.admin-user-wizard'),{timeout:20000});
    assert.equal(requests.slice(before).filter(r=>r.method==='POST'&&r.path==='/api/auth/users').length,1);
    const saved=(await api('/auth/users',{token:adminToken})).data.find(u=>u.username===username);
    assert.ok(saved);assert.deepEqual(saved.authorized_modules,['ops']);assert.equal(saved.full_name,'WIZARD LOCAL');
  });
  await t.test('modification sans changement : périmètres et mots de passe conservés au serveur',async()=>{
    await page.waitForSelector('.admin-users-page');
    await replaceInput(page,'#admin-user-search','OPS01');
    await page.waitForFunction(()=>document.querySelectorAll('[data-admin-user-row]').length===1);
    const before=(await api('/auth/users',{token:adminToken})).data.find(u=>u.username==='OPS01');
    await page.click('button[aria-label="Modifier Opérations TEST"]');await page.waitForSelector('.admin-user-wizard');
    assert.equal(await page.$eval('[name="password"]',e=>e.value),'');
    for(let i=0;i<4;i++)await page.click('#auw-next');
    await page.click('#auw-submit');await page.waitForFunction(()=>!document.querySelector('.admin-user-wizard'),{timeout:20000});
    const after=(await api('/auth/users',{token:adminToken})).data.find(u=>u.username==='OPS01');
    for(const key of ['authorized_modules','authorized_structures','authorized_actions','authorized_societies','authorized_sites','access_level','role','is_active','global_society_access','has_validation_password'])assert.deepEqual(after[key],before[key],key);
    const login=await api('/auth/login',{method:'POST',body:{username:'OPS01',password:PASSWORD}});assert.equal(login.status,200);
    fs.writeFileSync(path.join(artifacts,'conservation.json'),JSON.stringify({username:'OPS01',before,after},null,2));
  });
  assert.deepEqual(pageErrors,[]);
  fs.writeFileSync(path.join(artifacts,'page-errors.json'),JSON.stringify(pageErrors));
  fs.writeFileSync(path.join(artifacts,'requests.json'),JSON.stringify(requests,null,2));
});
