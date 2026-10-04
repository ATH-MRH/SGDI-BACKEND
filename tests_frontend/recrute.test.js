const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "app", "static", "recrute.html"), "utf8");

test("module recrutement: navigation latérale complète", () => {
  assert.match(source, /data-section="dashboard"[^>]*>.*Tableau de bord/s);
  assert.match(source, /data-section="candidates"[^>]*>.*Candidatures/s);
  assert.match(source, /data-section="interviews"[^>]*>.*Entretiens/s);
  assert.match(source, /data-section="announcements"[^>]*>.*Annonces recrutement/s);
  assert.match(source, /data-section="reserve"[^>]*>.*Réserve/s);
  assert.match(source, /data-section="archive"[^>]*>.*Archives/s);
});

test("annonces recrutement: cycle opérationnel disponible", () => {
  for (const fn of [
    "renderRecruitAnnouncements",
    "openAnnouncementForm",
    "saveRecruitAnnouncement",
    "setAnnouncementStatus",
    "deleteRecruitAnnouncement",
    "filterRecruitAnnouncements",
    "shareRecruitAnnouncement",
    "recruitAnnouncementPoster",
  ]) assert.match(source, new RegExp(`function ${fn}\\(`));
  assert.match(source, />Publier \/ Partager</);
  assert.match(source, />Clôturer</);
});

test("tableau de bord recrutement: indicateurs et accès rapides", () => {
  assert.match(source, /Nouvelles candidatures/);
  assert.match(source, /En présélection/);
  assert.match(source, /Entretiens planifiés/);
  assert.match(source, /Transmis à la DRH/);
  assert.match(source, /Pipeline de recrutement/);
  assert.match(source, /Candidatures récentes/);
  assert.match(source, /Annonces actives/);
  assert.match(source, /function renderRecruitInterviews\(/);
});

test("recrutement: transmet le candidat à la DRH sans créer employé ni contrat", () => {
  assert.match(source, /function transmitCandidateToDrh\(/);
  assert.match(source, /marquer-contractualisation/);
  assert.match(source, /Aucun employé ni contrat ne sera créé avant validation par la DRH/);
  assert.doesNotMatch(source, /onclick="openContractForCandidate\(\$\{item\.id\}\)">Recruter/);
  assert.doesNotMatch(source, /\{key:"contrat",label:"Contrat"\}/);
});


test("candidate reload retains the list and ignores an older response", async () => {
  const vm=require('node:vm');
  const wrap={dataset:{loadedTab:'new'},innerHTML:'Liste existante'};
  const pending=[];
  const state={page:1,items:[]};
  const ctx={tabState:{new:state},activeTab:'new',PAGE_SIZE:25,URLSearchParams,
    document:{getElementById:()=>wrap},window:{scrollX:0,scrollY:120},
    apiFetch:()=>new Promise(resolve=>pending.push(resolve)),
    renderTabs(){},renderCounters(){},renderPagination(){},renderList(){wrap.innerHTML=state.items[0].name},esc:String};
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('async function loadTab(tab){'),source.indexOf('function matchesSearch(')),ctx);
  const a=ctx.loadTab('new'),b=ctx.loadTab('new');
  assert.equal(wrap.innerHTML,'Liste existante');
  pending[1]({items:[{name:'Nouveau'}],total:1});await b;
  pending[0]({items:[{name:'Obsolète'}],total:1});await a;
  assert.equal(wrap.innerHTML,'Nouveau');
});

