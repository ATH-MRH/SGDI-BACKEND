/* Phase 2 — recruitment. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function archivedCandidateDate(c){return String(c.archivedAt||c.updatedAt||c.createdAt||"").slice(0,10)}

function candidatIsNew(c){
  return candidatIsActive(c)&&!candidatIsReserve(c)&&!c.removedFromRecruitmentAt;
}

function candidatArchiveSourceLabel(c){return c&&c.archiveSource==="reserve"?"Candidat en réserve":"Candidat"}

function archiveCandidateFilters(){
  try{return JSON.parse(sessionStorage.getItem("archiveCandidateFilters")||"{}")}catch(e){return{}}
}

function setArchiveCandidateFilter(key,value){
  const f=archiveCandidateFilters();
  f[key]=value||"";
  sessionStorage.setItem("archiveCandidateFilters",JSON.stringify(f));
  renderView();
}

function resetArchiveCandidateFilters(){
  sessionStorage.removeItem("archiveCandidateFilters");
  renderView();
}

function openAddCandidateForm(){
  navigate("recrutement/nouveau");
}

function candidatImportActionsHTML(mode="reserve"){
  if(mode==="new")return `<div class="recrutement-actions-row flex gap-2 flex-wrap justify-end items-center"><button class="btn btn-secondary recrutement-template-btn" onclick="downloadCandidateExcelTemplate()">Modèle Excel</button><button class="btn btn-secondary recrutement-import-btn" onclick="openCandidateExcelImportNew()">Importer Excel</button><button class="btn btn-secondary recrutement-import-free-btn" onclick="openCandidateFreeExcelImportNew()">Excel libre</button><button class="btn btn-primary recrutement-add-btn" onclick="openAddCandidateForm()">+ Ajouter candidat</button></div>`;
  return `<div class="recrutement-actions-row flex gap-2 flex-wrap justify-end items-center"><button class="btn btn-secondary recrutement-template-btn" onclick="downloadCandidateExcelTemplate()">Modèle Excel</button><button class="btn btn-secondary recrutement-import-btn" onclick="openCandidateExcelImport()">Importer Excel</button><button class="btn btn-secondary recrutement-import-free-btn" onclick="openCandidateFreeExcelImport()">Excel libre</button><button class="btn btn-primary recrutement-add-btn" onclick="openAddCandidateForm()">+ Ajouter candidat</button></div>`;
}

function candidateBulkDeleteMode(mode){
  if(mode!=="reserve"&&mode!=="new")return false;
  if(mode==="new")return true;
  return sessionStorage.getItem("candidateBulkDeleteMode:"+mode)==="1"||sessionStorage.getItem("reserveBulkDeleteMode")==="1"&&mode==="reserve";
}

function setCandidateBulkDeleteMode(mode,v){sessionStorage.setItem("candidateBulkDeleteMode:"+mode,v?"1":"0");if(mode==="reserve")sessionStorage.setItem("reserveBulkDeleteMode",v?"1":"0");renderView()}

function reserveBulkDeleteMode(){return candidateBulkDeleteMode("reserve")}

function setReserveBulkDeleteMode(v){setCandidateBulkDeleteMode("reserve",v)}

function reserveBulkSelectionHeaderHTML(mode){return candidateBulkDeleteMode(mode)?`<th style="width:42px">Suppr.</th>`:""}

function reserveBulkSelectionCellHTML(c,mode){
  if(!candidateBulkDeleteMode(mode))return "";
  return `<td onclick="event.stopPropagation()" class="text-center"><input type="checkbox" data-reserve-delete-id="${escapeHTML(c.id)}" data-reserve-delete-backend="${escapeHTML(c.backendId||"")}"/></td>`;
}

function reserveBulkDeleteBarHTML(mode,count){
  if(!candidateBulkDeleteMode(mode))return "";
  return `<div class="card p-3 mb-3 flex items-center justify-between gap-3 flex-wrap" style="background:#fff7ed;border:1px solid #fed7aa">
    <div class="text-sm text-slate-700"><b>${mode==="new"?"Sélection des candidatures.":"Mode suppression activé."}</b> Cochez uniquement les candidats à supprimer.</div>
    <div class="flex gap-2 items-center flex-wrap"><label class="btn btn-ghost text-xs flex items-center gap-2"><input type="checkbox" onchange="document.querySelectorAll('[data-reserve-delete-id]').forEach(x=>x.checked=this.checked)"/> Tout sélectionner (${count||0})</label><button type="button" class="btn btn-danger text-xs" onclick="deleteSelectedReserveCandidates()">Supprimer la sélection</button></div>
  </div>`;
}

function candidateExcelTemplateColumns(){
  return ["Nom","Prénom","Date de naissance","Lieu de naissance","Nom du père","Nom de la mère","NIN","Sexe","Situation familiale","Téléphone","Email","Adresse","Commune","Wilaya","Poste souhaité","Date de recrutement","Société","Salaire prévu","Avis","Date avis","Recruteur","Commentaire","Taille (cm)","Pointure","Taille chemise","Ex-services","Précision ex-services","Sport","Sport précision","Contact urgence","Téléphone urgence","Lien urgence","Langues parlées","Service national","Enquête habilitation","Acte de naissance","Certificat résidence","Casier judiciaire","Aptitude médicale","Bulletin ANEM","Chèque barré","Pièce identité","Fiche familiale","Fiche individuelle"];
}

function candidateExcelTemplateExample(){
  return ["DUPONT","Ahmed","1995-04-12","Alger","Mohamed","Fatima","1234567890","M","Célibataire","0550000000","ahmed.dupont@example.com","Cité exemple, Alger","Bir Mourad Raïs","Alger","Agent de sécurité",today(),currentStructureSocieteFilter()||mySoc()||"IRON GLOBAL SÉCURITÉ","30000","Favorable",today(),"DRH","Exemple à remplacer ou supprimer.","178","42","L","Non","","Oui","Football","Karim DUPONT","0660000000","Frère","Arabe; Français","Oui","Non","Oui","Oui","Oui","Oui","Oui","Oui","Oui","Oui","Oui"];
}

function candidateExcelTemplateHelpRows(){
  const help=["Obligatoire. Nom de famille du candidat.","Obligatoire. Prénom du candidat.","Format conseillé : jj/mm/aaaa ou aaaa-mm-jj.","Commune ou ville de naissance.","Identité du père.","Identité de la mère.","Numéro d'identification nationale si disponible.","M ou F.","Célibataire, Marié(e), Divorcé(e), Veuf(ve).","Numéro de téléphone principal.","Adresse email.","Adresse complète.","Commune de résidence.","Wilaya de résidence.","Fonction ou poste cible.","Format conseillé : jj/mm/aaaa ou aaaa-mm-jj.","Société autorisée dans SGDI.","Montant net prévu. Exemple : 30000 ou 30 000,00.","Favorable, Défavorable, Instance.","Date de l'avis recruteur.","Nom du recruteur.","Observations libres.","Taille en centimètres.","Pointure chaussure.","XS, S, M, L, XL, XXL.","Oui ou Non.","Arme, corps ou précision utile.","Oui ou Non.","Discipline sportive.","Nom du contact d'urgence.","Téléphone du contact d'urgence.","Lien de parenté ou relation.","Exemple : Arabe; Français; Anglais.","Oui ou Non.","Oui ou Non.","Oui ou Non.","Oui ou Non.","Oui ou Non.","Oui ou Non.","Oui ou Non.","Oui ou Non.","Oui ou Non.","Oui ou Non.","Oui ou Non."];
  return candidateExcelTemplateColumns().map((h,i)=>[h,help[i]||""]);
}

async function sgdiEnsureXLSX(){if(typeof window.sgdiLoadXLSX==="function")await window.sgdiLoadXLSX();return typeof XLSX!=="undefined"}

async function downloadCandidateExcelTemplate(){
  const headers=candidateExcelTemplateColumns();
  const example=candidateExcelTemplateExample();
  const blankRows=Array.from({length:48},()=>headers.map(()=>""));
  const fileName="MODELE_IMPORT_CANDIDATS_SGDI.xlsx";
  if(await sgdiEnsureXLSX()){
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet([headers,example,...blankRows]);
    ws["!cols"]=headers.map(h=>({wch:Math.max(14,Math.min(28,String(h).length+4))}));
    ws["!autofilter"]={ref:`A1:${XLSX.utils.encode_col(headers.length-1)}${blankRows.length+2}`};
    XLSX.utils.book_append_sheet(wb,ws,"Candidats");
    const helpWs=XLSX.utils.aoa_to_sheet([["Colonne","Utilisation"],...candidateExcelTemplateHelpRows()]);
    helpWs["!cols"]=[{wch:28},{wch:80}];
    XLSX.utils.book_append_sheet(wb,helpWs,"Aide colonnes");
    XLSX.writeFile(wb,fileName);
    toast("Modèle Excel généré","success");
    return;
  }
  const csv=[headers,example,...blankRows].map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";")).join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));
  a.download="MODELE_IMPORT_CANDIDATS_SGDI.csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Modèle CSV généré","success");
}

async function openCandidateExcelImport(){
  if(!await sgdiEnsureXLSX()){toast("Lecteur Excel indisponible","error");return}
  const input=document.createElement("input");
  input.type="file";input.accept=".xlsx,.xls,.csv";
  input.onchange=()=>{const file=input.files&&input.files[0];if(file)readCandidateExcelFile(file,{free:false})};
  input.click();
}

async function openCandidateFreeExcelImport(){
  if(!await sgdiEnsureXLSX()){toast("Lecteur Excel indisponible","error");return}
  const input=document.createElement("input");
  input.type="file";input.accept=".xlsx,.xls,.csv";
  input.onchange=()=>{const file=input.files&&input.files[0];if(file)readCandidateExcelFile(file,{free:true})};
  input.click();
}

async function openCandidateExcelImportNew(){
  if(!await sgdiEnsureXLSX()){toast("Lecteur Excel indisponible","error");return}
  const input=document.createElement("input");
  input.type="file";input.accept=".xlsx,.xls,.csv";
  input.onchange=()=>{const file=input.files&&input.files[0];if(file)readCandidateExcelFile(file,{free:false,targetMode:"new"})};
  input.click();
}

async function openCandidateFreeExcelImportNew(){
  if(!await sgdiEnsureXLSX()){toast("Lecteur Excel indisponible","error");return}
  const input=document.createElement("input");
  input.type="file";input.accept=".xlsx,.xls,.csv";
  input.onchange=()=>{const file=input.files&&input.files[0];if(file)readCandidateExcelFile(file,{free:true,targetMode:"new"})};
  input.click();
}

function candidateImportExistingKeys(){
  const keys=new Set();
  (db.candidats||[]).forEach(c=>{const k=candidateDedupeKey(c)||candidateImportFallbackKey(c);if(k)keys.add(k)});
  (db.agents||[]).forEach(a=>{const k=candidateDedupeKey(a)||candidateImportFallbackKey(a);if(k)keys.add(k)});
  return keys;
}

function candidateImportFallbackKey(c){
  const norm=v=>String(v||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ");
  const name=norm(c.nom||c.last_name)+"|"+norm(c.prenom||c.first_name);
  if(name==="|")return "";
  const birth=norm(c.dateNaissance||c.birth_date);
  const phone=norm(c.telephone||c.phone);
  if(birth)return "name-birth|"+norm(c.societe||c.society)+"|"+name+"|"+birth;
  if(phone)return "name-phone|"+norm(c.societe||c.society)+"|"+name+"|"+phone;
  return "";
}

function candidateImportKeyLabel(key){
  key=String(key||"");
  if(key.startsWith("nin|"))return "même NIN";
  if(key.startsWith("birth-phone|"))return "même naissance + téléphone";
  if(key.startsWith("identity|"))return "même identité complète";
  if(key.startsWith("name-birth|"))return "même nom/prénom + date de naissance";
  if(key.startsWith("name-phone|"))return "même nom/prénom + téléphone";
  return "identité similaire";
}

function candidateExcelTemplateValueWarnings(c){
  const warnings=[];
  const norm=v=>String(v||"").trim().toLowerCase();
  if(norm(c.nom)==="dupont"&&norm(c.prenom)==="ahmed")warnings.push("Ligne exemple importée si non supprimée");
  return warnings;
}

function candidateHasAgeAlert(c){
  return !!(c&&(c.ageAlert||c.importAgeWarning||candidateAgeWarning(c)));
}

function candidateHasNinAlert(c){
  return !!(c&&(c.ninAlert||c.importNinWarning||candidateNinWarning(c)));
}

function candidateImportLabel(item){
  const c=item&&item.c?item.c:item;
  const name=String(((c&&c.nom)||"")+" "+((c&&c.prenom)||"")).trim()||"Candidat sans nom";
  return `${item&&item.row?`Ligne ${item.row} - `:""}${name}`;
}

async function readCandidateExcelFile(file,options){
  if(!await sgdiEnsureXLSX()){toast("Lecteur Excel indisponible","error");return}
  const opt=options||{};
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(new Uint8Array(e.target.result),{type:"array",cellDates:false});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:"",raw:true}).filter(candidateExcelRowHasData);
      if(!rows.length){toast("Fichier Excel vide","error");return}
      previewCandidateExcelImport(rows,file.name,opt);
    }catch(err){console.error(err);toast("Import Excel impossible: "+err.message,"error")}
  };
  reader.readAsArrayBuffer(file);
}

function previewCandidateExcelImport(rows,fileName,options){
  const opt=options||{};
  const existing=candidateImportExistingKeys();
  const seen=new Set();
  const mapped=rows.map((row,i)=>{
    const c=candidateExcelMapRow(row,i,opt.targetMode||"reserve",opt);
    markCandidateNinWarning(c,i+2);
    markCandidateAgeWarning(c,i+2);
    const errors=candidateIdentityMissing(c);
    const warnings=candidateExcelTemplateValueWarnings(c);
    if(candidateHasNinAlert(c))warnings.push("Alerte NIN : format non conforme");
    if(candidateHasAgeAlert(c))warnings.push("Alerte âge : moins de 20 ans");
    const key=candidateDedupeKey(c)||candidateImportFallbackKey(c);
    const duplicate=!!key&&(existing.has(key)||seen.has(key));
    const duplicateReason=duplicate?`${existing.has(key)?"Déjà existant en base":"Répété dans le fichier"} (${candidateImportKeyLabel(key)})`:"";
    if(duplicate)warnings.push(duplicateReason);
    if(key)seen.add(key);
    return {row:i+2,c,key,errors,warnings,duplicate,duplicateReason};
  });
  window._candidateExcelImport={rows,mapped,fileName};
  const valid=mapped.filter(x=>!x.errors.length).length;
  const warningCount=mapped.filter(x=>x.warnings.length).length;
  const ninAlerts=mapped.filter(x=>candidateHasNinAlert(x.c)).length;
  const ageAlerts=mapped.filter(x=>candidateHasAgeAlert(x.c)).length;
  const err=mapped.filter(x=>x.errors.length).length;
  const sample=mapped.slice(0,25).map(x=>`<tr><td class="font-mono text-xs">${x.row}</td><td class="font-semibold">${escapeHTML((x.c.nom||"")+" "+(x.c.prenom||""))}</td><td>${safe(x.c.dateNaissance)}</td><td>${safe(candidatePosteLabel(x.c))}</td><td>${safe(x.c.societe)}</td><td>${x.errors.length?`<span class="pill pill-red">${escapeHTML(x.errors.join(", "))}</span>`:x.warnings.length?`<span class="pill pill-amber">${escapeHTML(x.warnings.join(" · "))}</span>`:`<span class="pill pill-green">Prêt backend</span>`}</td></tr>`).join("");
  openModal(`<h3 class="font-bold text-lg mb-1">${opt.free?"Import Excel libre":"Import Excel candidats"}</h3><p class="text-sm text-slate-500 mb-4">${escapeHTML(fileName||"Fichier Excel")} · ${rows.length} ligne(s)${opt.free?" · format non conforme accepté":""}</p>
    <div class="grid grid-4 gap-3 mb-4">
      <div class="card p-3"><div class="text-xs uppercase text-slate-500 font-bold">Prêts</div><div class="text-2xl font-black text-emerald-600">${valid}</div></div>
      <div class="card p-3"><div class="text-xs uppercase text-slate-500 font-bold">Avertissements</div><div class="text-2xl font-black text-amber-600">${warningCount}</div></div>
      <div class="card p-3"><div class="text-xs uppercase text-slate-500 font-bold">Alertes NIN</div><div class="text-2xl font-black text-red-600">${ninAlerts}</div></div>
      <div class="card p-3"><div class="text-xs uppercase text-slate-500 font-bold">Alertes âge</div><div class="text-2xl font-black text-red-600">${ageAlerts}</div></div>
      ${err?`<div class="card p-3"><div class="text-xs uppercase text-slate-500 font-bold">Erreurs</div><div class="text-2xl font-black text-red-600">${err}</div></div>`:""}
    </div>
    <div class="card overflow-hidden mb-4" style="max-height:50vh;overflow:auto"><table><thead><tr><th>Ligne</th><th>Candidat</th><th>Naissance</th><th>Poste</th><th>Société</th><th>Statut</th></tr></thead><tbody>${sample||`<tr><td colspan="6" class="text-center p-4 text-slate-500">Aucune ligne lisible.</td></tr>`}</tbody></table></div>
    <div class="text-xs text-slate-500 mb-4">${opt.free?"Mode libre : SGDI tente de séparer automatiquement nom/prénom, date/lieu de naissance et adresse/commune/wilaya. Les champs vides sont acceptés. ":""}Les doublons sont affichés en avertissement mais seront copiés dans le système. Seules les lignes sans nom/prénom sont refusées.</div>
    <div class="flex justify-end gap-2 flex-wrap"><button class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary" ${valid?"":"disabled"} onclick="confirmCandidateExcelImport(this)">Enregistrer dans le backend</button></div>`);
}

async function confirmCandidateExcelImport(btn){
  const batch=window._candidateExcelImport;
  if(!batch||!Array.isArray(batch.mapped)){toast("Aucun import en attente","error");return}
  const rowsToImport=batch.mapped.filter(x=>!x.errors.length);
  rowsToImport.forEach(x=>{markCandidateNinWarning(x.c,x.row);markCandidateAgeWarning(x.c,x.row)});
  const invalidNin=rowsToImport.filter(x=>candidateHasNinAlert(x.c));
  const underAge=rowsToImport.filter(x=>candidateHasAgeAlert(x.c));
  const items=rowsToImport.map(x=>({...x.c,importRow:x.row,importAllowDuplicate:!!x.duplicate,importDuplicateReason:x.duplicateReason||"",importNinWarning:candidateHasNinAlert(x.c),importAgeWarning:candidateHasAgeAlert(x.c)}));
  if(!items.length){toast("Aucune ligne valide à importer","error");return}
  if(btn)btn.disabled=true;
  closeModal();
  sgdiShowImportProgress(0,items.length,"Import candidats en cours…");
  sgdiRequireServerWrite();
  if(!Array.isArray(db.candidats))db.candidats=[];
  let ok=0;
  const importErrors=[];
  const BATCH=10;
  try{
    for(let i=0;i<items.length;i+=BATCH){
      sgdiShowImportProgress(i,items.length,"Import candidats en cours…");
      const batch=items.slice(i,i+BATCH);
      const results=await Promise.allSettled(batch.map(c=>persistCandidateToPostgres(c,{allowCreate:true})));
      results.forEach((r,idx)=>{
        const c=batch[idx];
        if(r.status==="fulfilled"){
          if(!db.candidats.some(x=>String(x.id)===String(c.id)||String(x.backendId||"")===String(c.backendId||"")))db.candidats.push(c);
          ok++;
        }else{
          importErrors.push(`Ligne ${c.importRow||"?"} ${candidateImportLabel(c)} : ${r.reason?.message||r.reason}`);
        }
      });
    }
    sgdiShowImportProgress(items.length,items.length,"Import candidats en cours…");
    await sgdiPullState({silent:true,render:false,force:true,light:true});
    const resultLabel=`${ok} CANDIDAT(S) IMPORTÉ(S)${importErrors.length?` · ${importErrors.length} ÉCHEC(S)`:""}${invalidNin.length?` · ${invalidNin.length} ALERTE(S) NIN`:""}${underAge.length?` · ${underAge.length} ALERTE(S) AGE`:""}`;
    sgdiShowImportResult(ok,importErrors.length,importErrors,resultLabel);
    navigate("reserve");
  }catch(e){
    sgdiRemoveImportOverlay();
    if(btn)btn.disabled=false;
    toast("Import backend refusé : "+(e.message||e),"error");
  }
}

function recrutementModeToApi(mode){return mode==="archive"?"archive":mode==="reserve"?"reserve":"new"}

function recrutementPageStorageKey(mode){return "recrutementPage:"+recrutementModeToApi(mode)+":"+((isDrhModuleContext()?drhActiveSocieteFilter():currentStructureSocieteFilter())||mySoc()||sessionStorage.getItem("dashSociete")||"")}

function recrutementCurrentPage(mode){return Math.max(parseInt(sessionStorage.getItem(recrutementPageStorageKey(mode))||"1",10)||1,1)}

function setRecrutementPage(mode,page){sessionStorage.setItem(recrutementPageStorageKey(mode),String(Math.max(parseInt(page||1,10)||1,1)));renderView()}

function upsertServerCandidate(row){
  const c=candidateFromApi(row);
  if(!db)db={};
  if(!Array.isArray(db.candidats))db.candidats=[];
  const existing=db.candidats.find(x=>String(x.backendId||"")===String(c.backendId)||String(x.id||"")===String(c.id));
  if(existing)Object.assign(existing,c);else db.candidats.push(c);
  stashCandidatForRoute(existing||c,[c.id,c.backendId]);
  return existing||c;
}

function candidateAvisClass(value){
  const v=candidateAvisValue(value);
  if(v==="Favorable")return "avis-favorable";
  if(v==="Défavorable")return "avis-defavorable";
  return "avis-instance";
}

function candidateAvisSelectHTML(c){
  const current=candidateAvisValue(c&&c.avisDecision);
  const options=["Favorable","Défavorable","Instance"];
  return `<select class="candidate-avis-select ${candidateAvisClass(current)}" title="Modifier l\x27avis" onclick="event.stopPropagation()" onchange="updateCandidateAvis(\x27${jsString(c.id)}\x27,this.value,this)">${options.map(v=>`<option value="${escapeHTML(v)}" ${current===v?"selected":""}>${escapeHTML(v)}</option>`).join("")}</select>`;
}

async function ensureCandidatePositionInCatalog(candidate){
  const name=candidatePosteCleanValue(candidate?.posteSouhaite||candidate?.poste||"");
  if(!name)return;
  const same=value=>String(value||"").localeCompare(name,"fr",{sensitivity:"base"})===0;
  if(POSTES.some(same))return;
  const society=String(candidate?.societe||currentStructureSocieteFilter()||"").trim();
  try{
    const query=society?`?society=${encodeURIComponent(society)}`:"";
    const positions=await sgdiApi(`/api/irongs/positions${query}`,{method:"GET",legacy:false});
    if(Array.isArray(positions)){
      POSTES=[...new Set([...POSTES,...positions.map(p=>p.name||p).filter(Boolean)])];
      if(POSTES.some(same))return;
    }
    const created=await sgdiApi("/api/irongs/positions",{method:"POST",body:{name,society:society||null},legacy:false});
    POSTES=[...new Set([...POSTES,created?.name||name])];
    toast(`Nouveau poste « ${name} » ajouté au catalogue`,"success");
  }catch(error){
    if(/déjà existant|deja existant|\b409\b/i.test(String(error?.message||error))){POSTES=[...new Set([...POSTES,name])];return}
    throw new Error("Création du poste impossible : "+(error?.message||error));
  }
}







function candidateAgeAlertBadgeHTML(c){
  if(!candidateHasAgeAlert(c))return "";
  const age=c.ageAlertAge||candidatAgeAtSave(c.dateNaissance);
  return `<span class="pill pill-red" title="Candidat importé avec moins de 20 ans">Alerte âge${age!==null?` · ${age} ans`:""}</span>`;
}

function candidateNinAlertBadgeHTML(c){
  if(!candidateHasNinAlert(c))return "";
  return `<span class="pill pill-red" title="Candidat importé avec NIN non conforme">Alerte NIN</span>`;
}

async function updateCandidateAvis(id,value,el){
  const c=findCandidatById(id);
  if(!c){toast("Candidat introuvable","error");return}
  const before=c.avisDecision||"";
  const next=candidateAvisValue(value);
  c.avisDecision=next;
  c.avisDate=c.avisDate||today();
  if(el){el.className=`candidate-avis-select ${candidateAvisClass(next)}`;el.value=next}
  if(next!==candidateAvisValue(before)){
    sgdiRefreshCountersNow({reason:"candidate_avis_local"});
    renderView();
  }
  try{
    await persistCandidateToPostgres(c,{allowCreate:false});
    if(!(await saveDBAndWaitToast("Avis candidat non confirmé")))throw new Error("Sauvegarde non confirmée");
    sgdiFormHasUnsavedChanges=false;
    document.getElementById("view")?.querySelectorAll("[data-dirty='1']").forEach(node=>delete node.dataset.dirty);
    sgdiUpdateSaveButton("clean");
    sgdiRefreshCountersNow({reason:"candidate_avis_saved"});
    toast("Avis mis à jour","success");
    renderView();
  }catch(e){
    c.avisDecision=before;
    if(el){const old=candidateAvisValue(before);el.className=`candidate-avis-select ${candidateAvisClass(old)}`;el.value=old}
    sgdiRefreshCountersNow({reason:"candidate_avis_rollback"});
    renderView();
    toast("Mise à jour avis refusée : "+(e.message||e),"error");
  }
}

function candidateListRowHTML(c,mode){
  const route=mode==="archive"?"candidats_archives":mode==="reserve"?"reserve":"recrutement";
  const archived=mode==="archive";
  const bulk=candidateBulkDeleteMode(mode);
  const rowClick=mode==="reserve"&&!bulk?` onclick="navigate('reserve/${jsString(c.id)}')" class="cursor-pointer hover:bg-slate-50"`:"";
  return `<tr data-searchable data-candidate-id="${escapeHTML(c.id)}" data-backend-id="${escapeHTML(c.backendId||"")}"${rowClick}>
    ${reserveBulkSelectionCellHTML(c,mode)}
    <td><div class="flex items-center gap-2"><div class="avatar">${c.photo?`<img src="${c.photo}"/>`:escapeHTML((c.prenom||"?").slice(0,1))}</div><div><div class="font-semibold">${escapeHTML((c.nom||"")+" "+(c.prenom||""))}</div><div class="text-xs text-slate-500">${escapeHTML(c.email||"")}</div>${candidateNinAlertBadgeHTML(c)}${candidateAgeAlertBadgeHTML(c)}</div></div></td>
    <td>${safe(candidatePosteLabel(c))}</td>
    <td><span class="pill pill-indigo">${safe(c.societe)}</span></td>
    ${archived?`<td><span class="pill pill-blue">${escapeHTML(candidatArchiveSourceLabel(c))}</span></td><td><span class="pill pill-gray">${safe(c.wilaya||"—")}</span></td>`:""}
    <td>${safe(formatPhoneSGDI(c.telephone))}</td>
    <td>${candidateAvisSelectHTML(c)}</td>
    <td class="text-xs">${archived?`${formatDate(c.archivedAt||c.updatedAt||c.createdAt)}<div class="text-[11px] text-slate-500">${escapeHTML(c.motifArchive||"—")}</div>`:formatDate(c.createdAt)}</td>
    <td>${archived?'<span class="pill pill-gray">Archivé</span>':String(c.statut||c.status||"").toLowerCase()==="a_contractualiser"?'<span class="pill pill-amber">Contrat à établir</span>':candidatIsReserve(c)?'<span class="pill pill-amber">Réserve</span>':'<span class="pill pill-blue">Nouvelle</span>'}</td>
    <td class="text-right">${mode==="reserve"?`<button type="button" class="btn btn-ghost text-lg leading-none px-3" title="Actions" onclick="event.stopPropagation();openReserveCandidateActions('${jsString(c.id)}')">⋯</button>`:`<div class="flex items-center justify-end gap-1"><a class="btn btn-ghost text-xs" href="#/${route}/${escapeHTML(c.id)}">Ouvrir →</a>${mode==="new"?`<button type="button" class="btn btn-danger text-xs" onclick="deleteCandidat('${jsString(c.id)}')" title="Supprimer ce candidat">Supprimer</button>`:""}</div>`}</td>
  </tr>`;
}

function recruitmentContractStyleTableHTML(candidates,pagination=""){
  const rows=Array.isArray(candidates)?candidates:[];
  return `<div class="card overflow-hidden"><table class="table"><thead><tr><th>Candidat</th><th>Poste</th><th>Société</th><th>Téléphone</th><th>Transmission</th><th>Action</th></tr></thead><tbody>${rows.length?rows.map(c=>{
    const transmitted=String(c.statut||c.status||"").toLowerCase()==="a_contractualiser";
    const primaryAction=transmitted
      ?`<button class="btn btn-primary" onclick="recruitCandidateToContracts('${jsString(c.id)}',this)">Recruter</button>`
      :`<button class="btn btn-primary" onclick="navigate('recrutement/${jsString(c.id)}')">Ouvrir la fiche</button>`;
    return `<tr data-recruitment-candidate-row="${escapeHTML(c.id)}"><td><b>${escapeHTML(((c.nom||"")+" "+(c.prenom||"")).trim()||"Identité à compléter")}</b></td><td>${escapeHTML(candidatePosteLabel(c)||"À compléter")}</td><td>${escapeHTML(c.societe||"À compléter")}</td><td>${escapeHTML(formatPhoneSGDI(c.telephone)||"—")}</td><td>${transmitted?escapeHTML(formatDate(c.contractualisationAt||c.updatedAt||c.createdAt||today())):'<span class="text-slate-400">Non transmise</span>'}</td><td><div class="flex gap-2 flex-wrap">${primaryAction}<button class="btn btn-secondary" onclick="${transmitted?`openArchiveContractCandidateModal('${jsString(c.id)}')`:`openArchiveCandidatModal('${jsString(c.id)}')`}">Archiver</button></div></td></tr>`
  }).join(""):`<tr><td colspan="6" class="p-10 text-center text-slate-400">Aucun candidat.</td></tr>`}</tbody></table>${pagination}</div>`;
}

async function recruitCandidateToContracts(id,button){
  const c=findCandidatById(id);if(!c){toast("Candidat introuvable","error");return}
  if(candidateAvisValue(c.avisDecision)!=="Favorable"){toast("Décision favorable obligatoire pour recruter ce candidat","error");return}
  const original=button?.textContent||"Recruter";if(button){button.disabled=true;button.textContent="Transfert..."}
  try{
    let saved=c;const backendId=sqlBackendId(c.backendId);if(!backendId)throw new Error("Candidature non enregistrée dans PostgreSQL");
    if(String(c.statut||c.status||"").toLowerCase()!=="a_contractualiser")saved=candidateFromApi(await SGDI.rh.marquerContractualisation(backendId));
    const draft={...c,...saved,statut:"a_contractualiser",status:"a_contractualiser",removedFromRecruitmentAt:new Date().toISOString(),removedFromRecruitmentBy:session?.username||"system"};
    await persistCandidateToPostgres(draft,{allowCreate:false});Object.assign(c,draft);
    const row=document.querySelector(`[data-recruitment-candidate-row="${CSS.escape(String(id))}"]`);
    if(row){row.style.transition="opacity .18s ease,transform .18s ease";row.style.opacity="0";row.style.transform="translateX(12px)";setTimeout(()=>{row.remove();const body=document.querySelector("[data-recruitment-view] tbody");if(body&&!body.querySelector("tr"))body.innerHTML='<tr><td colspan="6" class="p-10 text-center text-slate-400">Aucun candidat.</td></tr>';},190)}
    const activeSociety=drhActiveSocieteFilter()||currentStructureSocieteFilter()||mySoc()||"";
    const newCount=(db.candidats||[]).filter(candidatIsNew).filter(item=>!activeSociety||item.societe===activeSociety).length;
    const activeTab=document.querySelector(".recruitment-candidates-tabs button.active span");if(activeTab)activeTab.textContent=String(newCount);
    const paginationLabel=document.querySelector("[data-recruitment-view] .card.overflow-hidden > .border-t > div:first-child");if(paginationLabel)paginationLabel.textContent=`${newCount} candidat(s) · page 1/1`;
    sgdiFormHasUnsavedChanges=false;sgdiDirty=false;sgdiUpdateSaveButton("clean");
    toast("Candidat recruté et envoyé dans Contrats à établir","success");
    sgdiRefreshCountersNow({reason:"candidate_recruited_to_contracts"});
  }catch(error){if(button){button.disabled=false;button.textContent=original}toast("Recrutement refusé : "+(error.message||error),"error")}
}

function reserveFunctionPanelOpen(){return sessionStorage.getItem("reserveFunctionPanel")==="1"}

function toggleReserveFunctionPanel(){sessionStorage.setItem("reserveFunctionPanel",reserveFunctionPanelOpen()?"0":"1");renderView()}

function reserveFunctionStatsHTML(items,compact){
  const list=Object.entries((items||[]).reduce((acc,c)=>{const k=candidatePosteLabel(c);acc[k]=(acc[k]||0)+1;return acc},{})).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  if(!reserveFunctionPanelOpen())return"";
  return `<div class="card p-4 mb-4" id="reserve-function-panel"><div class="flex items-center justify-between gap-3 mb-3"><h3 class="font-black text-sm">Candidats en réserve par fonction</h3><button type="button" class="btn btn-ghost text-xs" onclick="toggleReserveFunctionPanel()">Fermer</button></div>${list.length?`<div class="grid grid-cols-1 md:grid-cols-2 gap-2">${list.map(([label,n])=>`<div class="p-3 rounded-lg" style="border:1px solid #dbe3ef;background:#fff"><div class="flex justify-between gap-2"><span class="font-bold text-sm">${escapeHTML(label)}</span><span class="pill pill-blue">${n}</span></div><div class="h-2 bg-slate-100 rounded-full mt-2"><div class="h-full rounded-full" style="width:${Math.round(n/Math.max(1,(items||[]).length)*100)}%;background:#043970"></div></div></div>`).join("")}</div>`:`<div class="text-sm text-slate-500">Aucune fonction à afficher.</div>`}${compact?`<div class="text-xs text-slate-500 mt-3">Synthèse calculée sur la page affichée.</div>`:""}</div>`;
}

function candidateCanGoToContract(c){
  return !!(c&&(c.statut==="a_contractualiser"||candidatIsReserve(c))&&candidateAvisValue(c.avisDecision)==="Favorable");
}

function candidateSignatureInstanceCount(socFilter){
  return (db.candidats||[]).filter(c=>candidateCanGoToContract(c)&&(!socFilter||c.societe===socFilter)).length;
}

function candidateSignatureInstanceCounterHTML(socFilter){
  const count=candidateSignatureInstanceCount(socFilter);
  return `<button type="button" class="card p-4 text-left kpi-clickable recruitment-stable-kpi" onclick="navigate('contrats/a_contractualiser')"><div class="text-xs text-slate-500 uppercase">Contrats à établir</div><div class="text-3xl font-bold mt-1">${count}</div><div class="text-xs text-slate-400">Dossiers transmis par Recrutement</div></button>`;
}

function recrutementUnifiedTabsHTML(mode,socFilter){
  const rows=(db.candidats||[]).filter(c=>!socFilter||c.societe===socFilter);
  const countNew=rows.filter(candidatIsNew).length;
  const countReserve=rows.filter(c=>candidatIsActive(c)&&candidatIsReserve(c)).length;
  const countArchive=rows.filter(c=>candidatIsArchived(c)).length;
  const tabs=[
    ["new","Nouveaux dossiers","recrutement/candidats",countNew],
    ["reserve","Réserve","reserve",countReserve],
    ["archive","Archives","candidats_archives",countArchive],
    ["stats","Statistiques","recrutement/statistiques",rows.length]
  ];
  return `<nav class="mat-erp-tabs recruitment-candidates-tabs mb-4" aria-label="Recrutement et candidats">${tabs.map(([key,label,route,count])=>`<button type="button" onclick="navigate('${route}')" class="${mode===key?"active":""}">${escapeHTML(label)}<span>${count}</span></button>`).join("")}</nav>`;
}

function recrutementModeMatchesCurrentRoute(mode){
  const [root,sub]=(location.hash||"#/dashboard").slice(2).split("/");
  if(mode==="new")return root==="recrutement"&&(!sub||sub==="liste"||sub==="candidats");
  if(mode==="reserve")return root==="reserve"&&!sub;
  if(mode==="archive")return root==="candidats_archives"&&!sub;
  return false;
}

function candidateStatsValue(c,key){
  const age=candidatAgeAtSave(c.dateNaissance);
  const firstExperience=Array.isArray(c.experience)&&c.experience.length?c.experience[0]:null;
  const values={
    age:age===null?"Non renseigné":age<25?"20–24 ans":age<35?"25–34 ans":age<45?"35–44 ans":age<55?"45–54 ans":"55 ans et plus",
    sexe:c.sexe||"Non renseigné",adresse:c.adresse||"Non renseignée",commune:c.commune||"Non renseignée",wilaya:c.wilaya||"Non renseignée",
    nom:c.nom||"Non renseigné",prenom:c.prenom||"Non renseigné",dateNaissance:c.dateNaissance||"Non renseignée",lieuNaissance:c.lieuNaissance||"Non renseigné",
    formation:c.formation||c.diplome||c.niveauEtude||"Non renseignée",
    experience:firstExperience?(firstExperience.poste||firstExperience.fonction||firstExperience.entreprise||"Expérience renseignée"):(c.experienceProfessionnelle||c.exServicesPrecision||"Aucune expérience renseignée"),
    poste:candidatePosteLabel(c),statut:candidatIsArchived(c)?"Annulée / archivée":candidatIsRecruited(c)?"Recrutée":candidatIsReserve(c)?"Validée":"Nouvelle"
  };
  return String(values[key]??"Non renseigné").trim()||"Non renseigné";
}

function renderRecruitmentStatistics(view){
  const soc=(isDrhModuleContext()?drhActiveSocieteFilter():currentStructureSocieteFilter())||mySoc()||"";
  const rows=(db.candidats||[]).filter(c=>!soc||c.societe===soc);
  const fields=[["age","Âge"],["sexe","Sexe"],["wilaya","Wilaya"],["commune","Commune"],["adresse","Adresse"],["nom","Nom"],["prenom","Prénom"],["dateNaissance","Date de naissance"],["lieuNaissance","Lieu de naissance"],["formation","Formation"],["experience","Expérience professionnelle"],["poste","Poste recherché"],["statut","Statut"]];
  const selected=fields.some(([key])=>key===sessionStorage.getItem("recruitStatsField"))?sessionStorage.getItem("recruitStatsField"):"age";
  const counts={};rows.forEach(c=>{const value=candidateStatsValue(c,selected);counts[value]=(counts[value]||0)+1});
  const grouped=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,100);
  const max=Math.max(1,...grouped.map(([,count])=>count));
  const accepted=rows.filter(c=>candidateAvisValue(c.avisDecision)==="Favorable"&&!candidatIsArchived(c)).length;
  const cancelled=rows.filter(candidatIsArchived).length;
  const interviewed=rows.filter(c=>Array.isArray(c.entretiens)&&c.entretiens.length).length;
  const selectedLabel=fields.find(([key])=>key===selected)?.[1]||selected;
  const kpis=[
    ["Candidatures",rows.length,"Tous les dossiers","total"],
    ["Validées",accepted,`${Math.round(accepted*100/Math.max(rows.length,1))}% du total`,"valid"],
    ["Entretiens",interviewed,"Réalisés ou planifiés","interview"],
    ["Annulées",cancelled,`${Math.round(cancelled*100/Math.max(rows.length,1))}% du total`,"cancelled"]
  ];
  view.innerHTML=`<div data-recruitment-view="1" class="recruitment-stats-page">
    <section class="recruitment-stats-hero">
      <div class="recruitment-stats-heading"><div><span class="recruitment-stats-eyebrow">Pilotage des candidatures</span><h1>Statistiques recrutement</h1><p>Analyse multicritère${soc?` pour <strong>${escapeHTML(soc)}</strong>`:" de toutes les candidatures"}.</p></div><button class="btn btn-primary recruitment-stats-add" onclick="openAddCandidateForm()">+ Nouveau candidat</button></div>
      ${recrutementUnifiedTabsHTML("stats",soc)}
    </section>
    <section class="recruitment-stats-kpis">${kpis.map(([label,value,note,tone])=>`<article class="recruitment-stat-kpi recruitment-stat-kpi--${tone}"><div class="recruitment-stat-kpi-top"><span>${escapeHTML(label)}</span><i aria-hidden="true"></i></div><strong>${value}</strong><small>${escapeHTML(note)}</small></article>`).join("")}</section>
    <section class="recruitment-stats-analysis">
      <aside class="recruitment-stats-filter"><span class="recruitment-stats-eyebrow">Analyse détaillée</span><h2>Choisir un critère</h2><p>Affichez la répartition des candidats selon la catégorie souhaitée.</p><label for="recruit-stats-field">Catégorie statistique</label><select id="recruit-stats-field" class="select" onchange="sessionStorage.setItem('recruitStatsField',this.value);renderView()">${fields.map(([key,label])=>`<option value="${key}" ${selected===key?"selected":""}>${escapeHTML(label)}</option>`).join("")}</select><div class="recruitment-stats-summary"><span>Catégories trouvées</span><b>${grouped.length}</b></div></aside>
      <div class="recruitment-stats-chart"><div class="recruitment-stats-chart-head"><div><span class="recruitment-stats-eyebrow">Répartition</span><h2>Par ${escapeHTML(selectedLabel)}</h2></div><span class="recruitment-stats-total">${rows.length} candidat${rows.length>1?"s":""}</span></div><div class="recruitment-stats-bars">${grouped.length?grouped.map(([label,count])=>`<div class="recruitment-stats-bar"><div class="recruitment-stats-bar-label"><span title="${escapeHTML(label)}">${escapeHTML(label)}</span><b>${count} <em>${Math.round(count*100/Math.max(rows.length,1))}%</em></b></div><div class="recruitment-stats-track"><i style="width:${Math.round(count*100/max)}%"></i></div></div>`).join(""):`<div class="recruitment-stats-empty">Aucune candidature à analyser.</div>`}</div></div>
    </section>
  </div>`;
}

function scrollToRecruitmentList(){
  const view=document.getElementById("view");
  if(!view)return;
  const card=view.querySelector(".card.overflow-hidden table")?.closest(".card")||view.querySelector(".recrutement-list-card");
  if(card){card.scrollIntoView({behavior:"smooth",block:"start"});return}
  view.scrollTo({top:350,behavior:"smooth"});
}

function recrutementStatsCardsHTML(mode,socFilter,items,total,pageCount,loading){
  const list=Array.isArray(items)?items:[];
  const totalCount=Number(total??list.length)||0;
  const shown=Number(pageCount??list.length)||0;
  const totalLabel=mode==="reserve"?"Total réserve":mode==="archive"?"Total archivés":"Total candidats";
  const fonctionCount=mode==="reserve"?new Set(list.map(c=>candidatePosteLabel(c))).size:0;
  const functionCounter=mode==="reserve"?`<button type="button" class="card p-4 text-left kpi-clickable recruitment-stable-kpi" onclick="toggleReserveFunctionPanel()"><div class="text-xs text-slate-500 uppercase">Par fonction</div><div class="text-3xl font-bold mt-1">${fonctionCount}</div><div class="text-xs text-slate-400">Cliquer pour détail</div></button>`:"";
  const ageAlertCounter=mode==="reserve"?`<div class="card p-4 recruitment-stable-kpi"><div class="text-xs text-slate-500 uppercase">Alertes âge</div><div class="text-3xl font-bold mt-1 text-red-600">${list.filter(candidateHasAgeAlert).length}</div><div class="text-xs text-slate-400">Moins de 20 ans</div></div>`:"";
  const contractCounter=mode==="new"?candidateSignatureInstanceCounterHTML(socFilter):"";
  const loadingNote=loading?`<div class="text-[11px] text-slate-400 mt-1">Synchronisation...</div>`:"";
  return `<div class="grid ${mode==="reserve"?"grid-4":mode==="new"?"grid-4":"grid-3"} mb-4 recruitment-stats-grid">
    <button type="button" class="card p-4 text-left kpi-clickable recruitment-stable-kpi" onclick="scrollToRecruitmentList()"><div class="text-xs text-slate-500 uppercase">${totalLabel}</div><div class="text-3xl font-bold mt-1">${totalCount}</div><div class="text-xs text-slate-400">${loading?"Synchronisation…":"Voir la liste"}</div></button>
    ${functionCounter}${ageAlertCounter}${contractCounter}
    <div class="card p-4 recruitment-stable-kpi"><div class="text-xs text-slate-500 uppercase">Candidats affichés</div><div class="text-3xl font-bold mt-1">${shown}</div><div class="text-xs text-slate-400">${loading?"Synchronisation…":" "}</div></div>
    <div class="card p-4 recruitment-stable-kpi"><div class="text-xs text-slate-500 uppercase">Société</div><div class="text-xl font-bold mt-1" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(socFilter||"Toutes autorisées")}</div><div class="text-xs text-slate-400"> </div></div>
  </div>`;
}

async function renderDrhRecruitmentReadOnly(view,mode="new"){
  const requestSeq=++sgdiRecruitmentRequestSeq;
  const hash=location.hash;
  const generation=sgdiViewRenderGeneration;
  const current=()=>requestSeq===sgdiRecruitmentRequestSeq&&location.hash===hash&&generation===sgdiViewRenderGeneration&&isDrhModuleContext()&&view.isConnected;
  view.innerHTML='<div class="card p-6">Chargement des candidatures…</div>';
  try{
    // The same shared candidate pool as recrute.irongs.com includes applications
    // awaiting a recruitment society. Do not filter it by the current DRH society.
    // DRH keeps the full history, including dossiers already sent to contracts.
    const result=await SGDI.rh.candidatesPage({...(mode==="new"?{}:{mode:recrutementModeToApi(mode)}),page:recrutementCurrentPage(mode),page_size:25});
    if(!current())return;
    const rows=(result.items||[]).map(c=>{
      const info=[["Email",c.email],["Téléphone",c.phone],["Adresse",c.address||c.data?.adresse],["Date de naissance",c.birth_date||c.data?.dateNaissance],["Lieu de naissance",c.birth_place||c.data?.lieuNaissance],["Expérience",c.data?.experience],["Commentaire",c.data?.commentaire]];
      const details=info.filter(([,v])=>v!==null&&v!==undefined&&v!=="").map(([label,v])=>`<dt class="font-semibold">${escapeHTML(label)}</dt><dd class="mb-2">${escapeHTML(typeof v==="object"?JSON.stringify(v):String(v))}</dd>`).join("");
      return `<tr><td>${escapeHTML([c.last_name,c.first_name].filter(Boolean).join(" "))}</td><td>${escapeHTML(c.desired_position||"—")}</td><td>${escapeHTML(c.society||"Non affecté")}</td><td>${escapeHTML(c.phone||"—")}</td><td>${escapeHTML(c.status||"—")}</td><td><details><summary class="cursor-pointer">Consulter</summary><dl class="p-3">${details||"Aucune information complémentaire."}</dl></details></td></tr>`;
    }).join("");
    const page=result.page||1,pages=result.pages||1;
    view.innerHTML=`<div data-drh-recruitment-readonly="1"><h1 class="text-2xl font-bold">Candidatures — lecture seule</h1><p class="text-slate-500 mb-4">Dossiers partagés avec le module Recrutement. Leur traitement s’effectue dans recrute.irongs.com.</p><div class="card overflow-auto"><table><thead><tr><th>Candidat</th><th>Poste</th><th>Société</th><th>Téléphone</th><th>Statut</th><th>Dossier</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Aucune candidature.</td></tr>'}</tbody></table><div class="p-3 flex justify-between"><span>${result.total||0} candidature(s) · page ${page}/${pages}</span><div><button class="btn btn-ghost" ${page<=1?"disabled":""} onclick="setRecrutementPage('${mode}',${page-1})">Précédent</button><button class="btn btn-ghost" ${page>=pages?"disabled":""} onclick="setRecrutementPage('${mode}',${page+1})">Suivant</button></div></div></div></div>`;
  }catch(error){
    if(current())view.innerHTML=`<div class="card p-6" role="alert">Chargement impossible : ${escapeHTML(error.message||String(error))}<button class="btn btn-ghost" onclick="renderView()">Réessayer</button></div>`;
  }
}

async function renderRecrutementServer(view,mode){
  const requestSeq=++sgdiRecruitmentRequestSeq;
  const title=mode==="archive"?"Candidats archivés":mode==="reserve"?"Candidats en réserve":"Nouvelles candidatures";
  const st=mode==="archive"?"Dossiers archivés depuis les nouvelles candidatures et les candidats en réserve.":mode==="reserve"?"Candidats validés, en attente de recrutement.":"Candidats à présélectionner pour la fiche de renseignement.";
  const socFilter=(isDrhModuleContext()?drhActiveSocieteFilter():currentStructureSocieteFilter())||mySoc()||sessionStorage.getItem("dashSociete")||"";
  const page=recrutementCurrentPage(mode);
  const pageSize=mode==="new"?500:mode==="reserve"?15:25;
  const addButton=mode==="reserve"?candidatImportActionsHTML("reserve"):(mode==="new"?candidatImportActionsHTML("new"):"");
  try{
    const result=await SGDI.rh.candidatesPage({mode:recrutementModeToApi(mode),society:socFilter,page,page_size:pageSize});
    if(requestSeq!==sgdiRecruitmentRequestSeq||!recrutementModeMatchesCurrentRoute(mode))return;
    const cs=(result.items||[]).map(upsertServerCandidate);
    const pages=result.pages||1;
    const pagination=`<div class="flex items-center justify-between gap-2 p-3 border-t border-slate-100 text-sm"><div class="text-slate-500">${result.total||0} candidat(s) · page ${result.page||1}/${pages}</div><div class="flex gap-2"><button class="btn btn-ghost text-xs" ${result.page<=1?"disabled":""} onclick="setRecrutementPage('${mode}',${(result.page||1)-1})">Précédent</button><button class="btn btn-ghost text-xs" ${result.page>=pages?"disabled":""} onclick="setRecrutementPage('${mode}',${(result.page||1)+1})">Suivant</button></div></div>`;
    const listHTML=mode==="new"?recruitmentContractStyleTableHTML(cs,pagination):(cs.length===0?`<div class="card p-10 text-center text-slate-500">Aucun candidat.</div>`:`<div class="card overflow-hidden"><table><thead><tr>${reserveBulkSelectionHeaderHTML(mode)}<th>Candidat</th><th>Poste</th><th>Société</th>${mode==="archive"?"<th>Origine</th><th>Wilaya</th>":""}<th>Téléphone</th><th>Avis</th><th>${mode==="archive"?"Archivage":"Date"}</th><th>Statut</th><th></th></tr></thead><tbody>${cs.map(c=>candidateListRowHTML(c,mode)).join("")}</tbody></table>${pagination}</div>`);
    view.innerHTML=`<div data-recruitment-view="1"><div class="flex items-center justify-between mb-4"><div><h1 class="text-2xl font-bold recruitment-page-title">${title}</h1><p class="text-slate-500 text-sm">${st}</p></div>${addButton}</div>
      ${recrutementUnifiedTabsHTML(mode,socFilter)}
      ${mode==="new"?"":reserveBulkDeleteBarHTML(mode,cs.length)}
      ${listHTML}</div>`;
    setTimeout(()=>applyLanguagePreference(view),0);
  }catch(e){
    if(requestSeq!==sgdiRecruitmentRequestSeq||!recrutementModeMatchesCurrentRoute(mode))return;
    console.warn("Liste candidats PostgreSQL indisponible",e);
    window.__sgdiLocalRecrutementFallback=true;
    try{renderRecrutement(view,mode)}finally{window.__sgdiLocalRecrutementFallback=false}
    toast("Lecture candidats refusée : "+(e.message||e),"error");
  }
}

function renderRecrutement(view,mode){
  if(isDrhModuleContext())return renderDrhRecruitmentReadOnly(view,mode);
  if(sgdiAuthToken()&&!window.__sgdiLocalRecrutementFallback){renderRecrutementServer(view,mode);return}
  cleanupDuplicateCandidates(true);
  const title=mode==="archive"?"Candidats archivés":mode==="reserve"?"Candidats en réserve":"Nouvelles candidatures";
  const socFilter=(isDrhModuleContext()?drhActiveSocieteFilter():currentStructureSocieteFilter())||mySoc()||sessionStorage.getItem("dashSociete")||"";
  const allowed=(isDrhModuleContext()&&!socFilter)?drhAuthorizedSocieties():[];
  let cs=db.candidats.filter(c=>mode==="archive"?candidatIsArchived(c):mode==="reserve"?(candidatIsActive(c)&&candidatIsReserve(c)):candidatIsNew(c));
  if(socFilter)cs=cs.filter(c=>c.societe===socFilter);else if(allowed.length)cs=cs.filter(c=>allowed.includes(c.societe));
  const st=mode==="archive"?"Dossiers archivés depuis les nouvelles candidatures et les candidats en réserve.":mode==="reserve"?"Candidats validés, en attente de recrutement.":"Candidats à présélectionner pour la fiche de renseignement.";
  let archiveToolsHTML="";
  let archiveEmptyHTML="";
  if(mode==="archive"){
    const allArchived=cs.slice();
    const f=archiveCandidateFilters();
    const postes=[...new Set(allArchived.map(c=>candidatePosteLabel(c)))].sort((a,b)=>a.localeCompare(b));
    const wilayas=[...new Set(allArchived.map(c=>c.wilaya||"—"))].sort((a,b)=>a.localeCompare(b));
    if(f.poste)cs=cs.filter(c=>(candidatePosteLabel(c))===f.poste);
    if(f.wilaya)cs=cs.filter(c=>(c.wilaya||"—")===f.wilaya);
    if(f.dateFrom)cs=cs.filter(c=>archivedCandidateDate(c)>=f.dateFrom);
    if(f.dateTo)cs=cs.filter(c=>archivedCandidateDate(c)<=f.dateTo);
    cs.sort((a,b)=>{
      const da=archivedCandidateDate(a),dbb=archivedCandidateDate(b);
      return f.sortDate==="asc"?da.localeCompare(dbb):dbb.localeCompare(da);
    });
    const byPoste={};allArchived.forEach(c=>{const k=candidatePosteLabel(c);byPoste[k]=(byPoste[k]||0)+1});
    const byWilaya={};allArchived.forEach(c=>{const k=c.wilaya||"—";byWilaya[k]=(byWilaya[k]||0)+1});
    archiveToolsHTML=`<div class="card p-4 mb-4">
      <div class="grid grid-6 gap-3 items-end">
        <div class="col-span-2"><label class="label">Métier</label><select class="select" onchange="setArchiveCandidateFilter('poste',this.value)"><option value="">Tous les métiers</option>${postes.map(p=>`<option value="${escapeHTML(p)}" ${f.poste===p?"selected":""}>${escapeHTML(p)} (${byPoste[p]||0})</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Adresse / Wilaya</label><select class="select" onchange="setArchiveCandidateFilter('wilaya',this.value)"><option value="">Toutes les wilayas</option>${wilayas.map(w=>`<option value="${escapeHTML(w)}" ${f.wilaya===w?"selected":""}>${escapeHTML(w)} (${byWilaya[w]||0})</option>`).join("")}</select></div>
        <div><label class="label">Du</label><input class="input" type="date" value="${escapeHTML(f.dateFrom||"")}" onchange="setArchiveCandidateFilter('dateFrom',this.value)"/></div>
        <div><label class="label">Au</label><input class="input" type="date" value="${escapeHTML(f.dateTo||"")}" onchange="setArchiveCandidateFilter('dateTo',this.value)"/></div>
        <div class="col-span-2"><label class="label">Classement par date</label><select class="select" onchange="setArchiveCandidateFilter('sortDate',this.value)"><option value="desc" ${f.sortDate!=="asc"?"selected":""}>Plus récent d'abord</option><option value="asc" ${f.sortDate==="asc"?"selected":""}>Plus ancien d'abord</option></select></div>
        <div class="col-span-4 flex items-center justify-between gap-3">
          <div class="text-sm text-slate-500"><b>${cs.length}</b> candidat(s) affiché(s) sur ${allArchived.length} archivé(s).</div>
          <button type="button" class="btn btn-ghost text-xs" onclick="resetArchiveCandidateFilters()">Réinitialiser</button>
        </div>
      </div>
    </div>`;
    if(!cs.length&&allArchived.length){
      archiveEmptyHTML=`<div class="card p-10 text-center text-slate-500">Aucun candidat ne correspond aux filtres sélectionnés.<div class="mt-3"><button type="button" class="btn btn-secondary text-xs" onclick="resetArchiveCandidateFilters()">Voir tous les candidats archivés</button></div></div>`;
    }
  }
  const addButton=mode==="reserve"?candidatImportActionsHTML("reserve"):(mode==="new"?candidatImportActionsHTML("new"):"");
  const listHTML=mode==="new"?recruitmentContractStyleTableHTML(cs):(cs.length===0?(archiveEmptyHTML||`<div class="card p-10 text-center text-slate-500">Aucun candidat.</div>`):`<div class="card overflow-hidden"><table>
      <thead><tr>${reserveBulkSelectionHeaderHTML(mode)}<th>Candidat</th><th>Poste</th><th>Société</th>${mode==="archive"?"<th>Origine</th><th>Wilaya</th>":""}<th>Téléphone</th><th>Avis</th><th>${mode==="archive"?"Archivage":"Date"}</th><th>Statut</th><th></th></tr></thead>
      <tbody>${cs.map(c=>`<tr data-searchable>
        ${reserveBulkSelectionCellHTML(c,mode)}
        <td><div class="flex items-center gap-2"><div class="avatar">${c.photo?`<img src="${c.photo}"/>`:escapeHTML((c.prenom||"?").slice(0,1))}</div><div><div class="font-semibold">${escapeHTML(c.nom+" "+c.prenom)}</div><div class="text-xs text-slate-500">${escapeHTML(c.email||"")}</div>${candidateNinAlertBadgeHTML(c)}${candidateAgeAlertBadgeHTML(c)}</div></div></td>
        <td>${safe(candidatePosteLabel(c))}</td>
        <td><span class="pill pill-indigo">${safe(c.societe)}</span></td>
        ${mode==="archive"?`<td><span class="pill pill-blue">${escapeHTML(candidatArchiveSourceLabel(c))}</span></td>`:""}
        ${mode==="archive"?`<td><span class="pill pill-gray">${safe(c.wilaya||"—")}</span></td>`:""}
        <td>${safe(formatPhoneSGDI(c.telephone))}</td>
        <td>${candidateAvisSelectHTML(c)}</td>
        <td class="text-xs">${mode==="archive"?`${formatDate(c.archivedAt||c.updatedAt||c.createdAt)}<div class="text-[11px] text-slate-500">${escapeHTML(c.motifArchive||"—")}</div>`:formatDate(c.createdAt)}</td>
        <td>${mode==="archive"?'<span class="pill pill-gray">Archivé</span>':String(c.statut||c.status||"").toLowerCase()==="a_contractualiser"?'<span class="pill pill-amber">Contrat à établir</span>':candidatIsReserve(c)?'<span class="pill pill-amber">Réserve</span>':'<span class="pill pill-blue">Nouvelle</span>'}</td>
        <td class="text-right">${mode==="reserve"?`<button type="button" class="btn btn-ghost text-lg leading-none px-3" title="Actions" onclick="openReserveCandidateActions('${jsString(c.id)}')">⋯</button>`:`<a class="btn btn-ghost text-xs" href="#/${mode==="archive"?"candidats_archives":mode==="reserve"?"reserve":"recrutement"}/${c.id}">Ouvrir →</a>`}</td>
      </tr>`).join("")}</tbody></table></div>`);
  view.innerHTML=`<div data-recruitment-view="1"><div class="flex items-center justify-between mb-4"><div><h1 class="text-2xl font-bold recruitment-page-title">${title}</h1><p class="text-slate-500 text-sm">${st}</p></div>${addButton}</div>
    ${recrutementUnifiedTabsHTML(mode,socFilter)}
    ${archiveToolsHTML}
    ${mode==="new"?"":reserveBulkDeleteBarHTML(mode,cs.length)}
    ${listHTML}</div>`;
}

async function recruterCandidat(id,btn){
  const c=findCandidatById(id);if(!c)return;
  if(candidateAvisValue(c.avisDecision)!=="Favorable"){toast("Avis favorable obligatoire pour envoyer au contrat","error");return}
  if(document.getElementById("candidat-form")&&sgdiFormHasUnsavedChanges){toast("Enregistrez les modifications de la fiche avant d'établir le contrat","error");return}
  const originalText=btn?btn.textContent:"";
  if(btn){
    btn.disabled=true;
    btn.textContent="...";
    btn.setAttribute("aria-busy","true");
  }
  toast("Préparation du contrat...","info");
  try{
    const backendId=sqlBackendId(c.backendId);
    if(!backendId)throw new Error("Candidature non enregistrée dans PostgreSQL");
    const saved=await SGDI.rh.marquerContractualisation(backendId);
    Object.assign(c,candidateFromApi(saved));
    sgdiDirty=false;
    sgdiFormHasUnsavedChanges=false;
    document.getElementById("view")?.querySelectorAll("[data-dirty='1']").forEach(node=>delete node.dataset.dirty);
    sgdiUpdateSaveButton("clean");
    toast("Candidat envoyé vers contractualisation","success");
    navigate(`contrats/nouveau/${c.id}`);
    setTimeout(()=>sgdiPullState({silent:true,render:false,force:true,light:true}).catch(e=>console.warn("Synchronisation recrutement différée indisponible",e)),250);
  }catch(e){
    if(btn){
      btn.disabled=false;
      btn.textContent=originalText||"RECRUTER";
      btn.removeAttribute("aria-busy");
    }
    toast("Action refusée : "+(e.message||e),"error");
  }
}

function afficherCandidatReserve(id){closeModal();navigate(`reserve/${id}`)}

function modifierCandidatReserve(id){sessionStorage.setItem("candidatAutoEdit:"+id,"1");closeModal();navigate(`reserve/${id}`)}

function recruitAndOpenCandidateContract(id){
  const c=findCandidatById(id);if(!c){toast("Candidat introuvable","error");return}
  closeModal();
  if(String(c.statut||c.status||"").toLowerCase()==="a_contractualiser"){
    sgdiDirty=false;sgdiFormHasUnsavedChanges=false;document.getElementById("view")?.querySelectorAll("[data-dirty='1']").forEach(node=>delete node.dataset.dirty);sgdiUpdateSaveButton("clean");
    return navigate(`contrats/a_contractualiser/${c.id}`);
  }
  recruterCandidat(id);
}

function openReserveCandidateActions(id){
  const c=findCandidatById(id);if(!c){toast("Candidat introuvable","error");return}
  const name=String((c.nom||"")+" "+(c.prenom||"")).trim()||"Candidat";
  const canContract=candidateCanGoToContract(c);
  const contractBlockedReason=candidateAvisValue(c.avisDecision)!=="Favorable"?"Décision favorable obligatoire":!c.fichePositionValidee?"Fiche candidat non validée":"Dossier non disponible pour contractualisation";
  openModal(`<h3 class="font-bold text-lg mb-1">Actions candidat</h3><p class="text-sm text-slate-500 mb-4">${escapeHTML(name)} · ${escapeHTML(c.societe||"—")}</p>
    <div class="grid grid-cols-1 gap-2">
      <button type="button" class="btn btn-secondary justify-start" onclick="afficherCandidatReserve('${jsString(id)}')">👁 Afficher</button>
      <button type="button" class="btn btn-primary justify-start" onclick="modifierCandidatReserve('${jsString(id)}')">✎ Modifier</button>
      <button type="button" class="btn btn-success justify-start" ${canContract?`onclick="recruitAndOpenCandidateContract('${jsString(id)}')"`:`disabled title="${escapeHTML(contractBlockedReason)}"`}>Recruter / Établir contrat</button>
      ${canContract?"":`<div class="text-xs text-amber-700 px-2">${escapeHTML(contractBlockedReason)}</div>`}
      <button type="button" class="btn btn-ghost justify-start text-red-600" onclick="closeModal();openArchiveCandidatModal('${jsString(id)}')">🗄 Archiver</button>
      <button type="button" class="btn btn-danger justify-start" onclick="closeModal();deleteCandidat('${jsString(id)}')">🗑 Supprimer</button>
    </div>
    <div class="flex justify-end mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function openCandidateInterviewModal(id){
  const c=findCandidatById(id);if(!c){toast("Candidat introuvable","error");return}
  openModal(`<h3 class="font-bold text-lg mb-1">Entretien candidat</h3><p class="text-sm text-slate-500 mb-4">${escapeHTML((c.nom||"")+" "+(c.prenom||""))}</p><form onsubmit="event.preventDefault();saveCandidateInterview('${jsString(id)}',this)"><div class="grid grid-2 gap-3"><div><label class="label">Date *</label><input class="input" type="date" name="date" value="${today()}" required></div><div><label class="label">Heure</label><input class="input" type="time" name="heure"></div><div><label class="label">Interviewer</label><input class="input" name="interviewer" value="${escapeHTML(session?.nom||session?.username||"")}"></div><div><label class="label">Résultat</label><select class="select" name="resultat"><option>Planifié</option><option>Favorable</option><option>Défavorable</option><option>À revoir</option></select></div><div class="col-span-2"><label class="label">Compte rendu</label><textarea class="textarea" name="compteRendu" rows="4"></textarea></div></div><div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer l'entretien</button></div></form>`);
}

async function validateCandidateApplication(id){
  const c=findCandidatById(id);if(!c)return;
  const draft={...c,statut:"reserve",avisDecision:"Favorable",avisDate:today(),fichePositionValidee:true,validatedAt:new Date().toISOString(),validatedBy:session?.username||""};
  delete draft.motifArchive;delete draft.commentaireArchive;delete draft.archivedAt;delete draft.archivedBy;delete draft.archiveSource;delete draft.isNew;
  try{await persistCandidateToPostgres(draft);Object.assign(c,draft);await sgdiPullState({silent:true,render:false,force:true,light:true});toast("Candidature validée et placée en réserve","success");navigate("reserve")}catch(e){toast("Validation refusée : "+(e.message||e),"error")}
}

function scheduleCandidateContactDuplicateCheck(){
  clearTimeout(candidateContactDuplicateTimer);
  candidateContactDuplicateTimer=setTimeout(candidateContactDuplicateCheck,450);
}

function candidateDuplicateWarningText(matches,field){
  const relevant=(matches||[]).filter(match=>(match.fields||[]).includes(field));
  if(!relevant.length)return "";
  const labels=relevant.slice(0,3).map(match=>`${match.type==="salarie"?"salarié":"candidat"} ${match.name||("n° "+match.id)}${match.society?" ("+match.society+")":""}`);
  return `⚠ ${field==="telephone"?"Ce numéro de téléphone":"Cette adresse email"} est déjà utilisé${field==="email"?"e":""} par ${labels.join(", ")}${relevant.length>3?` et ${relevant.length-3} autre(s)`:""}.`;
}

function showCandidateDuplicateWarning(id,text){
  const node=document.getElementById(id);if(!node)return;
  node.textContent=text||"";
  node.classList.toggle("hidden",!text);
}

async function candidateContactDuplicateCheck(){
  const form=document.getElementById("candidat-form");if(!form)return;
  const phone=form.querySelector('[name="telephone"]')?.value||"";
  const email=form.querySelector('[name="email"]')?.value?.trim()||"";
  if(String(phone).replace(/\D/g,"").length<9&&!email){showCandidateDuplicateWarning("candidate-phone-duplicate-warning","");showCandidateDuplicateWarning("candidate-email-duplicate-warning","");return}
  const current=findCandidatById(form.querySelector('[name="id"]')?.value||"")||{};
  const requestId=++candidateContactDuplicateRequest;
  try{
    const result=await SGDI.rh.candidateContactDuplicates({phone,email,exclude_candidate_id:sqlBackendId(current.backendId)});
    if(requestId!==candidateContactDuplicateRequest)return;
    showCandidateDuplicateWarning("candidate-phone-duplicate-warning",candidateDuplicateWarningText(result?.duplicates,"telephone"));
    showCandidateDuplicateWarning("candidate-email-duplicate-warning",candidateDuplicateWarningText(result?.duplicates,"email"));
  }catch(error){console.warn("Contrôle des coordonnées candidat indisponible",error)}
}

function candidatAliasStorageKey(){return "candidatIdAliases"}

function candidatValidationLockKey(id,key){return String(id||"")+":"+String(key||"")}

function setCandidatSectionButtonsDisabled(id,key,disabled){
  document.querySelectorAll('[data-section-action="1"]').forEach(b=>{
    const call=String(b.getAttribute("onclick")||"");
    if(call.includes("validateCandidatSectionAction")&&call.includes("'"+String(id)+"'")&&call.includes("'"+String(key)+"'")){
      b.disabled=!!disabled;
    }
  });
}

function candidatSectionIndex(key){return CANDIDAT_SECTIONS.findIndex(s=>s.key===key)}

function candidatCurrentSectionKey(c){const s=CANDIDAT_SECTIONS.find(x=>!candidatSectionIsValidated(c,x.key));return s?s.key:null}

function candidatEtape1Valid(c){return CANDIDAT_ETAPE1_KEYS.every(k=>candidatSectionIsValidated(c,k))}

function candidatPreviousSectionsValid(c,key){
  const idx=candidatSectionIndex(key);
  if(idx<=0)return true;
  return CANDIDAT_SECTIONS.slice(0,idx).every(s=>candidatSectionIsValidated(c,s.key));
}

function candidatPreviousSectionsBlockDetails(c,key,data){
  const idx=candidatSectionIndex(key);
  if(idx<=0)return "";
  return CANDIDAT_SECTIONS.slice(0,idx).filter(s=>!candidatSectionIsValidated(c,s.key)).map(s=>{
    const missing=candidatRequiredFieldsForSection(s.key).filter(([field])=>!String(data?.[field]??"").trim()).map(([,label])=>label);
    missing.forEach(label=>{
      const def=candidatRequiredFieldsForSection(s.key).find(([,l])=>l===label);
      const field=def&&def[0];
      if(field)document.querySelectorAll("[name=\""+CSS.escape(field)+"\"]").forEach(el=>{el.classList.add("input-error");el.setAttribute("aria-invalid","true")});
    });
    return `${s.label}${missing.length?` - champs manquants : ${missing.join(", ")}`:" - à valider"}`;
  }).join(" | ");
}

function focusCandidatSectionToValidate(c,key){
  const idx=candidatSectionIndex(key);
  const missing=CANDIDAT_SECTIONS.slice(0,idx).find(s=>!candidatSectionIsValidated(c,s.key));
  if(!missing)return;
  setTimeout(()=>{
    const sec=document.getElementById("section-"+missing.key);
    if(!sec)return;
    sec.scrollIntoView({behavior:"smooth",block:"start"});
    sec.classList.add("candidate-section-attention");
    setTimeout(()=>sec.classList.remove("candidate-section-attention"),2200);
  },60);
}

function candidatSectionAvailable(c,key){
  const cur=candidatCurrentSectionKey(c);
  if(!cur)return true;
  return candidatSectionIndex(key)<=candidatSectionIndex(cur);
}

function candidatCanUnlockSections(){return !!(session&&isAdm1())}

function candidatSectionLocked(c,key){return candidatSectionIsValidated(c,key)&&!candidatCanUnlockSections()}

function candidatSectionOpen(c,key,bannerClass,title){
  if(!candidatSectionAvailable(c,key))return "";
  const locked=candidatSectionLocked(c,key);
  const current=candidatCurrentSectionKey(c)===key;
  const v=candidatSectionValidations(c)[key];
  return `<div class="card candidate-section-card ${current?"current":""} ${locked?"opacity-80":""}" id="section-${key}" data-candidat-section="${key}" data-locked="${locked?"1":"0"}">
    <div class="candidate-section-meta-row">
      <span class="candidate-section-kicker">Section ${candidatSectionIndex(key)+1}</span>
      ${v?`<span class="pill pill-green">Validée ${v.by?`par ${escapeHTML(v.by)}`:""}</span>`:(current?`<span class="pill pill-amber">À valider</span>`:`<span class="pill pill-gray">En attente</span>`)}
    </div>
    <fieldset class="rh-panel-fieldset" style="margin:0 0 0 0">
      <legend>${title}</legend>`;
}

function candidatSectionClose(c,key){
  if(!candidatSectionAvailable(c,key))return "";
  const valid=candidatSectionIsValidated(c,key);
  const canUnlock=candidatCanUnlockSections();
  const meta=candidatSectionValidations(c)[key];
  return `</fieldset>
    <div class="candidate-section-footer">
      <div class="candidate-section-actions">
        ${valid&&canUnlock?`<button type="button" class="btn btn-ghost text-xs" data-section-action="1" onclick="unlockCandidatSection('${escapeHTML(c.id)}','${key}')">Déverrouiller</button>`:""}
      </div>
      <div class="candidate-section-note">${valid?`Section validée ${meta?.at?`le ${new Date(meta.at).toLocaleString("fr-FR")}`:""}`:"La validation se fait depuis la barre d'action en bas de page."}</div>
    </div>
  </div>`;
}

function applyCandidatSectionLocks(){
  if(document.getElementById("candidat-form")?.dataset.editMode==="1")return;
  document.querySelectorAll("[data-candidat-section][data-locked='1']").forEach(sec=>{
    sec.querySelectorAll("input,select,textarea,button").forEach(el=>{
      if(el.dataset.sectionAction==="1")return;
      el.disabled=true;
    });
    if(!sec.querySelector(".section-lock-note")){
      const note=document.createElement("div");
      note.className="section-lock-note text-xs text-emerald-700 mt-2";
      note.textContent="Section verrouillée après validation. Cliquez sur Modifier pour corriger les informations du formulaire.";
      sec.appendChild(note);
    }
  });
  const focus=sessionStorage.getItem("candidatFocusSection");
  if(focus){
    sessionStorage.removeItem("candidatFocusSection");
    setTimeout(()=>document.getElementById("section-"+focus)?.scrollIntoView({behavior:"smooth",block:"start"}),50);
  }
}

function modifierCandidatForm(id){
  const form=document.getElementById("candidat-form");
  if(!form)return;
  const c=findCandidatById(id);
  if(!c){toast("Candidat introuvable","error");return}
  form.dataset.editMode="1";
  form.querySelectorAll("input,select,textarea,button").forEach(el=>{if(el.dataset.sectionAction!=="1")el.disabled=false;el.classList.remove("bg-slate-100","text-slate-400")});
  form.querySelectorAll(".section-lock-note").forEach(el=>el.remove());
  form.querySelectorAll("[data-candidat-section]").forEach(sec=>{sec.dataset.locked="0";sec.classList.remove("opacity-80")});
  bindCandidatDraftAutosave(c.id);
  toast("Modification activée. Corrigez les informations puis cliquez sur Enregistrer.","info");
}

function renderCandidatForm(view,id,options){
  if(isDrhModuleContext())return renderDrhRecruitmentReadOnly(view,"new");
  const formOptions=options||{};
  let c;
  if(id){c=findCandidatById(id);if(!c){toast("Candidat introuvable","error");return navigate((location.hash||"").includes("#/candidats_archives")?"candidats_archives":"reserve")}}
  else{c=candidateBlankDraft({reserveDirect:!!formOptions.reserveDirect})}
  const step=candidatEtape1Valid(c)?2:1;
  const allValid=candidatAllSectionsValid(c);
  const validatedCount=CANDIDAT_SECTIONS.filter(s=>candidatSectionIsValidated(c,s.key)).length;
  const progressPct=Math.round((validatedCount/(CANDIDAT_SECTIONS.length||1))*100);
  const displayName=String(`${c.nom||""} ${c.prenom||""}`).trim();
  const pageTitle=c.isNew?(c.reserveDirect?"Ajouter candidat en réserve":"Fiche candidat"):(displayName||"Fiche candidat");
  const initials=(displayName?displayName.split(/\s+/).slice(0,2).map(x=>x.charAt(0)).join(""):"CR").toUpperCase();
  const returnRoute=candidatIsArchived(c)?"candidats_archives":c.statut==="reserve"?"reserve":"recrutement";
  const currentKey=candidatCurrentSectionKey(c);
  const currentSection=CANDIDAT_SECTIONS.find(s=>s.key===currentKey);
  const sectionList=CANDIDAT_SECTIONS.map((s,i)=>{
    const done=candidatSectionIsValidated(c,s.key);
    const active=currentKey===s.key;
    const available=candidatSectionAvailable(c,s.key);
    return `<button type="button" class="candidate-section-link ${done?"done":active?"active":""}" ${available?`onclick="document.getElementById('section-${s.key}')?.scrollIntoView({behavior:'smooth',block:'start'})"`:"disabled"}>
      <span>${i+1}</span><strong>${escapeHTML(s.label)}</strong>
    </button>`;
  }).join("");
  view.innerHTML=`<div class="candidate-dossier">
    <div class="candidate-hero">
      <div class="candidate-hero-main">
        <div class="candidate-eyebrow">Recrutement / réserve</div>
        <h1 class="candidate-title">${escapeHTML(pageTitle)}</h1>
        <div class="candidate-meta">
          <span class="candidate-chip">${escapeHTML(candidatePosteLabel(c))}</span>
          <span class="candidate-chip">${escapeHTML(c.societe||"Société non renseignée")}</span>
          <span class="candidate-chip">${escapeHTML(c.statut||"nouvelle")}</span>
          <span class="candidate-chip">Étape ${step}/2</span>
        </div>
      </div>
      <div class="flex gap-2 flex-wrap justify-end">
        ${!c.isNew?`<button type="button" class="btn btn-secondary" onclick="openCandidateInterviewModal('${jsString(c.id)}')">Entretien</button>`:""}
        ${!c.isNew?`<button type="button" class="btn btn-success" onclick="validateCandidateApplication('${jsString(c.id)}')">Valider candidature</button>`:""}
        ${!c.isNew&&candidateAvisValue(c.avisDecision)==="Favorable"&&!candidatIsArchived(c)?`<button type="button" class="btn btn-primary" onclick="recruterCandidat('${jsString(c.id)}',this)">Recruter</button>`:""}
        ${!c.isNew&&!candidatIsArchived(c)?`<button type="button" class="btn btn-danger" onclick="openArchiveCandidatModal('${jsString(c.id)}')">Annuler candidature</button>`:""}
        <button type="button" class="btn btn-ghost" onclick="navigate('${returnRoute}')">Retour</button>
      </div>
	    </div>
	    <form id="candidat-form" class="candidate-dossier-grid" onsubmit="event.preventDefault();saveCandidat('${c.id}')">
	      <input type="hidden" name="id" value="${c.id}"/><input type="hidden" name="isNew" value="${c.isNew?"1":""}"/><input type="hidden" name="reserveDirect" value="${c.reserveDirect?"1":""}"/>
	      <div class="candidate-progress-strip">
	        <div class="candidate-progress-top">
	          <div>
	            <div class="candidate-panel-label">Avancement du dossier</div>
	            <p>${allValid?"Toutes les sections sont validées.":"Validez chaque section dans l'ordre pour continuer."}</p>
	          </div>
	          <div class="candidate-progress-score"><strong>${validatedCount}/${CANDIDAT_SECTIONS.length}</strong><span>${progressPct}%</span></div>
	        </div>
	        <div class="candidate-progress-track"><div class="candidate-progress-bar" style="width:${progressPct}%"></div></div>
	        <div class="candidate-section-list candidate-section-list-horizontal">${sectionList}</div>
	      </div>
	      <div class="candidate-actions-panel candidate-actions-row">
	        <button type="button" class="btn btn-secondary" onclick="modifierCandidatForm('${c.id}')">Modifier</button>
	        <button type="button" class="btn btn-secondary" onclick="saveCandidat('${c.id}',true)">Enregistrer</button>
	        ${candidatIsArchived(c)?`<button type="button" class="btn btn-success" onclick="activerCandidat('${c.id}')">Activer</button>`:`<button type="button" class="btn btn-ghost text-red-600" onclick="openArchiveCandidatModal('${c.id}')">Archiver candidat</button>`}
	        ${!candidatIsArchived(c)?(allValid?`<button type="button" class="btn btn-primary" onclick="validerFichePosition('${c.id}')">VALIDER FICHE CANDIDAT</button>`:`<button type="button" class="btn btn-ghost" disabled>Fiche de position non complète</button>`):""}
	        <button type="button" class="btn btn-ghost text-red-600" onclick="deleteCandidat('${c.id}')">Supprimer</button>
	      </div>
	      <div class="candidate-main">
	        <div class="stepper candidate-stepper"><div class="step ${step>=1?"done":"active"}">1. Candidature</div><div class="step ${step===2?"active":""}">2. Fiche de renseignement</div></div>
	        ${renderCandidatEtape1(c)}
	        <div id="etape2-block" class="${candidatEtape1Valid(c)?"":"hidden"}">${candidatEtape1Valid(c)?renderCandidatEtape2(c):""}</div>
	      </div>
	      <div class="candidate-global-section-footer">
	        <div>
	          <div class="candidate-global-footer-label">${allValid?"Dossier complet":currentSection?`Section en cours : ${escapeHTML(currentSection.label)}`:"Validation du dossier"}</div>
	          <div class="candidate-global-footer-note">${allValid?"Toutes les sections sont validées. Vous pouvez valider la fiche de position.":"Après validation, la section suivante s'ouvre automatiquement."}</div>
	        </div>
	        <div class="candidate-global-footer-actions">
	          ${!allValid&&currentKey?`<button type="button" class="btn btn-primary" data-section-action="1" onclick="validateCandidatSectionAction('${escapeHTML(c.id)}','${currentKey}')">Valider la section</button>`:""}
	          ${allValid&&!candidatIsArchived(c)?`<button type="button" class="btn btn-primary" onclick="validerFichePosition('${c.id}')">VALIDER FICHE CANDIDAT</button>`:""}
	        </div>
	      </div>
	    </form>
	  </div>`;
	  setTimeout(()=>{applyCandidatSectionLocks();bindRequiredFieldCleanup(document.getElementById("candidat-form"));updateCandidateContractEndDate();if(!c.isNew)bindCandidatDraftAutosave(c.id);validateCandidatBirthField(document.querySelector('[name="dateNaissance"]'));markCandidatFormIssues(c);candidateContactDuplicateCheck();if(sessionStorage.getItem("candidatAutoEdit:"+c.id)==="1"){sessionStorage.removeItem("candidatAutoEdit:"+c.id);modifierCandidatForm(c.id)}},0);
}

function renderCandidatEtape1(c){
  const posteOptions=POSTES.includes(c.posteSouhaite)?POSTES:(c.posteSouhaite?[c.posteSouhaite,...POSTES]:POSTES);
	return`${candidatSectionAvailable(c,"identification")?`${candidatSectionOpen(c,"identification","banner-amber","IDENTIFICATION DU CANDIDAT")}
	    <div class="grid grid-6">
	      <div class="col-span-6 candidate-id-photo-row">
	        <div><label class="label">Photo</label>${photoField(c.photo)}</div>
	        <div class="candidate-id-name-fields">
	          <div><label class="label">Nom *</label><input class="input" name="nom" value="${escapeHTML(c.nom)}" /></div>
	          <div><label class="label">Prénom *</label><input class="input" name="prenom" value="${escapeHTML(c.prenom)}" /></div>
	          <div><label class="label">Date de naissance *</label><input class="input" type="date" name="dateNaissance" max="${candidatBirthMaxDate()}" value="${c.dateNaissance||""}"  aria-describedby="date-naissance-alert" title="Le candidat doit avoir 20 ans révolus à la date d'enregistrement" oninput="validateCandidatBirthField(this)" onchange="validateCandidatBirthField(this)"/><div id="date-naissance-alert" class="text-[11px] text-slate-500 mt-1">Âge minimum requis : 20 ans révolus à la date d'enregistrement.</div></div>
	          <div><label class="label">Lieu de naissance *</label><input class="input" name="lieuNaissance" value="${escapeHTML(c.lieuNaissance)}" /></div>
	          <div class="candidate-id-inline-row">
	            <div class="candidate-field-5cm"><label class="label">Sexe *</label><select class="select" name="sexe" ><option ${c.sexe==="M"?"selected":""}>M</option><option ${c.sexe==="F"?"selected":""}>F</option></select></div>
	            <div class="candidate-field-4cm"><label class="label">Groupe sanguin</label><select class="select" name="groupeSanguin"><option value="">—</option>${["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(g=>`<option value="${g}" ${String(c.groupeSanguin||"")===g?"selected":""}>${g}</option>`).join("")}</select></div>
	            <div class="candidate-field-7cm"><label class="label">Situation familiale *</label><select class="select" name="situation" >${["Célibataire","Marié(e)","Divorcé(e)","Veuf(ve)"].map(s=>`<option ${c.situation===s?"selected":""}>${s}</option>`).join("")}</select></div>
	            <div class="candidate-field-4cm"><label class="label">Nombre d'enfant *</label><select class="select" name="nombreEnfants"><option value="">—</option>${Array.from({length:20},(_,i)=>i+1).map(n=>{const value=String(n).padStart(2,"0");return`<option value="${value}" ${Number(c.nombreEnfants)===n?"selected":""}>${value}</option>`}).join("")}</select></div>
	          </div>
	        </div>
	      </div>
      <div class="col-span-6 candidate-parent-names-row">
        <div><label class="label">Nom du père *</label><input class="input" name="nomPere" value="${escapeHTML(c.nomPere||"")}" /></div>
        <div><label class="label">Nom de la mère *</label><input class="input" name="nomMere" value="${escapeHTML(c.nomMere||"")}" /></div>
      </div>
      <div class="col-span-3"><label class="label">Source *</label><input class="input" name="source" value="${escapeHTML(c.source||"")}" placeholder="ANEM, LinkedIn, recommandation…" /></div>
      <div class="col-span-3"><label class="label">NIN</label><input class="input" name="nin" value="${escapeHTML(c.nin||"")}" maxlength="20" /></div>
      <div class="col-span-3"><label class="label">N° CNAS</label><input class="input" name="numeroCnas" value="${escapeHTML(c.numeroCnas||c.cnas||"")}" maxlength="13" pattern="[0-9]{10} [0-9]{2}" inputmode="numeric" placeholder="xxxxxxxxxx xx" oninput="let d=this.value.replace(/[^0-9]/g,'').slice(0,12);this.value=d.length>10?d.slice(0,10)+' '+d.slice(10):d" /></div>
      <div class="col-span-6 candidate-measurements-block">
        <div class="candidate-subsection-title">Mensurations</div>
        <div class="candidate-measurements-grid">
          <div><label class="label">Taille (cm)</label><input class="input" type="number" name="taille" value="${c.taille||""}"/></div>
          <div><label class="label">Pointure</label><input class="input" type="number" name="pointure" value="${c.pointure||""}"/></div>
          <div><label class="label">Taille chemise</label><select class="select" name="tailleChemise">${["XS","S","M","L","XL","XXL","XXXL"].map(s=>`<option ${c.tailleChemise===s?"selected":""}>${s}</option>`).join("")}</select></div>
          <div><label class="label">Taille pantalon</label><select class="select" name="taillePantalon"><option value="">—</option>${["36","38","40","42","44","46","48","50","52","54","56","58","60"].map(s=>`<option ${String(c.taillePantalon||"")===s?"selected":""}>${s}</option>`).join("")}</select></div>
        </div>
      </div>
    </div>
    <div class="mt-4"><label class="label">Langues parlées</label><div class="flex flex-wrap gap-3">${["Arabe","Français","Anglais","Kabyle","Espagnol","Allemand"].map(l=>`<label class="radio-pill"><input type="checkbox" name="lang_${l}" ${(c.langues||[]).includes(l)?"checked":""}/> ${l}</label>`).join("")}<label class="radio-pill"><input type="checkbox" id="lang-autre-check" ${c.langueAutre?"checked":""}/> Autre</label><input id="lang-autre-input" class="input" style="max-width:200px" name="langueAutre" value="${escapeHTML(c.langueAutre||"")}" placeholder="Précisez"/></div></div>
  ${candidatSectionClose(c,"identification")}`:""}
  ${candidatSectionAvailable(c,"militaire")?`${candidatSectionOpen(c,"militaire","banner-amber","SERVICE MILITAIRE")}
    <div>
      <div class="mb-4 text-left">
        <label class="label">Service militaire</label>
        <div class="flex gap-2 justify-start">
            <label class="radio-pill"><input type="radio" name="serviceMilitaire" value="Oui" ${c.serviceMilitaire==="Oui"?"checked":""} onchange="toggleServiceMilitaireFields(this.value)"/> Oui</label>
            <label class="radio-pill"><input type="radio" name="serviceMilitaire" value="Non" ${c.serviceMilitaire!=="Oui"?"checked":""} onchange="toggleServiceMilitaireFields(this.value)"/> Non</label>
        </div>
      </div>
      <div class="candidate-military-grid">
        <div><label class="label">Arme</label><input class="input ${c.serviceMilitaire==="Oui"?"":"bg-slate-100 text-slate-400"}" name="armeService" value="${escapeHTML(c.armeService||"")}" placeholder="Infanterie, marine, aviation…" data-service-militaire-field ${c.serviceMilitaire==="Oui"?"":"disabled"}/></div>
        <div><label class="label">Nombre d'années</label><input class="input bg-slate-100 ${c.serviceMilitaire==="Oui"?"":"text-slate-400"}" type="number" min="0" step="0.1" name="nombreAnneesService" value="${candidateMilitaryYears(c.dateIncorporation,c.dateRadiation)}" data-service-militaire-field data-service-militaire-output readonly data-no-lock ${c.serviceMilitaire==="Oui"?"":"disabled"}/></div>
        <div><label class="label">Date d'incorporation</label><input class="input ${c.serviceMilitaire==="Oui"?"":"bg-slate-100 text-slate-400"}" type="date" name="dateIncorporation" value="${c.dateIncorporation||""}" data-service-militaire-field ${c.serviceMilitaire==="Oui"?"":"disabled"} oninput="updateCandidateMilitaryYears()" onchange="updateCandidateMilitaryYears()"/></div>
        <div><label class="label">Date de radiation</label><input class="input ${c.serviceMilitaire==="Oui"?"":"bg-slate-100 text-slate-400"}" type="date" name="dateRadiation" value="${c.dateRadiation||""}" data-service-militaire-field ${c.serviceMilitaire==="Oui"?"":"disabled"} oninput="updateCandidateMilitaryYears()" onchange="updateCandidateMilitaryYears()"/></div>
      </div>
    </div>
  ${candidatSectionClose(c,"militaire")}`:""}
  ${candidatSectionAvailable(c,"poste")?`${candidatSectionOpen(c,"poste","banner-green","Poste & CV")}
    <div class="grid grid-6">
      <div class="col-span-3"><label class="label">Poste *</label><input class="input" name="posteSouhaite" list="candidate-position-options" value="${escapeHTML(c.posteSouhaite||"")}" placeholder="Choisir ou saisir un nouveau poste" autocomplete="off"/><datalist id="candidate-position-options">${posteOptions.map(p=>`<option value="${escapeHTML(p)}"></option>`).join("")}</datalist><div class="text-[10px] text-slate-500 mt-1">Vous pouvez sélectionner un poste existant ou saisir un nouveau poste.</div></div>
      <div class="col-span-3"><label class="label">Durée du contrat</label><select class="select" name="dureeContrat">${contratDureeOptions(c.dureeContrat||"")}</select></div>
      <div class="col-span-3"><label class="label">Salaire prévu pour le poste (DA/mois)</label><input class="input" type="text" inputmode="decimal" name="salairePrevu" value="${formatMoneyInputValue(c.salairePrevu)}" placeholder="45 000,00" onblur="formatMoneyField(this)"/></div>
      <div class="col-span-3"><label class="label">&nbsp;</label><div class="text-xs text-slate-500 pt-2">${c.salairePrevu?`Fourchette estimée : <b>${money(c.salairePrevu)}</b>`:"Montant brut prévisionnel pour ce poste"}</div></div>
      <div class="col-span-3"><label class="label">Téléphone *</label><input class="input" name="telephone" value="${escapeHTML(formatPhoneSGDI(c.telephone||""))}" inputmode="numeric" maxlength="13" placeholder="Numéro de téléphone" oninput="normalizePhoneSGDIInput(this);scheduleCandidateContactDuplicateCheck()" onblur="candidateContactDuplicateCheck()" /><div id="candidate-phone-duplicate-warning" class="hidden text-[11px] font-bold text-red-600 mt-1" role="alert"></div></div>
      <div class="col-span-3"><label class="label">Email</label><input class="input" type="email" name="email" value="${escapeHTML(c.email||"")}" placeholder="Adresse email" oninput="scheduleCandidateContactDuplicateCheck()" onblur="candidateContactDuplicateCheck()"/><div id="candidate-email-duplicate-warning" class="hidden text-[11px] font-bold text-red-600 mt-1" role="alert"></div></div>
      <div class="col-span-6"><label class="label">CV</label>
        <input type="hidden" name="cv_url" value="${c.cvFile?c.cvFile.url:""}"/><input type="hidden" name="cv_name" value="${c.cvFile?escapeHTML(c.cvFile.name):""}"/>
        <div id="cv-holder">${c.cvFile?`<div class="text-xs text-emerald-600">✅ ${escapeHTML(c.cvFile.name)}</div><div class="flex gap-2 mt-1"><button type="button" class="btn btn-ghost text-xs" onclick="viewDoc('${c.cvFile.url}','${escapeHTML(c.cvFile.name)}')">👁 Voir</button><button type="button" class="btn btn-ghost text-xs text-red-600" onclick="removeCv()">✕ Retirer</button></div>`:`<input id="cv-input" type="file" accept=".pdf,.doc,.docx,image/*" class="hidden" onchange="handleCvUpload('cv-input')"/><button type="button" class="btn btn-secondary text-xs" onclick="document.getElementById('cv-input').click()">📤 Téléverser le CV</button>`}</div>
      </div>
      <div class="col-span-6"><label class="label">Notes du recruteur</label><textarea class="textarea" rows="2" name="notes">${escapeHTML(c.notes||"")}</textarea></div>
    </div>
  ${candidatSectionClose(c,"poste")}`:""}
  ${candidatSectionAvailable(c,"avis")?`${candidatSectionOpen(c,"avis","banner-amber","Avis du recruteur")}
    <div class="grid grid-6">
      <div class="col-span-2"><label class="label">Décision *</label><select class="select candidate-avis-field ${candidateAvisClass(c.avisDecision)}" name="avisDecision" onchange="this.className='select candidate-avis-field '+candidateAvisClass(this.value)" ><option value="">— Choisir —</option>${["Favorable","Défavorable","Instance"].map(x=>`<option ${candidateAvisValue(c.avisDecision)===x?"selected":""}>${x}</option>`).join("")}</select></div>
      <div class="col-span-2"><label class="label">Date de l'avis *</label><input class="input" type="date" name="avisDate" value="${escapeHTML(c.avisDate||today())}" /></div>
      <div class="col-span-2"><label class="label">Recruteur *</label><input class="input" name="avisRecruteur" value="${escapeHTML(c.avisRecruteur||"")}" placeholder="Nom du recruteur" /></div>
      <div class="col-span-6"><label class="label">Commentaire / motivation *</label><textarea class="textarea" rows="3" name="avisCommentaire" placeholder="Justification, points forts, réserves, recommandations…" >${escapeHTML(c.avisCommentaire||"")}</textarea></div>
    </div>
  ${candidatSectionClose(c,"avis")}`:""}`;
}

function renderCandidatEtape2(c){
  return`${candidatSectionAvailable(c,"contact")?`${candidatSectionOpen(c,"contact","banner-blue","E. Coordonnées & contact d'urgence")}
    <div class="grid grid-6">
      <div class="col-span-3"><label class="label">Adresse *</label><input class="input" name="adresse" value="${escapeHTML(c.adresse||"")}" /></div>
      <div class="col-span-3"><label class="label">Commune *</label><input class="input" name="commune" value="${escapeHTML(c.commune||"")}" /></div>
      <div class="col-span-3"><label class="label">Wilaya *</label><select class="select" name="wilaya" ><option value="">—</option>${WILAYAS.map(w=>`<option ${c.wilaya===w?"selected":""}>${w}</option>`).join("")}</select></div>
      <div class="col-span-3"><label class="label">Lien contact d'urgence *</label><input class="input" name="contactUrgenceLien" value="${escapeHTML(c.contactUrgenceLien||"")}" /></div>
      <div class="col-span-2"><label class="label">Nom contact urgence *</label><input class="input" name="contactUrgenceNom" value="${escapeHTML(c.contactUrgenceNom||"")}" /></div>
      <div class="col-span-2"><label class="label">Téléphone *</label><input class="input" name="contactUrgenceTel" value="${escapeHTML(formatPhoneSGDI(c.contactUrgenceTel||""))}" inputmode="numeric" maxlength="13" placeholder="0000 00 00 00" oninput="normalizePhoneSGDIInput(this)" /></div>
    </div>
  ${candidatSectionClose(c,"contact")}`:""}
  ${candidatSectionAvailable(c,"habilitations")?`${candidatSectionOpen(c,"habilitations","banner-amber","F. Documents & habilitations")}
    <div class="candidate-document-picker flex gap-2 items-end flex-wrap mb-4">
      <div style="min-width:280px;flex:1"><label class="label">Type de document</label><select id="candidate-document-type" class="select">${candidateDocumentTypeOptions().map(label=>`<option value="${escapeHTML(label)}">${escapeHTML(label)}</option>`).join("")}</select></div>
      <button type="button" class="btn btn-primary" onclick="addCandidateHabilitationDocument()">＋ Ajouter le document</button>
    </div>
    <div id="candidate-habilitation-documents" class="space-y-2">${(c.habilitationDocuments||[]).map((document,index)=>candidateHabilitationDocumentRow(document,index)).join("")||'<div class="candidate-documents-empty text-sm text-slate-500 p-4 bg-slate-50 rounded-lg">Aucun document ajouté.</div>'}</div>
    <div class="text-xs text-slate-500 mt-3">Vous pouvez ajouter autant de documents que nécessaire, y compris plusieurs documents du même type.</div>
  ${candidatSectionClose(c,"habilitations")}`:""}
  ${candidatSectionAvailable(c,"experience")?`${candidatSectionOpen(c,"experience","banner-green","G. Expérience professionnelle")}
    <div id="exp-rows">${(c.experience||[]).map((e,i)=>experienceRow(e,i)).join("")||experienceRow({},0)}</div>
    <button type="button" class="btn btn-ghost text-xs mt-2" onclick="addExpRow()">＋ Ajouter une expérience</button>
  ${candidatSectionClose(c,"experience")}`:""}`;
}

function candidateDocumentTypeOptions(){return ["Enquête d'habilitation","Service national","Diplôme de secourisme","Diplôme lutte anti-incendie","Carte professionnelle","Certificat de travail","Diplôme / attestation de formation","Autre document"]}

function candidateHabilitationDocumentRow(document,index){
  const item=document||{};const token=`${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2,7)}`;const hasFile=!!item.url;
  return `<div class="candidate-habilitation-document-row grid grid-6 gap-2 items-end p-3 bg-slate-50 rounded-lg" data-document-row="1">
    <div class="col-span-2"><label class="label">Document</label><input class="input" name="habdoc_type_${token}" value="${escapeHTML(item.type||"")}" placeholder="Nom du document"/></div>
    <div class="col-span-3"><input type="hidden" name="habdoc_url_${token}" value="${escapeHTML(item.url||"")}"/><input type="hidden" name="habdoc_name_${token}" value="${escapeHTML(item.name||"")}"/><input id="habdoc-file-${token}" type="file" accept="image/*,.pdf,.doc,.docx" class="hidden" onchange="uploadCandidateHabilitationDocument(this)"/><div class="candidate-habilitation-file flex gap-2 items-center flex-wrap">${hasFile?`<span class="text-xs text-emerald-700 font-bold">✅ ${escapeHTML(item.name||"Fichier joint")}</span><button type="button" class="btn btn-ghost text-xs" onclick="viewDoc(this.closest('[data-document-row]').querySelector('[name^=habdoc_url_]').value,this.closest('[data-document-row]').querySelector('[name^=habdoc_name_]').value)">Voir</button>`:`<button type="button" class="btn btn-secondary text-xs" onclick="this.closest('[data-document-row]').querySelector('input[type=file]').click()">Téléverser un fichier</button>`}</div></div>
    <div class="col-span-1"><button type="button" class="btn btn-ghost text-red-600 text-xs" onclick="removeCandidateHabilitationDocument(this)">Supprimer</button></div>
  </div>`
}

function addCandidateHabilitationDocument(){
  const holder=document.getElementById("candidate-habilitation-documents");const select=document.getElementById("candidate-document-type");if(!holder||!select)return;
  holder.querySelector(".candidate-documents-empty")?.remove();
  const wrapper=document.createElement("div");wrapper.innerHTML=candidateHabilitationDocumentRow({type:select.value},holder.querySelectorAll("[data-document-row]").length);holder.appendChild(wrapper.firstElementChild);
  const id=document.querySelector('#candidat-form [name="id"]')?.value;if(id&&!isTempCandidateId(id))bindCandidatDraftAutosave(id);
}

function removeCandidateHabilitationDocument(button){
  const holder=document.getElementById("candidate-habilitation-documents");button.closest("[data-document-row]")?.remove();
  if(holder&&!holder.querySelector("[data-document-row]"))holder.innerHTML='<div class="candidate-documents-empty text-sm text-slate-500 p-4 bg-slate-50 rounded-lg">Aucun document ajouté.</div>';
  const id=document.querySelector('#candidat-form [name="id"]')?.value;if(id)scheduleCandidatDraftSave(id);
}

function uploadCandidateHabilitationDocument(input){
  const file=input.files?.[0];if(!file)return;if(file.size>5*1024*1024){toast("Fichier > 5 Mo","error");input.value="";return}
  const row=input.closest("[data-document-row]");const reader=new FileReader();reader.onload=event=>{row.querySelector('[name^="habdoc_url_"]').value=event.target.result;row.querySelector('[name^="habdoc_name_"]').value=file.name;row.querySelector(".candidate-habilitation-file").innerHTML=`<span class="text-xs text-emerald-700 font-bold">✅ ${escapeHTML(file.name)}</span><button type="button" class="btn btn-ghost text-xs" onclick="viewDoc(this.closest('[data-document-row]').querySelector('[name^=habdoc_url_]').value,this.closest('[data-document-row]').querySelector('[name^=habdoc_name_]').value)">Voir</button><button type="button" class="btn btn-secondary text-xs" onclick="this.closest('[data-document-row]').querySelector('input[type=file]').click()">Remplacer</button>`;const id=document.querySelector('#candidat-form [name="id"]')?.value;if(id)scheduleCandidatDraftSave(id);};reader.readAsDataURL(file)
}

function experienceRow(e,idx){return`<div class="grid grid-6 mb-2 exp-row" data-idx="${idx}"><div class="col-span-2"><label class="label">Employeur</label><input class="input" name="exp_employeur" value="${escapeHTML(e.employeur||"")}"/></div><div class="col-span-2"><label class="label">Poste</label><input class="input" name="exp_poste" value="${escapeHTML(e.poste||"")}"/></div><div><label class="label">Du</label><input class="input" type="date" name="exp_du" value="${e.du||""}"/></div><div><label class="label">Au</label><input class="input" type="date" name="exp_au" value="${e.au||""}"/></div><div class="col-span-2"><label class="label">Salaire</label><input class="input" inputmode="decimal" name="exp_salaire" value="${formatMoneyInputValue(e.salaire||"")}" placeholder="45 000,00" onblur="formatMoneyField(this)"/></div><div class="col-span-3"><label class="label">Motif de départ</label><select class="select" name="exp_motif"><option value="">—</option>${MOTIFS_DEPART.map(m=>`<option ${e.motifDepart===m?"selected":""}>${m}</option>`).join("")}</select></div><div class="col-span-1 flex items-end"><button type="button" class="btn btn-ghost text-red-600 text-xs" onclick="this.closest('.exp-row').remove()">✕</button></div></div>`}

function addExpRow(){const h=document.getElementById("exp-rows");const d=document.createElement("div");d.innerHTML=experienceRow({},h.children.length);h.appendChild(d.firstElementChild)}

function toggleServiceMilitaireFields(value){
  const enabled=value==="Oui";
  document.querySelectorAll("[data-service-militaire-field]").forEach(el=>{
    el.disabled=!enabled;
    if(!enabled)el.value="";
    el.classList.toggle("bg-slate-100",!enabled);
    el.classList.toggle("text-slate-400",!enabled);
  });
  if(enabled)updateCandidateMilitaryYears();
}

function candidateMilitaryYears(startValue,endValue){
  const start=new Date(String(startValue||"")+"T00:00:00");
  const end=new Date(String(endValue||"")+"T00:00:00");
  if(!startValue||!endValue||Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<start)return "";
  return String(Math.round(((end-start)/(365.2425*24*60*60*1000))*10)/10);
}

function updateCandidateMilitaryYears(){
  const form=document.getElementById("candidat-form");if(!form)return;
  const start=form.querySelector('[name="dateIncorporation"]');
  const end=form.querySelector('[name="dateRadiation"]');
  const output=form.querySelector('[name="nombreAnneesService"]');
  if(!output)return;
  output.value=candidateMilitaryYears(start?.value,end?.value);
  if(end)end.setCustomValidity(start?.value&&end.value&&end.value<start.value?"La date de radiation doit être postérieure à la date d'incorporation.":"");
  output.dispatchEvent(new Event("change",{bubbles:true}));
}

function updateCandidateContractEndDate(){
  const f=document.getElementById("candidat-form");if(!f)return;
  const start=f.querySelector('[name="dateRecrutement"]')?.value||"";
  const duration=f.querySelector('[name="dureeContrat"]')?.value||"";
  const out=f.querySelector('[name="dateFinContrat"]');
  if(out)out.value=contractEndDate(start,duration);
}

function validateCandidatIdentification(data){
  markRequiredFields(document.getElementById("candidat-form"));

  if(data.numeroCnas&&!/^\d{10} \d{2}$/.test(String(data.numeroCnas||""))){toast("Le N° CNAS doit respecter le format 10 chiffres espace 2 chiffres","error");return false}
  if(data.telephone&&String(data.telephone||"").replace(/\D/g,"").length!==10){toast("Le téléphone doit respecter le format 0000 00 00 00","error");return false}
  if(data.contactUrgenceTel&&String(data.contactUrgenceTel||"").replace(/\D/g,"").length!==10){toast("Le téléphone d'urgence doit respecter le format 0000 00 00 00","error");return false}
  return true;
}

function markCandidatSectionMissingFields(key,data){
  const form=document.getElementById("candidat-form");
  if(!form)return [];
  const missing=[];
  candidatRequiredFieldsForSection(key).forEach(([field,label])=>{
    const value=String(data?.[field]??"").trim();
    const controls=[...form.querySelectorAll("[name=\""+CSS.escape(field)+"\"]")];
    controls.forEach(el=>{
      el.classList.toggle("input-error",!value);
      if(!value)el.setAttribute("aria-invalid","true");else el.removeAttribute("aria-invalid");
    });
    if(!value)missing.push(label);
  });
  return missing;
}

function candidatSectionRequiredValid(key,data){
  const missing=markCandidatSectionMissingFields(key,data);
  if(missing.length){toast("Champs obligatoires manquants : "+missing.slice(0,6).join(", ")+(missing.length>6?"...":""),"error");return false}
  return true;
}

async function saveCandidat(id,showToast,options){
  const opt=options||{};
  if(opt.requireIdentification)markRequiredFields(document.getElementById("candidat-form"));
  const data=collectCandidatFormData();if(!data){toast("Formulaire introuvable","error");return}
  if(!candidateHasMinimumData(data)){toast(candidateMinimumDataMessage(data),"error");return}
  if(opt.requireIdentification&& !candidatSectionRequiredValid("identification",data))return;
  if(!validateCandidatIdentification(data))return;
  if(data.dateNaissance&&candidatAgeAtSave(data.dateNaissance)<20){toast("Le candidat doit avoir au moins 20 ans à la date d'enregistrement","error");return}
  const realId=isTempCandidateId(id)?(candidatTempRealIds[id]||(candidatTempRealIds[id]=uid("cd"))):id;
  const creating=!findCandidatById(realId)&&!findCandidatById(id);
  let c=findCandidatById(realId)||findCandidatById(id);
  const draft={...(c||{id:realId,statut:"nouvelle",createdAt:today()}),...data,id:realId};
  delete draft.isNew;
  if((data.reserveDirect==="1"||draft.reserveDirect)&&candidatAllSectionsValid(draft)){
    draft.reserveDirect=true;
    draft.statut="reserve";
    draft.fichePositionValidee=true;
    draft.fichePositionValideeAt=draft.fichePositionValideeAt||new Date().toISOString();
    draft.fichePositionValideeBy=draft.fichePositionValideeBy||session?.username||"system";
  }
  else if(!candidatIsArchived(draft)){
    draft.statut="nouvelle";
    draft.fichePositionValidee=false;
    delete draft.fichePositionValideeAt;
    delete draft.fichePositionValideeBy;
  }
  try{
    await ensureCandidatePositionInCatalog(draft);
    await persistCandidateToPostgres(draft,{allowCreate:creating||!sqlBackendId(draft.backendId)});
    if(c)Object.assign(c,draft);else{c=draft;if(!db.candidats.some(x=>x===c||String(x.id)===String(c.id)||String(x.backendId||"")===String(c.backendId||"")))db.candidats.push(c)}
    stashCandidatForRoute(c,[id,realId,data.id]);
    if(!opt.skipPull)await sgdiPullState({silent:true,render:false,force:true,light:true});
  }catch(e){
    toast("Candidat non enregistré dans : "+(e.message||e),"error");
    return null;
  }
  if(showToast)toast("Candidat enregistré","success");
  if((location.hash||"").endsWith("/nouveau")){
    history.replaceState(null,"","#/"+(c.reserveDirect?"reserve/":"recrutement/")+c.id);
  }
  return c;
}

async function saveCandidatDraft(id){
  const data=collectCandidatFormData();if(!data||!candidateHasMinimumData(data))return false;
  let c=findCandidatById(id);
  if(!c)return false;
  Object.assign(c,data);
  delete c.isNew;
  if(!c.fichePositionValidee&&!candidatIsArchived(c))c.statut="nouvelle";
  try{
    await persistCandidateToPostgres(c);
    await sgdiPullState({silent:true,render:false,force:true,light:true});
    if((location.hash||"").endsWith("/nouveau")){
      history.replaceState(null,"","#/"+(c.reserveDirect?"reserve/":"recrutement/")+id);
    }
    return true;
  }catch(e){
    console.error("Brouillon candidat non enregistré dans PostgreSQL",e);
    return false;
  }
}

function openArchiveCandidatModal(id){
  const c=findCandidatById(id)||{};
  openModal(`<h3 class="font-bold text-lg mb-4">Archiver candidat</h3>
    <form onsubmit="event.preventDefault();confirmArchiveCandidat('${id}')">
      <div class="mb-4 text-sm text-slate-600">Choisissez le motif d'archivage${c.nom||c.prenom?` pour <b>${escapeHTML((c.nom||"")+" "+(c.prenom||""))}</b>`:""}.</div>
      <div class="mb-4">
        <label class="label">Motif *</label>
        <select class="select" name="motifArchive" >
          <option value="">— Choisir un motif —</option>
          ${CANDIDAT_ARCHIVE_MOTIFS.map(m=>`<option>${escapeHTML(m)}</option>`).join("")}
        </select>
      </div>
      <div class="mb-4">
        <label class="label">Commentaire</label>
        <textarea class="textarea" name="commentaireArchive" rows="3" placeholder="Précision facultative"></textarea>
      </div>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>
        <button class="btn btn-danger">Archiver candidat</button>
      </div>
    </form>`);
}

SGDIModules.registerModule({key: "recruitment", routes: ["recrutement","reserve","candidats_archives"], dependencies: ["recruitment-actions"], init: function(){}, destroy: function(){}});
