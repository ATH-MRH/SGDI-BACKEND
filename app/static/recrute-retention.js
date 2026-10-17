// Conservation des données (recrute.irongs.com) : dossiers arrivés à échéance, en consultation seule.
// L'écran ne fait que lire GET /api/drh/recruitment-retention : il n'existe ni suppression ni modification.
// L'accès est décidé par le serveur ; un refus (403) est affiché tel quel, sans autre tentative.
// Dépend des fonctions globales de recrute.html : apiFetch, esc, formatDateFr, recruitmentListSkeleton,
// recruitmentEmptyState, recruitmentErrorState.
const RETENTION_API="/api/drh/recruitment-retention";
const RETENTION_PAGE_SIZE=20;
const RETENTION_CATEGORIES=[["declined_applications","Candidatures refusées","Candidature refusée"],["declined_dossiers","Dossiers du vivier refusés","Dossier du vivier refusé"],
  ["inactive_accounts","Espaces candidats inactifs","Espace candidat inactif"],["departed_recruits","Personnes recrutées puis parties","Personne recrutée puis partie"]];
// Libellés des décomptes renvoyés par l'API ; une clé inconnue est affichée telle quelle plutôt que masquée.
const RETENTION_ITEMS={application:"Candidature",documents:"Pièces",messages:"Messages",interviews:"Entretiens",notes:"Notes",events:"Lignes d’historique",document_requests:"Demandes de pièces",
  contracts:"Contrat préparé",account:"Espace candidat",cv:"CV",photo:"Photo",alerts:"Alertes d’offres",notifications:"Notifications",push_deliveries:"Envois push en file",push_devices:"Appareils de notification",sessions:"Sessions ouvertes",
  candidate_dossier:"Dossier de candidature",applications_detached:"Candidatures conservées, détachées de l’espace",
  profile_snapshot:"Copie du profil envoyée",profile_snapshots:"Copies du profil jointes aux candidatures conservées"};
let retentionState={data:null,error:"",forbidden:false,loading:false,request:0,asOf:"",category:"",query:"",society:"",page:1,open:""};

function retentionHost(){return document.getElementById("retentionSection")}
function retentionRows(){
  const data=retentionState.data;if(!data)return [];
  return RETENTION_CATEGORIES.flatMap(([key,,label])=>(data[key]||[]).map((item,index)=>({...item,category:key,category_label:label,row_id:`${key}-${index}`})))
    .sort((a,b)=>String(a.due_on||"").localeCompare(String(b.due_on||""))||String(a.name||"").localeCompare(String(b.name||"")));
}
function retentionFiltered(){
  const needle=retentionState.query.trim().toLowerCase();
  return retentionRows().filter(row=>(!retentionState.category||row.category===retentionState.category)&&(!retentionState.society||row.society===retentionState.society)
    &&(!needle||[row.name,row.reference,row.society,row.employee_code].some(value=>String(value||"").toLowerCase().includes(needle))));
}
function retentionEntries(counts){return Object.entries(counts||{}).filter(([,value])=>Number(value)>0)}
function retentionSummary(row){
  const parts=retentionEntries(row.would_delete).map(([key,value])=>`${esc(RETENTION_ITEMS[key]||key)}${Number(value)>1?` × ${Number(value)}`:""}`);
  return parts.length?parts.join(" · "):"—";
}
function retentionDetail(row){
  const list=(counts,empty)=>{const entries=Object.entries(counts||{});
    return entries.length?`<ul class="retention-list">${entries.map(([key,value])=>`<li><span>${esc(RETENTION_ITEMS[key]||key)}</span><strong>${Number(value)||0}</strong></li>`).join("")}</ul>`:`<p class="rec-note">${empty}</p>`};
  return `<div class="retention-detail"><div><h4>Éléments concernés</h4>${list(row.would_delete,"L’API ne détaille aucun élément pour ce dossier.")}</div>`
    +(row.would_keep?`<div><h4>Éléments qui seraient conservés</h4>${list(row.would_keep,"Aucun.")}${row.would_keep_reason?`<p class="rec-note">${esc(row.would_keep_reason)}</p>`:""}</div>`:"")
    +`<div><h4>Repères</h4><ul class="retention-list">${[["Référence",row.reference],["Société",row.society],["Poste",row.position],["Matricule employé",row.employee_code],["Statut employé",row.employee_status],
      ["Base de la date",row.basis]].filter(([,value])=>value).map(([label,value])=>`<li><span>${label}</span><strong>${esc(value)}</strong></li>`).join("")||"<li><span>Aucun autre repère</span></li>"}</ul></div></div>`;
}

