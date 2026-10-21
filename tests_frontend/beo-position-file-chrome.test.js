// Fiche de position BEO — recette Chrome réelle, serveur uvicorn et SQLite isolés.
// Lancer : npm run test:beo-position-chrome  (ATLAS_E2E_PYTHON = interpréteur avec les dépendances)
// Le portail est ouvert sur l'hôte RÉEL beo.irongs.com (résolu vers le serveur local par Chrome) :
// vrai routage d'hôte FastAPI, vraie connexion, vraie coque, vrai routeur par hash. Aucune donnée
// simulée : l'administration coche les champs dans la vraie modal d'ATLAS, le BEO relit le serveur.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { once } = require('events');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const PORT = Number(process.env.ATLAS_BEO_PF_E2E_PORT || 8963);
const BASE = `http://127.0.0.1:${PORT}`;
const BEO = `http://beo.irongs.com:${PORT}`;
const PASSWORD = 'AtlasLocalBeoPf!2026'; // Comptes jetables de la base E2E exclusivement.
const SOC_A = 'IRON GLOBAL SOLUTION';
const SOC_C = 'SOCIETE TIERCE E2E';
const SIZES = [[1440, 900], [1366, 768], [1280, 800], [1024, 768], [820, 1180], [768, 1024], [390, 844]];
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { /* skip explicite ci-dessous */ }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(endpoint, { method = 'GET', token, body } = {}) {
  const response = await fetch(BASE + '/api' + endpoint, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
async function clickText(page, selector, text) {
  const handles = await page.$$(selector);
  let selected;
  for (const handle of handles) if ((await handle.evaluate((el) => el.textContent.trim())).includes(text)) { selected = handle; break; }
  assert.ok(selected, `bouton absent : ${selector} / ${text}`);
  await selected.click();
}
const settled = (page) => page.waitForFunction(() => document.querySelector('#view') && !document.querySelector('#view .skeleton'), { timeout: 15000 });

test('Fiche de position BEO — Chrome réel', { timeout: 300000, skip: !CHROME ? 'Chrome introuvable : PUPPETEER_EXECUTABLE_PATH requis' : !puppeteer ? 'puppeteer-core absent' : false }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-beo-pf-'));
  const artifacts = process.env.ATLAS_BEO_PF_ARTIFACTS || path.join(os.tmpdir(), 'atlas-beo-position-file');
  fs.mkdirSync(artifacts, { recursive: true });
  const env = {
    ...process.env, PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR',
    DATABASE_URL: `sqlite:///${path.join(tmp, 'test.db')}`, JWT_SECRET: 'atlas-beo-pf-e2e-temporary-secret-2026',
    ADMIN_SYSTEM_USERNAME: 'UIADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000',
    STARTUP_MAINTENANCE_ENABLED: 'false', SMTP_HOST: '', SMTP_USERNAME: '', SMTP_PASSWORD: '', SMTP_FROM_EMAIL: '',
  };
  const output = fs.openSync(path.join(artifacts, 'server.log'), 'w');
  let server, browser, adminToken, ids;
  const pageErrors = [];
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(4000)]); if (server.exitCode === null) server.kill('SIGKILL'); }
    fs.closeSync(output);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test('serveur isolé + données canoniques (employé K01, contrat, historique) et compte CE01', async () => {
    server = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PORT)], { cwd: tmp, env, stdio: ['ignore', output, output] });
    let login;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(server.exitCode, null, 'échec serveur : consulter server.log');
      try { login = await api('/auth/admin-system-login', { method: 'POST', body: { username: 'UIADMIN', password: PASSWORD } }); if (login.status === 200) break; } catch (_) {}
      await delay(200);
    }
    assert.equal(login?.status, 200, 'administrateur temporaire non disponible');
    adminToken = login.data.access_token;
    const seed = `
import json
from datetime import date, timedelta
import app.main
from app.db.session import SessionLocal
from app.core.security import hash_password
from app.modules.auth.models import User
from app.modules.drh.models import Employee, Contract
from app.modules.ops.models import Site, Assignment
s=SessionLocal()
a,c=${JSON.stringify(SOC_A)},${JSON.stringify(SOC_C)}
hamoul=Site(name='DHL FORWARDING / HAMOUL 01',active=1,equipment_plan={'societe':a},client_name='DHL')
oran=Site(name='DHL ORAN',active=1,equipment_plan={'societe':a})
tiers=Site(name='SITE TIERS',active=1,equipment_plan={'societe':c})
s.add_all([hamoul,oran,tiers]);s.flush()
k01=Employee(code='K01',first_name='HABIB CHAWKI ABDELMAJID',last_name='ABDELLAHI',society=a,status='actif',position='CARISTE',
  contract_type='CDD',recruit_date=date(2025,3,24),contract_end_date=date.today()+timedelta(days=180),phone='0555000111',salary_net=45000,
  extra={'numeroPieceIdentite':'CNI-E2E-1'})
other=Employee(code='K02',first_name='AUTRE',last_name='ORANAIS',society=a,status='actif',position='AGENT')
outside=Employee(code='X01',first_name='INTERDIT',last_name='TIERS',society=c,status='actif')
s.add_all([k01,other,outside]);s.flush()
s.add_all([
  Assignment(employee_id=k01.id,site_id=oran.id,group_code='A',position='AGENT',start_date=date(2025,3,24),end_date=date(2026,3,23),active=0),
  Assignment(employee_id=k01.id,site_id=hamoul.id,group_code='B',position='CARISTE',start_date=date(2026,3,24),active=1,work_regime='NORMAL'),
  Assignment(employee_id=other.id,site_id=oran.id,group_code='A',position='AGENT',start_date=date(2026,1,1),active=1),
  Assignment(employee_id=outside.id,site_id=tiers.id,group_code='A',start_date=date(2026,1,1),active=1),
  Contract(employee_id=k01.id,contract_type='CDD',position='CARISTE',start_date=date(2026,3,24),end_date=date.today()+timedelta(days=180),salary_net=45000,status='actif'),
])
pwh=hash_password(${JSON.stringify(PASSWORD)})
s.add(User(username='CE01',full_name='Chargé des effectifs E2E',role='charge_effectifs_site',access_level='H2',authorized_societies=[a],
  authorized_sites=[hamoul.id],authorized_modules=['site_workforce'],authorized_structures=[],authorized_actions=['read','create','update','validate'],
  global_society_access=False,is_active=True,password_hash=pwh,validation_password_hash=pwh))
admin=s.query(User).filter_by(username='UIADMIN').one()
admin.validation_password_hash=pwh
s.commit()
ce=s.query(User).filter_by(username='CE01').one()
print(json.dumps({'k01':k01.id,'other':other.id,'outside':outside.id,'ce01':ce.id,'hamoul':hamoul.id}))
s.close()
`;
    ids = JSON.parse(execFileSync(PYTHON, ['-c', seed], { cwd: tmp, env, encoding: 'utf8' }).trim().split('\n').pop());
    const fields = await api(`/auth/users/${ids.ce01}/site-workforce/position-fields`, { token: adminToken });
    assert.deepEqual(fields.data.fields, [], 'compte créé après migration : aucun champ (deny by default)');
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'chrome'),
      args: ['--no-first-run', '--no-default-browser-check', `--host-resolver-rules=MAP beo.irongs.com 127.0.0.1`] });
  });

  await t.test('Administration système › BEO › Champs accessibles : BEO Standard puis Date de fin du contrat décochée', async () => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => pageErrors.push('admin: ' + e.message));
    page.on('dialog', async (dialog) => { if (dialog.type() === 'prompt') await dialog.accept(PASSWORD); else await dialog.accept(); });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.login-admin-system-shortcut');
    await page.click('.login-admin-system-shortcut');
    await page.click('#modal-host input[name="username"]', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#modal-host input[name="username"]', 'UIADMIN');
    await page.type('#modal-host input[name="password"]', PASSWORD);
    await clickText(page, '#modal-host button', 'Valider');
    await page.waitForSelector('#sidebar-nav');
    await page.evaluate(() => { location.hash = '#/admin/beo'; });
    await page.waitForSelector('[data-beo-fields="CE01"]', { timeout: 20000 });
    await page.click('[data-beo-fields="CE01"]');
    await page.waitForSelector('[data-beo-pf-field="contract.salary"]', { timeout: 15000 });
    assert.match(await page.$eval('#beo-pf-counter', (el) => el.textContent), /^0 champ autorisé \/ \d+$/);
    await clickText(page, '#modal-host button', 'Profil BEO Standard');
    await page.click('[data-beo-pf-field="contract.end_date"]');
    await page.type('#beo-pf-search', 'contrat');
    const visible = await page.$$eval('[data-beo-pf-row]', (rows) => rows.filter((r) => r.offsetParent !== null).map((r) => r.dataset.beoPfRow));
    assert.ok(visible.length && visible.every((k) => k.startsWith('contract.') || k === 'history.contracts'), visible.join());
    assert.equal(await page.$eval('[data-beo-pf-field="contract.salary"]', (el) => el.checked), false);
    await page.screenshot({ path: path.join(artifacts, 'admin-champs-accessibles.png') });
    await page.click('#beo-pf-save');
    await page.waitForFunction(() => !document.querySelector('#beo-pf-sections'), { timeout: 15000 });
    const saved = await api(`/auth/users/${ids.ce01}/site-workforce/position-fields`, { token: adminToken });
    assert.ok(saved.data.fields.includes('assignment.site') && !saved.data.fields.includes('contract.end_date') && !saved.data.fields.includes('contract.salary'));
    await page.close();
  });

  let beo;
  await t.test('beo.irongs.com : login, coque, menu, Personnel → fiche K01 en lecture seule', async () => {
    beo = await browser.newPage();
    beo.on('pageerror', (e) => pageErrors.push('beo: ' + e.message));
    await beo.setViewport({ width: 1440, height: 900 });
    await beo.goto(BEO + '/', { waitUntil: 'domcontentloaded' });
    await beo.waitForSelector('#login-form', { timeout: 15000 });
    assert.match(await beo.title(), /Bureau des Effectifs Ouest/);
    await beo.type('input[name=username]', 'CE01');
    await beo.type('input[name=password]', PASSWORD);
    await Promise.all([beo.click('button[type=submit]'), beo.waitForSelector('.shell', { timeout: 15000 })]);
    const nav = await beo.$$eval('[data-nav]', (els) => els.map((e) => e.dataset.nav));
    assert.deepEqual(nav.slice(0, 4), ['dashboard', 'personnel', 'position', 'pointage']);
    await beo.click('[data-nav="personnel"]');
    await beo.waitForSelector(`[data-position-link="${ids.k01}"]`, { timeout: 15000 });
    await beo.click(`[data-position-link="${ids.k01}"]`);
    await beo.waitForSelector('.pf-name', { timeout: 15000 });
    assert.equal(await beo.evaluate(() => location.hash), `#/position/${ids.k01}`);
    const text = await beo.$eval('#view', (el) => el.innerText);
    for (const expected of ['ABDELLAHI HABIB CHAWKI ABDELMAJID', 'Code K01', 'IRON GLOBAL SOLUTION', 'DHL FORWARDING / HAMOUL 01', 'CARISTE', '24/03/2026', 'CDD', 'DHL ORAN']) {
      assert.ok(text.includes(expected), `absent de la fiche : ${expected}`);
    }
    for (const hidden of ['0555000111', '45000', '45 000', 'CNI-E2E-1', 'Salaire', 'Date de fin']) assert.ok(!text.includes(hidden), `affiché sans autorisation : ${hidden}`);
    assert.equal(await beo.$$eval('#view input, #view select, #view textarea, #view form', (els) => els.length), 0);
    assert.deepEqual(await beo.$$eval('#view button', (els) => els.map((b) => b.textContent.trim())), ['Signaler une anomalie']);
  });

  await t.test('7 tailles d\'écran : fiche et liste sans défilement horizontal global', async () => {
    for (const route of [`#/position/${ids.k01}`, '#/position']) {
      for (const [width, height] of SIZES) {
        await beo.setViewport({ width, height });
        await beo.evaluate((r) => { location.hash = r; }, route);
        await settled(beo);
        await delay(150);
        const m = await beo.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          cols: getComputedStyle(document.querySelector('.pf-grid') || document.body).gridTemplateColumns }));
        assert.ok(m.sw <= m.cw + 1, `défilement horizontal ${route} @${width}x${height} : ${m.sw} > ${m.cw}`);
        if (route.includes('/position/')) {
          // Desktop et tablette paysage : 2 colonnes ; tablette portrait et mobile : 1 colonne.
          assert.equal(m.cols.split(' ').length, width > 900 ? 2 : 1, `colonnes @${width} : ${m.cols}`);
        }
        await beo.screenshot({ path: path.join(artifacts, `beo-${route.includes('/position/') ? 'fiche' : 'liste'}-${width}x${height}.png`), fullPage: true });
      }
    }
    await beo.setViewport({ width: 1440, height: 900 });
  });

  await t.test('l\'administrateur coche Date de fin et décoche Site : effet au rechargement, périmètre inchangé', async () => {
    const current = (await api(`/auth/users/${ids.ce01}/site-workforce/position-fields`, { token: adminToken })).data.fields;
    const next = current.filter((k) => k !== 'assignment.site').concat('contract.end_date');
    assert.equal((await api(`/auth/users/${ids.ce01}/site-workforce/position-fields`, { method: 'PUT', token: adminToken, body: { fields: next } })).status, 200);
    await beo.reload({ waitUntil: 'domcontentloaded' });
    await beo.evaluate((id) => { location.hash = `#/position/${id}`; }, ids.k01);
    await beo.waitForSelector('.pf-name', { timeout: 15000 });
    assert.ok(await beo.$('[data-pf-field="contract.end_date"]'));
    assert.equal(await beo.$('[data-pf-field="assignment.site"]'), null);
    for (const forged of [ids.other, ids.outside]) {
      await beo.evaluate((id) => { location.hash = `#/position/${id}`; }, forged);
      await beo.waitForSelector('#view .error-state', { timeout: 15000 });
      assert.match(await beo.$eval('#view', (el) => el.innerText), /hors du périmètre/);
    }
    assert.deepEqual(pageErrors, []);
  });
});
