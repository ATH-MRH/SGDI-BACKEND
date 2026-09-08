/* Administration users — déplacement sans modification de droits. */
function adminRoleColor(role){const b=normalizeAdminUserRole(role);if(b==="agent")return"#0f766e";if(b==="ops")return"#043970";if(b==="dispatch")return"#7c3aed";if(b==="ADM")return"#dc2626";return"#64748b"}

function renderAdmin(view,sub,arg){
  adminViewEpoch++;
  positionsStopInteractions();
  if(!isAdminGeneralSession()){view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700 mb-2">🔐 Accès refusé</h2><p class="text-slate-600">Cette section est réservée au compte Administration système.</p></div>`;return}
  const systemOnly=["menu","counters","recrutement","rotations","effectifs","access","access_sgdi","access_societes","access_structures","access_code","sync","users","supervisors","droits","commercial-dc","document-models","sections_candidat","niveaux","postes","magasins","catalogue","articles","priorites","fiches","pointages","contrats","candidats","portail-clients"];
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

function ensureAdminUsersFresh(){
  // db.users n'est resynchronisé qu'au login ou après une action d'écriture sur cet écran :
  // sans ce rafraîchissement actif, un admin peut voir un compte comme "actif" alors qu'il
  // vient d'être désactivé par un collègue depuis un autre poste, jusqu'à ce qu'il fasse
  // lui-même une action d'écriture ou recharge la page — dangereux pour une décision de sécurité.
  if(!sgdiBackendShouldUse()||!sgdiAuthToken())return;
  const key=String(location.hash||"#/admin/users");
  if(window.__sgdiAdminUsersFreshKey===key&&Date.now()-(window.__sgdiAdminUsersFreshAt||0)<10000)return;
  window.__sgdiAdminUsersFreshKey=key;
  window.__sgdiAdminUsersFreshAt=Date.now();
  const current=adminCaptureView(document.getElementById("view"),ensureAdminUsersFresh);
  sgdiLoadAuthState().then(()=>{
    if(current()&&typeof renderView==="function")renderView();
  }).catch(e=>console.warn("Rechargement utilisateurs impossible",e));
}

function renderAdminUsers(view){
  ensureNiveauxAcces();
  ensureAdminUsersFresh();
  const adminSoc=adminActiveSociete();
  const u=(db.users||[]).filter(adminMatchesSociete);
  const active=u.filter(x=>x.actif!==false).length;
  const blocked=u.length-active;
  const admins=u.filter(x=>normalizeAdminUserRole(x.role)==="ADM").length;
  const alerts=u.filter(x=>!x.email||(!x.niveau&&normalizeAdminUserRole(x.role)!=="ADM")).length;
  const scopeLabel=(items,formatter)=>items&&items.length?items.slice(0,2).map(formatter||String).join(", ")+(items.length>2?` +${items.length-2}`:""):"Accès global";
  view.innerHTML=`<div class="admin-users-page">
    <header class="admin-users-head"><div><div class="admin-users-eyebrow">Administration système · Identités et accès</div><h1>Gestion des utilisateurs</h1><p>Gérez les comptes, profils, périmètres et blocages depuis un seul centre de contrôle.</p></div><div class="admin-users-head-actions"><button class="btn btn-secondary" onclick="navigate('admin/niveaux')">Profils d'accès</button><button class="btn btn-secondary" onclick="navigate('admin/droits')">Matrice des droits</button><button class="btn btn-primary" onclick="openAdminUserModal('')">+ Nouvel utilisateur</button></div></header>
    ${adminSocieteSelectorHTML(adminSoc?"Utilisateurs autorisés sur la société active ou disposant d'un accès global.":"Vue consolidée de tous les comptes et périmètres.")}
    <section class="admin-users-kpis">
      <button onclick="adminSetUserStatusFilter('all')"><span>Comptes</span><strong>${u.length}</strong><small>Périmètre affiché</small></button>
      <button onclick="adminSetUserStatusFilter('active')"><span>Actifs</span><strong class="ok">${active}</strong><small>Connexion autorisée</small></button>
      <button onclick="adminSetUserStatusFilter('blocked')"><span>Bloqués</span><strong class="danger">${blocked}</strong><small>Connexion refusée</small></button>
      <button onclick="adminSetUserStatusFilter('admin')"><span>Administrateurs</span><strong class="admin">${admins}</strong><small>Droits élevés</small></button>
      <button onclick="adminSetUserStatusFilter('alert')"><span>À contrôler</span><strong class="warn">${alerts}</strong><small>Configuration incomplète</small></button>
    </section>
    <section class="card admin-users-toolbar"><div class="admin-users-search"><span>⌕</span><input id="admin-user-search" data-no-lock class="input" placeholder="Rechercher par nom, identifiant, email, profil ou structure…" oninput="adminFilterUsers()"/></div><select id="admin-user-role-filter" data-no-lock class="select" onchange="adminFilterUsers()"><option value="">Tous les types</option>${ADMIN_USER_ROLES.map(r=>`<option value="${r}">${escapeHTML(adminRoleDisplayLabel(r))}</option>`).join("")}</select><select id="admin-user-status-filter" data-no-lock class="select" onchange="adminFilterUsers()"><option value="all">Tous les statuts</option><option value="active">Actifs</option><option value="blocked">Bloqués</option><option value="admin">Administrateurs</option><option value="alert">À contrôler</option></select><span id="admin-user-visible-count">${u.length} utilisateur(s)</span></section>
    <section class="card admin-users-table-wrap"><table class="admin-users-table"><thead><tr><th>Utilisateur</th><th>Profil</th><th>Périmètre société</th><th>Structures / sites</th><th>Droits effectifs</th><th>État</th><th></th></tr></thead><tbody>${u.map(x=>{const role=normalizeAdminUserRole(x.role),roleColor=adminRoleColor(x.role),niv=(db.niveauxAcces||[]).find(n=>n.code===x.niveau),isAlert=!x.email||(!x.niveau&&role!=="ADM"),search=normalizedSearchText([x.username,x.nom,x.email,x.role,niv?.label,...(x.societesAutorisees||[]),...(x.structuresAutorisees||[])].join(" "));return`<tr data-admin-user-row data-search="${escapeHTML(search)}" data-role="${escapeHTML(role)}" data-active="${x.actif===false?"0":"1"}" data-alert="${isAlert?"1":"0"}"><td><div class="admin-user-identity"><i style="background:${roleColor}">${escapeHTML((x.nom||x.username||"U").trim().charAt(0).toUpperCase())}</i><div><b>${escapeHTML(x.nom||x.username)}</b><span>${escapeHTML(x.username)} · ${escapeHTML(x.email||"Email non renseigné")}</span></div></div></td><td><span class="admin-user-role" style="--role:${roleColor}">${escapeHTML(adminRoleDisplayLabel(role))}</span><small>${escapeHTML(niv?.label||x.niveau||"Profil non défini")}</small></td><td><b>${escapeHTML(scopeLabel(x.societesAutorisees))}</b><small>${x.societesAutorisees?.length?`${x.societesAutorisees.length} société(s) sélectionnée(s)`:"Toutes les sociétés"}</small></td><td><b>${escapeHTML(scopeLabel(x.structuresAutorisees,adminStructureLabel))}</b><small>${x.sitesAutorises?.length?`${x.sitesAutorises.length} site(s) autorisé(s)`:"Tous les sites du périmètre"}</small></td><td><div class="admin-user-rights">${(x.actionsAutorisees?.length?x.actionsAutorisees:["Profil"]).slice(0,4).map(key=>`<span>${escapeHTML(ADMIN_LEVEL_ACTIONS.find(a=>a.key===key)?.label||key)}</span>`).join("")}${x.actionsAutorisees?.length>4?`<span>+${x.actionsAutorisees.length-4}</span>`:""}</div></td><td>${x.actif===false?'<span class="admin-user-state blocked">Bloqué</span>':'<span class="admin-user-state active">Actif</span>'}${isAlert?'<small class="admin-user-alert">À contrôler</small>':""}</td><td><div class="admin-user-actions"><button data-no-critical-auth="1" onclick="openAdminUserModalByKey('${encodeURIComponent(x.username)}')">Configurer</button>${String(x.username).toLowerCase()!==String(session?.username||"").toLowerCase()?`<button class="${x.actif===false?"allow":"deny"}" onclick="adminToggleUserActiveByKey('${encodeURIComponent(x.username)}',${x.actif===false?"true":"false"})">${x.actif===false?"Réactiver":"Suspendre"}</button>`:""}</div></td></tr>`}).join("")||`<tr><td colspan="7" class="admin-users-empty">Aucun utilisateur dans ce périmètre.</td></tr>`}</tbody></table></section>
    <footer class="admin-users-foot"><span><b>Règle de sécurité :</b> suspendez un compte plutôt que de le supprimer afin de préserver sa traçabilité.</span><button class="btn btn-ghost" onclick="navigate('admin/log')">Consulter le journal d'activité →</button></footer>
  </div>`;
  document.querySelectorAll(".admin-user-actions").forEach(actions=>{
    const configure=actions.querySelector('button[onclick^="openAdminUserModalByKey"]');
    const encoded=configure?.getAttribute("onclick")?.match(/openAdminUserModalByKey\('([^']+)'\)/)?.[1];
    if(!encoded)return;
    const target=adminUserByUsername(decodeURIComponent(encoded));
    if(target?.backendId){const permissions=document.createElement("button");permissions.textContent="Permissions";permissions.onclick=()=>openGranularPermissionsByKey(encoded);actions.appendChild(permissions)}
    if(decodeURIComponent(encoded).toLowerCase()===String(session?.username||"").toLowerCase())return;
    const remove=document.createElement("button");remove.className="deny";remove.textContent="Supprimer";
    remove.onclick=()=>adminDeleteUserByKey(encoded);actions.appendChild(remove);
  });
}

function adminSetUserStatusFilter(value){const el=document.getElementById("admin-user-status-filter");if(el){el.value=value;adminFilterUsers()}}

function adminFilterUsers(){
  const q=normalizedSearchText(document.getElementById("admin-user-search")?.value||"");
  const role=document.getElementById("admin-user-role-filter")?.value||"";
  const status=document.getElementById("admin-user-status-filter")?.value||"all";
  let shown=0;
  document.querySelectorAll("[data-admin-user-row]").forEach(row=>{const okSearch=!q||String(row.dataset.search||"").includes(q),okRole=!role||row.dataset.role===role,okStatus=status==="all"||(status==="active"&&row.dataset.active==="1")||(status==="blocked"&&row.dataset.active==="0")||(status==="admin"&&row.dataset.role==="ADM")||(status==="alert"&&row.dataset.alert==="1");const show=okSearch&&okRole&&okStatus;row.hidden=!show;if(show)shown++});
  const count=document.getElementById("admin-user-visible-count");if(count)count.textContent=shown+" utilisateur(s)";
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
