// Recrutement : « Recruter » choisit la société destinataire d'un dossier non ventilé d'après les
// sociétés autorisées par le serveur (une seule → automatique, plusieurs → sélection obligatoire,
// aucune → blocage), puis confirme. Le vrai script de recrute.html est exécuté ; seuls le réseau et
// le rechargement de liste sont remplacés.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const source=fs.readFileSync(path.join(__dirname,'..','app','static','recrute.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','app','static','recruitment-v6.css'),'utf8');
const script=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]).find(code=>code.includes('const SESSION_KEY='));
const SECURITE='IRON GLOBAL SÉCURITÉ',SOLUTION='IRON GLOBAL SOLUTION',FOUR=[SECURITE,SOLUTION,'SWORD CORPORATION','SWORD CONSTRUCTION'];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

function setup({ventilation=false,actions=['read','create','update'],tab='new',society=null,opinion='Favorable',societies=[SECURITE],options=null,data={}}={}){
  const dom=new JSDOM(source,{runScripts:'outside-only'});
  const ctx={document:dom.window.document,window:{scrollX:0,scrollY:0,scrollTo(){}},URLSearchParams,FormData:dom.window.FormData,
    sessionStorage:{getItem:()=>null,setItem(){}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}}};
  const add=ctx.document.addEventListener.bind(ctx.document);
  ctx.document.addEventListener=(name,...args)=>{if(name!=='DOMContentLoaded')add(name,...args)};
  vm.createContext(ctx);vm.runInContext(script,ctx);
  ctx.options={ventilation,actions,tab,items:[
    {id:42,last_name:'BORTAL',first_name:'Ghalem',desired_position:'MAGASINIER',society,phone:'0550',email:'',status:'nouvelle',created_at:'2026-10-07',data:{avisDecision:opinion,notes:'Dossier conservé',...data}},
    {id:43,last_name:'MENAD',first_name:'Fethi',desired_position:'MAGASINIER',society:SOLUTION,phone:'0551',email:'',status:'nouvelle',created_at:'2026-10-07',data:{avisDecision:'Favorable'}},
  ]};
  const run=code=>vm.runInContext(code,ctx);
  run(`recruteSession={token:'qa',user:{recruitment_access:true,recruitment_ventilation:options.ventilation,authorized_actions:options.actions,authorized_societies:[]}};
    activeTab=options.tab;recruitSection="candidates";tabState[activeTab].items=options.items;tabState[activeTab].total=options.items.length;renderList()`);
  const calls=[],reloads=[],state={optionsError:null,transferError:null,pending:null};
  ctx.apiFetch=async(url,request={})=>{
    calls.push({url,method:request.method||'GET',body:request.body?JSON.parse(request.body):null});
    if(url.endsWith('/transfer-options')){
      if(state.optionsError)throw new Error(state.optionsError);
      return options||{candidate_id:42,society:null,ventilated:false,favorable:true,selection:societies.length===1?'automatic':societies.length?'required':'none',societies,
        can_recruit:societies.length>0,reason:societies.length?null:'Aucune société n’est autorisée pour ce compte : le recrutement est impossible.'};
    }
    if(url.endsWith('/transfer-drh')){
      if(state.pending)await state.pending;
      if(state.transferError){const error=new Error(state.transferError.message);error.code=state.transferError.code||'';throw error}
      return {status:'success',data:{candidate_id:42,society:request.body?JSON.parse(request.body).society.toUpperCase():society,already_transferred:false}};
    }
    throw new Error('Unexpected request '+url);
  };
  ctx.loadTab=async name=>{reloads.push(name)};
  const doc=ctx.document;
  const writes=()=>calls.filter(call=>call.method==='POST');
  const modal=()=>doc.getElementById('recruitmentModal');
  const text=()=>modal().textContent.replace(/\s+/g,' ');
  const buttons=()=>[...modal().querySelectorAll('.modal-actions button')].map(button=>[button.textContent,button.disabled]);
  const summary=()=>Object.fromEntries([...modal().querySelectorAll('.rec-recruit-summary div')].map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent]));
  const open=async()=>{run('openCandidateRecruitment(42)');await tick()};
  const confirm=()=>run('transmitCandidateToDrh(document.querySelector("#recruitmentModal form"))');
  const societyCell=id=>doc.querySelector(`#listWrap tr[data-id="${id}"] td[data-label="Société"]`).textContent.trim();
  return {ctx,doc,run,calls,writes,reloads,state,modal,text,buttons,summary,open,confirm,societyCell};
}

