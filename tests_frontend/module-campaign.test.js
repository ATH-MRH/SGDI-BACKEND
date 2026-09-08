const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');
const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/frontend-phase2b-2g-inventory.json')));
const tick = () => new Promise(resolve => setTimeout(resolve, 150));

function boot() {
  const ctx = loadSgdiApp(['renderView'], { lazyModules: true });
  assert.ifError(ctx.loadError);
  const { window: w, T } = ctx;
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
