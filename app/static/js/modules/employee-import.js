/* Import Excel des employés en masse — Administration système › Recrutement groupé.
   Fichier → Correspondance des colonnes → Vérification → Import. Toute l'analyse, les contrôles
   et la création sont faits par le serveur (/api/drh/employee-import) ; cet écran affiche,
   transmet les corrections et ne crée rien lui-même. */
const EMPLOYEE_IMPORT_STEPS=["Fichier","Correspondance des colonnes","Vérification","Import"];
const EMPLOYEE_IMPORT_PAGE=25;
const EMPLOYEE_IMPORT_STATUS={ready:["pill-green","Prêt à importer"],review:["pill-amber","À compléter / À vérifier"],blocked:["pill-red","Bloquant"],excluded:["pill-gray","Écartée"]};
const EMPLOYEE_IMPORT_OUTCOME={created:["pill-green","Créé"],duplicate:["pill-red","Doublon"],refused:["pill-amber","Refusé"],excluded:["pill-gray","Écarté"],error:["pill-red","Erreur"]};
const EMPLOYEE_IMPORT_FILTERS=[["all","Toutes"],["ready","Prêtes"],["review","À compléter / à vérifier"],["blocked","Bloquantes"],["excluded","Écartées"]];
let employeeImport=null;

function employeeImportApi(path,options={}){return sgdiApi("/drh/employee-import"+path,{...options,legacy:false})}
function employeeImportFieldLabel(key){return employeeImport?.config?.fields.find(f=>f.key===key)?.label||key}
function employeeImportSafeKey(key){return /^[a-z_]+$/.test(String(key||""))?key:""}

async function employeeImportReady(){
  if(typeof isAdminSystemSession==="function"&&isAdminSystemSession()&&!(await ensureAdminSystemApiToken()))throw new Error("Jeton Administration système absent : reconnectez-vous.");
}
async function openEmployeeExcelImport(){
  try{
    await employeeImportReady();
    const config=await employeeImportApi("/config");
    employeeImport={step:1,society:adminActiveSociete()||"",config,mapping:{},filter:"all",page:1,editing:null,busy:false,error:""};
    renderEmployeeExcelImport();
  }catch(e){toast(e.message||String(e),"error")}
}
async function downloadEmployeeImportFile(path,filename){
  try{
    await employeeImportReady();
    const response=await fetch(sgdiApiUrl("/drh/employee-import"+path,false),{headers:sgdiAuthHeaders(),cache:"no-store"});
    if(!response.ok)throw new Error(response.status===403?"Téléchargement refusé : accès Administration système requis":"Téléchargement impossible");
    const url=URL.createObjectURL(await response.blob());
    const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){toast(e.message||String(e),"error")}
}
function downloadEmployeeImportTemplate(){
  const society=adminActiveSociete();
  downloadEmployeeImportFile("/template"+(society?"?society="+encodeURIComponent(society):""),"modele-import-employes.xlsx");
}

