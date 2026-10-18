/* Phase 2 — sites-1. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2h-inventory.json. */
function siteAgentsForGroupForm(siteId){
  return (db.agents||[]).filter(a=>{const sid=String(agentLiveAffectation(a)?.siteId||"");return a.statut==="actif"&&(!sid||sid===String(siteId))}).sort((a,b)=>(a.matricule||a.nom||"").localeCompare(b.matricule||b.nom||""));
}

// Affichage progressif : au-delà de SITE_AFFECTATION_PAGE lignes, « Afficher plus ».
const SITE_AFFECTATION_PAGE=25;

function siteAffectationGroupesHTML(site){
  const eff=siteEffectifsNorm(site);
  const contractuel=+eff.totalContractuel||0;
  const agents=siteAgentsAffectes(site);
  // Règle historique conservée : au-delà de l'effectif contractuel, les dernières lignes
  // (ordre matricule) sont présentées en surplus. Aucun employé n'est réaffecté ici.
  const hasSurplus=contractuel>0&&agents.length>contractuel;
  const mainAgents=hasSurplus?agents.slice(0,contractuel):agents;
  const surplusAgents=hasSurplus?agents.slice(contractuel):[];
  const fullName=a=>((a.nom||"")+" "+(a.prenom||"")).trim()||"—";
  const mainRow=(a,i)=>{
    const aff=opsEmployeeLiveAffectation(a);
    const search=[fullName(a),a.matricule,aff?.poste||a.fonction].join(" ");
    return `<tr data-stf-affect-row data-search="${escapeHTML(normalizedSearchText(search))}"${i>=SITE_AFFECTATION_PAGE?" hidden data-stf-more":""}>
      <td class="stf-cell-strong">${escapeHTML(fullName(a))}</td>
      <td class="stf-cell-mono">${escapeHTML(a.matricule||"—")}</td>
      <td>${escapeHTML(aff?.poste||a.fonction||"—")}</td>
      <td class="stf-cell-mono">${formatDate(aff?.dateDebut)}</td>
      <td>${aff?.groupe?`<span class="stf-chip">Groupe ${escapeHTML(aff.groupe)}</span>`:"—"}</td>
      <td>${escapeHTML(a.statut||"—")}</td>
    </tr>`;
  };
  const surplusRow=a=>{
    const aff=opsEmployeeLiveAffectation(a);
    const motif=opsLatestMovementForEmployee(a)?.mouvementMotif||aff?.natureMouvement||"";
    return `<tr>
      <td class="stf-cell-strong">${escapeHTML(fullName(a))}</td>
      <td class="stf-cell-mono">${escapeHTML(a.matricule||"—")}</td>
      <td>${escapeHTML(aff?.poste||a.fonction||"—")}</td>
      <td class="stf-cell-mono">${formatDate(aff?.dateDebut)}</td>
      <td>${motif?escapeHTML(motif):`<span class="stf-text-warn">Motif OM non renseigné</span>`}</td>
      <td><span class="stf-chip stf-chip--violet">Au-delà du contrat (${contractuel})</span></td>
    </tr>`;
  };
  const canOpenMovements=["ops","admin"].includes(session?.transverse)&&!isOpsSupervisorReadOnlySession();
  const more=mainAgents.length>SITE_AFFECTATION_PAGE?`<div class="stf-table-foot"><span data-stf-affect-shown>${SITE_AFFECTATION_PAGE} affiché(s) sur ${mainAgents.length}</span>${opsButtonHTML("Afficher plus",{size:"sm",attrs:`data-site-lock-keep data-stf-affect-more onclick="siteTechAffectShowMore()"`})}</div>`:"";
  const mainBlock=`<div class="stf-subcard">
    <div class="stf-subcard-head"><h3>Effectifs affectés</h3><span class="stf-count" aria-label="${mainAgents.length} employé(s) affecté(s)">${mainAgents.length}${contractuel?" / "+contractuel:""}</span>
      ${mainAgents.length>8?`<label class="stf-search"><span class="ops-sr-only">Rechercher un employé affecté</span>${opsIcon("search")}<input type="search" data-no-lock="1" placeholder="Nom, matricule, poste…" oninput="siteTechAffectFilter(this.value)" onkeydown="if(event.key==='Enter')event.preventDefault()"/></label>`:""}</div>
    ${mainAgents.length?`<div class="stf-table-wrap"><table class="stf-table"><thead><tr><th>Employé</th><th>Matricule</th><th>Poste / fonction</th><th>Date d'affectation</th><th>Groupe</th><th>Situation</th></tr></thead><tbody id="site-affectation-body">${mainAgents.map(mainRow).join("")}</tbody></table></div><p class="stf-empty" data-stf-affect-empty hidden>Aucun employé ne correspond à la recherche.</p>${more}`:`<p class="stf-empty">Aucun employé affecté.</p>`}
  </div>`;
  const surplusBlock=surplusAgents.length?`<div class="stf-subcard stf-subcard--violet">
    <div class="stf-subcard-head"><h3>Effectifs en surplus</h3><span class="stf-count stf-count--violet">+${surplusAgents.length}</span></div>
    <p class="stf-hint">Ces employés dépassent l'effectif contractuel du site (${contractuel}). L'OM doit mentionner le motif.</p>
    <div class="stf-table-wrap"><table class="stf-table"><thead><tr><th>Employé</th><th>Code</th><th>Fonction</th><th>Date d'affectation</th><th>Motif de l'ordre de mouvement</th><th>Surplus</th></tr></thead><tbody>${surplusAgents.map(surplusRow).join("")}</tbody></table></div>
  </div>`:"";
  return `<div class="stf-notice" role="note">${opsIcon("info")}<div><strong>Lecture seule</strong> — Les employés affichés ici viennent uniquement des ordres de mouvement validés.${canOpenMovements?` Toute modification passe par le workflow des ordres de mouvement.`:""}</div>${canOpenMovements?opsButtonHTML("Ordres de mouvement",{size:"sm",icon:"swap",attrs:`data-site-lock-keep onclick="navigate('ops/mouvements')"`}):""}</div>${mainBlock}${surplusBlock}`;
}

function siteTechAffectFilter(query){
  const q=normalizedSearchText(String(query||"").trim());
  const rows=[...document.querySelectorAll("#site-affectation-body [data-stf-affect-row]")];
  let shown=0;
  rows.forEach((row,i)=>{
    const match=!q||String(row.dataset.search||"").includes(q);
    const paged=q?false:row.hasAttribute("data-stf-more");
    row.hidden=!match||paged;
    if(!row.hidden)shown++;
  });
  const empty=document.querySelector("[data-stf-affect-empty]");
  if(empty)empty.hidden=shown>0;
  const foot=document.querySelector("[data-stf-affect-shown]");
  if(foot)foot.textContent=`${shown} affiché(s) sur ${rows.length}`;
}

function siteTechAffectShowMore(){
  const pending=[...document.querySelectorAll("#site-affectation-body [data-stf-more]")];
  pending.slice(0,SITE_AFFECTATION_PAGE).forEach(row=>{row.removeAttribute("data-stf-more");row.hidden=false});
  const rows=document.querySelectorAll("#site-affectation-body [data-stf-affect-row]");
  const shown=[...rows].filter(r=>!r.hidden).length;
  const foot=document.querySelector("[data-stf-affect-shown]");
  if(foot)foot.textContent=`${shown} affiché(s) sur ${rows.length}`;
  if(!document.querySelector("#site-affectation-body [data-stf-more]"))document.querySelector("[data-stf-affect-more]")?.remove();
}

function siteRotationOptionsHTML(selected){
  return ["24/48","3x8","1/3","1/2","1/1"].map(x=>`<option value="${x}" ${selected===x?"selected":""}>${x}</option>`).join("");
}

function sitePosteRowHTML(p,v){
  v=v||{total:0,jour:0,nuit:0,rotationSystem:""};
  const postes=[...new Set([...POSTES_SITE,(p&&!POSTES_SITE.includes(p)?[p]:[])])];
  const totalCalc=sitePosteTotalCalc(+v.jour||0,+v.nuit||0,v.rotationSystem||"");
  return`<tr class="site-poste-row">
    <td><select class="select" name="poste_nom" aria-label="Poste / fonction" onchange="siteTechRenderPosteErrors()"><option value="">— Choisir poste —</option>${postes.map(x=>`<option value="${escapeHTML(x)}" ${p===x?"selected":""}>${escapeHTML(x)}</option>`).join("")}</select></td>
    <td><input class="input bg-slate-100 stf-num" type="number" min="0" name="poste_total" value="${totalCalc}" aria-label="Total contractuel du poste (calculé)" readonly/></td>
    <td><input class="input stf-num" type="number" min="0" step="1" name="poste_jour" value="${v.jour||0}" aria-label="Effectif de jour du poste" oninput="updateSitePosteTotal(this.closest('tr'))"/></td>
    <td><input class="input stf-num" type="number" min="0" step="1" name="poste_nuit" value="${v.nuit||0}" aria-label="Effectif de nuit du poste" oninput="updateSitePosteTotal(this.closest('tr'))"/></td>
    <td><select class="select" name="poste_rotationSystem" aria-label="Système de rotation du poste" onchange="updateSitePosteTotal(this.closest('tr'))"><option value="">—</option>${siteRotationOptionsHTML(v.rotationSystem||"")}</select></td>
    <td class="stf-cell-action">${isOpsSupervisorReadOnlySession()?"":opsButtonHTML("Retirer",{variant:"danger",size:"sm",icon:"trash",attrs:`aria-label="Retirer ce poste" onclick="this.closest('tr').remove();updateSiteEffectifTotalContractuel()"`})}</td>
  </tr>`;
}

// Contrôles de cohérence de la liste des postes, affichés avant l'enregistrement. Ils ne
// changent aucun calcul : ils empêchent seulement qu'une ligne soit ignorée ou écrasée
// silencieusement par saveSite (poste en double, quantités sans poste, valeur négative).
function siteTechPosteErrors(){
  const errors=[];
  const seen=new Map();
  document.querySelectorAll("#site-postes-body tr.site-poste-row").forEach((row,i)=>{
    const nom=String(row.querySelector('[name="poste_nom"]')?.value||"").trim();
    const jourRaw=row.querySelector('[name="poste_jour"]')?.value,nuitRaw=row.querySelector('[name="poste_nuit"]')?.value;
    const jour=+jourRaw||0,nuit=+nuitRaw||0;
    const line=`Ligne ${i+1}`;
    if(jour<0||nuit<0)errors.push(`${line}${nom?" ("+nom+")":""} : les effectifs ne peuvent pas être négatifs.`);
    if([jourRaw,nuitRaw].some(v=>v!==""&&v!=null&&!Number.isInteger(+v)))errors.push(`${line}${nom?" ("+nom+")":""} : les effectifs doivent être des nombres entiers.`);
    if(!nom&&(jour||nuit))errors.push(`${line} : choisissez un poste, sinon ses effectifs ne seront pas enregistrés.`);
    if(nom){
      if(seen.has(nom))errors.push(`« ${nom} » apparaît deux fois (lignes ${seen.get(nom)} et ${i+1}) : regroupez les effectifs sur une seule ligne.`);
      else seen.set(nom,i+1);
    }
  });
  return errors;
}

function siteTechRenderPosteErrors(){
  const box=document.getElementById("site-postes-errors");
  if(!box)return [];
  if(document.getElementById("site-form")?.dataset.dcContractLocked==="1"){box.hidden=true;box.innerHTML="";return []}
  const errors=siteTechPosteErrors();
  box.hidden=!errors.length;
  box.innerHTML=errors.length?`${opsIcon("alert")}<div><strong>Contrôle de cohérence des postes</strong><ul>${errors.map(e=>`<li>${escapeHTML(e)}</li>`).join("")}</ul></div>`:"";
  return errors;
}

function sitePosteTotalCalc(jour,nuit,rotationSystem){
  jour=+jour||0;nuit=+nuit||0;
  return rotationSystem==="1/1" ? jour+nuit : (jour+nuit)*2;
}

function updateSitePosteTotal(row){
  if(!row)return;
  const jour=+row.querySelector('[name="poste_jour"]')?.value||0;
  const nuit=+row.querySelector('[name="poste_nuit"]')?.value||0;
  const rot=row.querySelector('[name="poste_rotationSystem"]')?.value||"";
  const total=row.querySelector('[name="poste_total"]');
  if(total)total.value=sitePosteTotalCalc(jour,nuit,rot);
  updateSiteEffectifTotalContractuel();
}

function updateSiteEffectifTotalContractuel(){
  if(document.getElementById("site-form")?.dataset.dcContractLocked==="1")return;
  const totalTarget=document.querySelector('[name="eff_totalContractuel"]');
  const jourTarget=document.querySelector('[name="eff_jour"]');
  const nuitTarget=document.querySelector('[name="eff_nuit"]');
  let total=0,jour=0,nuit=0;
  document.querySelectorAll('#site-postes-body tr').forEach(row=>{
    total+=+row.querySelector('[name="poste_total"]')?.value||0;
    jour+=+row.querySelector('[name="poste_jour"]')?.value||0;
    nuit+=+row.querySelector('[name="poste_nuit"]')?.value||0;
  });
  if(totalTarget)totalTarget.value=total;
  if(jourTarget)jourTarget.value=jour;
  if(nuitTarget)nuitTarget.value=nuit;
  siteTechRenderPosteErrors();
}

function sitePostesTableHTML(site){
  const names=Object.keys(site.postes||{}).filter(p=>{
    const v=site.postes?.[p]||{};
    return (+v.total||0)||(+v.jour||0)||(+v.nuit||0)||v.rotationSystem;
  });
  const rows=names.map(p=>sitePosteRowHTML(p,site.postes?.[p])).join("");
  return rows||(site?.isNew?sitePosteRowHTML("",{total:0,jour:0,nuit:0,rotationSystem:""}):"");
}

function addSitePosteRow(){
  const body=document.getElementById("site-postes-body");if(!body)return;
  body.insertAdjacentHTML("beforeend",sitePosteRowHTML("",{total:0,jour:0,nuit:0}));
  updateSiteEffectifTotalContractuel();
  const last=body.querySelector("tr:last-child select[name='poste_nom']");
  if(last)last.focus();
}

function siteMaterielStoreIdsFromItem(item){
  item=item||{};
  if(Array.isArray(item.magasinIds)&&item.magasinIds.length)return item.magasinIds.map(String);
  if(item.magasinId)return [String(item.magasinId)];
  const names=String(item.categorie||"").split(/[,+/|;]/).map(x=>x.trim()).filter(Boolean);
  return (db.magasins||[]).filter(m=>names.includes(m.nom)||names.includes(String(m.id))).map(m=>String(m.id));
}

function siteMaterielStoreOptionsHTML(selectedIds){
  const selected=new Set((selectedIds||[]).map(String));
  return (db.magasins||[]).map(m=>{
    // Normalize nom — handles both API format (nom from storeFromApi) and any legacy local format (name)
    const nom=m.nom||m.name||"";
    const normalizedM=nom===m.nom?m:{...m,nom};
    const label=dotationMagasinLabel?dotationMagasinLabel(normalizedM):nom||"Magasin";
    const society=m.societe||"";
    return `<option value="${escapeHTML(m.id)}" ${selected.has(String(m.id))?"selected":""}>${m.icon||"🏬"} ${escapeHTML(label||"Magasin")}${society?` · ${escapeHTML(society)}`:""}</option>`;
  }).join("");
}

function siteMaterielArticlesForStores(storeIds){
  const ids=(storeIds||[]).map(String).filter(Boolean);
  return (db.stockArticles||[]).filter(a=>ids.some(id=>stockArticleBelongsToStore(a,id))).sort((a,b)=>((a.designation||"").localeCompare(b.designation||"")));
}

function siteMaterielArticleOptionsHTML(storeIds,item){
  item=item||{};
  const selectedArticleIds=new Set([item.articleId,item.stockArticleId].map(v=>String(v||"")).filter(Boolean));
  const articles=siteMaterielArticlesForStores(storeIds);
  const legacyDesignation=String(item.designation||"").trim();
  return `<option value="">${storeIds&&storeIds.length?(articles.length?"— Choisir article disponible —":"— Aucun article disponible —"):"— Choisir magasin —"}</option>${articles.map(a=>{
    const checked=selectedArticleIds.has(String(a.id))||(!selectedArticleIds.size&&legacyDesignation&&legacyDesignation===String(a.designation||""));
    const stock=typeof dotationStockDisponible==="function"?dotationStockDisponible(a):stockGetActuel(a.id);
    return `<option value="${escapeHTML(a.id)}" data-stock="${escapeHTML(String(stock))}" ${checked?"selected":""}>${escapeHTML(a.designation||"Article")}${a.code?` · ${escapeHTML(a.code)}`:""} · disponible: ${qty(stock)} ${escapeHTML(a.unite||"")}</option>`;
  }).join("")}`;
}

function siteMaterielRowHTML(item){
  item=item||{};
  const storeIds=siteMaterielStoreIdsFromItem(item);
  const magasinId=storeIds[0]||"";
  const article=(db.stockArticles||[]).find(a=>String(a.id)===String(item.articleId||item.stockArticleId||""));
  const serials=article&&typeof dotationCodeSerieOptions==="function"?dotationCodeSerieOptions(article):[];
  const serialValue=String(item.codeSerie||item.numeroSerie||item.reference||"");
  const datalistId=`site-mat-refs-${Math.random().toString(36).slice(2)}`;
  return`<tr class="site-materiel-row">
    <td><select class="select" name="site_mat_magasinId" aria-label="Magasin" onchange="siteMaterielMagasinChanged(this)"><option value="">— Choisir magasin —</option>${siteMaterielStoreOptionsHTML([magasinId])}</select></td>
    <td><select class="select" name="site_mat_articleId" aria-label="Article disponible" onchange="siteMaterielArticleChanged(this)">${siteMaterielArticleOptionsHTML(magasinId?[magasinId]:[],item)}</select><div class="stf-cell-note" data-site-mat-stock-info>${article?`Stock disponible : ${qty(dotationStockDisponible(article))} ${escapeHTML(article.unite||"")}`:"Choisissez un article du magasin."}</div></td>
    <td><input class="input text-center stf-num" type="number" min="1" step="1" name="site_mat_quantite" aria-label="Quantité" value="${escapeHTML(String(item.quantite||item.qte||1))}"/></td>
    <td><input class="input" name="site_mat_codeSerie" aria-label="Numéro de série ou référence" list="${datalistId}" value="${escapeHTML(serialValue)}" placeholder="N° série / réf"/><datalist id="${datalistId}">${serials.map(v=>`<option value="${escapeHTML(v)}"></option>`).join("")}</datalist></td>
    <td><select class="select" name="site_mat_etat" aria-label="État"><option value="neuf" ${String(item.etat||"neuf")==="neuf"?"selected":""}>Neuf</option><option value="rénové" ${String(item.etat||"")==="rénové"?"selected":""}>Rénové</option><option value="usagé" ${String(item.etat||"")==="usagé"?"selected":""}>Usagé</option><option value="réformé" ${String(item.etat||"")==="réformé"?"selected":""}>Réformé</option></select></td>
    <td><input class="input" name="site_mat_observation" aria-label="Observation" value="${escapeHTML(item.observation||item.notes||"")}" placeholder="Observation"/><input type="hidden" name="site_mat_backendId" value="${escapeHTML(item.backendId||"")}"/><input type="hidden" name="site_mat_equipmentBackendId" value="${escapeHTML(item.equipmentBackendId||"")}"/></td>
    <td class="stf-cell-action">${isOpsSupervisorReadOnlySession()?"":opsButtonHTML("Retirer",{variant:"danger",size:"sm",icon:"trash",attrs:`aria-label="Retirer cet article" onclick="this.closest('tr').remove()"`})}</td>
  </tr>`;
}

async function siteMaterielMagasinChanged(sel){
  const row=sel.closest(".site-materiel-row");if(!row)return;
  const ids=[sel.value].filter(Boolean);
  const articleSel=row.querySelector('[name="site_mat_articleId"]');
  if(!siteMaterielArticlesForStores(ids).length&&ids.length&&sgdiAuthToken()&&SGDI?.stock?.articles){
    const mag=(db.magasins||[]).find(m=>String(m.id)===ids[0]);
    if(mag?.backendId){
      try{
        const rows=await SGDI.stock.articles({store_id:mag.backendId});
        if(Array.isArray(rows)&&rows.length)mergeDotationArticlesFromApi(rows);
      }catch(e){console.warn("siteMaterielMagasinChanged: article load failed",e);}
    }
  }
  if(articleSel)articleSel.innerHTML=siteMaterielArticleOptionsHTML(ids,{});
  siteMaterielArticleChanged(articleSel);
}

function siteMaterielArticleChanged(sel){
  const row=sel?.closest?.(".site-materiel-row");if(!row)return;
  const article=(db.stockArticles||[]).find(a=>String(a.id)===String(sel.value));
  const info=row.querySelector("[data-site-mat-stock-info]");
  if(info)info.innerHTML=article?`Stock disponible : <b class="${dotationStockDisponible(article)>0?"text-emerald-700":"text-red-700"}">${qty(dotationStockDisponible(article))} ${escapeHTML(article.unite||"")}</b>`:"Choisissez un article du magasin.";
}

function siteMaterielTableHTML(site){
  return (site.equipements||site.materiel||[]).map(siteMaterielRowHTML).join("");
}

function addSiteMaterielRow(){
  const body=document.getElementById("site-materiel-body");if(!body)return;
  body.insertAdjacentHTML("beforeend",siteMaterielRowHTML({}));
  const last=body.querySelector("tr:last-child [name='site_mat_magasinId']");
  if(last)last.focus();
}

function siteCanEditFromCurrentModule(site){
  if(site?.isNew)return true;
  if(isAdminSystemSession())return true;
  if(session?.transverse==="ops"&&!isOpsSupervisorReadOnlySession())return true;
  if(site?.ficheTechniqueLocked||site?.siteFormLocked)return false;
  if(session?.transverse==="materiel")return false;
  return ["admin","ops"].includes(session?.transverse);
}

function siteDocumentsEntries(site){
  const docs={...(site?.documentsArchive||{}),...(site?.documents||{})};
  return Object.entries(docs).filter(([,d])=>d&&d.url).sort(([,x],[,y])=>String(y.createdAt||y.date||"").localeCompare(String(x.createdAt||x.date||"")));
}

function siteArchivedDocumentsHTML(site){
  const entries=siteDocumentsEntries(site);
  if(!entries.length)return `<div class="text-sm text-slate-500 p-6 rounded bg-slate-50 border border-slate-200 text-center">Aucun document archivé pour ce site.</div>`;
  return `<div class="card overflow-hidden"><table><thead><tr><th>Date</th><th>Type document</th><th>Nom fichier</th><th>Source</th><th>Statut</th><th>Ajouté par</th><th class="text-right">Action</th></tr></thead><tbody>${entries.map(([key,d])=>`<tr data-searchable><td class="text-xs">${formatDate(d.date||d.createdAt)}</td><td class="font-semibold">${escapeHTML(d.title||d.type||key)}</td><td class="text-xs">${escapeHTML(d.name||d.reference||"—")}</td><td class="text-xs">${escapeHTML(d.source||d.category||"Site")}</td><td><span class="pill ${String(d.status||d.statut||"").toLowerCase().includes("expir")?"pill-red":String(d.status||d.statut||"").toLowerCase().includes("valid")?"pill-green":"pill-blue"}">${escapeHTML(d.status||d.statut||"reçu")}</span></td><td class="text-xs">${escapeHTML(d.createdBy||"—")}</td><td class="text-right"><button type="button" class="btn btn-secondary text-xs" onclick="viewSiteArchivedDoc('${jsString(site.id||site.backendId||site.indicatif)}','${jsString(key)}','${jsString(d.title||d.name||"Document")}')">Voir</button></td></tr>`).join("")}</tbody></table></div>`;
}

function viewSiteArchivedDoc(siteId,key,label){
  const site=findSiteByRef(siteId);
  const d=site&&((site.documentsArchive&&site.documentsArchive[key])||(site.documents&&site.documents[key]));
  const url=employeeArchivedDocumentUrl(d);
  if(!d||!url){toast(`Archive site incomplète à régénérer : ${label}`,"error");return}
  viewDocA4(url,d.name||label);
}

function openSiteDocumentsModal(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  const eff=siteEffectifsNorm(site);
  openModal(`<h3 class="font-bold text-lg mb-2">Documents site</h3>
    <div class="p-3 rounded bg-slate-50 border border-slate-200 mb-4">
      <div class="font-black">${escapeHTML(site.nom||"Site")}</div>
      <div class="text-xs text-slate-500">${escapeHTML(site.indicatif||"—")} · ${escapeHTML(site.client||"Sans client")} · Effectif contrat : ${eff.totalContractuel||0}</div>
    </div>
    <div>${siteArchivedDocumentsHTML(site)}</div>
    <div class="flex justify-end mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function siteDemandesList(site){
  const keys=[site?.nom,site?.indicatif,site?.client].map(v=>String(v||"").trim().toLowerCase()).filter(Boolean);
  if(!keys.length)return [];
  return [...(db.demandesStructure||[]),...(db.demandesPersonnel||[])].filter(d=>{
    const hay=[d.site,d.siteName,d.siteNom,d.objet,d.message,d.client,d.payloadOriginal?.site?.nom,d.payloadOriginal?.siteName].map(v=>String(v||"").trim().toLowerCase()).join(" ");
    return keys.some(k=>hay.includes(k));
  }).sort((a,b)=>String(b.createdAt||b.date||"").localeCompare(String(a.createdAt||a.date||"")));
}

