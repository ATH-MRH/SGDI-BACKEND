/* Administration permissions — déplacement sans modification de droits. */
async function openGranularPermissionsByKey(encodedUsername){
  const current=adminCaptureView(document.getElementById("view"),document.getElementById("modal-host"));
  const username=decodeURIComponent(String(encodedUsername||""));
  const target=adminUserByUsername(username);
  if(!target||!target.backendId){toast("Utilisateur backend introuvable","error");return}
  try{
    sgdiShowDataLoadingBar("Chargement des permissions granulaires...");
    const [catalog,state]=await Promise.all([SGDI.auth.granularFeatureCatalog(),SGDI.auth.userFeaturePermissions(target.backendId)]);
    if(!current())return;
    granularPermissionEditor={userId:Number(target.backendId),username:state.username,catalog,state,activeModule:catalog.modules?.[0]?.module_key||"",selected:new Set((state.permissions||[]).map(p=>p.module_key+":"+p.feature_key+":"+p.action_key)),moduleSearch:"",featureSearch:"",featureFilter:"all"};
    openModal('<div class="granular-permissions-shell" id="granular-permissions-editor"></div>');
    renderGranularPermissionsEditor();
  }catch(e){if(!current())return;toast("Permissions granulaires indisponibles : "+(e.message||e),"error")}
  finally{if(current()&&typeof sgdiHideDataLoadingBar==="function")sgdiHideDataLoadingBar()}
}

function granularPermissionKey(moduleKey,featureKey,actionKey){return moduleKey+":"+featureKey+":"+actionKey}

function granularActiveModule(){return granularPermissionEditor?.catalog?.modules?.find(module=>module.module_key===granularPermissionEditor.activeModule)||null}

function granularFeatureState(moduleKey,feature){
  const actions=feature.applicable_actions||[];
  const count=actions.filter(action=>granularPermissionEditor.selected.has(granularPermissionKey(moduleKey,feature.feature_key,action))).length;
  return{count,total:actions.length,checked:actions.length>0&&count===actions.length,indeterminate:count>0&&count<actions.length};
}

