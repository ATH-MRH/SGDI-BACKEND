// Recrutement : ventiler un dossier « Non ventilé » depuis la liste et depuis la fenêtre « Recruter »,
// puis poursuivre le recrutement sans la fermer. Le vrai script de recrute.html est exécuté ; seuls
// le réseau et le rechargement de liste sont remplacés.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const source=fs.readFileSync(path.join(__dirname,'..','app','static','recrute.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','app','static','recruitment-v6.css'),'utf8');
const script=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]).find(code=>code.includes('const SESSION_KEY='));
const SECURITE='IRON GLOBAL SECURITE',SOLUTION='IRON GLOBAL SOLUTION';

function setup({ventilation=true,actions=['read','create','update'],tab='new',society=null,opinion='Favorable',targets=[SECURITE,SOLUTION]}={}){
  const dom=new JSDOM(source,{runScripts:'outside-only'});
  const ctx={document:dom.window.document,window:{scrollX:0,scrollY:0,scrollTo(){}},URLSearchParams,FormData:dom.window.FormData,
    sessionStorage:{getItem:()=>null,setItem(){}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}}};
  const add=ctx.document.addEventListener.bind(ctx.document);
  ctx.document.addEventListener=(name,...args)=>{if(name!=='DOMContentLoaded')add(name,...args)};
  vm.createContext(ctx);vm.runInContext(script,ctx);
  ctx.options={ventilation,actions,tab,items:[
    {id:42,last_name:'BORTAL',first_name:'Ghalem',desired_position:'MAGASINIER',society,phone:'0550',email:'',status:'nouvelle',created_at:'2026-10-07',data:{avisDecision:opinion,notes:'Dossier conservé'}},
    {id:43,last_name:'MENAD',first_name:'Fethi',desired_position:'MAGASINIER',society:SOLUTION,phone:'0551',email:'',status:'nouvelle',created_at:'2026-10-07',data:{avisDecision:'Favorable'}},
  ]};
  const run=code=>vm.runInContext(code,ctx);
  run(`recruteSession={token:'qa',user:{recruitment_access:true,recruitment_ventilation:options.ventilation,authorized_actions:options.actions,authorized_societies:[]}};
    activeTab=options.tab;recruitSection="candidates";tabState[activeTab].items=options.items;tabState[activeTab].total=options.items.length;renderList()`);
  const calls=[],reloads=[],state={ventilationError:null,transferError:null};
  ctx.apiFetch=async(url,options={})=>{
    calls.push({url,method:options.method||'GET',body:options.body?JSON.parse(options.body):null});
    if(url.endsWith('/ventilation-targets'))return {can_ventilate:ventilation,societies:ventilation?targets:[],portfolios:targets};
    if(url.endsWith('/ventilation')){
      if(state.ventilationError)throw new Error(state.ventilationError);
      // Le serveur normalise le libellé et tient l'historique.
      const label=String(JSON.parse(options.body).society||'').toUpperCase()||null;
      return {status:'success',data:{id:42,society:label,data:{avisDecision:opinion,ventilations:[{from:null,to:label,by:'REC01'}]}}};
    }
    if(url.endsWith('/transfer-drh')){if(state.transferError)throw new Error(state.transferError);return {status:'success',data:{already_transferred:false}}}
    throw new Error('Unexpected request '+url);
  };
  ctx.loadTab=async name=>{reloads.push(name)};
  const doc=ctx.document;
  const writes=()=>calls.filter(call=>call.method==='POST');
  const societyCell=id=>doc.querySelector(`#listWrap tr[data-id="${id}"] td[data-label="Société"]`).textContent.trim();
  const rowButtons=id=>[...doc.querySelectorAll(`#listWrap tr[data-id="${id}"] .row-actions button:not(.kebab-btn)`)].map(button=>button.textContent);
  const modal=()=>doc.getElementById('recruitmentModal');
  const modalButtons=()=>[...modal().querySelectorAll('.modal-actions button')].map(button=>[button.textContent,button.disabled]);
  const openRecruitment=async()=>{run('openCandidateRecruitment(42)');await new Promise(resolve=>setTimeout(resolve,0))};
  const choose=value=>{doc.getElementById('recruitmentSociety').value=value};
  return {ctx,doc,run,calls,writes,reloads,state,societyCell,rowButtons,modal,modalButtons,openRecruitment,choose};
}

