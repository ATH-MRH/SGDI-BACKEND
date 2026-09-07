const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.js'), 'utf8');

test('le client expose uniquement les API administratives du lot 0.5-B', () => {
  assert.match(src, /granularPermissionCatalog:\(\)=>sgdiApi\("\/auth\/granular-permissions\/catalog"/);
  assert.match(src, /userModulePermissions:\(userId\)=>sgdiApi\("\/auth\/users\/"\+encodeURIComponent\(userId\)\+"\/module-permissions"/);
  assert.match(src, /replaceUserModulePermissions:\(userId,permissions\)=>sgdiApi/);
});

test('la matrice est explicitement préparée et non active', () => {
  assert.match(src, /Permissions préparées — non actives/);
  assert.match(src, /Les autorisations legacy restent applicables/);
  assert.match(src, /data-granular-permission/);
  assert.match(src, /Remplacer les permissions granulaires préparées/);
});

test('les douze actions sont présentées et envoyées comme couples explicites', () => {
  for (const action of ['read','create','update','validate','delete','export','unlock','admin','sign','pay','recruit','execute']) {
    assert.ok(src.includes(`${action}:`), `libellé absent pour ${action}`);
  }
  assert.match(src, /module_key:input\.dataset\.module,action_key:input\.dataset\.action/);
});

test('la gestion granulaire reste séparée de la sauvegarde legacy', () => {
  assert.match(src, /openGranularPermissionsByKey/);
  assert.match(src, /saveGranularPermissions/);
  assert.doesNotMatch(src, /authorized_modules:data\.permissions/);
  assert.doesNotMatch(src, /authorized_actions:data\.permissions/);
});

test('le parcours réel conserve backendId puis ouvre la modale granulaire', async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app"></div><div id="sidebar-nav"></div><div id="view"></div><div id="modal-host"></div></body></html>',
    { url: 'https://atlas.irongs.com/#/admin/users', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;
  window.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
  window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; };
  window.BroadcastChannel = function () { this.postMessage = () => {}; this.close = () => {}; };
  window.AudioContext = function () {};
  window.webkitAudioContext = window.AudioContext;
  window.requestAnimationFrame = callback => callback();
  window.scrollTo = () => {};
  window.setInterval = () => 0;
  window.confirm = () => true;

  const expose = `
    ;window.__lot05b = {
      load: sgdiLoadAuthState,
      render: renderAdminUsers,
      open: openGranularPermissionsByKey,
      getDb: () => db,
      setDb: value => { db = value; },
      setSession: value => { session = value; },
      setAuth: value => { Object.assign(SGDI.auth, value); }
    };
  `;
  window.eval(src + expose);
  const T = window.__lot05b;
  T.setDb({ users: [], settings: {}, niveauxAcces: [], droitsAcces: {} });
  T.setSession({ username: 'admin.test', role: 'admin' });
  window.sessionStorage.setItem('sgdi_api_token_v1', 'test-token');

  const calls = [];
  T.setAuth({
    listUsers: async () => [{ id: 42, username: 'backend.user', full_name: 'Backend User', role: 'agent', is_active: true }],
    accessRules: async () => [],
    granularPermissionCatalog: async () => {
      calls.push('catalog');
      return { modules: ['drh'], actions: ['read'] };
    },
    userModulePermissions: async userId => {
      calls.push(`permissions:${userId}`);
      return { username: 'backend.user', permissions: [], authorized_societies: [], authorized_sites: [] };
    }
  });

  await T.load();
  assert.strictEqual(T.getDb().users[0].backendId, 42, 'u.id doit être conservé comme backendId');

  // Empêche uniquement le rafraîchissement automatique du rendu : le chargement réel vient d'être testé.
  window.sessionStorage.removeItem('sgdi_api_token_v1');
  T.render(window.document.getElementById('view'));
  const permissionsButton = Array.from(window.document.querySelectorAll('.admin-user-actions button'))
    .find(button => button.textContent === 'Permissions');
  assert.ok(permissionsButton, 'le bouton Permissions doit être créé lorsque backendId existe');

  permissionsButton.click();
  await new Promise(resolve => window.setTimeout(resolve, 0));
  assert.deepStrictEqual(calls, ['catalog', 'permissions:42']);
  assert.match(window.document.getElementById('modal-host').textContent, /Permissions préparées — non actives/);

  T.setDb({ users: [{ username: 'legacy.user', nom: 'Legacy User', role: 'agent', actif: true }], settings: {}, niveauxAcces: [], droitsAcces: {} });
  assert.doesNotThrow(() => T.render(window.document.getElementById('view')));
  assert.ok(!Array.from(window.document.querySelectorAll('.admin-user-actions button')).some(button => button.textContent === 'Permissions'));
  assert.match(src, /function openAdminUserModal\(username\)/, 'le formulaire legacy Modifier un utilisateur reste distinct');

  dom.window.close();
});
