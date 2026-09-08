/* Phase 2 — employees. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function setEffectifSociete(v){
  if(mySoc()){toast("Vous êtes sur "+mySoc()+". Utilisez Changer de société.","error");return}
  if(session?.transverse)sessionStorage.setItem(structureSocieteFilterKey(),v||"");
  else sessionStorage.setItem("effectifSociete",v||"");
  renderView();
}

function effectifRecapCardsHTML(activeFilter,showTitle,stable){
  const soc=effectifSocieteFilter();
  const ag=(db.agents||[]).filter(a=>!soc||a.societe===soc);
  // Pré-calcul O(m) des IDs en congé/maladie actifs — évite O(n×m) dans les filters
  const d=today();
  const congeIds=new Set();const maladieIds=new Set();
  (db.conges||[]).forEach(c=>{
    if(c.statut!=="approuve"||!c.agentId)return;
    if(!(c.du<=d&&(!c.au||c.au>=d)))return;
    if(c.type==="Maladie")maladieIds.add(c.agentId);else congeIds.add(c.agentId);
  });
  const rows=[
    {key:"operationnels",label:"Opérationnel",icon:"👮",route:"effectif/operationnels",color:"#16a34a",count:ag.filter(agentIsOperational).length},
    {key:"conge",label:"En congé",icon:"🏖",route:"effectif/conge",color:"#0360a8",count:ag.filter(a=>congeIds.has(a.id)).length},
    {key:"maladie",label:"En maladie",icon:"🤒",route:"effectif/maladie",color:"#f97316",count:ag.filter(a=>maladieIds.has(a.id)).length},
    {key:"absents",label:"En absence",icon:"❌",route:"effectif/absents",color:"#dc2626",count:ag.filter(a=>a.statut==="absent").length},
    {key:"suspension",label:"Suspendu",icon:"⏸",route:"effectif/suspension",color:"#7c3aed",count:ag.filter(a=>a.statut==="suspendu").length},
    {key:"sortant",label:"Sortant",icon:"➡",route:"effectif/sortant",color:"#475569",count:ag.filter(a=>["sortant","demissionne","licencie"].includes(a.statut)).length},
    {key:"blacklist",label:"BLACKLIST",icon:"⛔",route:"effectif/blacklist",color:"#111827",count:ag.filter(a=>a.blacklist).length}
  ];
  return `${showTitle?`<div class="mb-5"><h1 class="text-2xl font-bold">Effectifs</h1><p class="text-sm text-slate-500">Récapitulatif des situations du personnel${soc?` · <span class="font-semibold text-amber-700">${escapeHTML(soc)}</span>`:""}.</p></div>`:""}<div class="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-4 mb-5">${rows.map(r=>`<a href="${stable?"javascript:void(0)":`#/${r.route}`}" data-effectif-card="${r.key}" data-effectif-color="${r.color}" onclick="${stable?`event.preventDefault();setEffectifStableFilter('${r.key}');return false`:``}" class="card p-5 text-center kpi-clickable" style="text-decoration:none;color:inherit;border:2px solid ${activeFilter===r.key?r.color:r.color+"22"};background:${r.color}08;min-height:154px;outline:none">
      <div style="font-size:34px;color:${r.color}">${r.icon}</div>
      <div class="text-xs font-black uppercase text-slate-500 mt-2">${r.label}</div>
      <div class="text-4xl font-black mt-2" style="color:${r.color}">${r.count}</div>
    </a>`).join("")}</div>`;
}

function drhEffectifActionsBarHTML(){
  const btns=[
    {k:"detail",           l:"DETAIL",             c:"#1e3a8a"},
    {k:"maladie",          l:"MALADIE",            c:"#f97316"},
    {k:"conge",            l:"CONGÉ",              c:"#0369a1"},
    {k:"rec_periode_essai",l:"REC/PERIODE D'ESSAI",c:"#7c3aed"},
    {k:"suspendre",        l:"SUSPENDRE",          c:"#dc2626"},
    {k:"convoquer",        l:"CONVOQUER",          c:"#0c4a6e"},
    {k:"blacklister",      l:"BLACKLISTER",        c:"#111827"},
    {k:"mise_en_demeure",  l:"MISE EN DEMEURE",    c:"#b45309"},
    {k:"periode_enc",      l:"PERIODE E-N-C",      c:"#7c2d12"},
    {k:"sanctionner",      l:"SANCTIONNER",        c:"#9f1239"},
    {k:"avenant",          l:"AVENANT",            c:"#0f766e"},
    {k:"nouveau_contrat",  l:"NOUVEAU CONTRAT",    c:"#1d4ed8"},
    {k:"fin_contrat",      l:"FIN DE CONTRAT",     c:"#374151"},
  ];
  return `<section class="drh-effectif-actions-card">
    <div class="drh-effectif-actions-head">
      <h3>Actions à faire</h3>
      <span>Fiche en lecture seule · actions RH autorisées</span>
    </div>
    <div class="drh-effectif-actions-bar">${btns.map(({k,l,c})=>`<button type="button" class="drh-effectif-action-btn" onclick="openRhEffectifActionModal('${k}')" style="--action-color:${c}">${l}</button>`).join("")}</div>
  </section>`;
}

function latestSuspensionEvent(a){
  return (a?.gestionEvents||[])
    .filter(e=>String(e?.type||"").toLowerCase()==="suspension")
    .sort((x,y)=>String(y?.createdAt||y?.du||"").localeCompare(String(x?.createdAt||x?.du||"")))[0]||null;
}

function drhSuspensionOverviewHTML(list){
  const rows=Array.isArray(list)?list:[];
  const now=today();
  const events=rows.map(a=>latestSuspensionEvent(a));
  const endingSoon=events.filter(e=>{
    if(!e?.au)return false;
    const days=Math.ceil((new Date(`${e.au}T00:00:00`).getTime()-new Date(`${now}T00:00:00`).getTime())/86400000);
    return days>=0&&days<=7;
  }).length;
  const overdue=events.filter(e=>e?.au&&e.au<now).length;
  const missing=events.filter(e=>!e?.au).length;
  return `<section class="drh-suspension-overview">
    <div class="drh-suspension-overview-copy">
      <span class="drh-suspension-kicker">Suivi RH</span>
      <h2>Situation des suspensions</h2>
      <p>Une vue simple des dossiers actifs et des échéances à traiter.</p>
    </div>
    <div class="drh-suspension-stats" aria-label="Statistiques des suspensions">
      <div><span>Agents suspendus</span><strong>${rows.length}</strong></div>
      <div class="is-warning"><span>Fin sous 7 jours</span><strong>${endingSoon}</strong></div>
      <div class="is-danger"><span>Échéances dépassées</span><strong>${overdue}</strong></div>
      <div><span>Dossiers à compléter</span><strong>${missing}</strong></div>
    </div>
    <button type="button" class="drh-suspension-primary-action" onclick="openRhEffectifActionModal('suspendre')">+ Nouvelle suspension</button>
  </section>`;
}

function rhEffectifActionsHTML(){
  const actions=drhEmployeeActionLabels(false);
  return `<div class="mb-5"><h1 class="text-2xl font-bold">Effectifs</h1><p class="text-sm text-slate-500">Actions RH sur le personnel.</p></div>
    <div class="card p-4 mb-5">
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${actions.map(([k,l])=>`<button type="button" class="btn btn-secondary justify-center" onclick="openRhEffectifActionModal('${k}')">${l}</button>`).join("")}
      </div>
    </div>`;
}

function drhEmployeeActionLabels(includeDetail=true){
  const actions=[
    ["maladie","MALADIE"],["conge","CONGÉ"],["rec_periode_essai","REC/PERIODE D'ESSAI"],["suspendre","SUSPENDRE"],["convoquer","CONVOQUER"],["blacklister","BLACKLISTER"],["mise_en_demeure","MISE EN DEMEURE"],
    ["periode_enc","PERIODE E-N-C"],["sanctionner","SANCTIONNER"],["avenant","AVENANT"],["nouveau_contrat","NOUVEAU CONTRAT"],["fin_contrat","FIN DE CONTRAT"]
  ];
  return includeDetail?[["detail","DETAIL"],...actions]:actions;
}

function employeeFicheRhActionsHTML(a){
  if(!a||!canUseEmployeeActionWorkflows())return `<div class="text-sm text-slate-500">Aucune action disponible depuis ce module.</div>`;
  if(isOpsFicheReadOnlyContext())return `<div class="text-sm text-slate-500">Lecture simple OPS : aucune action de modification disponible depuis cette fiche.</div>`;
  const labels=isOpsFicheContext()?opsEmployeeActionLabels():drhEmployeeActionLabels(true);
  const btnStyle="height:34px;flex:1 1 0;min-width:0;padding:0 7px;border-radius:0!important;border:1px solid #d7dde8!important;background:linear-gradient(180deg,#ffffff,#eef4fb)!important;color:#082a53!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 6px rgba(15,23,42,.07)!important;font-size:clamp(8.5px,.64vw,10.5px)!important;font-weight:950!important;letter-spacing:0!important;line-height:1.05!important;text-align:center!important;white-space:normal!important;overflow-wrap:normal!important;word-break:normal!important";
  return `<div class="mb-4" style="display:flex;flex-wrap:nowrap;gap:6px;width:100%;overflow-x:auto;padding-bottom:2px">
    ${labels.map(([k,l])=>`<button type="button" class="btn justify-center relative" style="${btnStyle}" onclick="runRhEffectifAction('${k}','${escapeHTML(a.id)}')">${l}</button>`).join("")}
  </div>`;
}

function rhEffectifActionLabel(action){
  return {detail:"DETAIL",maladie:"MALADIE",conge:"CONGÉ",rec_periode_essai:"REC/PERIODE D'ESSAI",suspendre:"SUSPENDRE",lever_suspension:"LEVER SUSPENSION",convoquer:"CONVOQUER",blacklister:"BLACKLISTER",lever_blacklist:"LEVER BLACKLIST",mise_en_demeure:"MISE EN DEMEURE",periode_enc:"PERIODE E-N-C",sanctionner:"SANCTIONNER",avenant:"AVENANT",nouveau_contrat:"NOUVEAU CONTRAT",fin_contrat:"FIN DE RELATION DE TRAVAIL",integrer:"REINTEGRER"}[action]||"ACTION";
}

function rhEffectifEmployeeSearchText(a){
  return normalizedSearchText([a.matricule,a.code,a.nom,a.prenom,a.societe,a.fonction,a.position,a.posteContrat,a.telephone,a.tel,a.email].filter(Boolean).join(" "));
}

function updateRhEffectifEmployeeSearch(value){
  const box=document.getElementById("rh-effectif-employee-results");if(!box)return;
  const terms=normalizedSearchText(value).split(/\s+/).filter(Boolean);
  const matches=rhEffectifActionTargets().filter(a=>terms.length&&terms.every(term=>rhEffectifEmployeeSearchText(a).includes(term))).slice(0,12);
  box.innerHTML=matches.length?matches.map(a=>`<button type="button" class="rh-employee-search-result" onclick="selectRhEffectifEmployee('${jsString(a.id)}')"><span><b>${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim()||"Employé")}</b><small>${escapeHTML([a.matricule,a.fonction||a.position||a.posteContrat].filter(Boolean).join(" · ")||"Informations non renseignées")}</small></span><em>${escapeHTML(a.societe||"")}</em></button>`).join(""):`<div class="rh-employee-search-empty">${terms.length?"Aucun employé ne correspond à cette recherche.":"Saisissez un ou plusieurs critères pour rechercher un employé."}</div>`;
}

function selectRhEffectifEmployee(id){
  const a=findEmployeeByRef(id);if(!a)return;
  const form=document.getElementById("rh-effectif-employee-search-form");if(!form)return;
  form.elements.agentId.value=a.id;
  const input=document.getElementById("rh-effectif-employee-search-input");if(input)input.value=[a.matricule,((a.nom||"")+" "+(a.prenom||"")).trim()].filter(Boolean).join(" — ");
  const box=document.getElementById("rh-effectif-employee-results");if(box)box.innerHTML=`<div class="rh-employee-search-selected"><span><b>${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())}</b><small>${escapeHTML([a.matricule,a.fonction||a.position||a.posteContrat,a.societe].filter(Boolean).join(" · "))}</small></span><i>✓ Sélectionné</i></div>`;
  const submit=document.getElementById("rh-effectif-employee-next");if(submit)submit.disabled=false;
}

function submitRhEffectifActionSelection(form,action){
  const agentId=form?.elements?.agentId?.value||"";if(!agentId){toast("Sélectionnez un employé dans les résultats","error");return}
  runRhEffectifAction(action,agentId);
}

function openRhEffectifActionModal(action){
  if(action!=="detail"&&guardOpsSupervisorMutation("employee-action","Accès superviseur OPS : action RH non autorisée."))return;
  const list=rhEffectifActionTargets();
  if(!list.length){toast("Aucun employé disponible pour cette action","error");return}
  const label=rhEffectifActionLabel(action);
  openModal(`<h3 class="font-bold text-lg mb-3">${escapeHTML(label)}</h3>
    <form id="rh-effectif-employee-search-form" onsubmit="event.preventDefault();submitRhEffectifActionSelection(this,'${action}')">
      <label class="label" for="rh-effectif-employee-search-input">Employé concerné</label>
      <div class="rh-employee-multisearch"><span aria-hidden="true">⌕</span><input id="rh-effectif-employee-search-input" type="search" autocomplete="off" autofocus placeholder="Matricule, nom, prénom, société, fonction, téléphone…" oninput="this.form.elements.agentId.value='';document.getElementById('rh-effectif-employee-next').disabled=true;updateRhEffectifEmployeeSearch(this.value)"/></div>
      <input type="hidden" name="agentId" value=""/>
      <div id="rh-effectif-employee-results" class="rh-employee-search-results"><div class="rh-employee-search-hint">Saisissez un ou plusieurs critères pour rechercher un employé.</div></div>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button id="rh-effectif-employee-next" class="btn btn-primary" disabled>Suivant</button></div>
    </form>`);
}

function printEmployeeSuspensionDecisionFromForm(form){
  const draft=employeeSuspensionDraftFromForm(form);
  if(!draft.a){toast("Employé introuvable","error");return}
  const sw=screen.width||1280,sh=screen.height||800,ww=Math.min(960,sw-80),wh=Math.min(820,sh-80);
  const left=Math.round((sw-ww)/2),top=Math.round((sh-wh)/2);
  const w=window.open("","sgdi_susp_"+Date.now(),"popup=yes,width="+ww+",height="+wh+",left="+left+",top="+top+",scrollbars=yes,resizable=yes");
  if(!w){toast("Fenêtre bloquée par le navigateur — autorisez les popups pour ce site","error");return}
  w.document.write(prepareEmployeeDocumentForValidation(suspensionDecisionHTML(draft.a,draft),{agentId:draft.a.id,title:"Décision de suspension",category:"Décisions RH",type:"suspension",reference:draft.ref||"",date:draft.du||today()},"Valider décision"));
  w.document.close();
}

function employeeRowActionsButton(a){
  if(isDrhModuleContext())return "";
  if(isOpsEffectifContext())return "";
  if(!canUseEmployeeActionWorkflows())return "";
  return `<button type="button" class="btn btn-ghost text-lg leading-none px-2" title="Actions" aria-label="Actions employé" onclick="openEmployeeRowActions(event,'${escapeHTML(a.id)}')">...</button>`;
}

function renderEffectifRecap(view){
  const current=sessionStorage.getItem("effectifStableFilter")||"actifs";
  renderEffectif(view,current,true);
}

function setEffectifStableFilter(filter){
  filter=filter||"actifs";
  sessionStorage.setItem("effectifStableFilter",filter);
  const view=document.getElementById("view");
  const scrollTop=view?view.scrollTop:0;
  const zone=document.getElementById("effectif-list-zone");
  document.querySelectorAll("[data-effectif-card]").forEach(card=>{
    const color=card.dataset.effectifColor||"#043970";
    const active=card.dataset.effectifCard===filter;
    card.style.borderColor=active?color:(color+"22");
    card.blur&&card.blur();
  });
  if(zone){zone.innerHTML=effectifListHTML(filter);sgdiApplyActiveEmployeeStyles(zone);updateEffectifBulkDeleteButton();applyEffectifSearchInPlace(effectifSearchValue(filter))}
  requestAnimationFrame(()=>{const v=document.getElementById("view");if(v)v.scrollTop=scrollTop});
  if(!zone&&view)renderEffectif(view,filter,true);
}

function effectifSocieteBandHTML(baseList){
  const soc=effectifSocieteFilter();
  const imgs=loadSocieteImages();
  const countFor=s=>(baseList||[]).filter(a=>a.societe===s).length;
  const chip=(label,value,count,img,active)=>{
    const visual=img?`<img src="${img}" alt="${escapeHTML(label)}" style="width:32px;height:32px;object-fit:contain;border-radius:999px;background:#fff"/>`:`<span style="font-size:24px">🏢</span>`;
    return`<button type="button" onclick="setEffectifSociete('${String(value||"").replace(/'/g,"\\'")}')" class="card p-3 text-left transition" style="${active?"border:2px solid #0360a8;box-shadow:0 4px 12px rgba(3,96,168,.22);background:#e0f2fe":"border:2px solid transparent;background:#fff"}">
      <div class="flex items-center justify-between mb-2">${visual}<span class="pill ${active?"pill-blue":"pill-gray"}" style="font-weight:800">${count}</span></div>
      <div class="text-[10px] font-black uppercase tracking-wide" style="color:${active?"#0360a8":"#475569"};line-height:1.15">${escapeHTML(label)}</div>
    </button>`;
  };
  return`<div class="card p-4 mb-4" style="background:#f8fafc">
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <h3 class="text-sm font-bold uppercase tracking-wider text-slate-700">🏢 Section société</h3>
      ${soc?`<button class="btn btn-ghost text-xs" onclick="setEffectifSociete('')">Réinitialiser</button>`:`<span class="text-xs text-slate-500">Toutes les sociétés</span>`}
    </div>
    <div class="grid grid-5 gap-3">
      ${chip("Toutes les sociétés","",(baseList||[]).length,"",!soc)}
      ${SOCIETES.map(s=>chip(s,s,countFor(s),imgs[s]||defaultSocieteLogo(s),soc===s)).join("")}
    </div>
  </div>`;
}

function setOpsEffectifFilter(k,v){
  const f=opsEffectifFilters();
  f[k]=String(v||"");
  sessionStorage.setItem("opsEffectifFilters",JSON.stringify(f));
  setEffectifStableFilter(sessionStorage.getItem("effectifStableFilter")||"actifs");
}

function setOpsEffectifSearch(v){
  clearTimeout(opsEffectifSearchTimer);
  const f=opsEffectifFilters();
  f.q=String(v||"");
  sessionStorage.setItem("opsEffectifFilters",JSON.stringify(f));
  opsEffectifSearchTimer=setTimeout(()=>applyOpsEffectifSearchInPlace(v),80);
}

function resetOpsEffectifFilters(){sessionStorage.removeItem("opsEffectifFilters");setEffectifStableFilter(sessionStorage.getItem("effectifStableFilter")||"actifs")}

function opsEffectifAdvancedOpen(){return sessionStorage.getItem("opsEffectifAdvanced")==="1"}

function toggleOpsEffectifAdvanced(){sessionStorage.setItem("opsEffectifAdvanced",opsEffectifAdvancedOpen()?"0":"1");setEffectifStableFilter(sessionStorage.getItem("effectifStableFilter")||"actifs")}

function applyOpsEffectifSearchInPlace(v){
  const q=String(v||"").trim().toLowerCase();
  const rows=[...document.querySelectorAll("#effectif-list-zone tbody tr[data-searchable]")];
  if(!rows.length)return;
  let shown=0;
  rows.forEach(row=>{
    const ok=!q||(row.textContent||"").toLowerCase().includes(q);
    row.style.display=ok?"":"none";
    if(ok)shown++;
  });
  const count=document.getElementById("ops-effectif-result-count");
  if(count)count.textContent=shown+" résultat(s) affiché(s)";
}

function setEffectifSearch(v,filter){
  if(isOpsEffectifContext()){setOpsEffectifSearch(v);return}
  sessionStorage.setItem(effectifSearchKey(filter),String(v||""));
  applyEffectifSearchInPlace(v);
}

function applyEffectifSearchInPlace(v){
  if(isOpsEffectifContext()){applyOpsEffectifSearchInPlace(v);return}
  const q=String(v||"").trim().toLowerCase();
  const rows=[...document.querySelectorAll("#effectif-list-zone tbody tr[data-searchable]")];
  let shown=0;
  rows.forEach(row=>{
    const ok=!q||(row.textContent||"").toLowerCase().includes(q);
    row.style.display=ok?"":"none";
    if(ok)shown++;
  });
  const count=document.getElementById("effectif-search-result-count");
  if(count)count.textContent=q?shown+" résultat(s) affiché(s)":"";
}

function effectifHeaderSearchHTML(filter){
  const q=escapeHTML(effectifSearchValue(filter));
  return `<div class="effectif-header-search">
    <input class="input text-center" data-no-lock value="${q}" placeholder="Recherche nom / prénom / code" oninput="setEffectifSearch(this.value,'${escapeHTML(filter||"actifs")}')"/>
    <div id="effectif-search-result-count" class="text-[11px] text-slate-500 mt-1"></div>
  </div>`;
}

function opsEffectifHeaderSearchHTML(){
  if(!isOpsEffectifContext())return "";
  const q=escapeHTML((opsEffectifFilters().q)||"");
  return `<input class="input" data-no-lock style="width:320px;max-width:42vw" value="${q}" placeholder="Nom / Prénom / Code" oninput="setOpsEffectifSearch(this.value)"/>`;
}

function opsEffectifFiltersHTML(sourceList,filteredCount){
  if(!isOpsEffectifContext())return "";
  const f=opsEffectifFilters();
  const soc=effectifSocieteFilter();
  const advanced=opsEffectifAdvancedOpen();
  const sites=(db.sites||[]).filter(s=>siteMatchesSociete(s,soc)).sort((a,b)=>(a.nom||"").localeCompare(b.nom||""));
  const postes=[...new Set((sourceList||[]).map(a=>agentLiveAffectation(a)?.poste||a.affectationCourante?.poste||a.fonction||a.position||"").filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const situations=[...new Set((sourceList||[]).map(a=>a.situation||"").filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const val=k=>escapeHTML(f[k]||"");
  return `<div class="card ops-effectif-filter-card">
    <div class="ops-effectif-filter-main">
      <div><label class="label">Site</label><select class="select" data-no-lock onchange="setOpsEffectifFilter('site',this.value)"><option value="">Tous les sites</option><option value="__none__" ${f.site==="__none__"?"selected":""}>Sans affectation</option>${sites.map(s=>`<option value="${escapeHTML(s.id)}" ${String(f.site||"")===String(s.id)?"selected":""}>${escapeHTML(s.nom||s.intitule||"Site")}</option>`).join("")}</select></div>
      <div><label class="label">Poste / fonction</label><select class="select" data-no-lock onchange="setOpsEffectifFilter('poste',this.value)"><option value="">Toutes fonctions</option>${postes.map(p=>`<option value="${escapeHTML(p)}" ${f.poste===p?"selected":""}>${escapeHTML(p)}</option>`).join("")}</select></div>
      <div><label class="label">Situation familiale</label><select class="select" data-no-lock onchange="setOpsEffectifFilter('situation',this.value)"><option value="">Toutes situations</option>${situations.map(s=>`<option value="${escapeHTML(s)}" ${f.situation===s?"selected":""}>${escapeHTML(s)}</option>`).join("")}</select></div>
      <div class="ops-effectif-filter-actions"><button type="button" class="btn btn-secondary text-xs" onclick="toggleOpsEffectifAdvanced()">${advanced?"Masquer filtres":"Filtres avancés"}</button><button type="button" class="btn btn-ghost text-xs" onclick="resetOpsEffectifFilters()">Réinitialiser</button></div>
    </div>
    <div id="ops-effectif-result-count" class="ops-effectif-result-count">${filteredCount} résultat(s) affiché(s)</div>
    ${advanced?`<div class="ops-effectif-advanced">
      <div><label class="label">Recrutement du</label><input class="input" data-no-lock type="date" value="${val("recrutFrom")}" onchange="setOpsEffectifFilter('recrutFrom',this.value)"/></div>
      <div><label class="label">Recrutement au</label><input class="input" data-no-lock type="date" value="${val("recrutTo")}" onchange="setOpsEffectifFilter('recrutTo',this.value)"/></div>
      <div><label class="label">Naissance du</label><input class="input" data-no-lock type="date" value="${val("birthFrom")}" onchange="setOpsEffectifFilter('birthFrom',this.value)"/></div>
      <div><label class="label">Naissance au</label><input class="input" data-no-lock type="date" value="${val("birthTo")}" onchange="setOpsEffectifFilter('birthTo',this.value)"/></div>
      <div><label class="label">Age min</label><input class="input" data-no-lock type="number" min="0" value="${val("ageMin")}" onchange="setOpsEffectifFilter('ageMin',this.value)"/></div>
      <div><label class="label">Age max</label><input class="input" data-no-lock type="number" min="0" value="${val("ageMax")}" onchange="setOpsEffectifFilter('ageMax',this.value)"/></div>
    </div>`:""}
  </div>`;
}

function effectifModeToApi(filter){return filter||"actifs"}

function effectifServerSupported(filter){return ["actifs","absents","suspension","sortant","blacklist"].includes(filter||"actifs")}

function effectifPageStorageKey(filter){return "effectifPage:"+effectifModeToApi(filter)+":"+(effectifSocieteFilter()||"")}

function effectifCurrentPage(filter){return Math.max(parseInt(sessionStorage.getItem(effectifPageStorageKey(filter))||"1",10)||1,1)}

function setEffectifPage(filter,page){sessionStorage.setItem(effectifPageStorageKey(filter),String(Math.max(parseInt(page||1,10)||1,1)));renderView()}

function effectifBulkDeleteToolbarHTML(){
  if(!isAdminFichePositionContext())return "";
  return `<div class="card p-3 mb-3 flex items-center justify-between gap-3 flex-wrap" style="background:#fff7ed;border-color:#fed7aa">
    <label class="flex items-center gap-2 text-sm font-black text-slate-700">
      <input type="checkbox" id="effectif-select-all-toolbar" onchange="toggleEffectifSelectAll(this.checked)" style="width:16px;height:16px"/>
      Tout sélectionner
    </label>
    <button type="button" id="effectif-bulk-delete-btn" class="btn btn-danger text-xs" onclick="deleteSelectedEffectifEmployees()" disabled>Supprimer sélection</button>
  </div>`;
}

function effectifSortHeaderHTML(key,label,extraClass){
  const cfg=EFFECTIF_SORT_COLUMNS[key];
  if(!cfg)return `<th${extraClass?` class="${extraClass}"`:""}>${escapeHTML(label)}</th>`;
  const activeAsc=effectifSort===cfg.asc,activeDesc=effectifSort===cfg.desc;
  const indicator=activeAsc?"▲":activeDesc?"▼":"↕";
  const next=activeAsc?cfg.desc:cfg.asc;
  return `<th${extraClass?` class="${extraClass}"`:""}><button type="button" class="effectif-sort-head ${activeAsc||activeDesc?"is-active":""}" onclick="setEffectifSort('${next}')" title="Trier par ${escapeHTML(label)}">${escapeHTML(label)} <span>${indicator}</span></button></th>`;
}

function effectifTableHeadersHTML(options){
  const opt=options||{};
  const opsHeaders=opt.ops?effectifSortHeaderHTML("naissance","Naissance")+effectifSortHeaderHTML("age","Age")+effectifSortHeaderHTML("situation","Situation"):"";
  return `${effectifSortHeaderHTML("employe","Employé")}${effectifSortHeaderHTML("code","Code")}${effectifSortHeaderHTML("societe","Société")}${effectifSortHeaderHTML("poste","Poste")}${effectifSortHeaderHTML("site","Site")}${effectifSortHeaderHTML("recrut","Recrut.")}${opsHeaders}${effectifSortHeaderHTML("statut","Statut")}<th>Action</th>${opt.actionHeader||""}`;
}

function employeeListRowHTML(a,filter){
  const aff=agentLiveAffectation(a);
  const deleteId=String(a.backendId||a.id||"");
  const deleteLabel=[a.matricule||"",((a.nom||"")+" "+(a.prenom||"")).trim()].filter(Boolean).join(" · ");
  const checkedCell=isAdminFichePositionContext()?`<td class="text-center effectif-select-cell"><input type="checkbox" class="effectif-row-select" value="${escapeHTML(deleteId)}" data-employee-id="${escapeHTML(a.id||"")}" data-backend-id="${escapeHTML(a.backendId||"")}" data-label="${escapeHTML(deleteLabel)}" onchange="updateEffectifBulkDeleteButton()" style="width:16px;height:16px"/></td>`:"";
  const opsCells=isOpsEffectifContext()?`<td data-label="Naissance" class="text-xs">${formatDate(a.dateNaissance)}</td><td data-label="Age" class="text-xs font-bold">${ageFromDate(a.dateNaissance)??"—"}</td><td data-label="Situation" class="text-xs">${safe(a.situation)}</td>`:"";
  return `<tr data-searchable data-employee-id="${escapeHTML(a.id)}" data-backend-id="${escapeHTML(a.backendId||"")}">${checkedCell}<td data-label="Employé" class="effectif-agent-cell"><div class="flex items-center gap-2"><div class="avatar">${a.photo?`<img src="${a.photo}"/>`:escapeHTML((a.prenom||"?").slice(0,1))}</div><div><div class="font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</div><div class="text-xs text-slate-500">${safe(a.telephone)}</div></div></div></td><td data-label="Code" class="font-mono font-bold text-amber-600">${safe(a.matricule)}</td><td data-label="Société" class="text-xs">${safe(a.societe)}</td><td data-label="Poste" class="text-xs">${safe(aff?.poste||a.affectationCourante?.poste||a.fonction||a.position)}</td><td data-label="Site" class="text-xs">${safe(aff?.siteName)}</td><td data-label="Recrutement" class="text-xs">${formatDate(a.dateRecrutement)}</td>${opsCells}<td data-label="Statut" class="effectif-status-cell">${employeeStatusPillHTML(a)}</td><td data-label="Action" class="effectif-open-cell"><div class="effectif-row-actions"><a class="btn btn-ghost text-xs effectif-open-btn" href="#/agents/${employeeRouteId(a)}">Ouvrir →</a>${employeeRowActionsButton(a)}</div></td>${filter==="instance_affectation"?(isOpsEffectifContext()?`<td data-label="Affectation" class="text-right"><button type="button" class="btn btn-primary text-xs" onclick="sessionStorage.setItem('opsMovementAgentId','${escapeHTML(a.id)}');navigate('ops/mouvements')">Affecter</button></td>`:`<td data-label="Affectation" class="text-right"><span class="text-xs text-slate-500">Verrouillé</span></td>`):""}</tr>`;
}

async function effectifListServerHTML(filter){
  if(isOpsEffectifContext())return null;
  if(!sgdiAuthToken()||!effectifServerSupported(filter))return null;
  const soc=effectifSocieteFilter();
  const page=effectifCurrentPage(filter);
  const pageSize=25;
  const result=await SGDI.employees.page({mode:effectifModeToApi(filter),society:soc,page,page_size:pageSize});
  const list=(result.items||[]).map(upsertServerEmployee);
  const titleMap={actifs:"Gestion des effectifs",absents:"Agents en absence",suspension:"Agents suspendus",sortant:"Sortant",blacklist:"BLACKLIST"};
  const title=titleMap[filter]||"Gestion des effectifs";
  const pages=result.pages||1;
  const pagination=`<div class="flex items-center justify-between gap-2 p-3 border-t border-slate-100 text-sm"><div class="text-slate-500">${result.total||0} employé(s) · page ${result.page||1}/${pages}</div><div class="flex gap-2"><button class="btn btn-ghost text-xs" ${result.page<=1?"disabled":""} onclick="setEffectifPage('${filter}',${(result.page||1)-1})">Précédent</button><button class="btn btn-ghost text-xs" ${result.page>=pages?"disabled":""} onclick="setEffectifPage('${filter}',${(result.page||1)+1})">Suivant</button></div></div>`;
  const selectHead=isAdminFichePositionContext()?`<th style="width:42px;text-align:center"><input type="checkbox" onchange="toggleEffectifSelectAll(this.checked)" style="width:16px;height:16px"/></th>`:"";
  return `<div class="effectif-page"><div class="drh-effectif-list-header"><div class="drh-effectif-title-block"><h1 class="text-2xl font-bold effectif-page-title">${title}</h1><p class="text-sm text-slate-500">${result.total||0} employé(s)${soc?` · ${escapeHTML(soc)}`:" · sociétés autorisées"}</p></div><div class="drh-effectif-search-slot">${effectifHeaderSearchHTML(filter)}</div><div class="drh-effectif-header-spacer"></div></div>
  ${isDrhModuleContext()&&filter!=="instance_affectation"?(filter==="suspension"?drhSuspensionOverviewHTML(list):drhEffectifActionsBarHTML()):""}
  ${effectifBulkDeleteToolbarHTML()}
  ${list.length===0?`<div class="card p-10 text-center text-slate-500">Aucun employé.</div>`:`<div class="card overflow-hidden effectif-table-card"><table class="effectif-table"><colgroup>${selectHead?`<col style="width:44px">`:""}<col style="width:28%"><col style="width:8%"><col style="width:13%"><col style="width:13%"><col style="width:10%"><col style="width:8%"><col style="width:108px"><col style="width:128px"></colgroup><thead><tr>${selectHead}${effectifTableHeadersHTML()}</tr></thead><tbody>${list.map(a=>employeeListRowHTML(a,filter)).join("")}</tbody></table>${pagination}</div>`}</div>`;
}

function effectifListHTML(filter){
  const data=effectifFilteredData(filter);
  const {list,title,soc,filterSource}=data;
  const actionHeader=filter==="instance_affectation"?"<th>Action</th>":"";
  const selectHead=isAdminFichePositionContext()?`<th style="width:42px;text-align:center"><input type="checkbox" onchange="toggleEffectifSelectAll(this.checked)" style="width:16px;height:16px"/></th>`:"";
  const sortHTML=`<select class="select" data-no-lock onchange="setEffectifSort(this.value)">
    <option value="nom_asc" ${effectifSort==="nom_asc"?"selected":""}>Nom A → Z</option>
    <option value="nom_desc" ${effectifSort==="nom_desc"?"selected":""}>Nom Z → A</option>
    <option value="recrut_asc" ${effectifSort==="recrut_asc"?"selected":""}>Recrutement (ancien → récent)</option>
    <option value="recrut_desc" ${effectifSort==="recrut_desc"?"selected":""}>Recrutement (récent → ancien)</option>
    <option value="mat_asc" ${effectifSort==="mat_asc"?"selected":""}>Code ↑</option>
    <option value="mat_desc" ${effectifSort==="mat_desc"?"selected":""}>Code ↓</option>
  </select>`;
  const opsHeader=isOpsEffectifContext()?`<div class="card ops-effectif-hero">
    <div class="ops-effectif-title-block"><h1 class="effectif-page-title">${escapeHTML(title)}</h1><p>${list.length} employé(s) · ${soc?escapeHTML(soc):"Toutes sociétés"}</p></div>
    <div class="ops-effectif-tools"><label><span>Recherche</span><input class="input" data-no-lock value="${escapeHTML(effectifSearchValue(filter))}" placeholder="Recherche nom / prénom / code" oninput="setEffectifSearch(this.value,'${escapeHTML(filter||"actifs")}')"/></label><label><span>Tri</span>${sortHTML}</label></div>
  </div>`:isDrhModuleContext()?`<div class="drh-effectif-list-header">
    <div class="drh-effectif-title-block">
      <h1 class="text-2xl font-black effectif-page-title" style="line-height:1.15">${escapeHTML(title)}</h1>
      <p class="text-xs text-slate-400 mt-0.5">${list.length} employé(s)${soc?` · ${escapeHTML(soc)}`:""}</p>
    </div>
    <div class="drh-effectif-search-slot">${effectifHeaderSearchHTML(filter)}</div>
    <div class="drh-effectif-sort-slot"><span class="text-xs text-slate-400 font-semibold uppercase tracking-widest">Tri</span>${sortHTML}</div>
  </div>`:`<div class="grid grid-cols-1 md:grid-cols-3 items-center gap-3 mb-4"><div><h1 class="text-2xl font-bold effectif-page-title">${title}</h1><p class="text-sm text-slate-500">${list.length} employé(s)${soc?` · ${escapeHTML(soc)}`:" · toutes sociétés"}</p></div>${effectifHeaderSearchHTML(filter)}<div class="flex items-center justify-end gap-2 flex-wrap"><span class="text-xs text-slate-500">Tri :</span><div style="max-width:260px">${sortHTML}</div></div></div>`;
  return `<div class="effectif-page ${isOpsEffectifContext()?"ops-effectif-page":""}">${opsHeader}
  ${isDrhModuleContext()&&filter!=="instance_affectation"?(filter==="suspension"?drhSuspensionOverviewHTML(list):drhEffectifActionsBarHTML()):""}
  ${opsEffectifFiltersHTML(filterSource,list.length)}
  ${effectifBulkDeleteToolbarHTML()}
  ${list.length===0?`<div class="card p-10 text-center text-slate-500">Aucun employé.</div>`:`<div class="card overflow-hidden effectif-table-card"><table class="effectif-table">
    <colgroup>${selectHead?`<col style="width:44px">`:""}<col style="width:28%"><col style="width:8%"><col style="width:13%"><col style="width:13%"><col style="width:10%"><col style="width:8%">${isOpsEffectifContext()?`<col style="width:8%"><col style="width:6%"><col style="width:8%">`:""}<col style="width:82px"><col style="width:96px">${actionHeader?`<col style="width:92px">`:""}</colgroup>
    <thead><tr>${selectHead}${effectifTableHeadersHTML({ops:isOpsEffectifContext(),actionHeader})}</tr></thead>
    <tbody>${list.map(a=>employeeListRowHTML(a,filter)).join("")}</tbody></table></div>`}</div>`;
}

function employeeHasContractForPreparation(a){
  if(!a)return false;
  if(a.contratPersonnelId||a.contratPersonnelTitre||a.typeContrat||a.dateRecrutement)return true;
  const rows=[...(Array.isArray(a.contrats)?a.contrats:[]),...(Array.isArray(a.gestionEvents)?a.gestionEvents:[])];
  return rows.some(r=>/contrat|recrutement|embauche/i.test([r?.type,r?.title,r?.titre,r?.motif,r?.reference].filter(Boolean).join(" ")));
}

function employeePreparationBlockers(a){
  const blockers=[];
  if(!employeeHasContractForPreparation(a))blockers.push({key:"contrat",label:"Contrat",route:"contrats/nouveau_contrat",action:"Créer contrat",color:"#dc2626"});
  if(employeeNeedsMaterialDotation(a))blockers.push({key:"dotation",label:"Dotation",route:"materiel/dotation",action:"Doter",color:"#0ea5e9"});
  if(agentNeedsAffectation(a))blockers.push({key:"affectation",label:"Affectation",route:"effectif/instance_affectation",action:"Affecter",color:"#f59e0b"});
  if(!agentNeedsDotation(a)&&!agentNeedsAffectation(a)&&!agentHasInstallationPV(a))blockers.push({key:"pv",label:"PV installation",route:"agents/"+employeeRouteId(a),action:"Ouvrir fiche",color:"#7c3aed"});
  return blockers;
}

function operationalPreparationColor(key){return {contrat:"#dc2626",dotation:"#0ea5e9",affectation:"#f59e0b",pv:"#7c3aed",pv_installation:"#7c3aed"}[key]||"#043970"}

function operationalPreparationActionHTML(blocker,agentId){
  const action=escapeHTML(blocker?.action||"Ouvrir");
  if(blocker?.key==="affectation")return `<button type="button" class="btn btn-secondary text-xs" onclick="sessionStorage.setItem('opsMovementAgentId','${jsString(agentId)}');navigate('ops/mouvements')">${action}</button>`;
  return `<a class="btn btn-secondary text-xs" href="#/${escapeHTML(blocker?.route||"effectif/preparation")}">${action}</a>`;
}

function operationalPreparationFilterKey(filter){
  return {preparation_contrat:"contrat",preparation_dotation:"dotation",preparation_affectation:"affectation",preparation_pv:"pv",pv:"pv",dotation:"dotation",affectation:"affectation",contrat:"contrat"}[filter]||"";
}

function localOperationalPreparationData(filter){
  const drhScope=isDrhModuleContext();
  const soc=drhScope&&typeof drhActiveSocieteFilter==="function"?drhActiveSocieteFilter():effectifSocieteFilter();
  const source=drhScope&&typeof drhAgentsList==="function"?drhAgentsList():(db.agents||[]);
  const all=source.filter(a=>(!soc||normalizeSocieteName(a.societe)===normalizeSocieteName(soc))&&!employeeIsFormer(a));
  const rows=all.map(a=>({a,blockers:employeePreparationBlockers(a)})).filter(r=>r.blockers.length);
  const filterKey=operationalPreparationFilterKey(filter);
  const visibleRows=filterKey?rows.filter(r=>r.blockers.some(b=>b.key===filterKey)):rows;
  const count=k=>rows.filter(r=>r.blockers.some(b=>b.key===k)).length;
  return {society:soc,total:rows.length,filterKey,counters:{contrat:count("contrat"),dotation:count("dotation"),affectation:count("affectation"),pv_installation:count("pv")},items:visibleRows.map(({a,blockers})=>{const aff=agentLiveAffectation(a);return{employee_id:a.id,code:a.matricule,name:((a.nom||"")+" "+(a.prenom||"")).trim(),society:a.societe,position:aff?.poste||a.affectationCourante?.poste||a.fonction||a.position,site:aff?.siteName||"Sans affectation",statut:a.statut||a.status||"actif",blockers,recommended_action:blockers[0]}}),source:"local"};
}

function operationalPreparationHTML(data,source){
  const soc=data?.society||effectifSocieteFilter();
  const counters=data?.counters||{};
  const items=data?.items||[];
  const filterKey=data?.filterKey||"";
  const activeStyle=key=>filterKey===key?"box-shadow:0 0 0 2px currentColor inset;":"";
  const filterTitles={affectation:"EFFECTIF SANS AFFECTATION",dotation:"SANS DOTATION",contrat:"SANS CONTRAT",pv:"SANS PV D'INSTALLATION"};
  const pageTitle=filterKey&&filterTitles[filterKey]?filterTitles[filterKey]:"Préparation opérationnelle";
  const pageSubtitle=filterKey&&filterTitles[filterKey]?(soc?`<b>${escapeHTML(soc)}</b>`:""):`Employés non opérationnels avec les étapes bloquantes${soc?` · <b>${escapeHTML(soc)}</b>`:""}`;
  const cards=[
    ["Contrat",counters.contrat||0,"#dc2626"],
    ["Dotation",counters.dotation||0,"#0ea5e9"],
    ["Affectation",counters.affectation||0,"#f59e0b"]
  ];
  return `<div class="flex items-start justify-between gap-3 mb-5 flex-wrap"><div><h1 class="text-2xl font-bold">${pageTitle}</h1>${pageSubtitle?`<p class="text-sm text-slate-500">${pageSubtitle}</p>`:""}</div></div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">${cards.map(c=>{const key=c[0].toLowerCase();return`<button type="button" class="card p-4 text-left" onclick="navigate('effectif/preparation_${key}')" style="border-left:4px solid ${c[2]};color:${c[2]};${activeStyle(key)}"><div class="text-xs font-black uppercase text-slate-500">Sans ${escapeHTML(c[0])}</div><div class="text-3xl font-black mt-1" style="color:${c[2]}">${c[1]}</div></button>`}).join("")}</div>
  ${items.length?`<div class="card overflow-hidden"><table><thead><tr><th>Employé</th><th>Société</th><th>Poste</th><th>Site</th><th>Statut</th><th>Blocage</th></tr></thead><tbody>${items.map(row=>{const blockers=row.blockers||[];const stKey=normalizeEmployeeStatusValue(row.statut||"actif");const stLabel=stKey.toUpperCase();const stCls=["actif","sortant","suspendu","blacklist"].includes(stKey)?"employee-status-pill employee-status-"+stKey:["absent","abandon"].includes(stKey)?"pill pill-red":"pill pill-gray";return `<tr data-searchable><td><div class="font-bold">${escapeHTML(row.name||"—")}</div><div class="text-xs font-mono text-slate-500">${escapeHTML(row.code||"—")}</div></td><td class="text-xs">${escapeHTML(row.society||"—")}</td><td class="text-xs">${escapeHTML(row.position||"—")}</td><td class="text-xs">${escapeHTML(row.site||"Sans affectation")}</td><td><span class="${stCls}">${stLabel}</span></td><td>${blockers.map(b=>`<span class="pill" style="background:${operationalPreparationColor(b.key)}18;color:${operationalPreparationColor(b.key)};font-weight:900;margin:2px">${escapeHTML(b.label)}</span>`).join(" ")}</td></tr>`}).join("")}</tbody></table></div>`:`<div class="card p-10 text-center text-slate-500">Tous les employés de ce périmètre sont prêts ou déjà opérationnels.</div>`}`;
}

function renderOperationalPreparation(view,filter){
  view.innerHTML=operationalPreparationHTML(localOperationalPreparationData(filter),"local");
}

function absencesRecapHTML(){
  const soc=effectifSocieteFilter()||drhActiveSocieteFilter()||"";
  const agents=(db.agents||[]).filter(a=>!soc||a.societe===soc);
  // Collect all absence events from gestionEvents
  const events=[];
  agents.forEach(a=>{
    (a.gestionEvents||[]).forEach(e=>{
      if(e.type!=="Absence")return;
      const du=String(e.du||"").slice(0,10);
      if(!du)return;
      const au=String(e.au||"").slice(0,10)||du;
      events.push({agentId:a.id,nom:((a.nom||"")+" "+(a.prenom||"")).trim(),matricule:a.matricule||"",societe:a.societe||"",du,au,motif:e.motif||""});
    });
  });
  const td=today();
  const thisYear=td.slice(0,4);
  const thisMonth=td.slice(0,7);
  // Helper: does an event cover a given date?
  function covers(e,d){return e.du<=d&&e.au>=d;}
  // --- Par jour (30 derniers jours) ---
  const days=[];for(let i=29;i>=0;i--){const d=addDays(td,-i);days.push(d);}
  const byDay=days.map(d=>({d,count:events.filter(e=>covers(e,d)).length}));
  const maxDay=Math.max(1,...byDay.map(x=>x.count));
  // --- Par mois (12 derniers mois) ---
  const months=[];for(let i=11;i>=0;i--){const dt=new Date(td);dt.setMonth(dt.getMonth()-i);months.push(dt.toISOString().slice(0,7));}
  const byMonth=months.map(m=>({m,count:events.filter(e=>e.du.slice(0,7)<=m&&e.au.slice(0,7)>=m).length}));
  const maxMonth=Math.max(1,...byMonth.map(x=>x.count));
  // --- Par année ---
  const years=[...new Set(events.map(e=>e.du.slice(0,4)).filter(Boolean))].sort().reverse().slice(0,5);
  if(!years.includes(thisYear))years.unshift(thisYear);
  const byYear=years.map(y=>({y,count:events.filter(e=>e.du.slice(0,4)<=y&&e.au.slice(0,4)>=y).length}));
  // KPIs
  const today_count=events.filter(e=>covers(e,td)).length;
  const month_count=events.filter(e=>e.du.slice(0,7)<=thisMonth&&e.au.slice(0,7)>=thisMonth).length;
  const year_count=events.filter(e=>e.du.slice(0,4)<=thisYear&&e.au.slice(0,4)>=thisYear).length;
  // Bar helper
  function bar(val,max,color){const pct=Math.round(val/Math.max(1,max)*100);return`<div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div></div>`;}
  const MOIS_COURTS=["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  return`<div class="mb-5">
    <h2 class="text-lg font-black uppercase mb-3">Récapitulatif des absences</h2>
    <div class="grid grid-cols-3 gap-3 mb-5">
      <div class="card p-4 text-center"><div class="text-2xl font-black text-red-600">${today_count}</div><div class="text-xs text-slate-500 mt-1">Absent(s) aujourd'hui</div></div>
      <div class="card p-4 text-center"><div class="text-2xl font-black text-amber-600">${month_count}</div><div class="text-xs text-slate-500 mt-1">Ce mois (${MOIS_COURTS[parseInt(thisMonth.slice(5,7))-1]} ${thisYear})</div></div>
      <div class="card p-4 text-center"><div class="text-2xl font-black text-slate-700">${year_count}</div><div class="text-xs text-slate-500 mt-1">Cette année (${thisYear})</div></div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
      <div class="card p-4">
        <div class="font-bold text-sm mb-3 uppercase text-slate-600">Par jour — 30 derniers jours</div>
        <div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="text-slate-400 uppercase text-left"><th class="pb-1 pr-2">Date</th><th class="pb-1 pr-2 text-center">Nb</th><th class="pb-1 w-full">Tendance</th></tr></thead><tbody>
          ${byDay.filter(x=>x.count>0||x.d===td).map(x=>`<tr><td class="pr-2 py-1 font-mono whitespace-nowrap${x.d===td?" font-black text-red-600":""}">${x.d===td?"Aujourd'hui":formatDate(x.d)}</td><td class="pr-2 py-1 text-center font-bold${x.count>0?" text-red-600":""}">${x.count||"—"}</td><td class="py-1 min-w-[80px]">${x.count?bar(x.count,maxDay,"#dc2626"):""}</td></tr>`).join("")||`<tr><td colspan="3" class="text-center text-slate-400 py-3 italic">Aucune absence sur 30 jours</td></tr>`}
        </tbody></table></div>
      </div>
      <div class="card p-4">
        <div class="font-bold text-sm mb-3 uppercase text-slate-600">Par mois — 12 derniers mois</div>
        <table class="w-full text-xs"><thead><tr class="text-slate-400 uppercase text-left"><th class="pb-1 pr-2">Mois</th><th class="pb-1 pr-2 text-center">Nb</th><th class="pb-1 w-full">Tendance</th></tr></thead><tbody>
          ${byMonth.map(x=>`<tr><td class="pr-2 py-1 font-mono whitespace-nowrap${x.m===thisMonth?" font-black text-amber-600":""}">${MOIS_COURTS[parseInt(x.m.slice(5,7))-1]} ${x.m.slice(0,4)}</td><td class="pr-2 py-1 text-center font-bold${x.count>0?" text-amber-700":""}">${x.count||"—"}</td><td class="py-1 min-w-[80px]">${x.count?bar(x.count,maxMonth,"#d97706"):""}</td></tr>`).join("")}
        </tbody></table>
      </div>
    </div>
    <div class="card p-4 mb-5">
      <div class="font-bold text-sm mb-3 uppercase text-slate-600">Par année</div>
      <div class="flex gap-6 flex-wrap">${byYear.map(x=>`<div class="text-center min-w-[60px]"><div class="text-xl font-black${x.y===thisYear?" text-slate-800":" text-slate-500"}">${x.count}</div><div class="text-xs text-slate-400 mt-1">${x.y}</div></div>`).join("")||`<div class="text-slate-400 italic text-sm">Aucune donnée</div>`}</div>
    </div>
  </div>`;
}

function renderEffectif(view,filter,stableMode){
  if(filter==="recap")return renderEffectifRecap(view);
  if(String(filter||"").startsWith("preparation"))return renderOperationalPreparation(view,filter);
  const cards=(filter==="instance_affectation"||isOpsEffectifContext()||isDrhModuleContext())?"":`<div id="effectif-cards-zone">${effectifRecapCardsHTML(filter,true,true)}</div>`;
  const absRecap=filter==="absents"?`<div id="absences-recap-zone">${absencesRecapHTML()}</div>`:"";
  // Affiche immédiatement les données locales (stale-while-revalidate)
  const localHTML=effectifListHTML(filter);
  view.innerHTML=`${cards}${absRecap}<div id="effectif-list-zone">${localHTML}</div>`;
  sgdiApplyActiveEmployeeStyles(view);
  applyEffectifSearchInPlace(effectifSearchValue(filter));
  if(!sgdiAuthToken())return;
  if(isOpsEffectifContext()){
    // effectifListServerHTML() est réservé au style de liste DRH (return null en contexte
    // OPS/superviseur, voir plus haut) : sans appel de remplacement ici, cet écran (EFFECTIFS
    // côté OPS, PERSONNEL RATTACHÉ côté superviseur) n'essayait JAMAIS de charger les employés
    // par lui-même — il se contentait d'afficher ce qui était déjà en mémoire, resté vide tant
    // que la synchro générale de fond n'avait pas fini (ou avait échoué silencieusement).
    const r=sgdiEnsureEmployeesForDisplay({society:effectifSocieteFilter()});
    if(r&&typeof r.then==="function"){
      r.then(()=>{
        const zone=document.getElementById("effectif-list-zone");
        if(!zone)return;
        zone.innerHTML=effectifListHTML(filter);
        sgdiApplyActiveEmployeeStyles(zone);
        applyEffectifSearchInPlace(effectifSearchValue(filter));
      }).catch(()=>{});
    }
    return;
  }
  // Remplace silencieusement par les données serveur quand elles arrivent
  // En contexte DRH, toutes les données sont déjà en mémoire — pas besoin du rechargement serveur
  if(!effectifServerSupported(filter)||isDrhModuleContext())return;
  effectifListServerHTML(filter).then(html=>{
    if(!html)return;
    const zone=document.getElementById("effectif-list-zone");
    if(zone){zone.innerHTML=html;sgdiApplyActiveEmployeeStyles(zone);applyEffectifSearchInPlace(effectifSearchValue(filter))}
  }).catch(e=>{
    console.warn("Effectif PostgreSQL paginé indisponible",e);
  });
}

function setEffectifSort(v){effectifSort=v;if(document.getElementById("effectif-list-zone"))setEffectifStableFilter(sessionStorage.getItem("effectifStableFilter")||"actifs");else renderView()}

SGDIModules.registerModule({key: "employees", routes: ["effectif","agents"], dependencies: [], init: function(){}, destroy: function(){}});
