/* Phase 2 — material-inventory. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2b-2g-inventory.json. */
async function renderMatSimpleAlertesServer(view){
  view.innerHTML=`${matSimpleHeader("alertes")}<div style="display:flex;align-items:center;justify-content:center;min-height:220px;color:#94a3b8"><div style="text-align:center"><div style="font-size:28px;margin-bottom:10px;opacity:.5">⏳</div><div style="font-weight:700;font-size:14px">Chargement des alertes serveur…</div></div></div>`;
  if(window.__sgdiMatAlertesRefreshing)return;
  window.__sgdiMatAlertesRefreshing=true;
  try{
    const data=await SGDI.stock.alerts({society:matSimpleSocFilter()||undefined});
    if(String(location.hash||"").startsWith("#/materiel/alertes"))renderMatSimpleAlertesFromServer(view,data);
  }catch(e){
    console.warn("Alertes matériel serveur indisponibles",e);
    renderMatSimpleAlertes(view);
  }finally{
    window.__sgdiMatAlertesRefreshing=false;
  }
}

function renderStockProMain(view,tab){
  const soc=stockGetSocFilter();
  tab=tab||"catalogue";
  const kpi=stockSummaryKPI();
  const tabs=[
    ["catalogue","📋 Catalogue","Articles enregistrés"],
    ["entrees","📥 Entrées","Mouvements entrants"],
    ["sorties","📤 Sorties","Mouvements sortants"],
    ["mouvements","🔄 Mouvements","Tous les mouvements"],
    ["alertes","⚠️ Alertes","Stock bas / rupture"],
    ["statistiques","📈 Statistiques","Analyse détaillée"]
  ];
  const meta=soc?STOCK_SOC_META[soc]:null;
  const headerColor=meta?meta.color:"#0f172a";
  const banner=`<div class="card p-5 mb-4" style="background:linear-gradient(135deg,${headerColor}15,${headerColor}05);border-left:6px solid ${headerColor}">
    <div class="flex items-start justify-between flex-wrap gap-3">
      <div>
        <div class="flex items-center gap-3 mb-1">
          <div style="font-size:36px;filter:drop-shadow(0 2px 4px ${headerColor}55)">${meta?meta.icon:"📦"}</div>
          <div>
            <h1 class="text-2xl font-black" style="color:${headerColor}">📦 Situation matériel & équipement</h1>
            <p class="text-xs uppercase tracking-widest font-bold" style="color:${headerColor}cc">${meta?meta.metier:"Gestion de stock professionnelle · Toutes sociétés"}</p>
          </div>
        </div>
        <p class="text-sm text-slate-600 mt-2">Catalogue · Entrées · Sorties · Mouvements · Alertes · Statistiques · Toute la traçabilité au moindre détail.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-primary" onclick="stockNouvelArticle()">➕ Nouvel article</button>
        <button class="btn btn-success" onclick="stockOpenMvt('entree')">Entrée stock</button>
        <button class="btn btn-secondary" style="background:#dc2626;color:#fff" onclick="stockOpenMvt('sortie')">Sortie stock</button>
        <button class="btn btn-ghost" onclick="stockExportCSV()">⬇ Export CSV</button>
      </div>
    </div>
  </div>`;
  const kpiCards=`<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
    <div class="card p-3" style="border-top:4px solid #0f172a"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Articles</div><div class="text-2xl font-black mt-1">${kpi.totalArticles}</div><div class="text-[11px] text-slate-400">${kpi.actifs} avec stock</div></div>
    <div class="card p-3" style="border-top:4px solid #16a34a"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Unités totales</div><div class="text-2xl font-black mt-1 text-emerald-700">${qty(kpi.totalUnites)}</div><div class="text-[11px] text-slate-400">en stock</div></div>
    <div class="card p-3" style="border-top:4px solid #043970"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Entrées (mois)</div><div class="text-2xl font-black mt-1 text-sky-700">+${qty(kpi.entreesMois)}</div><div class="text-[11px] text-slate-400">${money(kpi.valEntrees)} DA</div></div>
    <div class="card p-3" style="border-top:4px solid #dc2626"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Sorties (mois)</div><div class="text-2xl font-black mt-1 text-red-700">−${qty(kpi.sortiesMois)}</div><div class="text-[11px] text-slate-400">${money(kpi.valSorties)} DA</div></div>
    <div class="card p-3 ${kpi.enRupture+kpi.enAlerte>0?"":""}" style="border-top:4px solid ${kpi.enRupture>0?"#dc2626":(kpi.enAlerte>0?"#043970":"#16a34a")}"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Alertes</div><div class="text-2xl font-black mt-1" style="color:${kpi.enRupture>0?"#dc2626":(kpi.enAlerte>0?"#043970":"#16a34a")}">${kpi.enRupture+kpi.enAlerte}</div><div class="text-[11px] text-slate-400">${kpi.enRupture} rupt. · ${kpi.enAlerte} bas</div></div>
  </div>`;
  const tabBar=`<div class="card p-1 mb-4 flex gap-1 flex-wrap" style="background:#f8fafc">${tabs.map(([k,l,d])=>`<a href="#/materiel/${k==="catalogue"?"inventaire":k}" class="flex-1 min-w-[140px] text-center py-2 px-3 rounded-md text-sm transition" style="${tab===k?`background:${headerColor};color:#fff;font-weight:700;box-shadow:0 4px 10px ${headerColor}55`:"color:#475569"}" title="${d}">${l}</a>`).join("")}</div>`;
  let body="";
  if(tab==="catalogue")body=renderStockCatalogueTab();
  else if(tab==="entrees"||tab==="retours")body=renderStockMvtTab("entree");
  else if(tab==="sorties"||tab==="attributions")body=renderStockMvtTab("sortie");
  else if(tab==="mouvements")body=renderStockMvtTab("all");
  else if(tab==="alertes")body=renderStockAlertesTab();
  else if(tab==="statistiques"||tab==="stats")body=renderStockStatistiquesTab();
  else body=renderStockCatalogueTab();
  view.innerHTML=banner+tabBar+body;
}

function stockKpiCardsHTML(){
  const kpi=stockSummaryKPI();
  return`<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
    <div class="card p-3" style="border-top:4px solid #0f172a"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Articles</div><div class="text-2xl font-black mt-1">${kpi.totalArticles}</div><div class="text-[11px] text-slate-400">${kpi.actifs} avec stock</div></div>
    <div class="card p-3" style="border-top:4px solid #16a34a"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Unités totales</div><div class="text-2xl font-black mt-1 text-emerald-700">${qty(kpi.totalUnites)}</div><div class="text-[11px] text-slate-400">en stock</div></div>
    <div class="card p-3" style="border-top:4px solid #043970"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Entrées (mois)</div><div class="text-2xl font-black mt-1 text-sky-700">+${qty(kpi.entreesMois)}</div><div class="text-[11px] text-slate-400">${money(kpi.valEntrees)} DA</div></div>
    <div class="card p-3" style="border-top:4px solid #dc2626"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Sorties (mois)</div><div class="text-2xl font-black mt-1 text-red-700">−${qty(kpi.sortiesMois)}</div><div class="text-[11px] text-slate-400">${money(kpi.valSorties)} DA</div></div>
    <div class="card p-3" style="border-top:4px solid ${kpi.enRupture>0?"#dc2626":(kpi.enAlerte>0?"#043970":"#16a34a")}"><div class="text-[10px] uppercase tracking-widest font-bold text-slate-500">Alertes</div><div class="text-2xl font-black mt-1" style="color:${kpi.enRupture>0?"#dc2626":(kpi.enAlerte>0?"#043970":"#16a34a")}">${kpi.enRupture+kpi.enAlerte}</div><div class="text-[11px] text-slate-400">${kpi.enRupture} rupt. · ${kpi.enAlerte} bas</div></div>
  </div>`;
}

function renderStockCatalogueTab(){
  const soc=stockGetSocFilter();
  const arts=stockArticlesFiltered();
  const filterCat=sessionStorage.getItem("stkCat")||"";
  const filterEtat=sessionStorage.getItem("stkEtat")||"";
  const cats=soc?stockGetCategoriesFor(soc):[].concat(...SOCIETES.map(s=>stockGetCategoriesFor(s).map(c=>({...c,_soc:s}))));
  const filtered=arts.filter(a=>{
    if(filterCat&&a.categorie!==filterCat)return false;
    if(filterEtat){const e=stockGetEtat(a);if(e.code!==filterEtat)return false}
    return true;
  });
  const catCounts={};
  arts.forEach(a=>{catCounts[a.categorie]=(catCounts[a.categorie]||0)+1});
  const catChips=cats.map(c=>{
    const count=catCounts[c.code]||0;
    const active=filterCat===c.code;
    return`<button type="button" onclick="stockSetFilter('Cat','${c.code===filterCat?"":c.code}')" class="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition" style="background:${active?c.color:c.color+"15"};color:${active?"#fff":c.color};border:1px solid ${c.color}55">${c.icon} ${escapeHTML(c.label)} <span style="background:${active?"#ffffff33":c.color+"22"};color:${active?"#fff":c.color};padding:1px 6px;border-radius:10px;margin-left:4px;font-size:10px">${count}</span></button>`;
  }).join("");
  const etatFilters=[["","Tous","#475569"],["ok","✓ OK","#16a34a"],["alerte","⚠ Bas","#043970"],["min","↓ < Min","#ca8a04"],["rupture","✕ Rupture","#dc2626"]];
  const etatBar=etatFilters.map(([k,l,c])=>{
    const active=filterEtat===k;
    return`<button type="button" onclick="stockSetFilter('Etat','${k}')" class="px-3 py-1.5 text-xs font-bold rounded-md transition" style="background:${active?c:"#fff"};color:${active?"#fff":c};border:1px solid ${c}66">${l}</button>`;
  }).join("");
  const headerFilters=`<div class="card p-3 mb-3">
    <div class="flex items-center justify-between gap-3 mb-2 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs uppercase font-bold text-slate-500">État stock :</span>
        ${etatBar}
      </div>
      <div class="text-xs text-slate-500">${filtered.length} / ${arts.length} article(s)</div>
    </div>
    <div class="flex items-start gap-2 flex-wrap">
      <span class="text-xs uppercase font-bold text-slate-500 pt-1.5 whitespace-nowrap">Catégorie :</span>
      <div class="flex gap-2 flex-wrap">${catChips||'<span class="text-xs text-slate-400 italic">Sélectionnez une société pour voir les catégories</span>'}</div>
    </div>
  </div>`;
  if(filtered.length===0){
    return headerFilters+`<div class="card p-12 text-center">
      <div class="text-6xl mb-3">📦</div>
      <div class="text-lg font-bold text-slate-700 mb-1">${arts.length===0?"Aucun article au catalogue":"Aucun article ne correspond aux filtres"}</div>
      <div class="text-sm text-slate-500 mb-4">${arts.length===0?(soc?`Commencez par ajouter des articles pour ${soc}.`:"Sélectionnez une société et ajoutez vos premiers articles."):""}</div>
      ${arts.length===0?`<button class="btn btn-primary" onclick="stockNouvelArticle()">➕ Ajouter un article</button>`:`<button class="btn btn-ghost" onclick="stockSetFilter('Cat','');stockSetFilter('Etat','')">Réinitialiser les filtres</button>`}
    </div>`;
  }
  const sortedArts=filtered.slice().sort((a,b)=>(a.designation||"").localeCompare(b.designation||""));
  const rows=sortedArts.map(a=>{
    const cat=stockGetCategorie(a.societe,a.categorie);
    const q=stockGetActuel(a.id);
    const etat=stockGetEtat(a);
    const val=q*(parseFloat(a.prixUnitaire)||0);
    const seuil=parseFloat(a.seuilAlerte)||0;
    const min=parseFloat(a.stockMin)||0;
    const max=parseFloat(a.stockMax)||0;
    const pctFill=max>0?Math.min(100,Math.round(q/max*100)):(seuil>0?Math.min(100,Math.round(q/(seuil*2)*100)):50);
    const meta=STOCK_SOC_META[a.societe]||{icon:"🏢",color:"#64748b"};
    return`<tr data-row data-cat="${escapeHTML(a.categorie)}" data-etat="${etat.code}" data-soc="${escapeHTML(a.societe||"")}" data-searchable class="hover:bg-slate-50">
      <td class="font-mono text-xs">${safe(a.code)}</td>
      <td>
        <div class="font-semibold">${escapeHTML(a.designation||"—")}</div>
        ${a.marque||a.modele?`<div class="text-[11px] text-slate-500">${escapeHTML([a.marque,a.modele].filter(Boolean).join(" · "))}</div>`:""}
      </td>
      <td><span class="pill" style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}55;font-weight:700">${cat.icon} ${escapeHTML(cat.label)}</span></td>
      <td class="text-xs whitespace-nowrap"><span style="color:${meta.color};font-weight:700">${meta.icon}</span> ${escapeHTML(a.societe||"—")}</td>
      <td class="text-center">
        <div class="font-black text-lg" style="color:${etat.color}">${qty(q)}</div>
        <div class="text-[10px] text-slate-400">${escapeHTML(a.unite||"unité")}</div>
      </td>
      <td>
        <div class="text-[10px] text-slate-500 mb-1 flex justify-between"><span>${min?"min "+min:""}</span><span>${max?"max "+max:""}</span></div>
        <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden">
          <div style="width:${pctFill}%;height:100%;background:${etat.color};transition:width .3s"></div>
        </div>
        <div class="text-[10px] text-center mt-1"><span class="pill" style="background:${etat.bg};color:${etat.color};border:1px solid ${etat.color}55;font-size:10px;font-weight:700">${etat.label}</span></div>
      </td>
      <td class="text-right text-xs font-semibold">${money(a.prixUnitaire)}</td>
      <td class="text-right">
        <div class="flex gap-1 justify-end">
          <button class="btn btn-ghost text-xs" title="Entrée" onclick="stockOpenMvt('entree','${a.id}')" style="color:#16a34a">📥</button>
          <button class="btn btn-ghost text-xs" title="Sortie" onclick="stockOpenMvt('sortie','${a.id}')" style="color:#dc2626">📤</button>
          <a class="btn btn-ghost text-xs" title="Détail" href="#/materiel/article/${a.id}">👁</a>
          <a class="btn btn-ghost text-xs" title="Modifier" href="#/materiel/article-edit/${a.id}">✏</a>
        </div>
      </td>
    </tr>`;
  }).join("");
  return headerFilters+`<div class="card overflow-hidden"><div class="overflow-x-auto"><table>
    <thead><tr>
      <th>Code</th><th>Désignation</th><th>Catégorie</th><th>Société</th>
      <th class="text-center">Stock</th><th>Niveau</th><th class="text-right">P.U. (DA)</th><th class="text-right">Actions</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>`;
}

