/* Phase 2 — sites. Fonctions déplacées sans changement métier.
 * État et helpers synchrones partagés conservés dans sgdi-app.js.
 * Inventaire : docs/frontend-phase2h-inventory.json. */
function setSitesSocieteFilter(value){
  if(session?.societe){
    storeCurrentStructureSocieteFilter(session.societe);
    sgdiServerSetPage("sites",session.societe,1);
    renderView();
    return;
  }
  const known=societeConfig().custom||SOCIETES;
  const s=value?canonicalSocieteName(value,known):"";
  if(session?.transverse==="admin"){
    if(s)sessionStorage.setItem(ADMIN_ACTIVE_SOCIETE_KEY,s);
    else sessionStorage.removeItem(ADMIN_ACTIVE_SOCIETE_KEY);
  }
  storeCurrentStructureSocieteFilter(s);
  sgdiServerSetPage("sites",s||"all",1);
  renderView();
}

function sitesSocieteSelectorHTML(sites){
  const selected=sitesPageSocieteFilter();
  const count=(sites||[]).length;
  const locked=!!session?.societe;
  const socs=currentAllowedSocietes();
  return `<div class="sites-society-filter mb-4">
    <div class="sites-society-filter__summary">
      <span>${locked?"Périmètre verrouillé":"Périmètre sites"}</span>
      <strong>${escapeHTML(selected||"Toutes les sociétés autorisées")}</strong>
      <small>${count} site(s) actif(s) affiché(s)</small>
    </div>
    ${locked?`<div class="sites-society-filter__locked">Société active</div>`:`<div class="sites-society-filter__control">
      <label for="sites-society-select">Société</label>
      <select id="sites-society-select" class="select" onchange="setSitesSocieteFilter(this.value)">
        <option value="" ${!selected?"selected":""}>Toutes les sociétés autorisées</option>
        ${socs.map(s=>`<option value="${escapeHTML(s)}" ${normalizeSocieteName(selected)===normalizeSocieteName(s)?"selected":""}>${escapeHTML(s)}</option>`).join("")}
      </select>
      ${selected&&!session?.societe?`<button type="button" class="sites-society-filter__reset" onclick="setSitesSocieteFilter('')">Réinitialiser</button>`:""}
    </div>`}
  </div>`;
}

function siteAdminSystemActionsHTML(site){
  if(!isAdminSystemSession())return "";
  const ref=jsString(siteEditRouteId(site));
  return `<button type="button" class="btn btn-danger text-xs" data-site-lock-keep onclick="deleteSite('${ref}')">Supprimer</button>`;
}

function setSitesGlobalSearch(value){
  const q=String(value||"").trim();
  if(q)sessionStorage.setItem("sitesGlobalSearch",q);
  else sessionStorage.removeItem("sitesGlobalSearch");
  renderView();
}

function sitesGlobalSearchHTML(query,sites,soc){
  query=String(query||"").trim();
  if(!query)return "";
  const rows=(sites||[]).filter(Boolean);
  return `<div class="card p-4 mb-4" style="border-left:4px solid #0ea5e9;background:#f8fafc">
    <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
      <div><div class="text-xs font-black uppercase tracking-widest text-slate-500">Recherche directe</div><div class="font-black text-slate-800">${escapeHTML(query)}</div><div class="text-xs text-slate-500">Recherche limitée à ${escapeHTML(soc||"la société sélectionnée")}.</div></div>
      <form class="flex gap-2 flex-wrap" onsubmit="event.preventDefault();setSitesGlobalSearch(this.q.value)">
        <input class="input" name="q" value="${escapeHTML(query)}" placeholder="DHL, HAMOUL, indicatif..." style="width:260px"/>
        <button class="btn btn-secondary" type="submit">Rechercher</button>
        <button class="btn btn-ghost" type="button" onclick="setSitesGlobalSearch('')">Masquer</button>
      </form>
    </div>
    ${rows.length?`<div class="grid grid-cols-1 md:grid-cols-2 gap-2">${rows.map(s=>{const archived=s.actif===false||s.active===0||s.statut==="inactif";return`<a class="p-3 rounded-lg border bg-white block" style="text-decoration:none;color:inherit" href="#/sites/${siteEditRouteId(s)}"><div class="font-black">${escapeHTML(s.nom||"Site")} ${archived?`<span class="pill pill-gray ml-2">Archivé</span>`:`<span class="pill pill-green ml-2">Actif</span>`}</div><div class="text-xs text-slate-500">${safe(s.indicatif)} · ${safe(s.societe||s.society)} · ${safe(s.commune)}, ${safe(s.wilaya)}</div></a>`}).join("")}</div>`:`<div class="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 font-bold">Aucun site trouvé pour cette recherche.</div>`}
  </div>`;
}