async function loadRetention(){
  const request=++retentionState.request;
  retentionState.loading=true;retentionState.error="";retentionState.forbidden=false;renderRetention();
  try{
    const data=await apiFetch(RETENTION_API+(retentionState.asOf?`?as_of=${encodeURIComponent(retentionState.asOf)}`:""));
    if(request!==retentionState.request)return;
    retentionState.data=data;
  }catch(error){
    if(request!==retentionState.request)return;
    retentionState.data=null;retentionState.forbidden=error?.status===403;retentionState.error=String(error?.message||"Une erreur est survenue");
  }
  retentionState.loading=false;
  if(typeof recruitSection==="undefined"||recruitSection==="retention")renderRetention();
}
function refreshRetention(){retentionState.page=1;retentionState.open="";return loadRetention()}
function retentionSimulate(){
  const value=document.getElementById("retentionAsOf")?.value||"";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return;
  retentionState.asOf=value;return refreshRetention();
}
function retentionToday(){retentionState.asOf="";return refreshRetention()}
function retentionSetCategory(key){retentionState.category=retentionState.category===key?"":key;retentionState.page=1;retentionState.open="";renderRetention()}
function retentionSelectCategory(key){retentionState.category=key;retentionState.page=1;retentionState.open="";renderRetention()}
function retentionSearch(value){retentionState.query=value;retentionState.page=1;retentionState.open="";renderRetentionResults()}
function retentionSetSociety(value){retentionState.society=value;retentionState.page=1;retentionState.open="";renderRetentionResults()}
function retentionPage(page){retentionState.page=page;retentionState.open="";renderRetentionResults()}
function retentionToggle(id){retentionState.open=retentionState.open===id?"":id;renderRetentionResults()}
function retentionResetFilters(){retentionState.category="";retentionState.query="";retentionState.society="";retentionState.page=1;renderRetention()}

function renderRetentionResults(){
  const host=document.getElementById("retentionResults");if(!host)return;
  const rows=retentionFiltered(),pages=Math.max(1,Math.ceil(rows.length/RETENTION_PAGE_SIZE));
  retentionState.page=Math.min(Math.max(1,retentionState.page),pages);
  const start=(retentionState.page-1)*RETENTION_PAGE_SIZE,shown=rows.slice(start,start+RETENTION_PAGE_SIZE);
  const filtered=retentionState.category||retentionState.query.trim()||retentionState.society;
  if(!rows.length){
    host.innerHTML=recruitmentEmptyState(filtered
      ?{title:"Aucun dossier ne correspond",text:"Modifiez la recherche ou les filtres.",action:'<button type="button" class="secondary" onclick="retentionResetFilters()">Effacer les filtres</button>'}
      :{title:"Aucun dossier arrivé à échéance",text:`Aucun dossier n’a dépassé ${Number(retentionState.data?.retention_months)||24} mois à la date ${retentionState.data?.simulated?"simulée":"du jour"}.`});
    return;
  }
  host.innerHTML=`<div class="table-card rec-table-card"><div class="candidate-table-wrap"><table class="rec-table retention-table"><thead><tr><th>Candidat</th><th>Catégorie</th><th>Date de référence</th><th>Échéance</th><th>Données concernées</th><th><span class="sr-only">Détail</span></th></tr></thead><tbody>${
    shown.map(row=>{const open=retentionState.open===row.row_id;
      return `<tr class="retention-row${open?" open":""}"><td data-label="Candidat"><strong>${esc(row.name||"—")}</strong>${row.reference?`<div class="emploi-sub">${esc(row.reference)}</div>`:""}${row.society?`<div class="emploi-sub">${esc(row.society)}</div>`:""}</td>
        <td data-label="Catégorie"><span class="pill pill-gray">${esc(row.category_label)}</span></td>
        <td data-label="Date de référence">${esc(formatDateFr(row.reference_on))}${row.basis?`<div class="emploi-sub">${esc(row.basis)}</div>`:""}</td>
        <td data-label="Échéance"><strong>${esc(formatDateFr(row.due_on))}</strong></td>
        <td data-label="Données concernées">${retentionSummary(row)}</td>
        <td class="retention-action"><button type="button" class="secondary" aria-expanded="${open}" onclick="retentionToggle('${row.row_id}')">${open?"Masquer":"Détail"}</button></td></tr>`
        +(open?`<tr class="retention-detail-row"><td colspan="6">${retentionDetail(row)}</td></tr>`:"")}).join("")
  }</tbody></table></div><div class="pagination"><span>${start+1}–${start+shown.length} sur ${rows.length} dossier${rows.length>1?"s":""}</span><div class="btns">
    <button type="button" ${retentionState.page<=1?"disabled":""} onclick="retentionPage(${retentionState.page-1})">Précédent</button>
    <button type="button" ${retentionState.page>=pages?"disabled":""} onclick="retentionPage(${retentionState.page+1})">Suivant</button></div></div></div>`;
}

