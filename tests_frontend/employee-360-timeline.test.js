// DOSSIER EMPLOYÉ 360° — REPRISE : agrégateur "Timeline 360°" (nouvel onglet
// fpTabs, chargement à la demande comme l'onglet "Portail RH" existant).
// Lecture seule, sources 100% existantes (gestionEvents/sanctions/
// affectationsHistorique/dates de contrat + moteur d'alertes Lot 0.6-A déjà
// consommé par "Situation à traiter"). Garde de fraîcheur A/B étendue ici.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

function bootTimelinePanel(w, employeeId) {
  const host = w.document.createElement('div');
  host.id = 'employee-timeline360-panel-' + employeeId;
  host.dataset.employeeId = employeeId;
  host.innerHTML = '<div class="rh-erp-timeline-body-list"><span class="text-xs text-slate-400 italic">Cliquez sur l\'onglet pour charger.</span></div>';
  w.document.body.appendChild(host);
  return host;
}

const NAMES = ['loadEmployeeTimeline360', 'collectEmployeeLocalTimelineEvents'];

test('événements locaux : agrège gestionEvents/sanctions/affectationsHistorique/dates de contrat, triés du plus récent au plus ancien, sans appel réseau nécessaire pour les afficher', async () => {
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  assert.equal(app.loadError, null, app.loadError && app.loadError.stack);
  w.canAccess = () => true;
  w.sgdiApi = async () => ({ items: [], total: 0, page: 1, page_size: 20, pages: 1 });
  const a = {
    id: 'emp-1', backendId: 101, dateRecrutement: '2023-02-01',
    gestionEvents: [{ type: 'Convocation', motif: 'Entretien', du: '2026-05-01', createdAt: '2026-05-01' }],
    sanctions: [{ type: 'Avertissement écrit', faute: 'Retard', dateInfraction: '2026-06-01' }],
    affectationsHistorique: [{ dateDebut: '2026-01-01', siteName: 'Site X', poste: 'Agent APS' }],
  };
  bootTimelinePanel(w, 'emp-1');
  await t.loadEmployeeTimeline360(a);
  const host = w.document.getElementById('employee-timeline360-panel-emp-1');
  const text = host.textContent;
  assert.match(text, /Recrutement/);
  assert.match(text, /Convocation/);
  assert.match(text, /Avertissement écrit/);
  assert.match(text, /Affectation/);
  assert.match(text, /Site X/);
  // Ordre décroissant : Avertissement (06-01) doit précéder Convocation (05-01) qui doit précéder Recrutement (02-2023).
  const idxSanction = text.indexOf('Avertissement écrit');
  const idxConvoc = text.indexOf('Convocation');
  const idxRecrut = text.indexOf('Recrutement');
  assert.ok(idxSanction < idxConvoc && idxConvoc < idxRecrut, 'ordre antichronologique attendu');
  w.close();
});

test('fusionne les alertes réelles du moteur existant (même endpoint que Situation à traiter, aucune donnée inventée)', async () => {
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  w.canAccess = () => true;
  const calls = [];
  w.sgdiApi = async (path) => {
    calls.push(path);
    return { items: [{ id: 9, title: 'Contrat expirant', summary: 'J-10', last_detected_at: '2026-09-20T00:00:00' }], total: 1, page: 1, page_size: 20, pages: 1 };
  };
  const a = { id: 'emp-2', backendId: 202, gestionEvents: [] };
  bootTimelinePanel(w, 'emp-2');
  await t.loadEmployeeTimeline360(a);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/alerts\?employee_id=202&page_size=20$/);
  const host = w.document.getElementById('employee-timeline360-panel-emp-2');
  assert.match(host.textContent, /Contrat expirant/);
  assert.match(host.textContent, /Alerte/);
  w.close();
});

test('aucun événement : état vide explicite', async () => {
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  w.canAccess = () => true;
  w.sgdiApi = async () => ({ items: [], total: 0, page: 1, page_size: 20, pages: 1 });
  const a = { id: 'emp-3', gestionEvents: [] };
  bootTimelinePanel(w, 'emp-3');
  await t.loadEmployeeTimeline360(a);
  assert.match(w.document.getElementById('employee-timeline360-panel-emp-3').textContent, /Aucun événement enregistré/);
  w.close();
});

