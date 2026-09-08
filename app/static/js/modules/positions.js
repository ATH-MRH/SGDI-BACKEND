/* Phase 2 — positions. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2h-inventory.json. */
function fpFilters(){
  return {
    site:sessionStorage.getItem("fpSite")||"",
    poste:sessionStorage.getItem("fpPoste")||"",
    status:sessionStorage.getItem("fpStatus")||"",
    q:sessionStorage.getItem("fpQ")||"",
    recruitFrom:sessionStorage.getItem("fpRecruitFrom")||"",
    recruitTo:sessionStorage.getItem("fpRecruitTo")||"",
    ageMin:sessionStorage.getItem("fpAgeMin")||"",
    ageMax:sessionStorage.getItem("fpAgeMax")||"",
    sort:sessionStorage.getItem("fpSort")||"alpha_asc",
    layout:sessionStorage.getItem("fpLayout")||"mosaique"
  };
}

function setFpFilter(key,value){
  const map={site:"fpSite",poste:"fpPoste",status:"fpStatus",q:"fpQ",recruitFrom:"fpRecruitFrom",recruitTo:"fpRecruitTo",ageMin:"fpAgeMin",ageMax:"fpAgeMax",sort:"fpSort",layout:"fpLayout"};
  if(!map[key])return;
  sessionStorage.setItem(map[key],value||"");
  renderView();
}

function resetFpPositionFilters(){
  ["fpSite","fpPoste","fpStatus","fpQ","fpRecruitFrom","fpRecruitTo","fpAgeMin","fpAgeMax","fpSort","fpLayout"].forEach(k=>sessionStorage.removeItem(k));
  renderView();
}

function fpRecruitDate(a){return String(a?.dateRecrutement||a?.dateEntree||"").slice(0,10)}

function fpEmployeeAge(a){const age=ageFromDate(a?.dateNaissance);return age===null||age===undefined?null:age}

function fpPosteFilterKey(value){return normalizedSearchText(value).replace(/\s+/g," ").trim()}

function fpAgentPosteValue(a){
  const aff=agentLiveAffectation(a)||{};
  return String(aff.poste||a.fonction||a.position||a.posteContrat||"").trim();
}

function fpPosteOptions(list){
  const byKey=new Map();
  (list||[]).forEach(a=>{
    const value=fpAgentPosteValue(a);
    const key=fpPosteFilterKey(value);
    if(key&&!byKey.has(key))byKey.set(key,value);
  });
  return [...byKey.values()].sort((a,b)=>String(a).localeCompare(String(b),"fr",{numeric:true,sensitivity:"base"}));
}

function applyFpPositionFilters(list){
  const f=fpFilters();
  let out=(list||[]).slice();
  const q=String(f.q||"").toLowerCase().trim();
  if(f.site){
    const selectedSite=siteOpsSitesForScope("").find(s=>fpSiteFilterKeyForSite(s)===f.site)||null;
    const refs=selectedSite?backendAssignmentRefsForSite(selectedSite):null;
    out=out.filter(a=>refs?employeeMatchesAssignmentRefs(a,refs):fpSiteFilterKeyForAgent(a)===f.site);
  }
  if(f.poste)out=out.filter(a=>fpPosteFilterKey(fpAgentPosteValue(a))===fpPosteFilterKey(f.poste));
  if(f.status)out=out.filter(a=>employeeDisplayStatus(a).key===f.status);
  if(q)out=out.filter(a=>{
    const aff=agentLiveAffectation(a)||{};
    return String((a.nom||"")+" "+(a.prenom||"")+" "+(a.matricule||a.code||"")+" "+(a.societe||"")+" "+(aff.siteName||"")).toLowerCase().includes(q);
  });
  if(f.recruitFrom)out=out.filter(a=>fpRecruitDate(a)&&fpRecruitDate(a)>=f.recruitFrom);
  if(f.recruitTo)out=out.filter(a=>fpRecruitDate(a)&&fpRecruitDate(a)<=f.recruitTo);
  const ageMin=parseInt(f.ageMin,10);
  const ageMax=parseInt(f.ageMax,10);
  if(!Number.isNaN(ageMin))out=out.filter(a=>fpEmployeeAge(a)!==null&&fpEmployeeAge(a)>=ageMin);
  if(!Number.isNaN(ageMax))out=out.filter(a=>fpEmployeeAge(a)!==null&&fpEmployeeAge(a)<=ageMax);
  const name=a=>String((a.nom||"")+" "+(a.prenom||"")).trim().toLowerCase();
  const recruit=a=>fpRecruitDate(a)||"";
  const age=a=>fpEmployeeAge(a)??-1;
  out.sort((a,b)=>{
    if(f.sort==="alpha_desc")return name(b).localeCompare(name(a));
    if(f.sort==="recruit_asc")return recruit(a).localeCompare(recruit(b))||name(a).localeCompare(name(b));
    if(f.sort==="recruit_desc")return recruit(b).localeCompare(recruit(a))||name(a).localeCompare(name(b));
    if(f.sort==="age_asc")return age(a)-age(b)||name(a).localeCompare(name(b));
    if(f.sort==="age_desc")return age(b)-age(a)||name(a).localeCompare(name(b));
    return name(a).localeCompare(name(b));
  });
  return out;
}

