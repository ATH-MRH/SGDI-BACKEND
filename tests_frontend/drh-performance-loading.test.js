const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');

const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function employee(id, society = 'ALPHA') {
  return { id, code: `P${id}`, first_name: 'FICTIF', last_name: `EMPLOYE ${id}`,
    society, status: 'actif', extra: {}, current_site_name: 'Site fictif' };
}
function statistics(society = 'ALPHA', total = 1) {
  return { generated_at: '2026-09-13T12:00:00Z', scope: { active_society: society },
    erp: { employees: { total, active: total, non_archived: total } } };
}
async function fixture(t) {
  const r = loadSgdiApp([], { lazyModules: true });
  assert.ifError(r.loadError);
  const w = r.window;
  t.after(() => w.close());
  await turn();
  r.dom.reconfigure({ url: 'http://localhost/#/test' });
  w.requestAnimationFrame = callback => w.setTimeout(callback, 0);
  w.renderView = () => {};
  w.render = () => {};
  w.refreshModuleCountersRibbon = () => {};
  w.toast = () => {};
  w.console.warn = () => {};
  w.console.error = () => {};
  r.T().setDb({ agents: [{ id: '99', backendId: 99, nom: 'EXISTANT', prenom: 'FICTIF',
    societe: 'ALPHA', statut: 'actif' }], assignments: [], settings: {}, users: [] });
  const setSession = society => r.T().setSession({ username: 'perf', role: 'admin', societe: society, transverse: 'drh' });
  setSession('ALPHA');
  w.sessionStorage.setItem('sgdi_api_token_v1', 'token-A');
  return { w, setSession, db: () => w.eval('db') };
}

test('bootstrap employees marks existing freshness; dashboard full and scoped ensures reuse it', async t => {
  const { w, db } = await fixture(t);
  let calls = 0;
  w.SGDI_API.employees.list = async () => { calls++; return [employee(1), employee(2, 'BETA')]; };
  await w.sgdiPullEmployees({ silent: true });
  assert.equal(w.sgdiEnsureEmployeesForDisplay({ force: true }), null);
  assert.equal(w.sgdiEnsureEmployeesForDisplay({ society: 'ALPHA', force: true }), null);
  assert.equal(calls, 1);
  assert.equal(db().agents.length, 2, 'the complete reference is retained');
  await w.sgdiPullEmployees({ silent: true });
  assert.equal(calls, 2, 'an explicit pull remains a fresh read');
  const now = w.Date.now();
  w.Date.now = () => now + 10001;
  await w.sgdiEnsureEmployeesForDisplay({ society: 'ALPHA', force: true });
  assert.equal(calls, 3, 'the existing ten-second force window expires');
});

test('concurrent full employee read covers exact and scoped waiters with one HTTP request', async t => {
  const { w } = await fixture(t), reply = deferred();
  let calls = 0;
  w.SGDI_API.employees.list = () => { calls++; return reply.promise; };
  const full = w.sgdiPullEmployees({ silent: true });
  const again = w.sgdiPullEmployees({ silent: true });
  const scoped = w.sgdiPullEmployees({ society: 'ALPHA', silent: true });
  reply.resolve([employee(1), employee(2, 'BETA')]);
  const results = await Promise.all([full, again, scoped]);
  assert.equal(calls, 1);
  assert.ok(results.every(rows => rows.length === 2));
});

test('different employee scopes merge against the latest reference without overwriting each other', async t => {
  const { w, db } = await fixture(t), a = deferred(), b = deferred();
  const scopes = [];
  w.SGDI_API.employees.list = params => { scopes.push(params.society); return params.society === 'ALPHA' ? a.promise : b.promise; };
  const first = w.sgdiPullEmployees({ society: 'ALPHA', silent: true });
  const second = w.sgdiPullEmployees({ society: 'BETA', silent: true });
  b.resolve([employee(2, 'BETA')]); await second;
  a.resolve([employee(1)]); await first;
  assert.deepEqual(scopes, ['ALPHA', 'BETA']);
  assert.deepEqual(Array.from(db().agents, row => row.backendId).sort(), [1, 2]);
});

