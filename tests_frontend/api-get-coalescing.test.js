// LOT PERFORMANCE V3 — coalescing des lectures GET concurrentes/rapprochées (§15).
// Charge le vrai sgdi-app.js dans jsdom (même pattern que sgdi-app.test.js) et
// appelle la VRAIE fonction sgdiApi, en comptant les fetch() réellement déclenchés.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const coreUtils = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'utils.js'), 'utf8');
const moduleRegistry = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'module-registry.js'), 'utf8');
const appSrc = require('./read-client-source')();
const src = coreUtils + '\n' + moduleRegistry + '\n' + appSrc;

function boot() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app"></div><div id="sidebar-nav"></div><div id="view"></div></body></html>',
    { url: 'https://drh.irongs.com/', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;
  const calls = [];
  window.fetch = (url, opts) => {
    calls.push(String(url));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, value: calls.length }), text: () => Promise.resolve(JSON.stringify({ ok: true, value: calls.length })) });
  };
  window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; };
  window.BroadcastChannel = function () { this.postMessage = () => {}; this.close = () => {}; };
  window.setInterval = () => 0;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.scrollTo = () => {};

  const exposeSuffix = `
;window.__coalesceTest = {
  sgdiApi,
  sgdiInvalidateDrhReads,
};
`;
  window.eval(src + exposeSuffix);
  calls.length = 0; // ignore les appels déclenchés par le chargement/l'init du module lui-même
  return { window, calls, T: () => window.__coalesceTest };
}

test('deux GET identiques lancés en même temps (concurrents) -> un seul fetch réel', async () => {
  const { calls, T } = boot();
  const [a, b] = await Promise.all([
    T().sgdiApi('/ui/sidebar-stats', { legacy: false }),
    T().sgdiApi('/ui/sidebar-stats', { legacy: false }),
  ]);
  assert.strictEqual(calls.length, 1, 'un seul aller-retour réseau pour deux lectures identiques concurrentes');
  assert.deepStrictEqual(a, b, 'les deux appelants reçoivent la même réponse');
});

test('un second GET identique juste après la résolution du premier (< 800ms) -> réutilise la réponse, pas de nouveau fetch', async () => {
  const { calls, T } = boot();
  await T().sgdiApi('/drh/employees', { legacy: false });
  assert.strictEqual(calls.length, 1);
  await T().sgdiApi('/drh/employees', { legacy: false }); // séquentiel, quelques ms après — exactement le pattern mesuré dans le cold start V3
  assert.strictEqual(calls.length, 1, 'la seconde lecture, quasi immédiate, ne doit pas redéclencher de requête');
});

test('deux GET avec des paramètres différents ne sont jamais confondus', async () => {
  const { calls, T } = boot();
  await Promise.all([
    T().sgdiApi('/drh/employees?society=A', { legacy: false }),
    T().sgdiApi('/drh/employees?society=B', { legacy: false }),
  ]);
  assert.strictEqual(calls.length, 2, 'deux URLs différentes doivent toujours déclencher deux requêtes distinctes');
});

test('sgdiInvalidateDrhReads() vide le cache : une lecture après invalidation redéclenche bien une requête', async () => {
  const { calls, T } = boot();
  await T().sgdiApi('/ui/sidebar-stats', { legacy: false });
  assert.strictEqual(calls.length, 1);
  T().sgdiInvalidateDrhReads();
  await T().sgdiApi('/ui/sidebar-stats', { legacy: false });
  assert.strictEqual(calls.length, 2, 'après invalidation (ex. suite à une écriture), la lecture suivante doit repartir du réseau — jamais de donnée périmée');
});

test('les méthodes mutantes (POST/PUT/PATCH/DELETE) ne sont jamais coalescées, même identiques', async () => {
  const { calls, T } = boot();
  await Promise.all([
    T().sgdiApi('/drh/employees', { method: 'POST', body: { nom: 'Test' }, legacy: false }),
    T().sgdiApi('/drh/employees', { method: 'POST', body: { nom: 'Test' }, legacy: false }),
  ]);
  assert.strictEqual(calls.length, 2, 'deux écritures explicites doivent toujours produire deux requêtes — jamais fusionnées');
});

test('un appel avec un signal AbortController fourni par l\'appelant n\'est jamais coalescé (contrôle d\'annulation indépendant préservé)', async () => {
  const { calls, T } = boot();
  const ctrlA = new AbortController();
  const ctrlB = new AbortController();
  await Promise.all([
    T().sgdiApi('/ui/sidebar-stats', { legacy: false, signal: ctrlA.signal }),
    T().sgdiApi('/ui/sidebar-stats', { legacy: false, signal: ctrlB.signal }),
  ]);
  assert.strictEqual(calls.length, 2, 'un appelant avec son propre signal garde un aller-retour réseau indépendant');
});
