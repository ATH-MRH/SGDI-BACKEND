// Chargeur dédié pour app/static/pointeur.html (pointage.irongs.com /
// pointeur.irongs.com — les deux domaines servent ce même fichier, cf.
// _is_pointer_host dans app/main.py). Charge la VRAIE page dans jsdom et
// expose les fonctions/état internes nécessaires aux tests via
// window.__pointeurTest, en s'appuyant sur le mécanisme d'initialisation réel
// de la page (DOMContentLoaded lit localStorage puis appelle enterApp()).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'app', 'static', 'pointeur.html');
const RAW_HTML = fs.readFileSync(HTML_PATH, 'utf8');
const SESSION_KEY = 'atlas_pointer_session';

// Expose les let/const internes du script (non accessibles depuis window pour un
// script classique) via un hook ajouté à la fin du MÊME <script> — fonction
// remplaçante obligatoire (jamais une chaîne) car le script original contient de
// nombreux littéraux de gabarit avec des séquences `$`, mal interprétées par
// String.replace() si on lui passe une chaîne de remplacement.
function buildHtml() {
  const suffix = `
;window.__pointeurTest = {
  noteUserActivity, idleTick, startIdleWatch, stopIdleWatch, showIdleWarning, hideIdleWarning,
  logout, enterApp, onQr, performIdleLogout,
  getLastActivity: () => lastUserActivityAt,
  setLastActivity: (v) => { lastUserActivityAt = v; },
  getWarningVisible: () => idleWarningVisible,
  getLoggingOut: () => isLoggingOut,
  getSession: () => pointerSession,
  setSession: (s) => { pointerSession = s; },
  getIdleCheckTimer: () => idleCheckTimer,
  clearIdleInterval: () => { clearInterval(idleCheckTimer); idleCheckTimer = null; },
  INACTIVITY_TIMEOUT_MS, INACTIVITY_WARNING_MS,
};
`;
  return RAW_HTML.replace(/(<script>)([\s\S]*?)(<\/script>)/, (match, open, body, close) => open + body + suffix + close);
}

function loadPointeur(options = {}) {
  const html = buildHtml();
  const dom = new JSDOM(html, {
    url: options.url || 'https://pointage.irongs.com/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // Environnement : ne rien laisser dépendre d'un vrai réseau/caméra/service worker.
  window.fetch = options.fetch || (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  Object.defineProperty(window.navigator, 'userAgent', { value: 'jsdom-test-desktop', configurable: true });
  window.AudioContext = function () {
    this.createOscillator = () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '', onended: null });
    this.createGain = () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
    this.destination = {}; this.currentTime = 0; this.close = () => {};
  };
  window.webkitAudioContext = window.AudioContext;
  window.Html5Qrcode = function () { this.start = () => Promise.resolve(); this.stop = () => Promise.resolve(); this.clear = () => Promise.resolve(); };
  if (window.navigator.serviceWorker) window.navigator.serviceWorker.register = () => Promise.resolve();

  if (options.session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(options.session));
  }

  return { dom, window, T: () => window.__pointeurTest || {} };
}

module.exports = { loadPointeur, SESSION_KEY };
