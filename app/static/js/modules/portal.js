/* Phase 2 — portal. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2h-inventory.json. */
function demandePersonnelCurrentAgent(){
  if(session?.agentId)return (db.agents||[]).find(a=>a.id===session.agentId)||null;
  const name=(session?.nom||"").toLowerCase().trim();
  return (db.agents||[]).find(a=>((a.nom||"")+" "+(a.prenom||"")).toLowerCase().trim()===name)||null;
}

function demandePersonnelSlaInfo(d){
  if(!d||["traite","rejete","annule"].includes(d.statut))return null;
  const start=new Date(d.createdAt||d.date||Date.now()).getTime();
  const deadline=d.deadlineAt?new Date(d.deadlineAt).getTime():start+48*3600000;
  const left=Math.round((deadline-Date.now())/3600000),late=left<0;
  return{late,label:late?`Retard ${Math.abs(left)} h`:left<24?`${left} h restantes`:`${Math.ceil(left/24)} j restants`};
}

function demandePersonnelFileInputHTML(){
  return`<input class="input" type="file" name="piece" accept="image/*,.pdf,.doc,.docx" onchange="const f=this.files&&this.files[0];const n=this.closest('form').querySelector('[data-file-name]');if(n)n.textContent=f?f.name:'Aucun fichier choisi'"/><div class="text-xs text-slate-500 mt-1" data-file-name>Aucun fichier choisi</div>`;
}

function demandePersonnelEmployeeKey(d){
  const a=(db.agents||[]).find(x=>x.id===d.agentId);
  const matricule=(d.matricule||a?.matricule||"").trim();
  if(matricule)return "mat:"+matricule.toLowerCase();
  const name=(d.agentName||[a?.nom,a?.prenom].filter(Boolean).join(" ")||d.createdBy||"Sans employé").trim();
  return "nom:"+name.toLowerCase();
}

function demandePersonnelEmployeeLabel(d){
  const a=(db.agents||[]).find(x=>x.id===d.agentId);
  return (d.agentName||[a?.nom,a?.prenom].filter(Boolean).join(" ")||d.createdBy||"Sans employé").trim();
}

function groupDemandesPersonnelByEmployee(list){
  const map=new Map();
  (list||[]).forEach(d=>{
    const key=demandePersonnelEmployeeKey(d);
    if(!map.has(key)){
      const a=(db.agents||[]).find(x=>x.id===d.agentId);
      map.set(key,{key,name:demandePersonnelEmployeeLabel(d),matricule:d.matricule||a?.matricule||"",societe:demandePersonnelSociete(d)||"",site:d.site||a?.site||"",total:0,nouveau:0,enCours:0,traite:0,lastDate:"",lastType:"",items:[]});
    }
    const g=map.get(key);
    const st=d.statut||"nouveau";
    g.total+=1;
    if(st==="nouveau")g.nouveau+=1;
    if(st==="en_cours")g.enCours+=1;
    if(st==="traite")g.traite+=1;
    const dt=d.createdAt||d.date||"";
    if(!g.lastDate||String(dt).localeCompare(String(g.lastDate))>0){g.lastDate=dt;g.lastType=demandePersonnelTypeLabel(d)}
    g.items.push(d);
  });
  return [...map.values()].sort((a,b)=>String(b.lastDate||"").localeCompare(String(a.lastDate||"")));
}

function openPortailEmployeHistory(key){
  const soc=isDrhModuleContext()?((sessionStorage.getItem("drhSociete")||"")):(sessionStorage.getItem("portalSociete")||"");
  let rows=portalDemandesPersonnel().filter(d=>demandePersonnelEmployeeKey(d)===key);
  if(soc)rows=rows.filter(d=>demandePersonnelSociete(d)===soc);
  rows.sort((x,y)=>String(y.createdAt||y.date||"").localeCompare(String(x.createdAt||x.date||"")));
  const first=rows[0]||{};
  const title=demandePersonnelEmployeeLabel(first);
  openModal(`<div class="flex items-start justify-between gap-3 mb-4">
    <div><h3 class="font-black text-xl">Historique par employé</h3><p class="text-sm text-slate-500">${escapeHTML(title)}${first.matricule?` · ${escapeHTML(first.matricule)}`:""}${first.societe?` · ${escapeHTML(first.societe)}`:""}</p></div>
    <button class="btn btn-ghost text-xs" onclick="closeModal()">Fermer</button>
  </div>
  <div class="grid grid-cols-3 gap-3 mb-4">
    <div class="card p-3"><div class="text-xs text-slate-500">Total</div><div class="text-2xl font-black">${rows.length}</div></div>
    <div class="card p-3"><div class="text-xs text-slate-500">En attente</div><div class="text-2xl font-black text-sky-700">${rows.filter(d=>["nouveau","en_cours"].includes(d.statut||"nouveau")).length}</div></div>
    <div class="card p-3"><div class="text-xs text-slate-500">Traitées</div><div class="text-2xl font-black text-emerald-700">${rows.filter(d=>d.statut==="traite").length}</div></div>
  </div>
  <div style="max-height:65vh;overflow:auto">${rows.length?rows.map(d=>demandePersonnelCardHTML(d,false)).join(""):`<div class="text-center text-slate-500 p-6">Aucune demande pour cet employé.</div>`}</div>`);
}

