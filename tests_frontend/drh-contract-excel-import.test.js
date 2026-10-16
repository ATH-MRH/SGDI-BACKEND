const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('app/static/js/modules/contracts.js','utf8');
function harness(){
  const dom=new JSDOM('<body><div id="modal"></div></body>');
  const calls=[];
  const context=vm.createContext({SGDIModules:{registerModule:()=>{}},document:dom.window.document,FormData:dom.window.FormData,URL:dom.window.URL,setTimeout,
    currentStructureSocieteFilter:()=> 'SOCIETE',escapeHTML:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    openModal:html=>dom.window.document.getElementById('modal').innerHTML=html,closeModal:()=>{},renderView:()=>{},toast:()=>{},
    sgdiPullState:async()=>{},sgdiApi:async(path,opts)=>{calls.push({path,opts});if(path.endsWith('/config'))return {fields:[{key:'reference',label:'Référence candidat'},{key:'start_date',label:'Date début'}],limits:{extensions:['.xlsx','.xls'],max_file_mb:5,max_rows:1000}};if(path.includes('dc-client-sites'))return {items:[]};if(path.endsWith('contract-templates'))return [];if(path.endsWith('/preview'))return {total:2,counts:{'PRÊT':1,'À CORRIGER':1},rows:[{row:2,candidate:'<script>alert(1)</script>',status:'PRÊT',values:{start_date:'2026-10-15'}},{row:3,status:'À CORRIGER',reason:'Date invalide'}]};if(path.endsWith('/confirm'))return {total:2,counts:{'CRÉÉ':1,'À CORRIGER':1},rows:[{row:2,status:'CRÉÉ',reference:'CTR-1'},{row:3,status:'À CORRIGER'}]};return {session_id:'contract-test',default_sheet:0,sheets:[{index:0,name:'Feuille',importable:true,row_count:2,columns:[{index:0,header:'Référence candidat',samples:['1'],suggested:'reference'},{index:1,header:'Date début',samples:['2026-10-15'],suggested:'start_date'}]}]}}});
  vm.runInContext(source,context);
  return {dom,calls,run:code=>vm.runInContext(code,context)};
}
test('assistant en quatre étapes : aperçu sans confirmation, création explicite et résultats',async()=>{
  const h=harness();await h.run('openContractExcelImport()');
  assert.match(h.dom.window.document.body.textContent,/1. Fichier.*2. Correspondance.*3. Vérification.*4. Résultat/s);
  await h.run("uploadContractExcelFile(new document.defaultView.File(['x'],'contrats.xlsx'))");
  assert.match(h.dom.window.document.body.textContent,/Données communes/);
  assert.match(h.dom.window.document.body.textContent,/Les valeurs Excel renseignées remplacent/);
  await h.run('previewContractExcelImport()');
  assert.equal(h.calls.filter(x=>x.path.endsWith('/confirm')).length,0);
  assert.equal(h.dom.window.document.querySelectorAll('script').length,0);
  assert.match(h.dom.window.document.body.textContent,/Créer 1 contrats prêts/);
  await h.run('confirmContractExcelImport()');
  assert.equal(h.calls.filter(x=>x.path.endsWith('/confirm')).length,1);
  assert.match(h.dom.window.document.body.textContent,/CTR-1/);
});
test('filtre erreurs, double confirmation bloquée et rendu mobile adaptatif',async()=>{
  const h=harness();await h.run('openContractExcelImport()');
  await h.run("uploadContractExcelFile(new document.defaultView.File(['x'],'contrats.xlsx'))");await h.run('previewContractExcelImport()');
  h.run('contractExcelImport.errorsOnly=true;renderContractExcelImport()');
  assert.equal(h.dom.window.document.querySelectorAll('tbody tr').length,1);
  h.run('contractExcelImport.busy=true');await h.run('confirmContractExcelImport()');
  assert.equal(h.calls.filter(x=>x.path.endsWith('/confirm')).length,0);
  const css=h.dom.window.document.querySelector('style').textContent;
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/grid-template-columns:1fr/);
  assert.match(css,/overflow:auto/);
});
test('bouton intégré uniquement au contenu Contrats à établir',()=>{
  const content=source.slice(source.indexOf('function renderContractsToEstablish'),source.indexOf('function exportContratsCSV'));
  assert.match(content,/Importer contractualisation Excel/);
  assert.match(content,/openContractExcelImport\(\)/);
});

