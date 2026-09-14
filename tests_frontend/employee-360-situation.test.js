// LOT ERP — DOSSIER EMPLOYÉ 360° V1 (item 5, "SITUATION À TRAITER").
// Consomme EXCLUSIVEMENT le moteur d'alertes déterministe existant (Lot 0.6-A) :
// aucune alerte n'est inventée côté frontend. Chargement différé (jamais dans le
// chemin de rendu synchrone), avec garde de fraîcheur contre les races A/B.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

function bootPanel(app, employeeId) {
  const w = app.window;
  const host = w.document.createElement('div');
  host.id = 'employee-situation-panel-' + employeeId;
  host.dataset.loading = '1';
  host.innerHTML = '<div class="rh-erp-situation-title">SITUATION À TRAITER</div><div class="rh-erp-situation-body"><span class="text-xs text-slate-400 italic">Chargement…</span></div>';
  w.document.body.appendChild(host);
  return host;
}

test('affiche les alertes réelles renvoyées par le moteur (criticité, titre, résumé, date, bouton Voir)', async () => {
  const app = loadSgdiApp(['loadEmployeeSituationAlerts']);
  const w = app.window, t = app.T();
  w.canAccess = () => true;
  const calls = [];
  w.sgdiApi = async (path) => {
    calls.push(path);
    return {
      items: [{
        id: 7, severity: 'critical', title: 'Contrat expirant — E1', summary: 'Expire dans 18 jours',
        last_detected_at: '2026-09-14T10:00:00',
      }],
      total: 1, page: 1, page_size: 10, pages: 1,
    };
  };
  bootPanel(app, 'emp-1');
  await t.loadEmployeeSituationAlerts({ id: 'emp-1', backendId: 101 });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/alerts\?employee_id=101&status=open&page_size=10$/, "doit interroger le moteur avec l'employee_id réel, jamais un ID fabriqué");
  const host = w.document.getElementById('employee-situation-panel-emp-1');
  assert.equal(host.dataset.loading, '0');
  const text = host.textContent;
  assert.match(text, /Critique/);
  assert.match(text, /Contrat expirant — E1/);
  assert.match(text, /Expire dans 18 jours/);
  assert.match(text, /2026-09-14/);
  assert.ok(host.querySelector('button'), 'bouton Voir attendu');
  assert.match(host.querySelector('button').getAttribute('onclick'), /navigate\('alerts\/7'\)/);
  w.close();
});

test('aucune alerte : état vide explicite, jamais de carte inventée', async () => {
  const app = loadSgdiApp(['loadEmployeeSituationAlerts']);
  const w = app.window, t = app.T();
  w.canAccess = () => true;
  w.sgdiApi = async () => ({ items: [], total: 0, page: 1, page_size: 10, pages: 1 });
  bootPanel(app, 'emp-2');
  await t.loadEmployeeSituationAlerts({ id: 'emp-2', backendId: 102 });
  const host = w.document.getElementById('employee-situation-panel-emp-2');
  assert.match(host.textContent, /Aucune situation à traiter/);
  assert.equal(host.querySelectorAll('.rh-erp-situation-card').length, 0);
  w.close();
});

test('erreur API : message clair affiché, pas de crash, pas de page blanche', async () => {
  const app = loadSgdiApp(['loadEmployeeSituationAlerts']);
  const w = app.window, t = app.T();
  w.canAccess = () => true;
  w.sgdiApi = async () => { throw new Error('Serveur indisponible'); };
  bootPanel(app, 'emp-3');
  await t.loadEmployeeSituationAlerts({ id: 'emp-3', backendId: 103 });
  const host = w.document.getElementById('employee-situation-panel-emp-3');
  assert.match(host.textContent, /Serveur indisponible/);
  w.close();
});

test('permission : sans le droit Alertes existant, la section est retirée (aucun appel réseau, aucun nouveau droit)', async () => {
  const app = loadSgdiApp(['loadEmployeeSituationAlerts']);
  const w = app.window, t = app.T();
  const calls = [];
  w.canAccess = (key) => { calls.push(key); return false; };
  w.sgdiApi = async () => { throw new Error('ne doit jamais être appelé'); };
  bootPanel(app, 'emp-4');
  await t.loadEmployeeSituationAlerts({ id: 'emp-4', backendId: 104 });
  assert.deepEqual(calls, ['alerts'], 'doit réutiliser EXACTEMENT le droit "alerts" existant, sans en inventer un autre');
  assert.equal(w.document.getElementById('employee-situation-panel-emp-4'), null, 'la section retirée doit disparaître du DOM, pas juste se vider');
  w.close();
});

test('course A/B : employé A ouvert avec une réponse lente, puis B ouvert avant que A ne réponde -> la réponse de A n\'apparaît jamais dans le panneau de B', async () => {
  const app = loadSgdiApp(['loadEmployeeSituationAlerts']);
  const w = app.window, t = app.T();
  w.canAccess = () => true;
  let resolveA;
  w.sgdiApi = async (path) => {
    if (path.includes('employee_id=201')) {
      return new Promise(resolve => { resolveA = () => resolve({ items: [{ id: 1, severity: 'critical', title: 'ALERTE DE A — NE DOIT PAS APPARAÎTRE CHEZ B', summary: '', last_detected_at: '' }], total: 1, page: 1, page_size: 10, pages: 1 }); });
    }
    return { items: [{ id: 2, severity: 'info', title: 'Alerte de B', summary: '', last_detected_at: '' }], total: 1, page: 1, page_size: 10, pages: 1 };
  };
  const hostA = bootPanel(app, 'emp-A');
  const pendingA = t.loadEmployeeSituationAlerts({ id: 'emp-A', backendId: 201 });

  // Navigation vers B avant la résolution de A : nouvelle génération de rendu +
  // le panneau de A n'existe plus (remplacé par celui de B), comme lors d'une
  // vraie navigation entre deux fiches employé.
  w.sgdiViewRenderGeneration = (w.sgdiViewRenderGeneration || 0) + 1;
  hostA.remove();
  const hostB = bootPanel(app, 'emp-B');
  await t.loadEmployeeSituationAlerts({ id: 'emp-B', backendId: 202 });
  assert.match(hostB.textContent, /Alerte de B/);

  // La réponse tardive de A se résout maintenant : elle ne doit RIEN modifier
  // (son propre host a été retiré du DOM, la garde de fraîcheur doit bloquer).
  resolveA();
  await pendingA;
  assert.doesNotMatch(w.document.body.textContent, /ALERTE DE A/, 'la réponse tardive de A ne doit jamais apparaître, ni chez B ni ailleurs');
  assert.match(hostB.textContent, /Alerte de B/, 'le panneau de B doit rester intact après la résolution tardive de A');
  w.close();
});