function renderPortailPersonnel(view){
  ensureDemandesPersonnel();
  refreshDemandesPersonnelFromPostgres({silent:true});
  if(canAccess("demandes_personnel")){
    const soc=isDrhModuleContext()?((sessionStorage.getItem("drhSociete")||"")):(sessionStorage.getItem("portalSociete")||"");
    const q=(sessionStorage.getItem("portal_q")||"").toLowerCase();
    const statut=sessionStorage.getItem("portal_statut")||"";
    const type=sessionStorage.getItem("portal_type")||"";
    let all=incomingPortalDemandesPersonnel().slice();
    if(soc)all=all.filter(d=>demandePersonnelSociete(d)===soc);
    const base=all.slice();
    if(statut)all=all.filter(d=>(d.statut||"nouveau")===statut);
    if(type)all=all.filter(d=>demandePersonnelTypeLabel(d)===type);
    if(q)all=all.filter(d=>[d.ref,d.id,d.agentName,d.matricule,d.societe,d.site,d.objet,d.message,demandePersonnelTypeLabel(d),d.source].join(" ").toLowerCase().includes(q));
    all.sort((x,y)=>String(y.createdAt||y.date||"").localeCompare(String(x.createdAt||x.date||"")));
    const employeeGroups=groupDemandesPersonnelByEmployee(all);
    const types=[...new Set(base.map(d=>demandePersonnelTypeLabel(d)).filter(Boolean))];
    view.innerHTML=`<div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
      <div><h1 class="text-2xl font-black uppercase">PORTAIL RH</h1><p class="text-sm text-slate-500">Module de réception et traitement des demandes, réclamations et documents envoyés depuis mobile${soc?` · ${escapeHTML(soc)}`:""}.</p></div>
      <div class="flex gap-2 flex-wrap">
        <button class="btn btn-primary text-sm" onclick="navigate('portail/comptes')">Gérer les comptes</button>
        <a class="btn btn-secondary text-sm" href="/portail-rh" target="_blank">Ouvrir mobile</a>
        <a class="btn btn-ghost text-sm" href="/portail-rh/acces" target="_blank">QR accès</a>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
      <div class="card p-4"><div class="text-xs text-slate-500">Total portail</div><div class="text-3xl font-black">${base.length}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Nouvelles</div><div class="text-3xl font-black text-sky-700">${base.filter(d=>(d.statut||"nouveau")==="nouveau").length}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">En cours</div><div class="text-3xl font-black text-amber-700">${base.filter(d=>d.statut==="en_cours").length}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Traitées</div><div class="text-3xl font-black text-emerald-700">${base.filter(d=>d.statut==="traite").length}</div></div>
    </div>
    <div class="card p-4 mb-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div><h3 class="font-black">Accès Portail RH</h3><p class="text-sm text-slate-500">Les agents ouvrent le portail depuis leur téléphone; SGDI reçoit les dossiers ici pour suivi RH.</p></div>
        <div class="flex gap-2 flex-wrap">
          <button class="btn btn-secondary text-sm" onclick="window.open('/portail-rh','_blank')">Formulaire mobile</button>
          <button class="btn btn-ghost text-sm" onclick="window.open('/portail-rh/acces','_blank')">Partager QR code</button>
          <button class="btn btn-ghost text-sm" onclick="navigate('demandes_personnel/dashboard')">Réception demandes</button>
        </div>
      </div>
    </div>
    <div class="card p-4 mb-4">
      <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
        <input class="input" placeholder="Recherche globale..." value="${escapeHTML(q)}" oninput="sessionStorage.setItem('portal_q',this.value);renderView()"/>
        <select class="select" onchange="sessionStorage.setItem('portal_statut',this.value);renderView()"><option value="">Tous statuts</option>${["nouveau","en_cours","traite","rejete"].map(s=>`<option value="${s}" ${statut===s?"selected":""}>${s}</option>`).join("")}</select>
        <select class="select" onchange="sessionStorage.setItem('portal_type',this.value);renderView()"><option value="">Tous types</option>${types.map(t=>`<option ${type===t?"selected":""}>${escapeHTML(t)}</option>`).join("")}</select>
        <select class="select" onchange="sessionStorage.setItem('portalSociete',this.value);renderView()"><option value="">Toutes sociétés</option>${SOCIETES.map(s=>`<option value="${escapeHTML(s)}" ${soc===s?"selected":""}>${escapeHTML(s)}</option>`).join("")}</select>
        <button class="btn btn-ghost" onclick="sessionStorage.removeItem('portal_q');sessionStorage.removeItem('portal_statut');sessionStorage.removeItem('portal_type');sessionStorage.removeItem('portalSociete');renderView()">Réinitialiser</button>
      </div>
    </div>
    <div class="card overflow-hidden">
      <table>
        <thead><tr><th>Employé</th><th>Société</th><th>Site</th><th>Total</th><th>Nouvelles</th><th>En cours</th><th>Traitées</th><th>Dernière demande</th><th></th></tr></thead>
        <tbody>${employeeGroups.length?employeeGroups.map(g=>`<tr data-searchable>
          <td><div class="font-semibold">${escapeHTML(g.name||"—")}</div><div class="text-xs text-slate-500">${escapeHTML(g.matricule||"Sans matricule")}</div></td>
          <td class="text-xs">${escapeHTML(g.societe||"—")}</td>
          <td class="text-xs">${escapeHTML(g.site||"—")}</td>
          <td><span class="pill pill-gray">${g.total}</span></td>
          <td><span class="pill pill-blue">${g.nouveau}</span></td>
          <td><span class="pill pill-amber">${g.enCours}</span></td>
          <td><span class="pill pill-green">${g.traite}</span></td>
          <td class="text-xs"><div>${formatDate(g.lastDate)}</div><div class="text-slate-500">${escapeHTML(g.lastType||"")}</div></td>
          <td class="text-right"><button class="btn btn-secondary text-xs" onclick="openPortailEmployeHistory('${jsString(g.key)}')">Voir historique</button></td>
        </tr>`).join(""):`<tr><td colspan="9" class="text-center text-slate-500 p-6">Aucun historique employé.</td></tr>`}</tbody>
      </table>
    </div>`;
    return;
  }
  const a=demandePersonnelCurrentAgent();
  const mine=portalDemandesPersonnel().filter(d=>session?.agentId?d.agentId===session.agentId:d.createdBy===session?.username).sort((x,y)=>String(y.createdAt).localeCompare(String(x.createdAt)));
  const docsDemandes=mine.filter(d=>(d.documentsDemandes||[]).some(x=>!x.recu));
  view.innerHTML=`<div class="max-w-4xl mx-auto">
    <div class="card p-5 mb-4" style="background:linear-gradient(135deg,#043970,#0360a8);color:white">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div><h1 class="text-2xl font-black">Portail RH personnel</h1><p class="text-sm" style="opacity:.9">Demandes, réclamations et envoi de documents depuis téléphone.</p></div>
        <div class="text-right text-sm"><div>${escapeHTML(a?((a.nom||"")+" "+(a.prenom||"")):(session?.nom||"Personnel"))}</div><div style="opacity:.85">${escapeHTML(a?.matricule||"")} ${a?.societe?"· "+escapeHTML(a.societe):""}</div></div>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      <div class="card p-4"><div class="text-xs text-slate-500">Mes demandes</div><div class="text-3xl font-black text-sky-700">${mine.length}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">En traitement</div><div class="text-3xl font-black text-amber-700">${mine.filter(d=>["nouveau","en_cours"].includes(d.statut)).length}</div></div>
      <div class="card p-4"><div class="text-xs text-slate-500">Documents attendus</div><div class="text-3xl font-black text-red-700">${docsDemandes.length}</div></div>
    </div>
    <div class="card p-5 mb-4">
      <h3 class="font-bold mb-3">Nouvelle demande / réclamation</h3>
      <form onsubmit="event.preventDefault();submitPortailPersonnel(this)">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label class="label">Type</label><select class="select" name="type"><option>Demande</option><option>Réclamation</option><option>Envoi document</option></select></div>
          <div><label class="label">Catégorie</label><select class="select" name="categorie"><option>Document administratif</option><option>Paie</option><option>Congé</option><option>Affectation</option><option>Matériel / dotation</option><option>Pointage</option><option>Autre</option></select></div>
          <div><label class="label">Urgence</label><select class="select" name="urgence"><option value="normale">Normale</option><option value="haute">Haute</option></select></div>
          <div><label class="label">Pièce jointe</label>${demandePersonnelFileInputHTML()}</div>
          <div class="md:col-span-2"><label class="label">Objet</label><input class="input" name="objet" placeholder="Objet de votre demande"/></div>
          <div class="md:col-span-2"><label class="label">Message</label><textarea class="textarea" name="message" rows="4" placeholder="Expliquez votre demande ou réclamation"></textarea></div>
        </div>
        <button class="btn btn-primary mt-4 w-full justify-center">Envoyer à la DRH</button>
      </form>
    </div>
    <div class="card p-5">
      <h3 class="font-bold mb-3">Historique et documents demandés</h3>
      ${mine.length?mine.map(d=>demandePersonnelCardHTML(d,true)).join(""):`<div class="text-sm text-slate-500 text-center p-6">Aucune demande envoyée.</div>`}
    </div>
  </div>`;
}

