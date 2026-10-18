// ABANDON POSTE (V6) : contrôle serveur, puis fenêtre de confirmation (employé, matricule, site,
// heure de départ, fin prévue) avec motif OBLIGATOIRE saisi par l'agent ; ANNULER / CONFIRMER.
// Si une condition manque, aucune fenêtre, aucune écriture, raison exacte affichée.
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadPointeur}=require('./load-pointeur');
const tick=()=>new Promise(r=>setTimeout(r,40));
const employee={id:17,matricule:'E17',nom:'Agent',prenom:'Test',societe:'IGS',site:'Site',poste:'Agent'};
const context={employee_id:17,employee_name:'Agent Test',matricule:'E17',society:'IGS',site_id:12,site_name:'Site Nord',position:'Agent',shift_id:31,shift:'APRES_MIDI',scheduled_start_at:'2026-10-05T14:00:00+01:00',scheduled_end_at:'2026-10-05T22:00:00+01:00',actual_departure_at:'2026-10-05T20:35:00+01:00',remaining_minutes:85,threshold_minutes:60,applicable:true};
const saved={...context,success:true,message:'ABANDON DE POSTE ENREGISTRÉ',observation:'Départ constaté',notifications:{OPS:{status:'CREATED'},DRH:{status:'CREATED'}}};
const opened=[];
test.afterEach(()=>{while(opened.length)opened.pop().dom.window.close()});
async function boot({ctx=()=>({ok:true,status:200,json:async()=>context}),post}={}){
  const writes=[],calls=[];
  const t=loadPointeur({session:{token:'test',username:'PTG',user:{username:'PTG'}},fetch:async(url,options={})=>{
    if(url.includes('/abandon/context')){calls.push('context');return ctx()}
    if(url.endsWith('/abandon')){calls.push('post');writes.push(JSON.parse(options.body));return post?post():{ok:true,status:201,json:async()=>saved}}
    if(url.includes('attendance-sites'))return {ok:true,status:200,json:async()=>[{id:12,name:'Site'}]};
    return {ok:true,status:200,json:async()=>({})};
  }});opened.push(t);await tick();t.window.__pointeurTest.stopLivePolling();
  t.window.__pointeurTest.setManualResults([employee]);t.window.__pointeurTest.selectManualResult(0);await tick();
  const doc=t.window.document;
  return {...t,writes,calls,doc,
    feedback:()=>doc.getElementById('manualFeedback').textContent,
    modalOpen:()=>!doc.getElementById('abandonOverlay').classList.contains('hidden'),
    motif:(v)=>{doc.getElementById('abandonObservation').value=v;t.window.updateAbandonConfirmation()}};
}
const refusal=detail=>()=>({ok:false,status:409,json:async()=>({detail})});

