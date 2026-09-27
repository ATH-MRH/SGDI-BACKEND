// Facturation — colonne NBR (nombre d'éléments facturés) : position, calcul instantané
// NBR × QUANTITÉ × PRIX, brouillon enregistré puis rouvert, aperçu/impression, factures
// historiques (sans NBR) inchangées, facture validée figée. Vrai code (sgdi-app.js + modules).
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const NBSP = /[\s  ]/g;
const plain = (text) => String(text || '').replace(NBSP, '');

function editor(invoice) {
  const env = loadSgdiApp(['renderFactureEditor', 'factureEditorSave', 'factureEditorCalcTotals', 'factureEditorCalcRow',
    'factureEditorLigneAdd', 'factureEditorValidate', 'factureVoirApercu', 'factureComputeLinesTotals', 'factureEditorLigneHTML']);
  assert.strictEqual(env.loadError, null, env.loadError && env.loadError.stack);
  const t = env.T(), w = env.window, d = w.document;
  T = t;
  t.setSession({ societe: 'IRON GLOBAL SOLUTION' });
  t.setDb({ factures: [invoice], clients: [], paiements: [], avoirs: [] });
  w.__factureEditId = invoice.id;
  w.eval('sgdiApi=async function(url,options){window.__saved=JSON.parse(JSON.stringify(options.body.data));return options.body.data}');
  t.renderFactureEditor(d.getElementById('view'));
  return { env, t, w, d };
}

function draft(lines) {
  return { id: 'nbr-' + Math.random().toString(36).slice(2), statut: 'brouillon', clientId: 'c', client: 'Client', objet: 'Prestation',
    periodeDebut: '2026-09-01', periodeFin: '2026-09-30', lignes: lines };
}

// jsdom (runScripts « outside-only ») n'exécute pas les attributs oninput : on exécute ici
// exactement ce que fait le gestionnaire du champ (recalcul de la ligne puis des totaux) ;
// la présence de ce gestionnaire est vérifiée, et l'E2E Chrome prouve le déclenchement réel.
let T;
function setValue(input, value) {
  input.value = value;
  assert.match(input.getAttribute('oninput') || '', /factureEditorCalcRow\(this\.closest\('tr'\)\);factureEditorCalcTotals\(\)/);
  T.factureEditorCalcRow(input.closest('tr'));
  T.factureEditorCalcTotals();
}

test('colonne NBR placée entre Unité et Prix unitaire, dans l’éditeur et dans chaque ligne', () => {
  const { env, d } = editor(draft([{ designation: 'MAGASINIER', unite: 'Jour', nbr: 30, qte: 25, prixUnitHT: 3070.32 }]));
  try {
    const heads = [...d.querySelectorAll('.fact-editor-lines thead th')].map((th) => th.textContent.trim());
    assert.deepStrictEqual(heads, ['Désignation', 'Unité', 'NBR', 'Prix unitaire', 'Quantité', 'Total', 'Actions']);
    const cells = [...d.querySelector('.fact-ligne-row').children];
    assert.ok(cells[1].querySelector('.fact-ligne-unite') && cells[2].querySelector('.fact-ligne-nbr') && cells[3].querySelector('.fact-ligne-prix')
      && cells[4].querySelector('.fact-ligne-qte') && cells[5].classList.contains('fact-ligne-total'));
    const nbr = d.querySelector('.fact-ligne-nbr'), qte = d.querySelector('.fact-ligne-qte');
    assert.strictEqual(nbr.type, qte.type, 'même type de champ que Quantité');
    assert.strictEqual(nbr.getAttribute('style'), qte.getAttribute('style'), 'même style que Quantité');
  } finally { env.window.close(); }
});

test('30 magasiniers × 25 jours × 3 070,32 = 2 302 740,00 ; recalcul instantané de la ligne et des totaux', () => {
  const { env, t, d } = editor(draft([{ designation: 'MAGASINIER', unite: 'Jour', nbr: 30, qte: 25, prixUnitHT: 3070.32 }]));
  try {
    t.factureEditorCalcTotals();
    assert.strictEqual(plain(d.querySelector('.fact-ligne-total').textContent), plain('2 302 740,00 DZD'));
    assert.strictEqual(plain(d.getElementById('fact-r-ht').textContent), plain('2 302 740,00 DZD'));
    assert.strictEqual(plain(d.getElementById('fact-r-tva').textContent), plain('437 520,60 DZD'));
    assert.strictEqual(plain(d.getElementById('fact-r-ttc').textContent), plain('2 740 260,60 DZD'));
    setValue(d.querySelector('.fact-ligne-nbr'), '31');                         // NBR 30 → 31
    assert.strictEqual(plain(d.querySelector('.fact-ligne-total').textContent), plain('2 379 498,00 DZD'));
    assert.strictEqual(plain(d.getElementById('fact-r-ht').textContent), plain('2 379 498,00 DZD'));
    setValue(d.querySelector('.fact-ligne-qte'), '20');                         // quantité
    assert.strictEqual(plain(d.querySelector('.fact-ligne-total').textContent), plain('1 903 598,40 DZD'));
    setValue(d.querySelector('.fact-ligne-prix'), '1000');                      // prix
    assert.strictEqual(plain(d.querySelector('.fact-ligne-total').textContent), plain('620 000,00 DZD'));
  } finally { env.window.close(); }
});

