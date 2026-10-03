/* Congés — fonctions déplacées sans changement métier. */
function filterDrhCongesPersonnel(value){
  const q=String(value||"").trim().toLowerCase();
  document.querySelectorAll("#drh-conges-personnel tbody tr[data-searchable]").forEach(row=>{
    const matchesQ=!q||String(row.dataset.q||"").includes(q);
    const matchesSolde=!drhCongesSoldeEleveOnly||row.dataset.soldeEleve==="1";
    row.style.display=(matchesQ&&matchesSolde)?"":"none";
  });
}

function drhCongesDashboardTab(){return sessionStorage.getItem("drhCongesDashboardTab")||"dashboard"}

function setDrhCongesDashboardTab(tab){sessionStorage.setItem("drhCongesDashboardTab",tab);renderView()}

function drhCongesDocFiltre(){return sessionStorage.getItem("drhCongesDocFiltre")||"titles"}

function setDrhCongesDocFiltre(v){sessionStorage.setItem("drhCongesDocFiltre",v);renderView()}

function drhCongeAgentName(c){const a=(db.agents||[]).find(x=>String(x.id)===String(c.agentId));return a?((a.nom||"")+" "+(a.prenom||"")).trim():"Employé introuvable"}

function drhCongeMonthStats(conges,year){
  return Array.from({length:12},(_,month)=>conges.filter(c=>{
    const d=drhLeaveCalendarDate(c.du);return d&&d.getUTCFullYear()===year&&d.getUTCMonth()===month&&c.statut==="approuve";
  }).length);
}

function drhCongesDashboardCalendar(conges){
  const base=drhLeaveCalendarDate(today())||new Date();
  const year=base.getUTCFullYear(),month=base.getUTCMonth();
  const first=new Date(Date.UTC(year,month,1));
  const startOffset=(first.getUTCDay()+6)%7;
  const days=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  const cells=[];
  for(let i=0;i<startOffset;i++)cells.push(`<span class="drh-leave-cal-day is-empty"></span>`);
  for(let day=1;day<=days;day++){
    const iso=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const active=conges.filter(c=>c.statut==="approuve"&&c.du<=iso&&(!c.au||c.au>=iso)).length;
    cells.push(`<button type="button" class="drh-leave-cal-day${iso===today()?" is-today":""}${active?" has-leave":""}" title="${active?`${active} congé(s) planifié(s)`:"Aucun congé"}"><b>${day}</b>${active?`<small>${active}</small>`:""}</button>`);
  }
  const monthName=new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}).format(first);
  return `<div class="drh-leave-calendar"><div class="drh-leave-calendar-title"><strong>${monthName}</strong><span><i></i> Congé planifié</span></div><div class="drh-leave-week"><span>Lun</span><span>Mar</span><span>Mer</span><span>Jeu</span><span>Ven</span><span>Sam</span><span>Dim</span></div><div class="drh-leave-days">${cells.join("")}</div></div>`;
}

function congesModuleCanAttribuer(isDrh){return !!isDrh||(typeof isAdminSystemSession==="function"&&isAdminSystemSession())}

function congeAvatarInitials(name){
  const parts=String(name||"").trim().split(/\s+/).filter(Boolean);
  return (((parts[0]||"")[0]||"")+((parts[1]||"")[0]||"")).toUpperCase();
}

function congeOrigineBadgeHTML(c){
  const isAttrib=c.origine==="attribution";
  return `<span class="cg-origin-pill ${isAttrib?"drh":"self"}">${isAttrib?"Attribution DRH":"Auto-demande"}</span>`;
}

/* Cockpit: agrégats du snapshot déjà chargé, sans requêtes supplémentaires.
   Catégories de présentation: seuil existant, positif sous seuil, épuisé/négatif,
   inconnu. Aucun nouveau seuil légal ni calcul de droits. */
