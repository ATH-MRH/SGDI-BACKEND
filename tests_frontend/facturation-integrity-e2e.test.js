// Facturation — intégrité financière : E2E Chrome réel sur fac.irongs.com (serveur uvicorn local).
// Base : SQLite temporaire, ou PostgreSQL JETABLE si FACTURATION_E2E_PG_URL est défini (schéma créé
// par `alembic upgrade head`, comme en production). Compte Facturation seul (module « fac »).
// Paiement partiel puis complet, trop-perçu refusé, double envoi, avoir numéroté par le serveur,
// avance et caisse ; tout est relu après déconnexion et reconnexion ; TVA 0 % conservée à la
// réouverture ; balance âgée. `npm run test:facturation-integrity-e2e`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const PORT = 8973;
const BASE = `http://127.0.0.1:${PORT}`;
const SOCIETY = 'IRON GLOBAL SOLUTION';
const PASSWORD = 'facturation-integrity-e2e-password';
const PYTHON = process.env.ATLAS_E2E_PYTHON || 'python3';
const PG_URL = process.env.FACTURATION_E2E_PG_URL || '';
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => p && fs.existsSync(p));
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (e) { puppeteer = null; }
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + '/api' + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, data };
}

test('Facturation — intégrité financière dans Chrome réel', { timeout: 300000, skip: !CHROME ? 'Chrome absent' : !puppeteer ? 'puppeteer-core absent' : false }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facturation-integrity-e2e-'));
  const env = { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
    PYTHONPATH: ROOT, APP_ENV: 'test', LOG_LEVEL: 'ERROR', DATABASE_URL: PG_URL || `sqlite:///${path.join(tmp, 'e2e.db')}`,
    JWT_SECRET: 'facturation-integrity-e2e-secret-0000000', ADMIN_SYSTEM_USERNAME: 'INTADMIN', ADMIN_SYSTEM_PASSWORD: PASSWORD,
    SGDI_UPLOADS_DIR: path.join(tmp, 'uploads'), LOGIN_MAX_ATTEMPTS: '1000000', STARTUP_MAINTENANCE_ENABLED: 'false' };
  let server, browser, page, admin, fac;
  const errors = [];
  t.after(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const login = async () => {
    await page.goto('http://fac.irongs.com/#/login', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login-form [name="username"]', { visible: true });
    await page.type('#login-form [name="username"]', 'FAC01');
    await page.type('#login-form [name="password"]', PASSWORD);
    await page.click('.sgdi-login-submit');
    await page.waitForSelector('.module-host-soc-card, #sidebar-nav .fac-nav-link', { visible: true, timeout: 20000 });
    if (await page.$('.module-host-soc-card')) {
      await page.evaluate((soc) => [...document.querySelectorAll('.module-host-soc-card')].find((c) => c.textContent.includes(soc))?.click(), SOCIETY);
    }
    await page.waitForSelector('#sidebar-nav .fac-nav-link', { visible: true, timeout: 20000 });
  };
  // Juste après le choix de la société, l'application termine son propre routage (accueil) :
  // une navigation demandée trop tôt peut être remplacée. On la redemande jusqu'à l'écran voulu.
  const go = async (route, ready) => {
    for (let attempt = 0; ; attempt++) {
      await page.evaluate((r) => { if (location.hash !== '#/' + r) location.hash = '#/' + r; }, route);
      try { await page.waitForFunction(ready, { timeout: 7000 }); return; }
      catch (e) { if (attempt >= 3) throw e; }
    }
  };
  const openInvoice = async (id) => {
    await go('facturation/factures', () => typeof window.factureEditorOpen === 'function');
    // Pièces créées par l'API pendant le test : relues comme au chargement de l'application.
    await page.evaluate(() => syncFacturationFromPostgres({}));
    await page.evaluate((x) => window.factureEditorOpen(x), id);
    await page.waitForSelector('#fact-lignes-body', { timeout: 20000 });
  };
  // Remplit et envoie le formulaire de la fenêtre ouverte ; attend sa fermeture ou un message d'erreur.
  const submitModal = async (values, { twice = false, serverCheck = false } = {}) => {
    await page.waitForSelector('.modal-bg form');
    await page.evaluate((v, double, noBrowserCheck) => {
      const form = document.querySelector('.modal-bg form');
      // Contrôle serveur : la limite du navigateur (attribut max) est levée pour cet envoi.
      form.noValidate = noBrowserCheck;
      // Seules les notifications apparues après cet envoi comptent (les précédentes restent affichées).
      window.__e2eToast = '';
      new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) window.__e2eToast += n.textContent || ''; })
        .observe(document.getElementById('toast-host'), { childList: true });
      for (const [name, value] of Object.entries(v)) form.querySelector(`[name="${name}"]`).value = value;
      form.requestSubmit();
      if (double) form.requestSubmit();
    }, values, twice, serverCheck);
    await page.waitForFunction(() => !document.querySelector('.modal-bg form') || /impossible|non enregistr|supérieur|dépasserait/i.test(window.__e2eToast || ''), { timeout: 20000 });
    return page.evaluate(() => ({ open: !!document.querySelector('.modal-bg form'), toast: window.__e2eToast || '' }));
  };
  const rows = async (name) => (await api(`/irongs/collections/${name}/items`, { token: admin })).data;
  const invoice = async (extra) => {
    const draft = await api('/irongs/collections/factures/items', { method: 'POST', token: fac, body: { data: { id: 'fc_e2e_' + Math.random().toString(36).slice(2, 10), statut: 'brouillon',
      societe: SOCIETY, client: 'CLIENT E2E', clientId: 'cl_e2e', clientNom: 'CLIENT E2E', modeReglement: 'Chèque', date: '2026-09-01', echeance: '30', periodeDebut: '2026-09-01', periodeFin: '2026-09-30', objet: 'PRESTATION',
      lignes: [{ type: 'article', designation: 'AGENT', unite: 'Mois', nbr: 1, qte: 1, prixUnitHT: 1000 }], ...extra } } });
    assert.strictEqual(draft.status, 200, JSON.stringify(draft.data));
    return draft.data;
  };

  await t.test('serveur local et compte Facturation seul', async () => {
    if (PG_URL) {
      const mig = spawnSync(PYTHON, ['-m', 'alembic', 'upgrade', 'head'], { cwd: ROOT, env, encoding: 'utf8' });
      assert.strictEqual(mig.status, 0, mig.stderr);
    }
    server = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PORT)], { cwd: tmp, env, stdio: 'ignore' });
    let res;
    for (let i = 0; i < 150 && res?.status !== 200; i++) {
      try { res = await api('/auth/admin-system-login', { method: 'POST', body: { username: 'INTADMIN', password: PASSWORD } }); } catch (e) {}
      if (res?.status !== 200) await delay(200);
    }
    assert.strictEqual(res?.status, 200, 'serveur non prêt');
    admin = res.data.access_token;
    const created = await api('/auth/users', { method: 'POST', token: admin, body: { username: 'FAC01', full_name: 'FAC01 E2E', email: 'fac01@example.com',
      role: 'ops', access_level: 'H3', authorized_modules: ['fac'], authorized_societies: [SOCIETY], authorized_sites: [], authorized_structures: [],
      authorized_actions: ['read', 'create', 'update', 'validate', 'delete'], global_society_access: false, password: PASSWORD, validation_password: PASSWORD } });
    assert.strictEqual(created.status, 200, JSON.stringify(created.data));
    fac = (await api('/auth/login', { method: 'POST', body: { username: 'FAC01', password: PASSWORD } })).data.access_token;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: path.join(tmp, 'chrome'),
      args: ['--no-first-run', '--no-default-browser-check', `--host-resolver-rules=MAP fac.irongs.com 127.0.0.1:${PORT}`] });
    page = await browser.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 4).join(' | ')));
    page.on('dialog', (d) => d.accept());
    await page.setViewport({ width: 1440, height: 900 });
  });

  let issued, credited;
  await t.test('validation par l’écran : double clic, un seul numéro', async () => {
    const draft = await invoice();
    await login();
    await openInvoice(draft.id);
    await page.waitForFunction(() => !document.getElementById('fact-validate-btn')?.disabled, { timeout: 20000 });
    await page.evaluate(() => { const b = document.getElementById('fact-validate-btn'); b.click(); b.click(); });
    await page.waitForFunction(() => /Facture validée/.test(document.body.textContent), { timeout: 20000 });
    const all = (await rows('factures')).filter((f) => f.id === draft.id);
    assert.strictEqual(all.length, 1);
    assert.match(all[0].numero, /^FAC\d{4}\//);
    assert.strictEqual(all[0].ttc, 1190);
    issued = all[0];
  });

  await t.test('paiement partiel, double envoi, trop-perçu refusé, paiement complet', async () => {
    await openInvoice(issued.id);
    await page.evaluate((id) => window.openPaiementModal(id), issued.id);
    let out = await submitModal({ montant: '400', mode: 'Chèque', reference: 'CHQ-E2E' }, { twice: true });
    assert.strictEqual(out.open, false, out.toast);
    let pays = (await rows('paiements')).filter((p) => p.factureId === issued.id);
    assert.deepStrictEqual(pays.map((p) => p.montant), [400], 'un seul paiement malgré le double envoi');
    await page.evaluate((id) => window.openPaiementModal(id), issued.id);
    out = await submitModal({ montant: '800' }, { serverCheck: true });
    assert.strictEqual(out.open, true);
    assert.match(out.toast, /reste à encaisser/);
    await page.evaluate(() => window.closeModal());
    await page.evaluate((id) => window.openPaiementModal(id), issued.id);
    out = await submitModal({ montant: '790', mode: 'Espèces' });
    assert.strictEqual(out.open, false, out.toast);
    pays = (await rows('paiements')).filter((p) => p.factureId === issued.id);
    assert.deepStrictEqual(pays.map((p) => p.montant).sort((a, b) => a - b), [400, 790]);
    // Seul le paiement en espèces entre dans la caisse ; le chèque reste « à encaisser ».
    const cash = (await rows('caisse')).filter((c) => c.factureId === issued.id);
    assert.deepStrictEqual(cash.map((c) => [c.categorie, c.montant, c.societe]), [['Encaissement facture', 790, SOCIETY]]);
    assert.deepStrictEqual(pays.map((p) => [p.mode, p.suivi.statut]).sort(), [['Chèque', 'a_encaisser'], ['Espèces', 'encaisse']]);
  });

  await t.test('avoir numéroté par le serveur, avance et caisse', async () => {
    const draft = await invoice();
    credited = (await api(`/irongs/factures/${draft.id}/valider`, { method: 'POST', token: fac })).data;
    await page.evaluate(() => syncFacturationFromPostgres({}));
    await page.evaluate((id) => window.openAvoirModal(id), credited.id);
    let out = await submitModal({ montant: '190', motif: 'Remise accordée' });
    assert.strictEqual(out.open, false, out.toast);
    const avoirs = (await rows('avoirs')).filter((a) => a.factureId === credited.id);
    assert.strictEqual(avoirs.length, 1);
    assert.match(avoirs[0].numero, /^AV-\d{4}-\d{4}$/);
    await go('facturation/avances', () => typeof window.openAvanceModal === 'function');
    await page.evaluate(() => window.openAvanceModal());
    out = await submitModal({ client: 'CLIENT AVANCE E2E', montant: '1500', mode: 'Espèces' });
    assert.strictEqual(out.open, false, out.toast);
    await go('facturation/caisse', () => typeof window.openCaisseModal === 'function');
    await page.evaluate(() => window.openCaisseModal('sortie'));
    out = await submitModal({ libelle: 'Carburant E2E', montant: '80' });
    assert.strictEqual(out.open, false, out.toast);
  });

  await t.test('déconnexion puis reconnexion : toutes les pièces sont relues depuis le serveur', async () => {
    await page.evaluate(() => window.logout());
    await page.waitForSelector('#login-form [name="username"]', { visible: true });
    await page.reload({ waitUntil: 'networkidle0' });
    await login();
    await go('facturation/paiements', () => /paiements reçus/i.test(document.getElementById('view')?.textContent || ''));
    const payments = await page.$eval('#view', (v) => v.textContent);
    assert.match(payments, /2 paiements/);
    assert.ok(payments.includes(issued.numero));
    // Chèque encaissé depuis l'écran : étape enregistrée et historisée par le serveur.
    const cheque = (await rows('paiements')).find((p) => p.factureId === issued.id && p.mode === 'Chèque');
    await page.evaluate((id) => document.querySelector(`[data-paiement-id="${id}"] [data-suivi="encaisse"]`).click(), cheque.id);
    let out = await submitModal({ reference: 'REMISE-E2E' });
    assert.strictEqual(out.open, false, out.toast);
    const followed = (await rows('paiements')).find((p) => p.id === cheque.id);
    assert.deepStrictEqual(followed.suivi.historique.map((h) => h.statut), ['a_encaisser', 'encaisse']);
    await go('facturation/avoirs', () => /avoirs/i.test(document.getElementById('view')?.textContent || ''));
    assert.match(await page.$eval('#view', (v) => v.textContent), /AV-\d{4}-\d{4}/);
    // Avoir numéroté : ni suppression, ni annulation tant que la règle n'est pas activée.
    await page.waitForFunction(() => window.__factRegles && typeof window.__factRegles === 'object', { timeout: 10000 });
    assert.strictEqual(await page.$$eval('#view button[onclick^="deleteAvoir"], #view button[onclick^="openAvoirAnnulationModal"]', (b) => b.length), 0);
    await go('facturation/avances', () => /avances clients/i.test(document.getElementById('view')?.textContent || ''));
    assert.ok((await page.$eval('#view', (v) => v.textContent)).includes('CLIENT AVANCE E2E'));
    await go('facturation/caisse', () => /mouvements/.test(document.getElementById('view')?.textContent || ''));
    const caisse = await page.$eval('#view', (v) => v.textContent);
    for (const label of ['Carburant E2E', 'Avance CLIENT AVANCE E2E', `Paiement facture ${issued.numero}`]) assert.ok(caisse.includes(label), label);
    // Écritures liées : pas de bouton de suppression ; écriture libre : supprimable.
    assert.strictEqual(await page.$$eval('#view button[onclick^="deleteCaisse"]', (b) => b.length), 1);
    // État de règlement recalculé par l'écran à partir des paiements relus : payée.
    assert.strictEqual(await page.evaluate((id) => factureStatutPaye(db.factures.find((f) => f.id === id)).statut, issued.id), 'payee');
  });

  await t.test('suppression d’un paiement : son écriture de caisse disparaît aussi', async () => {
    const pay = (await rows('paiements')).find((p) => p.factureId === issued.id && p.montant === 790);
    await go('facturation/paiements', () => typeof window.deletePaiement === 'function');
    await page.evaluate((id) => window.deletePaiement(id), pay.id);
    await page.waitForFunction(() => /1 paiements/.test(document.getElementById('view')?.textContent || ''), { timeout: 20000 });
    assert.ok(!(await rows('caisse')).some((c) => c.paiementId === pay.id));
  });

  await t.test('TVA 0 % conservée à la réouverture et à la validation', async () => {
    const draft = await invoice({ tvaPct: 0 });
    assert.strictEqual(draft.ttc, 1000);
    await openInvoice(draft.id);
    assert.strictEqual(await page.$eval('#fact-tva-global', (el) => el.value), '0');
    assert.match(await page.$eval('#fact-r-tva', (el) => el.textContent.replace(/\s/g, '')), /^0,00/);
    await page.waitForFunction(() => !document.getElementById('fact-validate-btn')?.disabled, { timeout: 20000 });
    await page.evaluate(() => document.getElementById('fact-validate-btn').click());
    await page.waitForFunction(() => /Facture validée/.test(document.body.textContent), { timeout: 20000 });
    const saved = (await rows('factures')).find((f) => f.id === draft.id);
    assert.deepStrictEqual([saved.statut, saved.tvaPct, saved.tvaAmt, saved.ttc], ['emise', 0, 0, 1000]);
  });

  await t.test('balance âgée : colonne « Non échu » et aucune erreur JavaScript', async () => {
    await go('facturation/balance', () => /balance ag/i.test(document.getElementById('view')?.textContent || ''));
    const heads = await page.$$eval('#view thead th', (ths) => ths.map((th) => th.textContent.trim()));
    assert.deepStrictEqual(heads, ['Client', 'Factures', 'Total facturé', 'Encaissé', 'Non échu', '0–30 jours', '31–60 jours', '61–90 jours', '> 90 jours', 'Échéance non renseignée']);
    assert.deepStrictEqual(errors, []);
  });
});
