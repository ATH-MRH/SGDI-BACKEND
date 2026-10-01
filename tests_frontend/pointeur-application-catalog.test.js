// pointeur.irongs.com dans l'administration — tests jsdom sur le VRAI code client (sgdi-app.js +
// modules d'administration chargés par le registre). Seul le réseau est simulé.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const coreUtils = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'utils.js'), 'utf8');
const moduleRegistry = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'module-registry.js'), 'utf8');
const src = coreUtils + '\n' + moduleRegistry + '\n' + require('./read-client-source')();

const BIO = [
  { feature_key: 'biometric_status', label: 'Biométrie — état', description: 'État', applicable_actions: ['read'] },
  { feature_key: 'biometric_enrollment', label: 'Biométrie — enrôlement', description: 'Enrôlement supervisé', applicable_actions: ['create', 'update'] },
  { feature_key: 'biometric_admin', label: 'Biométrie — administration', description: 'Mode Test, terminaux', applicable_actions: ['validate', 'admin'] },
];
const CATALOG = {
  actions: ['read', 'create', 'update', 'validate', 'delete', 'export', 'unlock', 'admin', 'sign', 'pay', 'recruit', 'execute'],
  modules: [
    { module_key: 'drh', label: 'DRH', domain: 'drh.irongs.com', description: 'Ressources humaines', applications: [],
      features: [{ feature_key: 'employees', label: 'Employés', description: 'Fiches', applicable_actions: ['read'] }] },
    { module_key: 'attendance', label: 'Pointage', domain: 'pointage.irongs.com', description: 'Présences, absences et pointage',
      applications: [
        { module_key: 'pointage', label: 'Pointage', domain: 'pointage.irongs.com', description: 'Gestion des présences et du pointage' },
        { module_key: 'pointeur', label: 'Pointeur terrain', domain: 'pointeur.irongs.com', description: 'Scanner QR, terminal terrain et pointage facial' },
      ],
      features: [{ feature_key: 'qr_scanning', label: 'Pointage QR', description: 'QR', applicable_actions: ['read', 'create'] }, ...BIO] },
  ],
};

async function boot() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="sidebar-nav"></div><div id="view"></div><div id="modal-host"></div></body></html>',
    { url: 'https://atlas.irongs.com/#/admin/users', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
  window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; };
  window.BroadcastChannel = function () { this.postMessage = () => {}; this.close = () => {}; };
  window.AudioContext = function () {};
  window.requestAnimationFrame = (cb) => cb();
  window.scrollTo = () => {};
  window.setInterval = () => 0;
  window.eval(src + `;window.__T = { load: sgdiLoadAuthState, render: renderAdminUsers, openPermissions: openGranularPermissionsByKey,
    selectModule: granularSelectModule, openUser: openAdminUserModal, modules: ADMIN_LOGIN_MODULES,
    setDb: v => { db = v; }, setSession: v => { session = v; }, setAuth: v => { Object.assign(SGDI.auth, v); } };`);
  const T = window.__T;
  T.setDb({ users: [], settings: {}, niveauxAcces: [], droitsAcces: {}, sites: [] });
  T.setSession({ username: 'admin.test', role: 'admin' });
  window.sessionStorage.setItem('sgdi_api_token_v1', 'test-token');
  T.setAuth({
    listUsers: async () => [{ id: 34, username: 'PTG34', full_name: 'POINTEUR 34', role: 'agent', is_active: true, authorized_modules: ['pointeur', 'pointage'] }],
    accessRules: async () => [],
    granularFeatureCatalog: async () => CATALOG,
    userFeaturePermissions: async () => ({ username: 'PTG34', permissions: [{ module_key: 'attendance', feature_key: 'biometric_admin', action_key: 'validate' }] }),
  });
  await T.load();
  window.sessionStorage.removeItem('sgdi_api_token_v1');
  await window.SGDIModules.loadAndInitModule('administration');
  window.SGDIModules.markActiveModule('administration');
  return { dom, window, T, d: window.document };
}

test('modules accessibles : Pointage et Pointeur terrain sont deux applications distinctes, libellés explicites', async () => {
  const { dom, T, d } = await boot();
  try {
  const byKey = Object.fromEntries(T.modules.map((m) => [m.key, m]));
  assert.deepStrictEqual([byKey.pointage.label, byKey.pointage.host, byKey.pointage.description],
    ['Pointage', 'pointage.irongs.com', 'Gestion des présences et du pointage']);
  assert.deepStrictEqual([byKey.pointeur.label, byKey.pointeur.host, byKey.pointeur.description],
    ['Pointeur terrain', 'pointeur.irongs.com', 'Scanner QR, terminal terrain et pointage facial']);
  assert.strictEqual(T.modules.filter((m) => m.key === 'pointeur').length, 1);       // aucune seconde clé
  await T.openUser('');
  const label = (key) => d.querySelector(`input[name="module_${key}"]`).closest('label').textContent.replace(/\s+/g, ' ');
  assert.match(label('pointage'), /Pointage.*pointage\.irongs\.com.*Gestion des présences et du pointage/);
  assert.match(label('pointeur'), /Pointeur terrain.*pointeur\.irongs\.com.*Scanner QR, terminal terrain et pointage facial/);
  // Nouveau compte : aucune application cochée par défaut (fail closed), cases indépendantes.
  assert.strictEqual(d.querySelector('input[name="module_pointage"]').checked, false);
  assert.strictEqual(d.querySelector('input[name="module_pointeur"]').checked, false);
  } finally { dom.window.close(); }
});

test('permissions granulaires : domaine Pointage avec ses deux applications, permissions biométriques uniques', async () => {
  const { dom, T, d } = await boot();
  try {
  T.render(d.getElementById('view'));
  const button = Array.from(d.querySelectorAll('.admin-user-actions button')).find((b) => b.textContent === 'Permissions');
  button.click();
  await new Promise((r) => setTimeout(r, 0));
  const pointageButton = Array.from(d.querySelectorAll('.granular-module-list button')).find((b) => /Pointage/.test(b.textContent));
  assert.match(pointageButton.textContent, /pointage\.irongs\.com · pointeur\.irongs\.com/);
  T.selectModule('attendance');
  const head = d.querySelector('.granular-module-head').textContent.replace(/\s+/g, ' ');
  assert.match(head, /Pointage · pointage\.irongs\.com\s*Gestion des présences et du pointage/);
  assert.match(head, /Pointeur terrain · pointeur\.irongs\.com\s*Scanner QR, terminal terrain et pointage facial/);
  assert.match(head, /Modules accessibles/);
  const rows = Array.from(d.querySelectorAll('.granular-table tbody tr b')).map((b) => b.textContent);
  assert.deepStrictEqual(rows.filter((t) => t.startsWith('Biométrie')), ['Biométrie — état', 'Biométrie — enrôlement', 'Biométrie — administration']);
  assert.ok(d.querySelector('[data-module="attendance"][data-feature="biometric_admin"][data-action="validate"]').checked);
  assert.ok(d.querySelector('[data-module="attendance"][data-feature="biometric_enrollment"][data-action="validate"]').disabled);
  // Un module sans applications garde son affichage d'origine.
  T.selectModule('drh');
  assert.strictEqual(d.querySelector('.granular-applications'), null);
  } finally { dom.window.close(); }
});