const {JSDOM}=require('jsdom');
const vm=require('node:vm');
function dashboardContext(items=[],actions=['read','create','update']){
  const dom=new JSDOM('<section id="dashboardSection"></section>');
  const ctx={document:dom.window.document,recruteSession:{user:{recruitment_access:true,authorized_actions:actions}},activeSociety:'A',recruitSection:'dashboard',URLSearchParams,Date,FormData:dom.window.FormData,
    tabState:Object.fromEntries(['new','reserve','recruited','archive'].map(key=>[key,{items:[]}])),
    apiFetch:async()=>({items,total:items.length,pages:1}),getRecruitAnnouncements:()=>[],
    esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    today:()=> '2026-10-04',formatDateFr:value=>String(value||'—'),
    candidateFullName:item=>`${item.last_name} ${item.first_name}`,candidateConvocation:item=>item.data?.derniereConvocation,
    candidateInterview:item=>item.data?.dernierEntretien,candidateIsContractPending:item=>[item.status,item.data?.statut,item.data?.status].includes('a_contractualiser'),
    showRecruitSection(section){this.recruitSection=section},switchTab(){}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('let recruitmentDashboardRequest='),source.indexOf('async function renderRecruitInterviews(')),ctx);
  return ctx;
}
const candidate=(id,status='nouvelle',data={},society='A')=>({id,status,data,society,last_name:`Test ${id}`,first_name:'Fixture',desired_position:'Agent',created_at:`2026-10-${String(id).padStart(2,'0')}`});
test('dashboard V5: zero data preserves five KPIs and all operational panels',async()=>{
  const c=dashboardContext();await c.renderRecruitDashboard(true);
  const doc=c.document;assert.equal(doc.querySelectorAll('.dashboard-kpi').length,5);
  assert.deepEqual([...doc.querySelectorAll('.dashboard-kpi strong')].map(el=>el.textContent),['0','0','0','0','0']);
  assert.equal(doc.querySelectorAll('.pipeline-column').length,6);
  assert.match(doc.body.textContent,/Aucun entretien planifié/);assert.match(doc.body.textContent,/Aucune annonce publiée/);
  assert.equal(doc.querySelector('.dashboard-sources'),null);
});
test('dashboard V5: complete pagination, mutually exclusive stages, true recruited count and recent order',async()=>{
  const items=[candidate(1),candidate(2,'nouvelle',{avisDecision:'Favorable'}),candidate(3,'nouvelle',{derniereConvocation:{date:'2099-10-05',heure:'10:00'}}),candidate(4,'nouvelle',{dernierEntretien:{valide:true}}),candidate(5,'a_contractualiser'),candidate(6,'embauche'),candidate(7,'reserve',{fichePositionValidee:true}),candidate(8,'archive')];
  const c=dashboardContext();let calls=[];c.apiFetch=async url=>{calls.push(url);const page=Number(new URLSearchParams(url.split('?')[1]).get('page'));return {items:page===1?items.slice(0,4):items.slice(4),pages:2,total:8}};
  await c.renderRecruitDashboard(true);
  assert.equal(calls.length,2);assert.ok(calls.every(url=>url.includes('society=A')));
  assert.deepEqual([...c.document.querySelectorAll('.dashboard-kpi strong')].map(el=>el.textContent),['8','1','1','1','1']);
  assert.deepEqual([...c.document.querySelectorAll('.pipeline-heading>b')].map(el=>el.textContent),['1','1','1','1','1','1']);
  assert.match(c.document.querySelector('.dashboard-recent tbody tr').textContent,/Test 8/);
  assert.equal(c.document.querySelectorAll('.dashboard-agenda-item').length,1);
});
test('dashboard V5: strict company isolation for candidates and local announcements',async()=>{
  const c=dashboardContext([candidate(1),candidate(2,'nouvelle',{},'B')]);
  c.getRecruitAnnouncements=()=>[{title:'Annonce A',society:'A',status:'Publiée'},{title:'Annonce B',society:'B',status:'Publiée'}];
  await c.renderRecruitDashboard(true);assert.match(c.document.body.textContent,/Test 1/);assert.doesNotMatch(c.document.body.textContent,/Test 2|Annonce B/);
  c.activeSociety='B';await c.renderRecruitDashboard(true);assert.match(c.document.body.textContent,/Test 2|Annonce B/);assert.doesNotMatch(c.document.body.textContent,/Test 1|Annonce A/);
});
test('dashboard V5: permissions deny by default and hide create and edit controls',async()=>{
  const c=dashboardContext([candidate(1)],['read']);await c.renderRecruitDashboard(true);
  assert.doesNotMatch(c.document.body.textContent,/Nouvelle candidature|Publier une annonce|Importer Excel/);
  assert.ok(c.document.querySelector('.pipeline-card').disabled);
  c.recruteSession.user.authorized_actions=[];await c.renderRecruitDashboard(true);assert.match(c.document.body.textContent,/Accès réservé/);
});
test('dashboard V5: API failure displays an error, not false zero statistics',async()=>{
  const c=dashboardContext();c.apiFetch=async()=>{throw new Error('Indisponible')};await c.renderRecruitDashboard(true);
  assert.match(c.document.body.textContent,/Indisponible/);assert.equal(c.document.querySelectorAll('.dashboard-kpi').length,0);
});
test('dashboard V5: ignores old company and navigation responses',async()=>{
  const c=dashboardContext();let pending=[];c.apiFetch=()=>new Promise(resolve=>pending.push(resolve));
  const a=c.renderRecruitDashboard(true);c.activeSociety='B';const b=c.renderRecruitDashboard(true);
  pending[1]({items:[candidate(2,'nouvelle',{},'B')],pages:1});await b;
  pending[0]({items:[candidate(1)],pages:1});await a;assert.match(c.document.body.textContent,/Test 2/);assert.doesNotMatch(c.document.body.textContent,/Test 1/);
  const third=c.renderRecruitDashboard(true);c.recruitSection='interviews';c.document.getElementById('dashboardSection').innerHTML='Navigation conservée';pending[2]({items:[],pages:1});await third;assert.equal(c.document.body.textContent,'Navigation conservée');
});
test('dashboard V5: sources use recorded categories only and refresh is stable',async()=>{
  const c=dashboardContext([candidate(1,'nouvelle',{source:'Canal réel'}),candidate(2)]);await c.renderRecruitDashboard(true);
  assert.match(c.document.querySelector('.dashboard-sources').textContent,/Canal réel/);
  const initial=c.document.getElementById('dashboardSection').innerHTML;await c.renderRecruitDashboard(true);assert.equal(c.document.getElementById('dashboardSection').innerHTML,initial);
});

