const test=require('node:test');
const assert=require('node:assert/strict');
const {loadSgdiApp}=require('./load-app');

const base='2026-10-17';
const agent=(extra={})=>({id:'expiry-test',backendId:4242,nom:'TEST',prenom:'EMPLOYE',matricule:'E42',societe:'TEST',statut:'actif',dateRecrutement:'2026-01-01',...extra});
function harness(t){
  const app=loadSgdiApp(['employeeExpiredContractAlert','employeeListRowHTML','employeeStatusPillHTML','employeeFromApi','employeePositionContractEndDate']);
  assert.equal(app.loadError,null,app.loadError?.stack);
  t.after(()=>app.window.close());
  app.T().setSession({username:'drh',transverse:'drh'});
  app.T().setDb({agents:[],contrats:[],contratsPersonnel:[],avenants:[],conges:[],assignments:[],sites:[],settings:{}});
  return app;
}
for(const [end,days] of [['2026-10-05',12],['2026-10-16',1],['2026-10-17',null],['2026-10-18',null],['2099-01-01',null],['invalide',null]]){
  test(`échéance ${end} : ${days===null?'aucune alerte':days+' jour(s)'}`,t=>{
    const app=harness(t),a=agent({dateFinContrat:end}),before=JSON.stringify(a);
    const alert=app.T().employeeExpiredContractAlert(a,base);
    assert.equal(alert?.days??null,days);
    if(days!==null)assert.equal(alert.message,`Contrat expiré depuis ${days} ${days===1?'jour':'jours'}`);
    assert.equal(JSON.stringify(a),before,'le rendu ne modifie aucune donnée employé');
  });
}
test('sans contrat, une ancienne date de recrutement seule ne crée pas une expiration',t=>{
  const app=harness(t),api=app.T();
  assert.equal(api.employeeExpiredContractAlert(agent({dateRecrutement:'2000-01-01',typeContrat:'CDD'}),base),null);
  assert.equal(api.employeeExpiredContractAlert(agent({dateRecrutement:'2000-01-01',typeContrat:'CDI'}),base),null);
});
test('la durée explicitement renseignée utilise le calcul contractuel existant',t=>{
  const app=harness(t),api=app.T(),a=agent({dateRecrutement:'2025-10-01',dureeContrat:'12m'});
  assert.equal(api.employeePositionContractEndDate(a),'2026-09-30');
  assert.equal(api.employeeExpiredContractAlert(a,base).days,17);
});
test('plusieurs contrats : réutilisation de l’échéance déjà choisie par le système',t=>{
  const app=harness(t),api=app.T(),a=agent({dateFinContrat:'2026-01-01'});
  api.setDb({contrats:[{employee_id:4242,end_date:'2026-10-05'},{employee_id:999,end_date:'2099-01-01'}],contratsPersonnel:[],avenants:[]});
  assert.equal(api.employeeExpiredContractAlert(a,base).days,12);
  api.getDb().contratsPersonnel.push({agentId:a.id,end_date:'2027-01-01'});
  assert.equal(api.employeeExpiredContractAlert(a,base),null,'le renouvellement courant évite une fausse alerte sur l’ancien contrat');
});
for(const extra of [{statut:'suspendu'},{statut:'sortant'},{statut:'archivé'},{statut:'congé'},{statut:'maladie'},{blacklist:true},{contractBlocked:true},{dateSortie:'2026-01-01'}]){
  test(`priorité du statut existant : ${JSON.stringify(extra)}`,t=>{
    const app=harness(t),api=app.T(),a=agent({dateFinContrat:'1999-01-01',...extra});
    assert.equal(api.employeeExpiredContractAlert(a,base),null);
    const table=app.window.document.createElement('table');table.innerHTML=api.employeeListRowHTML(a,'actifs');
    assert.equal(table.querySelector('.effectif-status-cell').innerHTML,api.employeeStatusPillHTML(a,{contractIndicator:true}));
    assert.equal(table.querySelector('.effectif-contract-expired'),null);
  });
}
test('date et statut réutilisent le mapping API sans champ ni requête supplémentaires',t=>{
  const app=harness(t),api=app.T();
  const mapped=api.employeeFromApi({id:4242,status:'actif',code:'E42',contract_end_date:'2026-10-05',extra:{}});
  assert.equal(mapped.dateFinContrat,'2026-10-05');
  assert.equal(api.employeeExpiredContractAlert(mapped,base).days,12);
  const suspended=api.employeeFromApi({id:4242,status:'suspendu',contract_end_date:'2026-10-05',extra:{statut:'actif'}});
  assert.equal(api.employeeExpiredContractAlert(suspended,base),null);
});
test('alerte uniquement dans STATUT, huit colonnes et liens/actions inchangés, sans requête ni timer',t=>{
  const app=harness(t),api=app.T(),a=agent({dateFinContrat:'1999-01-01'});
  app.window.fetch=()=>assert.fail('aucune requête API au rendu');
  app.window.setInterval=()=>assert.fail('aucun minuteur permanent');
  const table=app.window.document.createElement('table');table.innerHTML=api.employeeListRowHTML(a,'actifs');
  const row=table.querySelector('tr'),pill=row.querySelector('.employee-status-actif');
  assert.equal(row.cells.length,8);
  assert.ok(row.classList.contains('effectif-contract-expired'));
  assert.ok(pill.classList.contains('employee-contract-expired'));
  assert.equal(pill.textContent,'ACTIF');assert.equal(pill.tagName,'SPAN');
  assert.equal(pill.getAttribute('tabindex'),'0');
  assert.match(pill.getAttribute('aria-label'),/^Actif — Contrat expiré depuis \d+ jours$/);
  assert.equal(pill.getAttribute('onclick'),null);
  assert.ok(pill.closest('[data-label="Statut"]'));
  assert.equal(row.querySelector('[data-label="Employé"] .employee-contract-expired'),null);
  assert.equal(row.querySelector('.effectif-open-btn').getAttribute('href'),'#/agents/expiry-test');
  const future=app.window.document.createElement('table');future.innerHTML=api.employeeListRowHTML({...a,dateFinContrat:'2099-01-01'},'actifs');
  assert.equal(future.querySelector('.employee-contract-expired'),null);
  assert.equal(future.querySelector('.effectif-row-actions').outerHTML,row.querySelector('.effectif-row-actions').outerHTML);
  assert.doesNotMatch(api.employeeStatusPillHTML(a),/contract-expired|contract-tooltip/,'autres écrans inchangés');
  api.setSession({transverse:'ops'});
  assert.doesNotMatch(api.employeeListRowHTML(a,'actifs'),/employee-contract-expired|effectif-contract-expired/,'aucune modification OPS');
});

