/* Phase 2 — agenda. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2h-inventory.json. */
function agendaEventTypeMeta(type){
  return ({
    tache:{label:"Tâche",color:"#0f766e",bg:"#ecfdf5"},
    contrat:{label:"Fin de contrat",color:"#dc2626",bg:"#fef2f2"},
    essai:{label:"Fin d'essai",color:"#7c3aed",bg:"#f5f3ff"},
    reunion:{label:"Réunion",color:"#2563eb",bg:"#eff6ff"},
    rappel:{label:"Rappel",color:"#d97706",bg:"#fffbeb"},
    echeance:{label:"Échéance",color:"#dc2626",bg:"#fef2f2"},
    mission:{label:"Mission",color:"#0891b2",bg:"#ecfeff"},
    personnel:{label:"Personnel",color:"#7c3aed",bg:"#f5f3ff"}
  })[type]||{label:"Événement",color:"#475569",bg:"#f8fafc"};
}

function agendaWeekStart(dateStr){
  const d=new Date((dateStr||today())+"T00:00:00");
  const day=(d.getDay()+6)%7;
  d.setDate(d.getDate()-day);
  return d.toISOString().slice(0,10);
}

function agendaStatusPill(e){
  const st=String(e.statut||"planifie");
  const cls=st==="termine"?"pill-green":st==="annule"?"pill-red":agendaEventIsReminderDue(e)?"pill-amber":"pill-blue";
  const label=st==="termine"?"Terminé":st==="annule"?"Annulé":agendaEventIsReminderDue(e)?"À traiter":"Planifié";
  return `<span class="pill ${cls}">${label}</span>`;
}

function agendaScopeLabel(){return currentStructureSocieteFilter()||session?.societe||"Toutes sociétés"}

function agendaEventCard(e,compact){
  const meta=agendaEventTypeMeta(e.type);
  const who=e.responsable||e.createdBy||"";
  return `<div class="agenda-event-card ${agendaEventIsDone(e)?"is-done":""}" style="border-left-color:${meta.color}" data-searchable>
    <div class="agenda-event-head">
      <div>
        <div class="agenda-event-title">${escapeHTML(e.titre||"Sans titre")}</div>
        <div class="agenda-event-meta">${formatDate(e.date)}${e.heureDebut?` · ${escapeHTML(e.heureDebut)}`:""}${e.heureFin?`-${escapeHTML(e.heureFin)}`:""}${who?` · ${escapeHTML(who)}`:""}</div>
      </div>
      <div class="agenda-event-actions">${e.priority?`<span class="agenda-priority agenda-priority-${escapeHTML(e.priority)}">${escapeHTML(e.priority)}</span>`:""}${agendaStatusPill(e)}${e.automatic?`<button type="button" class="btn btn-secondary text-xs" onclick="navigate('${escapeHTML(e.route||"agenda/dashboard")}')">Ouvrir</button>`:`${!agendaEventIsDone(e)?`<button type="button" class="btn btn-success text-xs" onclick="completeAgendaEvent('${escapeHTML(e.id)}')">✓</button>`:""}<button type="button" class="btn btn-secondary text-xs" onclick="openAgendaEventModal('${escapeHTML(e.id)}')">Modifier</button>`}</div>
    </div>
    ${compact?"":`<div class="agenda-event-body">${escapeHTML(e.description||"")}</div>`}
    <div class="agenda-event-foot"><span style="background:${meta.bg};color:${meta.color}">${escapeHTML(meta.label)}</span>${e.automatic?`<span>⚙ Automatique</span>`:""}${e.lieu?`<span>${escapeHTML(e.lieu)}</span>`:""}${e.societe?`<span>${escapeHTML(e.societe)}</span>`:""}</div>
  </div>`;
}

function agendaCompactRows(rows,emptyText){
  if(!rows.length)return `<div class="agenda-empty">${escapeHTML(emptyText||"Aucune tâche.")}</div>`;
  const groups=new Map();rows.forEach(e=>{if(!groups.has(e.date))groups.set(e.date,[]);groups.get(e.date).push(e)});
  return [...groups].map(([date,items])=>`<div class="agenda-date-group"><div class="agenda-date-label"><b>${formatDate(date)}</b><span>${items.length}</span></div>${items.map(e=>agendaEventCard(e,true)).join("")}</div>`).join("");
}

