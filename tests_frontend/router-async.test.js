// Phase 2A — le routeur (renderView) prépare un module avant de rendre sa route,
// SANS devenir asynchrone pour ses appelants, avec un vrai cycle de vie
// (load -> init -> render ; destroy au changement de module), et une protection
// des courses de navigation. On charge le VRAI monolithe + le registre.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 4) => { for (let i = 0; i < n; i += 1) await tick(); };

// Harnais routeur : registre vide + N modules fictifs pilotés par un faux
// _injectScript. Chaque module compte ses init/destroy. Le mode 'hold' garde les
// injections en attente (résolution manuelle via r.pending()).
function bootRouter(opts = {}) {
  const ctx = loadSgdiApp(['renderView', 'navigate'], opts);
  assert.ifError(ctx.loadError);
  const { window, T } = ctx;
  T().setSession({ transverse: 'secretariat', username: 'tester', societe: '' });
  // db « tolérant » : toute collection non définie -> [] (les routes fictives
  // modA/modB retombent sur le switch default -> renderDashboard, qui itère des
  // collections ; on ne teste pas son contenu ici, seulement le cycle de vie).
  T().setDb(new Proxy({}, { get: (t, p) => { if (!(p in t)) t[p] = []; return t[p]; } }));
  T().setFullDataReady(true);
  T().setViewMode(true);

  const SGDI = window.SGDIModules;
  if (opts.withoutModules) {
    const view = () => window.document.getElementById('view');
    const go = h => { window.history.replaceState(null, '', h); T().renderView(); };
    return { window, T, view, go };
  }
  assert.ok(SGDI && typeof SGDI.routeNeedsModuleLoad === 'function', 'registre chargé');
  SGDI._resetModuleRegistry(); // load-app.js concatène js/modules/* -> on repart net

  const injectCalls = [];
  const initCounts = Object.create(null);
  const destroyCounts = Object.create(null);
  let pending = [];
  let injectMode = opts.mode || 'resolve'; // 'resolve' | 'hold' | 'reject'
  const initFailFor = new Set(opts.initFailFor || []); // clés dont le 1er init jette

  function makeDef(key) {
    return {
      key,
      routes: [key],
      init() {
        initCounts[key] = (initCounts[key] || 0) + 1;
        if (initFailFor.has(key) && initCounts[key] === 1) throw new Error('init KO (' + key + ')');
      },
      destroy() { destroyCounts[key] = (destroyCounts[key] || 0) + 1; },
    };
  }

  SGDI._injectScript = (key) => {
    injectCalls.push(key);
    if (injectMode === 'reject') return Promise.reject(new Error('script 404 (' + key + ')'));
    if (injectMode === 'resolve') { SGDI.registerModule(makeDef(key)); return Promise.resolve(); }
    return new Promise((res, rej) => {
      pending.push({ key, resolve: () => { SGDI.registerModule(makeDef(key)); res(); }, reject: (e) => rej(e || new Error('script 404')) });
    });
  };

  (opts.routes || ['secretariat']).forEach((k) => { SGDI.MODULE_ROUTES[k] = k; });

  const view = () => window.document.getElementById('view');
  const setHash = (h) => window.history.replaceState(null, '', h); // ne déclenche pas hashchange
  const go = (h) => { setHash(h); T().renderView(); };
  return {
    window, T, SGDI, view, setHash, go, injectCalls, initCounts, destroyCounts,
    pending: () => pending, setInjectMode: (m) => { injectMode = m; },
  };
}

// ── §1 — portillon : chargé ≠ prêt ; retry de init() ────────────────────────

test('routeNeedsModuleLoad distingue LOADED de INITIALIZED', async () => {
  const r = bootRouter({ routes: ['demo'] });
  assert.strictEqual(r.SGDI.routeNeedsModuleLoad('demo'), true, 'absent -> requis');
  r.SGDI.registerModule({ key: 'demo', routes: ['demo'], init() {} });
  assert.strictEqual(r.SGDI.routeNeedsModuleLoad('demo'), true, 'enregistré mais non initialisé -> encore requis');
  await r.SGDI.initModule('demo');
  assert.strictEqual(r.SGDI.routeNeedsModuleLoad('demo'), false, 'chargé + initialisé -> prêt');
  r.SGDI.destroyModule('demo');
  assert.strictEqual(r.SGDI.routeNeedsModuleLoad('demo'), true, 'détruit -> de nouveau requis');
});

