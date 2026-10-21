// Stabilité du rendu OPS : vrai sgdi-app.js + modules dans jsdom.
// Causes établies en Chrome réel (tests_frontend/ops-render-stability-chrome.test.js) :
//  1. un changement de # déclenche popstate puis hashchange -> deux render() par navigation ;
//  2. le filet de chargement de 20 s n'était jamais annulé -> la vue était reconstruite 20 s après
//     chaque chargement, hors des gardes d'édition ;
//  3. l'habillage des boutons OPS arrivait 30 ms après le rendu -> image intermédiaire à l'ancien style ;
//  4. le normalisateur générique habillait la fiche technique (.stf) en .module-page-header.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');

const APP = fs.readFileSync(path.join(__dirname, '../app/static/sgdi-app.js'), 'utf8');
const SOC = 'IRON GLOBAL SOLUTION';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// Suit les MutationObserver et minuteurs créés par l'application (ex. l'observateur anonyme qui
// appelle syncOpsPresentation à chaque mutation de document.body, et son minuteur de 30 ms).
// window.close() vide le document : sans arrêt préalable, cet observateur est rappelé en microtâche
// sur une fenêtre détruite (TypeError … reading 'body') — activité asynchrone après la fin du test.
// Le post-rendu de renderView (requestAnimationFrame) passe par les minuteurs jsdom de load-app :
// window.close() l'annule.
function trackAppHandles(window) {
  const observers = new Set(), timeouts = new Set(), intervals = new Set();
  const Native = window.MutationObserver;
  window.MutationObserver = class extends Native {
    constructor(callback) { super(callback); observers.add(this); }
  };
  const setT = window.setTimeout, clearT = window.clearTimeout, setI = window.setInterval, clearI = window.clearInterval;
  window.setTimeout = (fn, ms, ...args) => {
    const id = setT.call(window, typeof fn === 'function' ? (...a) => { timeouts.delete(id); fn(...a); } : fn, ms, ...args);
    timeouts.add(id);
    return id;
  };
  window.clearTimeout = id => { timeouts.delete(id); return clearT.call(window, id); };
  window.setInterval = (...a) => { const id = setI.call(window, ...a); intervals.add(id); return id; };
  window.clearInterval = id => { intervals.delete(id); return clearI.call(window, id); };
  return async function cleanup() {
    for (const observer of observers) observer.disconnect();
    for (const id of timeouts) clearT.call(window, id);
    for (const id of intervals) clearI.call(window, id);
    observers.clear(); timeouts.clear(); intervals.clear();
    // Laisse s'écouler les microtâches déjà en file (promesses, rappels d'observateur) avant close().
    await new Promise(resolve => setImmediate(resolve));
    window.close();
  };
}

function boot(t, { url = 'https://ops.irongs.com/#/ops/dashboard', transverse = 'ops' } = {}) {
  let cleanup;
  const r = loadSgdiApp(['emptyDB', 'renderView', 'normalizeCentralPage', 'syncOpsPresentation'], {
    beforeApp: window => { cleanup = trackAppHandles(window); },
  });
  assert.ifError(r.loadError);
  t.after(cleanup);
  r.dom.reconfigure({ url });
  r.T().setDb(r.T().emptyDB());
  r.T().setSession({ username: 'OPS-01', nom: 'Test', role: 'ops', transverse, societe: SOC, actionsAutorisees: ['read'] });
  r.T().setFullDataReady(true);
  return { ...r, w: r.window };
}

test('navigation par # : popstate puis hashchange ne déclenchent qu\'un seul render()', async t => {
  const { w } = boot(t);
  let renders = 0;
  w.render = () => { renders++; };
  w.history.replaceState(null, '', '#/sites/actifs');
  w.dispatchEvent(new w.PopStateEvent('popstate'));
  w.dispatchEvent(new w.HashChangeEvent('hashchange'));
  assert.equal(renders, 1, 'une seule navigation, un seul rendu');
  // Une vraie navigation suivante (autre adresse) est toujours rendue, quel que soit l'événement.
  w.history.replaceState(null, '', '#/effectif/recap');
  w.dispatchEvent(new w.HashChangeEvent('hashchange'));
  w.dispatchEvent(new w.PopStateEvent('popstate'));
  assert.equal(renders, 2);
  // Retour vers une adresse déjà visitée : rendu (le marqueur ne vaut que pour la paire d'événements).
  w.history.replaceState(null, '', '#/sites/actifs');
  w.dispatchEvent(new w.PopStateEvent('popstate'));
  assert.equal(renders, 3, 'retour arrière vers une page déjà vue : rendu');
});

test('navigation par # : la garde de saisie non enregistrée reste appliquée', async t => {
  const { w } = boot(t);
  let renders = 0;
  w.render = () => { renders++; };
  w.sgdiHasUnsavedUserWork = () => true;
  w.toast = () => {};
  w.history.replaceState(null, '', '#/sites/actifs');
  w.dispatchEvent(new w.PopStateEvent('popstate'));
  assert.equal(renders, 0, 'aucune navigation par-dessus une saisie');
});

