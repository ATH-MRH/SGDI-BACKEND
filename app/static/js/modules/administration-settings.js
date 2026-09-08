/* Administration settings : fonctions historiques, règles inchangées. */
function adminDashboardCard(title,desc,route,color,icon){return`<button class="card p-5 text-left kpi-clickable" onclick="navigate('${route}')" style="border-left:5px solid ${color};min-height:132px"><div class="text-2xl mb-2">${icon||""}</div><div class="font-black text-lg mb-1">${title}</div><div class="text-sm text-slate-500 leading-relaxed">${desc}</div></button>`}

async function renderAdminSystemDashboard(view){
  ensureNiveauxAcces();
  if(session&&sgdiAuthToken()){
    sgdiShowDataLoadingBar("Chargement des compteurs...");
    await sgdiRefreshSidebarStats().catch(()=>null);
  }
  const adminSoc=adminActiveSociete();
  const agents=(db.agents||[]).filter(adminMatchesSociete);
  const sitesCount=(db.sites||[]).filter(s=>s.actif!==false&&s.active!==0&&adminDataMatchesSociete(s)).length;
  const magasins=(db.magasins||[]).filter(adminDataMatchesSociete);
  const articles=(db.stockArticles||[]).filter(adminDataMatchesSociete);
  const users=db.users||[];
  const templates=(db.documentTemplates||[]).filter(t=>t&&t.active!==false);
  const card=(title,desc,route,color,count,tag)=>`<button type="button" class="card p-5 text-left kpi-clickable" onclick="navigate('${route}')" style="border-left:5px solid ${color};min-height:132px"><div class="flex items-start justify-between gap-3"><div><div class="text-xs uppercase font-black text-slate-500">${escapeHTML(tag||"Configuration")}</div><div class="font-black text-lg mt-1">${escapeHTML(title)}</div><div class="text-sm text-slate-500 mt-2">${escapeHTML(desc)}</div></div><div class="text-3xl font-black" style="color:${color}">${count}</div></div></button>`;
  const profileCount=(db.niveauxAcces||[]).length;
  const rightsCount=Object.keys(db.droitsAcces||{}).length;
  view.innerHTML=`<div class="mb-5"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Panneau d'administration</h1><p class="text-sm text-slate-500 mt-1">Une logique simple : utilisateur + profil d'accès + périmètre société/site/structure.</p></div>
	  ${adminSocieteSelectorHTML(adminSoc?"Toutes les listes et suppressions sont filtrées sur cette société.":"Sélectionnez une société pour travailler sur un périmètre précis.")}
	  <div class="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
	    <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Utilisateurs</div><div class="text-3xl font-black text-slate-900">${users.length}</div><div class="text-xs text-slate-500">Comptes et blocage</div></div>
	    <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Profils</div><div class="text-3xl font-black text-violet-700">${profileCount}</div><div class="text-xs text-slate-500">Droits métier</div></div>
	    <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Périmètre</div><div class="text-3xl font-black text-blue-700">${sitesCount}</div><div class="text-xs text-slate-500">Sites actifs</div></div>
	    <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Données</div><div class="text-3xl font-black text-emerald-700">${agents.length}</div><div class="text-xs text-slate-500">Employés</div></div>
	    <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Règles fines</div><div class="text-3xl font-black text-amber-700">${rightsCount}</div><div class="text-xs text-slate-500">Exceptions</div></div>
	  </div>
	  <div class="grid grid-2 gap-4">
	    ${card("Recrutement groupé","Sélectionner librement les candidats et lancer leur création complète, même avec une fiche à compléter.","admin/recrutement","#16a34a",(db.candidats||[]).filter(c=>!candidatIsArchived(c)&&String(c.statut||c.status||"").toLowerCase()!=="embauche").length,"Recrutement")}
	    ${card("Configuration recrutement","Contrôler l'ordre des sections du formulaire candidat et les règles de déverrouillage.","admin/sections_candidat","#059669",CANDIDAT_SECTIONS.length,"Recrutement")}
	    ${card("Rotations","Créer les cycles, les associer aux sites et affecter les employés par groupe.","admin/rotations","#7c3aed","∞","Planification")}
	    ${card("Utilisateurs","Créer, bloquer et rattacher chaque compte à un profil et un périmètre.","admin/users","#043970",users.length,"1. Comptes")}
	    ${card("Profils d'accès","Définir les modules visibles et le référentiel d'actions par profil.","admin/niveaux","#7c3aed",profileCount,"2. Droits")}
	    ${card("Périmètres & sécurité","Sociétés, structures, code journalier et règles de sécurité.","admin/access","#0891b2","", "3. Périmètres")}
	    ${card("Données métier","Effectifs, fiches, postes, sites, matériel et modèles documents.","admin/effectifs","#0f766e",agents.length,"4. Métier")}
	    ${card("Droits techniques","Exceptions rôle × module pour cas avancés. À utiliser rarement.","admin/droits","#64748b",rightsCount,"Avancé")}
	    ${card("Prêts & avances","Configurer l’éligibilité, les plafonds, les rôles et le circuit DG → Secrétariat → Caisse.","admin/loans","#075985","","Finance RH")}
	  </div>
	  <div class="grid grid-3 gap-3 mt-4">
	    ${card("Fiches de position","Maintenance contrôlée des fiches employés.","admin/fiches","#0f766e",agents.length,"Métier")}
	    ${card("Périmètres superviseurs","Préparer les tables de lecture sites/employés pour les superviseurs terrain.","admin/supervisors","#0f766e",(db.supervisorScopes||[]).length,"Contrôle")}
	    ${card("Correction pointage","Corriger une journée ou déverrouiller un mois avec traçabilité PostgreSQL.","admin/pointages","#0369a1",(db.pointages||[]).length,"Contrôle")}
	    ${card("Sites","Édition et archivage des sites.","sites/actifs","#1d4ed8",sitesCount,"Métier")}
	    ${card("Articles / magasins","Catalogue matériel, magasins et stocks.","admin/articles","#ca8a04",articles.length+magasins.length,"Métier")}
	    ${card("Modèles documents","Modèles documentaires et rattachements.","admin/document-models","#334155",templates.length,"Métier")}
	    ${card("Candidats","Contrôle des sections et nettoyage candidat.","admin/candidats","#b91c1c",(db.candidats||[]).length,"Métier")}
	    ${card("Suppression de données","Sélectionner avec des cases à cocher les données importées à supprimer.","admin/storage","#dc2626",(db.factures||[]).filter(f=>f.sourceImport==="excel"||String(f.id||"").startsWith("fc_import_")).length,"Contrôle")}
	  </div>
  <div class="mt-4">${(()=>{const dups=findDuplicateMatricules();return`<button type="button" class="w-full card p-4 text-left flex items-center justify-between gap-3 hover:bg-slate-50 transition" onclick="openDuplicateMatriculesModal()" style="border-left:5px solid ${dups.length?"#dc2626":"#16a34a"}"><div><div class="text-xs font-black uppercase text-slate-500">Intégrité des codes employés</div><div class="text-sm text-slate-600 mt-1">${dups.length?`${dups.length} code(s) en doublon détecté(s) — cliquez pour corriger`:"Aucun doublon détecté · tous les codes sont uniques"}</div></div><div class="text-2xl font-black" style="color:${dups.length?"#dc2626":"#16a34a"}">${dups.length||"✓"}</div></button>`})()}</div>`;
}

function renderAdminSidebarMenu(view){
  const defaults=adminSidebarOrganizerDefaults();
  const selected=sessionStorage.getItem("adminSidebarMenuModule")||"drh";
  const module=defaults[selected]?selected:"drh";
  const saved=sidebarOrderForModule(module);
  const base=mergeSidebarCustomItems(module,defaults[module].map(([label,route])=>({label,route})));
  const ordered=applySidebarOrder(module,base);
  view.innerHTML=`<div class="mb-5"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Organiser menu latéral</h1><p class="text-sm text-slate-500 mt-1">Déplacez les rubriques avec la souris. Ajoutez aussi une rubrique personnalisée sans toucher aux routes existantes.</p></div>
  <div class="card p-4 mb-4"><div class="flex items-center justify-between gap-3 flex-wrap"><div><label class="label">Module</label><select class="select" style="min-width:260px" onchange="sessionStorage.setItem('adminSidebarMenuModule',this.value);renderView()">${Object.keys(defaults).map(k=>`<option value="${escapeHTML(k)}" ${k===module?"selected":""}>${escapeHTML(adminSidebarModuleLabel(k))}</option>`).join("")}</select></div><div class="flex gap-2"><button class="btn btn-secondary" onclick="saveAdminSidebarMenuOrder('${module}')">Enregistrer ordre</button><button class="btn btn-ghost" onclick="resetAdminSidebarMenuOrder('${module}')">Réinitialiser</button></div></div></div>
  <form class="card p-4 mb-4" onsubmit="event.preventDefault();addAdminSidebarRubrique(this,'${module}')"><div class="font-black text-slate-800 mb-3">Ajouter une rubrique</div><div class="grid grid-cols-1 md:grid-cols-3 gap-3"><div><label class="label">Nom de la rubrique *</label><input class="input" name="label" placeholder="Ex : FORMATION" required/></div><div><label class="label">Route</label><input class="input" name="route" placeholder="Automatique si vide"/></div><div class="flex items-end"><button class="btn btn-primary w-full" type="submit">+ Ajouter rubrique</button></div></div><div class="text-xs text-slate-500 mt-2">Si la route est vide, SGDI crée une page personnalisée automatiquement dans le module choisi.</div></form>
  <div class="card p-4"><div id="admin-sidebar-sortable" data-module="${escapeHTML(module)}">${ordered.map((item,idx)=>`<div class="admin-menu-sort-row" draggable="true" data-route="${escapeHTML(item.route)}" ondragstart="adminMenuDragStart(event)" ondragover="adminMenuDragOver(event)" ondrop="adminMenuDrop(event)" style="display:flex;align-items:center;gap:12px;padding:12px;margin-bottom:8px;border:1px solid #dbe3ef;border-radius:10px;background:#fff;cursor:grab"><span class="font-black text-slate-400" style="width:28px">${idx+1}</span><span style="font-size:20px;color:#f59e0b">☰</span><div style="flex:1"><div class="font-black text-slate-800">${escapeHTML(item.label)}${item.custom?` <span class="pill pill-blue">Ajoutée</span>`:""}</div><div class="text-xs text-slate-500 font-mono">${escapeHTML(item.route)}</div></div>${item.custom?`<button type="button" class="btn btn-ghost text-xs text-red-600" onclick="event.stopPropagation();deleteAdminSidebarRubrique('${module}','${escapeHTML(item.route)}')">Supprimer</button>`:""}</div>`).join("")}</div>${saved.length?`<div class="text-xs text-slate-500 mt-3">Ordre personnalisé actif pour ${escapeHTML(adminSidebarModuleLabel(module))}.</div>`:`<div class="text-xs text-slate-500 mt-3">Ordre par défaut actuellement utilisé.</div>`}</div>`;
}

function adminMenuDragStart(event){adminSidebarDragRoute=event.currentTarget.dataset.route||"";event.dataTransfer.effectAllowed="move";event.currentTarget.style.opacity=".55"}

function adminMenuDragOver(event){event.preventDefault();event.dataTransfer.dropEffect="move"}

