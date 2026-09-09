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

test('DRH recruitment requests the active society without edit controls', async () => {
  const app = loadSgdiApp(['renderRecrutement', 'renderCandidatForm']);
  assert.equal(app.loadError, null);
  app.T().setSession({username:'RH',transverse:'drh',societe:'Selected society'});
  let request;
  app.window.SGDI={rh:{candidatesPage:async params=>{request=params;return {items:[{id:42,last_name:'PUBLIC',first_name:'CANDIDATE',status:'a_contractualiser',society:'Selected society',phone:'0770000000',data:{adresse:'<script>bad()</script>'}}],total:1,page:1,pages:1}}}};
  const view=app.window.document.getElementById('view');
  await app.T().renderRecrutement(view,'new');
  assert.equal(request.society,'Selected society');
  assert.equal(request.mode,"drh_pending");
  assert.match(view.textContent,/PUBLIC CANDIDATE/);
  assert.match(view.textContent,/a_contractualiser/);
  assert.match(view.textContent,/Selected society/);
  assert.equal(view.querySelectorAll('input,select,textarea,form,script').length,0);
  assert.match(view.textContent,/lecture seule/);
  await app.T().renderCandidatForm(view,null);
  assert.equal(view.querySelectorAll('form,input,textarea').length,0);
  app.dom.window.close();
});