test('filet de chargement de 20 s : annulé quand les données arrivent, jamais de rendu par-dessus une vue prête', t => {
  const { w, T } = boot(t);
  assert.match(APP, /sgdiFullDataReady=true;\s*\/\/[^\n]*\n[^\n]*\n\s*if\(window\.__sgdiDataReadySafety\)\{clearTimeout\(window\.__sgdiDataReadySafety\);window\.__sgdiDataReadySafety=null;\}/, 'annulation au chargement des données');
  // Le filet s'arme pendant le chargement…
  const timers = [];
  w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  w.sgdiBackendShouldUse = () => true;
  T().setFullDataReady(false);
  w.sgdiAuthToken = () => 'jeton';
  w.renderView();
  const safety = timers.find(x => x.ms === 20000);
  assert.ok(safety, 'filet armé tant que les données ne sont pas chargées');
  assert.match(w.document.getElementById('view').textContent, /Chargement des données/);
  // … et, si les données sont arrivées entre-temps, il ne reconstruit plus la vue.
  T().setFullDataReady(true);
  let renders = 0;
  const original = w.renderView;
  w.renderView = () => { renders++; };
  safety.fn();
  assert.equal(renders, 0, 'aucun rendu tardif d\'une vue déjà prête');
  assert.equal(w.__sgdiDataReadySafety, null);
  // Sans données au bout de 20 s, le filet joue toujours son rôle.
  w.renderView = original;
  T().setFullDataReady(false);
  w.renderView();
  const second = timers.filter(x => x.ms === 20000).at(-1);
  w.renderView = () => { renders++; };
  second.fn();
  assert.equal(renders, 1, 'filet toujours actif si le serveur ne répond pas');
});

test('vue en attente des données : rendue dès leur arrivée, même lors d\'une synchronisation silencieuse', () => {
  // Sans ce rendu, la page restait sur « Chargement des données… » jusqu'au filet de 20 s
  // (constaté en Chrome réel juste après la connexion).
  assert.match(APP, /data-sgdi-awaiting-data="1"><div class="text-lg font-black mb-2">Chargement des données…/);
  // Une synchronisation silencieuse ne reconstruit toujours pas une vue prête (contrat BRQ) :
  // seule la vue restée sur l'écran d'attente est rendue.
  assert.match(APP, /const awaitingData=!!document\.querySelector\("#view \[data-sgdi-awaiting-data\]"\);\s*try\{if\(opt\.render!==false&&document\.getElementById\("view"\)&&typeof renderView==="function"\)renderView\(\);else if\(awaitingData&&typeof renderView==="function"\)renderView\(\)\}/);
});

test('boutons OPS habillés avant la peinture (rappel du MutationObserver), sans attendre 30 ms', async t => {
  const { w } = boot(t);
  w.syncOpsPresentation();
  assert.equal(w.document.body.hasAttribute('data-ops-ui'), true);
  const view = w.document.getElementById('view');
  view.innerHTML = '<div><button type="button" class="btn btn-secondary" onclick="void 0">Valider</button></div>';
  await Promise.resolve(); await Promise.resolve();
  const button = view.querySelector('button');
  assert.equal(button.classList.contains('ops-btn'), true, 'habillé dans la même tâche que le rendu');
  assert.equal(button.querySelectorAll('svg').length, 1, 'une seule icône');
  await tick(); await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(button.querySelectorAll('svg').length, 1, 'pas de double habillage au passage différé');
});

test('hors OPS (DRH) : aucun habillage, même avec le rappel immédiat', async t => {
  const { w } = boot(t, { url: 'https://drh.irongs.com/#/effectif/actifs', transverse: 'drh' });
  w.syncOpsPresentation();
  const view = w.document.getElementById('view');
  view.innerHTML = '<button type="button" class="btn btn-secondary" onclick="void 0">Valider</button>';
  await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(w.document.body.hasAttribute('data-ops-ui'), false);
  assert.equal(view.querySelector('button').classList.contains('ops-btn'), false);
});

test('fiche technique (.stf) : le normalisateur générique ne la réhabille pas', t => {
  const { w } = boot(t, { url: 'https://ops.irongs.com/#/sites/1' });
  const view = w.document.getElementById('view');
  view.innerHTML = '<div class="w-full stf"><header class="stf-head"><div class="stf-title"><h1 data-keep-case>FICHE TECHNIQUE SITE</h1></div></header></div>';
  w.normalizeCentralPage(view);
  assert.equal(view.querySelectorAll('.module-page-header,.module-page-header-actions').length, 0);
  assert.equal(view.querySelector('h1').textContent, 'FICHE TECHNIQUE SITE');
  // Les autres pages restent normalisées.
  view.innerHTML = '<div><h1>Tableau de bord</h1><p>Sous-titre</p></div>';
  w.normalizeCentralPage(view);
  assert.ok(view.querySelector('h1').classList.contains('module-title-clean'));
});

test('écouteurs de navigation : un seul écouteur rend la page par type d\'événement', () => {
  const handlers = type => [...APP.matchAll(new RegExp('window\\.addEventListener\\("' + type + '",\\(\\)=>\\{([\\s\\S]*?)\\n?\\}\\);', 'g'))].map(m => m[1]);
  for (const type of ['hashchange', 'popstate']) {
    const rendering = handlers(type).filter(body => /\brender\(\)/.test(body));
    assert.equal(rendering.length, 1, type + ' : un seul écouteur de rendu');
    assert.match(rendering[0], /sgdiUrlEventAlreadyHandled\(\)/, type + ' : dédoublonné');
  }
});
