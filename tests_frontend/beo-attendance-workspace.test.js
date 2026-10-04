const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../app/static/js/shared/attendance-workspace.js'),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));
const codes=[['present','P','Présent'],['absent','A','Absent'],['maladie','M','Maladie'],['conge','C','Congé'],['repos','R','Repos'],['mission','MI','Mission']].map(([status,code,label])=>({status,code,label,tone:status}));
function data(month='2026-10',permissions={create:true,update:true,validate:true}){
 const n=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
 const calendar=Array.from({length:n},(_,i)=>({day:i+1,date:`${month}-${String(i+1).padStart(2,'0')}`,weekday:(i+3)%7,weekend:(i+3)%7===4||(i+3)%7===5}));
 return {month,calendar,codes,permissions,employee_statuses:['actif'],summary:{agents:1,recorded:1,present:1,absent:0,anomalies:0,total:n,completion:3},counts:{present:1},societies:[{society:'SOC',agents:1,total:n,recorded:1,present:1,completion:3}],total:1,page:1,pages:1,items:[{employee_id:7,name:'Équipe Amine',code:'K7',site:'HAMOUL',days:calendar.map((d,i)=>({...d,available:true,site_id:1,status:i?'non_pointe':'present',recorded:!i,presence_id:i?null:5,closed:false,anomalies:[],planning:{known:false}})),totals:{total:n,recorded:1,present:1,completion:3}}]};
}
function boot(read=async p=>data(p.month)){
 const dom=new JSDOM('<main id="view"></main>',{url:'http://beo.irongs.com/#/pointage',runScripts:'outside-only'}),w=dom.window,calls=[];w.confirm=()=>true;w.eval(source);
 const cleanup=w.AttendanceWorkspace.mount(w.document.querySelector('main'),{month:'2026-10',office:'Chargé Centre',siteCount:()=>1,epoch:()=>0,read,write:async b=>calls.push(b),correct:async (id,b)=>calls.push({id,...b}),close:async d=>calls.push({close:d})});return {dom,w,calls,cleanup};
}
test('seven tabs, real KPIs, server codes and dynamic 28/29/30/31 calendar',async()=>{
 const {w,cleanup}=boot();await tick();assert.equal(w.document.querySelectorAll('.aw-tabs [data-tab]').length,7);assert.match(w.document.querySelector('h1').textContent,/Pointage du personnel/);assert.match(w.document.querySelector('.aw-heading').textContent,/Chargé Centre/);assert.equal(w.document.querySelectorAll('th[data-day]').length,31);assert.ok(!w.document.querySelector('[data-code="sortie"]'));
 for(const [month,n] of [['2028-02',29],['2027-02',28],['2026-04',30]]){const el=w.document.querySelector('#aw-month');el.value=month;el.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();assert.equal(w.document.querySelectorAll('th[data-day]').length,n);}cleanup();w.close();
});
test('single-cell drafts use existing transport only on save; keyboard ignores inputs',async()=>{
 const {w,calls,cleanup}=boot();await tick();w.document.querySelector('[data-cell="7"][data-date="2026-10-02"]').click();w.document.querySelector('[data-code="absent"]').click();assert.equal(calls.length,0);assert.equal(w.document.querySelector('[data-date="2026-10-02"]').textContent,'A');
 const input=w.document.querySelector('#aw-search');input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'P',bubbles:true}));assert.equal(w.document.querySelector('[data-date="2026-10-02"]').textContent,'A');w.document.querySelector('#aw-save').click();await tick();assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{employee_id:7,site_id:1,presence_date:'2026-10-02',status:'absent'}]);cleanup();w.close();
});
test('closed and read-only cells cannot be edited, no invented S status',async()=>{
 const {w,cleanup}=boot(async()=>{const d=data('2026-10',{create:false,update:false,validate:false});d.items[0].days[0].closed=true;return d;});await tick();assert.equal(w.document.querySelector('#aw-save').hidden,true);assert.ok([...w.document.querySelectorAll('[data-cell]')].every(b=>b.disabled));w.document.querySelector('[data-tab="legend"]').click();assert.match(w.document.querySelector('#aw-content').textContent,/Suspendu/);assert.match(w.document.querySelector('#aw-content').textContent,/Mission/);cleanup();w.close();
});
test('late response after leaving view cannot replace next screen',async()=>{
 let resolve;const {w,cleanup}=boot(()=>new Promise(r=>resolve=r));cleanup();w.document.querySelector('main').innerHTML='<h1>Personnel</h1>';resolve(data());await tick();assert.equal(w.document.querySelector('main').textContent,'Personnel');w.close();
});
test('server failure shows retry state and empty scope stays empty',async()=>{
 const {w,cleanup}=boot(async()=>{throw new Error('Site hors périmètre');});await tick();assert.match(w.document.querySelector('#aw-message').textContent,/hors périmètre/);assert.match(w.document.querySelector('#aw-content').textContent,/Actualiser/);cleanup();w.close();
 const b=boot(async()=>({...data(),items:[],total:0,summary:{agents:0,recorded:0,present:0,absent:0,anomalies:0,total:0,completion:0}}));await tick();assert.match(b.w.document.querySelector('#aw-content').textContent,/Aucun agent/);b.cleanup();b.w.close();
});

test('authorized closed correction requires a reason and uses existing correction transport',async()=>{
 const {w,calls,cleanup}=boot(async()=>{const d=data();d.items[0].days[0].closed=true;return d;});await tick();
 w.prompt=()=>'';w.document.querySelector('[data-cell="7"][data-date="2026-10-01"]').click();w.document.querySelector('[data-code="absent"]').click();assert.equal(w.document.querySelector('#aw-save').disabled,true);
 w.prompt=()=> 'Motif vérifié';w.document.querySelector('[data-cell="7"][data-date="2026-10-01"]').click();w.document.querySelector('[data-code="absent"]').click();w.document.querySelector('#aw-save').click();await tick();assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{id:5,status:'absent',reason:'Motif vérifié'}]);cleanup();w.close();
});
