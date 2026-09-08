/* Administration maintenance : fonctions historiques, règles inchangées. */
function renderAdminStorage(view){
  const stats=dbStorageStats();
  const totalKB=Math.round(stats.total/1024);
  // Detect items with photos
  const agentsWithPhoto=(db.agents||[]).filter(a=>a.photo&&String(a.photo).length>1000).length;
  const candidatsWithPhoto=(db.candidats||[]).filter(c=>c.photo&&String(c.photo).length>1000).length;
  const photosTotalKB=Math.round([...(db.agents||[]),...(db.candidats||[])].reduce((s,p)=>s+(p.photo?String(p.photo).length:0),0)/1024);
  const logCount=(db.activityLog||[]).length;
  const pointagesCount=(db.pointages||[]).length;
  const fpqCount=(db.feuillePresence||[]).length;
  const importedInvoices=(db.factures||[]).filter(f=>f.sourceImport==="excel"||String(f.id||"").startsWith("fc_import_"));
  view.innerHTML=`<h1 class="text-2xl font-bold mb-2">🧹 Stockage PostgreSQL</h1>
    <p class="text-slate-500 text-sm mb-3">Les données métier sont sauvegardées dans PostgreSQL via l'API backend. Le navigateur ne sert pas de source de données.</p>
    <div class="card p-5 mb-4">
      <div class="flex justify-between mb-2">
        <h3 class="font-bold text-lg">📊 Taille estimée du snapshot</h3>
        <div class="text-right"><div class="text-3xl font-black" style="color:#043970">${totalKB} Ko</div><div class="text-xs text-slate-500">Données envoyées à PostgreSQL</div></div>
      </div>
    </div>
    <div class="card p-5 mb-4">
      <h3 class="font-bold mb-3">📦 Top consommateurs</h3>
      <table class="w-full text-sm"><thead class="bg-slate-50"><tr><th class="text-left p-2">Section</th><th class="text-right p-2">Taille</th><th class="text-right p-2">% du total</th></tr></thead>
        <tbody>${stats.parts.slice(0,12).map(p=>{const kb=Math.round(p.bytes/1024);const ppct=Math.round(p.bytes/Math.max(1,stats.total)*100);return`<tr class="border-t"><td class="p-2 font-mono text-xs">${escapeHTML(p.k)}</td><td class="p-2 text-right font-bold">${kb} Ko</td><td class="p-2 text-right text-slate-600">${ppct}%</td></tr>`}).join("")}</tbody>
      </table>
    </div>
    <div class="card p-5 mb-4" style="border:1px solid #fecaca">
      <div class="flex items-start justify-between gap-3 flex-wrap mb-3"><div><h3 class="font-bold text-lg">🗑 Suppression des données importées</h3><p class="text-xs text-slate-500 mt-1">Sélection contrôlée des factures provenant d'un fichier Excel. Les factures associées à un paiement sont protégées.</p></div><span class="pill pill-blue">${importedInvoices.length} facture(s)</span></div>
      ${importedInvoices.length?`<div class="flex items-center justify-between gap-3 p-3 rounded-md mb-2" style="background:#fef2f2"><label class="flex items-center gap-2 text-sm font-black"><input type="checkbox" id="admin-imported-invoices-all" onchange="adminImportedInvoicesSelectAll(this.checked)"> Tout sélectionner</label><button type="button" id="admin-imported-invoices-delete" class="btn btn-danger text-xs" disabled onclick="adminDeleteSelectedImportedInvoices()">Supprimer la sélection</button></div><div style="max-height:280px;overflow:auto;border:1px solid #e2e8f0;border-radius:7px">${importedInvoices.map(f=>`<label class="flex items-center gap-3 p-3 border-b hover:bg-slate-50"><input type="checkbox" class="admin-imported-invoice-check" value="${escapeHTML(f.id||"")}" onchange="adminImportedInvoicesSelectionUpdate()"><span class="font-mono text-xs font-black">${escapeHTML(f.numero||"BROUILLON")}</span><span class="text-xs flex-1">${escapeHTML(f.client||f.clientNom||"Client non renseigné")}</span><span class="text-xs font-bold">${money(f.ttc||f.montantTTC||0)}</span></label>`).join("")}</div>`:`<div class="p-4 rounded-md text-sm text-slate-500" style="background:#f8fafc">Aucune donnée importée par Excel.</div>`}
    </div>
    <div class="card p-5 mb-4">
      <h3 class="font-bold mb-3">🧹 Actions de nettoyage</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="card p-4" style="background:#fefce8;border:1px solid #fde68a">
          <div class="font-bold mb-1">Correction automatique</div>
          <div class="text-xs text-slate-600 mb-2">Vérifie les collections, les identifiants invalides et les paramètres obligatoires.</div>
          <button class="btn btn-warn text-sm" onclick="cleanupActionAutoRepairDB()">Lancer la correction</button>
        </div>
        <div class="card p-4" style="background:#043970;border:1px solid #043970">
          <div class="font-bold mb-1">📜 Journal d'activité</div>
          <div class="text-xs text-slate-600 mb-2">${logCount} entrée(s) · garder uniquement les 200 plus récentes</div>
          <button class="btn btn-warn text-sm" onclick="cleanupActionTrimLog()">Garder les 200 dernières</button>
        </div>
        <div class="card p-4" style="background:#fef2f2;border:1px solid #fecaca">
          <div class="font-bold mb-1">🖼 Photos agents/candidats</div>
          <div class="text-xs text-slate-600 mb-2">${agentsWithPhoto} agent(s) + ${candidatsWithPhoto} candidat(s) · ${photosTotalKB} Ko au total</div>
          <button class="btn btn-danger text-sm" onclick="cleanupActionRemoveAllPhotos()">Supprimer toutes les photos</button>
        </div>
        <div class="card p-4" style="background:#fff1f2;border:1px solid #fecdd3">
          <div class="font-bold mb-1">Réinitialisation RH</div>
          <div class="text-xs text-slate-600 mb-2">${(db.agents||[]).length} employé(s) + ${(db.candidats||[]).length} candidat(s). Choisissez précisément le périmètre à remettre à zéro.</div>
          <div class="flex gap-2 flex-wrap">
            <button class="btn btn-danger text-sm" onclick="cleanupActionResetRhPeople(this,'employees')">Supprimer employés</button>
            <button class="btn btn-danger text-sm" onclick="cleanupActionResetRhPeople(this,'candidates')">Supprimer candidats</button>
            <button class="btn btn-danger text-sm" style="background:#7f1d1d;border-color:#7f1d1d" onclick="cleanupActionResetRhPeople(this,'all')">Supprimer employés + candidats</button>
          </div>
        </div>
        <div class="card p-4" style="background:#ecfdf5;border:1px solid #6ee7b7">
          <div class="font-bold mb-1">⚡ Alléger les fiches employés (dossiers gonflés)</div>
          <div class="text-xs text-slate-600 mb-2">Aplatit l'historique interne accumulé dans chaque fiche employé (sans perte de données) — cause principale de lenteur au chargement du module DRH quand des lignes n'ont pas été ré-enregistrées depuis longtemps.</div>
          <button class="btn btn-success text-sm" onclick="cleanupActionFlattenEmployeeExtra(this)">Alléger maintenant</button>
        </div>
        <div class="card p-4" style="background:#043970;border:1px solid #043970">
          <div class="font-bold mb-1">📅 Anciens pointages</div>
          <div class="text-xs text-slate-600 mb-2">${pointagesCount} pointage(s) · supprimer ceux > 12 mois</div>
          <button class="btn btn-warn text-sm" onclick="cleanupActionTrimPointages(12)">Garder les 12 derniers mois</button>
        </div>
        <div class="card p-4" style="background:#043970;border:1px solid #043970">
          <div class="font-bold mb-1">📋 Feuilles de présence</div>
          <div class="text-xs text-slate-600 mb-2">${fpqCount} ligne(s) · supprimer celles > 12 mois</div>
          <button class="btn btn-warn text-sm" onclick="cleanupActionTrimFpq(12)">Garder les 12 derniers mois</button>
        </div>
      </div>
      <div class="mt-4 p-3 rounded-md" style="background:#f0f9ff;border:1px solid #bae6fd">
        <div class="text-xs text-sky-700"><b>💡 Conseil :</b> Les photos sont désormais automatiquement compressées (≤ 800px, JPEG 72%) à l'upload. Ceci ne s'applique qu'aux nouvelles photos.</div>
      </div>
    </div>`;
}

