/* Phase 2 — incidents. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2h-inventory.json. */
function renderMainCouranteDashboard(view){
  const incidents=(db.incidents||[]).map(incidentNorm);
  const soc=currentStructureSocieteFilter&&currentStructureSocieteFilter();
  const scoped=incidents.filter(i=>{
    if(!incidentInSupervisorScope(i))return false;
    if(!soc)return true;
    if(i.societe&&i.societe===soc)return true;
    const site=(db.sites||[]).find(s=>s.id===i.siteId);
    return site?siteMatchesSociete(site,soc):true;
  });
  const isClosed=i=>["clos","resolu","résolu"].includes((i.statut||"").toLowerCase());
  const isCritical=i=>["critique","majeur","urgent"].includes((i.gravite||"").toLowerCase())&&!isClosed(i);
  const siteEvents=scoped.filter(i=>i.type==="Evenement site");
  const otherEvents=scoped.filter(i=>i.type==="Autre");
  const openEvents=scoped.filter(i=>!isClosed(i));
  const criticalEvents=scoped.filter(isCritical);
  const closedEvents=scoped.filter(isClosed);
  const todayEvents=scoped.filter(i=>(i.date||"")===today());
  const recent=openEvents.slice().sort((a,b)=>String(b.createdAt||b.date||"").localeCompare(String(a.createdAt||a.date||""))).slice(0,6);
  const kpis=[
    {label:"Total main courante",value:scoped.length,route:"incidents/site",tone:"#043970"},
    {label:"Évènements site",value:siteEvents.length,route:"incidents/site",tone:"#0369a1"},
    {label:"Évènements autres",value:otherEvents.length,route:"incidents/autres",tone:"#7c2d12"},
    {label:"Ouverts",value:openEvents.length,route:"incidents/site",tone:"#b45309"},
    {label:"Critiques",value:criticalEvents.length,route:"incidents/site",tone:"#b91c1c"},
    {label:"Clôturés",value:closedEvents.length,route:"incidents/site",tone:"#047857"},
    {label:"Aujourd'hui",value:todayEvents.length,route:"incidents/site",tone:"#1d4ed8"}
  ];
  const kpiHTML=(k)=>`<button type="button" class="ops-dash-kpi" onclick="navigate('${k.route}')"><div class="ops-dash-kpi-icon" style="background:${k.tone}1a;color:${k.tone}">●</div><div class="ops-dash-lbl">${escapeHTML(k.label)}</div><div class="ops-dash-val" style="color:${k.tone}">${k.value}</div></button>`;
  view.innerHTML=`<div class="ops-dash-hero"><div class="ops-dash-hero-row"><div><div class="ops-dash-eyebrow">Pilotage opérationnel</div><h1>Main courante</h1><div class="ops-dash-hero-sub"><span>Synthèse des évènements, incidents, alertes et clôtures</span></div></div><button class="ops-dash-refresh" onclick="openIncidentModal('site')">＋ Nouvel évènement</button></div></div>
  <div class="ops-dash-kpis" style="grid-template-columns:repeat(7,minmax(0,1fr))">${kpis.map(kpiHTML).join("")}</div>
  <div class="ops-dash-row2" style="grid-template-columns:1fr 1fr">
    <div class="ops-dash-card"><div class="ops-dash-card-head"><div><h3>Accès rapides</h3><p>Consulter ou créer un évènement</p></div></div><div class="ops-dash-card-body" style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn btn-secondary" onclick="navigate('incidents/site')">Évènements site</button><button class="btn btn-secondary" onclick="navigate('incidents/autres')">Évènements autres</button><button class="btn btn-primary" onclick="openIncidentModal('site')">Créer évènement site</button><button class="btn btn-primary" onclick="openIncidentModal('autres')">Créer évènement autre</button></div></div>
    <div class="ops-dash-card"><div class="ops-dash-card-head"><div><h3>Alertes ouvertes</h3><p>${recent.length} évènement(s) récent(s) non clôturé(s)</p></div></div><div class="ops-dash-card-body">${recent.length?recent.map(i=>`<button type="button" class="ops-dash-alert-item" style="--sev-c:#dc2626;width:100%;text-align:left;cursor:pointer;margin-bottom:8px" onclick="viewIncident('${i.id}')"><div><div class="ops-dash-alert-name">${escapeHTML(i.sujet||i.categorie||"Évènement")}</div><div class="ops-dash-alert-meta">${formatDate(i.date||i.createdAt||"")} · ${escapeHTML(i.statut||"ouvert")} · ${escapeHTML(i.gravite||"")}</div></div></button>`).join(""):`<div class="text-sm text-emerald-700 font-semibold p-2">Aucune alerte ouverte.</div>`}</div></div>
  </div>`;
}

