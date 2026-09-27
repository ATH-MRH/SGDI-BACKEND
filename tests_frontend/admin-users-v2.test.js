const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSgdiApp } = require('./load-app');
const fs = require('node:fs');
const path = require('node:path');

const names = ['renderAdminUsers','adminUsersState','adminFilterUsers','adminUserSocietyChanged','adminUsersSetPage','adminUsersSetPageSize','adminResetUserFilters','adminSetUserStatusFilter','adminUsersToggleAdvanced','adminUsersRenderStatus','adminUsersScope','adminViewUserByKey','adminScheduleUserSearch','adminUsersLoadSites','ensureAdminUsersFresh','SGDI'];
function fixture(extra = []) {
  const ctx = loadSgdiApp(names);
  assert.ifError(ctx.loadError);
  const api=ctx.T(),win=ctx.window;
  win.history.replaceState(null,'','https://drh.irongs.com/#/admin/users');
  api.setSession({username:'ADMIN_TEST',nom:'Admin test',role:'ADM',adminSystem:true});
  api.setDb({users:[
    {username:'ADMIN_TEST',nom:'Admin Système',email:'admin@test.invalid',role:'ADM',actif:true,globalSocietyAccess:true,moduleAccessGlobal:true,societesAutorisees:[],sitesAutorises:[],backendId:1},
    {username:'CE01',nom:'Élodie Chargée',email:'elodie@test.invalid',role:'charge_effectifs_site',niveau:'H2',actif:true,modulesAutorises:['site_workforce'],societesAutorisees:['Société A'],sitesAutorises:[11],backendId:2},
    {username:'OPS01',nom:'Ops B',email:'ops@test.invalid',role:'ops',niveau:'H3',actif:false,modulesAutorises:['ops'],societesAutorisees:['Société B'],sitesAutorises:[21],backendId:3},
    {username:'MULTI',nom:'Multi société',email:'multi@test.invalid',role:'ops',niveau:'H3',actif:true,modulesAutorises:['drh','site_workforce'],societesAutorisees:['Société A','Société B'],sitesAutorises:[11,21],backendId:4},
    {username:'NO_SCOPE',nom:'Sans périmètre',email:'',role:'agent',actif:true,societesAutorisees:[],sitesAutorises:[],backendId:5},
    ...extra
  ],sites:[{id:'11',backendId:11,nom:'DHL Nord',societe:'Société A'},{id:'12',backendId:12,nom:'DHL Sud',societe:'Société A'},{id:'21',backendId:21,nom:'FIAT',societe:'Société B'}],settings:{},niveauxAcces:[],droitsAcces:{}});
  api.renderAdminUsers(win.document.getElementById('view'));
  const el=id=>win.document.getElementById(id);
  const visible=()=>[...win.document.querySelectorAll('[data-admin-user-row]')].map(r=>r.textContent);
  const filter=(id,value)=>{el(id).value=value;api.adminFilterUsers();};
  return {...ctx,api,el,visible,filter};
}
function using(fn) { const ctx=fixture();try{return fn(ctx)}finally{ctx.window.close()} }

test('V2 : hiérarchie, breadcrumb, titre et trois actions principales',()=>using(({window,el})=>{
  assert.equal(window.document.querySelector('.admin-users-page h1').textContent,'Gestion des utilisateurs');
  assert.match(window.document.querySelector('.admin-users-head p').textContent,/comptes, profils, périmètres et droits/);
  assert.match(window.document.querySelector('[aria-label="Fil d’Ariane"]').textContent,/Administration système.*Identités & accès.*Utilisateurs/);
  const buttons=[...window.document.querySelectorAll('.admin-users-head-actions button')];
  assert.deepEqual(buttons.map(b=>b.textContent),["Profils d'accès",'Matrice des droits','+ Nouvel utilisateur']);
  assert.equal(buttons[0].getAttribute('onclick'),"navigate('admin/niveaux')");
  assert.equal(buttons[1].getAttribute('onclick'),"navigate('admin/droits')");
  assert.equal(buttons[2].getAttribute('onclick'),"openAdminUserModal('')");
  assert.doesNotMatch(el('view').textContent,/Société de configuration|DERNIÈRE CONNEXION|\+2 ce mois|100%/);
}));

test('V2 : cinq KPI réels, sans tendances ni accès global déduit du rôle',()=>using(({window})=>{
  const kpis=[...window.document.querySelectorAll('.admin-users-kpi')];
  assert.equal(kpis.length,5);
  assert.deepEqual(kpis.map(k=>k.querySelector('strong').textContent),['5','4','1','1','1']);
  assert.equal(kpis[4].title,'Email ou profil manquant');
}));