async function renderSitesServer(view){
  // Une navigation peut intervenir pendant les appels serveur ci-dessous. Dans ce cas,
  // cette ancienne vue ne doit jamais écraser la nouvelle page affichée (ex. Pointage).
  const renderGeneration=sgdiViewRenderGeneration;
  const renderHash=String(location.hash||"");
  const renderIsCurrent=()=>renderGeneration===sgdiViewRenderGeneration&&renderHash===String(location.hash||"")&&view===document.getElementById("view");
  const soc=sitesPageSocieteFilter();
  const page=sgdiServerCurrentPage("sites",soc||"all");
  const globalQ=sessionStorage.getItem("sitesGlobalSearch")||"";
  sgdiShowDataLoadingBar("Chargement des sites...");
  try{
    const [result,mapRowsRaw,globalSearchRaw,statsData]=await Promise.all([
      SGDI.sites.page({society:soc||undefined,page,page_size:12}),
      SGDI.sites.list({society:soc||undefined}).catch(()=>[]),
      globalQ?SGDI.sites.page({society:soc||undefined,q:globalQ,page:1,page_size:50}).catch(()=>null):Promise.resolve(null),
      session?.transverse!=="materiel"&&window.SGDI_API?.ui?.sidebarStats?window.SGDI_API.ui.sidebarStats({}).catch(()=>null):Promise.resolve(null)
    ]);
    if(!renderIsCurrent())return;
    if(statsData)window.SGDI_SIDEBAR_STATS=statsData;
    const rows=(result?.items||result?.data||[]).map(siteFromApi);
    const mapRows=(Array.isArray(mapRowsRaw)?mapRowsRaw:[]).map(siteFromApi);
    const globalSearchRows=(globalSearchRaw?.items||globalSearchRaw?.data||[]).map(siteFromApi);
    [...rows,...mapRows,...globalSearchRows].forEach(site=>sgdiUpsertServerItem("sites",site));
    if(session?.transverse!=="materiel"&&typeof syncAssignmentsFromPostgres==="function"){
      await syncAssignmentsFromPostgres().catch(e=>console.warn("Affectations PostgreSQL non synchronisées avant situation sites",e));
      if(!renderIsCurrent())return;
    }
    const situationData=session?.transverse!=="materiel"?await SGDI.sites.situation(soc?{society:soc}:undefined).catch(()=>null):null;
    if(!renderIsCurrent())return;
    if(session?.transverse!=="materiel"&&!situationData)throw new Error("Situation sites PostgreSQL indisponible");
    const sites=siteOpsSitesForScope(soc,mapRows.length?mapRows:rows,{onlyExtra:true,includeInactive:true});
    const mapSites=siteOpsSitesForScope(soc,mapRows,{onlyExtra:true});
    const situationBySite=siteBackendSituationMap(situationData);
    window.__SGDI_SITE_SITUATION_DATA=situationData||null;
    window.__SGDI_SITE_SITUATION_BY_SITE=situationBySite;
    const pagination=sgdiServerPaginationHTML("sites",soc||"all",result);
    const opsReadOnly=isOpsSupervisorReadOnlySession();
    view.innerHTML=`<div class="flex justify-between mb-6"><h1 class="text-2xl font-black uppercase">SITES - TABLEAU DE BORD</h1><span class="text-sm text-slate-500">Sites transmis par le Commercial</span></div>
    ${opsSupervisorReadOnlyNoticeHTML()}
    ${sitesSocieteSelectorHTML(mapSites)}
    ${session?.transverse==="materiel"?"":situationData?siteSyntheseServerHTML(situationData,mapSites):siteSyntheseGeneraleHTML(mapSites)}
    ${siteMapDashboardHTML(mapSites)}
    <div id="sites-filter-info" class="hidden mb-4 p-3 rounded-lg bg-slate-100 border border-slate-200 text-sm font-semibold"></div>
    ${sites.length===0?`<div class="card p-10 text-center text-slate-500">Aucun site.</div>`:`<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">${sites.map(s=>{const metric=siteBackendMetricForSite(s,situationBySite);const eff={...siteEffectifsNorm(s),totalContractuel:metric.contractual};const manque=metric.missing;const surplus=metric.surplus;const realized=metric.realized;const op=metric.operational;const archived=s.actif===false||s.active===0||s.statut==="inactif";const lampOk=eff.totalContractuel>0&&realized===eff.totalContractuel;const lampKo=eff.totalContractuel>0&&realized!==eff.totalContractuel;const sid2=siteEditRouteId(s);return `<div class="card p-5 site-card ${archived?"opacity-75":""}" data-site-status="${op?"operationnel":"non-operationnel"}" data-site-manque="${manque}" data-site-surplus="${surplus}" data-site-instance="${realized===0?1:0}" data-site-contractuel="${eff.totalContractuel}" data-site-realise="${realized}" data-searchable><div class="flex items-start justify-between gap-3"><div><h2 class="text-lg font-black flex items-center gap-2 flex-wrap"><span class="site-status-lamp ${lampOk?"lamp-green":lampKo?"lamp-red":"lamp-gray"}" title="${lampOk?"Effectif conforme":surplus>0?"Surplus +"+surplus:manque>0?"Manque −"+manque:"Effectif non défini"}"></span>${escapeHTML(s.nom||"-")} <span class="pill pill-amber ml-2 font-mono">${safe(s.indicatif)}</span> ${archived?`<span class="pill pill-gray ml-2">Archivé</span>`:`<span class="pill pill-green ml-2">Actif</span>`}</h2><div class="text-sm text-slate-500">${safe(s.type)} · ${safe(s.commune)}, ${safe(s.wilaya)}</div><div class="text-xs text-slate-500 mt-1">Client : ${safe(s.client)}</div></div><div class="flex gap-2"><a class="btn btn-ghost text-xs" href="#/sites/${sid2}">${opsReadOnly?"Accéder":"Modifier"}</a>${opsReadOnly?"":siteAdminSystemActionsHTML(s)}</div></div>${siteEffectifAlertHTML(eff,{length:realized})}${siteCoverageBarHTML(realized,eff.totalContractuel)}<div class="grid grid-6 gap-2 mt-4 text-xs"><div class="bg-slate-50 p-2 rounded border text-center"><div class="text-slate-500 font-semibold">Contractuel</div><div class="text-lg font-bold">${eff.totalContractuel||0}</div></div><div class="bg-slate-50 p-2 rounded border text-center"><div class="text-slate-500 font-semibold">Jour</div><div class="text-lg font-bold">${eff.jour||0}</div></div><div class="bg-slate-50 p-2 rounded border text-center"><div class="text-slate-500 font-semibold">Nuit</div><div class="text-lg font-bold">${eff.nuit||0}</div></div><button type="button" class="p-2 rounded border text-center transition ${surplus>0?"hover:opacity-80":"hover:bg-blue-50 hover:border-blue-300 bg-slate-50 border-slate-200"}" style="${surplus>0?"background:#fff7ed;border-color:#fdba74":""}" onclick="event.stopPropagation();openSiteAffectesModal('${sid2}')"><div class="font-semibold ${surplus>0?"":"text-slate-500"}">Affecté</div><div class="text-lg font-bold">${realized}</div></button><div class="p-2 rounded border text-center ${surplus>0?"":"bg-slate-50 border-slate-200"}" style="${surplus>0?"background:#fff7ed;border-color:#fdba74;color:#c2410c":""}"><div class="font-semibold ${surplus>0?"":"text-slate-500"}">Surplus</div><div class="text-lg font-bold">${surplus>0?"+"+surplus:0}</div></div><div class="p-2 rounded border text-center ${manque>0?"":"bg-slate-50 border-slate-200"}" style="${manque>0?"background:#fef2f2;border-color:#fca5a5;color:#991b1b":""}"><div class="font-semibold ${manque>0?"":"text-slate-500"}">Manque</div><div class="text-lg font-bold">${manque>0?"−"+manque:0}</div></div></div>${siteMovementHistoryHTML(s)}</div>`}).join("")}</div>`}
    ${pagination}`;
    sitesModuleTimeout(()=>{if(renderIsCurrent()){initSitesDashboardMap();enableClickableSiteCards()}},0);
  }catch(e){
    if(!renderIsCurrent())return;
    console.warn("Sites serveur indisponibles, repli local",e);
    window.__sgdiSitesLocalFallback=true;
    renderSites(view);
  }
}

function renderSites(view){
  // Backend disponible : on affiche UNIQUEMENT les chiffres serveur. On montre un chargement,
  // puis renderSitesServer remplit les vrais chiffres. Plus de calcul local faux au 1er affichage
  // (fini le "je dois recharger pour voir les vrais chiffres"). Le rendu local ci-dessous n'est
  // conservé que comme repli hors-ligne (backend indisponible).
  if(sgdiAuthToken()&&typeof sgdiBackendShouldUse==="function"&&sgdiBackendShouldUse()&&!window.__sgdiSitesLocalFallback&&!window.__sgdiSitesBgRefreshing){
    // Chargement affiché seulement au 1er rendu (écran vide) pour ne pas "flasher" à chaque
    // synchro auto ; sinon on garde l'affichage courant et le serveur le met à jour.
    if(!view.querySelector(".sites-synth-panel")){
      view.innerHTML=`<div class="flex justify-between mb-6"><h1 class="text-2xl font-black uppercase">📍 SITES - TABLEAU DE BORD</h1></div><div class="card p-10 text-center text-slate-500">Chargement des chiffres depuis le serveur…</div>`;
    }
    window.__sgdiSitesBgRefreshing=true;
    renderSitesServer(view).finally(()=>{window.__sgdiSitesBgRefreshing=false;});
    return;
  }
  const soc=sitesPageSocieteFilter();
  const sites=siteOpsSitesForScope(soc);
  const opsReadOnly=isOpsSupervisorReadOnlySession();
  view.innerHTML=`<div class="flex justify-between mb-6"><h1 class="text-2xl font-black uppercase">📍 SITES - TABLEAU DE BORD</h1><span class="text-sm text-slate-500">Sites transmis par le Commercial</span></div>
  ${opsSupervisorReadOnlyNoticeHTML()}
  ${sitesSocieteSelectorHTML(sites)}
  ${session?.transverse==="materiel"?"":siteSyntheseGeneraleHTML(sites)}
  ${siteMapDashboardHTML(sites)}
  <div id="sites-filter-info" class="hidden mb-4 p-3 rounded-lg bg-slate-100 border border-slate-200 text-sm font-semibold"></div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
  ${sites.length===0?`<div class="card p-10 text-center text-slate-500 col-span-2">Aucun.</div>`:sites.map(s=>{const agents=siteAgentsAffectes(s);const eff=siteEffectifsNorm(s);const manque=Math.max(0,eff.totalContractuel-agents.length);const surplus=Math.max(0,agents.length-(+eff.totalContractuel||0));const op=siteIsOperationalByOpeningDate(s);const sid=siteEditRouteId(s);const lampOk=eff.totalContractuel>0&&agents.length===eff.totalContractuel;const lampKo=eff.totalContractuel>0&&agents.length!==eff.totalContractuel;return`<div class="card p-5 site-card" data-site-status="${op?"operationnel":"non-operationnel"}" data-site-manque="${manque}" data-site-surplus="${surplus}" data-site-instance="${agents.length===0?1:0}" data-site-contractuel="${eff.totalContractuel}" data-site-realise="${agents.length}" data-searchable><div class="flex items-start justify-between mb-4"><div><h2 class="text-xl font-bold flex items-center gap-2 flex-wrap"><span class="site-status-lamp ${lampOk?"lamp-green":lampKo?"lamp-red":"lamp-gray"}" title="${lampOk?"Effectif conforme":surplus>0?"Surplus +"+surplus:manque>0?"Manque −"+manque:"Effectif non défini"}"></span><span>${escapeHTML(s.nom)}</span> <span class="pill pill-amber ml-2 font-mono">${safe(s.indicatif)}</span></h2><div class="text-sm text-slate-500">${safe(s.type)} · ${safe(s.commune)}, ${safe(s.wilaya)}</div><div class="text-xs text-slate-500 mt-1">Client : ${safe(s.client)} · Contact : ${safe(s.contact?.nom)}</div></div><div class="flex gap-2"><a class="btn btn-ghost text-xs" href="#/sites/${sid}">${opsReadOnly?"Accéder":"Modifier"}</a>${opsReadOnly?"":siteAdminSystemActionsHTML(s)}<span class="pill pill-green">Actif</span></div></div>${siteEffectifAlertHTML(eff,agents)}${siteCoverageBarHTML(agents.length,eff.totalContractuel)}<div class="grid grid-6 mb-3 text-xs"><div class="bg-slate-50 p-2 rounded border border-slate-200 text-center"><div class="text-slate-500 font-semibold">Contractuel</div><div class="text-lg font-bold">${eff.totalContractuel||0}</div></div><div class="bg-slate-50 p-2 rounded border border-slate-200 text-center"><div class="text-slate-500 font-semibold">Jour</div><div class="text-lg font-bold">${eff.jour||0}</div></div><div class="bg-slate-50 p-2 rounded border border-slate-200 text-center"><div class="text-slate-500 font-semibold">Nuit</div><div class="text-lg font-bold">${eff.nuit||0}</div></div><button type="button" class="p-2 rounded border text-center transition ${surplus>0?"hover:opacity-80":"hover:bg-blue-50 hover:border-blue-300 bg-slate-50 border-slate-200"}" style="${surplus>0?"background:#fff7ed;border-color:#fdba74":""}" onclick="event.stopPropagation();openSiteAffectesModal('${sid}')"><div class="font-semibold ${surplus>0?"":"text-slate-500"}">Affecté</div><div class="text-lg font-bold ${surplus>0?"":"" }">${agents.length}</div></button><div class="p-2 rounded border text-center ${surplus>0?"":"bg-slate-50 border-slate-200"}" style="${surplus>0?"background:#fff7ed;border-color:#fdba74;color:#c2410c":""}"><div class="font-semibold ${surplus>0?"":"text-slate-500"}">Surplus</div><div class="text-lg font-bold">${surplus>0?"+"+surplus:0}</div></div><div class="p-2 rounded border text-center ${manque>0?"":"bg-slate-50 border-slate-200"}" style="${manque>0?"background:#fef2f2;border-color:#fca5a5;color:#991b1b":""}"><div class="font-semibold ${manque>0?"":"text-slate-500"}">Manque</div><div class="text-lg font-bold">${manque>0?"−"+manque:0}</div></div></div>${session?.transverse==="materiel"?siteDotationHTML(s):""}${siteMovementHistoryHTML(s)}</div>`}).join("")}
  </div>`;
  sitesModuleTimeout(()=>{initSitesDashboardMap();enableClickableSiteCards()},0);
  if(sgdiAuthToken()&&!window.__sgdiSitesLocalFallback&&!window.__sgdiSitesBgRefreshing){
    window.__sgdiSitesBgRefreshing=true;
    renderSitesServer(view).finally(()=>{window.__sgdiSitesBgRefreshing=false;});
  }
}

function enableClickableSiteCards(){
  document.querySelectorAll(".site-card").forEach(card=>{
    if(card.dataset.clickableReady==="1")return;
    card.dataset.clickableReady="1";
    card.style.cursor="pointer";
    card.addEventListener("click",event=>{
      if(event.target.closest("a,button,input,select,textarea,label"))return;
      const link=card.querySelector('a[href^="#/sites/"]');
      const href=link?.getAttribute("href")||"";
      if(href.startsWith("#/"))navigate(href.slice(2));
    });
  });
}

function siteMapQuery(site){
  site=site||{};
  const pos=siteLatLng(site);
  if(pos)return `${pos.lat},${pos.lng}`;
  return [site.nom,site.adresse,site.commune,site.wilaya,"Algérie"].map(v=>String(v||"").trim()).filter(Boolean).join(", ");
}

function googleMapsSearchUrl(query){
  const q=String(query||"Algérie").trim()||"Algérie";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function siteMapDashboardStatusHTML(sites){
  const positioned=(sites||[]).filter(siteLatLng);
  const missing=(sites||[]).filter(s=>!siteLatLng(s));
  const missingActions=isOpsSupervisorReadOnlySession()?"":`${missing.length?`<div class="site-map-missing">${missing.slice(0,6).map(s=>`<button type="button" onclick="navigate('sites/${siteEditRouteId(s)}')" title="Ajouter une position GPS">${escapeHTML(s.nom||s.indicatif||"Site")}</button>`).join("")}${missing.length>6?`<span>+ ${missing.length-6} autre(s)</span>`:""}</div>`:""}`;
  return `<div class="site-map-status">
    <span class="site-map-status-ok">${positioned.length} site(s) positionné(s)</span>
    <span class="${missing.length?"site-map-status-warn":"site-map-status-muted"}">${missing.length} sans position GPS</span>
    ${missingActions}
  </div>`;
}

function siteMapDashboardHTML(sites){
  sites=(sites||[]).filter(Boolean);
  if(!sites.length)return "";
  if(sgdiOverlayIsOpen())return "";
  window.__sgdiSitesDashboardData=sites;
  const positioned=sites.filter(siteLatLng);
  const initial=positioned[0]||sites[0];
  const initialQuery=initial?siteMapQuery(initial):"Algérie";
  const mapCollapsed=!!window.__sgdiSitesMapCollapsed;
  const options=`<option value="__all__">Tous les sites positionnés</option>`+sites.map(s=>{const hasGps=!!siteLatLng(s);return`<option value="${escapeHTML(String(s.id||s.backendId||""))}">${escapeHTML((s.nom||"Site")+" · "+[s.commune,s.wilaya].filter(Boolean).join(", ")+(hasGps?"":" · GPS manquant"))}</option>`}).join("");
  return `<div class="card p-5 mb-5">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
      <div>
        <h2 class="text-lg font-black">Carte des sites</h2>
        <div id="sites-map-label" class="text-xs text-slate-500">Tous les sites</div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div style="position:relative">
          <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:14px;pointer-events:none">🔍</span>
          <input id="sites-map-filter" type="search" class="input" style="padding-left:32px;width:280px" placeholder="Nom du site, wilaya, client..." oninput="siteMapSearchFilter(this.value)"/>
        </div>
        <select id="sites-map-select" class="select" style="max-width:320px" onchange="updateSitesMap(this.value)">${options}</select>
        <button id="sites-map-toggle" type="button" class="btn btn-secondary" aria-expanded="${mapCollapsed?"false":"true"}" onclick="toggleSitesDashboardMap()">${mapCollapsed?"Afficher la carte":"Masquer la carte"}</button>
        <a id="sites-map-open" class="btn btn-ghost" href="${escapeHTML(googleMapsSearchUrl(initialQuery))}" target="_blank" rel="noopener">Ouvrir Google Maps</a>
      </div>
    </div>
    <div id="sites-map-content" class="${mapCollapsed?"hidden":""}">
    ${siteMapDashboardStatusHTML(sites)}
    ${positioned.length?`<div class="rounded-lg overflow-hidden border border-slate-200 bg-slate-100" style="height:360px">
      <div id="sites-map-frame" class="sgdi-maplibre-map" role="region" aria-label="Carte interactive des sites"></div>
    </div>`:`<div class="site-map-empty">Aucun site n'a encore de position GPS. Ouvre une fiche site puis utilise <b>Positionner site</b>.</div>`}
    </div>
  </div>`;
}

function toggleSitesDashboardMap(){
  const content=document.getElementById("sites-map-content");
  const button=document.getElementById("sites-map-toggle");
  if(!content||!button)return;
  const willCollapse=!content.classList.contains("hidden");
  window.__sgdiSitesMapCollapsed=willCollapse;
  content.classList.toggle("hidden",willCollapse);
  button.textContent=willCollapse?"Afficher la carte":"Masquer la carte";
  button.setAttribute("aria-expanded",willCollapse?"false":"true");
  if(!willCollapse){
    initSitesDashboardMap();
    [0,120,350].forEach(ms=>sitesModuleTimeout(()=>{try{window.__sgdiSitesDashboardMap?.resize()}catch(_e){}},ms));
  }
}

async function updateSitesMap(siteId){
  const label=document.getElementById("sites-map-label");
  const open=document.getElementById("sites-map-open");
  const map=window.__sgdiSitesDashboardMap;
  const setMap=(query,text,pos)=>{
    if(open)open.href=googleMapsSearchUrl(query);
    if(label)label.textContent=text||query||"Google Maps";
    if(map&&pos)map.flyTo({center:[pos.lng,pos.lat],zoom:14,essential:true});
  };
  if(String(siteId||"__all__")==="__all__"){
    setMap("Algérie","Tous les sites positionnés");
    const positioned=sgdiAllSitesForMap().map(s=>siteLatLng(s)).filter(Boolean);
    if(map&&positioned.length>1&&window.maplibregl){
      const bounds=new window.maplibregl.LngLatBounds();
      positioned.forEach(p=>bounds.extend([p.lng,p.lat]));
      map.fitBounds(bounds,{padding:54,maxZoom:11});
    }
    return;
  }
  const allSites=sgdiAllSitesForMap();
  const site=allSites.find(s=>String(s.id||"")===String(siteId)||String(s.backendId||"")===String(siteId));
  if(!site)return;
  const pos=siteLatLng(site);
  setMap(siteMapQuery(site),site.nom||siteMapQuery(site),pos);
  if(!pos)toast("Ce site n'a pas encore de position GPS enregistrée.","info");
}

async function searchSitesMap(){
  const input=document.getElementById("sites-map-search");
  const q=String(input?.value||"").trim();
  if(!q){toast("Saisissez un lieu à rechercher","error");return}
  const label=document.getElementById("sites-map-label"),open=document.getElementById("sites-map-open");
  if(open)open.href=googleMapsSearchUrl(q);
  if(label)label.textContent=q;
  const text=q.toLowerCase();
  const site=sgdiAllSitesForMap().find(s=>[s.nom,s.indicatif,s.adresse,s.commune,s.wilaya].some(v=>String(v||"").toLowerCase().includes(text)));
  const pos=siteLatLng(site);
  if(site&&pos&&window.__sgdiSitesDashboardMap){
    window.__sgdiSitesDashboardMap.flyTo({center:[pos.lng,pos.lat],zoom:14,essential:true});
    if(label)label.textContent=siteMapQuery(site);
    return;
  }
  toast("Aucun site positionné trouvé. Le bouton Google Maps ouvre la recherche externe.","info");
}

function siteMapSearchFilter(q){
  q=(q||"").toLowerCase().trim();
  const sel=document.getElementById("sites-map-select");
  const label=document.getElementById("sites-map-label");
  if(!sel)return;
  const allSites=window.__sgdiSitesDashboardData||[];
  let matched=[];
  Array.from(sel.options).forEach(opt=>{
    if(opt.value==="__all__"){opt.style.display="";return}
    if(!q){opt.style.display="";return}
    const site=allSites.find(s=>String(s.id||s.backendId||"")===opt.value);
    const fields=[site?.nom,site?.indicatif,site?.wilaya,site?.commune,site?.client,site?.clientNom,site?.adresse];
    const match=fields.some(v=>String(v||"").toLowerCase().includes(q));
    opt.style.display=match?"":"none";
    if(match)matched.push(site);
  });
  if(!q){
    sel.value="__all__";
    if(label)label.textContent="Tous les sites";
    return;
  }
  if(matched.length===1){
    sel.value=String(matched[0]?.id||matched[0]?.backendId||"__all__");
    updateSitesMap(sel.value);
  }else if(matched.length>1){
    sel.value="__all__";
    if(label)label.textContent=matched.length+" site(s) trouvé(s)";
    const map=window.__sgdiSitesDashboardMap;
    if(map&&window.maplibregl){
      const bounds=new window.maplibregl.LngLatBounds();
      let hasBounds=false;
      matched.forEach(s=>{const p=siteLatLng(s);if(p){bounds.extend([p.lng,p.lat]);hasBounds=true}});
      if(hasBounds)map.fitBounds(bounds,{padding:60,maxZoom:11});
    }
  }else{
    if(label)label.textContent="Aucun résultat";
  }
}

function sitePositionLabel(lat,lng){
  const a=parseFloat(lat),b=parseFloat(lng);
  return Number.isFinite(a)&&Number.isFinite(b)?`${a.toFixed(6)}, ${b.toFixed(6)}`:"Aucune position enregistrée";
}

function sitePositionFieldHTML(s){
  const hasPos=Number.isFinite(parseFloat(s.latitude))&&Number.isFinite(parseFloat(s.longitude));
  const center=siteLatLng(s)||{lat:28.0339,lng:1.6596};
  const readOnly=isOpsSupervisorReadOnlySession();
  return `<div class="col-span-6 site-position-box ${hasPos?"has-position":"missing-position"}">
    <input type="hidden" name="latitude" value="${escapeHTML(s.latitude||"")}"/>
    <input type="hidden" name="longitude" value="${escapeHTML(s.longitude||"")}"/>
    <div class="site-position-header">
      <div class="site-position-copy">
        <div class="site-position-kicker">Position GPS du site</div>
        <div id="site-position-current" class="site-position-value">${escapeHTML(sitePositionLabel(s.latitude,s.longitude))}</div>
        <div class="site-position-note">${readOnly?"Position GPS consultable uniquement.":hasPos?"Coordonnées prêtes à enregistrer avec la fiche site.":"Cliquez sur la carte ou déplacez le marqueur pour positionner le site."}</div>
      </div>
      <div class="site-position-actions"><button id="site-position-map-toggle" type="button" class="btn btn-secondary" aria-expanded="true" onclick="toggleInlineSitePositionMap()">Masquer la carte</button>${session?.transverse==="materiel"||readOnly?"":`<button type="button" class="btn btn-warn site-position-action" onclick="openSitePositionModal('${jsString(s.id)}')">${hasPos?"Ouvrir en grand":"Positionner site"}</button><button type="button" class="btn btn-primary site-position-save" onclick="saveSitePositionInline('${jsString(s.id)}')">Enregistrer position</button>`}</div>
    </div>
    <div id="site-position-inline-wrap" class="site-position-inline-wrap">
      <div id="site-position-inline-map" class="sgdi-maplibre-map site-position-inline-map" data-lat="${Number.isFinite(center.lat)?center.lat:28.0339}" data-lng="${Number.isFinite(center.lng)?center.lng:1.6596}" data-has-position="${hasPos?"1":"0"}" role="region" aria-label="Carte GPS du site"></div>
    </div>
  </div>`;
}

function toggleInlineSitePositionMap(){
  const wrapper=document.getElementById("site-position-inline-wrap");
  const button=document.getElementById("site-position-map-toggle");
  if(!wrapper||!button)return;
  const willHide=!wrapper.classList.contains("hidden");
  wrapper.classList.toggle("hidden",willHide);
  button.textContent=willHide?"Afficher la carte":"Masquer la carte";
  button.setAttribute("aria-expanded",willHide?"false":"true");
  if(!willHide){
    initInlineSitePositionMap();
    [0,120,350].forEach(ms=>sitesModuleTimeout(()=>{try{window.__sgdiInlineSitePositionMap?.resize()}catch(_e){}},ms));
  }
}

function sitePositionMarkerIcon(){
  const el=document.createElement("div");
  el.className="site-position-dot-marker";
  el.setAttribute("role","button");
  el.setAttribute("tabindex","0");
  el.title="Position du site";
  return el;
}

function updateSitePositionFormFields(lat,lng){
  const f=document.getElementById("site-form");
  const a=parseFloat(lat),b=parseFloat(lng);
  if(!f||!Number.isFinite(a)||!Number.isFinite(b))return false;
  const latInput=f.querySelector('[name="latitude"]');
  const lngInput=f.querySelector('[name="longitude"]');
  if(latInput)latInput.value=a.toFixed(6);
  if(lngInput)lngInput.value=b.toFixed(6);
  const label=document.getElementById("site-position-current");
  if(label)label.textContent=sitePositionLabel(a,b);
  const box=label?.closest?.(".site-position-box");
  if(box){box.classList.remove("missing-position");box.classList.add("has-position")}
  const note=box?.querySelector?.(".site-position-note");
  if(note)note.textContent="Coordonnées prêtes à enregistrer avec la fiche site.";
  const action=box?.querySelector?.(".site-position-action");
  if(action)action.textContent="Ouvrir en grand";
  return true;
}

async function saveSitePositionOnly(siteId,lat,lng){
  if(guardOpsSupervisorMutation("site","Accès superviseur OPS : édition des sites non autorisée."))return false;
  const lookup=decodeURIComponent(String(siteId||""));
  const site=(db.sites||[]).find(x=>String(x.id)===lookup||String(x.backendId||"")===lookup);
  if(!site){toast("Enregistrez d'abord la fiche site avant d'enregistrer sa position","error");return false}
  if(!siteCanEditFromCurrentModule(site)&&sgdiViewModeActive){toast("Fiche site verrouillée : modification réservée à Administration système","error");return false}
  const a=parseFloat(lat),b=parseFloat(lng);
  if(!Number.isFinite(a)||!Number.isFinite(b)){toast("Coordonnées GPS invalides","error");return false}
  const lockState={
    ficheTechniqueLocked:site.ficheTechniqueLocked,
    siteFormLocked:site.siteFormLocked,
    lockedAt:site.lockedAt,
    lockedBy:site.lockedBy
  };
  site.latitude=a.toFixed(6);
  site.longitude=b.toFixed(6);
  site.coordonnees={latitude:a,longitude:b};
  try{
    await persistSiteToPostgres(site);
    Object.assign(site,lockState);
    await syncSitesFromPostgres().catch(()=>{});
    if(!(await saveDBAndWaitToast("Position GPS non confirmée")))return false;
    toast("Position GPS enregistrée sans verrouiller la fiche","success");
    return true;
  }catch(e){
    Object.assign(site,lockState);
    toast("Position GPS non sauvegardée : "+(e.message||e),"error");
    return false;
  }
}

async function saveSitePositionInline(siteId){
  if(guardOpsSupervisorMutation("site","Accès superviseur OPS : édition des sites non autorisée."))return;
  const f=document.getElementById("site-form");
  const lat=parseFloat(f?.querySelector('[name="latitude"]')?.value);
  const lng=parseFloat(f?.querySelector('[name="longitude"]')?.value);
  if(!f||!Number.isFinite(lat)||!Number.isFinite(lng)){toast("Choisissez d'abord un point sur la carte","error");return}
  await saveSitePositionOnly(siteId,lat,lng);
}

function initInlineSitePositionMap(){
  const el=document.getElementById("site-position-inline-map");
  if(!el||el.dataset.sgdiMapReady==="1")return;
  el.dataset.sgdiMapReady="1";
  if(window.__sgdiInlineSitePositionMap&&typeof window.__sgdiInlineSitePositionMap.remove==="function"){
    try{window.__sgdiInlineSitePositionMap.remove()}catch(_){}
  }
  loadMapLibre().then(maplibregl=>{
    if(document.getElementById("site-position-inline-map")!==el)return;
    const f=document.getElementById("site-form");
    const locked=f?.dataset?.locked==="1"||isOpsSupervisorReadOnlySession();
    const lat=parseFloat(el.dataset.lat),lng=parseFloat(el.dataset.lng);
    const hasPos=el.dataset.hasPosition==="1"&&Number.isFinite(lat)&&Number.isFinite(lng);
    const center=[Number.isFinite(lng)?lng:1.6596,Number.isFinite(lat)?lat:28.0339];
    const map=new maplibregl.Map({container:"site-position-inline-map",style:sgdiMapLibreStyle(),center,zoom:hasPos?14:5,scrollZoom:false});
    window.__sgdiInlineSitePositionMap=map;
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-left");
    const marker=new maplibregl.Marker({element:sitePositionMarkerIcon(),draggable:!locked}).setLngLat(center).addTo(map);
    window.__sgdiInlineSitePositionMarker=marker;
    const setPosition=lngLat=>{
      if(locked)return;
      updateSitePositionFormFields(lngLat.lat,lngLat.lng);
    };
    marker.on("dragend",()=>setPosition(marker.getLngLat()));
    map.on("click",e=>{if(locked)return;marker.setLngLat(e.lngLat);setPosition(e.lngLat)});
    map.on("load",()=>sitesModuleTimeout(()=>{try{map.resize()}catch(_){}},100));
  }).catch(e=>{
    el.innerHTML=`<div class="p-5 text-sm text-red-700 font-semibold">Carte indisponible : ${escapeHTML(e.message||e)}</div>`;
  });
}

function openSitePositionModal(siteId){
  if(guardOpsSupervisorMutation("site","Accès superviseur OPS : édition des sites non autorisée."))return;
  const f=document.getElementById("site-form");if(!f)return;
  const lat=parseFloat(f.querySelector('[name="latitude"]')?.value);
  const lng=parseFloat(f.querySelector('[name="longitude"]')?.value);
  const center=Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng}:{lat:28.0339,lng:1.6596};
  openModal(`<div class="site-position-modal">
    <div class="site-position-modal-head">
      <div>
        <h3 class="font-black text-lg">Positionner site</h3>
        <div class="text-xs text-slate-500">Cliquez directement sur la carte pour ajouter ou déplacer le site.</div>
      </div>
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button>
    </div>
    <div id="site-position-map" class="sgdi-maplibre-map site-position-modal-map" data-lat="${Number.isFinite(lat)?lat:center.lat}" data-lng="${Number.isFinite(lng)?lng:center.lng}" style="height:560px"></div>
    <div class="site-position-modal-foot">
      <div class="site-position-modal-coords">
        <span>Latitude <b data-site-modal-lat>${Number.isFinite(lat)?lat.toFixed(6):"—"}</b></span>
        <span>Longitude <b data-site-modal-lng>${Number.isFinite(lng)?lng.toFixed(6):"—"}</b></span>
        <input type="hidden" name="modal_latitude" value="${Number.isFinite(lat)?lat:""}"/>
        <input type="hidden" name="modal_longitude" value="${Number.isFinite(lng)?lng:""}"/>
      </div>
      <div class="flex justify-end gap-2 flex-wrap">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>
        <button type="button" class="btn btn-primary" onclick="saveSitePositionFromModal('${jsString(siteId||"")}')">Enregistrer position</button>
      </div>
    </div>
  </div>`);
  initSitePositionMap();
}

function initSitePositionMap(){
  const el=document.getElementById("site-position-map");
  if(!el||el.dataset.sgdiMapReady==="1")return;
  el.dataset.sgdiMapReady="1";
  loadMapLibre().then(maplibregl=>{
    if(document.getElementById("site-position-map")!==el)return;
    const lat=parseFloat(el.dataset.lat),lng=parseFloat(el.dataset.lng);
    const center=[Number.isFinite(lng)?lng:1.6596,Number.isFinite(lat)?lat:28.0339];
    const map=new maplibregl.Map({container:"site-position-map",style:sgdiMapLibreStyle(),center,zoom:Number.isFinite(lat)&&Number.isFinite(lng)?14:5,scrollZoom:false});
    window.__sgdiSitePositionMap=map;
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-left");
    const marker=new maplibregl.Marker({element:sitePositionMarkerIcon(),draggable:true}).setLngLat(center).addTo(map);
    window.__sgdiSitePositionMarker=marker;
    const setInputs=lngLat=>{
      const a=Number(lngLat.lat),b=Number(lngLat.lng);
      const latInput=document.querySelector('.modal-bg [name="modal_latitude"]');
      const lngInput=document.querySelector('.modal-bg [name="modal_longitude"]');
      if(latInput)latInput.value=a.toFixed(6);
      if(lngInput)lngInput.value=b.toFixed(6);
      const latLabel=document.querySelector('.modal-bg [data-site-modal-lat]');
      const lngLabel=document.querySelector('.modal-bg [data-site-modal-lng]');
      if(latLabel)latLabel.textContent=a.toFixed(6);
      if(lngLabel)lngLabel.textContent=b.toFixed(6);
    };
    marker.on("dragend",()=>setInputs(marker.getLngLat()));
    map.on("click",e=>{marker.setLngLat(e.lngLat);setInputs(e.lngLat)});
    map.on("load",()=>sitesModuleTimeout(()=>{try{map.resize()}catch(_){}},100));
  }).catch(e=>{
    el.innerHTML=`<div class="p-5 text-sm text-red-700 font-semibold">Carte indisponible : ${escapeHTML(e.message||e)}</div>`;
  });
}

function refreshSitePositionMap(){
  const lat=document.querySelector('.modal-bg [name="modal_latitude"]')?.value;
  const lng=document.querySelector('.modal-bg [name="modal_longitude"]')?.value;
  const a=parseFloat(lat),b=parseFloat(lng);
  const map=window.__sgdiSitePositionMap,marker=window.__sgdiSitePositionMarker;
  if(Number.isFinite(a)&&Number.isFinite(b)&&map&&marker){
    marker.setLngLat([b,a]);
    map.flyTo({center:[b,a],zoom:14,essential:true});
  }
  else toast("Saisissez latitude et longitude valides","error");
}

function refreshSitePositionGoogleMap(){refreshSitePositionMap()}

async function saveSitePositionFromModal(siteId){
  if(guardOpsSupervisorMutation("site","Accès superviseur OPS : édition des sites non autorisée."))return;
  const lat=document.querySelector('.modal-bg [name="modal_latitude"]')?.value;
  const lng=document.querySelector('.modal-bg [name="modal_longitude"]')?.value;
  const a=parseFloat(lat),b=parseFloat(lng);
  if(!Number.isFinite(a)||!Number.isFinite(b)||!updateSitePositionFormFields(a,b)){toast("Choisissez un point sur la carte","error");return}
  const marker=window.__sgdiInlineSitePositionMarker,map=window.__sgdiInlineSitePositionMap;
  if(marker&&map){marker.setLngLat([b,a]);map.flyTo({center:[b,a],zoom:14,essential:true})}
  const saved=await saveSitePositionOnly(siteId,a,b);
  if(saved)closeModal();
}

function siteDotationHTML(site){
  const rows=(site.equipements||site.materiel||[]).filter(x=>x&&(x.categorie||x.designation||x.quantite||x.etat));
  return `<div class="mt-4 p-4 rounded-lg border border-slate-200 bg-slate-50">
    <div class="flex items-center justify-between gap-2 mb-3">
      <h4 class="text-sm font-black uppercase tracking-wide">Dotation du site</h4>
      <span class="pill pill-gray">${rows.length} article(s)</span>
    </div>
    ${rows.length?`<div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr><th>Catégorie</th><th>Désignation</th><th>N° série / Réf</th><th>Quantité</th><th>État / observation</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${escapeHTML(x.categorie||"—")}</td><td class="font-semibold">${escapeHTML(x.designation||"—")}</td><td class="font-mono">${escapeHTML(x.codeSerie||x.numeroSerie||x.reference||"—")}</td><td class="font-bold text-center">${qty(x.quantite||0)}</td><td>${escapeHTML(x.etat||"—")}</td></tr>`).join("")}</tbody></table></div>`:`<div class="text-sm text-slate-500">Aucune dotation enregistrée pour ce site.</div>`}
  </div>`;
}

