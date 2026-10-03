// pointeur.irongs.com — POSTE DE SÉCURITÉ : écran permanent, AUCUNE déconnexion pour inactivité.
// INACTIVITÉ ≠ LOGOUT ; SESSION SERVEUR INVALIDE (401) / DROITS RETIRÉS (403) = LOGOUT.
// VRAIE page dans jsdom ; le temps est simulé (Date.now de la page), seul le réseau est simulé.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPointeur, SESSION_KEY } = require('./load-pointeur');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const SESSION = { token: 'tok-ptg', user: { username: 'PTG01', full_name: 'Poste sécurité' } };
const EMP = { id: 2258, matricule: 'K162', nom: 'ADDA', prenom: 'IBRAHIM', fonction: 'MAGASINIER', societe: 'DHL FORWARDING',
  site: 'HAMOUL 01 (40K)', photo: '', has_photo: false };
const SUMMARY = { entries_today: 1, exits_today: 0, present_now: 1, absent_today: 0 };
const IDLE = { latest_event_id: 41, events: [], latest_refusal_id: 7, refusals: [], summary: SUMMARY };
const ENTRY = { latest_event_id: 42, latest_refusal_id: 7, refusals: [], summary: SUMMARY,
  events: [{ id: 42, type: 'ENTREE', heure: '11:47:03', date: '2026-10-05', source: 'FACIAL', source_label: 'Reconnaissance faciale',
    terminal: 'TABLETTTE HAMOUL 01', site: 'HAMOUL 01 (40K)', site_id: 12, state: 'PRESENT', employee: EMP }] };

function boot(url = 'https://pointeur.irongs.com/') {
  const calls = [];
  let live = () => ({ status: 200, body: IDLE });
  const fetch = async (raw, opts = {}) => {
    const u = new URL(raw, url);
    calls.push(u.pathname);
    if (u.pathname === '/api/portal/attendance-live') {
      const r = live();
      if (r.network) throw new TypeError('Failed to fetch');
      return { ok: r.status < 400, status: r.status, json: async () => r.body || {} };
    }
    if (u.pathname === '/api/portal/attendance-sites') return { ok: true, status: 200, json: async () => [{ id: 12, name: 'HAMOUL 01 (40K)' }] };
    return { ok: true, status: 200, json: async () => ([]) };
  };
  const ctx = loadPointeur({ session: SESSION, fetch, url });
  const w = ctx.window;
  // Horloge simulée : idleTick repose sur Date.now() (horodatage absolu).
  const base = Date.now(); let offset = 0;
  w.Date.now = () => base + offset;
  const T = ctx.T;
  return {
    ...ctx, w, T, calls,
    setLive: (fn) => { live = fn; },
    advance: (ms) => {                                           // longue inactivité : aucun geste humain
      offset += ms;
      T().idleTick();
      w.document.dispatchEvent(new w.Event('visibilitychange'));
      w.dispatchEvent(new w.Event('focus'));
      w.dispatchEvent(new w.Event('pageshow'));
    },
    connected: () => !!T().getSession() && !w.document.getElementById('appView').classList.contains('hidden'),
    card: () => w.document.getElementById('lastScanCard'),
    liveCalls: () => calls.filter((p) => p === '/api/portal/attendance-live').length,
  };
}
const opened = [];
test.afterEach(() => { while (opened.length) { const t = opened.pop(); try { t.T().stopLivePolling(); t.T().stopIdleWatch(); t.w.close(); } catch (e) { /* fermée */ } } });
async function ready(t) {
  opened.push(t);
  await tick(80);
  t.T().stopLivePolling();                                       // le test pilote la relève
  assert.equal(t.connected(), true);
}

test('poste de sécurité : aucune surveillance d\'inactivité armée (pas de timer, pas d\'avertissement)', async () => {
  const t = boot();
  await ready(t);
  assert.equal(t.T().IDLE_LOGOUT_ENABLED, false);
  assert.equal(t.T().getIdleTimer(), null, 'aucun setInterval d\'inactivité');
  assert.equal(t.w.document.getElementById('idleWarning'), null);
});

test('30 s, 5 min, 30 min, plusieurs heures et jours simulés sans geste : toujours connecté, aucun avertissement', async () => {
  const t = boot();
  await ready(t);
  for (const [label, ms] of [['30 s', 30e3], ['5 min', 270e3], ['30 min', 25 * 60e3], ['6 h', 5.5 * 3600e3], ['3 jours', 66 * 3600e3]]) {
    t.advance(ms);
    await tick(5);
    assert.equal(t.connected(), true, `connecté après ${label}`);
    assert.equal(t.T().getWarningVisible(), false, `aucun avertissement après ${label}`);
    assert.equal(t.w.localStorage.getItem(SESSION_KEY) !== null, true);
  }
});

