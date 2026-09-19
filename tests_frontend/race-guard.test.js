// LOT REFACTOR V1 — R1 : session/navigation race foundation.
//
// Deux compteurs monotones (sgdiSessionGeneration nouveau, sgdiViewRenderGeneration déjà
// existant et réutilisé tel quel) + deux primitives centrales (sgdiCaptureRaceContext /
// sgdiRaceContextStillValid), appliquées au cas concret déjà documenté DATA-RACE-1
// (syncOpsMovementsFromPostgres) et aux 3 guards inline précédemment dupliqués à la main
// (module loader, panneau timeline 360, panneau situation).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(t) {
  const r = loadSgdiApp(['sgdiCaptureRaceContext', 'sgdiRaceContextStillValid', 'syncOpsMovementsFromPostgres'], { lazyModules: true });
  assert.ifError(r.loadError);
  const w = r.window;
  t.after(() => w.close());
  await new Promise(resolve => setImmediate(resolve));
  w.console.warn = () => {};
  r.T().setDb({ opsMouvements: [], agents: [], sites: [], settings: {} });
  r.T().setSession({ username: 'perf', role: 'admin', societe: 'IRON', transverse: 'ops' });
  w.sessionStorage.setItem('sgdi_api_token_v1', 'token-A');
  return { w, T: r.T, db: () => w.eval('db') };
}

test('sgdiCaptureRaceContext / sgdiRaceContextStillValid : sémantique de base', async t => {
  const { T } = await fixture(t);
  const ctx = T().sgdiCaptureRaceContext();
  assert.equal(T().sgdiRaceContextStillValid(ctx), true, 'valide juste après capture');
  T().bumpSessionGeneration();
  assert.equal(T().sgdiRaceContextStillValid(ctx), false, 'invalide après un changement de session');
  const ctx2 = T().sgdiCaptureRaceContext();
  T().bumpRenderGeneration();
  assert.equal(T().sgdiRaceContextStillValid(ctx2), false, 'invalide après une navigation (par défaut)');
  const ctx3 = T().sgdiCaptureRaceContext({ navigation: false });
  T().bumpRenderGeneration();
  assert.equal(T().sgdiRaceContextStillValid(ctx3), true, 'navigation ignorée si navigation:false a été demandé');
  T().bumpSessionGeneration();
  assert.equal(T().sgdiRaceContextStillValid(ctx3), false, 'la session reste vérifiée même avec navigation:false');
  assert.equal(T().sgdiRaceContextStillValid(null), false, 'un contexte absent est toujours invalide');
});

test('login() puis logout() incrémentent la génération de session', async t => {
  const r = loadSgdiApp([], { lazyModules: true });
  assert.ifError(r.loadError);
  const w = r.window;
  t.after(() => w.close());
  await new Promise(resolve => setImmediate(resolve));
  w.console.warn = () => {}; w.toast = () => {};
  w.SGDI_API.auth.login = async () => ({ user: { username: 'a', role: 'admin' } });
  w.sgdiRefreshSessionFromServer = async () => {};
  w.sgdiPullState = async () => null;
  w.route = () => {};
  const before = r.T().getSessionGeneration();
  await w.login('a', 'pw');
  assert.ok(r.T().getSessionGeneration() > before, 'login doit incrémenter la génération de session');
  const afterLogin = r.T().getSessionGeneration();
  w.saveSession = () => {};
  w.logout();
  assert.ok(r.T().getSessionGeneration() > afterLogin, 'logout doit incrémenter la génération de session');
});

test('DATA-RACE-1 : une réponse mouvements OPS résolue après un changement de session n\'écrit plus dans db', async t => {
  const { w, T, db } = await fixture(t);
  const pending = deferred();
  w.SGDI_API.movements = { list: async () => pending.promise };
  const call = T().syncOpsMovementsFromPostgres();
  // Pendant que la requête est en vol : déconnexion + reconnexion sous une autre identité,
  // exactement le scénario documenté dans DATA-1 (§7 de la revue).
  T().bumpSessionGeneration();
  pending.resolve([{ id: 1, movement_number: 'OM-STALE', employee_id: 1, society: 'IRON' }]);
  const changed = await call;
  assert.equal(changed, false, 'la fonction doit signaler qu\'elle n\'a rien appliqué');
  assert.deepEqual(db().opsMouvements, [], 'la réponse de l\'ancienne session ne doit jamais atteindre db.opsMouvements');
});

test('sans changement de session, la synchronisation mouvements OPS fonctionne normalement (aucune régression)', async t => {
  const { w, T, db } = await fixture(t);
  w.SGDI_API.movements = { list: async () => [{ id: 1, movement_number: 'OM-0001', employee_id: 1, society: 'IRON' }] };
  const changed = await T().syncOpsMovementsFromPostgres();
  assert.equal(changed, true);
  assert.equal(db().opsMouvements.length, 1);
  assert.equal(db().opsMouvements[0].ordreMouvementNumero, 'OM-0001');
});