function incidentFromApi(row){
  if(!row)return null;
  const when=row.event_date||row.created_at||new Date().toISOString();
  const d=String(when).slice(0,10);
  const h=String(when).includes("T")?String(when).slice(11,16):"";
  return {
    id:String(row.id||row.item_id||uid("in")),backendId:row.id,date:d,heure:h,type:row.event_type==="autre"?"Autre":"Evenement site",
    categorie:row.event_type||"",gravite:row.level||"normal",sujet:row.title||"Évènement",description:row.message||"",consigne:row.action_taken||"",
    siteId:row.site_id?String(row.site_id):"",agentId:row.employee_id?String(row.employee_id):"",statut:row.status||"en_cours",createdAt:row.created_at||when,actions:[]
  };
}

async function renderIncidentsServer(view,mode){
  const hash=location.hash,generation=sgdiViewRenderGeneration;
  const stillCurrent=()=>location.hash===hash&&sgdiViewRenderGeneration===generation&&document.getElementById("view")===view;
  const type=mode==="autres"?"autre":"site";
  const page=sgdiServerCurrentPage("incidents",type);
  sgdiShowDataLoadingBar("Chargement de la main courante...");
  try{
    const result=await SGDI.events.page({event_type:type,page,page_size:20});
    if(!stillCurrent())return;
    const list=(result?.items||result?.data||[]).map(incidentFromApi).filter(Boolean).filter(incidentInSupervisorScope);
    list.forEach(i=>sgdiUpsertServerItem("incidents",i));
    const ouverts=list.filter(i=>!["clos","resolu","résolu"].includes((i.statut||"").toLowerCase())).length;
    const critiques=list.filter(i=>["critique","majeur","urgent"].includes((i.gravite||"").toLowerCase())&&!["clos","resolu","résolu"].includes((i.statut||"").toLowerCase())).length;
    const clos=list.filter(i=>["clos","resolu","résolu"].includes((i.statut||"").toLowerCase())).length;
    view.innerHTML=`<div class="flex justify-between items-start mb-4"><div><h1 class="text-2xl font-bold">${mode==="autres"?"Main courante - évènements autres":"Main courante - évènements site"}</h1><div class="text-sm text-slate-500">Journal opérationnel.</div></div><button class="btn main-event-btn" onclick="openIncidentModal('${mode}')">Nouvel évènement</button></div>
    <div class="grid grid-4 gap-3 mb-4"><div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Total</div><div class="text-3xl font-black">${result?.total??list.length}</div></div><div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Ouverts</div><div class="text-3xl font-black text-amber-700">${ouverts}</div></div><div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Critiques</div><div class="text-3xl font-black text-red-700">${critiques}</div></div><div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Clôturés</div><div class="text-3xl font-black text-emerald-700">${clos}</div></div></div>
    ${list.length===0?`<div class="card p-10 text-center text-slate-500">Aucun évènement.</div>`:`<div class="space-y-3">${list.map(i=>mainCouranteCardHTML(i)).join("")}</div>`}
    ${sgdiServerPaginationHTML("incidents",type,result)}`;
  }catch(e){
    if(!stillCurrent())return;
    console.warn("Main courante serveur indisponible, repli local",e);
    window.__sgdiIncidentsLocalFallback=true;
    renderIncidents(view,mode);
  }
}

