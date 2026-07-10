// Tests FRONTEND du module OPS — vraies fonctions de app/static/sgdi-app.js.
// Couvre : rattachement site<->société, correspondance site<->référence,
// effectif contractuel client, et conversion des données serveur (sites, affectations).
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const { loadError, T } = loadSgdiApp([
  'sitePrimarySociete',
  'siteBelongsToPrimarySociete',
  'siteMatchesSociete',
  'siteMatchesReference',
  'clientSiteEffectif',
  'clientTotalEffectif',
  'siteFromApi',
  'assignmentFromApi',
  'agentLiveAffectation',
  'normalizeSocieteName',
]);

test('sgdi-app.js se charge et expose les fonctions OPS', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  const t = T();
  for (const name of ['sitePrimarySociete', 'siteMatchesSociete', 'siteFromApi']) {
    assert.ok(t[name], `${name} introuvable`);
  }
});

// ── Rattachement d'un site à sa société ──────────────────────────────────────

test('sitePrimarySociete: lit societe, puis equipment_plan, puis _legacy', () => {
  const f = T().sitePrimarySociete;
  assert.strictEqual(f({ societe: 'Iron Global Securite' }), 'Iron Global Securite');
  assert.strictEqual(f({ society: 'Sword Corporation' }), 'Sword Corporation');
  assert.strictEqual(f({ equipment_plan: { societe: 'Iron Global Solution' } }), 'Iron Global Solution');
  assert.strictEqual(f({ equipment_plan: { _legacy: { societe: 'Sword Construction' } } }), 'Sword Construction');
  // Le champ direct prime sur equipment_plan
  assert.strictEqual(f({ societe: 'A', equipment_plan: { societe: 'B' } }), 'A');
  assert.strictEqual(f({}), '');
  assert.strictEqual(f(null), '');
});

test('siteBelongsToPrimarySociete: comparaison insensible aux accents et à la casse', () => {
  const f = T().siteBelongsToPrimarySociete;
  const site = { societe: 'Iron Global Sécurité' };
  assert.strictEqual(f(site, 'iron global securite'), true);
  assert.strictEqual(f(site, 'IRON GLOBAL SÉCURITÉ'), true);
  assert.strictEqual(f(site, 'Sword Corporation'), false);
  assert.strictEqual(f(site, ''), true, 'sans filtre société, tout passe');
});

test('siteMatchesSociete: retombe sur les agents affectés quand le site n\'a pas de société', () => {
  const t = T();
  t.setDb({
    agents: [
      { id: 'ag1', societe: 'Sword Corporation', affectationCourante: { siteId: 's9' } },
      { id: 'ag2', societe: 'Iron Global Securite', affectationCourante: { siteId: 's7' } },
    ],
    sites: [],
  });
  const orphan = { id: 's9' }; // aucune société déclarée sur le site
  assert.strictEqual(t.siteMatchesSociete(orphan, 'Sword Corporation'), true, 'déduit par l\'agent affecté');
  assert.strictEqual(t.siteMatchesSociete(orphan, 'Iron Global Securite'), false);
  // Un site avec société déclarée n'utilise PAS le repli agents
  assert.strictEqual(t.siteMatchesSociete({ id: 's9', societe: 'Iron Global Securite' }, 'Iron Global Securite'), true);
  assert.strictEqual(t.siteMatchesSociete(null, 'Sword Corporation'), false);
  assert.strictEqual(t.siteMatchesSociete({ id: 's9' }, ''), true, 'sans filtre, tout passe');
});

test('siteMatchesReference: par identifiant ou par nom normalisé', () => {
  const t = T();
  const site = { id: 's1', backendId: 42, nom: 'Dépôt Central' };
  assert.strictEqual(t.siteMatchesReference(site, { siteId: 's1' }), true);
  assert.strictEqual(t.siteMatchesReference(site, { site_id: 42 }), true);
  assert.strictEqual(t.siteMatchesReference(site, { siteBackendId: '42' }), true);
  // Correspondance par nom, accents et casse ignorés
  assert.strictEqual(t.siteMatchesReference(site, { siteName: 'depot central' }), true);
  assert.strictEqual(t.siteMatchesReference(site, { siteName: 'Autre Site' }), false);
  assert.strictEqual(t.siteMatchesReference(site, {}), false);
  assert.strictEqual(t.siteMatchesReference(null, { siteId: 's1' }), false);
});

// ── Effectif contractuel côté client ─────────────────────────────────────────

