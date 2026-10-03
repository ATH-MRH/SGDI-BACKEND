// Commercial sidebar: genuine isolated API + Chrome, never production data.
// NODE_PATH may locate the declared puppeteer-core dependency.
// Optional: ATLAS_E2E_PYTHON, PUPPETEER_EXECUTABLE_PATH,
// ATLAS_COMMERCIAL_E2E_PORT, ATLAS_COMMERCIAL_E2E_ARTIFACTS.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { once } = require('events');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const PORT = Number(process.env.ATLAS_COMMERCIAL_E2E_PORT || 8972);
const BASE = `http://127.0.0.1:${PORT}`;
const DC = 'http://dc.irongs.com';
const ARTIFACTS = process.env.ATLAS_COMMERCIAL_E2E_ARTIFACTS || path.join(os.tmpdir(), 'atlas-commercial-sidebar-e2e');
const PASSWORD = 'CommercialUiLocal!2026';
const SOCIETY = 'IRON GLOBAL SOLUTION';
const OTHER_SOCIETY = 'IRON GLOBAL SÉCURITÉ';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(file => fs.existsSync(file));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* explicit skip below */ }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SIDEBAR = '.sgdi-commercial-shell .sidebar';
const routeSelector = route => `${SIDEBAR} .nav-link[data-route="${route}"]`;

async function api(endpoint, { method = 'GET', token, body } = {}) {
  const response = await fetch(BASE + '/api' + endpoint, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await response.text();
  let data;
  try { data = JSON.parse(content); } catch (_) { data = content; }
  return { status: response.status, data };
}
async function settled(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => document.getAnimations().filter(a => a.constructor.name === 'CSSTransition').every(a => a.playState !== 'running'), { timeout: 5000 });
}
async function clickText(page, selector, text) {
  for (const element of await page.$$(selector)) {
    if ((await element.evaluate(el => el.textContent)).includes(text) && await element.boundingBox()) { await element.click(); return; }
  }
  assert.fail('missing visible control: ' + text);
}
async function login(page, username = 'DC001', society = SOCIETY) {
  await page.goto(DC + '/#/login', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#login-form', { visible: true });
  await page.type('#login-form [name="username"]', username);
  await page.type('#login-form [name="password"]', PASSWORD);
  await page.click('.sgdi-login-submit');
  await page.waitForSelector('.module-host-soc-card', { visible: true, timeout: 20000 });
  await clickText(page, '.module-host-soc-card', society);
  // Company selection intentionally opens the existing Commercial portal first.
  await page.waitForSelector('.module-host-module', {visible:true});
  await page.goto(DC+'/#/commercial/dashboard',{waitUntil:'domcontentloaded'});
  await page.waitForSelector(SIDEBAR, { timeout: 20000 }).catch(async error => {
    await page.screenshot({path:path.join(ARTIFACTS, 'login-failed-'+username+'.png'),fullPage:true});
    fs.writeFileSync(path.join(ARTIFACTS,'login-failed-'+username+'.txt'),await page.evaluate(()=>location.href+'\n'+document.body.innerText));
    throw error;
  });
  await page.waitForSelector('#view h1', { timeout: 20000 });
}
async function navigate(page, route, title) {
  const selector = routeSelector(route);
  await page.waitForSelector(selector);
  // Open the actual native group through its UI before clicking its route.
  const group = await page.$eval(selector, el => el.closest('details')?.dataset.commercialGroup || null);
  if (group && !(await page.$eval(`${SIDEBAR} details[data-commercial-group="${group}"]`, el => el.open))) {
    await page.click(`${SIDEBAR} details[data-commercial-group="${group}"] > summary`);
  }
  await page.locator(selector).click();
  await page.waitForFunction((route, title) => location.hash === '#/' + route && document.querySelector('#view h1')?.textContent.includes(title), { timeout: 20000 }, route, title);
  await page.waitForFunction(selector => document.querySelector(selector)?.classList.contains('active'), {}, selector);
}
async function sidebarVisible(page) {
  return page.$eval(SIDEBAR, el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.right > 10 && r.left < innerWidth && s.display !== 'none' && s.visibility !== 'hidden'; });
}