test('failed and ignored empty employee reads do not mark freshness and may retry', async t => {
  const { w, db } = await fixture(t);
  let calls = 0;
  w.SGDI_API.employees.list = async () => { calls++; throw new Error('temporary outage'); };
  w.SGDI_API.employees.page = async () => { throw new Error('temporary outage'); };
  await w.sgdiEnsureEmployeesForDisplay({ force: true });
  assert.deepEqual(Object.keys(w.__sgdiEnsuredAt), []);
  await w.sgdiEnsureEmployeesForDisplay({ force: true });
  assert.equal(calls, 2);
  w.SGDI_API.employees.list = async () => [];
  await w.sgdiEnsureEmployeesForDisplay({ force: true });
  assert.equal(db().agents[0].backendId, 99);
  assert.deepEqual(Object.keys(w.__sgdiEnsuredAt), []);
  w.SGDI_API.employees.list = async () => [employee(1)];
  await w.sgdiEnsureEmployeesForDisplay({ force: true });
  assert.ok(w.__sgdiEnsuredAt.__all > 0);
});

test('scope response containing only employees assigned from another society does not mark an unchanged reference fresh', async t => {
  const { w, db } = await fixture(t);
  const effects = [];
  db().assignments = [{ employee_id: 99 }];
  w.normalizeEmployeeCodesInDB = () => effects.push('normalize');
  w.applyAssignmentsToEmployees = () => effects.push('assignments');
  w.sgdiAutoRender = () => effects.push('render');
  w.toast = () => effects.push('toast');
  w.SGDI_API.employees.list = async () => [employee(2, 'BETA')];
  await w.sgdiPullEmployees({ society: 'ALPHA', render: true });
  assert.equal(db().agents[0].backendId, 99);
  assert.deepEqual(Object.keys(w.__sgdiEnsuredAt), []);
  assert.deepEqual(effects, ['normalize', 'assignments', 'render', 'toast'], 'existing post-read behavior is preserved');
});

test('paginated fallback retains every page; incomplete fallback is not marked fresh', async t => {
  const { w, db } = await fixture(t);
  const pages = [];
  w.SGDI_API.employees.list = async () => { throw new Error('full endpoint down'); };
  w.SGDI_API.employees.page = async params => {
    pages.push(params.page);
    return { items: [employee(params.page)], pages: 2, total: 2 };
  };
  await w.sgdiPullEmployees({ silent: true });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(db().agents.length, 2);
  assert.ok(w.__sgdiEnsuredAt.__all > 0);
  w.sgdiInvalidateDrhReads();
  w.SGDI_API.employees.page = async params => params.page === 1
    ? { items: [employee(1)], pages: 2, total: 2 } : {};
  await w.sgdiPullEmployees({ silent: true });
  assert.deepEqual(Object.keys(w.__sgdiEnsuredAt), []);
});

test('mutation invalidates an in-flight employee read; obsolete success cannot replace the new reference', async t => {
  const { w, db } = await fixture(t), old = deferred(), fresh = deferred();
  let calls = 0;
  w.SGDI_API.employees.list = () => (++calls === 1 ? old.promise : fresh.promise);
  const first = w.sgdiPullEmployees({ silent: true });
  w.sgdiRefreshCountersNow = () => Promise.resolve(null);
  w.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ ok: true }) });
  await w.sgdiApi('/drh/employees/1', { method: 'PATCH', legacy: false, body: { first_name: 'FICTIF' } });
  const next = w.sgdiPullEmployees({ silent: true });
  old.resolve([employee(1)]); assert.equal(await first, null);
  const joined = w.sgdiPullEmployees({ silent: true });
  assert.equal(calls, 2, 'old cleanup must not delete the new pending request');
  fresh.resolve([employee(2)]); await Promise.all([next, joined]);
  assert.equal(db().agents[0].backendId, 2);
});

test('invalidation during paginated fallback stops later pages and rejects partial stale data', async t => {
  const { w, db } = await fixture(t), secondPage = deferred();
  const pages = [];
  w.SGDI_API.employees.list = async () => { throw new Error('full endpoint down'); };
  w.SGDI_API.employees.page = params => {
    pages.push(params.page);
    return params.page === 1 ? Promise.resolve({ items: [employee(1)], pages: 3, total: 3 }) : secondPage.promise;
  };
  const pending = w.sgdiPullEmployees({ silent: true }); await turn();
  assert.deepEqual(pages, [1, 2]);
  w.sgdiInvalidateDrhReads();
  secondPage.resolve({ items: [employee(2)], pages: 3, total: 3 });
  assert.equal(await pending, null);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(db().agents[0].backendId, 99);
  assert.deepEqual(Object.keys(w.__sgdiEnsuredAt), []);
});

test('a new token can ensure employees while the old request is still pending', async t => {
  const { w, db } = await fixture(t), old = deferred(), fresh = deferred();
  let calls = 0;
  w.SGDI_API.employees.list = () => (++calls === 1 ? old.promise : fresh.promise);
  const first = w.sgdiEnsureEmployeesForDisplay({ force: true });
  w.sessionStorage.setItem('sgdi_api_token_v1', 'token-B');
  const next = w.sgdiEnsureEmployeesForDisplay({ force: true });
  assert.equal(calls, 2);
  fresh.resolve([employee(2)]); await next;
  old.resolve([employee(1)]); assert.equal(await first, null);
  assert.equal(db().agents[0].backendId, 2);
});

