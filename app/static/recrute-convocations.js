// Recrutement — convocations à un entretien : création (brouillon ou envoi), versions, PDF, scan du QR,
// arrivée du candidat et compte rendu. Les convocations sont les entretiens de la candidature
// (API /api/drh/job-offers) : aucun second système. Le QR ne donne accès à rien sans session recruteur.

const CONV_STATUS={draft:["Brouillon, non envoyée","pill-amber"],proposed:["Envoyée","pill-blue"],confirmed:["Envoyée","pill-blue"],
  cancelled:["Annulée","pill-gray"],done:["Entretien réalisé","pill-green"],no_show:["Absence constatée","pill-red"]};
const CONV_CANDIDATE_PILL={new:"pill-amber",viewed:"pill-blue",confirmed:"pill-green",rescheduled:"pill-amber",cancelled:"pill-gray",done:"pill-green",no_show:"pill-red"};
const CONV_VERSION_STATE={active:"En vigueur",superseded:"Remplacée",cancelled:"Annulée",closed:"Entretien clos"};
const CONV_SCAN_STATE={active:["Convocation en vigueur","pill-green"],superseded:["Ancienne version","pill-red"],cancelled:["Convocation annulée","pill-red"],
  closed:["Entretien déjà clos","pill-gray"],past:["Date dépassée","pill-amber"]};
const CONV_PENDING_KEY="atlas_recrute_pending_convocation";
let convState={form:null,requestId:null,preview:false,scan:null,scanner:null,scanError:"",scanBusy:false};