test('Commercial — sidebar claire, navigation, permissions et responsive dans Chrome', {
  timeout: 300000,
  skip: !CHROME ? 'Chrome absent: set PUPPETEER_EXECUTABLE_PATH' : !puppeteer ? 'puppeteer-core absent' : false,
}, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-commercial-sidebar-'));
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', DATABASE_URL: `sqlite:///${path.join(tmp, 'test.db')}`,
    JWT_SECRET: 'commercial-sidebar-e2e-local-temporary-secret', ADMIN_SYSTEM_USERNAME: 'SIDEBARADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false',
    SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '', CONVOCATION_SMTP_PASSWORD: '', BIOMETRIC_ENABLED: 'false' });
  const output = fs.openSync(path.join(ARTIFACTS, 'server.log'), 'w');
  let server, browser, page, adminToken;
  const errors = [], requests = [], measurements = [], pages = [], accounts = {};
  t.after(async () => {
    fs.writeFileSync(path.join(ARTIFACTS, 'page-errors.json'), JSON.stringify(errors, null, 2));
    fs.writeFileSync(path.join(ARTIFACTS, 'requests.json'), JSON.stringify(requests, null, 2));
    fs.writeFileSync(path.join(ARTIFACTS, 'measurements.json'), JSON.stringify(measurements, null, 2));
    for (const [index, tab] of pages.entries()) if (!tab.isClosed()) await tab.screenshot({ path: path.join(ARTIFACTS, `last-page-${index}.png`), fullPage: true }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) {
      const stopped = once(server, 'exit'); server.kill('SIGTERM');
      await Promise.race([stopped, delay(4000)]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  async function newPage() {
    const context = await browser.createBrowserContext();
    const tab = await context.newPage(); pages.push(tab);
    await tab.setViewport({ width: 1440, height: 1000 });
    tab.on('pageerror', error => { errors.push({ url: tab.url(), message: error.message }); fs.writeFileSync(path.join(ARTIFACTS,'page-errors.json'),JSON.stringify(errors,null,2)); });
    tab.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) requests.push({ method: request.method(), path: url.pathname }); });
    return tab;
  }
  async function capture(tab, name) {
    const toastClose=await tab.$('.message-close');
    if(toastClose)await toastClose.click();
    await settled(tab);
    const state = await tab.evaluate(selector => {
      const rect = el => { const r = el.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
      const side = document.querySelector(selector), nav = side.querySelector('#sidebar-nav'), main = document.querySelector('.sgdi-shell-body > main');
      const visible = el => { const r=el.getBoundingClientRect();return r.width && r.height && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'; };
      const items = [...side.querySelectorAll('.nav-link,.commercial-group-toggle')].filter(visible).map(el => ({ label:el.getAttribute('aria-label') || el.textContent.trim(), ...rect(el) }));
      return { viewport:innerWidth, viewportHeight:innerHeight, bodyWidth:document.body.scrollWidth, documentWidth:document.documentElement.scrollWidth,
        sidebar:{...rect(side),background:getComputedStyle(side).backgroundColor}, nav:rect(nav), main:rect(main), items,
        collapsed:document.querySelector('.sgdi-shell').classList.contains('sgdi-sidebar-collapsed'), mobileOpen:document.querySelector('.sgdi-shell').classList.contains('sgdi-mobile-sidebar-open') };
    }, SIDEBAR);
    measurements.push({ name, ...state });
    await tab.screenshot({ path:path.join(ARTIFACTS, `${name}-${state.viewport}.png`), fullPage:true });
    assert.ok(state.bodyWidth <= state.viewport + 2 && state.documentWidth <= state.viewport + 2, 'global horizontal overflow: ' + JSON.stringify(state));
    assert.ok(state.main.width >= 280 && state.main.height > 0, 'work area collapsed');
    if (state.viewport >= 768 || state.mobileOpen) {
      assert.ok(state.sidebar.left >= -2 && state.sidebar.right <= state.viewport, 'sidebar outside viewport');
      const channels=(state.sidebar.background.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
      const rgb=state.sidebar.background.startsWith('color(srgb')?channels.map(n=>n*255):channels;
      assert.ok(rgb.length===3&&rgb.every(n=>n>=240),'sidebar should be very light: '+state.sidebar.background);
      for (const item of state.items) assert.ok(item.left >= state.sidebar.left - 2 && item.right <= state.sidebar.right + 2, 'navigation escapes sidebar: ' + JSON.stringify(item));
    }
    return state;
  }

  await t.test('API isolée, trois clients autorisés, société externe et profils réels', async () => {
    server = spawn(PYTHON, ['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(PORT)], { cwd:tmp, env, stdio:['ignore',output,output] });
    let authenticated;
    for (let attempt=0; attempt<100; attempt++) {
      assert.equal(server.exitCode, null, 'local server exited; see server.log');
      try { authenticated = await api('/auth/admin-system-login', { method:'POST', body:{ username:'SIDEBARADMIN', password:PASSWORD } }); if (authenticated.status === 200) break; } catch (_) {}
      await delay(200);
    }
    assert.equal(authenticated?.status, 200, JSON.stringify(authenticated)); adminToken=authenticated.data.access_token;
    const seed = `
import app.main
from app.db.session import SessionLocal
from app.modules.commercial.models import Client
s=SessionLocal()
for n in range(1,4): s.add(Client(name='CLIENT LOCAL '+str(n),society=${JSON.stringify(SOCIETY)},status='actif'))
s.add(Client(name='CLIENT AUTRE SOCIETE',society=${JSON.stringify(OTHER_SOCIETY)},status='actif'))
s.commit();s.close()
`;
    execFileSync(PYTHON, ['-c',seed], { cwd:tmp, env });
    for (const [username, role, actions, societies, level] of [
      ['DC001','CADRE',['read','create','update'],[SOCIETY,OTHER_SOCIETY],'H3'],
      ['DCLECTURE','CADRE',['read'],[SOCIETY],'H1'],
      ['DCSANSTARIF','CAD_LIMIT',['read'],[SOCIETY],'H1'],
      ['COM01','commercial',['read'],[SOCIETY],'H1'],
    ]) {
      const created=await api('/auth/users',{method:'POST',token:adminToken,body:{username,full_name:username,email:username.toLowerCase()+'@example.com',role,access_level:level,authorized_modules:['dc'],authorized_societies:societies,authorized_sites:[],authorized_structures:[],authorized_actions:actions,global_society_access:false,password:PASSWORD,validation_password:PASSWORD}});
      assert.equal(created.status,200,JSON.stringify(created));
      const authenticated=await api('/auth/login',{method:'POST',body:{username,password:PASSWORD}});
      assert.equal(authenticated.status,200,JSON.stringify(authenticated));accounts[username]=authenticated.data.access_token;
    }
    const rules=await api('/auth/access-rules',{method:'PUT',token:adminToken,body:[{module_key:'commercial/tarifs',role:'CAD_LIMIT',allowed:false}]});
    assert.equal(rules.status,200,JSON.stringify(rules));
    browser=await puppeteer.launch({executablePath:CHROME,headless:'new',userDataDir:path.join(tmp,'chrome'),args:['--no-first-run','--no-default-browser-check','--disable-background-networking',`--host-resolver-rules=MAP dc.irongs.com 127.0.0.1:${PORT}`]});
    page=await newPage();await login(page);
  });
  assert.ok(page && await page.$(SIDEBAR),'sidebar initialization must succeed before dependent navigation checks');

  await t.test('identité réelle, compteurs serveur, liens et groupes cohérents', async () => {
    assert.match(await page.$eval('.commercial-sidebar-brand',el=>el.textContent),/IRON GLOBAL/);
    assert.match(await page.$eval(SIDEBAR,el=>el.textContent),/DC001/);
    await page.waitForFunction(selector=>document.querySelector(selector+' .nav-count')?.textContent.trim()==='3',{},routeSelector('commercial/clients'));
    const links=await page.$$eval(SIDEBAR+' .nav-link',els=>els.map(el=>({route:el.dataset.route,href:el.getAttribute('href'),tag:el.tagName,icon:!!el.querySelector('svg'),label:el.getAttribute('aria-label')})));
    for(const route of ['dashboard','clients','prospects','opportunites','calendrier','devis','visites','catalogue','tarifs','stats']) {
      const link=links.find(link=>link.route==='commercial/'+route);assert.ok(link,'missing route: '+route);
      assert.equal(link.tag,'A');assert.equal(link.href,'#/commercial/'+route);assert.ok(link.icon&&link.label,'accessible route: '+route);
    }
    assert.ok(!links.some(link=>link.route.startsWith('admin/')),'no Administration permission');
    assert.equal(await page.$(SIDEBAR+' .nav-group-lbl'),null,'old micro headings removed');
    await capture(page,'commercial-sidebar-desktop');
  });

  await t.test('toutes les routes métier existantes restent navigables', async () => {
    for(const [route,title] of [['clients','Clients'],['prospects','Prospects'],['opportunites','Opportunités'],['calendrier','Calendrier'],['devis','Devis'],['visites','Visites'],['catalogue','Catalogue'],['tarifs','Tarification'],['stats','Statistiques'],['dashboard','Tableau de bord']]) await navigate(page,'commercial/'+route,title);
  });

  await t.test('sous-menu actif après F5, mode compact persistant et accès clavier', async () => {
    await navigate(page,'commercial/opportunites','Opportunités');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector(routeSelector('commercial/opportunites')+'.active');
    assert.equal(await page.$eval(routeSelector('commercial/opportunites'),el=>el.closest('details').open),true);
    assert.equal(await page.$eval(routeSelector('commercial/opportunites'),el=>el.closest('details').querySelector('summary').getAttribute('aria-expanded')),'true');
    await page.locator('.commercial-sidebar-collapse').click();await settled(page);
    const compact=await capture(page,'commercial-sidebar-compact');assert.ok(compact.sidebar.width>=60&&compact.sidebar.width<=90);
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector(SIDEBAR);await settled(page);
    assert.ok(await page.$eval(SIDEBAR,el=>el.getBoundingClientRect().width<=90),'compact preference survives F5');
    await page.focus('[data-commercial-group="commercial"] > summary');await page.keyboard.press('Enter');await settled(page);
    assert.ok(await page.$eval(SIDEBAR,el=>el.getBoundingClientRect().width>=220),'keyboard group activation reveals its submenu from the rail');
    assert.equal(await page.$eval('[data-commercial-group="commercial"]',el=>el.open),true);
    await page.locator('.commercial-sidebar-collapse').click();await settled(page);
    await page.hover(routeSelector('commercial/clients'));
    assert.equal(await page.$eval('#commercial-sidebar-tooltip',el=>el.textContent),'Clients','compact pointer tooltip');
    const client=await page.$(routeSelector('commercial/clients'));await client.focus();
    assert.ok(await client.evaluate(el=>{
      const tooltip=document.getElementById(el.getAttribute('aria-describedby'));
      return el.getAttribute('aria-label')&&tooltip?.getAttribute('role')==='tooltip'&&tooltip.textContent.includes('Clients')&&tooltip.getBoundingClientRect().width>0;
    }),'compact accessible label and visible keyboard tooltip');
    await page.keyboard.press('Enter');await page.waitForFunction(()=>location.hash==='#/commercial/clients');
    await page.locator('.commercial-sidebar-collapse').click();await settled(page);
    assert.ok(await page.$eval(SIDEBAR,el=>el.getBoundingClientRect().width>=220));
    await navigate(page,'commercial/dashboard','Tableau de bord');
  });

  await t.test('sept largeurs réelles 1440/1280/1024/800/768/430/390 sans débordement', async () => {
    // Remove only the test user's explicit preference to exercise automatic tablet adaptation.
    await page.evaluate(()=>localStorage.removeItem('sgdiSidebarCollapsed'));
    for(const width of [1440,1280,1024,800,768,430,390]) {
      await page.setViewport({width,height:1000});await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector(SIDEBAR);
      const state=await capture(page,'commercial-sidebar-responsive');
      if(width>1024)assert.ok(state.sidebar.width>=220&&state.sidebar.width<=250,'desktop width');
      else if(width>=768)assert.ok(state.sidebar.width>=60&&state.sidebar.width<=90,'tablet auto compact');
      else assert.equal(await sidebarVisible(page),false,'mobile starts closed');
    }
  });

  await t.test('drawer mobile: hamburger, focus contenu, X, extérieur, Échap et sélection', async () => {
    await page.setViewport({width:390,height:1000});
    const toggle='.sgdi-topbar .sgdi-sidebar-toggle';
    const open=async()=>{await page.click(toggle);await page.waitForFunction(()=>document.querySelector('.sgdi-shell').classList.contains('sgdi-mobile-sidebar-open'));await settled(page);assert.equal(await sidebarVisible(page),true);};
    await open();await capture(page,'commercial-sidebar-mobile-open');
    assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.sidebar')),true,'opening focuses drawer');
    await page.setViewport({width:390,height:620});await capture(page,'commercial-sidebar-mobile-short');
    assert.ok(await page.$eval(SIDEBAR,el=>{
      const nav=el.querySelector('#sidebar-nav'),footer=el.querySelector('.commercial-sidebar-footer');
      return nav.scrollHeight>nav.clientHeight&&nav.getBoundingClientRect().bottom<=footer.getBoundingClientRect().top+1&&footer.getBoundingClientRect().bottom<=innerHeight;
    }),'short viewport scrolls navigation while keeping footer visible');
    await page.setViewport({width:390,height:1000});await settled(page);
    for(let i=0;i<30;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.sidebar')),true,'Tab remains in drawer');}
    for(let i=0;i<30;i++){await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.sidebar')),true,'Shift Tab remains in drawer');}
    await page.keyboard.press('Escape');await settled(page);assert.equal(await sidebarVisible(page),false);
    assert.equal(await page.$eval(toggle,el=>el===document.activeElement),true,'Escape restores hamburger focus');
    await open();await page.click('.commercial-sidebar-close');await settled(page);assert.equal(await sidebarVisible(page),false);
    await open();await page.mouse.click(375,500);await settled(page);assert.equal(await sidebarVisible(page),false,'outside closes drawer');
    await open();await navigate(page,'commercial/clients','Clients');await settled(page);assert.equal(await sidebarVisible(page),false,'route closes drawer');
    await capture(page,'commercial-sidebar-mobile-closed');
  });

  await t.test('lecture seule, rôle Commercial et profil sans Tarification: droits existants sans Administration', async () => {
    const tab=await newPage();
    for(const username of ['DCLECTURE','DCSANSTARIF','COM01']) {
      await login(tab,username);
      await navigate(tab,'commercial/clients','Clients');
      assert.equal(await tab.$(SIDEBAR+' [data-route^="admin/"]'),null);
      if(username==='DCSANSTARIF')assert.equal(await tab.$(routeSelector('commercial/tarifs')),null,'explicit legacy tariff denial respected');
      else assert.ok(await tab.$(routeSelector('commercial/tarifs')),'read-only may consult existing tariff route');
      assert.equal((await api('/auth/users',{token:accounts[username]})).status,403);
      await capture(tab,'commercial-'+username.toLowerCase());
      await tab.locator('.commercial-sidebar-logout').click();await tab.waitForSelector('#login-form',{visible:true});
    }
    await tab.close();
  });

  await t.test('retour société, nouveau compteur et déconnexion conservent leur comportement', async () => {
    await page.setViewport({width:1440,height:1000});await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector(SIDEBAR);
    await page.locator(SIDEBAR+' .sidebar-return-button').click();await page.waitForSelector('.company-portal-change',{visible:true});
    page.once('dialog',dialog=>dialog.accept());await page.locator('.company-portal-change').click();
    await page.waitForSelector('.module-host-soc-card',{visible:true});
    await clickText(page,'.module-host-soc-card',OTHER_SOCIETY);await page.waitForSelector('.module-host-module',{visible:true});
    await page.goto(DC+'/#/commercial/dashboard',{waitUntil:'domcontentloaded'});await page.waitForSelector(SIDEBAR);
    await page.waitForFunction(selector=>document.querySelector(selector+' .nav-count')?.textContent.trim()==='1',{},routeSelector('commercial/clients'));
    await navigate(page,'commercial/clients','Clients');
    await page.waitForFunction(()=>document.querySelector('#view')?.textContent.includes('CLIENT AUTRE SOCIETE'));
    await page.locator('.commercial-sidebar-logout').click();
    await page.waitForSelector('#login-form',{visible:true});assert.equal(await page.$(SIDEBAR),null);
  });

  await t.test('aucune mutation métier ni erreur JavaScript pendant la navigation', async () => {
    assert.deepEqual(errors,[]);
    const mutations=requests.filter(request=>!['GET','HEAD','OPTIONS'].includes(request.method)&&!/\/auth\/|\/irongs\/events\/ticket$/.test(request.path));
    assert.deepEqual(mutations,[],'UI navigation must not mutate business data');
    const clients=await api('/commercial/clients',{token:accounts.DC001});assert.equal(clients.status,200);assert.equal(clients.data.length,4);
  });
});