function renderFiches(view,sub,_skipEnsure){
  positionsStopInteractions();
  const hash=location.hash,generation=sgdiViewRenderGeneration;
  const resume=()=>{if(hash===location.hash&&generation===sgdiViewRenderGeneration&&document.getElementById("view")===view)renderFiches(view,sub,true)};
  const fixedSociete=mySoc()||"";
  const socFilter=fixedSociete||(session?.transverse?currentStructureSocieteFilter():(sessionStorage.getItem("fpSociete")||""));
  // Pas de force:true ici : des données locales déjà présentes court-circuitent le
  // rechargement (voir sgdiEnsureEmployeesForDisplay). Avec force:true, CHAQUE visite de
  // Fiche de position relançait un chargement complet (~12 Mo) qui remplaçait la vue par
  // "Chargement des effectifs…" — perçu comme une page blanche (même bug déjà corrigé pour
  // la Feuille Pointage, commit a1690b88).
  if(!_skipEnsure&&typeof sgdiEnsureEmployeesForDisplay==="function"){const _r=sgdiEnsureEmployeesForDisplay({society:socFilter});if(_r&&typeof _r.then==="function"){view.innerHTML=`<div class="p-8 text-center text-slate-400 text-sm">Chargement des effectifs…</div>`;_r.then(resume).catch(resume);return}}
  const allowedSocietes=currentAllowedSocietes();
  const restrictedSocietes=hasExplicitSocieteRestriction();
  const adminFicheMode=isAdminFichePositionContext();
  const authorizedAgent=a=>adminFicheMode||!restrictedSocietes||allowedSocietes.some(s=>normalizeSocieteName(s)===normalizeSocieteName(a.societe));
  const fpFilter=fpFilters();
  const includeSortants=sub==="archivees"||fpFilter.status==="sortant";
  let baseList=db.agents.filter(a=>authorizedAgent(a)&&(adminFicheMode||agentInSupervisorScope(a))&&(includeSortants||!ficheAgentIsSortantArchive(a)));let title="Fiches de position — Toutes";
  if(sub==="maladie"){baseList=baseList.filter(a=>ficheAgentInMaladie(a));title="🤒 Fiches de position — En maladie"}
  else if(sub==="conge"){baseList=baseList.filter(a=>ficheAgentInConge(a));title="🏖 Fiches de position — En congé"}
  else if(sub==="suspendu"){baseList=baseList.filter(a=>a.statut==="suspendu");title="⏸ Fiches de position — Suspendu"}
  else if(sub==="abandon"){baseList=baseList.filter(a=>ficheAgentInAbandon(a));title="🚫 Fiches de position — En abandon de poste"}
  else if(sub==="surveiller"){baseList=baseList.filter(a=>ficheAgentInMaladie(a)||ficheAgentInConge(a)||a.statut==="suspendu"||ficheAgentInAbandon(a));title="⚠ Fiches de position — À surveiller"}
  else if(sub==="archivees"){baseList=baseList.filter(a=>ficheAgentIsSortantArchive(a));title="🗄 Fiches de position — Sortants / archivés"}
  else if(sub==="imprimer"){return renderFichesImpression(view)}
  else if(sub==="badge"){return renderBadgeModule(view)}
  const safeSocFilter=socFilter&&allowedSocietes.some(s=>normalizeSocieteName(s)===normalizeSocieteName(socFilter))?socFilter:"";
  const rawList=safeSocFilter?baseList.filter(a=>a.societe===safeSocFilter):baseList;
  const fpSites=fpUniqueSiteOptions(safeSocFilter);
  const fpPostes=fpPosteOptions(rawList);
  if(fpFilter.site&&!fpSites.some(s=>fpSiteFilterKeyForSite(s)===fpFilter.site)){sessionStorage.removeItem("fpSite");fpFilter.site=""}
  if(fpFilter.poste&&!fpPostes.some(p=>fpPosteFilterKey(p)===fpPosteFilterKey(fpFilter.poste))){sessionStorage.removeItem("fpPoste");fpFilter.poste=""}
  const list=applyFpPositionFilters(rawList);
  const statsBase=(safeSocFilter?db.agents.filter(a=>a.societe===safeSocFilter):db.agents).filter(authorizedAgent).filter(a=>adminFicheMode||agentInSupervisorScope(a));
  const activeBase=statsBase.filter(a=>!ficheAgentIsSortantArchive(a));
  const employeeCounters=sgdiUnifiedEmployeeCounters(safeSocFilter);
  const counterRatioBase=Math.max(1,counterNumericValue(employeeCounters.activeHeadcount)||activeBase.length);
  const activeEmployees=adminFicheMode?activeBase.filter(employeeIsActive).length:counterNumericValue(employeeCounters.active);
  const withoutAffectation=adminFicheMode?activeBase.filter(agentNeedsAffectation).length:counterNumericValue(employeeCounters.withoutAssignment);
  const suspendedEmployees=adminFicheMode?activeBase.filter(a=>String(a.statut||"").toLowerCase()==="suspendu").length:counterNumericValue(employeeCounters.suspended);
  const incompleteEmployees=activeBase.filter(a=>agentCompleteness(a).pct<85).length;
  const contractsToWatch=activeBase.filter(a=>{const end=employeePositionContractEndDate(a);if(!end)return false;const d=daysBetween(today(),end);return d>=0&&d<=60}).length;
  const ratio=(n,d)=>d?Math.round((n/d)*100):0;
  const summaryCards=[
    ["Fiches actives",activeEmployees,"Dossiers en cours","#15803d",ratio(activeEmployees,counterRatioBase),"effectif/actifs","users"],
    ["Sans affectation",withoutAffectation,"Site à renseigner","#d97706",ratio(withoutAffectation,counterRatioBase),"effectif/preparation_affectation","pin"],
    ["Dossiers incomplets",incompleteEmployees,"Informations à compléter","#dc2626",ratio(incompleteEmployees,counterRatioBase),"effectif/actifs","box"],
    ["Contrats à surveiller",contractsToWatch,"Échéance dans 60 jours","#7c3aed",ratio(contractsToWatch,counterRatioBase),"contrats","refresh"],
    ["Suspendus",suspendedEmployees,"Suspension en cours","#dc2626",ratio(suspendedEmployees,counterRatioBase),"effectif/suspension","pause"]
  ];
  const metricIcon=type=>({
    users:'<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    pin:'<svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    box:'<svg viewBox="0 0 24 24"><path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5V8Z"/><path d="M12 13v8"/></svg>',
    refresh:'<svg viewBox="0 0 24 24"><path d="M20 7h-5V2"/><path d="M20 7a9 9 0 1 0 2 8"/></svg>',
    pause:'<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
  }[type]||'');
  const activeAdvancedFilters=[fpFilter.recruitFrom,fpFilter.recruitTo,fpFilter.ageMin,fpFilter.ageMax].filter(Boolean).length;
  const showFichePrintBadgeActions=session?.transverse!=="ops";
  const opsFicheReadOnly=isOpsFicheReadOnlyContext();
  view.innerHTML=`<div class="fp-page fp-stable-layout">
    <div class="fp-head">
      <div>
        <h1 class="text-2xl font-black">${title}</h1>
        <p>${sub==="archivees"?"Fiches sorties du cycle actif":"Consultez et gérez les fiches de vos employés"}${safeSocFilter?` · <span>${escapeHTML(safeSocFilter)}</span>`:""}</p>
      </div>
      ${showFichePrintBadgeActions?`<div class="fp-head-actions">
        <a href="#/fiches/imprimer" class="fp-head-action fp-head-action-secondary"><svg viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg><span>Imprimer</span></a>
        <a href="#/fiches/badge" class="fp-head-action fp-head-action-primary"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.7-1.5 1.7-2 3-2s2.3.5 3 2M15 10h3M15 14h3"/></svg><span>Badges</span></a>
      </div>`:""}
    </div>
    <div class="fp-summary-grid">
      ${summaryCards.map(([label,note,desc,color,pct,route,icon])=>{const linked=route&&!opsFicheReadOnly;return`${linked?`<a href="#/${route}" class="fp-summary-card" style="--metric-color:${color};text-decoration:none;color:inherit">`:`<div class="fp-summary-card" style="--metric-color:${color}">`}<div class="fp-metric-icon">${metricIcon(icon)}</div><div class="fp-metric-copy"><span>${label}</span><strong>${note}</strong><small>${desc}</small></div><span class="fp-metric-trend">${pct}%</span>${linked?`</a>`:`</div>`}`}).join("")}
    </div>
    ${fpSocieteBandHTML(baseList,safeSocFilter)}
    <section class="fp-filter-panel">
      <div class="fp-filter-main">
        <div class="fp-search-field"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="fp-q" value="${escapeHTML(fpFilter.q)}" placeholder="Rechercher par nom ou matricule…" oninput="filterFiches()"/></div>
        <div class="fp-quick-filter"><label>Site</label><select id="fp-site" onchange="setFpFilter('site',this.value)"><option value="">Tous les sites</option>${fpSites.map(s=>{const key=fpSiteFilterKeyForSite(s);return`<option value="${escapeHTML(key)}" ${fpFilter.site===key?"selected":""}>${escapeHTML(s.nom||s.intitule||"Site")}</option>`}).join("")}</select></div>
        <div class="fp-quick-filter"><label>Poste</label><select id="fp-poste" onchange="setFpFilter('poste',this.value)"><option value="">Tous les postes</option>${fpPostes.map(p=>`<option value="${escapeHTML(p)}" ${fpPosteFilterKey(fpFilter.poste)===fpPosteFilterKey(p)?"selected":""}>${escapeHTML(p)}</option>`).join("")}</select></div>
        <div class="fp-quick-filter"><label>Statut</label><select id="fp-status" onchange="setFpFilter('status',this.value)"><option value="">Tous les statuts</option><option value="actif" ${fpFilter.status==="actif"?"selected":""}>Actif</option><option value="congé" ${fpFilter.status==="congé"?"selected":""}>Congé</option><option value="maladie" ${fpFilter.status==="maladie"?"selected":""}>Maladie</option><option value="suspendu" ${fpFilter.status==="suspendu"?"selected":""}>Suspendu</option><option value="absent" ${fpFilter.status==="absent"?"selected":""}>Absent</option><option value="abandon" ${fpFilter.status==="abandon"?"selected":""}>Abandon</option><option value="sortant" ${fpFilter.status==="sortant"?"selected":""}>Sortant / archivé</option></select></div>
      </div>
      <details class="fp-advanced hidden" ${activeAdvancedFilters?"open":""}>
        <summary><span><svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Plus de filtres${activeAdvancedFilters?` <b>${activeAdvancedFilters}</b>`:""}</span><span class="fp-chevron">⌄</span></summary>
        <div class="fp-advanced-grid">
          <div><label>Recrutement du</label><input type="date" value="${escapeHTML(fpFilter.recruitFrom)}" onchange="setFpFilter('recruitFrom',this.value)"/></div>
          <div><label>Recrutement au</label><input type="date" value="${escapeHTML(fpFilter.recruitTo)}" onchange="setFpFilter('recruitTo',this.value)"/></div>
          <div><label>Âge minimum</label><input type="number" min="0" max="100" value="${escapeHTML(fpFilter.ageMin)}" placeholder="25" onchange="setFpFilter('ageMin',this.value)"/></div>
          <div><label>Âge maximum</label><input type="number" min="0" max="100" value="${escapeHTML(fpFilter.ageMax)}" placeholder="45" onchange="setFpFilter('ageMax',this.value)"/></div>
        </div>
      </details>
      <div class="fp-filter-footer">
        <div class="fp-result-count"><strong>${list.length}</strong> fiche${list.length!==1?"s":""} affichée${list.length!==1?"s":""}</div>
        <div class="fp-display-controls"><label>Trier par</label><select onchange="setFpFilter('sort',this.value)">
          <option value="alpha_asc" ${fpFilter.sort==="alpha_asc"?"selected":""}>Alphabetique A-Z</option>
          <option value="alpha_desc" ${fpFilter.sort==="alpha_desc"?"selected":""}>Alphabetique Z-A</option>
          <option value="recruit_desc" ${fpFilter.sort==="recruit_desc"?"selected":""}>Recrutement recent d'abord</option>
          <option value="recruit_asc" ${fpFilter.sort==="recruit_asc"?"selected":""}>Recrutement ancien d'abord</option>
          <option value="age_asc" ${fpFilter.sort==="age_asc"?"selected":""}>Age croissant</option>
          <option value="age_desc" ${fpFilter.sort==="age_desc"?"selected":""}>Age decroissant</option>
        </select><button type="button" class="fp-reset-btn" onclick="resetFpPositionFilters()">Réinitialiser</button></div>
      </div>
    </section>
    ${list.length===0?`<div class="fp-empty-state">Aucune fiche${safeSocFilter?` pour ${escapeHTML(safeSocFilter)}`:""}.</div>`:`<div id="fp-grid" class="fp-card-grid">${list.map(a=>fichePositionCard(a)).join("")}</div>`}
  </div>`;
}