test('CAS A — une seule société autorisée : sélection automatique affichée, rien sans confirmation',async()=>{
  const app=setup({societies:[SECURITE]});
  app.run('openCandidateRecruitment(42)');
  // Avant la réponse du serveur : rien n'est confirmable.
  assert.deepEqual(app.buttons(),[['Annuler',false],['Confirmer le recrutement',true]]);
  await tick();
  assert.deepEqual(app.calls.map(call=>[call.method,call.url]),[['GET','/api/drh/candidates/42/transfer-options']]);
  assert.equal(app.modal().querySelector('select'),null,'aucun choix inutile');
  assert.match(app.text(),/Société destinataire : IRON GLOBAL SÉCURITÉ \(sélection automatique\)/);
  assert.deepEqual(app.summary(),{'Candidat':'BORTAL Ghalem','Poste demandé':'MAGASINIER','Avis du recruteur':'Favorable','Ventilation':'Non ventilé'});
  assert.match(app.text(),/ventilé vers cette société puis transféré à sa DRH/);
  assert.match(app.text(),/Aucun employé ni contrat ne sera créé avant validation par la DRH/);
  assert.deepEqual(app.buttons(),[['Annuler',false],['Confirmer le recrutement',false]]);
  assert.deepEqual(app.writes(),[],'ouvrir la fenêtre ne recrute pas');

  await app.confirm();
  assert.deepEqual(app.writes(),[{url:'/api/drh/candidates/42/transfer-drh',method:'POST',body:{society:SECURITE}}],'un seul appel : le serveur ventile puis transfère');
  assert.equal(app.modal(),null);
  assert.match(app.doc.getElementById('banner').textContent,/Dossier de BORTAL Ghalem transféré à la DRH de IRON GLOBAL SÉCURITÉ/);
  assert.deepEqual(app.reloads,['new']);
});

test('CAS B — plusieurs sociétés autorisées : sélection obligatoire parmi les seules sociétés du serveur',async()=>{
  for(const societies of [[SECURITE,SOLUTION],FOUR]){
    const app=setup({societies});
    await app.open();
    const select=app.doc.getElementById('recruitmentSociety');
    assert.deepEqual([...select.options].map(option=>option.value),['',...societies],'aucune liste codée en dur');
    assert.equal(select.required,true);assert.equal(select.value,'','aucune présélection quand un choix existe');
    assert.doesNotMatch(app.text(),/sélection automatique/);
    assert.deepEqual(app.buttons(),[['Annuler',false],['Confirmer le recrutement',false]]);
    // Sans choix : message, aucune requête.
    await app.confirm();
    assert.deepEqual(app.writes(),[]);
    assert.equal(app.doc.getElementById('recruitmentError').textContent,'Choisissez la société destinataire.');
    select.value=societies.at(-1);
    await app.confirm();
    assert.deepEqual(app.writes(),[{url:'/api/drh/candidates/42/transfer-drh',method:'POST',body:{society:societies.at(-1)}}]);
    assert.equal(app.modal(),null);
  }
});

test('CAS C — aucune société autorisée : message explicite, aucune confirmation possible',async()=>{
  const app=setup({societies:[]});
  await app.open();
  assert.match(app.doc.getElementById('recruitmentError').textContent,/Aucune société n’est autorisée pour ce compte/);
  assert.ok(app.doc.getElementById('recruitmentError').classList.contains('show'));
  assert.match(app.text(),/Société destinataire : Aucune société autorisée/);
  assert.deepEqual(app.buttons(),[['Annuler',false]]);
  await app.confirm();
  assert.deepEqual(app.writes(),[]);
});

