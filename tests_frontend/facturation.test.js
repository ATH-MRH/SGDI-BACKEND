// Tests FRONTEND facturation / commercial — calculs financiers.
// Cœur : le statut de paiement d'une facture (factureStatutPaye) — payé / partiel /
// échu / annulé, reste à payer, avoirs déduits. Plus TVA et numérotation.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { loadSgdiApp } = require('./load-app');

const { loadError, T } = loadSgdiApp([
  'clientMontantTTC', 'nextDevisNum', 'nextFactureNum', 'factureStatutPaye', 'factureComputeLinesTotals', 'factureClientPaymentDefaults', 'setDb',
]);

test('sgdi-app.js se charge et expose les calculs facturation', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  const t = T();
  for (const n of ['clientMontantTTC', 'nextFactureNum', 'factureStatutPaye']) {
    assert.ok(t[n], `${n} introuvable`);
  }
});

test('les bibliothèques PDF sont différées jusqu’au téléchargement', async () => {
  const root = path.join(__dirname, '..');
  const app = require('./read-client-source')();
  assert.match(app, /sgdiLoadFeatureScript\("\/static\/js\/features\/pdf\.js\?v=20260908-modular"\)/);

  const loaderScript = fs.readFileSync(path.join(root, 'app', 'static', 'js', 'features', 'pdf.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://atlas.example/', runScripts: 'outside-only',
  });
  const { window } = dom;
  const loaded = [];
  window.document.head.appendChild = (script) => {
    loaded.push(script.src);
    if (script.src.includes('html2canvas')) window.html2canvas = () => {};
    if (script.src.includes('jspdf')) window.jspdf = { jsPDF: function jsPDF() {} };
    queueMicrotask(() => script.onload());
    return script;
  };
  window.eval(loaderScript);
  assert.deepStrictEqual(loaded, [], 'aucune bibliothèque PDF ne doit partir au bootstrap');
  await Promise.all([window.sgdiLoadPDFLibs(), window.sgdiLoadPDFLibs()]);
  assert.deepStrictEqual(loaded.map((url) => new URL(url).pathname), [
    '/static/html2canvas.min.js', '/static/jspdf.umd.min.js',
  ]);
  await window.sgdiLoadPDFLibs();
  assert.strictEqual(loaded.length, 2, 'les bibliothèques déjà chargées doivent être réutilisées');
  dom.window.close();
});

test('les quatre pages chargent les utilitaires avant l\'application sans PDF au bootstrap', () => {
  const staticRoot = path.join(__dirname, '..', 'app', 'static');
  for (const file of ['index.html', 'paie.html', 'conges.html', 'facturation.html']) {
    const html = fs.readFileSync(path.join(staticRoot, file), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
    assert.ok(!scripts.some((src) => src.includes('jspdf.umd.min.js')), `${file} charge jsPDF au bootstrap`);
    assert.ok(!scripts.some((src) => src.includes('html2canvas.min.js')), `${file} charge html2canvas au bootstrap`);
    const utilsIndex = scripts.findIndex((src) => src.includes('/static/js/core/utils.js'));
    const appIndex = scripts.findIndex((src) => src.includes('/static/sgdi-app.js'));
    assert.ok(utilsIndex >= 0, `${file} ne charge pas utils.js`);
    assert.ok(appIndex >= 0, `${file} ne charge pas sgdi-app.js`);
    assert.ok(utilsIndex < appIndex, `${file} doit charger utils.js avant sgdi-app.js`);
  }
});

test('le chargeur de feature déduplique les chargements concurrents', async () => {
  const core = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'utils.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://atlas.example/', runScripts: 'outside-only',
  });
  const { window } = dom;
  const loaded = [];
  window.document.head.appendChild = (script) => {
    loaded.push(script.src);
    queueMicrotask(() => script.onload());
    return script;
  };
  window.eval(core);
  await Promise.all([
    window.sgdiLoadFeatureScript('/static/js/features/pdf.js'),
    window.sgdiLoadFeatureScript('/static/js/features/pdf.js'),
  ]);
  assert.deepStrictEqual(loaded.map((url) => new URL(url).pathname), ['/static/js/features/pdf.js']);
  dom.window.close();
});

