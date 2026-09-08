/* Administration pointage-settings : fonctions historiques, règles inchangées. */
function cleanupActionTrimFpq(months){
  if(!confirm("Supprimer les feuilles de présence plus anciennes que "+months+" mois ?"))return;
  const cutoff=new Date();cutoff.setMonth(cutoff.getMonth()-months);
  const cutoffStr=cutoff.toISOString().slice(0,10);
  const before=(db.feuillePresence||[]).length;
  db.feuillePresence=(db.feuillePresence||[]).filter(f=>(f.date||"")>=cutoffStr);
  const removed=before-db.feuillePresence.length;
  // Also clean cloture for those dates
  if(db.feuillePresenceCloture)Object.keys(db.feuillePresenceCloture).forEach(d=>{if(d<cutoffStr)delete db.feuillePresenceCloture[d]});
  if(saveDB())toast("✓ "+removed+" ligne(s) supprimée(s)","success");
  renderView();
}

function adminRotationCycleRows(count,days){
  const n=Math.max(7,Math.min(366,parseInt(count)||7));
  const source=Array.isArray(days)?days:[];
  return Array.from({length:n},(_,i)=>{const d=source[i]||{};return `<tr><td class="font-black">J${i+1}</td><td><select class="select rotation-day-status"><option value="travail" ${d.status==="travail"?"selected":""}>Travail</option><option value="repos" ${d.status==="repos"||!d.status?"selected":""}>Repos</option></select></td><td><input class="input rotation-day-start" type="time" value="${escapeHTML(d.start_time||"08:00")}"/></td><td><input class="input rotation-day-end" type="time" value="${escapeHTML(d.end_time||"16:00")}"/></td><td><input class="input rotation-day-label" value="${escapeHTML(d.label||"")}" placeholder="Jour, nuit…"/></td></tr>`}).join("");
}

function rebuildAdminRotationDays(){const body=document.getElementById("rotation-cycle-days");if(body)body.innerHTML=adminRotationCycleRows(document.getElementById("rotation-cycle-length")?.value)}

function parseRotationOffsets(value){const out={};String(value||"A:0").split(",").forEach(part=>{const [g,n]=part.split(":");if(g?.trim())out[g.trim().toUpperCase()]=parseInt(n)||0});return out}

async function saveAdminRotation(){
  const rows=[...document.querySelectorAll("#rotation-cycle-days tr")];
  const payload={code:document.getElementById("rotation-code").value.trim().toUpperCase(),name:document.getElementById("rotation-name").value.trim().toUpperCase(),description:document.getElementById("rotation-description").value.trim(),cycle_length:rows.length,group_offsets:parseRotationOffsets(document.getElementById("rotation-groups").value),cycle_days:rows.map(row=>({status:row.querySelector(".rotation-day-status").value,start_time:row.querySelector(".rotation-day-start").value,end_time:row.querySelector(".rotation-day-end").value,label:row.querySelector(".rotation-day-label").value.trim()})),active:1};
  if(!payload.code||!payload.name){toast("Code et nom obligatoires","error");return}
  try{await sgdiApi("/ops/rotations",{method:"POST",body:payload,legacy:false});toast("Rotation créée","success");renderView()}catch(e){toast(e.message||String(e),"error")}
}

async function linkAdminRotation(){
  const payload={site_id:parseInt(document.getElementById("rotation-link-site").value),rotation_id:parseInt(document.getElementById("rotation-link-template").value),start_date:document.getElementById("rotation-link-start").value,end_date:document.getElementById("rotation-link-end").value||null,active:1};
  if(!payload.site_id||!payload.rotation_id||!payload.start_date){toast("Site, rotation et date de début obligatoires","error");return}
  try{await sgdiApi("/ops/site-rotations",{method:"POST",body:payload,legacy:false});toast("Rotation associée au site","success");renderView()}catch(e){toast(e.message||String(e),"error")}
}

