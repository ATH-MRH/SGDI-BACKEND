/* Phase 2 — recruitment-actions. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
async function confirmArchiveCandidat(id){
  const f=document.querySelector(".modal-bg form");if(!f)return;
  const motif=String(new FormData(f).get("motifArchive")||"").trim();
  const commentaire=String(new FormData(f).get("commentaireArchive")||"").trim();
  const data=collectCandidatFormData()||{};
  let c=findCandidatById(id);
  if(!c){toast("Enregistrez d'abord le candidat avant de l'archiver","error");return}
  if(!motif){toast("Choisissez un motif d'archivage","error");return}
  const source=candidatIsReserve(c)||data.statut==="reserve"||data.fichePositionValidee===true?"reserve":"nouvelle";
  const draft={...c,...data};
  draft.statut="archive";
  draft.archiveSource=source;
  draft.motifArchive=motif;
  draft.commentaireArchive=commentaire;
  draft.archivedAt=new Date().toISOString();
  draft.archivedBy=session?.username||session?.nom||"";
  delete draft.isNew;
  try{
    await persistCandidateToPostgres(draft);
    Object.assign(c,draft);
    await sgdiPullState({silent:true,render:false,force:true,light:true});
    closeModal();
    toast("Candidat archivé","success");
    navigate("candidats_archives");
  }catch(e){toast("Archivage refusé : "+(e.message||e),"error")}
}

async function deleteCandidat(id){
  if(isTempCandidateId(id)){forgetPendingCandidat(null,id);navigate("reserve");setTimeout(renderView,0);return}
  const c=findCandidatById(id);
  if(!c){forgetPendingCandidat(null,id);toast("Déjà supprimé","info");navigate("reserve");setTimeout(renderView,0);return}
  const label=String((c.nom||"")+" "+(c.prenom||"")).trim();
  const targetRoute=candidatIsArchived(c)?"candidats_archives":candidatIsReserve(c)?"reserve":"recrutement";
  if(!confirm("Supprimer définitivement "+(label||"ce candidat")+" ?"))return;
  try{await deleteCandidateFromPostgres(c)}catch(e){
    const msg=String(e&&e.message||e||"");
    if(!/not found|introuvable|404/i.test(msg)){toast("Suppression refusée : "+msg,"error");return}
  }
  const removed=removeCandidatLocal(c,id);
  await sgdiPullState({silent:true,render:false,force:true,light:true});
  toast(removed?"Candidat supprimé":"Déjà supprimé","success");
  if((location.hash||"").slice(2)===targetRoute)renderView();else navigate(targetRoute);
}

async function deleteSelectedReserveCandidates(){
  const selected=[...document.querySelectorAll("[data-reserve-delete-id]:checked")].map(x=>({id:x.dataset.reserveDeleteId||"",backendId:x.dataset.reserveDeleteBackend||""}));
  if(!selected.length){toast("Cochez au moins un candidat à supprimer","error");return}
  if(!confirm(`Supprimer définitivement ${selected.length} candidat(s) sélectionné(s) ?`))return;
  let ok=0,failed=0;
  const targets=selected.map(item=>({
    item,
    candidate:findCandidatById(item.id)||(db.candidats||[]).find(x=>String(x.backendId||"")===String(item.backendId||""))
  }));
  const batchSize=12;
  for(let i=0;i<targets.length;i+=batchSize){
    const batch=targets.slice(i,i+batchSize);
    const results=await Promise.allSettled(batch.map(async target=>{
      const c=target.candidate;
      if(!c)throw new Error("Candidat introuvable");
      try{await deleteCandidateFromPostgres(c)}
      catch(e){if(!sgdiIsNotFoundError(e))throw e}
      removeCandidatLocal(c,target.item.id||c.id);
      return c;
    }));
    results.forEach((result,index)=>{
      if(result.status==="fulfilled")ok++;
      else{failed++;console.warn("Suppression candidat sélectionné refusée",batch[index].candidate,result.reason)}
    });
  }
  await sgdiPullState({silent:true,render:false,force:true,light:true}).catch(e=>console.warn("Rafraîchissement après suppression sélection réserve",e));
  toastCenter(`${ok} CANDIDAT(S) SUPPRIMÉ(S)${failed?` · ${failed} échec(s)`:""}`,failed?"error":"success");
  renderView();
}

async function activerCandidat(id){
  const c=findCandidatById(id);
  if(!c){toast("Candidat introuvable","error");return}
  if(!confirm("Activer ce candidat et l'envoyer vers Candidats en réserve ?"))return;
  const draft={...c};
  draft.statut="reserve";
  draft.fichePositionValidee=true;
  draft.fichePositionValideeAt=draft.fichePositionValideeAt||new Date().toISOString();
  draft.fichePositionValideeBy=draft.fichePositionValideeBy||session?.username||"system";
  draft.reactivatedAt=new Date().toISOString();
  draft.reactivatedBy=session?.username||session?.nom||"";
  delete draft.motifArchive;
  delete draft.commentaireArchive;
  delete draft.archivedAt;
  delete draft.archivedBy;
  delete draft.archiveSource;
  delete draft.isNew;
  try{
    await persistCandidateToPostgres(draft);
    Object.assign(c,draft);
    await sgdiPullState({silent:true,render:false,force:true,light:true});
    toast("Candidat activé et envoyé en réserve","success");
    navigate("reserve");
  }catch(e){toast("Activation refusée : "+(e.message||e),"error")}
}

function scheduleCandidatDraftSave(id){
  if(!findCandidatById(id))return;
  sgdiDirty=true;
  clearTimeout(candidatDraftTimer);
  candidatDraftTimer=setTimeout(()=>saveCandidatDraft(id),700);
}

function bindCandidatDraftAutosave(id){
  const f=document.getElementById("candidat-form");if(!f)return;
  f.querySelectorAll("input,select,textarea").forEach(el=>{
    if(el.dataset.candidatDraftBound==="1")return;
    const fn=()=>scheduleCandidatDraftSave(id);
    el.addEventListener("change",fn);
    if(["INPUT","TEXTAREA"].includes(el.tagName))el.addEventListener("input",fn);
    el.dataset.candidatDraftBound="1";
  });
}

function validateCandidatSection(key,data){
  if(!candidatSectionRequiredValid(key,data))return false;
  if(key==="identification"&&!validateCandidatIdentification(data))return false;
  if(key==="poste"&&String(data.telephone||"").replace(/\D/g,"").length!==10){toast("Le téléphone doit respecter le format 0000 00 00 00","error");return false}
  if(key==="contact"&&String(data.contactUrgenceTel||"").replace(/\D/g,"").length!==10){toast("Le téléphone d'urgence doit respecter le format 0000 00 00 00","error");return false}
  if(data.dateNaissance&&candidatAgeAtSave(data.dateNaissance)<20){toast("Le candidat doit avoir au moins 20 ans à la date d'enregistrement","error");return false}
  return true;
}

async function validateCandidatSectionAction(id,key){
  const lockKey=candidatValidationLockKey(id,key);
  if(candidatValidationLocks.has(lockKey)){toast("Validation déjà en cours, veuillez patienter","warning");return}
  candidatValidationLocks.add(lockKey);
  setCandidatSectionButtonsDisabled(id,key,true);
  const realId=isTempCandidateId(id)?(candidatTempRealIds[id]||(candidatTempRealIds[id]=uid("cd"))):id;
  let c=findCandidatById(realId)||findCandidatById(id);
  markRequiredFields(document.getElementById("candidat-form"));
  const data=collectCandidatFormData();if(!data){candidatValidationLocks.delete(lockKey);setCandidatSectionButtonsDisabled(id,key,false);return}
  const creating=!c;
  const validationTarget=c||findCandidatById(data.id)||{id:realId,statut:"nouvelle",createdAt:today(),sectionValidations:{}};
  if(data.sectionValidations&&!validationTarget.sectionValidations)validationTarget.sectionValidations=data.sectionValidations;
  const requestedKey=key;
  const requestedIdx=candidatSectionIndex(requestedKey);
  const firstMissingBefore=requestedIdx>0?CANDIDAT_SECTIONS.slice(0,requestedIdx).find(s=>!candidatSectionIsValidated(validationTarget,s.key)):null;
  if(firstMissingBefore){
    setCandidatSectionButtonsDisabled(id,requestedKey,false);
    key=firstMissingBefore.key;
    setCandidatSectionButtonsDisabled(id,key,true);
    toast("Validation de la première section manquante : "+firstMissingBefore.label,"info");
  }
  if(!candidatPreviousSectionsValid(validationTarget,key)){
    const details=candidatPreviousSectionsBlockDetails(validationTarget,key,data);
    focusCandidatSectionToValidate(validationTarget,key);
    toast("Validez d'abord les sections précédentes"+(details?" : "+details:"")+". Cliquez sur « Valider la section ».","error");
    candidatValidationLocks.delete(lockKey);setCandidatSectionButtonsDisabled(id,key,false);return
  }
  if(!candidatSectionAvailable(validationTarget,key)){toast("Cette section n'est pas encore ouverte","error");candidatValidationLocks.delete(lockKey);setCandidatSectionButtonsDisabled(id,key,false);return}
  if(!validateCandidatSection(key,data)){candidatValidationLocks.delete(lockKey);setCandidatSectionButtonsDisabled(id,key,false);return}
  if(!candidateHasMinimumData(data)){toast(candidateMinimumDataMessage(data),"error");candidatValidationLocks.delete(lockKey);setCandidatSectionButtonsDisabled(id,key,false);return}
  const sectionLabel=CANDIDAT_SECTIONS.find(s=>s.key===key)?.label||"cette section";
  if(!confirm(`Êtes-vous sûr de vouloir valider la section « ${sectionLabel} » ?`)){
    candidatValidationLocks.delete(lockKey);
    setCandidatSectionButtonsDisabled(id,key,false);
    return;
  }
  const draft={...validationTarget,...data,id:realId};
  delete draft.isNew;
  let validation;
  try{
    if(key==="poste")await ensureCandidatePositionInCatalog(draft);
    validation=await SGDI.rh.validateCandidateSection(candidateApiPayload(draft),key,sqlBackendId(draft.backendId));
    draft.sectionValidations={...(draft.sectionValidations||{}),...(validation.data?.sectionValidations||{})};
    draft.sectionValidations[key]=draft.sectionValidations[key]||{by:session?.username||"system",at:new Date().toISOString(),source:"frontend-confirmed"};
  }catch(e){
    toast("Validation backend refusée : "+(e.message||e),"error");
    candidatValidationLocks.delete(lockKey);setCandidatSectionButtonsDisabled(id,key,false);return
  }
  draft.sectionValidations={...(draft.sectionValidations||{}),...(validation.data?.sectionValidations||{})};
  draft.sectionValidations[key]=draft.sectionValidations[key]||{by:session?.username||"system",at:new Date().toISOString(),source:"frontend-confirmed"};
  if((data.reserveDirect==="1"||draft.reserveDirect)&&candidatAllSectionsValid(draft)){
    draft.reserveDirect=true;
    draft.statut="reserve";
    draft.fichePositionValidee=true;
    draft.fichePositionValideeAt=draft.fichePositionValideeAt||new Date().toISOString();
    draft.fichePositionValideeBy=draft.fichePositionValideeBy||session?.username||"system";
  }else{
    draft.statut="nouvelle";
    draft.fichePositionValidee=false;
    delete draft.fichePositionValideeAt;
    delete draft.fichePositionValideeBy;
  }
  const next=CANDIDAT_SECTIONS[candidatSectionIndex(key)+1];
  try{
    await persistCandidateToPostgres(draft,{allowCreate:creating});
    if(c)Object.assign(c,draft);else{c=draft;if(!db.candidats.some(x=>x===c||String(x.id)===String(c.id)||String(x.backendId||"")===String(c.backendId||"")))db.candidats.push(c)}
    stashCandidatForRoute(c,[id,realId,data.id]);
    sgdiDirty=false;
    toast(next?"Section validée. Passage à la section suivante.":"Toutes les sections sont validées.","success");
    if(next)sessionStorage.setItem("candidatFocusSection",next.key);
    if((location.hash||"").endsWith("/nouveau"))navigate((c.reserveDirect?"reserve/":"recrutement/")+c.id);else renderView();
  }catch(e){toast("Validation refusée : "+(e.message||e),"error");setCandidatSectionButtonsDisabled(id,key,false)}
  finally{candidatValidationLocks.delete(lockKey)}
}

function unlockCandidatSection(id,key){
  if(!candidatCanUnlockSections()){toast("Déverrouillage réservé à l'administrateur habilité","error");return}
  const c=findCandidatById(id);if(!c)return;
  const idx=candidatSectionIndex(key);
  const locks=candidatSectionValidations(c);
  CANDIDAT_SECTIONS.slice(idx).forEach(s=>delete locks[s.key]);
  sessionStorage.setItem("candidatFocusSection",key);
  saveDB();toast("Section déverrouillée. Les sections suivantes devront être revalidées.","success");renderView();
}

function setCandidatFinalValidationButtonsDisabled(id,disabled){
  document.querySelectorAll(`button[onclick="validerFichePosition('${CSS.escape(String(id||""))}')"]`).forEach(btn=>{
    btn.disabled=!!disabled;
    if(disabled){
      btn.dataset.originalText=btn.dataset.originalText||btn.textContent;
      btn.textContent="Validation...";
    }else if(btn.dataset.originalText){
      btn.textContent=btn.dataset.originalText;
      delete btn.dataset.originalText;
    }
  });
}

function validerFichePosition(id){
  openModal(`<div class="text-center p-2"><h3 class="font-black text-lg mb-3">Valider la fiche candidat</h3><p class="text-sm text-slate-700 mb-5">Êtes-vous sûr de vouloir valider définitivement cette fiche candidat ?</p><div class="flex justify-center gap-3"><button type="button" class="btn btn-ghost" onclick="closeModal()">Non</button><button type="button" class="btn btn-primary" onclick="openCandidateValidationPassword('${jsString(id)}')">Oui</button></div></div>`);
}

function openCandidateValidationPassword(id){
  openModal(`<h3 class="font-black text-lg mb-2">Mot de passe de validation</h3><p class="text-sm text-slate-600 mb-4">Saisissez le mot de passe de validation personnel reçu par email lors de la création de votre compte.</p><form onsubmit="event.preventDefault();executeCandidateFinalValidation('${jsString(id)}',this)"><label class="label">Mot de passe de validation *</label><input class="input" type="password" name="validationPassword" autocomplete="current-password" required autofocus/><div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Confirmer la validation</button></div></form>`);
  setTimeout(()=>document.querySelector('.modal-bg [name="validationPassword"]')?.focus(),0);
}

async function executeCandidateFinalValidation(id,form){
  const validationPassword=String(new FormData(form).get("validationPassword")||"");
  if(!validationPassword){toast("Mot de passe de validation obligatoire","error");return}
  const lockKey=String(id||"");
  if(candidatFinalValidationLocks.has(lockKey)){toast("Validation déjà en cours, veuillez patienter","warning");return}
  candidatFinalValidationLocks.add(lockKey);
  setCandidatFinalValidationButtonsDisabled(id,true);
  const submitButton=form?.querySelector('button[type="submit"],button:not([type])');if(submitButton)submitButton.disabled=true;
  try{
    const c=await saveCandidat(id,false,{requireIdentification:true,skipPull:true});if(!c)return;
    if(!candidatAllSectionsValid(c)){toast("Impossible de valider la fiche : toutes les sections doivent être validées","error");renderView();return}
    if(!sqlBackendId(c.backendId))await persistCandidateToPostgres(c,{allowCreate:true});
    const backendId=sqlBackendId(c.backendId);
    if(!backendId)throw new Error("Identifiant backend candidat introuvable");
    const finalAction=await SGDI.rh.validateCandidateFinal(backendId,validationPassword);
    const saved=finalAction&&finalAction.status==="success"?finalAction.data:finalAction;
    if(!saved||!saved.id)throw new Error("Confirmation backend finale invalide");
    Object.assign(c,candidateFromApi(saved));
    stashCandidatForRoute(c,[id,c.id,c.backendId]);
    closeModal();
    toast("✓ Fiche de position validée — candidat en réserve","success");navigate("reserve");
  }catch(e){toast("Validation fiche refusée : "+(e.message||e),"error")}
  finally{candidatFinalValidationLocks.delete(lockKey);setCandidatFinalValidationButtonsDisabled(id,false);if(submitButton)submitButton.disabled=false}
}

function presselectionner(id){validateCandidatSectionAction(id,candidatCurrentSectionKey(findCandidatById(id)||{sectionValidations:{}})||"identification")}

function validerVersContrat(id){validerFichePosition(id)}

function mettreEnReserve(id){validerFichePosition(id)}

SGDIModules.registerModule({key: "recruitment-actions", routes: [], dependencies: [], init: function(){}, destroy: function(){}});
