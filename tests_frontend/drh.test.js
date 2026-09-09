// Tests FRONTEND du module DRH — vraies fonctions de app/static/sgdi-app.js.
// Couvre : congés acquis (2,5 j/mois) et reliquat STC, matricules par société,
// validation candidat (âge, identité) et cycle de vie candidat.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadSgdiApp } = require('./load-app');

const { loadError, T } = loadSgdiApp([
  // Congés / STC
  'drhLeaveEntitlement',
  'calculateStcCongeReliquat',
  'drhSortantEffectiveDate',
  'drhStcReliquatDisplay',
  // Matricules
  'matriculePrefixesForSociete',
  'nextMatricule',
  'normalizeEmployeeCodeFormat',
  'normalizeSocieteName',
  // Candidats
  'candidatAgeAtSave',
  'candidateIdentityMissing',
  'candidateHasMinimumData',
  'candidatIsArchived',
  'candidatIsRecruited',
  'candidatIsActive',
  'employeeNewContractTarget',
  'employeeValidContractBlockReason',
]);

test('sgdi-app.js se charge et expose les fonctions DRH', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  const t = T();
  for (const name of ['drhLeaveEntitlement', 'nextMatricule', 'candidatAgeAtSave']) {
    assert.ok(t[name], `${name} introuvable`);
  }
});

test('dashboard Contrats moderne: restitue les zones validées et des actions réelles', () => {
  const js = require('./read-client-source')();
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.css'), 'utf8');
  for (const label of ['Santé contractuelle', 'Échéances des 90 prochains jours', 'À faire maintenant', 'File de traitement intelligente', 'Portefeuille actif']) {
    assert.ok(js.includes(label), `zone manquante: ${label}`);
  }
  assert.ok(js.includes('function exportContratsCSV()'), 'export contrats non raccordé');
  assert.ok(js.includes("navigate('effectif/agent/"), 'ouverture de la fiche employé non raccordée');
  assert.ok(css.includes('.contract-modern-dashboard'), 'style du dashboard moderne absent');
});

test('nouveau contrat: un identifiant explicite ne retombe jamais sur un autre employé', () => {
  const t = T();
  const achour = { id: 'achour', nom: 'ACHOUR', prenom: 'ABDELKADER', dateFinContrat: '2099-10-09', statut: 'actif' };
  const bilel = { id: 'bilel', nom: 'GOURMIDA', prenom: 'BILEL', dateFinContrat: '2020-06-30', statut: 'actif' };
  t.setDb({ agents: [achour, bilel] });
  assert.strictEqual(t.employeeNewContractTarget('bilel').id, 'bilel');
  assert.strictEqual(t.employeeNewContractTarget('inconnu'), null, 'identifiant inconnu: aucun repli sur ACHOUR');
  assert.strictEqual(t.employeeNewContractTarget().id, 'bilel', 'depuis Contrats, choisir un employé éligible');
});

// ── Congés acquis : 2,5 jours par mois ───────────────────────────────────────

test('drhLeaveEntitlement: 2,5 j/mois — 6 mois = 15 j, 12 mois = 30 j (bug STC 30 au lieu de 15)', () => {
  const f = T().drhLeaveEntitlement;
  assert.strictEqual(f('2025-01-01', '2025-07-01'), 15); // 6 mois
  assert.strictEqual(f('2025-01-01', '2026-01-01'), 30); // 12 mois
  assert.strictEqual(f('2025-01-01', '2025-02-01'), 2.5); // 1 mois
});

test('drhLeaveEntitlement: proratise le mois entamé et refuse les dates incohérentes', () => {
  const f = T().drhLeaveEntitlement;
  assert.strictEqual(f('2025-01-01', '2024-12-31'), 0, 'asOf avant le recrutement -> 0');
  assert.strictEqual(f('', '2025-07-01'), 0, 'sans date de recrutement -> 0');
  const mid = f('2025-01-01', '2025-01-16'); // ~la moitié du 1er mois
  assert.ok(mid > 1 && mid < 2.5, `prorata attendu entre 1 et 2.5, obtenu ${mid}`);
});

