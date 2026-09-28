// Facturation — lignes générées depuis le contrat Commercial : NBR = effectif du poste sur
// le site (« Effectif par site »), unité tarifaire et prix = ceux de la PRESTATION (jamais
// déduits ni convertis), Quantité selon l'unité et la période (Heure : saisie), ancienne
// prestation sans unité « à définir », synchro Facturation limitée.
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
    'factureEditorValidate', 'factureCommercialArticles', 'factureCatalogQuantity', 'factureEditorUnitChange', 'factureEditorPeriodChange',
    'factureEditorCalcRow', 'factureEditorSave']);
  assert.strictEqual(env.loadError, null, env.loadError && env.loadError.stack);
  const t = env.T(), w = env.window, d = w.document;
  t.setSession({ societe: SOC });
  const invoice = { id: 'cat-' + Math.random().toString(36).slice(2), statut: 'brouillon', clientId: 'c', client: 'Client', objet: 'Prestation',
    periodeDebut: period[0], periodeFin: period[1], lignes: [] };
  t.setDb({ factures: [invoice], clients: [cl], paiements: [], avoirs: [] });
  w.__factureEditId = invoice.id;
  w.eval('sgdiApi=async function(url,options){window.__saved=JSON.parse(JSON.stringify(options.body.data));return options.body.data}');
  t.renderFactureEditor(d.getElementById('view'));
  d.getElementById('fact-clientId').value = 'c';
  return { env, t, d, w };
}

const row = (d, i = 0) => d.querySelectorAll('.fact-ligne-row[data-type="article"]')[i];

const setPeriod = (t, d, start, end) => {
  d.getElementById('fact-periode-debut').value = start;
  d.getElementById('fact-periode-fin').value = end;
  assert.strictEqual(d.getElementById('fact-periode-fin').getAttribute('onchange'), 'factureEditorPeriodChange()');
  t.factureEditorPeriodChange();
};

// Contrat multi-unités : l'unité tarifaire appartient à chaque prestation (catalogue global).
const CATALOG = [
  { designation: 'AGENT HEURE', prixUnitaire: 550, unite: 'Heure' },
  { designation: 'MAGASINIER', prixUnitaire: 3070.32, unite: 'Jour' },
  { designation: 'CHEF MAGASIN', prixUnitaire: 92109.6, unite: 'Mois' },
  { designation: 'MAINTENANCE', prixUnitaire: 25000, unite: 'Forfait' },
];
const SITE = [{ designation: 'AGENT HEURE', qte: 10 }, { designation: 'MAGASINIER', qte: 30 }, { designation: 'CHEF MAGASIN', qte: 25 },
  { designation: 'MAINTENANCE', qte: 1 }];
const cells = (d, i) => ['.fact-ligne-unite', '.fact-ligne-nbr', '.fact-ligne-prix', '.fact-ligne-qte'].map((s) => row(d, i).querySelector(s).value);
const total = (d, i) => plain(row(d, i).querySelector('.fact-ligne-total').textContent);

