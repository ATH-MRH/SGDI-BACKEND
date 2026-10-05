const test=require('node:test');
const assert=require('node:assert/strict');
const {loadPointeur}=require('./load-pointeur');
const tick=()=>new Promise(r=>setTimeout(r,40));
const employee={id:17,matricule:'E17',nom:'Agent',prenom:'Test',societe:'IGS',site:'Site',poste:'Agent'};
const context={employee_id:17,employee_name:'Agent Test',matricule:'E17',society:'IGS',site_id:12,site_name:'Site',position:'Agent',shift_id:31,shift:'APRES_MIDI',scheduled_start_at:'2026-10-05T14:00:00+01:00',scheduled_end_at:'2026-10-05T22:00:00+01:00',actual_departure_at:'2026-10-05T20:35:00+01:00',remaining_minutes:85,threshold_minutes:60,applicable:true};
const opened=[];
test.afterEach(()=>{while(opened.length)opened.pop().dom.window.close()});
async function boot({ctx=context,post}={}){
  const writes=[];
  const t=loadPointeur({session:{token:'test',username:'PTG',user:{username:'PTG'}},fetch:async(url,options={})=>{
    if(url.includes('/abandon/context'))return {ok:true,status:200,json:async()=>ctx};
    if(url.endsWith('/abandon')){writes.push(JSON.parse(options.body));return post?post():{ok:true,status:201,json:async()=>({...context,notifications:{OPS:{status:'CREATED'},DRH:{status:'CREATED'}}})}}
    if(url.includes('attendance-sites'))return {ok:true,status:200,json:async()=>[{id:12,name:'Site'}]};
    return {ok:true,status:200,json:async()=>({})};
  }});opened.push(t);await tick();t.window.__pointeurTest.stopLivePolling();
  t.window.__pointeurTest.setManualResults([employee]);t.window.__pointeurTest.selectManualResult(0);await tick();
  return {...t,writes,doc:t.window.document};
}
test('trois actions et confirmation : aucun enregistrement au premier clic',async()=>{
  const t=await boot();
  assert.equal(t.doc.querySelectorAll('.manual-actions button').length,3);
  await t.window.openAbandonModal();assert.equal(t.writes.length,0);
  assert.equal(t.doc.getElementById('abandonConfirm').disabled,true);
  assert.match(t.doc.getElementById('abandonFacts').textContent,/1 h 25/);
  await t.window.confirmAbandon();assert.equal(t.writes.length,0);
  t.doc.getElementById('abandonObservation').value='   ';t.window.updateAbandonConfirmation();assert.equal(t.doc.getElementById('abandonConfirm').disabled,true);
  t.doc.getElementById('abandonObservation').value='Départ constaté';t.window.updateAbandonConfirmation();assert.equal(t.doc.getElementById('abandonConfirm').disabled,false);
  await t.window.confirmAbandon();assert.equal(t.writes.length,1);assert.equal(t.writes[0].shift_id,31);
  assert.match(t.doc.getElementById('manualFeedback').textContent,/ABANDON DE POSTE ENREGISTRÉ/);
  assert.match(t.doc.getElementById('manualFeedback').textContent,/OPS informé/);
  assert.match(t.doc.getElementById('manualFeedback').textContent,/DRH informée/);
});
test('annulation sans écriture et retour du focus',async()=>{
  const t=await boot();await t.window.openAbandonModal();t.window.closeAbandonModal();
  assert.ok(t.doc.getElementById('abandonOverlay').classList.contains('hidden'));assert.equal(t.writes.length,0);
  assert.equal(t.doc.activeElement.id,'manualAbandonBtn');
});
test('seuil serveur configurable : confirmation désactivée sous le seuil',async()=>{
  const t=await boot({ctx:{...context,threshold_minutes:90,applicable:false}});await t.window.openAbandonModal();
  t.doc.getElementById('abandonObservation').value='Motif';t.window.updateAbandonConfirmation();
  assert.equal(t.doc.getElementById('abandonConfirm').disabled,true);
  assert.match(t.doc.getElementById('abandonError').textContent,/90 minutes/);
  assert.match(t.doc.getElementById('abandonThresholdCaption').textContent,/90 min/);
  await t.window.confirmAbandon();assert.equal(t.writes.length,0);
});
test('double clic et erreur réseau : retry sur la même vacation',async()=>{
  let release;let tries=0;
  const t=await boot({post:()=>{tries++;if(tries===1)return new Promise(r=>{release=r});return {ok:true,status:201,json:async()=>({...context,duplicate:true,notifications:{OPS:{status:'CREATED'},DRH:{status:'CREATED'}}})}}});
  await t.window.openAbandonModal();t.doc.getElementById('abandonObservation').value='Motif';t.window.updateAbandonConfirmation();
  const first=t.window.confirmAbandon();await t.window.confirmAbandon();assert.equal(t.writes.length,1);
  assert.equal(t.doc.getElementById('manualPointerBtn').disabled,true);
  release({ok:false,status:503,json:async()=>({detail:'Erreur temporaire'})});await first;
  assert.match(t.doc.getElementById('abandonError').textContent,/Erreur temporaire/);
  await t.window.confirmAbandon();assert.equal(t.writes.length,2);assert.deepEqual(t.writes[0],t.writes[1]);
});
test('refus final backend affiché sans requalification en absence',async()=>{
  const t=await boot({post:()=>({ok:false,status:409,json:async()=>({detail:'Abandon de poste non applicable : il reste 59 minutes.'})})});
  await t.window.openAbandonModal();t.doc.getElementById('abandonObservation').value='Motif';t.window.updateAbandonConfirmation();await t.window.confirmAbandon();
  assert.match(t.doc.getElementById('abandonError').textContent,/59 minutes/);assert.equal(t.writes.length,1);
  assert.ok(!('action' in t.writes[0]));assert.ok(!t.doc.getElementById('abandonOverlay').classList.contains('hidden'));
});
