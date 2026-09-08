const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');
const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/frontend-phase2b-2g-inventory.json')));
const phase2hInventory = path.join(__dirname, '../docs/frontend-phase2h-inventory.json');
if (fs.existsSync(phase2hInventory)) Object.assign(inventory, JSON.parse(fs.readFileSync(phase2hInventory)));
const tick = () => new Promise(resolve => setTimeout(resolve, 150));

function boot() {
  const ctx = loadSgdiApp(['renderView'], { lazyModules: true });
  assert.ifError(ctx.loadError);
  ctx.dom.reconfigure({ url: 'http://localhost/' });
  const { window: w, T } = ctx;
  for (const id of ['sidebar-nav', 'view']) w.document.getElementById('app').appendChild(w.document.getElementById(id));
  const errors = [], requests = [], downloads = [], timers = new Map();
  w.addEventListener('error', e => { errors.push(e.error || e.message); e.preventDefault(); });
  w.console.error = (...args) => errors.push(args);
  w.fetch = url => { requests.push(String(url)); return Promise.resolve({ ok: true, json: async () => ({}), text: async () => '' }); };
  let timer = 10000;
  w.setInterval = (fn, ms) => { const id = ++timer; timers.set(id, { fn, ms }); return id; };
  w.clearInterval = id => timers.delete(id);
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
  T().setSession({ username: 'tester', role: 'admin', access_level: 'H5', authorized_modules: ['all'], transverse: 'admin', societe: '' });
  T().setFullDataReady(true);
  T().setViewMode(true);
  const go = hash => { w.history.replaceState(null, '', hash); assert.equal(T().renderView(), undefined); };
  return { ...ctx, errors, requests, downloads, timers, go, view: () => w.document.getElementById('view') };
}

test('campagne : vrais scripts lazy, parcours répété ×3, aucun doublon ni erreur', async () => {
  const r = boot(), R = r.window.SGDIModules;
  const routeKeys = Object.entries(R.MODULE_ROUTES);
  for (const route of ['sites', 'incidents', 'facturation', 'commercial', 'agenda', 'portail', 'fiches', 'badge']) {
    if (!routeKeys.some(([key]) => key === route)) routeKeys.push([route, null]);
  }
  assert.equal(r.downloads.length, 0);
  for (const [key] of Object.entries(inventory)) assert.equal(R.isModuleRegistered(key), false);
  const inits = {}, destroys = {};
  const register = R.registerModule;
  R.registerModule = def => {
    const init = def.init || (() => {}), destroy = def.destroy || (() => {});
    return register({ ...def, init() { inits[def.key] = (inits[def.key] || 0) + 1; return init(); },
      destroy() { destroys[def.key] = (destroys[def.key] || 0) + 1; return destroy(); } });
  };
  for (let turn = 0; turn < 3; turn++) {
    for (const [route, key] of routeKeys) {
      r.go('#/' + route);
      await tick();
      assert.equal(R.activeModuleKey, key, route);
      assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError|Module indisponible|Chargement du module/);
      r.go('#/dashboard'); await tick();
      assert.equal(R.activeModuleKey, null);
      assert.equal(r.timers.size, 0, 'aucun timer de domaine après ' + route);
    }
  }
  assert.equal(new Set(r.downloads).size, r.downloads.length, 'chaque script téléchargé une fois');
  for (const key of new Set(routeKeys.map(([, key]) => key))) assert.equal(inits[key], destroys[key]);
  assert.deepEqual(r.errors, []);
});

test('campagne : navigation rapide, dernier module demandé gagne', async () => {
  const r = boot(), R = r.window.SGDIModules;
  const routes = Object.keys(R.MODULE_ROUTES);
  for (const route of routes) r.go('#/' + route);
  await tick();
  const last = routes.at(-1);
  assert.equal(R.activeModuleKey, R.MODULE_ROUTES[last]);
  for (const row of R.moduleRegistrySnapshot()) {
    if (row.key !== R.MODULE_ROUTES[last]) assert.equal(row.initialized, false, 'aucune init obsolète : ' + row.key);
  }
  assert.equal(new Set(r.downloads).size, r.downloads.length);
  r.go('#/dashboard'); await tick();
  assert.equal(R.activeModuleKey, null);
  assert.deepEqual(r.errors, []);
});