test('contrat multi-unités (cas A–E) : chaque ligne reçoit SON unité, son prix exact, NBR = effectif', () => {
  const { env, t, d } = editor(client(SITE, CATALOG), ['2026-09-01', '2026-09-25']);
  try {
    t.factureEditorCatalogRender();
    const catalog = d.getElementById('fact-commercial-catalog').textContent;
    for (const unit of ['Heure', 'Jour', 'Mois', 'Forfait']) assert.match(catalog, new RegExp('HT / ' + unit));
    [0, 1, 2, 3].forEach((i) => t.factureEditorCatalogAdd(i));
    // [unité, NBR, quantité] — prix contrôlés juste après.
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => [cells(d, i)[0], cells(d, i)[1], cells(d, i)[3]]), [
      ['Heure', '10', ''],        // CAS A : heures jamais déduites des dates
      ['Jour', '30', '25'],       // CAS B : 01→25/09 = 25 jours
      ['Mois', '25', ''],         // CAS C : 01→25/09 n'est pas un mois entier
      ['Forfait', '1', '1'],      // CAS D : forfait = 1
    ]);
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => plain(row(d, i).querySelector('.fact-ligne-prix').value)), ['550,00', '3070,32', '92109,60', '25000,00']);
    // Unité verrouillée : source de vérité = la prestation Commercial.
    assert.ok([0, 1, 2, 3].every((i) => row(d, i).querySelector('.fact-ligne-unite').disabled));
    assert.ok([0, 1, 2, 3].every((i) => row(d, i).querySelector('.fact-ligne-prix').readOnly));
    assert.strictEqual(row(d, 3).querySelector('.fact-ligne-qte').readOnly, true);
    // CAS A : 10 × 160 h × 550 = 880 000.
    const hours = row(d, 0).querySelector('.fact-ligne-qte');
    hours.value = '160'; row(d, 0).dataset.qteMode = 'manual'; t.factureEditorCalcRow(row(d, 0));
    assert.match(hours.getAttribute('oninput'), /^this\.closest\('tr'\)\.dataset\.qteMode='manual';/);
    setPeriod(t, d, '2026-09-01', '2026-09-30');                            // CAS C : mois entier
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => row(d, i).querySelector('.fact-ligne-qte').value), ['160', '30', '1', '1']);
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => total(d, i)), ['880000,00DZD', '2763288,00DZD', '2302740,00DZD', '25000,00DZD']);
    setPeriod(t, d, '2026-09-01', '2026-09-25');                            // CAS B
    assert.deepStrictEqual([0, 1, 2, 3].map((i) => row(d, i).querySelector('.fact-ligne-qte').value), ['160', '25', '', '1']);
    assert.strictEqual(total(d, 1), '2302740,00DZD');
    setPeriod(t, d, '2026-01-01', '2026-12-31');
    assert.strictEqual(row(d, 2).querySelector('.fact-ligne-qte').value, '12');
  } finally { env.window.close(); }
});

test('ancienne prestation sans unité (cas F) : « Unité à définir », aucune conversion, validation bloquée', () => {
  const cl = client([{ designation: 'MAGASINIER', qte: 25 }], [{ designation: 'MAGASINIER', prixUnitaire: 92109.6 }]);
  const { env, t, d } = editor(cl, ['2026-09-01', '2026-09-30']);
  try {
    t.factureEditorCatalogRender();
    assert.match(d.getElementById('fact-commercial-catalog').textContent, /Unité à définir/);
    t.factureEditorCatalogAdd(0);
    const unit = row(d).querySelector('.fact-ligne-unite');
    assert.deepStrictEqual([unit.value, unit.options[unit.selectedIndex].textContent, unit.disabled], ['', 'Unité à définir', true]);
    assert.strictEqual(plain(row(d).querySelector('.fact-ligne-prix').value), '92109,60', 'prix jamais converti');
    assert.strictEqual(row(d).querySelector('.fact-ligne-qte').value, '');
    assert.strictEqual(t.factureEditorValidate(), false);
    // Aucun changement d'unité possible depuis la Facturation.
    unit.value = 'Mois'; t.factureEditorUnitChange(unit);
    assert.strictEqual(row(d).querySelector('.fact-ligne-qte').value, '');
  } finally { env.window.close(); }
});

