/* Phase 2 — material-movements. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function stockMvtToggleBeneficiaireAgent(){
  const motif=document.querySelector(".modal-bg [name='motif']")?.value||"";
  const agentBox=document.getElementById("stk-benef-agent-box");
  const freeBox=document.getElementById("stk-benef-free-box");
  const retourBox=document.getElementById("stk-retour-agent-box");
  const fournisseurBox=document.getElementById("stk-fournisseur-box");
  const isAgent=stockMvtIsAttributionAgent(motif);
  const isRetour=stockMvtIsRetourAgent(motif);
  if(agentBox)agentBox.style.display=isAgent?"block":"none";
  if(freeBox)freeBox.style.display=isAgent?"none":"block";
  if(retourBox)retourBox.style.display=isRetour?"block":"none";
  if(fournisseurBox)fournisseurBox.style.display=isRetour?"none":"block";
}

function stockMvtEntryTypeChanged(){
  const type=document.querySelector(".modal-bg [name='type']")?.value||"achat";
  const fournisseurBox=document.getElementById("stk-fournisseur-box");
  const siteBox=document.getElementById("stk-retour-site-box");
  const agentBox=document.getElementById("stk-retour-agent-box");
  const motif=document.querySelector(".modal-bg [name='motif']");
  if(fournisseurBox)fournisseurBox.style.display=type==="achat"?"block":"none";
  if(siteBox)siteBox.style.display=type==="retour_site"?"block":"none";
  if(agentBox)agentBox.style.display=type==="retour_employe"?"block":"none";
  if(motif){
    motif.value=type==="achat"?"Nouvelle acquisition":type==="retour_site"?"Reversement site":"Reversement employé";
  }
  const bon=document.querySelector(".modal-bg [name='numeroBon']");
  if(bon&&!bon.dataset.userEdited)bon.value=nextStockBonNum(type);
}

function stockMvtTaillePointureHTML(a){
  if(!a)return`<div id="stk-mvt-tp-box"><label class="label">Taille / Pointure</label><select class="select text-slate-400" name="taillePointure" disabled><option value="">Choisissez d'abord un article</option></select></div>`;
  const data=stockMvtArticleVariantAvailability(a);
  const hasAny=data.rows.some(r=>r.available>0);
  return`<div id="stk-mvt-tp-box"><label class="label">${data.type}</label><select class="select" name="taillePointure" ${hasAny?"":"disabled"}><option value="">— Choisir ${data.type.toLowerCase()} —</option>${data.rows.map(r=>`<option value="${escapeHTML(r.value)}" data-available="${r.available}" ${r.available<=0?"disabled style='color:#94a3b8;background:#f1f5f9'":"style='color:#0f172a;font-weight:700'"}>${escapeHTML(r.value)}${r.available>0?` · disponible: ${qty(r.available)}`:" · non disponible"}</option>`).join("")}</select><div class="text-[10px] text-slate-400 mt-1">Les valeurs grisées ne sont pas disponibles en stock.</div></div>`;
}

function stockMvtSizeBreakdownHTML(a){
  const show=stockMvtIsHabillementArticle(a);
  const tailles=["XS","S","M","L","XL","XXL","XXXL","4XL"];
  const cell=(k,label)=>`<div><label class="label text-center">${label}</label><input class="input text-center" type="number" min="0" step="1" value="" data-size-key="${k}" oninput="stockMvtRecalcQty()" placeholder="0"/></div>`;
  return`<div id="stk-mvt-size-block" class="col-span-2 p-3 rounded-md" style="display:${show?"block":"none"};background:#f8fafc;border:1px solid #cbd5e1">
    <div class="flex justify-between items-center mb-2">
      <div>
        <div class="text-sm font-black text-slate-800">Répartition des quantités par taille</div>
        <div class="text-[11px] text-slate-500">À utiliser pour les tenues, parkas et articles d'habillement.</div>
      </div>
      <div class="text-xs font-bold text-emerald-700">Total : <span id="stk-mvt-size-total">0</span></div>
    </div>
    <div class="text-[10px] uppercase font-bold text-slate-500 mb-1">Tailles vêtements</div>
    <div class="grid grid-cols-4 md:grid-cols-8 gap-2">${tailles.map(x=>cell("Taille "+x,x)).join("")}</div>
  </div>`;
}

function stockMvtToggleSizeBreakdown(){
  const sel=document.querySelector(".modal-bg [name='articleId']");
  const block=document.getElementById("stk-mvt-size-block");
  if(!sel||!block)return;
  const a=(db.stockArticles||[]).find(x=>x.id===sel.value);
  const show=stockMvtIsHabillementArticle(a);
  block.style.display=show?"block":"none";
  if(!show){
    block.querySelectorAll("[data-size-key]").forEach(i=>i.value="");
    stockMvtRecalcQty();
  }
}

function stockMvtRecalcQty(){
  const block=document.getElementById("stk-mvt-size-block");
  if(!block)return;
  let total=0;
  block.querySelectorAll("[data-size-key]").forEach(i=>{total+=parseFloat(i.value)||0});
  const out=document.getElementById("stk-mvt-size-total");if(out)out.textContent=qty(total);
  const q=document.querySelector(".modal-bg [name='quantite']");
  if(q&&total>0)q.value=total;
}

function stockMvtApplyMagasinConfig(articleId){
  const a=(db.stockArticles||[]).find(x=>x.id===articleId);
  const mag=a?(db.magasins||[]).find(m=>String(m.id)===String(a.magasinId||"")||String(m.backendId||"")===String(a.magasinId||"")):null;
  const cfg=magasinConfig(mag);
  const show=(id,visible)=>{const el=document.getElementById(id);if(el)el.style.display=visible?"":"none"};
  show("stk-mvt-quantite-wrap",cfg.avecQuantite);
  show("stk-mvt-taille-wrap",cfg.avecTaille);
  show("stk-mvt-prix-wrap",cfg.avecPrix);
  // Masquer l'ancien bloc taille/pointure quand le nouveau champ est actif
  const tpBox=document.getElementById("stk-mvt-tp-box");
  if(tpBox)tpBox.style.display=cfg.avecTaille?"none":"";
}

function stockMvtArticleChanged(){
  const sel=document.querySelector(".modal-bg [name='articleId']");if(!sel)return;
  const opt=sel.options[sel.selectedIndex];if(!opt||!opt.value){
    document.getElementById("stk-mvt-stock-info").innerHTML="";
    const magDisplay=document.getElementById("stk-mvt-magasin-display");
    if(magDisplay)magDisplay.value="";
    const prixField=document.querySelector(".modal-bg [name='prixUnitaire']");
    if(prixField)prixField.value="";
    stockMvtRefreshTaillePointure();
    stockMvtToggleSizeBreakdown();
    return;
  }
  const stock=opt.dataset.stock;const unite=opt.dataset.unite;const prix=opt.dataset.prix;
  const info=document.getElementById("stk-mvt-stock-info");
  if(info)info.innerHTML=`Stock actuel : <b>${qty(stock)} ${escapeHTML(unite)}</b> · P.U. de référence : <b>${money(prix)} DA</b>`;
  const magDisplay=document.getElementById("stk-mvt-magasin-display");
  if(magDisplay)magDisplay.value=opt.dataset.magasin||"";
  const prixField=document.querySelector(".modal-bg [name='prixUnitaire']");
  if(prixField)prixField.value=prix||"";
  stockMvtRefreshTaillePointure();
  stockMvtToggleSizeBreakdown();
  stockMvtApplyMagasinConfig(opt.value);
}

function stockMvtRefreshTaillePointure(){
  const box=document.getElementById("stk-mvt-tp-box");if(!box)return;
  const articleId=document.querySelector(".modal-bg [name='articleId']")?.value||"";
  const a=(db.stockArticles||[]).find(x=>x.id===articleId);
  box.outerHTML=stockMvtTaillePointureHTML(a);
}

async function stockSaveMvt(initialType){
  let f=null,saveBtn=null;
  try{
  f=document.getElementById("stock-mvt-form");
  if(!f){toast("Formulaire introuvable","error");return}
  if(f.dataset.submitting==="1")return;
  f.dataset.submitting="1";
  saveBtn=document.getElementById("stk-mvt-save-btn");
  if(saveBtn){saveBtn.disabled=true;saveBtn.dataset.originalText=saveBtn.textContent;saveBtn.textContent="Enregistrement..."}
  const fd=new FormData(f);
  const articleId=fd.get("articleId");
  if(!articleId){toast("Choisissez un article","error");return}
  const a=(db.stockArticles||[]).find(x=>x.id===articleId);if(!a){toast("Article introuvable","error");return}
  const type=fd.get("type")||initialType;
  let repartitionTailles={};
  const sizeBlock=document.getElementById("stk-mvt-size-block");
  if(sizeBlock&&sizeBlock.style.display!=="none"){
    sizeBlock.querySelectorAll("[data-size-key]").forEach(i=>{
      const v=parseFloat(i.value)||0;
      if(v>0)repartitionTailles[i.dataset.sizeKey]=v;
    });
  }
  // Champ taille simple (S→5XL) — prioritaire sur les autres méthodes
  const tailleSimple=(fd.get("tailleSimple")||"").trim();
  const taillePointure=(fd.get("taillePointure")||"").trim();
  const totalRepartition=Object.values(repartitionTailles).reduce((s,v)=>s+(parseFloat(v)||0),0);
  const qte=totalRepartition>0?totalRepartition:(parseFloat(fd.get("quantite"))||0);
  if(qte<=0){toast("Quantité invalide (saisissez un nombre > 0)","error");return}
  // Brancher la taille simple sur repartitionTailles
  if(tailleSimple&&Object.keys(repartitionTailles).length===0){
    repartitionTailles={["Taille "+tailleSimple]:qte};
  }
  const tpSelect=f.querySelector('[name="taillePointure"]');
  if(!tailleSimple&&stockMvtIsOut(type)&&tpSelect&&!tpSelect.disabled){
    if(!taillePointure){toast("Choisissez la taille ou la pointure disponible","error");tpSelect.focus();return}
    const typeVar=stockMvtVariantTypeForArticle(a);
    repartitionTailles={[`${typeVar} ${taillePointure}`]:qte};
  }
  const motif=(fd.get("motif")||"").trim();
  if(!motif){toast("Sélectionnez un motif","error");return}
  const motifRenouvellement=(fd.get("motifRenouvellement")||"").trim();
  const motifRenouvellementPrecision=(fd.get("motifRenouvellementPrecision")||"").trim();
  if(type==="renouvellement_dotation"&&!motifRenouvellement){toast("Sélectionnez le motif du renouvellement","error");return}
  let beneficiaireAgentId=fd.get("beneficiaireAgentId")||"";
  let beneficiaireNom=(fd.get("beneficiaireNom")||"").trim();
  let retourAgentId=fd.get("retourAgentId")||"";
  let retourAgentNom="";
  let siteId=fd.get("siteId")||"";
  let siteNom="";
  if(stockMvtIsAttributionAgent(motif)){
    if(!beneficiaireAgentId){toast("Choisissez l'employé bénéficiaire","error");return}
    const ag=(db.agents||[]).find(x=>x.id===beneficiaireAgentId);
    beneficiaireNom=ag?`${ag.nom} ${ag.prenom}${ag.matricule?" · "+ag.matricule:""}`:"";
  }
  if(stockMvtIsRetourAgent(motif)){
    if(!retourAgentId){toast("Choisissez l'employé concerné par le retour","error");return}
    const ag=(db.agents||[]).find(x=>x.id===retourAgentId);
    retourAgentNom=ag?`${ag.nom} ${ag.prenom}${ag.matricule?" · "+ag.matricule:""}`:"";
  }
  if(type==="retour_site"){
    if(!siteId){toast("Choisissez le site concerné par le reversement","error");return}
    const site=(db.sites||[]).find(x=>String(x.id)===String(siteId)||String(x.backendId||"")===String(siteId));
    siteNom=site?[site.client,site.nom,site.indicatif].filter(Boolean).join(" · "):"";
  }
  // Vérifier stock pour sortie
  if(stockMvtIsOut(type)){
    const dispo=stockGetActuel(articleId);
    if(qte>dispo){
      toast(`Stock insuffisant : disponible ${qty(dispo)} ${a.unite||""}`,"error");
      return;
    }
  }
  const m={
    id:uid("mvt"),
    articleId,
    type,
    date:fd.get("date")||today(),
    quantite:qte,
    repartitionTailles,
    prixUnitaire:parseFloat(fd.get("prixUnitaire"))||parseFloat(a.prixUnitaire)||0,
    motif:motif,
    fournisseurId:fd.get("fournisseurId")||"",
    fournisseur:fd.get("fournisseur")||(fd.get("fournisseurId")?(db.fournisseurs||[]).find(x=>x.id===fd.get("fournisseurId"))?.raisonSociale||"":""),
    motifRenouvellement,
    motifRenouvellementPrecision,
    magasinId:a.magasinId||"",
    societe:a.societe||"",
    beneficiaireAgentId,
    retourAgentId,
    retourAgentNom,
    siteId,
    cibleType:type==="retour_site"?"site":"",
    cibleId:type==="retour_site"?siteId:"",
    cibleNom:type==="retour_site"?siteNom:"",
    agentId:beneficiaireAgentId||retourAgentId,
    beneficiaireNom:beneficiaireNom||retourAgentNom||siteNom,
    numeroBon:fd.get("numeroBon")||nextStockBonNum(type),
    refDocument:"",
    notes:fd.get("notes")||"",
    userId:session?.username||"",
    createdAt:new Date().toISOString()
  };
  const isEmployeeDotation=false;
  try{await persistMovementToPostgres(m)}catch(e){toast("Mouvement non sauvegardé : "+(e.message||e),"error");return}
  db.stockMouvements=db.stockMouvements||[];
  db.stockMouvements.push(m);
  if(isEmployeeDotation){
    const ag=(db.agents||[]).find(x=>String(x.id)===String(beneficiaireAgentId));
    if(ag)syncMaterialDotationToEmployee(ag,m,a);
  }
  a.derniereMaj=today();
  // Imputation caisse automatique
  const imputer=fd.get("imputerCaisse")==="1";
  const valeur=qte*(parseFloat(m.prixUnitaire)||0);
  let caisseCreated=false;
  if(imputer&&valeur>0){
    const mode=fd.get("caisseMode")||"auto";
    const isEntry=type==="entree"||type==="retour";
    let caisseType,categorie,libelle;
    if(isEntry){
      // Stock entry → cash outflow (purchase)
      caisseType="sortie";
      if(mode==="charge")categorie="Charge d'exploitation";
      else categorie="Achat fournisseur — Stock";
      libelle=`Achat stock · ${a.designation} (${qte} ${a.unite||""})${m.fournisseur?" · "+m.fournisseur:""}${m.numeroBon?" · "+m.numeroBon:""}`;
    }else{
      // Stock exit → outflow (consumption) or inflow (sale)
      const isVente=mode==="vente"||(mode==="auto"&&(m.motif||"").toLowerCase().includes("vente"));
      if(isVente){
        caisseType="entree";
        categorie="Vente sur stock";
        libelle=`Vente stock · ${a.designation} (${qte} ${a.unite||""})${m.beneficiaireNom?" · "+m.beneficiaireNom:""}${m.numeroBon?" · "+m.numeroBon:""}`;
      }else{
        caisseType="sortie";
        categorie=type==="perte"?"Perte stock":(type==="casse"?"Casse stock":(type==="reforme"?"Réforme stock":"Consommation stock"));
        libelle=`${stockMvtTypeLabel(type)} · ${a.designation} (${qte} ${a.unite||""})${m.beneficiaireNom?" · "+m.beneficiaireNom:""}${m.motif?" · "+m.motif:""}`;
      }
    }
    db.caisse=db.caisse||[];
    const caisseEntry={
      id:uid("cai"),
      date:m.date,
      type:caisseType,
      categorie,
      libelle,
      montant:valeur,
      mode:"Auto-stock",
      reference:m.numeroBon||m.refDocument||"",
      societe:a.societe||"",
      sourceMvtId:m.id,
      sourceArticleId:a.id,
      createdAt:new Date().toISOString(),
      createdBy:session?.username||""
    };
    db.caisse.push(caisseEntry);
    m.caisseId=caisseEntry.id;
    caisseCreated=true;
  }
  const tLabel=stockMvtTypeLabel(type);
  if(typeof logActivity==="function")logActivity("Mouvement stock "+tLabel,a.code+" · "+a.designation+" · "+(stockMvtIsOut(type)?"−":"+")+qte+(caisseCreated?" · caisse"+money(valeur)+" DA":""));
  if(!(await saveDBAndWaitToast("Mouvement stock non confirmé")))return;
  closeModal();
  toast(`${tLabel} enregistrée : ${qty(qte)} ${a.unite||"unité(s)"} de ${a.designation}${caisseCreated?" · ✓ caisse mise à jour":""}`,"success");
  renderView();
  }catch(err){
    console.error("stockSaveMvt error:",err);
    toast("Erreur d'enregistrement: "+err.message,"error");
  }finally{
    if(f&&document.body.contains(f)){
      f.dataset.submitting="";
      if(saveBtn){saveBtn.disabled=false;saveBtn.textContent=saveBtn.dataset.originalText||"Enregistrer"}
    }
  }
}

async function stockDeleteMvt(id){
  const m=(db.stockMouvements||[]).find(x=>x.id===id);if(!m)return;
  const a=(db.stockArticles||[]).find(x=>x.id===m.articleId);
  const hasCaisse=m.caisseId&&(db.caisse||[]).some(c=>c.id===m.caisseId);
  if(!confirm(`Supprimer ce mouvement ?\n${stockMvtTypeLabel(m.type)} de ${m.quantite} ${a?(a.unite||""):""} (${formatDate(m.date)})${hasCaisse?"\n\n⚠️ L'écriture caisse associée sera également supprimée.":""}`))return;
  if(m.backendId){try{await SGDI.stock.deleteMovement(m.backendId)}catch(e){toast("Suppression PostgreSQL impossible : "+(e.message||e),"error");return}}
  db.stockMouvements=(db.stockMouvements||[]).filter(x=>x.id!==id);
  if(hasCaisse){db.caisse=(db.caisse||[]).filter(c=>c.id!==m.caisseId)}
  if(!(await saveDBAndWaitToast("Suppression mouvement non confirmée")))return;
  toast("Mouvement supprimé"+(hasCaisse?" · caisse mise à jour":""),"success");renderSidebar();renderView();
}

function stockShowMvt(id){
  const m=(db.stockMouvements||[]).find(x=>x.id===id);if(!m)return;
  const a=(db.stockArticles||[]).find(x=>x.id===m.articleId);
  const tColor=stockMvtTypeColor(m.type);
  const tIcon=stockMvtTypeIcon(m.type);
  const tLabel=stockMvtTypeLabel(m.type);
  const rep=m.repartitionTailles||{};
  const repHTML=Object.keys(rep).length?`<div class="py-2 border-b"><div class="text-slate-500 uppercase font-bold text-xs mb-2">Répartition tailles / pointures</div><div class="flex flex-wrap gap-1">${Object.entries(rep).map(([k,v])=>`<span class="pill" style="background:#f8fafc;border:1px solid #cbd5e1;color:#0f172a">${escapeHTML(k)} : <b>${qty(v)}</b></span>`).join("")}</div></div>`:"";
  openModal(`<h3 class="font-bold text-lg mb-3" style="color:${tColor}">${tIcon} ${tLabel} · ${formatDate(m.date)}</h3>
    <div class="space-y-2 text-sm">
      <div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">Article</span><span class="font-bold">${a?escapeHTML(a.designation):"—"}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">Code</span><span class="font-mono">${a?safe(a.code):"—"}</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">Quantité</span><span class="font-bold" style="color:${tColor}">${stockMvtIsOut(m.type)?"−":"+"}${qty(m.quantite)} ${a?escapeHTML(a.unite||""):""}</span></div>
      ${repHTML}
      <div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">Prix unitaire</span><span>${money(m.prixUnitaire)} DA</span></div>
      <div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">Motif</span><span>${escapeHTML(m.motif||"—")}</span></div>
      ${m.motifRenouvellement?`<div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">Motif renouvellement</span><span>${escapeHTML(m.motifRenouvellement)}${m.motifRenouvellementPrecision?` · ${escapeHTML(m.motifRenouvellementPrecision)}`:""}</span></div>`:""}
      ${m.fournisseur?`<div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">Fournisseur</span><span>${escapeHTML(m.fournisseur)}</span></div>`:""}
      ${m.beneficiaireNom?`<div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">Bénéficiaire</span><span>${escapeHTML(m.beneficiaireNom)}</span></div>`:""}
      ${m.retourAgentNom?`<div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">Retour employé</span><span>${escapeHTML(m.retourAgentNom)}</span></div>`:""}
      ${m.numeroBon?`<div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">N° Bon</span><span class="font-mono">${escapeHTML(m.numeroBon)}</span></div>`:""}
      ${m.refDocument?`<div class="flex justify-between py-2 border-b"><span class="text-slate-500 uppercase font-bold text-xs">Réf. document</span><span>${escapeHTML(m.refDocument)}</span></div>`:""}
      ${m.notes?`<div class="py-2 border-b"><div class="text-slate-500 uppercase font-bold text-xs mb-1">Notes</div><div class="whitespace-pre-wrap">${escapeHTML(m.notes)}</div></div>`:""}
      <div class="flex justify-between py-2"><span class="text-slate-500 uppercase font-bold text-xs">Enregistré par</span><span class="text-xs">${safe(m.userId)} · ${m.createdAt?new Date(m.createdAt).toLocaleString("fr-FR"):""}</span></div>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button class="btn btn-primary" onclick="closeModal()">Fermer</button>
    </div>`);
}

function stockSetFilter(key,value){
  sessionStorage.setItem("stk"+key,value||"");
  renderView();
}

function stockSetPeriode(p){
  sessionStorage.setItem("stkPeriode",p);
  renderView();
}

function stockExportCSV(){
  const arts=stockArticlesFiltered();
  if(arts.length===0){toast("Aucun article à exporter","error");return}
  const rows=[["Code","Désignation","Société","Catégorie","Sous-catégorie","Marque","Modèle","Référence","Code-barre","Unité","Prix unitaire","Stock initial","Stock actuel","Stock min","Stock max","Seuil alerte","Emplacement","Fournisseur","État"]];
  arts.forEach(a=>{
    const cat=stockGetCategorie(a.societe,a.categorie);
    const q=stockGetActuel(a.id);
    const etat=stockGetEtat(a);
    rows.push([a.code,a.designation,a.societe,cat.label,a.sousCategorie,a.marque,a.modele,a.reference,a.codeBarre,a.unite,a.prixUnitaire,a.stockInitial,q,a.stockMin,a.stockMax,a.seuilAlerte,a.emplacement,a.fournisseur,etat.label]);
  });
  const csv=rows.map(r=>r.map(c=>{const s=String(c==null?"":c);return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(";")).join("\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download="catalogue-stock-"+today()+".csv";a.click();
  URL.revokeObjectURL(url);
  toast("Export CSV téléchargé","success");
}

SGDIModules.registerModule({key: "material-movements", routes: [], dependencies: [], init: function(){}, destroy: function(){}});
