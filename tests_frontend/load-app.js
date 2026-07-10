// Chargeur commun : charge le VRAI app/static/sgdi-app.js dans jsdom et expose les
// fonctions demandées. On ne mocke aucune logique métier — uniquement les APIs
// navigateur absentes de jsdom (réseau, temps réel, audio, timers de fond).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.js'), 'utf8');

function loadSgdiApp(names = []) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app"></div><div id="sidebar-nav"></div><div id="view"></div></body></html>',
    { url: 'https://drh.irongs.com/', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;

  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
  window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; this.onopen = null; this.onerror = null; };
  window.BroadcastChannel = function () { this.postMessage = () => {}; this.close = () => {}; this.onmessage = null; };
  window.AudioContext = function () {
    this.createOscillator = () => ({ connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {} }, type: '' });
    this.createGain = () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
    this.destination = {}; this.currentTime = 0; this.state = 'running'; this.resume = () => Promise.resolve();
  };
  window.webkitAudioContext = window.AudioContext;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.scrollTo = () => {};
  window.setInterval = () => 0; // neutralise les boucles de fond (sinon le process ne rend jamais la main)

  const exposed = names
    .map((n) => `  ${n}: (typeof ${n} !== 'undefined') ? ${n} : null,`)
    .join('\n');

  // db/session/flags sont des `let` internes au monolithe : seuls des setters évalués
  // dans sa portée permettent de les piloter depuis les tests.
  const suffix = `
;window.__sgdiTest = {
${exposed}
  setDb: (v) => { db = v; },
  setSession: (v) => { session = v; },
  setViewMode: (v) => { sgdiViewModeActive = v; },
  setHydrated: (v) => { sgdiHydrated = v; },
};
`;

  let loadError = null;
  try {
    window.eval(SRC + suffix);
  } catch (e) {
    loadError = e;
  }

  return { dom, window, loadError, T: () => window.__sgdiTest || {} };
}

module.exports = { loadSgdiApp };