function setFpSociete(v){
  if(mySoc()){toast("Vous êtes sur "+mySoc()+". Utilisez Changer de société.","error");return}
  if(v&&!canUseSociete(v)){toast("Société non autorisée pour cet utilisateur","error");return}
  if(session?.transverse)sessionStorage.setItem(structureSocieteFilterKey(),v||"");else sessionStorage.setItem("fpSociete",v||"");
  renderView();
}

function fpSocieteBandHTML(baseList,activeSociete=""){
  if(activeSociete)return "";
  const allowedSocietes=currentAllowedSocietes();
  if(allowedSocietes.length<=1)return"";
  const rawFilter=session?.transverse?currentStructureSocieteFilter():(sessionStorage.getItem("fpSociete")||"");
  const socFilter=rawFilter&&allowedSocietes.some(s=>normalizeSocieteName(s)===normalizeSocieteName(rawFilter))?rawFilter:"";
  const imgs=loadSocieteImages();
  const countFor=s=>(baseList||[]).filter(a=>a.societe===s).length;
  const chip=(label,value,count,img,active)=>{
    const visual=img?`<img src="${img}" alt="${escapeHTML(label)}" style="width:32px;height:32px;object-fit:contain;border-radius:999px;background:#fff"/>`:`<span style="font-size:24px">🏢</span>`;
    return`<button type="button" onclick="setFpSociete('${String(value||"").replace(/'/g,"\\'")}')" class="card p-3 text-left transition" style="${active?"border:2px solid #043970;box-shadow:0 4px 12px rgba(4,57,112,.22);background:#e8f0f8":"border:2px solid transparent;background:#fff"}">
      <div class="flex items-center justify-between mb-2">${visual}<span class="pill ${active?"pill-blue":"pill-gray"}" style="font-weight:800">${count}</span></div>
      <div class="text-[10px] font-black uppercase tracking-wide" style="color:${active?"#043970":"#475569"};line-height:1.15">${escapeHTML(label)}</div>
    </button>`;
  };
  return`<div class="card p-4 mb-4" style="background:#f8fafc">
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <h3 class="text-sm font-bold uppercase tracking-wider text-slate-700">🏢 Section société</h3>
      ${socFilter?`<button class="btn btn-ghost text-xs" onclick="setFpSociete('')">Réinitialiser</button>`:`<span class="text-xs text-slate-500">Toutes les sociétés</span>`}
    </div>
    <div class="grid grid-5 gap-3">
      ${chip("Toutes les sociétés","",(baseList||[]).length,"",!socFilter)}
      ${allowedSocietes.map(s=>chip(s,s,countFor(s),imgs[s]||defaultSocieteLogo(s),socFilter===s)).join("")}
    </div>
  </div>`;
}

function fpAgentLampStatus(a){
  const td=today();
  const G={on:false,blink:false},O={on:false,blink:false},R={on:false,blink:false},B={on:false};
  const contractEnd=employeePositionContractEndDate(a);
  const dCon=contractEnd?daysBetween(td,contractEnd):null;
  if(dCon!==null&&dCon>=0&&dCon<=30){R.on=true;R.blink=true;}
  else if(dCon!==null&&dCon>=0&&dCon<=60){O.on=true;}
  if(a.dateFinEssai){const dE=daysBetween(td,a.dateFinEssai);if(dE>=0&&dE<=30){O.on=true;O.blink=true;}}
  if(a.blacklist||a.blacklistContractBlocked||a.contractBlocked){R.on=true;}
  if(Array.isArray(a.sanctions)&&a.sanctions.length>0){O.on=true;}
  const absEvs=(a.gestionEvents||[]).filter(e=>["Absence","Maladie"].includes(e.type));
  if(absEvs.length>5){O.on=true;}
  const byMonth={};
  absEvs.forEach(e=>{const m=(e.du||e.date||"").slice(0,7);if(m)byMonth[m]=(byMonth[m]||0)+1;});
  const tmo=new Date(td);tmo.setMonth(tmo.getMonth()-2);const tmoStr=tmo.toISOString().slice(0,7);
  for(const[m,c]of Object.entries(byMonth)){if(c>3&&m>=tmoStr){O.on=true;}}
  const qm=Object.entries(byMonth).filter(([,c])=>c>=2).map(([m])=>m).sort();
  let consec=0;for(let i=0;i<qm.length;i++){if(i===0){consec=1;continue;}const[py,pm]=qm[i-1].split("-").map(Number);const[cy,cm]=qm[i].split("-").map(Number);if(cy*12+cm===py*12+pm+1)consec++;else consec=1;if(consec>=3){R.on=true;break;}}
  for(const ev of (a.gestionEvents||[]).filter(e=>["Absence","Maladie"].includes(e.type)&&e.statut==="en_cours"&&e.du)){if(daysBetween(ev.du,ev.au||td)>=3){R.on=true;break;}}
  let dotMo=null;
  try{const dRows=typeof agentDotationRows==="function"?agentDotationRows(a.id,{onlyActive:false}):[];if(dRows.length){const dates=dRows.map(r=>r.date||"").filter(Boolean).sort();const recent=dates[dates.length-1];if(recent){dotMo=(new Date(td)-new Date(recent))/(1000*60*60*24*30.44);}}}catch(_){}
  if(dotMo!==null){if(dotMo>=12){R.on=true;R.blink=true;}else if(dotMo>=10){O.on=true;}}
  if(!agentHasMaterialDotation(a)){B.on=true;}
  const conOk=!contractEnd||(dCon!==null&&dCon>60);const dotOk=dotMo===null||dotMo<10;
  if(conOk&&dotOk&&!O.on&&!R.on&&!B.on){G.on=true;}
  return{G,O,R,B};
}

