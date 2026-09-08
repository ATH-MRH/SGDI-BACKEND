// Phase 2A — le routeur (renderView) sait charger un module avant de rendre sa
// route, SANS devenir asynchrone pour ses appelants et SANS régression sur les
// routes restées dans le monolithe. On charge le VRAI monolithe + le registre.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 4) => { for (let i = 0; i < n; i += 1) await tick(); };

function bootRouter() {
  const ctx = loadSgdiApp(['renderView', 'navigate', 'render']);
  assert.ifError(ctx.loadError);
  const { window, T } = ctx;
  // Session « secrétariat » : son transverse autorise la route /secretariat.
  T().setSession({ transverse: 'secretariat', username: 'tester', societe: '' });
  T().setDb({});
  T().setFullDataReady(true);
  T().setViewMode(true); // évite la garde de saisie sur navigate()

  const SGDI = window.SGDIModules;
  assert.ok(SGDI && typeof SGDI.routeNeedsModuleLoad === 'function', 'registre chargé');

  const injectCalls = [];
  let pending = [];
  let injectMode = 'hold'; // 'hold' | 'resolve' | 'reject'
  SGDI._injectScript = (key) => {
    injectCalls.push(key);
    if (injectMode === 'reject') return Promise.reject(new Error('script 404 simulé'));
    if (injectMode === 'resolve') {
      SGDI.registerModule({ key, routes: [key], init() {}, destroy() {} });
      return Promise.resolve();
    }
    return new Promise((res, rej) => {
      pending.push({
        key,
        resolve: () => { SGDI.registerModule({ key, routes: [key], init() {}, destroy() {} }); res(); },
        reject: (e) => rej(e || new Error('script 404 simulé')),
      });
    });
  };
  // Déclare que la route /secretariat appartient à un module (non enregistré ici).
  SGDI.MODULE_ROUTES.secretariat = 'secretariat';

  const view = () => window.document.getElementById('view');
  const setHash = (h) => window.history.replaceState(null, '', h); // ne déclenche pas hashchange
  return { window, T, SGDI, view, setHash, injectCalls, pending: () => pending, setInjectMode: (m) => { injectMode = m; }, resetPending: () => { pending = []; } };
}

test('route de module : écran d’attente, chargement unique, puis rendu réel', async () => {
  const r = bootRouter();
  r.setHash('#/secretariat/dashboard');
  r.T().renderView();

  assert.match(r.view().innerHTML, /Chargement du module/, 'écran d’attente affiché');
  await tick(); // l'appel à _injectScript est différé d'un microtask (Promise.resolve().then)
  assert.deepStrictEqual(r.injectCalls, ['secretariat'], 'une seule injection demandée');

  r.pending()[0].resolve();
  await flush();

  assert.doesNotMatch(r.view().innerHTML, /Chargement du module/, 'le module a rendu sa vue');
  assert.strictEqual(r.injectCalls.length, 1, 'pas de ré-injection');
});

test('course : une navigation plus récente gagne, le module tardif n’écrase pas', async () => {
  const r = bootRouter();
  r.setHash('#/secretariat/dashboard');
  r.T().renderView(); // génération N, injection en attente
  assert.match(r.view().innerHTML, /Chargement du module/);
  await tick(); // laisse partir l'injection (encore non résolue)
  assert.strictEqual(r.injectCalls.length, 1);

  r.setHash('#/dashboard');
  r.T().renderView(); // génération N+1, rend le dashboard
  const dashHtml = r.view().innerHTML;
  assert.doesNotMatch(dashHtml, /Chargement du module/);

  r.pending()[0].resolve(); // le secrétariat arrive trop tard
  await flush();

  assert.strictEqual(r.view().innerHTML, dashHtml, 'la vue dashboard n’a pas été remplacée');
  assert.strictEqual(r.injectCalls.length, 1);
});

test('ouvertures répétées : chargé une seule fois, puis chemin synchrone', async () => {
  const r = bootRouter();
  for (let i = 0; i < 3; i += 1) {
    r.setHash('#/secretariat/dashboard');
    r.T().renderView();
    if (i === 0) {
      assert.match(r.view().innerHTML, /Chargement du module/);
      await tick(); // l'injection part au microtask suivant
      r.pending()[0].resolve();
      await flush();
    }
    assert.doesNotMatch(r.view().innerHTML, /Chargement du module/);
    r.setHash('#/dashboard');
    r.T().renderView();
  }
  assert.strictEqual(r.injectCalls.length, 1, 'un seul chargement pour 3 ouvertures');
});

test('échec de chargement : message + réessai possible', async () => {
  const r = bootRouter();
  r.setInjectMode('reject');
  r.setHash('#/secretariat/dashboard');
  r.T().renderView();
  await flush();
  assert.match(r.view().innerHTML, /Module indisponible/);
  assert.match(r.view().innerHTML, /Réessayer/);

  r.setInjectMode('resolve');
  r.T().renderView(); // le bouton Réessayer rappelle renderView()
  await flush();
  assert.doesNotMatch(r.view().innerHTML, /Module indisponible/);
  assert.doesNotMatch(r.view().innerHTML, /Chargement du module/);
  assert.strictEqual(r.injectCalls.length, 2, 'une tentative échouée + une réussie');
});

test('routes restées dans le monolithe : le portillon est inerte (aucune injection)', async () => {
  const r = bootRouter();
  for (const hash of ['#/dashboard', '#/incidents/dashboard', '#/agenda/dashboard']) {
    r.setHash(hash);
    r.T().renderView();
    await flush(2);
    assert.doesNotMatch(r.view().innerHTML, /Chargement du module/, hash + ' rendu sans portillon');
  }
  assert.strictEqual(r.injectCalls.length, 0, 'aucune route monolithe ne déclenche de chargement');
});

test('route inconnue : rendu par défaut, sans portillon', async () => {
  const r = bootRouter();
  r.setHash('#/route-qui-nexiste-pas');
  r.T().renderView();
  await flush(2);
  assert.doesNotMatch(r.view().innerHTML, /Chargement du module/);
  assert.strictEqual(r.injectCalls.length, 0);
});

test('données non prêtes : la porte existante passe avant le portillon de module', async () => {
  const r = bootRouter();
  r.T().setFullDataReady(false);
  r.setHash('#/secretariat/dashboard');
  r.T().renderView();
  await flush(2);
  assert.match(r.view().innerHTML, /Chargement des données/, 'porte « données non prêtes » prioritaire');
  assert.strictEqual(r.injectCalls.length, 0, 'aucun module chargé tant que les données ne sont pas prêtes');
});
