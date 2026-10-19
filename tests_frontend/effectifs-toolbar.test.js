// Barre de pilotage de Gestion des effectifs (DRH / OPS) : POSTE / FONCTION, raccourcis
// comptés SITE et POSTE, réinitialisation, bloc sticky et Actions à faire bleues.
// Vraies fonctions de rendu ; seul le réseau OPS est simulé.
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadSgdiApp}=require('./load-app');

const SOC_A='IRON GLOBAL SOLUTION',SOC_B='SWORD CORPORATION';
const HAMOUL={id:'st_hamoul',backendId:41,nom:'DHL FORWARDING / HAMOUL 01 (40K)',societe:SOC_A};
const SITE_X={id:'st_x',backendId:42,nom:'SITE X',societe:SOC_A};
const SITE_SWORD={id:'st_sword',backendId:51,nom:'SITE SWORD',societe:SOC_B};
const NAMES=['normalizePageHeader','emptyDB','renderEffectif','setEffectifSiteFilter','setEffectifPosteFilter','resetEffectifToolbar','setEffectifSearch',
  'setEffectifSort','setEffectifPage','setOpsEffectifSearch','sgdiEffectifExportList','drhEffectifActionsBarHTML','effectifAgentPoste'];

const aff=(site,poste)=>site?{siteId:site.id,siteBackendId:site.backendId,siteName:site.nom,poste}:{};
function agent(id,nom,site,poste,extra={}){
  return {id:'a'+id,backendId:id,nom,prenom:'P'+id,matricule:'K'+id,societe:SOC_A,statut:'actif',dateRecrutement:'2025-01-0'+(id%9||1),
    affectationCourante:aff(site,poste),fonction:site?'':poste,...extra};
}
// HAMOUL : 2 Caristes + 1 Magasinier ; SITE X : 1 Magasinier + 2 Agents APS ; sans affectation :
// 1 Magasinier + 1 Cariste. ELHADI : le poste de l'affectation active prime sur sa fonction.
const population=()=>[
  agent(1,'ABDELKADER',HAMOUL,'Cariste'),agent(2,'BENALI',HAMOUL,'Cariste'),agent(3,'ABDELLAH',HAMOUL,'Magasinier'),
  agent(4,'CHAOUI',SITE_X,'Magasinier'),agent(5,'DAHMANI',SITE_X,'Agent APS'),
  agent(8,'ELHADI',SITE_X,'Agent APS',{fonction:'Cariste'}),
  agent(6,'ZOUAOUI',null,'Magasinier'),agent(7,'ABDELMALEK',null,'Cariste'),
  agent(9,'ABDELSWORD',SITE_SWORD,'Cariste',{societe:SOC_B}),
];
const boot=()=>new Promise(r=>setTimeout(r,50)); // laisse l'amorçage de l'app finir avant la session de test
const closeLater=app=>()=>new Promise(r=>setTimeout(r,20)).then(()=>app.window.close());

async function drhFixture(t,{agents=population(),society=SOC_A}={}){
  const app=loadSgdiApp(NAMES);
  assert.equal(app.loadError,null,app.loadError?.stack);
  t.after(closeLater(app));
  const api=app.T(),w=app.window;
  await boot();
  api.setSession({username:'drh',transverse:'drh'});
  api.setDb({...api.emptyDB(),agents,sites:[HAMOUL,SITE_X,SITE_SWORD]});
  w.sessionStorage.setItem('drhSociete',society);
  w.history.replaceState(null,'','#/effectif/actifs');
  w.fetch=()=>assert.fail('les filtres DRH ne font aucune requête');
  const view=w.document.getElementById('view');
  api.renderEffectif(view,'actifs');
  return {app,api,w,view};
}
const ids=view=>[...view.querySelectorAll('tbody tr[data-searchable]')].filter(r=>r.style.display!=='none').map(r=>Number(r.dataset.backendId)).sort((a,b)=>a-b);
const counter=view=>view.querySelector('.effectif-toolbar-title p').textContent;
const options=(view,kind)=>[...view.querySelector(`[data-effectif-${kind}-filter]`).options].map(o=>[o.value,o.textContent.trim()]);
const chips=(view,kind)=>[...view.querySelectorAll(`[data-effectif-chip="${kind}"]`)].map(c=>[c.dataset.value,c.querySelector('.effectif-chip-label').textContent,Number(c.querySelector('.effectif-chip-count').textContent),c.getAttribute('aria-pressed')]);
const chip=(view,kind,value)=>view.querySelector(`[data-effectif-chip="${kind}"][data-value="${value}"]`);
// jsdom (scripts « outside-only ») n'exécute pas les attributs onclick : on exécute le
// gestionnaire déclaré, comme le navigateur au clic ou à Entrée/Espace sur le bouton.
const click=async(app,el)=>{assert.equal(el.tagName,'BUTTON');await app.window.eval(el.getAttribute('onclick'));await new Promise(r=>setTimeout(r,0))};

