// LOT SÉCURITÉ — AUTO-DÉCONNEXION APRÈS 30 SECONDES D'INACTIVITÉ
// (pointage.irongs.com / pointeur.irongs.com uniquement — les deux domaines
// servent le même app/static/pointeur.html, cf. _is_pointer_host dans
// app/main.py). Ce fichier teste directement les fonctions réelles de la
// page (aucune réimplémentation), en pilotant lastUserActivityAt via les
// hooks de test plutôt que d'attendre 20-30 secondes réelles par cas — la
// fonction testée (idleTick) repose déjà sur un horodatage absolu
// (Date.now() - lastUserActivityAt), donc contrôler ce dernier exerce
// exactement la même logique que le vrai setInterval de production.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPointeur, SESSION_KEY } = require('./load-pointeur');

const SESSION = { token: 'tok-123', user: { username: 'PTG01', full_name: 'Agent Test' } };

async function bootLoggedIn(options = {}) {
  const app = loadPointeur(options);
  const w = app.window, t = app.T();
  // La page restaure elle-même une session depuis localStorage à DOMContentLoaded (async,
  // hors de notre contrôle du moment exact où il se déclenche). On laisse ce tick se
  // dérouler d'abord (localStorage vide ici -> il ne fait rien) avant de fixer nous-mêmes
  // la session : sinon DOMContentLoaded peut écraser silencieusement notre état juste après.
  await new Promise(r => setTimeout(r, 0));
  t.setSession(SESSION);
  await t.enterApp();
  t.clearIdleInterval(); // on pilote idleTick() nous-mêmes ; les écouteurs d'activité restent branchés
  return { app, w, t };
}

// enterApp() démarre aussi l'horloge d'en-tête et le polling 15s (historyRefreshTimer),
// indépendants de la fonctionnalité testée ici : sans ce nettoyage ces setInterval réels
// resteraient actifs après chaque test et empêcheraient la suite de se terminer.
async function teardown(t, w) {
  try { await t.logout(); } catch (e) {}
  w.close();
}

test('A. aucune activité : warning affiché après 20s, logout après 30s', async () => {
  const { w, t } = await bootLoggedIn();
  assert.equal(appVisible(w), true);
  t.setLastActivity(Date.now() - 19000);
  t.idleTick();
  assert.equal(t.getWarningVisible(), false, 'pas encore de warning à 19s');
  t.setLastActivity(Date.now() - 20000);
  t.idleTick();
  assert.equal(t.getWarningVisible(), true, 'warning attendu dès 20s');
  assert.match(w.document.getElementById('idleWarning').textContent, /SESSION INACTIVE/);
  t.setLastActivity(Date.now() - 30000);
  await t.idleTick();
  assert.equal(t.getSession(), null, 'logout attendu à 30s');
  await teardown(t, w);
});
function appVisible(w) { return !w.document.getElementById('appView').classList.contains('hidden'); }

test('B/C. une activité réelle pendant le compte à rebours annule le warning et relance 30s pleines', async () => {
  const { w, t } = await bootLoggedIn();
  t.setLastActivity(Date.now() - 25000);
  t.idleTick();
  assert.equal(t.getWarningVisible(), true);
  // Une vraie frappe clavier : reset complet.
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
  assert.equal(t.getWarningVisible(), false, 'le warning doit disparaître immédiatement');
  const remaining = Date.now() - t.getLastActivity();
  assert.ok(remaining < 1000, 'lastUserActivityAt doit être remis à "maintenant"');
  t.idleTick();
  assert.equal(t.getWarningVisible(), false, 'et ne doit pas réapparaître juste après');
  await teardown(t, w);
});

test('bouton "Rester connecté" est lui-même une activité qui ferme le warning', async () => {
  const { w, t } = await bootLoggedIn();
  t.setLastActivity(Date.now() - 21000);
  t.idleTick();
  assert.equal(t.getWarningVisible(), true);
  w.document.getElementById('idleStayBtn').click();
  assert.equal(t.getWarningVisible(), false);
  await teardown(t, w);
});

test('D. mousemove/pointermove réinitialisent avec un throttle correct (pas à chaque pixel)', async () => {
  const { w, t } = await bootLoggedIn();
  t.setLastActivity(Date.now() - 5000);
  const before = t.getLastActivity();
  w.document.dispatchEvent(new w.Event('mousemove', { bubbles: true }));
  const afterFirst = t.getLastActivity();
  assert.ok(afterFirst > before, 'le premier mousemove doit compter');
  t.setLastActivity(Date.now() - 100); // très récent : dans la fenêtre de throttle (500ms)
  const beforeThrottled = t.getLastActivity();
  w.document.dispatchEvent(new w.Event('mousemove', { bubbles: true }));
  assert.equal(t.getLastActivity(), beforeThrottled, 'un mousemove immédiatement après ne doit pas re-écrire pendant le throttle');
  await teardown(t, w);
});