function siteDemandesHTML(site){
  const rows=siteDemandesList(site);
  if(!rows.length)return `<div class="text-sm text-slate-500 p-6 rounded bg-slate-50 border border-slate-200 text-center">Aucune demande liée à ce site.</div>`;
  return `<div class="card overflow-hidden"><table><thead><tr><th>Date</th><th>Objet</th><th>Type</th><th>Statut</th><th>Source</th></tr></thead><tbody>${rows.map(d=>`<tr data-searchable><td class="text-xs">${formatDate(d.date||d.createdAt)}</td><td class="font-semibold">${escapeHTML(d.objet||d.message||"Demande")}</td><td class="text-xs">${escapeHTML(d.typeLabel||d.type||d.categorie||"—")}</td><td><span class="pill ${String(d.statut||"").includes("traite")?"pill-green":String(d.statut||"").includes("rejete")?"pill-red":"pill-blue"}">${escapeHTML(d.statut||"nouveau")}</span></td><td class="text-xs">${escapeHTML(d.source||d.fromStructure||"—")}</td></tr>`).join("")}</tbody></table></div>`;
}

function openSiteDemandesModal(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  openModal(`<h3 class="font-bold text-lg mb-2">Demandes site</h3>
    <div class="p-3 rounded bg-slate-50 border border-slate-200 mb-4">
      <div class="font-black">${escapeHTML(site.nom||"Site")}</div>
      <div class="text-xs text-slate-500">${escapeHTML(site.indicatif||"—")} · ${escapeHTML(site.client||"Sans client")}</div>
    </div>
    <div>${siteDemandesHTML(site)}</div>
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal();navigate('demandes_structure/dashboard')">Ouvrir module demandes</button><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function siteEvenementsList(site){
  const refs=[site?.id,site?.backendId,site?.indicatif,site?.nom].map(v=>String(v||"").trim()).filter(Boolean);
  const ids=new Set([site?.id,site?.backendId].map(v=>String(v||"").trim()).filter(Boolean));
  return (db.incidents||[]).map(incidentNorm).filter(i=>{
    if(ids.has(String(i.siteId||"").trim()))return true;
    const hay=[i.siteName,i.siteNom,i.sujet,i.description,i.categorie].map(v=>String(v||"").toLowerCase()).join(" ");
    return refs.some(r=>hay.includes(r.toLowerCase()));
  }).sort((a,b)=>String(b.createdAt||b.date||"").localeCompare(String(a.createdAt||a.date||"")));
}

function siteEvenementsHTML(site){
  const rows=siteEvenementsList(site);
  if(!rows.length)return `<div class="text-sm text-slate-500 p-6 rounded bg-slate-50 border border-slate-200 text-center">Aucun événement main courante lié à ce site.</div>`;
  return `<div class="card overflow-hidden"><table><thead><tr><th>Date</th><th>Sujet</th><th>Catégorie</th><th>Niveau</th><th>Statut</th><th class="text-right">Action</th></tr></thead><tbody>${rows.map(i=>`<tr data-searchable><td class="text-xs">${formatDate(i.date||i.createdAt)} ${escapeHTML(i.heure||"")}</td><td><div class="font-semibold">${escapeHTML(i.sujet||"Évènement")}</div><div class="text-[10px] text-slate-500">${escapeHTML(String(i.description||"").slice(0,90))}</div></td><td class="text-xs">${escapeHTML(i.categorie||"—")}</td><td><span class="pill ${incidentPillClass(i.gravite)}">${escapeHTML(i.gravite||"—")}</span></td><td><span class="pill ${incidentPillClass(i.statut)}">${escapeHTML(i.statut||"—")}</span></td><td class="text-right"><button type="button" class="btn btn-secondary text-xs" onclick="viewIncident('${jsString(i.id)}')">Voir</button></td></tr>`).join("")}</tbody></table></div>`;
}

function siteBulletinsInformationList(site){
  const rows=[...(Array.isArray(site?.bulletinsInformation)?site.bulletinsInformation:[]),...(Array.isArray(site?.evenementsBI)?site.evenementsBI:[])];
  const seen=new Set();
  return rows.filter(row=>row&&row.reference&&!seen.has(row.reference)&&seen.add(row.reference)).sort((a,b)=>String(b.createdAt||b.dateRapport||"").localeCompare(String(a.createdAt||a.dateRapport||"")));
}

function siteBulletinsInformationHTML(site){
  const rows=siteBulletinsInformationList(site);
  if(!rows.length)return `<div class="text-sm text-slate-500 p-6 rounded bg-slate-50 border border-slate-200 text-center">Aucun bulletin d'information archivé pour ce site.</div>`;
  const levelClass=l=>String(l||"").toLowerCase().includes("elev")?"pill-red":String(l||"").toLowerCase().includes("moy")?"pill-amber":"pill-blue";
  return `<div class="card overflow-hidden"><table><thead><tr><th>Date rapport</th><th>Référence</th><th>Niveau</th><th>Employés concernés</th><th>Synthèse</th></tr></thead><tbody>${rows.map(b=>`<tr data-searchable><td class="text-xs">${formatDate(String(b.dateRapport||b.createdAt||"").slice(0,10))} ${escapeHTML(String(b.dateRapport||"").slice(11,16))}</td><td class="font-mono text-xs font-black">${escapeHTML(b.reference||"—")}</td><td><span class="pill ${levelClass(b.niveau)}">${escapeHTML(b.niveau||"Standard")}</span></td><td class="text-xs">${escapeHTML((b.employes||[]).map(e=>e.code?`${e.code} · ${e.name}`:e.name).join(", ")||"—")}</td><td class="text-xs">${escapeHTML(String(b.redaction||b.evenement||"").slice(0,120))}</td></tr>`).join("")}</tbody></table></div>`;
}

function siteMovementRows(site){
  return opsMovementRows().filter(f=>siteMatchesReference(site,f)).sort((a,b)=>String(b.date||b.dateDebut||"").localeCompare(String(a.date||a.dateDebut||"")));
}

function siteMovementEventsHTML(site){
  const rows=siteMovementRows(site).slice(0,50);
  if(!rows.length)return `<div class="text-sm text-slate-500 p-6 rounded bg-slate-50 border border-slate-200 text-center">Aucun ordre de mouvement lié à ce site.</div>`;
  return `<div class="card overflow-hidden"><table><thead><tr><th>Date</th><th>N° OM</th><th>Employé</th><th>Motif</th><th class="text-right">Action</th></tr></thead><tbody>${rows.map(f=>`<tr data-searchable><td class="text-xs">${formatDate(f.date||f.dateDebut)}</td><td class="font-mono text-xs font-black">${escapeHTML(f.ordreMouvementNumero||f.mouvementNumero||"—")}</td><td class="text-xs font-semibold">${escapeHTML(opsMovementAgentLabel(f._agent))}</td><td class="text-xs">${escapeHTML(f.mouvementMotif||f.mouvementType||"—")}</td><td class="text-right"><button type="button" class="btn btn-secondary text-xs" onclick="opsOpenMovementDocumentByRow('${jsString(f.id||"")}')">OM</button></td></tr>`).join("")}</tbody></table></div>`;
}

function siteEventDateRowHTML(value=""){
  return `<div class="flex gap-2 items-center mb-2" data-bi-date-row><input class="input" type="date" name="biEventDate" value="${escapeHTML(value)}"/><button type="button" class="btn btn-ghost text-xs text-red-600" onclick="this.closest('[data-bi-date-row]').remove()">Retirer</button></div>`;
}

function siteEventTimeRowHTML(value=""){
  return `<div class="flex gap-2 items-center mb-2" data-bi-time-row><input class="input" type="time" name="biEventTime" value="${escapeHTML(value)}"/><button type="button" class="btn btn-ghost text-xs text-red-600" onclick="this.closest('[data-bi-time-row]').remove()">Retirer</button></div>`;
}

function addSiteEventDateField(){document.getElementById("site-bi-dates")?.insertAdjacentHTML("beforeend",siteEventDateRowHTML(today()))}

function addSiteEventTimeField(){document.getElementById("site-bi-times")?.insertAdjacentHTML("beforeend",siteEventTimeRowHTML(new Date().toTimeString().slice(0,5)))}

function siteAgentsForBulletin(site){
  const sid=String(site?.id||"");
  const soc=siteSafeSociete(site)||site?.societe||"";
  return (db.agents||[]).filter(a=>String(a.statut||"").toLowerCase()==="actif"&&(!soc||a.societe===soc)).sort((a,b)=>opsMovementAgentLabel(a).localeCompare(opsMovementAgentLabel(b))).sort((a,b)=>{
    const as=String(agentLiveAffectation(a)?.siteId||"")===sid?0:1;
    const bs=String(agentLiveAffectation(b)?.siteId||"")===sid?0:1;
    return as-bs;
  });
}

function siteBulletinDraftFromForm(form){
  const fd=new FormData(form);
  const site=findSiteByRef(fd.get("siteId"));
  const employeeIds=fd.getAll("employeeIds").map(String).filter(Boolean);
  const employees=employeeIds.map(id=>findEmployeeByRef(id)||(db.agents||[]).find(a=>String(a.id)===String(id)||String(a.backendId||"")===String(id))).filter(Boolean);
  const reportAt=String(fd.get("reportAt")||new Date().toISOString().slice(0,16));
  return {
    site,
    siteId:site?.id||"",
    siteBackendId:site?.backendId||"",
    reference:String(fd.get("reference")||"").trim()||("BI-"+new Date().toISOString().slice(0,10).replaceAll("-","")+"-"+String(site?.indicatif||site?.id||"SITE").replace(/\W+/g,"").toUpperCase()+"-"+Math.floor(Math.random()*900+100)),
    reportAt,
    niveau:String(fd.get("niveau")||"Standard"),
    eventDates:fd.getAll("biEventDate").map(String).filter(Boolean),
    eventTimes:fd.getAll("biEventTime").map(String).filter(Boolean),
    conduite:String(fd.get("conduite")||"").trim(),
    redaction:String(fd.get("redaction")||"").trim(),
    employees
  };
}

function siteBulletinInformationHTML(draft){
  const site=draft.site||{};
  const employeeRows=(draft.employees||[]).map(a=>`<tr><td>${escapeHTML(a.matricule||a.code||"—")}</td><td>${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())}</td><td>${escapeHTML(agentLiveAffectation(a)?.poste||a.fonction||a.position||"—")}</td><td>${escapeHTML(agentLiveAffectation(a)?.siteName||"—")}</td></tr>`).join("")||`<tr><td colspan="4" style="text-align:center;color:#64748b">Aucun employé concerné sélectionné.</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(draft.reference)}</title><style>
    @page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:12px}.bi{max-width:190mm;margin:0 auto;padding:8mm}.head{display:grid;grid-template-columns:30mm 1fr 42mm;gap:8mm;align-items:center;border-bottom:2px solid #043970;padding-bottom:4mm}.logo{width:27mm;height:27mm;object-fit:contain}.title{text-align:center}.title b{display:block;font-size:22px;color:#043970;letter-spacing:.04em}.title span{font-size:12px;font-weight:800;color:#64748b}.ref{font-size:11px;text-align:right;line-height:1.7}.grid{display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin-top:5mm}.box{border:1px solid #cbd5e1;border-radius:4px;padding:3mm;min-height:14mm}.box b{display:block;color:#043970;font-size:10px;text-transform:uppercase;margin-bottom:1.5mm}.wide{grid-column:1/-1}.level{display:inline-block;border-radius:999px;padding:2mm 5mm;font-weight:900;color:#fff;background:#043970}.level.high{background:#dc2626}.level.mid{background:#d97706}.text{white-space:pre-wrap;line-height:1.55;font-size:12.5px}.emp{width:100%;border-collapse:collapse;margin-top:2mm}.emp th,.emp td{border:1px solid #dbe3ef;padding:2mm;text-align:left}.emp th{background:#edf4fb;color:#043970;font-size:10px;text-transform:uppercase}.sign{display:grid;grid-template-columns:1fr 1fr;gap:18mm;margin-top:12mm}.sign div{border-top:1px solid #111;text-align:center;padding-top:2mm;font-weight:900}@media print{.no-print{display:none!important}.bi{padding:0}}
  </style></head><body><main class="bi">
    <div class="head">${sgdiDocumentLogoHTML(site.societe||site.company||draft.societe,"logo")}<div class="title"><b>BULLETIN D'INFORMATION</b><span>Événement site / rapport opérationnel</span></div><div class="ref">Réf : <b>${escapeHTML(draft.reference)}</b><br/>Établi le : <b>${escapeHTML(formatDate(String(draft.reportAt).slice(0,10)))} ${escapeHTML(String(draft.reportAt).slice(11,16))}</b></div></div>
    <section class="grid">
      <div class="box"><b>Site</b>${escapeHTML(site.nom||"Site")}<br><small>${escapeHTML(site.indicatif||"—")} · ${escapeHTML(site.client||"Sans client")}</small></div>
      <div class="box"><b>Niveau de l'événement</b><span class="level ${String(draft.niveau).toLowerCase().includes("elev")?"high":String(draft.niveau).toLowerCase().includes("moy")?"mid":""}">${escapeHTML(draft.niveau)}</span></div>
      <div class="box"><b>Date(s) de l'événement</b>${(draft.eventDates||[]).map(formatDate).join(" · ")||"—"}</div>
      <div class="box"><b>Heure(s)</b>${(draft.eventTimes||[]).join(" · ")||"—"}</div>
      <div class="box wide"><b>Employé(s) concerné(s)</b><table class="emp"><thead><tr><th>Code</th><th>Nom et prénom</th><th>Poste</th><th>Affectation</th></tr></thead><tbody>${employeeRows}</tbody></table></div>
      <div class="box wide"><b>Rédaction de l'événement</b><div class="text">${escapeHTML(draft.redaction||"—")}</div></div>
      <div class="box wide"><b>Conduite tenue et instruction données</b><div class="text">${escapeHTML(draft.conduite||"—")}</div></div>
    </section>
    <div class="sign"><div>Établi par OPS</div><div>Visa / Direction</div></div>
  </main></body></html>`;
}

function siteBulletinControlsHTML(meta){
  const metaJson=JSON.stringify(meta||{}).replace(/<\//g,"<\\/");
  return `<section class="no-print" style="position:sticky;top:0;z-index:999;background:#fff;border-bottom:1px solid #dbe3ef;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:12px 18px;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:980px;margin:0 auto;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div><div style="font-weight:900;color:#043970">BULLETIN D'INFORMATION</div><div id="site-bi-state" style="font-size:12px;color:#64748b;margin-top:2px">Validez le BI pour l'archiver dans la fiche site et les fiches employés sélectionnées.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button id="site-bi-validate" style="border:0;border-radius:8px;background:#047857;color:#fff;padding:9px 14px;font-weight:900;cursor:pointer">Valider BI</button><button id="site-bi-print" disabled style="border:0;border-radius:8px;background:#111827;color:#fff;padding:9px 14px;font-weight:900;cursor:pointer;opacity:.45">Imprimer BI</button><button id="site-bi-close" style="border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;padding:9px 14px;font-weight:800;cursor:pointer">Fermer</button></div>
    </div>
  </section><script>window.SGDI_SITE_BI_META=${metaJson};(function(){const v=document.getElementById("site-bi-validate"),p=document.getElementById("site-bi-print"),c=document.getElementById("site-bi-close"),s=document.getElementById("site-bi-state");function setPrint(on){if(!p)return;p.disabled=!on;p.style.opacity=on?"1":".45"}if(v)v.addEventListener("click",async()=>{v.disabled=true;v.style.opacity=".45";if(s){s.textContent="Archivage BI en cours...";s.style.color="#64748b"}let ok=false;try{if(window.opener&&window.opener.archiveSiteBulletinFromWindow)ok=await window.opener.archiveSiteBulletinFromWindow(window,window.SGDI_SITE_BI_META||{});}catch(e){console.error(e)}if(!ok){v.disabled=false;v.style.opacity="1";if(s){s.textContent="Archivage impossible. Vérifiez PostgreSQL puis réessayez.";s.style.color="#dc2626"}return}setPrint(true);if(s){s.textContent="BI validé et archivé. Vous pouvez imprimer.";s.style.color="#047857"}});if(p)p.addEventListener("click",()=>window.print());if(c)c.addEventListener("click",()=>window.close());setPrint(false);})();<\/script>`;
}

function openSiteBulletinInformationForm(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  const now=new Date();
  const reportAt=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const ref="BI-"+today().replaceAll("-","")+"-"+String(site.indicatif||site.id||"SITE").replace(/\W+/g,"").toUpperCase()+"-"+Math.floor(Math.random()*900+100);
  const agents=siteAgentsForBulletin(site);
  openModal(`<h3 class="font-bold text-lg mb-2">Nouveau bulletin d'information</h3>
    <div class="p-3 rounded bg-slate-50 border border-slate-200 mb-4">
      <div class="font-black">${escapeHTML(site.nom||"Site")}</div>
      <div class="text-xs text-slate-500">${escapeHTML(site.indicatif||"—")} · ${escapeHTML(site.client||"Sans client")}</div>
    </div>
    <form id="site-bi-form" onsubmit="event.preventDefault();openSiteBulletinInformationDocument(this)">
      <input type="hidden" name="siteId" value="${escapeHTML(site.id||site.backendId||site.indicatif||"")}"/>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><label class="label">Date et heure de l'établissement du rapport</label><input class="input bg-slate-50" type="datetime-local" name="reportAt" value="${escapeHTML(reportAt)}" readonly/></div>
        <div><label class="label">Référence BI</label><input class="input bg-slate-50" name="reference" value="${escapeHTML(ref)}" readonly/></div>
        <div><label class="label">Niveau de l'événement</label><select class="select" name="niveau"><option>Standard</option><option>Moyen</option><option>Elevé</option></select></div>
        <div><label class="label">Employé(s) concerné(s)</label><select class="select" name="employeeIds" multiple size="6">${agents.map(a=>`<option value="${escapeHTML(a.id)}">${escapeHTML(opsMovementAgentLabel(a))}</option>`).join("")}</select><div class="text-[10px] text-slate-500 mt-1">Maintenez Cmd/Ctrl pour sélectionner plusieurs employés.</div></div>
        <div><div class="flex items-center justify-between gap-2 mb-1"><label class="label mb-0">Date de l'événement</label><button type="button" class="btn btn-secondary text-xs" onclick="addSiteEventDateField()">Ajouter date</button></div><div id="site-bi-dates">${siteEventDateRowHTML(today())}</div></div>
        <div><div class="flex items-center justify-between gap-2 mb-1"><label class="label mb-0">Heure</label><button type="button" class="btn btn-secondary text-xs" onclick="addSiteEventTimeField()">Ajouter horaire</button></div><div id="site-bi-times">${siteEventTimeRowHTML(now.toTimeString().slice(0,5))}</div></div>
        <div class="md:col-span-2"><label class="label">Espace de rédaction de l'événement</label><textarea class="input" name="redaction" rows="6" required placeholder="Décrire les faits, contexte, personnes présentes, impact..."></textarea></div>
        <div class="md:col-span-2"><label class="label">Conduite tenue et instruction données</label><textarea class="input" name="conduite" rows="4" placeholder="Mesures prises, instructions données, suites à donner..."></textarea></div>
      </div>
      <div class="flex justify-end gap-2 mt-4 flex-wrap"><button type="button" class="btn btn-ghost" onclick="openSiteEvenementsModal('${jsString(site.id||site.backendId||site.indicatif)}')">Retour</button><button class="btn btn-primary">Éditer le Bulletin d'information</button></div>
    </form>`);
}

function openSiteBulletinInformationDocument(form){
  const draft=siteBulletinDraftFromForm(form);
  if(!draft.site)return toast("Site introuvable","error");
  if(!draft.redaction)return toast("Rédaction de l'événement obligatoire","error");
  const html=siteBulletinInformationHTML(draft);
  const meta={siteId:draft.site.id,siteBackendId:draft.site.backendId||"",indicatif:draft.site.indicatif||"",employeeIds:(draft.employees||[]).map(a=>a.id),reference:draft.reference,date:String(draft.reportAt||today()).slice(0,10),draft:{reference:draft.reference,dateRapport:draft.reportAt,niveau:draft.niveau,eventDates:draft.eventDates,eventTimes:draft.eventTimes,conduite:draft.conduite,redaction:draft.redaction,employeeIds:(draft.employees||[]).map(a=>a.id)}};
  const w=window.open("","_blank","width=1000,height=800");
  if(!w){toast("Fenêtre Bulletin d'information bloquée par le navigateur","error");return}
  w.document.write(html.replace("<body>","<body>"+siteBulletinControlsHTML(meta)));
  w.document.close();
}

async function archiveSiteBulletinFromWindow(docWindow,meta){
  const site=findSiteByRef(meta?.siteId||meta?.siteBackendId||meta?.indicatif);
  if(!site){toast("Site introuvable pour archivage BI","error");return false}
  const clone=docWindow.document.documentElement.cloneNode(true);
  clone.querySelectorAll(".no-print,script").forEach(el=>el.remove());
  const html="<!doctype html>\n"+clone.outerHTML;
  const reference=meta.reference||("BI-"+today());
  const key=employeeDocumentSafeKey("bulletin_information",reference);
  const employeeIds=(meta.employeeIds||[]).map(String).filter(Boolean);
  const employees=employeeIds.map(id=>findEmployeeByRef(id)||(db.agents||[]).find(a=>String(a.id)===id||String(a.backendId||"")===id)).filter(Boolean);
  if(!String(html||"").trim()){toast("Archivage refusé : contenu du document obligatoire pour PostgreSQL","error");return false}
  const entry={url:"data:text/html;charset=utf-8,"+encodeURIComponent(html),html,name:employeeDocumentFileName("BULLETIN D'INFORMATION",reference),title:"BULLETIN D'INFORMATION",reference,category:"Sites",type:"bulletin_information",date:meta.date||today(),createdAt:new Date().toISOString(),createdBy:session?.username||"OPS",generated:true};
  site.documents=site.documents||{};
  site.documents[key]=entry;
  site.bulletinsInformation=Array.isArray(site.bulletinsInformation)?site.bulletinsInformation:[];
  const draft=meta.draft||{};
  const summary={id:key,reference,dateRapport:draft.dateRapport||new Date().toISOString(),niveau:draft.niveau||"Standard",eventDates:draft.eventDates||[],eventTimes:draft.eventTimes||[],conduite:draft.conduite||"",redaction:draft.redaction||"",employes:employees.map(a=>({id:a.id,backendId:a.backendId||"",code:a.matricule||a.code||"",name:((a.nom||"")+" "+(a.prenom||"")).trim()})),createdAt:new Date().toISOString(),createdBy:session?.username||"OPS"};
  site.bulletinsInformation=[summary,...site.bulletinsInformation.filter(x=>x&&x.reference!==reference)];
  try{await persistSiteToPostgres(site)}catch(e){toast("BI non enregistré PostgreSQL sur le site : "+(e.message||e),"error");return false}
  for(const a of employees){
    const ok=await archiveEmployeeGeneratedDocument(a.id,{html,title:"BULLETIN D'INFORMATION",category:"OPS / Site",type:"bulletin_information",reference,date:meta.date||today(),name:employeeDocumentFileName("BULLETIN D'INFORMATION",reference),key});
    if(!ok)return false;
  }
  if(!(await saveDBAndWaitToast("BI non confirmé")))return false;
  toast("Bulletin d'information archivé dans la fiche site et les fiches employés","success");
  return true;
}

function siteCompteRendusHTML(site){
  const rows=Array.isArray(site?.comptesRendus)?[...site.comptesRendus].sort((a,b)=>String(b.createdAt||b.date||"").localeCompare(String(a.createdAt||a.date||""))):[];
  if(!rows.length)return`<div class="text-sm text-slate-500 p-6 rounded bg-slate-50 border border-slate-200 text-center">Aucun compte rendu enregistré pour ce site.</div>`;
  const impClass=l=>String(l||"").toLowerCase().includes("elev")?"pill-red":String(l||"").toLowerCase().includes("moy")?"pill-amber":"pill-blue";
  return`<div class="card overflow-hidden"><table><thead><tr><th>Date</th><th>N° CR</th><th>Objet</th><th>Importance</th><th>Employés</th></tr></thead><tbody>${rows.map(r=>`<tr data-searchable><td class="text-xs font-mono">${formatDate(String(r.date||r.createdAt||"").slice(0,10))}</td><td class="font-mono text-xs font-black">${escapeHTML(r.numero||"—")}</td><td class="font-semibold">${escapeHTML(String(r.objet||"").slice(0,80))}</td><td><span class="pill ${impClass(r.importance)}">${escapeHTML(r.importance||"Normale")}</span></td><td class="text-xs">${escapeHTML((r.employes||[]).map(e=>e.code?e.code:e.name).join(", ")||"—")}</td></tr>`).join("")}</tbody></table></div>`;
}

function openSiteEvenementsModal(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  openModal(`<h3 class="font-bold text-lg mb-2">Événements site</h3>
    <div class="p-3 rounded bg-slate-50 border border-slate-200 mb-4">
      <div class="font-black">${escapeHTML(site.nom||"Site")}</div>
      <div class="text-xs text-slate-500">${escapeHTML(site.indicatif||"—")} · ${escapeHTML(site.client||"Sans client")}</div>
    </div>
    <div class="flex justify-end gap-2 mb-4 flex-wrap">
      <button type="button" class="btn btn-primary" onclick="closeModal();openSiteCompteRenduForm('${jsString(site.id||site.backendId||site.indicatif)}')">Nouveau Compte Rendu</button>
      <button type="button" class="btn btn-secondary" onclick="openSiteBulletinInformationForm('${jsString(site.id||site.backendId||site.indicatif)}')">Nouveau BI</button>
    </div>
    <div class="mb-4"><h4 class="font-black text-sm mb-2">Comptes rendus d'événement</h4>${siteCompteRendusHTML(site)}</div>
    <div class="mb-4"><h4 class="font-black text-sm mb-2">Bulletins d'information</h4>${siteBulletinsInformationHTML(site)}</div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div><h4 class="font-black text-sm mb-2">Main courante</h4>${siteEvenementsHTML(site)}</div>
      <div><h4 class="font-black text-sm mb-2">Ordres de mouvement</h4>${siteMovementEventsHTML(site)}</div>
    </div>
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal();navigate('incidents/site')">Ouvrir main courante</button><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function crSearchEmployee(query){
  const q=(query||"").toLowerCase().trim();
  const box=document.getElementById("cr-emp-results");
  if(!box)return;
  if(!q){box.classList.add("hidden");return}
  const already=new Set(_crEmployees.map(a=>String(a.id)));
  const matches=(db.agents||[]).filter(a=>a.statut==="actif"&&!already.has(String(a.id))&&[a.nom,a.prenom,a.matricule,a.structure,a.societe,a.fonction].some(v=>String(v||"").toLowerCase().includes(q))).slice(0,10);
  if(!matches.length){box.innerHTML=`<div class="p-2 text-xs text-slate-500">Aucun résultat.</div>`;box.classList.remove("hidden");return}
  box.innerHTML=matches.map(a=>`<div class="p-2 cursor-pointer hover:bg-slate-100 text-sm border-b border-slate-100 last:border-0" onclick="crAddEmployee('${jsString(a.id)}')">${escapeHTML(a.matricule||"—")} · ${escapeHTML((a.nom||"")+" "+(a.prenom||""))} · <span class="text-slate-500">${escapeHTML(a.fonction||"—")}</span></div>`).join("");
  box.classList.remove("hidden");
}

function crAddEmployee(agentId){
  const a=findEmployeeByRef(agentId)||(db.agents||[]).find(x=>String(x.id)===String(agentId)||String(x.backendId||"")===String(agentId));
  if(!a)return;
  if(_crEmployees.find(e=>String(e.id)===String(a.id)))return;
  _crEmployees.push(a);
  crRenderEmployeeList();
  const inp=document.getElementById("cr-emp-search");
  const box=document.getElementById("cr-emp-results");
  if(inp)inp.value="";
  if(box)box.classList.add("hidden");
}

function crRemoveEmployee(agentId){
  _crEmployees=_crEmployees.filter(a=>String(a.id)!==String(agentId));
  crRenderEmployeeList();
}

function crRenderEmployeeList(){
  const list=document.getElementById("cr-emp-list");
  const hidden=document.getElementById("cr-emp-ids");
  if(!list)return;
  list.innerHTML=_crEmployees.length?_crEmployees.map(a=>`<span class="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full mr-1 mb-1">${escapeHTML(a.matricule||"—")} · ${escapeHTML((a.nom||"")+" "+(a.prenom||""))}<button type="button" class="ml-1 text-blue-400 hover:text-red-600 font-bold" onclick="crRemoveEmployee('${jsString(a.id)}')">×</button></span>`).join(""):`<span class="text-xs text-slate-400 italic">Aucun employé ajouté.</span>`;
  if(hidden)hidden.value=_crEmployees.map(a=>a.id).join(",");
}

function addCrSiteRow(){
  const list=document.getElementById("cr-sites-list");
  if(!list)return;
  list.insertAdjacentHTML("beforeend",`<div class="flex gap-2 items-center mb-2" data-cr-site-row><select class="select flex-1">${(db.sites||[]).filter(s=>s.actif!==false).map(s=>`<option value="${escapeHTML(s.id||"")}">${escapeHTML(s.nom||"—")} ${s.indicatif?"("+s.indicatif+")":""}</option>`).join("")}</select><button type="button" class="btn btn-ghost text-xs text-red-600" onclick="this.closest('[data-cr-site-row]').remove()">Retirer</button></div>`);
}

function siteCrNumeroAuto(){
  const nums=(db.sites||[]).flatMap(s=>(s.comptesRendus||[])).map(r=>String(r.numero||"")).filter(Boolean).map(n=>parseInt((n.match(/(\d+)$/)||[])[1]||"0",10)).filter(n=>n>0);
  const next=(nums.length?Math.max(...nums):0)+1;
  return "CR-"+today().replaceAll("-","").slice(2)+"-"+String(next).padStart(4,"0");
}

function openSiteCompteRenduForm(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  _crEmployees=[];
  const numero=siteCrNumeroAuto();
  const allSites=(db.sites||[]).filter(s=>s.actif!==false&&s.id!==site.id);
  openModal(`<h3 class="font-bold text-lg mb-2">Nouveau Compte Rendu d'événement</h3>
    <div class="p-3 rounded bg-slate-50 border border-slate-200 mb-4">
      <div class="font-black">${escapeHTML(site.nom||"Site")}</div>
      <div class="text-xs text-slate-500">${escapeHTML(site.indicatif||"—")} · ${escapeHTML(site.client||"Sans client")}</div>
    </div>
    <form id="site-cr-form" onsubmit="event.preventDefault();openSiteCompteRenduDocument(this)">
      <input type="hidden" name="siteId" value="${escapeHTML(site.id||site.backendId||site.indicatif||"")}"/>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><label class="label">Date</label><input class="input" type="date" name="crDate" value="${today()}" required/></div>
        <div><label class="label">N° Compte Rendu</label><input class="input bg-slate-50" name="crNumero" value="${escapeHTML(numero)}" readonly/></div>
        <div class="md:col-span-2"><label class="label">Objet</label><input class="input" name="crObjet" required placeholder="Objet du compte rendu..."/></div>
        <div class="md:col-span-2">
          <div class="flex items-center justify-between gap-2 mb-2"><label class="label mb-0">Sites concernés</label><button type="button" class="btn btn-secondary text-xs" onclick="addCrSiteRow()">+ Ajouter site</button></div>
          <div id="cr-sites-list"><div class="flex gap-2 items-center mb-2" data-cr-site-row><div class="flex-1 p-2 rounded bg-slate-100 text-sm font-semibold">${escapeHTML(site.nom||"Site")} ${site.indicatif?"("+escapeHTML(site.indicatif)+")":""}</div></div></div>
        </div>
        <div class="md:col-span-2">
          <label class="label">Employés concernés</label>
          <div class="flex gap-2 mb-2"><input class="input flex-1" type="text" id="cr-emp-search" placeholder="Rechercher par nom, matricule, poste..." oninput="crSearchEmployee(this.value)" autocomplete="off"/></div>
          <div id="cr-emp-results" class="hidden max-h-40 overflow-y-auto border border-slate-200 rounded bg-white shadow-sm mb-2"></div>
          <div id="cr-emp-list" class="mb-1"><span class="text-xs text-slate-400 italic">Aucun employé ajouté.</span></div>
          <input type="hidden" id="cr-emp-ids" name="crEmployeeIds"/>
        </div>
        <div class="md:col-span-2">
          <label class="label">Importance</label>
          <div class="flex gap-6">
            <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="crImportance" value="Élevée"/> <span class="font-semibold text-red-700">Élevée</span></label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="crImportance" value="Normale" checked/> <span class="font-semibold text-blue-700">Normale</span></label>
            <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="crImportance" value="Moyenne"/> <span class="font-semibold text-amber-700">Moyenne</span></label>
          </div>
        </div>
        <div class="md:col-span-2"><label class="label">Compte rendu de l'événement</label><textarea class="input" name="crRedaction" rows="6" required placeholder="Décrire les faits, le contexte, les personnes présentes, l'impact..."></textarea></div>
        <div class="md:col-span-2"><label class="label">Conduite tenue et mesures prises</label><textarea class="input" name="crConduite" rows="4" placeholder="Mesures prises, instructions données, suites à donner..."></textarea></div>
      </div>
      <div class="flex justify-end gap-2 mt-4 flex-wrap">
        <button type="button" class="btn btn-ghost" onclick="openSiteEvenementsModal('${jsString(site.id||site.backendId||site.indicatif)}')">Historique des CRs</button>
        <button type="submit" class="btn btn-primary">Aperçu / Imprimer CR</button>
      </div>
    </form>`);
}

function siteCrDraftFromForm(form){
  const fd=new FormData(form);
  const site=findSiteByRef(fd.get("siteId"));
  const extraSites=[...document.querySelectorAll("[data-cr-site-row] select")].map(s=>findSiteByRef(s.value)).filter(Boolean);
  const allSites=[site,...extraSites].filter(Boolean).filter((s,i,arr)=>arr.findIndex(x=>String(x.id)===String(s.id))===i);
  const employeeIds=String(fd.get("crEmployeeIds")||"").split(",").map(s=>s.trim()).filter(Boolean);
  const employees=employeeIds.map(id=>findEmployeeByRef(id)||(db.agents||[]).find(a=>String(a.id)===id||String(a.backendId||"")===id)).filter(Boolean);
  return{site,sites:allSites,employees,numero:String(fd.get("crNumero")||"").trim()||siteCrNumeroAuto(),date:String(fd.get("crDate")||today()),objet:String(fd.get("crObjet")||"").trim(),importance:String(fd.get("crImportance")||"Normale"),redaction:String(fd.get("crRedaction")||"").trim(),conduite:String(fd.get("crConduite")||"").trim()};
}

function siteCompteRenduDocHTML(draft){
  const site=draft.site||{};
  const sites=draft.sites||[site];
  const employees=draft.employees||[];
  const empRows=employees.map(a=>`<tr><td>${escapeHTML(a.matricule||"—")}</td><td>${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())}</td><td>${escapeHTML(agentLiveAffectation(a)?.poste||a.fonction||"—")}</td><td>${escapeHTML(agentLiveAffectation(a)?.siteName||site.nom||"—")}</td></tr>`).join("")||`<tr><td colspan="4" style="text-align:center;color:#64748b">Aucun employé concerné.</td></tr>`;
  const impColor=String(draft.importance||"").toLowerCase().includes("elev")?"#dc2626":String(draft.importance||"").toLowerCase().includes("moy")?"#d97706":"#1d4ed8";
  return`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(draft.numero)}</title><style>
    @page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:12px}.cr{max-width:190mm;margin:0 auto;padding:8mm}.head{display:grid;grid-template-columns:30mm 1fr 46mm;gap:8mm;align-items:center;border-bottom:2px solid #043970;padding-bottom:4mm}.logo{width:27mm;height:27mm;object-fit:contain}.title{text-align:center}.title b{display:block;font-size:20px;color:#043970;letter-spacing:.03em}.title span{font-size:11px;font-weight:800;color:#64748b}.ref{font-size:11px;text-align:right;line-height:1.8}.grid{display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin-top:5mm}.box{border:1px solid #cbd5e1;border-radius:4px;padding:3mm;min-height:14mm}.box b{display:block;color:#043970;font-size:10px;text-transform:uppercase;margin-bottom:1.5mm}.wide{grid-column:1/-1}.imp{display:inline-block;border-radius:999px;padding:2mm 5mm;font-weight:900;color:#fff}.text{white-space:pre-wrap;line-height:1.55;font-size:12.5px}.emp{width:100%;border-collapse:collapse;margin-top:2mm}.emp th,.emp td{border:1px solid #dbe3ef;padding:2mm;text-align:left}.emp th{background:#edf4fb;color:#043970;font-size:10px;text-transform:uppercase}.sign{display:grid;grid-template-columns:1fr 1fr;gap:18mm;margin-top:14mm}.sign div{border-top:1px solid #111;text-align:center;padding-top:2mm;font-weight:900}@media print{.no-print{display:none!important}.cr{padding:0}}
  </style></head><body><main class="cr">
    <div class="head">${sgdiDocumentLogoHTML(site.societe||site.company||draft.societe,"logo")}<div class="title"><b>COMPTE RENDU D'ÉVÉNEMENT</b><span>Rapport opérationnel</span></div><div class="ref">N° : <b>${escapeHTML(draft.numero)}</b><br/>Date : <b>${escapeHTML(formatDate(draft.date))}</b></div></div>
    <section class="grid">
      <div class="box"><b>Site(s) concerné(s)</b>${sites.map(s=>`<div>${escapeHTML(s.nom||"—")} <small style="color:#64748b">${s.indicatif?"("+escapeHTML(s.indicatif)+")":""}</small></div>`).join("")}</div>
      <div class="box"><b>Importance</b><span class="imp" style="background:${impColor}">${escapeHTML(draft.importance||"Normale")}</span></div>
      <div class="box wide"><b>Objet</b><div class="text">${escapeHTML(draft.objet||"—")}</div></div>
      <div class="box wide"><b>Employé(s) concerné(s)</b><table class="emp"><thead><tr><th>Code</th><th>Nom et prénom</th><th>Poste</th><th>Affectation</th></tr></thead><tbody>${empRows}</tbody></table></div>
      <div class="box wide"><b>Compte rendu de l'événement</b><div class="text">${escapeHTML(draft.redaction||"—")}</div></div>
      <div class="box wide"><b>Conduite tenue et mesures prises</b><div class="text">${escapeHTML(draft.conduite||"—")}</div></div>
    </section>
    <div class="sign"><div>Établi par OPS</div><div>Visa / Direction</div></div>
  </main></body></html>`;
}

function siteCrControlsHTML(meta){
  const metaJson=JSON.stringify(meta||{}).replace(/<\//g,"<\\/");
  return`<section class="no-print" style="position:sticky;top:0;z-index:999;background:#fff;border-bottom:1px solid #dbe3ef;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:12px 18px;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:980px;margin:0 auto;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div><div style="font-weight:900;color:#043970">COMPTE RENDU D'ÉVÉNEMENT</div><div id="site-cr-state" style="font-size:12px;color:#64748b;margin-top:2px">Validez le CR pour l'archiver dans la fiche site, puis imprimez.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="site-cr-validate" style="border:0;border-radius:8px;background:#047857;color:#fff;padding:9px 14px;font-weight:900;cursor:pointer">Valider CR</button>
        <button id="site-cr-print" disabled style="border:0;border-radius:8px;background:#111827;color:#fff;padding:9px 14px;font-weight:900;cursor:pointer;opacity:.45">Imprimer CR</button>
        <button id="site-cr-close" style="border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;padding:9px 14px;font-weight:800;cursor:pointer">Fermer</button>
      </div>
    </div>
  </section><script>window.SGDI_SITE_CR_META=${metaJson};(function(){const v=document.getElementById("site-cr-validate"),p=document.getElementById("site-cr-print"),c=document.getElementById("site-cr-close"),s=document.getElementById("site-cr-state");function setPrint(on){if(!p)return;p.disabled=!on;p.style.opacity=on?"1":".45"}if(v)v.addEventListener("click",async()=>{v.disabled=true;v.style.opacity=".45";if(s){s.textContent="Archivage CR en cours...";s.style.color="#64748b"}let ok=false;try{if(window.opener&&window.opener.archiveSiteCompteRenduFromWindow)ok=await window.opener.archiveSiteCompteRenduFromWindow(window,window.SGDI_SITE_CR_META||{});}catch(e){console.error(e)}if(!ok){v.disabled=false;v.style.opacity="1";if(s){s.textContent="Archivage impossible. Vérifiez PostgreSQL puis réessayez.";s.style.color="#dc2626"}return}setPrint(true);if(s){s.textContent="CR validé et archivé. Vous pouvez imprimer.";s.style.color="#047857"}});if(p)p.addEventListener("click",()=>window.print());if(c)c.addEventListener("click",()=>window.close());setPrint(false);})();<\/script>`;
}

function openSiteCompteRenduDocument(form){
  const draft=siteCrDraftFromForm(form);
  if(!draft.site)return toast("Site introuvable","error");
  if(!draft.objet)return toast("L'objet du compte rendu est obligatoire","error");
  if(!draft.redaction)return toast("Le compte rendu de l'événement est obligatoire","error");
  const html=siteCompteRenduDocHTML(draft);
  const meta={siteId:draft.site.id,siteBackendId:draft.site.backendId||"",indicatif:draft.site.indicatif||"",siteIds:(draft.sites||[]).map(s=>s.id),employeeIds:(draft.employees||[]).map(a=>a.id),numero:draft.numero,date:draft.date,draft:{numero:draft.numero,date:draft.date,objet:draft.objet,importance:draft.importance,redaction:draft.redaction,conduite:draft.conduite,employeeIds:(draft.employees||[]).map(a=>a.id),siteIds:(draft.sites||[]).map(s=>s.id)}};
  const w=window.open("","_blank","width=1000,height=800");
  if(!w){toast("Fenêtre Compte Rendu bloquée par le navigateur","error");return}
  w.document.write(html.replace("<body>","<body>"+siteCrControlsHTML(meta)));
  w.document.close();
}

async function archiveSiteCompteRenduFromWindow(docWindow,meta){
  const site=findSiteByRef(meta?.siteId||meta?.siteBackendId||meta?.indicatif);
  if(!site){toast("Site introuvable pour archivage CR","error");return false}
  const clone=docWindow.document.documentElement.cloneNode(true);
  clone.querySelectorAll(".no-print,script").forEach(el=>el.remove());
  const html="<!doctype html>\n"+clone.outerHTML;
  const numero=meta.numero||("CR-"+today().replaceAll("-",""));
  const key=employeeDocumentSafeKey("compte_rendu",numero);
  if(!String(html||"").trim()){toast("Archivage refusé : contenu du document obligatoire pour PostgreSQL","error");return false}
  const entry={url:"data:text/html;charset=utf-8,"+encodeURIComponent(html),html,name:employeeDocumentFileName("COMPTE RENDU",numero),title:"COMPTE RENDU D'ÉVÉNEMENT",reference:numero,category:"Sites",type:"compte_rendu",date:meta.date||today(),createdAt:new Date().toISOString(),createdBy:session?.username||"OPS",generated:true};
  site.documents=site.documents||{};
  site.documents[key]=entry;
  site.comptesRendus=Array.isArray(site.comptesRendus)?site.comptesRendus:[];
  const draft=meta.draft||{};
  const employeeIds=(meta.employeeIds||[]).map(String).filter(Boolean);
  const employees=employeeIds.map(id=>findEmployeeByRef(id)||(db.agents||[]).find(a=>String(a.id)===id||String(a.backendId||"")===id)).filter(Boolean);
  const summary={id:key,numero,date:draft.date||today(),objet:draft.objet||"",importance:draft.importance||"Normale",redaction:draft.redaction||"",conduite:draft.conduite||"",employes:employees.map(a=>({id:a.id,backendId:a.backendId||"",code:a.matricule||"",name:((a.nom||"")+" "+(a.prenom||"")).trim()})),siteIds:meta.siteIds||[],createdAt:new Date().toISOString(),createdBy:session?.username||"OPS"};
  site.comptesRendus=[summary,...site.comptesRendus.filter(x=>x&&x.numero!==numero)];
  try{await persistSiteToPostgres(site)}catch(e){toast("CR non enregistré : "+(e.message||e),"error");return false}
  if(!(await saveDBAndWaitToast("CR non confirmé")))return false;
  toast("Compte rendu archivé dans les Documents du site","success");
  return true;
}

function siteTextBlockHTML(value,emptyText){
  const rows=Array.isArray(value)?value.filter(Boolean):String(value||"").split(/\n+/).map(x=>x.trim()).filter(Boolean);
  if(!rows.length)return `<div class="text-sm text-slate-500 p-6 rounded bg-slate-50 border border-slate-200 text-center">${escapeHTML(emptyText)}</div>`;
  return `<div class="card p-4"><ul class="list-disc pl-5 space-y-2 text-sm">${rows.map(r=>`<li>${escapeHTML(r)}</li>`).join("")}</ul></div>`;
}

function openSiteConsignesModal(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  openModal(`<h3 class="font-bold text-lg mb-2">Consignes générales</h3>
    <div class="p-3 rounded bg-slate-50 border border-slate-200 mb-4">
      <div class="font-black">${escapeHTML(site.nom||"Site")}</div>
      <div class="text-xs text-slate-500">${escapeHTML(site.indicatif||"—")} · ${escapeHTML(site.client||"Sans client")}</div>
    </div>
    ${siteTextBlockHTML(site.consignesGenerales||site.consignes||site.consigneGenerale,"Aucune consigne générale enregistrée pour ce site.")}
    <div class="flex justify-end mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function openSiteProceduresModal(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  openModal(`<h3 class="font-bold text-lg mb-2">Procédures site</h3>
    <div class="p-3 rounded bg-slate-50 border border-slate-200 mb-4">
      <div class="font-black">${escapeHTML(site.nom||"Site")}</div>
      <div class="text-xs text-slate-500">${escapeHTML(site.indicatif||"—")} · ${escapeHTML(site.client||"Sans client")}</div>
    </div>
    ${siteTextBlockHTML(site.procedures||site.procedureSite,"Aucune procédure enregistrée pour ce site.")}
    <div class="flex justify-end mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function applySiteFormLock(){
  const form=document.getElementById("site-form");
  if(!form)return;
  if(form.dataset.dcContractLocked==="1"){
    form.querySelectorAll('[name^="eff_"],[name^="poste_"],[name="clientId"],[name="client"],[name="societe"]').forEach(el=>{el.disabled=true;});
  }
  if(form.dataset.locked!=="1")return;
  form.querySelectorAll("input:not([data-no-lock]),select:not([data-no-lock]),textarea:not([data-no-lock])").forEach(el=>{el.disabled=true;el.classList.add("bg-slate-100")});
  form.querySelectorAll("button[data-site-lock-keep]").forEach(btn=>{btn.disabled=false;btn.classList.remove("bg-slate-100")});
}

// Rubriques de la fiche technique : clé, libellé de l'onglet, icône.
const SITE_TECH_SECTIONS=[
  ["identification","Identification","building"],
  ["contact","Contact client","user"],
  ["effectifs","Effectifs","users"],
  ["rotation","Rotation","rotate"],
  ["affectation","Affectation","swap"],
  ["materiel","Matériel","box"],
  ["documents","Documents","file"],
  ["consignes","Consignes","shield"],
  ["procedures","Procédures","clipboard"]
];

function siteTechClientName(site){
  const client=(db.clients||[]).find(c=>String(c.backendId||c.id||"")===String(site.clientId||""));
  return client?.nom||client?.raisonSociale||site.client||"—";
}

function siteTechLatestDate(...values){
  return values.map(v=>String(v||"").trim()).filter(Boolean).sort().at(-1)||"";
}

function siteTechnicalIdentityHTML(site,opts){
  const o=opts||{};
  const clientName=siteTechClientName(site);
  const client=(db.clients||[]).find(c=>String(c.backendId||c.id||"")===String(site.clientId||""));
  const serviceLines=String(client?.prestationsServices||site.prestationsServices||site.prestation||"")
    .split(/\n+/).map(line=>line.trim()).filter(Boolean);
  const prestation=serviceLines[0]||site.prestationNom||"";
  const detail=serviceLines.slice(1).join(" · ")||site.prestationDetail||site.detailPrestation||"";
  const archived=site.actif===false||site.archived||String(site.statut||"").toLowerCase()==="archive";
  const status=archived?`<span class="stf-status stf-status--off">${opsIcon("archive")}Site ${site.archived||String(site.statut||"").toLowerCase()==="archive"?"archivé":"inactif"}</span>`:`<span class="stf-status stf-status--on">${opsIcon("check")}Site actif</span>`;
  const lock=o.locked?`<span class="stf-status stf-status--lock">${opsIcon("shield")}Fiche verrouillée</span>`:"";
  const created=site.dateCreation||site.createdAt||"";
  const updated=siteTechLatestDate(site.updatedAt,site.lockedAt);
  const field=(label,value,cls)=>`<div class="stf-id-field${cls?" "+cls:""}"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value||"—")}</dd></div>`;
  return `<header class="stf-head site-editor-wide" aria-label="En-tête de la fiche technique">
    <nav class="stf-crumb" aria-label="Fil d'Ariane"><span>OPS</span><span aria-hidden="true">›</span><a href="#/sites/actifs">Sites</a><span aria-hidden="true">›</span><span class="stf-crumb-site">${escapeHTML(site.nom||"Site")}</span><span aria-hidden="true">›</span><strong aria-current="page">Fiche technique</strong></nav>
    <div class="stf-head-row">
      <div class="stf-title">${opsIcon("clipboard","stf-title-icon")}<div><h1 data-keep-case>FICHE TECHNIQUE SITE</h1><p>Gestion complète des informations du site et de ses effectifs</p></div></div>
      <div class="stf-head-side">
        <div class="stf-head-meta">${status}${lock}${created||updated?`<dl class="stf-dates">${created?`<div><dt>Créé le</dt><dd>${formatDate(created)}</dd></div>`:""}${updated?`<div><dt>Dernière modification le</dt><dd>${formatDate(updated)}</dd></div>`:""}</dl>`:""}</div>
        ${o.toolbar?`<div class="stf-toolbar" role="group" aria-label="Actions du site">${o.toolbar}</div>`:""}
      </div>
    </div>
  </header>
  <section class="stf-identity site-editor-wide" aria-label="Identité du site">
    <div class="stf-identity-mark">${opsIcon("building")}</div>
    <dl class="stf-identity-grid">
      ${field("Client",clientName,"is-lead")}
      ${field("Dénomination",site.nom,"is-lead")}
      ${field("Société",site.societe||site.society)}
      ${field("Adresse",site.adresse)}
      ${field("Commune",site.commune)}
      ${field("Wilaya",site.wilaya)}
      ${field("Type",site.type)}
      ${prestation?field("Prestation",prestation):""}
      ${detail?field("Détail",detail,"is-wide"):""}
    </dl>
  </section>`;
}

function siteTechTabsHTML(sections){
  return `<nav class="stf-tabs site-editor-wide" aria-label="Rubriques de la fiche technique"><div class="stf-tabs-track">${sections.map(([key,label,icon],i)=>`<button type="button" class="stf-tab" data-stf-tab="${key}" aria-controls="stf-sec-${key}"${i===0?` aria-current="true"`:""} onclick="siteTechGoTo('${key}')">${opsIcon(icon)}<span>${escapeHTML(label)}</span></button>`).join("")}</div></nav>`;
}

function siteTechCardHead(id,icon,title,sub,actions){
  return `<div class="stf-card-head"><div class="stf-card-title">${opsIcon(icon)}<div><h2 id="${id}" tabindex="-1">${escapeHTML(title)}</h2>${sub?`<p>${escapeHTML(sub)}</p>`:""}</div></div>${actions?`<div class="stf-card-actions">${actions}</div>`:""}</div>`;
}

function siteTechField(label,control,opts){
  const o=opts||{};
  return `<div class="stf-field${o.wide?" is-wide":""}"><label class="label" for="${o.id}">${escapeHTML(label)}${o.required?` <span class="stf-req" aria-hidden="true">*</span>`:""}</label>${control}${o.hint?`<small class="stf-field-hint" id="${o.id}-hint">${escapeHTML(o.hint)}</small>`:""}</div>`;
}

// Navigation interne : les rubriques restent toutes dans le même formulaire. Un onglet fait
// défiler jusqu'à sa rubrique ; rien n'est masqué ni re-rendu, donc aucune saisie n'est perdue.
function siteTechGoTo(key){
  const section=document.getElementById("stf-sec-"+key);
  if(!section)return;
  siteTechSetActiveTab(key);
  window.__sgdiSiteTechNavLockUntil=Date.now()+900;
  // Défilement de #view seulement : scrollIntoView déplaçait aussi le document et l'en-tête global.
  const view=document.getElementById("view");
  const nav=document.querySelector(".stf-tabs");
  if(view&&view.contains(section)){
    const offset=(nav?nav.getBoundingClientRect().height:0)+8;
    const top=view.scrollTop+section.getBoundingClientRect().top-view.getBoundingClientRect().top-offset;
    const smooth=!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    view.scrollTo?.({top:Math.max(0,top),behavior:smooth?"smooth":"auto"});
  }else section.scrollIntoView?.({block:"start"});
  section.querySelector("h2[tabindex]")?.focus({preventScroll:true});
}

function siteTechSetActiveTab(key){
  document.querySelectorAll(".stf-tab[data-stf-tab]").forEach(tab=>{
    const active=tab.dataset.stfTab===key;
    if(active){
      tab.setAttribute("aria-current","true");
      const track=tab.parentElement;
      if(track&&track.scrollWidth>track.clientWidth){
        const left=tab.offsetLeft-track.offsetLeft,right=left+tab.offsetWidth;
        if(left<track.scrollLeft||right>track.scrollLeft+track.clientWidth)track.scrollLeft=Math.max(0,left-24);
      }
    }
    else tab.removeAttribute("aria-current");
  });
}

function siteTechNavCleanup(){
  try{window.__sgdiSiteTechNavCleanup?.()}catch(_e){}
  window.__sgdiSiteTechNavCleanup=null;
}

function siteTechInitNav(){
  siteTechNavCleanup();
  const scroller=document.getElementById("view");
  const nav=document.querySelector(".stf-tabs");
  if(!scroller||!nav)return;
  let frame=0;
  const update=()=>{
    frame=0;
    if(!document.querySelector(".stf-tabs")){siteTechNavCleanup();return}
    if(Date.now()<(window.__sgdiSiteTechNavLockUntil||0))return;
    const limit=nav.getBoundingClientRect().bottom+24;
    let current=SITE_TECH_SECTIONS[0][0];
    document.querySelectorAll("[data-stf-section]").forEach(section=>{
      if(section.getBoundingClientRect().top<=limit)current=section.dataset.stfSection;
    });
    if(scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-4){
      const all=document.querySelectorAll("[data-stf-section]");
      if(all.length)current=all[all.length-1].dataset.stfSection;
    }
    const active=document.querySelector(".stf-tab[aria-current]")?.dataset.stfTab;
    if(active!==current)siteTechSetActiveTab(current);
  };
  const onScroll=()=>{if(!frame)frame=requestAnimationFrame(update)};
  scroller.addEventListener("scroll",onScroll,{passive:true});
  window.__sgdiSiteTechNavCleanup=()=>{scroller.removeEventListener("scroll",onScroll);if(frame)cancelAnimationFrame(frame)};
}

// La carte n'est chargée que lorsque son bloc devient visible (MapLibre + tuiles).
function siteTechInitMapWhenVisible(){
  const el=document.getElementById("site-position-inline-map");
  if(!el)return;
  if(typeof IntersectionObserver!=="function"){initInlineSitePositionMap();return}
  try{window.__sgdiSiteTechMapObserver?.disconnect()}catch(_e){}
  const observer=new IntersectionObserver(entries=>{
    if(!entries.some(e=>e.isIntersecting))return;
    observer.disconnect();
    window.__sgdiSiteTechMapObserver=null;
    if(document.getElementById("site-position-inline-map")===el)initInlineSitePositionMap();
  },{rootMargin:"200px"});
  observer.observe(el);
  window.__sgdiSiteTechMapObserver=observer;
}

async function renderSiteForm(view,id){
  const siteFormHash=location.hash,siteFormGeneration=sgdiViewRenderGeneration;
  if(!id){
    toast("Création des sites réservée au Commercial : dc.irongs.com", "info");
    navigate("sites/actifs");
    return;
  }
  view.classList.add("site-create-view");
  // Always load stores from API before rendering so the magasin dropdown is populated
  if(sgdiAuthToken()&&SGDI?.stock?.stores){
    try{
      const stores=await SGDI.stock.stores();
      if(Array.isArray(stores)&&stores.length)db.magasins=stores.map(storeFromApi);
    }catch(e){console.warn("renderSiteForm: stores preload failed",e);}
  }
  // Sans ce préchargement, le sélecteur "Client (fiche commerciale liée)" reste vide tant
  // que l'utilisateur n'a pas visité le module Commercial dans la session (db.clients n'est
  // synchronisé que pour scope.commercial, voir sgdiSqlSyncTasks) — or c'est précisément
  // depuis OPS/Admin qu'on rattache un site à son client pour le portail client.
  if(sgdiAuthToken()&&SGDI?.commercial?.clients&&!(db.clients||[]).length){
    try{
      const clients=await SGDI.commercial.clients();
      if(Array.isArray(clients)&&clients.length)db.clients=clients.map(clientFromApi);
    }catch(e){console.warn("renderSiteForm: clients preload failed",e);}
  }
  let s;if(id){const lookup=decodeURIComponent(String(id));s=db.sites.find(x=>String(x.id)===lookup||String(x.backendId||"")===lookup);if(!s){toast("Introuvable","error");return navigate("sites/actifs")}}else{s={id:uid("st"),actif:true,dateCreation:today(),dateOuverture:"",siteOuvertPar:"",nom:"",indicatif:"",telephone:"",adresse:"",commune:"",wilaya:"",type:"",latitude:"",longitude:"",contact:{nom:"",fonction:"",telephone:"",email:""},client:"",effectifs:{totalContractuel:0,groupes:0,jour:0,nuit:0,weekend:0,feries:0},postes:{},horairesReleves:"",rotation:ROTATION_DEFAUT.map(r=>({...r})),isNew:true}}
  if(location.hash!==siteFormHash||sgdiViewRenderGeneration!==siteFormGeneration||document.getElementById("view")!==view)return;
  if(supervisorModuleActive()&&!siteInSupervisorScope(s)){view.innerHTML=`<div class="card p-6"><h2 class="text-xl font-bold text-red-700 mb-2">Accès refusé</h2><p class="text-slate-600">Ce site ne fait pas partie des sites autorisés pour ce superviseur.</p></div>`;return}
  const rotationSystem=inferSiteRotationSystem(s);
  const dcLocked=!!(s.contractualReadOnly||s.equipment_plan?.contractualReadOnly);
  const eff=siteEffectifsNorm(s);
  const supervisorRO=isOpsSupervisorReadOnlySession();
  const canEditSite=siteCanEditFromCurrentModule(s)&&!supervisorRO;
  const routeId=jsString(siteEditRouteId(s));
  const lockNotice=!canEditSite&&!s.isNew?`<div class="stf-notice stf-notice--lock site-editor-wide" role="status">${opsIcon("shield")}<div>Fiche technique site verrouillée après enregistrement.</div></div>`:"";
  // Mêmes actions et mêmes conditions d'affichage que l'ancienne rangée de boutons.
  // Documents, Consignes et Procédures sont désormais des rubriques de la page (onglets).
  const pendingDemandes=supervisorRO?0:siteDemandesList(s).filter(d=>!/trait|rejet|clos|ferm|annul/i.test(String(d.statut||""))).length;
  const toolbar=s.isNew?"":[
    session?.transverse==="materiel"||supervisorRO?"":opsButtonHTML("Ajouter effectif",{variant:"primary",icon:"userPlus",attrs:`data-site-lock-keep onclick="openSiteAjouterEffectifModal('${routeId}')"`}),
    supervisorRO?"":opsButtonHTML("Demandes",{icon:"chat",badge:pendingDemandes,badgeLabel:"demande(s) en attente",attrs:`data-site-lock-keep onclick="openSiteDemandesModal('${routeId}')"`}),
    supervisorRO?"":opsButtonHTML("Événements",{icon:"event",attrs:`data-site-lock-keep onclick="openSiteCompteRenduForm('${routeId}')"`}),
    isAdminSystemSession()?opsButtonHTML("Archiver",{variant:"warn",icon:"archive",attrs:`data-site-lock-keep onclick="archiveSite('${routeId}')"`}):"",
    isAdminSystemSession()?opsButtonHTML("Supprimer",{variant:"danger",icon:"trash",attrs:`data-site-lock-keep onclick="deleteSite('${routeId}')"`}):"",
    opsButtonHTML("Retour",{icon:"back",attrs:`data-site-lock-keep onclick="navigate('sites/actifs')"`})
  ].join("");
  const siteRecap=s.isNew?"":siteRecapBlockHTML(s,eff);
  const siteIdentity=s.isNew?`<div class="site-form-title w-full"><h1>CRÉATION DE SITE</h1></div>`:siteTechnicalIdentityHTML(s,{toolbar,locked:!canEditSite});
  const sections=SITE_TECH_SECTIONS.filter(([key])=>key!=="documents"||!supervisorRO);
  const section=(key,body)=>`<section id="stf-sec-${key}" class="stf-section" data-stf-section="${key}" aria-labelledby="stf-h-${key}">${body}</section>`;
  const societeControl=isAdminSystemSession()
    ?`<select class="select" id="stf-f-societe" name="societe">${uniqueSocieteNames([...SOCIETES,...((societeConfig().custom)||[])]).map(soc=>`<option value="${escapeHTML(soc)}" ${normalizeSocieteName(s.societe)===normalizeSocieteName(soc)?"selected":""}>${escapeHTML(soc)}</option>`).join("")}</select>`
    :`<input class="input bg-slate-50" id="stf-f-societe" value="${escapeHTML(s.societe||"—")}" readonly/>`;
  const identificationCard=`<div class="stf-card">${siteTechCardHead("stf-h-identification","building","Identification du site")}
    <div class="stf-grid">
      ${siteTechField("Dénomination",`<input class="input" id="stf-f-nom" name="nom" aria-required="true" value="${escapeHTML(s.nom)}" />`,{id:"stf-f-nom",required:true})}
      ${siteTechField("Indicatif",`<input class="input" id="stf-f-indicatif" name="indicatif" aria-describedby="stf-f-indicatif-hint" value="${escapeHTML(s.indicatif||"")}"/>`,{id:"stf-f-indicatif",hint:"Indicatif radio du site."})}
      ${siteTechField("Code officiel du site",`<input class="input" id="stf-f-code" name="codeOfficiel" maxlength="50" placeholder="Ex. ETP/DF/H01" aria-describedby="stf-f-code-hint" value="${escapeHTML(s.codeOfficiel||"")}"/>`,{id:"stf-f-code",hint:"Imprimé sur les badges du personnel (SITE : code). Distinct de l’indicatif radio."})}
      ${siteTechField("Société",societeControl,{id:"stf-f-societe"})}
      ${siteTechField("Adresse",`<input class="input" id="stf-f-adresse" name="adresse" value="${escapeHTML(s.adresse||"")}"/>`,{id:"stf-f-adresse"})}
      ${siteTechField("Commune",`<input class="input" id="stf-f-commune" name="commune" value="${escapeHTML(s.commune||"")}"/>`,{id:"stf-f-commune"})}
      ${siteTechField("Wilaya",`<select class="select" id="stf-f-wilaya" name="wilaya"><option value="">—</option>${WILAYAS.map(w=>`<option ${s.wilaya===w?"selected":""}>${w}</option>`).join("")}</select>`,{id:"stf-f-wilaya"})}
      ${siteTechField("Type",`<select class="select" id="stf-f-type" name="type"><option value="">—</option>${TYPES_SITE.map(t=>`<option ${s.type===t?"selected":""}>${t}</option>`).join("")}</select>`,{id:"stf-f-type"})}
      ${siteTechField("Date d'ouverture",`<input class="input" id="stf-f-ouverture" type="date" name="dateOuverture" value="${escapeHTML(s.dateOuverture||"")}"/>`,{id:"stf-f-ouverture"})}
      ${siteTechField("Site ouvert par",`<input class="input" id="stf-f-ouvertpar" name="siteOuvertPar" value="${escapeHTML(s.siteOuvertPar||"")}" placeholder="Nom et prénom"/>`,{id:"stf-f-ouvertpar"})}
      ${siteTechField("Téléphone du site",`<input class="input" id="stf-f-telephone" name="telephone" type="tel" value="${escapeHTML(s.telephone||"")}" placeholder="0X XX XX XX XX"/>`,{id:"stf-f-telephone"})}
    </div></div>`;
  const gpsCard=`<div class="stf-card stf-card--gps">${siteTechCardHead("stf-h-gps","pin","Position GPS du site")}${sitePositionFieldHTML(s)}</div>`;
  const linkedClient=(db.clients||[]).find(c=>String(c.backendId||c.id||"")===String(s.clientId||""));
  const contactCard=`<div class="stf-card">${siteTechCardHead("stf-h-contact","user","Contact client")}
    <div class="stf-grid stf-grid--3">
      ${siteTechField("Nom du responsable",`<input class="input" id="stf-f-cnom" name="contact_nom" value="${escapeHTML(s.contact?.nom||"")}"/>`,{id:"stf-f-cnom"})}
      ${siteTechField("Fonction",`<input class="input" id="stf-f-cfonction" name="contact_fonction" value="${escapeHTML(s.contact?.fonction||"")}"/>`,{id:"stf-f-cfonction"})}
      ${siteTechField("Téléphone",`<input class="input" id="stf-f-ctel" name="contact_tel" type="tel" value="${escapeHTML(s.contact?.telephone||"")}"/>`,{id:"stf-f-ctel"})}
      ${siteTechField("Email",`<input class="input" id="stf-f-cemail" type="email" name="contact_email" value="${escapeHTML(s.contact?.email||"")}"/>`,{id:"stf-f-cemail"})}
      ${siteTechField("Client",`<input class="input" id="stf-f-client" name="client" value="${escapeHTML(s.client||"")}"/>`,{id:"stf-f-client"})}
      ${siteTechField("Client (fiche commerciale liée)",`<select class="select" id="stf-f-clientid" name="clientId" aria-describedby="stf-f-clientid-hint"><option value="">— Aucun —</option>${(db.clients||[]).slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||"")).map(c=>`<option value="${escapeHTML(c.backendId||c.id||"")}" ${String(s.clientId||"")===String(c.backendId||c.id||"")?"selected":""}>${escapeHTML(c.nom||c.raisonSociale||"Client")}</option>`).join("")}</select>`,{id:"stf-f-clientid",hint:"Détermine quels agents ce client verra depuis son portail dédié (si activé)."})}
    </div>
    <div class="stf-portal-line">${opsIcon("info")}<span>Portail client : ${s.clientId?`site rattaché à la fiche commerciale <strong>${escapeHTML(linkedClient?.nom||linkedClient?.raisonSociale||"liée")}</strong>.`:`aucune fiche commerciale liée à ce site.`}</span></div>
  </div>`;
  const effKpi=(label,name,value,editable,icon)=>`<div class="stf-eff-kpi${editable?" is-editable":""}">${opsIcon(icon)}<label class="label" for="stf-f-${name}">${escapeHTML(label)}</label><input class="input${editable?"":" bg-slate-100"}" id="stf-f-${name}" type="number" min="0" name="${name}" value="${value}"${editable?"":" readonly"}/></div>`;
  const effectifsCard=`<div class="stf-card">${siteTechCardHead("stf-h-effectifs","users","Effectifs","Le total, le jour et la nuit sont calculés à partir de la liste des postes.")}
    <div class="stf-eff-kpis">
      ${effKpi("Effectif total contractuel","eff_totalContractuel",eff.totalContractuel,false,"users")}
      ${effKpi("Nombre de groupes","eff_groupes",eff.groupes,true,"hash")}
      ${effKpi("Effectif de jour","eff_jour",eff.jour,false,"calendar")}
      ${effKpi("Effectif de nuit","eff_nuit",eff.nuit,false,"clock")}
      ${effKpi("Effectif week-end","eff_weekend",eff.weekend,true,"calendar")}
      ${effKpi("Effectif jours fériés","eff_feries",eff.feries,true,"calendar")}
    </div>
    ${dcLocked?`<div class="stf-notice" role="note">${opsIcon("shield")}<div>Effectifs contractuels transmis par le Commercial : postes et totaux en lecture seule.</div></div>`:""}
    <div class="stf-subcard-head"><h3>Liste des postes</h3><span class="stf-hint">Total du poste = (jour + nuit) × 2, ou jour + nuit en rotation 1/1.</span>${supervisorRO?"":opsButtonHTML("Ajouter poste",{size:"sm",icon:"plus",attrs:`onclick="addSitePosteRow()"`})}</div>
    <div class="stf-table-wrap"><table class="stf-table stf-table--postes"><colgroup><col class="stf-col-poste"><col class="stf-col-num"><col class="stf-col-num"><col class="stf-col-num"><col class="stf-col-rot"><col class="stf-col-action"></colgroup><thead><tr><th scope="col">Poste / fonction</th><th scope="col">Total</th><th scope="col">Jour</th><th scope="col">Nuit</th><th scope="col">Système de rotation</th><th scope="col"><span class="ops-sr-only">Action</span></th></tr></thead><tbody id="site-postes-body">${sitePostesTableHTML(s)}</tbody></table><p class="stf-empty stf-empty--postes">Aucun poste défini pour ce site.</p></div>
    <div id="site-postes-errors" class="stf-errors" role="alert" hidden></div>
    <div class="stf-grid stf-grid--relief">
      ${siteTechField("Heure relève Jour",`<input class="input" id="stf-f-relj" type="time" name="heureReleveJour" value="${escapeHTML(s.heureReleveJour||"")}"/>`,{id:"stf-f-relj"})}
      ${siteTechField("Heure relève Nuit",`<input class="input" id="stf-f-reln" type="time" name="heureReleveNuit" value="${escapeHTML(s.heureReleveNuit||"")}"/>`,{id:"stf-f-reln"})}
    </div>
  </div>`;
  const rotationCards=[["24/48","Groupe A : Jour → Nuit → Récupération → Récupération, puis reprise Jour / Nuit."],["3x8","De 6h à 14h · de 14h à 22h · de 22h à 6h · récupération, selon le cycle A/B/C/D."],["1/3","Groupe A en jour ouvrable · B/C/D en nuit une sur trois."],["1/2","A/B en jour un sur deux · C/D en nuit une sur deux."],["1/1","Groupe A1 : cinq jours par semaine, 8h maximum, hors week-end et jours fériés."]];
  const rotationCard=`<div class="stf-card">${siteTechCardHead("stf-h-rotation","rotate","Système de rotation","Sélection appliquée au site à l'enregistrement de la fiche.")}
    <div class="stf-rotation">
      <fieldset class="site-rotation-card-grid stf-rotation-cards"><legend class="ops-sr-only">Système de rotation du site</legend>
        ${rotationCards.map(([v,d])=>`<label data-rotation-card="${v}" class="stf-rotation-card${rotationSystem===v?" is-active":""}"><span class="stf-rotation-name"><input type="radio" name="rotationSystem" value="${v}" ${rotationSystem===v?"checked":""} onchange="updateSiteRotationPreview(this.value)"/> ${v==="3x8"?"3×8":v}</span><span class="stf-rotation-desc">${d}</span></label>`).join("")}
      </fieldset>
      <div class="stf-rotation-rules"><h3>Règles par groupe</h3><div id="rotation-preview" aria-live="polite">${siteRotationSummaryHTML(rotationSystem)}</div></div>
    </div>
    ${siteRotationPlanningSectionHTML(s)}
  </div>`;
  const affectationCard=`<div class="stf-card">${siteTechCardHead("stf-h-affectation","swap","Affectation des effectifs")}${siteAffectationGroupesHTML(s)}</div>`;
  const materielCard=`<div class="stf-card">${siteTechCardHead("stf-h-materiel","box","Équipement et matériel","Dotation matériel du site",supervisorRO?"":opsButtonHTML("Ajouter article",{size:"sm",icon:"plus",attrs:`onclick="addSiteMaterielRow()"`}))}
    <div class="stf-table-wrap"><table class="stf-table stf-table--materiel"><thead><tr><th scope="col">Magasin</th><th scope="col">Article disponible</th><th scope="col">Qté</th><th scope="col">N° série / réf</th><th scope="col">État</th><th scope="col">Observation</th><th scope="col"><span class="ops-sr-only">Action</span></th></tr></thead><tbody id="site-materiel-body">${siteMaterielTableHTML(s)}</tbody></table>
    <p class="stf-empty stf-empty--materiel">Aucun article doté à ce site.</p></div>
    <p class="stf-hint">Les articles sélectionnés doivent être disponibles dans les magasins de la société. À l'enregistrement, les nouvelles lignes créent une dotation site et déduisent le stock.</p>
    ${session?.transverse==="materiel"?`<div class="stf-card-foot">${opsButtonHTML("Enregistrer",{variant:"primary",icon:"save",attrs:`data-site-save-action onclick="saveSiteEquipementOnly('${jsString(s.id)}')"`})}</div>`:""}
  </div>`;
  const documentsCard=`<div class="stf-card">${siteTechCardHead("stf-h-documents","file","Documents","PV, comptes rendus, bulletins d'information et documents archivés du site.")}${siteArchivedDocumentsHTML(s)}</div>`;
  const consignesText=s.consignesGenerales||s.consignes||s.consigneGenerale;
  const consignesCard=`<div class="stf-card">${siteTechCardHead("stf-h-consignes","shield","Consignes","Consignes générales et instructions particulières du site.")}${siteTextBlockHTML(consignesText,"Aucune consigne générale enregistrée pour ce site.")}</div>`;
  const proceduresCard=`<div class="stf-card">${siteTechCardHead("stf-h-procedures","clipboard","Procédures","Procédures opérationnelles du site.")}${siteTextBlockHTML(s.procedures||s.procedureSite,"Aucune procédure enregistrée pour ce site.")}</div>`;
  const actionbar=`<div class="stf-actionbar site-form-actions">
    <div class="stf-actionbar-label">${opsIcon("file")}<div><strong>Fiche technique site</strong><span>${escapeHTML([s.nom,s.societe].filter(Boolean).join(" · "))}</span></div></div>
    <div class="stf-actionbar-buttons">${session?.transverse==="materiel"||supervisorRO?"":opsButtonHTML("Établir un PV",{icon:"print",attrs:`data-site-lock-keep onclick="openSitePVModal('${jsString(s.id)}')"`})}${supervisorRO?"":opsButtonHTML("Enregistrer modification",{icon:"save",attrs:`data-site-lock-keep data-site-save-action onclick="saveSite('${jsString(s.id)}')"`})}${canEditSite?opsButtonHTML("Enregistrer",{type:"submit",variant:"primary",icon:"check",attrs:`data-site-save-action`}):""}</div>
  </div>`;
  view.innerHTML=`<div class="w-full stf">${siteIdentity}${opsSupervisorReadOnlyNoticeHTML()}${siteRecap}${s.isNew?"":siteTechTabsHTML(sections)}${lockNotice}
  <form id="site-form" class="site-editor-wide site-form-layout stf-form" data-dc-contract-locked="${dcLocked?"1":"0"}" data-site-create-form="1" data-locked="${canEditSite?"0":"1"}" onsubmit="event.preventDefault();saveSite('${s.id}')"><input type="hidden" name="isNew" value="${s.isNew?"1":""}"/>
    ${section("identification",`<div class="stf-row-2">${identificationCard}${gpsCard}</div>`)}
    ${section("contact",contactCard)}
    ${section("effectifs",effectifsCard)}
    ${section("rotation",rotationCard)}
    ${section("affectation",affectationCard)}
    ${section("materiel",materielCard)}
    ${supervisorRO?"":section("documents",documentsCard)}
    ${section("consignes",consignesCard)}
    ${section("procedures",proceduresCard)}
    ${actionbar}
  </form></div>`;
  sitesModuleTimeout(()=>{updateSiteEffectifTotalContractuel();siteTechInitMapWhenVisible();applySiteFormLock();siteTechInitNav()},0);
}

