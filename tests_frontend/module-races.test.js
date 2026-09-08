const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');
const tick = () => new Promise(resolve => setTimeout(resolve, 25));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

async function boot(t) {
  const r = loadSgdiApp(['renderView'], { lazyModules: true }), w = r.window;
  assert.ifError(r.loadError); t.after(() => w.close());
  r.dom.reconfigure({ url: 'http://localhost/' });
  for (const id of ['view', 'sidebar-nav']) w.document.getElementById('app').appendChild(w.document.getElementById(id));
  const errors = [], intervals = new Set(); let timer = 10000;
  w.addEventListener('error', e => { errors.push(e.error || e.message); e.preventDefault(); });
  w.console.error = (...args) => errors.push(args);
  w.setInterval = () => { const id = ++timer; intervals.add(id); return id; };
  w.clearInterval = id => intervals.delete(id);
  const append = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = el => {
    if (el.src && el.src.includes('/static/js/modules/')) {
      const url = new URL(el.src); el.removeAttribute('src');
      el.textContent = fs.readFileSync(path.join(__dirname, '../app', url.pathname), 'utf8');
      append(el); queueMicrotask(() => el.onload()); return el;
    }
    return append(el);
  };
  r.T().setDb(new Proxy({ users: [{ username: 'alice', backendId: 42, role: 'agent', actif: true }] }, { get(o, k) { return o[k] ?? (o[k] = []); } }));
  r.T().setSession({ username: 'admin', role: 'admin', adminSystem: true, access_level: 'H5', authorized_modules: ['all'], transverse: 'admin' });
  r.T().setFullDataReady(true); r.T().setViewMode(true);
  const go = async route => { w.history.replaceState(null, '', '#/' + route); r.T().renderView(); await tick(); };
  await tick(); await go('dashboard');
  return { ...r, w, go, errors, intervals, view: () => w.document.getElementById('view') };
}
function scanners(r) {
  const instances = [], { w } = r;
  w.sgdiLoadHtml5QR = async () => {};
  w.Html5Qrcode = class {
    constructor() { this.starting = deferred(); this.live = false; this.stops = 0; this.clears = 0; instances.push(this); }
    start(_camera, _config, callback) { this.callback = callback; return this.starting.promise.then(() => { this.live = true; }); }
    stop() { this.stops++; assert.equal(this.live, true, 'stop après résolution du démarrage'); this.live = false; return Promise.resolve(); }
    clear() { this.clears++; }
  };
  return instances;
}
async function pointage(r) {
  await r.go('pointage/auto');
  // Le scanner existe normalement dans la saisie terrain. Le fixture admin peut
  // masquer sa carte ; on conserve le vrai cycle de vie du module et du scanner.
  if (!r.w.document.getElementById('pt-employee-qr-reader')) {
    const reader = r.w.document.createElement('div'); reader.id = 'pt-employee-qr-reader'; r.view().appendChild(reader);
  }
}
function cleanScanner(r, instances) {
  assert.equal(instances.filter(s => s.live).length, 0);
  assert.equal(r.w.eval('_ptEmployeeQrScanner'), null);
  assert.equal(r.w.eval('ptEmployeeQrSession'), null);
  assert.equal(r.w.eval('ptEmployeeQrTimeouts.size'), 0);
  assert.deepEqual(r.errors, []);
}

test('scanner A : start pending → destroy répété → résolution, arrêt unique', async t => {
  const r = await boot(t), all = scanners(r); await pointage(r);
  const start = r.w.ptEmployeeQrStart(); await tick();
  await r.go('dashboard'); r.w.pointageModuleDestroy(); r.w.pointageModuleDestroy();
  assert.equal(all[0].stops, 0);
  const html = r.view().innerHTML;
  all[0].starting.resolve(); await start; await r.w.ptEmployeeQrStop();
  assert.equal(all[0].stops, 1); assert.equal(all[0].clears, 1);
  all[0].callback('obsolete'); await tick();
  assert.equal(r.view().innerHTML, html); assert.equal(r.w.SGDIModules.activeModuleKey, null);
  assert.equal(r.intervals.size, 0); cleanScanner(r, all);
});

test('scanner B : start pending → destroy → rejet, état propre', async t => {
  const r = await boot(t), all = scanners(r); await pointage(r);
  const start = r.w.ptEmployeeQrStart(); await tick(); await r.go('dashboard');
  const html = r.view().innerHTML;
  all[0].starting.reject(new Error('caméra refusée')); await start; await r.w.ptEmployeeQrStop();
  assert.equal(r.view().innerHTML, html); assert.equal(all[0].clears, 1); cleanScanner(r, all);
});