test('quantité saisie manuellement : jamais écrasée par un changement de période ; persistance et réouverture', async () => {
  const cl = client([{ designation: 'MAGASINIER', qte: 30 }, { designation: 'CARISTE', qte: 2 }],
    [{ designation: 'MAGASINIER', prixUnitaire: 3070.32, unite: 'Jour' }, { designation: 'CARISTE', prixUnitaire: 4000, unite: 'Jour' }]);
  const { env, t, d, w } = editor(cl, ['2026-09-01', '2026-09-30']);
  try {
    t.factureEditorCatalogAdd(0); t.factureEditorCatalogAdd(1);
    const manual = row(d, 1).querySelector('.fact-ligne-qte');
    manual.value = '12';
    // jsdom n'exécute pas les attributs oninput : on applique exactement le gestionnaire du champ.
    assert.match(manual.getAttribute('oninput'), /^this\.closest\('tr'\)\.dataset\.qteMode='manual';factureEditorCalcRow/);
    row(d, 1).dataset.qteMode = 'manual';
    setPeriod(t, d, '2026-09-01', '2026-09-25');
    assert.deepStrictEqual([row(d, 0).querySelector('.fact-ligne-qte').value, manual.value], ['25', '12']);
    const nbr = row(d, 0).querySelector('.fact-ligne-nbr'); nbr.value = '31'; t.factureEditorCalcRow(row(d, 0)); t.factureEditorCalcTotals();
    assert.strictEqual(total(d, 0), '2379498,00DZD');
    await t.factureEditorSave({ draft: true, silent: true });
    const lines = w.__saved.lignes;
    assert.deepStrictEqual(JSON.parse(JSON.stringify(lines.map((l) => [l.unite, l.nbr, l.qte, l.qteAuto]))), [['Jour', 31, 25, true], ['Jour', 2, 12, false]]);
    assert.deepStrictEqual([String(w.__saved.periodeDebut), String(w.__saved.periodeFin)], ['2026-09-01', '2026-09-25']);
    t.getDb().factures[0] = { ...t.getDb().factures[0], ...w.__saved };
    t.renderFactureEditor(d.getElementById('view'));
    assert.deepStrictEqual([row(d, 0).dataset.qteMode, row(d, 1).dataset.qteMode], ['auto', 'manual']);
    assert.deepStrictEqual([row(d, 0).querySelector('.fact-ligne-unite').disabled, row(d, 0).querySelector('.fact-ligne-unite').value], [true, 'Jour']);
    setPeriod(t, d, '2026-09-01', '2026-09-30');
    assert.deepStrictEqual([row(d, 0).querySelector('.fact-ligne-qte').value, row(d, 1).querySelector('.fact-ligne-qte').value], ['30', '12']);
  } finally { env.window.close(); }
});

test('facture émise : changement de période sans effet sur les quantités', () => {
  const cl = client([{ designation: 'MAGASINIER', qte: 30 }], [{ designation: 'MAGASINIER', prixUnitaire: 3070.32, unite: 'Jour' }]);
  const { env, t, d } = editor(cl, ['2026-09-01', '2026-09-25']);
  try {
    t.factureEditorCatalogAdd(0);
    t.getDb().factures[0].statut = 'emise';
    setPeriod(t, d, '2026-09-01', '2026-09-30');
    assert.strictEqual(row(d).querySelector('.fact-ligne-qte').value, '25');
  } finally { env.window.close(); }
});

test('site : 30 magasiniers × 25 jours × 3 070,32 / Jour = 2 302 740,00 ; l’unité d’une ligne de site ne fait pas foi', () => {
  // Une ancienne donnée « unite » posée sur la ligne de site est ignorée : seule la prestation compte.
  const cl = client([{ designation: 'MAGASINIER', qte: 30, unite: 'Mois' }], [{ designation: 'MAGASINIER', prixUnitaire: 3070.32, unite: 'Jour' }]);
  const { env, t, d } = editor(cl, ['2026-09-01', '2026-09-25']);
  try {
    t.factureEditorCatalogRender();
    assert.match(d.getElementById('fact-commercial-catalog').textContent, /Effectif contrat : 30/);
    t.factureEditorCatalogAdd(0);
    assert.deepStrictEqual([row(d).querySelector('.fact-ligne-nbr').value, row(d).querySelector('.fact-ligne-qte').value, row(d).querySelector('.fact-ligne-unite').value],
      ['30', '25', 'Jour']);
    t.factureEditorCalcTotals();
    assert.strictEqual(total(d, 0), '2302740,00DZD');
    assert.strictEqual(plain(d.getElementById('fact-r-ttc').textContent), '2740260,60DZD');
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
