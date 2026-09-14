// Cockpit Alertes (Lot 0.6-A) — module lazy app/static/js/modules/alerts.js.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

function samplePage(overrides) {
  return Object.assign({
    items: [{
      id: 1, rule_key: 'drh.employee_contract.expiring', rule_version: 1, source_type: 'employee', source_id: '1',
      society: 'IRON GLOBAL SECURITE', site_id: null, status: 'open', severity: 'critical', score: 90, confidence: 100,
      title: 'Contrat expirant — E1', summary: 'Expire dans 2 jours', first_detected_at: '2026-09-13T10:00:00',
      last_detected_at: '2026-09-13T10:00:00', occurrence_count: 1, assigned_user_id: null, dedup_key: 'x',
    }],
    total: 1, page: 1, page_size: 50, pages: 1,
  }, overrides || {});
}
const sampleStats = { total_open: 3, critical: 1, unacknowledged: 2, assigned_to_me: 0 };

test('module alerts : enregistré et routé', () => {
  const app = loadSgdiApp(['renderAlerts']);
  assert.equal(app.loadError, null, app.loadError && app.loadError.stack);
  const w = app.window;
  assert.ok(w.SGDIModules.isModuleRegistered('alerts'));
  assert.equal(w.SGDIModules.moduleKeyForRoute('alerts'), 'alerts');
  w.close();
});

test('renderAlerts : accès refusé sans le droit existant, sans le moindre appel réseau', async () => {
  const app = loadSgdiApp(['renderAlerts']);
  const w = app.window;
  app.T().setSession({ username: 'agent1', transverse: 'drh', role: 'AG' }); // rôle non-admin, aucun droit "alerts" accordé
  const calls = [];
  w.sgdiApi = async (url) => { calls.push(url); return {}; };
  const view = w.document.getElementById('view');
  await app.T().renderAlerts(view);
  assert.match(view.textContent, /Accès refusé/);
  assert.deepEqual(calls, [], 'canAccess() doit bloquer AVANT tout appel réseau — même mécanisme que agenda.js/ops.js/pointage.js');
  w.close();
});

test('renderAlerts : charge stats + liste une seule fois et affiche les KPI/le tableau', async () => {
  const app = loadSgdiApp(['renderAlerts']);
  const w = app.window;
  app.T().setSession({ username: 'admin', transverse: 'admin', role: 'ADM' });
  const calls = [];
  w.sgdiApi = async (url) => {
    calls.push(url);
    if (url.startsWith('/alerts/stats')) return sampleStats;
    return samplePage();
  };
  const view = w.document.getElementById('view');
  await app.T().renderAlerts(view);
  assert.equal(calls.filter(u => u === '/alerts/stats').length, 1);
  assert.equal(calls.filter(u => u.startsWith('/alerts?')).length, 1);
  assert.match(view.textContent, /Cockpit Alertes/);
  assert.match(view.textContent, /Contrat expirant — E1/);
  assert.match(view.textContent, /90\/100/);
  w.close();
});

test('renderAlerts : état vide propose de réinitialiser les filtres', async () => {
  const app = loadSgdiApp(['renderAlerts']);
  const w = app.window;
  app.T().setSession({ username: 'admin', transverse: 'admin', role: 'ADM' });
  w.sgdiApi = async (url) => (url.startsWith('/alerts/stats') ? sampleStats : samplePage({ items: [], total: 0, pages: 1 }));
  const view = w.document.getElementById('view');
  await app.T().renderAlerts(view);
  assert.match(view.textContent, /Aucune alerte trouvée/);
  assert.ok(view.querySelector('button[onclick="alertsResetFilters()"]'));
  w.close();
});

test('renderAlerts : erreur réseau affiche une carte d\'erreur, pas de page blanche', async () => {
  const app = loadSgdiApp(['renderAlerts']);
  const w = app.window;
  app.T().setSession({ username: 'admin', transverse: 'admin', role: 'ADM' });
  w.sgdiApi = async () => { throw new Error('Serveur indisponible'); };
  const view = w.document.getElementById('view');
  await app.T().renderAlerts(view);
  assert.match(view.textContent, /Serveur indisponible/);
  w.close();
});

