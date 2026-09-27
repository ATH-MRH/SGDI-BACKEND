// Tests FRONTEND du module OPS — vraies fonctions de app/static/sgdi-app.js.
// Couvre : rattachement site<->société, correspondance site<->référence,
// effectif contractuel client, et conversion des données serveur (sites, affectations).
const test = require('node:test');
const assert = require('node:assert');
const { loadSgdiApp } = require('./load-app');

const { loadError, T, window } = loadSgdiApp([
  'sitePrimarySociete',
  'siteBelongsToPrimarySociete',
  'siteMatchesSociete',
  'siteMatchesReference',
  'clientSiteEffectif',
  'clientTotalEffectif',
  'siteFromApi',
  'assignmentFromApi',
  'agentLiveAffectation',
  'normalizeSocieteName',
  'sgdiPullEmployees',
  'employeeFromApi',
  'applyAssignmentsToEmployees',
  'isOpsSupervisorReadOnlySession',
  'opsMissionEndDate',
  'opsMissionStatus',
  'opsMissionNeedsEndAlert',
]);

test('sgdi-app.js se charge et expose les fonctions OPS', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  const t = T();
  for (const name of ['sitePrimarySociete', 'siteMatchesSociete', 'siteFromApi']) {
    assert.ok(t[name], `${name} introuvable`);
  }
});

test('missions OPS: statut et alerte de fin dans les 24 heures', () => {
  const t = T();
  const soon = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const dateFin = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  const heureFin = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
  const mission = { dateDebut: '2020-01-01', dateFin, heureFin };
  assert.strictEqual(t.opsMissionStatus(mission).key, 'encours');
  assert.strictEqual(t.opsMissionNeedsEndAlert(mission), true);
  mission.extensionDeclinedAt = new Date().toISOString();
  assert.strictEqual(t.opsMissionNeedsEndAlert(mission), false, 'un refus explicite acquitte l’alerte');
  mission.statut = 'cloturee';
  assert.strictEqual(t.opsMissionStatus(mission).key, 'cloturee');
});

// ── Rattachement d'un site à sa société ──────────────────────────────────────

test('sitePrimarySociete: lit societe, puis equipment_plan, puis _legacy', () => {
  const f = T().sitePrimarySociete;
  assert.strictEqual(f({ societe: 'Iron Global Securite' }), 'Iron Global Securite');
  assert.strictEqual(f({ society: 'Sword Corporation' }), 'Sword Corporation');
  assert.strictEqual(f({ equipment_plan: { societe: 'Iron Global Solution' } }), 'Iron Global Solution');
  assert.strictEqual(f({ equipment_plan: { _legacy: { societe: 'Sword Construction' } } }), 'Sword Construction');
  // Le champ direct prime sur equipment_plan
  assert.strictEqual(f({ societe: 'A', equipment_plan: { societe: 'B' } }), 'A');
  assert.strictEqual(f({}), '');
  assert.strictEqual(f(null), '');
});

test('siteBelongsToPrimarySociete: comparaison insensible aux accents et à la casse', () => {
  const f = T().siteBelongsToPrimarySociete;
  const site = { societe: 'Iron Global Sécurité' };
  assert.strictEqual(f(site, 'iron global securite'), true);
  assert.strictEqual(f(site, 'IRON GLOBAL SÉCURITÉ'), true);
  assert.strictEqual(f(site, 'Sword Corporation'), false);
  assert.strictEqual(f(site, ''), true, 'sans filtre société, tout passe');
});

test('siteMatchesSociete: retombe sur les agents affectés quand le site n\'a pas de société', () => {
  const t = T();
  t.setDb({
    agents: [
      { id: 'ag1', societe: 'Sword Corporation', affectationCourante: { siteId: 's9' } },
      { id: 'ag2', societe: 'Iron Global Securite', affectationCourante: { siteId: 's7' } },
    ],
    sites: [],
  });
  const orphan = { id: 's9' }; // aucune société déclarée sur le site
  assert.strictEqual(t.siteMatchesSociete(orphan, 'Sword Corporation'), true, 'déduit par l\'agent affecté');
  assert.strictEqual(t.siteMatchesSociete(orphan, 'Iron Global Securite'), false);
  // Un site avec société déclarée n'utilise PAS le repli agents
  assert.strictEqual(t.siteMatchesSociete({ id: 's9', societe: 'Iron Global Securite' }, 'Iron Global Securite'), true);
  assert.strictEqual(t.siteMatchesSociete(null, 'Sword Corporation'), false);
  assert.strictEqual(t.siteMatchesSociete({ id: 's9' }, ''), true, 'sans filtre, tout passe');
});