function convRequestId(){
  // Clé d'idempotence (pas un secret) : la même pour toutes les relances d'un même formulaire.
  const bytes=new Uint8Array(12),random=globalThis.crypto?.getRandomValues;
  if(random)globalThis.crypto.getRandomValues(bytes);else for(let index=0;index<bytes.length;index++)bytes[index]=Math.floor(Math.random()*256);
  return "conv-"+[...bytes].map(value=>value.toString(16).padStart(2,"0")).join("");
}
// Horodatages serveur (UTC) affichés à l'heure d'Alger, comme les heures d'entretien.
function convUtc(value){
  if(!value)return "";
  try{return new Intl.DateTimeFormat("fr-FR",{timeZone:"Africa/Algiers",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(String(value).replace(/Z?$/,"Z")))}
  catch(_){return String(value).slice(0,16).replace("T"," ")}
}
function convDateTime(value){return typeof emploiDateTime==="function"?emploiDateTime(value):String(value||"")}
function convCan(action="create"){return typeof emploiCan==="function"?emploiCan(action):false}

// ── Onglet « Convocations et entretiens » du dossier ─────────────────────────
function convocationsTabHTML(d){
  const open=d.outcome!=="withdrawn"&&!(d.outcome==="unfavorable"&&d.outcome_communicated);
  const defaults=d.convocation_defaults||{};
  const header=`<header class="conv-head"><h3>Convocations et entretiens</h3><div class="emploi-actions">
      ${convCan("create")&&open?`<button type="button" class="primary" onclick="convOpenForm(null)">Convoquer le candidat</button>`:""}
      <button type="button" class="secondary" onclick="convOpenScanner()">Scanner une convocation</button></div></header>`;
  const account=defaults.has_account===false?`<p class="rec-note conv-warning">Ce dossier n’a pas d’espace IRON Emploi : une convocation ne sera pas reçue dans l’application. Téléchargez son PDF pour la remettre au candidat${defaults.has_email?", ou cochez l’envoi par e-mail":""}. Aucun compte n’est créé automatiquement.</p>`:"";
  return `<section class="table-card emploi-panel conv-panel">${convScanBannerHTML(d)}${header}${account}
    ${convState.form?convFormHTML(d):""}
    ${d.interviews.length?d.interviews.map(i=>convCardHTML(d,i,open)).join(""):'<p class="emploi-empty">Aucune convocation pour cette candidature.</p>'}
    ${d.dossier_convocation?`<p class="rec-note">Convocation historique saisie sur le dossier du candidat : ${esc(formatDateFr(d.dossier_convocation.date))}${d.dossier_convocation.heure?` à ${esc(d.dossier_convocation.heure)}`:""}${d.dossier_convocation.lieu?`, ${esc(d.dossier_convocation.lieu)}`:""}. Elle concerne le dossier, pas cette candidature en particulier.</p>`:""}</section>`;
}
function convCardHTML(d,i,open){
  const [label,pill]=CONV_STATUS[i.status]||[i.status,"pill-gray"],sent=i.status!=="draft"&&i.version>0,live=["proposed","confirmed"].includes(i.status);
  const facts=[["Date",`${convDateTime(i.starts_at)} (heure d’Alger)`],["Lieu",i.location],["Adresse",i.address],["Interlocuteur",i.contact],["Coordonnées",i.contact_details],["Objet",i.purpose],["Pièces à apporter",i.documents_to_bring],["Consignes",i.note]].filter(([,value])=>value);
  const actions=[];
  if(convCan("create")&&open){
    if(i.status==="draft")actions.push(`<button type="button" class="primary" onclick="convSend(${Number(i.id)})">Envoyer la convocation</button>`,`<button type="button" class="secondary" onclick="convOpenForm(${Number(i.id)})">Modifier le brouillon</button>`);
    if(live)actions.push(`<button type="button" class="secondary" onclick="convOpenForm(${Number(i.id)},true)">Reporter ou modifier</button>`);
    if(live&&!i.version)actions.push(`<button type="button" class="secondary" onclick="convSend(${Number(i.id)})">Émettre le document avec QR</button>`);
    if(i.status==="draft"||live)actions.push(`<button type="button" class="secondary" onclick="convCancel(${Number(i.id)},${i.status==="draft"})">${i.status==="draft"?"Supprimer le brouillon":"Annuler"}</button>`);
    if(i.can_confirm_arrival)actions.push(`<button type="button" class="primary" onclick="convConfirmArrival(${Number(i.id)},${Number(i.version)})">Confirmer l’arrivée du candidat</button>`);
    if(live)actions.push(`<button type="button" class="secondary" onclick="convOutcomeForm(${Number(i.id)})"${i.past?"":` title="Disponible à l’heure de l’entretien"`}>Compte rendu de l’entretien</button>`);
  }
  if(i.status==="draft"||!i.version)actions.push(`<button type="button" class="secondary" onclick="convOpenPdf(${Number(i.id)},null)">${i.status==="draft"?"Aperçu PDF":"PDF (sans QR)"}</button>`);
  return `<article class="emploi-interview conv-card" id="conv-${Number(i.id)}"><header class="conv-card-head"><div><b>${esc(i.reference)}${sent?` · version ${Number(i.version)}`:""}</b><div class="emploi-sub">${esc(convDateTime(i.starts_at))} · heure d’Alger${i.previous_starts_at?` · reportée, initialement ${esc(convDateTime(i.previous_starts_at))}`:""}</div></div>
      <div class="emploi-state"><span class="pill ${pill}">${esc(label)}</span>${i.candidate_state_label?`<span class="pill ${CONV_CANDIDATE_PILL[i.candidate_state]||"pill-gray"}">Candidat : ${esc(i.candidate_state_label)}</span>`:""}</div></header>
    <dl class="conv-facts">${facts.map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value).replace(/\n/g,"<br>")}</dd>`).join("")}</dl>
    ${i.arrived_at?`<p class="conv-arrival">Arrivée confirmée le ${esc(convUtc(i.arrived_at))} (heure d’Alger) par ${esc(i.arrived_by||"")}</p>`:""}
    ${i.report||i.appreciation||i.assessment?`<p class="emploi-quote"><b>Compte rendu interne${i.appreciation?` — ${esc(i.appreciation)}`:""}${i.assessment?` · note ${String(i.assessment.average).replace(".",",")} / 10`:""}</b><br>${esc(i.report||"")}</p>`:""}
    ${i.versions?.length?`<details class="conv-versions"><summary>Versions envoyées (${i.versions.length})</summary><ul>${i.versions.map(v=>`<li><span>Version ${Number(v.version)} · ${esc(convDateTime(v.starts_at))} · émise le ${esc(formatDateFr(v.issued_at))} par ${esc(v.issued_by||"")}</span><span class="pill ${v.state==="active"?"pill-green":"pill-gray"}">${esc(CONV_VERSION_STATE[v.state]||v.state)}</span><button type="button" class="dashboard-mini-action" onclick="convOpenPdf(${Number(i.id)},${Number(v.version)})">PDF</button></li>`).join("")}</ul></details>`:""}
    ${actions.length?`<div class="emploi-actions">${actions.join("")}</div>`:""}<div id="convOutcome${Number(i.id)}"></div></article>`;
}

// ── Formulaire : création, brouillon, report ─────────────────────────────────
function convOpenForm(id,sent=false){
  const d=emploiState.dossier;const i=id?d.interviews.find(row=>row.id===id):null;
  convState={...convState,form:{id,sent:!!sent,values:i?{...i}:null},requestId:id?null:convRequestId(),preview:false};
  renderEmploi();document.getElementById("convForm")?.scrollIntoView?.({block:"start",behavior:"smooth"});
}
function convCloseForm(){convState={...convState,form:null,requestId:null,preview:false};renderEmploi()}
function convFormHTML(d){
  const f=convState.form,v=f.values||{},defaults=d.convocation_defaults||{};
  const [day,time]=v.starts_at?String(v.starts_at).split("T"):["",""];
  const value=(key,fallback="")=>esc(v[key]??fallback??"");
  const society=defaults.society_fixed?`<div class="emploi-wide conv-fixed"><span class="conv-label">Société qui convoque</span><b>${esc(defaults.society_name||defaults.society||"")}</b>${defaults.logo_available?"":' <span class="emploi-sub">— aucun logo enregistré : le document n’en portera pas</span>'}</div>`
    :`<div><label>Société qui convoque<select name="society" required><option value="">— Choisir —</option>${(defaults.societies||[]).map(c=>`<option value="${esc(c.society)}"${(v.society||defaults.society)===c.society?" selected":""}>${esc(c.name)}</option>`).join("")}</select></label></div>`;
  return `<form id="convForm" class="emploi-form conv-form" onsubmit="event.preventDefault()" oninput="convState.preview&&convRenderPreview(this)">
    <div class="emploi-wide conv-context"><span><b>${esc(defaults.candidate||"")}</b> · dossier ${esc(defaults.dossier_reference||"")} · candidature ${esc(defaults.application_reference||"")}</span>
      <span>${defaults.offer?`Annonce : ${esc(defaults.offer.title)}${defaults.offer.reference?` (réf. ${esc(defaults.offer.reference)})`:""}`:"Candidature spontanée"} · poste : ${esc(defaults.position||"")}</span></div>
    ${f.sent?'<p class="emploi-wide rec-note conv-warning">Convocation déjà envoyée : un changement crée une nouvelle version, prévient le candidat et rend l’ancien QR obsolète. Un report demande une nouvelle confirmation de présence.</p>':""}
    ${society}
    <div><label>Date<input name="date" type="date" required value="${esc(day)}"></label></div>
    <div><label>Heure (heure d’Alger)<input name="time" type="time" required value="${esc((time||"").slice(0,5))}"></label></div>
    <div><label>Lieu<input name="location" required maxlength="300" value="${value("location",defaults.location)}"></label></div>
    <div class="emploi-wide"><label>Adresse complète<textarea name="address" maxlength="400" rows="2">${value("address")}</textarea></label></div>
    <div class="emploi-wide"><label>Lien cartographique (facultatif, https)<input name="map_url" type="url" maxlength="400" pattern="https://.+" placeholder="https://…" value="${value("map_url")}"></label></div>
    <div><label>Interlocuteur<input name="contact" maxlength="150" value="${value("contact",defaults.contact)}"></label></div>
    <div><label>Coordonnées professionnelles<input name="contact_details" maxlength="200" value="${value("contact_details",defaults.contact_details)}"></label></div>
    <div class="emploi-wide"><label>Objet<input name="purpose" maxlength="200" value="${value("purpose",defaults.purpose)}"></label></div>
    <div class="emploi-wide"><label>Pièces à apporter (une par ligne)<textarea name="documents_to_bring" maxlength="1000" rows="3">${value("documents_to_bring")}</textarea></label></div>
    <div class="emploi-wide"><label>Consignes complémentaires<textarea name="note" maxlength="1000" rows="2">${value("note")}</textarea></label></div>
    ${defaults.has_email?'<label class="emploi-check"><input type="checkbox" name="send_email"> Envoyer aussi la convocation par e-mail (si le canal est configuré)</label>':""}
    <div class="emploi-wide emploi-actions conv-form-actions">
      <button type="button" class="secondary" onclick="convState.preview=!convState.preview;convRenderPreview(this.form)">${convState.preview?"Masquer l’aperçu":"Aperçu avant envoi"}</button>
      ${f.id&&f.sent?"":'<button type="button" class="secondary" data-conv-submit onclick="convSubmit(this.form,\'draft\')">Enregistrer le brouillon</button>'}
      <button type="button" class="primary" data-conv-submit onclick="convSubmit(this.form,\'send\')">${f.sent?"Enregistrer et prévenir le candidat":"Envoyer la convocation"}</button>
      <button type="button" class="secondary" onclick="convCloseForm()">Fermer</button></div>
    <div id="convPreview" class="emploi-wide"></div></form>`;
}
function convFormBody(form){
  const data=Object.fromEntries(new FormData(form).entries());
  const body={starts_at:`${data.date}T${data.time}:00`,location:data.location,contact:data.contact||null,contact_details:data.contact_details||null,
    address:data.address||null,map_url:data.map_url||null,purpose:data.purpose||null,documents_to_bring:data.documents_to_bring||null,note:data.note||null,
    send_email:data.send_email==="on"};
  if(data.society!==undefined)body.society=data.society||null;
  return body;
}
function convRenderPreview(form){
  const host=document.getElementById("convPreview");if(!host)return;
  if(!convState.preview){host.innerHTML="";return}
  const defaults=emploiState.dossier.convocation_defaults||{},b=convFormBody(form);
  const society=defaults.society_name||(defaults.societies||[]).find(c=>c.society===b.society)?.name||b.society||"Société à choisir";
  const when=b.starts_at.length>=16&&!b.starts_at.startsWith("T")?`${formatDateFr(b.starts_at.slice(0,10))} à ${b.starts_at.slice(11,16)} (heure d’Alger)`:"Date et heure à saisir";
  const rows=[["Candidat",defaults.candidate],["Candidature",defaults.application_reference],["Dossier",defaults.dossier_reference],["Annonce",defaults.offer?.title],["Poste",defaults.position],["Objet",b.purpose],["Date",when],["Lieu",b.location],["Adresse",b.address],["Interlocuteur",b.contact],["Coordonnées",b.contact_details],["Pièces à apporter",b.documents_to_bring],["Consignes",b.note]].filter(([,value])=>value);
  host.innerHTML=`<div class="conv-preview" aria-live="polite"><div class="conv-preview-head"><b>${esc(society)}</b><span>Aperçu — ${convState.form?.sent?"nouvelle version":"le QR est créé à l’envoi"}</span></div>
    <h4>Convocation à un entretien</h4><dl class="conv-facts">${rows.map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value).replace(/\n/g,"<br>")}</dd>`).join("")}</dl>
    <p class="conv-preview-note">Présentez cette convocation à votre arrivée.</p></div>`;
}
async function convSubmit(form,mode){
  if(!form.reportValidity())return;
  const f=convState.form,body=convFormBody(form);
  if(f.sent&&!confirm("Le candidat sera prévenu et l’ancienne version de la convocation deviendra obsolète. Continuer ?"))return;
  form.querySelectorAll("[data-conv-submit]").forEach(button=>button.disabled=true);
  const result=await emploiAct(()=>f.id?emploiSend(`/interviews/${f.id}`,"PUT",body)
    :emploiSend(`/applications/${emploiState.dossier.id}/interviews`,"POST",{...body,mode,request_id:convState.requestId}),"");
  if(result&&result.id){convState={...convState,form:null,requestId:null,preview:false};renderEmploi()}
  else form.querySelectorAll("[data-conv-submit]").forEach(button=>button.disabled=false);    // même identifiant de requête au prochain essai
}
function convSend(id){
  if(!confirm("Envoyer la convocation ? Le candidat la recevra dans son espace IRON Emploi."))return;
  return emploiAct(()=>emploiSend(`/interviews/${id}/send`,"POST"),"");
}
function convCancel(id,draft){
  if(!confirm(draft?"Supprimer ce brouillon ? Le candidat n’en a jamais été informé.":"Annuler cette convocation ? Le candidat sera prévenu et le QR affichera l’annulation."))return;
  return emploiAct(()=>emploiSend(`/interviews/${id}/cancel`,"POST"),draft?"Brouillon supprimé.":"Convocation annulée, candidat prévenu.");
}
async function convOpenPdf(id,version){
  try{
    const blob=await emploiFetchBlob(`/interviews/${id}/convocation${version?`?version=${Number(version)}`:""}`);
    const i=emploiState.dossier.interviews.find(row=>row.id===id);
    emploiSaveBlob(blob,`${i?.reference||"convocation"}${version?`-V${version}`:"-apercu"}.pdf`);
  }catch(error){showBanner(esc(emploiError(error)),"error")}
}