async function assignEmployeeRotation(){
  const link=adminRotationData.links.find(x=>String(x.id)===document.getElementById("rotation-employee-link").value);
  const payload={employee_id:parseInt(document.getElementById("rotation-employee").value),site_id:link?.site_id,rotation_id:link?.rotation_id,group_code:(document.getElementById("rotation-employee-group").value||"A").toUpperCase(),start_date:document.getElementById("rotation-employee-start").value,position:null,change_reason:"Affectation depuis Administration système > Rotations",active:1};
  if(!payload.employee_id||!link||!payload.start_date){toast("Employé, rotation/site et date obligatoires","error");return}
  try{await sgdiApi("/ops/assignments",{method:"POST",body:payload,legacy:false});toast("Employé affecté à la rotation","success")}catch(e){toast(e.message||String(e),"error")}
}

async function removeAdminSiteRotation(id){if(!confirm("Retirer cette rotation du site ? Les présences historiques seront conservées."))return;try{await sgdiApi("/ops/site-rotations/"+id,{method:"DELETE",legacy:false});toast("Association retirée","success");renderView()}catch(e){toast(e.message||String(e),"error")}}

async function renderAdminRotations(view){
  view.innerHTML=`<div class="card p-8 text-center">Chargement des rotations…</div>`;
  try{const [rotations,links]=await Promise.all([sgdiApi("/ops/rotations",{legacy:false}),sgdiApi("/ops/site-rotations",{legacy:false})]);adminRotationData={rotations,links}}catch(e){view.innerHTML=`<div class="card p-6 text-red-700">${escapeHTML(e.message||String(e))}</div>`;return}
  const rotations=adminRotationData.rotations,links=adminRotationData.links;
  const sites=(db.sites||[]).filter(s=>s.actif!==false&&s.active!==0&&adminDataMatchesSociete(s));
  const agents=(db.agents||[]).filter(adminMatchesSociete);
  const siteId=s=>parseInt(s.backendId||s.id),agentId=a=>parseInt(a.backendId||a.employee_id||a.id);
  const siteName=id=>sites.find(s=>siteId(s)===Number(id))?.nom||sites.find(s=>siteId(s)===Number(id))?.name||`Site ${id}`;
  const rotName=id=>rotations.find(r=>r.id===Number(id))?.name||`Rotation ${id}`;
  view.innerHTML=`<div class="mb-5"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Rotations</h1><p class="text-sm text-slate-500 mt-1">Plusieurs rotations peuvent fonctionner simultanément sur un même site. Le contrôle des conflits s'effectue au niveau de l'employé.</p></div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5"><div class="card p-4"><div class="text-xs font-black text-slate-500 uppercase">Modèles</div><div class="text-3xl font-black text-violet-700">${rotations.length}</div></div><div class="card p-4"><div class="text-xs font-black text-slate-500 uppercase">Associations site</div><div class="text-3xl font-black text-blue-700">${links.length}</div></div><div class="card p-4"><div class="text-xs font-black text-slate-500 uppercase">Horizon</div><div class="text-3xl font-black text-emerald-700">∞</div><div class="text-xs text-slate-500">Calcul à la demande</div></div></div>
  <div class="card p-5 mb-5"><h2 class="font-black text-xl mb-4">1. Créer un système de rotation</h2><div class="grid grid-cols-1 md:grid-cols-4 gap-3"><div><label class="label">Code</label><input id="rotation-code" class="input" placeholder="ROT-24-48"/></div><div><label class="label">Nom</label><input id="rotation-name" class="input" placeholder="Rotation 24/48"/></div><div><label class="label">Durée du cycle (jours)</label><input id="rotation-cycle-length" class="input" type="number" min="7" max="366" value="7" onchange="rebuildAdminRotationDays()"/></div><div><label class="label">Décalage des groupes</label><input id="rotation-groups" class="input" value="A:0,B:1,C:2"/></div></div><div class="mt-3"><label class="label">Description</label><input id="rotation-description" class="input" placeholder="Organisation et règles particulières"/></div><div class="overflow-auto mt-4" style="max-height:390px"><table><thead><tr><th>Jour</th><th>État</th><th>Début prévu</th><th>Fin prévue</th><th>Libellé</th></tr></thead><tbody id="rotation-cycle-days">${adminRotationCycleRows(7)}</tbody></table></div><div class="flex justify-end mt-4"><button class="btn btn-success" onclick="saveAdminRotation()">Créer la rotation</button></div></div>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5"><div class="card p-5"><h2 class="font-black text-xl mb-4">2. Associer au site</h2><label class="label">Site</label><select id="rotation-link-site" class="select mb-3"><option value="">Choisir…</option>${sites.map(s=>`<option value="${siteId(s)}">${escapeHTML(s.nom||s.name||"")}</option>`).join("")}</select><label class="label">Rotation</label><select id="rotation-link-template" class="select mb-3"><option value="">Choisir…</option>${rotations.filter(r=>r.active).map(r=>`<option value="${r.id}">${escapeHTML(r.code)} · ${escapeHTML(r.name)}</option>`).join("")}</select><div class="grid grid-cols-2 gap-3"><div><label class="label">Date d'effet</label><input id="rotation-link-start" class="input" type="date" value="${today()}"/></div><div><label class="label">Fin éventuelle</label><input id="rotation-link-end" class="input" type="date"/></div></div><button class="btn btn-primary w-full mt-4" onclick="linkAdminRotation()">Associer au site</button></div>
  <div class="card p-5"><h2 class="font-black text-xl mb-4">3. Affecter un employé</h2><label class="label">Employé</label><select id="rotation-employee" class="select mb-3"><option value="">Choisir…</option>${agents.map(a=>`<option value="${agentId(a)}">${escapeHTML(a.matricule||a.code||"")} · ${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())}</option>`).join("")}</select><label class="label">Site et rotation</label><select id="rotation-employee-link" class="select mb-3"><option value="">Choisir…</option>${links.filter(l=>l.active).map(l=>`<option value="${l.id}">${escapeHTML(siteName(l.site_id))} · ${escapeHTML(rotName(l.rotation_id))}</option>`).join("")}</select><div class="grid grid-cols-2 gap-3"><div><label class="label">Groupe</label><input id="rotation-employee-group" class="input" value="A"/></div><div><label class="label">Date d'effet</label><input id="rotation-employee-start" class="input" type="date" value="${today()}"/></div></div><button class="btn btn-success w-full mt-4" onclick="assignEmployeeRotation()">Affecter l'employé</button></div></div>
  <div class="card overflow-hidden"><div class="p-4 font-black">Rotations actives par site</div>${links.length?`<table><thead><tr><th>Site</th><th>Rotation</th><th>Du</th><th>Au</th><th></th></tr></thead><tbody>${links.map(l=>`<tr><td class="font-black">${escapeHTML(siteName(l.site_id))}</td><td>${escapeHTML(rotName(l.rotation_id))}</td><td>${formatDate(l.start_date)}</td><td>${l.end_date?formatDate(l.end_date):"Sans limite"}</td><td class="text-right"><button class="btn btn-danger text-xs" onclick="removeAdminSiteRotation(${l.id})">Retirer</button></td></tr>`).join("")}</tbody></table>`:`<div class="p-8 text-center text-slate-500">Aucune rotation associée.</div>`}</div>`;
}