test('nouvelle ligne : NBR = 1 par défaut (1 × 4 × 3 070,32 = 12 281,28)', () => {
  const { env, t, d } = editor(draft([]));
  try {
    t.factureEditorLigneAdd('article');
    const row = d.querySelector('.fact-ligne-row[data-type="article"]');
    assert.strictEqual(row.querySelector('.fact-ligne-nbr').value, '1');
    setValue(row.querySelector('.fact-ligne-qte'), '4');
    setValue(row.querySelector('.fact-ligne-prix'), '3070,32');
    assert.strictEqual(plain(row.querySelector('.fact-ligne-total').textContent), plain('12 281,28 DZD'));
  } finally { env.window.close(); }
});

test('brouillon : NBR enregistré, puis retrouvé à la réouverture', async () => {
  const invoice = draft([{ designation: 'MAGASINIER', unite: 'Jour', qte: 25, prixUnitHT: 3070.32 }]);
  const { env, t, w, d } = editor(invoice);
  try {
    setValue(d.querySelector('.fact-ligne-nbr'), '30');
    await t.factureEditorSave({ draft: true, silent: true });
    const line = w.__saved.lignes[0];
    assert.strictEqual(line.nbr, 30);
    assert.strictEqual(line.totalHT, 2302740);
    assert.strictEqual(w.__saved.totalHT, 2302740);
    t.renderFactureEditor(d.getElementById('view'));                              // réouverture
    assert.strictEqual(d.querySelector('.fact-ligne-nbr').value, '30');
    assert.strictEqual(plain(d.querySelector('.fact-ligne-total').textContent), plain('2 302 740,00 DZD'));
  } finally { env.window.close(); }
});

test('facture historique sans NBR : NBR affiché 1, montant strictement inchangé', () => {
  const legacy = { designation: 'MAGASINIER', unite: 'Mois', qte: 25, prixUnitHT: 92109.6, totalHT: 2302740 };
  const { env, t, d } = editor(draft([legacy]));
  try {
    assert.strictEqual(d.querySelector('.fact-ligne-nbr').value, '1');
    t.factureEditorCalcTotals();
    assert.strictEqual(plain(d.querySelector('.fact-ligne-total').textContent), plain('2 302 740,00 DZD'));
    const totals = t.factureComputeLinesTotals([{ ...legacy }], 19);
    assert.strictEqual(totals.totalHT, 2302740);
  } finally { env.window.close(); }
});

test('aperçu / impression : colonne NBR et calcul compréhensible par le client', () => {
  const invoice = draft([{ designation: 'MAGASINIER', unite: 'Jour', nbr: 30, qte: 25, prixUnitHT: 3070.32 }]);
  const { env, t, d } = editor(invoice);
  try {
    t.factureVoirApercu(invoice.id);
    const table = d.querySelector('#fact-print-area table:has(tfoot)');
    assert.deepStrictEqual([...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      ['Désignation', 'Unité', 'NBR', 'P.U./HT', 'Quantité', 'Montant']);
    const cells = [...table.querySelector('tbody tr').children].map((td) => plain(td.textContent));
    assert.deepStrictEqual(cells, ['MAGASINIER', 'Jour', '30', plain('3 070,32 DZD'), '25', plain('2 302 740,00 DZD')]);
    assert.strictEqual(table.querySelector('tfoot td').getAttribute('colspan'), '5');
  } finally { env.window.close(); }
});

test('validation refusée côté écran si NBR n’est pas un entier ≥ 1', () => {
  const { env, t, d } = editor(draft([{ designation: 'MAGASINIER', unite: 'Jour', nbr: 30, qte: 25, prixUnitHT: 3070.32 }]));
  try {
    for (const bad of ['0', '2.5', '-1', '']) {
      d.querySelector('.fact-ligne-nbr').value = bad;
      assert.strictEqual(t.factureEditorValidate(), false, bad);
    }
    d.querySelector('.fact-ligne-nbr').value = '30';
    assert.strictEqual(t.factureEditorValidate(), true);
  } finally { env.window.close(); }
});

test('facture émise : NBR affiché mais non modifiable', () => {
  const invoice = { ...draft([{ designation: 'MAGASINIER', unite: 'Jour', nbr: 30, qte: 25, prixUnitHT: 3070.32, totalHT: 2302740 }]), statut: 'emise', numero: 'FAC0001/09/26' };
  const { env, d } = editor(invoice);
  try {
    const nbr = d.querySelector('.fact-ligne-nbr');
    assert.strictEqual(nbr.value, '30');
    assert.strictEqual(nbr.disabled, true);
  } finally { env.window.close(); }
});