test('Pointage : QR, planning et saisie ; timers arrêtés même après un démarrage différé', async () => {
  if (!inventory.pointage) return;
  const r = boot();
  const values = { agents: [{ id: 'a1', nom: 'TEST', prenom: 'Agent', statut: 'actif', societe: '', matricule: '001' }],
    sites: [{ id: 's1', backendId: 's1', nom: 'Site test', actif: true, societe: '' }] };
  r.T().setDb(new Proxy(values, { get(target, key) { return target[key] ?? (target[key] = []); } }));
  for (const sub of ['qr', 'planning', 'saisie', 'auto', 'feuille']) {
    r.go('#/pointage/' + sub); await tick();
    assert.equal(r.window.SGDIModules.activeModuleKey, 'pointage');
    assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError|Module indisponible/);
    assert.ok(r.timers.size >= 1, 'timer de relève actif');
    r.go('#/dashboard'); await tick();
    assert.equal(r.timers.size, 0, 'arrêt immédiat des timers : ' + sub);
  }
  r.go('#/pointage/qr');
  await new Promise(resolve => setTimeout(resolve, 5));
  r.go('#/dashboard'); await tick();
  assert.equal(r.timers.size, 0, 'timeout QR obsolète ne redémarre rien');
  assert.deepEqual(r.errors, []);
});

test('OPS : le menu missions ne duplique pas le listener et destroy le retire', async () => {
  if (!inventory.ops) return;
  const r = boot(), w = r.window;
  r.T().setDb(new Proxy({ missions: [{ id: 'mission-test', agentId: 'agent-test', workflowStatus: 'transmise_ops' }] },
    { get(target, key) { return target[key] ?? (target[key] = []); } }));
  const listeners = new Set();
  const add = w.document.addEventListener.bind(w.document), remove = w.document.removeEventListener.bind(w.document);
  w.document.addEventListener = (type, fn, opts) => { if (fn?.name === 'opsMissionDismiss') listeners.add(fn); return add(type, fn, opts); };
  w.document.removeEventListener = (type, fn, opts) => { listeners.delete(fn); return remove(type, fn, opts); };
  r.go('#/ops/missions'); await tick();
  const button = w.document.createElement('button'); r.view().appendChild(button);
  w.openOpsMissionActions(button, 'mission-test');
  w.openOpsMissionActions(button, 'mission-test');
  await tick();
  assert.equal(listeners.size, 1);
  assert.equal(w.document.querySelectorAll('.ops-mission-row-menu').length, 1);
  r.go('#/dashboard'); await tick();
  assert.equal(listeners.size, 0);
  assert.equal(w.document.querySelectorAll('.ops-mission-row-menu').length, 0);
  assert.equal(r.timers.size, 0);
  assert.deepEqual(r.errors, []);
});

test('Matériel : listes, magasins, catalogue, formulaires et mouvements après lazy load', async () => {
  if (!inventory.material) return;
  const r = boot();
  for (const sub of ['inventaire', 'magasins', 'magasin-nouveau', 'articles', 'article-nouveau', 'mouvements', 'dotation', 'reversement']) {
    r.go('#/materiel/' + sub); await tick();
    assert.equal(r.window.SGDIModules.activeModuleKey, 'material');
    assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError|Module indisponible/);
    if (sub.endsWith('nouveau')) assert.ok(r.view().querySelector('form'), sub + ' formulaire présent');
    r.go('#/dashboard'); await tick();
  }
  assert.equal(r.downloads.length, 4);
  assert.deepEqual(r.errors, []);
});

test('Recrutement : formulaire lazy et navigation annulée conservent la saisie', async () => {
  if (!inventory.recruitment) return;
  const r = boot(), w = r.window;
  r.go('#/recrutement/nouveau'); await tick();
  const form = w.document.getElementById('candidat-form');
  assert.ok(form, 'formulaire candidat réellement rendu');
  const input = form.querySelector('[name="nom"]');
  assert.ok(input); input.value = 'SAISIE À CONSERVER';
  r.T().setViewMode(false); r.T().setFormUnsaved(true);
  w.navigate('dashboard');
  assert.equal(w.location.hash, '#/recrutement/nouveau');
  assert.ok(w.document.getElementById('sgdi-nav-guard'));
  w._sgdiNavGuardCancel();
  assert.equal(input.value, 'SAISIE À CONSERVER');
  assert.equal(w.document.getElementById('candidat-form'), form);
  r.T().setFormUnsaved(false); r.T().setViewMode(true);
  r.go('#/dashboard'); await tick();
  r.go('#/recrutement'); await tick();
  assert.equal(w.SGDIModules.activeModuleKey, 'recruitment');
  assert.deepEqual(r.errors, []);
});