test('old HTTP 401 does not disconnect a newer session or start fallback with its token', async t => {
  const { w } = await fixture(t), old = deferred();
  let pages = 0;
  w.fetch = () => old.promise;
  w.SGDI_API.employees.page = async () => { pages++; return { items: [], pages: 1 }; };
  const request = w.sgdiPullEmployees({ silent: true });
  w.sessionStorage.setItem('sgdi_api_token_v1', 'token-B');
  old.resolve({ ok: false, status: 401, text: async () => JSON.stringify({ detail: 'Token invalide' }) });
  assert.equal(await request, null);
  assert.equal(w.sgdiAuthToken(), 'token-B');
  assert.ok(w.eval('session'));
  assert.equal(pages, 0);
});

test('realtime reception and hydrate invalidate employee freshness even before another render', async t => {
  const { w } = await fixture(t);
  let calls = 0;
  w.SGDI_API.employees.list = async () => { calls++; return [employee(1)]; };
  await w.sgdiPullEmployees({ silent: true });
  w.sgdiScheduleRealtimePull({ source: 'another-browser' });
  assert.deepEqual(Object.keys(w.__sgdiEnsuredAt), []);
  await w.sgdiEnsureEmployeesForDisplay({ force: true });
  assert.equal(calls, 2);
  w.hydrateDB({ agents: [] });
  assert.deepEqual(Object.keys(w.__sgdiEnsuredAt), []);
});

test('an employee response from before hydrate cannot replace the new database reference', async t => {
  const { w, db } = await fixture(t), reply = deferred();
  w.SGDI_API.employees.list = () => reply.promise;
  const pending = w.sgdiPullEmployees({ silent: true });
  w.hydrateDB({ agents: [{ id: '22', backendId: 22, nom: 'HYDRATE', prenom: 'FICTIF', societe: 'ALPHA' }] });
  reply.resolve([employee(1)]);
  assert.equal(await pending, null);
  assert.equal(db().agents[0].backendId, 22);
  assert.deepEqual(Object.keys(w.__sgdiEnsuredAt), []);
});

test('sidebar and DRH share a pending read and populate existing DRH TTL before rendering', async t => {
  const { w } = await fixture(t), reply = deferred(), raw = statistics();
  let calls = 0, renderedCache = false;
  w.SGDI_API.ui.sidebarStats = () => { calls++; return reply.promise; };
  w.addEventListener('sgdi:sidebar-stats', () => { renderedCache = !!w.SGDI_DRH_STATS_BY_SOCIETY.ALPHA?._fetchedAt; });
  const sidebar = w.sgdiRefreshSidebarStats('ALPHA');
  const drh = w.sgdiRefreshDrhStats('ALPHA');
  await turn(); assert.equal(calls, 1);
  reply.resolve(raw); await Promise.all([sidebar, drh]);
  assert.ok(renderedCache);
  assert.equal(raw._fetchedAt, undefined, 'shared payload and remote signature stay unchanged');
  await w.sgdiRefreshDrhStats('ALPHA');
  assert.equal(calls, 1, 'dashboard reuse is bounded by its existing cache');
});

test('sidebar scopes remain distinct and a late old scope cannot replace the active sidebar', async t => {
  const { w, setSession } = await fixture(t), a = deferred(), b = deferred();
  const scopes = [];
  w.SGDI_API.ui.sidebarStats = params => { scopes.push(params.society || ''); return params.society === 'ALPHA' ? a.promise : b.promise; };
  const first = w.sgdiRefreshSidebarStats('ALPHA');
  setSession('BETA');
  const second = w.sgdiRefreshSidebarStats('BETA');
  await turn(); assert.deepEqual(scopes, ['ALPHA', 'BETA']);
  b.resolve(statistics('BETA')); await second;
  a.resolve(statistics('ALPHA')); await first;
  assert.equal(w.SGDI_SIDEBAR_STATS.scope.active_society, 'BETA');
  let globalCalls = 0;
  w.SGDI_API.ui.sidebarStats = async params => { assert.equal(params.society, undefined); globalCalls++; return statistics(''); };
  await w.sgdiRefreshDrhStats('');
  assert.equal(globalCalls, 1, 'scoped statistics never stand in for global statistics');
});