test('scanner C : start A → stop → start B, A nettoyé avant B seul actif', async t => {
  const r = await boot(t), all = scanners(r); await pointage(r);
  const a = r.w.ptEmployeeQrStart(); await tick();
  const stopped = r.w.ptEmployeeQrStop(), b = r.w.ptEmployeeQrStart(); await tick();
  assert.equal(all.length, 1, 'nouvelle caméra attend le nettoyage de la précédente');
  all[0].starting.resolve(); await a; await stopped; await tick();
  assert.equal(all[0].stops, 1); assert.equal(all.length, 2);
  all[1].starting.resolve(); await b;
  assert.equal(all.filter(s => s.live).length, 1); assert.equal(r.w.eval('_ptEmployeeQrScanner'), all[1]);
  all[0].callback('obsolete'); await tick(); assert.equal(all[1].live, true);
  await r.w.ptEmployeeQrStop(); cleanScanner(r, all);
});

test('scanner D : Pointage → Dashboard → Pointage pendant start', async t => {
  const r = await boot(t), all = scanners(r); await pointage(r);
  const a = r.w.ptEmployeeQrStart(); await tick(); await r.go('dashboard'); await r.go('pointage/auto');
  all[0].starting.resolve(); await a; await tick(); await pointage(r);
  const b = r.w.ptEmployeeQrStart(); await tick(); all[1].starting.resolve(); await b;
  assert.equal(all[0].stops, 1); assert.equal(all.filter(s => s.live).length, 1);
  assert.equal(r.w.SGDIModules.activeModuleKey, 'pointage');
  await r.go('dashboard'); await r.w.ptEmployeeQrStop(); cleanScanner(r, all);
});

test('scanner : chargement QR différé annulé, callbacks et timers retirés', async t => {
  const r = await boot(t), all = scanners(r); await pointage(r);
  const library = deferred(); r.w.sgdiLoadHtml5QR = () => library.promise;
  const start = r.w.ptEmployeeQrStart(); await tick(); await r.go('dashboard');
  library.resolve(); await start; assert.equal(all.length, 0);
  await pointage(r); let fired = 0;
  r.w.ptEmployeeQrTimeout(() => fired++, 50); await r.go('dashboard'); await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(fired, 0); cleanScanner(r, all);
});

for (const destination of ['dashboard', 'sites']) for (const reject of [false, true]) {
  test(`Administration stats ${reject ? 'rejetées' : 'résolues'} après navigation ${destination}`, async t => {
    const r = await boot(t), stats = deferred();
    r.w.sgdiAuthToken = () => 'fixture'; r.w.sgdiRefreshSidebarStats = () => stats.promise;
    await r.go('admin/dashboard'); await r.go(destination); const html = r.view().innerHTML;
    reject ? stats.reject(new Error('stats indisponibles')) : stats.resolve(); await tick();
    assert.equal(r.view().innerHTML, html); assert.equal(r.w.SGDIModules.activeModuleKey, destination === 'sites' ? 'sites' : null);
    assert.deepEqual(r.errors, []);
  });
}

test('Administration : même route, ancienne réponse ignorée, rendu normal conservé', async t => {
  const r = await boot(t), first = deferred(), last = deferred(); let call = 0;
  r.w.sgdiAuthToken = () => 'fixture'; r.w.sgdiRefreshSidebarStats = () => (++call === 1 ? first : last).promise;
  await r.go('admin/dashboard'); await r.go('admin/dashboard');
  last.resolve(); await tick(); assert.match(r.view().textContent, /Administration système/);
  const marker = r.w.document.createElement('input'); marker.value = 'saisie récente'; r.view().appendChild(marker);
  first.resolve(); await tick(); assert.equal(marker.isConnected, true); assert.equal(marker.value, 'saisie récente');
  assert.equal(r.w.SGDIModules.activeModuleKey, 'administration'); assert.deepEqual(r.errors, []);
});

for (const [route, setup] of [
  ['rotations', (w, d) => { w.sgdiApi = () => d.promise; }],
  ['postes', (w, d) => { w.sgdiApi = () => d.promise; }],
  ['catalogue', (w, d) => { w.refreshStockArticlesFromPostgres = () => d.promise; }],
  ['loans', (w, d) => { w.SGDI_API.request = () => d.promise; }],
  ['commercial-dc', (w, d) => { w.SGDI_API.request = () => d.promise; }]
]) test(`Administration ${route} : succès et erreur tardifs sans écriture`, async t => {
  for (const reject of [false, true]) {
    const r = await boot(t), d = deferred(); setup(r.w, d);
    await r.go('admin/' + route); await r.go('dashboard'); const html = r.view().innerHTML;
    reject ? d.reject(new Error('retard')) : d.resolve([]); await tick();
    assert.equal(r.view().innerHTML, html); assert.deepEqual(r.errors, []);
  }
});