test('POSTE : champ dédié entre SITE et TRI, labels visibles, options réelles comptées',async t=>{
  const {view}=await drhFixture(t);
  const fields=[...view.querySelectorAll('.effectif-toolbar-field')];
  assert.deepEqual(fields.map(f=>f.querySelector('label').textContent),['Site','Poste / fonction','Tri']);
  for(const f of fields)assert.equal(f.querySelector('label').getAttribute('for'),f.querySelector('select').id);
  assert.equal(view.querySelector('[data-effectif-poste-filter]').getAttribute('aria-label'),'Filtrer les employés par poste ou fonction');
  assert.deepEqual(options(view,'poste'),[['','Tous les postes (8)'],['Agent APS','Agent APS (2)'],['Cariste','Cariste (3)'],['Magasinier','Magasinier (3)']]);
  assert.equal(view.querySelectorAll('[data-effectif-poste-filter]').length,1,'aucun doublon');
});

test('POSTE 1-4 : Tous, Magasinier, Cariste, Agent APS (poste de l’affectation active prioritaire)',async t=>{
  const {api,view}=await drhFixture(t);
  assert.deepEqual(ids(view),[1,2,3,4,5,6,7,8]);
  for(const [poste,expected] of [['Magasinier',[3,4,6]],['Cariste',[1,2,7]],['Agent APS',[5,8]],['',[1,2,3,4,5,6,7,8]]]){
    await api.setEffectifPosteFilter(poste,'actifs');
    assert.deepEqual(ids(view),expected,poste);
    assert.match(counter(view),new RegExp(`^${expected.length} employé\\(s\\)`));
    assert.equal(view.querySelector('[data-effectif-poste-filter]').value,poste);
  }
  assert.equal(api.effectifAgentPoste(population()[5]),'Agent APS','ELHADI : affectation Agent APS, fonction Cariste');
});

test('POSTE 5 + SITE 4 : compteurs SITE avant le site, compteurs POSTE contextuels au site',async t=>{
  const {api,view}=await drhFixture(t);
  assert.deepEqual(chips(view,'site'),[['','Tous',8,'true'],['41','DHL FORWARDING / HAMOUL 01 (40K)',3,'false'],['42','SITE X',3,'false'],['__none__','Sans affectation',2,'false']]);
  assert.deepEqual(chips(view,'poste').map(c=>c.slice(0,3)),[['','Tous',8],['Cariste','Cariste',3],['Magasinier','Magasinier',3],['Agent APS','Agent APS',2]]);
  await api.setEffectifSiteFilter('41','actifs');
  assert.deepEqual(chips(view,'site').map(c=>c[2]),[8,3,3,2],'compteurs SITE inchangés par le choix du site');
  assert.deepEqual(chips(view,'poste').map(c=>c.slice(0,3)),[['','Tous',3],['Cariste','Cariste',2],['Magasinier','Magasinier',1]]);
  assert.deepEqual(options(view,'poste'),[['','Tous les postes (3)'],['Agent APS','Agent APS (0)'],['Cariste','Cariste (2)'],['Magasinier','Magasinier (1)']]);
});

