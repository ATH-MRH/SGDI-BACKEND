const test=require('node:test');
const assert=require('node:assert/strict');
const {loadPointeur}=require('./load-pointeur');
const fx=require('./pointeur-v6-fixture');
const tick=()=>new Promise(r=>setTimeout(r,30));

test('V7 — totaux et événements canoniques, filtres clavier, maintien orange et nettoyage de session',async()=>{
 const app=loadPointeur();await tick();
 try{
  const T=app.T(),d=app.window.document,post=fx.sitePost(fx.createState(),1);
  post.movements=[{key:'test',type:'REFUS',label:'REFUS',heure:'10:15:00',name:'Agent test',detail:'Retard ≥ 30 minutes'}];
  T.setPost(post);
  assert.equal(d.getElementById('v7Present').textContent,'9');assert.equal(d.getElementById('v7Expected').textContent,'/ 12 attendus');
  assert.match(d.getElementById('eventsList').textContent,/REFUS.*Agent test.*Retard/);
  assert.ok(d.querySelector('.v7-event[data-tone=critical]'));
  d.querySelector('[data-kpi=maintien]').click();assert.equal(d.querySelectorAll('#presentNowList .is-maintien').length,1);
  assert.equal(d.getElementById('manualModeBtn').type,'button');
  assert.match(d.querySelector('.v7-reset').getAttribute('onclick'),/resetManualPanel/);
  T.setPost(null);
  assert.equal(d.getElementById('v7Present').textContent,'—');assert.doesNotMatch(d.getElementById('eventsList').textContent,/Agent test/);
 }finally{app.dom.window.close()}
});

test('V7 — le pied reflète la relève et le réseau réels',async()=>{
 const app=loadPointeur();await tick();
 try{
  app.T().setLiveState('error');assert.ok(!app.window.document.getElementById('v7System').classList.contains('is-ok'));
  app.T().setLiveState('ok');assert.ok(app.window.document.getElementById('v7System').classList.contains('is-ok'));
  assert.notEqual(app.window.document.getElementById('v7Updated').textContent,'—');
 }finally{app.dom.window.close()}
});

test('V7 — une caméra indisponible ne produit pas un état opérationnel vert',async()=>{
 const app=loadPointeur();await tick();
 try{
  app.window.eval('cameraMode=true;scanner=null;');
  app.window.document.getElementById('restartBtn').classList.remove('hidden');
  app.T().setLiveState('ok');
  assert.equal(app.window.document.getElementById('stationStateLabel').textContent,'CAMÉRA INDISPONIBLE');
  assert.equal(app.window.document.getElementById('v7System').classList.contains('is-ok'),false);
  assert.match(app.window.document.querySelector('.header-scanner-status').textContent,/en attente/);
 }finally{app.dom.window.close()}
});
