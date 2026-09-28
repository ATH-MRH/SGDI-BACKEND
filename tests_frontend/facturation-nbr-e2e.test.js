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
  let server, browser, token, noValidateToken;
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
    // Client créé côté Commercial (administrateur) : le compte Facturation doit le voir via le
    // référentiel client limité, sans module Commercial.
    const cl = await api('/commercial/clients', { method: 'POST', token: login.data.access_token, body: { name: 'CLIENT NBR E2E', society: SOCIETY, nif: 'NIF-E2E',
      data: { nom: 'CLIENT NBR E2E', societe: SOCIETY, notes: 'interne', lignesFacturation: [{ designation: 'MAGASINIER', prixUnitaire: 3070.32, unite: 'Jour' },
        { designation: 'AGENT HEURE', prixUnitaire: 550, unite: 'Heure' }],
        tech_sites: [{ nom: 'Site A', lignesFacturation: [{ designation: 'MAGASINIER', qte: 30 }, { designation: 'AGENT HEURE', qte: 10 }] }] } } });
    // Une prestation tarifée sans unité tarifaire est refusée par Commercial.
    assert.strictEqual((await api('/commercial/clients', { method: 'POST', token: login.data.access_token, body: { name: 'SANS UNITE', society: SOCIETY,
      data: { nom: 'SANS UNITE', societe: SOCIETY, lignesFacturation: [{ designation: 'X', prixUnitaire: 10 }] } } })).status, 422);
    assert.strictEqual(cl.status, 200, JSON.stringify(cl.data));
    // Compte Facturation SANS l'action « validate » : la validation doit lui être refusée.
    const nv = await api('/auth/users', { method: 'POST', token: login.data.access_token, body: { username: 'FAC02', full_name: 'FAC02 NBR', email: 'fac02@example.com',
      role: 'ops', access_level: 'H3', authorized_modules: ['fac'], authorized_societies: [SOCIETY], authorized_sites: [], authorized_structures: [],
      authorized_actions: ['read', 'create', 'update'], global_society_access: false, password: PASSWORD, validation_password: PASSWORD } });
    assert.strictEqual(nv.status, 200, JSON.stringify(nv.data));
    noValidateToken = (await api('/auth/login', { method: 'POST', body: { username: 'FAC02', password: PASSWORD } })).data.access_token;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'chrome'),
      args: ['--no-first-run', '--no-default-browser-check', `--host-resolver-rules=MAP fac.irongs.com 127.0.0.1:${PORT}`] });
  });

  await t.test('MAGASINIER : NBR 30 × 25 jours × 3 070,32 = 2 302 740,00, brouillon rouvert, montants serveur, responsive', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    // Compte Facturation seul (module « fac ») : aucune requête refusée, aucune erreur
    // console ni exception JavaScript — l'application ne doit exiger ni DRH ni Commercial.
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', (res) => { if (res.status() >= 400 && res.url().includes('/api/')) errors.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
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
    await page.evaluate(() => navigate('facturation/factures'));
    await page.waitForFunction(() => typeof window.factureEditorOpen === 'function', { timeout: 20000 });
    await page.waitForFunction((i) => document.querySelector(`[data-fact-id="${i}"]`), { timeout: 20000 }, id);
    await page.evaluate((i) => window.factureEditorOpen(i), id);
    await page.waitForSelector(row + ' .fact-ligne-nbr', { timeout: 20000 });
    assert.strictEqual(await page.$eval(row + ' .fact-ligne-nbr', (el) => el.value), '30');
    s = await screen();
    assert.strictEqual(plain(s.line), '2302740,00DZD');
    // Référentiel client limité chargé pour ce compte (coordonnées + catalogue, pas de notes).
    const clients = await page.evaluate(() => db.clients.map((c) => ({ nom: c.nom, nif: c.nif, hasNotes: 'notes' in c, effectif: c.tech_sites?.[0]?.lignesFacturation?.[0]?.qte })));
    assert.deepStrictEqual(clients, [{ nom: 'CLIENT NBR E2E', nif: 'NIF-E2E', hasNotes: false, effectif: 30 }]);
    // Validation par le compte Facturation (module + action validate + société) : montants figés.
    const validated = await api(`/irongs/factures/${encodeURIComponent(id)}/valider`, { method: 'POST', token });
    assert.strictEqual(validated.status, 200, JSON.stringify(validated.data));
    assert.deepStrictEqual([validated.data.statut, validated.data.lignes[0].nbr, validated.data.totalHT], ['emise', 30, 2302740]);
    assert.deepStrictEqual(errors, []);
    await page.close();
  });

  await t.test('FAC01 — ligne du contrat : NBR = effectif, unité choisie, quantité selon la période, recalcul, reload, validation', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', (res) => { if (res.status() >= 400 && res.url().includes('/api/')) errors.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
    await page.setViewport({ width: 1440, height: 900 });
    // Nouvel onglet : nouvelle connexion FAC01 (la session est propre à l'onglet).
    await page.goto('http://fac.irongs.com/#/login', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login-form [name="username"]', { visible: true });
    await page.type('#login-form [name="username"]', 'FAC01');
    await page.type('#login-form [name="password"]', PASSWORD);
    await page.click('.sgdi-login-submit');
    await page.waitForSelector('.module-host-soc-card, #sidebar-nav .nav-link, #sidebar-nav .paie-nav-link', { visible: true, timeout: 20000 });
    if (await page.$('.module-host-soc-card')) {
      await page.evaluate((soc) => [...document.querySelectorAll('.module-host-soc-card')].find((c) => c.textContent.includes(soc))?.click(), SOCIETY);
    }
    await page.evaluate(() => { location.hash = '#/facturation/factures'; });
    await page.waitForFunction(() => { try { return sgdiHydrated === true && typeof window.factureEditorOpen === 'function'; } catch (e) { return false; } }, { timeout: 30000 });
    await page.waitForFunction(() => (db.clients || []).some((c) => c.nom === 'CLIENT NBR E2E'), { timeout: 20000 });
    await page.evaluate(() => window.factureEditorOpen());
    await page.waitForSelector('#fact-lignes-body', { timeout: 20000 });
    const setPeriod = (start, end) => page.evaluate((a, b) => {
      for (const [id, v] of [['fact-periode-debut', a], ['fact-periode-fin', b]]) {
        const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, start, end);
    await setPeriod('2026-09-01', '2026-09-30');
    await page.evaluate(() => window.factureEditorChooseClient(db.clients.find((c) => c.nom === 'CLIENT NBR E2E').id));
    await page.waitForSelector('.fact-catalog-card button:not([disabled])');
    assert.match(await page.$eval('#fact-commercial-catalog', (el) => el.textContent), /Effectif contrat : 30/);
    assert.match(await page.$eval('#fact-commercial-catalog', (el) => el.textContent), /3\s070,32\sDZD HT \/ Jour/);
    await page.click('.fact-catalog-card button:not([disabled])');
    const row = '#fact-lignes-body .fact-ligne-row[data-type="article"]';
    await page.waitForSelector(row + '[data-catalog-key]');
    const state = () => page.evaluate((r) => { const el = document.querySelector(r);
      return { unite: el.querySelector('.fact-ligne-unite').value, nbr: el.querySelector('.fact-ligne-nbr').value, qte: el.querySelector('.fact-ligne-qte').value,
        mode: el.dataset.qteMode, total: el.querySelector('.fact-ligne-total').textContent, ht: document.getElementById('fact-r-ht').textContent,
        tva: document.getElementById('fact-r-tva').textContent, ttc: document.getElementById('fact-r-ttc').textContent }; }, row);
    let s = await state();
    // Unité tarifaire reçue de la prestation Commercial (verrouillée), quantité = jours de la période.
    assert.deepStrictEqual([s.unite, s.nbr, s.qte, s.mode, plain(s.total)], ['Jour', '30', '30', 'auto', '2763288,00DZD']);
    assert.strictEqual(await page.$eval(row + ' .fact-ligne-unite', (el) => el.disabled), true);
    await setPeriod('2026-09-01', '2026-09-25');                                    // recalcul automatique
    s = await state();
    assert.deepStrictEqual([s.qte, s.total, s.ht, s.tva, s.ttc].map(plain), ['25', '2302740,00DZD', '2302740,00DZD', '437520,60DZD', '2740260,60DZD']);
    await page.click(row + ' .fact-ligne-nbr', { clickCount: 3 }); await page.type(row + ' .fact-ligne-nbr', '31');
    assert.strictEqual(plain((await state()).total), '2379498,00DZD');
    await page.click(row + ' .fact-ligne-nbr', { clickCount: 3 }); await page.type(row + ' .fact-ligne-nbr', '30');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/irongs/collections/factures/items') && res.request().method() !== 'GET', { timeout: 15000 }),
      page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Enregistrer le brouillon').click()),
    ]);
    const id = await page.evaluate(() => window.__factureEditId);
    await delay(300);
    let stored = (await api(`/irongs/collections/factures/items/${encodeURIComponent(id)}`, { token })).data;
    assert.deepStrictEqual([stored.lignes[0].unite, stored.lignes[0].nbr, stored.lignes[0].qte, stored.lignes[0].qteAuto, stored.totalHT, stored.ttc],
      ['Jour', 30, 25, true, 2302740, 2740260.6]);
    // Rechargement complet, réouverture, nouveau changement de période.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { return sgdiHydrated === true; } catch (e) { return false; } }, { timeout: 30000 });
    await page.evaluate(() => navigate('facturation/factures'));
    await page.waitForFunction((i) => document.querySelector(`[data-fact-id="${i}"]`), { timeout: 20000 }, id);
    await page.evaluate((i) => window.factureEditorOpen(i), id);
    await page.waitForSelector(row + ' .fact-ligne-nbr', { timeout: 20000 });
    s = await state();
    assert.deepStrictEqual([s.unite, s.nbr, s.qte, s.mode, plain(s.total)], ['Jour', '30', '25', 'auto', '2302740,00DZD']);
    await setPeriod('2026-09-01', '2026-09-30');
    assert.strictEqual((await state()).qte, '30');
    await setPeriod('2026-09-01', '2026-09-25');
    // Quantité saisie à la main : conservée malgré un changement de période.
    await page.click(row + ' .fact-ligne-qte', { clickCount: 3 }); await page.type(row + ' .fact-ligne-qte', '20');
    await setPeriod('2026-09-01', '2026-09-30');
    s = await state();
    assert.deepStrictEqual([s.qte, s.mode, plain(s.total)], ['20', 'manual', '1842192,00DZD']);
    await page.click(row + ' .fact-ligne-qte', { clickCount: 3 }); await page.type(row + ' .fact-ligne-qte', '25');
    // Prestation à l'heure : 10 agents × 160 h saisies × 550 = 880 000 ; jamais déduit des dates.
    await page.click('.fact-catalog-card button:not([disabled])');
    const hourRow = '#fact-lignes-body .fact-ligne-row[data-type="article"]:nth-child(2)';
    await page.waitForSelector(hourRow + '[data-catalog-key]');
    assert.deepStrictEqual(await page.$eval(hourRow, (el) => [el.querySelector('.fact-ligne-unite').value, el.querySelector('.fact-ligne-nbr').value,
      el.querySelector('.fact-ligne-qte').value]), ['Heure', '10', '']);
    await page.type(hourRow + ' .fact-ligne-qte', '160');
    await setPeriod('2026-09-01', '2026-09-25');
    assert.deepStrictEqual(await page.$eval(hourRow, (el) => [el.querySelector('.fact-ligne-qte').value, el.querySelector('.fact-ligne-total').textContent.replace(/[\s  ]/g, '')]),
      ['160', '880000,00DZD']);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/irongs/collections/factures/items') && res.request().method() !== 'GET', { timeout: 15000 }),
      page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Enregistrer le brouillon').click()),
    ]);
    await delay(300);
    stored = (await api(`/irongs/collections/factures/items/${encodeURIComponent(id)}`, { token })).data;
    assert.deepStrictEqual([stored.lignes[0].qte, stored.lignes[0].qteAuto, stored.periodeFin], [25, false, '2026-09-25']);
    assert.deepStrictEqual(stored.lignes.map((l) => [l.unite, l.uniteContrat, l.prixUnitHT, l.nbr, l.qte, l.totalHT]),
      [['Jour', 'Jour', 3070.32, 30, 25, 2302740], ['Heure', 'Heure', 550, 10, 160, 880000]]);
    assert.strictEqual(stored.totalHT, 3182740);
    // Payload forgé sur le brouillon : Jour → Mois et prix falsifié ⇒ contrat rétabli par le serveur.
    const forgedDraft = await api(`/irongs/collections/factures/items/${encodeURIComponent(id)}`, { method: 'PUT', token,
      body: { data: { ...stored, lignes: [{ ...stored.lignes[0], unite: 'Mois', uniteContrat: 'Mois', prixUnitHT: 92109.6, prixContrat: 92109.6 }, stored.lignes[1]] } } });
    assert.strictEqual(forgedDraft.status, 200);
    stored = (await api(`/irongs/collections/factures/items/${encodeURIComponent(id)}`, { token })).data;
    assert.deepStrictEqual([stored.lignes[0].unite, stored.lignes[0].prixUnitHT, stored.totalHT], ['Jour', 3070.32, 3182740]);
    // RBAC : sans « validate » ⇒ refus ; FAC01 (validate, bonne société) ⇒ facture émise figée.
    assert.strictEqual((await api(`/irongs/factures/${encodeURIComponent(id)}/valider`, { method: 'POST', token: noValidateToken })).status, 403);
    const validated = await api(`/irongs/factures/${encodeURIComponent(id)}/valider`, { method: 'POST', token });
    assert.strictEqual(validated.status, 200, JSON.stringify(validated.data));
    assert.deepStrictEqual([validated.data.statut, validated.data.lignes[0].nbr, validated.data.lignes[0].qte, validated.data.totalHT, validated.data.ttc],
      ['emise', 30, 25, 3182740, 3787460.6]);
    const forged = await api(`/irongs/collections/factures/items/${encodeURIComponent(id)}`, { method: 'PUT', token,
      body: { data: { ...validated.data, periodeFin: '2026-09-30', lignes: [{ ...validated.data.lignes[0], nbr: 99, qte: 99, prixUnitHT: 1 }] } } });
    assert.strictEqual(forged.status, 200);
    const after = (await api(`/irongs/collections/factures/items/${encodeURIComponent(id)}`, { token })).data;
    assert.deepStrictEqual([after.periodeFin, after.lignes[0].nbr, after.lignes[0].qte, after.lignes[0].unite, after.totalHT], ['2026-09-25', 30, 25, 'Jour', 3182740]);
    // Aucun module implicite : API DRH et Commercial complètes toujours refusées.
    assert.strictEqual((await api('/drh/employees', { token })).status, 403);
    assert.strictEqual((await api('/commercial/clients', { token })).status, 403);
    assert.deepStrictEqual(errors, []);
    await page.close();
  });
});
