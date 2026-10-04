/* Shared Attendance workspace renderer. Data, codes, summaries and permissions are server-owned.
   Transport/context are injected; no alternate BEO business rules or persistence. */
(function () {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const tabs = [["daily","Feuille quotidienne"],["auto","Saisie automatique"],["planning","Planning 7 jours"],["agent","Récap par agent"],["society","Récap par société"],["stats","Statistiques"],["legend","Légende & codes"]];
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 2v4m8-4v4M4 9h16M8 13h3m3 0h2m-8 4h3"/></svg>`;
  window.AttendanceWorkspace = { mount(container, ctx) {
    let alive=true, seq=0, timer, data=null, selected=null, tab="auto", page=1, pageSize=10, q="", status="", saving=false;
    const now=new Date(), today=iso(now), draft=new Map();
    let month=ctx.month || today.slice(0,7), activeDate=today, weekStart=1;
    container.innerHTML=`<section class="aw" aria-label="Pointage du personnel">
      <div class="aw-heading"><div><p class="aw-eyebrow">${esc(ctx.office)}</p><h1>Pointage du personnel</h1><p>Suivi et saisie des pointages <span id="aw-perimeter"></span></p></div>
        <div class="aw-context"><div id="aw-scope-slot"></div><label class="aw-month"><span>${icon()} Mois</span><input id="aw-month" type="month" value="${month}" aria-label="Mois du pointage"></label><div class="aw-month-nav"><button data-shift="-1" aria-label="Mois précédent">‹</button><button data-shift="1" aria-label="Mois suivant">›</button></div></div></div>
      <div class="aw-kpis" id="aw-kpis" aria-live="polite"></div>
      <nav class="aw-tabs" aria-label="Vues du pointage">${tabs.map(([k,l])=>`<button data-tab="${k}" role="tab" aria-selected="${k===tab}">${icon()}${l}</button>`).join("")}</nav>
      <section class="aw-card"><header class="aw-toolbar"><div><h2 id="aw-title"></h2><p id="aw-subtitle"></p></div><div class="aw-controls">
        <input id="aw-search" type="search" placeholder="Rechercher un agent…" aria-label="Rechercher nom, prénom ou matricule">
        <select id="aw-status" aria-label="Statut de l’employé"><option value="">Tous les statuts</option></select>
        <input id="aw-date" type="date" value="${activeDate}" aria-label="Date active">
        <select id="aw-actions" aria-label="Actions"><option value="">Actions</option><option value="refresh">Actualiser</option><option value="close">Clôturer la journée active</option></select>
        <button class="aw-primary" id="aw-save">${icon()} Enregistrer</button></div></header>
        <div id="aw-message" role="status" aria-live="polite"></div>
        <div class="aw-mobile-period"><button data-week="-7" aria-label="Semaine précédente">‹</button><span id="aw-period"></span><button data-week="7" aria-label="Semaine suivante">›</button></div>
        <div id="aw-content" aria-busy="true"><p class="aw-empty">Chargement du pointage…</p></div>
        <div id="aw-pagination"></div><div id="aw-legend" class="aw-legend"></div>
      </section><div class="aw-bottom"><section><b>${icon()} Raccourcis clavier</b><p>Sélectionnez une cellule, puis utilisez P, A, M, C ou R. La saisie reste soumise à vos droits.</p></section><section class="aw-tip"><b>Astuce</b><p>Choisissez le statut d’une cellule, puis enregistrez. Les corrections après clôture nécessitent une autorisation et un motif.</p></section></div>
      <dialog class="aw-picker" id="aw-picker"><form method="dialog"><h3 id="aw-picker-title">Statut du jour</h3><div id="aw-picker-codes"></div><button value="cancel">Annuler</button></form></dialog></section>`;
    ctx.placeScope?.(container.querySelector("#aw-scope-slot"));
    const $ = s => container.querySelector(s);
    const monthLabel = () => new Date(month+"-01T12:00:00").toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
    const notice = (text,error=false) => {$("#aw-message").textContent=text;$("#aw-message").className=error?"aw-error":"";};
    function codeCfg(cell) {return data.codes.find(c=>c.status===cell.status);}
    function canEdit(cell) {return cell.available && (!cell.closed || data.permissions.validate) && data.permissions.create && (!cell.presence_id || data.permissions.update) && Boolean(codeCfg(cell) || !cell.recorded);}
    function cellAt(eid,date) {return data.items.find(r=>r.employee_id===Number(eid))?.days.find(c=>c.date===date);}
    function shown(cell,eid) {return draft.get(`${eid}:${cell.date}`)?.status || cell.status;}
    function code(status) {return data.codes.find(c=>c.status===status)?.code || "·";}
    function renderKpis() {
      const s=data.summary;
      const kpis=[["Agents",s.agents,"agents",null],["Journées renseignées",s.recorded,"recorded",s.completion],["Présences",s.present,"present",null],["Absences",s.absent,"absent",null],["Anomalies",s.anomalies,"maladie",null]];
      $("#aw-perimeter").textContent=` · Périmètre : ${ctx.siteCount()} site(s) · ${s.agents} agent(s)`;
      $("#aw-kpis").innerHTML=kpis.map(([l,v,t,p])=>`<article class="aw-kpi"><i class="aw-tone-${t}">${icon()}</i><div><b>${v}</b><span>${l}</span>${p!==null?`<small>${p}%</small><div class="aw-track"><em style="width:${p}%"></em></div>`:""}</div></article>`).join("")+`<article class="aw-kpi aw-completion"><div class="aw-donut" style="--percent:${s.completion}%" role="img" aria-label="Complétude ${s.completion}%"><b>${s.completion}%</b></div><div><strong>Complétude</strong><span>${esc(monthLabel())}</span></div></article>`;
    }
    function cellHtml(cell,row) {
      const st=shown(cell,row.employee_id), dirty=draft.has(`${row.employee_id}:${cell.date}`), isSelected=selected?.eid===row.employee_id&&selected?.date===cell.date;
      const cal=data.calendar.find(d=>d.date===cell.date);
      return `<td class="${cal.weekend?"aw-weekend":""} ${cell.date===activeDate?"aw-active-date":""}"><button class="aw-cell aw-tone-${esc(st)} ${dirty?"aw-dirty":""} ${isSelected?"aw-selected":""}" data-cell="${row.employee_id}" data-date="${cell.date}" ${!canEdit(cell)?"disabled":""} title="${esc(cell.date+' · '+(codeCfg({...cell,status:st})?.label||'Non renseigné')+(cell.closed?' · Journée clôturée':'')+(cell.anomalies?.length?' · Anomalie':''))}" aria-label="${esc(row.name+' '+cell.date+' '+(codeCfg({...cell,status:st})?.label||'Non renseigné'))}">${cell.available?esc(code(st)):"—"}${cell.closed?'<span class="aw-lock" aria-label="Verrouillé">⌑</span>':""}</button></td>`;
    }
    function grid() {
      let dates=data.calendar;
      if(tab==="daily") dates=dates.filter(d=>d.date===activeDate);
      if(tab==="planning") dates=dates.filter(d=>d.day>=weekStart&&d.day<weekStart+7);
      const desktopDays=dates.map(d=>`<th class="${d.weekend?'aw-weekend':''} ${d.date===activeDate?'aw-active-date':''}" data-day="${d.day}">${String(d.day).padStart(2,"0")}<small>${['L','M','M','J','V','S','D'][d.weekday]}</small></th>`).join("");
      const rows=data.items.map((r,i)=>`<tr><td class="aw-fixed-number">${(page-1)*pageSize+i+1}</td><td class="aw-fixed-agent"><div class="aw-agent"><span>${esc(r.name.split(/\s+/).filter(Boolean).slice(0,2).map(n=>n[0]).join(''))}</span><div><b>${esc(r.name)}</b>${ctx.siteCount()>1?`<small>${esc(r.site)}</small>`:''}</div></div></td><td class="aw-fixed-code">${esc(r.code)}</td>${dates.map(d=>{const c=r.days.find(x=>x.date===d.date);return tab==='planning'?`<td class="aw-plan ${d.weekend?'aw-weekend':''}"><span>${esc(c.planning?.known?(c.planning.working===false?'Repos':c.planning.period||'Service'):'—')}</span><small>${esc(c.planning?.start_time||'')} ${esc(c.planning?.end_time||'')}</small></td>`:cellHtml(c,r);}).join('')}${tab==='planning'?'':data.codes.map(c=>`<td class="aw-total">${r.totals[c.status]||0}</td>`).join('')+`<td class="aw-percent"><span class="aw-track"><em style="width:${r.totals.completion}%"></em></span>${r.totals.completion}%</td>`}</tr>`).join('');
      const mobile=data.items.map(r=>`<article class="aw-mobile-agent"><header><b>${esc(r.name)}</b><small>${esc(r.code)} · ${esc(r.site)}</small></header><div class="aw-mobile-days">${dates.filter(d=>tab==='daily'||(d.day>=weekStart&&d.day<weekStart+7)).map(d=>{const c=r.days.find(c=>c.date===d.date);return `<div class="${d.weekend?'aw-weekend':''}"><small>${String(d.day).padStart(2,'0')} ${['L','M','M','J','V','S','D'][d.weekday]}</small>${tab==='planning'?`<span>${esc(c.planning?.known?(c.planning.working===false?'Repos':c.planning.period||'Service'):'—')}</span>`:cellHtml(c,r).replace(/^<td[^>]*>|<\/td>$/g,'')}</div>`;}).join('')}</div></article>`).join('');
      return `<div class="aw-grid-scroll" tabindex="0" aria-label="Grille mensuelle, défilement horizontal"><table class="aw-grid"><thead><tr><th class="aw-fixed-number">#</th><th class="aw-fixed-agent">Agent</th><th class="aw-fixed-code">Code</th>${desktopDays}${tab==='planning'?'':data.codes.map(c=>`<th title="${esc(c.label)}">${c.code}</th>`).join('')+'<th>%</th>'}</tr></thead><tbody>${rows}</tbody></table></div><div class="aw-mobile-grid">${mobile}</div>`;
    }
    function recap() {
      const rows=tab==='agent'?data.items.map(r=>({label:r.name,code:r.code,...r.totals})):data.societies.map(r=>({label:r.society,code:`${r.agents} agents`,...r}));
      return `<div class="aw-grid-scroll"><table class="aw-recap"><thead><tr><th>${tab==='agent'?'Agent':'Société'}</th><th>Contexte</th>${data.codes.map(c=>`<th>${c.code}</th>`).join('')}<th>Renseignées</th><th>Complétude</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${esc(r.code)}</td>${data.codes.map(c=>`<td>${r[c.status]||0}</td>`).join('')}<td>${r.recorded}/${r.total}</td><td>${r.completion}%</td></tr>`).join('')}</tbody></table></div>`;
    }
    function render() {
      if(!alive||!data)return;
      renderKpis();
      $("#aw-title").textContent=`${tabs.find(([k])=>k===tab)[1]} — ${monthLabel()}`;
      $("#aw-subtitle").textContent=tab==='auto'?'Renseignez ou corrigez les pointages de vos agents':'Données centrales · périmètre autorisé';
      $("#aw-save").hidden=!['auto','daily'].includes(tab)||!data.permissions.create;
      $("#aw-save").disabled=saving||!draft.size;
      $("#aw-date").hidden=tab!=='daily';
      $("#aw-actions option[value=close]").hidden=!data.permissions.validate;
      $("#aw-status").innerHTML='<option value="">Tous les statuts</option>'+data.employee_statuses.map(s=>`<option ${s===status?'selected':''} value="${esc(s)}">${esc(s)}</option>`).join('');
      container.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-selected',b.dataset.tab===tab);});
      container.querySelector('.aw-mobile-period').classList.toggle('aw-always',tab==='planning');
      $("#aw-period").textContent=`${String(weekStart).padStart(2,'0')} – ${String(Math.min(weekStart+6,data.calendar.length)).padStart(2,'0')} ${monthLabel()}`;
      let content;
      if(tab==='legend') content=`<div class="aw-code-list">${data.codes.map(c=>`<article><b class="aw-cell aw-tone-${c.tone}">${c.code}</b><strong>${esc(c.label)}</strong></article>`).join('')}<p>MI désigne une mission. S (Suspendu) n’est pas un statut de journée Attendance Core. Les workflows congés, maladies et justificatifs restent accessibles depuis leur rubrique.</p><p>Week-end : vendredi et samedi, comme dans le calendrier central. Les rotations configurées restent prioritaires dans le planning.</p></div>`;
      else if(tab==='stats')content=`<div class="aw-stat-list">${data.codes.map(c=>`<div><span>${esc(c.label)}</span><progress max="${data.summary.total||1}" value="${data.counts[c.status]||0}"></progress><b>${data.counts[c.status]||0}</b></div>`).join('')}<p>${data.summary.recorded} journées renseignées sur ${data.summary.total} journées d’affectation · ${data.summary.anomalies} anomalies ouvertes</p></div>`;
      else if(!data.items.length)content='<p class="aw-empty">Aucun agent dans ce périmètre et cette période.</p>';
      else content=['agent','society'].includes(tab)?recap():grid();
      $("#aw-content").innerHTML=content;$("#aw-content").setAttribute('aria-busy','false');
      $("#aw-pagination").innerHTML=['society','stats','legend'].includes(tab)?'':`<span>Affichage de ${data.total?(page-1)*pageSize+1:0} à ${Math.min(page*pageSize,data.total)} sur ${data.total} agents</span><div><button data-page="${page-1}" ${page<=1?'disabled':''} aria-label="Page précédente">‹</button>${Array.from({length:Math.min(5,data.pages)},(_,i)=>Math.max(1,Math.min(page-2,data.pages-4))+i).map(n=>`<button data-page="${n}" class="${n===page?'active':''}">${n}</button>`).join('')}<button data-page="${page+1}" ${page>=data.pages?'disabled':''} aria-label="Page suivante">›</button><select id="aw-size" aria-label="Agents par page">${[10,25,50].map(n=>`<option value="${n}" ${n===pageSize?'selected':''}>${n} / page</option>`).join('')}</select></div>`;
      $("#aw-legend").innerHTML=data.codes.map(c=>`<span><b class="aw-cell aw-tone-${c.tone}">${c.code}</b>${esc(c.label)}</span>`).join('')+'<span><b>·</b>Non renseigné</span><button data-tab="legend">Voir tous les codes →</button>';
    }
    async function load() {
      const token=++seq;$("#aw-content").setAttribute('aria-busy','true');
      try {const result=await ctx.read({month,q,employee_status:status,page,page_size:pageSize});if(!alive||token!==seq)return;data=result;if(page>data.pages){page=data.pages;return load();}render();}
      catch(e){if(alive&&token===seq&&e.name!=='AbortError'){notice(e.message,true);$("#aw-content").innerHTML='<p class="aw-empty">Impossible de charger le pointage. Utilisez Actualiser pour réessayer.</p>';$("#aw-content").setAttribute('aria-busy','false');}}
    }
    function setCell(eid,date,status) {
      const cell=cellAt(eid,date);if(!cell||!canEdit(cell)||!data.codes.some(c=>c.status===status))return;
      const key=`${eid}:${date}`;
      let reason;
      if(cell.closed) { reason=draft.get(key)?.reason || window.prompt('Motif de la correction post-clôture (obligatoire, tracé) :'); if(!reason?.trim())return; }
      if(status===cell.status)draft.delete(key);else draft.set(key,{employee_id:eid,site_id:cell.site_id,presence_date:date,status,...(cell.closed?{presence_id:cell.presence_id,reason:reason.trim()}:{} )});
      selected={eid,date};
      // Patch only this cell (desktop/mobile), never rebuild the grid while entering a code.
      container.querySelectorAll(`[data-cell="${eid}"][data-date="${date}"]`).forEach(b=>{b.textContent=code(status);b.className=`aw-cell aw-tone-${status} aw-selected ${draft.has(key)?'aw-dirty':''}`;});
      $("#aw-save").disabled=!draft.size;notice(`${draft.size} modification(s) à enregistrer`);
    }
    async function save() {
      if(saving||!draft.size)return;saving=true;$("#aw-save").disabled=true;notice('Enregistrement…');
      const epoch=ctx.epoch();
      try {for(const [key,change] of [...draft]) {if(!alive||epoch!==ctx.epoch())throw new Error('Périmètre changé : enregistrement interrompu');if(change.presence_id)await ctx.correct(change.presence_id,{status:change.status,reason:change.reason});else await ctx.write(change);draft.delete(key);}notice('Pointages enregistrés');await load();}
      catch(e){if(alive){notice(e.message,true);await load();}}
      finally {saving=false;if(alive)$("#aw-save").disabled=!draft.size;}
    }
    function discard() {return !draft.size || window.confirm('Des pointages ne sont pas enregistrés. Abandonner ces modifications ?');}
    function shiftMonth(step) {if(!discard())return;draft.clear();const d=new Date(month+'-01T12:00:00');d.setMonth(d.getMonth()+step);month=iso(d).slice(0,7);$("#aw-month").value=month;activeDate=month+'-01';$("#aw-date").value=activeDate;weekStart=1;page=1;load();}
    async function click(e) {
      const b=e.target.closest('button');if(!b||!container.contains(b))return;
      if(b.dataset.tab){tab=b.dataset.tab;render();}
      else if(b.dataset.shift)shiftMonth(Number(b.dataset.shift));
      else if(b.dataset.week){weekStart=Math.max(1,Math.min(data.calendar.length-6,weekStart+Number(b.dataset.week)));render();}
      else if(b.dataset.page){page=Number(b.dataset.page);load();}
      else if(b.id==='aw-save')save();
      else if(b.dataset.cell){selected={eid:Number(b.dataset.cell),date:b.dataset.date};const cell=cellAt(selected.eid,selected.date);if(!canEdit(cell))return;$("#aw-picker-title").textContent=`${data.items.find(r=>r.employee_id===selected.eid).name} · ${selected.date}`;$("#aw-picker-codes").innerHTML=data.codes.map(c=>`<button type="button" data-code="${c.status}" class="aw-tone-${c.tone}"><b>${c.code}</b> ${esc(c.label)}</button>`).join('');const dlg=$("#aw-picker");if(dlg.showModal)dlg.showModal();else dlg.setAttribute('open','');}
      else if(b.dataset.code){setCell(selected.eid,selected.date,b.dataset.code);const dlg=$("#aw-picker");if(dlg.close)dlg.close();else dlg.removeAttribute('open');}
    }
    function keyboard(e) {
      if(!alive||!selected||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
      const cfg=data?.codes.find(c=>c.code===e.key.toUpperCase());if(cfg){e.preventDefault();setCell(selected.eid,selected.date,cfg.status);const dlg=$("#aw-picker");if(dlg.open){if(dlg.close)dlg.close();else dlg.removeAttribute('open');}}
    }
    function change(e) {
      if(e.target.id==='aw-month'){if(!discard()){e.target.value=month;return;}draft.clear();month=e.target.value;activeDate=month+'-01';$("#aw-date").value=activeDate;page=1;weekStart=1;load();}
      if(e.target.id==='aw-status'){status=e.target.value;page=1;load();}
      if(e.target.id==='aw-size'){pageSize=Number(e.target.value);page=1;load();}
      if(e.target.id==='aw-date'){const next=e.target.value;if(!next){e.target.value=activeDate;return;}if(next.slice(0,7)!==month){if(!discard()){e.target.value=activeDate;return;}draft.clear();month=next.slice(0,7);$("#aw-month").value=month;page=1;weekStart=1;}activeDate=next;if(data.month!==month)load();else render();}
      if(e.target.id==='aw-actions'){const action=e.target.value;e.target.value='';if(action==='refresh')load();if(action==='close'&&data.permissions.validate&&!draft.size&&window.confirm('Clôturer la journée active pour ce périmètre ?'))ctx.close(activeDate).then(()=>load()).catch(e=>notice(e.message,true));else if(action==='close'&&draft.size)notice('Enregistrez les modifications avant de clôturer.',true);}
    }
    ctx.registerLeave?.(discard);
    const quick = e => { $("#aw-search").value=e.target.value; q=e.target.value;page=1;clearTimeout(timer);timer=setTimeout(load,180); };
    ctx.quickSearch?.addEventListener("input",quick);
    container.addEventListener('click',click);container.addEventListener('change',change);document.addEventListener('keydown',keyboard);
    $("#aw-search").addEventListener('input',e=>{q=e.target.value;page=1;clearTimeout(timer);timer=setTimeout(load,180);});
    load();
    return () => {ctx.registerLeave?.(null);ctx.quickSearch?.removeEventListener("input",quick);alive=false;++seq;clearTimeout(timer);container.removeEventListener('click',click);container.removeEventListener('change',change);document.removeEventListener('keydown',keyboard);draft.clear();};
  }};
})();
