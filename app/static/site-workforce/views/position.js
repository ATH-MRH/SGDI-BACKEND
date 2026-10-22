// Fiche de position (lecture seule) — projection serveur des données canoniques DRH/OPS.
// Aucune hypothèse sur les champs : la liste et la fiche n'affichent QUE ce que l'API renvoie
// (sections, champs, libellés, ordre), déjà filtré côté serveur selon les champs cochés par
// l'administrateur. Aucun input sur la fiche : le seul formulaire est le signalement d'anomalie,
// qui crée une réclamation + une transmission (mécanismes BEO existants) sans jamais modifier
// la fiche.
(function () {
  "use strict";
  const SW = window.SW;

  const STATUS_TONE = { actif: "success", suspendu: "warn", sortant: "warn", sorti: "neutral", ancien: "neutral", blacklist: "danger" };
  const ANOMALIES = [
    { key: "poste", label: "Poste / fonction incorrect", to: "drh" },
    { key: "site", label: "Site d'affectation incorrect", to: "ops" },
    { key: "date_affectation", label: "Date d'affectation incorrecte", to: "ops" },
    { key: "rotation", label: "Groupe / rotation / vacation à vérifier", to: "ops" },
    { key: "contrat", label: "Contrat à vérifier", to: "drh" },
    { key: "identite", label: "Identité à corriger", to: "drh" },
    { key: "autre", label: "Autre anomalie", to: "drh" },
  ];

  function badge(label, tone) { return `<span class="badge ${tone || "neutral"}">${SW.esc(label)}</span>`; }

  function valueHTML(field, value) {
    if (value === null || value === undefined || value === "") return `<span class="muted">—</span>`;
    if (field.kind === "date") return SW.dateFr(value);
    if (field.kind === "badge") {
      if (typeof value === "object") return badge(value.label, value.tone);
      return badge(value, STATUS_TONE[String(value).toLowerCase()]);
    }
    if (field.kind === "photo") return `<span class="muted">Photo affichée en en-tête</span>`;
    if (field.kind === "table") return tableHTML(field, value);
    return SW.esc(value);
  }

  function tableHTML(field, rows) {
    if (!Array.isArray(rows) || !rows.length) return `<span class="muted">Aucun élément</span>`;
    const cols = field.columns || [];
    const cell = (c, v) => (v === null || v === undefined || v === "") ? "—" : (/date$/.test(c.key) ? SW.dateFr(v) : SW.esc(v));
    return `<div class="table-wrap"><table class="data pf-history"><thead><tr>${cols.map((c) => `<th>${SW.esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${cell(c, r[c.key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  // La photo exige le jeton : chargée par fetch authentifié puis affichée en blob (jamais
  // d'URL publique). 404 = pas de photo, ou champ Photo non autorisé.
  const loadPhoto = (img, url) => SW.loadPhoto(img, url);

  // ── Annuaire des fiches (fichettes ou liste) ────────────────────────────────────────
  // Une fichette n'affiche QUE les champs autorisés renvoyés par l'API (une ligne absente =
  // champ non autorisé ; « — » = champ autorisé mais vide). Lampe unique calculée serveur
  // (indicator) : rouge Blacklist, orange sanction/discipline, vert rien à signaler ; éteinte
  // (« incomplet ») si le compte n'a pas les champs nécessaires — jamais un faux vert.
  const CARD_ROWS = [
    { keys: ["assignment.society"], label: "Structure", icon: "building" },
    { keys: ["assignment.site"], label: "Site", icon: "pin" },
    { keys: ["assignment.group"], label: "Groupe", icon: "users", group: true },
    { keys: ["assignment.position", "assignment.function"], label: "Poste", icon: "briefcase" },
    { keys: ["contract.recruit_date"], label: "Date de recrutement", icon: "calendar", date: true },
    { keys: ["contract.end_date"], label: "Fin de contrat", icon: "calendarx", date: true },
  ];
  const LAMPS = [["red", "Blacklist"], ["orange", "Sanction / discipline à signaler"], ["green", "Rien à signaler"]];

  function lampsHTML(ind) {
    const level = (ind && ind.level) || "unknown";
    const label = (ind && ind.label) || "Indicateur indisponible";
    return `<span class="beo-lamps" role="img" aria-label="Indicateur : ${SW.esc(label)}" title="${SW.esc(label)}" data-level="${level}">
      ${LAMPS.map(([key, text]) => `<span class="beo-lamp lamp-${key}${level === key ? " on" : ""}" title="${SW.esc(text)}"></span>`).join("")}</span>`;
  }

  function cardHTML(r, allowed) {
    const f = r.fields || {};
    const name = [f["identity.last_name"], f["identity.first_name"]];
    const label = name.filter(Boolean).join(" ") || "Employé #" + r.employee_id;
    const photo = f["identity.photo"];
    const rows = CARD_ROWS.filter((row) => row.keys.some((k) => allowed.has(k))).map((row) => {
      const value = row.keys.map((k) => f[k]).find((v) => v !== null && v !== undefined && v !== "");
      const shown = value === undefined ? "—" : row.date ? SW.dateFr(value)
        : row.group ? `<span class="beo-group g-${SW.esc(String(value).toLowerCase())}">${SW.esc(value)}</span>` : SW.esc(value);
      return `<div><dt>${SW.icon(row.icon)}${SW.esc(row.label)}</dt><dd>${shown}</dd></div>`;
    }).join("");
    return `<article class="beo-card beo-fiche" data-fiche="${SW.esc(r.employee_id)}">
      <div class="beo-card-head">
        <span class="beo-avatar beo-avatar-lg">${photo && photo.url ? `<img alt="" hidden data-photo-src="${SW.esc(photo.url)}">` : ""}<span>${SW.esc(SW.initials(...name))}</span></span>
        <div class="beo-card-id">${allowed.has("identity.last_name") ? `<b>${SW.esc(f["identity.last_name"] || "—")}</b>` : ""}
          ${allowed.has("identity.first_name") ? `<span>${SW.esc(f["identity.first_name"] || "")}</span>` : ""}
          ${allowed.has("identity.employee_code") ? `<small>${SW.esc(f["identity.employee_code"] || "")}</small>` : ""}</div>
        ${lampsHTML(r.indicator)}
      </div>
      ${rows ? `<dl class="beo-card-rows">${rows}</dl>` : ""}
      <a class="beo-btn-open" href="#/position/${encodeURIComponent(r.employee_id)}" aria-label="Ouvrir la fiche de ${SW.esc(label)}">Ouvrir la fiche ${SW.icon("chevron")}</a>
    </article>`;
  }

  function tableListHTML(data) {
    const cols = data.columns.filter((c) => c.kind !== "photo");
    const nameKeys = cols.filter((c) => c.key === "identity.last_name" || c.key === "identity.first_name").map((c) => c.key);
    const others = cols.filter((c) => !nameKeys.includes(c.key));
    return `<div class="table-wrap"><table class="beo-table beo-fiche-table"><thead><tr>
        <th><span class="sr-only">Indicateur</span></th>${nameKeys.length ? "<th>Employé</th>" : ""}${others.map((c) => `<th>${SW.esc(c.label)}</th>`).join("")}<th class="actions">Action</th>
      </tr></thead><tbody>
      ${data.items.map((r) => `<tr data-fiche="${SW.esc(r.employee_id)}">
        <td>${lampsHTML(r.indicator)}</td>
        ${nameKeys.length ? `<td><b>${SW.esc(nameKeys.map((k) => r.fields[k] || "").join(" ").trim() || "—")}</b></td>` : ""}
        ${others.map((c) => `<td>${valueHTML(c, r.fields[c.key])}</td>`).join("")}
        <td class="actions"><a class="beo-btn-fiche" href="#/position/${encodeURIComponent(r.employee_id)}">Ouvrir la fiche</a></td>
      </tr>`).join("")}
    </tbody></table></div>`;
  }

  async function renderList(container) {
    let page = 1;
    const filters = { q: "", position: "", status: "", group: "", site: "" };
    let view = SW.storedPref("fiches_view", "mosaic") === "list" ? "list" : "mosaic";
    let lastData = null;
    let stopPhotos = () => {};
    container.innerHTML = `
      <p class="sr-only">Consultation des positions des employés de votre périmètre · <span data-scope-label>${SW.esc(SW.scopeLabel())}</span></p>
      <section class="beo-panel beo-controls" aria-label="Recherche et filtres">
        <div class="beo-toolbar" id="pf-filters">
          <div class="beo-seg" role="group" aria-label="Mode d'affichage">
            <button type="button" class="beo-seg-btn" data-view="mosaic" aria-pressed="false">${SW.icon("grid")}Mosaïque</button>
            <button type="button" class="beo-seg-btn" data-view="list" aria-pressed="false">${SW.icon("rows")}Liste</button>
          </div>
        </div>
      </section>
      <section class="beo-panel">
        <div class="beo-list-head"><h2 class="beo-list-count" id="pf-count">Fiches de position</h2>
          <div class="beo-lamp-legend" aria-hidden="true">${LAMPS.map(([k, l]) => `<span><span class="beo-lamp lamp-${k} on"></span>${SW.esc(l)}</span>`).join("")}</div></div>
        <div id="pf-list">${SW.skeletonRows(6)}</div>
      </section>`;
    let filtersBuilt = false;
    let debounce;
    const listEl = container.querySelector("#pf-list");
    const toolbar = container.querySelector("#pf-filters");

    function syncView() { container.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view))); }

    function buildFilters(meta) {
      if (filtersBuilt) return;
      filtersBuilt = true;
      const groups = meta.groups || [];
      const sites = meta.sites || [];
      toolbar.insertAdjacentHTML("afterbegin", [
        meta.search ? `<label class="beo-search">${SW.icon("search")}<input id="pf-q" type="search" placeholder="Rechercher un nom, un code ou un poste..." aria-label="Rechercher un nom, un code ou un poste"></label>` : "",
      ].join(""));
      toolbar.insertAdjacentHTML("beforeend", [
        meta.position ? `<label class="beo-field-inline"><span class="sr-only">Poste / fonction</span><input id="pf-position" type="search" placeholder="Poste / fonction" aria-label="Poste / fonction"></label>` : "",
        groups.length ? `<label class="beo-select">${SW.icon("users")}<select id="pf-group" aria-label="Groupe"><option value="">Tous les groupes</option>
          ${groups.map((g) => `<option value="${SW.esc(g.key)}">Groupe ${SW.esc(g.key)} (${g.count})</option>`).join("")}</select></label>` : "",
        sites.length > 1 ? `<label class="beo-select">${SW.icon("pin")}<select id="pf-site" aria-label="Site"><option value="">Tous les sites</option>
          ${sites.map((s) => `<option value="${s.site_id}">${SW.esc(s.site_name || "—")} (${s.count})</option>`).join("")}</select></label>` : "",
        meta.statuses && meta.statuses.length ? `<label class="beo-select"><select id="pf-status" aria-label="Statut"><option value="">Tous les statuts</option>
          ${meta.statuses.map((s) => `<option value="${SW.esc(s)}">${SW.esc(s)}</option>`).join("")}</select></label>` : "",
      ].join(""));
      const onInput = (key) => (e) => { clearTimeout(debounce); debounce = setTimeout(() => { filters[key] = e.target.value.trim(); page = 1; load(); }, 250); };
      container.querySelector("#pf-q")?.addEventListener("input", onInput("q"));
      container.querySelector("#pf-position")?.addEventListener("input", onInput("position"));
      ["group", "site", "status"].forEach((key) => container.querySelector("#pf-" + key)?.addEventListener("change", (e) => { filters[key] = e.target.value; page = 1; load(); }));
    }

    function render() {
      stopPhotos();
      const data = lastData;
      if (!data) return;
      if (!data.columns.length) { listEl.innerHTML = SW.emptyState("Aucun champ de la fiche de position n'est autorisé pour ce compte. Contactez l'administrateur."); return; }
      container.querySelector("#pf-count").textContent = `${data.total} fiche${data.total > 1 ? "s" : ""} de position`;
      if (!data.items.length) { listEl.innerHTML = SW.emptyState("Aucun employé ne correspond."); return; }
      const allowed = new Set(data.columns.map((c) => c.key));
      listEl.innerHTML = view === "mosaic" ? `<div class="beo-cards">${data.items.map((r) => cardHTML(r, allowed)).join("")}</div>` : tableListHTML(data);
      // Fichette (et ligne) cliquable en entier ; le lien « Ouvrir la fiche » reste la cible clavier.
      listEl.querySelectorAll("[data-fiche]").forEach((el) => el.addEventListener("click", (e) => {
        if (e.target.closest("a,button,select,input")) return;
        location.hash = "#/position/" + encodeURIComponent(el.dataset.fiche);
      }));
      listEl.appendChild(SW.paginationBar(data, (p) => { page = p; load(); }));
      stopPhotos = SW.lazyPhotos(listEl);
    }

    async function load() {
      syncView();
      try {
        const data = await SW.guardedApi("positions", "/site-workforce/positions", { params: { ...filters, page, page_size: 24 } });
        buildFilters(data.filters || {});
        lastData = data;
        render();
      } catch (err) { if (err.name !== "AbortError") listEl.innerHTML = SW.errorState(err); }
    }
    container.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
      view = b.dataset.view; SW.storePref("fiches_view", view); syncView(); render();
    }));
    load();
    return () => { clearTimeout(debounce); stopPhotos(); };
  }

  // ── Fiche individuelle ──────────────────────────────────────────────────────────────
  async function renderDetail(container, employeeId) {
    container.innerHTML = `<a class="btn btn-sm btn-ghost pf-back" href="#/position">← Fiches de position</a>
      <div id="pf-detail">${SW.skeletonKpis(3)}${SW.skeletonRows(6)}</div>`;
    const el = document.querySelector("#pf-detail");
    let data;
    try {
      data = await SW.guardedApi("position-detail", `/site-workforce/positions/${encodeURIComponent(employeeId)}`);
    } catch (err) {
      if (err.name !== "AbortError") el.innerHTML = SW.errorState(err);
      return;
    }
    const fields = {};
    data.sections.forEach((s) => s.fields.forEach((f) => { fields[f.key] = f; }));
    const v = (k) => (fields[k] ? fields[k].value : undefined);
    const name = [v("identity.last_name"), v("identity.first_name")].filter(Boolean).join(" ");
    const initials = (name || v("identity.employee_code") || "?").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
    const photo = v("identity.photo");
    const status = fields["identity.status"];

    const sectionsHTML = data.sections.map((s) => {
      const tables = s.fields.filter((f) => f.kind === "table");
      const plain = s.fields.filter((f) => f.kind !== "table" && f.kind !== "photo");
      return `<section class="card pf-section ${tables.length ? "pf-section-wide" : ""}" data-pf-section="${SW.esc(s.key)}">
        <div class="card-head"><h2>${SW.esc(s.label)}</h2></div>
        ${plain.length ? `<dl class="pf-kv">${plain.map((f) => `<div class="pf-kv-row" data-pf-field="${SW.esc(f.key)}"><dt>${SW.esc(f.label)}</dt><dd>${valueHTML(f, f.value)}</dd></div>`).join("")}</dl>` : ""}
        ${tables.map((f) => `<div class="pf-table" data-pf-field="${SW.esc(f.key)}"><h3>${SW.esc(f.label)}</h3>${valueHTML(f, f.value)}</div>`).join("")}
      </section>`;
    }).join("");

    el.innerHTML = `
      <div class="card pf-head">
        <div class="pf-avatar">${photo ? `<img alt="Photo professionnelle" hidden data-pf-photo>` : ""}<span>${SW.esc(initials)}</span></div>
        <div class="pf-head-text">
          <div class="pf-head-kicker">Fiche de position · lecture seule</div>
          <h2 class="pf-name">${SW.esc(name || "Employé #" + data.employee_id)}</h2>
          <div class="pf-head-meta">
            ${v("identity.employee_code") ? `<span class="pf-code">Code ${SW.esc(v("identity.employee_code"))}</span>` : ""}
            ${status ? valueHTML(status, status.value) : ""}
          </div>
        </div>
        <div class="pf-head-actions"><button class="btn btn-sm" id="pf-report">Signaler une anomalie</button></div>
      </div>
      ${data.sections.length ? `<div class="pf-grid">${sectionsHTML}</div>`
        : SW.emptyState("Aucun champ de la fiche de position n'est autorisé pour ce compte. Contactez l'administrateur.")}
      <p class="pf-footnote muted">Données DRH / OPS en consultation. Toute correction se demande par « Signaler une anomalie ».</p>`;
    const img = el.querySelector("[data-pf-photo]");
    if (img && photo && photo.url) loadPhoto(img, photo.url).then(() => { if (!img.hidden) img.nextElementSibling?.remove(); });
    el.querySelector("#pf-report").addEventListener("click", () => openReport(data, name));
  }

  function openReport(data, name) {
    SW.openDrawer("Signaler une anomalie", `
      <p class="muted" style="margin-top:0">La fiche n'est pas modifiée : une réclamation est créée et transmise au service propriétaire de la donnée.</p>
      <form id="pf-report-form" class="kv-list">
        <div class="field"><label>Employé</label><div><b>${SW.esc(name || "#" + data.employee_id)}</b></div></div>
        <div class="field"><label>Nature</label><select name="nature" required>
          ${ANOMALIES.map((a) => `<option value="${a.key}">${SW.esc(a.label)}</option>`).join("")}</select></div>
        <div class="field"><label>Destinataire</label><select name="destinataire">
          <option value="drh">DRH</option><option value="ops">OPS</option></select></div>
        <div class="field"><label>Description</label><textarea name="description" rows="4" required maxlength="2000"></textarea></div>
        <button class="btn btn-primary" type="submit">Envoyer le signalement</button>
        <div id="pf-report-msg" class="msg"></div>
      </form>`);
    const form = document.querySelector("#pf-report-form");
    const natureEl = form.querySelector("[name=nature]");
    const descEl = form.querySelector("[name=description]");
    const dest = form.querySelector("[name=destinataire]");
    const syncDest = () => { dest.value = (ANOMALIES.find((a) => a.key === natureEl.value) || {}).to || "drh"; };
    natureEl.addEventListener("change", syncDest);
    syncDest();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      const msg = form.querySelector("#pf-report-msg");
      const nature = ANOMALIES.find((a) => a.key === natureEl.value) || ANOMALIES[ANOMALIES.length - 1];
      btn.disabled = true;
      try {
        const subject = `Fiche de position — ${nature.label}`;
        const rec = await SW.api("/site-workforce/reclamations", { method: "POST", body: {
          employee_id: data.employee_id, site_id: data.site_id, category: "fiche_position",
          subject, description: descEl.value, priority: "normale",
        } });
        await SW.api("/site-workforce/transmissions", { method: "POST", body: {
          resource_type: "reclamation", resource_id: rec.id, destinataire: dest.value, objet: subject,
          commentaire: descEl.value, priority: "normale",
        } });
        msg.textContent = `Signalement transmis (${dest.value.toUpperCase()}). Suivi dans Réclamations.`;
        msg.className = "msg ok";
        form.querySelectorAll("select,textarea").forEach((x) => { x.disabled = true; });
      } catch (err) {
        msg.textContent = err.message; msg.className = "msg error"; btn.disabled = false;
      }
    });
  }

  window.SiteWorkforceViews = window.SiteWorkforceViews || {};
  window.SiteWorkforceViews.position = async function (container, ctx) {
    const id = String((ctx && ctx.param) || "").trim();
    if (/^\d+$/.test(id)) return renderDetail(container, id);
    return renderList(container);
  };
})();