test('POSTE 6 + SITE 5 : clic sur les raccourcis (boutons clavier, aria-pressed)',async t=>{
  const {app,view}=await drhFixture(t);
  const c=chip(view,'site','42');
  assert.equal(c.tagName,'BUTTON');assert.equal(c.type,'button');
  await click(app,c);
  assert.deepEqual(ids(view),[4,5,8]);
  assert.equal(chip(view,'site','42').getAttribute('aria-pressed'),'true');
  assert.ok(chip(view,'site','42').classList.contains('is-active'));
  assert.equal(view.querySelector('[data-effectif-site-filter]').value,'42');
  await click(app,chip(view,'poste','Agent APS'));
  assert.deepEqual(ids(view),[5,8]);
  assert.equal(view.querySelector('[data-effectif-poste-filter]').value,'Agent APS');
  await click(app,chip(view,'poste',''));
  assert.deepEqual(ids(view),[4,5,8],'« Tous » remet Tous les postes');
  await click(app,chip(view,'site','__none__'));
  assert.deepEqual(ids(view),[6,7]);
  await click(app,chip(view,'site',''));
  assert.deepEqual(ids(view),[1,2,3,4,5,6,7,8]);
});

test('POSTE 7-9 : SITE + POSTE, recherche + POSTE, TRI + POSTE',async t=>{
  const {api,view}=await drhFixture(t);
  await api.setEffectifSiteFilter('41','actifs');
  await api.setEffectifPosteFilter('Cariste','actifs');
  assert.deepEqual(ids(view),[1,2]);
  assert.match(counter(view),/^2 employé\(s\)/);
  api.setEffectifSearch('ABDEL','actifs');
  assert.deepEqual(ids(view),[1]);
  assert.match(counter(view),/^1 employé\(s\)/,'le compteur suit la liste réellement affichée');
  api.setEffectifSearch('','actifs');
  api.setEffectifSort('nom_desc');
  const order=[...view.querySelectorAll('tbody tr')].map(r=>Number(r.dataset.backendId));
  assert.deepEqual(order,[2,1]);
  assert.equal(view.querySelector('[data-effectif-poste-filter]').value,'Cariste');
  assert.equal(view.querySelector('[data-effectif-site-filter]').value,'41');
  assert.deepEqual([...view.querySelectorAll('#effectif-sort option')].map(o=>o.value),['nom_asc','nom_desc','recrut_asc','recrut_desc','mat_asc','mat_desc'],'TRI inchangé');
  api.setEffectifSort('nom_asc');
});

test('POSTE 10 : aucun résultat ⇒ message explicite et réinitialisation',async t=>{
  const {app,api,view}=await drhFixture(t);
  await api.setEffectifSiteFilter('41','actifs');
  await api.setEffectifPosteFilter('Agent APS','actifs');
  assert.equal(view.querySelector('[data-effectif-empty-message]').textContent,'Aucun employé correspondant à ces filtres');
  await click(app,view.querySelector('[data-effectif-empty] button'));
  assert.deepEqual(ids(view),[1,2,3,4,5,6,7,8]);
});

test('Réinitialiser : recherche, SITE, POSTE et TRI ; la société active est conservée',async t=>{
  const {app,api,w,view}=await drhFixture(t);
  await api.setEffectifSiteFilter('42','actifs');
  await api.setEffectifPosteFilter('Agent APS','actifs');
  api.setEffectifSearch('DAH','actifs');
  api.setEffectifSort('nom_desc');
  const reset=view.querySelector('.effectif-toolbar-reset');
  assert.equal(reset.getAttribute('aria-label'),'Réinitialiser la recherche, les filtres et le tri');
  await click(app,reset);
  assert.equal(view.querySelector('.effectif-toolbar-search input').value,'');
  assert.equal(view.querySelector('[data-effectif-site-filter]').value,'');
  assert.equal(view.querySelector('[data-effectif-poste-filter]').value,'');
  assert.equal(view.querySelector('#effectif-sort').value,'nom_asc');
  assert.deepEqual(ids(view),[1,2,3,4,5,6,7,8]);
  assert.equal(w.sessionStorage.getItem('drhSociete'),SOC_A);
});

