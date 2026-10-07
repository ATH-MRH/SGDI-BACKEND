// Assistant d'import Excel de candidats (recrute.irongs.com).
// Fichier → Correspondance des colonnes → Vérification → Résultat.
// Toute l'analyse est faite par le serveur ; rien n'est créé avant « Confirmer l'import ».
// Dépend des fonctions globales de recrute.html : apiFetch, esc, recruitmentCan, showBanner.
const IMPORT_API="/api/drh/candidates/import";
const IMPORT_STEPS=["Fichier","Correspondance des colonnes","Vérification","Résultat"];
const IMPORT_PAGE_SIZE=20;
const IMPORT_REASONS={telephone:"même téléphone",email:"même e-mail",identite:"même nom, prénom et date de naissance",nin:"même NIN"};
const IMPORT_ACTIONS={skip:"Ignorer",create:"Créer quand même",update:"Mettre à jour la fiche"};
const IMPORT_FILTERS=[["all","Toutes"],["valid","À créer"],["duplicate","Doublons"],["error","Erreurs"],["warning","Avertissements"]];
let importState=null;

function importNewState(){
  return {step:0,busy:false,error:"",config:null,file:null,upload:null,sheet:null,mapping:{},preview:null,decisions:{},filter:"all",page:1,result:null,confirmed:false};
}
function importErrorMessage(error){
  const message=error?.message;
  if(Array.isArray(message))return message.map(item=>item?.msg||String(item)).join(" ; ");
  return typeof message==="string"&&message?message:"Une erreur est survenue";
}
function importFileSize(bytes){return bytes>=1048576?(bytes/1048576).toFixed(1).replace(".",",")+" Mo":Math.max(1,Math.round(bytes/1024))+" Ko"}
function importPlural(count,singular,plural){return `${count} ${count>1?plural:singular}`}

async function openCandidateImport(){
  if(!recruitmentCan("create"))return;
  document.getElementById("importBackdrop")?.remove();
  importState=importNewState();
  const backdrop=document.createElement("div");
  backdrop.id="importBackdrop";backdrop.className="modal-backdrop";
  backdrop.setAttribute("role","dialog");backdrop.setAttribute("aria-modal","true");backdrop.setAttribute("aria-labelledby","importTitle");
  backdrop.addEventListener("click",event=>{if(event.target===backdrop)closeCandidateImport()});
  document.body.appendChild(backdrop);
  renderCandidateImport();
  try{
    const config=await apiFetch(IMPORT_API+"/config");
    if(!importState)return;
    importState.config=config;
  }catch(error){if(importState)importState.error=importErrorMessage(error)}
  renderCandidateImport();
}
// Fermer ou annuler avant la confirmation abandonne la session : aucun candidat n'est créé.
async function closeCandidateImport(){
  const state=importState;
  if(!state||state.busy)return;
  importState=null;
  document.getElementById("importBackdrop")?.remove();
  if(state.upload&&!state.confirmed){
    try{await apiFetch(`${IMPORT_API}/${state.upload.session_id}/cancel`,{method:"POST"})}catch(error){/* la session expire seule */}
  }
}
function importFields(){return importState?.config?.fields||[]}
function importFieldLabel(key){return importFields().find(field=>field.key===key)?.label||key}
function importSheet(){return importState.upload?.sheets?.find(sheet=>sheet.index===importState.sheet)||null}
function importMappedCount(){return Object.values(importState.mapping).filter(Boolean).length}
function importMissingRequired(){
  const used=new Set(Object.values(importState.mapping).filter(Boolean));
  return importFields().filter(field=>field.required&&!used.has(field.key)).map(field=>field.label);
}

