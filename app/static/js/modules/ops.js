/* Phase 2 — ops. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function opsMovementPeriodStart(period,base=today()){
  const d=new Date(base+"T00:00:00");
  if(period==="day")return today();
  if(period==="week"){const day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);return d.toISOString().slice(0,10)}
  if(period==="month")return base.slice(0,7)+"-01";
  if(period==="year")return base.slice(0,4)+"-01-01";
  return "0000-00-00";
}

function opsMovementInPeriod(f,period){
  if(!period||period==="all")return true;
  const d=opsMovementDateValue(f);
  if(!d)return false;
  const start=opsMovementPeriodStart(period);
  if(period==="day")return d===today();
  if(period==="week"){const end=new Date(start+"T00:00:00");end.setDate(end.getDate()+7);return d>=start&&d<end.toISOString().slice(0,10)}
  if(period==="month")return d.slice(0,7)===today().slice(0,7);
  if(period==="year")return d.slice(0,4)===today().slice(0,4);
  return true;
}

function opsMovementAgentAvailability(a){
  const status=employeeStatusKey(a?.statut||"");
  const contractBlocked=!!(a?.blacklist||a?.blacklistContractBlocked||a?.contractBlocked);
  const activeLeave=(db.conges||[]).find(c=>String(c.agentId)===String(a?.id)&&c.statut==="approuve"&&inRange(c));
  const leaveLike=["congé","maladie","absent","suspendu","blacklist","abandon","sortant"].includes(status);
  if(contractBlocked||activeLeave||leaveLike){
    const label=contractBlocked?"BLACKLISTÉ":activeLeave?.type==="Maladie"||status==="maladie"?"MALADIE":activeLeave||status==="congé"?"CONGÉ":status==="suspendu"?"SUSPENDU":status==="absent"?"ABSENT":"INDISPONIBLE";
    return {key:"blocked",label,color:"#dc2626",bg:"#fee2e2",rank:3};
  }
  return agentHasLiveAffectation(a)
    ?{key:"assigned",label:"AFFECTÉ",color:"#1d4ed8",bg:"#dbeafe",rank:2}
    :{key:"available",label:"NON AFFECTÉ",color:"#047857",bg:"#dcfce7",rank:1};
}

function opsMovementAgentOptionHTML(a,selectedId){
  const state=opsMovementAgentAvailability(a);
  const label=`${state.label} · ${opsMovementAgentLabel(a)}`;
  return `<option value="${escapeHTML(a.id)}" ${String(selectedId||"")===String(a.id)?"selected":""} data-state="${state.key}" style="color:${state.color};background:${state.bg};font-weight:800">${escapeHTML(label)}</option>`;
}

function opsMovementSiteLabel(f){return f.siteName||f._site?.nom||f.autreAffectation||"—"}

function opsMovementClientLabel(f){
  const site=opsMovementSiteFromRow(f);
  return site?.client||site?.client_name||f.clientName||f.client||"—";
}

function opsMovementRowMatchesSociete(f,soc){
  if(!soc)return true;
  const site=opsMovementSiteFromRow(f);
  if(site)return normalizeSocieteName(sitePrimarySociete(site))===normalizeSocieteName(soc);
  return normalizeSocieteName(f.societe)===normalizeSocieteName(soc)||normalizeSocieteName(f._agent?.societe)===normalizeSocieteName(soc);
}

function opsOpenSelectedMovement(){
  if(guardOpsSupervisorMutation("mouvement","Accès superviseur OPS : création/modification mouvement non autorisée."))return;
  const agentId=document.getElementById("ops-mvt-agent")?.value||sessionStorage.getItem("opsMovementSelectedAgent")||sessionStorage.getItem("opsMovementAgentId")||"";
  if(!agentId){toast("Choisissez un employé avant de créer un mouvement","error");return}
  sessionStorage.setItem("opsMovementAgentId",agentId);
  sessionStorage.setItem("opsMovementSelectedAgent",agentId);
  fpqOpenMouvement(today(),agentId);
}

function opsSetMovementFilter(key,value){
  if(value)sessionStorage.setItem(key,value);else sessionStorage.removeItem(key);
  renderView();
}

function opsSetMovementSelectedAgent(value){
  if(value)sessionStorage.setItem("opsMovementSelectedAgent",value);
  else sessionStorage.removeItem("opsMovementSelectedAgent");
  const existing=document.querySelector("form[data-ops-movement-form]");
  if(existing){
    const soc=currentStructureSocieteFilter()||effectifSocieteFilter()||session?.societe||"";
    const agents=(db.agents||[]).filter(a=>(!soc||a.societe===soc)&&!ficheAgentIsSortantArchive(a)&&a.statut!=="suspendu").sort((a,b)=>opsMovementAgentAvailability(a).rank-opsMovementAgentAvailability(b).rank||opsMovementAgentLabel(a).localeCompare(opsMovementAgentLabel(b)));
    const tmp=document.createElement("div");
    tmp.innerHTML=opsMovementEditorHTML(today(),value||"",agents);
    existing.replaceWith(tmp.firstElementChild);
  }else{renderView()}
}

function opsFilterMovementAgentSelect(query){
  const sel=document.getElementById("ops-mvt-agent");
  if(!sel)return;
  const norm=v=>String(v||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  const q=norm(query);
  const soc=currentStructureSocieteFilter()||effectifSocieteFilter()||session?.societe||"";
  const siteSociete=canonicalSocieteName(soc,societeConfig().custom||SOCIETES);
  const currentId=sel.value;
  let agents=(db.agents||[]).filter(a=>!siteSociete||a.societe===siteSociete).sort((a,b)=>opsMovementAgentAvailability(a).rank-opsMovementAgentAvailability(b).rank||opsMovementAgentLabel(a).localeCompare(opsMovementAgentLabel(b)));
  if(q){
    agents=agents.filter(a=>{
      const fields=[
        (a.nom||"")+" "+(a.prenom||""),
        a.matricule||a.code||"",
        a.societe||"",
        a.affectationCourante?.siteNom||a.affectationCourante?.site||a.site||"",
        a.affectationCourante?.structure||a.structure||"",
        a.affectationCourante?.poste||a.fonction||a.position||"",
        a.wilaya||"",
        a.commune||"",
      ];
      return fields.some(f=>norm(f).includes(q));
    });
  }
  sel.innerHTML=`<option value="">${agents.length?"— Choisir employé —":"— Aucun résultat —"}</option>${agents.map(a=>opsMovementAgentOptionHTML(a,currentId)).join("")}`;
}

function opsMovementEditorHTML(date,agentId,agents){
  if(isOpsSupervisorReadOnlySession()){
    return `<div class="card p-4 mb-5" style="border-left:4px solid #f59e0b;background:#fffbeb;color:#92400e;font-size:13px;font-weight:800">Mode superviseur OPS : les mouvements sont consultables uniquement. La création et la modification d'ordres de mouvement sont desactivees.</div>`;
  }
  const motifs=["Affectation","Remplacement Absence","Remplacement Manque","Mission","Fixation","Remplacement Malade","Remplacement Abandon de poste"];
  const durees=["Provisoire","Définitif","Jusqu'à nouvel ordre"];
  const soc=currentStructureSocieteFilter()||effectifSocieteFilter()||session?.societe||"";
  const siteSociete=canonicalSocieteName(soc,societeConfig().custom||SOCIETES);
  const sites=movementSitesForSociete(siteSociete);
  const remplacementAgents=(db.agents||[]).filter(x=>!siteSociete||normalizeSocieteName(x.societe)===normalizeSocieteName(siteSociete)).sort((x,y)=>((x.nom||"")+" "+(x.prenom||"")).localeCompare((y.nom||"")+" "+(y.prenom||"")));
  const numeroOrdre=nextOrdreMouvementNumero();
  const _affMap=new Map();
  agents.forEach(a=>{
    _affMap.set(a.id,agentLiveAffectation(a)||a?.affectationCourante||{});
  });
  const nonAffectes=agents.filter(a=>{const aff=_affMap.get(a.id)||{};return!(aff.siteId||aff.siteName);});
  const affectes=agents.filter(a=>{const aff=_affMap.get(a.id)||{};return!!(aff.siteId||aff.siteName);});
  const mkRow=a=>{
    const aff=_affMap.get(a.id)||{};
    const isChecked=agentId&&(String(a.id)===String(agentId)||String(a.backendId||"")===String(agentId)||String(a.matricule||"")===String(agentId));
    const poste=aff.poste||a.fonction||a.position||a.posteContrat||"";
    const affecte=!!(aff.siteId||aff.siteName);
    const nom=escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim());
    const mat=escapeHTML(a.matricule||"—");
    const siteLbl=escapeHTML(aff.siteName||"Non affecté");
    const posteHTML=poste?(' · <b style="color:#0369a1;font-weight:600">'+escapeHTML(poste)+'</b>'):'';
    const siteStyle=affecte?'color:#15803d;font-weight:600':'color:#94a3b8';
    const searchKey=((a.nom||"")+" "+(a.prenom||"")+" "+(a.matricule||a.code||"")+" "+(aff.siteName||"")).toLowerCase();
    return '<label class="ops-mvt-agent-row" data-search="'+searchKey.replace(/"/g,"'")+'">'
      +'<input type="checkbox" class="ops-mvt-agent-cb" value="'+escapeHTML(a.id)+'" '+(isChecked?'checked ':'')+' onchange="opsMovementCbChange()" style="width:16px;height:16px;min-width:16px;cursor:pointer;accent-color:#0369a1"/>'
      +'<span style="flex:1;font-size:13px;line-height:1.4">'
      +'<b>'+nom+'</b>'
      +' <span style="font-size:11px;color:#64748b">· '+mat+posteHTML+' · <span style="'+siteStyle+'">'+siteLbl+'</span></span>'
      +'</span>'
      +'</label>';
  };
  const initCount=agentId?1:0;
  return `<form class="card p-5 mb-5" data-ops-movement-form onsubmit="event.preventDefault()">
    <div class="flex items-center justify-between gap-3 flex-wrap mb-4">
      <div>
        <h2 class="text-lg font-black uppercase">Ordre de mouvement</h2>
        <div class="text-xs text-slate-500">${siteSociete?`Société : ${escapeHTML(siteSociete)}`:"Configurez un filtre société pour afficher les sites disponibles."}</div>
      </div>
      <input type="hidden" name="date" value="${escapeHTML(date)}"/>
      <input class="input font-mono font-bold" name="ordreMouvementNumero" value="${escapeHTML(numeroOrdre)}" readonly style="max-width:220px;background:#f8fafc;color:#043970"/>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div class="md:col-span-3">
        <div style="display:flex;justify-content:center;margin-bottom:10px">
          <div style="position:relative;width:100%;max-width:480px">
            <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:14px;pointer-events:none">🔍</span>
            <input id="ops-mvt-search" type="search" class="input" placeholder="Rechercher par nom, prénom, code, affectation…" style="padding-left:32px;width:100%;box-sizing:border-box" oninput="opsMovementFilterAgents()"/>
          </div>
        </div>
        <div class="flex items-center justify-between mb-1">
          <label class="label mb-0">Employé(s) à affecter</label>
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-500"><span id="ops-mvt-sel-count">${initCount}</span> sélectionné(s)</span>
            <button type="button" class="btn btn-ghost text-xs py-0.5 px-2" onclick="opsMovementSelectAll(true)">Tout</button>
            <button type="button" class="btn btn-ghost text-xs py-0.5 px-2" onclick="opsMovementSelectAll(false)">Aucun</button>
          </div>
        </div>
        <div id="ops-mvt-agent-list" class="ops-mvt-agent-columns">
          <div class="ops-mvt-agent-col">
            <div data-section-header class="ops-mvt-agent-col-title">Non affectés (${nonAffectes.length})</div>
            ${nonAffectes.length?nonAffectes.map(mkRow).join(""):`<div class="p-3 text-slate-500 text-sm text-center">Aucun non affecté</div>`}
          </div>
          <div class="ops-mvt-agent-col">
            <div data-section-header class="ops-mvt-agent-col-title">Affectés (${affectes.length})</div>
            ${affectes.length?affectes.map(mkRow).join(""):`<div class="p-3 text-slate-500 text-sm text-center">Aucun affecté</div>`}
          </div>
          ${!agents.length?`<div class="p-3 text-slate-500 text-sm text-center">Aucun employé disponible</div>`:""}
        </div>
      </div>
      <div><label class="label">Nouvelle affectation *</label><select class="select" name="siteId" onchange="const o=this.form.querySelector('[data-autres-affectation]');if(o)o.style.display=this.value==='autres'?'block':'none'"><option value="">${sites.length?"— Choisir un site actif —":"— Aucun site actif pour cette société —"}</option>${sites.map(s=>`<option value="${s.id}">${escapeHTML(s.nom||s.intitule||"Site "+s.id)}${s.indicatif?` · ${escapeHTML(s.indicatif)}`:""}</option>`).join("")}<option value="autres">Autres</option></select></div>
      <div data-autres-affectation style="display:none"><label class="label">Préciser autre affectation</label><input class="input" name="autreAffectation" value="" placeholder="Préciser l'affectation"/></div>
      <div><label class="label">Motif du mouvement</label><select class="select" name="mouvementMotif" onchange="const box=this.form.querySelector('[data-remplace-agent]');const lbl=this.form.querySelector('[data-remplace-label]');const show=['Remplacement Absence','Remplacement Malade','Remplacement Abandon de poste'].includes(this.value);if(box)box.style.display=show?'block':'none';if(lbl)lbl.textContent=this.value==='Remplacement Malade'?'Employé malade':(this.value==='Remplacement Abandon de poste'?'Employé en abandon de poste':'Employé absent')">${motifs.map(x=>`<option>${x}</option>`).join("")}</select></div>
      <div><label class="label">Durée du mouvement</label><select class="select" name="mouvementDuree">${durees.map(x=>`<option>${x}</option>`).join("")}</select></div>
      <div><label class="label">Groupe</label><select class="select" name="groupe"><option value="">— Groupe —</option><option>A</option><option>B</option><option>C</option><option>D</option></select></div>
      <div data-remplace-agent style="display:none"><label class="label" data-remplace-label>Employé absent</label><select class="select" name="remplaceAgentId"><option value="">— Choisir l'employé concerné —</option>${remplacementAgents.map(x=>`<option value="${x.id}">${escapeHTML((x.matricule?x.matricule+" · ":"")+(x.nom||"")+" "+(x.prenom||""))}</option>`).join("")}</select></div>
      <div class="md:col-span-3"><label class="label">Observation</label><textarea class="input" name="mouvementObs" rows="3" placeholder="Observation du mouvement..."></textarea></div>
    </div>
    <div class="flex gap-2 justify-end mt-4 flex-wrap">
      <button type="button" class="btn btn-secondary" onclick="opsEditerOrdreMouvementCentral(this)">Editer OM</button>
      <button type="button" class="btn btn-primary" onclick="opsValiderOrdreMouvementCentral(this)">Valider OM</button>
      <button type="button" class="btn btn-ghost" onclick="opsImprimerOrdreMouvementCentral(this)">Imprimer OM</button>
    </div>
  </form>`;
}

function opsMovementCbChange(){
  const list=document.getElementById('ops-mvt-agent-list');
  const n=list?list.querySelectorAll('.ops-mvt-agent-cb:checked').length:0;
  const el=document.getElementById('ops-mvt-sel-count');
  if(el)el.textContent=n;
}

function opsMovementSelectAll(checked){
  const list=document.getElementById('ops-mvt-agent-list');
  if(!list)return;
  list.querySelectorAll('.ops-mvt-agent-cb').forEach(cb=>cb.checked=checked);
  opsMovementCbChange();
}

function opsMovementFilterAgents(){
  const q=(document.getElementById('ops-mvt-search')?.value||'').toLowerCase().trim();
  const list=document.getElementById('ops-mvt-agent-list');
  if(!list)return;
  list.querySelectorAll('.ops-mvt-agent-row').forEach(row=>{
    row.style.display=(!q||(row.dataset.search||'').includes(q))?'':'none';
  });
  // Masque les headers de section si aucun agent visible dans leur groupe
  list.querySelectorAll('[data-section-header]').forEach(header=>{
    let next=header.nextElementSibling;let hasVisible=false;
    while(next&&!next.dataset.sectionHeader){if(next.classList.contains('ops-mvt-agent-row')&&next.style.display!=='none')hasVisible=true;next=next.nextElementSibling;}
    header.style.display=hasVisible?'':'none';
  });
  opsMovementCbChange();
}

function opsMovementCentralContext(btn){
  const form=btn?.closest?.("form[data-ops-movement-form]")||document.querySelector("form[data-ops-movement-form]");
  const date=form?.querySelector('[name="date"]')?.value||today();
  const list=document.getElementById('ops-mvt-agent-list');
  const agentIds=list?[...list.querySelectorAll('.ops-mvt-agent-cb:checked')].map(cb=>cb.value).filter(Boolean):[];
  if(!form||!agentIds.length){toast("Sélectionnez au moins un employé avant de créer un mouvement","error");return null}
  const agentId=agentIds[0];
  const {f,patch}=fpqMovementPatchFromForm(date,agentId,form);
  if(!patch.siteId){toast("Choisissez une nouvelle affectation","error");return null}
  if(patch.siteId==="autres"&&!patch.autreAffectation){toast("Précisez l'autre affectation","error");return null}
  return {form,date,agentId,agentIds,f,patch};
}

async function opsEditerOrdreMouvementCentral(btn){
  if(guardOpsSupervisorMutation("mouvement","Accès superviseur OPS : création/modification mouvement non autorisée."))return;
  const ctx=opsMovementCentralContext(btn);if(!ctx)return;
  if(ctx.agentIds.length>1){toast("Editer un seul OM à la fois — désélectionnez les autres employés","error");return}
  return fpqEditerOrdreMouvement(ctx.date,ctx.agentId,ctx.form);
}

async function opsValiderOrdreMouvementCentral(btn){
  if(guardOpsSupervisorMutation("mouvement","Accès superviseur OPS : validation mouvement non autorisée."))return;
  const ctx=opsMovementCentralContext(btn);if(!ctx)return;
  if(ctx.agentIds.length===1)return fpqPersistOrdreMouvement(ctx.date,ctx.agentId,ctx.f,ctx.patch,{print:false,closeModal:false,message:"OM validé et archivé"});
  return opsValiderMultiOM(ctx.agentIds,ctx.form,ctx.date,{print:false});
}

async function opsImprimerOrdreMouvementCentral(btn){
  if(guardOpsSupervisorMutation("mouvement","Accès superviseur OPS : validation mouvement non autorisée."))return;
  const ctx=opsMovementCentralContext(btn);if(!ctx)return;
  if(ctx.agentIds.length===1)return fpqPersistOrdreMouvement(ctx.date,ctx.agentId,ctx.f,ctx.patch,{print:true,closeModal:false,message:"OM validé, archivé et prêt à imprimer"});
  return opsValiderMultiOM(ctx.agentIds,ctx.form,ctx.date,{print:true});
}

function opsMovementGroupHTML(title,rows,field){
  const map=new Map();
  rows.forEach(r=>{const label=field(r)||"—";map.set(label,(map.get(label)||0)+1)});
  const out=[...map.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,8);
  return `<div class="card p-4"><div class="text-xs uppercase font-black text-slate-500 mb-3">${escapeHTML(title)}</div>${out.length?out.map(([label,count])=>`<div class="flex justify-between gap-3 py-2 border-t border-slate-100 first:border-t-0"><span class="text-xs font-bold text-slate-700">${escapeHTML(label)}</span><span class="pill pill-blue">${count}</span></div>`).join(""):`<div class="text-xs text-slate-400">Aucun mouvement.</div>`}</div>`;
}

function opsMovementSitesReferenceHTML(soc,rows){
  const sites=movementSitesForSociete(soc);
  const groups=new Map();
  sites.forEach(site=>{
    const label=site.nom||site.intitule||"Site";
    const key=normalizedSearchText(label);
    const group=groups.get(key)||{label,ids:new Set(),labels:new Set()};
    [site.id,site.backendId].filter(v=>v!==undefined&&v!==null&&v!=="").forEach(v=>group.ids.add(String(v)));
    [site.nom,site.intitule].filter(Boolean).forEach(v=>group.labels.add(normalizedSearchText(v)));
    groups.set(key,group);
  });
  const countForGroup=group=>{
    return rows.filter(r=>
      group.ids.has(String(r.siteId||""))||
      group.ids.has(String(r.siteBackendId||r.site_id||""))||
      group.labels.has(normalizedSearchText(r.siteName||r._site?.nom||r.autreAffectation||""))
    ).length;
  };
  const out=[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
  return `<div class="card p-4"><div class="text-xs uppercase font-black text-slate-500 mb-3">Sites</div>${out.length?out.map(group=>`<div class="flex justify-between gap-3 py-2 border-t border-slate-100 first:border-t-0"><span class="text-xs font-bold text-slate-700">${escapeHTML(group.label)}</span><span class="pill pill-blue">${countForGroup(group)}</span></div>`).join(""):`<div class="text-xs text-slate-400">Aucun site actif.</div>`}</div>`;
}

async function renderOpsMouvements(view){
  // Affichage immédiat avec les données locales
  _renderOpsMouvementsHTML(view);
  // Sync en arrière-plan si nécessaire, puis rafraîchissement discret
  if(sgdiAuthToken()){
    // ensureOpsMovementSqlSync() ne recharge que sites/affectations/mouvements, JAMAIS les
    // employés : sans cet appel, si la synchro générale de fond (au login) n'avait pas encore
    // fini quand on arrive sur cet écran, "Employé(s) à affecter" restait vide indéfiniment,
    // sans jamais réessayer par lui-même (même trou que sur Effectifs/Personnel rattaché).
    const empPromise=typeof sgdiEnsureEmployeesForDisplay==="function"?sgdiEnsureEmployeesForDisplay({society:currentStructureSocieteFilter()}):null;
    const needsSync=!window.__sgdiOpsMovementSqlSyncedAt||Date.now()-window.__sgdiOpsMovementSqlSyncedAt>=15000;
    const tasks=[];
    if(empPromise&&typeof empPromise.then==="function")tasks.push(empPromise.catch(()=>null));
    if(needsSync)tasks.push(ensureOpsMovementSqlSync().catch(e=>{console.warn("Synchronisation Mouvement indisponible",e);return null}));
    if(tasks.length){
      await Promise.all(tasks);
      if(document.body.contains(view)&&/ops\/mouvements/.test(location.hash)){
        // Ne pas re-rendre si le formulaire OM est ouvert (protège le scroll et l'état du formulaire)
        const formOpen=!!view.querySelector('[data-ops-movement-form]');
        if(formOpen)sgdiRefreshCountersNow({reason:"mvt-sync"});
        else _renderOpsMouvementsHTML(view);
      }
    }
  }
}

function _renderOpsMouvementsHTML(view){
  const soc=currentStructureSocieteFilter();
  const presetAgent=sessionStorage.getItem("opsMovementAgentId")||"";
  const period="all";
  const siteFilter="";
  const selectedMovementAgent=presetAgent||sessionStorage.getItem("opsMovementSelectedAgent")||"";
  const agentFilter="";
  const clientFilter="";
  const searchQ=(sessionStorage.getItem("opsMovementSearch")||"").trim().toLowerCase();
  const scopedRows=opsMovementRows()
    .filter(f=>opsMovementRowMatchesSociete(f,soc))
    .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
  const baseRows=scopedRows
    .filter(f=>!siteFilter||String(f.siteId)===String(siteFilter)||String(f.siteBackendId||f.site_id||"")===String((db.sites||[]).find(s=>String(s.id)===String(siteFilter))?.backendId||""))
    .filter(f=>!agentFilter||String(f.agentId)===String(agentFilter)||String(f.agentBackendId||f.employee_id||"")===String((db.agents||[]).find(a=>String(a.id)===String(agentFilter))?.backendId||""))
    .filter(f=>!clientFilter||opsMovementClientLabel(f)===clientFilter);
  const rows=baseRows
    .filter(f=>opsMovementInPeriod(f,period))
    .filter(f=>{if(!searchQ)return true;const a=f._agent;const hay=[opsMovementAgentLabel(a),(a?.nom||"")+" "+(a?.prenom||""),a?.matricule||a?.code||"",a?.affectationCourante?.structure||a?.structure||"",a?.societe||"",f.ordreMouvementNumero||f.mouvementNumero||"",f.mouvementMotif||f.mouvementType||"",opsMovementSiteLabel(f),opsMovementClientLabel(f),f.groupe||"",f.date||""].join(" ").toLowerCase();return hay.includes(searchQ)})
    .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
  const agents=(db.agents||[]).filter(a=>(!soc||a.societe===soc)&&!ficheAgentIsSortantArchive(a)&&a.statut!=="suspendu").sort((a,b)=>opsMovementAgentAvailability(a).rank-opsMovementAgentAvailability(b).rank||opsMovementAgentLabel(a).localeCompare(opsMovementAgentLabel(b)));
  const count=p=>baseRows.filter(f=>opsMovementInPeriod(f,p)).length;
  view.innerHTML=`<div class="ops-dash-hero"><div class="ops-dash-hero-row"><div><div class="ops-dash-eyebrow">Pilotage opérationnel</div><h1>Mouvement</h1><div class="ops-dash-hero-sub"><span>Ordres de mouvement OPS · ${soc?escapeHTML(soc):"Toutes sociétés"} · ${baseRows.length} mouvement(s)</span></div></div></div></div>
  ${opsMovementEditorHTML(today(),selectedMovementAgent,agents)}
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">${opsMovementSitesReferenceHTML(soc,rows)}${opsMovementGroupHTML("Par client",rows,opsMovementClientLabel)}</div>
  <div class="ops-dash-card">
    <div class="ops-dash-card-head">
      <div><h3>Historique des mouvements</h3><p>${rows.length} mouvement(s) affiché(s) sur ${baseRows.length} correspondant aux filtres site/client</p></div>
      <div class="flex items-center gap-2 flex-wrap">
        <input type="search" class="input text-sm" placeholder="Recherche agent, motif, site, N° ordre…" style="min-width:260px" value="${escapeHTML(searchQ)}" oninput="sessionStorage.setItem('opsMovementSearch',this.value);renderView()"/>
        <button type="button" class="ops-dash-alert-open" onclick="['opsMovementAgentId','opsMovementSelectedAgent','opsMovementAgentFilter','opsMovementSite','opsMovementClient','opsMovementSearch'].forEach(k=>sessionStorage.removeItem(k));sessionStorage.setItem('opsMovementPeriod','all');renderView()">Tout afficher</button>
      </div>
    </div>
    <div class="ops-dash-card-body" style="overflow-x:auto">${rows.length?`<table><thead><tr><th class="text-left">Date</th><th class="text-left">Heure</th><th class="text-left">N° ordre</th><th class="text-left">Agent</th><th class="text-left">Motif</th><th class="text-left">Affectation</th><th class="text-left">Durée</th><th class="text-right">Action</th></tr></thead><tbody>
      ${rows.map(f=>`<tr><td class="text-xs font-mono">${escapeHTML(formatDate(f.date||""))}</td><td class="text-xs font-mono">${escapeHTML(movementTimeLabel(f))}</td><td class="text-xs font-black">${escapeHTML(f.ordreMouvementNumero||f.mouvementNumero||"—")}</td><td class="font-semibold">${escapeHTML(opsMovementAgentLabel(f._agent))}</td><td class="text-xs">${escapeHTML(f.mouvementMotif||f.mouvementType||"—")}</td><td class="text-xs">${escapeHTML(opsMovementSiteLabel(f))}<div class="text-[10px] text-slate-500">${escapeHTML(opsMovementClientLabel(f))}</div></td><td class="text-xs">${escapeHTML(f.mouvementDuree||"—")}</td><td class="text-right"><div class="flex gap-1 justify-end flex-wrap">${isOpsSupervisorReadOnlySession()?"":`<button class="btn btn-secondary text-xs" onclick="fpqOpenMouvement('${escapeHTML(f.date||today())}','${escapeHTML(f.agentId||"")}')">Modifier</button>`}<button class="btn btn-ghost text-xs" onclick="opsOpenMovementDocumentByRow('${escapeHTML(f.id||"")}')">Ordre</button></div></td></tr>`).join("")}
    </tbody></table>`:`<div class="p-10 text-center text-slate-500">Aucun mouvement enregistré.</div>`}</div>
  </div>`;
  if(presetAgent)sessionStorage.removeItem("opsMovementAgentId");
}

function opsDashboardRefreshFeuillePresence(){
  // db.feuillePresence n'est normalement peuplé que par les écrans Pointage
  // (feuille/auto/planning) visités dans la session : sans ce fetch dédié, un
  // utilisateur qui arrive directement sur ops/dashboard voit tous les
  // indicateurs de présence (Présents, Absents, taux par site...) à zéro.
  const now=Date.now();
  if(now-opsDashboardFeuilleFetchedAt<10000)return;
  opsDashboardFeuilleFetchedAt=now;
  sgdiApi("/api/irongs/collections/feuillePresence",{method:"GET",legacy:false}).then(res=>{
    const data=Array.isArray(res)?res:(res?.data||[]);
    if(data.length){
      db.feuillePresence=data;
      if(((location.hash||"").slice(2)).startsWith("ops/dashboard"))renderView();
    }
  }).catch(e=>console.warn("Feuille de présence indisponible pour le tableau de bord OPS",e));
}

function renderOpsClientObservations(view){
  view.innerHTML=`<div class="mb-4"><h1 class="text-2xl font-black uppercase">Signalements clients</h1><p class="text-sm text-slate-500">Observations et signalements soumis par les clients depuis leur portail dédié.</p></div>
    <div class="flex gap-2 flex-wrap mb-4" id="ops-obs-filters"></div>
    <div id="ops-obs-list"><div class="card p-6 text-center text-slate-400">Chargement…</div></div>`;
  loadOpsClientObservations();
}

function opsStatusLabel(status){return {nouveau:"Nouveau",en_cours:"En cours",traite:"Traité"}[status]||status}

function opsStatusPillClass(status){return {nouveau:"pill-blue",en_cours:"pill-amber",traite:"pill-green"}[status]||"pill-gray"}

function opsClientObservationsFilterTabs(){
  const host=document.getElementById("ops-obs-filters");
  if(!host)return;
  const counts={tous:(opsClientObservationsCache||[]).length,nouveau:0,en_cours:0,traite:0};
  (opsClientObservationsCache||[]).forEach(o=>{counts[o.status]=(counts[o.status]||0)+1});
  const tabs=[["tous","Tous"],["nouveau","Nouveau"],["en_cours","En cours"],["traite","Traité"]];
  host.innerHTML=tabs.map(([key,label])=>`<button type="button" class="btn ${opsClientObservationsFilter===key?"btn-primary":"btn-secondary"} text-xs" onclick="setOpsClientObservationsFilter('${key}')">${label} (${counts[key]||0})</button>`).join("");
}

function setOpsClientObservationsFilter(key){opsClientObservationsFilter=key;renderOpsClientObservationsList()}

async function loadOpsClientObservations(){
  try{
    const res=await sgdiApi("/api/client-portal/ops/observations",{method:"GET",legacy:false});
    opsClientObservationsCache=Array.isArray(res)?res:[];
    opsClientObservationsFetchedAt=Date.now();
  }catch(e){
    const host=document.getElementById("ops-obs-list");
    if(host)host.innerHTML=`<div class="card p-6 text-center text-red-600">${escapeHTML(e.message||"Erreur de chargement")}</div>`;
    return;
  }
  renderSidebar();
  renderOpsClientObservationsList();
}

function renderOpsClientObservationsList(){
  const host=document.getElementById("ops-obs-list");
  if(!host)return;
  opsClientObservationsFilterTabs();
  let rows=opsClientObservationsCache||[];
  if(opsClientObservationsFilter!=="tous")rows=rows.filter(o=>o.status===opsClientObservationsFilter);
  if(!rows.length){host.innerHTML=`<div class="card p-6 text-center text-slate-400">Aucun signalement.</div>`;return}
  host.innerHTML=`<div class="grid gap-3">${rows.map(opsObservationCardHTML).join("")}</div>`;
}

function opsObservationCardHTML(o){
  return `<div class="card p-4" style="border-left:4px solid ${o.severity==="urgente"?"#dc2626":"#0d6ecc"}">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <div class="font-black">${escapeHTML(o.employee_name)}</div>
        <div class="text-xs text-slate-500 mt-1">${escapeHTML(o.client_name)}${o.site_name?" · "+escapeHTML(o.site_name):""} · ${escapeHTML(formatDate(o.incident_date))}</div>
      </div>
      <div class="flex gap-2 items-center flex-wrap">
        ${o.kind==="probleme"?'<span class="pill pill-red">Problème</span>':'<span class="pill pill-gray">Observation</span>'}
        ${o.severity==="urgente"?'<span class="pill pill-red">Urgent</span>':""}
        <span class="pill ${opsStatusPillClass(o.status)}">${opsStatusLabel(o.status)}</span>
      </div>
    </div>
    <div class="text-sm mt-2 text-slate-700">${escapeHTML(o.description)}</div>
    ${o.categories&&o.categories.length?`<div class="flex gap-1 flex-wrap mt-2">${o.categories.map(c=>`<span class="pill pill-amber">${escapeHTML(c)}</span>`).join("")}</div>`:""}
    ${o.attachment_url?`<a class="btn btn-secondary text-xs mt-2" href="${escapeHTML(o.attachment_url)}" target="_blank" rel="noopener">📎 ${escapeHTML(o.attachment_name||"Pièce jointe")}</a>`:""}
    <div class="flex justify-end mt-3"><button type="button" class="btn btn-secondary text-xs" onclick="openOpsObservationDetail(${o.id})">Ouvrir</button></div>
  </div>`;
}

function openOpsObservationDetail(id){
  const o=(opsClientObservationsCache||[]).find(x=>x.id===id);
  if(!o)return;
  openModal(`<h3 class="font-black text-xl mb-2">${escapeHTML(o.employee_name)}</h3>
    <div class="text-sm text-slate-500 mb-3">${escapeHTML(o.client_name)}${o.site_name?" · "+escapeHTML(o.site_name):""} · ${escapeHTML(formatDate(o.incident_date))}</div>
    <div class="flex gap-2 mb-3 flex-wrap">${o.kind==="probleme"?'<span class="pill pill-red">Problème</span>':'<span class="pill pill-gray">Observation</span>'}${o.severity==="urgente"?'<span class="pill pill-red">Urgent</span>':""}<span class="pill ${opsStatusPillClass(o.status)}">${opsStatusLabel(o.status)}</span></div>
    <div class="card p-3 mb-3" style="background:#f8fafc">
      <div class="text-sm">${escapeHTML(o.description)}</div>
      ${o.categories&&o.categories.length?`<div class="flex gap-1 flex-wrap mt-2">${o.categories.map(c=>`<span class="pill pill-amber">${escapeHTML(c)}</span>`).join("")}</div>`:""}
      ${o.attachment_url?`<div class="mt-3"><a class="btn btn-secondary text-xs" href="${escapeHTML(o.attachment_url)}" target="_blank" rel="noopener">📎 ${escapeHTML(o.attachment_name||"Pièce jointe")}</a></div>`:""}
    </div>
    ${o.resolution_note?`<div class="mb-3"><label class="label">Dernière note de résolution</label><div class="card p-3 text-sm" style="background:#f0fdf4">${escapeHTML(o.resolution_note)}</div><div class="text-xs text-slate-400 mt-1">${o.resolved_by_name?escapeHTML(o.resolved_by_name)+" · ":""}${o.resolved_at?escapeHTML(formatDate(o.resolved_at)):""}</div></div>`:""}
    ${o.client_response?`<div class="mb-3"><label class="label">Réponse visible par le client</label><div class="card p-3 text-sm" style="background:#fff1f2;border-color:#fecdd3">${escapeHTML(o.client_response)}</div></div>`:""}
    <label class="label">Statut</label>
    <select class="select" id="ops-obs-status">
      <option value="nouveau" ${o.status==="nouveau"?"selected":""}>Nouveau</option>
      <option value="en_cours" ${o.status==="en_cours"?"selected":""}>En cours</option>
      <option value="traite" ${o.status==="traite"?"selected":""}>Traité</option>
    </select>
    <label class="label mt-2">Note de résolution (interne — jamais visible du client)</label>
    <textarea class="textarea" id="ops-obs-note" rows="3">${escapeHTML(o.resolution_note||"")}</textarea>
    <div id="ops-obs-reply-panel" class="hidden mt-3" style="padding:14px;border:1px solid #fecdd3;border-radius:10px;background:#fff7f8"><label class="label" style="color:#9f1239">Réponse au client</label><div class="text-xs text-slate-500 mb-2">Cette réponse sera visible dans l’historique de son portail.</div><textarea class="textarea" id="ops-obs-client-response" rows="4" placeholder="Rédigez la réponse destinée au client…">${escapeHTML(o.client_response||"")}</textarea></div>
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button><button type="button" class="btn btn-secondary" onclick="showOpsObservationReply()">Répondre</button><button type="button" class="btn btn-primary" onclick="submitOpsObservationResolution(${o.id})">Enregistrer</button></div>`);
}

function showOpsObservationReply(){
  const panel=document.getElementById("ops-obs-reply-panel");
  if(!panel)return;
  panel.classList.remove("hidden");
  document.getElementById("ops-obs-client-response")?.focus();
}

async function submitOpsObservationResolution(id){
  const status=document.getElementById("ops-obs-status").value;
  const note=document.getElementById("ops-obs-note").value.trim();
  const response=document.getElementById("ops-obs-client-response")?.value.trim()||null;
  try{
    await sgdiApi(`/api/client-portal/ops/observations/${id}/resolve`,{method:"POST",legacy:false,body:{status,resolution_note:note||null,client_response:response}});
    closeModal();
    toast(response?"Réponse envoyée au client":"Signalement mis à jour","success");
    await loadOpsClientObservations();
  }catch(e){toast(e.message||"Mise à jour impossible","error")}
}

function renderOPS(view,sub,arg){
  if(!canAccess("ops")){view.innerHTML=`<div class="card p-6">🔐 Accès refusé</div>`;return}
  if(sub!=="qr")ptStopQrTabletTimer();
  if(sub==="qr"){
    view.innerHTML=`<div class="flex items-center gap-3 mb-4"><button class="btn btn-secondary text-sm" onclick="navigate('ops/dashboard')">← Tableau de bord OPS</button><h1 class="text-2xl font-black uppercase">QR Présence</h1></div>`+renderPointageQRGen();
    opsModuleTimeout(ptStartQrTabletTimer,100);
    return;
  }
  if(sub==="missions"){renderOpsMissions(view,arg);return}
  if(sub==="mouvements"){renderOpsMouvements(view);return}
  if(sub==="supervision"){renderOpsSupervision(view,arg||"dashboard");return}
  if(sub==="instance_dotation"){renderOpsInstanceDotation(view);return}
  if(sub==="signalements-clients"){renderOpsClientObservations(view);return}
  opsDashboardRefreshFeuillePresence();
  const soc=currentStructureSocieteFilter();
  const empCounters=sgdiUnifiedEmployeeCounters(soc);
  const erpOps=sgdiErpModuleCounters("ops",soc);
  const ag=(db.agents||[]).filter(a=>!soc||a.societe===soc);
  const sites=(db.sites||[]).filter(s=>s&&siteBelongsToPrimarySociete(s,soc));
  const pts=(db.pointages||[]).filter(p=>!soc||((db.agents||[]).find(a=>a.id===p.agentId)?.societe===soc)||p.societe===soc);
  const actifs=ag.filter(employeeIsActive);
  const dashboardActive=counterNumericValue(empCounters?.active??actifs.length);
  const dashboardOperational=counterNumericValue(empCounters?.operationalActive??actifs.length);
  const dashboardSansAffectation=counterNumericValue(empCounters?.withoutAssignment??actifs.filter(agentNeedsAffectation).length);
  const dashboardSansDotation=counterNumericValue(empCounters?.withoutEquipment??materialPendingDotationCountForSoc(soc));
  const dashboardSitesActifs=counterNumericValue(erpOps?.sites_active??sites.filter(s=>s.actif!==false).length);
  const dashboardAffectes=counterNumericValue(erpOps?.assignments_active??actifs.filter(agentHasLiveAffectation).length);
  const instanceAffectation=actifs.filter(agentNeedsAffectation);
  const instanceDotationCount=dashboardSansDotation;
  const sitesActifs=sites.filter(s=>s.actif!==false);
  const now=new Date();const curYM=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
  const ptsCur=pts.filter(p=>p.periode===curYM);
  const ptsValide=ptsCur.filter(p=>p.valide);
  const totP=ptsCur.reduce((acc,p)=>acc+Object.values(p.days||{}).filter(v=>v==="P").length,0);
  const totA=ptsCur.reduce((acc,p)=>acc+Object.values(p.days||{}).filter(v=>v==="A").length,0);
  const totM=ptsCur.reduce((acc,p)=>acc+Object.values(p.days||{}).filter(v=>v==="M").length,0);
  const td=today();
  const fpqToday=(db.feuillePresence||[]).filter(f=>f.date===td&&(!soc||f.societe===soc));
  const fpqPointes=fpqToday.filter(f=>fpqPresenceCode(f.heureArrivee)).length;
  const fpqPresent=fpqToday.filter(f=>fpqPresenceCode(f.heureArrivee)==="P").length;
  const fpqAbsence=fpqToday.filter(f=>["A","AB"].includes(fpqPresenceCode(f.heureArrivee))).length;
  const fpqRecup=fpqToday.filter(f=>fpqPresenceCode(f.heureArrivee)==="R").length;
  const fpqSuspendu=fpqToday.filter(f=>fpqPresenceCode(f.heureArrivee)==="S").length;
  const fpqMouvements=fpqToday.filter(f=>f.mouvementMotif||f.mouvementType||f.ordreMouvementNumero).length;
  const incidentsOuverts=(db.incidents||[]).filter(i=>i.statut!=="clos"&&incidentMatchesSociete(i,soc));
  const sitesSansEffectif=sitesActifs.filter(s=>!actifs.some(a=>String(agentLiveAffectation(a)?.siteId||"")===String(s.id)));
  const feuillesNonCloturees=[...new Set((db.feuillePresence||[]).map(f=>f.date).filter(Boolean))].filter(d=>!fpqIsCloture(d)).length;
  const affectes=actifs.filter(agentHasLiveAffectation);
  const opsWorkflowTasks=workflowTasksForModule("ops");
  const tauxAffectation=actifs.length?Math.round(affectes.length*100/actifs.length):0;
  const tauxPointage=fpqToday.length?Math.round(fpqPointes*100/fpqToday.length):0;
  const opsLine=(label,value,color,route)=>`<a href="#/${route}" class="p-3 rounded-lg block" style="background:${color}12;border:1px solid ${color}44;text-decoration:none;color:inherit"><div class="text-[10px] uppercase tracking-wider font-black" style="color:${color}">${label}</div><div class="text-2xl font-black mt-1" style="color:${color}">${value}</div></a>`;
  const opsDashboardSocietes=soc?[soc]:SOCIETES;
  window._opsSocLists={};
  const societeRows=opsDashboardSocietes.map(s=>{const eff=(db.agents||[]).filter(a=>a.societe===s&&!employeeIsFormer(a));const aff=eff.filter(agentHasLiveAffectation);const sans=eff.filter(a=>!agentHasLiveAffectation(a));const st=sitesActifs.filter(x=>siteBelongsToPrimarySociete(x,s));const inc=incidentsOuverts.filter(i=>i.societe===s||st.some(site=>site.id===i.siteId));window._opsSocLists[s]={eff,aff,sans,inc};return{soc:s,eff:eff.length,aff:aff.length,sans:sans.length,sites:st.length,inc:inc.length}});
  // Présents par site (feuille du jour)
  const _presentsBySite={};
  fpqToday.forEach(f=>{if(fpqPresenceCode(f.heureArrivee)==="P"){const k=f.siteName||"Sans site affecté";_presentsBySite[k]=(_presentsBySite[k]||0)+1;}});
  const _affectesBySite={};
  affectes.forEach(a=>{const aff=agentLiveAffectation(a);const k=aff?.siteName||"Sans site affecté";_affectesBySite[k]=(_affectesBySite[k]||0)+1;});
  const _siteStatKeys=[...new Set([...Object.keys(_presentsBySite),...Object.keys(_affectesBySite),...sitesActifs.map(s=>s.nom||s.intitule||"—")])].sort((a,b)=>a.localeCompare(b));
  const _siteStatRows=_siteStatKeys.map(k=>{const pres=_presentsBySite[k]||0;const aff=_affectesBySite[k]||0;const total=Math.max(aff,pres);const taux=total?Math.round(pres/total*100):0;const bar=total?`<div style="height:6px;background:#e2e8f0;border-radius:3px;width:80px;display:inline-block;vertical-align:middle"><div style="height:100%;border-radius:3px;background:${taux>=80?"#16a34a":taux>=50?"#f59e0b":"#dc2626"};width:${taux}%"></div></div>`:"-";return`<tr><td class="font-semibold text-sm">${escapeHTML(k)}</td><td class="text-center font-bold text-emerald-700 text-sm">${pres}</td><td class="text-center text-sm text-slate-500">${aff||"—"}</td><td class="text-center text-xs">${total?`<span class="font-bold" style="color:${taux>=80?"#16a34a":taux>=50?"#ca8a04":"#dc2626"}">${taux}%</span> ${bar}`:"-"}</td></tr>`;}).join("");
  // Compteurs statut du jour
  const _absCodes=new Set(["A","AB","A1","A2","A3"]);
  const _fpqAbsList=fpqToday.filter(f=>{const c=fpqPresenceCode(f.heureArrivee)||String(f.heureArrivee||"").toUpperCase();return _absCodes.has(c);});
  const _fpqMalList=fpqToday.filter(f=>(fpqPresenceCode(f.heureArrivee)||String(f.heureArrivee||"").toUpperCase())==="M");
  const _fpqSuspList=fpqToday.filter(f=>(fpqPresenceCode(f.heureArrivee)||String(f.heureArrivee||"").toUpperCase())==="S");
  const _sanctionList=ag.filter(a=>(a.gestionEvents||[]).some(e=>["Mise en demeure","Sanction"].includes(e.type)&&(e.statut==="en_cours"||e.statut==="approuve")));
  window._opsStatLists={
    absents:_fpqAbsList.map(f=>{const a=(db.agents||[]).find(x=>x.id===f.agentId);return{nom:(a?.nom||"")+" "+(a?.prenom||""),mat:a?.matricule||"—",site:f.siteName||"—",code:f.heureArrivee||"A"};}),
    malades:_fpqMalList.map(f=>{const a=(db.agents||[]).find(x=>x.id===f.agentId);return{nom:(a?.nom||"")+" "+(a?.prenom||""),mat:a?.matricule||"—",site:f.siteName||"—",code:"M"};}),
    suspendus:_fpqSuspList.map(f=>{const a=(db.agents||[]).find(x=>x.id===f.agentId);return{nom:(a?.nom||"")+" "+(a?.prenom||""),mat:a?.matricule||"—",site:f.siteName||"—",code:"S"};}),
    sanctions:_sanctionList.map(a=>{const ev=(a.gestionEvents||[]).filter(e=>["Mise en demeure","Sanction"].includes(e.type)&&(e.statut==="en_cours"||e.statut==="approuve")).pop();return{nom:(a.nom||"")+" "+(a.prenom||""),mat:a.matricule||"—",site:agentLiveAffectation(a)?.siteName||"—",code:ev?.type||"Sanction"};})
  };
  const ICON_USERS='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  const ICON_CHECK='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>';
  const ICON_X='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>';
  const ICON_TARGET='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>';
  const ICON_PIN='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
  const ICON_ALERT='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
  const opsKpi=(label,value,iconSvg,color,subtext,action,id,hot)=>`<button type="button" ${action?`onclick="${action}"`:""} class="ops-strip-seg${hot?" hot":""}" style="cursor:${action?"pointer":"default"}"><div class="ops-strip-seg-head"><span style="color:${hot?"#fde3b0":color}">${iconSvg}</span><span class="ops-strip-seg-lbl">${label}${hot?'<span class="ops-strip-seg-live"></span>':""}</span></div><div ${id?`id="${id}"`:""} class="ops-strip-seg-val">${value}</div><div class="ops-strip-seg-sub">${subtext}</div></button>`;
  const presenceBase=Math.max(fpqToday.length,fpqPresent+_fpqAbsList.length+_fpqMalList.length+_fpqSuspList.length,1);
  const _siteStatRowsNew=_siteStatKeys.map(k=>{
    const pres=_presentsBySite[k]||0;const aff=_affectesBySite[k]||0;const total=Math.max(aff,pres);
    const pct=total?Math.round(pres*100/total):0;const color=pct>=80?"#16a34a":pct>=50?"#d97706":"#dc2626";
    return`<div class="ops-dash-site-row"><div class="ops-dash-site-name">${escapeHTML(k)}</div><div class="ops-dash-site-metric"><b>${pres}</b><small>Présents</small></div><div class="ops-dash-site-metric" title="${aff} affecté(s)"><div class="ops-dash-cov-track"><div class="ops-dash-cov-fill" style="width:${pct}%;background:${color}"></div></div><span class="ops-dash-cov-pct" style="color:${color}">${total?pct+"%":"—"}</span></div></div>`;
  }).join("");
  view.innerHTML=`<div class="ops-dash-hero"><div class="ops-dash-hero-row"><div><div class="ops-dash-eyebrow">Pilotage opérationnel</div><h1>Tableau de bord OPS</h1><div class="ops-dash-hero-sub"><span>${soc?escapeHTML(soc):"Toutes sociétés"} · situation du ${formatDate(td)}</span><span class="ops-dash-live"><span class="ops-dash-live-dot"></span>Temps réel</span></div></div><button class="ops-dash-refresh" onclick="renderView()">↻ Actualiser</button></div></div>
  <div class="ops-strip">
    ${opsKpi("Effectif actif",dashboardActive,ICON_USERS,"#043970","Employés en activité",societeRows.length===1?`openOpsSocModal('${encodeURIComponent(societeRows[0].soc)}','eff')`:"")}
    ${opsKpi("Présents",fpqPresent,ICON_CHECK,"#166534","Aujourd'hui","navigate('pointage/feuille')")}
    ${opsKpi("Absents",_fpqAbsList.length,ICON_X,"#991b1b","Aujourd'hui","openOpsStatModal('absents')")}
    ${opsKpi("Affectés",dashboardAffectes,ICON_TARGET,"#1e40af",`${tauxAffectation}% de l'effectif`,"navigate('effectif/actifs')")}
    ${opsKpi("Sites actifs",dashboardSitesActifs,ICON_PIN,"#5b21b6","Périmètre opérationnel","navigate('sites/actifs')")}
    ${opsKpi("Alertes critiques","…",ICON_ALERT,"#92400e","Temps réel","document.getElementById('opsAttendanceAlertsCard')?.scrollIntoView({behavior:'smooth'})","opsAlertsKpi",true)}
  </div>
  <div class="ops-dash-row2">
    <div class="ops-dash-card">
      <div class="ops-dash-card-head"><div><h3>Présence aujourd'hui</h3><p>Répartition de la feuille quotidienne</p></div></div>
      <div class="ops-dash-card-body">
        <div class="ops-dash-donut-wrap">
          <div class="ops-dash-donut-figure"><svg width="148" height="148" viewBox="0 0 148 148"><circle cx="74" cy="74" r="60" fill="none" stroke="#eef3f9" stroke-width="16"/><g id="opsDonutArcs"></g></svg><div class="ops-dash-donut-center"><b id="opsDonutPct">${tauxPointage}%</b><span>pointé</span></div></div>
          <div class="ops-dash-legend" id="opsDonutLegend"></div>
        </div>
      </div>
    </div>
    <div class="ops-dash-card">
      <div class="ops-dash-card-head"><div><h3>Situation des sites</h3><p>Présents comparés aux effectifs affectés</p></div><a href="#/sites/actifs" class="ops-dash-alert-open">Tous les sites</a></div>
      <div class="ops-dash-card-body"><div class="ops-dash-site-list" style="max-height:230px;overflow:auto">${_siteStatKeys.length?_siteStatRowsNew:`<div class="text-slate-400 text-sm text-center py-8">Aucune donnée de présence aujourd'hui.</div>`}</div></div>
    </div>
  </div>
  <div class="ops-dash-card" style="margin-bottom:24px" id="opsAttendanceAlertsCard">
    <div class="ops-dash-card-head"><div><h3>Centre d'alertes</h3><p>Présences prolongées et volumes hebdomadaires</p></div></div>
    <div class="ops-dash-alert-toolbar">
      <div class="ops-dash-seg" id="opsAlertSeg">
        <button type="button" class="active" onclick="setOpsAlertFilter(this,'all')">Toutes</button>
        <button type="button" onclick="setOpsAlertFilter(this,'presence')">Présence prolongée</button>
        <button type="button" onclick="setOpsAlertFilter(this,'weekly')">Volume hebdo.</button>
      </div>
      <div style="flex:1"></div>
      <select id="opsAlertSort" class="ops-dash-sel" onchange="renderOpsAttendanceAlerts()"><option value="duration">Durée décroissante</option><option value="site">Site</option><option value="name">Nom</option></select>
    </div>
    <div id="opsAttendanceAlertsBody" class="ops-dash-alert-feed"><div class="text-sm text-slate-400 p-2">Chargement…</div></div>
  </div>
  <div class="ops-dash-section-lbl">Accès rapide</div>
  <div class="ops-dash-quick">
    <a href="#/pointage/feuille" class="ops-dash-quick-card"><div class="ops-dash-quick-icon" style="background:#dbeafe;color:#1e40af">🕒</div><div><div class="ops-dash-quick-title" style="color:#1e40af">Pointage</div><div class="ops-dash-quick-sub">Feuille quotidienne · Saisie manuelle · Récap</div></div></a>
    <a href="#/fiches/toutes" class="ops-dash-quick-card"><div class="ops-dash-quick-icon" style="background:#dcfce7;color:#166534">🪪</div><div><div class="ops-dash-quick-title" style="color:#166534">Fiches de position</div><div class="ops-dash-quick-sub">Toutes · Actifs · Archivées</div></div></a>
    <a href="#/sites/actifs" class="ops-dash-quick-card"><div class="ops-dash-quick-icon" style="background:#fef3c7;color:#92400e">📍</div><div><div class="ops-dash-quick-title" style="color:#92400e">Sites</div><div class="ops-dash-quick-sub">Création · Sites actifs</div></div></a>
  </div>`;
  renderOpsPresenceDonut({presents:fpqPresent,absents:_fpqAbsList.length,maladie:_fpqMalList.length,suspendus:_fpqSuspList.length});
  clearInterval(window._opsAttendanceAlertsTimer);
  loadOpsAttendanceAlerts();
  window._opsAttendanceAlertsTimer=setInterval(loadOpsAttendanceAlerts,60000);
}

function renderOpsPresenceDonut(counts){
  const segs=[
    {label:"Présents",value:counts.presents||0,color:"#16a34a",action:"navigate('pointage/feuille')"},
    {label:"Absents",value:counts.absents||0,color:"#dc2626",action:"openOpsStatModal('absents')"},
    {label:"Maladie",value:counts.maladie||0,color:"#d97706",action:"openOpsStatModal('malades')"},
    {label:"Suspendus",value:counts.suspendus||0,color:"#7c3aed",action:"openOpsStatModal('suspendus')"}
  ];
  const total=segs.reduce((s,x)=>s+x.value,0);
  const r=60,circ=2*Math.PI*r,gapDeg=total?2.2:0;
  let offsetDeg=0;
  const arcsEl=document.getElementById("opsDonutArcs");
  if(arcsEl){
    arcsEl.innerHTML=total?segs.filter(s=>s.value>0).map(s=>{
      const frac=s.value/total;const segDeg=Math.max(0,frac*360-gapDeg);const segLen=(segDeg/360)*circ;
      const rotate=offsetDeg;offsetDeg+=frac*360;
      return`<circle cx="74" cy="74" r="${r}" fill="none" stroke="${s.color}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${segLen} ${circ-segLen}" transform="rotate(${rotate} 74 74)"/>`;
    }).join(""):"";
  }
  const legend=document.getElementById("opsDonutLegend");
  if(legend)legend.innerHTML=segs.map(s=>`<button type="button" class="ops-dash-legend-row" onclick="${s.action}"><span class="ops-dash-legend-dot" style="background:${s.color}"></span><span class="ops-dash-legend-label">${s.label}</span><span class="ops-dash-legend-val">${s.value}</span><span class="ops-dash-legend-pct">${total?Math.round(s.value*100/total):0}%</span></button>`).join("");
}

function setOpsAlertFilter(btn,value){
  window._opsAlertType=value;
  document.querySelectorAll("#opsAlertSeg button").forEach(b=>b.classList.toggle("active",b===btn));
  renderOpsAttendanceAlerts();
}

async function loadOpsAttendanceAlerts(){
  const body=document.getElementById("opsAttendanceAlertsBody");
  if(!body){clearInterval(window._opsAttendanceAlertsTimer);return}
  try{
    const data=await sgdiApi("/api/portal/attendance-alerts");
    window._opsAttendanceAlertsData={presence:data.presence_alerts||[],weekly:data.weekly_alerts||[]};
    const total=window._opsAttendanceAlertsData.presence.length+window._opsAttendanceAlertsData.weekly.length;
    const kpi=document.getElementById("opsAlertsKpi");if(kpi)kpi.textContent=String(total);
    renderOpsAttendanceAlerts();
  }catch(e){body.innerHTML='<span class="text-slate-400">Alertes indisponibles.</span>';console.warn("Alertes de présence indisponibles",e)}
}

function opsAlertInitials(name){return String(name||"?").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()}

function renderOpsAttendanceAlerts(){
  const body=document.getElementById("opsAttendanceAlertsBody");if(!body)return;
  const data=window._opsAttendanceAlertsData||{presence:[],weekly:[]};const type=window._opsAlertType||"all";const sort=document.getElementById("opsAlertSort")?.value||"duration";
  let rows=[];
  if(type!=="weekly")rows.push(...data.presence.map(a=>({...a,type:"presence",minutes:Number(a.elapsed_minutes||0),duration:`${Math.floor(Number(a.elapsed_minutes||0)/60)} h ${String(Number(a.elapsed_minutes||0)%60).padStart(2,"0")}`,level:Number(a.threshold_hours||0)>=16?"Critique":Number(a.threshold_hours||0)>=12?"Élevé":"Vigilance"})));
  if(type!=="presence")rows.push(...data.weekly.map(a=>({...a,type:"weekly",minutes:Number(a.week_minutes||a.week_hours*60||0),duration:`${a.week_hours||0} h`,level:"Hebdomadaire"})));
  if(sort==="name")rows.sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||""),"fr"));else if(sort==="site")rows.sort((a,b)=>String(a.site||"").localeCompare(String(b.site||""),"fr"));else rows.sort((a,b)=>b.minutes-a.minutes);
  if(!rows.length){body.innerHTML='<div class="text-center text-slate-400 py-7">✓ Aucune alerte en cours.</div>';return}
  const visible=window._opsAlertsExpanded?rows:rows.slice(0,5);
  const sevStyle={Critique:["#dc2626","#fee2e2","#991b1b"],"Élevé":["#d97706","#ffedd5","#9a3412"],Hebdomadaire:["#7c3aed","#ede9fe","#5b21b6"],Vigilance:["#1e40af","#fef9c3","#854d0e"]};
  body.innerHTML=visible.map(a=>{
    const sev=sevStyle[a.level]||sevStyle.Vigilance;
    return`<div class="ops-dash-alert-item" style="--sev-c:${sev[0]}">
      <div class="ops-dash-alert-avatar">${opsAlertInitials(a.nom)}</div>
      <div><div class="ops-dash-alert-name">${escapeHTML(a.nom||"Employé")}</div><div class="ops-dash-alert-meta">${escapeHTML(a.matricule||"—")} · ${escapeHTML(a.site||"—")}</div></div>
      <div class="ops-dash-alert-right">
        <div class="ops-dash-alert-duration">${escapeHTML(a.duration)}<small>Durée</small></div>
        <span class="ops-dash-sev-pill" style="color:${sev[2]};background:${sev[1]}">${escapeHTML(a.level)}</span>
        <button class="ops-dash-alert-open" onclick="navigate('pointage/feuille')">Ouvrir</button>
      </div>
    </div>`;
  }).join("")+(rows.length>5?`<div class="text-center mt-1"><button class="ops-dash-alert-open" onclick="window._opsAlertsExpanded=!window._opsAlertsExpanded;renderOpsAttendanceAlerts()">${window._opsAlertsExpanded?"Réduire":"Voir toutes les alertes ("+rows.length+")"}</button></div>`:"");
}

function renderSuperviseur(view,sub,arg){
  if(!canAccess("superviseur")){view.innerHTML=`<div class="card p-6">Accès refusé</div>`;return}
  if(sub&&sub!=="dashboard"){renderOPS(view,sub,arg);return}
  const soc=currentStructureSocieteFilter();
  const sites=siteOpsSitesForScope(soc);
  const agents=(db.agents||[]).filter(a=>(!soc||normalizeSocieteName(a.societe)===normalizeSocieteName(soc))&&agentInSupervisorScope(a)&&!ficheAgentIsSortantArchive(a));
  // Sites/agents vides ne veut pas forcément dire "aucun périmètre" : peut être le chargement
  // initial encore en cours. On déclenche/observe le rechargement partagé (déjà utilisé par la
  // Saisie quotidienne) au lieu d'afficher tout de suite un message d'erreur permanent.
  const supDataLoading=(!sites.length||!agents.length)&&(typeof _ptSupervisorDataLoading!=="undefined"&&_ptSupervisorDataLoading||(typeof ptSupervisorEnsureDataForEmptyView==="function"&&ptSupervisorEnsureDataForEmptyView(soc)));
  const todayRows=(db.feuillePresence||[]).filter(f=>f.date===today()&&(!soc||normalizeSocieteName(f.societe||"")===normalizeSocieteName(soc))&&(!supervisorAuthorizedSiteIds()||supervisorAuthorizedSiteIds().has(String(f.siteBackendId||f.siteId||""))));
  const pointes=todayRows.filter(f=>fpqPresenceCode(f.heureArrivee)).length;
  const presents=todayRows.filter(f=>fpqPresenceCode(f.heureArrivee)==="P").length;
  const absents=todayRows.filter(f=>["A","AB"].includes(fpqPresenceCode(f.heureArrivee))).length;
  const kpi=(label,value,route,color,desc)=>`<a href="#/${route}" class="card p-4 block" style="text-decoration:none;color:inherit;border-left:4px solid ${color}"><div class="text-xs uppercase font-black text-slate-500">${label}</div><div class="text-3xl font-black mt-1" style="color:${color}">${value}</div><div class="text-xs text-slate-500 mt-1">${desc||""}</div></a>`;
  view.innerHTML=`<div class="flex items-start justify-between gap-3 mb-5 flex-wrap">
    <div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Module terrain</div><h1 class="text-2xl font-black uppercase mt-1">Tableau de bord superviseur</h1><p class="text-sm text-slate-500">Sites à charge, personnel rattaché, feuille quotidienne et pointage mensuel.</p></div>
    <div class="flex gap-2 flex-wrap"><button class="topbar-dialogue-btn pointage-dialogue-style-btn" onclick="navigate('pointage/saisie')">Feuille quotidienne</button><button class="topbar-dialogue-btn pointage-dialogue-style-btn" onclick="navigate('pointage/feuille')">Pointage mensuel</button><button class="topbar-dialogue-btn pointage-dialogue-style-btn" onclick="navigate('fiches')">Fiches employés</button></div>
  </div>
  ${opsSupervisorReadOnlyNoticeHTML()}
  <div class="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
    ${kpi("Sites à charge",sites.length,"sites/actifs","#0f766e","Périmètre autorisé")}
    ${kpi("Employés rattachés",agents.length,"effectif/actifs","#043970","Personnel des sites")}
    ${kpi("Lignes du jour",todayRows.length,"pointage/saisie","#2563eb",formatDate(today()))}
    ${kpi("Présents",presents,"pointage/saisie","#16a34a",pointes+" pointé(s)")}
    ${kpi("Absents",absents,"pointage/saisie","#dc2626","Feuille du jour")}
  </div>
  <div class="card overflow-hidden mb-4">
    <h3 class="font-black p-4 pb-0 mb-2">Sites à charge</h3>
    ${sites.length?`<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-xs text-slate-400 uppercase bg-slate-50"><th class="px-3 py-2 text-left">Dénomination du site</th><th class="px-3 py-2 text-center">Nbr Contrat</th><th class="px-3 py-2 text-center">Nbr Réalisé</th><th class="px-3 py-2 text-center">Nbr Surplus</th><th class="px-3 py-2 text-center">Nbr Manque</th><th class="px-3 py-2 text-center">Rotation</th><th class="px-3 py-2 text-left">Contact site</th></tr></thead><tbody>${sites.map(s=>{
      const metric=siteBackendMetricForSite(s);
      const contact=[s.contact?.nom,s.contact?.telephone].filter(Boolean).join(" · ");
      return `<tr><td class="px-3 py-2"><a href="#/sites/${siteEditRouteId(s)}" class="font-semibold" style="color:inherit;text-decoration:none">${escapeHTML(s.nom||s.intitule||"Site")}</a><div class="text-xs text-slate-500">${escapeHTML(sitePrimarySociete(s)||"")} · ${escapeHTML(s.commune||s.wilaya||"")}</div></td><td class="px-3 py-2 text-center font-bold">${metric.contractual||0}</td><td class="px-3 py-2 text-center font-bold">${metric.realized||0}</td><td class="px-3 py-2 text-center font-bold ${metric.surplus>0?"text-orange-600":""}">${metric.surplus>0?"+"+metric.surplus:0}</td><td class="px-3 py-2 text-center font-bold ${metric.missing>0?"text-red-600":""}">${metric.missing>0?"−"+metric.missing:0}</td><td class="px-3 py-2 text-center">${escapeHTML(s.rotationSystem||"—")}</td><td class="px-3 py-2 text-xs text-slate-600">${escapeHTML(contact||"—")}</td></tr>`;
    }).join("")}</tbody></table></div>`:(supDataLoading?`<div class="p-4 text-sm text-slate-500">Chargement des sites et effectifs…</div>`:`<div class="p-4 text-sm text-slate-500">Aucun site autorisé. Cochez les sites dans Administration système > Utilisateurs.</div>`)}
  </div>
  <div class="card p-4"><h3 class="font-black mb-3">Personnel rattaché</h3>${agents.length?agents.slice(0,12).map(a=>`<a href="#/agents/${a.id}" class="flex items-center justify-between p-3 rounded border mb-2" style="text-decoration:none;color:inherit;background:#fff"><span><b>${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())}</b><br><small class="text-slate-500">${escapeHTML(a.matricule||"")} · ${escapeHTML(agentLiveAffectation(a)?.siteName||"Sans site")}</small></span><span class="pill pill-green">${escapeHTML(employeeDisplayStatus(a).label||a.statut||"")}</span></a>`).join(""):(supDataLoading?`<div class="text-sm text-slate-500">Chargement des effectifs…</div>`:`<div class="text-sm text-slate-500">Aucun employé rattaché aux sites autorisés.</div>`)}${agents.length>12?`<button class="btn btn-secondary text-xs mt-2" onclick="navigate('effectif/actifs')">Voir les ${agents.length} employés</button>`:""}</div>`;
}

function openOpsSocModal(socEncoded,type){
  const soc=decodeURIComponent(socEncoded);
  const lists=(window._opsSocLists||{})[soc]||{};
  const titles={eff:"Effectif actif",aff:"Affectés",sans:"En instance (sans affectation)",inc:"Incidents ouverts"};
  const colors={eff:"#043970",aff:"#16a34a",sans:"#ea580c",inc:"#dc2626"};
  const title=`${titles[type]||type} — ${soc}`;
  const color=colors[type]||"#043970";
  const agents=type==="inc"?null:(lists[type]||[]);
  const incidents=type==="inc"?(lists.inc||[]):null;
  let body;
  if(type==="inc"){
    body=incidents.length?`<table class="w-full text-sm"><thead><tr class="text-xs text-slate-400 uppercase bg-slate-50"><th class="px-3 py-2 text-left">Titre</th><th class="px-3 py-2 text-left">Site</th><th class="px-3 py-2 text-left">Statut</th></tr></thead><tbody>${incidents.map(i=>`<tr><td class="px-3 py-2 font-semibold">${escapeHTML(i.titre||i.title||"—")}</td><td class="px-3 py-2 text-xs text-slate-500">${escapeHTML(i.siteName||"—")}</td><td class="px-3 py-2"><span class="pill pill-red">${escapeHTML(i.statut||"ouvert")}</span></td></tr>`).join("")}</tbody></table>`:`<div class="text-center text-slate-400 py-8">Aucun incident ouvert.</div>`;
  }else{
    body=agents.length?`<table class="w-full text-sm"><thead><tr class="text-xs text-slate-400 uppercase bg-slate-50"><th class="px-3 py-2 text-left">Employé</th><th class="px-3 py-2 text-left">Matricule</th><th class="px-3 py-2 text-left">Site</th><th class="px-3 py-2 text-left">Poste</th></tr></thead><tbody>${agents.map(a=>`<tr><td class="px-3 py-2 font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</td><td class="px-3 py-2 font-mono text-xs">${escapeHTML(a.matricule||"—")}</td><td class="px-3 py-2 text-xs text-slate-500">${escapeHTML(agentLiveAffectation(a)?.siteName||"—")}</td><td class="px-3 py-2 text-xs">${escapeHTML(a.fonction||a.affectationCourante?.poste||"—")}</td></tr>`).join("")}</tbody></table>`:`<div class="text-center text-slate-400 py-8">Aucun employé dans cette catégorie.</div>`;
  }
  openModal(`<div class="flex items-center gap-3 mb-4"><div class="text-2xl font-black" style="color:${color}">${type==="inc"?(incidents?.length||0):(agents?.length||0)}</div><div><div class="font-black text-sm">${escapeHTML(title)}</div></div></div><div class="overflow-auto" style="max-height:60vh">${body}</div><div class="flex justify-end mt-3"><button class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function renderOpsInstanceDotation(view){
  const soc=currentStructureSocieteFilter();
  const agents=agentsEnInstanceDotationForSoc(soc);
  const actifs=(db.agents||[]).filter(a=>employeeIsActive(a)&&(!soc||a.societe===soc));
  view.innerHTML=`<div class="flex justify-between items-center mb-4 flex-wrap gap-3">
    <div><h1 class="text-2xl font-black uppercase">EMPLOYÉS EN INSTANCE DE DOTATION</h1><p class="text-slate-500 text-sm">${soc?escapeHTML(soc):"Toutes sociétés"} · Suivi OPS uniquement. La dotation est réservée au module Matériel.</p></div>
    <div class="flex gap-2 flex-wrap"><button class="btn btn-secondary text-sm" onclick="navigate('ops/dashboard')">← Tableau de bord</button></div>
  </div>
  <div class="card p-4 mb-4" style="background:#fff7ed;border-left:5px solid #f59e0b">
    <div class="font-black text-amber-800 uppercase text-sm">Suivi uniquement</div>
    <div class="text-xs text-amber-800 mt-1">OPS consulte l'état des employés en attente. La création de dotation, la déduction du stock et l'impression de fiche de dotation se font uniquement dans Matériel.</div>
  </div>
  <div class="grid grid-3 gap-3 mb-4">
    <div class="card p-4 ${agents.length?"ops-dot-counter-alert":""}"><div class="text-xs text-slate-500 uppercase font-black">En instance de dotation</div><div class="text-3xl font-black mt-1 text-red-700">${agents.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-black">Effectif actif</div><div class="text-3xl font-black mt-1">${actifs.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase font-black">Déjà dotés</div><div class="text-3xl font-black mt-1 text-emerald-700">${actifs.filter(agentHasMaterialDotation).length}</div></div>
  </div>
  <div class="card overflow-hidden">
    <table><thead><tr><th>Employé</th><th>Code</th><th>Société</th><th>Poste</th><th>Site</th><th>Statut</th><th>Suivi</th></tr></thead>
    <tbody>${agents.length===0?`<tr><td colspan="7" class="text-center text-slate-500 p-6">Aucun employé en instance de dotation.</td></tr>`:agents.map(a=>`<tr data-searchable>
      <td><div class="flex items-center gap-2"><div class="avatar">${a.photo?`<img src="${a.photo}"/>`:escapeHTML((a.prenom||a.nom||"?").slice(0,1))}</div><div><div class="font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</div><div class="text-xs text-slate-500">${escapeHTML(a.telephone||"")}</div></div></div></td>
      <td class="font-mono font-bold">${escapeHTML(a.matricule||"—")}</td>
      <td class="text-xs">${escapeHTML(a.societe||"—")}</td>
      <td class="text-xs">${escapeHTML(a.affectationCourante?.poste||a.fonction||"—")}</td>
      <td class="text-xs">${escapeHTML(a.affectationCourante?.siteName||"—")}</td>
      <td><span class="pill pill-amber">En attente Matériel</span></td>
      <td><div class="flex gap-1 flex-wrap"><a class="btn btn-ghost text-xs" href="#/effectif/agent/${a.id}">Fiche</a></div></td>
    </tr>`).join("")}</tbody></table>
  </div>`;
}

function missionDureeLabel(m){
  if(!m)return"";
  if(!m.dateDebut||!m.dateFin)return"";
  const days=missionDayCount(m.dateDebut,m.dateFin);
  if(days)return days+" jour"+(days>1?"s":"");
  return m.duree||"";
}

function missionDayCount(dateDebut,dateFin){
  if(!dateDebut||!dateFin)return 0;
  const a=new Date(dateDebut+"T00:00:00"),b=new Date(dateFin+"T00:00:00");
  if(isNaN(a)||isNaN(b)||b<a)return 0;
  return Math.round((b-a)/86400000)+1;
}

function updateOpsMissionDays(){
  const form=document.getElementById("ops-mission-form");
  if(!form)return;
  const days=missionDayCount(form.dateDebut?.value||"",form.dateFin?.value||"");
  if(form.nombreJours)form.nombreJours.value=days?String(days):"";
  const hint=document.getElementById("ops-mission-days-hint");
  if(hint)hint.textContent=days?`${days} jour${days>1?"s":""} de mission`:"Sélectionnez une date début et une date fin valides.";
}

function missionDureeLabelLegacy(m){
  if(!m)return"";
  if(m.duree)return m.duree;
  if(!m.dateDebut||!m.dateFin)return"";
  const a=new Date(m.dateDebut+"T00:00:00"),b=new Date(m.dateFin+"T00:00:00");
  if(isNaN(a)||isNaN(b))return"";
  const days=Math.max(1,Math.round((b-a)/86400000)+1);
  return days+" jour"+(days>1?"s":"");
}

function opsMissionTargets(){
  const soc=currentStructureSocieteFilter()||session?.societe||"";
  return (db.agents||[]).filter(a=>(!soc||a.societe===soc)&&!["sortant","demissionne","licencie","archive"].includes(String(a.statut||"").toLowerCase())).sort((a,b)=>String((a.nom||"")+" "+(a.prenom||"")).localeCompare(String((b.nom||"")+" "+(b.prenom||"")),"fr"));
}

function opsMissionEmployeeOptions(selectedId){
  return opsMissionTargets().map(a=>{
    const label=[a.matricule||"",((a.nom||"")+" "+(a.prenom||"")).trim(),a.societe||"",a.affectationCourante?.siteName||""].filter(Boolean).join(" - ");
    return `<option value="${escapeHTML(a.id)}" ${String(a.id)===String(selectedId||"")?"selected":""}>${escapeHTML(label)}</option>`;
  }).join("")||`<option value="">Aucun employé disponible</option>`;
}

function filterOpsMissionEmployeeOptions(q){
  const needle=String(q||"").trim().toLowerCase();
  const select=document.getElementById("ops-mission-agent-select");if(!select)return;
  const current=select.value;
  const list=opsMissionTargets().filter(a=>{
    const text=[a.matricule,a.nom,a.prenom,a.societe,a.fonction,a.affectationCourante?.siteName].filter(Boolean).join(" ").toLowerCase();
    return !needle||text.includes(needle);
  });
  select.innerHTML=list.map(a=>{
    const label=[a.matricule||"",((a.nom||"")+" "+(a.prenom||"")).trim(),a.societe||"",a.affectationCourante?.siteName||""].filter(Boolean).join(" - ");
    return `<option value="${escapeHTML(a.id)}">${escapeHTML(label)}</option>`;
  }).join("")||`<option value="">Aucun employé trouvé</option>`;
  if(list.some(a=>String(a.id)===String(current)))select.value=current;
  else if(list[0])select.value=list[0].id;
  updateOpsMissionEmployeeInfo();
}

function updateOpsMissionEmployeeInfo(){
  const select=document.getElementById("ops-mission-agent-select");
  const box=document.getElementById("ops-mission-employee-info");
  if(!select||!box)return;
  const a=(db.agents||[]).find(x=>String(x.id)===String(select.value));
  if(!a){box.innerHTML="";return}
  const full=((a.nom||"")+" "+(a.prenom||"")).trim();
  box.innerHTML=`<div class="p-3 rounded bg-slate-50 border border-slate-200 text-sm"><b>${escapeHTML(full||"Employé")}</b><div class="text-xs text-slate-500">${escapeHTML(a.matricule||"—")} · ${escapeHTML(a.societe||"—")} · ${escapeHTML(a.affectationCourante?.siteName||"Sans site")}</div></div>`;
  const lieu=document.querySelector('#ops-mission-form [name="lieu"]');
  if(lieu&&!lieu.value)lieu.value=a.affectationCourante?.siteName||"";
}

function openOpsMissionDocument(id){
  const m=(db.missions||[]).find(x=>String(x.id)===String(id));
  if(!m){toast("Mission introuvable","error");return}
  if(!m.agentId){toast("Employé obligatoire pour archiver l'ordre de mission","error");return}
  const w=window.open("","_blank","width=900,height=700");
  if(!w){toast("Fenêtre d'impression bloquée par le navigateur","error");return}
  w.document.write(opsMissionDocumentHTML(m));
  w.document.close();
}

function opsMissionLoadingHTML(){
  return `<!doctype html><html><head><meta charset="utf-8"><title>Préparation OM</title></head><body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f8fafc;color:#043970;min-height:100vh;display:flex;align-items:center;justify-content:center"><div style="text-align:center"><div style="font-size:22px;font-weight:900;margin-bottom:8px">Préparation de l'ordre de mission...</div><div style="font-size:13px;color:#64748b">Veuillez patienter quelques secondes.</div></div></body></html>`;
}

function openOpsMissionModal(id){
  if(guardOpsSupervisorMutation("mission","Accès superviseur OPS : création/modification mission non autorisée."))return;
  if(!db.missions)db.missions=[];
  const soc=currentStructureSocieteFilter()||session?.societe||"";
  const editing=id?(db.missions||[]).find(m=>String(m.id)===String(id)):null;
  const first=opsMissionTargets()[0]||{};
  const m=editing||{date:today(),agentId:first.id||"",lieu:first.affectationCourante?.siteName||"",dateDebut:today(),dateFin:today(),motif:"",transport:"",accompagnateur:"",autresMoyens:"",consignes:"",societe:soc,numero:nextMissionNumero()};
  openModal(`<div class="flex items-start justify-between gap-3 mb-3 flex-wrap"><div><h3 class="font-bold text-lg">MISSION OPS</h3><div class="text-xs text-slate-500">Création de l'ordre de mission et archivage dans le dossier employé.</div></div><div style="min-width:230px"><label class="label">Référence</label><input class="input bg-slate-50 font-mono font-bold" name="numero" form="ops-mission-form" value="${escapeHTML(m.numero||nextMissionNumero())}" readonly/></div></div>
    <form id="ops-mission-form" onsubmit="event.preventDefault();saveOpsMission('${editing?editing.id:""}',this,true)">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="md:col-span-2"><label class="label">Barre de recherche</label><input class="input" placeholder="Nom, prénom, matricule, site..." oninput="filterOpsMissionEmployeeOptions(this.value)"/></div>
        <div class="md:col-span-2"><label class="label">Employé concerné (Nom Prénom)</label><select id="ops-mission-agent-select" class="select" name="agentId" required onchange="updateOpsMissionEmployeeInfo()">${opsMissionEmployeeOptions(m.agentId)}</select></div>
        <div id="ops-mission-employee-info" class="md:col-span-2"></div>
        <div class="md:col-span-2"><label class="label">Lieu de la mission</label><input class="input" name="lieu" value="${escapeHTML(m.lieu||"")}" required/></div>
        <div><label class="label">Date début de la mission</label><input class="input" type="date" name="dateDebut" value="${escapeHTML(m.dateDebut||today())}" required onchange="updateOpsMissionDays()" oninput="updateOpsMissionDays()"/></div>
        <div><label class="label">Heure de début</label><input class="input" type="time" name="heureDebut" value="${escapeHTML(m.heureDebut||"00:00")}" required/></div>
        <div><label class="label">Date fin de la mission</label><input class="input" type="date" name="dateFin" value="${escapeHTML(m.dateFin||today())}" required onchange="updateOpsMissionDays()" oninput="updateOpsMissionDays()"/></div>
        <div><label class="label">Heure de fin</label><input class="input" type="time" name="heureFin" value="${escapeHTML(m.heureFin||"23:59")}" required/></div>
        <div class="md:col-span-2"><label class="label">Nombre de jour</label><input class="input bg-slate-50 font-bold" name="nombreJours" value="${escapeHTML(String(missionDayCount(m.dateDebut||today(),m.dateFin||today())||""))}" readonly/><div id="ops-mission-days-hint" class="text-xs text-slate-500 mt-1">${escapeHTML(missionDureeLabel(m)||"")}</div></div>
        <div class="md:col-span-2"><label class="label">Motif de la mission</label><textarea class="input" name="motif" rows="3" required>${escapeHTML(m.motif||m.objet||"")}</textarea></div>
        <div><label class="label">Moyens de transport</label><input class="input" name="transport" value="${escapeHTML(m.transport||"")}" placeholder="Véhicule, taxi, transport personnel..."/></div>
        <div><label class="label">Accompagnateur</label><input class="input" name="accompagnateur" value="${escapeHTML(m.accompagnateur||"")}"/></div>
        <div class="md:col-span-2"><label class="label">Autres moyens</label><input class="input" name="autresMoyens" value="${escapeHTML(m.autresMoyens||"")}"/></div>
        <div class="md:col-span-2"><label class="label">Consignes et Instructions</label><textarea class="input" name="consignes" rows="4">${escapeHTML(m.consignes||"")}</textarea></div>
      </div>
      <div class="flex justify-end gap-2 mt-4 flex-wrap"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button id="ops-mission-edit-btn" type="submit" class="btn btn-primary">Valider et transmettre à SG</button></div>
    </form>`);
  opsModuleTimeout(()=>{updateOpsMissionEmployeeInfo();updateOpsMissionDays()},30);
}

function opsMissionEndDate(m){
  if(!m?.dateFin)return null;
  const d=new Date(`${m.dateFin}T${m.heureFin||"23:59"}:00`);
  return isNaN(d)?null:d;
}

function opsMissionStatus(m){
  if(m?.statut==="cloturee")return{key:"cloturee",label:"Clôturée",cls:"pill-gray"};
  if(m?.workflowStatus==="transmise_ops")return{key:"a_preparer",label:"À préparer",cls:"pill-amber"};
  if(m?.workflowStatus==="transmise_sg")return{key:"transmise_sg",label:"Transmise à SG",cls:"pill-blue"};
  if(m?.workflowStatus==="validee_sg")return{key:"validee_sg",label:"Validée par SG",cls:"pill-green"};
  if(m?.workflowStatus==="executee")return{key:"executee",label:"Exécutée",cls:"pill-green"};
  const now=new Date(),start=m?.dateDebut?new Date(`${m.dateDebut}T${m.heureDebut||"00:00"}:00`):null,end=opsMissionEndDate(m);
  if(start&&!isNaN(start)&&start>now)return{key:"planifiee",label:"Planifiée",cls:"pill-amber"};
  if(end&&end<now)return{key:"terminee",label:"À clôturer",cls:"pill-red"};
  return{key:"encours",label:"En cours",cls:"pill-green"};
}

function opsMissionNeedsEndAlert(m){
  if(!m||m.statut==="cloturee"||m.extensionDeclinedAt)return false;
  const end=opsMissionEndDate(m);if(!end)return false;
  const remaining=end.getTime()-Date.now();
  return remaining>=0&&remaining<=86400000;
}

function opsMissionJournalRowsHTML(m,readOnly){
  const rows=(Array.isArray(m.journal)?m.journal:[]).slice().sort((a,b)=>(String(b.date||"")+String(b.heure||"")).localeCompare(String(a.date||"")+String(a.heure||"")));
  if(!rows.length)return`<tr><td colspan="6" class="p-8 text-center text-slate-500">Aucun événement enregistré pour cette mission.</td></tr>`;
  return rows.map(row=>`<tr><td class="text-xs whitespace-nowrap">${formatDate(row.date)}</td><td class="font-mono text-xs">${escapeHTML(row.heure||"—")}</td><td><span class="pill ${row.type==="Urgence"?"pill-red":row.type==="Incident"?"pill-amber":"pill-gray"}">${escapeHTML(row.type||"Information")}</span></td><td style="white-space:pre-wrap">${escapeHTML(row.detail||"")}</td><td class="text-xs text-slate-500">${escapeHTML(row.auteur||"—")}</td><td class="text-right">${readOnly?"":`<button class="btn btn-ghost text-xs" type="button" onclick="deleteOpsMissionJournalEntry('${escapeHTML(m.id)}','${escapeHTML(row.id)}')">Supprimer</button>`}</td></tr>`).join("");
}

function openOpsMissionDetail(id){
  const m=(db.missions||[]).find(x=>String(x.id)===String(id));
  if(!m){toast("Mission introuvable","error");return}
  if(!Array.isArray(m.journal))m.journal=[];
  if(!Array.isArray(m.prolongations))m.prolongations=[];
  const a=(db.agents||[]).find(x=>String(x.id)===String(m.agentId))||{};
  const full=((a.nom||"")+" "+(a.prenom||"")).trim()||m.agentName||"—";
  const status=opsMissionStatus(m),readOnly=isOpsSupervisorReadOnlySession();
  const alert=opsMissionNeedsEndAlert(m)?`<div class="p-4 rounded-xl mb-4 flex items-center justify-between gap-3 flex-wrap" style="background:#fff7ed;border:1px solid #fb923c"><div><div class="font-black text-orange-800">⚠ FIN DE MISSION DANS MOINS DE 24 HEURES</div><div class="text-sm text-orange-700">Fin prévue le ${formatDate(m.dateFin)} à ${escapeHTML(m.heureFin||"23:59")}. Voulez-vous prolonger la mission ?</div></div>${readOnly?"":`<div class="flex gap-2"><button class="btn btn-primary" onclick="openOpsMissionExtension('${escapeHTML(m.id)}')">OUI</button><button class="btn btn-ghost" onclick="declineOpsMissionExtension('${escapeHTML(m.id)}')">NON</button></div>`}</div>`:"";
  openModal(`<div class="flex items-start justify-between gap-4 mb-4 flex-wrap"><div><div class="text-xs uppercase font-black tracking-widest text-slate-500">Suivi opérationnel</div><h2 class="text-2xl font-black">${escapeHTML(m.numero||"MISSION OPS")}</h2><div class="text-sm text-slate-500">${escapeHTML(full)} · ${escapeHTML(a.matricule||"")} · ${escapeHTML(m.lieu||"—")}</div></div><div class="flex gap-2 items-center"><span class="pill ${status.cls}">${status.label}</span><button class="btn btn-ghost" onclick="closeModal()">Fermer</button></div></div>
    ${alert}
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4"><div class="card p-3"><div class="text-xs text-slate-500 uppercase font-bold">Début</div><div class="font-black">${formatDate(m.dateDebut)} · ${escapeHTML(m.heureDebut||"00:00")}</div></div><div class="card p-3"><div class="text-xs text-slate-500 uppercase font-bold">Fin prévue</div><div class="font-black">${formatDate(m.dateFin)} · ${escapeHTML(m.heureFin||"23:59")}</div></div><div class="card p-3"><div class="text-xs text-slate-500 uppercase font-bold">Responsable</div><div class="font-black">${escapeHTML(m.responsable||session?.username||"OPS")}</div></div><div class="card p-3"><div class="text-xs text-slate-500 uppercase font-bold">Prolongations</div><div class="font-black">${m.prolongations.length}</div></div></div>
    <section class="card p-4 mb-4"><div class="text-xs uppercase font-black tracking-widest text-slate-500 mb-3">Détail de la mission</div><div class="grid grid-cols-1 md:grid-cols-2 gap-3"><div><div class="text-xs uppercase font-bold text-slate-500">Objet / motif</div><div class="font-bold mt-1" style="white-space:pre-wrap">${escapeHTML(m.objet||m.motif||"—")}</div></div><div><div class="text-xs uppercase font-bold text-slate-500">Lieu</div><div class="font-bold mt-1">${escapeHTML(m.lieu||"—")}</div></div><div class="md:col-span-2"><div class="text-xs uppercase font-bold text-slate-500">Description détaillée</div><div class="mt-1" style="white-space:pre-wrap">${escapeHTML(m.details||m.detail||"Aucun détail complémentaire.")}</div></div><div class="md:col-span-2"><div class="text-xs uppercase font-bold text-slate-500">Consignes particulières</div><div class="mt-1" style="white-space:pre-wrap">${escapeHTML(m.consignes||"Aucune consigne particulière.")}</div></div><div><div class="text-xs uppercase font-bold text-slate-500">Transport</div><div class="mt-1">${escapeHTML(m.transport||"—")}</div></div><div><div class="text-xs uppercase font-bold text-slate-500">Accompagnateur / autres moyens</div><div class="mt-1">${escapeHTML([m.accompagnateur,m.autresMoyens].filter(Boolean).join(" · ")||"—")}</div></div></div></section>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <section class="lg:col-span-2 card overflow-hidden"><div class="p-4 border-b flex justify-between items-center"><div><h3 class="font-black">Déroulement de la mission</h3><div class="text-xs text-slate-500">Journal chronologique, horodaté et attribué</div></div></div><div class="overflow-auto" style="max-height:48vh"><table><thead><tr><th>Date</th><th>Heure</th><th>Type</th><th>Détail</th><th>Auteur</th><th></th></tr></thead><tbody>${opsMissionJournalRowsHTML(m,readOnly)}</tbody></table></div></section>
      <aside class="card p-4">${readOnly?opsSupervisorReadOnlyNoticeHTML():`<h3 class="font-black mb-3">Ajouter un événement</h3><form onsubmit="event.preventDefault();addOpsMissionJournalEntry('${escapeHTML(m.id)}',this)"><div class="grid grid-cols-2 gap-2"><div><label class="label">Date</label><input class="input" type="date" name="date" value="${today()}" required></div><div><label class="label">Heure</label><input class="input" type="time" name="heure" value="${new Date().toTimeString().slice(0,5)}" required></div></div><label class="label mt-3">Nature</label><select class="select" name="type"><option>Information</option><option>Instruction</option><option>Incident</option><option>Urgence</option></select><label class="label mt-3">Détail opérationnel</label><textarea class="input" name="detail" rows="6" required placeholder="Décrivez précisément l'action, le constat ou l'instruction..."></textarea><button class="btn btn-primary w-full mt-3">Ajouter au journal</button></form><div class="border-t mt-5 pt-4 grid gap-2"><button class="btn btn-secondary" onclick="openOpsMissionExtension('${escapeHTML(m.id)}')">Prolonger la mission</button>${m.statut==="cloturee"?"":`<button class="btn btn-primary" style="background:#166534" onclick="openOpsMissionClosure('${escapeHTML(m.id)}')">Clôturer la mission</button>`}</div>`}</aside>
    </div>`);
  opsModuleTimeout(()=>{const modal=document.querySelector("#modal-host .modal");if(modal)modal.style.cssText="width:calc(100vw - 32px);max-width:none;height:calc(100vh - 32px);overflow:auto;padding:24px"},0);
}

async function addOpsMissionJournalEntry(id,form){
  if(guardOpsSupervisorMutation("mission","Accès superviseur OPS : suivi mission non autorisé."))return;
  const m=(db.missions||[]).find(x=>String(x.id)===String(id));if(!m)return;
  const fd=new FormData(form),detail=String(fd.get("detail")||"").trim();if(!detail)return;
  if(!Array.isArray(m.journal))m.journal=[];
  m.journal.push({id:uid("mission_event"),date:String(fd.get("date")||today()),heure:String(fd.get("heure")||""),type:String(fd.get("type")||"Information"),detail,auteur:session?.username||"OPS",createdAt:new Date().toISOString()});
  m.updatedAt=new Date().toISOString();
  if(!(await saveDBAndWaitToast("Événement de mission non confirmé")))return;
  toast("Événement ajouté au journal","success");openOpsMissionDetail(id);
}

async function deleteOpsMissionJournalEntry(id,eventId){
  if(guardOpsSupervisorMutation("mission","Accès superviseur OPS : suppression non autorisée."))return;
  if(!confirm("Supprimer cette ligne du journal ?"))return;
  const m=(db.missions||[]).find(x=>String(x.id)===String(id));if(!m)return;
  m.journal=(m.journal||[]).filter(x=>String(x.id)!==String(eventId));
  if(!(await saveDBAndWaitToast("Suppression non confirmée")))return;openOpsMissionDetail(id);
}

function openOpsMissionExtension(id){
  const m=(db.missions||[]).find(x=>String(x.id)===String(id));if(!m)return;
  openModal(`<h3 class="font-black text-xl mb-1">Prolonger la mission</h3><p class="text-sm text-slate-500 mb-4">La période précédente sera conservée dans l'historique.</p><form onsubmit="event.preventDefault();saveOpsMissionExtension('${escapeHTML(id)}',this)"><div class="grid grid-cols-2 gap-3"><div><label class="label">Nouvelle date de fin</label><input class="input" type="date" name="dateFin" min="${escapeHTML(m.dateFin||today())}" value="${escapeHTML(m.dateFin||today())}" required></div><div><label class="label">Nouvelle heure de fin</label><input class="input" type="time" name="heureFin" value="${escapeHTML(m.heureFin||"23:59")}" required></div></div><label class="label mt-3">Motif de la prolongation</label><textarea class="input" name="motif" rows="4" required></textarea><div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="openOpsMissionDetail('${escapeHTML(id)}')">Annuler</button><button class="btn btn-primary">Confirmer la prolongation</button></div></form>`);
}

async function saveOpsMissionExtension(id,form){
  if(guardOpsSupervisorMutation("mission","Accès superviseur OPS : prolongation non autorisée."))return;
  const m=(db.missions||[]).find(x=>String(x.id)===String(id));if(!m)return;
  const fd=new FormData(form),dateFin=String(fd.get("dateFin")||""),heureFin=String(fd.get("heureFin")||"");
  const nextEnd=new Date(`${dateFin}T${heureFin}:00`),currentEnd=opsMissionEndDate(m);
  if(isNaN(nextEnd)||currentEnd&&nextEnd<=currentEnd){toast("La nouvelle fin doit être postérieure à la fin actuelle","error");return}
  if(!Array.isArray(m.prolongations))m.prolongations=[];if(!Array.isArray(m.journal))m.journal=[];
  const motif=String(fd.get("motif")||"").trim(),now=new Date().toISOString();
  m.prolongations.push({id:uid("extension"),ancienneDateFin:m.dateFin,ancienneHeureFin:m.heureFin||"23:59",nouvelleDateFin:dateFin,nouvelleHeureFin:heureFin,motif,auteur:session?.username||"OPS",createdAt:now});
  m.journal.push({id:uid("mission_event"),date:today(),heure:new Date().toTimeString().slice(0,5),type:"Instruction",detail:`Mission prolongée du ${formatDate(m.dateFin)} ${m.heureFin||"23:59"} au ${formatDate(dateFin)} ${heureFin}. Motif : ${motif}`,auteur:session?.username||"OPS",createdAt:now});
  m.dateFin=dateFin;m.heureFin=heureFin;m.nombreJours=missionDayCount(m.dateDebut,m.dateFin);m.duree=missionDureeLabel(m);m.extensionDeclinedAt="";m.updatedAt=now;
  if(!(await saveDBAndWaitToast("Prolongation non confirmée")))return;toast("Mission prolongée","success");openOpsMissionDetail(id);renderSidebar();
}

async function declineOpsMissionExtension(id){
  if(guardOpsSupervisorMutation("mission","Accès superviseur OPS : décision non autorisée."))return;
  const m=(db.missions||[]).find(x=>String(x.id)===String(id));if(!m)return;
  const now=new Date().toISOString();m.extensionDeclinedAt=now;if(!Array.isArray(m.journal))m.journal=[];
  m.journal.push({id:uid("mission_event"),date:today(),heure:new Date().toTimeString().slice(0,5),type:"Information",detail:"Prolongation refusée. La mission prendra fin à la date prévue.",auteur:session?.username||"OPS",createdAt:now});
  if(!(await saveDBAndWaitToast("Décision non confirmée")))return;toast("Fin de mission maintenue","success");openOpsMissionDetail(id);
}

function openOpsMissionClosure(id){
  openModal(`<h3 class="font-black text-xl mb-1">Clôturer la mission</h3><p class="text-sm text-slate-500 mb-4">Le compte rendu final sera conservé dans le journal opérationnel.</p><form onsubmit="event.preventDefault();closeOpsMission('${escapeHTML(id)}',this)"><label class="label">Résultat</label><select class="select" name="resultat" required><option value="accomplie">Mission accomplie</option><option value="partielle">Partiellement accomplie</option><option value="non_accomplie">Non accomplie</option></select><label class="label mt-3">Compte rendu final</label><textarea class="input" name="rapport" rows="7" required></textarea><div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="openOpsMissionDetail('${escapeHTML(id)}')">Annuler</button><button class="btn btn-primary">Valider la clôture</button></div></form>`);
}

async function closeOpsMission(id,form){
  if(guardOpsSupervisorMutation("mission","Accès superviseur OPS : clôture non autorisée."))return;
  const m=(db.missions||[]).find(x=>String(x.id)===String(id));if(!m)return;
  const fd=new FormData(form),now=new Date().toISOString(),resultat=String(fd.get("resultat")||"accomplie"),rapport=String(fd.get("rapport")||"").trim();if(!rapport)return;
  m.statut="cloturee";m.cloture={resultat,rapport,auteur:session?.username||"OPS",date:now};if(!Array.isArray(m.journal))m.journal=[];
  m.journal.push({id:uid("mission_event"),date:today(),heure:new Date().toTimeString().slice(0,5),type:"Information",detail:`Clôture — ${resultat.replaceAll("_"," ")} : ${rapport}`,auteur:session?.username||"OPS",createdAt:now});m.updatedAt=now;
  if(!(await saveDBAndWaitToast("Clôture non confirmée")))return;toast("Mission clôturée","success");openOpsMissionDetail(id);renderSidebar();
}

function renderOpsMissions(view,arg){
  _renderOpsMissionsHTML(view,arg);
  if(sgdiAuthToken())syncMissionWorkflowCollections(["missions"]).then(()=>{
    if(document.body.contains(view)&&/ops\/missions/.test(location.hash))_renderOpsMissionsHTML(view,arg);
  }).catch(e=>{console.warn("Synchronisation des missions OPS indisponible",e);toast("Missions OPS non synchronisées : "+(e.message||e),"warning")});
}

function _renderOpsMissionsHTML(view,arg){
  if(!db.missions)db.missions=[];
  const opsReadOnly=isOpsSupervisorReadOnlySession();
  const soc=currentStructureSocieteFilter();
  const missions=(db.missions||[]).filter(m=>!soc||normalizeSocieteName(m.societe||"")===normalizeSocieteName(soc)).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  const activeMissions=missions.filter(x=>opsMissionStatus(x).key==="encours");
  const plannedMissions=missions.filter(x=>x.dateDebut&&x.dateDebut>today());
  const urgentMissions=missions.filter(x=>/urgent|intervention/i.test([x.motif,x.nature,x.objet,x.consignes].join(" ")));
  const endingMissions=missions.filter(opsMissionNeedsEndAlert);
  const withEmployee=missions.filter(x=>x.agentId).length;
  const missionKpi=(label,n,bg,color,icon,sub)=>`<div class="ops-dash-kpi" style="cursor:default"><div class="ops-dash-kpi-icon" style="background:${bg};color:${color}">${icon}</div><div class="ops-dash-lbl">${escapeHTML(label)}</div><div class="ops-dash-val">${n}</div><div class="ops-dash-sub">${escapeHTML(sub||"Suivi missions")}</div></div>`;
  view.innerHTML=`<div class="ops-dash-hero"><div class="ops-dash-hero-row"><div><div class="ops-dash-eyebrow">Pilotage opérationnel</div><h1>Missions OPS</h1><div class="ops-dash-hero-sub"><span>Création, suivi, ordres de mission et archivage employé · ${soc?escapeHTML(soc):"Toutes sociétés"}</span></div></div>${opsReadOnly?"":`<button class="ops-dash-refresh" onclick="openOpsMissionModal()">＋ Nouvelle mission</button>`}</div></div>
  ${opsSupervisorReadOnlyNoticeHTML()}
  ${endingMissions.length?`<div class="section-banner banner-amber">⚠ ${endingMissions.length} mission${endingMissions.length>1?"s":""} se termine${endingMissions.length>1?"nt":""} dans moins de 24 heures — ${endingMissions.map(m=>`<button class="ops-dash-alert-open" style="margin-left:6px" onclick="openOpsMissionDetail('${escapeHTML(m.id)}')">${escapeHTML(m.numero||"Mission")} · Décider</button>`).join(" ")}</div>`:""}
  <div class="ops-dash-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    ${missionKpi("Total missions",missions.length,"#dbeafe","#043970","🗂","Toutes les missions")}
    ${missionKpi("En cours",activeMissions.length,"#dcfce7","#166534","▶","Actives aujourd'hui")}
    ${missionKpi("Planifiées",plannedMissions.length,"#fef3c7","#92400e","📅","À venir")}
    ${missionKpi("Urgentes",urgentMissions.length,"#fee2e2","#991b1b","⚠","Intervention / urgent")}
  </div>
  <div class="ops-dash-card">
    <div class="ops-dash-card-head"><div><h3>Liste des missions OPS</h3><p>${missions.length} mission${missions.length>1?"s":""} enregistrée${missions.length>1?"s":""}</p></div></div>
    <div class="ops-dash-card-body" style="overflow-x:auto"><table><thead><tr><th>N°</th><th>Employé</th><th>Lieu</th><th>Début</th><th>Fin</th><th>Motif</th><th class="text-right">Actions</th></tr></thead><tbody>
      ${missions.length?missions.map(x=>{const a=(db.agents||[]).find(g=>String(g.id)===String(x.agentId))||{};const full=((a.nom||"")+" "+(a.prenom||"")).trim()||x.agentName||"—",status=opsMissionStatus(x),needsPreparation=x.workflowStatus==="transmise_ops"||!x.agentId;return`<tr data-searchable><td class="font-mono font-bold text-xs">${escapeHTML(x.numero||"")}<div class="mt-1"><span class="pill ${status.cls}">${status.label}</span></div></td><td><div class="font-semibold">${escapeHTML(full)}</div><div class="text-[10px] text-slate-500">${escapeHTML(a.matricule||"")}</div></td><td class="text-xs">${escapeHTML(x.lieu||"—")}</td><td class="text-xs">${formatDate(x.dateDebut)}<br><span class="text-slate-500">${escapeHTML(x.heureDebut||"00:00")}</span></td><td class="text-xs">${formatDate(x.dateFin)}<br><span class="text-slate-500">${escapeHTML(x.heureFin||"23:59")}</span></td><td class="text-xs">${escapeHTML(x.motif||x.objet||"")}</td><td class="text-right"><button type="button" class="btn btn-ghost text-lg leading-none px-3" title="Actions" onclick="event.stopPropagation();openOpsMissionActions(this,'${jsString(x.id)}')">⋯</button></td></tr>`}).join(""):`<tr><td colspan="7" class="text-center text-slate-500 p-4">Aucune mission enregistrée.</td></tr>`}
    </tbody></table></div>
  </div>`;
  if(endingMissions.length){
    const alertKey="ops-mission-ending-"+endingMissions.map(m=>m.id).sort().join("-");
    if(!sessionStorage.getItem(alertKey))opsModuleTimeout(()=>{sessionStorage.setItem(alertKey,"1");toast(`${endingMissions.length} mission${endingMissions.length>1?"s se terminent":" se termine"} dans moins de 24 heures`,"warning")},150);
  }
  if(arg&&!opsReadOnly)opsModuleTimeout(()=>openOpsMissionModal(arg),50);
}

function openOpsMissionActions(btn,id){
  document.querySelectorAll(".ops-mission-row-menu").forEach(menu=>menu.remove());
  const mission=(db.missions||[]).find(item=>String(item.id)===String(id));if(!mission)return;
  const rect=btn.getBoundingClientRect(),readOnly=isOpsSupervisorReadOnlySession(),needsPreparation=mission.workflowStatus==="transmise_ops"||!mission.agentId;
  const actionStyle="display:block;width:100%;text-align:left;padding:10px 15px;font-size:12px;font-weight:800;background:#fff;border:0;cursor:pointer;color:#0f172a";
  const close="document.querySelectorAll('.ops-mission-row-menu').forEach(menu=>menu.remove());";
  const menu=document.createElement("div");menu.className="ops-mission-row-menu";
  menu.style.cssText=`position:fixed;left:${Math.max(8,rect.right-190)}px;top:${rect.bottom+4}px;z-index:9999;background:#fff;border:1px solid #dbe3ef;border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.18);min-width:190px;overflow:hidden`;
  menu.innerHTML=`<button style="${actionStyle}" onclick="${close}openOpsMissionDetail('${jsString(id)}')">Détail</button>${readOnly?"":`<button style="${actionStyle}" onclick="${close}openOpsMissionModal('${jsString(id)}')">${needsPreparation?"Préparer OM":"Modifier OM"}</button>`}${mission.agentId?`<button style="${actionStyle}" onclick="${close}openOpsMissionDocument('${jsString(id)}')">Ordre de mission</button>`:""}${!readOnly&&mission.workflowStatus!=="executee"?`<button style="${actionStyle};color:#047857" onclick="${close}markOpsMissionExecuted('${jsString(id)}')">✓ Exécutée</button>`:""}`;
  document.body.appendChild(menu);
  opsModuleTimeout(()=>(document.removeEventListener("click",opsMissionDismiss),document.addEventListener("click",opsMissionDismiss,{once:true})),0);
}

async function markOpsMissionExecuted(id){
  if(guardOpsSupervisorMutation("mission","Accès superviseur OPS : validation d’exécution non autorisée."))return;
  const mission=(db.missions||[]).find(item=>String(item.id)===String(id));if(!mission)return;
  if(!confirm(`Confirmer que la mission ${mission.numero||""} est exécutée et autoriser sa facturation ?`))return;
  const now=new Date().toISOString();
  const updated={...mission,workflowStatus:"executee",statut:"executee",executedAt:now,executedBy:session?.username||"OPS",updatedAt:now,audit:[...(mission.audit||[]),{action:"Mission déclarée exécutée par OPS — information transmise à SG, DG et Facturation",at:now,by:session?.username||"OPS"}]};
  try{
    await syncMissionWorkflowCollections(["missionBillables"]).catch(()=>{});
    let billable=(db.missionBillables||[]).find(item=>String(item.missionId)===String(id));
    if(billable){
      const nextBillable={...billable,status:"prete_a_facturer",executedAt:now,executedBy:session?.username||"OPS",updatedAt:now};
      await sgdiApi(`/api/irongs/collections/missionBillables/items/${encodeURIComponent(billable.id)}`,{method:"PATCH",body:{data:nextBillable},legacy:false});
      Object.assign(billable,nextBillable);
    }else{
      billable={id:uid("mission_billable"),missionId:id,missionNumber:mission.numero||"",societe:mission.societe||"",clientId:mission.clientId||"",clientName:mission.clientName||"",designation:mission.objet||mission.motif||"Mission exécutée",dateDebut:mission.dateDebut||"",dateFin:mission.dateFin||"",quantity:1,unit:"Mission",priceHT:Number(mission.financial?.salePriceHT||0),vatRate:Number(mission.financial?.vatRate||19),priceTTC:Number(mission.financial?.salePriceTTC||0),status:"prete_a_facturer",executedAt:now,executedBy:session?.username||"OPS",createdAt:now,updatedAt:now};
      await sgdiApi("/api/irongs/collections/missionBillables/items",{method:"POST",body:{data:billable},legacy:false});
      db.missionBillables=db.missionBillables||[];db.missionBillables.unshift(billable);
    }
    await sgdiApi(`/api/irongs/collections/missions/items/${encodeURIComponent(id)}`,{method:"PATCH",body:{data:updated},legacy:false});
  }catch(e){toast("Exécution non transmise : "+(e.message||e),"error");return}
  Object.assign(mission,updated);
  toast("Mission exécutée : SG, DG et Facturation ont été informés","success");renderView();renderSidebar();
}

async function saveOpsMission(id,form,openDoc){
  if(guardOpsSupervisorMutation("mission","Accès superviseur OPS : création/modification mission non autorisée."))return;
  if(!db.missions)db.missions=[];
  form=form||document.getElementById("ops-mission-form")||document.querySelector("#view form");if(!form)return;
  const editBtn=form.querySelector("#ops-mission-edit-btn");
  if(editBtn){editBtn.disabled=true;editBtn.textContent="Préparation..."}
  const docWindow=openDoc?window.open("","_blank","width=900,height=700"):null;
  if(openDoc&&!docWindow){toast("Fenêtre d'impression bloquée par le navigateur","error");return}
  if(docWindow){docWindow.document.write(opsMissionLoadingHTML());docWindow.document.close()}
  const fd=new FormData(form);
  let m=id?db.missions.find(x=>String(x.id)===String(id)):null;
  const creating=!m;
  if(!m){m={id:uid("mission"),createdAt:new Date().toISOString(),societe:currentStructureSocieteFilter()||session?.societe||""};db.missions.unshift(m)}
  const a=(db.agents||[]).find(x=>String(x.id)===String(fd.get("agentId")));
  m.numero=fd.get("numero")||m.numero||nextMissionNumero();
  m.date=fd.get("date")||m.date||today();
  m.agentId=fd.get("agentId")||"";
  m.agentName=a?((a.nom||"")+" "+(a.prenom||"")).trim():(m.agentName||"");
  m.lieu=(fd.get("lieu")||"").trim();
  m.dateDebut=fd.get("dateDebut")||"";
  m.heureDebut=fd.get("heureDebut")||m.heureDebut||"00:00";
  m.dateFin=fd.get("dateFin")||"";
  m.heureFin=fd.get("heureFin")||m.heureFin||"23:59";
  const missionDays=missionDayCount(m.dateDebut,m.dateFin);
  if(!missionDays){toast("Date fin de mission invalide","error");if(docWindow)docWindow.close();return}
  const missionStart=new Date(`${m.dateDebut}T${m.heureDebut}:00`),missionEnd=new Date(`${m.dateFin}T${m.heureFin}:00`);
  if(isNaN(missionStart)||isNaN(missionEnd)||missionEnd<=missionStart){toast("La fin de mission doit être postérieure au début","error");if(docWindow)docWindow.close();return}
  m.nombreJours=missionDays;
  m.motif=(fd.get("motif")||"").trim();
  m.objet=m.motif;
  m.nature="Ordre de mission OPS";
  m.transport=(fd.get("transport")||"").trim();
  m.accompagnateur=(fd.get("accompagnateur")||"").trim();
  m.autresMoyens=(fd.get("autresMoyens")||"").trim();
  m.consignes=(fd.get("consignes")||"").trim();
  m.duree=missionDureeLabel(m);
  m.societe=m.societe||currentStructureSocieteFilter()||session?.societe||a?.societe||"";
  m.workflowStatus="transmise_sg";
  m.opsOrderValidatedAt=new Date().toISOString();
  m.opsOrderValidatedBy=session?.username||"OPS";
  if(!Array.isArray(m.audit))m.audit=[];
  m.audit.push({action:"Ordre de mission validé par OPS et transmis à SG",at:m.opsOrderValidatedAt,by:m.opsOrderValidatedBy});
  m.updatedAt=new Date().toISOString();
  if(docWindow){docWindow.document.open();docWindow.document.write(opsMissionDocumentHTML(m));docWindow.document.close();}
  try{
    await sgdiApi("/api/irongs/collections/missions/items"+(creating?"":"/"+encodeURIComponent(m.id)),{method:creating?"POST":"PATCH",body:{data:m},legacy:false});
  }catch(e){if(editBtn){editBtn.disabled=false;editBtn.textContent="Valider et transmettre à SG"}toast("Mission OPS non confirmée : "+(e.message||e),"error");return}
  closeModal();toast("Ordre de mission validé et transmis à SG","success");
  renderView();
}

async function deleteOpsMission(id){
  if(guardOpsSupervisorMutation("mission","Accès superviseur OPS : suppression mission non autorisée."))return;
  const mission=(db.missions||[]).find(m=>String(m.id)===String(id));
  if(mission?.source==="dc"){toast("Une mission créée par DC doit rester dans l’historique. Annulez-la ou clôturez-la sans la supprimer.","warning");return}
  if(!confirm("Supprimer cette mission OPS ?"))return;
  db.missions=(db.missions||[]).filter(m=>String(m.id)!==String(id));
  if(!(await saveDBAndWaitToast("Suppression mission OPS non confirmée")))return;
  toast("Mission OPS supprimée","success");
  renderView();
}

function inspectionSiteName(siteId){const s=(db.sites||[]).find(x=>x.id===siteId);return s?(s.nom||s.intitule||"Site"):(siteId||"Site");}

function inspectionSupervisorName(agentId){const a=(db.agents||[]).find(x=>x.id===agentId);return a?(((a.matricule||"")+" · "+(a.nom||"")+" "+(a.prenom||"")).trim()):(agentId||"");}

function inspectionElapsed(scan){
  if(!scan||!scan.entree||!scan.sortie)return"";
  const a=new Date(scan.entree),b=new Date(scan.sortie);if(isNaN(a)||isNaN(b)||b<a)return"";
  const mins=Math.round((b-a)/60000),h=Math.floor(mins/60),m=mins%60;
  return (h?h+"h ":"")+String(m).padStart(2,"0")+"min";
}

function inspectionStatusHTML(i){
  const scans=i.scans||{};const total=(i.siteIds||[]).length;const done=(i.siteIds||[]).filter(id=>scans[id]?.entree&&scans[id]?.sortie).length;
  const missing=(i.siteIds||[]).filter(id=>!scans[id]?.entree).length;
  if(i.type==="programmee"&&i.date<=today()&&missing)return`<span class="pill pill-red">Alerte passage non respecté</span>`;
  if(done===total&&total)return`<span class="pill pill-green">Terminée</span>`;
  if(Object.values(scans).some(x=>x?.entree))return`<span class="pill">En cours</span>`;
  return`<span class="pill">Programmée</span>`;
}

function inspectionTabs(active){
  const tabs=isOpsSupervisorReadOnlySession()?[["programmees","Inspections programmées"],["inopinees","Inspections inopinées"]]:[["programmer","Programmer une Inspection"],["programmees","Inspections programmées"],["inopinees","Inspections inopinées"]];
  return`<div class="flex gap-2 flex-wrap mb-5">${tabs.map(t=>`<button class="btn ${active===t[0]?"btn-primary":"btn-secondary"}" onclick="navigate('ops/supervision/${t[0]}')">${t[1]}</button>`).join("")}</div>`;
}

function inspectionProgramMonth(){return sessionStorage.getItem("inspectionProgramMonth")||today().slice(0,7)}

function setInspectionProgramMonth(v){sessionStorage.setItem("inspectionProgramMonth",v||today().slice(0,7));renderView()}

function inspectionMonthDates(ym){
  const parts=String(ym||today().slice(0,7)).split("-").map(Number);const y=parts[0]||new Date().getFullYear(),m=parts[1]||new Date().getMonth()+1;
  const n=new Date(y,m,0).getDate();return Array.from({length:n},(_,i)=>ym+"-"+String(i+1).padStart(2,"0"));
}

function inspectionCalendarHTML(ym){
  const dates=inspectionMonthDates(ym);const first=new Date(dates[0]+"T00:00:00").getDay();const offset=first;
  const blanks=Array.from({length:offset},()=>`<div></div>`).join("");
  return`<div class="rounded-lg border bg-white p-3"><div class="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-500 mb-2"><div>DIM</div><div>LUN</div><div>MAR</div><div>MER</div><div>JEU</div><div>VEN</div><div>SAM</div></div><div class="grid grid-cols-7 gap-1">${blanks}${dates.map(d=>{const day=d.slice(8);const dow=new Date(d+"T00:00:00").getDay();const weekend=[5,6].includes(dow);return`<div class="rounded-md border p-1 text-xs" style="min-height:66px;background:${weekend?'#f8fafc':'#fff'}"><label class="flex items-center gap-1 font-bold cursor-pointer"><input type="checkbox" name="inspectionDates" value="${d}"/>${day}</label><input class="input mt-1" type="time" name="inspectionTime_${d}" style="height:28px;font-size:11px;padding:2px 4px" title="Horaire inspection ${d}"/></div>`}).join("")}</div></div>`;
}

function inspectionVehicleOptions(){
  const src=[...(db.materiel||[]),...(db.stockArticles||[])];
  const found=src.map(x=>x.nom||x.designation||x.libelle||x.article||"").filter(v=>/vehicule|véhicule|voiture|auto|camion|moto|fourgon|pick/i.test(v));
  const base=["Véhicule 01","Véhicule 02","Véhicule 03","Moto 01","Autre"];
  return [...new Set([...found,...base])];
}

function inspectionDriverOptions(supervisors){
  const agents=(db.agents||[]).filter(a=>!["sortant","demissionne","licencie","archive"].includes(a.statut));
  const drivers=agents.filter(a=>/chauffeur|conducteur|driver/i.test([a.fonction,a.poste,a.affectationCourante?.poste].filter(Boolean).join(" ")));
  return drivers.length?drivers:agents;
}

function inspectionSupervisorStats(supervisorId,inspections){
  const list=(inspections||[]).filter(i=>i.supervisorId===supervisorId);
  const programmed=list.filter(i=>i.type==="programmee");const unexpected=list.filter(i=>i.type==="inopinee");
  const finished=list.filter(i=>(i.siteIds||[]).length&&(i.siteIds||[]).every(id=>(i.scans||{})[id]?.entree&&(i.scans||{})[id]?.sortie));
  const alerts=list.filter(i=>i.type==="inopinee"||(i.type==="programmee"&&i.date<=today()&&(i.siteIds||[]).some(id=>!(i.scans||{})[id]?.entree)));
  return{total:list.length,programmed:programmed.length,unexpected:unexpected.length,finished:finished.length,alerts:alerts.length,history:list.sort((a,b)=>String(b.date||b.createdAt||"").localeCompare(String(a.date||a.createdAt||""))).slice(0,5)};
}

function inspectionSupervisorSpaceHTML(supervisors,inspections){
  const active=supervisors.filter(a=>(inspections||[]).some(i=>i.supervisorId===a.id));
  const data=(active.length?active:supervisors.slice(0,6));
  return`<div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-5">${data.map(a=>{const st=inspectionSupervisorStats(a.id,inspections);return`<div class="card p-4"><div class="flex items-start justify-between gap-3"><div><div class="font-black">${escapeHTML((a.matricule? a.matricule+" · ":"")+(a.nom||"")+" "+(a.prenom||""))}</div><div class="text-xs text-slate-500">Espace superviseur · historique & statistiques</div></div><span class="pill">${st.total}</span></div><div class="grid grid-cols-4 gap-2 mt-3"><div class="text-center rounded bg-blue-50 p-2"><div class="text-[10px] font-black text-blue-700">Prog.</div><div class="font-black text-blue-700">${st.programmed}</div></div><div class="text-center rounded bg-purple-50 p-2"><div class="text-[10px] font-black text-purple-700">Inop.</div><div class="font-black text-purple-700">${st.unexpected}</div></div><div class="text-center rounded bg-emerald-50 p-2"><div class="text-[10px] font-black text-emerald-700">Finies</div><div class="font-black text-emerald-700">${st.finished}</div></div><div class="text-center rounded bg-red-50 p-2"><div class="text-[10px] font-black text-red-700">Alertes</div><div class="font-black text-red-700">${st.alerts}</div></div></div><div class="mt-3 text-xs">${st.history.length?st.history.map(i=>`<div class="flex justify-between border-t py-1"><span>${formatDate(i.date)} · ${escapeHTML((i.siteIds||[]).map(inspectionSiteName).join(', '))}</span><b>${i.type==='inopinee'?'Inopinée':'Programmée'}</b></div>`).join(""):`<div class="text-slate-500">Aucun historique pour le moment.</div>`}</div></div>`}).join("")}</div>`;
}

function renderOpsSupervisionDashboard(view,soc,sites,supervisors,inspections){
  const opsReadOnly=isOpsSupervisorReadOnlySession();
  const programmed=inspections.filter(i=>i.type==="programmee");
  const unexpected=inspections.filter(i=>i.type==="inopinee");
  const todayIns=inspections.filter(i=>i.date===today());
  const finished=inspections.filter(i=>(i.siteIds||[]).length&&(i.siteIds||[]).every(id=>(i.scans||{})[id]?.entree&&(i.scans||{})[id]?.sortie));
  const alerts=inspections.filter(i=>i.type==="inopinee"||(i.type==="programmee"&&i.date<=today()&&(i.siteIds||[]).some(id=>!(i.scans||{})[id]?.entree)));
  const kpi=(label,n,route,color,sub)=>`<button type="button" class="card p-4 text-left kpi-clickable" onclick="navigate('${route}')" style="border:1px solid ${color}55;background:#fff"><div class="text-xs uppercase font-black text-slate-500">${label}</div><div class="text-3xl font-black mt-1" style="color:${color}">${n}</div><div class="text-xs text-slate-400 mt-1">${sub||"Cliquer pour ouvrir"}</div></button>`;
  view.innerHTML=`<div class="flex items-start justify-between gap-3 mb-5 flex-wrap"><div><h1 class="text-2xl font-black uppercase">SUPERVISION SITE - TABLEAU DE BORD</h1><p class="text-sm text-slate-500">Inspections programmées, inopinées, passages QR et alertes superviseurs · ${soc?escapeHTML(soc):"Toutes sociétés"}</p></div>${opsReadOnly?"":`<button class="btn btn-primary" onclick="navigate('ops/supervision/programmer')">Programmer une inspection</button>`}</div>${opsSupervisorReadOnlyNoticeHTML()}${inspectionTabs("dashboard")}
    <div class="grid grid-5 gap-3 mb-5">
      ${kpi("Programmées",programmed.length,"ops/supervision/programmees","#043970","Planifiées")}
      ${kpi("Aujourd'hui",todayIns.length,"ops/supervision/programmees","#f59e0b","Passages attendus")}
      ${kpi("Inopinées",unexpected.length,"ops/supervision/inopinees","#7c3aed","Non programmées")}
      ${kpi("Terminées",finished.length,"ops/supervision/programmees","#16a34a","Entrée + sortie")}
      ${kpi("Alertes",alerts.length,alerts.length?"ops/supervision/inopinees":"ops/supervision/programmees",alerts.length?"#dc2626":"#16a34a","Passage non respecté")}
    </div>
    <div class="grid grid-2 gap-4"><div class="card p-4"><h3 class="font-black mb-3">Dernières alertes</h3>${alerts.slice(0,6).map(i=>`<button class="w-full text-left p-3 rounded border mb-2 bg-red-50" onclick="navigate('${i.type==='inopinee'?'ops/supervision/inopinees':'ops/supervision/programmees'}')"><div class="font-bold text-red-700">${i.type==='inopinee'?'Inspection inopinée':'Passage non respecté'}</div><div class="text-xs text-slate-600">${formatDate(i.date)} · ${escapeHTML(inspectionSupervisorName(i.supervisorId))} · ${(i.siteIds||[]).map(inspectionSiteName).join(', ')}</div></button>`).join("")||`<div class="p-8 text-center text-emerald-700 font-semibold">Aucune alerte supervision.</div>`}</div><div class="card p-4"><h3 class="font-black mb-3">Sites et superviseurs</h3><div class="grid grid-cols-2 gap-2"><button class="card p-3 text-left" onclick="navigate('sites')"><div class="text-xs text-slate-500">Sites actifs</div><div class="text-2xl font-black">${sites.length}</div></button><button class="card p-3 text-left" onclick="navigate('ops/supervision/programmer')"><div class="text-xs text-slate-500">Superviseurs</div><div class="text-2xl font-black">${supervisors.length}</div></button></div><div class="mt-3">${inspectionSupervisorSpaceHTML(supervisors,inspections)}</div></div></div>`;
}

function renderOpsSupervision(view,tab){
  if(!db.siteInspections)db.siteInspections=[];
  if(isOpsSupervisorReadOnlySession()&&tab==="programmer")tab="programmees";
  const soc=currentStructureSocieteFilter();
  const sites=(db.sites||[]).filter(s=>s.actif!==false&&siteMatchesSociete(s,soc));
  const supervisors=(db.agents||[]).filter(a=>{const poste=[a.fonction,a.poste,a.affectationCourante?.poste].filter(Boolean).join(" ");return(!soc||a.societe===soc)&&!["sortant","demissionne","licencie","archive"].includes(a.statut)&&/superviseur|controleur|contrôleur|inspecteur/i.test(poste)});
  const chauffeurs=inspectionDriverOptions(supervisors).filter(a=>!soc||a.societe===soc);
  const vehicules=inspectionVehicleOptions();
  const inspections=(db.siteInspections||[]).filter(i=>!soc||i.societe===soc);
  if(tab==="dashboard")return renderOpsSupervisionDashboard(view,soc,sites,supervisors,inspections);
  if(tab==="programmees")return renderProgrammedInspections(view,soc,inspections,supervisors);
  if(tab==="inopinees")return renderUnexpectedInspections(view,soc,sites,supervisors,inspections);
  const ym=inspectionProgramMonth();
  const monthLabel=new Date(ym+"-01T00:00:00").toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
  view.innerHTML=`<div class="flex items-center justify-between mb-4 flex-wrap gap-3"><div><h1 class="text-2xl font-black uppercase">SUPERVISION SITE</h1><div class="text-xs text-slate-500">Programmation des inspections, calendrier, passages QR et statistiques par superviseur · ${soc?escapeHTML(soc):"Toutes sociétés"}</div></div></div>${inspectionTabs("programmer")}
  <div class="card p-5">
    <h3 class="font-black mb-4">Programmer une Inspection</h3>
    <form onsubmit="event.preventDefault();saveProgrammedInspection()">
      <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div><label class="label">Choisir le mois</label><input class="input" type="month" name="month" value="${escapeHTML(ym)}" onchange="setInspectionProgramMonth(this.value)"/></div>
        <div><label class="label">Nom du Superviseur</label><select class="select" name="supervisorId"><option value="">— Choisir superviseur —</option>${supervisors.map(a=>`<option value="${a.id}">${escapeHTML((a.matricule? a.matricule+" · ":"")+(a.nom||"")+" "+(a.prenom||""))}</option>`).join("")}</select></div>
        <div><label class="label">Véhicule désigné</label><select class="select" name="vehicule"><option value="">— Choisir véhicule —</option>${vehicules.map(v=>`<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join("")}</select></div>
        <div><label class="label">Chauffeur</label><select class="select" name="chauffeurId"><option value="">— Choisir chauffeur —</option>${chauffeurs.map(a=>`<option value="${a.id}">${escapeHTML((a.matricule? a.matricule+" · ":"")+(a.nom||"")+" "+(a.prenom||""))}</option>`).join("")}</select></div>
        <div><label class="label">Horaire par date</label><div class="text-xs text-slate-500 rounded-lg border bg-white p-2">Saisir devant chaque date cochée</div></div>
      </div>
      <div class="mt-4"><div class="flex items-center justify-between mb-2"><label class="label mb-0">Calendrier - ${escapeHTML(monthLabel)}</label><span class="text-xs text-slate-500">Cochez une ou plusieurs dates</span></div>${inspectionCalendarHTML(ym)}</div>
      <label class="label mt-4">Sites concernés par l'inspection</label>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">${sites.map(st=>`<label class="p-3 rounded-lg border bg-white flex items-center gap-2 text-sm"><input type="checkbox" name="siteIds" value="${st.id}"/> <span>${escapeHTML((st.societe?st.societe+" · ":"")+(st.nom||st.intitule||"Site"))}</span></label>`).join("")||`<div class="text-sm text-slate-500">Aucun site actif.</div>`}</div>
      <label class="label">Moyens mobilisés</label><textarea class="input mb-4" name="moyens" rows="3" placeholder="Équipe, matériel, documents, véhicule, téléphone, etc."></textarea>
      <div class="flex gap-2 justify-end"><button type="button" class="btn btn-ghost" onclick="navigate('ops/dashboard')">Annuler</button><button class="btn btn-primary">Valider</button></div>
    </form>
  </div>
  <div class="mt-5"><h3 class="font-black mb-2">Espaces superviseurs</h3>${inspectionSupervisorSpaceHTML(supervisors,inspections)}</div>`;
}

async function saveProgrammedInspection(){
  if(guardOpsSupervisorMutation("supervision","Accès superviseur OPS : programmation inspection non autorisée."))return;
  const form=document.querySelector("#view form");if(!form)return;
  const fd=new FormData(form);const siteIds=fd.getAll("siteIds").filter(Boolean);const dates=fd.getAll("inspectionDates").filter(Boolean);
  if(!fd.get("supervisorId")){toast("Nom du superviseur obligatoire","error");return}
  if(!dates.length){toast("Cochez au moins une date dans le calendrier","error");return}
  if(!siteIds.length){toast("Sélectionnez au moins un site","error");return}
  if(!db.siteInspections)db.siteInspections=[];
  dates.sort().reverse().forEach(date=>db.siteInspections.unshift({id:uid("insp"),type:"programmee",date,horaire:fd.get("inspectionTime_"+date)||"",supervisorId:fd.get("supervisorId")||"",siteIds,vehicule:(fd.get("vehicule")||"").trim(),chauffeurId:fd.get("chauffeurId")||"",moyens:(fd.get("moyens")||"").trim(),scans:{},societe:currentStructureSocieteFilter()||session?.societe||"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
  if(!(await saveDBAndWaitToast("Inspection programmée non confirmée")))return;
  toast(dates.length+" inspection(s) programmée(s)","success");navigate("ops/supervision/programmees");
}

function renderProgrammedInspections(view,soc,inspections,supervisors){
  const opsReadOnly=isOpsSupervisorReadOnlySession();
  const list=inspections.filter(i=>i.type==="programmee").sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  view.innerHTML=`<div class="flex items-center justify-between mb-4 flex-wrap gap-3"><div><h1 class="text-2xl font-black uppercase">SUPERVISION SITE</h1><div class="text-xs text-slate-500">Inspections programmées · historique superviseurs · passages QR entrée/sortie · ${soc?escapeHTML(soc):"Toutes sociétés"}</div></div></div>${opsSupervisorReadOnlyNoticeHTML()}${inspectionTabs("programmees")}
  <div class="card p-5 overflow-hidden"><table><thead><tr><th>Date</th><th>Horaire</th><th>Superviseur</th><th>Sites</th><th>Véhicule</th><th>Chauffeur</th><th>Moyens</th><th>Passages QR</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${list.length?list.map(i=>`<tr><td>${formatDate(i.date)}</td><td class="font-bold">${escapeHTML(i.horaire||"—")}</td><td>${escapeHTML(inspectionSupervisorName(i.supervisorId))}</td><td class="text-xs">${(i.siteIds||[]).map(id=>escapeHTML(inspectionSiteName(id))).join("<br>")}</td><td>${escapeHTML(i.vehicule||"")}</td><td>${escapeHTML(inspectionSupervisorName(i.chauffeurId))}</td><td class="text-xs">${escapeHTML(i.moyens||"")}</td><td class="text-xs">${inspectionScansHTML(i)}</td><td>${inspectionStatusHTML(i)}</td><td>${opsReadOnly?"—":`<button class="btn btn-secondary text-xs" onclick="openInspectionScan('${i.id}')">Scanner QR</button>`}</td></tr>`).join(""):`<tr><td colspan="10" class="text-center text-slate-500 p-4">Aucune inspection programmée.</td></tr>`}</tbody></table></div>
  <div class="mt-5"><h3 class="font-black mb-2">Espaces superviseurs</h3>${inspectionSupervisorSpaceHTML(supervisors||[],inspections)}</div>`;
}

function inspectionScansHTML(i){return(i.siteIds||[]).map(id=>{const sc=(i.scans||{})[id]||{};return`<div class="mb-1"><b>${escapeHTML(inspectionSiteName(id))}</b><br>Entrée: ${sc.entree?new Date(sc.entree).toLocaleString("fr-FR"):"—"}<br>Sortie: ${sc.sortie?new Date(sc.sortie).toLocaleString("fr-FR"):"—"}${inspectionElapsed(sc)?`<br>Temps: <b>${inspectionElapsed(sc)}</b>`:""}</div>`}).join("")}

function openInspectionScan(id){
  if(guardOpsSupervisorMutation("supervision","Accès superviseur OPS : scan inspection non autorisé."))return;
  const i=(db.siteInspections||[]).find(x=>x.id===id);if(!i)return;
  openModal(`<h3 class="font-bold text-lg mb-3">Scan QR - Inspection</h3><div class="text-sm text-slate-600 mb-3">${escapeHTML(inspectionSupervisorName(i.supervisorId))} · ${formatDate(i.date)}</div>${(i.siteIds||[]).map(siteId=>{const sc=(i.scans||{})[siteId]||{};return`<div class="card p-3 mb-2"><div class="font-bold mb-2">${escapeHTML(inspectionSiteName(siteId))}</div><div class="text-xs text-slate-500 mb-2">Entrée: ${sc.entree?new Date(sc.entree).toLocaleString("fr-FR"):"—"} · Sortie: ${sc.sortie?new Date(sc.sortie).toLocaleString("fr-FR"):"—"}</div><div class="flex gap-2"><button class="btn btn-secondary text-xs" onclick="inspectionScan('${i.id}','${siteId}','entree')">Scanner entrée</button><button class="btn btn-primary text-xs" onclick="inspectionScan('${i.id}','${siteId}','sortie')">Scanner sortie</button></div></div>`}).join("")}<div class="flex justify-end mt-3"><button class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

SGDIModules.registerModule({key: "ops", routes: ["ops","superviseur"], dependencies: ["ops-1"], init: function(){}, destroy: opsModuleDestroy});

const opsModuleTimeouts=new Set();
function opsModuleTimeout(callback,delay){
  const hash=location.hash,generation=sgdiViewRenderGeneration;
  const id=setTimeout(()=>{
    opsModuleTimeouts.delete(id);
    if(hash===location.hash&&generation===sgdiViewRenderGeneration&&SGDIModules.isModuleInitialized("ops"))callback();
  },delay);
  opsModuleTimeouts.add(id);return id;
}
function opsMissionDismiss(){document.querySelectorAll(".ops-mission-row-menu").forEach(item=>item.remove())}
function opsModuleDestroy(){
  clearInterval(window._opsAttendanceAlertsTimer);window._opsAttendanceAlertsTimer=null;
  ptStopQrTabletTimer();
  opsModuleTimeouts.forEach(clearTimeout);opsModuleTimeouts.clear();
  document.removeEventListener("click",opsMissionDismiss);opsMissionDismiss();
}
