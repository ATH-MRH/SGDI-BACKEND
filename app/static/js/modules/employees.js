/* Phase 2 — employees. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function setEffectifSociete(v){
  if(mySoc()){toast("Vous êtes sur "+mySoc()+". Utilisez Changer de société.","error");return}
  if(session?.transverse)sessionStorage.setItem(structureSocieteFilterKey(),v||"");
  else sessionStorage.setItem("effectifSociete",v||"");
  if(sgdiOpsEffectifUsesPages())sessionStorage.setItem(effectifPageStorageKey(opsEffectifActiveFilter()),"1");
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

// Icônes au trait (même gabarit SVG que l'accueil du Portail DRH), aucune bibliothèque ajoutée.
const DRH_EFFECTIF_ACTION_ICONS={
  detail:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  maladie:'<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  conge:'<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  rec_periode_essai:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  suspendre:'<path d="M9 5v14M15 5v14"/>',
  convoquer:'<path d="M3 10v4h4l7 5V5l-7 5z"/><path d="M17.5 9a4 4 0 0 1 0 6M8 14l1.5 5"/>',
  blacklister:'<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  mise_en_demeure:'<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a5 5 0 0 0-4-4.9"/>',
  periode_enc:'<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
  sanctionner:'<path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 5-5M8 8l5-5M9.5 6.5l8 8"/>',
  avenant:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M14 3v5h5v3M18.4 13.6a1.9 1.9 0 0 1 2.7 2.7L16 21.4l-3.5.9.9-3.5z"/>',
  nouveau_contrat:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  fin_contrat:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 15h7M13 12l3 3-3 3"/>'
};
function drhEffectifActionsBarHTML(){
  const btns=[
    {k:"detail",           l:"DETAIL"},
    {k:"maladie",          l:"MALADIE"},
    {k:"conge",            l:"CONGÉ"},
    {k:"rec_periode_essai",l:"REC/PERIODE D'ESSAI"},
    {k:"suspendre",        l:"SUSPENDRE"},
    {k:"convoquer",        l:"CONVOQUER"},
    {k:"blacklister",      l:"BLACKLISTER"},
    {k:"mise_en_demeure",  l:"MISE EN DEMEURE"},
    {k:"periode_enc",      l:"PERIODE E-N-C"},
    {k:"sanctionner",      l:"SANCTIONNER"},
    {k:"avenant",          l:"AVENANT"},
    {k:"nouveau_contrat",  l:"NOUVEAU CONTRAT"},
    {k:"fin_contrat",      l:"FIN DE CONTRAT"},
  ];
  return `<section class="drh-effectif-actions-card" aria-label="Actions à faire">
    <div class="drh-effectif-actions-head">
      <h3>Actions à faire</h3>
      <span>Fiche en lecture seule · actions RH autorisées</span>
    </div>
    <div class="drh-effectif-actions-bar">${btns.map(({k,l})=>`<button type="button" class="drh-effectif-action-btn" onclick="openRhEffectifActionModal('${k}')">${drhPortalHomeIcon(DRH_EFFECTIF_ACTION_ICONS[k])}<span>${l}</span></button>`).join("")}</div>
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

// CORRECTION UX : le badge Statut (employeeStatusPillHTML) n'ouvre plus jamais ce
// menu — c'est désormais l'unique bouton d'actions RH de la ligne (colonne Action,
// à côté de "Ouvrir →"). Auparavant masqué en contexte DRH/OPS car le badge
// Statut portait seul cette fonction dans ces contextes ; rien n'est perdu, le
// même menu contextuel (openEmployeeStatusActions, défini dans le monolithe)
// reste disponible partout.
function employeeRowActionsButton(a){
  if(!canUseEmployeeActionWorkflows())return "";
  const title=isOpsEffectifContext()?"Actions OPS":"Actions RH";
  return `<button type="button" class="effectif-more-btn" title="${title}" aria-label="${title}" onclick="openEmployeeStatusActions(event,'${escapeHTML(a.id)}','')"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>`;
}


function renderEffectifRecap(view){
  const current=sessionStorage.getItem("effectifStableFilter")||"actifs";
  return renderEffectif(view,current,true);
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
  if(sgdiOpsEffectifUsesPages()&&view){sessionStorage.setItem(effectifPageStorageKey(filter),"1");return renderOpsEffectifPage(view,filter)}
  if(zone){zone.innerHTML=effectifListHTML(filter);sgdiApplyActiveEmployeeStyles(zone);hydrateEmployeePhotos(zone);updateEffectifBulkDeleteButton();applyEffectifSearchInPlace(effectifSearchValue(filter))}
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
  return setEffectifStableFilter(opsEffectifActiveFilter());
}

function opsEffectifActiveFilter(){return document.getElementById("effectif-list-zone")?.dataset.filter||sessionStorage.getItem("effectifStableFilter")||"actifs"}

function setOpsEffectifSearch(v){
  clearTimeout(opsEffectifSearchTimer);
  const f=opsEffectifFilters();
  f.q=String(v||"");
  sessionStorage.setItem("opsEffectifFilters",JSON.stringify(f));
  if(sgdiOpsEffectifUsesPages()){
    opsEffectifPageRequest++;
    const filter=document.getElementById("effectif-list-zone")?.dataset.filter||sessionStorage.getItem("effectifStableFilter")||"actifs";
    sessionStorage.setItem(effectifPageStorageKey(filter),"1");
    opsEffectifSearchTimer=setTimeout(()=>{const view=document.getElementById("view");if(view&&sgdiOpsEffectifPageActive())renderOpsEffectifPage(view,filter)},250);
    return;
  }
  opsEffectifSearchTimer=setTimeout(()=>applyOpsEffectifSearchInPlace(v),80);
}

// Barre de pilotage de Gestion des effectifs, commune DRH / OPS : recherche, SITE,
// POSTE / FONCTION, TRI (inchangé), raccourcis comptés et réinitialisation.
// Ordre des filtres : société → périmètre → SITE → POSTE → recherche.
// - Compteurs SITE : population du périmètre, avant le filtre site.
// - Compteurs POSTE : après le filtre site, avant le filtre poste.
// - Compteur de l'écran : liste réellement affichée, après tous les filtres.
// SITE = identifiant SQL du site de l'affectation active (siteBackendId, le site_id de
// /api/ops/employees/page) ; "__none__" = aucune affectation active. La société active est
// mémorisée avec le choix : en changer revient sur « Tous les sites ».
const EFFECTIF_SITE_NONE="__none__";
const DRH_EFFECTIF_SITE_KEY="drhEffectifSiteFilter";
function effectifSiteFilterEnabled(){return isOpsEffectifContext()||isDrhModuleContext()}
function effectifSiteKey(site){return String(site?.backendId||site?.id||"")}
function effectifAgentSiteKey(a){
  if(!agentHasLiveAffectation(a))return EFFECTIF_SITE_NONE;
  const aff=agentLiveAffectation(a)||{};
  if(aff.siteBackendId!==undefined&&aff.siteBackendId!==null&&aff.siteBackendId!=="")return String(aff.siteBackendId);
  // Fiche legacy sans identifiant SQL : rattacher au site connu par sa référence ou son nom.
  const site=(db.sites||[]).find(s=>siteMatchesReference(s,aff));
  return site?effectifSiteKey(site):String(aff.siteId||"nom:"+normalizedSearchText(aff.siteName));
}
// Poste opérationnel : celui de l'affectation active, sinon la fonction / le poste de la
// fiche — la règle de la colonne Poste et de /api/ops/employees/page.
function effectifAgentPoste(a){
  const aff=agentLiveAffectation(a)||{};
  return String(aff.poste||a?.affectationCourante?.poste||a?.fonction||a?.position||"").trim();
}
function effectifFilterState(){
  if(isOpsEffectifContext()){const f=opsEffectifFilters();return {site:f.site,soc:f.siteSoc,poste:f.poste}}
  try{return JSON.parse(sessionStorage.getItem(DRH_EFFECTIF_SITE_KEY)||"{}")||{}}catch(e){return {}}
}
function storeEffectifFilters(patch){
  const next={...effectifFilterState(),...patch,soc:effectifSocieteFilter()||""};
  const site=String(next.site||""),poste=String(next.poste||"");
  if(isOpsEffectifContext()){
    const f=opsEffectifFilters();f.site=site;f.siteSoc=next.soc;f.poste=poste;
    sessionStorage.setItem("opsEffectifFilters",JSON.stringify(f));
  }else sessionStorage.setItem(DRH_EFFECTIF_SITE_KEY,JSON.stringify({site,poste,soc:next.soc}));
}
// Options SITE = sites déjà chargés (db.sites, filtrés par le serveur selon sociétés et sites
// autorisés) de la société active, complétés par les sites des affectations de la liste.
// Compteurs : liste complète en mémoire (DRH, superviseur) ou agrégat serveur (OPS paginé).
function effectifSiteFilterOptions(baseList,serverCounts){
  const soc=effectifSocieteFilter();
  const byKey=new Map();
  const entry=(key,label)=>{if(!byKey.has(key))byKey.set(key,{value:key,label:label||"Site",count:0});return byKey.get(key)};
  (db.sites||[]).filter(s=>siteMatchesSociete(s,soc)&&siteInSupervisorScope(s)).forEach(s=>{
    const key=effectifSiteKey(s);
    if(key)entry(key,s.nom||s.intitule);
  });
  let none=0,total=(baseList||[]).length;
  (baseList||[]).forEach(a=>{
    const key=effectifAgentSiteKey(a);
    if(key===EFFECTIF_SITE_NONE){none++;return}
    const aff=agentLiveAffectation(a)||{};
    entry(key,aff.siteName||aff.siteId).count++;
  });
  if(serverCounts){
    (serverCounts.sites||[]).forEach(row=>{entry(String(row.site_id),row.name).count=Number(row.count)||0});
    none=Number(serverCounts.sites_none)||0;total=Number(serverCounts.sites_total)||0;
  }
  const sites=[...byKey.values()].sort((x,y)=>x.label.localeCompare(y.label,"fr",{numeric:true,sensitivity:"base"}));
  // Serveur : seuls les plus gros sites sont comptés ; pas de faux zéro dans le sélecteur.
  return {sites,none,total,counted:Array.isArray(baseList)||!!serverCounts,partial:!!serverCounts&&!Array.isArray(baseList),known:sites.length>0||none>0};
}
function effectifSiteFilterValue(options){
  const state=effectifFilterState();
  let site=String(state.site||"");
  if(!site||site===EFFECTIF_SITE_NONE)return site;
  const socChanged=state.soc!==undefined&&String(state.soc||"")!==String(effectifSocieteFilter()||"");
  // Ancien choix OPS mémorisé avec l'identifiant local du site.
  const known=(db.sites||[]).find(s=>String(s.id)===site||String(s.backendId||"")===site);
  if(known)site=effectifSiteKey(known);
  if(socChanged||(options?.known&&!options.sites.some(o=>o.value===site))){storeEffectifFilters({site:""});return ""}
  return site;
}
// Options POSTE = postes présents dans le périmètre (avant le filtre site, pour ne pas faire
// disparaître le choix courant), comptés sur la liste déjà filtrée par site.
function effectifPosteOptions(labels,counts,total,counted){
  const byValue=new Map();
  (labels||[]).forEach(label=>{const value=String(label||"").trim();if(value&&!byValue.has(value))byValue.set(value,{value,label:value,count:0})});
  counts.forEach((count,value)=>{if(!byValue.has(value))byValue.set(value,{value,label:value,count:0});byValue.get(value).count=count});
  const postes=[...byValue.values()].sort((x,y)=>x.label.localeCompare(y.label,"fr",{numeric:true,sensitivity:"base"}));
  return {postes,total,counted,known:postes.length>0};
}
function effectifPosteOptionsFromList(scopeList,siteList){
  const counts=new Map();
  (siteList||[]).forEach(a=>{const poste=effectifAgentPoste(a);if(poste)counts.set(poste,(counts.get(poste)||0)+1)});
  return effectifPosteOptions((scopeList||[]).map(effectifAgentPoste),counts,(siteList||[]).length,true);
}
function effectifPosteOptionsFromServer(postes,serverCounts){
  const counts=new Map((serverCounts?.postes||[]).map(row=>[String(row.poste||"").trim(),Number(row.count)||0]));
  return {...effectifPosteOptions(postes,counts,Number(serverCounts?.postes_total)||0,!!serverCounts),partial:!!serverCounts};
}
function effectifPosteFilterValue(options){
  const poste=String(effectifFilterState().poste||"");
  if(poste&&options?.known&&!options.postes.some(o=>o.value===poste)){storeEffectifFilters({poste:""});return ""}
  return poste;
}
function effectifFilterSelectHTML(kind,filter,items,selected,{allLabel,total,counted,partial,extra=""}){
  const n=count=>counted&&!partial?` (${count})`:"";
  const f=escapeHTML(filter||"actifs");
  const handler=kind==="site"?"setEffectifSiteFilter":"setEffectifPosteFilter";
  const aria=kind==="site"?"Filtrer les employés par site":"Filtrer les employés par poste ou fonction";
  return `<select id="effectif-${kind}-filter" class="select" data-no-lock data-effectif-${kind}-filter data-effectif-focus="${kind}" aria-label="${aria}" onchange="${handler}(this.value,'${f}')">
    <option value="" ${selected?"":"selected"}>${allLabel}${counted?` (${total})`:""}</option>
    ${items.map(o=>`<option value="${escapeHTML(o.value)}" ${selected===o.value?"selected":""}>${escapeHTML(o.label)}${n(o.count)}</option>`).join("")}${extra}
  </select>`;
}
function effectifSiteFilterSelectHTML(filter,options,selected){
  const none=`<option value="${EFFECTIF_SITE_NONE}" ${selected===EFFECTIF_SITE_NONE?"selected":""}>Sans affectation${options.counted?` (${options.none})`:""}</option>`;
  return effectifFilterSelectHTML("site",filter,options.sites,selected,{allLabel:"Tous les sites",total:options.total,counted:options.counted,partial:options.partial,extra:none});
}
function effectifPosteFilterSelectHTML(filter,options,selected){
  return effectifFilterSelectHTML("poste",filter,options.postes,selected,{allLabel:"Tous les postes",total:options.total,counted:options.counted,partial:options.partial});
}
// Raccourcis : « Tous », les plus gros effectifs, le choix courant et (site) « Sans
// affectation » ; la liste complète reste dans le sélecteur.
function effectifChipsHTML(kind,filter,items,selected,label){
  const f=escapeHTML(filter||"actifs");
  const handler=kind==="site"?"setEffectifSiteFilter":"setEffectifPosteFilter";
  return `<div class="effectif-chip-group" role="group" aria-label="${label}">${items.map(o=>{
    const active=selected===o.value;
    const value=escapeHTML(jsString(o.value));
    return `<button type="button" class="effectif-chip${active?" is-active":""}" aria-pressed="${active}" data-effectif-chip="${kind}" data-value="${escapeHTML(o.value)}" data-effectif-focus="${kind}-chip:${escapeHTML(o.value)}" title="${escapeHTML(o.title||o.label)} : ${o.count} employé(s)" onclick="${handler}('${value}','${f}','${kind}-chip:${value}')"><span class="effectif-chip-label">${escapeHTML(o.label)}</span><span class="effectif-chip-count">${o.count}</span></button>`;
  }).join("")}</div>`;
}
function effectifTopItems(items,selected,max){
  const top=items.filter(o=>o.count>0).sort((x,y)=>y.count-x.count||x.label.localeCompare(y.label,"fr")).slice(0,max);
  const current=selected&&!top.some(o=>o.value===selected)?items.find(o=>o.value===selected):null;
  return current?[...top,current]:top;
}
function effectifSiteChipsHTML(filter,options,selected){
  if(!options?.counted)return "";
  const items=[{value:"",label:"Tous",title:"Tous les sites",count:options.total},...effectifTopItems(options.sites,selected,2)];
  if(options.none||selected===EFFECTIF_SITE_NONE)items.push({value:EFFECTIF_SITE_NONE,label:"Sans affectation",count:options.none});
  return effectifChipsHTML("site",filter,items,selected,"Raccourcis par site");
}
function effectifPosteChipsHTML(filter,options,selected){
  if(!options?.counted)return "";
  const items=[{value:"",label:"Tous",title:"Tous les postes",count:options.total},...effectifTopItems(options.postes,selected,3)];
  return effectifChipsHTML("poste",filter,items,selected,"Raccourcis par poste ou fonction");
}
const EFFECTIF_TOOLBAR_ICONS={
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  reset:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'
};
function effectifToolbarHTML(filter,{title,count,soc,sortHTML,siteOptions,siteFilter,posteOptions,posteFilter}){
  const f=escapeHTML(filter||"actifs");
  const chips=`${effectifSiteChipsHTML(filter,siteOptions,siteFilter)}${effectifPosteChipsHTML(filter,posteOptions,posteFilter)}`;
  return `<section class="effectif-toolbar" aria-label="Recherche et filtres des effectifs">
    <div class="effectif-toolbar-title"><h1 class="effectif-page-title">${escapeHTML(title)}</h1><p><span data-effectif-count>${count}</span> employé(s) · ${soc?escapeHTML(soc):"Toutes sociétés"}</p></div>
    <div class="effectif-toolbar-search">${drhPortalHomeIcon(EFFECTIF_TOOLBAR_ICONS.search)}<input class="input" data-no-lock aria-label="Rechercher par nom, prénom ou code" value="${escapeHTML(effectifSearchValue(filter))}" placeholder="Recherche nom / prénom / code" oninput="setEffectifSearch(this.value,'${f}')"/></div>
    <div class="effectif-toolbar-field effectif-toolbar-site"><label for="effectif-site-filter">Site</label>${effectifSiteFilterSelectHTML(filter,siteOptions,siteFilter)}</div>
    <div class="effectif-toolbar-field effectif-toolbar-poste"><label for="effectif-poste-filter">Poste / fonction</label>${effectifPosteFilterSelectHTML(filter,posteOptions,posteFilter)}</div>
    <div class="effectif-toolbar-field effectif-toolbar-sort"><label for="effectif-sort">Tri</label>${sortHTML}</div>
    <button type="button" class="effectif-toolbar-reset" data-effectif-focus="reset" onclick="resetEffectifToolbar('${f}')" title="Réinitialiser la recherche, les filtres et le tri" aria-label="Réinitialiser la recherche, les filtres et le tri">${drhPortalHomeIcon(EFFECTIF_TOOLBAR_ICONS.reset)}<span>Réinitialiser</span></button>
    ${chips?`<div class="effectif-toolbar-chips">${chips}</div>`:""}
  </section>`;
}
function effectifEmptyStateHTML(filter,{loading,siteFilter,posteFilter,searching}){
  if(loading)return `<div class="card p-10 text-center text-slate-500" data-effectif-empty><p data-effectif-empty-message>Chargement des employés…</p></div>`;
  const message=posteFilter||(siteFilter&&searching)?"Aucun employé correspondant à ces filtres"
    :siteFilter===EFFECTIF_SITE_NONE?"Aucun employé sans affectation":siteFilter?"Aucun employé affecté à ce site":"Aucun employé.";
  const reset=siteFilter||posteFilter?`<button type="button" class="btn btn-secondary text-xs mt-3" onclick="resetEffectifToolbar('${escapeHTML(filter||"actifs")}')">Réinitialiser les filtres</button>`:"";
  return `<div class="card p-10 text-center text-slate-500" data-effectif-empty><p data-effectif-empty-message>${message}</p>${reset}</div>`;
}
// Le contenu est recréé au rendu : rendre le focus clavier à l'élément équivalent.
function rerenderEffectifToolbar(filter,focusKey){
  const done=setEffectifStableFilter(isOpsEffectifContext()?opsEffectifActiveFilter():(filter||"actifs"));
  return Promise.resolve(done).then(()=>{
    const active=document.activeElement;
    if(focusKey&&(!active||active===document.body))document.querySelector(`#effectif-list-zone [data-effectif-focus="${CSS.escape(focusKey)}"]`)?.focus({preventScroll:true});
  });
}
function setEffectifSiteFilter(value,filter,focusKey="site"){
  storeEffectifFilters({site:String(value||"")});
  return rerenderEffectifToolbar(filter,focusKey);
}
function setEffectifPosteFilter(value,filter,focusKey="poste"){
  storeEffectifFilters({poste:String(value||"")});
  return rerenderEffectifToolbar(filter,focusKey);
}
// Réinitialise recherche, SITE, POSTE et TRI ; jamais la société active.
function resetEffectifToolbar(filter){
  effectifSort="nom_asc";
  storeEffectifFilters({site:"",poste:""});
  if(isOpsEffectifContext()){
    clearTimeout(opsEffectifSearchTimer);
    const f=opsEffectifFilters();f.q="";
    sessionStorage.setItem("opsEffectifFilters",JSON.stringify(f));
  }else sessionStorage.removeItem(effectifSearchKey(filter||"actifs"));
  return rerenderEffectifToolbar(filter,"reset");
}

function resetOpsEffectifFilters(){sessionStorage.removeItem("opsEffectifFilters");return setEffectifStableFilter(opsEffectifActiveFilter())}

function opsEffectifAdvancedOpen(){return sessionStorage.getItem("opsEffectifAdvanced")==="1"}

function toggleOpsEffectifAdvanced(){sessionStorage.setItem("opsEffectifAdvanced",opsEffectifAdvancedOpen()?"0":"1");return setEffectifStableFilter(opsEffectifActiveFilter())}

function applyOpsEffectifSearchInPlace(v){
  if(sgdiOpsEffectifUsesPages())return;
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
  const visible=document.querySelector("#effectif-list-zone [data-effectif-count]");
  if(visible)visible.textContent=String(shown);
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
  const visible=document.querySelector("#effectif-list-zone [data-effectif-count]");
  if(visible&&rows.length)visible.textContent=String(shown);
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
  const advanced=opsEffectifAdvancedOpen();
  const situations=[...new Set((sourceList||[]).map(a=>a.situation||"").filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  if(f.situation&&!situations.includes(f.situation))situations.push(f.situation);
  const val=k=>escapeHTML(f[k]||"");
  return `<div class="card ops-effectif-filter-card">
    <div class="ops-effectif-filter-main">
      <div><label class="label" for="ops-filter-situation">Situation familiale</label><select id="ops-filter-situation" class="select" data-no-lock onchange="setOpsEffectifFilter('situation',this.value)"><option value="">Toutes situations</option>${situations.map(s=>`<option value="${escapeHTML(s)}" ${f.situation===s?"selected":""}>${escapeHTML(s)}</option>`).join("")}</select></div>
      <div class="ops-effectif-filter-actions">${opsButtonHTML(advanced?"Masquer filtres":"Filtres avancés",{size:"sm",icon:"search",badge:["recrutFrom","recrutTo","birthFrom","birthTo","ageMin","ageMax"].filter(key=>String(f[key]??"")!=="").length,badgeLabel:"filtre(s) actif(s)",attrs:`aria-expanded="${advanced}" aria-controls="ops-effectif-advanced" onclick="toggleOpsEffectifAdvanced()"`})}${opsButtonHTML("Réinitialiser",{size:"sm",icon:"rotate",attrs:'onclick="resetOpsEffectifFilters()"'})}</div>
    </div>
    <div id="ops-effectif-result-count" class="ops-effectif-result-count" role="status" aria-live="polite">${filteredCount} résultat(s) affiché(s)</div>
    ${advanced?`<div id="ops-effectif-advanced" class="ops-effectif-advanced">
      <div><label class="label" for="ops-filter-recrutFrom">Recrutement du</label><input id="ops-filter-recrutFrom" class="input" data-no-lock type="date" value="${val("recrutFrom")}" onchange="setOpsEffectifFilter('recrutFrom',this.value)"/></div>
      <div><label class="label" for="ops-filter-recrutTo">Recrutement au</label><input id="ops-filter-recrutTo" class="input" data-no-lock type="date" value="${val("recrutTo")}" onchange="setOpsEffectifFilter('recrutTo',this.value)"/></div>
      <div><label class="label" for="ops-filter-birthFrom">Naissance du</label><input id="ops-filter-birthFrom" class="input" data-no-lock type="date" value="${val("birthFrom")}" onchange="setOpsEffectifFilter('birthFrom',this.value)"/></div>
      <div><label class="label" for="ops-filter-birthTo">Naissance au</label><input id="ops-filter-birthTo" class="input" data-no-lock type="date" value="${val("birthTo")}" onchange="setOpsEffectifFilter('birthTo',this.value)"/></div>
      <div><label class="label" for="ops-filter-ageMin">Age min</label><input id="ops-filter-ageMin" class="input" data-no-lock type="number" min="0" value="${val("ageMin")}" onchange="setOpsEffectifFilter('ageMin',this.value)"/></div>
      <div><label class="label" for="ops-filter-ageMax">Age max</label><input id="ops-filter-ageMax" class="input" data-no-lock type="number" min="0" value="${val("ageMax")}" onchange="setOpsEffectifFilter('ageMax',this.value)"/></div>
    </div>`:""}
  </div>`;
}

function effectifModeToApi(filter){return filter||"actifs"}

function effectifServerSupported(filter){return ["actifs","absents","suspension","sortant","blacklist"].includes(filter||"actifs")}

function effectifPageStorageKey(filter){return "effectifPage:"+effectifModeToApi(filter)+":"+(effectifSocieteFilter()||"")}

function effectifCurrentPage(filter){return Math.max(parseInt(sessionStorage.getItem(effectifPageStorageKey(filter))||"1",10)||1,1)}

function setEffectifPage(filter,page){
  sessionStorage.setItem(effectifPageStorageKey(filter),String(Math.max(parseInt(page||1,10)||1,1)));
  const view=document.getElementById("view");
  if(sgdiOpsEffectifUsesPages()&&view)return renderOpsEffectifPage(view,filter);
  renderView();
}

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

// Alerte de présentation uniquement : même échéance que la fiche et le tableau Contrats.
function employeeExpiredContractAlert(a,baseDate){
  const asOf=baseDate||today();
  if(!a||employeeStatusKey(a.statut||a.status)!=="actif"||employeeIsFormer(a,asOf)||a.blacklist||a.blacklistContractBlocked||a.contractBlocked)return null;
  // Une date de recrutement seule ne prouve pas un contrat : ne pas utiliser les
  // 12 mois par défaut du formulaire pour fabriquer une échéance absente.
  if(!a.dateFinContrat&&!a.dureeContrat&&!employeeLatestContractEndDate(a))return null;
  const remaining=employeePositionContractDaysLeft(a,asOf);
  if(!Number.isFinite(remaining)||remaining>=0)return null;
  const days=-remaining;
  return {days,message:`Contrat expiré depuis ${days} ${days===1?"jour":"jours"}`};
}

function employeeListRowHTML(a,filter){
  const contractIndicator=isDrhModuleContext()&&filter==="actifs";
  const contractAlert=contractIndicator?employeeExpiredContractAlert(a):null;
  const aff=agentLiveAffectation(a);
  const deleteId=String(a.backendId||a.id||"");
  const deleteLabel=[a.matricule||"",((a.nom||"")+" "+(a.prenom||"")).trim()].filter(Boolean).join(" · ");
  const checkedCell=isAdminFichePositionContext()?`<td class="text-center effectif-select-cell"><input type="checkbox" class="effectif-row-select" value="${escapeHTML(deleteId)}" data-employee-id="${escapeHTML(a.id||"")}" data-backend-id="${escapeHTML(a.backendId||"")}" data-label="${escapeHTML(deleteLabel)}" onchange="updateEffectifBulkDeleteButton()" style="width:16px;height:16px"/></td>`:"";
  const opsCells=isOpsEffectifContext()?`<td data-label="Naissance" class="text-xs">${formatDate(a.dateNaissance)}</td><td data-label="Age" class="text-xs font-bold">${ageFromDate(a.dateNaissance)??"—"}</td><td data-label="Situation" class="text-xs">${safe(a.situation)}</td>`:"";
  return `<tr${contractAlert?' class="effectif-contract-expired"':""} data-searchable data-employee-id="${escapeHTML(a.id)}" data-backend-id="${escapeHTML(a.backendId||"")}">${checkedCell}<td data-label="Employé" class="effectif-agent-cell"><div class="flex items-center gap-2"><div class="avatar">${employeeAvatarHTML(a)}</div><div><div class="font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</div><div class="text-xs text-slate-500">${safe(a.telephone)}</div></div></div></td><td data-label="Code" class="font-mono font-bold text-amber-600">${safe(a.matricule)}</td><td data-label="Société" class="text-xs">${safe(a.societe)}</td><td data-label="Poste" class="text-xs">${safe(aff?.poste||a.affectationCourante?.poste||a.fonction||a.position)}</td><td data-label="Site" class="text-xs">${safe(aff?.siteName)}</td><td data-label="Recrutement" class="text-xs">${formatDate(a.dateRecrutement)}</td>${opsCells}<td data-label="Statut" class="effectif-status-cell">${employeeStatusPillHTML(a,{contractIndicator,contractAlert})}</td><td data-label="Action" class="effectif-open-cell"><div class="effectif-row-actions"><a class="effectif-open-btn" href="#/agents/${employeeRouteId(a)}">Ouvrir <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></a>${employeeRowActionsButton(a)}</div></td>${filter==="instance_affectation"?(isOpsEffectifContext()?`<td data-label="Affectation" class="text-right"><button type="button" class="btn btn-primary text-xs" onclick="sessionStorage.setItem('opsMovementAgentId','${escapeHTML(a.id)}');navigate('ops/mouvements')">Affecter</button></td>`:`<td data-label="Affectation" class="text-right"><span class="text-xs text-slate-500">Verrouillé</span></td>`):""}</tr>`;
}

let opsEffectifPageRequest=0;
function opsEffectifPageParams(filter){
  const site=effectifSiteFilterValue(effectifSiteFilterOptions(null));
  const siteRow=(db.sites||[]).find(s=>effectifSiteKey(s)===site);
  const f=opsEffectifFilters();
  return {mode:effectifModeToApi(filter),society:effectifSocieteFilter(),page:effectifCurrentPage(filter),page_size:25,
    q:String(f.q||"").trim(),site_id:siteRow?.backendId||site,sort:effectifSort,
    poste:f.poste||"",situation:f.situation||"",recrut_from:f.recrutFrom||"",recrut_to:f.recrutTo||"",
    birth_from:f.birthFrom||"",birth_to:f.birthTo||"",age_min:f.ageMin||"",age_max:f.ageMax||"",
    ...(filter==="operationnels"?{operational_requires_dotation:!!effectifConfigSettings().operationalRequiresDotation,
      operational_requires_pv:!!effectifConfigSettings().operationalRequiresPvInstallation}:{})};
}
function opsEffectifPageData(filter,result,list){
  const titles={actifs:"Gestion des effectifs",operationnels:"Effectif opérationnel",conge:"Agents en congé",maladie:"Agents en maladie",absents:"Agents en absence",suspension:"Agents suspendus",instance_affectation:"Employés en attente d'affectation",sortant:"Sortant",blacklist:"BLACKLIST"};
  const total=Number(result?.total)||0,page=Number(result?.page)||1,pages=Math.max(Number(result?.pages)||1,1);
  const routeFilter=escapeHTML(filter||"actifs");
  const pagination=result?`<div class="flex items-center justify-between gap-2 p-3 text-sm" data-ops-effectif-pagination><div class="text-slate-500">${total} employé(s) · page ${page}/${pages}</div><div class="flex gap-2"><button type="button" class="btn btn-ghost text-xs" ${page<=1?"disabled":""} onclick="setEffectifPage('${routeFilter}',${page-1})">Précédent</button><button type="button" class="btn btn-ghost text-xs" ${page>=pages?"disabled":""} onclick="setEffectifPage('${routeFilter}',${page+1})">Suivant</button></div></div>`:"";
  const filterSource=Array.isArray(result?.filters?.postes)?result.filters.postes.map(poste=>({fonction:poste})):list;
  const counts=result?.filters?.counts||null;
  const siteOptions=effectifSiteFilterOptions(null,counts);
  const posteOptions=effectifPosteOptionsFromServer(Array.isArray(result?.filters?.postes)?result.filters.postes:[],counts);
  const state=effectifFilterState();
  return {list,title:titles[filter]||titles.actifs,soc:effectifSocieteFilter(),filterSource,total,pagination,loading:!result,
    siteOptions,siteFilter:effectifSiteFilterValue(siteOptions),posteOptions,posteFilter:String(state.poste||""),searching:!!String(state.q||"").trim()};
}
async function renderOpsEffectifPage(view,filter){
  const request=++opsEffectifPageRequest;
  const params=opsEffectifPageParams(filter),context=sgdiDrhReadContext(params.society),race=sgdiCaptureRaceContext();
  const hash=location.hash;
  let zone=view.querySelector("#effectif-list-zone");
  if(!zone){view.innerHTML='<div id="effectif-list-zone"></div>';zone=view.querySelector("#effectif-list-zone")}
  zone.dataset.filter=filter||"actifs";
  if(!zone.querySelector(".ops-effectif-page"))zone.innerHTML=effectifListHTML(filter,opsEffectifPageData(filter,null,[]));
  zone.setAttribute("aria-busy","true");
  const current=()=>request===opsEffectifPageRequest&&sgdiDrhReadIsCurrent(context)&&sgdiRaceContextStillValid(race)&&location.hash===hash&&document.getElementById("effectif-list-zone")===zone&&JSON.stringify(opsEffectifPageParams(filter))===JSON.stringify(params);
  try{
    const result=await SGDI.employees.page(params);
    if(!current())return null;
    if(!result||!Array.isArray(result.items))throw new Error("Réponse employés invalide");
    const scopePostes=result.filters?.postes;
    if(params.poste&&Array.isArray(scopePostes)&&!scopePostes.includes(params.poste)){
      storeEffectifFilters({poste:""});
      return renderOpsEffectifPage(view,filter);
    }
    // L'identifiant SQL lie toujours la photo à l'employé, même si des codes/anciens
    // identifiants se ressemblent entre sociétés.
    const list=result.items.map(row=>{
      const employee=employeeFromApi(row);
      if(!Array.isArray(db.agents))db.agents=[];
      const index=db.agents.findIndex(a=>String(a.backendId||"")===String(employee.backendId));
      // Le DTO opérationnel remplace l'ancien objet : ne pas ressusciter des
      // champs RH absents ni une photo supprimée depuis un dossier en cache.
      if(index>=0)db.agents[index]=employee;else db.agents.push(employee);
      return employee;
    });
    const focused=document.activeElement;
    const searchFocused=zone.contains(focused)&&focused?.matches('input[oninput*="setEffectifSearch"]');
    const selection=searchFocused?[focused.selectionStart,focused.selectionEnd]:null;
    zone.innerHTML=effectifListHTML(filter,opsEffectifPageData(filter,result,list));
    zone.removeAttribute("aria-busy");
    sessionStorage.setItem(effectifPageStorageKey(filter),String(Math.max(Number(result.page)||1,1)));
    sgdiApplyActiveEmployeeStyles(zone);
    hydrateEmployeePhotos(zone);
    if(selection){const input=zone.querySelector('input[oninput*="setEffectifSearch"]');input?.focus({preventScroll:true});input?.setSelectionRange(...selection)}
    return result;
  }catch(error){
    if(!current())return null;
    zone.removeAttribute("aria-busy");
    const previous=zone.querySelector("[data-ops-effectif-error]");if(previous)previous.remove();
    const message=document.createElement("div");message.dataset.opsEffectifError="";message.className="card p-4 text-red-700";message.setAttribute("role","alert");
    message.innerHTML=`Chargement des employés impossible. <button type="button" class="btn btn-ghost text-xs" onclick="setEffectifPage('${escapeHTML(filter||"actifs")}',${params.page})">Réessayer</button>`;
    zone.appendChild(message);
    console.warn("Effectifs OPS indisponibles",error);
    return null;
  }
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
  ${list.length===0?`<div class="card p-10 text-center text-slate-500">Aucun employé.</div>`:`<div class="card overflow-hidden effectif-table-card"><table class="effectif-table"><colgroup>${selectHead?`<col style="width:44px">`:""}<col style="width:28%"><col style="width:8%"><col style="width:13%"><col style="width:13%"><col style="width:10%"><col style="width:8%"><col style="width:108px"><col style="width:148px"></colgroup><thead><tr>${selectHead}${effectifTableHeadersHTML()}</tr></thead><tbody>${list.map(a=>employeeListRowHTML(a,filter)).join("")}</tbody></table>${pagination}</div>`}</div>`;
}

function effectifListHTML(filter,serverData){
  const data=serverData||effectifFilteredData(filter);
  const {list,title,soc,filterSource}=data;
  const total=serverData?serverData.total:list.length;
  const toolbar=effectifSiteFilterEnabled();
  const siteOptions=toolbar?(data.siteOptions||effectifSiteFilterOptions(null)):null;
  const siteFilter=siteOptions?(data.siteFilter??effectifSiteFilterValue(siteOptions)):"";
  const posteOptions=toolbar?(data.posteOptions||effectifPosteOptions([],new Map(),0,false)):null;
  const posteFilter=posteOptions?(data.posteFilter??effectifPosteFilterValue(posteOptions)):"";
  const actionHeader=filter==="instance_affectation"?"<th>Action</th>":"";
  const selectHead=isAdminFichePositionContext()?`<th style="width:42px;text-align:center"><input type="checkbox" onchange="toggleEffectifSelectAll(this.checked)" style="width:16px;height:16px"/></th>`:"";
  const sortHTML=`<select id="effectif-sort" class="select" data-no-lock data-effectif-focus="sort" onchange="setEffectifSort(this.value)">
    <option value="nom_asc" ${effectifSort==="nom_asc"?"selected":""}>Nom A → Z</option>
    <option value="nom_desc" ${effectifSort==="nom_desc"?"selected":""}>Nom Z → A</option>
    <option value="recrut_asc" ${effectifSort==="recrut_asc"?"selected":""}>Recrutement (ancien → récent)</option>
    <option value="recrut_desc" ${effectifSort==="recrut_desc"?"selected":""}>Recrutement (récent → ancien)</option>
    <option value="mat_asc" ${effectifSort==="mat_asc"?"selected":""}>Code ↑</option>
    <option value="mat_desc" ${effectifSort==="mat_desc"?"selected":""}>Code ↓</option>
  </select>`;
  const drhActions=isDrhModuleContext()&&filter!=="instance_affectation";
  const header=toolbar?`<div class="effectif-sticky-head">${effectifToolbarHTML(filter,{title,count:total,soc,sortHTML,siteOptions,siteFilter,posteOptions,posteFilter})}${drhActions&&filter!=="suspension"?drhEffectifActionsBarHTML():""}</div>
  ${drhActions&&filter==="suspension"?drhSuspensionOverviewHTML(list):""}`
    :`<div class="grid grid-cols-1 md:grid-cols-3 items-center gap-3 mb-4"><div><h1 class="text-2xl font-bold effectif-page-title">${title}</h1><p class="text-sm text-slate-500">${list.length} employé(s)${soc?` · ${escapeHTML(soc)}`:" · toutes sociétés"}</p></div>${effectifHeaderSearchHTML(filter)}<div class="flex items-center justify-end gap-2 flex-wrap"><span class="text-xs text-slate-500">Tri :</span><div style="max-width:260px">${sortHTML}</div></div></div>`;
  return `<div class="effectif-page ${isOpsEffectifContext()?"ops-effectif-page":""}">${header}
  ${opsEffectifFiltersHTML(filterSource,total)}
  ${effectifBulkDeleteToolbarHTML()}
  ${list.length===0?effectifEmptyStateHTML(filter,{loading:serverData?.loading,siteFilter,posteFilter,searching:!!data.searching}):`<div class="card overflow-hidden effectif-table-card"><table class="effectif-table">
    <colgroup>${selectHead?`<col style="width:44px">`:""}<col style="width:28%"><col style="width:8%"><col style="width:13%"><col style="width:13%"><col style="width:10%"><col style="width:8%">${isOpsEffectifContext()?`<col style="width:8%"><col style="width:6%"><col style="width:8%">`:""}<col style="width:108px"><col style="width:148px">${actionHeader?`<col style="width:92px">`:""}</colgroup>
    <thead><tr>${selectHead}${effectifTableHeadersHTML({ops:isOpsEffectifContext(),actionHeader})}</tr></thead>
    <tbody>${list.map(a=>employeeListRowHTML(a,filter)).join("")}</tbody></table></div>`}${serverData?.pagination||""}</div>`;
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

// Effectif sans affectation : « Affecter » ouvre l'ordre de mouvement de l'employé (aucune
// affectation directe). Mêmes droits que le serveur : module OPS, action « create », jamais en
// superviseur lecture seule.
function opsCanAssignByMovement(){
  if(!session||!isOpsEffectifContext()||isDrhModuleContext()||isOpsSupervisorReadOnlySession())return false;
  const actions=Array.isArray(session.actionsAutorisees)?session.actionsAutorisees.map(x=>String(x).toLowerCase()):[];
  if(actions.length&&!actions.some(x=>x==="create"||x==="admin"))return false;
  return canAccess("ops/mouvements");
}

const OPS_ASSIGN_BLOCKED_STATUSES=new Set(["conge","maladie","absent","suspendu","blacklist","blackliste","abandon"]);

// Affectation active à date d'effet future : l'employé reste sans affectation aujourd'hui,
// mais un second ordre serait un doublon (refusé par le serveur).
function opsPlannedAssignmentFor(a){
  const refs=new Set([a?.id,a?.backendId].map(v=>String(v||"")).filter(Boolean));
  return (db.assignments||[]).find(x=>x&&x.active!==false&&x.active!==0&&(refs.has(String(x.agentBackendId||""))||refs.has(String(x.agentId||"")))&&String(x.dateDebut||"").slice(0,10)>today())||null;
}

function opsUnassignedAssignButtonHTML(row){
  const a=(db.agents||[]).find(x=>String(x.id)===String(row?.employee_id));
  if(!a||agentHasLiveAffectation(a))return "";
  const name=((a.nom||"")+" "+(a.prenom||"")).trim()||a.matricule||"";
  const planned=opsPlannedAssignmentFor(a);
  const stKey=normalizeEmployeeStatusValue(a.statut||a.status||"actif");
  const blocked=OPS_ASSIGN_BLOCKED_STATUSES.has(stKey)||!!(a.blacklist||a.contractBlocked);
  const reason=planned?`Affectation planifiée le ${formatDate(planned.dateDebut)} : actualisez à la date d'effet`:blocked?`Employé ${stKey.toUpperCase()} : affectation impossible`:"";
  const attrs=reason
    ?`disabled title="${escapeHTML(reason)}" aria-label="${escapeHTML("Affecter "+name+" — "+reason)}" data-assign-employee="${escapeHTML(a.id)}"`
    :`aria-label="${escapeHTML("Affecter "+name)}" data-assign-employee="${escapeHTML(a.id)}" onclick="opsAssignUnassignedEmployee('${escapeHTML(jsString(a.id))}')"`;
  return opsButtonHTML(planned?"Planifiée":"Affecter",{size:"sm",variant:"primary",className:"ops-assign-btn",attrs});
}

function opsAssignUnassignedEmployee(agentId){
  if(guardOpsSupervisorMutation("mouvement","Accès superviseur OPS : création/modification mouvement non autorisée."))return;
  if(!agentId)return;
  // Même présélection que le raccourci historique : l'éditeur d'OM coche cet employé seul.
  sessionStorage.setItem("opsMovementAgentId",agentId);
  sessionStorage.setItem("opsMovementSelectedAgent",agentId);
  sessionStorage.setItem("opsMovementInitialAgent",agentId);
  navigate("ops/mouvements");
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
  const assignCol=filterKey==="affectation"&&opsCanAssignByMovement();
  const pageSubtitle=filterKey&&filterTitles[filterKey]?(soc?`<b>${escapeHTML(soc)}</b>`:""):`Employés non opérationnels avec les étapes bloquantes${soc?` · <b>${escapeHTML(soc)}</b>`:""}`;
  const cards=[
    ["Contrat",counters.contrat||0,"#dc2626"],
    ["Dotation",counters.dotation||0,"#0ea5e9"],
    ["Affectation",counters.affectation||0,"#f59e0b"]
  ];
  return `<div class="flex items-start justify-between gap-3 mb-5 flex-wrap"><div><h1 class="text-2xl font-bold">${pageTitle}</h1>${pageSubtitle?`<p class="text-sm text-slate-500">${pageSubtitle}</p>`:""}</div></div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">${cards.map(c=>{const key=c[0].toLowerCase();return`<button type="button" class="card p-4 text-left" onclick="navigate('effectif/preparation_${key}')" style="border-left:4px solid ${c[2]};color:${c[2]};${activeStyle(key)}"><div class="text-xs font-black uppercase text-slate-500">Sans ${escapeHTML(c[0])}</div><div class="text-3xl font-black mt-1" style="color:${c[2]}">${c[1]}</div></button>`}).join("")}</div>
  ${items.length?`<div class="card ${assignCol?"ops-prep-assign-card":"overflow-hidden"}"><table><thead><tr><th>Employé</th><th>Société</th><th>Poste</th><th>Site</th><th>Statut</th><th>Blocage</th>${assignCol?`<th class="text-right">Action</th>`:""}</tr></thead><tbody>${items.map(row=>{const blockers=row.blockers||[];const stKey=normalizeEmployeeStatusValue(row.statut||"actif");const stLabel=stKey.toUpperCase();const stCls=["actif","sortant","suspendu","blacklist"].includes(stKey)?"employee-status-pill employee-status-"+stKey:["absent","abandon"].includes(stKey)?"pill pill-red":"pill pill-gray";return `<tr data-searchable><td><div class="font-bold">${escapeHTML(row.name||"—")}</div><div class="text-xs font-mono text-slate-500">${escapeHTML(row.code||"—")}</div></td><td class="text-xs">${escapeHTML(row.society||"—")}</td><td class="text-xs">${escapeHTML(row.position||"—")}</td><td class="text-xs">${escapeHTML(row.site||"Sans affectation")}</td><td><span class="${stCls}">${stLabel}</span></td><td>${blockers.map(b=>`<span class="pill" style="background:${operationalPreparationColor(b.key)}18;color:${operationalPreparationColor(b.key)};font-weight:900;margin:2px">${escapeHTML(b.label)}</span>`).join(" ")}</td>${assignCol?`<td class="text-right">${opsUnassignedAssignButtonHTML(row)}</td>`:""}</tr>`}).join("")}</tbody></table></div>`:`<div class="card p-10 text-center text-slate-500">Tous les employés de ce périmètre sont prêts ou déjà opérationnels.</div>`}`;
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
  if(sgdiOpsEffectifUsesPages())return renderOpsEffectifPage(view,filter);
  const cards=(filter==="instance_affectation"||isOpsEffectifContext()||isDrhModuleContext())?"":`<div id="effectif-cards-zone">${effectifRecapCardsHTML(filter,true,true)}</div>`;
  const absRecap=filter==="absents"?`<div id="absences-recap-zone">${absencesRecapHTML()}</div>`:"";
  // Affiche immédiatement les données locales (stale-while-revalidate)
  const localHTML=effectifListHTML(filter);
  view.innerHTML=`${cards}${absRecap}<div id="effectif-list-zone">${localHTML}</div>`;
  sgdiApplyActiveEmployeeStyles(view);
  hydrateEmployeePhotos(view);
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
        hydrateEmployeePhotos(zone);
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
    if(zone){zone.innerHTML=html;sgdiApplyActiveEmployeeStyles(zone);hydrateEmployeePhotos(zone);applyEffectifSearchInPlace(effectifSearchValue(filter))}
  }).catch(e=>{
    console.warn("Effectif PostgreSQL paginé indisponible",e);
  });
}

function setEffectifSort(v){effectifSort=v;if(document.getElementById("effectif-list-zone"))return setEffectifStableFilter(sgdiOpsEffectifUsesPages()?opsEffectifActiveFilter():(sessionStorage.getItem("effectifStableFilter")||"actifs"));else renderView()}

SGDIModules.registerModule({key: "employees", routes: ["effectif","agents"], dependencies: [], init: function(){}, destroy: function(){}});