function renderIncidents(view,mode){
  if(mode==="dashboard")return renderMainCouranteDashboard(view);
  if(sgdiAuthToken()&&!window.__sgdiIncidentsLocalFallback){renderIncidentsServer(view,mode);return}
  const type=mode==="autres"?"Autre":"Evenement site";
  const list=(db.incidents||[]).map(incidentNorm).filter(i=>i.type===type&&incidentInSupervisorScope(i)).sort((a,b)=>(b.date+b.heure).localeCompare(a.date+a.heure));
  const ouverts=list.filter(i=>!["clos","resolu","résolu"].includes((i.statut||"").toLowerCase())).length;
  const critiques=list.filter(i=>["critique","majeur","urgent"].includes((i.gravite||"").toLowerCase())&&!["clos","resolu","résolu"].includes((i.statut||"").toLowerCase())).length;
  const clos=list.filter(i=>["clos","resolu","résolu"].includes((i.statut||"").toLowerCase())).length;
  view.innerHTML=`<div class="flex justify-between items-start mb-4"><div><h1 class="text-2xl font-black uppercase">${mode==="autres"?"MAIN COURANTE — ÉVÈNEMENTS AUTRES":"MAIN COURANTE — ÉVÈNEMENTS SITE"}</h1><div class="text-sm text-slate-500">Journal opérationnel, suivi des faits, décisions et clôtures.</div></div><button class="btn main-event-btn" onclick="openIncidentModal('${mode}')">Nouvel évènement</button></div>
  <div class="grid grid-4 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Total</div><div class="text-3xl font-black">${list.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Ouverts</div><div class="text-3xl font-black text-amber-700">${ouverts}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Critiques</div><div class="text-3xl font-black text-red-700">${critiques}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-bold">Clôturés</div><div class="text-3xl font-black text-emerald-700">${clos}</div></div>
  </div>
  <div class="card p-3 mb-4 flex flex-wrap gap-2">
    ${["tous","ouvert","critique","clos"].map(f=>`<button class="btn btn-ghost text-xs" onclick="filterMainCourante('${f}')">${f==="tous"?"Tous":f==="ouvert"?"Ouverts":f==="critique"?"Critiques":"Clôturés"}</button>`).join("")}
  </div>
  ${list.length===0?`<div class="card p-10 text-center text-slate-500">Aucun évènement.</div>`:`<div class="space-y-3">${list.map(i=>mainCouranteCardHTML(i)).join("")}</div>`}`;
}

function mainCouranteCardHTML(i){
  const s=db.sites.find(x=>x.id===i.siteId);const a=db.agents.find(x=>x.id===i.agentId);
  const status=(i.statut||"").toLowerCase();const closed=["clos","resolu","résolu"].includes(status);
  const crit=["critique","majeur","urgent"].includes((i.gravite||"").toLowerCase());
  return`<div class="card p-4 maincourante-card" data-searchable data-status="${closed?"clos":"ouvert"}" data-critique="${crit?"1":"0"}" style="border-left:5px solid ${closed?"#10b981":crit?"#dc2626":"#c2410c"}">
    <div class="flex justify-between gap-3">
      <div class="flex-1">
        <div class="flex flex-wrap items-center gap-2 mb-1"><span class="pill ${incidentPillClass(i.gravite)}">${safe(i.gravite)}</span><span class="pill ${incidentPillClass(i.statut)}">${safe(i.statut)}</span><span class="text-xs text-slate-500">${formatDate(i.date)} · ${safe(i.heure)}</span></div>
        <h3 class="font-black text-base">${escapeHTML(i.sujet)}</h3>
        <div class="text-sm text-slate-700 mt-1">${escapeHTML(i.description||"")}</div>
        ${i.consigne?`<div class="mt-2 text-xs p-2 rounded bg-slate-100"><strong>Conduite à tenir :</strong> ${escapeHTML(i.consigne)}</div>`:""}
        <div class="text-xs text-slate-500 mt-2">Site : <strong>${safe(s?.nom||"—")}</strong> · Agent : <strong>${safe(a?a.nom+" "+a.prenom:"—")}</strong> · Catégorie : ${safe(i.categorie)}</div>
      </div>
      <div class="flex flex-col gap-2 shrink-0">
        <button class="btn btn-secondary text-xs" onclick="viewIncident('${i.id}')">Voir</button>
        ${!closed?`<button class="btn btn-ghost text-xs" onclick="incidentAction('${i.id}','acquitte')">Acquitter</button><button class="btn btn-ghost text-xs" onclick="incidentAction('${i.id}','escalade')">Escalader</button><button class="btn btn-primary text-xs" onclick="incidentAction('${i.id}','clos')">Clôturer</button>`:""}
      </div>
    </div>
  </div>`;
}

function filterMainCourante(f){
  document.querySelectorAll(".maincourante-card").forEach(c=>{
    const ok=f==="tous"||(f==="ouvert"&&c.dataset.status==="ouvert")||(f==="critique"&&c.dataset.critique==="1")||(f==="clos"&&c.dataset.status==="clos");
    c.style.display=ok?"":"none";
  });
}