function adminMenuDrop(event){
  event.preventDefault();
  const target=event.currentTarget;
  document.querySelectorAll('.admin-menu-sort-row').forEach(row=>row.style.opacity="");
  if(!adminSidebarDragRoute||target.dataset.route===adminSidebarDragRoute)return;
  const wrap=document.getElementById('admin-sidebar-sortable');
  const dragged=[...wrap.querySelectorAll('.admin-menu-sort-row')].find(row=>row.dataset.route===adminSidebarDragRoute);
  if(!dragged)return;
  const rows=[...wrap.querySelectorAll('.admin-menu-sort-row')];
  const from=rows.indexOf(dragged),to=rows.indexOf(target);
  if(from<to)target.after(dragged);else target.before(dragged);
  [...wrap.querySelectorAll('.admin-menu-sort-row')].forEach((row,i)=>{const n=row.querySelector('.font-black.text-slate-400');if(n)n.textContent=String(i+1)});
}

function addAdminSidebarRubrique(form,module){
  const label=String(form.label?.value||"").trim();
  if(!label){toast("Nom de rubrique obligatoire","error");return}
  const route=sidebarNormalizeRoute(form.route?.value||"",module,label);
  const defaults=adminSidebarOrganizerDefaults();
  const base=(defaults[module]||[]).map(x=>x[1]);
  const customs=sidebarCustomItemsForModule(module);
  if(base.includes(route)||customs.some(x=>x.route===route)){toast("Cette route existe déjà dans ce module","error");return}
  const rows=sidebarCustomSettings()[module]||[];
  rows.push({id:uid("sm"),label:label.toUpperCase(),route,createdAt:new Date().toISOString(),createdBy:session?.username||""});
  sidebarCustomSettings()[module]=rows;
  const order=sidebarOrderForModule(module);
  sidebarOrderSettings()[module]=[...order.filter(Boolean),route];
  if(saveDB())toast("Rubrique ajoutée","success");
  form.reset();
  renderSidebar();
  renderView();
}

function deleteAdminSidebarRubrique(module,route){
  if(!confirm("Supprimer cette rubrique personnalisée ?"))return;
  sidebarCustomSettings()[module]=(sidebarCustomSettings()[module]||[]).filter(item=>item&&item.route!==route);
  sidebarOrderSettings()[module]=sidebarOrderForModule(module).filter(r=>r!==route);
  if(saveDB())toast("Rubrique supprimée","success");
  renderSidebar();
  renderView();
}

function saveAdminSidebarMenuOrder(module){
  const wrap=document.getElementById('admin-sidebar-sortable');
  const routes=[...wrap.querySelectorAll('.admin-menu-sort-row')].map(row=>row.dataset.route).filter(Boolean);
  sidebarOrderSettings()[module]=routes;
  if(saveDB())toast('Ordre du menu enregistré','success');
  renderSidebar();
  renderView();
}

function resetAdminSidebarMenuOrder(module){
  if(!confirm('Réinitialiser l’ordre du menu '+adminSidebarModuleLabel(module)+' ?'))return;
  delete sidebarOrderSettings()[module];
  if(saveDB())toast('Ordre réinitialisé','success');
  renderSidebar();
  renderView();
}

function renderAdminCountersMenu(view){
  const defaults=adminCounterOrganizerDefaults();
  const selected=sessionStorage.getItem("adminCounterMenuModule")||"drh";
  const module=defaults[selected]?selected:"drh";
  const saved=counterOrderForModule(module);
  const base=(defaults[module]||[]).map(label=>({label,key:label}));
  const ordered=applyCounterOrder(module,base);
  view.innerHTML=`<div class="mb-5"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Organiser les compteurs</h1><p class="text-sm text-slate-500 mt-1">Déplacez les compteurs avec la souris. Les chiffres, couleurs et routes restent inchangés.</p></div>
  <div class="card p-4 mb-4"><div class="flex items-center justify-between gap-3 flex-wrap"><div><label class="label">Module</label><select class="select" style="min-width:260px" onchange="sessionStorage.setItem('adminCounterMenuModule',this.value);renderView()">${Object.keys(defaults).map(k=>`<option value="${escapeHTML(k)}" ${k===module?"selected":""}>${escapeHTML(adminSidebarModuleLabel(k))}</option>`).join("")}</select></div><div class="flex gap-2"><button class="btn btn-secondary" onclick="saveAdminCounterOrder('${module}')">Enregistrer ordre</button><button class="btn btn-ghost" onclick="resetAdminCounterOrder('${module}')">Réinitialiser</button></div></div></div>
  <div class="card p-4"><div id="admin-counter-sortable" data-module="${escapeHTML(module)}">${ordered.map((item,idx)=>`<div class="admin-counter-sort-row" draggable="true" data-key="${escapeHTML(item.key)}" ondragstart="adminCounterDragStart(event)" ondragover="adminCounterDragOver(event)" ondrop="adminCounterDrop(event)" style="display:flex;align-items:center;gap:12px;padding:12px;margin-bottom:8px;border:1px solid #dbe3ef;border-radius:10px;background:#fff;cursor:grab"><span class="font-black text-slate-400" style="width:28px">${idx+1}</span><span style="font-size:20px;color:#0ea5e9">☰</span><div><div class="font-black text-slate-800">${escapeHTML(item.label)}</div><div class="text-xs text-slate-500">Compteur du module ${escapeHTML(adminSidebarModuleLabel(module))}</div></div></div>`).join("")}</div>${saved.length?`<div class="text-xs text-slate-500 mt-3">Ordre personnalisé actif pour ${escapeHTML(adminSidebarModuleLabel(module))}.</div>`:`<div class="text-xs text-slate-500 mt-3">Ordre par défaut actuellement utilisé.</div>`}</div>`;
}

function adminCounterDragStart(event){adminCounterDragKey=event.currentTarget.dataset.key||"";event.dataTransfer.effectAllowed="move";event.currentTarget.style.opacity=".55"}

function adminCounterDragOver(event){event.preventDefault();event.dataTransfer.dropEffect="move"}

function adminCounterDrop(event){
  event.preventDefault();
  const target=event.currentTarget;
  document.querySelectorAll('.admin-counter-sort-row').forEach(row=>row.style.opacity="");
  if(!adminCounterDragKey||target.dataset.key===adminCounterDragKey)return;
  const wrap=document.getElementById('admin-counter-sortable');
  const dragged=[...wrap.querySelectorAll('.admin-counter-sort-row')].find(row=>row.dataset.key===adminCounterDragKey);
  if(!dragged)return;
  const rows=[...wrap.querySelectorAll('.admin-counter-sort-row')];
  const from=rows.indexOf(dragged),to=rows.indexOf(target);
  if(from<to)target.after(dragged);else target.before(dragged);
  [...wrap.querySelectorAll('.admin-counter-sort-row')].forEach((row,i)=>{const n=row.querySelector('.font-black.text-slate-400');if(n)n.textContent=String(i+1)});
}

function saveAdminCounterOrder(module){
  const wrap=document.getElementById('admin-counter-sortable');
  const keys=[...wrap.querySelectorAll('.admin-counter-sort-row')].map(row=>row.dataset.key).filter(Boolean);
  counterOrderSettings()[module]=keys;
  if(saveDB())toast('Ordre des compteurs enregistré','success');
  refreshModuleCountersRibbon();
  renderView();
}

function resetAdminCounterOrder(module){
  if(!confirm('Réinitialiser l’ordre des compteurs '+adminSidebarModuleLabel(module)+' ?'))return;
  delete counterOrderSettings()[module];
  if(saveDB())toast('Ordre des compteurs réinitialisé','success');
  refreshModuleCountersRibbon();
  renderView();
}

