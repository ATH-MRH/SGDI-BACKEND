// Un matricule officiel n'est jamais modifié silencieusement par l'écran : affichage exact,
// envoi tel quel, action dédiée avec motif et confirmation, repair-codes en deux temps.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const names = ['employeeFromApi', 'normalizeEmployeeCodesInDB', 'employeeApiPayload', 'employeeCodeIsOfficial', 'openEmployeeCodeChange',
  'submitEmployeeCodeChange', 'previewEmployeeCodeRepair', 'confirmEmployeeCodeRepair'];

function fixture(responses = {}) {
  const ctx = loadSgdiApp(names);
  assert.ifError(ctx.loadError);
  const api = ctx.T(), win = ctx.window, calls = [];
  if (!win.document.getElementById('modal-host')) { const host = win.document.createElement('div'); host.id = 'modal-host'; win.document.body.appendChild(host); }
  win.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const key = Object.keys(responses).find(k => String(url).includes(k) && (responses[k].method || 'GET') === (opts.method || 'GET'));
    const reply = key ? responses[key] : { status: 200, body: {} };
    const body = typeof reply.body === 'function' ? reply.body() : reply.body;
    return { ok: reply.status < 400, status: reply.status, text: async () => JSON.stringify(body), json: async () => body };
  };
  const payload = Buffer.from(JSON.stringify({ sub: '1', admin_system: true, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  win.sessionStorage.setItem('sgdi_api_token_v1', `x.${payload}.y`);
  api.setSession({ username: 'ADMSYS', nom: 'Admin', role: 'ADM', niveau: 'H5', adminSystem: true });
  return { ...ctx, api, win, calls, $: id => win.document.getElementById(id), text: () => win.document.getElementById('modal-host').textContent };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('le matricule enregistré est affiché et renvoyé tel quel (A001 ne devient jamais A01)', () => {
  const { api, window } = fixture();
  try {
    const agent = api.employeeFromApi({ id: 7, code: 'A001', first_name: 'ALI', last_name: 'ZERO', society: 'SOC', extra: {} });
    assert.equal(agent.matricule, 'A001'); assert.equal(agent.code, 'A001');
    api.setDb({ agents: [{ ...agent, id: 'a1', telephone: '0550000000' }, { id: 'a2', code: 'X1', matricule: 'X1', nom: 'UN', prenom: 'X', backendId: 8 }] });
    api.normalizeEmployeeCodesInDB();                                             // alignement des champs, jamais de reformatage
    const db = window.__sgdiTest.getDb();
    assert.deepEqual(db.agents.map(a => [a.code, a.matricule]), [['A001', 'A001'], ['X1', 'X1']]);
    assert.ok(db.agents.every(a => !a.extra || (a.extra.code === a.code && a.extra.matricule === a.code)));
    // Modifier le téléphone : le matricule envoyé reste exactement celui enregistré.
    const payload = api.employeeApiPayload({ ...db.agents[0], telephone: '0661000000' });
    assert.equal(payload.code, 'A001'); assert.equal(payload.phone, '0661000000');
    assert.equal(api.employeeApiPayload(db.agents[1]).code, 'X1');
  } finally { window.close(); }
});

test('modification explicite : motif et confirmation exigés, puis appel de l\'action dédiée', async () => {
  const saved = { id: 7, code: 'B200', first_name: 'ALI', last_name: 'ZERO', society: 'SOC',
    extra: { matriculeOfficiel: { fige: true, valeur: 'B200', source: 'modification_explicite' } } };
  const { api, window, calls, $, text } = fixture({ '/api/drh/employees/7/matricule': { method: 'PATCH', status: 200, body: saved } });
  try {
    api.setDb({ agents: [{ id: 'a1', backendId: 7, code: 'A001', matricule: 'A001', nom: 'ZERO', prenom: 'ALI', societe: 'SOC' }] });
    api.openEmployeeCodeChange('a1');
    assert.match(text(), /matricule actuel A001/);
    $('employee-code-new').value = 'b200';
    await api.submitEmployeeCodeChange('a1');
    assert.match($('employee-code-error').textContent, /motif est obligatoire/);
    $('employee-code-reason').value = 'Erreur de saisie à l\'embauche';
    await api.submitEmployeeCodeChange('a1');
    assert.match($('employee-code-error').textContent, /Cochez la confirmation/);
    assert.equal(calls.filter(c => c.url.includes('/matricule')).length, 0);
    $('employee-code-confirm').checked = true;
    await api.submitEmployeeCodeChange('a1');
    const call = calls.find(c => c.url.includes('/matricule'));
    assert.equal(call.method, 'PATCH');
    assert.deepEqual(call.body, { new_code: 'B200', reason: 'Erreur de saisie à l\'embauche', confirm: true });
    const agent = window.__sgdiTest.getDb().agents[0];
    assert.equal(agent.matricule, 'B200'); assert.equal(api.employeeCodeIsOfficial(agent), true);
    await new Promise(resolve => setTimeout(resolve, 300));                     // fin du re-rendu déclenché par l'enregistrement
  } finally { window.close(); }
});

test('repair-codes : aperçu sans écriture, confirmation explicite du même aperçu, bilan', async () => {
  const plan = { plan_id: 'p'.repeat(40), counts: { employees: 3, changes: 1, code_changes: 1, protected: 1, conflicts: 0 },
    changes: [{ employee_id: 2, name: 'HORS Serie', society: 'SOC', current: 'ZZ-1', proposed: 'A02', reason: 'Matricule hors de la série de la société', protected: false, conflict: null }],
    protected: [{ employee_id: 1, name: 'FIGE <b>x</b>', society: 'SOC', current: 'A001', proposed: 'A001', reason: 'Matricule officiel protégé : exclu de la renumérotation', protected: true, conflict: null }] };
  const { api, window, calls, $, text } = fixture({
    '/api/drh/employees/repair-codes/plan': { status: 200, body: plan },
    '/api/drh/employees/repair-codes': { method: 'POST', status: 200, body: { plan_id: plan.plan_id, counts: { changed: 1, synchronized: 0, protected_skipped: 1, employees: 3 }, already_processed: false } },
  });
  try {
    await api.previewEmployeeCodeRepair();
    assert.deepEqual(calls.map(c => c.method), ['GET']);                         // aperçu : lecture seule
    assert.match(text(), /ZZ-1.*A02.*hors de la série/s);
    assert.match(text(), /Matricules protégés \(exclus\).*A001.*Oui/s);
    assert.equal(window.document.querySelectorAll('#modal-host b b, #modal-host script').length, 0);
    await api.confirmEmployeeCodeRepair();                                        // case non cochée : rien n'est envoyé
    assert.equal(calls.filter(c => c.method === 'POST').length, 0);
    $('employee-code-repair-confirm').checked = true;
    await api.confirmEmployeeCodeRepair();
    const post = calls.find(c => c.method === 'POST');
    assert.deepEqual(post.body, { plan_id: plan.plan_id });
    await tick();
    assert.match(text(), /1 matricule\(s\) modifié\(s\).*1 matricule\(s\) protégé\(s\) exclu\(s\)/s);
  } finally { window.close(); }
});

test('repair-codes : base modifiée depuis l\'aperçu → refus affiché, aucun bilan', async () => {
  const plan = { plan_id: 'q'.repeat(40), counts: { employees: 1, changes: 1, code_changes: 1, protected: 0, conflicts: 0 },
    changes: [{ employee_id: 2, name: 'X', society: 'S', current: 'ZZ', proposed: 'A01', reason: 'r', protected: false, conflict: null }], protected: [] };
  const { api, window, $, text } = fixture({
    '/api/drh/employees/repair-codes/plan': { status: 200, body: plan },
    '/api/drh/employees/repair-codes': { method: 'POST', status: 409, body: { detail: 'La base a changé depuis l\'aperçu : relancez l\'aperçu avant de confirmer.' } },
  });
  try {
    await api.previewEmployeeCodeRepair();
    $('employee-code-repair-confirm').checked = true;
    await api.confirmEmployeeCodeRepair();
    assert.doesNotMatch(text(), /Renumérotation terminée/);
    assert.ok($('employee-code-repair-confirm'), 'l\'aperçu reste affiché');
  } finally { window.close(); }
});