function agendaWeekEventCard(e){
  const meta=agendaEventTypeMeta(e.type);
  return `<article class="agenda-week-event ${agendaEventIsDone(e)?"is-done":""}" style="--agenda-event-color:${meta.color}">
    <div class="agenda-week-event-top"><span class="agenda-week-event-type" style="background:${meta.bg};color:${meta.color}">${escapeHTML(meta.label)}</span>${e.priority?`<span class="agenda-priority agenda-priority-${escapeHTML(e.priority)}">${escapeHTML(e.priority)}</span>`:""}</div>
    <strong>${escapeHTML(e.titre||"Sans titre")}</strong>
    <small>${e.heureDebut?`${escapeHTML(e.heureDebut)}${e.heureFin?` – ${escapeHTML(e.heureFin)}`:""}`:"Toute la journée"}${e.responsable?` · ${escapeHTML(e.responsable)}`:""}</small>
    <button type="button" onclick="${e.automatic?`navigate('${escapeHTML(e.route||"agenda/dashboard")}')`:`openAgendaEventModal('${escapeHTML(e.id)}')`}">Ouvrir</button>
  </article>`;
}

function agendaMonthStart(dateStr){
  const d=new Date((dateStr||today())+"T00:00:00");d.setDate(1);return d.toISOString().slice(0,10);
}

function agendaMonthOffset(dateStr,months){
  const d=new Date((dateStr||today())+"T00:00:00");d.setDate(1);d.setMonth(d.getMonth()+months);return d.toISOString().slice(0,10);
}

function agendaCalendarEvent(e){
  const meta=agendaEventTypeMeta(e.type);
  return `<button type="button" class="agenda-cal-event" style="--cal-color:${meta.color};--cal-bg:${meta.bg}" onclick="${e.automatic?`navigate('${escapeHTML(e.route||"agenda/dashboard")}')`:`openAgendaEventModal('${escapeHTML(e.id)}')`}" title="${escapeHTML(e.titre||"")}"><i></i><span>${e.heureDebut?escapeHTML(e.heureDebut)+" ":""}${escapeHTML(e.titre||"Sans titre")}</span></button>`;
}

function agendaMiniMonth(year,month,events,selected){
  const first=new Date(year,month,1),start=(first.getDay()+6)%7,days=new Date(year,month+1,0).getDate();
  const cells=Array.from({length:42},(_,i)=>{const day=i-start+1;if(day<1||day>days)return`<span class="outside"></span>`;const ds=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;return`<button class="${ds===today()?"today":""} ${ds===selected?"selected":""}" onclick="navigate('agenda/dashboard/${ds}')">${day}${events.some(e=>e.date===ds)?`<i></i>`:""}</button>`}).join("");
  return `<div class="agenda-mini-month"><header><b>${new Date(year,month,1).toLocaleDateString("fr-FR",{month:"long"})}</b></header><div class="agenda-mini-week"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div><div class="agenda-mini-days">${cells}</div></div>`;
}

function agendaCalendarSidebar(events,selected){
  const d=new Date((selected||today())+"T00:00:00");
  const types=[["tache","Tâches"],["contrat","Fins de contrat"],["essai","Périodes d'essai"],["mission","Missions"],["conge","Congés"]];
  return `<aside class="agenda-calendar-sidebar"><button class="agenda-sidebar-create" onclick="openAgendaEventModal()">＋</button><h3>Calendriers</h3>${types.map(([type,label])=>{const meta=agendaEventTypeMeta(type);return`<label><i style="background:${meta.color}">✓</i><span>${label}</span><b>${events.filter(e=>e.type===type&&!agendaEventIsDone(e)).length}</b></label>`}).join("")}<div class="agenda-sidebar-rule"></div>${agendaMiniMonth(d.getFullYear(),d.getMonth(),events,selected)}</aside>`;
}

