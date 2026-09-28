// Facturation — lignes générées depuis le contrat Commercial : NBR = effectif du poste sur
// le site (« Effectif par site »), Quantité selon l'unité et la période facturée (jamais une
// quantité 1 inventée), ancien catalogue global inchangé, synchro Facturation limitée.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const plain = (text) => String(text || '').replace(/[\s  ]/g, '');
const SOC = 'IRON GLOBAL SOLUTION';

function client(lines, global = []) {
  return { id: 'c', nom: 'Client', societe: SOC, lignesFacturation: global,
    tech_sites: [{ nom: 'Site A', lignesFacturation: lines }] };
}

function editor(cl, period) {
  const env = loadSgdiApp(['renderFactureEditor', 'factureEditorCatalogAdd', 'factureEditorCatalogRender', 'factureEditorCalcTotals',
    'factureEditorValidate', 'factureCommercialArticles', 'factureCatalogQuantity']);
  assert.strictEqual(env.loadError, null, env.loadError && env.loadError.stack);
  const t = env.T(), w = env.window, d = w.document;
  t.setSession({ societe: SOC });
  const invoice = { id: 'cat-' + Math.random().toString(36).slice(2), statut: 'brouillon', clientId: 'c', client: 'Client', objet: 'Prestation',
    periodeDebut: period[0], periodeFin: period[1], lignes: [] };
  t.setDb({ factures: [invoice], clients: [cl], paiements: [], avoirs: [] });
  w.__factureEditId = invoice.id;
  t.renderFactureEditor(d.getElementById('view'));
  d.getElementById('fact-clientId').value = 'c';
  return { env, t, d };
}

const row = (d, i = 0) => d.querySelectorAll('.fact-ligne-row[data-type="article"]')[i];

test('site : 30 magasiniers, unité Jour, période 01→25/09 ⇒ NBR 30 × 25 × 3 070,32 = 2 302 740,00', () => {
  const cl = client([{ designation: 'MAGASINIER', qte: 30, unite: 'Jour' }], [{ designation: 'MAGASINIER', prixUnitaire: 3070.32 }]);
  const { env, t, d } = editor(cl, ['2026-09-01', '2026-09-25']);
  try {
    t.factureEditorCatalogRender();
    assert.match(d.getElementById('fact-commercial-catalog').textContent, /Effectif contrat : 30/);
    t.factureEditorCatalogAdd(0);
    const r = row(d);
    assert.deepStrictEqual([r.querySelector('.fact-ligne-nbr').value, r.querySelector('.fact-ligne-qte').value, r.querySelector('.fact-ligne-unite').value],
      ['30', '25', 'Jour']);
    t.factureEditorCalcTotals();
    assert.strictEqual(plain(r.querySelector('.fact-ligne-total').textContent), plain('2 302 740,00 DZD'));
  } finally { env.window.close(); }
});

test('quantité selon l’unité : Forfait = 1, Mois entiers, sinon champ vide à saisir', () => {
  const { env, t } = editor(client([]), ['2026-09-01', '2026-09-30']);
  try {
    const q = t.factureCatalogQuantity;
    assert.strictEqual(q('Forfait', '', ''), 1);
    assert.strictEqual(q('Jour', '2026-09-01', '2026-09-30'), 30);
    assert.strictEqual(q('Mois', '2026-09-01', '2026-09-30'), 1);
    assert.strictEqual(q('Mois', '2026-01-01', '2026-03-31'), 3);
    assert.strictEqual(q('Mois', '2026-09-05', '2026-09-30'), null, 'mois partiel : aucune fraction inventée');
    assert.strictEqual(q('Heure', '2026-09-01', '2026-09-30'), null, 'heures : jamais déduites de la période');
    assert.strictEqual(q('Année', '2026-01-01', '2026-12-31'), null);
    assert.strictEqual(q('Jour', '', ''), null, 'sans période : pas de durée inventée');
  } finally { env.window.close(); }
});

