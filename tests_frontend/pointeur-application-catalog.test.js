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
// Forme réelle de /api/auth/granular-permissions/feature-catalog (voir
// tests/test_pointeur_application_access.py) : attendance présenté en DEUX entrées.
const CATALOG = {
  actions: ['read', 'create', 'update', 'validate', 'delete', 'export', 'unlock', 'admin', 'sign', 'pay', 'recruit', 'execute'],
  modules: [
    { entry_key: 'drh', module_key: 'drh', label: 'DRH', domain: 'drh.irongs.com', description: 'Ressources humaines', note: null,
      features: [{ feature_key: 'employees', label: 'Employés', description: 'Fiches', applicable_actions: ['read'] }] },
    { entry_key: 'ops', module_key: 'ops', label: 'Opérations', domain: 'ops.irongs.com', description: 'Exploitation', note: null,
      features: [{ feature_key: 'sites', label: 'Sites', description: 'Sites', applicable_actions: ['read'] }] },
    { entry_key: 'pointage', module_key: 'attendance', label: 'Gestion du pointage', domain: 'pointage.irongs.com',
      description: 'Présences, contrôle, corrections, feuilles, statistiques, paramétrage, supervision et administration biométrique', note: null,
      features: [{ feature_key: 'daily_sheets', label: 'Feuilles quotidiennes', description: 'Pointages', applicable_actions: ['read', 'validate'] }, ...BIO] },
    { entry_key: 'pointeur', module_key: 'attendance', label: 'Pointage', domain: 'pointeur.irongs.com',
      description: 'Opérations de pointage : QR, scanner, saisie terrain, tablette, smartphone, pointage facial et borne',
      note: 'Mode Test facial : accordé par Gestion du pointage → Biométrie — administration → Valider. Pointage facial de la borne (/borne) : identité de terminal, aucune permission utilisateur.',
      features: [{ feature_key: 'qr_scanning', label: 'Pointage QR', description: 'QR', applicable_actions: ['read', 'create', 'execute'] },
        { feature_key: 'manual_entry', label: 'Saisie manuelle', description: 'Saisie terrain', applicable_actions: ['read', 'create'] }] },
    { entry_key: 'material', module_key: 'material', label: 'Matériel', domain: 'materiel.irongs.com', description: 'Matériel', note: null,
      features: [{ feature_key: 'stores', label: 'Magasins', description: 'Magasins', applicable_actions: ['read'] }] },
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
  window.confirm = () => true;
  window.eval(src + `;window.__T = { load: sgdiLoadAuthState, render: renderAdminUsers, openPermissions: openGranularPermissionsByKey,
    selectModule: granularSelectModule, togglePermission: granularTogglePermission, save: saveGranularPermissions, openUser: openAdminUserModal, modules: ADMIN_LOGIN_MODULES,
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
    replaceUserFeaturePermissions: async (userId, permissions) => { window.__saved = { userId, permissions }; return { permission_count: permissions.length }; },
  });
  await T.load();
  window.sessionStorage.removeItem('sgdi_api_token_v1');
  await window.SGDIModules.loadAndInitModule('administration');
  window.SGDIModules.markActiveModule('administration');
  return { dom, window, T, d: window.document };
}

test('modules accessibles : « Gestion du pointage » (pointage.irongs.com) et « Pointage » (pointeur.irongs.com), mêmes clés', async () => {
  const { dom, T, d } = await boot();
  try {
  const byKey = Object.fromEntries(T.modules.map((m) => [m.key, m]));
  assert.deepStrictEqual([byKey.pointage.label, byKey.pointage.host, byKey.pointage.description],
    ['Gestion du pointage', 'pointage.irongs.com', 'Gestion des présences, contrôle, statistiques et administration du pointage']);
  assert.deepStrictEqual([byKey.pointeur.label, byKey.pointeur.host, byKey.pointeur.description],
    ['Pointage', 'pointeur.irongs.com', 'Pointage terrain : QR, tablette, smartphone, pointage facial et borne']);
  assert.ok(!T.modules.some((m) => /Pointeur terrain/.test(m.label)));
  assert.strictEqual(T.modules.filter((m) => m.key === 'pointeur').length, 1);       // aucune seconde clé
  await T.openUser('');
  const label = (key) => d.querySelector(`input[name="module_${key}"]`).closest('label').textContent.replace(/\s+/g, ' ');
  assert.match(label('pointage'), /^\s*Gestion du pointage\s*pointage\.irongs\.com/);
  assert.match(label('pointeur'), /^\s*Pointage\s*pointeur\.irongs\.com.*tablette, smartphone, pointage facial et borne/);
  // Nouveau compte : aucune application cochée par défaut (fail closed), cases indépendantes.
  assert.strictEqual(d.querySelector('input[name="module_pointage"]').checked, false);
  assert.strictEqual(d.querySelector('input[name="module_pointeur"]').checked, false);
  d.querySelector('input[name="module_pointage"]').click();
  assert.strictEqual(d.querySelector('input[name="module_pointage"]').checked, true);
  assert.strictEqual(d.querySelector('input[name="module_pointeur"]').checked, false);   // cocher l'un ne coche pas l'autre
  } finally { dom.window.close(); }
});

test('permissions granulaires : DEUX modules distincts « Gestion du pointage » et « Pointage » dans la colonne de gauche', async () => {
  const { dom, window, T, d } = await boot();
  try {
  T.render(d.getElementById('view'));
  const button = Array.from(d.querySelectorAll('.admin-user-actions button')).find((b) => b.textContent === 'Permissions');
  button.click();
  await new Promise((r) => setTimeout(r, 0));
  const items = Array.from(d.querySelectorAll('.granular-module-list button')).map((b) => ({
    entry: b.dataset.entry, icon: b.querySelector('i').textContent, label: b.querySelector('b').textContent, domain: b.querySelector('small').textContent }));
  // Ordre : … Opérations, [G] Gestion du pointage, [P] Pointage, Matériel …
  assert.deepStrictEqual(items.map((i) => i.label), ['DRH', 'Opérations', 'Gestion du pointage', 'Pointage', 'Matériel']);
  assert.deepStrictEqual(items.find((i) => i.entry === 'pointage'), { entry: 'pointage', icon: 'G', label: 'Gestion du pointage', domain: 'pointage.irongs.com' });
  assert.deepStrictEqual(items.find((i) => i.entry === 'pointeur'), { entry: 'pointeur', icon: 'P', label: 'Pointage', domain: 'pointeur.irongs.com' });
  // Échoue si les deux sont regroupés : aucune entrée ne porte deux domaines.
  assert.ok(items.every((i) => !/·|pointage\.irongs\.com.*pointeur\.irongs\.com/.test(i.domain)), JSON.stringify(items));
  assert.strictEqual(items.filter((i) => /pointeur\.irongs\.com/.test(i.domain)).length, 1);

  // [G] Gestion du pointage : fonctions de gestion + biométrie ; enrôlement → Créer.
  T.selectModule('pointage');
  const rowsG = () => Array.from(d.querySelectorAll('.granular-table tbody tr b')).map((b) => b.textContent);
  assert.deepStrictEqual(rowsG(), ['Feuilles quotidiennes', 'Biométrie — état', 'Biométrie — enrôlement', 'Biométrie — administration']);
  assert.ok(d.querySelector('[data-module="attendance"][data-feature="biometric_admin"][data-action="validate"]').checked);
  const enrollCreate = d.querySelector('[data-module="attendance"][data-feature="biometric_enrollment"][data-action="create"]');
  assert.ok(enrollCreate && !enrollCreate.disabled);
  T.togglePermission(Object.assign(enrollCreate, { checked: true }));

  // [P] Pointage : opérations de pointage seulement, note Mode Test / borne, aucune biométrie copiée.
  T.selectModule('pointeur');
  assert.match(d.querySelector('.granular-module-list button.active').textContent, /Pointage/);
  assert.deepStrictEqual(rowsG(), ['Pointage QR', 'Saisie manuelle']);
  const head = d.querySelector('.granular-module-head').textContent.replace(/\s+/g, ' ');
  assert.match(head, /Pointage\s*pointeur\.irongs\.com/);
  assert.match(d.querySelector('.granular-entry-note').textContent, /Mode Test facial.*Gestion du pointage → Biométrie — administration → Valider.*identité de terminal/);
  const qr = d.querySelector('[data-module="attendance"][data-feature="qr_scanning"][data-action="read"]');
  T.togglePermission(Object.assign(qr, { checked: true }));

  // Stockage inchangé : tout reste sous module_key « attendance ».
  await T.save();
  await new Promise((r) => setTimeout(r, 0));
  const saved = JSON.parse(JSON.stringify(window.__saved.permissions)).filter((p) => p.module_key === 'attendance').map((p) => `${p.feature_key}:${p.action_key}`).sort();
  assert.deepStrictEqual(saved, ['biometric_admin:validate', 'biometric_enrollment:create', 'qr_scanning:read']);
  assert.ok(window.__saved.permissions.every((p) => !['pointage', 'pointeur'].includes(p.module_key)));
  } finally { dom.window.close(); }
});