function adminImportedInvoicesSelectionUpdate(){
  const all=Array.from(document.querySelectorAll(".admin-imported-invoice-check"));const checked=all.filter(x=>x.checked);const btn=document.getElementById("admin-imported-invoices-delete");if(btn)btn.disabled=!checked.length;const master=document.getElementById("admin-imported-invoices-all");if(master){master.checked=!!all.length&&checked.length===all.length;master.indeterminate=checked.length>0&&checked.length<all.length;}
}

function adminImportedInvoicesSelectAll(value){document.querySelectorAll(".admin-imported-invoice-check").forEach(x=>x.checked=value);adminImportedInvoicesSelectionUpdate();}

async function adminDeleteSelectedImportedInvoices(){
  if(!isAdminSystemSession())return toast("Action réservée à l'Administration système","error");
  const ids=Array.from(document.querySelectorAll(".admin-imported-invoice-check:checked")).map(x=>x.value);if(!ids.length)return;
  const paid=new Set((db.paiements||[]).map(p=>String(p.factureId||p.invoiceId||"")));const blocked=ids.filter(id=>paid.has(String(id)));const removable=ids.filter(id=>!paid.has(String(id)));
  if(!removable.length)return toast("Toutes les factures sélectionnées possèdent un paiement associé","error");
  if(!confirm(`Supprimer définitivement ${removable.length} facture(s) importée(s) ?${blocked.length?`\n${blocked.length} facture(s) avec paiement seront conservées.`:""}`))return;
  let ok=0,failed=0;for(const id of removable){try{await sgdiApi("/api/irongs/collections/factures/items/"+encodeURIComponent(id),{method:"DELETE",legacy:false});db.factures=db.factures.filter(f=>String(f.id)!==String(id));ok++;}catch(e){failed++;}}
  logActivity("Suppression données importées",`${ok} facture(s) Excel supprimée(s)${blocked.length?` · ${blocked.length} protégée(s)`:""}`);toast(`${ok} supprimée(s)${failed?` · ${failed} erreur(s)`:""}`,failed?"warning":"success");renderView();
}

