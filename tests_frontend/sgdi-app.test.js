// Tests FRONTEND réels : on charge le vrai sgdi-app.js dans jsdom et on teste ses
// fonctions critiques (logique métier qu'on a corrigée). Pas de mock de la logique :
// on appelle les VRAIES fonctions. On stub uniquement les APIs navigateur absentes de
// jsdom (réseau/temps réel), et un suffixe expose les fonctions + db/session (impossibles
// à atteindre autrement dans ce monolithe où db/session sont des `let` internes).
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.js'), 'utf8');

const dom = new JSDOM(
  '<!doctype html><html><body><div id="app"></div><div id="sidebar-nav"></div><div id="view"></div></body></html>',
  { url: 'https://drh.irongs.com/', runScripts: 'outside-only', pretendToBeVisual: true }
);
const { window } = dom;

// APIs navigateur absentes de jsdom -> no-op (on ne teste pas le réseau ici, juste la logique)
window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; this.onopen = null; this.onerror = null; };
window.BroadcastChannel = function () { this.postMessage = () => {}; this.close = () => {}; this.onmessage = null; };
window.AudioContext = function () { this.createOscillator = () => ({ connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {} }, type: '' }); this.createGain = () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }); this.destination = {}; this.currentTime = 0; this.state = 'running'; this.resume = () => Promise.resolve(); };
window.webkitAudioContext = window.AudioContext;
window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.scrollTo = () => {};
// Neutraliser les timers de fond pour ne pas bloquer le process de test
window.setInterval = () => 0;

// Suffixe : exposer les fonctions à tester + des setters pour db/session (let internes)
const exposeSuffix = `
;window.__sgdiTest = {
  employeeIsFormer: (typeof employeeIsFormer !== 'undefined') ? employeeIsFormer : null,
  employeeIsActive: (typeof employeeIsActive !== 'undefined') ? employeeIsActive : null,
  agentHasLiveAffectation: (typeof agentHasLiveAffectation !== 'undefined') ? agentHasLiveAffectation : null,
  agentNeedsAffectation: (typeof agentNeedsAffectation !== 'undefined') ? agentNeedsAffectation : null,
  sgdiLegacySnapshot: (typeof sgdiLegacySnapshot !== 'undefined') ? sgdiLegacySnapshot : null,
  sgdiCaptureBaseline: (typeof sgdiCaptureBaseline !== 'undefined') ? sgdiCaptureBaseline : null,
  sgdiEditingBlocksRender: (typeof sgdiEditingBlocksRender !== 'undefined') ? sgdiEditingBlocksRender : null,
  setDb: (v) => { db = v; },
  setSession: (v) => { session = v; },
  setViewMode: (v) => { sgdiViewModeActive = v; },
  setHydrated: (v) => { sgdiHydrated = v; },
};
`;

let loadError = null;
try {
  window.eval(src + exposeSuffix);
} catch (e) {
  loadError = e;
}

const T = () => window.__sgdiTest || {};

test('sgdi-app.js se charge sans erreur dans jsdom', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  assert.ok(window.__sgdiTest, 'le suffixe d\'exposition doit avoir tourné');
});

test('employeeIsFormer: un sortant est "former", un actif ne l\'est pas', () => {
  const f = T().employeeIsFormer;
  assert.ok(f);
  assert.strictEqual(f({ statut: 'sortant' }), true);
  assert.strictEqual(f({ statut: 'licencie' }), true);
  assert.strictEqual(f({ statut: 'actif' }), false);
  assert.strictEqual(f({ statut: 'suspendu' }), false); // suspendu = non sortant
});

test('employeeIsActive: seul le statut "actif" compte (exclut suspendu/sortant)', () => {
  const f = T().employeeIsActive;
  assert.ok(f);
  assert.strictEqual(f({ statut: 'actif' }), true);
  assert.strictEqual(f({ statut: 'suspendu' }), false);
  assert.strictEqual(f({ statut: 'sortant' }), false);
});

test('agentHasLiveAffectation: vrai si affectationCourante a un site, faux sinon', () => {
  const f = T().agentHasLiveAffectation;
  assert.ok(f);
  assert.strictEqual(f({ affectationCourante: { siteId: 'st_1', siteName: 'DHL' } }), true);
  assert.strictEqual(f({ affectationCourante: { siteName: 'DHL' } }), true);
  assert.strictEqual(f({ affectationCourante: {} }), false);
  assert.strictEqual(f({}), false);
});

test('agentNeedsAffectation: un non-sortant sans affectation en a besoin', () => {
  const f = T().agentNeedsAffectation;
  assert.ok(f);
  assert.strictEqual(f({ statut: 'actif', affectationCourante: {} }), true);
  assert.strictEqual(f({ statut: 'actif', affectationCourante: { siteId: 'x' } }), false);
  assert.strictEqual(f({ statut: 'sortant', affectationCourante: {} }), false); // sortant -> pas concerné
});

test('sgdiLegacySnapshot: sauvegarde CIBLÉE — seules les collections modifiées sont envoyées', () => {
  const t = T();
  assert.ok(t.sgdiLegacySnapshot && t.sgdiCaptureBaseline && t.setDb);
  // Base de départ avec deux collections JSON
  t.setDb({ conges: [{ id: 'c1' }], notifications: [{ id: 'n1' }], agents: [{ id: 'a1' }] });
  t.sgdiCaptureBaseline(); // empreinte = état "serveur"
  // On modifie UNE seule collection
  t.setDb({ conges: [{ id: 'c1' }, { id: 'c2' }], notifications: [{ id: 'n1' }], agents: [{ id: 'a1' }] });
  const snap = t.sgdiLegacySnapshot();
  // conges a changé -> envoyé plein ; notifications inchangée -> vidée ; agents = SQL -> vidé
  assert.strictEqual(snap.conges.length, 2, 'la collection modifiée doit être envoyée complète');
  assert.strictEqual(snap.notifications.length, 0, 'une collection INCHANGÉE ne doit pas être renvoyée');
  assert.strictEqual(snap.agents.length, 0, 'les collections SQL sont toujours vidées (gérées par REST)');
});

test('sgdiEditingBlocksRender: bloque le réaffichage si le formulaire est déverrouillé', () => {
  const t = T();
  assert.ok(t.sgdiEditingBlocksRender && t.setViewMode);
  t.setSession({ username: 'x' });
  t.setViewMode(true);  // mode lecture -> ne bloque pas
  assert.strictEqual(t.sgdiEditingBlocksRender(), false);
  t.setViewMode(false); // mode édition (déverrouillé) -> bloque
  assert.strictEqual(t.sgdiEditingBlocksRender(), true);
});

// Sortie propre (des timers/handlers résiduels pourraient sinon maintenir le process en vie)
test.after(() => { try { dom.window.close(); } catch (e) {} setTimeout(() => process.exit(0), 50); });