async function submitPortailPersonnel(form){
  try{
    const a=demandePersonnelCurrentAgent();
    const fd=new FormData(form);
    const piece=await readSmallFile(form.piece.files&&form.piece.files[0]);
    const d={id:uid("dp"),date:today(),createdAt:new Date().toISOString(),createdBy:session?.username||"",agentId:a?.id||session?.agentId||"",agentName:a?((a.nom||"")+" "+(a.prenom||"")).trim():(session?.nom||""),matricule:a?.matricule||"",societe:a?.societe||mySoc()||"",type:fd.get("type")||"Demande",categorie:fd.get("categorie")||"",urgence:fd.get("urgence")||"normale",objet:(fd.get("objet")||"").toString().trim(),message:(fd.get("message")||"").toString().trim(),statut:"nouveau",pieces:piece?[{...piece,source:"Employé"}]:[],documentsDemandes:[],historique:[{date:new Date().toISOString(),user:session?.username||"",action:"Création",note:"Demande envoyée via portail mobile"}]};
    ensureDemandesPersonnel().push(d);
    if(!(await saveDBAndWaitToast("Demande personnel non confirmée")))return;
    toast("Demande envoyée à la DRH","success");renderSidebar();renderView();
  }catch(e){toast(e.message||String(e),"error")}
}

function demandePersonnelCardHTML(d,personnel){
  const alert=demandePersonnelIsAlert(d);
  const docs=(d.documentsDemandes||[]);
  const sla=demandePersonnelSlaInfo(d);
  return`<div class="card p-4 mb-3" style="border-left:4px solid ${alert?"#dc2626":d.statut==="traite"?"#16a34a":"#0360a8"}">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div><div class="font-bold">${escapeHTML(d.objet||"Sans objet")}</div><div class="text-xs text-slate-500">${formatDate(d.date||d.createdAt)} · ${escapeHTML(d.type||"")} · ${escapeHTML(d.categorie||"")}</div></div>
      <div class="flex gap-2 items-center">${sla?`<span class="pill ${sla.late?"pill-red":"pill-gray"}">${escapeHTML(sla.label)}</span>`:""}${demandePersonnelStatusPill(d.statut)}${alert?`<span class="pill pill-red">Alerte</span>`:""}</div>
    </div>
    <div class="text-sm text-slate-700 mt-2">${escapeHTML(d.message||"")}</div>
    ${suspensionDemandStatusHTML(d)}
    ${d.reponse?`<div class="mt-3 p-3 rounded bg-emerald-50 text-sm text-emerald-800"><b>Réponse DRH :</b> ${escapeHTML(d.reponse)}</div>`:""}
    ${docs.length?`<div class="mt-3 text-sm"><b>Documents demandés :</b>${docs.map((x,i)=>`<div class="flex items-center justify-between gap-2 py-1 border-b border-slate-100"><span>${escapeHTML(x.nom||"Document")} ${x.recu?`<span class="pill pill-green">reçu</span>`:`<span class="pill pill-red">à envoyer</span>`}</span>${personnel&&!x.recu?`<button class="btn btn-secondary text-xs" onclick="openUploadDocumentDemande('${d.id}',${i})">Envoyer</button>`:""}</div>`).join("")}</div>`:""}
    ${(d.pieces||[]).length?`<div class="mt-3 flex gap-2 flex-wrap">${(d.pieces||[]).map((p,i)=>`<a class="btn btn-ghost text-xs" href="${p.data}" download="${escapeHTML(p.name||'document')}">${escapeHTML(p.source||"Employé")} · ${escapeHTML(p.name||`Pièce ${i+1}`)}</a>`).join("")}</div>`:""}
    ${!personnel?`<div class="mt-3 flex gap-2 flex-wrap">${suspensionDemandActionsHTML(d)}${convocationDemandActionsHTML(d)}<button class="btn btn-secondary text-xs" onclick="openTraiterDemandePersonnel('${d.id}')">Traiter</button><button class="btn btn-ghost text-xs" onclick="openDemanderDocumentPersonnel('${d.id}')">Demander document</button></div>`:""}
  </div>`;
}

function demandePersonnelTypeLabel(d){return d.typeLabel||d.type||d.categorie||"Demande"}

function demandePersonnelSelectedId(){return sessionStorage.getItem("demandePersonnelSelected")||""}

function selectDemandePersonnel(id){sessionStorage.setItem("demandePersonnelSelected",id||"");renderView()}

function selectDemandePersonnelEmployee(key){sessionStorage.setItem("demandePersonnelEmployeeSelected",key||"");renderView()}

function setDemandesPersonnelFilter(k,v){sessionStorage.setItem("dp_"+k,v||"");renderView()}

function setDemandesPersonnelSearch(value){
  sessionStorage.setItem("dp_q",value||"");
  clearTimeout(demandesPersonnelSearchTimer);
  demandesPersonnelSearchTimer=setTimeout(()=>renderView(),250);
}

function demandePersonnelDetailHTML(d){
  if(!d)return`<div class="dp-empty">Sélectionnez une demande pour voir le détail.</div>`;
  const original=d.payloadOriginal||{};
  const details=original.details&&typeof original.details==="object"?original.details:{};
  const docs=d.documentsDemandes||[];
  return`<div class="dp-detail-card">
    <div class="dp-detail-top">
      <div><div class="dp-detail-title">${escapeHTML(d.objet||demandePersonnelTypeLabel(d))}</div><div class="dp-detail-meta">Réf. ${escapeHTML(d.ref||d.id||"")} · ${formatDate(d.date||d.createdAt)}</div></div>
      ${demandePersonnelStatusPill(d.statut)}
    </div>
    <div class="dp-detail-grid">
      <div><div class="lbl">Demandeur</div><b>${escapeHTML(d.agentName||"—")}</b></div>
      <div><div class="lbl">Matricule</div><b>${escapeHTML(d.matricule||"—")}</b></div>
      <div><div class="lbl">Société</div><b>${escapeHTML(d.societe||"—")}</b></div>
      <div><div class="lbl">Site</div><b>${escapeHTML(d.site||"—")}</b></div>
    </div>
    <div class="dp-detail-message">${escapeHTML(d.message||"Aucun message.")}</div>
    ${suspensionDemandStatusHTML(d)}
    ${Object.keys(details).length?`<div class="dp-detail-section"><h4>Détails du portail</h4>${Object.entries(details).filter(([,v])=>v).map(([k,v])=>`<div class="flex justify-between gap-3 py-1 border-b border-slate-100 text-sm"><span class="text-slate-500">${escapeHTML(k)}</span><b class="text-right">${escapeHTML(String(v))}</b></div>`).join("")}</div>`:""}
    ${d.reponse?`<div class="dp-detail-reply"><b>Réponse DRH</b>${escapeHTML(d.reponse)}</div>`:""}
    ${docs.length?`<div class="dp-detail-section"><h4>Documents demandés</h4>${docs.map(x=>`<div class="flex justify-between py-1 border-b text-sm"><span>${escapeHTML(x.nom||"Document")}</span>${x.recu?`<span class="pill pill-green">Reçu</span>`:`<span class="pill pill-red">En attente</span>`}</div>`).join("")}</div>`:""}
    ${(d.pieces||[]).length?`<div class="dp-detail-attach">${(d.pieces||[]).map((p,i)=>`<a class="dp-attach-chip" href="${p.data}" download="${escapeHTML(p.name||'document')}">📎 ${escapeHTML(p.source||"Employé")} · ${escapeHTML(p.name||`Pièce ${i+1}`)}</a>`).join("")}</div>`:""}
    <div class="dp-detail-actions">${suspensionDemandActionsHTML(d)}${convocationDemandActionsHTML(d)}<button class="act-btn primary" onclick="openTraiterDemandePersonnel('${d.id}')">Traiter la demande</button><button class="act-btn" onclick="openDemanderDocumentPersonnel('${d.id}')">Demander un document</button></div>
  </div>`;
}