function siteBackendSituationRows(d){return Array.isArray(d?.sites)?d.sites:[]}

function siteBackendSituationMap(d){
  const map=new Map();
  siteBackendSituationRows(d).forEach(row=>{
    const site=row?.site||{};
    [site.id,site.backendId,row.site_id,row.siteId].filter(v=>v!==undefined&&v!==null&&v!=="").forEach(id=>map.set(String(id),row));
  });
  return map;
}

function siteStaffingBalanceKpiHTML(manqueGlobal,surplusGlobal){
  if(surplusGlobal>0){
    return siteSynthKpiHTML({mode:"surplus",tone:"warn",icon:"↗",label:"Effectif surplus",value:surplusGlobal,sub:"Réalisé - contractuel",title:"Afficher les sites avec effectif surplus"});
  }
  return siteSynthKpiHTML({mode:"manque",tone:manqueGlobal>0?"danger":"success",icon:manqueGlobal>0?"!":"✓",label:"Manque d'effectif",value:manqueGlobal,sub:"Contractuel - réalisé",title:"Afficher les sites avec manque d'effectif"});
}

function siteSynthKpiHTML({mode,tone="neutral",icon="•",label,value,sub,title}){
  return `<button type="button" onclick="filterSitesSituation('${mode}')" class="sites-synth-kpi sites-synth-kpi--${tone} sites-synth-kpi--mode-${escapeHTML(mode)} kpi-clickable" title="${escapeHTML(title||label)}">
    <span class="sites-synth-kpi-icon">${escapeHTML(icon)}</span>
    <span class="sites-synth-kpi-label">${escapeHTML(label)}</span>
    <strong>${value}</strong>
    <small>${escapeHTML(sub||"")}</small>
  </button>`;
}