// ── Arrivée et compte rendu ─────────────────────────────────────────────────
async function convConfirmArrival(id,version){
  const d=emploiState.dossier;
  if(!confirm(`Confirmer l’arrivée de ${d.convocation_defaults?.candidate||"ce candidat"} ? L’heure et votre nom seront enregistrés. Aucune décision n’est prise.`))return;
  const result=await emploiAct(()=>emploiSend(`/interviews/${id}/arrival`,"POST",{version}),"Arrivée du candidat enregistrée.");
  if(result&&convState.scan&&convState.scan.interview_id===id)convState.scan={...convState.scan,can_confirm_arrival:false,arrived:true};
  if(result)renderEmploi();
}
function convOutcomeForm(id){
  const i=emploiState.dossier.interviews.find(row=>row.id===id),host=document.getElementById(`convOutcome${id}`);if(!host||!i)return;
  if(!i.past){host.innerHTML='<p class="rec-note">Le compte rendu se remplit à l’heure de l’entretien ou après : l’arrivée du candidat se confirme d’abord.</p>';return}
  const criteria=typeof INTERVIEW_CRITERIA!=="undefined"?INTERVIEW_CRITERIA:[],scores=i.assessment?.scores||{};
  const options=value=>typeof interviewOptions==="function"?interviewOptions(value):"";
  host.innerHTML=`<form class="emploi-form" onsubmit="event.preventDefault();convSaveOutcome(this,${Number(id)})">
    <div><label>Présence<select name="attendance"><option value="present">Présent</option>${i.arrived_at?"":'<option value="absent">Absent</option>'}</select></label></div>
    <div><label>Appréciation<select name="appreciation"><option value="">—</option>${["Favorable","Réservé","Défavorable"].map(value=>`<option${i.appreciation===value?" selected":""}>${value}</option>`).join("")}</select></label></div>
    ${criteria.length?`<div class="emploi-wide interview-grid conv-grid">${criteria.map(([key,label])=>`<label for="conv_${Number(id)}_${key}">${esc(label)}</label><select class="interview-note" id="conv_${Number(id)}_${key}" name="score_${key}">${options(scores[key])}</select>`).join("")}</div>`:""}
    <div class="emploi-wide"><label>Compte rendu (interne, jamais transmis au candidat)<textarea name="report" maxlength="6000">${esc(i.report||"")}</textarea></label></div>
    <p class="emploi-wide rec-note">Le compte rendu n’entraîne aucune décision : la décision se prend dans l’onglet Traitement.</p>
    <button class="primary" type="submit">Enregistrer le compte rendu</button></form>`;
}
function convSaveOutcome(form,id){
  const data=Object.fromEntries(new FormData(form).entries()),scores={};
  for(const [key,value] of Object.entries(data))if(key.startsWith("score_")&&value!=="")scores[key.slice(6)]=Number(value);
  // Une fois le compte rendu enregistré, le résumé du scan ne décrit plus l'entretien : il est retiré.
  return emploiAct(async()=>{const result=await emploiSend(`/interviews/${id}/outcome`,"POST",{attendance:data.attendance,report:data.report||null,appreciation:data.appreciation||null,scores});
    if(convState.scan?.interview_id===id)convState.scan=null;return result},"Compte rendu enregistré.");
}

