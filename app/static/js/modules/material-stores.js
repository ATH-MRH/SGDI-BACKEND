/* Phase 2 — material-stores. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
function openReversementModal(agentId){
  const a=(db.agents||[]).find(x=>x.id===agentId);if(!a)return;
  const sit=agentReversementSituation(agentId);
  const nom=((a.nom||"")+" "+(a.prenom||"")).trim();
  const allRows=[
    ...sit.legacy.map((m,i)=>({key:"leg_"+i,designation:m.designation||m.code||"Article",code:m.code||"",qte:1,pu:parseFloat(m.prix)||0,valeur:parseFloat(m.prix)||0,unite:"",type:"legacy",ref:m})),
    ...sit.stock.map((r,i)=>({key:"stk_"+i,designation:r.designation,code:r.code,qte:r.qteRestante,pu:r.prixUnitaire,valeur:r.valeur,unite:r.unite,type:"stock",ref:r}))
  ];
  if(!allRows.length){toast("Aucune dotation à reverser pour cet employé","info");return}
  const etatOpts=["Neuf","Bon","Réformé"].map(e=>`<option value="${e}">${e}</option>`).join("");
  const rows=allRows.map((r,i)=>`<tr>
    <td class="text-xs font-mono">${escapeHTML(r.code||"—")}</td>
    <td>${escapeHTML(r.designation)}</td>
    <td class="text-center font-bold">${qty(r.qte)} ${escapeHTML(r.unite||"")}</td>
    <td class="text-right">${money(r.pu)}</td>
    <td class="text-right font-bold reversement-valeur" data-pu="${r.pu}" data-qte="${r.qte}">${money(r.valeur)}</td>
    <td><select class="select text-sm reversement-etat" name="etat_${i}" data-idx="${i}" data-key="${r.key}" data-valeur="${r.valeur}" onchange="reversementUpdateReforme(this)">
      <option value="Bon" selected>Bon</option><option value="Neuf">Neuf</option><option value="Réformé">Réformé</option>
    </select></td>
  </tr>`).join("");
  openModal(`<div style="max-width:680px">
    <div style="background:#043970;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:900;font-size:15px">
      FICHE DE REVERSEMENT — ${escapeHTML(nom)}
    </div>
    <div style="padding:18px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div><label class="label text-xs">Date de reversement</label><input type="date" class="input" id="rev-date" value="${today()}"></div>
        <div style="display:flex;align-items:flex-end"><div class="card p-3 w-full" style="background:#fef2f2;border:1px solid #fecaca">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:700;margin-bottom:4px">Total Réformé à déduire du STC</div>
          <div id="rev-reforme-total" style="font-size:22px;font-weight:900;color:#991b1b">0 DA</div>
        </div></div>
      </div>
      <div class="overflow-x-auto" style="max-height:340px;overflow-y:auto">
        <table><thead><tr><th>Code</th><th>Article</th><th>Qté</th><th>PU</th><th>Valeur</th><th>État</th></tr></thead>
        <tbody id="rev-rows">${rows}</tbody></table>
      </div>
      <div style="margin-top:16px;text-align:right;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" onclick="closeModal()">Annuler</button>
        <button class="btn btn-secondary" onclick="printFicheReversementModal('${agentId}')">Imprimer fiche</button>
        <button class="btn btn-danger" onclick="validerReversementDotation('${agentId}')">Valider le reversement</button>
      </div>
    </div>
  </div>`);
}

function reversementUpdateReforme(sel){
  let total=0;
  document.querySelectorAll(".reversement-etat").forEach(s=>{
    if(s.value==="Réformé")total+=parseFloat(s.dataset.valeur||0)||0;
  });
  const el=document.getElementById("rev-reforme-total");
  if(el)el.textContent=money(total);
}

function reversementGetLines(agentId){
  const sit=agentReversementSituation(agentId);
  const allRows=[
    ...sit.legacy.map((m,i)=>({key:"leg_"+i,designation:m.designation||m.code||"Article",code:m.code||"",qte:1,pu:parseFloat(m.prix)||0,valeur:parseFloat(m.prix)||0,unite:"",type:"legacy",ref:m})),
    ...sit.stock.map((r,i)=>({key:"stk_"+i,designation:r.designation,code:r.code,qte:r.qteRestante,pu:r.prixUnitaire,valeur:r.valeur,unite:r.unite,type:"stock",ref:r}))
  ];
  const etats={};
  document.querySelectorAll(".reversement-etat").forEach(s=>{etats[s.dataset.key]=s.value});
  return allRows.map(r=>({...r,etat:etats[r.key]||"Bon"}));
}

async function validerReversementDotation(agentId){
  const a=(db.agents||[]).find(x=>x.id===agentId);if(!a)return;
  const dateRev=document.getElementById("rev-date")?.value||today();
  const lines=reversementGetLines(agentId);
  if(!lines.length){toast("Aucune dotation à reverser","error");return}
  const nom=`${a.nom||""} ${a.prenom||""}${a.matricule?" · "+a.matricule:""}`.trim();
  const reformeTotal=lines.filter(l=>l.etat==="Réformé").reduce((s,l)=>s+l.valeur,0);
  const d=dateRev||today();

  // 1. Reverser les articles legacy
  const sit=agentReversementSituation(agentId);
  const linesByKey={};lines.forEach(l=>linesByKey[l.key]=l);
  sit.legacy.forEach((m,i)=>{
    const line=linesByKey["leg_"+i];
    m.dateRetour=d;m.statut="en_stock";m.agentId=null;
    m.etatReversement=line?.etat||"Bon";
    m.notes=[m.notes,"Reversement "+nom+` [${line?.etat||"Bon"}]`].filter(Boolean).join(" · ");
  });

  // 2. Reverser les articles stock PostgreSQL (ou local)
  let pgOk=0;let pgErr=0;
  if(a.backendId&&sgdiAuthToken()&&sgdiBackendShouldUse()){
    try{
      const equipments=await SGDI.stock.employeeEquipment(a.backendId);
      const attribues=(equipments||[]).filter(e=>e.status==="attribue");
      for(let i=0;i<attribues.length;i++){
        const eq=attribues[i];
        const line=linesByKey["stk_"+i];
        try{
          await SGDI.stock.returnEquipment(eq.id,{return_date:d,return_reason:"Reversement sortant ["+( line?.etat||"Bon")+"]"});
          pgOk++;
        }catch(e){console.warn("Reversement eq #"+eq.id,e);pgErr++;}
      }
      const freshArticles=await SGDI.stock.articles({}).catch(()=>null);
      if(freshArticles)db.stockArticles=freshArticles.map(articleFromApi);
      const freshMvts=await SGDI.stock.movements().catch(()=>null);
      if(freshMvts)db.stockMouvements=freshMvts.map(movementFromApi);
    }catch(e){toast("Chargement équipements échoué : "+(e.message||e),"error");}
  }else{
    sit.stock.forEach((r,i)=>{
      const line=linesByKey["stk_"+i];
      db.stockMouvements=db.stockMouvements||[];
      db.stockMouvements.push({
        id:uid("mvt"),articleId:r.articleId,type:"retour",date:d,quantite:r.qteRestante,
        prixUnitaire:r.prixUnitaire||0,motif:"Retour employé sortant",retourAgentId:agentId,retourAgentNom:nom,
        etatReversement:line?.etat||"Bon",notes:"Reversement sortant ["+( line?.etat||"Bon")+"]",
        userId:session?.username||"",createdAt:new Date().toISOString()
      });
    });
  }

  // 3. Mettre à jour l'employé
  a.finRelationDotationReversee=true;
  a.finRelationReversementAt=new Date().toISOString();
  a.finRelationReversementDate=d;
  a.finRelationReversementArticles=lines.map(l=>({code:l.code,designation:l.designation,qte:l.qte,pu:l.pu,valeur:l.valeur,unite:l.unite,etat:l.etat}));
  if(reformeTotal>0){a.stcDeductionReforme=reformeTotal;}
  try{if(a.backendId)await SGDI.employees.update(a.backendId,employeeApiPayload(a));}
  catch(e){console.warn("Reversement employee save failed",e);}

  saveDB();
  closeModal();
  toast(pgErr?`Reversement enregistré avec ${pgErr} erreur(s).`:"Reversement validé — fiche transmise à la DRH.","success");
  if(typeof logActivity==="function")logActivity("Reversement validé",nom+" · "+lines.length+" article(s)"+(reformeTotal?` · Réformé : ${money(reformeTotal)}`:""));
  renderSidebar();renderView();
  // Générer la fiche de reversement pour impression
  setTimeout(()=>openFicheReversementPrint(a,lines,d,reformeTotal),300);
}

function printFicheReversementModal(agentId){
  const a=(db.agents||[]).find(x=>x.id===agentId);if(!a)return;
  const dateRev=document.getElementById("rev-date")?.value||today();
  const lines=reversementGetLines(agentId);
  const reformeTotal=lines.filter(l=>l.etat==="Réformé").reduce((s,l)=>s+l.valeur,0);
  openFicheReversementPrint(a,lines,dateRev,reformeTotal);
}

function openFicheReversementPrint(a,lines,dateRev,reformeTotal){
  const nom=((a.nom||"")+" "+(a.prenom||"")).trim();
  const ref="FR-"+(a.matricule||a.id||"SGDI")+"-"+String(dateRev||today()).replaceAll("-","");
  const rowsHtml=lines.map((l,i)=>`<tr>
    <td class="text-center">${i+1}</td>
    <td class="mono">${escapeHTML(l.code||"—")}</td>
    <td>${escapeHTML(l.designation)}</td>
    <td class="text-center">${qty(l.qte)} ${escapeHTML(l.unite||"")}</td>
    <td class="text-right">${money(l.pu)}</td>
    <td class="text-right">${money(l.valeur)}</td>
    <td class="text-center ${l.etat==="Réformé"?"reforme":""}">${escapeHTML(l.etat)}</td>
  </tr>`).join("");
  const totalValeur=lines.reduce((s,l)=>s+l.valeur,0);
  const _stcDisp=drhStcReliquatDisplay(a);const stcConge=_stcDisp!=null?_stcDisp+"":"—";
  const html=`<!doctype html><html><head><meta charset="utf-8">
<title>Fiche de Reversement — ${escapeHTML(nom)}</title>
<style>
@page{size:A4 portrait;margin:15mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4}
.doc{width:180mm;margin:0 auto}
.actions{position:sticky;top:0;display:flex;justify-content:flex-end;padding:8px 0;background:#fff;border-bottom:1px solid #e2e8f0;margin-bottom:6mm;gap:8px}
.actions button{border:0;border-radius:8px;background:#043970;color:#fff;font:700 13px Arial;padding:8px 16px;cursor:pointer}
.logo{width:34mm;height:34mm;object-fit:contain;display:block;margin:0 auto 6mm}
.title{text-align:center;font-size:20px;font-weight:900;text-transform:uppercase;letter-spacing:.3px;margin:0 0 8mm}
.rule{border-top:2px solid #f2b705;margin:0 0 5mm}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:3mm 8mm;border:1px solid #d7dde8;padding:5mm;border-radius:4px;margin-bottom:7mm}
.meta-k{font-size:10px;text-transform:uppercase;font-weight:900;color:#334155}
.meta-v{font-weight:700}
.ref-block{display:flex;justify-content:space-between;font-size:11px;margin-bottom:5mm;color:#475569}
table{width:100%;border-collapse:collapse;margin-bottom:6mm}
th,td{border:1px solid #d7dde8;padding:2.5mm;text-align:left;font-size:12px}
th{background:#edf4fb;color:#043970;font-size:10px;text-transform:uppercase;font-weight:900}
.text-right{text-align:right}.text-center{text-align:center}.mono{font-family:monospace}
.reforme{color:#991b1b;font-weight:900}
.total-row{background:#f8fafc;font-weight:900}
.stc-box{border:1.5px solid #f2b705;background:#fffbeb;padding:5mm;border-radius:4px;margin-bottom:7mm}
.stc-box b{color:#b45309}
.stc-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5mm;text-align:center;margin-top:3mm}
.stc-cell .label{font-size:10px;text-transform:uppercase;font-weight:700;color:#64748b;margin-bottom:2mm}
.stc-cell .val{font-size:20px;font-weight:900;color:#043970}
.stc-cell .val.red{color:#991b1b}
.signs{display:grid;grid-template-columns:1fr 1fr;gap:20mm;margin-top:14mm}
.sign{border-top:1.5px solid #111;padding-top:3mm;text-align:center;font-weight:900;font-size:12px}
.footer{text-align:center;border-top:1.5px solid #f2b705;padding-top:2mm;font-size:9px;color:#475569;margin-top:10mm}
@media print{.actions{display:none!important}.doc{width:auto}}
</style></head><body>
<div class="actions no-print"><button onclick="window.print()">Imprimer</button><button onclick="window.close()" style="background:#64748b">Fermer</button></div>
<div class="doc">
  ${sgdiDocumentLogoHTML(a.societe,"logo")}
  <div class="title">Fiche de Reversement de Dotation</div>
  <div class="rule"></div>
  <div class="ref-block"><span><b>Réf :</b> ${escapeHTML(ref)}</span><span><b>Date :</b> ${formatDate(dateRev)}</span></div>
  <div class="meta">
    <div><div class="meta-k">Nom et Prénom</div><div class="meta-v">${escapeHTML(nom)}</div></div>
    <div><div class="meta-k">Matricule</div><div class="meta-v">${escapeHTML(a.matricule||"—")}</div></div>
    <div><div class="meta-k">Société</div><div class="meta-v">${escapeHTML(a.societe||"—")}</div></div>
    <div><div class="meta-k">Date de sortie</div><div class="meta-v">${formatDate(a.dateSortie||"")}</div></div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Code</th><th>Désignation</th><th class="text-center">Qté</th><th class="text-right">PU</th><th class="text-right">Valeur</th><th class="text-center">État</th></tr></thead>
    <tbody>${rowsHtml}
    <tr class="total-row"><td colspan="5" class="text-right">TOTAL DOTATION</td><td class="text-right">${money(totalValeur)}</td><td></td></tr>
    ${reformeTotal>0?`<tr class="total-row reforme"><td colspan="5" class="text-right">TOTAL RÉFORMÉ (à déduire du STC)</td><td class="text-right">${money(reformeTotal)}</td><td></td></tr>`:""}
    </tbody>
  </table>
  ${reformeTotal>0||stcConge!=="—"?`<div class="stc-box">
    <b>Solde Tout Compte — Récapitulatif congés</b>
    <div class="stc-grid">
      <div class="stc-cell"><div class="label">Reliquat congés</div><div class="val">${stcConge} j</div></div>
      <div class="stc-cell"><div class="label">Déduction réformé</div><div class="val red">${reformeTotal>0?money(reformeTotal):"—"}</div></div>
      <div class="stc-cell"><div class="label">Note</div><div style="font-size:11px;color:#64748b;margin-top:4px">Reste du STC à<br>calculer manuellement</div></div>
    </div>
  </div>`:""}
  <div class="signs">
    <div class="sign">RESPONSABLE MATÉRIEL<div class="label" style="font-size:11px;font-weight:400;margin-top:8mm">Date et signature</div></div>
    <div class="sign">DIRECTION DES RESSOURCES HUMAINES<div class="label" style="font-size:11px;font-weight:400;margin-top:8mm">Date et signature</div></div>
  </div>
  <div class="footer">IRONGS — Fiche de Reversement de Dotation · ${escapeHTML(ref)} · Généré le ${formatDate(today())}</div>
</div></body></html>`;
  const w=window.open("","_blank","width=900,height=700");
  if(w){w.document.write(html);w.document.close();}else{toast("Impression bloquée par le navigateur","warn");}
}

function matInvSet(k,v){sessionStorage.setItem("matInv"+k,v||"");render()}

function matInvClear(){["Soc","Mag","Cat","Du","Au"].forEach(k=>sessionStorage.removeItem("matInv"+k));render()}

function renderMatSimpleInventaire(view){
  const baseSoc=matSimpleSocFilter();
  const fSoc=sessionStorage.getItem("matInvSoc")||baseSoc||"";
  const fMag=sessionStorage.getItem("matInvMag")||"";
  const fCat=sessionStorage.getItem("matInvCat")||"";
  const fDu=sessionStorage.getItem("matInvDu")||"";
  const fAu=sessionStorage.getItem("matInvAu")||"";
  const mags=(db.magasins||[]).slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||""));
  let arts=(db.stockArticles||[]).slice();
  if(fSoc)arts=arts.filter(a=>a.societe===fSoc||!a.societe);
  if(fMag)arts=arts.filter(a=>(a.magasinId||"")===fMag);
  if(fCat)arts=arts.filter(a=>(a.categorie||"")===fCat);
  const cats=[...new Set((db.stockArticles||[]).map(a=>a.categorie).filter(Boolean))].sort();
  const inPeriod=m=>{const d=m.date||"";if(fDu&&d<fDu)return false;if(fAu&&d>fAu)return false;return true};
  const rows=arts.map(a=>{
    const mvts=(db.stockMouvements||[]).filter(m=>m.articleId===a.id&&inPeriod(m));
    const entree=mvts.filter(m=>stockMvtIsIn(m.type)).reduce((s,m)=>s+(parseFloat(m.quantite)||0),0);
    const sortie=mvts.filter(m=>stockMvtIsOut(m.type)).reduce((s,m)=>s+(parseFloat(m.quantite)||0),0);
    const stock=stockGetActuel(a.id);
    const val=stock*(parseFloat(a.prixUnitaire)||0);
    const mag=mags.find(m=>m.id===a.magasinId);
    return{a,mvts,entree,sortie,stock,val,mag};
  }).sort((x,y)=>((x.mag?.nom||"Sans magasin")+" "+(x.a.designation||"")).localeCompare((y.mag?.nom||"Sans magasin")+" "+(y.a.designation||"")));
  const totalArticles=rows.length;
  const totalStock=rows.reduce((s,r)=>s+r.stock,0);
  const totalEntree=rows.reduce((s,r)=>s+r.entree,0);
  const totalSortie=rows.reduce((s,r)=>s+r.sortie,0);
  const byMag={};
  rows.forEach(r=>{const key=r.mag?r.mag.id:"_sans";if(!byMag[key])byMag[key]={nom:r.mag?r.mag.nom:"Sans magasin",nb:0,stock:0,val:0,entree:0,sortie:0};byMag[key].nb++;byMag[key].stock+=r.stock;byMag[key].val+=r.val;byMag[key].entree+=r.entree;byMag[key].sortie+=r.sortie});
  const header=matSimpleHeader("inventaire");
  const titleBar=`<div class="flex justify-between items-center mb-3 flex-wrap gap-2"><div><h1 class="text-2xl font-bold">📋 Inventaire général</h1><p class="text-slate-500 text-sm">Tous les magasins · par article · par période</p></div><div class="flex gap-2"><button class="btn btn-secondary text-sm" onclick="window.print()">🖨 Imprimer</button><button class="btn btn-warn text-sm" onclick="navigate('materiel/article-nouveau')">➕ Nouvel article</button></div></div>`;
  const filters=`<div class="card p-3 mb-4" style="background:#f8fafc"><div class="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
    <div><label class="label">Société</label><select class="select text-sm" onchange="matInvSet('Soc',this.value)" ${baseSoc?"disabled":""}><option value="">Toutes</option>${SOCIETES.map(s=>`<option value="${s}" ${fSoc===s?"selected":""}>${s}</option>`).join("")}</select></div>
    <div><label class="label">Magasin</label><select class="select text-sm" onchange="matInvSet('Mag',this.value)"><option value="">Tous magasins</option>${mags.map(m=>`<option value="${m.id}" ${fMag===m.id?"selected":""}>${escapeHTML(m.nom)}</option>`).join("")}</select></div>
    <div><label class="label">Catégorie</label><select class="select text-sm" onchange="matInvSet('Cat',this.value)"><option value="">Toutes catégories</option>${cats.map(c=>`<option value="${escapeHTML(c)}" ${fCat===c?"selected":""}>${escapeHTML(c)}</option>`).join("")}</select></div>
    <div><label class="label">Du</label><input class="input text-sm" type="date" value="${fDu}" onchange="matInvSet('Du',this.value)"/></div>
    <div><label class="label">Au</label><input class="input text-sm" type="date" value="${fAu}" onchange="matInvSet('Au',this.value)"/></div>
    <div><button class="btn btn-ghost w-full text-sm" onclick="matInvClear()">✕ Réinitialiser</button></div>
  </div></div>`;
  const kpi=`<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
    <button type="button" class="card p-3 text-center kpi-clickable" onclick="navigate('materiel/articles')" style="border-top:4px solid #043970"><div class="text-[10px] uppercase font-bold text-slate-500">Articles</div><div class="text-2xl font-black text-amber-700">${totalArticles}</div></button>
    <button type="button" class="card p-3 text-center kpi-clickable" onclick="navigate('materiel/articles')" style="border-top:4px solid #16a34a"><div class="text-[10px] uppercase font-bold text-slate-500">Stock actuel</div><div class="text-2xl font-black text-emerald-700">${qty(totalStock)}</div></button>
    <button type="button" class="card p-3 text-center kpi-clickable" onclick="sessionStorage.setItem('stkPeriode','all');navigate('materiel/mouvements')" style="border-top:4px solid #043970"><div class="text-[10px] uppercase font-bold text-slate-500">Entrées période</div><div class="text-2xl font-black text-sky-700">+${qty(totalEntree)}</div></button>
    <button type="button" class="card p-3 text-center kpi-clickable" onclick="sessionStorage.setItem('stkPeriode','all');navigate('materiel/mouvements')" style="border-top:4px solid #dc2626"><div class="text-[10px] uppercase font-bold text-slate-500">Sorties période</div><div class="text-2xl font-black text-red-700">-${qty(totalSortie)}</div></button>
  </div>`;
  const magSummary=`<div class="card p-4 mb-4"><h3 class="font-bold mb-3">Résumé par magasin</h3><div class="grid grid-cols-1 md:grid-cols-3 gap-3">${Object.values(byMag).map(m=>`<button type="button" onclick="${m.nom==="Sans magasin"?"":`matInvSet('Mag','${Object.keys(byMag).find(k=>byMag[k]===m)}')`}" class="card p-3 text-left hover:shadow transition" style="background:#fff"><div class="font-bold">${escapeHTML(m.nom)}</div><div class="text-xs text-slate-500">${m.nb} article(s)</div><div class="flex justify-between mt-2 text-xs"><span>Stock <b>${qty(m.stock)}</b></span><span class="text-emerald-700">+${qty(m.entree)}</span><span class="text-red-700">-${qty(m.sortie)}</span></div></button>`).join("")||`<div class="text-sm text-slate-400">Aucun magasin.</div>`}</div></div>`;
  const table=`<div class="card overflow-x-auto"><table class="w-full text-sm">
    <thead style="background:#043970"><tr><th class="p-3 text-left">Magasin</th><th class="p-3 text-left">Article</th><th class="p-3 text-left">Catégorie</th><th class="p-3 text-center">Stock actuel</th><th class="p-3 text-center">Entrées période</th><th class="p-3 text-center">Sorties période</th><th class="p-3 text-right">Actions</th></tr></thead>
    <tbody>${rows.map(r=>`<tr class="border-t hover:bg-slate-50 cursor-pointer" onclick="navigate('materiel/article/${r.a.id}')" title="Ouvrir la fiche article">
      <td class="p-3 text-xs">${r.mag?`<a class="hover:underline font-semibold" href="#/materiel/magasin/${r.mag.id}" onclick="event.stopPropagation()">${escapeHTML(r.mag.nom)}</a>`:`<span class="text-slate-400 italic">Sans magasin</span>`}</td>
      <td class="p-3"><a class="font-bold text-amber-700 hover:underline" href="#/materiel/article/${r.a.id}" onclick="event.stopPropagation()">${escapeHTML(r.a.designation||"—")}</a><div class="text-[10px] text-slate-400 font-mono">${escapeHTML(r.a.code||"")}</div></td>
      <td class="p-3 text-xs">${escapeHTML(r.a.categorie||"—")}</td>
      <td class="p-3 text-center font-black text-emerald-700">${qty(r.stock)} <span class="text-[10px] text-slate-400">${escapeHTML(r.a.unite||"")}</span></td>
      <td class="p-3 text-center font-bold text-sky-700">+${qty(r.entree)}</td>
      <td class="p-3 text-center font-bold text-red-700">-${qty(r.sortie)}</td>
      <td class="p-3 text-right"><div class="flex justify-end gap-1 flex-wrap"><button class="btn btn-ghost text-xs" onclick="event.stopPropagation();stockOpenMvt('entree','${r.a.id}')" style="color:#16a34a;border:1px solid #bbf7d0;background:#043970">📥 Entrée</button><button class="btn btn-ghost text-xs" onclick="event.stopPropagation();stockOpenMvt('sortie','${r.a.id}')" style="color:#dc2626;border:1px solid #fecaca;background:#fef2f2">📤 Sortie</button></div></td>
    </tr>`).join("")||`<tr><td colspan="7" class="p-8 text-center text-slate-400">Aucun article dans l'inventaire.</td></tr>`}</tbody>
    <tfoot><tr style="background:#f8fafc;border-top:2px solid #cbd5e1"><td colspan="3" class="p-3 text-right font-bold">TOTAL</td><td class="p-3 text-center font-black text-emerald-700">${qty(totalStock)}</td><td class="p-3 text-center font-bold text-sky-700">+${qty(totalEntree)}</td><td class="p-3 text-center font-bold text-red-700">-${qty(totalSortie)}</td><td></td></tr></tfoot>
  </table></div>`;
  view.innerHTML=header+titleBar+filters+kpi+magSummary+table;
}

function renderMatSimpleMouvements(view){
  const header=matSimpleHeader("mouvements");
  const body=renderStockMvtTab("all");
  view.innerHTML=`${header}<div class="flex justify-between items-center mb-3 flex-wrap gap-2"><div><h1 class="text-2xl font-bold">🔄 Mouvements stock</h1><p class="text-slate-500 text-sm">Historique général des entrées et sorties</p></div><div class="flex gap-2"><button class="btn btn-success text-sm" onclick="stockOpenMvt('entree')">📥 Nouvelle entrée</button><button class="btn btn-secondary text-sm" onclick="stockOpenMvt('sortie')" style="background:#dc2626;color:#fff">📤 Nouvelle sortie</button></div></div>${body}`;
}

async function renderMatSimpleMouvementsServer(view){
  renderMatSimpleMouvements(view);
  try{
    const result=SGDI.stock.movementsPage?await SGDI.stock.movementsPage({page:1,page_size:100}):await SGDI.stock.movements();
    const rows=serverItems(result);
    db.stockMouvements=(rows||[]).map(movementFromApi);
    if(typeof syncMaterialDotationsToEmployeesFromMovements==="function")syncMaterialDotationsToEmployeesFromMovements();
    if(String(location.hash||"").startsWith("#/materiel/mouvements"))renderMatSimpleMouvements(view);
  }catch(e){
    console.warn("Mouvements serveur indisponibles",e);
  }
}

function renderMatSimpleArticles(view){
  const soc=matSimpleSocFilter();
  const arts=matSimpleBySoc(db.stockArticles||[]);
  const mags=db.magasins||[];
  const fours=db.fournisseurs||[];
  const filtCat=document.getElementById("mat-filt-cat")?.value||sessionStorage.getItem("matFiltCat")||"";
  const filtMag=document.getElementById("mat-filt-mag")?.value||sessionStorage.getItem("matFiltMag")||"";
  const filtEtat=document.getElementById("mat-filt-etat")?.value||sessionStorage.getItem("matFiltEtat")||"";
  const cats=[...new Set(arts.map(a=>a.categorie).filter(Boolean))].sort();
  const filtered=arts.filter(a=>{
    if(filtCat&&a.categorie!==filtCat)return false;
    if(filtMag&&(a.magasinId||"")!==filtMag)return false;
    if(filtEtat){
      const etat=stockGetEtat(a).code;
      if(filtEtat==="rupture"&&etat!=="rupture")return false;
      if(filtEtat==="alerte"&&etat!=="alerte"&&etat!=="min")return false;
      if(filtEtat==="ok"&&etat!=="ok")return false;
    }
    return true;
  });
  const header=matSimpleHeader("articles");
  const titleBar=`<div class="flex justify-between items-center mb-3"><div><h1 class="text-2xl font-bold" style="text-transform:uppercase">📦 ARTICLES</h1><p class="text-slate-500 text-sm" style="text-transform:uppercase">${filtered.length} article(s) · ${soc||"Toutes sociétés"}</p></div>
    <div class="flex gap-2"><button class="btn btn-warn" onclick="navigate('materiel/article-nouveau')">➕ Nouvel article</button></div></div>`;
  const filters=`<div class="card p-3 mb-3 flex flex-wrap gap-2 items-center" style="background:#f8fafc">
    <select class="select text-sm" id="mat-filt-cat" onchange="matSimpleFilterArticles()" style="max-width:200px"><option value="">Toutes catégories</option>${cats.map(c=>`<option ${filtCat===c?"selected":""}>${escapeHTML(c)}</option>`).join("")}</select>
    <select class="select text-sm" id="mat-filt-mag" onchange="matSimpleFilterArticles()" style="max-width:200px"><option value="">Tous magasins</option>${mags.map(m=>`<option value="${m.id}" ${filtMag===m.id?"selected":""}>${escapeHTML(m.nom)}</option>`).join("")}</select>
    <select class="select text-sm" id="mat-filt-etat" onchange="matSimpleFilterArticles()" style="max-width:160px"><option value="">Tous états</option><option value="ok" ${filtEtat==="ok"?"selected":""}>✓ OK</option><option value="alerte" ${filtEtat==="alerte"?"selected":""}>🟡 Alerte</option><option value="rupture" ${filtEtat==="rupture"?"selected":""}>🔴 Rupture</option></select>
    <button class="btn btn-ghost text-xs" onclick="matSimpleClearFilters()">✕ Effacer filtres</button>
  </div>`;
  const tableHTML=filtered.length===0?`<div class="card p-10 text-center"><div class="text-4xl mb-2">📭</div><div class="text-slate-500 mb-3">Aucun article ${arts.length===0?"au catalogue":"correspondant aux filtres"}.</div>${arts.length===0?`<button class="btn btn-warn" onclick="navigate('materiel/article-nouveau')">➕ Créer le premier article</button>`:""}</div>`:`<div class="card overflow-x-auto"><table class="w-full text-sm">
    <thead style="background:#043970"><tr><th class="p-3 text-left">Code</th><th class="p-3 text-left">Désignation</th><th class="p-3 text-left">Catégorie</th><th class="p-3 text-left">Magasin</th><th class="p-3 text-center">Stock</th><th class="p-3 text-right">P.U.</th><th class="p-3 text-center">État</th><th class="p-3 text-right">Actions</th></tr></thead>
    <tbody>${filtered.map(a=>{
      const q=typeof stockGetActuel==="function"?stockGetActuel(a.id):(parseFloat(a.stockInitial)||0);
      const stockEtat=stockGetEtat(a);
      const etat=stockEtat.code==="rupture"?{c:"#dc2626",bg:"#fef2f2",l:"🔴 Rupture"}:((stockEtat.code==="alerte"||stockEtat.code==="min")?{c:"#b45309",bg:"#fffbeb",l:"🟡 Alerte"}:{c:"#16a34a",bg:"#f0fdf4",l:"✓ OK"});
      const rowBg=stockEtat.code==="rupture"?"#fef2f2":((stockEtat.code==="alerte"||stockEtat.code==="min")?"#fffbeb":"");
      const mag=mags.find(m=>m.id===a.magasinId);
      return`<tr class="border-t hover:bg-slate-50" style="${rowBg?"background:"+rowBg:""}">`+`
        <td class="p-3 font-mono text-xs">${escapeHTML(a.code||"—")}</td>
        <td class="p-3"><a class="font-bold text-amber-700 hover:underline" href="#/materiel/article/${a.id}">${escapeHTML(a.designation||"—")}</a><div class="text-[10px] text-slate-400">${escapeHTML(a.marque||"")}${a.modele?" · "+escapeHTML(a.modele):""}</div></td>
        <td class="p-3 text-xs">${escapeHTML(a.categorie||"—")}</td>
        <td class="p-3 text-xs">${mag?`<a class="hover:underline" href="#/materiel/magasin/${mag.id}">${mag.icon||"🏬"} ${escapeHTML(mag.nom)}</a>`:`<span class="text-slate-400 italic">—</span>`}</td>
        <td class="p-3 text-center"><div class="font-black" style="color:${etat.c}">${qty(q)}</div><div class="text-[10px] text-slate-400">${escapeHTML(a.unite||"")}</div></td>
        <td class="p-3 text-right text-xs font-semibold">${money(a.prixUnitaire)}</td>
        <td class="p-3 text-center"><span class="pill" style="background:${etat.bg};color:${etat.c};border:1px solid ${etat.c}55;font-size:10px;font-weight:700">${etat.l}</span></td>
        <td class="p-3 text-right">
          <div class="flex gap-1 justify-end flex-wrap">
            <button class="btn btn-ghost text-xs" title="Entrée" onclick="stockOpenMvt('entree','${a.id}')" style="color:#16a34a;border:1px solid #bbf7d0;background:#043970">📥 Entrée</button>
            <button class="btn btn-ghost text-xs" title="Sortie" onclick="stockOpenMvt('sortie','${a.id}')" style="color:#dc2626;border:1px solid #fecaca;background:#fef2f2">📤 Sortie</button>
            <button class="btn btn-ghost text-xs" title="Modifier" onclick="navigate('materiel/article-edit/${a.id}')" style="border:1px solid #cbd5e1;background:#f8fafc">✏ Modifier</button>
          </div>
        </td>
      </tr>`}).join("")}</tbody></table></div>`;
  view.innerHTML=header+titleBar+filters+tableHTML;
  if(sgdiAuthToken()&&!window.__sgdiMatArticlesLocalFallback&&!window.__sgdiMatArticlesBgRefreshing){
    window.__sgdiMatArticlesBgRefreshing=true;
    const _h=location.hash;
    SGDI.stock.articlesPage({society:soc||undefined,page:1,page_size:25}).then(result=>{
      const arts=serverItems(result).map(articleFromApi);
      if((result?.total??arts.length)===0){if(soc)db.stockArticles=(db.stockArticles||[]).filter(a=>a.societe&&a.societe!==soc);else db.stockArticles=[];}
      else{arts.forEach(a=>sgdiUpsertServerItem("stockArticles",a));const freshIds=new Set(arts.map(a=>String(a.backendId||"")));db.stockArticles=(db.stockArticles||[]).filter(a=>!a.backendId||(soc&&a.societe&&a.societe!==soc)||freshIds.has(String(a.backendId||"")));}
      if(location.hash===_h){renderMatSimpleArticles(view);}
      window.__sgdiMatArticlesBgRefreshing=false;
    }).catch(e=>{window.__sgdiMatArticlesBgRefreshing=false;window.__sgdiMatArticlesLocalFallback=true;console.warn("Articles bg refresh:",e);});
  }
}

function matSimpleFilterArticles(){
  const c=document.getElementById("mat-filt-cat")?.value||"";
  const m=document.getElementById("mat-filt-mag")?.value||"";
  const e=document.getElementById("mat-filt-etat")?.value||"";
  sessionStorage.setItem("matFiltCat",c);
  sessionStorage.setItem("matFiltMag",m);
  sessionStorage.setItem("matFiltEtat",e);
  render();
}

function matSimpleClearFilters(){
  sessionStorage.removeItem("matFiltCat");
  sessionStorage.removeItem("matFiltMag");
  sessionStorage.removeItem("matFiltEtat");
  render();
}

function renderMatSimpleMagasins(view){
  const soc=matSimpleSocFilter();
  const mags=matSimpleBySoc(db.magasins||[]).slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||""));
  const header=matSimpleHeader("magasins");
  const titleBar=`<div class="flex justify-between items-center mb-3 flex-wrap gap-2"><div><h1 class="text-2xl font-bold" style="text-transform:uppercase">🏬 MAGASINS</h1><p class="text-slate-500 text-sm" style="text-transform:uppercase">${mags.length} magasin(s) · ${soc||"Toutes sociétés"}</p></div>
    <div class="flex gap-2 flex-wrap"><button class="btn btn-secondary" onclick="openMagasinPickerModal('config')">⚙ Configurer</button><button class="btn btn-secondary" onclick="openMagasinPickerModal('edit')">✏ Modifier</button><button class="btn btn-warn" onclick="navigate('materiel/magasin-nouveau')">➕ Nouveau</button></div></div>`;
  const body=mags.length===0?`<div class="card p-10 text-center"><div class="text-4xl mb-2">🏬</div><div class="text-slate-500 mb-3">Aucun magasin créé. Créez-en un pour répartir le stock.</div><button class="btn btn-warn" onclick="navigate('materiel/magasin-nouveau')">➕ Créer le premier magasin</button></div>`:`<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">${mags.map(m=>{const st=matSimpleStockMagasin(m.id);return`<div class="card p-5 cursor-pointer hover:shadow-lg transition" style="border-top:4px solid ${m.color||"#8b5cf6"}" onclick="navigate('materiel/magasin/${m.id}')">
    <div class="flex justify-between items-start mb-2">
      <div class="flex gap-3 items-center"><div style="font-size:32px;width:42px;height:42px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:10px;background:#f8fafc">${m.iconImage?`<img src="${m.iconImage}" style="width:100%;height:100%;object-fit:cover"/>`:(m.icon||"🏬")}</div><div><h3 class="${matSimpleMagasinTitleClass(m.nom)}">${escapeHTML(m.nom)}</h3>${m.code?`<div class="text-[10px] font-mono text-slate-500">${escapeHTML(m.code)}</div>`:""}${dotationMagasinType(m)?`<div class="text-[10px] font-black text-blue-700 uppercase">${escapeHTML(dotationMagasinType(m))}</div>`:""}</div></div>
    </div>
    ${m.adresse?`<div class="text-xs text-slate-500 mb-1">📍 ${escapeHTML(m.adresse)}</div>`:""}
    ${m.responsable?`<div class="text-xs text-slate-500 mb-1">👤 ${escapeHTML(m.responsable)}${m.telephone?` · ☎ ${escapeHTML(m.telephone)}`:""}</div>`:(m.telephone?`<div class="text-xs text-slate-500 mb-1">☎ ${escapeHTML(m.telephone)}</div>`:"")}
    ${m.societe?`<div class="text-xs"><span class="pill" style="background:#f1f5f9;color:#475569;font-size:10px">${escapeHTML(m.societe)}</span></div>`:""}
    <div class="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100 text-center">
      <div><div class="text-[9px] uppercase font-bold text-slate-500">Articles</div><div class="text-lg font-black">${st.nb}</div></div>
      <div><div class="text-[9px] uppercase font-bold text-slate-500">Unités</div><div class="text-lg font-black text-emerald-700">${qty(st.qty)}</div></div>
    </div>
    <div class="text-[10px] text-slate-400 mt-2 text-center">Seuil bas : ${qty(st.seuilBas)} · Critique : ${qty(st.seuilCritique)}</div>
    ${st.alertes>0?`<div class="text-[10px] text-red-600 font-bold mt-2 text-center">⚠ ${st.alertes} alerte(s) stock</div>`:""}
  </div>`}).join("")}</div>`;
  view.innerHTML=header+titleBar+body;
  if(sgdiAuthToken()&&!window.__sgdiMatMagasinsLocalFallback&&!window.__sgdiMatMagasinsBgRefreshing){
    window.__sgdiMatMagasinsBgRefreshing=true;
    const _h=location.hash;
    Promise.all([
      SGDI.stock.storesPage({society:soc||undefined,page:1,page_size:18}),
      (SGDI.stock.articlesPage?SGDI.stock.articlesPage({society:soc||undefined,page:1,page_size:100}).then(serverItems):SGDI.stock.articles(soc?{society:soc}:{})).catch(()=>[])
    ]).then(([result,articlesRes])=>{
      if(Array.isArray(articlesRes)&&articlesRes.length){articlesRes.map(articleFromApi).forEach(a=>sgdiUpsertServerItem("stockArticles",a));const freshArtIds=new Set(articlesRes.map(r=>String(r.id||"")));db.stockArticles=(db.stockArticles||[]).filter(a=>!a.backendId||(soc&&a.societe&&a.societe!==soc)||freshArtIds.has(String(a.backendId||"")));}
      const freshMags=serverItems(result).map(storeFromApi);freshMags.forEach(m=>sgdiUpsertServerItem("magasins",m));const freshIds=new Set(freshMags.map(m=>String(m.backendId||"")));db.magasins=(db.magasins||[]).filter(m=>!m.backendId||(soc&&m.societe&&m.societe!==soc)||freshIds.has(String(m.backendId||"")));
      if(location.hash===_h){renderMatSimpleMagasins(view);}
      window.__sgdiMatMagasinsBgRefreshing=false;
    }).catch(e=>{window.__sgdiMatMagasinsBgRefreshing=false;window.__sgdiMatMagasinsLocalFallback=true;console.warn("Magasins bg refresh:",e);});
  }
}

function renderMatSimpleMagasinForm(view,id){
  const isNew=!id;
  let m=isNew?{id:uid("mag"),nom:"",code:"",typeMagasin:"",adresse:"",responsable:"",telephone:"",email:"",societe:matSimpleSocFilter()||"",icon:"🏬",iconImage:"",color:"#8b5cf6",notes:""}:(db.magasins||[]).find(x=>x.id===id);
  if(!m){toast("Magasin introuvable","error");return navigate("materiel/magasins")}
  const icons=["🏬","🏪","📦","🧥","🥾","⛑","🪖","🛡","📡","🔧","⚙","💡","🚗","🏗","🧰","🗄"];
  const sousCategories=Array.isArray(m.sousCategories)?m.sousCategories:(Array.isArray(m.config?.sousCategories)?m.config.sousCategories:[]);
  view.innerHTML=`<div class="max-w-3xl mx-auto">
    <div class="flex justify-between mb-4"><div><h1 class="text-2xl font-bold">${isNew?"➕ Nouveau magasin":"✏ Modifier magasin"}</h1><p class="text-slate-500 text-sm">Lieu de stockage</p></div><button class="btn btn-ghost" onclick="navigate('materiel/magasins')">← Retour magasins</button></div>
    <form id="magasin-form-simple" class="card p-6">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
        <div><label class="label">Nom du magasin *</label><input class="input" name="nom" value="${escapeHTML(m.nom||"")}"  placeholder="ex: Magasin central Alger"/></div>
        <div><label class="label">Code interne</label><input class="input font-mono" name="code" value="${escapeHTML(m.code||"")}" placeholder="ex: MAG-ALG-01"/></div>
      </div>
      <div class="mb-3"><label class="label">Sous-catégories / familles</label><textarea class="input" name="sousCategories" rows="3" placeholder="Une famille par ligne : Chandail, Pantalon, Rangers...">${escapeHTML(sousCategories.join("\n"))}</textarea></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
        <div><label class="label">Société</label><select class="select" name="societe"><option value="">— Aucune (toutes) —</option>${SOCIETES.map(s=>`<option ${m.societe===s?"selected":""}>${s}</option>`).join("")}</select></div>
        <div><label class="label">Adresse</label><input class="input" name="adresse" value="${escapeHTML(m.adresse||"")}" placeholder="ex: 12 rue X, Alger"/></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
        <div><label class="label">Responsable</label><input class="input" name="responsable" value="${escapeHTML(m.responsable||"")}" placeholder="Nom complet"/></div>
        <div><label class="label">Téléphone</label><input class="input" name="telephone" value="${escapeHTML(m.telephone||"")}" placeholder="0X XX XX XX XX"/></div>
        <div><label class="label">E-mail</label><input class="input" type="email" name="email" value="${escapeHTML(m.email||"")}" placeholder="contact@..."/></div>
      </div>
      <div class="mb-3"><label class="label">Icône du magasin</label>
        <input type="hidden" name="iconImage" id="mag-icon-image" value="${escapeHTML(m.iconImage||"")}"/>
        <div class="flex items-center gap-3 mb-3">
          <div id="mag-icon-preview" data-preserve-emoji="1" style="width:72px;height:72px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:32px">${m.iconImage?`<img src="${m.iconImage}" style="width:100%;height:100%;object-fit:cover"/>`:(m.icon||"🏬")}</div>
          <div class="flex gap-2 flex-wrap"><input id="mag-icon-file" type="file" accept="image/*" class="hidden" onchange="handleMagasinIconUpload(this)"/><button type="button" class="btn btn-secondary text-xs" onclick="document.getElementById('mag-icon-file').click()">⬆ Télécharger icône</button><button type="button" class="btn btn-ghost text-xs" onclick="removeMagasinIcon()">🗑 Retirer image</button></div>
        </div>
        <div class="text-xs text-slate-500 mb-2">Choisissez une icône ou téléversez une image.</div>
        <div class="flex flex-wrap gap-2" data-preserve-emoji="1">${icons.map(ic=>`<label class="cursor-pointer inline-flex items-center justify-center" style="width:42px;height:42px;border-radius:10px;border:2px solid ${m.icon===ic&&!m.iconImage?m.color||"#8b5cf6":"#e2e8f0"};background:${m.icon===ic&&!m.iconImage?(m.color||"#8b5cf6")+"22":"#fff"};font-size:22px"><input type="radio" name="icon" value="${ic}" ${m.icon===ic?"checked":""} class="hidden" onchange="selectMagasinIcon('${ic}')"/>${ic}</label>`).join("")}</div>
      </div>
      <div class="mb-4"><label class="label">Notes</label><textarea class="input" name="notes" rows="2">${escapeHTML(m.notes||"")}</textarea></div>
      <div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="navigate('materiel/magasins')">✕ Annuler</button><button type="submit" id="magasin-simple-save-btn" class="btn btn-warn" onclick="event.preventDefault();matSimpleSaveMagasin('${m.id}',${isNew?"true":"false"})">💾 Enregistrer</button></div>
    </form>
  </div>`;
  setTimeout(()=>{const f=document.getElementById("magasin-form-simple");if(f)f.addEventListener("submit",e=>{e.preventDefault();matSimpleSaveMagasin(m.id,isNew)});},0);
}

function stockStartArticleForMagasin(magasinId){
  const m=(db.magasins||[]).find(x=>String(x.id)===String(magasinId));
  if(!m){toast("Magasin introuvable","error");return}
  sessionStorage.setItem("stockArticlePreselectMagasinId",String(m.id));
  navigate("materiel/article-nouveau");
}

async function matSimpleSaveMagasin(id,isNew){
  try{
    const f=document.getElementById("magasin-form-simple");
    if(!f){toast("Formulaire introuvable","error");return}
    const fd=new FormData(f);
    const nom=(fd.get("nom")||"").trim();
    if(!nom){toast("Nom du magasin obligatoire","error");return}
    const typeMagasin="";
    const sousCategories=String(fd.get("sousCategories")||"").split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean);
    const obj={id,nom,code:(fd.get("code")||"").trim(),typeMagasin,sousCategories,adresse:(fd.get("adresse")||"").trim(),responsable:(fd.get("responsable")||"").trim(),telephone:(fd.get("telephone")||"").trim(),email:(fd.get("email")||"").trim(),societe:fd.get("societe")||matSimpleSocFilter()||mySoc()||"",icon:fd.get("icon")||"🏬",iconImage:fd.get("iconImage")||"",notes:fd.get("notes")||""};
    if(!db.magasins)db.magasins=[];
    let idx=-1;
    if(isNew){obj.color="#8b5cf6";obj.createdAt=new Date().toISOString()}
    else{idx=db.magasins.findIndex(x=>x.id===id);if(idx<0){toast("Magasin introuvable","error");return}Object.assign(obj,{...db.magasins[idx],...obj})}
    try{await persistStoreToPostgres(obj)}catch(e){toast("Magasin non sauvegardé : "+(e.message||e),"error");return}
    if(isNew)db.magasins.push(obj);else db.magasins[idx]=obj;
    if(typeof logActivity==="function")logActivity(isNew?"Création magasin":"Modification magasin",nom);
    try{
      sgdiDirty=true;
      await sgdiBackendSaveAndWait();
    }catch(e){
      toast("Magasin créé, mais synchronisation globale PostgreSQL incomplète : "+(e.message||e),"warning");
      return;
    }
    toast(isNew?"Magasin créé":"Magasin mis à jour","success");
    if(isAdminSystemSession())await sgdiRefreshAdminMaterialNow({render:false});
    navigate("materiel/magasins");
  }catch(err){console.error(err);toast("Erreur: "+(err.message||err),"error")}
}

function openMagasinPickerModal(action){
  const soc=matSimpleSocFilter();
  const mags=matSimpleBySoc(db.magasins||[]).slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||""));
  if(!mags.length){toast("Aucun magasin disponible","info");return}
  const title=action==="config"?"⚙ Configurer un magasin":"✏ Modifier un magasin";
  const btnLabel=action==="config"?"Configurer":"Modifier";
  const onSelect=action==="config"
    ?`closeModal();openMagasinConfigurationModal(this.dataset.id)`
    :`closeModal();navigate('materiel/magasin-edit/'+this.dataset.id)`;
  openModal(`<h3 class="font-bold text-lg mb-4">${title}</h3>
    <div class="flex flex-col gap-2" style="max-height:60vh;overflow-y:auto">
      ${mags.map(m=>`<button type="button" data-id="${escapeHTML(m.id)}"
        onclick="${onSelect}"
        class="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-blue-50 hover:border-blue-300 text-left transition w-full">
        <div style="font-size:24px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#f1f5f9;flex-shrink:0">
          ${m.iconImage?`<img src="${escapeHTML(m.iconImage)}" style="width:100%;height:100%;object-fit:cover;border-radius:6px"/>`:(m.icon||"🏬")}
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-bold truncate">${escapeHTML(m.nom||"—")}</div>
          <div class="text-xs text-slate-500">${escapeHTML(m.societe||"Toutes sociétés")}${m.code?` · ${escapeHTML(m.code)}`:""}</div>
        </div>
        <span class="btn btn-secondary text-xs flex-shrink-0">${btnLabel}</span>
      </button>`).join("")}
    </div>
    <div class="flex justify-end mt-4"><button class="btn btn-ghost" onclick="closeModal()">Annuler</button></div>`);
}

function openMagasinConfigurationModal(id){
  const m=(db.magasins||[]).find(x=>String(x.id)===String(id));
  if(!m){toast("Magasin introuvable","error");return}
  const cfg=magasinConfig(m);
  openModal(`<h3 class="font-bold text-lg mb-1">Configuration — ${escapeHTML(m.nom||"Magasin")}</h3>
    <p class="text-sm text-slate-500 mb-4">Paramètres de stock et alertes pour ce magasin.</p>
    <form id="magasin-config-form" onsubmit="event.preventDefault();saveMagasinConfiguration('${id}')">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="label">Seuil stock bas</label>
          <input class="input" type="number" min="0" step="1" name="seuilBas" value="${escapeHTML(String(cfg.seuilBas))}" placeholder="ex: 5"/>
          <div class="text-xs text-slate-400 mt-1">Alerte jaune quand le stock descend sous ce seuil.</div>
        </div>
        <div>
          <label class="label">Seuil critique / rupture</label>
          <input class="input" type="number" min="0" step="1" name="seuilCritique" value="${escapeHTML(String(cfg.seuilCritique))}" placeholder="ex: 2"/>
          <div class="text-xs text-slate-400 mt-1">Alerte rouge — rupture imminente.</div>
        </div>
        <div>
          <label class="label">Unité par défaut</label>
          <input class="input" name="uniteDefaut" value="${escapeHTML(cfg.uniteDefaut)}" placeholder="Pièce, paire, lot..."/>
          <div class="text-xs text-slate-400 mt-1">Pré-remplie dans les formulaires de mouvement.</div>
        </div>
        <div>
          <label class="label">Valorisation du stock</label>
          <select class="select" name="valorisation">
            <option value="prix_unitaire" ${cfg.valorisation==="prix_unitaire"?"selected":""}>Prix unitaire article</option>
            <option value="dernier_achat" ${cfg.valorisation==="dernier_achat"?"selected":""}>Dernier prix d'achat</option>
            <option value="manuel" ${cfg.valorisation==="manuel"?"selected":""}>Manuelle</option>
          </select>
          <div class="text-xs text-slate-400 mt-1">Méthode de calcul de la valeur du stock.</div>
        </div>
        <div class="md:col-span-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="alertesActives" ${cfg.alertesActives?"checked":""} style="width:16px;height:16px"/>
            <span class="font-semibold text-sm">Activer les alertes de seuil pour ce magasin</span>
          </label>
          <div class="text-xs text-slate-400 mt-1">Les compteurs d'alertes apparaissent dans le tableau de bord matériel.</div>
        </div>
        <div class="md:col-span-2 pt-2 border-t border-slate-100">
          <div class="label mb-2">Champs actifs sur les articles de ce magasin</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label class="flex items-start gap-2 cursor-pointer p-3 rounded-lg border border-slate-200 hover:bg-slate-50">
              <input type="checkbox" name="avecQuantite" ${cfg.avecQuantite?"checked":""} style="width:16px;height:16px;margin-top:2px"/>
              <div>
                <div class="font-semibold text-sm">Quantité</div>
                <div class="text-xs text-slate-400">Suivi du stock en unités. Requis pour les entrées/sorties.</div>
              </div>
            </label>
            <label class="flex items-start gap-2 cursor-pointer p-3 rounded-lg border border-slate-200 hover:bg-slate-50">
              <input type="checkbox" name="avecTaille" ${cfg.avecTaille?"checked":""} style="width:16px;height:16px;margin-top:2px"/>
              <div>
                <div class="font-semibold text-sm">Taille</div>
                <div class="text-xs text-slate-400">Champs taille, pointure, etc. Recommandé pour habillement.</div>
              </div>
            </label>
            <label class="flex items-start gap-2 cursor-pointer p-3 rounded-lg border border-slate-200 hover:bg-slate-50">
              <input type="checkbox" name="avecPrix" ${cfg.avecPrix?"checked":""} style="width:16px;height:16px;margin-top:2px"/>
              <div>
                <div class="font-semibold text-sm">Prix unitaire</div>
                <div class="text-xs text-slate-400">Affiche et calcule la valorisation des articles.</div>
              </div>
            </label>
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-2 mt-5">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>
        <button class="btn btn-primary">💾 Enregistrer</button>
      </div>
    </form>`);
}

function magasinConfigSousCategorieHTML(magasinId,selectedArticleId){
  const articles=(db.stockArticles||[]).filter(a=>String(a.magasinId||"")===String(magasinId||""));
  if(!magasinId)return `<select class="select text-slate-400" name="sousCategorieArticleId" disabled><option value="">Choisissez d'abord un magasin</option></select>`;
  if(!articles.length)return `<select class="select text-slate-400" name="sousCategorieArticleId" disabled><option value="">Aucun article dans ce magasin</option></select>`;
  return `<select class="select" name="sousCategorieArticleId"><option value="">Tous les articles du magasin</option>${articles.map(a=>`<option value="${escapeHTML(a.id)}" ${String(a.id)===String(selectedArticleId||"")?"selected":""}>${escapeHTML((a.code?`${a.code} · `:"")+(a.designation||a.sousCategorie||"Article"))}</option>`).join("")}</select>`;
}

function magasinConfigCategorieChanged(magasinId){
  const box=document.getElementById("magasin-config-subcat");
  if(box)box.innerHTML=magasinConfigSousCategorieHTML(magasinId,"");
}

async function saveMagasinConfiguration(id){
  const m=(db.magasins||[]).find(x=>String(x.id)===String(id));
  const f=document.getElementById("magasin-config-form");
  if(!m||!f){toast("Configuration magasin introuvable","error");return}
  const fd=new FormData(f);
  const seuilBas=Math.max(parseFloat(fd.get("seuilBas"))||0,0);
  const seuilCritique=Math.max(parseFloat(fd.get("seuilCritique"))||0,0);
  m.config={
    ...(m.config||{}),
    seuilBas,
    seuilCritique,
    uniteDefaut:String(fd.get("uniteDefaut")||"Pièce").trim()||"Pièce",
    valorisation:String(fd.get("valorisation")||"prix_unitaire"),
    alertesActives:fd.get("alertesActives")?"1":"0",
    avecQuantite:fd.get("avecQuantite")?"1":"0",
    avecTaille:fd.get("avecTaille")?"1":"0",
    avecPrix:fd.get("avecPrix")?"1":"0",
  };
  m.seuilStockBas=seuilBas;
  m.seuilStockCritique=seuilCritique;
  m.uniteDefaut=m.config.uniteDefaut;
  m.valorisationStock=m.config.valorisation;
  m.alertesStockActives=m.config.alertesActives;
  if(!m.societe)m.societe=matSimpleSocFilter()||mySoc()||session?.societe||"";
  m.updatedAt=new Date().toISOString();
  try{await persistStoreToPostgres(m)}catch(e){toast("Configuration non sauvegardée : "+(e.message||e),"error");return}
  closeModal();
  toast("Configuration magasin enregistrée","success");
  if(isAdminSystemSession())await sgdiRefreshAdminMaterialNow({render:false});
  renderView();
}

function selectMagasinIcon(icon){
  removeMagasinIcon(false);
  const p=document.getElementById("mag-icon-preview");
  if(p)p.innerHTML=icon;
}

function handleMagasinIconUpload(input){
  const f=input&&input.files&&input.files[0];if(!f)return;
  if(f.size>2*1024*1024){toast("Icône > 2 Mo","error");return}
  const r=new FileReader();
  r.onload=async e=>{
    const img=await compressImage(e.target.result,256,0.78);
    const h=document.getElementById("mag-icon-image");if(h)h.value=img;
    const p=document.getElementById("mag-icon-preview");if(p)p.innerHTML=`<img src="${img}" style="width:100%;height:100%;object-fit:cover"/>`;
    toast("Icône téléchargée","success");
  };
  r.readAsDataURL(f);
}

function removeMagasinIcon(showToast=true){
  const h=document.getElementById("mag-icon-image");if(h)h.value="";
  if(showToast){
    const checked=document.querySelector('[name="icon"]:checked')?.value||"🏬";
    const p=document.getElementById("mag-icon-preview");if(p)p.innerHTML=checked;
    toast("Image retirée","success");
  }
}

async function renderMatSimpleMagasinDetail(view,id){
  const m=(db.magasins||[]).find(x=>x.id===id);
  if(!m){view.innerHTML=`<div class="card p-6">Magasin introuvable. <a href="#/materiel/magasins" class="text-amber-600 underline">← Retour</a></div>`;return}
  sgdiShowDataLoadingBar("Chargement du magasin...");
  if(sgdiAuthToken()&&window.SGDI?.stock?.articles&&m.backendId){
    try{
      const rows=await SGDI.stock.articles({store_id:m.backendId});
      (rows||[]).map(articleFromApi).forEach(a=>sgdiUpsertServerItem("stockArticles",a));
    }catch(e){
      console.warn("Articles du magasin PostgreSQL indisponibles",e);
    }
    try{
      const movements=await SGDI.stock.movements();
      db.stockMouvements=(movements||[]).map(movementFromApi);
      if(typeof syncMaterialDotationsToEmployeesFromMovements==="function")syncMaterialDotationsToEmployeesFromMovements();
    }catch(e){
      console.warn("Mouvements du magasin PostgreSQL indisponibles",e);
    }
  }
  const arts=(db.stockArticles||[]).filter(a=>stockArticleBelongsToStore(a,m));
  const st=matSimpleStockMagasin(id);
  const articleRefs=arts.reduce((set,a)=>{stockArticleRefs(a).forEach(ref=>set.add(ref));return set},new Set());
  const storeMvts=(db.stockMouvements||[]).filter(mv=>articleRefs.has(String(mv.articleId||""))||articleRefs.has(String(mv.articleBackendId||""))).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||"").localeCompare(a.createdAt||""));
  const mvts=storeMvts.slice(0,20);
  view.innerHTML=`<div class="flex justify-between mb-4">
    <div><h1 class="text-2xl font-bold">${m.icon||"🏬"} ${escapeHTML(m.nom)}</h1><p class="text-slate-500 text-sm">${escapeHTML(m.societe||"Tous")} ${m.code?` · <span class="font-mono">${escapeHTML(m.code)}</span>`:""}</p></div>
    <div class="flex gap-2"><a href="#/materiel/magasins" class="btn btn-ghost">← Magasins</a><button class="btn btn-secondary" onclick="openMagasinConfigurationModal('${m.id}')">Configuration</button><button class="btn btn-warn" onclick="navigate('materiel/magasin-edit/${m.id}')">✏ Modifier</button></div>
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
    <div class="card p-5 lg:col-span-1">
      <h3 class="font-bold mb-3">📋 Informations</h3>
      <div class="space-y-2 text-sm">
        ${dotationMagasinType(m)?`<div><span class="text-slate-500 text-xs uppercase">Type magasin</span><div class="font-semibold text-blue-800">${escapeHTML(dotationMagasinType(m))}</div></div>`:""}
        ${m.adresse?`<div><span class="text-slate-500 text-xs uppercase">Adresse</span><div>${escapeHTML(m.adresse)}</div></div>`:""}
        ${m.responsable?`<div><span class="text-slate-500 text-xs uppercase">Responsable</span><div class="font-semibold">${escapeHTML(m.responsable)}</div></div>`:""}
        ${m.telephone?`<div><span class="text-slate-500 text-xs uppercase">Téléphone</span><div class="font-mono">${escapeHTML(m.telephone)}</div></div>`:""}
        ${m.email?`<div><span class="text-slate-500 text-xs uppercase">E-mail</span><div>${escapeHTML(m.email)}</div></div>`:""}
        ${m.notes?`<div><span class="text-slate-500 text-xs uppercase">Notes</span><div class="text-slate-700">${escapeHTML(m.notes)}</div></div>`:""}
      </div>
    </div>
    <div class="card p-5 lg:col-span-2">
      <h3 class="font-bold mb-3">📊 Stock du magasin</h3>
      <div class="grid grid-cols-2 gap-3 mb-3 text-center">
        <div class="p-3 rounded" style="background:#043970"><div class="text-[10px] uppercase font-bold text-slate-500">Articles</div><div class="text-2xl font-black text-amber-700">${st.nb}</div></div>
        <div class="p-3 rounded" style="background:#043970"><div class="text-[10px] uppercase font-bold text-slate-500">Unités</div><div class="text-2xl font-black text-emerald-700">${qty(st.qty)}</div></div>
      </div>
      <div class="text-xs text-slate-500 mb-2">Seuil stock bas : <b>${qty(st.seuilBas)}</b> · seuil critique : <b>${qty(st.seuilCritique)}</b></div>
      ${st.alertes>0?`<div class="text-sm text-red-600 font-bold">⚠ ${st.alertes} article(s) en alerte ou rupture</div>`:""}
    </div>
  </div>
  <div class="card p-5 mb-4">
    <div class="flex justify-between items-center mb-3"><h3 class="font-bold">📦 Articles du magasin (${arts.length})</h3><button class="btn btn-warn text-sm" onclick="stockStartArticleForMagasin('${m.id}')">➕ Ajouter article</button></div>
    ${arts.length===0?`<div class="text-sm text-slate-400 italic py-6 text-center">Aucun article rattaché à ce magasin.</div>`:`<div class="overflow-x-auto"><table class="w-full text-sm"><thead style="background:#f8fafc"><tr><th class="p-2 text-left">Code</th><th class="p-2 text-left">Désignation</th><th class="p-2 text-center">Stock</th><th class="p-2 text-right">P.U.</th><th class="p-2 text-right">Actions</th></tr></thead><tbody>${arts.map(a=>{const q=stockGetActuel(a.id);return`<tr class="border-t hover:bg-slate-50"><td class="p-2 font-mono text-xs">${escapeHTML(a.code||"—")}</td><td class="p-2"><a class="hover:underline font-semibold" href="#/materiel/article/${a.id}">${escapeHTML(a.designation)}</a></td><td class="p-2 text-center font-bold">${qty(q)} <span class="text-[10px] text-slate-400">${escapeHTML(a.unite||"")}</span></td><td class="p-2 text-right text-xs">${money(a.prixUnitaire)}</td><td class="p-2 text-right"><div class="flex gap-1 justify-end"><button class="btn btn-ghost text-xs" onclick="navigate('materiel/article-edit/${a.id}')">✏ Modifier</button><button class="btn btn-ghost text-xs text-red-600" onclick="stockDeleteArticle('${a.id}')">🗑 Supprimer</button></div></td></tr>`}).join("")}</tbody></table></div>`}
  </div>
  ${stockStoreHistoryCountersHTML(storeMvts)}
  <div class="card p-5">
    <h3 class="font-bold mb-3">📜 Derniers mouvements (20)</h3>
    ${mvts.length===0?`<div class="text-sm text-slate-400 italic py-6 text-center">Aucun mouvement.</div>`:`<div class="overflow-x-auto"><table class="w-full text-sm"><thead style="background:#f8fafc"><tr><th class="p-2 text-left">Heure / Date</th><th class="p-2 text-left">Type</th><th class="p-2 text-left">Article</th><th class="p-2 text-right">Qté</th><th class="p-2 text-left">Motif</th></tr></thead><tbody>${mvts.map(mv=>{const a=stockFindArticleByRef(mv.articleId)||stockFindArticleByRef(mv.articleBackendId)||arts.find(x=>stockArticleRefs(x).has(String(mv.articleId||""))||stockArticleRefs(x).has(String(mv.articleBackendId||"")));const sign=stockMvtIsIn(mv.type)?"+":"-";const c=stockMvtIsIn(mv.type)?"#16a34a":"#dc2626";return`<tr class="border-t"><td class="p-2 text-xs font-mono">${stockMovementDateTimeLabel(mv)}</td><td class="p-2 text-xs"><span class="pill" style="background:${c}22;color:${c};font-size:10px">${escapeHTML(stockMvtTypeLabel(mv.type)||mv.type||"")}</span></td><td class="p-2 text-xs">${a?escapeHTML(a.designation):"—"}</td><td class="p-2 text-right font-bold" style="color:${c}">${sign}${qty(mv.quantite)}</td><td class="p-2 text-xs text-slate-500">${escapeHTML(mv.motif||"")}</td></tr>`}).join("")}</tbody></table></div>`}
  </div>`;
}

function renderMatSimpleFournisseurs(view){
  const soc=matSimpleSocFilter();
  const fours=matSimpleBySoc(db.fournisseurs||[]).slice().sort((a,b)=>(a.raisonSociale||"").localeCompare(b.raisonSociale||""));
  const header=matSimpleHeader("fournisseurs");
  const titleBar=`<div class="flex justify-between items-center mb-3"><div><h1 class="text-2xl font-bold" style="text-transform:uppercase">🤝 FOURNISSEURS</h1><p class="text-slate-500 text-sm" style="text-transform:uppercase">${fours.length} fournisseur(s) · ${soc||"Toutes sociétés"}</p></div>
    <button class="btn btn-warn" onclick="navigate('materiel/fournisseur-nouveau')">➕ Nouveau fournisseur</button></div>`;
  const body=fours.length===0?`<div class="card p-10 text-center"><div class="text-4xl mb-2">🤝</div><div class="text-slate-500 mb-3">Aucun fournisseur enregistré.</div><button class="btn btn-warn" onclick="navigate('materiel/fournisseur-nouveau')">➕ Créer le premier fournisseur</button></div>`:`<div class="card overflow-x-auto"><table class="w-full text-sm">
    <thead style="background:#043970"><tr><th class="p-3 text-left">Raison sociale</th><th class="p-3 text-left">RC / NIF</th><th class="p-3 text-left">Téléphone</th><th class="p-3 text-left">E-mail</th><th class="p-3 text-center">Achats</th><th class="p-3 text-right">Total</th><th class="p-3 text-center">Note</th><th class="p-3 text-right">Actions</th></tr></thead>
    <tbody>${fours.map(f=>{const st=matSimpleFournisseurStats(f.id);const stars=parseInt(f.note)||0;return`<tr class="border-t hover:bg-slate-50">
      <td class="p-3"><a class="font-bold text-amber-700 hover:underline" href="#/materiel/fournisseur/${f.id}">${escapeHTML(f.raisonSociale||"—")}</a>${f.contact?`<div class="text-[10px] text-slate-500">${escapeHTML(f.contact)}</div>`:""}</td>
      <td class="p-3 text-xs font-mono">${escapeHTML(f.rc||"—")}${f.nif?`<div class="text-[10px] text-slate-400">NIF: ${escapeHTML(f.nif)}</div>`:""}</td>
      <td class="p-3 text-xs font-mono">${escapeHTML(f.telephone||"—")}</td>
      <td class="p-3 text-xs">${escapeHTML(f.email||"—")}</td>
      <td class="p-3 text-center font-bold">${st.nb}</td>
      <td class="p-3 text-right font-bold text-emerald-700">${money(st.total)}</td>
      <td class="p-3 text-center"><span style="color:#043970;font-size:14px">${"★".repeat(stars)}${"☆".repeat(5-stars)}</span></td>
      <td class="p-3 text-right">
        <div class="flex gap-1 justify-end flex-wrap">
          <button class="btn btn-ghost text-xs" title="Voir" onclick="navigate('materiel/fournisseur/${f.id}')" style="border:1px solid #043970;background:#eff6ff;color:#1d4ed8">👁 Voir</button>
          <button class="btn btn-ghost text-xs" title="Modifier" onclick="navigate('materiel/fournisseur-edit/${f.id}')" style="border:1px solid #cbd5e1;background:#f8fafc">✏ Modifier</button>
          <button class="btn btn-ghost text-xs text-red-600" title="Supprimer" onclick="matSimpleDeleteFournisseur('${f.id}')" style="border:1px solid #fecaca;background:#fef2f2">🗑 Supprimer</button>
        </div>
      </td>
    </tr>`}).join("")}</tbody></table></div>`;
  view.innerHTML=header+titleBar+body;
  if(sgdiAuthToken()&&!window.__sgdiMatFournisseursLocalFallback&&!window.__sgdiMatFournisseursBgRefreshing){
    window.__sgdiMatFournisseursBgRefreshing=true;
    const _h=location.hash;
    SGDI.stock.suppliersPage({society:soc||undefined,page:1,page_size:25}).then(result=>{
      const fours=serverItems(result).map(supplierFromApi);fours.forEach(f=>sgdiUpsertServerItem("fournisseurs",f));const freshIds=new Set(fours.map(f=>String(f.backendId||"")));db.fournisseurs=(db.fournisseurs||[]).filter(f=>!f.backendId||(soc&&f.societe&&f.societe!==soc)||freshIds.has(String(f.backendId||"")));
      if(location.hash===_h){renderMatSimpleFournisseurs(view);}
      window.__sgdiMatFournisseursBgRefreshing=false;
    }).catch(e=>{window.__sgdiMatFournisseursBgRefreshing=false;window.__sgdiMatFournisseursLocalFallback=true;console.warn("Fournisseurs bg refresh:",e);});
  }
}

function renderMatSimpleFournisseurForm(view,id){
  const isNew=!id;
  let f=isNew?{id:uid("fou"),raisonSociale:"",contact:"",rc:"",nif:"",nis:"",ai:"",adresse:"",telephone:"",email:"",societe:matSimpleSocFilter()||"",delaiPaiement:"30",modeReglement:"Virement",remise:"",note:0,commentaires:"",produits:""}:(db.fournisseurs||[]).find(x=>x.id===id);
  if(!f){toast("Fournisseur introuvable","error");return navigate("materiel/fournisseurs")}
  const psItems=fournisseurProduitServiceItems(f.produits);
  view.innerHTML=`<div class="max-w-4xl mx-auto">
    <div class="flex justify-between mb-4"><div><h1 class="text-2xl font-bold">${isNew?"➕ Nouveau fournisseur":"✏ Modifier fournisseur"}</h1><p class="text-slate-500 text-sm">Partenaire achats</p></div><button class="btn btn-ghost" onclick="navigate('materiel/fournisseurs')">← Retour fournisseurs</button></div>
    <form id="fournisseur-form-simple">
      <div class="card p-5 mb-4">
        <div class="section-banner banner-amber">📋 Coordonnées de base</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="label">Raison sociale *</label><input class="input" name="raisonSociale" value="${escapeHTML(f.raisonSociale||"")}"  placeholder="ex: SARL Distributions Alger"/></div>
          <div><label class="label">Contact / Représentant</label><input class="input" name="contact" value="${escapeHTML(f.contact||"")}" placeholder="Nom du commercial"/></div>
          <div><label class="label">RC (Registre commerce)</label><input class="input font-mono" name="rc" value="${escapeHTML(f.rc||"")}" placeholder="ex: 16/00-0123456 B 22"/></div>
          <div><label class="label">NIF</label><input class="input font-mono" name="nif" value="${escapeHTML(f.nif||"")}" placeholder="ex: 000216012345678"/></div>
          <div><label class="label">NIS</label><input class="input font-mono" name="nis" value="${escapeHTML(f.nis||"")}" placeholder="N° identification statistique"/></div>
          <div><label class="label">N° Article (AI)</label><input class="input font-mono" name="ai" value="${escapeHTML(f.ai||"")}"/></div>
          <div class="md:col-span-2"><label class="label">Adresse</label><input class="input" name="adresse" value="${escapeHTML(f.adresse||"")}" placeholder="Adresse complète"/></div>
          <div><label class="label">Téléphone</label><input class="input" name="telephone" value="${escapeHTML(f.telephone||"")}" placeholder="0X XX XX XX XX"/></div>
          <div><label class="label">E-mail</label><input class="input" type="email" name="email" value="${escapeHTML(f.email||"")}" placeholder="contact@..."/></div>
          <div><label class="label">Société rattachée</label><select class="select" name="societe"><option value="">— Toutes —</option>${SOCIETES.map(s=>`<option ${f.societe===s?"selected":""}>${s}</option>`).join("")}</select></div>
        </div>
      </div>
      <div class="card p-5 mb-4">
        <div class="section-banner banner-green">Produits et service</div>
        <input type="hidden" name="produits" id="fourn-produits-value" value="${escapeHTML(f.produits||"")}"/>
        <div id="fourn-produits-rows" class="space-y-2">${fournisseurProduitServiceRowsHTML(psItems)}</div>
        <div class="flex flex-col items-start gap-2 mt-3">
          <button type="button" class="btn btn-secondary text-xs" onclick="addFournisseurProduitRow()">Ajouter produit</button>
          <button type="button" class="btn btn-ghost text-xs" onclick="addFournisseurServiceRow()">Ajouter service</button>
        </div>
      </div>
      <div class="card p-5 mb-4">
        <div class="section-banner banner-blue">💼 Conditions commerciales</div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label class="label">Délai de paiement (jours)</label><input class="input" type="number" name="delaiPaiement" value="${escapeHTML(f.delaiPaiement||"30")}" placeholder="30"/></div>
          <div><label class="label">Mode de règlement préféré</label><select class="select" name="modeReglement"><option ${f.modeReglement==="Virement"?"selected":""}>Virement</option><option ${f.modeReglement==="Chèque"?"selected":""}>Chèque</option><option ${f.modeReglement==="Espèces"?"selected":""}>Espèces</option><option ${f.modeReglement==="Mixte"?"selected":""}>Mixte</option></select></div>
          <div><label class="label">Remise négociée (%)</label><input class="input" type="number" step="0.1" name="remise" value="${escapeHTML(f.remise||"")}" placeholder="ex: 5"/></div>
        </div>
      </div>
      <div class="card p-5 mb-4">
        <div class="section-banner banner-purple">⭐ Évaluation & notes</div>
        <div class="mb-3"><label class="label">Note (1 à 5 étoiles)</label>
          <div class="flex gap-2 mt-1">${[1,2,3,4,5].map(n=>`<label class="cursor-pointer" style="font-size:28px;color:${n<=(parseInt(f.note)||0)?"#043970":"#cbd5e1"}"><input type="radio" name="note" value="${n}" ${parseInt(f.note)===n?"checked":""} class="hidden" onchange="document.querySelectorAll('[data-star]').forEach((s,i)=>s.style.color=i<${n}?'#043970':'#cbd5e1')"/><span data-star="${n}">★</span></label>`).join("")}</div>
        </div>
        <div><label class="label">Commentaires / observations</label><textarea class="input" name="commentaires" rows="3" placeholder="Réactivité, qualité produits, fiabilité…">${escapeHTML(f.commentaires||"")}</textarea></div>
      </div>
      <div class="card p-4 flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="navigate('materiel/fournisseurs')">✕ Annuler</button><button type="submit" id="fournisseur-simple-save-btn" class="btn btn-warn" onclick="event.preventDefault();matSimpleSaveFournisseur('${f.id}',${isNew?"true":"false"})">💾 Enregistrer</button></div>
    </form>
  </div>`;
  setTimeout(()=>{const fr=document.getElementById("fournisseur-form-simple");if(fr)fr.addEventListener("submit",e=>{e.preventDefault();matSimpleSaveFournisseur(f.id,isNew)});},0);
}

function fournisseurProduitServiceItems(raw){
  return String(raw||"").split("\n").map(line=>{
    const s=line.trim();if(!s)return null;
    const type=s.startsWith("Service:")?"service":"produit";
    let value=s.replace(/^(Produit|Service):\s*/,"").trim();
    let price="";
    const parts=value.split(/\s*\|\s*Prix unitaire:\s*/i);
    if(parts.length>1){value=parts[0].trim();price=parts.slice(1).join(" | ").trim()}
    return{type,value,price:parseMoneyInput(price)};
  }).filter(Boolean);
}

