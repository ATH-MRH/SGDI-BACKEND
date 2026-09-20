// PERF P1 (DRH) — tableau de bord général : ses KPI dépendant des employés doivent provenir
// en priorité de l'agrégat serveur (window.SGDI_SIDEBAR_STATS), jamais de la collection
// complète db.agents forcée pour l'occasion. Voir rapport de mission pour le détail de
// l'architecture (sgdiSqlSyncTasks garde volontairement son chargement bloquant existant,
// décision déjà prise et testée — commit 3a1dc46 — donc non modifiée ici) : ce lot rend
// spécifiquement renderDashboard() lui-même indépendant de db.agents pour ses chiffres,
// première étape sûre avant de pouvoir un jour retirer ce chargement bloquant ailleurs.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

function baseDb() {
  return {
    agents: [], sites: [], candidats: [], incidents: [], conges: [], contrats: [],
    materiel: [], clients: [], stockArticles: [], feuillePresence: [], echanges: [],
    contratsPersonnel: [], demandesPersonnel: [],
  };
}

function kpiValue(view, label) {
  const card = [...view.querySelectorAll('.dash-kpi')].find(a => a.querySelector('.label')?.textContent === label);
  return card ? card.querySelector('.value')?.textContent : undefined;
}

test('dashboard général : KPI "Effectif actif" utilise l\'agrégat serveur, jamais un full-fetch, même avec db.agents vide', () => {
  const ctx = loadSgdiApp(['renderDashboard']);
  assert.ifError(ctx.loadError);
  const { window, T } = ctx;
  try {
    T().setSession({ username: 'RH01', role: 'rh', societe: 'IRON', transverse: 'drh', structuresAutorisees: [] });
    T().setDb(baseDb()); // collection employés VIDE — jamais peuplée par ce test
    window.SGDI_SIDEBAR_STATS = {
      scope: { active_society: 'IRON' },
      erp: { employees: { total: 164, active: 140, absent: 3, leave_current: 5, sick_leave_current: 2 } },
    };
    const view = window.document.getElementById('view');
    T().renderDashboard(view);
    assert.strictEqual(kpiValue(view, 'Effectif actif'), '140', 'doit afficher la valeur serveur, pas 0 issu d\'une collection locale vide');
    assert.match(view.querySelector('.dash-kpi .sub')?.textContent || view.innerHTML, /164/, 'le total serveur doit apparaître en sous-texte');
  } finally { window.close(); }
});

test('dashboard général : sans agrégat serveur ET sans donnée locale, affiche un état "en attente" honnête (jamais un 0 trompeur)', () => {
  const ctx = loadSgdiApp(['renderDashboard']);
  assert.ifError(ctx.loadError);
  const { window, T } = ctx;
  try {
    T().setSession({ username: 'RH01', role: 'rh', societe: 'IRON', transverse: 'drh', structuresAutorisees: [] });
    T().setDb(baseDb());
    window.SGDI_SIDEBAR_STATS = null;
    const view = window.document.getElementById('view');
    T().renderDashboard(view);
    assert.strictEqual(kpiValue(view, 'Effectif actif'), '…', 'un "0" ici laisserait croire à un effectif réellement nul');
  } finally { window.close(); }
});

test('dashboard général : si db.agents est déjà peuplé localement (chargé par un autre écran), les chiffres restent corrects sans agrégat serveur', () => {
  const ctx = loadSgdiApp(['renderDashboard']);
  assert.ifError(ctx.loadError);
  const { window, T } = ctx;
  try {
    T().setSession({ username: 'RH01', role: 'rh', societe: '', transverse: 'drh', structuresAutorisees: [] });
    const db = baseDb();
    db.agents = [
      { id: 'a1', societe: 'IRON', statut: 'actif' },
      { id: 'a2', societe: 'IRON', statut: 'actif' },
      { id: 'a3', societe: 'IRON', statut: 'absent' },
    ];
    T().setDb(db);
    window.SGDI_SIDEBAR_STATS = null;
    const view = window.document.getElementById('view');
    T().renderDashboard(view);
    assert.strictEqual(kpiValue(view, 'Effectif actif'), '2', 'repli local correct quand des données existent déjà (aucun fetch déclenché par renderDashboard lui-même)');
  } finally { window.close(); }
});