function demandePersonnelResponseTemplates(d){
  const type=String(demandePersonnelTypeLabel(d)||"").toLowerCase();
  const base=[
    "Votre demande est reçue et en cours de traitement.",
    "Votre demande est acceptée.",
    "Votre demande est rejetée. Motif indiqué ci-dessous.",
    "Votre dossier nécessite un complément d'information.",
    "Merci de transmettre le document demandé via la plateforme.",
    "Vous serez contacté par la DRH pour finaliser le traitement."
  ];
  if(type.includes("attestation"))base.push("Votre attestation est prête et disponible auprès de la DRH.");
  if(type.includes("fiche")||type.includes("paie"))base.push("Votre fiche de paie sera transmise via la plateforme après vérification.");
  if(type.includes("réclamation")||type.includes("reclamation"))base.push("Votre réclamation est transmise au service concerné pour contrôle.");
  if(type.includes("congé")||type.includes("conges")||type.includes("absence"))base.push("Votre demande d'absence/congé est enregistrée pour validation hiérarchique.");
  if(type.includes("pointage"))base.push("La correction de pointage sera appliquée après vérification OPS/DRH.");
  return [...new Set(base)];
}

function _normKey(s){return String(s||"").trim().toLowerCase();}

function portalComptesCanManage(){
  return isAdminGeneralSession()||isAdminSystemSession()||canAccess("demandes_personnel")||String(session?.transverse||"")==="drh";
}

function portalComptesNorm(v){return typeof normalizeSocieteName==="function"?normalizeSocieteName(v):String(v||"").trim().toUpperCase()}

function portalComptesEmployeeMatricule(a){return String(a?.matricule||a?.code||a?.employee_code||a?.id||"").trim()}

function portalComptesEmployeeName(a){return [a?.nom||a?.last_name,a?.prenom||a?.first_name].filter(Boolean).join(" ").trim()||a?.full_name||a?.name||"—"}

function portalComptesEmployeeSociete(a){return a?.societe||a?.society||a?.company||""}

function portalComptesAccountKey(a){return portalComptesNorm(a?.matricule||a?.username||a?.id||"")}

function portalComptesEmployeeKey(a){return portalComptesNorm(portalComptesEmployeeMatricule(a))}

function portalComptesCurrentSoc(){return window._portalComptesSoc||""}

async function portalComptesFetchJSON(url,options){
  const controller=typeof AbortController!=="undefined"?new AbortController():null;
  const timeout=setTimeout(()=>{try{controller?.abort()}catch(e){}},12000);
  try{
    const res=await fetch(url,{cache:"no-store",...(options||{}),signal:controller?.signal,headers:{Authorization:`Bearer ${sgdiAuthToken()}`,...((options&&options.headers)||{})}});
    const raw=await res.text().catch(()=>"");
    let out=null;try{out=raw?JSON.parse(raw):null}catch(e){}
    if(!res.ok){
      const detail=out?.detail||out?.message||out?.error||raw||`Erreur API ${res.status}`;
      if(typeof sgdiIsAuthFailure==="function"&&sgdiIsAuthFailure(res.status,detail)&&typeof sgdiHandleAuthFailure==="function")sgdiHandleAuthFailure("Session expirée ou token invalide. Veuillez vous reconnecter.");
      throw new Error(Array.isArray(detail)?detail.map(d=>d.msg||JSON.stringify(d)).join(", "):String(detail));
    }
    return out||[];
  }catch(e){
    if(e&&e.name==="AbortError")throw new Error("Délai dépassé : l'API comptes portail ne répond pas.");
    throw e;
  }finally{
    clearTimeout(timeout);
  }
}

async function portalComptesFetchEmployees(soc){
  if(window.SGDI?.employees?.page){
    const result=await window.SGDI.employees.page({mode:"all",society:soc||undefined,page:1,page_size:100});
    const items=Array.isArray(result?.items)?result.items:[];
    window._portalComptesEmployeesTotal=Number(result?.total||items.length)||items.length;
    return items;
  }
  window._portalComptesEmployeesTotal=(db.agents||[]).length;
  return db.agents||[];
}

function portalComptesBuildRows(accounts,employees,soc){
  const byAcc=new Map();
  (accounts||[]).filter(a=>a&&typeof a==="object").forEach(a=>byAcc.set(portalComptesAccountKey(a),a));
  const s=portalComptesNorm(soc);
  const rows=[];
  const seen=new Set();
  (employees||[]).filter(a=>a&&typeof a==="object").forEach(emp=>{
    const matricule=portalComptesEmployeeMatricule(emp);
    const key=portalComptesEmployeeKey(emp);
    const empSoc=portalComptesEmployeeSociete(emp);
    if(!matricule||!key)return;
    if(s&&empSoc&&portalComptesNorm(empSoc)!==s)return;
    const account=byAcc.get(key)||null;
    rows.push({employee:emp,account,matricule,key,nom:portalComptesEmployeeName(emp),societe:empSoc||account?.societe||""});
    seen.add(key);
  });
  byAcc.forEach((account,key)=>{
    if(seen.has(key))return;
    if(s&&account?.societe&&portalComptesNorm(account.societe)!==s)return;
    rows.push({employee:null,account,matricule:account?.matricule||account?.username||"",key,nom:[account?.nom,account?.prenom].filter(Boolean).join(" ").trim()||account?.username||"—",societe:account?.societe||""});
  });
  return rows.sort((a,b)=>String(a.societe||"").localeCompare(String(b.societe||""))||String(a.nom||"").localeCompare(String(b.nom||""))||String(a.matricule||"").localeCompare(String(b.matricule||"")));
}