test('dépendances : aucun helper lazy appelé sans garde depuis le core', () => {
  const core = fs.readFileSync(path.join(__dirname, '../app/static/sgdi-app.js'), 'utf8');
  const start = core.indexOf('    switch(root){', core.indexOf('function renderView(){'));
  const end = core.indexOf('  }catch(e){console.error(e);view.innerHTML=', start);
  assert.ok(start > 0 && end > start);
  const shared = core.slice(0, start) + core.slice(end);
  for (const domain of Object.values(inventory)) {
    for (const name of domain.functions) {
      assert.doesNotMatch(shared, new RegExp('\\b' + name + '\\b'), name + ' doit rester synchrone ou avoir une dépendance explicite');
      const cases = core.slice(start, end).matchAll(/case"([^"]+)":([\s\S]*?)(?=\n\s*case"|\n\s*default:|$)/g);
      for (const [, route, body] of cases) {
        if (!domain.routes.includes(route)) assert.doesNotMatch(body, new RegExp('\\b' + name + '\\b'), route + ' ne charge pas ' + name);
      }
    }
  }
});

test('deep links isolés : chaque domaine démarre sans avoir visité un autre module', async () => {
  for (const domain of Object.values(inventory)) {
    const r = boot();
    r.go('#/' + domain.routes[0]); await tick();
    assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError|Module indisponible/);
    assert.deepEqual(r.errors, [], domain.routes[0]);
    r.go('#/dashboard'); await tick();
    assert.equal(r.timers.size, 0);
  }
});

test('Effectif et contrats : listes et fiche employé avec backendId préservé', async () => {
  if (!inventory.employees) return;
  const r = boot();
  const employee = { id: 'employee-test', backendId: 42, nom: 'TEST', prenom: 'Employé', statut: 'actif', societe: '', matricule: '042' };
  r.T().setDb(new Proxy({ agents: [employee] }, { get(target, key) { return target[key] ?? (target[key] = []); } }));
  for (const route of ['effectif/actifs', 'effectif/agent/employee-test', 'contrats', 'contrats/nouveau_contrat', 'effectif/sortants']) {
    r.go('#/' + route); await tick();
    assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError|Module indisponible/);
    assert.equal(employee.backendId, 42);
    if (route === 'effectif/agent/employee-test') assert.ok(r.view().querySelector('form'), 'fiche employé');
    r.go('#/dashboard'); await tick();
  }
  assert.deepEqual(r.errors, []);
});

test('DRH : congés, social, périodes d’essai et statistiques réouvrent sans erreur', async () => {
  if (!inventory.drh) return;
  const r = boot();
  for (const route of ['drh/conges', 'conges', 'drh/social', 'drh/essai', 'drh/stats_fonction']) {
    r.go('#/' + route); await tick();
    assert.equal(r.window.SGDIModules.activeModuleKey, 'drh');
    assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError|Module indisponible/);
    r.go('#/dashboard'); await tick();
  }
  assert.deepEqual(r.errors, []);
});

