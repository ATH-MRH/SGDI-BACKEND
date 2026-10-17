// Portail autonome badge.irongs.com : configuration de domaine, accès (module dédié « badge »), interface dédiée.
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
  const { t, app } = portal(['badge']);
  const cfg = t.sgdiModuleHostConfig();
  assert.equal(cfg.key, 'badge');
  assert.equal(cfg.homeRoute, 'drh/badges/dashboard');
  assert.equal(cfg.skipPortal, true);
  assert.equal(JSON.stringify(cfg.sections.map(s => s.route)), JSON.stringify(SCREENS.map(s => 'drh/badges/' + s)));
  assert.equal(t.sgdiModuleHostConfigs().drh.key, 'drh');                          // DRH inchangé
  app.window.close();
});

test('access to the badge portal requires the dedicated « Studio Badges » module', () => {
  const allowed = portal(['badge']);
  assert.equal(allowed.t.canAccessModuleHostKey('badge'), true);
  allowed.app.window.close();
  for (const modules of [['drh'], ['commercial']]) {
    const refused = portal(modules);
    assert.equal(refused.t.canAccessModuleHostKey('badge'), false, modules[0]);   // DRH seul ne suffit plus
    refused.app.window.close();
  }
});

test('the user wizard offers « Studio Badges — badge.irongs.com » as its own module', () => {
  const app = loadSgdiApp(['ADMIN_LOGIN_MODULES'], { url: 'https://atlas.irongs.com/' });
  assert.equal(app.loadError, null);
  const card = app.T().ADMIN_LOGIN_MODULES.find(m => m.key === 'badge');
  assert.ok(card);
  assert.equal(card.label, 'Studio Badges');
  assert.equal(card.host, 'badge.irongs.com');
  app.window.close();
});

test('the portal renders its own shell: brand, eight entries, society, back to DRH, no DRH sidebar', () => {
  const { t, w, app } = portal(['badge'], '#/drh/badges/studio');
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
  const { t, w, app } = portal(['badge'], '#/drh/dashboard');
  t.renderInternal();
  assert.equal(w.location.hash, '#/drh/badges/dashboard');
  app.window.close();
});

// ── Phase B : DRH renvoie vers le portail ──
function hostApp(url) {
  const app = loadSgdiApp(['badgePortalUrl', 'openBadgeStudio', 'badgeStudioRoute', 'renderInternal'], { url });
  assert.equal(app.loadError, null);
  return app;
}

test('production DRH hosts point badge management to badge.irongs.com, never with a token', () => {
  const drh = hostApp('https://drh.irongs.com/#/drh/dashboard');
  const t = drh.T();
  assert.equal(t.badgePortalUrl('drh/badges/creer/42'), 'https://badge.irongs.com/#/drh/badges/creer/42');
  assert.equal(t.badgePortalUrl(), 'https://badge.irongs.com/#/drh/badges/dashboard');
  assert.equal(t.badgeStudioRoute({ backendId: 42, id: 'ag1', nom: 'X' }), 'drh/badges/creer/42');
  let opened = null;
  drh.window.open = (url, target, features) => { opened = [url, target, features]; return {}; };
  t.openBadgeStudio('drh/badges/creer/42');
  assert.equal(JSON.stringify(opened), JSON.stringify(['https://badge.irongs.com/#/drh/badges/creer/42', '_blank', 'noopener']));
  drh.window.close();
  for (const url of ['http://localhost:8000/', 'https://badge.irongs.com/']) {
    const other = hostApp(url);
    assert.equal(other.T().badgePortalUrl('drh/badges/creer/1'), null, url);   // développement et portail : écran servi sur place
    other.window.close();
  }
});

test('the portal opens the requested screen after login and society selection', () => {
  const app = loadSgdiApp(['renderInternal'], { url: 'https://badge.irongs.com/#/drh/badges/creer/42' });
  app.window.__BADGE_AUTONOMOUS_APP__ = true;
  app.window.sessionStorage.setItem('badgePortalTarget', '#/drh/badges/creer/42');
  const t = app.T();
  t.setSession({ username: 'DRH01', nom: 'Recette', role: 'drh', societe: 'IRON GLOBAL SÉCURITÉ', transverse: 'badge', permissionsFromServer: true, effectiveModules: ['badge'] });
  app.window.location.hash = '#/drh/badges/dashboard';
  app.window.renderView = () => {};
  t.renderInternal();
  assert.equal(app.window.location.hash, '#/drh/badges/creer/42');
  assert.equal(app.window.sessionStorage.getItem('badgePortalTarget'), null);          // utilisé une seule fois
  app.window.close();
});

test('sites carry their official code (badges) separately from the radio call sign', () => {
  const app = loadSgdiApp(['siteApiPayload', 'siteFromApi'], { url: 'https://ops.irongs.com/' });
  assert.equal(app.loadError, null);
  const t = app.T();
  const site = t.siteFromApi({ id: 4, name: 'HANGAR NORD', indicatif: 'RACHID (HAROUN-HICHEM)', official_code: 'ETP/DF/H01', equipment_plan: { codeOfficiel: 'ANCIEN' } });
  assert.equal(site.codeOfficiel, 'ETP/DF/H01');                                    // la colonne fait foi
  assert.equal(site.indicatif, 'RACHID (HAROUN-HICHEM)');
  const payload = t.siteApiPayload({ ...site, codeOfficiel: ' ETP/DF/H02 ' });
  assert.equal(payload.official_code, 'ETP/DF/H02');
  assert.equal(payload.indicatif, 'RACHID (HAROUN-HICHEM)');
  assert.equal(payload.equipment_plan.codeOfficiel, undefined);                     // aucune copie concurrente
  assert.equal(t.siteApiPayload({ ...site, codeOfficiel: '' }).official_code, null);
  app.window.close();
});
