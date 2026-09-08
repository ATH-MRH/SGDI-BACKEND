// Phase 2A — module pilote SECRÉTARIAT extrait de sgdi-app.js.
// On vérifie : le code n'est plus dans le monolithe, il s'enregistre, la route
// lui est associée, et ses fonctions rendent sans erreur une fois chargées.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.js'), 'utf8');
const MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'static', 'js', 'modules', 'secretariat.js'),
  'utf8'
);

test('le code secrétariat a quitté le monolithe pour son module', () => {
  assert.doesNotMatch(APP_SRC, /function renderSecretariat\(/, 'renderSecretariat retiré de sgdi-app.js');
  assert.doesNotMatch(APP_SRC, /function secretariatScopedItems\(/);
  assert.match(APP_SRC, /extrait dans app\/static\/js\/modules\/secretariat\.js/, 'marqueur laissé dans le monolithe');
  assert.match(MODULE_SRC, /function renderSecretariat\(/);
  assert.match(MODULE_SRC, /SGDIModules\.registerModule\(\{[\s\S]*key: "secretariat"/);
  assert.match(MODULE_SRC, /routes: \["secretariat"\]/);
});

test('le module s’enregistre ; la route /secretariat est prête APRÈS init()', () => {
  const { window, loadError } = loadSgdiApp([]);
  assert.ifError(loadError);
  const SGDI = window.SGDIModules;
  assert.strictEqual(SGDI.isModuleRegistered('secretariat'), true);
  assert.strictEqual(SGDI.moduleKeyForRoute('secretariat'), 'secretariat');
  // Concaténé en test -> enregistré, mais pas encore initialisé : le portillon
  // doit encore passer (pour lancer init() une fois).
  assert.strictEqual(SGDI.routeNeedsModuleLoad('secretariat'), true, 'chargé mais pas initialisé');
  SGDI.initModule('secretariat');
  assert.strictEqual(SGDI.routeNeedsModuleLoad('secretariat'), false, 'prêt après init');
  const snap = SGDI.moduleRegistrySnapshot().find((m) => m.key === 'secretariat');
  assert.ok(snap && snap.routes.includes('secretariat') && snap.initialized === true);
});

test('secretariatScopedItems : sans filtre société renvoie tout, liste vide gérée', () => {
  const { T } = loadSgdiApp(['secretariatScopedItems']);
  const f = T().secretariatScopedItems;
  assert.strictEqual(typeof f, 'function', 'fonction exposée depuis le module');
  const items = [{ societe: 'A' }, { societe: 'B' }, {}];
  assert.deepStrictEqual([...f(items)], items);
  assert.deepStrictEqual([...f([])], []);
  assert.deepStrictEqual([...f(null)], []);
});

test('renderSecretariat rend sans erreur une fois le module chargé', () => {
  const { window, T } = loadSgdiApp(['renderSecretariat']);
  T().setSession({ transverse: 'secretariat', username: 't', societe: '' });
  T().setDb({});
  const view = window.document.getElementById('view');
  assert.strictEqual(typeof T().renderSecretariat, 'function');
  assert.doesNotThrow(() => T().renderSecretariat(view, 'dashboard', undefined));
  // Soit le tableau de bord SG, soit la carte d'accès refusé : dans tous les cas,
  // du HTML a été produit et aucune exception n'a été levée.
  assert.ok(view.innerHTML.length > 0);
});