test('E/F/G. polling API, réponse fetch et horloge (setInterval technique) ne réinitialisent jamais', async () => {
  const { w, t } = await bootLoggedIn({ fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) }) });
  const before = Date.now() - 15000;
  t.setLastActivity(before);
  await w.refreshPointeurData(); // polling applicatif réel (loadHistory/loadAttendanceAlerts/loadShiftStaffing)
  await new Promise(r => setTimeout(r, 20));
  assert.equal(t.getLastActivity(), before, 'un rafraîchissement de données ne doit jamais être traité comme une activité utilisateur');
  w.updateHeaderClock(); // tick d'horloge (setInterval technique)
  assert.equal(t.getLastActivity(), before, 'la mise à jour de l\'horloge ne doit jamais compter');
  await teardown(t, w);
});

test('H. scanner simplement actif (aucune lecture) ne réinitialise pas', async () => {
  const { w, t } = await bootLoggedIn();
  const before = Date.now() - 15000;
  t.setLastActivity(before);
  w.setupScanMode(); // active le mode douchette/caméra sans qu'aucun QR ne soit lu
  assert.equal(t.getLastActivity(), before, 'activer/laisser tourner le scanner ne doit jamais compter comme une activité');
  await teardown(t, w);
});

test('I. un scan réel décodé (badge/QR) réinitialise le timer', async () => {
  const { w, t } = await bootLoggedIn({ fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ employee: { nom: 'X', matricule: 'M1' }, action: 'arrivee', heure: '08:00' }) }) });
  t.setLastActivity(Date.now() - 15000);
  await t.onQr('token-valide');
  const remaining = Date.now() - t.getLastActivity();
  assert.ok(remaining < 1000, 'une lecture QR réellement décodée doit réinitialiser le timer');
  await teardown(t, w);
});

test('J. onglet en arrière-plan plus de 30s : au retour, logout immédiat', async () => {
  const { w, t } = await bootLoggedIn();
  t.setLastActivity(Date.now() - 45000); // simule le temps réellement écoulé en arrière-plan
  w.document.dispatchEvent(new w.Event('visibilitychange')); // événement natif dispatché sur document, pas window
  await new Promise(r => setTimeout(r, 20));
  assert.equal(t.getSession(), null, 'retour sur un onglet resté inactif >30s doit déconnecter immédiatement');
  await teardown(t, w);
});

test('K. veille machine simulée (>30s d\'écart absolu) : logout immédiat au focus', async () => {
  const { w, t } = await bootLoggedIn();
  t.setLastActivity(Date.now() - 5 * 60 * 1000); // 5 minutes de veille simulée
  w.dispatchEvent(new w.Event('focus'));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(t.getSession(), null, 'un long écart absolu doit toujours entraîner un logout, jamais une reprise silencieuse');
  await teardown(t, w);
});

test('le simple retour/focus d\'onglet ne doit PAS, à lui seul, effacer l\'inactivité (pas de reset implicite)', async () => {
  const { w, t } = await bootLoggedIn();
  const before = Date.now() - 25000; // déjà dans la fenêtre de warning, mais pas encore expiré
  t.setLastActivity(before);
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  assert.equal(t.getLastActivity(), before, 'visibilitychange ne doit jamais remettre lastUserActivityAt à "maintenant"');
  assert.equal(t.getWarningVisible(), true, 'le retour doit re-vérifier le temps réel écoulé, pas l\'ignorer');
  await teardown(t, w);
});

test('L/M/N. le logout est idempotent, nettoie la session et revient à l\'écran de connexion', async () => {
  const { w, t } = await bootLoggedIn();
  await Promise.all([t.logout(), t.logout(), t.logout()]);
  assert.equal(t.getSession(), null);
  assert.equal(w.localStorage.getItem(SESSION_KEY), null, 'la session locale doit être supprimée');
  assert.equal(w.document.getElementById('appView').classList.contains('hidden'), true);
  assert.equal(w.document.getElementById('loginView').classList.contains('hidden'), false, 'retour à l\'écran de connexion attendu');
  w.close();
});

test('O. une activité déclenchée juste après le début du logout n\'annule pas le logout en cours', async () => {
  const { w, t } = await bootLoggedIn();
  const pending = t.performIdleLogout();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, key: 'a' })); // "activité" pendant le logout
  await pending;
  assert.equal(t.getSession(), null, 'le logout déjà entamé doit aboutir malgré une activité concurrente');
  w.close();
});

test('aucune reconnexion automatique : après logout, aucune session résiduelle n\'est restaurée', async () => {
  const { w, t } = await bootLoggedIn();
  await t.logout();
  // getSession() doit rester null tant que login()/setSession() n'est pas rappelé.
  assert.equal(t.getSession(), null);
  assert.equal(w.localStorage.getItem(SESSION_KEY), null);
  w.close();
});

test('P/Q. la règle est bien présente et centralisée sur pointeur.html (portée pointage.irongs.com / pointeur.irongs.com)', async () => {
  const { w, t } = await bootLoggedIn({ url: 'https://pointeur.irongs.com/' });
  assert.equal(typeof t.startIdleWatch, 'function');
  assert.equal(t.INACTIVITY_TIMEOUT_MS, 30000);
  assert.equal(t.INACTIVITY_WARNING_MS, 20000);
  await teardown(t, w);
});