test('siteMatchesReference: par identifiant ou par nom normalisé', () => {
  const t = T();
  const site = { id: 's1', backendId: 42, nom: 'Dépôt Central' };
  assert.strictEqual(t.siteMatchesReference(site, { siteId: 's1' }), true);
  assert.strictEqual(t.siteMatchesReference(site, { site_id: 42 }), true);
  assert.strictEqual(t.siteMatchesReference(site, { siteBackendId: '42' }), true);
  // Correspondance par nom, accents et casse ignorés
  assert.strictEqual(t.siteMatchesReference(site, { siteName: 'depot central' }), true);
  assert.strictEqual(t.siteMatchesReference(site, { siteName: 'Autre Site' }), false);
  assert.strictEqual(t.siteMatchesReference(site, {}), false);
  assert.strictEqual(t.siteMatchesReference(null, { siteId: 's1' }), false);
});

// ── Effectif contractuel côté client ─────────────────────────────────────────

test('clientSiteEffectif: totalEffectif saisi prime, sinon groupes*nuit + surplus de jour', () => {
  const f = T().clientSiteEffectif;
  assert.strictEqual(f({ totalEffectif: 12 }), 12, 'la valeur saisie prime');
  // 4 groupes x 2 postes de nuit = 8, plus (3 jour - 2 nuit) = 1 -> 9
  assert.strictEqual(f({ nbrGroupe: 4, nbrJour: 3, nbrNuit: 2 }), 9);
  // Pas de surplus quand il y a plus de nuit que de jour
  assert.strictEqual(f({ nbrGroupe: 4, nbrJour: 1, nbrNuit: 2 }), 8);
  assert.strictEqual(f({}), 0);
  assert.strictEqual(f(null), 0);
  assert.strictEqual(f({ totalEffectif: 0, nbrGroupe: 2, nbrNuit: 1 }), 2, 'un total à 0 ne prime pas');
});

test('clientTotalEffectif: somme des sites techniques du client', () => {
  const t = T();
  assert.strictEqual(t.clientTotalEffectif({ tech_sites: [{ totalEffectif: 5 }, { nbrGroupe: 2, nbrNuit: 1, nbrJour: 1 }] }), 7);
  assert.strictEqual(t.clientTotalEffectif({ tech_sites: [] }), 0);
  assert.strictEqual(t.clientTotalEffectif({}), 0);
  assert.strictEqual(t.clientTotalEffectif(null), 0);
});

// ── Conversion des données serveur ───────────────────────────────────────────

test('siteFromApi: mappe les colonnes SQL et fusionne equipment_plan/_legacy', () => {
  const site = T().siteFromApi({
    id: 42, name: 'DEPOT NORD', indicatif: 'DPN', client_name: 'ACME',
    address: 'Rue 1', commune: 'Alger', wilaya: 'Alger', site_type: 'depot',
    rotation_system: '24/48', active: 1,
    contractual_staff: 10, day_staff: 4, night_staff: 3, weekend_staff: 2, holiday_staff: 1, groups_count: 4,
    equipment_plan: { dateOuverture: '2025-01-15', _legacy: { siteOuvertPar: 'DG' } },
  });
  assert.strictEqual(site.backendId, 42);
  assert.strictEqual(site.nom, 'DEPOT NORD');
  assert.strictEqual(site.indicatif, 'DPN');
  assert.strictEqual(site.client, 'ACME');
  assert.strictEqual(site.rotationSystem, '24/48');
  assert.strictEqual(site.actif, true);
  assert.strictEqual(site.dateOuverture, '2025-01-15');
  assert.strictEqual(site.siteOuvertPar, 'DG', 'la valeur _legacy doit être récupérée');
  assert.strictEqual(site.effectifs.totalContractuel, 10);
  assert.strictEqual(site.effectifs.jour, 4);
  assert.strictEqual(site.effectifs.groupes, 4);
  assert.strictEqual(site.isNew, false);
  assert.ok(!('_legacy' in site), '_legacy ne doit pas fuir dans l\'objet site');
});

