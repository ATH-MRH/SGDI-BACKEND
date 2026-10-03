const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

function boot(t, route = 'ops/dashboard') {
  const r = loadSgdiApp([
    'emptyDB', 'renderInternal', 'atlasBrandHTML', 'atlasAccountHTML',
    'atlasLegacyTopbarHTML', 'workspaceTabsBarHTML', 'syncAdminUsersShell',
    'renderSidebar', 'syncSidebarActiveState', 'sidebarNavigate', 'toggleSgdiSidebar', 'applyLanguagePreference'
  ]);
  assert.ifError(r.loadError);
  t.after(() => r.window.close());
  const w = r.window;
  w.setTimeout = () => 0;
  w.requestAnimationFrame = () => 0;
  r.dom.reconfigure({ url: 'http://localhost/#/' + route });
  w.document.body.innerHTML = '<div id="app"></div><div id="modal-host"></div>';
  r.T().setDb(r.T().emptyDB());
  r.T().setSession({ username: 'ADM01', nom: 'Amel Test', role: 'ADM', adminSystem: true, transverse: 'ops', societe: 'Société Test' });
  r.T().setFullDataReady(true);
  r.T().setViewMode(true);
  w.sgdiBackendShouldUse = () => false;
  w.refreshOpsClientObservationsCount = () => {}; // asynchronous sidebar API boundary
  // The shell is exercised as shipped; individual business pages are outside this test.
  w.renderView = () => {};
  const go = route => w.history.replaceState(null, '', '#/' + route);
  return { ...r, w, go };
}

function renderShell(r) {
  r.T().renderInternal();
  const shell = r.w.document.querySelector('.sgdi-shell');
  assert.ok(shell, 'the real legacy shell is rendered');
  return shell;
}

function actionHandlers(node) {
  return [...node.querySelectorAll('[onclick]')].map(el => el.getAttribute('onclick'));
}