function siteSyntheseServerHTML(d,sites){
  if(!d)return"";
  let siteInstanceAffectation=siteBackendNumber(d.instance_assignment_sites);
  let siteActif=siteBackendNumber(d.active_sites);
  let siteOperationnel=siteBackendNumber(d.operational_sites);
  let effectifGlobal=siteBackendNumber(d.contractual_staff);
  let effectifRealise=siteBackendNumber(d.realized_staff);
  let manqueGlobal=siteBackendNumber(d.missing_staff);
  let surplusGlobal=("surplus_staff" in d)?siteBackendNumber(d.surplus_staff):Math.max(0,effectifRealise-effectifGlobal);
  if(Array.isArray(sites)){
    const situationBySite=siteBackendSituationMap(d);
    const metrics=sites.map(site=>siteBackendMetricForSite(site,situationBySite));
    siteActif=sites.length;
    siteInstanceAffectation=metrics.filter(m=>m.realized===0).length;
    siteOperationnel=metrics.filter(m=>m.operational).length;
    effectifGlobal=metrics.reduce((sum,m)=>sum+m.contractual,0);
    effectifRealise=metrics.reduce((sum,m)=>sum+m.realized,0);
    manqueGlobal=metrics.reduce((sum,m)=>sum+m.missing,0);
    surplusGlobal=metrics.reduce((sum,m)=>sum+m.surplus,0);
  }
  return`<div class="sites-synth-panel">
    <div class="sites-synth-head"><div><span>Vue exploitation</span><h2>Synthèse situation générale des sites</h2></div><button type="button" onclick="filterSitesSituation('all')">Tous les sites</button></div>
    <div id="sites-synth-detail" class="sites-synth-detail" style="display:none"></div>
    <div class="sites-synth-grid">
      ${siteSynthKpiHTML({mode:"instance",tone:siteInstanceAffectation>0?"warn":"success",icon:"⌖",label:"Site en instance d'affectation",value:siteInstanceAffectation,sub:siteInstanceAffectation>0?"Actifs sans aucun agent":"Tous les sites sont dotés",title:"Afficher les sites sans agent affecté"})}
      ${siteSynthKpiHTML({mode:"all",tone:"info",icon:"●",label:"Site actif",value:siteActif,sub:"Sites non archivés",title:"Afficher tous les sites actifs"})}
      ${siteSynthKpiHTML({mode:"operationnel",tone:"success",icon:"✓",label:"Site opérationnel",value:siteOperationnel,sub:"Date ouverture atteinte",title:"Afficher les sites opérationnels"})}
      ${siteSynthKpiHTML({mode:"contractuel",tone:"neutral",icon:"≡",label:"Effectif contrat",value:effectifGlobal,sub:"Besoin total prévu",title:"Afficher les sites avec effectif contractuel"})}
      ${siteSynthKpiHTML({mode:"realise",tone:"primary",icon:"👥",label:"Effectif réalisé",value:effectifRealise,sub:"Employés affectés",title:"Afficher les sites avec effectif réalisé"})}
      ${siteStaffingBalanceKpiHTML(manqueGlobal,surplusGlobal)}
    </div>
  </div>`;
}