function fournisseurProduitsDetailHTML(raw){
  const items=fournisseurProduitServiceItems(raw);
  if(!items.length)return "";
  return `<div><span class="text-slate-500 text-xs uppercase">Produits et services</span><div class="mt-1 space-y-1">${items.map(item=>`<div class="flex justify-between gap-3 border-b py-1">
    <span><span class="pill ${item.type==="service"?"pill-blue":"pill-green"} mr-1">${item.type==="service"?"Service":"Produit"}</span>${escapeHTML(item.value||"—")}</span>
    <b class="text-xs whitespace-nowrap">${item.price?formatMoneyInputValue(item.price)+" DZD":"—"}</b>
  </div>`).join("")}</div></div>`;
}

function fournisseurProduitServiceRowsHTML(items){
  const rows=items.length?items:[{type:"produit",value:""}];
  return rows.map(item=>fournisseurProduitServiceRowHTML(item.type,item.value,item.price)).join("");
}

function fournisseurProduitServiceRowHTML(type,value,price){
  const isService=type==="service";
  return `<div class="grid grid-cols-1 md:grid-cols-8 gap-2 items-end fourn-ps-row" data-type="${isService?"service":"produit"}">
    <div class="md:col-span-1"><label class="label">${isService?"Service":"Produit"}</label><span class="pill ${isService?"pill-blue":"pill-green"}">${isService?"Service":"Produit"}</span></div>
    <div class="md:col-span-4"><label class="label">Article / service proposé</label><input class="input" data-fourn-ps-value value="${escapeHTML(value||"")}" placeholder="${isService?"ex: Maintenance, livraison, installation":"ex: Tenue bleue avec écusson"}" oninput="updateFournisseurProduitsValue()"/></div>
    <div class="md:col-span-2"><label class="label">Prix unitaire (DZD)</label><input class="input" type="text" inputmode="decimal" data-fourn-ps-price value="${escapeHTML(formatMoneyInputValue(price||""))}" placeholder="30 000,00 DZD" oninput="updateFournisseurProduitsValue()" onblur="formatMoneyField(this);updateFournisseurProduitsValue()"/></div>
    <div class="md:col-span-1"><button type="button" class="btn btn-ghost text-xs text-red-600" onclick="this.closest('.fourn-ps-row').remove();updateFournisseurProduitsValue()">Supprimer</button></div>
  </div>`;
}