test('clientSiteEffectif: totalEffectif saisi prime, sinon groupes*nuit + surplus de jour', () => {
  const f = T().clientSiteEffectif;
  assert.strictEqual(f({ totalEffectif: 12 }), 12, 'la valeur saisie prime');
  // 4 groupes x 2 postes de nuit = 8, plus (3 jour - 2 nuit) = 1 -> 9
  assert.strictEqual(f({ nbrGroupe: 4, nbrJour: 3, nbrNuit: 2 }), 9);
  // Pas de surplus quand il y a plus de nuit que de jour
  assert.strictEqual(f({ nbrGroupe: 4, nbrJour: 1, nbrNuit: 2 }), 8);
  assert.strictEqual(f({}), 0);
  assert.strictEqual(f(null), 0);
  assert.strictEqual(f({ totalEffectif: 0, nbrGroupe: 2, nbrNuit: 1 }), 2, 'un total à 0 ne prime pas');
});

test('clientTotalEffectif: somme des sites techniques du client', () => {
  const t = T();
  assert.strictEqual(t.clientTotalEffectif({ tech_sites: [{ totalEffectif: 5 }, { nbrGroupe: 2, nbrNuit: 1, nbrJour: 1 }] }), 7);
  assert.strictEqual(t.clientTotalEffectif({ tech_sites: [] }), 0);
  assert.strictEqual(t.clientTotalEffectif({}), 0);
  assert.strictEqual(t.clientTotalEffectif(null), 0);
});

// ── Conversion des données serveur ───────────────────────────────────────────

test('siteFromApi: mappe les colonnes SQL et fusionne equipment_plan/_legacy', () => {
  const site = T().siteFromApi({
    id: 42, name: 'DEPOT NORD', indicatif: 'DPN', client_name: 'ACME',
    address: 'Rue 1', commune: 'Alger', wilaya: 'Alger', site_type: 'depot',
    rotation_system: '24/48', active: 1,
    contractual_staff: 10, day_staff: 4, night_staff: 3, weekend_staff: 2, holiday_staff: 1, groups_count: 4,
    equipment_plan: { dateOuverture: '2025-01-15', _legacy: { siteOuvertPar: 'DG' } },
  });
  assert.strictEqual(site.backendId, 42);
  assert.strictEqual(site.nom, 'DEPOT NORD');
  assert.strictEqual(site.indicatif, 'DPN');
  assert.strictEqual(site.client, 'ACME');
  assert.strictEqual(site.rotationSystem, '24/48');
  assert.strictEqual(site.actif, true);
  assert.strictEqual(site.dateOuverture, '2025-01-15');
  assert.strictEqual(site.siteOuvertPar, 'DG', 'la valeur _legacy doit être récupérée');
  assert.strictEqual(site.effectifs.totalContractuel, 10);
  assert.strictEqual(site.effectifs.jour, 4);
  assert.strictEqual(site.effectifs.groupes, 4);
  assert.strictEqual(site.isNew, false);
  assert.ok(!('_legacy' in site), '_legacy ne doit pas fuir dans l\'objet site');
});

test('siteFromApi: active=0 devient actif=false', () => {
  assert.strictEqual(T().siteFromApi({ id: 1, name: 'X', active: 0 }).actif, false);
  assert.strictEqual(T().siteFromApi({ id: 1, name: 'X', active: 1 }).actif, true);
});

test('assignmentFromApi: relie l\'affectation à l\'agent et au site déjà chargés', () => {
  const t = T();
  t.setDb({
    agents: [{ id: 'ag_local', backendId: 7 }],
    sites: [{ id: 'st_local', backendId: 3, nom: 'Depot' }],
  });
  const a = t.assignmentFromApi({ id: 99, employee_id: 7, site_id: 3, group_code: 'B', start_date: '2026-01-01' });
  assert.strictEqual(a.backendId, 99);
  assert.strictEqual(a.agentId, 'ag_local', 'doit retrouver l\'identifiant local de l\'agent');
  assert.strictEqual(a.employee_id, 7);
  assert.strictEqual(a.site_id, 3);
});

test('assignmentFromApi: sans agent local connu, retombe sur l\'identifiant serveur', () => {
  const t = T();
  t.setDb({ agents: [], sites: [] });
  const a = t.assignmentFromApi({ id: 100, employee_id: 55, site_id: 66 });
  assert.strictEqual(a.agentId, '55');
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
