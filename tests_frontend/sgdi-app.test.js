// Tests FRONTEND réels : on charge le vrai sgdi-app.js dans jsdom et on teste ses
// fonctions critiques (logique métier qu'on a corrigée). Pas de mock de la logique :
// on appelle les VRAIES fonctions. On stub uniquement les APIs navigateur absentes de
// jsdom (réseau/temps réel), et un suffixe expose les fonctions + db/session (impossibles
// à atteindre autrement dans ce monolithe où db/session sont des `let` internes).
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const coreUtils = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'utils.js'), 'utf8');
const moduleRegistry = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'js', 'core', 'module-registry.js'), 'utf8');
const appSrc = require('./read-client-source')();
const src = coreUtils + '\n' + moduleRegistry + '\n' + appSrc;

const dom = new JSDOM(
  '<!doctype html><html><body><div id="app"></div><div id="sidebar-nav"></div><div id="view"></div></body></html>',
  { url: 'https://drh.irongs.com/', runScripts: 'outside-only', pretendToBeVisual: true }
);
const { window } = dom;

// APIs navigateur absentes de jsdom -> no-op (on ne teste pas le réseau ici, juste la logique)
window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
window.EventSource = function () { this.close = () => {}; this.addEventListener = () => {}; this.onopen = null; this.onerror = null; };
window.BroadcastChannel = function () { this.postMessage = () => {}; this.close = () => {}; this.onmessage = null; };
window.AudioContext = function () { this.createOscillator = () => ({ connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {} }, type: '' }); this.createGain = () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }); this.destination = {}; this.currentTime = 0; this.state = 'running'; this.resume = () => Promise.resolve(); };
window.webkitAudioContext = window.AudioContext;
window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.scrollTo = () => {};
// Neutraliser les timers de fond pour ne pas bloquer le process de test
window.setInterval = () => 0;

// Suffixe : exposer les fonctions à tester + des setters pour db/session (let internes)
const exposeSuffix = `
;window.__sgdiTest = {
  employeeIsFormer: (typeof employeeIsFormer !== 'undefined') ? employeeIsFormer : null,
  employeeIsActive: (typeof employeeIsActive !== 'undefined') ? employeeIsActive : null,
  agentHasLiveAffectation: (typeof agentHasLiveAffectation !== 'undefined') ? agentHasLiveAffectation : null,
  agentNeedsAffectation: (typeof agentNeedsAffectation !== 'undefined') ? agentNeedsAffectation : null,
  sgdiLegacySnapshot: (typeof sgdiLegacySnapshot !== 'undefined') ? sgdiLegacySnapshot : null,
  sgdiCaptureBaseline: (typeof sgdiCaptureBaseline !== 'undefined') ? sgdiCaptureBaseline : null,
  sgdiEditingBlocksRender: (typeof sgdiEditingBlocksRender !== 'undefined') ? sgdiEditingBlocksRender : null,
  sgdiModuleHostConfigs: (typeof sgdiModuleHostConfigs !== 'undefined') ? sgdiModuleHostConfigs : null,
  adminSidebarOrganizerDefaults: (typeof adminSidebarOrganizerDefaults !== 'undefined') ? adminSidebarOrganizerDefaults : null,
  setDb: (v) => { db = v; },
  setSession: (v) => { session = v; },
  setViewMode: (v) => { sgdiViewModeActive = v; },
  setHydrated: (v) => { sgdiHydrated = v; },
};
`;

let loadError = null;
try {
  window.eval(src + exposeSuffix);
} catch (e) {
  loadError = e;
}

const T = () => window.__sgdiTest || {};

test('sgdi-app.js se charge sans erreur dans jsdom', () => {
  assert.strictEqual(loadError, null, loadError && loadError.stack);
  assert.ok(window.__sgdiTest, 'le suffixe d\'exposition doit avoir tourné');
});

