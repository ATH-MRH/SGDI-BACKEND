const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('app/static/js/modules/employee-import.js','utf8');

const CONFIG={limits:{extensions:['.xlsx','.xls'],max_file_mb:5,max_rows:1000},groups:['A','B','C','D'],contract_types:['CDD','CDI'],societies:['SOC A'],
  fields:[{key:'code',label:'Matricule'},{key:'full_name',label:'Nom complet (Nom + Prénom)',required:true},{key:'last_name',label:'Nom',required:true},
    {key:'first_name',label:'Prénom',required:true},{key:'phone',label:'Téléphone'},{key:'site',label:'Site'},{key:'position',label:'Poste'}]};
const UPLOAD={session_id:'employees-test',default_sheet:0,sheets:[{index:0,name:'Feuille',importable:true,row_count:3,columns:[
  {index:0,letter:'A',header:'Nom salarié',samples:['BENALI Ahmed'],suggested:'full_name'},{index:1,letter:'B',header:'Lieu',samples:['SITE NORD'],suggested:'site'},
  {index:2,letter:'C',header:'Couleur',samples:['Bleu'],suggested:null}]}]};
function previewRows(){
  return {mapping:{'0':'full_name','1':'site'},ignored_columns:['C (Couleur)'],counts:{total:3,ready:1,review:1,blocked:1,excluded:0,incomplete:1,empty_rows:0},rows:[
    {row:2,status:'ready',excluded:false,accepted:[],issues:[],incomplete:['Poste'],dropped:[],cells:{full_name:'BENALI Ahmed',site:'SITE NORD'},client_site:'CLIENT — SITE NORD',code_preview:'Automatique',
      values:{last_name:'BENALI',first_name:'Ahmed',society:'SOC A'},name:{original:'BENALI Ahmed',last_name:'BENALI',first_name:'Ahmed',source:'auto',confidence:'certain'}},
    {row:3,status:'review',excluded:false,accepted:['duplicate:aaaa1111'],cells:{full_name:'GHANEM SAMIR',site:'SITE NORDD'},client_site:null,code_preview:'Automatique',incomplete:[],dropped:[],
      values:{last_name:'GHANEM',first_name:'SAMIR',society:'SOC A'},name:{original:'GHANEM SAMIR',last_name:'GHANEM',first_name:'SAMIR',source:'auto',confidence:'review'},
      issues:[{level:'review',field:'name',label:'Nom / Prénom',message:'Casse uniforme',accept:'name:12345678'},
        {level:'review',field:'client_site',label:'Client / Site',message:'Client / site « SITE NORDD » introuvable',accept:'client_site:87654321',suggestions:['CLIENT — SITE NORD']}]},
    {row:4,status:'blocked',excluded:false,accepted:[],cells:{full_name:'<img src=x onerror=alert(1)>'},client_site:null,code_preview:'<b>X</b>',incomplete:[],dropped:[],
      values:{society:'SOC A'},name:{original:'<img src=x onerror=alert(1)>',last_name:'<img src=x onerror=alert(1)>',first_name:'',source:'auto',confidence:'review'},
      issues:[{level:'blocked',field:'first_name',label:'Prénom',message:'Prénom obligatoire <script>alert(2)</script>'}]}]};
}
function harness(){
  const dom=new JSDOM('<body><div id="modal-host"></div></body>');
  const calls=[];
  const context=vm.createContext({SGDIModules:{registerModule:()=>{}},document:dom.window.document,FormData:dom.window.FormData,URL:dom.window.URL,
    AbortController,setTimeout,clearTimeout,confirm:()=>true,adminActiveSociete:()=> 'SOC A',logActivity:()=>{},sgdiPullEmployees:async()=>{},
    escapeHTML:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    openModal:html=>dom.window.document.getElementById('modal-host').innerHTML='<div class="modal-bg"><div class="modal">'+html+'</div></div>',
    closeModal:()=>{},renderView:()=>{},toast:()=>{},sgdiApiUrl:p=>'/api'+p,sgdiAuthHeaders:()=>({}),
    sgdiApi:async(path,opts)=>{calls.push({path,opts});
      if(path.endsWith('/config'))return CONFIG;
      if(path.endsWith('/preview')||path.endsWith('/corrections'))return previewRows();
      if(path.endsWith('/confirm'))return {counts:{read:3,created:1,incomplete:1,duplicate:0,refused:2,excluded:0,error:0},rows:[{row:2,outcome:'created',original_name:'BENALI Ahmed',last_name:'BENALI',first_name:'AHMED',code:'A07'},{row:4,outcome:'refused',reason:'Prénom obligatoire'}]};
      return UPLOAD}});
  vm.runInContext(source,context);
  return {dom,calls,doc:dom.window.document,run:code=>vm.runInContext(code,context)};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

test('assistant en quatre étapes, mapping manuel et aucun import avant confirmation',async()=>{
  const h=harness();await h.run('openEmployeeExcelImport()');
  assert.match(h.doc.body.textContent,/1Fichier.*2Correspondance des colonnes.*3Vérification.*4Import/s);
  assert.equal(h.doc.getElementById('emp-import-society').value,'SOC A');
  assert.deepEqual([...h.doc.querySelectorAll('#emp-import-society option')].map(o=>o.value),['','SOC A']);
  h.run("uploadEmployeeImportFile(new document.defaultView.File(['x'],'employes.xlsx'))");await flush();await flush();
  const upload=h.calls.find(c=>c.opts?.method==='POST'&&c.path.startsWith('/drh/employee-import?society='));
  assert.ok(upload,'envoi avec la société active');assert.ok(upload.opts.body instanceof h.dom.window.FormData);
  const selects=[...h.doc.querySelectorAll('tbody select')];
  assert.deepEqual(selects.map(s=>s.value),['full_name','site','']);
  assert.match(selects[0].innerHTML,/Nom complet \(Nom \+ Prénom\)/);
  assert.match(selects[2].getAttribute('onchange'),/employeeImport\.mapping\['2'\]=this\.value\|\|null/);
  h.run("employeeImport.mapping['2']='phone'");          // choix manuel (gestionnaire inline hors contexte vm)
  h.run('previewEmployeeImport()');await flush();await flush();
  const preview=h.calls.find(c=>c.path.endsWith('/preview'));
  assert.deepEqual(JSON.parse(JSON.stringify(preview.opts.body)),{sheet:0,mapping:{'0':'full_name','1':'site','2':'phone'}});
  assert.equal(h.calls.filter(c=>c.path.endsWith('/confirm')).length,0);
  const text=h.doc.body.textContent;
  assert.match(text,/1 prête\(s\).*1 à compléter \/ à vérifier.*1 bloquante\(s\)/s);
  assert.match(text,/Excel : « BENALI Ahmed »/);assert.match(text,/Fiable/);assert.match(text,/À vérifier/);
  assert.match(text,/Fiche à compléter : Poste/);assert.match(text,/Colonnes ignorées : C \(Couleur\)/);
  assert.match(text,/Importer 1 employé\(s\)/);
  // Valeurs du fichier et du serveur toujours échappées.
  assert.equal(h.doc.querySelectorAll('script,img').length,0);
  assert.ok([...h.doc.querySelectorAll('*')].every(el=>!el.getAttribute('onerror')));
});

test('correction dans l\'aperçu : valeurs modifiées seules, propositions et validations explicites',async()=>{
  const h=harness();await h.run('openEmployeeExcelImport()');
  h.run("uploadEmployeeImportFile(new document.defaultView.File(['x'],'employes.xlsx'))");await flush();await flush();
  h.run('previewEmployeeImport()');await flush();await flush();
  h.run('employeeImport.editing=3;renderEmployeeExcelImport()');
  assert.deepEqual([...h.doc.querySelectorAll('.emp-import-editor input[id^="emp-fix-"]')].map(i=>i.id),['emp-fix-last_name','emp-fix-first_name','emp-fix-site']);
  h.run("useEmployeeImportSuggestion('site',3,0)");
  assert.equal(h.doc.getElementById('emp-fix-site').value,'SITE NORD');
  h.doc.getElementById('emp-fix-first_name').value='Samir';
  h.doc.querySelector('.emp-fix-accept[value="0"]').checked=true;
  h.run('saveEmployeeImportCorrection(3)');await flush();await flush();
  const correction=h.calls.find(c=>c.path.endsWith('/corrections'));
  assert.deepEqual(JSON.parse(JSON.stringify(correction.opts.body)),{row:3,values:{first_name:'Samir',site:'SITE NORD'},accept:['duplicate:aaaa1111','name:12345678']});
  h.run('excludeEmployeeImportRow(4,true)');await flush();await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.filter(c=>c.path.endsWith('/corrections'))[1].opts.body)),{row:4,exclude:true});
});

