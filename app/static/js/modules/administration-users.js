/* Administration users — déplacement sans modification de droits. */
function adminRoleColor(role){const b=normalizeAdminUserRole(role);if(b==="agent")return"#0f766e";if(b==="ops")return"#043970";if(b==="dispatch")return"#7c3aed";if(b==="ADM")return"#dc2626";return"#64748b"}

function renderAdmin(view,sub,arg){
  adminViewEpoch++;
  positionsStopInteractions();
  if(!isAdminGeneralSession()){view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700 mb-2">🔐 Accès refusé</h2><p class="text-slate-600">Cette section est réservée au compte Administration système.</p></div>`;return}
  const systemOnly=["menu","counters","recrutement","rotations","effectifs","access","access_sgdi","access_societes","access_structures","access_code","sync","users","supervisors","droits","commercial-dc","document-models","sections_candidat","niveaux","postes","magasins","catalogue","articles","priorites","fiches","pointages","contrats","candidats","portail-clients","beo"];
  if(systemOnly.includes(sub)&&!isAdminSystemSession()){view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700 mb-2">Accès système requis</h2><p class="text-slate-600">Cette configuration est réservée au compte Administration système. Les administrateurs généraux gardent la consultation directionnelle sans modifier les droits.</p></div>`;return}
  if(sub==="dashboard")return isAdminSystemSession()?renderAdminSystemDashboard(view):renderAdminDashboard(view);
  if(sub==="menu")return renderAdminSidebarMenu(view);
  if(sub==="counters")return renderAdminCountersMenu(view);
  if(sub==="recrutement")return renderAdminRecruitment(view);
  if(sub==="rotations")return renderAdminRotations(view);
  if(sub==="effectifs")return renderAdminEffectifsConfig(view);
  if(["access","access_sgdi","access_societes","access_structures","access_code"].includes(sub))return renderAdminAccessSecurity(view,sub);
  if(sub==="feed")return renderAdminFeed(view);
  if(sub==="messages")return renderAdminMessagesHistory(view);
  if(sub==="sync")return renderAdminSyncSettings(view);
  if(sub==="users")return renderAdminUsers(view);
  if(sub==="beo")return renderAdminBeo(view);
  if(sub==="portail-clients")return renderAdminClientPortalUsers(view);
  if(sub==="supervisors")return renderAdminSupervisors(view);
  if(sub==="droits")return renderAdminDroits(view);
  if(sub==="commercial-dc")return renderAdminCommercialDc(view);
  if(sub==="loans")return renderAdminLoans(view);
  if(sub==="document-models")return renderAdminDocumentModels(view);
  if(sub==="sections_candidat")return renderAdminCandidatSections(view);
  if(sub==="niveaux")return renderAdminNiveaux(view);
  if(sub==="postes")return renderAdminPostes(view);
  if(sub==="fiches")return arg?renderAgentForm(view,arg):renderAdminFichesPosition(view);
  if(sub==="pointages")return renderAdminPointages(view);
  if(sub==="contrats")return renderAdminContratsPersonnel(view);
  if(sub==="magasins")return renderAdminMagasins(view);
  if(sub==="catalogue"||sub==="articles")return renderAdminCatalogue(view);
  if(sub==="priorites")return renderAdminPriorites(view);
  if(sub==="alertes")return renderAdminAlertes(view);
  if(sub==="champs")return renderAdminChamps(view);
  if(sub==="modules")return renderAdminModules(view);
  if(sub==="log")return renderAdminLog(view);
  if(sub==="storage")return renderAdminStorage(view);
  if(sub==="candidats")return renderAdminCandidats(view);
  renderAdminDashboard(view);
}

// Vue de consultation : les filtres ne modifient ni le contexte de création ni les droits.
const ADMIN_BEO_FILTER="site_workforce";
let adminUsersV2State=null;
function adminUserIsBeo(user){return Array.isArray(user&&user.modulesAutorises)&&user.modulesAutorises.includes(ADMIN_BEO_FILTER)}
function adminUsersState(){
  const owner=String(session?.username||"");
  if(!adminUsersV2State||adminUsersV2State.owner!==owner)adminUsersV2State={owner,search:"",society:"",site:"",role:"",status:"all",module:"",review:false,global:false,advanced:false,page:1,size:10,rows:[],timer:null,sitesAt:0,sitesLoading:false,sitesError:""};
  return adminUsersV2State;
}
function adminUsersIcon(name){
  const paths={users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',shield:'<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Z"/><path d="m8 12 3 3 5-6"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',alert:'<path d="m12 3 10 18H2L12 3ZM12 9v5M12 17h.01"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',filter:'<path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',edit:'<path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5"/>'};
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.users}</svg>`;
}
function adminUsersSiteSociety(site){return String(sitePrimarySociete(site)||(typeof beoSiteSociete==="function"?beoSiteSociete(site):"")||"")}
function adminUsersSites(){return [...new Map((db.sites||[]).filter(s=>s&&(s.backendId||s.id)).map(s=>[String(s.backendId||s.id),s])).values()]}
function adminUserNeedsReview(user){return !user.email||(!user.niveau&&normalizeAdminUserRole(user.role)!=="ADM")}
function adminUsersGlobal(user){return user.globalSocietyAccess===true}
function adminUsersSocietyMatch(user,society){return !society||adminUsersGlobal(user)||(user.societesAutorisees||[]).some(s=>normalizeSocieteName(s)===normalizeSocieteName(society))}
function adminUsersSiteMatch(user,siteId,knownSite){
  if(!siteId)return true;
  const site=knownSite||adminUsersSites().find(s=>String(s.backendId||s.id)===String(siteId));
  if(!site||!adminUsersSocietyMatch(user,adminUsersSiteSociety(site)))return false;
  const ids=(user.sitesAutorises||[]).map(String);
  if(ids.length)return ids.includes(String(siteId));
  if(adminUserIsBeo(user)&&normalizeAdminUserRole(user.role)==="charge_effectifs_site")return false;
  return adminUsersGlobal(user)||(user.societesAutorisees||[]).length>0;
}
function adminUsersScope(user,siteCatalog){
  const societies=user.societesAutorisees||[],ids=(user.sitesAutorises||[]).map(String),sites=siteCatalog||new Map(adminUsersSites().map(s=>[String(s.backendId||s.id),s.nom||s.intitule||`Site #${s.backendId||s.id}`]));
  const siteLabels=ids.map(id=>sites.get(id)||`Site #${id}`);
  const company=adminUsersGlobal(user)?"Toutes":societies.length===1?societies[0]:societies.length?`${societies.length} sociétés`:"Aucun périmètre";
  const site=siteLabels.length===1?siteLabels[0]:siteLabels.length?`${siteLabels.length} sites`:(adminUserIsBeo(user)&&normalizeAdminUserRole(user.role)==="charge_effectifs_site")?"Aucun site attribué":(adminUsersGlobal(user)||societies.length)?"Tous du périmètre":"Aucun périmètre";
  return{company,site,companies:adminUsersGlobal(user)?"Accès global confirmé par le serveur":societies.join(" · ")||"Aucune société autorisée",sites:siteLabels.join(" · ")||site};
}
function ensureAdminUsersFresh(force=false){
  if(!sgdiBackendShouldUse()||!sgdiAuthToken())return;
  if(window.__sgdiAdminUsersLoading)return;
  // Le bootstrap partage sa fraîcheur : ne pas relire aussitôt toute la liste.
  const refreshedAt=Math.max(window.__sgdiAdminUsersFreshAt||0,window.__sgdiAdminUsersLoadedAt||0);
  if(!force&&Date.now()-refreshedAt<10000)return;
  window.__sgdiAdminUsersFreshAt=Date.now();
  const state=adminUsersState(),dbAtStart=db,owner=session;
  const current=()=>adminUsersV2State===state&&db===dbAtStart&&session===owner&&!!document.querySelector(".admin-users-page");
  sgdiLoadAuthState().then(()=>{if(current()){adminUsersBuildRows();adminUsersUpdateOptions();adminUsersRenderResults();adminUsersRenderStatus()}}).catch(e=>{if(current()){window.__sgdiAdminUsersLoadError=e.message||String(e);adminUsersRenderStatus()}});
}
function adminUsersLoadSites(force=false){
  const state=adminUsersState();
  if(!sgdiBackendShouldUse()||!sgdiAuthToken()||state.sitesLoading||(!force&&Date.now()-state.sitesAt<60000))return;
  state.sitesLoading=true;state.sitesError="";
  const dbAtStart=db,owner=session,token=sgdiAuthToken();
  // Un catalogue pour toute la vue, jamais une requête par utilisateur.
  SGDI.sites.list().then(rows=>{
    if(adminUsersV2State!==state||db!==dbAtStart||session!==owner||token!==sgdiAuthToken())return;
    db.sites=(Array.isArray(rows)?rows:[]).map(siteFromApi);state.sitesAt=Date.now();
    adminUsersBuildRows();adminUsersUpdateOptions();adminUsersRenderResults();
  }).catch(e=>{if(adminUsersV2State===state)state.sitesError=e.message||String(e)}).finally(()=>{state.sitesLoading=false;if(adminUsersV2State===state)adminUsersRenderStatus()});
}
function adminUsersRetry(){window.__sgdiAdminUsersFreshAt=0;ensureAdminUsersFresh(true);adminUsersLoadSites(true);adminUsersRenderStatus()}
function adminUsersBuildRows(){
  const state=adminUsersState(),profiles=new Map((db.niveauxAcces||[]).map(n=>[n.code,n])),siteCatalog=new Map(adminUsersSites().map(s=>[String(s.backendId||s.id),s.nom||s.intitule||`Site #${s.backendId||s.id}`]));
  state.rows=(db.users||[]).map(user=>{const role=normalizeAdminUserRole(user.role),profile=profiles.get(user.niveau),scope=adminUsersScope(user,siteCatalog);return{user,role,profile,scope,search:normalizedSearchText([user.username,user.nom,user.email,adminRoleDisplayLabel(role),user.niveau,profile?.label,...(user.societesAutorisees||[]),scope.sites].join(" "))}});
}
function renderAdminUsers(view){
  ensureNiveauxAcces();
  const state=adminUsersState();adminUsersBuildRows();
  view.innerHTML=`<div class="admin-users-page" data-nav-filter>
    <nav class="admin-users-breadcrumb" aria-label="Fil d’Ariane"><a href="#/admin/dashboard" onclick="event.preventDefault();navigate('admin/dashboard')">Administration système</a><span aria-hidden="true">›</span><span>Identités & accès</span><span aria-hidden="true">›</span><span aria-current="page">Utilisateurs</span></nav>
    <header class="admin-users-head"><div class="admin-users-title"><span class="admin-users-title-icon">${adminUsersIcon("users")}</span><div><h1>Gestion des utilisateurs</h1><p>Gérez les comptes, profils, périmètres et droits depuis un seul centre de contrôle.</p></div></div><div class="admin-users-head-actions"><button type="button" class="btn btn-secondary" onclick="navigate('admin/niveaux')">${adminUsersIcon("shield")}Profils d'accès</button><button type="button" class="btn btn-secondary" onclick="navigate('admin/droits')">${adminUsersIcon("grid")}Matrice des droits</button><button type="button" class="btn btn-primary" data-no-critical-auth="1" onclick="openAdminUserModal('')">${adminUsersIcon("users")}+ Nouvel utilisateur</button></div></header>
    <section class="admin-users-kpis" aria-label="Indicateurs utilisateurs"></section>
    <section class="admin-users-filters" aria-label="Filtres utilisateurs"><div class="admin-users-toolbar">
      <label class="admin-users-search"><span class="admin-users-sr">Rechercher un utilisateur</span>${adminUsersIcon("search")}<input id="admin-user-search" data-no-lock class="input" type="search" value="${escapeHTML(state.search)}" placeholder="Rechercher par nom, email, identifiant…" oninput="adminScheduleUserSearch()"/></label>
      <label><span class="admin-users-sr">Société</span><select id="admin-user-society-filter" data-no-lock class="select" onchange="adminUserSocietyChanged()"></select></label>
      <label><span class="admin-users-sr">Site</span><select id="admin-user-site-filter" data-no-lock class="select" onchange="adminFilterUsers()"></select></label>
      <label><span class="admin-users-sr">Rôle ou profil</span><select id="admin-user-role-filter" data-no-lock class="select" onchange="adminFilterUsers()"></select></label>
      <label><span class="admin-users-sr">Statut</span><select id="admin-user-status-filter" data-no-lock class="select" onchange="adminFilterUsers()"><option value="all">Tous les statuts</option><option value="active">Actif</option><option value="blocked">Bloqué</option></select></label>
      <button type="button" class="btn btn-secondary admin-users-advanced-toggle" aria-expanded="${state.advanced}" aria-controls="admin-users-advanced" onclick="adminUsersToggleAdvanced(this)">${adminUsersIcon("filter")}Filtres avancés</button>
    </div><div id="admin-users-advanced" class="admin-users-advanced" ${state.advanced?"":"hidden"}>
      <label>Module<select id="admin-user-module-filter" class="select" data-no-lock onchange="adminFilterUsers()"><option value="">Tous les modules</option>${ADMIN_LOGIN_MODULES.map(m=>`<option value="${escapeHTML(m.key)}">${escapeHTML(m.label)}</option>`).join("")}</select></label>
      <label class="admin-users-check"><input id="admin-user-review-filter" type="checkbox" data-no-lock onchange="adminFilterUsers()"/>Configuration à contrôler</label><label class="admin-users-check"><input id="admin-user-global-filter" type="checkbox" data-no-lock onchange="adminFilterUsers()"/>Accès global aux sociétés</label>
      <button type="button" class="btn btn-ghost" onclick="adminResetUserFilters()">Réinitialiser les filtres</button>
    </div></section>
    <div id="admin-users-status" role="status" aria-live="polite"></div>
    <section class="admin-users-table-card" aria-label="Liste des utilisateurs"><div class="admin-users-table-wrap" tabindex="0" role="region" aria-label="Tableau utilisateurs, défilement horizontal disponible"><table class="admin-users-table"><thead><tr><th scope="col">Utilisateur</th><th scope="col">Rôle / profil</th><th scope="col">Société(s)</th><th scope="col">Site(s)</th><th scope="col">Statut</th><th scope="col" class="admin-users-actions-heading">Actions</th></tr></thead><tbody id="admin-users-rows"></tbody></table></div><footer class="admin-users-pagination"><span id="admin-user-visible-count" aria-live="polite"></span><div id="admin-users-pages" aria-label="Pagination"></div><label><span class="admin-users-sr">Utilisateurs par page</span><select id="admin-user-page-size" data-no-lock class="select" onchange="adminUsersSetPageSize(this.value)"><option value="10">10 / page</option><option value="25">25 / page</option><option value="50">50 / page</option></select></label></footer></section>
  </div>`;
  adminUsersUpdateOptions();
  for(const [id,value] of [["admin-user-status-filter",state.status],["admin-user-module-filter",state.module],["admin-user-page-size",state.size]])document.getElementById(id).value=value;
  document.getElementById("admin-user-review-filter").checked=state.review;document.getElementById("admin-user-global-filter").checked=state.global;
  ensureAdminUsersFresh();adminUsersLoadSites();adminUsersRenderResults();adminUsersRenderStatus();
}
function adminUsersUpdateOptions(){
  const state=adminUsersState(),societies=[...new Set([...SOCIETES,...(db.users||[]).flatMap(u=>u.societesAutorisees||[]),...adminUsersSites().map(adminUsersSiteSociety)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr"));
  const update=(id,html,value)=>{const el=document.getElementById(id);if(el){el.innerHTML=html;el.value=value;return el.value}};
  const selectedSociety=update("admin-user-society-filter",`<option value="">Toutes les sociétés</option>${societies.map(s=>`<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join("")}`,state.society);
  if(typeof selectedSociety==="string")state.society=selectedSociety;
  const sites=adminUsersSites().filter(s=>!state.society||normalizeSocieteName(adminUsersSiteSociety(s))===normalizeSocieteName(state.society)).sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||""),"fr"));
  if(state.site&&!sites.some(s=>String(s.backendId||s.id)===state.site))state.site="";
  update("admin-user-site-filter",`<option value="">Tous les sites</option>${sites.map(s=>`<option value="${escapeHTML(String(s.backendId||s.id))}">${escapeHTML(s.nom||s.intitule||`Site #${s.backendId||s.id}`)}</option>`).join("")}`,state.site);
  const roles=[...new Set([...ADMIN_USER_ROLES,...state.rows.map(r=>r.role)])];
  const selectedRole=update("admin-user-role-filter",`<option value="">Tous les rôles / profils</option><optgroup label="Types de compte">${roles.map(r=>`<option value="${escapeHTML(r)}">${escapeHTML(adminRoleDisplayLabel(r))}</option>`).join("")}</optgroup><option value="${ADMIN_BEO_FILTER}">Chargé des effectifs / BEO</option><optgroup label="Profils d'accès">${(db.niveauxAcces||[]).map(n=>`<option value="profile:${escapeHTML(n.code)}">${escapeHTML(n.label||n.code)}</option>`).join("")}</optgroup>`,state.role);
}
function adminUsersRenderStatus(){
  const el=document.getElementById("admin-users-status");if(!el)return;
  const state=adminUsersState(),error=window.__sgdiAdminUsersLoadError||state.sitesError;
  el.className=error?"admin-users-notice error":(window.__sgdiAdminUsersLoading||state.sitesLoading)?"admin-users-notice":"";
  el.innerHTML=error?`<span>${window.__sgdiAdminUsersLoadError?"Impossible d’actualiser les utilisateurs. Les données affichées peuvent être anciennes.":"Impossible de charger le catalogue des sites. Les filtres de sites peuvent être incomplets."}</span><button type="button" class="btn btn-secondary" onclick="adminUsersRetry()">Réessayer</button>`:(window.__sgdiAdminUsersLoading||state.sitesLoading)?"Actualisation des utilisateurs et des sites…":"";
}
function adminUsersFilteredRows(){
  const s=adminUsersState(),q=normalizedSearchText(s.search),site=s.site?adminUsersSites().find(x=>String(x.backendId||x.id)===s.site):null;
  return s.rows.filter(r=>(!q||r.search.includes(q))&&(!s.role||(s.role===ADMIN_BEO_FILTER?adminUserIsBeo(r.user):s.role.startsWith("profile:")?r.user.niveau===s.role.slice(8):r.role===s.role))&&(s.status==="all"||(s.status==="active"?r.user.actif!==false:r.user.actif===false))&&adminUsersSocietyMatch(r.user,s.society)&&adminUsersSiteMatch(r.user,s.site,site)&&(!s.module||(r.user.modulesAutorises||[]).includes(s.module)||r.user.moduleAccessGlobal===true)&&(!s.review||adminUserNeedsReview(r.user))&&(!s.global||adminUsersGlobal(r.user)));
}
function adminUsersRenderResults(){
  const body=document.getElementById("admin-users-rows");if(!body)return;
  const state=adminUsersState(),rows=adminUsersFilteredRows(),total=state.rows.length,pages=Math.max(1,Math.ceil(rows.length/state.size));state.page=Math.min(Math.max(1,state.page),pages);
  const start=(state.page-1)*state.size,visible=rows.slice(start,start+state.size),initialLoading=!total&&!window.__sgdiAdminUsersLoadedAt&&!!window.__sgdiAdminUsersLoading,initialError=!total&&!window.__sgdiAdminUsersLoadedAt&&!!window.__sgdiAdminUsersLoadError;
  body.setAttribute("aria-busy",String(initialLoading));
  const counts=[total,state.rows.filter(r=>r.user.actif!==false).length,state.rows.filter(r=>r.user.actif===false).length,state.rows.filter(r=>r.role==="ADM").length,state.rows.filter(r=>adminUserNeedsReview(r.user)).length];
  document.querySelector(".admin-users-kpis").innerHTML=[["Utilisateurs total","Comptes enregistrés","all","users","blue"],["Utilisateurs actifs","Connexion autorisée","active","users","green"],["Utilisateurs bloqués","Comptes désactivés","blocked","lock","red"],["Administrateurs","Rôle administrateur","admin","shield","purple"],["À contrôler","Email ou profil manquant","alert","alert","orange"]].map(([label,desc,key,icon,tone],i)=>`<button type="button" class="admin-users-kpi ${tone}" onclick="adminSetUserStatusFilter('${key}')" title="${desc}"><i>${adminUsersIcon(icon)}</i><span><span class="admin-users-kpi-label">${label}</span><strong>${initialLoading||initialError?"—":counts[i]}</strong><small>${desc}</small></span></button>`).join("");
  body.innerHTML=visible.map((r,i)=>adminUsersRowHTML(r,i)).join("")||`<tr><td colspan="6" class="admin-users-empty"><strong>${initialLoading?"Chargement des utilisateurs…":initialError?"La liste des utilisateurs n’a pas pu être chargée.":total?"Aucun utilisateur ne correspond aux filtres sélectionnés.":"Aucun utilisateur disponible."}</strong>${total?'<button type="button" class="btn btn-secondary" onclick="adminResetUserFilters()">Réinitialiser les filtres</button>':""}</td></tr>`;
  body.querySelectorAll("[data-user-permissions]").forEach(button=>{button.onclick=()=>{adminCloseUserMenu(button.closest("[popover]").id);openGranularPermissionsByKey(button.dataset.userPermissions)}});
  document.getElementById("admin-user-visible-count").textContent=rows.length?`Affichage de ${start+1} à ${start+visible.length} sur ${rows.length} utilisateur${rows.length>1?"s":""}${rows.length!==total?` (${total} au total)`:""}`:initialLoading?"Chargement…":initialError?"Liste indisponible":"0 utilisateur";
  document.getElementById("admin-users-pages").innerHTML=`<button type="button" aria-label="Page précédente" ${state.page===1?"disabled":""} onclick="adminUsersSetPage(${state.page-1})">‹</button><span>Page <b>${state.page}</b> / ${pages}</span><button type="button" aria-label="Page suivante" ${state.page===pages?"disabled":""} onclick="adminUsersSetPage(${state.page+1})">›</button>`;
}
function adminUsersRowHTML(r,index){
  const u=r.user,key=encodeURIComponent(u.username).replace(/'/g,"%27"),self=String(u.username).toLowerCase()===String(session?.username||"").toLowerCase(),initials=String(u.nom||u.username||"U").trim().split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase(),scope=r.scope,name=escapeHTML(u.nom||u.username),id=`admin-user-menu-${index}`;
  return `<tr data-admin-user-row data-role="${escapeHTML(r.role)}" data-beo="${adminUserIsBeo(u)?"1":"0"}"><td><div class="admin-user-identity"><i aria-hidden="true">${escapeHTML(initials)}</i><div><b>${name}</b><span>${escapeHTML(u.username)}${u.email?` · ${escapeHTML(u.email)}`:""}</span></div></div></td><td><span class="admin-user-role" style="--role:${adminRoleColor(u.role)}">${escapeHTML(r.profile?.label||adminRoleDisplayLabel(r.role))}</span>${r.profile?`<small>${escapeHTML(adminRoleDisplayLabel(r.role))}</small>`:""}</td><td><button class="admin-users-scope" type="button" title="${escapeHTML(scope.companies)}" aria-label="Voir les sociétés de ${name}" onclick="adminViewUserByKey('${key}')">${escapeHTML(scope.company)}</button></td><td><button class="admin-users-scope" type="button" title="${escapeHTML(scope.sites)}" aria-label="Voir les sites de ${name}" onclick="adminViewUserByKey('${key}')">${escapeHTML(scope.site)}</button></td><td><span class="admin-user-state ${u.actif===false?"blocked":"active"}">${u.actif===false?"Bloqué":"Actif"}</span>${adminUserNeedsReview(u)?'<small class="admin-user-alert" title="Email ou profil d’accès manquant">À contrôler</small>':""}</td><td><div class="admin-user-actions"><button type="button" data-no-critical-auth="1" title="Voir ${name}" aria-label="Voir ${name}" onclick="adminViewUserByKey('${key}')">${adminUsersIcon("eye")}</button><button type="button" data-no-critical-auth="1" title="Modifier ${name}" aria-label="Modifier ${name}" onclick="openAdminUserModalByKey('${key}')">${adminUsersIcon("edit")}</button>${u.backendId||!self?`<button type="button" data-no-critical-auth="1" title="Autres actions pour ${name}" aria-label="Autres actions pour ${name}" aria-haspopup="true" popovertarget="${id}" onclick="adminPositionUserMenu(this,'${id}')">···</button><div id="${id}" class="admin-user-action-menu" popover="auto" aria-label="Actions pour ${name}">${u.backendId?`<button type="button" data-user-permissions="${key}" onclick="adminCloseUserMenu('${id}');openGranularPermissionsByKey('${key}')">Permissions</button>`:""}${!self?`<button type="button" class="${u.actif===false?"allow":"deny"}" onclick="adminCloseUserMenu('${id}');adminToggleUserActiveByKey('${key}',${u.actif===false?"true":"false"})">${u.actif===false?"Réactiver":"Suspendre"}</button><button type="button" class="deny" onclick="adminCloseUserMenu('${id}');adminDeleteUserByKey('${key}')">Supprimer</button>`:""}</div>`:""}</div></td></tr>`;
}
function adminPositionUserMenu(button,id){const menu=document.getElementById(id),rect=button.getBoundingClientRect();if(!menu)return;menu.style.left=`${Math.max(8,Math.min(rect.right-172,innerWidth-180))}px`;menu.style.top=`${Math.max(8,Math.min(rect.bottom+4,innerHeight-152))}px`}
function adminCloseUserMenu(id){const menu=document.getElementById(id);if(menu?.hidePopover)menu.hidePopover()}
function adminScheduleUserSearch(){const state=adminUsersState();clearTimeout(state.timer);state.timer=setTimeout(()=>adminFilterUsers(),180)}
function adminFilterUsers(){
  const state=adminUsersState();clearTimeout(state.timer);
  for(const [key,id,fallback] of [["search","admin-user-search",""],["society","admin-user-society-filter",""],["site","admin-user-site-filter",""],["role","admin-user-role-filter",""],["status","admin-user-status-filter","all"],["module","admin-user-module-filter",""]])state[key]=document.getElementById(id)?.value||fallback;
  state.review=!!document.getElementById("admin-user-review-filter")?.checked;state.global=!!document.getElementById("admin-user-global-filter")?.checked;state.page=1;adminUsersRenderResults();
}
function adminUserSocietyChanged(){const state=adminUsersState();state.society=document.getElementById("admin-user-society-filter").value;state.site="";adminUsersUpdateOptions();adminFilterUsers()}
function adminUsersToggleAdvanced(button){const state=adminUsersState();state.advanced=!state.advanced;document.getElementById("admin-users-advanced").hidden=!state.advanced;button.setAttribute("aria-expanded",String(state.advanced))}
function adminResetUserFilters(){const state=adminUsersState();for(const key of ["search","society","site","role","module"])state[key]="";state.status="all";state.review=false;state.global=false;state.page=1;renderAdminUsers(document.getElementById("view"))}
function adminSetUserStatusFilter(value){
  const state=adminUsersState();state.status=["active","blocked"].includes(value)?value:"all";state.role=value==="admin"?"ADM":"";state.review=value==="alert";
  document.getElementById("admin-user-status-filter").value=state.status;document.getElementById("admin-user-role-filter").value=state.role;document.getElementById("admin-user-review-filter").checked=state.review;
  if(state.review&&!state.advanced)adminUsersToggleAdvanced(document.querySelector(".admin-users-advanced-toggle"));adminFilterUsers();
}
function adminUsersSetPage(page){adminUsersState().page=page;adminUsersRenderResults()}
function adminUsersSetPageSize(size){const state=adminUsersState();state.size=[10,25,50].includes(Number(size))?Number(size):10;state.page=1;adminUsersRenderResults()}
function adminViewUserByKey(encoded){
  const u=adminUserByUsername(decodeURIComponent(encoded));if(!u)return toast("Utilisateur introuvable","error");
  const scope=adminUsersScope(u),profile=(db.niveauxAcces||[]).find(n=>n.code===u.niveau),labels=(items,defs)=>items.length?items.map(v=>escapeHTML(defs.find(d=>d.key===v)?.label||v)).join(" · "):"Héritage du profil";
  openModal(`<div class="admin-user-readonly"><h2>Utilisateur · ${escapeHTML(u.nom||u.username)}</h2><p>Configuration enregistrée du compte</p><dl><dt>Identifiant</dt><dd>${escapeHTML(u.username)}</dd><dt>Email</dt><dd>${escapeHTML(u.email||"Non renseigné")}</dd><dt>Type de compte</dt><dd>${escapeHTML(adminRoleDisplayLabel(normalizeAdminUserRole(u.role)))}</dd><dt>Profil d'accès</dt><dd>${escapeHTML(profile?.label||u.niveau||"Non défini")}</dd><dt>Sociétés</dt><dd>${escapeHTML(scope.companies)}</dd><dt>Sites</dt><dd>${escapeHTML(scope.sites)}</dd><dt>Modules</dt><dd>${u.moduleAccessGlobal===true?"Accès global confirmé par le serveur":(Array.isArray(u.modulesAutorises)?(u.modulesAutorises.length?labels(u.modulesAutorises,ADMIN_LOGIN_MODULES):"Aucun module explicitement attribué"):"Configuration historique du compte")}</dd><dt>Actions individuelles</dt><dd>${labels(u.actionsAutorisees||[],ADMIN_LEVEL_ACTIONS)}</dd><dt>Statut</dt><dd>${u.actif===false?"Bloqué":"Actif"}</dd></dl><footer><button type="button" class="btn btn-secondary" onclick="closeModal()">Fermer</button><button type="button" class="btn btn-primary" data-no-critical-auth="1" onclick="closeModal();openAdminUserModalByKey('${encodeURIComponent(u.username).replace(/'/g,"%27")}')">Modifier</button></footer></div>`);
}

async function adminToggleUserActiveByKey(encodedUsername,active){
  const username=decodeURIComponent(String(encodedUsername||""));
  const target=adminUserByUsername(username);if(!target)return toast("Utilisateur introuvable","error");
  if(String(username).toLowerCase()===String(session?.username||"").toLowerCase())return toast("Vous ne pouvez pas suspendre votre propre compte.","error");
  const action=active?"réactiver":"suspendre";
  if(!confirm(`Voulez-vous ${action} le compte ${username} ?`))return;
  try{await SGDI.auth.updateUser(username,{is_active:!!active});target.actif=!!active;logActivity(active?"Réactivation utilisateur":"Suspension utilisateur",username);saveDB();toast(active?"Compte réactivé":"Compte suspendu","success");renderView()}catch(e){toast("Modification du compte refusée : "+(e.message||e),"error")}
}

function adminDeleteUserByKey(encodedUsername){
  adminDeleteUser(decodeURIComponent(String(encodedUsername||"")));
}

async function adminDeleteUser(username){
  username=String(username||"").trim();
  const target=adminUserByUsername(username);
  if(target)username=target.username;
  if(!confirm("Supprimer l'utilisateur "+username+" ?"))return;
  let pgDeleted=true;
  try{await SGDI.auth.deleteUser(username)}catch(e){
    const msg=String(e.message||e||"");
    if(/not found|introuvable|404/i.test(msg)){
      pgDeleted=false;
    }else{
      toast("Suppression refusée : "+msg,"error");return;
    }
  }
  db.users=db.users.filter(x=>String(x.username||"").toLowerCase()!==username.toLowerCase());
  if(Array.isArray(db.supervisorScopes))db.supervisorScopes=db.supervisorScopes.filter(x=>String(x.username||"").toLowerCase()!==username.toLowerCase());
  try{const cache=userPermissionCache();delete cache[username];Object.keys(cache).forEach(k=>{if(k.toLowerCase()===username.toLowerCase())delete cache[k]})}catch(e){}
  logActivity("Suppression utilisateur",username);
  try{await sgdiLoadAuthState()}catch(e){}
  const stillThere=(db.users||[]).some(x=>String(x.username||"").toLowerCase()===username.toLowerCase());
  if(stillThere){toast("Suppression échouée : l'utilisateur est toujours présent en base de données","error");render();return;}
  saveDB();
  toast(pgDeleted?"Utilisateur supprimé":"Utilisateur supprimé localement, déjà absent de PostgreSQL","success");
  render();
}

SGDIModules.registerModule({key:"administration-users",routes:[]});
