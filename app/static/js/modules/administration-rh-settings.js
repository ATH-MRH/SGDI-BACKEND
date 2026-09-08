/* Administration rh-settings : fonctions historiques, règles inchangées. */
function findDuplicateMatricules(){
  const groups=new Map();
  (db.agents||[]).forEach(a=>{
    const code=normalizeEmployeeCodeFormat(a.matricule||a.code||"");
    if(!code)return;
    if(!groups.has(code))groups.set(code,[]);
    groups.get(code).push(a);
  });
  return [...groups.entries()].filter(([,list])=>list.length>1).map(([code,list])=>({code,agents:list.sort((a,b)=>(+a.backendId||99999)-(+b.backendId||99999))}));
}

function openDuplicateMatriculesModal(){
  const dups=findDuplicateMatricules();
  if(!dups.length){toast("Aucun doublon de code détecté","success");return}
  const rowHTML=a=>`<div class="flex items-center gap-2 text-xs py-1"><span class="font-mono font-black text-amber-700 w-10">${escapeHTML(a.matricule||a.code||"—")}</span><span class="font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</span><span class="text-slate-400">· ${escapeHTML(a.societe||"—")} · id:${escapeHTML(String(a.backendId||a.id||"—"))}</span></div>`;
  const groupHTML=({code,agents})=>`<div class="card p-4 mb-3" style="border-left:4px solid #dc2626"><div class="flex items-center justify-between gap-2 mb-2"><div class="font-black text-sm">Code <span class="font-mono text-red-700">${escapeHTML(code)}</span> — ${agents.length} employés</div><button type="button" class="btn btn-secondary text-xs" onclick="fixDuplicateMatriculeGroup('${escapeHTML(code)}')">Corriger</button></div><div class="text-xs text-slate-500 mb-1">✓ Conservé (le plus ancien) :</div>${rowHTML(agents[0])}<div class="text-xs text-slate-500 mt-2 mb-1">⚠ Nouveau code attribué :</div>${agents.slice(1).map(rowHTML).join("")}</div>`;
  openModal(`<h3 class="font-bold text-lg mb-1">Doublons de codes employés</h3><p class="text-sm text-slate-500 mb-4">${dups.length} code(s) partagé(s) entre plusieurs employés. Le premier employé (backendId le plus bas) conserve son code. Les suivants reçoivent un nouveau code unique — la correction est enregistrée en PostgreSQL.</p>${dups.map(groupHTML).join("")}<div class="flex gap-2 justify-end mt-4 flex-wrap"><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button><button type="button" class="btn btn-danger" onclick="fixAllDuplicateMatricules(this)">Tout corriger automatiquement</button></div>`);
}

async function fixDuplicateMatriculeGroup(code){
  const dups=findDuplicateMatricules();
  const group=dups.find(d=>d.code===code);
  if(!group){toast("Groupe introuvable","error");return}
  await _applyDuplicateFixes([group]);
}

async function fixAllDuplicateMatricules(btn){
  if(btn){btn.disabled=true;btn.textContent="Correction en cours…"}
  const dups=findDuplicateMatricules();
  await _applyDuplicateFixes(dups);
  closeModal();
}

async function _applyDuplicateFixes(groups){
  let fixed=0,errors=0;
  for(const {agents} of groups){
    for(const a of agents.slice(1)){
      if(!a.backendId){
        // Local-only phantom entry — remove from cache without backend call
        db.agents=(db.agents||[]).filter(x=>x!==a);
        fixed++;
        continue;
      }
      const newCode=nextMatricule(db.agents,a.societe);
      const prev=a.matricule;
      a.matricule=newCode;a.code=newCode;
      try{
        await SGDI.employees.update(a.backendId,employeeApiPayload(a));
        fixed++;
      }catch(e){
        a.matricule=prev;a.code=prev;
        errors++;
        console.warn("Correction doublon échouée",a,e);
      }
    }
  }
  // Pull fresh PostgreSQL data to confirm changes and clear stale blob state
  try{await sgdiPullEmployees({silent:true})}catch(e){}
  try{await saveDBAndWait()}catch(e){errors++}
  const msg=errors
    ?`${fixed} code(s) corrigé(s) · ${errors} erreur(s) — vérifiez les droits d'accès`
    :`${fixed} code(s) corrigé(s) avec succès`;
  toast(msg,errors?"error":"success");
  renderView();
}

function adminEffectifTextList(value){return (Array.isArray(value)?value:[]).join("\n")}

function adminEffectifParseList(value){return String(value||"").split(/\n|,/).map(x=>x.trim()).filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i)}

function renderAdminEffectifsConfig(view){
  const cfg=effectifConfigSettings();
  const agents=db.agents||[];
  const operational=agents.filter(agentIsOperational).length;
  const sansDotation=agents.filter(agentNeedsDotation).length;
  const sansAffectation=agents.filter(agentNeedsAffectation).length;
  const toggle=(name,label,sub)=>`<label class="flex items-start gap-3 p-3 rounded-lg" style="background:#fff;border:1px solid #dbe3ef"><input type="checkbox" name="${name}" ${cfg[name]?"checked":""} style="width:18px;height:18px;margin-top:2px"/><span><b>${label}</b><br/><small class="text-slate-500">${sub}</small></span></label>`;
  view.innerHTML=`<div class="mb-5 flex items-start justify-between gap-3 flex-wrap"><div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Gestion des effectifs</h1><p class="text-sm text-slate-500 mt-1">Panneau de configuration ERP des règles RH, OPS et Matériel liées aux effectifs.</p></div><button type="button" class="btn btn-danger text-xs" onclick="navigate('admin/fiches')">Supprimer des employés</button></div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Opérationnels</div><div class="text-3xl font-black text-emerald-700">${operational}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Sans dotation</div><div class="text-3xl font-black text-sky-700">${sansDotation}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Sans affectation</div><div class="text-3xl font-black text-amber-700">${sansAffectation}</div></div>
  </div>
  <form onsubmit="event.preventDefault();saveAdminEffectifsConfig(this)">
    <section class="card p-5 mb-4"><h2 class="font-black text-lg mb-3">Préparation opérationnelle</h2><div class="mb-3 text-sm font-semibold text-slate-600">Le compteur EFF. OPÉRATIONNEL correspond à l'ensemble des employés de la société sélectionnée, tous postes confondus, hors employés sortants. Les options ci-dessous pilotent les compteurs de préparation.</div><div class="grid grid-cols-1 md:grid-cols-2 gap-3">${toggle("operationalRequiresDotation","Compter les employés sans dotation","Affiche le compteur de préparation pour les dotations matérielles manquantes.")}${toggle("operationalRequiresAffectation","Compter les employés sans affectation","Affiche le compteur de préparation pour les affectations manquantes.")}${toggle("showPreparationCounters","Afficher les compteurs de préparation","Affiche sans dotation et sans affectation dans la barre fixe.")}</div></section>
    <section class="card p-5 mb-4"><h2 class="font-black text-lg mb-3">Sécurité et archivage</h2><div class="grid grid-cols-1 md:grid-cols-2 gap-3">${toggle("lockValidatedSections","Verrouiller les sections validées","Une section validée reste protégée sauf intervention autorisée.")}${toggle("archiveDocumentsByEmployee","Archiver les documents par employé","Les décisions, contrats et documents générés restent liés au dossier de l'employé.")}</div></section>
    <section class="card p-5 mb-4"><h2 class="font-black text-lg mb-3">Actions et statuts</h2><div class="grid grid-cols-1 md:grid-cols-3 gap-3"><div><label class="label">Actions DRH</label><textarea class="input" name="drhActions" rows="8">${escapeHTML(adminEffectifTextList(cfg.drhActions))}</textarea></div><div><label class="label">Actions OPS</label><textarea class="input" name="opsActions" rows="8">${escapeHTML(adminEffectifTextList(cfg.opsActions))}</textarea></div><div><label class="label">Statuts effectif</label><textarea class="input" name="statuses" rows="8">${escapeHTML(adminEffectifTextList(cfg.statuses))}</textarea></div></div><div class="text-xs text-slate-500 mt-2">Une valeur par ligne. Les routes et traitements existants restent protégés.</div></section>
    <div class="sticky bottom-0 mt-5 p-3 flex justify-end gap-2" style="background:#ffffffcc;backdrop-filter:blur(8px);border-top:1px solid #e2e8f0"><button type="button" class="btn btn-ghost" onclick="renderView()">Annuler</button><button class="btn btn-primary">Enregistrer la configuration</button></div>
  </form>`;
}

function saveAdminEffectifsConfig(form){
  const prev=effectifConfigSettings();
  db.settings.effectifConfig={...prev,operationalRequiresDotation:!!form.operationalRequiresDotation.checked,operationalRequiresAffectation:!!form.operationalRequiresAffectation.checked,operationalRequiresPvInstallation:!!form.operationalRequiresPvInstallation.checked,showPreparationCounters:!!form.showPreparationCounters.checked,lockValidatedSections:!!form.lockValidatedSections.checked,archiveDocumentsByEmployee:!!form.archiveDocumentsByEmployee.checked,drhActions:adminEffectifParseList(form.drhActions.value),opsActions:adminEffectifParseList(form.opsActions.value),statuses:adminEffectifParseList(form.statuses.value),updatedAt:new Date().toISOString(),updatedBy:session?.username||""};
  logActivity("Configuration gestion effectifs","Règles opérationnelles mises à jour");
  saveDB();
  toast("Configuration gestion des effectifs enregistrée","success");
  refreshModuleCountersRibbon();
  renderView();
}