test('confirmation : récapitulatif, motif obligatoire saisi, aucune écriture avant CONFIRMER',async()=>{
  const t=await boot();
  assert.equal(t.doc.querySelectorAll('.manual-actions button').length,3);
  await t.window.openAbandonModal();
  assert.deepEqual(t.calls,['context']);assert.equal(t.writes.length,0);
  assert.equal(t.modalOpen(),true);
  const facts=[...t.doc.querySelectorAll('#abandonFacts dt')].map((dt)=>[dt.textContent,dt.nextElementSibling.textContent]);
  assert.deepEqual(facts,[['Employé','Agent Test'],['Matricule','E17'],['Site','Site Nord'],['Heure de départ','20:35'],['Fin prévue de la vacation','22:00'],['Temps restant','1 h 25']]);
  assert.equal(t.doc.getElementById('abandonObservation').value,'','aucun motif pré-rempli');
  assert.equal(t.doc.activeElement.id,'abandonObservation');
  assert.equal(t.doc.getElementById('abandonConfirm').textContent,'CONFIRMER L’ABANDON');
  assert.equal(t.doc.getElementById('abandonCancel').textContent,'ANNULER');
  assert.equal(t.doc.getElementById('abandonConfirm').disabled,true);
  await t.window.confirmAbandon();assert.equal(t.writes.length,0,'sans motif : rien');
  t.motif('   ');assert.equal(t.doc.getElementById('abandonConfirm').disabled,true);
  await t.window.confirmAbandon();assert.equal(t.writes.length,0,'motif vide : rien');
  t.motif('Départ constaté');assert.equal(t.doc.getElementById('abandonConfirm').disabled,false);
  await t.window.confirmAbandon();
  assert.deepEqual(t.writes,[{employee_id:17,site_id:12,society:'IGS',shift_id:31,observation:'Départ constaté'}]);
  assert.equal(t.modalOpen(),false);
  assert.match(t.feedback(),/ABANDON DE POSTE ENREGISTRÉ/);assert.match(t.feedback(),/Départ constaté/);
  assert.match(t.feedback(),/OPS informé/);assert.match(t.feedback(),/DRH informée/);
});
test('aucun motif automatique, même si une observation de saisie manuelle existe',async()=>{
  const t=await boot();
  t.doc.getElementById('manualObservation').value='Observation de la saisie manuelle';
  await t.window.openAbandonModal();
  assert.equal(t.doc.getElementById('abandonObservation').value,'');
  await t.window.confirmAbandon();assert.equal(t.writes.length,0);
  assert.doesNotMatch(require('fs').readFileSync(require('path').join(__dirname,'../app/static/pointeur.html'),'utf8'),/Départ anticipé constaté au poste de pointage/);
});
test('ANNULER et Échap : aucune écriture, focus rendu au bouton',async()=>{
  const t=await boot();
  await t.window.openAbandonModal();t.motif('Motif');t.doc.getElementById('abandonCancel').click();
  assert.equal(t.modalOpen(),false);assert.equal(t.writes.length,0);assert.equal(t.doc.activeElement.id,'manualAbandonBtn');
  await t.window.openAbandonModal();
  t.doc.getElementById('abandonObservation').dispatchEvent(new t.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(t.modalOpen(),false);assert.equal(t.writes.length,0);
});
test('sans vacation valide : raison exacte, pas de fenêtre, aucune écriture',async()=>{
  const t=await boot({ctx:refusal('Abandon de poste refusé : aucune vacation valide enregistrée')});
  await t.window.openAbandonModal();
  assert.equal(t.modalOpen(),false);assert.equal(t.writes.length,0);
  assert.match(t.feedback(),/aucune vacation valide enregistrée/);
});
test('moins de 60 minutes : raison exacte avec temps restant et seuil, pas de fenêtre',async()=>{
  const t=await boot({ctx:()=>({ok:true,status:200,json:async()=>({...context,remaining_minutes:45.5,applicable:false})})});
  await t.window.openAbandonModal();
  assert.equal(t.modalOpen(),false);assert.equal(t.writes.length,0);
  assert.match(t.feedback(),/il reste 45 min avant la fin prévue du service \(22:00\)\. Le seuil requis est de 60 minutes/);
});
test('seuil configuré côté serveur : affiché et appliqué',async()=>{
  const t=await boot({ctx:()=>({ok:true,status:200,json:async()=>({...context,threshold_minutes:90,applicable:false})})});
  await t.window.openAbandonModal();
  assert.equal(t.writes.length,0);assert.match(t.feedback(),/90 minutes/);
  assert.match(t.doc.getElementById('abandonThresholdCaption').textContent,/90 min/);
});
test('abandon déjà enregistré : prise de service close, refus sans écriture',async()=>{
  const t=await boot({ctx:refusal('Abandon de poste refusé : aucune prise de service ouverte')});
  await t.window.openAbandonModal();
  assert.equal(t.modalOpen(),false);assert.equal(t.writes.length,0);assert.match(t.feedback(),/aucune prise de service ouverte/);
});
test('double clic sur CONFIRMER : une seule requête ; erreur réseau puis nouvel essai identique',async()=>{
  let release;let tries=0;
  const t=await boot({post:()=>{tries++;if(tries===1)return new Promise(r=>{release=r});return {ok:true,status:201,json:async()=>({...saved,duplicate:true})}}});
  await t.window.openAbandonModal();t.motif('Motif');
  const first=t.window.confirmAbandon();await t.window.confirmAbandon();
  assert.equal(t.writes.length,1);
  assert.equal(t.doc.getElementById('manualPointerBtn').disabled,true);assert.equal(t.doc.getElementById('abandonCancel').disabled,true);
  release({ok:false,status:503,json:async()=>({detail:'Erreur temporaire'})});await first;
  assert.equal(t.modalOpen(),true,'la fenêtre reste ouverte');
  assert.match(t.doc.getElementById('abandonError').textContent,/Erreur temporaire/);
  assert.equal(t.doc.getElementById('abandonObservation').value,'Motif','motif conservé');
  await t.window.confirmAbandon();assert.equal(t.writes.length,2);assert.deepEqual(t.writes[0],t.writes[1]);
  assert.match(t.feedback(),/ABANDON DE POSTE ENREGISTRÉ/);
});
test('refus final du serveur affiché dans la fenêtre, jamais requalifié en absence',async()=>{
  const t=await boot({post:refusal('Abandon de poste non applicable : il reste 59 minutes avant la fin prévue du service. Le seuil requis est de 60 minutes.')});
  await t.window.openAbandonModal();t.motif('Motif');await t.window.confirmAbandon();
  assert.match(t.doc.getElementById('abandonError').textContent,/il reste 59 minutes/);assert.equal(t.writes.length,1);
  assert.ok(!('action' in t.writes[0]));assert.equal(t.modalOpen(),true);
});
test('compte sans saisie manuelle : actions désactivées, aucune requête',async()=>{
  const post={site:'Site',status:'OFFICIAL',current:null,next:null,maintien:null,kpi:{expected:null,present:0,absent:null,excused:0,maintien:0,anomalies:0},present:[],expected:null,todo:[],movements:[],activity:{refused_today:0},permissions:{manual_entry:false}};
  const t=await boot();
  t.window.__pointeurTest.setPost(post);
  t.window.__pointeurTest.setManualResults([employee]);t.window.__pointeurTest.selectManualResult(0);await tick();
  for(const id of ['manualPointerBtn','manualAbsentBtn','manualAbandonBtn'])assert.equal(t.doc.getElementById(id).disabled,true,id);
  assert.match(t.feedback(),/non autorisée/);
  await t.window.openAbandonModal();assert.deepEqual(t.calls,[]);assert.equal(t.modalOpen(),false);
});
test('changement d’employé ou déconnexion : fenêtre fermée sans écriture',async()=>{
  const t=await boot();
  await t.window.openAbandonModal();t.motif('Motif');
  t.window.resetManualPanel();
  assert.equal(t.modalOpen(),false);assert.equal(t.writes.length,0);
});