test('siteFromApi: active=0 devient actif=false', () => {
  assert.strictEqual(T().siteFromApi({ id: 1, name: 'X', active: 0 }).actif, false);
  assert.strictEqual(T().siteFromApi({ id: 1, name: 'X', active: 1 }).actif, true);
});

test('assignmentFromApi: relie l\'affectation à l\'agent et au site déjà chargés', () => {
  const t = T();
  t.setDb({
    agents: [{ id: 'ag_local', backendId: 7 }],
    sites: [{ id: 'st_local', backendId: 3, nom: 'Depot' }],
  });
  const a = t.assignmentFromApi({ id: 99, employee_id: 7, site_id: 3, group_code: 'B', start_date: '2026-01-01' });
  assert.strictEqual(a.backendId, 99);
  assert.strictEqual(a.agentId, 'ag_local', 'doit retrouver l\'identifiant local de l\'agent');
  assert.strictEqual(a.employee_id, 7);
  assert.strictEqual(a.site_id, 3);
});

test('assignmentFromApi: sans agent local connu, retombe sur l\'identifiant serveur', () => {
  const t = T();
  t.setDb({ agents: [], sites: [] });
  const a = t.assignmentFromApi({ id: 100, employee_id: 55, site_id: 66 });
  assert.strictEqual(a.agentId, '55');
});

// ── sgdiPullEmployees ne doit plus effacer l'affectation courante ───────────
// Bug réel observé : Fiche de position / Personnel rattaché rappellent
// sgdiEnsureEmployeesForDisplay({force:true}) à chaque affichage, qui appelle
// sgdiPullEmployees(). employeeFromApi() reconstruit l'agent depuis /drh/employees,
// qui n'embarque PAS le site/poste — un employé pourtant correctement affecté
// (visible dans OPS/Mouvement) se retrouvait avec Site/Poste vides après ce refresh,
// alors que db.assignments contenait déjà la bonne info chargée par un autre écran.

test('sgdiPullEmployees réapplique les affectations déjà connues (ne perd plus site/poste au refresh)', async () => {
  const t = T();
  window.sessionStorage.setItem('sgdi_api_token_v1', 'test-token');
  t.setDb({
    agents: [],
    assignments: [{
      id: 'as1', agentId: '', agentBackendId: 42, siteId: 's1', siteBackendId: 7,
      siteName: 'DHL Forwarding / Hamoul 01', poste: 'Magasinier', active: true, dateDebut: '2026-01-01',
    }],
    sites: [{ id: 's1', backendId: 7, nom: 'DHL Forwarding / Hamoul 01' }],
  });
  window.SGDI_API.employees.list = async () => ([
    { id: 42, code: 'K08', last_name: 'FOUATIH', first_name: 'Ahmed', society: 'IRON GLOBAL SOLUTION', extra: {} },
  ]);
  const agents = await t.sgdiPullEmployees({ silent: true });
  assert.ok(Array.isArray(agents) && agents.length === 1, 'un employé attendu');
  assert.strictEqual(agents[0].affectationCourante?.siteName, 'DHL Forwarding / Hamoul 01');
  assert.strictEqual(agents[0].affectationCourante?.poste, 'Magasinier');
});

test('sgdiPullEmployees sans assignments connus : ne casse rien (pas d\'affectation à réappliquer)', async () => {
  const t = T();
  window.sessionStorage.setItem('sgdi_api_token_v1', 'test-token');
  t.setDb({ agents: [], assignments: [], sites: [] });
  window.SGDI_API.employees.list = async () => ([
    { id: 43, code: 'K09', last_name: 'BENALI', first_name: 'Yacine', society: 'IRON GLOBAL SOLUTION', extra: {} },
  ]);
  const agents = await t.sgdiPullEmployees({ silent: true });
  assert.ok(Array.isArray(agents) && agents.length === 1);
  assert.deepStrictEqual(agents[0].affectationCourante, undefined);
});

