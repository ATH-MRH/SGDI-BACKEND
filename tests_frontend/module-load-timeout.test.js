// LOT VALIDATION PRODUCTION + DURCISSEMENT MODULE LOADER.
//
// Un <script> dynamique dont ni onload ni onerror ne se déclenche jamais (vu
// en conditions réelles sur "Fiche de position" : écran "Chargement du
// module..." bloqué plusieurs minutes, jamais résolu) laissait
// SGDIModules.loadModule() pendu indéfiniment — aucun filet de temps sur ce
// chemin, contrairement à la couche API (sgdiApi, 30s). Ce fichier charge le
// VRAI module-registry.js et vérifie : le timeout (déjà couvert avant ce
// lot), la classification des erreurs par code stable (§10), le nettoyage du
// <script> en échec (§6), et qu'aucun des scénarios listés dans l'incident
// (§11) ne laisse un loader permanent.
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
  return { window: dom.window, SGDI: dom.window.SGDIModules };
}

// Remplace document.createElement("script") par un élément dont on contrôle
// entièrement onload/onerror et l'attachement au DOM, pour simuler chaque
// scénario du réseau sans dépendre d'un vrai serveur.
function stubScriptElement(window, { autoFire } = {}) {
  const originalCreateElement = window.document.createElement.bind(window.document);
  let lastEl = null;
  window.document.createElement = (tag) => {
    const el = originalCreateElement(tag);
    if (tag === 'script') {
      let onloadFn = null, onerrorFn = null;
      Object.defineProperty(el, 'onload', { set(fn) { onloadFn = fn; }, get() { return onloadFn; } });
      Object.defineProperty(el, 'onerror', { set(fn) { onerrorFn = fn; }, get() { return onerrorFn; } });
      el._fireOnload = () => onloadFn && onloadFn();
      el._fireOnerror = () => onerrorFn && onerrorFn();
      lastEl = el;
      if (autoFire) setTimeout(() => autoFire(el), 0);
    }
    return el;
  };
  return { getLast: () => lastEl };
}

test('chargement normal (onload) : résout, code OK, aucun rejet par timeout', async () => {
  const { window, SGDI } = freshSGDI();
  SGDI.MODULE_LOAD_TIMEOUT_MS = 5000;
  stubScriptElement(window, { autoFire: (el) => el._fireOnload() });
  await assert.doesNotReject(SGDI._injectScript('demo-ok'));
});

test('timeout (ni onload ni onerror) : rejette avec MODULE_SCRIPT_TIMEOUT, pas de blocage réel', async () => {
  const { window, SGDI } = freshSGDI();
  SGDI.MODULE_LOAD_TIMEOUT_MS = 20; // raccourci pour un test rapide, même mécanisme qu'en production
  stubScriptElement(window); // ni onload ni onerror ne sera jamais appelé
  const t0 = Date.now();
  await assert.rejects(SGDI._injectScript('jamais'), (err) => {
    assert.equal(err.code, 'MODULE_SCRIPT_TIMEOUT');
    return true;
  });
  assert.ok(Date.now() - t0 < 2000, 'le rejet doit arriver proche du délai raccourci, pas après un vrai blocage');
});

test('un onload tardif (après expiration du timeout) ne provoque plus rien de secondaire', async () => {
  const { window, SGDI } = freshSGDI();
  SGDI.MODULE_LOAD_TIMEOUT_MS = 15;
  const stub = stubScriptElement(window);
  await assert.rejects(SGDI._injectScript('lent'));
  assert.doesNotThrow(() => stub.getLast()._fireOnload());
});

test('échec réseau générique (onerror, sonde HEAD indisponible) : MODULE_SCRIPT_ERROR', async () => {
  const { window, SGDI } = freshSGDI();
  window.fetch = () => Promise.reject(new Error('offline'));
  stubScriptElement(window, { autoFire: (el) => el._fireOnerror() });
  await assert.rejects(SGDI._injectScript('casse'), (err) => {
    assert.equal(err.code, 'MODULE_SCRIPT_ERROR');
    return true;
  });
});