test('CAS D — candidat déjà ventilé : société conservée, aucun sélecteur, aucune société envoyée',async()=>{
  const app=setup({society:SOLUTION,societies:FOUR});
  await app.open();
  assert.deepEqual(app.calls,[],'la société enregistrée suffit : aucune option demandée');
  assert.equal(app.modal().querySelector('select'),null);
  assert.match(app.text(),/Société destinataire : IRON GLOBAL SOLUTION/);
  assert.doesNotMatch(app.text(),/sélection automatique/);
  assert.equal(app.summary().Ventilation,'Ventilé');
  await app.confirm();
  assert.deepEqual(app.writes(),[{url:'/api/drh/candidates/42/transfer-drh',method:'POST',body:null}],'jamais de réaffectation depuis « Recruter »');
});

test('sans permission de ventilation : recruter reste possible, ventiler séparément ne l’est pas',async()=>{
  const app=setup({ventilation:false,societies:[SECURITE,SOLUTION]});
  assert.equal(app.doc.querySelector('.row-ventilate'),null,'l’action Ventiler garde sa permission dédiée');
  assert.equal([...app.run('rowActionItems(tabState.new.items[0]).map(a=>a.label)')].includes('Ventiler'),false);
  await app.open();
  assert.doesNotMatch(app.text(),/permission de ventiler/);
  assert.deepEqual(app.buttons(),[['Annuler',false],['Confirmer le recrutement',false]]);
  // Avec la permission, la ventilation indépendante reste proposée en ligne.
  assert.equal(setup({ventilation:true}).doc.querySelector('#listWrap tr[data-id="42"] .row-ventilate').getAttribute('onclick'),'openCandidateVentilation(42)');
});

test('refus du serveur (droits ou avis) : la raison du serveur est affichée, pas de bouton de confirmation',async()=>{
  const reason='Votre compte n’est pas autorisé à recruter un candidat non ventilé : les actions Créer et Modifier du module Recrutement sont requises.';
  const denied=setup({options:{candidate_id:42,society:null,ventilated:false,favorable:true,selection:'none',societies:[],can_recruit:false,reason}});
  await denied.open();
  assert.equal(denied.doc.getElementById('recruitmentError').textContent,reason);
  assert.deepEqual(denied.buttons(),[['Annuler',false]]);
  // Options indisponibles (réseau) : blocage explicite, jamais de recrutement à l'aveugle.
  const offline=setup();offline.state.optionsError='Une erreur est survenue';
  await offline.open();
  assert.equal(offline.doc.getElementById('recruitmentError').textContent,'Une erreur est survenue');
  assert.deepEqual(offline.buttons(),[['Annuler',false]]);
  await offline.confirm();
  assert.deepEqual(offline.writes(),[]);
});

test('liste en retard : un dossier ventilé entre-temps garde la société du serveur',async()=>{
  const app=setup({options:{candidate_id:42,society:SOLUTION,ventilated:true,favorable:true,selection:'assigned',societies:[SOLUTION],can_recruit:true,reason:null}});
  await app.open();
  assert.equal(app.societyCell(42),SOLUTION);
  assert.match(app.text(),/Société destinataire : IRON GLOBAL SOLUTION/);
  await app.confirm();
  assert.deepEqual(app.writes().map(call=>call.body),[null]);
});

test('double clic : bouton désactivé avec indicateur, une seule requête',async()=>{
  const app=setup({societies:[SECURITE,SOLUTION]});
  await app.open();
  app.doc.getElementById('recruitmentSociety').value=SOLUTION;
  let release;app.state.pending=new Promise(resolve=>{release=resolve});
  const first=app.confirm();await tick();
  const button=app.modal().querySelector('button[type="submit"]');
  assert.deepEqual([button.disabled,button.textContent,button.getAttribute('aria-busy'),button.classList.contains('is-busy')],[true,'RECRUTEMENT EN COURS…','true',true]);
  await app.confirm();await app.confirm();
  assert.equal(app.writes().length,1);
  release();await first;
  assert.equal(app.writes().length,1);
  assert.equal(app.modal(),null);
  assert.match(css,/\.rec-recruit-confirm\.is-busy::before\{[^}]*animation:rec-recruit-spin/);
});

