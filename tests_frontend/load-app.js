// Chargeur commun : charge le VRAI app/static/sgdi-app.js dans jsdom et expose les
// fonctions demandées. On ne mocke aucune logique métier — uniquement les APIs
// navigateur absentes de jsdom (réseau, temps réel, audio, timers de fond).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const STATIC = path.join(__dirname, '..', 'app', 'static');
const CORE_UTILS = fs.readFileSync(path.join(STATIC, 'js', 'core', 'utils.js'), 'utf8');
const MODULE_REGISTRY = fs.readFileSync(path.join(STATIC, 'js', 'core', 'module-registry.js'), 'utf8');
const APP = fs.readFileSync(path.join(STATIC, 'sgdi-app.js'), 'utf8');
// Modules extraits : en navigateur ils sont chargés à la demande ; pour les tests
// « appeler les vraies fonctions », on les concatène (leur script tourne alors au
// chargement, donc SGDI.registerModule est appelé et routeNeedsModuleLoad est faux).
const MODULES_DIR = path.join(STATIC, 'js', 'modules');
const MODULES = fs.existsSync(MODULES_DIR)
  ? fs.readdirSync(MODULES_DIR).filter((f) => f.endsWith('.js')).sort()
      .map((f) => fs.readFileSync(path.join(MODULES_DIR, f), 'utf8')).join('\n')
  : '';
const SRC = [CORE_UTILS, MODULE_REGISTRY, APP, MODULES].join('\n');

function loadSgdiApp(names = [], options = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app"></div><div id="sidebar-nav"></div><div id="view"></div><div id="modal-host"></div></body></html>',
    { url: 'https://drh.irongs.com/', runScripts: options.lazyModules ? 'dangerously' : 'outside-only', pretendToBeVisual: true }
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
  // CSS.escape est disponible dans les navigateurs, absent de cette version de jsdom.
  window.CSS = window.CSS || {};
  window.CSS.escape = value => Array.from(String(value), (char, index) => {
    const code = char.codePointAt(0), first = String(value)[0];
    if (code === 0) return '\uFFFD';
    if (code < 32 || code === 127 || (/\d/.test(char) && (index === 0 || (index === 1 && first === '-')))) return '\\' + code.toString(16) + ' ';
    if (index === 0 && char === '-' && String(value).length === 1) return '\\-';
    return code >= 128 || /[\w-]/.test(char) ? char : '\\' + char;
  }).join('');
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
  setFullDataReady: (v) => { sgdiFullDataReady = v; },
  setFormUnsaved: (v) => { sgdiFormHasUnsavedChanges = v; },
  getRenderGeneration: () => sgdiViewRenderGeneration,
  getLastRenderedPath: () => sgdiLastRenderedPath,
};
`;

  let loadError = null;
  try {
    const source = options.withoutModules ? [CORE_UTILS, APP].join("\n") : SRC;
    if (options.lazyModules) {
      // Scripts classiques séparés : les let/const globaux gardent la portée navigateur.
      for (const code of [CORE_UTILS, MODULE_REGISTRY, APP + suffix]) {
        const script = window.document.createElement('script');
        script.textContent = code;
        window.document.head.appendChild(script);
      }
    } else window.eval(source + suffix);
  } catch (e) {
    loadError = e;
  }

  return { dom, window, loadError, T: () => window.__sgdiTest || {} };
}

module.exports = { loadSgdiApp };