test('dashboard général : société A/B isolées — les stats serveur d\'une autre société ne fuitent jamais', () => {
  const ctx = loadSgdiApp(['renderDashboard']);
  assert.ifError(ctx.loadError);
  const { window, T } = ctx;
  try {
    T().setSession({ username: 'RH01', role: 'rh', societe: 'SOCIETE-B', transverse: 'drh', structuresAutorisees: [] });
    T().setDb(baseDb());
    // Stats serveur périmées / encore pour une AUTRE société (SOCIETE-A) — ne doivent
    // jamais s'afficher comme si elles décrivaient la société active (SOCIETE-B).
    window.SGDI_SIDEBAR_STATS = {
      scope: { active_society: 'SOCIETE-A' },
      erp: { employees: { total: 999, active: 999 } },
    };
    const view = window.document.getElementById('view');
    T().renderDashboard(view);
    assert.notStrictEqual(kpiValue(view, 'Effectif actif'), '999', 'les stats de SOCIETE-A ne doivent jamais apparaître pour SOCIETE-B');
    assert.strictEqual(kpiValue(view, 'Effectif actif'), '…', 'sans donnée locale ni stats pour la bonne société, état honnête attendu');
  } finally { window.close(); }
});

test('dashboard général : renderDashboard() lui-même ne déclenche jamais de chargement employés (aucun appel à sgdiEnsureEmployeesForDisplay/sgdiPullEmployees/sgdiPullCurrentEmployees)', () => {
  const ctx = loadSgdiApp(['renderDashboard']);
  assert.ifError(ctx.loadError);
  const { window, T } = ctx;
  try {
    T().setSession({ username: 'RH01', role: 'rh', societe: 'IRON', transverse: 'drh', structuresAutorisees: [] });
    T().setDb(baseDb());
    window.SGDI_SIDEBAR_STATS = { scope: { active_society: 'IRON' }, erp: { employees: { total: 10, active: 8 } } };
    let called = false;
    window.sgdiEnsureEmployeesForDisplay = () => { called = true; };
    window.sgdiPullEmployees = () => { called = true; };
    window.sgdiPullCurrentEmployees = () => { called = true; };
    const view = window.document.getElementById('view');
    T().renderDashboard(view);
    assert.strictEqual(called, false, 'renderDashboard() ne doit jamais lui-même provoquer un chargement employés — voir rapport pour le chargement bloquant amont, hors périmètre de cette fonction');
  } finally { window.close(); }
});

test('dashboard général : les KPI indépendants des employés (incidents, congés en attente) restent inchangés, avec ou sans agrégat serveur', () => {
  const ctx = loadSgdiApp(['renderDashboard']);
  assert.ifError(ctx.loadError);
  const { window, T } = ctx;
  try {
    T().setSession({ username: 'RH01', role: 'rh', societe: '', transverse: 'drh', structuresAutorisees: [] });
    const db = baseDb();
    db.incidents = [{ statut: 'en_cours' }, { statut: 'en_cours' }, { statut: 'clos' }];
    db.conges = [{ statut: 'en_attente' }, { statut: 'approuve' }];
    T().setDb(db);
    window.SGDI_SIDEBAR_STATS = null;
    const view = window.document.getElementById('view');
    T().renderDashboard(view);
    const alertsText = [...view.querySelectorAll('.dash-alert')].map(a => a.textContent).join(' | ');
    assert.match(alertsText, /Evènements en cours[\s\S]*?2/, 'incidents en_cours ne dépend jamais de db.agents');
    assert.match(alertsText, /Congés en attente[\s\S]*?1/, 'congés en_attente ne dépend jamais de db.agents');
  } finally { window.close(); }
});
