// Portail autonome badge.irongs.com : configuration de domaine, accès (module DRH), interface dédiée.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const NAMES = ['sgdiModuleHostConfig', 'sgdiModuleHostConfigs', 'canAccessModuleHostKey', 'renderBadgeStandaloneShell', 'badgeStandaloneNavItems', 'renderInternal'];
const SCREENS = ['dashboard', 'creer', 'personnel', 'studio', 'modeles', 'lot', 'historique', 'parametres'];

function portal(modules, hash) {
  const app = loadSgdiApp(NAMES, { url: 'https://badge.irongs.com/' + (hash || '#/drh/badges/dashboard') });
  assert.equal(app.loadError, null);
  const t = app.T();
  t.setSession({ username: 'DRH01', nom: 'Recette DRH', role: 'drh', societe: 'IRON GLOBAL SÉCURITÉ', transverse: 'badge',
    permissionsFromServer: true, moduleAccessGlobal: false, effectiveModules: modules });
  app.window.__BADGE_AUTONOMOUS_APP__ = true;
  app.window.renderView = () => { app.window.document.getElementById('view').innerHTML = '<div class="bs-page" data-bs-screen="dashboard"></div>'; };
  return { app, t, w: app.window };
}

test('badge.irongs.com resolves to the badge portal configuration with the eight screens', () => {
  const { t, app } = portal(['drh']);
  const cfg = t.sgdiModuleHostConfig();
  assert.equal(cfg.key, 'badge');
  assert.equal(cfg.homeRoute, 'drh/badges/dashboard');
  assert.equal(cfg.skipPortal, true);
  assert.equal(JSON.stringify(cfg.sections.map(s => s.route)), JSON.stringify(SCREENS.map(s => 'drh/badges/' + s)));
  assert.equal(t.sgdiModuleHostConfigs().drh.key, 'drh');                          // DRH inchangé
  app.window.close();
});

test('access to the badge portal follows the DRH module', () => {
  const allowed = portal(['drh']);
  assert.equal(allowed.t.canAccessModuleHostKey('badge'), true);
  allowed.app.window.close();
  const refused = portal(['commercial']);
  assert.equal(refused.t.canAccessModuleHostKey('badge'), false);
  refused.app.window.close();
});

test('the portal renders its own shell: brand, eight entries, society, back to DRH, no DRH sidebar', () => {
  const { t, w, app } = portal(['drh'], '#/drh/badges/studio');
  t.renderBadgeStandaloneShell();
  const doc = w.document;
  assert.ok(doc.querySelector('.badge-portal-shell'));
  assert.match(doc.querySelector('.badge-portal-brand').textContent, /STUDIO BADGES/);
  const links = [...doc.querySelectorAll('.badge-portal-nav a')];
  assert.deepEqual(links.map(a => a.getAttribute('href')), SCREENS.map(s => '#/drh/badges/' + s));
  assert.equal(doc.querySelector('.badge-portal-nav a.is-active').getAttribute('href'), '#/drh/badges/studio');
  assert.match(doc.querySelector('.badge-portal-context').textContent, /IRON GLOBAL SÉCURITÉ/);
  assert.equal(doc.querySelector('.badge-portal-back').getAttribute('href'), 'https://drh.irongs.com/');
  assert.equal(doc.querySelector('#sidebar-nav .nav-link, .sidebar'), null);         // pas de menu DRH complet
  assert.ok(doc.querySelector('.badge-portal-main #view .bs-page'));
  assert.equal(doc.body.classList.contains('sgdi-view-mode'), false);             // aucun verrou de consultation
  app.window.close();
});

test('only badge routes are served on the portal host', () => {
  const { t, w, app } = portal(['drh'], '#/drh/dashboard');
  t.renderInternal();
  assert.equal(w.location.hash, '#/drh/badges/dashboard');
  app.window.close();
});
