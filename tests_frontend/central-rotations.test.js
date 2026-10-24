// OPS — rotations centrales (ops-rotations.js) : configuration du régime et planning mensuel.
// Le serveur fait foi : ces tests vérifient que l'écran transmet les paramètres, n'affiche jamais
// d'identifiant technique, ne pré-remplit aucun horaire, ne publie qu'avec le reçu d'une simulation
// valide et rend le planning dans l'ordre de la semaine du site.
const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('app/static/js/modules/ops-rotations.js','utf8');
const delay=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));
// Attente sur condition (jamais un délai fixe) : rendu asynchrone de l'écran.
async function until(fn,label){for(let i=0;i<200;i++){if(fn())return;await delay(5)}throw Error('Délai dépassé : '+label)}
const SITES=[{id:101,name:'Site <synthétique>',structure:'Structure test',client:'Client test',regime:'1/3',version:2}];
// Référence DG de démonstration : Jour A 08:00 → 16:30, semaine du dimanche, ouvrés dimanche → jeudi.
const CONFIG={regime:'1/3',timezone:'Africa/Algiers',anchor:'2027-01-01',minimum_rest_minutes:480,early_minutes:45,late_refusal_minutes:30,
 week_start:6,workdays:[6,0,1,2,3],weekend:[4,5],holidays:[],calendar_source:'Calendrier OPS',calendar_version:'1',calendar_valid_from:'2027-01-01',calendar_valid_until:'2027-12-31',
 night_start:'21:00',night_end:'05:00',phases:{A:0,B:0,C:2,D:1},required_staff:{JOUR:1,NUIT:1},day_start:'08:00',day_end:'16:30',night_shift_start:'16:30',night_shift_end:'08:00'};
const MONTH={month:'2027-01',configured:true,regime:'1/3',regime_label:'1/3',versions:[2],period:{start:'2027-01-01',end:'2027-01-31'},
 calendar:{week_start:6,workdays:[6,0,1,2,3],weekend:[4,5]},
 kpis:{planned_staff:12,day_average:3,night_average:3,day_slots:31,night_slots:31,critical_points:1},
 days:[{date:'2027-01-01',weekday:4,configured:true,weekend:true,holiday:false,off_groups:['A','C'],critical:[{code:'UNDERSTAFFED',label:'SOUS-EFFECTIF',shift:'NUIT'}],
   slots:[{shift:'JOUR',label:'Jour',group:'D',start:'08:00',end:'16:30',planned_staff:3,required_staff:3,occurrence_id:'101:5:x'},{shift:'NUIT',label:'Nuit',group:'B',start:'16:30',end:'08:00',planned_staff:2,required_staff:3,occurrence_id:'101:5:y'}]}],
 summary:{roles:{A:'Jours ouvrés uniquement',B:'Nuits / week-ends / jours fériés',C:'Nuits / week-ends / jours fériés',D:'Nuits / week-ends / jours fériés'},
   timings:[{shift:'Jour',start:'08:00',end:'16:30'},{shift:'Nuit',start:'16:30',end:'08:00'}],minimum_rest_minutes:480,
   coverage:{day_staff_total:93,night_staff_total:93,a_days:[21,21],weekends:[10,10],holidays:[0,0]},conflicts:0,
   rules:[{label:'Aucun groupe A en nuit',ok:true},{label:'Effectifs requis atteints',ok:false}]}};
// Aperçu 3×8 renvoyé par le serveur : positions calculées (A Matin, B Après-midi, C Nuit, D OFF) et configuration complétée.
const MONTH_3X8={...MONTH,regime:'3X8',regime_label:'3×8',calendar:{week_start:0,workdays:[0,1,2,3,4,5,6],weekend:[]},
 days:[{date:'2027-01-01',weekday:4,configured:true,weekend:false,holiday:false,off_groups:['D'],critical:[],slots:[
  {shift:'MATIN',label:'Matin',group:'A',start:'05:00',end:'13:00',planned_staff:2,required_staff:1},
  {shift:'APRES_MIDI',label:'Après-midi',group:'B',start:'13:00',end:'21:00',planned_staff:2,required_staff:1},
  {shift:'NUIT',label:'Nuit',group:'C',start:'21:00',end:'05:00',planned_staff:2,required_staff:1}]}],
 config:{regime:'3X8',minimum_rest_minutes:480,early_minutes:45,late_refusal_minutes:30,required_staff:{MATIN:1,APRES_MIDI:1,NUIT:1},derived:['phases','workdays']}};