test('Administration : utilisateurs/permissions ×3, autre utilisateur, backendId et avertissement préservés', async () => {
  if (!inventory.administration) return;
  const r = boot(), w = r.window, calls = [];
  r.T().setSession({ username: 'admin', role: 'admin', adminSystem: true, access_level: 'H5', authorized_modules: ['all'], transverse: 'admin' });
  const users = [{ username: 'alice', backendId: 42, role: 'agent', actif: true }, { username: 'bob', backendId: 84, role: 'ops', actif: true }];
  r.T().setDb(new Proxy({ users }, { get(target, key) { return target[key] ?? (target[key] = []); } }));
  w.SGDI.auth.granularFeatureCatalog = async () => ({ actions: ['read', 'pay'], modules: [{ module_key: 'drh', label: 'DRH', domain: 'RH', features: [{ feature_key: 'employees', label: 'Employés', applicable_actions: ['read'] }] }] });
  w.SGDI.auth.userFeaturePermissions = async id => { calls.push(id); return { username: id === 42 ? 'alice' : 'bob', permissions: id === 42 ? [{ module_key: 'drh', feature_key: 'employees', action_key: 'read' }] : [] }; };
  w.SGDI.auth.saveUserFeaturePermissions = () => { throw new Error('Aucune écriture de permission autorisée dans ce parcours'); };
  for (let turn = 0; turn < 3; turn++) {
    r.go('#/admin/users'); await tick();
    assert.match(r.view().textContent, /Gestion des utilisateurs/);
    for (const user of users) {
      await w.openGranularPermissionsByKey(encodeURIComponent(user.username));
      const editor = w.document.getElementById('granular-permissions-editor');
      assert.ok(editor); assert.match(editor.textContent, /Permissions préparées — non actives/);
      assert.match(editor.textContent, new RegExp(user.username));
      assert.equal(editor.querySelector('[data-action="read"]').checked, user.backendId === 42);
      assert.equal(editor.querySelector('[data-action="pay"]').disabled, true);
      w.closeModal();
    }
    r.go('#/dashboard'); await tick();
  }
  assert.deepEqual(calls, [42, 84, 42, 84, 42, 84]);
  assert.deepEqual(users.map(user => user.backendId), [42, 84]);
  assert.equal(new Set(r.downloads).size, r.downloads.length);
  assert.deepEqual(r.errors, []);
});

test('Administration : liens directs paramètres, profils, postes et formulaires utilisateurs', async () => {
  if (!inventory.administration) return;
  const r = boot(), w = r.window;
  r.T().setSession({ username: 'admin', role: 'admin', adminSystem: true, access_level: 'H5', authorized_modules: ['all'], transverse: 'admin' });
  const user = { username: 'alice', backendId: 42, role: 'agent', actif: true, sitesAutorises: [], modules: [] };
  const fetch = w.fetch;
  w.fetch = (url, opts) => String(url).includes('/irongs/positions') ? Promise.resolve({ ok: true, json: async () => [] }) : fetch(url, opts);
  r.T().setDb(new Proxy({ users: [user], settings: {} }, { get(target, key) { return target[key] ?? (target[key] = []); } }));
  for (const route of ['admin/users', 'admin/niveaux', 'admin/droits', 'admin/access_sgdi', 'admin/access_societes', 'admin/access_structures', 'admin/access_code', 'admin/menu', 'admin/counters', 'admin/effectifs', 'admin/postes', 'admin/document-models', 'parametres', 'parametres/log']) {
    r.go('#/' + route); await tick();
    assert.equal(w.SGDIModules.activeModuleKey, 'administration', route);
    assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError|Module indisponible|Chargement du module|Accès refusé/);
    r.go('#/dashboard'); await tick();
  }
  r.go('#/admin/users'); await tick();
  w.SGDI.sites.list = async () => [];
  w.openAdminUserModalByKey('alice'); await tick();
  assert.equal(w.document.querySelector('#modal-host [name="username"]').value, 'alice');
  assert.equal(user.backendId, 42);
  w.closeModal();
  r.go('#/dashboard'); await tick();
  assert.equal(r.timers.size, 0);
  assert.equal(new Set(r.downloads).size, r.downloads.length);
  assert.deepEqual(r.errors, []);
});

test('navigation navigateur : précédent/suivant réactive le module sans recharger les scripts', async () => {
  const r = boot(), w = r.window;
  r.dom.reconfigure({ url: 'http://localhost/' });
  r.T().setSession({ username: 'admin', role: 'admin', adminSystem: true, access_level: 'H5', authorized_modules: ['all'], transverse: 'admin' });
  w.location.hash = '#/drh'; await tick();
  assert.equal(w.SGDIModules.activeModuleKey, 'drh');
  w.location.hash = '#/ops'; await tick();
  assert.equal(w.SGDIModules.activeModuleKey, 'ops');
  w.history.back(); await tick();
  assert.equal(w.location.hash, '#/drh');
  assert.equal(w.SGDIModules.activeModuleKey, 'drh');
  w.history.forward(); await tick();
  assert.equal(w.location.hash, '#/ops');
  assert.equal(w.SGDIModules.activeModuleKey, 'ops');
  assert.equal(new Set(r.downloads).size, r.downloads.length);
  assert.deepEqual(r.errors, []);
});

