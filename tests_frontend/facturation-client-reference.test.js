// Facturation — référentiel client limité (compte Facturation sans module Commercial) :
// objet de facture = activités « Prestations et services fournis » (≠ articles tarifés),
// conditions de paiement préremplies, recherche client et page Clients sans aucun appel à
// l'API Commercial complète. Vrai code (sgdi-app.js + modules).
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const SOC = 'IRON GLOBAL SOLUTION';
const CATALOG = [{ designation: 'Magasinier', prixUnitaire: 3070.32, unite: 'Jour' }, { designation: 'Cariste', prixUnitaire: 3500, unite: 'Jour' },
  { designation: 'Team Leader', prixUnitaire: 120000, unite: 'Mois' }];
// Tel que renvoyé par /api/irongs/facturation/clients.
const LOGISTIQUE = { id: '11', backendId: 11, nom: 'CLIENT LOGISTIQUE TEST', societe: SOC, nif: 'NIF1', rc: 'RC1', adresse: 'Oran',
  prestationsServices: 'Gestion logistique entrepôt', modePaiement: 'Virement bancaire', delaiPaiement: '30 jours', delaiDepotFacture: '3',
  remarqueFacture: 'Test conditions facture', lignesFacturation: CATALOG, tech_sites: [] };
const SANS = { id: '12', backendId: 12, nom: 'CLIENT SANS ACTIVITE', societe: SOC, prestationsServices: '', lignesFacturation: CATALOG, tech_sites: [] };
const DHL = { id: '13', backendId: 13, nom: 'DHL FORWARDING ALGERIE', societe: SOC, prestationsServices: 'Gardiennage', lignesFacturation: [], tech_sites: [] };

function app(modules) {
  const env = loadSgdiApp(['renderFactureEditor', 'factureEditorChooseClient', 'factureEditorClientSearch', 'renderFactClients']);
  assert.strictEqual(env.loadError, null, env.loadError && env.loadError.stack);
  const t = env.T(), w = env.window;
  t.setSession({ username: 'FAC01', role: 'ops', transverse: 'facmod', societe: SOC, permissionsFromServer: true, effectiveModules: modules });
  const invoice = { id: 'ref-1', statut: 'brouillon', lignes: [], date: '2026-09-01', periodeDebut: '2026-09-01', periodeFin: '2026-09-30' };
  t.setDb({ factures: [invoice], clients: [LOGISTIQUE, SANS, DHL].map((c) => JSON.parse(JSON.stringify(c))), paiements: [], avoirs: [] });
  w.eval(`window.__commercialCalls=[];SGDI.commercial.clientsPage=async function(p){window.__commercialCalls.push(p);return{items:[],total:0}};
    sgdiApi=async function(url){if(String(url).includes('/api/commercial'))window.__commercialCalls.push(url);return {}};
    // Temporisation réelle de la recherche (le garde de module de la vue est propre au navigateur).
    facturationModuleTimeout=function(cb,delay){return setTimeout(cb,delay)}`);
  w.__factureEditId = invoice.id;
  return { env, t, w, d: w.document };
}

test('objet de facture = activités du client ; articles = catalogue tarifaire ; conditions préremplies', () => {
  const { env, t, d } = app(['fac']);
  try {
    t.renderFactureEditor(d.getElementById('view'));
    t.factureEditorChooseClient('11');
    const choices = [...d.querySelectorAll('#fact-subject-picker .fact-subject-choice')].map((el) => el.value);
    assert.deepStrictEqual(choices, ['Gestion logistique entrepôt']);
    assert.doesNotMatch(d.getElementById('fact-subject-picker').textContent, /Aucune activité renseignée/);
    // Articles : issus des lignes tarifaires, indépendants de l'objet.
    const cards = [...d.querySelectorAll('#fact-commercial-catalog .fact-catalog-card strong')].map((el) => el.textContent);
    assert.deepStrictEqual(cards, ['Magasinier', 'Cariste', 'Team Leader']);
    assert.ok(!choices.some((c) => cards.includes(c)), 'objet jamais tiré des articles');
    // Conditions de paiement (règles existantes de factureClientPaymentDefaults).
    const v = (id) => d.getElementById(id).value;
    assert.deepStrictEqual([v('fact-mode'), v('fact-echeance'), v('fact-remarque')], ['Virement bancaire', '30 jours', 'Test conditions facture']);
    assert.strictEqual(v('fact-dateDepot'), v('fact-date') ? new Date(Date.parse(v('fact-date') + 'T00:00:00Z') + 3 * 86400000).toISOString().slice(0, 10) : '');
    assert.ok(v('fact-echDate'), 'échéance calculée');
  } finally { env.window.close(); }
});

test('client sans activité : message affiché, aucune activité inventée depuis le catalogue', () => {
  const { env, t, d } = app(['fac']);
  try {
    t.renderFactureEditor(d.getElementById('view'));
    t.factureEditorChooseClient('12');
    assert.strictEqual(d.querySelectorAll('#fact-subject-picker .fact-subject-choice').length, 0);
    assert.match(d.getElementById('fact-subject-picker').textContent, /Aucune activité renseignée pour ce client dans Commercial\./);
    assert.strictEqual(d.getElementById('fact-mode').value, 'A terme', 'aucune condition inventée : valeur par défaut existante');
    assert.strictEqual(d.getElementById('fact-remarque').value, '');
  } finally { env.window.close(); }
});

test('recherche « DHL » sans module Commercial : référentiel limité, aucun appel Commercial', async () => {
  const { env, t, w, d } = app(['fac']);
  try {
    t.renderFactureEditor(d.getElementById('view'));
    const input = d.getElementById('fact-client-search');
    input.value = 'DHL'; t.factureEditorClientSearch(input);
    assert.deepStrictEqual([...d.querySelectorAll('#fact-client-results button span:first-child')].map((el) => el.textContent), ['DHL FORWARDING ALGERIE']);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepStrictEqual([...w.__commercialCalls], []);
  } finally { env.window.close(); }
});

test('recherche avec module Commercial : comportement existant conservé (API Commercial)', async () => {
  const { env, t, w, d } = app(['fac', 'dc']);
  try {
    t.renderFactureEditor(d.getElementById('view'));
    const input = d.getElementById('fact-client-search');
    input.value = 'DHL'; t.factureEditorClientSearch(input);
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(w.__commercialCalls.length, 1);
  } finally { env.window.close(); }
});

test('page Clients sans module Commercial : liste du référentiel limité, aucun appel Commercial', async () => {
  const { env, t, w, d } = app(['fac']);
  try {
    w.eval("window.__warns=[];console.warn=function(){window.__warns.push([...arguments].join(' '))}");
    await t.renderFactClients(d.getElementById('view'));
    assert.deepStrictEqual([...w.__commercialCalls], []);
    assert.deepStrictEqual([...w.__warns], []);
    const text = d.getElementById('view').textContent;
    for (const name of ['CLIENT LOGISTIQUE TEST', 'CLIENT SANS ACTIVITE', 'DHL FORWARDING ALGERIE']) assert.match(text, new RegExp(name));
    assert.match(text, /Gestion logistique entrepôt/);
  } finally { env.window.close(); }
});
