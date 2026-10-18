// ABANDON POSTE (V6) : traité dès le clic, sans fenêtre de confirmation, si le serveur confirme
// toutes les conditions ; sinon aucune écriture et la raison exacte est affichée.
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadPointeur}=require('./load-pointeur');
const tick=()=>new Promise(r=>setTimeout(r,40));
const employee={id:17,matricule:'E17',nom:'Agent',prenom:'Test',societe:'IGS',site:'Site',poste:'Agent'};
const context={employee_id:17,employee_name:'Agent Test',matricule:'E17',society:'IGS',site_id:12,site_name:'Site',position:'Agent',shift_id:31,shift:'APRES_MIDI',scheduled_start_at:'2026-10-05T14:00:00+01:00',scheduled_end_at:'2026-10-05T22:00:00+01:00',actual_departure_at:'2026-10-05T20:35:00+01:00',remaining_minutes:85,threshold_minutes:60,applicable:true};
const saved={...context,success:true,message:'ABANDON DE POSTE ENREGISTRÉ',notifications:{OPS:{status:'CREATED'},DRH:{status:'CREATED'}}};
const opened=[];
test.afterEach(()=>{while(opened.length)opened.pop().dom.window.close()});
async function boot({ctx=()=>({ok:true,status:200,json:async()=>context}),post,live}={}){
  const writes=[],calls=[];
  const t=loadPointeur({session:{token:'test',username:'PTG',user:{username:'PTG'}},fetch:async(url,options={})=>{
    if(url.includes('/abandon/context')){calls.push('context');return ctx()}
    if(url.endsWith('/abandon')){calls.push('post');writes.push(JSON.parse(options.body));return post?post():{ok:true,status:201,json:async()=>saved}}
    if(url.includes('attendance-sites'))return {ok:true,status:200,json:async()=>[{id:12,name:'Site'}]};
    if(url.includes('attendance-live')&&live)return {ok:true,status:200,json:async()=>live};
    return {ok:true,status:200,json:async()=>({})};
  }});opened.push(t);await tick();t.window.__pointeurTest.stopLivePolling();
  t.window.__pointeurTest.setManualResults([employee]);t.window.__pointeurTest.selectManualResult(0);await tick();
  return {...t,writes,calls,doc:t.window.document,feedback:()=>t.window.document.getElementById('manualFeedback').textContent};
}
const refusal=detail=>()=>({ok:false,status:409,json:async()=>({detail})});

