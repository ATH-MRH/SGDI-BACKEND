// Tests FRONTEND du module DRH — vraies fonctions de app/static/sgdi-app.js.
// Couvre : congés acquis (2,5 j/mois) et reliquat STC, matricules par société,
// validation candidat (âge, identité) et cycle de vie candidat.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const { loadError, T } = loadSgdiApp([
  // Congés / STC
  'drhLeaveEntitlement',
  'calculateStcCongeReliquat',
  'drhSortantEffectiveDate',
  'drhStcReliquatDisplay',
  // Matricules
  'matriculePrefixesForSociete',
  'nextMatricule',
  'normalizeEmployeeCodeFormat',
  'normalizeSocieteName',
  // Candidats
  'candidatAgeAtSave',
  'candidateIdentityMissing',
  'candidateHasMinimumData',
  'candidatIsArchived',
  'candidatIsRecruited',
  'candidatIsActive',
]);

test('sgdi-app.js se charge et expose les fonctions DRH', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  const t = T();
  for (const name of ['drhLeaveEntitlement', 'nextMatricule', 'candidatAgeAtSave']) {
    assert.ok(t[name], `${name} introuvable`);
  }
});

// ── Congés acquis : 2,5 jours par mois ───────────────────────────────────────

test('drhLeaveEntitlement: 2,5 j/mois — 6 mois = 15 j, 12 mois = 30 j (bug STC 30 au lieu de 15)', () => {
  const f = T().drhLeaveEntitlement;
  assert.strictEqual(f('2025-01-01', '2025-07-01'), 15); // 6 mois
  assert.strictEqual(f('2025-01-01', '2026-01-01'), 30); // 12 mois
  assert.strictEqual(f('2025-01-01', '2025-02-01'), 2.5); // 1 mois
});

test('drhLeaveEntitlement: proratise le mois entamé et refuse les dates incohérentes', () => {
  const f = T().drhLeaveEntitlement;
  assert.strictEqual(f('2025-01-01', '2024-12-31'), 0, 'asOf avant le recrutement -> 0');
  assert.strictEqual(f('', '2025-07-01'), 0, 'sans date de recrutement -> 0');
  const mid = f('2025-01-01', '2025-01-16'); // ~la moitié du 1er mois
  assert.ok(mid > 1 && mid < 2.5, `prorata attendu entre 1 et 2.5, obtenu ${mid}`);
});

test('calculateStcCongeReliquat: acquis - congés approuvés (hors Maladie)', () => {
  const t = T();
  const agent = { id: 'a1', dateRecrutement: '2025-01-01' };
  t.setDb({
    conges: [
      { agentId: 'a1', type: 'Annuel', statut: 'approuve', joursConge: 5 },
      { agentId: 'a1', type: 'Maladie', statut: 'approuve', joursConge: 10 },   // exclu
      { agentId: 'a1', type: 'Annuel', statut: 'en_attente', joursConge: 3 },   // exclu
      { agentId: 'a2', type: 'Annuel', statut: 'approuve', joursConge: 7 },     // autre agent
    ],
  });
  // 6 mois = 15 j acquis, moins 5 j pris = 10 j
  assert.strictEqual(t.calculateStcCongeReliquat(agent, '2025-07-01'), 10);
});

test('calculateStcCongeReliquat: jamais négatif, et null sans date de recrutement', () => {
  const t = T();
  t.setDb({ conges: [{ agentId: 'a1', type: 'Annuel', statut: 'approuve', joursConge: 999 }] });
  assert.strictEqual(t.calculateStcCongeReliquat({ id: 'a1', dateRecrutement: '2025-01-01' }, '2025-07-01'), 0);
  assert.strictEqual(t.calculateStcCongeReliquat({ id: 'a1' }, '2025-07-01'), null);
});

test('drhSortantEffectiveDate: plafonne à aujourd\'hui (pas d\'acquis sur le futur)', () => {
  const t = T();
  const todayStr = new Date().toISOString().slice(0, 10);
  assert.strictEqual(t.drhSortantEffectiveDate({ dateSortie: '2025-03-15' }), '2025-03-15');
  assert.strictEqual(t.drhSortantEffectiveDate({ dateSortie: '2099-01-01' }), todayStr, 'une sortie future doit être plafonnée');
  assert.strictEqual(t.drhSortantEffectiveDate({}), todayStr);
});

test('drhStcReliquatDisplay: recalcule et corrige une fiche datée dans le futur', () => {
  const t = T();
  t.setDb({ conges: [] });
  // Fiche corrompue : reliquat stocké à 30 alors que la sortie plafonnée donne moins
  const agent = { id: 'a1', dateRecrutement: '2025-01-01', dateSortie: '2025-07-01', stcCongeReliquat: 30 };
  assert.strictEqual(t.drhStcReliquatDisplay(agent), 15, 'le recalcul doit primer sur la valeur stockée');
});

// ── Matricules (miroir du backend employee_code_prefixes_for_society) ─────────

