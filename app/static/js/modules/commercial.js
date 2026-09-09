/* Phase 2 — commercial. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2h-inventory.json. */
function commTabs(active){return ""}

function statutProspectPill(s){return{"nouveau":"pill-blue","contacte":"pill-indigo","interesse":"pill-amber","rdv_planifie":"pill-amber","rdv_realise":"pill-amber","converti":"pill-green","perdu":"pill-red"}[s]||"pill-gray"}

function etapeOppPill(e){return{"nouveau":"pill-blue","qualification":"pill-indigo","proposition":"pill-amber","negociation":"pill-amber","gagnee":"pill-green","perdue":"pill-red"}[e]||"pill-gray"}

function renderCommercial(view,sub,arg){
  if(sub==="dashboard")return renderCommDashboard(view);
  if(sub==="calendrier")return renderCommCalendrier(view);
  if(sub==="prospects")return renderCommProspects(view,arg);
  if(sub==="clients")return renderCommClients(view,arg);
  if(sub==="opportunites")return renderCommOpportunites(view,arg);
  if(sub==="visites")return renderCommVisites(view);
  if(sub==="devis")return renderCommDevis(view);
  if(sub==="catalogue")return renderCommCatalogue(view);
  if(sub==="tarifs")return renderCommTarifs(view);
  if(sub==="stats")return renderCommStats(view);
  renderCommDashboard(view);
}