async function renderPortailComptes(view){
  const hash=location.hash,generation=sgdiViewRenderGeneration;
  const _pcSoc=isDrhModuleContext()?(sessionStorage.getItem("drhSociete")||currentStructureSocieteFilter()||""):(currentStructureSocieteFilter()||"");
  window._portalComptesSoc=_pcSoc;
  window._portalComptesRows=[];
  const loadSeq=++portalComptesLoadSeq;
  const canManage=portalComptesCanManage();
  view.innerHTML=`
    <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
      <div>
        <button class="btn btn-ghost text-sm mb-1" onclick="navigate('portail')">← Portail RH</button>
        <h1 class="text-2xl font-black uppercase">Comptes Portail RH</h1>
        <p class="text-sm text-slate-500" id="portal-comptes-subtitle">Chargement des employés et comptes...${_pcSoc?` · ${escapeHTML(_pcSoc)}`:""}</p>
      </div>
      <button class="btn btn-secondary text-sm" onclick="renderPortailComptes(document.getElementById('view'))">Rafraîchir</button>
    </div>
    ${canManage?"":`<div class="card p-4 mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm">Lecture seule : la gestion des comptes portail est réservée à la DRH / administration.</div>`}
    <div class="card p-4 mb-4">
      <h2 class="font-bold mb-3">Créer un nouveau compte</h2>
      <form onsubmit="event.preventDefault();portalComptesCreateNew(this)" class="flex gap-2 flex-wrap items-end">
        <div>
          <label class="text-xs text-slate-500 block mb-1">Matricule</label>
          <input type="text" name="matricule" class="input text-sm" placeholder="Ex: A01" required style="width:120px" />
        </div>
        <div><label class="text-xs text-slate-500 block mb-1">Mot de passe provisoire</label><input class="input text-sm" value="Généré aléatoirement" readonly style="width:170px" /></div>
        <button type="submit" class="btn btn-primary" ${canManage?"":"disabled"}>Créer le compte</button>
        <div class="text-xs text-slate-500">Astuce : utilisez le bouton “Créer” dans la ligne d'un employé sans compte.</div>
      </form>
    </div>
    <div class="card overflow-hidden">
      <div class="p-3 border-b flex gap-2 items-center">
        <input class="input flex-1 text-sm" id="portal-comptes-search" placeholder="Rechercher matricule, nom, société..." oninput="portalComptesFilter()" />
        <select class="select text-sm" id="portal-comptes-status" onchange="portalComptesFilter()" style="max-width:180px">
          <option value="">Tous les statuts</option>
          <option value="active">Comptes actifs</option>
          <option value="missing">Sans compte</option>
          <option value="disabled">Désactivés</option>
        </select>
      </div>
      <table id="portal-comptes-table">
        <thead><tr><th>Matricule</th><th>Nom & Prénom</th><th>Société</th><th class="text-center">Compte</th><th class="text-center">Mot de passe</th><th class="text-right">Action</th></tr></thead>
        <tbody id="portal-comptes-body"><tr><td colspan="6" class="text-center text-slate-400 p-6">Chargement des comptes...</td></tr></tbody>
      </table>
    </div>`;
  const token=sgdiAuthToken();
  if(!token){
    const tbody=document.getElementById("portal-comptes-body");
    if(tbody)tbody.innerHTML=`<tr><td colspan="5" class="text-red-600 p-4">Session PostgreSQL expirée : reconnectez-vous.</td></tr>`;
    return;
  }
  try{
    const soc=window._portalComptesSoc||"";
    const url="/api/portal/accounts"+(soc?"?societe="+encodeURIComponent(soc):"");
    const [allAccounts,employeesRes]=await Promise.all([
      portalComptesFetchJSON(url),
      portalComptesFetchEmployees(soc).catch(e=>{console.warn("Employés portail indisponibles",e);window._portalComptesEmployeesTotal=(db.agents||[]).length;return db.agents||[]})
    ]);
    if(loadSeq!==portalComptesLoadSeq||hash!==location.hash||generation!==sgdiViewRenderGeneration||document.getElementById("view")!==view)return;
    const employees=(Array.isArray(employeesRes)?employeesRes:[]).map(e=>e&&e.backendId?e:(typeof employeeFromApi==="function"?employeeFromApi(e):e)).filter(Boolean);
    if(employees.length){db.agents=dedupeEmployeesByBackendId([...(db.agents||[]),...employees]);normalizeEmployeeCodesInDB();if(Array.isArray(db.assignments)&&db.assignments.length&&typeof applyAssignmentsToEmployees==="function")applyAssignmentsToEmployees(db.assignments);}
    const rows=portalComptesBuildRows(Array.isArray(allAccounts)?allAccounts:[],employees.length?employees:(db.agents||[]),soc);
    window._portalComptesRows=rows;
    const sub=document.getElementById("portal-comptes-subtitle");
    const active=rows.filter(r=>r.account&&r.account.active!==false).length;
    const missing=rows.filter(r=>!r.account&&r.employee).length;
    const total=window._portalComptesEmployeesTotal||rows.length;
    const shown=total>rows.length?`${rows.length} affiché(s) sur ${total}`:`${rows.length} employé(s) / compte(s)`;
    if(sub)sub.textContent=`${shown} · ${active} actif(s) · ${missing} sans compte${soc?` · ${soc}`:""}.`;
    portalComptesFilter();
  }catch(err){
    if(loadSeq!==portalComptesLoadSeq||hash!==location.hash||generation!==sgdiViewRenderGeneration||document.getElementById("view")!==view)return;
    const sub=document.getElementById("portal-comptes-subtitle");
    if(sub)sub.textContent=`Erreur de chargement${_pcSoc?` · ${_pcSoc}`:""}`;
    const tbody=document.getElementById("portal-comptes-body");
    if(tbody)tbody.innerHTML=`<tr><td colspan="5" class="text-red-600 p-4">Erreur : ${escapeHTML(err.message||"Impossible de charger les comptes portail")}</td></tr>`;
  }
}

function portalComptesFilter(){
  const q=(document.getElementById("portal-comptes-search")?.value||"").toLowerCase();
  const status=document.getElementById("portal-comptes-status")?.value||"";
  const rows=window._portalComptesRows||[];
  let filtered=q?rows.filter(r=>[r.matricule,r.nom,r.societe,r.account?.username,r.account?.nom,r.account?.prenom].join(" ").toLowerCase().includes(q)):rows.slice();
  if(status==="active")filtered=filtered.filter(r=>r.account&&r.account.active!==false);
  if(status==="missing")filtered=filtered.filter(r=>!r.account&&r.employee);
  if(status==="disabled")filtered=filtered.filter(r=>r.account&&r.account.active===false);
  const tbody=document.getElementById("portal-comptes-body");
  if(!tbody)return;
  if(!filtered.length){tbody.innerHTML=`<tr><td colspan="6" class="text-center text-slate-400 p-4">${(window._portalComptesRows||[]).length===0?"Aucun employé ni compte portail trouvé.":"Aucun résultat."}</td></tr>`;return}
  const canManage=portalComptesCanManage();
  tbody.innerHTML=filtered.map(r=>{
    const acc=r.account||{};
    const mRaw=String(r.matricule||acc.matricule||acc.username||"").trim();
    const m=escapeHTML(mRaw);
    const nom=escapeHTML(r.nom||[acc.nom,acc.prenom].filter(Boolean).join(" ")||acc.username||"—");
    const soc=escapeHTML(r.societe||acc.societe||"—");
    const hasAccount=!!(r.account&&(acc.matricule||acc.username||acc.id));
    const badge=hasAccount
      ?`<span class="pill ${acc.active!==false?"pill-green":"pill-red"}">${acc.active!==false?"Actif":"Désactivé"}</span>`
      :`<span class="pill pill-amber">Sans compte</span>`;
    const passwordState=!hasAccount?"—":acc.mustChangePassword
      ?`<div><span class="pill pill-amber">À modifier</span><div class="text-xs mt-1">Secret déjà remis</div></div>`
      :`<div><span class="pill pill-green">Configuré ✓</span>${acc.passwordChangedAt?`<div class="text-[10px] text-slate-500 mt-1">${new Date(acc.passwordChangedAt).toLocaleString("fr-FR")}</div>`:""}</div>`;
    const action=!canManage?`<span class="text-xs text-slate-400">Lecture seule</span>`:(hasAccount?`<div class="flex gap-1 justify-end flex-wrap">
      <button type="button" class="btn btn-secondary text-xs" onclick="portalComptesResetPwd('${jsString(mRaw)}')">Nouveau secret</button>
      <button type="button" class="btn btn-secondary text-xs" onclick="issuePortalResetToken('${jsString(mRaw)}')">Jeton reset</button>
      <button class="btn btn-primary text-xs" onclick="portalComptesNotify('${jsString(mRaw)}')">Notifier</button>
      <button class="btn btn-danger text-xs" onclick="portalComptesDelete('${jsString(mRaw)}')">Supprimer</button>
    </div>`:`<button class="btn btn-primary text-xs" onclick="portalComptesQuickCreate('${jsString(mRaw)}')">Créer</button>`);
    return`<tr><td class="font-mono font-bold text-xs">${m}</td><td class="font-semibold">${nom}</td><td class="text-xs text-slate-500">${soc}</td><td class="text-center">${badge}</td><td class="text-center">${passwordState}</td><td>${action}</td></tr>`;
  }).join("");
}

