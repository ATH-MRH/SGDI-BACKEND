// Commercial — unité tarifaire par prestation (catalogue « Effectif global ») : colonne
// Prix unitaire + Unité tarifaire, anciennes prestations « Unité à définir » conservées,
// nouvelle prestation tarifée refusée sans unité, prix jamais converti. Vrai code.
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

function openForm(lines) {
  const app = loadSgdiApp(['openClientModal', 'clientLigneAdd', 'clientLigneSyncHidden', 'clientCatalogMissingUnits', 'clientCatalogPriceLabel',
    'confirmClient', 'clientBillingUnit']);
  assert.ifError(app.loadError);
  const clients = [{ id: 'c1', nom: 'CLIENT', societe: 'A', lignesFacturation: lines }];
  app.T().setDb(new Proxy({ clients, settings: {} }, { get: (obj, key) => obj[key] || (obj[key] = []) }));
  app.T().setSession({ username: 'DC', transverse: 'dc', societe: 'A' });
  app.T().openClientModal('c1');
  return { app, t: app.T(), d: app.window.document, clients };
}

test('catalogue : colonne « Unité tarifaire » ; ancienne prestation « Unité à définir » ; nouvelle ligne « — Choisir — »', async () => {
  const { app, t, d } = openForm([{ designation: 'MAGASINIER', prixUnitaire: 92109.6, qte: 25 }, { designation: 'AGENT', prixUnitaire: 3070.32, unite: 'Jour' }]);
  try {
    await new Promise((r) => setTimeout(r, 10));
    const table = d.getElementById('client-lignes-body').closest('table');
    assert.deepStrictEqual([...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()), ['Désignation', 'Prix unitaire', 'Unité tarifaire', '']);
    const selects = [...d.querySelectorAll('#client-lignes-body .client-ligne-unite')];
    assert.deepStrictEqual(selects.map((s) => [s.value, s.options[s.selectedIndex].textContent]), [['', 'Unité à définir'], ['Jour', 'Jour']]);
    assert.deepStrictEqual([...selects[0].options].map((o) => o.value), ['', 'Heure', 'Jour', 'Mois', 'Forfait']);
    t.clientLigneAdd();
    const added = [...d.querySelectorAll('#client-lignes-body .client-ligne-unite')][2];
    assert.strictEqual(added.options[added.selectedIndex].textContent, '— Choisir —');
    // Synchronisation : unité enregistrée par prestation, autres champs d'origine conservés, prix intact.
    selects[0].value = 'Mois'; t.clientLigneSyncHidden();
    const saved = JSON.parse(d.querySelector("[name='lignesFacturation']").value);
    assert.deepStrictEqual(saved.slice(0, 2), [{ designation: 'MAGASINIER', prixUnitaire: 92109.6, qte: 25, unite: 'Mois' },
      { designation: 'AGENT', prixUnitaire: 3070.32, unite: 'Jour' }]);
    assert.strictEqual(t.clientCatalogPriceLabel('MAGASINIER', saved).replace(/[\s  ]/g, ''), '92109,60DZD/Mois');
    assert.strictEqual(t.clientCatalogPriceLabel('X', [{ designation: 'X', prixUnitaire: 5 }]).replace(/[\s  ]/g, ''), '5,00DZD·Unitéàdéfinir');
  } finally { app.window.close(); }
});

test('enregistrement : nouvelle prestation tarifée sans unité refusée ; ancienne inchangée acceptée', async () => {
  const previous = [{ designation: 'MAGASINIER', prixUnitaire: 92109.6 }];
  const { app, t, d, clients } = openForm(previous);
  try {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.clientCatalogMissingUnits(previous, previous))), []);
    assert.strictEqual(t.clientCatalogMissingUnits([{ designation: 'MAGASINIER', prixUnitaire: 90000 }], previous).length, 1, 'prix modifié');
    assert.strictEqual(t.clientCatalogMissingUnits([{ designation: 'AGENT', prixUnitaire: 1 }], previous).length, 1, 'nouvelle prestation');
    assert.strictEqual(t.clientCatalogMissingUnits([{ designation: 'AGENT', prixUnitaire: 1, unite: 'heure' }], previous).length, 0);
    assert.strictEqual(t.clientCatalogMissingUnits([{ designation: 'AGENT', prixUnitaire: 0 }], previous).length, 0, 'sans prix');
    assert.deepStrictEqual(['h', 'J', 'mois', 'forfaitaire', 'Semaine'].map(t.clientBillingUnit), ['Heure', 'Jour', 'Mois', 'Forfait', '']);
    // Formulaire réel : ajout d'une prestation tarifée sans unité ⇒ enregistrement refusé, rien d'écrit.
    await new Promise((r) => setTimeout(r, 10));
    t.clientLigneAdd();
    const inputs = [...d.querySelectorAll('#client-lignes-body tr')][1].querySelectorAll('input');
    inputs[0].value = 'AGENT'; inputs[1].value = '3070,32'; t.clientLigneSyncHidden();
    const before = JSON.stringify(clients);
    app.window.eval('window.__toasts=[];toast=function(m){window.__toasts.push(String(m))}');
    assert.strictEqual(await t.confirmClient('c1'), false);
    assert.match(app.window.__toasts.join(' | '), /unité tarifaire de la prestation « AGENT »/);
    assert.strictEqual(JSON.stringify(clients), before);
  } finally { app.window.close(); }
});
