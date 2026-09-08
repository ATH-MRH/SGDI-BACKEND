/* ==========================================================================
   SGDI — Module SECRÉTARIAT GÉNÉRAL (extrait de sgdi-app.js — Phase 2A pilote)
   --------------------------------------------------------------------------
   Script classique (pas de module ES) : ses fonctions top-level restent
   GLOBALES (compatibilité onclick / appels legacy). Aucun changement métier,
   aucune API modifiée — le code est déplacé tel quel.

   Chargé à la demande par le registre à l'ouverture de la route /secretariat
   (voir SGDIModules.MODULE_ROUTES). Dépendances (toutes dans le monolithe,
   chargé avant) : escapeHTML, formatDate, today, uid, toast, openModal,
   closeModal, renderView, renderSidebar, navigate, sgdiApi, sgdiAuthToken,
   saveDBAndWaitToast, secretariatCanAccess, canAccessStructureKey,
   currentStructureSocieteFilter, normalizeSocieteName, syncMissionWorkflowCollections,
   dcMissionStatusLabel, opsMissionDocumentHTML (optionnel), renderAgenda,
   renderDocumentsArchives, renderDemandesStructure, db, session.
   ========================================================================== */
function secretariatScopedItems(list){
  const soc=currentStructureSocieteFilter();
  return (list||[]).filter(x=>!soc||normalizeSocieteName(x.societe||"")===normalizeSocieteName(soc));
}
function renderSecretariat(view,sub,arg){
  if(!canAccessStructureKey("secretariat")){view.innerHTML=`<div class="card p-6">🔐 Accès refusé</div>`;return}
  const accessSection=sub||"dashboard";
  if(!secretariatCanAccess(accessSection,"read")){view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700 mb-2">Accès SG non autorisé</h2><p class="text-slate-600">Cette rubrique n’est pas activée dans votre profil d’accès. Contactez l’Administration système.</p></div>`;return}
  if(!db.secretariatCourriers)db.secretariatCourriers=[];
  if(!db.secretariatNotes)db.secretariatNotes=[];
  const soc=currentStructureSocieteFilter();
  const courriers=secretariatScopedItems(db.secretariatCourriers);
  const notes=secretariatScopedItems(db.secretariatNotes);
  const archives=courriers.filter(c=>c.archive||c.statut==="archive");
  const ouverts=courriers.filter(c=>!c.archive&&c.statut!=="archive");
  const missions=secretariatScopedItems(db.missions||[]).filter(m=>["transmise_sg","validee_sg","executee","paiement_en_attente","cloturee"].includes(m.workflowStatus));
  const missionsPending=missions.filter(m=>m.workflowStatus==="transmise_sg");
  const reunions=secretariatScopedItems(db.secretariatReunions||[]);
  const decisions=secretariatScopedItems(db.secretariatDecisions||[]);
  const card=(label,value,route,color)=>`<a href="#/${route}" class="card p-4 block kpi-clickable" style="text-decoration:none;color:inherit;border:1px solid ${color}44"><div class="text-xs uppercase font-black text-slate-500">${label}</div><div class="text-3xl font-black mt-1" style="color:${color}">${value}</div></a>`;
  if(sub==="courriers")return renderSecretariatList(view,"Courriers",courriers);
  if(sub==="notes")return renderSecretariatList(view,"Notes internes",notes);
  if(sub==="parapheur")return renderSecretariatParapheur(view,missionsPending,ouverts);
  if(sub==="missions"){
    renderSecretariatMissions(view,missions);
    if(sgdiAuthToken())syncMissionWorkflowCollections(["missions"]).then(()=>{
      if(!document.body.contains(view)||!/secretariat\/missions/.test(location.hash))return;
      const refreshed=secretariatScopedItems(db.missions||[]).filter(m=>["transmise_sg","validee_sg","executee","paiement_en_attente","cloturee"].includes(m.workflowStatus));
      renderSecretariatMissions(view,refreshed);
      renderSidebar();
    }).catch(e=>{console.warn("Synchronisation des ordres de mission SG indisponible",e);toast("Ordres de mission SG non synchronisés : "+(e.message||e),"warning")});
    return;
  }
  if(sub==="agenda")return renderAgenda(view,"dashboard",arg);
  if(sub==="reunions")return renderSecretariatRegistry(view,"Réunions et procès-verbaux",reunions,"reunion");
  if(sub==="decisions")return renderSecretariatRegistry(view,"Registre des décisions",decisions,"decision");
  if(sub==="documents")return renderDocumentsArchives(view,"archives",arg);
  if(sub==="messagerie")return renderDemandesStructure(view,"dashboard",arg);
  if(sub==="historique")return renderSecretariatHistory(view);
  if(sub==="archives"){
    renderSecretariatArchives(view,archives,secretariatScopedItems(db.secretariatArchives||[]));
    if(sgdiAuthToken())syncMissionWorkflowCollections(["secretariatArchives"]).then(()=>{
      if(!document.body.contains(view)||!/secretariat\/archives/.test(location.hash))return;
      renderSecretariatArchives(view,archives,secretariatScopedItems(db.secretariatArchives||[]));
    }).catch(e=>{console.warn("Synchronisation des archives SG indisponible",e);toast("Archives SG non synchronisées : "+(e.message||e),"warning")});
    return;
  }
  view.innerHTML=`<div class="flex items-start justify-between gap-3 mb-5 flex-wrap"><div><h1 class="text-2xl font-black uppercase">SECRÉTARIAT GÉNÉRAL</h1><p class="text-sm text-slate-500">Circulation, contrôle, validation et archivage des documents officiels${soc?` · ${escapeHTML(soc)}`:""}.</p></div>${secretariatCanAccess("courriers","create")?`<button class="btn btn-secondary" onclick="openSecretariatCourrierModal()">＋ Nouveau courrier</button>`:""}</div>
  <div class="grid grid-4 gap-3 mb-5">${card("À traiter",ouverts.length,"secretariat/courriers","#f59e0b")}${card("Parapheur",missionsPending.length+ouverts.length,"secretariat/parapheur","#7c3aed")}${card("Ordres de mission",missionsPending.length,"secretariat/missions","#043970")}${card("Décisions en cours",decisions.filter(d=>d.statut!=="cloturee").length,"secretariat/decisions","#0f766e")}</div>
  <div class="grid grid-2 gap-4"><div class="card p-5"><div class="flex items-center justify-between mb-3"><h3 class="font-black">Derniers courriers</h3><span class="pill">${courriers.length} élément(s)</span></div>${secretariatTableHTML(courriers.slice(0,6))}</div><div class="card p-5"><div class="flex items-center justify-between mb-3"><h3 class="font-black">Échéances institutionnelles</h3><span class="pill pill-blue">${reunions.length} réunion(s)</span></div>${reunions.length?reunions.slice(0,6).map(r=>`<div style="padding:10px 0;border-bottom:1px solid #e2e8f0"><b>${escapeHTML(r.objet||"Réunion")}</b><div class="text-xs text-slate-500">${formatDate(r.date)} · ${escapeHTML(r.lieu||"Lieu à préciser")}</div></div>`).join(""):`<div class="text-sm text-slate-400 p-5 text-center">Aucune réunion programmée.</div>`}</div></div>`;
}

function secretariatPageHeader(title,subtitle,action=""){
  return `<div class="flex items-start justify-between gap-3 mb-5 flex-wrap"><div><h1 class="text-2xl font-black uppercase">${escapeHTML(title)}</h1><p class="text-sm text-slate-500">${escapeHTML(subtitle)}</p></div>${action}</div>`;
}
function renderSecretariatParapheur(view,missions,courriers){
  const rows=[...missions.map(m=>({type:"Ordre de mission",ref:m.numero,objet:m.objet||m.motif,date:m.opsOrderValidatedAt||m.updatedAt,status:"À valider SG",action:`<button class="btn btn-primary text-xs" onclick="secretariatExamineMission('${escapeHTML(m.id)}')">Examiner</button>`})),...courriers.map(c=>({type:"Courrier",ref:c.ref,objet:c.objet,date:c.date,status:c.statut||"En cours",action:`<button class="btn btn-ghost text-xs" onclick="navigate('secretariat/courriers')">Ouvrir</button>`}))];
  view.innerHTML=secretariatPageHeader("Parapheur électronique","Documents à vérifier, valider, signer ou retourner.")+`<div class="card p-0 overflow-x-auto"><table><thead><tr><th>Type</th><th>Référence</th><th>Objet</th><th>Reçu le</th><th>État</th><th></th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td class="font-bold">${escapeHTML(r.type)}</td><td class="font-mono text-xs">${escapeHTML(r.ref||"—")}</td><td>${escapeHTML(r.objet||"—")}</td><td class="text-xs">${formatDate(r.date)}</td><td><span class="pill pill-amber">${escapeHTML(r.status)}</span></td><td>${r.action}</td></tr>`).join(""):`<tr><td colspan="6" class="p-8 text-center text-slate-400">Parapheur à jour.</td></tr>`}</tbody></table></div>`;
}
function renderSecretariatMissions(view,missions){
  view.innerHTML=secretariatPageHeader("Ordres de mission","Contrôle SG des ordres préparés et validés par OPS.")+`<div class="card p-0 overflow-x-auto"><table><thead><tr><th>Référence</th><th>Missionnaire</th><th>Objet / lieu</th><th>Période</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${missions.length?missions.map(m=>`<tr><td class="font-mono text-xs font-bold">${escapeHTML(m.numero||"—")}</td><td class="font-bold">${escapeHTML(m.agentName||"À désigner")}</td><td><b>${escapeHTML(m.objet||m.motif||"—")}</b><div class="text-xs text-slate-500">${escapeHTML(m.lieu||"—")}</div></td><td class="text-xs">${formatDate(m.dateDebut)} → ${formatDate(m.dateFin)}</td><td><span class="pill ${m.workflowStatus==="transmise_sg"?"pill-amber":"pill-green"}">${escapeHTML(dcMissionStatusLabel(m))}</span></td><td><div class="flex gap-2 flex-wrap"><button class="btn btn-ghost text-xs" onclick="secretariatExamineMission('${escapeHTML(m.id)}')">Aperçu</button>${m.workflowStatus==="transmise_sg"&&secretariatCanAccess("missions","validate")?`<button class="btn btn-primary text-xs" onclick="secretariatValidateMission('${escapeHTML(m.id)}')">Valider SG</button>`:""}</div></td></tr>`).join(""):`<tr><td colspan="6" class="p-8 text-center text-slate-400">Aucun ordre de mission transmis par OPS.</td></tr>`}</tbody></table></div>`;
}
let secretariatMissionPreviewUrl="";
function secretariatMissionDocumentPreviewHTML(mission){
  const raw=typeof opsMissionDocumentHTML==="function"?opsMissionDocumentHTML(mission):`<!doctype html><html><body><h1>${escapeHTML(mission.numero||"Ordre de mission")}</h1></body></html>`;
  const parsed=new DOMParser().parseFromString(raw,"text/html");
  parsed.querySelectorAll(".sgdi-doc-sign-controls,script").forEach(node=>node.remove());
  return "<!doctype html>\n"+parsed.documentElement.outerHTML;
}
function secretariatExamineMission(id){
  const mission=(db.missions||[]).find(m=>String(m.id)===String(id));
  if(!mission){toast("Ordre de mission introuvable","error");return}
  if(secretariatMissionPreviewUrl)URL.revokeObjectURL(secretariatMissionPreviewUrl);
  secretariatMissionPreviewUrl=URL.createObjectURL(new Blob([secretariatMissionDocumentPreviewHTML(mission)],{type:"text/html;charset=utf-8"}));
  const canValidate=mission.workflowStatus==="transmise_sg"&&secretariatCanAccess("missions","validate");
  openModal(`<div class="archive-a4-viewer"><div class="archive-a4-toolbar"><div><h3>${escapeHTML(mission.numero||"Ordre de mission")}</h3><p>Document reçu d’OPS · affichage direct</p></div><div class="archive-a4-actions">${canValidate?`<button type="button" class="btn btn-primary" onclick="secretariatValidateMission('${escapeHTML(mission.id)}')">Valider SG</button>`:""}<button type="button" class="btn btn-secondary" onclick="secretariatPrintMission('${escapeHTML(mission.id)}')">Imprimer</button><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button></div></div><div class="archive-a4-stage"><iframe id="secretariat-mission-preview" class="archive-a4-frame" title="${escapeHTML(mission.numero||"Ordre de mission")}"></iframe></div></div>`);
  document.querySelector("#modal-host .modal")?.classList.add("archive-a4-modal");
  const frame=document.getElementById("secretariat-mission-preview");
  if(frame)frame.src=secretariatMissionPreviewUrl;
}
function secretariatPrintMission(id){
  const mission=(db.missions||[]).find(m=>String(m.id)===String(id));if(!mission)return;
  const popup=window.open("","_blank","width=900,height=700");if(!popup){toast("Fenêtre d’aperçu bloquée","error");return}
  popup.document.write(typeof opsMissionDocumentHTML==="function"?opsMissionDocumentHTML(mission):`<h1>${escapeHTML(mission.numero||"Ordre de mission")}</h1>`);popup.document.close();
}
async function secretariatValidateMission(id){
  if(!secretariatCanAccess("missions","validate")){toast("Validation réservée au profil Responsable SG","error");return}
  const mission=(db.missions||[]).find(m=>String(m.id)===String(id));if(!mission||mission.workflowStatus!=="transmise_sg")return;
  if(!confirm("Valider cet ordre de mission et le transmettre à Finance / Caisse ?"))return;
  const now=new Date().toISOString(),updated={...mission,workflowStatus:"validee_sg",sgValidatedAt:now,sgValidatedBy:session?.username||"SG",updatedAt:now,audit:[...(mission.audit||[]),{action:"Ordre de mission contrôlé et validé par SG",at:now,by:session?.username||"SG"}]};
  const request={id:uid("mission_expense"),missionId:mission.id,missionNumber:mission.numero,societe:mission.societe,agentId:mission.agentId||"",agentName:mission.agentName||"",objet:mission.objet||mission.motif||"",dateDebut:mission.dateDebut,dateFin:mission.dateFin,status:"a_calculer",source:"secretariat",createdAt:now};
  try{await sgdiApi("/api/irongs/collections/missions/items/"+encodeURIComponent(mission.id),{method:"PATCH",body:{data:updated},legacy:false});await sgdiApi("/api/irongs/collections/missionExpenseRequests/items",{method:"POST",body:{data:request},legacy:false})}catch(e){toast("Validation SG non transmise : "+(e.message||e),"error");return}
  Object.assign(mission,updated);db.missionExpenseRequests=db.missionExpenseRequests||[];db.missionExpenseRequests.unshift(request);toast("Ordre validé et transmis à Finance / Caisse","success");renderView();
}
function secretariatTableHTML(items){
  return `<div class="overflow-x-auto"><table><thead><tr><th>Référence</th><th>Date</th><th>Objet</th><th>Origine / Destinataire</th><th>Statut</th></tr></thead><tbody>${items.length?items.map(c=>`<tr data-searchable><td class="font-mono text-xs font-bold">${escapeHTML(c.ref||"—")}</td><td class="text-xs">${formatDate(c.date||c.createdAt)}</td><td class="font-semibold">${escapeHTML(c.objet||"—")}</td><td class="text-xs">${escapeHTML(c.tiers||"—")}</td><td><span class="pill ${c.archive||c.statut==="archive"?"pill-gray":"pill-blue"}">${escapeHTML(c.statut||"en cours")}</span></td></tr>`).join(""):`<tr><td colspan="5" class="text-center text-slate-500 p-6">Aucun élément enregistré.</td></tr>`}</tbody></table></div>`;
}
function renderSecretariatList(view,title,items){
  view.innerHTML=`<div class="flex items-center justify-between gap-3 mb-5 flex-wrap"><div><h1 class="text-2xl font-black uppercase">${escapeHTML(title)}</h1><p class="text-sm text-slate-500">Module Secretariat Général.</p></div><button class="btn btn-secondary" onclick="navigate('secretariat/dashboard')">← Tableau de bord</button></div><div class="card p-5">${secretariatTableHTML(items)}</div>`;
}
function renderSecretariatArchives(view,courriers,documents){
  const rows=(documents||[]).slice().sort((a,b)=>String(b.archivedAt||b.updatedAt||"").localeCompare(String(a.archivedAt||a.updatedAt||"")));
  view.innerHTML=secretariatPageHeader("Archives","Documents officiels validés et conservés par le Secrétariat général.")+`
    <div class="card p-0 overflow-x-auto"><table><thead><tr><th>Référence</th><th>Document</th><th>Missionnaire</th><th>Date</th><th>Origine</th><th>Archivé par</th><th>Actions</th></tr></thead><tbody>
      ${rows.map(item=>`<tr><td class="font-mono text-xs font-bold">${escapeHTML(item.reference||"—")}</td><td><b>${escapeHTML(item.title||"Document officiel")}</b><div class="text-xs text-slate-500">${escapeHTML(item.category||item.type||"Archive SG")}</div></td><td>${escapeHTML(item.agentName||"—")}</td><td class="text-xs">${formatDate(item.date||item.archivedAt)}</td><td>${escapeHTML(item.source||"—")}</td><td>${escapeHTML(item.archivedBy||"—")}</td><td><button type="button" class="btn btn-primary text-xs" onclick="openSecretariatArchivedDocument('${escapeHTML(item.id)}')">Ouvrir</button></td></tr>`).join("")}
      ${(courriers||[]).map(c=>`<tr><td class="font-mono text-xs font-bold">${escapeHTML(c.ref||"—")}</td><td><b>${escapeHTML(c.objet||"Courrier")}</b><div class="text-xs text-slate-500">Courrier archivé</div></td><td>—</td><td class="text-xs">${formatDate(c.date||c.createdAt)}</td><td>${escapeHTML(c.tiers||"—")}</td><td>${escapeHTML(c.createdBy||"—")}</td><td>—</td></tr>`).join("")}
      ${!rows.length&&!(courriers||[]).length?`<tr><td colspan="7" class="p-8 text-center text-slate-400">Aucune archive SG enregistrée.</td></tr>`:""}
    </tbody></table></div>`;
}
function openSecretariatArchivedDocument(id){
  const item=(db.secretariatArchives||[]).find(x=>String(x.id)===String(id));
  if(!item||!item.html){toast("Document archivé introuvable","error");return}
  const popup=window.open("","_blank","width=900,height=700");
  if(!popup){toast("Fenêtre d’archive bloquée par le navigateur","error");return}
  popup.document.write(String(item.html));popup.document.close();
}
function renderSecretariatRegistry(view,title,items,type){
  const isDecision=type==="decision";
  const section=isDecision?"decisions":"reunions",action=secretariatCanAccess(section,"create")?`<button class="btn btn-primary" onclick="openSecretariatRegistryModal('${type}')">＋ ${isDecision?"Nouvelle décision":"Nouvelle réunion"}</button>`:"";
  view.innerHTML=secretariatPageHeader(title,isDecision?"Suivi des décisions, responsables et échéances.":"Planification des réunions, ordres du jour et procès-verbaux.",action)+`<div class="card p-0 overflow-x-auto"><table><thead><tr><th>Référence</th><th>${isDecision?"Décision":"Objet"}</th><th>${isDecision?"Responsable":"Date / lieu"}</th><th>Échéance</th><th>Statut</th></tr></thead><tbody>${items.length?items.map(item=>`<tr><td class="font-mono text-xs font-bold">${escapeHTML(item.ref||"—")}</td><td class="font-bold">${escapeHTML(item.objet||"—")}</td><td>${escapeHTML(isDecision?(item.responsable||"—"):(`${formatDate(item.date)} · ${item.lieu||"—"}`))}</td><td class="text-xs">${formatDate(item.echeance||item.date)}</td><td><span class="pill pill-blue">${escapeHTML(item.statut||"planifiee")}</span></td></tr>`).join(""):`<tr><td colspan="5" class="p-8 text-center text-slate-400">Aucun élément enregistré.</td></tr>`}</tbody></table></div>`;
}
function openSecretariatRegistryModal(type){
  const isDecision=type==="decision",prefix=isDecision?"DEC":"PV";
  if(!secretariatCanAccess(isDecision?"decisions":"reunions","create")){toast("Création non autorisée par votre profil SG","error");return}
  openModal(`<h3 class="font-bold text-lg mb-3">${isDecision?"Nouvelle décision":"Nouvelle réunion"}</h3><form onsubmit="event.preventDefault();saveSecretariatRegistry(this,'${type}')"><div class="grid grid-cols-1 md:grid-cols-2 gap-3"><div><label class="label">Référence</label><input class="input" name="ref" value="${prefix}-${new Date().getFullYear()}-${String(Math.floor(Math.random()*9000+1000))}"/></div><div><label class="label">Date</label><input class="input" type="date" name="date" value="${today()}"/></div><div class="md:col-span-2"><label class="label">${isDecision?"Décision":"Objet de la réunion"}</label><input class="input" name="objet" required/></div><div><label class="label">${isDecision?"Responsable d’exécution":"Lieu"}</label><input class="input" name="responsable"/></div><div><label class="label">Échéance</label><input class="input" type="date" name="echeance"/></div><div class="md:col-span-2"><label class="label">${isDecision?"Instructions":"Ordre du jour / procès-verbal"}</label><textarea class="input" name="details" rows="4"></textarea></div></div><div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer</button></div></form>`);
}
async function saveSecretariatRegistry(form,type){
  const fd=new FormData(form),isDecision=type==="decision",key=isDecision?"secretariatDecisions":"secretariatReunions";db[key]=db[key]||[];
  db[key].unshift({id:uid(isDecision?"decision":"reunion"),ref:String(fd.get("ref")||"").trim(),objet:String(fd.get("objet")||"").trim(),date:fd.get("date")||today(),lieu:isDecision?"":String(fd.get("responsable")||"").trim(),responsable:isDecision?String(fd.get("responsable")||"").trim():"",echeance:fd.get("echeance")||"",details:String(fd.get("details")||"").trim(),statut:isDecision?"a_executer":"planifiee",societe:currentStructureSocieteFilter()||session?.societe||"",createdAt:new Date().toISOString(),createdBy:session?.username||"SG"});
  if(!(await saveDBAndWaitToast("Enregistrement SG non confirmé")))return;closeModal();toast(isDecision?"Décision enregistrée":"Réunion enregistrée","success");renderView();
}
function renderSecretariatHistory(view){
  const rows=[];(db.missions||[]).forEach(m=>(m.audit||[]).forEach(a=>rows.push({...a,ref:m.numero||"Mission",type:"Ordre de mission"})));
  (db.secretariatCourriers||[]).forEach(c=>rows.push({at:c.createdAt,by:c.createdBy,action:"Courrier enregistré",ref:c.ref,type:"Courrier"}));rows.sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
  view.innerHTML=secretariatPageHeader("Historique","Traçabilité horodatée des opérations du Secrétariat Général.")+`<div class="card p-0 overflow-x-auto"><table><thead><tr><th>Date</th><th>Type</th><th>Référence</th><th>Action</th><th>Utilisateur</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td class="text-xs">${r.at?new Date(r.at).toLocaleString("fr-DZ"):"—"}</td><td>${escapeHTML(r.type||"—")}</td><td class="font-mono text-xs">${escapeHTML(r.ref||"—")}</td><td>${escapeHTML(r.action||"—")}</td><td class="font-bold">${escapeHTML(r.by||"—")}</td></tr>`).join(""):`<tr><td colspan="5" class="p-8 text-center text-slate-400">Aucun historique.</td></tr>`}</tbody></table></div>`;
}
window.secretariatExamineMission=secretariatExamineMission;window.secretariatPrintMission=secretariatPrintMission;window.secretariatValidateMission=secretariatValidateMission;window.openSecretariatRegistryModal=openSecretariatRegistryModal;window.saveSecretariatRegistry=saveSecretariatRegistry;
function openSecretariatCourrierModal(){
  if(!secretariatCanAccess("courriers","create")){toast("Création de courrier non autorisée par votre profil SG","error");return}
  openModal(`<h3 class="font-bold text-lg mb-3">Nouveau courrier</h3><form onsubmit="event.preventDefault();saveSecretariatCourrier(this)"><div class="grid grid-cols-1 md:grid-cols-2 gap-3"><div><label class="label">Référence</label><input class="input" name="ref" value="SEC-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${Math.floor(Math.random()*9000+1000)}"/></div><div><label class="label">Date</label><input class="input" type="date" name="date" value="${today()}"/></div><div class="md:col-span-2"><label class="label">Objet</label><input class="input" name="objet" required/></div><div class="md:col-span-2"><label class="label">Origine / Destinataire</label><input class="input" name="tiers"/></div><div class="md:col-span-2"><label class="label">Observation</label><textarea class="input" name="note" rows="3"></textarea></div></div><div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer</button></div></form>`);
}
async function saveSecretariatCourrier(form){
  if(!db.secretariatCourriers)db.secretariatCourriers=[];
  const fd=new FormData(form);
  db.secretariatCourriers.unshift({id:uid("sec"),ref:String(fd.get("ref")||"").trim(),date:fd.get("date")||today(),objet:String(fd.get("objet")||"").trim(),tiers:String(fd.get("tiers")||"").trim(),note:String(fd.get("note")||"").trim(),societe:currentStructureSocieteFilter()||session?.societe||"",statut:"en cours",createdAt:new Date().toISOString(),createdBy:session?.username||""});
  if(!(await saveDBAndWaitToast("Courrier secrétariat non confirmé")))return;
  closeModal();toast("Courrier enregistré","success");renderView();
}


/* --- Enregistrement dans le registre de modules (Phase 2A) --- */
(function () {
  if (window.SGDIModules && typeof window.SGDIModules.registerModule === "function") {
    window.SGDIModules.registerModule({
      key: "secretariat",
      routes: ["secretariat"],
      // Les fonctions sont déjà globales dès le chargement du script : rien à
      // initialiser. Pas de timer ni de listener propre au module -> destroy vide.
      init: function () {},
      destroy: function () {}
    });
  }
})();