test('matriculePrefixesForSociete: mêmes séries que le backend, accents indifférents', () => {
  // Les tableaux viennent du realm jsdom : on les recopie pour comparer les valeurs.
  const f = (s) => [...T().matriculePrefixesForSociete(s)];
  assert.deepStrictEqual(f('Iron Global Securite'), ['A', 'B', 'C']);
  assert.deepStrictEqual(f('Iron Global Sécurité'), ['A', 'B', 'C']);
  assert.deepStrictEqual(f('IRON GLOBAL SOLUTION'), ['K', 'W']);
  assert.deepStrictEqual(f('Sword Corporation'), ['S']);
  assert.deepStrictEqual(f('Sword Construction'), ['T']);
  assert.strictEqual(f('Societe Inconnue').length, 26);
});

test('nextMatricule: comble le premier trou de la série et ignore les autres sociétés', () => {
  const f = T().nextMatricule;
  assert.strictEqual(f([], 'Iron Global Securite'), 'A01');
  assert.strictEqual(f([{ matricule: 'A01' }, { matricule: 'A02' }], 'Iron Global Securite'), 'A03');
  assert.strictEqual(f([{ matricule: 'A01' }, { matricule: 'A03' }], 'Iron Global Securite'), 'A02', 'doit combler le trou');
  // Un code S01 (Sword) ne bloque pas la série A/B/C
  assert.strictEqual(f([{ matricule: 'S01' }], 'Iron Global Securite'), 'A01');
  // Passage de série quand A est saturée
  const fullA = Array.from({ length: 200 }, (_, i) => ({ matricule: 'A' + String(i + 1).padStart(2, '0') }));
  assert.strictEqual(f(fullA, 'Iron Global Securite'), 'B01');
});

test('normalizeEmployeeCodeFormat: normalise la casse, les espaces et les zéros', () => {
  const f = T().normalizeEmployeeCodeFormat;
  assert.strictEqual(f('a1'), 'A01');
  assert.strictEqual(f(' a001 '), 'A01');
  assert.strictEqual(f('A123'), 'A123');
  assert.strictEqual(f('TMP-RESET-5'), 'TMP-RESET-5'); // non conforme -> inchangé
  assert.strictEqual(f(''), '');
});

test('nextMatricule: tient compte des codes mal formatés (a1 == A01)', () => {
  assert.strictEqual(T().nextMatricule([{ matricule: 'a1' }], 'Iron Global Securite'), 'A02');
});

// ── Validation candidat ──────────────────────────────────────────────────────

test('candidatAgeAtSave: calcule l\'âge et gère les dates invalides', () => {
  const f = T().candidatAgeAtSave;
  const y = new Date().getFullYear();
  // Né un 1er janvier : l'anniversaire est atteint dès le 1er janvier, donc l'âge = y - année
  assert.strictEqual(f(`${y - 25}-01-01`), 25);
  assert.strictEqual(f(`${y - 19}-01-01`), 19, 'moins de 20 ans -> refusé plus haut dans le formulaire');
  assert.strictEqual(f(''), null);
  assert.strictEqual(f('pas-une-date'), null);
});

test('candidateIdentityMissing / candidateHasMinimumData: nom et prénom obligatoires (2 car. min)', () => {
  const t = T();
  const missing = (c) => [...t.candidateIdentityMissing(c)]; // tableau du realm jsdom
  assert.deepStrictEqual(missing({ nom: '', prenom: '' }), ['Nom', 'Prénom']);
  assert.deepStrictEqual(missing({ nom: 'Benali', prenom: '' }), ['Prénom']);
  assert.deepStrictEqual(missing({ nom: 'Benali', prenom: 'Karim' }), []);

  assert.strictEqual(t.candidateHasMinimumData({ nom: 'Benali', prenom: 'Karim' }), true);
  assert.strictEqual(t.candidateHasMinimumData({ nom: 'B', prenom: 'Karim' }), false, '1 caractère refusé');
  assert.strictEqual(t.candidateHasMinimumData(null), false);
});

test('cycle de vie candidat: archivé / recruté / actif s\'excluent correctement', () => {
  const t = T();
  assert.strictEqual(t.candidatIsArchived({ statut: 'archive' }), true);
  assert.strictEqual(t.candidatIsArchived({ archivedAt: '2026-01-01' }), true);
  assert.strictEqual(t.candidatIsArchived({ statut: 'nouvelle' }), false);

  assert.strictEqual(t.candidatIsRecruited({ statut: 'embauche' }), true);
  assert.strictEqual(t.candidatIsRecruited({ statut: 'embauché' }), true);
  assert.strictEqual(t.candidatIsRecruited({ convertedEmployeeId: 12 }), true);
  assert.strictEqual(t.candidatIsRecruited({ statut: 'reserve' }), false);

  assert.strictEqual(t.candidatIsActive({ statut: 'nouvelle' }), true);
  assert.strictEqual(t.candidatIsActive({ statut: 'reserve' }), true);
  assert.strictEqual(t.candidatIsActive({ statut: 'embauche' }), false, 'un recruté n\'est plus un candidat actif');
  assert.strictEqual(t.candidatIsActive({ statut: 'archive' }), false);
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