const PUBLISHED=[{version:2,config:CONFIG,effective_from:'2027-01-01',effective_to:null,published_by:'OPS',reason:'Publication <b>test</b>'}];

async function setup({valid=true,hash='#/ops/rotations',history=PUBLISHED}={}){
 const dom=new JSDOM('<main id="view"></main>',{url:'http://localhost/'+hash});
 const calls=[];
 const context={document:dom.window.document,location:dom.window.location,setTimeout,clearTimeout,confirm:()=>true,toast:()=>{},
  SGDIModules:{registerModule:()=>{}},Date,
  escapeHTML:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  sgdiApi:async(url,options={})=>{
   calls.push({url,options});
   if(url.endsWith('/sites'))return {items:SITES};
   if(url.endsWith('/overview'))return {active_sites:1,active_regimes:0,critical_points:2,drafts_to_validate:1};
   if(url.endsWith('/preview'))return options.body.config.regime==='3X8'?MONTH_3X8:{...MONTH,versions:[]};
   if(url.endsWith('/history'))return {items:history};
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
const setValue=(dom,el,value)=>{el.value=value;el.dispatchEvent(new dom.window.Event('change'))};

test('configuration publiée reprise : libellés lisibles, aucun identifiant technique, aperçu serveur dans la semaine du site',async()=>{
 const {dom,view,calls,$}=await setup();
 await until(()=>$('#rotPreview .rot-cal'),'aperçu');
 assert.equal($('[data-rot="site"] option[value="101"]').textContent,'Site <synthétique> · 1/3 v2');
 assert.equal($('[data-rot="client"]').textContent.includes('Client test'),true);
 assert.doesNotMatch(view.textContent,/\b101\b/);                                   // jamais affiché
 assert.match(view.textContent,/Sites actifs1.*Régimes actifs0.*Points critiques2.*Rotations à valider1/s);
 assert.ok(calls.some(c=>c.url.endsWith('/history')));                              // horaires de la version publiée
 assert.equal($('[data-f="dayStart"]').value,'08:00');assert.equal($('[data-f="dayEnd"]').value,'16:30');
 assert.equal($('[data-f="weekStart"]').value,'6');
 assert.equal(writes(calls).length,0);
 assert.deepEqual([...view.querySelectorAll('#rotPreview .rot-dow')].map(d=>d.textContent),['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']);
 assert.equal(view.querySelectorAll('.rot-group').length,4);
 assert.deepEqual([...view.querySelectorAll('.rot-group')].map(g=>[...g.classList].find(c=>/^rot-[A-D]$/.test(c))),['rot-A','rot-B','rot-C','rot-D']);
 assert.match($('.rot-group.rot-A').textContent,/Jours ouvrés uniquement \(dim, lun, mar, mer, jeu\).*Service de jour \(08:00 – 16:30\)/s);
 dom.window.close();
});

test('nouvelle configuration : aucun horaire ni calendrier pré-rempli ; enregistrement refusé tant que rien n’est saisi',async()=>{
 const {dom,view,calls,$}=await setup({history:[]});
 for(const key of ['dayStart','dayEnd','nightShiftStart','nightShiftEnd','nightStart','nightEnd'])assert.equal($(`[data-f="${key}"]`).value,'',key);
 assert.equal($('[data-f="weekStart"]').value,'');
 assert.equal(view.querySelectorAll('[data-workday]:checked').length,0);
 assert.equal($('[data-advanced]').open,true);                                        // paramètres visibles, rien de caché
 assert.match($('#rotPreview').textContent,/dès que ces paramètres sont renseignés : début de semaine, jours ouvrés/);
 assert.equal(calls.some(c=>c.url.endsWith('/preview')),false);
 setValue(dom,$('[data-f="reason"]'),'Nouvelle configuration');
 $('[data-save]').click();await until(()=>/À renseigner explicitement/.test($('#rotStatus').textContent),'refus');
 assert.match($('#rotStatus').textContent,/début de semaine, jours ouvrés.*heure début service jour/);
 assert.equal(calls.some(c=>c.url.endsWith('/drafts')),false);
 setValue(dom,$('[data-f="weekStart"]'),'6');
 for(const d of [6,0,1,2,3]){const box=view.querySelector(`[data-workday="${d}"]`);box.checked=true;box.dispatchEvent(new dom.window.Event('change'))}
 assert.deepEqual([...view.querySelectorAll('[data-workday]')].map(b=>b.dataset.workday),['6','0','1','2','3','4','5']); // ordre de la semaine du site
 for(const [key,value] of [['dayStart','08:00'],['dayEnd','16:30'],['nightShiftStart','16:30'],['nightShiftEnd','08:00'],['nightStart','21:00'],['nightEnd','05:00']])setValue(dom,$(`[data-f="${key}"]`),value);
 await until(()=>calls.some(c=>c.url.endsWith('/preview')),'aperçu');
 const sent=calls.filter(c=>c.url.endsWith('/preview')).pop().options.body.config;
 assert.equal(sent.week_start,6);assert.deepEqual(JSON.parse(JSON.stringify(sent.workdays)).sort(),[0,1,2,3,6]);assert.equal(sent.day_end,'16:30');
 dom.window.close();
});

test('aides contextuelles : règles 1/3 seulement en 1/3 ; changer de régime garde le calendrier mais aucun horaire',async()=>{
 const {dom,view,$}=await setup();
 await until(()=>$('[data-regime="1/3"]'),'écran');
 assert.equal($('[data-regime="1/3"]').getAttribute('aria-pressed'),'true');
 assert.match(view.textContent,/Groupe A : jour ouvré seulement/);assert.match(view.textContent,/Aucun service de nuit/);
 $('[data-regime="3X8"]').click();await delay(10);
 assert.doesNotMatch(view.textContent,/jour ouvré seulement|Aucun service de nuit|VACATION NON COUVERTE/);
 assert.match(view.textContent,/Trois vacations de 8 h contiguës/);assert.equal($('[data-shift="0:0"]').value,'');assert.equal($('[data-f="dayStart"]'),null);
 assert.equal($('[data-f="weekStart"]'),null);                                       // 3×8 : aucun calendrier à saisir
 $('[data-regime="24H48"]').click();await delay(10);
 assert.match(view.textContent,/Jour puis Nuit, suivis de deux jours OFF/);assert.equal($('[data-f="dayStart"]').value,'');assert.equal($('[data-shift="0:0"]'),null);
 assert.equal($('[data-f="weekStart"]').value,'6');                                  // calendrier du site conservé
 $('[data-regime="1/2"]').click();await delay(10);
 assert.equal($('[data-f="firstStart"]').value,'');assert.doesNotMatch(view.textContent,/Groupe A : jour ouvré/);
 assert.equal($('[data-regime="NORMAL"]').disabled,true);assert.equal($('[data-regime="CUSTOM"]').disabled,true);
 dom.window.close();
});

test('enregistrement, simulation puis publication avec le reçu du serveur',async()=>{
 const {dom,calls,$}=await setup();
 await until(()=>$('[data-f="dayStart"]')?.value==='08:00','configuration publiée');
 assert.equal($('[data-simulate]').disabled,true);assert.equal($('[data-publish]').disabled,true);
 $('[data-save]').click();await delay(20);
 assert.equal(calls.some(c=>c.url.endsWith('/drafts')),false);                       // motif obligatoire
 assert.match($('#rotStatus').textContent,/Motif de la configuration obligatoire/);
 await until(()=>!$('[data-save]').disabled,'bouton Enregistrer');
 setValue(dom,$('[data-f="reason"]'),'Configuration validée');await delay(5);
 $('[data-save]').click();await until(()=>calls.some(c=>c.url.endsWith('/sites/101/drafts'))&&!$('[data-simulate]').disabled,'brouillon');
 const saved=calls.find(c=>c.url.endsWith('/sites/101/drafts')).options.body;
 assert.equal(saved.config.regime,'1/3');assert.equal(saved.config.minimum_rest_minutes,480);assert.equal(JSON.stringify(saved.config.required_staff),JSON.stringify({JOUR:1,NUIT:1}));
 assert.equal(saved.config.week_start,6);assert.equal(saved.config.day_start,'08:00');assert.equal(saved.config.day_end,'16:30');
 assert.equal(JSON.stringify(saved.config.weekend),JSON.stringify([4,5]));
 assert.equal(saved.reason,'Configuration validée');
 assert.equal($('[data-publish]').disabled,true);
 $('[data-simulate]').click();await until(()=>!$('[data-publish]').disabled,'simulation');
 $('[data-publish]').click();await until(()=>/version 3 publié/.test($('#rotStatus').textContent),'publication');
 assert.equal(calls.find(c=>c.url.endsWith('/publish')).options.body.context_hash,'a'.repeat(64));
 dom.window.close();
});

test('simulation invalide : publication interdite ; toute modification invalide le reçu',async()=>{
 const {dom,calls,$}=await setup({valid:false});
 await until(()=>$('[data-f="dayStart"]')?.value==='08:00','configuration publiée');
 setValue(dom,$('[data-f="reason"]'),'Configuration validée');await delay(5);
 $('[data-save]').click();await until(()=>!$('[data-simulate]').disabled,'brouillon');
 $('[data-simulate]').click();await until(()=>$('.rot-errors'),'simulation');
 assert.equal($('[data-publish]').disabled,true);
 assert.match($('.rot-errors').textContent,/VACATION NON COUVERTE/);
 setValue(dom,$('[data-f="rest"]'),'600');await delay(20);
 assert.equal($('[data-simulate]').disabled,true);assert.equal($('[data-publish]').disabled,true);
 assert.equal(calls.some(c=>c.url.endsWith('/publish')),false);
 dom.window.close();
});

test('planning mensuel : semaine du site, OFF, week-end couvert, point critique, résumé et historique échappés',async()=>{
 const {dom,view,calls,$}=await setup({hash:'#/ops/rotations/planning'});
 await until(()=>view.querySelector('.rot-day:not(.is-empty)'),'planning');
 assert.ok(calls.some(c=>c.url.includes('/sites/101/month?month=')));
 assert.match(view.textContent,/Planning des rotations — /);
 assert.match(view.textContent,/Effectif planifié12.*Vacations jour3.*Vacations nuit3.*Points critiques1/s);
 assert.deepEqual([...view.querySelectorAll('.rot-dow')].map(d=>d.textContent),['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']);
 assert.equal(view.querySelectorAll('.rot-cal > .rot-day.is-empty').length>=5,true);   // vendredi 1er : 5 cases vides avant
 const day=view.querySelector('.rot-day:not(.is-empty)');
 assert.match(day.textContent,/Jour :D.*Nuit :B/s);assert.match(day.textContent,/OFF A · C/);assert.match(day.textContent,/WE/);assert.match(day.textContent,/⚠ 1/);
 assert.equal(day.querySelector('.rot-chip.rot-D').textContent.trim(),'D');            // jour du week-end couvert par D
 const summary=view.querySelector('.rot-summary').textContent;
 assert.match(summary,/Version publiéev2.*Début de semaineDimanche.*Jours ouvrésdim, lun, mar, mer, jeu/s);
 assert.match(summary,/Jour08:00 – 16:30/);assert.match(summary,/Jours avec présence A \(jours ouvrés\)21 \/ 21/);
 assert.ok(view.querySelector('.rot-summary .ko'));
 assert.equal($('.rot-seg [aria-pressed="true"]').textContent,'1/3');
 $('[data-table]').click();await delay(5);assert.match(view.querySelector('.rot-table').textContent,/SOUS-EFFECTIF/);
 $('[data-history]').click();await until(()=>view.querySelector('#rotHistory table'),'historique');
 assert.match(view.querySelector('#rotHistory').textContent,/v2.*Début dimanche · ouvrés dim, lun, mar, mer, jeu/s);
 assert.equal(view.querySelector('#rotHistory b'),null);                              // motif échappé
 $('[data-today]').click();await delay(10);
 dom.window.close();
});

async function choose3x8(dom,$,view,hours=[['05:00','13:00'],['13:00','21:00'],['21:00','05:00']]){
 $('[data-regime="3X8"]').click();await delay(10);
 setValue(dom,$('[data-f="anchor"]'),'2027-01-01');
 hours.forEach(([a,b],i)=>{setValue(dom,$(`[data-shift="${i}:0"]`),a);setValue(dom,$(`[data-shift="${i}:1"]`),b)});
}

test('3×8 : formulaire minimal — date de début du cycle et six horaires, rien d’autre à saisir',async()=>{
 const {dom,view,$}=await setup({history:[]});
 $('[data-regime="3X8"]').click();await delay(10);
 const params=[...view.querySelectorAll('#rotConfig > .rot-card')][0];
 assert.deepEqual([...params.querySelectorAll('.rot-fields label.rot-field')].map(l=>l.childNodes[0].textContent.trim()),
  ['Date de début du cycle','Matin — début','Matin — fin','Après-midi — début','Après-midi — fin','Nuit — début','Nuit — fin']);
 for(const key of ['daysPerPosition','weekStart','nightStart','nightEnd','rest','early','late','staffMatin','calendarSource','calendarFrom','holidays'])assert.equal($(`[data-f="${key}"]`),null,key);
 assert.equal(view.querySelectorAll('[data-workday]').length,0);assert.equal(view.querySelectorAll('[data-phase]').length,0);
 assert.match($('[data-advanced] summary').textContent,/Date d'effet et motif/);assert.match(view.textContent,/Motif \(facultatif\)/);
 dom.window.close();
});

test('3×8 : enregistrement avec les seuls horaires — aucun blocage jours ouvrés / travail de nuit, motif et date d’effet par défaut',async()=>{
 const {dom,view,calls,$}=await setup({history:[]});
 await choose3x8(dom,$,view);
 await until(()=>calls.some(c=>c.url.endsWith('/preview')&&c.options.body.config.regime==='3X8'),'aperçu 3×8');
 assert.doesNotMatch(view.textContent,/À renseigner explicitement|jours ouvrés, début travail de nuit/);
 $('[data-save]').click();await until(()=>calls.some(c=>c.url.endsWith('/sites/101/drafts')),'brouillon');
 const body=calls.find(c=>c.url.endsWith('/sites/101/drafts')).options.body;
 assert.deepEqual(Object.keys(body.config).sort(),['anchor','regime','shifts','timezone']);
 assert.equal(JSON.stringify(body.config.shifts),JSON.stringify([{start:'05:00',end:'13:00'},{start:'13:00',end:'21:00'},{start:'21:00',end:'05:00'}]));
 assert.equal(body.effective_from,'2027-01-01');assert.equal(body.reason,'Configuration 3×8 — planning intelligent ATLAS');
 await until(()=>!$('[data-simulate]').disabled,'Simuler disponible');
 $('[data-simulate]').click();await until(()=>!$('[data-publish]').disabled,'simulation');
 assert.match($('#rotStatus').textContent,/Planning généré par ATLAS et simulé sur 30 jours/);
 $('[data-publish]').click();await until(()=>/version 3 publié/.test($('#rotStatus').textContent),'publication');
 dom.window.close();
});

test('3×8 : cartes A/B/C/D calculées par le serveur (position du jour, groupe OFF) et paramètres ATLAS affichés',async()=>{
 const {dom,view,$}=await setup({history:[]});
 await choose3x8(dom,$,view);
 await until(()=>/Au 01\/01 : Matin/.test($('.rot-group.rot-A').textContent),'positions');
 assert.match($('.rot-group.rot-A').textContent,/Au 01\/01 : Matin \(05:00 – 13:00\)/);
 assert.match($('.rot-group.rot-B').textContent,/Au 01\/01 : Après-midi \(13:00 – 21:00\)/);
 assert.match($('.rot-group.rot-C').textContent,/Au 01\/01 : Nuit \(21:00 – 05:00\)/);
 assert.match($('.rot-group.rot-D').textContent,/Au 01\/01 : OFF \(repos\)/);
 assert.match($('.rot-rules').textContent,/Calculé par ATLAS : repos minimal 8 h, avance 45 min, refus du retard après 30 min, 1 agent\(s\) requis par vacation/);
 assert.match($('#rotPreview').textContent,/A\.-midi :B/);                              // libellé court dans la case
 dom.window.close();
});