function siteSyntheseGeneraleHTML(sites){
  const data=sites.map(s=>{const agents=siteAgentsAffectes(s);const eff=siteEffectifsNorm(s);const manque=Math.max(0,eff.totalContractuel-agents.length);const surplus=Math.max(0,agents.length-eff.totalContractuel);return{agents,eff,manque,surplus}});
  const siteInstanceAffectation=data.filter(d=>d.agents.length===0).length;
  const siteActif=sites.length;
  const siteOperationnel=sites.filter(siteIsOperationalByOpeningDate).length;
  const effectifGlobal=data.reduce((sum,d)=>sum+d.eff.totalContractuel,0);
  const effectifRealise=data.reduce((sum,d)=>sum+d.agents.length,0);
  const manqueGlobal=Math.max(0,effectifGlobal-effectifRealise);
  const surplusGlobal=Math.max(0,effectifRealise-effectifGlobal);
  return`<div class="sites-synth-panel">
    <div class="sites-synth-head"><div><span>Vue exploitation</span><h2>Synthèse situation générale des sites</h2></div><button type="button" onclick="filterSitesSituation('all')">Tous les sites</button></div>
    <div id="sites-synth-detail" class="sites-synth-detail" style="display:none"></div>
    <div class="sites-synth-grid">
      ${siteSynthKpiHTML({mode:"instance",tone:siteInstanceAffectation>0?"warn":"success",icon:"⌖",label:"Site en instance d'affectation",value:siteInstanceAffectation,sub:siteInstanceAffectation>0?"Actifs sans aucun agent":"Tous les sites sont dotés",title:"Afficher les sites sans agent affecté"})}
      ${siteSynthKpiHTML({mode:"all",tone:"info",icon:"●",label:"Site actif",value:siteActif,sub:"Sites non archivés",title:"Afficher tous les sites actifs"})}
      ${siteSynthKpiHTML({mode:"operationnel",tone:"success",icon:"✓",label:"Site opérationnel",value:siteOperationnel,sub:"Date ouverture atteinte",title:"Afficher les sites opérationnels"})}
      ${siteSynthKpiHTML({mode:"contractuel",tone:"neutral",icon:"≡",label:"Effectif contrat",value:effectifGlobal,sub:"Besoin total prévu",title:"Afficher les sites avec effectif contractuel"})}
      ${siteSynthKpiHTML({mode:"realise",tone:"primary",icon:"👥",label:"Effectif réalisé",value:effectifRealise,sub:"Employés affectés",title:"Afficher les sites avec effectif réalisé"})}
      ${siteStaffingBalanceKpiHTML(manqueGlobal,surplusGlobal)}
    </div>
  </div>`;
}

function filterSitesSituation(mode){
  const cards=document.querySelectorAll(".site-card");
  let shown=0;
  const matched=[];
  cards.forEach(card=>{
    const manque=+card.dataset.siteManque||0;
    const surplus=+card.dataset.siteSurplus||0;
    const status=card.dataset.siteStatus||"";
    const instance=+card.dataset.siteInstance||0;
    const contractuel=+card.dataset.siteContractuel||0;
    const realise=+card.dataset.siteRealise||0;
    const ok=mode==="all"||(mode==="operationnel"&&status==="operationnel")||(mode==="manque"&&manque>0)||(mode==="surplus"&&surplus>0)||(mode==="instance"&&instance>0)||(mode==="contractuel"&&contractuel>0)||(mode==="realise"&&realise>0);
    card.style.display=ok?"":"none";
    if(ok){shown++;matched.push(card)}
  });
  renderSitesSynthDetail(mode,matched);
  const info=document.getElementById("sites-filter-info");
  if(info){
    if(mode==="all"){info.classList.add("hidden");info.innerHTML="";}
    else{info.classList.remove("hidden");info.innerHTML=`Filtre actif : ${mode==="operationnel"?"sites opérationnels":mode==="instance"?"sites en instance d'affectation":mode==="contractuel"?"sites avec effectif contractuel":mode==="realise"?"sites avec effectif réalisé":mode==="surplus"?"sites avec effectif surplus":"sites avec manque d'effectif"} · ${shown} site(s) affiché(s) <button class="btn btn-ghost text-xs ml-3" onclick="filterSitesSituation('all')">Réinitialiser</button>`;}
  }
}

function sitesSynthModeLabel(mode){
  return mode==="operationnel"?"Sites opérationnels":mode==="instance"?"Sites en instance d'affectation":mode==="contractuel"?"Sites avec effectif contrat":mode==="realise"?"Sites avec effectif réalisé":mode==="surplus"?"Sites avec effectif surplus":mode==="manque"?"Sites avec manque d'effectif":"Tous les sites";
}

function renderSitesSynthDetail(mode,cards){
  const box=document.getElementById("sites-synth-detail");
  if(!box)return;
  if(mode==="all"){
    box.style.display="none";
    box.innerHTML="";
    return;
  }
  const rows=(cards||[]).slice(0,12).map(card=>{
    const title=(card.querySelector("h2 span:not(.site-status-lamp):not(.pill)")?.textContent||card.querySelector("h2")?.textContent||"Site").replace(/\s+/g," ").trim();
    const contractuel=+card.dataset.siteContractuel||0;
    const realise=+card.dataset.siteRealise||0;
    const manque=+card.dataset.siteManque||0;
    const surplus=+card.dataset.siteSurplus||0;
    const status=card.dataset.siteStatus==="operationnel"?"Opérationnel":"Non opérationnel";
    return `<tr>
      <td>${escapeHTML(title)}</td>
      <td>${status}</td>
      <td>${contractuel}</td>
      <td>${realise}</td>
      <td class="${manque>0?"is-danger":""}">${manque}</td>
      <td class="${surplus>0?"is-warn":""}">${surplus}</td>
    </tr>`;
  }).join("");
  box.innerHTML=`<div class="sites-synth-detail-head">
      <div><strong>${escapeHTML(sitesSynthModeLabel(mode))}</strong><span>${cards.length} site(s) concerné(s)</span></div>
      <button type="button" onclick="filterSitesSituation('all')">Fermer</button>
    </div>
    ${cards.length?`<div class="sites-synth-detail-table"><table><thead><tr><th>Site</th><th>Statut</th><th>Contrat</th><th>Réalisé</th><th>Manque</th><th>Surplus</th></tr></thead><tbody>${rows}</tbody></table>${cards.length>12?`<div class="sites-synth-detail-more">+ ${cards.length-12} autre(s) site(s) affiché(s) dans la liste en dessous.</div>`:""}</div>`:`<div class="sites-synth-detail-empty">Aucun site correspondant à ce compteur.</div>`}`;
  box.style.display="";
  box.scrollIntoView({behavior:"smooth",block:"nearest"});
}

function siteMovementHistoryHTML(site){
  if(session?.transverse==="materiel")return"";
  const count=opsMovementRows().filter(f=>siteMatchesReference(site,f)).length;
  const sid=jsString(site.id||site.backendId||site.indicatif||"");
  return`<div class="mt-3"><button type="button" class="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition text-sm font-semibold" onclick="openSiteMovementHistoryModal('${sid}')"><span>Historique des mouvements</span><span class="pill pill-gray">${count}</span></button></div>`;
}

function openSiteMovementHistoryModal(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  const rows=opsMovementRows().filter(f=>siteMatchesReference(site,f)).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
  openModal(`<h3 class="font-bold text-lg mb-2">Historique des mouvements</h3>
    <div class="p-3 rounded bg-slate-50 border border-slate-200 mb-4">
      <div class="font-black">${escapeHTML(site.nom||"Site")}</div>
      <div class="text-xs text-slate-500">${escapeHTML(site.indicatif||"—")} · ${escapeHTML(site.client||"Sans client")}</div>
    </div>
    ${rows.length?`<div class="card overflow-hidden"><table><thead><tr><th>Date</th><th>Employé</th><th>Motif</th><th>N° ordre</th></tr></thead><tbody>${rows.map(f=>`<tr data-searchable><td class="text-xs">${formatDate(f.date)}</td><td class="text-xs font-semibold">${escapeHTML(opsMovementAgentLabel(f._agent))}</td><td class="text-xs">${escapeHTML(f.mouvementMotif||f.mouvementType||"—")}</td><td class="text-xs font-mono">${escapeHTML(f.ordreMouvementNumero||f.mouvementNumero||"—")}</td></tr>`).join("")}</tbody></table></div>`:`<div class="text-sm text-slate-500 p-6 rounded bg-slate-50 border text-center">Aucun mouvement enregistré pour ce site.</div>`}
    <div class="flex justify-end mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function openSiteAffectesModal(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  if(supervisorModuleActive()&&!siteInSupervisorScope(site))return toast("Site non autorisé pour ce superviseur","error");
  const eff=siteEffectifsNorm(site);
  const backend=siteBackendSituationForSite(site);
  const contractuel=siteBackendNumber(backend?.contractual_staff)||(+eff.totalContractuel||0);
  const backendRows=siteBackendAssignmentRows(site);
  const agentFromAssignmentRow=row=>findEmployeeByRef(row?.employee_id)||findEmployeeByRef(row?.code)||findEmployeeByRef(row?.matricule)||null;
  const rowVisible=item=>{
    const row=item?.employee_id||item?.assignment_id?item:null;
    const a=row?agentFromAssignmentRow(row):item;
    if(a&&(String(a.statut||"").toLowerCase()==="suspendu"||employeeIsFormer(a)))return false;
    if(a&&supervisorModuleActive()&&!agentInSupervisorScope(a))return false;
    return true;
  };
  const agents=(backendRows||siteAgentsAffectes(site)).filter(rowVisible);
  const surplus=contractuel>0&&agents.length>contractuel?agents.slice(contractuel):[];
  const main=contractuel>0&&agents.length>contractuel?agents.slice(0,contractuel):agents;
  const agentRow=item=>{
    const row=item?.employee_id||item?.assignment_id?item:null;
    const a=row?agentFromAssignmentRow(row):item;
    const aff=a?opsEmployeeLiveAffectation(a):{};
    const code=row?.code||a?.matricule||"—";
    const name=row?.name||((a?.nom||"")+" "+(a?.prenom||"")).trim()||"Employé PostgreSQL";
    const poste=row?.position||aff?.poste||a?.fonction||"—";
    const start=row?.start_date||aff?.dateDebut||"";
    const href=a?`#/effectif/agent/${employeeRouteId(a)}`:"#";
    const demandeCell=a?`<td class="text-right"><div class="sup-demande-wrap" style="position:relative;display:inline-block"><button type="button" class="btn btn-ghost text-xs" style="padding:2px 8px;font-weight:900" onclick="event.stopPropagation();toggleSuperviseurDemandeMenu(this,'${jsString(a.id)}')" title="Demande">⋮</button></div></td>`:`<td></td>`;
    return`<tr data-searchable><td><a href="${href}" class="font-mono text-amber-600 font-bold hover:underline" onclick="closeModal()">${safe(code)}</a></td><td><a href="${href}" class="hover:underline" onclick="closeModal()">${escapeHTML(name)}</a></td><td class="text-xs">${safe(poste)}</td><td class="text-xs">${formatDate(start)}</td>${demandeCell}</tr>`;
  };
  openModal(`<h3 class="font-bold text-lg mb-2">Effectifs affectés</h3>
    <div class="p-3 rounded bg-slate-50 border border-slate-200 mb-4">
      <div class="font-black">${escapeHTML(site.nom||"Site")}</div>
      <div class="text-xs text-slate-500">${escapeHTML(site.indicatif||"—")} · Contractuel : ${contractuel} · Affecté : ${agents.length}</div>
    </div>
    ${main.length?`<div class="card overflow-hidden mb-3"><div class="px-3 py-2 bg-slate-50 border-b font-semibold text-sm">Effectifs affectés (${main.length})</div><table><thead><tr><th>Code</th><th>Nom</th><th>Poste</th><th>Depuis</th><th></th></tr></thead><tbody>${main.map(agentRow).join("")}</tbody></table></div>`:`<div class="text-sm text-slate-500 p-4 rounded bg-slate-50 border text-center mb-3">Aucun employé affecté.</div>`}
    ${surplus.length?`<div class="card overflow-hidden" style="border-color:#fdba74"><div class="px-3 py-2 border-b font-semibold text-sm" style="background:#fff7ed;color:#c2410c">Effectifs en surplus (+${surplus.length})</div><table><thead><tr><th>Code</th><th>Nom</th><th>Poste</th><th>Depuis</th><th></th></tr></thead><tbody>${surplus.map(agentRow).join("")}</tbody></table></div>`:""}
    <div class="flex justify-end mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button></div>`);
}

function closeSuperviseurDemandeMenu(){
  document.querySelectorAll(".sup-demande-menu").forEach(m=>m.remove());
}

function toggleSuperviseurDemandeMenu(btn,agentId){
  const already=btn.closest(".sup-demande-wrap")?.querySelector(".sup-demande-menu");
  closeSuperviseurDemandeMenu();
  if(already)return;
  const menu=document.createElement("div");
  menu.className="sup-demande-menu";
  menu.innerHTML=`<div class="sup-demande-menu-title">Demande</div>${Object.entries(SUPERVISEUR_DEMANDE_TYPES).map(([type,meta])=>`<button type="button" onclick="openSuperviseurDemandeForm('${jsString(agentId)}','${type}')">${escapeHTML(meta.label)}</button>`).join("")}`;
  const wrap=btn.closest(".sup-demande-wrap")||btn.parentElement;
  wrap.appendChild(menu);
  sitesModuleTimeout(()=>document.addEventListener("click",closeSuperviseurDemandeMenu,{once:true}),0);
}

