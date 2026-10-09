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
  assert.match(source, />Partager</);
  assert.match(source, />Clôturer</);
  // Les annonces vivent sur le serveur : plus aucune écriture locale.
  assert.match(source, /const ANNOUNCEMENT_API="\/api\/drh\/job-offers"/);
  assert.doesNotMatch(source, /localStorage\.setItem\(RECRUIT_ANNOUNCEMENTS_KEY/);
  assert.doesNotMatch(source, /Annonces enregistrées sur ce navigateur/);
});

test("tableau de bord recrutement: indicateurs et accès rapides", () => {
  assert.match(source, /Nouvelles candidatures/);
  assert.match(source, /En présélection/);
  assert.match(source, /Entretiens planifiés/);
  assert.match(source, /Transférés DRH ce mois/);
  assert.match(source, /Pipeline de recrutement/);
  assert.match(source, /Candidatures récentes/);
  assert.match(source, /Annonces actives/);
  assert.match(source, /function renderRecruitInterviews\(/);
});

test("recrutement: transmet le candidat à la DRH sans créer employé ni contrat", () => {
  assert.match(source, /function transmitCandidateToDrh\(/);
  assert.match(source, /\/transfer-drh/);
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
  vm.createContext(ctx);
  // Helpers de portefeuille V7 (réels) puis le renderer du tableau de bord.
  vm.runInContext(source.slice(source.indexOf('function recruitmentSocietyKey('),source.indexOf('function updateRecruitmentBrand(')),ctx);
  vm.runInContext(source.slice(source.indexOf('const PORTFOLIO_UNASSIGNED='),source.indexOf('function recruitmentCanVentilate(')),ctx);
  vm.runInContext(source.slice(source.indexOf('let recruitmentDashboardRequest='),source.indexOf('async function renderRecruitInterviews(')),ctx);
  return ctx;
}
const candidate=(id,status='nouvelle',data={},society='A')=>({id,status,data,society,last_name:`Test ${id}`,first_name:'Fixture',desired_position:'Agent',created_at:`2026-10-${String(id).padStart(2,'0')}`});
test('dashboard V5: zero data preserves five KPIs and all operational panels',async()=>{
  const c=dashboardContext();await c.renderRecruitDashboard(true);
  const doc=c.document;assert.equal(doc.querySelectorAll('.dashboard-kpi').length,5);
  assert.deepEqual([...doc.querySelectorAll('.dashboard-kpi strong')].map(el=>el.textContent),['0','0','0','0','0']);
  assert.equal(doc.querySelectorAll('.pipeline-column').length,5);
  assert.deepEqual([...doc.querySelectorAll('.pipeline-heading>span')].map(el=>el.textContent),['Nouvelles','Présélection','Convoqués','Entretiens','Réserve']);
  assert.deepEqual([...doc.querySelectorAll('.dashboard-kpi span')].map(el=>el.textContent),['Candidatures totales','En présélection','Entretiens planifiés','En réserve','Transférés DRH ce mois']);
  assert.match(doc.body.textContent,/Aucun entretien planifié/);assert.match(doc.body.textContent,/Aucune annonce publiée/);
  assert.equal(doc.querySelector('.dashboard-sources'),null);
});
test('dashboard V7: complete pagination, exclusive active stages, transferred files are a monthly statistic and never listed',async()=>{
  const items=[candidate(1),candidate(2,'nouvelle',{avisDecision:'Favorable'}),candidate(3,'nouvelle',{derniereConvocation:{date:'2099-10-05',heure:'10:00'}}),candidate(4,'nouvelle',{dernierEntretien:{valide:true}}),candidate(5,'a_contractualiser'),candidate(6,'embauche'),candidate(7,'reserve',{fichePositionValidee:true}),candidate(8,'archive')];
  const c=dashboardContext();let calls=[];c.apiFetch=async url=>{calls.push(url);if(url.includes('recruitment-stats'))return {transferred_this_month:4};const page=Number(new URLSearchParams(url.split('?')[1]).get('page'));return {items:page===1?items.slice(0,4):items.slice(4),pages:2,total:8}};
  await c.renderRecruitDashboard(true);
  const pages=calls.filter(url=>url.includes('/candidates/page'));
  assert.equal(pages.length,2);assert.ok(pages.every(url=>url.includes('society=A')&&url.includes('mode=pool')));
  assert.deepEqual(calls.filter(url=>url.includes('recruitment-stats')),['/api/drh/candidates/recruitment-stats?society=A']);
  // Dossiers 5 (transmis) et 6 (recruté) : jamais comptés ni listés, même si une réponse les contenait.
  assert.deepEqual([...c.document.querySelectorAll('.dashboard-kpi strong')].map(el=>el.textContent),['6','1','1','1','4']);
  assert.deepEqual([...c.document.querySelectorAll('.pipeline-heading>b')].map(el=>el.textContent),['1','1','1','1','1']);
  assert.doesNotMatch(c.document.body.textContent,/Test 5|Test 6|Recrutés|Transmis à la DRH/);
  const transferred=c.document.querySelectorAll('.dashboard-kpi')[4];
  assert.equal(transferred.tagName,'DIV','historical statistic, not a link to a list');assert.equal(transferred.getAttribute('onclick'),null);
  assert.deepEqual([...c.tabState.new.items,...c.tabState.reserve.items,...c.tabState.archive.items].map(item=>item.id).sort(),[1,2,3,4,7,8]);
  assert.match(c.document.querySelector('.dashboard-recent tbody tr').textContent,/Test 8/);
  assert.equal(c.document.querySelectorAll('.dashboard-agenda-item').length,1);
});
test('dashboard V5: strict company isolation for candidates and announcements',async()=>{
  const c=dashboardContext([candidate(1),candidate(2,'nouvelle',{},'B')]);
  c.getRecruitAnnouncements=()=>[{title:'Annonce A',society:'A',effective_status:'published'},{title:'Annonce B',society:'B',effective_status:'published'},{title:'Brouillon A',society:'A',effective_status:'draft'},{title:'Expirée B',society:'B',effective_status:'expired'}];
  await c.renderRecruitDashboard(true);assert.match(c.document.body.textContent,/Test 1/);assert.doesNotMatch(c.document.body.textContent,/Test 2|Annonce B|Brouillon A|Expirée B/);
  c.activeSociety='B';await c.renderRecruitDashboard(true);assert.match(c.document.body.textContent,/Test 2|Annonce B/);assert.doesNotMatch(c.document.body.textContent,/Test 1|Annonce A/);
});
test('dashboard V7: portfolio filter — all files, unventilated files, one company',async()=>{
  const items=[candidate(1),candidate(2,'nouvelle',{},'B'),candidate(3,'nouvelle',{},null)];
  const c=dashboardContext(items);c.getRecruitAnnouncements=()=>[{title:'Annonce A',society:'A',effective_status:'published'},{title:'Annonce B',society:'B',effective_status:'published'},{title:'Brouillon A',society:'A',effective_status:'draft'},{title:'Expirée B',society:'B',effective_status:'expired'}];
  const urls=[];const fetch=c.apiFetch;c.apiFetch=async url=>{urls.push(url);return fetch(url)};
  c.activeSociety='';await c.renderRecruitDashboard(true);
  assert.match(c.document.body.textContent,/Test 1/);assert.match(c.document.body.textContent,/Test 2/);assert.match(c.document.body.textContent,/Test 3/);
  assert.match(c.document.body.textContent,/Annonce A/);assert.match(c.document.body.textContent,/Annonce B/);
  assert.ok(urls.every(url=>!url.includes('society=')));
  c.activeSociety='__unassigned__';await c.renderRecruitDashboard(true);
  assert.match(c.document.body.textContent,/Test 3/);assert.doesNotMatch(c.document.body.textContent,/Test 1|Test 2/);
  assert.ok(urls.at(-1).includes('society=__unassigned__'));
  assert.equal(c.document.querySelector('.dashboard-kpi strong').textContent,'1');
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
  const c=dashboardContext();let pending=[];c.apiFetch=url=>url.includes('recruitment-stats')?Promise.resolve({transferred_this_month:0}):new Promise(resolve=>pending.push(resolve));
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
  // Portefeuille « Tous » ou « Non ventilés » : identité texte neutre, aucun logo emprunté ni inventé.
  for(const portfolio of ['','__unassigned__']){
    setSociety(portfolio);assert.equal(host.querySelector('img'),null);assert.equal(host.querySelector('span:last-child').textContent,'RECRUTEMENT GROUPE');
    assert.equal(host.querySelector('.sidebar-brand-initials').textContent,'RG');assert.equal(host.dataset.societyKey,'');
  }
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
    await ctx.enterApp();assert.deepEqual(onReveal,{name,src:`/static/${logo}`});
    // V7 : le sélecteur est un filtre de portefeuille, toujours disponible, positionné sur la société du compte.
    const select=doc.getElementById('societySelect');assert.equal(select.classList.contains('hidden'),false);assert.equal(select.value,name);
    assert.deepEqual([...select.options].map(option=>[option.value,option.textContent]),[['','Tous les dossiers'],['__unassigned__','Non ventilés'],[name,name]]);
    assert.ok(doc.getElementById('societyBadge').classList.contains('hidden'));
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
  assert.deepEqual([...bar.children].map(el=>el.id||el.className),['search-box','positionFilter','opinionFilter','filter-reset']);
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
  assert.match(table.querySelectorAll('tbody tr')[1].querySelector('.rec-row-sub').textContent,/^Non ventilé · /);
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

test('V6/V7 réserve et archives: same shell, own identity, existing actions only — no recruited stock',()=>{
  const app=v6Context();app.ctx.loadTab=()=>{};
  // V7 : « Candidats recrutés » n'est plus un stock de recrute.irongs.com (ni onglet, ni entrée de navigation).
  assert.equal(app.doc.querySelector('.recruit-nav-btn[data-section="recruited"]'),null);
  assert.deepEqual([...app.run('TABS.map(tab=>tab.key)')],['new','reserve','archive']);
  assert.equal(app.run('typeof tabState.recruited'),'undefined');
  assert.doesNotMatch(source,/Candidats recrutés/);
  const expected={reserve:['Réserve de talents','Réserve vide'],archive:['Archives','Aucune archive']};
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
  assert.deepEqual([...app.run('rowActionItems(tabState.reserve.items[0]).map(a=>a.label)')],['Ouvrir','Convoquer','Recruter']);
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

const v6Offer=(id,extra={})=>({id,title:`Annonce ${id}`,society:'IRON GLOBAL SÉCURITÉ',company:{name:'IRON GLOBAL SÉCURITÉ'},profession:'Sécurité',wilaya:'Alger',location:'Hydra',contract_type:'CDI',positions:2,
  missions:'Surveiller',profile:'Rigueur',description:'',reference:'',deadline:'2026-11-01',published_at:'2026-10-01T08:00:00',status:'published',effective_status:'published',applications:0,...extra});
function v6Announcements(items,options={}){
  const app=v6Context(options);app.ctx.fixture=items;
  app.run('recruitAnnouncements=fixture;recruitAnnouncementLoaded=true;recruitAnnouncementMeta={societies:["IRON GLOBAL SÉCURITÉ","IRON GLOBAL SOLUTION"],contract_types:["CDI","CDD"],logos:[]};recruitSection="announcements"');
  return app;
}
test('V6 annonces: server-backed cards, real counters, actions follow status and permissions',()=>{
  const offers=[v6Offer(1,{title:'Chef de poste',reference:'REC-1',applications:3}),v6Offer(2,{title:'Agent',status:'closed',effective_status:'closed'}),
    v6Offer(3,{title:'Brouillon',status:'draft',effective_status:'draft',published_at:null}),v6Offer(4,{title:'Autre société',society:'IRON GLOBAL SOLUTION'}),
    v6Offer(5,{title:'Dépassée',effective_status:'expired'})];
  const app=v6Announcements(offers);app.run('renderRecruitAnnouncements()');
  const host=app.doc.getElementById('announcementsSection');
  assert.equal(host.querySelector('.rec-page-header h2').textContent,'Annonces recrutement');
  assert.deepEqual(texts(host.querySelectorAll('.rec-page-actions .primary')),['+ Nouvelle annonce']);
  assert.equal(host.querySelector('.rec-count').textContent,'4 annonces','the active company only');
  const cards=host.querySelectorAll('#announcementList.rec-card-grid article.rec-card');
  assert.equal(cards.length,4);
  assert.deepEqual(texts(cards[0].querySelectorAll('dt')),['Lieu','Contrat','Postes','Candidatures','Publication','Date limite','Référence']);
  assert.deepEqual(texts(cards[1].querySelectorAll('dt')),['Lieu','Contrat','Postes','Candidatures','Publication','Date limite']);
  assert.deepEqual(texts(host.querySelectorAll('article .pill')),['Publiée','Clôturée','Brouillon','Expirée']);
  assert.deepEqual(texts(cards[0].querySelectorAll('footer button')),['Candidatures (3)','Partager','Modifier','Clôturer']);
  assert.deepEqual(texts(cards[1].querySelectorAll('footer button')),['Candidatures (0)','Republier','Modifier'],'a closed offer is never deleted');
  assert.deepEqual(texts(cards[2].querySelectorAll('footer button')),['Candidatures (0)','Publier','Modifier','Supprimer'],'only an empty draft can be deleted');
  assert.deepEqual(texts(cards[3].querySelectorAll('footer button')),['Candidatures (0)','Republier','Modifier','Clôturer']);
  assert.equal(host.querySelectorAll('article .primary').length,0,'one primary action per page');
  assert.match(host.querySelector('.rec-note').textContent,/IRON Emploi/);assert.doesNotMatch(host.textContent,/sur ce navigateur/);
  app.doc.getElementById('announcementSearch').value='introuvable';app.run('filterRecruitAnnouncements()');
  assert.equal(host.querySelector('#announcementList .rec-empty-state strong').textContent,'Aucun résultat');
  app.doc.getElementById('announcementSearch').value='';app.doc.getElementById('announcementStatus').value='draft';app.run('filterRecruitAnnouncements()');
  assert.deepEqual(texts(host.querySelectorAll('article h3')),['Brouillon']);
  app.run('openAnnouncementForm(1)');
  assert.equal(host.querySelector('#announcementForm [name="title"]').value,'Chef de poste');
  assert.ok(host.querySelector('#annSociety').disabled,'the company is locked once applications exist');
  assert.equal(host.querySelector('#announcementForm input[type="hidden"][name="society"]').value,'IRON GLOBAL SÉCURITÉ');
  for(const field of host.querySelectorAll('#announcementForm input:not([type="hidden"]),#announcementForm select,#announcementForm textarea'))assert.ok(host.querySelector(`label[for="${field.id}"]`),field.name);
  assert.deepEqual(texts(host.querySelectorAll('#announcementForm .modal-actions button')),['Annuler','Enregistrer l’annonce']);
  const readOnly=v6Announcements(offers,{actions:['read']});readOnly.run('renderRecruitAnnouncements()');
  assert.deepEqual([...new Set(texts(readOnly.doc.querySelectorAll('#announcementsSection button')).map(text=>text.replace(/\d+/,'n')))],['Candidatures (n)']);
  const empty=v6Announcements([],{actions:['read','create']});empty.run('renderRecruitAnnouncements()');
  assert.equal(empty.doc.querySelector('#announcementList .rec-empty-state strong').textContent,'Aucune annonce');
  assert.deepEqual(texts(empty.doc.querySelectorAll('#announcementList .rec-empty-state button')),['+ Nouvelle annonce']);
});

test('V6 annonces: every write goes to the server and a failed load never shows stale or local data',async()=>{
  const app=v6Announcements([v6Offer(1,{status:'draft',effective_status:'draft',published_at:null})]);const calls=[];
  app.ctx.confirm=()=>true;app.ctx.showBanner=()=>{};
  app.ctx.apiFetch=async(url,options={})=>{calls.push([options.method||'GET',url,options.body?JSON.parse(options.body):null]);
    if(url.endsWith('/publish'))return v6Offer(1);if(url.endsWith('/close'))return v6Offer(1,{status:'closed',effective_status:'closed'});
    if(url.endsWith('/applications'))return {offer:v6Offer(1,{applications:1}),items:[{application_id:9,applied_at:'2026-10-02T09:00:00',candidate:{id:4,first_name:'Nadia',last_name:'TEST',phone:'+213551122334',has_cv:true},state:{code:'received',label:'Reçue'},dossier_state:{code:'review',label:'En cours d’étude'}}]};
    if(options.method==='POST')return v6Offer(2,{title:'Cariste',status:'draft',effective_status:'draft',published_at:null});
    throw new Error('Panne réseau')};
  const host=app.doc.getElementById('announcementsSection');
  await app.run('setAnnouncementStatus(1,"publish")');
  assert.deepEqual(calls.at(-1).slice(0,2),['POST','/api/drh/job-offers/1/publish']);assert.deepEqual(texts(host.querySelectorAll('article .pill')),['Publiée']);
  await app.run('setAnnouncementStatus(1,"close")');
  assert.deepEqual(calls.at(-1).slice(0,2),['POST','/api/drh/job-offers/1/close']);assert.deepEqual(texts(host.querySelectorAll('article .pill')),['Clôturée']);
  app.run('openAnnouncementForm()');
  const form=host.querySelector('#announcementForm');form.querySelector('[name="title"]').value='Cariste';form.querySelector('[name="society"]').value='IRON GLOBAL SÉCURITÉ';form.querySelector('[name="wilaya"]').value='Oran';
  app.ctx.form=form;await app.run('saveRecruitAnnouncement(form)');
  assert.deepEqual(calls.at(-1).slice(0,2),['POST','/api/drh/job-offers']);
  assert.deepEqual({title:calls.at(-1)[2].title,society:calls.at(-1)[2].society,wilaya:calls.at(-1)[2].wilaya,deadline:calls.at(-1)[2].deadline},{title:'Cariste',society:'IRON GLOBAL SÉCURITÉ',wilaya:'Oran',deadline:null});
  assert.deepEqual(texts(host.querySelectorAll('article h3')),['Cariste','Annonce 1']);
  await app.run('openAnnouncementApplications(1)');
  assert.match(host.textContent,/Candidatures — Annonce 1/);assert.match(host.textContent,/TEST Nadia/);assert.match(host.textContent,/Reçue/);assert.match(host.textContent,/En cours d’étude/);
  // Chargement en échec : état d'erreur avec « Réessayer », jamais la liste précédente.
  await app.run('refreshRecruitAnnouncements()');
  assert.equal(host.querySelector('.rec-error-state strong').textContent,'Données indisponibles');assert.match(host.textContent,/Panne réseau/);
  assert.equal(host.querySelector('article'),null);assert.deepEqual(texts(host.querySelectorAll('button')),['Réessayer']);
});

test('V6 annonces: each application to an offer has its own state, set by the recruiter and saved on the server',async()=>{
  const states=[['received','Reçue'],['shortlisted','Présélectionnée'],['interview','Entretien'],['accepted','Retenue'],['declined','Non retenue']].map(([code,label])=>({code,label}));
  const item=(id,name,code,label)=>({application_id:id,applied_at:'2026-10-02T09:00:00',candidate:{id,first_name:name,last_name:'TEST',phone:'+21355112233'+id,has_cv:id===9},state:{code,label},dossier_state:{code:'review',label:'En cours d’étude'}});
  const build=actions=>{const app=v6Announcements([v6Offer(1,{applications:2})],{actions});app.ctx.states=states;app.run('recruitAnnouncementMeta.application_states=states');app.ctx.showBanner=()=>{};return app};
  const app=build(['read','update']);const calls=[];let fail=false;
  app.ctx.apiFetch=async(url,options={})=>{calls.push([options.method||'GET',url,options.body?JSON.parse(options.body):null]);
    if(url.endsWith('/applications'))return {offer:v6Offer(1,{applications:2}),items:[item(9,'Nadia','received','Reçue'),item(8,'Karim','interview','Entretien')]};
    if(fail)throw new Error('Refusé par le serveur');
    return {...item(9,'Nadia','declined','Non retenue'),state:{code:'declined',label:'Non retenue'}}};
  const host=app.doc.getElementById('announcementsSection');
  await app.run('openAnnouncementApplications(1)');
  assert.deepEqual(texts(host.querySelectorAll('thead th')),['Candidat','Téléphone','Reçue le','CV','État de la candidature','État du dossier']);
  const selects=()=>[...host.querySelectorAll('select.rec-state-select')];
  assert.deepEqual(selects().map(select=>select.value),['received','interview'],'one independent state per application');
  assert.deepEqual(texts(selects()[0].options),states.map(state=>state.label));
  assert.ok(selects().every(select=>/État de la candidature de TEST/.test(select.getAttribute('aria-label'))));
  assert.deepEqual(texts(host.querySelectorAll('tbody td:last-child .pill')),['En cours d’étude','En cours d’étude'],'the dossier state is shown apart');
  selects()[0].value='declined';app.ctx.select=selects()[0];await app.run('setApplicationStatus(1,9,select)');
  assert.deepEqual(calls.at(-1),['PUT','/api/drh/job-offers/1/applications/9/status',{status:'declined'}]);
  assert.deepEqual(selects().map(select=>select.value),['declined','interview'],'the other application is untouched');
  // Refus du serveur : la liste revient à l'état réellement enregistré.
  fail=true;selects()[1].value='accepted';app.ctx.select=selects()[1];await app.run('setApplicationStatus(1,8,select)');
  assert.deepEqual(selects().map(select=>select.value),['declined','interview']);
  const readOnly=build(['read']);readOnly.ctx.apiFetch=app.ctx.apiFetch;fail=false;await readOnly.run('openAnnouncementApplications(1)');
  const view=readOnly.doc.getElementById('announcementsSection');
  assert.equal(view.querySelector('select'),null,'read-only accounts see the state, they cannot change it');
  assert.deepEqual(texts(view.querySelectorAll('tbody td:nth-child(5) .pill')),['Reçue','Entretien']);
});

test('V6 annonces: announcements kept in the browser by the previous version are only offered for import as drafts',async()=>{
  const legacy=[{id:'ANN-1',title:'Ancienne annonce',society:'IRON GLOBAL SÉCURITÉ',location:'Alger',positions:2,status:'Publiée',deadline:'2026-12-01'},{id:'ANN-2',title:'Hors périmètre',society:'AUTRE',status:'Publiée'}];
  const app=v6Announcements([],{announcements:legacy});const posted=[];app.ctx.confirm=()=>true;app.ctx.showBanner=()=>{};
  app.ctx.apiFetch=async(url,options)=>{posted.push(JSON.parse(options.body));return v6Offer(7,{title:posted.at(-1).title,status:'draft',effective_status:'draft',published_at:null})};
  app.run('renderRecruitAnnouncements()');
  const host=app.doc.getElementById('announcementsSection');
  assert.equal(host.querySelector('article'),null,'never listed as if it were published');
  assert.match(host.querySelector('.rec-note button').textContent,/Importer 1 annonce/);
  await app.run('importLegacyRecruitAnnouncements()');
  assert.deepEqual(posted.map(row=>[row.title,row.society,row.location,row.positions,row.deadline]),[['Ancienne annonce','IRON GLOBAL SÉCURITÉ','Alger',2,'2026-12-01']]);
  assert.deepEqual(texts(host.querySelectorAll('article .pill')),['Brouillon']);
  assert.equal(app.ctx.localStorage.getItem('atlas_recruitment_announcements_v1'),null);assert.equal(host.querySelector('.rec-note button'),null);
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

// ── Recrutement Groupe V7 : vivier central, portefeuille, société destinataire ───────────────
test('V7 portefeuille: the selector is a portfolio filter over the group pool, fed by the server',async()=>{
  const app=v6Context();const {ctx,doc}=app;const urls=[];
  ctx.apiFetch=async url=>{urls.push(url);
    if(url==='/api/auth/me')return {full_name:'Admin',role:'admin',recruitment_access:true,recruitment_ventilation:true,authorized_actions:['read','create','update'],authorized_societies:[]};
    if(url.includes('ventilation-targets'))return {can_ventilate:true,societies:['IRON GLOBAL SÉCURITÉ','IRON GLOBAL SOLUTION'],portfolios:['IRON GLOBAL SÉCURITÉ','IRON GLOBAL SOLUTION']};
    return {items:[],total:0,pages:1,page:1}};
  ctx.loadPositionOptions=()=>{};app.run('loadPositionOptions=()=>{};recruitSection="candidates"');
  await ctx.enterApp();await new Promise(resolve=>setTimeout(resolve,0));
  const select=doc.getElementById('societySelect');
  // Compte sans périmètre explicite : tout le vivier Groupe par défaut, identité neutre.
  assert.equal(select.value,'');assert.equal(select.getAttribute('aria-label'),'Portefeuille de recrutement');
  assert.deepEqual([...select.options].map(option=>option.textContent),['Tous les dossiers','Non ventilés','IRON GLOBAL SÉCURITÉ','IRON GLOBAL SOLUTION']);
  assert.equal(doc.getElementById('recruitmentBrand').textContent,'RGRECRUTEMENT GROUPE');assert.equal(doc.querySelector('#recruitmentBrand img'),null);
  assert.doesNotMatch(source,/SWORD CORPORATION/,'no hard-coded company list');
  const pages=()=>urls.filter(url=>url.includes('/candidates/page'));
  assert.ok(pages().length&&pages().every(url=>!url.includes('society=')));
  select.value='__unassigned__';app.run('onSocietyChange()');await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(pages().at(-1),/society=__unassigned__/);
  assert.equal(doc.getElementById('recruitmentBrand').textContent,'RGRECRUTEMENT GROUPE');
  assert.deepEqual([...app.run('[tabState.new.societyFilter,tabState.reserve.societyFilter,tabState.archive.societyFilter]')],['__unassigned__','__unassigned__','__unassigned__']);
  select.value='IRON GLOBAL SOLUTION';app.run('onSocietyChange()');await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(pages().at(-1),/society=IRON\+GLOBAL\+SOLUTION/);
  assert.equal(doc.querySelector('#recruitmentBrand img').getAttribute('src'),'/static/iron-solution-logo.png');
  // Réinitialiser les filtres de liste ne quitte pas le portefeuille choisi.
  app.run('resetCandidateFilters()');await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(pages().at(-1),/society=IRON\+GLOBAL\+SOLUTION/);
  assert.equal(doc.getElementById('candidateSocietyFilter'),null,'one company control only: the portfolio filter');
});

test('V7 liste et fiche: destination company is shown, unventilated files are explicit, Ventiler follows the permission',()=>{
  const app=v6Context();app.ctx.initializeCandidateLocation=()=>{};
  app.setItems('new',[v6Candidate(1,{},{society:null}),v6Candidate(2,{avisDecision:'Favorable'},{society:'IRON GLOBAL SOLUTION'})]);
  app.run('initializeCandidateLocation=()=>{};renderList()');
  assert.deepEqual(texts(app.doc.querySelectorAll('#listWrap td[data-label="Société"]')),['Non ventilé','IRON GLOBAL SOLUTION']);
  assert.deepEqual([...app.run('rowActionItems(tabState.new.items[0]).map(a=>a.label)')],['Ouvrir','Convoquer']);
  app.run('openCandidateForm(1)');
  const destination=app.doc.getElementById('candidateDestination');
  assert.equal(destination.classList.contains('hidden'),false);
  assert.match(destination.textContent,/Société destinataire : Non ventilé \(vivier Groupe\)/);
  assert.equal(destination.querySelector('button'),null,'no ventilation without the permission');
  app.run('recruteSession.user.recruitment_ventilation=true;openCandidateForm(2)');
  assert.match(destination.textContent,/Société destinataire : IRON GLOBAL SOLUTION/);
  assert.equal(destination.querySelector('button').textContent,'Ventiler');
  assert.match(destination.querySelector('button').getAttribute('onclick'),/openCandidateVentilation\(2\)/);
  assert.deepEqual([...app.run('rowActionItems(tabState.new.items[1]).map(a=>a.label)')],['Ouvrir','Convoquer','Recruter','Ventiler']);
  app.run('openCandidateForm(null)');
  assert.ok(destination.classList.contains('hidden'),'a new candidate enters the group pool unventilated');
});