function renderAdminDashboard(view){
  ensureNiveauxAcces();
  const adminSoc=adminActiveSociete();
  const users=db.users||[];
  const actifs=users.filter(u=>u.actif!==false).length;
  const blocked=users.filter(u=>u.actif===false).length;
  const agents=(db.agents||[]).filter(a=>a.statut!=="archive"&&adminMatchesSociete(a));
  // "Effectif actif" = employés NON sortants (inclut suspendus/absents), même définition que la
  // Fiche de position (GRH) et le serveur -> coherence 71 partout (au lieu de 69 en excluant les suspendus).
  const agentsActifs=agents.filter(a=>!employeeIsFormer(a)).length;
  const absents=agents.filter(a=>a.statut==="absent").length;
  const suspendus=agents.filter(a=>a.statut==="suspendu").length;
  const blacklist=agents.filter(a=>a.blacklist||a.blacklistContractBlocked||a.contractBlocked).length;
  const affectes=agents.filter(a=>!employeeIsFormer(a)&&agentHasLiveAffectation(a)).length;
  const candidats=(db.candidats||[]).filter(c=>candidatIsActive(c)&&adminMatchesSociete(c));
  const reserve=candidats.filter(c=>candidatIsReserve(c)).length;
  const sitesActifs=(db.sites||[]).filter(s=>s.actif!==false&&s.active!==0&&adminDataMatchesSociete(s)).length;
  const incidentsOuverts=(db.incidents||[]).filter(i=>i.statut!=="clos"&&adminMatchesSociete(i)).length;
  const missionsEnCours=(db.missions||[]).filter(m=>adminMatchesSociete(m)&&(!m.dateDebut||m.dateDebut<=today())&&(!m.dateFin||m.dateFin>=today())).length;
  const contratsAlerte=agents.filter(a=>!employeeIsFormer(a)).filter(a=>{const d=employeePositionContractDaysLeft(a);return d!==null&&d>=0&&d<=90}).length;
  const essaisAlerte=agents.filter(a=>!employeeIsFormer(a)&&a.dateFinEssai&&daysBetween(today(),a.dateFinEssai)>=0&&daysBetween(today(),a.dateFinEssai)<=90).length;
  const instructions=(db.echanges||[]).filter(e=>e.to==="all"||e.type==="post"||e.type==="instruction").length;
  const factures=(db.factures||[]).filter(adminMatchesSociete);
  const devis=(db.devis||[]).filter(adminMatchesSociete);
  const paiements=(db.paiements||[]).filter(adminMatchesSociete);
  const caFacture=factures.reduce((s,f)=>s+(parseFloat(f.total||f.montant||f.ttc)||0),0);
  const totalPaye=paiements.reduce((s,p)=>s+(parseFloat(p.montant||p.amount)||0),0);
  const clients=(db.clients||[]).filter(adminMatchesSociete).length;
  const prospects=(db.prospects||[]).filter(adminMatchesSociete).length;
  const opportunites=(db.opportunites||[]).filter(o=>adminMatchesSociete(o)&&!["gagnee","perdue"].includes(o.etape)).length;
  const articles=(db.stockArticles||[]).filter(adminDataMatchesSociete).length;
  const dotations=typeof agentsEnInstanceDotation==="function"?agentsEnInstanceDotation().length:0;
  const reversements=typeof agentsEnInstanceReversement==="function"?agentsEnInstanceReversement().length:0;
  const tauxPresence=agents.length?Math.round((agentsActifs/(agentsActifs+absents+suspendus||1))*100):0;
  const tauxAffectation=agentsActifs?Math.round((affectes/agentsActifs)*100):0;
  const moduleCard=(title,desc,route,color,metrics)=>`<button class="card p-5 text-left kpi-clickable" onclick="navigate('${route}')" style="border-left:5px solid ${color};min-height:154px"><div class="flex items-start justify-between gap-3"><div><div class="text-xs uppercase font-black tracking-wider text-slate-500">${title}</div><div class="text-sm text-slate-500 mt-1">${desc}</div></div><div class="text-xl font-black" style="color:${color}">→</div></div><div class="grid grid-2 gap-2 mt-4">${metrics.map(m=>`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px"><div class="text-[11px] uppercase font-bold text-slate-500">${m[0]}</div><div class="text-xl font-black" style="color:${color}">${m[1]}</div></div>`).join("")}</div></button>`;
  view.innerHTML=`<div class="mb-5"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administrateur général</div><h1 class="text-3xl font-black mt-1">Cockpit Direction Générale</h1><p class="text-sm text-slate-500 mt-1">${adminSoc?`Vue société : ${escapeHTML(adminSoc)}.`:"Vue N°01 : performance globale, alertes critiques, situation par direction et accès direct à tous les modules."}</p></div>
  ${adminSocieteSelectorHTML("Basculez la société pour consulter et configurer le périmètre correspondant.")}
  <div class="grid grid-4 gap-3 mb-5">
    <button class="card p-4 text-left kpi-clickable" onclick="navigate('effectif/recap')"><div class="text-xs text-slate-500 uppercase font-bold">Effectif actif</div><div class="text-3xl font-black" style="color:#043970">${agentsActifs}</div><div class="text-xs text-slate-400 mt-1">${agents.length} agent(s) au total</div></button>
    <button class="card p-4 text-left kpi-clickable" onclick="navigate('effectif/recap')"><div class="text-xs text-slate-500 uppercase font-bold">Taux présence</div><div class="text-3xl font-black text-emerald-700">${tauxPresence}%</div><div class="text-xs text-slate-400 mt-1">${absents} absent(s) · ${suspendus} suspendu(s)</div></button>
    <button class="card p-4 text-left kpi-clickable" onclick="navigate('effectif/recap')"><div class="text-xs text-slate-500 uppercase font-bold">Taux affectation</div><div class="text-3xl font-black text-blue-700">${tauxAffectation}%</div><div class="text-xs text-slate-400 mt-1">${affectes} agent(s) affecté(s)</div></button>
    <button class="card p-4 text-left kpi-clickable" onclick="navigate('sites/actifs')"><div class="text-xs text-slate-500 uppercase font-bold">Sites actifs</div><div class="text-3xl font-black text-blue-700">${sitesActifs}</div><div class="text-xs text-slate-400 mt-1">${escapeHTML(adminSoc||"Toutes sociétés")}</div></button>
    <button class="card p-4 text-left kpi-clickable" onclick="navigate('ops/missions')"><div class="text-xs text-slate-500 uppercase font-bold">Missions en cours</div><div class="text-3xl font-black text-amber-700">${missionsEnCours}</div><div class="text-xs text-slate-400 mt-1">${(db.missions||[]).length} OM enregistré(s)</div></button>
    <button class="card p-4 text-left kpi-clickable" onclick="navigate('contrats/situation')"><div class="text-xs text-slate-500 uppercase font-bold">Alertes contrats</div><div class="text-3xl font-black text-red-700">${contratsAlerte}</div><div class="text-xs text-slate-400 mt-1">CDD ≤ 90 jours</div></button>
    <button class="card p-4 text-left kpi-clickable" onclick="navigate('contrats/situation')"><div class="text-xs text-slate-500 uppercase font-bold">Alertes essai</div><div class="text-3xl font-black text-orange-700">${essaisAlerte}</div><div class="text-xs text-slate-400 mt-1">Essai ≤ 90 jours</div></button>
    <button class="card p-4 text-left kpi-clickable" onclick="navigate('facturation/dashboard')"><div class="text-xs text-slate-500 uppercase font-bold">Facturé</div><div class="text-3xl font-black text-slate-900">${money(caFacture)}</div><div class="text-xs text-slate-400 mt-1">${factures.length} facture(s)</div></button>
  </div>
  <div class="grid grid-3 gap-4 mb-5">
    ${moduleCard("DRH","Recrutement, réserve, contrats, effectif et alertes RH.","drh/dashboard","#043970",[["Effectif",agents.length],["Candidats",candidats.length],["Réserve",reserve],["Blacklist",blacklist]])}
    ${moduleCard("OPS","Sites, missions, présence terrain, incidents et supervision.","ops/dashboard","#1d4ed8",[["Sites",sitesActifs],["Missions",missionsEnCours],["Incidents",incidentsOuverts],["Absents",absents]])}
    ${moduleCard("Matériel","Stock, dotations, reversements et mouvements.","materiel/dashboard","#0f766e",[["Articles",articles],["Dotations",dotations],["Reversements",reversements],["Magasins",(db.magasins||[]).filter(adminDataMatchesSociete).length]])}
    ${moduleCard("Finances / Compta","Facturation, paiements, situation client et encaissements.","facturation/dashboard","#334155",[["Factures",factures.length],["Devis",devis.length],["Payé",money(totalPaye)],["Reste",money(Math.max(0,caFacture-totalPaye))]])}
    ${moduleCard("Commercial","Prospects, clients, opportunités et suivi commercial.","commercial/dashboard","#7c3aed",[["Clients",clients],["Prospects",prospects],["Opportunités",opportunites],["Devis",devis.length]])}
    ${moduleCard("Paie / Pointage","Présence, préparation paie, indicateurs sociaux.","paie/dashboard","#ca8a04",[["Présence",tauxPresence+"%"],["Affectation",tauxAffectation+"%"],["Congés",(db.conges||[]).length],["Alertes",contratsAlerte+essaisAlerte]])}
  </div>
  <div class="grid grid-2 gap-4">
    <div class="card p-5"><h2 class="font-black text-lg mb-3">Répartition sociétés</h2><div class="space-y-2">${SOCIETES.map(s=>{const n=agents.filter(a=>a.societe===s).length;const p=agents.length?Math.round(n*100/agents.length):0;return`<button class="w-full text-left" onclick="setCurrentStructureSocieteFilter('${escapeHTML(s)}');navigate('effectif/recap')"><div class="flex justify-between text-xs font-bold"><span>${escapeHTML(s)}</span><span>${n}</span></div><div style="height:7px;background:#e2e8f0;border-radius:999px;overflow:hidden"><div style="height:100%;width:${p}%;background:#043970"></div></div></button>`}).join("")}</div></div>
    <div class="card p-5"><h2 class="font-black text-lg mb-3">Alertes Direction Générale</h2><div class="grid grid-2 gap-2">
      <button class="p-3 rounded-lg text-left" style="border:1px solid #fecaca;background:#fff7ed" onclick="navigate('contrats/situation')"><div class="font-black text-red-700">${contratsAlerte+essaisAlerte} alerte(s) RH</div><div class="text-xs text-slate-500 mt-1">Contrats et périodes d'essai à surveiller.</div></button>
      <button class="p-3 rounded-lg text-left" style="border:1px solid #dbeafe;background:#eff6ff" onclick="navigate('ops/dashboard')"><div class="font-black text-blue-700">${incidentsOuverts} incident(s)</div><div class="text-xs text-slate-500 mt-1">Situation OPS ouverte.</div></button>
      <button class="p-3 rounded-lg text-left" style="border:1px solid #e2e8f0;background:#f8fafc" onclick="navigate('admin/feed')"><div class="font-black text-violet-700">${instructions} instruction(s)</div><div class="text-xs text-slate-500 mt-1">Consignes générales et informations publiées.</div></button>
      <button class="p-3 rounded-lg text-left" style="border:1px solid #fee2e2;background:#fef2f2" onclick="navigate('admin/users')"><div class="font-black text-red-700">${blocked} compte(s) bloqué(s)</div><div class="text-xs text-slate-500 mt-1">${actifs} utilisateur(s) actif(s).</div></button>
    </div>${isAdminSystemSession()?`<div class="mt-4 p-3 rounded-lg text-xs text-slate-600" style="background:#f8fafc;border:1px solid #e2e8f0">Les paramètres techniques restent disponibles dans la section <b>Administration système</b> du menu latéral.</div>`:""}</div>
  </div>`;
}

function renderAdminSyncSettings(view){
  const cfg=sgdiAutoRefreshSettings();
  const nextLabel=cfg.enabled?`Toutes les ${cfg.intervalSeconds} seconde(s)`:"Désactivée";
  view.innerHTML=`<div class="mb-5"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Synchronisation automatique</h1><p class="text-sm text-slate-500 mt-1">Les utilisateurs connectés récupèrent automatiquement les données PostgreSQL selon cette fréquence.</p></div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Etat</div><div class="text-2xl font-black ${cfg.enabled?"text-emerald-700":"text-slate-500"}">${cfg.enabled?"Active":"Arrêtée"}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Fréquence</div><div class="text-2xl font-black" style="color:#043970">${escapeHTML(nextLabel)}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Plage autorisée</div><div class="text-2xl font-black text-amber-700">5 - 20 s</div></div>
    </div>
    <form class="card p-5 max-w-3xl" onsubmit="event.preventDefault();saveAdminAutoRefreshSettings(this)">
      <h2 class="font-black text-lg mb-4">Paramétrage de l'actualisation</h2>
      <label class="flex items-center gap-3 mb-5 p-3 rounded-lg" style="background:#f8fafc;border:1px solid #e2e8f0">
        <input type="checkbox" name="enabled" ${cfg.enabled?"checked":""}/>
        <span><b>Activer l'actualisation automatique</b><br/><small class="text-slate-500">Chaque poste connecté se synchronise avec PostgreSQL.</small></span>
      </label>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
        <div>
          <label class="label">Durée entre deux actualisations</label>
          <input class="input" type="number" name="intervalSeconds" min="5" max="20" step="1" value="${cfg.intervalSeconds}" oninput="document.getElementById('sync-range').value=this.value"/>
        </div>
        <div>
          <label class="label">Réglage rapide</label>
          <input id="sync-range" class="w-full" type="range" min="5" max="20" step="1" value="${cfg.intervalSeconds}" oninput="this.form.intervalSeconds.value=this.value"/>
        </div>
      </div>
      <div class="mt-4 p-3 rounded-md text-xs text-sky-800" style="background:#eff6ff;border:1px solid #bfdbfe">L'actualisation ne coupe pas une saisie en cours : elle attend que l'utilisateur ne soit pas dans un champ ou une fenêtre.</div>
      <div class="sticky bottom-0 mt-5 p-3 flex justify-end gap-2" style="background:#ffffffcc;backdrop-filter:blur(8px);border-top:1px solid #e2e8f0"><button type="button" class="btn btn-ghost" onclick="renderView()">Annuler</button><button class="btn btn-primary">Enregistrer la configuration</button></div>
    </form>`;
}