test('sidebar errors release pending reads for retry and invalidation discards obsolete responses', async t => {
  const { w } = await fixture(t), old = deferred();
  w.SGDI_API.ui.sidebarStats = async () => { throw new Error('unavailable'); };
  assert.equal(await w.sgdiRefreshDrhStats('ALPHA'), null);
  w.SGDI_API.ui.sidebarStats = () => old.promise;
  const pending = w.sgdiRefreshDrhStats('ALPHA'); await turn();
  w.sgdiInvalidateDrhReads();
  w.SGDI_API.ui.sidebarStats = async () => statistics('ALPHA', 3);
  await w.sgdiRefreshDrhStats('ALPHA');
  old.resolve(statistics('ALPHA', 2)); assert.equal(await pending, null);
  assert.equal(w.SGDI_DRH_STATS_BY_SOCIETY.ALPHA.erp.employees.total, 3);
});

test('counter refresh callers share one promise without a redundant queued request', async t => {
  const { w } = await fixture(t), reply = deferred();
  let calls = 0;
  const queued = [], originalTimeout = w.setTimeout.bind(w);
  w.setTimeout = (cb, ms, ...args) => ms === 250 ? (queued.push(cb), -1) : originalTimeout(cb, ms, ...args);
  w.SGDI_API.ui.sidebarStats = () => { calls++; return reply.promise; };
  const first = w.sgdiRefreshCountersNow({ reason: 'pull' });
  const second = w.sgdiRefreshCountersNow({ reason: 'schedule' });
  assert.equal(first, second);
  await turn(); assert.equal(calls, 1);
  reply.resolve(statistics()); await first;
  assert.equal(queued.length, 0);
});

test('counter refresh queues exactly one pass when invalidated during a read', async t => {
  const { w } = await fixture(t), old = deferred();
  let calls = 0;
  const queued = [], originalTimeout = w.setTimeout.bind(w);
  w.setTimeout = (cb, ms, ...args) => ms === 250 ? (queued.push(cb), -1) : originalTimeout(cb, ms, ...args);
  w.SGDI_API.ui.sidebarStats = () => { calls++; return calls === 1 ? old.promise : Promise.resolve(statistics()); };
  const first = w.sgdiRefreshCountersNow(); await turn();
  w.sgdiInvalidateDrhReads();
  w.sgdiRefreshCountersNow(); w.sgdiRefreshCountersNow();
  old.resolve(statistics()); assert.equal(await first, null);
  assert.equal(queued.length, 1);
  await queued.shift()();
  assert.equal(calls, 2);
  assert.equal(queued.length, 0);
});

test('counter refresh follows a scope switch even without a data mutation', async t => {
  const { w, setSession } = await fixture(t), old = deferred();
  const scopes = [], queued = [], originalTimeout = w.setTimeout.bind(w);
  w.setTimeout = (cb, ms, ...args) => ms === 250 ? (queued.push(cb), -1) : originalTimeout(cb, ms, ...args);
  w.SGDI_API.ui.sidebarStats = params => { scopes.push(params.society); return params.society === 'ALPHA' ? old.promise : Promise.resolve(statistics('BETA')); };
  const first = w.sgdiRefreshCountersNow(); await turn();
  setSession('BETA'); w.sgdiRefreshCountersNow();
  old.resolve(statistics()); await first;
  assert.equal(queued.length, 1);
  await queued.shift()();
  assert.deepEqual(scopes, ['ALPHA', 'BETA']);
  assert.equal(w.SGDI_SIDEBAR_STATS.scope.active_society, 'BETA');
});

function prepareBootstrap(w) {
  w.eval('db=emptyDB(); sgdiFullDataReady=false;');
  w.syncCandidatesFromPostgres = async () => {};
  w.renderSidebar = () => {};
}

test('bootstrap waits for a current employee reference after an in-flight read is invalidated', async t => {
  const { w, db } = await fixture(t), old = deferred(), fresh = deferred();
  prepareBootstrap(w);
  let calls = 0;
  w.SGDI_API.employees.list = () => (++calls === 1 ? old.promise : fresh.promise);
  const loading = w.sgdiBackgroundSqlSync({ silent: true });
  w.sgdiInvalidateDrhReads();
  old.resolve([employee(1)]); await turn();
  assert.equal(calls, 2);
  assert.equal(w.eval('sgdiFullDataReady'), false);
  assert.equal(db().agents.length, 0);
  fresh.resolve([employee(2)]);
  assert.equal(await loading, true);
  assert.equal(db().agents[0].backendId, 2);
  assert.equal(w.eval('sgdiFullDataReady'), true);
});