test('le recrutement est placé immédiatement sous le tableau de bord DRH', () => {
  const configs = T().sgdiModuleHostConfigs();
  assert.deepStrictEqual(
    Array.from(configs.drh.sections.slice(0, 2), item => [item.label, item.route]),
    [['TABLEAU DE BORD', 'drh/dashboard'], ['RECRUTEMENT', 'recrutement/candidats']]
  );
});

test('les routes recrutement restent dans le module DRH', () => {
  assert.match(src, /case"recrutement":[\s\S]*renderRecrutement\(view,"new"\)/);
  assert.match(src, /sub==="nouveau"\?null:sub/);
  assert.match(src, /case"reserve":[\s\S]*renderCandidatForm\(view,sub==="nouveau"\?null:sub,\{reserveDirect:true\}\)/);
  assert.match(src, /case"candidats_archives":[\s\S]*renderRecrutement\(view,"archive"\)/);
  assert.doesNotMatch(src, /location\.assign\("\/recrute"\)/);
  assert.doesNotMatch(src, /const alreadyRendered=.*data-recruitment-view/);
  assert.doesNotMatch(src, /const emptyListCard=/);
});

test('le recrutement couvre entretien, décision réversible, embauche et statistiques', () => {
  for (const fn of ['openCandidateInterviewModal', 'saveCandidateInterview', 'validateCandidateApplication', 'renderRecruitmentStatistics']) {
    assert.match(src, new RegExp(`function ${fn}\\(`));
  }
  assert.match(src, /Annuler candidature/);
  assert.match(src, /Valider candidature/);
  assert.match(src, /Recruter/);
  for (const label of ['Âge', 'Sexe', 'Adresse', 'Nom', 'Prénom', 'Date de naissance', 'Lieu de naissance', 'Formation', 'Expérience professionnelle']) {
    assert.ok(src.includes(label), `statistique manquante : ${label}`);
  }
});

test('le bandeau des étapes candidat est adaptatif sans huitième colonne vide', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.css'), 'utf8');
  assert.match(css, /candidate-section-list-horizontal\{[^}]*grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:1400px\)[\s\S]*candidate-section-list-horizontal\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*candidate-section-list-horizontal\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:420px\)[\s\S]*candidate-section-list-horizontal\{grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(css, /candidate-section-list-horizontal\{[^}]*repeat\(8,/);
});

test('Administration système expose la configuration du recrutement', () => {
  const configs = T().sgdiModuleHostConfigs();
  assert.ok(configs.admin.sections.some(item => item.route === 'admin/sections_candidat'));
  const defaults = T().adminSidebarOrganizerDefaults();
  assert.ok(defaults.admin.some(item => item[1] === 'admin/sections_candidat'));
});

test('la fiche utilisateur propose et transmet les droits par action', () => {
  for (const action of ['read', 'create', 'update', 'validate', 'delete', 'export', 'unlock', 'admin']) {
    assert.match(src, new RegExp(`action_\\$\\{action\\.key\\}`));
  }
  assert.match(src, /authorized_actions:data\.actionsAutorisees/);
  assert.match(src, /Aucune case cochée : héritage du profil/);
});

