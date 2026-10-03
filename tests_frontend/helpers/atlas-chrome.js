// Banc Chrome réel partagé : serveur uvicorn isolé, base SQLite temporaire, fixtures synthétiques
// créées par l'API/ORM, connexion par le vrai formulaire. Aucune donnée de production.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { once } = require('events');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const PASSWORD = 'AtlasVisualLocal!2026';
const SOCIETY = 'IRON GLOBAL SOLUTION';
const OTHER_SOCIETY = 'IRON GLOBAL SÉCURITÉ';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(file => fs.existsSync(file));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite côté test */ }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const HOSTS = ['drh', 'ops', 'dc', 'materiel'];

// Sites synthétiques : manque, surplus, conforme, inactif, ouverture future, autre société.
const SEED = `
import json
import app.main
from datetime import date,timedelta
from app.db.session import SessionLocal
from app.modules.ops.models import Site,Assignment
from app.modules.drh.models import Employee
s=SessionLocal()
a,b=${JSON.stringify(SOCIETY)},${JSON.stringify(OTHER_SOCIETY)}
future=(date.today()+timedelta(days=45)).isoformat()
def site(name,ind,client,address,commune,wilaya,lat,lng,staff,day,night,active=1,society=a,opening='2020-01-01',contact=None):
    plan={'societe':society,'dateOuverture':opening}
    if lat is not None: plan.update({'latitude':lat,'longitude':lng})
    if contact: plan['contact']=contact
    return Site(name=name,indicatif=ind,client_name=client,address=address,commune=commune,wilaya=wilaya,contractual_staff=staff,day_staff=day,night_staff=night,active=active,equipment_plan=plan)
sites=[
 site('SITE TEST ALPHA','ALPHA-1','CLIENT TEST NORD','12 rue des Essais','Hydra','Alger',36.7538,3.0588,3,2,1,contact={'nom':'Contact Alpha','telephone':'0550000001'}),
 site('SITE TEST BETA','BETA-2','CLIENT TEST OUEST','Zone industrielle lot 4','Es Senia','Oran',35.6971,-0.6308,1,1,0),
 site('SITE TEST GAMMA','GAMMA-3','CLIENT TEST NORD','Boulevard de la Verification','El Khroub','Constantine',36.365,6.6147,2,1,1),
 site('SITE TEST DELTA','DELTA-4','CLIENT TEST EST','Quai des Archives','Annaba','Annaba',36.9,7.7667,2,1,1,active=0),
 site('SITE TEST EPSILON','EPS-5','CLIENT TEST OUEST','Route sans coordonnees','Bir El Djir','Oran',None,None,0,0,0,opening=future),
 site('SITE TEST INTERDIT','INT-9','CLIENT INTERDIT','Hors perimetre','Blida','Blida',36.47,2.83,4,2,2,society=b),
]
s.add_all(sites);s.flush()
employees=[Employee(code='KT%02d'%i,first_name='Agent%02d'%i,last_name='FIXTURE KPI',society=a,status='actif',position='Agent',recruit_date=date(2025,1,1)) for i in range(1,8)]
employees.append(Employee(code='KT99',first_name='Hors',last_name='INTERDIT KPI',society=b,status='actif',position='Agent'))
s.add_all(employees);s.flush()
plan=[0,0,1,1,1,2,2,5]
for employee,index in zip(employees,plan):
    s.add(Assignment(employee_id=employee.id,site_id=sites[index].id,start_date=date.today()-timedelta(days=30),active=1,group_code='A'))
s.commit()
print(json.dumps({'sites':[x.id for x in sites[:5]],'otherSite':sites[5].id}))
s.close()
`;