function adminFicheSearchText(v){
  return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
}

function adminFicheMatchesSearch(a,q){
  if(!q)return true;
  const aff=a?.affectationCourante||{};
  const fullName1=`${a?.nom||""} ${a?.prenom||""}`;
  const fullName2=`${a?.prenom||""} ${a?.nom||""}`;
  return adminFicheSearchText([
    a?.matricule,a?.code,a?.backendId,a?.nom,a?.prenom,fullName1,fullName2,
    a?.societe,aff.siteName,aff.site,aff.poste,a?.fonction,a?.position,
    a?.posteContrat,a?.typeContrat,a?.statut,a?.telephone,a?.tel,a?.email
  ].join(" ")).includes(q);
}

function adminFicheSearchInput(input){
  const value=input?.value||"";
  sessionStorage.setItem("adminFicheSearch",value);
  sessionStorage.setItem("adminFicheSearchActive","1");
  sessionStorage.setItem("adminFicheSearchCursor",String(input?.selectionStart??value.length));
  clearTimeout(adminFicheSearchTimer);
  adminFicheSearchTimer=setTimeout(()=>renderView(),120);
}

function adminFicheSearchReset(){
  sessionStorage.removeItem("adminFicheSearch");
  sessionStorage.removeItem("adminFicheSearchActive");
  sessionStorage.removeItem("adminFicheSearchCursor");
  renderView();
}

function adminFicheSearchRestore(){
  if(sessionStorage.getItem("adminFicheSearchActive")!=="1")return;
  const input=document.getElementById("admin-fiche-search-input");
  if(!input)return;
  input.focus();
  const pos=Math.min(Number(sessionStorage.getItem("adminFicheSearchCursor")||input.value.length),input.value.length);
  try{input.setSelectionRange(pos,pos)}catch(e){}
}

function renderAdminFichesPosition(view,_skipEnsure){
  // Vue unique : elle exploite directement les employés, affectations et contrats déjà
  // synchronisés depuis PostgreSQL. Aucune copie de fiche n'est créée.
  return renderFiches(view,"",_skipEnsure);
  const adminSoc=adminActiveSociete();
  // Pas de force:true ici, même raison que renderFiches : voir plus haut (commit a1690b88).
  if(!_skipEnsure&&typeof sgdiEnsureEmployeesForDisplay==="function"){const _r=sgdiEnsureEmployeesForDisplay({society:adminSoc||""});if(_r&&typeof _r.then==="function"){view.innerHTML=`<div class="p-8 text-center text-slate-400 text-sm">Chargement des effectifs…</div>`;_r.then(()=>renderAdminFichesPosition(view,true)).catch(()=>renderAdminFichesPosition(view,true));return}}
  const rawQ=String(sessionStorage.getItem("adminFicheSearch")||"");
  const q=adminFicheSearchText(rawQ);
  const allAgents=db.agents||[];
  const baseAgents=allAgents.filter(adminMatchesSociete);
  const agents=baseAgents.filter(a=>adminFicheMatchesSearch(a,q));
  const _empCounters=typeof sgdiUnifiedEmployeeCounters==="function"?sgdiUnifiedEmployeeCounters(adminSoc||""):null;
  const totalDb=counterNumericValue(_empCounters?.total||_empCounters?.active||_empCounters?.activeHeadcount)||(adminSoc?baseAgents.length:allAgents.length);
  const locked=agents.filter(a=>a.locked||a.fichePositionOfficielle).length;
  const otherSocieties=adminSoc&&baseAgents.length===0&&allAgents.length>0
    ?[...new Set(allAgents.map(a=>a.societe||a.society||"").filter(Boolean))].sort()
    :[];
  view.innerHTML=`<div class="mb-5"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Fiche de position</h1><p class="text-sm text-slate-500 mt-1">Toutes les fiches sont verrouillées dans RH, OPS, Matériel et les autres modules. Les modifications et suppressions se font uniquement ici.</p></div>
  ${adminSocieteSelectorHTML(adminSoc?"Les fiches affichées et les actions de configuration concernent cette société.":"Vue globale des fiches. Sélectionnez une société pour travailler dans son périmètre.")}
  <div class="grid grid-4 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Total DB</div><div class="text-3xl font-black text-slate-400">${totalDb}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Fiches</div><div class="text-3xl font-black" style="color:#043970">${baseAgents.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Verrouillées</div><div class="text-3xl font-black text-emerald-700">${locked}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Affichées</div><div class="text-3xl font-black text-amber-700">${agents.length}</div></div>
  </div>
  ${otherSocieties.length?`<div class="card p-4 mb-4" style="background:#fef3c7;border-left:4px solid #f59e0b"><div class="font-black text-amber-800 mb-1">⚠ Aucun employé pour « ${escapeHTML(adminSoc)} »</div><div class="text-sm text-amber-700">Les ${allAgents.length} employés présents dans la base appartiennent à : <b>${otherSocieties.map(escapeHTML).join(", ")}</b></div><div class="mt-2"><button class="btn btn-ghost text-xs" onclick="setAdminActiveSociete('')">Voir toutes les sociétés</button></div></div>`:""}
  <div class="card p-4 mb-4"><div class="grid grid-4 gap-3 items-end">
    <div><label class="label">Société</label><select class="select" onchange="setAdminActiveSociete(this.value)"><option value="" ${!adminSoc?"selected":""}>Toutes les sociétés</option>${SOCIETES.map(s=>`<option value="${escapeHTML(s)}" ${normalizeSocieteName(adminSoc)===normalizeSocieteName(s)?"selected":""}>${escapeHTML(s)}</option>`).join("")}</select></div>
    <div class="col-span-2"><label class="label">Recherche</label><input id="admin-fiche-search-input" class="input" value="${escapeHTML(rawQ)}" placeholder="Nom, prénom, code, matricule, société, site..." oninput="adminFicheSearchInput(this)"/></div>
    <button class="btn btn-ghost" onclick="adminFicheSearchReset()">Réinitialiser</button>
  </div></div>
  ${agents.length?`<div class="card p-3 mb-4 flex items-center justify-between gap-3 flex-wrap" style="background:#fff7ed;border-color:#fed7aa">
    <label class="flex items-center gap-2 text-sm font-black text-slate-700"><input type="checkbox" onchange="adminToggleAllFichesPosition(this.checked)" style="width:16px;height:16px"/> Tout sélectionner (${agents.length})</label>
    <button type="button" id="admin-fiches-delete-all-btn" class="btn btn-danger text-xs" data-no-critical-auth="1" onclick="adminDeleteSelectedFichesPosition()" disabled>Supprimer tout</button>
  </div>`:""}
  <div class="card overflow-hidden">${agents.length?`<table><thead><tr><th style="width:42px;text-align:center"><input type="checkbox" onchange="adminToggleAllFichesPosition(this.checked)" style="width:16px;height:16px"/></th><th>Code</th><th>Employé</th><th>Société</th><th>Fin contrat</th><th>Statut</th><th></th></tr></thead><tbody>${agents.map(a=>`<tr data-searchable><td class="text-center"><input type="checkbox" class="admin-fiche-select" value="${escapeHTML(a.id||"")}" data-backend-id="${escapeHTML(a.backendId||"")}" data-label="${escapeHTML([a.matricule||"",((a.nom||"")+" "+(a.prenom||"")).trim()].filter(Boolean).join(" · "))}" onchange="adminUpdateDeleteFichesButton()" style="width:16px;height:16px"/></td><td class="font-mono font-bold text-amber-700">${safe(a.matricule)}</td><td><div class="font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</div><div class="text-xs text-slate-500">${safe(a.fonction||a.position||a.posteContrat)}</div></td><td class="text-xs">${safe(a.societe)}</td><td class="text-xs font-semibold">${employeePositionContractEndPillHTML(a)}</td><td><span class="pill ${a.locked||a.fichePositionOfficielle?"pill-green":"pill-amber"}">${a.locked||a.fichePositionOfficielle?"Verrouillée":"A verrouiller"}</span></td><td class="text-right"><div class="flex gap-1 justify-end flex-wrap"><button class="btn btn-secondary text-xs" onclick="openAdminEmployeeContractModal('${employeeRouteId(a)}')">Ajouter / modifier contrat</button><button class="btn btn-primary text-xs" onclick="navigate('admin/fiches/${employeeRouteId(a)}')">Ouvrir / modifier</button></div></td></tr>`).join("")}</tbody></table>`:`<div class="p-10 text-center text-slate-500">Aucune fiche trouvée.</div>`}</div>`;
  setTimeout(adminFicheSearchRestore,0);
}

function adminSelectedFichesPosition(){
  return [...document.querySelectorAll(".admin-fiche-select:checked")].map(input=>{
    const id=String(input.value||"");
    const backendId=String(input.dataset.backendId||"");
    const a=(db.agents||[]).find(x=>(id&&String(x.id||"")===id)||(backendId&&String(x.backendId||"")===backendId));
    return a||null;
  }).filter(Boolean);
}