function addFournisseurProduitRow(){
  const h=document.getElementById("fourn-produits-rows");if(!h)return;
  h.insertAdjacentHTML("beforeend",fournisseurProduitServiceRowHTML("produit","",""));
}

function addFournisseurServiceRow(){
  const h=document.getElementById("fourn-produits-rows");if(!h)return;
  h.insertAdjacentHTML("beforeend",fournisseurProduitServiceRowHTML("service","",""));
}

function updateFournisseurProduitsValue(){
  const lines=[...document.querySelectorAll(".fourn-ps-row")].map(row=>{
    const val=(row.querySelector("[data-fourn-ps-value]")?.value||"").trim();
    const price=parseMoneyInput(row.querySelector("[data-fourn-ps-price]")?.value||"");
    if(!val)return "";
    return (row.dataset.type==="service"?"Service: ":"Produit: ")+val+(price?` | Prix unitaire: ${price}`:"");
  }).filter(Boolean);
  const hidden=document.getElementById("fourn-produits-value");
  if(hidden)hidden.value=lines.join("\n");
}

async function matSimpleSaveFournisseur(id,isNew){
  try{
    const fr=document.getElementById("fournisseur-form-simple");
    if(!fr){toast("Formulaire introuvable","error");return}
    updateFournisseurProduitsValue();
    const fd=new FormData(fr);
    const raisonSociale=(fd.get("raisonSociale")||"").trim();
    if(!raisonSociale){toast("Raison sociale obligatoire","error");return}
    const obj={id,raisonSociale,contact:(fd.get("contact")||"").trim(),rc:(fd.get("rc")||"").trim(),nif:(fd.get("nif")||"").trim(),nis:(fd.get("nis")||"").trim(),ai:(fd.get("ai")||"").trim(),adresse:(fd.get("adresse")||"").trim(),telephone:(fd.get("telephone")||"").trim(),email:(fd.get("email")||"").trim(),societe:fd.get("societe")||matSimpleSocFilter()||mySoc()||"",produits:(fd.get("produits")||"").trim(),delaiPaiement:fd.get("delaiPaiement")||"30",modeReglement:fd.get("modeReglement")||"Virement",remise:fd.get("remise")||"",note:parseInt(fd.get("note"))||0,commentaires:fd.get("commentaires")||""};
    if(!db.fournisseurs)db.fournisseurs=[];
    let idx=-1;
    if(isNew){obj.createdAt=new Date().toISOString()}
    else{idx=db.fournisseurs.findIndex(x=>x.id===id);if(idx<0){toast("Fournisseur introuvable","error");return}Object.assign(obj,{...db.fournisseurs[idx],...obj})}
    try{await persistSupplierToPostgres(obj)}catch(e){toast("Fournisseur non sauvegardé : "+(e.message||e),"error");return}
    if(isNew)db.fournisseurs.push(obj);else db.fournisseurs[idx]=obj;
    if(typeof logActivity==="function")logActivity(isNew?"Création fournisseur":"Modification fournisseur",raisonSociale);
    try{
      sgdiDirty=true;
      await sgdiBackendSaveAndWait();
    }catch(e){
      toast("Fournisseur créé, mais synchronisation globale PostgreSQL incomplète : "+(e.message||e),"warning");
      return;
    }
    toast(isNew?"Fournisseur créé":"Fournisseur mis à jour","success");
    navigate("materiel/fournisseurs");
  }catch(err){console.error(err);toast("Erreur: "+(err.message||err),"error")}
}