test('persistance : POSTE conservé au re-rendu ; changement de société ⇒ poste invalide remis à Tous',async t=>{
  const {api,w,view}=await drhFixture(t);
  await api.setEffectifPosteFilter('Magasinier','actifs');
  view.innerHTML='';api.renderEffectif(view,'actifs');
  assert.equal(view.querySelector('[data-effectif-poste-filter]').value,'Magasinier');
  w.sessionStorage.setItem('drhSociete',SOC_B);
  api.renderEffectif(view,'actifs');
  assert.equal(view.querySelector('[data-effectif-poste-filter]').value,'','aucun Magasinier chez SWORD');
  assert.deepEqual(ids(view),[9]);
  assert.equal(JSON.parse(w.sessionStorage.getItem('drhEffectifSiteFilter')).poste,'');
});

test('raccourcis limités : Tous, 2 plus gros sites, choix courant, Sans affectation',async t=>{
  const sites=Array.from({length:12},(_,i)=>({id:'s'+i,backendId:100+i,nom:'SITE '+String(i).padStart(2,'0'),societe:SOC_A}));
  const agents=[];let n=1;
  sites.forEach((site,i)=>{for(let k=0;k<=i;k++)agents.push(agent(n++,'NOM'+n,site,'Cariste'))});
  agents.push(agent(n++,'SANS',null,'Cariste'));
  const {api,view}=await drhFixture(t,{agents});
  assert.deepEqual(chips(view,'site').map(c=>c[1]),['Tous','SITE 11','SITE 10','Sans affectation']);
  assert.equal(options(view,'site').length,16,'la liste complète reste dans le sélecteur (12 + HAMOUL + SITE X + Tous + Sans affectation)');
  await api.setEffectifSiteFilter('100','actifs');
  assert.deepEqual(chips(view,'site').map(c=>c[1]),['Tous','SITE 11','SITE 10','SITE 00','Sans affectation']);
});

test('Actions à faire : 13 boutons bleus avec icône, mêmes actions et même ordre',async t=>{
  const {view}=await drhFixture(t);
  const keys=['detail','maladie','conge','rec_periode_essai','suspendre','convoquer','blacklister','mise_en_demeure','periode_enc','sanctionner','avenant','nouveau_contrat','fin_contrat'];
  const labels=['DETAIL','MALADIE','CONGÉ',"REC/PERIODE D'ESSAI",'SUSPENDRE','CONVOQUER','BLACKLISTER','MISE EN DEMEURE','PERIODE E-N-C','SANCTIONNER','AVENANT','NOUVEAU CONTRAT','FIN DE CONTRAT'];
  const buttons=[...view.querySelectorAll('.drh-effectif-actions-card .drh-effectif-action-btn')];
  assert.deepEqual(buttons.map(b=>b.getAttribute('onclick')),keys.map(k=>`openRhEffectifActionModal('${k}')`));
  assert.deepEqual(buttons.map(b=>b.textContent.trim()),labels);
  for(const b of buttons){
    assert.equal(b.type,'button');
    assert.ok(b.querySelector('svg[aria-hidden="true"]'),'icône décorative');
    assert.equal(b.getAttribute('style'),null,'plus de couleur par action : toutes bleues');
  }
});

test('bloc sticky : barre et Actions à faire ensemble, tableau en dessous',async t=>{
  const {view}=await drhFixture(t);
  const head=view.querySelector('.effectif-page > .effectif-sticky-head');
  assert.deepEqual([...head.children].map(c=>c.className),['effectif-toolbar','drh-effectif-actions-card']);
  assert.equal(head.querySelector('table'),null);
  assert.ok(head.compareDocumentPosition(view.querySelector('.effectif-table'))&4,'le tableau suit le bloc');
});

test('export Excel : reprend SITE + POSTE + recherche affichés',async t=>{
  const {api,view}=await drhFixture(t);
  await api.setEffectifSiteFilter('41','actifs');
  await api.setEffectifPosteFilter('Cariste','actifs');
  assert.deepEqual(api.sgdiEffectifExportList('actifs').list.map(a=>a.backendId).sort(),[1,2]);
  api.setEffectifSearch('BENALI','actifs');
  assert.deepEqual(api.sgdiEffectifExportList('actifs').list.map(a=>a.backendId),[2]);
  assert.equal(view.querySelectorAll('[data-effectif-chip]').length>0,true);
});