test('abandon valide : un seul clic, contrôle serveur puis enregistrement, sans modale',async()=>{
  const t=await boot();
  assert.equal(t.doc.querySelectorAll('.manual-actions button').length,3);
  assert.equal(t.doc.getElementById('abandonOverlay'),null,'plus de fenêtre de confirmation');
  await t.window.recordAbandon();
  assert.deepEqual(t.calls,['context','post']);
  assert.equal(t.writes.length,1);
  assert.deepEqual(t.writes[0],{employee_id:17,site_id:12,society:'IGS',shift_id:31,observation:'Départ anticipé constaté au poste de pointage'});
  assert.match(t.feedback(),/ABANDON DE POSTE ENREGISTRÉ/);
  assert.match(t.feedback(),/OPS informé/);assert.match(t.feedback(),/DRH informée/);
  assert.match(t.feedback(),/20:35/);assert.match(t.feedback(),/1 h 25/);
  assert.ok(t.doc.getElementById('manualFeedback').classList.contains('success'));
});
test('observation saisie par l’agent : transmise telle quelle',async()=>{
  const t=await boot();
  t.doc.getElementById('manualObservation').value='Malaise, évacué par le chef de poste';
  await t.window.recordAbandon();
  assert.equal(t.writes[0].observation,'Malaise, évacué par le chef de poste');
});
test('sans vacation valide : refus exact, aucune écriture',async()=>{
  const t=await boot({ctx:refusal('Abandon de poste refusé : aucune vacation valide enregistrée')});
  await t.window.recordAbandon();
  assert.equal(t.writes.length,0);assert.deepEqual(t.calls,['context']);
  assert.match(t.feedback(),/aucune vacation valide enregistrée/);
  assert.ok(t.doc.getElementById('manualFeedback').classList.contains('error'));
});
test('moins de 60 minutes avant la fin : refus avec temps restant et seuil, aucune écriture',async()=>{
  const t=await boot({ctx:()=>({ok:true,status:200,json:async()=>({...context,remaining_minutes:45.5,applicable:false})})});
  await t.window.recordAbandon();
  assert.equal(t.writes.length,0);
  assert.match(t.feedback(),/il reste 45 min avant la fin prévue du service \(22:00\)/);
  assert.match(t.feedback(),/seuil requis est de 60 minutes/);
});
test('seuil configuré côté serveur : affiché et appliqué',async()=>{
  const t=await boot({ctx:()=>({ok:true,status:200,json:async()=>({...context,threshold_minutes:90,applicable:false})})});
  await t.window.recordAbandon();
  assert.equal(t.writes.length,0);
  assert.match(t.feedback(),/90 minutes/);assert.match(t.doc.getElementById('abandonThresholdCaption').textContent,/90 min/);
});
test('abandon déjà enregistré : la prise de service est close, refus sans écriture',async()=>{
  const t=await boot({ctx:refusal('Abandon de poste refusé : aucune prise de service ouverte')});
  await t.window.recordAbandon();
  assert.equal(t.writes.length,0);assert.match(t.feedback(),/aucune prise de service ouverte/);
});
test('réponse idempotente du serveur (même vacation) : un seul événement affiché comme enregistré',async()=>{
  const t=await boot({post:()=>({ok:true,status:201,json:async()=>({...saved,duplicate:true})})});
  await t.window.recordAbandon();
  assert.match(t.feedback(),/ABANDON DE POSTE ENREGISTRÉ/);
});
test('double clic : une seule requête ; panne réseau puis nouvel essai identique',async()=>{
  let release;let tries=0;
  const t=await boot({post:()=>{tries++;if(tries===1)return new Promise(r=>{release=r});return {ok:true,status:201,json:async()=>({...saved,duplicate:true})}}});
  const first=t.window.recordAbandon();await tick();await t.window.recordAbandon();
  assert.equal(t.writes.length,1);
  assert.equal(t.doc.getElementById('manualPointerBtn').disabled,true);
  assert.equal(t.doc.getElementById('manualAbandonBtn').disabled,true);
  release({ok:false,status:503,json:async()=>({detail:'Erreur temporaire'})});await first;
  assert.match(t.feedback(),/Erreur temporaire/);
  assert.equal(t.doc.getElementById('manualAbandonBtn').disabled,false);
  await t.window.recordAbandon();assert.equal(t.writes.length,2);assert.deepEqual(t.writes[0],t.writes[1]);
});
test('refus final du serveur affiché, jamais requalifié en absence',async()=>{
  const t=await boot({post:refusal('Abandon de poste non applicable : il reste 59 minutes avant la fin prévue du service. Le seuil requis est de 60 minutes.')});
  await t.window.recordAbandon();
  assert.match(t.feedback(),/il reste 59 minutes/);assert.equal(t.writes.length,1);
  assert.ok(!('action' in t.writes[0]));
});
test('compte sans saisie manuelle : actions désactivées, aucune requête',async()=>{
  const post={site:'Site',status:'OFFICIAL',current:null,next:null,maintien:null,kpi:{expected:null,present:0,absent:null,excused:0,maintien:0,anomalies:0},present:[],expected:null,todo:[],movements:[],activity:{refused_today:0},permissions:{manual_entry:false}};
  const t=await boot();
  t.window.__pointeurTest.setPost(post);
  t.window.__pointeurTest.setManualResults([employee]);t.window.__pointeurTest.selectManualResult(0);await tick();
  for(const id of ['manualPointerBtn','manualAbsentBtn','manualAbandonBtn'])assert.equal(t.doc.getElementById(id).disabled,true,id);
  assert.match(t.feedback(),/non autorisée/);
  await t.window.recordAbandon();assert.deepEqual(t.calls,[]);
});