function adminFeedItemsHTML(items,compact){
  if(!items.length)return`<div class="text-sm text-slate-400 p-4 text-center">Aucun échange enregistré.</div>`;
  return items.map(m=>{
    const from=(db.users||[]).find(u=>u.username===m.from);
    const to=(db.users||[]).find(u=>u.username===m.to);
    const toLabel=m.to==="all"?"Tous les utilisateurs":(to?to.nom:m.to||"Administrateur");
    const role=from?from.role:"";
    const color=m.to==="all"?"#7c3aed":(m.to==="admin"?"#dc2626":"#043970");
    return `<article class="card ${compact?"p-3":"p-4"} mb-3" style="border-left:4px solid ${color}">
      <div class="flex items-start justify-between gap-3 mb-2">
        <div>
          <div class="font-bold text-slate-900">${escapeHTML(from?from.nom:m.from||"—")} <span class="pill pill-gray">${escapeHTML(role||"utilisateur")}</span></div>
          <div class="text-xs text-slate-500">Vers ${escapeHTML(toLabel)} · ${new Date(m.date).toLocaleString("fr-FR")}</div>
        </div>
      </div>
      ${m.sujet?`<div class="text-sm font-bold mb-1">${escapeHTML(m.sujet)} ${importanceBadge(m.importance,"ml-1")}</div>`:""}
      <div class="text-sm text-slate-700 leading-relaxed">${escapeHTML(m.message)}</div>
      <div class="mt-3 flex gap-2"><button class="btn btn-ghost text-xs" onclick="openFeedDetail('${m.id}')">Voir</button>${!compact?`<button class="btn btn-ghost text-xs" onclick="openInstruction('${m.id}')">Instruction</button>`:""}</div>
    </article>`;
  }).join("");
}

function renderAdminFeed(view){
  const users=db.users||[];
  const q=(sessionStorage.getItem("adminFeedSearch")||"").toLowerCase();
  const from=sessionStorage.getItem("adminFeedFrom")||"";
  const list=(db.echanges||[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).filter(m=>{
    if(from&&m.from!==from&&m.to!==from)return false;
    if(!q)return true;
    const fu=users.find(u=>u.username===m.from);const tu=users.find(u=>u.username===m.to);
    const hay=[m.from,m.to,m.sujet,m.message,fu&&fu.nom,tu&&tu.nom].join(" ").toLowerCase();
    return hay.includes(q);
  });
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">Administration — Fil d'actualité</h1>
    <div class="card p-4 mb-4">
      <div class="grid grid-3">
        <div><label class="label">Recherche</label><input class="input" value="${escapeHTML(q)}" placeholder="Message, sujet, utilisateur..." oninput="sessionStorage.setItem('adminFeedSearch',this.value);renderView()"/></div>
        <div><label class="label">Utilisateur</label><select class="select" onchange="sessionStorage.setItem('adminFeedFrom',this.value);renderView()"><option value="">Tous</option>${users.map(u=>`<option value="${escapeHTML(u.username)}" ${from===u.username?"selected":""}>${escapeHTML(u.nom||u.username)} · ${escapeHTML(u.role)}</option>`).join("")}</select></div>
        <div class="flex items-end justify-between gap-2"><div><div class="text-xs text-slate-500">Echanges affichés</div><div class="text-3xl font-black text-red-700">${list.length}</div></div><button class="btn btn-ghost text-xs" onclick="sessionStorage.removeItem('adminFeedSearch');sessionStorage.removeItem('adminFeedFrom');renderView()">Réinitialiser</button></div>
      </div>
    </div>
    <div class="max-w-4xl">${adminFeedItemsHTML(list,false)}</div>`;
}

function adminMessageAttachmentLinks(m){
  const files=Array.isArray(m.attachments)?m.attachments:[];
  if(!files.length)return '<span class="text-slate-400 text-xs">Aucune</span>';
  return files.map((f,i)=>'<a class="btn btn-ghost text-xs" href="'+escapeHTML(f.data||'#')+'" download="'+escapeHTML(f.name||('piece-'+(i+1)))+'">📎 '+escapeHTML(f.name||('Pièce '+(i+1)))+'</a>').join(' ');
}

function renderAdminMessagesHistory(view){
  const users=db.users||[];
  const q=(sessionStorage.getItem("adminMsgSearch")||"").toLowerCase();
  const user=sessionStorage.getItem("adminMsgUser")||"";
  const kind=sessionStorage.getItem("adminMsgKind")||"all";
  const all=(db.echanges||[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  const messages=all.filter(m=>{
    const files=Array.isArray(m.attachments)?m.attachments:[];
    if(kind==="attachments"&&!files.length)return false;
    if(kind==="messages"&&files.length)return false;
    if(user&&m.from!==user&&m.to!==user)return false;
    if(!q)return true;
    const fu=users.find(u=>u.username===m.from);const tu=users.find(u=>u.username===m.to);
    const hay=[m.from,m.to,m.sujet,m.message,fu&&fu.nom,tu&&tu.nom].concat(files.map(f=>f.name)).join(" ").toLowerCase();
    return hay.includes(q);
  });
  const total=all.length;
  const withFiles=all.filter(m=>Array.isArray(m.attachments)&&m.attachments.length).length;
  const unread=all.filter(m=>!m.luPar||m.luPar.length<=1).length;
  const userOptions=users.map(u=>'<option value="'+escapeHTML(u.username)+'" '+(user===u.username?'selected':'')+'>'+escapeHTML(u.nom||u.username)+' · '+escapeHTML(u.role||'')+'</option>').join('');
  const rows=messages.map(m=>{
    const fu=users.find(u=>u.username===m.from);const tu=users.find(u=>u.username===m.to);
    const files=Array.isArray(m.attachments)?m.attachments:[];
    const received=(m.receivedBy||[]).length;
    const read=(m.luPar||[]).filter(x=>x!==m.from).length;
    return '<tr class="border-t" data-searchable>'+
      '<td class="p-3 text-xs"><div>'+formatDate(m.date)+'</div><div class="font-mono text-slate-500">'+new Date(m.date).toLocaleTimeString("fr-FR")+'</div></td>'+
      '<td class="p-3 font-semibold">'+escapeHTML(fu?fu.nom:m.from||'—')+'<div class="text-[10px] text-slate-500">'+escapeHTML(m.from||'')+'</div></td>'+
      '<td class="p-3">'+escapeHTML(m.to==="all"?"Général":(tu?tu.nom:m.to||'—'))+'<div class="text-[10px] text-slate-500">'+escapeHTML(m.to||'')+'</div></td>'+
      '<td class="p-3"><div class="max-w-md whitespace-pre-wrap">'+escapeHTML(m.message||'—')+'</div>'+(m.sujet?'<div class="text-xs text-slate-500 mt-1">Sujet : '+escapeHTML(m.sujet)+'</div>':'')+'</td>'+
      '<td class="p-3 text-xs"><span class="pill pill-gray">Reçu: '+received+'</span> <span class="pill '+(read?'pill-green':'pill-red')+'">Lu: '+read+'</span></td>'+
      '<td class="p-3"><div class="flex gap-1 flex-wrap">'+adminMessageAttachmentLinks(m)+'</div>'+(files.length?'<div class="text-[10px] text-slate-500 mt-1">'+files.length+' fichier(s)</div>':'')+'</td>'+
    '</tr>';
  }).join('')||'<tr><td class="p-6 text-center text-slate-400" colspan="6">Aucun message trouvé.</td></tr>';
  view.innerHTML='<h1 class="text-2xl font-bold mb-2">💬 Historique des messages et pièces jointes</h1>'+
    '<p class="text-sm text-slate-500 mb-4">Consultation administrative complète des conversations internes SGDI.</p>'+
    '<div class="grid grid-3 gap-3 mb-4">'+
      '<div class="card p-4"><div class="text-xs text-slate-500 uppercase">Messages totaux</div><div class="text-3xl font-black text-slate-900">'+total+'</div></div>'+
      '<div class="card p-4"><div class="text-xs text-slate-500 uppercase">Avec pièces jointes</div><div class="text-3xl font-black text-blue-700">'+withFiles+'</div></div>'+
      '<div class="card p-4"><div class="text-xs text-slate-500 uppercase">Non lus / non confirmés</div><div class="text-3xl font-black text-red-700">'+unread+'</div></div>'+
    '</div>'+
    '<div class="card p-4 mb-4"><div class="grid grid-4">'+
      '<div><label class="label">Recherche</label><input class="input" value="'+escapeHTML(q)+'" placeholder="Message, pièce, utilisateur..." oninput="sessionStorage.setItem(\'adminMsgSearch\',this.value);renderView()"/></div>'+
      '<div><label class="label">Utilisateur</label><select class="select" onchange="sessionStorage.setItem(\'adminMsgUser\',this.value);renderView()"><option value="">Tous</option>'+userOptions+'</select></div>'+
      '<div><label class="label">Type</label><select class="select" onchange="sessionStorage.setItem(\'adminMsgKind\',this.value);renderView()"><option value="all" '+(kind==="all"?'selected':'')+'>Tout</option><option value="messages" '+(kind==="messages"?'selected':'')+'>Messages seuls</option><option value="attachments" '+(kind==="attachments"?'selected':'')+'>Avec pièces jointes</option></select></div>'+
      '<div class="flex items-end justify-between gap-2"><div><div class="text-xs text-slate-500">Résultat</div><div class="text-3xl font-black text-red-700">'+messages.length+'</div></div><button class="btn btn-ghost text-xs" onclick="sessionStorage.removeItem(\'adminMsgSearch\');sessionStorage.removeItem(\'adminMsgUser\');sessionStorage.removeItem(\'adminMsgKind\');renderView()">Réinitialiser</button></div>'+
    '</div></div>'+
    '<div class="card p-0 overflow-x-auto"><table class="w-full text-sm"><thead class="bg-slate-50"><tr><th class="text-left p-3">Date</th><th class="text-left p-3">De</th><th class="text-left p-3">Vers</th><th class="text-left p-3">Message</th><th class="text-left p-3">Statut</th><th class="text-left p-3">Pièces jointes</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

function renderAdminLoans(view){
  if(!isAdminSystemSession()){view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700">Accès refusé</h2><p>Cette section est réservée à l’Administration système.</p></div>`;return}
  view.innerHTML=`<div class="card p-6 text-center text-slate-500">Chargement des paramètres…</div>`;
  SGDI_API.request("/api/loans/settings",{method:"GET"}).then(data=>{adminLoanSettingsCache=data;renderAdminLoansContent(view)}).catch(e=>{view.innerHTML=`<div class="card p-6 text-red-700">${escapeHTML(e.message||"Chargement impossible")}</div>`});
}