test('calculateStcCongeReliquat: acquis - congés approuvés (hors Maladie)', () => {
  const t = T();
  const agent = { id: 'a1', dateRecrutement: '2025-01-01' };
  t.setDb({
    conges: [
      { agentId: 'a1', type: 'Annuel', statut: 'approuve', joursConge: 5 },
      { agentId: 'a1', type: 'Maladie', statut: 'approuve', joursConge: 10 },   // exclu
      { agentId: 'a1', type: 'Annuel', statut: 'en_attente', joursConge: 3 },   // exclu
      { agentId: 'a2', type: 'Annuel', statut: 'approuve', joursConge: 7 },     // autre agent
    ],
  });
  // 6 mois = 15 j acquis, moins 5 j pris = 10 j
  assert.strictEqual(t.calculateStcCongeReliquat(agent, '2025-07-01'), 10);
});

test('calculateStcCongeReliquat: jamais négatif, et null sans date de recrutement', () => {
  const t = T();
  t.setDb({ conges: [{ agentId: 'a1', type: 'Annuel', statut: 'approuve', joursConge: 999 }] });
  assert.strictEqual(t.calculateStcCongeReliquat({ id: 'a1', dateRecrutement: '2025-01-01' }, '2025-07-01'), 0);
  assert.strictEqual(t.calculateStcCongeReliquat({ id: 'a1' }, '2025-07-01'), null);
});

test('drhSortantEffectiveDate: plafonne à aujourd\'hui (pas d\'acquis sur le futur)', () => {
  const t = T();
  const todayStr = new Date().toISOString().slice(0, 10);
  assert.strictEqual(t.drhSortantEffectiveDate({ dateSortie: '2025-03-15' }), '2025-03-15');
  assert.strictEqual(t.drhSortantEffectiveDate({ dateSortie: '2099-01-01' }), todayStr, 'une sortie future doit être plafonnée');
  assert.strictEqual(t.drhSortantEffectiveDate({}), todayStr);
});

test('drhStcReliquatDisplay: recalcule et corrige une fiche datée dans le futur', () => {
  const t = T();
  t.setDb({ conges: [] });
  // Fiche corrompue : reliquat stocké à 30 alors que la sortie plafonnée donne moins
  const agent = { id: 'a1', dateRecrutement: '2025-01-01', dateSortie: '2025-07-01', stcCongeReliquat: 30 };
  assert.strictEqual(t.drhStcReliquatDisplay(agent), 15, 'le recalcul doit primer sur la valeur stockée');
});

// ── Matricules (miroir du backend employee_code_prefixes_for_society) ─────────

test('matriculePrefixesForSociete: mêmes séries que le backend, accents indifférents', () => {
  // Les tableaux viennent du realm jsdom : on les recopie pour comparer les valeurs.
  const f = (s) => [...T().matriculePrefixesForSociete(s)];
  assert.deepStrictEqual(f('Iron Global Securite'), ['A', 'B', 'C']);
  assert.deepStrictEqual(f('Iron Global Sécurité'), ['A', 'B', 'C']);
  assert.deepStrictEqual(f('IRON GLOBAL SOLUTION'), ['K', 'W']);
  assert.deepStrictEqual(f('Sword Corporation'), ['S']);
  assert.deepStrictEqual(f('Sword Construction'), ['T']);
  assert.strictEqual(f('Societe Inconnue').length, 26);
});

test('nextMatricule: comble le premier trou de la série et ignore les autres sociétés', () => {
  const f = T().nextMatricule;
  assert.strictEqual(f([], 'Iron Global Securite'), 'A01');
  assert.strictEqual(f([{ matricule: 'A01' }, { matricule: 'A02' }], 'Iron Global Securite'), 'A03');
  assert.strictEqual(f([{ matricule: 'A01' }, { matricule: 'A03' }], 'Iron Global Securite'), 'A02', 'doit combler le trou');
  // Un code S01 (Sword) ne bloque pas la série A/B/C
  assert.strictEqual(f([{ matricule: 'S01' }], 'Iron Global Securite'), 'A01');
  // Passage de série quand A est saturée
  const fullA = Array.from({ length: 200 }, (_, i) => ({ matricule: 'A' + String(i + 1).padStart(2, '0') }));
  assert.strictEqual(f(fullA, 'Iron Global Securite'), 'B01');
});