function fichePositionCard(a){
  const status=employeeDisplayStatus(a);
  const aff=agentLiveAffectation(a)||{};
  const siteKey=fpSiteFilterKeyForAgent(a);
  const ficheHref=isAdminFichePositionContext()?"#/admin/fiches/"+employeeRouteId(a):(isMaterielFicheContext()?"#/materiel/fiche/"+a.id:"#/effectif/agent/"+a.id);
  const ficheClick=isMaterielFicheContext()?"setFicheContext('materiel')":"";
  const isActive=status.key==="actif";
  const codeStyle=isActive?"color:#047857!important":"color:#d97706";
  const statusStyle="font-size:10px!important;text-transform:uppercase;font-weight:950!important;letter-spacing:.04em!important";
  const statusText=isActive?"ACTIF":`${status.icon?status.icon+" ":""}${status.label}`;
  const contractEnd=employeePositionContractEndDate(a);
  const opsFicheReadOnly=isOpsFicheReadOnlyContext();
  const completeness=agentCompleteness(a);
  const contractDays=contractEnd?daysBetween(today(),contractEnd):null;
  const warning=status.key==="suspendu"?"Suivi de suspension en cours":completeness.missing.length?`${completeness.missing.length} information${completeness.missing.length>1?"s":""} à compléter`:contractDays!==null&&contractDays>=0&&contractDays<=60?`Contrat à renouveler dans ${contractDays} jour${contractDays>1?"s":""}`:"Dossier conforme et à jour";
  const warningTone=status.key==="suspendu"||completeness.missing.length||contractDays!==null&&contractDays>=0&&contractDays<=60?"warning":"ok";
  return`<div class="card fp-agent-card fp-agent-card-modern" style="position:relative" data-row data-status="${escapeHTML(status.key)}" data-soc="${escapeHTML(a.societe||"")}" data-site="${escapeHTML(aff.siteId||"")}" data-site-key="${escapeHTML(siteKey)}" data-poste="${escapeHTML(aff.poste||a.fonction||a.position||a.posteContrat||"")}" data-q="${escapeHTML((a.nom+" "+a.prenom+" "+(a.matricule||"")).toLowerCase())}">
    <div class="fp-agent-card-top">
      <div class="fp-agent-photo">${a.photo?`<img src="${a.photo}" alt="Photo de ${escapeHTML((a.nom||"")+" "+(a.prenom||""))}"/>`:escapeHTML(((a.nom||"").slice(0,1)+(a.prenom||"").slice(0,1))||"?")}</div>
      <div class="fp-agent-identity"><div class="fp-agent-name">${escapeHTML(a.nom+" "+a.prenom)}</div><div class="fp-agent-matricule" style="${codeStyle}">${safe(a.matricule)}</div><div class="fp-agent-function">${safe(aff.poste||a.fonction||a.position||a.posteContrat)||"Poste non renseigné"}</div></div>
      <span class="fp-agent-status pill ${status.pill}" style="${statusStyle}">${escapeHTML(statusText)}</span>
    </div>
    <div class="fp-agent-details">
      <div><span>Site</span><strong>${safe(aff.siteName)||"Non affecté"}</strong></div>
      <div><span>Contrat</span><strong>${safe(cleanContractType(a.typeContrat))||"—"}${contractEnd?` · fin ${formatDate(contractEnd)}`:""}</strong></div>
      <div><span>Société</span><strong>${safe(a.societe)||"—"}</strong></div>
      <div><span>Complétude</span><strong>${completeness.pct}%</strong><i><b style="width:${completeness.pct}%"></b></i></div>
    </div>
    <div class="fp-agent-compliance ${warningTone}"><span></span>${escapeHTML(warning)}</div>
    <div class="fp-agent-actions">
      <div class="fp-agent-action-group">
        <a class="fp-card-action fp-card-action-main" href="${ficheHref}" ${ficheClick?`onclick="${ficheClick}"`:""}>Ouvrir fiche</a>
        ${opsFicheReadOnly?"":`<button type="button" class="fp-card-action fp-card-action-secondary" onclick="openAgentDocumentsModal('${a.id}')">Documents</button>`}
        ${isMaterielFicheContext()?`<button class="btn btn-primary text-xs" onclick="voirFicheDotation('${a.id}')">Voir fiche de dotation</button>`:""}
      </div>
    </div>
  </div>`;
}

function fichePositionListHTML(list){
  const row=a=>{
    const status=employeeDisplayStatus(a);
    const aff=agentLiveAffectation(a)||{};
    const siteKey=fpSiteFilterKeyForAgent(a);
    const href=isAdminFichePositionContext()?"#/admin/fiches/"+employeeRouteId(a):(isMaterielFicheContext()?"#/materiel/fiche/"+a.id:"#/effectif/agent/"+a.id);
    const click=isMaterielFicheContext()?` onclick="setFicheContext('materiel')"`:"";
    const age=fpEmployeeAge(a);
    const q=String((a.nom||"")+" "+(a.prenom||"")+" "+(a.matricule||"")+" "+(a.societe||"")+" "+(aff.siteName||"")).toLowerCase();
    return `<tr data-row data-status="${escapeHTML(status.key)}" data-soc="${escapeHTML(a.societe||"")}" data-site="${escapeHTML(aff.siteId||"")}" data-site-key="${escapeHTML(siteKey)}" data-poste="${escapeHTML(aff.poste||a.fonction||a.position||a.posteContrat||"")}" data-q="${escapeHTML(q)}">
      <td class="font-mono font-black text-xs">${safe(a.matricule)}</td>
      <td><div class="font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</div><div class="text-xs text-slate-500">${safe(a.telephone||a.email||"")}</div></td>
      <td class="text-xs">${safe(a.societe)}</td>
      <td class="text-xs">${safe(aff.poste||a.fonction||a.posteContrat||"—")}</td>
      <td class="text-xs">${safe(aff.siteName||"—")}</td>
      <td class="text-xs">${formatDate(fpRecruitDate(a))}</td>
      <td class="font-bold text-center">${age??"—"}</td>
      <td><span class="pill ${status.pill}">${escapeHTML(status.label)}</span></td>
      <td class="text-right"><a class="btn btn-primary text-xs" href="${href}"${click}>Ouvrir</a></td>
    </tr>`;
  };
  return `<div class="card overflow-hidden"><div class="overflow-x-auto"><table id="fp-grid"><thead><tr><th>Matricule</th><th>Employé</th><th>Société</th><th>Poste</th><th>Site</th><th>Recrutement</th><th>Age</th><th>Statut</th><th></th></tr></thead><tbody>${(list||[]).map(row).join("")}</tbody></table></div></div>`;
}

function filterFiches(){
  const site=document.getElementById("fp-site")?.value||"";
  const poste=document.getElementById("fp-poste")?.value||"";
  const status=document.getElementById("fp-status")?.value||"";
  const q=(document.getElementById("fp-q")?.value||"").toLowerCase().trim();
  sessionStorage.setItem("fpSite",site);
  sessionStorage.setItem("fpPoste",poste);
  sessionStorage.setItem("fpStatus",status);
  sessionStorage.setItem("fpQ",q);
  let shown=0;
  document.querySelectorAll("#fp-grid [data-row]").forEach(c=>{
    let ok=true;
    if(site&&c.dataset.siteKey!==site)ok=false;
    if(poste&&fpPosteFilterKey(c.dataset.poste)!==fpPosteFilterKey(poste))ok=false;
    if(status&&c.dataset.status!==status)ok=false;
    if(q&&!c.dataset.q.includes(q))ok=false;
    c.classList.toggle("hidden",!ok);
    if(ok)shown++;
  });
  const result=document.querySelector(".fp-result-count");
  if(result)result.innerHTML=`<strong>${shown}</strong> fiche${shown!==1?"s":""} affichée${shown!==1?"s":""}`;
  let empty=document.getElementById("fp-live-empty-state");
  const grid=document.getElementById("fp-grid");
  if(!shown&&grid&&!empty){
    empty=document.createElement("div");
    empty.id="fp-live-empty-state";
    empty.className="fp-empty-state";
    empty.textContent="Aucune fiche ne correspond aux filtres.";
    grid.insertAdjacentElement("afterend",empty);
  }else if(shown&&empty){
    empty.remove();
  }
}

function agentDocumentsList(){
  const base=[
    ["fiche_paie","Fiche de paie","💶"],
    ["attestation_travail","Attestation de travail","📄"],
    ["ats","ATS","🧾"],
    ["certificat_travail","Certificat de travail","📜"],
    ["ordre_affectation","Ordre d'affectation","📍"],
    ["fiche_position","Fiche de position","🪪"],
    ["fiche_dotation","Fiche de dotation","🎒"],
    ["attestation_salaire","Attestation de salaire","💰"]
  ];
  if(db&&Array.isArray(db.documentTemplates)){
    db.documentTemplates.filter(t=>t&&t.active!==false&&t.module==="drh").forEach(t=>{
      const code=normalizeDocTemplateCode(t.code);
      if(code&&!base.some(x=>x[0]===code))base.push([code,t.title||code,"📄"]);
    });
  }
  return base;
}