function openIncidentModal(mode){
  const isSite=mode!=="autres";
  openModal(`<h3 class="font-bold text-lg mb-4">Nouvel évènement main courante</h3>
  <form onsubmit="event.preventDefault();saveIncident('${mode}')">
    <div class="grid grid-2 gap-3">
      <div><label class="label">Date</label><input class="input" type="date" name="date" value="${today()}" /></div>
      <div><label class="label">Heure</label><input class="input" type="time" name="heure" value="${new Date().toTimeString().slice(0,5)}" /></div>
      <div><label class="label">Site</label><select class="select" name="siteId"><option value="">—</option>${db.sites.filter(s=>!supervisorModuleActive()||siteInSupervisorScope(s)).map(s=>`<option value="${s.id}">${escapeHTML(s.nom)}</option>`).join("")}</select></div>
      <div><label class="label">Agent concerné</label><select class="select" name="agentId"><option value="">—</option>${db.agents.filter(a=>!supervisorModuleActive()||agentInSupervisorScope(a)).map(a=>`<option value="${a.id}">${escapeHTML((a.matricule||"")+" - "+a.nom+" "+a.prenom)}</option>`).join("")}</select></div>
      <div><label class="label">Catégorie</label><select class="select" name="categorie"><option>Sécurité</option><option>Discipline</option><option>Matériel</option><option>Client</option><option>Accident</option><option>Consigne</option><option>Autre</option></select></div>
      <div><label class="label">Niveau d'importance</label><select class="select" name="gravite"><option value="mineur">Normal</option><option value="majeur">Élevée</option><option value="critique">Très élevée</option></select></div>
      <div class="col-span-2"><label class="label">Sujet</label><input class="input" name="sujet"  placeholder="Objet de l'évènement"/></div>
      <div class="col-span-2"><label class="label">Description de l'évènement</label><textarea class="textarea" rows="3" name="description" ></textarea></div>
      <div class="col-span-2"><label class="label">Conduite à tenir / consigne</label><textarea class="textarea" rows="2" name="consigne" placeholder="Instruction opérationnelle, action demandée..."></textarea></div>
      <div><label class="label">Statut</label><select class="select" name="statut"><option value="en_cours">En cours</option><option value="acquitte">Acquitté</option><option value="clos">Clôturé</option></select></div>
      <div><label class="label">Destinataire</label><input class="input" name="destinataire" placeholder="OPS, DRH, client, agent..."/></div>
    </div>
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer</button></div>
  </form>`);
}

function saveIncident(mode){
  const fd=new FormData(document.querySelector(".modal-bg form"));
  db.incidents=db.incidents||[];
  db.incidents.push({id:uid("in"),date:fd.get("date"),heure:fd.get("heure"),siteId:fd.get("siteId")||null,agentId:fd.get("agentId")||null,type:mode==="autres"?"Autre":"Evenement site",categorie:fd.get("categorie"),gravite:fd.get("gravite"),sujet:fd.get("sujet"),description:fd.get("description"),consigne:fd.get("consigne"),destinataire:fd.get("destinataire"),statut:fd.get("statut"),actions:[{date:new Date().toISOString(),user:session?.username||"system",type:"creation",note:"Création de l'évènement"}],createdAt:new Date().toISOString()});
  if(typeof logActivity==="function")logActivity("Main courante","Nouvel évènement : "+fd.get("sujet"));
  saveDB();closeModal();toast("Évènement enregistré","success");renderView();
}

function incidentAction(id,type){
  const i=(db.incidents||[]).find(x=>x.id===id);if(!i)return;
  const labels={acquitte:"Acquitté",escalade:"Escaladé",clos:"Clôturé"};
  const note=type==="clos"?prompt("Observation de clôture :",""):(type==="escalade"?prompt("Motif / destinataire de l'escalade :",""):"");
  if(note===null)return;
  i.actions=i.actions||[];
  i.actions.push({date:new Date().toISOString(),user:session?.username||"system",type:labels[type]||type,note:note||""});
  if(type==="clos")i.statut="clos";else if(type==="acquitte")i.statut="acquitte";else if(type==="escalade"){i.statut="en_cours";i.gravite=i.gravite==="critique"?"critique":"majeur"}
  saveDB();toast(labels[type]||"Action enregistrée","success");renderView();
}

SGDIModules.registerModule({key: "incidents", routes: ["incidents"], dependencies: [], init: function(){}, destroy: function(){}});