test('registre absent : chaque nouvelle route affiche un rechargement compréhensible', () => {
  const r = loadSgdiApp(['renderView'], { withoutModules: true }), w = r.window;
  assert.ifError(r.loadError);
  r.T().setSession({ username: 'admin', role: 'admin', adminSystem: true, transverse: 'admin' });
  r.T().setDb(new Proxy({}, { get(target, key) { return target[key] ?? (target[key] = []); } }));
  r.T().setFullDataReady(true);
  for (const domain of Object.values(inventory)) for (const route of domain.routes) {
    w.history.replaceState(null, '', '#/' + route);
    assert.equal(r.T().renderView(), undefined);
    const view = w.document.getElementById('view');
    assert.match(view.textContent, /Module indisponible/);
    assert.equal(view.querySelector('button').textContent, 'Recharger');
  }
});

test('Sites : formulaire lazy, destruction des cartes et chargement cartographique tardif ignoré', async () => {
  if (!inventory.sites) return;
  const r = boot(), w = r.window;
  let resolveMap, creations = 0, removals = 0;
  w.loadMapLibre = () => new Promise(resolve => { resolveMap = resolve; });
  r.go('#/sites/nouveau'); await tick();
  assert.ok(w.document.getElementById('site-form'));
  for (const key of ['__sgdiSitesDashboardMap', '__sgdiInlineSitePositionMap', '__sgdiSitePositionMap']) w[key] = { remove() { removals++; } };
  r.go('#/dashboard'); await tick();
  assert.equal(removals, 3);
  if (resolveMap) resolveMap({ Map: class { constructor() { creations++; } } });
  await tick();
  assert.equal(creations, 0);
  let resolveStores;
  w.sgdiAuthToken = () => 'fixture-token';
  w.SGDI.stock.stores = () => new Promise(resolve => { resolveStores = resolve; });
  w.SGDI.commercial.clients = async () => [];
  r.go('#/sites/nouveau'); await tick();
  assert.equal(typeof resolveStores, 'function', r.view().textContent + JSON.stringify(r.errors));
  r.go('#/dashboard'); await tick();
  resolveStores([]); await tick();
  assert.equal(w.document.getElementById('site-form'), null, w.location.hash + ' ' + r.view().textContent.slice(0,250) + JSON.stringify(r.errors));
  assert.equal(w.SGDIModules.activeModuleKey, null);
  assert.deepEqual(r.errors, []);
});

test('Incidents : modale et réponse serveur tardive sans rendu obsolète', async () => {
  if (!inventory.incidents) return;
  const r = boot(), w = r.window;
  r.go('#/incidents/site'); await tick();
  w.openIncidentModal('site');
  assert.ok(w.document.querySelector('#modal-host [name="sujet"]'));
  w.closeModal();
  let resolvePage;
  w.sgdiAuthToken = () => 'fixture-token';
  w.SGDI.events.page = () => new Promise(resolve => { resolvePage = resolve; });
  r.go('#/incidents/autres'); await tick();
  assert.equal(typeof resolvePage, 'function');
  r.go('#/dashboard'); await tick();
  const html = r.view().innerHTML;
  resolvePage({ items: [], total: 0 }); await tick();
  assert.equal(r.view().innerHTML, html);
  assert.equal(w.SGDIModules.activeModuleKey, null);
  assert.deepEqual(r.errors, []);
});