function renderStockMvtTab(typeFilter){
  const soc=stockGetSocFilter();
  let mvts=stockMouvementsFiltered();
  if(typeFilter==="entree")mvts=mvts.filter(m=>stockMvtIsIn(m.type));
  else if(typeFilter==="sortie")mvts=mvts.filter(m=>stockMvtIsOut(m.type));
  const periode=sessionStorage.getItem("stkPeriode")||"30";
  const cutoff=periode==="all"||periode==="today"?"0000-00-00":new Date(Date.now()-parseInt(periode)*86400000).toISOString().slice(0,10);
  const inPeriod=periode==="today"?mvts.filter(m=>(m.date||"")===today()):mvts.filter(m=>(m.date||"")>=cutoff);
  const totalQty=inPeriod.reduce((s,m)=>s+(parseFloat(m.quantite)||0),0);
  const titleMap={entree:"📥 Entrées",sortie:"📤 Sorties",all:"🔄 Tous les mouvements"};
  const periodes=[["today","📅 Aujourd'hui"],["7","🗓 7 jours"],["30","📆 30 jours"],["90","🗂 90 jours"],["365","📚 12 mois"],["all","∞ Tout"]];
  const headerBar=`<div class="card p-3 mb-3 flex flex-wrap items-center gap-3 justify-between">
    <div class="flex items-center gap-3">
      <h3 class="font-bold">${titleMap[typeFilter]||"Mouvements"}</h3>
      <div class="flex gap-1 flex-wrap">${periodes.map(([k,l])=>`<button type="button" onclick="stockSetPeriode('${k}')" class="px-3 py-1 rounded-md text-xs font-bold transition" style="background:${periode===k?"#0f172a":"#fff"};color:${periode===k?"#fff":"#475569"};border:1px solid #cbd5e1">${l}</button>`).join("")}</div>
    </div>
    <div class="flex flex-wrap gap-3 text-xs items-center">
      <div><span class="text-slate-500">🔄 Total mouvements :</span> <b>${inPeriod.length}</b></div>
      <div><span class="text-slate-500">📦 Quantité :</span> <b style="color:${typeFilter==="sortie"?"#dc2626":"#16a34a"}">${typeFilter==="sortie"?"−":(typeFilter==="entree"?"+":"")}${qty(totalQty)}</b></div>
      <button class="btn btn-success text-xs" onclick="stockOpenMvt('${typeFilter==="sortie"?"sortie":"entree"}')">${typeFilter==="sortie"?"📤 Nouvelle sortie":"📥 Nouvelle entrée"}</button>
    </div>
  </div>`;
  if(inPeriod.length===0){
    return headerBar+`<div class="card p-12 text-center">
      <div class="text-6xl mb-3">${typeFilter==="entree"?"📥":(typeFilter==="sortie"?"📤":"🔄")}</div>
      <div class="text-lg font-bold text-slate-700 mb-2">Aucun mouvement</div>
      <div class="text-sm text-slate-500 mb-4">Aucun mouvement enregistré sur cette période${soc?` pour ${soc}`:""}.</div>
      <button class="btn btn-primary" onclick="stockOpenMvt('${typeFilter==="sortie"?"sortie":"entree"}')">${typeFilter==="sortie"?"📤":"📥"} Enregistrer ${typeFilter==="sortie"?"une sortie":"une entrée"}</button>
    </div>`;
  }
  const rows=inPeriod.map(m=>{
    const a=(db.stockArticles||[]).find(x=>x.id===m.articleId);
    const cat=a?stockGetCategorie(a.societe,a.categorie):null;
    const tColor=stockMvtTypeColor(m.type);
    const tIcon=stockMvtTypeIcon(m.type);
    const tLabel=stockMvtTypeLabel(m.type);
    const isOut=stockMvtIsOut(m.type);
    return`<tr data-searchable class="hover:bg-slate-50">
      <td class="text-xs">${formatDate(m.date)||"—"}</td>
      <td><span class="pill" style="background:${tColor}15;color:${tColor};border:1px solid ${tColor}55;font-weight:700">${tIcon} ${tLabel}</span></td>
      <td class="font-mono text-xs">${a?safe(a.code):"—"}</td>
      <td>
        ${a?`<a class="font-semibold hover:underline" href="#/materiel/article/${a.id}">${escapeHTML(a.designation)}</a>`:'<span class="text-slate-400 italic">— supprimé —</span>'}
        ${cat?`<div class="text-[10px] text-slate-500">${cat.icon} ${escapeHTML(cat.label)}</div>`:""}
      </td>
      <td class="text-center"><span class="font-bold text-lg" style="color:${tColor}">${isOut?"−":"+"}${qty(m.quantite)}</span> <span class="text-[10px] text-slate-400">${a?escapeHTML(a.unite||""):""}</span></td>
      <td class="text-right text-xs">${m.prixUnitaire?money(m.prixUnitaire):"—"}</td>
      <td class="text-xs">${escapeHTML(m.motif||"—")}${m.beneficiaireNom?`<div class="text-[10px] text-slate-500">→ ${escapeHTML(m.beneficiaireNom)}</div>`:""}${m.retourAgentNom?`<div class="text-[10px] text-slate-500">↩ ${escapeHTML(m.retourAgentNom)}</div>`:""}${m.fournisseur?`<div class="text-[10px] text-slate-500">← ${escapeHTML(m.fournisseur)}</div>`:""}</td>
      <td class="text-xs font-mono text-slate-500">${safe(m.numeroBon)}</td>
      <td class="text-right">
        <button class="btn btn-ghost text-xs" title="Détail du mouvement" onclick="stockShowMvt('${m.id}')">👁 Détail</button>
      </td>
    </tr>`;
  }).join("");
  return headerBar+`<div class="card overflow-hidden"><div class="overflow-x-auto"><table>
    <thead><tr>
      <th>Date</th><th>Type</th><th>Code</th><th>Article</th><th class="text-center">Qté</th><th class="text-right">P.U.</th><th>Motif / Tiers</th><th>N° Bon</th><th class="text-right">Détail</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>`;
}

function renderStockAlertesTab(){
  const arts=stockArticlesFiltered();
  const ruptures=arts.filter(a=>stockGetEtat(a).code==="rupture");
  const alertes=arts.filter(a=>{const e=stockGetEtat(a);return e.code==="alerte"||e.code==="min"});
  const dormants=arts.filter(a=>{
    const mvts=stockGetMouvements(a.id);
    if(mvts.length===0)return stockGetActuel(a.id)>0;
    const last=mvts[0].date||"0000-00-00";
    const cutoff=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
    return last<cutoff&&stockGetActuel(a.id)>0;
  });
  const surstock=arts.filter(a=>{const max=parseFloat(a.stockMax)||0;return max>0&&stockGetActuel(a.id)>max});
  const renderList=(list,emptyMsg,colorScheme)=>{
    if(list.length===0)return`<div class="text-center text-sm text-slate-500 py-6">${emptyMsg}</div>`;
    return`<div class="space-y-2">${list.map(a=>{
      const cat=stockGetCategorie(a.societe,a.categorie);
      const q=stockGetActuel(a.id);
      const meta=STOCK_SOC_META[a.societe]||{icon:"🏢",color:"#64748b"};
      const seuil=parseFloat(a.seuilAlerte)||0;
      return`<div class="card p-3 hover:shadow transition" style="border-left:4px solid ${colorScheme.color};background:${colorScheme.bg}">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono text-xs text-slate-500">${safe(a.code)}</span>
              <a class="font-bold hover:underline" href="#/materiel/article/${a.id}">${escapeHTML(a.designation)}</a>
              <span class="pill" style="background:${cat.color}22;color:${cat.color};font-size:10px;border:1px solid ${cat.color}55">${cat.icon} ${escapeHTML(cat.label)}</span>
              <span class="text-[11px]" style="color:${meta.color}">${meta.icon} ${escapeHTML(a.societe||"—")}</span>
            </div>
            <div class="text-xs text-slate-600 mt-1">Stock : <b style="color:${colorScheme.color}">${qty(q)} ${escapeHTML(a.unite||"")}</b>${seuil?` · Seuil : ${qty(seuil)}`:""}${a.stockMin?` · Min : ${qty(a.stockMin)}`:""}${a.stockMax?` · Max : ${qty(a.stockMax)}`:""}${a.fournisseur?` · 🏪 ${escapeHTML(a.fournisseur)}`:""}</div>
          </div>
          <div class="flex gap-1">
            <button class="btn btn-success text-xs" onclick="stockOpenMvt('entree','${a.id}')">📥 Entrée</button>
            <a class="btn btn-ghost text-xs" href="#/materiel/article/${a.id}">👁</a>
          </div>
        </div>
      </div>`;
    }).join("")}</div>`;
  };
  return`<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div class="card p-4" style="border-top:4px solid #dc2626">
      <h3 class="font-bold text-red-700 mb-3 flex items-center gap-2"><span style="font-size:24px">✕</span> Ruptures de stock <span class="pill" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca">${ruptures.length}</span></h3>
      ${renderList(ruptures,"✓ Aucune rupture — situation normale.",{color:"#dc2626",bg:"#fef2f2"})}
    </div>
    <div class="card p-4" style="border-top:4px solid #d97706">
      <h3 class="font-bold mb-3 flex items-center gap-2" style="color:#b45309"><span style="font-size:24px">⚠</span> Stocks bas / sous minimum <span class="pill" style="background:#fffbeb;color:#b45309;border:1px solid #fed7aa">${alertes.length}</span></h3>
      ${renderList(alertes,"✓ Aucun stock bas.",{color:"#b45309",bg:"#fffbeb"})}
    </div>
    <div class="card p-4" style="border-top:4px solid #ca8a04">
      <h3 class="font-bold mb-3 flex items-center gap-2" style="color:#ca8a04"><span style="font-size:24px">💤</span> Articles dormants (>90 jours) <span class="pill" style="background:#fefce8;color:#ca8a04;border:1px solid #fde68a">${dormants.length}</span></h3>
      ${renderList(dormants,"Aucun article dormant.",{color:"#ca8a04",bg:"#fefce8"})}
    </div>
    <div class="card p-4" style="border-top:4px solid #7c3aed">
      <h3 class="font-bold mb-3 flex items-center gap-2" style="color:#7c3aed"><span style="font-size:24px">📦</span> Surstock (> max) <span class="pill" style="background:#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe">${surstock.length}</span></h3>
      ${renderList(surstock,"Aucun surstock détecté.",{color:"#7c3aed",bg:"#f5f3ff"})}
    </div>
  </div>`;
}

function renderStockStatistiquesTab(){
  const soc=stockGetSocFilter();
  const arts=stockArticlesFiltered();
  const mvts=stockMouvementsFiltered();
  const totalArticles=arts.length;
  const totalQty=arts.reduce((s,a)=>s+stockGetActuel(a.id),0);
  const totalVal=arts.reduce((s,a)=>s+stockGetValeur(a.id),0);
  // Par catégorie
  const parCat={};
  arts.forEach(a=>{
    const cat=stockGetCategorie(a.societe,a.categorie);
    const k=a.categorie||"autre";
    if(!parCat[k])parCat[k]={cat,n:0,qty:0,val:0};
    parCat[k].n++;
    const q=stockGetActuel(a.id);
    parCat[k].qty+=q;
    parCat[k].val+=q*(parseFloat(a.prixUnitaire)||0);
  });
  const catEntries=Object.values(parCat).sort((a,b)=>b.val-a.val);
  // Par société
  const parSoc=SOCIETES.map(s=>{
    const list=(db.stockArticles||[]).filter(a=>a.societe===s);
    const qty=list.reduce((sum,a)=>sum+stockGetActuel(a.id),0);
    const val=list.reduce((sum,a)=>sum+stockGetValeur(a.id),0);
    return{s,n:list.length,qty,val};
  });
  // Top entrants & sortants (90 derniers jours)
  const cutoff=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
  const recentMvts=mvts.filter(m=>(m.date||"")>=cutoff);
  const topEntrants={};
  const topSortants={};
  recentMvts.forEach(m=>{
    const a=(db.stockArticles||[]).find(x=>x.id===m.articleId);if(!a)return;
    const q=parseFloat(m.quantite)||0;
    if(m.type==="entree"){topEntrants[a.id]=(topEntrants[a.id]||{a,q:0});topEntrants[a.id].q+=q}
    else if(stockMvtIsOut(m.type)){topSortants[a.id]=(topSortants[a.id]||{a,q:0});topSortants[a.id].q+=q}
  });
  const topE=Object.values(topEntrants).sort((a,b)=>b.q-a.q).slice(0,10);
  const topS=Object.values(topSortants).sort((a,b)=>b.q-a.q).slice(0,10);
  // Évolution par mois (12 derniers mois)
  const months=[];
  for(let i=11;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);months.push({k:d.toISOString().slice(0,7),label:d.toLocaleDateString("fr-FR",{month:"short",year:"2-digit"})})}
  const monthData=months.map(m=>{
    const list=mvts.filter(x=>(x.date||"").startsWith(m.k));
    const e=list.filter(x=>x.type==="entree").reduce((s,x)=>s+(parseFloat(x.quantite)||0),0);
    const s=list.filter(x=>stockMvtIsOut(x.type)).reduce((sum,x)=>sum+(parseFloat(x.quantite)||0),0);
    return{...m,e,s};
  });
  const maxMonth=Math.max(1,...monthData.map(m=>Math.max(m.e,m.s)));
  const bars=(entries,colorFn)=>{
    if(!entries.length)return`<div class="text-sm text-slate-400 italic py-4 text-center">Aucune donnée.</div>`;
    const max=Math.max(1,...entries.map(e=>e.value));
    return entries.map(e=>{
      const pct=Math.round(e.value/max*100);
      const c=typeof colorFn==="function"?colorFn(e):colorFn;
      return`<div class="text-sm mb-2">
        <div class="flex justify-between mb-1 text-xs"><span class="font-medium">${e.icon||""} ${escapeHTML(e.label)}</span><span class="text-slate-500"><b>${qty(e.value)}</b>${e.suffix||""}</span></div>
        <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${c};border-radius:4px;transition:width .3s"></div></div>
      </div>`;
    }).join("");
  };
  const topList=(list,color)=>{
    if(!list.length)return`<div class="text-sm text-slate-400 italic py-4 text-center">Aucun mouvement sur 90 jours.</div>`;
    const max=Math.max(1,...list.map(x=>x.q));
    return list.map((x,i)=>{
      const cat=stockGetCategorie(x.a.societe,x.a.categorie);
      const pct=Math.round(x.q/max*100);
      return`<div class="text-sm mb-2">
        <div class="flex justify-between mb-1"><span class="font-medium"><b class="text-slate-400 mr-1">${i+1}.</b> ${cat.icon} <a class="hover:underline" href="#/materiel/article/${x.a.id}">${escapeHTML(x.a.designation)}</a></span><span class="text-slate-700 font-bold">${qty(x.q)}</span></div>
        <div style="height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${color}"></div></div>
      </div>`;
    }).join("");
  };
  const monthChart=`<div class="overflow-x-auto"><div style="display:flex;align-items:flex-end;gap:8px;min-height:200px;padding:10px;border-bottom:2px solid #e2e8f0">${monthData.map(m=>{
    const eh=Math.round(m.e/maxMonth*150);
    const sh=Math.round(m.s/maxMonth*150);
    return`<div style="flex:1;min-width:50px;display:flex;flex-direction:column;align-items:center;gap:2px">
      <div style="display:flex;align-items:flex-end;gap:3px;height:160px;width:100%;justify-content:center">
        <div title="Entrées : ${m.e}" style="width:14px;height:${eh}px;background:linear-gradient(180deg,#16a34a,#15803d);border-radius:3px 3px 0 0;min-height:2px;cursor:pointer"></div>
        <div title="Sorties : ${m.s}" style="width:14px;height:${sh}px;background:linear-gradient(180deg,#dc2626,#991b1b);border-radius:3px 3px 0 0;min-height:2px;cursor:pointer"></div>
      </div>
      <div class="text-[10px] font-bold text-slate-600">${escapeHTML(m.label)}</div>
      <div class="text-[9px] text-slate-400">${m.e}/${m.s}</div>
    </div>`;
  }).join("")}</div></div>
  <div class="flex justify-center gap-4 text-xs text-slate-600 mt-2"><span class="flex items-center gap-1"><span style="width:12px;height:12px;background:#16a34a;border-radius:2px"></span> Entrées</span><span class="flex items-center gap-1"><span style="width:12px;height:12px;background:#dc2626;border-radius:2px"></span> Sorties</span></div>`;
  return`<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
    <div class="card p-5 text-center" style="background:linear-gradient(135deg,#0f172a08,#0f172a02)"><div class="text-xs uppercase font-bold text-slate-500 tracking-widest">Articles au catalogue</div><div class="text-4xl font-black mt-2">${totalArticles}</div></div>
    <div class="card p-5 text-center" style="background:linear-gradient(135deg,#16a34a15,#16a34a05)"><div class="text-xs uppercase font-bold text-emerald-700 tracking-widest">Unités en stock</div><div class="text-4xl font-black mt-2 text-emerald-700">${qty(totalQty)}</div></div>
  </div>
  <div class="card p-5 mb-4">
    <h3 class="font-bold mb-3">📊 Évolution des mouvements (12 mois)</h3>
    ${monthChart}
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
    <div class="card p-5">
      <h3 class="font-bold mb-3">🏷 Répartition par catégorie ${soc?`(${escapeHTML(soc)})`:""}</h3>
      ${bars(catEntries.map(c=>({label:c.cat.label,icon:c.cat.icon,value:c.qty,suffix:" unité(s)"})),(e)=>{const c=catEntries.find(x=>x.cat.label===e.label.replace(/^.+ /,""));return c?c.cat.color:"#043970"})}
    </div>
    <div class="card p-5">
      <h3 class="font-bold mb-3">🏢 Répartition par société</h3>
      ${bars(parSoc.map(r=>({label:r.s,icon:STOCK_SOC_META[r.s]?.icon,value:r.qty,suffix:" unité(s)"})),(e)=>STOCK_SOC_META[e.label]?.color||"#475569")}
    </div>
    <div class="card p-5">
      <h3 class="font-bold mb-3">📥 Top 10 articles entrants (90j)</h3>
      ${topList(topE,"#16a34a")}
    </div>
    <div class="card p-5">
      <h3 class="font-bold mb-3">📤 Top 10 articles sortants (90j)</h3>
      ${topList(topS,"#dc2626")}
    </div>
  </div>
  <div class="card p-0 overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="bg-slate-50"><tr>
        <th class="text-left p-3">Catégorie</th>
        <th class="p-3 text-center">Articles</th>
        <th class="p-3 text-center">Unités</th>
      </tr></thead>
      <tbody>${catEntries.map(c=>`<tr class="border-t hover:bg-slate-50">
        <td class="p-3 font-semibold"><span class="pill" style="background:${c.cat.color}22;color:${c.cat.color};border:1px solid ${c.cat.color}55">${c.cat.icon} ${escapeHTML(c.cat.label)}</span></td>
        <td class="p-3 text-center">${c.n}</td>
        <td class="p-3 text-center text-emerald-700 font-semibold">${qty(c.qty)}</td>
      </tr>`).join("")||`<tr><td class="p-6 text-center text-slate-500" colspan="3">Aucun article au catalogue.</td></tr>`}
      <tr class="border-t bg-slate-50 font-bold">
        <td class="p-3">TOTAL</td>
        <td class="p-3 text-center">${totalArticles}</td>
        <td class="p-3 text-center text-emerald-700">${qty(totalQty)}</td>
      </tr></tbody>
    </table>
  </div>`;
}

function renderStockArticleDetail(view,id){
  const a=(db.stockArticles||[]).find(x=>x.id===id);
  if(!a){toast("Article introuvable","error");return navigate("materiel/inventaire")}
  const cat=stockGetCategorie(a.societe,a.categorie);
  const meta=STOCK_SOC_META[a.societe]||{icon:"🏢",color:"#64748b",metier:""};
  const q=stockGetActuel(id);
  const valeur=q*(parseFloat(a.prixUnitaire)||0);
  const etat=stockGetEtat(a);
  const mvts=stockGetMouvements(id);
  const totalE=mvts.filter(m=>stockMvtIsIn(m.type)).reduce((s,m)=>s+(parseFloat(m.quantite)||0),0);
  const totalS=mvts.filter(m=>stockMvtIsOut(m.type)).reduce((s,m)=>s+(parseFloat(m.quantite)||0),0);
  const attrs=a.attributs||{};
  const attrPairs=Object.entries(attrs).filter(([k,v])=>v).map(([k,v])=>`<div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">${escapeHTML(k)}</span><span class="font-semibold">${escapeHTML(String(v))}</span></div>`).join("");
  const variantes=Array.isArray(a.stockReceptionsGlobales)&&a.stockReceptionsGlobales.some(r=>Array.isArray(r.details)&&r.details.length)?stockReceptionDetailRows(a.stockReceptionsGlobales):(Array.isArray(a.stockVariantes)?a.stockVariantes:[]);
  const variantesHTML=variantes.length?`<div class="mt-3 pt-3 border-t"><div class="text-xs uppercase text-slate-500 font-bold mb-2">Répartition taille / pointure</div><div class="overflow-x-auto"><table class="w-full text-sm"><thead style="background:#f8fafc"><tr><th class="p-2 text-right">Quantité reçue</th><th class="p-2 text-left">Taille / Pointure</th><th class="p-2 text-right">Prix unitaire</th><th class="p-2 text-left">Date réception</th></tr></thead><tbody>${variantes.map(r=>`<tr class="border-t"><td class="p-2 text-right font-bold">${qty(r.quantite)}</td><td class="p-2 font-semibold">${escapeHTML(r.valeur||"—")} <span class="text-[10px] text-slate-400">(${escapeHTML(r.type||"—")})</span></td><td class="p-2 text-right text-xs">${r.prixUnitaire?formatMoneyInputValue(r.prixUnitaire)+" DZD":"—"}</td><td class="p-2 text-xs">${formatDate(r.dateReception)}</td></tr>`).join("")}<tr class="border-t bg-slate-50 font-bold"><td class="p-2 text-right">${qty(stockVariantesTotal(variantes))}</td><td class="p-2" colspan="3">TOTAL</td></tr></tbody></table></div></div>`:"";
  view.innerHTML=`<div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <div class="flex items-center gap-3">
        <button class="btn btn-ghost" onclick="navigate('materiel/inventaire')">← Retour</button>
        <div>
          <h1 class="text-2xl font-bold">${cat.icon} ${escapeHTML(a.designation)}</h1>
          <div class="text-xs text-slate-500 font-mono">${safe(a.code)} · ${safe(a.reference)}</div>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-success" onclick="stockOpenMvt('entree','${a.id}')">📥 Entrée</button>
        <button class="btn btn-secondary" style="background:#dc2626;color:#fff" onclick="stockOpenMvt('sortie','${a.id}')">📤 Sortie</button>
        <a class="btn btn-secondary" href="#/materiel/article-edit/${a.id}">✏ Modifier</a>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
      <div class="card p-4 text-center" style="background:linear-gradient(135deg,${etat.bg},#fff);border-top:4px solid ${etat.color}">
        <div class="text-xs uppercase font-bold text-slate-500">Stock actuel</div>
        <div class="text-4xl font-black mt-1" style="color:${etat.color}">${qty(q)}</div>
        <div class="text-xs text-slate-500">${escapeHTML(a.unite||"unité")}</div>
        <div class="mt-2"><span class="pill" style="background:${etat.color};color:#fff;font-weight:700">${etat.label}</span></div>
      </div>
      <div class="card p-4 text-center" style="border-top:4px solid #16a34a"><div class="text-xs uppercase font-bold text-slate-500">Total entrées</div><div class="text-3xl font-black mt-1 text-emerald-700">+${qty(totalE)}</div><div class="text-xs text-slate-500">cumulé</div></div>
      <div class="card p-4 text-center" style="border-top:4px solid #dc2626"><div class="text-xs uppercase font-bold text-slate-500">Total sorties</div><div class="text-3xl font-black mt-1 text-red-700">−${qty(totalS)}</div><div class="text-xs text-slate-500">cumulé</div></div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      <div class="card p-5 lg:col-span-2">
        <h3 class="font-bold mb-3">📋 Informations détaillées</h3>
        <div class="grid grid-cols-2 gap-x-4">
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Société</span><span class="font-semibold" style="color:${meta.color}">${meta.icon} ${escapeHTML(a.societe||"—")}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Catégorie</span><span class="font-semibold" style="color:${cat.color}">${cat.icon} ${escapeHTML(cat.label)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Sous-catégorie</span><span class="font-semibold">${safe(a.sousCategorie)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Marque</span><span class="font-semibold">${safe(a.marque)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Modèle</span><span class="font-semibold">${safe(a.modele)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Référence</span><span class="font-semibold font-mono">${safe(a.reference)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Code-barre</span><span class="font-semibold font-mono">${safe(a.codeBarre)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Unité</span><span class="font-semibold">${safe(a.unite)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Prix unitaire</span><span class="font-semibold text-amber-700">${money(a.prixUnitaire)} DA</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Qte gle reçue</span><span class="font-semibold">${qty(a.quantiteGlobaleRecue)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Date réception globale</span><span class="font-semibold">${formatDate(a.dateReceptionGlobale)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Stock initial</span><span class="font-semibold">${qty(a.stockInitial)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Stock min / max</span><span class="font-semibold">${qty(a.stockMin)} / ${qty(a.stockMax)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Seuil alerte</span><span class="font-semibold">${qty(a.seuilAlerte)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Emplacement</span><span class="font-semibold">${safe(a.emplacement)}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Fournisseur</span><span class="font-semibold">${safe(a.fournisseur)}</span></div>
          ${attrPairs}
        </div>
        ${variantesHTML}
        ${a.description?`<div class="mt-3 pt-3 border-t"><div class="text-xs uppercase text-slate-500 font-bold mb-1">Description</div><div class="text-sm">${escapeHTML(a.description)}</div></div>`:""}
        ${a.notes?`<div class="mt-3 pt-3 border-t"><div class="text-xs uppercase text-slate-500 font-bold mb-1">Notes</div><div class="text-sm whitespace-pre-wrap">${escapeHTML(a.notes)}</div></div>`:""}
      </div>
      <div class="card p-5">
        <h3 class="font-bold mb-3">📅 Métadonnées</h3>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Date création</span><span class="font-semibold">${a.dateCreation?formatDate(a.dateCreation):"—"}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Dernière MAJ</span><span class="font-semibold">${a.derniereMaj?formatDate(a.derniereMaj):"—"}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Total mouvements</span><span class="font-semibold">${mvts.length}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Dernier mvt.</span><span class="font-semibold text-xs">${mvts[0]?formatDate(mvts[0].date):"—"}</span></div>
          <div class="flex justify-between py-1.5 border-b border-slate-100"><span class="text-xs uppercase text-slate-500 font-bold">Statut</span><span class="font-semibold">${a.actif!==false?"<span class='text-emerald-600'>✓ Actif</span>":"<span class='text-slate-400'>Archivé</span>"}</span></div>
        </div>
      </div>
    </div>
    <div class="card p-5">
      <h3 class="font-bold mb-3">🔄 Historique des mouvements (${mvts.length})</h3>
      ${mvts.length===0?`<div class="text-center text-slate-500 py-6">Aucun mouvement enregistré pour cet article.</div>`:`<div class="overflow-x-auto"><table class="w-full text-sm">
        <thead class="bg-slate-50"><tr>
          <th class="text-left p-2">Date</th><th class="text-left p-2">Type</th><th class="p-2 text-center">Qté</th><th class="p-2 text-right">P.U.</th><th class="text-left p-2">Motif / Tiers</th><th class="text-left p-2">Bon</th><th class="text-left p-2">Notes</th>
        </tr></thead>
        <tbody>${mvts.map(m=>{
          const tColor=stockMvtTypeColor(m.type),tIcon=stockMvtTypeIcon(m.type),tLabel=stockMvtTypeLabel(m.type);
          const isOut=stockMvtIsOut(m.type);
          return`<tr class="border-t hover:bg-slate-50">
            <td class="p-2 text-xs">${formatDate(m.date)||"—"}</td>
            <td class="p-2"><span class="pill" style="background:${tColor}15;color:${tColor};border:1px solid ${tColor}55;font-weight:700">${tIcon} ${tLabel}</span></td>
            <td class="p-2 text-center font-bold" style="color:${tColor}">${isOut?"−":"+"}${qty(m.quantite)}</td>
            <td class="p-2 text-right text-xs">${m.prixUnitaire?money(m.prixUnitaire):"—"}</td>
            <td class="p-2 text-xs">${escapeHTML(m.motif||"—")}${m.beneficiaireNom?`<div class="text-[10px] text-slate-500">→ ${escapeHTML(m.beneficiaireNom)}</div>`:""}${m.retourAgentNom?`<div class="text-[10px] text-slate-500">↩ ${escapeHTML(m.retourAgentNom)}</div>`:""}${m.fournisseur?`<div class="text-[10px] text-slate-500">← ${escapeHTML(m.fournisseur)}</div>`:""}</td>
            <td class="p-2 text-xs font-mono">${safe(m.numeroBon)}</td>
            <td class="p-2 text-xs text-slate-500">${escapeHTML((m.notes||"").substring(0,40))}</td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`}
    </div>`;
}

async function renderStockArticleForm(view,id){
  sgdiShowDataLoadingBar("Chargement des magasins et fournisseurs...");
  await Promise.all([loadStoresForArticleForm(),loadSuppliersForArticleForm()]);
  const isNew=!id;
  let a=isNew?{id:uid("stk"),code:"",designation:"",categorie:"",sousCategorie:"",societe:stockGetSocFilter()||"",marque:"",modele:"",reference:"",codeBarre:"",unite:"Pièce",prixUnitaire:"",coutAchat:"",dureeVieMois:"",etatArticle:"neuf",quantiteGlobaleRecue:"",dateReceptionGlobale:"",stockReceptionsGlobales:[],stockInitial:0,stockVariantes:[],stockMin:"",stockMax:"",seuilAlerte:"",emplacement:"",fournisseur:"",description:"",notes:"",attributs:{},dateCreation:today(),actif:true}:(db.stockArticles||[]).find(x=>x.id===id);
  if(!a){toast("Article introuvable","error");return navigate("materiel/inventaire")}
  if(isNew){
    const preselectMagasinId=sessionStorage.getItem("stockArticlePreselectMagasinId")||"";
    const preselectMagasin=(db.magasins||[]).find(m=>String(m.id)===String(preselectMagasinId));
    if(preselectMagasin){
      a.magasinId=preselectMagasin.id;
      a.categorie=preselectMagasin.nom||"Magasin";
      if(preselectMagasin.societe)a.societe=preselectMagasin.societe;
    }
    sessionStorage.removeItem("stockArticlePreselectMagasinId");
  }
  const soc=a.societe||stockGetSocFilter()||"";
  const isHabillement=stockIsHabillementCategory(a.magasinId||a.categorie);
  view.innerHTML=`<div class="max-w-6xl mx-auto mat-shell">
    <div class="mat-hero">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1>${isNew?"Nouvel article au catalogue":"Modifier l'article"}</h1>
          <p>Gestion professionnelle du matériel : identification, fournisseur, stock, dotation et traçabilité.</p>
        </div>
        <button class="btn btn-ghost" style="background:#fff;color:#0f172a;border-color:#fff" onclick="navigate('materiel/inventaire')">Retour</button>
      </div>
    </div>
    <form id="stock-article-form" data-stock-article-id="${escapeHTML(a.id||"")}" data-stock-article-new="${isNew?"1":"0"}">
      <div class="mat-form-band"><div class="mat-form-band-title">Identification article</div>
        <div class="grid grid-cols-1 md:grid-cols-6 gap-3">
          ${mySoc()?`<input type="hidden" name="societe" value="${escapeHTML(soc)}"/>`:`<div class="md:col-span-2"><label class="label">Société propriétaire *</label><select class="select" name="societe" onchange="document.getElementById('stock-article-form').dispatchEvent(new Event('change'));stockReloadCatOptions(this.value)"><option value="">— Choisir —</option>${SOCIETES.map(s=>`<option ${a.societe===s?"selected":""}>${s}</option>`).join("")}</select></div>`}
          <div class="${mySoc()?"md:col-span-6":"md:col-span-4"}"><label class="label">Magasin *</label><select class="select" name="categorie" id="stk-cat-select"  onchange="stockCategorieChanged(this)">${soc?stockMagasinCategorieOptionsHTML(soc,a.magasinId||a.categorie):`<option value="">— Sélectionnez d'abord une société —</option>`}</select></div>
          <input type="hidden" name="designation" value="${escapeHTML(a.designation||"")}"/>
          <input type="hidden" name="code" value="${escapeHTML(a.code||"")}"/>
          <input type="hidden" name="magasinId" value="${escapeHTML(a.magasinId||"")}"/>
          <input type="hidden" name="etatArticle" value="${escapeHTML(a.etatArticle||"neuf")}"/>
          <input type="hidden" name="coutAchat" value="${escapeHTML(a.coutAchat||"")}"/>
          <input type="hidden" name="dureeVieMois" value="${escapeHTML(a.dureeVieMois||"")}"/>
          <input type="hidden" name="emplacement" value="${escapeHTML(a.emplacement||"")}"/>
          <div class="md:col-span-4"><label class="label">🤝 Fournisseur principal</label><select class="select" name="fournisseurId"><option value="">— Aucun fournisseur —</option>${(db.fournisseurs||[]).map(f=>`<option value="${f.id}" ${a.fournisseurId===f.id?"selected":""}>${escapeHTML(f.raisonSociale)}</option>`).join("")}</select><div class="text-[10px] text-slate-400 mt-1">Pas de fournisseur ? <a href="#/materiel/fournisseur-nouveau" class="text-amber-600 underline">+ Créer un fournisseur</a></div></div>
          <div class="md:col-span-2"><label class="label">Marque</label><input class="input" name="marque" value="${escapeHTML(a.marque||"")}" placeholder="ex: 5.11 Tactical"/></div>
          <div class="md:col-span-2"><label class="label">Modèle</label><input class="input" name="modele" value="${escapeHTML(a.modele||"")}" placeholder="ex: Stryke v2"/></div>
          <div class="md:col-span-2"><label class="label">Référence</label><input class="input font-mono" name="reference" value="${escapeHTML(a.reference||"")}" placeholder="ex: REF-456-XL"/></div>
          <div class="md:col-span-2"><label class="label">Code-barre / EAN</label><input class="input font-mono" name="codeBarre" value="${escapeHTML(a.codeBarre||"")}" placeholder="ex: 3000123456789"/></div>
        </div>
      </div>
      <div class="mat-form-band"><div class="mat-form-band-title">Stock & quantités</div>
        <div class="grid grid-cols-1 gap-2 mb-3">
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-secondary text-xs whitespace-nowrap h-[42px]" onclick="stockAddGlobalStockRow()">Ajouter nouveau stock</button>
          </div>
          <div class="flex flex-wrap items-start gap-2">
            <div id="stk-global-stock-rows">${stockGlobalStockRowsHTML(a)}</div>
            <div class="w-[200px] ml-auto -mt-12"><label class="label">MON STOCK ACTUEL</label><input id="stk-global-current-stock" class="input text-center bg-slate-50 font-bold text-[20px]" type="number" value="${stockGlobalStockTotal(stockGlobalStockRowsFromArticle(a))||0}" readonly/></div>
          </div>
        </div>
        <div class="flex flex-wrap items-start gap-2">
          <div id="stk-stock-fields" style="display:${isHabillement?"none":"contents"}">
            <div class="w-[120px]"><label class="label">Quantité reçue</label><input class="input" type="number" min="0" step="1" name="stockInitial" value="${parseInt(a.stockInitial)||0}" placeholder="00"/></div>
            <div class="w-[120px]"><label class="label">Stock minimum</label><input class="input" type="number" step="0.01" name="stockMin" value="${a.stockMin||""}" placeholder="0"/></div>
            <div class="w-[120px]"><label class="label">Stock maximum</label><input class="input" type="number" step="0.01" name="stockMax" value="${a.stockMax||""}" placeholder="0"/></div>
            <div class="w-[120px]"><label class="label">Seuil d'alerte</label><input class="input" type="number" step="0.01" name="seuilAlerte" value="${a.seuilAlerte||""}" placeholder="0"/></div>
          </div>
        </div>
        <div id="stk-variant-rows" class="hidden">${stockVariantRowsHTML(a.stockVariantes)}</div>
        <div id="stk-stock-help" class="text-xs text-slate-500 mt-2" style="display:${isHabillement?"none":"block"}">💡 Le stock actuel est calculé automatiquement à partir du stock initial et de tous les mouvements (entrées/sorties). Le seuil d'alerte déclenche une notification visuelle quand le stock devient bas.</div>
        <div id="stk-stock-help-hab" class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-2" style="display:${isHabillement?"block":"none"}"><b>Articles d'habillement & EPI</b> : pas de stock global numérique — le suivi se fait par taille, pointure, couleur et dimensions.</div>
      </div>
      <div class="mat-form-band"><div class="mat-form-band-title">Description & notes</div>
        <div class="grid grid-cols-1 gap-3">
          <div><label class="label">Description</label><textarea class="input" name="description" rows="2" placeholder="Description courte du produit">${escapeHTML(a.description||"")}</textarea></div>
          <div><label class="label">Notes internes</label><textarea class="input" name="notes" rows="3" placeholder="Remarques, instructions de stockage, garantie...">${escapeHTML(a.notes||"")}</textarea></div>
        </div>
      </div>
      <div class="card p-4 flex justify-between items-center gap-2">
        <div></div>
        <div class="flex gap-2"><button type="button" class="btn btn-ghost" onclick="navigate('materiel/inventaire')">Annuler</button><button type="submit" id="stk-art-save-btn" class="btn btn-primary" onclick="event.preventDefault();stockSaveArticle('${a.id}',${isNew?"true":"false"})">💾 Enregistrer</button></div>
      </div>
    </form>
  </div>`;
  // Defensive: also attach via JS in case inline handlers misbehave
  setTimeout(()=>{
    const f=document.getElementById("stock-article-form");
    if(f&&!f._wired){f._wired=true;f.addEventListener("submit",e=>{e.preventDefault();stockSaveArticle(a.id,isNew?"true":"false")});}
    const b=document.getElementById("stk-art-save-btn");
    if(b&&!b._wired){b._wired=true;}
  },0);
}

function stockIsHabillementCategory(catCode){
  const mag=(db?.magasins||[]).find(m=>String(m.id)===String(catCode||"")||String(m.nom||"")===String(catCode||"")||String(m.typeMagasin||"")===String(catCode||""));
  const text=[catCode,mag?.nom,dotationMagasinType(mag)].filter(Boolean).join(" ");
  return ["unif","epi","epilog","epibtp"].includes(String(catCode||""))||/(habillement|tenue|casquette|parkas?|blouson|chandail|polo|tee\s*shirt|ceinture|ceinturon|gilet|gants)/i.test(text);
}

function stockSousCategorieValues(value){
  return String(value||"").split("||").map(x=>x.trim()).filter(Boolean);
}

function stockArticlesForMagasin(mag){
  if(!mag)return[];
  return (db.stockArticles||[]).filter(a=>{
    return stockArticleBelongsToStore(a,mag);
  }).sort((a,b)=>(a.designation||a.sousCategorie||"").localeCompare(b.designation||b.sousCategorie||""));
}

function stockAutoArticleDesignation(a){
  return String(a?.sousCategorie||stockGetCategorie(a?.societe,a?.categorie).label||a?.designation||a?.code||"Article").trim()||"Article";
}

function stockSousCategorieSuggestions(catCode){
  const mag=(db.magasins||[]).find(m=>String(m.id)===String(catCode||"")||String(m.nom||"")===String(catCode||""));
  const values=[];
  if(mag){
    if(Array.isArray(mag.sousCategories))values.push(...mag.sousCategories);
    if(Array.isArray(mag.config?.sousCategories))values.push(...mag.config.sousCategories);
    stockArticlesForMagasin(mag).forEach(a=>{
      if(a.sousCategorie)values.push(a.sousCategorie);
    });
  }
  const seen=new Set();
  return values.map(v=>String(v||"").trim()).filter(v=>{
    const k=v.toLowerCase();
    if(!v||seen.has(k))return false;
    seen.add(k);
    return true;
  }).sort((a,b)=>a.localeCompare(b));
}

function stockSousCategoriePickerHTML(catCode,selected){
  const list=stockSousCategorieSuggestions(catCode);
  const val=stockSousCategorieValues(selected)[0]||"";
  const listId=`stk-subcat-list-${String(catCode||"none").replace(/[^a-z0-9_-]/gi,"")}`;
  return `<input class="input" name="sousCategorie" id="stk-subcat-select" list="${listId}" value="${escapeHTML(val)}" placeholder="${list.length?"Choisir ou saisir une famille":"Saisir une nouvelle famille"}" oninput="stockSousCategorieChanged(this)"/><datalist id="${listId}">${list.map(x=>`<option value="${escapeHTML(x)}"></option>`).join("")}</datalist><div class="text-[10px] text-slate-400 mt-1">${list.length?`${list.length} suggestion(s) disponibles. Saisie libre autorisée.`:"Aucune famille existante : créez-la librement."}</div>`;
}

function stockPointureAllowed(sousCategorie){
  const val=stockNormalizeLabel(stockSousCategorieValues(sousCategorie)[0]||sousCategorie);
  return ["rangers","chaussure de ville","chaussure de securite"].includes(val);
}

function stockTailleAllowed(categorie){
  const val=stockNormalizeLabel(categorie);
  const mag=(db?.magasins||[]).find(m=>String(m.id)===String(categorie||"")||String(m.nom||"")===String(categorie||""));
  const magName=stockNormalizeLabel(mag?.nom||"");
  const sub=stockNormalizeLabel(document.getElementById("stk-subcat-select")?.value||"");
  if(val==="tenues"||magName==="habillement"||stockIsHabillementCategory(categorie))return true;
  return /(tenue|casquette|parkas?|blouson|chandail|polo|tee shirt|ceinture|ceinturon|gilet|gants)/i.test(sub);
}

function stockUpdateTailleButton(){
  const btn=document.getElementById("stk-add-taille-btn");if(!btn)return;
  const cat=document.getElementById("stk-cat-select")?.value||"";
  const allowed=stockTailleAllowed(cat);
  btn.disabled=!allowed;
  btn.style.opacity=allowed?"1":".45";
  btn.style.cursor=allowed?"pointer":"not-allowed";
  btn.title=allowed?"":"Choisissez un magasin Habillement ou une famille de tenue";
}

function stockUpdatePointureButton(){
  const btn=document.getElementById("stk-add-pointure-btn");if(!btn)return;
  const sub=document.getElementById("stk-subcat-select")?.value||"";
  const allowed=stockPointureAllowed(sub);
  btn.disabled=!allowed;
  btn.style.opacity=allowed?"1":".45";
  btn.style.cursor=allowed?"pointer":"not-allowed";
  btn.title=allowed?"":"Choisissez Rangers, Chaussure de ville ou Chaussure de securite";
}

function stockSousCategorieChanged(sel){
  stockUpdatePointureButton();
  stockUpdateTailleButton();
  updateStockVariantTotal();
}

function stockGlobalStockRowsFromArticle(a){
  const rows=Array.isArray(a?.stockReceptionsGlobales)?a.stockReceptionsGlobales:[];
  if(rows.length)return rows;
  const q=parseInt(a?.quantiteGlobaleRecue||a?.stockInitial)||0;
  return q?[{quantite:q,prixUnitaire:a?.prixUnitaire||"",dateReception:a?.dateReceptionGlobale||today()}]:[];
}

function stockGlobalStockRowsHTML(a){
  const rows=stockGlobalStockRowsFromArticle(a);
  return `<div class="flex flex-col gap-2" data-stock-global-list>${rows.map(r=>stockGlobalStockRowHTML(r.quantite||"",r.prixUnitaire||"",r.dateReception||"",r.valide||false,r.details||[],r.etatArticle||"neuf",r.numerosSerie||r.serials||[],r.sousCategorie||"",a.magasinId||a.categorie)).join("")}</div>`;
}

function stockGlobalDetailsAttr(details){
  try{return encodeURIComponent(JSON.stringify(Array.isArray(details)?details:[]))}catch(e){return "%5B%5D"}
}

function stockGlobalDetailsFromRow(row){
  try{return JSON.parse(decodeURIComponent(row?.dataset.stockGlobalDetails||"%5B%5D"))||[]}catch(e){return[]}
}

function stockSerialRefRowHTML(value,locked){
  return `<div class="flex gap-1 items-center" data-stock-global-serial-row><input class="input font-mono text-xs ${locked?"bg-slate-100":""}" data-stock-global-serial value="${escapeHTML(value||"")}" placeholder="N° série / Réf" ${locked?"disabled":""}/><button type="button" class="btn btn-ghost text-xs text-red-600 h-[34px]" ${locked?"disabled":""} onclick="this.closest('[data-stock-global-serial-row]').remove()">×</button></div>`;
}

function stockSerialRefsHTML(serials,locked){
  const rows=stockSerialRefsArray(serials);
  return (rows.length?rows:[""]).map(v=>stockSerialRefRowHTML(v,locked)).join("");
}

function stockAddGlobalSerial(btn){
  const box=btn?.closest("[data-stock-global-serial-box]")?.querySelector("[data-stock-global-serial-list]");
  if(!box)return;
  box.insertAdjacentHTML("beforeend",stockSerialRefRowHTML("",false));
  box.querySelector("[data-stock-global-serial-row]:last-child input")?.focus();
}

function stockCollectSerialRefsFromRow(row){
  return [...row.querySelectorAll("[data-stock-global-serial]")].map(i=>String(i.value||"").trim()).filter(Boolean);
}

function stockGlobalStockRowHTML(quantite,prixUnitaire,dateReception,valide,details,etatArticle,numerosSerie,sousCategorie,catCode){
  const locked=valide===true||valide==="true";
  const rowDlId=`stk-row-dl-${String(Date.now()).slice(-7)}${Math.random().toString(36).slice(2,5)}`;
  const subcatList=stockSousCategorieSuggestions(catCode||"");
  const subcatVal=stockSousCategorieValues(sousCategorie||"")[0]||"";
  return `<div class="flex flex-wrap items-start gap-2 stk-global-stock-row ${locked?"bg-slate-100 border border-slate-200 rounded-lg p-2":""}" data-stock-global-locked="${locked?"1":"0"}" data-stock-global-details="${stockGlobalDetailsAttr(details)}">
    <div class="w-[180px]"><label class="label">Article</label><input class="input ${locked?"bg-slate-100":""}" data-stock-global-subcat list="${rowDlId}" value="${escapeHTML(subcatVal)}" placeholder="${subcatList.length?"Choisir famille":"Saisir famille"}" ${locked?"disabled":""}/><datalist id="${rowDlId}">${subcatList.map(x=>`<option value="${escapeHTML(x)}"></option>`).join("")}</datalist></div>
    <div class="w-[150px]"><label class="label">Date réception</label><input class="input ${locked?"bg-slate-100":""}" type="date" data-stock-global-date value="${escapeHTML(dateReception||today())}" ${locked?"disabled":""} onchange="updateStockGlobalTotal()"/></div>
    <div class="w-[90px]"><label class="label">Quantité</label><input class="input text-center ${locked?"bg-slate-100":""}" type="number" min="0" step="1" data-stock-global-qty value="${escapeHTML(parseInt(quantite)||"")}" placeholder="00" ${locked?"disabled":""} oninput="this.value=this.value.replace(/[^0-9]/g,'');updateStockGlobalTotal()"/></div>
    <div class="w-[130px]"><label class="label">Prix unitaire</label><input class="input text-right ${locked?"bg-slate-100":""}" type="text" inputmode="decimal" data-stock-global-price value="${escapeHTML(formatMoneyInputValue(prixUnitaire||""))}" placeholder="30 000,00" ${locked?"disabled":""} onblur="formatMoneyField(this);updateStockGlobalTotal()"/></div>
    <div class="w-[120px]"><label class="label">État</label><select class="select ${locked?"bg-slate-100":""}" data-stock-global-state ${locked?"disabled":""}>${["neuf","usagé","réformé"].map(e=>`<option value="${e}" ${String(etatArticle||"neuf").toLowerCase()===e?"selected":""}>${e==="neuf"?"Neuf":e==="usagé"?"Usagé":"Réformé"}</option>`).join("")}</select></div>
    <div class="w-[260px]" data-stock-global-serial-box><label class="label">N° série / Réf</label><div class="space-y-1" data-stock-global-serial-list>${stockSerialRefsHTML(numerosSerie,locked)}</div><button type="button" class="btn btn-ghost text-xs mt-1" onclick="stockAddGlobalSerial(this)">+ Ajouter</button></div>
    <div><label class="label">&nbsp;</label><button type="button" class="btn btn-ghost text-xs h-[42px]" onclick="stockOpenTailleDetailForm(this)">Détail</button></div>
    <div><label class="label">&nbsp;</label><button type="button" class="btn btn-success text-xs h-[42px]" ${locked?"disabled":""} onclick="stockValidateGlobalStockRow(this)">${locked?"Validé":"Valider"}</button></div>
    <div><label class="label">&nbsp;</label><button type="button" class="btn btn-ghost text-xs text-red-600 h-[42px]" ${locked?"disabled":""} onclick="this.closest('.stk-global-stock-row').remove();updateStockGlobalTotal()">Supprimer</button></div>
  </div>`;
}

function stockAddGlobalStockRow(){
  const box=document.querySelector("#stk-global-stock-rows [data-stock-global-list]");if(!box)return;
  const catCode=document.getElementById("stk-cat-select")?.value||"";
  box.insertAdjacentHTML("beforeend",stockGlobalStockRowHTML("","",today(),false,[],"neuf",[],""  ,catCode));
  updateStockGlobalTotal();
}

function stockOpenTailleDetailForm(btn){
  window._stockDetailTargetRow=btn?.closest(".stk-global-stock-row")||null;
  const current=stockGlobalDetailsFromRow(window._stockDetailTargetRow);
  const initType=current.length&&current[0].type==="Pointure"?"Pointure":"Taille";
  openModal(`<h3 class="font-bold text-lg mb-3">Détail des quantités reçues</h3>
    <div class="flex items-center gap-6 mb-3">
      <label class="flex items-center gap-2 cursor-pointer select-none"><input type="checkbox" id="stk-type-taille" ${initType==="Taille"?"checked":""} onchange="stockSwitchDetailType('Taille',this)"/> Tailles</label>
      <label class="flex items-center gap-2 cursor-pointer select-none"><input type="checkbox" id="stk-type-pointure" ${initType==="Pointure"?"checked":""} onchange="stockSwitchDetailType('Pointure',this)"/> Pointures</label>
      <div class="ml-auto text-xs font-bold text-slate-600">Total: <span id="stk-detail-variant-total">${qty(stockVariantesTotal(current))}</span></div>
    </div>
    <div id="stk-detail-variant-rows" class="space-y-2">${stockVariantRowsHTML(current.length?current:[{type:initType,valeur:"",quantite:"",prixUnitaire:"",dateReception:today()}])}</div>
    <div class="flex gap-2 mt-3 flex-wrap">
      <button type="button" class="btn btn-ghost text-xs" onclick="stockAddDetailVariantRowFromCheckbox()">Ajouter</button>
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>
      <button type="button" class="btn btn-primary" onclick="stockSaveDetailVariantRows()">Enregistrer détail</button>
    </div>`);
  setTimeout(()=>{
    const last=document.querySelector("#stk-detail-variant-rows .stk-variant-row:last-child");
    const qtyInput=last?.querySelector("[data-stock-var-qty]");
    if(qtyInput)qtyInput.focus();
  },80);
}

function stockAddDetailVariantRow(type){
  const box=document.getElementById("stk-detail-variant-rows");if(!box)return;
  box.insertAdjacentHTML("beforeend",stockVariantRowHTML(type||"Taille","","",today()));
  updateStockVariantTotal();
  const last=box.querySelector(".stk-variant-row:last-child [data-stock-var-qty]");
  if(last)last.focus();
}

function stockSwitchDetailType(type,checkbox){
  const otherId=type==="Taille"?"stk-type-pointure":"stk-type-taille";
  const other=document.getElementById(otherId);
  if(other)other.checked=false;
  if(!checkbox.checked){checkbox.checked=true;return;}
  document.querySelectorAll("#stk-detail-variant-rows .stk-variant-row").forEach(row=>{
    row.dataset.stockVarType=type;
    const lbl=row.querySelector("[data-stock-var-value-box]")?.parentElement?.querySelector("label");
    if(lbl)lbl.textContent=type==="Pointure"?"Pointure":"Taille";
    const vbox=row.querySelector("[data-stock-var-value-box]");
    if(vbox)vbox.innerHTML=stockVariantValueFieldHTML(type,"");
  });
  updateStockVariantTotal();
}

function stockAddDetailVariantRowFromCheckbox(){
  const type=document.getElementById("stk-type-pointure")?.checked?"Pointure":"Taille";
  stockAddDetailVariantRow(type);
}

async function stockSaveDetailVariantRows(){
  const rows=stockCollectVariantsFrom("#stk-detail-variant-rows");
  if(!rows.length){toast("Ajoutez au moins une quantité par taille","error");return}
  const total=stockVariantesTotal(rows);
  const hidden=document.getElementById("stk-variant-rows");if(!hidden)return;
  hidden.innerHTML=stockVariantRowsHTML(rows);
  const target=window._stockDetailTargetRow;
  if(target){
    const qtyInput=target.querySelector("[data-stock-global-qty]");
    if(qtyInput)qtyInput.value=total;
    target.dataset.stockGlobalDetails=stockGlobalDetailsAttr(rows);
  }
  updateStockGlobalTotal();
  const saved=await stockPersistCurrentArticleForm("Détail quantité non enregistré PostgreSQL");
  if(!saved)return;
  window._stockDetailTargetRow=null;
  closeModal();
  toast("Détail des quantités enregistré sur serveur","success");
}

function stockValidateGlobalStockRow(btn){
  const row=btn.closest(".stk-global-stock-row");if(!row)return;
  const quantite=parseInt(row.querySelector("[data-stock-global-qty]")?.value)||0;
  const prixUnitaire=parseMoneyInput(row.querySelector("[data-stock-global-price]")?.value||"");
  const dateReception=(row.querySelector("[data-stock-global-date]")?.value||"").trim();
  if(!dateReception){toast("Renseignez la date de réception","error");return}
  if(quantite<=0){toast("Renseignez la quantité reçue","error");return}
  if(prixUnitaire<=0){toast("Renseignez le prix unitaire","error");return}
  row.dataset.stockGlobalLocked="1";
  row.classList.add("bg-slate-100","border","border-slate-200","rounded-lg","p-2");
  row.querySelectorAll("input,select,button").forEach(el=>{el.disabled=true;el.classList.add("bg-slate-100")});
  btn.textContent="Validé";
  btn.disabled=true;
  const del=row.querySelector("button.text-red-600");
  if(del)del.disabled=true;
  updateStockGlobalTotal();
}

function stockCollectGlobalStockRows(){
  return [...document.querySelectorAll("#stk-global-stock-rows .stk-global-stock-row")].map(row=>{
    const quantite=parseInt(row.querySelector("[data-stock-global-qty]")?.value)||0;
    const prixUnitaire=parseMoneyInput(row.querySelector("[data-stock-global-price]")?.value||"");
    const dateReception=(row.querySelector("[data-stock-global-date]")?.value||"").trim();
    const etatArticle=(row.querySelector("[data-stock-global-state]")?.value||"neuf").trim();
    const sousCategorie=(row.querySelector("[data-stock-global-subcat]")?.value||"").trim();
    const numerosSerie=stockCollectSerialRefsFromRow(row);
    const details=stockGlobalDetailsFromRow(row);
    if(quantite<=0&&!prixUnitaire&&!numerosSerie.length&&!details.length)return null;
    return{quantite,prixUnitaire,dateReception,etatArticle,sousCategorie,numerosSerie,valide:row.dataset.stockGlobalLocked==="1",details};
  }).filter(Boolean);
}

function updateStockGlobalTotal(){
  const total=stockGlobalStockTotal(stockCollectGlobalStockRows());
  const stockInput=document.querySelector('#stock-article-form [name="stockInitial"]');
  const current=document.getElementById("stk-global-current-stock");
  if(current)current.value=total;
  if(stockInput)stockInput.value=total;
}

function stockVariantRowsHTML(rows){
  const list=Array.isArray(rows)?rows:[];
  return list.map(r=>stockVariantRowHTML(r.type||"Taille",r.valeur||"",r.quantite||"",r.dateReception||"")).join("");
}

function stockVariantValueFieldHTML(type,valeur){
  if(type==="Taille"){
    const tailles=["XS","S","M","L","XL","2XL","3XL","4XL","5XL"];
    return `<select class="select" data-stock-var-value onchange="updateStockVariantTotal()"><option value="">— Choisir —</option>${tailles.map(t=>`<option value="${t}" ${String(valeur||"")===t?"selected":""}>${t}</option>`).join("")}</select>`;
  }
  const pointures=["36","37","38","39","40","41","42","43","44","45","46","47","48"];
  return `<select class="select" data-stock-var-value onchange="updateStockVariantTotal()"><option value="">— Choisir —</option>${pointures.map(p=>`<option value="${p}" ${String(valeur||"")===p?"selected":""}>${p}</option>`).join("")}</select>`;
}

function stockVariantRowHTML(type,valeur,quantite,dateReception){
  return `<div class="grid grid-cols-1 md:grid-cols-6 gap-2 items-end stk-variant-row" data-stock-var-type="${escapeHTML(type||"Taille")}">
    <div class="md:col-span-1"><label class="label">Quantité reçue</label><input class="input" type="number" min="0" step="1" data-stock-var-qty value="${escapeHTML(parseInt(quantite)||"")}" placeholder="00" oninput="this.value=this.value.replace(/[^0-9]/g,'');updateStockVariantTotal()"/></div>
    <div class="md:col-span-2"><label class="label">${type==="Pointure"?"Pointure":"Taille"}</label><div data-stock-var-value-box>${stockVariantValueFieldHTML(type,valeur)}</div></div>
    <div class="md:col-span-2"><label class="label">Date de réception</label><input class="input" type="date" data-stock-var-date value="${escapeHTML(dateReception||today())}" onchange="updateStockVariantTotal()"/></div>
    <div class="md:col-span-1"><button type="button" class="btn btn-ghost text-xs text-red-600" onclick="this.closest('.stk-variant-row').remove();updateStockVariantTotal()">Supprimer</button></div>
  </div>`;
}

function stockAddVariantRow(type){
  const box=document.getElementById("stk-variant-rows");if(!box)return;
  if(type==="Taille"&&!stockTailleAllowed(document.getElementById("stk-cat-select")?.value||"")){
    toast("Choisissez d'abord un magasin Habillement ou une famille de tenue","error");
    stockUpdateTailleButton();
    return;
  }
  if(type==="Pointure"&&!stockPointureAllowed(document.getElementById("stk-subcat-select")?.value||"")){
    toast("Choisissez d'abord Rangers, Chaussure de ville ou Chaussure de securite","error");
    stockUpdatePointureButton();
    return;
  }
  box.insertAdjacentHTML("beforeend",stockVariantRowHTML(type||"Taille","","",today()));
  updateStockVariantTotal();
}

function stockCollectVariants(){
  const fromGlobal=stockReceptionDetailRows(stockCollectGlobalStockRows());
  if(fromGlobal.length)return fromGlobal;
  return stockCollectVariantsFrom("#stk-variant-rows");
}

function stockCollectVariantsFrom(selector){
  return [...document.querySelectorAll(`${selector} .stk-variant-row`)].map(row=>{
    const type=(row.dataset.stockVarType||"Taille").trim();
    const valeur=(row.querySelector("[data-stock-var-value]")?.value||"").trim();
    const quantite=parseInt(row.querySelector("[data-stock-var-qty]")?.value)||0;
    const dateReception=(row.querySelector("[data-stock-var-date]")?.value||"").trim();
    if(!valeur||quantite<=0)return null;
    return{type,valeur,quantite,dateReception};
  }).filter(Boolean);
}

async function stockPersistCurrentArticleForm(errorPrefix){
  const f=document.getElementById("stock-article-form");
  if(!f){toast("Formulaire article introuvable","error");return false}
  const get=n=>{const el=f.querySelector(`[name="${n}"]`);return el?el.value:"";};
  const soc=(get("societe")||"").trim();
  const cat=(get("categorie")||"").trim();
  if(!soc){toast("Sélectionnez une société avant l'enregistrement serveur","error");f.querySelector('[name="societe"]')?.focus();return false}
  if(!cat){toast("Sélectionnez un magasin avant l'enregistrement serveur","error");f.querySelector('[name="categorie"]')?.focus();return false}
  const id=f.dataset.stockArticleId||uid("stk");
  let a=(db.stockArticles||[]).find(x=>String(x.id)===String(id));
  if(!a){
    a={id,dateCreation:today(),actif:true};
    db.stockArticles=db.stockArticles||[];
    db.stockArticles.push(a);
    f.dataset.stockArticleId=id;
  }
  ["code","categorie","sousCategorie","societe","designation","marque","modele","reference","codeBarre","emplacement","fournisseur","description","notes","magasinId","fournisseurId","etatArticle"].forEach(k=>{a[k]=(get(k)||"").trim()});
  a.coutAchat=parseFloat(get("coutAchat"))||0;
  a.dureeVieMois=parseFloat(get("dureeVieMois"))||0;
  const selectedMag=(db.magasins||[]).find(m=>String(m.id)===String(get("categorie")||""));
  if(selectedMag){a.magasinId=selectedMag.id;a.magasin=selectedMag.nom||"Magasin";a.categorie=dotationMagasinType(selectedMag)||selectedMag.nom||"Magasin"}
  a.designation=stockAutoArticleDesignation(a);
  if(!a.unite)a.unite="Pièce";
  const receptionsGlobales=stockCollectGlobalStockRows();
  const receptionsGlobalesTotal=stockGlobalStockTotal(receptionsGlobales);
  a.stockReceptionsGlobales=receptionsGlobales;
  a.quantiteGlobaleRecue=receptionsGlobalesTotal;
  a.dateReceptionGlobale=receptionsGlobales[0]?.dateReception||"";
  const dernierPrixGlobal=receptionsGlobales.slice().reverse().find(r=>parseFloat(r.prixUnitaire)>0)?.prixUnitaire;
  if(dernierPrixGlobal!==undefined)a.prixUnitaire=dernierPrixGlobal;
  if(a.coutAchat>0)a.prixUnitaire=a.coutAchat;
  const isHabSave=stockIsHabillementCategory(a.categorie);
  const variantes=stockCollectVariants();
  const variantesTotal=stockVariantesTotal(variantes);
  a.stockVariantes=variantes;
  if(isHabSave){
    a.stockInitial=variantesTotal||receptionsGlobalesTotal||0;
    a.stockMin="";
    a.stockMax="";
    a.seuilAlerte="";
  }else{
    ["stockInitial","stockMin","stockMax","seuilAlerte"].forEach(k=>{const v=get(k);a[k]=v===""||v===null||v===undefined?"":parseFloat(v)});
    if(receptionsGlobalesTotal>0)a.stockInitial=receptionsGlobalesTotal;
    if(variantesTotal>0)a.stockInitial=variantesTotal;
  }
  const attrs={};
  document.querySelectorAll("#stk-attrs-list .stk-attr-row").forEach(r=>{const k=(r.querySelector("[data-attr-key]")?.value||"").trim();const v=(r.querySelector("[data-attr-val]")?.value||"").trim();if(k)attrs[k]=v});
  a.attributs={...(a.attributs||{}),...attrs};
  if(!a.code)a.code=stockNextCode(a.societe,a.categorie);
  a.derniereMaj=today();
  try{
    await persistArticleToPostgres(a);
    f.dataset.stockArticleNew="0";
    sgdiDirty=true;
    await sgdiBackendSaveAndWait();
    return true;
  }catch(e){
    toast(`${errorPrefix||"Enregistrement PostgreSQL refusé"} : ${e.message||e}`,"error");
    return false;
  }
}

function updateStockVariantTotal(){
  const detailRows=document.getElementById("stk-detail-variant-rows");
  const rows=detailRows?stockCollectVariantsFrom("#stk-detail-variant-rows"):stockCollectVariants();
  const total=stockVariantesTotal(rows);
  const out=document.getElementById("stk-variant-total");
  const detailOut=document.getElementById("stk-detail-variant-total");
  const stockInput=document.querySelector('#stock-article-form [name="stockInitial"]');
  if(out)out.textContent=qty(total);
  if(detailOut)detailOut.textContent=qty(total);
  if(stockInput&&total>0)stockInput.value=total;
}

function stockReloadSousCategories(catCode){
  const container=document.getElementById("stk-subcat-container");if(!container)return;
  container.innerHTML=stockSousCategoriePickerHTML(catCode,"");
  stockUpdatePointureButton();
  stockUpdateTailleButton();
}

function stockCategorieChanged(sel){
  stockToggleStockFields(sel.value);
  stockReloadSousCategories(sel.value);
  const f=document.getElementById("stock-article-form");
  const magasin=f?.querySelector('[name="magasinId"]');
  if(magasin&&(db.magasins||[]).some(m=>String(m.id)===String(sel.value)))magasin.value=sel.value;
  const summary=document.getElementById("stk-store-summary");
  if(summary)summary.innerHTML=stockSelectedMagasinSummaryHTML(sel.value);
}

function stockReloadCatOptions(soc){
  const sel=document.getElementById("stk-cat-select");if(!sel)return;
  sel.innerHTML=stockMagasinCategorieOptionsHTML(soc,"");
  stockReloadSousCategories("");
  stockToggleStockFields("");
  const f=document.getElementById("stock-article-form");
  const magasin=f?.querySelector('[name="magasinId"]');
  if(magasin)magasin.value="";
  const summary=document.getElementById("stk-store-summary");
  if(summary)summary.innerHTML=stockSelectedMagasinSummaryHTML("");
  stockUpdateTailleButton();
  stockUpdatePointureButton();
}

function stockToggleStockFields(catCode){
  const isHab=stockIsHabillementCategory(catCode);
  const fields=document.getElementById("stk-stock-fields");
  const help=document.getElementById("stk-stock-help");
  const helpHab=document.getElementById("stk-stock-help-hab");
  if(fields)fields.style.display=isHab?"none":"contents";
  if(help)help.style.display=isHab?"none":"block";
  if(helpHab)helpHab.style.display=isHab?"block":"none";
}

function stockAddAttrRow(k,v){
  const list=document.getElementById("stk-attrs-list");if(!list)return;
  const row=document.createElement("div");row.className="flex gap-2 items-center stk-attr-row";
  row.innerHTML=`<input class="input" placeholder="Nom (ex: Taille)" value="${k?escapeHTML(k):""}" data-attr-key/><input class="input" placeholder="Valeur (ex: XL)" value="${v?escapeHTML(String(v)):""}" data-attr-val/><button type="button" class="btn btn-ghost text-xs text-red-600" onclick="this.closest('.stk-attr-row').remove()">✕</button>`;
  list.appendChild(row);
}

async function stockSaveArticle(id,isNew){
  let f=null,saveBtn=null;
  try{
    f=document.getElementById("stock-article-form");
    if(!f){toast("Formulaire introuvable","error");return}
    if(f.dataset.submitting==="1")return;
    f.dataset.submitting="1";
    saveBtn=document.getElementById("stk-art-save-btn");
    if(saveBtn){saveBtn.disabled=true;saveBtn.dataset.originalText=saveBtn.textContent;saveBtn.textContent="Enregistrement..."}
    // Manual validation (avoid silent block when fields empty)
    const get=n=>{const el=f.querySelector(`[name="${n}"]`);return el?el.value:"";};
    const soc=(get("societe")||"").trim();
    const cat=(get("categorie")||"").trim();
    if(!soc){toast("Sélectionnez une société","error");f.querySelector('[name="societe"]')?.focus();return}
    if(!cat){toast("Sélectionnez un magasin","error");f.querySelector('[name="categorie"]')?.focus();return}
    const isCreating=isNew===true||isNew==="true";
    let a=(db.stockArticles||[]).find(x=>x.id===id);
    if(!a){a={id,dateCreation:today(),actif:true};db.stockArticles=db.stockArticles||[];db.stockArticles.push(a)}
    ["code","categorie","sousCategorie","societe","designation","marque","modele","reference","codeBarre","emplacement","fournisseur","description","notes","magasinId","fournisseurId","etatArticle"].forEach(k=>{a[k]=(get(k)||"").trim()});
    a.coutAchat=parseFloat(get("coutAchat"))||0;
    a.dureeVieMois=parseFloat(get("dureeVieMois"))||0;
    const selectedMag=(db.magasins||[]).find(m=>String(m.id)===String(get("categorie")||""));
    if(selectedMag){a.magasinId=selectedMag.id;a.magasin=selectedMag.nom||"Magasin";a.categorie=dotationMagasinType(selectedMag)||selectedMag.nom||"Magasin"}
    if(!a.unite)a.unite="Pièce";
    const receptionsGlobales=stockCollectGlobalStockRows();
    // sousCategorie (article name) is now entered per stock row, not in the identification header
    if(!a.sousCategorie){const rowSubcat=(receptionsGlobales[0]?.sousCategorie||"").trim();if(rowSubcat)a.sousCategorie=rowSubcat;}
    a.designation=stockAutoArticleDesignation(a);
    const receptionsGlobalesTotal=stockGlobalStockTotal(receptionsGlobales);
    a.stockReceptionsGlobales=receptionsGlobales;
    a.quantiteGlobaleRecue=receptionsGlobalesTotal;
    a.dateReceptionGlobale=receptionsGlobales[0]?.dateReception||"";
    const dernierPrixGlobal=receptionsGlobales.slice().reverse().find(r=>parseFloat(r.prixUnitaire)>0)?.prixUnitaire;
    if(dernierPrixGlobal!==undefined)a.prixUnitaire=dernierPrixGlobal;
    if(a.coutAchat>0)a.prixUnitaire=a.coutAchat;
    const isHabSave=stockIsHabillementCategory(a.categorie);
    const variantes=stockCollectVariants();
    const variantesTotal=stockVariantesTotal(variantes);
    a.stockVariantes=variantes;
    if(isHabSave){
      a.stockInitial=variantesTotal||receptionsGlobalesTotal||0;a.stockMin="";a.stockMax="";a.seuilAlerte="";
    }else{
      ["stockInitial","stockMin","stockMax","seuilAlerte"].forEach(k=>{const v=get(k);a[k]=v===""||v===null||v===undefined?"":parseFloat(v)});
      if(receptionsGlobalesTotal>0)a.stockInitial=receptionsGlobalesTotal;
      if(variantesTotal>0)a.stockInitial=variantesTotal;
    }
    // attributs
    const attrs={};
    document.querySelectorAll("#stk-attrs-list .stk-attr-row").forEach(r=>{const k=(r.querySelector("[data-attr-key]")?.value||"").trim();const v=(r.querySelector("[data-attr-val]")?.value||"").trim();if(k)attrs[k]=v});
    a.attributs={...(a.attributs||{}),...attrs};
    if(!a.code)a.code=stockNextCode(a.societe,a.categorie);
    a.derniereMaj=today();
    try{await persistArticleToPostgres(a)}catch(e){toast("Article non sauvegardé : "+(e.message||e),"error");return}
    if(typeof logActivity==="function")logActivity(isCreating?"Article stock créé":"Article stock modifié",a.code+" · "+a.designation);
    try{
      sgdiDirty=true;
      await sgdiBackendSaveAndWait();
    }catch(e){
      toast("Article créé, mais synchronisation globale PostgreSQL incomplète : "+(e.message||e),"warning");
      return;
    }
    toast(isCreating?"✓ Article ajouté":"✓ Article modifié","success");
    if(isAdminSystemSession())await sgdiRefreshAdminMaterialNow({render:false});
    navigate("materiel/article/"+a.id);
  }catch(err){
    console.error("stockSaveArticle error:",err);
    toast("Erreur d'enregistrement: "+err.message,"error");
  }finally{
    if(f&&document.body.contains(f)){
      f.dataset.submitting="";
      if(saveBtn){saveBtn.disabled=false;saveBtn.textContent=saveBtn.dataset.originalText||"💾 Enregistrer"}
    }
  }
}

function stockNouvelArticle(){
  navigate("materiel/article-nouveau");
}

function stockArticleStoreLabel(a){
  const mag=(db.magasins||[]).find(m=>String(m.id)===String(a?.magasinId||"")||String(m.backendId||"")===String(a?.magasinId||""));
  return mag?.nom||a?.magasin||a?.categorie||"Magasin non défini";
}

function stockOpenMvt(type,articleId,preselectAgentId){
  const arts=stockArticlesFiltered();
  if(arts.length===0&&!articleId){
    toast("Aucun article au catalogue. Créez-en un d'abord.","error");
    return navigate("materiel/article-nouveau");
  }
  const a=articleId?(db.stockArticles||[]).find(x=>x.id===articleId):null;
  const isEntry=type==="entree";
  const preAgent=(db.agents||[]).find(ag=>ag.id===preselectAgentId);
  const motifs=isEntry
    ? Array.from(new Set([...(db.stockMotifsEntree||["Achat","Autre"])]))
    : Array.from(new Set([...(db.stockMotifsSortie||["Consommation interne","Affectation site","Perte","Casse","Réforme","Autre"])]));
  const sortedArts=arts.slice().sort((x,y)=>(x.designation||"").localeCompare(y.designation||""));
  const headerColor=isEntry?"#16a34a":"#dc2626";
  const title=isEntry?"📥 Nouvelle entrée stock":"📤 Nouvelle sortie stock";
  const icon=isEntry?"📥":"📤";
  const numeroBonAuto=nextStockBonNum(type);
  const types=isEntry?[["achat","Nouvelle acquisition"],["retour_site","Reversement site"],["retour_employe","Reversement employé"]]:[["sortie","Sortie stock"],["perte","Perte"],["casse","Casse"],["reforme","Réformer"]];
  const sizeBlock=isEntry?stockMvtSizeBreakdownHTML(a):"";
  const allPersonnel=(db.agents||[]).slice().sort((x,y)=>(x.nom+" "+x.prenom).localeCompare(y.nom+" "+y.prenom));
  const agentsActifs=allPersonnel.filter(ag=>ag.statut==="actif");
  const sites=(db.sites||[]).filter(s=>s&&s.actif!==false).sort((x,y)=>(x.client||"").localeCompare(y.client||"")||(x.nom||"").localeCompare(y.nom||""));
  openModal(`<h3 class="font-bold text-lg mb-1" style="color:${headerColor}">${icon} ${isEntry?"Nouvelle entrée stock":"Nouvelle sortie stock"}</h3>
    <p class="text-xs text-slate-500 mb-3">Toutes les informations sont conservées pour la traçabilité.</p>
    <form id="stock-mvt-form">
      <div class="grid grid-cols-2 gap-3">
        <div class="${isEntry?"":"col-span-2"}"><label class="label">Article *</label>
          <select class="select" name="articleId"  onchange="stockMvtArticleChanged()">
            <option value="">— Choisir un article —</option>
            ${sortedArts.map(x=>{const q=stockGetActuel(x.id);const magLabel=stockArticleStoreLabel(x);return`<option value="${x.id}" data-prix="${x.prixUnitaire||0}" data-unite="${escapeHTML(x.unite||"")}" data-stock="${q}" data-magasin="${escapeHTML(magLabel)}" ${a&&a.id===x.id?"selected":""}>${escapeHTML(x.code)} · ${escapeHTML(x.designation)} · ${escapeHTML(magLabel)} · stock: ${qty(q)} ${escapeHTML(x.unite||"")}</option>`}).join("")}
          </select>
          <div id="stk-mvt-stock-info" class="text-xs text-slate-500 mt-1">${a?`Stock actuel : <b style="color:${headerColor}">${qty(stockGetActuel(a.id))} ${escapeHTML(a.unite||"")}</b> · P.U. : <b>${money(a.prixUnitaire)}</b>`:""}</div>
        </div>
        ${isEntry?`<div><label class="label">Magasin</label><input class="input bg-slate-50 font-bold" id="stk-mvt-magasin-display" value="${a?escapeHTML(stockArticleStoreLabel(a)):""}" readonly/></div>`:""}
        <div><label class="label">Date *</label><input class="input" type="date" name="date" value="${today()}" /></div>
        <div><label class="label">Type de mouvement</label><select class="select" name="type" onchange="${isEntry?"stockMvtEntryTypeChanged()":"stockMvtToggleRenouvellementMotif()"}">${types.map(([k,l])=>`<option value="${k}" ${(k===type||isEntry&&type==="entree"&&k==="achat")?"selected":""}>${l}</option>`).join("")}</select></div>
        <div id="stk-mvt-quantite-wrap"><label class="label">Quantité *</label><input class="input" type="number" inputmode="numeric" step="1" min="1" name="quantite" placeholder="00" oninput="this.value=this.value.replace(/[^0-9]/g,'')"/></div>
        <div id="stk-mvt-taille-wrap" style="display:none"><label class="label">Taille</label><select class="select" name="tailleSimple"><option value="">— Sans taille —</option>${["XS","S","M","L","XL","2XL","3XL","4XL","5XL"].map(t=>`<option value="${t}">${t}</option>`).join("")}</select></div>
        ${!isEntry?stockMvtTaillePointureHTML(a):""}
        <div id="stk-mvt-prix-wrap"><label class="label">Prix unitaire (DA)</label><input class="input" type="number" step="0.01" name="prixUnitaire" value="${a?(a.prixUnitaire||""):""}" placeholder="0.00"/></div>
        ${sizeBlock}
        ${!isEntry?`<div id="stk-renouv-motif-box" class="col-span-2 p-3 rounded-md" style="display:none;background:#f8fafc;border:1px solid #cbd5e1">
          <label class="label">Motif du renouvellement de dotation *</label>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <select class="select" name="motifRenouvellement">
              <option value="">— Choisir —</option>
              <option>Usure normale</option>
              <option>Article détérioré</option>
              <option>Article perdu</option>
              <option>Changement de taille</option>
              <option>Fin de durée d'utilisation</option>
              <option>Changement d'affectation</option>
              <option>Remplacement réglementaire</option>
              <option>Autre</option>
            </select>
            <input class="input" name="motifRenouvellementPrecision" placeholder="Précision / observation"/>
          </div>
        </div>`:""}
        ${isEntry?`<div class="col-span-2">
          <div id="stk-fournisseur-box"><label class="label">🤝 Fournisseur</label><select class="select" name="fournisseurId"><option value="">— Choisir fournisseur —</option>${(db.fournisseurs||[]).map(fo=>`<option value="${fo.id}" ${a&&a.fournisseurId===fo.id?"selected":""}>${escapeHTML(fo.raisonSociale)}</option>`).join("")}</select><div class="text-[10px] text-slate-400 mt-1">Fournisseur inexistant ? <a href="#/materiel/fournisseur-nouveau" class="text-amber-600 underline" onclick="closeModal()">+ Créer un fournisseur</a></div></div>
          <div id="stk-retour-site-box" style="display:none"><label class="label">Site / client concerné *</label><select class="select" name="siteId"><option value="">— Choisir site —</option>${sites.map(s=>`<option value="${s.id}">${escapeHTML([s.client,s.nom,s.indicatif].filter(Boolean).join(" · "))}</option>`).join("")}</select></div>
          <div id="stk-retour-agent-box" style="display:none"><label class="label">Employé concerné *</label><select class="select" name="retourAgentId"><option value="">— Choisir un employé —</option>${allPersonnel.map(ag=>`<option value="${ag.id}">${escapeHTML(ag.nom+" "+ag.prenom)}${ag.matricule?` · ${escapeHTML(ag.matricule)}`:""}${ag.societe?` · ${escapeHTML(ag.societe)}`:""}${ag.statut?` · ${escapeHTML(ag.statut)}`:""}</option>`).join("")}</select></div>
          <input type="hidden" name="motif" value="Nouvelle acquisition"/>
        </div>`:`<div class="col-span-2">
          <label class="label">Motif *</label><select class="select" name="motif" onchange="stockMvtToggleBeneficiaireAgent()"><option value="">— Choisir —</option>${motifs.map(m=>`<option ${preAgent&&stockMvtIsAttributionAgent(m)?"selected":""}>${m}</option>`).join("")}</select>
          <div id="stk-benef-agent-box" style="display:${preAgent?"block":"none"}"><label class="label">Employé bénéficiaire *</label><select class="select" name="beneficiaireAgentId"><option value="">— Choisir un employé —</option>${agentsActifs.map(ag=>`<option value="${ag.id}" ${preAgent&&preAgent.id===ag.id?"selected":""}>${escapeHTML(ag.nom+" "+ag.prenom)}${ag.matricule?` · ${escapeHTML(ag.matricule)}`:""}${ag.societe?` · ${escapeHTML(ag.societe)}`:""}</option>`).join("")}</select><div class="text-[10px] text-slate-400 mt-1">Employé sélectionné automatiquement depuis la liste des instances de dotation.</div></div>
          <div id="stk-benef-free-box" style="display:${preAgent?"none":"block"}"><label class="label">Bénéficiaire / Destinataire</label><input class="input" name="beneficiaireNom" value="${preAgent?escapeHTML((preAgent.nom||"")+" "+(preAgent.prenom||"")):""}" placeholder="ex: Agent SAID Mohamed / Site Aéroport / Vente externe"/></div>
        </div>`}
        <div class="col-span-2"><label class="label">N° Bon / Facture</label><input class="input font-mono bg-slate-50" name="numeroBon" value="${numeroBonAuto}" readonly/></div>
        <div class="col-span-2"><label class="label">Notes</label><textarea class="input" name="notes" rows="2" placeholder="Détails complémentaires, conditions, état du matériel..."></textarea></div>
        <div class="col-span-2 mt-1 p-3 rounded-md" style="background:${headerColor}10;border:1px dashed ${headerColor}55">
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" name="imputerCaisse" value="1" class="mt-0.5" ${isEntry?"":"checked"}/>
            <div class="flex-1">
              <div class="text-sm font-bold" style="color:${headerColor}">💰 Imputer cette opération en caisse</div>
              <div class="text-xs text-slate-600">${isEntry?"L'achat sera enregistré comme <b>sortie de caisse</b> (charge fournisseur). Décochez si paiement déjà effectué ou non lié à une dépense.":"La vente / sortie sera enregistrée comme <b>entrée de caisse</b> si motif = Vente, sinon comme charge selon motif. Décochez si non lié à une opération financière."}</div>
              <select name="caisseMode" class="select mt-1 text-xs" style="display:${isEntry?"block":"block"}">
                ${isEntry?`<option value="auto">Automatique (sortie caisse fournisseur)</option><option value="achat">Achat / approvisionnement</option><option value="charge">Charge d'exploitation</option>`:`<option value="auto">Automatique selon motif</option><option value="vente">Vente (entrée caisse)</option><option value="charge">Charge / consommation</option>`}
              </select>
            </div>
          </label>
        </div>
      </div>
      <div class="flex justify-end gap-2 mt-4">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>
        <button type="submit" id="stk-mvt-save-btn" class="btn btn-primary" style="background:${headerColor};border-color:${headerColor}" onclick="event.preventDefault();stockSaveMvt('${type}')">${isEntry?"📥 Valider l'entrée":"📤 Valider la sortie"}</button>
      </div>
    </form>`);
  setTimeout(()=>{
    const f=document.getElementById("stock-mvt-form");
    if(f&&!f._wired){f._wired=true;f.addEventListener("submit",e=>{e.preventDefault();stockSaveMvt(type)});}
    stockMvtToggleSizeBreakdown();
    if(isEntry)stockMvtEntryTypeChanged();else stockMvtToggleBeneficiaireAgent();
    stockMvtToggleRenouvellementMotif();
    stockMvtRefreshTaillePointure();
    if(a)stockMvtApplyMagasinConfig(a.id);
  },0);
}

function stockMvtToggleRenouvellementMotif(){
  const t=document.querySelector(".modal-bg [name='type']")?.value||"";
  const box=document.getElementById("stk-renouv-motif-box");
  if(box)box.style.display=t==="renouvellement_dotation"?"block":"none";
}

function stockMvtIsAttributionAgent(motif){
  const m=String(motif||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
  return m==="attribution"||m.includes("attribution agent")||m.includes("dotation personnel");
}

SGDIModules.registerModule({key: "material-inventory", routes: [], dependencies: [], init: function(){}, destroy: function(){}});
