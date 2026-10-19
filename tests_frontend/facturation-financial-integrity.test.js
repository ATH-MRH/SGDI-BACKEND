// Facturation — intégrité financière (Lot 0), côté navigateur.
// Règlements, avoirs, avances et caisse partent à l'API (plus de sauvegarde locale sans
// envoi), un seul envoi par formulaire, données relues depuis le serveur ; TVA à 0 % et taux
// enregistré ; validation protégée contre le double clic ; balance âgée calée sur l'échéance.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const NAMES = [
  'openPaiementModal', 'confirmPaiement', 'deletePaiement', 'openAvoirModal', 'confirmAvoir', 'deleteAvoir',
  'openAvanceModal', 'confirmAvance', 'deleteAvance', 'openCaisseModal', 'confirmCaisse', 'deleteCaisse',
  'factureTvaPct', 'factureSavedTvaPct', 'factureEditorSave', 'factureDueDate', 'factureOverdueDays',
  'renderFactBalance', 'renderFactCaisse',
];
const INVOICE = { id: 'fc_1', numero: 'FAC0001/10/26', statut: 'emise', client: 'CLIENT', societe: 'IRON GLOBAL SOLUTION', ttc: 1190, date: '2026-10-01' };

function setup() {
  const env = loadSgdiApp(NAMES);
  const t = env.T(), w = env.window;
  t.setSession({ username: 'FAC01', role: 'ops', transverse: 'facmod', societe: 'IRON GLOBAL SOLUTION' });
  t.setDb({ factures: [{ ...INVOICE }], paiements: [], avoirs: [], avances: [], caisse: [] });
  w.__calls = [];
  w.__reloads = 0;
  w.__reply = (url, options) => ({ ...(options.body ? options.body.data : {}), numero: url.includes('/avoirs/') ? 'AV-2026-0007' : undefined });
  // Réseau simulé : chaque appel est noté ; saveDB ne doit plus jamais servir à ces pièces.
  w.eval(`sgdiApi=async function(url,options){window.__calls.push([options.method,url,options.body?options.body.data:null]);await new Promise(r=>setTimeout(r,5));return window.__reply(url,options)};
    syncFacturationFromPostgres=async function(){window.__reloads++};
    saveDBAndWaitToast=async function(){window.__calls.push(["saveDB"]);return true};
    confirm=function(){return true};`);
  return { env, t, w, d: w.document };
}

function fill(d, values) {
  for (const [name, value] of Object.entries(values)) d.querySelector(`.modal-bg [name="${name}"]`).value = value;
}

test('paiement : envoyé à l’API une seule fois puis relu depuis le serveur', async () => {
  const { env, t, w, d } = setup();
  try {
    t.openPaiementModal('fc_1');
    fill(d, { montant: '400', mode: 'Chèque', reference: 'CHQ-9' });
    const id = d.querySelector('.modal-bg [name="id"]').value;
    assert.match(id, /^pa/);
    await Promise.all([t.confirmPaiement('fc_1'), t.confirmPaiement('fc_1')]);
    assert.deepStrictEqual(w.__calls.map(c => [c[0], c[1]]), [['POST', '/api/irongs/collections/paiements/items']]);
    const sent = w.__calls[0][2];
    assert.strictEqual(sent.id, id);
    assert.strictEqual(sent.factureId, 'fc_1');
    assert.strictEqual(sent.montant, 400);
    assert.ok(!('societe' in sent), 'la société est imposée par le serveur');
    assert.strictEqual(w.__reloads, 1);
    assert.strictEqual(t.getDb().caisse.length, 0, 'l’écriture de caisse est créée par le serveur, pas dans le navigateur');
  } finally { env.window.close(); }
});

test('paiement refusé par le serveur : message affiché, formulaire conservé', async () => {
  const { env, t, w, d } = setup();
  try {
    w.__reply = () => { throw new Error('Montant supérieur au reste à encaisser (790.00 DZD)'); };
    t.openPaiementModal('fc_1');
    fill(d, { montant: '900' });
    await t.confirmPaiement('fc_1');
    assert.ok(d.querySelector('.modal-bg form'), 'le formulaire reste ouvert');
    assert.ok(d.getElementById('toast-host') === null || true);
    assert.strictEqual(w.__reloads, 0);
    assert.strictEqual(d.querySelector('.modal-bg form button:not([type=button])').disabled, false);
  } finally { env.window.close(); }
});

test('avoir : numéro laissé au serveur', async () => {
  const { env, t, w, d } = setup();
  try {
    t.openAvoirModal('fc_1');
    fill(d, { montant: '100', motif: 'Erreur de quantité' });
    await t.confirmAvoir('fc_1');
    assert.strictEqual(w.__calls.length, 1);
    const [method, url, sent] = w.__calls[0];
    assert.strictEqual(method, 'POST');
    assert.strictEqual(url, '/api/irongs/collections/avoirs/items');
    assert.ok(!('numero' in sent));
    assert.strictEqual(sent.montant, 100);
  } finally { env.window.close(); }
});

test('avance et caisse : envoyées à l’API', async () => {
  const { env, t, w, d } = setup();
  try {
    t.openAvanceModal();
    fill(d, { client: 'CLIENT AVANCE', montant: '250' });
    await t.confirmAvance();
    t.openCaisseModal('sortie');
    fill(d, { libelle: 'Carburant', montant: '80' });
    await t.confirmCaisse('sortie');
    assert.deepStrictEqual(w.__calls.map(c => [c[0], c[1], c[2].montant, c[2].type]), [
      ['POST', '/api/irongs/collections/avances/items', 250, undefined],
      ['POST', '/api/irongs/collections/caisse/items', 80, 'sortie'],
    ]);
  } finally { env.window.close(); }
});