test('404 réel (onerror + sonde HEAD renvoyant 404) : MODULE_SCRIPT_404, distinct d\'une erreur générique', async () => {
  const { window, SGDI } = freshSGDI();
  window.fetch = () => Promise.resolve({ status: 404 });
  stubScriptElement(window, { autoFire: (el) => el._fireOnerror() });
  await assert.rejects(SGDI._injectScript('inexistant'), (err) => {
    assert.equal(err.code, 'MODULE_SCRIPT_404');
    assert.equal(err.httpStatus, 404);
    return true;
  });
});

test('un script en échec (timeout ou onerror) est retiré du DOM — §6, aucun <script> résiduel', async () => {
  const { window, SGDI } = freshSGDI();
  SGDI.MODULE_LOAD_TIMEOUT_MS = 15;
  stubScriptElement(window);
  await assert.rejects(SGDI._injectScript('echec'));
  assert.equal(window.document.querySelectorAll('script').length, 0, 'le <script> en échec ne doit pas traîner dans le DOM');
});

test('script chargé mais qui ne s\'enregistre pas : MODULE_NOT_REGISTERED, jamais de blocage', async () => {
  const { window, SGDI } = freshSGDI();
  // onload se déclenche (le fichier existe et s'exécute) mais n'appelle jamais registerModule.
  stubScriptElement(window, { autoFire: (el) => el._fireOnload() });
  await assert.rejects(SGDI.loadModule('fantome'), (err) => {
    assert.equal(err.code, 'MODULE_NOT_REGISTERED');
    return true;
  });
});

test('init qui jette (synchrone) : MODULE_INIT_ERROR', async () => {
  const { SGDI } = freshSGDI();
  SGDI.registerModule({ key: 'casse-init', routes: [], init() { throw new Error('boom'); } });
  await assert.rejects(SGDI.initModule('casse-init'), (err) => {
    assert.equal(err.code, 'MODULE_INIT_ERROR');
    return true;
  });
});

test('init qui rejette (Promise) : MODULE_INIT_ERROR, module ré-initialisable ensuite', async () => {
  const { SGDI } = freshSGDI();
  let attempt = 0;
  SGDI.registerModule({
    key: 'init-instable', routes: [],
    init() { attempt++; return attempt === 1 ? Promise.reject(new Error('encore raté')) : Promise.resolve(); },
  });
  await assert.rejects(SGDI.initModule('init-instable'), (err) => {
    assert.equal(err.code, 'MODULE_INIT_ERROR');
    return true;
  });
  await assert.doesNotReject(SGDI.initModule('init-instable'), 'un retry après un rejet d\'init doit pouvoir réussir');
});

test('retry après timeout : un seul <script> à la fois, jamais deux tentatives concurrentes qui traînent', async () => {
  const { window, SGDI } = freshSGDI();
  SGDI.MODULE_LOAD_TIMEOUT_MS = 15;
  let call = 0;
  stubScriptElement(window, {
    autoFire: (el) => {
      call++;
      if (call === 1) return; // 1er essai : ni onload ni onerror, simule le timeout
      SGDI.registerModule({ key: 'retry-cible', routes: [], init() {} }); // le vrai fichier s'enregistrerait ici
      el._fireOnload();
    },
  });
  await assert.rejects(SGDI.loadModule('retry-cible')); // 1er essai : timeout
  assert.equal(window.document.querySelectorAll('script').length, 0, 'le script du 1er essai en échec est retiré avant le retry');
  await assert.doesNotReject(SGDI.loadModule('retry-cible')); // 2e essai (Réessayer) : réussit
  assert.equal(window.document.querySelectorAll('script').length, 1, 'un seul <script> après le retry réussi, pas d\'accumulation');
});

test('double navigation pendant un chargement en cours : une seule requête réseau, jamais deux <script> concurrents', async () => {
  const { window, SGDI } = freshSGDI();
  let injectCount = 0;
  stubScriptElement(window, {
    autoFire: (el) => {
      injectCount++;
      SGDI.registerModule({ key: 'partage', routes: [], init() {} });
      el._fireOnload();
    },
  });
  const p1 = SGDI.loadModule('partage');
  const p2 = SGDI.loadModule('partage'); // "second clic" pendant que le premier est encore en vol
  assert.strictEqual(p1, p2, 'la même Promise doit être partagée — jamais un second <script> injecté pour la même clé en vol');
  await p1;
  assert.equal(injectCount, 1, 'un seul <script> réellement injecté malgré les deux appels');
});