for (const permissions of [false, true]) test(`Administration : ouverture tardive ${permissions ? 'permissions' : 'utilisateur'} ignorée`, async t => {
  const r = await boot(t), d = deferred(); await r.go('admin/users');
  r.w.SGDI.sites.list = () => d.promise;
  r.w.SGDI.auth.granularFeatureCatalog = () => d.promise;
  r.w.SGDI.auth.userFeaturePermissions = async () => ({ username: 'alice', permissions: [] });
  const opened = permissions ? r.w.openGranularPermissionsByKey('alice') : r.w.openAdminUserModal('alice');
  await r.go('dashboard'); const html = r.w.document.getElementById('modal-host').innerHTML;
  d.resolve(permissions ? { modules: [] } : []); await opened;
  assert.equal(r.w.document.getElementById('modal-host').innerHTML, html); assert.deepEqual(r.errors, []);
});

test('course transverse : scanner pending → Administration → Dashboard', async t => {
  const r = await boot(t), all = scanners(r); await pointage(r);
  const start = r.w.ptEmployeeQrStart(); await tick(); await r.go('admin'); await r.go('dashboard');
  const html = r.view().innerHTML; all[0].starting.resolve(); await start; await r.w.ptEmployeeQrStop();
  assert.equal(r.view().innerHTML, html); assert.equal(r.w.SGDIModules.activeModuleKey, null); cleanScanner(r, all);
});

test('course transverse : Administration pending → Pointage → scanner', async t => {
  const r = await boot(t), all = scanners(r), stats = deferred();
  r.w.sgdiAuthToken = () => 'fixture'; r.w.sgdiRefreshSidebarStats = () => stats.promise;
  await r.go('admin/dashboard'); r.w.sgdiAuthToken = () => ''; await pointage(r);
  const start = r.w.ptEmployeeQrStart(); await tick(); all[0].starting.resolve(); await start;
  const html = r.view().innerHTML; stats.resolve(); await tick();
  assert.equal(r.view().innerHTML, html); assert.equal(all.filter(s => s.live).length, 1);
  assert.equal(r.w.SGDIModules.activeModuleKey, 'pointage');
  await r.go('dashboard'); await r.w.ptEmployeeQrStop(); cleanScanner(r, all);
});

test('Administration : anciens compteurs de contrats ignorés après re-rendu', async t => {
  const r = await boot(t), first = deferred(), last = deferred(); await r.go('admin/contrats');
  let call = 0;
  r.w.SGDI.rh.contractTemplates = () => (++call === 1 ? first : last).promise;
  r.w.SGDI.rh.contractClauses = async () => [];
  r.w.SGDI.rh.generatedContracts = async () => [];
  await r.go('admin/contrats'); await r.go('admin/contrats');
  last.resolve([]); await tick();
  const count = r.w.document.getElementById('admin-contract-template-count');
  assert.ok(count); assert.equal(count.textContent, '0');
  first.resolve([{ id: 1, title: 'Obsolète' }]); await tick();
  assert.equal(count.textContent, '0'); assert.doesNotMatch(r.view().textContent, /Obsolète/);
  assert.deepEqual(r.errors, []);
});

test('Administration : sauvegarde des prêts ne réécrit pas la vue suivante', async t => {
  const r = await boot(t); r.w.SGDI_API.request = async () => ({});
  await r.go('admin/loans');
  const saved = deferred(); r.w.SGDI_API.request = () => saved.promise;
  const saving = r.w.saveAdminLoanSettings();
  await r.go('dashboard'); const html = r.view().innerHTML;
  saved.resolve({ module_enabled: true }); await saving;
  assert.equal(r.view().innerHTML, html); assert.deepEqual(r.errors, []);
});

test('scanner : scan normal conservé, stop retire les callbacks et délais de rendu', async t => {
  const r = await boot(t), all = scanners(r); await pointage(r);
  const start = r.w.ptEmployeeQrStart(); await tick(); all[0].starting.resolve(); await start;
  let submissions = 0;
  r.w.fetch = async () => { submissions++; return { ok: true, json: async () => ({ employee: { nom: 'TEST' }, action: 'arrivee', heure: '08:00' }) }; };
  r.w.sgdiPullState = async () => {};
  await r.w.ptEmployeeQrSubmit('fixture');
  assert.equal(submissions, 1); assert.equal(all[0].stops, 1);
  assert.equal(r.w.eval('ptEmployeeQrTimeouts.size'), 2);
  await r.go('dashboard'); const html = r.view().innerHTML;
  all[0].callback('obsolete');
  await new Promise(resolve => setTimeout(resolve, 1250));
  assert.equal(submissions, 1); assert.equal(r.view().innerHTML, html);
  cleanScanner(r, all);
});
