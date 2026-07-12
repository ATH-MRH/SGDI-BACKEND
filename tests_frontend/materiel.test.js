// Tests FRONTEND matériel — convertisseurs de collections (row backend -> objet UI).
// Vérifie le mapping des colonnes SQL vers les champs métier et la préservation des
// champs custom (via attributes.raw / size_breakdown.raw).
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const { loadError, T } = loadSgdiApp([
  'storeFromApi', 'articleFromApi', 'movementFromApi', 'movementFromApiType', 'setDb',
]);

function freshDb() {
  const t = T();
  t.setDb({ magasins: [], stockArticles: [], fournisseurs: [], agents: [] });
  return t;
}

test('sgdi-app.js se charge et expose les convertisseurs matériel', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  const t = T();
  for (const n of ['storeFromApi', 'articleFromApi', 'movementFromApi', 'movementFromApiType']) {
    assert.ok(t[n], `${n} introuvable`);
  }
});

test('storeFromApi : mappe les colonnes SQL + la config JSON', () => {
  const t = freshDb();
  const m = t.storeFromApi({
    id: 5, name: 'Magasin Central', code: 'MC', society: 'Iron Global Securite',
    address: 'Zone 1', manager_name: 'Ali', phone: '0550111222', email: 'mc@irongs.dz',
    config: { icon: '📦', color: '#123456', typeMagasin: 'tenues', seuilStockBas: 5 },
  });
  assert.strictEqual(m.backendId, 5);
  assert.strictEqual(m.nom, 'Magasin Central');
  assert.strictEqual(m.code, 'MC');
  assert.strictEqual(m.societe, 'Iron Global Securite');
  assert.strictEqual(m.responsable, 'Ali');
  assert.strictEqual(m.telephone, '0550111222');
  assert.strictEqual(m.icon, '📦');
  assert.strictEqual(m.typeMagasin, 'tenues');
  assert.strictEqual(m.seuilStockBas, 5);
});

test('articleFromApi : mappe les colonnes et préserve les champs custom (raw)', () => {
  const t = freshDb();
  const a = t.articleFromApi({
    id: 12, code: 'ART001', designation: 'Rangers', category: 'chaussures',
    society: 'Iron Global Securite', store_id: 3, supplier_id: 7,
    unit: 'Paire', quantity: 40, unit_price: 3500, purchase_cost: 3000,
    useful_life_months: 12, item_state: 'neuf', min_quantity: 10, active: 1,
    attributes: { raw: { champCustom: 'a-preserver', pointure: '42' } },
  });
  assert.strictEqual(a.backendId, 12);
  assert.strictEqual(a.code, 'ART001');
  assert.strictEqual(a.designation, 'Rangers');
  assert.strictEqual(a.categorie, 'chaussures');
  assert.strictEqual(a.unite, 'Paire');
  assert.strictEqual(a.stockInitial, 40);
  assert.strictEqual(a.prixUnitaire, 3500);
  assert.strictEqual(a.coutAchat, 3000);
  assert.strictEqual(a.dureeVieMois, 12);
  assert.strictEqual(a.stockMin, 10);
  assert.strictEqual(a.actif, true);
  assert.strictEqual(a.champCustom, 'a-preserver', 'un champ custom (raw) doit survivre');
  assert.strictEqual(a.pointure, '42');
});

test('articleFromApi : active=0 -> actif=false', () => {
  const t = freshDb();
  assert.strictEqual(t.articleFromApi({ id: 1, code: 'X', designation: 'X', active: 0 }).actif, false);
  assert.strictEqual(t.articleFromApi({ id: 1, code: 'X', designation: 'X', active: 1 }).actif, true);
});

test('movementFromApiType : traduit les types backend vers les libellés UI', () => {
  const f = T().movementFromApiType;
  assert.strictEqual(f('retour_employe'), 'retour');
  assert.strictEqual(f('dotation_pret_mission'), 'dotation_pret');
  assert.strictEqual(f('reformer'), 'reforme');
  assert.strictEqual(f('entree'), 'entree');   // identité si non mappé
  assert.strictEqual(f('sortie'), 'sortie');
});

test('movementFromApi : mappe colonnes + type traduit + cible', () => {
  const t = freshDb();
  const mv = t.movementFromApi({
    id: 99, article_id: 12, movement_type: 'retour_employe', movement_date: '2026-05-10',
    quantity: 2, unit_price: 3500, store_id: 3, employee_id: 7,
    target_type: 'employee', target_label: 'BENALI Karim', reason: 'Fin mission',
    voucher_number: 'BON-9',
  });
  assert.strictEqual(mv.backendId, 99);
  assert.strictEqual(mv.type, 'retour', 'le type doit être traduit');
  assert.strictEqual(mv.quantite, 2);
  assert.strictEqual(mv.date, '2026-05-10');
  assert.strictEqual(mv.cibleType, 'employee');
  assert.strictEqual(mv.cibleNom, 'BENALI Karim');
  assert.strictEqual(mv.motif, 'Fin mission');
  assert.strictEqual(mv.numeroBon, 'BON-9');
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
