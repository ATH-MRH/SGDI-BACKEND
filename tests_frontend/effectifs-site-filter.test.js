// Filtre SITE de « Gestion des effectifs » (DRH et OPS) : vraies fonctions de rendu, sans mock
// de logique métier. DRH filtre la liste déjà en mémoire ; OPS envoie site_id au serveur paginé.
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadSgdiApp}=require('./load-app');

const SOC_A='IRON GLOBAL SOLUTION',SOC_B='SWORD CORPORATION';
const HAMOUL={id:'st_hamoul',backendId:41,nom:'DHL FORWARDING / HAMOUL 01 (40K)',societe:SOC_A};
const SITE_X={id:'legacy-x',backendId:42,nom:'SITE X',societe:SOC_A};
const SITE_VIDE={id:'st_vide',backendId:43,nom:'SITE VIDE',societe:SOC_A};
const SITE_SWORD={id:'st_sword',backendId:51,nom:'SITE SWORD',societe:SOC_B};
const NAMES=['emptyDB','renderEffectif','effectifListHTML','setEffectifSiteFilter','setEffectifSearch','setEffectifSort','setEffectifPage','setOpsEffectifSearch','setOpsEffectifFilter','opsEffectifPageParams','effectifSiteFilterOptions'];

const aff=site=>site?{siteId:site.id,siteBackendId:site.backendId,siteName:site.nom,poste:'APS'}:{};
function agent(id,nom,site,extra={}){
  return {id:'a'+id,backendId:id,nom,prenom:'P'+id,matricule:'K'+id,societe:SOC_A,statut:'actif',dateRecrutement:'2025-01-0'+(id%9||1),affectationCourante:aff(site),...extra};
}
const population=()=>[
  agent(1,'ABDELKADER',HAMOUL),agent(2,'BENALI',HAMOUL),agent(3,'ABDELLAH',SITE_X),
  agent(4,'ZOUAOUI',null),agent(5,'ABDELMALEK',null),
  // Fiche legacy : affectation sans identifiant SQL, rattachée au site connu par sa référence.
  agent(8,'CHERIF',null,{affectationCourante:{siteId:'legacy-x',siteName:'SITE X'}}),
  agent(6,'ABDELSWORD',SITE_SWORD,{societe:SOC_B}),
  agent(7,'ABDELSORTANT',HAMOUL,{statut:'sortant'}),
];

async function drhFixture(t,{agents=population(),sites=[HAMOUL,SITE_X,SITE_VIDE,SITE_SWORD],society=SOC_A}={}){
  const app=loadSgdiApp(NAMES);
  assert.equal(app.loadError,null,app.loadError?.stack);
  t.after(()=>new Promise(r=>setTimeout(r,20)).then(()=>app.window.close()));
  const api=app.T(),w=app.window;
  await new Promise(r=>setTimeout(r,50));
  api.setSession({username:'drh',transverse:'drh'});
  api.setDb({...api.emptyDB(),agents,sites});
  w.sessionStorage.setItem('drhSociete',society);
  w.history.replaceState(null,'','#/effectif/actifs');
  w.fetch=()=>assert.fail('le filtre SITE DRH ne fait aucune requête');
  const view=w.document.getElementById('view');
  api.renderEffectif(view,'actifs');
  return {app,api,w,view};
}
const visibleIds=view=>[...view.querySelectorAll('tbody tr[data-searchable]')].filter(r=>r.style.display!=='none').map(r=>Number(r.dataset.backendId));
const siteSelect=view=>view.querySelector('[data-effectif-site-filter]');
const options=view=>[...siteSelect(view).options].map(o=>[o.value,o.textContent.trim()]);
const drhCounter=view=>view.querySelector('.effectif-toolbar-title p').textContent;
const emptyMessage=view=>view.querySelector('[data-effectif-empty-message]').textContent;

test('DRH : SITE est placé entre la recherche et le TRI, accessible, au style du TRI',async t=>{
  const {view}=await drhFixture(t);
  const header=view.querySelector('.effectif-toolbar');
  const order=[...header.querySelectorAll('.effectif-toolbar-search,[data-effectif-site-filter],select[onchange^="setEffectifSort"]')];
  assert.deepEqual(order.map(n=>n.matches('.effectif-toolbar-search')?'search':n.matches('[data-effectif-site-filter]')?'site':'tri'),['search','site','tri']);
  const select=siteSelect(view);
  assert.equal(select.getAttribute('aria-label'),'Filtrer les employés par site');
  assert.equal(header.querySelector('label[for="effectif-site-filter"]').textContent,'Site');
  assert.equal(select.className,'select');
  assert.ok(select.closest('.effectif-toolbar-field'),'même gabarit CSS que le TRI');
  assert.ok(view.querySelector('#effectif-sort').closest('.effectif-toolbar-field'));
  assert.ok(select.hasAttribute('data-no-lock'));
});