// ── employeeFromApi() lit l'affectation jointe côté serveur ─────────────────
// /drh/employees renvoie maintenant current_assignment_id/current_site_* (jointure serveur
// avec Assignment+Site) : le client doit s'en servir directement au lieu de reconstruire le
// lien employé -> site via une synchro séparée de db.assignments.

test('employeeFromApi: construit affectationCourante depuis les champs current_* du serveur', () => {
  const a = T().employeeFromApi({
    id: 42, code: 'K08', last_name: 'FOUATIH', first_name: 'Ahmed', society: 'IRON GLOBAL SOLUTION',
    current_assignment_id: 900, current_site_id: 7, current_site_name: 'HAMOUL 01 (40K)',
    current_client_name: 'DHL FORWARDING', current_group_code: 'A', current_position: 'AGENT DE SECURITE',
    extra: {},
  });
  assert.strictEqual(a.affectationCourante.siteId, '7');
  assert.strictEqual(a.affectationCourante.siteBackendId, 7);
  assert.strictEqual(a.affectationCourante.siteName, 'HAMOUL 01 (40K)');
  assert.strictEqual(a.affectationCourante.poste, 'AGENT DE SECURITE');
  assert.strictEqual(a.affectationCourante.assignmentBackendId, 900);
});

test('employeeFromApi: current_assignment_id null efface affectationCourante (ne garde pas un ancien site)', () => {
  // Le bug exact chassé avant ce changement : un employé réaffecté vers un nouveau site
  // continuait d'afficher l'ancien ("Hamoul 1") parce que le client ne recevait jamais de
  // confirmation explicite "plus d'affectation" — juste des données qui ne se rafraîchissaient
  // pas toujours ensemble. Ici le serveur dit explicitement null : on doit vider, pas garder.
  const a = T().employeeFromApi({
    id: 43, code: 'K09', last_name: 'BENALI', first_name: 'Yacine', society: 'IRON GLOBAL SOLUTION',
    current_assignment_id: null, current_site_id: null, current_site_name: null,
    extra: { affectationCourante: { siteId: 'old', siteName: 'Hamoul 1' } },
  });
  assert.strictEqual(Object.keys(a.affectationCourante).length, 0);
});

test('employeeFromApi: sans champs current_* (réponse ancienne/dégradée), retombe sur extra.affectationCourante', () => {
  const a = T().employeeFromApi({
    id: 44, code: 'K10', last_name: 'KADI', first_name: 'Sami', society: 'IRON GLOBAL SOLUTION',
    extra: { affectationCourante: { siteId: 'old', siteName: 'Hamoul 1' } },
  });
  assert.strictEqual(a.affectationCourante.siteName, 'Hamoul 1');
});

// ── isOpsSupervisorReadOnlySession() : lecture seule configurable par compte ────────────
// Comportement historique : TOUT compte transverse "superviseur" était forcé en lecture
// seule sans possibilité de le désactiver. Un admin peut maintenant le faire par compte
// (supervisor_read_only côté serveur -> session.supervisorReadOnly côté client).

test('isOpsSupervisorReadOnlySession: superviseur reste lecture seule par défaut (champ absent)', () => {
  const t = T();
  t.setSession({ transverse: 'superviseur' });
  assert.strictEqual(t.isOpsSupervisorReadOnlySession(), true);
});

test('isOpsSupervisorReadOnlySession: superviseur reste lecture seule si supervisorReadOnly=true', () => {
  const t = T();
  t.setSession({ transverse: 'superviseur', supervisorReadOnly: true });
  assert.strictEqual(t.isOpsSupervisorReadOnlySession(), true);
});

test('isOpsSupervisorReadOnlySession: lecture seule désactivée par un admin -> false', () => {
  const t = T();
  t.setSession({ transverse: 'superviseur', supervisorReadOnly: false });
  assert.strictEqual(t.isOpsSupervisorReadOnlySession(), false);
});

test('isOpsSupervisorReadOnlySession: sans session -> false', () => {
  const t = T();
  t.setSession(null);
  assert.strictEqual(t.isOpsSupervisorReadOnlySession(), false);
});

test.after(() => { setTimeout(() => process.exit(0), 50); });


