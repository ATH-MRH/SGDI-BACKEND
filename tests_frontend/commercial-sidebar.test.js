const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const commercialRoutes = ['dashboard', 'clients', 'prospects', 'opportunites', 'calendrier', 'devis', 'visites', 'catalogue', 'tarifs', 'stats'].map(page => 'commercial/' + page);

function boot(t, route = 'commercial/dashboard') {
  const app = loadSgdiApp(['emptyDB', 'renderInternal', 'renderSidebar', 'syncSidebarActiveState', 'commercialSidebarItemAllowed', 'commercialSidebarIdentityHTML', 'applyLanguagePreference', 'sgdiSetLangMode', 'ensureCommercialSidebarAccessRules', 'commercialSidebarCurrentAccess', 'SGDI', 'logout']);
  assert.ifError(app.loadError);
  t.after(() => app.window.close());
  const w = app.window, api = app.T();
  w.setTimeout = () => 0;
  w.requestAnimationFrame = callback => { callback(); return 0; };
  app.dom.reconfigure({ url: 'https://dc.irongs.com/#/' + route });
  w.document.body.innerHTML = '<div id="app"></div><div id="modal-host"></div>';
  const db = api.emptyDB();
  api.setDb(db);
  const session = { username: 'DC001', nom: 'Direction Commerciale', role: 'ops', niveau: 'H2', transverse: 'commercial', societe: 'IRON GLOBAL SOLUTION', structuresAutorisees: ['commercial'] };
  api.setSession(session);
  api.setFullDataReady(true);
  api.setViewMode(true);
  w.sgdiBackendShouldUse = () => false;
  w.renderView = () => {};
  w.refreshOpsClientObservationsCount = () => {};
  const render = () => {
    api.renderInternal();
    const shell = w.document.querySelector('.sgdi-shell');
    assert.ok(shell, 'the production shell renders');
    return shell;
  };
  const nav = () => w.document.querySelector('#sidebar-nav');
  const link = route => nav().querySelector(`.nav-link[data-route="${route}"]`);
  const routes = () => [...nav().querySelectorAll('.nav-link[data-route]')].map(node => node.dataset.route);
  const go = route => w.history.replaceState(null, '', '#/' + route);
  return { ...app, w, api, db, session, render, nav, link, routes, go };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function serverSession(r, overrides = {}) {
  const session = { ...r.session, role: 'commercial', permissionsFromServer: true, effectiveModules: ['dc'], moduleAccessGlobal: false, ...overrides };
  r.api.setSession(session);
  r.w.sessionStorage.setItem('sgdi_api_token_v1', 'commercial-test-token');
  return session;
}

test('Commercial: every existing destination and authorized shared shortcut remains reachable', t => {
  const r = boot(t), shell = r.render();
  assert.ok(shell.classList.contains('sgdi-commercial-shell'));
  for (const route of [...commercialRoutes, 'agenda/dashboard', 'demandes_structure/dashboard']) {
    const link = r.link(route);
    assert.ok(link, route);
    assert.equal(r.routes().filter(value => value === route).length, 1, route + ' occurs exactly once');
    assert.equal(link.tagName, 'A', route + ' remains a native keyboard-accessible link');
    assert.equal(link.getAttribute('href'), '#/' + route);
    assert.ok(link.querySelector('.nav-ico svg'), route + ' has a vector icon');
  }
  assert.equal(r.nav().querySelector('.nav-group-lbl'), null, 'old category headings are removed at the source');
  assert.equal(r.routes().some(route => /^(admin|parametres)(\/|$)/.test(route)), false, 'no new Administration destination');
  assert.equal(shell.querySelector('.commercial-sidebar-logout').getAttribute('onclick'), 'logout()');
  assert.equal(shell.querySelector('.sidebar-return-button').getAttribute('onclick'), 'exitTransverseModule()');
});

test('Commercial: related links use native disclosures and current destinations open their group', t => {
  const r = boot(t, 'commercial/opportunites');
  r.render();
  for (const [key, children] of [['commercial', ['prospects', 'opportunites']], ['catalogue', ['catalogue', 'tarifs']]]) {
    const group = r.nav().querySelector(`[data-commercial-group="${key}"]`);
    assert.equal(group.tagName, 'DETAILS');
    const summary = group.querySelector(':scope > summary');
    assert.ok(summary);
    assert.equal(summary.getAttribute('aria-expanded'), String(group.open));
    assert.ok(group.querySelector('.commercial-submenu'));
    for (const child of children) assert.equal(r.link('commercial/' + child).closest('details'), group);
  }
  assert.equal(r.nav().querySelector('[data-commercial-group="commercial"]').open, true);
  assert.equal(r.link('commercial/opportunites').getAttribute('aria-current'), 'page');
  assert.ok(r.link('commercial/opportunites').classList.contains('active'));
});

test('Commercial: initial render after refresh opens catalogue for a nested Tarification destination', t => {
  const r = boot(t, 'commercial/tarifs/detail');
  r.render();
  const group = r.nav().querySelector('[data-commercial-group="catalogue"]');
  assert.equal(group.open, true);
  assert.equal(group.querySelector('summary').getAttribute('aria-expanded'), 'true');
  assert.ok(r.link('commercial/tarifs').classList.contains('active'));
  r.api.renderSidebar();
  assert.equal(r.nav().querySelector('[data-commercial-group="catalogue"]').open, true);
  assert.ok(r.link('commercial/tarifs').classList.contains('active'));
});

test('Commercial: in-place active-route synchronization opens the new destination group', t => {
  const r = boot(t);
  r.render();
  r.go('commercial/prospects');
  r.api.syncSidebarActiveState();
  assert.ok(r.link('commercial/prospects').classList.contains('active'));
  assert.equal(r.link('commercial/prospects').getAttribute('aria-current'), 'page');
  assert.equal(r.link('commercial/dashboard').hasAttribute('aria-current'), false);
  assert.equal(r.nav().querySelector('[data-commercial-group="commercial"]').open, true);
});

test('Commercial: real server counters include zero and update when the active society changes', t => {
  const r = boot(t);
  r.db.clients = [{ id: 'a', societe: 'IRON GLOBAL SOLUTION' }, { id: 'b', societe: 'SWORD CORPORATION' }];
  r.w.SGDI_SIDEBAR_STATS = { scope: { active_society: 'IRON GLOBAL SOLUTION' }, commercial: { clients_total: 83, prospects: 9, opportunities_open: 12, visits_total: 4 }, facturation: { quotes_total: 0 } };
  r.render();
  const count = page => r.link('commercial/' + page).querySelector('.nav-count')?.textContent;
  assert.equal(count('clients'), '83');
  assert.equal(count('prospects'), '9');
  assert.equal(count('opportunites'), '12');
  assert.equal(count('visites'), '4');
  assert.equal(count('devis'), '0');
  r.api.setSession({ ...r.session, societe: 'SWORD CORPORATION' });
  r.api.renderSidebar();
  assert.equal(count('clients'), '1', 'stale counters from the previous society are not reused');
  assert.equal(count('devis'), undefined, 'a quote count is not fabricated while its source is unavailable');
  r.w.SGDI_SIDEBAR_STATS = { scope: { active_society: 'SWORD CORPORATION' }, commercial: { clients_total: 21 }, facturation: { quotes_total: 5 } };
  r.api.renderSidebar();
  assert.equal(count('clients'), '21');
  assert.equal(count('devis'), '5');
});

test('Commercial: existing company-filtered fallback counters remain dynamic without hardcoded values', t => {
  const r = boot(t);
  r.db.clients = [{ societe: r.session.societe }, { societe: r.session.societe }, { societe: 'SWORD CORPORATION' }];
  r.db.prospects = [{ societe: r.session.societe }, { societe: 'SWORD CORPORATION' }];
  r.db.opportunites = [{ societe: r.session.societe, etape: 'nouveau' }, { societe: r.session.societe, etape: 'gagnee' }, { societe: 'SWORD CORPORATION', etape: 'nouveau' }];
  r.render();
  const count = page => r.link('commercial/' + page).querySelector('.nav-count')?.textContent;
  assert.equal(count('clients'), '2');
  assert.equal(count('prospects'), '1');
  assert.equal(count('opportunites'), '1');
  assert.equal(count('devis'), undefined);
  r.db.clients.push({ societe: r.session.societe });
  r.api.renderSidebar();
  assert.equal(count('clients'), '3');
});

test('Commercial: denied Tarification is omitted while other authorized routes and calendar remain visible', t => {
  const r = boot(t);
  r.db.droitsAcces = { 'commercial/tarifs:ops': false, 'admin:ops': false };
  const before = JSON.stringify(r.db.droitsAcces);
  r.render();
  assert.equal(r.link('commercial/tarifs'), null);
  for (const route of commercialRoutes.filter(route => route !== 'commercial/tarifs')) assert.ok(r.link(route), route);
  assert.ok(r.nav().querySelector('[data-commercial-group="catalogue"]'));
  assert.equal(JSON.stringify(r.db.droitsAcces), before, 'rendering does not change permissions');
  assert.equal(r.routes().some(route => route.startsWith('admin/')), false);
});

test('Commercial: a group with no authorized child is absent', t => {
  const r = boot(t);
  r.db.droitsAcces = { 'commercial/prospects:ops': false, 'commercial/opportunites:ops': false };
  r.render();
  assert.equal(r.link('commercial/prospects'), null);
  assert.equal(r.link('commercial/opportunites'), null);
  assert.equal(r.nav().querySelector('[data-commercial-group="commercial"]'), null);
  assert.ok(r.link('commercial/clients'));
});

test('Commercial: explicit calendar rights are honored although it inherits Commercial by default', t => {
  const r = boot(t);
  r.render();
  assert.ok(r.link('commercial/calendrier'));
  r.db.droitsAcces = { 'commercial/calendrier:ops': false };
  r.api.renderSidebar();
  assert.equal(r.link('commercial/calendrier'), null);
  assert.ok(r.link('commercial/dashboard'));
});

test('Commercial: read-only profile retains the same permitted reading destinations', t => {
  const r = boot(t);
  r.render();
  const before = r.routes();
  r.api.setSession({ ...r.session, niveau: 'H1', actionsAutorisees: ['read'] });
  r.api.renderSidebar();
  assert.deepEqual(r.routes(), before);
  assert.ok(r.link('commercial/clients'));
});

test('Commercial: authorized custom navigation, labels and saved order are not discarded or rewritten', t => {
  const r = boot(t);
  r.db.settings.sidebarCustom = { commercial: [{ label: 'DHL eSign', route: 'custom/commercial/dhl', group: 'AUTRES' }] };
  r.db.settings.sidebarOrder = { commercial: ['commercial/opportunites', 'commercial/prospects', 'custom/commercial/dhl'] };
  const before = JSON.stringify({ custom: r.db.settings.sidebarCustom, order: r.db.settings.sidebarOrder });
  r.render();
  assert.ok(r.link('custom/commercial/dhl'));
  assert.equal(r.link('custom/commercial/dhl').querySelector('.nav-label').textContent, 'DHL eSign');
  for (const route of commercialRoutes) assert.ok(r.link(route), route);
  const groupRoutes = [...r.nav().querySelectorAll('[data-commercial-group="commercial"] .nav-link')].map(el => el.dataset.route);
  assert.deepEqual(groupRoutes, ['commercial/opportunites', 'commercial/prospects']);
  assert.equal(JSON.stringify({ custom: r.db.settings.sidebarCustom, order: r.db.settings.sidebarOrder }), before);
});

test('Commercial: account identity is real and safely escaped', t => {
  const r = boot(t);
  const shell = r.render();
  const identity = shell.querySelector('.commercial-sidebar-user');
  assert.match(shell.querySelector('.commercial-sidebar-brand').textContent, /IRON GLOBAL/);
  assert.match(shell.querySelector('.commercial-sidebar-brand').textContent, /UN MONDE DE SOLUTIONS/);
  assert.match(identity.textContent, /Direction Commerciale|DC001/);
  assert.match(identity.textContent, /Cadre/i);
  r.api.setSession({ ...r.session, username: '<img src=x onerror=bad()>', nom: '<script>bad()</script>' });
  const host = r.w.document.createElement('div');
  host.innerHTML = r.api.commercialSidebarIdentityHTML();
  assert.equal(host.querySelector('img,script'), null);
  assert.match(host.textContent, /<script>bad\(\)<\/script>|<img src=x onerror=bad\(\)>/);
});

test('Commercial: other legacy modules keep their original navigation structure and handlers', t => {
  const r = boot(t, 'ops/dashboard');
  r.dom.reconfigure({ url: 'http://localhost/#/ops/dashboard' });
  r.api.setSession({ ...r.session, username: 'OPS01', transverse: 'ops', structuresAutorisees: ['ops', 'commercial'], role: 'ops' });
  const shell = r.render();
  assert.equal(shell.classList.contains('sgdi-commercial-shell'), false);
  assert.equal(shell.querySelector('[data-commercial-group]'), null);
  assert.ok(r.nav().querySelector('.nav-group-lbl'));
  const effectifs = r.link('effectif/recap');
  assert.ok(effectifs);
  assert.equal(effectifs.tagName, 'DIV');
  assert.equal(effectifs.getAttribute('onclick'), "sidebarNavigate(event,'effectif/recap')");
  assert.equal(shell.querySelector('.sidebar-user-logout button').getAttribute('onclick'), 'logout()');
});

test('Commercial: refreshing counters preserves keyboard focus on the fixed Return action', t => {
  const r = boot(t), shell = r.render();
  shell.querySelector('.sidebar-return-button').focus();
  assert.equal(r.w.document.activeElement, shell.querySelector('.sidebar-return-button'));
  r.api.renderSidebar();
  assert.equal(r.w.document.activeElement, shell.querySelector('.sidebar-return-button'));
});

test('Commercial: opening an already-active group from the compact rail keeps its submenu open', t => {
  const r = boot(t, 'commercial/opportunites');
  r.w.localStorage.setItem('sgdiSidebarCollapsed', '1');
  const shell = r.render();
  const group = r.nav().querySelector('[data-commercial-group="commercial"]');
  assert.equal(shell.classList.contains('sgdi-sidebar-collapsed'), true);
  assert.equal(group.open, true);
  group.querySelector('summary').click();
  assert.equal(shell.classList.contains('sgdi-sidebar-collapsed'), false);
  assert.equal(group.open, true, 'restoring the rail should reveal, not close, the requested submenu');
});

test('Commercial: server module restrictions hide a custom Administration link even for an ADM role', async t => {
  const r = boot(t);
  const restricted = serverSession(r, { role: 'ADM' });
  r.api.SGDI.auth.accessRules = async () => [];
  r.api.ensureCommercialSidebarAccessRules();
  await r.api.commercialSidebarCurrentAccess().pending;
  r.db.settings.sidebarCustom = { commercial: [{ label: 'Paramètres', route: 'admin/commercial-dc' }] };
  const savedCustom = JSON.stringify(r.db.settings.sidebarCustom);
  const shell = r.render();
  assert.ok(r.link('commercial/clients'));
  assert.equal(shell.querySelector('[data-route="admin/commercial-dc"]'), null, 'a role alone must not override server module restrictions');
  r.api.setSession({ ...restricted, effectiveModules: ['dc', 'admin'] });
  r.api.renderSidebar();
  const settings = shell.querySelector('#commercial-sidebar-settings [data-route="admin/commercial-dc"]');
  assert.ok(settings, 'the existing custom destination remains available when its module is authorized');
  assert.equal(settings.getAttribute('href'), '#/admin/commercial-dc');
  assert.equal(JSON.stringify(r.db.settings.sidebarCustom), savedCustom, 'visibility never deletes the saved menu item');
});

test('Commercial: FR/AR switching keeps visible labels and accessible names aligned without partial translation', t => {
  const r = boot(t), shell = r.render();
  const routesBefore = r.routes();
  r.api.sgdiSetLangMode('ar');
  assert.equal(r.w.document.documentElement.dir, 'rtl');
  assert.equal(r.link('commercial/clients').querySelector('.nav-label').textContent, 'الزبائن');
  assert.equal(r.link('commercial/devis').querySelector('.nav-label').textContent, 'عروض الأسعار');
  assert.equal(shell.querySelector('.commercial-sidebar-logout .nav-label').textContent, 'تسجيل الخروج');
  for (const label of shell.querySelectorAll('[data-commercial-label]')) {
    assert.equal(label.parentElement.getAttribute('aria-label'), label.textContent);
  }
  r.api.renderSidebar();
  r.api.applyLanguagePreference(r.nav().closest(".sidebar")); // the production refresh queues this callback
  assert.equal(r.link('commercial/clients').getAttribute('aria-label'), 'الزبائن');
  assert.equal(r.link('commercial/clients').querySelector('.nav-label').textContent, 'الزبائن');
  assert.equal(shell.querySelector('.sidebar-return-button .nav-label').textContent, 'العودة');
  r.api.sgdiSetLangMode('fr');
  assert.equal(r.w.document.documentElement.dir, 'ltr');
  for (const label of shell.querySelectorAll('[data-commercial-label]')) {
    assert.equal(label.textContent, label.dataset.commercialLabel);
    assert.equal(label.parentElement.getAttribute('aria-label'), label.textContent);
  }
  assert.deepEqual(r.routes(), routesBefore);
});

test('Commercial: server access rules are coalesced, read-only and allow the authorized commercial role', async t => {
  const r = boot(t), response = deferred();
  serverSession(r);
  r.db.droitsAcces = { 'commercial/tarifs:old-role': true };
  const savedRights = JSON.stringify(r.db.droitsAcces);
  let calls = 0;
  r.api.SGDI.auth.accessRules = () => { calls++; return response.promise; };
  assert.equal(r.api.ensureCommercialSidebarAccessRules(), false);
  const first = r.api.commercialSidebarCurrentAccess();
  assert.ok(first.pending);
  assert.equal(r.api.ensureCommercialSidebarAccessRules(), false);
  assert.equal(r.api.commercialSidebarCurrentAccess(), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  response.resolve([{ module_key: 'commercial/tarifs', role: 'commercial', allowed: false }]);
  await first.pending;
  assert.equal(r.api.ensureCommercialSidebarAccessRules(), true);
  r.render();
  assert.ok(r.link('commercial/clients'), 'server Commercial authorization is sufficient even when the role is not a legacy RH role');
  assert.ok(r.link('commercial/calendrier'));
  assert.equal(r.link('commercial/tarifs'), null, 'the current server restriction overrides an empty or stale legacy snapshot');
  r.api.renderSidebar();
  assert.equal(calls, 1, 'counter refreshes reuse the current session request');
  assert.equal(JSON.stringify(r.db.droitsAcces), savedRights, 'reading access rules does not write or replace the shared business snapshot');
});

test('Commercial: a late access-rules response after logout cannot restore the former navigation', async t => {
  const r = boot(t), response = deferred();
  serverSession(r);
  r.api.SGDI.auth.accessRules = () => response.promise;
  r.render();
  const pending = r.api.commercialSidebarCurrentAccess().pending;
  r.api.logout();
  const loggedOutMarkup = r.w.document.getElementById('app').innerHTML;
  response.resolve([{ module_key: 'commercial/clients', role: 'commercial', allowed: true }]);
  await pending;
  assert.equal(r.api.commercialSidebarCurrentAccess(), null);
  assert.equal(r.w.document.getElementById('app').innerHTML, loggedOutMarkup);
  assert.equal(r.w.document.querySelector('.sgdi-commercial-shell'), null);
});

for (const change of ['role', 'token', 'session-generation']) {
  test(`Commercial: a late access-rules response is ignored after changing ${change}`, async t => {
    const r = boot(t), oldResponse = deferred(), newResponse = deferred();
    const session = serverSession(r);
    let calls = 0;
    r.api.SGDI.auth.accessRules = () => (++calls === 1 ? oldResponse.promise : newResponse.promise);
    r.api.ensureCommercialSidebarAccessRules();
    const oldState = r.api.commercialSidebarCurrentAccess();
    await Promise.resolve();
    if (change === 'role') r.api.setSession({ ...session, role: 'ops' });
    if (change === 'token') r.w.sessionStorage.setItem('sgdi_api_token_v1', 'another-commercial-test-token');
    if (change === 'session-generation') r.api.bumpSessionGeneration();
    assert.equal(r.api.commercialSidebarCurrentAccess(), null, 'the prior identity context is invalid immediately');
    r.api.ensureCommercialSidebarAccessRules();
    const newState = r.api.commercialSidebarCurrentAccess();
    assert.notEqual(newState, oldState);
    await Promise.resolve();
    assert.equal(calls, 2);
    oldResponse.resolve([{ module_key: 'commercial/tarifs', role: 'commercial', allowed: false }]);
    await oldState.pending;
    assert.equal(r.api.commercialSidebarCurrentAccess(), newState, 'a former request cannot replace the current state');
    assert.equal(r.api.ensureCommercialSidebarAccessRules(), false, 'the current request still owns readiness');
    newResponse.resolve([]);
    await newState.pending;
    assert.equal(r.api.ensureCommercialSidebarAccessRules(), true);
    assert.equal(r.api.commercialSidebarItemAllowed({ route: 'commercial/tarifs' }), true, 'no former identity restriction leaks into the new session');
  });
}

test('Commercial: failed access-rules loading keeps navigation closed until an explicit successful retry', async t => {
  const r = boot(t), failed = deferred(), retried = deferred();
  serverSession(r);
  let calls = 0;
  r.api.SGDI.auth.accessRules = () => (++calls === 1 ? failed.promise : retried.promise);
  r.render();
  assert.deepEqual(r.routes(), [], 'unknown permissions do not briefly expose routes');
  const firstPending = r.api.commercialSidebarCurrentAccess().pending;
  failed.reject(new Error('Access rules unavailable'));
  await firstPending;
  assert.equal(r.api.ensureCommercialSidebarAccessRules(), false);
  assert.deepEqual(r.routes(), []);
  assert.match(r.nav().textContent, /Réessayer/i);
  assert.equal(calls, 1, 'ordinary rendering must not create an unbounded retry loop');
  assert.equal(r.api.ensureCommercialSidebarAccessRules({ retry: true }), false);
  const retryPending = r.api.commercialSidebarCurrentAccess().pending;
  await Promise.resolve();
  assert.equal(calls, 2);
  retried.resolve([]);
  await retryPending;
  assert.equal(r.api.ensureCommercialSidebarAccessRules(), true);
  r.api.renderSidebar();
  assert.ok(r.link('commercial/clients'));
});