// ── Scan : caméra, image importée ou référence saisie ───────────────────────
function convScanBannerHTML(d){
  const s=convState.scan;if(!s||s.application_id!==d.id)return "";
  const [label,pill]=CONV_SCAN_STATE[s.state]||[s.state,"pill-gray"],x=s.summary||{};
  return `<div class="conv-scan" role="status"><header><b>Convocation scannée</b><span class="pill ${pill}">${esc(label)}</span><button type="button" class="conv-close" aria-label="Fermer le résumé" onclick="convState.scan=null;renderEmploi()">×</button></header>
    ${s.warning?`<p class="conv-scan-warning">${esc(s.warning)}</p>`:""}
    <dl class="conv-facts"><dt>Candidat</dt><dd>${esc(x.candidate)}</dd><dt>Poste</dt><dd>${esc(x.position)}</dd><dt>Société</dt><dd>${esc(x.society||"—")}</dd>
      <dt>Horaire présenté</dt><dd>${esc(convDateTime(x.starts_at))} (heure d’Alger)</dd>${x.current_starts_at&&x.current_starts_at.slice(0,16)!==x.starts_at?`<dt>Horaire en vigueur</dt><dd><b>${esc(convDateTime(x.current_starts_at))}</b></dd>`:""}
      <dt>Version</dt><dd>${esc(s.reference)} · version ${Number(s.version)}${s.current_version!==s.version?` (en vigueur : ${Number(s.current_version)})`:""}</dd>
      <dt>Réponse du candidat</dt><dd>${esc(x.candidate_state_label||"")}${x.confirmed_by_candidate?" · présence confirmée dans l’application":" · présence non confirmée"}</dd>
      ${x.arrived_at||s.arrived?`<dt>Arrivée</dt><dd>Confirmée${x.arrived_by?` par ${esc(x.arrived_by)}`:""}</dd>`:""}</dl>
    <div class="emploi-actions">${s.can_confirm_arrival&&convCan("create")?`<button type="button" class="primary" onclick="convConfirmArrival(${Number(s.interview_id)},${Number(s.version)})">Confirmer l’arrivée du candidat</button>`:""}
      <button type="button" class="secondary" onclick="document.getElementById('conv-${Number(s.interview_id)}')?.scrollIntoView?.({block:'center'})">Voir l’entretien</button></div></div>`;
}
function convScannerHTML(){
  return `<div class="modal conv-scanner" role="dialog" aria-modal="true" aria-labelledby="convScanTitle"><div class="modal-head"><div><h2 id="convScanTitle">Scanner une convocation</h2>
      <div class="emploi-sub">Le QR ouvre le dossier pour un recruteur connecté et autorisé. Rien n’est enregistré par le scan.</div></div>
      <button type="button" class="modal-close" aria-label="Fermer" onclick="convCloseScanner()">×</button></div>
    <div id="convScanReader" class="conv-reader" aria-label="Aperçu de la caméra"></div>
    <div class="emploi-actions"><button type="button" class="primary" onclick="convStartCamera()">Activer la caméra</button>
      <label class="secondary conv-file">Importer une image du QR<input type="file" accept="image/*" onchange="convScanFile(this)"></label></div>
    <form class="conv-manual" onsubmit="event.preventDefault();convResolve(this.reference.value)"><label>Ou saisissez la référence imprimée<input name="reference" autocomplete="off" placeholder="CONV-2026-000042-V2" required></label><button type="submit" class="secondary">Rechercher</button></form>
    <p id="convScanError" class="conv-scan-error" role="alert">${esc(convState.scanError)}</p></div>`;
}
function convOpenScanner(){
  convCloseScanner();convState.scanError="";
  const backdrop=document.createElement("div");backdrop.id="convScanModal";backdrop.className="modal-backdrop";backdrop.innerHTML=convScannerHTML();
  backdrop.addEventListener("click",event=>{if(event.target===backdrop)convCloseScanner()});document.body.appendChild(backdrop);
  backdrop.querySelector("input[name=reference]")?.focus();
}
function convScanMessage(text){convState.scanError=text||"";const el=document.getElementById("convScanError");if(el)el.textContent=convState.scanError}
function convLoadLibrary(){
  if(typeof Html5Qrcode!=="undefined")return Promise.resolve();
  return new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="/static/html5-qrcode.min.js?v=1";
    script.onload=()=>resolve();script.onerror=()=>reject(new Error("Lecteur de QR indisponible"));document.head.appendChild(script)});
}
async function convStartCamera(){
  convScanMessage("");
  try{
    await convLoadLibrary();
    if(convState.scanner)return;
    const scanner=new Html5Qrcode("convScanReader");convState.scanner=scanner;
    await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:240,height:240}},text=>{convStopCamera();convResolve(text)},()=>{});
  }catch(error){
    convState.scanner=null;
    const denied=/permission|notallowed|denied/i.test(String(error?.name||error?.message||error));
    convScanMessage(denied?"Accès à la caméra refusé. Importez une photo du QR ou saisissez la référence imprimée.":"Caméra indisponible sur cet appareil. Importez une photo du QR ou saisissez la référence imprimée.");
  }
}
async function convStopCamera(){const scanner=convState.scanner;convState.scanner=null;if(scanner){try{await scanner.stop();scanner.clear()}catch(_){}}}
async function convScanFile(input){
  const file=input.files?.[0];if(!file)return;convScanMessage("");
  try{await convLoadLibrary();await convStopCamera();const reader=new Html5Qrcode("convScanReader");const text=await reader.scanFile(file,false);reader.clear();convResolve(text)}
  catch(error){convScanMessage("Aucun QR lisible sur cette image. Recadrez la photo ou saisissez la référence.")}
  finally{input.value=""}
}
function convCloseScanner(){convStopCamera();document.getElementById("convScanModal")?.remove()}
async function convResolve(code){
  if(convState.scanBusy)return;convState.scanBusy=true;convScanMessage("Recherche de la convocation…");
  try{
    const result=await apiFetch(`${EMPLOI_API}/convocations/resolve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:String(code||"").trim()})});
    convCloseScanner();convState.scan=result;
    await openEmploiDossier(result.application_id,"interviews");
    document.getElementById(`conv-${Number(result.interview_id)}`)?.classList.add("conv-highlight");
  }catch(error){
    const messages={403:"Accès refusé : cette convocation ne relève pas de votre périmètre.",404:"Convocation inconnue : aucun envoi ne correspond à ce code.",422:"QR code ou référence invalide."};
    const text=messages[error?.status]||emploiError(error);
    if(document.getElementById("convScanModal"))convScanMessage(text);else showBanner(esc(text),"error");
  }finally{convState.scanBusy=false}
}

// ── Lien ouvert depuis un QR : https://…/#convocation=… ─────────────────────
// Le fragment n'est jamais envoyé au serveur ; il est retiré de l'adresse dès la lecture et gardé pour
// cet onglet seulement, le temps de se connecter. Aucune redirection n'est suivie.
function convCapturePendingScan(){
  const match=/^#convocation=([A-Za-z0-9_-]{32})$/.exec(location.hash||"");
  if(!match)return null;
  try{sessionStorage.setItem(CONV_PENDING_KEY,match[1])}catch(_){}
  history.replaceState(null,"",location.pathname+location.search);
  const note=document.getElementById("loginPendingConvocation");if(note)note.classList.remove("hidden");
  return match[1];
}
function convResumePendingScan(){
  let token=null;try{token=sessionStorage.getItem(CONV_PENDING_KEY);sessionStorage.removeItem(CONV_PENDING_KEY)}catch(_){}
  document.getElementById("loginPendingConvocation")?.classList.add("hidden");
  if(token)convResolve(token);
}
if(typeof window!=="undefined"){convCapturePendingScan();window.addEventListener("hashchange",()=>{if(convCapturePendingScan()&&recruteSession?.token)convResumePendingScan()})}
