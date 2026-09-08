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

function renderCongesModule(view,isDrh){
  const soc=isDrh?drhActiveSocieteFilter():(effectifSocieteFilter&&effectifSocieteFilter());
  const canAttribuer=congesModuleCanAttribuer(isDrh);
  const agents=congesModuleScopeAgents(isDrh).slice().sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||""))||String(a.prenom||"").localeCompare(String(b.prenom||"")));
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
    const rowAction=canAttribuer?`openCongeAttributionModal('${escapeHTML(String(a.id))}')`:`openCongeModal('${escapeHTML(String(a.id))}')`;
    balances.push({a,name,code,recruited,contractEnd,entitlement,pris,solde,soldeEleve});
    return `<tr data-searchable data-q="${escapeHTML(q)}" data-solde-eleve="${soldeEleve?"1":"0"}" class="drh-conge-row${hasTaken?" drh-conge-row-taken":""}" onclick="if(!event.target.closest('a,button'))${rowAction}"><td class="font-semibold"><div class="cg-person"><span class="cg-avatar">${congeAvatarInitials(name)}</span><a href="#/agents/${employeeRouteId(a)}" class="hover:underline">${escapeHTML(name||"—")}</a>${suspended?` <span class="pill pill-red">Suspendu</span>`:""}</div></td><td class="font-mono font-bold text-amber-700">${escapeHTML(code||"—")}</td><td class="text-xs">${recruited?formatDate(recruited):"—"}</td><td class="text-xs">${contractEnd?formatDate(contractEnd):"—"}</td><td class="font-black" style="color:#043970">${entitlement===null?"—":entitlement.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" jours"}</td><td class="font-black text-amber-700">${pris.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})} jours</td><td class="font-black ${soldeEleve?"text-amber-700":""}">${solde===null?"—":solde.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" jours"}${soldeEleve?" ⚠":""}</td><td><button type="button" class="btn ${canAttribuer?"btn-primary":"btn-ghost"} text-xs" onclick="event.stopPropagation();${rowAction}">${canAttribuer?"Attribuer":"Demander"}</button></td></tr>`;
  }).join("");
  const tab=drhCongesDashboardTab();
  const scopedIds=new Set(agents.map(a=>String(a.id)));
  const conges=(db.conges||[]).filter(c=>c.type!=="Maladie"&&scopedIds.has(String(c.agentId)));
  const enCours=conges.filter(c=>c.statut==="approuve"&&c.du<=today()&&(!c.au||c.au>=today()));
  const pending=conges.filter(c=>c.statut==="en_attente");
  const priority=balances.filter(x=>x.soldeEleve).sort((a,b)=>(b.solde||0)-(a.solde||0)).slice(0,4);
  const latest=conges.slice().sort((a,b)=>String(b.createdAt||b.du||"").localeCompare(String(a.createdAt||a.du||"")));
  const history=latest.filter(c=>["approuve","refuse"].includes(c.statut));
  const tabButton=(key,label,count)=>`<button type="button" class="drh-leave-tab${tab===key?" is-active":""}" onclick="setDrhCongesDashboardTab('${key}')">${label}${count?` <b>${count}</b>`:""}</button>`;
  const requestRows=pending.map(c=>{const a=agents.find(x=>String(x.id)===String(c.agentId));return`<tr><td class="font-semibold"><div class="cg-person"><span class="cg-avatar">${congeAvatarInitials(drhCongeAgentName(c))}</span>${escapeHTML(drhCongeAgentName(c))}</div></td><td>${escapeHTML(c.type||"Congé")}</td><td>${formatDate(c.du)} — ${formatDate(c.au)}</td><td>${drhCongeDureeJours(c)} j</td><td>${congeOrigineBadgeHTML(c)}</td><td class="flex gap-1"><button class="btn btn-success text-xs" onclick="approuverConge('${c.id}')">Valider</button><button class="btn btn-danger text-xs" onclick="refuserConge('${c.id}')">Refuser</button>${a?`<a class="btn btn-ghost text-xs" href="#/agents/${employeeRouteId(a)}">Ouvrir</a>`:""}</td></tr>`}).join("");
  const historyRows=history.map(c=>`<tr><td class="font-semibold"><div class="cg-person"><span class="cg-avatar">${congeAvatarInitials(drhCongeAgentName(c))}</span>${escapeHTML(drhCongeAgentName(c))}</div></td><td>${escapeHTML(c.type||"Congé")}</td><td>${formatDate(c.du)} — ${formatDate(c.au)}</td><td>${drhCongeStatutBadgeHTML(c.statut)}</td><td>${congeOrigineBadgeHTML(c)}</td><td>${drhCongeDureeJours(c)} j</td></tr>`).join("");
  const weekStart=new Date();weekStart.setHours(0,0,0,0);weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));
  const weekDays=Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(d.getDate()+i);const iso=d.toISOString().slice(0,10);const dayLeaves=conges.filter(c=>c.statut==="approuve"&&c.du<=iso&&(!c.au||c.au>=iso));return{d,iso,items:dayLeaves}});
  const consumed=balances.reduce((sum,x)=>sum+x.pris,0),allocated=balances.reduce((sum,x)=>sum+(x.entitlement||0),0),planned=conges.filter(c=>c.statut==="approuve"&&c.du>today()).reduce((sum,c)=>sum+drhCongeDureeJours(c),0);
  const pct=(n,d)=>d?Math.min(100,Math.round(n/d*100)):0;
  const health=Math.max(0,100-Math.round((pending.length*3+soldeEleveCount)*100/Math.max(agents.length*2,1)));
  const queue=[...pending.slice(0,3).map(c=>({kind:"Demande",name:drhCongeAgentName(c),meta:`${formatDate(c.du)} — ${formatDate(c.au)}`,action:`setDrhCongesDashboardTab('requests')`})),...priority.slice(0,3).map(x=>({kind:"Solde élevé",name:x.name,meta:`${Number(x.solde||0).toLocaleString("fr-FR",{maximumFractionDigits:2})} jours disponibles`,action:canAttribuer?`openCongeAttributionModal('${escapeHTML(String(x.a.id))}')`:`openCongeModal('${escapeHTML(String(x.a.id))}')`}))].slice(0,5);
  const dashboard=`<section class="leave-modern-grid"><article class="leave-modern-card leave-week-card"><header><div><h3>Planning de la semaine</h3><p>Présences et absences approuvées</p></div><button onclick="setDrhCongesDashboardTab('planning')">Ouvrir le planning →</button></header><div class="leave-week-strip">${weekDays.map(x=>`<button class="${x.iso===today()?"today":""}" onclick="setDrhCongesDashboardTab('planning')"><span>${x.d.toLocaleDateString("fr-FR",{weekday:"short"})}</span><b>${x.d.getDate()}</b><em>${x.items.length} absent${x.items.length>1?"s":""}</em></button>`).join("")}</div></article>
    <article class="leave-modern-card leave-actions"><header><div><h3>À faire maintenant</h3><p>Priorités calculées automatiquement</p></div></header>${queue.length?queue.slice(0,3).map((x,i)=>`<button onclick="${x.action}"><i>${i+1}</i><span><b>${escapeHTML(x.kind)} · ${escapeHTML(x.name)}</b><small>${escapeHTML(x.meta)}</small></span><em>Ouvrir</em></button>`).join(""):`<div class="drh-leave-empty">Aucune action urgente.</div>`}</article></section>
    <section class="leave-modern-grid lower"><article class="leave-modern-card"><header><div><h3>File de traitement intelligente</h3><p>Demandes et soldes classés par priorité</p></div><button onclick="setDrhCongesDashboardTab('requests')">Tout afficher →</button></header><div class="leave-queue">${queue.length?queue.map(x=>`<button onclick="${x.action}"><span class="leave-dot"></span><strong>${escapeHTML(x.name)}</strong><small>${escapeHTML(x.kind)} · ${escapeHTML(x.meta)}</small><em>›</em></button>`).join(""):`<div class="drh-leave-empty">La file est à jour.</div>`}</div></article>
    <article class="leave-modern-card"><header><div><h3>Allocation annuelle</h3><p>Consommation réelle des droits acquis</p></div></header><div class="leave-bars"><label><span>Droits acquis <b>${allocated.toLocaleString("fr-FR",{maximumFractionDigits:1})} j</b></span><i><em style="width:100%"></em></i></label><label><span>Congés consommés <b>${consumed.toLocaleString("fr-FR",{maximumFractionDigits:1})} j</b></span><i><em class="blue" style="width:${pct(consumed,allocated)}%"></em></i></label><label><span>Congés planifiés <b>${planned.toLocaleString("fr-FR",{maximumFractionDigits:1})} j</b></span><i><em class="amber" style="width:${pct(planned,allocated)}%"></em></i></label></div></article></section>`;
  const balancesView=`${soldeEleveCount?`<button type="button" class="drh-leave-balance-alert" onclick="toggleDrhCongesSoldeEleve()"><b>${soldeEleveCount} employé(s) avec un solde élevé non pris</b><span>Congés à planifier avant une nouvelle accumulation.</span></button>`:""}<div class="card p-4 mb-4"><input id="drh-conges-search" class="input" type="search" placeholder="Rechercher par nom, prénom ou code..." oninput="filterDrhCongesPersonnel(this.value)"/></div><div id="drh-conges-personnel" class="card overflow-x-auto"><table><thead><tr><th>NOM PRÉNOM</th><th>CODE</th><th>DATE DE RECRUTEMENT</th><th>DATE DE FIN DE CONTRAT</th><th>DROIT CONGÉ</th><th>CONGÉ CONSOMMÉ</th><th>SOLDE RESTANT</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="8" class="text-center text-slate-500 p-8">Aucun personnel enregistré.</td></tr>`}</tbody></table></div>`;
  const tableView=(title,subtitle,thead,body,empty,extra)=>`<section class="card drh-leave-panel"><header><div><h3>${title}</h3><p>${subtitle}</p></div>${extra||""}</header><div class="overflow-x-auto"><table><thead>${thead}</thead><tbody>${body||`<tr><td colspan="6" class="text-center text-slate-500 p-8">${empty}</td></tr>`}</tbody></table></div></section>`;
  let content=dashboard;
  if(tab==="balances")content=balancesView;
  else if(tab==="planning")content=`<section class="card drh-leave-panel drh-leave-planning-full"><header><div><h3>Planning mensuel</h3><p>Visualisation des congés approuvés et de la couverture du personnel</p></div>${canAttribuer?`<button class="btn btn-primary" onclick="openCongeAttributionPicker()">+ Planifier</button>`:`<button class="btn btn-primary" onclick="openCongeModal()">+ Nouvelle demande</button>`}</header>${drhCongesDashboardCalendar(conges)}<div class="drh-leave-planning-list">${conges.filter(c=>c.statut==="approuve"&&String(c.du||"").slice(0,7)===today().slice(0,7)).sort((a,b)=>String(a.du).localeCompare(String(b.du))).map(c=>`<div><strong>${escapeHTML(drhCongeAgentName(c))}</strong><span>${formatDate(c.du)} — ${formatDate(c.au)}</span><b>${drhCongeDureeJours(c)} j</b></div>`).join("")||`<div class="drh-leave-empty">Aucun congé approuvé ce mois-ci.</div>`}</div></section>`;
  else if(tab==="requests")content=tableView("Demandes à traiter","Validation, refus et contrôle du solde — auto-demandes et attributions réunies","<tr><th>EMPLOYÉ</th><th>TYPE</th><th>PÉRIODE</th><th>DURÉE</th><th>ORIGINE</th><th>ACTIONS</th></tr>",requestRows,"Aucune demande en attente.",canAttribuer?`<button type="button" class="btn btn-primary text-xs" onclick="openCongeAttributionPicker()">+ Attribuer un congé</button>`:`<button type="button" class="btn btn-primary text-xs" onclick="openCongeModal()">+ Nouvelle demande</button>`);
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
        ${canAttribuer?`<button type="button" class="ops-dash-refresh" onclick="exportCongesRecapCSV()">⇩ Exporter</button>`:""}
        <button type="button" class="ops-dash-refresh" onclick="setDrhCongesDashboardTab('planning')">▦ Planning</button>
        ${canAttribuer?`<button type="button" class="ops-dash-refresh" style="background:#fff;color:#043970" onclick="openCongeAttributionPicker()">+ Attribuer un congé</button>`:""}
        <button type="button" class="ops-dash-refresh" style="background:#fff;color:#043970" onclick="openCongeModal()">+ Nouvelle demande</button>
      </div>`;
  view.innerHTML=`<div class="drh-leave-page is-dashboard">
    <div class="ops-dash-hero"><div class="ops-dash-hero-row">
      <div><div class="ops-dash-eyebrow">${heroLabel}</div><h1>Congés &amp; planification</h1><div class="ops-dash-hero-sub"><span>${soc?escapeHTML(isDrh?drhSocieteLabel(soc):soc):"Toutes sociétés"} · ${pending.length} demande(s) en attente · ${enCours.length} en congé aujourd'hui</span></div></div>
      ${heroActions}
    </div></div>
    <div class="ops-dash-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="ops-dash-kpi" style="cursor:pointer" onclick="setDrhCongesDashboardTab('requests')"><div class="ops-dash-lbl">Demandes en attente</div><div class="ops-dash-val">${pending.length}</div><div class="ops-dash-sub">${pending.length?"Décisions requises":"File à jour"}</div></div>
      <div class="ops-dash-kpi" style="cursor:pointer" onclick="setDrhCongesDashboardTab('balances')"><div class="ops-dash-lbl">Soldes prioritaires</div><div class="ops-dash-val">${soldeEleveCount}</div><div class="ops-dash-sub">Seuil ${DRH_CONGE_SOLDE_ELEVE_SEUIL} jours</div></div>
      <div class="ops-dash-kpi" style="cursor:pointer" onclick="setDrhCongesDashboardTab('planning')"><div class="ops-dash-lbl">En congé aujourd'hui</div><div class="ops-dash-val">${enCours.length}</div><div class="ops-dash-sub">Absences planifiées</div></div>
      <div class="ops-dash-kpi" style="cursor:pointer" onclick="setDrhCongesDashboardTab('dashboard')"><div class="ops-dash-lbl">Santé du planning</div><div class="ops-dash-val">${health}%</div><div class="ops-dash-sub">${pending.length} demande(s) · ${soldeEleveCount} solde(s) élevé(s)</div></div>
    </div>
    <nav class="drh-leave-tabs">${tabButton("dashboard","Tableau de bord")}${tabButton("balances","Soldes",soldeEleveCount)}${tabButton("requests","Demandes",pending.length)}${tabButton("planning","Planning")}${tabButton("documents","Documents")}</nav>
    ${content}
  </div>`;
}

