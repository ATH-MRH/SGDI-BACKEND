// DOSSIER EMPLOYÉ 360° — REPRISE (item 2) : sections B (Informations
// contractuelles), D (Affectation actuelle) et E (Observations) de la Vue
// d'ensemble. Toutes lecture seule, dérivées exclusivement des données agent
// déjà en mémoire — aucun nouvel appel réseau, aucune nouvelle donnée métier
// inventée (gestionEvents, affectationCourante, dureeContrat existent déjà).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');

const NAMES = ['employeeContractOverviewHTML', 'employeeAffectationOverviewHTML', 'employeeObservationsHTML'];

test('Informations contractuelles : type, durée, poste et échéance dérivés des champs existants', () => {
  const app = loadSgdiApp(NAMES);
  assert.equal(app.loadError, null, app.loadError && app.loadError.stack);
  const t = app.T();
  t.setDb({ agents: [], contrats: [], contratsPersonnel: [] });
  const a = { id: 'e1', dureeContrat: '24m', dateRecrutement: '2024-01-10', fonction: 'Agent de sécurité' };
  const html = t.employeeContractOverviewHTML(a);
  assert.match(html, /erp-card/);
  assert.match(html, /Informations contractuelles/);
  assert.match(html, /24m/);
  assert.match(html, /Agent de sécurité/);
  app.window.close();
});

test('Affectation actuelle : site/client/poste/groupe/date lus depuis affectationCourante, sans nouvel appel', () => {
  const app = loadSgdiApp(NAMES);
  const t = app.T();
  t.setDb({});
  const a = { id: 'e2', affectationCourante: { siteName: 'Site DHL Alger', clientName: 'DHL', poste: 'Agent APS', groupe: 'B', dateDebut: '2025-03-01' } };
  const html = t.employeeAffectationOverviewHTML(a);
  assert.match(html, /Affectation actuelle/);
  assert.match(html, /Site DHL Alger/);
  assert.match(html, /DHL/);
  assert.match(html, /Agent APS/);
  assert.match(html, /Groupe B/);
  app.window.close();
});

test('Affectation actuelle : état vide explicite quand aucune affectation', () => {
  const app = loadSgdiApp(NAMES);
  const t = app.T();
  t.setDb({});
  const html = t.employeeAffectationOverviewHTML({ id: 'e3' });
  assert.match(html, /Affectation actuelle/);
  // 5 champs, tous "—"
  assert.equal((html.match(/—/g) || []).length, 5);
  app.window.close();
});

test('Observations : reprend les motifs déjà présents dans gestionEvents (aucune donnée inventée), les 3 plus récents', () => {
  const app = loadSgdiApp(NAMES);
  const t = app.T();
  const a = {
    id: 'e4',
    gestionEvents: [
      { type: 'Suspension', motif: 'Retard répété', du: '2026-01-05', createdAt: '2026-01-05' },
      { type: 'Convocation', motif: 'Entretien annuel', du: '2026-05-01', createdAt: '2026-05-01' },
      { type: 'Sans motif', motif: '', du: '2026-06-01', createdAt: '2026-06-01' },
      { type: 'Fin de contrat', motif: 'Non renouvellement', du: '2026-08-01', createdAt: '2026-08-01' },
      { type: 'Mise en demeure', motif: 'Absence injustifiée', du: '2026-09-01', createdAt: '2026-09-01' },
    ],
  };
  const html = t.employeeObservationsHTML(a);
  assert.match(html, /Observations/);
  assert.match(html, /Absence injustifiée/);
  assert.match(html, /Non renouvellement/);
  assert.match(html, /Entretien annuel/);
  assert.doesNotMatch(html, /Retard répété/, 'seuls les 3 plus récents doivent apparaître');
  assert.doesNotMatch(html, /Sans motif/, 'un événement sans motif ne doit jamais produire de ligne vide');
  app.window.close();
});

test('Observations : état vide explicite quand aucun motif existant', () => {
  const app = loadSgdiApp(NAMES);
  const t = app.T();
  const html = t.employeeObservationsHTML({ id: 'e5', gestionEvents: [] });
  assert.match(html, /Aucune observation enregistrée/);
  app.window.close();
});