test('le chargeur de feature libère un échec puis réutilise le chargement réussi', async () => {
  const core = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'utils.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://atlas.example/', runScripts: 'outside-only',
  });
  const { window } = dom;
  let insertions = 0;
  window.document.head.appendChild = (script) => {
    insertions += 1;
    queueMicrotask(() => insertions === 1 ? script.onerror(new Error('network')) : script.onload());
    return script;
  };
  window.eval(core);
  await assert.rejects(window.sgdiLoadFeatureScript('/static/js/features/pdf.js'));
  const successful = window.sgdiLoadFeatureScript('/static/js/features/pdf.js');
  await successful;
  const reused = window.sgdiLoadFeatureScript('/static/js/features/pdf.js');
  assert.strictEqual(reused, successful);
  await reused;
  assert.strictEqual(insertions, 2);
  dom.window.close();
});

test('le chargeur PDF retente après un échec html2canvas puis réutilise le succès', async () => {
  const loaderScript = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'features', 'pdf.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://atlas.example/', runScripts: 'outside-only',
  });
  const { window } = dom;
  const loaded = [];
  let htmlAttempts = 0;
  window.document.head.appendChild = (script) => {
    loaded.push(new URL(script.src).pathname);
    queueMicrotask(() => {
      if (script.src.includes('html2canvas')) {
        htmlAttempts += 1;
        if (htmlAttempts === 1) return script.onerror(new Error('network'));
        window.html2canvas = () => {};
      } else {
        window.jspdf = { jsPDF: function jsPDF() {} };
      }
      script.onload();
    });
    return script;
  };
  window.eval(loaderScript);
  await assert.rejects(window.sgdiLoadPDFLibs());
  await window.sgdiLoadPDFLibs();
  await window.sgdiLoadPDFLibs();
  assert.deepStrictEqual(loaded, [
    '/static/html2canvas.min.js', '/static/html2canvas.min.js', '/static/jspdf.umd.min.js',
  ]);
  dom.window.close();
});

test('le chargeur PDF ne recharge que jsPDF après son échec', async () => {
  const loaderScript = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'features', 'pdf.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://atlas.example/', runScripts: 'outside-only',
  });
  const { window } = dom;
  const loaded = [];
  let jsPdfAttempts = 0;
  window.document.head.appendChild = (script) => {
    loaded.push(new URL(script.src).pathname);
    queueMicrotask(() => {
      if (script.src.includes('html2canvas')) {
        window.html2canvas = () => {};
        return script.onload();
      }
      jsPdfAttempts += 1;
      if (jsPdfAttempts === 1) return script.onerror(new Error('network'));
      window.jspdf = { jsPDF: function jsPDF() {} };
      script.onload();
    });
    return script;
  };
  window.eval(loaderScript);
  await assert.rejects(window.sgdiLoadPDFLibs());
  await window.sgdiLoadPDFLibs();
  await window.sgdiLoadPDFLibs();
  assert.deepStrictEqual(loaded, [
    '/static/html2canvas.min.js', '/static/jspdf.umd.min.js', '/static/jspdf.umd.min.js',
  ]);
  dom.window.close();
});

// ── TVA / montants ───────────────────────────────────────────────────────────

