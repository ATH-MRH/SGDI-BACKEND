// Facturation — interface de référence (fac.irongs.com) : tableau de bord, clients et assistant
// « Nouvelle facture » en 3 étapes. Vrai code (sgdi-app.js + modules) dans jsdom : les chiffres
// viennent des données synchronisées, les étapes reflètent les contrôles réels, et la création,
// la validation et les paiements passent toujours par les fonctions serveur existantes.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const SOC = 'IRON GLOBAL SOLUTION';
const plain = (text) => String(text || '').replace(/[\s  ]/g, '');
const NAMES = ['renderFactDashboard', 'factDashboardData', 'facOpenPaymentPicker', 'renderFactClients', 'renderFactureEditor',
  'factureEditorGoStep', 'factureEditorChecks', 'factureEditorCatalogAdd', 'factureEditorCatalogRender', 'factureEditorLigneAdd',
  'factureEditorLigneRemove', 'factureEditorCalcTotals', 'factureEditorChooseClient', 'facturationLeaveEditor', 'renderFacStandaloneNav'];

// jsdom (runScripts « outside-only ») n'exécute pas les attributs on* : on lance le gestionnaire
// inline réel de l'élément, avec le même « this » et le même « event » que le navigateur.
function act(w, el, type = 'click') {
  assert.ok(el, 'élément introuvable');
  const code = el.getAttribute('on' + type);
  assert.ok(code, 'aucun gestionnaire on' + type);
  return new w.Function('event', code).call(el, new w.Event(type, { bubbles: true }));
}

function boot() {
  const env = loadSgdiApp(NAMES);
  assert.strictEqual(env.loadError, null, env.loadError && env.loadError.stack);
  const t = env.T(), w = env.window, d = w.document;
  w.eval('today=function(){return "2026-10-21"};window.__toasts=[];toast=function(m){window.__toasts.push(String(m))}');
  t.setSession({ username: 'FAC01', role: 'ops', transverse: 'facmod', societe: SOC });
  return { env, t, w, d, view: d.getElementById('view') };
}

// ---------- Tableau de bord ----------
const INVOICES = [
  { id: 'f1', numero: 'FAC0001', statut: 'emise', client: 'CLIENT A', ttc: 1000, date: '2026-01-10', dateEcheance: '2026-02-10', societe: SOC },
  { id: 'f2', numero: 'FAC0002', statut: 'emise', client: 'CLIENT A', ttc: 2000, date: '2026-03-05', dateEcheance: '2026-12-31', societe: SOC },
  { id: 'f3', numero: 'FAC0003', statut: 'emise', client: 'CLIENT B', ttc: 500, date: '2026-03-20', societe: SOC },
  { id: 'f4', numero: 'FAC0004', statut: 'emise', client: 'CLIENT B', ttc: 800, date: '2025-06-01', dateEcheance: '2025-07-01', societe: SOC },
  { id: 'b1', numero: 'BROUILLON', statut: 'brouillon', client: 'CLIENT A', ttc: 9999, date: '2026-04-01', societe: SOC },
  { id: 'x1', numero: 'AUTRE', statut: 'emise', client: 'CLIENT X', ttc: 7777, date: '2026-04-01', societe: 'AUTRE SOCIETE' },
];
const PAYMENTS = [
  { id: 'p1', factureId: 'f1', montant: 1000, date: '2026-01-20' },
  { id: 'p2', factureId: 'f2', montant: 500, date: '2026-03-15' },
  { id: 'p3', factureId: 'f4', montant: 800, date: '2025-06-15' },
  { id: 'p4', factureId: 'f2', montant: 300, date: '2026-03-16', suivi: { statut: 'impaye' } },
];