test('init échoue -> carte d’erreur -> Réessayer relance init sans re-télécharger', async () => {
  const r = bootRouter({ initFailFor: ['secretariat'] });
  // 1-3 : script OK, init échoue, carte d'erreur
  r.go('#/secretariat/dashboard');
  await flush();
  assert.strictEqual(r.injectCalls.length, 1, 'script téléchargé une fois');
  assert.strictEqual(r.initCounts.secretariat, 1, 'init tenté une fois');
  assert.match(r.view().innerHTML, /Module indisponible/);
  assert.match(r.view().innerHTML, /Réessayer/);
  assert.strictEqual(r.SGDI.routeNeedsModuleLoad('secretariat'), true, 'toujours pas prêt');

  // 4-8 : clic Réessayer -> renderView() ; pas de nouveau script ; init #2 ; succès ; rendu réel
  r.T().renderView();
  await flush();
  assert.strictEqual(r.injectCalls.length, 1, 'aucun nouveau téléchargement');
  assert.strictEqual(r.initCounts.secretariat, 2, 'init relancé une seconde fois');
  assert.doesNotMatch(r.view().innerHTML, /Module indisponible/);
  assert.doesNotMatch(r.view().innerHTML, /Chargement du module/);
  assert.strictEqual(r.SGDI.routeNeedsModuleLoad('secretariat'), false, 'prêt');

  // 9 : 3e navigation -> ni script ni init inutiles
  r.go('#/dashboard');
  r.go('#/secretariat/dashboard');
  await flush();
  assert.strictEqual(r.injectCalls.length, 1);
  // aller sur dashboard a détruit secretariat -> revenir le ré-initialise (init #3), mais pas de re-download
  assert.strictEqual(r.initCounts.secretariat, 3);
  assert.strictEqual(r.destroyCounts.secretariat, 1);
});

// ── §2 — destroy réel au changement de module ──────────────────────────────

test('cycle de vie A -> B -> A -> legacy : init/destroy exacts', async () => {
  const r = bootRouter({ routes: ['modA', 'modB'] });

  r.go('#/modA'); await flush();
  assert.deepStrictEqual([r.initCounts.modA, r.destroyCounts.modA || 0], [1, 0]);
  assert.strictEqual(r.SGDI.activeModuleKey, 'modA');

  r.go('#/modB'); await flush();
  assert.strictEqual(r.destroyCounts.modA, 1, 'quitter A -> destroy(A)');
  assert.strictEqual(r.initCounts.modB, 1, 'entrer B -> init(B)');
  assert.strictEqual(r.SGDI.activeModuleKey, 'modB');

  r.go('#/modA'); await flush();
  assert.strictEqual(r.destroyCounts.modB, 1, 'quitter B -> destroy(B)');
  assert.strictEqual(r.initCounts.modA, 2, 'revenir sur A -> init(A) à nouveau (détruit avant)');
  assert.strictEqual(r.SGDI.activeModuleKey, 'modA');

  r.go('#/dashboard'); await flush();
  assert.strictEqual(r.destroyCounts.modA, 2, 'route legacy -> destroy du module actif');
  assert.strictEqual(r.SGDI.activeModuleKey, null);
});

test('re-render de la MÊME route modulaire : pas de destroy, pas de re-init', async () => {
  const r = bootRouter({ routes: ['modA'] });
  r.go('#/modA'); await flush();
  assert.strictEqual(r.initCounts.modA, 1);

  r.T().renderView(); await flush(); // A -> A (même hash)
  r.setHash('#/modA/sub'); r.T().renderView(); await flush(); // sous-route du même module
  assert.strictEqual(r.initCounts.modA, 1, 'aucun init supplémentaire');
  assert.strictEqual(r.destroyCounts.modA || 0, 0, 'aucun destroy sur re-render du même module');
  assert.strictEqual(r.SGDI.activeModuleKey, 'modA');
});

