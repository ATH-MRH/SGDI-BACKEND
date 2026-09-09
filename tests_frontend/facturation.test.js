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
