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
const PORT = Number(process.env.ATLAS_ADMIN_USERS_E2E_PORT || 8954);
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

test('Administration Utilisateurs V2 — Chrome réel', { timeout: 120000, skip: !CHROME ? 'Chrome introuvable : PUPPETEER_EXECUTABLE_PATH requis' : !puppeteer ? 'puppeteer-core absent' : false }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-admin-users-v2-'));
  const artifacts = process.env.ATLAS_ADMIN_USERS_ARTIFACTS || path.join(os.tmpdir(), 'atlas-admin-users-v2-e2e-artifacts');
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
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'chrome'), args: ['--no-first-run', '--no-default-browser-check'] });
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
    await page.click('#sidebar-nav [data-route="admin/users"]');
    await usersReady(page);
    assert.equal(await page.$eval('.admin-users-title h1', el => el.textContent), 'Gestion des utilisateurs');
    assert.equal(await page.$$eval('.admin-users-kpi', els => els.length), 5);
    assert.equal(await page.$$eval('.admin-users-head-actions button', els => els.length), 3);
    assert.match(await page.$eval('.admin-users-breadcrumb', el => el.textContent), /Administration système.*Identités & accès.*Utilisateurs/);
    assert.equal(await page.$$eval('[data-admin-user-row]', els => els.length), 10);
    assert.equal(await page.$eval('.admin-users-kpi strong', el => el.textContent), '19');
  });

  await t.test('recherche, filtres société/site/rôle/statut, état vide et pagination sans N+1', async () => {
    const mark = requests.length;
    await replaceInput(page, '#admin-user-search', 'USR02');
    await page.waitForFunction(() => document.querySelectorAll('[data-admin-user-row]').length === 1);
    assert.deepEqual(await visibleNames(page), ['Utilisateur test 02']);
    await replaceInput(page, '#admin-user-search', 'inexistant-aucun-resultat');
    await page.waitForSelector('.admin-users-empty');
    assert.match(await page.$eval('.admin-users-empty', el => el.textContent), /Aucun utilisateur ne correspond/);
    await page.click('.admin-users-empty button');
    await usersReady(page);
    await page.select('#admin-user-society-filter', SOC_A);
    const options = await page.$$eval('#admin-user-site-filter option', els => els.map(el => el.textContent));
    assert.equal(options.length, 4);
    assert.ok(options.slice(1).every(label => label.includes('DHL')));
    await page.select('#admin-user-site-filter', String(siteIds[0]));
    await page.select('#admin-user-role-filter', 'site_workforce');
    assert.deepEqual(await visibleNames(page), ['Chargé effectifs TEST']);
    await page.select('#admin-user-society-filter', SOC_B);
    assert.equal(await page.$eval('#admin-user-site-filter', el => el.value), '');
    assert.equal(await page.$$eval('[data-admin-user-row]', els => els.length), 0);
    await resetFilters(page);
    await page.select('#admin-user-status-filter', 'blocked');
    assert.deepEqual((await visibleNames(page)).sort(), ['Utilisateur test 04', 'Utilisateur test 08']);
    assert.ok((await page.$$eval('.admin-user-state', els => els.map(el => el.textContent))).every(value => value === 'Bloqué'));
    await resetFilters(page);
    await page.click('[aria-label="Page suivante"]');
    assert.match(await page.$eval('#admin-user-visible-count', el => el.textContent), /11 à 19 sur 19/);
    assert.equal(await page.$$eval('[data-admin-user-row]', els => els.length), 9);
    await page.select('#admin-user-page-size', '25');
    assert.equal(await page.$$eval('[data-admin-user-row]', els => els.length), 19);
    const reads = requests.slice(mark).filter(r => r.method === 'GET' && (/^\/api\/ops\/sites(?:\/|$)/.test(r.path) || /^\/api\/auth\/users(?:\/|$)/.test(r.path)));
    assert.deepEqual(reads, [], 'les filtres et pages doivent réutiliser le catalogue et la liste, sans requête par ligne');
    const initialCatalogCalls = requests.slice(0, mark).filter(r => r.method === 'GET' && r.path === '/api/ops/sites').length;
    assert.ok(initialCatalogCalls <= 2, `budget catalogue dépassé : ${initialCatalogCalls} pour 19 utilisateurs`);
    fs.writeFileSync(path.join(artifacts, 'network-filter-pagination.json'), JSON.stringify({ users: 19, reads, initialCatalogCalls }, null, 2));
  });

  await t.test('Voir, menu des actions, profils, matrice et ouverture/annulation du formulaire actuel', async () => {
    await replaceInput(page, '#admin-user-search', 'USR02');
    await page.waitForFunction(() => document.querySelectorAll('[data-admin-user-row]').length === 1);
    await page.click('.admin-user-actions [aria-label^="Voir "]');
    await page.waitForSelector('.admin-user-readonly');
    const detail = await page.$eval('.admin-user-readonly', el => el.textContent);
    assert.match(detail, /USR02/); assert.match(detail, /TEST Sécurité Oran/); assert.match(detail, /IRON GLOBAL SÉCURITÉ/);
    await clickText(page, '#modal-host button', 'Fermer');
    await page.click('.admin-user-actions [aria-label^="Autres actions"]');
    const actions = await page.$eval('.admin-user-action-menu:popover-open', el => el.textContent);
    for (const label of ['Permissions', 'Suspendre', 'Supprimer']) assert.ok(actions.includes(label));
    await page.keyboard.press('Escape');
    await clickText(page, '.admin-users-head-actions button', "Profils d'accès");
    await page.waitForFunction(() => location.hash === '#/admin/niveaux' && document.querySelector('#view h1')?.textContent === "Profils d'accès");
    await page.click('#sidebar-nav [data-route="admin/users"]'); await usersReady(page);
    await clickText(page, '.admin-users-head-actions button', 'Matrice des droits');
    await page.waitForSelector('#admin-right-search');
    assert.equal(await page.evaluate(() => location.hash), '#/admin/droits');
    await page.click('#sidebar-nav [data-route="admin/users"]'); await usersReady(page);
    const before = (await api('/auth/users', { token: adminToken })).data.length;
    await clickText(page, '.admin-users-head-actions button', 'Nouvel utilisateur');
    await page.waitForSelector('#modal-host form [name="username"]');
    assert.equal(await page.$eval('#modal-host [name="username"]', el => el.readOnly), false);
    assert.ok(await page.$('#modal-host [name="module_site_workforce"]'));
    await clickText(page, '#modal-host button', 'Annuler');
    assert.equal((await api('/auth/users', { token: adminToken })).data.length, before);
  });

  await t.test('modification du nom par le formulaire réel et relecture backend', async () => {
    await resetFilters(page);
    await replaceInput(page, '#admin-user-search', 'USR02');
    await page.waitForFunction(() => document.querySelectorAll('[data-admin-user-row]').length === 1);
    await page.click('.admin-user-actions [aria-label^="Modifier "]');
    await page.waitForSelector('#modal-host form [name="nom"]');
    await replaceInput(page, '#modal-host [name="nom"]', 'Utilisateur test 02 modifié');
    await clickText(page, '#modal-host form button', 'Enregistrer');
    await page.waitForFunction(() => !document.querySelector('#modal-host form'), { timeout: 15000 });
    const result = await api('/auth/users', { token: adminToken });
    assert.equal(result.data.find(user => user.username === 'USR02').full_name, 'UTILISATEUR TEST 02 MODIFIÉ');
    assert.equal(result.data.length, 19);
  });

  await t.test('1440/1024/768/390 : aucun overflow global, actions accessibles, captures et console', async () => {
    await resetFilters(page);
    await page.select('#admin-user-page-size', '10');
    if (await page.$eval('.admin-users-advanced-toggle', el => el.getAttribute('aria-expanded') === 'true')) await page.click('.admin-users-advanced-toggle');
    await page.waitForFunction(() => !document.querySelector('#sgdi-save-overlay') && !document.querySelector('.message-center'), { timeout: 15000 });
    const measurements = [];
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewport({ width, height: 900 });
      await page.waitForFunction(expected => innerWidth === expected, {}, width);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(() => document.getAnimations().filter(animation => animation.constructor.name === 'CSSTransition').every(animation => animation.playState !== 'running'));
      // Revenir au début du défilement du tableau après le clic Voir du viewport précédent.
      await page.$eval('.admin-users-table-wrap', table => table.scrollTo({ left: 0, behavior: 'instant' }));
      const dimensions = await page.evaluate(() => {
        const table = document.querySelector('.admin-users-table-wrap');
        return { viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, tableClient: table.clientWidth, tableScroll: table.scrollWidth, sidebarRight: document.querySelector('.sidebar').getBoundingClientRect().right, titleVisible: document.querySelector('.admin-users-title h1').getBoundingClientRect().width > 0 };
      });
      assert.ok(dimensions.document <= width + 2 && dimensions.body <= width + 2, `overflow global à ${width}px : ${JSON.stringify(dimensions)}`);
      assert.ok(dimensions.titleVisible);
      if (width === 390) {
        assert.ok(dimensions.tableScroll > dimensions.tableClient, 'table mobile : défilement local attendu');
        assert.ok(dimensions.sidebarRight <= 1, 'le menu mobile fermé ne doit pas masquer le contenu');
      }
      measurements.push(dimensions);
      await page.screenshot({ path: path.join(artifacts, `users-${width}.png`), fullPage: true });
      // Le clic doit également fonctionner après défilement local sur petit écran.
      await page.click('.admin-user-actions [aria-label^="Voir "]');
      await page.waitForSelector('.admin-user-readonly');
      await clickText(page, '#modal-host button', 'Fermer');
    }
    fs.writeFileSync(path.join(artifacts, 'measurements.json'), JSON.stringify(measurements, null, 2));
    assert.deepEqual(pageErrors, [], 'aucune erreur JavaScript');
    assert.deepEqual(consoleErrors, [], 'aucune erreur console');
  });
});
