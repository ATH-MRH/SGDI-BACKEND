// OPS — rotations centrales (ops-rotations.js) : configuration du régime et planning mensuel.
// Le serveur fait foi : ces tests vérifient que l'écran transmet les paramètres, n'affiche jamais
// d'identifiant technique, ne publie qu'avec le reçu d'une simulation valide et rend le planning.
const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('app/static/js/modules/ops-rotations.js','utf8');
const delay=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));
// Attente sur condition (jamais un délai fixe) : rendu asynchrone de l'écran.
async function until(fn,label){for(let i=0;i<200;i++){if(fn())return;await delay(5)}throw Error('Délai dépassé : '+label)}
const SITES=[{id:101,name:'Site <synthétique>',structure:'Structure test',client:'Client test',regime:null,version:null}];
const MONTH={month:'2027-01',configured:true,regime:'1/3',regime_label:'1/3',versions:[2],period:{start:'2027-01-01',end:'2027-01-31'},
 kpis:{planned_staff:12,day_average:3,night_average:3,day_slots:31,night_slots:31,critical_points:1},
 days:[{date:'2027-01-01',weekday:4,configured:true,weekend:true,holiday:false,off_groups:['A','C'],critical:[{code:'UNDERSTAFFED',label:'SOUS-EFFECTIF',shift:'NUIT'}],
   slots:[{shift:'JOUR',label:'Jour',group:'D',start:'07:00',end:'19:00',planned_staff:3,required_staff:3,occurrence_id:'101:5:x'},{shift:'NUIT',label:'Nuit',group:'B',start:'19:00',end:'07:00',planned_staff:2,required_staff:3,occurrence_id:'101:5:y'}]}],
 summary:{roles:{A:'Jours ouvrés uniquement',B:'Nuits / week-ends / jours fériés',C:'Nuits / week-ends / jours fériés',D:'Nuits / week-ends / jours fériés'},
   timings:[{shift:'Jour',start:'07:00',end:'19:00'},{shift:'Nuit',start:'19:00',end:'07:00'}],minimum_rest_minutes:480,
   coverage:{day_staff_total:93,night_staff_total:93,a_days:[21,21],weekends:[10,10],holidays:[0,0]},conflicts:0,
   rules:[{label:'Aucun groupe A en nuit',ok:true},{label:'Effectifs requis atteints',ok:false}]}};

async function setup({valid=true,hash='#/ops/rotations'}={}){
 const dom=new JSDOM('<main id="view"></main>',{url:'http://localhost/'+hash});
 const calls=[];
 const context={document:dom.window.document,location:dom.window.location,setTimeout,clearTimeout,confirm:()=>true,toast:()=>{},
  SGDIModules:{registerModule:()=>{}},Date,
  escapeHTML:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  sgdiApi:async(url,options={})=>{
   calls.push({url,options});
   if(url.endsWith('/sites'))return {items:SITES};
   if(url.endsWith('/overview'))return {active_sites:1,active_regimes:0,critical_points:2,drafts_to_validate:1};
   if(url.endsWith('/preview'))return {...MONTH,versions:[]};
   if(url.endsWith('/history'))return {items:[{version:2,config:{...JSON.parse(JSON.stringify(calls.find(c=>c.url.endsWith('/preview'))?.options.body.config||{regime:'1/3'}))},effective_from:'2027-01-01',effective_to:null,published_by:'OPS',reason:'Publication <b>test</b>'}]};
   if(url.endsWith('/drafts'))return {id:8};
   if(url.endsWith('/simulate'))return {valid,context_hash:'a'.repeat(64),errors:valid?[]:[{code:'UNCOVERED_SHIFT',label:'VACATION NON COUVERTE',slot:{work_date:'2027-01-02'}}],slots:[]};
   if(url.endsWith('/publish'))return {version:3,effective_from:'2027-01-01'};
   if(url.includes('/month?'))return MONTH;
   throw Error('Unexpected API '+url);
  }};
 vm.createContext(context);vm.runInContext(code,context);
 const view=dom.window.document.getElementById('view');
 await context.renderCentralRotations(view,hash.includes('planning')?'planning':undefined);await delay(20);
 return {dom,view,calls,context,$:sel=>view.querySelector(sel)};
}
const writes=calls=>calls.filter(c=>c.options.method==='POST'&&!c.url.endsWith('/preview'));

test('configuration : libellés lisibles, aucun identifiant technique, aperçu calculé par le serveur sans écriture',async()=>{
 const {dom,view,calls,$}=await setup();
 assert.equal($('[data-rot="site"] option[value="101"]').textContent,'Site <synthétique>');
 assert.equal($('[data-rot="client"]').textContent.includes('Client test'),true);
 assert.doesNotMatch(view.textContent,/\b101\b/);                                   // jamais affiché
 assert.match(view.textContent,/Sites actifs1.*Régimes actifs0.*Points critiques2.*Rotations à valider1/s);
 assert.ok(calls.some(c=>c.url.endsWith('/preview')));
 assert.equal(writes(calls).length,0);
 assert.ok($('#rotPreview .rot-cal'));
 assert.equal(view.querySelectorAll('.rot-group').length,4);
 assert.deepEqual([...view.querySelectorAll('.rot-group')].map(g=>[...g.classList].find(c=>/^rot-[A-D]$/.test(c))),['rot-A','rot-B','rot-C','rot-D']);
 dom.window.close();
});