function siteDraftFromCurrentForm(id){
  const f=document.getElementById("site-form");
  const existing=(db.sites||[]).find(x=>String(x.id)===String(id)||String(x.backendId||"")===String(id))||{};
  if(!f)return existing;
  const fd=new FormData(f);
  const noms=fd.getAll("poste_nom"),jours=fd.getAll("poste_jour"),nuits=fd.getAll("poste_nuit"),rotations=fd.getAll("poste_rotationSystem");
  let totalContractuel=0,totalJour=0,totalNuit=0;
  const postes={};
  noms.forEach((nom,i)=>{
    nom=String(nom||"").trim();
    if(!nom)return;
    const jour=+jours[i]||0,nuit=+nuits[i]||0;
    const rotationSystem=rotations[i]||"";
    const total=sitePosteTotalCalc(jour,nuit,rotationSystem);
    totalJour+=jour;totalNuit+=nuit;totalContractuel+=total;
    postes[nom]={jour,nuit,total,rotationSystem};
  });
  const equipements=[];
  f.querySelectorAll("#site-materiel-body .site-materiel-row").forEach(row=>{
    const magasinId=row.querySelector('[name="site_mat_magasinId"]')?.value||"";
    const articleId=row.querySelector('[name="site_mat_articleId"]')?.value||"";
    const article=(db.stockArticles||[]).find(a=>String(a.id)===String(articleId));
    const mag=(db.magasins||[]).find(m=>String(m.id)===String(magasinId));
    const quantite=parseFloat(row.querySelector('[name="site_mat_quantite"]')?.value||"0")||0;
    if(!article||!quantite)return;
    const codeSerie=(row.querySelector('[name="site_mat_codeSerie"]')?.value||"").trim();
    equipements.push({
      backendId:row.querySelector('[name="site_mat_backendId"]')?.value||"",
      equipmentBackendId:row.querySelector('[name="site_mat_equipmentBackendId"]')?.value||"",
      categorie:mag?.nom||article.categorie||"",
      magasinId:magasinId||article.magasinId||"",
      articleId:article.id,
      articleBackendId:article.backendId||"",
      designation:article.designation||article.sousCategorie||article.code||"Article",
      quantite,
      codeSerie,
      numeroSerie:codeSerie,
      reference:codeSerie,
      etat:row.querySelector('[name="site_mat_etat"]')?.value||"neuf",
      observation:(row.querySelector('[name="site_mat_observation"]')?.value||"").trim()
    });
  });
  return {
    ...existing,
    id:existing.id||id,
    nom:String(fd.get("nom")||existing.nom||"").trim(),
    indicatif:String(fd.get("indicatif")||existing.indicatif||"").trim(),
    telephone:String(fd.get("telephone")||existing.telephone||"").trim(),
    adresse:String(fd.get("adresse")||existing.adresse||"").trim(),
    commune:String(fd.get("commune")||existing.commune||"").trim(),
    wilaya:String(fd.get("wilaya")||existing.wilaya||"").trim(),
    type:String(fd.get("type")||existing.type||"").trim(),
    latitude:String(fd.get("latitude")||existing.latitude||"").trim(),
    longitude:String(fd.get("longitude")||existing.longitude||"").trim(),
    dateOuverture:String(fd.get("dateOuverture")||existing.dateOuverture||"").trim(),
    siteOuvertPar:String(fd.get("siteOuvertPar")||existing.siteOuvertPar||"").trim(),
    client:String(fd.get("client")||existing.client||"").trim(),
    clientId:String(fd.get("clientId")||existing.clientId||"").trim(),
    contact:{nom:fd.get("contact_nom")||existing.contact?.nom||"",fonction:fd.get("contact_fonction")||existing.contact?.fonction||"",telephone:fd.get("contact_tel")||existing.contact?.telephone||"",email:fd.get("contact_email")||existing.contact?.email||""},
    postes:{...(existing.postes||{}),...postes},
    equipements:equipements.length?equipements:(existing.equipements||existing.materiel||[]),
    rotationPlanning:(()=>{try{return JSON.parse(fd.get("rotationPlanningJson")||"{}")}catch(e){return {}}})(),
    effectifs:(existing.contractualReadOnly||existing.equipment_plan?.contractualReadOnly)?existing.effectifs:{...(existing.effectifs||{}),totalContractuel,jour:totalJour,nuit:totalNuit,groupes:+fd.get("eff_groupes")||existing.effectifs?.groupes||0,weekend:+fd.get("eff_weekend")||existing.effectifs?.weekend||0,feries:+fd.get("eff_feries")||existing.effectifs?.feries||0}
  };
}

