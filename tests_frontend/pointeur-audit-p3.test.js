// Audit pointeur.irongs.com — P3 : accessibilité et petits défauts du poste et de la borne.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadPointeur } = require('./load-pointeur');

const STATIC = path.join(__dirname, '..', 'app', 'static');
const SESSION = { token: 'tok-p3', user: { username: 'PTG01', full_name: 'Agent Test' } };
const EMPLOYEE = { id: 7, matricule: 'M007', nom: 'ADDA', prenom: 'Ibrahim', site: 'SITE TEST' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function boot(fetch) {
  const app = loadPointeur({ fetch, url: 'https://pointeur.irongs.com/pointeur' });
  const w = app.window, t = app.T();
  await tick();
  t.setSession(SESSION);
  await t.enterApp();
  t.clearIdleInterval();
  await tick();
  return { w, t, d: w.document };
}

async function teardown({ w, t }) { try { await t.logout(); } catch (e) { /* déjà déconnecté */ } w.close(); }

test('résultat de pointage et erreur de connexion : annoncés aux lecteurs d’écran', () => {
  const { window: w } = loadPointeur();
  const result = w.document.getElementById('result'), error = w.document.getElementById('loginError');
  assert.equal(result.getAttribute('role'), 'status'); assert.equal(result.getAttribute('aria-live'), 'polite');
  assert.equal(error.getAttribute('role'), 'alert'); assert.equal(error.getAttribute('aria-live'), 'assertive');
  assert.ok(w.document.getElementById('manualQuery').getAttribute('aria-label'));
  w.close();
});

test('résultats de la recherche manuelle : atteignables et activables au clavier', async () => {
  const app = await boot();
  app.t.toggleManualPanel(); app.t.setManualResults([EMPLOYEE]); app.w.renderManualResults();
  const row = app.d.querySelector('.manual-result-row');
  assert.equal(row.getAttribute('role'), 'button'); assert.equal(row.getAttribute('tabindex'), '0');
  row.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick();
  assert.match(app.d.getElementById('manualCard').textContent, /ADDA/);
  await teardown(app);
});

test('connexion refusée avec un détail non textuel : message lisible, jamais « [object Object] »', async () => {
  const app = loadPointeur({ fetch: async () => ({ ok: false, status: 422, json: async () => ({ detail: [{ loc: ['body', 'username'], msg: 'field required' }] }) }) });
  await tick();
  app.window.document.getElementById('username').value = 'PTG01';
  app.window.document.getElementById('password').value = 'x';
  await app.window.login();
  const text = app.window.document.getElementById('loginError').textContent;
  assert.doesNotMatch(text, /\[object Object\]/);
  assert.match(text, /Connexion refusée/);
  app.window.close();
});

test('collage dans un champ de saisie : jamais traité comme une lecture de badge', async () => {
  const calls = [];
  const app = await boot(async (url) => { calls.push(String(url)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }; });
  calls.length = 0;
  const paste = (target) => {
    const event = new app.w.Event('paste', { bubbles: true, cancelable: true });
    event.clipboardData = { getData: () => 'QR-COLLE-DANS-UN-CHAMP-0123456789' };
    target.dispatchEvent(event);
    return event;
  };
  const field = app.d.getElementById('trackingSearch');
  const inField = paste(field);
  await tick();
  assert.equal(inField.defaultPrevented, false, 'le champ reçoit le texte collé');
  assert.equal(calls.some((url) => url.includes('attendance-qr/scan')), false);
  await teardown(app);
});

test('borne : le verrou d’écran est redemandé au retour au premier plan', () => {
  const kiosk = fs.readFileSync(path.join(STATIC, 'pointeur-borne.js'), 'utf8');
  assert.match(kiosk, /addEventListener\("visibilitychange", keepAwake\)/);
});