test('§2 : un login qui redirige vers Administration système incrémente deux fois — documenté, pas une incohérence', async t => {
  const r = loadSgdiApp([], { lazyModules: true });
  assert.ifError(r.loadError);
  const w = r.window;
  t.after(() => w.close());
  await new Promise(resolve => setImmediate(resolve));
  w.console.warn = () => {}; w.toast = () => {}; w.route = () => {}; w.saveSession = () => {};
  w.showDailyValidationCodeIfNeeded = () => {};
  w.openAdminSystemAccess = () => {};
  w.SGDI_API.auth.login = async () => ({ user: { username: 'ADMIN', role: 'admin', access_level: 'H5' } });
  w.SGDI_API.auth.adminSystemLogin = async () => ({ user: { username: 'ADMIN', role: 'admin', access_level: 'H5' } });
  w.sgdiPullState = async () => true; // startAdminSystemSession() réussit
  const before = r.T().getSessionGeneration();
  await w.login('ADMIN', 'pw');
  // login() bump une fois (identité "ADMIN" établie), PUIS startAdminSystemSession() bump une
  // seconde fois (même identité, mais ré-établie explicitement pour l'espace admin système) —
  // +2 est monotone et sans risque : tout contexte capturé avant login() est invalidé par les
  // DEUX bumps, ce qui est le seul invariant qui compte pour R1.
  assert.equal(r.T().getSessionGeneration(), before + 2, '+2 documenté pour ce chemin précis, pas un bug');
});

test('§3 : un login échoué (identifiants invalides) n\'incrémente PAS la génération de session', async t => {
  const r = loadSgdiApp([], { lazyModules: true });
  assert.ifError(r.loadError);
  const w = r.window;
  t.after(() => w.close());
  await new Promise(resolve => setImmediate(resolve));
  w.console.warn = () => {}; w.toast = () => {};
  w.SGDI_API.auth.login = async () => { throw new Error('Identifiants invalides'); };
  const before = r.T().getSessionGeneration();
  await w.login('x', 'mauvais-mdp');
  assert.equal(r.T().getSessionGeneration(), before, 'un login échoué ne doit jamais invalider les tâches de la session actuelle déjà active');
});

test('§4 : reconnexion sous le MÊME nom d\'utilisateur (RH01) avec un nouveau token : la réponse liée à l\'ancien token est rejetée', async t => {
  const { w, T, db } = await fixture(t);
  T().setSession({ username: 'RH01', role: 'admin', societe: 'IRON' });
  const pending = deferred();
  w.SGDI_API.movements = { list: async () => pending.promise };
  const call = T().syncOpsMovementsFromPostgres();
  w.route = () => {}; w.toast = () => {}; w.saveSession = () => {};
  w.logout(); // même utilisateur va se reconnecter juste après — le nom seul ne doit pas suffire
  w.sessionStorage.setItem('sgdi_api_token_v1', 'token-B');
  T().setSession({ username: 'RH01', role: 'admin', societe: 'IRON' });
  pending.resolve([{ id: 9, movement_number: 'OM-DEPUIS-TOKEN-A', employee_id: 1, society: 'IRON' }]);
  const changed = await call;
  assert.equal(changed, false);
  assert.deepEqual(db().opsMouvements, [], 'même nom d\'utilisateur ne suffit pas à valider une réponse liée à l\'ancien token');
});

test('§6 (le plus important) : A démarre une requête -> logout A -> login B (société différente) -> réponse A résout -> db de B reste intact', async t => {
  const { w, T, db } = await fixture(t);
  T().setSession({ username: 'USER-A', role: 'admin', societe: 'SOCIETE-A' });
  const pending = deferred();
  w.SGDI_API.movements = { list: async () => pending.promise };
  const call = T().syncOpsMovementsFromPostgres();
  w.route = () => {}; w.toast = () => {}; w.saveSession = () => {};
  w.logout();
  T().setSession({ username: 'USER-B', role: 'admin', societe: 'SOCIETE-B' });
  T().bumpSessionGeneration(); // équivaut à la connexion réelle de B (login() ferait ce même bump)
  db().opsMouvements = [{ id: 100, ordreMouvementNumero: 'OM-DE-B', societe: 'SOCIETE-B' }]; // état légitime déjà en place pour B
  pending.resolve([{ id: 1, movement_number: 'OM-DE-A-NE-DOIT-JAMAIS-APPARAITRE', employee_id: 1, society: 'SOCIETE-A' }]);
  const changed = await call;
  assert.equal(changed, false);
  assert.deepEqual(db().opsMouvements, [{ id: 100, ordreMouvementNumero: 'OM-DE-B', societe: 'SOCIETE-B' }], 'db de B doit rester EXACTEMENT ce qu\'il était, aucune trace de A');
});