async function matSimpleDeleteFournisseur(id){
  const f=(db.fournisseurs||[]).find(x=>x.id===id);if(!f)return;
  const linked=(db.stockMouvements||[]).filter(m=>m.fournisseurId===id).length;
  if(linked>0){if(!confirm(`Le fournisseur « ${f.raisonSociale} » est lié à ${linked} mouvement(s) d'entrée.\nLes mouvements ne seront PAS supprimés mais perdront le lien.\nContinuer ?`))return}
  else if(!confirm(`Supprimer le fournisseur « ${f.raisonSociale} » ?`))return;
  (db.stockMouvements||[]).forEach(m=>{if(m.fournisseurId===id)m.fournisseurId=""});
  if(f.backendId){try{await SGDI.stock.deleteSupplier(f.backendId)}catch(e){toast("Suppression PostgreSQL impossible : "+(e.message||e),"error");return}}
  db.fournisseurs=(db.fournisseurs||[]).filter(x=>x.id!==id);
  if(typeof logActivity==="function")logActivity("Suppression fournisseur",f.raisonSociale);
  if(!(await saveDBAndWaitToast("Suppression fournisseur non confirmée")))return;
  toast("Fournisseur supprimé","success");
  render();
}

function renderMatSimpleFournisseurDetail(view,id){
  const f=(db.fournisseurs||[]).find(x=>x.id===id);
  if(!f){view.innerHTML=`<div class="card p-6">Fournisseur introuvable. <a href="#/materiel/fournisseurs" class="text-amber-600 underline">← Retour</a></div>`;return}
  const achats=(db.stockMouvements||[]).filter(m=>m.type==="entree"&&m.fournisseurId===id).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const total=achats.reduce((s,m)=>s+(parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0),0);
  const totalQty=achats.reduce((s,m)=>s+(parseFloat(m.quantite)||0),0);
  const stars=parseInt(f.note)||0;
  view.innerHTML=`<div class="flex justify-between mb-4">
    <div><h1 class="text-2xl font-bold">🤝 ${escapeHTML(f.raisonSociale)}</h1><p class="text-slate-500 text-sm">${f.contact?escapeHTML(f.contact)+" · ":""}${escapeHTML(f.societe||"Toutes sociétés")}</p></div>
    <div class="flex gap-2"><a href="#/materiel/fournisseurs" class="btn btn-ghost">← Fournisseurs</a><button class="btn btn-warn" onclick="navigate('materiel/fournisseur-edit/${f.id}')">✏ Modifier</button><button class="btn btn-ghost text-red-600" onclick="matSimpleDeleteFournisseur('${f.id}')" style="border:1px solid #fecaca;background:#fef2f2">🗑 Supprimer</button></div>
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
    <div class="card p-5">
      <h3 class="font-bold mb-3">📋 Coordonnées</h3>
      <div class="space-y-2 text-sm">
        ${f.adresse?`<div><span class="text-slate-500 text-xs uppercase">Adresse</span><div>${escapeHTML(f.adresse)}</div></div>`:""}
        ${f.telephone?`<div><span class="text-slate-500 text-xs uppercase">Téléphone</span><div class="font-mono">${escapeHTML(f.telephone)}</div></div>`:""}
        ${f.email?`<div><span class="text-slate-500 text-xs uppercase">E-mail</span><div>${escapeHTML(f.email)}</div></div>`:""}
        ${f.rc?`<div><span class="text-slate-500 text-xs uppercase">RC</span><div class="font-mono">${escapeHTML(f.rc)}</div></div>`:""}
        ${f.nif?`<div><span class="text-slate-500 text-xs uppercase">NIF</span><div class="font-mono">${escapeHTML(f.nif)}</div></div>`:""}
        ${f.nis?`<div><span class="text-slate-500 text-xs uppercase">NIS</span><div class="font-mono">${escapeHTML(f.nis)}</div></div>`:""}
        ${fournisseurProduitsDetailHTML(f.produits)}
      </div>
    </div>
    <div class="card p-5">
      <h3 class="font-bold mb-3">💼 Conditions commerciales</h3>
      <div class="space-y-2 text-sm">
        <div class="flex justify-between border-b py-1.5"><span class="text-slate-500">Délai paiement</span><b>${escapeHTML(f.delaiPaiement||"30")} jours</b></div>
        <div class="flex justify-between border-b py-1.5"><span class="text-slate-500">Mode règlement</span><b>${escapeHTML(f.modeReglement||"—")}</b></div>
        <div class="flex justify-between border-b py-1.5"><span class="text-slate-500">Remise négociée</span><b class="text-emerald-700">${f.remise?escapeHTML(f.remise)+" %":"—"}</b></div>
      </div>
      <h3 class="font-bold mt-4 mb-2">⭐ Évaluation</h3>
      <div style="font-size:24px;color:#043970">${"★".repeat(stars)}<span style="color:#cbd5e1">${"★".repeat(5-stars)}</span></div>
      ${f.commentaires?`<div class="text-xs text-slate-700 mt-2 p-3 rounded" style="background:#f8fafc">${escapeHTML(f.commentaires)}</div>`:""}
    </div>
    <div class="card p-5">
      <h3 class="font-bold mb-3">📊 Statistiques achats</h3>
      <div class="space-y-3">
        <div class="p-3 rounded text-center" style="background:#043970"><div class="text-[10px] uppercase font-bold text-slate-500">Nb achats</div><div class="text-3xl font-black text-amber-700">${achats.length}</div></div>
        <div class="p-3 rounded text-center" style="background:#043970"><div class="text-[10px] uppercase font-bold text-slate-500">Quantités</div><div class="text-2xl font-black text-emerald-700">${qty(totalQty)}</div></div>
        <div class="p-3 rounded text-center" style="background:#043970"><div class="text-[10px] uppercase font-bold text-slate-500">Total dépensé</div><div class="text-xl font-black text-amber-700">${money(total)}</div></div>
      </div>
    </div>
  </div>
  <div class="card p-5">
    <h3 class="font-bold mb-3">📜 Historique des achats (${achats.length})</h3>
    ${achats.length===0?`<div class="text-sm text-slate-400 italic py-6 text-center">Aucun achat enregistré pour ce fournisseur.<br><span class="text-xs">Lors d'une entrée stock, sélectionnez ce fournisseur dans le formulaire.</span></div>`:`<div class="overflow-x-auto"><table class="w-full text-sm">
      <thead style="background:#f8fafc"><tr><th class="p-2 text-left">Date</th><th class="p-2 text-left">Article</th><th class="p-2 text-right">Qté</th><th class="p-2 text-right">P.U.</th><th class="p-2 text-right">Montant</th><th class="p-2 text-left">N° Bon</th></tr></thead>
      <tbody>${achats.map(m=>{const a=(db.stockArticles||[]).find(x=>x.id===m.articleId);const v=(parseFloat(m.quantite)||0)*(parseFloat(m.prixUnitaire)||0);return`<tr class="border-t hover:bg-slate-50"><td class="p-2 text-xs">${formatDate(m.date)}</td><td class="p-2 text-xs">${a?`<a class="hover:underline font-semibold" href="#/materiel/article/${a.id}">${escapeHTML(a.designation)}</a>`:"—"}</td><td class="p-2 text-right text-xs">+${qty(m.quantite)}</td><td class="p-2 text-right text-xs">${money(m.prixUnitaire)}</td><td class="p-2 text-right font-bold text-emerald-700">${money(v)}</td><td class="p-2 text-xs font-mono">${escapeHTML(m.numeroBon||"—")}</td></tr>`}).join("")}</tbody>
    </table></div>`}
  </div>`;
}