test('permission : sans le droit "alerts" existant, les événements locaux restent affichés mais aucun appel réseau n\'est fait', async () => {
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  const calls = [];
  w.canAccess = (key) => { calls.push(key); return false; };
  w.sgdiApi = async () => { throw new Error('ne doit jamais être appelé'); };
  const a = { id: 'emp-4', gestionEvents: [{ type: 'Suspension', motif: 'Test', du: '2026-01-01' }] };
  bootTimelinePanel(w, 'emp-4');
  await t.loadEmployeeTimeline360(a);
  assert.deepEqual(calls, ['alerts']);
  assert.match(w.document.getElementById('employee-timeline360-panel-emp-4').textContent, /Suspension/);
  w.close();
});

test('erreur réseau sur les alertes : les événements locaux restent affichés, message d\'erreur additif, pas de crash', async () => {
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  w.canAccess = () => true;
  w.sgdiApi = async () => { throw new Error('Serveur indisponible'); };
  const a = { id: 'emp-5', gestionEvents: [{ type: 'Suspension', motif: 'Test', du: '2026-01-01' }] };
  bootTimelinePanel(w, 'emp-5');
  await t.loadEmployeeTimeline360(a);
  const host = w.document.getElementById('employee-timeline360-panel-emp-5');
  assert.match(host.textContent, /Suspension/);
  assert.match(host.textContent, /Serveur indisponible/);
  w.close();
});

test('course A/B : timeline de A ouverte avec réponse lente, puis B ouvert avant résolution -> la réponse de A n\'apparaît jamais chez B', async () => {
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  w.canAccess = () => true;
  let resolveA;
  w.sgdiApi = async (path) => {
    if (path.includes('employee_id=301')) {
      return new Promise(resolve => { resolveA = () => resolve({ items: [{ id: 1, title: 'ALERTE DE A — NE DOIT PAS APPARAÎTRE CHEZ B', summary: '', last_detected_at: '2026-09-01' }], total: 1, page: 1, page_size: 20, pages: 1 }); });
    }
    return { items: [{ id: 2, title: 'Alerte de B', summary: '', last_detected_at: '2026-09-01' }], total: 1, page: 1, page_size: 20, pages: 1 };
  };
  const hostA = bootTimelinePanel(w, 'emp-A');
  const pendingA = t.loadEmployeeTimeline360({ id: 'emp-A', backendId: 301, gestionEvents: [] });

  w.sgdiViewRenderGeneration = (w.sgdiViewRenderGeneration || 0) + 1;
  hostA.remove();
  const hostB = bootTimelinePanel(w, 'emp-B');
  await t.loadEmployeeTimeline360({ id: 'emp-B', backendId: 302, gestionEvents: [] });
  assert.match(hostB.textContent, /Alerte de B/);

  resolveA();
  await pendingA;
  assert.doesNotMatch(w.document.body.textContent, /ALERTE DE A/, 'la réponse tardive de A ne doit jamais apparaître, ni chez B ni ailleurs');
  assert.match(hostB.textContent, /Alerte de B/, 'le panneau de B doit rester intact après la résolution tardive de A');
  w.close();
});

test('réouverture de l\'onglet : les alertes déjà fusionnées ne déclenchent pas un second appel réseau', async () => {
  const app = loadSgdiApp(NAMES);
  const w = app.window, t = app.T();
  w.canAccess = () => true;
  let calls = 0;
  w.sgdiApi = async () => { calls++; return { items: [], total: 0, page: 1, page_size: 20, pages: 1 } };
  const a = { id: 'emp-6', backendId: 601, gestionEvents: [] };
  bootTimelinePanel(w, 'emp-6');
  await t.loadEmployeeTimeline360(a);
  await t.loadEmployeeTimeline360(a);
  assert.equal(calls, 1, 'un seul appel réseau attendu même après réouverture de l\'onglet');
  w.close();
});
