// Chargeur commun : charge le VRAI app/static/sgdi-app.js dans jsdom et expose les
// fonctions demandées. On ne mocke aucune logique métier — uniquement les APIs
// navigateur absentes de jsdom (réseau, temps réel, audio, timers de fond).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const STATIC = path.join(__dirname, '..', 'app', 'static');
const CORE_UTILS = fs.readFileSync(path.join(STATIC, 'js', 'core', 'utils.js'), 'utf8');
const CORE_FILES = fs.readFileSync(path.join(STATIC, "js", "core", "files.js"), "utf8");
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
const SRC = [CORE_UTILS, MODULE_REGISTRY, CORE_FILES, APP, MODULES].join('\n');

// URL de démarrage sans navigation au boot. Sans fragment, l'application (aucune session) fait
// elle-même `location.hash="#/login"` : jsdom met alors en file (setTimeout 0) un popstate et un
// hashchange. Un banc qui installe ensuite une session et pilote l'URL par replaceState +
// renderView() — que le routeur ne voit pas — reçoit ces événements PÉRIMÉS plus tard : le routeur
// rejoue alors render() sur l'URL du moment et applique sa garde d'accueil (ex. dashboard →
// admin/dashboard pour une session admin), ce qui change la route sous les pieds du test.
// En démarrant sur #/login, l'application n'a aucune navigation à faire : aucun événement en file.
const LOGIN_BOOT_URL = 'https://drh.irongs.com/#/login';

// Suivi des minuteurs de mise en place d'écran (option `trackTimers`). Un `await setTimeout(N)` côté
// test ne garantit PAS que l'écran est stabilisé :
//  - Node range les minuteurs par durée : quand un rendu synchrone dépasse N ms, le minuteur du test
//    (déjà échu) peut passer AVANT un minuteur 0 ms créé après lui. Le test observait alors l'écran
//    avant son post-rendu (requestAnimationFrame → setTimeout 0) ou avant les événements de
//    navigation de jsdom (hashchange/popstate, eux aussi en setTimeout 0) ;
//  - un écran termine sa mise en place par ses propres minuteurs (balayage post-mutation à 30 ms,
//    démarrage des sous-vues Pointage à 100 ms, styles employés à 150 ms) : un instantané pris plus
//    tôt change ensuite tout seul, sans qu'aucune réponse tardive n'y soit pour rien.
// settle() remplace l'attente « au temps » par une attente « à l'état » : tant qu'un de ces
// minuteurs est en attente dans une fenêtre suivie, on attend encore. Les minuteurs de fond de
// l'application (rafraîchissements >= 250 ms, expirations réseau) ne sont pas attendus.
const SETTLE_TIMER_MS = 150;
const trackedWindows = new Set(); // un Set d'identifiants de minuteurs en attente par fenêtre suivie
let settleWaiters = [];
const timerSettled = () => { const waiters = settleWaiters; settleWaiters = []; for (const wake of waiters) wake(); };
function trackSettleTimers(window) {
  const pending = new Set();
  const set = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window), close = window.close.bind(window);
  window.setTimeout = (fn, ms, ...args) => {
    if (typeof fn !== 'function' || Number(ms || 0) > SETTLE_TIMER_MS) return set(fn, ms, ...args);
    const id = set(() => { pending.delete(id); try { fn(...args); } finally { timerSettled(); } }, ms);
    pending.add(id);
    return id;
  };
  window.clearTimeout = id => { clear(id); if (pending.delete(id)) timerSettled(); };
  // close() annule tous les minuteurs de la fenêtre : plus rien à attendre pour elle.
  window.close = () => { pending.clear(); trackedWindows.delete(pending); close(); timerSettled(); };
  trackedWindows.add(pending);
}
// `wait` : l'attente réelle du banc (son tick), faite une fois. Ensuite, tant qu'un minuteur suivi est
// en attente, on attend son exécution ou son annulation — sans durée ajoutée ni nouvel essai.
// setImmediate laisse d'abord finir les chaînes de promesses en cours (elles peuvent armer un minuteur).
// Un minuteur qui se réarmerait sans fin est signalé au lieu de bloquer le banc.
async function settle(wait) {
  await wait();
  for (let turn = 0; turn < 1000; turn++) {
    await new Promise(resolve => setImmediate(resolve));
    if (![...trackedWindows].some(pending => pending.size)) return;
    await new Promise(resolve => settleWaiters.push(resolve));
  }
  throw new Error('load-app settle : des minuteurs de mise en place se réarment sans fin');
}

function loadSgdiApp(names = [], options = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app"></div><div id="sidebar-nav"></div><div id="view"></div><div id="modal-host"></div></body></html>',
    { url: options.url || 'https://drh.irongs.com/', runScripts: options.lazyModules ? 'dangerously' : 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;
  if (options.trackTimers) trackSettleTimers(window);

  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
  window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; this.onopen = null; this.onerror = null; };
  window.BroadcastChannel = function () { this.postMessage = () => {}; this.close = () => {}; this.onmessage = null; };
  window.AudioContext = function () {
    this.createOscillator = () => ({ connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {} }, type: '' });
    this.createGain = () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
    this.destination = {}; this.currentTime = 0; this.state = 'running'; this.resume = () => Promise.resolve();
  };
  window.webkitAudioContext = window.AudioContext;
  // Avec suivi : le rAF passe par le minuteur de la fenêtre (suivi, et annulé par window.close()).
  window.requestAnimationFrame = options.trackTimers ? (cb) => window.setTimeout(cb, 0) : (cb) => setTimeout(cb, 0);
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
  getDb: () => db,
  setSession: (v) => { session = v; },
  setViewMode: (v) => { sgdiViewModeActive = v; },
  setHydrated: (v) => { sgdiHydrated = v; },
  setFullDataReady: (v) => { sgdiFullDataReady = v; },
  setFormUnsaved: (v) => { sgdiFormHasUnsavedChanges = v; },
  getRenderGeneration: () => sgdiViewRenderGeneration,
  getLastRenderedPath: () => sgdiLastRenderedPath,
  getSessionGeneration: () => sgdiSessionGeneration,
  bumpRenderGeneration: () => { sgdiViewRenderGeneration += 1; },
  bumpSessionGeneration: () => { sgdiSessionGeneration += 1; },
};
`;

  let loadError = null;
  try {
    const source = options.withoutModules ? [CORE_UTILS, CORE_FILES, APP].join("\n") : SRC;
    if (options.lazyModules) {
      // Scripts classiques séparés : les let/const globaux gardent la portée navigateur.
      let scripts = [CORE_UTILS, MODULE_REGISTRY, CORE_FILES, APP + suffix];
      if (options.entryHTML) {
        // Respecte les dépendances et leur ordre réellement déclarés par ce HTML.
        // Les autres assets (ERP, communes) restent hors de ce banc de routeur.
        const html = fs.readFileSync(path.join(STATIC, options.entryHTML), 'utf8');
        scripts = [];
        for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
          const src = attrs.match(/src="([^"?]+)(?:\?[^" ]*)?"/);
          if (!src) { scripts.push(body); continue; }
          if (!/^\/static\/(?:js\/core\/[^/]+|sgdi-app)\.js$/.test(src[1])) continue;
          scripts.push(fs.readFileSync(path.join(STATIC, src[1].slice('/static/'.length)), 'utf8') +
            (src[1] === '/static/sgdi-app.js' ? suffix : ''));
        }
      }
      for (const code of scripts) {
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

module.exports = { loadSgdiApp, settle, LOGIN_BOOT_URL };
