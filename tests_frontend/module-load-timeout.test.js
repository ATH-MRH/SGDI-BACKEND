// Un <script> dynamique dont ni onload ni onerror ne se déclenche jamais (vu en
// conditions réelles sur "Fiche de position" : écran "Chargement du module..."
// bloqué plusieurs minutes, jamais résolu) laissait SGDIModules.loadModule()
// pendu indéfiniment — aucun filet de temps sur ce chemin, contrairement à la
// couche API (sgdiApi, 30s). Ce fichier charge le VRAI module-registry.js et
// vérifie le comportement réel de _injectScript, en simulant précisément ce
// cas : un <script> injecté dont les deux gestionnaires restent silencieux.
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

test('_injectScript rejette après le délai si ni onload ni onerror ne se déclenche jamais', async () => {
  const { window, SGDI } = freshSGDI();
  SGDI.MODULE_LOAD_TIMEOUT_MS = 20; // raccourci pour un test rapide, même mécanisme qu'en production

  // Simule le cas réel observé : le <script> est bien créé et ajouté au DOM,
  // mais son chargement ne se conclut jamais (ni succès ni échec réseau).
  const originalCreateElement = window.document.createElement.bind(window.document);
  window.document.createElement = (tag) => {
    const el = originalCreateElement(tag);
    if (tag === 'script') {
      Object.defineProperty(el, 'onload', { set() {}, get() { return null; } });
      Object.defineProperty(el, 'onerror', { set() {}, get() { return null; } });
    }
    return el;
  };

  const t0 = Date.now();
  await assert.rejects(
    SGDI._injectScript('module-qui-ne-repond-jamais'),
    /[Dd].lai de chargement d.pass./,
    'doit rejeter avec un message clair après le délai, pas rester pendu'
  );
  assert.ok(Date.now() - t0 < 2000, 'le rejet doit arriver proche du délai raccourci, pas après un vrai blocage');
});

test('un onload tardif (après expiration) ne provoque plus jamais de résolution/erreur secondaire', async () => {
  const { window, SGDI } = freshSGDI();
  SGDI.MODULE_LOAD_TIMEOUT_MS = 15;
  let capturedOnload = null;
  const originalCreateElement = window.document.createElement.bind(window.document);
  window.document.createElement = (tag) => {
    const el = originalCreateElement(tag);
    if (tag === 'script') {
      Object.defineProperty(el, 'onload', {
        set(fn) { capturedOnload = fn; },
        get() { return capturedOnload; },
      });
      Object.defineProperty(el, 'onerror', { set() {}, get() { return null; } });
    }
    return el;
  };

  await assert.rejects(SGDI._injectScript('lent'));
  // Le script "arrive" enfin, bien après le rejet déjà envoyé — ne doit rien casser.
  assert.doesNotThrow(() => { if (typeof capturedOnload === 'function') capturedOnload(); });
});

test('un onload normal et rapide résout toujours avant le délai, comme avant ce correctif', async () => {
  const { window, SGDI } = freshSGDI();
  SGDI.MODULE_LOAD_TIMEOUT_MS = 5000; // large : ne doit jamais se déclencher dans ce test
  const originalCreateElement = window.document.createElement.bind(window.document);
  window.document.createElement = (tag) => {
    const el = originalCreateElement(tag);
    if (tag === 'script') {
      let onloadFn = null;
      Object.defineProperty(el, 'onload', { set(fn) { onloadFn = fn; }, get() { return onloadFn; } });
      Object.defineProperty(el, 'onerror', { set() {}, get() { return null; } });
      // Simule un chargement réussi immédiat, comme le cas normal en production.
      setTimeout(() => { if (onloadFn) onloadFn(); }, 0);
    }
    return el;
  };
  await assert.doesNotReject(SGDI._injectScript('demo-ok'));
});