function agentDocumentTitle(type,societe){
  const tpl=db?activeDocumentTemplate(type,null,societe):null;
  if(tpl?.title)return tpl.title;
  const found=agentDocumentsList().find(x=>x[0]===type);
  return found?found[1]:"Document RH";
}

function updateAgentDocumentOptions(form){
  const type=form.type.value;
  const showMonth=type==="fiche_paie"||type==="attestation_salaire";
  form.querySelectorAll("[data-doc-period]").forEach(el=>el.style.display=showMonth?"block":"none");
}

function agentDocFieldMap(a,type,extra){
  const aff=a.affectationCourante||{};
  const periode=[extra.periodeDu,extra.periodeAu].filter(Boolean).join(" au ");
  return{
    nom:a.nom||"",prenom:a.prenom||"",nom_complet:((a.nom||"")+" "+(a.prenom||"")).trim(),matricule:a.matricule||"",
    societe:a.societe||"",fonction:aff.poste||a.fonction||"",site:aff.siteName||"",date_recrutement:formatDate(a.dateRecrutement),
    date_document:formatDate(extra.dateDoc||today()),mois:extra.mois||"",annee:extra.annee||"",periode:periode||"",montant:extra.montant||"",reference:extra.reference||"",
    mentions:extra.mentions||"",titre:agentDocumentTitle(type,a.societe)
  };
}

function applyAgentDocTemplate(template,map){
  return String(template||"").replace(/\{\{\s*([\w_]+)\s*\}\}/g,(m,k)=>escapeHTML(map[k]??""));
}

function agentDocumentBody(a,type,extra={}){
  const aff=a.affectationCourante||{};
  const name=escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim());
  const periode=[extra.periodeDu,extra.periodeAu].filter(Boolean).join(" au ");
  const tpl=activeDocumentTemplate(type,null,a.societe);
  if(tpl?.content){
    const body=applyAgentDocTemplate(tpl.content,agentDocFieldMap(a,type,extra)).replace(/\n{2,}/g,"</p><p>").replace(/\n/g,"<br>");
    return `<p>${body}</p>`;
  }
  const common=`<div class="doc-grid">
    <div><b>Nom et prénom</b><span>${name}</span></div>
    <div><b>Matricule</b><span>${escapeHTML(a.matricule||"—")}</span></div>
    <div><b>Société</b><span>${escapeHTML(a.societe||"—")}</span></div>
    <div><b>Fonction</b><span>${escapeHTML(aff.poste||a.fonction||"—")}</span></div>
    <div><b>Site d'affectation</b><span>${escapeHTML(aff.siteName||"—")}</span></div>
    <div><b>Date recrutement</b><span>${formatDate(a.dateRecrutement)}</span></div>
    ${extra.mois||extra.annee?`<div><b>Mois / Année</b><span>${escapeHTML([extra.mois,extra.annee].filter(Boolean).join(" "))}</span></div>`:""}
    ${periode?`<div><b>Période</b><span>${escapeHTML(periode)}</span></div>`:""}
    ${extra.montant?`<div><b>Montant</b><span>${escapeHTML(extra.montant)}</span></div>`:""}
    ${extra.reference?`<div><b>Référence</b><span>${escapeHTML(extra.reference)}</span></div>`:""}
  </div>`;
  const mentions=extra.mentions?`<p><b>Mentions :</b> ${escapeHTML(extra.mentions)}</p>`:"";
  if(type==="attestation_travail")return`${common}<p>Nous attestons que l'employé mentionné ci-dessus fait partie des effectifs de la société à la date du présent document.</p>`;
  if(type==="certificat_travail")return`${common}<p>Le présent certificat est délivré à l'intéressé pour servir et valoir ce que de droit.</p>`;
  if(type==="ats")return`${common}<p>Document ATS préparé sur la base des informations RH disponibles dans la fiche de position.</p>`;
  if(type==="ordre_affectation")return`${common}<p>L'employé est affecté au site indiqué ci-dessus selon les besoins opérationnels de la société.</p>`;
  if(type==="fiche_dotation")return`${common}<p>Fiche destinée au suivi des équipements et matériels dotés au personnel.</p>`;
  if(type==="fiche_paie")return`${common}<p>Fiche de paie à compléter avec les éléments de paie validés par le service concerné.</p>`;
  if(type==="attestation_salaire")return`${common}<p>Attestation de salaire à compléter selon les éléments validés de rémunération.</p>`;
  return common+mentions;
}

async function buildAgentDocumentHTML(id,type,extra={},templateFile=null){
  const a=(db.agents||[]).find(x=>x.id===id);if(!a)throw new Error("Agent introuvable");
  const title=agentDocumentTitle(type,a.societe);
  let body=agentDocumentBody(a,type,extra);
  let modelAttachment=null;
  const configuredTemplate=activeDocumentTemplate(type,null,a.societe);
  if(templateFile){
    modelAttachment=await readSmallFile(templateFile);
    const isText=/\.(html?|txt)$/i.test(templateFile.name||"")||/^text\//.test(templateFile.type||"");
    if(isText&&modelAttachment&&modelAttachment.data){
      const raw=decodeURIComponent(escape(atob(String(modelAttachment.data).split(",")[1]||"")));
      body=applyAgentDocTemplate(raw,agentDocFieldMap(a,type,extra));
    }
  }else if(configuredTemplate?.file?.data){
    modelAttachment=configuredTemplate.file;
    const isText=/\.(html?|txt)$/i.test(modelAttachment.name||"")||/^text\//.test(modelAttachment.type||"");
    if(isText){
      const raw=decodeURIComponent(escape(atob(String(modelAttachment.data).split(",")[1]||"")));
      body=applyAgentDocTemplate(raw,agentDocFieldMap(a,type,extra));
    }
  }
  const html=`<!doctype html><html><head><title>${escapeHTML(title)} ${escapeHTML(a.matricule||"")}</title></head><body><main>
  <div class="head"><div><div class="brand">${escapeHTML(a.societe||"SGDI")}</div><div>Gestion des ressources humaines</div></div><div class="meta">Date : ${formatDate(extra.dateDoc||today())}<br>Réf : ${escapeHTML(extra.reference||a.matricule||"—")}</div></div>
  <h1>${escapeHTML(title)}</h1>${body}
  ${modelAttachment&&!/\.(html?|txt)$/i.test(templateFile.name||"")?`<div class="model-note">Modèle téléversé joint : ${escapeHTML(modelAttachment.name||templateFile.name)}</div>`:""}
  <div class="sign"><div>Signature et cachet</div></div></main></body></html>`;
  return{html,a,title,type,extra,modelAttachment};
}

async function generateAgentDocumentFromForm(id,form,mode){
  try{
    const type=form.type.value;
    if(type==="fiche_position"&&mode!=="send"){printFiche(id);return}
    if(type==="fiche_dotation"&&mode!=="send"&&typeof voirFicheDotation==="function"){voirFicheDotation(id);return}
    const extra={dateDoc:form.dateDoc.value,mois:form.mois.value,annee:form.annee.value,periodeDu:form.periodeDu.value,periodeAu:form.periodeAu.value,montant:form.montant.value,reference:form.reference.value,mentions:form.mentions.value};
    const built=await buildAgentDocumentHTML(id,type,extra,form.modele.files&&form.modele.files[0]);
    if(mode==="send"){sendAgentDocumentToInbox(built,type,extra);return}
    openAgentDocumentWindow(built.html,built.title,mode==="print",{agentId:built.a.id,title:built.title,category:"Documents RH",type,reference:extra.reference||built.title,date:extra.dateDoc||today()});
  }catch(e){toast(e.message||String(e),"error")}
}

function openAgentDocumentWindow(html,title,printNow,meta={}){
  const w=window.open("","_blank");
  if(!w){toast("Popup bloquée par le navigateur","error");return}
  w.document.write(printNow?prepareEmployeeDocumentForValidation(html,{title,category:"Documents RH",type:title,reference:title,date:today(),...meta},"Valider document"):html);
  w.document.close();
}

