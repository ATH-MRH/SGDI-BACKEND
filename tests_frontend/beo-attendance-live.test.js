const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('app/static/site-workforce/attendance-live.js','utf8');
const tick=()=>new Promise(r=>setTimeout(r,25));
const employee={id:1,nom:'Agent',prenom:'Test',matricule:'SYN-1',poste:'Testeur',photo:''};
function data(events=[{id:1,movement:'ARRIVAL'}]){return {generated_at:new Date().toISOString(),summary:{employees:1,present_now:1,entries_today:1,exits_today:0,absent_today:0,late:0,anomalies:0,not_clocked:0},events:events.map(e=>({employee,occurred_at:new Date().toISOString(),method:'QR',status:'recorded',society:'SYNTHÉTIQUE',site_name:'Site test',group:'A',anomalies:[],...e})),agents:[],population:'',next_before_id:null,filters:{groups:['A','B'],methods:['QR','FACIAL'],sites:[{site_id:3,site_name:'Site test',society:'SYNTHÉTIQUE'}]}};}
function boot(api=async()=>data()){
 const dom=new JSDOM('<main></main><div id="daily">Feuille quotidienne</div>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[],timers=new Map();let i=0;
 w.setTimeout=(fn,ms)=>{timers.set(++i,{fn,ms});return i;};w.clearTimeout=id=>timers.delete(id);
 w.eval(source);const SW={state:{scopeEpoch:1},api:async(path,opts)=>{calls.push({path,...opts});return api(path,opts);}};
 const cleanup=w.BeoAttendanceLive.mount(w.document.querySelector('main'),SW);
 return {w,dom,calls,timers,SW,cleanup,run(ms){const item=[...timers].find(([id,t])=>t.ms===ms);assert.ok(item,`timer ${ms}`);timers.delete(item[0]);item[1].fn();}};
}
test('live status, canonical KPI updates, entry and exit inserted once with stable nodes',async()=>{
 let response=data();const b=boot(async()=>response);await tick();const w=b.w;
 assert.match(w.document.querySelector('.beo-live-state').textContent,/EN DIRECT/);
 assert.equal(w.document.querySelectorAll('.beo-live-row').length,1);
 const first=w.document.querySelector('.beo-live-row');b.run(5000);await tick();assert.equal(w.document.querySelector('.beo-live-row'),first);
 response=data([{id:2,movement:'DEPARTURE'},{id:1,movement:'ARRIVAL'}]);response.summary.present_now=0;b.run(5000);await tick();
 assert.equal(w.document.querySelectorAll('.beo-live-row').length,2);assert.match(w.document.querySelector('.beo-live-rows').textContent,/SORTIE/);assert.equal(w.document.querySelector('[data-kpi="present_now"] b').textContent,'0');
 b.cleanup();assert.equal(b.timers.size,0);w.close();
});
test('combined site group status method search and KPI filters sent to server',async()=>{
 const b=boot();await tick();
 for(const [key,v]of [['site_id','3'],['group','A'],['event_status','anomaly'],['method','QR']]){const el=b.w.document.querySelector(`[data-filter="${key}"]`);el.value=v;el.dispatchEvent(new b.w.Event('change',{bubbles:true}));await tick();}
 const q=b.w.document.querySelector('[data-filter="q"]');q.value='Agent';q.dispatchEvent(new b.w.Event('input',{bubbles:true}));b.run(220);await tick();
 assert.deepEqual(JSON.parse(JSON.stringify(b.calls.at(-1).params)),{site_id:'3',group:'A',event_status:'anomaly',method:'QR',q:'Agent'});
 b.w.document.querySelector('[data-kpi="present_now"]').click();await tick();assert.equal(b.calls.at(-1).params.population,'present_now');assert.equal(b.calls.at(-1).params.site_id,'3');assert.equal(b.calls.at(-1).params.method,'QR');
 b.cleanup();b.w.close();
});
test('API failure leaves daily sheet intact; no green live with old or empty events',async()=>{
 const b=boot(async()=>{throw Error('offline');});await tick();assert.match(b.w.document.querySelector('.beo-live-error').textContent,/temporairement indisponible/);assert.equal(b.w.document.querySelector('#daily').textContent,'Feuille quotidienne');assert.equal(b.w.document.querySelector('.beo-live-state').dataset.state,'error');b.cleanup();b.w.close();
 const c=boot(async()=>data([]));await tick();assert.doesNotMatch(c.w.document.querySelector('.beo-live-state').textContent,/EN DIRECT/);assert.match(c.w.document.querySelector('.beo-live-empty').textContent,/Aucun pointage/);c.cleanup();c.w.close();
});
test('no concurrent polling; cleanup aborts fetch and ignores late response',async()=>{
 let resolve;const b=boot(()=>new Promise(r=>resolve=r));await tick();b.w.dispatchEvent(new b.w.Event('online'));assert.equal(b.calls.length,1);const signal=b.calls[0].signal;b.cleanup();assert.equal(signal.aborted,true);resolve(data());await tick();assert.equal(b.w.document.querySelector('.beo-live'),null);assert.equal(b.timers.size,0);b.w.close();
});
test('hidden and offline stop polling; resume restarts; detached DOM destroys timers',async()=>{
 const b=boot();await tick();Object.defineProperty(b.w.document,'hidden',{configurable:true,value:true});b.w.document.dispatchEvent(new b.w.Event('visibilitychange'));assert.ok(![...b.timers.values()].some(t=>t.ms===5000));
 Object.defineProperty(b.w.document,'hidden',{configurable:true,value:false});b.w.document.dispatchEvent(new b.w.Event('visibilitychange'));await tick();assert.equal(b.calls.length,2);
 Object.defineProperty(b.w.navigator,'onLine',{configurable:true,value:false});b.w.dispatchEvent(new b.w.Event('offline'));assert.match(b.w.document.querySelector('.beo-live-state').textContent,/Connexion interrompue/);
 b.w.document.querySelector('main').replaceChildren();b.run(1000);assert.equal(b.timers.size,0);b.w.close();
});
test('agent click uses server-scoped day history, no mutation actions',async()=>{
 const b=boot();await tick();b.w.document.querySelector('[data-agent]').click();await tick();assert.equal(b.calls.at(-1).params.employee_id,1);assert.match(b.w.document.querySelector('.beo-live-detail-body').textContent,/Historique du jour/);assert.ok(b.calls.every(c=>!c.method));b.cleanup();b.w.close();
});
test('agent and anomaly content escaped; unsafe photo rejected',async()=>{
 const response=data();response.events[0].employee={...employee,nom:'<script>bad()</script>',photo:'javascript:alert(1)'};response.events[0].anomalies=[{message:'<img src=x onerror=bad()>',severity:'warning'}];const b=boot(async()=>response);await tick();assert.equal(b.w.document.querySelectorAll('.beo-live-rows script,.beo-live-rows img').length,0);assert.match(b.w.document.querySelector('.beo-live-rows').textContent,/<script>/);b.cleanup();b.w.close();
});

test('180 polling cycles keep unique rows and clean remounts',async()=>{
 const b=boot();await tick();for(let i=0;i<180;i++){b.run(5000);await new Promise(r=>setTimeout(r,0));}
 assert.equal(b.calls.length,181);assert.equal(b.w.document.querySelectorAll('.beo-live-row').length,1);b.cleanup();assert.equal(b.timers.size,0);b.w.close();
 const c=boot();await tick();assert.equal(c.calls.length,1);c.cleanup();c.w.close();
});