function renderCandidateImport(){
  const host=document.getElementById("importBackdrop");
  const state=importState;
  if(!host||!state)return;
  const stepper=IMPORT_STEPS.map((label,index)=>`<li class="imp-step${index===state.step?" is-current":index<state.step?" is-done":""}"${index===state.step?' aria-current="step"':""}><span>${index+1}</span>${esc(label)}</li>`).join("");
  const body=[importStepFile,importStepMapping,importStepPreview,importStepResult][state.step]();
  host.innerHTML=`<div class="modal imp-modal" data-step="${state.step}"${state.busy?' aria-busy="true"':""}>
    <div class="modal-head"><div><h2 id="importTitle">Importer des candidats depuis Excel</h2><ol class="imp-steps" aria-label="Étapes de l’import">${stepper}</ol></div><button type="button" class="modal-close" aria-label="Fermer" onclick="closeCandidateImport()"${state.busy?" disabled":""}>×</button></div>
    <div class="imp-body">${body}<div id="importError" class="error${state.error?" show":""}" role="alert">${esc(state.error)}</div></div>
    <div class="modal-actions">${importActions()}</div></div>`;
}
function importActions(){
  const state=importState,busy=state.busy?" disabled":"";
  if(state.step===0)return `<button type="button" class="secondary" onclick="closeCandidateImport()"${busy}>Annuler</button>`;
  if(state.step===1){
    const missing=importMissingRequired();
    return `<button type="button" class="secondary" onclick="closeCandidateImport()"${busy}>Annuler</button><button type="button" class="secondary" onclick="importBack()"${busy}>Retour</button><button type="button" class="primary" id="importPreviewBtn" onclick="importRunPreview()"${state.busy||missing.length||!importSheet()?.importable?" disabled":""}>${state.busy?"Vérification…":"Vérifier les données"}</button>`;
  }
  if(state.step===2){
    const plan=importPlan(),total=plan.create+plan.update;
    return `<button type="button" class="secondary" onclick="closeCandidateImport()"${busy}>Annuler</button><button type="button" class="secondary" onclick="importBack()"${busy}>Retour</button><button type="button" class="primary" id="importConfirmBtn" onclick="importConfirm()"${state.busy||!total?" disabled":""}>${state.busy?"Import en cours…":`Confirmer l’import (${total})`}</button>`;
  }
  return `<button type="button" class="secondary" onclick="importDownload('report')"${busy}>Télécharger le rapport</button><button type="button" class="primary" onclick="closeCandidateImport()">Terminer</button>`;
}
function importBack(){
  if(importState.busy)return;
  importState.error="";
  importState.step=Math.max(0,importState.step-1);
  renderCandidateImport();
}

// ── Étape 1 : fichier ──
function importStepFile(){
  const state=importState,limits=state.config?.limits;
  const limitText=limits?`Formats ${limits.extensions.join(" ou ")} · ${limits.max_file_mb} Mo et ${limits.max_rows} lignes maximum par fichier.`:"Chargement des limites…";
  const current=state.upload?`<p class="imp-file-current">Fichier analysé : <b>${esc(state.upload.file_name)}</b> (${importFileSize(state.upload.file_size)}) <button type="button" class="link-btn" onclick="importGoMapping()">Reprendre la correspondance →</button></p>`:"";
  return `<div class="imp-drop${state.busy?" is-busy":""}" id="importDrop" tabindex="0" role="button" aria-label="Sélectionner ou déposer un fichier Excel" onclick="importPickFile()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();importPickFile()}" ondragover="event.preventDefault();this.classList.add('is-over')" ondragleave="this.classList.remove('is-over')" ondrop="importDropFile(event)">
      <strong>${state.busy?"Analyse du fichier…":"Glissez-déposez votre fichier Excel ici"}</strong>
      <span>${state.busy?"Lecture des feuilles et des colonnes par le serveur.":"ou cliquez pour le sélectionner"}</span>
      <input id="importFileInput" class="hidden" type="file" accept=".xlsx,.xls" onchange="importUpload(this.files[0]);this.value=''">
    </div>
    <p class="imp-note">${esc(limitText)} Les macros et formules ne sont jamais exécutées.</p>${current}
    <div class="imp-template"><div><b>Pas encore de fichier ?</b><span>Le modèle contient les en-têtes attendus, les listes de valeurs et un exemple.</span></div><button type="button" class="secondary" onclick="importDownload('template')"${state.busy?" disabled":""}>Télécharger le modèle Excel</button></div>`;
}
function importPickFile(){if(!importState.busy)document.getElementById("importFileInput")?.click()}
function importDropFile(event){
  event.preventDefault();
  event.currentTarget.classList.remove("is-over");
  importUpload(event.dataTransfer?.files?.[0]);
}
async function importUpload(file){
  const state=importState;
  if(!file||!state||state.busy)return;
  const limits=state.config?.limits;
  state.error="";
  if(!/\.(xlsx|xls)$/i.test(file.name)){state.error="Format non pris en charge : sélectionnez un fichier .xlsx ou .xls.";renderCandidateImport();return}
  if(limits&&file.size>limits.max_file_bytes){state.error=`Fichier trop volumineux (maximum ${limits.max_file_mb} Mo).`;renderCandidateImport();return}
  state.busy=true;renderCandidateImport();
  try{
    const form=new FormData();form.append("file",file,file.name);
    const upload=await apiFetch(IMPORT_API,{method:"POST",body:form});
    if(importState!==state)return;
    state.upload=upload;state.preview=null;state.decisions={};state.result=null;
    importSelectSheet(upload.default_sheet??upload.sheets[0]?.index??null);
    state.step=1;
  }catch(error){if(importState===state)state.error=importErrorMessage(error)}
  finally{if(importState===state){state.busy=false;renderCandidateImport()}}
}
function importGoMapping(){importState.error="";importState.step=1;renderCandidateImport()}

