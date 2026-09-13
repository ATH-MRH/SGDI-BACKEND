const test=require('node:test');
const assert=require('node:assert/strict');
const {loadSgdiApp}=require('./load-app');
function setup(){
 const a=loadSgdiApp(['renderDevisEditor','devisNewClientOpen','devisNewClientSave']);assert.equal(a.loadError,null);
 a.T().setSession({username:'TEST',role:'admin',societe:'IRON GLOBAL SOLUTION'});a.T().setDb({devis:[],clients:[]});
 a.window.__devisEditorId='new';a.T().renderDevisEditor(a.window.document.getElementById('view'));return a;
}
function fill(a){a.T().devisNewClientOpen();const f=a.window.document.getElementById('dev-new-client');for(const e of f.querySelectorAll('[required]'))e.value='Test';return f;}
test('création depuis devis : sélection après succès, saisies conservées',async()=>{
 const a=setup(),w=a.window,d=w.document;try{
 d.getElementById('dev-objet').value='Transport en cours';const view=d.getElementById('view');const f=fill(a);
 w.eval('persistClientToPostgres=async c=>{window.clientPayload={...c};c.backendId=123;return c}');
 assert.equal(await a.T().devisNewClientSave(f),true);
 assert.equal(d.getElementById('view'),view);assert.equal(d.getElementById('dev-objet').value,'Transport en cours');
 assert.equal(d.getElementById('dev-clientId').selectedOptions[0].textContent,'Test');
 assert.equal(w.clientPayload.societe,'IRON GLOBAL SOLUTION');assert.equal(d.getElementById('dev-new-client'),null);
 }finally{w.close()}
});
test('échec serveur et double clic : pas de faux client sélectionné, formulaire conservé',async()=>{
 const a=setup(),w=a.window,d=w.document;try{const f=fill(a);
 w.eval('window.calls=0;persistClientToPostgres=()=>{window.calls++;return new Promise((resolve,reject)=>window.rejectClient=reject)}');
 const pending=a.T().devisNewClientSave(f);await a.T().devisNewClientSave(f);assert.equal(w.calls,1);
 w.rejectClient(new Error('502'));assert.equal(await pending,false);
 assert.equal(d.getElementById('dev-clientId').options.length,1);assert.equal(f.elements.nom.value,'Test');
 assert.match(f.querySelector('[role=alert]').textContent,/502/);assert.equal(f.querySelector('[type=submit]').disabled,false);
 }finally{w.close()}
});
test('changement société et contexte facturation : création refusée',async()=>{
 const a=setup(),w=a.window;try{const f=fill(a);w.eval('persistClientToPostgres=async()=>{throw new Error("API ne doit pas être appelée")}');
 a.T().setSession({username:'TEST',role:'admin',societe:'AUTRE'});await a.T().devisNewClientSave(f);assert.match(f.querySelector('[role=alert]').textContent,/société/);
 w.closeModal();w.__FAC_AUTONOMOUS_APP__=true;a.T().devisNewClientOpen();assert.equal(w.document.getElementById('dev-new-client'),null);
 }finally{w.close()}
});