function renderAdminLoansContent(view){
  const s=adminLoanSettingsCache||{};
  const number=(id,label,value,min,max,step="1")=>`<div><label class="label">${label}</label><input id="${id}" class="input" type="number" min="${min}" max="${max}" step="${step}" value="${escapeHTML(value)}"></div>`;
  const toggle=(id,label,help)=>`<label class="admin-access-toggle" style="justify-content:flex-start;gap:10px"><input id="${id}" type="checkbox" ${s[id]?"checked":""}><span><b>${label}</b><small class="block text-slate-500">${help}</small></span></label>`;
  view.innerHTML=`<div class="mb-4"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-2xl font-black mt-1">Prêts & avances</h1><p class="text-sm text-slate-500 mt-1">Configuration centrale de pret.irongs.com et du circuit vers caisse.irongs.com.</p></div>
  <div class="card p-5 mb-4"><h2 class="font-black text-lg mb-3">Activation et règles d’éligibilité</h2><div class="mb-3">${toggle("module_enabled","Demandes ouvertes","Désactivez pour suspendre toute nouvelle demande sans perdre les dossiers existants.")}</div><div class="grid grid-cols-1 md:grid-cols-3 gap-3">
  ${number("advance_min_seniority_months","Ancienneté minimale — avance (mois)",s.advance_min_seniority_months,0,120)}${number("loan_min_seniority_months","Ancienneté minimale — prêt (mois)",s.loan_min_seniority_months,0,120)}${number("debt_ratio_limit","Taux d’endettement maximal (%)",s.debt_ratio_limit,1,100,"0.1")}
  ${number("advance_salary_multiple","Plafond avance (multiple du salaire)",s.advance_salary_multiple,0.1,20,"0.1")}${number("loan_salary_multiple","Plafond prêt (multiple du salaire)",s.loan_salary_multiple,0.1,50,"0.1")}${number("merit_threshold","Seuil de mérite (%)",s.merit_threshold,0,100,"0.1")}
  ${number("advance_max_installments","Durée maximale avance (mois)",s.advance_max_installments,1,36)}${number("loan_max_installments","Durée maximale prêt (mois)",s.loan_max_installments,1,120)}${number("default_interest_rate","Taux proposé par défaut (%)",s.default_interest_rate,0,100,"0.01")}${number("maximum_interest_rate","Taux maximal autorisé (%)",s.maximum_interest_rate,0,100,"0.01")}</div></div>
  <div class="card p-5 mb-4"><h2 class="font-black text-lg mb-3">Contrôles et circuit d’approbation</h2><div class="grid grid-cols-1 md:grid-cols-2 gap-3">${toggle("require_active_employee","Employé actif obligatoire","Refuse l’éligibilité des fiches non actives.")}${toggle("enforce_contract_end","Respecter la fin du contrat","La dernière mensualité doit précéder la fin du contrat.")}${toggle("allow_eligibility_override","Dérogation DG autorisée","Le DG peut motiver une exception aux critères indicatifs.")}${toggle("require_dg_signature","Signature DG obligatoire","La décision doit être signée avant transmission.")}${toggle("require_secretariat_validation","Contrôle du Secrétariat","Le Secrétariat imprime et suit le dossier.")}${toggle("require_beneficiary_signature","Signature du bénéficiaire","La convention doit être signée avant décaissement.")}${toggle("require_cash_validation","Validation Caisse","La Caisse confirme le décaissement.")}</div></div>
  <div class="card p-5 mb-4"><h2 class="font-black text-lg mb-3">Autorisations, notifications et documents</h2><div class="grid grid-cols-1 md:grid-cols-2 gap-3"><div><label class="label">Rôles gestionnaires (séparés par virgule)</label><input id="manager_roles" class="input" value="${escapeHTML((s.manager_roles||[]).join(", "))}"></div><div><label class="label">Rôles Secrétariat</label><input id="secretariat_roles" class="input" value="${escapeHTML((s.secretariat_roles||[]).join(", "))}"></div><div><label class="label">Rôles Caisse</label><input id="cash_roles" class="input" value="${escapeHTML((s.cash_roles||[]).join(", "))}"></div><div><label class="label">Email Secrétariat</label><input id="secretariat_notification_email" class="input" type="email" value="${escapeHTML(s.secretariat_notification_email||"")}"></div><div><label class="label">Email Caisse</label><input id="cash_notification_email" class="input" type="email" value="${escapeHTML(s.cash_notification_email||"")}"></div><div><label class="label">Préfixe décision</label><input id="decision_prefix" class="input" value="${escapeHTML(s.decision_prefix||"DEC-")}"></div><div><label class="label">Préfixe convention</label><input id="contract_prefix" class="input" value="${escapeHTML(s.contract_prefix||"CONV-")}"></div></div></div>
  <div class="flex justify-end"><button class="btn btn-primary" onclick="saveAdminLoanSettings()">Enregistrer la configuration</button></div>`;
}

async function saveAdminLoanSettings(){
  const s=adminLoanSettingsCache||{},payload={};
  ["module_enabled","require_active_employee","enforce_contract_end","allow_eligibility_override","require_dg_signature","require_secretariat_validation","require_beneficiary_signature","require_cash_validation"].forEach(k=>payload[k]=document.getElementById(k).checked);
  ["advance_min_seniority_months","loan_min_seniority_months","debt_ratio_limit","advance_salary_multiple","loan_salary_multiple","advance_max_installments","loan_max_installments","merit_threshold","default_interest_rate","maximum_interest_rate"].forEach(k=>payload[k]=Number(document.getElementById(k).value));
  ["manager_roles","secretariat_roles","cash_roles"].forEach(k=>payload[k]=document.getElementById(k).value.split(",").map(x=>x.trim()).filter(Boolean));
  ["secretariat_notification_email","cash_notification_email"].forEach(k=>payload[k]=document.getElementById(k).value.trim()||null);payload.decision_prefix=document.getElementById("decision_prefix").value.trim()||"DEC-";payload.contract_prefix=document.getElementById("contract_prefix").value.trim()||"CONV-";
  try{adminLoanSettingsCache=await SGDI_API.request("/api/loans/settings",{method:"PUT",body:payload});logActivity("Configuration prêts & avances","mise à jour");toast("Configuration enregistrée","success");renderAdminLoansContent(document.getElementById("view"))}catch(e){toast("Enregistrement refusé : "+(e.message||e),"error")}
}