test('dashboard destinations: read-only candidate rows expose no editing controls',()=>{
  const c=dashboardContext([],['read']);c.activeTab='new';c.avisClass=()=>'';
  vm.runInContext(source.slice(source.indexOf('function avisCell('),source.indexOf('function handleCandidateRowClick(')),c);
  const item=candidate(1,'nouvelle',{avisDecision:'Favorable'});
  assert.equal(c.rowActions(item),'—');assert.equal(c.rowActionItems(item).length,0);
  assert.doesNotMatch(c.avisCell(item),/<select/);assert.match(c.avisCell(item),/Favorable/);
});

function brandingContext(){
  const dom=new JSDOM(source,{runScripts:'outside-only'});
  const script=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]).find(script=>script.includes('const SESSION_KEY='));
  const ctx={document:dom.window.document,sessionStorage:{getItem:()=>null},localStorage:{setItem(){}},URLSearchParams};
  // Browser startup is driven explicitly to test the asynchronous session boundary.
  const realAddEventListener=ctx.document.addEventListener.bind(ctx.document);
  ctx.document.addEventListener=(name,...args)=>{if(name!=='DOMContentLoaded')realAddEventListener(name,...args)};
  vm.createContext(ctx);vm.runInContext(script,ctx);
  ctx.populateFormSocieties=()=>{};ctx.loadPositionOptions=()=>{};ctx.renderTabs=()=>{};ctx.showRecruitSection=()=>{};
  return {ctx,doc:ctx.document,setSociety:value=>{ctx.company=value;vm.runInContext('activeSociety=company;updateRecruitmentBrand()',ctx)}};
}

test('sidebar identity: official assets follow canonical society keys and unknown societies never borrow a logo',()=>{
  const {doc,setSociety}=brandingContext();const host=doc.getElementById('recruitmentBrand');
  assert.equal(host.querySelector('img'),null);assert.ok(host.classList.contains('hidden'));
  for(const value of ['IRON GLOBAL SÉCURITÉ','  iron  global securite  ']){
    setSociety(value);assert.equal(host.querySelector('img').getAttribute('src'),'/static/iron-securite-logo.png');
    assert.equal(host.textContent,'IRON GLOBAL SÉCURITÉ');assert.equal(host.dataset.societyKey,'IRON GLOBAL SECURITE');
  }
  setSociety('IRON GLOBAL SOLUTION');assert.equal(host.querySelector('img').getAttribute('src'),'/static/iron-solution-logo.png');assert.equal(host.querySelector('img').alt,'IRON GLOBAL SOLUTION');assert.equal(host.textContent,'IRON GLOBAL SOLUTION');
  setSociety('SWORD CORPORATION');assert.equal(host.querySelector('img'),null);assert.equal(host.querySelector('.sidebar-brand-initials').textContent,'SC');assert.equal(host.querySelector('span:last-child').textContent,'SWORD CORPORATION');
  setSociety('');assert.equal(host.querySelector('img'),null);assert.equal(host.querySelector('span:last-child').textContent,'Recrutement');
});