function adminSupervisorBuildScope(user){
  const scope=adminSupervisorSiteScopeFromUser(user);
  const agents=(db.agents||[]).filter(a=>{
    if(!employeeIsPointageEligible(a,""))return false;
    const aff=agentLiveAffectation(a)||a.affectationCourante||{};
    const site=(db.sites||[]).find(s=>siteMatchesReference(s,aff));
    return [aff.siteId,aff.siteBackendId,aff.site_id,site?.id,site?.backendId].some(v=>scope.ids.has(String(v||"")))||[aff.siteName,aff.site,site?.nom,site?.intitule].some(v=>scope.names.has(normalizedSearchText(v||"")));
  }).map(a=>{
    const aff=agentLiveAffectation(a)||a.affectationCourante||{};
    const site=(db.sites||[]).find(s=>siteMatchesReference(s,aff))||{};
    return {
      id:a.id||"",
      backendId:a.backendId||"",
      matricule:a.matricule||a.code||"",
      code:a.code||a.matricule||"",
      nom:a.nom||"",
      prenom:a.prenom||"",
      societe:a.societe||sitePrimarySociete(site)||"",
      statut:a.statut||"actif",
      fonction:a.fonction||a.position||aff.poste||"",
      siteId:aff.siteId||site.id||"",
      siteBackendId:aff.siteBackendId||aff.site_id||site.backendId||"",
      siteName:aff.siteName||site.nom||site.intitule||"",
      clientName:aff.clientName||site.client||"",
      poste:aff.poste||a.fonction||a.position||"",
      groupe:aff.groupe||"",
      dateDebut:aff.dateDebut||""
    };
  }).sort((x,y)=>(x.siteName||"").localeCompare(y.siteName||"")||(x.nom||"").localeCompare(y.nom||""));
  return {
    id:"supscope_"+String(user.username||"").toLowerCase(),
    username:user.username||"",
    nom:user.nom||user.full_name||user.username||"",
    role:user.role||"",
    niveau:user.niveau||user.access_level||"",
    societesAutorisees:Array.isArray(user.societesAutorisees)?user.societesAutorisees:(user.authorized_societies||[]),
    siteIds:[...scope.ids],
    sites:scope.sites.map(s=>({id:s.id||"",backendId:s.backendId||"",nom:s.nom||s.intitule||"",societe:sitePrimarySociete(s)||"",client:s.client||""})),
    agents,
    updatedAt:new Date().toISOString(),
    updatedBy:session?.username||""
  };
}

