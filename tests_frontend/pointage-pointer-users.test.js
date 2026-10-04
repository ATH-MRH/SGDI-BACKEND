const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const HTML=fs.readFileSync(path.join(__dirname,'../app/static/pointage/index.html'),'utf8');
const sites=[{id:3,name:'HAMOUL 01',society:'IRON GLOBAL SOLUTION'},{id:4,name:'HAMOUL 02',society:'IRON GLOBAL SOLUTION'}];
const pointer={id:1,username:'PTG01',full_name:'Pointeur Oran',societies:['IRON GLOBAL SOLUTION'],site_ids:[3],sites:[sites[0]],is_active:true,last_login:null};
async function wait(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timeout');}
function boot(t,{actions=['read','create','update'],fail=false}={}){
 const calls=[],errors=[];let rows=[{...pointer}];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(HTML,{url:'https://pointage.irongs.com/#/pointers',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.sessionStorage.setItem('atlas_pointage_token','test');w.matchMedia=()=>({matches:false,addEventListener(){}});w.confirm=()=>true;
  w.fetch=async(url,opts={})=>{const u=new URL(url,w.location.origin),method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):null;calls.push({path:u.pathname,method,body});let data,status=200;
   if(u.pathname==='/api/auth/me')data={username:'MANAGER',full_name:'Responsable'};
   else if(u.pathname==='/api/attendance/sites')data=sites;
   else if(u.pathname.endsWith('/pointers/capabilities'))data={actions,sites,societies:['IRON GLOBAL SOLUTION']};
   else if(u.pathname==='/api/attendance/pointers'&&method==='GET')data={items:rows,kpi:{total:rows.length,active:rows.filter(x=>x.is_active).length,disabled:rows.filter(x=>!x.is_active).length,sites:new Set(rows.flatMap(x=>x.site_ids)).size}};
   else if(u.pathname.startsWith('/api/attendance/pointers')&&method!=='GET'){
    if(fail){status=403;data={detail:'Périmètre interdit'};}
    else if(method==='POST'){data={...body,id:2,sites:sites.filter(x=>body.site_ids.includes(x.id)),last_login:null};rows.push(data);}
    else{data=rows.find(x=>x.id===Number(u.pathname.split('/').at(-1)));Object.assign(data,body);data.sites=sites.filter(x=>data.site_ids.includes(x.id));}
   }else{status=404;data={detail:'Unavailable'};}
   return{ok:status<400,status,text:async()=>JSON.stringify(data)};
  };
 }});t.after(()=>{dom.window.close();assert.deepEqual(errors,[]);});
 const d=dom.window.document,w=dom.window;
 return{d,w,calls,click(selector){const b=d.querySelector(selector);assert.ok(b,selector);b.click();},set(name,value){const e=d.querySelector(`#pointer-form [name="${name}"]`);e.value=value;},ready:()=>wait(()=>d.querySelector('[data-pointer-id="1"]')),submit(){d.querySelector('#pointer-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}};
}
test('Pointeurs : liste, KPI, recherche, création minimale et périmètres obligatoires',async t=>{
 const c=boot(t);await c.ready();assert.equal(c.d.querySelector('[data-pointer-kpi="total"]').textContent,'1');
 c.click('#pointer-add');c.set('full_name','Pointeur 2');c.set('username','PTG02');c.set('password','Secret-test-123');
 c.submit();assert.match(c.d.querySelector('#pointer-form-error').textContent,/société et un site/);assert.equal(c.calls.filter(x=>x.method==='POST').length,0);
 c.click('[name="societies"]');c.click('[name="site_ids"][value="4"]');c.submit();await wait(()=>c.d.querySelector('[data-pointer-id="2"]'));
 const body=c.calls.find(x=>x.method==='POST').body;assert.deepEqual(body.site_ids,[4]);assert.deepEqual(body.societies,['IRON GLOBAL SOLUTION']);
 assert.equal(body.username,'PTG02');assert.equal(body.role,undefined);assert.equal(body.authorized_modules,undefined);
 assert.equal(c.d.querySelector('[data-pointer-kpi="total"]').textContent,'2');assert.doesNotMatch(c.d.querySelector('#pointer-rows').textContent,/Secret-test/);
 const search=c.d.querySelector('#pointer-search');search.value='PTG02';search.dispatchEvent(new c.w.Event('input'));assert.equal(c.d.querySelectorAll('[data-pointer-id]').length,1);
});
test('Modification, désactivation et annulation préservent les identifiants et recalculent les KPI',async t=>{
 const c=boot(t);await c.ready();c.click('[data-pointer-edit="1"]');assert.equal(c.d.querySelector('#pointer-form [name="username"]'),null);
 c.set('full_name','Renommé');c.click('[name="site_ids"][value="4"]');c.submit();await wait(()=>c.d.querySelector('[data-pointer-id="1"]').textContent.includes('Renommé'));
 c.w.confirm=()=>false;c.click('[data-pointer-disable="1"]');assert.equal(c.calls.filter(x=>x.method==='PATCH').length,1);
 c.w.confirm=()=>true;c.click('[data-pointer-disable="1"]');await wait(()=>c.d.querySelector('[data-pointer-kpi="disabled"]').textContent==='1');assert.match(c.d.querySelector('[data-pointer-id="1"]').textContent,/Désactivé/);
});
test('Permission lecture seule : aucune création ni modification dans la vue',async t=>{
 const c=boot(t,{actions:['read']});await c.ready();assert.ok(c.d.getElementById('pointer-add').classList.contains('hidden'));assert.equal(c.d.querySelector('[data-pointer-edit]'),null);
});
test('Refus API : formulaire conservé sans ajout local',async t=>{
 const c=boot(t,{fail:true});await c.ready();c.click('#pointer-add');c.set('full_name','New');c.set('username','PTG02');c.set('password','Secret123');c.click('[name="societies"]');c.click('[name="site_ids"]');c.submit();await wait(()=>/interdit/.test(c.d.getElementById('pointer-form-error').textContent));assert.equal(c.d.querySelectorAll('[data-pointer-id]').length,1);
});
test('Administration centrale conserve le rôle Pointeur en modification',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../app/static/js/modules/administration-user-forms.js'),'utf8');
 const vm=require('node:vm'),context={adminAccessBaseRole:r=>r.toLowerCase(),ADMIN_USER_ROLES:['agent','dispatch','ops','ADM'],SGDIModules:{registerModule(){}}};vm.createContext(context);vm.runInContext(source,context);
 assert.equal(context.normalizeAdminUserRole('pointeur'),'pointeur');assert.ok(context.adminUserRoleOptions().includes('pointeur'));
 assert.match(context.adminBeoRoleGuard({role:'pointeur',societesAutorisees:[],sitesAutorises:[]}),/Pointeur.*société/);
 assert.match(context.adminBeoRoleGuard({role:'pointeur',societesAutorisees:['S'],sitesAutorises:[]}),/Pointeur.*site/);
});
test('Sans permission : menu masqué et lien direct refusé sans afficher de Pointeurs',async t=>{
 const c=boot(t,{actions:[]});await wait(()=>c.calls.some(x=>x.path.endsWith('/pointers/capabilities'))&&!c.d.getElementById('app').classList.contains('hidden'));await new Promise(r=>setTimeout(r,20));
 assert.ok(c.d.getElementById('pointer-nav').classList.contains('hidden'));assert.ok(c.d.getElementById('view-pointers').classList.contains('hidden'));assert.equal(c.calls.filter(x=>x.path==='/api/attendance/pointers').length,0);
});