function renderCommCalendrier(view){
  const now=new Date();
  let year=parseInt(view.dataset.calYear||now.getFullYear()),month=parseInt(view.dataset.calMonth??now.getMonth());
  view.dataset.calYear=year;view.dataset.calMonth=month;
  // Collect all meetings from clients
  const events=[];
  (db.clients||[]).forEach(c=>{
    (c.prosp_reunions||[]).forEach(r=>{if(r.date)events.push({date:r.date,type:"prosp",client:c.nom||"",lieu:r.lieu||"",rapport:r.rapport||"",actions:r.actions||""})});
    (c.negos_reunions||[]).forEach(r=>{if(r.date)events.push({date:r.date,type:"negos",client:c.nom||"",lieu:r.lieu||"",rapport:r.rapport||"",actions:r.actions||""})});
  });
  const byDate={};
  events.forEach(e=>{byDate[e.date]=byDate[e.date]||[];byDate[e.date].push(e)});
  // Calendar grid
  const firstDay=new Date(year,month,1);
  const lastDay=new Date(year,month+1,0);
  const startDow=(firstDay.getDay()+6)%7; // Monday=0
  const MONTHS=["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const DAYS=["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
  const taches=(db.calTaches||[]);
  const tachesByDate={};
  taches.forEach(t=>{if(t.date){tachesByDate[t.date]=tachesByDate[t.date]||[];tachesByDate[t.date].push(t)}});
  let cells="";
  for(let d=0;d<startDow;d++)cells+=`<div style="min-height:80px;background:#f8fafc;border-radius:6px"></div>`;
  for(let d=1;d<=lastDay.getDate();d++){
    const dateStr=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dayEvents=byDate[dateStr]||[];
    const dayTaches=tachesByDate[dateStr]||[];
    const isToday=dateStr===today();
    const dots=dayEvents.map(e=>`<div style="margin:2px 0;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:${e.type==="prosp"?"#dbeafe":"#ede9fe"};color:${e.type==="prosp"?"#1d4ed8":"#7c3aed"};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" onclick="sgdiCalShowEvent(${JSON.stringify(JSON.stringify(e))})" title="${escapeHTML(e.client)}">${escapeHTML(e.client)} · ${e.type==="prosp"?"Prosp.":"Negos"}</div>`).join("");
    const tacheDots=dayTaches.map((t,i)=>`<div style="margin:2px 0;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:#fef9c3;color:#854d0e;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:4px" onclick="sgdiCalShowTache(${JSON.stringify(JSON.stringify({...t,_idx:taches.indexOf(t)}))})" title="${escapeHTML(t.titre||"")}">&#9998; ${escapeHTML(t.titre||"Tâche")}</div>`).join("");
    cells+=`<div style="min-height:80px;padding:6px;border-radius:6px;background:${isToday?"#eff6ff":"#fff"};border:1px solid ${isToday?"#93c5fd":"#e2e8f0"};cursor:pointer" onclick="sgdiCalAddTache('${dateStr}')" title="Ajouter une tâche">
      <div style="font-size:12px;font-weight:${isToday?"900":"600"};color:${isToday?"#1d4ed8":"#334155"};margin-bottom:4px">${d}</div>
      ${dots}${tacheDots}
    </div>`;
  }
  const prevMonth=month===0?{y:year-1,m:11}:{y:year,m:month-1};
  const nextMonth=month===11?{y:year+1,m:0}:{y:year,m:month+1};
  view.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h1 style="font-size:20px;font-weight:800;color:#0f2d5a">📅 Calendrier Commercial</h1>
      <div style="display:flex;align-items:center;gap:10px">
        <button class="btn btn-ghost" style="font-size:16px;line-height:1;color:#0f2d5a" onclick="var v=document.getElementById('view');v.dataset.calYear=${prevMonth.y};v.dataset.calMonth=${prevMonth.m};renderView()">&laquo; Préc.</button>
        <span style="font-size:15px;font-weight:800;color:#0f2d5a;min-width:160px;text-align:center">${MONTHS[month]} ${year}</span>
        <button class="btn btn-ghost" style="font-size:16px;line-height:1;color:#0f2d5a" onclick="var v=document.getElementById('view');v.dataset.calYear=${nextMonth.y};v.dataset.calMonth=${nextMonth.m};renderView()">Suiv. &raquo;</button>
      </div>
      <div style="display:flex;gap:10px;font-size:12px">
        <span style="background:#dbeafe;color:#1d4ed8;padding:3px 10px;border-radius:12px;font-weight:700">● Prospection</span>
        <span style="background:#ede9fe;color:#7c3aed;padding:3px 10px;border-radius:12px;font-weight:700">● Négociation</span>
        <span style="background:#fef9c3;color:#854d0e;padding:3px 10px;border-radius:12px;font-weight:700">✎ Tâche</span>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px">
      ${DAYS.map(d=>`<div style="text-align:center;font-size:11px;font-weight:700;color:#64748b;padding:4px 0">${d}</div>`).join("")}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">
      ${cells}
    </div>`;
}

function sgdiCalShowEvent(json){
  let e;try{e=JSON.parse(json)}catch(x){return}
  openModal(`<h3 style="font-size:15px;font-weight:800;color:#0f2d5a;margin-bottom:12px">${e.type==="prosp"?"Réunion Prospection":"Réunion Négociation"}</h3>
    <div style="display:grid;gap:8px">
      <div><span style="font-size:11px;color:#64748b;font-weight:700">CLIENT</span><div style="font-weight:800;color:#0f2d5a">${escapeHTML(e.client)}</div></div>
      <div><span style="font-size:11px;color:#64748b;font-weight:700">DATE</span><div>${escapeHTML(e.date)}</div></div>
      ${e.lieu?`<div><span style="font-size:11px;color:#64748b;font-weight:700">LIEU</span><div>${escapeHTML(e.lieu)}</div></div>`:""}
      ${e.rapport?`<div><span style="font-size:11px;color:#64748b;font-weight:700">RAPPORT</span><div style="white-space:pre-wrap;font-size:13px">${escapeHTML(e.rapport)}</div></div>`:""}
      ${e.actions?`<div><span style="font-size:11px;color:#64748b;font-weight:700">ACTIONS</span><div style="white-space:pre-wrap;font-size:13px">${escapeHTML(e.actions)}</div></div>`:""}
    </div>
    <div style="margin-top:14px;text-align:right"><button class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function sgdiCalAddTache(dateStr){
  openModal(`<h3 style="font-size:15px;font-weight:800;color:#0f2d5a;margin-bottom:14px">Nouvelle tâche — ${dateStr}</h3>
    <div style="display:grid;gap:10px">
      <div><label style="font-size:11px;font-weight:700;color:#64748b">TITRE *</label><input id="cal-tache-titre" class="sgdi-input" style="width:100%;margin-top:4px" placeholder="Ex: Appel client, RDV..."></div>
      <div><label style="font-size:11px;font-weight:700;color:#64748b">HEURE</label><input id="cal-tache-heure" type="time" class="sgdi-input" style="width:100%;margin-top:4px"></div>
      <div><label style="font-size:11px;font-weight:700;color:#64748b">NOTE</label><textarea id="cal-tache-note" class="sgdi-input" rows="3" style="width:100%;margin-top:4px;resize:vertical" placeholder="Détails..."></textarea></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button class="btn btn-ghost" onclick="closeModal()">Annuler</button>
      <button class="btn btn-primary" onclick="sgdiCalSaveTache('${escapeHTML(dateStr)}')">Enregistrer</button>
    </div>`);
  commercialModuleTimeout(()=>{const el=document.getElementById("cal-tache-titre");if(el)el.focus()},50);
}

function sgdiCalSaveTache(dateStr){
  const titre=(document.getElementById("cal-tache-titre")||{}).value||"";
  if(!titre.trim()){alert("Le titre est obligatoire");return;}
  const heure=(document.getElementById("cal-tache-heure")||{}).value||"";
  const note=(document.getElementById("cal-tache-note")||{}).value||"";
  if(!db.calTaches)db.calTaches=[];
  db.calTaches.push({date:dateStr,titre:titre.trim(),heure,note,id:Date.now()});
  saveDB();
  closeModal();
  renderView();
}

function sgdiCalShowTache(json){
  let t;try{t=JSON.parse(json)}catch(x){return}
  const idx=t._idx;
  openModal(`<h3 style="font-size:15px;font-weight:800;color:#0f2d5a;margin-bottom:12px">✎ ${escapeHTML(t.titre||"Tâche")}</h3>
    <div style="display:grid;gap:8px">
      <div><span style="font-size:11px;color:#64748b;font-weight:700">DATE</span><div>${escapeHTML(t.date||"")}</div></div>
      ${t.heure?`<div><span style="font-size:11px;color:#64748b;font-weight:700">HEURE</span><div>${escapeHTML(t.heure)}</div></div>`:""}
      ${t.note?`<div><span style="font-size:11px;color:#64748b;font-weight:700">NOTE</span><div style="white-space:pre-wrap;font-size:13px">${escapeHTML(t.note)}</div></div>`:""}
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:14px">
      <button class="btn btn-danger" onclick="sgdiCalDeleteTache(${idx})">Supprimer</button>
      <button class="btn btn-ghost" onclick="closeModal()">Fermer</button>
    </div>`);
}

function sgdiCalDeleteTache(idx){
  if(!db.calTaches)return;
  db.calTaches.splice(idx,1);
  saveDB();
  closeModal();
  renderView();
}

function commercialContractFinancePanel(){
  const scope=mySoc();
  const contracts=sgdiBackendModuleCounters("commercial",scope);
  const finance=sgdiBackendModuleCounters("facturation",scope);
  const value=(source,key,amount=false)=>{
    const n=source?.[key];
    return typeof n==="number"&&Number.isFinite(n)?(amount?money(n):String(n)):"—";
  };
  return `<article class="comm-modern-panel comm-contract-finance">
    <div class="comm-modern-panel-head"><h2>Contrats, facturation et paiements</h2><span>Société active · cumul enregistré</span></div>
    <div class="comm-contract-finance-grid">
      <div class="comm-contract-finance-card contracts"><span>Contrats actifs</span><strong>${value(contracts,"contracts_active")}</strong><small>Contrats commerciaux en vigueur</small></div>
      <div class="comm-contract-finance-card invoices"><span>Facturation TTC</span><strong>${value(finance,"invoiced_ttc",true)}</strong><small>${value(finance,"invoices_issued")} facture(s) · hors brouillons et annulations</small></div>
      <div class="comm-contract-finance-card payments"><span>Paiements enregistrés</span><strong>${value(finance,"payments_amount",true)}</strong><small>${value(finance,"payments_total")} paiement(s) enregistré(s)</small></div>
    </div>
    <p class="comm-contract-finance-note">${contracts?.contracts_active==null||finance?.invoiced_ttc==null||finance?.payments_amount==null?"Statistiques indisponibles ou en cours de synchronisation — aucun montant estimé.":"Source : contrats Commercial et écritures Facturation. Les paiements ne constituent pas un rapprochement bancaire."}</p>
  </article>`;
}

function refreshCommercialFinancePanel(){
  if(!["#/commercial", "#/commercial/dashboard"].includes(location.hash))return;
  const panel=document.querySelector("#view .comm-contract-finance");
  if(!panel)return;
  const markup=commercialContractFinancePanel();
  if(panel.__financeMarkup===markup)return;
  const template=document.createElement("template");template.innerHTML=markup;
  const replacement=template.content.firstElementChild;
  replacement.__financeMarkup=markup;
  panel.replaceWith(replacement);
}

function renderCommDashboard(view){
  const prospects=bySoc(db.prospects||[]);const clients=bySoc(db.clients||[]);const opps=bySoc(db.opportunites||[]);const visites=bySoc(db.visites||[]);
  const oppsActives=opps.filter(o=>!["gagnee","perdue"].includes(o.etape));
  const ca=opps.filter(o=>o.etape==="gagnee").reduce((s,o)=>s+(o.montant||0),0);
  const pipeline=oppsActives.reduce((s,o)=>s+((o.montant||0)*((o.probabilite||0)/100)),0);
  const tauxConv=prospects.length>0?Math.round((prospects.filter(p=>p.statut==="converti").length/prospects.length)*100):0;
  const contratsExpires=clients.filter(c=>c.dateFinContrat&&daysBetween(today(),c.dateFinContrat)<0);
  const contratsFin30=clients.filter(c=>{if(!c.dateFinContrat)return false;const d=daysBetween(today(),c.dateFinContrat);return d>=0&&d<=30});
  const contratsAlerte=[...contratsExpires,...contratsFin30].sort((a,b)=>String(a.dateFinContrat||"").localeCompare(String(b.dateFinContrat||"")));
  const upcomingVisits=visites.filter(v=>v.date>=today()).sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
  const priorities=[
    ...contratsAlerte.map(c=>({title:`Contrat · ${c.nom||c.raisonSociale||"Client"}`,meta:`Échéance ${formatDate(c.dateFinContrat)}`,status:daysBetween(today(),c.dateFinContrat)<0?"Expiré":"Prioritaire",tone:"warning"})),
    ...upcomingVisits.map(v=>({title:`Visite · ${v.client||v.clientNom||v.objet||"Client"}`,meta:`${formatDate(v.date)}${v.heure?` · ${v.heure}`:""}`,status:"Planifiée",tone:"info"})),
    ...oppsActives.map(o=>({title:o.nom||o.titre||o.client||"Opportunité commerciale",meta:`${String(o.etape||"nouveau").replaceAll("_"," ")} · ${money(o.montant||0)}`,status:"À suivre",tone:"info"}))
  ].slice(0,4);
  const wonCount=opps.filter(o=>o.etape==="gagnee").length;
  const avgWon=wonCount?ca/wonCount:0;
  view.innerHTML=`<div class="comm-modern-dashboard">
    <header class="comm-modern-head">
      <div><div class="comm-modern-eyebrow">Pilotage commercial</div><h1>Tableau de bord commercial</h1><p>${escapeHTML(mySoc()||"Toutes sociétés")} · clients, opportunités et performance</p></div>
      <div class="comm-modern-actions"><button type="button" class="btn btn-secondary" onclick="window.print()">Exporter</button><button type="button" class="btn btn-primary" onclick="openOpportuniteModal()">+ Nouvelle opportunité</button></div>
    </header>
    <section class="comm-modern-alert ${contratsAlerte.length?"is-warning":"is-ok"}">
      <div><strong>Suivi des contrats clients</strong><span>${contratsAlerte.length?`${contratsExpires.length} contrat(s) expiré(s) · ${contratsFin30.length} échéance(s) dans les 30 jours.`:"Aucune échéance critique dans les 30 prochains jours."}</span></div>
      <button type="button" onclick="navigate('commercial/clients')">${contratsAlerte.length?`${contratsAlerte.length} à traiter`:"Situation conforme"}</button>
    </section>
    <section class="comm-modern-kpis">
      <button type="button" class="comm-modern-kpi tone-blue" onclick="navigate('commercial/prospects')"><span>Prospects actifs</span><strong>${prospects.length}</strong><small>${prospects.filter(p=>p.statut==="nouveau").length} nouveau(x)</small></button>
      <button type="button" class="comm-modern-kpi tone-green" onclick="navigate('commercial/clients')"><span>Clients actifs</span><strong>${clients.filter(c=>c.statut!=="inactif").length}</strong><small>${contratsFin30.length} contrat(s) à surveiller</small></button>
      <button type="button" class="comm-modern-kpi tone-purple" onclick="navigate('commercial/opportunites')"><span>Pipeline pondéré</span><strong>${money(pipeline)}</strong><small>${oppsActives.length} opportunité(s) ouverte(s)</small></button>
      <button type="button" class="comm-modern-kpi tone-amber" onclick="navigate('commercial/opportunites')"><span>Chiffre d'affaires gagné</span><strong>${money(ca)}</strong><small>${wonCount} affaire(s) conclue(s)</small></button>
    </section>
    <section class="comm-modern-content">
      ${commercialContractFinancePanel()}
      <article class="comm-modern-panel"><div class="comm-modern-panel-head"><h2>Priorités</h2><span>${priorities.length} action(s)</span></div><div class="comm-modern-priorities">${priorities.length?priorities.map(p=>`<div class="comm-modern-priority"><div><strong>${escapeHTML(p.title)}</strong><small>${escapeHTML(p.meta)}</small></div><span class="${p.tone}">${escapeHTML(p.status)}</span></div>`).join(""):`<div class="comm-modern-empty">Aucune priorité commerciale en attente.</div>`}</div></article>
    </section>
    <section class="comm-modern-secondary">
      <button type="button" onclick="navigate('commercial/prospects')"><span>Taux de conversion</span><strong>${tauxConv}%</strong><small>Prospects transformés en clients</small></button>
      <button type="button" onclick="navigate('commercial/visites')"><span>Visites planifiées</span><strong>${upcomingVisits.length}</strong><small>${visites.length} visite(s) enregistrée(s)</small></button>
      <button type="button" onclick="navigate('commercial/opportunites')"><span>Valeur moyenne gagnée</span><strong>${money(avgWon)}</strong><small>Par affaire conclue</small></button>
    </section>
  </div>`;
}

function renderCommProspects(view){
  const list=bySoc(db.prospects||[]).slice().sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
  view.innerHTML=`<div class="flex justify-between items-center mb-2"><div><h1 class="text-2xl font-bold">🎯 Prospects</h1><p class="text-slate-500 text-sm">${list.length} prospects</p></div><button class="btn btn-primary" onclick="openProspectModal()">➕ Nouveau prospect</button></div>
    ${commTabs("prospects")}
    <div class="card overflow-hidden">${list.length===0?`<div class="p-10 text-center text-slate-500">Aucun prospect.</div>`:`<table><thead><tr><th>Nom</th><th>Contact</th><th>Téléphone</th><th>Email</th><th>Source</th><th>Score</th><th>Statut</th><th></th></tr></thead><tbody>${list.map(p=>`<tr data-searchable><td class="font-semibold">${escapeHTML(p.nom||"")}</td><td class="text-xs">${escapeHTML(p.contact||"")}</td><td class="text-xs">${escapeHTML(p.tel||"")}</td><td class="text-xs">${escapeHTML(p.email||"")}</td><td><span class="pill pill-gray">${safe(p.source)}</span></td><td><span class="pill pill-amber">${p.score||0}/10</span></td><td><select class="select text-xs" onchange="updateProspectStatut('${p.id}',this.value)">${STATUTS_PROSPECT.map(s=>`<option ${p.statut===s?"selected":""}>${s}</option>`).join("")}</select></td><td class="flex gap-1"><button class="btn btn-success text-xs" onclick="convertProspect('${p.id}')">→ Client</button><button class="btn btn-ghost text-xs text-red-600" onclick="deleteProspect('${p.id}')">✕</button></td></tr>`).join("")}</tbody></table>`}</div>`;
}

function openProspectModal(){
  openModal(`<h3 class="font-bold text-lg mb-4">🎯 Nouveau prospect</h3>
    <form onsubmit="event.preventDefault();confirmProspect()">
      <div class="grid grid-2 gap-3">
        <div class="col-span-2"><label class="label">Nom / Société *</label><input class="input" name="nom" /></div>
        <div><label class="label">Contact</label><input class="input" name="contact"/></div>
        <div><label class="label">Fonction</label><input class="input" name="fonction"/></div>
        <div><label class="label">Téléphone</label><input class="input" name="tel"/></div>
        <div><label class="label">Email</label><input class="input" type="email" name="email"/></div>
        <div class="col-span-2"><label class="label">Adresse</label><input class="input" name="adresse"/></div>
        <div><label class="label">Société émettrice</label><select class="select" name="societe" onchange="updateClientPrestationsOptions(this.value)">${SOCIETES.map(s=>`<option ${mySoc()===s?"selected":""}>${s}</option>`).join("")}</select></div>
        <div><label class="label">Source</label><select class="select" name="source"><option>Site web</option><option>Recommandation</option><option>Salon</option><option>Démarche directe</option><option>Réseaux sociaux</option><option>Autre</option></select></div>
        <div><label class="label">Score (1-10)</label><input class="input" type="number" min="1" max="10" name="score" value="5"/></div>
        <div><label class="label">Statut</label><select class="select" name="statut">${STATUTS_PROSPECT.map(s=>`<option>${s}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Notes</label><textarea class="input" name="notes" rows="2"></textarea></div>
      </div>
      <div class="flex gap-2 mt-4 justify-end"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">💾 Enregistrer</button></div>
    </form>`);
}

async function confirmProspect(){
  const fd=new FormData(document.querySelector(".modal-bg form"));
  const item={id:uid("pr"),nom:fd.get("nom"),contact:fd.get("contact")||"",fonction:fd.get("fonction")||"",tel:fd.get("tel")||"",email:fd.get("email")||"",adresse:fd.get("adresse")||"",societe:fd.get("societe"),source:fd.get("source"),score:parseInt(fd.get("score")||"5",10),statut:fd.get("statut")||"nouveau",notes:fd.get("notes")||""};
  try{
    await sgdiRunLegacyAction("create-item",{collection:"prospects",data:item});
    await sgdiPullState({silent:true});
    closeModal();toast("Prospect créé par le backend","success");renderView();
  }catch(e){toast("Création prospect refusée : "+(e.message||e),"error")}
}

async function updateProspectStatut(id,s){
  try{
    await sgdiRunLegacyAction("set-status",{collection:"prospects",item_id:id,data:{statut:s}});
    await sgdiPullState({silent:true});
    toast("Statut mis à jour par le backend","success");
    renderView();
  }catch(e){toast("Statut refusé : "+(e.message||e),"error");renderView()}
}

async function deleteProspect(id){
  if(!confirm("Supprimer ?"))return;
  try{
    await sgdiRunLegacyAction("delete-item",{collection:"prospects",item_id:id,data:{}});
    db.prospects=(db.prospects||[]).filter(p=>String(p.id)!==String(id));
    toast("Prospect supprimé par le backend","success");
    renderView();
  }catch(e){toast("Suppression refusée : "+(e.message||e),"error")}
}

async function convertProspect(id){
  const p=db.prospects.find(x=>x.id===id);if(!p)return;
  if(!confirm("Convertir "+p.nom+" en client ?"))return;
  try{
    await sgdiRunLegacyAction("convert-prospect",{item_id:id,data:{clientId:uid("cl")}});
    await sgdiPullState({silent:true});
    toast("Client créé par le backend","success");
    renderView();
  }catch(e){toast("Conversion refusée : "+(e.message||e),"error")}
}

async function renderCommClientsServer(view,options={}){
  const soc=mySoc();const page=sgdiServerCurrentPage("comm-clients",soc||"all");
  if(!options.preserveContent)view.innerHTML='<div style="padding:40px;text-align:center;color:#94a3b8;font-size:14px">Chargement des clients...</div>';
  sgdiShowDataLoadingBar("Chargement des clients...");
  try{
    const result=await SGDI.commercial.clientsPage({society:soc||undefined,page,page_size:25});
    const list=serverItems(result).map(clientFromApi);
    list.forEach(c=>sgdiUpsertServerItem("clients",c));
    if(!document.body.contains(view)||!String(location.hash||"").startsWith("#/commercial/clients"))return;
    // La requête de liste peut se terminer après l'ouverture de l'éditeur client.
    // Dans ce cas sa réponse est devenue obsolète : ne jamais remplacer le formulaire
    // (et les valeurs déjà saisies) par la liste reçue en arrière-plan.
    if(view.querySelector("form[data-client-editor='1']"))return;
    const _factReadOnly=session?.transverse==="facmod"||session?.transverse==="facturation";
    view.innerHTML=`<div class="clients-panel">
    <div class="clients-panel-header">
      <div class="clients-header-left">
        <div class="clients-title-block"><h1>Clients</h1><span class="clients-count-badge">${result?.total??list.length}</span></div>
        ${clientCommercialRecapHTML(list,result?.total??list.length)}
      </div>
      ${_factReadOnly?"":`<button class="btn btn-primary" onclick="openClientModal()">Créer client</button>`}
    </div>
    ${commTabs("clients")}
    <div class="clients-table-wrap">${list.length===0?clientsEmptyStateHTML(!_factReadOnly):`<table id="clients-table"><thead><tr>${[["nom","Nom"],["prestation","Prestation fournie"],["contact","Contact"],["tel","Tel"],["wilaya","Wilaya"],["nbrsite","Nbr site","center"],["nbr","Total eff.","center"],["montant","Montant TTC","right"],["fin","Fin contrat"],["statut","Statut"]].map(([col,label,align])=>`<th style="cursor:pointer;user-select:none;white-space:nowrap${align?";text-align:"+align:""}" onclick="clientTableSort('${col}')" id="clients-th-${col}">${label} <span id="clients-sort-${col}" style="font-size:10px;color:#94a3b8"></span></th>`).join("")}<th style="width:56px;text-align:center">Actions</th></tr></thead><tbody id="clients-tbody">${list.map(c=>{const d=c.dateFinContrat?daysBetween(today(),c.dateFinContrat):null;const alert=d!==null&&d<=30;const finCell=c.dateFinContrat?`<span class="pill ${d<0?"pill-red":d<=30?"pill-amber":"pill-green"}">${formatDate(c.dateFinContrat)}${d<0?" · expiré":d<=30?" · J-"+d:""}</span>`:"—";const ttc=clientMontantTTC(c);const montantCell=ttc>0?formatDZD(ttc):"—";const totalEffectif=clientTotalEffectif(c);const nbrSite=clientNbrSites(c);return `<tr data-searchable data-nom="${escapeHTML(c.nom||"").toLowerCase()}" data-prestation="${escapeHTML((c.prestationsServices||"").split("\n")[0]||"").toLowerCase()}" data-contact="${escapeHTML(c.contact||"").toLowerCase()}" data-tel="${escapeHTML(c.tel||"").toLowerCase()}" data-wilaya="${escapeHTML(c.wilaya||"").toLowerCase()}" data-nbr="${totalEffectif}" data-nbrsite="${nbrSite}" data-montant="${ttc}" data-fin="${c.dateFinContrat||""}" data-statut="${escapeHTML(c.statut||"").toLowerCase()}" style="${alert?"background:#fff7ed;":""}cursor:pointer" onclick="openClientModal('${c.id}',${_factReadOnly})" ><td class="font-semibold" style="color:#1d4ed8">${escapeHTML(c.nom||"")}</td><td class="text-xs">${escapeHTML((c.prestationsServices||"").split("\n")[0]||"—")}</td><td class="text-xs">${escapeHTML(c.contact||"")}</td><td class="text-xs">${escapeHTML(c.tel||"")}</td><td class="text-xs">${escapeHTML(c.wilaya||"—")}</td><td class="font-bold" style="text-align:center">${nbrSite}</td><td class="font-bold" style="text-align:center;color:#043970">${totalEffectif}</td><td class="text-xs font-mono" style="white-space:nowrap;text-align:right;padding-right:16px">${escapeHTML(montantCell)}</td><td class="text-xs">${finCell}</td><td><span class="pill ${c.statut==="actif"?"pill-green":"pill-gray"}">${safe(c.statut)}</span></td><td style="text-align:center"><button type="button" class="btn btn-ghost text-lg leading-none px-3" title="Actions" onclick="event.stopPropagation();sgdiClientRowMenu(this,'${jsString(c.id)}')">⋯</button></td></tr>`}).join("")}</tbody></table>`}</div>${sgdiServerPaginationHTML("comm-clients",soc||"all",result)}</div>`;
  }catch(e){
    console.warn("Clients serveur indisponibles",e);
    window.__sgdiCommClientsLocalFallback=true;
    if(!view.querySelector("form[data-client-editor='1']"))renderCommClients(view);
  }
}

function renderCommClients(view){
  const refreshFromServer=!!sgdiAuthToken()&&!window.__sgdiCommClientsLocalFallback;
  if(refreshFromServer){renderCommClientsServer(view);return;}
  const list=bySoc(db.clients||[]).slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||""));
  const _factRO=session?.transverse==="facmod"||session?.transverse==="facturation";
  view.innerHTML=`<div class="clients-panel">
    <div class="clients-panel-header">
      <div class="clients-header-left">
        <div class="clients-title-block"><h1>Clients</h1><span class="clients-count-badge">${list.length}</span></div>
        ${clientCommercialRecapHTML(list,list.length)}
      </div>
      ${_factRO?"":`<button class="btn btn-primary" onclick="openClientModal()">Créer client</button>`}
    </div>
    ${commTabs("clients")}
    <div class="clients-table-wrap">${list.length===0?clientsEmptyStateHTML(!_factRO):`<table><thead><tr><th>Nom</th><th>Prestation fournie</th><th>Contact</th><th>Tel</th><th>Wilaya</th><th style="text-align:center">Nbr site</th><th style="text-align:center">Total eff.</th><th>Fin contrat</th><th>Statut</th><th style="width:56px;text-align:center">Actions</th></tr></thead><tbody>${list.map(c=>{const d=c.dateFinContrat?daysBetween(today(),c.dateFinContrat):null;const alert=d!==null&&d<=30;const finCell=c.dateFinContrat?`<span class="pill ${d<0?"pill-red":d<=30?"pill-amber":"pill-green"}">${formatDate(c.dateFinContrat)}${d<0?" · expiré":d<=30?" · J-"+d:""}</span>`:"—";const nbrSite=clientNbrSites(c);const totalEffectif=(c.tech_sites||[]).reduce((sum,site)=>sum+clientSiteEffectif(site),0);return`<tr data-searchable style="${alert?"background:#fff7ed;":""}cursor:pointer" onclick="openClientModal('${c.id}',${_factRO})"><td class="font-semibold" style="color:#1d4ed8">${escapeHTML(c.nom||"")}</td><td class="text-xs">${escapeHTML((c.prestationsServices||"").split("\n")[0]||"—")}</td><td class="text-xs">${escapeHTML(c.contact||"")}</td><td class="text-xs">${escapeHTML(c.tel||"")}</td><td class="text-xs">${escapeHTML(c.wilaya||"—")}</td><td class="font-bold" style="text-align:center">${nbrSite}</td><td class="font-bold" style="text-align:center;color:#043970">${totalEffectif}</td><td class="text-xs">${finCell}</td><td><span class="pill ${c.statut==="actif"?"pill-green":"pill-gray"}">${safe(c.statut)}</span></td><td style="text-align:center"><button type="button" class="btn btn-ghost text-lg leading-none px-3" title="Actions" onclick="event.stopPropagation();sgdiClientRowMenu(this,'${jsString(c.id)}')">⋯</button></td></tr>`}).join("")}</tbody></table>`}</div></div>`;
}

function updateClientPrestationsOptions(societe){
  const sel=document.querySelector('.modal-bg [name="prestationsServices"]');
  if(sel)sel.innerHTML=commPrestationsOptionsHTML(societe);
}

async function confirmClientTechOnly(){
  techSitesSyncHidden();
  const form=document.querySelector("#view form")||document.querySelector(".modal-bg form");
  if(!form)return;
  const fd=new FormData(form);
  const clientId=form.dataset.clientId||form.getAttribute("onsubmit")?.match(/confirmClient\('([^']*)'\)/)?.[1]||"";
  const backendId=form.dataset.clientBackendId||"";
  let c=(db.clients||[]).find(x=>String(x.id)===String(clientId)||String(x.backendId||"")===String(clientId)||backendId&&String(x.backendId||"")===String(backendId));
  if(!c){toast("Client introuvable","error");return;}
  let tech_sites=[];
  try{tech_sites=JSON.parse(fd.get("tech_sites")||"[]")}catch(e){}
  Object.assign(c,{
    tech_denomination:fd.get("tech_denomination")||"",tech_typeSite:fd.get("tech_typeSite")||"",
    tech_adresse:fd.get("tech_adresse")||"",tech_commune:fd.get("tech_commune")||"",tech_wilaya:fd.get("tech_wilaya")||"",
    tech_nbrSite:parseInt(fd.get("tech_nbrSite")||"0")||0,
    tech_sites,tech_valide:true,updatedAt:new Date().toISOString()
  });
  try{await persistClientToPostgres(c)}catch(e){toast("Sauvegarde impossible : "+(e.message||e),"error");return;}
  clientSitesMirror("ts");
  toast("Données techniques enregistrées","success");
  // La fiche reste éditable après sauvegarde. Seuls les totaux calculés restent en lecture seule.
  techUnlockDonneesTechniques();
}

function techSitesRerender(val){
  clientSitesResize("ts",val);
}

function clientTableSort(col){
  const tbody=document.getElementById("clients-tbody");
  if(!tbody)return;
  if(_clientSortCol===col){_clientSortAsc=!_clientSortAsc;}else{_clientSortCol=col;_clientSortAsc=true;}
  document.querySelectorAll("[id^='clients-sort-']").forEach(el=>el.textContent="");
  const ind=document.getElementById("clients-sort-"+col);
  if(ind)ind.textContent=_clientSortAsc?"▲":"▼";
  const rows=[...tbody.querySelectorAll("tr[data-nom]")];
  const numCols=new Set(["nbr","nbrsite","montant"]);
  rows.sort((a,b)=>{
    let va=a.dataset[col]||"",vb=b.dataset[col]||"";
    if(numCols.has(col)){va=parseFloat(va)||0;vb=parseFloat(vb)||0;return _clientSortAsc?va-vb:vb-va;}
    return _clientSortAsc?va.localeCompare(vb,"fr"):vb.localeCompare(va,"fr");
  });
  rows.forEach(r=>tbody.appendChild(r));
}

function openClientDetail(id){
  const c=(db.clients||[]).find(x=>x.id===id);
  if(!c){toast("Client introuvable","error");return;}
  const ht=(c.lignesFacturation||[]).reduce((s,l)=>s+(l.prixUnitaire||0)*(l.qte||1),0);
  const tva=ht*0.19;const ttc=ht+tva;
  const totalQte=(c.lignesFacturation||[]).reduce((s,l)=>s+(parseFloat(l.qte)||1),0);
  const lignesRows=(c.lignesFacturation||[]).map(l=>`<tr><td style="padding:6px 10px;border:1px solid #e2e8f0">${escapeHTML(l.designation||"")}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right">${formatDZD(l.prixUnitaire||0)}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">${l.qte||1}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-weight:700">${formatDZD((l.prixUnitaire||0)*(l.qte||1))}</td></tr>`).join("");
  const row=(label,val)=>val?`<tr><td style="padding:5px 10px;color:#64748b;font-size:12px;font-weight:700;width:160px">${label}</td><td style="padding:5px 10px;font-size:13px;font-weight:600">${val}</td></tr>`:"";
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Fiche Client — ${escapeHTML(c.nom||"")}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;color:#0f172a;padding:30px;font-size:13px}
    h1{font-size:20px;font-weight:900;color:#043970;margin-bottom:4px}
    h2{font-size:13px;font-weight:800;color:#043970;text-transform:uppercase;letter-spacing:.05em;margin:18px 0 6px;padding-bottom:4px;border-bottom:2px solid #043970}
    table{width:100%;border-collapse:collapse}
    .pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700}
    .pill-green{background:#dcfce7;color:#15803d}
    .pill-gray{background:#f1f5f9;color:#475569}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:3px solid #043970}
    .logo-block{font-size:11px;color:#64748b;text-align:right}
    @media print{body{padding:15px}.no-print{display:none}}
  </style></head><body>
  <div class="header">
    <div>
      <h1>${escapeHTML(c.nom||"")}</h1>
      ${c.raisonSociale?`<div style="font-size:12px;color:#64748b;margin-top:2px">${escapeHTML(c.raisonSociale)}</div>`:""}
      <span class="pill ${c.statut==="actif"?"pill-green":"pill-gray"}" style="margin-top:6px;display:inline-block">${escapeHTML((c.statut||"").toUpperCase())}</span>
    </div>
    <div style="display:flex;gap:20px;align-items:flex-start">
      ${(c.tech_sites||[]).filter(s=>s.denomination||s.nom).length?`
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;min-width:180px;background:#f8fafc">
        <div style="font-size:10px;font-weight:800;color:#043970;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Liste des sites</div>
        <ul style="list-style:none;padding:0;margin:0">
          ${(c.tech_sites||[]).filter(s=>s.denomination||s.nom).map((s,i)=>`
          <li style="font-size:12px;font-weight:600;color:#1e293b;padding:3px 0;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:6px">
            <span style="background:#043970;color:#fff;border-radius:50%;width:16px;height:16px;font-size:9px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</span>
            ${escapeHTML(s.denomination||s.nom||"")}
          </li>`).join("")}
        </ul>
      </div>`:""}
      <div class="logo-block">
        <div style="font-size:11px;color:#94a3b8">Fiche client</div>
        <div style="font-size:11px;color:#94a3b8">Imprimé le ${new Date().toLocaleDateString("fr-DZ")}</div>
        ${c.societe?`<div style="font-weight:700;color:#043970;margin-top:4px">${escapeHTML(c.societe)}</div>`:""}
      </div>
    </div>
  </div>
  <h2>Identification</h2>
  <table><tbody>
    ${row("NIF",c.nif)}${row("RC",c.rc)}
    ${row("Adresse",c.adresse)}${row("Commune",c.commune)}${row("Wilaya",c.wilaya)}
  </tbody></table>
  <h2>Contact</h2>
  <table><tbody>
    ${row("Nom du contact",c.contact)}${row("Fonction",c.fonction)}
    ${row("Téléphone",c.tel)}${row("Email",c.email)}
  </tbody></table>
  <h2>Contrat</h2>
  <table><tbody>
    ${row("Date début",c.dateDebutContrat?formatDate(c.dateDebutContrat):"")}
    ${row("Durée",c.dureeContrat)}
    ${row("Date fin",c.dateFinContrat?formatDate(c.dateFinContrat):"")}
    ${row("Prestations",c.prestationsServices)}
  </tbody></table>
  ${(c.lignesFacturation||[]).length?`
  <h2>Lignes de facturation</h2>
  <table style="font-size:12px"><thead><tr style="background:#f1f5f9">
    <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left">Désignation</th>
    <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;width:140px">Prix unitaire</th>
    <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center;width:60px">Qté</th>
    <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;width:140px">Total</th>
  </tr></thead><tbody>${lignesRows}</tbody>
  <tfoot>
    <tr><td colspan="2" style="border:none"></td><td style="padding:5px 10px;border:1px solid #e2e8f0;text-align:center;font-weight:700">Total Qté : ${totalQte}</td><td style="border:none"></td></tr>
    <tr><td colspan="3" style="padding:5px 10px;text-align:right;border:none;color:#64748b">Total HT</td><td style="padding:5px 10px;border:1px solid #e2e8f0;text-align:right;font-weight:700">${formatDZD(ht)}</td></tr>
    <tr><td colspan="3" style="padding:5px 10px;text-align:right;border:none;color:#64748b">TVA 19%</td><td style="padding:5px 10px;border:1px solid #e2e8f0;text-align:right;font-weight:700">${formatDZD(tva)}</td></tr>
    <tr style="background:#eff6ff"><td colspan="3" style="padding:7px 10px;text-align:right;border:1px solid #bfdbfe;font-weight:800;color:#043970">Total TTC</td><td style="padding:7px 10px;border:1px solid #bfdbfe;text-align:right;font-weight:900;color:#043970;font-size:14px">${formatDZD(ttc)}</td></tr>
  </tfoot></table>`:""}
  ${c.modePaiement||c.delaiPaiement||c.conditionsPaiement?`
  <h2>Conditions de paiement</h2>
  <table><tbody>
    ${row("Mode de paiement",c.modePaiement)}${row("Délai",c.delaiPaiement)}
    ${row("Conditions",c.conditionsPaiement)}
    ${c.contratValide?row("Contrat validé","Oui — le "+formatDate(c.contratValideLe||"")):""}
  </tbody></table>`:""}
  ${c.notes?`<h2>Notes</h2><p style="font-size:13px;padding:8px 0">${escapeHTML(c.notes)}</p>`:""}
  <div class="no-print" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="padding:10px 28px;background:#043970;color:#fff;border:none;border-radius:999px;font-size:14px;font-weight:700;cursor:pointer">Imprimer</button>
    <button onclick="window.close()" style="margin-left:10px;padding:10px 28px;background:#f1f5f9;color:#334155;border:none;border-radius:999px;font-size:14px;font-weight:700;cursor:pointer">Fermer</button>
  </div>
  </body></html>`;
  const w=window.open("","_blank","width=850,height=900");
  if(w){w.document.write(html);w.document.close();}
}

function sgdiClientRowMenu(btn,id){
  document.querySelectorAll(".sgdi-client-row-menu").forEach(m=>m.remove());
  const rect=btn.getBoundingClientRect();
  const menu=document.createElement("div");
  menu.className="sgdi-client-row-menu";
  menu.style.cssText=`position:fixed;left:${rect.right-150}px;top:${rect.bottom+4}px;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.14);min-width:150px;overflow:hidden`;
  menu.innerHTML=`<button style="display:block;width:100%;text-align:left;padding:10px 16px;font-size:13px;font-weight:600;background:none;border:none;cursor:pointer;color:#0f172a" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'" onclick="document.querySelectorAll('.sgdi-client-row-menu').forEach(m=>m.remove());openClientDetail('${id}')">Détail</button><button style="display:block;width:100%;text-align:left;padding:10px 16px;font-size:13px;font-weight:600;background:none;border:none;cursor:pointer;color:#0f172a" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'" onclick="document.querySelectorAll('.sgdi-client-row-menu').forEach(m=>m.remove());openClientModal('${id}')">Modifier</button>`;
  document.body.appendChild(menu);
  commercialModuleTimeout(()=>{document.removeEventListener("click",commercialDismissMenu);document.addEventListener("click",commercialDismissMenu,{once:true})},0);
}

function renderCommOpportunites(view){
  const list=bySoc(db.opportunites||[]).slice().sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
  view.innerHTML=`<div class="flex justify-between items-center mb-2"><div><h1 class="text-2xl font-bold">💼 Opportunités</h1><p class="text-slate-500 text-sm">${list.length} opportunités</p></div><button class="btn btn-primary" onclick="openOpportuniteModal()">➕ Nouvelle opportunité</button></div>
    ${commTabs("opportunites")}
    <div class="card overflow-hidden">${list.length===0?`<div class="p-10 text-center text-slate-500">Aucune opportunité.</div>`:`<table><thead><tr><th>Intitulé</th><th>Client/Prospect</th><th>Montant</th><th>Probabilité</th><th>Pondéré</th><th>Date clôture</th><th>Étape</th><th></th></tr></thead><tbody>${list.map(o=>{const cl=db.clients.find(x=>x.id===o.clientId);const pr=db.prospects.find(x=>x.id===o.prospectId);return`<tr data-searchable><td class="font-semibold">${escapeHTML(o.intitule||"")}</td><td class="text-xs">${escapeHTML(cl?.nom||pr?.nom||o.cible||"")}</td><td class="font-bold">${money(o.montant)}</td><td><span class="pill pill-amber">${o.probabilite||0}%</span></td><td class="text-indigo-600">${money((o.montant||0)*((o.probabilite||0)/100))}</td><td class="text-xs">${o.dateCloture?formatDate(o.dateCloture):"—"}</td><td><select class="select text-xs" onchange="updateOppEtape('${o.id}',this.value)">${ETAPES_OPP.map(e=>`<option ${o.etape===e?"selected":""}>${e}</option>`).join("")}</select></td><td><button class="btn btn-ghost text-xs text-red-600" onclick="deleteOpp('${o.id}')">✕</button></td></tr>`}).join("")}</tbody></table>`}</div>`;
}

function openOpportuniteModal(){
  const clOpts=(db.clients||[]).map(c=>`<option value="${c.id}">${escapeHTML(c.nom)}</option>`).join("");
  const prOpts=(db.prospects||[]).map(p=>`<option value="${p.id}">${escapeHTML(p.nom)}</option>`).join("");
  openModal(`<h3 class="font-bold text-lg mb-4">💼 Nouvelle opportunité</h3>
    <form onsubmit="event.preventDefault();confirmOpportunite()">
      <div class="grid grid-2 gap-3">
        <div class="col-span-2"><label class="label">Intitulé *</label><input class="input" name="intitule" /></div>
        <div><label class="label">Client</label><select class="select" name="clientId"><option value="">— ou prospect —</option>${clOpts}</select></div>
        <div><label class="label">Prospect</label><select class="select" name="prospectId"><option value="">— ou client —</option>${prOpts}</select></div>
        <div class="col-span-2"><label class="label">Cible (si autre)</label><input class="input" name="cible"/></div>
        <div><label class="label">Montant estimé (DA) *</label><input class="input" type="number" step="0.01" name="montant" /></div>
        <div><label class="label">Probabilité (%)</label><input class="input" type="number" min="0" max="100" name="probabilite" value="50"/></div>
        <div><label class="label">Date clôture prévue</label><input class="input" type="date" name="dateCloture"/></div>
        <div><label class="label">Étape</label><select class="select" name="etape">${ETAPES_OPP.map(e=>`<option>${e}</option>`).join("")}</select></div>
        <div><label class="label">Société émettrice</label><select class="select" name="societe">${SOCIETES.map(s=>`<option ${mySoc()===s?"selected":""}>${s}</option>`).join("")}</select></div>
        <div></div>
        <div class="col-span-2"><label class="label">Notes</label><textarea class="input" name="notes" rows="2"></textarea></div>
      </div>
      <div class="flex gap-2 mt-4 justify-end"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">💾 Enregistrer</button></div>
    </form>`);
}

async function confirmOpportunite(){
  const fd=new FormData(document.querySelector(".modal-bg form"));
  const item={id:uid("op"),intitule:fd.get("intitule"),clientId:fd.get("clientId")||"",prospectId:fd.get("prospectId")||"",cible:fd.get("cible")||"",montant:parseFloat(fd.get("montant"))||0,probabilite:parseInt(fd.get("probabilite")||"50",10),dateCloture:fd.get("dateCloture")||"",etape:fd.get("etape")||"nouveau",societe:fd.get("societe"),notes:fd.get("notes")||""};
  try{
    await sgdiRunLegacyAction("create-item",{collection:"opportunites",data:item});
    await sgdiPullState({silent:true});
    closeModal();toast("Opportunité créée par le backend","success");renderView();
  }catch(e){toast("Création opportunité refusée : "+(e.message||e),"error")}
}

async function updateOppEtape(id,e){
  try{
    await sgdiRunLegacyAction("set-status",{collection:"opportunites",item_id:id,data:{etape:e}});
    await sgdiPullState({silent:true});
    toast("Étape mise à jour par le backend","success");
    renderView();
  }catch(err){toast("Étape refusée : "+(err.message||err),"error");renderView()}
}

async function deleteOpp(id){
  if(!confirm("Supprimer ?"))return;
  try{
    await sgdiRunLegacyAction("delete-item",{collection:"opportunites",item_id:id,data:{}});
    db.opportunites=(db.opportunites||[]).filter(o=>String(o.id)!==String(id));
    toast("Opportunité supprimée par le backend","success");
    renderView();
  }catch(e){toast("Suppression refusée : "+(e.message||e),"error")}
}

function renderCommVisites(view){
  const list=bySoc(db.visites||[]).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  view.innerHTML=`<div class="flex justify-between items-center mb-2"><div><h1 class="text-2xl font-bold">📞 Visites / Suivi</h1><p class="text-slate-500 text-sm">${list.length} visites</p></div><button class="btn btn-primary" onclick="openVisiteModal()">➕ Nouvelle visite</button></div>
    ${commTabs("visites")}
    <div class="card overflow-hidden">${list.length===0?`<div class="p-10 text-center text-slate-500">Aucune visite.</div>`:`<table><thead><tr><th>Date</th><th>Cible</th><th>Type</th><th>Personne</th><th>Compte-rendu</th><th>Prochaine action</th><th></th></tr></thead><tbody>${list.map(v=>{const cl=db.clients.find(x=>x.id===v.clientId);const pr=db.prospects.find(x=>x.id===v.prospectId);return`<tr data-searchable><td class="text-xs">${formatDate(v.date)}</td><td>${escapeHTML(cl?.nom||pr?.nom||"")}</td><td><span class="pill pill-blue">${safe(v.type)}</span></td><td class="text-xs">${escapeHTML(v.personne||"")}</td><td class="text-xs">${escapeHTML((v.compteRendu||"").slice(0,60))}</td><td class="text-xs">${v.prochaineDate?formatDate(v.prochaineDate)+" — "+escapeHTML(v.prochaineAction||""):"—"}</td><td><button class="btn btn-ghost text-xs text-red-600" onclick="deleteVisite('${v.id}')">✕</button></td></tr>`}).join("")}</tbody></table>`}</div>`;
}

function openVisiteModal(){
  const clOpts=(db.clients||[]).map(c=>`<option value="${c.id}">${escapeHTML(c.nom)}</option>`).join("");
  const prOpts=(db.prospects||[]).map(p=>`<option value="${p.id}">${escapeHTML(p.nom)}</option>`).join("");
  openModal(`<h3 class="font-bold text-lg mb-4">📞 Nouvelle visite / contact</h3>
    <form onsubmit="event.preventDefault();confirmVisite()">
      <div class="grid grid-2 gap-3">
        <div><label class="label">Date *</label><input class="input" type="date" name="date" value="${today()}" /></div>
        <div><label class="label">Type</label><select class="select" name="type"><option>Visite physique</option><option>Téléphone</option><option>Email</option><option>Visioconférence</option><option>Autre</option></select></div>
        <div><label class="label">Client</label><select class="select" name="clientId"><option value="">— ou prospect —</option>${clOpts}</select></div>
        <div><label class="label">Prospect</label><select class="select" name="prospectId"><option value="">— ou client —</option>${prOpts}</select></div>
        <div class="col-span-2"><label class="label">Personne rencontrée</label><input class="input" name="personne"/></div>
        <div><label class="label">Société</label><select class="select" name="societe">${SOCIETES.map(s=>`<option ${mySoc()===s?"selected":""}>${s}</option>`).join("")}</select></div>
        <div></div>
        <div class="col-span-2"><label class="label">Compte-rendu *</label><textarea class="input" name="compteRendu" rows="3" ></textarea></div>
        <div><label class="label">Date prochaine action</label><input class="input" type="date" name="prochaineDate"/></div>
        <div><label class="label">Action à faire</label><input class="input" name="prochaineAction"/></div>
      </div>
      <div class="flex gap-2 mt-4 justify-end"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">💾 Enregistrer</button></div>
    </form>`);
}

async function confirmVisite(){
  const fd=new FormData(document.querySelector(".modal-bg form"));
  db.visites=db.visites||[];
  db.visites.push({id:uid("vi"),date:fd.get("date"),type:fd.get("type"),clientId:fd.get("clientId")||"",prospectId:fd.get("prospectId")||"",personne:fd.get("personne")||"",societe:fd.get("societe"),compteRendu:fd.get("compteRendu"),prochaineDate:fd.get("prochaineDate")||"",prochaineAction:fd.get("prochaineAction")||"",createdBy:session.username,createdAt:new Date().toISOString()});
  if(!(await saveDBAndWaitToast("Visite non confirmée")))return;
  closeModal();toast("Visite enregistrée","success");renderView();
}

async function deleteVisite(id){if(!confirm("Supprimer ?"))return;db.visites=db.visites.filter(v=>v.id!==id);if(!(await saveDBAndWaitToast("Suppression visite non confirmée")))return;renderView()}

function nextDevisNumero(){
  const nums=(db.devis||[]).map(d=>String(d.numero||"").match(/^DEV-(\d+)$/i)).filter(Boolean).map(m=>parseInt(m[1],10)||0);
  return "DEV-"+String(((nums.length?Math.max(...nums):0)+1)).padStart(4,"0");
}

function renderCommDevis(view){
  if(window.__devisEditorId!==undefined){return renderDevisEditor(view);}
  const list=(db.devis||[]).filter(d=>!mySoc()||d.societe===mySoc()).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
  const statPill=s=>{const c=DEVIS_STATUT_COLORS[s]||"#64748b";return '<span style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;background:'+c+'20;color:'+c+'">'+(DEVIS_STATUT_LABELS[s]||escapeHTML(s||"—"))+'</span>';};
  const thS="padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;white-space:nowrap";
  const rows=list.map(d=>{
    const col=DEVIS_STATUT_COLORS[d.statut]||"#64748b";
    return '<tr style="border-bottom:1px solid #f1f5f9;cursor:pointer" onclick="devisEditorOpen(\''+d.id+'\')" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'\'">'+
      '<td style="padding:8px 14px;font-family:monospace;font-size:12px;color:#1d4ed8;font-weight:800">'+escapeHTML(d.numero||"")+'</td>'+
      '<td style="padding:8px 14px;font-weight:700;color:#0f172a">'+escapeHTML(d.clientNom||"—")+'</td>'+
      '<td style="padding:8px 14px;color:#475569;font-size:12px;max-width:280px">'+escapeHTML(d.objet||"")+'</td>'+
      '<td style="padding:8px 14px;text-align:center;font-size:12px">'+escapeHTML(formatDate(d.date)||"—")+'</td>'+
      '<td style="padding:8px 14px;text-align:center;font-size:12px">'+escapeHTML(formatDate(d.dateValidite)||"—")+'</td>'+
      '<td style="padding:8px 14px;text-align:right;font-weight:800;color:#0f2d5a;white-space:nowrap">'+escapeHTML(formatDZD(d.montantHT||0))+'</td>'+
      '<td style="padding:8px 14px;text-align:right;font-weight:800;color:'+col+';white-space:nowrap">'+escapeHTML(formatDZD(d.montantTTC||0))+'</td>'+
      '<td style="padding:8px 14px;text-align:center">'+statPill(d.statut)+'</td>'+
      '<td style="padding:8px 14px" onclick="event.stopPropagation()"><button class="btn btn-ghost text-xs" style="color:#dc2626" onclick="deleteDevis(\''+d.id+'\')">✕</button></td>'+
    '</tr>';
  }).join("");
  view.innerHTML=
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'+
    '<div><h1 style="font-size:20px;font-weight:800;color:#0f2d5a;margin:0">Devis</h1>'+
    '<p style="font-size:13px;color:#64748b;margin:4px 0 0">'+list.length+' devis</p></div>'+
    '<button class="btn btn-primary" onclick="devisEditorOpen()">+ Nouveau devis</button>'+
    '</div>'+
    commTabs("devis")+
    '<div class="card" style="padding:0;overflow:hidden">'+
    (list.length===0?
      '<div style="padding:60px;text-align:center;color:#94a3b8">'+
      '<div style="font-size:48px;margin-bottom:12px">📄</div>'+
      '<div style="font-weight:700;font-size:15px;margin-bottom:6px;color:#64748b">Aucun devis</div>'+
      '<div style="font-size:13px;margin-bottom:16px">Créez votre premier devis de prestation</div>'+
      '<button class="btn btn-primary" onclick="devisEditorOpen()">+ Créer un devis</button>'+
      '</div>' :
      '<table style="width:100%;border-collapse:collapse;font-size:13px">'+
      '<thead><tr style="background:#f1f5f9">'+
      '<th style="'+thS+'">N° Devis</th>'+
      '<th style="'+thS+'">Client</th>'+
      '<th style="'+thS+'">Objet</th>'+
      '<th style="'+thS+';text-align:center">Date</th>'+
      '<th style="'+thS+';text-align:center">Validité</th>'+
      '<th style="'+thS+';text-align:right">Montant HT</th>'+
      '<th style="'+thS+';text-align:right">Montant TTC</th>'+
      '<th style="'+thS+';text-align:center">Statut</th>'+
      '<th style="border-bottom:1px solid #e2e8f0;width:40px"></th>'+
      '</tr></thead>'+
      '<tbody>'+rows+'</tbody>'+
      '</table>'
    )+'</div>';
}

function devisEditorOpen(id){
  window.__devisEditorId=id||"new";
  renderView();
}

function devisEditorClose(){
  delete window.__devisEditorId;
  renderView();
}

function renderDevisEditor(view){
  const id=window.__devisEditorId;
  const isNew=!id||id==="new";
  let d=isNew?null:(db.devis||[]).find(x=>x.id===id);
  const newId=isNew?uid("dv"):id;
  if(!d){
    d={id:newId,numero:nextDevisNumero(),societe:mySoc(),statut:"brouillon",
       clientId:"",clientNom:"",objet:"",date:today(),dateValidite:"",refClient:"",
       lignes:[],remiseGlobale:0,sousTotal:0,montantHT:0,tva:0,montantTTC:0,
       notes:"",conditions:"Validité du devis : 30 jours.\nPrix nets hors taxes.\nTVA au taux légal en vigueur.",
       createdAt:new Date().toISOString()};
    if(isNew)window.__devisEditorId=d.id;
  }
  const clients=(db.clients||[]).filter(c=>!mySoc()||c.societe===mySoc());
  const statCol=DEVIS_STATUT_COLORS[d.statut]||"#64748b";
  const statLabel=DEVIS_STATUT_LABELS[d.statut]||d.statut;

  const statOpts=Object.entries(DEVIS_STATUT_LABELS).map(([v,l])=>'<option value="'+v+'" '+(d.statut===v?"selected":"")+'>'+l+'</option>').join("");
  const clientOpts='<option value="">— Sélectionner un client —</option>'+clients.map(c=>'<option value="'+escapeHTML(c.id)+'" '+(d.clientId===c.id?"selected":"")+'>'+escapeHTML(c.nom||"")+'</option>').join("");
  const lignesHTML=d.lignes.map(l=>devisEditorLigneHTML(l)).join("");

  const thL="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;text-transform:uppercase;white-space:nowrap";

  view.innerHTML=
    // Top bar
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
    '<div style="display:flex;align-items:center;gap:10px">'+
    '<button class="btn btn-ghost" style="font-size:12px" onclick="devisEditorClose()">← Retour</button>'+
    '<span style="font-family:monospace;font-size:15px;font-weight:800;color:#0f2d5a">'+escapeHTML(d.numero)+'</span>'+
    '<span style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;background:'+statCol+'20;color:'+statCol+'">'+escapeHTML(statLabel)+'</span>'+
    '</div>'+
    '<div style="display:flex;gap:8px">'+
    '<button class="btn btn-ghost" onclick="devisEditorClose()">Annuler</button>'+
    '<button class="btn btn-primary" onclick="devisEditorSave()">Enregistrer</button>'+
    '</div>'+
    '</div>'+

    // Header card
    '<div class="card" style="margin-bottom:10px;padding:14px">'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
    '<label style="display:block"><span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase">Client</span>'+
    '<select class="select" id="dev-clientId" style="margin-top:4px;width:100%">'+clientOpts+'</select></label>'+
    '<label style="display:block"><span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase">Objet de la prestation</span>'+
    '<input class="input" id="dev-objet" value="'+escapeHTML(d.objet)+'" placeholder="Ex : Prestations de gardiennage – site industriel" style="margin-top:4px"/></label>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">'+
    '<label style="display:block"><span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase">Date du devis</span>'+
    '<input class="input" type="date" id="dev-date" value="'+escapeHTML(d.date||today())+'" style="margin-top:4px"/></label>'+
    '<label style="display:block"><span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase">Validité jusqu\'au</span>'+
    '<input class="input" type="date" id="dev-validite" value="'+escapeHTML(d.dateValidite||"")+'" style="margin-top:4px"/></label>'+
    '<label style="display:block"><span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase">Statut</span>'+
    '<select class="select" id="dev-statut" style="margin-top:4px">'+statOpts+'</select></label>'+
    '<label style="display:block"><span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase">Référence client</span>'+
    '<input class="input" id="dev-refClient" value="'+escapeHTML(d.refClient||"")+'" placeholder="Réf. optionnelle" style="margin-top:4px"/></label>'+
    '</div>'+
    '</div>'+

    // Lignes table card
    '<div class="card" style="margin-bottom:10px;padding:0;overflow:hidden">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc">'+
    '<span style="font-size:12px;font-weight:800;color:#0f2d5a">LIGNES DE PRESTATION</span>'+
    '<div style="display:flex;gap:8px">'+
    '<button class="btn btn-ghost" style="font-size:11px" onclick="devisEditorFromCatalogue()">Depuis catalogue</button>'+
    '<button class="btn btn-ghost" style="font-size:11px;background:#f0fdf4;color:#15803d;border:1px solid #86efac" onclick="openGrilleSalaire()">Grille salaire</button>'+
    '<button class="btn btn-ghost" style="font-size:11px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d" onclick="devisCalcCout()">Calcul de coût</button>'+
    '<button class="btn btn-primary" style="font-size:11px" onclick="devisEditorLigneAdd()">+ Ajouter une ligne</button>'+
    '</div></div>'+
    '<div style="overflow-x:auto">'+
    '<table style="width:100%;border-collapse:collapse;font-size:12px">'+
    '<thead><tr style="background:#f1f5f9">'+
    '<th style="'+thL+'">Désignation</th>'+
    '<th style="'+thL+';width:140px">Unité</th>'+
    '<th style="'+thL+';width:140px;text-align:right">Prix unit. HT</th>'+
    '<th style="'+thL+';width:70px;text-align:right">Qté</th>'+
    '<th style="'+thL+';width:70px;text-align:right">Rem.%</th>'+
    '<th style="'+thL+';width:150px;text-align:right">Total HT (DZD)</th>'+
    '<th style="border-bottom:1px solid #e2e8f0;width:36px"></th>'+
    '</tr></thead>'+
    '<tbody id="dev-lignes-body">'+lignesHTML+'</tbody>'+
    '</table>'+
    (d.lignes.length===0?'<div id="dev-lignes-empty" style="padding:28px;text-align:center;color:#94a3b8;font-size:12px">Aucune ligne — ajoutez des prestations ou importez depuis le catalogue</div>':'')+
    '</div></div>'+

    // Bottom: Notes + Totaux
    '<div style="display:grid;grid-template-columns:1fr 320px;gap:12px;align-items:start">'+
    // Notes
    '<div class="card" style="padding:14px">'+
    '<div style="font-size:11px;font-weight:800;color:#0f2d5a;text-transform:uppercase;margin-bottom:8px">Notes & Conditions</div>'+
    '<textarea class="input" id="dev-notes" rows="4" placeholder="Conditions particulières, périmètre d\'intervention, délais de paiement..." style="width:100%;font-size:12px;margin-bottom:10px">'+escapeHTML(d.notes||"")+'</textarea>'+
    '<div style="font-size:11px;font-weight:800;color:#0f2d5a;text-transform:uppercase;margin-bottom:8px">Conditions générales</div>'+
    '<textarea class="input" id="dev-conditions" rows="3" style="width:100%;font-size:12px">'+escapeHTML(d.conditions||"Validité du devis : 30 jours.\nPrix nets hors taxes.\nTVA au taux légal en vigueur.")+'</textarea>'+
    '</div>'+
    // Totaux
    '<div class="card" style="padding:16px">'+
    '<div style="font-size:11px;font-weight:800;color:#0f2d5a;text-transform:uppercase;margin-bottom:14px">Récapitulatif financier</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding-bottom:10px;border-bottom:1px solid #e2e8f0">'+
    '<span style="color:#475569">Sous-total HT</span>'+
    '<span id="dev-sous-total" style="font-weight:700;font-family:monospace">0,00 DZD</span>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:10px 0">'+
    '<span style="color:#475569">Remise globale</span>'+
    '<div style="display:flex;align-items:center;gap:6px">'+
    '<input type="number" min="0" max="100" step="0.01" id="dev-remise" value="'+escapeHTML(String(d.remiseGlobale||0))+'" style="width:65px;text-align:right;border:1px solid #cbd5e1;border-radius:6px;padding:4px 8px;font-size:12px" oninput="devisEditorCalcTotals()"/>'+
    '<span style="color:#64748b;font-size:12px">%</span>'+
    '</div></div>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding-bottom:10px">'+
    '<span style="color:#dc2626;font-size:12px">Montant remise</span>'+
    '<span id="dev-montant-remise" style="font-weight:700;color:#dc2626;font-family:monospace">- 0,00 DZD</span>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:10px 0;border-top:1px solid #e2e8f0">'+
    '<span style="font-weight:700;color:#0f172a">Total HT</span>'+
    '<span id="dev-total-ht" style="font-weight:800;color:#0f2d5a;font-family:monospace">0,00 DZD</span>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding-bottom:10px">'+
    '<span style="color:#475569">TVA (19%)</span>'+
    '<span id="dev-tva" style="font-weight:700;font-family:monospace">0,00 DZD</span>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-top:2px solid #0f2d5a;margin-top:4px">'+
    '<span style="font-weight:800;color:#0f2d5a;font-size:14px">TOTAL TTC</span>'+
    '<span id="dev-total-ttc" style="font-weight:900;color:#0f2d5a;font-size:16px;font-family:monospace">0,00 DZD</span>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">'+
    '<button class="btn btn-primary" onclick="devisEditorSave()" style="font-size:13px">Enregistrer le devis</button>'+
    '<button class="btn btn-ghost" onclick="devisVoirApercu()" style="font-size:13px;background:#f0f9ff;color:#0369a1;border:1px solid #7dd3fc">👁 Voir devis</button>'+
    '</div>'+
    '</div>'+
    '</div>';

  commercialModuleTimeout(()=>{
    devisEditorCalcTotals();
    document.querySelectorAll(".dev-ligne-designation").forEach(devisEditorAutoResize);
  },0);
}

function devisEditorLigneHTML(l){
  l=l||{};
  const uniteOpts=DEVIS_UNITES.map(u=>'<option value="'+escapeHTML(u)+'" '+(l.unite===u?"selected":"")+'>'+escapeHTML(u)+'</option>').join("");
  const qte=parseFloat(l.qte)||1;
  const prix=parseFloat(l.prixUnitHT)||0;
  const rem=parseFloat(l.remise)||0;
  const total=qte*prix*(1-rem/100);
  const IS="border:1px solid #e2e8f0;border-radius:6px;padding:4px 8px;font-size:12px;background:#fff;text-align:right";
  const TA="width:100%;border:1px solid #e2e8f0;border-radius:6px;padding:4px 8px;font-size:12px;background:#fff;resize:none;overflow:hidden;min-height:30px;line-height:1.5;box-sizing:border-box;display:block";
  const on="oninput=\"devisEditorCalcRow(this.closest('tr'));devisEditorCalcTotals()\"";
  const vt="vertical-align:top";
  return '<tr class="dev-ligne-row" style="border-bottom:1px solid #f1f5f9">'+
    '<td style="padding:4px 8px;'+vt+'"><textarea class="input dev-ligne-designation" style="'+TA+'" rows="1" placeholder="Désignation..." oninput="devisEditorAutoResize(this)">'+escapeHTML(l.designation||"")+'</textarea></td>'+
    '<td style="padding:4px 6px;'+vt+'"><select class="select dev-ligne-unite" style="font-size:11px;padding:4px 6px;width:100%">'+uniteOpts+'</select></td>'+
    '<td style="padding:4px 6px;'+vt+'"><input type="number" min="0" step="0.01" style="'+IS+';width:125px" value="'+escapeHTML(String(prix))+'" '+on+'/></td>'+
    '<td style="padding:4px 6px;'+vt+'"><input type="number" min="0" step="0.01" style="'+IS+';width:65px" value="'+escapeHTML(String(qte))+'" '+on+'/></td>'+
    '<td style="padding:4px 6px;'+vt+'"><input type="number" min="0" max="100" step="0.01" style="'+IS+';width:60px" value="'+escapeHTML(String(rem))+'" '+on+'/></td>'+
    '<td style="padding:4px 8px;text-align:right;font-weight:700;white-space:nowrap;color:#0f2d5a;'+vt+'" class="dev-ligne-total">'+escapeHTML(formatDZD(total))+'</td>'+
    '<td style="padding:4px 6px;text-align:center;'+vt+'"><button type="button" onclick="devisEditorLigneRemove(this)" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:15px;padding:2px 6px;line-height:1">✕</button></td>'+
    '</tr>';
}

function devisEditorCalcRow(tr){
  const nums=tr.querySelectorAll("input[type='number']");
  const prix=parseFloat(nums[0]?.value)||0;
  const qte=parseFloat(nums[1]?.value)||0;
  const rem=parseFloat(nums[2]?.value)||0;
  const totalEl=tr.querySelector(".dev-ligne-total");
  if(totalEl)totalEl.textContent=formatDZD(qte*prix*(1-rem/100));
}

function devisEditorCalcTotals(){
  let sousTotal=0;
  document.querySelectorAll(".dev-ligne-row").forEach(tr=>{
    const nums=tr.querySelectorAll("input[type='number']");
    const prix=parseFloat(nums[0]?.value)||0;
    const qte=parseFloat(nums[1]?.value)||0;
    const rem=parseFloat(nums[2]?.value)||0;
    sousTotal+=qte*prix*(1-rem/100);
  });
  const remPct=parseFloat(document.getElementById("dev-remise")?.value)||0;
  const montantRemise=sousTotal*remPct/100;
  const totalHT=sousTotal-montantRemise;
  const tva=totalHT*0.19;
  const ttc=totalHT+tva;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=formatDZD(v);};
  set("dev-sous-total",sousTotal);
  const remEl=document.getElementById("dev-montant-remise");
  if(remEl)remEl.textContent="- "+formatDZD(montantRemise);
  set("dev-total-ht",totalHT);
  set("dev-tva",tva);
  set("dev-total-ttc",ttc);
}

function devisEditorLigneAdd(l){
  const tbody=document.getElementById("dev-lignes-body");
  if(!tbody)return;
  const empty=document.getElementById("dev-lignes-empty");
  if(empty)empty.remove();
  tbody.insertAdjacentHTML("beforeend",devisEditorLigneHTML(l||{designation:"",unite:"Mois",qte:1,prixUnitHT:0,remise:0}));
  devisEditorCalcTotals();
  const newRow=tbody.lastElementChild;
  const ta=newRow?.querySelector(".dev-ligne-designation");
  if(ta){devisEditorAutoResize(ta);ta.focus();}
}

function devisEditorLigneRemove(btn){
  btn.closest("tr").remove();
  devisEditorCalcTotals();
  const tbody=document.getElementById("dev-lignes-body");
  if(tbody&&tbody.querySelectorAll("tr").length===0){
    tbody.insertAdjacentHTML("afterend",'<div id="dev-lignes-empty" style="padding:28px;text-align:center;color:#94a3b8;font-size:12px">Aucune ligne — ajoutez des prestations ou importez depuis le catalogue</div>');
  }
}

function devisEditorFromCatalogue(){
  const catalogue=(db.catalogue||[]).filter(c=>!mySoc()||c.societe===mySoc());
  if(catalogue.length===0){toast("Catalogue vide — ajoutez d'abord des prestations dans Catalogue prestations","info");return;}
  const thM="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;text-transform:uppercase";
  const rows=catalogue.map(p=>'<tr style="cursor:pointer;border-bottom:1px solid #f1f5f9" onclick="devisEditorFromCatalogueSelect(\''+p.id+'\');closeModal()" onmouseover="this.style.background=\'#f0f9ff\'" onmouseout="this.style.background=\'\'">'+
    '<td style="padding:8px 12px;font-weight:700">'+escapeHTML(p.designation||"")+'</td>'+
    '<td style="padding:8px 12px;font-size:12px;color:#475569">'+escapeHTML(p.categorie||"")+'</td>'+
    '<td style="padding:8px 12px;font-size:12px">'+escapeHTML(p.unite||"")+'</td>'+
    '<td style="padding:8px 12px;text-align:right;font-weight:700;font-family:monospace">'+escapeHTML(money(p.prixHT))+'</td>'+
    '</tr>').join("");
  openModal('<div style="font-weight:800;font-size:15px;color:#0f2d5a;margin-bottom:14px">Importer depuis le catalogue</div>'+
    '<table style="width:100%;border-collapse:collapse;font-size:13px">'+
    '<thead><tr style="background:#f1f5f9"><th style="'+thM+'">Désignation</th><th style="'+thM+'">Catégorie</th><th style="'+thM+'">Unité</th><th style="'+thM+';text-align:right">Prix HT</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table>');
}

function devisEditorFromCatalogueSelect(prestId){
  const p=(db.catalogue||[]).find(x=>x.id===prestId);
  if(!p)return;
  devisEditorLigneAdd({designation:p.designation||"",unite:p.unite||"Mois",qte:1,prixUnitHT:p.prixHT||0,remise:0});
}

async function devisEditorSave(){
  const id=window.__devisEditorId;
  if(!id){toast("Erreur interne","error");return;}
  db.devis=db.devis||[];
  let d=db.devis.find(x=>x.id===id);
  const isNew=!d;
  if(!d){d={id,createdAt:new Date().toISOString(),societe:mySoc()};db.devis.push(d);}
  const clientId=document.getElementById("dev-clientId")?.value||"";
  const client=(db.clients||[]).find(c=>c.id===clientId);
  d.clientId=clientId;d.clientNom=client?.nom||"";
  d.objet=document.getElementById("dev-objet")?.value||"";
  d.date=document.getElementById("dev-date")?.value||today();
  d.dateValidite=document.getElementById("dev-validite")?.value||"";
  d.statut=document.getElementById("dev-statut")?.value||"brouillon";
  d.refClient=document.getElementById("dev-refClient")?.value||"";
  d.notes=document.getElementById("dev-notes")?.value||"";
  d.conditions=document.getElementById("dev-conditions")?.value||"";
  d.lignes=[];
  document.querySelectorAll(".dev-ligne-row").forEach(tr=>{
    const nums=tr.querySelectorAll("input[type='number']");
    const designation=(tr.querySelector(".dev-ligne-designation")?.value||"").trim();
    const unite=tr.querySelector(".dev-ligne-unite")?.value||"";
    const prixUnitHT=parseFloat(nums[0]?.value)||0;
    const qte=parseFloat(nums[1]?.value)||0;
    const remise=parseFloat(nums[2]?.value)||0;
    const totalHT=qte*prixUnitHT*(1-remise/100);
    if(designation||prixUnitHT)d.lignes.push({id:uid("l"),designation,unite,qte,prixUnitHT,remise,totalHT});
  });
  const remiseGlobale=parseFloat(document.getElementById("dev-remise")?.value)||0;
  const sousTotal=d.lignes.reduce((s,l)=>s+l.totalHT,0);
  const montantRemise=sousTotal*remiseGlobale/100;
  const montantHT=sousTotal-montantRemise;
  const tva=montantHT*0.19;
  d.remiseGlobale=remiseGlobale;d.sousTotal=sousTotal;d.montantRemise=montantRemise;
  d.montantHT=montantHT;d.tva=tva;d.montantTTC=montantHT+tva;
  d.numero=d.numero||nextDevisNumero();d.updatedAt=new Date().toISOString();
  try{await sgdiApi("/api/irongs/collections/devis",{method:"PUT",body:{data:db.devis},legacy:false});}catch(e){toast("Erreur : "+(e.message||e),"error");return;}
  toast(isNew?"Devis créé":"Devis enregistré","success");
  delete window.__devisEditorId;
  renderView();
}

function devisVoirApercu(){
  const id=window.__devisEditorId;
  let d=id&&id!=="new"?(db.devis||[]).find(x=>x.id===id):null;
  // Lire l'état actuel du formulaire si disponible
  if(!d){d={numero:"APERÇU",clientNom:"",objet:"",date:today(),dateValidite:"",lignes:[],remiseGlobale:0,montantHT:0,tva:0,montantTTC:0,notes:"",conditions:""};}
  const cnom=document.getElementById("dev-clientId");
  const clientNom=cnom?cnom.options[cnom.selectedIndex]?.text.replace("— Sélectionner un client —","").trim()||d.clientNom:d.clientNom;
  const objet=(document.getElementById("dev-objet")?.value||d.objet).trim();
  const dateD=document.getElementById("dev-date")?.value||d.date;
  const dateV=document.getElementById("dev-dateValidite")?.value||d.dateValidite;
  const notes=document.getElementById("dev-notes")?.value||d.notes;
  const conditions=document.getElementById("dev-conditions")?.value||d.conditions;
  const remPct=parseFloat(document.getElementById("dev-remise")?.value)||0;

  // Lire les lignes depuis le DOM
  const lignes=[];
  document.querySelectorAll(".dev-ligne-row").forEach(tr=>{
    const nums=tr.querySelectorAll("input[type='number']");
    const designation=(tr.querySelector(".dev-ligne-designation")?.value||"").trim();
    const unite=tr.querySelector(".dev-ligne-unite")?.value||"";
    const prixUnitHT=parseFloat(nums[0]?.value)||0;
    const qte=parseFloat(nums[1]?.value)||0;
    const remise=parseFloat(nums[2]?.value)||0;
    const totalHT=qte*prixUnitHT*(1-remise/100);
    if(designation||prixUnitHT)lignes.push({designation,unite,qte,prixUnitHT,remise,totalHT});
  });
  const useLines=lignes.length?lignes:d.lignes;
  const sousTotal=useLines.reduce((s,l)=>s+(l.totalHT||0),0);
  const remMont=sousTotal*remPct/100;
  const ht=sousTotal-remMont;
  const tva=ht*0.19;
  const ttc=ht+tva;

  const fmtD=v=>(v||"").split("-").reverse().join("/");
  const DZD=v=>v.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" DZD";
  const thS="padding:8px 10px;font-size:11px;font-weight:700;color:#64748b;border-bottom:2px solid #0f2d5a;text-transform:uppercase;white-space:nowrap";

  const lignesRows=useLines.map((l,i)=>
    '<tr style="border-bottom:1px solid #f1f5f9;'+(i%2===0?"":"background:#f8fafc")+'">' +
    '<td style="padding:8px 10px;font-size:12px">'+(l.designation||"")+'</td>'+
    '<td style="padding:8px 10px;font-size:11px;text-align:center;color:#64748b">'+(l.unite||"")+'</td>'+
    '<td style="padding:8px 10px;font-size:12px;text-align:right">'+DZD(l.prixUnitHT||0)+'</td>'+
    '<td style="padding:8px 10px;font-size:12px;text-align:center">'+(l.qte||0)+'</td>'+
    (l.remise>0?'<td style="padding:8px 10px;font-size:12px;text-align:center">'+l.remise+'%</td>':'<td style="padding:8px 10px;font-size:12px;text-align:center">—</td>')+
    '<td style="padding:8px 10px;font-size:12px;text-align:right;font-weight:700">'+DZD(l.totalHT||0)+'</td>'+
    '</tr>'
  ).join("");

  const statut=document.getElementById("dev-statut")?.value||d.statut||"brouillon";
  const statColor=DEVIS_STATUT_COLORS[statut]||"#64748b";
  const statLabel=DEVIS_STATUT_LABELS[statut]||statut;
  const numero=document.getElementById("dev-numero")?.value||d.numero||"";

  const html=
    '<div class="modal-box" style="max-width:860px;width:96vw">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'+
      '<div style="font-weight:800;font-size:15px;color:#0f2d5a">Aperçu du devis</div>'+
      '<button onclick="closeModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b">✕</button>'+
    '</div>'+
    // Header
    '<div style="border:2px solid #0f2d5a;border-radius:8px;padding:16px 20px;margin-bottom:14px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start">'+
      '<div>'+
        '<div style="font-size:22px;font-weight:900;color:#0f2d5a;margin-bottom:4px">DEVIS</div>'+
        '<div style="font-size:18px;font-family:monospace;font-weight:800;color:#0f2d5a">'+escapeHTML(numero)+'</div>'+
        (clientNom?'<div style="font-size:13px;margin-top:8px;color:#475569">Client : <strong>'+escapeHTML(clientNom)+'</strong></div>':'')+
        (objet?'<div style="font-size:12px;color:#64748b;margin-top:3px">Objet : '+escapeHTML(objet)+'</div>':'')+
      '</div>'+
      '<div style="text-align:right">'+
        '<span style="font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;background:'+statColor+'20;color:'+statColor+';border:1px solid '+statColor+'40">'+escapeHTML(statLabel)+'</span>'+
        '<div style="font-size:11px;color:#64748b;margin-top:8px">Date : <strong>'+fmtD(dateD)+'</strong></div>'+
        (dateV?'<div style="font-size:11px;color:#64748b;margin-top:2px">Validité : <strong>'+fmtD(dateV)+'</strong></div>':'')+
      '</div>'+
    '</div>'+
    // Lignes
    '<div style="overflow:auto;margin-bottom:14px">'+
    '<table style="width:100%;border-collapse:collapse">'+
    '<thead><tr style="background:#0f2d5a">'+
      '<th style="'+thS+';color:#fff;text-align:left">Désignation</th>'+
      '<th style="'+thS+';color:#fff;text-align:center;width:80px">Unité</th>'+
      '<th style="'+thS+';color:#fff;text-align:right;width:130px">Prix unit. HT</th>'+
      '<th style="'+thS+';color:#fff;text-align:center;width:60px">Qté</th>'+
      '<th style="'+thS+';color:#fff;text-align:center;width:70px">Remise</th>'+
      '<th style="'+thS+';color:#fff;text-align:right;width:130px">Total HT</th>'+
    '</tr></thead>'+
    '<tbody>'+lignesRows+'</tbody>'+
    '</table></div>'+
    // Totaux
    '<div style="display:flex;justify-content:flex-end">'+
    '<table style="border-collapse:collapse;min-width:280px">'+
      (remPct>0?'<tr><td style="padding:5px 10px;font-size:12px;color:#475569">Sous-total HT</td><td style="padding:5px 10px;text-align:right;font-size:12px">'+DZD(sousTotal)+'</td></tr>'+
               '<tr><td style="padding:5px 10px;font-size:12px;color:#475569">Remise ('+remPct+'%)</td><td style="padding:5px 10px;text-align:right;font-size:12px;color:#dc2626">−'+DZD(remMont)+'</td></tr>':'')+
      '<tr><td style="padding:5px 10px;font-size:12px;color:#475569">Total HT</td><td style="padding:5px 10px;text-align:right;font-size:12px;font-weight:700">'+DZD(ht)+'</td></tr>'+
      '<tr><td style="padding:5px 10px;font-size:12px;color:#475569">TVA (19%)</td><td style="padding:5px 10px;text-align:right;font-size:12px">'+DZD(tva)+'</td></tr>'+
      '<tr style="background:#0f2d5a"><td style="padding:8px 10px;font-size:13px;font-weight:800;color:#fff">TOTAL TTC</td><td style="padding:8px 10px;text-align:right;font-size:14px;font-weight:900;color:#fff;font-family:monospace">'+DZD(ttc)+'</td></tr>'+
    '</table></div>'+
    // Notes / Conditions
    (notes?'<div style="margin-top:14px;padding:10px;background:#f8fafc;border-radius:6px;font-size:11px;color:#475569"><strong>Notes :</strong> '+escapeHTML(notes)+'</div>':'')+
    (conditions?'<div style="margin-top:8px;padding:10px;background:#f8fafc;border-radius:6px;font-size:11px;color:#475569"><strong>Conditions :</strong><br>'+escapeHTML(conditions).replace(/\n/g,"<br>")+'</div>':'')+
    '</div>';

  openModal(html);
}

function openGrilleSalaire(){
  const INP="class=\"input\" style=\"margin-top:3px;font-size:12px\"";
  const fieldHTML=(id,label,val,extra)=>'<label style="display:block;margin-bottom:8px">'+
    '<span style="font-size:11px;font-weight:700;color:#475569">'+label+'</span>'+
    '<input type="number" id="'+id+'" value="'+val+'" min="0" oninput="grilleSalaireUpdate()" '+INP+(extra?' '+extra:'')+'>'+
    '</label>';
  const secH=(t)=>'<div style="font-size:10px;font-weight:800;color:#0f2d5a;text-transform:uppercase;margin-bottom:8px;padding-bottom:5px;border-bottom:2px solid #e2e8f0">'+t+'</div>';
  const html=
    '<div class="modal-box" style="max-width:920px;width:96vw">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
      '<div><div style="font-weight:800;font-size:16px;color:#0f2d5a">Grille de calcul de salaire</div>'+
      '<div style="font-size:11px;color:#64748b;margin-top:2px">Conformément à la législation algérienne — Loi de Finances 2024</div></div>'+
      '<button onclick="closeModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b">✕</button>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:320px 1fr;gap:14px">'+
    // ─── COLONNE GAUCHE (saisie) ───
    '<div>'+
      '<div class="card" style="padding:12px;margin-bottom:10px">'+secH("Rémunération de base")+
        fieldHTML("gs-sb","Salaire de base (DZD)","30000","step=\"0.01\"")+
        fieldHTML("gs-anc","Ancienneté (années) — IEP 1%/an max 25%","0","max=\"50\"")+
      '</div>'+
      '<div class="card" style="padding:12px;margin-bottom:10px">'+secH("Primes & indemnités")+
        fieldHTML("gs-rend","Prime de rendement (DZD)","0","step=\"0.01\"")+
        fieldHTML("gs-panier","Prime de panier / repas (DZD)","0","step=\"0.01\"")+
        fieldHTML("gs-transport","Indemnité de transport (DZD)","0","step=\"0.01\"")+
        fieldHTML("gs-hs25","Heures supplémentaires tranche 1 (+50% minimum)","0","step=\"0.5\"")+
        fieldHTML("gs-hs50","Heures supplémentaires +50% (nombre d\'heures)","0","step=\"0.5\"")+
        fieldHTML("gs-autres","Autres primes (DZD)","0","step=\"0.01\"")+
      '</div>'+
      '<div class="card" style="padding:12px">'+secH("Charges patronales")+
        fieldHTML("gs-cnaspt","Taux CNAS patronale (%)","26","max=\"100\" step=\"0.01\"")+
        fieldHTML("gs-tfp","Taxe formation professionnelle (%)","1","max=\"100\" step=\"0.01\"")+
      '</div>'+
    '</div>'+
    // ─── COLONNE DROITE (résultats) ───
    '<div id="gs-results" style="overflow:auto;max-height:75vh"></div>'+
    '</div></div>';
  openModal(html);
  commercialModuleTimeout(grilleSalaireUpdate,0);
}

function grilleSalaireUpdate(){
  const g=id=>parseFloat(document.getElementById(id)?.value)||0;
  const sb=g("gs-sb"),anc=g("gs-anc"),rend=g("gs-rend"),panier=g("gs-panier");
  const transport=g("gs-transport"),hs25=g("gs-hs25"),hs50=g("gs-hs50"),autres=g("gs-autres");
  const cnasptPct=g("gs-cnaspt"),tfpPct=g("gs-tfp");

  // I. Brut
  const iep=Math.min(sb*Math.min(anc,25)/100,sb*0.25);
  const tauxH=sb/173.33;
  const mhs25=tauxH*1.50*hs25, mhs50=tauxH*1.50*hs50;
  const sbg=sb+iep+rend+panier+transport+mhs25+mhs50+autres;

  // II. Retenues salariales
  const cnasSal=sbg*0.09;
  const netApCnas=sbg-cnasSal;
  const nfi=Math.max(0,netApCnas);
  const irgResult=irgSalaireAlgerie(nfi,paieConfig());
  const abatt=irgResult.abattement,irg=irgResult.irg,irgD=[];
  const totalRet=cnasSal+irg, net=sbg-totalRet;

  // IV. Charges patronales
  const cnasPatr=sbg*cnasptPct/100, tfp=sbg*tfpPct/100, conge=sbg/12;
  const coutEmp=sbg+cnasPatr+tfp+conge;

  const DZD=v=>v.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" DZD";
  const sec=t=>'<tr style="background:#f1f5f9"><td colspan="2" style="padding:6px 10px;font-size:10px;font-weight:800;color:#0f2d5a;text-transform:uppercase;letter-spacing:.5px">'+t+'</td></tr>';
  const row=(lbl,val,bold,bg,col)=>{
    const st=(bold?"font-weight:800;":"")+(col?"color:"+col+";":"")+(bg?"background:"+bg+";":"");
    const fs=bold?"font-size:13px;":"font-size:12px;";
    return '<tr><td style="padding:5px 10px;'+st+fs+'">'+lbl+'</td><td style="padding:5px 10px;text-align:right;'+st+fs+'">'+DZD(val)+'</td></tr>';
  };

  const irgRows=irgD.length?irgD.map(t=>
    '<tr style="background:#fef9c3"><td style="padding:3px 10px 3px 22px;font-size:11px;color:#92400e">Tranche '+t.lbl+' DZD ('+Math.round(t.rate*100)+'%)</td>'+
    '<td style="padding:3px 10px;text-align:right;font-size:11px;color:#92400e">'+DZD(t.m)+'</td></tr>'
  ).join(""):'<tr style="background:#dcfce7"><td colspan="2" style="padding:4px 10px 4px 22px;font-size:11px;color:#15803d">'+irgResult.formule+'</td></tr>';

  const html=
    '<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-family:sans-serif">'+
    sec("I. Rémunération brute")+
    row("Salaire de base",sb)+
    (iep>0?row("IEP ("+Math.min(anc,25)+" an"+(anc>1?"s":"")+" × 1%)",iep):"") +
    (rend>0?row("Prime de rendement",rend):"")+
    (mhs25>0?row("H. Supp. +50% ("+hs25+"h × "+Math.round(tauxH)+"×1,50)",mhs25):"")+
    (mhs50>0?row("H. Supp. +50% ("+hs50+"h × "+Math.round(tauxH)+"×1,50)",mhs50):"")+
    (panier>0?row("Prime de panier / repas",panier):"")+
    (transport>0?row("Indemnité de transport",transport):"")+
    (autres>0?row("Autres primes",autres):"")+
    row("SALAIRE BRUT GLOBAL (SBG)",sbg,true,"#f8fafc","#0f2d5a")+

    sec("II. Retenues salariales")+
    row("CNAS salariale (9% × SBG)",cnasSal)+
    row("Net après CNAS salariale",netApCnas,false,"","#475569")+
    row("Abattement IRG (40%, min 1 000 / max 1 500 DZD)",abatt)+
    row("Revenu Net Fiscal (RNF)",nfi,false,"","#475569")+
    '<tr style="background:#fef9c3"><td style="padding:5px 10px;font-weight:700;color:#854d0e">IRG — Barème mensuel réglementaire</td>'+
    '<td style="padding:5px 10px;text-align:right;font-weight:700;color:#854d0e">'+DZD(irg)+'</td></tr>'+
    irgRows+
    row("TOTAL RETENUES SALARIALES",totalRet,true,"#f8fafc","#dc2626")+

    sec("III. Net à payer")+
    '<tr style="background:#dcfce7"><td style="padding:10px;font-weight:900;font-size:16px;color:#15803d">★ NET À PAYER</td>'+
    '<td style="padding:10px;text-align:right;font-weight:900;font-size:16px;color:#15803d">'+DZD(net)+'</td></tr>'+

    sec("IV. Coût employeur")+
    row("CNAS patronale ("+cnasptPct+"% × SBG)",cnasPatr)+
    row("Taxe formation professionnelle ("+tfpPct+"% × SBG)",tfp)+
    row("Provision congés payés (SBG ÷ 12)",conge)+
    row("COÛT TOTAL EMPLOYEUR",coutEmp,true,"#fff5f5","#dc2626")+
    '</table>';

  const el=document.getElementById("gs-results");
  if(el)el.innerHTML=html;
}

function devisCalcCout(){
  const SEC="font-size:11px;font-weight:800;color:#0f2d5a;text-transform:uppercase;padding:10px 0 6px;margin-top:10px;border-top:1px solid #e2e8f0";
  const GR="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px";
  const LB="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:3px";
  const INP='class="input" style="width:100%;font-size:12px"';
  const TH="padding:5px 7px;font-size:10px;font-weight:800;color:#0f2d5a;text-align:center;white-space:nowrap;border:1px solid #bfdbfe;background:#fff";
  const hdr=
    '<tr style="background:#fff;border-bottom:2px solid #0f2d5a">'+
    '<th style="'+TH+';width:28px">#</th>'+
    '<th style="'+TH+';min-width:150px">FONCTION</th>'+
    '<th style="'+TH+';width:85px">SALAIRE</th>'+
    '<th style="'+TH+';width:80px">CNAS 35%</th>'+
    '<th style="'+TH+';width:70px">IRG</th>'+
    '<th style="'+TH+';width:55px">F.GES%</th>'+
    '<th style="'+TH+';width:80px">F.GESTION</th>'+
    '<th style="'+TH+';width:65px">GILET</th>'+
    '<th style="'+TH+';width:65px">PARKAS</th>'+
    '<th style="'+TH+';width:65px">RANGERS</th>'+
    '<th style="'+TH+';width:65px">TPH</th>'+
    '<th style="'+TH+';width:78px">CONGÉ</th>'+
    '<th style="'+TH+';width:90px;color:#1e4d8c;border-bottom:2px solid #1e4d8c">TTG</th>'+
    '<th style="'+TH+';width:55px">MARGE%</th>'+
    '<th style="'+TH+';width:85px">MARGE</th>'+
    '<th style="'+TH+';width:75px">IBS 26%</th>'+
    '<th style="'+TH+';width:72px">FORM. 2%</th>'+
    '<th style="'+TH+';width:95px;color:#dc2626;border-bottom:2px solid #dc2626">TTG FINAL</th>'+
    '<th style="'+TH+';width:28px"></th>'+
    '</tr>';

  openModal(
    // ── SECTION 1 : Formulaire rapide ──
    '<div style="font-weight:800;font-size:15px;color:#0f2d5a;margin-bottom:14px">Calcul de coût — Prestation de gardiennage</div>'+
    '<div style="max-height:82vh;overflow-y:auto;padding-right:4px">'+

    '<div style="'+SEC.replace("margin-top:10px","margin-top:0")+';border-top:none">Identification</div>'+
    '<label style="display:block;margin-bottom:8px"><span style="'+LB+'">Désignation de la prestation</span>'+
    '<input '+INP+' id="cc-designation" placeholder="Ex : Gardiennage site industriel — poste de jour"/></label>'+
    '<div style="'+GR+'">'+
    '<label><span style="'+LB+'">Nombre d\'agents</span><input type="number" min="1" '+INP+' id="cc-nbAgents" value="1" oninput="devisCalcCoutUpdate()"/></label>'+
    '<label><span style="'+LB+'">Unité</span><select class="select" id="cc-unite" style="width:100%;font-size:12px">'+
    DEVIS_UNITES.map(u=>'<option value="'+escapeHTML(u)+'" '+(u==="Mois"?"selected":"")+'>'+escapeHTML(u)+'</option>').join("")+
    '</select></label>'+
    '</div>'+

    '<div style="'+SEC+'">Rémunération / agent / mois</div>'+
    '<div style="'+GR+'">'+
    '<label><span style="'+LB+'">Salaire de base (DZD)</span><input type="number" min="0" '+INP+' id="cc-salaire" value="30000" oninput="devisCalcCoutUpdate()"/></label>'+
    '<label><span style="'+LB+'">Charges patronales (%)</span><input type="number" min="0" max="100" '+INP+' id="cc-charges" value="36" oninput="devisCalcCoutUpdate()"/></label>'+
    '</div>'+
    '<div style="'+GR+'">'+
    '<label><span style="'+LB+'">Indemnité transport (DZD)</span><input type="number" min="0" '+INP+' id="cc-transport" value="0" oninput="devisCalcCoutUpdate()"/></label>'+
    '<label><span style="'+LB+'">Indemnité panier (DZD)</span><input type="number" min="0" '+INP+' id="cc-panier" value="0" oninput="devisCalcCoutUpdate()"/></label>'+
    '</div>'+
    '<div style="'+GR+'">'+
    '<label><span style="'+LB+'">Prime nuit (%)</span><input type="number" min="0" max="100" '+INP+' id="cc-nuit" value="0" oninput="devisCalcCoutUpdate()"/></label>'+
    '<label><span style="'+LB+'">Prime week-end (%)</span><input type="number" min="0" max="100" '+INP+' id="cc-we" value="0" oninput="devisCalcCoutUpdate()"/></label>'+
    '</div>'+
    '<label style="display:block;margin-bottom:4px"><span style="'+LB+'">Autres primes / indemnités (DZD)</span>'+
    '<input type="number" min="0" '+INP+' id="cc-autresPrimes" value="0" oninput="devisCalcCoutUpdate()"/></label>'+

    '<div style="'+SEC+'">Frais généraux & Marge</div>'+
    '<div style="'+GR+'">'+
    '<label><span style="'+LB+'">Frais généraux (%)</span><input type="number" min="0" max="100" '+INP+' id="cc-fraisGen" value="15" oninput="devisCalcCoutUpdate()"/></label>'+
    '<label><span style="'+LB+'">Marge bénéficiaire (%)</span><input type="number" min="0" max="100" '+INP+' id="cc-marge" value="20" oninput="devisCalcCoutUpdate()"/></label>'+
    '</div>'+

    '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px;margin-top:4px">'+
    '<div style="font-size:11px;font-weight:800;color:#0369a1;margin-bottom:10px;text-transform:uppercase">Résultat</div>'+
    '<div style="display:grid;grid-template-columns:1fr auto;gap:5px 16px;font-size:12px;align-items:center">'+
    '<span style="color:#475569">Coût / agent / mois</span><span id="cc-r-cout-agent" style="font-weight:700;text-align:right;font-family:monospace">—</span>'+
    '<span style="color:#475569">Coût total / mois (×agents)</span><span id="cc-r-cout-total" style="font-weight:700;text-align:right;font-family:monospace">—</span>'+
    '<span style="color:#475569">Frais généraux</span><span id="cc-r-frais" style="font-weight:700;text-align:right;font-family:monospace">—</span>'+
    '<span style="color:#0f2d5a;font-weight:700;border-top:1px solid #bae6fd;padding-top:6px">Prix HT</span><span id="cc-r-ht" style="font-weight:800;color:#0f2d5a;text-align:right;font-family:monospace;border-top:1px solid #bae6fd;padding-top:6px">—</span>'+
    '<span style="color:#475569">TVA 19%</span><span id="cc-r-tva" style="font-weight:700;text-align:right;font-family:monospace">—</span>'+
    '<span style="color:#0f2d5a;font-weight:800;font-size:13px;border-top:1px solid #bae6fd;padding-top:6px">TOTAL TTC</span><span id="cc-r-ttc" style="font-weight:900;color:#0f2d5a;font-size:14px;text-align:right;font-family:monospace;border-top:1px solid #bae6fd;padding-top:6px">—</span>'+
    '<span style="color:#059669;font-size:11px">Prix unit. HT / agent</span><span id="cc-r-unit" style="font-weight:700;color:#059669;text-align:right;font-family:monospace;font-size:11px">—</span>'+
    '</div></div>'+
    '<div style="display:flex;justify-content:flex-end;margin-top:10px">'+
    '<button type="button" class="btn btn-primary" style="font-size:12px" onclick="devisCalcCoutInsererFormulaire()">Insérer (formulaire)</button>'+
    '</div>'+

    // ── SECTION 2 : Tableau de calcul ──
    '<div style="border-top:2px solid #e2e8f0;margin-top:18px;padding-top:14px">'+
    '<div style="font-size:13px;font-weight:800;color:#0f2d5a;text-align:center;margin-bottom:10px;letter-spacing:.5px">TABLEAU DE CALCUL DES COÛTS</div>'+
    '<div style="overflow-x:auto;margin-bottom:10px">'+
    '<table id="cc-table" style="border-collapse:collapse;font-size:11px;width:100%;min-width:1100px">'+
    '<thead>'+hdr+'</thead>'+
    '<tbody id="cc-tbody"></tbody>'+
    '</table></div>'+
    '<div style="display:flex;align-items:center;justify-content:space-between">'+
    '<button type="button" class="btn btn-ghost" style="font-size:12px" onclick="devisCalcCoutAddRow()">+ Ajouter un poste</button>'+
    '<button type="button" class="btn btn-primary" style="font-size:12px" onclick="devisCalcCoutInserer()">Insérer (tableau)</button>'+
    '</div>'+
    '</div>'+

    '</div>'+ // fin scroll
    '<div style="display:flex;justify-content:flex-end;margin-top:12px">'+
    '<button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button>'+
    '</div>'
  );
  const box=document.querySelector(".modal-bg .modal-box");
  if(box)box.style.maxWidth="98vw";
  commercialModuleTimeout(()=>{devisCalcCoutUpdate();devisCalcCoutAddRow();},0);
}

function calcIRGAlgerie(salaireB){
  // Moteur unique PAIE : assiette nette de CNAS, barème mensuel algérien en vigueur.
  const cnasSal=salaireB*0.09;
  const netApCnas=salaireB-cnasSal;
  return irgSalaireAlgerie(Math.max(0,netApCnas),paieConfig()).irg;
}

SGDIModules.registerModule({key: "commercial", routes: ["commercial"], dependencies: ["commercial-1"], init: function(){window.addEventListener("sgdi:sidebar-stats",refreshCommercialFinancePanel)}, destroy: commercialModuleDestroy});

const commercialModuleTimeouts=new Set();
function commercialModuleTimeout(callback,delay){
  const hash=location.hash,generation=sgdiViewRenderGeneration;
  const id=setTimeout(()=>{commercialModuleTimeouts.delete(id);if(hash===location.hash&&generation===sgdiViewRenderGeneration&&SGDIModules.isModuleInitialized("commercial"))callback()},delay);
  commercialModuleTimeouts.add(id);return id;
}
function commercialDismissMenu(){document.querySelectorAll(".sgdi-client-row-menu").forEach(menu=>menu.remove())}
function commercialModuleDestroy(){
  window.removeEventListener("sgdi:sidebar-stats",refreshCommercialFinancePanel);
  commercialModuleTimeouts.forEach(clearTimeout);commercialModuleTimeouts.clear();
  document.removeEventListener("click",commercialDismissMenu);commercialDismissMenu();
}