function filterMateriel(){
  const cat=document.getElementById("mt-cat")?.value||"";
  const st=document.getElementById("mt-statut")?.value||"";
  const et=document.getElementById("mt-etat")?.value||"";
  document.querySelectorAll("#mt-tbody tr[data-row]").forEach(r=>{
    let ok=true;
    if(cat&&r.dataset.cat!==cat)ok=false;
    if(st&&r.dataset.statut!==st)ok=false;
    if(et&&r.dataset.etat!==et)ok=false;
    r.classList.toggle("hidden",!ok);
  });
}

function setMtSociete(v){if(mySoc()){toast("Vous êtes sur "+mySoc()+". Utilisez Changer de société.","error");return}sessionStorage.setItem("mtSociete",v||"");render()}

function materielSocieteStripHTML(){
  const socFilter=sessionStorage.getItem("mtSociete")||"";
  const socColors={};
  const list=db.materiel||[];
  const totalAll=list.length;
  const chip=(value,icon,label,count,color,active)=>{
    const baseStyle=`border-left:5px solid ${color};border-top:1px solid ${color}33;border-right:1px solid ${color}33;border-bottom:1px solid ${color}33;background:linear-gradient(135deg,${color}10,${color}22);padding:6px 12px;border-radius:8px;cursor:pointer;transition:all .15s`;
    const activeStyle=`border:2px solid ${color};border-left:5px solid ${color};box-shadow:0 4px 12px ${color}55;background:linear-gradient(135deg,${color}30,${color}45);padding:5px 11px;border-radius:8px;cursor:pointer;transform:translateY(-1px)`;
    return`<button type="button" onclick="setMtSociete('${value.replace(/'/g,"\\'")}')" style="${active?activeStyle:baseStyle}" class="flex items-center gap-2 whitespace-nowrap" title="${escapeHTML(label)}">
      <span class="text-xs font-bold uppercase tracking-wide" style="color:${color};line-height:1">${escapeHTML(label)}</span>
      <span class="pill" style="font-weight:800;background:${color};color:#fff;border:0;font-size:10px;padding:1px 7px">${count}</span>
    </button>`;
  };
  return`<div class="no-print flex items-center gap-2 px-4 py-2 overflow-x-auto" style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border-bottom:1px solid #e2e8f0">
    ${chip("","","Toutes",totalAll,"#475569",!socFilter)}
    ${SOCIETES.map(s=>chip(s,"",s,list.filter(m=>m.societe===s).length,socColors[s]||"#64748b",socFilter===s)).join("")}
    <div class="flex-1"></div>
    <input id="global-search" class="input text-xs" style="max-width:200px" placeholder="🔎 Rechercher…" value="${escapeHTML(currentSearch)}" oninput="onGlobalSearch(this.value)"/>
    ${currentSearch?`<button class="btn btn-ghost text-xs" onclick="clearSearch()">✕</button>`:""}
  </div>`;
}