async function adminRebuildSupervisorScope(username,options){
  const opt=options||{};
  username=decodeURIComponent(String(username||""));
  if(!(await ensureAdminSystemApiToken("actualiser le périmètre superviseur")))return;
  if(opt.reload){
    try{sgdiShowDataLoadingBar("Chargement des données superviseur...");await sgdiPullEmployees({silent:true});await syncSitesFromPostgres();if(typeof syncAssignmentsFromPostgres==="function")await syncAssignmentsFromPostgres()}catch(e){toast("Chargement incomplet : "+(e.message||e),"warning")}
    finally{if(typeof sgdiHideDataLoadingBar==="function")sgdiHideDataLoadingBar()}
  }
  const users=username?[adminUserByUsername(username)].filter(Boolean):adminSupervisorUsers();
  if(!users.length){toast("Aucun superviseur à actualiser","info");return}
  if(!Array.isArray(db.supervisorScopes))db.supervisorScopes=[];
  users.forEach(user=>{
    const item=adminSupervisorBuildScope(user);
    const idx=db.supervisorScopes.findIndex(x=>String(x.username||"").toLowerCase()===String(item.username||"").toLowerCase());
    if(idx>=0)db.supervisorScopes[idx]=item;else db.supervisorScopes.push(item);
  });
  if(!(await saveDBAndWaitToast("Périmètre superviseur non enregistré")))return;
  toast(users.length+" périmètre(s) superviseur actualisé(s)","success");
  renderView();
}

async function adminToggleSupervisorReadOnly(encodedUsername){
  if(!(await ensureAdminSystemApiToken("modifier le mode lecture seule")))return;
  const username=decodeURIComponent(String(encodedUsername||""));
  const u=adminUserByUsername(username);
  if(!u){toast("Utilisateur introuvable","error");return}
  const nextReadOnly=!(u.supervisorReadOnly!==false);
  try{
    await SGDI.auth.updateUser(username,{supervisor_read_only:nextReadOnly});
  }catch(e){toast("Modification refusée : "+(e.message||e),"error");return}
  u.supervisorReadOnly=nextReadOnly;
  toast(nextReadOnly?"Lecture seule réactivée pour "+username:"Lecture seule désactivée pour "+username,"success");
  renderView();
}

