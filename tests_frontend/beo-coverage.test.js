// BEO — Couverture terrain : rendu des données serveur (aucun calcul local), couleurs des groupes,
// statuts distincts Sous-effectif / Non couvert, filtres envoyés au serveur, échappement.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const api=fs.readFileSync('app/static/site-workforce/api.js','utf8');
const view=fs.readFileSync('app/static/site-workforce/views/couverture.js','utf8');
const until=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5))}throw Error('délai')};
const row=(site,group,status,label,expected,present)=>({site_id:1,site,occurrence_id:`1:5:${site}`,shift:'NUIT',shift_label:'Nuit',group,work_date:'2027-01-01',start:'19:00',end:'07:00',
 regime:'1/3',regime_label:'1/3',configuration_version:2,expected,required:3,present,gap:present==null?null:present-expected,late:1,maintained:0,absent:1,status,status_label:label,started:true});
function payload(){return {date:'2027-01-01',rows:[row('Mine du Nord','A','UNDERSTAFFED','Sous-effectif',3,2),row('Concasseur Est','B','ATTENTION','Attention',4,3),
   row('Usine','C','COVERED','Couvert',3,3),row('Campement',null,'UNCOVERED','Non couvert',0,0),row('Atelier','D','CRITICAL','Critique',3,0)],
 unplanned_sites:[{site_id:9,site:'Dépôt sans planning'}],
 critical_points:Array.from({length:8},(_,i)=>({id:i,type:i?'LATE':'UNDERSTAFFED',label:i?'Retard':'Sous-effectif',site:'Mine du Nord',employee:i?{id:i,name:'<b>KONE</b>, Moussa',matricule:'EMP-1'}:null,
   detail:i?'Retard de 45 min':'Service Nuit 19:00 – 07:00 : 1 poste(s) non couvert(s) (2/3 planifiés)',severity:i?'warning':'critical',status_label:i?'Ouvert':'Critique'})),
 watch:[{id:1,name:'DIALLO, Fatou',matricule:'EMP-2',group:'B',site:'Concasseur Est',kind:'abandon',label:'Abandon de poste (01/01)',photo_url:null}],
 kpis:{expected:13,present:8,late:3,maintained:1,absent:4,critical_points:8},total:{expected:13,present:8,gap:-5,status_label:'Sous-effectif'},sites:[]};}
function boot(){
 const dom=new JSDOM('<div id="c"></div>',{url:'http://localhost/site-workforce#/couverture',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];
 w.eval(api);w.SW.state.scopeInfo={societies:['SOC'],sites:[{id:1,name:'Mine du Nord',society:'SOC'}]};
 w.SW.guardedApi=async(slot,path,opts)=>{calls.push({path,params:{...opts.params}});return payload()};
 w.eval(view);
 const ctx={query:new w.URLSearchParams('vacation=NUIT'),navigate:k=>calls.push({navigate:k}),changeScope:()=>{}};
 const c=w.document.getElementById('c');
 return {w,c,calls,ctx,start:()=>w.SiteWorkforceViews.couverture(c,ctx)};
}

test('KPI, tableau de couverture, statuts distincts et couleurs de groupe',async()=>{
 const b=boot();await b.start();
 const text=b.c.textContent;
 assert.match(text,/Effectif attendu13.*Présents8.*Retards3.*Maintenus1.*Absences4.*Points critiques8/s);
 const pills=[...b.c.querySelectorAll('tbody td[data-label="Statut"] .cov-pill')].slice(0,5).map(p=>[p.textContent,p.className]);
 assert.deepEqual(pills.map(p=>p[0]),['Sous-effectif','Attention','Couvert','Non couvert','Critique']);
 assert.ok(pills[0][1].includes('cov-bad')&&pills[1][1].includes('cov-warn')&&pills[2][1].includes('cov-ok')&&pills[4][1].includes('cov-crit'));
 const colors=[...b.c.querySelectorAll('.cov-group i')].map(i=>i.style.background);
 assert.equal(new Set(colors).size,4,'quatre couleurs distinctes A/B/C/D');
 assert.match(text,/Aucun groupe/);                                   // vacation non couverte : aucun groupe admissible
 assert.match(text,/Sans planning officiel publié : Dépôt sans planning/);
 assert.match(text,/Total.*13.*8.*-5.*Sous-effectif/s);
 b.w.close();
});

test('points critiques limités puis dépliés, échappement, employés à surveiller',async()=>{
 const b=boot();await b.start();
 assert.equal(b.c.querySelectorAll('.cov-crit-table tbody tr').length,6);
 assert.equal(b.c.querySelector('b b'),null);                          // nom échappé
 assert.match(b.c.textContent,/Service Nuit 19:00 – 07:00 : 1 poste\(s\) non couvert\(s\)/);
 b.c.querySelector('[data-crit-all]').click();await until(()=>b.c.querySelectorAll('.cov-crit-table tbody tr').length===8);
 assert.match(b.c.querySelector('.cov-watch').textContent,/DIALLO, Fatou.*Groupe B.*Abandon de poste/s);
 b.c.querySelector('[data-go="position"]').click();assert.ok(b.calls.some(c=>c.navigate==='position'));
 b.w.close();
});

test('filtres groupe, vacation et date transmis au serveur',async()=>{
 const b=boot();await b.start();
 assert.deepEqual(JSON.parse(JSON.stringify(b.calls[0].params)),{date:b.calls[0].params.date,shift:'NUIT',group:''});
 const g=b.c.querySelector('#cov-group');g.value='C';g.dispatchEvent(new b.w.Event('change'));await until(()=>b.calls.length===2);
 b.c.querySelector('[data-shift="JOUR"]').click();await until(()=>b.calls.length===3);
 const d=b.c.querySelector('#cov-date');d.value='2027-02-03';d.dispatchEvent(new b.w.Event('change'));await until(()=>b.calls.length===4);
 assert.deepEqual(JSON.parse(JSON.stringify(b.calls[3].params)),{date:'2027-02-03',shift:'JOUR',group:'C'});
 b.w.close();
});