function renderMaterielForm(view,id){
  let m;
  if(id){m=db.materiel.find(x=>x.id===id);if(!m){toast("Article introuvable","error");return navigate("materiel/inventaire")}}
  else{m={id:uid("mt"),code:"",categorie:"",designation:"",marque:"",modele:"",numeroSerie:"",etat:"Neuf",statut:"en_stock",agentId:null,dateAttribution:null,dateRetour:null,dateAchat:today(),prix:"",societe:"",notes:"",photo:null,isNew:true}}
  view.innerHTML=`<div class="max-w-4xl mx-auto">
    <div class="flex justify-between mb-4"><div><h1 class="text-2xl font-bold">${m.isNew?"➕ Nouvel article":"✏ Modifier l'article"}</h1><p class="text-slate-500 text-sm">Matériel & équipement</p></div><button class="btn btn-ghost" onclick="navigate('materiel/inventaire')">← Retour</button></div>
    <form id="mat-form">
      <div class="card p-5 mb-4"><div class="section-banner banner-amber">Identification</div><div class="grid grid-6">
        <div class="col-span-2"><label class="label">Code (auto)</label><input class="input font-mono" name="code" value="${escapeHTML(m.code||"")}" placeholder="généré"/></div>
        <div class="col-span-2"><label class="label">Catégorie *</label><select class="select" name="categorie" ><option value="">— Choisir —</option>${CATEGORIES_MATERIEL.map(c=>`<option ${m.categorie===c?"selected":""}>${c}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">N° série</label><input class="input" name="numeroSerie" value="${escapeHTML(m.numeroSerie||"")}"/></div>
        <div class="col-span-3"><label class="label">Désignation *</label><input class="input" name="designation" value="${escapeHTML(m.designation||"")}" /></div>
        <div class="col-span-3"><label class="label">Marque</label><input class="input" name="marque" value="${escapeHTML(m.marque||"")}"/></div>
        <div class="col-span-3"><label class="label">Modèle</label><input class="input" name="modele" value="${escapeHTML(m.modele||"")}"/></div>
        <div class="col-span-3"><label class="label">Société propriétaire</label><select class="select" name="societe"><option value="">—</option>${SOCIETES.map(s=>`<option ${m.societe===s?"selected":""}>${s}</option>`).join("")}</select></div>
      </div></div>
      <div class="card p-5 mb-4"><div class="section-banner banner-blue">Acquisition & état</div><div class="grid grid-6">
        <div class="col-span-2"><label class="label">Date d'achat</label><input class="input" type="date" name="dateAchat" value="${m.dateAchat||""}"/></div>
        <div class="col-span-2"><label class="label">Prix d'achat (DA)</label><input class="input" type="number" name="prix" value="${m.prix||""}"/></div>
        <div class="col-span-2"><label class="label">État</label><select class="select" name="etat">${ETATS_MATERIEL.map(e=>`<option ${m.etat===e?"selected":""}>${e}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Statut</label><select class="select" name="statut">${STATUTS_MATERIEL.map(s=>`<option value="${s}" ${m.statut===s?"selected":""}>${statutMatLabel(s)}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Attribué à (agent)</label><select class="select" name="agentId"><option value="">—</option>${db.agents.filter(a=>a.statut==="actif").map(a=>`<option value="${a.id}" ${m.agentId===a.id?"selected":""}>${escapeHTML(a.nom+" "+a.prenom)} — ${safe(a.matricule)}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Date attribution</label><input class="input" type="date" name="dateAttribution" value="${m.dateAttribution||""}"/></div>
      </div></div>
      <div class="card p-5 mb-4"><div class="section-banner banner-green">Notes</div>
        <textarea class="input" name="notes" rows="3" placeholder="Remarques, défauts, accessoires inclus...">${escapeHTML(m.notes||"")}</textarea>
      </div>
      <div class="card p-4 flex justify-end gap-2"><button type="button" class="btn btn-ghost" onclick="navigate('materiel/inventaire')">Annuler</button><button type="submit" id="mat-form-save-btn" class="btn btn-primary" onclick="event.preventDefault();saveMateriel('${m.id}',${m.isNew?"true":"false"})">💾 Enregistrer</button></div>
    </form>
  </div>`;
  // Defensive wiring: form submit + Enter key
  setTimeout(()=>{
    const f=document.getElementById("mat-form");
    if(f&&!f._wired){f._wired=true;f.addEventListener("submit",e=>{e.preventDefault();saveMateriel(m.id,m.isNew?"true":"false")});}
  },0);
}

async function saveMateriel(id,isNew){
  try{
    const f=document.getElementById("mat-form");
    if(!f){toast("Formulaire introuvable","error");return}
    const get=n=>{const el=f.querySelector(`[name="${n}"]`);return el?el.value:"";};
    const cat=(get("categorie")||"").trim();
    const des=(get("designation")||"").trim();
    if(!cat){toast("Sélectionnez une catégorie","error");f.querySelector('[name="categorie"]')?.focus();return}
    if(!des){toast("Saisissez la désignation","error");f.querySelector('[name="designation"]')?.focus();return}
    const isCreating=isNew===true||isNew==="true";
    let m=(db.materiel||[]).find(x=>x.id===id);
    if(!m){m={id};db.materiel=db.materiel||[];db.materiel.push(m)}
    ["code","categorie","designation","marque","modele","numeroSerie","etat","statut","societe","notes","dateAchat","dateAttribution"].forEach(k=>{m[k]=(get(k)||"").trim()});
    m.prix=parseFloat(get("prix"))||0;
    const ag=get("agentId");m.agentId=ag||null;
    if(!m.code)m.code=nextMatCode(m.categorie);
    if(m.statut==="attribue"&&!m.dateAttribution)m.dateAttribution=today();
    if(m.statut!=="attribue")m.agentId=null;
    if(typeof logActivity==="function")logActivity(isCreating?"Article matériel créé":"Article matériel modifié",(m.code||"")+" · "+(m.designation||""));
    if(!(await saveDBAndWaitToast("Article matériel non confirmé")))return;
    toast(isCreating?"✓ Article ajouté":"✓ Article modifié","success");
    navigate("materiel/inventaire");
  }catch(err){
    console.error("saveMateriel error:",err);
    toast("Erreur d'enregistrement: "+err.message,"error");
  }
}

function deleteMateriel(id){if(!confirm("Supprimer cet article ?"))return;db.materiel=db.materiel.filter(m=>m.id!==id);saveDB();toast("Article supprimé","success");renderView()}

function openAttribuerModal(id){
  const m=db.materiel.find(x=>x.id===id);if(!m)return;
  const agents=db.agents.filter(a=>a.statut==="actif");
  openModal(`<h3 class="font-bold text-lg mb-4">🎽 Attribuer — ${escapeHTML(m.designation)} <span class="font-mono text-sm text-slate-500">${m.code}</span></h3>
    <form onsubmit="event.preventDefault();confirmAttribuer('${id}')">
      <div class="grid grid-2">
        <div class="col-span-2"><label class="label">Agent *</label><select class="select" name="agentId" ><option value="">— Choisir —</option>${agents.map(a=>`<option value="${a.id}">${escapeHTML(a.nom+" "+a.prenom)} — ${safe(a.matricule)} (${safe(a.societe)})</option>`).join("")}</select></div>
        <div><label class="label">Date d'attribution</label><input class="input" type="date" name="dateAttribution" value="${today()}" /></div>
        <div><label class="label">État au moment</label><select class="select" name="etat">${ETATS_MATERIEL.map(e=>`<option ${m.etat===e?"selected":""}>${e}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Notes</label><input class="input" name="notes" placeholder="Accessoires inclus, remarques..."/></div>
      </div>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Confirmer attribution</button></div>
    </form>`)
}

function confirmAttribuer(id){
  const f=document.querySelector(".modal-bg form");const fd=new FormData(f);
  const m=db.materiel.find(x=>x.id===id);if(!m)return;
  m.agentId=fd.get("agentId");m.statut="attribue";m.dateAttribution=fd.get("dateAttribution")||today();m.dateRetour=null;m.etat=fd.get("etat")||m.etat;
  const ag=db.agents.find(a=>a.id===m.agentId);if(ag&&!m.societe)m.societe=ag.societe;
  if(fd.get("notes"))m.notes=(m.notes?m.notes+" | ":"")+"Attribution: "+fd.get("notes");
  saveDB();closeModal();toast("Article attribué","success");renderView();
}

function openRetourModal(id){
  const m=db.materiel.find(x=>x.id===id);if(!m)return;
  const ag=m.agentId?db.agents.find(a=>a.id===m.agentId):null;
  openModal(`<h3 class="font-bold text-lg mb-4">↩ Retour — ${escapeHTML(m.designation)}</h3>
    ${ag?`<p class="text-sm text-slate-500 mb-3">Attribué à : <b>${escapeHTML(ag.nom+" "+ag.prenom)}</b></p>`:""}
    <form onsubmit="event.preventDefault();confirmRetour('${id}')">
      <div class="grid grid-2">
        <div><label class="label">Date de retour</label><input class="input" type="date" name="dateRetour" value="${today()}" /></div>
        <div><label class="label">État au retour</label><select class="select" name="etat">${ETATS_MATERIEL.map(e=>`<option>${e}</option>`).join("")}</select></div>
        <div class="col-span-2"><label class="label">Nouveau statut</label><select class="select" name="statut"><option value="en_stock">En stock (réutilisable)</option><option value="en_reparation">En réparation</option><option value="perdu">Perdu</option><option value="reforme">Réformé</option></select></div>
        <div class="col-span-2"><label class="label">Notes</label><input class="input" name="notes" placeholder="Motif retour, casse, etc."/></div>
      </div>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Confirmer retour</button></div>
    </form>`)
}

function confirmRetour(id){
  const f=document.querySelector(".modal-bg form");const fd=new FormData(f);
  const m=db.materiel.find(x=>x.id===id);if(!m)return;
  m.dateRetour=fd.get("dateRetour")||today();m.statut=fd.get("statut")||"en_stock";m.etat=fd.get("etat")||m.etat;
  if(fd.get("notes"))m.notes=(m.notes?m.notes+" | ":"")+"Retour: "+fd.get("notes");
  m.agentId=null;m.dateAttribution=null;
  saveDB();closeModal();toast("Article retourné","success");renderView();
}

function finReparation(id){
  const m=db.materiel.find(x=>x.id===id);if(!m)return;
  if(!confirm("Marquer cet article comme réparé et remis en stock ?"))return;
  m.statut="en_stock";m.etat="Bon état";saveDB();toast("Article remis en stock","success");renderView();
}

function getTheme(code){return MAGASIN_THEMES[code]||MAGASIN_THEMES.habillement}

function stockMagasinsForCategorie(soc){
  return (db.magasins||[]).filter(m=>!soc||!m.societe||m.societe===soc).sort((a,b)=>(a.nom||"").localeCompare(b.nom||""));
}

function stockMagasinCategorieOptionsHTML(soc,selected){
  const mags=stockMagasinsForCategorie(soc);
  if(!mags.length)return `<option value="">Aucun magasin créé</option>`;
  return `<option value="">— Choisir un magasin —</option>${mags.map(m=>`<option value="${escapeHTML(m.id)}" ${String(selected||"")===String(m.id)||String(selected||"")===String(m.nom||"")?"selected":""}>${m.icon||"🏬"} ${escapeHTML(m.nom||"Magasin")}</option>`).join("")}`;
}

function stockSelectedMagasinSummaryHTML(value){
  const m=(db.magasins||[]).find(x=>String(x.id)===String(value||"")||String(x.nom||"")===String(value||""));
  if(!m)return `<span class="text-slate-400">Aucun magasin sélectionné</span>`;
  return `${m.icon||"🏬"} <b>${escapeHTML(m.nom||"Magasin")}</b>${m.societe?` · ${escapeHTML(m.societe)}`:""}`;
}

function stockGetValeur(articleId){
  const a=(db.stockArticles||[]).find(x=>x.id===articleId);
  if(!a)return 0;
  return stockGetActuel(articleId)*(parseFloat(a.prixUnitaire)||0);
}

function stockMvtTypeColor(t){return{entree:"#16a34a",achat:"#16a34a",retour:"#043970",retour_employe:"#043970",retour_site:"#043970",regularisation_entree:"#16a34a",sortie:"#dc2626",perte:"#043970",casse:"#7c2d12",ajustement:"#7c3aed",nouvelle_dotation:"#dc2626",renouvellement_dotation:"#043970",dotation_pret:"#7c3aed",reforme:"#475569"}[t]||"#64748b"}

function stockMvtTypeIcon(t){return ""}

function renderStockAlertesServerTab(data){
  const d=data&&typeof data==="object"?data:{};
  const groups=[
    ["ruptures","✕","Ruptures de stock","✓ Aucune rupture — situation normale.",{color:"#dc2626",bg:"#fef2f2",pillBg:"#fef2f2",pillBorder:"#fecaca"}],
    ["alertes","⚠","Stocks bas / sous minimum","✓ Aucun stock bas.",{color:"#b45309",bg:"#fffbeb",pillBg:"#fffbeb",pillBorder:"#fed7aa"}],
    ["dormants","💤","Articles dormants (>90 jours)","Aucun article dormant.",{color:"#ca8a04",bg:"#fefce8",pillBg:"#fefce8",pillBorder:"#fde68a"}],
    ["surstock","📦","Surstock (> max)","Aucun surstock détecté.",{color:"#7c3aed",bg:"#f5f3ff",pillBg:"#f5f3ff",pillBorder:"#ddd6fe"}]
  ];
  const renderList=(list,emptyMsg,scheme)=>{
    list=Array.isArray(list)?list:[];
    if(!list.length)return`<div class="text-center text-sm text-slate-500 py-6">${emptyMsg}</div>`;
    return`<div class="space-y-2">${list.map(a=>{
      const etat=a.etat||{};
      const q=parseFloat(a.stock)||0;
      const seuil=parseFloat(a.seuilAlerte)||0;
      const min=parseFloat(a.stockMin)||0;
      const max=parseFloat(a.stockMax)||0;
      return`<div class="card p-3 hover:shadow transition" style="border-left:4px solid ${scheme.color};background:${scheme.bg}">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono text-xs text-slate-500">${safe(a.code)}</span>
              <a class="font-bold hover:underline" href="#/materiel/article/${a.id}">${escapeHTML(a.designation||"—")}</a>
              ${a.categorie?`<span class="pill" style="background:#f1f5f9;color:#475569;font-size:10px;border:1px solid #cbd5e1">${escapeHTML(a.categorie)}</span>`:""}
              <span class="text-[11px]" style="color:#64748b">${escapeHTML(a.societe||"—")}</span>
            </div>
            <div class="text-xs text-slate-600 mt-1">Stock : <b style="color:${scheme.color}">${qty(q)} ${escapeHTML(a.unite||"")}</b>${seuil?` · Seuil : ${qty(seuil)}`:""}${min?` · Min : ${qty(min)}`:""}${max?` · Max : ${qty(max)}`:""}${a.magasin?` · 🏬 ${escapeHTML(a.magasin)}`:""}${a.lastMovementDate?` · Dernier mouvement : ${formatDate(a.lastMovementDate)}`:""}</div>
            ${etat.label?`<div class="mt-1"><span class="pill" style="background:${etat.bg||scheme.pillBg};color:${etat.color||scheme.color};border:1px solid ${(etat.color||scheme.color)}55;font-size:10px">${escapeHTML(etat.label)}</span></div>`:""}
          </div>
          <div class="flex gap-1">
            <button class="btn btn-success text-xs" onclick="stockOpenMvt('entree','${a.id}')">📥 Entrée</button>
            <a class="btn btn-ghost text-xs" href="#/materiel/article/${a.id}">👁</a>
          </div>
        </div>
      </div>`;
    }).join("")}</div>`;
  };
  return`<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">${groups.map(([key,icon,title,empty,scheme])=>{
    const list=Array.isArray(d[key])?d[key]:[];
    return`<div class="card p-4" style="border-top:4px solid ${scheme.color}">
      <h3 class="font-bold mb-3 flex items-center gap-2" style="color:${scheme.color}"><span style="font-size:24px">${icon}</span> ${title} <span class="pill" style="background:${scheme.pillBg};color:${scheme.color};border:1px solid ${scheme.pillBorder}">${list.length}</span></h3>
      ${renderList(list,empty,scheme)}
    </div>`;
  }).join("")}</div>`;
}

function renderMatSimpleAlertesFromServer(view,data){
  const soc=matSimpleSocFilter();
  const s=data?.summary||{};
  const total=s.totalArticles??0;
  const ruptures=s.ruptures??0;
  const alertes=s.alertes??0;
  const ok=s.ok??Math.max(0,total-ruptures-alertes);
  view.innerHTML=`${matSimpleHeader("alertes")}
    <div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-black uppercase">Alertes stock</h1>
        <p class="text-sm text-slate-500">${soc?escapeHTML(soc):"Toutes les sociétés"} · Données serveur stables · ruptures, stocks bas, articles dormants et surstocks.</p>
      </div>
      <button class="btn btn-primary" onclick="stockOpenMvt('entree')">+ Entrée stock</button>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div class="card p-4"><div class="text-xs uppercase font-bold text-slate-500">Articles suivis</div><div class="text-2xl font-black">${total}</div></div>
      <div class="card p-4" style="border-top:4px solid #dc2626"><div class="text-xs uppercase font-bold text-slate-500">Ruptures</div><div class="text-2xl font-black text-red-700">${ruptures}</div></div>
      <div class="card p-4" style="border-top:4px solid #d97706"><div class="text-xs uppercase font-bold text-slate-500">Stocks bas</div><div class="text-2xl font-black text-amber-700">${alertes}</div></div>
      <div class="card p-4" style="border-top:4px solid #16a34a"><div class="text-xs uppercase font-bold text-slate-500">Situation normale</div><div class="text-2xl font-black text-emerald-700">${ok}</div></div>
    </div>
    ${renderStockAlertesServerTab(data)}`;
}

function renderMatSimpleAlertes(view){
  const soc=matSimpleSocFilter();
  const kpi=stockSummaryKPI();
  view.innerHTML=`${matSimpleHeader("alertes")}
    <div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-black uppercase">Alertes stock</h1>
        <p class="text-sm text-slate-500">${soc?escapeHTML(soc):"Toutes les sociétés"} · Ruptures, stocks bas, articles dormants et surstocks.</p>
      </div>
      <button class="btn btn-primary" onclick="stockOpenMvt('entree')">+ Entrée stock</button>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <div class="card p-4"><div class="text-xs uppercase font-bold text-slate-500">Articles suivis</div><div class="text-2xl font-black">${kpi.totalArticles}</div></div>
      <div class="card p-4" style="border-top:4px solid #dc2626"><div class="text-xs uppercase font-bold text-slate-500">Ruptures</div><div class="text-2xl font-black text-red-700">${kpi.enRupture}</div></div>
      <div class="card p-4" style="border-top:4px solid #d97706"><div class="text-xs uppercase font-bold text-slate-500">Stocks bas</div><div class="text-2xl font-black text-amber-700">${kpi.enAlerte}</div></div>
      <div class="card p-4" style="border-top:4px solid #16a34a"><div class="text-xs uppercase font-bold text-slate-500">Situation normale</div><div class="text-2xl font-black text-emerald-700">${Math.max(0,kpi.totalArticles-kpi.enRupture-kpi.enAlerte)}</div></div>
    </div>
    ${renderStockAlertesTab()}`;
}

SGDIModules.registerModule({key: "material-stores", routes: [], dependencies: [], init: function(){}, destroy: function(){}});