const chrome=[process.env.PUPPETEER_EXECUTABLE_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(p=>fs.existsSync(p));
let puppeteer;try{puppeteer=require('puppeteer-core')}catch(e){}
test('assistant responsive dans Chrome réel aux quatre étapes',{skip:!chrome||!puppeteer?'Chrome ou puppeteer-core indisponible':false},async()=>{
  const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage();
    await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="modal-host"></div></body></html>');
    await page.addStyleTag({content:'body{margin:0}'+fs.readFileSync('app/static/sgdi-app.css','utf8')});
    await page.evaluate(()=>{
      window.SGDIModules={registerModule:()=>{}};
      window.escapeHTML=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
      window.openModal=html=>document.getElementById('modal-host').innerHTML='<div class="modal-bg"><div class="modal p-6">'+html+'</div></div>';
      window.closeModal=()=>{};window.renderView=()=>{};
    });
    await page.addScriptTag({content:source});
    for(const width of [390,768,1440]){
      await page.setViewport({width,height:900});
      for(const step of [1,2,3,4]){
        await page.evaluate(step=>{
          contractExcelImport={step,society:'IRON GLOBAL SOLUTION',mode:'dates',precedence:'common',common:{},mapping:{'0':'reference','1':'start_date'},sheet:0,session_id:'test',config:{fields:[{key:'reference',label:'Référence candidat'},{key:'start_date',label:'Date début'}],limits:{extensions:['.xlsx'],max_file_mb:5,max_rows:1000}},sites:[],templates:[],sheets:[{index:0,name:'Feuille',importable:true,row_count:1,columns:[{index:0,header:'Référence candidat',samples:['1']},{index:1,header:'Date début',samples:['2026-10-15']}]}],preview:{total:1,counts:{'PRÊT':1},rows:[{row:2,candidate:'CANDIDAT TEST',status:'PRÊT',values:{start_date:'2026-10-15',end_date:'2027-10-15',position:'MAGASINIER',client_site:'CLIENT — SITE'}}]},result:{total:1,counts:{'CRÉÉ':1},rows:[{row:2,candidate:'CANDIDAT TEST',status:'CRÉÉ',reference:'CTR-TEST'}]}};
          renderContractExcelImport();
        },step);
        const sizes=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth,grid:document.querySelector('.contract-excel-grid')?getComputedStyle(document.querySelector('.contract-excel-grid')).gridTemplateColumns:null,scroll:document.querySelector('.contract-excel-table')?getComputedStyle(document.querySelector('.contract-excel-table')).overflowX:null}));
        assert.ok(sizes.body<=sizes.viewport+1,`Débordement à ${width}px, étape ${step}: ${JSON.stringify(sizes)}`);
        if(step===2&&width===390)assert.equal(sizes.grid.split(' ').length,1);
        if(step>=3)assert.equal(sizes.scroll,'auto');
      }
    }
  }finally{await browser.close()}
});

test('dérogation : préparation seulement, cellules null visibles et compteur du lot',async()=>{
  const h=harness();await h.run('openContractExcelImport()');
  h.run(`contractExcelImport.step=3;contractExcelImport.session_id='contract-oneoff';contractExcelImport.preview={total:75,complete:1,prepared_missing:74,blocked:0,preparation_only:true,message:'Dérogation exceptionnelle appliquée à ce lot uniquement.',counts:{'Préparé exceptionnellement':75},rows:[{row:2,candidate:'CANDIDAT TEST',status:'Préparé exceptionnellement',values:{start_date:null,end_date:null,position:null,client_site:null,salary:null},missing_fields:['start_date','position'],required_missing_fields:['start_date','position']}]};renderContractExcelImport()`);
  const text=h.dom.window.document.body.textContent;
  assert.match(text,/Dérogation exceptionnelle appliquée à ce lot uniquement/);
  assert.match(text,/75 lignes.*1 complètes.*74 préparées avec données manquantes/s);
  assert.match(text,/Non renseigné/);
  assert.match(text,/Préparé exceptionnellement/);
  assert.match(text,/Enregistrer le lot préparé/);
  assert.doesNotMatch(text,/Créer \d+ contrats/);
  await h.run('confirmContractExcelImport()');
  assert.equal(h.calls.filter(c=>c.path.endsWith('/confirm')).length,0);
  h.run(`sgdiApi=async(path,opts)=>{if(path.endsWith('/prepare'))return {...contractExcelImport.preview,created_contracts:0,created_employees:0,created_documents:0};throw new Error('Création interdite')}`);
  await h.run('prepareExceptionalContractExcelImport()');
  assert.equal(h.run('contractExcelImport.step'),4);
  assert.equal(h.run('contractExcelImport.result.created_contracts'),0);
  assert.equal(h.run('contractExcelImport.result.rows[0].values.salary'),null);
  assert.match(h.dom.window.document.body.textContent,/aucun contrat, employé ou document contractuel/);
});