function openSuperviseurDemandeForm(agentId,type){
  closeSuperviseurDemandeMenu();
  const meta=SUPERVISEUR_DEMANDE_TYPES[type];if(!meta)return;
  const a=(db.agents||[]).find(x=>String(x.id)===String(agentId));if(!a){toast("Employé introuvable","error");return}
  const aff=agentLiveAffectation(a)||{};
  openModal(`<h3 class="font-bold text-lg mb-1">Demande de ${escapeHTML(meta.label.toLowerCase())}</h3>
    <p class="text-sm text-slate-500 mb-3">Signalement superviseur terrain, transmis pour traitement.</p>
    <form onsubmit="event.preventDefault();confirmSuperviseurDemande('${jsString(agentId)}','${type}',this)">
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div><label class="label">Nom</label><input class="input bg-slate-100" value="${escapeHTML(a.nom||"")}" readonly/></div>
        <div><label class="label">Prénom</label><input class="input bg-slate-100" value="${escapeHTML(a.prenom||"")}" readonly/></div>
        <div><label class="label">Code</label><input class="input bg-slate-100" value="${escapeHTML(a.matricule||"—")}" readonly/></div>
        <div><label class="label">Affectation</label><input class="input bg-slate-100" value="${escapeHTML(aff.siteName||"Sans affectation")}" readonly/></div>
      </div>
      <label class="label">Compte rendu détaillé *</label>
      <textarea class="textarea" name="motif" rows="6" required placeholder="Décrivez précisément les faits justifiant cette demande..."></textarea>
      <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary">Transmettre</button></div>
    </form>`);
}

async function confirmSuperviseurDemande(agentId,type,form){
  const meta=SUPERVISEUR_DEMANDE_TYPES[type];if(!meta)return;
  const a=(db.agents||[]).find(x=>String(x.id)===String(agentId));if(!a)return;
  const fd=new FormData(form);
  const motif=String(fd.get("motif")||"").trim();
  if(!motif){toast("Le compte rendu détaillé est obligatoire","error");return}
  const name=((a.nom||"")+" "+(a.prenom||"")).trim();
  const aff=agentLiveAffectation(a)||{};
  workflowUpsertTask({
    id:`sup_demande_${type}_${agentId}_${Date.now()}`,
    module:meta.module,
    route:meta.route,
    employeeId:a.id,
    candidateName:name,
    matricule:a.matricule||"",
    societe:a.societe||"",
    title:`Demande de ${meta.label.toLowerCase()} — ${name}`,
    message:`${name} · ${a.matricule||"—"} · ${aff.siteName||"Sans affectation"} · ${motif}`,
    createdBy:session?.username||"Superviseur",
    createdAt:new Date().toISOString()
  });
  addEmployeeCareerEvent(a,meta.label,{date:today(),motif:`Demande superviseur (${meta.label}) : ${motif}`,source:"superviseur-demande"});
  if(!(await saveDBAndWaitToast("Demande non confirmée")))return;
  closeModal();toast("Demande transmise","success");renderView();
}

function siteNonAffectesPourSite(site){
  const soc=site?.societe||"";
  return (db.agents||[])
    .filter(a=>employeeIsActive(a)&&!agentHasLiveAffectation(a)&&(!soc||normalizeSocieteName(a.societe||"")===normalizeSocieteName(soc)))
    .sort((a,b)=>((a.nom||"")+" "+(a.prenom||"")).localeCompare((b.nom||"")+" "+(b.prenom||"")));
}

function openSiteAjouterEffectifModal(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  const agents=siteNonAffectesPourSite(site);
  const row=a=>{
    const nom=escapeHTML(((a.nom||"")+" "+(a.prenom||"")).trim());
    const mat=escapeHTML(a.matricule||"—");
    const poste=escapeHTML(a.fonction||a.position||"");
    return `<label class="site-eff-add-row"><input type="checkbox" class="site-eff-add-cb" value="${escapeHTML(a.id)}" onchange="siteAjouterEffectifCount()"/><span><b>${nom}</b><small> · ${mat}${poste?" · "+poste:""}</small></span></label>`;
  };
  openModal(`<h3 class="font-bold text-lg mb-2">Ajouter effectif</h3>
    <div class="p-3 rounded bg-slate-50 border border-slate-200 mb-3">
      <div class="font-black">${escapeHTML(site.nom||"Site")}</div>
      <div class="text-xs text-slate-500">${escapeHTML(site.indicatif||"—")}${site.societe?` · ${escapeHTML(site.societe)}`:""}</div>
    </div>
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-slate-500"><span id="site-eff-add-count">0</span> sélectionné(s)</span>
      <div class="flex items-center gap-2">
        <button type="button" class="btn btn-ghost text-xs py-0.5 px-2" onclick="siteAjouterEffectifSelectAll(true)">Tout</button>
        <button type="button" class="btn btn-ghost text-xs py-0.5 px-2" onclick="siteAjouterEffectifSelectAll(false)">Aucun</button>
      </div>
    </div>
    <div id="site-eff-add-list" class="site-eff-add-list">
      ${agents.length?agents.map(row).join(""):`<div class="p-4 text-center text-slate-500 text-sm">Aucun employé non affecté${site.societe?" pour "+escapeHTML(site.societe):""}.</div>`}
    </div>
    <div class="flex justify-end gap-2 mt-4">
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Annuler</button>
      <button type="button" id="site-eff-add-validate" class="btn btn-primary" onclick="siteAjouterEffectifValider('${jsString(siteId)}')">Valider affectation</button>
    </div>`);
}

function siteAjouterEffectifCount(){
  const list=document.getElementById("site-eff-add-list");
  const n=list?list.querySelectorAll(".site-eff-add-cb:checked").length:0;
  const el=document.getElementById("site-eff-add-count");
  if(el)el.textContent=n;
}

function siteAjouterEffectifSelectAll(checked){
  const list=document.getElementById("site-eff-add-list");
  if(!list)return;
  list.querySelectorAll(".site-eff-add-cb").forEach(cb=>cb.checked=checked);
  siteAjouterEffectifCount();
}

async function siteAjouterEffectifValider(siteId){
  const site=findSiteByRef(siteId);if(!site)return toast("Site introuvable","error");
  const list=document.getElementById("site-eff-add-list");
  const agentIds=list?[...list.querySelectorAll(".site-eff-add-cb:checked")].map(cb=>cb.value).filter(Boolean):[];
  if(!agentIds.length){toast("Sélectionnez au moins un employé","error");return}
  const btn=document.getElementById("site-eff-add-validate");
  if(btn){btn.disabled=true;btn.textContent="Enregistrement..."}
  const date=today();
  const ordreMouvementNumero=nextOrdreMouvementNumero();
  let ok=0,fail=0;
  for(const agentId of agentIds){
    try{
      const agent=(db.agents||[]).find(a=>String(a.id)===String(agentId));
      if(!agent)throw new Error("Employé introuvable");
      const f=fpqEnsure(date,agentId);
      const patch={
        employee_id:agent.backendId||sqlBackendId(agentId)||null,
        agentBackendId:agent.backendId||null,
        matricule:agent.matricule||"",
        ordreMouvementNumero,
        mouvementNumero:ordreMouvementNumero,
        positionActuelle:opsEmployeeCurrentPositionLabel(agent),
        siteId:site.id,
        siteBackendId:site.backendId||null,
        siteName:site.nom||site.intitule||"",
        societe:site.societe||agent.societe||"",
        mouvementMotif:"Affectation",
        mouvementType:"Affectation",
        mouvementDuree:"Jusqu'à nouvel ordre",
        groupe:"",
        mouvementObs:"Affectation groupée depuis la fiche site",
        siteManual:true
      };
      opsApplyLocalMovementAffectation(date,agentId,patch);
      const result=await sgdiRunLegacyAction("save-presence-movement",{data:{date,agentId,employee_id:patch.employee_id,agentBackendId:patch.agentBackendId,matricule:patch.matricule,patch}});
      const line=result?.data?.item||result?.item||{...f,...patch,date,agentId};
      const movement=result?.data?.movement||result?.movement||{...line,...patch,date,agentId};
      fpqUpsertLocalPresenceLine(line);
      opsUpsertMovementHistory(movement);
      await fpqApplyMovementAffectation(date,agentId,patch);
      await opsArchiveMovementDocument(movement);
      ok++;
    }catch(e){console.warn("Affectation refusée pour",agentId,e);fail++;}
  }
  await sgdiPullState({silent:true});
  closeModal();
  toast(`${ok} employé(s) affecté(s) et ordre de mouvement archivé`+(ok>1?"s":"")+(fail?` · ${fail} échec(s)`:""),ok?"success":"error");
  renderView();
}

async function openOpsSiteConfigModal(){
  toast("Création des sites dans Commercial : dc.irongs.com", "info");
}

function opsSiteConfigModalHTML(){
  const societes=uniqueSocieteNames([...SOCIETES,...((societeConfig().custom)||[])]);
  return `<div style="max-width:1120px">
    <div class="flex items-start justify-between gap-3 mb-1"><h3 class="font-bold text-lg">Configurer un site</h3><button type="button" class="btn btn-ghost" onclick="closeModal()">×</button></div>
    <p class="text-xs text-slate-500 mb-4">Créez le site et définissez son organisation opérationnelle — postes, ventilation par groupe et planning de rotation.</p>
    <div class="grid grid-2 mb-3">
      <div><label class="label">Société</label><select class="select" id="opsSiteSociete">${societes.map(soc=>`<option value="${escapeHTML(soc)}">${escapeHTML(soc)}</option>`).join("")}</select></div>
      <div><label class="label">Client (fiche commerciale liée)</label><select class="select" id="opsSiteClient"><option value="">— Aucun —</option>${(db.clients||[]).slice().sort((a,b)=>(a.nom||"").localeCompare(b.nom||"")).map(c=>`<option value="${escapeHTML(c.backendId||c.id||"")}">${escapeHTML(c.nom||c.raisonSociale||"Client")}</option>`).join("")}</select></div>
    </div>
    <div class="grid grid-2 mb-3">
      <div><label class="label">Nom du site</label><input class="input" id="opsSiteName" placeholder="Entrepôt Oued Smar"></div>
      <div><label class="label">Type de site</label><input class="input" id="opsSiteType" placeholder="Entrepôt, bureau, zone industrielle…"></div>
    </div>
    <div class="grid grid-3 mb-3">
      <div><label class="label">Adresse</label><input class="input" id="opsSiteAddress"></div>
      <div><label class="label">Commune</label><input class="input" id="opsSiteCommune"></div>
      <div><label class="label">Wilaya</label><select class="select" id="opsSiteWilaya"><option value="">—</option>${WILAYAS.map(w=>`<option>${w}</option>`).join("")}</select></div>
    </div>
    <div><label class="label">Effectif requis</label><input class="input bg-slate-100" id="opsSiteRequiredStaff" type="number" min="0" step="1" value="0" readonly title="Calculé automatiquement à partir des postes et fonctions"></div>
    <div class="site-config-section"><h3>Postes / fonctions</h3><p>Ajoutez chaque poste et le nombre d'employés requis.</p><div id="opsSitePositionsList"></div><button type="button" class="btn btn-secondary text-xs" style="margin-top:10px" onclick="addOpsSitePositionRow()">+ Ajouter un poste</button></div>
    <div class="site-config-section"><h3>Effectif par groupe</h3><p>Ventilez chaque poste/fonction entre les groupes. Le total de chaque groupe est calculé automatiquement.</p><div class="site-groups-grid" id="opsSiteGroupDistribution"></div><div id="opsSiteDistributionStatus" class="site-distribution-status"></div></div>
    <div class="site-config-section"><h3>Planning et rotation</h3><p>Configurez le cycle 24h/7j : trois groupes en service et un groupe en récupération, avec une relève toutes les huit heures.</p>
      <div class="rotation-config-grid">
        <label>Système<select class="select" id="opsSiteRotationSystem" onchange="renderOpsSiteRotationPreview()"><option value="3x8">24h/7j — 3×8</option></select></label>
        <label>Première prise<input class="input" id="opsSiteRotationFirstTime" type="time" value="06:00" oninput="renderOpsSiteRotationPreview()"></label>
        <label>Début du cycle<input class="input" id="opsSiteRotationStartDate" type="date" onchange="renderOpsSiteRotationPreview()"></label>
        <label>Horizon<select class="select" id="opsSiteRotationWeeks" onchange="renderOpsSiteRotationPreview()"><option value="4">4 semaines</option><option value="8">8 semaines</option><option value="12">12 semaines</option></select></label>
      </div>
      <div id="opsSiteRotationPreview" class="rotation-preview"></div>
      <div id="opsSiteRotationAlerts"></div>
    </div>
    <div id="opsSiteConfigError" class="text-sm font-bold text-red-600" style="display:none;margin-top:10px"></div>
    <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button><button type="button" class="btn btn-primary" id="opsSiteSubmitBtn" onclick="submitOpsSiteConfig()">Créer le site</button></div>
  </div>`;
}