test('normalizeEmployeeCodeFormat: normalise la casse, les espaces et les zéros', () => {
  const f = T().normalizeEmployeeCodeFormat;
  assert.strictEqual(f('a1'), 'A01');
  assert.strictEqual(f(' a001 '), 'A01');
  assert.strictEqual(f('A123'), 'A123');
  assert.strictEqual(f('TMP-RESET-5'), 'TMP-RESET-5'); // non conforme -> inchangé
  assert.strictEqual(f(''), '');
});

test('nextMatricule: tient compte des codes mal formatés (a1 == A01)', () => {
  assert.strictEqual(T().nextMatricule([{ matricule: 'a1' }], 'Iron Global Securite'), 'A02');
});

// ── Validation candidat ──────────────────────────────────────────────────────

test('candidatAgeAtSave: calcule l\'âge et gère les dates invalides', () => {
  const f = T().candidatAgeAtSave;
  const y = new Date().getFullYear();
  // Né un 1er janvier : l'anniversaire est atteint dès le 1er janvier, donc l'âge = y - année
  assert.strictEqual(f(`${y - 25}-01-01`), 25);
  assert.strictEqual(f(`${y - 19}-01-01`), 19, 'moins de 20 ans -> refusé plus haut dans le formulaire');
  assert.strictEqual(f(''), null);
  assert.strictEqual(f('pas-une-date'), null);
});

test('candidateIdentityMissing / candidateHasMinimumData: nom et prénom obligatoires (2 car. min)', () => {
  const t = T();
  const missing = (c) => [...t.candidateIdentityMissing(c)]; // tableau du realm jsdom
  assert.deepStrictEqual(missing({ nom: '', prenom: '' }), ['Nom', 'Prénom']);
  assert.deepStrictEqual(missing({ nom: 'Benali', prenom: '' }), ['Prénom']);
  assert.deepStrictEqual(missing({ nom: 'Benali', prenom: 'Karim' }), []);

  assert.strictEqual(t.candidateHasMinimumData({ nom: 'Benali', prenom: 'Karim' }), true);
  assert.strictEqual(t.candidateHasMinimumData({ nom: 'B', prenom: 'Karim' }), false, '1 caractère refusé');
  assert.strictEqual(t.candidateHasMinimumData(null), false);
});

test('cycle de vie candidat: archivé / recruté / actif s\'excluent correctement', () => {
  const t = T();
  assert.strictEqual(t.candidatIsArchived({ statut: 'archive' }), true);
  assert.strictEqual(t.candidatIsArchived({ archivedAt: '2026-01-01' }), true);
  assert.strictEqual(t.candidatIsArchived({ statut: 'nouvelle' }), false);

  assert.strictEqual(t.candidatIsRecruited({ statut: 'embauche' }), true);
  assert.strictEqual(t.candidatIsRecruited({ statut: 'embauché' }), true);
  assert.strictEqual(t.candidatIsRecruited({ convertedEmployeeId: 12 }), true);
  assert.strictEqual(t.candidatIsRecruited({ statut: 'reserve' }), false);

  assert.strictEqual(t.candidatIsActive({ statut: 'nouvelle' }), true);
  assert.strictEqual(t.candidatIsActive({ statut: 'reserve' }), true);
  assert.strictEqual(t.candidatIsActive({ statut: 'embauche' }), false, 'un recruté n\'est plus un candidat actif');
  assert.strictEqual(t.candidatIsActive({ statut: 'archive' }), false);
});

test.after(() => { setTimeout(() => process.exit(0), 50); });