test('OPS : création autonome bloquée et quatre types de PV disponibles', async () => {
  const app=loadSgdiApp(['openOpsSiteConfigModal','openSitePVModal','siteOperationPVData']);
  const t=app.T();t.setSession({username:'ops',transverse:'ops',role:'ops'});
  t.setDb({sites:[{id:'s',backendId:1,nom:'Site DC',societe:'IRON GLOBAL SOLUTION'}],agents:[],assignments:[]});
  await t.openOpsSiteConfigModal();
  assert.strictEqual(app.window.document.getElementById('opsSiteName'),null);
  t.openSitePVModal('s');
  const form=app.window.document.getElementById('site-operation-pv-form');
  assert.ok(form);
  assert.strictEqual(form.elements.kind.options.length,4);
  form.elements.kind.value='augmentation';form.elements.before.value='10';form.elements.after.value='12';form.elements.reason.value='Renfort demandé';
  assert.strictEqual(t.siteOperationPVData(form).after,12);
  form.elements.after.value='8';assert.throws(()=>t.siteOperationPVData(form));
  form.elements.kind.value='diminution';assert.strictEqual(t.siteOperationPVData(form).after,8);
  app.window.close();
});

// Pagination OPS : vraies fonctions UI/API, sans charger la collection complète.
function opsPageFixture() {
  const app=loadSgdiApp(['emptyDB','employeeFromApi','employeeAvatarHTML','renderEffectif','renderOpsEffectifPage','opsEffectifPageParams','setEffectifPage','setEffectifSort','setOpsEffectifFilter','setOpsEffectifSearch','sgdiOpsEffectifPageActive','sgdiEnsureEmployeesForDisplay','sgdiSqlSyncTasks','sgdiInvalidateDrhReads']);
  assert.strictEqual(app.loadError,null);
  const t=app.T(),w=app.window;
  t.setDb(t.emptyDB());t.setSession({transverse:'ops',role:'ops',societe:'IRON GLOBAL SOLUTION'});
  w.sessionStorage.setItem('sgdi_api_token_v1','ops-page-token');
  w.location.hash='#/effectif/recap';
  const requests=[];
  w.SGDI_API.employees.list=async()=>{throw new Error('Liste complète interdite sur EFFECTIFS OPS')};
  w.SGDI_API.employees.page=async params=>{requests.push({...params});return {items:[],total:0,page:params.page,pages:1}};
  // Le loader photo sécurisé est couvert séparément; aucun réseau image dans ces tests UI.
  w.hydrateEmployeePhotos=()=>{};
  return {...app,t,w,requests,view:w.document.getElementById('view')};
}
function opsEmployee(id,extra={}) {
  return {id,code:`E${id}`,last_name:`Employe ${id}`,first_name:`Prenom ${id}`,society:'IRON GLOBAL SOLUTION',status:'actif',
    has_photo:true,photo_url:`/api/ops/employees/${id}/photo?v=version1`,extra:{_legacy:{id:`legacy-${id}`,affectationCourante:{siteId:'site-local',siteBackendId:41,siteName:'Site Alpha',poste:'Gardien'}}},...extra};
}
function pageResult(items,page=1,total=items.length) { return {items,page,total,pages:Math.max(1,Math.ceil(total/25))}; }

test('OPS photos: mapper sépare URL protégée et photo legacy, respecte ID SQL et absence explicite',()=>{
  const {t,w}=opsPageFixture();
  for(const id of [101,287,3901]) {
    const a=t.employeeFromApi(opsEmployee(id));
    assert.strictEqual(a.backendId,id);assert.strictEqual(a.id,`legacy-${id}`);
    assert.strictEqual(a.photoUrl,`/api/ops/employees/${id}/photo?v=version1`);
    assert.strictEqual(a.hasPhoto,true);assert.strictEqual(a.photo,'');
  }
  const absent=t.employeeFromApi(opsEmployee(7,{has_photo:false,photo_url:null,extra:{photo:'/uploads/photos/stale.jpg'}}));
  assert.strictEqual(absent.hasPhoto,false);assert.strictEqual(absent.photoUrl,'');assert.strictEqual(absent.photo,'');
  const legacy=t.employeeFromApi({id:8,extra:{_legacy:{photo:'/uploads/photos/legacy.jpg'}}});
  assert.strictEqual(legacy.photo,'/uploads/photos/legacy.jpg');assert.strictEqual(legacy.photoUrl,'');
  assert.strictEqual(legacy.hasPhoto,undefined);assert.match(t.employeeAvatarHTML(legacy),/src="\/uploads\/photos\/legacy.jpg"/);
  w.close();
});