test('sidebar identity: company switches replace logo and label immediately before the existing data refresh',()=>{
  const {ctx,doc,setSociety}=brandingContext();const observed=[];
  ctx.refreshRecruitCurrentSection=()=>{observed.push({name:doc.getElementById('recruitmentBrand').textContent,src:doc.querySelector('#recruitmentBrand img').getAttribute('src')})};
  doc.getElementById('societySelect').innerHTML='<option>IRON GLOBAL SÉCURITÉ</option><option>IRON GLOBAL SOLUTION</option>';
  setSociety('IRON GLOBAL SÉCURITÉ');const original=doc.querySelector('#recruitmentBrand img');
  doc.getElementById('societySelect').value='IRON GLOBAL SOLUTION';ctx.onSocietyChange();assert.equal(original.isConnected,false);
  doc.getElementById('societySelect').value='IRON GLOBAL SÉCURITÉ';ctx.onSocietyChange();
  assert.deepEqual(observed,[{name:'IRON GLOBAL SOLUTION',src:'/static/iron-solution-logo.png'},{name:'IRON GLOBAL SÉCURITÉ',src:'/static/iron-securite-logo.png'}]);
});

test('sidebar identity: mono-company users see the right identity before the application is revealed',async()=>{
  for(const [name,logo] of [['IRON GLOBAL SÉCURITÉ','iron-securite-logo.png'],['IRON GLOBAL SOLUTION','iron-solution-logo.png']]){
    const {ctx,doc}=brandingContext();
    vm.runInContext('recruteSession={token:"qa"}',ctx);
    ctx.apiFetch=async()=>({full_name:'Test',role:'recruteur',recruitment_access:true,authorized_actions:['read'],authorized_societies:[name]});
    let onReveal;const classes=doc.getElementById('appView').classList,remove=classes.remove.bind(classes);
    classes.remove=(value)=>{if(value==='hidden')onReveal={name:doc.getElementById('recruitmentBrand').textContent,src:doc.querySelector('#recruitmentBrand img')?.getAttribute('src')};remove(value)};
    await ctx.enterApp();assert.deepEqual(onReveal,{name,src:`/static/${logo}`});assert.ok(doc.getElementById('societySelect').classList.contains('hidden'));assert.equal(doc.getElementById('societyBadge').textContent,name);
  }
});

// ── Recrutement V6 : écrans harmonisés et responsive (présentation uniquement) ───────────────
const v6Css=fs.readFileSync(path.join(__dirname,'..','app','static','recruitment-v6.css'),'utf8');
function v6Context({actions=['read','create','update','delete'],announcements=[],society='IRON GLOBAL SÉCURITÉ'}={}){
  const dom=new JSDOM(source,{runScripts:'outside-only'});
  const script=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]).find(script=>script.includes('const SESSION_KEY='));
  const store=new Map([['atlas_recruitment_announcements_v1',JSON.stringify(announcements)]]);
  const ctx={document:dom.window.document,window:{scrollX:0,scrollY:0,scrollTo(){}},URLSearchParams,FormData:dom.window.FormData,
    sessionStorage:{getItem:()=>null,setItem(){}},localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)}};
  const add=ctx.document.addEventListener.bind(ctx.document);
  ctx.document.addEventListener=(name,...args)=>{if(name!=='DOMContentLoaded')add(name,...args)};
  vm.createContext(ctx);vm.runInContext(script,ctx);
  ctx.options={actions,society};
  vm.runInContext(`recruteSession={token:'qa',user:{recruitment_access:true,authorized_actions:options.actions,authorized_societies:[options.society]}};activeSociety=options.society;`,ctx);
  const run=code=>vm.runInContext(code,ctx);
  return {ctx,doc:ctx.document,run,setItems(tab,items,total=items.length){ctx.fixture={tab,items,total};run('activeTab=fixture.tab;tabState[fixture.tab].items=fixture.items;tabState[fixture.tab].total=fixture.total;recruitSection="candidates"')}};
}
const v6Candidate=(id,data={},extra={})=>({id,last_name:`Nom${id}`,first_name:'Test',desired_position:'Agent',society:'IRON GLOBAL SÉCURITÉ',phone:'0550',email:'',status:'nouvelle',created_at:'2026-10-01',data,...extra});
const texts=nodes=>[...nodes].map(node=>node.textContent.replace(/\s+/g,' ').trim());