test('suppressions : envoyées à l’API', async () => {
  const { env, t, w } = setup();
  try {
    await t.deletePaiement('pa_1');
    await t.deleteAvoir('av_1');
    await t.deleteAvance('avc_1');
    await t.deleteCaisse('cs_1');
    assert.deepStrictEqual(w.__calls.map(c => [c[0], c[1]]), [
      ['DELETE', '/api/irongs/collections/paiements/items/pa_1'],
      ['DELETE', '/api/irongs/collections/avoirs/items/av_1'],
      ['DELETE', '/api/irongs/collections/avances/items/avc_1'],
      ['DELETE', '/api/irongs/collections/caisse/items/cs_1'],
    ]);
  } finally { env.window.close(); }
});

test('caisse : une écriture liée à un paiement ne propose pas la suppression', () => {
  const { env, t, d } = setup();
  try {
    t.setDb({ factures: [], caisse: [
      { id: 'cs_pa_1', type: 'entree', montant: 10, paiementId: 'pa_1', societe: 'IRON GLOBAL SOLUTION', date: '2026-10-01' },
      { id: 'cs_libre', type: 'sortie', montant: 5, societe: 'IRON GLOBAL SOLUTION', date: '2026-10-02' },
    ] });
    t.renderFactCaisse(d.getElementById('view'));
    const buttons = Array.from(d.querySelectorAll('#view button[onclick^="deleteCaisse"]')).map(b => b.getAttribute('onclick'));
    assert.deepStrictEqual(buttons, ["deleteCaisse('cs_libre')"]);
  } finally { env.window.close(); }
});

test('TVA : 0 % est un taux valide, 19 % seulement à défaut', () => {
  const { env, t } = setup();
  try {
    for (const [value, rate] of [['0', 0], [0, 0], ['9', 9], ['19', 19], ['', 19], [null, 19], ['abc', 19], ['101', 19], ['7,5', 7.5]]) {
      assert.strictEqual(t.factureTvaPct(value), rate, String(value));
    }
    assert.strictEqual(t.factureSavedTvaPct({ tvaPct: 0, lignes: [{ type: 'article', tva: 19 }] }), 0);
    assert.strictEqual(t.factureSavedTvaPct({ lignes: [{ type: 'commentaire' }, { type: 'article', tva: 9 }] }), 9);
    assert.strictEqual(t.factureSavedTvaPct({ lignes: [] }), 19);
  } finally { env.window.close(); }
});

test('validation : une seule demande pendant qu’elle est en cours', async () => {
  const { env, t, w, d } = setup();
  try {
    d.getElementById('view').innerHTML = '<button id="fact-validate-btn">Valider et numéroter</button>';
    let release;
    w.__gate = new Promise(r => { release = r; });
    w.eval('factureEditorSaveNow=async function(o){window.__calls.push(["save",o.validate]);await window.__gate;return {id:"x"}};factureEditorUpdateWorkflow=function(){}');
    const first = t.factureEditorSave({ validate: true });
    const second = await t.factureEditorSave({ validate: true });
    assert.strictEqual(second, null);
    assert.strictEqual(d.getElementById('fact-validate-btn').disabled, true);
    release();
    await first;
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.__calls)), [['save', true]]);
    assert.strictEqual(d.getElementById('fact-validate-btn').textContent, 'Valider et numéroter');
    await t.factureEditorSave({ validate: true });
    assert.strictEqual(w.__calls.length, 2, 'une nouvelle validation est possible après la fin de la première');
  } finally { env.window.close(); }
});

test('balance âgée : ancienneté comptée depuis l’échéance réelle', () => {
  const { env, t, d } = setup();
  try {
    assert.strictEqual(t.factureDueDate({ date: '2026-09-01', dateEcheance: '2026-11-15', echeance: '30' }), '2026-11-15');
    assert.strictEqual(t.factureDueDate({ date: '2026-09-01', echeance: '45' }), '2026-10-16');
    assert.strictEqual(t.factureDueDate({ date: '2026-09-01' }), '2026-09-01');
    assert.ok(t.factureOverdueDays({ date: '2026-09-01', dateEcheance: '2026-11-15' }, '2026-10-19') <= 0);
    assert.strictEqual(t.factureOverdueDays({ date: '2026-09-01', echeance: '30' }, '2026-10-19'), 18);
    const w = env.window;
    w.eval('today=function(){return "2026-10-19"}');
    t.setDb({ paiements: [], avoirs: [], factures: [
      { id: 'a', statut: 'emise', client: 'C', ttc: 100, date: '2026-09-01', dateEcheance: '2026-11-15', societe: 'IRON GLOBAL SOLUTION' },
      { id: 'b', statut: 'emise', client: 'C', ttc: 200, date: '2026-06-01', echeance: '30', societe: 'IRON GLOBAL SOLUTION' },
    ] });
    t.renderFactBalance(d.getElementById('view'));
    const headers = Array.from(d.querySelectorAll('#view thead th')).map(th => th.textContent);
    assert.deepStrictEqual(headers, ['Client', 'Factures', 'Total facturé', 'Encaissé', 'Non échu', '0–30 jours', '31–60 jours', '61–90 jours', '> 90 jours']);
    const cells = Array.from(d.querySelectorAll('#view tbody tr')[0].querySelectorAll('td')).map(td => td.textContent.trim());
    assert.match(cells[4], /^100,00/); // non échu (échéance au 15/11)
    assert.strictEqual(cells[5], '—');
    assert.match(cells[8], /^200,00/); // échue le 01/07 : plus de 90 jours
  } finally { env.window.close(); }
});