test('OPS effectifs: page de 25 puis suivantes, rattachement photo par ID SQL',async()=>{
  const {t,w,view,requests}=opsPageFixture();
  const rows=Array.from({length:53},(_,i)=>opsEmployee(i+100));
  w.SGDI_API.employees.page=async params=>{requests.push({...params});return pageResult(rows.slice((params.page-1)*25,params.page*25),params.page,rows.length)};
  await t.renderEffectif(view,'actifs',true);
  assert.strictEqual(requests.length,1);assert.strictEqual(requests[0].page_size,25);
  assert.strictEqual(view.querySelectorAll('tbody tr').length,25);
  assert.match(view.textContent,/53 employé\(s\) · page 1\/3/);
  assert.strictEqual(view.querySelector('tbody tr').dataset.backendId,'100');
  await t.setEffectifPage('actifs',2);
  assert.strictEqual(requests.length,2);assert.strictEqual(view.querySelector('tbody tr').dataset.backendId,'125');
  assert.strictEqual(view.querySelectorAll('tbody tr').length,25);
  await t.setEffectifPage('actifs',3);
  assert.strictEqual(view.querySelectorAll('tbody tr').length,3);
  assert.strictEqual(view.querySelector('[data-ops-effectif-pagination] button:last-child').disabled,true);
  for(const a of t.getDb().agents)assert.strictEqual(a.photoUrl,`/api/ops/employees/${a.backendId}/photo?v=version1`);
  w.close();
});

test('OPS effectifs: filtres, société, site SQL et tri sont envoyés avant pagination',async()=>{
  const {t,w,view,requests}=opsPageFixture();
  t.getDb().sites=[{id:'site-local',backendId:41,nom:'Site Alpha',societe:'IRON GLOBAL SOLUTION'}];
  w.sessionStorage.setItem('opsEffectifFilters',JSON.stringify({q:'  Recherche  ',site:'site-local',poste:'Gardien',situation:'Marié',recrutFrom:'2025-01-01',recrutTo:'2026-12-31',birthFrom:'1980-01-01',birthTo:'2000-01-01',ageMin:'25',ageMax:'50'}));
  await t.renderEffectif(view,'suspension',true);
  const p=requests[0];
  assert.strictEqual(p.mode,'suspension');assert.strictEqual(p.society,'IRON GLOBAL SOLUTION');assert.strictEqual(p.site_id,41);
  assert.strictEqual(p.q,'Recherche');assert.strictEqual(p.poste,'Gardien');assert.strictEqual(p.recrut_from,'2025-01-01');assert.strictEqual(p.birth_to,'2000-01-01');assert.strictEqual(p.age_max,'50');
  await t.setEffectifPage('suspension',3);
  await t.setEffectifSort('mat_desc');
  assert.strictEqual(requests.at(-1).sort,'mat_desc');assert.strictEqual(requests.at(-1).page,1);assert.strictEqual(requests.at(-1).mode,'suspension');
  await t.setOpsEffectifFilter('site','__none__');
  assert.strictEqual(requests.at(-1).site_id,'__none__');assert.strictEqual(requests.at(-1).page,1);
  w.close();
});

test('OPS effectifs: recherche serveur trouve un employé hors première page et conserve le focus',async()=>{
  const {t,w,view,requests}=opsPageFixture();
  w.SGDI_API.employees.page=async params=>{requests.push({...params});return pageResult(params.q?[opsEmployee(999)]:[opsEmployee(101)],1,params.q?1:60)};
  await t.renderEffectif(view,'actifs',true);
  const input=view.querySelector('input[oninput*="setEffectifSearch"]');input.focus();input.value='Employe 999';input.setSelectionRange(11,11);
  t.setOpsEffectifSearch(input.value);
  await new Promise(resolve=>setTimeout(resolve,320));
  assert.strictEqual(requests.length,2);assert.strictEqual(requests[1].q,'Employe 999');
  assert.strictEqual(view.querySelector('tbody tr').dataset.backendId,'999');
  assert.strictEqual(w.document.activeElement.value,'Employe 999');
  assert.strictEqual(view.querySelectorAll('tbody tr').length,1);
  w.close();
});

