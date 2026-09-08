// Tests de l'infrastructure Phase 2A : registre + chargeur de modules.
// On charge le VRAI app/static/js/core/module-registry.js dans jsdom et on pilote
// l'injection de script via SGDI._injectScript (surchargé) — aucun réseau.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const REGISTRY_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'module-registry.js'),
  'utf8'
);

function freshSGDI() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'outside-only',
  });
  dom.window.eval(REGISTRY_SRC);
  return dom.window.SGDIModules;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('registerModule exige une clé et est idempotent', () => {
  const SGDI = freshSGDI();
  assert.throws(() => SGDI.registerModule({}), /key/);
  assert.throws(() => SGDI.registerModule(null), /objet/);

  const a = SGDI.registerModule({ key: 'x', routes: ['x'] });
  a.initialized = true;
  const b = SGDI.registerModule({ key: 'x', routes: ['x'], init: () => {} });
  assert.strictEqual(a, b, 'même objet module retourné');
  assert.strictEqual(b.initialized, true, "l'état initialized est conservé");
  assert.strictEqual(SGDI.moduleRegistrySnapshot().length, 1, 'pas de doublon');
});

test('routeNeedsModuleLoad : requiert module CHARGÉ *et* INITIALISÉ', () => {
  const SGDI = freshSGDI();
  SGDI.MODULE_ROUTES.demo = 'demo';
  assert.strictEqual(SGDI.routeNeedsModuleLoad('demo'), true, 'absent -> requis');
  assert.strictEqual(SGDI.routeNeedsModuleLoad('inconnue'), false);
  SGDI.registerModule({ key: 'demo', routes: ['demo'], init() {} });
  assert.strictEqual(SGDI.routeNeedsModuleLoad('demo'), true, 'enregistré mais pas initialisé -> encore requis');
  SGDI.initModule('demo');
  assert.strictEqual(SGDI.routeNeedsModuleLoad('demo'), false, 'chargé + initialisé -> prêt');
  SGDI.destroyModule('demo');
  assert.strictEqual(SGDI.routeNeedsModuleLoad('demo'), true, 'détruit (désinitialisé) -> de nouveau requis');
});

test('deactivateIfChanged / markActiveModule : cycle de vie du module actif', () => {
  const SGDI = freshSGDI();
  let destroyedA = 0;
  let destroyedB = 0;
  SGDI.registerModule({ key: 'a', routes: ['a'], init() {}, destroy() { destroyedA += 1; } });
  SGDI.registerModule({ key: 'b', routes: ['b'], init() {}, destroy() { destroyedB += 1; } });

  // Aucun module actif -> deactivate est un no-op.
  SGDI.deactivateIfChanged('a');
  assert.strictEqual(destroyedA + destroyedB, 0);

  // markActive seulement pour un module initialisé (le routeur appelle initModule avant).
  SGDI.initModule('a');
  SGDI.markActiveModule('a');
  assert.strictEqual(SGDI.activeModuleKey, 'a');

  // Même clé -> pas de destroy.
  SGDI.deactivateIfChanged('a');
  assert.strictEqual(destroyedA, 0);

  // Clé différente -> destroy de l'ancien + activeModuleKey remis à null.
  SGDI.deactivateIfChanged('b');
  assert.strictEqual(destroyedA, 1);
  assert.strictEqual(SGDI.activeModuleKey, null);
  assert.strictEqual(SGDI.isModuleInitialized('a'), false, 'destroy a désinitialisé a');

  // Passage vers une route legacy (nextKey null) -> destroy du module actif.
  SGDI.initModule('b');
  SGDI.markActiveModule('b');
  SGDI.deactivateIfChanged(null);
  assert.strictEqual(destroyedB, 1);
  assert.strictEqual(SGDI.activeModuleKey, null);

  // markActiveModule(null) est un no-op.
  SGDI.markActiveModule(null);
  assert.strictEqual(SGDI.activeModuleKey, null);
});

test('loadModule : succès -> résout, met en cache, n’injecte qu’une fois', async () => {
  const SGDI = freshSGDI();
  SGDI.MODULE_ROUTES.demo = 'demo';
  let injections = 0;
  SGDI._injectScript = (key) => {
    injections += 1;
    SGDI.registerModule({ key, routes: [key], init() {}, destroy() {} });
    return Promise.resolve();
  };
  const mod = await SGDI.loadModule('demo');
  assert.strictEqual(mod.key, 'demo');
  assert.strictEqual(injections, 1);
  await SGDI.loadModule('demo'); // depuis le cache
  assert.strictEqual(injections, 1, 'pas de ré-injection après succès');
});

test('loadModule : deux appels concurrents partagent la même Promise', async () => {
  const SGDI = freshSGDI();
  SGDI.MODULE_ROUTES.demo = 'demo';
  let injections = 0;
  let resolveInject;
  SGDI._injectScript = (key) => {
    injections += 1;
    return new Promise((res) => {
      resolveInject = () => {
        SGDI.registerModule({ key, routes: [key] });
        res();
      };
    });
  };
  const p1 = SGDI.loadModule('demo');
  const p2 = SGDI.loadModule('demo');
  assert.strictEqual(p1, p2, 'même Promise pour un chargement en cours');
  await tick(); // laisse tourner le microtask qui appelle _injectScript
  assert.strictEqual(injections, 1, 'une seule injection pour deux appels concurrents');
  resolveInject();
  await Promise.all([p1, p2]);
});

