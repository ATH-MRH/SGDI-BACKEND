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