test('OPS effectifs: ancienne réponse ne remplace ni DOM ni employés après filtre plus récent',async()=>{
  const {t,w,view}=opsPageFixture();const pending=[];
  w.SGDI_API.employees.page=params=>new Promise(resolve=>pending.push({params,resolve}));
  const first=t.renderEffectif(view,'actifs',true);
  const second=t.setOpsEffectifFilter('poste','Gardien');
  pending[1].resolve(pageResult([opsEmployee(200)]));await second;
  pending[0].resolve(pageResult([opsEmployee(100)]));await first;
  assert.strictEqual(view.querySelector('tbody tr').dataset.backendId,'200');
  assert.deepStrictEqual(Array.from(t.getDb().agents,a=>a.backendId),[200]);
  w.close();
});

test('OPS effectifs: navigation, déconnexion et invalidation refusent une réponse tardive',async()=>{
  for(const cancel of [a=>{a.w.location.hash='#/ops/mouvements'},a=>a.w.sessionStorage.removeItem('sgdi_api_token_v1'),a=>a.t.sgdiInvalidateDrhReads()]){
    const a=opsPageFixture();let resolve;
    a.w.SGDI_API.employees.page=()=>new Promise(r=>{resolve=r});
    const pending=a.t.renderEffectif(a.view,'actifs',true);cancel(a);resolve(pageResult([opsEmployee(100)]));await pending;
    assert.strictEqual(a.t.getDb().agents.length,0);assert.strictEqual(a.view.querySelector('tbody tr'),null);a.w.close();
  }
});

test('OPS effectifs: nouvelle photo puis suppression et nouvel employé au rechargement',async()=>{
  const {t,w,view}=opsPageFixture();let items=[opsEmployee(101)];
  w.SGDI_API.employees.page=async()=>pageResult(items);
  await t.renderEffectif(view,'actifs',true);
  items=[opsEmployee(101,{photo_url:'/api/ops/employees/101/photo?v=version2'}),opsEmployee(202)];
  await t.renderEffectif(view,'actifs',true);
  assert.strictEqual(t.getDb().agents.length,2);assert.strictEqual(t.getDb().agents[0].photoUrl,'/api/ops/employees/101/photo?v=version2');
  items=[opsEmployee(101,{has_photo:false,photo_url:null})];
  await t.renderEffectif(view,'actifs',true);
  assert.strictEqual(t.getDb().agents[0].photoUrl,'');assert.strictEqual(t.getDb().agents[0].hasPhoto,false);
  assert.strictEqual(view.querySelectorAll('tbody tr').length,1);w.close();
});

test('OPS effectifs: codes identiques entre salariés ne mélangent pas leurs photos',async()=>{
  const {t,w,view}=opsPageFixture();
  w.SGDI_API.employees.page=async()=>pageResult([opsEmployee(101,{code:'A01'}),opsEmployee(202,{code:'A01'})]);
  await t.renderEffectif(view,'actifs',true);
  assert.strictEqual(t.getDb().agents.length,2);
  assert.strictEqual(view.querySelectorAll('tbody tr')[0].dataset.backendId,'101');
  assert.strictEqual(view.querySelectorAll('tbody tr')[1].dataset.backendId,'202');w.close();
});

test('OPS effectifs: erreur page visible sans repli sur la liste complète',async()=>{
  const {t,w,view}=opsPageFixture();w.console.warn=()=>{};
  w.SGDI_API.employees.page=async()=>{throw new Error('indisponible')};
  await t.renderEffectif(view,'actifs',true);
  assert.match(view.querySelector('[role="alert"]').textContent,/Chargement des employés impossible/);
  assert.strictEqual(view.querySelector('#effectif-list-zone').hasAttribute('aria-busy'),false);w.close();
});

