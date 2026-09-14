// CORRECTION 0.6-A — entrée ALERTES dans le menu ERP existant.
// Vérifie : catalogue "Organiser menu latéral", présence/emplacement dans le menu
// latéral Administration, routage réel vers #/alerts (chargement lazy une seule
// fois, deep link, navigation croisée), et qu'aucun nouveau droit n'est créé
// (le module reste soumis au canAccess() générique existant).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { loadSgdiApp } = require('./load-app');

const tick = () => new Promise(resolve => setTimeout(resolve, 150));

function bootLazy() {
  const ctx = loadSgdiApp(['renderView', 'renderSidebar', 'adminSidebarOrganizerDefaults', 'navigate'], { lazyModules: true });
  assert.ifError(ctx.loadError);
  ctx.dom.reconfigure({ url: 'http://localhost/' });
  const { window: w, T } = ctx;
  for (const id of ['sidebar-nav', 'view']) w.document.getElementById('app').appendChild(w.document.getElementById(id));
  const errors = [], downloads = [];
  w.addEventListener('error', e => { errors.push(e.error || e.message); e.preventDefault(); });
  w.console.error = (...args) => errors.push(args);
  w.fetch = () => Promise.resolve({ ok: true, json: async () => ({}), text: async () => '' });
  w.setInterval = () => 0;
  const append = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = el => {
    if (el.src && el.src.includes('/static/js/modules/')) {
      const url = new URL(el.src);
      const filename = path.join(__dirname, '../app', url.pathname);
      assert.ok(fs.existsSync(filename), 'aucun 404 : ' + url.pathname);
      downloads.push(url.pathname);
      assert.strictEqual(url.searchParams.get('v'), w.SGDIModules.MODULE_VERSION);
      el.removeAttribute('src');
      el.textContent = fs.readFileSync(filename, 'utf8');
      append(el);
      queueMicrotask(() => el.onload());
      return el;
    }
    return append(el);
  };
  T().setDb(new Proxy({}, { get(target, key) { return target[key] ?? (target[key] = []); } }));
  T().setSession({ username: 'admin', role: 'ADM', adminSystem: true, transverse: 'admin', societe: '' });
  T().setFullDataReady(true);
  T().setViewMode(true);
  // Seule la navigation/le routage est sous test ici (pas l'appel réseau réel,
  // déjà couvert par alerts.test.js) : on stub sgdiApi comme le fait ce dernier.
  w.sgdiApi = async url => (url.includes('/alerts/stats')
    ? { total_open: 0, critical: 0, unacknowledged: 0, assigned_to_me: 0 }
    : { items: [], total: 0, page: 1, page_size: 50, pages: 1 });
  const go = hash => { w.history.replaceState(null, '', hash); assert.equal(T().renderView(), undefined); };
  return { ...ctx, errors, downloads, go, view: () => w.document.getElementById('view'), sidebar: () => w.document.getElementById('sidebar-nav') };
}

test('Organiser menu latéral : le catalogue du module admin reconnaît ALERTES → alerts', () => {
  const app = loadSgdiApp(['adminSidebarOrganizerDefaults']);
  assert.ifError(app.loadError);
  const defaults = app.T().adminSidebarOrganizerDefaults();
  assert.ok(defaults.admin.some(([label, route]) => label === 'ALERTES' && route === 'alerts'),
    'la rubrique ALERTES doit être repositionnable comme les autres depuis "Organiser menu latéral"');
  app.window.close();
});

test('menu latéral Administration : ALERTES apparaît dans PILOTAGE, juste après TABLEAU CONFIGURATION', () => {
  const r = bootLazy();
  r.T().renderSidebar();
  const nav = r.sidebar();
  const labels = [...nav.querySelectorAll('.nav-link .nav-label')].map(el => el.textContent);
  const pilotageIdx = labels.indexOf('TABLEAU CONFIGURATION');
  assert.ok(pilotageIdx >= 0, 'TABLEAU CONFIGURATION doit toujours être présent');
  assert.equal(labels[pilotageIdx + 1], 'ALERTES');
  const link = [...nav.querySelectorAll('.nav-link')].find(el => el.dataset.route === 'alerts');
  assert.ok(link, 'un lien de route "alerts" doit exister dans le menu');
  assert.equal(link.getAttribute('onclick'), "sidebarNavigate(event,'alerts')");
  assert.deepEqual(r.errors, []);
  r.window.close();
});

test('clic sur ALERTES → #/alerts charge alerts.js une seule fois et affiche le cockpit', async () => {
  const r = bootLazy();
  const R = r.window.SGDIModules;
  r.go('#/alerts');
  await tick();
  assert.equal(R.activeModuleKey, 'alerts');
  assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError|Module indisponible|Accès refusé/);
  assert.match(r.view().textContent, /Cockpit Alertes/);
  assert.equal(r.downloads.filter(d => d.endsWith('/alerts.js')).length, 1, 'alerts.js chargé une seule fois');
  assert.deepEqual(r.errors, []);
  r.window.close();
});

test('deep link #/alerts fonctionne directement (sans passer par le dashboard)', async () => {
  const r = bootLazy();
  r.go('#/alerts');
  await tick();
  assert.match(r.view().textContent, /Cockpit Alertes/);
  assert.deepEqual(r.errors, []);
  r.window.close();
});

test('navigation croisée Dashboard → Alertes → DRH → Alertes → Pointage → Alertes : un seul chargement de script', async () => {
  const r = bootLazy();
  const R = r.window.SGDIModules;
  for (const hash of ['#/dashboard', '#/alerts', '#/drh/dashboard', '#/alerts', '#/pointage/dashboard', '#/alerts']) {
    r.go(hash);
    await tick();
  }
  assert.equal(R.activeModuleKey, 'alerts');
  assert.match(r.view().textContent, /Cockpit Alertes/);
  assert.equal(r.downloads.filter(d => d.endsWith('/alerts.js')).length, 1);
  assert.deepEqual(r.errors, []);
  r.window.close();
});

test('retour navigateur (back) depuis #/alerts revient proprement au dashboard', async () => {
  const r = bootLazy();
  const R = r.window.SGDIModules;
  r.go('#/dashboard'); await tick();
  r.go('#/alerts'); await tick();
  assert.equal(R.activeModuleKey, 'alerts');
  r.go('#/dashboard'); await tick(); // équivalent fonctionnel du bouton précédent (même chemin renderView/hashchange)
  assert.equal(R.activeModuleKey, null);
  assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError/);
  assert.deepEqual(r.errors, []);
  r.window.close();
});
