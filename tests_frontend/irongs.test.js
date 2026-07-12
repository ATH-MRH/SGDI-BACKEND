// Tests FRONTEND irongs — convertisseurs de collections SQL (payload <-> fromApi).
// Vérifie qu'un aller-retour objet frontend -> payload API -> objet frontend ne perd
// aucun champ métier. Complète la couverture snapshot déjà dans sgdi-app.test.js.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const { loadError, T } = loadSgdiApp([
  'supplierApiPayload', 'supplierFromApi',
  'clientApiPayload', 'clientFromApi',
]);

test('sgdi-app.js se charge et expose les convertisseurs irongs', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  const t = T();
  for (const n of ['supplierApiPayload', 'supplierFromApi', 'clientApiPayload', 'clientFromApi']) {
    assert.ok(t[n], `${n} introuvable`);
  }
});

test('fournisseur : aller-retour payload -> fromApi sans perte', () => {
  const t = T();
  const fournisseur = {
    raisonSociale: 'Equip Pro', societe: 'Iron Global Securite', contact: 'M. Ali',
    rc: 'RC123', nif: 'NIF456', telephone: '0551000000', email: 'contact@equip.dz',
    adresse: 'Zone Industrielle', produits: 'Uniformes', delaiPaiement: '30j',
    note: 4, commentaires: 'Fiable',
  };
  const payload = t.supplierApiPayload(fournisseur);
  // Le backend renvoie ces colonnes + un id
  const reconstruit = t.supplierFromApi({ ...payload, id: 7 });

  assert.strictEqual(reconstruit.backendId, 7);
  assert.strictEqual(reconstruit.raisonSociale, 'Equip Pro');
  assert.strictEqual(reconstruit.telephone, '0551000000');
  assert.strictEqual(reconstruit.email, 'contact@equip.dz');
  assert.strictEqual(reconstruit.adresse, 'Zone Industrielle');
  assert.strictEqual(reconstruit.produits, 'Uniformes');
  assert.strictEqual(reconstruit.delaiPaiement, '30j');
  assert.strictEqual(reconstruit.note, 4);
  assert.strictEqual(reconstruit.commentaires, 'Fiable');
});

test('fournisseur : valeurs par défaut sûres si champs manquants', () => {
  const t = T();
  const payload = t.supplierApiPayload({});
  assert.strictEqual(payload.name, 'Fournisseur'); // repli
  assert.strictEqual(payload.rating, 0);
  const back = t.supplierFromApi({ id: 1, name: 'X' });
  assert.strictEqual(back.raisonSociale, 'X');
  assert.strictEqual(back.telephone, '');
});

test('client : aller-retour préserve les champs métier ET les champs custom (via data)', () => {
  const t = T();
  const clientObj = {
    nom: 'ACME', raisonSociale: 'ACME SARL', societe: 'Iron Global Securite',
    statut: 'actif', contact: 'Sara', fonction: 'DG', tel: '0550111222',
    email: 'dg@acme.dz', adresse: 'Rue 1', nif: 'NIF1', rc: 'RC1',
    champMetierCustom: 'a-preserver',
  };
  const payload = t.clientApiPayload(clientObj);
  // clientApiPayload embarque tout l'objet dans data -> round-trip complet
  const reconstruit = t.clientFromApi({
    id: 9, name: payload.name, legal_name: payload.legal_name, society: payload.society,
    status: payload.status, phone: payload.phone, data: payload.data,
  });

  assert.strictEqual(reconstruit.backendId, 9);
  assert.strictEqual(reconstruit.nom, 'ACME');
  assert.strictEqual(reconstruit.raisonSociale, 'ACME SARL');
  assert.strictEqual(reconstruit.statut, 'actif');
  assert.strictEqual(reconstruit.tel, '0550111222');
  assert.strictEqual(reconstruit.champMetierCustom, 'a-preserver', 'un champ custom doit survivre via data');
});

test('client : sans data, reconstruit depuis les colonnes SQL', () => {
  const t = T();
  const back = t.clientFromApi({
    id: 3, name: 'BETA', legal_name: 'BETA SARL', society: 'Sword Corporation',
    status: 'prospect', contact_name: 'Yacine', phone: '0660000000', email: 'y@beta.dz',
  });
  assert.strictEqual(back.nom, 'BETA');
  assert.strictEqual(back.raisonSociale, 'BETA SARL');
  assert.strictEqual(back.statut, 'prospect');
  assert.strictEqual(back.contact, 'Yacine');
  assert.strictEqual(back.tel, '0660000000');
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