test('DRH 1 : Tous les sites = tout le périmètre, options réelles avec compteurs, Sans affectation en dernier',async t=>{
  const {view}=await drhFixture(t);
  assert.deepEqual(visibleIds(view).sort((a,b)=>a-b),[1,2,3,4,5,8]);
  assert.match(drhCounter(view),/^6 employé\(s\)/);
  assert.deepEqual(options(view),[
    ['','Tous les sites (6)'],['41','DHL FORWARDING / HAMOUL 01 (40K) (2)'],['43','SITE VIDE (0)'],['42','SITE X (2)'],['__none__','Sans affectation (2)']]);
});

test('DRH 2-4 : site A, site B (fiche legacy incluse) et Sans affectation',async t=>{
  const {api,view}=await drhFixture(t);
  for(const [value,ids] of [['41',[1,2]],['42',[3,8]],['__none__',[4,5]]]){
    await api.setEffectifSiteFilter(value,'actifs');
    assert.deepEqual(visibleIds(view).sort((a,b)=>a-b),ids,value);
    assert.equal(siteSelect(view).value,value);
    assert.match(drhCounter(view),new RegExp('^'+ids.length+' employé\\(s\\)'),'le compteur reflète le filtre');
  }
  await api.setEffectifSiteFilter('','actifs');
  assert.equal(visibleIds(view).length,6);
});

test('DRH 5 : recherche + site = intersection',async t=>{
  const {api,view}=await drhFixture(t);
  await api.setEffectifSiteFilter('41','actifs');
  api.setEffectifSearch('ABDEL','actifs');
  assert.deepEqual(visibleIds(view),[1]);
  await api.setEffectifSiteFilter('42','actifs');
  assert.deepEqual(visibleIds(view),[3],'la recherche reste appliquée après changement de site');
  await api.setEffectifSiteFilter('__none__','actifs');
  assert.deepEqual(visibleIds(view),[5]);
});

test('DRH 6 : tri + site, menu TRI inchangé',async t=>{
  const {api,view}=await drhFixture(t);
  const sortValues=()=>[...view.querySelectorAll('select[onchange^="setEffectifSort"] option')].map(o=>o.value);
  assert.deepEqual(sortValues(),['nom_asc','nom_desc','recrut_asc','recrut_desc','mat_asc','mat_desc']);
  await api.setEffectifSiteFilter('41','actifs');
  assert.deepEqual(visibleIds(view),[1,2]);
  api.setEffectifSort('nom_desc');
  assert.deepEqual(visibleIds(view),[2,1]);
  assert.equal(siteSelect(view).value,'41');
  assert.deepEqual(sortValues(),['nom_asc','nom_desc','recrut_asc','recrut_desc','mat_asc','mat_desc']);
  api.setEffectifSort('nom_asc');
});

test('DRH 7 : le filtre survit au re-rendu de l’écran (DRH non paginé)',async t=>{
  const {api,w,view}=await drhFixture(t);
  await api.setEffectifSiteFilter('42','actifs');
  view.innerHTML='';
  api.renderEffectif(view,'actifs');
  assert.equal(siteSelect(view).value,'42');
  assert.deepEqual(visibleIds(view).sort(),[3,8]);
  assert.deepEqual(JSON.parse(w.sessionStorage.getItem('drhEffectifSiteFilter')),{site:'42',poste:'',soc:SOC_A});
});

test('DRH 8 : changement de société remet « Tous les sites » et recharge les sites de la société',async t=>{
  const {api,w,view}=await drhFixture(t);
  await api.setEffectifSiteFilter('41','actifs');
  w.sessionStorage.setItem('drhSociete',SOC_B);
  api.renderEffectif(view,'actifs');
  assert.equal(siteSelect(view).value,'');
  assert.deepEqual(visibleIds(view),[6]);
  assert.deepEqual(options(view).map(o=>o[0]),['','51','__none__']);
  assert.equal(JSON.parse(w.sessionStorage.getItem('drhEffectifSiteFilter')).site,'');
});

test('DRH 9 : aucune option hors périmètre, un site forcé hors périmètre est ignoré',async t=>{
  const app=loadSgdiApp(NAMES);t.after(()=>new Promise(r=>setTimeout(r,20)).then(()=>app.window.close()));
  const api=app.T(),w=app.window;
  await new Promise(r=>setTimeout(r,50));
  api.setSession({username:'drh',transverse:'drh'});
  // db.sites vient de /api/ops/sites, déjà filtré par le serveur ; ici absent (compte DRH seul) :
  // les options viennent alors des affectations actives des employés du périmètre.
  api.setDb({...api.emptyDB(),agents:population(),sites:[]});
  w.sessionStorage.setItem('drhSociete',SOC_A);
  w.sessionStorage.setItem('drhEffectifSiteFilter',JSON.stringify({site:'51',soc:SOC_A}));
  w.history.replaceState(null,'','#/effectif/actifs');
  const view=w.document.getElementById('view');
  api.renderEffectif(view,'actifs');
  assert.equal(siteSelect(view).value,'');
  assert.ok(!options(view).some(([v,l])=>v==='51'||/SWORD/.test(l)));
  assert.equal(visibleIds(view).length,6);
});

