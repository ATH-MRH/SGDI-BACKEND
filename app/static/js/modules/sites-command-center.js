/* OPS → Sites : Command Center opérationnel (présentation uniquement).
 * Ce fichier ne porte AUCUNE règle métier : il réutilise les sites, la situation serveur, les
 * affectations, les mouvements, les incidents et la carte MapLibre/OpenStreetMap déjà fournis par
 * sites.js / sgdi-app.js. Il n'est actif que dans le contexte OPS (session.transverse === "ops") ;
 * Superviseur, Matériel, Administration et Commercial gardent leur rendu. Aucune donnée inventée :
 * un indicateur sans source réelle n'est pas affiché. La création d'un site reste réservée au
 * Commercial (API 403) : aucun bouton « Nouveau site » n'est donc proposé ici. */
const OPS_SITES_CC_STATUS={
  operationnel:{label:"Opérationnel",tone:"ok"},
  alerte:{label:"Alerte effectif",tone:"danger"},
  attente:{label:"Non opérationnel",tone:"warn"},
  inactif:{label:"Inactif",tone:"muted"}
};
const OPS_SITES_CC_VIEWS=[["carte","Carte"],["liste","Liste"],["analytique","Analytique"]];
const OPS_SITES_CC_QUICK={
  all:"Tous les sites",actifs:"Sites actifs",alerte:"Sites en alerte",surplus:"Sites avec effectif surplus",
  instance:"Sites en instance d'affectation",operationnel:"Sites opérationnels",contractuel:"Sites avec effectif contractuel",
  realise:"Sites avec effectif réalisé",incidents:"Sites avec incident ouvert"
};

function opsSitesCcEnabled(){return session?.transverse==="ops"}
function opsSitesCcState(){
  if(!window.__opsSitesCcState)window.__opsSitesCcState={view:"carte",layout:"grille",q:"",status:"",wilaya:"",client:"",quick:"all"};
  return window.__opsSitesCcState;
}
function opsSitesCcPlural(n,one,many){return `${n} ${n>1?many:one}`}
function opsSitesCcStaffingChipHTML(row){
  if(row.inactive)return `<span class="ops-sites-cc-chip is-muted">Site inactif</span>`;
  if(row.missing>0)return `<span class="ops-sites-cc-chip is-danger" data-cc-missing="${row.missing}" title="Effectif contractuel ${row.contractual} · affectés ${row.realized}">⚠ ${opsSitesCcPlural(row.missing,"manquant","manquants")}</span>`;
  if(row.surplus>0)return `<span class="ops-sites-cc-chip is-warn" data-cc-surplus="${row.surplus}" title="Effectif contractuel ${row.contractual} · affectés ${row.realized}">+${row.surplus} surplus</span>`;
  if(row.contractual>0)return `<span class="ops-sites-cc-chip is-ok">Conforme</span>`;
  return `<span class="ops-sites-cc-chip is-muted">Non défini</span>`;
}