test('navigation répétée ×3 A<->B : compte exact, aucun résidu', async () => {
  const r = bootRouter({ routes: ['modA', 'modB'] });
  for (let i = 0; i < 3; i += 1) {
    r.go('#/modA'); await flush();
    r.go('#/modB'); await flush();
  }
  r.go('#/dashboard'); await flush();
  assert.strictEqual(r.initCounts.modA, 3);
  assert.strictEqual(r.initCounts.modB, 3);
  assert.strictEqual(r.destroyCounts.modA, 3);
  assert.strictEqual(r.destroyCounts.modB, 3);
  assert.strictEqual(r.injectCalls.filter((k) => k === 'modA').length, 1, 'A téléchargé 1 seule fois');
  assert.strictEqual(r.injectCalls.filter((k) => k === 'modB').length, 1, 'B téléchargé 1 seule fois');
  assert.strictEqual(r.SGDI.activeModuleKey, null);
});

// ── §3 — courses de navigation ─────────────────────────────────────────────

test('A charge, on navigue B, A termine : A n’init ni ne rend', async () => {
  const r = bootRouter({ mode: 'hold', routes: ['modA', 'modB'] });
  r.go('#/modA');
  assert.match(r.view().innerHTML, /Chargement du module/);
  await tick(); // l'injection de A part
  assert.strictEqual(r.injectCalls[0], 'modA');

  r.go('#/modB'); // génération +1
  await tick();

  r.pending().find((p) => p.key === 'modA').resolve(); // A arrive trop tard
  await flush();

  assert.strictEqual(r.initCounts.modA || 0, 0, 'init(A) jamais appelé : navigation obsolète');
  assert.strictEqual(r.SGDI.activeModuleKey, null); // B encore en attente
  assert.doesNotMatch(r.view().innerHTML, /modA/);

  r.pending().find((p) => p.key === 'modB').resolve();
  await flush();
  assert.strictEqual(r.initCounts.modB, 1);
  assert.strictEqual(r.SGDI.activeModuleKey, 'modB');
});

test('A init échoue, on navigue B, résolution tardive de A : B reste affiché', async () => {
  const r = bootRouter({ mode: 'hold', routes: ['modA', 'modB'], initFailFor: ['modA'] });
  r.go('#/modA');
  await tick();
  r.go('#/modB'); // on quitte A avant même la fin de son chargement
  await tick();

  r.pending().find((p) => p.key === 'modA').resolve(); // A charge tard -> .then voit obsolète -> pas d'init
  await flush();
  assert.strictEqual(r.initCounts.modA || 0, 0, 'A obsolète : pas d’init, pas de carte d’erreur qui écrase B');
  assert.doesNotMatch(r.view().innerHTML, /Module indisponible/);

  r.pending().find((p) => p.key === 'modB').resolve();
  await flush();
  assert.strictEqual(r.SGDI.activeModuleKey, 'modB');
  assert.strictEqual(r.initCounts.modB, 1);
});

test('course : une navigation plus récente gagne (vue non remplacée par le module tardif)', async () => {
  const r = bootRouter({ mode: 'hold' });
  r.go('#/secretariat/dashboard');
  assert.match(r.view().innerHTML, /Chargement du module/);
  await tick();
  assert.strictEqual(r.injectCalls.length, 1);

  r.go('#/dashboard');
  const dashHtml = r.view().innerHTML;
  assert.doesNotMatch(dashHtml, /Chargement du module/);

  r.pending()[0].resolve();
  await flush();
  assert.strictEqual(r.view().innerHTML, dashHtml, 'la vue dashboard n’a pas été remplacée');
  assert.strictEqual(r.initCounts.secretariat || 0, 0);
});

// ── portillon : régressions générales ──────────────────────────────────────

test('routes restées dans le monolithe : portillon inerte (aucune injection)', async () => {
  const r = bootRouter();
  for (const hash of ['#/dashboard', '#/rapports', '#/dossiers']) {
    r.go(hash);
    await flush(2);
    assert.doesNotMatch(r.view().innerHTML, /Chargement du module/, hash + ' rendu sans portillon');
  }
  assert.strictEqual(r.injectCalls.length, 0);
  assert.strictEqual(r.SGDI.activeModuleKey, null);
});

test('route inconnue : rendu par défaut, sans portillon', async () => {
  const r = bootRouter();
  r.go('#/route-qui-nexiste-pas');
  await flush(2);
  assert.doesNotMatch(r.view().innerHTML, /Chargement du module/);
  assert.strictEqual(r.injectCalls.length, 0);
});