test('§1 : sgdiHandleAuthFailure (401/token invalide) incrémente la génération de session — trouvé et corrigé pendant la revue R1', async t => {
  const r = loadSgdiApp([], { lazyModules: true });
  assert.ifError(r.loadError);
  const w = r.window;
  t.after(() => w.close());
  await new Promise(resolve => setImmediate(resolve));
  w.toast = () => {}; w.route = () => {}; w.saveSession = () => {};
  const before = r.T().getSessionGeneration();
  w.sgdiHandleAuthFailure('Session expirée');
  assert.ok(r.T().getSessionGeneration() > before, 'une expiration de token doit invalider les tâches en vol exactement comme logout()');
});

test('§1 : retryPostgresLoad() échoué incrémente la génération de session — trouvé et corrigé pendant la revue R1', async t => {
  const r = loadSgdiApp([], { lazyModules: true });
  assert.ifError(r.loadError);
  const w = r.window;
  t.after(() => w.close());
  await new Promise(resolve => setImmediate(resolve));
  w.toast = () => {}; w.saveSession = () => {}; w.renderLogin = () => {}; w.renderPostgresRequired = () => {};
  w.sgdiPullState = async () => null; // échec du rechargement
  const before = r.T().getSessionGeneration();
  await w.retryPostgresLoad();
  assert.ok(r.T().getSessionGeneration() > before, 'un rechargement PostgreSQL échoué qui force une session expirée doit lui aussi invalider les tâches en vol');
});

test('§8 : navigation:false protège uniquement la session — un changement de route pendant la même session laisse la mise à jour passer', async t => {
  const { T } = await fixture(t);
  const ctx = T().sgdiCaptureRaceContext({ navigation: false });
  T().bumpRenderGeneration(); // navigation vers un autre écran, MÊME session
  assert.equal(T().sgdiRaceContextStillValid(ctx), true, 'un simple changement de route ne doit pas invalider une tâche session-only comme syncOpsMovementsFromPostgres');
});

test('§9 : contexte malformé (champs manquants) -> refus sûr, jamais d\'exception', async t => {
  const { T } = await fixture(t);
  assert.equal(T().sgdiRaceContextStillValid(undefined), false);
  assert.equal(T().sgdiRaceContextStillValid({}), false, 'sessionGen absent doit être traité comme invalide, pas comme "correspond par coïncidence à undefined"');
  assert.doesNotThrow(() => T().sgdiRaceContextStillValid('pas-un-objet'));
  assert.doesNotThrow(() => T().sgdiRaceContextStillValid(42));
});

test('§13 : module en chargement -> logout/login sous un autre compte SANS changer de route -> le module ne doit jamais se rendre dans la nouvelle session', async t => {
  // Le guard historique (génération de navigation + hash) ne changeait PAS dans ce scénario
  // précis (même route affichée avant/après la reconnexion) — c'est exactement le trou que R1
  // comble en ajoutant la génération de session au même contexte.
  const { T } = await fixture(t);
  const moduleCtx = T().sgdiCaptureRaceContext(); // capturé au moment où "Chargement du module…" s'affiche
  T().bumpSessionGeneration(); // logout + login sous un autre compte, MÊME route affichée
  assert.equal(T().sgdiRaceContextStillValid(moduleCtx), false, 'un module en cours de chargement pour l\'ancienne session ne doit jamais se rendre après un changement de compte, même sans changement de route');
});

test('navigation A -> B pendant une requête en vol : le rendu de B reste intact (guard déjà existant, réutilisé)', async t => {
  const r = loadSgdiApp(['sgdiCaptureRaceContext', 'sgdiRaceContextStillValid'], { lazyModules: true });
  assert.ifError(r.loadError);
  const w = r.window;
  t.after(() => w.close());
  await new Promise(resolve => setImmediate(resolve));
  const T = r.T();
  const ctxA = T.sgdiCaptureRaceContext();
  T.bumpRenderGeneration(); // navigation vers B
  // Simule ce que fait chaque appelant réel (module loader / panneaux 360) : ne rien
  // appliquer au DOM si le contexte capturé pour A n'est plus le contexte courant.
  let domTouchedByStaleA = false;
  if (T.sgdiRaceContextStillValid(ctxA)) domTouchedByStaleA = true;
  assert.equal(domTouchedByStaleA, false, 'une réponse tardive de A ne doit jamais toucher le DOM de B');
});
