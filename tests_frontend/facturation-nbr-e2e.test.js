// Facturation — colonne NBR : E2E Chrome réel sur fac.irongs.com (serveur uvicorn local, base
// SQLite temporaire). 30 magasiniers × 25 jours (période 01→25/09 via le mode « Jour ») ×
// 3 070,32 = 2 302 740,00 DZD ; brouillon enregistré, page rechargée, NBR retrouvé ; montants
// recalculés par le serveur ; responsive 1440/1024/768/390. `npm run test:facturation-nbr-e2e`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const PORT = 8971;
const BASE = `http://127.0.0.1:${PORT}`;
const SOCIETY = 'IRON GLOBAL SOLUTION';
const PASSWORD = 'facturation-nbr-e2e-password';
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => p && fs.existsSync(p));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (e) { puppeteer = null; }
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (text) => String(text || '').replace(/[\s  ]/g, '');

async function api(p, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, data };
}

test('Facturation — NBR dans Chrome réel', { timeout: 240000, skip: !CHROME ? 'Chrome absent' : !puppeteer ? 'puppeteer-core absent' : false }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facturation-nbr-e2e-'));
  const env = { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
    PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', DATABASE_URL: `sqlite:///${path.join(tmp, 'e2e.db')}`,
    JWT_SECRET: 'facturation-nbr-e2e-secret-000000000000', ADMIN_SYSTEM_USERNAME: 'NBRADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false' };
  let server, browser, token;
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test('serveur local et compte Facturation', async () => {
    server = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PORT)], { cwd: tmp, env, stdio: 'ignore' });
    let login;
    for (let i = 0; i < 100 && login?.status !== 200; i++) {
      try { login = await api('/auth/admin-system-login', { method: 'POST', body: { username: 'NBRADMIN', password: PASSWORD } }); } catch (e) {}
      if (login?.status !== 200) await delay(200);
    }
    assert.strictEqual(login?.status, 200, 'serveur non prêt');
    const created = await api('/auth/users', { method: 'POST', token: login.data.access_token, body: { username: 'FAC01', full_name: 'FAC01 NBR', email: 'fac01@example.com',
      role: 'ops', access_level: 'H3', authorized_modules: ['fac'], authorized_societies: [SOCIETY], authorized_sites: [], authorized_structures: [],
      authorized_actions: ['read', 'create', 'update', 'validate'], global_society_access: false, password: PASSWORD, validation_password: PASSWORD } });
    assert.strictEqual(created.status, 200, JSON.stringify(created.data));
    token = (await api('/auth/login', { method: 'POST', body: { username: 'FAC01', password: PASSWORD } })).data.access_token;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'chrome'),
      args: ['--no-first-run', '--no-default-browser-check', `--host-resolver-rules=MAP fac.irongs.com 127.0.0.1:${PORT}`] });
  });

  await t.test('MAGASINIER : NBR 30 × 25 jours × 3 070,32 = 2 302 740,00, brouillon rouvert, montants serveur, responsive', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    // Compte volontairement minimal (module « fac » seul) : les 403 attendus des chargements
    // d'arrière-plan employés/clients de l'application (pré-existants, hors NBR) sont écartés ;
    // toute autre erreur console ou exception JavaScript fait échouer le test.
    const expected403 = /Erreur API 403 .*\/api\/(drh\/employees|commercial\/clients)|Impossible de charger les employés backend/;
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !expected403.test(m.text())) errors.push(m.text()); });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://fac.irongs.com/#/login', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login-form [name="username"]', { visible: true });
    await page.type('#login-form [name="username"]', 'FAC01');
    await page.type('#login-form [name="password"]', PASSWORD);
    await page.click('.sgdi-login-submit');
    await page.waitForSelector('.module-host-soc-card, #sidebar-nav .nav-link, #sidebar-nav .paie-nav-link', { visible: true, timeout: 20000 });
    if (await page.$('.module-host-soc-card')) {
      await page.evaluate((soc) => [...document.querySelectorAll('.module-host-soc-card')].find((c) => c.textContent.includes(soc))?.click(), SOCIETY);
    }
    const openList = async () => {
      await page.evaluate(() => { location.hash = '#/facturation/factures'; });
      await page.waitForFunction(() => typeof window.factureEditorOpen === 'function', { timeout: 20000 });
    };
    await openList();
    await page.evaluate(() => window.factureEditorOpen());
    await page.waitForSelector('#fact-lignes-body', { timeout: 20000 });
    await page.evaluate(() => window.factureEditorLigneAdd('article'));
    const row = '#fact-lignes-body .fact-ligne-row[data-type="article"]';
    await page.waitForSelector(row + ' .fact-ligne-nbr');
    assert.strictEqual(await page.$eval(row + ' .fact-ligne-nbr', (el) => el.value), '1', 'NBR = 1 par défaut');
    const heads = await page.$$eval('.fact-editor-lines thead th', (ths) => ths.map((th) => th.textContent.trim()));
    assert.deepStrictEqual(heads, ['Désignation', 'Unité', 'NBR', 'Prix unitaire', 'Quantité', 'Total', 'Actions']);
    await page.type(row + ' .fact-ligne-desig', 'MAGASINIER');
    await page.click(row + ' .fact-ligne-nbr', { clickCount: 3 });
    await page.type(row + ' .fact-ligne-nbr', '30');
    await page.click(row + ' .fact-ligne-prix', { clickCount: 3 });
    await page.type(row + ' .fact-ligne-prix', '3070,32');
    // Unité « Jour » : période du 01 au 25/09 ⇒ quantité = 25 jours (dialogue existant).
    await page.select(row + ' .fact-ligne-unite', 'Jour');
    await page.waitForSelector('#fact-days-form');
    await page.$eval('#fact-days-start', (el) => { el.value = '2026-09-01'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.$eval('#fact-days-end', (el) => { el.value = '2026-09-25'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.$eval('#fact-days-form', (form) => form.requestSubmit());
    await page.waitForSelector('#fact-days-form', { hidden: true });
    assert.strictEqual(await page.$eval(row + ' .fact-ligne-qte', (el) => el.value), '25');
    assert.strictEqual(await page.$eval(row + ' .fact-ligne-nbr', (el) => el.value), '30', 'le mode Jour ne touche jamais au NBR');
    const screen = async () => page.evaluate((r) => ({ line: document.querySelector(r + ' .fact-ligne-total').textContent,
      ht: document.getElementById('fact-r-ht').textContent, tva: document.getElementById('fact-r-tva').textContent,
      ttc: document.getElementById('fact-r-ttc').textContent }), row);
    let s = await screen();
    assert.deepStrictEqual([s.line, s.ht, s.tva, s.ttc].map(plain), ['2302740,00DZD', '2302740,00DZD', '437520,60DZD', '2740260,60DZD']);
    // Recalcul instantané : NBR 30 → 31.
    await page.click(row + ' .fact-ligne-nbr', { clickCount: 3 });
    await page.type(row + ' .fact-ligne-nbr', '31');
    s = await screen();
    assert.strictEqual(plain(s.line), '2379498,00DZD');
    await page.click(row + ' .fact-ligne-nbr', { clickCount: 3 });
    await page.type(row + ' .fact-ligne-nbr', '30');
    // Responsive : aucune barre de défilement globale, NBR lisible à chaque largeur.
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewport({ width, height: 900 });
      await delay(150);
      const state = await page.evaluate((r) => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        nbrWidth: document.querySelector(r + ' .fact-ligne-nbr').getBoundingClientRect().width }), row);
      assert.strictEqual(state.overflow, false, `débordement global à ${width}px`);
      assert.ok(state.nbrWidth >= 40, `NBR illisible à ${width}px (${state.nbrWidth}px)`);
    }
    await page.setViewport({ width: 1440, height: 900 });
    // Enregistrement du brouillon, puis montants recalculés par le serveur.
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/irongs/collections/factures/items') && res.request().method() !== 'GET', { timeout: 15000 }),
      page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Enregistrer le brouillon').click()),
    ]);
    const id = await page.evaluate(() => window.__factureEditId);
    await delay(300);
    const stored = (await api(`/irongs/collections/factures/items/${encodeURIComponent(id)}`, { token })).data;
    assert.strictEqual(stored.lignes[0].nbr, 30);
    assert.strictEqual(stored.lignes[0].qte, 25);
    assert.deepStrictEqual([stored.totalHT, stored.tvaAmt, stored.ttc], [2302740, 437520.6, 2740260.6]);
    // Rechargement complet de la page puis réouverture du brouillon.
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Comme un utilisateur : attendre la fin du chargement des données, puis ouvrir la liste
    // par la navigation de l'application (menu), jamais par une simple réécriture de l'URL.
    await page.waitForFunction(() => { try { return sgdiHydrated === true; } catch (e) { return false; } }, { timeout: 30000 });
    // Pré-existant (reproduit sur origin/main sans NBR) : après rechargement, le chargement
    // « léger » ne ramène pas les factures SQL pour ce profil local ; on déclenche le
    // rechargement complet existant de l'application avant d'ouvrir la liste.
    await page.evaluate(() => sgdiPullState({ force: true }));
    await page.evaluate(() => navigate('facturation/factures'));
    await page.waitForFunction(() => typeof window.factureEditorOpen === 'function', { timeout: 20000 });
    await page.waitForFunction((i) => document.querySelector(`[data-fact-id="${i}"]`), { timeout: 20000 }, id);
    await page.evaluate((i) => window.factureEditorOpen(i), id);
    await page.waitForSelector(row + ' .fact-ligne-nbr', { timeout: 20000 });
    assert.strictEqual(await page.$eval(row + ' .fact-ligne-nbr', (el) => el.value), '30');
    s = await screen();
    assert.strictEqual(plain(s.line), '2302740,00DZD');
    assert.deepStrictEqual(errors, []);
  });
});