function portalComptesQuickCreate(matricule){
  if(!confirm(`Créer le compte ${matricule} avec un mot de passe provisoire aléatoire ?`))return;
  portalComptesCreatePayload({matricule});
}

function portalComptesUpsertAccount(account){
  const rows=window._portalComptesRows||[];
  const key=portalComptesAccountKey(account);
  if(!key)return;
  let row=rows.find(r=>r.key===key);
  if(row){
    row.account=account;
    row.matricule=row.matricule||account.matricule||account.username||"";
    row.nom=row.nom&&row.nom!=="—"?row.nom:([account.nom,account.prenom].filter(Boolean).join(" ").trim()||account.username||"—");
    row.societe=row.societe||account.societe||"";
  }else{
    rows.unshift({employee:null,account,matricule:account.matricule||account.username||"",key,nom:[account.nom,account.prenom].filter(Boolean).join(" ").trim()||account.username||"—",societe:account.societe||""});
  }
  window._portalComptesRows=rows;
  portalComptesRefreshSubtitle();
  portalComptesFilter();
}

function portalComptesRefreshSubtitle(){
  const rows=window._portalComptesRows||[];
  const soc=portalComptesCurrentSoc();
  const sub=document.getElementById("portal-comptes-subtitle");
  if(!sub)return;
  const active=rows.filter(r=>r.account&&r.account.active!==false).length;
  const missing=rows.filter(r=>!r.account&&r.employee).length;
  const total=window._portalComptesEmployeesTotal||rows.length;
  const shown=total>rows.length?`${rows.length} affiché(s) sur ${total}`:`${rows.length} employé(s) / compte(s)`;
  sub.textContent=`${shown} · ${active} actif(s) · ${missing} sans compte${soc?` · ${soc}`:""}.`;
}

async function portalComptesCreateNew(form){
  if(!portalComptesCanManage()){toast("Accès réservé DRH / Administration","error");return}
  const token=sgdiAuthToken();
  const matricule=form.querySelector('[name="matricule"]').value.trim().toUpperCase();
  if(!matricule){toast("Matricule requis","error");return}
  const btn=form.querySelector('button[type="submit"]');
  if(btn){btn.disabled=true;btn.textContent="Création...";}
  try{
    const ok=await portalComptesCreatePayload({matricule},false);
    if(ok)form.reset();
  }catch(err){toast("Erreur réseau","error")}
  finally{if(btn){btn.disabled=false;btn.textContent="Créer le compte";}}
}

async function portalComptesCreatePayload(payload,showNetworkToast=true){
  if(!portalComptesCanManage()){toast("Accès réservé DRH / Administration","error");return}
  const token=sgdiAuthToken();
  try{
    const res=await fetch("/api/portal/accounts",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(payload)});
    if(res.ok){
      const account=await res.json().catch(()=>null);
      if(account)portalComptesUpsertAccount(account);
      else portalComptesRefreshSubtitle();
      if(account?.temporaryPassword)alert(`Mot de passe provisoire (affiché une seule fois) : ${account.temporaryPassword}`);
      toast("Compte créé","success");
      return true;
    }
    const err=await res.json().catch(()=>({}));
    toast(err.detail||"Erreur création compte","error");
  }catch(err){if(showNetworkToast)toast("Erreur réseau","error");else throw err}
  return false;
}

async function portalComptesResetPwd(matricule){
  if(!portalComptesCanManage()){toast("Accès réservé DRH / Administration","error");return}
  if(!confirm(`Générer un nouveau mot de passe provisoire pour ${matricule} ?`))return;
  const token=sgdiAuthToken();
  try{
    const res=await fetch(`/api/portal/accounts/${encodeURIComponent(matricule)}/password`,{method:"PUT",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:"{}"});
    if(res.ok){
      const account=await res.json().catch(()=>null);if(account)portalComptesUpsertAccount(account);
      if(account?.temporaryPassword)alert(`Mot de passe provisoire (affiché une seule fois) : ${account.temporaryPassword}`);
      toast("Mot de passe provisoire régénéré","success");
    }
    else{const err=await res.json().catch(()=>({}));toast(err.detail||"Erreur","error")}
  }catch(err){toast("Erreur réseau","error")}
}

async function portalComptesDelete(matricule){
  if(!portalComptesCanManage()){toast("Accès réservé DRH / Administration","error");return}
  if(!confirm(`Supprimer le compte portail de ${matricule} ?`))return;
  const token=sgdiAuthToken();
  try{
    const res=await fetch(`/api/portal/accounts/${encodeURIComponent(matricule)}`,{method:"DELETE",headers:{Authorization:`Bearer ${token}`}});
    if(res.ok){
      const key=portalComptesNorm(matricule);
      (window._portalComptesRows||[]).forEach(r=>{if(r.key===key)r.account=null});
      portalComptesRefreshSubtitle();
      portalComptesFilter();
      toast("Compte supprimé","success");
    }
    else{const err=await res.json().catch(()=>({}));toast(err.detail||"Erreur","error")}
  }catch(err){toast("Erreur réseau","error")}
}