test('DRH 10 : aucun résultat = message explicite',async t=>{
  const {api,view}=await drhFixture(t);
  await api.setEffectifSiteFilter('43','actifs');
  assert.equal(emptyMessage(view),'Aucun employé affecté à ce site');
  assert.match(drhCounter(view),/^0 employé\(s\)/);
  const all=await drhFixture(t,{agents:[agent(1,'ABDELKADER',HAMOUL)]});
  await all.api.setEffectifSiteFilter('__none__','actifs');
  assert.equal(emptyMessage(all.view),'Aucun employé sans affectation');
});

test('DRH : alerte contrat expiré, colonnes et bouton Ouvrir inchangés sous filtre',async t=>{
  const {api,view}=await drhFixture(t,{agents:[agent(1,'ABDELKADER',HAMOUL,{dateFinContrat:'2000-01-01'}),agent(2,'BENALI',SITE_X)]});
  await api.setEffectifSiteFilter('41','actifs');
  const row=view.querySelector('tbody tr');
  assert.ok(row.classList.contains('effectif-contract-expired'));
  assert.equal(row.cells.length,8);
  assert.equal(row.querySelector('.effectif-open-btn').getAttribute('href'),'#/agents/a1');
});

// ---------- OPS : écran paginé côté serveur ----------
async function opsFixture(t,{sites=[HAMOUL,SITE_X,SITE_SWORD],societe=SOC_A,stored}={}){
  const app=loadSgdiApp(NAMES);
  assert.equal(app.loadError,null,app.loadError?.stack);
  t.after(()=>new Promise(r=>setTimeout(r,20)).then(()=>app.window.close()));
  const api=app.T(),w=app.window;
  await new Promise(r=>setTimeout(r,50));
  api.setDb({...api.emptyDB(),sites});
  api.setSession({transverse:'ops',role:'ops',societe});
  w.sessionStorage.setItem('sgdi_api_token_v1','ops-site-token');
  if(stored)w.sessionStorage.setItem('opsEffectifFilters',JSON.stringify(stored));
  w.history.replaceState(null,'','#/effectif/actifs');
  w.hydrateEmployeePhotos=()=>{};
  const requests=[];let reply=params=>({items:[],total:0,page:params.page,pages:1});
  w.SGDI_API.employees.list=async()=>{throw new Error('liste complète interdite')};
  w.SGDI_API.employees.page=async params=>{requests.push({...params});return reply(params)};
  const view=w.document.getElementById('view');
  return {api,w,view,requests,setReply:fn=>{reply=fn}};
}
const opsRow=(id,site)=>({id,code:'K'+id,last_name:'NOM'+id,first_name:'P',society:SOC_A,status:'actif',has_photo:false,photo_url:'',
  extra:{_legacy:{id:'legacy-'+id,affectationCourante:site?{siteId:site.id,siteBackendId:site.backendId,siteName:site.nom}:{}}}});

test('OPS : un seul sélecteur SITE dans la barre, entre Recherche et Tri, sites de la société seulement',async t=>{
  const {api,view,requests}=await opsFixture(t);
  await api.renderEffectif(view,'actifs');
  const labels=[...view.querySelectorAll('.effectif-toolbar-field > label')].map(s=>s.textContent);
  assert.deepEqual(labels,['Site','Poste / fonction','Tri']);
  assert.ok(view.querySelector('.effectif-toolbar-search input[oninput^="setEffectifSearch"]'));
  assert.equal(view.querySelectorAll('[data-effectif-site-filter]').length,1);
  assert.equal(view.querySelector('select[onchange*="setOpsEffectifFilter(\'site\'"]'),null,'ancien doublon retiré de la carte de filtres');
  assert.deepEqual(options(view),[['','Tous les sites'],['41','DHL FORWARDING / HAMOUL 01 (40K)'],['42','SITE X'],['__none__','Sans affectation']]);
  assert.equal(requests[0].site_id,'','Tous les sites : aucun filtre site envoyé');
});

