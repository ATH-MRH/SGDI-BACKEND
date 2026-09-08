/* Phase 2 — material. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function printFicheDotation(agentId){
  const a=(db.agents||[]).find(x=>x.id===agentId);if(!a){toast("Employé introuvable","error");return}
  const w=window.open("","_blank","width=1000,height=800");
  w.document.write(ficheDotationDocumentHTML(agentId).replace("</body>",`<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body>`));
  w.document.close();
}

function openAttribuerToAgentModal(agentId){
  const a=db.agents.find(x=>x.id===agentId);if(!a)return;
  const stock=db.materiel.filter(m=>m.statut==="en_stock");
  if(stock.length===0){toast("Aucun article disponible en stock","error");return}
  openModal(`<h3 class="font-bold text-lg mb-4">➕ Attribuer un matériel à ${escapeHTML(a.nom+" "+a.prenom)}</h3>
    <form onsubmit="event.preventDefault();confirmAttribuerToAgent('${agentId}')">
      <div class="grid grid-2">
        <div class="col-span-2"><label class="label">Article disponible *</label><select class="select" name="materielId" ><option value="">— Choisir —</option>${stock.map(m=>`<option value="${m.id}">${safe(m.code)} — ${escapeHTML(m.categorie)} — ${escapeHTML(m.designation)} ${m.numeroSerie?"["+escapeHTML(m.numeroSerie)+"]":""}</option>`).join("")}</select></div>
        <div><label class="label">Date d'attribution</label><input class="input" type="date" name="dateAttribution" value="${today()}" /></div>
        <div><label class="label">État au moment</label><select class="select" name="etat">${ETATS_MATERIEL.map(e=>`<option>${e}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Notes</label><input class="input" name="notes" placeholder="Accessoires inclus, remarques..."/></div>
      </div>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Confirmer attribution</button></div>
    </form>`)
}

function confirmAttribuerToAgent(agentId){
  const f=document.querySelector(".modal-bg form");const fd=new FormData(f);
  const matId=fd.get("materielId");const m=db.materiel.find(x=>x.id===matId);if(!m)return;
  const a=db.agents.find(x=>x.id===agentId);if(!a)return;
  m.agentId=agentId;m.statut="attribue";m.dateAttribution=fd.get("dateAttribution")||today();m.dateRetour=null;m.etat=fd.get("etat")||m.etat;
  if(!m.societe)m.societe=a.societe;
  if(fd.get("notes"))m.notes=(m.notes?m.notes+" | ":"")+"Attribution: "+fd.get("notes");
  saveDB();closeModal();toast("Matériel attribué","success");renderView();
}

function statutMatPill(s){return{"en_stock":"pill-green","attribue":"pill-blue","en_reparation":"pill-amber","perdu":"pill-red","reforme":"pill-gray"}[s]||"pill-gray"}

function statutMatLabel(s){return{"en_stock":"En stock","attribue":"Attribué","en_reparation":"En réparation","perdu":"Perdu","reforme":"Réformé"}[s]||s}

function etatMatPill(e){return{"Neuf":"pill-green","Bon état":"pill-blue","Usé":"pill-amber","Hors service":"pill-red"}[e]||"pill-gray"}

function nextMatCode(cat){const prefix={"Uniforme":"UN","Chaussures":"CH","Casquette":"CP","Insigne":"IN","Badge":"BD","Talkie-walkie":"TW","Téléphone":"TP","Bâton télescopique":"BT","Menottes":"MN","Lampe torche":"LM","Sifflet":"SF","Détecteur de métaux":"DM","Veste pare-balles":"VP","Imperméable":"IM","Brassard":"BR","Véhicule":"VH","Vélo":"VL","Ordinateur":"OR","Tablette":"TB","Caméra-piéton":"CM","Trousse 1ers secours":"TS","Autre":"AU"}[cat]||"AU";const n=db.materiel.filter(m=>m.code&&m.code.startsWith(prefix+"-")).length+1;return prefix+"-"+String(n).padStart(3,"0")}

function sgdiCheckSortantDotationAlert(){
  if(!sgdiAlertModuleAllowed("materiel"))return;
  const soc=currentStructureSocieteFilter()||mySoc()||"";
  const sortants=(db.agents||[]).filter(a=>a.statut==="sortant"&&!a.finRelationDotationReversee&&a.finRelationAt&&(!soc||!a.societe||a.societe===soc));
  if(!sortants.length)return;
  const key="sgdi-sortant-dot-alerted:"+sortants.map(a=>a.id||a.matricule).sort().join(",");
  try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,"1");}catch(e){}
  const list=sortants.map(a=>`<li style="margin:5px 0"><b>${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())}</b> (${escapeHTML(a.matricule||a.code||"")}) — Sortant depuis le ${formatDate(a.dateSortie||"")}</li>`).join("");
  openModal(`<div style="max-width:520px">
    <div style="background:#7f1d1d;color:#fff;padding:16px 18px;border-radius:8px 8px 0 0;font-weight:900;font-size:16px;display:flex;align-items:center;gap:12px">
      <span style="font-size:26px">⚠️</span> ALERTE — DOTATION À RÉCUPÉRER
    </div>
    <div style="padding:22px">
      <p style="font-weight:700;margin:0 0 14px;color:#991b1b;font-size:14px">Les employé(s) suivant(s) sont SORTANTS et n'ont pas encore reversé leur dotation :</p>
      <ul style="margin:0 0 16px;padding-left:20px;color:#1e293b;font-size:13px">${list}</ul>
      <p style="font-size:12px;color:#64748b;margin:0 0 18px">Procéder au reversement dans <b>MATÉRIEL → Employé en attente de dotation</b>.</p>
      <div style="text-align:right;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-danger" onclick="closeModal();location.hash='#/materiel/dotation'">Voir les dotations</button>
        <button class="btn" onclick="closeModal()">Fermer</button>
      </div>
    </div>
  </div>`);
}

function renderMateriel(view,sub,arg){
  positionsStopInteractions();
  if(!db.materiel)db.materiel=[];
  if(!db.magasins)db.magasins=[];
  if(!db.magasinArticles)db.magasinArticles=[];
  if(!db.stockArticles)db.stockArticles=[];
  if(!db.stockMouvements)db.stockMouvements=[];
  if(!db.fournisseurs)db.fournisseurs=[];
  matNormalizeRelations();
  // Simple module routes (new architecture)
  if(!sub||sub==="dashboard"){
    if(sgdiAuthToken())renderMatSimpleDashboardServer(view);
    else renderMatSimpleDashboard(view);
    setTimeout(sgdiCheckSortantDotationAlert,0);
    return;
  }
  if(sub==="fiches"){try{sessionStorage.setItem("ficheContext","materiel")}catch(e){}return renderFiches(view,"toutes")}
  if(sub==="fiche"&&arg){try{sessionStorage.setItem("ficheContext","materiel")}catch(e){}return renderAgentForm(view,arg)}
  if(sub==="inventaire"){return renderMatSimpleInventaire(view)}
  if(sub==="articles"||sub==="catalogue"){return renderMatSimpleArticles(view)}
  if(sub==="magasins"){return renderMatSimpleMagasins(view)}
  if(sub==="magasin"&&arg){return renderMatSimpleMagasinDetail(view,arg)}
  if(sub==="magasin-nouveau"){return renderMatSimpleMagasinForm(view,null)}
  if(sub==="magasin-edit"&&arg){return renderMatSimpleMagasinForm(view,arg)}
  if(sub==="entree-stock"){renderMatSimpleMouvements(view);setTimeout(()=>stockOpenMvt("entree"),0);return}
  if(sub==="sortie-stock"){renderMatSimpleMouvements(view);setTimeout(()=>stockOpenMvt("sortie"),0);return}
  if(sub==="fournisseurs"){return renderMatSimpleFournisseurs(view)}
  if(sub==="fournisseur"&&arg){return renderMatSimpleFournisseurDetail(view,arg)}
  if(sub==="fournisseur-nouveau"){return renderMatSimpleFournisseurForm(view,null)}
  if(sub==="fournisseur-edit"&&arg){return renderMatSimpleFournisseurForm(view,arg)}
  if(sub==="sites-dotation"){return renderMatSitesEnAttenteDotation(view)}
  if(sub==="dotation"){return (sgdiAuthToken()&&!window.__sgdiMatDotationLocalFallback)?renderMatSimpleDotationServer(view):renderMatSimpleDotation(view)}
  if(sub==="reversement"){return renderMatSimpleReversement(view)}
  // Stock pro routes (still available for article detail & forms)
  if(sub==="article"&&arg){return renderStockArticleDetail(view,arg)}
  if(sub==="article-nouveau"){return renderStockArticleForm(view,null)}
  if(sub==="article-edit"&&arg){return renderStockArticleForm(view,arg)}
  if(sub==="mouvements"){return sgdiAuthToken()?renderMatSimpleMouvementsServer(view):renderMatSimpleMouvements(view)}
  if(sub==="alertes"){return sgdiAuthToken()?renderMatSimpleAlertesServer(view):renderMatSimpleAlertes(view)}
  if(sub==="stats"||sub==="statistiques"){return renderStockProMain(view,"statistiques")}
  if(sub==="entrees"){return renderStockProMain(view,"entrees")}
  if(sub==="sorties"){return renderStockProMain(view,"sorties")}
  if(sub==="attributions"){return renderStockProMain(view,"attributions")}
  if(sub==="retours"){return renderStockProMain(view,"retours")}
  // Legacy unitaire routes (kept)
  if(sub==="nouveau"){return renderMaterielForm(view,null)}
  if(sub==="edit"&&arg){return renderMaterielForm(view,arg)}
  // Default
  return renderMatSimpleDashboard(view);
}

function matSimpleMagasinTitleClass(nom){
  return MAT_SIMPLE_MAGASIN_TITRES_20.has(String(nom||"").trim().toUpperCase())?"font-black text-[20px] leading-tight":"font-bold text-base";
}

function matNormalizeRelations(){
  try{
    const fournisseursById=new Map((db.fournisseurs||[]).map(f=>[f.id,f]));
    const magasinsById=new Map((db.magasins||[]).map(m=>[m.id,m]));
    const articlesById=new Map((db.stockArticles||[]).map(a=>[a.id,a]));
    (db.stockArticles||[]).forEach(a=>{
      if(a.fournisseurId&&fournisseursById.has(a.fournisseurId))a.fournisseur=fournisseursById.get(a.fournisseurId).raisonSociale||a.fournisseur||"";
      if(a.magasinId&&magasinsById.has(a.magasinId))a.magasin=magasinsById.get(a.magasinId).nom||a.magasin||"";
      if(Array.isArray(a.stockReceptionsGlobales)&&a.stockReceptionsGlobales.length){
        a.quantiteGlobaleRecue=stockGlobalStockTotal(a.stockReceptionsGlobales);
        const flatDetails=stockReceptionDetailRows(a.stockReceptionsGlobales);
        if(flatDetails.length&&!Array.isArray(a.stockVariantes))a.stockVariantes=flatDetails;
        if(!parseFloat(a.stockInitial))a.stockInitial=a.quantiteGlobaleRecue;
      }
      if(!a.designation)a.designation=a.sousCategorie||stockGetCategorie(a.societe,a.categorie).label||a.code||"Article";
    });
    (db.stockMouvements||[]).forEach(m=>{
      const a=articlesById.get(m.articleId);
      if(a){
        m.societe=m.societe||a.societe||"";
        m.articleCode=m.articleCode||a.code||"";
        m.articleDesignation=m.articleDesignation||a.designation||"";
        if(!m.prixUnitaire&&a.prixUnitaire)m.prixUnitaire=a.prixUnitaire;
      }
      if(m.fournisseurId&&fournisseursById.has(m.fournisseurId))m.fournisseur=fournisseursById.get(m.fournisseurId).raisonSociale||m.fournisseur||"";
    });
  }catch(err){console.warn("matNormalizeRelations",err)}
}

function matSimpleSetSoc(v){if(mySoc()){toast("Vous êtes sur "+mySoc()+". Utilisez Changer de société.","error");return}sessionStorage.setItem("mtSociete",v||"");render()}

function matSimpleBySoc(arr){const s=matSimpleSocFilter();return s?arr.filter(x=>!x.societe||normalizeSocieteName(x.societe)===normalizeSocieteName(s)):arr.slice()}

function dotationReplacementDueFrom(dateValue,lifeMonths){
  const months=parseFloat(lifeMonths)||0;
  if(months<=0||!dateValue)return false;
  const start=new Date(String(dateValue).slice(0,10));
  if(Number.isNaN(start.getTime()))return false;
  const due=new Date(start);
  due.setMonth(due.getMonth()+months);
  return due<=new Date();
}

function agentHasDotationToReplace(aOrId){
  const a=typeof aOrId==="object"?aOrId:findEmployeeByRef(aOrId);
  if(!a)return false;
  const stockRows=(db.stockMouvements||[]).filter(m=>stockMvtIsOut(m.type)&&stockMovementBelongsToAgent(m,a));
  if(stockRows.some(m=>{
    const art=stockFindArticleByAnyRef(m.articleId||m.articleBackendId);
    return dotationReplacementDueFrom(m.date||m.createdAt,m.dureeVieMois||art?.dureeVieMois);
  }))return true;
  return employeeLocalDotationSnapshots(a.id).some(d=>{
    const art=stockFindArticleByAnyRef(d.articleId||d.articleBackendId||d.code);
    return dotationReplacementDueFrom(d.date||d.dateDotation||d.createdAt,d.dureeVieMois||d.usefulLifeMonths||art?.dureeVieMois);
  });
}

function dotationFilterAgentSelect(filter){
  ["dotf-nondotes","dotf-dotes","dotf-tout"].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.checked=(id===`dotf-${filter}`);
  });
  // Re-apply current search query (if any) with the new filter
  dotationSearchAgent(document.getElementById("dotf-search")?.value||"");
}

function dotationSearchAgent(query){
  const norm=v=>String(v||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  const q=norm(query);
  const filter=document.getElementById("dotf-dotes")?.checked?"dotes":document.getElementById("dotf-tout")?.checked?"tout":"nondotes";
  const soc=matSimpleSocFilter();
  const active=matDotationScopedActiveAgents(soc);
  let filtered;
  if(filter==="dotes")filtered=active.filter(agentHasMaterialDotation);
  else if(filter==="nondotes")filtered=active.filter(a=>!agentHasMaterialDotation(a));
  else filtered=active;
  if(q){
    filtered=filtered.filter(a=>{
      const fields=[
        (a.nom||"")+" "+(a.prenom||""),
        a.matricule||a.code||"",
        a.societe||"",
        a.affectationCourante?.siteNom||a.affectationCourante?.site||a.site||"",
        a.affectationCourante?.structure||a.structure||"",
        a.affectationCourante?.poste||a.fonction||"",
        a.wilaya||"",
        a.commune||"",
      ];
      return fields.some(f=>norm(f).includes(q));
    });
  }
  filtered=filtered.slice().sort((a,b)=>`${a.nom||""} ${a.prenom||""}`.localeCompare(`${b.nom||""} ${b.prenom||""}`));
  const sel=document.querySelector("#stock-dotation-form [name='agentId']");
  if(!sel)return;
  const noResultMsg=q?"— Aucun résultat pour cette recherche —":filter==="dotes"?"— Aucun employé doté —":filter==="nondotes"?"— Aucun employé non doté —":"— Aucun employé actif —";
  const placeholder=filtered.length?(q?"— Sélectionner l'employé —":filter==="dotes"?"— Choisir employé doté —":filter==="nondotes"?"— Choisir employé non doté —":"— Choisir employé —"):noResultMsg;
  sel.innerHTML=`<option value="">${placeholder}</option>${filtered.map(a=>`<option value="${escapeHTML(a.id)}">${escapeHTML((a.nom||"")+" "+(a.prenom||""))} · ${escapeHTML(a.matricule||"—")} · ${escapeHTML(a.affectationCourante?.poste||a.fonction||"")}${a.societe?` · ${escapeHTML(a.societe)}`:""}</option>`).join("")}`;
  const countEl=document.getElementById("dotation-benef-count");
  if(countEl){
    const msg=q?`${filtered.length} résultat(s) pour « ${query} »`:filter==="dotes"?`${filtered.length} employé(s) avec dotation existante.`:filter==="nondotes"?`${filtered.length} employé(s) actif(s) sans dotation matérielle.`:`${filtered.length} employé(s) actif(s).`;
    countEl.className=`text-xs ${filtered.length?"text-emerald-700":"text-red-700"} mt-1`;
    countEl.textContent=msg;
  }
  dotationAgentChanged();
}

function matSimpleHeader(active){
  const soc=matSimpleSocFilter();
  const arts=matSimpleBySoc(db.stockArticles||[]);
  const mags=matSimpleBySoc(db.magasins||[]);
  const fours=matSimpleBySoc(db.fournisseurs||[]);
  const mvts=matSimpleBySoc(db.stockMouvements||[]);
  const dot=materialPendingDotationCountForSoc(soc);
  const rev=agentsEnInstanceReversement().length;
  const alerts=arts.filter(a=>stockGetEtat(a).code!=="ok").length;
  const tabs=[
    ["dashboard","Tableau de bord","materiel/dashboard"],
    ["articles","Catalogue","materiel/articles",arts.length],
    ["dotation","Dotations","materiel/dotation",dot||undefined],
    ["mouvements","Mouvements","materiel/mouvements"],
    ["alertes","Alertes","materiel/alertes",alerts||undefined]
  ];
  const socOptions=`<option value="">Toutes sociétés</option>${SOCIETES.map(s=>`<option ${soc===s?"selected":""}>${escapeHTML(s)}</option>`).join("")}`;
  return `<nav class="no-print mb-4" style="display:flex;align-items:center;gap:0;border-bottom:2px solid #e2e8f0;background:#fff">
    ${tabs.map(([key,label,route,count])=>`<a href="#/${route}" style="padding:10px 20px;font-size:13px;font-weight:700;text-decoration:none;border-bottom:${active===key?"3px solid #043970":"3px solid transparent"};color:${active===key?"#043970":"#64748b"};white-space:nowrap;display:flex;align-items:center;gap:6px">${escapeHTML(label)}${count!=null?`<span style="background:${active===key?"#043970":"#e2e8f0"};color:${active===key?"#fff":"#475569"};border-radius:999px;padding:1px 7px;font-size:11px">${count}</span>`:""}</a>`).join("")}
    <div style="margin-left:auto;padding:6px 12px">${mySoc()?"":`<select class="select" style="font-size:12px;padding:4px 8px" onchange="matSimpleSetSoc(this.value)">${socOptions}</select>`}</div>
  </nav>`;
}

function matSimpleFournisseurStats(fid){
  const mvts=(db.stockMouvements||[]).filter(m=>m.type==="entree"&&m.fournisseurId===fid);
  const totalAchats=mvts.reduce((s,m)=>s+(parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0),0);
  const lastDate=mvts.length?mvts.map(m=>m.date).sort().slice(-1)[0]:"";
  return{nb:mvts.length,total:totalAchats,lastDate};
}

function renderMatSimpleDashboard(view){
  try{scheduleSidebarStatsRefresh()}catch(e){}
  const soc=matSimpleSocFilter();
  const arts=matSimpleBySoc(db.stockArticles||[]);
  const mags=matSimpleBySoc(db.magasins||[]);
  const fours=matSimpleBySoc(db.fournisseurs||[]);
  const mvts=matSimpleBySoc(db.stockMouvements||[]);
  const employeesEnInstanceDotationCount=materialPendingDotationCountForSoc(soc);
  let totalQty=0,totalVal=0,nbAlertes=0,nbRupture=0;
  arts.forEach(a=>{
    const q=typeof stockGetActuel==="function"?stockGetActuel(a.id):(parseFloat(a.stockInitial)||0);
    totalQty+=q;
    totalVal+=q*(parseFloat(a.prixUnitaire)||0);
    const etat=stockGetEtat(a);
    if(etat.code==="rupture")nbRupture++;
    else if(etat.code==="alerte"||etat.code==="min")nbAlertes++;
  });
  const now=new Date();
  const m30=new Date(now);m30.setDate(m30.getDate()-30);
  const since=m30.toISOString().slice(0,10);
  const mvts30=mvts.filter(m=>(m.date||"")>=since);
  const entreesMois=mvts30.filter(m=>m.type==="entree").reduce((s,m)=>s+(parseFloat(m.quantite)||0),0);
  const sortiesMois=mvts30.filter(m=>stockMvtIsOut(m.type)).reduce((s,m)=>s+(parseFloat(m.quantite)||0),0);
  const valEntreesMois=mvts30.filter(m=>m.type==="entree").reduce((s,m)=>s+(parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0),0);
  // Top fournisseurs (90j)
  const m90=new Date(now);m90.setDate(m90.getDate()-90);
  const since90=m90.toISOString().slice(0,10);
  const fournRank={};
  mvts.filter(m=>m.type==="entree"&&(m.date||"")>=since90&&m.fournisseurId).forEach(m=>{
    const f=fournRank[m.fournisseurId]||{nb:0,total:0};
    f.nb++;f.total+=(parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0);
    fournRank[m.fournisseurId]=f;
  });
  const topFourns=Object.keys(fournRank).map(id=>{const f=db.fournisseurs.find(x=>x.id===id);return{id,name:f?f.raisonSociale:"?",...fournRank[id]}}).sort((a,b)=>b.total-a.total).slice(0,5);
  // Top magasins
  const topMags=mags.map(m=>({m,...matSimpleStockMagasin(m.id)})).sort((a,b)=>b.qty-a.qty).slice(0,5);

  const header=matSimpleHeader("dashboard");
  const alertsBadge=(nbRupture+nbAlertes)>0?`<span style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700">${nbRupture+nbAlertes} alerte(s)</span>`:"";
  const kpi=`<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
    <button onclick="navigate('materiel/articles')" class="card p-5 text-left" style="border:none;cursor:pointer;background:#f8fafc">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:.05em">Articles</div>
      <div style="font-size:32px;font-weight:900;color:#043970;line-height:1.1;margin:4px 0">${arts.length}</div>
      <div style="font-size:12px;color:#94a3b8">${qty(totalQty)} unités · ${money(totalVal)}</div>
    </button>
    <button onclick="navigate('materiel/dotation')" class="card p-5 text-left" style="border:none;cursor:pointer;background:${employeesEnInstanceDotationCount?"#fef2f2":"#f8fafc"}">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${employeesEnInstanceDotationCount?"#dc2626":"#64748b"};letter-spacing:.05em">En attente de dotation</div>
      <div style="font-size:32px;font-weight:900;color:${employeesEnInstanceDotationCount?"#dc2626":"#043970"};line-height:1.1;margin:4px 0">${employeesEnInstanceDotationCount}</div>
      <div style="font-size:12px;color:#94a3b8">employé(s) sans équipement</div>
    </button>
    <button onclick="navigate('materiel/mouvements')" class="card p-5 text-left" style="border:none;cursor:pointer;background:#f8fafc">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:.05em">Mouvements 30j</div>
      <div style="font-size:32px;font-weight:900;color:#043970;line-height:1.1;margin:4px 0">${mvts30.length}</div>
      <div style="font-size:12px;color:#94a3b8">+${qty(entreesMois)} entrées · -${qty(sortiesMois)} sorties</div>
    </button>
    <button onclick="sessionStorage.setItem('matFiltEtat','${nbRupture>0?"rupture":"alerte"}');navigate('materiel/articles')" class="card p-5 text-left" style="border:none;cursor:pointer;background:${(nbRupture+nbAlertes)>0?"#fffbeb":"#f8fafc"}">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${(nbRupture+nbAlertes)>0?"#b45309":"#64748b"};letter-spacing:.05em">Alertes stock</div>
      <div style="font-size:32px;font-weight:900;color:${nbRupture>0?"#dc2626":(nbAlertes>0?"#b45309":"#16a34a")};line-height:1.1;margin:4px 0">${nbRupture+nbAlertes}</div>
      <div style="font-size:12px;color:#94a3b8">${nbRupture} rupture · ${nbAlertes} stock bas</div>
    </button>
  </div>`;
  const actions=`<div class="flex gap-2 flex-wrap mb-5">
    <button class="btn btn-primary" onclick="stockOpenMvt('entree')">+ Entrée stock</button>
    <button class="btn btn-secondary" onclick="navigate('materiel/dotation')">Nouvelle dotation</button>
    <button class="btn btn-secondary" onclick="navigate('materiel/article-nouveau')">Nouvel article</button>
    ${isAdminGeneralSession()||isAdminSystemSession()?`<button class="btn" style="background:#7c3aed;color:#fff" onclick="lancerDotationInitiale()">⚡ Dotation initiale</button>`:""}
  </div>`;
  const magasinsList=mags.slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||"","fr"));
  const magasinsSection=`<section class="mb-5" aria-labelledby="materiel-dashboard-magasins">
    <div class="flex items-center justify-between gap-3 mb-3">
      <div>
        <h2 id="materiel-dashboard-magasins" class="font-black text-lg" style="color:#0f172a">Magasins</h2>
        <div class="text-xs text-slate-500">${magasinsList.length} magasin(s)${soc?` · ${escapeHTML(soc)}`:""}</div>
      </div>
      <a href="#/materiel/magasins" class="btn btn-secondary text-sm">Voir tous les magasins</a>
    </div>
    ${magasinsList.length?`<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      ${magasinsList.map(m=>{
        const st=matSimpleStockMagasin(m.id);
        const color=String(m.color||m.config?.color||MAT_SIMPLE_HEADER_COLOR);
        return `<a href="#/materiel/magasin/${encodeURIComponent(m.id)}" class="card p-4" style="display:block;text-decoration:none;border-left:4px solid ${escapeHTML(color)};transition:transform .15s ease,box-shadow .15s ease">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <span aria-hidden="true" style="font-size:25px;line-height:1">${escapeHTML(m.icon||"🏬")}</span>
              <div class="min-w-0">
                <div class="font-black truncate" style="color:#0f172a">${escapeHTML(m.nom||"Magasin")}</div>
                <div class="text-xs text-slate-500 truncate">${escapeHTML([m.code,m.societe].filter(Boolean).join(" · ")||"Toutes sociétés")}</div>
              </div>
            </div>
            ${st.alertes?`<span style="background:#fef2f2;color:#dc2626;border-radius:999px;padding:2px 7px;font-size:10px;font-weight:800;white-space:nowrap">${st.alertes} alerte(s)</span>`:""}
          </div>
          <div class="grid grid-cols-3 gap-2 mt-4 pt-3 border-t text-center">
            <div><div class="font-black" style="color:#043970">${st.nb}</div><div class="text-[10px] uppercase text-slate-500">Articles</div></div>
            <div><div class="font-black" style="color:#043970">${qty(st.qty)}</div><div class="text-[10px] uppercase text-slate-500">Unités</div></div>
            <div><div class="font-black" style="color:#043970">${money(st.val)}</div><div class="text-[10px] uppercase text-slate-500">Valeur</div></div>
          </div>
        </a>`;
      }).join("")}
    </div>`:`<div class="card p-6 text-center text-slate-500">
      <div class="text-2xl mb-2" aria-hidden="true">🏬</div>
      <div class="font-bold text-slate-700">Aucun magasin à afficher</div>
      <a href="#/materiel/magasin-nouveau" class="btn btn-primary text-sm mt-3">Créer un magasin</a>
    </div>`}
  </section>`;
  const alertsList=(nbRupture+nbAlertes)>0?`<div class="card p-4 mb-5" style="border-left:3px solid #dc2626">
    <div class="font-bold text-sm mb-2" style="color:#dc2626">Articles en alerte</div>
    ${arts.filter(a=>{const q=stockGetActuel?stockGetActuel(a.id):0;return q<=0}).slice(0,8).map(a=>`<div class="flex justify-between py-1 border-b text-sm"><a href="#/materiel/article/${a.id}" style="color:#dc2626;font-weight:600">${escapeHTML(a.designation||a.code)}</a><span style="color:#dc2626;font-size:11px;font-weight:700">RUPTURE</span></div>`).join("")}
    ${arts.filter(a=>{const e=stockGetEtat(a);return e.code==="alerte"||e.code==="min"}).slice(0,8).map(a=>{const q=stockGetActuel(a.id);const threshold=parseFloat(a.seuilAlerte)||parseFloat(a.stockMin)||0;return`<div class="flex justify-between py-1 border-b text-sm"><a href="#/materiel/article/${a.id}" style="color:#b45309;font-weight:600">${escapeHTML(a.designation||a.code)}</a><span style="color:#b45309;font-size:11px">${qty(q)} / ${qty(threshold)}</span></div>`}).join("")}
  </div>`:"";
  view.innerHTML=`${header}<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:16px"><div><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#94a3b8;letter-spacing:.08em">Matériel & équipement</div><div style="font-size:20px;font-weight:900;color:#0f172a">TABLEAU DE BORD ${alertsBadge}</div></div></div>${kpi}${actions}${magasinsSection}${alertsList}`;
}

async function renderMatSimpleDashboardServer(view){
  // Premier chargement de session : on attend les données serveur pour éviter
  // un flash de données périmées qui saute vers l'état réel.
  if(window.__sgdiMatDataSynced){
    renderMatSimpleDashboard(view);
  }else{
    const header=matSimpleHeader("dashboard");
    view.innerHTML=`${header}<div style="display:flex;align-items:center;justify-content:center;min-height:220px;color:#94a3b8"><div style="text-align:center"><div style="font-size:28px;margin-bottom:10px;opacity:.5">⏳</div><div style="font-weight:700;font-size:14px">Chargement du tableau de bord…</div></div></div>`;
  }
  if(window.__sgdiMatDashboardRefreshing)return;
  window.__sgdiMatDashboardRefreshing=true;
  try{
    const soc=matSimpleSocFilter();
    const [storesRes,articlesRes,movementsRes]=await Promise.all([
      SGDI.stock.storesPage?SGDI.stock.storesPage({society:soc||undefined,page:1,page_size:100}):SGDI.stock.stores(),
      SGDI.stock.articlesPage?SGDI.stock.articlesPage({society:soc||undefined,page:1,page_size:100}):SGDI.stock.articles(soc?{society:soc}:{}),
      SGDI.stock.movementsPage?SGDI.stock.movementsPage({page:1,page_size:100}):SGDI.stock.movements()
    ]);
    serverItems(storesRes).map(storeFromApi).forEach(m=>sgdiUpsertServerItem("magasins",m));
    serverItems(articlesRes).map(articleFromApi).forEach(a=>sgdiUpsertServerItem("stockArticles",a));
    serverItems(movementsRes).map(movementFromApi).forEach(m=>sgdiUpsertServerItem("stockMouvements",m));
    window.__sgdiMatDataSynced=true;
    if(typeof syncMaterialDotationsToEmployeesFromMovements==="function")syncMaterialDotationsToEmployeesFromMovements();
    if(String(location.hash||"")==="#/materiel"||String(location.hash||"").startsWith("#/materiel/dashboard"))renderMatSimpleDashboard(view);
  }catch(e){
    console.warn("Tableau de bord matériel serveur indisponible",e);
    if(!window.__sgdiMatDataSynced)renderMatSimpleDashboard(view);
  }finally{
    window.__sgdiMatDashboardRefreshing=false;
  }
}

async function renderMatSitesEnAttenteDotation(view){
  const header=matSimpleHeader("sites-dotation");
  const soc=matSimpleSocFilter();
  const _render=()=>{
    const sites=sitesEnAttenteDotationForSoc(soc);
    const actifs=(db.sites||[]).filter(s=>s&&s.actif!==false&&(!soc||siteMatchesSociete(s,soc)));
    const dotes=actifs.filter(siteHasDotationMateriel);
    view.innerHTML=`${header}<div class="flex justify-between items-center mb-3 flex-wrap gap-2">
    <div><h1 class="text-2xl font-bold" style="text-transform:uppercase">SITE EN ATTENTE DE DOTATION</h1><p class="text-slate-500 text-sm" style="text-transform:uppercase">${soc?escapeHTML(soc):"Toutes les sociétés"} · Sites actifs sans dotation matériel/site enregistrée.</p></div>
    <div class="flex gap-2"><button class="btn btn-secondary text-sm" onclick="navigate('materiel/dashboard')">Tableau de bord</button></div>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
    <div class="card p-4 ${sites.length?"ops-dot-counter-alert":""}"><div class="text-xs text-slate-500 uppercase">Sites en attente</div><div class="text-3xl font-black mt-1 text-red-700">${sites.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Sites dotés</div><div class="text-3xl font-black mt-1 text-emerald-700">${dotes.length}</div></div>
  </div>
  <div class="card overflow-hidden">
    <table><thead><tr><th>Site</th><th>Indicatif</th><th>Société</th><th>Client</th><th>Localisation</th><th>Effectif contractuel</th><th>Action</th></tr></thead>
    <tbody>${sites.length===0?`<tr><td colspan="7" class="text-center text-slate-500 p-6">Aucun site en attente de dotation.</td></tr>`:sites.map(s=>{const eff=siteEffectifsNorm(s);return`<tr data-searchable>
      <td><div class="font-semibold">${escapeHTML(s.nom||"Site")}</div><div class="text-xs text-slate-500">${escapeHTML(s.type||"")}</div></td>
      <td class="font-mono font-bold">${escapeHTML(s.indicatif||"—")}</td>
      <td class="text-xs">${escapeHTML(s.societe||"—")}</td>
      <td class="text-xs">${escapeHTML(s.client||"—")}</td>
      <td class="text-xs">${escapeHTML([s.commune,s.wilaya].filter(Boolean).join(", ")||s.adresse||"—")}</td>
      <td class="font-bold text-center">${eff.totalContractuel||0}</td>
      <td><button type="button" class="btn btn-primary text-xs" onclick="navigate('sites/${siteEditRouteId(s)}')">Doter le site</button></td>
    </tr>`}).join("")}</tbody></table>
  </div>`;
  };
  _render();
  if(sgdiAuthToken())syncSitesFromPostgres().then(()=>{if(String(location.hash||"").includes("sites-dotation"))_render();}).catch(()=>{});
}

async function renderMatSimpleDotationServer(view){
  // Render immediately from local data (articles + employees refresh in background)
  renderMatSimpleDotation(view);
  const soc=matSimpleSocFilter();
  const needsMvts=!window.__sgdiMatDataSynced||!(db.stockMouvements||[]).length;
  Promise.all([
    (SGDI.stock.articlesPage?SGDI.stock.articlesPage({society:soc||undefined,page:1,page_size:100}).then(serverItems):SGDI.stock.articles(soc?{society:soc}:{})).catch(()=>[]),
    (SGDI.employees.page?SGDI.employees.page({mode:"all",society:soc||undefined,page:1,page_size:100}).then(r=>r?.items||[]):SGDI.employees.list()).catch(()=>[]),
    needsMvts?(SGDI.stock.movementsPage?SGDI.stock.movementsPage({page:1,page_size:100}).then(serverItems):SGDI.stock.movements()).catch(()=>[]):Promise.resolve(null),
  ]).then(([articlesRes,employeesRes,mvtsRes])=>{
    let changed=false;
    if(articlesRes.length){db.stockArticles=articlesRes.map(articleFromApi);changed=true}
    if(employeesRes.length){employeesRes.forEach(e=>upsertServerEmployee(e));changed=true}
    if(mvtsRes&&mvtsRes.length){db.stockMouvements=mvtsRes.map(movementFromApi);window.__sgdiMatDataSynced=true;changed=true;if(typeof syncMaterialDotationsToEmployeesFromMovements==="function")syncMaterialDotationsToEmployeesFromMovements()}
    if(typeof sgdiRefreshCountersNow==="function")sgdiRefreshCountersNow({reason:"materiel-dotation"});
    if(changed&&String(location.hash||"").includes("dotation"))renderMatSimpleDotation(view);
  }).catch(e=>console.warn("Dotation : rafraîchissement arrière-plan impossible",e));
}

function dotationMagasinsForSoc(soc){
  const s=soc||matSimpleSocFilter()||"";
  return (db.magasins||[]).filter(m=>!s||!m.societe||normalizeSocieteName(m.societe)===normalizeSocieteName(s));
}

function dotationArticlesForMagasin(magasinId,soc){
  if(!magasinId)return[];
  const mag=(db.magasins||[]).find(m=>String(m.id)===String(magasinId)||String(m.backendId||"")===String(magasinId));
  if(!mag)return[];
  return (db.stockArticles||[]).filter(a=>{
    if(soc&&a.societe&&normalizeSocieteName(a.societe)!==normalizeSocieteName(soc))return false;
    return stockArticleBelongsToStore(a,mag);
  }).sort((a,b)=>(a.designation||"").localeCompare(b.designation||""));
}

function dotationReceptionForSerial(a,serial){
  const s=String(serial||"").trim();if(!a||!s)return null;
  return (a.stockReceptionsGlobales||[]).find(r=>{
    if([r.numeroBon,r.reference,r.codeBarre,r.numeroSerie].map(v=>String(v||"").trim()).includes(s))return true;
    if(stockSerialRefsArray(r.numerosSerie||r.serials||[]).includes(s))return true;
    return (r.details||[]).some(d=>[d.code,d.codeBarre,d.numeroSerie,d.lot,d.reference].map(v=>String(v||"").trim()).includes(s));
  })||null;
}

function dotationNormalizeEtat(value){
  const s=String(value||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  if(s==="usage")return"usagé";
  if(s==="reforme")return"réformé";
  if(s==="renove")return"rénové";
  return value||"neuf";
}

function dotationCodeSerieChanged(el){
  const row=dotationLineFromControl(el);if(!row)return;
  const a=_dotationFindArticle(row.querySelector('[name="articleId"]')?.value||"");
  const rec=dotationReceptionForSerial(a,el?.value||"");
  const stateSel=row.querySelector('[name="etatArticle"]');
  if(stateSel&&rec?.etatArticle)stateSel.value=dotationNormalizeEtat(rec.etatArticle);
  dotationRefreshBarcode(el);
}

function dotationReloadMagasins(){
  const f=document.getElementById("stock-dotation-form");if(!f)return;
  const soc=f.querySelector('[name="societe"]')?.value||"";
  const siteSel=f.querySelector('[name="siteId"]');
  if(siteSel)siteSel.innerHTML=`<option value="">— Choisir site —</option>${dotationSiteOptionsHTML(soc)}`;
  const options=`<option value="">— Choisir magasin —</option>${dotationMagasinsForSoc(soc).map(m=>`<option value="${escapeHTML(m.id)}">${m.icon||""} ${escapeHTML(dotationMagasinLabel(m))}${m.societe?` · ${escapeHTML(m.societe)}`:""}</option>`).join("")}`;
  f.querySelectorAll('[name="magasinId"]').forEach(magSel=>{magSel.innerHTML=options;dotationMagasinChanged(magSel)});
}

function dotationSelectedOptionStock(sel){
  const opt=sel?.selectedOptions?.[0];
  const direct=parseFloat(opt?.dataset?.stock||"");
  if(Number.isFinite(direct))return direct;
  const txt=String(opt?.textContent||"");
  const m=txt.match(/stock\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
  return m?parseFloat(m[1].replace(",",".")):0;
}

function _dotationAllArticlesForSoc(soc){
  return (db.stockArticles||[]).filter(a=>
    !soc||!a.societe||normalizeSocieteName(a.societe)===normalizeSocieteName(soc)
  ).sort((a,b)=>(a.designation||"").localeCompare(b.designation||""));
}

function _dotationArticleOption(a){
  const stock=dotationStockDisponible(a)||0;
  const stockColor=stock>0?"text-emerald-700":"text-red-700";
  const value=String(a.id||a.backendId||a.code||"");
  return `<option value="${escapeHTML(value)}" data-article-id="${escapeHTML(String(a.id||""))}" data-backend-id="${escapeHTML(String(a.backendId||""))}" data-code="${escapeHTML(String(a.code||""))}" data-stock="${escapeHTML(String(stock))}">${escapeHTML(a.designation||"Article")}</option>`;
}

function dotationLineFromControl(el){
  const f=document.getElementById("stock-dotation-form");if(!f)return null;
  return el&&el.closest?el.closest("[data-dotation-line]"):(f.querySelector("[data-dotation-line]")||f);
}

function dotationSizeOptionsHTML(a,selected){
  if(!a)return `<option value="">— Choisir article —</option>`;
  const data=stockMvtArticleVariantAvailability(a);
  const hasRows=data.rows.some(r=>r.available>0);
  if(!dotationArticleNeedsSizing(a)&&!hasRows)return `<option value="">— Sans taille —</option>`;
  return `<option value="">— Choisir ${escapeHTML(data.type.toLowerCase())} —</option>${data.rows.map(r=>{
    const value=String(r.value||"");
    const isSelected=String(selected||"")===value;
    const disabled=r.available<=0;
    return `<option value="${escapeHTML(value)}" data-variant-type="${escapeHTML(data.type)}" data-available="${r.available}" ${isSelected?"selected":""} ${disabled?"disabled style='color:#94a3b8;background:#f1f5f9'":"style='color:#0f172a;font-weight:700'"}>${escapeHTML(value)}${r.available>0?` · disponible: ${qty(r.available)}`:" · non disponible"}</option>`;
  }).join("")}`;
}

function dotationRefreshSizeOptions(row,a,fallbackStock){
  const sel=row?.querySelector?.('[name="tailleSelect"]');
  const label=row?.querySelector?.("[data-dotation-size-label]");
  const info=row?.querySelector?.("[data-dotation-size-info]");
  if(!sel)return;
  const selected=sel.value||"";
  sel.innerHTML=dotationSizeOptionsHTML(a,selected);
  const data=a?stockMvtArticleVariantAvailability(a):{type:"Taille",rows:[]};
  const hasRows=data.rows.some(r=>r.available>0);
  const needs=a&&(dotationArticleNeedsSizing(a)||hasRows);
  if(a&&needs&&!hasRows&&(parseFloat(fallbackStock)||0)>0){
    const type=stockMvtVariantTypeForArticle(a);
    const base=stockMvtVariantBaseValues(type);
    sel.innerHTML=`<option value="">— Choisir ${escapeHTML(type.toLowerCase())} —</option>${base.map(v=>`<option value="${escapeHTML(v)}" data-variant-type="${escapeHTML(type)}" data-available="${parseFloat(fallbackStock)||0}" style="color:#0f172a;font-weight:700">${escapeHTML(v)} · disponible: ${qty(fallbackStock)}</option>`).join("")}`;
  }else if(a&&needs&&!hasRows){
    const type=stockMvtVariantTypeForArticle(a);
    const base=stockMvtVariantBaseValues(type);
    sel.innerHTML=`<option value="">— Choisir ${escapeHTML(type.toLowerCase())} —</option>${base.map(v=>`<option value="${escapeHTML(v)}" data-variant-type="${escapeHTML(type)}" data-available="0" style="color:#0f172a;font-weight:700">${escapeHTML(v)}</option>`).join("")}`;
  }
  const effectiveHasRows=sel.querySelectorAll("option[data-available]").length>0;
  sel.disabled=!a;
  if(label)label.textContent=a&&needs?data.type:"Taille / pointure";
  if(info){
    if(!a)info.textContent="Choisissez un article.";
    else if(!needs)info.textContent="Article sans taille/pointure.";
    else info.textContent=effectiveHasRows?"Les valeurs grisées ne sont pas disponibles en stock.":"Aucune taille/pointure disponible pour cet article.";
  }
}

function dotationLifeMonthOptions(selected){
  const value=parseInt(selected,10)||0;
  return `<option value="">— Choisir durée —</option>${Array.from({length:12},(_,i)=>i+1).map(n=>`<option value="${n}" ${value===n?"selected":""}>${String(n).padStart(2,"0")} mois</option>`).join("")}`;
}

function dotationLineHTML(index,mags){
  return `<div class="dotation-line" data-dotation-line>
    <div class="dotation-row-grid">
      <div class="dotation-cell"><select class="select select-sm" name="magasinId" onchange="dotationMagasinChanged(this)"><option value="">— Magasin —</option>${mags.map(m=>`<option value="${escapeHTML(m.id)}">${m.icon||""} ${escapeHTML(dotationMagasinLabel(m))}${m.societe?` · ${escapeHTML(m.societe)}`:""}</option>`).join("")}</select></div>
      <div class="dotation-cell"><select class="select select-sm" name="articleId" onchange="dotationArticleChanged(this)"><option value="">— Article —</option></select><div data-dotation-article-help class="text-xs text-slate-500 mt-0.5 leading-tight"></div><div data-dotation-stock-info class="text-xs text-emerald-700 mt-0.5 leading-tight"></div></div>
      <div class="dotation-cell"><input class="input select-sm text-center" type="number" min="1" step="1" name="quantite" value="1" placeholder="0"/></div>
      <div class="dotation-cell"><select class="select select-sm" name="tailleSelect"><option value="">— Taille —</option></select><div data-dotation-size-info class="text-xs text-slate-400 mt-0.5 leading-tight"></div></div>
      <div class="dotation-cell"><select class="select select-sm" name="etatArticle"><option value="neuf">Neuf</option><option value="rénové">Rénové</option><option value="usagé">Usagé</option><option value="réformé">Réformé</option><option value="perdu">Perdu</option><option value="remboursé">Remboursé</option></select></div>
      <div class="dotation-cell"><select class="select select-sm" name="codeSerie" onchange="dotationCodeSerieChanged(this)"><option value="">— N° série / Réf —</option></select></div>
      <div class="dotation-cell-action"><button type="button" class="btn btn-ghost text-red-500 px-2 py-1 text-sm" onclick="dotationRemoveLine(this)" title="Supprimer cette ligne">✕</button></div>
    </div>
    <span data-dotation-size-label class="hidden"></span>
    <select class="hidden" name="dureeVieMois">${dotationLifeMonthOptions("")}</select>
    <input class="hidden" name="modele" readonly/>
    <input class="hidden font-mono" name="barcodeValue" readonly/>
    <div class="hidden" data-dotation-life-info></div>
  </div>`;
}

function dotationRefreshLineNumbers(){
  const rows=document.querySelectorAll("#dotation-lines [data-dotation-line]");
  rows.forEach(row=>{
    const remove=row.querySelector("button[onclick^='dotationRemoveLine']");
    if(remove)remove.disabled=rows.length<=1;
  });
}

async function dotationAddLine(){
  const f=document.getElementById("stock-dotation-form");if(!f)return;
  const box=document.getElementById("dotation-lines");if(!box)return;
  const soc=f.querySelector('[name="societe"]')?.value||"";
  const previousRows=[...box.querySelectorAll("[data-dotation-line]")];
  const previousMagSel=previousRows.length?previousRows[previousRows.length-1].querySelector('[name="magasinId"]'):null;
  const previousMagasin=previousMagSel?.value||"";
  box.insertAdjacentHTML("beforeend",dotationLineHTML(box.querySelectorAll("[data-dotation-line]").length+1,dotationMagasinsForSoc(soc)));
  dotationRefreshLineNumbers();
  const row=box.querySelector("[data-dotation-line]:last-child");
  const magSel=row?.querySelector('[name="magasinId"]');
  const artSel=row?.querySelector('[name="articleId"]');
  if(magSel&&previousMagSel){
    magSel.innerHTML=previousMagSel.innerHTML;
  }
  if(magSel&&previousMagasin){
    magSel.value=previousMagasin;
  }
  if(artSel)artSel.disabled=true;
  if(magSel)await dotationMagasinChanged(magSel);
  if(artSel)artSel.disabled=false;
  dotationArticleChanged(row);
  dotationRefreshBarcode(row);
  row?.scrollIntoView?.({behavior:"smooth",block:"center"});
  setTimeout(()=>{(row?.querySelector(previousMagasin?'[name="articleId"]':'[name="magasinId"]'))?.focus?.()},80);
}

function dotationRemoveLine(btn){
  const row=btn?.closest("[data-dotation-line]");
  if(!row)return;
  if(document.querySelectorAll("#dotation-lines [data-dotation-line]").length<=1){toast("Gardez au moins une ligne de dotation","warning");return}
  row.remove();
  dotationRefreshLineNumbers();
}

function dotationSetArticleOptions(row,articles,magasinId){
  const artSel=row?.querySelector?.('[name="articleId"]');
  const help=row?.querySelector?.("[data-dotation-article-help]")||document.getElementById("dotation-article-help");
  if(artSel)artSel.innerHTML=`<option value="">${articles.length?"— Choisir article —":"— Aucun article lié à ce magasin —"}</option>${articles.map(_dotationArticleOption).join("")}`;
  if(help){
    if(!articles.length){
      help.innerHTML=magasinId
        ?`Aucun article lié à ce magasin. Vérifiez le champ <b>Magasin</b> dans le catalogue article.`
        :`Choisissez d'abord un magasin.`;
      help.className="text-xs text-red-700 font-semibold mt-1";
    }else{
      help.textContent=`${articles.length} article(s) lié(s) à ce magasin.`;
      help.className="text-xs text-emerald-700 font-bold mt-1";
    }
  }
}

async function dotationMagasinChanged(el){
  const f=document.getElementById("stock-dotation-form");if(!f)return;
  const row=dotationLineFromControl(el);if(!row)return;
  const soc=f.querySelector('[name="societe"]')?.value||"";
  const magasinId=row.querySelector('[name="magasinId"]')?.value||"";
  let articles=magasinId?dotationArticlesForMagasin(magasinId,soc):[];
  dotationSetArticleOptions(row,articles,magasinId);
  const mag=(db.magasins||[]).find(m=>String(m.id)===String(magasinId)||String(m.backendId||"")===String(magasinId));
  if(!articles.length&&magasinId&&sgdiAuthToken()&&SGDI?.stock?.articles){
    const help=row.querySelector("[data-dotation-article-help]")||document.getElementById("dotation-article-help");
    if(help){help.textContent="Chargement des articles...";help.className="text-xs text-slate-500 mt-1";}
    try{
      // For real stores use store_id filter; for default categories load all articles
      const params=mag?.backendId?{store_id:mag.backendId,society:soc||undefined}:{society:soc||undefined};
      const rows=await SGDI.stock.articles(params);
      mergeDotationArticlesFromApi(rows);
      articles=dotationArticlesForMagasin(magasinId,soc);
      dotationSetArticleOptions(row,articles,magasinId);
    }catch(e){
      if(help){help.textContent="Chargement articles impossible : "+(e.message||e);help.className="text-xs text-red-700 font-semibold mt-1";}
    }
  }
  dotationArticleChanged(row);
}

function dotationArticleChanged(el){
  const f=document.getElementById("stock-dotation-form");if(!f)return;
  const row=dotationLineFromControl(el);if(!row)return;
  const articleSel=row.querySelector('[name="articleId"]');
  const a=dotationFindArticleFromSelect(articleSel);
  const codeSel=row.querySelector('[name="codeSerie"]');
  const model=row.querySelector('[name="modele"]');
  const stockInfo=row.querySelector("[data-dotation-stock-info]")||document.getElementById("dotation-stock-info");
  const lifeInfo=row.querySelector("[data-dotation-life-info]");
  const stateSel=row.querySelector('[name="etatArticle"]');
  row.querySelectorAll("[data-dotation-size-fields]").forEach(box=>{box.style.display=a&&dotationArticleNeedsSizing(a)?"block":"none"});
  if(codeSel)codeSel.innerHTML=`<option value="">— Choisir code / N° série —</option>${dotationCodeSerieOptions(a).map(v=>`<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join("")}`;
  if(model)model.value=a?.modele||a?.marque||"";
  const stock=a?Math.max(dotationStockDisponible(a),dotationSelectedOptionStock(articleSel)):0;
  if(stockInfo)stockInfo.innerHTML=a?`Stock disponible : <b class="${stock>0?"text-emerald-700":"text-red-700"}">${qty(stock)} ${escapeHTML(a.unite||"")}</b> · P.U. ${money(a.prixUnitaire)}`:"Choisissez un article.";
  dotationRefreshSizeOptions(row,a,stock);
  if(stateSel&&a?.etatArticle)stateSel.value=a.etatArticle;
  const dureeInput=row.querySelector('[name="dureeVieMois"]');
  if(dureeInput&&a?.dureeVieMois&&!dureeInput.value)dureeInput.value=a.dureeVieMois;
  if(lifeInfo)lifeInfo.textContent=a?`Article : durée de vie recommandée ${a.dureeVieMois?a.dureeVieMois+" mois":"non renseignée"}`:"Sera pré-remplie depuis l'article sélectionné.";
  dotationRefreshBarcode(row);
}

function dotationRefreshBarcode(){
  const f=document.getElementById("stock-dotation-form");if(!f)return;
  // Update hidden barcodeValue on each line (used when saving)
  const agentId=f.querySelector('[name="agentId"]')?.value||"";
  f.querySelectorAll("[data-dotation-line]").forEach(row=>{
    const value=dotationBarcodeValue(agentId,row.querySelector('[name="articleId"]')?.value||"",row.querySelector('[name="codeSerie"]')?.value||"");
    const input=row.querySelector('[name="barcodeValue"]');
    if(input)input.value=value;
  });
  // Single global QR for the whole fiche
  const cibleType=f.querySelector('[name="cibleType"]')?.value||"employee";
  let benefRef="";
  if(cibleType==="employee"){
    const ag=(db.agents||[]).find(a=>a.id===agentId||String(a.backendId||"")===String(agentId));
    benefRef=ag?.matricule||agentId||"";
  }else if(cibleType==="site"){
    const siteId=f.querySelector('[name="siteId"]')?.value||"";
    const site=(db.sites||[]).find(s=>String(s.id)===siteId||String(s.backendId||"")===siteId);
    benefRef=site?.indicatif||site?.nom||siteId||"SITE";
  }else{
    benefRef=(f.querySelector('[name="structureNom"]')?.value||"STRUCT").toUpperCase().replace(/\s+/g,"-");
  }
  const globalRef=benefRef?["DOT",new Date().getFullYear(),benefRef,today()].join("-"):"";
  const box=document.getElementById("dotation-global-barcode-preview");
  const label=document.getElementById("dotation-global-barcode-label");
  if(box)box.innerHTML=globalRef?sgdiQrHTML(globalRef,100):"";
  if(label)label.textContent=globalRef||"—";
}

function dotationLastAgentId(){
  try{return sessionStorage.getItem("lastDotationAgentId")||""}catch(e){return""}
}

function dotationCurrentAgentId(){
  const f=document.getElementById("stock-dotation-form");
  const selected=f?.querySelector('[name="cibleType"]')?.value==="employee"?(f.querySelector('[name="agentId"]')?.value||""):"";
  return selected||dotationLastAgentId();
}

function dotationUpdateFicheButtons(){
  const f=document.getElementById("stock-dotation-form");if(!f)return;
  const agentId=dotationCurrentAgentId();
  f.querySelectorAll("[data-dotation-agent-action]").forEach(btn=>{btn.disabled=!agentId});
  f.querySelectorAll("[data-dotation-no-equipment-action]").forEach(btn=>{btn.disabled=false});
}

function dotationAgentChanged(){
  dotationRefreshBarcode();
  dotationUpdateFicheButtons();
  const f=document.getElementById("stock-dotation-form");if(!f)return;
  const agentId=f.querySelector('[name="agentId"]')?.value||"";
  const ag=(db.agents||[]).find(a=>a.id===agentId||String(a.backendId||"")===String(agentId));
  const cb=f.querySelector('[name="sansDotation"]');
  if(cb&&ag){
    cb.checked=!!(ag.dotationMaterielSansDotation||ag.sansDotationValidee);
    dotationSansDotationChanged();
  }
}

function dotationSansDotationChanged(){
  const f=document.getElementById("stock-dotation-form");if(!f)return;
  const checked=!!f.querySelector('[name="sansDotation"]')?.checked;
  f.querySelectorAll("#dotation-lines select,#dotation-lines input").forEach(el=>{el.disabled=checked});
  f.querySelectorAll("[data-dotation-add-line]").forEach(btn=>{btn.disabled=checked});
  dotationUpdateFicheButtons();
}

function dotationTargetChanged(){
  const f=document.getElementById("stock-dotation-form");if(!f)return;
  const type=f.querySelector('[name="cibleType"]')?.value||"employee";
  ["employee","site","structure"].forEach(k=>{
    const box=f.querySelector(`[data-dotation-target-${k}]`);
    if(box)box.style.display=type===k?"block":"none";
  });
  dotationRefreshBarcode();
  dotationUpdateFicheButtons();
}

function dotationSiteOptionsHTML(soc){
  return (db.sites||[]).filter(s=>!soc||!s.societe||normalizeSocieteName(s.societe)===normalizeSocieteName(soc)).sort((a,b)=>(a.nom||"").localeCompare(b.nom||"")).map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.nom||"Site")}${s.indicatif?` · ${escapeHTML(s.indicatif)}`:""}</option>`).join("");
}

async function lancerDotationInitiale(){
  toast("Chargement du catalogue…","info");
  let articles=[];
  try{
    const r=await fetch("/api/materiel/admin/bulk-dotation-articles",{headers:{Authorization:"Bearer "+sgdiAuthToken()}});
    articles=await r.json();
    if(!r.ok)throw new Error(articles.detail||"Erreur");
  }catch(e){toast("Impossible de charger les articles : "+(e.message||e),"error");return;}
  const opts=articles.map(a=>`<option value="${a.id}">${escapeHTML(a.designation)}${a.category?" · "+escapeHTML(a.category):""} (stock: ${a.quantity??0})</option>`).join("");
  const kitDef=[{label:"Tenue bleu chemise",qty:2},{label:"Tenue bleu pantalon",qty:2},{label:"Rangers",qty:1},{label:"Parkas",qty:1},{label:"Ceinture",qty:1},{label:"Casquette",qty:1}];
  const rows=kitDef.map((k,i)=>`<tr><td class="py-2 pr-4 text-sm font-semibold whitespace-nowrap">${escapeHTML(k.label)}</td><td class="py-2 pr-3"><select id="di-art-${i}" class="select text-sm"><option value="">— Choisir —</option>${opts}</select></td><td class="py-2"><input type="number" id="di-qty-${i}" class="input text-sm" style="width:65px" value="${k.qty}" min="1"/></td></tr>`).join("");
  openModal(`<div style="min-width:540px"><h3 class="font-black text-lg mb-1">⚡ Dotation initiale</h3><p class="text-sm text-slate-500 mb-4">Associez chaque poste du kit à un article de votre catalogue, puis confirmez.</p><table class="w-full mb-4"><thead><tr class="text-xs text-slate-400 uppercase border-b"><th class="pb-2 text-left pr-4">Poste</th><th class="pb-2 text-left pr-3">Article catalogue</th><th class="pb-2 text-left">Qté</th></tr></thead><tbody>${rows}</tbody></table><div class="flex justify-end gap-2"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary font-black" onclick="confirmerDotationInitiale(${kitDef.length})">Effacer et doter tous les employés</button></div></div>`);
}

async function confirmerDotationInitiale(kitSize){
  const kit=[];
  for(let i=0;i<kitSize;i++){
    const artId=parseInt(document.getElementById(`di-art-${i}`)?.value||"0");
    const qty=parseFloat(document.getElementById(`di-qty-${i}`)?.value)||0;
    if(!artId){toast(`Sélectionnez l'article pour la ligne ${i+1}`,"error");return;}
    kit.push({article_id:artId,quantity:qty});
  }
  if(!confirm("⚠️ Toutes les dotations existantes seront EFFACÉES et remplacées.\n\nConfirmer ?"))return;
  closeModal();
  toast("Dotation en cours…","info");
  try{
    const r=await fetch("/api/materiel/admin/bulk-dotation-initiale",{method:"POST",headers:{Authorization:"Bearer "+sgdiAuthToken(),"Content-Type":"application/json"},body:JSON.stringify({kit})});
    const data=await r.json();
    if(!r.ok)throw new Error(data.detail||"Erreur serveur");
    toast(`✓ ${data.dotations_creees} dotations créées pour ${data.employees} employés.`,"success");
    renderView();
  }catch(e){toast("Erreur : "+(e.message||e),"error");}
}

function openBulkDotationModal(nonDotesOnly){
  const soc=matSimpleSocFilter();
  const allAgents=nonDotesOnly?agentsEnInstanceDotationForSoc(soc):matDotationScopedActiveAgents(soc);
  const articles=matSimpleBySoc(db.stockArticles||[]).filter(a=>a.actif!==false&&a.actif!==0);
  window._bulkDotationWizard={
    nonDotesOnly:!!nonDotesOnly,soc,agents:allAgents,articles,
    selected:new Set(),variants:{},date:today(),motif:"Dotation initiale",
    kit:[
      {label:"Tenue bleu chemise",articleId:"",qty:2,variantType:"taille"},
      {label:"Tenue bleu pantalon",articleId:"",qty:2,variantType:"taille"},
      {label:"Rangers",articleId:"",qty:1,variantType:"pointure"},
      {label:"Parkas",articleId:"",qty:1,variantType:"taille"},
      {label:"Ceinture",articleId:"",qty:1,variantType:"aucune"}
    ]
  };
  bulkDotationWizardOpen(1);
}

function bulkDotationWizardState(){return window._bulkDotationWizard||null}

function bulkDotationWizardSteps(step){
  return `<div class="bulk-dot-steps">${[[1,"Employés"],[2,"Composition du kit"],[3,"Vérification"]].map(([n,l])=>`<div class="${step===n?"active":step>n?"done":""}"><span>${step>n?"✓":n}</span>${escapeHTML(l)}</div>`).join("")}</div>`;
}

function bulkDotationWizardOpen(step){
  const s=bulkDotationWizardState();if(!s)return;
  const title=s.nonDotesOnly?"Doter les employés non dotés":"Dotation en masse";
  const body=step===1?bulkDotationEmployeesStepHTML(s):step===2?bulkDotationKitStepHTML(s):bulkDotationReviewStepHTML(s);
  openModal(`<div class="bulk-dot-wizard"><div class="bulk-dot-head"><div><div class="text-xs font-black uppercase tracking-widest text-slate-400">Assistant sécurisé</div><h3>${escapeHTML(title)}</h3></div><button type="button" class="bulk-dot-close" onclick="closeModal()" aria-label="Fermer">×</button></div>${bulkDotationWizardSteps(step)}${body}</div>`);
}

function bulkDotationEmployeesStepHTML(s){
  const availableOptions=s.agents.filter(a=>!s.selected.has(String(a.id))).map(a=>`<option value="${escapeHTML(String(a.id))}">${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim()||"Employé")} · ${escapeHTML(a.matricule||"—")}${a.societe?` · ${escapeHTML(a.societe)}`:""}</option>`).join("");
  const rows=s.agents.map(a=>{const id=String(a.id),v=s.variants[id]||{},checked=s.selected.has(id);const aff=agentLiveAffectation(a)||{};return `<tr data-bulk-agent-row data-q="${escapeHTML(((a.nom||"")+" "+(a.prenom||"")+" "+(a.matricule||"")+" "+(a.societe||"")).toLowerCase())}"><td><input type="checkbox" ${checked?"checked":""} onchange="bulkDotationToggleAgent('${jsString(id)}',this.checked)"/></td><td><b>${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim())}</b><small>${escapeHTML(a.matricule||"—")}</small></td><td>${escapeHTML(a.societe||"—")}</td><td>${escapeHTML(aff.poste||a.fonction||"—")}</td><td><input class="input" value="${escapeHTML(v.taille||"")}" placeholder="M, L…" oninput="bulkDotationSetVariant('${jsString(id)}','taille',this.value)"/></td><td><input class="input" value="${escapeHTML(v.pointure||"")}" placeholder="40, 41…" oninput="bulkDotationSetVariant('${jsString(id)}','pointure',this.value)"/></td></tr>`}).join("");
  return `<div class="bulk-dot-employee-picker"><label>Ajouter un employé non doté</label><select class="select" onchange="bulkDotationAddAgent(this.value)"><option value="">${s.agents.length?"— Choisir un employé —":"— Aucun employé non doté —"}</option>${availableOptions}</select></div><div class="bulk-dot-toolbar"><div><strong id="bulk-selected-count">${s.selected.size}</strong> employé(s) sélectionné(s)</div><input class="input" placeholder="Rechercher un employé…" oninput="bulkDotationFilterEmployees(this.value)"/><button class="btn btn-secondary" onclick="bulkDotationToggleAll(true)">Tout sélectionner</button><button class="btn btn-ghost" onclick="bulkDotationToggleAll(false)">Tout désélectionner</button></div><div class="bulk-dot-table"><table><thead><tr><th></th><th>Employé</th><th>Société</th><th>Poste</th><th>Taille</th><th>Pointure</th></tr></thead><tbody>${rows||`<tr><td colspan="6" class="text-center p-8 text-slate-500">Aucun employé concerné.</td></tr>`}</tbody></table></div><div class="bulk-dot-actions"><button class="btn btn-secondary" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="bulkDotationGoKit()" ${s.selected.size?"":"disabled"}>Continuer vers le kit →</button></div>`;
}

function bulkDotationAddAgent(id){const s=bulkDotationWizardState();if(!s||!id)return;s.selected.add(String(id));bulkDotationWizardOpen(1)}

function bulkDotationToggleAgent(id,checked){const s=bulkDotationWizardState();if(!s)return;if(checked)s.selected.add(String(id));else s.selected.delete(String(id));const el=document.getElementById("bulk-selected-count");if(el)el.textContent=s.selected.size}

function bulkDotationSetVariant(id,key,value){const s=bulkDotationWizardState();if(!s)return;s.variants[id]=s.variants[id]||{};s.variants[id][key]=String(value||"").trim()}

function bulkDotationFilterEmployees(value){const q=String(value||"").trim().toLowerCase();document.querySelectorAll("[data-bulk-agent-row]").forEach(row=>row.style.display=!q||String(row.dataset.q||"").includes(q)?"":"none")}

function bulkDotationToggleAll(checked){const s=bulkDotationWizardState();if(!s)return;s.selected=checked?new Set(s.agents.map(a=>String(a.id))):new Set();bulkDotationWizardOpen(1)}

function bulkDotationGoKit(){const s=bulkDotationWizardState();if(!s||!s.selected.size){toast("Sélectionnez au moins un employé","error");return}bulkDotationWizardOpen(2)}

function bulkDotationAvailableStock(article){return Math.max(0,Number(typeof dotationStockDisponible==="function"?dotationStockDisponible(article):stockGetActuel(article.id))||0)}

function bulkDotationKitStepHTML(s){
  const opts=s.articles.map(a=>`<option value="${escapeHTML(String(a.id))}">${escapeHTML(a.designation||a.code||"Article")} · stock ${qty(bulkDotationAvailableStock(a))}</option>`).join("");
  const rows=s.kit.map((item,i)=>`<tr><td><b>${escapeHTML(item.label)}</b></td><td><select id="bulk-wiz-art-${i}" class="select" onchange="bulkDotationArticleChanged(${i},this.value)"><option value="">— Choisir dans le catalogue —</option>${opts}</select></td><td><input id="bulk-wiz-qty-${i}" class="input" type="number" min="1" step="1" value="${item.qty}" onchange="bulkDotationKitValue(${i},'qty',this.value)"/></td><td><select class="select" onchange="bulkDotationKitValue(${i},'variantType',this.value)"><option value="aucune" ${item.variantType==="aucune"?"selected":""}>Aucune</option><option value="taille" ${item.variantType==="taille"?"selected":""}>Taille employé</option><option value="pointure" ${item.variantType==="pointure"?"selected":""}>Pointure employé</option></select></td><td id="bulk-wiz-stock-${i}" class="text-xs text-slate-500">—</td></tr>`).join("");
  setTimeout(()=>s.kit.forEach((item,i)=>{const el=document.getElementById(`bulk-wiz-art-${i}`);if(el){el.value=item.articleId||"";bulkDotationArticleChanged(i,el.value)}}),0);
  return `<div class="bulk-dot-notice"><b>${s.selected.size} employé(s)</b> recevront chaque article du kit. Les quantités totales seront contrôlées avant validation.</div><div class="bulk-dot-table"><table><thead><tr><th>Élément du kit</th><th>Article catalogue</th><th>Qté / employé</th><th>Donnée individuelle</th><th>Stock</th></tr></thead><tbody>${rows}</tbody></table></div><div class="bulk-dot-form"><div><label>Date de dotation</label><input id="bulk-wiz-date" class="input" type="date" value="${escapeHTML(s.date)}"/></div><div><label>Motif</label><input id="bulk-wiz-motif" class="input" value="${escapeHTML(s.motif)}"/></div></div><div class="bulk-dot-actions"><button class="btn btn-secondary" onclick="bulkDotationWizardOpen(1)">← Employés</button><button class="btn btn-primary" onclick="bulkDotationGoReview()">Vérifier la dotation →</button></div>`;
}

function bulkDotationKitValue(i,key,value){const s=bulkDotationWizardState();if(!s||!s.kit[i])return;s.kit[i][key]=key==="qty"?(parseFloat(value)||0):value}

function bulkDotationArticleChanged(i,value){const s=bulkDotationWizardState();if(!s||!s.kit[i])return;s.kit[i].articleId=value;const a=s.articles.find(x=>String(x.id)===String(value));const el=document.getElementById(`bulk-wiz-stock-${i}`);if(el)el.innerHTML=a?`Disponible : <b>${qty(bulkDotationAvailableStock(a))}</b>`:"—"}

function bulkDotationGoReview(){
  const s=bulkDotationWizardState();if(!s)return;
  s.date=document.getElementById("bulk-wiz-date")?.value||today();s.motif=(document.getElementById("bulk-wiz-motif")?.value||"").trim();
  const missing=s.kit.findIndex(x=>!x.articleId||!(Number(x.qty)>0));
  if(missing>=0){toast(`Complétez l'article et la quantité de la ligne ${missing+1}`,"error");return}
  bulkDotationWizardOpen(3);
}

function bulkDotationReviewData(s){
  const totals=new Map();
  s.kit.forEach(item=>{const current=totals.get(String(item.articleId))||0;totals.set(String(item.articleId),current+s.selected.size*Number(item.qty||0))});
  const missingVariants=[];
  s.selected.forEach(id=>s.kit.forEach(item=>{if(item.variantType!=="aucune"&&!String(s.variants[id]?.[item.variantType]||"").trim())missingVariants.push({id,type:item.variantType})}));
  const shortages=[];
  totals.forEach((required,id)=>{const a=s.articles.find(x=>String(x.id)===id);const available=a?bulkDotationAvailableStock(a):0;if(required>available)shortages.push({id,required,available,article:a})});
  return{totals,missingVariants,shortages,lines:s.selected.size*s.kit.length};
}

function bulkDotationReviewStepHTML(s){
  const review=bulkDotationReviewData(s);
  const rows=s.kit.map(item=>{const a=s.articles.find(x=>String(x.id)===String(item.articleId));const required=s.selected.size*Number(item.qty||0);const available=a?bulkDotationAvailableStock(a):0;const ok=(review.totals.get(String(item.articleId))||0)<=available;return `<tr><td><b>${escapeHTML(item.label)}</b></td><td>${escapeHTML(a?.designation||a?.code||"Article")}</td><td>${qty(item.qty)}</td><td><b>${qty(required)}</b></td><td>${qty(available)}</td><td><span class="pill ${ok?"pill-green":"pill-red"}">${ok?"Disponible":"Insuffisant"}</span></td></tr>`}).join("");
  const blocked=review.shortages.length||review.missingVariants.length;
  return `<div class="bulk-dot-summary"><div><span>Employés</span><strong>${s.selected.size}</strong></div><div><span>Articles du kit</span><strong>${s.kit.length}</strong></div><div><span>Lignes créées</span><strong>${review.lines}</strong></div><div><span>Date</span><strong>${formatDate(s.date)}</strong></div></div><div class="bulk-dot-table"><table><thead><tr><th>Élément</th><th>Article</th><th>Qté / employé</th><th>Total requis</th><th>Stock disponible</th><th>Contrôle</th></tr></thead><tbody>${rows}</tbody></table></div>${review.shortages.length?`<div class="bulk-dot-alert danger"><b>Stock insuffisant.</b> Corrigez le kit ou réapprovisionnez le stock avant de continuer.</div>`:""}${review.missingVariants.length?`<div class="bulk-dot-alert warning"><b>${review.missingVariants.length} taille(s) ou pointure(s) manquante(s).</b> Revenez à l’étape Employés pour compléter les informations.</div>`:""}<div class="bulk-dot-confirm"><b>Motif :</b> ${escapeHTML(s.motif||"Dotation initiale")}<br/>Cette opération créera <b>${review.lines} lignes de dotation</b> pour <b>${s.selected.size} employés</b>.</div><div id="bulk-progress" style="display:none" class="bulk-dot-progress"><div id="bulk-progress-label">Préparation…</div><div><span id="bulk-progress-bar"></span></div></div><div class="bulk-dot-actions"><button class="btn btn-secondary" onclick="bulkDotationWizardOpen(2)">← Modifier le kit</button><button class="btn btn-primary" id="bulk-run-btn" onclick="executeBulkDotationWizard()" ${blocked?"disabled":""}>Confirmer ${review.lines} lignes de dotation</button></div>`;
}

async function executeBulkDotationWizard(){
  const s=bulkDotationWizardState();if(!s)return;const review=bulkDotationReviewData(s);
  if(review.shortages.length||review.missingVariants.length){toast("Corrigez les alertes avant de confirmer","error");return}
  if(!confirm(`Confirmer ${review.lines} lignes de dotation pour ${s.selected.size} employés ?`))return;
  const agents=s.agents.filter(a=>s.selected.has(String(a.id)));const btn=document.getElementById("bulk-run-btn");if(btn)btn.disabled=true;
  const progress=document.getElementById("bulk-progress");if(progress)progress.style.display="block";
  let done=0,errors=0;
  for(const agent of agents){for(const item of s.kit){try{const variant=s.variants[String(agent.id)]||{};await persistDotationToPostgres({agentId:agent.id,employeeBackendId:agent.backendId||null,articleId:item.articleId,quantite:item.qty,cibleType:"employee",date:s.date,motif:s.motif||"Dotation initiale",taille:item.variantType==="taille"?(variant.taille||""):"",pointure:item.variantType==="pointure"?(variant.pointure||""):""})}catch(e){errors++;console.warn("Dotation groupée",agent.id,item.articleId,e)}done++;const pct=Math.round(done/review.lines*100);const bar=document.getElementById("bulk-progress-bar"),label=document.getElementById("bulk-progress-label");if(bar)bar.style.width=pct+"%";if(label)label.textContent=`${done}/${review.lines} lignes traitées`}}
  closeModal();window._bulkDotationWizard=null;
  if(errors)toast(`Dotation terminée avec ${errors} erreur(s).`,"warning");else toast(`Dotation réussie : ${review.lines} lignes pour ${agents.length} employés.`,"success");
  try{await syncMaterielFromPostgres()}catch(e){}renderSidebar();renderView();
}

async function executeBulkDotation(kitSize,nonDotesOnly){
  const soc=matSimpleSocFilter();
  const allAgents=nonDotesOnly?agentsEnInstanceDotationForSoc(soc):matDotationScopedActiveAgents(soc);
  const dateVal=document.getElementById("bulk-date")?.value||today();
  const motifVal=document.getElementById("bulk-motif")?.value||"Dotation initiale";
  const kit=[];
  for(let i=0;i<kitSize;i++){
    const artId=document.getElementById(`bulk-art-${i}`)?.value;
    const qty=parseFloat(document.getElementById(`bulk-qty-${i}`)?.value)||0;
    if(!artId){toast(`Veuillez sélectionner l'article pour la ligne ${i+1}`,"error");return;}
    if(!qty){toast(`Quantité invalide pour la ligne ${i+1}`,"error");return;}
    kit.push({articleId:artId,quantite:qty});
  }
  if(!allAgents.length){toast("Aucun employé actif trouvé","error");return;}
  const runBtn=document.getElementById("bulk-run-btn");
  if(runBtn)runBtn.disabled=true;
  const progressDiv=document.getElementById("bulk-progress");
  if(progressDiv)progressDiv.style.display="block";
  let done=0,errors=0;
  const total=allAgents.length*kit.length;
  for(const agent of allAgents){
    for(const item of kit){
      try{
        const m={agentId:agent.id,employeeBackendId:agent.backendId||null,articleId:item.articleId,quantite:item.quantite,cibleType:"employee",date:dateVal,motif:motifVal};
        await persistDotationToPostgres(m);
      }catch(e){errors++;console.warn("Bulk dotation:",agent.id,item.articleId,e?.message||e);}
      done++;
      const pct=Math.round(done/total*100);
      const bar=document.getElementById("bulk-progress-bar");
      const lbl=document.getElementById("bulk-progress-label");
      if(bar)bar.style.width=pct+"%";
      if(lbl)lbl.textContent=`${done}/${total} dotations traitées…`;
    }
  }
  closeModal();
  if(errors)toast(`Dotation terminée : ${total-errors}/${total} réussies (${errors} erreur(s)).`,"warning");
  else toast(`Dotation en masse réussie : ${total} dotations pour ${allAgents.length} agents.`,"success");
  renderView();
}

function dotationPendingEmployeeListHTML(agents){
  return `<div id="dotation-pending-list" class="card overflow-hidden mb-4" style="display:none">
    <div class="p-4 flex items-center justify-between gap-3 flex-wrap border-b border-slate-200">
      <div><div class="font-black text-sm uppercase">Employés en attente de dotation</div><div class="text-xs text-slate-500">${agents.length} employé(s) sans dotation matérielle.</div></div>
      <button type="button" class="btn btn-ghost text-xs" onclick="document.getElementById('dotation-pending-list').style.display='none'">Masquer</button>
    </div>
    <div class="overflow-x-auto">
      <table>
        <thead><tr><th>Employé</th><th>Code</th><th>Société</th><th>Poste</th><th>Site</th><th></th></tr></thead>
        <tbody>${agents.length?agents.map(a=>{const aff=agentLiveAffectation(a)||{};return`<tr data-searchable>
          <td><div class="font-semibold">${escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim()||"—")}</div><div class="text-xs text-slate-500">${escapeHTML(a.telephone||"")}</div></td>
          <td class="font-mono font-bold">${escapeHTML(a.matricule||"—")}</td>
          <td class="text-xs">${escapeHTML(a.societe||"—")}</td>
          <td class="text-xs">${escapeHTML(aff.poste||a.affectationCourante?.poste||a.fonction||"—")}</td>
          <td class="text-xs">${escapeHTML(aff.siteName||a.affectationCourante?.siteName||"Sans affectation")}</td>
          <td class="text-right"><button type="button" class="btn btn-secondary text-xs" onclick="dotationSelectPendingEmployee(${JSON.stringify(String(a.id))})">Sélectionner</button></td>
        </tr>`}).join(""):`<tr><td colspan="6" class="text-center text-slate-500 p-6">Aucun employé en attente de dotation.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

function showDotationPendingEmployees(){
  const panel=document.getElementById("dotation-pending-list");
  if(!panel)return;
  panel.style.display="block";
  panel.scrollIntoView({behavior:"smooth",block:"start"});
}

function dotationSelectPendingEmployee(id){
  const sel=document.querySelector("#stock-dotation-form [name=agentId]");
  if(!sel)return;
  sel.value=id;
  try{sessionStorage.setItem("materielDotationAgentId",id)}catch(e){}
  dotationAgentChanged();
  document.getElementById("stock-dotation-form")?.scrollIntoView({behavior:"smooth",block:"start"});
  toast("Employé sélectionné pour la dotation","success");
}

function renderMatSimpleDotation(view){
  const header=matSimpleHeader("dotation");
  const soc=matSimpleSocFilter();
  const agentsPending=agentsEnInstanceDotationForSoc(soc);
  const agentOptions=agentsPending.slice().sort((a,b)=>`${a.nom||""} ${a.prenom||""}`.localeCompare(`${b.nom||""} ${b.prenom||""}`));
  const selectedAgent=dotationLastAgentId();
  const societies=soc?[soc]:SOCIETES;
  const firstSoc=soc||societies[0]||"";
  const mags=dotationMagasinsForSoc(firstSoc);
  const realMagasins=matSimpleBySoc(db.magasins||[]);
  const lastAgent=selectedAgent?(db.agents||[]).find(a=>a.id===selectedAgent):null;
  view.innerHTML=`${header}<div class="flex justify-between items-center mb-3 flex-wrap gap-2">
    <div><h1 class="text-2xl font-black uppercase">NOUVELLE DOTATION</h1><p class="text-slate-500 text-sm">${soc?escapeHTML(soc):"Toutes les sociétés"} · Dotation vers employé, site ou structure avec déduction automatique du magasin.</p></div>
    <div class="flex gap-2"><button class="btn btn-secondary text-sm" onclick="navigate('materiel/articles')">Articles</button><button class="btn btn-secondary text-sm" onclick="navigate('materiel/dashboard')">Tableau de bord</button><button class="btn btn-secondary text-sm" onclick="openBulkDotationModal(true)">Doter les non dotés</button><button class="btn btn-primary text-sm" onclick="openBulkDotationModal()">⚡ Doter en masse</button></div>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
    <button type="button" class="card p-4 text-left kpi-clickable" onclick="showDotationPendingEmployees()"><div class="text-xs text-slate-500 uppercase">Employés en attente</div><div class="text-3xl font-black mt-1">${agentsPending.length}</div></button>
    <button type="button" class="card p-4 text-left kpi-clickable" onclick="navigate('materiel/articles')"><div class="text-xs text-slate-500 uppercase">Articles catalogue</div><div class="text-3xl font-black mt-1">${matSimpleBySoc(db.stockArticles||[]).length}</div></button>
    <button type="button" class="card p-4 text-left kpi-clickable" onclick="navigate('materiel/magasins')"><div class="text-xs text-slate-500 uppercase">Magasins</div><div class="text-3xl font-black mt-1">${realMagasins.length}</div></button>
  </div>
  ${dotationPendingEmployeeListHTML(agentOptions)}
  <form id="stock-dotation-form" class="card p-5" onsubmit="event.preventDefault();dotationSaveAndOpenFiche()">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      ${mySoc()?`<input type="hidden" name="societe" value="${escapeHTML(firstSoc)}"/>`:`<div><label class="label">Société propriétaire</label><select class="select" name="societe" onchange="dotationReloadMagasins()">${societies.map(s=>`<option value="${escapeHTML(s)}" ${s===firstSoc?"selected":""}>${escapeHTML(s)}</option>`).join("")}</select></div>`}
      <div><label class="label">Destination</label><select class="select" name="cibleType" onchange="dotationTargetChanged()"><option value="employee">Employé</option><option value="site">Site</option><option value="structure">Structure</option></select></div>
      <div data-dotation-target-employee><label class="label">Employé bénéficiaire</label><div class="flex items-center gap-5 mb-2 text-sm"><label class="flex items-center gap-1.5 cursor-pointer select-none"><input type="checkbox" id="dotf-nondotes" checked onchange="dotationFilterAgentSelect('nondotes')"/> Employés non dotés</label><label class="flex items-center gap-1.5 cursor-pointer select-none"><input type="checkbox" id="dotf-dotes" onchange="dotationFilterAgentSelect('dotes')"/> Employés dotés</label><label class="flex items-center gap-1.5 cursor-pointer select-none"><input type="checkbox" id="dotf-tout" onchange="dotationFilterAgentSelect('tout')"/> Tout</label></div><input type="text" id="dotf-search" class="input mb-2" placeholder="🔍 Rechercher par nom, matricule, site, structure, poste, société..." oninput="dotationSearchAgent(this.value)" autocomplete="off"/><select class="select" name="agentId" onchange="dotationAgentChanged()"><option value="">${agentOptions.length?"— Choisir employé non doté —":"— Aucun employé non doté —"}</option>${agentOptions.map(a=>`<option value="${a.id}" ${selectedAgent===a.id?"selected":""}>${escapeHTML((a.nom||"")+" "+(a.prenom||""))} · ${escapeHTML(a.matricule||"—")} · ${escapeHTML(a.affectationCourante?.poste||a.fonction||"")}</option>`).join("")}</select><div id="dotation-benef-count" class="text-xs ${agentOptions.length?"text-emerald-700":"text-red-700"} mt-1">${agentOptions.length?`${agentOptions.length} employé(s) actif(s) sans dotation matérielle.`:"Aucun employé actif sans dotation pour cette société."}</div></div>
      <div data-dotation-target-site style="display:none"><label class="label">Site bénéficiaire</label><select class="select" name="siteId" onchange="dotationRefreshBarcode()"><option value="">— Choisir site —</option>${dotationSiteOptionsHTML(firstSoc)}</select></div>
      <div data-dotation-target-structure style="display:none"><label class="label">Structure bénéficiaire</label><input class="input" name="structureNom" placeholder="ex: DIRECTION RH, OPS, Comptabilité" oninput="dotationRefreshBarcode()"/></div>
      <div class="md:col-span-2">
        <div class="flex items-center justify-between gap-3 mb-3">
          <div><div class="font-black text-sm">Articles à doter</div><div class="text-xs text-slate-500">Chaque ligne correspond à un article. Ajoutez autant de lignes que nécessaire.</div></div>
          <label class="inline-flex items-center gap-2 text-xs font-black text-slate-700"><input type="checkbox" name="sansDotation" onchange="dotationSansDotationChanged()"/> Sans dotation</label>
        </div>
        <div class="overflow-x-auto">
          <div class="dotation-row-grid dotation-row-header">
            <div>Magasin</div><div>Article</div><div>Qté</div><div>Taille / pointure</div><div>État remis</div><div>N° Série / Réf</div><div></div>
          </div>
          <div id="dotation-lines">
            ${dotationLineHTML(1,mags)}
          </div>
        </div>
        <button type="button" class="btn btn-secondary text-xs mt-3 w-full" data-dotation-add-line onclick="dotationAddLine()">+ Ajouter article</button>
      </div>
      <div class="md:col-span-2 flex gap-4 items-start">
        <div class="flex-1"><label class="label">Observations</label><textarea class="input" name="notes" rows="2" placeholder="État, accessoires, conditions de remise..."></textarea></div>
        <div class="flex flex-col items-center gap-1 pt-5">
          <div id="dotation-global-barcode-preview" class="border border-slate-200 rounded-lg p-2 bg-slate-50"></div>
          <div class="text-xs text-slate-400 font-mono text-center" id="dotation-global-barcode-label">—</div>
        </div>
      </div>
    </div>
    <div class="flex justify-end gap-2 mt-5 flex-wrap">
      <button type="button" class="btn btn-primary" data-dotation-agent-action ${lastAgent?"":"disabled"} onclick="dotationSaveAndOpenFiche()">Voir fiche de dotation</button>
      <button type="button" class="btn btn-secondary" onclick="saveNouvelleDotation()">Enregistrer</button>
    </div>
  </form>`;
  setTimeout(()=>{dotationReloadMagasins();dotationRefreshLineNumbers();dotationRefreshBarcode();dotationSansDotationChanged();dotationUpdateFicheButtons()},0);
}

function dotationFormHasPendingLines(){
  const f=document.getElementById("stock-dotation-form");if(!f)return false;
  return [...f.querySelectorAll("[data-dotation-line]")].some(row=>
    row.querySelector('[name="articleId"]')?.value||
    row.querySelector('[name="magasinId"]')?.value||
    parseFloat(row.querySelector('[name="quantite"]')?.value||"0")>0
  );
}

function dotationPreviewRowsFromForm(){
  const f=document.getElementById("stock-dotation-form");if(!f)return null;
  const fd=new FormData(f);
  const cibleType=fd.get("cibleType")||"employee";
  const agentId=fd.get("agentId")||"";
  const ag=(db.agents||[]).find(a=>a.id===agentId||String(a.backendId||"")===agentId);
  if(cibleType!=="employee"){toast("La fiche de dotation personnel concerne uniquement un employé","error");return null}
  if(!ag){toast("Choisissez l'employé bénéficiaire","error");return null}
  const rows=[...f.querySelectorAll("[data-dotation-line]")].map((row,idx)=>{
    const articleSel=row.querySelector('[name="articleId"]');
    const art=dotationFindArticleFromSelect(articleSel);
    const qte=parseFloat(row.querySelector('[name="quantite"]')?.value)||0;
    const size=dotationSelectedSize(row);
    const taille=size.type==="Taille"?size.value:"";
    const pointure=size.type==="Pointure"?size.value:(row.querySelector('[name="pointure"]')?.value||"").trim();
    const detail=size.key?`${size.key}: ${qty(qte)}`:dotationSizeSummary(taille,pointure);
    return {
      idx,art,qte,
      date:today(),
      code:art?.code||"—",
      article:art?.designation||"Article",
      categorie:art?.categorie||"Stock",
      detail,
      unite:art?.unite||"",
      pu:parseFloat(art?.prixUnitaire)||0,
      valeur:qte*(parseFloat(art?.prixUnitaire)||0),
      bon:nextStockBonNum("sortie"),
      codeSerie:(row.querySelector('[name="codeSerie"]')?.value||"").trim(),
      modele:row.querySelector('[name="modele"]')?.value||art?.modele||""
    };
  }).filter(item=>item.art||item.qte);
  if(!rows.length){toast("Ajoutez au moins un article à doter","error");return null}
  for(const item of rows){
    if(!item.art){toast(`Ligne ${item.idx+1} : choisissez un article`,"error");return null}
    if(item.qte<=0){toast(`Ligne ${item.idx+1} : quantité invalide`,"error");return null}
  }
  return {agentId,rows};
}

async function dotationSaveAndOpenFiche(){
  const agentId=dotationCurrentAgentId();
  if(!agentId){toast("Choisissez l'employé bénéficiaire","error");return}
  if(dotationFormHasPendingLines()){
    const draft=dotationPreviewRowsFromForm();
    if(!draft)return;
    window._pendingDotationDraftByAgent=window._pendingDotationDraftByAgent||{};
    window._pendingDotationDraftByAgent[String(agentId)]={rows:draft.rows,createdAt:new Date().toISOString()};
    voirFicheDotation(agentId,{pending:true});
    return;
  }
  voirFicheDotation(agentId);
}

async function dotationValidateSansDotation(){
  const f=document.getElementById("stock-dotation-form");if(!f)return;
  const fd=new FormData(f);
  const cibleType=fd.get("cibleType")||"employee";
  const agentId=fd.get("agentId")||dotationCurrentAgentId()||"";
  const ag=(db.agents||[]).find(a=>a.id===agentId||String(a.backendId||"")===String(agentId));
  if(cibleType!=="employee"){toast("La validation sans dotation concerne uniquement un employé","error");return}
  if(!ag){toast("Choisissez l'employé bénéficiaire","error");return}
  const sansDotationCb=f.querySelector('[name="sansDotation"]');
  if(sansDotationCb)sansDotationCb.checked=true;
  if(dotationFormHasPendingLines()&&!confirm("Des articles sont saisis. Valider quand même sans dotation et ignorer ces lignes ?"))return;
  ag.dotationMaterielSansDotation=true;
  ag.sansDotationValidee=true;
  ag.dotationMaterielValidee=true;
  ag.dotationMaterielAt=today();
  ag.dotationMaterielCount=0;
  ag.dotationMaterielObservation=(fd.get("notes")||"").trim();
  addEmployeeCareerEvent(ag,"Dotation",{
    date:today(),
    motif:`Validation sans dotation matériel${ag.dotationMaterielObservation?` : ${ag.dotationMaterielObservation}`:""}`,
    source:"materiel-sans-dotation",
    sourceId:`sans_dotation_${ag.id}_${today()}`,
    details:{sansDotation:true,observation:ag.dotationMaterielObservation}
  });
  closeDotationWorkflowTasksForAgent(ag);
  try{
    if(ag.backendId)Object.assign(ag,employeeFromApi(await SGDI.employees.update(ag.backendId,employeeApiPayload(ag))),ag,{backendId:ag.backendId});
  }catch(e){
    toast("Validation sans dotation non enregistrée : "+(e.message||e),"error");
    return;
  }
  if(window._pendingDotationDraftByAgent)delete window._pendingDotationDraftByAgent[String(agentId)];
  try{sessionStorage.setItem("lastDotationAgentId",agentId)}catch(e){}
  if(typeof logActivity==="function")logActivity("Validation sans dotation",`${ag.nom||""} ${ag.prenom||""}`.trim());
  if(!(await saveDBAndWaitToast("Validation sans dotation non confirmée")))return;
  toast("Employé validé sans dotation","success");
  renderView();
}

function renderMatSimpleReversement(view){
  const header=matSimpleHeader("reversement");
  const agents=agentsEnInstanceReversement();
  const soc=matSimpleSocFilter();
  const sortants=(db.agents||[]).filter(a=>isAgentSortant(a)&&(!soc||a.societe===soc));
  const totalValue=agents.reduce((s,a)=>s+agentReversementSituation(a.id).value,0);
  view.innerHTML=`${header}<div class="flex justify-between items-center mb-3 flex-wrap gap-2">
    <div><h1 class="text-2xl font-bold" style="text-transform:uppercase">ÉQUIPEMENT / MATÉRIEL EN INSTANCE DE REVERSEMENT</h1><p class="text-slate-500 text-sm" style="text-transform:uppercase">${soc?escapeHTML(soc):"Toutes les sociétés"} · Tout employé sortant doit reverser l'ensemble de sa dotation</p></div>
    <div class="flex gap-2"><button class="btn btn-secondary text-sm" onclick="navigate('effectif/sortant')">Sortant</button><button class="btn btn-secondary text-sm" onclick="navigate('materiel/mouvements')">Mouvements</button></div>
  </div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Employés à traiter</div><div class="text-3xl font-black mt-1 text-red-700">${agents.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Sortants total</div><div class="text-3xl font-black mt-1">${sortants.length}</div></div>
    <div class="card p-4"><div class="text-xs text-slate-500 uppercase">Valeur à reverser</div><div class="text-3xl font-black mt-1">${money(totalValue)}</div></div>
  </div>
  <div class="card overflow-hidden">
    <table><thead><tr><th>Employé sortant</th><th>Statut</th><th>Société</th><th>Dotation à reverser</th><th>Valeur exacte</th><th>Détail</th><th>Action</th></tr></thead>
    <tbody>${agents.length===0?`<tr><td colspan="7" class="text-center text-slate-500 p-6">Aucun équipement en instance de reversement.</td></tr>`:agents.map(a=>{const s=agentReversementSituation(a.id);const detail=[...s.legacy.map(m=>`${m.code||"—"} · ${m.designation||"—"}`),...s.stock.map(r=>`${r.code} · ${r.designation} (${qty(r.qteRestante)} ${r.unite||""})`)].slice(0,4);return`<tr data-searchable>
      <td><div class="flex items-center gap-2"><div class="avatar">${a.photo?`<img src="${a.photo}"/>`:escapeHTML((a.prenom||a.nom||"?").slice(0,1))}</div><div><div class="font-semibold">${escapeHTML((a.nom||"")+" "+(a.prenom||""))}</div><div class="text-xs text-slate-500 font-mono">${escapeHTML(a.matricule||"—")}</div></div></div></td>
      <td><span class="pill pill-red">${escapeHTML(a.statut||"sortant")}</span></td>
      <td class="text-xs">${escapeHTML(a.societe||"—")}</td>
      <td><div class="font-bold">${s.count} article(s)</div><div class="text-[10px] text-slate-500">${s.legacy.length} ancien stock · ${s.stock.length} dotation(s) stock</div></td>
      <td class="font-bold text-right">${money(s.value)}</td>
      <td class="text-xs">${detail.map(x=>`<div>${escapeHTML(x)}</div>`).join("")}${s.count>4?`<div class="text-slate-400">+ ${s.count-4} autre(s)</div>`:""}</td>
      <td><div class="flex gap-1 flex-wrap justify-end"><a class="btn btn-ghost text-xs" href="#/materiel/fiche/${a.id}" onclick="setFicheContext('materiel')">Fiche</a><button class="btn btn-primary text-xs" onclick="openReversementModal('${a.id}')">Saisir reversement</button></div></td>
    </tr>`}).join("")}</tbody></table>
  </div>`;
}

async function reverseAllDotation(agentId){
  const a=(db.agents||[]).find(x=>x.id===agentId);if(!a)return;
  const sit=agentReversementSituation(agentId);
  if(sit.count===0){toast("Aucune dotation à reverser","info");return}
  if(!confirm(`Confirmer le reversement complet de la dotation ?\n\nEmployé : ${(a.nom||"")+" "+(a.prenom||"")}\nArticles : ${sit.count}\nValeur : ${money(sit.value)}`))return;
  const d=today();
  const nom=`${a.nom||""} ${a.prenom||""}${a.matricule?" · "+a.matricule:""}`.trim();

  // 1. Matériel legacy (local uniquement, pas de PostgreSQL)
  sit.legacy.forEach(m=>{
    m.dateRetour=d;m.statut="en_stock";m.agentId=null;
    m.notes=[m.notes,"Reversement employé sortant "+nom].filter(Boolean).join(" · ");
  });

  // 2. Dotations PostgreSQL — appel API pour chaque équipement attribué
  let pgOk=0;let pgErr=0;
  if(a.backendId&&sgdiAuthToken()&&sgdiBackendShouldUse()){
    try{
      const equipments=await SGDI.stock.employeeEquipment(a.backendId);
      const attribues=(equipments||[]).filter(e=>e.status==="attribue");
      for(const eq of attribues){
        try{
          await SGDI.stock.returnEquipment(eq.id,{return_date:d,return_reason:"Reversement obligatoire employé sortant"});
          pgOk++;
        }catch(e){
          console.warn("Reversement équipement #"+eq.id+" échoué",e);
          pgErr++;
        }
      }
      // Recharge le stock depuis PostgreSQL pour refléter les mises à jour
      const freshArticles=await SGDI.stock.articles({}).catch(()=>null);
      if(freshArticles)db.stockArticles=freshArticles.map(articleFromApi);
      const freshMvts=await SGDI.stock.movements().catch(()=>null);
      if(freshMvts)db.stockMouvements=freshMvts.map(movementFromApi);
    }catch(e){
      toast("Chargement équipements échoué : "+(e.message||e),"error");
    }
  }else{
    // Fallback local si pas de connexion PostgreSQL
    db.stockMouvements=db.stockMouvements||[];
    sit.stock.forEach(r=>{
      db.stockMouvements.push({
        id:uid("mvt"),articleId:r.articleId,type:"retour",date:d,quantite:r.qteRestante,
        prixUnitaire:r.prixUnitaire||0,motif:"Retour employé",retourAgentId:agentId,retourAgentNom:nom,
        repartitionTailles:r.repartitionTailles||{},notes:"Reversement obligatoire employé sortant",userId:session?.username||"",createdAt:new Date().toISOString()
      });
    });
  }

  saveDB();
  if(typeof logActivity==="function")logActivity("Reversement dotation",nom+" · "+sit.count+" article(s) · "+money(sit.value)+(pgOk?` · ${pgOk} reversé(s) PostgreSQL`:""));
  const msg=pgErr?`Reversement terminé avec ${pgErr} erreur(s) — vérifiez les logs.`:"Dotation reversée et stock mis à jour.";
  toast(msg,pgErr?"error":"success");
  renderSidebar();renderView();
}

SGDIModules.registerModule({key: "material", routes: ["materiel"], dependencies: ["positions","material-stores","material-inventory","material-movements"], init: function(){}, destroy: function(){positionsStopInteractions()}});