function cleanupActionAutoRepairDB(){
  const report=sgdiAutoRepairDB();
  if(!report.length){toast("Aucune correction nécessaire","success");return}
  if(saveDB())toast("Correction automatique terminée : "+report.length+" point(s) corrigé(s)","success");
  renderView();
}

async function cleanupActionFlattenEmployeeExtra(btn){
  if(!isAdminSystemSession()){toast("Action réservée à l'administrateur système","error");return}
  if(!confirm("Alléger toutes les fiches employés maintenant ?\nAucune donnée n'est perdue (opération testée, tout ou rien) — seul l'historique interne emboîté est aplati.\nCela peut prendre quelques secondes."))return;
  const original=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent="Allègement en cours…"}
  try{
    const result=await window.SGDI_API.employees.flattenExtra();
    toast(`✓ ${result.changed}/${result.total} fiche(s) allégée(s)`+(result.changed?" — recharge le module DRH pour voir l'effet.":" — déjà à jour."),"success");
  }catch(e){
    toast("Allègement impossible : "+(e.message||e),"error");
  }finally{
    if(btn){btn.disabled=false;btn.textContent=original}
  }
}

function cleanupActionTrimLog(){
  if(!confirm("Garder uniquement les 200 dernières entrées du journal d'activité ?"))return;
  const removed=trimActivityLog(200);
  if(saveDB())toast("✓ "+removed+" entrée(s) du journal supprimée(s)","success");
  renderView();
}

function cleanupActionRemoveAllPhotos(){
  if(!confirm("⚠ Supprimer TOUTES les photos d'agents et de candidats ?\nLes documents (CIN, etc.) sont conservés.\nCette action est irréversible."))return;
  let n=0;
  (db.agents||[]).forEach(a=>{if(a.photo){a.photo=null;n++}});
  (db.candidats||[]).forEach(c=>{if(c.photo){c.photo=null;n++}});
  if(saveDB())toast("✓ "+n+" photo(s) supprimée(s)","success");
  renderView();
}

