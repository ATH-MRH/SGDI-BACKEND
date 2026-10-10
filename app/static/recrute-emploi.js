// Traitement des candidatures IRON Emploi (recrute.irongs.com) : tableau de bord, dossier, pièces,
// entretiens, échanges, contrat, conseils. Toutes les règles sont appliquées par le serveur.
// Dépend des fonctions globales de recrute.html : apiFetch, esc, recruitmentCan, showBanner, formatDateFr,
// recruitmentListSkeleton, recruitmentEmptyState, recruitmentErrorState, recruteSession.
const EMPLOI_API="/api/drh/job-offers";
const EMPLOI_STAGE_PILL={received:"pill-blue",review:"pill-blue",shortlisted:"pill-indigo",convocation:"pill-amber",interview:"pill-amber",decision:"pill-amber",hiring_file:"pill-green",contract:"pill-green",signature:"pill-green",hired:"pill-green"};
const EMPLOI_OUTCOME_PILL={pending:"pill-gray",favorable:"pill-green",unfavorable:"pill-red",withdrawn:"pill-gray"};
const EMPLOI_INTERVIEW={proposed:["Proposé, à confirmer","pill-amber"],confirmed:["Confirmé par le candidat","pill-green"],cancelled:["Annulé","pill-gray"],done:["Réalisé","pill-blue"],no_show:["Candidat absent","pill-red"]};
const EMPLOI_TABS=[["summary","Dossier"],["documents","Pièces"],["processing","Traitement"],["interviews","Entretiens"],["messages","Échanges"],["notes","Notes et historique"],["contract","Contrat"]];
let emploiState={view:"board",mode:"table",bucket:"",filters:{},data:null,dossier:null,tab:"summary",thread:null,error:"",busy:false,request:0,tips:null,companies:null,inbox:null,templates:null,viewer:null};

