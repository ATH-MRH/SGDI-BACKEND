/* Phase 2 — pointage. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function fpqPresenceOptions(value){const cur=fpqPresenceCode(value);return`<option value="">—</option>${FPQ_PRESENCE_OPTIONS.map(([k,l])=>`<option value="${k}" ${cur===k?"selected":""}>${k} = ${l}</option>`).join("")}`}

function fpqPresenceSelectStyle(value){
  const v=String(value||"").toUpperCase();
  if(v==="P")return"min-width:145px;background:#dcfce7;color:#166534;border-color:#22c55e;font-weight:800";
  if(["A","AB"].includes(v))return"min-width:145px;background:#fee2e2;color:#991b1b;border-color:#ef4444;font-weight:800";
  if(v==="R")return"min-width:145px;background:#e2e8f0;color:#334155;border-color:#94a3b8;font-weight:800";
  if(v==="M")return"min-width:145px;background:#fef3c7;color:#92400e;border-color:#c2410c;font-weight:800";
  if(v==="C")return"min-width:145px;background:#dbeafe;color:#1e40af;border-color:#3b82f6;font-weight:800";
  if(v==="S")return"min-width:145px;background:#ede9fe;color:#5b21b6;border-color:#8b5cf6;font-weight:800";
  return"min-width:145px;background:#fff";
}

function isSupOrUser(){return Array.isArray(session?.sitesAutorises)&&session.sitesAutorises.length>0}

function ptSupCurrentSiteFilter(){return sessionStorage.getItem("ptSupSiteFilter")||""}

function setPtSupSiteFilter(v){sessionStorage.setItem("ptSupSiteFilter",v||"");renderView()}

function ptCurrentManuelChip(){return sessionStorage.getItem("ptManuelChip")||"all"}

function setPtManuelChip(v){const next=ptCurrentManuelChip()===(v||"all")&&v!=="all"?"all":v||"all";sessionStorage.setItem("ptManuelChip",next);renderView()}

function setPtSociete(v){sessionStorage.setItem("ptSociete",v||"");renderView()}

function ptSearchBarLabeledHTML(placeholder,label){
  const q=ptCurrentSearch();
  return`<label class="flex flex-col gap-1 text-[10px] font-black uppercase tracking-[.12em] text-slate-500" style="flex:1;min-width:260px;max-width:320px">
    ${escapeHTML(label||"Recherche")}
    <div style="position:relative">
      <input type="search" id="pt-search-input" class="input text-sm w-full" placeholder="${escapeHTML(placeholder||"Rechercher nom, prénom, matricule…")}" value="${escapeHTML(q)}"
        oninput="setPtSearch(this.value)" style="height:40px;border-radius:10px;padding-left:36px"/>
      <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:14px;pointer-events:none">🔍</span>
    </div>
  </label>`;
}

function pointageOperationalAgents(soc){
  const list=(db.agents||[])
    .filter(a=>!["sortant","demissionne","licencie","archive"].includes(String(a.statut||"").toLowerCase()))
    .filter(a=>!soc||normalizeSocieteName(a.societe)===normalizeSocieteName(soc))
    .filter(agentInSupervisorScope)
    .filter(agentIsOperational)
    .sort((x,y)=>(x.nom||"").localeCompare(y.nom||"")||(x.prenom||"").localeCompare(y.prenom||""));
  if(list.length){
    window.__pointageStableAgentsBySoc=window.__pointageStableAgentsBySoc||{};
    window.__pointageStableAgentsBySoc[normalizeSocieteName(soc||"__all__")]=list;
    return list;
  }
  const cached=window.__pointageStableAgentsBySoc?.[normalizeSocieteName(soc||"__all__")];
  return Array.isArray(cached)?cached:[];
}

function ptKey(year,month){return year+"-"+String(month).padStart(2,"0")}

function ptEnsureSheet(agentId,ym){let s=ptGetSheet(agentId,ym);if(!s){const key=String(agentId??"");const ag=db.agents.find(a=>String(a.id??"")===key);s={id:uid("pt"),agentId,periode:ym,societe:ag?ag.societe:"",days:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.pointages.push(s)}return s}

function ptFeuillePresenceRowForAgent(agent,dateStr){
  const refs=[agent?.id,agent?.backendId,agent?.matricule].filter(v=>v!==undefined&&v!==null&&v!=="").map(String);
  if(!refs.length)return null;
  return (db.feuillePresence||[]).find(x=>{
    if(String(x?.date||"")!==dateStr)return false;
    return [x.agentId,x.agentBackendId,x.employee_id,x.matricule].some(ref=>ref!==undefined&&ref!==null&&ref!==""&&refs.includes(String(ref)));
  })||null;
}

function ptResolveDayCode(agent,sheet,ym,day){
  const sheetCode=(sheet?.days||{})[day]||"";
  if(sheetCode)return sheetCode;
  const f=ptFeuillePresenceRowForAgent(agent,`${ym}-${day}`)||{};
  return f.code||fpqPresenceCode(f.heureArrivee)||((f.scanArrivee||f.heureArrivee)?"P":"")||"";
}

async function ptPersistCell(agentId,ym,day,code){
  try{
    await sgdiRunLegacyAction("save-pointage-cell",{data:{agentId,periode:ym,day:String(day).padStart(2,"0"),code:code||""}});
    uiSaveState("Sauvegardé","success");
  }catch(e){
    toast("Pointage non enregistré : "+(e.message||e),"error");
    await sgdiPullState({silent:true,force:true}).catch(()=>null);
    renderView();
  }
}

function ptSetCell(agentId,ym,day,code){const date=`${ym}-${String(day).padStart(2,"0")}`;if(ptGuardEmployeePointage(agentId,date))return;const s=ptEnsureSheet(agentId,ym);if(s.valide){toast("Pointage validé · déverrouillez d'abord","error");return}const k=String(day).padStart(2,"0");if(code)s.days[k]=code;else delete s.days[k];if(s.fpqSync)delete s.fpqSync[k];ptNormalizeAbandonDePoste(s);s.updatedAt=new Date().toISOString();ptPersistCell(agentId,ym,day,code)}

function ptWarnIfPaieAlreadyClosed(agentId,ym){
  const key=String(agentId??"");
  const a=(db.agents||[]).find(x=>String(x.id??"")===key);
  if(!a||typeof paieIsClosed!=="function"||!paieIsClosed(ym,a.societe))return;
  const label=typeof paieMonthLabel==="function"?paieMonthLabel(ym):ym;
  toast(`⚠ La paie de ${label} est déjà clôturée pour ${(a.nom||"")+" "+(a.prenom||"")} — ce pointage ne sera pas repris tant que le bulletin n'est pas régénéré.`,"error");
}

function ptPresenceAgentId(f){
  const refs=[f?.agentId,f?.agentBackendId,f?.employee_id,f?.matricule].map(x=>String(x||"")).filter(Boolean);
  const a=(db.agents||[]).find(ag=>refs.includes(String(ag.id||""))||refs.includes(String(ag.backendId||""))||refs.includes(String(ag.matricule||"")));
  return a?.id||String(f?.agentId||"");
}

function ptApplyPresenceLine(f){
  if(!f||!f.date||!f.agentId)return false;
  if(employeePointageBlocked(findEmployeeByRef(ptPresenceAgentId(f)),f.date))return false;
  const ym=f.date.slice(0,7),day=f.date.slice(8,10);if(!ym||!day)return false;
  const agentId=ptPresenceAgentId(f);
  const s=ptEnsureSheet(agentId,ym);if(s.valide)return false;
  if(!s.days)s.days={};if(!s.fpqSync)s.fpqSync={};
  const code=f.code||fpqPresenceCode(f.heureArrivee)||((f.scanArrivee||f.heureArrivee)?"P":"");
  if(!code)return false;
  if(s.days[day]&&!s.fpqSync[day])return false;
  if(s.days[day]===code&&s.fpqSync[day]===f.id)return false;
  s.days[day]=code;s.fpqSync[day]=f.id||true;ptNormalizeAbandonDePoste(s);s.updatedAt=new Date().toISOString();
  return true;
}

function ptRemovePresenceLine(f){
  if(!f||!f.date||!f.agentId)return false;
  const s=ptGetSheet(ptPresenceAgentId(f),f.date.slice(0,7));if(!s||s.valide)return false;
  const day=f.date.slice(8,10);if(!s.fpqSync||s.fpqSync[day]!==f.id)return false;
  delete s.days[day];delete s.fpqSync[day];s.updatedAt=new Date().toISOString();
  return true;
}

function ptSyncFeuillePresenceMonth(ym){
  let changed=false;
  (db.feuillePresence||[]).filter(f=>f.date&&f.date.slice(0,7)===ym).forEach(f=>{if(ptApplyPresenceLine(f))changed=true});
  if(ptNormalizeAbandonsForMonth(ym,ptCurrentSoc()))changed=true;
  return changed;
}

async function ptValiderSheet(agentId,ym){
  if(!supervisorModuleActive()&&guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : validation pointage non autorisée."))return;
  try{
    await sgdiRunLegacyAction("validate-pointage",{data:{agentId,periode:ym}});
    await sgdiPullState({silent:true});
    logActivity&&logActivity("Pointage validé","Agent "+agentId+" · "+ym);
    toast("Pointage validé par le backend","success");
    renderView();
  }catch(e){toast("Validation refusée : "+(e.message||e),"error")}
}

async function ptDevaliderSheet(agentId,ym){
  if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : déverrouillage pointage non autorisé."))return;
  if(!confirm("Déverrouiller ce pointage validé ?"))return;
  try{
    await sgdiRunLegacyAction("unlock-pointage",{data:{agentId,periode:ym}});
    await sgdiPullState({silent:true});
    logActivity&&logActivity("Pointage déverrouillé","Agent "+agentId+" · "+ym);
    toast("Pointage déverrouillé par le backend","success");
    renderView();
  }catch(e){toast("Déverrouillage refusé : "+(e.message||e),"error")}
}

async function ptValiderTous(ym,soc){
  if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : validation pointage non autorisée."))return;
  const ag=pointageEligibleAgents(soc);
  if(!ag.length){toast("Aucun employé à valider","error");return}
  if(!confirm(`Valider le pointage de ${ag.length} agent(s) pour la période ${ym} ?`))return;
  try{
    const out=await sgdiRunLegacyAction("validate-pointage-all",{data:{periode:ym,societe:soc||""}});
    await sgdiPullState({silent:true});
    logActivity&&logActivity("Validation globale du pointage",ym+" · société: "+(soc||"toutes"));
    toast((out.data?.count??0)+" pointage(s) validé(s) par le backend","success");
    renderView();
  }catch(e){toast("Validation globale refusée : "+(e.message||e),"error")}
}

async function ptDevaliderTous(ym,soc){
  if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : déverrouillage pointage non autorisé."))return;
  if(!confirm(`Déverrouiller TOUS les pointages validés pour ${ym} ?`))return;
  try{
    const out=await sgdiRunLegacyAction("unlock-pointage-all",{data:{periode:ym,societe:soc||""}});
    await sgdiPullState({silent:true});
    toast((out.data?.count??0)+" pointage(s) déverrouillé(s) par le backend","success");
    renderView();
  }catch(e){toast("Déverrouillage global refusé : "+(e.message||e),"error")}
}

function fpqCurrentStatus(){return sessionStorage.getItem("fpqStatus")||""}

function fpqCurrentFaction(){return sessionStorage.getItem("fpqFaction")||""}

function fpqSetDatePart(part,value){
  const cur=fpqCurrentDate();
  let [y,m,d]=String(cur||today()).split("-");
  if(part==="day")d=String(value||d||"01").padStart(2,"0");
  if(part==="month")m=String(value||m||"01").padStart(2,"0");
  if(part==="year")y=String(value||y||new Date().getFullYear());
  const maxD=new Date(parseInt(y,10),parseInt(m,10),0).getDate();
  d=String(Math.min(parseInt(d||"1",10),maxD)).padStart(2,"0");
  setFpqDate(`${y}-${m}-${d}`);
}

function fpqDateSelectHTML(date){
  const [y0,m0,d0]=String(date||today()).split("-");
  const y=String(y0||new Date().getFullYear());
  const m=String(m0||"01").padStart(2,"0");
  const d=String(d0||"01").padStart(2,"0");
  const maxD=new Date(parseInt(y,10),parseInt(m,10),0).getDate();
  const years=drumYearOpts(4);
  if(!years.some(o=>o.value===y))years.push({value:y,label:y});
  years.sort((a,b)=>parseInt(a.value,10)-parseInt(b.value,10));
  const select=(label,part,value,opts)=>`<label class="flex flex-col gap-1 text-[10px] font-black uppercase tracking-[.12em] text-slate-500">
    ${escapeHTML(label)}
    <select class="select text-sm font-extrabold" style="min-width:108px;height:40px;border-radius:10px" onchange="fpqSetDatePart('${part}',this.value)">
      ${opts.map(o=>`<option value="${escapeHTML(o.value)}"${o.value===value?" selected":""}>${escapeHTML(o.label)}</option>`).join("")}
    </select>
  </label>`;
  return`<div class="flex flex-wrap items-end gap-2">
    ${select("Jour","day",d,Array.from({length:maxD},(_,i)=>({value:String(i+1).padStart(2,"0"),label:String(i+1).padStart(2,"0")})))}
    ${select("Mois","month",m,drumMonthOpts())}
    ${select("Année","year",y,years)}
  </div>`;
}

function setFpqSociete(v){sessionStorage.setItem("fpqSociete",v||"");renderView()}

function setFpqSite(v){sessionStorage.setItem("fpqSite",v||"");renderView()}

function setFpqStatus(v){sessionStorage.setItem("fpqStatus",v||"");renderView()}

function setFpqFaction(v){sessionStorage.setItem("fpqFaction",v||"");renderView()}

function ptSupervisorSetDatePart(part,value){
  const cur=ptSupDate();
  let [y,m,d]=String(cur||today()).split("-");
  if(part==="day")d=String(value||d||"01").padStart(2,"0");
  if(part==="month")m=String(value||m||"01").padStart(2,"0");
  if(part==="year")y=String(value||y||new Date().getFullYear());
  const maxD=new Date(parseInt(y,10),parseInt(m,10),0).getDate();
  d=String(Math.min(parseInt(d||"1",10),maxD)).padStart(2,"0");
  setPtSupDate(`${y}-${m}-${d}`);
}

function ptSupervisorDateSelectHTML(day,month,year){
  const y=String(year||new Date().getFullYear());
  const m=String(month||"01").padStart(2,"0");
  const d=String(day||"01").padStart(2,"0");
  const maxD=new Date(parseInt(y,10),parseInt(m,10),0).getDate();
  const years=drumYearOpts(6);
  if(!years.some(o=>o.value===y))years.push({value:y,label:y});
  years.sort((a,b)=>parseInt(a.value,10)-parseInt(b.value,10));
  const select=(label,part,value,opts)=>`<label class="flex flex-col gap-1 text-[10px] font-black uppercase tracking-[.12em] text-slate-500">
    ${escapeHTML(label)}
    <select class="select text-sm font-extrabold" style="min-width:118px;height:40px;border-radius:10px" onchange="ptSupervisorSetDatePart('${part}',this.value)">
      ${opts.map(o=>`<option value="${escapeHTML(o.value)}"${o.value===value?" selected":""}>${escapeHTML(o.label)}</option>`).join("")}
    </select>
  </label>`;
  return`<div class="flex flex-wrap items-end gap-2">
    ${select("Jour","day",d,Array.from({length:maxD},(_,i)=>({value:String(i+1).padStart(2,"0"),label:String(i+1).padStart(2,"0")})))}
    ${select("Mois","month",m,drumMonthOpts())}
    ${select("Année","year",y,years)}
  </div>`;
}

function fpqStatusMatch(f,status){
  const c=fpqPresenceCode(f?.heureArrivee);
  if(!status)return true;
  if(status==="present")return c==="P";
  if(status==="absence")return c==="A"||c==="AB";
  if(status==="saisie")return !!c;
  if(status==="releve")return !!f?.heureReleve;
  if(status==="recup")return c==="R";
  return true;
}

function fpqClotureInfo(date){if(!db.feuillePresenceCloture)return null;return db.feuillePresenceCloture[date]||null}

function renderPointageArchives(){
  if(!db.feuillePresenceArchive)db.feuillePresenceArchive={};
  const entries=Object.entries(db.feuillePresenceArchive).sort((a,b)=>b[0].localeCompare(a[0]));
  const byMonth={};
  entries.forEach(([d,info])=>{const m=d.slice(0,7);if(!byMonth[m])byMonth[m]=[];byMonth[m].push([d,info]);});
  const months=Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));
  const MOIS=["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  return`<div class="max-w-3xl mx-auto">
    <div class="flex items-center gap-3 mb-4 p-3 rounded-lg" style="background:#f0fdf4;border:1px solid #bbf7d0">
      <span style="font-size:22px">📦</span>
      <div><div class="font-bold text-sm text-emerald-800">Archive automatique activée</div><div class="text-xs text-emerald-700">Chaque jour précédent est archivé automatiquement en arrière-plan. Les données archivées sont en lecture seule et ne peuvent pas être modifiées.</div></div>
    </div>
    <div class="grid grid-cols-3 gap-3 mb-5">
      <div class="card p-4 text-center"><div class="text-2xl font-black text-slate-700">${entries.length}</div><div class="text-xs text-slate-500 mt-1">Jours archivés</div></div>
      <div class="card p-4 text-center"><div class="text-2xl font-black text-slate-700">${months.length}</div><div class="text-xs text-slate-500 mt-1">Mois couverts</div></div>
      <div class="card p-4 text-center"><div class="text-2xl font-black text-slate-700">${entries.reduce((n,[,i])=>n+(i.lignesCount||0),0)}</div><div class="text-xs text-slate-500 mt-1">Lignes archivées</div></div>
    </div>
    ${months.length?months.map(m=>{
      const [yr,mo]=m.split("-").map(Number);
      const label=MOIS[mo-1]+" "+yr;
      const rows=byMonth[m];
      const total=rows.reduce((n,[,i])=>n+(i.lignesCount||0),0);
      return`<div class="card overflow-hidden mb-4">
        <div class="flex items-center justify-between px-4 py-3 border-b" style="background:#f8fafc">
          <div class="font-bold text-sm">${label}</div>
          <div class="text-xs text-slate-500">${rows.length} jour(s) · ${total} lignes</div>
        </div>
        <table class="w-full text-sm"><thead><tr class="text-xs text-slate-400 uppercase bg-slate-50"><th class="px-3 py-2 text-left">Date</th><th class="px-3 py-2 text-center">Lignes</th><th class="px-3 py-2 text-left">Archivé le</th><th class="px-3 py-2">Accès</th></tr></thead>
        <tbody>${rows.map(([d,info])=>`<tr><td class="px-3 py-2 font-mono text-xs">${formatDate(d)}</td><td class="px-3 py-2 text-center font-bold">${info.lignesCount||0}</td><td class="px-3 py-2 text-xs text-slate-500">${info.archivedAt?new Date(info.archivedAt).toLocaleString("fr-FR"):"-"}</td><td class="px-3 py-2 text-center"><a class="btn btn-ghost text-xs" href="#/pointage/feuille?date=${d}" onclick="setFpqDate('${d}');navigate('pointage/feuille')">👁 Voir</a></td></tr>`).join("")}</tbody>
        </table>
      </div>`;
    }).join(""):`<div class="card p-8 text-center text-slate-400 italic">Aucune archive disponible.</div>`}
  </div>`;
}

async function fpqSetField(date,agentId,field,value){if(fpqGuardArchive(date)||fpqGuardCloture(date)||fpqGuardLine(date,agentId)){renderView();return}try{await sgdiRunLegacyAction("upsert-presence-line",{data:{date,agentId,patch:{[field]:value||""}}});await sgdiPullState({silent:true})}catch(e){toast("Modification refusée : "+(e.message||e),"error");renderView()}}

async function fpqSetRowField(rowId,field,value){const f=(db.feuillePresence||[]).find(x=>x.id===rowId);if(!f)return;if(fpqGuardArchive(f.date)||fpqGuardCloture(f.date)||fpqGuardLine(f.date,f.agentId)){renderView();return}try{await sgdiRunLegacyAction("upsert-presence-line",{data:{date:f.date,agentId:f.agentId,patch:{[field]:value||""}}});await sgdiPullState({silent:true})}catch(e){toast("Modification refusée : "+(e.message||e),"error");renderView()}}

async function fpqSetSite(date,agentId,siteId){if(fpqGuardArchive(date)||fpqGuardCloture(date)||fpqGuardLine(date,agentId)){renderView();return}const s=db.sites.find(x=>x.id===siteId);try{await sgdiRunLegacyAction("upsert-presence-line",{data:{date,agentId,patch:{siteId:siteId||"",siteName:s?(s.nom||s.intitule||""):"",siteManual:true}}});await sgdiPullState({silent:true});renderView()}catch(e){toast("Affectation refusée : "+(e.message||e),"error");renderView()}}

async function fpqDelete(date,agentId){if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : suppression pointage non autorisée."))return;if(fpqGuardArchive(date)||fpqGuardCloture(date)||fpqGuardLine(date,agentId))return;if(!confirm("Effacer la ligne de présence ?"))return;try{await sgdiRunLegacyAction("delete-presence-line",{data:{date,agentId}});await sgdiPullState({silent:true});renderView()}catch(e){toast("Suppression refusée : "+(e.message||e),"error")}}

async function fpqDeleteRow(rowId){if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : suppression pointage non autorisée."))return;const f=(db.feuillePresence||[]).find(x=>x.id===rowId);if(!f)return;if(fpqGuardArchive(f.date)||fpqGuardCloture(f.date)||fpqGuardLine(f.date,f.agentId))return;if(!confirm("Effacer la ligne de présence ?"))return;try{await sgdiRunLegacyAction("delete-presence-line",{item_id:rowId,data:{}});await sgdiPullState({silent:true});renderView()}catch(e){toast("Suppression refusée : "+(e.message||e),"error")}}

function fpqMovementCapacityBlockMessage(agentId,patch){
  if(!patch?.siteId||patch.siteId==="autres")return "";
  const site=(db.sites||[]).find(s=>String(s.id)===String(patch.siteId)||String(s.backendId||"")===String(patch.siteBackendId||""));
  if(!site)return "";
  const eff=siteEffectifsNorm(site);
  const totalTarget=+eff.totalContractuel||0;
  const groupTarget=Math.max(+eff.jour||0,+eff.nuit||0)||(+eff.groupes?Math.ceil((+eff.totalContractuel||0)/+eff.groupes):0);
  const employee=findEmployeeByRef(agentId)||findEmployeeByRef(patch.matricule)||findEmployeeByRef(patch.agentBackendId);
  const employeeRefs=new Set([employee?.id,employee?.backendId,employee?.matricule,agentId,patch.matricule,patch.agentBackendId].map(v=>String(v||"").trim()).filter(Boolean));
  const others=siteAgentsAffectes(site).filter(a=>![a.id,a.backendId,a.matricule].some(v=>employeeRefs.has(String(v||"").trim())));
  const siteName=site.nom||site.intitule||patch.siteName||"site";
  return "";
}

async function fpqValiderLigne(date,agentId){
  if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : validation pointage non autorisée."))return;
  if(fpqGuardArchive(date)||fpqGuardCloture(date))return;
  const f=fpqEnsure(date,agentId);
  if(!f.siteId){toast("Site obligatoire avant validation","error");return}
  try{
    await sgdiRunLegacyAction("validate-presence-line",{collection:"feuillePresence",item_id:f.id,data:{}});
    await sgdiPullState({silent:true});
    toast("Ligne validée par le backend","success");
    renderView();
  }catch(e){toast("Validation ligne refusée : "+(e.message||e),"error")}
}

async function fpqDevaliderLigne(date,agentId){
  if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : déverrouillage pointage non autorisé."))return;
  const f=fpqGet(date,agentId);if(!f)return;
  try{
    await sgdiRunLegacyAction("unlock-presence-line",{collection:"feuillePresence",item_id:f.id,data:{}});
    await sgdiPullState({silent:true});
    toast("Ligne déverrouillée par le backend","success");
    renderView();
  }catch(e){toast("Déverrouillage ligne refusé : "+(e.message||e),"error")}
}

async function fpqCloturerJournee(date){if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : clôture pointage non autorisée."))return;if(!date)date=fpqCurrentDate();if(fpqIsCloture(date)){toast("Déjà clôturée","info");return}const lignes=(db.feuillePresence||[]).filter(f=>f.date===date);if(!lignes.length){if(!confirm("Aucune ligne saisie pour le "+formatDate(date)+".\nClôturer la feuille à zéro quand même ?"))return}else{const incomplets=lignes.filter(f=>!f.heureArrivee).length;const msg="Clôturer définitivement la feuille du "+formatDate(date)+" ?\n\n• "+lignes.length+" ligne(s) au total\n"+(incomplets?"• ⚠ "+incomplets+" ligne(s) incomplète(s) (situation manquante)\n":"")+"\nLes lignes ne pourront plus être modifiées sans déclôture.";if(!confirm(msg))return}try{await sgdiRunLegacyAction("close-presence-day",{data:{date}});await sgdiPullState({silent:true});if(typeof logActivity==="function")logActivity("Clôture feuille de présence","Date: "+formatDate(date)+" · "+lignes.length+" ligne(s)");toast("Feuille clôturée par le backend","success");renderView()}catch(e){toast("Clôture refusée : "+(e.message||e),"error")}}

function fpqDeclôturerJournee(date){return fpqDecloturerJournee(date)}

async function fpqDecloturerJournee(date){if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : déclôture pointage non autorisée."))return;if(!date)date=fpqCurrentDate();if(fpqGuardArchive(date))return;if(!fpqIsCloture(date)){toast("Feuille non clôturée","info");return}const motif=prompt("Motif de la déclôture du "+formatDate(date)+" :","");if(motif===null)return;if(!motif.trim()){toast("Motif obligatoire","error");return}try{await sgdiRunLegacyAction("reopen-presence-day",{data:{date,motif:motif.trim()}});await sgdiPullState({silent:true});if(typeof logActivity==="function")logActivity("Déclôture feuille de présence","Date: "+formatDate(date)+" · Motif: "+motif.trim());toast("Feuille déclôturée par le backend","success");renderView()}catch(e){toast("Déclôture refusée : "+(e.message||e),"error")}}

function fpqClotureBannerHTML(){if(!db||!session)return"";if(session.transverse!=="ops")return"";if(typeof canAccess==="function"&&!canAccess("ops"))return"";const today=new Date().toISOString().slice(0,10);const allDates=new Set();(db.feuillePresence||[]).forEach(f=>allDates.add(f.date));allDates.add(today);const c=db.feuillePresenceCloture||{};const pending=[...allDates].filter(d=>!c[d]).sort((a,b)=>b.localeCompare(a));if(!pending.length)return"";const todayPending=pending.includes(today);const oldPending=pending.filter(d=>d!==today).sort((a,b)=>b.localeCompare(a));const todayCount=(db.feuillePresence||[]).filter(f=>f.date===today).length;const oldList=oldPending.slice(0,5).map(d=>{const cnt=(db.feuillePresence||[]).filter(f=>f.date===d).length;return`<button class="text-[11px] px-2 py-0.5 rounded-full font-bold" style="background:#fff;color:#b91c1c;border:1px solid #fca5a5" onclick="setFpqDate('${d}');navigate('pointage/feuille')">📅 ${formatDate(d)} · ${cnt} ligne${cnt>1?"s":""}</button>`}).join(" ");const moreOld=oldPending.length>5?` <span class="text-[11px] text-red-700 font-semibold">+ ${oldPending.length-5} autre(s)…</span>`:"";const todayLabel=new Date(today).toLocaleDateString("fr-FR",{weekday:"long",day:"2-digit",month:"long"});const bg=todayPending&&!oldPending.length?"linear-gradient(90deg,#043970,#043970)":"linear-gradient(90deg,#fee2e2,#fecaca)";const border=todayPending&&!oldPending.length?"#043970":"#dc2626";const titleColor=todayPending&&!oldPending.length?"#043970":"#991b1b";const subColor=todayPending&&!oldPending.length?"#043970":"#7f1d1d";return`<div class="no-print mx-4 mt-3 p-4 rounded-lg shadow-lg fpq-banner-pulse" style="background:${bg};border:3px solid ${border}">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-3 flex-1 min-w-0">
        <div style="font-size:38px;line-height:1">${todayPending&&!oldPending.length?"⏰":"🚨"}</div>
        <div class="min-w-0 flex-1">
          <div class="font-black text-lg leading-tight uppercase" style="color:${titleColor};letter-spacing:0.02em">FEUILLE DE PRÉSENCE QUOTIDIENNE — NON CLÔTURÉE</div>
          <div class="text-xs mt-1 font-semibold" style="color:${subColor}">
            ${todayPending?`📅 <span class="capitalize">${todayLabel}</span> · ${todayCount} ligne${todayCount>1?"s":""} saisie${todayCount>1?"s":""}`:""}
            ${todayPending&&oldPending.length?" &nbsp;·&nbsp; ":""}
            ${oldPending.length?`🚩 <strong>${oldPending.length} feuille${oldPending.length>1?"s":""} antérieure${oldPending.length>1?"s":""} non clôturée${oldPending.length>1?"s":""}</strong>`:""}
          </div>
          ${oldPending.length?`<div class="mt-2 flex flex-wrap gap-1">${oldList}${moreOld}</div>`:""}
        </div>
      </div>
      <div class="flex gap-2 shrink-0">
        <button class="btn btn-secondary text-sm font-bold" onclick="setFpqDate('${today}');navigate('pointage/feuille')">📋 Ouvrir</button>
        ${todayPending?`<button class="btn text-sm font-black shadow" style="background:${border};color:white;border:0" onclick="fpqCloturerJournee('${today}')">🔒 Clôturer aujourd'hui</button>`:""}
      </div>
    </div>
  </div>`}

function fpqClearAll(date,soc){if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : suppression pointage non autorisée."))return;if(fpqGuardArchive(date)||fpqGuardCloture(date))return;if(!confirm("Effacer toute la feuille du "+formatDate(date)+" ?"))return;const removed=(db.feuillePresence||[]).filter(f=>f.date===date&&(!soc||f.societe===soc));removed.forEach(f=>ptRemovePresenceLine(f));const before=(db.feuillePresence||[]).length;db.feuillePresence=(db.feuillePresence||[]).filter(f=>{if(f.date!==date)return true;if(soc&&f.societe!==soc)return true;return false});saveDB();toast((before-db.feuillePresence.length)+" ligne(s) supprimée(s)","success");renderView()}

function fpqSupprimerFeuille(date){
  if(fpqGuardArchive(date)||fpqGuardCloture(date))return;
  const lignes=(db.feuillePresence||[]).filter(f=>f.date===date);
  if(!lignes.length){toast("Aucune feuille à supprimer pour cette date","info");return}
  if(!confirm("Supprimer définitivement toute la feuille de présence du "+formatDate(date)+" ?\n\n"+lignes.length+" ligne(s) seront supprimée(s)."))return;
  lignes.forEach(f=>ptRemovePresenceLine(f));
  db.feuillePresence=(db.feuillePresence||[]).filter(f=>f.date!==date);
  if(db.feuillePresenceCloture)delete db.feuillePresenceCloture[date];
  saveDB();
  if(typeof logActivity==="function")logActivity("Suppression feuille de présence","Date: "+formatDate(date)+" · "+lignes.length+" ligne(s)");
  toast("Feuille de présence supprimée","success");
  renderView();
}

function fpqDuplicateYesterday(date,soc){const d=new Date(date);d.setDate(d.getDate()-1);const prev=d.toISOString().slice(0,10);const src=(db.feuillePresence||[]).filter(f=>f.date===prev&&(!soc||f.societe===soc));if(!src.length){toast("Aucune feuille pour le "+formatDate(prev),"error");return}if(!confirm(`Copier ${src.length} ligne(s) du ${formatDate(prev)} vers le ${formatDate(date)} ?`))return;let n=0;src.forEach(s=>{const exists=fpqGet(date,s.agentId);if(exists)return;const f={...s,id:uid("fpq"),date,heureArrivee:"",heureDepart:"",heureReleve:"",observations:"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};db.feuillePresence.push(f);n++});saveDB();toast(n+" ligne(s) copiée(s)","success");renderView()}

function fpqAddAllAgents(date,soc){const ag=pointageOperationalAgents(soc);if(!ag.length){toast("Aucun employé opérationnel","error");return}if(!confirm(`Ajouter les ${ag.length} agents opérationnels à la feuille du ${formatDate(date)} ?`))return;let n=0;ag.forEach(a=>{if(!fpqGet(date,a.id)){fpqEnsure(date,a.id);n++}});saveDB();toast(n+" agent(s) opérationnel(s) ajouté(s)","success");renderView()}

function fpqParseHoraires(site,periode){
  if(periode==="matin")return {a:"06:00",d:"14:00",r:"14:00"};
  if(periode==="apres_midi")return {a:"14:00",d:"22:00",r:"22:00"};
  if(periode==="nuit"&&(site.rotationSystem||inferSiteRotationSystem(site))==="3x8")return {a:"22:00",d:"06:00",r:"06:00"};
  const jour=(site.heureReleveJour||"").trim();
  const nuit=(site.heureReleveNuit||"").trim();
  if(jour||nuit){
    const rel=periode==="nuit"?(nuit||jour||"06:00"):(jour||nuit||"18:00");
    const arr=periode==="nuit"?"18:00":"06:00";
    return {a:arr,d:rel,r:rel};
  }
  const raw=(site.horairesReleves||"").trim();
  const fallback=periode==="nuit"?{a:"18:00",d:"06:00",r:"06:00"}:{a:"06:00",d:"18:00",r:"18:00"};
  const blocks=raw.split("/").map(x=>x.trim()).filter(Boolean);
  const pick=periode==="nuit"?(blocks[1]||blocks[0]||""):(blocks[0]||"");
  const m=pick.match(/(\d{1,2}:\d{2})\s*[-à]\s*(\d{1,2}:\d{2})/i);
  if(!m)return fallback;
  const norm=t=>t.split(":").map((x,i)=>i===0?String(+x).padStart(2,"0"):x).join(":");
  return {a:norm(m[1]),d:norm(m[2]),r:norm(m[2])};
}

function fpqAgentMatchesPeriode(agent,periode){
  const h=(agentLiveAffectation(agent)?.horaire||agent.affectationCourante?.horaire||"").toLowerCase();
  if(!h||h==="mixte")return true;
  if(periode==="jour"||periode==="matin"||periode==="apres_midi")return h.includes("jour")||h.includes("matin")||h.includes("après")||h.includes("apres");
  if(periode==="nuit")return h.includes("nuit");
  return false;
}

function fpqAgentGroup(site,agent,agents){
  const groupNames=["A","B","C","D"];
  const liveGroup=agentLiveAffectation(agent)?.groupe;
  if(liveGroup&&groupNames.includes(liveGroup))return {index:groupNames.indexOf(liveGroup),name:liveGroup};
  const manual=site.groupesAffectation?.[agent.id];
  if(manual&&groupNames.includes(manual))return {index:groupNames.indexOf(manual),name:manual};
  const n=Math.max(1,Math.min(4,+site.effectifs?.groupes||4));
  const sorted=(agents||[]).slice().sort((a,b)=>(a.matricule||a.nom||"").localeCompare(b.matricule||b.nom||""));
  const idx=Math.max(0,sorted.findIndex(a=>a.id===agent.id));
  const gi=idx%n;
  return {index:gi,name:groupNames[gi]||String(gi+1)};
}

function fpqRecoveryStandby(date,soc,siteId){
  const used=new Set((db.feuillePresence||[]).filter(f=>f.date===date&&f.agentId).map(f=>f.agentId));
  const rows=[];
  const selectedSite=siteId?(db.sites||[]).find(s=>String(s.id)===String(siteId)||String(s.backendId||"")===String(siteId)):null;
  (db.sites||[]).filter(site=>site.actif!==false&&siteBelongsToPrimarySociete(site,soc)&&(!selectedSite||siteMatchesReference(selectedSite,{siteId:site.id,siteBackendId:site.backendId,siteName:site.nom||site.intitule}))).forEach(site=>{
    const agentsSite=pointageOperationalAgents(soc).filter(a=>siteMatchesReference(site,agentLiveAffectation(a)));
    agentsSite.forEach(a=>{
      if(used.has(a.id))return;
      const grp=fpqAgentGroup(site,a,agentsSite);
      const rot=fpqRotationForSite(site,date,grp.index);
      if(rot.on)return;
      rows.push({agent:a,site,group:grp.name,rot,phone:a.telephone||a.phone||"",reason:rot.regle||"Récupération"});
    });
  });
  return rows.sort((x,y)=>(x.agent.matricule||x.agent.nom||"").localeCompare(y.agent.matricule||y.agent.nom||""));
}

function fpqStandbyPanelHTML(date,soc,siteId){
  const rows=fpqRecoveryStandby(date,soc,siteId);
  const preview=rows.slice(0,8).map(r=>`<tr><td class="font-mono font-bold text-xs">${escapeHTML(r.agent.matricule||"—")}</td><td class="text-xs font-semibold">${escapeHTML((r.agent.nom||"")+" "+(r.agent.prenom||""))}</td><td class="text-xs">${escapeHTML(r.site.nom||r.site.intitule||"Site")}</td><td class="text-xs font-bold">Groupe ${escapeHTML(r.group)}</td><td class="text-xs">${escapeHTML(r.phone||"—")}</td><td><button class="btn btn-secondary text-xs" onclick="fpqQuickCallInfo('${r.agent.id}','${date}')">Contacter</button></td></tr>`).join("");
  return `<div class="card p-4 mb-4" style="background:#f8fafc;border:1px solid #cbd5e1"><div class="flex items-center justify-between gap-3 flex-wrap"><div><div class="text-xs uppercase tracking-wider font-black text-slate-500">Astreinte / récupération disponible</div><div class="font-black text-lg">${rows.length} employé(s) récupérable(s) pour remplacement</div></div><span class="pill" style="background:#01112f;color:#facc15">Rotation calculée</span></div>${rows.length?`<div class="overflow-x-auto mt-3"><table class="w-full text-sm"><thead><tr><th>Code</th><th>Employé</th><th>Site</th><th>Groupe</th><th>Téléphone</th><th>Action</th></tr></thead><tbody>${preview}</tbody></table>${rows.length>8?`<div class="text-xs text-slate-500 mt-2">+ ${rows.length-8} autre(s) disponible(s)</div>`:""}</div>`:`<div class="text-sm text-slate-500 mt-2">Aucun personnel en récupération disponible avec ce filtre.</div>`}</div>`;
}

function fpqQuickCallInfo(agentId,date){const a=(db.agents||[]).find(x=>x.id===agentId);if(!a)return;toast("Astreinte : "+((a.nom||"")+" "+(a.prenom||"")).trim()+" · Tél: "+(a.telephone||a.phone||"non renseigné"),"info");}

function fpqSiteProgrammedSlots(site,date,agentsSite){
  const eff=siteEffectifsNorm(site);
  const grouped={jour:[],matin:[],apres_midi:[],nuit:[]};
  agentsSite.forEach(a=>{
    const grp=fpqAgentGroup(site,a,agentsSite);
    const rot=fpqRotationForSite(site,date,grp.index);
    if(!rot.on||!["jour","matin","apres_midi","nuit"].includes(rot.periode)||!fpqAgentMatchesPeriode(a,rot.periode))return;
    grouped[rot.periode].push({agent:a,rot,group:grp.name});
  });
  const period=grouped.jour.length?"jour":(grouped.matin.length?"matin":(grouped.apres_midi.length?"apres_midi":(grouped.nuit.length?"nuit":((+eff.jour||0)>0?"jour":"nuit"))));
  const slots=[];
  const requiredBase=period==="nuit"?(+eff.nuit||0):(+eff.jour||0);
  const required=Math.max(requiredBase,grouped[period].length||0,1);
  const programmed=grouped[period].slice(0,required);
  const horaires=fpqParseHoraires(site,period);
  programmed.forEach(x=>slots.push({agent:x.agent,site,rot:x.rot,horaires,group:x.group,vacant:false,periode:period}));
  for(let i=programmed.length;i<required;i++)slots.push({agent:null,site,rot:{jour:`${period==="nuit"?"Nuit":"Jour"} · poste ${i+1}`,periode:period,regle:"Effectif à couvrir"},horaires,group:"—",vacant:true,slotIndex:i+1,periode:period});
  return slots;
}

function fpqLineOrder(f){
  if(Number.isFinite(+f?.presenceOrder))return +f.presenceOrder;
  const m=String(f?.vacantKey||"").match(/:(\d+)$/);
  if(m)return +m[1];
  const created=Date.parse(f?.createdAt||"");
  return Number.isFinite(created)?created:999999;
}

function fpqGenerateAuto(date,soc,siteId){
  if(fpqGuardArchive(date)||fpqGuardCloture(date))return;
  const selectedSite=siteId?(db.sites||[]).find(s=>String(s.id)===String(siteId)||String(s.backendId||"")===String(siteId)):null;
  const sites=(db.sites||[]).filter(s=>s.actif!==false&&siteBelongsToPrimarySociete(s,soc)&&(!selectedSite||siteMatchesReference(selectedSite,{siteId:s.id,siteBackendId:s.backendId,siteName:s.nom||s.intitule})));
  if(!sites.length){toast("Aucun site actif pour ce filtre","error");return}
  let candidates=[],sitesSansAgent=0;
  sites.forEach(site=>{
    const agentsSite=pointageOperationalAgents(soc).filter(a=>siteMatchesReference(site,agentLiveAffectation(a)));
    if(!agentsSite.length)sitesSansAgent++;
    candidates.push(...fpqSiteProgrammedSlots(site,date,agentsSite));
  });
  if(!candidates.length){toast("Aucun employé opérationnel affecté aux sites actifs","error");return}
  if(!confirm(`Générer automatiquement la feuille du ${formatDate(date)} ?\n\n${candidates.length} agent(s) sur site(s) actif(s)\n${sites.length} site(s) actif(s) vérifié(s)\n${sitesSansAgent} site(s) sans agent actif affecté\n\nLes lignes déjà saisies ne seront pas écrasées.`))return;
  const siteIds=new Set(sites.map(s=>s.id));
  let replaced=0;
  db.feuillePresence=(db.feuillePresence||[]).filter(f=>{
    const generated=!!(f.generatedAt||f.generatedBy||f.vacant);
    if(f.date===date&&siteIds.has(f.siteId)&&!f.valide&&generated){ptRemovePresenceLine(f);replaced++;return false}
    return true;
  });
  let added=0,existing=0;
  candidates.forEach(({agent:a,site,rot,horaires,group,vacant,slotIndex,periode},idx)=>{
    const vacantKey=`${site.id}:${periode}:${slotIndex||group}`;
    const ex=a?fpqGet(date,a.id):(db.feuillePresence||[]).find(f=>f.date===date&&f.siteId===site.id&&f.vacant&&f.vacantKey===vacantKey);
    if(ex){
      if(a)fpqSyncAffectation(ex,a);
      existing++;
      return;
    }
    const f=a?fpqEnsure(date,a.id):{id:uid("fpq"),date,agentId:"",heureArrivee:"",heureDepart:"",heureReleve:"",observations:"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),vacant:true,vacantKey};
    f.siteId=site.id;f.siteBackendId=site.backendId||"";f.siteName=site.nom||site.intitule||"";f.poste=a?(agentLiveAffectation(a)?.poste||a.fonction||""):"APS";f.societe=a?(a.societe||sitePrimarySociete(site)||""):(sitePrimarySociete(site)||"");
    f.rotationPeriode=rot.periode;f.rotationGroupe=group;f.presenceOrder=Number.isFinite(+f.presenceOrder)?+f.presenceOrder:idx+1;f.heureArrivee="";f.heureDepart="";f.heureReleve=horaires.r;
    f.observations=vacant?`Poste ${periode==="nuit"?"nuit":"jour"} à couvrir · Affecter un APS à la prise`:`Généré automatiquement · Site actif · Groupe ${group}${rot.jour?" / "+rot.jour:""}${rot.regle?" / "+rot.regle:""}`.trim();
    f.generatedBy=session?.username||"system";f.generatedAt=new Date().toISOString();f.updatedAt=new Date().toISOString();
    if(!a)db.feuillePresence.push(f);
    added++;
  });
  if(window.SGDI?.pointage?.generateRotation){const backendSiteId=siteId?((db.sites||[]).find(s=>s.id===siteId)?.backendId||null):null;SGDI.pointage.generateRotation({presence_date:date,society:soc||null,site_id:backendSiteId,overwrite_generated:true}).catch(e=>console.warn("Génération SQL rotation indisponible",e))}
  saveDB();
  if(typeof logActivity==="function")logActivity("Génération feuille quotidienne",formatDate(date)+" · "+added+" ligne(s) · sites actifs: "+sites.length+" · filtre: "+(soc||"toutes")+" / "+(siteId||"tous sites"));
  toast(`Feuille générée : ${added} ligne(s) ajoutée(s)${replaced?` · ${replaced} ancienne(s) remplacée(s)`:''}${existing?` · ${existing} déjà validée(s)/conservée(s)`:''}`,"success");
  renderView();
}

function fpqAddAgentModal(date){
  const ag=(db.agents||[]).filter(a=>a.statut==="actif").sort((x,y)=>(x.nom||"").localeCompare(y.nom||""));
  openModal(`<h3 class="font-bold text-lg mb-3">➕ Ajouter un agent à la feuille du ${formatDate(date)}</h3>
    <form onsubmit="event.preventDefault();fpqConfirmAdd('${date}')">
      <label class="label">Agent *</label>
      <select class="select" name="agentId" ><option value="">— Choisir —</option>${ag.map(a=>`<option value="${a.id}">${escapeHTML((a.nom||"")+" "+(a.prenom||""))} [${escapeHTML(a.matricule||"—")}] · ${escapeHTML(a.societe||"")}</option>`).join("")}</select>
      <div class="flex gap-2 justify-end mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Ajouter</button></div>
    </form>`);
}

async function fpqConfirmAdd(date){const fd=new FormData(document.querySelector(".modal-bg form"));const id=fd.get("agentId");if(!id)return;if(fpqGet(date,id)){toast("Cet agent figure déjà sur la feuille","error");return}try{await sgdiRunLegacyAction("add-presence-agent",{data:{date,agentId:id}});await sgdiPullState({silent:true});closeModal();toast("Agent ajouté par le backend","success");renderView()}catch(e){toast("Ajout refusé : "+(e.message||e),"error")}}

function fpqFonctionAbbr(label){
  const stop=new Set(["a","au","aux","d","de","des","du","et","en","l","la","le","les","un","une"]);
  const words=String(label||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters=words.filter(w=>!stop.has(w.toLowerCase())).map(w=>w[0]).join("").toUpperCase();
  return letters||String(label||"—").slice(0,3).toUpperCase();
}

function fpqApsAgentsForPrise(date,currentId){
  const used=new Set((db.feuillePresence||[]).filter(f=>f.date===date&&f.agentId&&f.agentId!==currentId).map(f=>f.agentId));
  const standby=fpqRecoveryStandby(date,fpqCurrentSoc(),fpqCurrentSite()).map(r=>r.agent).filter(a=>!used.has(a.id));
  const aps=(db.agents||[]).filter(a=>a.statut==="actif"&&!used.has(a.id)&&fpqFonctionAbbr(a.affectationCourante?.poste||a.fonction||"")==="APS");
  const seen=new Set();
  return [...standby,...aps].filter(a=>{if(seen.has(a.id))return false;seen.add(a.id);return true}).sort((x,y)=>(x.matricule||x.nom||"").localeCompare(y.matricule||y.nom||""));
}

async function fpqAssignVacantAgent(rowId,agentId){
  if(guardOpsSupervisorMutation("affectation","Accès superviseur OPS : affectation non autorisée."))return;
  const f=(db.feuillePresence||[]).find(x=>x.id===rowId);if(!f||!agentId)return;
  if(fpqGuardArchive(f.date)||fpqGuardCloture(f.date))return;
  if((db.feuillePresence||[]).some(x=>x.date===f.date&&x.agentId===agentId&&x.id!==rowId)){toast("Cet employé figure déjà sur la feuille","error");renderView();return}
  const a=(db.agents||[]).find(x=>x.id===agentId);if(!a)return;
  const patch={presenceOrder:fpqLineOrder(f),agentId,vacant:false,siteManual:true,poste:a.affectationCourante?.poste||a.fonction||"APS",societe:f.societe||a.societe||""};
  try{await sgdiRunLegacyAction("assign-vacant-agent",{data:{date:f.date,agentId:f.agentId,patch}});await sgdiPullState({silent:true});toast("APS affecté par le backend","success");renderView()}catch(e){toast("Affectation refusée : "+(e.message||e),"error")}
}

function fpqToggleSite(key){if(_fpqCollapsed.has(key))_fpqCollapsed.delete(key);else _fpqCollapsed.add(key);renderView()}

function fpqSetSort(key){if(_fpqSortKey===key)_fpqSortDir*=-1;else{_fpqSortKey=key;_fpqSortDir=1;}renderView()}

function ptOpenCodePicker(agentId,ym,day){
  const s=ptEnsureSheet(agentId,ym);if(s.valide){toast("🔒 Pointage validé · déverrouillez d'abord","error");return}
  const k=String(day).padStart(2,"0");const cur=s.days[k]||"";const mo=ym.split("-")[1];
  const grp=(title,codes)=>`<div style="margin-bottom:12px"><div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:6px">${title}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${codes.map(code=>{const c=POINTAGE_CODES[code];const sel=code===cur;return`<button onclick="ptPickCode('${agentId}','${ym}',${day},'${code}')" style="background:${c.bg};color:${c.color};border:${sel?`2px solid ${c.color}`:`1px solid ${c.color}44`};border-radius:7px;padding:5px 13px;font-family:ui-monospace,monospace;font-weight:900;font-size:13px;cursor:pointer;${sel?`box-shadow:0 0 0 3px ${c.color}33`:""}" title="${c.label}">${code}</button>`}).join("")}</div></div>`;
  openModal(`<div style="min-width:320px;max-width:420px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h3 style="font-weight:900;font-size:15px;margin:0">Pointage — Jour ${k}/${String(mo).padStart(2,"0")}</h3>
      <button onclick="closeModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#94a3b8;line-height:1;padding:0 4px">✕</button>
    </div>
    ${grp("Présence / Absence",["P","A","M","S","C","R","AB"])}
    ${grp("Récup. travaillée · présent",["F1","F2","F3"])}
    ${grp("Maintenu en poste · présent",["P/F1","P/F2","P/F3"])}
    ${grp("Absent partiel",["A1","A2","A3"])}
    ${cur?`<div style="padding-top:10px;border-top:1px solid #f1f5f9;margin-top:2px"><button onclick="ptPickCode('${agentId}','${ym}',${day},'')" style="background:#f8fafc;color:#64748b;border:1px solid #e2e8f0;border-radius:6px;padding:5px 14px;font-size:12px;cursor:pointer;font-weight:600">✕ Effacer (actuellement : <strong>${cur}</strong>)</button></div>`:""}
  </div>`);
}

function ptPickCode(agentId,ym,day,code){ptSetCell(agentId,ym,day,code);ptWarnIfPaieAlreadyClosed(agentId,ym);closeModal();renderView()}

function ptFillRow(agentId,ym,code){const s=ptEnsureSheet(agentId,ym);if(s.valide){toast("🔒 Pointage validé","error");return}if(!confirm("Remplir toute la ligne avec « "+code+" » ?"))return;const days=ptDaysInMonth(ym);for(let d=1;d<=days;d++)ptSetCell(agentId,ym,d,code);ptWarnIfPaieAlreadyClosed(agentId,ym);renderView()}

function ptWarnIfPaieAlreadyClosed(agentId,ym){
  const key=String(agentId??"");
  const a=(db.agents||[]).find(x=>String(x.id??"")===key);
  if(!a||typeof paieIsClosed!=="function"||!paieIsClosed(ym,a.societe))return;
  const label=typeof paieMonthLabel==="function"?paieMonthLabel(ym):ym;
  toast(`⚠ La paie de ${label} est déjà clôturée pour ${(a.nom||"")+" "+(a.prenom||"")} — ce pointage ne sera pas repris tant que le bulletin n'est pas régénéré.`,"error");
}

async function ptClearRow(agentId,ym){if(guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : effacement pointage non autorisé."))return;const s=ptGetSheet(agentId,ym);if(s&&s.valide){toast("🔒 Pointage validé","error");return}if(!confirm("Effacer toute la ligne ?"))return;if(s){s.days={};s.fpqSync={};s.updatedAt=new Date().toISOString()}try{await sgdiRunLegacyAction("clear-pointage-sheet",{data:{agentId,periode:ym}});uiSaveState("Sauvegardé","success");ptWarnIfPaieAlreadyClosed(agentId,ym);renderView()}catch(e){toast("Effacement refusé : "+(e.message||e),"error");await sgdiPullState({silent:true,force:true}).catch(()=>null);renderView()}}

function ptCount(sheet,code){if(!sheet)return 0;return Object.values(sheet.days||{}).filter(v=>v===code).length}

function ptCellHTML(agentId,ym,day,code,isWeekend,isToday,locked){
  const c=POINTAGE_CODES[code];
  const cls=["pt-day"];if(isWeekend)cls.push("weekend");if(isToday)cls.push("today");
  const btnCls=(code?"pt-code-chip":"pt-code-dot")+(locked?" locked":" editable");
  const bg=c?c.bg:"transparent";const fg=c?c.color:(isWeekend?"#1e40af":"#94a3b8");
  const title=locked?"Pointage validé — déverrouillez la ligne pour modifier":(c?`${code} — ${c.label}`:"Cliquer pour choisir le code");
  return`<td class="${cls.join(" ")}"><button type="button" class="${btnCls}" onclick="ptOpenCodePicker('${agentId}','${ym}',${day})" style="background:${bg};color:${fg}" title="${escapeHTML(title)}">${code||"·"}</button></td>`;
}

function ptSupervisorMonthlyCount(sheet,code){
  if(!sheet)return 0;
  const days=Object.values(sheet.days||{});
  if(code==="R")return days.filter(v=>v==="R").length;
  if(code==="A1")return days.filter(v=>v==="A"||v==="A1"||v==="AB").length;
  if(code==="A2")return days.filter(v=>v==="A2").length;
  if(code==="A3")return days.filter(v=>v==="A3").length;
  if(code==="F1")return days.filter(v=>v==="F1"||v==="P/F1").length;
  if(code==="F2")return days.filter(v=>v==="F2"||v==="P/F2").length;
  if(code==="F3")return days.filter(v=>v==="F3"||v==="P/F3").length;
  return days.filter(v=>v===code).length;
}

function ptSupervisorSiteKey(agent){
  const aff=agentLiveAffectation(agent)||agent?.affectationCourante||{};
  const site=(db.sites||[]).find(s=>siteMatchesReference(s,aff));
  return site?.id||site?.backendId||aff.siteId||aff.siteBackendId||aff.site_id||aff.siteName||"__sans_site__";
}

function ptSupervisorDailyCell(agentId,ym,day,sheet,code,isValide){
  const c=POINTAGE_CODES[code]||{};
  const cur=(sheet?.days||{})[day]||"";
  const active=cur===code;
  const disabled=!!isValide;
  const title=disabled
    ?"Pointage déjà validé"
    :`Saisir ${code} pour le ${day}/${String(ym).slice(5,7)}`;
  return `<td role="button" tabindex="${disabled?"-1":"0"}" ${disabled?"":`onclick="ptSupervisorSetDailyCode('${agentId}','${ym}','${day}','${code}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();ptSupervisorSetDailyCode('${agentId}','${ym}','${day}','${code}')}"`} title="${escapeHTML(title)}" style="border:1px solid #dbe3ee;text-align:center;width:74px;min-width:74px;height:36px;background:${c.bg||"#fff"};color:${active?(c.color||"#043970"):"#0f172a"};font-size:10px;font-weight:900;line-height:36px;cursor:${disabled?"not-allowed":"pointer"};user-select:none;opacity:${disabled&&!active?".55":"1"}">${active?code:"·"}</td>`;
}

function ptSupervisorObservationCell(agentId,ym,day,sheet,isValide){
  const current=(sheet?.observations||{})[day]||"";
  const inputId=`pt-sup-obs-${agentId}-${ym}-${day}`;
  return `<td style="border:1px solid #dbe3ee;padding:4px 6px;background:#fff">
    <div style="display:flex;align-items:center;gap:4px">
      <input type="text" id="${inputId}" value="${escapeHTML(current)}" ${isValide?"disabled":""} placeholder="Note libre..." style="flex:1;min-width:140px;height:26px;border:1px solid #dbe3ee;border-radius:6px;padding:0 6px;font-size:10px;background:${isValide?"#f1f5f9":"#fff"}">
      <button type="button" ${isValide?"disabled":""} onclick="ptSupervisorSaveObservation('${agentId}','${ym}','${day}')" style="height:26px;border:1px solid #bfdbfe;background:${isValide?"#f1f5f9":"#eff6ff"};color:#043970;border-radius:6px;padding:0 8px;font-size:10px;font-weight:900;cursor:${isValide?"not-allowed":"pointer"};white-space:nowrap">Enregistrer</button>
    </div>
  </td>`;
}

async function ptSupervisorSaveObservation(agentId,ym,day){
  const inputId=`pt-sup-obs-${agentId}-${ym}-${day}`;
  const el=document.getElementById(inputId);
  const text=(el?.value||"").trim();
  try{
    const out=await sgdiRunLegacyAction("save-pointage-observation",{data:{agentId,periode:ym,day,text}});
    const item=out?.data?.item;
    if(item){
      if(!db.pointages)db.pointages=[];
      const idx=db.pointages.findIndex(p=>String(p.agentId)===String(item.agentId)&&p.periode===item.periode);
      if(idx>=0)db.pointages[idx]=item;else db.pointages.push(item);
    }
    toast("Observation enregistrée","success");
    renderView();
  }catch(e){toast("Enregistrement refusé : "+(e.message||e),"error")}
}

function ptSupervisorSetDailyCode(agentId,ym,day,code){
  const sheet=ptGetSheet(agentId,ym);
  if(ptSupDayValidated(sheet,day)){toast("Ce jour est déjà validé : ligne verrouillée.","error");return}
  ptSetCell(agentId,ym,Number(day),code);
  renderView();
}

function ptSupervisorCorrectDailyCode(agentId,ym,day){
  const sheet=ptGetSheet(agentId,ym);
  if(ptSupDayValidated(sheet,day)){toast("Ce jour est déjà validé : déverrouillez avant correction.","error");return}
  const key=String(day).padStart(2,"0");
  if(!(sheet?.days||{})[key]){toast("Aucun pointage à corriger pour ce jour.","info");return}
  ptSetCell(agentId,ym,Number(day),"");
  renderView();
}

async function ptSupValiderDay(agentId,ym,day){
  if(!supervisorModuleActive()&&guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : validation pointage non autorisée."))return;
  try{
    const code=(ptGetSheet(agentId,ym)?.days||{})[String(day).padStart(2,"0")]||"";
    if(!code){toast("Sélectionnez d'abord P, A, C, R, F1, F2, F3, A2 ou A3 avant de valider.","error");return}
    const out=await sgdiRunLegacyAction("validate-pointage-day",{data:{agentId,periode:ym,day,code}});
    const item=out?.data?.item;
    if(item){
      if(!db.pointages)db.pointages=[];
      const idx=db.pointages.findIndex(p=>String(p.agentId)===String(item.agentId)&&p.periode===item.periode);
      if(idx>=0)db.pointages[idx]=item;else db.pointages.push(item);
    }
    else await sgdiPullState({silent:true});
    logActivity&&logActivity("Pointage jour validé","Agent "+agentId+" · "+ym+"-"+day);
    toast("Journée validée","success");
    renderView();
  }catch(e){toast("Validation refusée : "+(e.message||e),"error")}
}

async function ptSupDevaliderDay(agentId,ym,day){
  if(!supervisorModuleActive()&&guardOpsSupervisorMutation("pointage-admin","Accès superviseur OPS : déverrouillage pointage non autorisé."))return;
  if(!confirm("Déverrouiller ce jour validé ?"))return;
  try{
    await sgdiRunLegacyAction("unlock-pointage-day",{data:{agentId,periode:ym,day}});
    await sgdiPullState({silent:true});
    logActivity&&logActivity("Pointage jour déverrouillé","Agent "+agentId+" · "+ym+"-"+day);
    toast("Journée déverrouillée","success");
    renderView();
  }catch(e){toast("Déverrouillage refusé : "+(e.message||e),"error")}
}

function ptSupervisorOpenCorrection(agentId,ym,day){
  const sheet=ptGetSheet(agentId,ym);
  if(sheet?.valide){toast("Pointage mensuel validé : correction non autorisée ici.","error");return}
  if(!ptSupDayValidated(sheet,day)){toast("Aucune validation passée à corriger.","info");return}
  const current=(sheet?.days||{})[String(day).padStart(2,"0")]||"";
  const codes=PT_SUPERVISOR_DAILY_CODES;
  const buttons=codes.map(code=>{
    const c=POINTAGE_CODES[code]||{};
    const active=code===current;
    return `<button type="button" onclick="ptSupervisorApplyCorrection('${agentId}','${ym}','${day}','${code}')" style="height:38px;min-width:48px;border:${active?`2px solid ${c.color||"#043970"}`:"1px solid #dbe3ee"};background:${c.bg||"#fff"};color:${c.color||"#0f172a"};font-weight:900;border-radius:8px;cursor:pointer">${code}</button>`;
  }).join("");
  openModal(`<div style="min-width:320px;max-width:420px">
    <h3 class="font-black text-lg mb-2">Corriger le pointage</h3>
    <p class="text-sm text-slate-500 mb-4">Choisissez le nouveau code pour le ${escapeHTML(day)}/${escapeHTML(String(ym).slice(5,7))}. La journée sera revalidée automatiquement.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${buttons}</div>
    ${current?`<div style="padding-top:12px;margin-top:12px;border-top:1px solid #e2e8f0"><button type="button" class="btn btn-ghost text-red-700" onclick="ptSupervisorClearCorrection('${agentId}','${ym}','${day}')">Effacer le code</button></div>`:""}
    <div class="flex justify-end mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button></div>
  </div>`);
}

async function ptSupervisorClearCorrection(agentId,ym,day){
  try{
    await sgdiRunLegacyAction("unlock-pointage-day",{data:{agentId,periode:ym,day}});
    ptSetCell(agentId,ym,Number(day),"");
    closeModal();
    toast("Code de pointage effacé","success");
    renderView();
  }catch(e){toast("Effacement refusé : "+(e.message||e),"error")}
}

function ptSupervisorOpenDailyEditor(agentId,ym,day){
  const sheet=ptGetSheet(agentId,ym);
  if(ptSupDayValidated(sheet,day))return ptSupervisorOpenCorrection(agentId,ym,day);
  const current=(sheet?.days||{})[String(day).padStart(2,"0")]||"";
  const codes=PT_SUPERVISOR_DAILY_CODES;
  const buttons=codes.map(code=>{
    const c=POINTAGE_CODES[code]||{};
    const active=code===current;
    return `<button type="button" onclick="ptSupervisorSetDailyCode('${agentId}','${ym}','${day}','${code}');closeModal()" style="height:38px;min-width:48px;border:${active?`2px solid ${c.color||"#043970"}`:"1px solid #dbe3ee"};background:${c.bg||"#fff"};color:${c.color||"#0f172a"};font-weight:900;border-radius:8px;cursor:pointer">${code}</button>`;
  }).join("");
  openModal(`<div style="min-width:320px;max-width:420px">
    <h3 class="font-black text-lg mb-2">Modifier le pointage</h3>
    <p class="text-sm text-slate-500 mb-4">Choisissez le code avant validation pour le ${escapeHTML(day)}/${escapeHTML(String(ym).slice(5,7))}.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${buttons}</div>
    ${current?`<div style="padding-top:12px;margin-top:12px;border-top:1px solid #e2e8f0"><button type="button" class="btn btn-ghost text-red-700" onclick="ptSetCell('${agentId}','${ym}',${Number(day)},'');closeModal();renderView()">Effacer le code</button></div>`:""}
    <div class="flex justify-end mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button></div>
  </div>`);
}

async function ptSupervisorApplyCorrection(agentId,ym,day,code){
  try{
    await sgdiRunLegacyAction("unlock-pointage-day",{data:{agentId,periode:ym,day}});
    const out=await sgdiRunLegacyAction("validate-pointage-day",{data:{agentId,periode:ym,day,code}});
    const item=out?.data?.item;
    if(item){
      if(!db.pointages)db.pointages=[];
      const idx=db.pointages.findIndex(p=>String(p.agentId)===String(item.agentId)&&p.periode===item.periode);
      if(idx>=0)db.pointages[idx]=item;else db.pointages.push(item);
    }
    closeModal();
    if(!item)await sgdiPullState({silent:true});
    toast("Pointage corrigé et validé","success");
    renderView();
  }catch(e){toast("Correction refusée : "+(e.message||e),"error")}
}

function renderPointageSaisieSuperviseur(freshNav){
  setTimeout(()=>{if(typeof _sgdiUpdateEditFab==="function")_sgdiUpdateEditFab()},0);
  const supDate=ptSupDate();
  const [supYr,supMo,supDay]=supDate.split("-");
  const ym=`${supYr}-${supMo}`;
  const soc=ptCurrentSoc();
  ptSyncFeuillePresenceMonth(ym);
  const scopedAgents=ptSupervisorAgentsForSoc(soc);
  // Options du sélecteur de site : calculées sur le périmètre COMPLET (avant filtre texte),
  // pour que la liste déroulante ne change pas de contenu selon ce que l'utilisateur tape.
  const siteOptionsMap={};
  scopedAgents.forEach(a=>{
    const key=ptSupervisorSiteKey(a);
    if(!siteOptionsMap[key])siteOptionsMap[key]=ptSupervisorSiteLabel(a);
  });
  const siteOptions=Object.entries(siteOptionsMap).sort((a,b)=>a[1].localeCompare(b[1]));
  const siteFilter=ptSupCurrentSiteFilter();
  let all=ptFilterAgents(scopedAgents).sort((x,y)=>{
    const sx=ptSupervisorSiteLabel(x),sy=ptSupervisorSiteLabel(y);
    return sx.localeCompare(sy)||(x.nom||"").localeCompare(y.nom||"")||(x.prenom||"").localeCompare(y.prenom||"");
  });
  if(siteFilter)all=all.filter(a=>ptSupervisorSiteKey(a)===siteFilter);
  if(freshNav&&!all.length)ptSupervisorEnsureDataForEmptyView(soc,true);
  const [yr,mo]=ym.split("-").map(Number);
  const day=supDay;
  const dayLabel=`${day}/${String(mo).padStart(2,"0")}/${yr}`;
  const monthLabel=new Date(yr,mo-1,1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
  const grouped={};
  all.forEach(a=>{
    const key=ptSupervisorSiteKey(a);
    if(!grouped[key])grouped[key]={label:ptSupervisorSiteLabel(a),rows:[]};
    grouped[key].rows.push(a);
  });
  const groups=Object.values(grouped).sort((a,b)=>a.label.localeCompare(b.label));
  const siteSelectHTML=`<label class="flex flex-col gap-1 text-[10px] font-black uppercase tracking-[.12em] text-slate-500" style="flex:1;min-width:200px;max-width:280px">
    Site
    <select id="ptsup-site-filter" class="input text-sm w-full" style="height:40px;border-radius:10px" onchange="setPtSupSiteFilter(this.value)">
      <option value="">Tous les sites</option>
      ${siteOptions.map(([key,label])=>`<option value="${escapeHTML(key)}" ${siteFilter===key?"selected":""}>${escapeHTML(label)}</option>`).join("")}
    </select>
  </label>`;
  const filterBar=`<div class="card p-4 mb-4" data-nav-filter><div class="flex flex-wrap items-center gap-3">
    ${ptSupervisorDateSelectHTML(supDay||"01",supMo||"01",supYr||String(new Date().getFullYear()))}
    ${ptSearchBarLabeledHTML("Rechercher nom, code, site...")}
    ${siteSelectHTML}
    <div class="flex-1"></div>
    <button class="btn btn-ghost text-xs" onclick="window.print()">Imprimer</button>
  </div></div>`;
  if(!all.length){
    const loading=!ptCurrentSearch()&&(_ptSupervisorDataLoading||ptSupervisorEnsureDataForEmptyView(soc));
    const ids=supervisorAuthorizedSiteIds();
    const hint=ids&&ids.size?`Sites autorisés : ${[...ids].slice(0,6).map(escapeHTML).join(", ")}${ids.size>6?"...":""}`:"Périmètre sites global ou non renseigné.";
    return filterBar+`<div class="card p-8 text-center text-slate-500">${loading?`Chargement PostgreSQL des employés, sites et affectations...`:ptCurrentSearch()?`Aucun résultat pour « ${escapeHTML(ptCurrentSearch())} »`:`Aucun employé rattaché aux sites autorisés pour ${escapeHTML(soc||"ce périmètre")}.`}<div class="text-xs mt-2 text-slate-400">${hint}</div></div>`;
  }
  const headers=`<thead><tr style="background:#e5e7eb;color:#1f2937;text-transform:uppercase;letter-spacing:.08em">
    <th style="border:1px solid #dbe3ee;width:42px;padding:10px 6px;text-align:center;font-size:11px;font-weight:900">N°</th>
    <th style="border:1px solid #dbe3ee;min-width:180px;padding:10px 8px;text-align:left;font-size:11px;font-weight:900">Agent</th>
    ${PT_SUPERVISOR_DAILY_CODES.map(k=>`<th style="border:1px solid #dbe3ee;width:74px;padding:10px 4px;text-align:center;font-size:10px;font-weight:900">${PT_SUPERVISOR_DAILY_HEADER_LABELS[k]||k}</th>`).join("")}
    <th style="border:1px solid #dbe3ee;width:150px;padding:10px 6px;text-align:center;font-size:11px;font-weight:900">Action</th>
    <th style="border:1px solid #dbe3ee;min-width:220px;padding:10px 6px;text-align:center;font-size:11px;font-weight:900">Observations</th>
  </tr></thead>`;
  const tableForGroup=(group)=>{
    const rows=group.rows.map((a,i)=>{
      const sheet=ptGetSheet(a.id,ym);
      const isValide=ptSupDayValidated(sheet,day);
      const action=`<div style="display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:nowrap">
        <button type="button" onclick="${isValide?"toast('Cette journée est déjà validée. Utilisez Modifier pour corriger.','info')":`ptSupValiderDay('${a.id}','${ym}','${day}')`}" style="height:24px;border:1px solid ${isValide?"#bbf7d0":"#bfdbfe"};background:${isValide?"#f0fdf4":"#eff6ff"};color:${isValide?"#047857":"#043970"};border-radius:6px;padding:0 7px;font-size:10px;font-weight:900;cursor:pointer;white-space:nowrap">${isValide?"Validé":"Valider"}</button>
        <button type="button" onclick="ptSupervisorOpenDailyEditor('${a.id}','${ym}','${day}')" style="height:24px;border:1px solid #fed7aa;background:#fff7ed;color:#c2410c;border-radius:6px;padding:0 7px;font-size:10px;font-weight:900;cursor:pointer;white-space:nowrap">Modifier</button>
      </div>`;
      return `<tr style="background:${isValide?"#f0fdf4":"#f8fbff"}">
        <td style="border:1px solid #dbe3ee;text-align:center;height:38px;color:#0f172a;font-size:10px;font-weight:900">${i+1}</td>
        <td style="border:1px solid #dbe3ee;padding:0 8px;height:38px;color:#1f2937;font-size:10px;font-weight:900;white-space:nowrap">
          ${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())} <span style="color:#1d70a2;font-family:ui-monospace,monospace;font-size:9px">${escapeHTML(a.matricule||"")}</span>
        </td>
        ${PT_SUPERVISOR_DAILY_CODES.map(code=>ptSupervisorDailyCell(a.id,ym,day,sheet,code,isValide)).join("")}
        <td style="border:1px solid #dbe3ee;text-align:center;background:#fff;height:38px;padding:4px">${action}</td>
        ${ptSupervisorObservationCell(a.id,ym,day,sheet,isValide)}
      </tr>`;
    }).join("");
    return `<section class="card p-0 mb-5" style="overflow:hidden;border-color:#d8e4f2">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #dbe3ee">
        <div style="font-size:12px;font-weight:900;color:#0f172a;text-transform:uppercase">${escapeHTML(group.label)}</div>
        <div style="font-size:11px;font-weight:800;color:#64748b">${group.rows.length} agent${group.rows.length>1?"s":""}</div>
      </div>
      <div style="overflow-x:auto"><table style="border-collapse:collapse;width:auto;min-width:604px;font-size:10px">${headers}<tbody>${rows}</tbody></table></div>
    </section>`;
  };
  return `${filterBar}<div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
    <div><h2 class="text-2xl font-black uppercase">Feuille quotidienne superviseur</h2><p class="text-sm text-slate-500">Personnel rattaché par site d'affectation · ${escapeHTML(dayLabel)} · ${all.length} agent${all.length>1?"s":""}</p></div>
    <button type="button" class="topbar-dialogue-btn pointage-dialogue-style-btn" onclick="navigate('pointage/feuille')">Pointage mensuel</button>
  </div>
  ${groups.map(tableForGroup).join("")}`;
}

function ptDonutSVG(slices,total,cx,cy,r,ir){
  if(!total)return`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f1f5f9"/>`;
  let angle=-Math.PI/2;
  return slices.filter(s=>s.v>0).map(s=>{
    const sweep=(s.v/total)*2*Math.PI;
    const x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle);
    angle+=sweep;
    const x2=cx+r*Math.cos(angle),y2=cy+r*Math.sin(angle);
    const lg=sweep>Math.PI?1:0;
    const ix1=cx+ir*Math.cos(angle),iy1=cy+ir*Math.sin(angle);
    const ix2=cx+ir*Math.cos(angle-sweep),iy2=cy+ir*Math.sin(angle-sweep);
    return`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${lg},1 ${x2.toFixed(1)},${y2.toFixed(1)} L${ix1.toFixed(1)},${iy1.toFixed(1)} A${ir},${ir} 0 ${lg},0 ${ix2.toFixed(1)},${iy2.toFixed(1)} Z" fill="${s.c}"/>`;
  }).join("");
}

function renderPointageDashboard(isDrh){
  const ym=ptCurrentMonth();const soc=ptCurrentSoc();const days=ptDaysInMonth(ym);const todayDate=today();
  const ag=pointageEligibleAgents(soc);
  const sheets=ag.map(a=>ptGetSheet(a.id,ym)).filter(Boolean);
  const valid=sheets.filter(s=>s.valide).length;
  const tot={P:0,A:0,M:0,S:0,C:0,R:0,AB:0,F1:0,F2:0,F3:0,"P/F1":0,"P/F2":0,"P/F3":0,A1:0,A2:0,A3:0};
  sheets.forEach(sh=>Object.values(sh.days||{}).forEach(v=>{if(tot[v]!==undefined)tot[v]++;}));
  const expected=ag.length*days;const filled=sheets.reduce((n,sh)=>n+Object.keys(sh.days||{}).length,0);
  const coverage=expected?Math.round(filled*100/expected):0;
  const fpq=(db.feuillePresence||[]).filter(f=>f.date===todayDate&&(!soc||normalizeSocieteName(f.societe||"")===normalizeSocieteName(soc)));
  const fpqPresents=fpq.filter(f=>!!POINTAGE_CODES[String(f.code||"").toUpperCase()]?.isPresent||fpqPresenceCode(f.heureArrivee)||f.scanArrivee).length;
  const fpqRate=ag.length?Math.round(fpqPresents*100/ag.length):0;
  const unclosed=[...new Set((db.feuillePresence||[]).map(f=>f.date).filter(Boolean))].filter(d=>!fpqIsCloture(d));
  const totalPresent=(tot.P||0)+(tot.F1||0)+(tot.F2||0)+(tot.F3||0)+(tot["P/F1"]||0)+(tot["P/F2"]||0)+(tot["P/F3"]||0);
  const totalAbsent=(tot.A||0)+(tot.A1||0)+(tot.A2*2||0)+(tot.A3*3||0)+(tot.AB||0);
  const totalAll=Object.values(tot).reduce((a,b)=>a+b,0);
  const tauxP=totalAll?Math.round(totalPresent*100/totalAll):0;
  const tauxA=totalAll?Math.round(totalAbsent*100/totalAll):0;
  const elapsed=Math.min(parseInt(todayDate.slice(8,10)||1),days);
  const moyPresDay=elapsed&&ag.length?((totalPresent/elapsed)/ag.length*100).toFixed(0):0;
  const monthLabel=new Date(parseInt(ym.split("-")[0]),parseInt(ym.split("-")[1])-1,1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
  const ICO_PERSON=`<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c1.3-4.2 12.7-4.2 14 0"/></svg>`;
  const ICO_CHECK=`<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>`;
  const ICO_DOC=`<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/></svg>`;
  const ICO_LOCK=`<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`;
  const ICO_BAR=`<svg viewBox="0 0 24 24"><path d="M4 19V9M11 19V5M18 19v-7"/></svg>`;
  const ICO_CLOCK=`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/></svg>`;
  const kpi=(label,n,route,tone,sub,ico)=>`<button type="button" class="pt-dash-kpi${tone?` ${tone}`:""}" onclick="navigate('${route}')"><span class="pt-dash-kpi-ico">${ico}</span><span class="pt-dash-kpi-body"><span class="pt-dash-kpi-label">${escapeHTML(label)}</span><span class="pt-dash-kpi-val">${n}</span><span class="pt-dash-kpi-sub">${sub||""}</span></span></button>`;
  const kpiRow=[
    kpi("Agents suivis",ag.length,isDrh?"pointage/recap":"pointage/saisie","","Effectif filtré",ICO_PERSON),
    isDrh?"":kpi("Présents aujourd'hui",fpqPresents,"pointage/feuille","ok",fpqRate+"% · "+formatDate(todayDate),ICO_CHECK),
    kpi("Couverture saisie",coverage+"%","pointage/stats",coverage>=80?"ok":"warn","Mois en cours",ICO_DOC),
    kpi("Pointages validés",valid,isDrh?"pointage/recap":"pointage/saisie","ok","Lignes verrouillées",ICO_LOCK),
    kpi("Taux présence",tauxP+"%","pointage/stats",tauxP>=80?"ok":"amber","Sur saisies du mois",ICO_BAR),
    isDrh?"":kpi("Non clôturées",unclosed.length,"pointage/feuille",unclosed.length?"warn":"ok","Feuilles à contrôler",ICO_CLOCK)
  ].filter(Boolean).join("");
  const codeChip=(k)=>{const v=POINTAGE_CODES[k];if(!v)return"";const n=tot[k]||0;const hasVal=n>0;return `<button type="button" class="pt-dash-chip${hasVal?" has-value":""}" onclick="navigate('pointage/stats')"${hasVal?` style="--accent:${v.color};--accent-bg:${v.bg}"`:""}><span class="code-tag">${escapeHTML(k)}</span><span class="code-label">${escapeHTML(v.label)}</span><span class="code-val">${n}</span></button>`;};
  const codeFamily=(title,codes)=>`<div class="pt-dash-fam"><div class="pt-dash-fam-head"><b>${escapeHTML(title)}</b><span class="n">${codes.length} code${codes.length>1?"s":""}</span></div><div class="pt-dash-chip-wrap">${codes.map(codeChip).join("")}</div></div>`;
  const codesPanel=`<div class="pt-dash-panel">
    <div class="pt-dash-panel-head"><div><h3>Répartition des codes</h3><p>Cumul du mois en cours, par famille</p></div></div>
    <div class="pt-dash-panel-body">
      ${codeFamily("Codes principaux",["P","A","M","C","S","R"])}
      ${codeFamily("Absences renforcées",["AB","A1","A2","A3"])}
      ${codeFamily("Récupération / maintien",["F1","F2","F3","P/F1","P/F2","P/F3"])}
    </div>
  </div>`;
  const statRow=(label,n,color)=>{const p=totalAll?Math.round(n*100/totalAll):0;return `<div class="pt-dash-stat-row"><span class="lbl">${escapeHTML(label)}</span><div class="pt-dash-stat-track"><div class="pt-dash-stat-fill" style="width:${p}%;background:${color}"></div></div><span class="pt-dash-stat-pct" style="color:${color}">${p}%</span></div>`;};
  const statsPanel=`<div class="pt-dash-panel">
    <div class="pt-dash-panel-head"><div><h3>Statistiques pointage</h3><p class="capitalize">${monthLabel}</p></div></div>
    <div class="pt-dash-panel-body">
      ${statRow("Présents (P+Fx)",totalPresent,"#16a34a")}
      ${statRow("Absents (A+Ax+AB)",totalAbsent,"#dc2626")}
      ${statRow("Maladie",tot.M||0,"#d97706")}
      ${statRow("Congé",tot.C||0,"#0891b2")}
      ${statRow("Récupération",tot.R||0,"#475569")}
      ${statRow("Suspendu",tot.S||0,"#7c3aed")}
      <div class="pt-dash-stat-divider"></div>
      <div class="pt-dash-tiles">
        <div class="pt-dash-tile"><b style="color:#16a34a">${tauxP}%</b><span>Taux présence</span></div>
        <div class="pt-dash-tile" style="background:#fdecec"><b style="color:#dc2626">${tauxA}%</b><span>Taux absence</span></div>
        <div class="pt-dash-tile"><b>${coverage}%</b><span>Couverture saisie</span></div>
      </div>
      <div class="pt-dash-footline">
        <span><b>${elapsed}/${days}</b> jours écoulés</span><span class="dot"></span>
        <span><b>${ag.length}</b> agents suivis</span><span class="dot"></span>
        <span><b>${valid}</b> pointages validés</span><span class="dot"></span>
        <span><b>${totalAll}</b> entrées saisies</span><span class="dot"></span>
        <span>Présence moy/jour : <b>${moyPresDay}%</b></span>
        ${fpqPresents?`<span class="dot"></span><span>Aujourd'hui : <b>${fpqPresents}</b> présent(s) sur ${ag.length}</span>`:""}
      </div>
    </div>
  </div>`;
  return `<div class="ops-dash-hero"><div class="ops-dash-hero-row">
    <div>
      <div class="ops-dash-eyebrow">Pilotage opérationnel</div>
      <h1>Tableau de bord pointage</h1>
      <div class="ops-dash-hero-sub"><span>Synthèse mensuelle et feuille de présence quotidienne · ${soc?escapeHTML(soc):"Toutes sociétés"}</span><span class="ops-dash-live"><span class="ops-dash-live-dot"></span>Temps réel</span></div>
    </div>
    ${isDrh?"":`<button type="button" class="ops-dash-refresh" style="background:#fff;color:#043970" onclick="navigate('pointage/saisie')">📋 Pointage quotidien</button>`}
  </div></div>
  <div class="pt-dash-kpis"${isDrh?` style="--pt-kpi-cols:4"`:""}>${kpiRow}</div>
  <div class="pt-dash-body-grid">${codesPanel}${statsPanel}</div>`;
}

async function fpqLiveRefresh(){
  if(!document.getElementById("fpq-live-tbody")){fpqStopLiveRefresh();return;}
  const dot=document.getElementById("fpq-live-dot");
  if(dot)dot.style.background="#f59e0b";
  try{
    const res=await sgdiApi("/api/irongs/collections/feuillePresence",{method:"GET",legacy:false});
    const data=Array.isArray(res)?res:(res?.data||[]);
    if(data.length)db.feuillePresence=data;
    const scrollY=window.scrollY;
    _fpqIsLiveRefresh=true;
    renderView();
    requestAnimationFrame(()=>window.scrollTo(0,scrollY));
  }catch(e){if(dot){dot.style.background="#dc2626";setTimeout(()=>{dot.style.background="#16a34a"},2000);}}
  finally{_fpqIsLiveRefresh=false;}
}

function fpqStartLiveRefresh(){
  fpqStopLiveRefresh();
  if(!document.getElementById("fpq-live-tbody"))return;
  const dot=document.getElementById("fpq-live-dot");
  if(dot)dot.style.background="#16a34a";
  _fpqLiveTimer=setInterval(()=>{
    if(sgdiDirty||document.hidden)return;
    if(document.querySelector(".modal-bg"))return;
    const tag=(document.activeElement&&document.activeElement.tagName)||"";
    if(["INPUT","TEXTAREA","SELECT"].includes(tag))return;
    fpqLiveRefresh();
  },supervisorModuleActive()?30000:15000);
}

function fpqStopLiveRefresh(){clearInterval(_fpqLiveTimer);_fpqLiveTimer=null;}

function renderFeuillePresentQR(){
  const isDrh=session?.transverse==="drh";
  const date=fpqCurrentDate();
  const soc=ptCurrentSoc();
  const dateLabel=new Date(date).toLocaleDateString("fr-FR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
  const allFpq=(db.feuillePresence||[]).filter(f=>f.date===date&&(!soc||normalizeSocieteName(f.societe||"")===normalizeSocieteName(soc))&&presenceInSupervisorScope(f));
  const fpqForDate=(db.feuillePresence||[]).filter(f=>f.date===date&&presenceInSupervisorScope(f));
  const agents=ptFilterAgents(pointageOperationalAgents(soc));
  agents.sort((a,b)=>(a.nom||"").localeCompare(b.nom||"")||(a.prenom||"").localeCompare(b.prenom||""));
  const findPresenceForAgent=(a)=>fpqForDate.find(x=>
    String(x.agentId||"")===String(a.id||"")||
    String(x.agentBackendId||x.employee_id||"")===String(a.backendId||"")||
    String(x.matricule||"")===String(a.matricule||"")
  )||{};
  const hasPresenceOn=(a,d)=>{
    const f=(db.feuillePresence||[]).find(x=>String(x.date||"")===d&&(
      String(x.agentId||"")===String(a.id||"")||
      String(x.agentBackendId||x.employee_id||"")===String(a.backendId||"")||
      String(x.matricule||"")===String(a.matricule||"")
    ))||{};
    return !!POINTAGE_CODES[String(f.code||"").toUpperCase()]?.isPresent||fpqPresenceCode(f.heureArrivee)==="P"||!!f.scanArrivee||(!!f.heureArrivee&&!POINTAGE_CODES[String(f.heureArrivee).toUpperCase()]);
  };
  const abandonDates=[addDays(date,-2),addDays(date,-1),date];
  const abandonAgents=agents.filter(a=>abandonDates.every(d=>!hasPresenceOn(a,d)));
  const abandonBanner=abandonAgents.length?`<div class="card p-3 mb-4" style="background:#fef2f2;border:2px solid #dc2626">
    <div class="font-black text-red-700 uppercase">Alerte abandon de poste</div>
    <div class="text-sm text-red-800">${abandonAgents.length} employé(s) sans pointage sur 3 jours consécutifs : ${abandonAgents.slice(0,6).map(a=>escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim()+" · "+(a.matricule||""))).join(" ; ")}${abandonAgents.length>6?" ...":""}</div>
  </div>`:"";
  if(_fpqSortKey){agents.sort((a,b)=>{const fa=findPresenceForAgent(a),fb=findPresenceForAgent(b);let va="",vb="";if(_fpqSortKey==="site"){va=a.affectationCourante?.siteName||fa.siteName||"";vb=b.affectationCourante?.siteName||fb.siteName||"";}else if(_fpqSortKey==="nom"){va=(a.nom||"")+" "+(a.prenom||"");vb=(b.nom||"")+" "+(b.prenom||"");}else if(_fpqSortKey==="code"){va=fa.code||fpqPresenceCode(fa.heureArrivee)||"";vb=fb.code||fpqPresenceCode(fb.heureArrivee)||"";}else if(_fpqSortKey==="arrivee"){va=fa.scanArrivee||fa.heureArrivee||"";vb=fb.scanArrivee||fb.heureArrivee||"";}else if(_fpqSortKey==="depart"){va=fa.scanDepart||fa.heureDepart||"";vb=fb.scanDepart||fb.heureDepart||"";}else if(_fpqSortKey==="etat"){va=fa.valide?"1":"0";vb=fb.valide?"1":"0";}return _fpqSortDir*va.localeCompare(vb);});}
  const fpqRowHTML=(a,i,showSite)=>{
    const f=findPresenceForAgent(a);
    const scanA=f.scanArrivee||f.heureArrivee||"";
    const scanD=f.scanDepart||f.heureDepart||"";
    const code=f.code||fpqPresenceCode(f.heureArrivee)||(scanA?"P":"");
    const codeInfo=POINTAGE_CODES[code];
    const codeColor=codeInfo?.color||(code?"#dc2626":"#94a3b8");
    const codeBg=codeInfo?.bg||(code?"#fee2e2":"#f8fafc");
    const valide=!!(f.valide||scanA);
    const site=escapeHTML(a.affectationCourante?.siteName||f.siteName||"—");
    const gpsLat=f.posGpsLat;const gpsLng=f.posGpsLng;
    const gpsCell=gpsLat&&gpsLng?`<a href="https://maps.google.com/?q=${gpsLat},${gpsLng}" target="_blank" rel="noopener" class="text-xs font-mono text-blue-700 hover:underline" title="Ouvrir dans Google Maps">${Number(gpsLat).toFixed(5)},${Number(gpsLng).toFixed(5)}</a>`:`<span class="text-xs text-slate-400">—</span>`;
    return`<tr style="border-bottom:1px solid #e2e8f0">
      <td class="px-3 py-2 text-xs text-center text-slate-400 font-mono">${i+1}</td>
      ${showSite?`<td class="px-3 py-2 text-xs font-semibold">${site}</td>`:""}
      <td class="px-3 py-2 text-xs"><div class="font-bold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</div><div class="text-[10px] text-slate-400">${escapeHTML(a.matricule||"")}</div></td>
      <td class="px-3 py-2 text-center"><span class="font-mono font-black text-sm px-2 py-1 rounded" style="background:${codeBg};color:${codeColor}">${code||"—"}</span></td>
      <td class="px-3 py-2 text-sm text-center font-mono font-semibold" style="color:${scanA?"#16a34a":"#94a3b8"}">${scanA||"—"}</td>
      <td class="px-3 py-2 text-sm text-center font-mono font-semibold" style="color:${scanD?"#dc2626":"#94a3b8"}">${scanD||"—"}</td>
      <td class="px-3 py-2 text-center">${gpsCell}</td>
      <td class="px-3 py-2 text-center">${valide?`<span class="pill" style="background:#043970;color:#fff;font-size:10px">✓ VALIDÉ</span>`:`<span class="text-xs text-slate-400">En attente</span>`}</td>
    </tr>`;
  };
  // Superviseur : organiser la feuille par site (une section par site, comme la Feuille
  // quotidienne) plutôt qu'une liste plate uniquement triable par la colonne SITE.
  const groupBySite=supervisorModuleActive();
  const rows=groupBySite?"":agents.map((a,i)=>fpqRowHTML(a,i,true)).join("");
  let siteGroupsHTML="";
  if(groupBySite){
    const grouped={};
    agents.forEach(a=>{
      const f=findPresenceForAgent(a);
      const label=a.affectationCourante?.siteName||f.siteName||"Sans site affecté";
      const key=a.affectationCourante?.siteId||a.affectationCourante?.siteBackendId||label;
      if(!grouped[key])grouped[key]={label,rows:[]};
      grouped[key].rows.push(a);
    });
    const siteGroups=Object.values(grouped).sort((a,b)=>a.label.localeCompare(b.label));
    siteGroupsHTML=siteGroups.map(group=>`<section class="card p-0 mb-4" style="overflow:hidden;border-color:#d8e4f2">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #dbe3ee">
        <div style="font-size:12px;font-weight:900;color:#0f172a;text-transform:uppercase">${escapeHTML(group.label)}</div>
        <div style="font-size:11px;font-weight:800;color:#64748b">${group.rows.length} agent${group.rows.length>1?"s":""}</div>
      </div>
      <div style="overflow-x:auto"><table class="w-full" style="border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#043970;color:#fff"><th class="px-3 py-2 text-center text-xs font-bold" style="border:1px solid #cbd5e1;width:40px">N°</th><th class="px-3 py-2 text-left text-xs font-bold" style="border:1px solid #cbd5e1">NOM PRÉNOM</th><th class="px-3 py-2 text-center text-xs font-bold" style="border:1px solid #cbd5e1;width:60px">CODE</th><th class="px-3 py-2 text-center text-xs font-bold" style="border:1px solid #cbd5e1;width:110px">HEURE ARRIVÉE</th><th class="px-3 py-2 text-center text-xs font-bold" style="border:1px solid #cbd5e1;width:110px">HEURE DÉPART</th><th class="px-3 py-2 text-center text-xs font-bold" style="border:1px solid #cbd5e1;white-space:nowrap">POSITION GPS</th><th class="px-3 py-2 text-center text-xs font-bold" style="border:1px solid #cbd5e1;width:100px">ÉTAT</th></tr></thead>
        <tbody>${group.rows.map((a,i)=>fpqRowHTML(a,i,false)).join("")}</tbody>
      </table></div>
    </section>`).join("");
  }
  const present=agents.filter(a=>{const f=findPresenceForAgent(a);return !!POINTAGE_CODES[String(f.code||"").toUpperCase()]?.isPresent||fpqPresenceCode(f.heureArrivee)==="P"||!!f.scanArrivee||(!!f.heureArrivee&&!POINTAGE_CODES[String(f.heureArrivee).toUpperCase()]);}).length;
  // Compteurs par code (Présent/Absent/Congé/Récupération/F1/F2…) : cliquables, ouvrent la
  // liste des employés concernés — même principe que les cartes cliquables du tableau de
  // bord OPS (openOpsStatModal), appliqué ici à la feuille du jour plutôt qu'au mois.
  const _fpqCodeAgentsByCode={};
  agents.forEach(a=>{
    const f=findPresenceForAgent(a);
    const code=String(f.code||"").toUpperCase()||fpqPresenceCode(f.heureArrivee)||((f.scanArrivee||f.heureArrivee)?"P":"");
    const key=code||"__none__";
    if(!_fpqCodeAgentsByCode[key])_fpqCodeAgentsByCode[key]=[];
    _fpqCodeAgentsByCode[key].push({nom:((a.nom||"")+" "+(a.prenom||"")).trim(),mat:a.matricule||"—",site:a.affectationCourante?.siteName||f.siteName||"—"});
  });
  window._fpqDailyCodeLists=_fpqCodeAgentsByCode;
  const nonPointeCount=(_fpqCodeAgentsByCode.__none__||[]).length;
  const fpqCodeCard=(k)=>{
    const v=POINTAGE_CODES[k];
    if(!v)return"";
    const n=(_fpqCodeAgentsByCode[k]||[]).length;
    return `<button type="button" onclick="fpqOpenDailyCodeModal('${k.replace(/'/g,"\\'")}')" class="pointage-code-card" style="--pc-color:${v.color};--pc-bg:${v.bg};border-color:${v.color}33"><span class="pointage-code-key">${escapeHTML(k)}</span><span class="pointage-code-label">${escapeHTML(v.label)}</span><b>${n}</b></button>`;
  };
  const fpqCodeGroup=(title,codes)=>`<section class="pointage-code-group"><div class="pointage-code-group-title">${escapeHTML(title)}</div><div class="pointage-code-grid">${codes.map(fpqCodeCard).join("")}</div></section>`;
  const dailyCodeCardsHTML=`<div class="pointage-code-groups">
    ${fpqCodeGroup("Codes principaux",["P","A","M","C","S","R"])}
    ${fpqCodeGroup("Absences renforcées",["AB","A1","A2","A3"])}
    ${fpqCodeGroup("Récupération / maintien",["F1","F2","F3","P/F1","P/F2","P/F3"])}
  </div>`;
  if(!_fpqIsLiveRefresh) setTimeout(fpqStartLiveRefresh,100);
  return`${abandonBanner}<div class="card p-4 mb-4"><div class="flex items-center justify-between flex-wrap gap-3">
    <div>
      <div class="flex items-center gap-2 mb-0.5">
        <h2 class="text-xl font-black uppercase">Feuille de présence quotidienne</h2>
        <span style="display:flex;align-items:center;gap:4px;background:#dcfce7;padding:2px 8px;border-radius:999px">
          <span id="fpq-live-dot" style="width:7px;height:7px;border-radius:50%;background:#16a34a;display:inline-block;animation:fpqPulse 1.8s ease-in-out infinite"></span>
          <span style="font-size:10px;font-weight:800;color:#15803d;letter-spacing:.06em;text-transform:uppercase">En direct</span>
        </span>
      </div>
      <p class="text-sm text-slate-500 capitalize">${escapeHTML(dateLabel)}</p>
    </div>
    <div class="flex gap-2 flex-wrap items-end">
      ${fpqDateSelectHTML(date)}
      ${ptSearchBarHTML("Rechercher nom, matricule…")}
      <button class="btn btn-ghost text-xs" onclick="fpqLiveRefresh()" title="Recharger les données depuis le serveur">↺ Actualiser</button>
      <button class="btn btn-ghost text-xs" onclick="window.print()">🖨 Imprimer</button>
    </div>
  </div>
  <div class="grid grid-cols-3 gap-3 mt-3">
    <div class="card p-3 text-center" style="background:#dcfce7"><div class="text-xs text-green-700 font-semibold">Présents</div><div class="text-2xl font-black text-green-700">${present}</div></div>
    <button type="button" onclick="fpqOpenDailyCodeModal('')" class="card p-3 text-center" style="background:#fee2e2;cursor:pointer;border:none"><div class="text-xs text-red-700 font-semibold">Non pointés</div><div class="text-2xl font-black text-red-700">${nonPointeCount}</div></button>
    <div class="card p-3 text-center" style="background:#f0f9ff"><div class="text-xs text-blue-700 font-semibold">Total agents</div><div class="text-2xl font-black text-blue-700">${agents.length}</div></div>
  </div>
  ${isDrh?"":`<div class="flex items-center justify-between mt-3 mb-1">
    <div class="text-xs font-black uppercase text-slate-500">Compteurs par code</div>
    <button type="button" class="btn btn-ghost text-xs" onclick="fpqToggleCodeCards()">${fpqCodeCardsHidden()?"▼ Afficher les compteurs":"▲ Masquer les compteurs"}</button>
  </div>
  ${fpqCodeCardsHidden()?"":dailyCodeCardsHTML}`}
  </div>
  ${groupBySite?`<div id="fpq-live-tbody">${siteGroupsHTML||`<div class="card p-8 text-center text-slate-500">Aucun agent opérationnel pour cette date.</div>`}</div>`:`<div class="card p-2"><div style="overflow-x:auto"><table class="w-full" style="border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#043970;color:#fff">${(()=>{const sk=_fpqSortKey,sd=_fpqSortDir;const th=(label,key,align,w)=>{const act=sk===key;const arr=act?(sd===1?"▲":"▼"):"⇅";return`<th onclick="fpqSetSort('${key}')" class="px-3 py-2 text-${align} text-xs font-bold" style="border:1px solid #cbd5e1;${w?`width:${w};`:""}cursor:pointer;user-select:none;white-space:nowrap">${label} <span style="font-size:9px;opacity:${act?1:.45}">${arr}</span></th>`;};return`<th class="px-3 py-2 text-center text-xs font-bold" style="border:1px solid #cbd5e1;width:40px">N°</th>${th("SITE","site","left")}${th("NOM PRÉNOM","nom","left")}${th("CODE","code","center","60px")}${th("HEURE ARRIVÉE","arrivee","center","110px")}${th("HEURE DÉPART","depart","center","110px")}<th class="px-3 py-2 text-center text-xs font-bold" style="border:1px solid #cbd5e1;white-space:nowrap">POSITION GPS</th>${th("ÉTAT","etat","center","100px")}`;})()}</tr></thead>
    <tbody id="fpq-live-tbody">${rows||`<tr><td colspan="8" class="px-3 py-8 text-center text-slate-500">Aucun agent opérationnel pour cette date.</td></tr>`}</tbody>
  </table></div></div>`}`;
}

function fpqCodeCardsHidden(){return sessionStorage.getItem("fpqCodeCardsHidden")==="1"}

function fpqToggleCodeCards(){sessionStorage.setItem("fpqCodeCardsHidden",fpqCodeCardsHidden()?"":"1");renderView()}

function fpqOpenDailyCodeModal(code){
  const lists=window._fpqDailyCodeLists||{};
  const key=code||"__none__";
  const rows=lists[key]||[];
  const v=code?POINTAGE_CODES[code]:null;
  const label=code?(v?.label||code):"Non pointé";
  const color=v?.color||"#475569";
  const date=fpqCurrentDate();
  const body=rows.length?`<table class="w-full text-sm"><thead><tr class="text-xs text-slate-400 uppercase bg-slate-50"><th class="px-3 py-2 text-left">Employé</th><th class="px-3 py-2 text-left">Matricule</th><th class="px-3 py-2 text-left">Site</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="px-3 py-2 font-semibold">${escapeHTML(r.nom)}</td><td class="px-3 py-2 font-mono text-xs">${escapeHTML(r.mat)}</td><td class="px-3 py-2 text-xs text-slate-500">${escapeHTML(r.site)}</td></tr>`).join("")}</tbody></table>`:`<div class="text-center text-slate-400 py-8">Aucun employé dans cette catégorie.</div>`;
  openModal(`<div class="flex items-center gap-3 mb-4"><div class="text-2xl font-black" style="color:${color}">${rows.length}</div><div><div class="font-black text-sm">${escapeHTML(label)} — ${escapeHTML(formatDate(date))}</div></div></div><div class="overflow-auto" style="max-height:60vh">${body}</div><div class="flex justify-end mt-3"><button class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function renderPointage(view,sub,arg,_skipEnsure){
  if(!canAccess("pointage")){view.innerHTML=`<div class="card p-6">🔐 Accès refusé</div>`;return}
  if(sub!=="auto"&&typeof ptEmployeeQrStop==="function")ptEmployeeQrStop();
  if(sub!=="auto")ptAutoSaisieStopLiveRefresh();
  if(sub!=="planning")ptPlanningStopMonitor();
  // Détecte une arrivée fraîche sur cet onglet pointage (route différente de la dernière
  // vue rendue) : sert à déclencher un rechargement instantané, non throttlé, des données
  // superviseur au clic sur "Feuille quotidienne" au lieu d'attendre la boucle de fond.
  // Calculé AVANT toute réassignation de sub/arg ci-dessous, et propagé tel quel à l'appel
  // récursif après sgdiEnsureEmployeesForDisplay pour ne pas perdre le signal.
  const _ptFreshNav=sgdiLastRenderedPath!==`pointage/${sub||"dashboard"}${arg?"/"+arg:""}`;
  if(sub!=="qr")ptStopQrTabletTimer();
  if(sub!=="feuille")fpqStopLiveRefresh();
  if(!_skipEnsure){
    // Pas de force:true ici : des données locales déjà présentes court-circuitent le
    // rechargement (voir sgdiEnsureEmployeesForDisplay). Avec force:true, CHAQUE
    // réaffichage (y compris les auto-refresh en arrière-plan) remplaçait la vue par
    // "Chargement des effectifs…", effaçant l'affichage/saisie en cours de l'utilisateur.
    const _r=ptEnsureLightEmployees(ptCurrentSoc(),_ptFreshNav);
    if(_r&&typeof _r.then==="function"){
      view.innerHTML=`<div class="p-8 text-center text-slate-400 text-sm">Chargement des effectifs…</div>`;
      const pendingHash=location.hash,pendingGeneration=sgdiViewRenderGeneration;
      const resume=()=>{if(location.hash===pendingHash&&sgdiViewRenderGeneration===pendingGeneration&&document.getElementById("view")===view)renderPointage(view,sub,arg,true)};
      _r.then(resume).catch(resume);
      return;
    }
  }
  const isDrh=session?.transverse==="drh";
  const isOps=session?.transverse==="ops";
  // Un compte OPS peut légitimement être limité à certains sites sans être un
  // superviseur terrain. La restriction de sites ne doit donc masquer l'onglet
  // "Saisie automatique" que hors des modules DRH et OPS.
  const hideAuto=!isDrh&&!isOps&&isSupOrUser();
  if(isDrh&&(sub==="saisie"||sub==="dashboard"))sub="auto";
  if(hideAuto&&sub==="auto")sub="saisie";
  if(sub==="scan")sub="feuille";
  const supervisorActive=supervisorModuleActive();
  if(supervisorActive&&sub==="auto")sub="feuille";
  const allowedTabs=(isDrh?POINTAGE_TABS.filter(([k])=>k!=="saisie"&&k!=="qr"):POINTAGE_TABS).filter(([k])=>!(hideAuto&&k==="auto")).filter(([k])=>!(supervisorActive&&(k==="qr"||k==="auto")));
  const tabsHTML=allowedTabs.map(([k,l])=>{
    const label=supervisorActive&&k==="feuille"?"Pointage mensuel":(supervisorActive&&k==="saisie"?"Feuille quotidienne":l);
    return`<button onclick="navigate('pointage/${k}')" class="px-3 py-2 text-sm font-semibold border-b-2 ${sub===k?"border-cyan-600 text-cyan-700":"border-transparent text-slate-500 hover:text-slate-800"}">${label}</button>`;
  }).join("");
  const head=sub==="dashboard"?"":`<div class="flex items-center justify-between mb-4 flex-wrap gap-3"><h1 class="text-2xl font-bold">🕒 Pointage du personnel</h1></div><div class="flex gap-1 mb-5 border-b border-slate-200 overflow-x-auto">${tabsHTML}</div>`;
  let body="";
  if(sub==="dashboard")body=renderPointageDashboard(isDrh);
  else if(sub==="feuille"){body=supervisorActive?renderPointageSaisieAuto():renderFeuillePresentQR();}
  else if(sub==="qr"&&!isDrh&&!supervisorModuleActive()){body=renderPointageQRGen();setTimeout(ptStartQrTabletTimer,100);}
  else if(sub==="saisie"&&!isDrh)body=supervisorActive?renderPointageSaisieSuperviseur(_ptFreshNav):renderPointageSaisie();
  else if(sub==="auto")body=renderPointageSaisieAuto();
  else if(sub==="planning"){body=renderPointagePlanning7J();setTimeout(ptPlanningStartMonitor,100);}
  else if(sub==="recap")body=renderPointageRecap(arg);
  else if(sub==="societe")body=renderPointageSociete();
  else if(sub==="stats")body=renderPointageStats();
  else if(sub==="legende")body=renderPointageLegende();
  else if(sub==="archives")body=renderPointageArchives();
  else body=isDrh?renderPointageSaisieAuto():renderPointageSaisie();
  if(["auto","saisie"].includes(sub))body=ptEmployeeQrScanCard()+body;
  view.innerHTML=head+body;
  if(sub==="auto")setTimeout(ptAutoSaisieStartLiveRefresh,100);
}

function ptPlanningStopMonitor(){if(_ptPlanningMonitor){clearInterval(_ptPlanningMonitor);_ptPlanningMonitor=null}}

function ptPlanningStartMonitor(){
  ptPlanningStopMonitor();
  if(!String(location.hash||"").includes("pointage/planning"))return;
  _ptPlanningMonitor=setInterval(async()=>{
    if(_ptPlanningRefreshing)return;
    _ptPlanningRefreshing=true;
    try{
      const res=await sgdiApi("/api/irongs/collections/feuillePresence",{method:"GET",legacy:false});
      const data=Array.isArray(res)?res:(res?.data||[]);
      if(Array.isArray(data))db.feuillePresence=data;
      const route=String(location.hash||"");
      if(route.includes("pointage/planning"))renderView();
    }catch(e){}finally{_ptPlanningRefreshing=false}
  },30000);
}

function ptPlanningDateShift(dateStr,days){
  const d=new Date(`${dateStr}T12:00:00`);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);
}

function ptPlanningMinutes(value){
  const match=String(value||"").match(/(\d{1,2}):(\d{2})/);
  return match?(+match[1]*60)+(+match[2]):null;
}

function ptPlanningTime(value){
  const match=String(value||"").match(/(\d{1,2}):(\d{2})/);
  return match?`${String(+match[1]).padStart(2,"0")}:${match[2]}`:"";
}

function ptPlanningActiveSociete(){
  return normalizeSocieteName(
    (typeof currentStructureSocieteFilter==="function"?currentStructureSocieteFilter():"")||
    (typeof drhActiveSocieteFilter==="function"?drhActiveSocieteFilter():"")||
    session?.societe||""
  );
}

function ptPlanningAgentInActiveSociete(agent){
  const societe=ptPlanningActiveSociete();
  return !!agent&&(!societe||normalizeSocieteName(agent.societe||agent.society||"")===societe);
}

function ptPlanningAgentForPresence(f){
  return (db.agents||[]).find(a=>ptPlanningAgentInActiveSociete(a)&&(
    String(a.id||"")===String(f.agentId||"")||
    String(a.backendId||"")===String(f.agentBackendId||f.employee_id||"")||
    (a.matricule&&String(a.matricule)===String(f.matricule||""))
  ));
}

SGDIModules.registerModule({key: "pointage", routes: ["pointage"], dependencies: ["pointage-1"], init: pointageModuleInit, destroy: pointageModuleDestroy});

// Ressources de route : réutiliser la fermeture du scanner avant une réouverture.
let pointageRelieveTimer=null;
let pointageCleanupPromise=Promise.resolve();
function pointageModuleInit(){
  return pointageCleanupPromise.then(()=>{
    if(pointageRelieveTimer===null)pointageRelieveTimer=setInterval(fpqAutoRefreshRelieveAlert,30000);
  });
}
function pointageModuleDestroy(){
  clearInterval(pointageRelieveTimer);pointageRelieveTimer=null;
  ptStopQrTabletTimer();fpqStopLiveRefresh();ptPlanningStopMonitor();ptAutoSaisieStopLiveRefresh();
  pointageCleanupPromise=ptEmployeeQrStop().catch(err=>console.warn("Arrêt scanner Pointage",err));
}