async function renderAdminSupervisors(view){
  if(!isAdminSystemSession()){view.innerHTML=`<div class="card p-6">Accès réservé Administration système</div>`;return}
  const users=adminSupervisorUsers();
  const rows=users.map(u=>{
    const scope=(db.supervisorScopes||[]).find(x=>String(x.username||"").toLowerCase()===String(u.username||"").toLowerCase());
    const siteCount=Array.isArray(scope?.sites)?scope.sites.length:(Array.isArray(u.sitesAutorises)?u.sitesAutorises.length:0);
    const agentCount=Array.isArray(scope?.agents)?scope.agents.length:0;
    const updated=scope?.updatedAt?new Date(scope.updatedAt).toLocaleString("fr-FR"):"Jamais";
    const readOnly=u.supervisorReadOnly!==false;
    return `<tr class="border-t">
      <td class="p-3"><div class="font-black">${escapeHTML(u.username||"")}</div><div class="text-xs text-slate-500">${escapeHTML(u.nom||"")}</div></td>
      <td class="p-3"><span class="pill pill-blue">${siteCount} site${siteCount>1?"s":""}</span></td>
      <td class="p-3"><span class="pill pill-green">${agentCount} employé${agentCount>1?"s":""}</span></td>
      <td class="p-3">${readOnly?`<span class="pill" style="background:#fef3c7;color:#92400e">🔒 Lecture seule</span>`:`<span class="pill" style="background:#dcfce7;color:#166534">✏️ Édition autorisée</span>`}</td>
      <td class="p-3 text-xs text-slate-500">${escapeHTML(updated)}</td>
      <td class="p-3 text-right"><div class="flex gap-2 justify-end flex-wrap"><button class="btn ${readOnly?"btn-primary":"btn-secondary"} text-xs" onclick="adminToggleSupervisorReadOnly('${encodeURIComponent(u.username||"")}')">${readOnly?"Désactiver la lecture seule":"Réactiver la lecture seule"}</button><button class="btn btn-secondary text-xs" onclick="adminRebuildSupervisorScope('${encodeURIComponent(u.username||"")}',{reload:true})">Actualiser table</button><button class="btn btn-ghost text-xs" onclick="openAdminUserModalByKey('${encodeURIComponent(u.username||"")}')">Sites autorisés</button></div></td>
    </tr>`;
  }).join("");
  view.innerHTML=`<div class="mb-5 flex items-start justify-between gap-3 flex-wrap"><div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Périmètres superviseurs</h1><p class="text-sm text-slate-500 mt-1">Table dédiée de lecture : sites et employés rattachés à chaque superviseur terrain.</p></div><button class="btn btn-primary" onclick="adminRebuildSupervisorScope('',{reload:true})">Actualiser tous les superviseurs</button></div>
  <div class="card p-4 mb-4" style="border-left:4px solid #0f766e"><div class="font-black">Principe</div><div class="text-sm text-slate-500 mt-1">Les données officielles restent les employés, sites et affectations PostgreSQL. Cette table prépare un périmètre léger pour accélérer et sécuriser l'ouverture de session superviseur.</div></div>
  <div class="card overflow-hidden"><table class="w-full text-sm"><thead><tr style="background:#e5e7eb"><th class="p-3 text-left">Superviseur</th><th class="p-3 text-left">Sites</th><th class="p-3 text-left">Employés rattachés</th><th class="p-3 text-left">Accès</th><th class="p-3 text-left">Dernière mise à jour</th><th class="p-3 text-right">Actions</th></tr></thead><tbody>${rows||`<tr><td colspan="6" class="p-6 text-center text-slate-500">Aucun compte superviseur. Créez un utilisateur SUP avec la structure Superviseur.</td></tr>`}</tbody></table></div>`;
}

function adminPointageMonth(){return sessionStorage.getItem("adminPointageMonth")||ptCurrentMonth()}

function adminPointageSociete(){return sessionStorage.getItem("adminPointageSociete")||adminActiveSociete()||""}