test('V2 : recherche nom sans accent, identifiant, email, rôle et profil',()=>using(({filter,visible})=>{
  for(const [term,count] of [['elodie',1],['OPS01',1],['multi@test.invalid',1],['Cadre',2],['H3',2],['zzzz',0]]){
    filter('admin-user-search',term);assert.equal(visible().length,count,term);
  }
}));

test('V2 : recherche différée conserve une seule exécution',async()=>{
  const c=fixture();try{
    c.el('admin-user-search').value='el';c.api.adminScheduleUserSearch();
    c.el('admin-user-search').value='elodie';c.api.adminScheduleUserSearch();
    assert.equal(c.visible().length,5);
    await new Promise(r=>setTimeout(r,220));assert.equal(c.visible().length,1);
  }finally{c.window.close()}
});

test('V2 : filtres société, site, rôle et statut se combinent sans toucher le contexte',()=>using(({api,el,visible,window,filter})=>{
  window.sessionStorage.setItem('adminSocieteActive','Contexte à préserver');
  el('admin-user-society-filter').value='Société A';api.adminUserSocietyChanged();
  assert.equal(visible().length,3);
  assert.deepEqual([...el('admin-user-site-filter').options].map(o=>o.value),['','11','12']);
  filter('admin-user-site-filter','11');assert.equal(visible().length,3);
  filter('admin-user-role-filter','site_workforce');assert.equal(visible().length,2);
  filter('admin-user-status-filter','blocked');assert.equal(visible().length,0);
  assert.equal(window.sessionStorage.getItem('adminSocieteActive'),'Contexte à préserver');
}));

test('V2 : changement société réinitialise le site devenu hors contexte',()=>using(({api,el,filter})=>{
  filter('admin-user-site-filter','11');
  el('admin-user-society-filter').value='Société B';api.adminUserSocietyChanged();
  assert.equal(el('admin-user-site-filter').value,'');
  assert.deepEqual([...el('admin-user-site-filter').options].map(o=>o.value),['','21']);
}));

test('V2 : option BEO unique sur la clé site_workforce et profil réel filtrable',()=>using(({el,filter,visible})=>{
  const beo=[...el('admin-user-role-filter').options].filter(o=>o.value==='site_workforce');
  assert.equal(beo.length,1);assert.equal(beo[0].textContent,'Chargé des effectifs / BEO');
  filter('admin-user-role-filter','site_workforce');assert.equal(visible().length,2);
  filter('admin-user-role-filter','profile:H2');assert.equal(visible().length,1);
}));

test('V2 : filtres avancés réellement disponibles, réinitialisation complète',()=>using(({api,el,window,visible})=>{
  const toggle=window.document.querySelector('.admin-users-advanced-toggle');
  api.adminUsersToggleAdvanced(toggle);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(el('admin-users-advanced').hidden,false);
  el('admin-user-global-filter').checked=true;api.adminFilterUsers();assert.equal(visible().length,1);
  el('admin-user-global-filter').checked=false;el('admin-user-review-filter').checked=true;api.adminFilterUsers();assert.equal(visible().length,1);assert.match(visible()[0],/Sans périmètre/);
  api.adminResetUserFilters();assert.equal(visible().length,5);assert.equal(el('admin-user-review-filter').checked,false);
}));

test('V2 : filtre module utilise authorized_modules et global confirmé',()=>using(({filter,visible})=>{
  filter('admin-user-module-filter','ops');assert.equal(visible().length,2);
  filter('admin-user-module-filter','site_workforce');assert.equal(visible().length,3);
}));

test('V2 : accès global jamais inventé pour listes de sociétés vides',()=>using(({api})=>{
  assert.equal(api.adminUsersScope({role:'ADM',societesAutorisees:[],sitesAutorises:[]}).company,'Aucun périmètre');
  assert.equal(api.adminUsersScope({globalSocietyAccess:true,societesAutorisees:[],sitesAutorises:[]}).company,'Toutes');
  assert.equal(api.adminUsersScope({role:'charge_effectifs_site',modulesAutorises:['site_workforce'],societesAutorisees:['Société A'],sitesAutorises:[]}).site,'Aucun site attribué');
  assert.equal(api.adminUsersScope({role:'ops',societesAutorisees:['Société A'],sitesAutorises:[]}).site,'Tous du périmètre');
}));

test('V2 : cellules multi sociétés/sites compactes et détails accessibles',()=>using(({window})=>{
  const row=[...window.document.querySelectorAll('[data-admin-user-row]')].find(r=>r.textContent.includes('Multi société'));
  assert.match(row.textContent,/2 sociétés/);assert.match(row.textContent,/2 sites/);
  assert.match(row.querySelector('[aria-label^="Voir les sociétés"]').title,/Société A.*Société B/);
  assert.match(row.querySelector('[aria-label^="Voir les sites"]').title,/DHL Nord.*FIAT/);
}));

