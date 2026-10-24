// OPS — rotations centrales dans Chrome réel : configuration et planning sans débordement, de 1920 à 390 px.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
let puppeteer;try{puppeteer=require('puppeteer-core')}catch(e){}
const chrome=[process.env.PUPPETEER_EXECUTABLE_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome'].filter(Boolean).find(fs.existsSync);
const source=fs.readFileSync('app/static/js/modules/ops-rotations.js','utf8');
const day=(d,wd,groups)=>({date:`2027-01-${String(d).padStart(2,'0')}`,weekday:wd,configured:true,weekend:wd>=4&&wd<=5,holiday:false,off_groups:['A','B','C','D'].filter(g=>!groups.includes(g)),critical:[],
 slots:[{shift:'JOUR',label:'Jour',group:groups[0],start:'08:00',end:'16:30',planned_staff:3,required_staff:3},{shift:'NUIT',label:'Nuit',group:groups[1],start:'16:30',end:'08:00',planned_staff:3,required_staff:3}]});
// Référence DG de démonstration : Jour A 08:00 → 16:30, semaine du dimanche, week-end vendredi-samedi couvert par B/C/D.
const CONFIG={regime:'1/3',timezone:'Africa/Algiers',anchor:'2027-01-01',minimum_rest_minutes:480,early_minutes:45,late_refusal_minutes:30,
 week_start:6,workdays:[6,0,1,2,3],weekend:[4,5],holidays:[],calendar_source:'Calendrier OPS',calendar_version:'1',calendar_valid_from:'2027-01-01',calendar_valid_until:'2027-12-31',
 night_start:'21:00',night_end:'05:00',phases:{A:0,B:0,C:2,D:1},required_staff:{JOUR:3,NUIT:3},day_start:'08:00',day_end:'16:30',night_shift_start:'16:30',night_shift_end:'08:00'};
const MONTH={month:'2027-01',configured:true,regime:'1/3',regime_label:'1/3',versions:[1],period:{start:'2027-01-01',end:'2027-01-31'},calendar:{week_start:6,workdays:[6,0,1,2,3],weekend:[4,5]},
 kpis:{planned_staff:96,day_average:46,night_average:46,day_slots:31,night_slots:31,critical_points:0},
 days:Array.from({length:31},(_,i)=>{const wd=(i+4)%7,weekend=wd===4||wd===5;return day(i+1,wd,weekend?[['B','D'],['C','B'],['D','C']][i%3]:[['A','B'],['A','C'],['A','D']][i%3])}),
 summary:{roles:{A:'Jours ouvrés uniquement (jour, 08:00 – 16:30)',B:'Nuits / week-ends / jours fériés',C:'Nuits / week-ends / jours fériés',D:'Nuits / week-ends / jours fériés'},
   timings:[{shift:'Jour',start:'08:00',end:'16:30'},{shift:'Nuit',start:'16:30',end:'08:00'}],minimum_rest_minutes:480,
   coverage:{day_staff_total:1012,night_staff_total:1012,a_days:[21,21],weekends:[8,8],holidays:[0,0]},conflicts:0,rules:[{label:'Aucun groupe A en nuit',ok:true}]}};

test('OPS rotations — configuration et planning responsives dans Chrome réel',{skip:!chrome||!puppeteer?'Chrome ou puppeteer-core indisponible':false,timeout:180000},async t=>{
 const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});t.after(()=>browser.close());
 const output=process.env.ATLAS_CENTRAL_ARTIFACTS||path.join(os.tmpdir(),'atlas-central-chrome');fs.mkdirSync(output,{recursive:true});
 for(const width of [1920,1440,1280,1024,768,390]){
  for(const mode of ['configuration','planning']){
   const page=await browser.newPage();await page.setViewport({width,height:900});
   await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font:14px system-ui,sans-serif}</style><main id="view"></main>');
   await page.evaluate(month=>{window.SGDIModules={registerModule:()=>{}};window.escapeHTML=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));window.toast=()=>{};
    window.sgdiApi=async url=>url.endsWith('/sites')?{items:[{id:7,name:'Mine du Nord',structure:'IRON Global',client:'Client A',regime:'1/3',version:1}]}
     :url.endsWith('/overview')?{active_sites:12,active_regimes:8,critical_points:3,drafts_to_validate:5}
     :url.endsWith('/history')?{items:[{version:1,config:month.config,effective_from:'2027-01-01',effective_to:null,published_by:'OPS',reason:'Synthétique'}]}:month.month;},{month:MONTH,config:CONFIG});
   await page.addScriptTag({content:source});
   await page.evaluate(m=>renderCentralRotations(document.getElementById('view'),m==='planning'?'planning':undefined),mode);
   await page.waitForSelector('.rot-cal',{timeout:10000});
   if(mode==='configuration'){
    assert.deepEqual(await page.$$eval('#rotPreview .rot-dow',e=>e.map(x=>x.textContent)),['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']);
    for(const regime of ['3X8','24H48','1/2','1/3']){
     // Changer de régime vide les horaires (jamais de valeur cachée) : l'aperçu attend la saisie.
     await page.click(`[data-regime="${regime}"]`);await page.waitForFunction(()=>/dès que ces paramètres sont renseignés/.test(document.querySelector('#rotPreview').textContent));
     const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,publish:document.querySelector('[data-publish]').disabled,
      clipped:[...document.querySelectorAll('.rot-seg button,.rot-kpi strong,.rot-title')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent)}));
     assert.ok(state.overflow<=1,`${width} ${regime}: débordement ${state.overflow}`);assert.equal(state.publish,true);
     assert.deepEqual(state.clipped,[],`${width} ${regime}: texte coupé`);
    }
   }else{
    const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,days:document.querySelectorAll('.rot-day:not(.is-empty)').length,summary:!!document.querySelector('.rot-summary')}));
    assert.ok(state.overflow<=1,`${width} planning: débordement ${state.overflow}`);assert.equal(state.days,31);assert.equal(state.summary,true);
   }
   await page.screenshot({path:path.join(output,`ops-${mode}-${width}.png`),fullPage:true});await page.close();
  }
 }
});