test('tableau de bord : 4 KPI calculés sur les données réelles, brouillons et autres sociétés exclus', () => {
  const { env, t, d, view } = boot();
  try {
    t.setDb({ factures: INVOICES.map((f) => ({ ...f })), paiements: PAYMENTS.map((p) => ({ ...p })), avoirs: [] });
    t.renderFactDashboard(view);
    const kpis = [...d.querySelectorAll('.fac-kpi')];
    assert.deepStrictEqual(kpis.map((k) => k.dataset.tone), ['blue', 'green', 'orange', 'red']);
    const value = (tone) => plain(d.querySelector(`.fac-kpi[data-tone="${tone}"] .fac-kpi-value`).textContent);
    assert.strictEqual(value('blue'), '3500,00DA', 'facturé 2026 = 1000 + 2000 + 500');
    assert.strictEqual(value('green'), '1500,00DA', 'encaissé 2026, paiement impayé exclu');
    // f2 : reste 1500 à échoir ; f3 : 500 sans échéance (jamais en retard).
    assert.strictEqual(value('orange'), '2000,00DA');
    assert.strictEqual(value('red'), '0,00DA');
    assert.match(d.querySelector('.fac-kpi[data-tone="blue"] .fac-kpi-sub').textContent, /vs 2025/);
    assert.match(d.querySelector('.fac-kpi[data-tone="green"] .fac-kpi-sub').textContent, /87,5 %/, '1500 vs 800 en 2025');
  } finally { env.window.close(); }
});

