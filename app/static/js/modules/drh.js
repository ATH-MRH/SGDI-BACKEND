/* Phase 2 — drh. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function drhTabs(active){return ""}

function renderDRHMiseEnDemeure(view){
  const soc=drhActiveSocieteFilter();
  const sortants=(db.agents||[]).filter(a=>a.statut==="sortant"&&!a.finRelationDotationReversee&&a.finRelationAt&&(!soc||!a.societe||a.societe===soc));
  const allDone=(db.agents||[]).filter(a=>a.statut==="sortant"&&a.finRelationDotationReversee&&a.finRelationAt&&(!soc||!a.societe||a.societe===soc));
  const pendingCount=sortants.reduce((n,a)=>n+drhMedPendingCount(a),0);
  const med1Count=sortants.filter(a=>drhMedDaysSince(a.finRelationAt)>=3&&!a.finRelationMed1SentAt).length;
  const med2Count=sortants.filter(a=>a.finRelationMed1SentAt&&drhMedDaysSince(a.finRelationMed1SentAt)>=7&&!a.finRelationMed2SentAt).length;
  const criticalCount=sortants.filter(a=>drhMedDaysSince(a.finRelationAt)>=14&&!a.finRelationDotationReversee).length;
  const rows=sortants.map(a=>{
    const nom=((a.nom||"")+" "+(a.prenom||"")).trim();
    const daysSince=drhMedDaysSince(a.finRelationAt)||0;
    const med1Due=daysSince>=3&&!a.finRelationMed1SentAt;
    const med2Due=a.finRelationMed1SentAt&&drhMedDaysSince(a.finRelationMed1SentAt)>=7&&!a.finRelationMed2SentAt;
    const genDue=a.finRelationMed2SentAt&&drhMedDaysSince(a.finRelationMed2SentAt)>=7&&!a.finRelationGendarmerieSentAt;
    const sent1=a.finRelationMed1SentAt?`<span class="pill pill-green text-xs">MED1 envoyée le ${formatDate(a.finRelationMed1SentAt.slice(0,10))}</span>`:``;
    const sent2=a.finRelationMed2SentAt?`<span class="pill pill-green text-xs">MED2 envoyée le ${formatDate(a.finRelationMed2SentAt.slice(0,10))}</span>`:``;
    const sentG=a.finRelationGendarmerieSentAt?`<span class="pill pill-blue text-xs">Gendarmerie le ${formatDate(a.finRelationGendarmerieSentAt.slice(0,10))}</span>`:``;
    const btns=[];
    if(a.finRelationMed1SentAt)btns.push(`<button class="btn btn-secondary text-xs" onclick="viewMed(event,'${a.id}',1)">Voir MED1</button>`);
    if(a.finRelationMed2SentAt)btns.push(`<button class="btn btn-secondary text-xs" onclick="viewMed(event,'${a.id}',2)">Voir MED2</button>`);
    if(a.finRelationGendarmerieSentAt)btns.push(`<button class="btn btn-secondary text-xs" onclick="viewMed(event,'${a.id}',3)">Voir Gendarmerie</button>`);
    if(med1Due)btns.push(`<button class="btn btn-danger text-xs" onclick="genMed(event,'${a.id}',1)">Émettre MED n°1</button>`);
    if(med2Due)btns.push(`<button class="btn btn-danger text-xs" onclick="genMed(event,'${a.id}',2)">Émettre MED n°2</button>`);
    if(genDue)btns.push(`<button class="btn btn-danger text-xs" onclick="genMed(event,'${a.id}',3)">Lettre Gendarmerie</button>`);
    if(!med1Due&&!med2Due&&!genDue&&!a.finRelationMed1SentAt){
      const jRestants=3-daysSince;
      btns.push(`<span class="text-xs text-slate-400">MED1 disponible dans ${jRestants} j</span>`);
    }
    const stage=genDue?"gendarmerie":med2Due||a.finRelationMed1SentAt?"med2":"med1";
    const stageLabel=genDue?"Lettre Gendarmerie requise":med2Due?"MED n°2 requise":med1Due?"MED n°1 en retard":a.finRelationMed1SentAt?"MED n°2 en attente":"MED n°1 à venir";
    const progress1=a.finRelationMed1SentAt?"done":med1Due?"current":"";
    const progress2=a.finRelationMed2SentAt?"done":med2Due?"current":"";
    const progress3=a.finRelationGendarmerieSentAt?"done":genDue?"current":"";
    const initials=((a.nom||"").slice(0,1)+(a.prenom||"").slice(0,1)).toUpperCase()||"?";
    return `<article class="drh-med-case" data-med-row data-stage="${stage}" data-q="${escapeHTML((nom+" "+(a.matricule||"")+" "+(a.societe||"")).toLowerCase())}">
      <div class="drh-med-person"><div class="drh-med-avatar">${a.photo?`<img src="${a.photo}" alt=""/>`:escapeHTML(initials)}</div><div><strong>${escapeHTML(nom)}</strong><span>${escapeHTML(a.matricule||"—")} · sorti le ${formatDate(a.dateSortie||a.finRelationAt||"")}</span></div></div>
      <div class="drh-med-time"><strong>${Math.max(0,daysSince)} jours écoulés</strong><div class="drh-med-progress" aria-label="Progression de la procédure"><i class="${progress1}"></i><i class="${progress2}"></i><i class="${progress3}"></i></div></div>
      <div class="drh-med-stage ${med1Due||med2Due||genDue?"urgent":""}"><b><i></i>${escapeHTML(stageLabel)}</b><span>${sent1||sent2||sentG||"Dotation non restituée"}</span></div>
      <div class="drh-med-case-actions">${btns.join("")}</div>
    </article>`;
  }).join("");
  view.innerHTML=`<div class="drh-med-page">
    <header class="drh-med-head"><div><h1>Mises en demeure</h1><p>Pilotage des restitutions de dotation après fin de relation de travail</p></div><div class="drh-med-head-actions"><button type="button" class="btn btn-secondary" onclick="exportDRHMiseEnDemeure()">Exporter</button><span class="pill ${pendingCount?"pill-red":"pill-green"}">${pendingCount} action(s) requise(s)</span></div></header>
    <section class="drh-med-stats">
      <div><span>Procédures ouvertes</span><strong>${sortants.length}</strong><small>Dossiers à suivre</small></div>
      <div><span>MED n°1 à émettre</span><strong>${med1Count}</strong><small>Action immédiate</small></div>
      <div><span>MED n°2 à émettre</span><strong>${med2Count}</strong><small>Échéance dépassée</small></div>
      <div><span>Dossiers clôturés</span><strong>${allDone.length}</strong><small>Historique complet</small></div>
    </section>
    <section class="drh-med-workflow">
      <div><b><i>1</i>MED n°1</b><span>72 h après sortie</span><p>Première demande formelle de restitution du matériel.</p></div>
      <div><b><i>2</i>MED n°2</b><span>J+7</span><p>Relance automatique si la dotation reste non restituée.</p></div>
      <div><b><i>3</i>Lettre Gendarmerie</b><span>J+14</span><p>Dernière étape avec dossier et pièces justificatives.</p></div>
    </section>
    <section class="drh-med-tools"><div class="drh-med-search"><span>⌕</span><input id="drh-med-search" placeholder="Employé ou code…" oninput="filterDRHMiseEnDemeure()"/></div><select id="drh-med-stage" onchange="filterDRHMiseEnDemeure()"><option value="">Toutes les étapes</option><option value="med1">MED n°1</option><option value="med2">MED n°2</option><option value="gendarmerie">Lettre Gendarmerie</option></select><button type="button" class="btn btn-ghost" onclick="resetDRHMiseEnDemeureFilters()">Réinitialiser</button></section>
    <main class="drh-med-layout"><section class="drh-med-cases">${rows||`<div class="card p-8 text-center text-slate-500">Aucun dossier en instance de mise en demeure.</div>`}</section><aside class="drh-med-aside">
      <section><h2>À traiter aujourd’hui</h2>${sortants.filter(a=>drhMedPendingCount(a)>0).slice(0,4).map(a=>`<a href="#/agents/${employeeRouteId(a)}"><strong>${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())}</strong><span>${drhMedPendingCount(a)} action(s) requise(s)</span></a>`).join("")||`<p>Aucune action urgente.</p>`}</section>
      <section><h2>Contrôles automatiques</h2><div><strong>Dotations non restituées</strong><span>${sortants.length}</span></div><div><strong>Échéances critiques</strong><span>${criticalCount}</span></div><div><strong>Dossiers clôturés</strong><span>${allDone.length}</span></div></section>
    </aside></main>
    <footer class="drh-med-footer"><span id="drh-med-count">${sortants.length}</span> procédure(s) affichée(s) · données PostgreSQL</footer>
  </div>`;
}

function filterDRHMiseEnDemeure(){
  const q=(document.getElementById("drh-med-search")?.value||"").trim().toLowerCase();
  const stage=document.getElementById("drh-med-stage")?.value||"";let shown=0;
  document.querySelectorAll("[data-med-row]").forEach(row=>{const ok=(!q||(row.dataset.q||"").includes(q))&&(!stage||row.dataset.stage===stage);row.hidden=!ok;if(ok)shown++});
  const count=document.getElementById("drh-med-count");if(count)count.textContent=shown;
}

function resetDRHMiseEnDemeureFilters(){const q=document.getElementById("drh-med-search"),s=document.getElementById("drh-med-stage");if(q)q.value="";if(s)s.value="";filterDRHMiseEnDemeure()}

function exportDRHMiseEnDemeure(){
  const rows=[["Employé","Code","Société","Date sortie","Jours écoulés","MED n°1","MED n°2","Gendarmerie"],...[...(db.agents||[])].filter(a=>a.statut==="sortant"&&!a.finRelationDotationReversee&&a.finRelationAt).map(a=>[((a.nom||"")+" "+(a.prenom||"")).trim(),a.matricule||"",a.societe||"",a.dateSortie||String(a.finRelationAt||"").slice(0,10),drhMedDaysSince(a.finRelationAt)||0,a.finRelationMed1SentAt||"",a.finRelationMed2SentAt||"",a.finRelationGendarmerieSentAt||""])];
  if(rows.length===1)return toast("Aucune procédure à exporter","warn");
  paieDownloadCSV(rows,"mises_en_demeure_"+today()+".csv");
}

async function genMed(evt,agentId,num){
  evt&&evt.stopPropagation();
  const a=(db.agents||[]).find(x=>x.id===agentId);if(!a)return;
  const nom=((a.nom||"")+" "+(a.prenom||"")).trim();
  const now=new Date().toISOString();
  if(num===1){a.finRelationMed1SentAt=now;a.finRelationMed1Date=today();}
  else if(num===2){a.finRelationMed2SentAt=now;a.finRelationMed2Date=today();}
  else{a.finRelationGendarmerieSentAt=now;a.finRelationGendramerieDate=today();}
  try{if(a.backendId)await SGDI.employees.update(a.backendId,employeeApiPayload(a));}
  catch(e){console.warn("genMed save failed",e);}
  saveDB();
  openMedPrintWindow(a,num);
  renderSidebar();renderView();
}

function viewMed(evt,agentId,num){
  evt&&evt.stopPropagation();
  const a=(db.agents||[]).find(x=>String(x.id)===String(agentId)||String(x.backendId||"")===String(agentId));
  if(!a)return toast("Dossier introuvable","error");
  const sentAt=num===1?a.finRelationMed1SentAt:num===2?a.finRelationMed2SentAt:a.finRelationGendarmerieSentAt;
  if(!sentAt)return toast("Document non émis","warn");
  openMedPrintWindow(a,num,{date:String(sentAt).slice(0,10)});
}

function openMedPrintWindow(a,num,opt={}){
  const nom=((a.nom||"")+" "+(a.prenom||"")).trim();
  const emittedAt=num===1?a.finRelationMed1SentAt:num===2?a.finRelationMed2SentAt:a.finRelationGendarmerieSentAt;
  const dateDoc=opt.date||String(emittedAt||"").slice(0,10)||today();
  const ref="MED"+num+"-"+(a.matricule||a.id||"SGDI")+"-"+dateDoc.replaceAll("-","");
  const isBrigade=num===3;
  const titre=isBrigade?"LETTRE ADRESSÉE À LA BRIGADE DE GENDARMERIE":("MISE EN DEMEURE N°"+num);
  const objet=isBrigade
    ?`Monsieur le Commandant de Brigade,\n\nNous avons l'honneur de porter à votre connaissance que Monsieur/Madame <b>${escapeHTML(nom)}</b>, titulaire du matricule <b>${escapeHTML(a.matricule||"—")}</b>, anciennement employé(e) de notre société, a fait l'objet d'une décision de fin de contrat le <b>${formatDate(a.dateSortie||"")}</b>.\n\nMalgré deux mises en demeure successives, en date du <b>${formatDate(a.finRelationMed1Date||"")}</b> et du <b>${formatDate(a.finRelationMed2Date||"")}</b>, l'intéressé(e) n'a pas procédé au reversement de la dotation matérielle qui lui a été attribuée dans le cadre de ses fonctions, estimée à <b>${a.stcDeductionReforme?money(a.stcDeductionReforme):"un montant à déterminer"}</b>.\n\nNous sollicitons votre intervention afin de récupérer le matériel de la société et prendre les mesures légales qui s'imposent.`
    :`Par la présente, nous mettons en demeure Monsieur/Madame <b>${escapeHTML(nom)}</b>, matricule <b>${escapeHTML(a.matricule||"—")}</b>, ex-employé(e) de notre société, de procéder au reversement de l'intégralité de la dotation matérielle mise à sa disposition dans le cadre de ses fonctions.\n\nDans le cas où il ne serait pas procédé audit reversement dans un délai de <b>7 (sept) jours</b> à compter de la date de la présente, nous nous verrions dans l'obligation de saisir les autorités compétentes pour le recouvrement du matériel et des sommes dues.`;
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${titre}</title>
<style>@page{size:A4 portrait;margin:20mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font-family:"Times New Roman",Times,serif;font-size:13.5px;line-height:1.6}
.actions{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:8px;background:#fff;border-bottom:1px solid #e2e8f0;margin-bottom:8mm}
.actions button{border:0;border-radius:8px;background:#043970;color:#fff;font:700 13px Arial;padding:8px 16px;cursor:pointer}
.doc{width:170mm;margin:0 auto}
.logo{width:30mm;height:30mm;object-fit:contain;display:block;margin:0 auto 6mm}
.ref{text-align:right;font-size:11px;font-family:Arial,sans-serif;margin-bottom:8mm;color:#475569}
.title{text-align:center;font-size:17px;font-weight:900;text-transform:uppercase;letter-spacing:.2px;font-family:Arial,sans-serif;margin:0 0 8mm;text-decoration:underline}
.objet{margin:0 0 8mm;font-family:Arial,sans-serif;font-size:12px}<b>.objet b{font-family:inherit}</b>
.body{text-align:justify;margin-bottom:8mm}
.sign{margin-top:18mm;text-align:right;font-weight:900;font-family:Arial,sans-serif}
.footer{border-top:1px solid #d7dde8;margin-top:10mm;padding-top:3mm;text-align:center;font-size:9px;font-family:Arial,sans-serif;color:#475569}
@media print{.actions{display:none!important}}
</style></head><body>
<div class="actions no-print"><button onclick="window.print()">Imprimer</button><button onclick="window.close()" style="background:#64748b">Fermer</button></div>
<div class="doc">
  ${sgdiDocumentLogoHTML(a.societe,"logo")}
  <div class="ref"><b>Réf :</b> ${escapeHTML(ref)}<br><b>Date :</b> ${formatDate(dateDoc)}</div>
  ${isBrigade?`<div class="objet"><b>À Monsieur le Commandant de Brigade de Gendarmerie</b></div>`:`<div class="objet"><b>À l'attention de :</b> ${escapeHTML(nom)}<br><b>Ancien matricule :</b> ${escapeHTML(a.matricule||"—")}</div>`}
  <div class="title">${titre}</div>
  <div class="body"><p>${objet}</p>
  <p>Veuillez agréer, ${isBrigade?"Monsieur le Commandant,":"Monsieur/Madame,"} l'expression de nos sincères salutations.</p></div>
  <div class="sign">La Direction Générale</div>
  <div class="footer">${escapeHTML(a.societe||"SGDI")} — ${titre} · ${escapeHTML(ref)} · ${formatDate(dateDoc)}</div>
</div></body></html>`;
  const w=window.open("","_blank","width=860,height=700");
  if(w){w.document.write(html);w.document.close();}else{toast("Impression bloquée par le navigateur","warn");}
}



function renderDRHReversementEnAttente(view){
  const soc=drhActiveSocieteFilter();
  const now=new Date();
  const agents=(db.agents||[]).filter(a=>{
    if(!EMPLOYEE_FORMER_STATUS_KEYS.has(employeeStatusKey(a.statut||a.status||"")))return false;
    if(a.finRelationDotationReversee)return false;
    const dotation=a.dotation||a.dotationCourante;
    if(!dotation&&!(a.dotations&&a.dotations.length))return false;
    if(soc&&a.societe!==soc)return false;
    return true;
  });
  function elapsedH(a){return a.finRelationAt?Math.floor((now-new Date(a.finRelationAt))/3600000):null;}
  const alerte72=agents.filter(a=>elapsedH(a)!==null&&elapsedH(a)>=72);
  const enCours=agents.filter(a=>elapsedH(a)===null||elapsedH(a)<72);
  function row(a){
    const nom=escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim().toUpperCase());
    const mat=escapeHTML(a.matricule||"—");
    const h=elapsedH(a);
    const is72=h!==null&&h>=72;
    const delaiLabel=h===null?"—":is72
      ?`<span class="pill pill-red text-xs font-black" style="animation:fpLampBlink 0.9s ease-in-out infinite">⚠ +${h}h</span>`
      :`<span class="pill pill-amber text-xs">${h}h</span>`;
    const dateSortie=escapeHTML(formatDate(a.dateSortie||a.finRelationAt||""));
    const motif=escapeHTML(a.finRelationMotif||"—");
    const dotationDesc=(()=>{
      const d=a.dotation||a.dotationCourante;
      if(d&&typeof d==="object"){
        const items=Array.isArray(d.articles)?d.articles:Array.isArray(d.items)?d.items:[];
        if(items.length)return escapeHTML(items.map(i=>i.designation||i.nom||i.label||"").filter(Boolean).join(", "));
        return escapeHTML(d.description||d.label||JSON.stringify(d).slice(0,60));
      }
      if(a.dotations&&a.dotations.length){
        return escapeHTML(a.dotations.map(d2=>d2.designation||d2.nom||d2.label||"").filter(Boolean).slice(0,3).join(", "));
      }
      return "—";
    })();
    const rowStyle=is72?' style="background:#fef2f2;color:#991b1b;font-weight:700"':'';
    return`<tr${rowStyle}><td class="px-3 py-2"><a class="font-semibold hover:underline" href="#/effectif/agent/${a.id}">${nom}</a></td><td class="px-3 py-2 font-mono text-xs text-amber-600">${mat}</td><td class="px-3 py-2 text-xs">${escapeHTML(a.societe||"—")}</td><td class="px-3 py-2 text-xs">${dateSortie}</td><td class="px-3 py-2 text-xs">${motif}</td><td class="px-3 py-2 text-xs">${dotationDesc}</td><td class="px-3 py-2 text-center">${delaiLabel}</td><td class="px-3 py-2"><button class="btn btn-ghost text-xs" onclick="markDotationReversee('${a.id}')">Marquer reversée</button></td></tr>`;
  }
  const kpi=(label,value,bg,color,icon,sub)=>`<div class="ops-dash-kpi" style="cursor:default"><div class="ops-dash-kpi-icon" style="background:${bg};color:${color}">${icon}</div><div class="ops-dash-lbl">${escapeHTML(label)}</div><div class="ops-dash-val">${value}</div><div class="ops-dash-sub">${escapeHTML(sub)}</div></div>`;
  view.innerHTML=`<div class="ops-dash-hero"><div class="ops-dash-hero-row"><div><div class="ops-dash-eyebrow">Direction des ressources humaines</div><h1>Reversements en attente</h1><div class="ops-dash-hero-sub"><span>${soc?escapeHTML(soc):"Toutes sociétés"} · dotations non reversées après fin de relation</span></div></div></div></div>
    <div class="ops-dash-kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      ${kpi("Total en attente",agents.length,"#eef3f9","#334155","📦","Dotations à récupérer")}
      ${kpi("En attente < 72h",enCours.length,"#fef3c7","#92400e","⏳","Délai normal")}
      ${kpi("Alerte +72h",alerte72.length,alerte72.length?"#fee2e2":"#dcfce7",alerte72.length?"#991b1b":"#166534","⚠","Relance nécessaire")}
    </div>
    ${alerte72.length?`<div class="section-banner banner-amber" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5">⚠ ${alerte72.length} employé(s) n'ont pas reversé leur dotation depuis plus de 72 heures.</div>`:""}
    <div class="ops-dash-card">
      <div class="ops-dash-card-head"><div><h3>Dotations en attente de reversement</h3><p>${agents.length} dossier(s)</p></div></div>
      <div class="ops-dash-card-body" style="overflow-x:auto">${agents.length?`<table><thead><tr><th class="text-left">Employé</th><th>Code</th><th>Société</th><th>Date sortie</th><th>Motif</th><th>Dotation</th><th class="text-center">Délai</th><th>Action</th></tr></thead><tbody>${agents.sort((a,b)=>(elapsedH(b)||0)-(elapsedH(a)||0)).map(row).join("")}</tbody></table>`:`<div class="p-8 text-center text-slate-400 italic">Aucun reversement en attente.</div>`}</div>
    </div>`;
}

function markDotationReversee(agentId){
  const a=db.agents.find(x=>x.id===agentId);if(!a){toast("Employé introuvable","error");return}
  openModal(`<h3 class="font-bold text-lg mb-3">Confirmer le reversement</h3>
    <p class="text-sm text-slate-600 mb-4">Confirmer que <b>${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())}</b> a reversé sa dotation ?</p>
    <div class="flex gap-2 justify-end">
      <button class="btn btn-ghost" onclick="closeModal()">Annuler</button>
      <button class="btn btn-success" onclick="confirmMarkDotationReversee('${agentId}')">Confirmer le reversement</button>
    </div>`);
}

async function confirmMarkDotationReversee(agentId){
  const a=db.agents.find(x=>x.id===agentId);if(!a)return;
  a.finRelationDotationReversee=true;a.finRelationDotationReverseeAt=new Date().toISOString();a.updatedAt=today();
  try{if(a.backendId)await SGDI.employees.update(a.backendId,employeeApiPayload(a));}catch(e){toast("Mise à jour non confirmée","error")}
  if(!(await saveDBAndWaitToast("Reversement non enregistré")))return;
  closeModal();toast("Reversement confirmé","success");renderView();
}

function renderDRHPeriodeEssai(view){
  const soc=drhActiveSocieteFilter();
  const today_=today();
  const agents=(db.agents||[]).filter(a=>a.dateFinEssai&&(!soc||a.societe===soc));
  const enCours=agents.filter(a=>daysBetween(today_,a.dateFinEssai)>=0).sort((a,b)=>String(a.dateFinEssai).localeCompare(String(b.dateFinEssai)));
  const expires30=enCours.filter(a=>daysBetween(today_,a.dateFinEssai)<=30);
  const expires90=enCours.filter(a=>daysBetween(today_,a.dateFinEssai)<=90);
  const expired=agents.filter(a=>daysBetween(today_,a.dateFinEssai)<0).sort((a,b)=>String(b.dateFinEssai).localeCompare(String(a.dateFinEssai)));
  const sansPortail=enCours.filter(a=>!agentHasPortailAccount(a));
  function essaiRow(a){
    const d=daysBetween(today_,a.dateFinEssai);
    const dLabel=d<0?`<span class="pill pill-gray text-xs">Expirée J+${Math.abs(d)}</span>`:d<=30?`<span class="pill pill-red text-xs">J-${d}</span>`:d<=90?`<span class="pill pill-amber text-xs">J-${d}</span>`:`<span class="pill pill-green text-xs">J-${d}</span>`;
    const hasPortail=agentHasPortailAccount(a);
    const enc=(a.gestionEvents||[]).some(e=>e.type==="Période E-N-C");
    const rec=(a.gestionEvents||[]).filter(e=>e.type==="Période d'essai").length;
    const name=escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim().toUpperCase());
    return`<tr data-searchable><td><a class="font-semibold hover:underline" href="#/effectif/agent/${a.id}">${name}</a></td><td class="font-mono text-xs text-amber-600">${escapeHTML(a.matricule||"—")}</td><td class="text-xs">${escapeHTML(a.societe||"—")}</td><td class="text-xs">${formatDate(a.dateRecrutement)}</td><td class="text-xs">${formatDate(a.dateFinEssai)}</td><td>${dLabel}</td><td class="text-center">${rec||"—"}</td><td class="text-center">${enc?'<span class="pill pill-red text-xs">ENC</span>':"—"}</td><td class="text-center">${hasPortail?'<span class="pill pill-green text-xs">✓</span>':'<span class="pill pill-amber text-xs">⚠</span>'}</td><td><div class="flex gap-1"><button class="btn btn-ghost text-xs" onclick="openPeriodeEncModal('${a.id}')">ENC</button><button class="btn btn-ghost text-xs" onclick="runRhEffectifAction('rec_periode_essai','${a.id}')">Reconduire</button></div></td></tr>`;
  }
  const kpi=(label,value,bg,color,icon,sub)=>`<div class="ops-dash-kpi" style="cursor:default"><div class="ops-dash-kpi-icon" style="background:${bg};color:${color}">${icon}</div><div class="ops-dash-lbl">${escapeHTML(label)}</div><div class="ops-dash-val">${value}</div><div class="ops-dash-sub">${escapeHTML(sub)}</div></div>`;
  const theadRow=`<tr><th class="text-left">Employé</th><th>Code</th><th>Société</th><th>Recrutement</th><th>Fin essai</th><th>Délai</th><th class="text-center">Reconductions</th><th class="text-center">ENC</th><th class="text-center">Portail</th><th>Actions</th></tr>`;
  view.innerHTML=`<div class="ops-dash-hero"><div class="ops-dash-hero-row"><div><div class="ops-dash-eyebrow">Direction des ressources humaines</div><h1>Période d'essai</h1><div class="ops-dash-hero-sub"><span>${soc?escapeHTML(soc):"Toutes sociétés"} · ${enCours.length} en cours</span></div></div><a href="#/contrats/dashboard" class="ops-dash-refresh">← Contrats</a></div></div>
    <div class="ops-dash-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      ${kpi("En cours",enCours.length,"#dbeafe","#1e40af","⏳","Périodes d'essai actives")}
      ${kpi("Fin dans 90 j",expires90.length,"#fef3c7","#92400e","📅","À anticiper")}
      ${kpi("Fin dans 30 j",expires30.length,"#fee2e2","#991b1b","⚠","Décision urgente")}
      ${kpi("Sans compte portail",sansPortail.length,sansPortail.length?"#fef3c7":"#dcfce7",sansPortail.length?"#92400e":"#166534","👤","Notifications indisponibles")}
    </div>
    ${sansPortail.length?`<div class="section-banner banner-amber">⚠ ${sansPortail.length} employé(s) en période d'essai sans compte Portail RH — notifications automatiques non disponibles.</div>`:""}
    <div class="ops-dash-card" style="margin-bottom:20px">
      <div class="ops-dash-card-head"><div><h3>En cours</h3><p>${enCours.length} période(s) d'essai active(s)</p></div></div>
      <div class="ops-dash-card-body" style="overflow-x:auto"><table data-searchable-table><thead>${theadRow}</thead><tbody>${enCours.length?enCours.map(essaiRow).join(""):`<tr><td colspan="10" class="text-center p-4 text-slate-400 italic">Aucune période d'essai en cours.</td></tr>`}</tbody></table></div>
    </div>
    ${expired.length?`<div class="ops-dash-card"><div class="ops-dash-card-head"><div><h3>Expirées</h3><p>${expired.length} période(s) échue(s) — 20 plus récentes affichées</p></div></div><div class="ops-dash-card-body" style="overflow-x:auto"><table><thead>${theadRow}</thead><tbody>${expired.slice(0,20).map(essaiRow).join("")}</tbody></table></div></div>`:""}`;
}

function renderDRH(view,sub,arg){
  sgdiEnsureEmployeesForDisplay({society:drhActiveSocieteFilter(),force:true});
  if(sub==="dashboard")return renderDRHDashboard(view);
  if(sub==="conges")return renderCongesModule(view,true);
  if(sub==="social")return renderDRHSocial(view,arg);
  if(sub==="mise_en_demeure")return renderDRHMiseEnDemeure(view);
  if(sub==="essai")return renderDRHPeriodeEssai(view);
  if(sub==="reversement")return renderDRHReversementEnAttente(view);
  if(sub==="stats")return renderDRHStats(view);
  if(sub==="stats_societe")return renderDRHStatsSociete(view);
  if(sub==="stats_theme")return renderDRHStatsTheme(view);
  if(sub==="stats_fonction")return renderDRHStatsFonction(view);
  if(sub==="stats_categorie")return renderDRHStatsCategorie(view);
  if(sub==="stats_salaire")return renderDRHStatsSalaire(view);
  if(sub==="stats_affectation")return renderDRHStatsAffectation(view);
  renderDRHDashboard(view);
}


function drhSiteCoverageCheck(agent,du,au){
  const site=agent?.affectationCourante?.siteName||"";
  if(!site)return null;
  const atSite=(db.agents||[]).filter(x=>String(x.id)!==String(agent.id)&&employeeIsActive(x)&&x.affectationCourante?.siteName===site);
  const total=atSite.length+1;
  const concurrentNames=(db.conges||[]).filter(c=>c.statut==="approuve"&&drhCongesOverlap(c,du,au)&&atSite.some(x=>String(x.id)===String(c.agentId))).map(c=>{const x=atSite.find(y=>String(y.id)===String(c.agentId));return x?((x.nom||"")+" "+(x.prenom||"")).trim():""}).filter(Boolean);
  return {site,total,concurrentNames};
}


function drhBars(entries,color){
  const max=Math.max(1,...entries.map(e=>e[1]));
  if(!entries.length)return`<div class="text-sm text-slate-400">Aucune donnée.</div>`;
  return entries.sort((a,b)=>b[1]-a[1]).map(([k,n])=>{const pct=Math.round(n/max*100);return`<div class="text-sm mb-2"><div class="flex justify-between mb-1"><span class="font-medium">${escapeHTML(String(k||"—"))}</span><span class="text-slate-500">${n}</span></div><div class="h-2 bg-slate-100 rounded-full"><div class="h-full rounded-full" style="width:${pct}%;background:${color}"></div></div></div>`}).join("");
}

function drhMonthlyKeys(count=12){
  const out=[];
  for(let i=count-1;i>=0;i--){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);out.push(d.toISOString().slice(0,7))}
  return out;
}

function drhMonthShort(m){const [y,mo]=String(m||"").split("-");return `${mo||""}/${String(y||"").slice(2)}`}

function drhSvgLine(series,labels,color="#043970",fill=false){
  const values=Array.isArray(series)?series:[];
  const max=Math.max(1,...values);
  const step=values.length>1?300/(values.length-1):300;
  const points=values.map((v,i)=>`${i*step},${88-(v/max*72)}`);
  const area=fill&&points.length?`<polygon points="0,92 ${points.join(" ")} 300,92" fill="${color}" opacity=".13"/>`:"";
  return `<svg viewBox="0 0 320 118" style="width:100%;height:150px;display:block">
    <line x1="0" y1="92" x2="304" y2="92" stroke="#e2e8f0" stroke-width="1"/>
    ${area}<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    ${values.map((v,i)=>`<circle cx="${i*step}" cy="${88-(v/max*72)}" r="3.5" fill="#fff" stroke="${color}" stroke-width="3"><title>${escapeHTML(String(v))}</title></circle>`).join("")}
    ${(labels||[]).filter((_,i)=>i===0||i===labels.length-1||i%3===0).map((l,i)=>{const idx=labels.indexOf(l);return`<text x="${idx*step}" y="112" font-size="10" fill="#64748b">${escapeHTML(drhMonthShort(l))}</text>`}).join("")}
  </svg>`;
}

function drhSvgGroupedBars(labels,series){
  const colors=["#043970","#047857","#dc2626","#7c3aed"];
  const max=Math.max(1,...series.flatMap(s=>s.values||[]));
  const groupW=labels.length?300/labels.length:300;
  const barW=Math.max(5,(groupW-8)/Math.max(1,series.length));
  return `<svg viewBox="0 0 320 140" style="width:100%;height:170px;display:block">
    <line x1="0" y1="104" x2="304" y2="104" stroke="#e2e8f0"/>
    ${labels.map((label,i)=>series.map((s,j)=>{const v=(s.values||[])[i]||0;const h=v/max*86;return`<rect x="${i*groupW+4+j*barW}" y="${104-h}" width="${Math.max(4,barW-2)}" height="${h}" rx="3" fill="${colors[j%colors.length]}"><title>${escapeHTML(s.name)}: ${v}</title></rect>`}).join("")).join("")}
    ${labels.filter((_,i)=>i===0||i===labels.length-1||i%3===0).map(l=>{const idx=labels.indexOf(l);return`<text x="${idx*groupW+2}" y="124" font-size="10" fill="#64748b">${escapeHTML(drhMonthShort(l))}</text>`}).join("")}
  </svg><div class="flex flex-wrap gap-3 text-xs text-slate-500">${series.map((s,i)=>`<span><b style="color:${colors[i%colors.length]}">●</b> ${escapeHTML(s.name)}</span>`).join("")}</div>`;
}

function drhSvgDonut(entries){
  const colors=["#043970","#047857","#f59e0b","#dc2626","#7c3aed","#0891b2","#475569"];
  const rows=(entries||[]).filter(([,n])=>Number(n)>0);
  const total=rows.reduce((s,[,n])=>s+Number(n||0),0)||1;
  let acc=0;
  const rings=rows.map(([label,n],i)=>{const value=Number(n||0);const dash=value/total*100;const node=`<circle cx="70" cy="70" r="46" fill="none" stroke="${colors[i%colors.length]}" stroke-width="18" stroke-dasharray="${dash} ${100-dash}" stroke-dashoffset="${25-acc}" pathLength="100"><title>${escapeHTML(label)}: ${value}</title></circle>`;acc+=dash;return node}).join("");
  return `<div class="grid grid-cols-1 md:grid-cols-2 gap-3 items-center"><svg viewBox="0 0 140 140" style="width:100%;max-height:180px"><circle cx="70" cy="70" r="46" fill="none" stroke="#e2e8f0" stroke-width="18"/>${rings}<text x="70" y="73" text-anchor="middle" font-size="20" font-weight="900" fill="#0f172a">${total}</text></svg><div class="space-y-2 text-sm">${rows.map(([label,n],i)=>`<div class="flex justify-between gap-2"><span><b style="color:${colors[i%colors.length]}">●</b> ${escapeHTML(label)}</span><b>${n}</b></div>`).join("")||`<div class="text-slate-400">Aucune donnée.</div>`}</div></div>`;
}

function drhSvgRadar(entries){
  const rows=(entries||[]).slice(0,6);
  const max=Math.max(1,...rows.map(([,n])=>Number(n||0)));
  const center=80,r=58;
  const pt=(i,scale=1)=>{const a=-Math.PI/2+(Math.PI*2*i/Math.max(1,rows.length));return[center+Math.cos(a)*r*scale,center+Math.sin(a)*r*scale]};
  const poly=rows.map(([,n],i)=>pt(i,Number(n||0)/max).join(",")).join(" ");
  return `<svg viewBox="0 0 160 180" style="width:100%;height:210px;display:block">
    ${[.25,.5,.75,1].map(s=>`<polygon points="${rows.map((_,i)=>pt(i,s).join(",")).join(" ")}" fill="none" stroke="#e2e8f0"/>`).join("")}
    <polygon points="${poly}" fill="#043970" opacity=".16" stroke="#043970" stroke-width="3"/>
    ${rows.map(([label,n],i)=>{const [x,y]=pt(i,1.14);return`<text x="${x}" y="${y}" text-anchor="middle" font-size="9" fill="#475569">${escapeHTML(String(label).slice(0,14))}</text>`}).join("")}
  </svg>`;
}

function drhHeatmap(rows,cols,valueFn){
  const vals=[];rows.forEach(r=>cols.forEach(c=>vals.push(Number(valueFn(r,c)||0))));
  const max=Math.max(1,...vals);
  return `<div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr><th></th>${cols.map(c=>`<th class="p-1 text-center">${escapeHTML(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr><td class="p-1 font-semibold">${escapeHTML(r)}</td>${cols.map(c=>{const v=Number(valueFn(r,c)||0);const o=.08+(v/max*.82);return`<td class="p-1 text-center font-bold rounded" style="background:rgba(4,57,112,${o});color:${o>.45?"#fff":"#0f172a"}">${v||""}</td>`}).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function socialAlertLevel(a){
  if(!socialCnasOk(a))return"cnas";
  if(!socialChifaOk(a))return"chifa";
  return"ok";
}

function socialStatusPill(type,value){
  const v=String(value||"").toLowerCase();
  if(type==="cnas"){
    if(v==="declare")return`<span class="pill pill-green">CNAS déclarée</span>`;
    if(v==="en_cours")return`<span class="pill pill-amber">CNAS en cours</span>`;
    return`<span class="pill pill-red">CNAS à déclarer</span>`;
  }
  if(v==="active"||v==="valide")return`<span class="pill pill-green">Chifa active</span>`;
  if(v==="en_attente")return`<span class="pill pill-amber">Chifa en attente</span>`;
  if(v==="expiree")return`<span class="pill pill-red">Chifa expirée</span>`;
  return`<span class="pill pill-gray">Chifa absente</span>`;
}

function socialAgentSearchText(a){
  const s=agentSocialData(a);
  return [a.nom,a.prenom,a.matricule,a.societe,a.fonction,a.poste,s.numeroCnas,s.numeroChifa,s.observations].join(" ").toLowerCase();
}

function socialOfficialFormsHTML(){
  const forms=[
    ["IM.03","Déclaration d'activité employeur","https://cnas.dz/wp-content/uploads/2024/10/IM-03.pdf"],
    ["IM.13","Liste nominative des assurés sociaux à déclarer","https://cnas.dz/wp-content/uploads/2024/10/IM-13.pdf"],
    ["IM.10","Déclaration de salarié à temps partiel","https://cnas.dz/wp-content/uploads/2024/10/IM.10.pdf"],
    ["Guide","Guide officiel télédéclaration CNAS","https://teledeclaration.cnas.dz/pdf/Guide%20TELE-DECLARATION.pdf"]
  ];
  return `<div class="card p-4 mb-4">
    <div class="flex items-start justify-between gap-3 flex-wrap mb-3">
      <div><h3 class="font-black text-base">Imprimés CNAS</h3><p class="text-xs text-slate-500">Références officielles et impressions préparatoires SGDI.</p></div>
      <div class="flex gap-2 flex-wrap"><button type="button" class="btn btn-secondary text-xs" onclick="printSocialCnasDeclarationActivite()">Préparer IM.03</button><button type="button" class="btn btn-secondary text-xs" onclick="printSocialCnasListe()">Préparer IM.13</button><button type="button" class="btn btn-ghost text-xs" onclick="openSocialGuideModal()">Règles CNAS</button></div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-2">${forms.map(([code,label,url])=>`<a class="p-3 rounded-lg block" style="border:1px solid #dbe3ef;background:#fff;text-decoration:none;color:#0f172a" href="${url}" target="_blank" rel="noopener"><div class="font-black text-sm">${escapeHTML(code)}</div><div class="text-xs text-slate-500 mt-1">${escapeHTML(label)}</div></a>`).join("")}</div>
  </div>`;
}

function renderDRHSocial(view,arg){
  if(arg)return renderDRHSocialAgent(view,arg);
  const soc=drhActiveSocieteFilter();
  const q=(sessionStorage.getItem("drhSocialQ")||"").toLowerCase();
  const filter=sessionStorage.getItem("drhSocialFilter")||"alertes";
  let agents=drhAgentsList().filter(a=>!["sortant","demissionne","licencie","archive"].includes(String(a.statut||"").toLowerCase()));
  const base=agents.slice();
  if(q)agents=agents.filter(a=>socialAgentSearchText(a).includes(q));
  if(filter==="cnas")agents=agents.filter(a=>!socialCnasOk(a));
  else if(filter==="chifa")agents=agents.filter(a=>!socialChifaOk(a));
  else if(filter==="ok")agents=agents.filter(a=>socialCnasOk(a)&&socialChifaOk(a));
  else if(filter==="alertes")agents=agents.filter(a=>!socialCnasOk(a)||!socialChifaOk(a));
  agents.sort((a,b)=>socialAlertLevel(a).localeCompare(socialAlertLevel(b))||String(a.nom||"").localeCompare(String(b.nom||"")));
  const cnasOk=base.filter(socialCnasOk).length;
  const chifaOk=base.filter(socialChifaOk).length;
  const alertes=base.filter(a=>!socialCnasOk(a)||!socialChifaOk(a)).length;
  const dossiersComplets=base.filter(a=>socialCnasOk(a)&&socialChifaOk(a)).length;
  const kpi=(key,label,n,sub,bg,color)=>`<button type="button" onclick="sessionStorage.setItem('drhSocialFilter','${key}');renderView()" class="ops-dash-kpi" style="${filter===key?`box-shadow:0 0 0 2px ${color} inset`:""}"><div class="ops-dash-kpi-icon" style="background:${bg};color:${color}">${key==="ok"?"✓":key==="alertes"?"⚠":key==="cnas"?"📋":"🩺"}</div><div class="ops-dash-lbl">${escapeHTML(label)}</div><div class="ops-dash-val">${n}</div><div class="ops-dash-sub">${escapeHTML(sub)}</div></button>`;
  view.innerHTML=`<div class="ops-dash-hero"><div class="ops-dash-hero-row"><div><div class="ops-dash-eyebrow">Direction des ressources humaines</div><h1>Service social</h1><div class="ops-dash-hero-sub"><span>Suivi CNAS, carte Chifa et dossier social employé${soc?` · ${escapeHTML(soc)}`:""}</span></div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ops-dash-refresh" onclick="openSocialGuideModal()">Procédure social</button><a href="#/conges" class="ops-dash-refresh" style="text-decoration:none;display:inline-flex;align-items:center">Congés</a></div></div></div>
  <div class="ops-dash-kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    ${kpi("alertes","Alertes sociales",alertes,"CNAS ou Chifa incomplet","#fee2e2","#991b1b")}
    ${kpi("cnas","CNAS à traiter",base.length-cnasOk,"Déclarations manquantes","#fef3c7","#92400e")}
    ${kpi("chifa","Chifa à traiter",base.length-chifaOk,"Cartes absentes ou non valides","#ede9fe","#5b21b6")}
    ${kpi("ok","Dossiers complets",dossiersComplets,"CNAS + Chifa renseignées","#dcfce7","#166534")}
  </div>
  ${socialOfficialFormsHTML()}
  <div class="ops-dash-card" style="margin-bottom:16px">
    <div class="ops-dash-card-body" style="padding-top:18px">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div class="md:col-span-2"><label class="label">Recherche</label><input class="input" value="${escapeHTML(q)}" placeholder="Nom, matricule, CNAS, Chifa..." oninput="sessionStorage.setItem('drhSocialQ',this.value);renderView()"/></div>
        <div><label class="label">Vue</label><select class="select" onchange="sessionStorage.setItem('drhSocialFilter',this.value);renderView()">
          ${[["alertes","Alertes"],["tous","Tous les employés"],["cnas","CNAS à traiter"],["chifa","Chifa à traiter"],["ok","Dossiers complets"]].map(([k,l])=>`<option value="${k}" ${filter===k?"selected":""}>${l}</option>`).join("")}
        </select></div>
        <button type="button" class="btn btn-ghost" onclick="sessionStorage.removeItem('drhSocialQ');sessionStorage.setItem('drhSocialFilter','alertes');renderView()">Réinitialiser</button>
      </div>
    </div>
  </div>
  <div class="ops-dash-card">
    <div class="ops-dash-card-head"><div><h3>Dossiers sociaux</h3><p>${agents.length} employé(s) dans cette vue</p></div></div>
    <div class="ops-dash-card-body" style="overflow-x:auto"><table><thead><tr><th class="text-left">Employé</th><th>Société</th><th>CNAS</th><th>Carte Chifa</th><th>Ayants droit</th><th>Dernière mise à jour</th><th></th></tr></thead>
    <tbody>${agents.length?agents.map(a=>{const s=agentSocialData(a);return`<tr data-searchable>
      <td><div class="font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</div><div class="text-xs text-slate-500">${escapeHTML(a.matricule||"Sans matricule")} · ${escapeHTML(a.fonction||a.poste||"")}</div></td>
      <td class="text-xs">${escapeHTML(a.societe||"—")}</td>
      <td>${socialStatusPill("cnas",s.statutCnas)}<div class="text-xs font-mono text-slate-500 mt-1">${escapeHTML(s.numeroCnas||"—")}</div></td>
      <td>${socialStatusPill("chifa",s.statutChifa)}<div class="text-xs font-mono text-slate-500 mt-1">${escapeHTML(s.numeroChifa||"—")}</div></td>
      <td class="text-xs">${escapeHTML(s.ayantsDroit||"—")}</td>
      <td class="text-xs">${formatDate(s.updatedAt||s.dateDeclarationCnas||"")}</td>
      <td class="text-right"><div class="flex gap-1 justify-end flex-wrap"><button class="btn btn-secondary text-xs" onclick="openSocialAgentModal('${jsString(a.id)}')">Dossier social</button><button class="btn btn-ghost text-xs" onclick="printSocialCnasAffiliation('${jsString(a.id)}')">SECU.01</button><button class="btn btn-primary text-xs" onclick="openChifaReadModal('${jsString(a.id)}')">Lire Chifa</button></div></td>
    </tr>`}).join(""):`<tr><td colspan="7" class="text-center text-slate-500 p-8">Aucun employé dans cette vue.</td></tr>`}</tbody></table></div>
  </div>`;
}

function renderDRHSocialAgent(view,id){
  const a=(db.agents||[]).find(x=>String(x.id)===String(id));
  if(!a){view.innerHTML=`<div class="card p-6 text-red-700">Employé introuvable.</div>`;return}
  const s=agentSocialData(a);
  view.innerHTML=`<div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
    <div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Service social DRH</div><h1 class="text-2xl font-black">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</h1><p class="text-sm text-slate-500">${escapeHTML(a.matricule||"Sans matricule")} · ${escapeHTML(a.societe||"—")} · ${escapeHTML(a.fonction||a.poste||"")}</p></div>
    <div class="flex gap-2 flex-wrap"><button class="btn btn-secondary" onclick="openSocialAgentModal('${jsString(a.id)}')">Modifier</button><button class="btn btn-secondary" onclick="printSocialCnasAffiliation('${jsString(a.id)}')">SECU.01</button><button class="btn btn-secondary" onclick="printSocialCnasTempsPartiel('${jsString(a.id)}')">IM.10</button><button class="btn btn-primary" onclick="openChifaReadModal('${jsString(a.id)}')">Lire Chifa</button><a class="btn btn-ghost" href="#/drh/social">Retour</a></div>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Statut CNAS</div><div class="mt-2">${socialStatusPill("cnas",s.statutCnas)}</div><div class="text-xs font-mono mt-2">${escapeHTML(s.numeroCnas||"—")}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Carte Chifa</div><div class="mt-2">${socialStatusPill("chifa",s.statutChifa)}</div><div class="text-xs font-mono mt-2">${escapeHTML(s.numeroChifa||"—")}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Déclaration CNAS</div><div class="text-2xl font-black mt-1">${formatDate(s.dateDeclarationCnas)||"—"}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Validité Chifa</div><div class="text-2xl font-black mt-1">${formatDate(s.dateValiditeChifa)||"—"}</div></div>
  </div>
  <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
    <div class="card p-5"><h3 class="font-black mb-3">Dossier social</h3><div class="text-sm space-y-2"><div><b>Ayants droit :</b> ${escapeHTML(s.ayantsDroit||"—")}</div><div><b>Centre CNAS :</b> ${escapeHTML(s.centreCnas||"—")}</div><div><b>Observations :</b><br>${escapeHTML(s.observations||"Aucune observation.")}</div></div></div>
    <div class="card p-5"><h3 class="font-black mb-3">Traçabilité</h3><div class="text-sm text-slate-600">Dernière mise à jour : <b>${formatDate(s.updatedAt||"")||"—"}</b><br>Utilisateur : <b>${escapeHTML(s.updatedBy||"—")}</b></div></div>
  </div>`;
}

function openSocialGuideModal(){
  openModal(`<h3 class="font-black text-lg mb-3">Procédure service social DRH</h3>
    <div class="text-sm text-slate-600 space-y-2">
      <p>Ce module centralise le suivi social de l'employé : déclaration CNAS, carte Chifa, ayants droit et observations du dossier social.</p>
      <p>La lecture Chifa intégrée fonctionne avec les lecteurs qui envoient les données dans un champ texte, comme un lecteur clavier. Pour un lecteur PC/SC natif, il faudra raccorder le modèle exact via un connecteur local sécurisé.</p>
    </div>
    <div class="flex justify-end mt-5"><button class="btn btn-primary" onclick="closeModal()">Compris</button></div>`);
}

function openSocialAgentModal(id){
  const a=(db.agents||[]).find(x=>String(x.id)===String(id));if(!a){toast("Employé introuvable","error");return}
  const s=agentSocialData(a);
  openModal(`<h3 class="font-black text-lg mb-1">Dossier social employé</h3><p class="text-sm text-slate-500 mb-4">${escapeHTML((a.nom||"")+" "+(a.prenom||""))} · ${escapeHTML(a.societe||"—")}</p>
    <form onsubmit="event.preventDefault();saveSocialAgent('${jsString(id)}')">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><label class="label">Statut CNAS</label><select class="select" name="statutCnas"><option value="a_declarer" ${s.statutCnas==="a_declarer"?"selected":""}>À déclarer</option><option value="en_cours" ${s.statutCnas==="en_cours"?"selected":""}>En cours</option><option value="declare" ${s.statutCnas==="declare"?"selected":""}>Déclaré</option></select></div>
        <div><label class="label">N° CNAS</label><input class="input" name="numeroCnas" value="${escapeHTML(s.numeroCnas||"")}" placeholder="xxxxxxxxxx xx" oninput="let d=this.value.replace(/[^0-9]/g,'').slice(0,12);this.value=d.length>10?d.slice(0,10)+' '+d.slice(10):d"/></div>
        <div><label class="label">N° employeur / adhérent</label><input class="input" name="numeroEmployeur" value="${escapeHTML(s.numeroEmployeur||"")}" placeholder="Numéro adhérent CNAS"/></div>
        <div><label class="label">Date déclaration CNAS</label><input class="input" type="date" name="dateDeclarationCnas" value="${escapeHTML(String(s.dateDeclarationCnas||"").slice(0,10))}"/></div>
        <div><label class="label">Centre CNAS</label><input class="input" name="centreCnas" value="${escapeHTML(s.centreCnas||"")}" placeholder="Agence / centre"/></div>
        <div><label class="label">Statut carte Chifa</label><select class="select" name="statutChifa"><option value="absente" ${s.statutChifa==="absente"?"selected":""}>Absente</option><option value="en_attente" ${s.statutChifa==="en_attente"?"selected":""}>En attente</option><option value="active" ${s.statutChifa==="active"?"selected":""}>Active</option><option value="expiree" ${s.statutChifa==="expiree"?"selected":""}>Expirée</option></select></div>
        <div><label class="label">N° carte Chifa</label><input class="input" name="numeroChifa" value="${escapeHTML(s.numeroChifa||"")}" inputmode="numeric" placeholder="Numéro carte"/></div>
        <div><label class="label">Validité Chifa</label><input class="input" type="date" name="dateValiditeChifa" value="${escapeHTML(String(s.dateValiditeChifa||"").slice(0,10))}"/></div>
        <div><label class="label">Ayants droit</label><input class="input" name="ayantsDroit" value="${escapeHTML(s.ayantsDroit||"")}" placeholder="Conjoint, enfants..."/></div>
        <div><label class="label">Durée hebdomadaire IM.10</label><input class="input" name="dureeHebdo" value="${escapeHTML(s.dureeHebdo||"")}" placeholder="Ex : 24 heures"/></div>
        <div><label class="label">Journées de travail IM.10</label><input class="input" name="joursTravail" value="${escapeHTML(s.joursTravail||"")}" placeholder="Ex : Dimanche à mercredi"/></div>
        <div class="md:col-span-2"><label class="label">Horaires IM.10</label><input class="input" name="horairesTravail" value="${escapeHTML(s.horairesTravail||"")}" placeholder="Ex : 08:00 - 14:00"/></div>
        <div class="md:col-span-2"><label class="label">Observations</label><textarea class="textarea" rows="3" name="observations">${escapeHTML(s.observations||"")}</textarea></div>
      </div>
      <div class="flex justify-between gap-2 mt-4 flex-wrap"><button type="button" class="btn btn-secondary" onclick="openChifaReadModal('${jsString(id)}')">Lire carte Chifa</button><div class="flex gap-2"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Enregistrer</button></div></div>
    </form>`);
}

function socialFormatCnas(value){
  const d=String(value||"").replace(/[^0-9]/g,"").slice(0,12);
  return d.length>10?d.slice(0,10)+" "+d.slice(10):d;
}

function socialApplyFormToAgent(a,fd,extra){
  const s=agentSocialData(a);
  Object.assign(s,{
    statutCnas:String(fd.get("statutCnas")||s.statutCnas||"a_declarer"),
    numeroCnas:socialFormatCnas(fd.get("numeroCnas")||s.numeroCnas||""),
    numeroEmployeur:String(fd.get("numeroEmployeur")||"").trim(),
    dateDeclarationCnas:String(fd.get("dateDeclarationCnas")||""),
    centreCnas:String(fd.get("centreCnas")||"").trim(),
    statutChifa:String(fd.get("statutChifa")||s.statutChifa||"absente"),
    numeroChifa:String(fd.get("numeroChifa")||s.numeroChifa||"").trim(),
    dateValiditeChifa:String(fd.get("dateValiditeChifa")||""),
    ayantsDroit:String(fd.get("ayantsDroit")||"").trim(),
    dureeHebdo:String(fd.get("dureeHebdo")||"").trim(),
    joursTravail:String(fd.get("joursTravail")||"").trim(),
    horairesTravail:String(fd.get("horairesTravail")||"").trim(),
    observations:String(fd.get("observations")||"").trim(),
    updatedAt:new Date().toISOString(),
    updatedBy:session?.username||""
  },extra||{});
  a.numeroCnas=s.numeroCnas;
  a.numeroChifa=s.numeroChifa;
}

async function saveSocialAgent(id){
  const a=(db.agents||[]).find(x=>String(x.id)===String(id));if(!a)return;
  const form=document.querySelector(".modal-bg form");const fd=new FormData(form);
  socialApplyFormToAgent(a,fd);
  if(!(await saveDBAndWaitToast("Dossier social non confirmé")))return;
  closeModal();toast("Dossier social enregistré","success");renderView();
}

function openChifaReadModal(id){
  const a=(db.agents||[]).find(x=>String(x.id)===String(id));if(!a){toast("Employé introuvable","error");return}
  openModal(`<h3 class="font-black text-lg mb-1">Lecture carte Chifa</h3><p class="text-sm text-slate-500 mb-4">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</p>
    <form onsubmit="event.preventDefault();saveChifaReaderData('${jsString(id)}')">
      <div class="card p-3 mb-3" style="background:#f8fafc"><div class="text-sm font-semibold">Mode lecteur clavier / copier-coller</div><div class="text-xs text-slate-500 mt-1">Placez le curseur dans la zone puis lancez la lecture de la carte. SGDI extrait les numéros détectés et les rattache au dossier social.</div></div>
      <label class="label">Données lues depuis la carte</label>
      <textarea class="textarea" name="readerData" rows="6" autofocus placeholder="Collez ici les données lues par le lecteur Chifa"></textarea>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Rattacher au dossier</button></div>
    </form>`);
  setTimeout(()=>{const el=document.querySelector(".modal-bg textarea[name='readerData']");if(el)el.focus()},80);
}

async function saveChifaReaderData(id){
  const a=(db.agents||[]).find(x=>String(x.id)===String(id));if(!a)return;
  const raw=String(new FormData(document.querySelector(".modal-bg form")).get("readerData")||"").trim();
  if(!raw){toast("Aucune donnée lue","error");return}
  const nums=(raw.match(/[0-9]{8,}/g)||[]).map(x=>x.replace(/\D/g,""));
  const s=agentSocialData(a);
  const chifa=nums.find(n=>n.length>=13)||nums[0]||"";
  const cnas=nums.find(n=>n.length===12)||"";
  if(chifa)s.numeroChifa=chifa;
  if(cnas)s.numeroCnas=socialFormatCnas(cnas);
  s.statutChifa=chifa?"active":s.statutChifa;
  if(cnas)s.statutCnas="declare";
  s.rawChifaRead=raw.slice(0,1200);
  s.updatedAt=new Date().toISOString();
  s.updatedBy=session?.username||"";
  a.numeroCnas=s.numeroCnas||a.numeroCnas;
  a.numeroChifa=s.numeroChifa||a.numeroChifa;
  if(!(await saveDBAndWaitToast("Lecture Chifa non confirmée")))return;
  closeModal();toast("Lecture Chifa rattachée au dossier","success");renderView();
}

function socialPrintStyles(){
  return `<style>
    @page{size:A4;margin:14mm}
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;color:#111827;margin:0;background:#fff;font-size:12px}
    .doc{max-width:190mm;margin:0 auto}
    .doc-logo{width:30mm;height:30mm;object-fit:contain;display:block;margin:0 auto 8px}
    .head{border:2px solid #111827;padding:10px;text-align:center;margin-bottom:12px}
    .head h1{font-size:18px;margin:4px 0 2px;text-transform:uppercase}
    .head p{margin:0;color:#475569;font-size:11px}
    .section{border:1px solid #111827;margin-bottom:10px}
    .section h2{font-size:12px;text-transform:uppercase;margin:0;padding:6px 8px;background:#f1f5f9;border-bottom:1px solid #111827}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:0}
    .field{min-height:28px;border-right:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;padding:5px 7px}
    .field:nth-child(2n){border-right:0}
    .field b{display:block;font-size:9px;color:#475569;text-transform:uppercase;margin-bottom:2px}
    table{width:100%;border-collapse:collapse;font-size:10px}
    th,td{border:1px solid #111827;padding:5px;text-align:left;vertical-align:top}
    th{background:#f1f5f9;text-transform:uppercase;font-size:9px}
    .sign{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:28px}
    .box{border:1px solid #111827;height:70px;padding:7px;font-size:10px}
    .note{font-size:10px;color:#475569;margin-top:8px}
    .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #dbe3ef;padding:8px;display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px}
    .toolbar button{border:0;border-radius:7px;background:#043970;color:#fff;padding:8px 12px;font-weight:800;cursor:pointer}
    @media print{.toolbar{display:none}.doc{max-width:none}}
  </style>`;
}

function socialOpenPrint(title,body,societe){
  const w=window.open("","_blank","width=980,height=760");
  if(!w){toast("Fenêtre d'impression bloquée par le navigateur","error");return}
  const logo=sgdiDocumentLogoHTML(societe,"doc-logo");
  const normalized=String(body||"").includes('class="doc"')?String(body||"").replace(/(<main[^>]*class="[^"]*\bdoc\b[^"]*"[^>]*>)/,`$1${logo}`):`<main class="doc">${logo}${body||""}</main>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(title)}</title>${socialPrintStyles()}</head><body><div class="toolbar"><button onclick="window.print()">Imprimer</button><button onclick="window.close()">Fermer</button></div>${normalized}</body></html>`);
  w.document.close();
}

function socialAgentField(label,value){return`<div class="field"><b>${escapeHTML(label)}</b>${escapeHTML(value||"—")}</div>`}

function printSocialCnasAffiliation(id){
  const a=(db.agents||[]).find(x=>String(x.id)===String(id));if(!a){toast("Employé introuvable","error");return}
  const s=agentSocialData(a);
  const soc=a.societe||drhActiveSocieteFilter()||"";
  const body=`<main class="doc">
    <div class="head"><div>CNAS - Préparation SGDI</div><h1>Demande d'affiliation / immatriculation salarié</h1><p>Document préparatoire interne inspiré des champs nécessaires à la déclaration CNAS. Vérifier avec l'imprimé officiel avant dépôt.</p></div>
    <div class="section"><h2>Renseignements employeur</h2><div class="grid">
      ${socialAgentField("Raison sociale",soc)}
      ${socialAgentField("N° employeur / adhérent",s.numeroEmployeur||"")}
      ${socialAgentField("Centre CNAS",s.centreCnas||"")}
      ${socialAgentField("Date dépôt",today())}
    </div></div>
    <div class="section"><h2>Renseignements travailleur</h2><div class="grid">
      ${socialAgentField("Nom",a.nom)}
      ${socialAgentField("Prénom",a.prenom)}
      ${socialAgentField("Date de naissance",formatDate(a.dateNaissance))}
      ${socialAgentField("Lieu de naissance",a.lieuNaissance||a.communeNaissance||"")}
      ${socialAgentField("NIN",a.nin)}
      ${socialAgentField("N° sécurité sociale / CNAS",s.numeroCnas||a.numeroCnas)}
      ${socialAgentField("Date recrutement",formatDate(a.dateRecrutement||a.dateEntree))}
      ${socialAgentField("Fonction / qualification",a.fonction||a.poste)}
      ${socialAgentField("Nature contrat",a.typeContrat||"")}
      ${socialAgentField("Salaire de base",a.salaire?money(a.salaire):"")}
    </div></div>
    <div class="section"><h2>Carte Chifa et ayants droit</h2><div class="grid">
      ${socialAgentField("N° carte Chifa",s.numeroChifa)}
      ${socialAgentField("Validité",formatDate(s.dateValiditeChifa))}
      ${socialAgentField("Ayants droit",s.ayantsDroit)}
      ${socialAgentField("Observations",s.observations)}
    </div></div>
    <div class="sign"><div class="box">Signature du déclarant</div><div class="box">Cachet de la structure</div></div>
    <div class="note">Références officielles : IM.03, IM.13, IM.10 et portail de télédéclaration CNAS.</div>
  </main>`;
  socialOpenPrint("SECU.01 "+(a.matricule||a.nom||""),body,soc);
}

function printSocialCnasDeclarationActivite(){
  const soc=drhActiveSocieteFilter()||currentStructureSocieteFilter()||mySoc()||"";
  let agents=drhAgentsList().filter(a=>!["sortant","demissionne","licencie","archive"].includes(String(a.statut||"").toLowerCase()));
  if(soc)agents=agents.filter(a=>a.societe===soc);
  agents.sort((a,b)=>String(a.dateRecrutement||a.dateEntree||"9999").localeCompare(String(b.dateRecrutement||b.dateEntree||"9999")));
  const firstDate=(agents.find(a=>a.dateRecrutement||a.dateEntree)||{}).dateRecrutement||(agents.find(a=>a.dateRecrutement||a.dateEntree)||{}).dateEntree||"";
  const rows=agents.slice(0,20).map((a,i)=>`<tr><td>${String(i+1).padStart(2,"0")}</td><td>${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</td><td>${escapeHTML(formatDate(a.dateNaissance)||"")}</td><td>${escapeHTML(formatDate(a.dateRecrutement||a.dateEntree)||"")}</td><td>${escapeHTML(a.fonction||a.poste||"")}</td></tr>`).join("");
  const body=`<main class="doc">
    <div class="head"><div>CNAS - Préparation SGDI</div><h1>IM.03 - Déclaration d'activité</h1><p>Préremplissage depuis SGDI pour la société active. Vérifier avec l'imprimé officiel avant dépôt.</p></div>
    <div class="section"><h2>Renseignements d'identification</h2><div class="grid">
      ${socialAgentField("Dénomination / raison sociale",soc||"")}
      ${socialAgentField("Adresse exacte",db.societesConfig?.descriptions?.[soc]||"")}
      ${socialAgentField("Date début d'activité",firstDate?formatDate(firstDate):"")}
      ${socialAgentField("Date recrutement premier salarié",firstDate?formatDate(firstDate):"")}
      ${socialAgentField("Effectif existant",String(agents.length))}
      ${socialAgentField("Secteur d'affiliation",soc?"Économique":"")}
    </div></div>
    <div class="section"><h2>Liste nominative des travailleurs SGDI</h2><table><thead><tr><th>N°</th><th>Nom et prénoms</th><th>Date naissance</th><th>Date embauche</th><th>Qualification</th></tr></thead><tbody>${rows||`<tr><td colspan="5" style="text-align:center;color:#64748b">Aucun employé pour la société active.</td></tr>`}</tbody></table></div>
    <div class="sign"><div class="box">Le déclarant</div><div class="box">Cachet de la structure</div></div>
    <div class="note">SGDI utilise les données de la société active et de l'effectif. Joindre les SECU.01 selon la procédure CNAS.</div>
  </main>`;
  socialOpenPrint("IM.03 CNAS "+soc,body,soc);
}

function printSocialCnasTempsPartiel(id){
  const a=(db.agents||[]).find(x=>String(x.id)===String(id));if(!a){toast("Employé introuvable","error");return}
  const s=agentSocialData(a);
  const body=`<main class="doc">
    <div class="head"><div>CNAS - Préparation SGDI</div><h1>IM.10 - Déclaration de salarié à temps partiel</h1><p>À utiliser uniquement lorsque l'employé est réellement à temps partiel.</p></div>
    <div class="section"><h2>Renseignements employeur</h2><div class="grid">
      ${socialAgentField("Nom ou raison sociale",a.societe)}
      ${socialAgentField("Numéro adhérent",s.numeroEmployeur||"")}
      ${socialAgentField("Adresse",db.societesConfig?.descriptions?.[a.societe]||"")}
      ${socialAgentField("Centre CNAS",s.centreCnas||"")}
    </div></div>
    <div class="section"><h2>Renseignements travailleur</h2><div class="grid">
      ${socialAgentField("Nom",a.nom)}
      ${socialAgentField("Prénom",a.prenom)}
      ${socialAgentField("Date et lieu de naissance",`${formatDate(a.dateNaissance)||"—"} · ${a.lieuNaissance||a.communeNaissance||"—"}`)}
      ${socialAgentField("N° sécurité sociale",s.numeroCnas||a.numeroCnas)}
      ${socialAgentField("Nature contrat",a.typeContrat||"Temps partiel")}
      ${socialAgentField("Qualification",a.fonction||a.poste)}
      ${socialAgentField("Salaire base / primes",a.salaire?money(a.salaire):"")}
      ${socialAgentField("Durée hebdomadaire",s.dureeHebdo||"")}
    </div></div>
    <div class="section"><h2>Horaires de travail</h2><div class="grid">
      ${socialAgentField("Journées de travail",s.joursTravail||"")}
      ${socialAgentField("Horaires",s.horairesTravail||"")}
    </div></div>
    <div class="sign"><div class="box">Signature du déclarant</div><div class="box">Cachet de la structure</div></div>
    <div class="note">Document préparatoire SGDI. Toute donnée manquante doit être complétée avant dépôt CNAS.</div>
  </main>`;
  socialOpenPrint("IM.10 CNAS "+(a.matricule||a.nom||""),body,a.societe);
}

function printSocialCnasListe(){
  const soc=drhActiveSocieteFilter();
  let agents=drhAgentsList().filter(a=>!["sortant","demissionne","licencie","archive"].includes(String(a.statut||"").toLowerCase()));
  agents=agents.filter(a=>!socialCnasOk(a)||String(agentSocialData(a).statutCnas||"")==="en_cours");
  agents.sort((a,b)=>String(a.nom||"").localeCompare(String(b.nom||"")));
  const rows=agents.map((a,i)=>{const s=agentSocialData(a);return`<tr><td>${String(i+1).padStart(2,"0")}</td><td>${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</td><td>${escapeHTML(s.numeroCnas||a.numeroCnas||"")}</td><td>${escapeHTML(formatDate(a.dateNaissance)||"")}</td><td>${escapeHTML(formatDate(a.dateRecrutement||a.dateEntree)||"")}</td><td>${escapeHTML(a.fonction||a.poste||"")}</td></tr>`}).join("");
  const body=`<main class="doc">
    <div class="head"><div>CNAS - Préparation SGDI</div><h1>Liste nominative des assurés sociaux à déclarer</h1><p>${escapeHTML(soc||"Toutes sociétés autorisées")} · ${agents.length} salarié(s)</p></div>
    <div class="section"><h2>Employeur</h2><div class="grid">${socialAgentField("Raison sociale",soc||"Toutes sociétés autorisées")}${socialAgentField("Date dépôt",today())}</div></div>
    <table><thead><tr><th>N°</th><th>Nom et prénom</th><th>N° sécurité sociale</th><th>Date naissance</th><th>Date recrutement</th><th>Qualification</th></tr></thead><tbody>${rows||`<tr><td colspan="6" style="text-align:center;color:#64748b">Aucun salarié à déclarer dans la société active.</td></tr>`}</tbody></table>
    <div class="sign"><div class="box">Signature du déclarant</div><div class="box">Cachet de la structure</div></div>
    <div class="note">Document préparatoire SGDI. Le dépôt doit être vérifié avec l'imprimé officiel IM.13 et la plateforme CNAS.</div>
  </main>`;
  socialOpenPrint("Liste nominative CNAS",body,soc);
}

function drhSocieteValue(v){return v===DRH_NO_SOCIETE?"":String(v||"")}

function drhSocieteLabel(v){return v===DRH_NO_SOCIETE?"Sans société":(v||"Toutes les sociétés")}

function drhSocieteRows(){
  const ag=db.agents||[];
  const allowed=typeof drhAuthorizedSocieties==="function"?drhAuthorizedSocieties():[];
  const source=allowed.length?SOCIETES.filter(s=>allowed.includes(s)):SOCIETES;
  const rows=source.map(s=>({key:s,label:s}));
  if(ag.some(a=>!String(a.societe||"").trim()))rows.push({key:DRH_NO_SOCIETE,label:"Sans société"});
  return rows;
}

SGDIModules.registerModule({key: "drh", routes: ["drh","conges"], dependencies: ["drh-dashboard", "leaves"], init: function(){}, destroy: function(){}});
