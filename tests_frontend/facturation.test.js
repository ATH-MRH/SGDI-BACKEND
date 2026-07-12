// Tests FRONTEND facturation / commercial — calculs financiers.
// Cœur : le statut de paiement d'une facture (factureStatutPaye) — payé / partiel /
// échu / annulé, reste à payer, avoirs déduits. Plus TVA et numérotation.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const { loadError, T } = loadSgdiApp([
  'clientMontantTTC', 'nextDevisNum', 'nextFactureNum', 'factureStatutPaye', 'setDb',
]);

test('sgdi-app.js se charge et expose les calculs facturation', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  const t = T();
  for (const n of ['clientMontantTTC', 'nextFactureNum', 'factureStatutPaye']) {
    assert.ok(t[n], `${n} introuvable`);
  }
});

// ── TVA / montants ───────────────────────────────────────────────────────────

test('clientMontantTTC : somme des lignes × 1,19 (TVA 19 %)', () => {
  const t = T();
  const client = { lignesFacturation: [
    { prixUnitaire: 1000, qte: 2 },   // 2000
    { prixUnitaire: 500, qte: 3 },    // 1500
  ] };
  assert.strictEqual(t.clientMontantTTC(client), 3500 * 1.19);
  // qte manquante -> 1 par défaut
  assert.strictEqual(t.clientMontantTTC({ lignesFacturation: [{ prixUnitaire: 1000 }] }), 1000 * 1.19);
  assert.strictEqual(t.clientMontantTTC({ lignesFacturation: [] }), 0);
  assert.strictEqual(t.clientMontantTTC({}), 0);
  assert.strictEqual(t.clientMontantTTC(null), 0);
});

// ── Numérotation ─────────────────────────────────────────────────────────────

test('nextDevisNum : format DEV-AAAA-NNNN incrémental', () => {
  const t = T();
  t.setDb({ devis: [] });
  const y = new Date().getFullYear();
  assert.strictEqual(t.nextDevisNum(), `DEV-${y}-0001`);
  t.setDb({ devis: [{ id: 'd1' }, { id: 'd2' }] });
  assert.strictEqual(t.nextDevisNum(), `DEV-${y}-0003`);
});

test('nextFactureNum : format FACNNNN/MM/AA', () => {
  const t = T();
  t.setDb({ factures: [] });
  const num = t.nextFactureNum();
  assert.match(num, /^FAC\d{4}\/\d{2}\/\d{2}$/);
  assert.ok(num.startsWith('FAC0001/'), num);
});

// ── Statut de paiement d'une facture (le cœur) ───────────────────────────────

test('factureStatutPaye : facture non payée -> emise, reste = ttc', () => {
  const t = T();
  t.setDb({ paiements: [], avoirs: [] });
  const r = t.factureStatutPaye({ id: 'f1', ttc: 100000, date: '2999-01-01', echeance: '30' });
  assert.strictEqual(r.statut, 'emise');
  assert.strictEqual(r.paye, 0);
  assert.strictEqual(r.reste, 100000);
});

test('factureStatutPaye : paiement partiel -> partielle', () => {
  const t = T();
  t.setDb({ paiements: [{ factureId: 'f2', montant: 40000 }], avoirs: [] });
  const r = t.factureStatutPaye({ id: 'f2', ttc: 100000, date: '2999-01-01', echeance: '30' });
  assert.strictEqual(r.statut, 'partielle');
  assert.strictEqual(r.paye, 40000);
  assert.strictEqual(r.reste, 60000);
});

test('factureStatutPaye : totalement payée -> payee, reste 0', () => {
  const t = T();
  t.setDb({ paiements: [{ factureId: 'f3', montant: 60000 }, { factureId: 'f3', montant: 40000 }], avoirs: [] });
  const r = t.factureStatutPaye({ id: 'f3', ttc: 100000 });
  assert.strictEqual(r.statut, 'payee');
  assert.strictEqual(r.reste, 0);
});

test('factureStatutPaye : un avoir réduit le reste et peut solder la facture', () => {
  const t = T();
  t.setDb({ paiements: [{ factureId: 'f4', montant: 30000 }], avoirs: [{ factureId: 'f4', montant: 70000 }] });
  const r = t.factureStatutPaye({ id: 'f4', ttc: 100000 });
  assert.strictEqual(r.avoir, 70000);
  assert.strictEqual(r.reste, 0);
  assert.strictEqual(r.statut, 'payee', 'paiement + avoir = TTC -> soldée');
});

test('factureStatutPaye : échéance dépassée sans paiement -> echue', () => {
  const t = T();
  t.setDb({ paiements: [], avoirs: [] });
  const r = t.factureStatutPaye({ id: 'f5', ttc: 100000, dateEcheance: '2000-01-01' });
  assert.strictEqual(r.statut, 'echue');
});

test('factureStatutPaye : facture annulée -> annulee (prioritaire)', () => {
  const t = T();
  t.setDb({ paiements: [{ factureId: 'f6', montant: 100000 }], avoirs: [] });
  const r = t.factureStatutPaye({ id: 'f6', ttc: 100000, statut: 'annulee' });
  assert.strictEqual(r.statut, 'annulee');
});

test('factureStatutPaye : ignore les paiements/avoirs d\'une autre facture', () => {
  const t = T();
  t.setDb({ paiements: [{ factureId: 'autre', montant: 99999 }], avoirs: [{ factureId: 'autre', montant: 99999 }] });
  const r = t.factureStatutPaye({ id: 'f7', ttc: 50000, date: '2999-01-01', echeance: '30' });
  assert.strictEqual(r.paye, 0);
  assert.strictEqual(r.reste, 50000);
  assert.strictEqual(r.statut, 'emise');
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