test('confirmation unique et bilan d\'import',async()=>{
  const h=harness();await h.run('openEmployeeExcelImport()');
  h.run("uploadEmployeeImportFile(new document.defaultView.File(['x'],'employes.xlsx'))");await flush();await flush();
  h.run('previewEmployeeImport()');await flush();await flush();
  h.run('employeeImport.busy=true');h.run('confirmEmployeeImport()');await flush();
  assert.equal(h.calls.filter(c=>c.path.endsWith('/confirm')).length,0);
  h.run('employeeImport.busy=false');h.run('confirmEmployeeImport()');await flush();await flush();await flush();
  assert.equal(h.calls.filter(c=>c.path.endsWith('/confirm')).length,1);
  const text=h.doc.body.textContent;
  assert.match(text,/Lignes lues3/);assert.match(text,/Employés créés1/);assert.match(text,/Fiches à compléter1/);
  assert.match(text,/Doublons0/);assert.match(text,/Lignes refusées2/);assert.match(text,/Erreurs0/);
  assert.match(text,/Télécharger le rapport d'import/);assert.match(text,/A07/);
});

test('boutons en haut du Recrutement groupé et module chargé par l\'Administration',()=>{
  const admin=fs.readFileSync('app/static/js/modules/administration-rh-settings.js','utf8');
  const header=admin.slice(admin.indexOf('function renderAdminRecruitment'),admin.indexOf('adminSocieteSelectorHTML("Le recrutement'));
  assert.match(header,/onclick="openEmployeeExcelImport\(\)">Importer Excel</);
  assert.match(header,/onclick="downloadEmployeeImportTemplate\(\)">Télécharger le modèle Excel</);
  assert.match(fs.readFileSync('app/static/js/modules/administration.js','utf8'),/"employee-import"/);
  // Aucune lecture Excel côté navigateur : le serveur fait foi.
  assert.doesNotMatch(source,/XLSX|sgdiLoadXLSX|FileReader/);
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
      window.escapeHTML=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
      window.openModal=html=>document.getElementById('modal-host').innerHTML='<div class="modal-bg"><div class="modal p-6">'+html+'</div></div>';
      window.closeModal=()=>{};window.renderView=()=>{};
    });
    await page.addScriptTag({content:source});
    for(const width of [390,768,1440]){
      await page.setViewport({width,height:900});
      for(const step of [1,2,3,4]){
        await page.evaluate(({step,config,upload,preview})=>{
          employeeImport={step,society:'SOC A',config,upload,sheet:0,mapping:{'0':'full_name','1':'site'},preview,filter:'all',page:1,editing:step===3?3:null,busy:false,error:'',
            result:{counts:{read:3,created:1,incomplete:1,duplicate:0,refused:2,excluded:0,error:0},rows:[{row:2,outcome:'created',original_name:'BENALI Ahmed',last_name:'BENALI',first_name:'AHMED',code:'A07'}]}};
          renderEmployeeExcelImport();
        },{step,config:CONFIG,upload:UPLOAD,preview:previewRows()});
        const sizes=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth,
          scroll:document.querySelector('.emp-import-table')?getComputedStyle(document.querySelector('.emp-import-table')).overflowX:null}));
        assert.ok(sizes.body<=sizes.viewport+1,`Débordement à ${width}px, étape ${step}: ${JSON.stringify(sizes)}`);
        if(step>=2)assert.equal(sizes.scroll,'auto');
      }
    }
  }finally{await browser.close()}
});