test('OPS 1-6 : site précis, Sans affectation, recherche, tri et pagination conservent site_id',async t=>{
  const {api,w,view,requests,setReply}=await opsFixture(t);
  setReply(params=>({items:params.site_id===41?[opsRow(1,HAMOUL)]:[opsRow(9,null)],total:params.site_id===41?38:60,page:params.page,pages:2}));
  await api.renderEffectif(view,'actifs');
  await api.setEffectifSiteFilter('41','actifs');
  assert.equal(requests.at(-1).site_id,41);assert.equal(requests.at(-1).page,1);
  assert.match(view.querySelector('.effectif-toolbar-title p').textContent,/^38 employé\(s\)/);
  assert.equal(siteSelect(view).value,'41');
  await api.setEffectifSort('nom_desc');
  assert.equal(requests.at(-1).site_id,41);assert.equal(requests.at(-1).sort,'nom_desc');
  await api.setEffectifPage('actifs',2);
  assert.equal(requests.at(-1).site_id,41);assert.equal(requests.at(-1).page,2);
  api.setOpsEffectifSearch('ABDEL');
  await new Promise(r=>setTimeout(r,320));
  assert.equal(requests.at(-1).site_id,41);assert.equal(requests.at(-1).q,'ABDEL');assert.equal(requests.at(-1).page,1);
  await api.setEffectifSiteFilter('__none__','actifs');
  assert.equal(requests.at(-1).site_id,'__none__');assert.equal(requests.at(-1).q,'ABDEL');
  assert.match(view.querySelector('.effectif-toolbar-title p').textContent,/^60 employé\(s\)/);
  assert.equal(siteSelect(view).value,'__none__');
  api.setEffectifSort('nom_asc');
  assert.equal(JSON.parse(w.sessionStorage.getItem('opsEffectifFilters')).siteSoc,SOC_A);
});

test('OPS : états vides explicites',async t=>{
  const {api,view}=await opsFixture(t);
  await api.renderEffectif(view,'actifs');
  await api.setEffectifSiteFilter('42','actifs');
  assert.equal(emptyMessage(view),'Aucun employé affecté à ce site');
  await api.setEffectifSiteFilter('__none__','actifs');
  assert.equal(emptyMessage(view),'Aucun employé sans affectation');
});

test('OPS 7 : changement de société ou site forcé hors société ⇒ Tous les sites',async t=>{
  const {api,view,requests}=await opsFixture(t,{stored:{site:'51'}});
  await api.renderEffectif(view,'actifs');
  assert.equal(requests[0].site_id,'','site d’une autre société jamais envoyé');
  assert.equal(siteSelect(view).value,'');
  await api.setEffectifSiteFilter('41','actifs');
  api.setSession({transverse:'ops',role:'ops',societe:SOC_B});
  await api.renderEffectif(view,'actifs');
  assert.equal(requests.at(-1).society,SOC_B);assert.equal(requests.at(-1).site_id,'');
  assert.deepEqual(options(view).map(o=>o[0]),['','51','__none__']);
});

test('OPS : un ancien choix mémorisé par identifiant local reste valide',async t=>{
  const {api,view,requests}=await opsFixture(t,{stored:{site:'st_hamoul'}});
  await api.renderEffectif(view,'actifs');
  assert.equal(requests[0].site_id,41);
  assert.equal(siteSelect(view).value,'41');
});

test('OPS 8-10 : superviseur limité (sites autorisés) — aucune option ni ligne hors périmètre',async t=>{
  const app=loadSgdiApp(NAMES);t.after(()=>new Promise(r=>setTimeout(r,20)).then(()=>app.window.close()));
  const api=app.T(),w=app.window;
  await new Promise(r=>setTimeout(r,50));
  const agents=[agent(1,'ABDELKADER',HAMOUL),agent(2,'BENALI',HAMOUL),agent(3,'ABDELLAH',SITE_X),agent(4,'ZOUAOUI',null)];
  api.setDb({...api.emptyDB(),agents,sites:[HAMOUL,SITE_X]});
  api.setSession({transverse:'superviseur',societe:SOC_A,sitesAutorises:['41']});
  w.history.replaceState(null,'','#/effectif/actifs');
  w.fetch=()=>assert.fail('superviseur : filtrage sur la liste déjà autorisée');
  const view=w.document.getElementById('view');
  api.renderEffectif(view,'actifs');
  assert.deepEqual(options(view).map(o=>o[0]),['','41','__none__']);
  assert.deepEqual(visibleIds(view).sort(),[1,2]);
  await api.setEffectifSiteFilter('41','actifs');
  assert.deepEqual(visibleIds(view).sort(),[1,2]);
  w.sessionStorage.setItem('opsEffectifFilters',JSON.stringify({site:'42',siteSoc:SOC_A}));
  api.renderEffectif(view,'actifs');
  assert.equal(siteSelect(view).value,'','site non autorisé ignoré');
  assert.deepEqual(visibleIds(view).sort(),[1,2]);
});