function renderGranularPermissionsEditor(){
  const editor=granularPermissionEditor,host=document.getElementById("granular-permissions-editor");if(!editor||!host)return;
  const module=granularActiveModule();if(!module)return;
  const moduleQuery=normalizedSearchText(editor.moduleSearch||"");
  const modules=(editor.catalog.modules||[]).filter(item=>!moduleQuery||normalizedSearchText(item.label+" "+item.domain).includes(moduleQuery));
  const featureQuery=normalizedSearchText(editor.featureSearch||"");
  const features=(module.features||[]).filter(feature=>{
    const state=granularFeatureState(module.module_key,feature);
    const searchOk=!featureQuery||normalizedSearchText(feature.label+" "+feature.description).includes(featureQuery);
    const filterOk=editor.featureFilter==="all"||(editor.featureFilter==="selected"&&state.count>0)||(editor.featureFilter==="empty"&&state.count===0);
    return searchOk&&filterOk;
  });
  const applicable=(module.features||[]).reduce((sum,feature)=>sum+(feature.applicable_actions||[]).length,0);
  const selected=(module.features||[]).reduce((sum,feature)=>sum+granularFeatureState(module.module_key,feature).count,0);
  const notApplicable=(module.features||[]).length*(editor.catalog.actions||[]).length-applicable;
  const moduleAll=applicable>0&&selected===applicable,moduleSome=selected>0&&selected<applicable;
  host.innerHTML=`<div class="granular-head"><div><span>Permissions granulaires — utilisateur</span><h2>${escapeHTML(editor.username)}</h2></div><button type="button" aria-label="Fermer" onclick="closeModal()">×</button></div>
    <div class="granular-warning"><b>Permissions préparées — non actives.</b><span>Les autorisations legacy restent applicables.</span></div>
    <div class="granular-layout"><aside class="granular-modules"><label class="granular-search"><span>⌕</span><input type="search" placeholder="Rechercher un module..." value="${escapeHTML(editor.moduleSearch)}" oninput="granularSetModuleSearch(this.value)"></label><div class="granular-module-list">${modules.map(item=>`<button type="button" class="${item.module_key===module.module_key?"active":""}" onclick="granularSelectModule('${escapeHTML(item.module_key)}')"><i>${escapeHTML(item.label.charAt(0))}</i><span><b>${escapeHTML(item.label)}</b><small>${escapeHTML(item.domain)}</small></span></button>`).join("")||'<p class="granular-empty">Aucun module</p>'}</div></aside>
    <main class="granular-main"><header class="granular-module-head"><i>${escapeHTML(module.label.charAt(0))}</i><div><h3>${escapeHTML(module.label)}</h3><a>${escapeHTML(module.domain)}</a><p>${escapeHTML(module.description)}</p></div></header>
    <div class="granular-toolbar"><label class="granular-search"><span>⌕</span><input type="search" placeholder="Rechercher une fonctionnalité..." value="${escapeHTML(editor.featureSearch)}" oninput="granularSetFeatureSearch(this.value)"></label><select onchange="granularSetFeatureFilter(this.value)"><option value="all" ${editor.featureFilter==="all"?"selected":""}>Toutes les fonctionnalités</option><option value="selected" ${editor.featureFilter==="selected"?"selected":""}>Avec sélection</option><option value="empty" ${editor.featureFilter==="empty"?"selected":""}>Non sélectionnées</option></select><label class="granular-select-module"><input id="granular-module-all" type="checkbox" ${moduleAll?"checked":""} onchange="granularToggleModule(this.checked)"> Sélectionner tout le module</label></div>
    <div class="granular-table-wrap"><table class="granular-table"><thead><tr><th>Fonctionnalité / Rubrique</th><th>Tout</th>${(editor.catalog.actions||[]).map(action=>`<th>${escapeHTML(GRANULAR_ACTION_LABELS[action]||action)}</th>`).join("")}</tr></thead><tbody>${features.map(feature=>{const state=granularFeatureState(module.module_key,feature),actions=new Set(feature.applicable_actions||[]);return`<tr><td><b>${escapeHTML(feature.label)}</b><small>${escapeHTML(feature.description)}</small></td><td><input class="granular-feature-all" data-feature="${escapeHTML(feature.feature_key)}" type="checkbox" ${state.checked?"checked":""} onchange="granularToggleFeature('${escapeHTML(feature.feature_key)}',this.checked)"></td>${(editor.catalog.actions||[]).map(action=>{const enabled=actions.has(action),checked=enabled&&editor.selected.has(granularPermissionKey(module.module_key,feature.feature_key,action));return`<td class="${enabled?"":"not-applicable"}"><input data-feature-permission type="checkbox" data-module="${escapeHTML(module.module_key)}" data-feature="${escapeHTML(feature.feature_key)}" data-action="${escapeHTML(action)}" ${checked?"checked":""} ${enabled?`onchange="granularTogglePermission(this)"`:'disabled aria-label="Non applicable"'}></td>`}).join("")}</tr>`}).join("")||'<tr><td colspan="14" class="granular-empty">Aucune fonctionnalité ne correspond au filtre.</td></tr>'}</tbody></table></div>
    <footer class="granular-footer"><div class="granular-counters"><span><b>${module.features.length}</b> fonctionnalités</span><span><b>${selected}</b> autorisations sélectionnées</span><span><b>${applicable-selected}</b> non sélectionnées</span><span><b>${notApplicable}</b> non applicables</span></div><div class="granular-actions"><button type="button" class="btn btn-ghost" onclick="granularResetModule()">Réinitialiser ce module</button><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="button" class="btn btn-primary" onclick="saveGranularPermissions()">Enregistrer (préparer)</button></div></footer></main></div>`;
  const moduleCheckbox=document.getElementById("granular-module-all");if(moduleCheckbox)moduleCheckbox.indeterminate=moduleSome;
  document.querySelectorAll(".granular-feature-all").forEach(input=>{const feature=module.features.find(item=>item.feature_key===input.dataset.feature);if(feature)input.indeterminate=granularFeatureState(module.module_key,feature).indeterminate});
}