function drhLeaveCockpitData(agents, conges, balances, date, weekDate, typeYear){
  const ids=new Set(agents.map(a=>String(a.id)));
  const list=conges.filter(c=>ids.has(String(c.agentId))&&c.type!=="Maladie");
  const validDate=v=>drhLeaveCalendarDate(String(v||"").slice(0,10));
  const covering=iso=>list.filter(c=>c.statut==="approuve"&&validDate(c.du)&&validDate(c.au)&&c.du.slice(0,10)<=iso&&c.au.slice(0,10)>=iso);
  const distinct=rows=>new Set(rows.map(c=>String(c.agentId))).size;
  const pending=list.filter(c=>c.statut==="en_attente").sort((a,b)=>String(a.createdAt||a.du||"").localeCompare(String(b.createdAt||b.du||""))||String(a.id).localeCompare(String(b.id)));
  const current=covering(date);
  const start=validDate(weekDate)||validDate(date);
  start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
  const week=Array.from({length:7},(_,i)=>{const d=new Date(start.getTime()+i*86400000),iso=d.toISOString().slice(0,10),items=covering(iso);return {d,iso,items,count:distinct(items)}});
  const categories=[{label:`Solde élevé (≥ ${DRH_CONGE_SOLDE_ELEVE_SEUIL} j)`,color:"#ef4444",count:0},{label:`Solde positif (< ${DRH_CONGE_SOLDE_ELEVE_SEUIL} j)`,color:"#268fff",count:0},{label:"Solde épuisé ou négatif",color:"#f59e0b",count:0},{label:"Solde indisponible",color:"#94a3b8",count:0}];
  balances.forEach(x=>categories[x.solde===null?3:x.solde>=DRH_CONGE_SOLDE_ELEVE_SEUIL?0:x.solde>0?1:2].count++);
  const base=validDate(date), year=Number(typeYear)||base.getUTCFullYear();
  const months=Array.from({length:6},(_,i)=>{const d=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()-5+i,1));return {key:d.toISOString().slice(0,7),label:d.toLocaleDateString("fr-FR",{month:"short",timeZone:"UTC"}),approuve:0,en_attente:0,refuse:0}});
  let undated=0;
  list.forEach(c=>{if(!validDate(c.createdAt)){undated++;return}const m=months.find(m=>m.key===String(c.createdAt).slice(0,7));if(m&&Object.hasOwn(m,c.statut))m[c.statut]++});
  const types=new Map();
  list.filter(c=>c.statut==="approuve"&&validDate(c.du)&&validDate(c.au)).forEach(c=>{
    const from=c.du.slice(0,10)>`${year}-01-01`?c.du.slice(0,10):`${year}-01-01`,to=c.au.slice(0,10)<`${year}-12-31`?c.au.slice(0,10):`${year}-12-31`;
    const days=drhCongeDureeJours({du:from,au:to});if(days)types.set(c.type||"Type non renseigné",(types.get(c.type||"Type non renseigné")||0)+days);
  });
  const typeRows=[...types].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])),typeTotal=typeRows.reduce((sum,x)=>sum+x[1],0);
  const latest=list.slice().sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))||String(b.du||"").localeCompare(String(a.du||""))||String(a.id).localeCompare(String(b.id))).slice(0,5);
  const high=balances.filter(x=>x.solde!==null&&x.solde>=DRH_CONGE_SOLDE_ELEVE_SEUIL).sort((a,b)=>b.solde-a.solde||a.name.localeCompare(b.name)||String(a.a.id).localeCompare(String(b.a.id)));
  return {list,pending,current,currentCount:distinct(current),week,categories,months,undated,typeRows,typeTotal,year,latest,high};
}
function drhLeaveCockpitCan(action){
  if(isOpsSupervisorReadOnlySession())return false;
  const actions=Array.isArray(session?.actionsAutorisees)?session.actionsAutorisees.map(x=>String(x).toLowerCase()):[];
  return !actions.length||actions.includes(action)||actions.includes("admin");
}
function drhLeaveCockpitSetWeek(iso){sessionStorage.setItem("drhLeaveCockpitWeek",iso);renderView()}
function drhLeaveCockpitSetYear(year){sessionStorage.setItem("drhLeaveCockpitYear",year);renderView()}
function openDrhLeaveCockpitDetail(id){
  const isDrh=session?.transverse==="drh",agents=congesModuleScopeAgents(isDrh).filter(agentInSupervisorScope);
  const c=(db.conges||[]).find(c=>String(c.id)===String(id)&&agents.some(a=>String(a.id)===String(c.agentId)));
  if(!c)return;
  openModal(`<h3>Détail de la demande</h3><p><strong>${escapeHTML(drhCongeAgentName(c))}</strong></p><dl class="leave-detail"><dt>Type</dt><dd>${escapeHTML(c.type||"—")}</dd><dt>Période</dt><dd>${formatDate(c.du)} — ${formatDate(c.au)}</dd><dt>Statut</dt><dd>${drhCongeStatutBadgeHTML(c.statut)}</dd><dt>Création</dt><dd>${c.createdAt?formatDate(String(c.createdAt).slice(0,10)):"Date non enregistrée"}</dd><dt>Motif</dt><dd>${escapeHTML(c.motif||"—")}</dd></dl><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button>`);
}
function drhLeaveCockpitHTML(data,balances,agents){
  const esc=escapeHTML,num=n=>Number(n).toLocaleString("fr-FR",{maximumFractionDigits:2});
  const call=id=>`openDrhLeaveCockpitDetail(decodeURIComponent('${encodeURIComponent(String(id)).replace(/'/g,"%27")}'))`;
  const head=(title,sub,action="")=>`<header><div><h3>${title}</h3><p>${sub}</p></div>${action}</header>`;
  const empty=msg=>`<div class="drh-leave-empty">${msg}</div>`;
  const queue=[...data.pending.map(c=>({kind:"Demande en attente",name:drhCongeAgentName(c),meta:`${formatDate(c.du)} — ${formatDate(c.au)}`,action:call(c.id)})),...data.high.map(x=>({kind:"Solde élevé",name:x.name,meta:`${num(x.solde)} jours disponibles`,action:`navigate('agents/${employeeRouteId(x.a)}')`}))].slice(0,5);
  let offset=0;
  const gradient=data.categories.map(x=>{const begin=offset;offset+=balances.length?x.count/balances.length*100:0;return `${x.color} ${begin}% ${offset}%`}).join(",");
  const max=Math.max(1,...data.months.flatMap(m=>[m.approuve,m.en_attente,m.refuse]));
  const historyTotal=data.months.reduce((sum,m)=>sum+m.approuve+m.en_attente+m.refuse,0);
  const currentYear=Number(today().slice(0,4));
  const years=[...new Set([currentYear,data.year,...data.list.flatMap(c=>[c.du,c.au]).filter(v=>drhLeaveCalendarDate(v)).map(v=>Number(v.slice(0,4)))])].sort((a,b)=>b-a);
  return `<section class="leave-cockpit-grid">
    <article class="leave-modern-card leave-week-card">${head("Planning de la semaine","Congés approuvés · employés distincts",`<button type="button" onclick="setDrhCongesDashboardTab('planning')">Ouvrir le planning →</button>`)}<div class="leave-week-controls"><button type="button" aria-label="Semaine précédente" onclick="drhLeaveCockpitSetWeek('${congeAttribAddDays(data.week[0].iso,-7)}')">←</button><span>${formatDate(data.week[0].iso)} — ${formatDate(data.week[6].iso)}</span><button type="button" aria-label="Semaine suivante" onclick="drhLeaveCockpitSetWeek('${congeAttribAddDays(data.week[0].iso,7)}')">→</button><button type="button" onclick="drhLeaveCockpitSetWeek('${today()}')">Aujourd’hui</button></div><div class="leave-week-strip">${data.week.map(x=>`<button type="button" class="${x.iso===today()?"today":""}" onclick="setDrhCongesDashboardTab('planning')" title="${esc(x.items.map(c=>drhCongeAgentName(c)).join(', ')||'Aucun congé approuvé')}"><span>${x.d.toLocaleDateString('fr-FR',{weekday:'short',timeZone:'UTC'})}</span><b>${x.d.getUTCDate()}</b><em>${x.count} absent${x.count>1?'s':''}</em></button>`).join('')}</div><details class="leave-current"><summary>En congé aujourd’hui · ${data.currentCount}</summary>${data.current.length?data.current.map(c=>`<button type="button" onclick="${call(c.id)}">${esc(drhCongeAgentName(c))} · ${esc(c.type)} · retour ${formatDate(c.au)}</button>`).join(''):empty('Aucun employé en congé aujourd’hui.')}</details><details class="leave-current"><summary>Qui sera absent cette semaine ?</summary>${data.week.some(x=>x.count)?data.week.filter(x=>x.count).map(x=>`<p>${formatDate(x.iso)} · ${esc([...new Set(x.items.map(c=>drhCongeAgentName(c)))].join(', '))}</p>`).join(''):empty('Aucun congé approuvé cette semaine.')}</details></article>
    <article class="leave-modern-card leave-actions">${head("À faire maintenant","Demandes les plus anciennes, puis soldes décroissants",`<button type="button" onclick="setDrhCongesDashboardTab('requests')">Toutes les demandes →</button>`)}${queue.length?queue.map((x,i)=>`<button type="button" onclick="${x.action}"><i>${i+1}</i><span><b>${esc(x.kind)} · ${esc(x.name)}</b><small>${esc(x.meta)}</small></span><em>Ouvrir</em></button>`).join(''):empty('Aucune priorité à traiter.')}</article>
    <article class="leave-modern-card leave-balances-chart">${head("Répartition des soldes de congés","Seuil existant · droits acquis moins jours annuels approuvés")}${balances.length?`<div class="leave-donut-layout"><div class="leave-donut" role="img" aria-label="${esc(data.categories.map(x=>`${x.label}: ${x.count}`).join(', '))}" style="background:conic-gradient(${gradient})"><div><b>${balances.length}</b><span>employés</span></div></div><ul class="leave-legend">${data.categories.map(x=>`<li><i style="background:${x.color}"></i><span>${esc(x.label)}</span><b>${x.count} (${Math.round(x.count/balances.length*100)}%)</b></li>`).join('')}</ul></div>`:empty('Aucun solde disponible dans ce périmètre.')}</article>
    <article class="leave-modern-card leave-trend">${head("Évolution des demandes","6 derniers mois · date de création · statut actuel")}${historyTotal?`<div class="leave-month-chart" role="img" aria-label="Demandes créées sur les six derniers mois">${data.months.map(m=>`<div class="leave-month"><div class="leave-month-bars">${['approuve','en_attente','refuse'].map(status=>`<span class="${status}" style="height:${m[status]/max*100}%" title="${esc(m.key)} · ${esc(status)}: ${m[status]}"><small>${m[status]||''}</small></span>`).join('')}</div><label>${esc(m.label)}</label></div>`).join('')}</div><div class="leave-series"><span>● Approuvées</span><span>● En attente</span><span>● Refusées</span></div>`:empty('Aucune demande datée sur les six derniers mois.')}${data.undated?`<p class="leave-data-note">${data.undated} demande(s) sans date de création exclue(s) du graphique.</p>`:''}</article>
    <article class="leave-modern-card leave-latest">${head("Dernières demandes","Dates de création enregistrées en premier",`<button type="button" onclick="setDrhCongesDashboardTab('requests')">Voir les demandes →</button>`)}<div class="leave-table-scroll"><table><thead><tr><th>Date</th><th>Employé</th><th>Type</th><th>Période</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${data.latest.map(c=>`<tr><td>${c.createdAt?formatDate(String(c.createdAt).slice(0,10)):'Non enregistrée'}</td><td>${esc(drhCongeAgentName(c))}</td><td>${esc(c.type||'—')}</td><td>${formatDate(c.du)} → ${formatDate(c.au)}</td><td>${drhCongeStatutBadgeHTML(c.statut)}</td><td><button type="button" onclick="${call(c.id)}">Voir</button></td></tr>`).join('')||'<tr><td colspan="6">Aucune demande enregistrée.</td></tr>'}</tbody></table></div></article>
    <article class="leave-modern-card leave-types">${head("Répartition par type de congé","Jours calendaires approuvés dans l’année sélectionnée",`<select aria-label="Année des types de congé" onchange="drhLeaveCockpitSetYear(this.value)">${years.map(y=>`<option value="${y}" ${y===data.year?'selected':''}>${y===currentYear?'Année en cours':y}</option>`).join('')}</select>`)}${data.typeTotal?`<div class="leave-type-bars">${data.typeRows.map(([type,days])=>`<div><span>${esc(type)}</span><i><em style="width:${days/data.typeTotal*100}%"></em></i><b>${num(days)} j · ${Math.round(days/data.typeTotal*100)}%</b></div>`).join('')}</div>`:empty('Aucun jour de congé approuvé pour cette année.')}</article>
  </section>`;
}

