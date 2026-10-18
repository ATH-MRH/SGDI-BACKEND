// Rendu réel : liste, filtres, actions, surplus et isolation du shell.
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const {startAtlas,CHROME,puppeteer}=require('./helpers/atlas-chrome');

test('OPS : effectifs compacts, actions communes et surplus honnête en Chrome',{
  timeout:180000,skip:!CHROME||!puppeteer?'Chrome ou puppeteer indisponible':false,
},async t=>{
  const artifacts=process.env.ATLAS_OPS_PRESENTATION_ARTIFACTS||'/tmp/ops-final-presentation';
  fs.mkdirSync(artifacts,{recursive:true});
  const atlas=await startAtlas(t,{port:8981,artifacts});
  const page=await atlas.login('ops','OPS01','effectif/actifs');
  await page.waitForSelector('.ops-effectif-page tbody tr[data-employee-id]');
  await page.waitForFunction(()=>document.body.hasAttribute('data-ops-ui')&&!document.querySelector('#effectif-list-zone[aria-busy="true"]'));
  const measurements=[];
  for(const width of [1920,1440,1024,768,767,720,390]){
    await t.test(`effectifs ${width}px : pas de débordement, filtres et actions accessibles`,async()=>{
      await page.setViewport({width,height:900});await atlas.settled(page);
      const state=await page.evaluate(()=>{
        const root=document.querySelector('.ops-effectif-page');
        const frame=root.querySelector('.effectif-table-card');
        const row=root.querySelector('tbody tr');
        const tools=root.querySelector('.ops-effectif-tools');
        return {width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,
          viewOverflow:document.getElementById('view').scrollWidth-document.getElementById('view').clientWidth,
          rowHeight:row.getBoundingClientRect().height,tableDisplay:getComputedStyle(row).display,
          frameWidth:frame.getBoundingClientRect().width,toolsHeight:tools.getBoundingClientRect().height,
          rows:root.querySelectorAll('tbody tr[data-employee-id]').length,
          open:root.querySelectorAll('.effectif-open-btn.ops-btn').length,
          labels:[...root.querySelectorAll('td[data-label]')].map(el=>el.dataset.label)};
      });
      measurements.push(state);
      assert.ok(state.overflow<=1,JSON.stringify(state));assert.ok(state.viewOverflow<=1,JSON.stringify(state));
      assert.equal(state.open,state.rows);assert.ok(state.labels.includes('Statut'));
      if(width>767)assert.ok(state.rowHeight<=72,`ligne ${state.rowHeight}px`);
      await page.screenshot({path:path.join(artifacts,`effectifs-${width}.png`)});
    });
  }
  await page.setViewport({width:1440,height:900});
  await t.test('recherche, site, tri et filtres avancés conservent leurs handlers',async()=>{
    const search='.ops-effectif-tools input';
    await page.type(search,'KT01');
    await page.waitForFunction(()=>document.querySelectorAll('.ops-effectif-page tbody tr[data-employee-id]').length===1);
    assert.match(await page.$eval('.ops-effectif-page tbody',el=>el.textContent),/KT01/);
    await page.$eval(search,el=>{el.value='';el.dispatchEvent(new Event('input',{bubbles:true}))});
    await page.waitForFunction(()=>document.querySelectorAll('.ops-effectif-page tbody tr[data-employee-id]').length===7);
    await page.select('#effectif-site-filter',String(atlas.fixture.sites[1]));
    await page.waitForFunction(()=>document.querySelectorAll('.ops-effectif-page tbody tr[data-employee-id]').length===3);
    await page.select('.ops-effectif-tools select[onchange*="setEffectifSort"]','nom_desc');
    await page.waitForFunction(()=>!document.querySelector('#effectif-list-zone[aria-busy="true"]'));
    assert.equal(await page.$eval('#effectif-site-filter',el=>el.value),String(atlas.fixture.sites[1]));
    await page.click('[aria-controls="ops-effectif-advanced"]');
    await page.waitForSelector('#ops-effectif-advanced');
    const label=await page.$eval('#ops-filter-ageMin',el=>el.labels[0].textContent);
    assert.equal(label,'Age min');
    await page.$eval('#ops-filter-ageMin',el=>{el.value='20';el.dispatchEvent(new Event('change',{bubbles:true}))});
    await page.waitForFunction(()=>document.querySelector('[aria-controls="ops-effectif-advanced"] .ops-btn__badge')?.textContent==='1');
    await page.screenshot({path:path.join(artifacts,'effectifs-filtres.png')});
  });
  await t.test('surplus : trois affectés pour un contrat, aucun employé nommé en surplus',async()=>{
    await page.evaluate(id=>{location.hash='#/sites/'+id},atlas.fixture.sites[1]);
    await page.waitForSelector('#site-affectation-body');
    const state=await page.evaluate(()=>({rows:document.querySelectorAll('#site-affectation-body tr').length,
      surplus:document.querySelector('[data-stf-kpi="surplus"] .stf-kpi-value').textContent,
      summary:document.querySelector('[data-site-surplus-summary]').textContent,
      tables:document.querySelectorAll('[data-site-surplus-summary] table').length}));
    assert.equal(state.rows,3);assert.equal(state.surplus,'2');assert.equal(state.tables,0);
    assert.match(state.summary,/Employés en surplus non identifiés individuellement/);assert.doesNotMatch(state.summary,/KT0/);
    await page.evaluate(()=>siteTechGoTo('affectation'));await atlas.delay(500);
    await page.screenshot({path:path.join(artifacts,'surplus.png')});
  });
  await t.test('Sites : rendu avec données serveur et boutons communs après chargement',async()=>{
    await page.evaluate(()=>{location.hash='#/sites'});
    await page.waitForFunction(()=>sgdiViewRenderHash===location.hash&&!window.__sgdiSitesBgRefreshing);
    // Défaut préexistant de navigation/bootstrap : le test historique le conserve et le signale.
    // Ici, on vérifie séparément la présentation via le vrai renderer et ses vrais appels API.
    await page.evaluate(()=>renderSitesServer(document.getElementById('view')));
    await page.waitForSelector('.ops-sites-cc[data-cc-ready] .ops-sites-cc-card');
    await page.waitForFunction(()=>document.querySelector('.ops-sites-cc-more.ops-btn'));
    for(const width of [1440,390]){
      await page.setViewport({width,height:900});await atlas.settled(page);
      const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,
        viewOverflow:document.getElementById('view').scrollWidth-document.getElementById('view').clientWidth,
        names:[...document.querySelectorAll('.ops-sites-cc-card h3')].map(el=>el.textContent),
        links:document.querySelectorAll('.ops-sites-cc-more.ops-btn').length}));
      assert.ok(state.overflow<=1,JSON.stringify(state));assert.ok(state.viewOverflow<=1,JSON.stringify(state));
      assert.equal(state.links,5);assert.doesNotMatch(state.names.join(' '),/INTERDIT/);
      await page.screenshot({path:path.join(artifacts,`sites-${width}.png`)});
    }
  });
  await t.test('superviseur OPS : même habillage, droits de consultation préservés',async()=>{
    const state=await page.evaluate(()=>{
      session={...session,transverse:'superviseur',supervisorReadOnly:true};
      syncOpsPresentation();
      return {active:document.body.hasAttribute('data-ops-ui'),readOnly:isOpsSupervisorReadOnlySession()};
    });
    assert.deepEqual(state,{active:true,readOnly:true});
  });
  await t.test('DRH : aucun habillage OPS, même si un contexte de fiche OPS reste mémorisé',async()=>{
    const drh=await atlas.login('drh','DRH01','effectif/actifs');
    await drh.waitForSelector('.effectif-page');
    const state=await drh.evaluate(()=>{
      sessionStorage.setItem('ficheContext','ops');syncOpsPresentation();
      const shell=document.querySelector('.sgdi-shell');
      return {active:document.body.hasAttribute('data-ops-ui'),marker:shell.classList.contains('sgdi-ops-shell'),enhanced:document.querySelectorAll('[data-ops-enhanced]').length};
    });
    assert.deepEqual(state,{active:false,marker:false,enhanced:0});
    await drh.screenshot({path:path.join(artifacts,'drh-isolation.png')});
  });
  fs.writeFileSync(path.join(artifacts,'measurements.json'),JSON.stringify(measurements,null,2));
});