test('DRH recruitment displays shared unassigned candidates without edit controls', async () => {
  const app = loadSgdiApp(['renderRecrutement', 'renderCandidatForm']);
  assert.equal(app.loadError, null);
  app.T().setSession({username:'RH',transverse:'drh',societe:'Selected society'});
  let request;
  app.window.SGDI={rh:{candidatesPage:async params=>{request=params;return {items:[{id:42,last_name:'PUBLIC',first_name:'CANDIDATE',status:'a_contractualiser',society:null,phone:'0770000000',data:{adresse:'<script>bad()</script>'}}],total:1,page:1,pages:1}}}};
  const view=app.window.document.getElementById('view');
  await app.T().renderRecrutement(view,'new');
  assert.equal(request.society,undefined);
  assert.equal(request.mode,"drh_pending");
  assert.match(view.textContent,/PUBLIC CANDIDATE/);
  assert.match(view.textContent,/a_contractualiser/);
  assert.match(view.textContent,/Non affecté/);
  assert.equal(view.querySelectorAll('input,select,textarea,form,script').length,0);
  assert.match(view.textContent,/lecture seule/);
  await app.T().renderCandidatForm(view,null);
  assert.equal(view.querySelectorAll('form,input,textarea').length,0);
  app.dom.window.close();
});

test('DRH recruitment ignores response after navigation and never restores cached candidates on error', async () => {
  const app=loadSgdiApp(['renderDrhRecruitmentReadOnly']);
  app.T().setSession({username:'RH',transverse:'drh'});
  const view=app.window.document.getElementById('view');
  let resolve;
  app.window.SGDI={rh:{candidatesPage:()=>new Promise(r=>{resolve=r})}};
  const pending=app.T().renderDrhRecruitmentReadOnly(view);
  app.T().setSession({username:'RH',transverse:'ops'});view.innerHTML='Destination';
  resolve({items:[{last_name:'STALE'}],total:1});await pending;
  assert.equal(view.textContent,'Destination');
  app.T().setSession({username:'RH',transverse:'drh'});
  app.window.SGDI.rh.candidatesPage=async()=>{throw Error('Refus serveur')};
  await app.T().renderDrhRecruitmentReadOnly(view);
  assert.match(view.textContent,/Refus serveur/);assert.doesNotMatch(view.textContent,/STALE/);
  app.dom.window.close();
});

test('contract document expiry uses calendar months and clamps month ends', () => {
  const app=loadSgdiApp(['contractDocumentExpiry']);
  assert.equal(app.loadError,null);
  const expiry=app.T().contractDocumentExpiry;
  assert.equal(expiry('2026-09-09','CasierJudiciaire'),'2026-12-09');
  assert.equal(expiry('2026-08-31','ActeNaissance'),'2027-02-28');
  assert.equal(expiry('2023-12-31','TestDrogue'),'2024-02-29');
  assert.equal(expiry('2026-09-09','PieceIdentite'),'');
  app.dom.window.close();
});

test('contract documents preserve existing files and allow repeated extra rows with manual identity expiry', () => {
  const app=loadSgdiApp(['openContractDocumentsModal','addContractDocumentRow','updateContractDocumentDates']);
  app.T().setDb({candidats:[{id:'c1',nom:'TEST',prenom:'Test',documents:{PieceIdentite:{url:'/uploads/id.pdf',name:'id.pdf',issuedAt:'2026-01-01',expiresAt:'2036-01-01'},custom:{url:'/uploads/custom.pdf',name:'custom.pdf',designation:'Attestation',noExpiry:true}}}]});
  app.T().openContractDocumentsModal('c1');
  const doc=app.window.document;
  assert.equal(doc.querySelector('[name="doc_custom_url"]').value,'/uploads/custom.pdf');
  const identity=doc.querySelector('[data-contract-document="PieceIdentite"]');
  assert.equal(identity.querySelector('[data-doc-expires]').value,'2036-01-01');
  assert.equal(identity.querySelector('[data-doc-expires]').readOnly,false);
  assert.equal(identity.querySelector('[data-doc-no-expiry]').disabled,true);
  for(let i=0;i<30;i++)app.T().addContractDocumentRow();
  assert.equal(doc.querySelectorAll('[data-contract-document]').length,40);
  const row=doc.querySelector('#contract-document-rows').lastElementChild;
  row.querySelector('[data-doc-type]').value='TestDrogue';
  row.querySelector('[data-doc-issued]').value='2026-09-09';
  app.T().updateContractDocumentDates(row.querySelector('[data-doc-type]'));
  assert.equal(row.querySelector('[data-doc-expires]').value,'2026-11-09');
  assert.equal(row.querySelector('[data-doc-expires]').readOnly,true);
  app.dom.window.close();
});