function sendAgentDocumentToInbox(built,type,extra){
  const htmlData="data:text/html;charset=utf-8,"+encodeURIComponent(built.html);
  const d={id:uid("doc"),ref:"DOC-RH-"+new Date().toISOString().slice(0,10).replaceAll("-","")+"-"+Math.floor(Math.random()*9000+1000),date:today(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdBy:session?.username||"DRH",agentId:built.a.id,agentName:((built.a.nom||"")+" "+(built.a.prenom||"")).trim(),matricule:built.a.matricule||"",societe:built.a.societe||"",site:(built.a.affectationCourante||{}).siteName||"",type:"Document RH",categorie:built.title,urgence:"normale",objet:built.title,message:"Document RH généré et transmis via SGDI.",statut:"traite",reponse:"Votre document est disponible en téléchargement dans cette boîte de réception.",pieces:[{name:built.title+" - "+(built.a.matricule||"")+".html",type:"text/html",data:htmlData},...(built.modelAttachment?[built.modelAttachment]:[])],documentsDemandes:[],source:"documents-rh",payloadOriginal:{documentType:type,options:extra},historique:[{date:new Date().toISOString(),user:session?.username||"DRH",action:"Document transmis",note:built.title}]};
  ensureDemandesPersonnel().push(d);
  saveDB();renderSidebar();closeModal();toast("Document envoyé dans la boîte de réception portail RH","success");
}

function printAgentDocument(id,type){
  if(type==="fiche_position"){printFiche(id);return}
  if(type==="fiche_dotation"&&typeof voirFicheDotation==="function"){voirFicheDotation(id);return}
  const form=document.createElement("form");
  form.innerHTML=`<input name="dateDoc" value="${today()}"><input name="mois"><input name="annee"><input name="periodeDu"><input name="periodeAu"><input name="montant"><input name="reference"><textarea name="mentions"></textarea><select name="type"><option value="${type}"></option></select><input type="file" name="modele">`;
  generateAgentDocumentFromForm(id,form,"print");
}

function renderFichesImpression(view){
  const baseList=db.agents.filter(a=>a.statut==="actif");
  const socFilter=session?.transverse?currentStructureSocieteFilter():(sessionStorage.getItem("fpSociete")||"");
  const list=socFilter?baseList.filter(a=>a.societe===socFilter):baseList;
  view.innerHTML=`<div class="mb-4"><h1 class="text-2xl font-bold">🖨 Impression en lot</h1><p class="text-slate-500 text-sm">Sélectionnez les fiches à imprimer. ${list.length} agent(s) actif(s).</p></div>
    <div class="card p-4 mb-4">
      <div class="flex items-center gap-2 mb-3 flex-wrap">
        <button class="btn btn-secondary text-xs" onclick="document.querySelectorAll('.fp-check').forEach(c=>c.checked=true)">Tout cocher</button>
        <button class="btn btn-secondary text-xs" onclick="document.querySelectorAll('.fp-check').forEach(c=>c.checked=false)">Tout décocher</button>
        <button class="btn btn-primary text-xs" onclick="printFichesEnLot()">🖨 Imprimer la sélection</button>
      </div>
      <div class="grid grid-3 gap-2">${list.map(a=>`<label class="flex items-center gap-2 p-2 bg-slate-50 rounded border border-slate-200 text-sm cursor-pointer hover:bg-slate-100"><input type="checkbox" class="fp-check" value="${a.id}"/><span class="font-mono text-xs text-amber-600">${safe(a.matricule)}</span><span class="truncate">${escapeHTML(a.nom+" "+a.prenom)}</span></label>`).join("")}</div>
    </div>`;
}

function printFichesEnLot(){
  const ids=Array.from(document.querySelectorAll(".fp-check:checked")).map(c=>c.value);
  if(ids.length===0){toast("Aucune fiche sélectionnée","error");return}
  const w=window.open("","_blank");
  const html=ids.map(id=>{const a=db.agents.find(x=>x.id===id);return a?`<div style="page-break-after:always">${ficheHTML(a)}</div>`:""}).join("");
  w.document.write(`<!doctype html><html><head><title>Fiches de position</title></head><body>${html}</body></html>`);
  w.document.close();setTimeout(()=>w.print(),300);
}

function badgeAgentsList(){
  const socFilter=session?.transverse?currentStructureSocieteFilter():(sessionStorage.getItem("fpSociete")||"");
  return (db.agents||[]).filter(a=>a.statut==="actif"&&(!socFilter||a.societe===socFilter)).sort((a,b)=>((a.nom||"")+" "+(a.prenom||"")).localeCompare((b.nom||"")+" "+(b.prenom||"")));
}

function badgeSelectedAgent(){
  const list=badgeAgentsList();
  const id=sessionStorage.getItem("badgeAgentId")||"";
  return list.find(a=>a.id===id)||list[0]||null;
}

function renderBadgeModule(view){
  const list=badgeAgentsList();
  const selected=badgeSelectedAgent();
  const badgeActive=!selected||selected.badgeActif!==false;
  if(selected)sessionStorage.setItem("badgeAgentId",selected.id);
  const color=sessionStorage.getItem("badgeColor")||"#043970";
  const format=sessionStorage.getItem("badgeFormat")||"vertical";
  const verso=sessionStorage.getItem("badgeVerso")||"oui";
  view.innerHTML=`<div class="mb-4 flex items-start justify-between gap-3 flex-wrap">
    <div><h1 class="text-2xl font-bold">Création de badge</h1><p class="text-slate-500 text-sm">Module DRH · création, aperçu et impression des badges personnel.</p></div>
	    <div class="flex gap-2 flex-wrap"><a href="#/fiches/toutes" class="btn btn-ghost text-sm">Retour fiches</a>${selected?`<button class="btn btn-secondary text-sm" onclick="previewBadge('${selected.id}')">Aperçu badge</button><button class="btn btn-primary text-sm" onclick="printBadge('${selected.id}')">Imprimer badge</button>`:""}</div>
  </div>
  <div class="badge-builder-grid grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div class="card p-4 badge-agent-panel">
      <div class="flex items-center justify-between mb-3 gap-2">
        <h3 class="font-bold text-sm">Employés actifs</h3>
        <span class="pill pill-gray">${list.length}</span>
      </div>
      <div class="mb-3"><input id="badge-q" class="input" placeholder="Recherche nom, matricule..." oninput="filterBadgeAgents()"/></div>
      <div id="badge-agent-list" class="space-y-2 badge-agent-scroll">
        ${list.length?list.map(a=>badgeAgentRowHTML(a,selected&&a.id===selected.id)).join(""):`<div class="text-center text-slate-500 p-6">Aucun employé actif.</div>`}
      </div>
    </div>
    <div class="lg:col-span-2 space-y-4 badge-preview-sticky">
      <div class="card p-4">
        <h3 class="font-bold text-sm mb-3">Configuration du badge</h3>
	        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
	          <div><label class="label">Format</label><select class="select" id="badge-format" onchange="setBadgeOption('badgeFormat',this.value)"><option value="vertical" ${format==="vertical"?"selected":""}>Vertical</option><option value="horizontal" ${format==="horizontal"?"selected":""}>Horizontal</option></select></div>
	          <div><label class="label">Verso</label><select class="select" id="badge-verso" onchange="setBadgeOption('badgeVerso',this.value)"><option value="oui" ${verso==="oui"?"selected":""}>Avec verso</option><option value="non" ${verso==="non"?"selected":""}>Recto uniquement</option></select></div>
	          <div><label class="label">Couleur</label><input class="input h-[42px]" type="color" id="badge-color" value="${escapeHTML(color)}" onchange="setBadgeOption('badgeColor',this.value)"/></div>
	          <div><label class="label">Statut badge</label><button class="btn ${badgeActive?"btn-danger":"btn-primary"} w-full justify-center" ${selected?`onclick="toggleBadgeStatus('${selected.id}')"`:"disabled"}>${badgeActive?"Désactiver":"Activer"}</button></div>
	        </div>
	        <div class="mt-3 flex items-center justify-between gap-2 flex-wrap">
	          <span class="pill ${badgeActive?"pill-green":"pill-red"}">${badgeActive?"Badge actif":"Badge désactivé"}</span>
	          <button class="btn btn-secondary text-sm" onclick="printBadgesSelection()">Imprimer sélection</button>
	        </div>
	      </div>
      <div class="card p-5">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2"><h3 class="font-bold text-sm">Aperçu</h3>${selected?`<div class="text-xs text-slate-500">${escapeHTML(selected.nom+" "+selected.prenom)} · ${escapeHTML(selected.matricule||"")}</div>`:""}</div>
        ${selected&&selected.photo?badgePhotoCropToolsHTML(selected):""}
        ${selected?`<div class="flex justify-center overflow-auto p-4 bg-slate-100 rounded-lg">${badgeHTML(selected,{color,format,verso,preview:true})}</div>`:`<div class="text-center text-slate-500 p-10">Sélectionnez un employé.</div>`}
      </div>
    </div>
  </div>`;
}

function badgeAgentRowHTML(a,active){
  const aff=a.affectationCourante||{};
  return`<button type="button" data-badge-agent data-q="${escapeHTML(((a.nom||"")+" "+(a.prenom||"")+" "+(a.matricule||"")).toLowerCase())}" onclick="selectBadgeAgent('${a.id}')" class="w-full text-left p-3 rounded border transition" style="border-color:${active?"#043970":"#e2e8f0"};background:${active?"#04397011":"#fff"}">
    <div class="flex items-center gap-3">
      <div class="avatar" style="width:42px;height:42px;font-size:14px">${a.photo?`<img src="${a.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`:escapeHTML((a.prenom||"?").slice(0,1))}</div>
      <div class="min-w-0 flex-1"><div class="font-bold truncate">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</div><div class="font-mono text-xs text-amber-700 font-bold">${escapeHTML(a.matricule||"—")}</div><div class="text-[10px] text-slate-500 truncate">${escapeHTML(aff.poste||a.fonction||"—")} · ${escapeHTML(a.societe||"")}</div></div>
	      <input type="checkbox" class="badge-check" value="${a.id}" onclick="event.stopPropagation()"/>
	      <span class="pill ${a.badgeActif===false?"pill-red":"pill-green"} text-[10px]">${a.badgeActif===false?"OFF":"ON"}</span>
	    </div>
	  </button>`;
}

function selectBadgeAgent(id){sessionStorage.setItem("badgeAgentId",id);renderView()}

function setBadgeOption(k,v){sessionStorage.setItem(k,v);renderView()}

async function toggleBadgeStatus(id){
  const a=(db.agents||[]).find(x=>String(x.id)===String(id));
  if(!a){toast("Employé introuvable","error");return}
  const next=a.badgeActif===false;
  a.badgeActif=next;
  a.updatedAt=new Date().toISOString();
  try{
    if(a.backendId){
      const saved=await SGDI.employees.update(a.backendId,employeeApiPayload(a));
      Object.assign(a,employeeFromApi(saved),a,{backendId:saved?.id||a.backendId});
    }
  }catch(e){
    a.badgeActif=!next;
    toast("Statut badge non enregistré : "+(e.message||e),"error");
    renderView();
    return;
  }
  if(!(await saveDBAndWaitToast("Statut badge non confirmé"))){
    a.badgeActif=!next;
    renderView();
    return;
  }
  toast(next?"Badge activé":"Badge désactivé",next?"success":"info");
  renderView();
}

function filterBadgeAgents(){
  const q=(document.getElementById("badge-q")?.value||"").toLowerCase().trim();
  document.querySelectorAll("[data-badge-agent]").forEach(r=>r.classList.toggle("hidden",q&&!r.dataset.q.includes(q)));
}

function badgeFindAgent(id){
  return (db.agents||[]).find(x=>String(x.id)===String(id)||String(x.backendId||"")===String(id)||String(x.matricule||"")===String(id));
}

function badgePhotoHTML(a,opts){
  opts=opts||{};
  const style=opts.style||"";
  if(!a.photo)return`<div class="badge-photo" style="${style}">PHOTO</div>`;
  const editable=!!opts.editable;
  const id=String(a.id||a.backendId||a.matricule||"");
  return`<div class="badge-photo badge-photo-crop ${editable?"is-editable":""}" style="${style}" data-badge-photo-id="${escapeHTML(id)}" ${editable?`onpointerdown="badgePhotoPointerDown(event,'${jsString(id)}')" onwheel="badgePhotoWheel(event,'${jsString(id)}')" title="Glisser pour recadrer · molette pour zoomer"`:""}>
    <img src="${escapeHTML(a.photo)}" alt="Photo ${escapeHTML(a.matricule||"")}" draggable="false" style="transform:${badgePhotoTransform(a)}"/>
    ${editable?`<span class="badge-photo-crop-hint no-print">Glisser · Zoom</span>`:""}
  </div>`;
}

function badgePhotoCropToolsHTML(a){
  const c=badgePhotoCrop(a);
  const id=String(a.id||a.backendId||a.matricule||"");
  return`<div class="badge-crop-tools no-print">
    <div class="badge-crop-help">Photo : glissez directement sur le badge pour déplacer, utilisez la molette ou le zoom pour redimensionner.</div>
    <label class="badge-crop-zoom"><span>Zoom</span><input id="badge-photo-zoom" type="range" min="1" max="3.5" step="0.01" value="${c.scale}" oninput="badgePhotoZoomInput('${jsString(id)}',this.value)"></label>
    <button type="button" class="btn btn-ghost text-xs" onclick="badgePhotoReset('${jsString(id)}')">Recentrer</button>
  </div>`;
}

function badgePhotoApplyToDom(a){
  if(!a)return;
  const id=String(a.id||a.backendId||a.matricule||"");
  const safeId=window.CSS&&CSS.escape?CSS.escape(id):id.replace(/"/g,'\\"');
  const transform=badgePhotoTransform(a);
  document.querySelectorAll(`[data-badge-photo-id="${safeId}"] img`).forEach(img=>{img.style.transform=transform});
  const zoom=document.getElementById("badge-photo-zoom");
  if(zoom)zoom.value=badgePhotoCrop(a).scale;
}

function badgePhotoSetCrop(id,patch,opts){
  const a=badgeFindAgent(id);
  if(!a)return;
  const current=badgePhotoCrop(a);
  a.badgePhotoCrop={...current,...patch};
  a.badgePhotoCrop=badgePhotoCrop(a);
  a.updatedAt=new Date().toISOString();
  badgePhotoApplyToDom(a);
  if(!opts||opts.persist!==false)badgePhotoScheduleSave(id);
}

function badgePhotoScheduleSave(id){
  clearTimeout(badgePhotoCropSaveTimer);
  positionsPendingCropId=id;
  badgePhotoCropSaveTimer=setTimeout(()=>{badgePhotoCropSaveTimer=null;positionsPendingCropId=null;persistBadgePhotoCrop(id)},450);
}

async function persistBadgePhotoCrop(id){
  const a=badgeFindAgent(id);
  if(!a)return;
  try{
    if(a.backendId&&window.SGDI&&SGDI.employees&&SGDI.employees.update){
      const saved=await SGDI.employees.update(a.backendId,employeeApiPayload(a));
      Object.assign(a,employeeFromApi(saved),a,{backendId:saved?.id||a.backendId});
    }
    await saveDBAndWaitToast("Recadrage photo non confirmé");
  }catch(e){
    toast("Recadrage photo non enregistré : "+(e.message||e),"error");
  }
}

function badgePhotoZoomInput(id,value){
  badgePhotoSetCrop(id,{scale:Number(value)||1});
}

function badgePhotoReset(id){
  badgePhotoSetCrop(id,{x:0,y:0,scale:1});
}

function badgePhotoWheel(ev,id){
  ev.preventDefault();
  const a=badgeFindAgent(id);
  if(!a)return;
  const c=badgePhotoCrop(a);
  const next=c.scale+(ev.deltaY<0?0.08:-0.08);
  badgePhotoSetCrop(id,{scale:next});
}

function badgePhotoPointerDown(ev,id){
  if(ev.button!==undefined&&ev.button!==0)return;
  const a=badgeFindAgent(id);
  if(!a||!a.photo)return;
  ev.preventDefault();
  const c=badgePhotoCrop(a);
  window.__badgePhotoDrag={id,startX:ev.clientX,startY:ev.clientY,x:c.x,y:c.y};
  ev.currentTarget?.classList.add("is-dragging");
  try{ev.currentTarget?.setPointerCapture?.(ev.pointerId)}catch(e){}
  window.addEventListener("pointermove",badgePhotoPointerMove);
  window.addEventListener("pointerup",badgePhotoPointerUp,{once:true});
  window.addEventListener("pointercancel",badgePhotoPointerUp,{once:true});
}

function badgePhotoPointerMove(ev){
  const drag=window.__badgePhotoDrag;
  if(!drag)return;
  badgePhotoSetCrop(drag.id,{x:drag.x+(ev.clientX-drag.startX),y:drag.y+(ev.clientY-drag.startY)},{persist:false});
}

function badgePhotoPointerUp(){
  const drag=window.__badgePhotoDrag;
  window.removeEventListener("pointermove",badgePhotoPointerMove);
  window.removeEventListener("pointerup",badgePhotoPointerUp);
  window.removeEventListener("pointercancel",badgePhotoPointerUp);
  document.querySelectorAll(".badge-photo-crop.is-dragging").forEach(el=>el.classList.remove("is-dragging"));
  if(drag)badgePhotoScheduleSave(drag.id);
  window.__badgePhotoDrag=null;
}

function badgeHTML(a,opts){
  opts=opts||{};
  const color=opts.color||"#043970";
  const format=opts.format||"vertical";
  const verso=opts.verso!=="non";
  const aff=a.affectationCourante||{};
  const vertical=format==="vertical";
  const size=vertical?"width:54mm;height:86mm":"width:86mm;height:54mm";
  const photoSize=vertical?"35mm":"29mm";
  const nom=String(a.nom||"").trim();
  const prenom=String(a.prenom||"").trim();
  const code=String(a.matricule||"—").trim();
  const fonction=String(aff.poste||a.fonction||"Employé").trim();
  const groupeSanguin=String(a.groupeSanguin||a.groupe_sanguin||"").trim();
  const recto=`<section class="badge-card ${vertical?"vertical":"horizontal"}" style="${size}">
    <div class="badge-top" style="background:${color}"><div class="badge-brand">${escapeHTML(a.societe||"SGDI")}</div><div class="badge-type">BADGE PERSONNEL</div></div>
    <div class="badge-body">
      <div class="badge-identity-row">
        ${badgePhotoHTML(a,{style:`width:${photoSize};height:${photoSize}`,editable:!!opts.preview})}
        <div class="badge-identity-fields">
          <div class="badge-name">${escapeHTML(nom||"—")}</div>
          <div class="badge-prenom">${escapeHTML(prenom||"")}</div>
          <div class="badge-code">${escapeHTML(code||"—")}</div>
          <div class="badge-job">${escapeHTML(fonction||"—")}</div>
          ${groupeSanguin?`<div class="badge-blood">Groupe sanguin : <b>${escapeHTML(groupeSanguin)}</b></div>`:""}
        </div>
      </div>
      <img class="badge-seal" src="/static/iron-service-badge-seal.png" alt=""/>
    </div>
    <div class="badge-foot" style="border-color:${color}">Valable avec pièce d'identité professionnelle</div>
  </section>`;
  const back=`<section class="badge-card badge-back ${vertical?"vertical":"horizontal"}" style="${size}">
    <div class="badge-top" style="background:${color}"><div class="badge-brand">CONSIGNES</div></div>
    <div class="badge-back-body">
      <div class="badge-back-important">IMPORTANT</div>
      <div class="badge-back-text">
        <p>Ce badge est la propriété exclusive de la société. Personnel et non transférable, il doit être porté visible en permanence dans l'enceinte de l'établissement. Toute perte, tout vol ou disparition doit être signalé sans délai au service des ressources humaines. Il doit être restitué immédiatement en cas de fin de contrat. Toute utilisation frauduleuse expose son détenteur à des poursuites.</p>
      </div>
      <div class="badge-back-qr"><img src="${badgeQrSrc(a,160)}" alt="QR ${escapeHTML(a.matricule||"")}"/></div>
    </div>
  </section>`;
  return `<div class="badge-sheet-preview">${recto}${verso?back:""}</div>`;
}

function badgePrintStyles(){
  // La fenêtre d'aperçu/impression est un document tout neuf, sans accès au CSS de l'appli :
  // sans cette feuille de style, le badge s'affiche en HTML brut (voir bug signalé).
  return `<link rel="stylesheet" href="/static/sgdi-app.css">`;
}

function previewBadge(id){
  const a=(db.agents||[]).find(x=>x.id===id);if(!a){toast("Employé introuvable","error");return}
  const opts={color:sessionStorage.getItem("badgeColor")||"#043970",format:sessionStorage.getItem("badgeFormat")||"vertical",verso:sessionStorage.getItem("badgeVerso")||"oui"};
  // Écriture directe, en un seul passage : l'employé vient d'être sélectionné dans ce module
  // (l'aperçu intégré a déjà déclenché la récupération du lien QR signé, voir badgeVerifyURL),
  // donc pas besoin d'un écran "Préparation..." intermédiaire qui ne fait que clignoter.
  const w=window.open("","_blank","width=900,height=700");
  if(!w)return;
  w.document.write(`<!doctype html><html><head><title>Aperçu badge ${escapeHTML(a.matricule||"")}</title>${badgePrintStyles()}</head><body><main class="badge-print-page">${badgeHTML(a,opts)}</main></body></html>`);
  w.document.close();
}

async function printBadge(id){
  const a=(db.agents||[]).find(x=>x.id===id);if(!a){toast("Employé introuvable","error");return}
  const opts={color:sessionStorage.getItem("badgeColor")||"#043970",format:sessionStorage.getItem("badgeFormat")||"vertical",verso:sessionStorage.getItem("badgeVerso")||"oui"};
  // Ouvrir la fenêtre tout de suite (dans le même geste utilisateur) pour éviter le blocage
  // popup, puis la remplir une fois le lien QR signé récupéré (voir fetchBadgePublicLink).
  const w=window.open("","_blank","width=900,height=700");
  if(w){w.document.write(`<!doctype html><body style="font-family:Arial,sans-serif;padding:40px;color:#64748b">Préparation du badge…</body>`);w.document.close()}
  await fetchBadgePublicLink(a);
  if(!w||w.closed)return;
  w.document.open();
  w.document.write(`<!doctype html><html><head><title>Badge ${escapeHTML(a.matricule||"")}</title>${badgePrintStyles()}</head><body><main class="badge-print-page">${badgeHTML(a,opts)}</main><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

async function printBadgesSelection(){
  const ids=Array.from(document.querySelectorAll(".badge-check:checked")).map(x=>x.value);
  if(!ids.length){const a=badgeSelectedAgent();if(a)return printBadge(a.id);toast("Sélectionnez au moins un employé","error");return}
  const opts={color:sessionStorage.getItem("badgeColor")||"#043970",format:sessionStorage.getItem("badgeFormat")||"vertical",verso:sessionStorage.getItem("badgeVerso")||"oui"};
  const agents=ids.map(id=>(db.agents||[]).find(x=>x.id===id)).filter(Boolean);
  const w=window.open("","_blank","width=900,height=700");
  if(w){w.document.write(`<!doctype html><body style="font-family:Arial,sans-serif;padding:40px;color:#64748b">Préparation des badges…</body>`);w.document.close()}
  await Promise.all(agents.map(fetchBadgePublicLink));
  if(!w||w.closed)return;
  const html=agents.map(a=>badgeHTML(a,opts)).join("");
  w.document.open();
  w.document.write(`<!doctype html><html><head><title>Badges personnel</title>${badgePrintStyles()}</head><body><main class="badge-print-page">${html}</main><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}

SGDIModules.registerModule({key: "positions", routes: ["fiches","badge"], dependencies: [], init: function(){}, destroy: positionsStopInteractions});

let positionsPendingCropId=null;
function positionsStopInteractions(){
  badgePhotoPointerUp();
  if(positionsPendingCropId!==null){
    const id=positionsPendingCropId;
    clearTimeout(badgePhotoCropSaveTimer);badgePhotoCropSaveTimer=null;positionsPendingCropId=null;
    persistBadgePhotoCrop(id);
  }
}