test('DRH recruitment ignores response after navigation and never restores cached candidates on error', async () => {
  const app=loadSgdiApp(['renderDrhRecruitmentReadOnly']);
  app.T().setSession({username:'RH',transverse:'drh',societe:'A'});
  const view=app.window.document.getElementById('view');
  let resolve;
  app.window.SGDI={rh:{candidatesPage:()=>new Promise(r=>{resolve=r})}};
  const pending=app.T().renderDrhRecruitmentReadOnly(view);
  app.T().setSession({username:'RH',transverse:'ops'});view.innerHTML='Destination';
  resolve({items:[{last_name:'STALE'}],total:1});await pending;
  assert.equal(view.textContent,'Destination');
  app.T().setSession({username:'RH',transverse:'drh',societe:'A'});
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


test('DRH society switch rejects the old response and keeps pagination scoped', async () => {
  const app=loadSgdiApp(['renderDrhRecruitmentReadOnly']);
  const t=app.T(),view=app.window.document.getElementById('view');
  const requests=[];
  app.window.SGDI={rh:{candidatesPage:params=>new Promise(resolve=>requests.push({params,resolve}))}};
  t.setSession({username:'RH',transverse:'drh',societe:'A'});
  app.window.sessionStorage.setItem('recrutementPage:new:A','3');
  const first=t.renderDrhRecruitmentReadOnly(view);
  t.setSession({username:'RH',transverse:'drh',societe:'B'});
  const second=t.renderDrhRecruitmentReadOnly(view);
  assert.equal(requests[0].params.society,'A');assert.equal(requests[0].params.page,3);
  assert.equal(requests[1].params.society,'B');assert.equal(requests[1].params.page,1);
  requests[1].resolve({items:[{last_name:'CURRENT',society:'B'}],total:1});await second;
  requests[0].resolve({items:[{last_name:'STALE',society:'A'}],total:1});await first;
  assert.match(view.textContent,/CURRENT/);assert.doesNotMatch(view.textContent,/STALE/);
  app.dom.window.close();
});

test('stable view keeps content during loading and restores focus, details and scroll after async replacement', async () => {
  const app=loadSgdiApp(['sgdiInstallStableView']);
  const view=app.window.document.getElementById('view');
  app.T().setSession({username:'RH',transverse:'drh',societe:'A'});
  app.T().sgdiInstallStableView(view);
  view.innerHTML='<input id="search" value="abc"><details><summary>Dossier</summary>Info</details><div id="list">Ancien</div>';
  const input=view.querySelector('input');input.focus();input.setSelectionRange(1,2);
  view.querySelector('details').open=true;view.scrollTop=180;view.querySelector('#list').scrollTop=40;
  view.innerHTML='<div>Chargement des données…</div>';
  assert.equal(view.querySelector('input'),input);assert.equal(view.scrollTop,180);
  await Promise.resolve();
  view.innerHTML='<input id="search" value="abc"><details><summary>Dossier</summary>Info</details><div id="list">Nouveau</div>';
  assert.equal(app.window.document.activeElement.id,'search');assert.equal(app.window.document.activeElement.selectionStart,1);
  assert.equal(view.scrollTop,180);assert.equal(view.querySelector('#list').scrollTop,40);assert.equal(view.querySelector('details').open,true);
  app.T().setSession({username:'RH',transverse:'drh',societe:'B'});
  view.innerHTML='<div>Chargement des données…</div>';
  assert.doesNotMatch(view.textContent,/Nouveau/);
  app.dom.window.close();
});


test('automatic refresh does not replace a dirty form or an active select', () => {
  const app=loadSgdiApp(['sgdiRefreshViewSafely','sgdiAutoRender']);
  const view=app.window.document.getElementById('view');
  app.T().setViewMode(true);
  view.innerHTML='<form data-dirty="1"><input value="Travail non enregistré"></form>';
  const form=view.firstElementChild;
  app.T().sgdiRefreshViewSafely();app.T().sgdiAutoRender();
  assert.equal(view.firstElementChild,form);
  view.innerHTML='<select><option>Choix en cours</option></select>';
  const select=view.firstElementChild;select.focus();
  app.T().sgdiRefreshViewSafely();app.T().sgdiAutoRender();
  assert.equal(view.firstElementChild,select);
  app.dom.window.close();
});

test('Consulter opens the complete candidate dossier as non-editable values', async () => {
  const app=loadSgdiApp(['renderDrhRecruitmentReadOnly','openDrhCandidateReadOnly','sgdiApplyViewModeLocks','closeModal']);
  const t=app.T(),view=app.window.document.getElementById('view');
  t.setSession({username:'RH',transverse:'drh',societe:'A'});
  app.window.SGDI={rh:{candidatesPage:async()=>({items:[{id:42,last_name:'TEST',first_name:'CANDIDAT',society:'A',phone:'0770 112 034',expected_salary:0,data:{dateNaissance:'1980-01-09',nombreEnfants:0,nin:'001234',contactUrgenceTel:'0661555555',langues:['Arabe','Français'],avisDecision:'Favorable',notes:'<img src=x onerror=alert(1)>',experience:[{societe:'Ancien employeur',du:'2020-02-01',au:'2022-03-31',poste:'Agent',motif:'Fin de contrat'}]}}],total:1})}};
  await t.renderDrhRecruitmentReadOnly(view);
  const consult=view.querySelector('[data-candidate-id]');
  assert.equal(consult.getAttribute('onclick'),'openDrhCandidateReadOnly(this.dataset.candidateId)');
  app.window.openDrhCandidateReadOnly(consult.dataset.candidateId);
  const modal=app.window.document.querySelector('.drh-candidate-readonly');
  assert.ok(modal);
  for(const label of ['Identification du candidat','Coordonnées','Candidature et profil','Avis du recruteur','09/01/1980','001234','0661555555','Arabe, Français','Ancien employeur','01/02/2020','Favorable'])assert.ok(modal.textContent.includes(label),label);
  assert.equal(modal.querySelectorAll('input,select,textarea,form,[contenteditable],img').length,0);
  assert.match(modal.textContent,/<img src=x onerror=alert\(1\)>/);
  t.setViewMode(false);t.sgdiApplyViewModeLocks(modal);
  assert.equal(modal.querySelectorAll('input,select,textarea,[contenteditable]').length,0);
  assert.deepEqual(Array.from(modal.querySelectorAll('button'),b=>b.textContent),['Fermer']);
  t.closeModal();
  assert.equal(app.window.document.querySelector('.drh-candidate-readonly'),null);
  t.setSession({username:'RH',transverse:'drh',societe:'B'});
  t.openDrhCandidateReadOnly(42);
  assert.equal(app.window.document.querySelector('.drh-candidate-readonly'),null);
  app.dom.window.close();
});

test('archive button requires a valid reason and administrative detail', () => {
  const app=loadSgdiApp(['openArchiveContractCandidateModal','updateArchiveContractCandidateForm']);
  app.T().setDb({candidats:[{id:'c1',nom:'TEST'}]});
  app.T().openArchiveContractCandidateModal('c1');
  const f=app.window.document.getElementById('archive-contract-candidate-form'),submit=f.querySelector('[type="submit"]');
  assert.equal(submit.disabled,true);
  f.elements.motifArchive[0].checked=true;app.T().updateArchiveContractCandidateForm(f);
  assert.equal(submit.disabled,false);
  f.elements.motifArchive[2].checked=true;app.T().updateArchiveContractCandidateForm(f);
  assert.equal(submit.disabled,true);assert.equal(f.elements.motifArchiveDetail.required,true);
  f.elements.motifArchiveDetail.value='Pièce expirée';app.T().updateArchiveContractCandidateForm(f);
  assert.equal(submit.disabled,false);
  f.elements.motifArchive[1].checked=true;app.T().updateArchiveContractCandidateForm(f);
  assert.equal(f.elements.motifArchiveDetail.required,false);
  assert.equal(f.querySelector('#archiveContractProblemDetail').classList.contains('hidden'),true);
  app.dom.window.close();
});

test('archive request deduplicates clicks and permits retry after rejection', async () => {
  const app=loadSgdiApp(['openArchiveContractCandidateModal','confirmArchiveContractCandidate','updateArchiveContractCandidateForm']);
  const candidate={id:'c1',backendId:1,nom:'TEST',statut:'a_contractualiser'};
  app.T().setDb({candidats:[candidate]});
  app.window.eval('window.archiveCalls=0;persistCandidateToPostgres=function(draft){window.archiveCalls++;window.archiveDraft=draft;return new Promise((resolve,reject)=>{window.archiveResolve=resolve;window.archiveReject=reject})};sgdiPullState=async()=>true;renderView=()=>{};');
  app.T().openArchiveContractCandidateModal('c1');
  const f=app.window.document.getElementById('archive-contract-candidate-form');
  f.elements.motifArchive[0].checked=true;app.T().updateArchiveContractCandidateForm(f);
  const pending=app.T().confirmArchiveContractCandidate('c1');
  await app.T().confirmArchiveContractCandidate('c1');
  assert.equal(app.window.archiveCalls,1);assert.equal(f.querySelector('[type="submit"]').disabled,true);
  assert.equal(candidate.statut,'a_contractualiser');
  app.window.archiveReject(Error('Refus serveur'));await pending;
  assert.equal(candidate.statut,'a_contractualiser');assert.equal(f.querySelector('[type="submit"]').disabled,false);
  const retry=app.T().confirmArchiveContractCandidate('c1');
  assert.equal(app.window.archiveCalls,2);assert.equal(app.window.archiveDraft.archiveSource,'a_contractualiser');
  app.window.archiveResolve();await retry;
  assert.equal(candidate.statut,'archive');assert.equal(f.isConnected,false);
  app.dom.window.close();
});


test('archive closes after PostgreSQL confirmation without waiting for counters or a global reload', async () => {
  const app=loadSgdiApp(['openArchiveContractCandidateModal','confirmArchiveContractCandidate']);
  const candidate={id:'c1',backendId:1,nom:'TEST',statut:'a_contractualiser'};
  app.T().setDb({candidats:[candidate]});
  app.window.eval(`window.messages=[];window.renderCount=0;window.pullCount=0;window.counterCount=0;
    toast=(message)=>window.messages.push(message);
    persistCandidateToPostgres=()=>new Promise(resolve=>window.confirmSave=resolve);
    sgdiPullState=()=>{window.pullCount++;return new Promise(()=>{})};
    sgdiRefreshCountersNow=()=>{window.counterCount++;return new Promise((resolve,reject)=>window.rejectCounters=reject)};
    renderView=()=>{window.renderCount++};`);
  app.T().openArchiveContractCandidateModal('c1');
  const form=app.window.document.getElementById('archive-contract-candidate-form');
  form.elements.motifArchive[0].checked=true;
  const pending=app.T().confirmArchiveContractCandidate('c1');
  assert.equal(form.isConnected,true);assert.equal(candidate.statut,'a_contractualiser');
  app.window.confirmSave();await pending;
  assert.equal(form.isConnected,false);assert.equal(candidate.statut,'archive');
  assert.equal(app.window.renderCount,1);assert.equal(app.window.pullCount,0);assert.equal(app.window.counterCount,1);
  assert.ok(app.window.messages.includes('Candidat archivé'));
  app.window.rejectCounters(Error('Compteurs lents'));await Promise.resolve();await Promise.resolve();
  assert.equal(app.window.messages.some(m=>m.includes('Archivage refusé')),false);
  assert.equal(candidate.statut,'archive');
  app.dom.window.close();
});
