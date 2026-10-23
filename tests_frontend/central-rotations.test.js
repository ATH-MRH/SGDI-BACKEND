const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app/static/js/modules/ops.js','utf8').split('/* OPS owns official planning.')[1];
const code='/* OPS owns official planning.'+source;
const delay=()=>new Promise(resolve=>setTimeout(resolve,0));
async function setup(valid=true){
 const dom=new JSDOM('<main id="view"></main>',{url:'http://localhost/#/ops/rotations'});
 const writes=[];
 const context={document:dom.window.document,escapeHTML:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),sgdiApi:async(url,options)=>{
  writes.push({url,options});
  if(url==='/api/ops/sites')return [{id:101,name:'Site <synthétique>',client_id:9,equipment_plan:{societe:'Structure test'}}];
  if(url.endsWith('/drafts')&&options.method==='GET'){const saved=writes.find(w=>w.url.endsWith('/drafts')&&w.options.method==='POST').options.body;return {items:[{id:8,...saved}]};}
  if(url.endsWith('/drafts'))return {id:8};
  if(url.endsWith('/simulate'))return {valid,context_hash:'a'.repeat(64),errors:valid?[]:[{code:'UNCOVERED_SHIFT',label:'VACATION NON COUVERTE'}],slots:[]};
  if(url.endsWith('/publish'))return {version:1,effective_from:'2027-01-01'};
  if(url.endsWith('/history'))return {items:[]};
  throw Error('Unexpected API '+url);
 }};
 vm.createContext(context);vm.runInContext(code,context);const view=dom.window.document.getElementById('view');await context.renderCentralRotations(view);
 const form=view.querySelector('form');form.reportValidity=()=>true;
 for(const [key,value] of Object.entries({site:'101',effective:'2027-01-01',anchor:'2027-01-01',rest:'600',early:'40',late:'20',nightStart:'21:00',nightEnd:'05:00',daysPerPosition:'1',shift0Start:'05:00',shift0End:'13:00',shift1Start:'13:00',shift1End:'21:00',shift2Start:'21:00',shift2End:'05:00',phaseA:'0',phaseB:'1',phaseC:'2',phaseD:'3',calendarSource:'Calendrier OPS',calendarVersion:'1',calendarFrom:'2027-01-01',calendarUntil:'2027-12-31',dayStaff:'3',nightStaff:'2',reason:'Configuration validée'}))form.elements[key].value=value;
 return {dom,view,form,writes};
}

test('OPS saves explicit parameters, simulates and only then publishes the backend receipt',async()=>{
 const {dom,view,form,writes}=await setup();
 assert.equal(view.querySelector('[data-publish]').disabled,true);
 assert.equal(view.querySelector('option[value="101"]').textContent,'Site <synthétique>');
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await delay();
 const saved=writes.find(w=>w.url.endsWith('/drafts')).options.body;
 assert.equal(saved.config.minimum_rest_minutes,600);assert.equal(saved.config.late_refusal_minutes,20);
 assert.equal(saved.config.shifts[0].start,'05:00');
 view.querySelector('[data-simulate]').click();await delay();
 assert.equal(view.querySelector('[data-publish]').disabled,false);
 view.querySelector('[data-publish]').click();await delay();
 assert.equal(writes.find(w=>w.url.endsWith('/publish')).options.body.context_hash,'a'.repeat(64));
 assert.match(view.querySelector('[role="status"]').textContent,/version 1 publié/);
 dom.window.close();
});

test('uncovered mandatory shift blocks publication and input changes discard the old receipt',async()=>{
 const {dom,view,form,writes}=await setup(false);
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await delay();
 view.querySelector('[data-simulate]').click();await delay();
 assert.equal(view.querySelector('[data-publish]').disabled,true);
 assert.match(view.querySelector('#centralResult').textContent,/VACATION NON COUVERTE/);
 form.elements.rest.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(view.querySelector('[data-simulate]').disabled,true);
 assert.equal(writes.some(w=>w.url.endsWith('/publish')),false);
 dom.window.close();
});


test('saved drafts can be resumed without recalculating or publishing in the browser',async()=>{
 const {dom,view,form}=await setup();
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await delay();
 view.querySelector('[data-history]').click();await delay();
 assert.ok(view.querySelector('[data-resume]'));
 view.querySelector('[data-resume]').click();
 assert.equal(form.elements.rest.value,'600');
 assert.equal(view.querySelector('[data-simulate]').disabled,false);
 assert.equal(view.querySelector('[data-publish]').disabled,true);
 dom.window.close();
});