function renderCongesModule(view,isDrh){
  const soc=isDrh?drhActiveSocieteFilter():(effectifSocieteFilter&&effectifSocieteFilter());
  const canAttribuer=congesModuleCanAttribuer(isDrh)&&drhLeaveCockpitCan("create")&&drhLeaveCockpitCan("validate");
  const canCreate=drhLeaveCockpitCan("create"),canValidate=drhLeaveCockpitCan("validate"),canExport=congesModuleCanAttribuer(isDrh)&&drhLeaveCockpitCan("export");
  const agents=congesModuleScopeAgents(isDrh).filter(agentInSupervisorScope).slice().sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||""))||String(a.prenom||"").localeCompare(String(b.prenom||"")));
  drhCongesSoldeEleveOnly=false;
  let soldeEleveCount=0;
  const balances=[];
  const rows=agents.map(a=>{
    const name=((a.nom||"")+" "+(a.prenom||"")).trim();
    const code=a.matricule||a.code||"";
    const recruited=a.dateRecrutement||a.dateEntree||"";
    const contractEnd=employeePositionContractEndDate(a);
    const entitlement=recruited?drhLeaveEntitlement(recruited):null;
    const pris=drhCongesAnnuelsPris(a.id);
    const solde=entitlement===null?null:Math.round((entitlement-pris)*100)/100;
    const soldeEleve=solde!==null&&solde>=DRH_CONGE_SOLDE_ELEVE_SEUIL;
    if(soldeEleve)soldeEleveCount++;
    const q=[name,code,recruited,contractEnd].join(" ").toLowerCase();
    const suspended=a.statut==="suspendu";
    const hasTaken=pris>0;
    const rowAction=!canCreate?`navigate('agents/${employeeRouteId(a)}')`:canAttribuer?`openCongeAttributionModal('${escapeHTML(String(a.id))}')`:`openCongeModal('${escapeHTML(String(a.id))}')`;
    balances.push({a,name,code,recruited,contractEnd,entitlement,pris,solde,soldeEleve});
    return `<tr data-searchable data-q="${escapeHTML(q)}" data-solde-eleve="${soldeEleve?"1":"0"}" class="drh-conge-row${hasTaken?" drh-conge-row-taken":""}" onclick="if(!event.target.closest('a,button'))${rowAction}"><td class="font-semibold"><div class="cg-person"><span class="cg-avatar">${congeAvatarInitials(name)}</span><a href="#/agents/${employeeRouteId(a)}" class="hover:underline">${escapeHTML(name||"—")}</a>${suspended?` <span class="pill pill-red">Suspendu</span>`:""}</div></td><td class="font-mono font-bold text-amber-700">${escapeHTML(code||"—")}</td><td class="text-xs">${recruited?formatDate(recruited):"—"}</td><td class="text-xs">${contractEnd?formatDate(contractEnd):"—"}</td><td class="font-black" style="color:#043970">${entitlement===null?"—":entitlement.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" jours"}</td><td class="font-black text-amber-700">${pris.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} jours</td><td class="font-black ${soldeEleve?"text-amber-700":""}">${solde===null?"—":solde.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" jours"}${soldeEleve?" ⚠":""}</td><td><button type="button" class="btn ${canAttribuer?"btn-primary":"btn-ghost"} text-xs" onclick="event.stopPropagation();${rowAction}">${!canCreate?"Voir":canAttribuer?"Attribuer":"Demander"}</button></td></tr>`;
  }).join("");
  const tab=drhCongesDashboardTab();
  const scopedIds=new Set(agents.map(a=>String(a.id)));
  const conges=(db.conges||[]).filter(c=>c.type!=="Maladie"&&scopedIds.has(String(c.agentId)));
  const pending=conges.filter(c=>c.statut==="en_attente");
  const latest=conges.slice().sort((a,b)=>String(b.createdAt||b.du||"").localeCompare(String(a.createdAt||a.du||"")));
  const history=latest.filter(c=>["approuve","refuse"].includes(c.statut));
  const tabButton=(key,label,count)=>`<button type="button" class="drh-leave-tab${tab===key?" is-active":""}" onclick="setDrhCongesDashboardTab('${key}')">${label}${count?` <b>${count}</b>`:""}</button>`;
  const requestRows=pending.map(c=>{const a=agents.find(x=>String(x.id)===String(c.agentId));return`<tr><td class="font-semibold"><div class="cg-person"><span class="cg-avatar">${congeAvatarInitials(drhCongeAgentName(c))}</span>${escapeHTML(drhCongeAgentName(c))}</div></td><td>${escapeHTML(c.type||"Congé")}</td><td>${formatDate(c.du)} — ${formatDate(c.au)}</td><td>${drhCongeDureeJours(c)} j</td><td>${congeOrigineBadgeHTML(c)}</td><td class="flex gap-1">${canValidate?`<button class="btn btn-success text-xs" onclick="approuverConge('${escapeHTML(String(c.id))}')">Valider</button><button class="btn btn-danger text-xs" onclick="refuserConge('${escapeHTML(String(c.id))}')">Refuser</button>`:""}${a?`<a class="btn btn-ghost text-xs" href="#/agents/${employeeRouteId(a)}">Ouvrir</a>`:""}</td></tr>`}).join("");
  const historyRows=history.map(c=>`<tr><td class="font-semibold"><div class="cg-person"><span class="cg-avatar">${congeAvatarInitials(drhCongeAgentName(c))}</span>${escapeHTML(drhCongeAgentName(c))}</div></td><td>${escapeHTML(c.type||"Congé")}</td><td>${formatDate(c.du)} — ${formatDate(c.au)}</td><td>${drhCongeStatutBadgeHTML(c.statut)}</td><td>${congeOrigineBadgeHTML(c)}</td><td>${drhCongeDureeJours(c)} j</td></tr>`).join("");
  const cockpit=drhLeaveCockpitData(agents,conges,balances,today(),sessionStorage.getItem("drhLeaveCockpitWeek"),sessionStorage.getItem("drhLeaveCockpitYear"));
  const dashboard=drhLeaveCockpitHTML(cockpit,balances,agents);
  const balancesView=`${soldeEleveCount?`<button type="button" class="drh-leave-balance-alert" onclick="toggleDrhCongesSoldeEleve()"><b>${soldeEleveCount} employé(s) avec un solde élevé non pris</b><span>Congés à planifier avant une nouvelle accumulation.</span></button>`:""}<div class="card p-4 mb-4"><input id="drh-conges-search" class="input" type="search" placeholder="Rechercher par nom, prénom ou code..." oninput="filterDrhCongesPersonnel(this.value)"/></div><div id="drh-conges-personnel" class="card overflow-x-auto"><table><thead><tr><th>NOM PRÉNOM</th><th>CODE</th><th>DATE DE RECRUTEMENT</th><th>DATE DE FIN DE CONTRAT</th><th>DROIT CONGÉ</th><th>CONGÉ CONSOMMÉ</th><th>SOLDE RESTANT</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="8" class="text-center text-slate-500 p-8">Aucun personnel enregistré.</td></tr>`}</tbody></table></div>`;
  const tableView=(title,subtitle,thead,body,empty,extra)=>`<section class="card drh-leave-panel"><header><div><h3>${title}</h3><p>${subtitle}</p></div>${extra||""}</header><div class="overflow-x-auto"><table><thead>${thead}</thead><tbody>${body||`<tr><td colspan="6" class="text-center text-slate-500 p-8">${empty}</td></tr>`}</tbody></table></div></section>`;
  let content=dashboard;
  if(tab==="balances")content=balancesView;
  else if(tab==="planning")content=`<section class="card drh-leave-panel drh-leave-planning-full"><header><div><h3>Planning mensuel</h3><p>Visualisation des congés approuvés et de la couverture du personnel</p></div>${canAttribuer?`<button class="btn btn-primary" onclick="openCongeAttributionPicker()">+ Planifier</button>`:canCreate?`<button class="btn btn-primary" onclick="openCongeModal()">+ Nouvelle demande</button>`:""}</header>${drhCongesDashboardCalendar(conges)}<div class="drh-leave-planning-list">${conges.filter(c=>c.statut==="approuve"&&String(c.du||"").slice(0,7)===today().slice(0,7)).sort((a,b)=>String(a.du).localeCompare(String(b.du))).map(c=>`<div><strong>${escapeHTML(drhCongeAgentName(c))}</strong><span>${formatDate(c.du)} — ${formatDate(c.au)}</span><b>${drhCongeDureeJours(c)} j</b></div>`).join("")||`<div class="drh-leave-empty">Aucun congé approuvé ce mois-ci.</div>`}</div></section>`;
  else if(tab==="requests")content=tableView("Demandes à traiter","Validation, refus et contrôle du solde — auto-demandes et attributions réunies","<tr><th>EMPLOYÉ</th><th>TYPE</th><th>PÉRIODE</th><th>DURÉE</th><th>ORIGINE</th><th>ACTIONS</th></tr>",requestRows,"Aucune demande en attente.",canAttribuer?`<button type="button" class="btn btn-primary text-xs" onclick="openCongeAttributionPicker()">+ Attribuer un congé</button>`:canCreate?`<button type="button" class="btn btn-primary text-xs" onclick="openCongeModal()">+ Nouvelle demande</button>`:"");
  else if(tab==="documents"){
    const docFiltre=drhCongesDocFiltre();
    const seg=(key,label)=>`<button type="button" class="${docFiltre===key?"active":""}" onclick="setDrhCongesDocFiltre('${key}')">${label}</button>`;
    const titleRows=conges.filter(c=>c.statut==="approuve").map(c=>`<tr><td class="font-semibold">${escapeHTML(drhCongeAgentName(c))}</td><td>${escapeHTML(c.type||"Congé")}</td><td>${formatDate(c.du)} — ${formatDate(c.au)}</td><td class="font-mono">${escapeHTML(congeDocumentRef(c))}</td><td><button class="btn btn-ghost text-xs" onclick="printCongeOrder('${escapeHTML(String(c.id))}')">🖨 Ouvrir / imprimer</button></td></tr>`).join("");
    const thead=docFiltre==="titles"?"<tr><th>EMPLOYÉ</th><th>TYPE</th><th>PÉRIODE</th><th>RÉFÉRENCE</th><th>DOCUMENT</th></tr>":"<tr><th>EMPLOYÉ</th><th>TYPE</th><th>PÉRIODE</th><th>STATUT</th><th>ORIGINE</th><th>DURÉE</th></tr>";
    const body=docFiltre==="titles"?titleRows:historyRows;
    const empty=docFiltre==="titles"?"Aucun titre de congé validé.":"Aucun historique disponible.";
    content=tableView("Documents",docFiltre==="titles"?"Titres de congé validés, imprimables et archivés dans le dossier salarié":"Décisions enregistrées dans le dossier du personnel",thead,body,empty,`<div class="ops-dash-seg">${seg("titles","À imprimer")}${seg("history","Historique complet")}</div>`);
  }
  const heroLabel=isDrh?"Direction des ressources humaines":"Pilotage opérationnel";
  const heroActions=`<div style="display:flex;gap:8px;flex-wrap:wrap">
        ${canExport?`<button type="button" class="ops-dash-refresh" onclick="exportCongesRecapCSV()">⇩ Exporter</button>`:""}
        <button type="button" class="ops-dash-refresh" onclick="setDrhCongesDashboardTab('planning')">▦ Planning</button>
        ${canAttribuer?`<button type="button" class="ops-dash-refresh" style="background:#fff;color:#043970" onclick="openCongeAttributionPicker()">+ Attribuer un congé</button>`:""}
        ${canCreate?`<button type="button" class="ops-dash-refresh leave-primary" onclick="openCongeModal()">+ Nouvelle demande</button>`:""}
      </div>`;
  view.innerHTML=`<div class="drh-leave-page is-dashboard">
    <div class="leave-cockpit-hero"><div class="leave-cockpit-hero-row">
      <div><div class="ops-dash-eyebrow">${heroLabel}</div><h1>Congés &amp; planification</h1><div class="ops-dash-hero-sub"><span>${soc?escapeHTML(isDrh?drhSocieteLabel(soc):soc):"Toutes sociétés"} · ${pending.length} demande(s) en attente · ${cockpit.currentCount} en congé aujourd'hui</span></div></div>
      ${heroActions}
    </div></div>
    <div class="leave-cockpit-kpis">
      <div class="ops-dash-kpi" style="cursor:pointer" onclick="setDrhCongesDashboardTab('requests')"><div class="ops-dash-lbl">Demandes en attente</div><div class="ops-dash-val">${pending.length}</div><div class="ops-dash-sub">${pending.length?"Décisions requises":"File à jour"}</div></div>
      <div class="ops-dash-kpi" style="cursor:pointer" onclick="setDrhCongesDashboardTab('balances')"><div class="ops-dash-lbl">Soldes prioritaires</div><div class="ops-dash-val">${soldeEleveCount}</div><div class="ops-dash-sub">Seuil ${DRH_CONGE_SOLDE_ELEVE_SEUIL} jours</div></div>
      <div class="ops-dash-kpi" style="cursor:pointer" onclick="setDrhCongesDashboardTab('planning')"><div class="ops-dash-lbl">En congé aujourd'hui</div><div class="ops-dash-val">${cockpit.currentCount}</div><div class="ops-dash-sub">Absences planifiées</div></div>
      <div class="ops-dash-kpi" style="cursor:pointer" onclick="setDrhCongesDashboardTab('dashboard')"><div class="ops-dash-lbl">Santé du planning</div><div class="ops-dash-val">${pending.length?"À décider":"À jour"}</div><div class="ops-dash-sub">${pending.length} décision(s) en attente · suivi des demandes</div></div>
    </div>
    <nav class="drh-leave-tabs" aria-label="Navigation congés">${tabButton("dashboard","Tableau de bord")}${tabButton("balances","Soldes",soldeEleveCount)}${tabButton("requests","Demandes",pending.length)}${tabButton("planning","Planning")}${tabButton("documents","Documents")}</nav>
    ${content}
  </div>`;
}

function toggleDrhCongesSoldeEleve(){
  drhCongesSoldeEleveOnly=!drhCongesSoldeEleveOnly;
  filterDrhCongesPersonnel(document.getElementById("drh-conges-search")?.value||"");
}

function exportCongesRecapCSV(){
  if(!drhLeaveCockpitCan("export")||!congesModuleCanAttribuer(session?.transverse==="drh"))return;
  const soc=drhActiveSocieteFilter();
  const agents=congesModuleScopeAgents(session?.transverse==="drh").filter(agentInSupervisorScope).slice().sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||"")));
  const rows=[["Nom Prénom","Code","Société","Date de recrutement","Droit acquis (j)","Jours pris (j)","Solde restant (j)"]];
  agents.forEach(a=>{
    const recruited=a.dateRecrutement||a.dateEntree||"";
    const entitlement=recruited?drhLeaveEntitlement(recruited):0;
    const pris=drhCongesAnnuelsPris(a.id);
    const solde=Math.round((entitlement-pris)*100)/100;
    rows.push([((a.nom||"")+" "+(a.prenom||"")).trim(),a.matricule||a.code||"",a.societe||"",recruited?formatDate(recruited):"",entitlement.toFixed(2),pris.toFixed(2),solde.toFixed(2)]);
  });
  paieDownloadCSV(rows,"conges-recap-"+today()+(soc?"-"+soc.replace(/\s+/g,"_"):"")+".csv");
}

function drhCongeDureeJours(c){
  const du=drhLeaveCalendarDate(c&&c.du),au=drhLeaveCalendarDate(c&&c.au);
  if(!du||!au||au<du)return 0;
  return Math.round((au-du)/86400000)+1;
}

function drhCongesAnnuelsPris(agentId){
  return (db.conges||[]).filter(c=>String(c.agentId)===String(agentId)&&c.type==="Annuel"&&c.statut==="approuve").reduce((s,c)=>s+drhCongeDureeJours(c),0);
}

function drhCongeStatutBadgeHTML(statut){
  const map={approuve:["Approuvé","pill-green"],en_attente:["En attente","pill-amber"],refuse:["Refusé","pill-red"]};
  const [label,cls]=map[statut]||[statut||"—","pill"];
  return `<span class="pill ${cls}">${escapeHTML(label)}</span>`;
}

function drhCongesOverlap(c,du,au){
  const cs=drhLeaveCalendarDate(c&&c.du),ce=drhLeaveCalendarDate(c&&c.au);
  const s=drhLeaveCalendarDate(du),e=drhLeaveCalendarDate(au);
  if(!cs||!ce||!s||!e)return false;
  return cs<=e&&ce>=s;
}

function congeAttribAddDays(dateStr,days){
  const d=drhLeaveCalendarDate(dateStr);
  if(!d)return "";
  return new Date(d.getTime()+days*86400000).toISOString().slice(0,10);
}

function congeAttribApplyDateFields(prefix,source){
  const duEl=document.getElementById(`conge-attrib-du${prefix}`);
  const auEl=document.getElementById(`conge-attrib-au${prefix}`);
  const joursEl=document.getElementById(`conge-attrib-jours-nbr${prefix}`);
  if(!duEl||!auEl||!joursEl)return;
  const du=duEl.value;
  if(source==="au"){
    // Modification manuelle de la date de retour -> on resynchronise le nombre de jours affiché.
    const jours=drhCongeDureeJours({du,au:auEl.value});
    joursEl.value=jours>0?jours:"";
  }else{
    // Nombre de jours saisi (ou date de début changée avec un nombre déjà saisi) -> on calcule
    // automatiquement la date de retour (Du + nombre de jours - 1, période inclusive).
    const jours=parseInt(joursEl.value,10);
    if(du&&jours>0)auEl.value=congeAttribAddDays(du,jours-1);
  }
}

function congeAttribSyncAccorde(){
  // Par défaut, le congé accordé recopie le congé demandé — jusqu'à ce que le DRH modifie
  // lui-même le bloc "Congé accordé" (ex : accorder moins de jours que demandé).
  if(congeAccordeTouched)return;
  const du=document.getElementById("conge-attrib-du")?.value||"";
  const jours=document.getElementById("conge-attrib-jours-nbr")?.value||"";
  const au=document.getElementById("conge-attrib-au")?.value||"";
  const duA=document.getElementById("conge-attrib-du-accorde");
  const joursA=document.getElementById("conge-attrib-jours-nbr-accorde");
  const auA=document.getElementById("conge-attrib-au-accorde");
  if(duA)duA.value=du;
  if(joursA)joursA.value=jours;
  if(auA)auA.value=au;
}

function updateCongeAttribDates(source){
  congeAttribApplyDateFields("",source);
  congeAttribSyncAccorde();
  updateCongeAttribJours();
}

function updateCongeAccordeDates(source){
  congeAccordeTouched=true;
  congeAttribApplyDateFields("-accorde",source);
  updateCongeAttribJours();
}

function updateCongeAttribJours(){
  const type=document.getElementById("conge-attrib-type")?.value;
  const duD=document.getElementById("conge-attrib-du")?.value;
  const auD=document.getElementById("conge-attrib-au")?.value;
  const duA=document.getElementById("conge-attrib-du-accorde")?.value;
  const auA=document.getElementById("conge-attrib-au-accorde")?.value;
  const el=document.getElementById("conge-attrib-jours");
  const covEl=document.getElementById("conge-attrib-coverage");
  if(!el)return;
  const joursDemande=drhCongeDureeJours({du:duD,au:auD});
  const joursAccorde=drhCongeDureeJours({du:duA,au:auA});
  if(!joursDemande&&!joursAccorde){el.innerHTML="";if(covEl)covEl.innerHTML="";return}
  const diff=joursAccorde&&joursAccorde!==joursDemande?` · ${joursAccorde} jour(s) accordé(s)`:"";
  if(type==="Annuel"&&joursAccorde>congeAttribSolde){
    el.innerHTML=`<span class="text-red-600 font-semibold">⚠ ${joursAccorde} jour(s) accordé(s) — dépasse le solde disponible (${congeAttribSolde.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} j). Ajustez le nombre de jours.</span>`;
  }else{
    el.innerHTML=`<span class="text-emerald-700 font-semibold">${joursDemande} jour(s) demandé(s)${diff}</span>`;
  }
  if(covEl&&congeAttribAgent){
    const cov=drhSiteCoverageCheck(congeAttribAgent,duA||duD,auA||auD);
    if(cov&&cov.concurrentNames.length>0&&(cov.concurrentNames.length+1)/cov.total>=0.25){
      covEl.innerHTML=`<div class="p-2 rounded mt-2" style="background:#fffbeb;border:1px solid #fcd34d;font-size:12px;color:#92400e">⚠ Couverture site « ${escapeHTML(cov.site)} » : ${cov.concurrentNames.length+1}/${cov.total} agent(s) seraient absents en même temps (déjà en congé : ${escapeHTML(cov.concurrentNames.join(", "))}).</div>`;
    }else{
      covEl.innerHTML="";
    }
  }
}

function openCongeAttributionPicker(){
  if(!drhLeaveCockpitCan("create")||!drhLeaveCockpitCan("validate")||!congesModuleCanAttribuer(session?.transverse==="drh"))return;
  // Point d'entrée générique (bouton "+ Attribuer un congé" du bandeau, "+ Planifier" du
  // planning) : on choisit d'abord l'employé, puis on enchaîne sur le même parcours complet
  // (solde, couverture site, confirmation, aperçu, impression) que le clic sur une ligne du
  // tableau "Soldes individuels" — pour ne pas avoir deux façons différentes d'attribuer un
  // congé, l'une contrôlée et l'autre non.
  const agents=congesModuleScopeAgents(session?.transverse==="drh").filter(agentInSupervisorScope).slice().sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||""))||String(a.prenom||"").localeCompare(String(b.prenom||"")));
  openModal(`<h3 class="font-bold text-lg mb-4">Attribuer un congé</h3>
    <div class="mb-3"><label class="label">Employé</label><select class="select" id="conge-picker-agent">
      <option value="">— Choisir un employé —</option>
      ${agents.map(a=>`<option value="${escapeHTML(String(a.id))}">${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())} · ${escapeHTML(a.matricule||a.code||"")}</option>`).join("")}
    </select></div>
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button type="button" class="btn btn-primary" onclick="const id=document.getElementById('conge-picker-agent').value;if(!id){toast('Choisissez un employé','error');return}openCongeAttributionModal(id)">Continuer</button></div>`);
}

function openCongeAttributionModal(agentId){
  if(!drhLeaveCockpitCan("create")||!drhLeaveCockpitCan("validate")||!congesModuleCanAttribuer(session?.transverse==="drh")||!congesModuleScopeAgents(session?.transverse==="drh").filter(agentInSupervisorScope).some(a=>String(a.id)===String(agentId)))return;
  const a=(db.agents||[]).find(x=>String(x.id)===String(agentId));
  if(!a){toast("Employé introuvable","error");return}
  const name=((a.nom||"")+" "+(a.prenom||"")).trim();
  const recruited=a.dateRecrutement||a.dateEntree||"";
  const entitlement=recruited?drhLeaveEntitlement(recruited):0;
  const pris=drhCongesAnnuelsPris(a.id);
  const solde=Math.round((entitlement-pris)*100)/100;
  const suspended=a.statut==="suspendu";
  congeAttribSolde=solde;
  congeAttribAgent=a;
  congeAccordeTouched=false;
  const history=(db.conges||[]).filter(c=>String(c.agentId)===String(a.id)).sort((x,y)=>String(y.du||"").localeCompare(String(x.du||"")));
  const historyRows=history.map(c=>{
    const duDemande=c.duDemande||c.du,auDemande=c.auDemande||c.au;
    const joursDemande=drhCongeDureeJours({du:duDemande,au:auDemande});
    const joursAccorde=drhCongeDureeJours(c);
    return `<tr><td>${escapeHTML(c.type||"—")}</td><td class="font-bold">${joursDemande} – ${joursAccorde}</td><td class="text-xs">${duDemande?formatDate(duDemande):"—"} – ${c.du?formatDate(c.du):"—"}</td><td>${drhCongeStatutBadgeHTML(c.statut)}</td><td class="text-xs">${escapeHTML(c.motif||"—")}</td><td><button type="button" class="btn btn-ghost text-xs" onclick="printCongeOrder('${escapeHTML(String(c.id))}')">🖨 Titre de congé</button></td></tr>`;
  }).join("");
  openModal(`<div style="min-height:78vh;display:flex;flex-direction:column">
    <div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
      <div><h3 class="text-xl font-black">${escapeHTML(name||"—")}</h3><p class="text-sm text-slate-500">${escapeHTML(a.matricule||a.code||"—")} · ${escapeHTML(a.societe||"")} · Recruté le ${recruited?formatDate(recruited):"—"}</p></div>
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button>
    </div>
    <div class="grid grid-3 mb-4">
      <div class="card p-3 text-center"><div class="text-xs text-slate-500 uppercase font-bold">Droit acquis</div><div class="text-2xl font-black" style="color:#043970">${entitlement.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} j</div></div>
      <div class="card p-3 text-center"><div class="text-xs text-slate-500 uppercase font-bold">Congé consommé</div><div class="text-2xl font-black text-amber-700">${pris.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} j</div></div>
      <div class="card p-3 text-center"><div class="text-xs text-slate-500 uppercase font-bold">Solde restant</div><div class="text-2xl font-black ${solde<0?"text-red-600":"text-emerald-700"}">${solde.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} j</div></div>
    </div>
    ${suspended?`<div class="card p-4 mb-4" style="background:#fef2f2;border:1px solid #fca5a5"><span class="font-bold text-red-700">⛔ Employé suspendu</span><div class="text-sm text-red-800 mt-1">Un employé suspendu ne peut pas bénéficier d'un congé. Levez la suspension avant d'en attribuer un.</div></div>`:`
    <form onsubmit="event.preventDefault();requestCongeConfirmation('${escapeHTML(String(a.id))}')" class="card p-4 mb-4">
      <div class="grid grid-cols-2 gap-6">
        <div>
          <div class="font-bold mb-3" style="color:#043970">CONGÉ DEMANDÉ</div>
          <div class="mb-3"><label class="label">Type</label><select class="select" name="type" id="conge-attrib-type" onchange="updateCongeAttribJours()">${["Annuel","Sans solde","Exceptionnel","Maternité","Paternité"].map(t=>`<option>${t}</option>`).join("")}</select></div>
          <div class="grid grid-3">
            <div><label class="label">Du</label><input class="input" type="date" id="conge-attrib-du" onchange="updateCongeAttribDates('du')" required/></div>
            <div><label class="label">Nbr de jours demandés</label><input class="input" type="number" min="1" id="conge-attrib-jours-nbr" oninput="updateCongeAttribDates('jours')" placeholder="Ex: 14"/></div>
            <div><label class="label">Au (date de retour)</label><input class="input" type="date" id="conge-attrib-au" onchange="updateCongeAttribDates('au')" required/></div>
          </div>
        </div>
        <div style="border-left:1px solid var(--border);padding-left:24px">
          <div class="font-bold mb-3" style="color:#043970">CONGÉ ACCORDÉ</div>
          <div class="grid grid-3" style="margin-top:38px">
            <div><label class="label">Du</label><input class="input" type="date" id="conge-attrib-du-accorde" onchange="updateCongeAccordeDates('du')" required/></div>
            <div><label class="label">Nbr de jours demandés</label><input class="input" type="number" min="1" id="conge-attrib-jours-nbr-accorde" oninput="updateCongeAccordeDates('jours')" placeholder="Ex: 14"/></div>
            <div><label class="label">Au (date de retour)</label><input class="input" type="date" id="conge-attrib-au-accorde" onchange="updateCongeAccordeDates('au')" required/></div>
          </div>
        </div>
      </div>
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)"/>
      <div id="conge-attrib-jours"></div>
      <div id="conge-attrib-coverage"></div>
      <div class="mt-3"><label class="label">Motif</label><textarea class="textarea" rows="2" name="motif"></textarea></div>
      <div class="flex justify-end gap-2 mt-4"><button type="submit" class="btn btn-primary">Valider congé</button></div>
    </form>`}
    <div class="card overflow-x-auto" style="flex:1"><div class="p-3 font-bold border-b">Historique des congés</div><table><thead><tr><th>Type congé</th><th>Nbr jour demandés / accordés</th><th>Date départ souhaitée / accordée</th><th>Statut</th><th>Observation</th><th>Document</th></tr></thead><tbody>${historyRows||`<tr><td colspan="6" class="text-center text-slate-500 p-6">Aucun congé enregistré.</td></tr>`}</tbody></table></div>
  </div>`);
}

async function notifyPortalCongeAttribution(a,c){
  const matricule=String(a?.matricule||a?.code||"").trim();
  if(!matricule)return;
  const title="Congé "+(c.statut==="approuve"?"approuvé":"enregistré");
  const body=`${c.type} du ${formatDate(c.du)} au ${formatDate(c.au)}.`;
  try{
    const token=sgdiAuthToken();
    await fetch(`/api/portal/push/send/${encodeURIComponent(matricule)}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({title,body})});
  }catch(e){/* best-effort : pas d'abonnement push ou hors-ligne, sans impact sur l'attribution */}
}