function adminUpdateDeleteFichesButton(){
  const selected=adminSelectedFichesPosition();
  const btn=document.getElementById("admin-fiches-delete-all-btn");
  if(btn){btn.disabled=!selected.length;btn.textContent=selected.length?`Supprimer tout (${selected.length})`:"Supprimer tout"}
  const all=[...document.querySelectorAll(".admin-fiche-select")];
  const checked=all.filter(x=>x.checked).length;
  document.querySelectorAll('input[type="checkbox"]').forEach(input=>{
    if(input.classList.contains("admin-fiche-select"))return;
    if(input.getAttribute("onchange")!=="adminToggleAllFichesPosition(this.checked)")return;
    input.checked=!!all.length&&checked===all.length;
    input.indeterminate=checked>0&&checked<all.length;
  });
}

function adminToggleAllFichesPosition(checked){
  document.querySelectorAll(".admin-fiche-select").forEach(input=>{input.checked=!!checked});
  adminUpdateDeleteFichesButton();
}

async function adminDeleteSelectedFichesPosition(){
  if(!isAdminFichePositionContext()){toast("Suppression réservée à Administration système > Fiche de position","error");return}
  const agents=adminSelectedFichesPosition();
  if(!agents.length){toast("Cochez au moins une fiche à supprimer","error");return}
  const missingSql=agents.filter(a=>!effectifEmployeeSqlId(a));
  if(missingSql.length){toast("Suppression refusée : "+missingSql.length+" fiche(s) sans identifiant SQL","error");return}
  const linked=agents.flatMap(a=>agentDeleteLinkedRows(a));
  const byCollection=linked.reduce((acc,x)=>{acc[x.collection]=(acc[x.collection]||0)+1;return acc},{});
  const details=Object.entries(byCollection).map(([k,v])=>`${k}: ${v}`).join("\n");
  const sample=agents.slice(0,8).map(a=>((a.matricule?`${a.matricule} · `:"")+(a.nom||"")+" "+(a.prenom||"")).trim()).join("\n");
  const more=agents.length>8?`\n... +${agents.length-8} autre(s)`:"";
  const linkedText=linked.length?`\n\nÉléments liés à supprimer :\n${details}`:"";
  if(!confirm(`Supprimer définitivement ${agents.length} fiche(s) ?\n\n${sample}${more}${linkedText}\n\nCette action est irréversible.`))return;
  const btn=document.getElementById("admin-fiches-delete-all-btn");
  if(btn){btn.disabled=true;btn.textContent="Suppression..."}
  let alreadyMissing=0;
  try{
    for(const a of agents){
      const deleted=await deleteAgentBackend(a);
      if(deleted===false)alreadyMissing++;
    }
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent=`Supprimer tout (${agents.length})`}
    toast("Suppression interrompue : "+(e.message||e),"error");
    return;
  }
  agents.forEach(agentDeleteLocalCleanup);
  saveUnlocked();
  if(!(await saveDBAndWaitToast("Suppression des fiches non confirmée")))return;
  try{await sgdiPullState({silent:true,render:false,force:true,light:true})}catch(_e){}
  toast(`${agents.length} fiche(s) supprimée(s)${alreadyMissing?` · ${alreadyMissing} déjà absente(s) PostgreSQL`:""}`,"success");
  renderView();
}