// Modèle d'affichage : uniquement des valeurs lues dans les sources existantes.
function opsSitesCcModel(sites,situationBySite){
  const soc=sitesPageSocieteFilter();
  const openIncidents=(db.incidents||[]).filter(i=>i&&i.statut!=="clos"&&incidentMatchesSociete(i,soc));
  const movements=typeof opsMovementRows==="function"?opsMovementRows():[];
  const now=today();
  const rows=(sites||[]).filter(Boolean).map(site=>{
    const metric=siteBackendMetricForSite(site,situationBySite);
    const eff=siteEffectifsNorm(site);
    const inactive=site.actif===false||site.active===0||site.statut==="inactif";
    const status=inactive?"inactif":metric.missing>0?"alerte":metric.operational?"operationnel":"attente";
    const opening=siteOpeningDateValue(site);
    return {
      site,ref:siteEditRouteId(site),key:String(site.id||site.backendId||""),status,inactive,
      contractual:metric.contractual,realized:metric.realized,missing:metric.missing,surplus:metric.surplus,operational:metric.operational,
      day:eff.jour,night:eff.nuit,pos:siteLatLng(site),
      incidents:openIncidents.filter(i=>siteMatchesReference(site,i)).length,
      movements:movements.filter(f=>siteMatchesReference(site,f)),
      opening,upcomingOpening:!inactive&&!!opening&&opening>now
    };
  });
  const active=rows.filter(r=>!r.inactive);
  const sum=(list,key)=>list.reduce((total,row)=>total+(Number(row[key])||0),0);
  const contractual=sum(active,"contractual"),realized=sum(active,"realized");
  const covered=active.reduce((total,row)=>total+Math.min(row.realized,row.contractual),0);
  const serverMissions=typeof sgdiErpModuleCounters==="function"?sgdiErpModuleCounters("ops",soc)?.missions_current:undefined;
  const byStatus=Object.keys(OPS_SITES_CC_STATUS).map(key=>({key,...OPS_SITES_CC_STATUS[key],count:rows.filter(r=>r.status===key).length})).filter(s=>s.count>0);
  const distinct=getter=>[...new Set(rows.map(getter).map(v=>String(v||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"fr"));
  const seen=new Set();
  const activity=rows.flatMap(row=>row.movements.map(f=>({row,f}))).filter(({f})=>{const k=String(f.id||"")+"|"+String(f.date||"")+"|"+String(f.agentId||f.matricule||"");if(seen.has(k))return false;seen.add(k);return true})
    .sort((a,b)=>String(b.f.date||"").localeCompare(String(a.f.date||""))).slice(0,6);
  return {
    soc,rows,active,byStatus,activity,
    wilayas:distinct(r=>r.site.wilaya),communes:distinct(r=>r.site.commune),clients:distinct(r=>r.site.client),
    deadlines:rows.filter(r=>r.upcomingOpening).sort((a,b)=>a.opening.localeCompare(b.opening)),
    totals:{
      sites:rows.length,active:active.length,alert:rows.filter(r=>r.status==="alerte").length,
      contractual,realized,missing:sum(active,"missing"),surplus:sum(active,"surplus"),
      instance:active.filter(r=>r.realized===0).length,operational:active.filter(r=>r.operational).length,
      incidents:openIncidents.length,
      missions:serverMissions===undefined||serverMissions===null?null:counterNumericValue(serverMissions),
      coverage:contractual>0?Math.round(covered*100/contractual):null,
      positioned:rows.filter(r=>r.pos).length
    }
  };
}

function opsSitesCcKpiHTML(label,value,tone,quick,title){
  const inner=`<span class="ops-sites-cc-kpi-top"><i aria-hidden="true"></i><strong>${escapeHTML(String(value))}</strong></span><span class="ops-sites-cc-kpi-label">${escapeHTML(label)}</span>`;
  return quick
    ?`<button type="button" class="ops-sites-cc-kpi" data-tone="${tone}" data-cc-quick="${quick}" data-cc-kpi="${escapeHTML(label)}" title="${escapeHTML(title||label)}" onclick="opsSitesCcQuick('${quick}')">${inner}</button>`
    :`<div class="ops-sites-cc-kpi" data-tone="${tone}" data-cc-kpi="${escapeHTML(label)}" title="${escapeHTML(title||label)}">${inner}</div>`;
}
function opsSitesCcKpisHTML(model){
  const t=model.totals;
  return `<div class="ops-sites-cc-kpis" role="group" aria-label="Indicateurs des sites">
    ${opsSitesCcKpiHTML("Sites total",t.sites,"info","all","Tous les sites du périmètre")}
    ${opsSitesCcKpiHTML("Sites actifs",t.active,"ok","actifs","Sites non archivés")}
    ${opsSitesCcKpiHTML("Sites en alerte",t.alert,t.alert>0?"danger":"ok","alerte","Sites actifs avec manque d'effectif")}
    ${opsSitesCcKpiHTML("Agents affectés",t.realized,"info","realise","Effectif réalisé sur les sites actifs")}
    ${t.missions===null?"":opsSitesCcKpiHTML("Missions en cours",t.missions,"violet","","Compteur serveur OPS")}
    ${opsSitesCcKpiHTML("Incidents ouverts",t.incidents,t.incidents>0?"warn":"ok","incidents","Main courante : incidents non clos")}
    ${t.coverage===null?"":opsSitesCcKpiHTML("Couverture",t.coverage+"%",t.coverage>=100?"ok":"warn","contractuel","Effectif affecté / effectif contractuel")}
  </div>`;
}

function opsSitesCcScopeHTML(model){
  const selected=model.soc;
  const locked=!!session?.societe;
  const socs=locked?[]:currentAllowedSocietes();
  return `<div class="ops-sites-cc-scope">
    <span class="ops-sites-cc-scope-label">${locked?"Périmètre verrouillé":"Périmètre sites"}</span>
    <strong>${escapeHTML(selected||"Toutes les sociétés autorisées")}</strong>
    <span class="ops-sites-cc-scope-count">${model.totals.active} site(s) actif(s) affiché(s)</span>
    ${locked?"":`<label class="ops-sites-cc-field"><span>Société</span><select id="sites-society-select" class="ops-sites-cc-input" onchange="setSitesSocieteFilter(this.value)">
      <option value="" ${!selected?"selected":""}>Toutes les sociétés autorisées</option>
      ${socs.map(s=>`<option value="${escapeHTML(s)}" ${normalizeSocieteName(selected)===normalizeSocieteName(s)?"selected":""}>${escapeHTML(s)}</option>`).join("")}
    </select></label>`}
  </div>`;
}

function opsSitesCcMapPanelHTML(model){
  const t=model.totals;
  const activeRows=model.active;
  const missing=activeRows.filter(r=>!r.pos);
  const places=model.wilayas.length;
  const options=`<option value="__all__">Tous les sites positionnés</option>`+activeRows.map(r=>`<option value="${escapeHTML(r.key)}">${escapeHTML((r.site.nom||"Site")+" · "+[r.site.commune,r.site.wilaya].filter(Boolean).join(", ")+(r.pos?"":" · GPS manquant"))}</option>`).join("");
  const initial=activeRows.find(r=>r.pos)||activeRows[0];
  const readOnly=isOpsSupervisorReadOnlySession();
  return `<section class="ops-sites-cc-panel ops-sites-cc-map-panel" aria-label="Carte des sites">
    <div class="ops-sites-cc-panel-head">
      <div><h2>Carte des sites</h2><div id="sites-map-label" class="ops-sites-cc-muted">Tous les sites</div></div>
      <div class="ops-sites-cc-map-tools">
        <select id="sites-map-select" class="ops-sites-cc-input" aria-label="Centrer la carte sur un site" onchange="updateSitesMap(this.value)">${options}</select>
        <a id="sites-map-open" class="ops-sites-cc-btn" href="${escapeHTML(googleMapsSearchUrl(initial?siteMapQuery(initial.site):"Algérie"))}" target="_blank" rel="noopener">Google Maps ↗</a>
      </div>
    </div>
    <div class="ops-sites-cc-map-wrap">
      ${t.positioned?`<div id="sites-map-frame" class="sgdi-maplibre-map ops-sites-cc-map" role="region" aria-label="Carte interactive des sites"></div>`:`<div class="ops-sites-cc-empty ops-sites-cc-map-empty">Aucun site n'a encore de position GPS. Ouvrez une fiche site puis utilisez <b>Positionner site</b>.</div>`}
      <div class="ops-sites-cc-coverage" aria-label="Couverture">
        <span class="ops-sites-cc-eyebrow">Couverture</span>
        <dl>
          <div><dt>Sites</dt><dd>${t.sites}</dd></div>
          ${places?`<div><dt>Wilayas</dt><dd>${places}</dd></div>`:""}
          <div><dt>Agents affectés</dt><dd>${t.realized}</dd></div>
          ${t.missions===null?"":`<div><dt>Missions en cours</dt><dd>${t.missions}</dd></div>`}
          <div><dt>Positionnés GPS</dt><dd>${t.positioned}/${t.sites}</dd></div>
        </dl>
      </div>
      ${model.byStatus.length?`<ul class="ops-sites-cc-legend" aria-label="Légende des statuts">${model.byStatus.map(s=>`<li data-tone="${s.tone}"><i aria-hidden="true"></i>${escapeHTML(s.label)} <b>${s.count}</b></li>`).join("")}</ul>`:""}
    </div>
    <div class="ops-sites-cc-gps">
      <span class="is-ok">${activeRows.length-missing.length} site(s) positionné(s)</span>
      <span class="${missing.length?"is-warn":"is-muted"}">${missing.length} sans position GPS</span>
      ${readOnly?"":missing.slice(0,6).map(r=>`<button type="button" class="ops-sites-cc-link" onclick="navigate('sites/${r.ref}')" title="Ajouter une position GPS">${escapeHTML(r.site.nom||r.site.indicatif||"Site")}</button>`).join("")}
      ${!readOnly&&missing.length>6?`<span class="is-muted">+ ${missing.length-6} autre(s)</span>`:""}
    </div>
  </section>`;
}

function opsSitesCcDonutHTML(model){
  const total=model.rows.length;
  if(!total)return `<div class="ops-sites-cc-empty">Aucun site dans ce périmètre.</div>`;
  let offset=25;
  const arcs=model.byStatus.map(s=>{
    const share=s.count*100/total;
    const arc=`<circle class="ops-sites-cc-donut-arc" data-tone="${s.tone}" cx="21" cy="21" r="15.915" pathLength="100" stroke-dasharray="${share.toFixed(3)} ${(100-share).toFixed(3)}" stroke-dashoffset="${offset.toFixed(3)}"></circle>`;
    offset-=share;
    return arc;
  }).join("");
  return `<div class="ops-sites-cc-donut">
    <svg viewBox="0 0 42 42" role="img" aria-label="Répartition des ${total} sites par statut"><circle class="ops-sites-cc-donut-track" cx="21" cy="21" r="15.915"></circle>${arcs}<text x="21" y="20.5" text-anchor="middle">${total}</text><text class="is-sub" x="21" y="26" text-anchor="middle">sites</text></svg>
    <ul>${model.byStatus.map(s=>`<li data-tone="${s.tone}"><i aria-hidden="true"></i><span>${escapeHTML(s.label)}</span><b>${s.count}</b><em>${Math.round(s.count*100/total)}%</em></li>`).join("")}</ul>
  </div>`;
}
function opsSitesCcWilayaBarsHTML(model){
  const counts=model.wilayas.map(w=>({w,count:model.rows.filter(r=>String(r.site.wilaya||"").trim()===w).length})).sort((a,b)=>b.count-a.count||a.w.localeCompare(b.w,"fr")).slice(0,6);
  if(!counts.length)return "";
  const max=Math.max(...counts.map(c=>c.count));
  return `<div class="ops-sites-cc-bars" aria-label="Sites par wilaya">${counts.map(c=>`<div class="ops-sites-cc-bar"><span>${escapeHTML(c.w)}</span><div><i style="width:${Math.round(c.count*100/max)}%"></i></div><b>${c.count}</b></div>`).join("")}</div>`;
}
function opsSitesCcActivityHTML(model){
  if(!model.activity.length)return `<div class="ops-sites-cc-empty">Aucun mouvement enregistré pour ces sites.</div>`;
  return `<ol class="ops-sites-cc-activity">${model.activity.map(({row,f})=>`<li>
    <time>${escapeHTML(formatDate(f.date)||"—")}</time>
    <div><strong>${escapeHTML(f.mouvementMotif||f.mouvementType||"Mouvement")}</strong><span>${escapeHTML(opsMovementAgentLabel(f._agent))}</span><small>${escapeHTML(row.site.nom||"Site")}</small></div>
  </li>`).join("")}</ol>`;
}
function opsSitesCcSynthHTML(model){
  const t=model.totals;
  const tile=(label,value,quick,tone)=>`<button type="button" class="ops-sites-cc-synth-tile" data-tone="${tone}" data-cc-quick="${quick}" onclick="opsSitesCcQuick('${quick}')" title="${escapeHTML(OPS_SITES_CC_QUICK[quick])}"><span>${escapeHTML(label)}</span><strong>${value}</strong></button>`;
  return `<div class="ops-sites-cc-synth">
    ${tile("En instance d'affectation",t.instance,"instance",t.instance>0?"warn":"ok")}
    ${tile("Sites opérationnels",t.operational,"operationnel","ok")}
    ${tile("Effectif contrat",t.contractual,"contractuel","info")}
    ${tile("Effectif réalisé",t.realized,"realise","info")}
    ${tile("Manque d'effectif",t.missing,"alerte",t.missing>0?"danger":"ok")}
    ${tile("Effectif surplus",t.surplus,"surplus",t.surplus>0?"warn":"muted")}
  </div>`;
}
function opsSitesCcSideHTML(model){
  return `<aside class="ops-sites-cc-side" aria-label="Analyse des sites">
    <section class="ops-sites-cc-panel" data-cc-panel="repartition"><div class="ops-sites-cc-panel-head"><h2>Répartition des sites</h2><span class="ops-sites-cc-muted">Par statut réel</span></div>${opsSitesCcDonutHTML(model)}${opsSitesCcWilayaBarsHTML(model)}</section>
    <section class="ops-sites-cc-panel" data-cc-panel="synthese"><div class="ops-sites-cc-panel-head"><h2>Synthèse des effectifs</h2><span class="ops-sites-cc-muted">Sites actifs</span></div>${opsSitesCcSynthHTML(model)}</section>
  </aside>`;
}
function opsSitesCcFeedHTML(model){
  return `<div class="ops-sites-cc-feed">
    <section class="ops-sites-cc-panel" data-cc-panel="activite"><div class="ops-sites-cc-panel-head"><h2>Activité récente</h2><span class="ops-sites-cc-muted">Mouvements d'effectif</span></div>${opsSitesCcActivityHTML(model)}</section>
    ${model.deadlines.length?`<section class="ops-sites-cc-panel" data-cc-panel="echeances"><div class="ops-sites-cc-panel-head"><h2>Prochaines échéances</h2><span class="ops-sites-cc-muted">Ouvertures prévues</span></div><ol class="ops-sites-cc-activity">${model.deadlines.slice(0,6).map(r=>`<li><time>${escapeHTML(formatDate(r.opening))}</time><div><strong>Ouverture du site</strong><span>${escapeHTML(r.site.nom||"Site")}</span></div></li>`).join("")}</ol></section>`:""}
  </div>`;
}

function opsSitesCcCardHTML(row,readOnly){
  const s=row.site,status=OPS_SITES_CC_STATUS[row.status];
  const address=[s.adresse,[s.commune,s.wilaya].filter(Boolean).join(", ")].map(v=>String(v||"").trim()).filter(Boolean).join(" · ");
  const contact=[s.contact?.nom,s.contact?.telephone].map(v=>String(v||"").trim()).filter(Boolean).join(" · ");
  const search=normalizedSearchText([s.nom,s.indicatif,s.adresse,s.commune,s.wilaya,s.client,s.contact?.nom,s.type].filter(Boolean).join(" "));
  const detailId="ops-sites-cc-detail-"+row.ref;
  const lampOk=row.contractual>0&&row.realized===row.contractual;
  const cell=(label,value,cls)=>`<div class="${cls||""}"><span>${label}</span><b>${value}</b></div>`;
  return `<article class="site-card ops-sites-cc-card" data-cc-site="${escapeHTML(row.key)}" data-cc-status="${row.status}" data-tone="${status.tone}" data-cc-wilaya="${escapeHTML(String(s.wilaya||"").trim())}" data-cc-client="${escapeHTML(String(s.client||"").trim())}" data-cc-search="${escapeHTML(search)}" data-cc-incidents="${row.incidents}"
    data-site-status="${row.operational?"operationnel":"non-operationnel"}" data-site-manque="${row.missing}" data-site-surplus="${row.surplus}" data-site-instance="${row.realized===0?1:0}" data-site-contractuel="${row.contractual}" data-site-realise="${row.realized}" data-searchable>
    <div class="ops-sites-cc-card-top">
      <span class="ops-sites-cc-thumb" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20V8l6-3v15M10 20V10l10 3v7M3 20h18M7 10v1M7 14v1M14 15v1M17 16v1"/></svg></span>
      <div class="ops-sites-cc-card-id">
        <span class="ops-sites-cc-status" data-tone="${status.tone}" title="${lampOk?"Effectif conforme":row.surplus>0?"Surplus +"+row.surplus:row.missing>0?"Manque −"+row.missing:"Effectif non défini"}"><i aria-hidden="true"></i>${escapeHTML(status.label)}</span>
        <h3>${escapeHTML(s.nom||"-")}</h3>
        ${s.indicatif?`<span class="ops-sites-cc-code">${escapeHTML(s.indicatif)}</span>`:""}
      </div>
    </div>
    <dl class="ops-sites-cc-card-info">
      <div><dt>Adresse</dt><dd>${safe(address)}</dd></div>
      <div><dt>Client</dt><dd>${safe(s.client)}</dd></div>
      <div><dt>Contact</dt><dd>${safe(contact)}</dd></div>
    </dl>
    <div class="ops-sites-cc-card-metrics">
      <button type="button" class="ops-sites-cc-metric" onclick="event.stopPropagation();openSiteAffectesModal('${jsString(row.ref)}')" title="Voir les agents affectés"><span>Agents</span><b>${row.realized}</b></button>
      <div class="ops-sites-cc-metric" title="Jour ${row.day||0} · Nuit ${row.night||0}"><span>Contractuel</span><b>${row.contractual||0}</b></div>
      <div class="ops-sites-cc-metric ops-sites-cc-metric-alert"><span>${row.incidents>0?"Incident / alerte":"Alerte"}</span>${opsSitesCcStaffingChipHTML(row)}${row.incidents>0?`<span class="ops-sites-cc-chip is-warn" title="Incidents non clos sur ce site">${opsSitesCcPlural(row.incidents,"incident","incidents")}</span>`:""}</div>
    </div>
    <div id="${escapeHTML(detailId)}" class="ops-sites-cc-card-detail" hidden>
      <div class="ops-sites-cc-detail-grid">
        ${cell("Contractuel",row.contractual||0)}${cell("Jour",row.day||0)}${cell("Nuit",row.night||0)}${cell("Affecté",row.realized)}
        ${cell("Surplus",row.surplus>0?"+"+row.surplus:0,row.surplus>0?"is-warn":"")}${cell("Manque",row.missing>0?"−"+row.missing:0,row.missing>0?"is-danger":"")}
      </div>
      <div class="ops-sites-cc-detail-line"><span>Type</span><b>${safe(s.type)}</b></div>
      ${row.opening?`<div class="ops-sites-cc-detail-line"><span>Date d'ouverture</span><b>${escapeHTML(formatDate(row.opening))}</b></div>`:""}
      ${row.pos?`<div class="ops-sites-cc-detail-line"><span>Coordonnées</span><b>${escapeHTML(sitePositionLabel(row.pos.lat,row.pos.lng))}</b></div>`:`<div class="ops-sites-cc-detail-line"><span>Coordonnées</span><b>GPS manquant</b></div>`}
      <button type="button" class="ops-sites-cc-btn" onclick="event.stopPropagation();openSiteMovementHistoryModal('${jsString(String(s.id||s.backendId||s.indicatif||""))}')">Historique des mouvements <b>${row.movements.length}</b></button>
      ${readOnly?"":siteAdminSystemActionsHTML(s)}
    </div>
    <div class="ops-sites-cc-card-foot">
      <button type="button" class="ops-sites-cc-link" aria-expanded="false" aria-controls="${escapeHTML(detailId)}" onclick="event.stopPropagation();opsSitesCcToggleDetail(this)">Effectifs détaillés</button>
      ${row.pos?`<button type="button" class="ops-sites-cc-link" onclick="event.stopPropagation();opsSitesCcLocate('${jsString(row.key)}')">Localiser</button>`:""}
      <a class="ops-sites-cc-more" href="#/sites/${row.ref}">Voir le détail →</a>
    </div>
  </article>`;
}

function opsSitesCcAnalyticsTableHTML(model){
  if(!model.rows.length)return "";
  return `<section class="ops-sites-cc-panel ops-sites-cc-analytics" aria-label="Effectifs par site">
    <div class="ops-sites-cc-panel-head"><h2>Effectifs par site</h2><span class="ops-sites-cc-muted">${model.rows.length} site(s)</span></div>
    <div class="ops-sites-cc-table-scroll"><table class="ops-sites-cc-table"><thead><tr><th>Site</th><th>Statut</th><th>Contrat</th><th>Jour</th><th>Nuit</th><th>Affecté</th><th>Manque</th><th>Surplus</th><th>Couverture</th></tr></thead>
    <tbody>${model.rows.map(r=>`<tr><td><a href="#/sites/${r.ref}">${escapeHTML(r.site.nom||"Site")}</a></td><td><span class="ops-sites-cc-status" data-tone="${OPS_SITES_CC_STATUS[r.status].tone}"><i aria-hidden="true"></i>${escapeHTML(OPS_SITES_CC_STATUS[r.status].label)}</span></td><td>${r.contractual||0}</td><td>${r.day||0}</td><td>${r.night||0}</td><td>${r.realized}</td><td class="${r.missing>0?"is-danger":""}">${r.missing}</td><td class="${r.surplus>0?"is-warn":""}">${r.surplus}</td><td>${r.contractual>0?Math.min(100,Math.round(r.realized*100/r.contractual))+"%":"—"}</td></tr>`).join("")}</tbody></table></div>
  </section>`;
}

function opsSitesCcListHTML(model,pagination){
  const state=opsSitesCcState();
  const readOnly=isOpsSupervisorReadOnlySession();
  const select=(id,label,all,values,current,labels)=>values.length?`<label class="ops-sites-cc-field"><span>${label}</span><select id="${id}" class="ops-sites-cc-input" onchange="opsSitesCcFilter()"><option value="">${all}</option>${values.map(v=>`<option value="${escapeHTML(v)}" ${v===current?"selected":""}>${escapeHTML(labels?labels[v]:v)}</option>`).join("")}</select></label>`:"";
  const statusLabels=Object.fromEntries(model.byStatus.map(s=>[s.key,s.label]));
  return `<section class="ops-sites-cc-panel ops-sites-cc-list" aria-label="Liste des sites">
    <div class="ops-sites-cc-panel-head">
      <div><h2 id="ops-sites-cc-count" data-cc-count="${model.rows.length}">Liste des sites (${model.rows.length})</h2><div class="ops-sites-cc-muted">Suivi en temps réel de l'état de vos sites</div></div>
      <div class="ops-sites-cc-layout" role="group" aria-label="Affichage de la liste">
        <button type="button" data-cc-layout-btn="grille" aria-pressed="${state.layout==="grille"}" onclick="opsSitesCcSetLayout('grille')">Grille</button>
        <button type="button" data-cc-layout-btn="liste" aria-pressed="${state.layout==="liste"}" onclick="opsSitesCcSetLayout('liste')">Liste</button>
      </div>
    </div>
    ${model.rows.length?`<div class="ops-sites-cc-filters">
      <label class="ops-sites-cc-field ops-sites-cc-field-search"><span>Recherche site</span><input id="ops-sites-cc-search" type="search" class="ops-sites-cc-input" placeholder="Nom, indicatif, adresse, client…" value="${escapeHTML(state.q)}" oninput="opsSitesCcFilter()"/></label>
      ${select("ops-sites-cc-status","Statut","Tous les statuts",model.byStatus.map(s=>s.key),state.status,statusLabels)}
      ${select("ops-sites-cc-wilaya","Ville / Wilaya","Toutes les wilayas",model.wilayas,state.wilaya)}
      ${select("ops-sites-cc-client","Client","Tous les clients",model.clients,state.client)}
      <button type="button" class="ops-sites-cc-btn" onclick="opsSitesCcReset()">Réinitialiser</button>
    </div>
    <div id="sites-filter-info" class="ops-sites-cc-filter-info" hidden></div>
    <div class="ops-sites-cc-grid">${model.rows.map(row=>opsSitesCcCardHTML(row,readOnly)).join("")}</div>
    <div id="ops-sites-cc-no-match" class="ops-sites-cc-empty" hidden>Aucun site ne correspond à ces filtres.</div>`
    :`<div class="ops-sites-cc-empty" data-cc-empty="1">Aucun site dans ce périmètre.</div>`}
    ${pagination?`<div class="ops-sites-cc-pagination">${pagination}</div>`:""}
  </section>`;
}

function opsSitesCcHeadHTML(){
  const state=opsSitesCcState();
  return `<header class="ops-sites-cc-head">
    <div>
      <nav class="ops-sites-cc-crumb" aria-label="Fil d'Ariane"><a href="#/ops/dashboard">OPS</a><span aria-hidden="true">›</span><span aria-current="page">Sites</span></nav>
      <h1 data-keep-case="1">Sites - Tableau de bord</h1>
      <p>Vue d'ensemble de tous vos sites en temps réel</p>
    </div>
    <div class="ops-sites-cc-tabs" role="group" aria-label="Vue">
      ${OPS_SITES_CC_VIEWS.map(([key,label])=>`<button type="button" data-cc-view-btn="${key}" aria-pressed="${state.view===key}" onclick="opsSitesCcSetView('${key}')">${label}</button>`).join("")}
    </div>
  </header>`;
}

function opsSitesCcLoadingHTML(){
  return `<section class="ops-sites-cc is-loading" data-testid="ops-sites-command-center" data-preserve-emoji="1" data-cc-view="carte">${opsSitesCcHeadHTML()}<div class="ops-sites-cc-empty" role="status">Chargement des chiffres depuis le serveur…</div></section>`;
}

// Rendu principal. `options.situationBySite` : situation serveur (ou Map vide pour le repli local).
function renderOpsSitesCommandCenter(view,sites,options){
  options=options||{};
  const model=opsSitesCcModel(sites,options.situationBySite);
  const state=opsSitesCcState();
  const signature=JSON.stringify([model.soc,options.pagination||"",model.totals,model.rows.map(r=>[r.key,r.status,r.contractual,r.realized,r.missing,r.surplus,r.day,r.night,r.incidents,r.movements.length,r.pos,r.opening,r.site.nom,r.site.indicatif,r.site.adresse,r.site.commune,r.site.wilaya,r.site.client,r.site.contact?.nom,r.site.contact?.telephone,r.site.type]),model.activity.map(a=>[a.f.id,a.f.date])]);
  // Synchronisation de fond sans changement : conserver le DOM (carte, filtres, saisie en cours).
  if(view.querySelector(".ops-sites-cc[data-cc-ready]")&&window.__opsSitesCcSignature===signature)return;
  window.__opsSitesCcSignature=signature;
  window.__opsSitesCcModel=model;
  window.__sgdiSitesDashboardData=model.active.map(r=>r.site);
  view.innerHTML=`<section class="ops-sites-cc" data-testid="ops-sites-command-center" data-preserve-emoji="1" data-cc-ready="1" data-cc-view="${state.view}" data-cc-layout="${state.layout}">
    ${opsSitesCcHeadHTML()}
    ${opsSupervisorReadOnlyNoticeHTML()}
    ${opsSitesCcScopeHTML(model)}
    ${opsSitesCcKpisHTML(model)}
    <div class="ops-sites-cc-main">
      ${sgdiOverlayIsOpen()?"":opsSitesCcMapPanelHTML(model)}
      ${opsSitesCcSideHTML(model)}
    </div>
    ${opsSitesCcFeedHTML(model)}
    ${opsSitesCcAnalyticsTableHTML(model)}
    ${opsSitesCcListHTML(model,options.pagination)}
  </section>`;
  opsSitesCcApplyFilters();
  sitesModuleTimeout(()=>{if(view.querySelector(".ops-sites-cc"))initSitesDashboardMap()},0);
}

function opsSitesCcRoot(){return document.querySelector("#view .ops-sites-cc")||document.querySelector(".ops-sites-cc")}
function opsSitesCcSetView(viewName){
  if(!OPS_SITES_CC_VIEWS.some(([key])=>key===viewName))return;
  const root=opsSitesCcRoot(),state=opsSitesCcState();
  state.view=viewName;
  if(viewName==="liste")state.layout="liste";
  if(!root)return;
  root.dataset.ccView=viewName;
  root.querySelectorAll("[data-cc-view-btn]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.ccViewBtn===viewName)));
  opsSitesCcSetLayout(state.layout);
  if(viewName==="carte"){
    initSitesDashboardMap();
    [0,120,350].forEach(ms=>sitesModuleTimeout(()=>{try{window.__sgdiSitesDashboardMap?.resize()}catch(_e){}},ms));
  }
}
function opsSitesCcSetLayout(layout){
  if(!["grille","liste"].includes(layout))return;
  const root=opsSitesCcRoot();
  opsSitesCcState().layout=layout;
  if(!root)return;
  root.dataset.ccLayout=layout;
  root.querySelectorAll("[data-cc-layout-btn]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.ccLayoutBtn===layout)));
}
function opsSitesCcToggleDetail(button){
  const panel=document.getElementById(button.getAttribute("aria-controls"));
  if(!panel)return;
  const open=panel.hidden;
  panel.hidden=!open;
  button.setAttribute("aria-expanded",String(open));
}
function opsSitesCcQuickMatch(card,quick){
  const d=card.dataset;
  switch(quick){
    case"actifs":return d.ccStatus!=="inactif";
    case"alerte":return d.ccStatus==="alerte";
    case"surplus":return d.ccStatus!=="inactif"&&(+d.siteSurplus||0)>0;
    case"instance":return d.ccStatus!=="inactif"&&(+d.siteInstance||0)>0;
    case"operationnel":return d.siteStatus==="operationnel";
    case"contractuel":return (+d.siteContractuel||0)>0;
    case"realise":return (+d.siteRealise||0)>0;
    case"incidents":return (+d.ccIncidents||0)>0;
    default:return true;
  }
}
function opsSitesCcFilter(){
  const root=opsSitesCcRoot(),state=opsSitesCcState();
  if(!root)return;
  const value=id=>root.querySelector("#"+id)?.value||"";
  state.q=value("ops-sites-cc-search").trim();
  state.status=value("ops-sites-cc-status");
  state.wilaya=value("ops-sites-cc-wilaya");
  state.client=value("ops-sites-cc-client");
  opsSitesCcApplyFilters();
}
function opsSitesCcQuick(mode){
  const state=opsSitesCcState();
  state.quick=OPS_SITES_CC_QUICK[mode]?mode:"all";
  if(state.view==="analytique")opsSitesCcSetView("carte");
  opsSitesCcApplyFilters();
  opsSitesCcRoot()?.querySelector(".ops-sites-cc-list")?.scrollIntoView?.({behavior:"smooth",block:"nearest"});
}
function opsSitesCcReset(){
  const root=opsSitesCcRoot();
  Object.assign(opsSitesCcState(),{q:"",status:"",wilaya:"",client:"",quick:"all"});
  if(root)["ops-sites-cc-search","ops-sites-cc-status","ops-sites-cc-wilaya","ops-sites-cc-client"].forEach(id=>{const el=root.querySelector("#"+id);if(el)el.value=""});
  opsSitesCcApplyFilters();
}
function opsSitesCcApplyFilters(){
  const root=opsSitesCcRoot(),state=opsSitesCcState();
  if(!root)return;
  // Un filtre mémorisé qui n'existe plus dans les données réelles est abandonné.
  ["status","wilaya","client"].forEach(key=>{const el=root.querySelector("#ops-sites-cc-"+key);if(state[key]&&(!el||![...el.options].some(o=>o.value===state[key])))state[key]="";if(el)el.value=state[key]});
  const q=normalizedSearchText(state.q);
  const cards=[...root.querySelectorAll(".ops-sites-cc-card")];
  const visible=new Set();
  cards.forEach(card=>{
    const d=card.dataset;
    const ok=(!q||String(d.ccSearch||"").includes(q))&&(!state.status||d.ccStatus===state.status)&&(!state.wilaya||d.ccWilaya===state.wilaya)&&(!state.client||d.ccClient===state.client)&&opsSitesCcQuickMatch(card,state.quick);
    card.hidden=!ok;
    if(ok)visible.add(d.ccSite);
  });
  const filtered=!!(q||state.status||state.wilaya||state.client||state.quick!=="all");
  const info=root.querySelector("#sites-filter-info");
  if(info){
    info.hidden=!filtered;
    info.innerHTML=filtered?`<span>${state.quick!=="all"?escapeHTML(OPS_SITES_CC_QUICK[state.quick])+" · ":""}${visible.size} site(s) affiché(s) sur ${cards.length}</span><button type="button" class="ops-sites-cc-link" onclick="opsSitesCcReset()">Réinitialiser</button>`:"";
  }
  const none=root.querySelector("#ops-sites-cc-no-match");
  if(none)none.hidden=!(cards.length&&!visible.size);
  root.querySelectorAll("[data-cc-quick]").forEach(b=>b.classList.toggle("is-active",state.quick!=="all"&&b.dataset.ccQuick===state.quick));
  (window.__sgdiSitesDashboardMarkers||[]).forEach(marker=>{try{marker.getElement().style.display=!filtered||visible.has(marker.__sgdiSiteId)?"":"none"}catch(_e){}});
}
function opsSitesCcLocate(siteKey){
  const row=(window.__opsSitesCcModel?.rows||[]).find(r=>r.key===String(siteKey));
  if(!row?.pos)return toast("Ce site n'a pas encore de position GPS enregistrée.","info");
  if(opsSitesCcState().view!=="carte")opsSitesCcSetView("carte");
  const map=window.__sgdiSitesDashboardMap;
  if(map)map.flyTo({center:[row.pos.lng,row.pos.lat],zoom:14,essential:true});
  const label=document.getElementById("sites-map-label"),open=document.getElementById("sites-map-open"),select=document.getElementById("sites-map-select");
  if(label)label.textContent=row.site.nom||siteMapQuery(row.site);
  if(open)open.href=googleMapsSearchUrl(siteMapQuery(row.site));
  if(select&&[...select.options].some(o=>o.value===row.key))select.value=row.key;
  opsSitesCcRoot()?.querySelector(".ops-sites-cc-map-panel")?.scrollIntoView?.({behavior:"smooth",block:"nearest"});
}

// Carte : la vraie carte MapLibre + tuiles OpenStreetMap du tableau de bord, en rendu sombre.
// Le rendu sombre inverse la luminosité de la couche raster OSM (propriétés de peinture MapLibre) :
// mêmes tuiles, même attribution, mêmes interactions ; la vue satellite n'est pas modifiée.
function opsSitesCcMapStyle(){
  const style=sgdiMapLibreStyle();
  style.layers=style.layers.map(layer=>layer.id==="osm"?{...layer,paint:{"raster-brightness-min":1,"raster-brightness-max":0,"raster-hue-rotate":180,"raster-saturation":-0.45,"raster-contrast":0.08}}:layer);
  return style;
}
function opsSitesCcMarkerElement(row){
  const status=OPS_SITES_CC_STATUS[row.status];
  const el=document.createElement("button");
  el.type="button";
  el.className="sgdi-site-map-marker ops-sites-cc-marker";
  el.dataset.tone=status.tone;
  el.dataset.ccStatus=row.status;
  el.title=`${row.site.nom||"Site"} — ${status.label}`;
  el.innerHTML="<span></span>";
  return el;
}
function opsSitesCcPopupHTML(row){
  const s=row.site;
  return `<div class="ops-sites-cc-popup"><b>${escapeHTML(s.nom||"Site")}</b><span>${escapeHTML([s.commune,s.wilaya].filter(Boolean).join(", ")||"")}</span><span>${escapeHTML(OPS_SITES_CC_STATUS[row.status].label)} · ${row.realized} affecté(s) / ${row.contractual||0} contractuel(s)</span><a href="#/sites/${row.ref}">Voir le détail →</a></div>`;
}
function opsSitesCcInitMap(el){
  if(!el||el.dataset.sgdiMapReady==="1")return;
  el.dataset.sgdiMapReady="1";
  if(window.__sgdiSitesDashboardMap&&typeof window.__sgdiSitesDashboardMap.remove==="function"){
    try{window.__sgdiSitesDashboardMap.remove()}catch(_e){}
  }
  window.__sgdiSitesDashboardMap=null;
  window.__sgdiSitesDashboardMarkers=[];
  loadMapLibre().then(maplibregl=>{
    if(document.getElementById("sites-map-frame")!==el)return;
    const positioned=(window.__opsSitesCcModel?.rows||[]).filter(row=>row.pos);
    const center=positioned[0]?.pos||{lat:28.0339,lng:1.6596};
    const map=new maplibregl.Map({container:el,style:opsSitesCcMapStyle(),center:[center.lng,center.lat],zoom:positioned.length?6:4.2,scrollZoom:false,attributionControl:false});
    window.__sgdiSitesDashboardMap=map;
    window.__sgdiSitesDashboardMarkers=[];
    map.addControl(new maplibregl.AttributionControl({compact:false}),"bottom-right");
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-left");
    map.addControl(new SgdiSatelliteControl(),"top-left");
    map.on("load",()=>{
      try{map.resize()}catch(_e){}
      const bounds=new maplibregl.LngLatBounds();
      positioned.forEach(row=>{
        bounds.extend([row.pos.lng,row.pos.lat]);
        const marker=new maplibregl.Marker({element:opsSitesCcMarkerElement(row)})
          .setLngLat([row.pos.lng,row.pos.lat])
          .setPopup(new maplibregl.Popup({offset:18,className:"ops-sites-cc-map-popup"}).setHTML(opsSitesCcPopupHTML(row)))
          .addTo(map);
        marker.__sgdiSiteId=row.key;
        window.__sgdiSitesDashboardMarkers.push(marker);
      });
      if(positioned.length>1)map.fitBounds(bounds,{padding:54,maxZoom:11});
      opsSitesCcApplyFilters();
      [80,220,600].forEach(ms=>sitesModuleTimeout(()=>{try{map.resize()}catch(_e){}},ms));
    });
  }).catch(e=>{
    el.innerHTML=`<div class="ops-sites-cc-empty">Carte indisponible : ${escapeHTML(e.message||e)}</div>`;
  });
}

SGDIModules.registerModule({key: "sites-command-center", routes: [], dependencies: [], init: function(){}, destroy: function(){}});
