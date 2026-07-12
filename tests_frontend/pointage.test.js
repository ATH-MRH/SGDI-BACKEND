// Tests FRONTEND pointage + secrétariat.
// Cœur : la conversion des codes de pointage en jours d'absence retenus sur salaire
// (ptCodeAbsencePayrollValue / ptAbsencePayrollDays) — c'est ce qui alimente la paie
// (paiePointageAbsenceDays). Une erreur ici = une retenue de salaire fausse.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const { loadError, T } = loadSgdiApp([
  'ptCodeAbsencePayrollValue', 'ptAbsencePayrollDays', 'ptGetSheet',
  'secretariatScopedItems', 'setDb', 'setSession',
]);

test('sgdi-app.js se charge et expose les helpers pointage/secrétariat', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  const t = T();
  for (const n of ['ptCodeAbsencePayrollValue', 'ptAbsencePayrollDays', 'ptGetSheet']) {
    assert.ok(t[n], `${n} introuvable`);
  }
});

// ── Codes d'absence retenus sur salaire ──────────────────────────────────────

test('ptCodeAbsencePayrollValue : A/AB/A1 = 1 jour, A2 = 2, A3 = 3, reste = 0', () => {
  const f = T().ptCodeAbsencePayrollValue;
  assert.strictEqual(f('A'), 1);
  assert.strictEqual(f('AB'), 1);
  assert.strictEqual(f('A1'), 1);
  assert.strictEqual(f('a1'), 1, 'insensible à la casse');
  assert.strictEqual(f('A2'), 2);
  assert.strictEqual(f('A3'), 3);
  // Présence, repos, congé... ne sont pas des absences retenues
  assert.strictEqual(f('P'), 0);
  assert.strictEqual(f('R'), 0);
  assert.strictEqual(f('C'), 0);
  assert.strictEqual(f(''), 0);
  assert.strictEqual(f(null), 0);
});

test('ptAbsencePayrollDays : somme des absences retenues sur toute la feuille', () => {
  const f = T().ptAbsencePayrollDays;
  // 3 jours "A" (1 chacun) + un "A2" (2) + un "A3" (3) = 8, la présence ne compte pas
  const sheet = { days: { '01': 'P', '02': 'A', '03': 'A', '04': 'P', '05': 'A2', '06': 'A3', '07': 'A', '08': 'R' } };
  assert.strictEqual(f(sheet), 3 + 2 + 3);
  assert.strictEqual(f({ days: {} }), 0);
  assert.strictEqual(f(null), 0);
  assert.strictEqual(f({}), 0);
});

test('ptGetSheet : retrouve la feuille par agent et période', () => {
  const t = T();
  t.setDb({
    pointages: [
      { id: 'pt1', agentId: 'ag1', periode: '2026-03', days: { '01': 'P' } },
      { id: 'pt2', agentId: 'ag1', periode: '2026-04', days: {} },
      { id: 'pt3', agentId: 'ag2', periode: '2026-03', days: {} },
    ],
  });
  assert.strictEqual(t.ptGetSheet('ag1', '2026-03').id, 'pt1');
  assert.strictEqual(t.ptGetSheet('ag1', '2026-04').id, 'pt2');
  assert.strictEqual(t.ptGetSheet('ag2', '2026-03').id, 'pt3');
  assert.strictEqual(t.ptGetSheet('ag1', '2099-01'), undefined);
  assert.strictEqual(t.ptGetSheet('inconnu', '2026-03'), undefined);
});

test('ptGetSheet : initialise db.pointages si absent (pas de crash)', () => {
  const t = T();
  t.setDb({});
  assert.strictEqual(t.ptGetSheet('x', '2026-03'), undefined);
});

// ── Secrétariat : filtre par société ─────────────────────────────────────────

test('secretariatScopedItems : sans filtre société, renvoie tout ; liste vide gérée', () => {
  const t = T();
  t.setSession({ username: 'x' }); // pas de société active -> pas de filtre
  const items = [{ id: 'a', societe: 'Iron Global Securite' }, { id: 'b', societe: 'Sword Corporation' }];
  const out = t.secretariatScopedItems(items);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual([...t.secretariatScopedItems([])], []);
  assert.deepStrictEqual([...t.secretariatScopedItems(null)], []);
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