test('les actions du candidat en réserve proposent la contractualisation contrôlée', () => {
  assert.match(src, /Recruter \/ Établir contrat/);
  assert.match(src, /function recruitAndOpenCandidateContract\(/);
  assert.match(src, /candidateCanGoToContract\(c\)/);
  assert.match(src, /Décision favorable obligatoire/);
  assert.match(src, /marquerContractualisation\(backendId\)/);
});

test('le compteur des contrats à établir clignote en rouge uniquement au-dessus de zéro', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.css'), 'utf8');
  assert.match(src, /pendingCandidates\.length>0\?"contract-modern-stat-alert"/);
  assert.match(css, /\.contract-modern-stat-alert strong\{[^}]*#dc2626[^}]*contractPendingBlink/);
  assert.match(css, /@keyframes contractPendingBlink/);
});

test('les nouveaux dossiers utilisent le tableau épuré de contractualisation', () => {
  assert.match(src, /function recruitmentContractStyleTableHTML\(/);
  assert.match(src, /<th>Candidat<\/th><th>Poste<\/th><th>Société<\/th><th>Téléphone<\/th><th>Transmission<\/th><th>Action<\/th>/);
  assert.match(src, /mode==="new"\?recruitmentContractStyleTableHTML\(cs,pagination\)/);
  assert.match(src, /function recruitCandidateToContracts\(/);
  assert.match(src, />Recruter<\/button>/);
  assert.match(src, /removedFromRecruitmentAt:new Date\(\)\.toISOString\(\)/);
  assert.match(src, /row\.style\.transition="opacity \.18s ease,transform \.18s ease"/);
  assert.match(src, /const activeSociety=drhActiveSocieteFilter\(\)/);
  assert.match(src, /activeTab\.textContent=String\(newCount\)/);
});

test('les statistiques recrutement utilisent un tableau de bord compact et adaptatif', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.css'), 'utf8');
  assert.match(src, /class="recruitment-stats-page"/);
  assert.match(src, /class="recruitment-stats-analysis"/);
  assert.match(src, /class="recruitment-stats-bars"/);
  assert.match(src, /id="recruit-stats-field"/);
  assert.match(css, /\.recruitment-stats-analysis\{display:grid/);
  assert.match(css, /#view \.recruitment-stats-page\{[\s\S]*?width:100%!important/);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test('la sélection employé des actions RH utilise une recherche multicritère', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.css'), 'utf8');
  assert.match(src, /function updateRhEffectifEmployeeSearch\(/);
  assert.match(src, /function selectRhEffectifEmployee\(/);
  assert.match(src, /Matricule, nom, prénom, société, fonction, téléphone/);
  assert.match(src, /id="rh-effectif-employee-search-input" type="search"/);
  assert.match(src, /name="agentId" value=""/);
  assert.match(css, /\.rh-employee-multisearch\{/);
  assert.match(css, /\.rh-employee-search-result\{/);
});

test('le contrat propose la liste centralisée des banques algériennes', () => {
  assert.match(src, /function banquesAlgerieOptionsHTML\(/);
  assert.match(src, /<select class="select" name="banque">\$\{banquesAlgerieOptionsHTML\(p\.banque\)\}<\/select>/);
  assert.match(src, /Banque Extérieure d'Algérie \(BEA\)/);
  assert.match(src, /Banque Nationale d'Algérie \(BNA\)/);
  assert.match(src, /Crédit Populaire d'Algérie \(CPA\)/);
});

test('l’aperçu du contrat fusionne le modèle avec les données du futur employé', () => {
  assert.match(src, /Aperçu du contrat complété/);
  assert.match(src, /printEmployeeNewContractFromForm\(document\.getElementById\('employee-new-contract-form'\)\)/);
  assert.doesNotMatch(src, /Télécharger l'aperçu du modèle/);
  assert.match(src, /openEmployeeContractReviewWindow\(draft\.a,draft\)/);
  assert.match(src, /Le modèle Word sera automatiquement rempli avec toutes les informations saisies du futur employé/);
});

test('le champ client du contrat charge les clients PostgreSQL et les sites', () => {
  assert.match(src, /function loadNewContractClients\(\)/);
  assert.match(src, /await SGDI\.commercial\.clients\(\)/);
  assert.match(src, /db\.clients=rows\.map\(clientFromApi\)/);
  assert.match(src, /<optgroup label="Clients">/);
  assert.match(src, /<optgroup label="Sites opérationnels">/);
  assert.match(src, /loadNewContractClients\(\);updateNewContractSalaryWords/);
});

test('les dates et la durée du contrat sont alignées sur une même ligne', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.css'), 'utf8');
  assert.match(src, /class="nc-contract-dates-row"/);
  assert.match(src, /Date début du contrat/);
  assert.match(src, /Date fin du contrat/);
  assert.match(src, /class="nc-contract-basics-row"/);
  assert.match(css, /\.nc-contract-dates-row\{grid-column:1\/-1;display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('la contractualisation permet de compléter le contact d’urgence obligatoire', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'static', 'sgdi-app.css'), 'utf8');
  assert.match(src, /class="nc-candidate-contact-row"/);
  assert.match(src, /name="candidateWilaya" required/);
  assert.match(src, /name="contactUrgenceLien"[^>]*required/);
  assert.match(src, /name="contactUrgenceNom"[^>]*required/);
  assert.match(src, /name="contactUrgenceTel"[^>]*required/);
  assert.match(src, /c\.wilaya=String\(candidateDetails\.get\("candidateWilaya"\)/);
  assert.match(css, /\.nc-candidate-contact-row\{grid-column:1\/-1;display:grid;grid-template-columns:repeat\(4/);
});

test('employeeIsFormer: un sortant est "former", un actif ne l\'est pas', () => {
  const f = T().employeeIsFormer;
  assert.ok(f);
  assert.strictEqual(f({ statut: 'sortant' }), true);
  assert.strictEqual(f({ statut: 'licencie' }), true);
  assert.strictEqual(f({ statut: 'actif' }), false);
  assert.strictEqual(f({ statut: 'suspendu' }), false); // suspendu = non sortant
});

test('employeeIsActive: seul le statut "actif" compte (exclut suspendu/sortant)', () => {
  const f = T().employeeIsActive;
  assert.ok(f);
  assert.strictEqual(f({ statut: 'actif' }), true);
  assert.strictEqual(f({ statut: 'suspendu' }), false);
  assert.strictEqual(f({ statut: 'sortant' }), false);
});

test('agentHasLiveAffectation: vrai si affectationCourante a un site, faux sinon', () => {
  const f = T().agentHasLiveAffectation;
  assert.ok(f);
  assert.strictEqual(f({ affectationCourante: { siteId: 'st_1', siteName: 'DHL' } }), true);
  assert.strictEqual(f({ affectationCourante: { siteName: 'DHL' } }), true);
  assert.strictEqual(f({ affectationCourante: {} }), false);
  assert.strictEqual(f({}), false);
});

test('agentNeedsAffectation: un non-sortant sans affectation en a besoin', () => {
  const f = T().agentNeedsAffectation;
  assert.ok(f);
  assert.strictEqual(f({ statut: 'actif', affectationCourante: {} }), true);
  assert.strictEqual(f({ statut: 'actif', affectationCourante: { siteId: 'x' } }), false);
  assert.strictEqual(f({ statut: 'sortant', affectationCourante: {} }), false); // sortant -> pas concerné
});

test('sgdiLegacySnapshot: sauvegarde CIBLÉE — seules les collections modifiées sont envoyées', () => {
  const t = T();
  assert.ok(t.sgdiLegacySnapshot && t.sgdiCaptureBaseline && t.setDb);
  // Base de départ avec deux collections JSON
  t.setDb({ conges: [{ id: 'c1' }], notifications: [{ id: 'n1' }], agents: [{ id: 'a1' }] });
  t.sgdiCaptureBaseline(); // empreinte = état "serveur"
  // On modifie UNE seule collection
  t.setDb({ conges: [{ id: 'c1' }, { id: 'c2' }], notifications: [{ id: 'n1' }], agents: [{ id: 'a1' }] });
  const snap = t.sgdiLegacySnapshot();
  // conges a changé -> envoyé plein ; notifications inchangée -> vidée ; agents = SQL -> vidé
  assert.strictEqual(snap.conges.length, 2, 'la collection modifiée doit être envoyée complète');
  assert.strictEqual(snap.notifications.length, 0, 'une collection INCHANGÉE ne doit pas être renvoyée');
  assert.strictEqual(snap.agents.length, 0, 'les collections SQL sont toujours vidées (gérées par REST)');
});

test('sgdiEditingBlocksRender: bloque le réaffichage si le formulaire est déverrouillé', () => {
  const t = T();
  assert.ok(t.sgdiEditingBlocksRender && t.setViewMode);
  t.setSession({ username: 'x' });
  t.setViewMode(true);  // mode lecture -> ne bloque pas
  assert.strictEqual(t.sgdiEditingBlocksRender(), false);
  t.setViewMode(false); // mode édition (déverrouillé) -> bloque
  assert.strictEqual(t.sgdiEditingBlocksRender(), true);
});

// Sortie propre (des timers/handlers résiduels pourraient sinon maintenir le process en vie)
test.after(() => { try { dom.window.close(); } catch (e) {} setTimeout(() => process.exit(0), 50); });

test('fiche employé : champs incomplets signalés dès ouverture et actualisés à la saisie', () => {
  const ctx = require('./load-app').loadSgdiApp(['bindAgentFormDirtyState']);
  assert.ifError(ctx.loadError);
  const { window, T } = ctx;
  try {
    window.document.getElementById('view').innerHTML = `<form id="agent-form">
      <input name="telephone" value=""><input name="email" type="email" value="invalide">
      <input name="nom" value="Martin"><input name="hidden" type="hidden">
      <input name="computed" readonly><input name="disabled" disabled>
      <select name="banque"><option value="">Choisir</option><option value="B">Banque</option></select>
      <textarea name="adresse"></textarea><input name="actif" type="checkbox">
      <div id="agent-save-state">Aucune modification</div>
      <button class="rh-save-submit" disabled>Enregistrer</button><button class="rh-save-cancel" disabled>Annuler</button>
    </form>`;
    T().bindAgentFormDirtyState();
    const form = window.document.getElementById('agent-form');
    const field = name => form.querySelector(`[name="${name}"]`);
    for (const name of ['telephone', 'email', 'banque', 'adresse']) assert.ok(field(name).classList.contains('rh-field-incomplete'));
    for (const name of ['nom', 'hidden', 'computed', 'disabled', 'actif']) assert.ok(!field(name).classList.contains('rh-field-incomplete'));
    assert.ok(form.querySelector('.rh-save-submit').disabled);
    field('email').value = 'test@example.com';
    field('email').dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.ok(!field('email').classList.contains('rh-field-incomplete'));
    assert.strictEqual(form.dataset.dirty, 'true');
    assert.ok(!form.querySelector('.rh-save-submit').disabled);
    assert.ok(window.document.getElementById('agent-save-state').classList.contains('is-dirty'));
    field('nom').value = '  ';
    field('nom').dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.ok(field('nom').classList.contains('rh-field-incomplete'));
  } finally { window.close(); }
});

test('identifiant connecté : utilise le login exact et échappe le contenu', () => {
  const ctx = require('./load-app').loadSgdiApp(['connectedAccountHeadingHTML']);
  assert.ifError(ctx.loadError);
  try {
    ctx.T().setSession({username:'SARA <test>',nom:'Nom complet différent'});
    const markup=ctx.T().connectedAccountHeadingHTML();
    assert.match(markup,/SARA &lt;test&gt;/);
    assert.doesNotMatch(markup,/Nom complet différent/);
    ctx.T().setSession(null);
    assert.strictEqual(ctx.T().connectedAccountHeadingHTML(),'');
  } finally {ctx.window.close();}
});

for (const scenario of [
  {name:'maîtrise DRH',role:'dispatch',module:'drh',expected:['employees']},
  {name:'recruteur DRH',role:'recruteur',module:'drh',expected:['employees','candidates']},
  {name:'structure RH autorisée',role:'dispatch',module:'drh',structures:['gestionnaire_rh'],expected:['employees','candidates']},
  {name:'portail avant sélection',role:'dispatch',module:null,expected:[]},
  {name:'commercial',role:'dispatch',module:'commercial',expected:['clients']},
]) {
  test(`synchronisation bloquante : ${scenario.name} ne charge que les données pertinentes`, async () => {
    const ctx=require('./load-app').loadSgdiApp(['sgdiSqlSyncTasks']);
    assert.ifError(ctx.loadError);
    const {window,T}=ctx;
    try {
      T().setSession({username:'TEST',role:scenario.role,societe:'IRON',transverse:scenario.module,structuresAutorisees:scenario.structures||[]});
      window.sgdiModuleHostConfig=()=>null;
      window.history.replaceState(null,'',scenario.module?'#/'+scenario.module+'/dashboard':'#/societe-portal');
      const calls=[];
      for(const [fn,key] of Object.entries({sgdiPullEmployees:'employees',syncCandidatesFromPostgres:'candidates',syncSitesFromPostgres:'sites',syncAssignmentsFromPostgres:'assignments',syncOpsMovementsFromPostgres:'movements',syncMaterielFromPostgres:'stock',syncClientsFromPostgres:'clients'}))window[fn]=async()=>{calls.push(key);};
      await Promise.all(T().sgdiSqlSyncTasks({blocking:true,full:true}));
      assert.deepStrictEqual(calls,scenario.expected);
    } finally {window.close();}
  });
}

test('synchronisation ciblée : les erreurs réelles restent rejetées', async()=>{
  const ctx=require('./load-app').loadSgdiApp(['sgdiSqlSyncTasks']);
  assert.ifError(ctx.loadError);
  try {
    ctx.T().setSession({username:'TEST',role:'dispatch',societe:'IRON',transverse:'commercial'});
    ctx.window.sgdiModuleHostConfig=()=>null;
    ctx.window.history.replaceState(null,'','#/commercial/dashboard');
    ctx.window.syncClientsFromPostgres=async()=>{throw new Error('Serveur indisponible');};
    await assert.rejects(Promise.all(ctx.T().sgdiSqlSyncTasks({blocking:true})),/Serveur indisponible/);
  } finally {ctx.window.close();}
});

test('PostgreSQL : les listes vides remplacent le cache, les collections omises restent en mémoire',()=>{
  const c=require('./load-app').loadSgdiApp(['hydrateDB']);assert.ifError(c.loadError);
  try{c.T().setDb({agents:[{id:'old'}],clients:[{id:'client'}],settings:{}});const remote={agents:[]};const result=c.T().hydrateDB(remote,{partialSql:true});assert.equal(result.agents.length,0);assert.equal(result.clients[0].id,'client');assert.equal(remote.agents.length,0);}finally{c.window.close();}
});

test('PostgreSQL : les lectures sites, clients et candidats ne réinjectent ni ne suppriment de données',async()=>{
  const c=require('./load-app').loadSgdiApp(['syncSitesFromPostgres','syncClientsFromPostgres','syncCandidatesFromPostgres','hydrateDB']);assert.ifError(c.loadError);
  try{
    const data={sites:[{id:'old-site'}],clients:[{id:'old-client'}],candidats:[{id:'old-candidate',nom:'Ancien',prenom:'Test'}],settings:{}};c.T().setDb(data);c.window.sgdiAuthToken=()=> 'test';
    c.window.SGDI.sites.list=async()=>[];c.window.SGDI.commercial.clients=async()=>[];c.window.SGDI.rh.candidates=async()=>[];
    c.window.persistSiteToPostgres=c.window.persistClientToPostgres=c.window.deleteCandidateFromPostgres=()=>{throw new Error('Écriture interdite pendant une lecture');};
    await c.T().syncSitesFromPostgres();await c.T().syncClientsFromPostgres();await c.T().syncCandidatesFromPostgres();
    assert.equal(data.sites.length,0);assert.equal(data.clients.length,0);assert.equal(data.candidats.length,0);
  }finally{c.window.close();}
});

test('PostgreSQL : un retrait de droits serveur remplace les anciens droits locaux',async()=>{
  const c=require('./load-app').loadSgdiApp(['sgdiRefreshSessionFromServer','currentUserRecord','currentAllowedSocietes','canAccessStructureKey','_bootCacheLoad']);assert.ifError(c.loadError);
  try{
    c.T().setDb({users:[{username:'TEST',role:'admin',niveau:'H5',societesAutorisees:['IRON'],structuresAutorisees:['admin']}],settings:{}});
    c.T().setSession({username:'TEST',role:'admin',niveau:'H5',societe:'IRON',permissionsFromServer:true,effectiveModules:['drh'],globalSocietyAccess:true});c.window.sgdiAuthToken=()=> 'test';
    c.window.SGDI.auth.me=async()=>({id:9,username:'TEST',full_name:'Serveur',role:'dispatch',access_level:'H1',authorized_societies:[],authorized_sites:[],authorized_structures:[],authorized_actions:[],authorized_modules:[],effective_modules:[],module_access_global:false,global_society_access:false,recruitment_access:false});
    await c.T().sgdiRefreshSessionFromServer();assert.equal(c.T().currentUserRecord().role,'dispatch');assert.equal(c.T().currentAllowedSocietes().length,0);assert.equal(c.T().canAccessStructureKey('drh'),false);
    c.window.localStorage.setItem('atlas_boot_cache',JSON.stringify({u:'TEST',t:Date.now(),d:{users:[{role:'admin'}]}}));assert.equal(c.T()._bootCacheLoad('TEST'),null);
  }finally{c.window.close();}
});

test('PostgreSQL : les droits vides de la liste des comptes écrasent le cache legacy',async()=>{
  const c=require('./load-app').loadSgdiApp(['sgdiLoadAuthState']);assert.ifError(c.loadError);
  try{
    const data={users:[{username:'TEST',role:'admin',niveau:'H5',societesAutorisees:['IRON'],structuresAutorisees:['admin']}],settings:{userSocietePermissions:{TEST:{societesAutorisees:['IRON'],structuresAutorisees:['admin'],niveau:'H5'}}}};
    c.T().setDb(data);c.T().setSession({username:'ADM01',role:'admin'});c.window.sgdiAuthToken=()=> 'test';
    c.window.SGDI.auth.listUsers=async()=>[{id:3,username:'TEST',role:'dispatch',access_level:'H1',authorized_societies:[],authorized_structures:[],authorized_sites:[],authorized_actions:[],authorized_modules:[],email:'test@example.com'}];
    c.window.SGDI.auth.accessRules=async()=>[];
    await c.T().sgdiLoadAuthState();assert.equal(data.users[0].societesAutorisees.length,0);assert.equal(data.users[0].structuresAutorisees.length,0);assert.equal(data.users[0].niveau,'H1');assert.equal(data.users[0].email,'test@example.com');assert.equal(data.users[0].modulesAutorises.length,0);
  }finally{c.window.close();}
});

test('sélecteur société : les synchronisations conservent les nœuds et les changements restent visibles',()=>{
  const c=require('./load-app').loadSgdiApp(['renderModuleHostSocieteSelector']);
  assert.ifError(c.loadError);
  try{
    c.T().setDb({users:[],settings:{}});
    c.T().setSession({username:'TEST',role:'admin',niveau:'H5'});
    const cfg={key:'commercial',title:'Portail Commercial'};
    c.T().renderModuleHostSocieteSelector(cfg);
    const app=c.window.document.getElementById('app'),root=app.firstElementChild;
    const button=root.querySelector('button');button.focus();
    for(let i=0;i<3;i++)c.T().renderModuleHostSocieteSelector(cfg);
    assert.strictEqual(app.firstElementChild,root);
    assert.strictEqual(c.window.document.activeElement,button);
    c.T().setSession({username:'AUTRE',role:'admin',niveau:'H5'});
    c.T().renderModuleHostSocieteSelector(cfg);
    assert.notStrictEqual(app.firstElementChild,root);
    assert.ok(app.textContent.includes('AUTRE'));
    c.T().setSession({username:'AUTRE',permissionsFromServer:true,globalSocietyAccess:false,societesAutorisees:[]});
    c.T().renderModuleHostSocieteSelector(cfg);
    assert.strictEqual(app.querySelectorAll('.module-host-soc-card').length,0);
    assert.ok(app.textContent.includes('Aucune société autorisée'));

    app.innerHTML='<div>Autre page</div>';
    c.T().renderModuleHostSocieteSelector(cfg);
    assert.ok(app.querySelector('[data-module-society-selector]'));
  }finally{c.window.close();}
});