test('aides contextuelles : les règles 1/3 n’apparaissent que pour le régime 1/3',async()=>{
 const {dom,view,$}=await setup();
 assert.equal($('[data-regime="1/3"]').getAttribute('aria-pressed'),'true');
 assert.match(view.textContent,/Groupe A : jour ouvré seulement/);assert.match(view.textContent,/Aucun service de nuit/);
 $('[data-regime="3X8"]').click();await delay(10);
 assert.doesNotMatch(view.textContent,/jour ouvré seulement|Aucun service de nuit|VACATION NON COUVERTE/);
 assert.match(view.textContent,/Trois vacations de 8 h contiguës/);assert.ok($('[data-shift="0:0"]'));assert.equal($('[data-f="dayStart"]'),null);
 $('[data-regime="24H48"]').click();await delay(10);
 assert.match(view.textContent,/Jour puis Nuit, suivis de deux jours OFF/);assert.ok($('[data-f="dayStart"]'));assert.equal($('[data-shift="0:0"]'),null);
 $('[data-regime="1/2"]').click();await delay(10);
 assert.ok($('[data-f="firstStart"]'));assert.doesNotMatch(view.textContent,/Groupe A : jour ouvré/);
 assert.equal($('[data-regime="NORMAL"]').disabled,true);assert.equal($('[data-regime="CUSTOM"]').disabled,true);
 dom.window.close();
});

test('enregistrement, simulation puis publication avec le reçu du serveur',async()=>{
 const {dom,calls,$}=await setup();
 $('[data-rot="site"]').value='101';$('[data-rot="site"]').dispatchEvent(new dom.window.Event('change'));await delay(20);
 assert.equal($('[data-simulate]').disabled,true);assert.equal($('[data-publish]').disabled,true);
 $('[data-save]').click();await delay(20);
 assert.equal(calls.some(c=>c.url.endsWith('/drafts')),false);                       // motif obligatoire
 assert.match($('#rotStatus').textContent,/Motif de la configuration obligatoire/);
 await until(()=>!$('[data-save]').disabled,'bouton Enregistrer');
 const reason=$('[data-f="reason"]');reason.value='Configuration validée';reason.dispatchEvent(new dom.window.Event('change'));await delay(5);
 $('[data-save]').click();await until(()=>calls.some(c=>c.url.endsWith('/sites/101/drafts'))&&!$('[data-simulate]').disabled,'brouillon');
 const saved=calls.find(c=>c.url.endsWith('/sites/101/drafts')).options.body;
 assert.equal(saved.config.regime,'1/3');assert.equal(saved.config.minimum_rest_minutes,480);assert.equal(JSON.stringify(saved.config.required_staff),JSON.stringify({JOUR:1,NUIT:1}));
 assert.equal(saved.reason,'Configuration validée');
 assert.equal($('[data-publish]').disabled,true);
 $('[data-simulate]').click();await until(()=>!$('[data-publish]').disabled,'simulation');
 $('[data-publish]').click();await until(()=>/version 3 publié/.test($('#rotStatus').textContent),'publication');
 assert.equal(calls.find(c=>c.url.endsWith('/publish')).options.body.context_hash,'a'.repeat(64));
 assert.match($('#rotStatus').textContent,/version 3 publié/);
 dom.window.close();
});

test('simulation invalide : publication interdite ; toute modification invalide le reçu',async()=>{
 const {dom,calls,$}=await setup({valid:false});
 $('[data-rot="site"]').value='101';$('[data-rot="site"]').dispatchEvent(new dom.window.Event('change'));await delay(20);
 const reason=$('[data-f="reason"]');reason.value='Configuration validée';reason.dispatchEvent(new dom.window.Event('change'));await delay(5);
 $('[data-save]').click();await until(()=>!$('[data-simulate]').disabled,'brouillon');
 $('[data-simulate]').click();await until(()=>$('.rot-errors'),'simulation');
 assert.equal($('[data-publish]').disabled,true);
 assert.match($('.rot-errors').textContent,/VACATION NON COUVERTE/);
 const rest=$('[data-f="rest"]');rest.value='600';rest.dispatchEvent(new dom.window.Event('change'));await delay(20);
 assert.equal($('[data-simulate]').disabled,true);assert.equal($('[data-publish]').disabled,true);
 assert.equal(calls.some(c=>c.url.endsWith('/publish')),false);
 dom.window.close();
});

test('planning mensuel : calendrier, OFF, week-end, point critique, résumé et historique échappés',async()=>{
 const {dom,view,calls,$}=await setup({hash:'#/ops/rotations/planning'});
 $('[data-rot="site"]').value='101';$('[data-rot="site"]').dispatchEvent(new dom.window.Event('change'));await delay(20);
 assert.ok(calls.some(c=>c.url.includes('/sites/101/month?month=')));
 assert.match(view.textContent,/Planning des rotations — /);
 assert.match(view.textContent,/Effectif planifié12.*Vacations jour3.*Vacations nuit3.*Points critiques1/s);
 const day=view.querySelector('.rot-day:not(.is-empty)');
 assert.match(day.textContent,/Jour :D.*Nuit :B/s);assert.match(day.textContent,/OFF A · C/);assert.match(day.textContent,/WE/);assert.match(day.textContent,/⚠ 1/);
 assert.equal(day.querySelector('.rot-chip.rot-D').textContent.trim(),'D');
 assert.match(view.querySelector('.rot-summary').textContent,/Version publiéev2.*Jours avec présence A \(jours ouvrés\)21 \/ 21/s);
 assert.ok(view.querySelector('.rot-summary .ko'));
 assert.equal($('.rot-seg [aria-pressed="true"]').textContent,'1/3');
 $('[data-table]').click();await delay(5);assert.match(view.querySelector('.rot-table').textContent,/SOUS-EFFECTIF/);
 $('[data-history]').click();await delay(20);
 assert.match(view.querySelector('#rotHistory').textContent,/v2/);assert.equal(view.querySelector('#rotHistory b'),null); // motif échappé
 $('[data-today]').click();await delay(10);
 dom.window.close();
});