// ---------- OPS : écran paginé côté serveur ----------
async function opsFixture(t,{stored}={}){
  const app=loadSgdiApp(NAMES);
  assert.equal(app.loadError,null,app.loadError?.stack);
  t.after(closeLater(app));
  const api=app.T(),w=app.window;
  await boot();
  api.setDb({...api.emptyDB(),sites:[HAMOUL,SITE_X,SITE_SWORD]});
  api.setSession({transverse:'ops',role:'ops',societe:SOC_A});
  w.sessionStorage.setItem('sgdi_api_token_v1','ops-toolbar-token');
  if(stored)w.sessionStorage.setItem('opsEffectifFilters',JSON.stringify(stored));
  w.history.replaceState(null,'','#/effectif/actifs');
  w.hydrateEmployeePhotos=()=>{};
  const requests=[];
  // Agrégats serveur sur tout le résultat (88 employés), alors que la page n'en contient qu'un.
  const counts=params=>({sites:[{site_id:41,name:HAMOUL.nom,count:24},{site_id:42,name:'SITE X',count:46}],sites_none:18,sites_total:88,
    postes:params.site_id===41?[{poste:'Cariste',count:21},{poste:'Magasinier',count:3}]:[{poste:'Magasinier',count:39},{poste:'Cariste',count:37},{poste:'Agent APS',count:12}],
    postes_total:params.site_id===41?24:88});
  w.SGDI_API.employees.list=async()=>{throw new Error('liste complète interdite')};
  w.SGDI_API.employees.page=async params=>{requests.push({...params});
    return {items:[{id:7,code:'K7',last_name:'NOM7',first_name:'P',society:SOC_A,status:'actif',has_photo:false,photo_url:'',extra:{_legacy:{id:'l7',affectationCourante:{}}}}],
      total:params.poste==='Cariste'?21:88,page:params.page,pages:4,filters:{postes:['Agent APS','Cariste','Magasinier'],counts:counts(params)}}};
  const view=w.document.getElementById('view');
  await api.renderEffectif(view,'actifs');
  return {app,api,w,view,requests};
}

test('OPS : POSTE dans la barre (plus dans la carte de filtres), compteurs serveur et non de la page',async t=>{
  const {view}=await opsFixture(t);
  assert.equal(view.querySelector('select[onchange*="setOpsEffectifFilter(\'poste\'"]'),null);
  assert.equal(view.querySelectorAll('[data-effectif-poste-filter]').length,1);
  assert.ok(view.querySelector('.ops-effectif-filter-card select[onchange*="situation"]'),'Situation et filtres avancés restent dans la carte');
  assert.deepEqual(chips(view,'site').map(c=>c.slice(0,3)),[['','Tous',88],['42','SITE X',46],['41','DHL FORWARDING / HAMOUL 01 (40K)',24],['__none__','Sans affectation',18]]);
  assert.deepEqual(chips(view,'poste').map(c=>c.slice(0,3)),[['','Tous',88],['Magasinier','Magasinier',39],['Cariste','Cariste',37],['Agent APS','Agent APS',12]]);
  assert.match(counter(view),/^88 employé\(s\)/);
  assert.equal(view.querySelector('.effectif-sticky-head .drh-effectif-actions-card'),null,'pas de barre Actions RH côté OPS');
});

test('OPS : SITE + POSTE + recherche + tri + pagination envoyés au serveur',async t=>{
  const {app,api,view,requests}=await opsFixture(t);
  await click(app,chip(view,'site','41'));
  await new Promise(r=>setTimeout(r,0));
  assert.equal(requests.at(-1).site_id,41);
  assert.deepEqual(chips(view,'poste').map(c=>c.slice(0,3)),[['','Tous',24],['Cariste','Cariste',21],['Magasinier','Magasinier',3]],'POSTE contextuel au site');
  await api.setEffectifPosteFilter('Cariste','actifs');
  assert.equal(requests.at(-1).poste,'Cariste');assert.equal(requests.at(-1).site_id,41);assert.equal(requests.at(-1).page,1);
  assert.match(counter(view),/^21 employé\(s\)/);
  await api.setEffectifSort('nom_desc');
  assert.deepEqual([requests.at(-1).poste,requests.at(-1).site_id,requests.at(-1).sort],['Cariste',41,'nom_desc']);
  await api.setEffectifPage('actifs',3);
  assert.deepEqual([requests.at(-1).poste,requests.at(-1).site_id,requests.at(-1).page],['Cariste',41,3]);
  api.setOpsEffectifSearch('ABDEL');
  await new Promise(r=>setTimeout(r,320));
  assert.deepEqual([requests.at(-1).q,requests.at(-1).poste,requests.at(-1).site_id],['ABDEL','Cariste',41]);
  await api.resetEffectifToolbar('actifs');
  assert.deepEqual([requests.at(-1).q,requests.at(-1).poste,requests.at(-1).site_id,requests.at(-1).sort],['','','','nom_asc']);
});

