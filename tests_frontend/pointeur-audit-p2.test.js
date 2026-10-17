// Audit pointeur.irongs.com — P2 : robustesse du poste et de la borne (coupure réseau, scan
// pendant un traitement, déconnexion, cache). Fonctions réelles des pages, aucune réimplémentation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadPointeur } = require('./load-pointeur');

const STATIC = path.join(__dirname, '..', 'app', 'static');
const read = (name) => fs.readFileSync(path.join(STATIC, name), 'utf8');
const SESSION = { token: 'tok-p2', user: { username: 'PTG01', full_name: 'Agent Test' } };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function boot(routes = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const parsed = new URL(String(url), 'https://pointeur.irongs.com');
    calls.push({ path: parsed.pathname, body: options.body ? JSON.parse(options.body) : null });
    const handler = routes[parsed.pathname];
    if (handler) return handler(parsed, options);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
  };
  const app = loadPointeur({ fetch, url: 'https://pointeur.irongs.com/pointeur' });
  const w = app.window, t = app.T();
  await tick();
  t.setSession(SESSION);
  await t.enterApp();
  t.clearIdleInterval();
  await tick();
  return { w, t, calls, d: w.document };
}

async function teardown({ w, t }) {
  try { await t.logout(); } catch (e) { /* déjà déconnecté */ }
  w.close();
}

test('coupure réseau pendant un scan : « connexion perdue », jamais « scan refusé »', async () => {
  const app = await boot({ '/api/portal/attendance-qr/scan': async () => { throw new TypeError('Failed to fetch'); } });
  await app.t.onQr('qr-token');
  const result = app.d.getElementById('result');
  assert.match(result.textContent, /CONNEXION PERDUE/);
  assert.match(result.textContent, /a peut-être été enregistré/);
  assert.doesNotMatch(result.textContent, /SCAN REFUSÉ|Failed to fetch/);
  await teardown(app);
});

test('délai dépassé : traité comme une panne de transport', async () => {
  const app = await boot();
  const timeout = new Error('The operation timed out'); timeout.name = 'TimeoutError';
  const abort = new Error('aborted'); abort.name = 'AbortError';
  assert.equal(app.w.transportFailure(timeout), true);
  assert.equal(app.w.transportFailure(abort), true);
  assert.equal(app.w.transportFailure(new TypeError('x')), true);
  assert.equal(app.w.transportFailure(new Error('Journée clôturée')), false);
  const refusal = new Error('refus'); refusal.refusal = { code: 'X' };
  assert.equal(app.w.transportFailure(refusal), false, 'un refus métier reste un refus');
  await teardown(app);
});

test('refus métier : le message du serveur est conservé', async () => {
  const app = await boot({ '/api/portal/attendance-qr/scan': async () => ({ ok: false, status: 409, headers: { get: () => null }, json: async () => ({ detail: 'Journée clôturée : pointage refusé.' }) }) });
  await app.t.onQr('qr-token');
  const result = app.d.getElementById('result');
  assert.match(result.textContent, /SCAN REFUSÉ/);
  assert.match(result.textContent, /Journée clôturée/);
  await teardown(app);
});

test('second badge pendant le traitement du premier : signalé, jamais ignoré en silence', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const app = await boot({ '/api/portal/attendance-qr/scan': async () => { await pending; return { ok: true, status: 201, headers: { get: () => null }, json: async () => ({ success: true, action: 'arrivee', heure: '08:00:00', employee: { matricule: 'M1', nom: 'A', prenom: 'B' } }) }; } });
  const first = app.t.onQr('premier');
  await tick();
  await app.t.onQr('second');
  assert.match(app.d.getElementById('result').textContent, /PATIENTEZ/);
  assert.equal(app.calls.filter((call) => call.path === '/api/portal/attendance-qr/scan').length, 1, 'le second badge n’est pas envoyé');
  release(); await first;
  await teardown(app);
});

test('doublon renvoyé par le serveur : affiché « déjà enregistré », pas comme un nouveau mouvement', async () => {
  const app = await boot();
  app.w.showResult({ action: 'arrivee', duplicate: true, name: 'ADDA IBRAHIM', matricule: 'M1' }, 'success');
  assert.match(app.d.getElementById('result').textContent, /DÉJÀ ENREGISTRÉ — AUCUN NOUVEAU MOUVEMENT/);
  app.w.showResult({ action: 'arrivee', name: 'ADDA IBRAHIM', matricule: 'M1' }, 'success');
  assert.match(app.d.getElementById('result').textContent, /ARRIVÉE ENREGISTRÉE/);
  await teardown(app);
});

test('déconnexion : aucune donnée du compte précédent ne reste à l’écran', async () => {
  const app = await boot();
  const feed = app.d.getElementById('liveFeedList'), tracking = app.d.getElementById('trackingBody');
  feed.innerHTML = '<div class="row">ADDA IBRAHIM · M1</div>';
  tracking.innerHTML = '<tr><td>BELKACEM SAMIR</td></tr>';
  app.d.getElementById('result').innerHTML = '<div>ADDA IBRAHIM</div>';
  app.t.setPlanningEvents([{ employee_id: 1, nom: 'ADDA', scanned_at: '2026-10-01T08:00:00+01:00' }]);
  app.t.setPost({ kpi: { expected: 3 }, present: [{ employee: { id: 1, nom: 'ADDA' } }], todo: [], movements: [] });
  await app.t.logout();
  assert.equal(feed.textContent.includes('ADDA'), false);
  assert.equal(tracking.textContent.includes('BELKACEM'), false);
  assert.equal(app.d.getElementById('result').textContent.includes('ADDA'), false);
  assert.equal(app.t.getPost(), null);
  assert.equal(app.t.getLive().serverSummary, null);
  app.w.close();
});

test('fichiers du poste : versionnés, donc renouvelés à chaque livraison malgré le cache d’un an', () => {
  const html = read('pointeur.html');
  for (const file of ['html5-qrcode.min.js', 'pointeur-facial.js', 'pointeur-workstation.css']) {
    const match = html.match(new RegExp('/static/' + file.replace(/\./g, '\\.') + '\\?v=([^"\']+)'));
    assert.ok(match, file + ' porte un paramètre de version');
    assert.notEqual(match[1], '1', file + ' : la version figée « 1 » n’est plus utilisée');
  }
  assert.doesNotMatch(read('pointeur-borne.html'), /pointeur-borne\.js\?v=20261005-v2/);
});

test('requêtes : délai d’expiration sur le poste et sur la borne', () => {
  const html = read('pointeur.html'), kiosk = read('pointeur-borne.js');
  assert.match(html, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  assert.match(kiosk, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  assert.match(kiosk, /signal\s*\}\)/);
  // Borne : un QR dont le traitement a échoué côté transport ou serveur peut être représenté.
  assert.match(kiosk, /e\.status >= 500\) B\._lastQr = null/);
});

test('service worker : ni l’API ni les photos du personnel ne sont mises en cache', () => {
  const sw = read('pointeur-sw.js');
  assert.match(sw, /startsWith\('\/api\/'\)/);
  assert.match(sw, /startsWith\('\/uploads\/'\)/);
  assert.match(sw, /pointeur-atlas-v4/);                              // nouveau nom : l'ancien cache (photos) est purgé à l'activation
});