function renderAdminCandidatSections(view){
  if(!db.settings)db.settings={};
  const validated=(db.candidats||[]).filter(c=>candidatAllSectionsValid(c)).length;
  const inReserve=(db.candidats||[]).filter(c=>candidatIsReserve(c)).length;
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">✅ Validation des sections candidat</h1>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
      <div class="card p-4"><div class="text-xs text-slate-500">Sections de la fiche</div><div class="text-3xl font-black text-emerald-700">${CANDIDAT_SECTIONS.length}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Fiches toutes sections validées</div><div class="text-3xl font-black text-sky-700">${validated}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Fiches de position validées</div><div class="text-3xl font-black text-amber-700">${inReserve}</div></div>
    </div>
    <div class="card p-5 mb-4">
      <h3 class="font-bold mb-3">Déverrouillage strict</h3>
      <p class="text-sm text-slate-500 mb-4">Une section validée est définitivement bloquée pour tous les utilisateurs. Seul le niveau ADM1 peut la déverrouiller ou la modifier.</p>
      <div class="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-sm text-emerald-800 font-bold">Niveau autorisé : ADM1</div>
      <button class="btn btn-primary mt-4" onclick="saveAdminCandidatSectionSettings()">Appliquer la règle ADM1</button>
    </div>
    <div class="card p-5">
      <h3 class="font-bold mb-3">Ordre obligatoire des validations</h3>
      <table class="w-full text-sm">
        <thead class="bg-slate-50"><tr><th class="text-left p-3">Ordre</th><th class="text-left p-3">Section</th><th class="text-left p-3">Comportement</th></tr></thead>
        <tbody>${CANDIDAT_SECTIONS.map((s,i)=>`<tr class="border-t"><td class="p-3 font-mono">${i+1}</td><td class="p-3 font-semibold">${escapeHTML(s.label)}</td><td class="p-3 text-slate-600">${i===0?"Première section ouverte":"Ouverture automatique après validation de la section "+i}</td></tr>`).join("")}</tbody>
      </table>
      <div class="text-xs text-slate-500 mt-3">Le candidat n'est envoyé en réserve qu'après validation finale de la fiche de position.</div>
    </div>`;
}

function saveAdminCandidatSectionSettings(){
  if(!db.settings)db.settings={};
  db.settings.candidatSectionUnlockRoles=["ADM1"];
  saveDB();logActivity("Habilitation sections candidat","ADM1 uniquement");toast("Règle appliquée : seul ADM1 peut déverrouiller","success");renderView();
}

function adminDocTemplateFileHTML(t){return t?.file?.data?`<button type="button" class="btn btn-secondary text-xs" onclick="viewDoc('${t.file.data}','${escapeHTML(t.file.name||"modèle")}')">Voir fichier</button>`:`<span class="text-xs text-slate-400">Aucun fichier</span>`}

function renderAdminDocumentModels(view){
  const adminSoc=adminActiveSociete();
  const rows=ensureAdminDocumentTemplates().filter(t=>!adminSoc||!t.societe||t.societe===adminSoc);
  const active=rows.filter(t=>t.active!==false).length;
  const modules=new Set(rows.map(t=>t.module||"global")).size;
  view.innerHTML=`<div class="mb-4"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Modèles documents</h1><p class="text-sm text-slate-500 mt-1">Bibliothèque centrale des modèles rattachés aux actions RH, OPS, Matériel et aux autres modules.</p></div>
    ${adminSocieteSelectorHTML(adminSoc?"Les nouveaux modèles seront rattachés à cette société. Les modèles globaux restent visibles.":"Les nouveaux modèles seront globaux. Sélectionnez une société pour créer un modèle dédié.")}
    <div class="card p-3 mb-3 bg-blue-50 border border-blue-200 text-sm text-blue-800"><b>Variables disponibles :</b> {{nom_complet}}, {{nom}}, {{prenom}}, {{matricule}}, {{societe}}, {{fonction}}, {{site}}, {{date_recrutement}}, {{date_document}}, {{reference}}, {{periode}}, {{montant}}, {{mentions}}.</div>
    <div class="grid grid-4 gap-3 mb-4">
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Modèles</div><div class="text-3xl font-black" style="color:#043970">${rows.length}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Actifs</div><div class="text-3xl font-black text-emerald-700">${active}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Modules</div><div class="text-3xl font-black text-blue-700">${modules}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Actions rattachées</div><div class="text-3xl font-black text-amber-700">${new Set(rows.map(t=>t.action||"global")).size}</div></div>
    </div>
    <div class="flex justify-end mb-3"><button class="btn btn-primary" onclick="openAdminDocumentTemplateModal('')">＋ Ajouter modèle document</button></div>
    <div class="card p-0 overflow-x-auto"><table class="w-full text-sm">
      <thead class="bg-slate-50"><tr><th class="text-left p-3">Document</th><th class="text-left p-3">Société</th><th class="text-left p-3">Catégorie</th><th class="text-left p-3">Module</th><th class="text-left p-3">Action rattachée</th><th class="text-left p-3">Fichier modèle</th><th class="text-left p-3">Statut</th><th class="text-left p-3">Mis à jour</th><th class="p-3">Actions</th></tr></thead>
      <tbody>${rows.map(t=>{const tid=escapeHTML(t.id);const iconBtn=(onclick,title,color,svg)=>`<button type="button" title="${title}" onclick="${onclick}" style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border-radius:7px;border:1px solid #dbe3ef;background:#fff;color:${color};cursor:pointer;transition:background .12s,color .12s" onmouseover="this.style.background='${color}22'" onmouseout="this.style.background='#fff'">${svg}</button>`;const eyeSvg=`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>`;const editSvg=`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>`;const toggleSvg=t.active===false?`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="7" cy="12" r="3" fill="currentColor" stroke="none"/></svg>`:`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="17" cy="12" r="3" fill="currentColor" stroke="none"/></svg>`;const trashSvg=`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;return`<tr class="border-t" data-searchable><td class="p-3"><div class="font-black">${escapeHTML(t.title||t.code)}</div><div class="text-xs text-slate-500 font-mono">${escapeHTML(t.code||"")}</div></td><td class="p-3"><span class="pill ${t.societe?"pill-blue":"pill-gray"}">${escapeHTML(adminSocieteLabel(t.societe))}</span></td><td class="p-3">${escapeHTML(t.category||"Document")}</td><td class="p-3"><span class="pill pill-blue">${escapeHTML(adminDocModuleLabel(t.module))}</span></td><td class="p-3"><span class="pill pill-gray">${escapeHTML(adminDocActionLabel(t.action))}</span></td><td class="p-3">${t.file?.name?`<div class="text-xs font-bold">${escapeHTML(t.file.name)}</div><div class="text-[10px] text-slate-500">${Math.round((t.file.size||0)/1024)} Ko</div>`:`<span class="text-xs text-slate-400">Texte SGDI</span>`}</td><td class="p-3">${t.active===false?'<span class="pill pill-red">Inactif</span>':'<span class="pill pill-green">Actif</span>'}</td><td class="p-3 text-xs">${formatDate(t.updatedAt||t.createdAt)}</td><td class="p-3"><div style="display:flex;align-items:center;justify-content:flex-end;gap:5px">${iconBtn(`previewAdminDocumentTemplate('${tid}')`,t.file?.data?"Voir fichier":"Voir contenu","#2563eb",eyeSvg)}${iconBtn(`openAdminDocumentTemplateModal('${tid}')`, "Modifier","#0f766e",editSvg)}${iconBtn(`toggleAdminDocumentTemplate('${tid}')`,t.active===false?"Activer":"Désactiver",t.active===false?"#16a34a":"#d97706",toggleSvg)}${iconBtn(`deleteAdminDocumentTemplate('${tid}')`, "Supprimer","#dc2626",trashSvg)}</div></td></tr>`}).join("")||`<tr><td colspan="9" class="p-6 text-center text-slate-400">Aucun modèle.</td></tr>`}</tbody>
    </table></div>`;
}

function toggleAdminDocumentTemplate(id){const t=ensureAdminDocumentTemplates().find(x=>String(x.id)===String(id));if(!t)return;t.active=t.active===false; t.updatedAt=new Date().toISOString();t.updatedBy=session?.username||"system";saveDB();toast(t.active?"Modèle activé":"Modèle désactivé","success");renderView()}

function deleteAdminDocumentTemplate(id){const t=ensureAdminDocumentTemplates().find(x=>String(x.id)===String(id));if(!t)return;if(!confirm("Supprimer le modèle "+(t.title||t.code)+" ?"))return;if(!Array.isArray(db.deletedDocumentTemplateCodes))db.deletedDocumentTemplateCodes=[];const code=normalizeDocTemplateCode(t.code);if(code&&!db.deletedDocumentTemplateCodes.includes(code))db.deletedDocumentTemplateCodes.push(code);db.documentTemplates=db.documentTemplates.filter(x=>String(x.id)!==String(id));logActivity("Suppression modèle document",t.title||t.code);saveDB();toast("Modèle supprimé","success");renderView()}

function renderAdminContratsPersonnel(view){
  view.innerHTML=`<div class="mb-4"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">CONTRAT</h1><p class="text-sm text-slate-500 mt-1">Ajouter tous les modèles de contrat Word .docx, paramétrer les clauses conditionnelles et générer les contrats depuis la fiche employé.</p></div>
    <div class="card p-3 mb-3 bg-blue-50 border border-blue-200 text-sm text-blue-800"><b>Balises disponibles :</b> {{NOM}}, {{PRENOM}}, {{NOM_PRENOM}}, {{ADRESSE}}, {{NIN}}, {{DATE_DEBUT}}, {{DATE_FIN}}, {{POSTE}}, {{FONCTION}}, {{SALAIRE}}, {{SOCIETE}}, {{CLAUSES_CONDITIONNELLES}}.</div>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Types contrat</div><div class="text-3xl font-black" style="color:#043970">${TYPES_CONTRAT.length}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Modèles Word</div><div class="text-3xl font-black text-amber-700" id="admin-contract-template-count">—</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Clauses</div><div class="text-3xl font-black text-purple-700" id="admin-contract-clause-count">—</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Contrats générés</div><div class="text-3xl font-black text-emerald-700" id="admin-generated-contract-count">—</div></div>
    </div>
    <div class="flex flex-wrap justify-end gap-2 mb-3"><button class="btn btn-secondary" onclick="openAdminContractClauseModal()">➕ Paragraphe conditionnel</button><button class="btn btn-secondary" onclick="openGenerateContractModal()">⚙ Générer un contrat</button><button class="btn btn-primary" onclick="openAdminContractTemplateModal()">⬆ Ajouter modèle Word</button></div>
    <div id="admin-contract-templates" class="card p-5 text-sm text-slate-500">Chargement des modèles PostgreSQL...</div>
    <div id="admin-generated-contracts" class="card p-5 mt-4 text-sm text-slate-500">Chargement des contrats générés...</div>`;
  setTimeout(loadAdminContractTemplates,0);
}

function openAdminContractClauseModal(){
  openModal(`<h3 class="font-bold text-lg mb-4">Paragraphe conditionnel</h3><form onsubmit="event.preventDefault();saveAdminContractClause(this)"><div class="grid grid-2 gap-3"><div><label class="label">Titre *</label><input class="input" name="title" required/></div><div><label class="label">Champ condition</label><select class="select" name="condition_field"><option value="FONCTION">Fonction</option><option value="POSTE">Poste</option><option value="TYPE_CONTRAT">Type contrat</option><option value="SOCIETE">Société</option></select></div><div><label class="label">Opérateur</label><select class="select" name="condition_operator"><option value="equals">égal à</option><option value="contains">contient</option><option value="not_equals">différent de</option></select></div><div><label class="label">Valeur *</label><input class="input" name="condition_value" required placeholder="Cadre"/></div><div class="col-span-2"><label class="label">Balise cible</label><input class="input" name="placeholder" value="CLAUSES_CONDITIONNELLES"/></div><div class="col-span-2"><label class="label">Texte du paragraphe *</label><textarea class="textarea" name="content" rows="5" required></textarea></div></div><div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer</button></div></form>`)
}

async function saveAdminContractClause(form){const fd=new FormData(form);const payload={title:fd.get("title"),condition_field:fd.get("condition_field"),condition_operator:fd.get("condition_operator"),condition_value:fd.get("condition_value"),placeholder:fd.get("placeholder"),content:fd.get("content"),active:1};try{await SGDI.rh.createContractClause(payload);closeModal();toast("Clause enregistrée","success");loadAdminContractTemplates()}catch(e){toast("Erreur clause : "+(e.message||e),"error")}}

async function openGenerateContractModal(){
  const employees=(db.agents||[]).filter(a=>a.backendId||/^\d+$/.test(String(a.id||"")));
  openModal(`<h3 class="font-bold text-lg mb-4">Générer un contrat</h3><form onsubmit="event.preventDefault();generateEmployeeContract(this)"><div class="grid grid-2 gap-3"><div class="col-span-2"><label class="label">Employé *</label><select class="select" name="employee_id" required>${employees.map(a=>`<option value="${escapeHTML(a.backendId||a.id)}">${escapeHTML((a.nom||"")+" "+(a.prenom||""))} · ${escapeHTML(a.matricule||"")}</option>`).join("")}</select></div><div><label class="label">Type contrat</label><select class="select" name="contract_type">${TYPES_CONTRAT.map(t=>`<option>${t}</option>`).join("")}</select></div><div><label class="label">Format</label><select class="select" name="output_format"><option value="docx">Word DOCX</option><option value="pdf">PDF si LibreOffice installé</option></select></div><div><label class="label">Date début</label><input class="input" type="date" name="start_date"/></div><div><label class="label">Date fin</label><input class="input" type="date" name="end_date"/></div><div><label class="label">Poste</label><input class="input" name="position" list="gen-contract-postes-list" placeholder="— Choisir ou saisir —"/><datalist id="gen-contract-postes-list">${POSTES.map(p=>`<option value="${escapeHTML(p)}"></option>`).join("")}</datalist></div><div><label class="label">Salaire</label><input class="input" type="number" name="salary_net"/></div></div><div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Générer</button></div></form>`)
}

async function generateEmployeeContract(form){const fd=new FormData(form);const payload={employee_id:Number(fd.get("employee_id")),contract_type:cleanContractType(fd.get("contract_type")),output_format:fd.get("output_format"),start_date:fd.get("start_date")||null,end_date:fd.get("end_date")||null,position:fd.get("position")||null,salary_net:fd.get("salary_net")?Number(fd.get("salary_net")):null};try{const row=await SGDI.rh.generateContract(payload);closeModal();toast("Contrat généré","success");await downloadGeneratedContract(row.id,row.file_name);loadAdminContractTemplates()}catch(e){toast("Génération refusée : "+(e.message||e),"error")}}

function adminRecruitmentCandidateKey(c){
  return String(c?.backendId||c?.id||"");
}

function adminRecruitmentCandidates(){
  const society=adminActiveSociete();
  return (db.candidats||[]).filter(c=>{
    const status=String(c?.statut||c?.status||"").toLowerCase();
    if(candidatIsArchived(c)||["embauche","recrute","recruté"].includes(status))return false;
    return !society||normalizeSocieteName(c.societe)===normalizeSocieteName(society);
  });
}

function adminRecruitmentFilters(){
  try{return JSON.parse(sessionStorage.getItem("adminRecruitmentFilters")||"{}")||{}}catch(e){return{}}
}

function setAdminRecruitmentFilter(key,value){
  const filters=adminRecruitmentFilters();
  filters[key]=String(value||"");
  sessionStorage.setItem("adminRecruitmentFilters",JSON.stringify(filters));
  renderView();
}

function resetAdminRecruitmentFilters(){
  sessionStorage.removeItem("adminRecruitmentFilters");
  renderView();
}

function adminRecruitmentFilteredCandidates(){
  const filters=adminRecruitmentFilters();
  const q=normalizedSearchText(filters.q||"");
  return adminRecruitmentCandidates().filter(c=>{
    if(filters.societe&&normalizeSocieteName(c.societe)!==normalizeSocieteName(filters.societe))return false;
    if(filters.poste&&candidatePosteLabel(c)!==filters.poste)return false;
    if(filters.etat&&String(c.statut||c.status||"nouveau").toLowerCase()!==filters.etat)return false;
    if(q&&!normalizedSearchText([c.nom,c.prenom,c.nin,c.telephone,c.societe,candidatePosteLabel(c)].join(" ")).includes(q))return false;
    return true;
  }).sort((a,b)=>String((a.nom||"")+" "+(a.prenom||"")).localeCompare(String((b.nom||"")+" "+(b.prenom||"")),"fr"));
}

function adminRecruitmentMissingFields(c){
  const fields=[];
  if(!String(c?.nom||"").trim())fields.push("nom");
  if(!String(c?.prenom||"").trim())fields.push("prénom");
  if(!String(c?.societe||"").trim())fields.push("société");
  if(!String(candidatePosteCleanValue(c?.posteContrat)||candidatePosteCleanValue(c?.posteSouhaite)||"").trim())fields.push("poste");
  if(!String(c?.telephone||"").trim())fields.push("téléphone");
  if(!String(c?.dateNaissance||"").trim())fields.push("date de naissance");
  if(!String(c?.dateRecrutement||"").trim())fields.push("date de recrutement");
  return fields;
}

function adminRecruitmentCandidateForCreation(c){
  const missing=adminRecruitmentMissingFields(c);
  return {
    ...c,
    nom:String(c?.nom||"").trim()||"NOM À COMPLÉTER",
    prenom:String(c?.prenom||"").trim()||"PRÉNOM À COMPLÉTER",
    societe:String(c?.societe||"").trim()||adminActiveSociete()||"SOCIÉTÉ À COMPLÉTER",
    ficheACompleter:missing.length>0,
    recruitmentIncompleteFields:missing
  };
}

function adminRecruitmentDuplicate(c){
  const nin=normalizeEmployeeNin(c?.nin);
  const phone=String(c?.telephone||"").replace(/\D/g,"");
  const name=normalizedSearchText(`${c?.nom||""} ${c?.prenom||""}`);
  return (db.agents||[]).find(a=>{
    if(nin&&normalizeEmployeeNin(a.nin)===nin)return true;
    const agentPhone=String(a.telephone||"").replace(/\D/g,"");
    if(phone.length>=7&&agentPhone===phone)return true;
    return name&&normalizedSearchText(`${a.nom||""} ${a.prenom||""}`)===name;
  })||null;
}

function adminRecruitmentCandidateDuplicateKey(c){
  const society=normalizeSocieteName(c?.societe||"");
  const nin=normalizeEmployeeNin(c?.nin);
  if(nin&&nin.length>=6)return{key:`nin|${society}|${nin}`,reason:"Même NIN"};
  const phone=String(c?.telephone||c?.phone||"").replace(/\D/g,"");
  if(phone.length>=7)return{key:`phone|${society}|${phone}`,reason:"Même téléphone"};
  const name=normalizedSearchText(`${c?.nom||""} ${c?.prenom||""}`);
  if(name)return{key:`name|${society}|${name}`,reason:"Même nom, prénom et société"};
  return{key:"",reason:""};
}

function adminRecruitmentCandidateRichness(c){
  const fields=["nom","prenom","nin","telephone","email","dateNaissance","lieuNaissance","societe","posteSouhaite","posteContrat","dateRecrutement","adresse","wilaya","commune"];
  return fields.reduce((score,key)=>score+(String(c?.[key]||"").trim()?1:0),0)+candidateCompletenessScore(c);
}

function adminRecruitmentDuplicateGroups(){
  const groups=new Map();
  adminRecruitmentCandidates().forEach(c=>{
    const match=adminRecruitmentCandidateDuplicateKey(c);
    if(!match.key)return;
    if(!groups.has(match.key))groups.set(match.key,{reason:match.reason,items:[]});
    groups.get(match.key).items.push(c);
  });
  return [...groups.values()].filter(group=>group.items.length>1).map(group=>{
    const sorted=group.items.slice().sort((a,b)=>{
      const score=adminRecruitmentCandidateRichness(b)-adminRecruitmentCandidateRichness(a);
      if(score)return score;
      const date=String(a.createdAt||a.created_at||"").localeCompare(String(b.createdAt||b.created_at||""));
      if(date)return date;
      return Number(a.backendId||Number.MAX_SAFE_INTEGER)-Number(b.backendId||Number.MAX_SAFE_INTEGER);
    });
    return{...group,keep:sorted[0],remove:sorted.slice(1)};
  });
}

function openAdminRecruitmentDuplicates(){
  const groups=adminRecruitmentDuplicateGroups();
  if(!groups.length){toast("Aucun doublon de candidature détecté","success");return}
  const removeCount=groups.reduce((sum,g)=>sum+g.remove.length,0);
  const candidateLabel=c=>escapeHTML(((c?.nom||"")+" "+(c?.prenom||"")).trim()||"Identité à compléter");
  openModal(`<h3 class="font-black text-xl mb-2">Doublons de candidatures</h3><p class="text-sm text-slate-600 mb-4"><b>${groups.length}</b> groupe(s) détecté(s), soit <b>${removeCount}</b> copie(s) à supprimer. La fiche la plus complète est conservée dans chaque groupe.</p>
    <div style="max-height:52vh;overflow:auto">${groups.map((group,index)=>`<div class="card p-3 mb-3" style="border-left:4px solid #dc2626"><div class="text-xs font-black text-red-700 uppercase mb-2">Groupe ${index+1} · ${escapeHTML(group.reason)}</div><div class="p-2 rounded bg-emerald-50 mb-2"><span class="pill pill-green">Conservée</span> <b>${candidateLabel(group.keep)}</b><div class="text-[11px] text-slate-500 mt-1">${escapeHTML(group.keep.societe||"Société non renseignée")} · fiche ${adminRecruitmentCandidateRichness(group.keep)} points</div></div>${group.remove.map(c=>`<div class="p-2 rounded bg-red-50 mb-1"><span class="pill pill-red">Supprimée</span> ${candidateLabel(c)}<div class="text-[11px] text-slate-500 mt-1">${escapeHTML(c.societe||"Société non renseignée")} · fiche ${adminRecruitmentCandidateRichness(c)} points</div></div>`).join("")}</div>`).join("")}</div>
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button type="button" class="btn btn-danger" onclick="deleteAdminRecruitmentDuplicates(this)">Supprimer ${removeCount} doublon(s)</button></div>`);
}

async function deleteAdminRecruitmentDuplicates(btn){
  if(!isAdminSystemSession()){toast("Action réservée à Administration système","error");return}
  const groups=adminRecruitmentDuplicateGroups();
  const targets=groups.flatMap(group=>group.remove);
  if(!targets.length){closeModal();toast("Aucun doublon à supprimer","info");return}
  if(!confirm(`Supprimer définitivement ${targets.length} copie(s) en doublon ?\n\nLa fiche la plus complète de chaque groupe sera conservée.`))return;
  if(btn){btn.disabled=true;btn.textContent="Suppression en cours…"}
  let ok=0,failed=0;
  for(let i=0;i<targets.length;i++){
    const c=targets[i];
    if(btn)btn.textContent=`Suppression… ${i+1}/${targets.length}`;
    try{
      await deleteCandidateFromPostgres(c);
      adminRecruitmentSelection.delete(adminRecruitmentCandidateKey(c));
      removeCandidatLocal(c,c.id||c.backendId);
      ok++;
    }catch(e){
      if(sgdiIsNotFoundError(e)){
        adminRecruitmentSelection.delete(adminRecruitmentCandidateKey(c));
        removeCandidatLocal(c,c.id||c.backendId);
        ok++;
      }else{
        failed++;
        console.warn("Suppression doublon candidat refusée",c,e);
      }
    }
  }
  await sgdiPullState({silent:true,render:false,force:true,light:true}).catch(()=>null);
  logActivity("Nettoyage doublons recrutement",`${ok} copie(s) supprimée(s)${failed?` · ${failed} échec(s)`:""}`);
  closeModal();
  toastCenter(`${ok} DOUBLON(S) SUPPRIMÉ(S)${failed?` · ${failed} ÉCHEC(S)`:""}`,failed?"error":"success");
  renderSidebar();
  renderView();
}

function adminRecruitmentSelectedCandidates(){
  const keys=new Set(adminRecruitmentSelection);
  return adminRecruitmentCandidates().filter(c=>keys.has(adminRecruitmentCandidateKey(c)));
}

function toggleAdminRecruitmentCandidate(key,checked){
  if(checked)adminRecruitmentSelection.add(String(key));
  else adminRecruitmentSelection.delete(String(key));
  updateAdminRecruitmentSelectionUI();
}

function toggleAdminRecruitmentVisible(checked){
  adminRecruitmentFilteredCandidates().forEach(c=>{
    const key=adminRecruitmentCandidateKey(c);
    if(checked)adminRecruitmentSelection.add(key);else adminRecruitmentSelection.delete(key);
  });
  document.querySelectorAll(".admin-recruit-candidate").forEach(input=>{input.checked=!!checked});
  updateAdminRecruitmentSelectionUI();
}

function clearAdminRecruitmentSelection(){
  adminRecruitmentSelection.clear();
  document.querySelectorAll(".admin-recruit-candidate").forEach(input=>{input.checked=false});
  updateAdminRecruitmentSelectionUI();
}

function updateAdminRecruitmentSelectionUI(){
  const count=adminRecruitmentSelectedCandidates().length;
  const counter=document.getElementById("admin-recruitment-selected-count");
  if(counter)counter.textContent=`${count} candidat(s) sélectionné(s)`;
  const btn=document.getElementById("admin-recruitment-submit");
  if(btn){btn.disabled=!count;btn.textContent=count?`Recruter la sélection (${count})`:"Recruter la sélection"}
  const delBtn=document.getElementById("admin-recruitment-delete");
  if(delBtn){delBtn.disabled=!count;delBtn.textContent=count?`Supprimer la sélection (${count})`:"Supprimer la sélection"}
  const visible=[...document.querySelectorAll(".admin-recruit-candidate")];
  const checked=visible.filter(x=>x.checked).length;
  document.querySelectorAll(".admin-recruit-select-all").forEach(input=>{
    input.checked=!!visible.length&&checked===visible.length;
    input.indeterminate=checked>0&&checked<visible.length;
  });
}

function renderAdminRecruitment(view){
  const candidates=adminRecruitmentFilteredCandidates();
  const all=adminRecruitmentCandidates();
  const filters=adminRecruitmentFilters();
  const societies=[...new Set(all.map(c=>c.societe||"").filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr"));
  const postes=[...new Set(all.map(candidatePosteLabel).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr"));
  const statuses=[...new Set(all.map(c=>String(c.statut||c.status||"nouveau").toLowerCase()))].sort();
  const incomplete=candidates.filter(c=>adminRecruitmentMissingFields(c).length).length;
  const duplicates=candidates.filter(adminRecruitmentDuplicate).length;
  const candidateDuplicateGroups=adminRecruitmentDuplicateGroups();
  const candidateDuplicateCopies=candidateDuplicateGroups.reduce((sum,g)=>sum+g.remove.length,0);
  view.innerHTML=`<div class="mb-5 flex items-start justify-between gap-3 flex-wrap"><div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-3xl font-black mt-1">Recrutement groupé</h1><p class="text-sm text-slate-500 mt-1">Sélectionnez librement les candidats à transformer en employés. Une fiche incomplète est créée puis signalée à compléter, sans bloquer le processus.</p></div><div class="flex gap-2 items-center flex-wrap"><div class="pill pill-blue">${all.length} candidat(s) disponible(s)</div><button type="button" class="btn ${candidateDuplicateCopies?"btn-danger":"btn-secondary"} text-xs" onclick="openAdminRecruitmentDuplicates()">Nettoyer les doublons${candidateDuplicateCopies?` (${candidateDuplicateCopies})`:""}</button></div></div>
  ${adminSocieteSelectorHTML("Le recrutement et l'attribution des codes respectent la société active.")}
  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Affichés</div><div class="text-3xl font-black text-blue-800">${candidates.length}</div></div>
    <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Fiches à compléter</div><div class="text-3xl font-black text-amber-700">${incomplete}</div><div class="text-xs text-slate-500">Non bloquant</div></div>
    <div class="card p-4"><div class="text-xs uppercase font-black text-slate-500">Doublons potentiels</div><div class="text-3xl font-black text-red-700">${duplicates}</div><div class="text-xs text-slate-500">Confirmation demandée</div></div>
  </div>
  <div class="card p-4 mb-4"><div class="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
    <div class="md:col-span-2"><label class="label">Recherche</label><input class="input" value="${escapeHTML(filters.q||"")}" placeholder="Nom, prénom, téléphone, NIN…" onchange="setAdminRecruitmentFilter('q',this.value)"/></div>
    <div><label class="label">Société</label><select class="select" onchange="setAdminRecruitmentFilter('societe',this.value)"><option value="">Toutes</option>${societies.map(s=>`<option value="${escapeHTML(s)}" ${filters.societe===s?"selected":""}>${escapeHTML(s)}</option>`).join("")}</select></div>
    <div><label class="label">Poste</label><select class="select" onchange="setAdminRecruitmentFilter('poste',this.value)"><option value="">Tous</option>${postes.map(p=>`<option value="${escapeHTML(p)}" ${filters.poste===p?"selected":""}>${escapeHTML(p)}</option>`).join("")}</select></div>
    <div><label class="label">État</label><select class="select" onchange="setAdminRecruitmentFilter('etat',this.value)"><option value="">Tous</option>${statuses.map(s=>`<option value="${escapeHTML(s)}" ${filters.etat===s?"selected":""}>${escapeHTML(s.toUpperCase())}</option>`).join("")}</select></div>
  </div><div class="flex justify-end mt-3"><button class="btn btn-ghost text-xs" onclick="resetAdminRecruitmentFilters()">Réinitialiser les filtres</button></div></div>
  <div class="card p-3 mb-3 flex items-center justify-between gap-3 flex-wrap" style="background:#eff6ff;border-color:#bfdbfe">
    <div class="flex items-center gap-4 flex-wrap"><label class="flex items-center gap-2 text-sm font-black"><input type="checkbox" class="admin-recruit-select-all" onchange="toggleAdminRecruitmentVisible(this.checked)" style="width:17px;height:17px"/> Tout sélectionner (${candidates.length})</label><button class="btn btn-ghost text-xs" onclick="clearAdminRecruitmentSelection()">Tout désélectionner</button><span id="admin-recruitment-selected-count" class="text-sm font-black text-blue-800">${adminRecruitmentSelectedCandidates().length} candidat(s) sélectionné(s)</span></div>
    <div class="flex gap-2 flex-wrap"><button type="button" id="admin-recruitment-delete" class="btn btn-danger" onclick="openAdminRecruitmentDeleteConfirmation()" ${adminRecruitmentSelectedCandidates().length?"":"disabled"}>Supprimer la sélection${adminRecruitmentSelectedCandidates().length?` (${adminRecruitmentSelectedCandidates().length})`:""}</button>
    <button type="button" id="admin-recruitment-submit" class="btn btn-success" onclick="openAdminRecruitmentConfirmation()" ${adminRecruitmentSelectedCandidates().length?"":"disabled"}>Recruter la sélection${adminRecruitmentSelectedCandidates().length?` (${adminRecruitmentSelectedCandidates().length})`:""}</button></div>
  </div>
  <div class="card overflow-hidden">${candidates.length?`<table><thead><tr><th style="width:42px;text-align:center"><input type="checkbox" class="admin-recruit-select-all" onchange="toggleAdminRecruitmentVisible(this.checked)" style="width:17px;height:17px"/></th><th>Candidat</th><th>Société</th><th>Poste</th><th>État du dossier</th><th>Doublon</th></tr></thead><tbody>${candidates.map(c=>{
    const key=adminRecruitmentCandidateKey(c),missing=adminRecruitmentMissingFields(c),duplicate=adminRecruitmentDuplicate(c);
    return `<tr><td class="text-center"><input type="checkbox" class="admin-recruit-candidate" value="${escapeHTML(key)}" ${adminRecruitmentSelection.has(key)?"checked":""} onchange="toggleAdminRecruitmentCandidate('${jsString(key)}',this.checked)" style="width:17px;height:17px"/></td><td><div class="font-black">${escapeHTML(((c.nom||"")+" "+(c.prenom||"")).trim()||"Identité à compléter")}</div><div class="text-xs text-slate-500">${escapeHTML(formatPhoneSGDI(c.telephone)||"Téléphone non renseigné")}</div></td><td class="text-xs">${safe(c.societe)}</td><td class="text-xs">${safe(candidatePosteLabel(c))}</td><td>${missing.length?`<span class="pill pill-amber">À compléter</span><div class="text-[10px] text-amber-700 mt-1">${escapeHTML(missing.join(", "))}</div>`:`<span class="pill pill-green">Prêt</span>`}</td><td>${duplicate?`<span class="pill pill-red">Potentiel</span><div class="text-[10px] text-red-700 mt-1">${escapeHTML(((duplicate.nom||"")+" "+(duplicate.prenom||"")).trim())} · ${escapeHTML(duplicate.matricule||"")}</div>`:`<span class="pill pill-gray">—</span>`}</td></tr>`;
  }).join("")}</tbody></table>`:`<div class="p-10 text-center text-slate-500">Aucun candidat avec ces filtres.</div>`}</div>`;
  requestAnimationFrame(updateAdminRecruitmentSelectionUI);
}

function openAdminRecruitmentConfirmation(){
  const list=adminRecruitmentSelectedCandidates();
  if(!list.length){toast("Sélectionnez au moins un candidat","error");return}
  const incomplete=list.filter(c=>adminRecruitmentMissingFields(c).length);
  const duplicates=list.filter(adminRecruitmentDuplicate);
  openModal(`<h3 class="font-black text-xl mb-2">Confirmer le recrutement groupé</h3><p class="text-sm text-slate-600 mb-4"><b>${list.length}</b> candidat(s) seront transformés en employés avec attribution automatique des codes et lancement du processus opérationnel.</p>
    <div class="grid grid-cols-3 gap-2 mb-4"><div class="p-3 rounded-lg bg-emerald-50 text-center"><div class="text-2xl font-black text-emerald-700">${list.length-duplicates.length}</div><div class="text-xs">Sans doublon</div></div><div class="p-3 rounded-lg bg-amber-50 text-center"><div class="text-2xl font-black text-amber-700">${incomplete.length}</div><div class="text-xs">À compléter, créés quand même</div></div><div class="p-3 rounded-lg bg-red-50 text-center"><div class="text-2xl font-black text-red-700">${duplicates.length}</div><div class="text-xs">Doublons potentiels</div></div></div>
    ${duplicates.length?`<div class="card p-3 mb-4" style="border-color:#fecaca;background:#fef2f2"><div class="font-black text-red-800 text-sm mb-2">Doublons à vérifier</div>${duplicates.slice(0,8).map(c=>{const a=adminRecruitmentDuplicate(c);return`<div class="text-xs py-1">${escapeHTML(((c.nom||"")+" "+(c.prenom||"")).trim())} ↔ <b>${escapeHTML(((a?.nom||"")+" "+(a?.prenom||"")).trim())}</b> (${escapeHTML(a?.matricule||"")})</div>`}).join("")}${duplicates.length>8?`<div class="text-xs mt-1">+ ${duplicates.length-8} autre(s)</div>`:""}</div>`:""}
    <div class="flex justify-end gap-2 flex-wrap"><button class="btn btn-ghost" onclick="closeModal()">Annuler</button>${duplicates.length?`<button class="btn btn-secondary" onclick="recruitAdminSelectedCandidates(this,false)">Recruter sans les doublons</button>`:""}<button class="btn btn-success" onclick="recruitAdminSelectedCandidates(this,true)">Recruter ${duplicates.length?"tout malgré les alertes":"la sélection"}</button></div>`);
}

async function recruitAdminSelectedCandidates(btn,includeDuplicates){
  let list=adminRecruitmentSelectedCandidates();
  if(!includeDuplicates)list=list.filter(c=>!adminRecruitmentDuplicate(c));
  if(!list.length){closeModal();toast("Aucun candidat à recruter après contrôle des doublons","info");return}
  if(btn){btn.disabled=true;btn.textContent="Synchronisation des employés…"}
  await sgdiPullEmployees({silent:true}).catch(()=>null);
  const usedCodes=new Set((db.agents||[]).map(a=>normalizeEmployeeCodeFormat(a.matricule||a.code)).filter(Boolean));
  const matricules=list.map(c=>{
    const soc=c.societe||adminActiveSociete()||"";
    let code="";
    outer:for(const prefix of matriculePrefixesForSociete(soc)){
      for(let i=1;i<=999;i++){
        const candidateCode=prefix+String(i).padStart(2,"0");
        if(!usedCodes.has(candidateCode)){code=candidateCode;break outer}
      }
    }
    code=code||((matriculePrefixesForSociete(soc)[0]||"A")+Date.now().toString().slice(-5));
    usedCodes.add(normalizeEmployeeCodeFormat(code));
    return code;
  });
  let ok=0,failed=0;
  const errors=[];
  const createdAgents=[];
  for(let i=0;i<list.length;i+=10){
    if(btn)btn.textContent=`Création en cours… ${Math.min(i+10,list.length)}/${list.length}`;
    const batch=list.slice(i,i+10),codes=matricules.slice(i,i+10);
    const results=await Promise.allSettled(batch.map((c,j)=>recruitContractCandidateToEmployee(adminRecruitmentCandidateForCreation(c),null,codes[j])));
    results.forEach((result,index)=>{
      if(result.status==="fulfilled"){ok++;createdAgents.push(result.value);adminRecruitmentSelection.delete(adminRecruitmentCandidateKey(batch[index]))}
      else{failed++;errors.push(result.reason?.message||String(result.reason))}
    });
  }
  try{if(ok)await sgdiBackendSaveAndWait()}catch(e){failed++;errors.push("Synchronisation finale : "+(e.message||e))}
  let portalFailed=0;
  if(createdAgents.length){
    if(btn)btn.textContent="Création des comptes Portail RH…";
    for(const agent of createdAgents){
      try{
        const res=await fetch("/api/portal/accounts",{
          method:"POST",
          headers:{"Content-Type":"application/json",Authorization:`Bearer ${sgdiAuthToken()}`},
          body:JSON.stringify({matricule:agent.matricule})
        });
        if(!res.ok&&res.status!==409){
          portalFailed++;
          const detail=await res.json().catch(()=>({}));
          errors.push(`${agent.matricule||"Employé"} : ${detail.detail||"compte Portail RH non créé"}`);
        }
      }catch(e){
        portalFailed++;
        errors.push(`${agent.matricule||"Employé"} : compte Portail RH non créé`);
      }
    }
  }
  logActivity("Recrutement groupé",`${ok} employé(s) créé(s)${failed?` · ${failed} échec(s)`:""}`);
  closeModal();
  toastCenter(`${ok} EMPLOYÉ(S) CRÉÉ(S)${failed?` · ${failed} ÉCHEC(S)`:""}${portalFailed?` · ${portalFailed} COMPTE(S) PORTAIL À REPRENDRE`:""}`,failed||portalFailed?"error":"success");
  if(errors.length)toast(errors.slice(0,3).join(" ; ")+(errors.length>3?` ; +${errors.length-3} autre(s)`:""),"error");
  renderSidebar();
  renderView();
}

function openAdminRecruitmentDeleteConfirmation(){
  const list=adminRecruitmentSelectedCandidates();
  if(!list.length){toast("Sélectionnez au moins un candidat","error");return}
  openModal(`<h3 class="font-black text-xl mb-2 text-red-700">Supprimer ${list.length} candidat(s) ?</h3>
    <p class="text-sm text-slate-600 mb-4">Suppression définitive, sans passage par les archives. Cette action est irréversible.</p>
    <div class="card p-3 mb-4" style="max-height:220px;overflow:auto;border-color:#fecaca;background:#fef2f2">${list.map(c=>`<div class="text-xs py-1">${escapeHTML(((c.nom||"")+" "+(c.prenom||"")).trim()||"Identité à compléter")}${c.societe?` · ${escapeHTML(c.societe)}`:""}</div>`).join("")}</div>
    <div class="flex justify-end gap-2"><button class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-danger" onclick="deleteAdminSelectedCandidates(this)">Supprimer définitivement</button></div>`);
}

async function deleteAdminSelectedCandidates(btn){
  const list=adminRecruitmentSelectedCandidates();
  if(!list.length){closeModal();return}
  if(btn){btn.disabled=true;btn.textContent="Suppression en cours…"}
  let ok=0,failed=0;
  const errors=[];
  for(const c of list){
    try{
      await deleteCandidateFromPostgres(c);
      const key=adminRecruitmentCandidateKey(c);
      adminRecruitmentSelection.delete(key);
      db.candidats=(db.candidats||[]).filter(x=>adminRecruitmentCandidateKey(x)!==key);
      ok++;
    }catch(e){failed++;errors.push(`${((c.nom||"")+" "+(c.prenom||"")).trim()||"Candidat"} : ${e.message||e}`)}
  }
  saveDB();
  logActivity("Suppression candidats (recrutement groupé)",`${ok} supprimé(s)${failed?` · ${failed} échec(s)`:""}`);
  closeModal();
  toastCenter(`${ok} CANDIDAT(S) SUPPRIMÉ(S)${failed?` · ${failed} ÉCHEC(S)`:""}`,failed?"error":"success");
  if(errors.length)toast(errors.slice(0,3).join(" ; ")+(errors.length>3?` ; +${errors.length-3} autre(s)`:""),"error");
  renderSidebar();
  renderView();
}

function renderAdminCandidats(view){
  if(!isAdminSystemSession()){view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700 mb-2">Accès réservé</h2><p>Cette page est réservée au compte Administration système.</p></div>`;return}
  const adminSoc=adminActiveSociete();
  const all=(db.candidats||[]).filter(c=>!adminSoc||c.societe===adminSoc);
  const byStatus={};
  all.forEach(c=>{const s=c.statut||"nouvelle";byStatus[s]=(byStatus[s]||0)+1});
  const bySoc={};
  all.forEach(c=>{const s=c.societe||"—";bySoc[s]=(bySoc[s]||0)+1});
  const statusRows=Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).map(([s,n])=>`
    <tr><td class="font-semibold">${escapeHTML(s)}</td><td class="text-center font-bold">${n}</td>
    <td class="text-right"><button class="btn btn-danger text-xs" onclick="adminDeleteCandidatesBulk('statut','${escapeHTML(s)}')">Supprimer les candidats "${escapeHTML(s)}"</button></td></tr>`).join("");
  const socRows=Object.entries(bySoc).sort((a,b)=>b[1]-a[1]).map(([s,n])=>`
    <tr><td class="font-semibold">${escapeHTML(s)}</td><td class="text-center font-bold">${n}</td>
    <td class="text-right"><button class="btn btn-danger text-xs" onclick="adminDeleteCandidatesBulk('societe','${escapeHTML(s)}')">Supprimer ${n} candidat(s)</button></td></tr>`).join("");
  view.innerHTML=`
  <div class="mb-5 flex items-start justify-between gap-3 flex-wrap">
    <div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div>
    <h1 class="text-3xl font-black mt-1">Gestion des candidats</h1>
    <p class="text-sm text-slate-500 mt-1">Suppression en masse par statut, par société ou suppression totale.</p></div>
    <button type="button" class="btn btn-ghost" onclick="navigate('admin/dashboard')">← Retour</button>
  </div>
  ${adminSocieteSelectorHTML(adminSoc?"Filtrage actif sur cette société.":"Sélectionnez une société ou travaillez sur tous les candidats.")}
  <div class="grid grid-4 gap-4 mb-5">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Total candidats</div><div class="text-3xl font-black mt-1">${all.length}</div></div>
    ${Object.entries(byStatus).map(([s,n])=>`<div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">${escapeHTML(s)}</div><div class="text-3xl font-black mt-1">${n}</div></div>`).join("")}
  </div>
  <section class="card p-5 mb-4">
    <h2 class="font-black text-lg mb-1">Suppression par statut</h2>
    <p class="text-sm text-slate-500 mb-3">Supprime tous les candidats ayant le statut sélectionné.</p>
    <table><thead><tr><th>Statut</th><th class="text-center">Nombre</th><th></th></tr></thead><tbody>${statusRows||`<tr><td colspan="3" class="text-center text-slate-500 p-4">Aucun candidat</td></tr>`}</tbody></table>
  </section>
  <section class="card p-5 mb-4">
    <h2 class="font-black text-lg mb-1">Suppression par société</h2>
    <p class="text-sm text-slate-500 mb-3">Supprime tous les candidats rattachés à la société sélectionnée.</p>
    <table><thead><tr><th>Société</th><th class="text-center">Nombre</th><th></th></tr></thead><tbody>${socRows||`<tr><td colspan="3" class="text-center text-slate-500 p-4">Aucun candidat</td></tr>`}</tbody></table>
  </section>
  <section class="card p-5 border-2 border-red-300">
    <h2 class="font-black text-lg mb-1 text-red-700">Zone dangereuse</h2>
    <p class="text-sm text-slate-500 mb-4">Supprime <b>tous les candidats${adminSoc?" de "+escapeHTML(adminSoc):""}</b> de façon irréversible.</p>
    <button class="btn btn-danger" onclick="adminDeleteCandidatesBulk('all',null)">Supprimer tous les candidats (${all.length})</button>
  </section>`;
}

async function renderAdminPostes(view){
  if(!isAdminSystemSession()){view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700 mb-2">Accès réservé</h2><p>Cette page est réservée au compte Administration système.</p></div>`;return}
  const selSoc=sessionStorage.getItem("adminPostesFilterSoc")||"";
  let allPostes=[];
  try{
    const qs=selSoc?`?society=${encodeURIComponent(selSoc)}`:"";
    allPostes=await sgdiApi(`/api/irongs/positions${qs}`,{method:"GET",legacy:false});
  }catch(_){}
  if(Array.isArray(allPostes)&&allPostes.length)POSTES=allPostes.map(p=>p.name||p);
  const societes=["IRON GLOBAL SOLUTION","IRON GLOBAL SÉCURITÉ","SWORD Corporation","SWORD Construction"];
  const socOptions=`<option value="">Toutes les sociétés</option>`+societes.map(s=>`<option value="${escapeHTML(s)}" ${selSoc===s?"selected":""}>${escapeHTML(s)}</option>`).join("");
  const rows=allPostes.map(p=>`
    <tr>
      <td class="font-semibold">${escapeHTML(p.name||p)}</td>
      <td class="text-xs text-slate-400">${escapeHTML(p.society||"Toutes")}</td>
      <td class="text-right"><button class="btn btn-danger text-xs" onclick="adminDeletePoste(${p.id||0},${JSON.stringify(p.name||p).replace(/"/g,'&quot;')})">Supprimer</button></td>
    </tr>`).join("");
  view.innerHTML=`
  <div class="mb-5 flex items-start justify-between gap-3 flex-wrap">
    <div>
      <div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div>
      <h1 class="text-3xl font-black mt-1">Postes / Fonctions</h1>
      <p class="text-sm text-slate-500 mt-1">Gérez la liste des postes disponibles dans les formulaires (effectifs, fiche technique site, affectations).</p>
    </div>
    <button type="button" class="btn btn-ghost" onclick="navigate('admin/dashboard')">← Retour</button>
  </div>
  <div class="card p-4 mb-4" style="background:#eff6ff;border:1px solid #93c5fd">
    <div class="font-bold mb-1">🔧 Corriger "Agent de sécurité" (intitulé libre, hors catalogue)</div>
    <div class="text-xs text-slate-600 mb-2">Renomme partout — fiches employés, affectations, candidats, contrats, modèles — l'ancien intitulé libre "Agent de sécurité" vers le libellé officiel du catalogue ci-dessous (AGENT DE PRÉVENTION ET DE SÉCURITÉ (APS)), sans perte de donnée.</div>
    <button class="btn btn-primary text-sm" onclick="adminRenamePosteAgentSecurite(this)">Corriger maintenant</button>
  </div>
  <div class="card p-4 mb-4 flex items-center gap-3 flex-wrap">
    <label class="label mb-0">Filtrer par société :</label>
    <select class="select" style="min-width:260px" onchange="sessionStorage.setItem('adminPostesFilterSoc',this.value);renderView()">${socOptions}</select>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
    <section class="card p-5">
      <h2 class="font-black text-lg mb-3">Liste des postes (${allPostes.length})</h2>
      <table><thead><tr><th>Poste / Fonction</th><th>Société</th><th></th></tr></thead>
      <tbody>${rows||`<tr><td colspan="3" class="text-center text-slate-500 p-4">Aucun poste défini</td></tr>`}</tbody></table>
    </section>
    <section class="card p-5">
      <h2 class="font-black text-lg mb-3">Ajouter un poste</h2>
      <form onsubmit="adminAddPoste(event)">
        <div class="mb-3">
          <label class="label">Société</label>
          <select id="admin-new-poste-soc" class="select">
            <option value="">Toutes les sociétés (commun)</option>
            ${societes.map(s=>`<option value="${escapeHTML(s)}" ${selSoc===s?"selected":""}>${escapeHTML(s)}</option>`).join("")}
          </select>
        </div>
        <div class="mb-3">
          <label class="label">Nom du poste</label>
          <input id="admin-new-poste" class="input" type="text" placeholder="Ex: Agent de sécurité" required autocomplete="off">
        </div>
        <button type="submit" class="btn btn-primary w-full">Ajouter</button>
      </form>
    </section>
  </div>`;
}

async function adminRenamePosteAgentSecurite(btn){
  if(!isAdminSystemSession()){toast("Action réservée à l'administrateur système","error");return}
  if(!confirm(`Renommer partout "Agent de sécurité" vers le libellé officiel du catalogue ?\nAucune donnée n'est perdue (fiches employés, affectations, candidats, contrats, modèles).\nCette action est réversible en corrigeant à nouveau chaque enregistrement à la main.`))return;
  const original=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent="Correction en cours…"}
  try{
    const r=await sgdiApi("/drh/postes/rename-agent-securite",{method:"POST",legacy:false});
    if(r&&r.total){
      toast(`✓ ${r.total} enregistrement(s) corrigé(s) vers "${r.canonical_label}"`,"success");
      if(typeof sgdiEnsureEmployeesForDisplay==="function"){window.__sgdiEnsuredAt={};sgdiEnsureEmployeesForDisplay({force:true})}
    }else{
      toast("Aucun enregistrement à corriger — déjà à jour.","success");
    }
  }catch(e){
    toast("Correction impossible : "+(e.message||e),"error");
  }finally{
    if(btn){btn.disabled=false;btn.textContent=original}
  }
}

async function adminDeleteCandidatesBulk(filterType,filterValue){
  if(!isAdminSystemSession()){toast("Accès réservé Administration système","error");return}
  const adminSoc=adminActiveSociete();
  let targets=(db.candidats||[]).filter(c=>!adminSoc||c.societe===adminSoc);
  if(filterType==="statut")targets=targets.filter(c=>(c.statut||"nouvelle")===filterValue);
  else if(filterType==="societe")targets=targets.filter(c=>(c.societe||"—")===filterValue);
  if(!targets.length){toast("Aucun candidat à supprimer","info");return}
  const label=filterType==="all"?"tous les candidats":(filterType==="statut"?`les candidats "${filterValue}"`:`les candidats de "${filterValue}"`);
  if(!confirm(`Supprimer définitivement ${targets.length} candidat(s) — ${label} ?\n\nCette opération est irréversible.`))return;
  const btn=document.activeElement;
  if(btn)btn.disabled=true;
  let ok=0,failed=0;
  const BATCH=10;
  const idsToRemove=new Set(targets.map(c=>String(c.id||"")));
  for(let i=0;i<targets.length;i+=BATCH){
    const batch=targets.slice(i,i+BATCH);
    const results=await Promise.allSettled(batch.map(async c=>{
      const backendId=sqlBackendId(c.backendId);
      if(backendId&&sgdiAuthToken()){
        await SGDI.rh.deleteCandidate(backendId).catch(e=>{if(!sgdiIsNotFoundError(e))throw e});
      }
    }));
    results.forEach(r=>{if(r.status==="fulfilled")ok++;else failed++;});
    if(btn)btn.textContent=`Suppression… ${Math.min(i+BATCH,targets.length)}/${targets.length}`;
  }
  db.candidats=(db.candidats||[]).filter(c=>!idsToRemove.has(String(c.id||"")));
  saveDB();
  refreshModuleCountersRibbon();
  if(failed)toast(`${ok} supprimé(s) en base, ${failed} erreur(s) PostgreSQL`,"warning");
  else toast(`${ok} candidat(s) supprimé(s)`,"success");
  renderView();
}
SGDIModules.registerModule({key:"administration-rh-settings",routes:[]});