function renderRetention(){
  const host=retentionHost();if(!host)return;
  const state=retentionState,data=state.data;
  const header=`<header class="rec-page-header"><div class="rec-page-heading"><h2>Conservation des données</h2><p>Dossiers arrivés à échéance, à examiner avant toute décision. Consultation seule.</p></div>
    <div class="rec-page-actions retention-simulate"><label for="retentionAsOf">Simuler une date</label><input type="date" id="retentionAsOf" value="${esc(state.asOf)}">
      <button type="button" class="secondary" onclick="retentionSimulate()">Simuler</button>${state.asOf?'<button type="button" class="secondary" onclick="retentionToday()">Revenir à aujourd’hui</button>':""}</div></header>
    <p class="rec-note retention-readonly">Cet écran ne supprime et ne modifie rien. Les dossiers sont examinés par la déléguée à la protection des données ; toute suppression est validée par la direction.</p>`;
  if(state.loading){host.setAttribute("aria-busy","true");host.innerHTML=header+recruitmentListSkeleton();return}
  host.removeAttribute("aria-busy");
  if(state.forbidden){
    host.innerHTML=header+`<div class="rec-empty-state rec-error-state" role="alert"><div class="rec-empty-text"><strong>Accès non autorisé</strong><p>${esc(state.error)}</p>
      <p>Cet écran demande un compte ayant accès au recrutement et un périmètre global sur les sociétés, ou un compte administrateur. Adressez-vous à l’administrateur du système.</p></div></div>`;
    return;
  }
  if(state.error||!data){host.innerHTML=header+recruitmentErrorState(esc(state.error||"Les échéances n’ont pas pu être chargées."),"refreshRetention()");return}
  const societies=[...new Set(retentionRows().map(row=>row.society).filter(Boolean))].sort();
  if(state.society&&!societies.includes(state.society))state.society="";
  const mode=data.simulated
    ?`<div class="retention-mode simulated" role="status"><strong>Simulation au ${esc(formatDateFr(data.generated_on))}</strong> — ces résultats ne sont pas les échéances actuelles. Ils montrent ce qui aurait dépassé ${Number(data.retention_months)} mois à cette date.</div>`
    :`<div class="retention-mode" role="status"><strong>Échéances au ${esc(formatDateFr(data.generated_on))}</strong> — dossiers dont la date de référence est antérieure ou égale au ${esc(formatDateFr(data.due_before))} (${Number(data.retention_months)} mois).</div>`;
  const counters=`<div class="emploi-counters retention-counters">${RETENTION_CATEGORIES.map(([key,label])=>{const count=Number(data.counts?.[key])||0;
    return `<button type="button" class="emploi-counter${state.category===key?" active":""}" aria-pressed="${state.category===key}" onclick="retentionSetCategory('${key}')"><strong>${count}</strong><span>${label}</span>${count>=Number(data.limit)?'<span class="emploi-warn">liste limitée</span>':""}</button>`}).join("")}</div>`;
  const filters=`<div class="emploi-filters retention-filters"><input type="search" id="retentionSearch" placeholder="Rechercher un nom, une référence, une société" aria-label="Rechercher" value="${esc(state.query)}" oninput="retentionSearch(this.value)">
    <select aria-label="Catégorie" onchange="retentionSelectCategory(this.value)"><option value="">Toutes les catégories</option>${RETENTION_CATEGORIES.map(([key,label])=>`<option value="${key}"${state.category===key?" selected":""}>${label}</option>`).join("")}</select>
    ${societies.length>1?`<select aria-label="Société" onchange="retentionSetSociety(this.value)"><option value="">Toutes les sociétés</option>${societies.map(name=>`<option value="${esc(name)}"${state.society===name?" selected":""}>${esc(name)}</option>`).join("")}</select>`:""}</div>`;
  const undated=data.undated||[];
  const review=`<section class="table-card rec-table-card retention-review"><h3>À vérifier <span class="pill pill-amber">${undated.length}</span></h3>
    <p class="rec-note">Dossiers sans date exploitable : leur échéance ne peut pas être calculée. La date doit être retrouvée et renseignée dans le dossier concerné.</p>${undated.length
      ?`<div class="candidate-table-wrap"><table class="rec-table retention-table"><thead><tr><th>Candidat</th><th>Société</th><th>Motif</th></tr></thead><tbody>${undated.map(item=>`<tr><td data-label="Candidat"><strong>${esc(item.name||"—")}</strong>${item.reference?`<div class="emploi-sub">${esc(item.reference)}</div>`:""}${item.employee_code?`<div class="emploi-sub">Matricule ${esc(item.employee_code)}</div>`:""}</td>
        <td data-label="Société">${esc(item.society||"—")}</td><td data-label="Motif">${esc(item.reason||"—")}</td></tr>`).join("")}</tbody></table></div>`
      :'<p class="rec-note">Aucun dossier à vérifier.</p>'}</section>`;
  host.innerHTML=header+mode+counters+filters+'<div id="retentionResults"></div>'+review;
  renderRetentionResults();
}
