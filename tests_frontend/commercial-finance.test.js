const test=require('node:test');
const assert=require('node:assert/strict');
const {loadSgdiApp}=require('./load-app');

test('commercial finance panel shows server totals for the active society only',()=>{
  const app=loadSgdiApp(['commercialContractFinancePanel']);
  assert.equal(app.loadError,null);
  app.T().setSession({username:'TEST',societe:'IRON GLOBAL SOLUTION'});
  app.window.SGDI_SIDEBAR_STATS={scope:{active_society:'IRON GLOBAL SOLUTION'},commercial:{contracts_active:3},facturation:{invoices_issued:2,invoiced_ttc:120.3,payments_total:2,payments_amount:30.3}};
  const html=app.T().commercialContractFinancePanel();
  assert.match(html,/Contrats actifs/);
  assert.match(html,/<strong>3<\/strong>/);
  assert.match(html,/120,30/);
  assert.match(html,/30,30/);
  assert.doesNotMatch(html,/Pipeline commercial|indisponibles/);
  app.T().setSession({username:'TEST',societe:'SWORD CORPORATION'});
  const other=app.T().commercialContractFinancePanel();
  assert.match(other,/indisponibles/);
  assert.doesNotMatch(other,/120,30|30,30/);
  app.window.SGDI_SIDEBAR_STATS={scope:{active_society:'SWORD CORPORATION'},commercial:{contracts_active:0},facturation:{invoices_issued:0,invoiced_ttc:0,payments_total:0,payments_amount:0}};
  assert.doesNotMatch(app.T().commercialContractFinancePanel(),/indisponibles/);
  app.window.close();
});

test('stats refresh updates only the visible commercial panel and stops after destroy',()=>{
  const app=loadSgdiApp(['commercialContractFinancePanel','refreshCommercialFinancePanel','commercialModuleDestroy']);
  const w=app.window,t=app.T();
  t.setSession({username:'TEST',societe:'IRON GLOBAL SOLUTION'});
  w.history.replaceState(null,'','#/commercial/dashboard');
  w.document.body.innerHTML='<main id="view">'+t.commercialContractFinancePanel()+'</main>';
  w.addEventListener('sgdi:sidebar-stats',t.refreshCommercialFinancePanel);
  w.SGDI_SIDEBAR_STATS={scope:{active_society:'IRON GLOBAL SOLUTION'},commercial:{contracts_active:4},facturation:{invoices_issued:2,invoiced_ttc:42,payments_total:1,payments_amount:12}};
  w.dispatchEvent(new w.Event('sgdi:sidebar-stats'));
  const panel=w.document.querySelector('.comm-contract-finance');
  assert.match(panel.textContent,/42,00/);
  w.dispatchEvent(new w.Event('sgdi:sidebar-stats'));
  assert.equal(w.document.querySelector('.comm-contract-finance'),panel);
  w.history.replaceState(null,'','#/dashboard');
  w.SGDI_SIDEBAR_STATS.facturation.invoiced_ttc=999;
  w.dispatchEvent(new w.Event('sgdi:sidebar-stats'));
  assert.doesNotMatch(panel.textContent,/999/);
  w.history.replaceState(null,'','#/commercial/dashboard');
  t.commercialModuleDestroy();
  w.dispatchEvent(new w.Event('sgdi:sidebar-stats'));
  assert.doesNotMatch(panel.textContent,/999/);
  w.close();
});