function granularSetModuleSearch(value){granularPermissionEditor.moduleSearch=value;renderGranularPermissionsEditor()}

function granularSetFeatureSearch(value){granularPermissionEditor.featureSearch=value;renderGranularPermissionsEditor()}

function granularSetFeatureFilter(value){granularPermissionEditor.featureFilter=value;renderGranularPermissionsEditor()}

function granularSelectModule(moduleKey){granularPermissionEditor.activeModule=moduleKey;granularPermissionEditor.featureSearch="";granularPermissionEditor.featureFilter="all";renderGranularPermissionsEditor()}

function granularTogglePermission(input){const key=granularPermissionKey(input.dataset.module,input.dataset.feature,input.dataset.action);input.checked?granularPermissionEditor.selected.add(key):granularPermissionEditor.selected.delete(key);renderGranularPermissionsEditor()}

function granularToggleFeature(featureKey,checked){const module=granularActiveModule(),feature=module?.features?.find(item=>item.feature_key===featureKey);if(!feature)return;(feature.applicable_actions||[]).forEach(action=>{const key=granularPermissionKey(module.module_key,featureKey,action);checked?granularPermissionEditor.selected.add(key):granularPermissionEditor.selected.delete(key)});renderGranularPermissionsEditor()}

function granularToggleModule(checked){const module=granularActiveModule();if(!module)return;(module.features||[]).forEach(feature=>(feature.applicable_actions||[]).forEach(action=>{const key=granularPermissionKey(module.module_key,feature.feature_key,action);checked?granularPermissionEditor.selected.add(key):granularPermissionEditor.selected.delete(key)}));renderGranularPermissionsEditor()}

function granularResetModule(){granularToggleModule(false)}

async function saveGranularPermissions(){
  const editor=granularPermissionEditor;if(!editor)return;
  const permissions=[...editor.selected].sort().map(key=>{const[module_key,feature_key,action_key]=key.split(":");return{module_key,feature_key,action_key}});
  if(!confirm("Remplacer les permissions granulaires préparées par cette sélection ?"))return;
  try{const result=await SGDI.auth.replaceUserFeaturePermissions(editor.userId,permissions);closeModal();toast("Permissions préparées enregistrées : "+result.permission_count,"success")}
  catch(e){toast("Enregistrement refusé : "+(e.message||e),"error")}
}

