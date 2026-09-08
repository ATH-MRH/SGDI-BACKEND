/* Phase 2 — contracts. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function renderAvenants(view){
  const socFilter=currentStructureSocieteFilter();
  const list=(db.avenants||[]).filter(av=>{
    if(!socFilter)return true;
    const a=(db.agents||[]).find(x=>x.id===av.agentId);
    return a&&a.societe===socFilter;
  }).sort((a,b)=>String(b.dateAvenant||b.createdAt||"").localeCompare(String(a.dateAvenant||a.createdAt||"")));
  const enCours=list.filter(a=>a.statut==="brouillon").length;
  const signes=list.filter(a=>a.statut==="signe").length;
  view.innerHTML=`<div class="flex justify-between items-start gap-3 mb-4">
    <div><h1 class="text-2xl font-bold">Avenants au contrat</h1><p class="text-sm text-slate-500">Gestion des modifications contractuelles du personnel${socFilter?` · <span class="font-semibold text-amber-700">${escapeHTML(socFilter)}</span>`:""}.</p></div>
    <button class="btn avenant-create-btn" onclick="openAvenantModal('general')">Nouvel avenant</button>
  </div>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Total avenants</div><div class="text-3xl font-black text-sky-700">${list.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Brouillons</div><div class="text-3xl font-black text-amber-700">${enCours}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Signés</div><div class="text-3xl font-black text-emerald-700">${signes}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Ce mois</div><div class="text-3xl font-black text-indigo-700">${list.filter(x=>(x.dateAvenant||"").slice(0,7)===today().slice(0,7)).length}</div></div>
  </div>
  <div class="card overflow-hidden"><table>
    <thead><tr><th>N°</th><th>Employé</th><th>Type</th><th>Date</th><th>Effet</th><th>Objet</th><th>Statut</th><th></th></tr></thead>
    <tbody>${list.length===0?`<tr><td colspan="10" class="text-center text-slate-500 p-6">Aucun avenant enregistré.</td></tr>`:list.map(av=>{const a=db.agents.find(x=>x.id===av.agentId);const st=av.statut==="signe"?"pill-green":av.statut==="annule"?"pill-red":"pill-amber";return`<tr data-searchable onclick="previewAvenant('${av.id}')" class="cursor-pointer hover:bg-slate-50"><td class="font-mono font-bold">${escapeHTML(av.numero||"—")}</td><td>${a?`<a class="font-semibold hover:underline" href="#/effectif/agent/${a.id}" onclick="event.stopPropagation()">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</a><div class="text-[10px] text-slate-500">${escapeHTML(a.matricule||"")} · ${escapeHTML(a.societe||"")}</div>`:"—"}</td><td><span class="pill pill-blue">${escapeHTML(av.type||"—")}</span></td><td class="text-xs">${formatDate(av.dateAvenant)}</td><td class="text-xs">${formatDate(av.dateEffet)}</td><td class="text-xs">${escapeHTML((av.objet||"").slice(0,60))}</td><td><span class="pill ${st}">${escapeHTML(av.statut||"brouillon")}</span></td><td class="text-right"><button class="btn btn-ghost text-xs" onclick="event.stopPropagation();previewAvenant('${av.id}')">Aperçu</button>${av.statut!=="signe"?`<button class="btn btn-success text-xs" onclick="event.stopPropagation();signerAvenant('${av.id}')">Signer</button>`:""}${av.statut!=="annule"?`<button class="btn btn-danger text-xs" onclick="event.stopPropagation();annulerAvenant('${av.id}')">Annuler</button>`:""}</td></tr>`}).join("")}</tbody>
  </table></div>`;
}

function appliquerAvenantAgent(av){
  const a=db.agents.find(x=>x.id===av.agentId);if(!a)return;
  if((av.type==="Changement date de contrat"||av.type==="Prolongation CDD")&&av.nouvelleDateContrat){
    av.ancienneDateContrat=av.ancienneDateContrat||employeePositionContractEndDate(a)||"";
    a.dateFinContrat=av.nouvelleDateContrat;
    a.updatedAt=today();
  }
  if((av.type==="Modification salaire"||av.type==="Nouveau salaire")&&av.nouvelleValeur){
    a.salaireNet=parseMoneyInput(av.nouvelleValeur)||a.salaireNet;
    a.updatedAt=today();
  }
}

async function signerAvenant(id){
  const av=(db.avenants||[]).find(x=>x.id===id);if(!av)return;
  try{
    await sgdiRunLegacyAction("set-status",{collection:"avenants",item_id:id,data:{statut:"signe"}});
    appliquerAvenantAgent(av);
    await sgdiPullState({silent:true});
    toast("Avenant signé par le backend","success");
    renderView();
  }catch(e){toast("Signature refusée : "+(e.message||e),"error")}
}

async function annulerAvenant(id){
  const av=(db.avenants||[]).find(x=>x.id===id);if(!av)return;
  if(!confirm("Annuler cet avenant ?"))return;
  try{
    await sgdiRunLegacyAction("set-status",{collection:"avenants",item_id:id,data:{statut:"annule"}});
    await sgdiPullState({silent:true});
    toast("Avenant annulé par le backend","success");
    renderView();
  }catch(e){toast("Annulation refusée : "+(e.message||e),"error")}
}

function avenantHTML(av){
  const a=db.agents.find(x=>x.id===av.agentId)||{};
  return`<div style="font-family:Arial,sans-serif;color:#111;background:#fff;padding:28px;max-width:850px;margin:auto">
    <div style="display:flex;justify-content:space-between;border-bottom:3px solid #111;padding-bottom:12px;margin-bottom:18px"><div><div style="font-size:24px;font-weight:900;text-transform:uppercase">Avenant au contrat de travail</div><div style="font-size:12px;color:#555">N° ${escapeHTML(av.numero||"")}</div></div><div style="text-align:right;font-weight:700">${escapeHTML(a.societe||"SGDI")}<div style="font-size:12px;font-weight:400;color:#555">Date : ${formatDate(av.dateAvenant)}</div></div></div>
    <p>Entre la société <b>${escapeHTML(a.societe||"")}</b> et l'employé(e) <b>${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</b>, matricule <b>${escapeHTML(a.matricule||"")}</b>, il est convenu le présent avenant.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0"><tr><td style="border:1px solid #333;padding:8px;background:#f1f5f9;font-weight:bold">Type</td><td style="border:1px solid #333;padding:8px">${escapeHTML(av.type||"")}</td></tr><tr><td style="border:1px solid #333;padding:8px;background:#f1f5f9;font-weight:bold">Date d'effet</td><td style="border:1px solid #333;padding:8px">${formatDate(av.dateEffet)}</td></tr><tr><td style="border:1px solid #333;padding:8px;background:#f1f5f9;font-weight:bold">Objet</td><td style="border:1px solid #333;padding:8px">${escapeHTML(av.objet||"")}</td></tr><tr><td style="border:1px solid #333;padding:8px;background:#f1f5f9;font-weight:bold">Ancienne situation</td><td style="border:1px solid #333;padding:8px">${escapeHTML(av.ancienneValeur||"—")}</td></tr><tr><td style="border:1px solid #333;padding:8px;background:#f1f5f9;font-weight:bold">Nouvelle situation</td><td style="border:1px solid #333;padding:8px">${escapeHTML(av.nouvelleValeur||"—")}</td></tr>${av.ancienneDateContrat||av.nouvelleDateContrat?`<tr><td style="border:1px solid #333;padding:8px;background:#f1f5f9;font-weight:bold">Ancienne date fin contrat</td><td style="border:1px solid #333;padding:8px">${formatDate(av.ancienneDateContrat)}</td></tr><tr><td style="border:1px solid #333;padding:8px;background:#f1f5f9;font-weight:bold">Nouvelle date fin contrat</td><td style="border:1px solid #333;padding:8px">${formatDate(av.nouvelleDateContrat)}</td></tr>`:""}</table>
    <h3 style="font-size:14px;text-transform:uppercase;border-bottom:1px solid #333;padding-bottom:5px">Clauses particulières</h3><div style="white-space:pre-wrap;font-size:13px;line-height:1.6">${escapeHTML(av.details||"Les autres clauses du contrat initial demeurent inchangées.")}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:50px;font-size:12px"><div>Signature employeur<br><br><br>________________________</div><div>Signature employé(e)<br><br><br>________________________</div></div>
  </div>`;
}

function previewAvenant(id){const av=(db.avenants||[]).find(x=>x.id===id);if(!av)return;openModal(`<div style="max-height:82vh;overflow:auto;background:#fff">${avenantHTML(av)}</div><div class="flex justify-end gap-2 mt-3"><button class="btn btn-ghost" onclick="closeModal()">Fermer</button><button class="btn btn-primary" onclick="printAvenant('${id}')">Imprimer</button></div>`)}

function printAvenant(id){const av=(db.avenants||[]).find(x=>x.id===id);if(!av)return;const a=db.agents.find(x=>x.id===av.agentId)||{};const w=window.open("","_blank","width=900,height=700");if(!w){toast("Fenêtre d'impression bloquée par le navigateur","error");return}const html=`<!doctype html><html><head><title>${escapeHTML(av.numero||"Avenant")}</title></head><body><main>${avenantHTML(av)}</main></body></html>`;w.document.write(prepareEmployeeDocumentForValidation(html,{agentId:a.id,title:"Avenant",category:"Avenants",type:"avenant",reference:av.numero||"",date:av.dateAvenant||today()},"Valider avenant"));w.document.close()}

function contractsToEstablishCandidates(){
  const soc=currentStructureSocieteFilter();
  return (db.candidats||[]).filter(c=>String(c.statut||c.status||"").toLowerCase()==="a_contractualiser"&&candidateAvisValue(c.avisDecision)==="Favorable"&&(!soc||c.societe===soc));
}

function renderContractsToEstablish(view){
  const candidates=contractsToEstablishCandidates();
  view.innerHTML=`<div class="mb-4 flex items-center justify-between gap-3 flex-wrap"><div><h1 class="text-2xl font-black uppercase">Contrats à établir</h1><p class="text-sm text-slate-500">Dossiers transmis par Recrutement. Aucun employé n'est créé avant validation du premier contrat.</p></div><span class="pill pill-amber">${candidates.length} en attente</span></div>
  <div class="card overflow-hidden"><table class="table"><thead><tr><th>Candidat</th><th>Poste</th><th>Société</th><th>Téléphone</th><th>Transmission</th><th>Action</th></tr></thead><tbody>${candidates.length?candidates.map(c=>`<tr><td><b>${escapeHTML((c.nom||"")+" "+(c.prenom||""))}</b></td><td>${escapeHTML(c.posteSouhaite||c.posteContrat||"À compléter")}</td><td>${escapeHTML(c.societe||"À compléter")}</td><td>${escapeHTML(c.telephone||"—")}</td><td>${escapeHTML(formatDate(c.contractualisationAt||c.updatedAt||c.createdAt||today()))}</td><td><div class="flex gap-2 flex-wrap"><button class="btn btn-primary" onclick="navigate('contrats/a_contractualiser/${jsString(c.id)}')">Établir le contrat</button><button class="btn btn-ghost text-red-600" onclick="openArchiveContractCandidateModal('${jsString(c.id)}')">Archiver</button></div></td></tr>`).join(""):`<tr><td colspan="6" class="p-10 text-center text-slate-400">Aucun contrat à établir.</td></tr>`}</tbody></table></div>`;
}

function exportContratsCSV(){
  const soc=currentStructureSocieteFilter();
  const rows=[["Employé","Code","Société","Type","Date de recrutement","Fin de période d'essai","Fin de contrat","Salaire net","Statut"]];
  (db.agents||[]).filter(a=>!employeeIsFormer(a)&&(!soc||a.societe===soc)).forEach(a=>rows.push([
    `${a.nom||""} ${a.prenom||""}`.trim(),
    normalizeEmployeeCodeFormat(a.matricule||a.code||""),
    a.societe||"",
    cleanContractType(a.typeContrat)||"",
    a.dateRecrutement||"",
    a.dateFinEssai||"",
    employeePositionContractEndDate(a)||"",
    Number(a.salaireNet)||0,
    a.statut||""
  ]));
  paieDownloadCSV(rows,`contrats-${today()}${soc?"-"+soc.replace(/\s+/g,"_").toLowerCase():""}.csv`);
  toast("Export des contrats téléchargé","success");
}

function renderContratsDashboard(view){
  const socFilter=currentStructureSocieteFilter();
  const agents=(db.agents||[]).filter(a=>!employeeIsFormer(a)&&(!socFilter||a.societe===socFilter));
  const activeAgentIds=new Set(agents.map(a=>String(a.id)));
  const avenants=(db.avenants||[]).filter(av=>activeAgentIds.has(String(av.agentId)));
  const today_=today();
  const cdi=agents.filter(a=>cleanContractType(a.typeContrat)==="CDI").length;
  const cdd=agents.filter(a=>cleanContractType(a.typeContrat)==="CDD").length;
  const essaiEnCours=agents.filter(a=>{if(!a.dateFinEssai)return false;return daysBetween(today_,a.dateFinEssai)>=0}).length;
  const essai30=agents.filter(a=>{if(!a.dateFinEssai)return false;const d=daysBetween(today_,a.dateFinEssai);return d>=0&&d<=30}).length;
  const cddExpire=agents.filter(a=>{const end=employeePositionContractEndDate(a);return cleanContractType(a.typeContrat)==="CDD"&&end&&daysBetween(today_,end)<0}).length;
  const cdd30=agents.filter(a=>{const end=employeePositionContractEndDate(a);if(cleanContractType(a.typeContrat)!=="CDD"||!end)return false;const d=daysBetween(today_,end);return d>=0&&d<=30}).length;
  const pendingCandidates=contractsToEstablishCandidates();
  const compliant=Math.max(0,agents.length-cddExpire);
  const healthPercent=agents.length?Math.round(compliant/agents.length*100):100;
  const healthLabel=healthPercent>=90?"Bonne":healthPercent>=75?"À surveiller":"Critique";
  const upcomingContracts=agents.map(a=>({agent:a,type:"CDD",date:employeePositionContractEndDate(a),days:employeePositionContractDaysLeft(a,today_)})).filter(x=>cleanContractType(x.agent.typeContrat)==="CDD"&&x.date&&x.days>=0&&x.days<=90);
  const upcomingTrials=agents.map(a=>({agent:a,type:"Essai",date:a.dateFinEssai,days:a.dateFinEssai?daysBetween(today_,a.dateFinEssai):null})).filter(x=>x.date&&x.days>=0&&x.days<=90);
  const deadlines=[...upcomingContracts,...upcomingTrials].sort((a,b)=>a.days-b.days);
  const timeline=[{agent:null,type:"Actifs",date:today_,days:0},...deadlines.slice(0,3)];
  while(timeline.length<4)timeline.push({agent:null,type:"Aucune échéance",date:"",days:null});
  const priority=[];
  pendingCandidates.slice(0,2).forEach(c=>priority.push({kind:"pending",candidate:c,title:"Établir le premier contrat",name:`${c.nom||""} ${c.prenom||""}`.trim(),meta:c.posteSouhaite||c.posteContrat||"Poste à compléter",tag:"À établir",color:"#d97706"}));
  deadlines.slice(0,Math.max(0,4-priority.length)).forEach(x=>priority.push({kind:x.type==="Essai"?"trial":"renew",agent:x.agent,title:x.type==="Essai"?"Évaluer la période d’essai":"Décider le renouvellement",name:`${x.agent.nom||""} ${x.agent.prenom||""}`.trim(),meta:`${x.type} · ${formatDate(x.date)}`,tag:x.days===0?"Aujourd’hui":`J-${x.days}`,color:x.days<=15?"#dc2626":x.type==="Essai"?"#7c3aed":"#d97706"}));
  const society=escapeHTML(socFilter||currentStructureSocieteFilter()||"Toutes les sociétés");
  const deadlineMilestone=x=>{const has=x.agent;const name=has?escapeHTML(`${x.agent.nom||""} ${x.agent.prenom||""}`.trim()):x.type==="Actifs"?"Aujourd’hui":"Aucune échéance";const dot=!has?"#16a34a":x.days<=15?"#ef4444":"#f59e0b";return `<div class="contract-modern-milestone" style="--dot:${dot}"><b>${name}</b><span>${x.date?formatDate(x.date):"—"}${has?` · ${escapeHTML(x.type)}`:""}</span><small>${x.type==="Actifs"?`${agents.length} actifs`:x.days===null?"RAS":x.days===0?"Aujourd’hui":`J-${x.days}`}</small></div>`};
  const priorityRow=p=>`<div class="contract-modern-focus-row" style="--focus:${p.color}" onclick="${p.kind==="pending"?`navigate('contrats/a_contractualiser/${jsString(p.candidate.id)}')`:`navigate('effectif/agent/${jsString(p.agent.id)}')`}"><i class="contract-modern-focus-dot"></i><div><b>${escapeHTML(p.title)}</b><span>${escapeHTML(p.name)}</span></div><em>${escapeHTML(p.tag)}</em></div>`;
  const taskRow=p=>{const initials=String(p.name||"?").split(/\s+/).slice(0,2).map(v=>v[0]||"").join("").toUpperCase();return `<div class="contract-modern-task"><div class="contract-modern-initial">${escapeHTML(initials)}</div><div><b>${escapeHTML(p.name)}</b><small>${escapeHTML(p.meta)}</small></div><span>${escapeHTML(p.title)}</span><span class="contract-modern-tag" style="--tag:${p.color}">${escapeHTML(p.tag)}</span><button class="contract-modern-open" onclick="event.stopPropagation();${p.kind==="pending"?`navigate('contrats/a_contractualiser/${jsString(p.candidate.id)}')`:`navigate('effectif/agent/${jsString(p.agent.id)}')`}">Ouvrir</button></div>`};
  view.innerHTML=`<div class="contract-modern-dashboard"><div class="contract-modern-layout">
    <div class="contract-modern-work"><header class="contract-modern-header"><div><div class="contract-modern-heading">Contrats</div><div class="contract-modern-sub">${society} · Direction des ressources humaines</div></div><div class="contract-modern-head-actions"><button class="active" onclick="navigate('contrats/dashboard')">Tableau de bord</button><button onclick="navigate('contrats/a_contractualiser')">À établir</button><button onclick="setContratQuickFilter('all')">Contrats actifs</button><button onclick="setContratQuickFilter('alert90')">Échéances</button><button onclick="navigate('contrats/avenants')">Avenants</button><button onclick="navigate('effectif/archives_sortants')">Archives</button><button onclick="navigate('drh/dashboard')">Retour DRH</button><button onclick="exportContratsCSV()">Exporter</button><button class="primary" onclick="openEmployeeNewContractModal()">+ Créer un contrat</button></div></header>
    <main class="contract-modern-content"><div class="contract-modern-welcome" style="justify-content:flex-end"><div class="contract-modern-period"><button onclick="setContratQuickFilter('cdd30')">30 jours</button><button class="active" onclick="setContratQuickFilter('alert90')">90 jours</button><button onclick="setContratQuickFilter('all')">Tous</button></div></div>
    <section class="contract-modern-overview"><div class="contract-modern-health"><div><div class="contract-modern-health-label">Santé contractuelle</div><strong>${healthLabel}</strong><small>${compliant} dossier(s) conforme(s) sur ${agents.length}</small></div><div class="contract-modern-ring" style="background:conic-gradient(#5ee6a8 0 ${healthPercent}%,rgba(255,255,255,.18) ${healthPercent}%)"><b>${healthPercent}%</b></div></div>
      <button class="contract-modern-stat ${pendingCandidates.length>0?"contract-modern-stat-alert":""}" style="--tone:${pendingCandidates.length>0?"#dc2626":"#d97706"}" onclick="navigate('contrats/a_contractualiser')"><div class="contract-modern-stat-top"><div class="contract-modern-stat-icon">＋</div><div class="contract-modern-stat-delta">Recrutement → DRH</div></div><strong>${pendingCandidates.length}</strong><span>Contrats à établir</span></button>
      <button class="contract-modern-stat" style="--tone:#dc2626" onclick="setContratQuickFilter('cdd30')"><div class="contract-modern-stat-top"><div class="contract-modern-stat-icon">!</div><div class="contract-modern-stat-delta">Avant 30 jours</div></div><strong>${cdd30}</strong><span>Échéances urgentes</span></button>
      <button class="contract-modern-stat" style="--tone:#7c3aed" onclick="setContratQuickFilter('essai')"><div class="contract-modern-stat-top"><div class="contract-modern-stat-icon">◷</div><div class="contract-modern-stat-delta">${essai30} à évaluer</div></div><strong>${essaiEnCours}</strong><span>Essais en cours</span></button>
    </section>
    <section class="contract-modern-main-grid"><div class="contract-modern-surface"><div class="contract-modern-surface-head"><h2>Échéances des 90 prochains jours</h2><button onclick="setContratQuickFilter('alert90')">Ouvrir la liste →</button></div><div class="contract-modern-timeline"><div class="contract-modern-timeline-line"></div><div class="contract-modern-timeline-items">${timeline.map(deadlineMilestone).join("")}</div></div></div>
      <div class="contract-modern-surface"><div class="contract-modern-surface-head"><h2>À faire maintenant</h2><button onclick="setContratQuickFilter('alert90')">Tout voir →</button></div><div class="contract-modern-focus">${priority.slice(0,3).map(priorityRow).join("")||'<div class="text-xs text-slate-400 p-4">Aucune action prioritaire.</div>'}</div></div></section>
    <section class="contract-modern-lower"><div class="contract-modern-surface"><div class="contract-modern-surface-head"><h2>File de traitement intelligente</h2><button onclick="setContratQuickFilter('alert90')">Voir tous les dossiers →</button></div><div class="contract-modern-task-list">${priority.map(taskRow).join("")||'<div class="text-xs text-slate-400 p-4">Aucun dossier à traiter.</div>'}</div></div>
      <div class="contract-modern-surface"><div class="contract-modern-surface-head"><h2>Portefeuille actif</h2><button onclick="openContractPortfolioStats()">Statistiques →</button></div><div class="contract-modern-bars"><div><div class="contract-modern-bar-head"><span>CDD</span><b>${cdd}</b></div><div class="contract-modern-bar-base"><div class="contract-modern-bar-value" style="--fill:#0d6ecc;width:${agents.length?Math.round(cdd/agents.length*100):0}%"></div></div></div><div><div class="contract-modern-bar-head"><span>CDI</span><b>${cdi}</b></div><div class="contract-modern-bar-base"><div class="contract-modern-bar-value" style="--fill:#16a34a;width:${agents.length?Math.round(cdi/agents.length*100):0}%"></div></div></div><div><div class="contract-modern-bar-head"><span>Avenants actifs</span><b>${avenants.length}</b></div><div class="contract-modern-bar-base"><div class="contract-modern-bar-value" style="--fill:#7c3aed;width:${agents.length?Math.min(100,Math.round(avenants.length/agents.length*100)):0}%"></div></div></div></div><div class="contract-modern-note">Les employés sortants et leurs contrats clôturés sont automatiquement retirés du portefeuille actif et conservés dans les archives.</div></div></section>
    </main></div></div></div>`;
}

function contractSituationSortableHeaderHTML(index,label,type){
  return `<th><button type="button" data-contract-sort="${index}" data-sort-type="${escapeHTML(type||"text")}" onclick="sortContractSituationTable(${index},'${escapeHTML(type||"text")}')" style="display:flex;align-items:center;gap:6px;width:100%;font:inherit;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:inherit;background:transparent;border:0;padding:0;text-align:left;cursor:pointer"><span>${escapeHTML(label)}</span><span data-contract-sort-indicator style="font-size:10px;color:#64748b">↕</span></button></th>`;
}

function contractSituationHeadersHTML(){
  return `<tr><th class="contract-row-number-head">N°</th>${[
    ["Employé","text"],
    ["Code","text"],
    ["Société","text"],
    ["Type","text"],
    ["Recrutement","date"],
    ["Fin d'essai","date"],
    ["Fin contrat","date"],
    ["Salaire net","number"],
    ["Statut","text"]
  ].map((h,i)=>contractSituationSortableHeaderHTML(i+1,h[0],h[1])).join("")}</tr>`;
}

function contractSituationEmployeeCode(a){
  return normalizeEmployeeCodeFormat(a?.matricule||a?.code||"");
}

function sortContractSituationAgents(agents){
  return (agents||[]).slice().sort((a,b)=>{
    const byCode=contractSituationEmployeeCode(a).localeCompare(contractSituationEmployeeCode(b),"fr",{numeric:true,sensitivity:"base"});
    if(byCode)return byCode;
    const an=((a?.nom||"")+" "+(a?.prenom||"")).trim();
    const bn=((b?.nom||"")+" "+(b?.prenom||"")).trim();
    return an.localeCompare(bn,"fr",{numeric:true,sensitivity:"base"});
  });
}

function ensureContratsEmployeesFresh(view){
  if(!sgdiBackendShouldUse()||!sgdiAuthToken())return false;
  const key=String(location.hash||"#/contrats");
  if(window.__sgdiContratsEmployeesFreshKey===key)return false;
  window.__sgdiContratsEmployeesFreshKey=key;
  sgdiShowDataLoadingBar("Chargement des employés...");
  sgdiPullEmployees({silent:true}).then(()=>{
    if(String(location.hash||"")===key&&typeof renderView==="function")renderView();
  }).catch(e=>{
    console.warn("Rechargement employés contrats impossible",e);
    if(typeof toast==="function")toast("Impossible de recharger les employés : "+(e.message||e),"error");
    if(String(location.hash||"")===key&&typeof renderView==="function")renderView();
  });
  return true;
}

function sortContractSituationTable(index,type){
  const tbody=document.getElementById("ct-tbody");
  if(!tbody)return;
  const idx=parseInt(index,10)||0;
  const dir=contractSituationSort&&contractSituationSort.index===idx&&contractSituationSort.dir==="asc"?"desc":"asc";
  contractSituationSort={index:idx,dir};
  const rows=[...tbody.querySelectorAll("tr[data-row]")];
  const empty=[...tbody.children].filter(r=>!r.matches("tr[data-row]"));
  const value=row=>{
    const cell=row.children[idx];
    const raw=String(cell?.dataset?.sort??cell?.textContent??"").trim();
    if(type==="number"){
      const n=parseFloat(raw.replace(/\s/g,"").replace(",","."));
      return Number.isFinite(n)?n:-Infinity;
    }
    if(type==="date")return raw||"0000-00-00";
    return raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
  };
  rows.sort((a,b)=>{
    const va=value(a),vb=value(b);
    const result=type==="number"?va-vb:String(va).localeCompare(String(vb),"fr",{numeric:true,sensitivity:"base"});
    return dir==="asc"?result:-result;
  });
  tbody.replaceChildren(...rows,...empty);
  refreshContractSituationRowNumbers(tbody);
  document.querySelectorAll("[data-contract-sort]").forEach(btn=>{
    const indicator=btn.querySelector("[data-contract-sort-indicator]");
    if(!indicator)return;
    indicator.textContent=parseInt(btn.dataset.contractSort,10)===idx?(dir==="asc"?"▲":"▼"):"↕";
    indicator.style.color=parseInt(btn.dataset.contractSort,10)===idx?"#043970":"#64748b";
  });
}

function refreshContractSituationRowNumbers(tbody){
  const host=tbody||document.getElementById("ct-tbody");
  if(!host)return;
  let n=1;
  [...host.querySelectorAll("tr[data-row]")].forEach(row=>{
    const cell=row.querySelector("[data-contract-row-number]");
    if(!cell)return;
    if(row.classList.contains("hidden"))cell.textContent="";
    else cell.textContent=String(n++);
  });
}

function contractSituationRowsHTML(agents,today_){
  return agents.length===0?`<tr><td colspan="10" class="text-center text-slate-500 p-6">Aucun employé.</td></tr>`:agents.map((a,index)=>{
    const employeeCode=contractSituationEmployeeCode(a);
    let essaiCell="—";
    if(a.dateFinEssai){const d=daysBetween(today_,a.dateFinEssai);
      if(d<0)essaiCell=`<span class="pill pill-gray">terminée</span>`;
      else if(d<=30)essaiCell=`<span class="pill pill-red">${formatDate(a.dateFinEssai)} (${d} j)</span>`;
      else if(d<=90)essaiCell=`<span class="pill pill-amber">${formatDate(a.dateFinEssai)} (${d} j)</span>`;
      else essaiCell=`<span class="pill pill-green">${formatDate(a.dateFinEssai)}</span>`;
    }
    const contractEnd=employeePositionContractEndDate(a);
    const contratCell=employeePositionContractEndPillHTML(a,today_);
    const documentType=employeeContractDocumentType(a);
    const contractKind=cleanContractType(a.typeContrat)||"AUTRE";
    const tCl=documentType.startsWith("Avenant")?"pill-blue":documentType.endsWith("+")?"pill-amber":"pill-green";
    const fullName=((a.nom||"")+" "+(a.prenom||"")).trim();
    return`<tr data-row data-finessai="${a.dateFinEssai||""}" data-fincontrat="${contractEnd||""}" data-contractkind="${escapeHTML(contractKind)}" data-typecontrat="${escapeHTML(documentType)}" data-q="${escapeHTML((fullName+" "+employeeCode).toLowerCase())}" data-searchable><td class="contract-row-number" data-contract-row-number data-sort="${index+1}">${index+1}</td><td data-sort="${escapeHTML(fullName)}"><a class="font-semibold hover:underline uppercase" href="#/effectif/agent/${a.id}">${escapeHTML(fullName.toUpperCase())}</a></td><td class="font-mono text-xs font-black" data-sort="${escapeHTML(employeeCode)}">${safe(employeeCode)}</td><td data-sort="${escapeHTML(a.societe||"")}"><span class="pill pill-indigo">${safe(a.societe)}</span></td><td data-sort="${escapeHTML(documentType)}"><span class="pill ${tCl}">${safe(documentType)}</span></td><td class="text-xs" data-sort="${escapeHTML(a.dateRecrutement||"")}">${formatDate(a.dateRecrutement)}</td><td class="text-xs" data-sort="${escapeHTML(a.dateFinEssai||"")}">${essaiCell}</td><td class="text-xs" data-sort="${escapeHTML(contractEnd||"")}">${contratCell}</td><td data-sort="${Number(a.salaireNet)||0}">${a.salaireNet?money(a.salaireNet):"—"}</td><td data-sort="${escapeHTML(a.statut||"")}">${employeeStatusPillHTML(a,true,"contracts")}</td></tr>`;
  }).join("");
}

function contractSituationListHTML(agents,today_,options){
  const opt=options||{};
  return `<div class="card overflow-hidden mt-4">
    <div class="flex items-center justify-between gap-3 p-4 border-b border-slate-100 flex-wrap">
      <div><h3 class="font-black">${escapeHTML(opt.title||"Liste des contrats")}</h3><div class="text-xs text-slate-500">${escapeHTML(opt.subtitle||`${agents.length} agent(s) affiché(s)`)}</div></div>
      <div class="text-xs text-slate-500"><span id="ct-shown">${agents.length}</span> / ${agents.length} agents affichés</div>
    </div>
    <div class="p-4 border-b border-slate-100">
      <div class="flex items-end gap-4">
        <div><label class="label">Fin d'essai</label>${filterSelectHTML("flt-essai",[{value:"",label:"Tous"},{value:"passed",label:"Terminée"},{value:"upcoming",label:"À venir"},{value:"30",label:"≤ 30 jours"},{value:"60",label:"≤ 60 jours"},{value:"90",label:"≤ 90 jours"},{value:"none",label:"Sans date"}])}</div>
        <div><label class="label">Fin de contrat</label>${filterSelectHTML("flt-contrat",[{value:"",label:"Tous"},{value:"passed",label:"Expiré"},{value:"upcoming",label:"À venir"},{value:"30",label:"≤ 30 jours"},{value:"60",label:"≤ 60 jours"},{value:"90",label:"≤ 90 jours"},{value:"none",label:"Sans date"}])}</div>
        <div class="pb-1"><button type="button" class="btn btn-ghost" onclick="resetContratFilters()">↺ Réinitialiser</button></div>
      </div>
    </div>
    <div class="overflow-x-auto"><table>
      <thead>${contractSituationHeadersHTML()}</thead>
      <tbody id="ct-tbody">${contractSituationRowsHTML(agents,today_)}</tbody>
    </table></div>
  </div>`;
}

function renderContrats(view,mode){
  const socFilter=currentStructureSocieteFilter();
  if(ensureContratsEmployeesFresh(view))return;
  const agents=sortContractSituationAgents(db.agents.filter(a=>!employeeIsFormer(a)&&(!socFilter||a.societe===socFilter)));
  const today_=today();
  const byType={};agents.forEach(a=>{const t=cleanContractType(a.typeContrat)||"—";byType[t]=(byType[t]||0)+1});
  const essaiEnCours=agents.filter(a=>{if(!a.dateFinEssai)return false;const d=daysBetween(today_,a.dateFinEssai);return d>=0}).length;
  const essaiBientot=agents.filter(a=>{if(!a.dateFinEssai)return false;const d=daysBetween(today_,a.dateFinEssai);return d>=0&&d<=90}).length;
  const essaiAlertes=agents.filter(a=>{if(!a.dateFinEssai)return false;const d=daysBetween(today_,a.dateFinEssai);return d>=0&&d<=90}).sort((a,b)=>String(a.dateFinEssai||"").localeCompare(String(b.dateFinEssai||"")));
  const cddBientot=agents.filter(a=>{const end=employeePositionContractEndDate(a);if(a.typeContrat!=="CDD"||!end)return false;const d=daysBetween(today_,end);return d>=0&&d<=90}).length;
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">📑 Situation contrat (personnel)</h1><p class="text-slate-500 text-sm mb-6">Analyse des contrats de travail des agents${socFilter?` · <span class="font-semibold text-amber-700">${escapeHTML(socFilter)}</span>`:""} — <span id="ct-total">${agents.length}</span> agent(s).</p>
    <div class="grid grid-3 mb-6">
      <button type="button" class="card p-4 text-left kpi-clickable" onclick="setContratQuickFilter('total')"><div class="text-xs text-slate-500 uppercase">Effectif total</div><div class="text-2xl font-bold mt-1">${agents.length}</div><div class="text-xs text-slate-400 mt-1">${Object.entries(byType).map(([t,n])=>`${t}: ${n}`).join(" • ")||"—"}</div></button>
      <button type="button" class="card p-4 text-left kpi-clickable" onclick="setContratQuickFilter('essai')"><div class="text-xs text-slate-500 uppercase">Période d'essai</div><div class="text-2xl font-bold mt-1">${essaiEnCours}</div><div class="text-xs ${essaiBientot>0?"text-red-600":"text-slate-400"} mt-1">${essaiBientot} se termine(nt) sous 90 j</div></button>
      <button type="button" class="card p-4 text-left kpi-clickable" onclick="setContratQuickFilter('cdd')"><div class="text-xs text-slate-500 uppercase">CDD bientôt expirés</div><div class="text-2xl font-bold mt-1">${cddBientot}</div><div class="text-xs text-slate-400 mt-1">≤ 90 jours</div></button>
    </div>
    ${essaiAlertes.length?`<div class="card p-4 mb-4" style="background:#fef2f2;border:2px solid #dc2626">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="red-blink-dot"></span>
          <div><div class="font-black text-red-700 uppercase">Alerte fin de période d'essai</div><div class="text-xs text-red-700">${essaiAlertes.length} employé(s) concerné(s) dans les 90 jours</div></div>
        </div>
        <button class="btn btn-danger text-xs" onclick="setContratQuickFilter('essai90')">Voir la liste</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">${essaiAlertes.slice(0,4).map(a=>{const d=daysBetween(today_,a.dateFinEssai);return`<a href="#/effectif/agent/${a.id}" class="p-3 rounded-lg text-sm block" style="background:#fff;border:1px solid #fecaca;text-decoration:none;color:#0f172a"><div class="flex justify-between gap-2"><b>${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</b><span class="pill pill-red">J-${d}</span></div><div class="text-xs text-slate-500 mt-1">${escapeHTML(a.matricule||"—")} · Fin essai : ${formatDate(a.dateFinEssai)}</div></a>`}).join("")}</div>
    </div>`:""}
    <div class="card p-4 mb-4">
      <div class="flex items-center justify-between mb-3"><h3 class="font-semibold text-sm">🔎 Filtres</h3><div class="text-xs text-slate-500"><span id="ct-shown">${agents.length}</span> / ${agents.length} agents affichés</div></div>
      <div class="mb-3"><input id="flt-search" type="search" class="input w-full" placeholder="Rechercher par nom, prénom ou matricule…" oninput="applyContratFilters()"/></div>
      <div class="flex items-end gap-4 mb-3">
        <div><label class="label">Fin d'essai</label>${filterSelectHTML("flt-essai",[{value:"",label:"Tous"},{value:"passed",label:"Terminée"},{value:"upcoming",label:"À venir"},{value:"30",label:"≤ 30 jours"},{value:"60",label:"≤ 60 jours"},{value:"90",label:"≤ 90 jours"},{value:"none",label:"Sans date"}])}</div>
        <div><label class="label">Fin de contrat</label>${filterSelectHTML("flt-contrat",[{value:"",label:"Tous"},{value:"passed",label:"Expiré"},{value:"upcoming",label:"À venir"},{value:"30",label:"≤ 30 jours"},{value:"60",label:"≤ 60 jours"},{value:"90",label:"≤ 90 jours"},{value:"none",label:"Sans date"}])}</div>
        <div class="pb-1"><button type="button" class="btn btn-ghost" onclick="resetContratFilters()">↺ Réinitialiser</button></div>
      </div>
    </div>
    <div class="card overflow-hidden"><table>
    <thead>${contractSituationHeadersHTML()}</thead>
    <tbody id="ct-tbody">${contractSituationRowsHTML(agents,today_)}</tbody></table></div>`;
  const pendingFilter=sessionStorage.getItem("sgdi-contract-list-filter")||"";
  if(pendingFilter){
    sessionStorage.removeItem("sgdi-contract-list-filter");
    requestAnimationFrame(()=>setContratQuickFilter(pendingFilter));
  }
}

function directContractPayload(form){
  const fd=new FormData(form);
  return {
    workflow_id:fd.get("workflow_id")||"",
    agent_id:fd.get("agent_id")||"",
    matricule:String(fd.get("matricule")||"").trim(),
    template_id:fd.get("template_id")?Number(fd.get("template_id")):null,
    contract_type:cleanContractType(fd.get("contract_type")),
    first_name:String(fd.get("first_name")||"").trim(),
    last_name:String(fd.get("last_name")||"").trim(),
    birth_date:fd.get("birth_date")||null,
    birth_place:String(fd.get("birth_place")||"").trim()||null,
    father_name:String(fd.get("father_name")||"").trim()||null,
    mother_name:String(fd.get("mother_name")||"").trim()||null,
    nin:String(fd.get("nin")||"").trim()||null,
    numero_cnas:String(fd.get("numero_cnas")||"").trim()||null,
    phone:String(fd.get("phone")||"").trim()||null,
    address:String(fd.get("address")||"").trim()||null,
    start_date:fd.get("start_date")||null,
    contract_duration:normalizeContractDurationValue(fd.get("contract_duration"))||null,
    end_date:fd.get("end_date")||null,
    work_place:String(fd.get("work_place")||"").trim()||null,
    wilaya:String(fd.get("wilaya")||"").trim()||null,
    commune:String(fd.get("commune")||"").trim()||null,
    client:String(fd.get("client")||"").trim()||null,
    recruitment_reason:String(fd.get("recruitment_reason")||"").trim()||null,
    salary_net:parseMoneyInput(fd.get("salary_net"))||0,
    salary_details:String(fd.get("salary_details")||"").trim()||null,
    position:String(fd.get("position")||"").trim()||String(fd.get("work_place")||"").trim()||null,
    society:String(fd.get("society")||"").trim()||null,
    signature_employee:fd.get("signature_employee")||"",
    rh_validated_at:fd.get("rh_validated_at")||"",
    rh_validated_by:fd.get("rh_validated_by")||"",
    workflow_status:fd.get("workflow_status")||"brouillon",
    values:{
      DATE_CONTRAT:today(),
      DUREE_CONTRAT:contratDureeLabel(normalizeContractDurationValue(fd.get("contract_duration"))),
      CLIENT:String(fd.get("client")||"").trim(),
      WILAYA:String(fd.get("wilaya")||"").trim(),
      COMMUNE:String(fd.get("commune")||"").trim(),
      CNAS:String(fd.get("numero_cnas")||"").trim(),
      NUMERO_CNAS:String(fd.get("numero_cnas")||"").trim()
    },
    output_format:"docx"
  };
}

function openContractExcelImport(){
  if(typeof XLSX==="undefined"){toast("Lecteur Excel indisponible. Vérifiez la connexion au CDN SheetJS.","error");return}
  const input=document.createElement("input");
  input.type="file";input.accept=".xlsx,.xls,.csv";
  input.onchange=()=>{const file=input.files&&input.files[0];if(file)readContractExcelFile(file)};
  input.click();
}

function contractExcelMapRow(row,index){
  const c=candidateExcelMapRow(row,index,"reserve",{free:true});
  c.statut="a_contractualiser";
  c.reserveDirect=true;
  c.fichePositionValidee=true;
  c.fichePositionValideeAt=c.fichePositionValideeAt||new Date().toISOString();
  c.fichePositionValideeBy=c.fichePositionValideeBy||session?.username||"excel_contrat";
  c.source="Import Excel contrat";
  c.typeContrat=cleanContractType(candidateExcelLooseText(row,["type contrat","type de contrat","nature contrat"])||c.typeContrat||"")||"CDD";
  c.posteContrat=candidatePosteCleanValue(candidateExcelLooseText(row,["poste contrat","poste","fonction","emploi","grade"]))||candidatePosteCleanValue(c.posteContrat)||candidatePosteCleanValue(c.posteSouhaite)||"";
  c.dateRecrutement=c.dateRecrutement||candidateExcelLooseDate(row,["date recrutement","date de recrutement","date entree","date entrée","date embauche","date d'embauche","date debut contrat","date début contrat"]);
  c.dateEntree=c.dateEntree||c.dateRecrutement;
  c.dateFinContrat=candidateExcelLooseDate(row,["date fin contrat","fin contrat","date fin","echeance contrat","échéance contrat"])||c.dateFinContrat||"";
  c.dateFinEssai=candidateExcelLooseDate(row,["date fin essai","fin essai","date fin periode essai","date fin période essai"])||c.dateFinEssai||"";
  c.dureeEssai=candidateExcelLooseText(row,["duree essai","durée essai","periode essai","période essai"])||c.dureeEssai||"";
  c.dureeContrat=candidateExcelLooseText(row,["duree contrat","durée contrat"])||c.dureeContrat||"";
  c.salaireNet=parseMoneyInput(excelCellLoose(row,["salaire net","net a payer","net à payer","salaire"]))||c.salaireNet||c.salairePrevu||"";
  c.salairePrevu=c.salairePrevu||c.salaireNet||"";
  c.banque=candidateExcelLooseText(row,["banque","nom banque"])||c.banque||"";
  c.iban=candidateExcelLooseText(row,["iban","rib","compte bancaire","numero compte","numéro compte"])||c.iban||"";
  c.avisDecision=c.avisDecision||"Favorable";
  c.avisDate=c.avisDate||today();
  c.avisRecruteur=c.avisRecruteur||session?.username||"Import Excel";
  c.avisCommentaire=c.avisCommentaire||"Importé depuis le module Contrat.";
  return c;
}

function readContractExcelFile(file){
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(new Uint8Array(e.target.result),{type:"array",cellDates:false});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:"",raw:true}).filter(candidateExcelRowHasData);
      if(!rows.length){toast("Fichier Excel vide","error");return}
      previewContractExcelImport(rows,file.name);
    }catch(err){console.error(err);toast("Import Excel contrat impossible : "+err.message,"error")}
  };
  reader.readAsArrayBuffer(file);
}

function previewContractExcelImport(rows,fileName){
  const mapped=rows.map((row,i)=>{
    const c=contractExcelMapRow(row,i);
    const errors=candidateIdentityMissing(c);
    return {row:i+2,c,errors};
  });
  window._contractExcelImport={rows,mapped,fileName};
  const valid=mapped.filter(x=>!x.errors.length).length;
  const err=mapped.filter(x=>x.errors.length).length;
  const sample=mapped.slice(0,25).map(x=>`<tr><td class="font-mono text-xs">${x.row}</td><td class="font-semibold">${escapeHTML((x.c.nom||"")+" "+(x.c.prenom||""))}</td><td>${safe(candidatePosteLabel(x.c))}</td><td>${safe(x.c.typeContrat)}</td><td>${safe(x.c.dateRecrutement)}</td><td>${x.errors.length?`<span class="pill pill-red">${escapeHTML(x.errors.join(", "))}</span>`:`<span class="pill pill-green">Prêt contrat</span>`}</td></tr>`).join("");
  openModal(`<h3 class="font-bold text-lg mb-1">Import Excel contrats</h3><p class="text-sm text-slate-500 mb-4">${escapeHTML(fileName||"Fichier Excel")} · ${rows.length} ligne(s)</p>
    <div class="grid grid-2 gap-3 mb-4">
      <div class="card p-3"><div class="text-xs uppercase text-slate-500 font-bold">Prêts</div><div class="text-2xl font-black text-emerald-600">${valid}</div></div>
      <div class="card p-3"><div class="text-xs uppercase text-slate-500 font-bold">Erreurs identité</div><div class="text-2xl font-black text-red-600">${err}</div></div>
    </div>
    <div class="card overflow-hidden mb-4" style="max-height:50vh;overflow:auto"><table><thead><tr><th>Ligne</th><th>Employé</th><th>Poste</th><th>Contrat</th><th>Recrutement</th><th>Statut</th></tr></thead><tbody>${sample||`<tr><td colspan="6" class="text-center p-4 text-slate-500">Aucune ligne lisible.</td></tr>`}</tbody></table></div>
    <div class="text-xs text-slate-500 mb-4">Les champs vides sont acceptés. Les lignes importées seront ajoutées dans <b>Contrat > À contractualiser</b>.</div>
    <div class="flex justify-end gap-2 flex-wrap"><button class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary" ${valid?"":"disabled"} onclick="confirmContractExcelImport(this)">Enregistrer dans le backend</button></div>`);
}

async function confirmContractExcelImport(btn){
  const batch=window._contractExcelImport;
  if(!batch||!Array.isArray(batch.mapped)){toast("Aucun import contrat en attente","error");return}
  const items=batch.mapped.filter(x=>!x.errors.length).map(x=>({...x.c,importRow:x.row,importAllowDuplicate:true}));
  if(!items.length){toast("Aucune ligne valide à importer","error");return}
  if(btn)btn.disabled=true;
  closeModal();
  sgdiShowImportProgress(0,items.length,"Import contrats en cours…");
  sgdiRequireServerWrite();
  if(!Array.isArray(db.candidats))db.candidats=[];
  let ok=0;
  const importErrors=[];
  const BATCH=10;
  try{
    for(let i=0;i<items.length;i+=BATCH){
      sgdiShowImportProgress(i,items.length,"Import contrats en cours…");
      const b=items.slice(i,i+BATCH);
      const results=await Promise.allSettled(b.map(c=>persistCandidateToPostgres(c,{allowCreate:true})));
      results.forEach((r,idx)=>{
        const c=b[idx];
        if(r.status==="fulfilled"){
          if(!db.candidats.some(x=>String(x.id)===String(c.id)||String(x.backendId||"")===String(c.backendId||"")))db.candidats.push(c);
          ok++;
        }else{
          importErrors.push(`Ligne ${c.importRow||"?"} ${(c.nom||"")+" "+(c.prenom||"")} : ${r.reason?.message||r.reason}`);
        }
      });
    }
    sgdiShowImportProgress(items.length,items.length,"Import contrats en cours…");
    await sgdiPullState({silent:true,render:false,force:true,light:true});
    sgdiShowImportResult(ok,importErrors.length,importErrors,`${ok} DOSSIER(S) CONTRAT IMPORTÉ(S)`);
    navigate("contrats/a_contractualiser");
  }catch(e){
    sgdiRemoveImportOverlay();
    if(btn)btn.disabled=false;
    toast("Import contrat refusé : "+(e.message||e),"error");
  }
}

function renderNouveauContratDirect(view){
  view.innerHTML=`<div class="max-w-3xl mx-auto">
    <div class="card p-8 text-center">
      <h1 class="text-3xl font-black uppercase mb-2">Nouveau contrat</h1>
      <p class="text-sm text-slate-500 mb-5">Le bouton Créer contrat utilise maintenant le même formulaire que Gestion des effectifs > Nouveau contrat.</p>
      <div class="flex justify-center gap-2 flex-wrap">
        <button type="button" class="btn btn-primary" onclick="openEmployeeNewContractModal()">Créer contrat</button>
        <button type="button" class="btn btn-ghost" onclick="navigate('contrats/dashboard')">Retour</button>
      </div>
    </div>
  </div>`;
}

function latestEmployeeContractWorkflow(agentId){
  if(!agentId)return null;
  return (db.contratsPersonnel||[]).filter(c=>c&&c.workflowKind==="nouveau_contrat"&&String(c.agent_id||"")===String(agentId)).sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")))[0]||null;
}

function employeeContractDefaults(a,soc){
  const start=a?.dateRecrutement||today();
  const duration=normalizeContractDurationValue(a?.dureeContrat||"12m");
  const site=directContractSiteFromEmployee(a);
  return {
    workflow_id:"",
    agent_id:a?.id||"",
    matricule:a?.matricule||"",
    contract_type:cleanContractType(a?.typeContrat)||"CDD",
    first_name:a?.prenom||"",
    last_name:a?.nom||"",
    birth_date:a?.dateNaissance||"",
    birth_place:a?.lieuNaissance||"",
    father_name:a?.nomPere||"",
    mother_name:a?.nomMere||"",
    nin:a?.nin||"",
    numero_cnas:a?.numeroCnas||"",
    phone:a?.telephone||"",
    address:a?.adresse||"",
    start_date:start,
    contract_duration:duration,
    end_date:a?.dateFinContrat||contractEndDate(start,duration),
    work_place:a?.affectationCourante?.siteName||a?.site||"",
    wilaya:a?.wilaya||site?.wilaya||"",
    commune:a?.commune||site?.commune||"",
    client:a?.client||site?.client||"",
    recruitment_reason:"Nécessité de service",
    salary_net:a?.salaireNet||a?.salaire||"",
    salary_details:a?.salary_details||"",
    position:a?.fonction||a?.position||a?.posteContrat||a?.affectationCourante?.poste||"",
    society:a?.societe||soc||"",
    signature_employee:"",
    workflow_status:"brouillon"
  };
}

function contractWorkflowStatusLabel(status,signature){
  if(status==="valide_rh")return "VALIDÉ RH";
  if(signature)return "SIGNÉ EMPLOYÉ";
  return "BROUILLON";
}

function selectDirectContractEmployee(agentId){
  sessionStorage.setItem("newContractAgentId",agentId||"");
  renderView();
}

function updateDirectContractEndDate(){
  const f=document.getElementById("direct-contract-form");if(!f)return;
  const end=contractEndDate(f.start_date?.value||"",f.contract_duration?.value||"");
  if(f.end_date)f.end_date.value=end||"";
}

async function loadDirectContractTemplates(selectedId){
  const f=document.getElementById("direct-contract-form");if(!f)return;
  const select=f.template_id;
  try{
    const templates=(await SGDI.rh.contractTemplates()).filter(t=>Number(t.active)!==0);
    select.innerHTML=`<option value="">— Choisir un modèle —</option>`+templates.map(t=>{const typ=cleanContractType(t.contract_type);return`<option value="${t.id}" data-type="${escapeHTML(typ)}" ${String(selectedId||"")===String(t.id)?"selected":""}>${escapeHTML(t.title)}${typ?` · ${escapeHTML(typ)}`:""}</option>`}).join("");
    select.onchange=()=>{const opt=select.selectedOptions&&select.selectedOptions[0];if(opt?.dataset?.type)f.contract_type.value=opt.dataset.type};
  }catch(e){
    select.innerHTML=`<option value="">Modèles indisponibles</option>`;
    toast("Modèles contrat indisponibles : "+(e.message||e),"error");
  }
}

function directContractA4HTML(p){
  p=p||{};
  const fullName=((p.last_name||"")+" "+(p.first_name||"")).trim().toUpperCase();
  const salary=p.salary_net?money(parseMoneyInput(p.salary_net)||p.salary_net):"—";
  const ref=p.workflow_id||("CTR-"+today().replaceAll("-","")+"-"+(p.matricule||"EMP"));
  const signature=p.signature_employee?`<img src="${p.signature_employee}" style="max-width:280px;max-height:112px;display:block;margin:8px auto 0"/>`:`<div style="height:108px"></div>`;
  const rh=p.rh_validated_at?`Validé par ${escapeHTML(p.rh_validated_by||"RH")} le ${formatDate(String(p.rh_validated_at).slice(0,10))}`:"Validation RH en attente";
  return `<div class="contract-a4" style="width:210mm;min-height:297mm;margin:0 auto;background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif;padding:18mm 17mm;box-shadow:0 10px 35px rgba(15,23,42,.18);font-size:12px;line-height:1.55">
    <div style="border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-weight:700">Fiche interne de vérification. Cette page n'est pas le contrat officiel. Le contrat imprimable est le fichier Word généré avec le modèle sélectionné.</div>
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #043970;padding-bottom:10px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px"><img src="${escapeHTML(sgdiDocumentLogo(p.society))}" style="width:58px;height:58px;object-fit:contain"/><div><div style="font-size:22px;font-weight:900;color:#043970;letter-spacing:.04em">FICHE DE CONTRÔLE CONTRAT</div><div style="font-size:11px;text-transform:uppercase;color:#475569">${escapeHTML(p.contract_type||"Contrat")}</div></div></div>
      <div style="text-align:right;font-size:11px"><b>Réf.</b> ${escapeHTML(ref)}<br/><b>Date</b> ${formatDate(today())}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div style="border:1px solid #cbd5e1;padding:10px;border-radius:6px"><b style="color:#043970">Employeur</b><br/>${escapeHTML(p.society||"—")}</div>
      <div style="border:1px solid #cbd5e1;padding:10px;border-radius:6px"><b style="color:#043970">Employé(e)</b><br/>${escapeHTML(fullName||"—")}<br/>Code : ${escapeHTML(p.matricule||"—")}</div>
    </div>
    <h3 style="font-size:13px;text-transform:uppercase;color:#043970;border-bottom:1px solid #dbe3ef;padding-bottom:5px;margin:14px 0 8px">Identification</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px">${[
      ["Date et lieu de naissance",`${formatDate(p.birth_date)} à ${escapeHTML(p.birth_place||"—")}`],
      ["Filiation",`Père : ${escapeHTML(p.father_name||"—")} · Mère : ${escapeHTML(p.mother_name||"—")}`],
      ["NIN / CNAS",`${escapeHTML(p.nin||"—")} / ${escapeHTML(p.numero_cnas||"—")}`],
      ["Adresse / Téléphone",`${escapeHTML(p.address||"—")} / ${escapeHTML(p.phone||"—")}`]
    ].map(r=>`<tr><td style="width:34%;border:1px solid #dbe3ef;background:#f8fafc;padding:7px;font-weight:700">${r[0]}</td><td style="border:1px solid #dbe3ef;padding:7px">${r[1]}</td></tr>`).join("")}</table>
    <h3 style="font-size:13px;text-transform:uppercase;color:#043970;border-bottom:1px solid #dbe3ef;padding-bottom:5px;margin:14px 0 8px">Conditions contractuelles</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px">${[
      ["Fonction",escapeHTML(p.position||"—")],
      ["Lieu de travail",escapeHTML(p.work_place||"—")],
      ["Wilaya / Commune / Client",`${escapeHTML(p.wilaya||"—")} / ${escapeHTML(p.commune||"—")} / ${escapeHTML(p.client||"—")}`],
      ["Durée",`${escapeHTML(contratDureeLabel(p.contract_duration)||"—")} · du ${formatDate(p.start_date)} au ${formatDate(p.end_date)}`],
      ["Motif du recrutement",escapeHTML(p.recruitment_reason||"—")],
      ["Salaire net",salary],
      ["Détail salaire",escapeHTML(p.salary_details||"—")]
    ].map(r=>`<tr><td style="width:34%;border:1px solid #dbe3ef;background:#f8fafc;padding:7px;font-weight:700">${r[0]}</td><td style="border:1px solid #dbe3ef;padding:7px">${r[1]}</td></tr>`).join("")}</table>
    <h3 style="font-size:13px;text-transform:uppercase;color:#043970;border-bottom:1px solid #dbe3ef;padding-bottom:5px;margin:14px 0 8px">Clauses générales</h3>
    <p>Le présent contrat définit les conditions d'engagement de l'employé(e) désigné(e) ci-dessus. L'employé(e) s'engage à respecter le règlement intérieur, les consignes de sécurité, les affectations de service et les obligations de confidentialité applicables à son poste.</p>
    <p>Toute modification substantielle des conditions contractuelles fera l'objet d'un avenant ou d'une décision RH dûment validée.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:30px">
      <div style="border:1px solid #cbd5e1;border-radius:6px;padding:12px;text-align:center;min-height:165px"><b>Signature employé(e)</b>${signature}</div>
      <div style="border:1px solid #cbd5e1;border-radius:6px;padding:12px;text-align:center;min-height:130px"><b>Validation RH</b><div style="margin-top:22px;font-weight:700;color:#047857">${rh}</div><div style="margin-top:22px">Cachet / Signature RH</div></div>
    </div>
  </div>`;
}

function previewDirectContract(form){
  const p=directContractPayload(form);
  const host=document.getElementById("direct-contract-preview");
  if(host)host.innerHTML=directContractA4HTML(p);
  const pill=document.getElementById("contract-status-pill");
  if(pill)pill.textContent=contractWorkflowStatusLabel(p.workflow_status,p.signature_employee);
}

async function validateDirectContract(form){
  const payload=directContractPayload(form);
  if(!payload.last_name||!payload.first_name){toast("Nom et prénom obligatoires","error");return}
  if(!payload.start_date||!payload.end_date){toast("Dates du contrat obligatoires","error");return}
  if(!payload.signature_employee){toast("Signature employé obligatoire avant validation RH","error");return}
  if(!payload.template_id){toast("Choisissez le modèle Word officiel avant validation RH","error");return}
  payload.workflow_id=payload.workflow_id||uid("ctr");
  payload.workflow_status="valide_rh";
  payload.rh_validated_at=new Date().toISOString();
  payload.rh_validated_by=session?.username||"RH";
  payload.workflowKind="nouveau_contrat";
  payload.updatedAt=new Date().toISOString();
  payload.createdAt=payload.createdAt||new Date().toISOString();
  form.workflow_id.value=payload.workflow_id;
  form.workflow_status.value=payload.workflow_status;
  form.rh_validated_at.value=payload.rh_validated_at;
  form.rh_validated_by.value=payload.rh_validated_by;
  db.contratsPersonnel=db.contratsPersonnel||[];
  const item={...payload,id:payload.workflow_id};
  try{
    const row=await SGDI.rh.generateContractFromForm(payload);
    form.generated_id.value=row.id;
    if(form.generated_file_name)form.generated_file_name.value=row.file_name||"contrat.docx";
    item.generated_id=row.id;
    item.generated_file_name=row.file_name||"contrat.docx";
    const idx=db.contratsPersonnel.findIndex(c=>String(c.workflow_id||c.id)===String(payload.workflow_id));
    if(idx>=0)db.contratsPersonnel[idx]={...db.contratsPersonnel[idx],...item};else db.contratsPersonnel.push(item);
    if(!(await saveDBAndWaitToast("Contrat non confirmé")))return;
    const btn=form.querySelector("[data-print-contract]");
    if(btn){btn.disabled=false;btn.classList.remove("btn-ghost");btn.classList.add("btn-primary")}
    previewDirectContract(form);
    toast("Contrat Word officiel généré","success");
    await downloadGeneratedContract(row.id,row.file_name||"contrat.docx");
  }catch(e){toast("Validation contrat refusée : "+(e.message||e),"error")}
}

async function printDirectContract(form){
  const p=directContractPayload(form);
  if(p.workflow_status!=="valide_rh"){toast("Validez d'abord le contrat par RH","error");return}
  const id=form.generated_id?.value||"";
  if(!id){toast("Contrat Word officiel non généré. Validez d'abord par RH avec un modèle Word.","error");return}
  const fileName=form.generated_file_name?.value||`contrat-${p.matricule||"employe"}.docx`;
  await downloadGeneratedContract(id,fileName);
}

async function generateEmployeeNewContractWord(form,showSuccess=true){
  const draft=employeeNewContractDraftFromForm(form);
  if(!draft.a){toast("Employé introuvable","error");return}
  if(!draft.dateDebut||!draft.dureeContrat||!draft.dateFin){toast("Date début, durée et date fin obligatoires","error");return null}
  if(!draft.numeroPieceIdentite){toast("N° pièce d'identité obligatoire","error");return null}
  try{
    const row=await SGDI.rh.generateContractFromForm(employeeNewContractPayload(draft));
    if(showSuccess)toast("Contrat Word officiel généré","success");
    await downloadGeneratedContract(row.id,row.file_name||`contrat-aps-${draft.a.matricule||"employe"}.docx`);
    return row;
  }catch(e){toast("Génération Word refusée : "+(e.message||e),"error");return null}
}

async function confirmEmployeeNewContract(form){
  const draft=employeeNewContractDraftFromForm(form);
  let a=draft.a;if(!a){toast("Employé introuvable","error");return}
  const contractBlock=employeeValidContractBlockReason(a);
  const allowExistingContract=String(new FormData(form).get("allowExistingContract")||"")==="1"&&isAdminFichePositionContext();
  if(contractBlock&&!allowExistingContract){toast(contractBlock,"error");return}
  if(!draft.dateDebut||!draft.dureeContrat||!draft.dateFin){toast("Date début, durée et date fin obligatoires","error");return}
  if(!draft.poste){toast("Poste / fonction obligatoire","error");return}
  if(!draft.numeroPieceIdentite){toast("N° pièce d'identité obligatoire","error");return}
  try{
    a=await ensureContractEmployeeRecord(a,draft);
    draft.a=a;
  }catch(e){toast("Contrat non enregistré : "+(e.message||e),"error");return}
  a.typeContrat=draft.typeContrat;
  a.dateRecrutement=draft.dateDebut;
  a.dureeContrat=draft.dureeContrat;
  a.dateFinContrat=draft.dateFin;
  a.periodeEssaiContrat=draft.periodeEssai;
  a.numeroPieceIdentite=draft.numeroPieceIdentite||a.numeroPieceIdentite||"";
  a.nin=draft.nin||a.nin||"";
  a.fonction=draft.poste;
  a.position=draft.poste;
  a.salaireNet=draft.salaireNet;
  a.adresseSite=draft.adresseSite||a.adresseSite||"";
  a.wilaya=draft.wilaya||a.wilaya||"";
  a.wilayaContrat=draft.wilaya||a.wilayaContrat||"";
  a.commune=draft.commune||a.commune||"";
  a.client=draft.client||a.client||"";
  a.missionsContrat=draft.missions||a.missionsContrat||"";
  a.articleOverridesContrat=draft.articleOverrides||a.articleOverridesContrat||{};
  a.statut=a.statut||"actif";
  try{
    await persistEmployeeMasterContractFields(a);
    await persistEmployeeContractRecord(a,draft);
    await persistEmployeeRhDecision(a,{type:"Nouveau contrat",du:draft.dateDebut,au:draft.dateFin,motif:`${draft.typeContrat} ${contratDureeLabel(draft.dureeContrat)}`,details:[`Fonction : ${draft.poste}`,`Période d'essai : ${contratDureeLabel(draft.periodeEssai)||"—"}`,`N° pièce d'identité : ${draft.numeroPieceIdentite||"—"}`,`N° identité National : ${draft.nin||"—"}`,`Client : ${draft.client||"—"}`,`Adresse : ${draft.adresseSite||"—"}`,`Wilaya : ${draft.wilaya||"—"}`,`Commune : ${draft.commune||"—"}`,draft.missions?`Missions : ${draft.missions}`:"",`Salaire : ${money(draft.salaireNet||0)}`,draft.observation?`Observation : ${draft.observation}`:""].filter(Boolean).join("\n"),reference:draft.reference,statut:"termine"});
  }catch(e){toast("Contrat non enregistré : "+(e.message||e),"error");return}
  if(!(await saveDBAndWaitToast("Contrat non confirmé")))return;
  const w=openEmployeeContractReviewWindow(a,{...draft,a});
  if(!w)toast("Contrat validé, mais la fenêtre contrat a été bloquée","warn");
  closeModal();toast("Contrat APS validé","success");renderView();
}

function initDirectContractSignaturePad(existing){
  const canvas=document.getElementById("employee-contract-signature");if(!canvas)return;
  const f=document.getElementById("direct-contract-form");
  const ctx=canvas.getContext("2d");
  const ratio=Math.max(window.devicePixelRatio||1,1);
  const rect=canvas.getBoundingClientRect();
  canvas.width=Math.max(1,Math.floor(rect.width*ratio));
  canvas.height=Math.max(1,Math.floor(rect.height*ratio));
  ctx.scale(ratio,ratio);
  ctx.lineWidth=2.6;
  ctx.lineCap="round";
  ctx.lineJoin="round";
  ctx.strokeStyle="#0f172a";
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,rect.width,rect.height);
  if(existing){
    const img=new Image();
    img.onload=()=>ctx.drawImage(img,0,0,rect.width,rect.height);
    img.src=existing;
  }
  let drawing=false,last=null;
  const point=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
  const save=()=>{
    if(!f)return;
    f.signature_employee.value=canvas.toDataURL("image/png");
    const state=document.getElementById("contract-signature-state");
    if(state){state.textContent="Signature enregistrée";state.className="text-xs text-emerald-700"}
    f.workflow_status.value=f.workflow_status.value==="valide_rh"?"valide_rh":"signe_employe";
    previewDirectContract(f);
  };
  canvas.onpointerdown=e=>{drawing=true;last=point(e);canvas.setPointerCapture(e.pointerId)};
  canvas.onpointermove=e=>{if(!drawing||!last)return;const p=point(e);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p};
  canvas.onpointerup=e=>{if(drawing){drawing=false;last=null;save()}try{canvas.releasePointerCapture(e.pointerId)}catch(_e){}};
  canvas.onpointerleave=()=>{if(drawing){drawing=false;last=null;save()}};
}

function clearDirectContractSignature(){
  const canvas=document.getElementById("employee-contract-signature");const f=document.getElementById("direct-contract-form");if(!canvas||!f)return;
  const ctx=canvas.getContext("2d");
  const r=canvas.getBoundingClientRect();
  ctx.clearRect(0,0,r.width,r.height);
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,r.width,r.height);
  f.signature_employee.value="";
  f.workflow_status.value="brouillon";
  f.rh_validated_at.value="";
  f.rh_validated_by.value="";
  const btn=f.querySelector("[data-print-contract]");
  if(btn){btn.disabled=true;btn.classList.add("btn-ghost");btn.classList.remove("btn-primary")}
  const state=document.getElementById("contract-signature-state");
  if(state){state.textContent="Signature en attente";state.className="text-xs text-slate-500"}
  previewDirectContract(f);
}

function ensureDrumCSS(){
  if(document.getElementById("sgdi-drum-css"))return;
  const s=document.createElement("style");s.id="sgdi-drum-css";
  s.textContent=`.sgdi-drum{display:inline-flex;flex-direction:column;align-items:center;width:100px;gap:1px;position:relative}.drum-btn{background:none;border:none;cursor:pointer;color:#94a3b8;font-size:10px;line-height:1;padding:3px 0;width:100%;text-align:center;border-radius:4px;transition:background .1s}.drum-btn:hover{background:#f1f5f9;color:#0f172a}.drum-win{width:100%;border-radius:8px;border:1px solid #e2e8f0;background:#fff;overflow:hidden;cursor:ns-resize}.drum-cell{height:30px;line-height:30px;text-align:center;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px;transition:background .1s}.drum-empty{height:30px}.drum-sel{font-weight:700;color:#043970;background:#eff6ff;font-size:13px}.drum-adj{color:#94a3b8;font-size:11px}.drum-adj:hover{background:#f8fafc;color:#334155}.drum-multi{display:flex;align-items:flex-start;gap:4px}.drum-multi-col{display:flex;flex-direction:column;align-items:center;gap:2px}.drum-multi-label{font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.05em}`;
  document.head.appendChild(s);
}

function filterSelectHTML(id,opts){
  return `<select id="${id}" class="select" onchange="applyContratFilters()">${opts.map(o=>`<option value="${escapeHTML(o.value)}">${escapeHTML(o.label)}</option>`).join("")}</select>`;
}

function drumPickerHTML(id,opts,selected,cb){
  _drumOpts[id]=opts;if(cb)_drumCallbacks[id]=cb;ensureDrumCSS();
  const idx=Math.max(0,opts.findIndex(o=>o.value===(selected||"")));
  const cells=[-1,0,1].map(d=>{const i=idx+d;if(i<0||i>=opts.length)return`<div class="drum-empty"></div>`;const cls=d===0?"drum-cell drum-sel":"drum-cell drum-adj";return`<div class="${cls}" onclick="drumClick('${id}',${i})">${escapeHTML(opts[i].label)}</div>`;}).join("");
  const selOpts=opts.map(o=>`<option value="${escapeHTML(o.value)}"${o.value===(selected||"")?" selected":""}>${escapeHTML(o.label)}</option>`).join("");
  return`<div class="sgdi-drum" id="${id}-wrap"><button type="button" class="drum-btn" onclick="drumStep('${id}',-1)">▲</button><div class="drum-win" id="${id}-win" onwheel="drumWheel(event,'${id}')">${cells}</div><button type="button" class="drum-btn" onclick="drumStep('${id}',+1)">▼</button><select id="${id}" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0" tabindex="-1">${selOpts}</select></div>`;
}

function drumMultiHTML(cols){
  ensureDrumCSS();
  return`<div class="drum-multi">${cols.map(c=>`<div class="drum-multi-col">${c.label?`<span class="drum-multi-label">${escapeHTML(c.label)}</span>`:""}${drumPickerHTML(c.id,c.opts,c.selected||"",c.cb||"")}</div>`).join("")}</div>`;
}

function drumFireChange(id){
  const cb=_drumCallbacks[id];
  if(cb&&typeof window[cb]==="function")window[cb]();
  else if(typeof applyContratFilters==="function")applyContratFilters();
}

function drumStep(id,dir){
  const sel=document.getElementById(id);if(!sel)return;
  const opts=_drumOpts[id]||[];const cur=Math.max(0,opts.findIndex(o=>o.value===sel.value));
  const next=Math.max(0,Math.min(opts.length-1,cur+dir));
  sel.value=opts[next].value;drumRender(id);drumFireChange(id);
}

function drumClick(id,idx){
  const sel=document.getElementById(id);if(!sel)return;
  const opts=_drumOpts[id]||[];if(opts[idx])sel.value=opts[idx].value;
  drumRender(id);drumFireChange(id);
}

function drumWheel(e,id){e.preventDefault();const now=Date.now();if(now-(_drumWheelLast[id]||0)<250)return;_drumWheelLast[id]=now;drumStep(id,e.deltaY>0?1:-1);}

function drumRender(id){
  const sel=document.getElementById(id);if(!sel)return;
  const opts=_drumOpts[id]||[];const idx=Math.max(0,opts.findIndex(o=>o.value===sel.value));
  const win=document.getElementById(id+"-win");if(!win)return;
  win.innerHTML=[-1,0,1].map(d=>{const i=idx+d;if(i<0||i>=opts.length)return`<div class="drum-empty"></div>`;const cls=d===0?"drum-cell drum-sel":"drum-cell drum-adj";return`<div class="${cls}" onclick="drumClick('${id}',${i})">${escapeHTML(opts[i].label)}</div>`;}).join("");
}

function drumPtMonthSync(){
  const m=document.getElementById("pt-drum-mo")?.value||"";
  const y=document.getElementById("pt-drum-yr")?.value||"";
  if(m&&y)setPtMonth(y+"-"+m);
}

function drumFpqDateSync(){
  const d=document.getElementById("fpq-drum-day")?.value||"";
  const m=document.getElementById("fpq-drum-mo")?.value||"";
  const y=document.getElementById("fpq-drum-yr")?.value||"";
  if(d&&m&&y){const maxD=new Date(parseInt(y),parseInt(m),0).getDate();const safeD=Math.min(parseInt(d),maxD);setFpqDate(y+"-"+m+"-"+String(safeD).padStart(2,"0"));}
}

function drumPtSupDateSync(){
  const d=document.getElementById("ptsup-drum-day")?.value||"";
  const m=document.getElementById("ptsup-drum-mo")?.value||"";
  const y=document.getElementById("ptsup-drum-yr")?.value||"";
  if(d&&m&&y){const maxD=new Date(parseInt(y),parseInt(m),0).getDate();const safeD=Math.min(parseInt(d),maxD);setPtSupDate(y+"-"+m+"-"+String(safeD).padStart(2,"0"));}
}

function drumDayOpts(){return Array.from({length:31},(_,i)=>({value:String(i+1).padStart(2,"0"),label:String(i+1).padStart(2,"0")}))}

function applyContratFilters(){
  const fe=document.getElementById("flt-essai")?.value||"";
  const fc=document.getElementById("flt-contrat")?.value||"";
  const fs=(document.getElementById("flt-search")?.value||"").toLowerCase().trim();
  const quick=String(window.__contractQuickFilter||"");
  const t=today();
  const rows=document.querySelectorAll("#ct-tbody tr[data-row]");
  let shown=0;
  rows.forEach(r=>{
    const e=r.dataset.finessai||"";
    const c=r.dataset.fincontrat||"";
    const contractKind=String(r.dataset.contractkind||"").toUpperCase();
    const eDays=e?daysBetween(t,e):null;
    const cDays=c?daysBetween(t,c):null;
    let ok=true;
    if(fs&&!(r.dataset.q||"").includes(fs))ok=false;
    if(ok&&quick){
      if(quick==="type:cdi")ok=contractKind==="CDI";
      else if(quick==="type:cdd")ok=contractKind==="CDD";
      else if(quick==="type:autre")ok=contractKind!=="CDI"&&contractKind!=="CDD";
      else if(quick==="alert90")ok=((contractKind==="CDD"&&cDays!==null&&cDays>=0&&cDays<=90)||(eDays!==null&&eDays>=0&&eDays<=90));
      else if(quick==="essai")ok=eDays!==null&&eDays>=0;
      else if(quick==="essai30")ok=eDays!==null&&eDays>=0&&eDays<=30;
      else if(quick==="essai90")ok=eDays!==null&&eDays>=0&&eDays<=90;
      else if(quick==="essaiExpired")ok=eDays!==null&&eDays<0;
      else if(quick==="cddExpired")ok=contractKind==="CDD"&&cDays!==null&&cDays<0;
      else if(quick==="cdd30")ok=contractKind==="CDD"&&cDays!==null&&cDays>=0&&cDays<=30;
      else if(quick==="cdd90")ok=contractKind==="CDD"&&cDays!==null&&cDays>=0&&cDays<=90;
    }
    if(ok&&fe){
      if(fe==="none"){if(e)ok=false}
      else if(!e)ok=false;
      else{const d=eDays;
        if(fe==="passed"&&d>=0)ok=false;
        else if(fe==="upcoming"&&d<0)ok=false;
        else if(fe==="30"&&!(d>=0&&d<=30))ok=false;
        else if(fe==="60"&&!(d>=0&&d<=60))ok=false;
        else if(fe==="90"&&!(d>=0&&d<=90))ok=false;
      }
    }
    if(ok&&fc){
      if(fc==="none"){if(c)ok=false}
      else if(!c)ok=false;
      else{const d=cDays;
        if(fc==="passed"&&d>=0)ok=false;
        else if(fc==="upcoming"&&d<0)ok=false;
        else if(fc==="30"&&!(d>=0&&d<=30))ok=false;
        else if(fc==="60"&&!(d>=0&&d<=60))ok=false;
        else if(fc==="90"&&!(d>=0&&d<=90))ok=false;
      }
    }
    r.classList.toggle("hidden",!ok);
    if(ok)shown++;
  });
  const sh=document.getElementById("ct-shown");if(sh)sh.textContent=shown;
  refreshContractSituationRowNumbers(document.getElementById("ct-tbody"));
}

function resetContratFilters(){window.__contractQuickFilter="";document.querySelectorAll(".contract-metric-click.is-selected").forEach(el=>el.classList.remove("is-selected"));["flt-essai","flt-contrat","flt-search"].forEach(id=>{const el=document.getElementById(id);if(el)el.value=""});applyContratFilters()}

function setContratQuickFilter(type){
  if(!document.getElementById("ct-tbody")){
    sessionStorage.setItem("sgdi-contract-list-filter",String(type||"all"));
    navigate("contrats/situation");
    return;
  }
  resetContratFilters();
  if(type==="all"){
    applyContratFilters();
    const table=document.getElementById("ct-tbody");if(table)table.scrollIntoView({behavior:"smooth",block:"start"});
    return;
  }
  window.__contractQuickFilter=type;
  if(type==="essai"){
    const e=document.getElementById("flt-essai");if(e)e.value="upcoming";
  }else if(type==="essai30"||type==="essai90"){
    const e=document.getElementById("flt-essai");if(e)e.value=type==="essai30"?"30":"90";
  }else if(type==="cdd"){
    const c=document.getElementById("flt-contrat");if(c)c.value="90";
  }else if(type==="cdd30"||type==="cdd90"){
    const c=document.getElementById("flt-contrat");if(c)c.value=type==="cdd30"?"30":"90";
  }else if(type==="cddExpired"){
    const c=document.getElementById("flt-contrat");if(c)c.value="passed";
  }else if(type==="essaiExpired"){
    const e=document.getElementById("flt-essai");if(e)e.value="passed";
  }
  drumRender("flt-essai");drumRender("flt-contrat");applyContratFilters();
  const table=document.getElementById("ct-tbody");if(table)table.scrollIntoView({behavior:"smooth",block:"start"});
}

function openContractPortfolioStats(){
  const socFilter=currentStructureSocieteFilter();
  const agents=(db.agents||[]).filter(a=>!employeeIsFormer(a)&&(!socFilter||a.societe===socFilter));
  const avenants=(db.avenants||[]).filter(av=>agents.some(a=>String(a.id)===String(av.agentId)));
  const today_=today();
  const countType=type=>agents.filter(a=>cleanContractType(a.typeContrat)===type).length;
  const expired=agents.filter(a=>{const d=employeePositionContractDaysLeft(a,today_);return cleanContractType(a.typeContrat)==="CDD"&&d!==null&&d<0}).length;
  const due30=agents.filter(a=>{const d=employeePositionContractDaysLeft(a,today_);return cleanContractType(a.typeContrat)==="CDD"&&d!==null&&d>=0&&d<=30}).length;
  const trials=agents.filter(a=>a.dateFinEssai&&daysBetween(today_,a.dateFinEssai)>=0).length;
  const card=(label,value,color,action)=>`<button type="button" class="card p-4 text-left" style="border-color:${color};cursor:pointer" onclick="closeModal();${action}"><div class="text-xs uppercase font-black text-slate-500">${escapeHTML(label)}</div><div class="text-3xl font-black mt-2" style="color:${color}">${value}</div><div class="text-xs text-slate-400 mt-1">Ouvrir la liste →</div></button>`;
  openModal(`<div class="flex items-start justify-between gap-3 mb-5"><div><h2 class="text-xl font-black">Statistiques du portefeuille contractuel</h2><p class="text-sm text-slate-500">${escapeHTML(socFilter||"Toutes les sociétés")} · ${agents.length} contrat(s) actif(s)</p></div><button class="btn btn-ghost" onclick="closeModal()">Fermer</button></div><div class="grid grid-cols-2 md:grid-cols-3 gap-3">${card("CDD",countType("CDD"),"#0d6ecc",`setContratQuickFilter('type:cdd')`)}${card("CDI",countType("CDI"),"#16a34a",`setContratQuickFilter('type:cdi')`)}${card("Échéances ≤ 30 jours",due30,"#d97706",`setContratQuickFilter('cdd30')`)}${card("CDD expirés",expired,"#dc2626",`setContratQuickFilter('cddExpired')`)}${card("Essais en cours",trials,"#7c3aed",`setContratQuickFilter('essai')`)}${card("Avenants",avenants.length,"#0891b2",`navigate('contrats/avenants')`)}</div>`);
}

function contratPersonnelOptions(selectedId,poste){
  ensureContratsPersonnel();
  const selected=String(selectedId||"");
  const backend=activeBackendContractTemplates();
  const legacy=(db.contratsPersonnel||[]).filter(c=>c.actif!==false);
  if(!backend.length&&!legacy.length)return `<option value="">Aucun modèle actif — ajoutez-le dans Administration système > CONTRAT</option>`;
  const backendHTML=backend.map(t=>{const v=`tpl:${t.id}`;const typ=cleanContractType(t.contract_type);const auto=!selected&&poste&&(t.position===poste||t.function===poste);return`<option value="${v}" ${(selected===v||selected===String(t.id)||auto)?"selected":""}>${escapeHTML(t.title)}${typ?` — ${escapeHTML(typ)}`:""} ${t.position?`· ${escapeHTML(t.position)}`:""}</option>`}).join("");
  const legacyHTML=legacy.map(c=>{const v=`legacy:${c.id}`;return`<option value="${v}" ${(selected===v||selected===String(c.id)||(!selected&&poste&&c.poste===poste))?"selected":""}>${escapeHTML(c.titre||c.poste)} — ${escapeHTML(c.poste||"")}</option>`}).join("");
  return `<option value="">— Choisir un modèle —</option>`+backendHTML+legacyHTML;
}

function selectAutoContractForPoste(poste){
  const sel=document.querySelector('[name=contratPersonnelId]');
  const auto=contratPersonnelByPoste(poste);
  if(sel&&auto){
    sel.value=auto.file_name!==undefined?`tpl:${auto.id}`:`legacy:${auto.id}`;
  }
  updateContratPersonnelPreview();
}

function updateContratPersonnelPreview(){
  const f=document.getElementById("contract-form");if(!f)return;
  const poste=f.querySelector('[name="posteContrat"]')?.value||"";
  const sel=f.querySelector('[name="contratPersonnelId"]');
  if(!sel)return;
  if(poste){
    const auto=contratPersonnelByPoste(poste);
    if(auto&&!sel.value)sel.value=auto.file_name!==undefined?`tpl:${auto.id}`:`legacy:${auto.id}`;
  }
  const c=contractModelByValue(sel.value);
  const title=document.getElementById("contrat-personnel-title");
  const prev=document.getElementById("contrat-personnel-preview");
  if(title)title.textContent=c?(c.title||c.titre):"Aucun contrat spécifique sélectionné";
  if(prev)prev.textContent=c?(c.description||c.texte||`Modèle Word PostgreSQL : ${c.file_name||""}`):"Sélectionnez un poste ou un modèle dans Administration système > CONTRAT.";
}

async function loadContractualisationContractTemplates(){
  const f=document.getElementById("contract-form");if(!f)return;
  try{
    window.__contractTemplates=(await SGDI.rh.contractTemplates()).filter(t=>Number(t.active)!==0);
    const sel=f.querySelector('[name="contratPersonnelId"]');
    if(sel)sel.innerHTML=contratPersonnelOptions(sel.value,f.querySelector('[name="posteContrat"]')?.value||"");
    updateContratPersonnelPreview();
  }catch(e){
    console.warn("Modèles contrat PostgreSQL indisponibles",e);
  }
}

function setContractualisationSociete(id,societe){
  const c=findCandidatById(id);if(!c)return;
  c.societe=societe||"";
  saveDB();
  toast("Société sélectionnée","success");
  renderView();
}

function confirmEmbaucherCandidat(id){
  const c=findCandidatById(id);if(!c){toast("Introuvable","error");return}
  const name=String((c.nom||"")+" "+(c.prenom||"")).trim()||"ce candidat";
  openModal(`<div class="text-center p-2">
    <h3 class="font-black text-lg mb-3">Confirmation recrutement</h3>
    <p class="text-sm text-slate-700 mb-5">Voulez vous recruter ce candidat : <b>${escapeHTML(name)}</b> ?</p>
    <div class="flex justify-center gap-3">
      <button type="button" class="btn btn-danger" onclick="closeModal()">NON</button>
      <button type="button" class="btn btn-success" onclick="closeModal();embaucherCandidat('${jsString(id)}')">OUI</button>
    </div>
  </div>`);
}

function contractFormDataOrNull(form){return form?new FormData(form):null}

async function embaucherCandidat(id){
  const c=findCandidatById(id);if(!c){toast("Introuvable","error");return}
  try{
    const agent=await recruitContractCandidateToEmployee(c,contractFormDataOrNull(document.getElementById("contract-form")));
    await sgdiBackendSaveAndWait();
    toastCenter("NOUVEAU EMPLOYÉ CRÉÉ","success");
    navigate(`agents/${agent.id}`);
  }catch(e){
    toast("Recrutement non enregistré dans le backend : "+(e.message||e),"error");
  }
}

SGDIModules.registerModule({key: "contracts", routes: ["contrats"], dependencies: [], init: function(){}, destroy: function(){}});