function renderAdminCommercialDc(view){
  if(!isAdminSystemSession()){view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700 mb-2">Accès refusé</h2><p class="text-slate-600">Cette section est réservée au compte Administration système.</p></div>`;return}
  view.innerHTML=`<div class="card p-6"><div class="text-center text-slate-500">Chargement…</div></div>`;
  Promise.all([
    SGDI_API.request("/api/commercial/dc/settings",{method:"GET"}),
    SGDI_API.request("/api/commercial/dc/access-rules",{method:"GET"})
  ]).then(([settings,rules])=>{
    adminCommercialDcSettingsCache=settings;
    adminCommercialDcRulesCache=rules;
    renderAdminCommercialDcContent(view);
  }).catch(e=>{
    view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700 mb-2">Erreur</h2><p class="text-slate-600">${escapeHTML(e.message||"Chargement impossible")}</p></div>`;
  });
}

function renderAdminCommercialDcContent(view){
  const settings=adminCommercialDcSettingsCache||{};
  const rules=adminCommercialDcRulesCache||[];
  const allSocieties=uniqueSocieteNames([...SOCIETES,...((societeConfig().custom)||[])]);
  const active=new Set(settings.active_societies||[]);
  view.innerHTML=`
    <div class="mb-4"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-xl font-black mt-0.5">Commercial (dc.irongs.com)</h1><p class="text-sm text-slate-500 mt-1">Accès et réglages du module commercial autonome — indépendant de la section « Commercial » interne ci-dessus.</p></div>
    <div class="card p-5 mb-4">
      <h2 class="font-black text-lg mb-1">Accès par rôle</h2>
      <p class="text-xs text-slate-500 mb-3">Qui peut se connecter à dc.irongs.com. Les Directeurs ont toujours accès.</p>
      <div class="grid grid-cols-2 gap-3">
        ${rules.map(r=>`<label class="admin-access-toggle ${r.allowed?"is-exception-allow":"is-exception-deny"}" style="justify-content:flex-start;gap:10px;padding:11px 13px;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer">
          <input type="checkbox" ${r.allowed?"checked":""} ${r.role==="ADM"?"disabled":""} onchange="adminToggleCommercialDcAccess('${jsString(r.role)}',this.checked)"/>
          <span>${escapeHTML(r.label)}${r.role==="ADM"?" (toujours autorisé)":""}</span>
        </label>`).join("")}
      </div>
    </div>
    <div class="card p-5 mb-4">
      <h2 class="font-black text-lg mb-3">Paramètres métier</h2>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div><label class="label">TVA par défaut (%)</label><input id="dc-default-tva" class="input" type="number" min="0" max="100" step="0.5" value="${escapeHTML(settings.default_tva??19)}"/></div>
      </div>
      <div class="grid grid-cols-3 gap-3 mb-3">
        <div><label class="label">Préfixe devis</label><input id="dc-devis-prefix" class="input" value="${escapeHTML(settings.devis_prefix||"DEV-")}"/></div>
        <div><label class="label">Préfixe commande</label><input id="dc-commande-prefix" class="input" value="${escapeHTML(settings.commande_prefix||"CMD-")}"/></div>
        <div><label class="label">Préfixe bon de livraison</label><input id="dc-bl-prefix" class="input" value="${escapeHTML(settings.bl_prefix||"BL-")}"/></div>
      </div>
      <label class="label">Sociétés actives dans le module</label>
      <div class="grid grid-cols-2 gap-2 mb-4">
        ${allSocieties.length?allSocieties.map(s=>`<label class="flex items-center gap-2 text-sm"><input type="checkbox" value="${escapeHTML(s)}" ${active.has(s)?"checked":""} class="dc-society-checkbox"/> ${escapeHTML(s)}</label>`).join(""):`<div class="text-sm text-slate-500">Aucune société configurée.</div>`}
      </div>
      <button class="btn btn-primary" onclick="saveAdminCommercialDcSettings()">Enregistrer les paramètres</button>
    </div>`;
}

async function adminToggleCommercialDcAccess(role,allowed){
  if(!isAdminSystemSession()){toast("Accès réservé au compte Administration système","error");return}
  try{
    adminCommercialDcRulesCache=await SGDI_API.request("/api/commercial/dc/access-rules",{method:"PUT",body:{role,allowed}});
    logActivity("Accès Commercial DC",role+"="+allowed);
    toast("Accès mis à jour","success");
  }catch(e){
    toast("Échec : "+(e.message||e),"error");
  }
  render();
}

async function saveAdminCommercialDcSettings(){
  if(!isAdminSystemSession()){toast("Accès réservé au compte Administration système","error");return}
  const activeSocieties=[...document.querySelectorAll(".dc-society-checkbox:checked")].map(el=>el.value);
  const payload={
    default_tva:parseFloat(document.getElementById("dc-default-tva").value)||0,
    devis_prefix:document.getElementById("dc-devis-prefix").value.trim()||"DEV-",
    commande_prefix:document.getElementById("dc-commande-prefix").value.trim()||"CMD-",
    bl_prefix:document.getElementById("dc-bl-prefix").value.trim()||"BL-",
    active_societies:activeSocieties
  };
  try{
    adminCommercialDcSettingsCache=await SGDI_API.request("/api/commercial/dc/settings",{method:"PUT",body:payload});
    logActivity("Paramètres Commercial DC","mise à jour");
    toast("Paramètres enregistrés","success");
  }catch(e){
    toast("Échec : "+(e.message||e),"error");
  }
}

function renderAdminPriorites(view){
  const pr=db.priorites||[];const niveaux=["haute","moyenne","basse"];
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">⚡ Priorités</h1>
    <div class="flex justify-end mb-3"><button class="btn btn-primary" onclick="openAdminPrioriteModal('')">➕ Nouvelle priorité</button></div>
    <div class="card p-0 overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-slate-50"><tr><th class="text-left p-3">Libellé</th><th class="text-left p-3">Module</th><th class="text-left p-3">Niveau</th><th class="text-center p-3">Actif</th><th class="p-3">Actions</th></tr></thead>
      <tbody>${pr.map(p=>`<tr class="border-t">
        <td class="p-3 font-semibold">${escapeHTML(p.label)}</td>
        <td class="p-3"><span class="pill pill-gray">${escapeHTML(p.module)}</span></td>
        <td class="p-3"><span class="pill" style="background:${p.couleur}22;color:${p.couleur};font-weight:700">${escapeHTML(p.niveau)}</span></td>
        <td class="p-3 text-center"><input type="checkbox" ${p.actif?"checked":""} onchange="adminTogglePriorite('${p.id}',this.checked)" style="width:18px;height:18px;cursor:pointer"/></td>
        <td class="p-3"><button class="btn btn-ghost text-xs" onclick="openAdminPrioriteModal('${p.id}')">✏</button><button class="btn btn-ghost text-xs text-red-600" onclick="adminDeletePriorite('${p.id}')">🗑</button></td>
      </tr>`).join("")||`<tr><td class="p-6 text-center text-slate-400" colspan="5">Aucune.</td></tr>`}</tbody>
    </table></div>`;
}

function openAdminPrioriteModal(id){
  const isNew=!id;const p=isNew?{id:uid("p"),label:"",module:"contrats",niveau:"moyenne",couleur:"#043970",actif:true}:db.priorites.find(x=>x.id===id);
  if(!p){toast("Introuvable","error");return}
  openModal(`<h3 class="font-bold text-lg mb-4">${isNew?"➕ Nouvelle priorité":"✏ Modifier"}</h3>
    <form onsubmit="event.preventDefault();confirmAdminPriorite('${p.id}',${isNew})">
      <label class="label">Libellé *</label><input class="input" name="label"  value="${escapeHTML(p.label)}"/>
      <div class="grid grid-2 gap-3 mt-3">
        <div><label class="label">Module *</label><select class="input" name="module">${ADMIN_MODULES.map(m=>`<option value="${m}" ${p.module===m?"selected":""}>${m}</option>`).join("")}</select></div>
        <div><label class="label">Niveau</label><select class="input" name="niveau"><option value="haute" ${p.niveau==="haute"?"selected":""}>Haute</option><option value="moyenne" ${p.niveau==="moyenne"?"selected":""}>Moyenne</option><option value="basse" ${p.niveau==="basse"?"selected":""}>Basse</option></select></div>
        <div><label class="label">Couleur</label><input class="input" name="couleur" type="color" value="${p.couleur}"/></div>
        <div><label class="label">Statut</label><select class="input" name="actif"><option value="true" ${p.actif?"selected":""}>Actif</option><option value="false" ${!p.actif?"selected":""}>Inactif</option></select></div>
      </div>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">💾 Enregistrer</button></div>
    </form>`);
}

function confirmAdminPriorite(id,isNew){
  const f=document.querySelector(".modal-bg form");if(!f)return;const fd=new FormData(f);
  const data={id,label:fd.get("label"),module:fd.get("module"),niveau:fd.get("niveau"),couleur:fd.get("couleur"),actif:fd.get("actif")==="true"};
  if(isNew)db.priorites.push(data);else{const idx=db.priorites.findIndex(x=>x.id===id);if(idx>=0)db.priorites[idx]=data}
  logActivity(isNew?"Création priorité":"Modification priorité",data.label);
  saveDB();closeModal();toast("Enregistré","success");render();
}

function adminTogglePriorite(id,actif){const p=db.priorites.find(x=>x.id===id);if(!p)return;p.actif=actif;saveDB();logActivity("Toggle priorité",p.label+"="+actif);toast(actif?"Activé":"Désactivé","success")}

function adminDeletePriorite(id){if(!confirm("Supprimer cette priorité ?"))return;const p=db.priorites.find(x=>x.id===id);db.priorites=db.priorites.filter(x=>x.id!==id);logActivity("Suppression priorité",p?p.label:id);saveDB();toast("Supprimé","success");render()}

function renderAdminAlertes(view){
  const al=db.alertes||[];
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">🔔 Configuration des alertes</h1>
    <div class="flex justify-end mb-3"><button class="btn btn-primary" onclick="openAdminAlerteModal('')">➕ Nouvelle alerte</button></div>
    <div class="card p-0 overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-slate-50"><tr><th class="text-left p-3">Libellé</th><th class="text-left p-3">Type</th><th class="p-3">Seuil (j)</th><th class="text-left p-3">Canal</th><th class="text-left p-3">Destinataires</th><th class="text-center p-3">Actif</th><th class="p-3">Actions</th></tr></thead>
      <tbody>${al.map(a=>`<tr class="border-t">
        <td class="p-3 font-semibold">${escapeHTML(a.label)}</td>
        <td class="p-3"><span class="pill pill-gray">${escapeHTML(a.type)}</span></td>
        <td class="p-3 text-center">${a.seuilJours}</td>
        <td class="p-3 text-xs">${escapeHTML(a.canal)}</td>
        <td class="p-3 text-xs">${escapeHTML(a.destinataires)}</td>
        <td class="p-3 text-center"><input type="checkbox" ${a.actif?"checked":""} onchange="adminToggleAlerte('${a.id}',this.checked)" style="width:18px;height:18px;cursor:pointer"/></td>
        <td class="p-3"><button class="btn btn-ghost text-xs" onclick="openAdminAlerteModal('${a.id}')">✏</button><button class="btn btn-ghost text-xs text-red-600" onclick="adminDeleteAlerte('${a.id}')">🗑</button></td>
      </tr>`).join("")||`<tr><td class="p-6 text-center text-slate-400" colspan="7">Aucune alerte.</td></tr>`}</tbody>
    </table></div>`;
}

function openAdminAlerteModal(id){
  const isNew=!id;const a=isNew?{id:uid("al"),label:"",type:"",seuilJours:30,canal:"notification",destinataires:"rh,admin",actif:true}:db.alertes.find(x=>x.id===id);
  if(!a){toast("Introuvable","error");return}
  openModal(`<h3 class="font-bold text-lg mb-4">${isNew?"➕ Nouvelle alerte":"✏ Modifier"}</h3>
    <form onsubmit="event.preventDefault();confirmAdminAlerte('${a.id}',${isNew})">
      <label class="label">Libellé *</label><input class="input" name="label"  value="${escapeHTML(a.label)}"/>
      <div class="grid grid-2 gap-3 mt-3">
        <div><label class="label">Type (code) *</label><input class="input" name="type"  value="${escapeHTML(a.type)}"/></div>
        <div><label class="label">Seuil (jours)</label><input class="input" name="seuilJours" type="number" value="${a.seuilJours}"/></div>
        <div><label class="label">Canal</label><select class="input" name="canal"><option ${a.canal==="notification"?"selected":""}>notification</option><option ${a.canal==="email"?"selected":""}>email</option><option ${a.canal==="email+notification"?"selected":""}>email+notification</option><option ${a.canal==="sms"?"selected":""}>sms</option></select></div>
        <div><label class="label">Destinataires (rôles)</label><input class="input" name="destinataires" placeholder="rh,admin" value="${escapeHTML(a.destinataires)}"/></div>
        <div><label class="label">Statut</label><select class="input" name="actif"><option value="true" ${a.actif?"selected":""}>Actif</option><option value="false" ${!a.actif?"selected":""}>Inactif</option></select></div>
      </div>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">💾 Enregistrer</button></div>
    </form>`);
}

function confirmAdminAlerte(id,isNew){
  const f=document.querySelector(".modal-bg form");if(!f)return;const fd=new FormData(f);
  const data={id,label:fd.get("label"),type:fd.get("type"),seuilJours:Number(fd.get("seuilJours"))||0,canal:fd.get("canal"),destinataires:fd.get("destinataires"),actif:fd.get("actif")==="true"};
  if(isNew)db.alertes.push(data);else{const idx=db.alertes.findIndex(x=>x.id===id);if(idx>=0)db.alertes[idx]=data}
  logActivity(isNew?"Création alerte":"Modification alerte",data.label);
  saveDB();closeModal();toast("Enregistré","success");render();
}

function adminToggleAlerte(id,actif){const a=db.alertes.find(x=>x.id===id);if(!a)return;a.actif=actif;saveDB();logActivity("Toggle alerte",a.label+"="+actif);toast(actif?"Activée":"Désactivée","success")}

function adminDeleteAlerte(id){if(!confirm("Supprimer cette alerte ?"))return;const a=db.alertes.find(x=>x.id===id);db.alertes=db.alertes.filter(x=>x.id!==id);logActivity("Suppression alerte",a?a.label:id);saveDB();toast("Supprimé","success");render()}

function renderAdminChamps(view){
  const cf=db.customFields||[];
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">➕ Champs personnalisés</h1>
    <div class="card p-3 mb-3 bg-blue-50 border border-blue-200 text-sm text-blue-800">ℹ️ Les champs personnalisés sont stockés dans la propriété <code>custom</code> de chaque enregistrement. Ils peuvent être affichés et édités via les formulaires personnalisables.</div>
    <div class="flex justify-end mb-3"><button class="btn btn-primary" onclick="openAdminChampModal('')">➕ Nouveau champ</button></div>
    <div class="card p-0 overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-slate-50"><tr><th class="text-left p-3">Entité</th><th class="text-left p-3">Code</th><th class="text-left p-3">Libellé</th><th class="text-left p-3">Type</th><th class="text-left p-3">Options</th><th class="p-3">Actions</th></tr></thead>
      <tbody>${cf.map(c=>`<tr class="border-t">
        <td class="p-3"><span class="pill pill-gray">${escapeHTML(c.entite)}</span></td>
        <td class="p-3 font-mono">${escapeHTML(c.code)}</td>
        <td class="p-3 font-semibold">${escapeHTML(c.label)}</td>
        <td class="p-3">${escapeHTML(c.type)}</td>
        <td class="p-3 text-xs text-slate-500">${escapeHTML(c.options||"")}</td>
        <td class="p-3"><button class="btn btn-ghost text-xs" onclick="openAdminChampModal('${c.id}')">✏</button><button class="btn btn-ghost text-xs text-red-600" onclick="adminDeleteChamp('${c.id}')">🗑</button></td>
      </tr>`).join("")||`<tr><td class="p-6 text-center text-slate-400" colspan="6">Aucun champ.</td></tr>`}</tbody>
    </table></div>`;
}

function openAdminChampModal(id){
  const isNew=!id;const c=isNew?{id:uid("cf"),entite:"agents",code:"",label:"",type:"text",options:"",obligatoire:false}:db.customFields.find(x=>x.id===id);
  if(!c){toast("Introuvable","error");return}
  openModal(`<h3 class="font-bold text-lg mb-4">${isNew?"➕ Nouveau champ":"✏ Modifier"}</h3>
    <form onsubmit="event.preventDefault();confirmAdminChamp('${c.id}',${isNew})">
      <div class="grid grid-2 gap-3">
        <div><label class="label">Entité *</label><select class="input" name="entite">${ADMIN_ENTITIES.map(([k,l])=>`<option value="${k}" ${c.entite===k?"selected":""}>${l}</option>`).join("")}</select></div>
        <div><label class="label">Code (sans espace) *</label><input class="input" name="code"  value="${escapeHTML(c.code)}" pattern="[a-zA-Z0-9_]+"/></div>
        <div><label class="label">Libellé *</label><input class="input" name="label"  value="${escapeHTML(c.label)}"/></div>
        <div><label class="label">Type *</label><select class="input" name="type"><option value="text" ${c.type==="text"?"selected":""}>Texte</option><option value="number" ${c.type==="number"?"selected":""}>Nombre</option><option value="date" ${c.type==="date"?"selected":""}>Date</option><option value="select" ${c.type==="select"?"selected":""}>Liste</option><option value="textarea" ${c.type==="textarea"?"selected":""}>Texte long</option><option value="checkbox" ${c.type==="checkbox"?"selected":""}>Case à cocher</option></select></div>
      </div>
      <label class="label mt-3">Options (séparées par |, pour type "Liste")</label><input class="input" name="options" value="${escapeHTML(c.options||"")}" placeholder="option1|option2|option3"/>
      <label class="flex items-center gap-2 mt-3 text-sm"><input type="checkbox" name="obligatoire" ${c.obligatoire?"checked":""}/>Champ obligatoire</label>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">💾 Enregistrer</button></div>
    </form>`);
}

function confirmAdminChamp(id,isNew){
  const f=document.querySelector(".modal-bg form");if(!f)return;const fd=new FormData(f);
  const data={id,entite:fd.get("entite"),code:fd.get("code"),label:fd.get("label"),type:fd.get("type"),options:fd.get("options")||"",obligatoire:fd.get("obligatoire")==="on"};
  if(isNew)db.customFields.push(data);else{const idx=db.customFields.findIndex(x=>x.id===id);if(idx>=0)db.customFields[idx]=data}
  logActivity(isNew?"Création champ perso.":"Modification champ perso.",data.entite+"."+data.code);
  saveDB();closeModal();toast("Enregistré","success");render();
}

function adminDeleteChamp(id){if(!confirm("Supprimer ce champ ?"))return;const c=db.customFields.find(x=>x.id===id);db.customFields=db.customFields.filter(x=>x.id!==id);logActivity("Suppression champ perso.",c?c.code:id);saveDB();toast("Supprimé","success");render()}

function renderAdminModules(view){
  const cm=db.customModules||[];
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">🧩 Modules personnalisés</h1>
    <div class="card p-3 mb-3 bg-blue-50 border border-blue-200 text-sm text-blue-800">ℹ️ Définissez de nouveaux modules métier (ex. Formations, Sanctions, Visites médicales). Les enregistrements sont stockés dans <code>db.customRecords[code]</code>.</div>
    <div class="flex justify-end mb-3"><button class="btn btn-primary" onclick="openAdminModuleModal('')">➕ Nouveau module</button></div>
    <div class="grid grid-2 gap-3">${cm.map(m=>`<div class="card p-4" style="border-left:4px solid ${m.couleur||"#043970"}">
      <div class="flex justify-between items-start">
        <div><div class="font-bold text-lg" style="color:${m.couleur||"#043970"}"><span class="mr-2">${m.icone||"📋"}</span>${escapeHTML(m.label)}</div><div class="text-xs font-mono text-slate-500">${escapeHTML(m.code)}</div></div>
        <div class="flex gap-1"><button class="btn btn-ghost text-xs" onclick="openAdminModuleModal('${m.id}')">✏</button><button class="btn btn-ghost text-xs text-red-600" onclick="adminDeleteModule('${m.id}')">🗑</button></div>
      </div>
      <div class="text-sm text-slate-600 mt-2">${escapeHTML(m.description||"")}</div>
      <div class="text-xs text-slate-500 mt-2">${(m.champs||[]).length} champ(s) défini(s)</div>
    </div>`).join("")||`<div class="text-slate-400 text-sm col-span-2">Aucun module.</div>`}</div>`;
}

function openAdminModuleModal(id){
  const isNew=!id;const m=isNew?{id:uid("cm"),code:"",label:"",description:"",icone:"📋",couleur:"#043970",champs:[]}:db.customModules.find(x=>x.id===id);
  if(!m){toast("Introuvable","error");return}
  const champsTxt=(m.champs||[]).map(c=>c.code+":"+c.label+":"+c.type).join("\n");
  openModal(`<h3 class="font-bold text-lg mb-4">${isNew?"➕ Nouveau module":"✏ Modifier"}</h3>
    <form onsubmit="event.preventDefault();confirmAdminModule('${m.id}',${isNew})">
      <div class="grid grid-2 gap-3">
        <div><label class="label">Code (sans espace) *</label><input class="input" name="code"  value="${escapeHTML(m.code)}" pattern="[a-zA-Z0-9_]+"/></div>
        <div><label class="label">Libellé *</label><input class="input" name="label"  value="${escapeHTML(m.label)}"/></div>
        <div><label class="label">Icône (emoji)</label><input class="input" name="icone" value="${escapeHTML(m.icone)}"/></div>
        <div><label class="label">Couleur</label><input class="input" name="couleur" type="color" value="${m.couleur}"/></div>
      </div>
      <label class="label mt-3">Description</label><textarea class="input" name="description" rows="2">${escapeHTML(m.description||"")}</textarea>
      <label class="label mt-3">Champs (un par ligne, format <code>code:libellé:type</code> — types: text/number/date/select/textarea)</label>
      <textarea class="input" name="champs" rows="6" placeholder="datedebut:Date de début:date">${escapeHTML(champsTxt)}</textarea>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">💾 Enregistrer</button></div>
    </form>`);
}

function confirmAdminModule(id,isNew){
  const f=document.querySelector(".modal-bg form");if(!f)return;const fd=new FormData(f);
  const champsTxt=fd.get("champs")||"";
  const champs=champsTxt.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{const p=l.split(":");return{code:(p[0]||"").trim(),label:(p[1]||"").trim(),type:(p[2]||"text").trim()}}).filter(c=>c.code&&c.label);
  const data={id,code:fd.get("code"),label:fd.get("label"),description:fd.get("description")||"",icone:fd.get("icone")||"📋",couleur:fd.get("couleur")||"#043970",champs};
  if(isNew)db.customModules.push(data);else{const idx=db.customModules.findIndex(x=>x.id===id);if(idx>=0)db.customModules[idx]=data}
  logActivity(isNew?"Création module perso.":"Modification module perso.",data.code);
  saveDB();closeModal();toast("Enregistré","success");render();
}