test('Facturation : calculs identiques, listeners uniques et brouillon conservé à la sortie', async () => {
  if (!inventory.facturation) return;
  const r = boot(), w = r.window, writes = [];
  let finishSave;
  w.sgdiApi = async (url, options) => {
    if (String(url).includes('/collections/factures/items') && options?.body?.data) {
      writes.push(JSON.parse(JSON.stringify(options.body.data)));
      return new Promise(resolve => { finishSave = () => resolve(options.body.data); });
    }
    return {};
  };
  w.__factureEditId = 'new';
  r.go('#/facturation/factures'); await tick();
  let schedules = 0;
  const schedule = w.factureEditorScheduleDraft;
  w.factureEditorScheduleDraft = () => { schedules++; return schedule(); };
  for (let i = 0; i < 3; i++) { r.go('#/facturation/factures'); await tick(); }
  const object = w.document.getElementById('fact-objet');
  assert.ok(object);
  object.value = 'BROUILLON À CONSERVER';
  w.factureEditorLigneAdd('article');
  const row = w.document.querySelector('.fact-ligne-row[data-type="article"]');
  row.querySelector('.fact-ligne-desig').value = 'Prestation';
  row.querySelector('.fact-ligne-qte').value = '2';
  row.querySelector('.fact-ligne-prix').value = '100';
  object.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(schedules, 1, 'une seule réaction après trois rendus');
  r.go('#/dashboard'); await tick();
  assert.equal(writes.length, 1, 'un seul enregistrement avant destruction du DOM');
  assert.equal(writes[0].objet, 'BROUILLON À CONSERVER');
  assert.equal(writes[0].montantHT, 200);
  assert.equal(writes[0].montantTTC, 238);
  r.view().insertAdjacentHTML('beforeend', '<input id="unrelated-field">');
  w.document.getElementById('unrelated-field').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(schedules, 1, 'aucun listener facture restant sur Dashboard');
  assert.equal(w.SGDIModules.activeModuleKey, null);
  w.__factureEditId = 'new';
  r.go('#/facturation/factures'); await tick();
  const newState = w.document.getElementById('fact-draft-state');
  newState.textContent = 'NOUVEAU BROUILLON';
  finishSave(); await tick();
  assert.equal(newState.textContent, 'NOUVEAU BROUILLON', 'la réponse ancienne ne marque pas le nouveau brouillon enregistré');
  r.go('#/dashboard'); await tick();
  assert.deepEqual(r.errors, []);
});

test('Commercial : liens directs, éditeur devis et menu sans listener dupliqué', async () => {
  if (!inventory.commercial) return;
  const r = boot(), w = r.window, listeners = new Set();
  for (const route of ['commercial/prospects', 'commercial/clients', 'commercial/devis', 'commercial/catalogue', 'commercial/calendrier']) {
    r.go('#/' + route); await tick();
    assert.equal(w.SGDIModules.activeModuleKey, 'commercial');
    assert.doesNotMatch(r.view().textContent, /ReferenceError|TypeError|Module indisponible/);
  }
  const add = w.document.addEventListener.bind(w.document), remove = w.document.removeEventListener.bind(w.document);
  w.document.addEventListener = (type, fn, opts) => { if (fn.name === 'commercialDismissMenu') listeners.add(fn); return add(type, fn, opts); };
  w.document.removeEventListener = (type, fn, opts) => { if (fn.name === 'commercialDismissMenu') listeners.delete(fn); return remove(type, fn, opts); };
  const button = w.document.createElement('button'); r.view().appendChild(button);
  for (let i = 0; i < 3; i++) { w.sgdiClientRowMenu(button, 'c1'); await tick(); }
  assert.equal(listeners.size, 1);
  assert.equal(w.document.querySelectorAll('.sgdi-client-row-menu').length, 1);
  r.go('#/dashboard'); await tick();
  assert.equal(listeners.size, 0);
  assert.equal(w.document.querySelectorAll('.sgdi-client-row-menu').length, 0);
  w.__devisEditorId = 'new';
  r.go('#/commercial/devis'); await tick();
  assert.ok(w.document.getElementById('dev-objet'));
  r.go('#/dashboard'); await tick();
  assert.equal(new Set(r.downloads).size, r.downloads.length);
  assert.deepEqual(r.errors, []);
});

test('Agenda : dépendance Secrétariat chargée une fois, route autonome et modale', async () => {
  if (!inventory.agenda) return;
  const r = boot(), w = r.window;
  r.go('#/secretariat/agenda'); await tick();
  assert.equal(w.SGDIModules.activeModuleKey, 'secretariat');
  assert.equal(w.SGDIModules.isModuleInitialized('agenda'), false, 'dépendance déclarative sans init concurrent');
  assert.match(r.view().textContent, /Agenda|AGENDA/);
  w.openAgendaEventModal();
  assert.ok(w.document.querySelector('#modal-host [name="titre"]'));
  w.closeModal();
  r.go('#/agenda'); await tick();
  assert.equal(w.SGDIModules.activeModuleKey, 'agenda');
  r.go('#/dashboard'); await tick();
  r.go('#/secretariat/agenda'); await tick();
  assert.equal(r.downloads.filter(p => p.endsWith('/agenda.js')).length, 1);
  assert.deepEqual(r.errors, []);
});