function adminPointageSearch(){return sessionStorage.getItem("adminPointageSearch")||""}

function adminPointageSet(key,value){
  if(value)sessionStorage.setItem("adminPointage"+key,value);else sessionStorage.removeItem("adminPointage"+key);
  if(key==="Societe"||key==="Search")sessionStorage.removeItem("adminPointageAgent");
  renderView();
}

function adminPointageAgents(soc){
  const q=adminPointageSearch().toLowerCase().trim();
  return pointageEligibleAgents(soc).filter(adminMatchesSociete).filter(a=>{
    if(!q)return true;
    const aff=agentLiveAffectation(a)||a.affectationCourante||{};
    const hay=[a.nom,a.prenom,a.matricule,a.code,aff.siteName,aff.site].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function adminPointageStatusLabel(sheet,day){
  if(sheet?.valide)return `<span class="pill pill-green">Mois validé</span>`;
  if(ptSupDayValidated(sheet,day))return `<span class="pill pill-blue">Jour validé</span>`;
  return `<span class="pill">Modifiable</span>`;
}

function renderAdminPointages(view){
  if(!isAdminSystemSession()){view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700 mb-2">Accès réservé</h2><p>Cette page est réservée au compte Administration système.</p></div>`;return}
  const ym=adminPointageMonth();
  const soc=adminPointageSociete();
  const agents=adminPointageAgents(soc);
  const selectedId=sessionStorage.getItem("adminPointageAgent")||agents[0]?.id||"";
  const agent=agents.find(a=>String(a.id)===String(selectedId))||agents[0]||null;
  if(agent&&String(agent.id)!==String(selectedId))sessionStorage.setItem("adminPointageAgent",agent.id);
  const sheet=agent?ptGetSheet(agent.id,ym):null;
  const days=ptDaysInMonth(ym);
  const codeOptions=Object.entries(POINTAGE_CODES).map(([k,v])=>`<span class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold" style="background:${v.bg};color:${v.color}"><span class="font-mono font-black">${escapeHTML(k)}</span>${escapeHTML(v.label)}</span>`).join(" ");
  const socOptions=`<option value="" ${!soc?"selected":""}>Toutes les sociétés</option>${SOCIETES.map(s=>`<option value="${escapeHTML(s)}" ${soc===s?"selected":""}>${escapeHTML(s)}</option>`).join("")}`;
  const agentOptions=agents.map(a=>`<option value="${escapeHTML(a.id)}" ${agent&&a.id===agent.id?"selected":""}>${escapeHTML((a.nom||"")+" "+(a.prenom||""))} ${a.matricule?`(${escapeHTML(a.matricule)})`:""}</option>`).join("");
  const rows=agent?Array.from({length:days},(_,i)=>{
    const d=String(i+1).padStart(2,"0");
    const date=new Date(Number(ym.slice(0,4)),Number(ym.slice(5,7))-1,i+1);
    const wd=["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"][date.getDay()];
    const code=(sheet?.days||{})[d]||"";
    const c=POINTAGE_CODES[code]||{};
    return `<tr class="border-t">
      <td class="p-3 font-mono font-black">${d}</td>
      <td class="p-3 text-sm text-slate-600">${wd}</td>
      <td class="p-3"><button type="button" onclick="adminPointageOpenDay('${agent.id}','${ym}','${d}')" class="w-full text-left px-3 py-2 rounded-lg font-black" style="border:1px solid ${c.color?c.color+"55":"#dbe3ee"};background:${c.bg||"#f8fafc"};color:${c.color||"#64748b"}">${code?escapeHTML(code):"Aucun code"}</button></td>
      <td class="p-3 text-sm text-slate-600">${code?escapeHTML(c.label||"Code inconnu"):"-"}</td>
      <td class="p-3">${adminPointageStatusLabel(sheet,d)}</td>
      <td class="p-3 text-right"><button type="button" class="btn btn-secondary text-xs" onclick="adminPointageOpenDay('${agent.id}','${ym}','${d}')">Modifier</button></td>
    </tr>`;
  }).join(""):"";
  view.innerHTML=`<div class="mb-5 flex items-start justify-between gap-3 flex-wrap">
    <div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Correction des pointages</h1><p class="text-sm text-slate-500 mt-1">Modifiez un code journalier sans passer par DRH, OPS ou Superviseur. Les corrections sont enregistrées dans PostgreSQL.</p></div>
    <button type="button" class="btn btn-ghost" onclick="navigate('admin/dashboard')">Retour configuration</button>
  </div>
  <section class="card p-4 mb-4">
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
      <div><label class="label">Société</label><select class="select w-full" onchange="adminPointageSet('Societe',this.value)">${socOptions}</select></div>
      <div><label class="label">Période</label><input class="input w-full" type="month" value="${escapeHTML(ym)}" onchange="adminPointageSet('Month',this.value)"/></div>
      <div><label class="label">Rechercher</label><input class="input w-full" value="${escapeHTML(adminPointageSearch())}" placeholder="Nom, code, site..." oninput="adminPointageSet('Search',this.value)"/></div>
      <div><label class="label">Employé</label><select class="select w-full" onchange="adminPointageSet('Agent',this.value)" ${agents.length?"":"disabled"}>${agentOptions||`<option>Aucun employé</option>`}</select></div>
    </div>
  </section>
  ${agent?`<section class="card overflow-hidden">
    <div class="p-4 flex items-start justify-between gap-3 flex-wrap" style="background:#f8fafc;border-bottom:1px solid #dbe3ee">
      <div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Employé sélectionné</div><h2 class="text-xl font-black">${escapeHTML((agent.nom||"")+" "+(agent.prenom||""))} <span class="text-blue-700">${escapeHTML(agent.matricule||agent.code||"")}</span></h2><p class="text-sm text-slate-500">${escapeHTML(agent.societe||"")} · ${escapeHTML(ptSupervisorSiteLabel(agent))}</p></div>
      <div class="flex gap-2 flex-wrap"><button type="button" class="btn btn-secondary text-xs" onclick="adminPointageValidateMonth('${agent.id}','${ym}')">Valider le mois</button><button type="button" class="btn btn-ghost text-xs" onclick="adminPointageUnlockMonth('${agent.id}','${ym}')">Déverrouiller le mois</button></div>
    </div>
    <div class="p-4 text-xs text-slate-500">${codeOptions}</div>
    <div class="overflow-auto"><table class="w-full text-sm"><thead><tr style="background:#e5e7eb"><th class="p-3 text-left">Jour</th><th class="p-3 text-left">Semaine</th><th class="p-3 text-left">Pointage</th><th class="p-3 text-left">Signification</th><th class="p-3 text-left">Statut</th><th class="p-3 text-right">Action</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`:`<div class="card p-6 text-center text-slate-500">Aucun employé trouvé pour ce périmètre.</div>`}`;
}

function adminPointageOpenDay(agentId,ym,day){
  const agent=(db.agents||[]).find(a=>String(a.id)===String(agentId));
  const sheet=ptGetSheet(agentId,ym);
  const current=(sheet?.days||{})[String(day).padStart(2,"0")]||"";
  const buttons=Object.entries(POINTAGE_CODES).map(([code,c])=>{
    const active=code===current;
    return `<button type="button" onclick="adminPointageApplyDay('${agentId}','${ym}','${day}','${code}')" style="height:40px;min-width:56px;border:${active?`2px solid ${c.color}`:"1px solid #dbe3ee"};background:${c.bg};color:${c.color};font-weight:900;border-radius:8px;cursor:pointer">${escapeHTML(code)}</button>`;
  }).join("");
  openModal(`<div style="min-width:360px;max-width:560px">
    <h3 class="font-black text-lg mb-1">Modifier le pointage</h3>
    <p class="text-sm text-slate-500 mb-4">${escapeHTML((agent?.nom||"")+" "+(agent?.prenom||""))} · ${escapeHTML(day)}/${escapeHTML(String(ym).slice(5,7))}/${escapeHTML(String(ym).slice(0,4))}</p>
    <div class="mb-3">${adminPointageStatusLabel(sheet,day)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${buttons}</div>
    <div class="flex justify-between gap-2 mt-4"><button type="button" class="btn btn-ghost text-red-700" onclick="adminPointageApplyDay('${agentId}','${ym}','${day}','')">Effacer le code</button><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button></div>
  </div>`);
}

async function adminPointageApplyDay(agentId,ym,day,code){
  if(!(await ensureAdminSystemApiToken("modifier un pointage")))return;
  const sheet=ptGetSheet(agentId,ym);
  const dayKey=String(day).padStart(2,"0");
  const wasMonth=!!sheet?.valide;
  const wasDay=!!sheet?.validatedDays?.[dayKey];
  try{
    if(wasMonth)await sgdiRunLegacyAction("unlock-pointage",{data:{agentId,periode:ym}});
    if(wasDay)await sgdiRunLegacyAction("unlock-pointage-day",{data:{agentId,periode:ym,day:dayKey}});
    let out=null;
    if((wasDay||wasMonth)&&code)out=await sgdiRunLegacyAction("validate-pointage-day",{data:{agentId,periode:ym,day:dayKey,code}});
    else out=await sgdiRunLegacyAction("save-pointage-cell",{data:{agentId,periode:ym,day:dayKey,code:code||""}});
    if(wasMonth)await sgdiRunLegacyAction("validate-pointage",{data:{agentId,periode:ym}});
    const item=out?.data?.item;
    if(item){
      if(!db.pointages)db.pointages=[];
      const idx=db.pointages.findIndex(p=>String(p.agentId)===String(item.agentId)&&p.periode===item.periode);
      if(idx>=0)db.pointages[idx]=item;else db.pointages.push(item);
    }
    closeModal();
    await sgdiPullState({silent:true,force:true});
    logActivity&&logActivity("Correction pointage administration","Agent "+agentId+" · "+ym+"-"+dayKey+" · "+(code||"effacé"));
    toast("Pointage corrigé dans PostgreSQL","success");
    renderView();
  }catch(e){toast("Correction refusée : "+(e.message||e),"error");await sgdiPullState({silent:true,force:true}).catch(()=>null);renderView()}
}

async function adminPointageValidateMonth(agentId,ym){
  if(!(await ensureAdminSystemApiToken("valider un mois de pointage")))return;
  if(!confirm("Valider le mois de pointage sélectionné ?"))return;
  try{await sgdiRunLegacyAction("validate-pointage",{data:{agentId,periode:ym}});await sgdiPullState({silent:true,force:true});toast("Mois validé","success");renderView()}catch(e){toast("Validation refusée : "+(e.message||e),"error")}
}

async function adminPointageUnlockMonth(agentId,ym){
  if(!(await ensureAdminSystemApiToken("déverrouiller un mois de pointage")))return;
  if(!confirm("Déverrouiller le mois de pointage sélectionné ?"))return;
  try{await sgdiRunLegacyAction("unlock-pointage",{data:{agentId,periode:ym}});await sgdiPullState({silent:true,force:true});toast("Mois déverrouillé","success");renderView()}catch(e){toast("Déverrouillage refusé : "+(e.message||e),"error")}
}

function cleanupActionTrimPointages(months){
  if(!confirm("Supprimer les pointages plus anciens que "+months+" mois ?"))return;
  const cutoff=new Date();cutoff.setMonth(cutoff.getMonth()-months);
  const cutoffStr=cutoff.toISOString().slice(0,10);
  const before=(db.pointages||[]).length;
  db.pointages=(db.pointages||[]).filter(p=>(p.date||"")>=cutoffStr);
  const removed=before-db.pointages.length;
  if(saveDB())toast("✓ "+removed+" pointage(s) supprimé(s)","success");
  renderView();
}
SGDIModules.registerModule({key:"administration-pointage-settings",routes:[]});