test('dérogation : valeur présente et zéro conservés, valeurs invalides bloquent l’enregistrement',async()=>{
  const h=harness();await h.run('openContractExcelImport()');
  h.run(`contractExcelImport.step=3;contractExcelImport.preview={total:1,complete:0,prepared_missing:0,blocked:1,preparation_only:true,message:'Dérogation exceptionnelle appliquée à ce lot uniquement.',counts:{'À CORRIGER':1},rows:[{row:2,status:'À CORRIGER',reason:'Client invalide',values:{start_date:'2026-10-15',position:'MAGASINIER'},missing_fields:['client_site'],required_missing_fields:['client_site']}]};renderContractExcelImport()`);
  assert.match(h.dom.window.document.body.textContent,/MAGASINIER/);
  const save=h.dom.window.document.querySelector('[onclick="prepareExceptionalContractExcelImport()"]');
  assert.ok(save.disabled);
  await h.run('prepareExceptionalContractExcelImport()');
  assert.equal(h.calls.filter(c=>c.path.endsWith('/prepare')).length,0);
});

test('fichier exceptionnel 96 lignes : D et E, valeurs originales et compteurs de correspondance',async()=>{
  const h=harness();await h.run('openContractExcelImport()');
  h.run(`sgdiApi=async()=>({session_id:'contract-96',preparation_only_file:true,default_sheet:0,sheets:[{index:0,name:'Contractualisation',importable:true,row_count:96,columns:[{index:3,header:'Nom + prénom',samples:['BELARBI BABOUA'],suggested:'name'},{index:4,header:'',letter:'E',samples:['KARIM'],suggested:null},{index:5,header:'Date début',samples:['2026-07-13'],suggested:'start_date'}]}]})`);
  await h.run("uploadContractExcelFile(new document.defaultView.File(['x'],'modele-contractualisation (1).xlsx'))");
  assert.equal(h.run('contractExcelImport.mode'),'full');
  assert.equal(h.run('contractExcelImport.precedence'),'excel');
  let text=h.dom.window.document.body.textContent;
  assert.match(text,/96 lignes.*D \(nom\).*E \(prénom sans en-tête\)/s);
  assert.doesNotMatch(text,/Données communes/);
  h.run(`contractExcelImport.step=3;contractExcelImport.preview={total:96,recognized:75,to_review:1,not_found:20,preparable:75,complete:0,prepared_missing:75,blocked:0,preparation_only:true,message:'Dérogation exceptionnelle appliquée à ce lot uniquement.',rows:[{row:2,candidate:'CANDIDAT COURANT',match_status:'MATCH CERTAIN',status:'Préparé exceptionnellement',values:{start_date:'2026-07-13',position:'CARISTE',salary:55000,client_site:'DHL ORAN SOLUTION',end_date:null}},{row:3,candidate:'IDENTITE INSUFFISANTE',match_status:'À VÉRIFIER',status:'À VÉRIFIER',values:{}},{row:4,candidate:'HORS PERIMETRE',match_status:'CANDIDAT INTROUVABLE',status:'CANDIDAT INTROUVABLE',values:{}}]};renderContractExcelImport()`);
  text=h.dom.window.document.body.textContent;
  assert.match(text,/96 lignes/);assert.match(text,/75 MATCH CERTAIN/);
  assert.match(text,/1 À VÉRIFIER/);assert.match(text,/20 CANDIDAT INTROUVABLE/);
  assert.match(text,/Non renseigné/);assert.match(text,/Enregistrer le lot préparé \(75 lignes\)/);
  assert.doesNotMatch(text,/Créer \d+ contrats/);
  h.run(`sgdiApi=async(path)=>{if(path.endsWith('/prepare'))return {...contractExcelImport.preview,created_contracts:0,created_employees:0,created_documents:0};throw new Error('Création interdite')}`);
  await h.run('confirmContractExcelImport()');assert.equal(h.run('contractExcelImport.step'),3);
  await h.run('prepareExceptionalContractExcelImport()');assert.equal(h.run('contractExcelImport.step'),4);
  assert.equal(h.run('contractExcelImport.result.created_contracts'),0);
  assert.equal(h.run('contractExcelImport.result.rows[0].values.salary'),55000);
});