test('OPS effectifs: bootstrap et compteurs ne chargent pas tous les employés; autres modules inchangés',async()=>{
  const {t,w}=opsPageFixture();let lists=0;
  w.SGDI_API.employees.list=async()=>{lists++;return []};
  w.eval('syncSitesFromPostgres=async()=>{};syncAssignmentsFromPostgres=async()=>{};syncOpsMovementsFromPostgres=async()=>{};sgdiShouldSyncCandidates=()=>false;');
  assert.strictEqual(t.sgdiOpsEffectifPageActive(),true);
  assert.strictEqual(t.sgdiEnsureEmployeesForDisplay({force:true}),null);
  await Promise.all(t.sgdiSqlSyncTasks({module:'ops'}));assert.strictEqual(lists,0);
  w.location.hash='#/ops/dashboard';assert.strictEqual(t.sgdiOpsEffectifPageActive(),false);
  await Promise.all(t.sgdiSqlSyncTasks({module:'ops'}));assert.strictEqual(lists,1);
  for(const hash of ['#/effectif/agent/123','#/effectif/sortants','#/effectif/archives_sortants','#/effectif/preparation_affectation']){
    w.location.hash=hash;assert.strictEqual(t.sgdiOpsEffectifPageActive(),false,hash+' garde ses dépendances propres');
  }
  t.setSession({transverse:'superviseur',societe:'IRON GLOBAL SOLUTION'});w.location.hash='#/effectif/recap';
  assert.strictEqual(t.sgdiOpsEffectifPageActive(),false);w.close();
});

test('OPS effectifs: facettes postes complètes et page corrigée par le serveur sont conservées',async()=>{
  const {t,w,view}=opsPageFixture();
  w.SGDI_API.employees.page=async()=>({...pageResult([opsEmployee(100)],1,1),filters:{postes:['Gardien','Cariste page suivante']}});
  await t.renderEffectif(view,'recap',true);
  const poste=view.querySelector('select[onchange*="setOpsEffectifFilter(\'poste\'"]');
  assert.deepStrictEqual(Array.from(poste.options,o=>o.value),['','Cariste page suivante','Gardien']);
  await t.setEffectifPage('actifs',7);
  assert.strictEqual(t.opsEffectifPageParams('actifs').page,1);
  assert.strictEqual(view.querySelectorAll('tbody tr').length,1);w.close();
});

test('OPS effectifs: changement de société exclut la page tardive de la société précédente',async()=>{
  const {t,w,view}=opsPageFixture();const requests=[];
  w.SGDI_API.employees.page=params=>new Promise(resolve=>requests.push({params,resolve}));
  const first=t.renderEffectif(view,'actifs',true);
  t.setSession({transverse:'ops',role:'ops',societe:'SWORD CORPORATION'});
  const second=t.renderEffectif(view,'actifs',true);
  assert.strictEqual(requests[1].params.society,'SWORD CORPORATION');
  requests[1].resolve(pageResult([opsEmployee(202,{society:'SWORD CORPORATION'})]));await second;
  requests[0].resolve(pageResult([opsEmployee(101)]));await first;
  assert.strictEqual(view.querySelector('tbody tr').dataset.backendId,'202');
  assert.deepStrictEqual(Array.from(t.getDb().agents,a=>a.backendId),[202]);w.close();
});

test('OPS effectifs: la projection canonique retire les anciens champs RH et photos du cache',async()=>{
  const {t,w,view}=opsPageFixture();
  t.getDb().agents=[{id:'legacy-101',backendId:101,matricule:'E101',situation:'Donnée RH ancienne',photo:'/uploads/photos/ancienne.jpg',dateNaissance:'1980-01-01',famille:[{nom:'Privé'}]}];
  w.SGDI_API.employees.page=async()=>pageResult([opsEmployee(101,{has_photo:false,photo_url:null})]);
  await t.renderEffectif(view,'actifs',true);
  const a=t.getDb().agents[0];
  assert.strictEqual(a.situation,undefined);assert.strictEqual(a.famille,undefined);assert.strictEqual(a.dateNaissance,'');assert.strictEqual(a.photo,'');
  assert.doesNotMatch(view.textContent,/Donnée RH ancienne/);w.close();
});