test('V6 shell: one shared recruitment stylesheet, loaded before the shared theme',()=>{
  const {doc}=v6Context();
  const sheets=[...doc.head.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.getAttribute('href').split('?')[0]);
  assert.deepEqual(sheets.slice(-3),['/static/recruitment-dashboard-v5.css','/static/recruitment-v6.css','/static/design-system/atlas.css']);
  assert.equal(doc.body.dataset.recruitmentUi,'v5');assert.equal(doc.body.dataset.recruitmentShell,'v6');
  const errors=[];require('css-tree').parse(v6Css,{onParseError:error=>errors.push(error.message)});assert.deepEqual(errors,[]);
  for(const component of ['.rec-page-header','.rec-filters','.rec-tabs','.rec-table','.rec-card-grid','.rec-empty-state','.rec-chips'])assert.ok(v6Css.includes(component),component);
  for(const query of ['@media(max-width:1499px)','@media(min-width:601px) and (max-width:1199px)','@media(max-width:800px)','@media(max-width:600px)','@media(max-width:480px)'])assert.ok(v6Css.includes(query),query);
  // Aucune règle dédiée à un écran quand un composant générique suffit.
  assert.doesNotMatch(v6Css,/\.(candidates|archives|reserve|recruited)-mobile/);
  // Les styles 9 px de la fiche candidat ont disparu du HTML.
  assert.doesNotMatch(source,/#candidateForm[^{]*\{[^}]*font-size:9px/);
});

test('V6 candidatures: primary action lives in the page header, never in the filter bar',()=>{
  const {doc}=v6Context();
  const header=doc.querySelector('#candidatesSection .rec-page-header');
  assert.equal(header.querySelector('h2').textContent,'Gestion des candidatures');
  assert.deepEqual(texts(header.querySelectorAll('.rec-page-actions .primary')),['+ Ajouter un candidat']);
  assert.equal(header.querySelector('#importCandidatesBtn').className.includes('secondary'),true);
  const bar=doc.querySelector('#candidatesSection .candidate-filterbar');
  assert.equal(bar.querySelector('.primary'),null);
  assert.deepEqual([...bar.children].map(el=>el.id||el.className),['search-box','positionFilter','candidateSocietyFilter','opinionFilter','filter-reset']);
  assert.equal(doc.querySelectorAll('#candidatesSection input[type="search"]').length,1);
  assert.ok(v6Css.includes('#appView[data-rec-section="candidates"] .header-search{display:none}'));
});

test('V6 candidatures: table columns, labelled cells for mobile cards and secondary line for tablets',()=>{
  const app=v6Context();app.setItems('new',[v6Candidate(1,{avisDecision:'Favorable'}),v6Candidate(2,{},{society:null,phone:''})]);
  app.run('renderCounters();renderList();renderPagination()');
  const table=app.doc.querySelector('#listWrap table.rec-table.rec-table-sortable');
  assert.deepEqual(texts(table.querySelectorAll('th')).map(value=>value.replace(/ [↕▲▼]$/,'')),['Candidat','Poste','Société','Téléphone','Statut','Date','Avis','Actions']);
  const row=table.querySelector('tbody tr');
  assert.deepEqual([...row.children].map(cell=>cell.dataset.label),['Candidat','Poste','Société','Téléphone','Statut','Date','Avis','Actions']);
  assert.deepEqual([...row.querySelectorAll('.rec-col-secondary')].map(cell=>cell.dataset.label),['Société','Téléphone','Date']);
  assert.match(row.querySelector('.rec-row-sub').textContent,/IRON GLOBAL SÉCURITÉ · 0550 · /);
  assert.deepEqual(texts(row.querySelectorAll('.rec-cell-actions button')),['Ouvrir','Convoquer','Recruter','⋮']);
  assert.match(table.querySelectorAll('tbody tr')[1].querySelector('.rec-row-sub').textContent,/^Non affecté · /);
  assert.equal(app.doc.getElementById('candidateTotal').textContent,'2 dossiers');
  assert.deepEqual(texts(app.doc.querySelectorAll('#countersRow .rec-chip-label')),['Avis','Poste']);
  assert.deepEqual(texts(app.doc.querySelectorAll('#countersRow .rec-chip-group')[0].querySelectorAll('.counter-chip')),['Tous 2','Favorable 1','Défavorable 0','Instance 0','Non évalué 1']);
});

test('V6 candidatures: compact contextual empty states respect permissions and filters',()=>{
  const app=v6Context();app.setItems('new',[]);app.run('renderCounters();renderList();renderPagination()');
  const empty=app.doc.querySelector('#listWrap .rec-empty-state');
  assert.equal(empty.querySelector('strong').textContent,'Aucune candidature');
  assert.deepEqual(texts(empty.querySelectorAll('button')),['+ Ajouter un candidat']);
  assert.equal(app.doc.getElementById('countersRow').innerHTML,'','no empty "Par poste" zone');
  assert.equal(app.doc.getElementById('pagination').innerHTML,'');
  app.run('tabState.new.q="zzz";renderList()');
  assert.equal(app.doc.querySelector('#listWrap .rec-empty-state strong').textContent,'Aucun résultat');
  assert.deepEqual(texts(app.doc.querySelectorAll('#listWrap .rec-empty-state button')),['Réinitialiser les filtres']);
  const readOnly=v6Context({actions:['read']});readOnly.setItems('new',[]);readOnly.run('renderList()');
  assert.equal(readOnly.doc.querySelector('#listWrap .rec-empty-state button'),null);
});

test('V6 réserve, recrutés, archives: same shell, own identity, existing actions only',()=>{
  const app=v6Context();app.ctx.loadTab=()=>{};
  const expected={reserve:['Réserve de talents','Réserve vide'],recruited:['Candidats recrutés','Aucun candidat recruté'],archive:['Archives','Aucune archive']};
  for(const [tab,[title,emptyTitle]] of Object.entries(expected)){
    app.setItems(tab,[]);app.run(`loadTab=()=>{};switchTab("${tab}",true);renderList()`);
    assert.equal(app.doc.getElementById('candidatePageTitle').textContent,title);
    assert.equal(app.doc.getElementById('candidatesSection').dataset.recTab,tab);
    assert.ok(app.doc.getElementById('addCandidateBtn').classList.contains('hidden'),tab);
    assert.ok(app.doc.getElementById('importCandidatesBtn').classList.contains('hidden'),tab);
    assert.equal(app.doc.querySelector('#listWrap .rec-empty-state strong').textContent,emptyTitle);
    assert.equal(app.doc.querySelector('#listWrap .rec-empty-state button'),null);
  }
  app.setItems('reserve',[v6Candidate(5,{fichePositionValideeAt:'2026-09-20T10:00:00',avisDecision:'Favorable'},{status:'reserve'})]);app.run('renderList()');
  assert.match(app.doc.querySelector('#listWrap .rec-row-note').textContent,/^En réserve depuis le /);
  assert.deepEqual([...app.run('rowActionItems(tabState.reserve.items[0]).map(a=>a.label)')],['Ouvrir','Convoquer','Recruter','Marquer prêt pour contrat']);
  app.setItems('recruited',[v6Candidate(6,{},{status:'embauche'}),v6Candidate(7,{},{status:'a_contractualiser'})]);app.run('renderList()');
  assert.deepEqual(texts(app.doc.querySelectorAll('#listWrap td[data-label="Statut"]')),['Recruté','Transmis à la DRH']);
  assert.deepEqual(texts(app.doc.querySelectorAll('#listWrap .rec-cell-actions button')),['Ouvrir','⋮','Ouvrir','⋮']);
  app.setItems('archive',[v6Candidate(8,{avisDecision:'Défavorable'})]);app.run('renderList()');
  assert.equal(app.doc.querySelector('#listWrap td[data-label="Avis"] select'),null);
  app.run('loadTab=()=>{};switchTab("new",true)');
  assert.equal(app.doc.getElementById('candidatePageTitle').textContent,'Gestion des candidatures');
  assert.equal(app.doc.getElementById('importCandidatesBtn').classList.contains('hidden'),false);
});

test('V6 entretiens: counters double as filters, date and time lead each row, empty state stays compact',async()=>{
  const items=[v6Candidate(1,{derniereConvocation:{date:'2026-11-03',heure:'10:00',lieu:'Siège'}}),
    v6Candidate(2,{derniereConvocation:{date:'2026-11-02',heure:'09:00'},dernierEntretien:{date:'2026-11-02',moyenne:7.5,bareme:10,recruteur:'R'},avisDecision:'Instance'}),
    v6Candidate(3,{dernierEntretien:{date:'2026-10-01',moyenne:8,bareme:10,valide:true,recruteur:'R'},avisDecision:'Favorable'}),v6Candidate(4)];
  const app=v6Context();app.setItems('new',items);app.run('recruitSection="interviews"');
  await app.ctx.renderRecruitInterviews(false);
  const host=app.doc.getElementById('interviewsSection');
  assert.equal(host.querySelector('.rec-page-header h2').textContent,'Entretiens');
  assert.equal(host.querySelector('.rec-count').textContent,'3 entretiens');
  assert.deepEqual(texts(host.querySelectorAll('.counter-chip')),['Tous 3','Planifiés 1','Brouillons 1','Validés 1']);
  assert.deepEqual(texts(host.querySelectorAll('thead th')),['Date et heure','Candidat','Poste','Lieu','État','Note','Avis','Recruteur','Action']);
  assert.deepEqual([...host.querySelector('tbody tr').children].map(cell=>cell.dataset.label),['Date et heure','Candidat','Poste','Lieu','État','Note','Avis','Recruteur','Action']);
  assert.deepEqual(texts(host.querySelectorAll('tbody .rec-cell-main .cand-name')),['Nom3 Test','Nom2 Test','Nom1 Test']);
  assert.deepEqual(texts(host.querySelectorAll('tbody td[data-label="État"]')),['Validé','Brouillon','Planifié']);
  assert.deepEqual(texts(host.querySelectorAll('tbody .rec-cell-actions button')),['Consulter','Continuer','Démarrer']);
  app.run('setInterviewFilter("planned")');
  assert.deepEqual(texts(host.querySelectorAll('tbody .cand-name')),['Nom1 Test']);
  assert.equal(host.querySelector('.counter-chip.active').textContent.trim(),'Planifiés 1');
  const readOnly=v6Context({actions:['read']});readOnly.setItems('new',items);readOnly.run('recruitSection="interviews"');
  await readOnly.ctx.renderRecruitInterviews(false);
  assert.equal(readOnly.doc.querySelector('#interviewsSection .rec-cell-actions'),null);
  const empty=v6Context();empty.setItems('new',[]);empty.run('recruitSection="interviews"');
  await empty.ctx.renderRecruitInterviews(false);
  assert.equal(empty.doc.querySelector('#interviewsSection .rec-empty-state strong').textContent,'Aucun entretien');
  assert.equal(empty.doc.querySelector('#interviewsSection table'),null);
});

test('V6 entretiens: API failure renders the shared error component with a retry, late answers are ignored',async()=>{
  const app=v6Context();app.run('recruitSection="interviews"');
  app.ctx.apiFetch=async()=>{throw new Error('Panne <b>API</b>')};
  await app.ctx.renderRecruitInterviews(true);
  const host=app.doc.getElementById('interviewsSection');
  assert.equal(host.querySelector('.rec-error-state').getAttribute('role'),'alert');
  assert.match(host.querySelector('.rec-error-state p').innerHTML,/Panne &lt;b&gt;API&lt;\/b&gt;/);
  assert.equal(host.querySelector('.rec-error-state button').getAttribute('onclick'),'renderRecruitInterviews(true)');
  assert.equal(host.querySelector('.rec-page-header h2').textContent,'Entretiens');
  let release;app.ctx.apiFetch=()=>new Promise(resolve=>{release=resolve});
  const pending=app.ctx.renderRecruitInterviews(true);const before=host.innerHTML;
  app.run('activeSociety="IRON GLOBAL SOLUTION"');release({items:[v6Candidate(9,{derniereConvocation:{date:'2026-11-01'}})],pages:1});await pending;
  assert.equal(host.innerHTML,before,'a response for the previous company never repaints the screen');
});

test('V6 annonces: card grid with real fields only, actions follow permissions, compact empty state',()=>{
  const announcements=[{id:'A1',title:'Chef de poste',society:'IRON GLOBAL SÉCURITÉ',location:'Alger',positions:2,publishedAt:'2026-10-01',deadline:'2026-11-01',status:'Publiée',reference:'REC-1'},
    {id:'A2',title:'Agent',society:'IRON GLOBAL SÉCURITÉ',positions:1,status:'Clôturée'},{id:'A3',title:'Autre société',society:'IRON GLOBAL SOLUTION',positions:1,status:'Brouillon'}];
  const app=v6Context({announcements});app.run('recruitSection="announcements";renderRecruitAnnouncements()');
  const host=app.doc.getElementById('announcementsSection');
  assert.equal(host.querySelector('.rec-page-header h2').textContent,'Annonces recrutement');
  assert.deepEqual(texts(host.querySelectorAll('.rec-page-actions .primary')),['+ Nouvelle annonce']);
  assert.equal(host.querySelector('.rec-count').textContent,'2 annonces');
  const cards=host.querySelectorAll('#announcementList.rec-card-grid article.rec-card');
  assert.equal(cards.length,2);
  assert.deepEqual(texts(cards[0].querySelectorAll('dt')),['Lieu','Postes','Publication','Date limite','Référence']);
  assert.deepEqual(texts(cards[1].querySelectorAll('dt')),['Lieu','Postes','Publication','Date limite']);
  assert.doesNotMatch(host.textContent,/candidature\(s\)|candidatures reçues/i,'no candidate counter is invented');
  assert.deepEqual(texts(cards[0].querySelectorAll('footer button')),['Publier / Partager','Modifier','Clôturer','Supprimer']);
  assert.deepEqual(texts(cards[1].querySelectorAll('footer button')),['Publier / Partager','Modifier','Supprimer']);
  assert.equal(host.querySelectorAll('article .primary').length,0,'one primary action per page');
  app.doc.getElementById('announcementSearch').value='introuvable';app.run('filterRecruitAnnouncements()');
  assert.equal(host.querySelector('#announcementList .rec-empty-state strong').textContent,'Aucun résultat');
  app.run('openAnnouncementForm("A1")');
  assert.equal(host.querySelector('#announcementForm [name="title"]').value,'Chef de poste');
  for(const field of host.querySelectorAll('#announcementForm input:not([type="hidden"]),#announcementForm select,#announcementForm textarea'))assert.ok(host.querySelector(`label[for="${field.id}"]`),field.name);
  assert.deepEqual(texts(host.querySelectorAll('#announcementForm .modal-actions button')),['Annuler','Enregistrer l’annonce']);
  const readOnly=v6Context({announcements,actions:['read']});readOnly.run('renderRecruitAnnouncements()');
  assert.equal(readOnly.doc.querySelector('#announcementsSection button'),null);
  const empty=v6Context({actions:['read','create']});empty.run('renderRecruitAnnouncements()');
  assert.equal(empty.doc.querySelector('#announcementList .rec-empty-state strong').textContent,'Aucune annonce');
  assert.deepEqual(texts(empty.doc.querySelectorAll('#announcementList .rec-empty-state button')),['+ Nouvelle annonce']);
});

test('V6 formulaires et modales: labelled experience fields, sticky header/footer, no decorative emoji in the interface',()=>{
  const app=v6Context();app.run('setExperienceRows([{societe:"ACME",du:"2020-01-01",au:"2021-01-01",poste:"Agent",motif:"Fin de contrat"}])');
  const row=app.doc.querySelector('#experienceRows .exp-row');
  assert.deepEqual(texts(row.querySelectorAll('.exp-field span')),['Société','Poste','Du','Au','Motif de départ']);
  assert.deepEqual(app.run('JSON.stringify(collectExperienceRows())'),JSON.stringify([{societe:'ACME',du:'2020-01-01',au:'2021-01-01',poste:'Agent',motif:'Fin de contrat'}]));
  assert.equal(app.doc.querySelector('.exp-head'),null);
  assert.match(v6Css,/\.modal-head\{position:sticky;top:0/);assert.match(v6Css,/\.modal \.modal-actions\{position:sticky;bottom:0/);
  assert.match(v6Css,/\.modal\{width:calc\(100vw - 24px\)!important/);
  const ui=source.replace(/function recruitAnnouncementShareText[\s\S]*?\n\}/,'');
  assert.doesNotMatch(ui,/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u);
});

test('V6 société active: switching company refreshes brand, counters and lists without reloading the page',()=>{
  const app=v6Context();const calls=[];
  app.doc.getElementById('societySelect').innerHTML='<option>IRON GLOBAL SÉCURITÉ</option><option>IRON GLOBAL SOLUTION</option>';
  app.setItems('new',[v6Candidate(1)]);app.run('tabState.new.societyFilter="IRON GLOBAL SÉCURITÉ";tabState.new.page=3');
  app.ctx.loadTab=tab=>calls.push(tab);app.ctx.options={calls};
  app.run('loadTab=tab=>options.calls.push(tab)');
  app.doc.getElementById('societySelect').value='IRON GLOBAL SOLUTION';app.run('onSocietyChange()');
  assert.equal(app.doc.querySelector('#recruitmentBrand img').getAttribute('src'),'/static/iron-solution-logo.png');
  assert.equal(app.doc.getElementById('recruitmentBrand').textContent,'IRON GLOBAL SOLUTION');
  assert.deepEqual([...app.run('[tabState.new.items.length,tabState.new.page,tabState.new.societyFilter]')],[0,1,'IRON GLOBAL SOLUTION']);
  assert.deepEqual(calls,['new']);
});