function addOpsSitePositionRow(name="",required=0){
  const host=document.getElementById("opsSitePositionsList");if(!host)return;
  const row=document.createElement("div");row.className="site-position-row";
  row.innerHTML=`<label>Poste / fonction<input class="input site-position-name" placeholder="Ex. Agent de sécurité" value="${escapeHTML(name)}" oninput="renderOpsSiteGroupDistribution()"></label><label>Nombre requis<input class="input site-position-required" type="number" min="0" step="1" value="${Number(required)||0}" oninput="recalculateOpsSiteRequiredStaff()"></label><button type="button" class="site-position-remove" title="Supprimer ce poste" onclick="this.closest('.site-position-row').remove();recalculateOpsSiteRequiredStaff()">×</button>`;
  host.appendChild(row);
  recalculateOpsSiteRequiredStaff();
}

function recalculateOpsSiteRequiredStaff(){
  const total=[...document.querySelectorAll("#opsSitePositionsList .site-position-required")].reduce((sum,input)=>sum+(parseInt(input.value,10)||0),0);
  document.getElementById("opsSiteRequiredStaff").value=total;
  renderOpsSiteGroupDistribution();
}

function currentOpsSitePositions(){
  return [...document.querySelectorAll("#opsSitePositionsList .site-position-row")].map(row=>({name:row.querySelector(".site-position-name").value.trim(),required:parseInt(row.querySelector(".site-position-required").value,10)||0})).filter(position=>position.name);
}

function collectOpsSiteGroupPositions(){
  const result={A:{},B:{},C:{},D:{},E:{},F:{}};
  document.querySelectorAll(".ops-site-group-position-input").forEach(input=>{result[input.dataset.group][decodeURIComponent(input.dataset.position)]=parseInt(input.value,10)||0});
  return result;
}

function renderOpsSiteGroupDistribution(){
  const host=document.getElementById("opsSiteGroupDistribution");if(!host)return;
  const previous=collectOpsSiteGroupPositions();
  const positions=currentOpsSitePositions();
  const groups=["A","B","C","D","E","F"];
  host.innerHTML=groups.map(code=>{
    const rows=positions.map(position=>{const value=previous[code]?.[position.name]??opsSiteConfigGroupSeed[code]?.[position.name]??0;return`<label class="site-group-position-row"><span>${escapeHTML(position.name)}</span><input class="ops-site-group-position-input" data-group="${code}" data-position="${encodeURIComponent(position.name)}" type="number" min="0" step="1" value="${Number(value)||0}" oninput="validateOpsSiteDistribution()"></label>`}).join("");
    const total=positions.reduce((sum,position)=>sum+Number(previous[code]?.[position.name]??opsSiteConfigGroupSeed[code]?.[position.name]??0),0);
    return`<div class="site-group-distribution"><div class="site-group-distribution-head"><span>Groupe ${code}</span><span>Total : <b data-ops-group-total="${code}">${total}</b></span></div>${rows||"<div class=\"text-xs text-slate-500\">Ajoutez d'abord un poste ou une fonction.</div>"}</div>`;
  }).join("");
  validateOpsSiteDistribution();
}

function validateOpsSiteDistribution(){
  const positions=currentOpsSitePositions(),distributed=collectOpsSiteGroupPositions();
  document.querySelectorAll("[data-ops-group-total]").forEach(total=>{const code=total.dataset.opsGroupTotal;total.textContent=Object.values(distributed[code]||{}).reduce((sum,value)=>sum+Number(value||0),0)});
  const differences=positions.map(position=>{const total=["A","B","C","D","E","F"].reduce((sum,code)=>sum+Number(distributed[code]?.[position.name]||0),0);return{name:position.name,required:position.required,total,difference:position.required-total}}).filter(item=>item.difference!==0);
  const status=document.getElementById("opsSiteDistributionStatus");if(!status)return false;
  if(!positions.length){status.className="site-distribution-status";status.textContent="Ajoutez les postes/fonctions pour commencer la ventilation.";return false}
  if(differences.length){status.className="site-distribution-status error";status.textContent=differences.map(item=>`${item.name} : ${item.total} ventilé(s) sur ${item.required} requis (${item.difference>0?item.difference+" restant(s)":Math.abs(item.difference)+" en trop"})`).join(" · ");return false}
  status.className="site-distribution-status ok";status.textContent="Répartition cohérente : tous les besoins par fonction sont entièrement ventilés.";return true;
}

function opsSiteRotationConfiguration(){return{system:document.getElementById("opsSiteRotationSystem").value,first_shift_time:document.getElementById("opsSiteRotationFirstTime").value||"06:00",start_date:document.getElementById("opsSiteRotationStartDate").value||today(),horizon_weeks:parseInt(document.getElementById("opsSiteRotationWeeks").value,10)||4}}