test('clientMontantTTC : somme des lignes × 1,19 (TVA 19 %)', () => {
  const t = T();
  const client = { lignesFacturation: [
    { prixUnitaire: 1000, qte: 2 },   // 2000
    { prixUnitaire: 500, qte: 3 },    // 1500
  ] };
  assert.strictEqual(t.clientMontantTTC(client), 3500 * 1.19);
  // Une ligne catalogue sans quantité n'est pas encore facturable.
  assert.strictEqual(t.clientMontantTTC({ lignesFacturation: [{ prixUnitaire: 1000 }] }), 0);
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

test('nextFactureNum : les brouillons ne consomment pas de numéro définitif', () => {
  const t = T();
  t.setDb({ factures: [
    { id: 'draft', numero: 'BROUILLON', statut: 'brouillon' },
    { id: 'issued', numero: 'FAC0004/07/26', statut: 'emise' },
  ] });
  assert.match(t.nextFactureNum(), /^FAC0005\/\d{2}\/\d{2}$/);
});

test('factureComputeLinesTotals : applique remise, TVA et TTC au montant sauvegardé', () => {
  const t = T();
  const totals = t.factureComputeLinesTotals([
    { type: 'article', qte: 2, prixUnitHT: 1000, totalHT: 2000 },
    { type: 'remise', remisePct: 10 },
  ], 19);
  assert.strictEqual(totals.totalHT, 1800);
  assert.strictEqual(totals.totalTVA, 342);
  assert.strictEqual(totals.totalTTC, 2142);
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

test('factureStatutPaye : arrondit le reste au centime pour le paiement intégral', () => {
  const t = T();
  t.setDb({ paiements: [], avoirs: [] });
  const result = t.factureStatutPaye({ id: 'f-round', ttc: 898058.728, statut: 'emise' });
  assert.equal(result.reste, 898058.73);
});

test('factureClientPaymentDefaults : reprend les conditions client et calcule les dates', () => {
  const t = T();
  const result = t.factureClientPaymentDefaults({modePaiement:'Virement bancaire',delaiPaiement:'30 jours',delaiDepotFacture:'3',remarqueFacture:'Bon de commande obligatoire'},'2026-08-03');
  assert.equal(JSON.stringify(result),JSON.stringify({echeance:'30 jours',modeReglement:'Virement bancaire',dateDepot:'2026-08-06',dateEcheance:'2026-09-02',remarque:'Bon de commande obligatoire'}));
});

test.after(() => { setTimeout(() => process.exit(0), 50); });

test('Facturation client: all five tabs are read-only, navigation remains available and writes are blocked', async () => {
  const app=loadSgdiApp(['openClientModal','sgdiTabSwitch','saveClientInPlace','confirmClient','validateDcMission','sgdiExitViewMode','techUnlockDonneesTechniques','clientUnlockContrat']);
  assert.ifError(app.loadError);
  app.window.__FAC_AUTONOMOUS_APP__=true;
  const clients=[{id:'c1',nom:'CLIENT A',societe:'A',nif:'00123'},{id:'c2',nom:'CLIENT B',societe:'A'}];
  app.T().setDb(new Proxy({clients,settings:{}},{get:(obj,key)=>obj[key]||(obj[key]=[])}));
  app.T().setSession({username:'FAC',transverse:'facmod',societe:'A'});
  app.T().openClientModal('c1');
  await new Promise(r=>setTimeout(r,10));
  const form=app.window.document.querySelector('[data-client-editor]');
  assert.equal(form.dataset.clientReadonly,'1');
  const tabs=Array.from(form.querySelectorAll('[role=tab]'));
  assert.deepEqual(tabs.map(b=>b.textContent),['Information','Facturation','Contrat','Mission','Historique']);
  const nav=form.querySelector('[data-client-navigation]');
  assert.equal(nav.disabled,false);assert.match(nav.getAttribute('onchange'),/true/);
  const tabId=tabs[0].id.replace(/-tab-0$/,'');
  for(let i=0;i<5;i++){
    app.T().sgdiTabSwitch(tabId,i);
    app.T().sgdiExitViewMode();app.T().techUnlockDonneesTechniques();app.T().clientUnlockContrat();
    const panel=form.querySelector('#'+tabId+'-panel-'+i);
    assert.equal(panel.style.display,'block');
    for(const control of panel.querySelectorAll('input,select,textarea'))assert.equal(control.disabled,true,control.name);
    for(const button of panel.querySelectorAll('button')){
      const action=button.getAttribute('onclick')||'';
      if(!/^(techSiteTab|ctsSiteTab)\(/.test(action))assert.equal(button.hidden,true,button.textContent);
    }
  }
  const before=JSON.stringify(clients);
  assert.equal(await app.T().saveClientInPlace(),false);
  assert.equal(await app.T().confirmClient('c1'),false);
  assert.equal(await app.T().validateDcMission('c1'),false);
  assert.equal(JSON.stringify(clients),before);
  app.T().openClientModal('c2');
  assert.equal(app.window.document.querySelector('[data-client-editor]').dataset.clientReadonly,'1');
  app.dom.window.close();
});

test('Commercial retains the editable client form outside Facturation', async () => {
  const app=loadSgdiApp(['openClientModal']);
  app.T().setDb(new Proxy({clients:[{id:'c1',nom:'CLIENT',societe:'A'}],settings:{}},{get:(obj,key)=>obj[key]||(obj[key]=[])}));
  app.T().setSession({username:'DC',transverse:'dc',societe:'A'});
  app.T().openClientModal('c1');
  await new Promise(r=>setTimeout(r,10));
  const form=app.window.document.querySelector('[data-client-editor]');
  assert.equal(form.dataset.clientReadonly,'0');
  assert.equal(form.querySelector('[name=nom]').disabled,false);
  app.dom.window.close();
});

test('Facturation affiche le même TTC contractuel que Commercial depuis les clients serveur', async()=>{
  const app=loadSgdiApp(['renderFactClients','clientMontantTTC','formatDZD']);
  assert.strictEqual(app.loadError,null);
  const w=app.window,t=app.T();
  t.setSession({username:'TEST',societe:'IRON GLOBAL SOLUTION',transverse:'facmod'});
  const client={id:'shared-client',nom:'Client partagé',societe:'IRON GLOBAL SOLUTION',
    lignesFacturation:[{designation:'APS',prixUnitaire:1000},{designation:'Chef',prixUnitaire:2000}],
    tech_sites:[{lignesFacturation:[{designation:'APS',qte:10},{designation:'Chef',qte:2}]},
                {lignesFacturation:[{designation:'APS',qte:5}]}]};
  let requestedScope;
  w.SGDI.commercial.clientsPage=async params=>{
    requestedScope=params.society;
    return {items:[{id:45,name:client.nom,society:client.societe,data:client}],total:1,page:1,page_size:25};
  };
  const view=w.document.createElement('div');w.document.body.appendChild(view);
  await t.renderFactClients(view);
  assert.strictEqual(requestedScope,client.societe);
  assert.strictEqual(t.clientMontantTTC(client),19000*1.19);
  const cells=view.querySelectorAll('tbody tr td');
  assert.strictEqual(cells[7].textContent,t.formatDZD(19000*1.19));
  assert.notStrictEqual(cells[7].textContent,t.formatDZD(3000*1.19));
  // Ancien contrat : les quantités globales restent prises en compte par le calcul partagé.
  client.lignesFacturation=[{prixUnitaire:500,qte:3}];client.tech_sites=[];
  await t.renderFactClients(view);
  assert.strictEqual(view.querySelectorAll('tbody tr td')[7].textContent,t.formatDZD(1500*1.19));
  w.close();
});

test('catalogue Commercial : sélection explicite, quantité par site, anti-doublon et facture figée',()=>{
  const app=loadSgdiApp(['factureCommercialArticles','factureEditorClientChange','factureEditorCatalogRender','factureEditorCatalogAdd','factureEditorLigneHTML','facturationLeaveEditor']);
  assert.strictEqual(app.loadError,null);
  const w=app.window,t=app.T();
  t.setSession({username:'TEST',societe:'IRON GLOBAL SOLUTION'});
  const client={id:'c1',nom:'Test',societe:'IRON GLOBAL SOLUTION',lignesFacturation:[{designation:'APS',prixUnitaire:100},{designation:'Sans tarif',prixUnitaire:0}],tech_sites:[{nom:'Site A',lignesFacturation:[{designation:'APS',qte:4}]},{nom:'Site B',lignesFacturation:[{designation:'APS',qte:7}]}]};
  t.setDb({clients:[client],factures:[]});
  w.document.body.innerHTML='<input id="fact-clientId" value="c1"><section id="fact-commercial-catalog"></section><table><tbody id="fact-lignes-body"></tbody></table>';
  t.factureEditorClientChange({value:'c1'});
  assert.equal(w.document.querySelectorAll('.fact-ligne-row').length,0);
  assert.equal(w.document.querySelectorAll('.fact-catalog-card').length,3);
  assert.match(w.document.querySelector('.fact-catalog-card:last-child').textContent,/Tarif à compléter/);
  t.factureEditorCatalogAdd(0);t.factureEditorCatalogAdd(0);
  assert.equal(w.document.querySelectorAll('.fact-ligne-row').length,1);
  let row=w.document.querySelector('.fact-ligne-row');
  assert.equal(row.querySelector('.fact-ligne-qte').value,'4');
  assert.equal(row.querySelector('.fact-ligne-prix').value,'100,00');
  assert.equal(row.dataset.siteNom,'Site A');
  assert.equal(row.dataset.contractQuantity,'4');
  t.factureEditorCatalogAdd(1);
  assert.equal(w.document.querySelectorAll('.fact-ligne-row').length,2);
  t.factureEditorCatalogAdd(2);
  assert.equal(w.document.querySelectorAll('.fact-ligne-row').length,2);
  client.lignesFacturation[0].prixUnitaire=900;
  t.factureEditorCatalogRender();
  assert.equal(row.querySelector('.fact-ligne-prix').value,'100,00');
  const filter=w.document.querySelector('#fact-commercial-catalog select');filter.value='Site B';t.factureEditorCatalogRender();
  assert.equal(w.document.querySelectorAll('.fact-catalog-card').length,1);
  w.__factureEditId='issued';t.setDb({clients:[client],factures:[{id:'issued',statut:'emise'}]});
  t.factureEditorCatalogRender();assert.equal(w.document.getElementById('fact-commercial-catalog').hidden,true);
  row.remove();t.factureEditorCatalogAdd(0);assert.equal(w.document.querySelectorAll('.fact-ligne-row').length,1);
  t.facturationLeaveEditor();w.close();
});

test('aperçu facture : identité fiscale de la société active sous le logo et le nom, distincte du client', () => {
  const env = loadSgdiApp(['factureVoirApercu']);
  try {
    assert.strictEqual(env.loadError, null);
    const t = env.T();
    t.setDb({
      parametres: [
        { societe: 'IRON GLOBAL SOLUTION', rc: 'RC-SOLUTION', ai: 'AI-SOLUTION', nif: 'NIF-SOLUTION', nis: 'NIS-SOLUTION', adresse: 'Adresse <émetteur>' },
        { societe: 'IRON GLOBAL SÉCURITÉ', rc: 'RC-SECURITE' },
      ],
      factures: [{ id: 'preview', numero: 'F-001', statut: 'brouillon', client: 'Client exemple', rc: 'RC-CLIENT', nif: 'NIF-CLIENT', lignes: [{ designation: 'Service', quantite: 2, prixUnitaire: 100, totalHT: 200 }] }],
      paiements: [], avoirs: [],
    });
    t.setSession({ societe: 'IRON GLOBAL SOLUTION' });
    t.factureVoirApercu('preview');
    const doc = env.window.document;
    const issuer = doc.querySelector('#fact-print-area .fact-issuer-details');
    for (const value of ['RC-SOLUTION', 'AI-SOLUTION', 'NIF-SOLUTION', 'NIS-SOLUTION', 'Adresse <émetteur>']) {
      assert.ok(issuer.textContent.includes(value), value);
    }
    assert.ok(!issuer.textContent.includes('RC-CLIENT'));
    assert.ok(!issuer.textContent.includes('RC-SECURITE'));
    assert.strictEqual(issuer.querySelector('émetteur'), null, 'les valeurs doivent être échappées');
    const identity=issuer.closest('.fact-issuer-identity');
    assert.ok(identity.querySelector('img'));
    assert.ok(identity.textContent.indexOf('IRON GLOBAL SOLUTION') < identity.textContent.indexOf('RC-SOLUTION'));
    assert.ok(!identity.textContent.includes('FACTURE'));
    assert.ok(!identity.contains(doc.querySelector('#fact-verification-qr')));
    assert.ok(doc.querySelector('#fact-verification-qr'));
    assert.ok(doc.querySelector('#fact-print-area').textContent.includes('RC-CLIENT'));
    assert.match(doc.querySelector('tfoot').textContent, /238,00 DZD/);
    t.setSession({ societe: 'IRON GLOBAL SÉCURITÉ' });
    t.factureVoirApercu('preview');
    const other = doc.querySelector('.fact-issuer-details');
    assert.ok(other.textContent.includes('RC-SECURITE'));
    assert.ok(!other.textContent.includes('RC-SOLUTION'));
    assert.strictEqual((other.textContent.match(/À renseigner/g) || []).length, 4);
  } finally {
    env.window.close();
  }
});

test('déplacement des lignes : saisies, catalogue, ordre enregistré et aperçu conservés', async () => {
  const env=loadSgdiApp(['factureEditorLigneHTML','factureEditorLigneMove','factureEditorCalcTotals','factureEditorSave','factureVoirApercu']);
  try {
    assert.strictEqual(env.loadError,null);
    const t=env.T(),w=env.window,d=w.document;
    t.setSession({societe:'IRON GLOBAL SOLUTION'});
    const invoice={id:'move-test',statut:'brouillon',lignes:[]};
    t.setDb({factures:[invoice],paiements:[],avoirs:[]});w.__factureEditId=invoice.id;
    d.getElementById('view').innerHTML='<input id="fact-clientNom" value="Client"><input id="fact-siteNom"><table><tbody id="fact-lignes-body">'+
      [{designation:'A',qte:2,prixUnitHT:100,catalogKey:'key-a',siteNom:'Site A'}, {designation:'B',qte:3,prixUnitHT:200}].map(t.factureEditorLigneHTML).join('')+'</tbody></table>';
    const body=d.getElementById('fact-lignes-body'),a=body.children[0],b=body.children[1];
    a.querySelector('.fact-ligne-desig').value='A modifié';
    t.factureEditorCalcTotals();
    assert.ok(a.querySelector('[data-move="-1"]').disabled);
    assert.ok(b.querySelector('[data-move="1"]').disabled);
    t.factureEditorLigneMove(a.querySelector('[data-move="1"]'),1);
    assert.strictEqual(body.children[1],a,'même nœud, aucune saisie perdue');
    assert.strictEqual(a.querySelector('.fact-ligne-desig').value,'A modifié');
    assert.strictEqual(a.dataset.catalogKey,'key-a');
    t.factureEditorLigneMove(a.querySelector('[data-move="-1"]'),-1);
    assert.strictEqual(body.children[0],a);
    t.factureEditorLigneMove(a.querySelector('[data-move="-1"]'),-1);
    assert.strictEqual(body.children[0],a,'aucun déplacement au-delà de la première ligne');
    t.factureEditorLigneMove(a.querySelector('[data-move="1"]'),1);
    w.eval('sgdiApi=async function(url,options){window.__savedInvoice=options.body.data;return options.body.data}');
    await t.factureEditorSave({draft:true,silent:true});
    assert.deepStrictEqual(Array.from(w.__savedInvoice.lignes,l=>l.designation),['B','A modifié']);
    assert.strictEqual(w.__savedInvoice.montantTTC,952);
    t.factureVoirApercu(invoice.id);
    const text=d.querySelector('#fact-print-area table:has(tfoot) tbody').textContent;
    assert.ok(text.indexOf('B')<text.indexOf('A modifié'));
    invoice.statut='emise';
    t.factureEditorLigneMove(a.querySelector('[data-move="-1"]'),-1);
    assert.strictEqual(body.children[1],a,'facture validée non réordonnable');
  } finally {env.window.close();}
});

test('période de facturation : enregistrement, réouverture, aperçu et dates invalides', async () => {
  const env=loadSgdiApp(['renderFactureEditor','factureEditorSave','factureEditorValidate','factureVoirApercu']);
  try {
    assert.strictEqual(env.loadError,null);
    const t=env.T(),w=env.window,d=w.document;
    const invoice={id:'period-test',statut:'brouillon',clientId:'c',client:'Client',objet:'Prestation',lignes:[]};
    t.setSession({societe:'IRON GLOBAL SOLUTION'});
    t.setDb({factures:[invoice],clients:[],paiements:[],avoirs:[]});
    w.__factureEditId=invoice.id;
    w.eval('sgdiApi=async function(url,options){window.__savedInvoice=options.body.data;return options.body.data}');
    t.renderFactureEditor(d.getElementById('view'));
    d.getElementById('fact-periode-debut').value='2026-09-01';
    d.getElementById('fact-periode-fin').value='2026-09-30';
    await t.factureEditorSave({draft:true,silent:true});
    assert.strictEqual(w.__savedInvoice.periodeDebut,'2026-09-01');
    assert.strictEqual(w.__savedInvoice.periodeFin,'2026-09-30');
    t.renderFactureEditor(d.getElementById('view'));
    assert.strictEqual(d.getElementById('fact-periode-debut').value,'2026-09-01');
    assert.strictEqual(d.getElementById('fact-periode-fin').value,'2026-09-30');
    t.factureVoirApercu(invoice.id);
    assert.match(d.querySelector('.fact-billing-period').textContent,/du 01\/09\/2026 au 30\/09\/2026/);
    d.getElementById('fact-periode-fin').value='2026-08-30';
    assert.strictEqual(t.factureEditorValidate(),false);
    assert.strictEqual(d.getElementById('fact-periode-fin').style.borderColor,'rgb(239, 68, 68)');
    d.getElementById('fact-periode-fin').value='';
    assert.strictEqual(t.factureEditorValidate(),false);
    invoice.statut='emise';
    t.renderFactureEditor(d.getElementById('view'));
    assert.ok(d.getElementById('fact-periode-debut').disabled);
    assert.ok(d.getElementById('fact-periode-fin').disabled);
  } finally {env.window.close();}
});


test('total TTC de l’en-tête : mêmes montants que le récapitulatif après chaque saisie', () => {
  const env=loadSgdiApp(['factureEditorLigneHTML','factureEditorCalcTotals']);
  try {
    assert.strictEqual(env.loadError,null);
    const t=env.T(),d=env.window.document;
    d.getElementById('view').innerHTML='<output id="fact-header-ttc"></output><span id="fact-r-ttc"></span><input id="fact-tva-global" value="19"><table><tbody id="fact-lignes-body">'+t.factureEditorLigneHTML({designation:'Service',qte:2,prixUnitHT:100})+'</tbody></table>';
    const check=(expected)=>{t.factureEditorCalcTotals();assert.equal(d.getElementById('fact-header-ttc').textContent,d.getElementById('fact-r-ttc').textContent);assert.equal(d.getElementById('fact-header-ttc').textContent.replace(/[\s\u00a0\u202f]/g,''),expected);};
    check('238,00DZD');
    d.querySelector('.fact-ligne-prix').value='100,50';check('239,19DZD');
    d.querySelector('.fact-ligne-qte').value='4';check('478,38DZD');
    d.getElementById('fact-tva-global').value='9';check('438,18DZD');
    d.querySelector('.fact-ligne-row').remove();check('0,00DZD');
  } finally { env.window.close(); }
});