test('V2 : statuts explicites et actions existantes dans menu accessible',()=>using(({window})=>{
  const rows=[...window.document.querySelectorAll('[data-admin-user-row]')];
  const blocked=rows.find(r=>r.textContent.includes('Ops B'));
  assert.equal(blocked.querySelector('.admin-user-state').textContent,'Bloqué');
  assert.ok(blocked.querySelector('button[aria-label="Voir Ops B"]'));
  assert.ok(blocked.querySelector('button[aria-label="Modifier Ops B"]'));
  assert.ok(blocked.querySelector('[popovertarget]'));
  assert.match(blocked.querySelector('[popover]').textContent,/Permissions.*Réactiver.*Supprimer/);
  const own=rows[0];assert.doesNotMatch(own.querySelector('[popover]').textContent,/Suspendre|Supprimer/);
}));

test('V2 : pagination locale 10/25/50, page et reset après filtrage',()=>{
  const c=fixture(Array.from({length:20},(_,i)=>({username:`EXTRA${i}`,nom:`Extra ${i}`,role:'agent',email:`e${i}@test.invalid`,actif:true,niveau:'H1'})));
  try{
    assert.equal(c.visible().length,10);assert.match(c.el('admin-user-visible-count').textContent,/1 à 10 sur 25/);
    c.api.adminUsersSetPage(3);assert.equal(c.visible().length,5);assert.match(c.el('admin-user-visible-count').textContent,/21 à 25/);
    c.filter('admin-user-search','Elodie');assert.equal(c.visible().length,1);assert.equal(c.api.adminUsersState().page,1);
    c.api.adminResetUserFilters();c.api.adminUsersSetPageSize('25');assert.equal(c.visible().length,25);
    c.api.adminUsersSetPageSize('999');assert.equal(c.api.adminUsersState().size,10);
  }finally{c.window.close()}
});

test('V2 : aucun résultat avec réinitialisation, aucun utilisateur sans action morte',()=>using(({filter,el,api})=>{
  filter('admin-user-search','inexistant');assert.match(el('admin-users-rows').textContent,/Aucun utilisateur ne correspond/);assert.match(el('admin-users-rows').textContent,/Réinitialiser/);
  api.getDb().users=[];api.renderAdminUsers(el('view'));assert.match(el('admin-users-rows').textContent,/Aucun utilisateur disponible/);assert.doesNotMatch(el('admin-users-rows').textContent,/Réinitialiser/);
}));

test('V2 : KPI sélectionnent les filtres existants',()=>using(({api,visible})=>{
  api.adminSetUserStatusFilter('blocked');assert.equal(visible().length,1);assert.match(visible()[0],/Ops B/);
  api.adminSetUserStatusFilter('admin');assert.equal(visible().length,1);assert.match(visible()[0],/Admin Système/);
  api.adminSetUserStatusFilter('alert');assert.equal(visible().length,1);assert.match(visible()[0],/Sans périmètre/);
  api.adminSetUserStatusFilter('all');assert.equal(visible().length,5);
}));

test('V2 : chargement, erreur utilisateur/catalogue et réessai explicites',()=>using(({window,api,el})=>{
  window.__sgdiAdminUsersLoading=true;api.adminUsersRenderStatus();assert.match(el('admin-users-status').textContent,/Actualisation/);
  window.__sgdiAdminUsersLoading=false;window.__sgdiAdminUsersLoadError='network';api.adminUsersRenderStatus();assert.match(el('admin-users-status').textContent,/données affichées peuvent être anciennes/);assert.match(el('admin-users-status').textContent,/Réessayer/);
  window.__sgdiAdminUsersLoadError='';api.adminUsersState().sitesError='network';api.adminUsersRenderStatus();assert.match(el('admin-users-status').textContent,/catalogue des sites/);
}));

test('V2 : champs de filtres nommés, focus et scroll localisé prévus',()=>using(({window})=>{
  const inputs=[...window.document.querySelectorAll('.admin-users-page input,.admin-users-page select')];
  assert.ok(inputs.length>=9);for(const input of inputs){assert.ok(input.closest('label'),input.id);assert.ok(input.hasAttribute('data-no-lock'),input.id)}
  assert.equal(window.document.querySelector('.admin-users-table-wrap').getAttribute('tabindex'),'0');
  assert.equal(window.document.querySelector('.admin-users-table-wrap').getAttribute('role'),'region');
  const css=fs.readFileSync(path.join(__dirname,'../app/static/admin-users-v2.css'),'utf8');
  assert.match(css,/overflow-x:auto/);assert.match(css,/:focus-visible/);assert.match(css,/@media\(max-width:550px\)/);
}));