function emploiHost(){return document.getElementById("processingSection")}
function emploiError(error){const m=error?.message;return Array.isArray(m)?m.map(i=>i?.msg||String(i)).join(" ; "):String(m||"Une erreur est survenue")}
function emploiCan(action="update"){return recruitmentCan(action)}
function emploiName(c){return `${c?.last_name||""} ${c?.first_name||""}`.trim()||"Candidat"}
function emploiDateTime(value){if(!value)return "—";const [d,t]=String(value).split("T");return `${formatDateFr(d)}${t?` à ${t.slice(0,5)}`:""}`}
function emploiSize(bytes){return bytes>=1048576?(bytes/1048576).toFixed(1).replace(".",",")+" Mo":Math.max(1,Math.round(bytes/1024))+" Ko"}
function emploiId(){return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`}
function emploiPills(item){
  return `<span class="pill ${EMPLOI_STAGE_PILL[item.stage]||"pill-gray"}">${esc(item.stage_label)}</span>`
    +(item.outcome!=="pending"?` <span class="pill ${EMPLOI_OUTCOME_PILL[item.outcome]}">${esc(item.outcome_label)}${item.outcome!=="withdrawn"&&!item.outcome_communicated?" · non communiquée":""}</span>`:"")
    +(item.contract_state?` <span class="pill pill-indigo">Contrat ${esc(item.contract_label.toLowerCase())}</span>`:"");
}
async function emploiSend(path,method,body){
  return apiFetch(EMPLOI_API+path,{method,...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
}

// ── Tableau de bord ─────────────────────────────────────────────────────────
function emploiQuery(){
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(emploiState.filters))if(value)params.set(key,value);
  if(emploiState.bucket)params.set("bucket",emploiState.bucket);
  const text=params.toString();return text?`?${text}`:"";
}
async function loadEmploiBoard(){
  const request=++emploiState.request;
  try{const data=await apiFetch(EMPLOI_API+"/workspace"+emploiQuery());if(request!==emploiState.request)return;emploiState.data=data;emploiState.error=""}
  catch(error){if(request!==emploiState.request)return;emploiState.error=emploiError(error)}
  if(typeof recruitSection==="undefined"||recruitSection==="processing")renderEmploi();
}
function refreshEmploi(){
  const host=emploiHost();if(!host)return;
  if(!recruitmentCan("read")){host.innerHTML='<div class="empty" role="alert">Accès réservé au recrutement / DRH.</div>';return}
  if(emploiState.view==="dossier"&&emploiState.dossier){renderEmploi();return}
  if(!emploiState.data)host.innerHTML=emploiHeader()+`<div class="table-card rec-table-card">${recruitmentListSkeleton()}</div>`;
  if(emploiState.view==="tips")return loadEmploiTips();
  if(emploiState.view==="companies")return loadEmploiCompanies();
  if(emploiState.view==="inbox")return loadEmploiInbox();
  return loadEmploiBoard();
}
function emploiHeader(){
  const views=[["board","Candidatures"],["inbox","Échanges"],["tips","Conseils emploi"],["companies","Sociétés"]];
  return `<header class="rec-page-header"><div class="rec-page-heading"><h2>Traitement des candidatures</h2><p>Réception, pièces, entretiens, décision et contrat des candidatures IRON Emploi.</p></div></header>
    <nav class="tabs rec-tabs emploi-views" aria-label="Rubriques">${views.map(([key,label])=>`<button type="button" class="tab-btn${emploiState.view===key?" active":""}" onclick="emploiSetView('${key}')">${label}</button>`).join("")}</nav>`;
}
function emploiSetView(view){emploiState.view=view;emploiState.dossier=null;emploiState.error="";return refreshEmploi()}
function emploiSetFilter(key,value){emploiState.filters[key]=value;loadEmploiBoard()}
function emploiSetBucket(key){emploiState.bucket=emploiState.bucket===key?"":key;loadEmploiBoard()}
function emploiResetFilters(){emploiState.filters={};emploiState.bucket="";loadEmploiBoard()}
function emploiFiltersHTML(data){
  const f=emploiState.filters,options=(rows,selected,value=row=>row,label=row=>row)=>rows.map(row=>`<option value="${esc(value(row))}"${String(value(row))===String(selected||"")?" selected":""}>${esc(label(row))}</option>`).join("");
  return `<div class="emploi-filters rec-filters" role="search" aria-label="Filtrer les candidatures">
    <input type="search" aria-label="Rechercher un candidat, un poste ou une référence" placeholder="Candidat, poste, référence…" value="${esc(f.q||"")}" onchange="emploiSetFilter('q',this.value)">
    <select aria-label="Société" onchange="emploiSetFilter('society',this.value)"><option value="">Toutes les sociétés</option>${options(data.filters.societies,f.society)}</select>
    <select aria-label="Annonce" onchange="emploiSetFilter('offer_id',this.value)"><option value="">Toutes les annonces</option>${options(data.filters.offers,f.offer_id,o=>o.id,o=>o.title)}</select>
    <select aria-label="Wilaya" onchange="emploiSetFilter('wilaya',this.value)"><option value="">Toutes les wilayas</option>${options(data.filters.wilayas,f.wilaya)}</select>
    <select aria-label="Recruteur" onchange="emploiSetFilter('assigned_to',this.value)"><option value="">Tous les recruteurs</option><option value="__none__"${f.assigned_to==="__none__"?" selected":""}>Non attribuées</option>${options(data.filters.recruiters,f.assigned_to)}</select>
    <select aria-label="Étape" onchange="emploiSetFilter('stage',this.value)"><option value="">Toutes les étapes</option>${options(data.stages,f.stage,s=>s.code,s=>s.label)}</select>
    <label class="emploi-period">Du <input type="date" aria-label="Reçues à partir du" value="${esc(f.date_from||"")}" onchange="emploiSetFilter('date_from',this.value)"></label>
    <label class="emploi-period">au <input type="date" aria-label="Reçues jusqu’au" value="${esc(f.date_to||"")}" onchange="emploiSetFilter('date_to',this.value)"></label>
    <button type="button" class="secondary filter-reset" onclick="emploiResetFilters()">Réinitialiser</button></div>`;
}
function emploiRowHTML(item){
  return `<tr><td><b>${esc(emploiName(item.candidate))}</b><div class="emploi-sub">${esc(item.reference)}</div></td>
    <td>${esc(item.title)}<div class="emploi-sub">${item.kind==="offer"?esc(item.society||""):"Candidature spontanée"}</div></td>
    <td>${esc(formatDateFr(item.received_at))}</td><td>${emploiPills(item)}</td>
    <td class="rec-col-secondary">${esc(item.assigned_to||"—")}</td>
    <td class="rec-col-secondary">${item.documents} pièce${item.documents>1?"s":""}${item.missing_documents?` · <span class="emploi-warn">${item.missing_documents} attendue${item.missing_documents>1?"s":""}</span>`:""}${item.unread_messages?` · <b>${item.unread_messages} message${item.unread_messages>1?"s":""} non lu${item.unread_messages>1?"s":""}</b>`:""}</td>
    <td class="rec-col-actions"><button type="button" class="dashboard-mini-action" onclick="openEmploiDossier(${Number(item.id)})">Ouvrir le dossier</button> <button type="button" class="dashboard-mini-action" onclick="openEmploiDossier(${Number(item.id)},'documents')">Pièces</button></td></tr>`;
}
function emploiPipelineHTML(data){
  return `<div class="emploi-pipeline">${data.stages.map(stage=>{const items=data.items.filter(item=>item.stage===stage.code);
    return `<section class="emploi-column" aria-label="${esc(stage.label)}"><header><span>${esc(stage.label)}</span><b>${items.length}</b></header>${items.map(item=>`<button type="button" class="emploi-card" onclick="openEmploiDossier(${Number(item.id)})"><strong>${esc(emploiName(item.candidate))}</strong><span>${esc(item.title)}</span><small>${esc(formatDateFr(item.received_at))}${item.outcome!=="pending"?` · ${esc(item.outcome_label)}`:""}</small></button>`).join("")||'<p class="emploi-empty">Aucune</p>'}</section>`}).join("")}</div>`;
}
function renderEmploi(){
  const host=emploiHost();if(!host)return;
  if(emploiState.view==="dossier"&&emploiState.dossier){host.innerHTML=emploiDossierHTML(emploiState.dossier);emploiAfterDossier();return}
  if(emploiState.view==="tips"){host.innerHTML=emploiHeader()+emploiTipsHTML();return}
  if(emploiState.view==="companies"){host.innerHTML=emploiHeader()+emploiCompaniesHTML();return}
  if(emploiState.view==="inbox"){host.innerHTML=emploiHeader()+emploiInboxHTML();return}
  if(emploiState.error){host.innerHTML=emploiHeader()+`<div class="table-card rec-table-card">${recruitmentErrorState(esc(emploiState.error),"loadEmploiBoard()")}</div>`;return}
  const data=emploiState.data;if(!data)return;
  const filtered=!!emploiState.bucket||Object.values(emploiState.filters).some(Boolean);
  host.innerHTML=emploiHeader()+`<div class="emploi-counters" role="group" aria-label="Compteurs">${data.counters.map(c=>`<button type="button" class="emploi-counter${emploiState.bucket===c.key?" active":""}" aria-pressed="${emploiState.bucket===c.key}" onclick="emploiSetBucket('${c.key}')"><strong>${c.count}</strong><span>${esc(c.label)}</span></button>`).join("")}</div>
    ${emploiFiltersHTML(data)}
    <div class="emploi-toolbar"><span class="rec-count">${data.items.length} candidature${data.items.length>1?"s":""}${filtered?` sur ${data.total}`:""}</span><div class="emploi-toggle" role="group" aria-label="Affichage"><button type="button" class="tab-btn${emploiState.mode==="table"?" active":""}" onclick="emploiState.mode='table';renderEmploi()">Tableau</button><button type="button" class="tab-btn${emploiState.mode==="pipeline"?" active":""}" onclick="emploiState.mode='pipeline';renderEmploi()">Pipeline</button></div></div>
    ${!data.items.length?`<div class="table-card rec-table-card">${recruitmentEmptyState(filtered?{title:"Aucun résultat",text:"Aucune candidature ne correspond à ces filtres.",action:'<button type="button" class="secondary" onclick="emploiResetFilters()">Réinitialiser les filtres</button>'}:{title:"Aucune candidature",text:"Les candidatures envoyées depuis l’application IRON Emploi apparaîtront ici."})}</div>`
      :emploiState.mode==="pipeline"?emploiPipelineHTML(data)
      :`<div class="table-card rec-table-card"><div class="candidate-table-wrap"><table class="rec-table"><thead><tr><th>Candidat</th><th>Annonce</th><th>Reçue le</th><th>Étape · décision · contrat</th><th class="rec-col-secondary">Recruteur</th><th class="rec-col-secondary">Pièces et messages</th><th class="rec-col-actions">Actions</th></tr></thead><tbody>${data.items.map(emploiRowHTML).join("")}</tbody></table></div></div>`}`;
}

// ── Dossier ─────────────────────────────────────────────────────────────────
async function openEmploiDossier(id,tab="summary"){
  const host=emploiHost();emploiState.view="dossier";emploiState.tab=tab;emploiState.thread=null;
  if(typeof showRecruitSection==="function"&&typeof recruitSection!=="undefined"&&recruitSection!=="processing")showRecruitSection("processing",false);
  host.innerHTML=`<div class="table-card rec-table-card">${recruitmentListSkeleton()}</div>`;
  try{emploiState.dossier=await apiFetch(`${EMPLOI_API}/applications/${Number(id)}`);renderEmploi();if(tab==="messages")emploiLoadThread()}
  catch(error){emploiState.dossier=null;host.innerHTML=`<div class="table-card rec-table-card">${recruitmentErrorState(esc(emploiError(error)),"emploiSetView('board')")}</div>`}
}
function emploiSetTab(tab){emploiState.tab=tab;renderEmploi();if(tab==="messages")emploiLoadThread();if(tab==="contract"&&!emploiState.templates)emploiLoadTemplates()}
async function emploiAct(run,success){
  if(emploiState.busy)return;emploiState.busy=true;
  try{const result=await run();if(result&&result.id)emploiState.dossier=result;renderEmploi();const extra=(result?.channels||[]).join(" ");if(success||extra)showBanner([success,extra].filter(Boolean).join(" "),"success");return result}
  catch(error){showBanner(emploiError(error),"error")}
  finally{emploiState.busy=false}
}
function emploiProfileHTML(d){
  const data=d.profile.data||{},rows=[["Téléphone",d.profile.phone],["E-mail",d.profile.email],["Poste souhaité",d.profile.desired_position],["Date de naissance",formatDateFr(data.dateNaissance)],["Lieu de naissance",data.lieuNaissance],["Situation familiale",data.situation],["Adresse",data.adresse],["Commune",data.commune],["Wilaya",data.wilaya],["NIN",data.nin],["N° CNAS",data.numeroCnas],["Disponibilité",data.disponibilite],["Service militaire",data.serviceMilitaire],["Langues",(data.langues||[]).join(", ")],["Contact d’urgence",[data.contactUrgenceNom,data.contactUrgenceLien,data.contactUrgenceTel].filter(Boolean).join(" · ")],["Société du dossier",d.profile.society]].filter(([,value])=>value&&value!=="—");
  const experience=(data.experience||[]).filter(row=>row&&(row.societe||row.poste));
  return `<dl class="emploi-facts">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
    ${experience.length?`<h4>Expériences</h4><ul class="emploi-list">${experience.map(row=>`<li><b>${esc(row.poste||"Poste non précisé")}</b> — ${esc(row.societe||"")}${row.du||row.au?` (${esc(row.du||"?")} → ${esc(row.au||"?")})`:""}</li>`).join("")}</ul>`:""}`;
}
function emploiSummaryHTML(d){
  return `<div class="emploi-grid"><section class="table-card emploi-panel"><h3>Candidature</h3><dl class="emploi-facts"><div><dt>Annonce</dt><dd>${d.offer?esc(d.offer.title):"Candidature spontanée"}</dd></div><div><dt>Société</dt><dd>${esc(d.society||"Non ventilée")}</dd></div><div><dt>Reçue le</dt><dd>${esc(emploiDateTime(d.received_at))}</dd></div><div><dt>Référence</dt><dd>${esc(d.reference)}</dd></div><div><dt>Vu par le candidat</dt><dd>${esc(d.visible_state.label)}</dd></div><div><dt>État du dossier</dt><dd>${esc(d.dossier_state.label)}</dd></div></dl>
      ${d.message?`<h4>Message du candidat</h4><p class="emploi-quote">${esc(d.message)}</p>`:""}
      ${d.other_applications.length?`<h4>Autres candidatures de ce candidat</h4><ul class="emploi-list">${d.other_applications.map(o=>`<li><button type="button" class="dashboard-mini-action" onclick="openEmploiDossier(${Number(o.id)})">${esc(o.title)}</button> — ${esc(o.stage_label)}</li>`).join("")}</ul>`:""}
      <div class="emploi-actions"><button type="button" class="secondary" onclick="emploiOpenCandidate(${Number(d.candidate.id)},'${esc(d.candidate.phone||"")}')">Ouvrir la fiche complète du candidat</button></div></section>
    <section class="table-card emploi-panel"><h3>Renseignements</h3>${emploiProfileHTML(d)}</section></div>`;
}
function emploiDocumentsHTML(d){
  const requests=d.document_requests;
  return `<section class="table-card emploi-panel"><h3>Pièces transmises avec cette candidature</h3>
    ${d.documents.length?`<div class="candidate-table-wrap"><table class="rec-table"><thead><tr><th>Pièce</th><th>Fichier</th><th>Type</th><th>Taille</th><th>Reçue le</th><th>Provenance</th><th class="rec-col-actions">Actions</th></tr></thead><tbody>${d.documents.map(doc=>`<tr><td><b>${esc(doc.label)}</b></td><td>${esc(doc.name)}</td><td>${esc({"application/pdf":"PDF","image/jpeg":"JPG","image/png":"PNG"}[doc.mime_type]||doc.mime_type)}</td><td>${emploiSize(doc.size)}</td><td>${esc(emploiDateTime(doc.received_at))}</td><td>${doc.source==="complement"?"Pièce complémentaire":"Candidature"}</td><td class="rec-col-actions"><button type="button" class="dashboard-mini-action" onclick="emploiViewDocument(${Number(doc.id)})">Visualiser</button> <button type="button" class="dashboard-mini-action" onclick="emploiViewDocument(${Number(doc.id)},true)">Télécharger</button></td></tr>`).join("")}</tbody></table></div>`
      :recruitmentEmptyState({title:"Aucune pièce",text:"Le candidat n’a joint aucun document à cette candidature."})}
    ${d.dossier_cv?`<p class="rec-note emploi-pad">Le dossier du candidat contient aussi un CV saisi sur sa fiche (${esc(d.dossier_cv.name||"CV")}) : il se consulte depuis la fiche complète, il n’est pas rattaché à cette candidature.</p>`:""}</section>
    <section class="table-card emploi-panel"><h3>Pièces complémentaires demandées</h3>
    ${requests.length?`<ul class="emploi-list">${requests.map(r=>`<li><b>${esc(r.label)}</b>${r.note?` — ${esc(r.note)}`:""}${r.due?` · pour le ${esc(formatDateFr(r.due))}`:""} <span class="pill ${r.status==="received"?"pill-green":r.status==="cancelled"?"pill-gray":"pill-amber"}">${r.status==="received"?"Reçue":r.status==="cancelled"?"Annulée":"En attente"}</span>${r.status==="requested"&&emploiCan()?` <button type="button" class="dashboard-mini-action" onclick="emploiAct(()=>emploiSend('/document-requests/${Number(r.id)}/cancel','POST'),'Demande annulée.')">Annuler</button>`:""}</li>`).join("")}</ul>`:'<p class="emploi-empty">Aucune pièce demandée.</p>'}
    ${emploiCan()&&d.outcome!=="withdrawn"?`<form class="emploi-form" onsubmit="event.preventDefault();emploiRequestDocument(this)"><div><label for="emploiReqLabel">Pièce à demander</label><input id="emploiReqLabel" name="label" required maxlength="150" placeholder="Extrait de naissance, diplôme…"></div><div><label for="emploiReqNote">Précision</label><input id="emploiReqNote" name="note" maxlength="400"></div><div><label for="emploiReqDue">Échéance</label><input id="emploiReqDue" name="due" type="date"></div><button class="secondary" type="submit">Demander au candidat</button></form>`:""}</section>`;
}
function emploiRequestDocument(form){const data=Object.fromEntries(new FormData(form).entries());return emploiAct(()=>emploiSend(`/applications/${emploiState.dossier.id}/document-requests`,"POST",{label:data.label,note:data.note||null,due:data.due||null}),"Demande envoyée au candidat.")}
function emploiProcessingHTML(d){
  const stages=emploiState.data?.stages||[{code:d.stage,label:d.stage_label}],closed=d.outcome==="withdrawn",can=emploiCan()&&!closed,recruiters=[...new Set([...(emploiState.data?.filters.recruiters||[]),recruteSession?.user?.username,d.assigned_to].filter(Boolean))];
  const process=body=>`emploiAct(()=>emploiSend('/applications/${Number(d.id)}/processing','PUT',${body}),'Traitement mis à jour.')`;
  return `<div class="emploi-grid"><section class="table-card emploi-panel"><h3>Étape de traitement</h3><p class="emploi-state">${emploiPills(d)}</p>
      ${closed?'<p class="rec-note">Le candidat a retiré cette candidature : son traitement est clos.</p>':""}
      ${can?`<div class="emploi-form"><div><label for="emploiStage">Étape</label><select id="emploiStage" onchange="${process("{stage:this.value}")}">${stages.map(s=>`<option value="${esc(s.code)}"${s.code===d.stage?" selected":""}>${esc(s.label)}</option>`).join("")}</select></div></div>`:""}
      <h4>Décision</h4><p class="rec-note">La décision est d’abord interne. Le candidat n’en est informé que lorsque vous la communiquez.</p>
      ${can?`<div class="emploi-actions"><button type="button" class="secondary" ${d.outcome==="favorable"?"disabled":""} onclick="${process("{outcome:'favorable'}")}">Décision favorable</button><button type="button" class="secondary" ${d.outcome==="unfavorable"?"disabled":""} onclick="${process("{outcome:'unfavorable'}")}">Non retenue</button>${d.outcome!=="pending"&&!d.outcome_communicated?`<button type="button" class="primary" onclick="if(confirm('Communiquer cette décision au candidat ? Il la verra dans l’application.'))${process("{communicate:true}")}">Communiquer au candidat</button><button type="button" class="secondary" onclick="${process("{outcome:'pending'}")}">Revenir à « en attente »</button>`:""}</div>`:""}
      <p class="rec-note">Ce que voit le candidat : <b>${esc(d.visible_state.label)}</b>.</p></section>
    <section class="table-card emploi-panel"><h3>Suivi interne</h3>
      <form class="emploi-form" onsubmit="event.preventDefault();emploiSaveFollowUp(this)"><div><label for="emploiAssigned">Recruteur chargé du dossier</label><select id="emploiAssigned" name="assigned_to" ${emploiCan()?"":"disabled"}><option value="">Non attribuée</option>${recruiters.map(name=>`<option${name===d.assigned_to?" selected":""}>${esc(name)}</option>`).join("")}</select></div>
      <div><label for="emploiNext">Prochaine action</label><input id="emploiNext" name="next_action" maxlength="200" value="${esc(d.next_action||"")}" ${emploiCan()?"":"disabled"}></div><div><label for="emploiDue">Échéance</label><input id="emploiDue" name="next_action_due" type="date" value="${esc(d.next_action_due||"")}" ${emploiCan()?"":"disabled"}></div>
      ${emploiCan()?'<button class="secondary" type="submit">Enregistrer le suivi</button>':""}</form></section></div>`;
}
function emploiSaveFollowUp(form){const data=Object.fromEntries(new FormData(form).entries());return emploiAct(()=>emploiSend(`/applications/${emploiState.dossier.id}/processing`,"PUT",{assigned_to:data.assigned_to||null,next_action:data.next_action||null,next_action_due:data.next_action_due||null}),"Suivi enregistré.")}
function emploiInterviewsHTML(d){
  const can=emploiCan()&&d.outcome!=="withdrawn";
  return `<section class="table-card emploi-panel"><h3>Entretiens de cette candidature</h3>
    ${d.interviews.length?d.interviews.map(i=>{const [label,pill]=EMPLOI_INTERVIEW[i.status]||[i.status,"pill-gray"],open=["proposed","confirmed"].includes(i.status);
      return `<article class="emploi-interview"><header><b>${esc(emploiDateTime(i.starts_at))}</b> <span class="pill ${pill}">${esc(label)}</span>${i.previous_starts_at?` <span class="emploi-sub">reporté, initialement ${esc(emploiDateTime(i.previous_starts_at))}</span>`:""}</header>
        <p>${esc(i.location)}${i.contact?` · Interlocuteur : ${esc(i.contact)}`:""} · heure d’Alger</p>${i.note?`<p class="emploi-sub">${esc(i.note)}</p>`:""}
        ${i.report||i.appreciation?`<p class="emploi-quote"><b>Compte rendu interne${i.appreciation?` — ${esc(i.appreciation)}`:""}</b><br>${esc(i.report||"")}</p>`:""}
        ${can&&open?`<div class="emploi-actions"><button type="button" class="secondary" onclick="emploiEditInterview(${Number(i.id)})">Reporter ou modifier</button><button type="button" class="secondary" onclick="if(confirm('Annuler cet entretien ? Le candidat sera prévenu.'))emploiAct(()=>emploiSend('/interviews/${Number(i.id)}/cancel','POST'),'Entretien annulé, candidat prévenu.')">Annuler</button><button type="button" class="secondary" onclick="emploiOutcomeForm(${Number(i.id)})">Enregistrer présence et compte rendu</button></div><div id="emploiInterviewForm${Number(i.id)}"></div>`:""}</article>`}).join("")
      :'<p class="emploi-empty">Aucun entretien proposé pour cette candidature.</p>'}
    ${d.dossier_convocation?`<p class="rec-note">Convocation historique saisie sur le dossier du candidat : ${esc(formatDateFr(d.dossier_convocation.date))}${d.dossier_convocation.heure?` à ${esc(d.dossier_convocation.heure)}`:""}${d.dossier_convocation.lieu?`, ${esc(d.dossier_convocation.lieu)}`:""}. Elle concerne le dossier, pas cette annonce en particulier.</p>`:""}
    ${can?`<h4>Proposer un entretien</h4>${emploiInterviewFormHTML()}`:""}</section>`;
}
function emploiInterviewFormHTML(i=null){
  const [day,time]=i?String(i.starts_at).split("T"):["",""];
  return `<form class="emploi-form" onsubmit="event.preventDefault();emploiSaveInterview(this,${i?Number(i.id):"null"})"><div><label>Date<input name="date" type="date" required value="${esc(day)}"></label></div><div><label>Heure (Alger)<input name="time" type="time" required value="${esc((time||"").slice(0,5))}"></label></div><div><label>Lieu<input name="location" required maxlength="300" value="${esc(i?.location||"")}"></label></div><div><label>Interlocuteur<input name="contact" maxlength="150" value="${esc(i?.contact||"")}"></label></div><div class="emploi-wide"><label>Consignes pour le candidat<input name="note" maxlength="1000" value="${esc(i?.note||"")}"></label></div><label class="emploi-check"><input type="checkbox" name="send_email"> Envoyer aussi la convocation par e-mail (si le canal est configuré)</label><button class="primary" type="submit">${i?"Enregistrer la modification":"Envoyer la convocation"}</button></form>`;
}
function emploiEditInterview(id){const i=emploiState.dossier.interviews.find(row=>row.id===id);document.getElementById(`emploiInterviewForm${id}`).innerHTML=emploiInterviewFormHTML(i)}
function emploiSaveInterview(form,id){
  const data=Object.fromEntries(new FormData(form).entries()),body={starts_at:`${data.date}T${data.time}:00`,location:data.location,contact:data.contact||null,note:data.note||null,send_email:data.send_email==="on"};
  return emploiAct(()=>id?emploiSend(`/interviews/${id}`,"PUT",body):emploiSend(`/applications/${emploiState.dossier.id}/interviews`,"POST",body),id?"Entretien modifié.":"Convocation enregistrée.");
}
function emploiOutcomeForm(id){
  document.getElementById(`emploiInterviewForm${id}`).innerHTML=`<form class="emploi-form" onsubmit="event.preventDefault();emploiSaveOutcome(this,${id})"><div><label>Présence<select name="attendance"><option value="present">Présent</option><option value="absent">Absent</option></select></label></div><div><label>Appréciation<select name="appreciation"><option value="">—</option><option>Favorable</option><option>Réservé</option><option>Défavorable</option></select></label></div><div class="emploi-wide"><label>Compte rendu (interne, jamais transmis au candidat)<textarea name="report" maxlength="6000"></textarea></label></div><button class="primary" type="submit">Enregistrer</button></form>`;
}
function emploiSaveOutcome(form,id){const data=Object.fromEntries(new FormData(form).entries());return emploiAct(()=>emploiSend(`/interviews/${id}/outcome`,"POST",{attendance:data.attendance,report:data.report||null,appreciation:data.appreciation||null}),"Compte rendu enregistré.")}
async function emploiLoadThread(){
  try{emploiState.thread=await apiFetch(`${EMPLOI_API}/applications/${emploiState.dossier.id}/messages`);emploiState.dossier.unread_messages=0}catch(error){emploiState.thread={error:emploiError(error),items:[]}}
  if(emploiState.view==="dossier"&&emploiState.tab==="messages")renderEmploi();
}
function emploiMessagesHTML(d){
  const t=emploiState.thread;
  if(!t)return `<section class="table-card emploi-panel">${recruitmentListSkeleton()}</section>`;
  return `<section class="table-card emploi-panel"><h3>Échanges avec le candidat</h3>${t.error?recruitmentErrorState(esc(t.error),"emploiLoadThread()"):""}
    <div class="emploi-thread" aria-live="polite">${t.items.map(m=>`<div class="emploi-bubble ${m.sender==="recruiter"?"mine":""}"><p>${esc(m.body)}</p><small>${m.sender==="recruiter"?esc(m.author||"Recrutement"):"Candidat"} · ${esc(emploiDateTime(m.created_at))}${m.sender==="recruiter"?(m.read?" · lu":" · envoyé"):""}</small></div>`).join("")||'<p class="emploi-empty">Aucun message pour cette candidature.</p>'}</div>
    ${t.can_reach_candidate===false?'<p class="rec-note">Ce candidat n’a pas d’espace IRON Emploi : aucun message ne peut lui parvenir par l’application.</p>'
      :emploiCan("create")?`<form class="emploi-compose" onsubmit="event.preventDefault();emploiSendMessage(this)"><label class="sr-only" for="emploiMessage">Votre message</label><textarea id="emploiMessage" name="body" required maxlength="2000" placeholder="Votre message au candidat…"></textarea><input type="hidden" name="client_id" value="${emploiId()}"><button class="primary" type="submit">Envoyer</button></form>`:""}</section>`;
}
async function emploiSendMessage(form){
  const data=Object.fromEntries(new FormData(form).entries()),button=form.querySelector("button");button.disabled=true;
  // Le même identifiant est renvoyé en cas de nouvel essai : le serveur n'enregistre le message qu'une fois.
  try{emploiState.thread=await emploiSend(`/applications/${emploiState.dossier.id}/messages`,"POST",{body:data.body,client_id:data.client_id});renderEmploi()}
  catch(error){button.disabled=false;showBanner(`${emploiError(error)} Vous pouvez réessayer : le message ne sera pas doublé.`,"error")}
}
function emploiNotesHTML(d){
  return `<div class="emploi-grid"><section class="table-card emploi-panel"><h3>Notes internes</h3><p class="rec-note">Visibles des recruteurs uniquement, jamais du candidat.</p>
      ${emploiCan("create")?'<form class="emploi-compose" onsubmit="event.preventDefault();emploiAddNote(this)"><label class="sr-only" for="emploiNote">Nouvelle note</label><textarea id="emploiNote" name="body" required maxlength="4000" placeholder="Nouvelle note interne…"></textarea><button class="secondary" type="submit">Ajouter la note</button></form>':""}
      ${d.notes.map(n=>`<article class="emploi-note"><p>${esc(n.body)}</p><small>${esc(n.author)} · ${esc(emploiDateTime(n.created_at))}</small></article>`).join("")||'<p class="emploi-empty">Aucune note.</p>'}</section>
    <section class="table-card emploi-panel"><h3>Historique</h3><ol class="emploi-history">${d.history.map(h=>`<li><b>${esc(emploiDateTime(h.at))}</b> — ${esc(h.summary)} <small>${esc(h.actor)}</small></li>`).join("")}</ol></section></div>`;
}
function emploiAddNote(form){const body=new FormData(form).get("body");return emploiAct(()=>emploiSend(`/applications/${emploiState.dossier.id}/notes`,"POST",{body}),"Note ajoutée.")}
async function emploiLoadTemplates(){try{emploiState.templates=(await apiFetch(EMPLOI_API+"/contract-templates")).items}catch(error){emploiState.templates=[]}if(emploiState.tab==="contract")renderEmploi()}
function emploiContractHTML(d){
  const c=d.contract,ready=d.outcome==="favorable"&&d.outcome_communicated,templates=emploiState.templates||[],signed=c?.state==="signed",transferred=d.drh_transfer?.status==="done";
  if(!ready)return `<section class="table-card emploi-panel"><h3>Contrat</h3>${recruitmentEmptyState({title:"Pas encore",text:"Le contrat se prépare après une décision favorable communiquée au candidat."})}</section>`;
  const steps=[["Décision favorable communiquée",true],["Contrat préparé",!!c],["Contrat remis au candidat",!!c&&c.state!=="prepared"],["Signature enregistrée",signed],["Dossier transmis à la DRH",transferred],["Recrutement effectif (fiche employé)",d.stage==="hired"]];
  return `<div class="emploi-grid"><section class="table-card emploi-panel"><h3>Préparation du contrat</h3>
      <form class="emploi-form" onsubmit="event.preventDefault();emploiSaveContract(this)"><div><label>Société<input value="${esc(c?.society||d.society||"")}" disabled></label></div><div><label>Poste<input name="position" required maxlength="150" value="${esc(c?.position||d.title||"")}" ${signed?"disabled":""}></label></div><div><label>Type de contrat<input name="contract_type" required maxlength="80" value="${esc(c?.contract_type||"")}" placeholder="CDI, CDD…" ${signed?"disabled":""}></label></div><div><label>Modèle validé<select name="template_id" ${signed?"disabled":""}><option value="">— Aucun —</option>${templates.map(t=>`<option value="${Number(t.id)}"${Number(c?.template_id)===Number(t.id)?" selected":""}>${esc(t.title)}</option>`).join("")}</select></label></div><div><label>Date de début<input name="start_date" type="date" value="${esc(c?.start_date||"")}" ${signed?"disabled":""}></label></div><div><label>Date de fin<input name="end_date" type="date" value="${esc(c?.end_date||"")}" ${signed?"disabled":""}></label></div><div><label>Lieu de travail<input name="work_place" maxlength="200" value="${esc(c?.work_place||"")}" ${signed?"disabled":""}></label></div><div><label>Salaire net (DA)<input name="salary_net" type="number" min="0" step="1" value="${esc(c?.salary_net??"")}" ${signed?"disabled":""}></label></div><div class="emploi-wide"><label>Conditions particulières<textarea name="conditions" maxlength="4000" ${signed?"disabled":""}>${esc(c?.conditions||"")}</textarea></label></div>
      ${emploiCan()&&!signed?`<button class="primary" type="submit">${c?"Mettre à jour le contrat":"Préparer le contrat"}</button>`:""}</form>
      ${c?`<div class="emploi-actions"><button type="button" class="secondary" onclick="emploiPreviewContract()">Aperçu du contrat (Word)</button></div><p class="rec-note">L’aperçu est produit par le service DRH à partir du modèle validé. Il ne crée ni contrat signé, ni fiche employé.</p>`:""}</section>
    <section class="table-card emploi-panel"><h3>Suivi</h3><ol class="emploi-steps">${steps.map(([label,done])=>`<li class="${done?"done":""}">${done?"✓":"○"} ${esc(label)}</li>`).join("")}</ol>
      ${c&&emploiCan()?`<div class="emploi-actions">${c.state==="prepared"?`<button type="button" class="secondary" onclick="emploiAct(()=>emploiSend('/applications/${Number(d.id)}/contract/state','POST',{state:'sent'}),'Contrat noté comme remis au candidat.')">Noter « remis au candidat »</button>`:""}
        <button type="button" class="secondary" onclick="emploiAct(()=>emploiSend('/applications/${Number(d.id)}/contract/state','POST',{state:'${c.state}'${signed?`,signed_on:'${c.signed_on}'`:""},share_with_candidate:${!c.shared_with_candidate}}),'${c.shared_with_candidate?"Le contrat n’est plus affiché au candidat.":"Le candidat voit désormais l’avancement de son contrat."}')">${c.shared_with_candidate?"Ne plus afficher au candidat":"Afficher l’avancement au candidat"}</button></div>
        ${!signed?`<form class="emploi-form" onsubmit="event.preventDefault();emploiSignContract(this)"><div><label>Contrat signé le<input name="signed_on" type="date" required max="${new Date().toISOString().slice(0,10)}"></label></div><button class="primary" type="submit">Enregistrer la signature</button></form><p class="rec-note">La signature est constatée par vous, avec sa date. Aucun contrat n’est considéré signé automatiquement.</p>`
          :`<p class="rec-note">Signature enregistrée le ${esc(formatDateFr(c.signed_on))} par ${esc(c.signed_recorded_by||"")}.</p>${transferred?`<p class="rec-note">Dossier transmis à la DRH${d.employee_id?` — fiche employé n° ${esc(d.employee_id)}`:" : la fiche employé sera créée par la DRH"}.</p>`:`<div class="emploi-actions"><button type="button" class="primary" onclick="if(confirm('Transmettre ce dossier à la DRH ? Il quittera le recrutement.'))emploiAct(()=>emploiSend('/applications/${Number(d.id)}/transfer-drh','POST'),'Dossier transmis à la DRH.')">Transmettre à la DRH</button></div>`}`}`:""}</section></div>`;
}
function emploiSaveContract(form){
  const data=Object.fromEntries(new FormData(form).entries());
  return emploiAct(()=>emploiSend(`/applications/${emploiState.dossier.id}/contract`,"PUT",{position:data.position,contract_type:data.contract_type,template_id:data.template_id?Number(data.template_id):null,start_date:data.start_date||null,end_date:data.end_date||null,work_place:data.work_place||null,salary_net:data.salary_net===""?null:Number(data.salary_net),conditions:data.conditions||null}),"Contrat enregistré.");
}
function emploiSignContract(form){const signed_on=new FormData(form).get("signed_on");return emploiAct(()=>emploiSend(`/applications/${emploiState.dossier.id}/contract/state`,"POST",{state:"signed",signed_on}),"Signature enregistrée.")}
async function emploiFetchBlob(path,options={}){
  const response=await fetch(EMPLOI_API+path,{...options,headers:{Authorization:"Bearer "+recruteSession.token}});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.detail||"Fichier indisponible")}
  return response.blob();
}
function emploiSaveBlob(blob,name){const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),60000)}
async function emploiPreviewContract(){
  try{emploiSaveBlob(await emploiFetchBlob(`/applications/${emploiState.dossier.id}/contract/preview`,{method:"POST"}),`apercu-contrat-${emploiState.dossier.reference}.docx`)}
  catch(error){showBanner(emploiError(error),"error")}
}

// ── Visionneuse ─────────────────────────────────────────────────────────────
async function emploiViewDocument(id,download=false){
  const doc=emploiState.dossier.documents.find(row=>row.id===id);if(!doc)return;
  try{
    // Le fichier est lu avec la session du recruteur : aucune adresse publique ni lien permanent.
    const blob=await emploiFetchBlob(`/applications/${emploiState.dossier.id}/documents/${id}${download?"?download=1":""}`);
    if(download){emploiSaveBlob(blob,doc.name);return}
    closeEmploiViewer();emploiState.viewer={url:URL.createObjectURL(blob),zoom:1,doc};
    const backdrop=document.createElement("div");backdrop.id="emploiViewer";backdrop.className="modal-backdrop emploi-viewer";backdrop.setAttribute("role","dialog");backdrop.setAttribute("aria-modal","true");backdrop.setAttribute("aria-label",`Pièce : ${doc.label}`);
    backdrop.addEventListener("click",event=>{if(event.target===backdrop)closeEmploiViewer()});
    const image=doc.mime_type!=="application/pdf";
    backdrop.innerHTML=`<div class="emploi-viewer-box"><header><div><b>${esc(doc.label)}</b> <span class="emploi-sub">${esc(doc.name)} · ${emploiSize(doc.size)} · reçue le ${esc(emploiDateTime(doc.received_at))}</span></div><div class="emploi-actions">${image?'<button type="button" class="secondary" aria-label="Réduire" onclick="emploiZoom(-0.25)">−</button><button type="button" class="secondary" aria-label="Agrandir" onclick="emploiZoom(0.25)">+</button>':""}<button type="button" class="secondary" onclick="emploiViewDocument(${Number(id)},true)">Télécharger</button><button type="button" class="secondary" onclick="closeEmploiViewer()">Fermer</button></div></header>
      <div class="emploi-viewer-body">${image?`<img id="emploiViewerImage" alt="${esc(doc.label)}" src="${emploiState.viewer.url}">`:`<iframe title="${esc(doc.label)}" src="${emploiState.viewer.url}"></iframe>`}</div></div>`;
    document.body.appendChild(backdrop);
  }catch(error){showBanner(`${doc.label} : ${emploiError(error)}`,"error")}
}
function emploiZoom(step){const v=emploiState.viewer,image=document.getElementById("emploiViewerImage");if(!v||!image)return;v.zoom=Math.min(4,Math.max(0.5,v.zoom+step));image.style.width=`${Math.round(v.zoom*100)}%`;image.style.maxWidth="none"}
function closeEmploiViewer(){document.getElementById("emploiViewer")?.remove();if(emploiState.viewer){URL.revokeObjectURL(emploiState.viewer.url);emploiState.viewer=null}}
async function emploiOpenCandidate(id,phone){
  // La fiche complète est celle de l'espace « Candidatures » : elle y est recherchée puis ouverte.
  try{
    const page=await apiFetch(`/api/drh/candidates/page?mode=pool&page_size=100&q=${encodeURIComponent(phone||"")}`),item=(page.items||[]).find(row=>Number(row.id)===Number(id));
    if(!item){showBanner("Ce dossier n’est plus dans le vivier recrutement (transmis à la DRH ou archivé).","error");return}
    if(!tabState.new.items.some(row=>Number(row.id)===Number(id)))tabState.new.items.unshift(item);
    activeTab="new";showRecruitSection("candidates",false);openCandidateForm(Number(id));
  }catch(error){showBanner(emploiError(error),"error")}
}
function emploiDossierHTML(d){
  const tabs={summary:emploiSummaryHTML,documents:emploiDocumentsHTML,processing:emploiProcessingHTML,interviews:emploiInterviewsHTML,messages:emploiMessagesHTML,notes:emploiNotesHTML,contract:emploiContractHTML};
  const badge={documents:d.documents.length+(d.missing_documents?` · ${d.missing_documents} attendue${d.missing_documents>1?"s":""}`:""),interviews:d.interviews.length||"",messages:d.unread_messages||"",notes:d.notes.length||""};
  return `<header class="rec-page-header"><div class="rec-page-heading"><h2>${esc(emploiName(d.candidate))}</h2><p>${esc(d.title)} · ${d.kind==="offer"?esc(d.society||""):"Candidature spontanée"} · ${esc(d.reference)} · reçue le ${esc(formatDateFr(d.received_at))}</p><p class="emploi-state">${emploiPills(d)}${d.assigned_to?` <span class="emploi-sub">Recruteur : ${esc(d.assigned_to)}</span>`:""}${d.next_action?` <span class="emploi-sub">Prochaine action : ${esc(d.next_action)}${d.next_action_due?` (${esc(formatDateFr(d.next_action_due))})`:""}</span>`:""}</p></div><div class="rec-page-actions"><button type="button" class="secondary" onclick="emploiSetView('board')">← Retour aux candidatures</button></div></header>
    <nav class="tabs rec-tabs" aria-label="Rubriques du dossier">${EMPLOI_TABS.map(([key,label])=>`<button type="button" class="tab-btn${emploiState.tab===key?" active":""}" onclick="emploiSetTab('${key}')">${label}${badge[key]?` <span class="count">${badge[key]}</span>`:""}</button>`).join("")}</nav>
    ${(tabs[emploiState.tab]||emploiSummaryHTML)(d)}`;
}
function emploiAfterDossier(){const thread=document.querySelector(".emploi-thread");if(thread)thread.scrollTop=thread.scrollHeight}

// ── Échanges (toutes candidatures) ──────────────────────────────────────────
async function loadEmploiInbox(){try{emploiState.inbox=(await apiFetch(EMPLOI_API+"/conversations")).items;emploiState.error=""}catch(error){emploiState.inbox=[];emploiState.error=emploiError(error)}renderEmploi()}
function emploiInboxHTML(){
  const items=emploiState.inbox;
  if(!items)return `<div class="table-card rec-table-card">${recruitmentListSkeleton()}</div>`;
  if(emploiState.error)return `<div class="table-card rec-table-card">${recruitmentErrorState(esc(emploiState.error),"loadEmploiInbox()")}</div>`;
  return `<div class="table-card rec-table-card">${items.length?`<div class="candidate-table-wrap"><table class="rec-table"><thead><tr><th>Candidat</th><th>Candidature</th><th>Dernier message</th><th>Reçu le</th><th class="rec-col-actions">Action</th></tr></thead><tbody>${items.map(c=>`<tr><td><b>${esc(c.candidate)}</b>${c.unread?` <span class="pill pill-red">${c.unread} non lu${c.unread>1?"s":""}</span>`:""}</td><td>${esc(c.title)}</td><td>${c.last_message.sender==="recruiter"?"Vous : ":""}${esc(c.last_message.body.slice(0,90))}</td><td>${esc(emploiDateTime(c.last_message.created_at))}</td><td class="rec-col-actions"><button type="button" class="dashboard-mini-action" onclick="openEmploiDossier(${Number(c.application_id)},'messages')">Ouvrir</button></td></tr>`).join("")}</tbody></table></div>`
    :recruitmentEmptyState({title:"Aucun échange",text:"Les conversations démarrent depuis le dossier d’une candidature, rubrique « Échanges »."})}</div>`;
}

// ── Conseils emploi ─────────────────────────────────────────────────────────
async function loadEmploiTips(){try{emploiState.tips=(await apiFetch(EMPLOI_API+"/tips")).items;emploiState.error=""}catch(error){emploiState.tips=[];emploiState.error=emploiError(error)}renderEmploi()}
function emploiTipsHTML(){
  const items=emploiState.tips,categories={cv:"CV",entretien:"Entretien",candidature:"Candidature"};
  if(!items)return `<div class="table-card rec-table-card">${recruitmentListSkeleton()}</div>`;
  return `<p class="rec-note">Contenu éditorial affiché dans l’application, rubrique « Conseils ». Seuls les conseils publiés sont visibles. Tant qu’aucun n’est publié, l’application affiche ses conseils intégrés.</p>
    <div class="emploi-grid"><section class="table-card emploi-panel"><h3>Conseils</h3>${items.map(t=>`<article class="emploi-note"><p><b>${esc(t.title)}</b> <span class="pill ${t.status==="published"?"pill-green":"pill-amber"}">${t.status==="published"?"Publié":"Brouillon"}</span> <span class="emploi-sub">${esc(categories[t.category]||t.category)} · ${Number(t.minutes)} min</span></p><p class="emploi-sub">${esc(t.summary)}</p>${emploiCan()?`<div class="emploi-actions"><button type="button" class="dashboard-mini-action" onclick="emploiEditTip(${Number(t.id)})">Modifier</button><button type="button" class="dashboard-mini-action" onclick="emploiPublishTip(${Number(t.id)},'${t.status==="published"?"draft":"published"}')">${t.status==="published"?"Dépublier":"Publier"}</button></div>`:""}</article>`).join("")||'<p class="emploi-empty">Aucun conseil enregistré.</p>'}</section>
    ${emploiCan("create")?`<section class="table-card emploi-panel"><h3 id="emploiTipTitle">Nouveau conseil</h3><form id="emploiTipForm" class="emploi-form" onsubmit="event.preventDefault();emploiSaveTip(this)"><input type="hidden" name="id"><div class="emploi-wide"><label>Titre<input name="title" required minlength="3" maxlength="150"></label></div><div class="emploi-wide"><label>Résumé<input name="summary" required minlength="3" maxlength="300"></label></div><div><label>Rubrique<select name="category"><option value="cv">CV</option><option value="entretien">Entretien</option><option value="candidature">Candidature</option></select></label></div><div><label>Lecture (minutes)<input name="minutes" type="number" min="1" max="30" value="3"></label></div><div class="emploi-wide"><label>Texte (un titre de partie par ligne seule, une idée par ligne commençant par « - »)<textarea name="body" required minlength="10" maxlength="8000" class="rec-textarea-lg"></textarea></label></div><button class="primary" type="submit">Enregistrer en brouillon</button></form></section>`:""}</div>`;
}
function emploiEditTip(id){const t=emploiState.tips.find(row=>row.id===id),form=document.getElementById("emploiTipForm");if(!t||!form)return;for(const key of ["id","title","summary","category","minutes","body"])form.elements[key].value=t[key];document.getElementById("emploiTipTitle").textContent="Modifier le conseil";form.querySelector("button").textContent="Enregistrer"}
async function emploiSaveTip(form){
  const data=Object.fromEntries(new FormData(form).entries()),current=emploiState.tips.find(row=>String(row.id)===data.id),body={title:data.title,summary:data.summary,body:data.body,category:data.category,minutes:Number(data.minutes)||3,status:current?.status||"draft"};
  try{await emploiSend(data.id?`/tips/${Number(data.id)}`:"/tips",data.id?"PUT":"POST",body);showBanner("Conseil enregistré.","success");loadEmploiTips()}catch(error){showBanner(emploiError(error),"error")}
}
async function emploiPublishTip(id,status){const t=emploiState.tips.find(row=>row.id===id);if(!t)return;try{await emploiSend(`/tips/${id}`,"PUT",{title:t.title,summary:t.summary,body:t.body,category:t.category,minutes:t.minutes,status});showBanner(status==="published"?"Conseil publié dans l’application.":"Conseil retiré de l’application.","success");loadEmploiTips()}catch(error){showBanner(emploiError(error),"error")}}

// ── Sociétés et présentations ───────────────────────────────────────────────
async function loadEmploiCompanies(){try{const [companies,meta]=await Promise.all([apiFetch(EMPLOI_API+"/companies"),apiFetch(EMPLOI_API+"/meta")]);emploiState.companies=companies.items;emploiState.logos=meta.logos||[];emploiState.error=""}catch(error){emploiState.companies=[];emploiState.error=emploiError(error)}renderEmploi()}
function emploiCompaniesHTML(){
  const items=emploiState.companies;
  if(!items)return `<div class="table-card rec-table-card">${recruitmentListSkeleton()}</div>`;
  if(!items.length)return `<div class="table-card rec-table-card">${recruitmentEmptyState({title:"Aucune société",text:"La fiche d’une société est créée avec sa première annonce."})}</div>`;
  return `<p class="rec-note">Présentation affichée dans l’application. Un champ laissé vide n’est pas affiché : aucun chiffre n’est inventé.</p>${items.map(c=>`<form class="table-card emploi-panel emploi-form" onsubmit="event.preventDefault();emploiSaveCompany(this,${Number(c.id)})"><h3 class="emploi-wide">${esc(c.society)}</h3><div><label>Nom affiché<input name="name" required minlength="2" maxlength="150" value="${esc(c.name)}"></label></div><div><label>Secteur<input name="sector" maxlength="120" value="${esc(c.sector||"")}"></label></div><div><label>Ville du siège<input name="city" maxlength="120" value="${esc(c.city||"")}"></label></div><div><label>Implantations<input name="locations" maxlength="300" value="${esc(c.locations||"")}" placeholder="Alger, Oran…"></label></div><div><label>Effectif (si vérifié)<input name="headcount" maxlength="60" value="${esc(c.headcount||"")}" placeholder="Laisser vide si non vérifié"></label></div><div><label>Logo<select name="logo_path"><option value="">Initiales</option>${(emploiState.logos||[]).map(l=>`<option value="${esc(l.path)}"${c.logo_path===l.path?" selected":""}>${esc(l.label)}</option>`).join("")}</select></label></div><div class="emploi-wide"><label>Présentation<textarea name="description" maxlength="4000">${esc(c.description||"")}</textarea></label></div><div class="emploi-wide"><label>Activités (une par ligne)<textarea name="activities" maxlength="2000">${esc(c.activities||"")}</textarea></label></div>${emploiCan()?'<button class="primary" type="submit">Enregistrer la fiche</button>':""}</form>`).join("")}`;
}
async function emploiSaveCompany(form,id){
  const data=Object.fromEntries(new FormData(form).entries()),current=emploiState.companies.find(row=>row.id===id);
  try{await emploiSend(`/companies/${id}`,"PUT",{...Object.fromEntries(Object.entries(data).map(([key,value])=>[key,value||null])),name:data.name,website:current?.website||null,is_active:current?.is_active!==false});showBanner("Fiche société enregistrée.","success");loadEmploiCompanies()}catch(error){showBanner(emploiError(error),"error")}
}
if(typeof module!=="undefined")module.exports={emploiState};