function renderAgenda(view,sub,arg){
  if(!canAccess("agenda")){view.innerHTML=`<div class="card p-6">🔐 Accès refusé</div>`;return}
  if(!Array.isArray(db.agendaEvents))db.agendaEvents=[];
  const mode=sub||"dashboard";
  const events=agendaEvents().sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))||String(a.heureDebut||"").localeCompare(String(b.heureDebut||"")));
  const td=today();
  const todayRows=events.filter(e=>e.date===td&&!agendaEventIsDone(e));
  const upcoming=events.filter(e=>e.date>td&&!agendaEventIsDone(e));
  const overdue=events.filter(e=>e.date<td&&!agendaEventIsDone(e));
  const done=events.filter(agendaEventIsDone);
  const kpi=(label,value,subText,color)=>`<div class="agenda-kpi"><span>${escapeHTML(label)}</span><strong style="color:${color}">${value}</strong><small>${escapeHTML(subText||"")}</small></div>`;
  view.classList.add("agenda-fullscreen-view");
  const selected=arg||td;
  const navMode=mode==="dashboard"?"jour":mode;
  const routes=[["jour","Jour","dashboard"],["semaine","Semaine","semaine"],["mois","Mois","mois"],["annee","Année","annee"]];
  const header=`<div class="agenda-page agenda-page-full agenda-calendar-app"><div class="agenda-calendar-top"><div class="agenda-calendar-brand"><b>Agenda</b><span>${escapeHTML(agendaScopeLabel())}</span></div><div class="agenda-calendar-modes">${routes.map(([k,label,route])=>`<button class="${navMode===k?"active":""}" onclick="navigate('agenda/${route}/${selected}')">${label}</button>`).join("")}</div><button class="agenda-calendar-search" onclick="navigate('agenda/liste')">⌕</button></div>`;
  if(mode==="semaine"){
    const start=agendaWeekStart(selected);
    const days=Array.from({length:7},(_,i)=>agendaDateOffset(start,i));
    const hours=Array.from({length:16},(_,i)=>String(i+5).padStart(2,"0")+":00");
    view.innerHTML=header+`<div class="agenda-calendar-shell">${agendaCalendarSidebar(events,selected)}<main class="agenda-calendar-main"><div class="agenda-calendar-toolbar"><h1>${new Date(start+"T00:00:00").toLocaleDateString("fr-FR",{month:"long",year:"numeric"})}</h1><div><button onclick="navigate('agenda/semaine/${agendaDateOffset(start,-7)}')">‹</button><button onclick="navigate('agenda/semaine/${td}')">Aujourd’hui</button><button onclick="navigate('agenda/semaine/${agendaDateOffset(start,7)}')">›</button></div></div><div class="agenda-time-week"><div class="agenda-time-corner">toute la journée</div>${days.map(d=>`<div class="agenda-time-day-head ${d===td?"today":""}">${new Date(d+"T00:00:00").toLocaleDateString("fr-FR",{weekday:"short"})} <b>${Number(d.slice(-2))}</b></div>`).join("")}<div class="agenda-all-day-label"></div>${days.map(d=>`<div class="agenda-all-day">${events.filter(e=>e.date===d&&!e.heureDebut).map(agendaCalendarEvent).join("")}</div>`).join("")}${hours.map(h=>`<div class="agenda-hour-label">${h}</div>${days.map(d=>`<div class="agenda-hour-cell">${events.filter(e=>e.date===d&&e.heureDebut&&e.heureDebut.slice(0,2)===h.slice(0,2)).map(agendaCalendarEvent).join("")}</div>`).join("")}`).join("")}</div></main></div></div>`;
    return;
  }
  if(mode==="mois"){
    const ms=agendaMonthStart(selected),d=new Date(ms+"T00:00:00"),offset=(d.getDay()+6)%7,start=agendaDateOffset(ms,-offset);const cells=Array.from({length:42},(_,i)=>agendaDateOffset(start,i));
    view.innerHTML=header+`<div class="agenda-calendar-shell">${agendaCalendarSidebar(events,selected)}<main class="agenda-calendar-main"><div class="agenda-calendar-toolbar"><h1>${d.toLocaleDateString("fr-FR",{month:"long",year:"numeric"})}</h1><div><button onclick="navigate('agenda/mois/${agendaMonthOffset(ms,-1)}')">‹</button><button onclick="navigate('agenda/mois/${td}')">Aujourd’hui</button><button onclick="navigate('agenda/mois/${agendaMonthOffset(ms,1)}')">›</button></div></div><div class="agenda-month-weekdays">${["lun.","mar.","mer.","jeu.","ven.","sam.","dim."].map(x=>`<span>${x}</span>`).join("")}</div><div class="agenda-month-grid">${cells.map(ds=>`<div class="agenda-month-cell ${ds.slice(0,7)!==ms.slice(0,7)?"outside":""} ${ds===td?"today":""}" ondblclick="openAgendaEventModal()"><button onclick="navigate('agenda/dashboard/${ds}')">${Number(ds.slice(-2))}</button>${events.filter(e=>e.date===ds).slice(0,4).map(agendaCalendarEvent).join("")}${events.filter(e=>e.date===ds).length>4?`<small>+ ${events.filter(e=>e.date===ds).length-4} autres</small>`:""}</div>`).join("")}</div></main></div></div>`;return;
  }
  if(mode==="annee"){
    const year=Number(String(selected).slice(0,4))||new Date().getFullYear();
    view.innerHTML=header+`<div class="agenda-calendar-shell">${agendaCalendarSidebar(events,selected)}<main class="agenda-calendar-main"><div class="agenda-calendar-toolbar"><h1>${year}</h1><div><button onclick="navigate('agenda/annee/${year-1}-01-01')">‹</button><button onclick="navigate('agenda/annee/${td}')">Aujourd’hui</button><button onclick="navigate('agenda/annee/${year+1}-01-01')">›</button></div></div><div class="agenda-year-grid">${Array.from({length:12},(_,m)=>agendaMiniMonth(year,m,events,selected)).join("")}</div></main></div></div>`;return;
  }
  if(mode==="rappels"){
    const reminders=events.filter(agendaEventIsReminderDue);
    view.innerHTML=header+`<div class="agenda-grid-main"><section class="agenda-panel"><h2>Rappels à traiter</h2>${reminders.length?reminders.map(e=>agendaEventCard(e)).join(""):`<div class="agenda-empty">Aucun rappel en attente.</div>`}</section></div></div>`;
    return;
  }
  if(mode==="liste"){
    const filter=(sessionStorage.getItem("agendaFilter")||"tous");
    const filtered=filter==="aujourdhui"?todayRows:filter==="retard"?overdue:filter==="termine"?done:events;
    view.innerHTML=header+`<div class="agenda-list-toolbar"><select class="select" onchange="sessionStorage.setItem('agendaFilter',this.value);renderView()"><option value="tous" ${filter==="tous"?"selected":""}>Tous les événements</option><option value="aujourdhui" ${filter==="aujourdhui"?"selected":""}>Aujourd'hui</option><option value="retard" ${filter==="retard"?"selected":""}>En retard</option><option value="termine" ${filter==="termine"?"selected":""}>Terminés</option></select><input class="input" placeholder="Rechercher..." oninput="filterTable(this.value)"></div><section class="agenda-panel">${filtered.length?filtered.map(e=>agendaEventCard(e)).join(""):`<div class="agenda-empty">Aucun événement.</div>`}</section></div>`;
    return;
  }
  if(mode==="dashboard"){
    const dayEvents=events.filter(e=>e.date===selected),hours=Array.from({length:16},(_,i)=>String(i+5).padStart(2,"0")+":00");
    view.innerHTML=header+`<div class="agenda-calendar-shell">${agendaCalendarSidebar(events,selected)}<main class="agenda-calendar-main"><div class="agenda-calendar-toolbar"><div><h1>${new Date(selected+"T00:00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"})}</h1><p>${new Date(selected+"T00:00:00").toLocaleDateString("fr-FR",{weekday:"long"})}</p></div><div><button onclick="navigate('agenda/dashboard/${agendaDateOffset(selected,-1)}')">‹</button><button onclick="navigate('agenda/dashboard/${td}')">Aujourd’hui</button><button onclick="navigate('agenda/dashboard/${agendaDateOffset(selected,1)}')">›</button></div></div><div class="agenda-day-view"><section><div class="agenda-day-all"><span>toute la journée</span><div>${dayEvents.filter(e=>!e.heureDebut).map(agendaCalendarEvent).join("")}</div></div>${hours.map(h=>`<div class="agenda-day-hour"><time>${h}</time><div>${dayEvents.filter(e=>e.heureDebut&&e.heureDebut.slice(0,2)===h.slice(0,2)).map(agendaCalendarEvent).join("")}</div></div>`).join("")}</section><aside><h3>Événements du jour</h3>${dayEvents.length?dayEvents.map(e=>agendaEventCard(e,true)).join(""):`<p>Aucun événement sélectionné</p>`}</aside></div></main></div></div>`;return;
  }
  const automatic=events.filter(e=>e.automatic&&!agendaEventIsDone(e));
  const contracts=automatic.filter(e=>e.type==="contrat");const trials=automatic.filter(e=>e.type==="essai");
  view.innerHTML=header+`<div class="agenda-workspace">
    <aside class="agenda-sidebar-panel"><h3>Navigation</h3>
      <button class="active" onclick="navigate('agenda/dashboard')"><span>Aujourd'hui</span><b>${todayRows.length}</b></button>
      <button onclick="navigate('agenda/semaine')"><span>Cette semaine</span><b>${events.filter(e=>e.date>=agendaWeekStart(td)&&e.date<=agendaDateOffset(agendaWeekStart(td),6)&&!agendaEventIsDone(e)).length}</b></button>
      <button class="danger" onclick="sessionStorage.setItem('agendaFilter','retard');navigate('agenda/liste')"><span>En retard</span><b>${overdue.length}</b></button>
      <button onclick="navigate('agenda/rappels')"><span>Alertes automatiques</span><b>${automatic.length}</b></button>
      <button onclick="sessionStorage.setItem('agendaFilter','termine');navigate('agenda/liste')"><span>Terminées</span><b>${done.length}</b></button>
      <div class="agenda-sidebar-separator"></div><button class="agenda-create-side" onclick="openAgendaEventModal()">＋ Nouvelle tâche</button>
    </aside>
    <main class="agenda-main-panel"><div class="agenda-main-toolbar"><div><h2>Planning prioritaire</h2><p>Tâches du jour, retards et prochaines échéances</p></div><div class="agenda-quick-filters"><button class="active">Tout</button><button onclick="navigate('agenda/rappels')">Automatique</button><button onclick="navigate('agenda/liste')">Manuel</button></div></div>
      ${overdue.length?`<section class="agenda-stream-section urgent"><h3>En retard <span>${overdue.length}</span></h3>${agendaCompactRows(overdue,"Aucun retard")}</section>`:""}
      <section class="agenda-stream-section"><h3>Aujourd'hui <span>${todayRows.length}</span></h3>${agendaCompactRows(todayRows,"Aucune action aujourd'hui.")}</section>
      <section class="agenda-stream-section"><h3>Prochaines échéances <span>${upcoming.length}</span></h3>${agendaCompactRows(upcoming.slice(0,20),"Aucune échéance à venir.")}</section>
    </main>
    <aside class="agenda-summary-panel"><h3>Résumé</h3>
      <div class="agenda-summary-stat blue"><span>Actions du jour</span><b>${todayRows.length}</b></div>
      <div class="agenda-summary-stat red"><span>Urgences / retards</span><b>${overdue.length}</b></div>
      <div class="agenda-summary-stat orange"><span>Fins de contrat</span><b>${contracts.length}</b></div>
      <div class="agenda-summary-stat purple"><span>Fins d'essai</span><b>${trials.length}</b></div>
      <div class="agenda-summary-list"><h4>7 prochains jours</h4>${upcoming.filter(e=>e.date<=agendaDateOffset(td,7)).slice(0,8).map(e=>`<button onclick="${e.automatic?`navigate('${escapeHTML(e.route||"agenda/dashboard")}')`:`openAgendaEventModal('${escapeHTML(e.id)}')`}"><i style="background:${agendaEventTypeMeta(e.type).color}"></i><span>${escapeHTML(e.titre||"")}<small>${formatDate(e.date)}</small></span></button>`).join("")||`<p>Aucune échéance.</p>`}</div>
    </aside>
  </div></div>`;
}