function adminDeleteModule(id){if(!confirm("Supprimer ce module ?"))return;const m=db.customModules.find(x=>x.id===id);db.customModules=db.customModules.filter(x=>x.id!==id);logActivity("Suppression module perso.",m?m.code:id);saveDB();toast("Supprimé","success");render()}

function renderAdminLog(view){
  const lg=db.activityLog||[];
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">📜 Journal d'activité</h1>
    <div class="flex justify-end mb-3"><button class="btn btn-ghost" onclick="adminClearLog()">🗑 Vider le journal</button></div>
    <div class="card p-0 overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-slate-50"><tr><th class="text-left p-3">Date</th><th class="text-left p-3">Heure</th><th class="text-left p-3">Utilisateur</th><th class="text-left p-3">Action</th><th class="text-left p-3">Détails</th></tr></thead>
      <tbody>${lg.map(e=>`<tr class="border-t">
        <td class="p-3 text-xs">${formatDate(e.date)}</td>
        <td class="p-3 text-xs font-mono">${new Date(e.date).toLocaleTimeString("fr-FR")}</td>
        <td class="p-3 font-semibold">${escapeHTML(e.user)}</td>
        <td class="p-3">${escapeHTML(e.action)}</td>
        <td class="p-3 text-slate-600">${escapeHTML(e.details||"")}</td>
      </tr>`).join("")||`<tr><td class="p-6 text-center text-slate-400" colspan="5">Aucune activité enregistrée.</td></tr>`}</tbody>
    </table></div>`;
}

function adminClearLog(){if(!confirm("Vider tout le journal d'activité ?"))return;db.activityLog=[];saveDB();toast("Journal vidé","success");render()}

function renderParametres(view){if(!isAdmin()){view.innerHTML=`<div class="card p-6 text-red-700">Accès réservé à l'administrateur.</div>`;return}view.innerHTML=`<h1 class="text-2xl font-bold mb-6">⚙️ Paramètres</h1><div class="card p-6 max-w-2xl"><h2 class="text-lg font-bold mb-4">🔐 Code de déverrouillage</h2><p class="text-sm text-slate-500 mb-4">Ce code permet de déverrouiller les fiches agents.</p><div class="grid grid-2 mb-4"><div><label class="label">Code actuel</label><div class="flex gap-2"><input id="code-current" class="input" type="password" value="${escapeHTML(db.settings.unlockCode)}" readonly/><button class="btn btn-ghost text-xs" onclick="const e=document.getElementById('code-current');e.type=e.type==='password'?'text':'password'">👁</button><button class="btn btn-ghost text-xs" onclick="navigator.clipboard.writeText(db.settings.unlockCode);toast('Copié','success')">📋</button></div></div><div><label class="label">Action</label><button class="btn btn-secondary" onclick="if(confirm('Vider le code de déverrouillage ?')){db.settings.unlockCode='';saveDB();renderView();toast('Code vidé','success')}">Vider</button></div></div><form onsubmit="event.preventDefault();changeUnlockCode()"><div class="grid grid-2"><div><label class="label">Nouveau (4-32)</label><input class="input" type="password" name="c1" minlength="4" maxlength="32" /></div><div><label class="label">Confirmer</label><input class="input" type="password" name="c2" minlength="4" maxlength="32" /></div></div><button class="btn btn-primary mt-3">Mettre à jour</button></form></div><div class="mt-6 card p-5 max-w-4xl"><div class="flex justify-between mb-3"><h3>Journal (20 derniers)</h3><button class="btn btn-ghost text-xs" onclick="navigate('parametres/log')">Voir tout →</button></div><table><thead><tr><th>Date</th><th>Utilisateur</th><th>Rôle</th><th>Agent</th></tr></thead><tbody>${(db.settings.unlockLog||[]).slice(0,20).map(l=>{const a=db.agents.find(x=>x.id===l.agentId);return`<tr><td class="text-xs">${new Date(l.date).toLocaleString("fr-FR")}</td><td>${safe(l.user)}</td><td><span class="pill pill-gray">${safe(l.role)}</span></td><td><a class="text-amber-600" href="#/agents/${l.agentId}">${safe(a?a.matricule+" "+a.nom:"—")}</a></td></tr>`}).join("")||`<tr><td colspan="4" class="text-center text-slate-500">Aucun.</td></tr>`}</tbody></table></div>`}

function renderUnlockLog(view){if(!isAdmin()){view.innerHTML=`<div class="card p-6 text-red-700">Accès réservé.</div>`;return}view.innerHTML=`<div class="flex justify-between mb-4"><h1 class="text-2xl font-bold">📜 Journal</h1><button class="btn btn-danger" onclick="if(confirm('Vider ?')){db.settings.unlockLog=[];saveDB();renderView()}">🗑 Vider</button></div><div class="card overflow-hidden"><table><thead><tr><th>Date</th><th>Utilisateur</th><th>Rôle</th><th>Agent</th></tr></thead><tbody>${(db.settings.unlockLog||[]).map(l=>{const a=db.agents.find(x=>x.id===l.agentId);return`<tr><td class="text-xs">${new Date(l.date).toLocaleString("fr-FR")}</td><td>${safe(l.user)}</td><td>${safe(l.role)}</td><td><a class="text-amber-600" href="#/agents/${l.agentId}">${safe(a?a.matricule+" "+a.nom:"—")}</a></td></tr>`}).join("")||`<tr><td colspan="4" class="text-center text-slate-500 p-6">Aucun.</td></tr>`}</tbody></table></div>`}

function changeUnlockCode(){const f=event.target;if(f.c1.value!==f.c2.value){toast("Les codes diffèrent","error");return}db.settings.unlockCode=f.c1.value;saveDB();toast("Code mis à jour","success");renderView()}

function setAdminActiveSociete(value){
  if(session?.societe){
    sessionStorage.setItem(ADMIN_ACTIVE_SOCIETE_KEY,session.societe);
    storeCurrentStructureSocieteFilter(session.societe);
    renderView();
    return;
  }
  const s=SOCIETES.includes(value)?value:"";
  if(s)sessionStorage.setItem(ADMIN_ACTIVE_SOCIETE_KEY,s);else sessionStorage.removeItem(ADMIN_ACTIVE_SOCIETE_KEY);
  if(typeof setCurrentStructureSocieteFilter==="function")setCurrentStructureSocieteFilter(s);
  renderView();
}

function adminSocieteSelectorHTML(context){
  const selected=adminActiveSociete();
  const locked=!!session?.societe;
  return `<div class="card p-3 mb-4" style="border-left:4px solid #043970;background:#f8fafc">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div><div class="text-xs font-black uppercase tracking-widest text-slate-500">${locked?"Société active":"Société de configuration"}</div><div class="font-black" style="color:#043970">${escapeHTML(selected||"Toutes les sociétés")}</div><div class="text-xs text-slate-500">${escapeHTML(context||"Les créations et filtres d'administration suivent cette société.")}</div></div>
      ${locked?`<div class="pill pill-blue">Périmètre verrouillé</div>`:`<div class="flex items-end gap-2 flex-wrap">
        <div><label class="label">Sélectionner société</label><select class="select" onchange="setAdminActiveSociete(this.value)"><option value="" ${!selected?"selected":""}>Toutes les sociétés</option>${SOCIETES.map(s=>`<option value="${escapeHTML(s)}" ${selected===s?"selected":""}>${escapeHTML(s)}</option>`).join("")}</select></div>
        ${selected?`<button class="btn btn-ghost text-sm" onclick="setAdminActiveSociete('')">Vue globale</button>`:""}
      </div>`}
    </div>
  </div>`;
}

function adminMatchesSociete(item){
  const s=adminActiveSociete();
  if(!s)return true;
  if(!item)return false;
  const itemSoc=item.societe||item.society||item.company||item.societeRattachement||"";
  if(itemSoc&&normalizeSocieteName(itemSoc)===normalizeSocieteName(s))return true;
  if(adminItemAssignedToSociete(item,s))return true;
  if(itemSoc)return false;
  if(Array.isArray(item.societesAutorisees))return !item.societesAutorisees.length||item.societesAutorisees.includes(s);
  if(Array.isArray(item.authorized_societies))return !item.authorized_societies.length||item.authorized_societies.includes(s);
  return true;
}

function adminSocieteLabel(value){return value&&SOCIETES.includes(value)?value:"Global"}

function renderAdminMagasins(view){
  if(!isAdminSystemSession()){view.innerHTML=`<div class="card p-6 text-red-700 font-bold">Accès refusé.</div>`;return}
  const adminSoc=adminActiveSociete();
  const magasins=(db.magasins||[]).filter(adminDataMatchesSociete).slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||""));
  const totalArticles=(db.stockArticles||[]).filter(adminDataMatchesSociete).length;
  const attachedArticles=(db.stockArticles||[]).filter(a=>adminDataMatchesSociete(a)&&String(a.magasinId||"").trim()).length;
  view.innerHTML=`<div class="mb-5"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Magasins</h1><p class="text-sm text-slate-500 mt-1">La suppression des magasins est centralisée ici uniquement. Dans Matériel, les magasins restent consultables et modifiables sans bouton supprimer.</p></div>
  ${adminSocieteSelectorHTML(adminSoc?"Magasins filtrés pour cette société.":"Vue globale des magasins. Sélectionnez une société pour filtrer.")}
  <div class="grid grid-3 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Magasins</div><div class="text-3xl font-black" style="color:#043970">${magasins.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Articles rattachés</div><div class="text-3xl font-black text-emerald-700">${attachedArticles}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Articles catalogue</div><div class="text-3xl font-black text-amber-700">${totalArticles}</div></div>
  </div>
  ${magasins.length?`<div class="card p-3 mb-4 flex items-center justify-between gap-3 flex-wrap" style="background:#fff7ed;border-color:#fed7aa">
    <label class="flex items-center gap-2 text-sm font-black text-slate-700"><input type="checkbox" onchange="adminToggleAllMagasinsDelete(this.checked)" style="width:16px;height:16px"/> Tout sélectionner (${magasins.length})</label>
    <button type="button" id="admin-magasins-delete-selected-btn" class="btn btn-danger text-xs" data-critical-auth="1" onclick="adminDeleteSelectedMagasins()" disabled>Supprimer sélection</button>
  </div>`:""}
  <div class="card overflow-x-auto">
    ${magasins.length===0?`<div class="p-10 text-center text-slate-500">Aucun magasin.</div>`:`<table class="w-full text-sm"><thead style="background:#043970"><tr><th class="p-3 text-center" style="width:44px"></th><th class="p-3 text-left">Magasin</th><th class="p-3 text-left">Société</th><th class="p-3 text-left">Responsable</th><th class="p-3 text-center">Articles</th><th class="p-3 text-center">Unités</th><th class="p-3 text-right">Actions</th></tr></thead><tbody>${magasins.map(m=>{const st=matSimpleStockMagasin(m.id);return`<tr class="border-t hover:bg-slate-50"><td class="p-3 text-center"><input type="checkbox" data-admin-magasin-delete-id="${escapeHTML(m.id)}" onchange="adminRefreshMagasinsBulkButton()" style="width:16px;height:16px"/></td><td class="p-3"><div class="font-black">${escapeHTML(m.nom||"—")}</div><div class="text-xs text-slate-500 font-mono">${escapeHTML(m.code||"")}</div></td><td class="p-3 text-xs">${escapeHTML(m.societe||"Toutes")}</td><td class="p-3 text-xs">${escapeHTML(m.responsable||"—")}</td><td class="p-3 text-center font-black">${st.nb}</td><td class="p-3 text-center font-black text-emerald-700">${qty(st.qty)}</td><td class="p-3 text-right"><div class="flex gap-2 justify-end flex-wrap"><button class="btn btn-ghost text-xs" onclick="navigate('materiel/magasin/${m.id}')">Ouvrir</button><button class="btn btn-danger text-xs" data-critical-auth="1" onclick="matSimpleDeleteMagasin('${m.id}')">Supprimer</button></div></td></tr>`}).join("")}</tbody></table>`}
  </div>`;
}