test('données non prêtes : la porte existante passe avant le portillon de module', async () => {
  const r = bootRouter();
  r.T().setFullDataReady(false);
  r.go('#/secretariat/dashboard');
  await flush(2);
  assert.match(r.view().innerHTML, /Chargement des données/);
  assert.strictEqual(r.injectCalls.length, 0);
});

test('module de route : écran d’attente, chargement unique, puis rendu réel', async () => {
  const r = bootRouter({ mode: 'hold' });
  r.go('#/secretariat/dashboard');
  assert.match(r.view().innerHTML, /Chargement du module/);
  await tick();
  assert.deepStrictEqual(r.injectCalls, ['secretariat']);
  r.pending()[0].resolve();
  await flush();
  assert.doesNotMatch(r.view().innerHTML, /Chargement du module/);
  assert.strictEqual(r.injectCalls.length, 1);
  assert.strictEqual(r.initCounts.secretariat, 1);
  assert.strictEqual(r.SGDI.activeModuleKey, 'secretariat');
});


function deferredInitRouter() {
  const r = bootRouter();
  let calls = 0;
  const pending = [];
  r.SGDI.registerModule({ key: 'secretariat', routes: ['secretariat'],
    init() {
      calls++;
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    destroy() { r.destroyCounts.secretariat = (r.destroyCounts.secretariat || 0) + 1; }
  });
  return Object.assign(r, { initCalls: () => calls, initPending: pending });
}

test('route init async : pas de rendu ni activation avant résolution', async () => {
  const r = deferredInitRouter();
  r.go('#/secretariat');
  await flush();
  assert.strictEqual(r.initCalls(), 1);
  assert.strictEqual(r.SGDI.isModuleInitialized('secretariat'), false);
  assert.strictEqual(r.SGDI.activeModuleKey, null);
  assert.match(r.view().textContent, /Chargement du module/);
  r.initPending[0].resolve();
  await flush();
  assert.strictEqual(r.SGDI.isModuleInitialized('secretariat'), true);
  assert.strictEqual(r.SGDI.activeModuleKey, 'secretariat');
  assert.doesNotMatch(r.view().textContent, /Chargement du module|Module indisponible/);
});

test('route init async rejet : carte contrôlée puis retry réussi', async () => {
  const r = deferredInitRouter();
  r.go('#/secretariat'); await flush();
  r.initPending[0].reject(new Error('async KO'));
  await flush();
  assert.match(r.view().textContent, /Module indisponible.*async KO.*Réessayer/s);
  assert.strictEqual(r.SGDI.activeModuleKey, null);
  assert.strictEqual(r.SGDI.getModule('secretariat').initPromise, null);
  assert.strictEqual(r.SGDI.isModuleInitialized('secretariat'), false);
  r.T().renderView(); await flush();
  assert.strictEqual(r.initCalls(), 2);
  r.initPending[1].resolve(); await flush();
  assert.strictEqual(r.SGDI.activeModuleKey, 'secretariat');
  assert.doesNotMatch(r.view().textContent, /Module indisponible/);
});

test('init A pending -> dashboard : succès tardif nettoyé sans activation ni rendu', async () => {
  const r = deferredInitRouter();
  r.go('#/secretariat'); await flush();
  r.go('#/dashboard'); await flush();
  const html = r.view().innerHTML;
  r.initPending[0].resolve(); await flush();
  assert.strictEqual(r.view().innerHTML, html);
  assert.strictEqual(r.SGDI.activeModuleKey, null);
  assert.strictEqual(r.SGDI.isModuleInitialized('secretariat'), false);
  assert.strictEqual(r.destroyCounts.secretariat, 1);
});

test('init A pending -> dashboard -> A : même init, seul le dernier rendu gagne', async () => {
  const r = deferredInitRouter();
  r.go('#/secretariat'); await flush();
  const first = r.SGDI.getModule('secretariat').initPromise;
  r.go('#/dashboard');
  r.go('#/secretariat');
  r.T().renderView(); // plusieurs abonnés de la même navigation
  await flush();
  assert.strictEqual(r.SGDI.getModule('secretariat').initPromise, first);
  assert.strictEqual(r.initCalls(), 1);
  assert.strictEqual(r.SGDI.activeModuleKey, null);
  r.initPending[0].resolve(); await flush();
  assert.strictEqual(r.initCalls(), 1);
  assert.strictEqual(r.destroyCounts.secretariat || 0, 0);
  assert.strictEqual(r.SGDI.activeModuleKey, 'secretariat');
});

test('init A rejet tardif après dashboard : aucune carte obsolète', async () => {
  const r = deferredInitRouter();
  r.go('#/secretariat'); await flush();
  r.go('#/dashboard'); await flush();
  const html = r.view().innerHTML;
  r.initPending[0].reject(new Error('late KO')); await flush();
  assert.strictEqual(r.view().innerHTML, html);
  assert.strictEqual(r.SGDI.activeModuleKey, null);
  assert.strictEqual(r.SGDI.getModule('secretariat').initPromise, null);
  r.go('#/secretariat'); await flush();
  r.initPending[1].resolve(); await flush();
  assert.strictEqual(r.initCalls(), 2);
  assert.strictEqual(r.SGDI.activeModuleKey, 'secretariat');
});

test('init résolu sans #view : aucune activation, nettoyage', async () => {
  const r = deferredInitRouter();
  r.go('#/secretariat'); await flush();
  r.view().remove();
  r.initPending[0].resolve(); await flush();
  assert.strictEqual(r.SGDI.activeModuleKey, null);
  assert.strictEqual(r.destroyCounts.secretariat, 1);
});

test('destroy jette : destination rendue, diagnostic, retour sans double abonnement', async () => {
  const r = bootRouter();
  const listeners = new Set(), errors = [];
  let inits = 0, destroys = 0;
  r.window.console.error = (...args) => errors.push(args);
  r.SGDI.registerModule({ key: 'secretariat', routes: ['secretariat'],
    init() { inits++; listeners.add(() => {}); assert.strictEqual(listeners.size, 1); },
    destroy() {
      destroys++;
      // Le hook garantit son nettoyage, même si une autre opération échoue.
      try { throw new Error('destroy KO'); } finally { listeners.clear(); }
    }
  });
  r.go('#/secretariat'); await flush();
  assert.doesNotThrow(() => r.go('#/dashboard'));
  await flush();
  assert.strictEqual(r.SGDI.activeModuleKey, null);
  assert.strictEqual(r.SGDI.isModuleInitialized('secretariat'), false);
  assert.strictEqual(listeners.size, 0);
  assert.match(r.view().textContent, /Effectif actif/);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0][1].message, /destroy KO/);
  r.go('#/secretariat'); await flush();
  assert.strictEqual(inits, 2);
  assert.strictEqual(destroys, 1);
  assert.strictEqual(listeners.size, 1);
  assert.strictEqual(r.SGDI.activeModuleKey, 'secretariat');
});