function renderAdminDroits(view){
  const droits=db.droitsAcces||{};
  const colors={agent:"#0f766e",ops:"#043970",dispatch:"#7c3aed",ADM:"#dc2626"};
  const accessRoles=ADMIN_ACCESS_ROLES;
  const roleLabels=ADMIN_ROLE_DISPLAY_LABELS;
  const exceptionKeys=Object.keys(droits).filter(k=>droits[k]!==undefined);
  const allowExceptions=exceptionKeys.filter(k=>!!droits[k]).length;
  const denyExceptions=exceptionKeys.length-allowExceptions;
  const effectiveAllowed=ADMIN_MODULES.reduce((sum,m)=>sum+accessRoles.filter(r=>{const key=m+":"+r;return droits[key]===undefined?canAccessOriginal(m,r):!!droits[key]}).length,0);
  view.innerHTML=`<div class="mb-2 flex items-start justify-between gap-3 flex-wrap">
      <div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-xl font-black mt-0.5">Exceptions techniques d'accès</h1></div>
      <div class="flex gap-2 flex-wrap text-center">
        <div class="card px-3 py-1.5"><div class="text-lg font-black text-amber-700 leading-none">${exceptionKeys.length}</div><div class="text-[10px] uppercase font-black text-slate-500">Exceptions</div></div>
        <div class="card px-3 py-1.5"><div class="text-lg font-black text-emerald-700 leading-none">${allowExceptions}</div><div class="text-[10px] uppercase font-black text-slate-500">Autorisations</div></div>
        <div class="card px-3 py-1.5"><div class="text-lg font-black text-red-700 leading-none">${denyExceptions}</div><div class="text-[10px] uppercase font-black text-slate-500">Blocages</div></div>
        <div class="card px-3 py-1.5"><div class="text-lg font-black text-blue-700 leading-none">${effectiveAllowed}</div><div class="text-[10px] uppercase font-black text-slate-500">Droits effectifs</div></div>
      </div>
    </div>
    <div class="card px-3 py-1.5 mb-2 bg-amber-50 border border-amber-200 text-xs text-amber-900">À utiliser uniquement pour corriger une exception rôle × module (la config normale reste dans les profils). <b>Défaut</b> = règle standard, <b>Exception</b> = règle enregistrée en base.</div>
    <div class="card p-4 mb-2" style="border-left:4px solid #0f766e"><div class="flex items-center justify-between gap-3 flex-wrap"><div><div class="font-black">Secrétariat Général — profils prêts à l’emploi</div><div class="text-xs text-slate-500 mt-1">SEC_CONSULT : lecture · SEC_GESTION : création et traitement · SEC_RESP : validation officielle. Les 11 rubriques sont configurables dans chaque profil.</div></div><button class="btn btn-primary" onclick="navigate('admin/niveaux')">Configurer les profils SG</button></div></div>
    <div class="card p-2 mb-2 admin-access-toolbar">
      <input id="admin-right-search" class="input" placeholder="Rechercher un module, code ou groupe..." oninput="adminFilterDroitsTable()"/>
      <label class="admin-access-filter"><input id="admin-right-only-exceptions" type="checkbox" onchange="adminFilterDroitsTable()"/> Exceptions seulement</label>
      <span id="admin-right-visible-count">${ADMIN_MODULES.length} module(s)</span>
    </div>
    <div class="card p-0 overflow-x-auto admin-access-card">
      <table class="w-full text-sm admin-access-table">
        <thead class="bg-slate-50"><tr><th class="text-left p-3">Module</th>${accessRoles.map(r=>`<th class="p-3" style="color:${colors[r]||"#043970"}">${escapeHTML(roleLabels[r]||r)}</th>`).join("")}</tr></thead>
        <tbody>${ADMIN_MODULES.map(m=>{const route=adminModuleRoute(m);const label=adminAccessModuleLabel(m);const group=adminAccessModuleGroup(m);const rowExceptions=accessRoles.filter(r=>droits[m+":"+r]!==undefined).length;const search=normalizedSearchText([m,label,group].join(" "));return`<tr class="border-t" data-admin-right-row data-exceptions="${rowExceptions}" data-search="${escapeHTML(search)}"><td class="p-3 admin-access-module-cell"><button type="button" class="admin-access-module-label" onclick="navigate('${route}')">${escapeHTML(label)}</button><div class="admin-access-module-meta">${escapeHTML(group)}${label!==m?` · Code : ${escapeHTML(m)}`:""}${rowExceptions?` · ${rowExceptions} exception(s)`:""}</div></td>${accessRoles.map(r=>{const key=m+":"+r;const def=canAccessOriginal(m,r);const override=droits[key];const isOverride=override!==undefined;const enabled=isOverride?!!override:def;const state=isOverride?(enabled?"Exception autorisée":"Exception bloquée"):(def?"Défaut autorisé":"Défaut bloqué");const cls=isOverride?(enabled?"is-exception-allow":"is-exception-deny"):"is-default";return`<td class="p-3 text-center"><label class="admin-access-toggle ${cls}" title="${escapeHTML(state)}"><input type="checkbox" ${enabled?"checked":""} onchange="adminToggleDroit('${jsString(m)}','${jsString(r)}',this.checked)"/><span>${isOverride?"Exception":"Défaut"}</span></label></td>`}).join("")}</tr>`}).join("")}</tbody>
      </table>
    </div>
    <div class="mt-4 flex gap-2"><button class="btn btn-secondary" onclick="navigate('admin/niveaux')">Retour aux profils</button><button class="btn btn-ghost" onclick="adminResetDroits()">Réinitialiser aux valeurs par défaut</button></div>`;
}

function canAccessOriginal(key,role){const map=defaultAccessMap();const base=adminAccessBaseRole(role);return(map[key]||["admin"]).includes(base)}

function adminFilterDroitsTable(){
  const q=normalizedSearchText(document.getElementById("admin-right-search")?.value||"");
  const onlyExceptions=!!document.getElementById("admin-right-only-exceptions")?.checked;
  let shown=0;
  document.querySelectorAll("[data-admin-right-row]").forEach(row=>{
    const matches=!q||String(row.dataset.search||"").includes(q);
    const hasException=(+row.dataset.exceptions||0)>0;
    const ok=matches&&(!onlyExceptions||hasException);
    row.style.display=ok?"":"none";
    if(ok)shown++;
  });
  const count=document.getElementById("admin-right-visible-count");
  if(count)count.textContent=shown+" module(s)";
}

async function adminToggleDroit(m,r,enabled){
  if(!isAdminSystemSession()){toast("Accès réservé au compte Administration système","error");renderView();return}
  if(!db.droitsAcces)db.droitsAcces={};
  const key=m+":"+r;
  const previous=db.droitsAcces[key];
  const def=canAccessOriginal(m,r);
  if(enabled===def)delete db.droitsAcces[key];
  else db.droitsAcces[key]=enabled;
  try{
    await SGDI.auth.saveAccessRules(Object.entries(db.droitsAcces).map(([k,v])=>{const parts=k.split(":");return{module_key:parts[0],role:parts[1],allowed:!!v}}))
  }catch(e){
    if(previous===undefined)delete db.droitsAcces[key];else db.droitsAcces[key]=previous;
    toast("Droit PostgreSQL refusé : "+(e.message||e),"error");
    renderView();
    return
  }
  logActivity("Modification droits",enabled===def?m+":"+r+"=défaut":m+":"+r+"="+enabled);
  toast(enabled===def?"Exception retirée : retour au défaut":"Exception enregistrée","success");
  render();
}

async function adminResetDroits(){if(!isAdminSystemSession()){toast("Accès réservé au compte Administration système","error");return}const count=Object.keys(db.droitsAcces||{}).length;if(!count){toast("Aucune exception à réinitialiser","info");return}if(!confirm("Supprimer les "+count+" exception(s) techniques et revenir aux droits par défaut ?"))return;try{await SGDI.auth.saveAccessRules([])}catch(e){toast("Reset droits PostgreSQL refusé : "+(e.message||e),"error");return}db.droitsAcces={};logActivity("Reset droits d'accès","");toast("Exceptions supprimées, droits par défaut restaurés","success");render()}

function renderAdminNiveaux(view){
  const niv=ensureNiveauxAcces();
  view.innerHTML=`<div class="mb-4"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Administration système</div><h1 class="text-2xl font-black mt-1">Profils d'accès</h1><p class="text-sm text-slate-500 mt-1">Un profil définit les modules visibles, le type de compte compatible et le référentiel d'actions. Il est ensuite affecté aux utilisateurs.</p></div>
    <div class="card p-4 mb-4" style="background:#f8fafc;border-left:4px solid #7c3aed"><div class="font-black mb-1">Règle simple</div><div class="text-sm text-slate-600">Utilisateur = profil d'accès + périmètre société/site/structure. Les droits techniques restent disponibles dans la matrice avancée, mais les profils sont la méthode principale.</div></div>
    <div class="flex justify-end gap-2 mb-3"><button class="btn btn-secondary" onclick="navigate('admin/droits')">Droits techniques</button><button class="btn btn-primary" onclick="openAdminNiveauModal('')">Nouveau profil</button></div>
    <div class="grid grid-2 gap-3">${niv.sort((a,b)=>a.weight-b.weight).map(n=>{const modules=Array.isArray(n.modules)&&n.modules.length?n.modules:["Défaut système"];const actions=Array.isArray(n.actions)&&n.actions.length?n.actions:[];const roles=Array.isArray(n.roles)&&n.roles.length?n.roles:[];return`<div class="card p-4" style="border-left:4px solid ${n.color}">
      <div class="flex justify-between items-start gap-3">
        <div><div class="font-bold text-lg" style="color:${n.color}">${escapeHTML(n.label)}</div><div class="text-xs font-mono text-slate-500">${escapeHTML(n.code)} · poids ${n.weight}</div></div>
        <div class="flex gap-2"><button class="btn btn-ghost text-xs inline-flex items-center gap-1" title="Modifier" onclick="openAdminNiveauModal('${n.code}')"><img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%230360a8%22 stroke-width=%222.4%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M12 20h9%22/%3E%3Cpath d=%22M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z%22/%3E%3C/svg%3E" alt="" style="width:18px;height:18px;display:inline-block;vertical-align:middle"/> Modifier</button><button class="btn btn-ghost text-xs text-red-600 inline-flex items-center gap-1" title="Supprimer" onclick="adminDeleteNiveau('${n.code}')"><img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23dc2626%22 stroke-width=%222.4%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M3 6h18%22/%3E%3Cpath d=%22M8 6V4h8v2%22/%3E%3Cpath d=%22M19 6l-1 14H6L5 6%22/%3E%3Cpath d=%22M10 11v6%22/%3E%3Cpath d=%22M14 11v6%22/%3E%3C/svg%3E" alt="" style="width:18px;height:18px;display:inline-block;vertical-align:middle"/> Supprimer</button></div>
      </div>
      <div class="text-sm text-slate-600 mt-2">${escapeHTML(n.description||"")}</div>
      <div class="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <div><div class="font-black text-slate-500 uppercase mb-1">Types</div><div class="flex flex-wrap gap-1">${(roles.length?roles:["Tous"]).map(x=>`<span class="pill pill-gray">${escapeHTML(x)}</span>`).join("")}</div></div>
        <div><div class="font-black text-slate-500 uppercase mb-1">Modules</div><div class="flex flex-wrap gap-1">${modules.slice(0,6).map(x=>`<span class="pill pill-blue">${escapeHTML(adminProfileModuleLabel(x))}</span>`).join("")}${modules.length>6?`<span class="pill pill-gray">+${modules.length-6}</span>`:""}</div></div>
        <div><div class="font-black text-slate-500 uppercase mb-1">Actions prévues</div><div class="flex flex-wrap gap-1">${(actions.length?actions:["Défaut"]).slice(0,5).map(x=>`<span class="pill pill-green">${escapeHTML(ADMIN_LEVEL_ACTIONS.find(a=>a.key===x)?.label||x)}</span>`).join("")}</div></div>
      </div>
    </div>`}).join("")||`<div class="text-slate-400 text-sm">Aucun profil.</div>`}</div>`;
}

function adminNiveauCheckGrid(name,items,selected,cols){
  const set=new Set(Array.isArray(selected)?selected:[]);
  return `<div class="grid grid-cols-1 md:grid-cols-${cols||2} gap-2">${items.map(it=>{const key=typeof it==="string"?it:it.key;const label=typeof it==="string"?it:(it.label||it.key);return`<label class="flex items-center gap-2 p-2 rounded border border-slate-200 bg-white text-sm"><input type="checkbox" name="${name}" value="${escapeHTML(key)}" ${set.has(key)?"checked":""}/> <span>${escapeHTML(label)}</span></label>`}).join("")}</div>`;
}

function openAdminNiveauModal(code){
  const isNew=!code;
  const n=isNew?{code:"",label:"",description:"",weight:5,color:"#043970",roles:[],modules:[],actions:["read"],societes:[],structures:[],sensitive:[]}:db.niveauxAcces.find(x=>x.code===code);
  if(!n){toast("Niveau introuvable","error");return}
  const roles=normalizeAdminLevelList(n.roles,ADMIN_ACCESS_ROLES);
  const roleItems=ADMIN_ACCESS_ROLES.map(r=>({key:r,label:adminRoleDisplayLabel(r)}));
  const modules=normalizeAdminProfileModules(n.modules);
  const actions=normalizeAdminLevelList(n.actions,ADMIN_LEVEL_ACTIONS.map(a=>a.key));
  const societes=normalizeAdminLevelList(n.societes,SOCIETES);
  const structures=normalizeAdminLevelList(n.structures,ADMIN_STRUCTURES.map(s=>s.key));
  const sensitive=normalizeAdminLevelList(n.sensitive,ADMIN_LEVEL_SENSITIVE.map(s=>s.key));
  const secretariatSections=normalizeAdminLevelList(n.secretariatSections,SECRETARIAT_ACCESS_SECTIONS.map(s=>s.key));
  openModal(`<h3 class="font-bold text-lg mb-1">${isNew?"Nouveau profil d'accès":"Configurer le profil"}</h3>
    <p class="text-sm text-slate-500 mb-4">Définissez ce que les utilisateurs de ce profil peuvent voir et faire.</p>
    <form onsubmit="event.preventDefault();confirmAdminNiveau('${n.code||''}')" class="space-y-4">
      <div class="grid grid-2 gap-3">
        <div><label class="label">Code *</label><input class="input" name="code" value="${escapeHTML(n.code)}" placeholder="Ex: SUP_OPS ou DRH_VALIDATION" ${isNew?"":"readonly"}/></div>
        <div><label class="label">Nom du profil *</label><input class="input" name="label" value="${escapeHTML(n.label)}" placeholder="Ex: Superviseur OPS"/></div>
        <div><label class="label">Poids hiérarchique (1-10)</label><input class="input" name="weight" type="number" min="1" max="10" value="${Number(n.weight)||5}"/></div>
        <div><label class="label">Couleur</label><input class="input" name="color" type="color" value="${escapeHTML(n.color||"#043970")}"/></div>
      </div>
      <div><label class="label">Description</label><textarea class="input" name="description" rows="2" placeholder="Expliquez le périmètre de ce profil">${escapeHTML(n.description||"")}</textarea></div>
      <div class="card p-3 bg-slate-50"><div class="font-black mb-2">1. Types de compte compatibles</div>${adminNiveauCheckGrid("roles",roleItems,roles,4)}</div>
      <div class="card p-3 bg-slate-50"><div class="font-black mb-2">2. Modules autorisés</div><div class="text-xs text-slate-500 mb-2">Une coche sur OPS couvre aussi missions, mouvements et supervision OPS. Vide = droits par défaut du type de compte.</div>${adminNiveauCheckGrid("modules",ADMIN_PROFILE_MODULES,modules,3)}</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="card p-3 bg-slate-50"><div class="font-black mb-2">3. Sociétés par défaut</div><div class="text-xs text-slate-500 mb-2">Vide = toutes, sauf restriction dans la fiche utilisateur.</div>${adminNiveauCheckGrid("societes",SOCIETES,societes,1)}</div>
        <div class="card p-3 bg-slate-50"><div class="font-black mb-2">4. Structures par défaut</div><div class="text-xs text-slate-500 mb-2">Vide = toutes, sauf restriction dans la fiche utilisateur.</div>${adminNiveauCheckGrid("structures",ADMIN_STRUCTURES,structures,1)}</div>
      </div>
      <div class="card p-3 bg-slate-50"><div class="font-black mb-2">5. Actions prévues</div><div class="text-xs text-slate-500 mb-2">Référentiel lisible du profil. Les modules cochés restent le verrou principal appliqué par l'application.</div>${adminNiveauCheckGrid("actions",ADMIN_LEVEL_ACTIONS,actions,4)}</div>
      <div class="card p-3 bg-slate-50"><div class="font-black mb-2">6. Droits sensibles</div>${adminNiveauCheckGrid("sensitive",ADMIN_LEVEL_SENSITIVE,sensitive,2)}</div>
      <div class="card p-3" style="background:#f0fdfa;border-color:#99f6e4"><div class="font-black mb-1">7. Rubriques du Secrétariat Général</div><div class="text-xs text-slate-500 mb-2">Utilisé pour les comptes SECxx. Le droit « Valider » reste obligatoire pour valider officiellement un ordre de mission.</div>${adminNiveauCheckGrid("secretariatSections",SECRETARIAT_ACCESS_SECTIONS,secretariatSections,3)}</div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer le profil</button></div>
    </form>`);
}

function confirmAdminNiveau(originalCode){
  if(!isAdminSystemSession()){toast("Accès réservé au compte Administration système","error");return}
  const f=document.querySelector(".modal-bg form");if(!f)return;
  const fd=new FormData(f);
  const code=String(fd.get("code")||"").trim().toUpperCase().replace(/\s+/g,"_");
  const label=String(fd.get("label")||"").trim();
  if(code.length<2){toast("Code profil obligatoire","error");return}
  if(!label){toast("Libellé obligatoire","error");return}
  const data={
    code,
    label,
    description:String(fd.get("description")||"").trim(),
    weight:Number(fd.get("weight"))||5,
    color:fd.get("color")||"#043970",
    roles:normalizeAdminLevelList(fd.getAll("roles"),ADMIN_ACCESS_ROLES),
    modules:normalizeAdminProfileModules(fd.getAll("modules")),
    societes:normalizeAdminLevelList(fd.getAll("societes"),SOCIETES),
    structures:normalizeAdminLevelList(fd.getAll("structures"),ADMIN_STRUCTURES.map(s=>s.key)),
    actions:normalizeAdminLevelList(fd.getAll("actions"),ADMIN_LEVEL_ACTIONS.map(a=>a.key)),
    sensitive:normalizeAdminLevelList(fd.getAll("sensitive"),ADMIN_LEVEL_SENSITIVE.map(s=>s.key)),
    secretariatSections:normalizeAdminLevelList(fd.getAll("secretariatSections"),SECRETARIAT_ACCESS_SECTIONS.map(s=>s.key)),
    updatedAt:new Date().toISOString(),
    updatedBy:session?session.username:"system"
  };
  if(!originalCode){if(db.niveauxAcces.find(n=>n.code===data.code)){toast("Code déjà utilisé","error");return}db.niveauxAcces.push(data);logActivity("Création niveau d'accès",data.code)}
  else{const idx=db.niveauxAcces.findIndex(n=>n.code===originalCode);if(idx<0)return;db.niveauxAcces[idx]={...db.niveauxAcces[idx],...data};logActivity("Modification niveau d'accès",data.code)}
  saveDB();closeModal();toast("Profil configuré","success");render();
}

function adminDeleteNiveau(code){if(!isAdminSystemSession()){toast("Accès réservé au compte Administration système","error");return}if(!confirm("Supprimer le profil "+code+" ?"))return;db.niveauxAcces=db.niveauxAcces.filter(n=>n.code!==code);logActivity("Suppression profil d'accès",code);saveDB();toast("Supprimé","success");render()}

SGDIModules.registerModule({key:"administration-permissions",routes:[]});
