/* Phase 2 — pointage-1. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function ptPlanningCycles(){
  const cycles=[];
  (db.feuillePresence||[]).forEach(f=>{
    const agent=ptPlanningAgentForPresence(f);if(!agent)return;
    const raw=Array.isArray(f.scanCycles)?f.scanCycles:[];
    if(raw.length){
      const grouped={};
      raw.forEach((event,index)=>{
        const key=String(event.cycle||Math.floor(index/2)+1);
        if(!grouped[key])grouped[key]={};
        if(event.action==="arrivee")grouped[key].arrival=ptPlanningTime(event.heure||event.scannedAt?.slice(11,16));
        if(event.action==="depart")grouped[key].depart=ptPlanningTime(event.heure||event.scannedAt?.slice(11,16));
        grouped[key].date=String(event.scannedAt||f.date||"").slice(0,10)||f.date;
      });
      Object.entries(grouped).forEach(([cycle,row])=>cycles.push({
        agent,agentId:agent.id,date:row.date||f.date,cycle:+cycle||1,arrival:row.arrival||"",depart:row.depart||"",
        siteId:f.siteBackendId||f.siteId||"",siteName:f.siteName||agent.affectationCourante?.siteName||"—",
        group:f.groupe||f.rotationGroupe||agent.affectationCourante?.groupe||"",source:f
      }));
      return;
    }
    const arrival=ptPlanningTime(f.scanArrivee||f.lastScanArrivee||(f.heureArrivee!=="P"?f.heureArrivee:""));
    const depart=ptPlanningTime(f.scanDepart||f.heureDepart);
    if(arrival||depart)cycles.push({
      agent,agentId:agent.id,date:f.date,cycle:1,arrival,depart,
      siteId:f.siteBackendId||f.siteId||"",siteName:f.siteName||agent.affectationCourante?.siteName||"—",
      group:f.groupe||f.rotationGroupe||agent.affectationCourante?.groupe||"",source:f
    });
  });
  return cycles.sort((a,b)=>(a.date+a.arrival).localeCompare(b.date+b.arrival));
}

function ptPlanningSelectedDate(){return sessionStorage.getItem("ptPlanningDate")||today()}

function ptPlanningSetDate(value){sessionStorage.setItem("ptPlanningDate",value||today());renderView()}

function ptPlanningSiteFilter(){return sessionStorage.getItem("ptPlanningSite")||""}

function ptPlanningSetSite(value){sessionStorage.setItem("ptPlanningSite",value||"");renderView()}

function ptPlanningStatusFilter(){return sessionStorage.getItem("ptPlanningStatus")||""}

function ptPlanningSetStatus(value){sessionStorage.setItem("ptPlanningStatus",value||"");renderView()}

function ptPlanningBuild(date){
  const cycles=ptPlanningCycles();
  const sourceDate=ptPlanningDateShift(date,-7);
  const learned=cycles.filter(c=>c.date===sourceDate);
  const actual=cycles.filter(c=>c.date===date);
  const tolerance=30;
  const now=new Date();
  const usedActual=new Set();
  const rows=learned.map((expected,learnedIndex)=>{
    const same=actual.filter(a=>String(a.agentId)===String(expected.agentId));
    const occurrence=learned.slice(0,learnedIndex+1).filter(e=>String(e.agentId)===String(expected.agentId)).length-1;
    const real=same[occurrence]||null;
    if(real)usedActual.add(real);
    const expectedArrival=expected.arrival;
    const expectedDepart=expected.depart;
    let status="attendu",observation="",severity="normal";
    const expStart=new Date(`${date}T${expectedArrival||"23:59"}:00`);
    if(real?.arrival){
      status="present";
      const delta=Math.abs((ptPlanningMinutes(real.arrival)??0)-(ptPlanningMinutes(expectedArrival)??0));
      if(expectedArrival&&delta>tolerance){status="horaire_modifie";severity="warning";observation=`Horaire différent : prévu ${expectedArrival}, constaté ${real.arrival}.`;}
      if(String(real.siteId||real.siteName)!==String(expected.siteId||expected.siteName)){status="site_modifie";severity="warning";observation+=`${observation?" ":""}Site différent : prévu ${expected.siteName}, constaté ${real.siteName}.`;}
      if(expected.group&&real.group&&String(expected.group)!==String(real.group)){status="rotation_modifiee";severity="warning";observation+=`${observation?" ":""}Changement de rotation ${expected.group} → ${real.group}.`;}
      if(expectedDepart&&!real.depart&&now>new Date(`${date}T${expectedDepart}:00`)){status="depart_manquant";severity="danger";observation+=`${observation?" ":""}Départ non pointé.`;}
    }else if(now>new Date(expStart.getTime()+tolerance*60000)){
      status="absent";severity="danger";observation="Aucune arrivée enregistrée après l’heure prévue.";
    }
    return {expected,real,status,observation,severity};
  });
  actual.filter(real=>!usedActual.has(real)).forEach(real=>{
    rows.push({expected:null,real,status:"imprevu",severity:"info",observation:"Présence non prévue par le planning appris."});
  });
  rows.forEach(row=>{
    if(!row.expected||!row.real?.arrival)return;
    const exp=row.expected,real=row.real;
    const other=rows.find(candidate=>{
      if(candidate===row||!candidate.expected||!candidate.real?.arrival)return false;
      const otherExp=candidate.expected,otherReal=candidate.real;
      const expectedTimesDiffer=Math.abs((ptPlanningMinutes(exp.arrival)??-9999)-(ptPlanningMinutes(otherExp.arrival)??9999))>tolerance;
      const timeSwap=expectedTimesDiffer&&Math.abs((ptPlanningMinutes(real.arrival)??-9999)-(ptPlanningMinutes(otherExp.arrival)??9999))<=tolerance&&
        Math.abs((ptPlanningMinutes(otherReal.arrival)??-9999)-(ptPlanningMinutes(exp.arrival)??9999))<=tolerance;
      const expectedSitesDiffer=String(exp.siteId||exp.siteName)!==String(otherExp.siteId||otherExp.siteName);
      const siteSwap=expectedSitesDiffer&&String(real.siteId||real.siteName)===String(otherExp.siteId||otherExp.siteName)&&
        String(otherReal.siteId||otherReal.siteName)===String(exp.siteId||exp.siteName);
      return timeSwap||siteSwap;
    });
    if(other){
      const timeSwap=Math.abs((ptPlanningMinutes(exp.arrival)??-9999)-(ptPlanningMinutes(other.expected.arrival)??9999))>tolerance&&
        Math.abs((ptPlanningMinutes(real.arrival)??-9999)-(ptPlanningMinutes(other.expected.arrival)??9999))<=tolerance;
      const siteSwap=String(exp.siteId||exp.siteName)!==String(other.expected.siteId||other.expected.siteName)&&
        String(real.siteId||real.siteName)===String(other.expected.siteId||other.expected.siteName);
      const kinds=[timeSwap?"horaire":"",siteSwap?"site/rotation":""].filter(Boolean).join(" et ");
      row.status="permutation";row.severity="danger";
      row.observation=`⚠ Permutation de ${kinds} détectée avec ${(other.expected.agent.nom||"")+" "+(other.expected.agent.prenom||"")}.`;
    }
  });
  return {cycles,sourceDate,learned,actual,rows};
}

function ptPlanningStatusLabel(status){
  return({attendu:"Attendu",present:"Présent",absent:"Absent",horaire_modifie:"Horaire modifié",site_modifie:"Site modifié",rotation_modifiee:"Rotation modifiée",depart_manquant:"Départ manquant",imprevu:"Présence imprévue",permutation:"Permutation détectée"}[status]||status);
}

function renderPointagePlanning7J(){
  const date=ptPlanningSelectedDate();
  const model=ptPlanningBuild(date);
  const allDates=[...new Set(model.cycles.map(c=>c.date))].sort();
  const firstDate=allDates[0]||date;
  const elapsed=Math.max(0,Math.floor((new Date(`${today()}T12:00:00`)-new Date(`${firstDate}T12:00:00`))/86400000)+1);
  const learningDays=Math.min(7,elapsed);
  const ready=elapsed>=8;
  const sites=[...new Set(model.rows.map(r=>(r.real||r.expected)?.siteName).filter(Boolean))].sort();
  const storedSiteFilter=ptPlanningSiteFilter(),storedStatusFilter=ptPlanningStatusFilter();
  const validStatuses=["present","absent","permutation","horaire_modifie","site_modifie","rotation_modifiee","depart_manquant","imprevu","attendu"];
  const siteFilter=sites.includes(storedSiteFilter)?storedSiteFilter:"";
  const statusFilter=validStatuses.includes(storedStatusFilter)?storedStatusFilter:"";
  if(storedSiteFilter&&!siteFilter)sessionStorage.removeItem("ptPlanningSite");
  if(storedStatusFilter&&!statusFilter)sessionStorage.removeItem("ptPlanningStatus");
  const visible=model.rows.filter(r=>{
    const row=r.real||r.expected;
    return (!siteFilter||row?.siteName===siteFilter)&&(!statusFilter||r.status===statusFilter);
  });
  const alerts=model.rows.filter(r=>["danger","warning"].includes(r.severity));
  const counts={
    present:model.rows.filter(r=>r.real?.arrival).length,
    absent:model.rows.filter(r=>r.status==="absent").length,
    permutations:model.rows.filter(r=>r.status==="permutation").length,
    anomalies:alerts.length
  };
  const badge=r=>{
    const colors={danger:["#fee2e2","#991b1b"],warning:["#fef3c7","#92400e"],info:["#dbeafe","#1e40af"],normal:["#dcfce7","#166534"]}[r.severity]||["#f1f5f9","#475569"];
    return`<span class="pill" style="background:${colors[0]};color:${colors[1]}">${escapeHTML(ptPlanningStatusLabel(r.status))}</span>`;
  };
  const rowsHTML=visible.map(r=>{
    const row=r.real||r.expected,a=row.agent;
    return`<tr>
      <td class="p-3"><div class="font-bold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</div></td>
      <td class="p-3 font-mono text-xs">${escapeHTML(a.matricule||"—")}</td>
      <td class="p-3 text-xs">${escapeHTML(row.siteName||"—")}</td>
      <td class="p-3 text-xs">${escapeHTML(date)}</td>
      <td class="p-3 text-center font-mono font-bold">${escapeHTML(r.real?.arrival||"—")}</td>
      <td class="p-3 text-center font-mono font-bold">${escapeHTML(r.real?.depart||"—")}</td>
      <td class="p-3 text-center">${badge(r)}</td>
      <td class="p-3 text-xs" style="max-width:340px">${escapeHTML(r.observation||"Conforme au planning appris.")}</td>
    </tr>`;
  }).join("");
  return`<div class="card p-5 mb-4" style="background:linear-gradient(135deg,#043970,#0d6ecc);color:#fff">
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div><div class="text-xs font-black uppercase tracking-widest" style="opacity:.75">Moteur de présence</div><h2 class="text-2xl font-black">Planning intelligent — apprentissage 7 jours</h2><p class="text-sm mt-1" style="opacity:.8">Référence du ${formatDate(model.sourceDate)} · Actualisation automatique toutes les 30 secondes</p></div>
      <div class="px-4 py-2 rounded-xl text-center" style="background:rgba(255,255,255,.14)"><div class="text-2xl font-black">${learningDays}/7</div><div class="text-[10px] uppercase font-bold">${ready?"Planning opérationnel":"Apprentissage"}</div></div>
    </div>
    <div class="mt-4 rounded-full overflow-hidden" style="height:7px;background:rgba(255,255,255,.2)"><div style="height:100%;width:${learningDays/7*100}%;background:#4ade80"></div></div>
  </div>
  ${!ready?`<div class="card p-4 mb-4" style="background:#fef3c7;border-color:#fcd34d"><b>Phase d’apprentissage :</b> le planning automatique sera pleinement opérationnel après sept journées complètes. Les scans sont déjà mémorisés.</div>`:""}
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
    <div class="card p-4 text-center" style="background:#dcfce7"><div class="text-xs font-bold text-green-700">Présents</div><div class="text-2xl font-black text-green-700">${counts.present}</div></div>
    <div class="card p-4 text-center" style="background:#fee2e2"><div class="text-xs font-bold text-red-700">Absents</div><div class="text-2xl font-black text-red-700">${counts.absent}</div></div>
    <div class="card p-4 text-center" style="background:#fef3c7"><div class="text-xs font-bold text-amber-700">Anomalies</div><div class="text-2xl font-black text-amber-700">${counts.anomalies}</div></div>
    <div class="card p-4 text-center" style="background:#ede9fe"><div class="text-xs font-bold text-violet-700">Permutations</div><div class="text-2xl font-black text-violet-700">${counts.permutations}</div></div>
  </div>
  ${alerts.length?`<div class="card p-4 mb-4" style="border:2px solid #ef4444;background:#fff7f7"><div class="font-black text-red-700 mb-2">⚠ ALERTES DE PRÉSENCE (${alerts.length})</div>${alerts.slice(0,8).map(r=>`<div class="py-2 border-b border-red-100 text-sm"><b>${escapeHTML(((r.real||r.expected).agent.nom||"")+" "+((r.real||r.expected).agent.prenom||""))}</b> — ${escapeHTML(r.observation)}</div>`).join("")}</div>`:""}
  <div class="card p-4 mb-4"><div class="flex flex-wrap gap-3 items-end">
    <div><label class="label">Date analysée</label><input class="input" type="date" value="${date}" onchange="ptPlanningSetDate(this.value)"></div>
    <div><label class="label">Site</label><select class="select" onchange="ptPlanningSetSite(this.value)"><option value="">Tous les sites</option>${sites.map(s=>`<option ${s===siteFilter?"selected":""}>${escapeHTML(s)}</option>`).join("")}</select></div>
    <div><label class="label">Statut</label><select class="select" onchange="ptPlanningSetStatus(this.value)"><option value="">Tous les statuts</option>${validStatuses.map(s=>`<option value="${s}" ${s===statusFilter?"selected":""}>${escapeHTML(ptPlanningStatusLabel(s))}</option>`).join("")}</select></div>
    <button class="btn btn-secondary" onclick="ptPlanningRefreshNow()">↺ Actualiser</button>
  </div></div>
  <div class="card p-0 overflow-hidden"><div style="overflow:auto"><table class="w-full text-sm"><thead><tr style="background:#043970;color:#fff"><th class="p-3 text-left">NOM PRÉNOM</th><th class="p-3 text-left">CODE</th><th class="p-3 text-left">SITE</th><th class="p-3 text-left">DATE</th><th class="p-3 text-center">H ARRIVÉE</th><th class="p-3 text-center">H DÉPART</th><th class="p-3 text-center">ÉTAT</th><th class="p-3 text-left">OBSERVATION / ALERTE</th></tr></thead><tbody>${rowsHTML||`<tr><td colspan="8" class="p-8 text-center text-slate-500">Aucun planning appris pour cette date. Le système utilise la journée correspondante sept jours auparavant.</td></tr>`}</tbody></table></div></div>`;
}

async function ptPlanningRefreshNow(){
  if(_ptPlanningRefreshing)return;_ptPlanningRefreshing=true;
  try{
    const res=await sgdiApi("/api/irongs/collections/feuillePresence",{method:"GET",legacy:false});
    const data=Array.isArray(res)?res:(res?.data||[]);if(Array.isArray(data))db.feuillePresence=data;
    toast("Planning et alertes actualisés","success");renderView();
  }catch(e){toast("Actualisation indisponible","error")}finally{_ptPlanningRefreshing=false}
}

function renderPointageSaisie(){
  const isDrh=session?.transverse==="drh";
  const ym=ptCurrentMonth();const soc=ptCurrentSoc();const days=ptDaysInMonth(ym);
  ptSyncFeuillePresenceMonth(ym);
  const ag=pointageEligibleAgents(soc);
  ag.sort((x,y)=>(x.nom||"").localeCompare(y.nom||"")||(x.prenom||"").localeCompare(y.prenom||""));
  const [yr,mo]=ym.split("-").map(Number);
  const monthLabel=new Date(yr,mo-1,1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
  const weekdayShort=["D","L","M","Me","J","V","S"];
  const now=new Date();
  const todayYm=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
  const isCurrentMonth=todayYm===ym;
  const todayDay=isCurrentMonth?now.getDate():0;
  const horizonDay=ym<todayYm?days:(isCurrentMonth?todayDay:0);
  // Statistiques calculées une fois pour tout l'effectif éligible : servent aux KPI,
  // aux puces de filtre rapide et aux lignes du tableau (même logique que Saisie automatique).
  const statsById=new Map();
  ag.forEach(a=>{
    const sheet=ptGetSheet(a.id,ym);
    let renseignes=0,workDays=0;
    for(let d=1;d<=days;d++){
      const we=[5,6].includes(new Date(yr,mo-1,d).getDay());
      if(d<=horizonDay&&!we){workDays++;if((sheet?.days||{})[String(d).padStart(2,"0")])renseignes++;}
    }
    statsById.set(a.id,{sheet,valide:!!(sheet&&sheet.valide),taux:workDays?Math.round(renseignes*100/workDays):100,absPaie:ptAbsencePayrollDays(sheet)});
  });
  const effectif=ag.length;
  const validated=ag.filter(a=>statsById.get(a.id)?.valide).length;
  const tauxMois=effectif?Math.round(ag.reduce((s,a)=>s+(statsById.get(a.id)?.taux||0),0)/effectif):0;
  const absencesPaie=ag.reduce((s,a)=>s+(statsById.get(a.id)?.absPaie||0),0);
  const alertes=ag.filter(a=>(statsById.get(a.id)?.taux??100)<100).length;
  const activeKpi=ptCurrentManuelChip();
  const kpiCard=(lbl,val,sub,color,filter,alertCls,barPct)=>`<button type="button" class="pt-auto-kpi pt-auto-kpi-clickable ${activeKpi===filter?"is-active":""} ${alertCls||""}" style="--pt-kpi-c:${color}" onclick="setPtManuelChip('${filter}')" aria-pressed="${activeKpi===filter}" aria-label="${escapeHTML(lbl)} — filtrer le tableau"><div class="lbl">${escapeHTML(lbl)}</div><div class="val">${val}</div><div class="sub">${escapeHTML(sub)}</div>${barPct!==undefined?`<div class="pt-kpi-bar"><i style="width:${barPct}%;background:${color}"></i></div>`:""}<span class="pt-kpi-open">${activeKpi===filter&&filter!=="all"?"Afficher tout":"Voir le détail"} →</span></button>`;
  const kpisHTML=`<div class="pt-auto-kpis">
    ${kpiCard("Effectif",effectif,soc?soc:"Toutes sociétés autorisées","#043970","all")}
    ${kpiCard("Pointages validés",`${validated}/${effectif}`,`${effectif?Math.round(validated*100/effectif):0}% verrouillés`,"#16a34a","validated",validated===0?"alert":"",effectif?Math.round(validated*100/effectif):0)}
    ${kpiCard("Complétude — mois",`${tauxMois}%`,"Jours ouvrés renseignés","#0d6ecc","gaps","",tauxMois)}
    ${kpiCard("Absences paie",absencesPaie,"Cumul du mois affiché","#d97706","absences")}
    ${kpiCard("Cases à compléter",alertes,"Agents avec des trous de saisie","#dc2626","incomplete",alertes>0?"alert":"")}
  </div>`;
  const chip=ptCurrentManuelChip();
  const chipDefs=[["all","Tous",()=>true],["validated","✓ Validés",a=>!!statsById.get(a.id)?.valide],["unlocked","🔓 Non validés",a=>!statsById.get(a.id)?.valide],["absences","Absences paie",a=>(statsById.get(a.id)?.absPaie||0)>0],["incomplete","Cases à compléter",a=>(statsById.get(a.id)?.taux??100)<100],["gaps","Renseignement < 90%",a=>(statsById.get(a.id)?.taux??100)<90]];
  const chipsHTML=chipDefs.map(([k,l,fn])=>{const n=ag.filter(fn).length;return`<button type="button" class="pt-auto-chip ${k==="unlocked"?"warn":""} ${chip===k?"active":""}" onclick="setPtManuelChip('${k}')">${l} <span class="n">${n}</span></button>`}).join("");
  const legendBaseKeys=["P","A","M","S","C","R","AB"];
  const legendExtraGroups=[["Récup. travaillée · présent",["F1","F2","F3"]],["Maintenu en poste · présent",["P/F1","P/F2","P/F3"]],["Absent partiel",["A1","A2","A3"]]];
  const legendItem=k=>`<span class="pt-auto-legend-item"><span class="pt-auto-legend-dot" style="background:${POINTAGE_CODES[k].color}"></span>${k} — ${escapeHTML(POINTAGE_CODES[k].label)}</span>`;
  const legendBaseHTML=legendBaseKeys.map(legendItem).join("");
  const legendExtraHTML=legendExtraGroups.map(([,keys])=>keys.map(legendItem).join("")).join("");
  const legendHTML=`<div class="pt-auto-legend">
    <span class="lbl">Légende</span>${legendBaseHTML}
    <button type="button" class="pt-manuel-legend-toggle" onclick="const ex=this.nextElementSibling;const sh=ex.classList.toggle('show');this.textContent=sh?'− Masquer les codes avancés':'+ Codes avancés (récupération, maintien, absences graduées)'">+ Codes avancés (récupération, maintien, absences graduées)</button>
    <div class="pt-manuel-legend-extra">${legendExtraHTML}</div>
    ${isDrh?"":`<div class="pt-manuel-hint">Astuce : <b>cliquer sur une case</b> ouvre le sélecteur de code · <b>Valider</b> verrouille le pointage de l'agent.</div>`}
  </div>`;
  const filterBar=`<div class="pt-auto-toolbar">
    ${supervisorModuleActive()?"":`<div class="pt-auto-monthnav"><button type="button" onclick="setPtMonth(ptShiftMonth('${ym}',-1))" title="Mois précédent">‹</button><span class="lbl capitalize">${escapeHTML(monthLabel)}</span><button type="button" onclick="setPtMonth(ptShiftMonth('${ym}',1))" title="Mois suivant">›</button></div>`}
    ${ptSearchBarHTML()}
    ${ptSortControlsHTML()}
    <div class="pt-auto-chips">${chipsHTML}</div>
    <div class="flex-1"></div>
    ${isDrh?"":`<button class="btn btn-primary text-xs" onclick="ptValiderTous('${ym}','${soc.replace(/'/g,"\\'")}')">✅ Valider tous les pointages</button>
    <button class="btn btn-ghost text-xs" onclick="ptDevaliderTous('${ym}','${soc.replace(/'/g,"\\'")}')">🔓 Tout déverrouiller</button>`}
    <button class="btn btn-ghost text-xs" onclick="window.print()">🖨 Imprimer</button>
  </div>`;
  const chipFn=(chipDefs.find(c=>c[0]===chip)||chipDefs[0])[2];
  const filtered=ptSortAgents(ptFilterAgents(ag)).filter(chipFn);
  if(!filtered.length){
    const emptyMsg=ptCurrentSearch()?`Aucun résultat pour « ${escapeHTML(ptCurrentSearch())} »`:chip!=="all"?"Aucun agent ne correspond à ce filtre rapide.":`Aucun employé ${soc?`pour ${escapeHTML(soc)}`:""} sur cette période.`;
    return kpisHTML+filterBar+legendHTML+`<div class="pt-auto-card"><div class="p-6 text-center text-slate-500">${emptyMsg}</div></div>`;
  }
  const sumCols=["P","A","M","S","C","R"];
  const dayCls=d=>{const we=[5,6].includes(new Date(yr,mo-1,d).getDay());const td=isCurrentMonth&&d===todayDay;const cls=["pt-day"];if(we)cls.push("weekend");if(td)cls.push("today");return cls.join(" ")};
  const dayHeadersNum=Array.from({length:days},(_,i)=>`<th class="${dayCls(i+1)} pt-day-num">${String(i+1).padStart(2,"0")}</th>`).join("");
  const dayHeadersDow=Array.from({length:days},(_,i)=>`<th class="${dayCls(i+1)} pt-day-dow">${weekdayShort[new Date(yr,mo-1,i+1).getDay()]}</th>`).join("");
  const headHTML=`<thead>
    <tr><th class="pt-col-idx" rowspan="2">N°</th><th class="pt-col-agent" rowspan="2">Agent</th><th class="pt-col-code" rowspan="2">Code</th>${dayHeadersNum}${sumCols.map(k=>`<th class="pt-col-sum" rowspan="2" style="color:${POINTAGE_CODES[k].color};background:${POINTAGE_CODES[k].bg}">${k}</th>`).join("")}<th class="pt-col-sum" rowspan="2" style="color:#b45309;background:#fef9c3" title="F1+F2+F3+P/F1+P/F2+P/F3">Fx</th><th class="pt-col-sum" rowspan="2" style="color:#7f1d1d;background:#fecaca" title="AB+A2+A3 déjà inclus dans A paie">Ax</th><th class="pt-col-rate" rowspan="2">Renseigné</th>${isDrh?"":`<th class="pt-col-action" rowspan="2">Statut</th>`}</tr>
    <tr>${dayHeadersDow}</tr>
  </thead>`;
  const rows=filtered.map((a,idx)=>{
    const st=statsById.get(a.id)||{};
    const sheet=st.sheet;const locked=!!st.valide;
    let cells="";
    for(let d=1;d<=days;d++){
      const we=[5,6].includes(new Date(yr,mo-1,d).getDay());const td=isCurrentMonth&&d===todayDay;
      const code=(sheet?.days||{})[String(d).padStart(2,"0")]||"";
      cells+=ptCellHTML(a.id,ym,d,code,we,td,locked);
    }
    const nFx=["F1","F2","F3","P/F1","P/F2","P/F3"].reduce((s,k)=>s+ptCount(sheet,k),0);
    const nAx=["AB","A2","A3"].reduce((s,k)=>s+ptCount(sheet,k),0);
    const sumCells=sumCols.map(k=>{const n=k==="A"?ptAbsencePayrollDays(sheet):ptCount(sheet,k);return`<td class="pt-col-sum" style="color:${POINTAGE_CODES[k].color}">${n||"·"}</td>`}).join("");
    const rateColor=st.taux>=90?"#16a34a":st.taux>=70?"#d97706":"#dc2626";
    const valideTitle=locked?`Validé par ${escapeHTML(sheet.valideBy||"?")} le ${sheet.valideAt?new Date(sheet.valideAt).toLocaleString("fr-FR"):""}`:"";
    return`<tr class="${locked?"locked":""}">
      <td class="pt-col-idx">${idx+1}</td>
      <td class="pt-col-agent"><span class="pt-agent-name">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</span></td>
      <td class="pt-col-code"><span class="pt-agent-mat">${escapeHTML(a.matricule||"—")}</span></td>
      ${cells}
      ${sumCells}
      <td class="pt-col-sum" style="color:#b45309">${nFx||"·"}</td>
      <td class="pt-col-sum" style="color:#7f1d1d">${nAx||"·"}</td>
      <td class="pt-col-rate"><div class="pt-rate-track"><div class="pt-rate-fill" style="width:${st.taux}%;background:${rateColor}"></div></div><div class="pt-rate-txt">${st.taux}%</div></td>
      ${isDrh?"":`<td class="pt-col-action">${locked?`<button type="button" class="pt-lock-btn locked" title="${escapeHTML(valideTitle)}" onclick="ptDevaliderSheet('${a.id}','${ym}')">🔒 Verrouillé</button>`:`<button type="button" class="pt-lock-btn" onclick="ptValiderSheet('${a.id}','${ym}')">🔓 Valider</button>`}</td>`}
    </tr>`;
  }).join("");
  const searchNote=ptCurrentSearch()?` · <span style="color:#043970;font-weight:700">${filtered.length} résultat${filtered.length>1?"s":""} sur ${ag.length}</span>`:"";
  const tableHTML=`<table class="pt-auto pt-manuel"${isDrh?' style="pointer-events:none"':""}>${headHTML}<tbody>${rows}</tbody></table>`;
  return kpisHTML+filterBar+legendHTML+`<div class="pt-auto-card">
    <div class="pt-auto-card-head"><h2>Saisie manuelle — <span class="capitalize">${escapeHTML(monthLabel)}</span></h2><span class="meta">${days} jours · ${filtered.length} agent${filtered.length>1?"s":""}${searchNote}</span></div>
    <div class="pt-auto-scroll">${tableHTML}</div>
  </div>`;
}

function ptEmployeeQrScanCard(){
  return`<div class="card p-4 mb-4" style="border:1px solid #bfdbfe;background:linear-gradient(135deg,#eff6ff,#fff)">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div><div class="text-xs font-black uppercase tracking-widest" style="color:#0d6ecc">Pointage terrain</div><h3 class="font-black text-lg">Scanner le QR d’un employé</h3><p class="text-xs text-slate-500">Le scan alimente immédiatement la saisie automatique DRH et OPS.</p></div>
      <button class="btn btn-primary" id="pt-employee-qr-open" onclick="ptEmployeeQrStart()">📷 Ouvrir le scanner</button>
    </div>
    <div id="pt-employee-qr-reader" style="display:none;max-width:420px;margin:16px auto 0;border-radius:14px;overflow:hidden"></div>
    <div id="pt-employee-qr-result" class="text-sm text-center mt-3"></div>
  </div>`;
}

// Une session garde son instance jusqu'au règlement du démarrage et au nettoyage.
let ptEmployeeQrGeneration=0,ptEmployeeQrSession=null;
let ptEmployeeQrCleanup=Promise.resolve();
const ptEmployeeQrTimeouts=new Set();
function ptEmployeeQrSessionCurrent(ticket){
  return ptEmployeeQrSession===ticket&&ticket.generation===ptEmployeeQrGeneration&&
    ticket.hash===location.hash&&ticket.viewGeneration===sgdiViewRenderGeneration&&
    document.getElementById("pt-employee-qr-reader")===ticket.reader&&
    window.SGDIModules?.activeModuleKey==="pointage"&&SGDIModules.isModuleInitialized("pointage");
}
function ptEmployeeQrDispose(ticket){
  if(!ticket.cleanup)ticket.cleanup=(async()=>{
    if(ticket.scanner){
      try{await ticket.scanner.stop()}catch(e){}
      try{await ticket.scanner.clear()}catch(e){}
    }
  })();
  return ticket.cleanup;
}
function ptEmployeeQrTimeout(fn,delay){
  const id=setTimeout(()=>{ptEmployeeQrTimeouts.delete(id);fn()},delay);
  ptEmployeeQrTimeouts.add(id);
}
function ptEmployeeQrStart(){
  const reader=document.getElementById("pt-employee-qr-reader");
  const button=document.getElementById("pt-employee-qr-open");
  const result=document.getElementById("pt-employee-qr-result");
  if(!reader)return Promise.resolve();
  const previousCleanup=ptEmployeeQrStop();
  const ticket={generation:++ptEmployeeQrGeneration,hash:location.hash,viewGeneration:sgdiViewRenderGeneration,reader,scanner:null,cleanup:null,started:false};
  ptEmployeeQrSession=ticket;
  if(result)result.textContent="";
  ticket.task=(async()=>{
    try{
      // Ne pas laisser deux instances manipuler le même lecteur/caméra.
      await previousCleanup;
      if(!ptEmployeeQrSessionCurrent(ticket))return;
      if(window.sgdiLoadHtml5QR)await window.sgdiLoadHtml5QR();
      if(!ptEmployeeQrSessionCurrent(ticket))return;
      if(!window.Html5Qrcode)throw new Error("Scanner QR indisponible");
      reader.style.display="block";
      if(button){button.textContent="✕ Fermer le scanner";button.onclick=ptEmployeeQrStop;}
      ticket.scanner=new Html5Qrcode("pt-employee-qr-reader");
      await ticket.scanner.start(
        {facingMode:"environment"},
        {fps:12,qrbox:{width:250,height:250},aspectRatio:1},
        decoded=>{if(ticket.started&&ptEmployeeQrSessionCurrent(ticket))ptEmployeeQrSubmit(decoded)},
        ()=>{}
      );
      if(!ptEmployeeQrSessionCurrent(ticket)){await ptEmployeeQrDispose(ticket);return;}
      ticket.started=true;
      _ptEmployeeQrScanner=ticket.scanner;
    }catch(e){
      await ptEmployeeQrDispose(ticket);
      if(!ptEmployeeQrSessionCurrent(ticket))return;
      if(result){result.textContent=e.message||"Impossible d’ouvrir la caméra";result.style.color="#dc2626";}
      if(button){button.textContent="📷 Ouvrir le scanner";button.onclick=ptEmployeeQrStart;}
      ptEmployeeQrSession=null;
    }finally{
      if(ptEmployeeQrSession===ticket&&!ticket.started)ptEmployeeQrSession=null;
    }
  })();
  return ticket.task;
}
function ptEmployeeQrStop(){
  ++ptEmployeeQrGeneration;
  const ticket=ptEmployeeQrSession;
  ptEmployeeQrSession=null;
  _ptEmployeeQrScanner=null;
  ptEmployeeQrTimeouts.forEach(clearTimeout);ptEmployeeQrTimeouts.clear();
  _ptEmployeeQrBusy=false;
  // Un start pending est nettoyé APRÈS sa résolution, une seule fois.
  if(ticket)ptEmployeeQrCleanup=ticket.task.then(()=>ptEmployeeQrDispose(ticket));
  const reader=document.getElementById("pt-employee-qr-reader");
  const button=document.getElementById("pt-employee-qr-open");
  if(reader)reader.style.display="none";
  if(button){button.textContent="📷 Ouvrir le scanner";button.onclick=ptEmployeeQrStart;}
  return ptEmployeeQrCleanup;
}

async function ptEmployeeQrSubmit(token){
  const hash=location.hash,generation=sgdiViewRenderGeneration,view=document.getElementById("view");
  let scannerGeneration=ptEmployeeQrGeneration;
  const current=()=>scannerGeneration===ptEmployeeQrGeneration&&hash===location.hash&&generation===sgdiViewRenderGeneration&&document.getElementById("view")===view&&window.SGDIModules?.activeModuleKey==="pointage";
  if(_ptEmployeeQrBusy)return;
  _ptEmployeeQrBusy=true;
  const result=document.getElementById("pt-employee-qr-result");
  try{
    const response=await fetch("/api/portal/attendance-qr/scan",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${sgdiAuthToken()}`},
      body:JSON.stringify({token})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.detail||"Pointage refusé");
    if(!current())return;
    const cleanup=ptEmployeeQrStop();scannerGeneration=ptEmployeeQrGeneration;
    await cleanup;
    if(!current())return;
    const employee=data.employee||{};
    const name=[employee.nom,employee.prenom].filter(Boolean).join(" ");
    const action=data.action==="depart"?"DÉPART":"ARRIVÉE";
    if(result){result.innerHTML=`<div style="padding:12px;border-radius:10px;background:#dcfce7;color:#166534;font-weight:800">✓ ${escapeHTML(name)} · ${action} ${escapeHTML(data.heure||"")}</div>`;}
    toast(`${name} · ${action} enregistré`,"success");
    await sgdiPullState({silent:true,force:true}).catch(()=>null);
    if(current())ptEmployeeQrTimeout(()=>{if(current())renderView()},900);
  }catch(e){
    if(current()&&result){result.textContent=e.message||"QR invalide";result.style.color="#dc2626";}
  }finally{
    if(current())ptEmployeeQrTimeout(()=>{_ptEmployeeQrBusy=false},1200);
  }
}

function ptAutoSaisieStopLiveRefresh(){
  if(_ptAutoSaisieLiveTimer){clearInterval(_ptAutoSaisieLiveTimer);_ptAutoSaisieLiveTimer=null}
}

async function ptAutoSaisieLiveRefresh(){
  if(_ptAutoSaisieRefreshing||document.hidden||sgdiDirty||document.querySelector(".modal-bg"))return;
  const active=document.activeElement;
  // Ne pas reconstruire la vue pendant que l'utilisateur tape dans la recherche ou a un
  // menu déroulant ouvert (Trier par/Ordre) : ça lui coupe la frappe / referme le menu
  // en plein clic. On retente au prochain cycle (10s) une fois le focus relâché.
  if(active&&(active.id==="pt-search-input"||active.tagName==="SELECT"||active.closest?.(".pt-auto-toolbar")))return;
  const route=String(location.hash||"");
  if(!route.includes("pointage/auto")){ptAutoSaisieStopLiveRefresh();return}
  _ptAutoSaisieRefreshing=true;
  try{
    const refreshPeople=Date.now()-_ptAutoEmployeesSyncedAt>60000;
    const [res]=await Promise.all([
      sgdiApi("/api/irongs/collections/feuillePresence",{method:"GET",legacy:false}),
      refreshPeople?ptPullLightEmployees(ptCurrentSoc()):Promise.resolve(null)
    ]);
    if(refreshPeople)_ptAutoEmployeesSyncedAt=Date.now();
    const data=Array.isArray(res)?res:(res?.data||[]);
    if(Array.isArray(data))db.feuillePresence=data;
    _ptAutoSaisieError="";
    const scrollY=window.scrollY;
    renderView();
    requestAnimationFrame(()=>window.scrollTo(0,scrollY));
  }catch(e){
    _ptAutoSaisieError=e?.message||"Impossible de charger les pointages DRH.";
    const box=document.getElementById("pt-auto-sync-error");
    if(box){box.textContent="Synchronisation impossible : "+_ptAutoSaisieError;box.style.display="block";}
  }finally{_ptAutoSaisieRefreshing=false}
}

function ptAutoSaisieStartLiveRefresh(){
  ptAutoSaisieStopLiveRefresh();
  if(!String(location.hash||"").includes("pointage/auto"))return;
  setTimeout(ptAutoSaisieLiveRefresh,0);
  _ptAutoSaisieLiveTimer=setInterval(ptAutoSaisieLiveRefresh,10000);
}

function renderPointageRecap(agentId){
  const ym=ptCurrentMonth();const soc=ptCurrentSoc();
  const ag=pointageEligibleAgents(soc);
  const cur=agentId?db.agents.find(a=>a.id===agentId):null;
  const filterBar=`<div class="card p-4 mb-4" data-nav-filter><div class="flex flex-wrap items-center gap-3">
    <div><label class="label">Mois</label><input type="month" class="input" value="${ym}" onchange="setPtMonth(this.value)"/></div>
    <div class="flex-1"><label class="label">Agent</label><select class="select" onchange="navigate('pointage/recap/'+this.value)"><option value="">— Sélectionner un agent —</option>${ag.map(a=>`<option value="${a.id}" ${cur&&cur.id===a.id?"selected":""}>${escapeHTML((a.nom||"")+" "+(a.prenom||""))} [${escapeHTML(a.matricule||"—")}] · ${escapeHTML(a.societe||"")}</option>`).join("")}</select></div>
  </div></div>`;
  if(!cur)return filterBar+`<div class="card p-6 text-center text-slate-500">Sélectionnez un agent ci-dessus pour voir son récapitulatif mensuel.</div>`;
  const sheet=ptGetSheet(cur.id,ym);
  const days=ptDaysInMonth(ym);const [yr,mo]=ym.split("-").map(Number);
  const resolvedByDay={};
  for(let d=1;d<=days;d++){const k=String(d).padStart(2,"0");resolvedByDay[k]=ptResolveDayCode(cur,sheet,ym,k)}
  const tableCells=Array.from({length:days},(_,i)=>{const d=i+1;const k=String(d).padStart(2,"0");const code=resolvedByDay[k];const c=POINTAGE_CODES[code];const date=new Date(yr,mo-1,d);const wd=date.getDay();const we=wd===0||wd===6;const wdName=["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"][wd];return`<tr ${we?'style="background:#fef2f2"':""}><td class="px-2 py-1 font-mono text-xs" style="border:1px solid #e2e8f0">${k}/${String(mo).padStart(2,"0")}</td><td class="px-2 py-1 text-xs ${we?"text-red-600 font-semibold":""}" style="border:1px solid #e2e8f0">${wdName}</td><td class="px-2 py-1 text-center font-bold" style="border:1px solid #e2e8f0;background:${c?c.bg:""};color:${c?c.color:"#94a3b8"}">${code||"·"}</td><td class="px-2 py-1 text-xs" style="border:1px solid #e2e8f0">${c?c.label:"—"}</td></tr>`}).join("");
  const countForCode=k=>Object.values(resolvedByDay).filter(v=>v===k).length;
  const counts=Object.entries(POINTAGE_CODES).filter(([k])=>{const n=countForCode(k);return n>0||["P","A","M","S","C","R"].includes(k);}).map(([k,c])=>{const n=countForCode(k);return`<div class="card p-3 text-center" style="background:${c.bg}"><div class="text-[10px] uppercase tracking-wider font-semibold" style="color:${c.color}">${c.label} (${k})</div><div class="text-2xl font-black" style="color:${c.color}">${n}</div></div>`}).join("");
  const total=Object.values(resolvedByDay).filter(Boolean).length;
  const isValide=!!(sheet&&sheet.valide);
  const validBlock=isValide?`<div class="card p-3 mb-3" style="background:#dcfce7;border:2px solid #043970"><div class="flex items-center justify-between"><div><div class="text-xs uppercase tracking-wider font-bold text-emerald-700">🔒 Pointage validé</div><div class="text-xs text-slate-600">Validé par <strong>${escapeHTML(sheet.valideBy||"?")}</strong> le ${sheet.valideAt?new Date(sheet.valideAt).toLocaleString("fr-FR"):""}</div></div><button class="btn btn-ghost text-xs" onclick="ptDevaliderSheet('${cur.id}','${ym}')">🔓 Déverrouiller</button></div></div>`:`<div class="card p-3 mb-3" style="background:#043970;border:2px dashed #043970"><div class="flex items-center justify-between"><div><div class="text-xs uppercase tracking-wider font-bold text-amber-700">⏳ Non validé</div><div class="text-xs text-slate-600">Cliquez sur « Valider » pour verrouiller ce pointage.</div></div><button class="btn btn-primary text-xs" style="background:#043970;border-color:#043970" onclick="ptValiderSheet('${cur.id}','${ym}')">✅ Valider le pointage</button></div></div>`;
  return filterBar+validBlock+`<div class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">${counts}</div>
    <div class="card p-4 mb-4"><div class="flex justify-between items-center"><div><div class="text-xs text-slate-500">Agent</div><div class="font-bold text-lg">${escapeHTML((cur.nom||"")+" "+(cur.prenom||""))} <span class="font-mono text-sm px-2 py-0.5 rounded ml-2" style="background:#04397015;color:#043970">${escapeHTML(cur.matricule||"—")}</span></div><div class="text-xs text-slate-500">${escapeHTML(cur.societe||"")} · ${escapeHTML(cur.fonction||"")}</div></div><div class="text-right"><div class="text-xs text-slate-500">Jours renseignés</div><div class="text-3xl font-black text-cyan-600">${total}/${days}</div></div></div></div>
    <div class="card p-2"><div class="text-sm font-semibold mb-2 px-2">Détail jour par jour — ${new Date(yr,mo-1,1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"})}</div>
      <table class="w-full text-sm"><thead><tr style="background:#f1f5f9"><th class="text-left px-2 py-2 text-xs font-bold" style="border:1px solid #e2e8f0">Date</th><th class="text-left px-2 py-2 text-xs font-bold" style="border:1px solid #e2e8f0">Jour</th><th class="text-center px-2 py-2 text-xs font-bold" style="border:1px solid #e2e8f0">Code</th><th class="text-left px-2 py-2 text-xs font-bold" style="border:1px solid #e2e8f0">Statut</th></tr></thead><tbody>${tableCells}</tbody></table>
    </div>`;
}

function renderPointageSociete(){
  const ym=ptCurrentMonth();const days=ptDaysInMonth(ym);
  const filterBar=`<div class="card p-4 mb-4" data-nav-filter><div class="flex flex-wrap items-center gap-3"><div><label class="label">Mois</label><input type="month" class="input" value="${ym}" onchange="setPtMonth(this.value)"/></div></div></div>`;
  const allowedSocietes=currentAllowedSocietes();
  const rows=allowedSocietes.map(s=>{
    const ag=pointageEligibleAgents(s);
    const sheets=ag.map(a=>ptGetSheet(a.id,ym)).filter(Boolean);
    const tot={P:0,A:0,M:0,S:0,C:0,R:0,AB:0,F1:0,F2:0,F3:0,"P/F1":0,"P/F2":0,"P/F3":0,A1:0,A2:0,A3:0};sheets.forEach(sh=>{Object.values(sh.days||{}).forEach(v=>{if(tot[v]!==undefined)tot[v]++})});
    const totFx=tot.F1+tot.F2+tot.F3+tot["P/F1"]+tot["P/F2"]+tot["P/F3"];const totAbs=tot.A+tot.AB+tot.A1+(tot.A2*2)+(tot.A3*3);const totAx=tot.AB+tot.A2+tot.A3;
    const totalCells=ag.length*days;const renseigne=sheets.reduce((acc,sh)=>acc+Object.keys(sh.days||{}).length,0);const tx=totalCells?Math.round(renseigne*100/totalCells):0;
    return`<tr class="border-t"><td class="p-3 font-bold">${escapeHTML(s)}</td><td class="p-3 text-center">${ag.length}</td><td class="p-3 text-center font-bold text-emerald-600">${tot.P}</td><td class="p-3 text-center font-bold text-red-600">${totAbs}</td><td class="p-3 text-center font-bold text-amber-600">${tot.M}</td><td class="p-3 text-center font-bold text-violet-600">${tot.S}</td><td class="p-3 text-center font-bold text-sky-600">${tot.C}</td><td class="p-3 text-center font-bold text-slate-600">${tot.R}</td><td class="p-3 text-center font-bold" style="color:#b45309">${totFx||"·"}</td><td class="p-3 text-center font-bold" style="color:#7f1d1d">${totAx||"·"}</td><td class="p-3 text-center"><span class="pill ${tx>=80?"pill-green":(tx>=50?"pill-amber":"pill-red")}">${tx}%</span></td></tr>`;
  }).join("");
  return filterBar+`<div class="card p-2"><div class="text-sm font-semibold mb-2 px-2">Récapitulatif mensuel par société — ${new Date(...ym.split("-").map((v,i)=>i?v-1:+v),1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"})}</div>
    <table class="w-full text-sm"><thead><tr style="background:#f1f5f9"><th class="text-left p-3">Société</th><th class="p-3 text-center">Effectif</th><th class="p-3 text-center text-emerald-700">P</th><th class="p-3 text-center text-red-700" title="Absence paie : A + AB + A1 + A2×2 + A3×3">A</th><th class="p-3 text-center text-amber-700">M</th><th class="p-3 text-center text-violet-700">S</th><th class="p-3 text-center text-sky-700">C</th><th class="p-3 text-center text-slate-700">R</th><th class="p-3 text-center" style="color:#b45309" title="F1+F2+F3+P/F1+P/F2+P/F3">Fx</th><th class="p-3 text-center" style="color:#7f1d1d" title="AB+A2+A3 déjà inclus dans A paie">Ax/AB</th><th class="p-3 text-center">Couverture</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function renderPointageStats(){
  const ym=ptCurrentMonth();const soc=ptCurrentSoc();
  const ag=pointageEligibleAgents(soc);
  const filterBar=`<div class="card p-4 mb-4" data-nav-filter><div class="flex flex-wrap items-center gap-3">
    <div><label class="label">Mois</label><input type="month" class="input" value="${ym}" onchange="setPtMonth(this.value)"/></div>
    <div><label class="label">Société</label><select class="select" onchange="setPtSociete(this.value)"><option value="" ${!soc?"selected":""}>🏢 Toutes les sociétés</option>${SOCIETES.map(s=>`<option ${soc===s?"selected":""}>${s}</option>`).join("")}</select></div>
  </div></div>`;
  const tot={P:0,A:0,M:0,S:0,C:0,R:0,AB:0,F1:0,F2:0,F3:0,"P/F1":0,"P/F2":0,"P/F3":0,A1:0,A2:0,A3:0};
  ag.forEach(a=>{const sh=ptGetSheet(a.id,ym);if(sh)Object.values(sh.days||{}).forEach(v=>{if(tot[v]!==undefined)tot[v]++})});
  const totSum=Object.values(tot).reduce((a,b)=>a+b,0);
  const totalPresent=tot.P+tot.F1+tot.F2+tot.F3+tot["P/F1"]+tot["P/F2"]+tot["P/F3"];
  const totalAbsent=tot.A+tot.AB+tot.A1+(tot.A2*2)+(tot.A3*3);
  const days=ptDaysInMonth(ym);const expected=ag.length*days;const tauxPresence=expected?Math.round(totalPresent*100/expected):0;const tauxAbs=expected?Math.round((totalAbsent+tot.M)*100/expected):0;
  const cards=`<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Effectif</div><div class="text-3xl font-black text-cyan-600">${ag.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Jours/mois</div><div class="text-3xl font-black text-slate-700">${days}</div></div>
    <div class="card p-4" style="background:#043970"><div class="text-xs text-emerald-600 uppercase font-semibold">Taux de présence</div><div class="text-3xl font-black text-emerald-700">${tauxPresence}%</div></div>
    <div class="card p-4" style="background:#fef2f2"><div class="text-xs text-red-600 uppercase font-semibold">Taux d'absentéisme</div><div class="text-3xl font-black text-red-700">${tauxAbs}%</div></div>
  </div>`;
  const codeRows=Object.entries(POINTAGE_CODES).map(([k,v])=>{const n=tot[k]||0;const pct=totSum?Math.round(n*100/totSum):0;return`<tr class="border-t"><td class="p-3"><span class="inline-flex items-center gap-2"><span class="font-mono font-black px-2 py-0.5 rounded" style="background:${v.bg};color:${v.color}">${k}</span>${v.label}</span></td><td class="p-3 text-center font-bold text-lg">${n}</td><td class="p-3"><div style="background:#f1f5f9;height:14px;border-radius:7px;overflow:hidden"><div style="background:${v.color};height:100%;width:${pct}%"></div></div></td><td class="p-3 text-right font-semibold">${pct}%</td></tr>`}).join("");
  const breakdown=`<div class="card p-2 mb-4"><div class="text-sm font-semibold mb-2 px-2">Répartition des codes</div>
    <table class="w-full text-sm"><thead><tr style="background:#f1f5f9"><th class="text-left p-3">Code</th><th class="p-3 text-center">Total jours</th><th class="p-3">Distribution</th><th class="p-3 text-right">%</th></tr></thead><tbody>${codeRows}</tbody></table>
  </div>`;
  const top=ag.map(a=>{const sh=ptGetSheet(a.id,ym);const c={P:ptCount(sh,"P"),A:ptAbsencePayrollDays(sh),M:ptCount(sh,"M"),S:ptCount(sh,"S"),C:ptCount(sh,"C"),R:ptCount(sh,"R"),Fx:["F1","F2","F3","P/F1","P/F2","P/F3"].reduce((s,k)=>s+ptCount(sh,k),0),Ax:["AB","A2","A3"].reduce((s,k)=>s+ptCount(sh,k),0)};return{a,c,abs:c.A+c.M}}).sort((x,y)=>y.abs-x.abs).slice(0,10);
  const topRows=top.filter(t=>t.abs>0).map(({a,c,abs})=>`<tr class="border-t"><td class="p-3 font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))} <span class="font-mono text-[10px] px-1.5 py-0.5 rounded ml-1" style="background:#04397015;color:#043970">${escapeHTML(a.matricule||"—")}</span></td><td class="p-3 text-xs text-slate-500">${escapeHTML(a.societe||"")}</td><td class="p-3 text-center text-emerald-600">${c.P+(c.Fx?`<span style="color:#b45309">+${c.Fx}</span>`:"")}</td><td class="p-3 text-center text-red-600 font-bold">${c.A}</td><td class="p-3 text-center text-amber-600 font-bold">${c.M}</td><td class="p-3 text-center" style="color:#7f1d1d;font-weight:700">${c.Ax||"·"}</td><td class="p-3 text-center font-black text-red-700">${abs}</td></tr>`).join("")||`<tr><td class="p-6 text-center text-slate-400" colspan="7">Aucune absence enregistrée sur la période.</td></tr>`;
  const topCard=`<div class="card p-2"><div class="text-sm font-semibold mb-2 px-2">🚨 Top 10 absences (A paie + M)</div>
    <table class="w-full text-sm"><thead><tr style="background:#f1f5f9"><th class="text-left p-3">Agent</th><th class="text-left p-3">Société</th><th class="p-3 text-center text-emerald-700">P (+Fx)</th><th class="p-3 text-center text-red-700" title="A + AB + A1 + A2×2 + A3×3">A paie</th><th class="p-3 text-center text-amber-700">M</th><th class="p-3 text-center" style="color:#7f1d1d" title="AB+A2+A3 déjà inclus dans A paie">Ax/AB</th><th class="p-3 text-center">Total abs.</th></tr></thead><tbody>${topRows}</tbody></table>
  </div>`;
  return filterBar+cards+breakdown+topCard;
}

function renderPointageLegende(){
  const baseKeys=["P","A","M","S","C","R","AB"];
  const baseRows=baseKeys.map(k=>{const v=POINTAGE_CODES[k];return`<tr class="border-t"><td class="p-4 text-center font-mono text-xl font-black" style="background:${v.bg};color:${v.color};width:80px">${k}</td><td class="p-4 font-bold">${v.label}</td></tr>`;}).join("");
  const fRows=[
    ["F1","Récupération travaillée","L'employé est en récupération mais vient travailler. La journée est comptée <strong>1 jour de plus</strong> (récupération remboursée).","#fef9c3","#b45309"],
    ["F2","Récupération travaillée","L'employé est en récupération mais vient travailler. La journée est comptée <strong>2 jours de plus</strong>.","#fde68a","#92400e"],
    ["F3","Récupération travaillée","L'employé est en récupération mais vient travailler. La journée est comptée <strong>3 jours de plus</strong>.","#fcd34d","#78350f"],
  ].map(([k,titre,desc,bg,col])=>`<tr class="border-t"><td class="p-4 text-center font-mono text-xl font-black" style="background:${bg};color:${col};width:80px">${k}</td><td class="p-4"><div class="font-bold mb-1">${titre}</div><div class="text-sm text-slate-600">${desc}</div></td></tr>`).join("");
  const pfRows=[
    ["P/F1","Maintenu en poste","L'employé est en poste « P » et est maintenu. La journée est comptée <strong>2 jours</strong> (+1 en sus du jour travaillé).","#d1fae5","#065f46"],
    ["P/F2","Maintenu en poste","L'employé est en poste « P » et est maintenu. La journée est comptée <strong>3 jours</strong> (+2).","#a7f3d0","#047857"],
    ["P/F3","Maintenu en poste","L'employé est en poste « P » et est maintenu. La journée est comptée <strong>4 jours</strong> (+3).","#6ee7b7","#064e3b"],
  ].map(([k,titre,desc,bg,col])=>`<tr class="border-t"><td class="p-4 text-center font-mono text-xl font-black" style="background:${bg};color:${col};width:80px">${k}</td><td class="p-4"><div class="font-bold mb-1">${titre}</div><div class="text-sm text-slate-600">${desc}</div></td></tr>`).join("");
  const aRows=[
    ["AB","Abandon de poste","Déclenché automatiquement quand <strong>3 absences sont consécutives</strong>. En paie, AB est comptabilisé comme <strong>1 jour d'absence A</strong>.","#fee2e2","#991b1b"],
    ["A1","Absent 1 jour","L'employé est absent de son poste. Comptabilisé comme <strong>1 jour d'absence</strong>.","#fecaca","#b91c1c"],
    ["A2","Absent 2 jours","L'employé est absent de son poste. Comptabilisé comme <strong>2 jours d'absence</strong>.","#fca5a5","#991b1b"],
    ["A3","Absent 3 jours","L'employé est absent de son poste. Comptabilisé comme <strong>3 jours d'absence</strong>.","#f87171","#7f1d1d"],
  ].map(([k,titre,desc,bg,col])=>`<tr class="border-t"><td class="p-4 text-center font-mono text-xl font-black" style="background:${bg};color:${col};width:80px">${k}</td><td class="p-4"><div class="font-bold mb-1">${titre}</div><div class="text-sm text-slate-600">${desc}</div></td></tr>`).join("");
  return`<div class="card p-5 mb-4"><h3 class="font-bold text-lg mb-2">Codes de base</h3><p class="text-sm text-slate-600 mb-4">Clic gauche sur une case du tableau = cycle automatique · Clic droit = saisir directement.</p>
    <table class="w-full text-sm"><thead><tr style="background:#f1f5f9"><th class="text-center p-3">Code</th><th class="text-left p-3">Signification</th></tr></thead><tbody>${baseRows}</tbody></table>
  </div>
  <div class="card p-5 mb-4">
    <h3 class="font-bold text-lg mb-1">Codes F1 / F2 / F3 — Récupération travaillée</h3>
    <p class="text-sm text-slate-500 mb-3">À utiliser quand un employé <strong>en récupération</strong> vient travailler (jours supplémentaires crédités).</p>
    <table class="w-full text-sm"><thead><tr style="background:#f1f5f9"><th class="text-center p-3">Code</th><th class="text-left p-3">Règle de comptage</th></tr></thead><tbody>${fRows}</tbody></table>
  </div>
  <div class="card p-5 mb-4">
    <h3 class="font-bold text-lg mb-1">Codes P/F1 / P/F2 / P/F3 — Maintien en poste</h3>
    <p class="text-sm text-slate-500 mb-3">À utiliser quand un employé <strong>en poste P</strong> est maintenu au-delà de sa durée normale.</p>
    <table class="w-full text-sm"><thead><tr style="background:#f1f5f9"><th class="text-center p-3">Code</th><th class="text-left p-3">Règle de comptage</th></tr></thead><tbody>${pfRows}</tbody></table>
  </div>
  <div class="card p-5 mb-4">
    <h3 class="font-bold text-lg mb-1">Codes AB / A1 / A2 / A3 — Absences paie</h3>
    <p class="text-sm text-slate-500 mb-3"><strong>AB = A dans le calcul de la paie</strong>. Après 3 absences consécutives, le 3e jour est transformé en AB automatiquement.</p>
    <table class="w-full text-sm"><thead><tr style="background:#f1f5f9"><th class="text-center p-3">Code</th><th class="text-left p-3">Règle de comptage</th></tr></thead><tbody>${aRows}</tbody></table>
  </div>
  <div class="card p-5"><h3 class="font-bold mb-3">Modes de saisie</h3>
    <ul class="text-sm space-y-2 list-disc pl-5"><li><strong>Clic gauche</strong> sur une case : cycle des codes de base (·→P→A→M→S→C→R)</li><li><strong>Clic droit</strong> sur une case : saisir n'importe quel code (AB, F1, F2, F3, P/F1, P/F2, P/F3, A1, A2, A3…)</li><li>Les samedis et dimanches sont mis en évidence en bleu</li><li>Sauvegarde automatique dans PostgreSQL</li></ul>
  </div>`;
}

SGDIModules.registerModule({key: "pointage-1", routes: [], dependencies: [], init: function(){}, destroy: function(){}});