function congeDocumentRef(c){
  const createdAt=c&&c.createdAt?String(c.createdAt):"";
  const year=(createdAt.slice(0,4)||String(today()).slice(0,4))||new Date().getFullYear();
  const sameYear=(db.conges||[]).filter(x=>String(x.createdAt||"").slice(0,4)===String(year)).sort((x,y)=>String(x.createdAt||"").localeCompare(String(y.createdAt||"")));
  const idx=sameYear.findIndex(x=>String(x.id)===String(c&&c.id));
  const num=idx>=0?idx+1:sameYear.length+1;
  return `DRH/${String(num).padStart(4,"0")}/${year}`;
}

function congeOrderHTML(c,a){
  const name=((a.nom||"")+" "+(a.prenom||"")).trim();
  const jours=drhCongeDureeJours(c);
  const reference=congeDocumentRef(c);
  const reprise=c.au?addDays(c.au,1):"";
  const aff=agentLiveAffectation(a)||{};
  const societe=String(a.societe||"IRON GLOBAL SÉCURITÉ");
  const logo=sgdiDocumentLogoHTML(societe,"leave-order-logo");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Titre de congé - ${escapeHTML(name)}</title>
  <style>
    @page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}html,body{width:210mm;min-height:297mm}
    body{margin:0;background:#eef2f7;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.35}
    .leave-order{position:relative;width:190mm;min-height:277mm;margin:0 auto;background:#fff;padding:8mm 10mm 17mm;overflow:hidden}
    .leave-order-logo{display:block;width:31mm;height:31mm;object-fit:contain;margin:0 auto 3mm}
    .company{text-align:center;font-size:10pt;font-weight:900;text-transform:uppercase;color:#043970;letter-spacing:.04em}
    h1{text-align:center;font-size:18pt;line-height:1.1;text-transform:uppercase;letter-spacing:.08em;margin:7mm 0 3mm;color:#0f172a}
    .title-rule{height:1.2mm;background:#043970;border-bottom:.5mm solid #f2b705;margin-bottom:5mm}
    .meta{display:flex;justify-content:space-between;gap:10mm;font-size:9.5pt;margin-bottom:5mm}.meta b{color:#043970}
    .identity{border:1px solid #cbd5e1;border-left:1.5mm solid #043970;padding:5mm 6mm;margin-bottom:6mm}
    .grid{display:grid;grid-template-columns:38mm 1fr;gap:2.2mm 5mm}.k{font-size:8.5pt;font-weight:900;color:#475569;text-transform:uppercase}.v{font-weight:700;overflow-wrap:anywhere}
    .decision{font-size:11pt;text-align:justify;margin:6mm 0}.decision p{margin:0 0 4mm}
    .period{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #cbd5e1;margin:6mm 0}.period div{padding:4mm 2mm;text-align:center;border-right:1px solid #cbd5e1}.period div:last-child{border-right:0}.period b{display:block;color:#475569;text-transform:uppercase;font-size:8pt;margin-bottom:1.5mm}.period strong{font-size:11pt;color:#043970}
    .notice{border:1px solid #f2b705;background:#fffbeb;padding:4mm 5mm;margin-top:5mm;font-size:9pt;text-align:justify}.notice b{color:#92400e}
    .signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10mm;margin-top:18mm}.signature{text-align:center;font-size:9pt;font-weight:900}.signature-line{height:19mm;border-bottom:1px solid #64748b;margin-bottom:2mm}
    .footer{position:absolute;left:10mm;right:10mm;bottom:5mm;border-top:.7mm solid #043970;padding-top:2mm;text-align:center;font-size:7.5pt;color:#475569}
    @media print{html,body{width:auto;min-height:auto;background:#fff}.leave-order{width:190mm;min-height:277mm;margin:0}}
  </style></head><body>
  <main class="leave-order">
    ${logo}
    <div class="company">${escapeHTML(societe)}</div>
    <h1>Titre de congé</h1><div class="title-rule"></div>
    <div class="meta"><div>Référence : <b>${escapeHTML(reference)}</b></div><div>Établi le : <b>${formatDate(c.createdAt||today())}</b></div></div>
    <section class="identity"><div class="grid">
      <div class="k">Nom et prénom</div><div class="v">${escapeHTML(name||"—")}</div>
      <div class="k">Fonction</div><div class="v">${escapeHTML(aff.poste||a.fonction||"—")}</div>
      <div class="k">Type de congé</div><div class="v">${escapeHTML(c.type||"—")}</div>
    </div></section>
    <section class="decision"><p>La Direction des Ressources Humaines accorde à l’employé(e) désigné(e) ci-dessus le congé suivant :</p>
      <div class="period"><div><b>Date de départ</b><strong>${c.du?formatDate(c.du):"—"}</strong></div><div><b>Date de fin</b><strong>${c.au?formatDate(c.au):"—"}</strong></div><div><b>Durée</b><strong>${jours} jour(s)</strong></div><div><b>Date de reprise</b><strong>${reprise?formatDate(reprise):"—"}</strong></div></div>
      <div class="notice"><b>IMPORTANT :</b> Le bénéficiaire doit reprendre son poste à la date indiquée. Toute prolongation doit faire l’objet d’une autorisation préalable de la Direction des Ressources Humaines. En cas de nécessité de service, le congé peut être interrompu et l’employé devra reprendre son poste conformément à la réglementation en vigueur.</div>
    </section>
    <div class="signatures"><div class="signature"><div class="signature-line"></div>L’intéressé(e)</div><div class="signature"><div class="signature-line"></div>Responsable hiérarchique</div><div class="signature"><div class="signature-line"></div>Direction des Ressources Humaines</div></div>
    <footer class="footer">Document généré par ATLAS SGDI · ${escapeHTML(societe)} · Réf. ${escapeHTML(reference)}</footer>
  </main></body></html>`;
}

function printCongeOrder(congeId){
  const c=(db.conges||[]).find(x=>String(x.id)===String(congeId));
  if(!c){toast("Congé introuvable","error");return}
  const a=(db.agents||[]).find(x=>String(x.id)===String(c.agentId));
  if(!a){toast("Employé introuvable","error");return}
  const w=window.open("","_blank","width=800,height=900");
  if(!w)return;
  w.document.write(congeOrderHTML(c,a)+`<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>`);
  w.document.close();
}

function requestCongeConfirmation(agentId){
  const form=document.querySelector(".modal-bg form");
  if(!form)return;
  const fd=new FormData(form);
  const type=fd.get("type"),motif=fd.get("motif");
  const duDemande=document.getElementById("conge-attrib-du")?.value||"";
  const auDemande=document.getElementById("conge-attrib-au")?.value||"";
  const du=document.getElementById("conge-attrib-du-accorde")?.value||"";
  const au=document.getElementById("conge-attrib-au-accorde")?.value||"";
  if(!du||!au){toast("Renseignez les dates du congé accordé","error");return}
  const jours=drhCongeDureeJours({du,au});
  if(jours<=0){toast("Période accordée invalide (date de fin avant date de début)","error");return}
  if(type==="Annuel"&&jours>congeAttribSolde){
    toast(`Impossible : ${jours} jour(s) accordé(s) dépasse le solde disponible (${congeAttribSolde.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} jour(s)). Ajustez le nombre de jours.`,"error");
    return;
  }
  const a=(db.agents||[]).find(x=>String(x.id)===String(agentId));
  if(!a){toast("Employé introuvable","error");return}
  if(employeeIsFormer(a)){toast("Congé impossible — cet employé est sortant et archivé","error");return}
  if(a.statut==="suspendu"){toast("Congé impossible — cet employé est suspendu","error");return}
  pendingCongeAttribution={agentId:a.id,type,statut:"approuve",motif,du,au,jours,duDemande:duDemande||du,auDemande:auDemande||au,savedConge:null};
  const name=((a.nom||"")+" "+(a.prenom||"")).trim();
  openModal(`<div class="text-center p-4">
    <div class="text-lg font-black mb-3">Confirmation</div>
    <div class="text-base mb-6">Un congé de <b>${jours} jour(s)</b> va être accordé à <b>${escapeHTML(name||"—")}</b>.</div>
    <div class="flex justify-center gap-3">
      <button type="button" class="btn btn-ghost" onclick="cancelCongeConfirmation('${escapeHTML(String(a.id))}')">Non</button>
      <button type="button" class="btn btn-primary" onclick="showCongeOrderPreview()">Oui</button>
    </div>
  </div>`);
}

function cancelCongeConfirmation(agentId){
  pendingCongeAttribution=null;
  openCongeAttributionModal(agentId);
}

function showCongeOrderPreview(){
  const p=pendingCongeAttribution;
  if(!p)return;
  const a=(db.agents||[]).find(x=>String(x.id)===String(p.agentId));
  if(!a){toast("Employé introuvable","error");return}
  const name=((a.nom||"")+" "+(a.prenom||"")).trim();
  openModal(`<div>
    <div class="flex items-center justify-between mb-4"><h3 class="text-lg font-black">Titre de congé — aperçu avant validation</h3><button type="button" class="btn btn-ghost" onclick="cancelCongeConfirmation('${escapeHTML(String(a.id))}')">← Retour</button></div>
    <div class="card p-5 mb-4" style="max-width:640px;margin:0 auto">
      <div class="text-center font-black text-lg uppercase mb-4" style="color:#043970">Titre de congé</div>
      <div class="grid" style="grid-template-columns:170px 1fr;gap:8px 12px;font-size:14px">
        <div class="font-bold text-slate-600">Employé</div><div>${escapeHTML(name||"—")} (${escapeHTML(a.matricule||a.code||"—")})</div>
        <div class="font-bold text-slate-600">Fonction</div><div>${escapeHTML(a.affectationCourante?.poste||a.fonction||"—")}</div>
        <div class="font-bold text-slate-600">Société</div><div>${escapeHTML(a.societe||"—")}</div>
        <div class="font-bold text-slate-600">Type de congé</div><div>${escapeHTML(p.type||"—")}</div>
        <div class="font-bold text-slate-600">Période</div><div>Du ${p.du?formatDate(p.du):"—"} au ${p.au?formatDate(p.au):"—"} (${p.jours} jour(s))</div>
        <div class="font-bold text-slate-600">Statut</div><div>${p.statut==="approuve"?"Approuvé":"En attente"}</div>
      </div>
      ${p.motif?`<div class="mt-3 p-3 rounded border border-slate-200 text-sm"><b>Motif</b><br>${escapeHTML(p.motif)}</div>`:""}
    </div>
    <div class="flex justify-center gap-3">
      <button type="button" id="conge-preview-valider" class="btn btn-primary" onclick="finalizeCongeAttribution()">✓ Valider</button>
      <button type="button" id="conge-preview-imprimer" class="btn btn-ghost" disabled onclick="printPendingCongeOrder()">🖨 Imprimer</button>
      <button type="button" class="btn btn-ghost" onclick="closeModal();renderView()">Fermer</button>
    </div>
  </div>`);
}

async function finalizeCongeAttribution(){
  const p=pendingCongeAttribution;
  if(!p)return;
  const a=(db.agents||[]).find(x=>String(x.id)===String(p.agentId));
  if(!a){toast("Employé introuvable","error");return}
  const btn=document.getElementById("conge-preview-valider");
  if(btn){btn.disabled=true;btn.textContent="Validation…"}
  const conge={id:uid("cg"),agentId:a.id,type:p.type,du:p.du,au:p.au,duDemande:p.duDemande,auDemande:p.auDemande,motif:p.motif,statut:p.statut,origine:"attribution",createdAt:today()};
  db.conges.push(conge);
  if(!(await saveDBAndWaitToast("Congé non confirmé"))){
    db.conges.pop();
    if(btn){btn.disabled=false;btn.textContent="✓ Valider"}
    return;
  }
  notifyPortalCongeAttribution(a,conge);
  p.savedConge=conge;
  toast("Congé attribué","success");
  if(btn)btn.remove();
  const printBtn=document.getElementById("conge-preview-imprimer");
  if(printBtn)printBtn.disabled=false;
  renderView();
}

function printPendingCongeOrder(){
  const conge=pendingCongeAttribution?.savedConge;
  if(!conge){toast("Validez d'abord le congé","error");return}
  printCongeOrder(conge.id);
}
SGDIModules.registerModule({key:"leaves",routes:[]});
