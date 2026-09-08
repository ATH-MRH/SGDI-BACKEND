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

test('routeNeedsModuleLoad : vrai tant que le module déclaré n’est pas enregistré', () => {
  const SGDI = freshSGDI();
  SGDI.MODULE_ROUTES.demo = 'demo';
  assert.strictEqual(SGDI.routeNeedsModuleLoad('demo'), true);
  assert.strictEqual(SGDI.routeNeedsModuleLoad('inconnue'), false);
  SGDI.registerModule({ key: 'demo', routes: ['demo'] });
  assert.strictEqual(SGDI.routeNeedsModuleLoad('demo'), false, 'plus de chargement une fois enregistré');
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
  SGDI.registerModule({ key: 'a', routes: ['a'] });
  SGDI.registerModule({ key: 'b', routes: ['b'] });
  assert.strictEqual(SGDI.moduleRegistrySnapshot().length, 2);
  SGDI._resetModuleRegistry();
  assert.strictEqual(SGDI.moduleRegistrySnapshot().length, 0);
  assert.strictEqual(SGDI.isModuleRegistered('a'), false);
});