function employeeImportStepsHTML(s){
  return `<ol class="emp-import-steps" aria-label="Étapes">${EMPLOYEE_IMPORT_STEPS.map((label,i)=>`<li class="${s.step===i+1?"is-current":s.step>i+1?"is-done":""}" ${s.step===i+1?'aria-current="step"':""}><b>${i+1}</b>${escapeHTML(label)}</li>`).join("")}</ol>`;
}
function employeeImportFileHTML(s){
  const l=s.config.limits;
  const societies=[...new Set([s.society,...(s.config.societies||[])].filter(Boolean))];
  return `<label class="label" for="emp-import-society">Société de l'import</label><select id="emp-import-society" class="select" onchange="employeeImport.society=this.value" ${s.busy?"disabled":""}><option value="">Indiquée par la colonne Société du fichier</option>${societies.map(x=>`<option value="${escapeHTML(x)}" ${x===s.society?"selected":""}>${escapeHTML(x)}</option>`).join("")}</select>
  <p class="text-xs text-slate-500 mt-1">Une société choisie ici s'applique à toutes les lignes : une autre société dans le fichier bloque la ligne.</p>
  <p class="text-sm text-slate-600 mt-1">Formats ${escapeHTML(l.extensions.join(", "))} · ${l.max_file_mb} Mo · ${l.max_rows} lignes maximum. Le fichier est lu par le serveur ; aucun employé n'est créé avant la dernière étape.</p>
  <div class="mt-3"><button type="button" class="btn btn-ghost text-xs" onclick="downloadEmployeeImportTemplate()">Télécharger le modèle Excel</button></div>
  <label id="emp-import-drop" class="emp-import-drop" tabindex="0">Glissez votre fichier ici ou cliquez pour le sélectionner
    <input type="file" accept="${escapeHTML(l.extensions.join(","))}" onchange="uploadEmployeeImportFile(this.files[0])" ${s.busy?"disabled":""}></label>`;
}
function employeeImportMappingHTML(s){
  const sheet=s.upload.sheets.find(x=>x.index===s.sheet);
  const options=key=>`<option value="">— Ignorer cette colonne —</option>${s.config.fields.map(f=>`<option value="${escapeHTML(f.key)}" ${key===f.key?"selected":""}>${escapeHTML(f.label)}${f.required?" *":""}</option>`).join("")}`;
  return `<label class="label">Feuille</label><select class="select" onchange="selectEmployeeImportSheet(Number(this.value))">${s.upload.sheets.filter(x=>x.importable).map(x=>`<option value="${x.index}" ${x.index===s.sheet?"selected":""}>${escapeHTML(x.name)} (${x.row_count} lignes)</option>`).join("")}</select>
  <p class="text-sm text-slate-600 mt-3">Associez chaque colonne Excel à un champ ATLAS. Obligatoire : <b>Nom complet</b> (Nom + Prénom dans une seule cellule) <b>ou</b> Nom et Prénom séparés, et la Société${s.society?` (par défaut : ${escapeHTML(s.society)})`:""}.</p>
  <div class="emp-import-table mt-2"><table><thead><tr><th>Colonne Excel</th><th>Exemples</th><th>Champ ATLAS</th></tr></thead><tbody>${(sheet?.columns||[]).map(c=>`<tr><td><b>${escapeHTML(c.letter)}</b> ${escapeHTML(c.header||"(sans en-tête)")}</td><td class="text-xs text-slate-500">${escapeHTML(c.samples.join(" · "))}</td><td><select class="select" aria-label="Champ pour la colonne ${escapeHTML(c.letter)}" onchange="employeeImport.mapping['${c.index}']=this.value||null">${options(s.mapping[String(c.index)])}</select></td></tr>`).join("")}</tbody></table></div>`;
}
function employeeImportCountsHTML(c){
  return `<div class="emp-import-counts"><span class="pill pill-green">${c.ready} prête(s)</span><span class="pill pill-amber">${c.review} à compléter / à vérifier</span><span class="pill pill-red">${c.blocked} bloquante(s)</span>${c.excluded?`<span class="pill pill-gray">${c.excluded} écartée(s)</span>`:""}<span class="pill pill-blue">${c.incomplete} fiche(s) à compléter parmi les prêtes</span></div>`;
}
function employeeImportNameHTML(r){
  if(!r.name?.original)return `${escapeHTML(r.values.last_name||"—")} ${escapeHTML(r.values.first_name||"")}`;
  const certain=r.name.source==="manual"||r.name.source==="validated"||r.name.confidence==="certain";
  return `<div class="text-xs text-slate-500">Excel : « ${escapeHTML(r.name.original)} »</div><div><b>${escapeHTML(r.name.last_name||"—")}</b> · ${escapeHTML(r.name.first_name||"—")}</div><span class="pill ${certain?"pill-green":"pill-amber"} text-[10px]">${r.name.source==="manual"?"Corrigé":r.name.source==="validated"?"Validé":certain?"Fiable":"À vérifier"}</span>`;
}
// Dates lues au format JJ/MM/AAAA (règle du modèle) : signalées une fois au-dessus du tableau, pas à chaque ligne.
function employeeImportIsAmbiguousDate(i){return i.level==="warning"&&/^Date ambiguë/.test(i.message)}
function employeeImportIssuesHTML(r){
  const items=r.issues.filter(i=>!employeeImportIsAmbiguousDate(i)).map(i=>`<li class="emp-issue-${escapeHTML(i.level)}">${escapeHTML(i.label)} : ${escapeHTML(i.message)}${i.suggestions?.length?` <span class="text-slate-500">Proposition : ${escapeHTML(i.suggestions.join(" / "))}</span>`:""}</li>`);
  if(r.incomplete.length&&r.status==="ready")items.push(`<li class="emp-issue-warning">Fiche à compléter : ${escapeHTML(r.incomplete.join(", "))}</li>`);
  return items.length?`<ul class="emp-import-issues">${items.join("")}</ul>`:`<span class="text-xs text-slate-400">—</span>`;
}
function employeeImportEditorHTML(r){
  const mapped=new Set(Object.values(employeeImport.preview.mapping));
  const fields=[...(mapped.has("full_name")?["last_name","first_name"]:[]),...[...mapped].filter(k=>k!=="full_name")];
  const value=key=>key==="last_name"||key==="first_name"?(r.name?.[key]??r.values[key]??""):(r.cells[key]??"");
  const codeIssue=r.issues.find(i=>i.field==="code"&&i.accept);
  const inputs=fields.map(key=>{const k=employeeImportSafeKey(key);if(!k)return"";const suggestions=r.issues.filter(i=>i.field===k||(i.field==="client_site"&&k==="site")).flatMap(i=>i.suggestions||[]);
    return `<label class="text-xs font-bold">${escapeHTML(employeeImportFieldLabel(k))}<input class="input" id="emp-fix-${k}" value="${escapeHTML(value(k))}" data-initial="${escapeHTML(value(k))}">${suggestions.map((sug,idx)=>`<button type="button" class="btn btn-ghost text-[11px] mt-1" onclick="useEmployeeImportSuggestion('${k}',${r.row},${idx})">Utiliser « ${escapeHTML(sug)} »</button>`).join("")}</label>`}).join("");
  const acceptable=r.issues.filter(i=>i.accept);
  return `<div class="emp-import-editor">${codeIssue?`<p class="text-xs mb-2" role="note">Matricule Excel : <b>${escapeHTML(r.cells.code||"")}</b>${codeIssue.suggestions?.length?` · Forme proposée : <b>${escapeHTML(codeIssue.suggestions[0])}</b>`:""}. Choisissez : conserver la valeur Excel (case ci-dessous) ou utiliser la forme proposée. Rien n'est remplacé automatiquement.</p>`:""}<div class="emp-import-grid">${inputs}</div>
  ${acceptable.length?`<fieldset class="mt-2"><legend class="text-xs font-black">Validation explicite</legend>${acceptable.map((i,idx)=>`<label class="text-xs flex gap-2 items-start mt-1"><input type="checkbox" class="emp-fix-accept" value="${idx}"> <span><b>${escapeHTML(i.accept_label||"Valider")}</b> — ${escapeHTML(i.message)}</span></label>`).join("")}</fieldset>`:""}
  <div class="flex gap-2 flex-wrap mt-3"><button type="button" class="btn btn-success text-xs" onclick="saveEmployeeImportCorrection(${r.row})" ${employeeImport.busy?"disabled":""}>Enregistrer et revérifier</button>
  <button type="button" class="btn btn-ghost text-xs" onclick="excludeEmployeeImportRow(${r.row},${r.excluded?"false":"true"})">${r.excluded?"Réintégrer la ligne":"Écarter la ligne"}</button>
  ${r.accepted?.length?`<button type="button" class="btn btn-ghost text-xs" onclick="resetEmployeeImportAccepts(${r.row})">Annuler les validations (${r.accepted.length})</button>`:""}
  <button type="button" class="btn btn-ghost text-xs" onclick="employeeImport.editing=null;renderEmployeeExcelImport()">Fermer</button></div></div>`;
}
function employeeImportPreviewHTML(s){
  const p=s.preview,rows=p.rows.filter(r=>s.filter==="all"||r.status===s.filter);
  const pages=Math.max(1,Math.ceil(rows.length/EMPLOYEE_IMPORT_PAGE));s.page=Math.min(s.page,pages);
  const shown=rows.slice((s.page-1)*EMPLOYEE_IMPORT_PAGE,s.page*EMPLOYEE_IMPORT_PAGE);
  const ambiguous=p.rows.filter(r=>r.issues.some(employeeImportIsAmbiguousDate)).length;
  return `${employeeImportCountsHTML(p.counts)}${ambiguous?`<p class="text-xs text-slate-500 mt-2">Dates lues au format JJ/MM/AAAA : ${ambiguous} ligne(s) contiennent une date dont le jour et le mois sont tous deux inférieurs ou égaux à 12. Vérifiez-les si votre fichier utilise un autre format.</p>`:""}
  <p class="text-sm text-slate-600 mt-2">Aucun employé n'a encore été créé. Seules les lignes <b>vertes</b> seront importées, chacune dans sa propre transaction. Corrigez ou validez les lignes orange ; les lignes rouges doivent être corrigées ou écartées.${p.ignored_columns.length?` Colonnes ignorées : ${escapeHTML(p.ignored_columns.join(", "))}.`:""}</p>
  <div class="flex gap-2 flex-wrap mt-2" role="group" aria-label="Filtre">${EMPLOYEE_IMPORT_FILTERS.map(([key,label])=>`<button type="button" class="btn ${s.filter===key?"btn-secondary":"btn-ghost"} text-xs" onclick="employeeImport.filter='${key}';employeeImport.page=1;renderEmployeeExcelImport()">${label}</button>`).join("")}</div>
  <div class="emp-import-table mt-2"><table><thead><tr><th>Ligne</th><th>Statut</th><th>Nom / Prénom</th><th>Matricule</th><th>Société</th><th>Poste</th><th>Client / Site</th><th>Constats</th><th></th></tr></thead><tbody>${shown.map(r=>{const st=EMPLOYEE_IMPORT_STATUS[r.status]||["pill-gray",r.status];
    return `<tr class="emp-row-${escapeHTML(r.status)}"><td>${r.row}</td><td><span class="pill ${st[0]}">${st[1]}</span></td><td>${employeeImportNameHTML(r)}</td><td>${escapeHTML(r.code_preview)}</td><td class="text-xs">${escapeHTML(r.values.society||"—")}</td><td class="text-xs">${escapeHTML(r.values.position||"—")}</td><td class="text-xs">${escapeHTML(r.client_site||"—")}</td><td>${employeeImportIssuesHTML(r)}</td><td><button type="button" class="btn btn-ghost text-xs" onclick="employeeImport.editing=${s.editing===r.row?"null":r.row};renderEmployeeExcelImport()">${s.editing===r.row?"Fermer":"Corriger"}</button></td></tr>${s.editing===r.row?`<tr><td colspan="9">${employeeImportEditorHTML(r)}</td></tr>`:""}`}).join("")||`<tr><td colspan="9" class="text-center text-slate-500 p-4">Aucune ligne pour ce filtre.</td></tr>`}</tbody></table></div>
  ${pages>1?`<div class="flex gap-2 items-center mt-2"><button type="button" class="btn btn-ghost text-xs" ${s.page<=1?"disabled":""} onclick="employeeImport.page--;renderEmployeeExcelImport()">Précédent</button><span class="text-xs">Page ${s.page} / ${pages}</span><button type="button" class="btn btn-ghost text-xs" ${s.page>=pages?"disabled":""} onclick="employeeImport.page++;renderEmployeeExcelImport()">Suivant</button></div>`:""}`;
}
function employeeImportResultHTML(s){
  const r=s.result,c=r.counts||{};
  const tile=(label,value,cls)=>`<div class="card p-3"><div class="text-xs uppercase font-black text-slate-500">${label}</div><div class="text-2xl font-black ${cls}">${value??0}</div></div>`;
  return `<div class="emp-import-bilan">${tile("Lignes lues",c.read,"text-slate-800")}${tile("Employés créés",c.created,"text-green-700")}${tile("Fiches à compléter",c.incomplete,"text-amber-700")}${tile("Doublons",c.duplicate,"text-red-700")}${tile("Lignes refusées",(c.refused||0)+(c.excluded||0),"text-amber-700")}${tile("Erreurs",c.error,"text-red-700")}</div>
  ${r.status==="processing"?`<p role="status" class="text-sm text-amber-700 mt-2">Le serveur poursuit le traitement. <button type="button" class="btn btn-ghost text-xs" onclick="refreshEmployeeImportResult()">Actualiser</button></p>`:""}
  <div class="emp-import-table mt-3"><table><thead><tr><th>Ligne</th><th>Résultat</th><th>Nom complet (Excel)</th><th>Nom</th><th>Prénom</th><th>Matricule</th><th>Motif</th></tr></thead><tbody>${(r.rows||[]).map(x=>{const o=EMPLOYEE_IMPORT_OUTCOME[x.outcome]||["pill-gray",x.outcome];return `<tr><td>${x.row}</td><td><span class="pill ${o[0]}">${o[1]}</span></td><td class="text-xs">${escapeHTML(x.original_name||"—")}</td><td>${escapeHTML(x.last_name||"—")}</td><td>${escapeHTML(x.first_name||"—")}</td><td>${escapeHTML(x.code||"—")}</td><td class="text-xs">${escapeHTML(x.reason||"")}</td></tr>`}).join("")}</tbody></table></div>`;
}
function renderEmployeeExcelImport(){
  const s=employeeImport;if(!s)return;
  let body="",actions="";
  if(s.step===1){body=employeeImportFileHTML(s)}
  else if(s.step===2){body=employeeImportMappingHTML(s);actions=`<button type="button" class="btn btn-success" onclick="previewEmployeeImport()" ${s.busy?"disabled":""}>Vérifier les données</button>`}
  else if(s.step===3){body=employeeImportPreviewHTML(s);actions=`<button type="button" class="btn btn-ghost" onclick="employeeImport.step=2;renderEmployeeExcelImport()" ${s.busy?"disabled":""}>Modifier la correspondance</button><button type="button" class="btn btn-ghost" onclick="downloadEmployeeImportFile('/'+employeeImport.upload.session_id+'/report','verification-import-employes.xlsx')">Rapport de vérification</button><button type="button" class="btn btn-success" onclick="confirmEmployeeImport()" ${s.busy||!s.preview.counts.ready?"disabled":""}>Importer ${s.preview.counts.ready} employé(s)</button>`}
  else{body=employeeImportResultHTML(s);actions=`<button type="button" class="btn btn-ghost" onclick="downloadEmployeeImportFile('/'+employeeImport.upload.session_id+'/report','rapport-import-employes.xlsx')">Télécharger le rapport d'import</button>`}
  openModal(`<style>.modal:has(.emp-import){max-width:1240px;width:calc(100vw - 32px)}.emp-import{box-sizing:border-box;max-height:84vh;overflow:auto}.emp-import-steps{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:12px 0}.emp-import-steps li{display:flex;gap:6px;align-items:center;padding:6px 10px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:12px;font-weight:700}.emp-import-steps li b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#cbd5e1;color:#fff}.emp-import-steps li.is-current{background:#e0f2fe;color:#075985}.emp-import-steps li.is-current b{background:#0369a1}.emp-import-steps li.is-done b{background:#16a34a}.emp-import-drop{display:block;margin-top:14px;padding:34px 16px;border:2px dashed #94a3b8;border-radius:14px;text-align:center;cursor:pointer;color:#475569}.emp-import-drop input{display:block;margin:12px auto 0}.emp-import-table{overflow:auto;max-height:50vh;border:1px solid #e2e8f0;border-radius:10px}.emp-import-table table{width:100%;min-width:760px}.emp-import-table th{position:sticky;top:0;background:#f8fafc;z-index:1}.emp-import-table td{vertical-align:top}.emp-import-counts{display:flex;flex-wrap:wrap;gap:6px}.emp-import-issues{margin:0;padding-left:16px;font-size:12px}.emp-issue-blocked{color:#b91c1c}.emp-issue-review{color:#b45309}.emp-issue-warning{color:#64748b}.emp-row-blocked td:first-child{box-shadow:inset 4px 0 #dc2626}.emp-row-review td:first-child{box-shadow:inset 4px 0 #d97706}.emp-row-ready td:first-child{box-shadow:inset 4px 0 #16a34a}.emp-import-editor{background:#f8fafc;border-radius:10px;padding:12px}.emp-import-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:10px}.emp-import-grid label{display:grid;gap:4px}.emp-import-bilan{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:10px}.emp-import .input,.emp-import .select{width:100%;min-width:0}</style>
  <section class="emp-import" aria-labelledby="emp-import-title"><div class="text-xs font-black uppercase tracking-widest text-slate-500">Recrutement groupé</div><h2 id="emp-import-title" class="text-2xl font-black">Importer des employés depuis Excel</h2>${employeeImportStepsHTML(s)}
  ${s.error?`<p role="alert" class="text-sm text-red-700 font-bold">${escapeHTML(s.error)}</p>`:""}${s.busy?`<p role="status" class="text-sm text-slate-500">Traitement en cours…</p>`:""}${body}
  <div class="flex gap-2 justify-end flex-wrap mt-4">${actions}<button type="button" class="btn btn-ghost" onclick="closeEmployeeExcelImport()" ${s.busy?"disabled":""}>${s.step===4?"Fermer":"Annuler"}</button></div></section>`);
  const backdrop=document.querySelector("#modal-host .modal-bg");
  if(backdrop)backdrop.addEventListener("click",e=>{if(e.target===backdrop){e.stopImmediatePropagation();if(!s.busy)closeEmployeeExcelImport()}},true);
  const drop=document.getElementById("emp-import-drop");
  if(drop){drop.ondragover=e=>e.preventDefault();drop.ondrop=e=>{e.preventDefault();uploadEmployeeImportFile(e.dataTransfer.files[0])}}
  document.querySelector(".emp-import-editor")?.scrollIntoView?.({block:"nearest"});
}
async function employeeImportRun(task){
  const s=employeeImport;if(!s||s.busy)return;
  s.busy=true;s.error="";renderEmployeeExcelImport();
  try{await employeeImportReady();await task(s)}catch(e){s.error=e.message||String(e)}finally{if(employeeImport===s){s.busy=false;renderEmployeeExcelImport()}}
}
function selectEmployeeImportSheet(index){
  const s=employeeImport;s.sheet=index;s.mapping={};
  (s.upload.sheets.find(x=>x.index===index)?.columns||[]).forEach(c=>{s.mapping[String(c.index)]=c.suggested||null});
  renderEmployeeExcelImport();
}
function uploadEmployeeImportFile(file){
  if(!file)return;
  employeeImportRun(async s=>{
    const form=new FormData();form.append("file",file);
    s.upload=await employeeImportApi(s.society?"?society="+encodeURIComponent(s.society):"",{method:"POST",body:form});
    const sheet=s.upload.sheets.find(x=>x.index===s.upload.default_sheet&&x.importable)||s.upload.sheets.find(x=>x.importable);
    if(!sheet)throw new Error("Aucune feuille importable : "+s.upload.sheets.map(x=>x.name+" ("+(x.reason||"vide")+")").join(", "));
    s.step=2;selectEmployeeImportSheet(sheet.index);
  });
}
function previewEmployeeImport(){
  employeeImportRun(async s=>{
    s.preview=await employeeImportApi("/"+s.upload.session_id+"/preview",{method:"POST",body:{sheet:s.sheet,mapping:s.mapping}});
    s.step=3;s.filter=s.preview.counts.review||s.preview.counts.blocked?"all":"ready";s.page=1;s.editing=null;
  });
}
function useEmployeeImportSuggestion(field,row,index){
  const r=employeeImport?.preview?.rows.find(x=>x.row===row);if(!r)return;
  const suggestion=r.issues.filter(i=>i.field===field||(i.field==="client_site"&&field==="site")).flatMap(i=>i.suggestions||[])[index];
  const input=document.getElementById("emp-fix-"+employeeImportSafeKey(field));
  // Une proposition client / site « CLIENT — SITE » renseigne le site seul.
  if(input&&suggestion)input.value=field==="site"&&suggestion.includes(" — ")?suggestion.split(" — ").slice(1).join(" — "):suggestion;
}
function sendEmployeeImportCorrection(row,payload){
  employeeImportRun(async s=>{
    s.preview=await employeeImportApi("/"+s.upload.session_id+"/corrections",{method:"POST",body:{row,...payload}});
    const updated=s.preview.rows.find(x=>x.row===row);
    if(updated&&(updated.status==="ready"||updated.status==="excluded"))s.editing=null;
  });
}
function saveEmployeeImportCorrection(row){
  const r=employeeImport.preview.rows.find(x=>x.row===row);if(!r)return;
  const values={};
  document.querySelectorAll(".emp-import-editor input[id^='emp-fix-']").forEach(input=>{if(input.value!==input.dataset.initial)values[input.id.slice(8)]=input.value});
  const acceptable=r.issues.filter(i=>i.accept);
  const accept=[...(r.accepted||[]),...[...document.querySelectorAll(".emp-fix-accept:checked")].map(box=>acceptable[Number(box.value)]?.accept).filter(Boolean)];
  sendEmployeeImportCorrection(row,{values,accept});
}
function excludeEmployeeImportRow(row,exclude){sendEmployeeImportCorrection(row,{exclude})}
function resetEmployeeImportAccepts(row){sendEmployeeImportCorrection(row,{accept:[]})}
function confirmEmployeeImport(){
  const s=employeeImport;if(!s?.preview?.counts.ready)return;
  if(!confirm(`Créer ${s.preview.counts.ready} employé(s) ? Les autres lignes ne seront pas importées.`))return;
  employeeImportRun(async s=>{
    // Jusqu'à 1 000 créations : délai propre, au-delà le résultat enregistré est relu.
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),300000);
    try{s.result={status:"completed",...await employeeImportApi("/"+s.upload.session_id+"/confirm",{method:"POST",signal:ctrl.signal})};s.step=4}
    catch(e){
      try{const saved=await employeeImportApi("/"+s.upload.session_id+"/result");if(["processing","completed","failed"].includes(saved.status)){s.result=saved;s.step=4}}catch(ignore){}
      if(s.step!==4)throw e;
    }finally{clearTimeout(timer)}
    try{if(typeof sgdiPullEmployees==="function")await sgdiPullEmployees()}catch(e){s.error="Employés créés ; actualisation de la liste indisponible."}
    logActivity("Import Excel des employés",`${s.result.counts?.created||0} créé(s) · ${s.result.counts?.read||0} ligne(s) lue(s)`);
  });
}
function refreshEmployeeImportResult(){
  employeeImportRun(async s=>{s.result=await employeeImportApi("/"+s.upload.session_id+"/result")});
}
async function closeEmployeeExcelImport(){
  const s=employeeImport;if(s?.busy)return;
  if(s?.upload?.session_id&&s.step<4){try{await employeeImportApi("/"+s.upload.session_id+"/cancel",{method:"POST"})}catch(e){}}
  employeeImport=null;closeModal();renderView();
}
SGDIModules.registerModule({key:"employee-import",routes:[]});