// ── Étape 2 : correspondance ──
function importSelectSheet(index){
  const state=importState;
  state.sheet=index===null||index===""?null:Number(index);
  state.mapping={};
  (importSheet()?.columns||[]).forEach(column=>{state.mapping[column.index]=column.suggested||null});
  state.preview=null;state.decisions={};
}
function importChangeSheet(value){importSelectSheet(value);importState.error="";renderCandidateImport()}
// Un champ ne peut alimenter qu'une colonne : le choisir ailleurs libère l'ancienne colonne.
function importSetMapping(columnIndex,key){
  const state=importState;
  let released=null;
  if(key)Object.keys(state.mapping).forEach(other=>{if(Number(other)!==Number(columnIndex)&&state.mapping[other]===key){state.mapping[other]=null;released=other}});
  state.mapping[columnIndex]=key||null;
  state.preview=null;state.decisions={};
  const column=importSheet().columns.find(item=>Number(item.index)===Number(released));
  state.error=column?`Le champ « ${importFieldLabel(key)} » était associé à la colonne ${column.letter} : celle-ci est maintenant ignorée.`:"";
  renderCandidateImport();
}
function importStepMapping(){
  const state=importState,sheet=importSheet(),sheets=state.upload.sheets;
  const sheetPicker=sheets.length>1?`<label for="importSheetSelect">Feuille à importer</label><select id="importSheetSelect" onchange="importChangeSheet(this.value)">${sheets.map(item=>`<option value="${item.index}"${item.index===state.sheet?" selected":""}${item.importable?"":" disabled"}>${esc(item.name)} — ${item.importable?importPlural(item.row_count,"ligne","lignes"):esc(item.reason||"non importable")}</option>`).join("")}</select>`:"";
  if(!sheet||!sheet.importable){
    const reasons=sheets.map(item=>`<li><b>${esc(item.name)}</b> : ${esc(item.reason||"non importable")}</li>`).join("");
    return `${sheetPicker}<div class="imp-empty"><strong>Aucune feuille importable</strong><ul>${reasons}</ul><span>Corrigez le fichier puis revenez à l’étape précédente.</span></div>`;
  }
  const options=importFields().map(field=>`<option value="${esc(field.key)}">${esc(field.label)}${field.required?" *":""}</option>`).join("");
  const rows=sheet.columns.map(column=>{
    const value=state.mapping[column.index]||"";
    const select=`<select aria-label="Champ pour la colonne ${esc(column.letter)}" data-column="${column.index}" onchange="importSetMapping(${column.index},this.value)"><option value="">— Ignorer cette colonne —</option>${options.replace(`value="${esc(value)}"`,`value="${esc(value)}" selected`)}</select>`;
    const note=!value&&column.duplicate_of?`<small class="imp-hint">Même en-tête que la colonne ${esc(column.duplicate_of)}</small>`:(!value&&!column.suggested&&column.header?'<small class="imp-hint">En-tête non reconnu</small>':"");
    return `<tr class="${value?"":"is-ignored"}"><td data-label="Colonne"><b>${esc(column.letter)}</b> ${esc(column.header||"(sans en-tête)")}</td><td data-label="Exemples" class="imp-samples">${column.samples.map(sample=>`<span>${esc(sample)}</span>`).join("")||"—"}</td><td data-label="Champ de la fiche">${select}${note}</td></tr>`;
  }).join("");
  const missing=importMissingRequired();
  return `${sheetPicker}<p class="imp-note">Feuille <b>${esc(sheet.name)}</b> · en-têtes en ligne ${sheet.header_row} · ${importPlural(sheet.row_count,"ligne de données","lignes de données")} · ${importMappedCount()} colonne(s) associée(s) sur ${sheet.columns.length}. Les colonnes ignorées ne sont pas importées.</p>
    ${missing.length?`<p class="imp-warning" role="status">Champs obligatoires sans colonne : ${esc(missing.join(", "))}.</p>`:""}
    <div class="imp-table-wrap"><table class="imp-table imp-mapping"><thead><tr><th>Colonne du fichier</th><th>Exemples</th><th>Champ de la fiche candidat</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
async function importRunPreview(){
  const state=importState;
  if(state.busy||importMissingRequired().length)return;
  state.busy=true;state.error="";renderCandidateImport();
  try{
    const preview=await apiFetch(`${IMPORT_API}/${state.upload.session_id}/preview`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sheet:state.sheet,mapping:state.mapping})});
    if(importState!==state)return;
    state.preview=preview;state.decisions={};state.filter="all";state.page=1;state.step=2;
  }catch(error){if(importState===state)state.error=importErrorMessage(error)}
  finally{if(importState===state){state.busy=false;renderCandidateImport()}}
}

// ── Étape 3 : vérification ──
function importRowAction(row){return row.status==="duplicate"?(importState.decisions[row.row]||row.default_action):row.default_action}
function importPlan(){
  const plan={create:0,update:0,skip:0,error:0};
  (importState.preview?.rows||[]).forEach(row=>{if(row.status==="error")plan.error++;else plan[importRowAction(row)]++});
  return plan;
}
function importFilteredRows(){
  const filter=importState.filter;
  return (importState.preview?.rows||[]).filter(row=>filter==="all"||(filter==="warning"?row.warnings.length>0:row.status===filter));
}
function importSetFilter(filter){importState.filter=filter;importState.page=1;renderCandidateImport()}
function importSetPage(page){importState.page=page;renderCandidateImport()}
function importSetDecision(rowNumber,action){importState.decisions[rowNumber]=action;renderCandidateImport()}
function importMatchText(match){
  const reasons=match.reasons.map(reason=>IMPORT_REASONS[reason]||reason).join(", ");
  if(!match.visible)return `Fiche hors de votre périmètre (${reasons})`;
  const kind=match.type==="salarie"?"Salarié":"Dossier";
  return `${kind} n° ${match.id} — ${match.name} · ${match.state}${match.society?` · ${match.society}`:""} (${reasons})`;
}
function importRowDetails(row){
  const parts=[];
  row.errors.forEach(item=>parts.push(`<li class="imp-issue is-error"><b>${esc(item.label)}</b> : ${esc(item.message)}</li>`));
  row.matches.forEach(match=>parts.push(`<li class="imp-issue is-duplicate">${esc(importMatchText(match))}</li>`));
  row.internal.forEach(item=>parts.push(`<li class="imp-issue is-duplicate">Doublon de la ligne ${item.row} du fichier (${esc(item.reasons.map(reason=>IMPORT_REASONS[reason]||reason).join(", "))})</li>`));
  if(row.ambiguous)parts.push('<li class="imp-issue is-duplicate">Plusieurs correspondances : aucune fusion automatique.</li>');
  row.warnings.forEach(item=>parts.push(`<li class="imp-issue is-warning"><b>${esc(item.label)}</b> : ${esc(item.message)}</li>`));
  if(row.status==="duplicate"&&importRowAction(row)==="update")parts.push(`<li class="imp-issue is-change">Modifications de la fiche n° ${row.update_target} : ${row.changes.map(change=>`<b>${esc(change.label)}</b> ${esc(change.old||"(vide)")} → ${esc(change.new)}`).join(" ; ")}</li>`);
  return parts.length?`<ul class="imp-issues">${parts.join("")}</ul>`:'<span class="imp-ok">Aucune anomalie</span>';
}
function importRowState(row){
  if(row.status==="error")return '<span class="pill pill-red">Erreur</span>';
  if(row.status==="valid")return `<span class="pill pill-green">À créer</span>`;
  if(row.actions.length<2)return '<span class="pill pill-amber">Doublon</span>';
  const current=importRowAction(row);
  return `<span class="pill pill-amber">Doublon</span><select class="imp-decision" aria-label="Action pour la ligne ${row.row}" onchange="importSetDecision(${row.row},this.value)">${row.actions.map(action=>`<option value="${action}"${action===current?" selected":""}>${IMPORT_ACTIONS[action]}</option>`).join("")}</select>`;
}
function importStepPreview(){
  const state=importState,preview=state.preview,counts=preview.counts,plan=importPlan();
  const rows=importFilteredRows(),pages=Math.max(1,Math.ceil(rows.length/IMPORT_PAGE_SIZE));
  state.page=Math.min(state.page,pages);
  const visible=rows.slice((state.page-1)*IMPORT_PAGE_SIZE,state.page*IMPORT_PAGE_SIZE);
  const filterCount={all:counts.analyzed,valid:counts.valid,duplicate:counts.duplicates,error:counts.errors,warning:counts.warnings};
  const filters=IMPORT_FILTERS.map(([key,label])=>`<button type="button" class="imp-filter${state.filter===key?" is-active":""}" aria-pressed="${state.filter===key}" onclick="importSetFilter('${key}')">${label} <b>${filterCount[key]}</b></button>`).join("");
  const body=visible.map(row=>{
    const values=row.values,name=[values.last_name,values.first_name].filter(Boolean).join(" ")||"—";
    const contact=[values.phone,values.email].filter(Boolean).map(esc).join("<br>")||"—";
    return `<tr class="is-${row.status}"><td data-label="Ligne">${row.row}</td><td data-label="Candidat"><b>${esc(name)}</b>${values.birth_date?`<small>Né(e) le ${esc(values.birth_date)}</small>`:""}</td><td data-label="Contact">${contact}</td><td data-label="Poste">${esc(values.desired_position||"—")}</td><td data-label="État" class="imp-state">${importRowState(row)}</td><td data-label="Détail">${importRowDetails(row)}</td></tr>`;
  }).join("")||'<tr><td colspan="6" class="empty">Aucune ligne pour ce filtre.</td></tr>';
  const summary=[`${plan.create} à créer`,`${plan.update} à mettre à jour`,`${plan.skip} doublon(s) ignoré(s)`,`${plan.error} ligne(s) en erreur exclue(s)`].join(" · ");
  const ignored=preview.ignored_columns.length?` Colonnes ignorées : ${esc(preview.ignored_columns.join(", "))}.`:"";
  const anomalies=counts.errors+counts.duplicates+counts.warnings;
  return `<p class="imp-note">Feuille <b>${esc(preview.sheet.name)}</b> · ${importPlural(counts.analyzed,"ligne analysée","lignes analysées")}${counts.empty_rows?` · ${importPlural(counts.empty_rows,"ligne vide ignorée","lignes vides ignorées")}`:""}.${ignored}</p>
    <div class="imp-summary" role="status"><b>À la confirmation :</b> ${esc(summary)}. Les nouvelles fiches arrivent dans « Nouvelles candidatures ».${anomalies?` <button type="button" class="link-btn" onclick="importDownload('report')">Télécharger les anomalies</button>`:""}</div>
    ${preview.can_update?"":'<p class="imp-note">Votre compte ne permet pas de mettre à jour une fiche existante : les doublons peuvent seulement être ignorés ou créés explicitement.</p>'}
    <div class="imp-filters" role="group" aria-label="Filtrer les lignes">${filters}</div>
    <div class="imp-table-wrap"><table class="imp-table imp-preview"><thead><tr><th>Ligne</th><th>Candidat</th><th>Contact</th><th>Poste</th><th>État</th><th>Détail</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="pagination imp-pagination"><span>Lignes ${rows.length?(state.page-1)*IMPORT_PAGE_SIZE+1:0}–${Math.min(state.page*IMPORT_PAGE_SIZE,rows.length)} sur ${rows.length}</span><div class="btns"><button type="button" onclick="importSetPage(${state.page-1})"${state.page<=1?" disabled":""}>Précédent</button><button type="button" onclick="importSetPage(${state.page+1})"${state.page>=pages?" disabled":""}>Suivant</button></div></div>`;
}
async function importConfirm(){
  const state=importState;
  if(state.busy||state.confirmed)return;                    // double clic : une seule requête
  state.busy=true;state.error="";renderCandidateImport();
  try{
    const decisions={};
    state.preview.rows.forEach(row=>{if(row.status==="duplicate")decisions[row.row]=importRowAction(row)});
    const result=await apiFetch(`${IMPORT_API}/${state.upload.session_id}/confirm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({decisions})});
    if(importState!==state)return;
    state.result=result;state.confirmed=true;state.step=3;
    importRefreshRecruitment();
  }catch(error){if(importState===state)state.error=importErrorMessage(error)}
  finally{if(importState===state){state.busy=false;renderCandidateImport()}}
}
// Liste, compteurs et pipeline actualisés sans rechargement de la page.
function importRefreshRecruitment(){
  try{
    recruitmentDashboardData=null;
    if(recruitSection==="dashboard")renderRecruitDashboard(true);
    else if(recruitSection==="candidates"){tabState.new.page=1;loadTab(activeTab);if(activeTab!=="new")loadTab("new")}
    else refreshRecruitCurrentSection();
  }catch(error){/* l'import est enregistré : l'actualisation reste possible à la main */}
}