function renderOpsSiteRotationPreview(){
  const host=document.getElementById("opsSiteRotationPreview"),alertsHost=document.getElementById("opsSiteRotationAlerts");if(!host||!alertsHost)return;
  const config=opsSiteRotationConfiguration(),start=new Date(`${config.start_date}T00:00:00`),[hour,minute]=config.first_shift_time.split(":").map(Number),base=hour*60+minute,groups=["A","B","C","D"];
  const fmt=minutes=>`${String(Math.floor((minutes%1440)/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;
  const shifts=[0,1,2].map(index=>{const begin=(base+index*480)%1440;return`${fmt(begin)}–${fmt((begin+480)%1440)}`});
  const rows=[],weekly={};
  for(let dayIndex=0;dayIndex<config.horizon_weeks*7;dayIndex++){
    const current=new Date(start);current.setDate(start.getDate()+dayIndex);const dayGroups=[];
    groups.forEach((code,groupIndex)=>{const cycle=(dayIndex+groupIndex)%4,working=cycle<3;dayGroups.push({code,working,shift:working?shifts[cycle]:"Récupération"});if(working){const monday=new Date(current);monday.setDate(current.getDate()-((current.getDay()+6)%7));const key=`${monday.toISOString().slice(0,10)}|${code}`;weekly[key]=(weekly[key]||0)+8}});
    if(dayIndex<8)rows.push({date:current,groups:dayGroups});
  }
  host.innerHTML=`<div class="rotation-day rotation-day-head"><div>Date</div>${groups.map(code=>`<div>Groupe ${code}</div>`).join("")}</div>${rows.map(row=>`<div class="rotation-day"><div><b>${row.date.toLocaleDateString("fr-FR",{weekday:"short",day:"2-digit",month:"2-digit"})}</b></div>${row.groups.map(group=>`<div class="${group.working?"rotation-work":"rotation-rest"}">${group.working?group.shift:"Récupération"}</div>`).join("")}</div>`).join("")}`;
  const overtime=Object.entries(weekly).filter(([,hours])=>hours>40);
  alertsHost.innerHTML=overtime.length?`<div class="rotation-alert">⚠ ${overtime.length} dépassement(s) prévisionnel(s) du seuil de 40 h/semaine détecté(s).</div>`:`<div class="site-distribution-status ok">Planning généré sans dépassement prévisionnel du seuil de 40 h/semaine.</div>`;
}

async function submitOpsSiteConfig(){
  toast("Création des sites dans Commercial : dc.irongs.com", "info");
}

function siteCoverageBarHTML(actual,required){
  required=Number(required)||0;actual=Number(actual)||0;
  const pct=required>0?Math.min(100,Math.round(actual/required*100)):(actual>0?100:0);
  const color=required===0?"#94a3b8":(actual>=required?"#16a34a":(actual>0?"#d97706":"#dc2626"));
  return`<div class="site-coverage"><div class="site-coverage-row"><span>Effectif affecté / besoin théorique</span><span class="site-coverage-value">${actual} / ${required||"—"}</span></div><div class="site-coverage-track"><div class="site-coverage-fill" style="width:${pct}%;background:${color}"></div></div></div>`;
}

function siteEffectifAlertHTML(eff,agents){
  if(session?.transverse==="materiel")return"";
  const manque=Math.max(0,(+eff.totalContractuel||0)-agents.length);
  if(!manque)return"";
  return`<div class="mb-4 p-3 rounded-lg border-2 border-red-500" style="background:#fef2f2;color:#991b1b">
    <div class="flex items-center justify-between gap-3">
      <div><div class="font-black text-sm">ALERTE MANQUE D'EFFECTIF</div><div class="text-xs mt-1">Effectif contractuel : <strong>${eff.totalContractuel}</strong> · Affectés : <strong>${agents.length}</strong> · Manquant : <strong>${manque}</strong></div></div>
      <span class="pill pill-red text-sm">${manque} manquant${manque>1?"s":""}</span>
    </div>
  </div>`;
}

function siteRecapBlockHTML(site,eff){
  const backend=siteBackendSituationForSite(site);
  const contractuel=siteBackendNumber(backend?.contractual_staff)||(+eff.totalContractuel||0);
  const agents=siteBackendAssignmentRows(site)||siteAgentsAffectes(site);
  const realise=agents.length;
  const manque=Math.max(0,contractuel-realise);
  const surplus=Math.max(0,realise-contractuel);
  const consignesText=String(site.consignesGenerales||site.consignes||site.consigneGenerale||"").trim();
  const consignesPreview=consignesText?(consignesText.length>90?consignesText.slice(0,90)+"…":consignesText):"Aucune consigne enregistrée.";
  const tile=(label,value,color)=>`<div class="site-recap-tile"><span>${escapeHTML(label)}</span><strong${color?` style="color:${color}"`:""}>${escapeHTML(String(value))}</strong></div>`;
  return `<div class="site-editor-wide site-recap-card">
    <div class="site-recap-head">
      <div class="site-recap-grid">
        ${tile("Date d'ouverture",formatDate(site.dateOuverture))}
        ${tile("Indicatif",site.indicatif||"—")}
        ${tile("Téléphone du site",site.telephone||"—")}
        ${tile("Effectif contrat",contractuel)}
        ${tile("Effectif réalisé",realise,realise>=contractuel&&contractuel>0?"#15803d":"")}
        ${tile("Manque",manque,manque?"#dc2626":"#15803d")}
        ${tile("Surplus",surplus,surplus?"#7c3aed":"#94a3b8")}
      </div>
      ${session?.transverse==="materiel"||isOpsSupervisorReadOnlySession()?"":`<button type="button" class="btn btn-primary" data-site-lock-keep onclick="openSiteAjouterEffectifModal('${jsString(siteEditRouteId(site))}')">Ajouter effectif</button>`}
    </div>
    <div class="site-recap-consignes">
      <span class="site-recap-consignes-label">Consignes et instructions</span>
      <p>${escapeHTML(consignesPreview)}</p>
      ${isOpsSupervisorReadOnlySession()?"":`<button type="button" class="btn btn-ghost text-xs" data-site-lock-keep onclick="openSiteConsignesModal('${jsString(siteEditRouteId(site))}')">Voir / gérer</button>`}
    </div>
  </div>`;
}

function siteRotationSummaryHTML(sys){
  const groups=["A","B","C","D"];
  const label=p=>p==="jour"?"Jour":p==="matin"?"6h-14h":p==="apres_midi"?"14h-22h":p==="nuit"?"22h-6h":"Récupération";
  if(sys==="3x8"){
    const rows=[0,1,2,3].map(day=>`<tr><td class="font-black">${day+1}${day===0?"er":"e"} jour</td>${[0,1,2,3].map(col=>`<td><span class="font-black">Groupe ${groups[(col-day+4)%4]}</span></td>`).join("")}</tr>`).join("");
    return`<div class="mt-4 overflow-x-auto"><table><thead><tr><th>Cycle</th><th>De 6h à 14h</th><th>De 14h à 22h</th><th>De 22h à 6h</th><th>Récupération</th></tr></thead><tbody>${rows}</tbody></table><div class="text-xs text-slate-500 mt-2">La rotation 3x8 suit le cycle de la capture : A/B/C/D, puis D/A/B/C, puis C/D/A/B, puis B/C/D/A.</div></div>`;
  }
  if(sys==="1/1")return`<div class="mt-4 overflow-x-auto"><table><thead><tr><th>Groupe</th><th>Règle appliquée</th><th>Exclusion</th></tr></thead><tbody>
    <tr><td class="font-black">Groupe A1</td><td><span class="pill pill-blue">Jour</span> cinq jours par semaine · 8h maximum par jour</td><td>Ne travaille pas le week-end ni les jours fériés</td></tr>
  </tbody></table><div class="text-xs text-slate-500 mt-2">La rotation 1/1 génère uniquement les jours ouvrables pour le groupe A1.</div></div>`;
  if(sys==="1/3")return`<div class="mt-4 overflow-x-auto"><table><thead><tr><th>Groupe</th><th>Règle appliquée</th><th>Couverture</th></tr></thead><tbody>
    <tr><td class="font-black">Groupe A</td><td><span class="pill pill-blue">Jour</span> 5 jours consécutifs · 8h/jour</td><td>Uniquement jours ouvrables, hors week-end et jours fériés</td></tr>
    <tr><td class="font-black">Groupe B</td><td><span class="pill pill-amber">Nuit</span> 1 nuit sur 3</td><td>Week-end et jours fériés inclus</td></tr>
    <tr><td class="font-black">Groupe C</td><td><span class="pill pill-amber">Nuit</span> 1 nuit sur 3</td><td>Décalé après le groupe B</td></tr>
    <tr><td class="font-black">Groupe D</td><td><span class="pill pill-amber">Nuit</span> 1 nuit sur 3</td><td>Décalé après le groupe C</td></tr>
  </tbody></table><div class="text-xs text-slate-500 mt-2">Le groupe A ne travaille pas le week-end ni les jours fériés. Les groupes B, C et D assurent les nuits en rotation continue.</div></div>`;
  if(sys==="1/2")return`<div class="mt-4 overflow-x-auto"><table><thead><tr><th>Groupe</th><th>Règle appliquée</th><th>Durée maximale</th></tr></thead><tbody>
    <tr><td class="font-black">Groupe A</td><td><span class="pill pill-blue">Jour</span> un jour sur deux</td><td>Maximum 12h/jour</td></tr>
    <tr><td class="font-black">Groupe B</td><td><span class="pill pill-blue">Jour</span> un jour sur deux, décalé avec A</td><td>Maximum 12h/jour</td></tr>
    <tr><td class="font-black">Groupe C</td><td><span class="pill pill-amber">Nuit</span> une nuit sur deux</td><td>Maximum 12h/nuit</td></tr>
    <tr><td class="font-black">Groupe D</td><td><span class="pill pill-amber">Nuit</span> une nuit sur deux, décalé avec C</td><td>Maximum 12h/nuit</td></tr>
  </tbody></table><div class="text-xs text-slate-500 mt-2">Les groupes A/B couvrent le jour en alternance. Les groupes C/D couvrent la nuit en alternance.</div></div>`;
  return`<div class="mt-4 overflow-x-auto"><table><thead><tr><th>Groupe</th><th>1er jour</th><th>2e jour</th><th>3e jour</th><th>4e jour</th></tr></thead><tbody>${groups.map((g,idx)=>{const rot=siteRotationForGroup(sys,idx);return`<tr><td class="font-black">Groupe ${g}</td>${[0,1,2,3].map(i=>{const r=rot[i]||{periode:"off"};const cls=r.periode==="jour"?"pill-blue":r.periode==="nuit"?"pill-amber":"pill-gray";return`<td><span class="pill ${cls}">${label(r.periode)}</span></td>`}).join("")}</tr>`}).join("")}</tbody></table><div class="text-xs text-slate-500 mt-2">Les groupes B, C et D suivent le même cycle que le groupe A, avec un décalage automatique.</div></div>`
}

function updateSiteRotationPreview(sys){
  document.querySelectorAll("[data-rotation-card]").forEach(el=>{
    const active=el.getAttribute("data-rotation-card")===sys;
    el.style.border=active?"2px solid #043970":"1px solid #e2e8f0";
    el.style.background=active?"#f1f5f9":"";
  });
  const box=document.getElementById("rotation-preview");
  if(box)box.innerHTML=siteRotationSummaryHTML(sys);
}

function siteRotationPlanningHTML(planning){
  const rows=Array.isArray(planning?.rows)?planning.rows:[];
  if(!rows.length)return `<div class="text-xs text-slate-500 mt-3" id="site-rotation-planning-preview">Aucun planning généré.</div>`;
  if(String(planning?.system||"")==="3x8"){
    const slots=[
      {key:"matin",label:"De 6h à 14h",style:"background:#dcfce7;color:#166534;border-color:#86efac"},
      {key:"apres_midi",label:"De 14h à 22h",style:"background:#e0f2fe;color:#075985;border-color:#7dd3fc"},
      {key:"nuit",label:"De 22h à 6h",style:"background:#fef3c7;color:#92400e;border-color:#fcd34d"},
      {key:"off",label:"Récupération",style:"background:#e2e8f0;color:#334155;border-color:#cbd5e1"}
    ];
    const groupFor=(r,key)=>{
      const found=["A","B","C","D"].find(g=>(r.groups?.[g]?.periode||"off")===key);
      return found||"";
    };
    return `<div id="site-rotation-planning-preview" class="mt-3 overflow-x-auto"><table><thead><tr><th>Date</th>${slots.map(s=>`<th style="${s.style};font-weight:950">${s.label}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr><td class="font-mono text-xs">${formatDate(r.date)}</td>${slots.map(s=>`<td class="text-center"><span class="font-black text-base">${escapeHTML(groupFor(r,s.key))}</span></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const pill=p=>p==="jour"?`<span class="pill pill-blue">Jour</span>`:p==="matin"?`<span class="pill" style="background:#dcfce7;color:#166534;border:1px solid #86efac">6h-14h</span>`:p==="apres_midi"?`<span class="pill" style="background:#e0f2fe;color:#075985;border:1px solid #7dd3fc">14h-22h</span>`:p==="nuit"?`<span class="pill" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d">22h-6h</span>`:`<span class="pill pill-gray">Récupération</span>`;
  return `<div id="site-rotation-planning-preview" class="mt-3 overflow-x-auto"><table><thead><tr><th>Date</th><th>Groupe A</th><th>Groupe B</th><th>Groupe C</th><th>Groupe D</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="font-mono text-xs">${formatDate(r.date)}</td>${["A","B","C","D"].map(g=>`<td>${pill(r.groups?.[g]?.periode)}<div class="text-[10px] text-slate-500">${escapeHTML(r.groups?.[g]?.regle||"")}</div></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function siteRotationPlanningSectionHTML(site){
  const p=site.rotationPlanning||{};
  const count=Array.isArray(p.rows)?p.rows.length:0;
  return `<div class="card p-4 mt-4" style="background:#f8fafc;border:1px solid #cbd5e1">
    <div class="flex items-center justify-between gap-3 flex-wrap mb-3">
      <div><h4 class="font-black text-sm uppercase">Planning de rotation automatique</h4><div class="text-xs text-slate-500">Création manuelle d'une période de rotation à partir des groupes A, B, C et D.</div></div>
      <div class="flex gap-2 flex-wrap justify-end">
        <button type="button" class="btn btn-secondary text-xs" onclick="generateSiteRotationPlanning('${site.id}')">Générer planning</button>
        <button type="button" class="btn btn-primary text-xs" onclick="openSiteRotationPlanningWindow('${site.id}')">Voir planning</button>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div><label class="label">Du</label><input class="input" type="date" name="rotationPlanningFrom" value="${escapeHTML(p.from||today())}"/></div>
      <div><label class="label">Au</label><input class="input" type="date" name="rotationPlanningTo" value="${escapeHTML(p.to||today())}"/></div>
    </div>
    <input type="hidden" name="rotationPlanningJson" value="${escapeHTML(JSON.stringify(p&&p.rows?p:{}))}"/>
    <div id="site-rotation-planning-status" class="text-xs text-slate-500 mt-3">${count?`${count} jour(s) généré(s). Clique sur Voir planning pour consulter le tableau.`:"Aucun planning généré."}</div>
  </div>`;
}

function siteRotationDraftForPlanning(siteId){
  const existing=(db.sites||[]).find(x=>String(x.id)===String(siteId)||String(x.backendId||"")===String(siteId))||{};
  const f=document.getElementById("site-form");
  const draft={...existing,id:existing.id||siteId,dateCreation:existing.dateCreation||today(),rotationSystem:f?.querySelector('[name="rotationSystem"]:checked')?.value||existing.rotationSystem||"24/48"};
  return draft;
}

function siteRotationPlanningRows(site,from,to){
  const start=new Date(String(from||"")+"T00:00:00"),end=new Date(String(to||"")+"T00:00:00");
  if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||start>end)return null;
  const rows=[];
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){
    const date=d.toISOString().slice(0,10);
    const groups={};
    ["A","B","C","D"].forEach((g,idx)=>{const rot=fpqRotationForSite(site,date,idx);groups[g]={periode:rot.periode||"off",regle:rot.regle||rot.jour||""}});
    rows.push({date,groups});
  }
  return rows;
}

function generateSiteRotationPlanning(siteId){
  const f=document.getElementById("site-form");if(!f)return;
  const from=f.querySelector('[name="rotationPlanningFrom"]')?.value||"";
  const to=f.querySelector('[name="rotationPlanningTo"]')?.value||"";
  const site=siteRotationDraftForPlanning(siteId);
  const rows=siteRotationPlanningRows(site,from,to);
  if(!rows){toast("Période de rotation invalide","error");return}
  const planning={from,to,system:site.rotationSystem,generatedAt:new Date().toISOString(),rows};
  const hidden=f.querySelector('[name="rotationPlanningJson"]');
  if(hidden)hidden.value=JSON.stringify(planning);
  const status=document.getElementById("site-rotation-planning-status");
  if(status)status.textContent=`${rows.length} jour(s) généré(s). Clique sur Voir planning pour consulter le tableau.`;
  toast(`${rows.length} jour(s) de rotation généré(s)`,"success");
  return planning;
}

function siteRotationPlanningFromForm(siteId){
  const f=document.getElementById("site-form");if(!f)return null;
  const hidden=f.querySelector('[name="rotationPlanningJson"]');
  let planning={};
  try{planning=JSON.parse(hidden?.value||"{}")}catch(e){planning={}}
  if(Array.isArray(planning.rows)&&planning.rows.length)return planning;
  return generateSiteRotationPlanning(siteId);
}

function openSiteRotationPlanningWindow(siteId){
  const planning=siteRotationPlanningFromForm(siteId);
  if(!planning||!Array.isArray(planning.rows)||!planning.rows.length)return;
  openModal(`<div style="width:min(1100px,94vw)">
    <div class="flex items-start justify-between gap-3 mb-4">
      <div>
        <h3 class="font-black text-lg">Planning de rotation automatique</h3>
        <div class="text-xs text-slate-500">${escapeHTML(planning.system||"Rotation")} · du ${formatDate(planning.from)} au ${formatDate(planning.to)} · ${planning.rows.length} jour(s)</div>
      </div>
      <button type="button" class="btn btn-ghost" onclick="closeModal()">Fermer</button>
    </div>
    ${siteRotationPlanningHTML(planning)}
    <div class="flex justify-end mt-4"><button type="button" class="btn btn-primary" onclick="closeModal()">Fermer</button></div>
  </div>`);
}

SGDIModules.registerModule({key: "sites", routes: ["sites"], dependencies: ["sites-1"], init: function(){}, destroy: sitesModuleDestroy});

const sitesModuleTimeouts=new Set();
function sitesModuleTimeout(callback,delay){
  const hash=location.hash,generation=sgdiViewRenderGeneration;
  const id=setTimeout(()=>{sitesModuleTimeouts.delete(id);if(hash===location.hash&&generation===sgdiViewRenderGeneration&&SGDIModules.isModuleInitialized("sites"))callback()},delay);
  sitesModuleTimeouts.add(id);return id;
}
function sitesModuleDestroy(){
  sitesModuleTimeouts.forEach(clearTimeout);sitesModuleTimeouts.clear();
  document.removeEventListener("click",closeSuperviseurDemandeMenu);closeSuperviseurDemandeMenu();
  for(const key of ["__sgdiSitesDashboardMap","__sgdiInlineSitePositionMap","__sgdiSitePositionMap"]){try{window[key]?.remove()}catch(e){console.warn("Nettoyage carte Sites",e)}finally{window[key]=null}}
  window.__sgdiSitesDashboardMarkers=[];window.__sgdiInlineSitePositionMarker=null;window.__sgdiSitePositionMarker=null;
}