test('TEST PRINCIPAL : après une longue inactivité, un nouveau pointage s\'affiche automatiquement', async () => {
  const t = boot();
  await ready(t);
  await t.T().pollLive();                                        // curseur initial
  t.advance(3 * 3600e3 + 47 * 60e3);                             // 08:00 → 11:47 sans interaction
  t.setLive(() => ({ status: 200, body: ENTRY }));
  await t.T().pollLive();
  await tick(20);
  assert.equal(t.connected(), true);
  assert.ok(t.card().classList.contains('is-entry'), t.card().className);
  assert.match(t.card().textContent, /ADDA/);
  assert.match(t.card().textContent, /K162/);
  assert.match(t.card().textContent, /ENTRÉE ENREGISTRÉE/);
  assert.match(t.card().textContent, /PRÉSENT/);
});

test('la relève attendance-live n\'est pas une activité utilisateur (aucun geste simulé)', async () => {
  const t = boot();
  await ready(t);
  let synthetic = 0;
  for (const name of ['mousemove', 'pointermove', 'mousedown', 'pointerdown', 'keydown', 'click', 'touchstart', 'scroll']) {
    t.w.document.addEventListener(name, () => synthetic++, true);
  }
  for (let i = 0; i < 5; i++) await t.T().pollLive();
  assert.equal(synthetic, 0);
});

test('après longue inactivité : Déconnexion volontaire ferme la session et arrête la relève', async () => {
  const t = boot();
  await ready(t);
  t.T().startLivePolling();
  t.advance(8 * 3600e3);
  assert.equal(t.connected(), true);
  t.w.document.querySelector('button.logout').click();
  await tick(30);
  assert.equal(t.T().getSession(), null);
  assert.equal(t.w.localStorage.getItem(SESSION_KEY), null);
  assert.equal(t.w.document.getElementById('loginView').classList.contains('hidden'), false);
  assert.equal(t.T().getLive().liveTimer, null, 'relève arrêtée');
  const before = t.liveCalls();
  await t.T().pollLive();
  assert.equal(t.liveCalls(), before, 'aucune relève après déconnexion');
});

for (const [status, label] of [[401, 'session expirée / invalide / compte désactivé'], [403, 'droits ou site retirés']]) {
  test(`après longue inactivité : ${status} (${label}) ⇒ retour à la connexion`, async () => {
    const t = boot();
    await ready(t);
    t.advance(5 * 3600e3);
    assert.equal(t.connected(), true);
    t.setLive(() => ({ status, body: { detail: label } }));
    await t.T().pollLive();
    await tick(30);
    assert.equal(t.T().getSession(), null);
    assert.equal(t.w.localStorage.getItem(SESSION_KEY), null);
    assert.equal(t.w.document.getElementById('loginView').classList.contains('hidden'), false);
  });
}

test('perte réseau : pas de déconnexion ; « Hors ligne » ; reprise et affichage au retour du réseau', async () => {
  const t = boot();
  await ready(t);
  await t.T().pollLive();
  t.setLive(() => ({ network: true }));
  Object.defineProperty(t.w.navigator, 'onLine', { configurable: true, get: () => false });
  t.w.dispatchEvent(new t.w.Event('offline'));
  for (let i = 0; i < 3; i++) { t.advance(10 * 60e3); await t.T().pollLive(); }
  assert.equal(t.connected(), true, 'une coupure réseau n\'est pas une inactivité');
  assert.equal(t.w.document.getElementById('connLabel').textContent, 'Hors ligne');
  Object.defineProperty(t.w.navigator, 'onLine', { configurable: true, get: () => true });
  t.w.dispatchEvent(new t.w.Event('online'));
  t.setLive(() => ({ status: 200, body: ENTRY }));
  await t.T().pollLive();
  await tick(20);
  assert.equal(t.w.document.getElementById('connLabel').textContent, 'En ligne');
  assert.ok(t.card().classList.contains('is-entry'));
});

test('non-régression : hors poste de sécurité (pointage.irongs.com/pointeur), la règle des 30 s reste active', async () => {
  const t = boot('https://pointage.irongs.com/pointeur');
  await ready(t);
  assert.equal(t.T().IDLE_LOGOUT_ENABLED, true);
  assert.notEqual(t.T().getIdleTimer(), null);
  t.advance(30e3);
  await tick(30);
  assert.equal(t.T().getSession(), null, 'logout après 30 s d\'inactivité, comme avant');
});
