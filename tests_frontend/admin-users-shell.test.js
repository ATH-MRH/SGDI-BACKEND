const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

// Exercise the real shared shell and API-to-display mapping. Browser/network
// boundaries are stubbed; no authorization or rendering function is replaced.
function boot(t) {
  const r = loadSgdiApp([
    'SGDI', 'sgdiLoadAuthState', 'moduleCountersRibbonHTML', 'normalizePageHeader',
    'adminUsersShellActive', 'syncAdminUsersShell', 'renderSidebar', 'renderAdmin',
    'sgdiApplyActiveEmployeeStyles'
  ]);
  assert.ifError(r.loadError);
  t.after(() => r.window.close());
  const { window: w } = r;
  r.dom.reconfigure({ url: 'http://localhost/#/admin/users' });
  w.setTimeout = () => 0;
  w.requestAnimationFrame = () => 0;
  r.T().setDb(new Proxy({ users: [], settings: {}, niveauxAcces: [], droitsAcces: {} }, {
    get(o, k) { return o[k] ?? (o[k] = []); }
  }));
  r.T().setSession({ username: 'ADM01', nom: 'Administration locale', role: 'ADM', adminSystem: true, transverse: 'admin' });
  r.T().setFullDataReady(true);
  r.T().setViewMode(true);
  const go = route => w.history.replaceState(null, '', '#/' + route);
  return { ...r, w, go };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function apiFixture(r, result) {
  r.w.sgdiAuthToken = () => 'local-test-token';
  r.T().SGDI.auth.listUsers = () => result;
  r.T().SGDI.auth.accessRules = async () => [];
}

test('users mapping preserves explicit global flags and never infers global access from empty lists', async t => {
  const r = boot(t);
  apiFixture(r, Promise.resolve([
    { id: 1, username: 'GLOBAL', global_society_access: true, module_access_global: true, authorized_societies: [] },
    { id: 2, username: 'NONE', global_society_access: false, module_access_global: false, authorized_societies: [] },
    { id: 3, username: 'LEGACY', authorized_societies: [] },
    { id: 4, username: 'STRING', global_society_access: 'true', module_access_global: 'true', authorized_societies: ['A'] }
  ]));
  await r.T().sgdiLoadAuthState();
  const rows = r.T().getDb().users;
  assert.equal(rows[0].globalSocietyAccess, true);
  assert.equal(rows[0].moduleAccessGlobal, true);
  for (const row of rows.slice(1)) {
    assert.equal(row.globalSocietyAccess, false, row.username);
    assert.equal(row.moduleAccessGlobal, false, row.username);
  }
  assert.deepEqual(Array.from(rows[3].societesAutorisees), ['A']);
});

test('users request reports loading until resolution, then clears its previous error', async t => {
  const r = boot(t), request = deferred();
  r.w.__sgdiAdminUsersLoadError = 'Previous failure';
  apiFixture(r, request.promise);
  const pending = r.T().sgdiLoadAuthState();
  assert.equal(r.w.__sgdiAdminUsersLoading, true);
  request.resolve([{ id: 10, username: 'RELOADED', is_active: false }]);
  await pending;
  assert.equal(r.w.__sgdiAdminUsersLoading, false);
  assert.equal(r.w.__sgdiAdminUsersLoadError, '');
  assert.ok(r.w.__sgdiAdminUsersLoadedAt > 0);
  assert.equal(r.T().getDb().users[0].actif, false);
});

test('failed users refresh keeps prior rows, exposes a retryable error and ends loading', async t => {
  const r = boot(t), request = deferred();
  const oldRows = [{ username: 'ALREADY_LOADED', actif: true }];
  r.T().getDb().users = oldRows;
  r.w.console.warn = () => {};
  apiFixture(r, request.promise);
  const pending = r.T().sgdiLoadAuthState();
  request.reject(new Error('API unavailable'));
  await pending;
  assert.equal(r.T().getDb().users, oldRows);
  assert.equal(r.w.__sgdiAdminUsersLoading, false);
  assert.match(r.w.__sgdiAdminUsersLoadError, /Impossible.*utilisateurs.*Réessayez/);
  assert.equal(r.w.__sgdiAdminUsersLoadedAt, undefined);
});

test('users ribbon is hidden only on its exact page while other Administration counters remain', t => {
  const r = boot(t);
  r.w.sgdiBackendModuleCounters = () => ({ utilisateurs: 12, societies_total: 2, access_rules: 3, alerts: 4, messages: 5, journal: 6 });
  assert.equal(r.T().moduleCountersRibbonHTML(), '');
  for (const route of ['admin/dashboard', 'admin/niveaux', 'admin/droits']) {
    r.go(route);
    const html = r.T().moduleCountersRibbonHTML();
    assert.match(html, /module-counters-ribbon/, route);
    assert.match(html, /UTILISATEURS/, route);
  }
  r.go('admin/users');
  assert.equal(r.T().moduleCountersRibbonHTML(), '');
});

test('shared header normalization leaves users actions and table intact', t => {
  const r = boot(t), view = r.w.document.getElementById('view');
  view.innerHTML = '<div class="admin-users-page"><header><h1>Gestion des utilisateurs</h1><button>Nouvel utilisateur</button></header><table><tbody><tr><td><button>Modifier</button></td></tr></tbody></table><footer><button>Page suivante</button></footer></div>';
  const before = view.innerHTML;
  const table = view.querySelector('table');
  r.T().normalizePageHeader(view);
  assert.equal(view.innerHTML, before);
  assert.equal(view.querySelector('table'), table);
  assert.equal(view.querySelector('.module-page-header-actions'), null);
  view.innerHTML = '<h1>Autre module</h1><p>Contexte</p><table></table>';
  r.T().normalizePageHeader(view);
  assert.match(view.querySelector('.module-page-header').textContent, /Autre module/);
});

test('employee status styling preserves users badges while still highlighting employee rows', t => {
  const r = boot(t), view = r.w.document.getElementById('view');
  view.innerHTML = '<section class="admin-users-page"><table><tbody><tr><td class="font-mono">ADM01</td><td><span class="admin-user-state active">Actif</span></td></tr></tbody></table></section><section class="employee-list"><table><tbody><tr><td class="font-mono">AG001</td><td><span class="pill">Actif</span></td></tr></tbody></table></section>';
  const users = view.querySelector('.admin-users-page'), before = users.innerHTML;
  r.T().sgdiApplyActiveEmployeeStyles(view);
  assert.equal(users.innerHTML, before, 'user badge colors and mixed-case label remain page-owned');
  assert.equal(users.querySelector('span').textContent, 'Actif');
  assert.equal(users.querySelector('span').getAttribute('style'), null);
  const employee = view.querySelector('.employee-list .pill');
  assert.equal(employee.textContent, 'ACTIF');
  assert.equal(employee.style.getPropertyValue('background'), 'rgb(22, 163, 74)');
  assert.equal(employee.style.getPropertyPriority('background'), 'important');
  assert.equal(view.querySelector('.employee-list .font-mono').style.getPropertyValue('color'), 'rgb(4, 120, 87)');
});

function shellFixture(r) {
  const shell = r.w.document.createElement('div');
  shell.className = 'sgdi-shell existing-module-class';
  shell.innerHTML = '<div class="sgdi-topbar"><button id="workspace-save">Enregistrer</button><input id="workspace-search"></div><aside><div class="sidebar-user-identity"><button id="original-identity">Compte métier</button></div></aside><main id="untouched-module">Données du module</main>';
  r.w.document.getElementById('app').appendChild(shell);
  return shell;
}

test('compact users shell is idempotent and restores original nodes, form state and event handlers', t => {
  const r = boot(t), shell = shellFixture(r);
  const save = shell.querySelector('#workspace-save'), input = shell.querySelector('#workspace-search');
  const identity = shell.querySelector('#original-identity'), module = shell.querySelector('#untouched-module');
  input.value = 'Recherche métier conservée';
  let clicks = 0;
  save.addEventListener('click', () => clicks++);
  r.T().syncAdminUsersShell();
  assert.equal(shell.classList.contains('sgdi-admin-users-shell'), true);
  assert.match(shell.querySelector('.sgdi-topbar').textContent, /Administration Système/);
  assert.match(shell.querySelector('.sidebar-user-identity').textContent, /IRON GLOBAL/);
  const search = shell.querySelector('#admin-users-global-search');
  search.value = 'Recherche globale en cours';
  r.T().syncAdminUsersShell();
  assert.equal(shell.querySelector('#admin-users-global-search'), search);
  assert.equal(search.value, 'Recherche globale en cours');
  assert.equal(shell.querySelector('#untouched-module'), module);
  r.go('ops/dashboard');
  r.T().syncAdminUsersShell();
  assert.equal(shell.classList.contains('sgdi-admin-users-shell'), false);
  assert.equal(shell.classList.contains('existing-module-class'), true);
  assert.equal(shell.querySelector('#workspace-save'), save);
  assert.equal(shell.querySelector('#workspace-search'), input);
  assert.equal(input.value, 'Recherche métier conservée');
  assert.equal(shell.querySelector('#original-identity'), identity);
  save.click();
  assert.equal(clicks, 1);
  r.T().syncAdminUsersShell();
  assert.equal(shell.querySelector('#workspace-save'), save);
});

test('users shell only activates for a system administrator on the users route', t => {
  const r = boot(t), shell = shellFixture(r);
  assert.equal(r.T().adminUsersShellActive(), true);
  r.T().setSession({ username: 'OPS', role: 'ops', adminSystem: false, transverse: 'ops' });
  assert.equal(r.T().adminUsersShellActive(), false);
  r.T().syncAdminUsersShell();
  assert.equal(shell.querySelector('#admin-users-global-search'), null);
  r.T().setSession({ username: 'ADMIN', role: 'ADM', adminSystem: false, transverse: 'admin' });
  assert.equal(r.T().adminUsersShellActive(), false);
  r.T().setSession({ username: 'ADMIN', role: 'ADM', adminSystem: true, transverse: 'admin' });
  r.T().syncAdminUsersShell();
  assert.ok(shell.querySelector('#admin-users-global-search'));
  r.T().setSession(null);
  r.T().syncAdminUsersShell();
  assert.ok(shell.querySelector('#workspace-save'), 'logout restores shared controls');
  assert.equal(shell.querySelector('#admin-users-global-search'), null);
});

test('Administration sidebar groups the three identity routes and keeps only real settings destinations', t => {
  const r = boot(t);
  r.T().renderSidebar();
  const nav = r.w.document.getElementById('sidebar-nav');
  let group = '';
  const links = new Map();
  for (const el of nav.children) {
    if (el.classList.contains('nav-group-lbl')) group = el.textContent;
    if (el.dataset.route) links.set(el.dataset.route, { group, el });
  }
  for (const [route, label] of [['admin/users', 'Utilisateurs'], ['admin/niveaux', "Profils d'accès"], ['admin/droits', 'Matrice des droits']]) {
    const item = links.get(route);
    assert.ok(item, route);
    assert.equal(item.group, 'IDENTITÉS & ACCÈS');
    assert.equal(item.el.querySelector('.nav-label').textContent, label);
    assert.equal(item.el.getAttribute('onclick'), `sidebarNavigate(event,'${route}')`);
    assert.equal(nav.querySelectorAll(`[data-route="${route}"]`).length, 1);
  }
  for (const route of ['admin/access_societes', 'sites/actifs', 'admin/modules', 'admin/access', 'admin/log']) {
    assert.equal(links.get(route)?.group, 'PARAMÈTRES', route);
    assert.ok(r.w.SGDIModules.moduleKeyForRoute(route.split('/')[0]), route);
  }
  assert.equal(links.has('admin/sessions'), false);
  assert.equal(links.has('admin/groups'), false);
  assert.equal(links.has('admin/audit-access'), false);
});

test('profile and rights sidebar routes still render their existing administration screens', t => {
  const r = boot(t), view = r.w.document.getElementById('view');
  for (const [sub, expected] of [['niveaux', /Profils d'accès/], ['droits', /Exceptions techniques d'accès/]]) {
    r.go('admin/' + sub);
    r.T().renderAdmin(view, sub);
    assert.match(view.querySelector('h1').textContent, expected);
    assert.doesNotMatch(view.textContent, /Accès refusé|indisponible/);
  }
});