test('document save persists metadata and leaves original data intact when server rejects', async () => {
  const app=loadSgdiApp(['openContractDocumentsModal','saveContractDocuments']);
  const candidate={id:'c1',backendId:1,nom:'TEST',prenom:'Test',documents:{CasierJudiciaire:{url:'/uploads/casier.pdf',name:'casier.pdf',issuedAt:'2026-09-09',expiresAt:'2026-12-09'}}};
  app.T().setDb({candidats:[candidate]});
  app.window.eval('persistCandidateToPostgres=async function(draft){window.savedDraft=draft;throw Error("Serveur indisponible")};');
  app.T().openContractDocumentsModal('c1');
  app.window.document.querySelector('[data-doc-designation]').value='Acte';
  await app.T().saveContractDocuments('c1');
  assert.equal(app.window.savedDraft.documents.CasierJudiciaire.expiresAt,'2026-12-09');
  assert.equal(app.window.savedDraft.documents.CasierJudiciaire.designation,'Casier judiciaire');
  assert.equal(candidate.documents.CasierJudiciaire.designation,undefined);
  assert.ok(app.window.document.getElementById('contract-documents-form'));
  assert.equal(app.window.document.querySelector('#contract-documents-form [type="submit"]').disabled,false);
  app.dom.window.close();
});

test('sidebar uses server totals and displays zero counts for supported module routes', () => {
  const app=loadSgdiApp(['renderSidebar','emptyDB']);
  app.T().setDb(app.T().emptyDB());
  app.window.SGDI_SIDEBAR_STATS={scope:{active_society:''},erp:{employees:{non_archived:165},ops:{},materiel:{}},drh:{recrutement:{shared_pending:7,contracts_pending:2}},commercial:{clients_total:4},facturation:{payments_total:0}};
  app.T().setSession({username:'admin',role:'admin',transverse:'drh'});
  app.T().renderSidebar();
  const badge=route=>app.window.document.querySelector(`[data-route="${route}"] .nav-count`)?.textContent;
  assert.equal(badge('recrutement/candidats'),'7');
  assert.equal(badge('fiches'),'165');
  assert.equal(badge('effectif/recap'),'165');
  app.T().setSession({username:'admin',role:'admin',transverse:'facmod'});
  app.T().renderSidebar();
  assert.equal(badge('facturation/paiements'),'0');
  assert.equal(badge('facturation/clients'),'4');
  app.dom.window.close();
});

test('counter responses from a previous account are discarded', async () => {
  const app=loadSgdiApp(['sgdiRefreshSidebarStats','emptyDB']);
  app.T().setDb(app.T().emptyDB());app.T().setSession({username:'A',role:'admin'});
  let resolve;app.window.SGDI_API={ui:{sidebarStats:()=>new Promise(r=>resolve=r)}};
  const pending=app.T().sgdiRefreshSidebarStats();
  app.T().setSession({username:'B',role:'admin'});
  resolve({scope:{active_society:''},erp:{employees:{total:999}}});
  assert.equal(await pending,null);
  assert.notEqual(app.window.SGDI_SIDEBAR_STATS?.erp?.employees?.total,999);
  app.dom.window.close();
});

test('ribbon percentages require an explicit meaningful denominator', () => {
  const app=loadSgdiApp(['moduleCounterItemHTML']);
  assert.doesNotMatch(app.T().moduleCounterItemHTML({label:'FACTURES',value:4},12),/33%/);
  assert.match(app.T().moduleCounterItemHTML({label:'ACTIFS',value:4,pctBase:8},99),/50%/);
  app.dom.window.close();
});