test('loadModule : script chargé mais non enregistré -> rejet explicite', async () => {
  const SGDI = freshSGDI();
  SGDI.MODULE_ROUTES.demo = 'demo';
  SGDI._injectScript = () => Promise.resolve(); // n'enregistre rien
  await assert.rejects(SGDI.loadModule('demo'), /ne s'est pas enregistré/);
});

test('loadModule : échec d’injection -> état libéré, nouvelle tentative possible', async () => {
  const SGDI = freshSGDI();
  SGDI.MODULE_ROUTES.demo = 'demo';
  let attempt = 0;
  SGDI._injectScript = (key) => {
    attempt += 1;
    if (attempt === 1) return Promise.reject(new Error('404 simulé'));
    SGDI.registerModule({ key, routes: [key] });
    return Promise.resolve();
  };
  await assert.rejects(SGDI.loadModule('demo'), /404 simulé/);
  assert.strictEqual(SGDI.isModuleLoading('demo'), false, 'état de chargement libéré');
  const mod = await SGDI.loadModule('demo'); // retry
  assert.strictEqual(mod.key, 'demo');
  assert.strictEqual(attempt, 2);
});

test('initModule : n’exécute init qu’une fois ; destroyModule sûr même non initialisé', () => {
  const SGDI = freshSGDI();
  let inits = 0;
  let destroys = 0;
  SGDI.registerModule({ key: 'demo', routes: ['demo'], init: () => { inits += 1; }, destroy: () => { destroys += 1; } });

  SGDI.destroyModule('demo'); // non initialisé -> no-op
  assert.strictEqual(destroys, 0);

  SGDI.initModule('demo');
  SGDI.initModule('demo');
  assert.strictEqual(inits, 1, 'init une seule fois');
  assert.strictEqual(SGDI.isModuleInitialized('demo'), true);

  SGDI.destroyModule('demo');
  assert.strictEqual(destroys, 1);
  assert.strictEqual(SGDI.isModuleInitialized('demo'), false);

  SGDI.initModule('demo'); // ré-initialisation contrôlée
  assert.strictEqual(inits, 2);

  assert.throws(() => SGDI.initModule('absent'), /inconnu/);
});

test('initModule : un init qui échoue laisse le module ré-initialisable', () => {
  const SGDI = freshSGDI();
  let calls = 0;
  SGDI.registerModule({
    key: 'demo', routes: ['demo'],
    init: () => { calls += 1; if (calls === 1) throw new Error('init KO'); },
  });
  assert.throws(() => SGDI.initModule('demo'), /init KO/);
  assert.strictEqual(SGDI.isModuleInitialized('demo'), false);
  SGDI.initModule('demo');
  assert.strictEqual(SGDI.isModuleInitialized('demo'), true);
  assert.strictEqual(calls, 2);
});

test('loadAndInitModule : charge puis initialise', async () => {
  const SGDI = freshSGDI();
  SGDI.MODULE_ROUTES.demo = 'demo';
  let inited = false;
  SGDI._injectScript = (key) => {
    SGDI.registerModule({ key, routes: [key], init: () => { inited = true; } });
    return Promise.resolve();
  };
  await SGDI.loadAndInitModule('demo');
  assert.strictEqual(inited, true);
  assert.strictEqual(SGDI.isModuleInitialized('demo'), true);
});

test('dependencies : un module charge ses dépendances avant lui', async () => {
  const SGDI = freshSGDI();
  SGDI.MODULE_ROUTES.parent = 'parent';
  const order = [];
  SGDI._injectScript = (key) => {
    order.push(key);
    if (key === 'parent') SGDI.registerModule({ key, routes: [key], dependencies: ['base'] });
    else SGDI.registerModule({ key, routes: [key] });
    return Promise.resolve();
  };
  await SGDI.loadModule('parent');
  assert.deepStrictEqual(order, ['parent', 'base'], 'parent injecté puis sa dépendance résolue');
  assert.strictEqual(SGDI.isModuleRegistered('base'), true);
});

test('_resetModuleRegistry : remet le registre à zéro', () => {
  const SGDI = freshSGDI();
  SGDI.registerModule({ key: 'a', routes: ['a'], init() {} });
  SGDI.registerModule({ key: 'b', routes: ['b'] });
  SGDI.initModule('a');
  SGDI.markActiveModule('a');
  assert.strictEqual(SGDI.moduleRegistrySnapshot().length, 2);
  SGDI._resetModuleRegistry();
  assert.strictEqual(SGDI.moduleRegistrySnapshot().length, 0);
  assert.strictEqual(SGDI.isModuleRegistered('a'), false);
  assert.strictEqual(SGDI.activeModuleKey, null, 'module actif remis à zéro');
});