test('OPS : un poste absent du périmètre (autre société) est remis à Tous et la page rechargée',async t=>{
  const {requests,view}=await opsFixture(t,{stored:{poste:'Plongeur'}});
  assert.equal(requests[0].poste,'Plongeur');
  assert.equal(requests.at(-1).poste,'','nouvelle requête sans le poste invalide');
  assert.equal(view.querySelector('[data-effectif-poste-filter]').value,'');
});

test('OPS superviseur : POSTE et compteurs sur la liste autorisée uniquement',async t=>{
  const app=loadSgdiApp(NAMES);t.after(closeLater(app));
  const api=app.T(),w=app.window;
  await boot();
  api.setDb({...api.emptyDB(),agents:population(),sites:[HAMOUL,SITE_X]});
  api.setSession({transverse:'superviseur',societe:SOC_A,sitesAutorises:['41']});
  w.history.replaceState(null,'','#/effectif/actifs');
  w.fetch=()=>assert.fail('superviseur : filtrage sur la liste déjà autorisée');
  const view=w.document.getElementById('view');
  api.renderEffectif(view,'actifs');
  assert.deepEqual(ids(view),[1,2,3]);
  assert.deepEqual(chips(view,'site').map(c=>c[0]),['','41']);
  assert.deepEqual(chips(view,'poste').map(c=>c.slice(0,3)),[['','Tous',3],['Cariste','Cariste',2],['Magasinier','Magasinier',1]]);
  await api.setEffectifPosteFilter('Magasinier','actifs');
  assert.deepEqual(ids(view),[3]);
});

// Régression production (PR #60) : le normalisateur d'en-tête générique classait toute la
// zone en « module-page-header » et la page en « module-page-header-actions » (flex
// horizontal) ; avec container-type, la barre sticky tombait à 0 px de large.
test('normalisateur d’en-tête : la zone des effectifs DRH et OPS n’est plus reclassée',async t=>{
  for(const fixture of [drhFixture,opsFixture]){
    const {api,view}=await fixture(t);
    api.normalizePageHeader(view);
    const zone=view.querySelector('#effectif-list-zone');
    assert.equal(zone.classList.contains('module-page-header'),false);
    assert.equal(view.querySelector('.effectif-page').classList.contains('module-page-header-actions'),false);
    assert.equal(view.querySelector('.module-page-header-copy,.module-page-header-actions'),null);
  }
  const {api,view}=await drhFixture(t);
  view.innerHTML='<div><h1>Autre page</h1><div><button type="button">Action</button></div></div>';
  api.normalizePageHeader(view);
  assert.ok(view.firstElementChild.classList.contains('module-page-header'),'les autres pages restent normalisées');
});

test('CSS : le bloc sticky ne dépend d’aucun container-type ni @container',()=>{
  const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'../app/static/sgdi-app.css'),'utf8');
  const start=css.indexOf('Gestion des effectifs : barre de pilotage DRH / OPS');
  const block=css.slice(start,css.indexOf('/* Agenda module */',start));
  assert.ok(start>0&&block.length>0);
  assert.doesNotMatch(block,/container-type\s*:|@container/);
  const head=block.match(/#view \.effectif-sticky-head\{[^}]*\}/)[0];
  for(const rule of ['width:100%','min-width:0','height:auto','flex:0 0 auto'])assert.ok(head.includes(rule),rule);
  assert.match(block,/@media screen and \(min-width:1200px\) and \(min-height:700px\)\{\s*#view \.effectif-sticky-head\{\s*position:sticky/);
});