test('liste : un dossier non ventilé expose une action directe « Ventiler », soumise à la permission',()=>{
  const allowed=setup();
  assert.equal(allowed.societyCell(42),'Non ventilé');
  assert.deepEqual(allowed.rowButtons(42),['Ouvrir','Convoquer','Ventiler','Recruter']);
  const button=allowed.doc.querySelector('#listWrap tr[data-id="42"] .row-ventilate');
  assert.equal(button.getAttribute('onclick'),'openCandidateVentilation(42)','même mécanisme que l’action de menu existante');
  assert.deepEqual(allowed.rowButtons(43),['Ouvrir','Convoquer','Recruter'],'un dossier déjà ventilé garde ses actions');
  // La ventilation ne dépend pas de l'avis du recruteur.
  assert.ok(setup({opinion:''}).rowButtons(42).includes('Ventiler'));
  assert.equal(setup({ventilation:false}).rowButtons(42).includes('Ventiler'),false,'refus par défaut');
  assert.equal(setup({tab:'archive'}).rowButtons(42).includes('Ventiler'),false,'jamais sur un dossier archivé');
  assert.equal(setup({actions:['read']}).doc.querySelector('.row-ventilate'),null);
  assert.match(css,/\.row-ventilate\{/);
});

test('fenêtre Recruter : société manquante → choix parmi les seules sociétés autorisées par le serveur',async()=>{
  const app=setup({targets:[SOLUTION]});
  app.run('openCandidateRecruitment(42)');
  assert.deepEqual(app.modalButtons(),[['Annuler',false],['Ventiler',true],['Ventiler et recruter',true]],'rien n’est actionnable avant la réponse du serveur');
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(app.calls.map(call=>call.url),['/api/drh/candidates/ventilation-targets']);
  const select=app.doc.getElementById('recruitmentSociety');
  assert.deepEqual([...select.options].map(option=>option.value),['',SOLUTION],'aucune société hors périmètre, aucune liste codée en dur');
  assert.equal(select.value,SOLUTION,'une seule cible : elle est présélectionnée');
  assert.equal(select.required,true);
  assert.deepEqual(app.modalButtons(),[['Annuler',false],['Ventiler',false],['Ventiler et recruter',false]]);
  assert.match(app.modal().textContent,/Non ventilé \(vivier Groupe\)/);
  assert.match(app.modal().querySelector('form').getAttribute('onsubmit'),/transmitCandidateToDrh\(this\)/,'« Ventiler et recruter » passe par le workflow de recrutement existant');
  assert.equal(app.modal().querySelector('button[type="submit"]').textContent,'Ventiler et recruter');
});

test('Ventiler seul : statut actualisé immédiatement, message de réussite, recrutement proposé dans la même fenêtre',async()=>{
  const app=setup();
  await app.openRecruitment();
  // Sans société choisie : aucun appel, message explicite.
  await app.run('ventilateCandidateFromRecruitment(document.querySelector("#recruitmentModal form"),false)');
  assert.deepEqual(app.writes(),[]);
  assert.match(app.doc.getElementById('recruitmentError').textContent,/Choisissez la société destinataire/);
  app.choose(SOLUTION);app.doc.getElementById('recruitmentReason').value=' Besoin site pilote ';
  await app.run('ventilateCandidateFromRecruitment(document.querySelector("#recruitmentModal form"),false)');
  assert.deepEqual(app.writes(),[{url:'/api/drh/candidates/42/ventilation',method:'POST',body:{society:SOLUTION,reason:'Besoin site pilote'}}]);
  assert.equal(app.societyCell(42),SOLUTION,'« Non ventilé » disparaît sans rechargement');
  assert.equal(app.rowButtons(42).includes('Ventiler'),false);
  assert.match(app.doc.getElementById('banner').textContent,/Dossier de BORTAL Ghalem ventilé vers IRON GLOBAL SOLUTION/);
  // La fenêtre reste ouverte et passe à la confirmation du recrutement.
  assert.ok(app.modal(),'la fenêtre n’est ni fermée ni rouverte par l’utilisateur');
  assert.equal(app.doc.getElementById('recruitmentSociety'),null);
  assert.match(app.modal().querySelector('.rec-ventilation-ok').textContent,/Dossier ventilé vers IRON GLOBAL SOLUTION/);
  assert.match(app.modal().querySelector('.rec-destination').textContent,/Société destinataire : IRON GLOBAL SOLUTION/);
  assert.deepEqual(app.modalButtons(),[['Annuler',false],['Recruter et transférer à la DRH',false]]);
  assert.equal(app.writes().some(call=>call.url.endsWith('/transfer-drh')),false,'ventiler ne recrute pas');
  assert.deepEqual([...app.run('tabState.new.items[0].data.ventilations.map(entry=>entry.to)')],[SOLUTION]);
  assert.equal(app.run('tabState.new.items[0].data.notes'),'Dossier conservé','les autres données du dossier ne sont pas touchées');
  // Poursuite du recrutement depuis cette même fenêtre.
  await app.run('transmitCandidateToDrh(document.querySelector("#recruitmentModal form"))');
  assert.deepEqual(app.writes().map(call=>call.url),['/api/drh/candidates/42/ventilation','/api/drh/candidates/42/transfer-drh']);
  assert.equal(app.modal(),null);
  assert.match(app.doc.getElementById('banner').textContent,/transféré à la DRH de IRON GLOBAL SOLUTION/);
  assert.deepEqual(app.reloads,['new']);
});

test('Ventiler seul puis fermer : la liste et les compteurs repartent du serveur',async()=>{
  const app=setup();
  await app.openRecruitment();app.choose(SECURITE);
  await app.run('ventilateCandidateFromRecruitment(document.querySelector("#recruitmentModal form"),false)');
  assert.deepEqual(app.reloads,[]);
  app.run('closeCandidateRecruitment()');
  assert.deepEqual(app.reloads,['new']);
  app.run('closeCandidateRecruitment()');
  assert.deepEqual(app.reloads,['new'],'un seul rechargement');
});

test('Ventiler et recruter : ventilation puis transfert DRH existant, dans cet ordre, une seule fois chacun',async()=>{
  const app=setup();
  await app.openRecruitment();app.choose(SECURITE);
  await app.run('transmitCandidateToDrh(document.querySelector("#recruitmentModal form"))');
  assert.deepEqual(app.writes(),[
    {url:'/api/drh/candidates/42/ventilation',method:'POST',body:{society:SECURITE,reason:null}},
    {url:'/api/drh/candidates/42/transfer-drh',method:'POST',body:null},
  ]);
  assert.equal(app.modal(),null);
  assert.match(app.doc.getElementById('banner').textContent,/transféré à la DRH de IRON GLOBAL SECURITE/);
  assert.deepEqual(app.reloads,['new']);
  assert.ok(app.writes().every(call=>!call.url.endsWith('/recruit')),'aucun employé ni contrat créé ici');
});

test('erreur serveur à la ventilation : message métier affiché, rien n’est recruté, la saisie reste possible',async()=>{
  const app=setup();app.state.ventilationError='Société non autorisée pour la ventilation';
  await app.openRecruitment();app.choose(SOLUTION);
  await app.run('transmitCandidateToDrh(document.querySelector("#recruitmentModal form"))');
  assert.deepEqual(app.writes().map(call=>call.url),['/api/drh/candidates/42/ventilation']);
  const error=app.doc.getElementById('recruitmentError');
  assert.equal(error.textContent,'Société non autorisée pour la ventilation');assert.ok(error.classList.contains('show'));
  assert.equal(app.societyCell(42),'Non ventilé');
  assert.equal(app.doc.getElementById('recruitmentSociety').value,SOLUTION);
  assert.deepEqual(app.modalButtons(),[['Annuler',false],['Ventiler',false],['Ventiler et recruter',false]]);
  assert.equal(app.doc.getElementById('banner').textContent,'');
  app.run('closeCandidateRecruitment()');
  assert.deepEqual(app.reloads,[]);
});

test('ventilation réussie mais transfert refusé : le dossier reste ventilé et le transfert peut être repris',async()=>{
  const app=setup();app.state.transferError='Transfert DRH à reprendre : le dossier reste dans Recrutement';
  await app.openRecruitment();app.choose(SOLUTION);
  await app.run('transmitCandidateToDrh(document.querySelector("#recruitmentModal form"))');
  assert.equal(app.societyCell(42),SOLUTION);
  assert.ok(app.modal());
  assert.match(app.doc.getElementById('recruitmentError').textContent,/Transfert DRH à reprendre/);
  assert.deepEqual(app.modalButtons(),[['Annuler',false],['Réessayer le transfert',false]]);
  // La reprise ne ventile pas une seconde fois.
  app.state.transferError=null;
  await app.run('transmitCandidateToDrh(document.querySelector("#recruitmentModal form"))');
  assert.deepEqual(app.writes().map(call=>call.url.split('/').pop()),['ventilation','transfer-drh','transfer-drh']);
  assert.equal(app.modal(),null);
});

test('sans permission de ventilation : explication claire, aucun sélecteur, aucune requête',async()=>{
  const app=setup({ventilation:false});
  await app.openRecruitment();
  assert.match(app.modal().textContent,/Société destinataire requise/);
  assert.match(app.modal().textContent,/n’a pas la permission de ventiler les candidats/);
  assert.match(app.modal().textContent,/Recrutement › Contractualisation/);
  assert.equal(app.modal().querySelector('select'),null);
  assert.deepEqual(app.modalButtons(),[['Annuler',false]]);
  await app.run('ventilateCandidateFromRecruitment(document.querySelector("#recruitmentModal form"),true)');
  await app.run('transmitCandidateToDrh(document.querySelector("#recruitmentModal form"))');
  assert.deepEqual(app.calls,[]);
});

test('aucune société autorisée : la fenêtre le dit et reste bloquée',async()=>{
  const app=setup({targets:[]});
  await app.openRecruitment();
  assert.match(app.doc.getElementById('recruitmentError').textContent,/Aucune société n’est autorisée/);
  assert.deepEqual(app.modalButtons(),[['Annuler',false],['Ventiler',true],['Ventiler et recruter',true]]);
});

test('ventilation indépendante du recrutement : statut actualisé et recrutement proposé depuis le message de réussite',async()=>{
  const app=setup();
  // jsdom n'expose pas les champs nommés directement sur le formulaire, contrairement aux navigateurs.
  const named=form=>Object.assign(form,{society:form.elements.society,reason:form.elements.reason});
  await app.run('openCandidateVentilation(42)');
  const form=named(app.doc.querySelector('#ventilationModal form'));
  assert.deepEqual([...form.society.options].map(option=>option.value),['',SECURITE,SOLUTION]);
  form.society.value=SOLUTION;
  await app.run('saveCandidateVentilation(document.querySelector("#ventilationModal form"))');
  assert.equal(app.doc.getElementById('ventilationModal'),null);
  assert.equal(app.societyCell(42),SOLUTION);
  assert.deepEqual(app.writes().map(call=>call.url),['/api/drh/candidates/42/ventilation']);
  const banner=app.doc.getElementById('banner');
  assert.match(banner.textContent,/ventilé vers IRON GLOBAL SOLUTION/);
  assert.equal(banner.querySelector('button').getAttribute('onclick'),'openCandidateRecruitment(42)');
  assert.deepEqual(app.reloads,['new']);
  // Un dossier sans avis favorable est ventilé sans proposition de recrutement.
  const pending=setup({opinion:'Instance'});
  await pending.run('openCandidateVentilation(42)');
  named(pending.doc.querySelector('#ventilationModal form')).society.value=SECURITE;
  await pending.run('saveCandidateVentilation(document.querySelector("#ventilationModal form"))');
  assert.equal(pending.societyCell(42),SECURITE);
  assert.equal(pending.doc.querySelector('#banner button'),null);
});

test('responsive : bouton de ligne au gabarit mobile, actions de la fenêtre repliables',()=>{
  assert.match(css,/\.rec-ventilation-actions\{flex-wrap:wrap\}/);
  assert.match(css,/\.rec-table \.row-ventilate\{flex:1 1 0/);
});