test('tableau de bord : filtre de période, graphique mensuel, répartition et dernières factures', () => {
  const { env, t, w, d, view } = boot();
  try {
    t.setDb({ factures: INVOICES.map((f) => ({ ...f })), paiements: PAYMENTS.map((p) => ({ ...p })), avoirs: [] });
    w.renderView = () => t.renderFactDashboard(view);
    t.renderFactDashboard(view);
    // Graphique : 12 mois, barres issues des montants (janvier facturé 1000 et encaissé 1000).
    const months = [...d.querySelectorAll('.fac-bar-chart text')].map((x) => x.textContent).filter((x) => /^[A-Z]/.test(x));
    assert.deepStrictEqual(months, ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']);
    const titles = [...d.querySelectorAll('.fac-bar-chart rect title')].map((x) => x.textContent);
    assert.ok(titles.some((x) => /^Facturé — Jan 2026 : 1\s000,00 DA$/.test(x)), titles.join('|'));
    assert.ok(titles.some((x) => /^Créances — Mar 2026 : 2\s000,00 DA$/.test(x)), 'Mars : 1500 (f2) + 500 (f3)');
    // Répartition 2026 : f1 payée, f2 partielle, f3 non payée.
    assert.strictEqual(d.querySelector('.fac-donut-center strong').textContent, '3');
    assert.deepStrictEqual([...d.querySelectorAll('.fac-donut-legend b')].map((b) => b.textContent), ['1', '1', '1']);
    // Dernières factures : émises seulement, colonnes et actions attendues.
    const heads = [...d.querySelectorAll('.fac-dashboard .fac-table thead th')].map((th) => th.textContent);
    assert.deepStrictEqual(heads, ['N° facture', 'Date', 'Client', 'Montant TTC', 'Montant encaissé', 'Reliquat', 'Échéance', 'Statut', 'Actions']);
    const rows = [...d.querySelectorAll('.fac-dashboard .fac-table tbody tr')];
    assert.deepStrictEqual(rows.map((r) => r.cells[0].textContent), ['FAC0003', 'FAC0002', 'FAC0001', 'FAC0004']);
    const f3 = rows[0];
    assert.strictEqual(f3.cells[6].textContent, '—', 'échéance absente affichée telle quelle');
    assert.strictEqual(f3.cells[7].textContent, 'Non payée', 'jamais « En retard » sans échéance');
    assert.ok(f3.querySelector('button[onclick^="factureEditorOpen"]') && f3.querySelector('button[onclick^="factureVoirApercu"]'));
    // Actions rapides et boutons d'en-tête.
    const quick = [...d.querySelectorAll('.fac-quick button')].map((b) => b.textContent.trim());
    assert.deepStrictEqual(quick, ['Nouvelle facture', 'Enregistrer un paiement', 'Voir les factures en retard', 'Liste des clients', 'Prestations à facturer']);
    // Filtre : période limitée à mars 2026.
    d.getElementById('fac-dash-from').value = '2026-03-01';
    d.getElementById('fac-dash-to').value = '2026-03-31';
    act(w, [...d.querySelectorAll('.fac-dashboard button')].find((b) => b.textContent.trim() === 'Filtrer'));
    assert.strictEqual(plain(d.querySelector('.fac-kpi[data-tone="blue"] .fac-kpi-value').textContent), '2500,00DA');
    assert.strictEqual(d.querySelector('.fac-donut-center strong').textContent, '2');
    // Période invalide : refusée, aucun recalcul.
    d.getElementById('fac-dash-from').value = '2026-04-01';
    act(w, [...d.querySelectorAll('.fac-dashboard button')].find((b) => b.textContent.trim() === 'Filtrer'));
    assert.match(w.__toasts.at(-1), /période valide/);
  } finally { env.window.__facDashPeriod = null; env.window.close(); }
});

test('enregistrer un paiement : seules les factures avec un reste, puis la modale d’encaissement existante', () => {
  const { env, t, w, d } = boot();
  try {
    t.setDb({ factures: INVOICES.map((f) => ({ ...f })), paiements: PAYMENTS.map((p) => ({ ...p })), avoirs: [] });
    t.facOpenPaymentPicker();
    const rows = [...d.querySelectorAll('#fac-pay-pick tr')];
    assert.deepStrictEqual(rows.map((r) => r.cells[0].textContent), ['FAC0003', 'FAC0002']);
    let opened = null;
    w.openPaiementModal = (id) => { opened = id; };
    act(w, rows[1].querySelector('button'));
    assert.strictEqual(opened, 'f2');
  } finally { env.window.close(); }
});

// ---------- Clients ----------
const CLIENTS = [
  { id: 'c1', nom: 'ALPHA LOGISTIQUE TEST', societe: SOC, statut: 'actif', nif: 'NIF-A', wilaya: 'ALGER', contact: 'CONTACT A', tel: '0550000001',
    prestationsServices: 'Assistance logistique\nTransport', lignesFacturation: [{ designation: 'CARISTE', prixUnitaire: 1000, unite: 'Mois' }],
    tech_sites: [{ nom: 'SITE NORD', lignesFacturation: [{ designation: 'CARISTE', qte: 4 }] }, { nom: 'SITE SUD', lignesFacturation: [{ designation: 'CARISTE', qte: 2 }] },
      { nom: 'SITE PORT', lignesFacturation: [] }] },
  { id: 'c2', nom: 'BETA SERVICES TEST', societe: SOC, statut: 'actif', nif: 'NIF-B', wilaya: 'ORAN', prestationsServices: 'Gardiennage', lignesFacturation: [], tech_sites: [] },
  { id: 'c3', nom: 'GAMMA TEST', societe: SOC, statut: 'inactif', nif: 'NIF-C', wilaya: 'ORAN', prestationsServices: 'Transport', lignesFacturation: [], tech_sites: [] },
];

test('clients : KPI, multi-sites, filtres, recherche, réinitialisation et actions', async () => {
  const { env, t, w, d, view } = boot();
  try {
    t.setDb({ clients: [], factures: INVOICES.map((f) => ({ ...f })), paiements: [], avoirs: [] });
    // Deux pages serveur : tous les clients sont chargés avant le calcul des indicateurs.
    const calls = [];
    w.SGDI.commercial.clientsPage = async (p) => {
      calls.push(p.page);
      const items = (p.page === 1 ? CLIENTS.slice(0, 2) : CLIENTS.slice(2)).map((c) => ({ id: Number(c.id.slice(1)), name: c.nom, society: SOC, status: c.statut, data: c }));
      return { items, total: 3, page: p.page, page_size: 100, pages: 2 };
    };
    await t.renderFactClients(view);
    assert.deepStrictEqual(calls, [1, 2]);
    const kpi = [...d.querySelectorAll('.fac-mini-kpi')].map((k) => [k.querySelector('span').textContent, plain(k.querySelector('strong').textContent)]);
    assert.deepStrictEqual(kpi, [['Total clients', '3'], ['Clients actifs', '2'], ['Clients inactifs', '1'], ['Sites totaux', '3'], ['Effectifs totaux', '6'],
      ['Montant TTC (2026)', '3500,00DA']]);
    const rows = () => [...d.querySelectorAll('#fac-clients-table tbody tr')];
    const alpha = rows().find((r) => r.dataset.clientId === 'c1');
    assert.strictEqual(alpha.querySelector('[data-col="sites"]').textContent, '3', 'trois sites rattachés, dont un sans prestation');
    assert.strictEqual(alpha.querySelector('[data-col="effectif"]').textContent, '6');
    assert.match(alpha.textContent, /NIF : NIF-A/);
    assert.ok(alpha.querySelector('button[onclick^="openClientModal"]') && alpha.querySelector('button[onclick*="facturation/compte/"]'));
    assert.deepStrictEqual([...d.querySelectorAll('#fac-clients-table thead th')].map((th) => th.textContent),
      ['Nom du client', 'Référence', 'Contact', 'Téléphone', 'Wilaya', 'Sites', 'Effectif', 'Prestation fournie', 'Montant TTC', 'Statut', 'Actions']);
    const filter = (id, value) => { const el = d.getElementById(id); el.value = value; act(w, el, el.tagName === 'SELECT' ? 'change' : 'input'); };
    filter('fac-clients-statut', 'inactif');
    assert.deepStrictEqual(rows().map((r) => r.dataset.clientId), ['c3']);
    filter('fac-clients-statut', '');
    filter('fac-clients-wilaya', 'ORAN');
    assert.deepStrictEqual(rows().map((r) => r.dataset.clientId), ['c2', 'c3']);
    filter('fac-clients-prestation', 'Transport');
    assert.deepStrictEqual(rows().map((r) => r.dataset.clientId), ['c3']);
    filter('fac-clients-wilaya', '');
    filter('fac-clients-prestation', '');
    filter('fac-clients-q', 'nif-b');
    assert.deepStrictEqual(rows().map((r) => r.dataset.clientId), ['c2']);
    act(w, [...d.querySelectorAll('.fac-clients button')].find((b) => b.textContent.trim() === 'Réinitialiser'));
    assert.strictEqual(rows().length, 3);
    assert.strictEqual(d.getElementById('fac-clients-q').value, '');
  } finally { env.window.__facClientsFilter = null; env.window.close(); }
});

// ---------- Nouvelle facture : assistant 3 étapes ----------
const BILL_CLIENT = { id: 'c1', nom: 'ALPHA LOGISTIQUE TEST', societe: SOC, nif: 'NIF-A', rc: 'RC-A', ai: 'AI-A', adresse: 'ADRESSE TEST',
  prestationsServices: 'Assistance logistique', modePaiement: 'Chèque', delaiPaiement: '30 jours',
  lignesFacturation: [{ designation: 'CARISTE', prixUnitaire: 1000, unite: 'Mois' }, { designation: 'COURSIER', prixUnitaire: 500, unite: 'Mois' }],
  tech_sites: [{ nom: 'SITE NORD', lignesFacturation: [{ designation: 'CARISTE', qte: 2 }] }, { nom: 'SITE SUD', lignesFacturation: [{ designation: 'COURSIER', qte: 3 }] },
    { nom: 'SITE PORT', lignesFacturation: [] }] };

function editor(invoice) {
  const ctx = boot();
  const { t, w } = ctx;
  t.setDb({ factures: invoice ? [invoice] : [], clients: [JSON.parse(JSON.stringify(BILL_CLIENT))], paiements: [], avoirs: [] });
  w.eval('window.__saves=[];sgdiApi=async function(url,o){window.__saves.push({url,method:o&&o.method,data:o&&o.body&&o.body.data});return o&&o.body&&o.body.data||{}}');
  w.__factureEditId = invoice ? invoice.id : 'new';
  t.renderFactureEditor(ctx.view);
  return ctx;
}
const step = (d) => d.querySelector('.fac-editor').dataset.step;
const states = (d) => [...d.querySelectorAll('.fac-step')].map((b) => b.dataset.state);
const button = (d, label) => [...d.querySelectorAll('.fac-summary-actions button')].find((b) => b.textContent.trim() === label);
const visible = (d, label) => { const b = button(d, label); const want = b.dataset.forStep; return !want || want.split(' ').includes(step(d)); };

test('nouvelle facture : étape 1 bloquée tant que client, objet et période manquent ; client réel affiché', () => {
  const { env, t, w, d } = editor(null);
  try {
    assert.strictEqual(step(d), '1');
    assert.deepStrictEqual(states(d), ['active', 'todo', 'todo']);
    assert.strictEqual(d.getElementById('fact-numero').value, 'BROUILLON');
    assert.ok(visible(d, 'Continuer vers les prestations') && visible(d, 'Enregistrer le brouillon'));
    assert.ok(!visible(d, 'Valider et numéroter'));
    assert.match(d.getElementById('fac-sum-count').textContent, /^0 prestation ajoutée$/);
    assert.match(d.getElementById('fac-sum-note').textContent, /Vous êtes à l’étape 1 sur 3/);
    act(w, button(d, 'Continuer vers les prestations'));
    assert.strictEqual(step(d), '1');
    assert.match(w.__toasts.at(-1), /client/i);
    t.factureEditorChooseClient('c1');
    const card = d.getElementById('fact-client-info').textContent;
    for (const v of ['ALPHA LOGISTIQUE TEST', 'ADRESSE TEST', 'RC-A', 'NIF-A', 'AI-A']) assert.ok(card.includes(v), v);
    assert.strictEqual(d.getElementById('fact-mode').value, 'Chèque', 'conditions du client reprises');
    act(w, button(d, 'Continuer vers les prestations'));
    assert.strictEqual(step(d), '1', 'objet obligatoire');
    assert.match(w.__toasts.at(-1), /objet/);
    const choice = d.querySelector('.fact-subject-choice');
    choice.checked = true; act(w, choice, 'change');
    act(w, button(d, 'Continuer vers les prestations'));
    assert.strictEqual(step(d), '2');
    assert.deepStrictEqual(states(d), ['done', 'active', 'todo']);
    assert.match(d.getElementById('fac-ctx').textContent, /ALPHA LOGISTIQUE TEST[\s\S]*Assistance logistique/);
  } finally { t.facturationLeaveEditor(); env.window.close(); }
});

test('nouvelle facture : étape 2 — filtre par site du client, ajout, suppression, totaux, puis validation', async () => {
  const invoice = { id: 'fc-wiz', statut: 'brouillon', numero: 'BROUILLON', date: '2026-10-21', clientId: 'c1', client: 'ALPHA LOGISTIQUE TEST', clientNom: 'ALPHA LOGISTIQUE TEST',
    objet: 'Assistance logistique', objetServices: ['Assistance logistique'], modeReglement: 'Chèque', periodeDebut: '2026-10-01', periodeFin: '2026-10-31', lignes: [], societe: SOC };
  const { env, t, w, d } = editor(invoice);
  try {
    assert.strictEqual(step(d), '1', 'brouillon sans article : étape Client');
    act(w, button(d, 'Continuer vers les prestations'));
    assert.strictEqual(step(d), '2');
    t.factureEditorCatalogRender();
    // Sites du client (y compris SITE PORT sans prestation), jamais confondus avec le client.
    // Le catalogue est redessiné à chaque filtre : relire le sélecteur à chaque fois.
    const site = (value) => { const el = d.querySelector('#fact-commercial-catalog select'); el.value = value; act(w, el, 'change'); };
    const select = d.querySelector('#fact-commercial-catalog select');
    assert.deepStrictEqual([...select.options].map((o) => o.textContent), ['Tous les sites', 'SITE NORD', 'SITE SUD', 'SITE PORT']);
    const cards = () => [...d.querySelectorAll('.fact-catalog-card strong')].map((s) => s.textContent);
    assert.deepStrictEqual(cards(), ['CARISTE', 'COURSIER']);
    site('SITE SUD');
    assert.deepStrictEqual(cards(), ['COURSIER']);
    site('SITE PORT');
    assert.deepStrictEqual(cards(), []);
    assert.match(d.getElementById('fact-commercial-catalog').textContent, /Aucune prestation ne correspond au site « SITE PORT »/);
    site('');
    // Validation impossible sans article.
    act(w, button(d, 'Continuer vers la validation'));
    assert.strictEqual(step(d), '2');
    assert.match(w.__toasts.at(-1), /au moins un article/);
    act(w, d.querySelector('.fact-catalog-card .fac-catalog-pick'));     // CARISTE, SITE NORD : NBR 2
    act(w, d.querySelector('.fact-catalog-card .fac-catalog-pick:not([disabled])')); // COURSIER, SITE SUD : NBR 3
    const rows = () => [...d.querySelectorAll('.fact-ligne-row[data-type="article"]')];
    assert.strictEqual(rows().length, 2);
    assert.deepStrictEqual([...d.querySelectorAll('.fact-catalog-card')].map((c) => c.dataset.added), ['1', '1']);
    assert.strictEqual(plain(d.getElementById('fact-r-ht').textContent), '3500,00DZD', '2×1×1000 + 3×1×500');
    assert.strictEqual(plain(d.getElementById('fact-r-ttc').textContent), '4165,00DZD');
    assert.strictEqual(plain(d.getElementById('fact-header-ttc').textContent), '4165,00DZD', 'résumé = moteur de calcul');
    assert.strictEqual(plain(d.getElementById('fac-sum-ht').textContent), '3500,00DZD');
    assert.strictEqual(d.getElementById('fac-sum-count').textContent, '2 prestations ajoutées');
    assert.match(d.getElementById('fac-sum-note').textContent, /Calculs cohérents/);
    // Ligne libre ajoutée puis supprimée.
    t.factureEditorLigneAdd('article');
    assert.strictEqual(rows().length, 3);
    assert.match(d.getElementById('fac-sum-note').textContent, /Calculs incomplets/);
    t.factureEditorLigneRemove(rows()[2].querySelector('.fact-line-delete'));
    assert.strictEqual(rows().length, 2);
    // Étape 3 : contrôles réels, aperçu intégré (sans remplacer l'aperçu modal), numéro toujours BROUILLON.
    act(w, button(d, 'Continuer vers la validation'));
    assert.strictEqual(step(d), '3');
    assert.deepStrictEqual(states(d), ['done', 'done', 'active']);
    assert.deepStrictEqual([...d.querySelectorAll('.fac-check')].map((c) => c.dataset.ok), ['1', '1', '1', '1']);
    assert.match(d.getElementById('fac-checks').textContent, /2 prestations ajoutées/);
    assert.match(d.getElementById('fac-sum-note').textContent, /Prête à être validée/);
    assert.strictEqual(d.getElementById('fact-validate-btn').disabled, false);
    assert.ok(visible(d, 'Aperçu PDF') && visible(d, 'Valider et numéroter') && !visible(d, 'Continuer vers la validation'));
    assert.strictEqual(d.getElementById('fact-numero').value, 'BROUILLON', 'aucun numéro avant la validation serveur');
    await new Promise((resolve) => setTimeout(resolve, 200));
    {
      const preview = d.getElementById('fac-inline-preview');
      assert.match(preview.textContent, /FACTURE[\s\S]*BROUILLON[\s\S]*CARISTE[\s\S]*COURSIER/);
      assert.strictEqual(d.getElementById('fact-print-area'), null, 'aperçu intégré distinct de l’aperçu modal');
      assert.strictEqual(preview.querySelector('#fact-verification-qr'), null);
      // Retours 3 → 2 → 1 par le stepper ; les données restent dans le formulaire.
      act(w, d.getElementById('fact-step-lines'));
      assert.strictEqual(step(d), '2');
      act(w, d.getElementById('fact-step-client'));
      assert.strictEqual(step(d), '1');
      assert.strictEqual(rows().length, 2);
      // Les actions restent celles du module : brouillon et validation serveur.
      const calls = [];
      w.factureEditorSave = (o) => { calls.push(o); return Promise.resolve(null); };
      act(w, button(d, 'Enregistrer le brouillon'));
      act(w, d.getElementById('fact-validate-btn'));
      assert.deepStrictEqual(JSON.parse(JSON.stringify(calls)), [{ draft: true }, { validate: true }]);
    }
  } finally { t.facturationLeaveEditor(); env.window.close(); }
});

test('nouvelle facture : brouillon avec articles rouvert à l’étape 2 ; facture émise en lecture seule à l’étape 3', () => {
  const draft = { id: 'fc-d', statut: 'brouillon', numero: 'BROUILLON', date: '2026-10-21', societe: SOC, periodeDebut: '2026-10-01', periodeFin: '2026-10-31',
    lignes: [{ type: 'article', designation: 'LIBRE', unite: 'Mois', nbr: 1, qte: 1, prixUnitHT: 100 }] };
  let ctx = editor(draft);
  try {
    assert.strictEqual(step(ctx.d), '2');
    assert.ok(ctx.d.querySelector('.fact-ligne-row .fact-ligne-nbr'));
  } finally { ctx.t.facturationLeaveEditor(); ctx.env.window.close(); }
  const issued = { id: 'fc-e', statut: 'emise', numero: 'FAC0009/10/26', date: '2026-10-01', societe: SOC, client: 'ALPHA LOGISTIQUE TEST', clientId: 'c1',
    periodeDebut: '2026-09-01', periodeFin: '2026-09-30', objet: 'Assistance logistique', ttc: 119, montantHT: 100, tvaAmt: 19,
    lignes: [{ type: 'article', designation: 'LIBRE', unite: 'Mois', nbr: 1, qte: 1, prixUnitHT: 100 }] };
  ctx = editor(issued);
  try {
    const { d, w } = ctx;
    assert.strictEqual(step(d), '3');
    assert.strictEqual(d.querySelector('.fac-editor').dataset.readonly, '1');
    assert.match(d.querySelector('.fac-editor-title').textContent, /Facture FAC0009\/10\/26/);
    assert.match(d.body.textContent, /Facture validée — lecture seule/);
    assert.strictEqual(d.getElementById('fact-validate-btn'), null);
    assert.ok(d.getElementById('fact-texteSupp').disabled && d.getElementById('fact-periode-debut').disabled);
    assert.ok([...d.querySelectorAll('.fac-summary-actions button')].some((b) => /^openPaiementModal/.test(b.getAttribute('onclick'))));
    act(w, d.getElementById('fact-step-client'));
    assert.strictEqual(step(d), '1', 'consultation libre des étapes d’une facture émise');
  } finally { ctx.t.facturationLeaveEditor(); ctx.env.window.close(); }
});

test('portail Facturation : navigation dans l’ordre demandé, séparateur, entrée active et cloche des retards', () => {
  const { env, t, w, d } = boot();
  try {
    t.setDb({ factures: INVOICES.map((f) => ({ ...f })), paiements: [], avoirs: [] });
    d.body.insertAdjacentHTML('beforeend', '<nav id="sidebar-nav"></nav><button class="fac-bell"><span class="fac-bell-count" hidden></span></button><select id="fac-year-select"></select>');
    w.history.replaceState(null, '', '#/facturation/clients');
    t.renderFacStandaloneNav();
    const nav = d.getElementById('sidebar-nav');
    assert.deepStrictEqual([...nav.children].map((el) => el.classList.contains('fac-nav-sep') ? '—' : el.textContent.trim()).slice(1),
      ['Tableau de bord', 'Clients', 'Prestations à facturer', 'Factures', 'Paiements', 'Avances', 'Avoirs', '—', 'Caisse', 'Balance âgée', 'Situation']);
    assert.strictEqual(nav.querySelector('.fac-nav-link.active').dataset.route, 'facturation/clients');
    assert.strictEqual(nav.querySelectorAll('.fac-nav-link svg').length, 10);
    // f1 a une échéance dépassée (aucun paiement dans ce jeu) ; f3 sans échéance n'est jamais en retard.
    const count = d.querySelector('.fac-bell-count');
    assert.strictEqual(count.textContent, '2', 'f1 et f4');
    assert.strictEqual(count.hidden, false);
    assert.deepStrictEqual([...d.querySelectorAll('#fac-year-select option')].map((o) => o.value), ['2026', '2025']);
  } finally { env.window.close(); }
});