test('registre réellement absent : dashboard fonctionne, Secrétariat contrôlé, reprise possible', async () => {
  const r = bootRouter({ withoutModules: true });
  assert.strictEqual(r.window.SGDIModules, undefined);
  assert.strictEqual(r.window.renderSecretariat, undefined);
  r.go('#/dashboard'); await flush();
  assert.match(r.view().textContent, /Effectif actif/);
  r.go('#/secretariat'); await flush();
  assert.match(r.view().textContent, /Module indisponible/);
  assert.match(r.view().textContent, /Le composant de chargement des modules n'a pas pu être chargé/);
  assert.doesNotMatch(r.view().textContent, /ReferenceError|renderSecretariat| at /);
  assert.strictEqual(r.view().querySelector('button').getAttribute('onclick'), 'location.reload()');
  // Simuler le retour des scripts après rechargement ; rendu local sans réseau.
  const fs = require('fs'), path = require('path');
  const base = path.join(__dirname, '../app/static');
  r.window.eval(fs.readFileSync(path.join(base, 'js/core/module-registry.js'), 'utf8'));
  r.window.SGDIModules._injectScript = key => {
    r.window.renderSecretariat = view => { view.textContent = 'Secrétariat restauré'; };
    r.window.SGDIModules.registerModule({ key });
    return Promise.resolve();
  };
  r.T().renderView(); await flush();
  assert.strictEqual(r.window.SGDIModules.activeModuleKey, 'secretariat');
  assert.match(r.view().textContent, /Secrétariat restauré/);
});