test('V2 : détail lecture seule expose le périmètre sans secret ni nouvelle permission',()=>using(({api,window})=>{
  api.getDb().users[1].password='NE_JAMAIS_AFFICHER';api.adminViewUserByKey('CE01');
  const modal=window.document.getElementById('modal-host');
  assert.match(modal.textContent,/Élodie Chargée/);assert.match(modal.textContent,/Société A/);assert.match(modal.textContent,/DHL Nord/);
  assert.equal(modal.querySelectorAll('input,select').length,0);assert.doesNotMatch(modal.textContent,/NE_JAMAIS_AFFICHER/);
}));

test('V2 : contenus utilisateur échappés et clés onclick sûres',()=>using(({api,el,window})=>{
  api.getDb().users=[{username:"x');alert(1);//",nom:'<img src=x onerror=alert(1)>',email:'<svg onload=alert(1)>',role:'agent',actif:true}];
  api.renderAdminUsers(el('view'));assert.equal(el('view').querySelectorAll('img').length,0);assert.equal(el('view').querySelectorAll('svg[onload]').length,0);
  assert.ok(window.document.querySelector('button[onclick*="%27"]'));
}));

test('V2 : catalogue sites dédupliqué et chargé une fois, aucun appel par ligne',async()=>{
  const c=fixture();try{
    let resolve,calls=0;c.api.SGDI.sites.list=()=>{calls++;return new Promise(r=>{resolve=r})};
    c.window.sessionStorage.setItem('sgdi_api_token_v1','test-token');
    c.api.adminUsersLoadSites();c.api.adminUsersLoadSites();assert.equal(calls,1);
    resolve([{id:31,name:'Site réel distant',equipment_plan:{societe:'Société distante'}}]);
    await new Promise(r=>setTimeout(r,0));
    assert.match(c.el('admin-user-site-filter').textContent,/Site réel distant/);
    c.api.adminUsersLoadSites();assert.equal(calls,1);
  }finally{c.window.close()}
});

test('V2 : réponse catalogue tardive ignorée après changement de session',async()=>{
  const c=fixture();try{
    let resolve;c.api.SGDI.sites.list=()=>new Promise(r=>{resolve=r});
    c.window.sessionStorage.setItem('sgdi_api_token_v1','test-token');c.api.adminUsersLoadSites();
    const previousSites=c.api.getDb().sites;c.api.setSession({username:'OTHER',role:'agent'});
    resolve([{id:99,name:'Ne doit pas être copié'}]);await new Promise(r=>setTimeout(r,0));
    assert.equal(c.api.getDb().sites,previousSites);assert.doesNotMatch(c.el('admin-user-site-filter').textContent,/Ne doit pas être copié/);
  }finally{c.window.close()}
});

test('V2 : liste initiale en chargement ne présente pas de faux zéro',()=>using(({api,window,el})=>{
  api.getDb().users=[];window.__sgdiAdminUsersLoadedAt=0;window.__sgdiAdminUsersLoading=true;
  api.renderAdminUsers(el('view'));
  assert.deepEqual([...window.document.querySelectorAll('.admin-users-kpi strong')].map(n=>n.textContent),['—','—','—','—','—']);
  assert.match(el('admin-users-rows').textContent,/Chargement des utilisateurs/);
}));


test('V2 : fraîcheur partagée avec le bootstrap, expiration et réessai forcé',async()=>{
  const c=fixture();try{
    let calls=0;c.api.SGDI.auth.listUsers=async()=>{calls++;return []};c.api.SGDI.auth.accessRules=async()=>[];
    c.window.sessionStorage.setItem('sgdi_api_token_v1','test-token');
    c.window.__sgdiAdminUsersFreshAt=0;c.window.__sgdiAdminUsersLoadedAt=Date.now();
    c.api.ensureAdminUsersFresh();assert.equal(calls,0,'pas de seconde liste complète après le bootstrap');
    c.api.ensureAdminUsersFresh(true);await new Promise(r=>setTimeout(r,0));
    assert.equal(calls,1,'le réessai explicite force un chargement');
    c.window.__sgdiAdminUsersFreshAt=0;c.window.__sgdiAdminUsersLoadedAt=Date.now()-11000;
    c.api.ensureAdminUsersFresh();await new Promise(r=>setTimeout(r,0));
    assert.equal(calls,2,'les données anciennes sont réactualisées');
    c.api.ensureAdminUsersFresh();assert.equal(calls,2,'le rafraîchissement reste temporisé');
  }finally{c.window.close()}
});