function toggleDrhCongesSoldeEleve(){
  drhCongesSoldeEleveOnly=!drhCongesSoldeEleveOnly;
  filterDrhCongesPersonnel(document.getElementById("drh-conges-search")?.value||"");
}

function exportCongesRecapCSV(){
  const soc=drhActiveSocieteFilter();
  const agents=drhAgentsList().slice().sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||"")));
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
  // Point d'entrée générique (bouton "+ Attribuer un congé" du bandeau, "+ Planifier" du
  // planning) : on choisit d'abord l'employé, puis on enchaîne sur le même parcours complet
  // (solde, couverture site, confirmation, aperçu, impression) que le clic sur une ligne du
  // tableau "Soldes individuels" — pour ne pas avoir deux façons différentes d'attribuer un
  // congé, l'une contrôlée et l'autre non.
  const agents=drhAgentsList().slice().sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||""))||String(a.prenom||"").localeCompare(String(b.prenom||"")));
  openModal(`<h3 class="font-bold text-lg mb-4">Attribuer un congé</h3>
    <div class="mb-3"><label class="label">Employé</label><select class="select" id="conge-picker-agent">
      <option value="">— Choisir un employé —</option>
      ${agents.map(a=>`<option value="${escapeHTML(String(a.id))}">${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())} · ${escapeHTML(a.matricule||a.code||"")}</option>`).join("")}
    </select></div>
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button type="button" class="btn btn-primary" onclick="const id=document.getElementById('conge-picker-agent').value;if(!id){toast('Choisissez un employé','error');return}openCongeAttributionModal(id)">Continuer</button></div>`);
}

function openCongeAttributionModal(agentId){
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