test('renderAlerts : route de détail "alerts/<id>" (2 segments réels, cf. renderView -> [root,sub,arg]) affiche score, facteurs, preuves et historique', async () => {
  const app = loadSgdiApp(['renderAlerts']);
  const w = app.window;
  app.T().setSession({ username: 'admin', transverse: 'admin', role: 'ADM' });
  w.sgdiApi = async (url) => {
    assert.equal(url, '/alerts/1');
    return {
      id: 1, rule_key: 'drh.employee_contract.expiring', title: 'Contrat expirant — E1', summary: 'Expire dans 2 jours',
      society: 'IRON GLOBAL SECURITE', site_id: null, status: 'open', severity: 'critical', score: 90, confidence: 100,
      occurrence_count: 1, explanation: "Score 90/100 : proximité de l'échéance (+80), statut employé actif (+10).",
      score_factors: [{ key: 'days_remaining_band', label: 'Contrat expire dans 2 jour(s)', value: 2, weight: 80, contribution: 80 }],
      evidence: [{ id: 1, evidence_type: 'employee', evidence_key: 'detection_snapshot', evidence_value_json: { employee_code: 'E1' }, observed_at: '2026-09-13T10:00:00' }],
      history: [{ id: 1, action: 'detected', previous_status: null, new_status: 'open', reason: null, created_at: '2026-09-13T10:00:00' }],
    };
  };
  const view = w.document.getElementById('view');
  // Hash réel "#/alerts/1" -> path.split("/") = ["alerts","1"] -> sub="1", arg=undefined.
  // C'est EXACTEMENT ce que produisent href="#/alerts/${a.id}" et navigate('alerts/'+id) :
  // un seul argument après renderAlerts(view, sub). Appeler avec un 3e argument fictif,
  // comme le faisait cet ancien test, masquait le bug réel du bouton "Ouvrir".
  await app.T().renderAlerts(view, '1');
  assert.match(view.textContent, /90/);
  assert.match(view.textContent, /proximité de l'échéance/);
  assert.match(view.textContent, /E1/);
  assert.match(view.textContent, /detected/);
  w.close();
});

test('renderAlerts : un 3e segment de route (arg) inexistant en pratique ne doit plus être requis pour ouvrir le détail', async () => {
  const app = loadSgdiApp(['renderAlerts']);
  const w = app.window;
  app.T().setSession({ username: 'admin', transverse: 'admin', role: 'ADM' });
  const calls = [];
  w.sgdiApi = async (url) => { calls.push(url); return { id: 42, score_factors: [], evidence: [], history: [] }; };
  const view = w.document.getElementById('view');
  await app.T().renderAlerts(view, '42', undefined); // signature réelle passée par le routeur pour "#/alerts/42"
  assert.deepEqual(calls, ['/alerts/42'], 'sub seul doit suffire à identifier l\'alerte à ouvrir');
  w.close();
});

test('alertsIgnorePrompt : ouvre une modale exigeant un motif', () => {
  const app = loadSgdiApp(['alertsIgnorePrompt']);
  const w = app.window;
  w.openModal = (html) => { w.document.getElementById('modal-host').innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`; };
  app.T().alertsIgnorePrompt(1);
  const textarea = w.document.querySelector('#modal-host textarea[name="reason"]');
  assert.ok(textarea);
  assert.equal(textarea.required, true);
  w.close();
});

test('alertsAction : poste l\'action puis rafraîchit la vue détail', async () => {
  const app = loadSgdiApp(['alertsAction']);
  const w = app.window;
  const calls = [];
  w.sgdiApi = async (url, opts) => { calls.push([url, opts.method]); return {}; };
  const navigated = [];
  w.navigate = (r) => navigated.push(r);
  w.toast = () => {};
  await app.T().alertsAction(1, 'acknowledge');
  assert.deepEqual(calls[0], ['/alerts/1/acknowledge', 'POST']);
  assert.deepEqual(navigated, ['alerts/1']);
  w.close();
});

test('destroy du module vide le cache local sans jeter', () => {
  const app = loadSgdiApp([]);
  const w = app.window;
  const mod = w.SGDIModules.getModule('alerts');
  assert.doesNotThrow(() => mod.destroy());
  w.close();
});