async function portalComptesNotify(matricule){
  const title=prompt(`Titre de la notification pour ${matricule} :`, "Portail RH");
  if(title===null)return;
  const body=prompt("Message :", "Votre demande a été traitée.");
  if(body===null)return;
  const token=sgdiAuthToken();
  try{
    const res=await fetch(`/api/portal/push/send/${encodeURIComponent(matricule)}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({title,body})});
    const d=await res.json().catch(()=>({}));
    if(res.ok)toast(`Notification envoyée (${d.sent||0}/${d.total||0} appareils)`,"success");
    else toast(d.detail||"Erreur envoi","error");
  }catch(err){toast("Erreur réseau","error")}
}

function renderDemandesPersonnel(view,sub,arg){
  if(!canAccess("demandes_personnel")){view.innerHTML=`<div class="card p-6 text-red-700">Accès réservé DRH / Administration.</div>`;return}
  // La vue garde la coque ERP (barre latérale incluse) tout en exploitant la
  // largeur restante pour son espace de travail.
  if(!sgdiIsMobileViewport()){
    // Une ancienne visite en mode focalisé pouvait avoir mémorisé le panneau
    // comme replié. La réception s'ouvre toujours avec sa navigation visible.
    try{localStorage.removeItem("sgdiSidebarCollapsed")}catch(e){}
    view.closest(".sgdi-shell")?.classList.remove("sgdi-sidebar-collapsed");
  }
  view.classList.add("dp-wide-view");
  view.closest("main")?.classList.add("dp-wide-main");
  ensureDemandesPersonnel();
  refreshDemandesPersonnelFromPostgres({silent:true});
  const soc=isDrhModuleContext()?drhActiveSocieteFilter():mySoc();
  const all=isDrhModuleContext()?drhDemandesPersonnelList():incomingPortalDemandesPersonnel().filter(d=>!soc||demandePersonnelSociete(d)===soc);
  const q=(sessionStorage.getItem("dp_q")||"").toLowerCase();
  const statut=sessionStorage.getItem("dp_statut")||"";
  const type=sessionStorage.getItem("dp_type")||"";
  let list=all.slice();
  if(sub==="alertes")list=list.filter(d=>demandePersonnelIsAlert(d));
  if(statut)list=list.filter(d=>(d.statut||"nouveau")===statut);
  if(type)list=list.filter(d=>demandePersonnelTypeLabel(d)===type);
  if(q)list=list.filter(d=>[d.ref,d.id,d.agentName,d.matricule,d.societe,d.site,d.objet,d.message,demandePersonnelTypeLabel(d)].join(" ").toLowerCase().includes(q));
  list.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const employeeGroups=groupDemandesPersonnelByEmployee(list);
  let selectedEmployeeKey=sessionStorage.getItem("demandePersonnelEmployeeSelected")||"";
  if(!employeeGroups.some(g=>g.key===selectedEmployeeKey))selectedEmployeeKey=employeeGroups[0]?.key||"";
  if(selectedEmployeeKey)sessionStorage.setItem("demandePersonnelEmployeeSelected",selectedEmployeeKey);
  const selectedGroup=employeeGroups.find(g=>g.key===selectedEmployeeKey)||null;
  const selectedItems=selectedGroup?(selectedGroup.items||[]).slice().sort((a,b)=>String(b.createdAt||b.date||"").localeCompare(String(a.createdAt||a.date||""))):[];
  let selectedId=sessionStorage.getItem("demandePersonnelSelected")||"";
  if(!selectedItems.some(d=>String(d.id)===String(selectedId)))selectedId=String(selectedItems[0]?.id||"");
  if(selectedId)sessionStorage.setItem("demandePersonnelSelected",selectedId);
  const selectedDemand=selectedItems.find(d=>String(d.id)===String(selectedId))||null;
  const alerts=all.filter(d=>demandePersonnelIsAlert(d)).length;
  const done=all.filter(d=>d.statut==="traite").length;
  const types=[...new Set(all.map(d=>demandePersonnelTypeLabel(d)).filter(Boolean))];
  const employeeRow=g=>{const active=g.key===selectedEmployeeKey,alert=(g.items||[]).some(d=>demandePersonnelIsAlert(d)),pending=g.nouveau+g.enCours;return`<button type="button" class="dp-emp-row ${active?"is-active":""}" onclick="selectDemandePersonnelEmployee('${jsString(g.key)}')"><span class="dp-emp-avatar">${escapeHTML((g.name||"?").trim().slice(0,1).toUpperCase())}</span><span class="dp-emp-copy"><strong>${escapeHTML(g.name||"—")}</strong><small>${escapeHTML(g.matricule||"Sans matricule")} · ${escapeHTML(g.societe||"")}</small></span><span class="dp-emp-meta"><b>${g.total}</b>${pending?`<small>${pending} ouverte(s)</small>`:""}${alert?`<i>Alerte</i>`:""}</span></button>`};
  const timelineItem=d=>{const active=String(d.id)===String(selectedId),alert=demandePersonnelIsAlert(d);return`<button type="button" class="dp-tl-item ${active?"is-active":""}" onclick="selectDemandePersonnel('${jsString(d.id)}')"><div class="dp-tl-date">${formatDate(d.createdAt||d.date)}</div><span class="dp-tl-title">${escapeHTML(d.objet||demandePersonnelTypeLabel(d)||"Demande")}</span>${demandePersonnelStatusPill(d.statut)}${alert?` <span class="pill pill-red">Alerte</span>`:""}</button>`};
  const kpi=(label,n,icon,bg,color,onclick)=>`<div class="ops-dash-kpi" style="cursor:pointer" onclick="${onclick}"><div class="ops-dash-kpi-icon" data-preserve-emoji style="background:${bg};color:${color}">${icon}</div><div class="ops-dash-lbl">${label}</div><div class="ops-dash-val">${n}</div></div>`;
  view.innerHTML=`<div class="dp-clean-page">
    <div class="ops-dash-hero"><div class="ops-dash-hero-row">
      <div><div class="ops-dash-eyebrow">Direction des ressources humaines</div><h1>Réception demandes &amp; réclamations</h1><div class="ops-dash-hero-sub"><span>${list.length}${list.length!==all.length?` sur ${all.length}`:""} demande(s) affichée(s) · ${employeeGroups.length} employé(s)${soc?` · ${escapeHTML(soc)}`:" · toutes sociétés"}</span></div></div>
      <a class="ops-dash-refresh" style="background:#fff;color:#043970;text-decoration:none;display:inline-flex;align-items:center" href="#/portail">🔗 Ouvrir portail</a>
    </div></div>
    <div class="ops-dash-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      ${kpi("Total",all.length,"📥","#dbeafe","#1e40af","setDemandesPersonnelFilter('statut','')")}
      ${kpi("Nouvelles",all.filter(d=>(d.statut||"nouveau")==="nouveau").length,"🆕","#dbeafe","#1e40af","setDemandesPersonnelFilter('statut','nouveau')")}
      ${kpi("Alertes",alerts,"⚠️","#fef3c7","#92400e","navigate('demandes_personnel/alertes')")}
      ${kpi("Traitées",done,"✅","#dcfce7","#166534","setDemandesPersonnelFilter('statut','traite')")}
    </div>
    <div class="dp-filters"><input class="input" placeholder="Rechercher une demande..." value="${escapeHTML(q)}" oninput="setDemandesPersonnelSearch(this.value)"/><select class="select" onchange="setDemandesPersonnelFilter('statut',this.value)"><option value="">Tous statuts</option>${["nouveau","en_cours","traite","rejete"].map(s=>`<option value="${s}" ${statut===s?"selected":""}>${demandePersonnelStatusLabel(s)}</option>`).join("")}</select><select class="select" onchange="setDemandesPersonnelFilter('type',this.value)"><option value="">Tous types</option>${types.map(t=>`<option ${type===t?"selected":""}>${escapeHTML(t)}</option>`).join("")}</select><button class="btn btn-secondary" onclick="sessionStorage.removeItem('dp_q');sessionStorage.removeItem('dp_statut');sessionStorage.removeItem('dp_type');renderView()">Réinitialiser</button></div>
    <div class="dp-workspace">
      <section class="dp-panel"><div class="dp-panel-head"><strong>Employés</strong><span class="cnt">${employeeGroups.length}</span></div><div class="dp-emp-list">${employeeGroups.map(employeeRow).join("")||`<div class="dp-empty">Aucun employé.</div>`}</div></section>
      <section class="dp-panel"><div class="dp-req-body">${selectedGroup?`<div class="dp-req-head"><div><strong>${escapeHTML(selectedGroup.name||"—")}</strong><span>${escapeHTML(selectedGroup.matricule||"Sans matricule")} · ${selectedGroup.total} demande(s)</span></div><button class="btn btn-secondary text-xs" onclick="openPortailEmployeHistory('${jsString(selectedGroup.key)}')">Historique complet</button></div><div class="dp-timeline">${selectedItems.map(timelineItem).join("")}</div>${selectedDemand?demandePersonnelDetailHTML(selectedDemand):`<div class="dp-empty">Sélectionnez une demande.</div>`}`:`<div class="dp-empty">Sélectionnez un employé.</div>`}</div></section>
    </div>
  </div>`;
}

function openTraiterDemandePersonnel(id){
  const d=(db.demandesPersonnel||[]).find(x=>x.id===id);if(!d)return;
  const templates=demandePersonnelResponseTemplates(d);
  openModal(`<h3 class="font-bold text-lg mb-3">Traiter la demande</h3><form onsubmit="event.preventDefault();saveTraitementDemandePersonnel('${id}',this)">
    <label class="label">Statut</label><select class="select mb-3" name="statut"><option value="en_cours" ${d.statut==="en_cours"?"selected":""}>En cours</option><option value="traite" ${d.statut==="traite"?"selected":""}>Traité</option><option value="rejete" ${d.statut==="rejete"?"selected":""}>Rejeté</option></select>
    <label class="label">Réponses prédéfinies à envoyer</label>
    <div class="mb-3 p-3 rounded border border-slate-200 bg-slate-50 grid grid-cols-1 gap-2">
      ${templates.map((txt,i)=>`<label class="flex items-start gap-2 text-sm"><input type="checkbox" name="reponsesPred" value="${escapeHTML(txt)}" class="mt-1"/><span>${escapeHTML(txt)}</span></label>`).join("")}
    </div>
    <label class="label">Réponse complémentaire DRH</label><textarea class="textarea mb-3" name="reponse" rows="4" placeholder="Ajouter une précision libre si nécessaire...">${escapeHTML(d.reponseLibre||d.reponse||"")}</textarea>
    <input type="file" name="traitementDoc" class="hidden" onchange="this.form.querySelector('[data-traitement-doc-name]').textContent=this.files&&this.files[0]?this.files[0].name:''"/>
    <div class="flex items-center justify-end gap-2 flex-wrap">
      <span class="text-xs text-slate-500" data-traitement-doc-name></span>
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>
      <button type="button" class="btn btn-secondary" onclick="this.form.traitementDoc.click()">Joindre un document</button>
      <button class="btn btn-primary">Enregistrer</button>
    </div></form>`);
}

async function saveTraitementDemandePersonnel(id,form){
  const d=(db.demandesPersonnel||[]).find(x=>x.id===id);if(!d)return;
  const pred=Array.from(form.querySelectorAll('input[name="reponsesPred"]:checked')).map(x=>x.value.trim()).filter(Boolean);
  const libre=(form.reponse.value||"").trim();
  const file=form.traitementDoc?.files&&form.traitementDoc.files[0]?await readSmallFile(form.traitementDoc.files[0]):null;
  if(form.statut.value==="traite"&&!pred.length&&!libre){toast("Ajoutez une réponse avant de marquer la demande comme traitée","error");return}
  if(file){d.pieces=d.pieces||[];d.pieces.push({...file,source:"DRH"})}
  d.statut=form.statut.value;d.reponsesPredifinies=pred;d.reponseLibre=libre;d.reponse=[...pred,libre].filter(Boolean).join("\n\n");d.updatedAt=new Date().toISOString();d.traitePar=session?.username||"";
  d.historique=d.historique||[];d.historique.push({date:new Date().toISOString(),user:session?.username||"",action:"Réponse envoyée",note:d.statut});
  if(!(await saveDBAndWaitToast("Traitement demande non confirmé")))return;
  closeModal();toast("Demande mise à jour","success");renderSidebar();renderView();
}

function openDemanderDocumentPersonnel(id){
  openModal(`<h3 class="font-bold text-lg mb-3">Demander un document</h3><form onsubmit="event.preventDefault();saveDocumentRequestPersonnel('${id}',this)">
    <label class="label">Document demandé</label><input class="input mb-3" name="nom" placeholder="Ex : certificat médical, pièce justificative"/>
    <label class="label">Instruction</label><textarea class="textarea mb-3" name="note" rows="3" placeholder="Précision pour l'employé"></textarea>
    <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Envoyer demande</button></div></form>`);
}

async function saveDocumentRequestPersonnel(id,form){
  const d=(db.demandesPersonnel||[]).find(x=>x.id===id);if(!d)return;
  d.documentsDemandes=d.documentsDemandes||[];d.documentsDemandes.push({nom:form.nom.value||"Document",note:form.note.value||"",demandeLe:new Date().toISOString(),demandePar:session?.username||"",recu:false});
  d.statut=d.statut==="traite"?"en_cours":(d.statut||"nouveau");d.updatedAt=new Date().toISOString();
  if(!(await saveDBAndWaitToast("Demande document non confirmée")))return;
  closeModal();toast("Document demandé via plateforme","success");renderSidebar();renderView();
}

function openUploadDocumentDemande(id,index){
  openModal(`<h3 class="font-bold text-lg mb-3">Envoyer le document demandé</h3><form onsubmit="event.preventDefault();saveUploadDocumentDemande('${id}',${index},this)">
    ${demandePersonnelFileInputHTML()}
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Envoyer</button></div></form>`);
}

async function saveUploadDocumentDemande(id,index,form){
  try{
    const d=(db.demandesPersonnel||[]).find(x=>x.id===id);if(!d)return;
    const file=await readSmallFile(form.piece.files&&form.piece.files[0]);if(!file){toast("Choisissez un fichier","error");return}
    const doc=d.documentsDemandes&&d.documentsDemandes[index];if(!doc)return;
    doc.recu=true;doc.recuLe=new Date().toISOString();doc.fichier=file;
    d.pieces=d.pieces||[];d.pieces.push({...file,source:"Employé"});d.updatedAt=new Date().toISOString();
    if(!(await saveDBAndWaitToast("Envoi document non confirmé")))return;
    closeModal();toast("Document envoyé","success");renderView();
  }catch(e){toast(e.message||String(e),"error")}
}

SGDIModules.registerModule({key: "portal", routes: ["portail","demandes_personnel","demandes_structure"], dependencies: [], init: function(){}, destroy: portalModuleDestroy});

function portalModuleDestroy(){
  clearTimeout(demandesPersonnelSearchTimer);demandesPersonnelSearchTimer=null;
  portalComptesLoadSeq+=1;
  const view=document.getElementById("view");
  view?.classList.remove("dp-wide-view");view?.closest("main")?.classList.remove("dp-wide-main");
}