test('failed retry after bootstrap invalidation cannot mark an empty reference ready', async t => {
  const { w, db } = await fixture(t), old = deferred();
  prepareBootstrap(w);
  let calls = 0;
  w.SGDI_API.employees.list = () => ++calls === 1 ? old.promise : Promise.reject(new Error('retry unavailable'));
  w.SGDI_API.employees.page = async () => { throw new Error('retry unavailable'); };
  const loading = w.sgdiBackgroundSqlSync({ silent: true });
  w.sgdiInvalidateDrhReads();
  old.resolve([employee(1)]);
  assert.equal(await loading, false);
  assert.equal(calls, 2);
  assert.equal(w.eval('sgdiFullDataReady'), false);
  assert.equal(db().agents.length, 0);
});

test('repeated bootstrap invalidation is bounded and remains visibly unready', async t => {
  const { w, db } = await fixture(t);
  prepareBootstrap(w);
  let calls = 0;
  w.SGDI_API.employees.list = async () => {
    calls++; w.sgdiInvalidateDrhReads(); return [employee(calls)];
  };
  assert.equal(await w.sgdiBackgroundSqlSync({ silent: true }), false);
  assert.equal(calls, 3);
  assert.equal(w.eval('sgdiFullDataReady'), false);
  assert.equal(db().agents.length, 0);
});

test('an old bootstrap cannot mark a new login ready; the new login starts its own cycle', async t => {
  const { w, db } = await fixture(t), old = deferred(), fresh = deferred();
  prepareBootstrap(w);
  let calls = 0;
  w.SGDI_API.employees.list = () => (++calls === 1 ? old.promise : fresh.promise);
  const first = w.sgdiBackgroundSqlSync({ silent: true });
  w.sessionStorage.setItem('sgdi_api_token_v1', 'token-B');
  const second = w.sgdiBackgroundSqlSync({ silent: true });
  old.resolve([employee(1)]);
  assert.equal(await first, false);
  await turn();
  assert.equal(calls, 2);
  assert.equal(w.eval('sgdiFullDataReady'), false);
  assert.equal(db().agents.length, 0);
  fresh.resolve([employee(2)]);
  assert.equal(await second, true);
  assert.equal(w.eval('sgdiFullDataReady'), true);
  assert.equal(db().agents[0].backendId, 2);
});

test('current employee helper preserves offline and unauthenticated no-op behavior', async t => {
  const { w } = await fixture(t);
  let calls = 0;
  w.SGDI_API.employees.list = async () => { calls++; return [employee(1)]; };
  w.sgdiBackendShouldUse = () => false;
  assert.equal(await w.sgdiPullCurrentEmployees({ silent: true }), null);
  w.sgdiBackendShouldUse = () => true;
  w.sessionStorage.removeItem('sgdi_api_token_v1');
  assert.equal(await w.sgdiPullCurrentEmployees({ silent: true }), null);
  assert.equal(calls, 0);
});

test('NIN lookup waits for the current employee read after invalidation', async t => {
  const { w } = await fixture(t), old = deferred(), fresh = deferred();
  let calls = 0;
  w.SGDI_API.employees.list = () => (++calls === 1 ? old.promise : fresh.promise);
  const lookup = w.findEmployeeByNin('1234567890');
  w.sgdiInvalidateDrhReads();
  old.resolve([{ ...employee(1), nin: '1234567890' }]); await turn();
  assert.equal(calls, 2);
  fresh.resolve([{ ...employee(2), nin: '1234567890' }]);
  assert.equal((await lookup).backendId, 2);
});

test('contract employee freshness waits through invalidation before its success render', async t => {
  const { w, db } = await fixture(t), old = deferred(), fresh = deferred();
  w.eval(fs.readFileSync(path.join(__dirname, '../app/static/js/modules/contracts.js'), 'utf8'));
  w.sgdiShowDataLoadingBar = () => {};
  let calls = 0, renders = 0;
  w.renderView = () => { renders++; };
  w.SGDI_API.employees.list = () => (++calls === 1 ? old.promise : fresh.promise);
  assert.equal(w.ensureContratsEmployeesFresh(w.document.getElementById('view')), true);
  w.sgdiInvalidateDrhReads();
  old.resolve([employee(1)]); await turn();
  assert.equal(calls, 2);
  assert.equal(renders, 0, 'the cancelled response must not complete the contract loader');
  fresh.resolve([employee(2)]); await turn();
  assert.equal(renders, 1);
  assert.equal(db().agents[0].backendId, 2);
  assert.equal(w.ensureContratsEmployeesFresh(w.document.getElementById('view')), false);
  assert.equal(calls, 2);
});
