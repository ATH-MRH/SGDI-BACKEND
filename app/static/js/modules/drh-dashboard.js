/* Phase 2 — drh-dashboard. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function setDrhSociete(s){
  try{
    sessionStorage.setItem("drhSociete",s||"");
    sessionStorage.removeItem("ptSociete");
    sessionStorage.removeItem("ptSearch");
  }catch(e){}
  window.__ptLightEmployees={};
  window.__ptLightEmployeesAt={};
  window.__pointageEligibleStableAgentsBySoc={};
  _ptAutoEmployeesSyncedAt=0;
  render();
}

function drhAgentIdsForSociete(){return new Set(drhApplySocieteFilter(db.agents||[]).map(a=>a.id))}

function drhResolvedAgentSite(agent,sites=db.sites||[]){
  const aff=agentLiveAffectation(agent);
  if(!aff)return null;
  return (sites||[]).find(s=>siteMatchesReference(s,aff))||null;
}

function drhOperationalAgents(list){
  return (list||[]).filter(agentIsOperational);
}

function drhSiteBucketsFromAgents(agents,sites=db.sites||[]){
  const buckets=new Map();
  // Cette répartition décrit les salariés actifs actuellement affectés. Elle ne
  // doit pas disparaître parce qu'une dotation ou un PV reste à compléter.
  (agents||[]).filter(a=>employeeIsActive(a)&&agentHasLiveAffectation(a)).forEach(a=>{
    const aff=agentLiveAffectation(a);
    const site=drhResolvedAgentSite(a,sites);
    const label=site?.nom||site?.intitule||aff?.siteName||"Site inconnu";
    const key=String(site?.backendId||site?.id||normalizedSearchText(label));
    const row=buckets.get(key)||{label,total:0,actif:0,masse:0,site};
    row.total++;
    row.actif++;
    row.masse+=Number(a.salaire)||0;
    buckets.set(key,row);
  });
  return [...buckets.values()].sort((a,b)=>b.actif-a.actif||a.label.localeCompare(b.label));
}

// Aucun repli sur les collections locales : ces compteurs sont calculés ensemble
// par PostgreSQL, sur les contrats Commercial et les affectations OPS/DRH.
function drhStaffingTotals(){
  const counters=sgdiBackendModuleCounters("staffing",drhActiveSocieteFilter());
  if(!counters||![counters.contract,counters.actual,counters.gap].every(Number.isFinite))return null;
  return counters;
}

function renderDRHDashboard(view){
  const selSoc=drhActiveSocieteFilter();
  sgdiRefreshDrhStats(selSoc).catch(()=>null);
  sgdiEnsureEmployeesForDisplay({society:selSoc,force:true});
  const allCo=db.conges||[];const allSi=db.sites||[];const allInc=db.incidents||[];
  const ag=drhAgentsList();
  // Population opérationnelle courante. Les sortants restent disponibles dans
  // les archives et l'historique, mais sont exclus de tous les calculs vivants.
  const activeAg=ag.filter(a=>!employeeIsFormer(a));
  const activeAgIds=new Set(activeAg.map(a=>String(a.id)));
  const co=allCo.filter(c=>activeAgIds.has(String(c.agentId)));
  const siteIds=new Set(activeAg.map(a=>agentLiveAffectation(a)?.siteId).filter(Boolean));
  const si=selSoc?allSi.filter(s=>siteIds.has(s.id)||drhMatchSoc(s,selSoc)):allSi;
  const sIds=new Set(si.map(s=>s.id));
  const inc=selSoc?allInc.filter(i=>(i.agentId&&activeAgIds.has(String(i.agentId)))||(i.siteId&&sIds.has(i.siteId))):allInc;
  const actifs=activeAg.filter(a=>a.statut==="actif").length;
  // Sets construits une fois (au lieu d'un .some() sur co pour CHAQUE employé, O(effectif×congés))
  // : la même info recalculée à l'identique, en O(congés+effectif).
  const congeAgentIds=new Set(co.filter(c=>c.statut==="approuve"&&c.type!=="Maladie"&&inRange(c)).map(c=>String(c.agentId)));
  const maladieAgentIds=new Set(co.filter(c=>c.statut==="approuve"&&c.type==="Maladie"&&inRange(c)).map(c=>String(c.agentId)));
  const enConge=activeAg.filter(a=>congeAgentIds.has(String(a.id))).length;
  const enMaladie=activeAg.filter(a=>maladieAgentIds.has(String(a.id))).length;
  const absents=activeAg.filter(a=>a.statut==="absent").length;
  const susp=activeAg.filter(a=>a.statut==="suspendu").length;
  const sortants=ag.filter(a=>["sortant","demissionne","licencie"].includes(a.statut)).length;
  const actifsBase=Math.max(1,activeAg.length);
  const salaires=activeAg.filter(a=>a.statut==="actif").map(a=>Number(a.salaire||a.salaireNet||0)).filter(n=>n>0);
  const masseSalaires=salaires.reduce((s,n)=>s+n,0);
  const salaireMoyen=salaires.length?Math.round(masseSalaires/salaires.length):0;
  const sites=si.length;
  const incidentsOuverts=inc.filter(i=>i.statut!=="cloture").length;
  const demandesList=drhDemandesPersonnelList();
  const demandesPersonnel=demandesList.filter(d=>["nouveau","en_cours"].includes(d.statut||"nouveau")).length;
  const congesAttente=co.filter(c=>c.statut==="en_attente").length;
  const socialAlertes=activeAg.filter(a=>a.statut==="actif"&&(!socialCnasOk(a)||!socialChifaOk(a))).length;
  const contratsExpires=activeAg.filter(a=>{const d=employeePositionContractDaysLeft(a);return d!==null&&d<0});
  const contratsFin30=activeAg.filter(a=>{const d=employeePositionContractDaysLeft(a);return d!==null&&d>=0&&d<=30});
  const contratsAlerte=[...contratsExpires,...contratsFin30].sort((a,b)=>String(employeePositionContractEndDate(a)||"").localeCompare(String(employeePositionContractEndDate(b)||"")));
  const srvEmp=sgdiErpEmployeeCounters(selSoc);
  const srvDrh=sgdiErpModuleCounters("drh",selSoc);
  const srvOps=sgdiErpModuleCounters("ops",selSoc);
  // Le total serveur peut inclure les dossiers archivés : la population DRH
  // affichée doit suivre la règle locale unique `employeeIsFormer`.
  const dashEmployees=activeAg.length;
  const dashActifs=sgdiDisplayActiveEmployees(srvEmp,actifs);
  const dashConge=srvEmp?.leave_current??enConge;
  const dashMaladie=srvEmp?.sick_leave_current??enMaladie;
  const dashAbsents=srvEmp?.absent??absents;
  const dashSusp=srvEmp?.suspended??susp;
  const dashSites=srvOps?.sites_active??srvOps?.sites_total??sites;
  const dashIncidents=srvOps?.events_open??incidentsOuverts;
  const dashBase=Math.max(1,dashEmployees);
  const progressRow=(label,value,total,color)=>`<div class="dashboard-compact-progress">
      <div class="flex justify-between text-sm mb-1"><span class="font-semibold">${escapeHTML(label)}</span><span class="text-slate-500">${value} / ${total} · ${total?Math.round(value/total*100):0}%</span></div>
      <div class="dashboard-compact-bar"><span style="width:${total?Math.round(value/total*100):0}%;background:${color}"></span></div>
    </div>`;
  const bySoc=drhSocieteRows().map(r=>[r.label,activeAg.filter(a=>drhMatchSoc(a,r.key)).length]).filter(x=>x[1]>0);
  const byFonction={};activeAg.forEach(a=>{const aff=agentLiveAffectation(a);const k=a.fonction||a.poste||aff?.poste||a.affectationCourante?.poste||"Non précisé";byFonction[k]=(byFonction[k]||0)+1});
  const topFonctions=Object.entries(byFonction).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const months=[];
  for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);months.push(d.toISOString().slice(0,7))}
  const monthLabel=m=>{const [y,mo]=m.split("-");return `${mo}/${String(y).slice(2)}`};
  const recrutements=months.map(m=>ag.filter(a=>String(a.dateRecrutement||"").slice(0,7)===m).length);
  const departs=months.map(m=>ag.filter(a=>String(a.dateSortie||a.departAt||a.updatedAt||"").slice(0,7)===m&&["sortant","demissionne","licencie"].includes(a.statut)).length);
  const monthOf=v=>String(v||"").slice(0,7);
  const seriesEffectif=months.map(m=>ag.filter(a=>(!a.dateRecrutement||monthOf(a.dateRecrutement)<=m)&&(!a.dateSortie||monthOf(a.dateSortie)>m)).length);
  const seriesConges=months.map(m=>co.filter(c=>c.type!=="Maladie"&&monthOf(c.du||c.createdAt)===m).length);
  const seriesMaladies=months.map(m=>co.filter(c=>c.type==="Maladie"&&monthOf(c.du||c.createdAt)===m).length);
  const seriesAbsences=months.map(m=>ag.filter(a=>a.statut==="absent"&&monthOf(a.updatedAt||a.createdAt)===m).length);
  const seriesSuspensions=months.map(m=>ag.filter(a=>a.statut==="suspendu"&&monthOf(a.updatedAt||a.createdAt)===m).length);
  const seriesDemissions=months.map(m=>ag.filter(a=>a.statut==="demissionne"&&monthOf(a.dateSortie||a.departAt||a.updatedAt)===m).length);
  const seriesDemandes=months.map(m=>demandesList.filter(d=>monthOf(d.createdAt||d.date||d.submittedAt)===m).length);
  const seriesIncidents=months.map(m=>inc.filter(i=>monthOf(i.date||i.createdAt)===m).length);
  const seriesContrats=months.map(m=>activeAg.filter(a=>monthOf(employeePositionContractEndDate(a))===m).length);
  const seriesSites=months.map(m=>si.filter(s=>monthOf(s.createdAt||s.dateCreation||s.updatedAt)===m).length);
  const seriesMasse=months.map(m=>ag.filter(a=>(!a.dateRecrutement||monthOf(a.dateRecrutement)<=m)&&(!a.dateSortie||monthOf(a.dateSortie)>m)&&a.statut==="actif").reduce((s,a)=>s+(Number(a.salaire||a.salaireNet||0)||0),0));
  const chart=(seriesA,seriesB)=>{
    const peak=Math.max(1,...seriesA,...seriesB);
    const step=Math.max(1,Math.ceil(peak/4));
    const max=step*4;
    const x=i=>40+i*96;
    const y=v=>112-v/max*88;
    const pts=arr=>arr.map((v,i)=>`${x(i)},${y(v)}`).join(" ");
    return `<div class="drh-movement-chart">
      <div class="drh-movement-legend"><span><i style="background:#047857"></i>Recrutements</span><span><i style="background:#dc2626"></i>Départs</span><small>Nombre de personnes par mois</small></div>
      <svg class="dashboard-compact-chart" viewBox="0 0 560 142" role="img" aria-label="Recrutements en vert et départs en rouge sur six mois. Valeurs détaillées dans le tableau ci-dessous.">
        ${Array.from({length:5},(_,i)=>i*step).map(v=>`<line x1="40" x2="520" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8f0"/><text x="30" y="${y(v)+4}" text-anchor="end" font-size="11" fill="#64748b">${v}</text>`).join("")}
        <polyline points="${pts(seriesA)}" fill="none" stroke="#047857" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="${pts(seriesB)}" fill="none" stroke="#dc2626" stroke-width="3" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round"/>
        ${months.map((m,i)=>`<text x="${x(i)}" y="134" text-anchor="middle" font-size="11" fill="#64748b">${monthLabel(m)}</text>`).join("")}
      </svg>
      <div class="drh-movement-values"><table aria-label="Recrutements et départs mensuels"><thead><tr><th scope="col">Mouvement</th>${months.map(m=>`<th scope="col">${monthLabel(m)}</th>`).join("")}</tr></thead><tbody><tr><th scope="row">Recrutements</th>${seriesA.map(v=>`<td>${v}</td>`).join("")}</tr><tr><th scope="row">Départs</th>${seriesB.map(v=>`<td>${v}</td>`).join("")}</tr></tbody></table></div>
    </div>`;
  };
  const miniCurve=(title,value,series,color,route)=>{const max=Math.max(1,...series);const pts=series.map((v,i)=>`${i*34},${56-(v/max*46)}`).join(" ");return `<a href="${route}" class="card p-4 block kpi-clickable" style="text-decoration:none;color:inherit">
      <div class="flex items-start justify-between gap-2"><div><div class="text-xs text-slate-500 uppercase font-bold">${title}</div><div class="text-2xl font-black mt-1" style="color:${color}">${value}</div></div><div class="text-xs text-slate-400">${months.length} mois</div></div>
      <svg viewBox="0 0 170 66" style="width:100%;height:76px;display:block;margin-top:8px">
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        ${series.map((v,i)=>`<circle cx="${i*34}" cy="${56-(v/max*46)}" r="3" fill="${color}"/>`).join("")}
      </svg>
      <div class="flex justify-between text-[10px] text-slate-400"><span>${monthLabel(months[0])}</span><span>${monthLabel(months[months.length-1])}</span></div>
    </a>`};
  const showPayrollCounters=typeof isAdminSystemSession==="function"&&isAdminSystemSession();
  const drhKpi=(label,value,sub,route,color,icon)=>`<a href="${route}" class="drh-erp-kpi" style="--kpi-color:${color};text-decoration:none"><span class="drh-erp-kpi-icon">${icon}</span><span class="drh-erp-kpi-copy"><span class="drh-erp-kpi-label">${escapeHTML(label)}</span><strong>${value}</strong><small>${escapeHTML(sub)}</small></span></a>`;
  const staffing=drhStaffingTotals();
  const dashboardHealth=Math.max(0,Math.min(100,Math.round((dashActifs/Math.max(dashEmployees,1))*100)));
  const siteBuckets=drhSiteBucketsFromAgents(activeAg,si).slice(0,4);
  const maxSite=Math.max(1,...siteBuckets.map(x=>x.total));
  const dashboardCurve=(title,value,series,color,route)=>{const max=Math.max(1,...series);const points=series.map((v,i)=>`${i*36},${58-(v/max*45)}`).join(" ");return`<a href="${route}" class="drh-pilot-curve" style="--curve:${color}"><div><span>${escapeHTML(title)}</span><strong>${value}</strong></div><svg viewBox="0 0 180 64" aria-label="Évolution ${escapeHTML(title)}"><path d="M0 57H180M0 32H180" class="drh-pilot-gridline"/><polyline points="${points}"/><circle cx="180" cy="${58-(series[series.length-1]/max*45)}" r="3"/></svg><small><i>${monthLabel(months[0])}</i><i>${monthLabel(months[months.length-1])}</i></small></a>`};
  const workQueue=[
    contratsFin30.length?{n:1,title:"Renouveler les contrats critiques",sub:`${contratsFin30.length} dossier(s) sous 30 jours`,tag:"URGENT",route:"#/contrats/situation"}:null,
    demandesPersonnel?{n:2,title:"Traiter les demandes du personnel",sub:`${demandesPersonnel} demande(s) non clôturée(s)`,tag:"AUJOURD'HUI",route:"#/demandes_personnel/dashboard"}:null,
    congesAttente?{n:3,title:"Valider les demandes de congé",sub:`${congesAttente} demande(s) en attente`,tag:"À TRAITER",route:"#/drh/conges"}:null,
    socialAlertes?{n:4,title:"Compléter les dossiers sociaux",sub:`${socialAlertes} dossier(s) CNAS / Chifa`,tag:"À VÉRIFIER",route:"#/effectif/recap"}:null
  ].filter(Boolean);
  view.innerHTML=`<div class="drh-pilot-dashboard drh-pilot-compact">
    <header class="drh-pilot-head"><div><span>CENTRE DE PILOTAGE</span><h1>Tableau de bord RH</h1><p>${escapeHTML(selSoc?drhSocieteLabel(selSoc):"Toutes sociétés autorisées")} · Données opérationnelles en temps réel</p></div><div class="drh-pilot-head-actions"><a href="#/drh/stats">Rapport détaillé</a><button onclick="sgdiRefreshDrhStats(drhActiveSocieteFilter(),{force:true}).then(()=>sgdiAutoSync('Synchronisation forcée'))">↻ Synchroniser</button><button class="primary" onclick="navigate('effectif/recap')">+ Action RH</button></div></header>
    ${drhTabs("dashboard")}
    <section class="drh-pilot-staffing" aria-label="Comparaison des effectifs"><article data-staffing="contract"><span>EFF CONTRAT</span><strong>${staffing?.contract??"—"}</strong><small>Contrats Commercial en vigueur</small></article><article data-staffing="actual"><span>EFF RÉEL</span><strong>${staffing?.actual??"—"}</strong><small>Salariés DRH affectés par OPS</small></article><article data-staffing="gap" class="${!staffing?"":staffing.gap<0?"shortage":staffing.gap>0?"surplus":"balanced"}"><span>ÉCART</span><strong>${staffing?(staffing.gap>0?"+":"")+staffing.gap:"—"}</strong><small>Réel − contrat · ${!staffing?"Données serveur en attente":staffing.gap<0?"Déficit":staffing.gap>0?"Excédent":"Équilibre"}</small></article></section>
    <section class="drh-pilot-kpis"><article class="health"><div><span>Santé des effectifs</span><strong>${dashboardHealth}%</strong><small>${dashActifs} opérationnel(s) sur ${dashEmployees}</small></div><div class="ring" style="--health:${dashboardHealth}"><b>${dashboardHealth}</b></div></article><a href="#/effectif/actifs"><span>Effectif actif</span><strong>${dashActifs}</strong><small>Population opérationnelle</small></a><a href="#/pointage/feuille"><span>Absences aujourd'hui</span><strong>${dashAbsents+dashConge+dashMaladie}</strong><small>${dashConge} congé · ${dashMaladie} maladie · ${dashAbsents} absent</small></a><a href="#/contrats/situation"><span>Alertes contrat</span><strong>${contratsAlerte.length}</strong><small>${contratsFin30.length} échéance(s) sous 30 jours</small></a><a href="#/demandes_personnel/dashboard"><span>Demandes à traiter</span><strong>${demandesPersonnel+congesAttente}</strong><small>Priorité de traitement DRH</small></a></section>
    <section class="drh-pilot-main"><article class="drh-pilot-panel"><header><div><h2>Évolution des effectifs</h2><p>Recrutements et départs sur les six derniers mois</p></div><a href="#/drh/stats">Voir le rapport →</a></header><div class="drh-pilot-main-chart">${chart(recrutements,departs)}</div></article><article class="drh-pilot-panel"><header><div><h2>Alertes prioritaires</h2><p>Situations nécessitant une décision</p></div><a href="#/agenda/dashboard">Tout afficher →</a></header><div class="drh-pilot-alerts"><a href="#/contrats/situation" class="danger"><i></i><span><b>${contratsAlerte.length} contrat(s) à contrôler</b><small>${contratsExpires.length} expiré(s), ${contratsFin30.length} sous 30 jours</small></span><em>Ouvrir</em></a><a href="#/effectif/suspension" class="warning"><i></i><span><b>${dashSusp} employé(s) suspendu(s)</b><small>Suivi administratif requis</small></span><em>Ouvrir</em></a><a href="#/demandes_personnel/dashboard"><i></i><span><b>${demandesPersonnel+congesAttente} demande(s) en attente</b><small>Personnel et congés</small></span><em>Ouvrir</em></a><a href="#/incidents/site" class="success"><i></i><span><b>${dashIncidents} incident(s) ouvert(s)</b><small>${dashIncidents?"Traitement opérationnel requis":"Situation maîtrisée"}</small></span><em>Détail</em></a></div></article></section>
    <section class="drh-pilot-main equal"><article class="drh-pilot-panel"><header><div><h2>Répartition opérationnelle par site</h2><p>Effectifs actifs actuellement affectés</p></div><a href="#/sites/actifs">Voir les sites →</a></header><div class="drh-pilot-sites">${siteBuckets.length?siteBuckets.map(x=>`<a href="#/sites/actifs"><span>${escapeHTML(x.label)}</span><i><em style="width:${Math.round(x.total/maxSite*100)}%"></em></i><b>${x.total}</b></a>`).join(""):`<div class="p-5 text-slate-500">Aucune affectation active.</div>`}</div></article><article class="drh-pilot-panel"><header><div><h2>File de travail DRH</h2><p>Actions classées automatiquement par priorité</p></div><a href="#/agenda/dashboard">Agenda RH →</a></header><div class="drh-pilot-work">${workQueue.length?workQueue.map(x=>`<a href="${x.route}"><i>${x.n}</i><span><b>${escapeHTML(x.title)}</b><small>${escapeHTML(x.sub)}</small></span><em>${escapeHTML(x.tag)}</em></a>`).join(""):`<div class="p-5 text-emerald-700">Aucune action prioritaire.</div>`}</div></article></section>
    <section class="drh-pilot-stats"><header><div><h2>Statistiques RH consolidées</h2><p>Évolution mensuelle de l'ensemble des indicateurs · source PostgreSQL</p></div><a href="#/drh/stats">Statistiques détaillées →</a></header><div class="drh-pilot-curves">${dashboardCurve("Effectif actif",dashEmployees,seriesEffectif,"#047857","#/effectif/actifs")}${dashboardCurve("Recrutements",recrutements.at(-1)||0,recrutements,"#0d6ecc","#/recrutement")}${dashboardCurve("Départs",departs.at(-1)||0,departs,"#dc2626","#/effectif/sortants")}${dashboardCurve("Congés",dashConge,seriesConges,"#d97706","#/drh/conges")}${dashboardCurve("Maladies",dashMaladie,seriesMaladies,"#c2410c","#/drh/conges")}${dashboardCurve("Absences",dashAbsents,seriesAbsences,"#dc2626","#/pointage/feuille")}${dashboardCurve("Suspensions",dashSusp,seriesSuspensions,"#7c3aed","#/effectif/suspension")}${dashboardCurve("Demandes",demandesPersonnel,seriesDemandes,"#0891b2","#/demandes_personnel/dashboard")}${dashboardCurve("Incidents",dashIncidents,seriesIncidents,"#b91c1c","#/incidents/site")}${dashboardCurve("Contrats à échéance",contratsAlerte.length,seriesContrats,"#ea580c","#/contrats/situation")}${dashboardCurve("Sites",dashSites,seriesSites,"#0f766e","#/sites/actifs")}${showPayrollCounters?dashboardCurve("Masse salariale",money(masseSalaires),seriesMasse,"#4338ca","#/paie/dashboard"):""}</div></section>
    <footer class="drh-pilot-footer"><span>● Synchronisé avec le serveur</span><span>Backend PostgreSQL · ${new Date().toLocaleTimeString("fr-FR")}</span></footer>
  </div>`;
  return;
  view.innerHTML=`<div class="drh-erp-head">
      <div><h1>Synthèse générale</h1></div>
      <div class="drh-erp-head-pills"><span class="drh-head-control drh-head-metric drh-head-active"><i>✓</i><b>${dashActifs}</b> actifs</span><span class="drh-head-control drh-head-metric drh-head-incidents"><i>!</i><b>${dashIncidents}</b> incidents ouverts</span>${sgdiSyncStatusHTML()}<button class="drh-head-control drh-head-sync-button" onclick="sgdiRefreshDrhStats(drhActiveSocieteFilter(),{force:true}).then(()=>sgdiAutoSync('Synchronisation forcée'))"><i>↻</i> Synchroniser</button></div>
    </div>
    ${drhTabs("dashboard")}
    <div class="dashboard-compact-band-grid mb-4">
      <div class="card dashboard-compact-band dashboard-ratio-band"><h3>Ratios RH</h3>
        ${progressRow("Actifs RH",dashActifs,dashEmployees,"#047857")}
        ${progressRow("Congés",dashConge,dashBase,"#f59e0b")}
        ${progressRow("Maladies",dashMaladie,dashBase,"#c2410c")}
        ${progressRow("Absences",dashAbsents,dashBase,"#dc2626")}
        ${progressRow("Suspensions",dashSusp,dashBase,"#7c3aed")}
      </div>
      <div class="card dashboard-compact-band dashboard-chart-band"><h3>Courbe recrutement / départ</h3>${chart(recrutements,departs)}
        <div class="dashboard-compact-legend"><span><b style="color:#047857">●</b> Recrutements</span><span><b style="color:#dc2626">●</b> Départs</span></div>
      </div>
      ${showPayrollCounters?`<div class="card p-5"><h3 class="font-bold mb-3">Masse salariale</h3>
        <div class="text-3xl font-black text-slate-900">${money(masseSalaires)}</div>
        <div class="text-xs text-slate-500 mt-1">Moyenne active : ${money(salaireMoyen)} · ${salaires.length} salaire(s) renseigné(s)</div>
        <div class="grid grid-2 mt-4 text-sm"><div class="p-3 rounded bg-slate-50"><b>${dashSites}</b><br><span class="text-slate-500">Sites couverts</span></div><div class="p-3 rounded bg-slate-50"><b>${dashIncidents}</b><br><span class="text-slate-500">Incidents ouverts</span></div></div>
      </div>`:""}
    </div>
    <div class="card p-5 mb-6" style="border-left:5px solid ${contratsAlerte.length?"#dc2626":"#047857"};background:${contratsAlerte.length?"#fef2f2":"#f0fdf4"}">
      <div class="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 class="font-bold text-lg" style="color:${contratsAlerte.length?"#991b1b":"#166534"}">Alerte fin de contrat</h3>
          <div class="text-xs" style="color:${contratsAlerte.length?"#7f1d1d":"#166534"}">${contratsExpires.length} contrat(s) expiré(s) · ${contratsFin30.length} fin(s) dans 30 jours</div>
        </div>
      </div>
      ${(()=>{
        if(!contratsAlerte.length)return`<div class="text-sm text-emerald-700 font-semibold">Aucune fin de contrat critique.</div>`;
        window._contratsAlerteLists={expires:contratsExpires,fin30:contratsFin30};
        const contractCard=a=>{const d=employeePositionContractDaysLeft(a);return`<a href="#/effectif/agent/${a.id}" class="p-3 rounded-lg text-sm block" style="background:#fff;border:1px solid #fecaca;text-decoration:none;color:#0f172a"><div class="flex justify-between gap-2"><b>${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</b><span class="pill pill-red">${d<0?"Expiré":"J-"+d}</span></div><div class="text-xs text-slate-500 mt-1">${escapeHTML(a.matricule||"—")} · ${escapeHTML(a.societe||"—")} · Fin : ${employeePositionContractEndPillHTML(a)}</div></a>`};
        const block=(label,list,kind,color)=>!list.length?"":`<div class="text-xs font-black uppercase mt-3 mb-2" style="color:${color}">${label} (${list.length})</div><div class="grid grid-cols-1 md:grid-cols-2 gap-2">${list.slice(0,4).map(contractCard).join("")}</div>${list.length>4?`<button type="button" onclick="openContratsAlerteModal('${kind}')" class="text-xs mt-2 font-semibold block hover:underline" style="color:${color};background:none;border:0;padding:0;cursor:pointer;text-align:left">+ ${list.length-4} autre(s) contrat(s) ${label==="Contrats expirés"?"expiré(s)":"dans 30 jours"} →</button>`:""}`;
        return block("Contrats expirés",contratsExpires,"expires","#991b1b")+block("Fin de contrat dans 30 jours",contratsFin30,"fin30","#92400e");
      })()}
    </div>
    <section class="drh-dashboard-stat-section card p-5 mb-6">
      <div class="drh-dashboard-stat-head">
        <div>
          <h2>Statistiques RH</h2>
          <p>Vue synthétique des indicateurs RH principaux · source backend PostgreSQL.</p>
        </div>
        <a href="#/drh/stats" class="drh-dashboard-stat-link">Voir statistiques détaillées →</a>
      </div>
      <div class="drh-dashboard-stat-grid">
        ${miniCurve("Effectif",dashEmployees,seriesEffectif,"#043970","#/effectif/actifs")}
        ${miniCurve("Congés",dashConge,seriesConges,"#d97706","#/conges")}
        ${miniCurve("Maladies",dashMaladie,seriesMaladies,"#c2410c","#/conges")}
        ${miniCurve("Absences",dashAbsents,seriesAbsences,"#dc2626","#/pointage/feuille")}
        ${miniCurve("Suspensions",dashSusp,seriesSuspensions,"#7c3aed","#/effectif/actifs")}
        ${miniCurve("Démissions",seriesDemissions[seriesDemissions.length-1],seriesDemissions,"#be123c","#/effectif/sortants")}
        ${miniCurve("Demandes",demandesPersonnel,seriesDemandes,"#0891b2","#/demandes_personnel/dashboard")}
        ${miniCurve("Incidents",dashIncidents,seriesIncidents,"#b91c1c","#/incidents/site")}
        ${miniCurve("Contrats",contratsAlerte.length,seriesContrats,"#ea580c","#/contrats/situation")}
        ${miniCurve("Sites",dashSites,seriesSites,"#0f766e","#/sites/actifs")}
      </div>
    </section>`;
}

function renderDRHStats(view){
  const ag=drhAgentsList();
  const activeAg=ag.filter(a=>!employeeIsFormer(a));
  const activeIds=new Set(activeAg.map(a=>String(a.id)));
  const co=(db.conges||[]).filter(c=>activeIds.has(String(c.agentId)));
  const demandes=drhDemandesPersonnelList();
  const incidents=db.incidents||[];
  const sites=db.sites||[];
  const months=drhMonthlyKeys(12);
  const monthOf=v=>String(v||"").slice(0,7);
  const parSoc=drhSocieteRows().map(r=>[r.label,activeAg.filter(a=>drhMatchSoc(a,r.key)).length]).filter(([,n])=>n>0);
  const parFonc={};activeAg.forEach(a=>{const k=a.fonction||a.poste||"Non précisé";parFonc[k]=(parFonc[k]||0)+1});
  const parCat={};activeAg.forEach(a=>{const k=a.categorie||"Non précisé";parCat[k]=(parCat[k]||0)+1});
  const parTheme={};activeAg.forEach(a=>{const k=a.theme||"Non précisé";parTheme[k]=(parTheme[k]||0)+1});
  const statusRows=[
    ["Actifs",activeAg.filter(a=>a.statut==="actif").length],
    ["Congés",activeAg.filter(a=>co.some(c=>String(c.agentId)===String(a.id)&&c.statut==="approuve"&&c.type!=="Maladie"&&inRange(c))).length],
    ["Maladies",activeAg.filter(a=>co.some(c=>String(c.agentId)===String(a.id)&&c.statut==="approuve"&&c.type==="Maladie"&&inRange(c))).length],
    ["Absents",activeAg.filter(a=>a.statut==="absent").length],
    ["Suspendus",activeAg.filter(a=>a.statut==="suspendu").length],
    ["Sortants",ag.filter(a=>["sortant","demissionne","licencie"].includes(a.statut)).length]
  ];
  const seriesEffectif=months.map(m=>ag.filter(a=>(!a.dateRecrutement||monthOf(a.dateRecrutement)<=m)&&(!a.dateSortie||monthOf(a.dateSortie)>m)).length);
  const seriesRecrutements=months.map(m=>ag.filter(a=>monthOf(a.dateRecrutement)===m).length);
  const seriesDeparts=months.map(m=>ag.filter(a=>monthOf(a.dateSortie||a.departAt||a.updatedAt)===m&&["sortant","demissionne","licencie"].includes(a.statut)).length);
  const seriesConges=months.map(m=>co.filter(c=>c.type!=="Maladie"&&monthOf(c.du||c.createdAt)===m).length);
  const seriesMaladie=months.map(m=>co.filter(c=>c.type==="Maladie"&&monthOf(c.du||c.createdAt)===m).length);
  const seriesAbsences=months.map(m=>ag.filter(a=>a.statut==="absent"&&monthOf(a.updatedAt||a.createdAt)===m).length);
  const seriesDemandes=months.map(m=>demandes.filter(d=>monthOf(d.createdAt||d.date||d.submittedAt)===m).length);
  const seriesIncidents=months.map(m=>incidents.filter(i=>monthOf(i.date||i.createdAt)===m).length);
  const seriesContrats=months.map(m=>activeAg.filter(a=>monthOf(employeePositionContractEndDate(a))===m).length);
  const seriesMasse=months.map(m=>ag.filter(a=>(!a.dateRecrutement||monthOf(a.dateRecrutement)<=m)&&(!a.dateSortie||monthOf(a.dateSortie)>m)&&a.statut==="actif").reduce((s,a)=>s+(Number(a.salaire||a.salaireNet)||0),0));
  const topFonc=Object.entries(parFonc).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const operationalAg=drhOperationalAgents(ag);
  const topSites=drhSiteBucketsFromAgents(ag,sites).map(r=>[r.label,r.actif]).slice(0,8);
  const clientLabel=a=>{
    const aff=agentLiveAffectation(a);
    const site=drhResolvedAgentSite(a,sites);
    return String(a?.client||site?.client||site?.client_name||aff?.clientName||a?.affectationCourante?.clientName||"Sans client").trim()||"Sans client";
  };
  const parClient={};operationalAg.forEach(a=>{const k=clientLabel(a);parClient[k]=(parClient[k]||0)+1});
  const topClients=Object.entries(parClient).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const clientActifs=topClients.map(([label])=>[label,operationalAg.filter(a=>clientLabel(a)===label).length]);
  const recruitYears={};ag.forEach(a=>{const y=String(a.dateRecrutement||a.dateEntree||"").slice(0,4)||"Non daté";recruitYears[y]=(recruitYears[y]||0)+1});
  const recruitYearRows=Object.entries(recruitYears).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))).filter(([k])=>k!=="Non daté").concat(Object.entries(recruitYears).filter(([k])=>k==="Non daté"));
  const seniorityRows=[
    ["< 6 mois",ag.filter(a=>{const y=String(a.dateRecrutement||a.dateEntree||"").slice(0,10);return y&&daysBetween(y,today())<183}).length],
    ["6-12 mois",ag.filter(a=>{const y=String(a.dateRecrutement||a.dateEntree||"").slice(0,10);const d=y?daysBetween(y,today()):99999;return d>=183&&d<365}).length],
    ["1-2 ans",ag.filter(a=>{const y=String(a.dateRecrutement||a.dateEntree||"").slice(0,10);const d=y?daysBetween(y,today()):99999;return d>=365&&d<730}).length],
    ["2-5 ans",ag.filter(a=>{const y=String(a.dateRecrutement||a.dateEntree||"").slice(0,10);const d=y?daysBetween(y,today()):99999;return d>=730&&d<1825}).length],
    ["5 ans+",ag.filter(a=>{const y=String(a.dateRecrutement||a.dateEntree||"").slice(0,10);return y&&daysBetween(y,today())>=1825}).length],
    ["Non daté",ag.filter(a=>!(a.dateRecrutement||a.dateEntree)).length]
  ];
  const recruitByClientSeries=topClients.slice(0,5).map(([label])=>({name:label.slice(0,22),values:months.map(m=>ag.filter(a=>clientLabel(a)===label&&monthOf(a.dateRecrutement||a.dateEntree)===m).length)}));
  const heatRows=parSoc.slice(0,6).map(([label])=>label);
  const heatCols=["Actifs","Congés","Absents","Susp."];
  const heatValue=(soc,col)=>{
    const list=ag.filter(a=>drhMatchSoc(a,soc)||a.societe===soc);
    if(col==="Actifs")return list.filter(a=>a.statut==="actif").length;
    if(col==="Congés")return list.filter(a=>co.some(c=>c.agentId===a.id&&c.statut==="approuve"&&c.type!=="Maladie"&&inRange(c))).length;
    if(col==="Absents")return list.filter(a=>a.statut==="absent").length;
    if(col==="Susp.")return list.filter(a=>a.statut==="suspendu").length;
    return 0;
  };
  const kpi=(label,value,sub,color)=>`<div class="card p-4"><div class="text-xs text-slate-500 uppercase">${escapeHTML(label)}</div><div class="text-3xl font-black mt-1" style="color:${color}">${value}</div><div class="text-xs text-slate-500 mt-1">${escapeHTML(sub||"")}</div></div>`;
  view.innerHTML=`<div class="mb-5"><h1 class="text-2xl font-black sentence-case-title">Statistiques RH</h1><p class="text-sm text-slate-500">Tableau analytique multi-graphes · ${drhActiveSocieteFilter()?escapeHTML(drhActiveSocieteFilter()):"Toutes sociétés autorisées"}</p></div>
    ${drhTabs("stats")}
    <div class="grid grid-cols-2 gap-3 mb-4">
      ${kpi("Effectif total",ag.length,"Employés visibles","#043970")}
      ${kpi("Fonctions",Object.keys(parFonc).length,"Postes distincts","#047857")}
    </div>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
      ${drhChartCard("Courbe effectif","Évolution mensuelle",drhSvgLine(seriesEffectif,months,"#043970",true))}
      ${drhChartCard("Histogramme recrutement / départ","Comparaison par mois",drhSvgGroupedBars(months,[{name:"Recrutements",values:seriesRecrutements},{name:"Départs",values:seriesDeparts}]))}
      ${drhChartCard("Diagramme donut statuts","Répartition de la situation actuelle",drhSvgDonut(statusRows))}
      ${drhChartCard("Barres empilées statuts","Poids relatif des situations",drhSvgStacked(statusRows))}
      ${drhChartCard("Aire masse salariale","Évolution estimée sur 12 mois",drhSvgLine(seriesMasse,months,"#0f766e",true))}
      ${drhChartCard("Courbe demandes / incidents","Flux RH et événements",drhSvgGroupedBars(months,[{name:"Demandes",values:seriesDemandes},{name:"Incidents",values:seriesIncidents}]))}
      ${drhChartCard("Radar fonctions principales","Top 6 fonctions par effectif",drhSvgRadar(topFonc))}
      ${drhChartCard("Heatmap société / statut","Lecture rapide des volumes",heatRows.length?drhHeatmap(heatRows,heatCols,heatValue):`<div class="text-sm text-slate-400">Aucune société à afficher.</div>`)}
      ${drhChartCard("Barres horizontales par société","Effectif par société",drhBars(parSoc,"#043970"))}
      ${drhChartCard("Barres horizontales par fonction","Top fonctions",drhBars(topFonc,"#047857"))}
      ${drhChartCard("Répartition par catégorie","Catégories RH",drhSvgDonut(Object.entries(parCat)))}
      ${drhChartCard("Répartition par thème","Thèmes RH",drhSvgDonut(Object.entries(parTheme)))}
      ${drhChartCard("Échéances contrats","Fins de contrat par mois",drhSvgLine(seriesContrats,months,"#dc2626",true))}
      ${drhChartCard("Affectation sites","Top sites par effectif",topSites.length?drhBars(topSites,"#0891b2"):`<div class="text-sm text-slate-400">Aucune affectation enregistrée.</div>`)}
      ${drhChartCard("Statistiques par client","Effectif rattaché par client",topClients.length?drhBars(topClients,"#7c3aed"):`<div class="text-sm text-slate-400">Aucun client renseigné.</div>`)}
      ${drhChartCard("Clients actifs","Employés actifs par client",clientActifs.length?drhSvgDonut(clientActifs):`<div class="text-sm text-slate-400">Aucun client renseigné.</div>`)}
      ${drhChartCard("Recrutements par client","Top clients sur 12 mois",recruitByClientSeries.length?drhSvgGroupedBars(months,recruitByClientSeries):`<div class="text-sm text-slate-400">Aucun recrutement client daté.</div>`)}
      ${drhChartCard("Recrutements par année","Volume selon date de recrutement",recruitYearRows.length?drhBars(recruitYearRows,"#0f766e"):`<div class="text-sm text-slate-400">Aucune date de recrutement.</div>`)}
      ${drhChartCard("Ancienneté effectif","Tranches calculées depuis la date de recrutement",drhSvgDonut(seniorityRows))}
      ${drhChartCard("Courbe recrutements mensuels","Entrées sur 12 mois",drhSvgLine(seriesRecrutements,months,"#047857",true))}
    </div>`;
}

function renderDRHStatsSociete(view){
  const ag=drhAgentsList();const co=db.conges||[];
  const rows=drhSocieteRows().map(row=>{
    const societyAll=ag.filter(a=>drhMatchSoc(a,row.key));
    const list=societyAll.filter(a=>!employeeIsFormer(a));
    const actif=list.filter(a=>a.statut==="actif").length;
    const operationnel=list.filter(agentIsOperational).length;
    const enCo=list.filter(a=>co.some(c=>c.agentId===a.id&&c.statut==="approuve"&&c.type!=="Maladie"&&inRange(c))).length;
    const enMa=list.filter(a=>co.some(c=>c.agentId===a.id&&c.statut==="approuve"&&c.type==="Maladie"&&inRange(c))).length;
    const abs=list.filter(a=>a.statut==="absent").length;
    const sus=list.filter(a=>a.statut==="suspendu").length;
    const sor=societyAll.filter(employeeIsFormer).length;
    const masse=list.filter(a=>a.statut==="actif").reduce((sum,a)=>sum+(Number(a.salaire)||0),0);
    return{s:row.label,total:list.length,actif,operationnel,enCo,enMa,abs,sus,sor,masse};
  });
  view.innerHTML=`<h1 class="text-2xl font-black uppercase mb-2">DRH - STATISTIQUES PAR SOCIÉTÉ</h1>
    ${drhTabs("stats_societe")}
    <div class="card p-0 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50"><tr><th class="text-left p-3">Société</th><th class="p-3">Total</th><th class="p-3">Opérationnel</th><th class="p-3">Congé</th><th class="p-3">Maladie</th><th class="p-3">Absent</th><th class="p-3">Suspendu</th><th class="p-3">Sortant</th><th class="p-3 text-right">Masse salariale</th></tr></thead>
        <tbody>${rows.map(r=>`<tr class="border-t"><td class="p-3 font-semibold">${escapeHTML(r.s)}</td><td class="p-3 text-center">${r.total}</td><td class="p-3 text-center text-emerald-700 font-bold">${r.operationnel}</td><td class="p-3 text-center">${r.enCo}</td><td class="p-3 text-center">${r.enMa}</td><td class="p-3 text-center">${r.abs}</td><td class="p-3 text-center">${r.sus}</td><td class="p-3 text-center">${r.sor}</td><td class="p-3 text-right font-semibold text-emerald-700">${money(r.masse)}</td></tr>`).join("")}
        <tr class="border-t bg-slate-50 font-bold"><td class="p-3">TOTAL</td><td class="p-3 text-center">${rows.reduce((s,r)=>s+r.total,0)}</td><td class="p-3 text-center text-emerald-700">${rows.reduce((s,r)=>s+r.operationnel,0)}</td><td class="p-3 text-center">${rows.reduce((s,r)=>s+r.enCo,0)}</td><td class="p-3 text-center">${rows.reduce((s,r)=>s+r.enMa,0)}</td><td class="p-3 text-center">${rows.reduce((s,r)=>s+r.abs,0)}</td><td class="p-3 text-center">${rows.reduce((s,r)=>s+r.sus,0)}</td><td class="p-3 text-center">${rows.reduce((s,r)=>s+r.sor,0)}</td><td class="p-3 text-right text-emerald-700">${money(rows.reduce((s,r)=>s+r.masse,0))}</td></tr></tbody>
      </table>
    </div>`;
}

function renderDRHStatsTheme(view){
  const ag=drhAgentsList().filter(a=>!employeeIsFormer(a));
  const themes={};ag.forEach(a=>{const k=a.theme||"Non précisé";if(!themes[k])themes[k]={total:0,masse:0,actif:0};themes[k].total++;if(agentIsOperational(a))themes[k].actif++;if(a.statut==="actif")themes[k].masse+=Number(a.salaire)||0});
  const entries=Object.entries(themes).sort((a,b)=>b[1].total-a[1].total);
  view.innerHTML=`<h1 class="text-2xl font-black uppercase mb-2">DRH - STATISTIQUES PAR THÈME</h1>
    ${drhTabs("stats_theme")}
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div class="card p-5"><h3 class="font-bold mb-3">Effectif par thème</h3>${drhBars(entries.map(([k,v])=>[k,v.total]),"#043970")}</div>
      <div class="card p-5"><h3 class="font-bold mb-3">Opérationnels par thème</h3>${drhBars(entries.map(([k,v])=>[k,v.actif]),"#043970")}</div>
    </div>
    <div class="card p-0 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50"><tr><th class="text-left p-3">Thème</th><th class="p-3">Total</th><th class="p-3">Opérationnels</th><th class="p-3 text-right">Masse salariale</th><th class="p-3 text-right">Salaire moyen</th></tr></thead>
        <tbody>${entries.map(([k,v])=>`<tr class="border-t"><td class="p-3 font-semibold">${escapeHTML(k)}</td><td class="p-3 text-center">${v.total}</td><td class="p-3 text-center text-emerald-700">${v.actif}</td><td class="p-3 text-right">${money(v.masse)}</td><td class="p-3 text-right text-slate-600">${money(v.actif?Math.round(v.masse/v.actif):0)}</td></tr>`).join("")||`<tr><td class="p-3 text-slate-400" colspan="5">Aucune donnée. Renseignez le champ "thème" sur les fiches agents.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderDRHStatsFonction(view){
  const ag=drhAgentsList().filter(a=>!employeeIsFormer(a));
  const fonctions={};ag.forEach(a=>{const k=a.fonction||a.poste||agentLiveAffectation(a)?.poste||"Non précisé";if(!fonctions[k])fonctions[k]={total:0,actif:0,masse:0,salaires:[]};fonctions[k].total++;if(agentIsOperational(a))fonctions[k].actif++;if(a.statut==="actif"){const s=Number(a.salaire)||0;fonctions[k].masse+=s;if(s>0)fonctions[k].salaires.push(s)}});
  const entries=Object.entries(fonctions).sort((a,b)=>b[1].total-a[1].total);
  view.innerHTML=`<h1 class="text-2xl font-black uppercase mb-2">DRH - STATISTIQUES PAR FONCTION</h1>
    ${drhTabs("stats_fonction")}
    <div class="card p-5 mb-4"><h3 class="font-bold mb-3">Répartition par fonction</h3>${drhBars(entries.map(([k,v])=>[k,v.total]),"#8b5cf6")}</div>
    <div class="card p-0 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50"><tr><th class="text-left p-3">Fonction</th><th class="p-3">Total</th><th class="p-3">Opérationnels</th><th class="p-3 text-right">Salaire min</th><th class="p-3 text-right">Salaire moyen</th><th class="p-3 text-right">Salaire max</th><th class="p-3 text-right">Masse salariale</th></tr></thead>
        <tbody>${entries.map(([k,v])=>{const min=v.salaires.length?Math.min(...v.salaires):0;const max=v.salaires.length?Math.max(...v.salaires):0;const moy=v.salaires.length?Math.round(v.salaires.reduce((s,n)=>s+n,0)/v.salaires.length):0;return`<tr class="border-t"><td class="p-3 font-semibold">${escapeHTML(k)}</td><td class="p-3 text-center">${v.total}</td><td class="p-3 text-center text-emerald-700">${v.actif}</td><td class="p-3 text-right">${money(min)}</td><td class="p-3 text-right font-semibold">${money(moy)}</td><td class="p-3 text-right">${money(max)}</td><td class="p-3 text-right text-emerald-700 font-semibold">${money(v.masse)}</td></tr>`}).join("")||`<tr><td class="p-3 text-slate-400" colspan="7">Aucune donnée.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderDRHStatsCategorie(view){
  const ag=drhAgentsList().filter(a=>!employeeIsFormer(a));
  const cats={};ag.forEach(a=>{const k=a.categorie||"Non précisé";if(!cats[k])cats[k]={total:0,actif:0,masse:0};cats[k].total++;if(agentIsOperational(a))cats[k].actif++;if(a.statut==="actif")cats[k].masse+=Number(a.salaire)||0});
  const entries=Object.entries(cats).sort((a,b)=>b[1].total-a[1].total);
  view.innerHTML=`<h1 class="text-2xl font-black uppercase mb-2">DRH - STATISTIQUES PAR CATÉGORIE</h1>
    ${drhTabs("stats_categorie")}
    <div class="grid grid-cols-2 gap-4 mb-4">
      <div class="card p-5"><h3 class="font-bold mb-3">Effectif par catégorie</h3>${drhBars(entries.map(([k,v])=>[k,v.total]),"#043970")}</div>
      <div class="card p-5"><h3 class="font-bold mb-3">Masse salariale par catégorie</h3>${drhBars(entries.map(([k,v])=>[k,v.masse]),"#043970")}</div>
    </div>
    <div class="card p-0 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50"><tr><th class="text-left p-3">Catégorie</th><th class="p-3">Total</th><th class="p-3">Opérationnels</th><th class="p-3 text-right">Masse salariale</th><th class="p-3 text-right">% effectif</th></tr></thead>
        <tbody>${entries.map(([k,v])=>{const pct=ag.length?Math.round(v.total/ag.length*100):0;return`<tr class="border-t"><td class="p-3 font-semibold">${escapeHTML(k)}</td><td class="p-3 text-center">${v.total}</td><td class="p-3 text-center text-emerald-700">${v.actif}</td><td class="p-3 text-right text-emerald-700 font-semibold">${money(v.masse)}</td><td class="p-3 text-right">${pct}%</td></tr>`}).join("")||`<tr><td class="p-3 text-slate-400" colspan="5">Aucune donnée.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderDRHStatsSalaire(view){
  const ag=drhAgentsList().filter(a=>!employeeIsFormer(a)&&a.statut==="actif"&&Number(a.salaire)>0);
  const tranches=[
    {label:"< 30 000 DA",min:0,max:30000,c:"#ef4444"},
    {label:"30 000 – 45 000 DA",min:30000,max:45000,c:"#043970"},
    {label:"45 000 – 60 000 DA",min:45000,max:60000,c:"#84cc16"},
    {label:"60 000 – 80 000 DA",min:60000,max:80000,c:"#043970"},
    {label:"80 000 – 120 000 DA",min:80000,max:120000,c:"#043970"},
    {label:"≥ 120 000 DA",min:120000,max:Infinity,c:"#8b5cf6"}
  ];
  const counts=tranches.map(t=>({...t,n:ag.filter(a=>{const s=Number(a.salaire)||0;return s>=t.min&&s<t.max}).length}));
  const salaires=ag.map(a=>Number(a.salaire)||0).sort((a,b)=>a-b);
  const total=salaires.reduce((s,n)=>s+n,0);
  const moy=salaires.length?Math.round(total/salaires.length):0;
  const med=salaires.length?(salaires.length%2?salaires[Math.floor(salaires.length/2)]:Math.round((salaires[salaires.length/2-1]+salaires[salaires.length/2])/2)):0;
  const min=salaires[0]||0;const max=salaires[salaires.length-1]||0;
  view.innerHTML=`<h1 class="text-2xl font-black uppercase mb-2">DRH - STATISTIQUES PAR SALAIRE</h1>
    ${drhTabs("stats_salaire")}
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
      <div class="card p-4"><div class="text-xs text-slate-500">Effectif rémunéré</div><div class="text-2xl font-bold">${ag.length}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Masse salariale</div><div class="text-xl font-bold text-emerald-700">${money(total)}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Salaire moyen</div><div class="text-xl font-bold">${money(moy)}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Salaire médian</div><div class="text-xl font-bold">${money(med)}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Min · Max</div><div class="text-sm font-bold">${money(min)} · ${money(max)}</div></div>
    </div>
    <div class="card p-5 mb-4"><h3 class="font-bold mb-3">Distribution par tranche de salaire</h3>
      ${counts.map(t=>{const pct=ag.length?Math.round(t.n/ag.length*100):0;return`<div class="text-sm mb-2"><div class="flex justify-between mb-1"><span class="font-medium">${t.label}</span><span class="text-slate-500">${t.n} (${pct}%)</span></div><div class="h-3 bg-slate-100 rounded-full"><div class="h-full rounded-full" style="width:${pct}%;background:${t.c}"></div></div></div>`}).join("")}
    </div>
    <div class="card p-5"><h3 class="font-bold mb-3">Top 10 salaires</h3>
      ${ag.slice().sort((a,b)=>(Number(b.salaire)||0)-(Number(a.salaire)||0)).slice(0,10).map((a,i)=>`<div class="flex items-center justify-between text-sm py-1 border-b last:border-0"><div><span class="font-mono text-slate-400 mr-2">#${i+1}</span><span class="font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</span> <span class="text-xs text-slate-500">· ${escapeHTML(a.fonction||a.poste||"")}</span></div><div class="font-bold text-emerald-700">${money(Number(a.salaire)||0)}</div></div>`).join("")||`<div class="text-sm text-slate-400">Aucune donnée.</div>`}
    </div>`;
}

function renderDRHStatsAffectation(view){
  const ag=drhAgentsList().filter(a=>!employeeIsFormer(a));const sites=db.sites||[];
  const rows=drhSiteBucketsFromAgents(ag,sites);
  const noAffect=ag.filter(agentNeedsAffectation);
  view.innerHTML=`<h1 class="text-2xl font-black uppercase mb-2">DRH - STATISTIQUES PAR AFFECTATION</h1>
    ${drhTabs("stats_affectation")}
    <div class="grid grid-cols-3 gap-3 mb-4">
      <div class="card p-4"><div class="text-xs text-slate-500">Sites avec affectation</div><div class="text-3xl font-bold">${rows.length}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Agents affectés</div><div class="text-3xl font-bold text-emerald-700">${rows.reduce((s,r)=>s+r.actif,0)}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Sans affectation</div><div class="text-3xl font-bold text-amber-700">${noAffect.length}</div></div>
    </div>
    <div class="card p-5 mb-4"><h3 class="font-bold mb-3">Effectif par site</h3>${drhBars(rows.map(r=>[r.label,r.actif]),"#043970")}</div>
    <div class="card p-0 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50"><tr><th class="text-left p-3">Site</th><th class="text-left p-3">Société</th><th class="p-3">Total</th><th class="p-3">Opérationnels</th><th class="p-3 text-right">Masse salariale</th></tr></thead>
        <tbody>${rows.map(r=>`<tr class="border-t"><td class="p-3 font-semibold">${escapeHTML(r.label)}</td><td class="p-3 text-slate-600">${escapeHTML(r.site?sitePrimarySociete(r.site):"")}</td><td class="p-3 text-center">${r.total}</td><td class="p-3 text-center text-emerald-700">${r.actif}</td><td class="p-3 text-right text-emerald-700 font-semibold">${money(r.masse)}</td></tr>`).join("")||`<tr><td class="p-3 text-slate-400" colspan="5">Aucune affectation enregistrée.</td></tr>`}</tbody>
      </table>
    </div>`;
}

SGDIModules.registerModule({key: "drh-dashboard", routes: [], dependencies: [], init: function(){}, destroy: function(){}});
