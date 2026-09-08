const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const coreUtils = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'utils.js'), 'utf8');
const moduleRegistry = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'module-registry.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.js'), 'utf8');
const src = coreUtils + '\n' + moduleRegistry + '\n' + appSrc;
const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.css'), 'utf8');

test('le client expose uniquement les API administratives du lot 0.5-B', () => {
  assert.match(src, /granularPermissionCatalog:\(\)=>sgdiApi\("\/auth\/granular-permissions\/catalog"/);
  assert.match(src, /userModulePermissions:\(userId\)=>sgdiApi\("\/auth\/users\/"\+encodeURIComponent\(userId\)\+"\/module-permissions"/);
  assert.match(src, /replaceUserModulePermissions:\(userId,permissions\)=>sgdiApi/);
  assert.match(src, /granularFeatureCatalog:\(\)=>sgdiApi\("\/auth\/granular-permissions\/feature-catalog"/);
  assert.match(src, /userFeaturePermissions:\(userId\)=>sgdiApi\("\/auth\/users\/"\+encodeURIComponent\(userId\)\+"\/feature-permissions"/);
  assert.match(src, /replaceUserFeaturePermissions:\(userId,permissions\)=>sgdiApi/);
});

test('la matrice est explicitement préparée et non active', () => {
  assert.match(src, /Permissions préparées — non actives/);
  assert.match(src, /Les autorisations legacy restent applicables/);
  assert.match(src, /data-feature-permission/);
  assert.match(src, /Remplacer les permissions granulaires préparées/);
});

test('les douze actions sont présentées et envoyées comme couples explicites', () => {
  for (const action of ['read','create','update','validate','delete','export','unlock','admin','sign','pay','recruit','execute']) {
    assert.ok(src.includes(`${action}:`), `libellé absent pour ${action}`);
  }
  assert.match(src, /return\{module_key,feature_key,action_key\}/);
});

test('la gestion granulaire reste séparée de la sauvegarde legacy', () => {
  assert.match(src, /openGranularPermissionsByKey/);
  assert.match(src, /saveGranularPermissions/);
  assert.doesNotMatch(src, /authorized_modules:data\.permissions/);
  assert.doesNotMatch(src, /authorized_actions:data\.permissions/);
});

test('l’interface validée est plein écran et responsive sans commande d’activation', () => {
  assert.match(src, /Rechercher un module\.\.\./);
  assert.match(src, /Rechercher une fonctionnalité\.\.\./);
  assert.match(src, /Sélectionner tout le module/);
  assert.match(src, /Réinitialiser ce module/);
  assert.match(src, /Enregistrer \(préparer\)/);
  assert.doesNotMatch(src, /Valider et activer/);
  assert.match(css, /\.granular-layout\{display:grid;grid-template-columns:270px/);
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /@media\(max-width:620px\)/);
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
      toggleFeature: granularToggleFeature,
      toggleModule: granularToggleModule,
      selectModule: granularSelectModule,
      setFeatureSearch: granularSetFeatureSearch,
      setFeatureFilter: granularSetFeatureFilter,
      setModuleSearch: granularSetModuleSearch,
      resetModule: granularResetModule,
      save: saveGranularPermissions,
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
    granularFeatureCatalog: async () => {
      calls.push('catalog');
      return {
        actions: ['read', 'create', 'update', 'validate', 'delete', 'export', 'unlock', 'admin', 'sign', 'pay', 'recruit', 'execute'],
        modules: [
          { module_key: 'drh', label: 'DRH', domain: 'drh.irongs.com', description: 'Ressources humaines', features: [
            { feature_key: 'employees', label: 'Employés', description: 'Gestion des fiches employés', applicable_actions: ['read', 'create', 'update'] },
            { feature_key: 'contracts', label: 'Contrats', description: 'Contrats de travail', applicable_actions: ['read', 'sign'] }
          ] },
          { module_key: 'ops', label: 'Opérations', domain: 'ops.irongs.com', description: 'Opérations', features: [
            { feature_key: 'sites', label: 'Sites', description: 'Sites opérationnels', applicable_actions: ['read', 'update'] }
          ] }
        ]
      };
    },
    userFeaturePermissions: async userId => {
      calls.push(`permissions:${userId}`);
      return { username: 'backend.user', permissions: [{ module_key: 'drh', feature_key: 'employees', action_key: 'read' }], authorized_societies: [], authorized_sites: [] };
    },
    replaceUserFeaturePermissions: async (userId, permissions) => {
      calls.push({ userId, permissions });
      return { permission_count: permissions.length };
    },
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
  assert.match(window.document.getElementById('modal-host').textContent, /Employés/);
  assert.ok(window.document.querySelector('[data-module="drh"][data-feature="employees"][data-action="read"]').checked, 'la permission existante doit être cochée');
  assert.ok(window.document.querySelector('[data-feature="employees"][data-action="pay"]').disabled, 'une action non applicable doit être désactivée');

  const employeesAll = window.document.querySelector('.granular-feature-all[data-feature="employees"]');
  T.toggleFeature('employees', true);
  assert.ok(Array.from(window.document.querySelectorAll('[data-feature="employees"]:not(:disabled)')).every(input => input.checked));
  assert.ok(window.document.getElementById('granular-module-all').indeterminate, 'la sélection partielle du module doit être indéterminée');

  const moduleAll = window.document.getElementById('granular-module-all');
  T.toggleModule(true);
  assert.ok(Array.from(window.document.querySelectorAll('[data-feature-permission]:not(:disabled)')).every(input => input.checked));
  assert.match(window.document.querySelector('.granular-counters').textContent, /5 autorisations sélectionnées/);

  const opsButton = Array.from(window.document.querySelectorAll('.granular-module-list button')).find(button => /Opérations/.test(button.textContent));
  assert.ok(opsButton);
  T.selectModule('ops');
  assert.match(window.document.querySelector('.granular-table tbody').textContent, /Sites/);
  assert.doesNotMatch(window.document.querySelector('.granular-table tbody').textContent, /Employés/);
  T.setFeatureFilter('selected');
  assert.match(window.document.querySelector('.granular-table tbody').textContent, /Aucune fonctionnalité/);
  T.setFeatureFilter('all');

  T.setFeatureSearch('introuvable');
  assert.match(window.document.querySelector('.granular-table tbody').textContent, /Aucune fonctionnalité/);

  T.setModuleSearch('DRH');
  assert.strictEqual(window.document.querySelectorAll('.granular-module-list button').length, 1);

  // Revenir sur DRH et vérifier le payload exact module / fonctionnalité / action.
  T.selectModule('drh');
  T.resetModule();
  assert.match(window.document.querySelector('.granular-counters').textContent, /0 autorisations sélectionnées/);
  T.toggleFeature('employees', true);
  await T.save();
  await new Promise(resolve => window.setTimeout(resolve, 0));
  const saveCall = calls.find(item => typeof item === 'object');
  assert.strictEqual(saveCall.userId, 42);
  assert.ok(saveCall.permissions.length > 0);
  assert.ok(saveCall.permissions.every(item => item.module_key && item.feature_key && item.action_key));

  T.setDb({ users: [{ username: 'legacy.user', nom: 'Legacy User', role: 'agent', actif: true }], settings: {}, niveauxAcces: [], droitsAcces: {} });
  assert.doesNotThrow(() => T.render(window.document.getElementById('view')));
  assert.ok(!Array.from(window.document.querySelectorAll('.admin-user-actions button')).some(button => button.textContent === 'Permissions'));
  assert.match(src, /function openAdminUserModal\(username\)/, 'le formulaire legacy Modifier un utilisateur reste distinct');

  dom.window.close();
});