test('Atlas shell renders one shared brand, module context and compact account', t => {
  const r = boot(t), shell = renderShell(r);
  const brand = shell.querySelector('.sidebar .atlas-brand');
  const expected = r.w.document.createElement('div');
  expected.innerHTML = r.T().atlasBrandHTML();
  assert.ok(brand.isEqualNode(expected.firstElementChild));
  assert.equal(shell.querySelectorAll('.atlas-brand').length, 1);
  assert.equal(brand.querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.match(brand.textContent, /IRON GLOBAL/);
  assert.match(shell.querySelector('.sgdi-topbar-left .atlas-context').textContent, /DIRECTION OPS.*Société active : Société Test/);
  // Global Shell V4 : code utilisateur + rôle dans le header ; nom complet en info-bulle.
  const account = shell.querySelector('.sgdi-topbar-actions .atlas-account');
  assert.match(account.textContent, /ADM01/);
  assert.equal(account.querySelector('.atlas-account-name').getAttribute('title'), 'Amel Test');
  assert.equal(shell.classList.contains('atlas-shell-v4'), true);
  // Sidebar V3 : code utilisateur et rôle sur une ligne ; le nom complet reste en info-bulle.
  const profile = shell.querySelector('.atlas-sidebar-profile');
  assert.match(profile.textContent, /ADM01/);
  assert.equal(profile.getAttribute('title'), 'Amel Test');
  assert.equal(shell.classList.contains('atlas-sidebar-v3'), true);
  assert.equal(shell.querySelector('.atlas-sidebar-tab').getAttribute('onclick'), 'toggleSgdiSidebar()');
  assert.equal(shell.querySelector('.sidebar .atlas-sidebar-close').getAttribute('onclick'), 'closeSgdiMobileSidebar()');
  assert.equal(shell.querySelector('.sgdi-sidebar-toggle').getAttribute('onclick'), 'toggleSgdiSidebar()');
  assert.equal(shell.querySelector('.topbar-back-btn').getAttribute('onclick'), 'goBackSmart()');
  assert.equal(shell.querySelector('.sidebar-user-logout button').getAttribute('onclick'), 'logout()');
});

test('all workspace actions stay intact in one native tools disclosure in the header', t => {
  const r = boot(t), shell = renderShell(r);
  const expected = r.w.document.createElement('div');
  expected.innerHTML = r.T().workspaceTabsBarHTML();
  const tools = shell.querySelector('.sgdi-topbar details.atlas-workspace-tools');
  assert.ok(tools);
  assert.equal(tools.firstElementChild.tagName, 'SUMMARY');
  assert.equal(tools.firstElementChild.textContent, 'Outils');
  assert.deepEqual(actionHandlers(tools), actionHandlers(expected));
  assert.equal(shell.querySelectorAll('.ws-browser-chrome').length, 1);
  assert.equal(shell.querySelectorAll('#sgdi-global-save').length, 1);
  assert.equal(shell.querySelector('main .ws-browser-chrome'), null);
  assert.equal(shell.querySelectorAll('.topbar-notification-btn').length, 1);
  assert.equal(shell.querySelectorAll('.topbar-dialogue-btn').length, 1);
  assert.ok(tools.querySelector('[onclick="sgdiSaveCurrentChanges()"]'));
  assert.ok(tools.querySelector('[onclick="sgdiTopbarExcelAction()"]'));
  assert.ok(tools.querySelector('[onclick="window.refreshWorkspace()"]'));
});

test('tools uses native disclosure semantics without custom keyboard interception', t => {
  const r = boot(t), shell = renderShell(r);
  const tools = shell.querySelector('.atlas-workspace-tools'), summary = tools.firstElementChild;
  assert.equal(tools.open, false);
  assert.equal(summary.getAttribute('role'), null);
  assert.equal(summary.hasAttribute('tabindex'), false, 'native summary focusability is not overridden');
  assert.equal(summary.hasAttribute('onkeydown'), false);
  assert.equal(summary.hasAttribute('onclick'), false);
  summary.click();
  assert.equal(tools.open, true);
  summary.click();
  assert.equal(tools.open, false);
});

test('admin users moves and restores the same tools, handlers, open state and sibling order', t => {
  const r = boot(t), shell = renderShell(r);
  const topbar = shell.querySelector('.sgdi-topbar');
  const actions = topbar.querySelector('.sgdi-topbar-actions');
  const tools = actions.querySelector('.atlas-workspace-tools');
  const account = actions.querySelector('.atlas-account');
  const brand = shell.querySelector('.atlas-brand');
  const profile = shell.querySelector('.atlas-sidebar-profile');
  const save = tools.querySelector('#sgdi-global-save');
  const notification = tools.querySelector('.topbar-notification-btn');
  const input = r.w.document.createElement('input');
  input.value = 'État de saisie conservé';
  tools.appendChild(input);
  let clicks = 0;
  save.addEventListener('click', () => clicks++);
  tools.open = true;
  const controls = actionHandlers(tools);
  r.T().setSession({ username: 'ADM01', nom: 'Amel Test', role: 'ADM', adminSystem: true, transverse: 'admin' });
  r.go('admin/users');
  r.T().syncAdminUsersShell();
  assert.equal(shell.querySelector('.atlas-workspace-tools'), tools);
  assert.ok(topbar.querySelector('.admin-users-global-account').contains(tools));
  assert.equal(shell.querySelectorAll('#sgdi-global-save').length, 1);
  assert.equal(shell.querySelectorAll('.topbar-notification-btn').length, 1);
  assert.equal(shell.querySelector('.topbar-notification-btn'), notification);
  assert.equal(tools.open, true);
  assert.equal(input.value, 'État de saisie conservé');
  assert.deepEqual(actionHandlers(tools), controls);
  assert.equal(shell.querySelector('.atlas-brand').outerHTML, brand.outerHTML);
  save.click();
  assert.equal(clicks, 1, 'listeners still work while the tools node is moved');
  const search = shell.querySelector('#admin-users-global-search');
  search.value = 'Recherche conservée';
  r.T().syncAdminUsersShell();
  assert.equal(shell.querySelector('#admin-users-global-search'), search);
  assert.equal(search.value, 'Recherche conservée');
  assert.equal(shell.querySelector('.atlas-workspace-tools'), tools);
  r.go('admin/niveaux');
  r.T().syncAdminUsersShell();
  assert.equal(shell.querySelector('.sgdi-topbar-actions'), actions);
  assert.equal(actions.firstElementChild, tools);
  assert.equal(tools.nextElementSibling, account);
  assert.equal(shell.querySelector('.atlas-brand'), brand);
  assert.equal(shell.querySelector('.atlas-sidebar-profile'), profile);
  assert.equal(tools.open, true);
  assert.equal(input.value, 'État de saisie conservé');
  save.click();
  assert.equal(clicks, 2);
  assert.equal(topbar.__adminUsersOriginal, undefined);
  assert.equal(topbar.__adminUsersTools, undefined);
});

test('repeated Admin entry and exit never clones workspace IDs or drops controls', t => {
  const r = boot(t), shell = renderShell(r), tools = shell.querySelector('.atlas-workspace-tools');
  r.T().setSession({ username: 'ADM01', nom: 'Amel Test', role: 'ADM', adminSystem: true, transverse: 'admin' });
  for (let i = 0; i < 3; i++) {
    r.go('admin/users');
    r.T().syncAdminUsersShell();
    r.go('admin/droits');
    r.T().syncAdminUsersShell();
    assert.equal(shell.querySelector('.atlas-workspace-tools'), tools);
    assert.equal(shell.querySelectorAll('.ws-browser-chrome').length, 1);
    assert.equal(shell.querySelectorAll('#ws-tabs-bar').length, 1);
    assert.equal(shell.querySelectorAll('#sgdi-global-save').length, 1);
  }
});

test('header and account escape user-supplied identity and company text', t => {
  const r = boot(t);
  r.T().setSession({ username: 'TEST', nom: '<img src=x onerror=alert(1)>', role: 'ops' });
  const host = r.w.document.createElement('div');
  host.innerHTML = r.T().atlasLegacyTopbarHTML('<script>bad()</script>', 'A & B <img src=x>', true);
  assert.equal(host.querySelector('img,script'), null);
  assert.equal(host.querySelector('.sgdi-topbar-module-title').textContent, '<script>bad()</script>');
  assert.equal(host.querySelector('.atlas-context-label').textContent, 'A & B <img src=x>');
  assert.match(host.querySelector('.atlas-account').textContent, /TEST/);
  assert.equal(host.querySelector('.atlas-account-name').getAttribute('title'), '<img src=x onerror=alert(1)>', 'nom complet échappé en info-bulle');
  r.T().setSession(null);
  assert.equal(r.T().atlasAccountHTML(), '');
});

const adminSecondaryRoutes = [
  'admin/recrutement', 'admin/effectifs', 'admin/pointages', 'admin/postes',
  'admin/magasins', 'admin/articles', 'admin/document-models', 'admin/contrats',
  'admin/commercial-dc', 'admin/loans'
];

function adminSession(r, adminSystem = true) {
  r.T().setSession({ username: 'ADM01', nom: 'Amel Test', role: 'ADM', adminSystem, transverse: 'admin',
    permissionsFromServer: true, effectiveModules: ['admin'], moduleAccessGlobal: false });
}

test('Administration groups its existing business settings without removing admin-only access or custom links', t => {
  const r = boot(t, 'admin/users');
  adminSession(r);
  const settings = r.T().getDb().settings;
  settings.sidebarCustom = { admin: [{ label: 'DHL eSign Interne', route: 'custom/admin/dhl', group: 'RH' }] };
  settings.sidebarOrder = { admin: ['admin/loans', 'admin/postes', 'admin/users'] };
  const stored = JSON.stringify(settings);
  const shell = renderShell(r), nav = shell.querySelector('#sidebar-nav');
  const section = nav.querySelector('details.atlas-admin-secondary');
  assert.ok(section);
  assert.equal(section.firstElementChild.tagName, 'SUMMARY');
  assert.equal(section.firstElementChild.textContent, 'Paramètres métier');
  assert.equal(section.open, false, 'identity pages keep secondary settings closed');
  assert.equal(section.firstElementChild.hasAttribute('onclick'), false, 'native keyboard disclosure');
  assert.equal(section.firstElementChild.hasAttribute('onkeydown'), false);
  const links = [...section.querySelectorAll('.nav-link')];
  assert.deepEqual(links.map(el => el.dataset.route).sort(), [...adminSecondaryRoutes].sort());
  assert.equal(nav.querySelector('[data-route="admin/fiches"]'), null, 'Global Shell V4 : « Fiche de position » n\'est plus une entrée de menu');
  for (const route of adminSecondaryRoutes) {
    const el = section.querySelector(`[data-route="${route}"]`);
    assert.equal(nav.querySelectorAll(`[data-route="${route}"]`).length, 1);
    assert.equal(el.getAttribute('onclick'), `sidebarNavigate(event,'${route}')`);
    assert.match(el.getAttribute('onkeydown'), /Enter.*sidebarNavigate/);
    assert.equal(el.getAttribute('tabindex'), '0');
    assert.equal(el.querySelector('.nav-newtab-btn').getAttribute('onclick'), `event.stopPropagation();openInNewTab('${route}')`);
  }
  const custom = nav.querySelector('[data-route="custom/admin/dhl"]');
  assert.equal(custom.closest('details'), null, 'custom navigation stays visible');
  assert.equal(custom.querySelector('.nav-label').textContent, 'DHL eSign Interne');
  assert.equal(custom.getAttribute('aria-label'), 'DHL eSign Interne');
  assert.equal(nav.querySelector('[data-route="admin/users"] .nav-label').textContent, 'Utilisateurs');
  assert.equal(nav.querySelector('[data-route="admin/niveaux"] .nav-label').textContent, "Profils d'accès");
  const primaryRoutes = [...nav.querySelectorAll(':scope > .nav-link')].map(el => el.dataset.route);
  assert.equal(primaryRoutes.filter(route => route !== 'custom/admin/dhl' && route !== 'agenda/dashboard').length, 15,
    '15 primary Administration entries; existing agenda/custom shortcuts remain independent');
  assert.equal(JSON.stringify(settings), stored, 'rendering never rewrites stored navigation preferences');
});

test('secondary Administration destinations open on initial render and in-place navigation, including nested routes', t => {
  const r = boot(t, 'admin/users');
  adminSession(r);
  const shell = renderShell(r);
  for (const route of adminSecondaryRoutes) {
    r.go(route);
    r.T().renderSidebar();
    const section = shell.querySelector('.atlas-admin-secondary');
    assert.equal(section.open, true, route);
    assert.equal(section.querySelector('.nav-link.active').dataset.route, route);
  }
  r.go('admin/users');
  r.T().renderSidebar();
  const section = shell.querySelector('.atlas-admin-secondary');
  assert.equal(section.open, false);
  // La page des fiches reste atteignable (tableau de bord, liens) : son entrée parente s'active.
  for (const route of ['admin/fiches', 'admin/fiches/local-test-employee']) {
    r.go('admin/users'); r.T().syncSidebarActiveState();
    r.go(route);
    r.T().syncSidebarActiveState();
    assert.equal(section.open, true, 'existing sidebar reveals its active nested destination');
    assert.equal(section.querySelector('.nav-link.active').dataset.route, 'admin/effectifs', route);
  }
});

test('secondary Admin grouping does not alter general-administrator or DRH navigation', t => {
  const r = boot(t, 'admin/dashboard');
  adminSession(r, false);
  const shell = renderShell(r);
  assert.equal(shell.querySelector('.atlas-admin-secondary'), null);
  assert.ok(shell.querySelector('[data-route="admin/feed"]'));
  r.T().setSession({ username: 'RH01', nom: 'Test', role: 'ops', transverse: 'drh' });
  r.go('drh/dashboard');
  r.T().renderSidebar();
  assert.equal(shell.querySelector('.atlas-admin-secondary'), null);
  assert.equal(shell.querySelector('[data-route="fiches"]'), null, 'removed DRH shortcut stays removed');
  assert.equal(shell.querySelector('[data-route="effectif/recap"] .nav-label').textContent, 'GRH');
});

test('sentence-case navigation preserves original Arabic translations and French round trips', t => {
  const r = boot(t);
  const shell = renderShell(r), nav = shell.querySelector('#sidebar-nav');
  const effectifs = nav.querySelector('[data-route="effectif/recap"] .nav-label');
  const missions = nav.querySelector('[data-route="ops/missions"] .nav-label');
  assert.equal(effectifs.textContent, 'Effectifs');
  assert.equal(missions.textContent, 'Missions');
  r.w.localStorage.setItem('sgdiLangMode', 'ar');
  r.T().applyLanguagePreference(nav);
  assert.equal(effectifs.textContent, 'التعداد');
  assert.equal(missions.textContent, 'المهام');
  r.w.localStorage.setItem('sgdiLangMode', 'fr');
  r.T().applyLanguagePreference(nav);
  assert.equal(effectifs.textContent, 'Effectifs');
  assert.equal(missions.textContent, 'Missions');
  assert.equal(effectifs.dataset.atlasNavLabel, 'EFFECTIFS');
  assert.equal(effectifs.parentElement.dataset.route, 'effectif/recap');
});

function clickSidebarLink(r, route, options = {}) {
  const link = r.w.document.querySelector(`#sidebar-nav [data-route="${route}"]`);
  assert.ok(link, route);
  // outside-only jsdom does not run inline attributes: attach the actual shipped handler.
  link.addEventListener('click', r.w.eval(`(function(event){${link.getAttribute('onclick')}})`), { once: true });
  link.dispatchEvent(new r.w.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
}

test('mobile sidebar closes through its real click handler for both new and already-active destinations', t => {
  const r = boot(t);
  r.w.matchMedia = () => ({ matches: true });
  const shell = renderShell(r);
  for (const route of ['effectif/recap', 'effectif/recap']) {
    r.T().toggleSgdiSidebar();
    assert.equal(shell.classList.contains('sgdi-mobile-sidebar-open'), true);
    assert.equal(r.w.sessionStorage.getItem('sgdiMobileSidebarOpen'), '1');
    clickSidebarLink(r, route);
    assert.equal(r.w.location.hash, '#/' + route);
    assert.equal(shell.classList.contains('sgdi-mobile-sidebar-open'), false);
    assert.equal(shell.classList.contains('sgdi-sidebar-collapsed'), true);
    assert.equal(r.w.sessionStorage.getItem('sgdiMobileSidebarOpen'), '0');
    assert.equal(shell.querySelector('.sgdi-sidebar-toggle').getAttribute('aria-label'), 'Ouvrir le menu latéral');
  }
});

test('modifier clicks keep new-tab behavior and the current mobile menu; desktop navigation stays expanded', t => {
  const r = boot(t);
  let mobile = true;
  r.w.matchMedia = () => ({ matches: mobile });
  const shell = renderShell(r), opened = [];
  r.w.openInNewTab = route => opened.push(route);
  r.T().toggleSgdiSidebar();
  for (const key of ['ctrlKey', 'metaKey', 'shiftKey']) {
    clickSidebarLink(r, 'effectif/recap', { [key]: true });
    assert.equal(r.w.location.hash, '#/ops/dashboard');
    assert.equal(shell.classList.contains('sgdi-mobile-sidebar-open'), true);
    assert.equal(r.w.sessionStorage.getItem('sgdiMobileSidebarOpen'), '1');
  }
  assert.deepEqual(opened, ['effectif/recap', 'effectif/recap', 'effectif/recap']);
  mobile = false;
  shell.classList.remove('sgdi-mobile-sidebar-open');
  clickSidebarLink(r, 'effectif/recap');
  assert.equal(r.w.location.hash, '#/effectif/recap');
  assert.equal(shell.classList.contains('sgdi-sidebar-collapsed'), false);
});

test('Sidebar V3: tablet starts behind the tab, focus swaps between tab and collapse, Escape closes the phone drawer', t => {
  const r = boot(t);
  let query = '';
  // 1024 px: no saved preference ⇒ content first, navigation behind the thin tab.
  r.w.matchMedia = q => ({ matches: q === '(max-width: 1024px)' ? query !== 'desktop' : q === '(max-width: 767px)' ? query === 'phone' : false });
  query = 'tablet';
  let shell = renderShell(r);
  assert.equal(shell.classList.contains('sgdi-sidebar-collapsed'), true, 'tablet default is collapsed');
  const tab = shell.querySelector('.atlas-sidebar-tab');
  tab.focus();
  r.T().toggleSgdiSidebar();
  assert.equal(shell.classList.contains('sgdi-sidebar-collapsed'), false);
  assert.equal(r.w.document.activeElement, shell.querySelector('.sidebar .atlas-sidebar-collapse'), 'focus moves to the visible collapse control');
  r.T().toggleSgdiSidebar();
  assert.equal(shell.classList.contains('sgdi-sidebar-collapsed'), true);
  assert.equal(r.w.document.activeElement, tab, 'focus returns to the reopen tab');
  assert.equal(r.w.localStorage.getItem('sgdiSidebarCollapsed'), '1', 'explicit choice persists');
  // Phone drawer: Escape closes it and gives focus back to the hamburger.
  query = 'phone';
  r.w.localStorage.removeItem('sgdiSidebarCollapsed');
  shell = renderShell(r);
  r.T().toggleSgdiSidebar();
  assert.equal(shell.classList.contains('sgdi-mobile-sidebar-open'), true);
  r.w.document.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(shell.classList.contains('sgdi-mobile-sidebar-open'), false);
  assert.equal(r.w.document.activeElement, shell.querySelector('.sgdi-topbar .sgdi-sidebar-toggle'));
  // Every entry keeps its full label as a tooltip (one-line labels may be truncated).
  for (const link of shell.querySelectorAll('#sidebar-nav .nav-link')) assert.equal(link.getAttribute('title'), link.querySelector('.nav-label').textContent);
});