test('échec avant ventilation (réseau, société refusée) : message précis, sélection préservée, nouvel essai possible',async()=>{
  const app=setup({societies:FOUR});
  await app.open();
  app.doc.getElementById('recruitmentSociety').value='SWORD CORPORATION';
  app.state.transferError={message:'Société non autorisée pour ce recrutement'};
  await app.confirm();
  const error=app.doc.getElementById('recruitmentError');
  assert.equal(error.textContent,'Société non autorisée pour ce recrutement');assert.ok(error.classList.contains('show'));
  assert.equal(app.doc.getElementById('recruitmentSociety').value,'SWORD CORPORATION','la sélection est conservée');
  assert.equal(app.societyCell(42),'Non ventilé');
  const button=app.modal().querySelector('button[type="submit"]');
  assert.deepEqual([button.disabled,button.textContent,button.hasAttribute('aria-busy'),button.classList.contains('is-busy')],[false,'Confirmer le recrutement',false,false]);
  assert.deepEqual(app.reloads,[]);assert.equal(app.doc.getElementById('banner').textContent,'');
  app.state.transferError=null;
  await app.confirm();
  assert.deepEqual(app.writes().map(call=>call.body),[{society:'SWORD CORPORATION'},{society:'SWORD CORPORATION'}]);
  assert.equal(app.modal(),null);
});

test('ventilation acquise mais transfert DRH en échec : la société n’est plus à choisir, la reprise ne ventile pas deux fois',async()=>{
  const app=setup({societies:[SECURITE,SOLUTION]});
  await app.open();
  app.doc.getElementById('recruitmentSociety').value=SOLUTION;
  app.state.transferError={message:'Transfert DRH à reprendre : le dossier reste dans Recrutement',code:'TRANSFERT_DRH_A_REPRENDRE'};
  await app.confirm();
  assert.ok(app.modal(),'la fenêtre reste ouverte');
  assert.equal(app.modal().querySelector('select'),null);
  assert.match(app.text(),/Société destinataire : IRON GLOBAL SOLUTION/);
  assert.equal(app.summary().Ventilation,'Ventilé');
  assert.match(app.doc.getElementById('recruitmentError').textContent,/Transfert DRH à reprendre/);
  assert.deepEqual(app.buttons(),[['Annuler',false],['Réessayer le transfert',false]]);
  assert.equal(app.societyCell(42),SOLUTION,'la liste reflète la ventilation acquise');
  app.state.transferError=null;
  await app.confirm();
  assert.deepEqual(app.writes().map(call=>call.body),[{society:SOLUTION},null],'la reprise ne renvoie aucune société');
  assert.equal(app.modal(),null);
  assert.deepEqual(app.reloads,['new']);
});

test('ventilation indépendante (avec permission) : statut actualisé et recrutement proposé depuis le message de réussite',async()=>{
  const app=setup({ventilation:true});
  app.ctx.apiFetch=async(url,request={})=>{
    app.calls.push({url,method:request.method||'GET'});
    if(url.endsWith('/ventilation-targets'))return {can_ventilate:true,societies:[SECURITE,SOLUTION],portfolios:[SECURITE,SOLUTION]};
    return {status:'success',data:{id:42,society:JSON.parse(request.body).society,data:{ventilations:[{to:SOLUTION}]}}};
  };
  // jsdom n'expose pas les champs nommés directement sur le formulaire, contrairement aux navigateurs.
  const named=form=>Object.assign(form,{society:form.elements.society,reason:form.elements.reason});
  await app.run('openCandidateVentilation(42)');
  named(app.doc.querySelector('#ventilationModal form')).society.value=SOLUTION;
  await app.run('saveCandidateVentilation(document.querySelector("#ventilationModal form"))');
  assert.equal(app.societyCell(42),SOLUTION);
  const banner=app.doc.getElementById('banner');
  assert.match(banner.textContent,/ventilé vers IRON GLOBAL SOLUTION/);
  assert.equal(banner.querySelector('button').getAttribute('onclick'),'openCandidateRecruitment(42)');
});

test('responsive : résumé sur une colonne en petit écran, bouton de ligne au gabarit mobile',()=>{
  assert.match(css,/@media\(max-width:480px\)\{[^}]*\.rec-recruit-summary\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css,/\.rec-table \.row-ventilate\{flex:1 1 0/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});