async function cleanupActionResetRhPeople(btn,mode){
  if(!isAdminSystemSession()){toast("Action réservée à l'administrateur système","error");return}
  const resetMode=["employees","candidates","all"].includes(mode)?mode:"all";
  const agents=resetMode==="candidates"?[]:(db.agents||[]).slice();
  const candidats=resetMode==="employees"?[]:(db.candidats||[]).slice();
  const label=resetMode==="employees"?"les employés":(resetMode==="candidates"?"les candidats":"les candidats et employés");
  const actionText=resetMode==="employees"?"Supprimer employés":(resetMode==="candidates"?"Supprimer candidats":"Supprimer employés + candidats");
  if(!agents.length&&!candidats.length){toast("Aucun élément à supprimer pour ce choix","info");return}
  const cleanupText=agents.length?"\n\nLes compteurs employés seront remis à zéro. Les pointages, congés, demandes RH, bulletins paie, affectations et liens OPS associés seront nettoyés.":"\n\nLes compteurs recrutement/candidats seront remis à zéro. Les employés existants ne seront pas touchés.";
  const cleanupLines=cleanupText.trim().split("\n").filter(Boolean).map(l=>`<p class="text-xs text-slate-500 mt-1">${escapeHTML(l)}</p>`).join("");
  const confirmed=await new Promise(resolve=>{
    openModal(`<h3 class="font-bold text-lg text-red-700 mb-3">Suppression définitive</h3>
<p class="text-sm text-slate-700 mb-1">Supprimer définitivement <strong>${escapeHTML(label)}</strong> ?</p>
<div class="card p-3 mb-3 text-sm"><div>${agents.length} employé(s)</div><div>${candidats.length} candidat(s)</div>${cleanupLines}</div>
<p class="text-sm font-semibold mb-2">Saisissez <span class="font-mono bg-red-50 text-red-700 px-1 rounded">CONFIRMER</span> pour valider :</p>
<input id="_rhReset_input" class="input mb-4" type="text" placeholder="CONFIRMER" autocomplete="off"/>
<div class="flex gap-2 justify-end">
  <button type="button" class="btn btn-ghost" onclick="closeModal();window._rhResetResolve&&window._rhResetResolve(false)">Annuler</button>
  <button type="button" class="btn btn-danger" onclick="window._rhResetResolve&&window._rhResetResolve(document.getElementById('_rhReset_input')?.value||'')">Supprimer</button>
</div>`);
    window._rhResetResolve=val=>{
      delete window._rhResetResolve;
      if(val===false){resolve(false);return}
      resolve(String(val||"").trim().toUpperCase()==="CONFIRMER");
    };
    setTimeout(()=>{
      const inp=document.getElementById("_rhReset_input");
      if(inp){inp.focus();inp.addEventListener("keydown",e=>{if(e.key==="Enter"&&window._rhResetResolve)window._rhResetResolve(inp.value)});}
    },40);
  });
  if(!confirmed){toast("Réinitialisation annulée","info");return}
  if(btn){btn.disabled=true;btn.textContent="Réinitialisation..."}
  const failures=[];
  for(const c of candidats){
    if(!sqlBackendId(c?.backendId)){failures.push("Candidat "+(c.id||"sans id")+" : identifiant PostgreSQL absent");continue}
    try{await deleteCandidateFromPostgres(c)}catch(e){
      const text=String(e&&e.message||e||"");
      if(!/not found|introuvable|404/i.test(text))failures.push("Candidat "+(c.backendId||c.id||"")+" : "+text);
    }
  }
  for(const a of agents){
    const backendId=effectifEmployeeSqlId(a);
    if(!backendId)continue;
    try{await deleteAgentBackend(a)}catch(e){
      const text=String(e&&e.message||e||"");
      if(!/not found|introuvable|404/i.test(text))failures.push("Employé "+(a.backendId||a.id||"")+" : "+text);
    }
  }
  if(failures.length){
    if(btn){btn.disabled=false;btn.textContent=actionText}
    toast("Réinitialisation interrompue : "+failures.slice(0,3).join(" | "),"error");
    return;
  }
  const agentRefs=new Set(agents.flatMap(a=>[a.id,a.backendId,a.matricule,a.code].map(v=>String(v||"").trim()).filter(Boolean)));
  const refMatch=item=>item&&["agentId","employeeId","employee_id","beneficiaireAgentId","retourAgentId","matricule","code","remplaceAgentId"].some(k=>agentRefs.has(String(item[k]||"").trim()));
  if(agents.length){
    ["conges","contrats","avenants","pointages","pointageMensuel","feuillePresence","demandesPersonnel","demandesStructure","missions","siteInspections","stockMouvements","paieElements","paieBulletins","paieClotures"].forEach(collection=>{
      if(Array.isArray(db[collection]))db[collection]=db[collection].filter(item=>!refMatch(item));
    });
    (db.sites||[]).forEach(site=>{
      if(site.groupesAffectation&&typeof site.groupesAffectation==="object"){
        Object.keys(site.groupesAffectation).forEach(k=>{if(agentRefs.has(String(k)))delete site.groupesAffectation[k]});
      }
    });
    db.agents=[];
    if(db.feuillePresenceCloture)db.feuillePresenceCloture={};
    if(db.settings&&Array.isArray(db.settings.unlockLog))db.settings.unlockLog=[];
    unlockedAgents.clear();saveUnlocked();
  }
  if(candidats.length)db.candidats=[];
  if(!db.activityLog)db.activityLog=[];
  db.activityLog.unshift({id:uid("log"),date:new Date().toISOString(),user:session?session.username:"system",action:"Réinitialisation RH",details:`Suppression ${label} · ${agents.length} employé(s) · ${candidats.length} candidat(s)`});
  if(!(await saveDBAndWaitToast("Réinitialisation RH non confirmée"))){
    if(btn){btn.disabled=false;btn.textContent=actionText}
    return;
  }
  toast("Réinitialisation RH terminée","success");
  renderView();
}
SGDIModules.registerModule({key:"administration-maintenance",routes:[]});