function siteOpeningPVHTML(site){
  const ref="PV-OUV-"+today().replaceAll("-","")+"-"+String(site.indicatif||site.id||"SITE").replace(/\W+/g,"").toUpperCase();
  const eff=siteEffectifsNorm(site);
  const openDate=site.dateOuverture||today();
  const [yy,mm,dd]=String(openDate||today()).split("-");
  const pvDay=dd||"____",pvMonth=mm||"____",pvYear=yy||"____";
  const fullDate=`${pvDay} / ${pvMonth} / ${pvYear}`;
  const posteKey=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[’']/g," ").replace(/-/g," ").replace(/\s+/g," ").trim().toUpperCase();
  const posteDisplay=label=>{
    const key=posteKey(label);
    if(["APS","A P S","AGENT DE PREVENTION ET DE SECURITE","AGENT PREVENTION SECURITE"].includes(key))return "AGENT DE PREVENTION ET DE SECURITE";
    if(["AGENT D ACCUEIL","AGENT D ACCEUIL","AGENT ACCUEIL","AGENT ACCEUIL"].includes(key))return "AGENT D'ACCUEIL";
    return String(label||"").trim().toUpperCase();
  };
  const realisedMap={};
  Object.entries(site.postes||{}).forEach(([label,v])=>{
    const jour=+v?.jour||0,nuit=+v?.nuit||0,total=(jour+nuit)||(+v?.total||0);
    if(!jour&&!nuit&&!total)return;
    const display=posteDisplay(label);
    if(!realisedMap[display])realisedMap[display]={jour:0,nuit:0,total:0,rotationSystem:v?.rotationSystem||""};
    realisedMap[display].jour+=jour;
    realisedMap[display].nuit+=nuit;
    realisedMap[display].total+=total;
    realisedMap[display].rotationSystem=realisedMap[display].rotationSystem||v?.rotationSystem||"";
  });
  const postesText=Object.keys(realisedMap).join(" / ");
  const realisedTotal=Object.values(realisedMap).reduce((sum,v)=>sum+(+v.total||0),0);
  const realisedJour=Object.values(realisedMap).reduce((sum,v)=>sum+(+v.jour||0),0);
  const realisedNuit=Object.values(realisedMap).reduce((sum,v)=>sum+(+v.nuit||0),0);
  const pvJour=eff.jour||realisedJour||"";
  const pvNuit=eff.nuit||realisedNuit||"";
  const pvTotal=eff.totalContractuel||realisedTotal||(Number(pvJour)||0)+(Number(pvNuit)||0)||"";
  const pvRotation=site.rotationSystem||Object.values(realisedMap).map(v=>v.rotationSystem).filter(Boolean)[0]||"";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(ref)}</title><style>
    @page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111827;background:#fff;margin:0;padding:7mm;font-size:11px}.pv{max-width:190mm;margin:0 auto;border:1.5px solid #043970;padding:6mm 7mm 8mm}.pv-head{display:grid;grid-template-columns:34mm 1fr;align-items:center;padding:0 0 3mm;margin-bottom:3mm}.logo{width:30mm;height:30mm;object-fit:contain}.title{text-align:center}.title b{display:block;font-size:22px}.line-row{display:grid;grid-template-columns:1fr 1fr;gap:20mm;border-bottom:1px solid #b8c7d6;padding:2.4mm 0}.inline{display:flex;align-items:end;gap:3mm}.fill{border-bottom:1px solid #043970;min-height:6mm;flex:1;padding:0 2mm;font-weight:800}.check-row{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;border-top:1.5px solid #043970;border-bottom:1px solid #043970;margin:4mm 0;padding:3mm 0}.box-check{display:inline-block;width:4mm;height:4mm;border:1.4px solid #043970;margin-left:2mm;vertical-align:middle}.checked:after{content:"X";font-weight:900;position:relative;left:.7mm;top:-.5mm}.site-line{display:grid;grid-template-columns:1fr 30mm;gap:10mm;margin:4mm 0}.staff{margin-top:5mm;table-layout:fixed;border-collapse:collapse;width:100%}.staff col:nth-child(1){width:31mm}.staff col:nth-child(2){width:28mm}.staff col:nth-child(3){width:24mm}.staff col:nth-child(4){width:22mm}.staff col:nth-child(5){width:22mm}.staff col:nth-child(6){width:24mm}.staff th,.staff td{border:1px solid #d9d9d9;height:7mm;padding:1.2mm 1.4mm;font-size:10.5px;line-height:1.1}.staff .staff-title-row td{background:#fff;color:#2f5597;font-weight:900;text-align:left;border-top:1px solid #d9d9d9}.staff .staff-head th{background:#ddebf7;color:#1f6fb2;font-weight:900;text-align:center}.staff .staff-head th:first-child{background:#ddebf7}.staff .row-label{background:#ddebf7;color:#1f6fb2;font-weight:900;text-align:left;white-space:nowrap}.staff tbody td{text-align:center}.staff tbody td:nth-child(2){text-align:left;font-weight:700}.sign{display:grid;grid-template-columns:1fr 1fr;gap:16mm;margin-top:8mm}.sign div{height:24mm;border-top:1px solid #111;text-align:center;padding-top:2mm;font-weight:900}@media print{body{padding:0}.pv{border:0;padding:0}.no-print{display:none!important}}
  </style></head><body>
    <main class="pv">
      <div class="pv-head">${sgdiDocumentLogoHTML(site.societe||site.company,"logo")}<div class="title"><b>PROCES VERBAL</b></div></div>
      <div class="line-row"><div class="inline"><span>Réf</span><span class="fill">${escapeHTML(ref)}</span></div><div class="inline"><span>Date</span><span class="fill">${escapeHTML(fullDate)}</span></div></div>
      <div class="line-row"><div class="inline"><span>Je soussigné M/Mme</span><span class="fill">${escapeHTML(site.siteOuvertPar||session?.nom||session?.username||"")}</span></div><div class="inline"><span>Fonction</span><span class="fill">${escapeHTML(session?.fonction||"")}</span></div></div>
      <div class="line-row"><div class="inline"><span>Avoir procédé(e), ce jour le</span><span class="fill">${escapeHTML(fullDate)}</span></div><div class="inline"><span>à</span><span class="fill">${escapeHTML(site.heureReleveJour||"")} h</span></div></div>
      <div class="check-row"><div>A : l'installation <span class="box-check checked"></span></div><div>Augmentation <span class="box-check"></span></div><div>Diminution <span class="box-check"></span></div><div>Levée de dispositif <span class="box-check"></span></div></div>
      <div class="site-line"><div class="inline"><span>Site/Client</span><span class="fill">${escapeHTML([site.nom,site.client].filter(Boolean).join(" / "))}</span></div><div class="inline"><span>Indicatif</span><span class="fill">${escapeHTML(site.indicatif||"")}</span></div></div>
      <table class="staff">
        <colgroup><col><col><col><col><col><col></colgroup>
        <thead><tr class="staff-title-row"><td colspan="2">Tableau numerique des effectifs</td><td></td><td></td><td></td><td></td></tr><tr class="staff-head"><th></th><th>Poste</th><th>Total Contrat</th><th>Jour</th><th>Nuit</th><th>Rotation</th></tr></thead>
        <tbody>
          <tr><td class="row-label">Ancien dispositif</td><td></td><td></td><td></td><td></td><td></td></tr>
          <tr><td class="row-label">Nouveau dispositif</td><td>${escapeHTML(postesText)}</td><td>${pvTotal}</td><td>${pvJour}</td><td>${pvNuit}</td><td>${escapeHTML(pvRotation)}</td></tr>
        </tbody>
      </table>
      <div class="sign"><div>Responsable OPS / Matériel</div><div>Direction</div></div>
    </main>
  </body></html>`;
}

function sitePVControlsHTML(meta){
  const metaJson=JSON.stringify(meta||{}).replace(/<\//g,"<\\/");
  return `<section class="no-print" style="position:sticky;top:0;z-index:999;background:#fff;border-bottom:1px solid #dbe3ef;box-shadow:0 8px 24px rgba(15,23,42,.12);padding:12px 18px;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:980px;margin:0 auto;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div><div style="font-weight:900;color:#043970">Validation du PV</div><div id="site-pv-state" style="font-size:12px;color:#64748b;margin-top:2px">Vérifiez le PV puis cliquez sur Valider PV.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button id="site-pv-validate" style="border:0;border-radius:8px;background:#043970;color:#fff;padding:9px 14px;font-weight:900;cursor:pointer">Valider PV</button><button id="site-pv-print" disabled style="border:0;border-radius:8px;background:#047857;color:#fff;padding:9px 14px;font-weight:900;cursor:pointer;opacity:.45">Imprimer</button><button id="site-pv-close" style="border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;padding:9px 14px;font-weight:800;cursor:pointer">Fermer</button></div>
    </div>
  </section><script>window.SGDI_SITE_PV_META=${metaJson};(function(){const v=document.getElementById("site-pv-validate"),p=document.getElementById("site-pv-print"),c=document.getElementById("site-pv-close"),s=document.getElementById("site-pv-state");function setPrint(on){p.disabled=!on;p.style.opacity=on?"1":".45"}if(v)v.addEventListener("click",async()=>{v.disabled=true;v.style.opacity=".45";if(s){s.textContent="PV en cours d'enregistrement...";s.style.color="#64748b"}let ok=false;try{if(window.opener&&window.opener.archiveSitePVFromWindow)ok=await window.opener.archiveSitePVFromWindow(window,window.SGDI_SITE_PV_META||{});}catch(e){console.error(e)}if(!ok){v.disabled=false;v.style.opacity="1";if(s){s.textContent="Enregistrement impossible. Vérifiez la session serveur puis réessayez.";s.style.color="#dc2626"}return}setPrint(true);if(s){s.textContent="PV enregistré. Vous pouvez imprimer.";s.style.color="#047857"}});if(p)p.addEventListener("click",()=>window.print());if(c)c.addEventListener("click",()=>window.close());setPrint(false);})();<\/script>`;
}

async function archiveSitePVFromWindow(docWindow,meta){
  if(guardOpsSupervisorMutation("site","Accès superviseur OPS : édition des sites non autorisée."))return false;
  let site=(db.sites||[]).find(s=>String(s.id)===String(meta?.siteId)||String(s.backendId||"")===String(meta?.siteBackendId)||String(s.indicatif||"")===String(meta?.indicatif||""));
  if(!site){toast("Site introuvable pour archivage du PV","error");return false}
  const safeSociete=siteSafeSociete(site);
  if(!safeSociete){toast("Société autorisée introuvable pour enregistrer le PV","error");return false}
  site.societe=safeSociete;
  site.society=safeSociete;
  const clone=docWindow.document.documentElement.cloneNode(true);
  clone.querySelectorAll(".no-print,script").forEach(el=>el.remove());
  const html="<!doctype html>\n"+clone.outerHTML;
  const reference=meta.reference||("PV-"+today());
  const key=employeeDocumentSafeKey("pv_site",reference);
  site.documents=site.documents||{};
  if(!String(html||"").trim()){toast("Archivage refusé : contenu du document obligatoire pour PostgreSQL","error");return false}
  site.documents[key]={url:"data:text/html;charset=utf-8,"+encodeURIComponent(html),html,name:employeeDocumentFileName("PROCES VERBAL",reference),title:meta.title||"PROCES VERBAL",reference,category:"Sites",type:"pv_site",pvKind:meta.kind||"ouverture",date:meta.date||today(),createdAt:new Date().toISOString(),createdBy:session?.username||"SGDI",generated:true};
  site.updatedAt=today();
  try{await persistSiteToPostgres(site)}catch(e){toast("PV non enregistré : "+(e.message||e),"error");return false}
  if(!(await saveDBAndWaitToast("PV non confirmé")))return false;
  toast("PV enregistré dans la fiche site","success");
  return true;
}

function openSitePVModal(id){
  if(guardOpsSupervisorMutation("site","Édition des PV non autorisée."))return;
  const site=(db.sites||[]).find(s=>String(s.id)===String(id)||String(s.backendId)===String(id));
  if(!site?.backendId){toast("Choisissez un site transmis par Commercial.","error");return;}
  const actual=siteAgentsAffectes(site).length;
  openModal(`<h2>Procès-verbal du site</h2><p>${escapeHTML(site.nom||"Site")}</p>
    <form id="site-operation-pv-form" onsubmit="event.preventDefault();generateSiteOperationPV('${jsString(id)}')">
      <label class="label">Type de PV</label><select class="select" name="kind" onchange="this.form.querySelector('[data-pv-change]').hidden=this.value==='ouverture'||this.value==='fermeture'"><option value="ouverture">Ouverture de site</option><option value="augmentation">Augmentation des effectifs</option><option value="diminution">Diminution des effectifs</option><option value="fermeture">Fermeture de site</option></select>
      <label class="label">Date de l'opération</label><input class="input" type="date" name="date" value="${today()}" required>
      <div data-pv-change hidden><label class="label">Effectif avant l'opération</label><input class="input" type="number" min="0" step="1" name="before" value="${actual}"><label class="label">Effectif après l'opération</label><input class="input" type="number" min="0" step="1" name="after" value="${actual}"></div>
      <label class="label">Motif / observations</label><textarea class="input" name="reason" required></textarea>
      <p class="text-sm text-slate-500">Le PV sera conservé dans les documents du site. Les affectations et besoins contractuels sont gérés dans leurs écrans dédiés.</p>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Préparer le PV</button></div>
    </form>`);
}
function siteOperationPVData(form){
  const fd=new FormData(form),kind=String(fd.get("kind")||""),reason=String(fd.get("reason")||"").trim();
  const labels={ouverture:"Ouverture de site",augmentation:"Augmentation des effectifs",diminution:"Diminution des effectifs",fermeture:"Fermeture de site"};
  const date=String(fd.get("date")||"");
  if(!labels[kind]||!date||!reason)throw new Error("Renseignez le type, la date et le motif du PV.");
  const before=Number(fd.get("before")),after=Number(fd.get("after"));
  if(["augmentation","diminution"].includes(kind)&&(!Number.isInteger(before)||!Number.isInteger(after)||before<0||after<0||(kind==="augmentation"?after<=before:after>=before)))throw new Error("Les effectifs avant/après doivent correspondre au type de PV.");
  return {kind,title:`PV — ${labels[kind]}`,date,reason,before,after};
}
function generateSiteOperationPV(id){
  if(guardOpsSupervisorMutation("site","Édition des PV non autorisée."))return;
  const site=(db.sites||[]).find(s=>String(s.id)===String(id)||String(s.backendId)===String(id));
  if(!site?.backendId)return;
  let data;try{data=siteOperationPVData(document.getElementById("site-operation-pv-form"));}catch(e){toast(e.message,"error");return;}
  const reference=`PV-${data.kind.toUpperCase()}-${data.date.replaceAll("-","")}-${site.backendId}-${Date.now()}`;
  const meta={...data,reference,siteId:site.id,siteBackendId:site.backendId};
  const change=["augmentation","diminution"].includes(data.kind)?`<p><b>Effectif avant :</b> ${data.before} · <b>Effectif après :</b> ${data.after} · <b>Variation :</b> ${data.after-data.before}</p>`:"";
  const html=`<!doctype html><html lang="fr"><meta charset="utf-8"><title>${escapeHTML(data.title)}</title><style>body{font:15px Arial;color:#12233c;max-width:900px;margin:32px auto;padding:20px}h1{color:#043970}p{line-height:1.6}.signatures{display:flex;justify-content:space-between;margin-top:70px}@media print{.no-print{display:none!important}}</style><body>${sitePVControlsHTML(meta)}<h1>${escapeHTML(data.title)}</h1><p><b>Référence :</b> ${escapeHTML(reference)}<br><b>Société :</b> ${escapeHTML(site.societe||site.society||"—")}<br><b>Client :</b> ${escapeHTML(site.client||"—")}<br><b>Site :</b> ${escapeHTML(site.nom||"—")}<br><b>Date :</b> ${escapeHTML(formatDate(data.date))}</p>${change}<h2>Motif et constat</h2><p style="white-space:pre-wrap">${escapeHTML(data.reason)}</p><p>Établi par : ${escapeHTML(session?.username||"OPS")}</p><div class="signatures"><span>Responsable OPS<br>Signature et cachet</span><span>Représentant du client<br>Signature et cachet</span></div></body></html>`;
  const w=window.open("","_blank","width=1000,height=800");if(!w){toast("Ouverture bloquée par le navigateur","error");return;}
  w.document.write(html);w.document.close();closeModal();
}

function editSiteOpeningPV(id){
  if(guardOpsSupervisorMutation("site","Accès superviseur OPS : édition des sites non autorisée."))return;
  try{
    const site=siteDraftFromCurrentForm(id);
    if(!String(site.nom||"").trim()){toast("Saisissez la dénomination du site avant d'éditer le PV","error");return}
    const w=window.open("","_blank","width=1000,height=800");
    if(!w){toast("Ouverture bloquée par le navigateur","error");return}
    const html=siteOpeningPVHTML(site);
    const meta={siteId:site.id,siteBackendId:site.backendId||"",indicatif:site.indicatif||"",reference:"PV-OUV-"+today().replaceAll("-","")+"-"+String(site.indicatif||site.id||"SITE").replace(/\W+/g,"").toUpperCase(),date:site.dateOuverture||today(),siteDraft:site};
    w.document.write(html.replace("<body>","<body>"+sitePVControlsHTML(meta)));
    w.document.close();
  }catch(e){
    console.error("PV ouverture site impossible",e);
    toast("PV impossible à générer : "+(e.message||e),"error");
  }
}

async function deleteSite(id){
  if(!isAdminSystemSession()){toast("Suppression réservée à Administration Système","error");return}
  const site=findSiteByRef(id);
  if(!site){toast("Site introuvable","error");return}
  const label=site.nom||site.indicatif||"ce site";
  if(!confirm(`Supprimer définitivement ${label} ?\n\nCette action est irréversible.`))return;
  const backendId=sqlBackendId(site.backendId);
  let deletedInPostgres=true;
  try{
    if(backendId){
      try{
        await SGDI.sites.delete(backendId);
      }catch(e){
        if(!sgdiIsNotFoundError(e))throw e;
        deletedInPostgres=false;
      }
    }else{
      deletedInPostgres=false;
    }
    db.sites=(db.sites||[]).filter(s=>String(s.id)!==String(site.id)&&String(s.backendId||"")!==String(backendId||""));
    await syncSitesFromPostgres().catch(()=>{});
    if(!(await saveDBAndWaitToast("Suppression site non confirmée")))return;
    toast(deletedInPostgres?"Site supprimé de PostgreSQL":"Site nettoyé : enregistrement déjà absent de PostgreSQL","success");
    navigate("sites/actifs");
  }catch(e){
    toast("Suppression site refusée : "+(e.message||e),"error");
  }
}

async function archiveSite(id){
  if(!isAdminSystemSession()){toast("Archivage réservé à Administration Système","error");return}
  const site=findSiteByRef(id);
  if(!site){toast("Site introuvable","error");return}
  const label=site.nom||site.indicatif||"ce site";
  if(!confirm(`Archiver ${label} ?\n\nLe site ne sera plus compté comme site actif, sans suppression définitive.`))return;
  site.actif=false;
  site.active=0;
  site.statut="archive";
  site.archived=true;
  site.archivedAt=new Date().toISOString();
  site.archivedBy=session?.username||session?.nom||"Administration Système";
  site.ficheTechniqueLocked=true;
  site.siteFormLocked=true;
  try{
    await persistSiteToPostgres(site);
    await syncSitesFromPostgres().catch(()=>{});
    if(!(await saveDBAndWaitToast("Archivage site non confirmé")))return;
    toast("Site archivé","success");
    navigate("sites/actifs");
  }catch(e){
    toast("Archivage site refusé : "+(e.message||e),"error");
  }
}

async function persistSiteEquipmentDotations(site){
  if(!site||!Array.isArray(site.equipements)||!site.equipements.length)return [];
  const saved=[];
  const siteBackendId=site.backendId||sqlInt(site.id);
  if(!siteBackendId)throw new Error("Site PostgreSQL manquant pour la dotation matériel");
  db.stockMouvements=db.stockMouvements||[];
  const batchRef=nextStockBonNum("nouvelle_dotation");
  for(const [idx,item] of site.equipements.entries()){
    if(item.backendId||item.equipmentBackendId)continue;
    const art=(db.stockArticles||[]).find(a=>String(a.id)===String(item.articleId)||String(a.backendId||"")===String(item.articleBackendId||item.articleId||""));
    if(!art)throw new Error("Article introuvable pour la dotation site");
    const qte=parseFloat(item.quantite)||0;
    if(qte<=0)continue;
    const m={
      id:uid("mvt"),articleId:String(art.id),articleBackendId:art.backendId||sqlInt(art.id),
      type:"nouvelle_dotation",date:today(),quantite:qte,
      prixUnitaire:parseFloat(art.prixUnitaire)||0,
      motif:"Dotation site",cibleType:"site",cibleId:site.id,cibleNom:site.nom||"Site",
      siteId:site.id,magasinId:item.magasinId||art.magasinId||"",societe:site.societe||art.societe||"",
      codeSerie:item.codeSerie||item.numeroSerie||item.reference||"",modele:item.modele||art.modele||"",
      etatArticle:item.etat||art.etatArticle||"neuf",dureeVieMois:parseFloat(item.dureeVieMois||art.dureeVieMois)||0,
      numeroBon:`${batchRef}-${String(idx+1).padStart(2,"0")}`,
      notes:item.observation||"",userId:session?.username||"",createdAt:new Date().toISOString()
    };
    await persistDotationToPostgres(m);
    db.stockMouvements.push(m);
    const snap=materialDotationSiteSnapshot(m,art);
    Object.assign(item,snap,{backendId:m.backendId||snap.backendId||"",equipmentBackendId:m.equipmentBackendId||snap.equipmentBackendId||""});
    saved.push(m);
  }
  if(saved.length)await persistSiteToPostgres(site);
  return saved;
}

function siteEmployeeAssignedGroup(site,agent){
  return opsEmployeeLiveAffectation(agent)?.groupe||"";
}

function siteEmployeeMatchesSite(site,agent){
  const ids=new Set([site?.id,site?.backendId].filter(v=>v!==undefined&&v!==null&&v!=="").map(String));
  const aff=opsEmployeeLiveAffectation(agent);
  return !!aff.siteId&&ids.has(String(aff.siteId));
}

async function syncSiteGroupAssignmentsToEmployees(site){
  return [];
}

function saveSiteEquipementOnly(id){return siteSaveExclusive(()=>saveSiteEquipementOnlyRun(id))}
async function saveSiteEquipementOnlyRun(id){
  if(guardOpsSupervisorMutation("site","Accès superviseur OPS : édition des sites non autorisée."))return;
  const lookup=decodeURIComponent(String(id||""));
  const s=(db.sites||[]).find(x=>String(x.id)===lookup||String(x.backendId||"")===lookup);
  if(!s){toast("Site introuvable","error");return}
  if(!s.backendId){toast("Site non synchronisé. Rafraîchissez la page.","error");return}
  const equipements=[];
  let invalid=false;
  document.querySelectorAll("#site-materiel-body .site-materiel-row").forEach(row=>{
    if(invalid)return;
    const magasinId=row.querySelector('[name="site_mat_magasinId"]')?.value||"";
    const articleId=row.querySelector('[name="site_mat_articleId"]')?.value||"";
    const article=(db.stockArticles||[]).find(a=>String(a.id)===String(articleId));
    const mag=(db.magasins||[]).find(m=>String(m.id)===String(magasinId));
    const quantite=parseFloat(row.querySelector('[name="site_mat_quantite"]')?.value||"0")||0;
    const existingRef=(row.querySelector('[name="site_mat_backendId"]')?.value||"")||(row.querySelector('[name="site_mat_equipmentBackendId"]')?.value||"");
    if(!article&&!magasinId&&!quantite)return;
    if(!article){toast("Choisissez un article disponible","error");invalid=true;return}
    if(quantite<=0){toast("Quantité invalide","error");invalid=true;return}
    const disponible=typeof dotationStockDisponible==="function"?dotationStockDisponible(article):stockGetActuel(article.id);
    if(!existingRef&&disponible<=0){toast(`${article.designation||"Article"} non disponible en stock`,"error");invalid=true;return}
    if(!existingRef&&quantite>disponible){toast(`Stock insuffisant pour ${article.designation||"article"} : disponible ${qty(disponible)}`,"error");invalid=true;return}
    const codeSerie=(row.querySelector('[name="site_mat_codeSerie"]')?.value||"").trim();
    equipements.push({
      backendId:row.querySelector('[name="site_mat_backendId"]')?.value||"",
      equipmentBackendId:row.querySelector('[name="site_mat_equipmentBackendId"]')?.value||"",
      categorie:mag?.nom||article.categorie||"",
      magasinId:mag?.id||article.magasinId||"",
      articleId:article.id,articleBackendId:article.backendId||"",
      designation:article.designation||article.sousCategorie||article.code||"Article",
      quantite,codeSerie,numeroSerie:codeSerie,reference:codeSerie,
      etat:row.querySelector('[name="site_mat_etat"]')?.value||"neuf",
      observation:(row.querySelector('[name="site_mat_observation"]')?.value||"").trim()
    });
  });
  if(invalid)return;
  s.equipements=equipements;
  try{
    await persistSiteEquipmentDotations(s);
    await persistSiteToPostgres(s);
  }catch(e){toast("Équipement non sauvegardé : "+(e.message||e),"error");return}
  sgdiFireAndForgetSave();
  toast("Équipements site enregistrés","success");
  renderView();
}

// Un seul enregistrement de fiche à la fois : un double clic relançait persistSiteEquipmentDotations
// avant que les lignes ne reçoivent leur identifiant serveur, d'où des mouvements de stock en double.
let siteSaveInFlight=false;
function siteTechSetSaving(busy){
  document.querySelectorAll("[data-site-save-action]").forEach(btn=>{
    if(busy){if(!btn.disabled){btn.disabled=true;btn.dataset.siteSaveDisabled="1"}btn.setAttribute("aria-busy","true")}
    else{if(btn.dataset.siteSaveDisabled==="1"){btn.disabled=false;delete btn.dataset.siteSaveDisabled}btn.removeAttribute("aria-busy")}
  });
}
async function siteSaveExclusive(run){
  if(siteSaveInFlight){toast("Enregistrement déjà en cours…","info");return}
  siteSaveInFlight=true;siteTechSetSaving(true);
  try{return await run()}finally{siteSaveInFlight=false;siteTechSetSaving(false)}
}
function saveSite(id){return siteSaveExclusive(()=>saveSiteRun(id))}
async function saveSiteRun(id){
  if(guardOpsSupervisorMutation("site","Accès superviseur OPS : édition des sites non autorisée."))return;
  const f=document.getElementById("site-form");
  const fd=new FormData(f);
  const scopeSociete=siteSafeSociete({societe:currentStructureSocieteFilter()||mySoc()||sessionStorage.getItem("dashSociete")||session?.societe||""})||currentStructureSocieteFilter()||mySoc()||sessionStorage.getItem("dashSociete")||session?.societe||"";
  const lookup=decodeURIComponent(String(id||""));
  let s=db.sites.find(x=>String(x.id)===lookup||String(x.backendId||"")===lookup);
  if(s&&!siteCanEditFromCurrentModule(s)&&sgdiViewModeActive){
    toast("Fiche site verrouillée : modification réservée à Administration système","error");
    return;
  }
  if(!s){toast("Création des sites dans Commercial : dc.irongs.com", "info");return;}
  if(!(s.contractualReadOnly||s.equipment_plan?.contractualReadOnly)){
    const posteErrors=siteTechRenderPosteErrors();
    if(posteErrors.length){toast(posteErrors[0],"error");document.getElementById("site-postes-errors")?.scrollIntoView?.({block:"center"});return}
  }
  // Ne JAMAIS réécrire silencieusement la société d'un site existant à partir du
  // contexte courant de l'éditeur (bug source des sites mal rattachés : sauvegarder
  // une fiche pendant qu'on a une autre société active la faisait basculer). Seule
  // Administration système peut réaffecter explicitement via le champ "Société" ;
  // sinon la société déjà connue du site est conservée telle quelle, et seule
  // l'inférence de contexte s'applique à un site réellement nouveau.
  const explicitSociete=isAdminSystemSession()?(fd.get("societe")||"").trim():"";
  if(explicitSociete){
    s.societe=explicitSociete;
  }else if(!s.societe){
    s.societe=siteSafeSociete({...s,societe:scopeSociete})||scopeSociete;
  }
  s.society=s.societe;
  s.nom=(fd.get("nom")||"").trim();
  if(!s.nom){toast("Dénomination du site obligatoire","error");return}
  s.indicatif=fd.get("indicatif");
  s.codeOfficiel=String(fd.get("codeOfficiel")||"").trim().toUpperCase();
  s.adresse=fd.get("adresse");
  s.commune=fd.get("commune");
  s.wilaya=fd.get("wilaya");
  s.latitude=(fd.get("latitude")||"").trim();
  s.longitude=(fd.get("longitude")||"").trim();
  if(s.latitude&&s.longitude)s.coordonnees={latitude:parseFloat(s.latitude),longitude:parseFloat(s.longitude)};
  else delete s.coordonnees;
  s.dateOuverture=(fd.get("dateOuverture")||"").trim();
  s.siteOuvertPar=(fd.get("siteOuvertPar")||"").trim();
  s.type=fd.get("type");
  s.contact={nom:fd.get("contact_nom"),fonction:fd.get("contact_fonction"),telephone:fd.get("contact_tel"),email:fd.get("contact_email")};
  const dcLocked=!!(s.contractualReadOnly||s.equipment_plan?.contractualReadOnly);
  const dcEffectifs=s.effectifs,dcPostes=s.postes,dcClient=s.client,dcClientId=s.clientId;
  s.client=fd.get("client")||s.contact.nom;
  s.clientId=(fd.get("clientId")||"").trim();
  s.postes={};
  const noms=fd.getAll("poste_nom"),jours=fd.getAll("poste_jour"),nuits=fd.getAll("poste_nuit"),rotations=fd.getAll("poste_rotationSystem");
  let totalContractuel=0,totalJour=0,totalNuit=0;
  noms.forEach((nom,i)=>{
    nom=(nom||"").trim();
    if(!nom)return;
    const jour=+jours[i]||0,nuit=+nuits[i]||0,rotationSystem=rotations[i]||"";
    const total=sitePosteTotalCalc(jour,nuit,rotationSystem);
    totalContractuel+=total;totalJour+=jour;totalNuit+=nuit;
    s.postes[nom]={total,jour,nuit,rotationSystem};
  });
  s.effectifs={totalContractuel,groupes:+fd.get("eff_groupes")||0,jour:totalJour,nuit:totalNuit,weekend:+fd.get("eff_weekend")||0,feries:+fd.get("eff_feries")||0};
  if(dcLocked){s.effectifs=dcEffectifs;s.postes=dcPostes;s.client=dcClient;s.clientId=dcClientId;}
  s.equipements=[];
  let siteMaterielInvalid=false;
  document.querySelectorAll("#site-materiel-body .site-materiel-row").forEach(row=>{
    if(siteMaterielInvalid)return;
    const magasinId=row.querySelector('[name="site_mat_magasinId"]')?.value||"";
    const articleId=row.querySelector('[name="site_mat_articleId"]')?.value||"";
    const article=(db.stockArticles||[]).find(a=>String(a.id)===String(articleId));
    const mag=(db.magasins||[]).find(m=>String(m.id)===String(magasinId));
    const quantite=parseFloat(row.querySelector('[name="site_mat_quantite"]')?.value||"0")||0;
    const existingDotationRef=(row.querySelector('[name="site_mat_backendId"]')?.value||"")||(row.querySelector('[name="site_mat_equipmentBackendId"]')?.value||"");
    if(!article&&!magasinId&&!quantite)return;
    if(!article){toast("Choisissez un article disponible dans la dotation site","error");siteMaterielInvalid=true;return}
    if(quantite<=0){toast("Quantité matériel site invalide","error");siteMaterielInvalid=true;return}
    const disponible=typeof dotationStockDisponible==="function"?dotationStockDisponible(article):stockGetActuel(article.id);
    if(!existingDotationRef&&disponible<=0){toast(`${article.designation||"Article"} non disponible en stock`,"error");siteMaterielInvalid=true;return}
    if(!existingDotationRef&&quantite>disponible){toast(`Stock insuffisant pour ${article.designation||"article"} : disponible ${qty(disponible)}`,"error");siteMaterielInvalid=true;return}
    const codeSerie=(row.querySelector('[name="site_mat_codeSerie"]')?.value||"").trim();
    s.equipements.push({
      backendId:row.querySelector('[name="site_mat_backendId"]')?.value||"",
      equipmentBackendId:row.querySelector('[name="site_mat_equipmentBackendId"]')?.value||"",
      categorie:mag?.nom||article.categorie||"",
      magasinId:mag?.id||article.magasinId||"",
      articleId:article.id,
      articleBackendId:article.backendId||"",
      designation:article.designation||article.sousCategorie||article.code||"Article",
      quantite,
      codeSerie,
      numeroSerie:codeSerie,
      reference:codeSerie,
      etat:row.querySelector('[name="site_mat_etat"]')?.value||"neuf",
      observation:(row.querySelector('[name="site_mat_observation"]')?.value||"").trim()
    });
  });
  if(siteMaterielInvalid)return;
  s.heureReleveJour=fd.get("heureReleveJour")||"";
  s.heureReleveNuit=fd.get("heureReleveNuit")||"";
  s.horairesReleves="";
  s.rotationSystem=fd.get("rotationSystem")||"24/48";
  s.rotation=siteRotationFromSystem(s.rotationSystem);
  s.clientPortalRotation={...(s.clientPortalRotation||s.equipment_plan?.clientPortalRotation||{}),system:s.rotationSystem};
  try{s.rotationPlanning=JSON.parse(fd.get("rotationPlanningJson")||"{}")}catch(e){s.rotationPlanning={}}
  s.ficheTechniqueLocked=true;
  s.siteFormLocked=true;
  s.lockedAt=new Date().toISOString();
  s.lockedBy=session?.username||"SGDI";
  try{
    await persistSiteToPostgres(s);
    await persistSiteEquipmentDotations(s);
    if(!db.sites.some(x=>String(x.id)===String(s.id)||String(x.backendId||"")===String(s.backendId||"")))db.sites.unshift(s);
  }catch(e){
    toast("Site non sauvegardé : "+(e.message||e),"error");
    return;
  }
  sgdiFireAndForgetSave();
  const savedSociete=s.societe||scopeSociete||"";
  if(savedSociete)storeCurrentStructureSocieteFilter(savedSociete);
  if(session?.transverse==="admin"&&savedSociete)sessionStorage.setItem(ADMIN_ACTIVE_SOCIETE_KEY,savedSociete);
  sgdiServerSetPage("sites",savedSociete||"all",1);
  toast("Site enregistré et fiche verrouillée","success");
  s.isNew=false;
  const lockedRoute="sites/"+siteEditRouteId(s);
  if(session?.transverse==="admin")navigate("sites/actifs");
  else{
    location.hash="#/"+lockedRoute;
    sitesModuleTimeout(()=>renderView(),0);
  }
}

SGDIModules.registerModule({key: "sites-1", routes: [], dependencies: [], init: function(){}, destroy: function(){}});
