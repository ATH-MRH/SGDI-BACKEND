// EFFECTIF (§8) : annuaire paginé SERVEUR (jamais un full-fetch) sur le périmètre consulté.
// Recherche, tri, filtres Groupe / Site / Statut (combinables) et compteurs sont calculés par
// /site-workforce/employees (directory.py) ; l'écran n'affiche que ce que le serveur renvoie.
// Statut métier et tris sensibles suivent les champs autorisés du compte (capabilities).
// Champs volontairement limités — jamais salaire/RIB/paie/IRG/CNAS.
(function () {
  "use strict";
  const SW = window.SW;

  const SORT_LABELS = {
    name: "Nom (A → Z)", name_desc: "Nom (Z → A)", code: "Code", structure: "Structure", site: "Site", group: "Groupe",
    position: "Poste", status: "Statut", recruit_date: "Date de recrutement", contract_end: "Date fin de contrat",
  };
  const NO_GROUP = "_none";
  const PRESENCE_LABELS = { present: "Présents aujourd'hui", absent: "Absents aujourd'hui", non_pointe: "Pointages incomplets aujourd'hui" };
  const TOP_SITES = 3;
  const PAGE_SIZE = 24;

  // Filtres conservés d'un rendu à l'autre (changement de périmètre, retour depuis une fiche).
  const memory = { q: "", sort: "name", site: "", group: "", status: "", presence: "", grouping: "", page: 1, epoch: -1 };

  function groupLabel(key) { return key === NO_GROUP ? "Sans groupe" : key; }
  function statusBadge(key, label) {
    const cfg = SW.BUSINESS_STATUS[key] || {};
    return `<span class="beo-status tone-${cfg.tone || "neutral"}">${SW.esc(label || cfg.label || key)}</span>`;
  }
  function groupBadge(code) {
    const key = String(code || "").trim().toUpperCase();
    return key ? `<span class="beo-group g-${SW.esc(key.toLowerCase())}">${SW.esc(key)}</span>` : `<span class="muted">—</span>`;
  }
  function ficheLink(r, label) {
    return `<a class="beo-btn-fiche" href="#/position/${encodeURIComponent(r.id)}" data-position-link="${SW.esc(r.id)}">${SW.esc(label || "Voir la fiche de position")}</a>`;
  }
  function avatar(r) {
    const ini = SW.initials(r.last_name, r.first_name);
    return `<span class="beo-avatar">${r.photo_url ? `<img alt="" hidden data-photo-src="${SW.esc(r.photo_url)}">` : ""}<span>${SW.esc(ini)}</span></span>`;
  }

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.personnel = async function (container, ctx) {
    // Un changement de périmètre invalide le filtre site local (il pourrait en sortir).
    if (memory.epoch !== SW.state.scopeEpoch) { memory.site = ""; memory.page = 1; memory.epoch = SW.state.scopeEpoch; }
    // Arrivée depuis un compteur / une ligne du tableau de bord : ses filtres remplacent les précédents.
    const query = (ctx && ctx.query) || new URLSearchParams();
    if (["presence", "status", "site", "group"].some((k) => query.has(k))) {
      Object.assign(memory, { q: "", site: "", group: "", status: "", presence: "", page: 1 });
      ["presence", "status", "site", "group"].forEach((k) => { if (query.has(k)) memory[k] = query.get(k) || ""; });
    }
    let view = SW.storedPref("effectif_view", "list") === "mosaic" ? "mosaic" : "list";
    let lastData = null;
    let stopPhotos = () => {};

    container.innerHTML = `
      <section class="beo-panel beo-controls" aria-label="Recherche, tri et filtres">
        <div class="beo-toolbar">
          <label class="beo-search">${SW.icon("search")}<input id="pers-q" type="search" placeholder="Rechercher un nom, code, poste..." aria-label="Rechercher un nom, code, poste" value="${SW.esc(memory.q)}"></label>
          <label class="beo-sort"><span>${SW.icon("sort")}Tri</span><select id="pers-sort" aria-label="Tri">${Object.entries(SORT_LABELS).filter(([k]) => !["recruit_date", "contract_end"].includes(k)).map(([k, l]) => `<option value="${k}">${SW.esc(l)}</option>`).join("")}</select></label>
          <div class="beo-seg" role="group" aria-label="Mode d'affichage">
            <button type="button" class="beo-seg-btn" data-view="list" aria-pressed="false">${SW.icon("rows")}Liste</button>
            <button type="button" class="beo-seg-btn" data-view="mosaic" aria-pressed="false">${SW.icon("grid")}Mosaïque</button>
          </div>
          <div class="beo-seg" role="group" aria-label="Regroupement">
            <button type="button" class="beo-seg-btn" data-grouping="site" aria-pressed="false">${SW.icon("pin")}Par site</button>
            <button type="button" class="beo-seg-btn" data-grouping="group" aria-pressed="false">${SW.icon("users")}Par groupe</button>
          </div>
          <button type="button" class="beo-reset" id="pers-reset" hidden>${SW.icon("reset")}Réinitialiser</button>
        </div>
        <div class="beo-facets" id="pers-facets"></div>
      </section>
      <section class="beo-panel">
        <div class="beo-list-head"><h2 class="beo-list-count" id="pers-count">EFFECTIF</h2><div class="beo-active-filters" id="pers-active"></div></div>
        <div id="pers-list">${SW.skeletonRows(6)}</div>
      </section>`;

    const listEl = container.querySelector("#pers-list");
    const facetsEl = container.querySelector("#pers-facets");
    const sortEl = container.querySelector("#pers-sort");
    sortEl.value = SORT_LABELS[memory.sort] ? memory.sort : "name";

    function syncToolbar() {
      container.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
      container.querySelectorAll("[data-grouping]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.grouping === memory.grouping)));
      const filtered = memory.q || memory.site || memory.group || memory.status || memory.presence || memory.sort !== "name" || memory.grouping;
      container.querySelector("#pers-reset").hidden = !filtered;
      const active = container.querySelector("#pers-active");
      active.innerHTML = memory.presence && PRESENCE_LABELS[memory.presence]
        ? `<button type="button" class="beo-pill" data-clear="presence" aria-label="Retirer le filtre ${SW.esc(PRESENCE_LABELS[memory.presence])}">${SW.esc(PRESENCE_LABELS[memory.presence])} ✕</button>` : "";
      active.querySelector("[data-clear]")?.addEventListener("click", () => { memory.presence = ""; reload(); });
    }

    function chip(family, key, label, count, extraClass) {
      const on = memory[family] === key;
      return `<button type="button" class="beo-chip ${extraClass || ""}" data-family="${family}" data-key="${SW.esc(key)}" aria-pressed="${on}">
        <span class="beo-chip-label">${label}</span>${count === undefined ? "" : `<span class="beo-chip-count">${count}</span>`}</button>`;
    }

    function renderFacets(data) {
      const f = data.facets || {};
      const groups = f.groups || [];
      const sites = f.sites || [];
      const statuses = (f.statuses || []).filter((s) => s.count > 0 || s.key === memory.status);
      const top = sites.slice(0, TOP_SITES);
      const rest = sites.slice(TOP_SITES);
      const restCount = rest.reduce((n, s) => n + s.count, 0);
      const restSelected = rest.some((s) => String(s.site_id) === memory.site);
      facetsEl.innerHTML = `
        <div class="beo-facet" role="group" aria-label="Filtrer par groupe"><h3>Filtrer par groupe</h3><div class="beo-chips">
          ${chip("group", "", "Tous les groupes")}
          ${groups.map((g) => chip("group", g.key, `${SW.icon("users")}${SW.esc(groupLabel(g.key))}`, g.count, "g-" + String(g.key).toLowerCase())).join("")}
        </div></div>
        <div class="beo-facet" role="group" aria-label="Filtrer par site"><h3>Filtrer par site</h3><div class="beo-chips">
          ${sites.length > 1 ? chip("site", "", "Tous les sites") : ""}
          ${top.map((s) => chip("site", String(s.site_id), `${SW.icon("pin")}<span class="beo-chip-text" title="${SW.esc(s.site_name || "—")}">${SW.esc(s.site_name || "—")}</span>`, s.count)).join("")}
          ${rest.length ? `<label class="beo-chip beo-chip-select" data-on="${restSelected}">${SW.icon("pin")}<select id="pers-site-more" aria-label="Autres sites">
              <option value="">Autres sites · ${restCount}</option>
              ${rest.map((s) => `<option value="${s.site_id}" ${String(s.site_id) === memory.site ? "selected" : ""}>${SW.esc(s.site_name || "—")} (${s.count})</option>`).join("")}
            </select></label>` : ""}
        </div></div>
        <div class="beo-facet" role="group" aria-label="Filtrer par statut"><h3>Filtrer par statut</h3><div class="beo-chips">
          ${chip("status", "", "Tous les statuts")}
          ${statuses.map((s) => chip("status", s.key, `<span class="beo-dot tone-${(SW.BUSINESS_STATUS[s.key] || {}).tone || "neutral"}" aria-hidden="true"></span>${SW.esc(s.label)}`, s.count)).join("")}
        </div></div>`;
      facetsEl.querySelectorAll("[data-family]").forEach((b) => b.addEventListener("click", () => {
        const fam = b.dataset.family;
        memory[fam] = memory[fam] === b.dataset.key ? "" : b.dataset.key; // second clic = retirer le filtre
        reload();
      }));
      facetsEl.querySelector("#pers-site-more")?.addEventListener("change", (e) => { memory.site = e.target.value; reload(); });
    }

    function renderSortOptions(data) {
      const allowed = (data.capabilities && data.capabilities.sorts) || Object.keys(SORT_LABELS);
      if (!allowed.includes(memory.sort)) memory.sort = "name";
      sortEl.innerHTML = allowed.filter((k) => SORT_LABELS[k]).map((k) => `<option value="${k}">${SW.esc(SORT_LABELS[k])}</option>`).join("");
      sortEl.value = memory.sort;
    }

    function sectionKey(r) {
      if (memory.grouping === "site") return { key: String(r.site_id), label: `${r.site_name || "—"}${r.society ? " — " + r.society : ""}` };
      if (memory.grouping === "group") { const g = String(r.group_code || "").trim().toUpperCase(); return { key: g, label: g ? `Groupe ${g}` : "Sans groupe" }; }
      return null;
    }

    function renderList(data) {
      let prev = null;
      const rows = data.items.map((r) => {
        const section = sectionKey(r);
        const head = section && section.key !== prev ? `<tr class="beo-group-row"><td colspan="8">${SW.esc(section.label)}</td></tr>` : "";
        if (section) prev = section.key;
        return `${head}<tr>
          <td class="mono" data-label="Code">${SW.esc(r.code || "—")}</td>
          <td class="beo-name-cell" data-label="Nom">${SW.esc([r.last_name, r.first_name].filter(Boolean).join(" ") || "—")}</td>
          <td data-label="Structure">${SW.esc(r.society || "—")}</td>
          <td data-label="Site">${SW.esc(r.site_name || "—")}</td>
          <td data-label="Poste">${SW.esc(r.position || "—")}</td>
          <td data-label="Groupe">${groupBadge(r.group_code)}</td>
          <td data-label="Statut">${statusBadge(r.status, r.status_label)}</td>
          <td class="actions">${ficheLink(r)}</td>
        </tr>`;
      }).join("");
      return `<div class="table-wrap"><table class="beo-table beo-effectif-table"><thead><tr>
          <th>Code</th><th aria-sort="${memory.sort === "name" ? "ascending" : memory.sort === "name_desc" ? "descending" : "none"}">Nom</th>
          <th>Structure</th><th>Site</th><th>Poste</th><th>Groupe</th><th>Statut</th><th class="actions">Action</th>
        </tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function renderMosaic(data) {
      let prev = null;
      return `<div class="beo-cards">${data.items.map((r) => {
        const section = sectionKey(r);
        const head = section && section.key !== prev ? `<h3 class="beo-cards-section">${SW.esc(section.label)}</h3>` : "";
        if (section) prev = section.key;
        return `${head}<article class="beo-card" aria-label="${SW.esc([r.last_name, r.first_name].filter(Boolean).join(" "))}">
          <div class="beo-card-head">${avatar(r)}
            <div class="beo-card-id"><b>${SW.esc(r.last_name || "")}</b><span>${SW.esc(r.first_name || "")}</span><small>${SW.esc(r.code || "")}</small></div>
            ${statusBadge(r.status, r.status_label)}
          </div>
          <dl class="beo-card-rows">
            <div><dt>${SW.icon("building")}Structure</dt><dd>${SW.esc(r.society || "—")}</dd></div>
            <div><dt>${SW.icon("pin")}Site</dt><dd>${SW.esc(r.site_name || "—")}</dd></div>
            <div><dt>${SW.icon("users")}Groupe</dt><dd>${groupBadge(r.group_code)}</dd></div>
            <div><dt>${SW.icon("briefcase")}Poste</dt><dd>${SW.esc(r.position || "—")}</dd></div>
          </dl>
          ${ficheLink(r)}
        </article>`;
      }).join("")}</div>`;
    }

    function render() {
      stopPhotos();
      const data = lastData;
      if (!data) return;
      container.querySelector("#pers-count").textContent = `${data.total} employé${data.total > 1 ? "s" : ""}`;
      if (!data.items.length) { listEl.innerHTML = SW.emptyState("Aucun employé ne correspond."); return; }
      listEl.innerHTML = view === "mosaic" ? renderMosaic(data) : renderList(data);
      listEl.appendChild(SW.paginationBar(data, (p) => { memory.page = p; load(); }));
      stopPhotos = SW.lazyPhotos(listEl);
    }

    async function load() {
      syncToolbar();
      const sort = memory.grouping === "site" ? "site" : memory.grouping === "group" ? "group" : memory.sort;
      try {
        const data = await SW.guardedApi("personnel", "/site-workforce/employees", { params: {
          q: memory.q, sort, site: memory.site, group: memory.group, status: memory.status, presence: memory.presence,
          page: memory.page, page_size: PAGE_SIZE,
        } });
        lastData = data;
        renderSortOptions(data);
        renderFacets(data);
        render();
      } catch (err) {
        if (err.name === "AbortError") return;
        // Filtre devenu invalide (site hors périmètre, statut non autorisé) : on le retire.
        if (err.status === 403 && (memory.site || memory.status)) { memory.site = ""; memory.status = ""; load(); return; }
        listEl.innerHTML = SW.errorState(err);
      }
    }
    function reload() { memory.page = 1; load(); }

    let debounce;
    container.querySelector("#pers-q").addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { memory.q = e.target.value.trim(); reload(); }, 250);
    });
    sortEl.addEventListener("change", (e) => { memory.sort = e.target.value; memory.grouping = ""; reload(); });
    container.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
      view = b.dataset.view; SW.storePref("effectif_view", view); syncToolbar(); render();
    }));
    container.querySelectorAll("[data-grouping]").forEach((b) => b.addEventListener("click", () => {
      memory.grouping = memory.grouping === b.dataset.grouping ? "" : b.dataset.grouping; reload();
    }));
    container.querySelector("#pers-reset").addEventListener("click", () => {
      Object.assign(memory, { q: "", sort: "name", site: "", group: "", status: "", presence: "", grouping: "" });
      container.querySelector("#pers-q").value = "";
      sortEl.value = "name";
      reload();
    });
    load();
    return () => { clearTimeout(debounce); stopPhotos(); };
  };
})();