function openAgendaEventModal(id){
  const e=(db.agendaEvents||[]).find(x=>String(x.id)===String(id))||null;
  const soc=currentStructureSocieteFilter()||session?.societe||e?.societe||"";
  const users=(db.users||[]).map(u=>u.nom||u.username).filter(Boolean);
  if(e?.automatic){toast("Cette échéance est alimentée automatiquement par le module source.","info");return}
  openModal(`<h3 class="font-bold text-lg mb-4">${e?"Modifier la tâche":"Nouvelle tâche"}</h3>
    <form onsubmit="event.preventDefault();saveAgendaEvent('${escapeHTML(e?.id||"")}',this)">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="md:col-span-2"><label class="label">Titre *</label><input class="input" name="titre" required value="${escapeHTML(e?.titre||"")}"></div>
        <div><label class="label">Date *</label><input class="input" type="date" name="date" required value="${escapeHTML(e?.date||today())}"></div>
        <div><label class="label">Type</label><select class="select" name="type">${["tache","reunion","rappel","echeance","mission","personnel"].map(t=>`<option value="${t}" ${String(e?.type||"tache")===t?"selected":""}>${escapeHTML(agendaEventTypeMeta(t).label)}</option>`).join("")}</select></div>
        <div><label class="label">Heure début</label><input class="input" type="time" name="heureDebut" value="${escapeHTML(e?.heureDebut||"")}"></div>
        <div><label class="label">Heure fin</label><input class="input" type="time" name="heureFin" value="${escapeHTML(e?.heureFin||"")}"></div>
        <div><label class="label">Responsable</label><input class="input" name="responsable" list="agenda-users" value="${escapeHTML(e?.responsable||session?.nom||"")}"><datalist id="agenda-users">${users.map(u=>`<option value="${escapeHTML(u)}">`).join("")}</datalist></div>
        <div><label class="label">Lieu</label><input class="input" name="lieu" value="${escapeHTML(e?.lieu||"")}"></div>
        <div><label class="label">Société</label><input class="input" name="societe" value="${escapeHTML(soc)}" ${session?.societe?"readonly":""}></div>
        <div><label class="label">Statut</label><select class="select" name="statut">${["planifie","termine","annule"].map(s=>`<option value="${s}" ${String(e?.statut||"planifie")===s?"selected":""}>${s==="planifie"?"Planifié":s==="termine"?"Terminé":"Annulé"}</option>`).join("")}</select></div>
        <div><label class="label">Priorité</label><select class="select" name="priority">${["basse","normale","haute","urgente"].map(p=>`<option value="${p}" ${String(e?.priority||"normale")===p?"selected":""}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join("")}</select></div>
        <div><label class="label">Rappel</label><select class="select" name="rappelAvant"><option value="0">À l'échéance</option><option value="1" ${Number(e?.rappelAvant)===1?"selected":""}>1 jour avant</option><option value="3" ${Number(e?.rappelAvant)===3?"selected":""}>3 jours avant</option><option value="7" ${Number(e?.rappelAvant)===7?"selected":""}>7 jours avant</option></select></div>
        <div class="md:col-span-2"><label class="label">Description</label><textarea class="input" name="description" rows="4">${escapeHTML(e?.description||"")}</textarea></div>
      </div>
      <div class="flex justify-between gap-2 mt-4 flex-wrap">
        <div>${e?`<button type="button" class="btn btn-danger" onclick="deleteAgendaEvent('${escapeHTML(e.id)}')">Supprimer</button>`:""}</div>
        <div class="flex gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer</button></div>
      </div>
    </form>`);
}

function saveAgendaEvent(id,form){
  if(!Array.isArray(db.agendaEvents))db.agendaEvents=[];
  const fd=new FormData(form);
  let e=id?(db.agendaEvents||[]).find(x=>String(x.id)===String(id)):null;
  if(!e){e={id:uid("ag_ev"),createdAt:new Date().toISOString(),createdBy:session?.username||""};db.agendaEvents.unshift(e)}
  Object.assign(e,{
    titre:String(fd.get("titre")||"").trim(),
    date:fd.get("date")||today(),
    type:fd.get("type")||"tache",
    priority:fd.get("priority")||"normale",
    rappelAvant:Number(fd.get("rappelAvant")||0),
    heureDebut:fd.get("heureDebut")||"",
    heureFin:fd.get("heureFin")||"",
    responsable:String(fd.get("responsable")||"").trim(),
    lieu:String(fd.get("lieu")||"").trim(),
    societe:String(fd.get("societe")||"").trim(),
    statut:fd.get("statut")||"planifie",
    description:String(fd.get("description")||"").trim(),
    updatedAt:new Date().toISOString(),
    updatedBy:session?.username||""
  });
  saveDB();closeModal();toast("Événement agenda enregistré","success");renderView();
}

function completeAgendaEvent(id){
  const e=(db.agendaEvents||[]).find(x=>String(x.id)===String(id));if(!e)return;
  e.statut="termine";e.completedAt=new Date().toISOString();e.completedBy=session?.username||"";e.updatedAt=e.completedAt;
  saveDB();toast("Tâche terminée","success");renderView();
}

function deleteAgendaEvent(id){
  if(!confirm("Supprimer cet événement agenda ?"))return;
  db.agendaEvents=(db.agendaEvents||[]).filter(e=>String(e.id)!==String(id));
  saveDB();closeModal();toast("Événement supprimé","success");renderView();
}

SGDIModules.registerModule({key: "agenda", routes: ["agenda"], dependencies: [], init: function(){}, destroy: function(){}});