async function startAtlas(t, { port, artifacts }) {
  const BASE = `http://127.0.0.1:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-chrome-'));
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', DATABASE_URL: `sqlite:///${path.join(tmp, 'test.db')}`,
    JWT_SECRET: 'atlas-chrome-local-temporary-secret-2026', ADMIN_SYSTEM_USERNAME: 'KPIADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false',
    SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '', CONVOCATION_SMTP_PASSWORD: '', BIOMETRIC_ENABLED: 'false' });
  const output = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  const errors = [];
  let server, browser;
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) {
      server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(4000)]);
      if (server.exitCode === null) { server.kill('SIGKILL'); await Promise.race([once(server, 'exit'), delay(2000)]); }
    }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  async function api(endpoint, { method = 'GET', token, body } = {}) {
    const response = await fetch(BASE + '/api' + endpoint, {
      method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const content = await response.text();
    try { return { status: response.status, data: JSON.parse(content) }; } catch (_) { return { status: response.status, data: content }; }
  }
  server = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)], { cwd: tmp, env, stdio: ['ignore', output, output] });
  let login;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(server.exitCode, null, 'local server exited: see server.log');
    try { login = await api('/auth/admin-system-login', { method: 'POST', body: { username: 'KPIADMIN', password: PASSWORD } }); if (login.status === 200) break; } catch (_) { /* démarrage */ }
    await delay(200);
  }
  assert.equal(login?.status, 200, JSON.stringify(login));
  const fixture = JSON.parse(execFileSync(PYTHON, ['-c', SEED], { cwd: tmp, env, encoding: 'utf8' }).trim().split('\n').pop());
  for (const [username, role, modules, sites, actions] of [
    ['DRH01', 'drh', ['drh'], [], ['read', 'create', 'update']],
    ['OPS01', 'ops', ['ops'], fixture.sites, ['read', 'create', 'update']],
  ]) {
    const created = await api('/auth/users', { method: 'POST', token: login.data.access_token, body: { username, full_name: `${username} LOCAL`, email: `${username.toLowerCase()}@example.com`,
      role, access_level: 'H3', authorized_modules: modules, authorized_societies: [SOCIETY], authorized_sites: sites,
      authorized_structures: [], authorized_actions: actions, global_society_access: false, password: PASSWORD, validation_password: PASSWORD } });
    assert.equal(created.status, 200, JSON.stringify(created));
    // Le cache serveur des compteurs (120 s) a la même clé avec ou sans paramètre `society` pour un
    // utilisateur mono-société : selon l'ordre des requêtes du shell, la réponse « sans société » peut
    // être resservie et le bandeau KPI ne s'affiche alors pas (comportement existant, hors périmètre).
    // On amorce donc ce cache avec la requête ciblée, pour un bandeau déterministe pendant le test.
    const authenticated = await api('/auth/login', { method: 'POST', body: { username, password: PASSWORD } });
    assert.equal(authenticated.status, 200, JSON.stringify(authenticated));
    const stats = await api('/ui/sidebar-stats?society=' + encodeURIComponent(SOCIETY), { token: authenticated.data.access_token });
    assert.equal(stats.data?.scope?.active_society, SOCIETY, JSON.stringify(stats).slice(0, 300));
  }
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'chrome'),
    args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking', `--host-resolver-rules=${HOSTS.map(host => `MAP ${host}.irongs.com 127.0.0.1:${port}`).join(', ')}`] });

  async function settled(page) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => document.getAnimations().filter(a => a.constructor.name === 'CSSTransition').every(a => a.playState !== 'running'), { timeout: 5000 });
  }
  async function login2(host, username, route) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', error => errors.push({ url: page.url(), message: error.message }));
    page.on('console', message => { if (message.type() === 'error') errors.push({ url: page.url(), console: message.text(), source: message.location()?.url || '' }); });
    await page.goto(`http://${host}.irongs.com/#/login`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login-form', { visible: true });
    await page.type('#login-form [name="username"]', username);
    await page.type('#login-form [name="password"]', PASSWORD);
    await page.click('.sgdi-login-submit');
    await page.waitForSelector('.module-host-soc-card', { visible: true, timeout: 20000 });
    let clicked = false;
    for (const card of await page.$$('.module-host-soc-card')) {
      if ((await card.evaluate(el => el.textContent)).includes(SOCIETY) && await card.boundingBox()) { await card.click(); clicked = true; break; }
    }
    assert.ok(clicked, 'carte société introuvable');
    // Le choix de société redirige d'abord vers l'accueil du module : on attend cette redirection,
    // sinon la navigation demandée peut être remplacée par la redirection d'accueil.
    await page.waitForFunction(() => !document.querySelector('[data-module-society-selector]') && location.hash !== '#/login', { timeout: 20000 });
    await page.evaluate(target => { location.hash = '#/' + target; }, route);
    await page.waitForFunction(target => location.hash === '#/' + target, { timeout: 10000 }, route);
    return page;
  }
  return { BASE, api, fixture, errors, settled, login: login2, delay };
}

module.exports = { startAtlas, CHROME, puppeteer, SOCIETY, OTHER_SOCIETY, PASSWORD };