async function renderAdminCatalogue(view){
  if(!isAdminSystemSession()){view.innerHTML=`<div class="card p-6 text-red-700 font-bold">Accès refusé.</div>`;return}
  sgdiShowDataLoadingBar("Chargement des articles...");
  try{await refreshStockArticlesFromPostgres()}catch(e){console.warn("Articles PostgreSQL non rechargés pour administration",e)}
  const adminSoc=adminActiveSociete();
  const articles=(db.stockArticles||[]).filter(adminDataMatchesSociete).slice().sort((a,b)=>(a.designation||"").localeCompare(b.designation||""));
  const totalQty=articles.reduce((sum,a)=>sum+(stockGetActuel?stockGetActuel(a.id):(parseFloat(a.stockInitial)||0)),0);
  const totalValue=articles.reduce((sum,a)=>sum+(stockGetActuel?stockGetActuel(a.id):(parseFloat(a.stockInitial)||0))*(parseFloat(a.prixUnitaire)||0),0);
  view.innerHTML=`<div class="mb-5"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Articles</h1><p class="text-sm text-slate-500 mt-1">La suppression des articles est centralisée ici uniquement. Dans Matériel, les articles restent consultables et modifiables sans bouton supprimer.</p></div>
  ${adminSocieteSelectorHTML(adminSoc?"Articles filtrés pour cette société.":"Vue globale des articles. Sélectionnez une société pour filtrer.")}
  <div class="grid grid-3 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Articles catalogue</div><div class="text-3xl font-black" style="color:#043970">${articles.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Unités stock</div><div class="text-3xl font-black text-emerald-700">${qty(totalQty)}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Valeur stock</div><div class="text-3xl font-black text-amber-700">${money(totalValue)}</div></div>
  </div>
  ${articles.length?`<div class="card p-3 mb-4 flex items-center justify-between gap-3 flex-wrap" style="background:#fff7ed;border-color:#fed7aa">
    <label class="flex items-center gap-2 text-sm font-black text-slate-700"><input type="checkbox" onchange="adminToggleAllCatalogueDelete(this.checked)" style="width:16px;height:16px"/> Tout sélectionner (${articles.length})</label>
    <button type="button" id="admin-catalogue-delete-selected-btn" class="btn btn-danger text-xs" data-critical-auth="1" onclick="adminDeleteSelectedCatalogueArticles()" disabled>Supprimer sélection</button>
  </div>`:""}
  <div class="card overflow-x-auto">
    ${articles.length===0?`<div class="p-10 text-center text-slate-500">Aucun article.</div>`:`<table class="w-full text-sm"><thead style="background:#043970"><tr><th class="p-3 text-center" style="width:44px"></th><th class="p-3 text-left">Code</th><th class="p-3 text-left">Désignation</th><th class="p-3 text-left">Catégorie</th><th class="p-3 text-left">Magasin</th><th class="p-3 text-center">Stock</th><th class="p-3 text-right">P.U.</th><th class="p-3 text-right">Actions</th></tr></thead><tbody>${articles.map(a=>{const q=stockGetActuel?stockGetActuel(a.id):(parseFloat(a.stockInitial)||0);const mag=(db.magasins||[]).find(m=>String(m.id)===String(a.magasinId)||String(m.backendId||"")===String(a.magasinId));return`<tr class="border-t hover:bg-slate-50"><td class="p-3 text-center"><input type="checkbox" data-admin-catalogue-delete-id="${escapeHTML(a.id)}" onchange="adminRefreshCatalogueBulkButton()" style="width:16px;height:16px"/></td><td class="p-3 font-mono text-xs">${escapeHTML(a.code||"—")}</td><td class="p-3"><div class="font-black">${escapeHTML(a.designation||"—")}</div><div class="text-xs text-slate-500">${escapeHTML([a.marque,a.modele].filter(Boolean).join(" · "))}</div></td><td class="p-3 text-xs">${escapeHTML(a.categorie||"—")}</td><td class="p-3 text-xs">${escapeHTML(mag?.nom||"—")}</td><td class="p-3 text-center font-black text-emerald-700">${qty(q)}</td><td class="p-3 text-right text-xs font-bold">${money(a.prixUnitaire)}</td><td class="p-3 text-right"><div class="flex gap-2 justify-end flex-wrap"><button class="btn btn-ghost text-xs" onclick="navigate('materiel/article/${a.id}')">Ouvrir</button><button class="btn btn-danger text-xs" data-critical-auth="1" onclick="stockDeleteArticle('${a.id}')">Supprimer</button></div></td></tr>`}).join("")}</tbody></table>`}
  </div>`;
}
SGDIModules.registerModule({key:"administration-settings",routes:[]});