// ── Étape 4 : résultat ──
function importStepResult(){
  const result=importState.result,counts=result.counts;
  const tiles=[["Lignes analysées",counts.analyzed,""],["Candidats créés",counts.created,"is-good"],["Fiches mises à jour",counts.updated,"is-good"],["Doublons ignorés",counts.skipped,"is-warn"],["Lignes en erreur",counts.errors,counts.errors?"is-bad":""]];
  if(counts.failed)tiles.push(["Échecs d’enregistrement",counts.failed,"is-bad"]);
  const problems=result.rows.filter(row=>row.outcome!=="created"&&row.outcome!=="updated");
  const labels={skipped:"Doublon ignoré",error:"Erreur de données",failed:"Échec"};
  const list=problems.slice(0,8).map(row=>`<tr><td data-label="Ligne">${row.row}</td><td data-label="Résultat">${esc(labels[row.outcome]||row.outcome)}</td><td data-label="Motif">${row.field?`<b>${esc(row.field)}</b> : `:""}${esc(row.reason)}</td></tr>`).join("");
  return `<div class="imp-done" role="status"><strong>${result.already_processed?"Import déjà enregistré":"Import terminé"}</strong><span>${esc(result.file_name)} · feuille ${esc(result.sheet)}</span></div>
    <div class="imp-tiles">${tiles.map(([label,value,tone])=>`<div class="imp-tile ${tone}"><b>${value}</b><span>${esc(label)}</span></div>`).join("")}</div>
    ${problems.length?`<div class="imp-table-wrap"><table class="imp-table"><thead><tr><th>Ligne</th><th>Résultat</th><th>Motif</th></tr></thead><tbody>${list}</tbody></table></div>${problems.length>8?`<p class="imp-note">${problems.length-8} autre(s) ligne(s) dans le rapport téléchargeable.</p>`:""}`:'<p class="imp-note">Toutes les lignes ont été importées.</p>'}`;
}

// Téléchargements authentifiés (le jeton n'est jamais placé dans une URL).
async function importDownload(kind){
  const state=importState;
  if(!state||state.busy)return;
  const url=kind==="template"?IMPORT_API+"/template":`${IMPORT_API}/${state.upload.session_id}/report`;
  const name=kind==="template"?"modele-import-candidats.xlsx":"rapport-import-candidats.xlsx";
  state.error="";
  try{
    const response=await fetch(url,{headers:{Authorization:"Bearer "+recruteSession.token}});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.detail||"Téléchargement impossible")}
    const link=document.createElement("a");
    link.href=URL.createObjectURL(await response.blob());link.download=name;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }catch(error){if(importState===state){state.error=importErrorMessage(error);renderCandidateImport()}}
}
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&importState&&!importState.busy)closeCandidateImport()});