test('unités Heure / Mois / Forfait depuis le contrat ; quantité inconnue ⇒ vide et validation bloquée', () => {
  const cl = client([{ designation: 'CARISTE', qte: 2, unite: 'Heure' }, { designation: 'AGENT', qte: 5 }, { designation: 'NETTOYAGE', qte: 1, unite: 'Forfait' }],
    [{ designation: 'CARISTE', prixUnitaire: 800 }, { designation: 'AGENT', prixUnitaire: 60000 }, { designation: 'NETTOYAGE', prixUnitaire: 150000 }]);
  const { env, t, d } = editor(cl, ['2026-09-01', '2026-09-30']);
  try {
    [0, 1, 2].forEach((i) => t.factureEditorCatalogAdd(i));
    const values = [0, 1, 2].map((i) => ['.fact-ligne-unite', '.fact-ligne-nbr', '.fact-ligne-qte'].map((s) => row(d, i).querySelector(s).value));
    assert.deepStrictEqual(values, [['Heure', '2', ''], ['Mois', '5', '1'], ['Forfait', '1', '1']]);
    assert.strictEqual(row(d, 0).querySelector('.fact-ligne-qte').placeholder, 'À saisir');
    t.factureEditorCalcTotals();
    assert.strictEqual(plain(row(d, 1).querySelector('.fact-ligne-total').textContent), plain('300 000,00 DZD'));
    assert.strictEqual(plain(row(d, 2).querySelector('.fact-ligne-total').textContent), plain('150 000,00 DZD'));
    assert.strictEqual(t.factureEditorValidate(), false, 'quantité d’heures non saisie');
  } finally { env.window.close(); }
});

test('ancien catalogue global avec Qté : comportement antérieur conservé (NBR 1, Quantité = Qté contrat)', () => {
  const cl = { id: 'c', nom: 'Client', societe: SOC, tech_sites: [],
    lignesFacturation: [{ designation: 'MAGASINIER', qte: 25, prixUnitaire: 92109.6, unite: 'Mois' }] };
  const { env, t, d } = editor(cl, ['2026-09-01', '2026-09-30']);
  try {
    t.factureEditorCatalogRender();
    assert.match(d.getElementById('fact-commercial-catalog').textContent, /Quantité contrat : 25/);
    t.factureEditorCatalogAdd(0);
    assert.deepStrictEqual([row(d).querySelector('.fact-ligne-nbr').value, row(d).querySelector('.fact-ligne-qte').value], ['1', '25']);
    t.factureEditorCalcTotals();
    assert.strictEqual(plain(row(d).querySelector('.fact-ligne-total').textContent), plain('2 302 740,00 DZD'), '92 109,60 jamais converti');
  } finally { env.window.close(); }
});

test('effectif de site absent ou non entier : NBR 1, jamais déduit d’un montant', () => {
  const { env, t } = editor(client([]), ['2026-09-01', '2026-09-30']);
  try {
    const items = t.factureCommercialArticles(client([{ designation: 'A' }, { designation: 'B', qte: 2.5 }], [{ designation: 'A', prixUnitaire: 10 }, { designation: 'B', prixUnitaire: 10 }]),
      { start: '2026-09-01', end: '2026-09-30' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(items.map((x) => [x.nbr, x.effectif]))), [[1, null], [1, null]]);
  } finally { env.window.close(); }
});

test('synchro Facturation : factures + référentiel client limité, sans DRH ni Commercial', async () => {
  const env = loadSgdiApp(['sgdiSqlSyncScope', 'sgdiSqlSyncTasks']);
  try {
    const t = env.T(), w = env.window;
    t.setSession({ username: 'FAC01', role: 'ops', transverse: 'facmod', societe: SOC, permissionsFromServer: true, effectiveModules: ['fac'] });
    t.setDb({ factures: [], clients: [], paiements: [], avoirs: [], avances: [], caisse: [] });
    // Hôte fac.irongs.com (jsdom tourne sur drh.irongs.com).
    w.eval('sgdiModuleHostConfig=()=>({key:"facmod"});sgdiAuthToken=()=>"tok";window.__calls=[];sgdiApi=async function(url){window.__calls.push(url);return url.includes("/factures/items")?[{id:"f1",nbr:30}]:url.includes("facturation/clients")?[{id:"c1"}]:[]}');
    w.location.hash = '#/facturation/factures';
    const scope = t.sgdiSqlSyncScope({});
    assert.strictEqual(scope.facturation, true);
    assert.strictEqual(scope.drh || scope.commercial || scope.ops, false);
    await Promise.all(t.sgdiSqlSyncTasks({}));
    assert.deepStrictEqual([...w.__calls], ['/api/irongs/collections/factures/items', '/api/irongs/collections/paiements/items', '/api/irongs/collections/avoirs/items',
      '/api/irongs/collections/avances/items', '/api/irongs/collections/caisse/items', '/api/irongs/facturation/clients']);
    assert.strictEqual(t.getDb().factures[0].id, 'f1');
    assert.strictEqual(t.getDb().clients[0].id, 'c1');
  } finally { env.window.close(); }
});