const fs=require('node:fs');
const path=require('node:path');
const chrome=[process.env.PUPPETEER_EXECUTABLE_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(p=>fs.existsSync(p));
let puppeteer;try{puppeteer=require('puppeteer-core')}catch{}
test('Chrome : point seul animé, tooltip souris/clavier, hover, sélection, mouvement réduit et responsive',{skip:!chrome||!puppeteer?'Chrome ou puppeteer-core indisponible':false},async t=>{
  const app=harness(t),api=app.T();
  const end=new Date();end.setUTCDate(end.getUTCDate()-12);
  const people=[agent({id:'valid',dateFinContrat:'2099-01-01'}),agent({id:'expired',dateFinContrat:end.toISOString().slice(0,10)}),agent({id:'suspended',statut:'suspendu',dateFinContrat:'1999-01-01'})];
  const rows=people.map(a=>api.employeeListRowHTML(a,'actifs')).join('');
  const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="view"><div class="effectif-page"><h1 class="text-2xl font-black effectif-page-title">Gestion des effectifs</h1><div class="card overflow-hidden effectif-table-card"><table class="effectif-table"><colgroup><col style="width:28%"><col style="width:8%"><col style="width:13%"><col style="width:13%"><col style="width:10%"><col style="width:8%"><col style="width:108px"><col style="width:148px"></colgroup><thead><tr>'+['Employé','Code','Société','Poste','Site','Recrutement','Statut','Action'].map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div></div></div></body></html>');
  for(const file of ['responsive-baseline.css','tailwind.min.css','sgdi-app.css']){
    await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../app/static',file),'utf8')});
  }
  for(const width of [1440,768,390]){
    await page.setViewport({width,height:1000});await page.mouse.move(0,0);
    await page.evaluate(()=>document.activeElement?.blur());
    const read=()=>page.evaluate(()=>{
      const tr=document.querySelector('[data-employee-id="expired"]'),p=tr.querySelector('.employee-contract-expired'),normal=document.querySelector('[data-employee-id="valid"] .employee-status-actif');
      const box=p.getBoundingClientRect(),before=getComputedStyle(p,'::before'),style=getComputedStyle(p);
      return {dot:before.backgroundColor,normalDot:getComputedStyle(normal,'::before').backgroundColor,animation:before.animationName,pillAnimation:style.animationName,background:style.backgroundColor,color:style.color,rowColor:getComputedStyle(tr).backgroundColor,cellColor:getComputedStyle(tr.cells[0]).backgroundColor,bodyWidth:document.documentElement.scrollWidth,badgeWidth:box.width,normalWidth:normal.getBoundingClientRect().width,pointSize:before.width,align:style.alignItems,tooltip:getComputedStyle(p,'::after').visibility};
    });
    // Attendre la transition de fond existante après le changement de breakpoint.
    await page.waitForFunction(()=>{
      const row=document.querySelector('[data-employee-id="expired"]');
      return [getComputedStyle(row).backgroundColor,getComputedStyle(row.cells[0]).backgroundColor].includes('rgba(254, 226, 226, 0.35)');
    },{timeout:3000});
    const state=await read();
    assert.equal(state.dot,'rgb(220, 38, 38)');assert.equal(state.normalDot,'rgb(255, 255, 255)');
    assert.equal(state.animation,'contract-expired-pulse');assert.equal(state.pillAnimation,'none');
    assert.equal(state.color,'rgb(255, 255, 255)');assert.equal(state.background,'rgb(21, 128, 61)');
    assert.equal(state.badgeWidth,state.normalWidth,'aucune largeur supplémentaire dans la capsule');
    assert.equal(state.pointSize,'7px');assert.equal(state.align,'center');
    assert.ok([state.rowColor,state.cellColor].some(c=>c==='rgba(254, 226, 226, 0.35)'),`fond rosé à ${width}px : ${JSON.stringify(state)}`);
    assert.equal(state.tooltip,'hidden');
    const pill=await page.$('.employee-contract-expired');await pill.hover();
    const hovered=await read();assert.equal(hovered.tooltip,'visible');
    const tooltip=await page.$eval('.employee-contract-expired',p=>({text:p.dataset.contractTooltip,style:getComputedStyle(p,'::after').backgroundColor}));
    assert.equal(tooltip.text,'Contrat expiré depuis 12 jours');assert.equal(tooltip.style,'rgb(51, 65, 85)');
    await page.hover('[data-employee-id="valid"] .employee-status-actif');
    const normalHover=await page.$eval('[data-employee-id="valid"]',r=>getComputedStyle(r.cells[0]).backgroundColor);
    assert.equal(hovered.cellColor,normalHover,'le hover normal reste identique');
    await page.mouse.move(0,0);await page.keyboard.press('Tab');
    // Aller jusqu'au point de statut, comme un utilisateur clavier.
    for(let i=0;i<10&&!await page.$eval('.employee-contract-expired',p=>p===document.activeElement);i++)await page.keyboard.press('Tab');
    assert.ok(await page.$eval('.employee-contract-expired',p=>p===document.activeElement));
    assert.equal((await read()).tooltip,'visible');
    await page.keyboard.press('Tab');await page.mouse.move(0,0);
    const widths=await page.evaluate(()=>{
      const tr=document.querySelector('[data-employee-id="expired"]');const withAlert=document.documentElement.scrollWidth;
      tr.classList.remove('effectif-contract-expired');tr.querySelector('.employee-contract-expired').classList.remove('employee-contract-expired');
      const withoutAlert=document.documentElement.scrollWidth;
      tr.classList.add('effectif-contract-expired');tr.querySelector('.employee-status-actif').classList.add('employee-contract-expired');
      return {withAlert,withoutAlert};
    });
    assert.equal(widths.withAlert,widths.withoutAlert,`aucun débordement ajouté à ${width}px`);
    await page.evaluate(()=>document.querySelector('[data-employee-id="expired"]').setAttribute('aria-selected','true'));
    assert.notEqual((await read()).cellColor,'rgba(254, 226, 226, 0.35)','la sélection conserve la priorité');
    await page.evaluate(()=>document.querySelector('[data-employee-id="expired"]').removeAttribute('aria-selected'));
    if(process.env.EXPIRED_INDICATOR_SCREENSHOTS){
      await page.setViewport({width,height:1000});await page.mouse.move(0,0);await page.focus('.employee-contract-expired');
      await page.screenshot({path:path.join(process.env.EXPIRED_INDICATOR_SCREENSHOTS,`effectifs-${width}.png`),fullPage:true});
    }
  }
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const reduced=await page.$eval('.employee-contract-expired',p=>({animation:getComputedStyle(p,'::before').animationName,color:getComputedStyle(p,'::before').backgroundColor}));
  assert.equal(reduced.animation,'none');assert.equal(reduced.color,'rgb(220, 38, 38)');
});
