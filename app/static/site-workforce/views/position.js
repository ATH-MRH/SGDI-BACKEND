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
  async function loadPhoto(img, url) {
    try {
      const res = await fetch(url, { headers: SW.state.token ? { Authorization: "Bearer " + SW.state.token } : {} });
      if (!res.ok) return;
      const blobUrl = URL.createObjectURL(await res.blob());
      img.src = blobUrl;
      img.hidden = false;
      img.addEventListener("load", () => URL.revokeObjectURL(blobUrl), { once: true });
    } catch (e) { /* sans photo : initiales conservées */ }
  }

  // ── Liste ───────────────────────────────────────────────────────────────────────────
  async function renderList(container) {
    let page = 1;
    const filters = { q: "", position: "", status: "" };
    container.innerHTML = `
      <h1 class="section-title">Fiches de position</h1>
      <p class="section-sub">Consultation des positions des employés de votre périmètre · <span data-scope-label>${SW.esc(SW.scopeLabel())}</span></p>
      <div class="filters-row" id="pf-filters"></div>
      <div class="card"><div id="pf-list">${SW.skeletonRows(6)}</div></div>`;
    let filtersBuilt = false;
    let debounce;

    function buildFilters(meta) {
      if (filtersBuilt) return;
      filtersBuilt = true;
      const el = document.querySelector("#pf-filters");
      el.innerHTML = [
        meta.search ? `<div class="field search-input"><label>Recherche</label><input id="pf-q" type="search" placeholder="Nom, prénom, code…"></div>` : "",
        meta.position ? `<div class="field"><label>Poste / fonction</label><input id="pf-position" type="search" placeholder="Ex. CARISTE"></div>` : "",
        meta.statuses && meta.statuses.length ? `<div class="field"><label>Statut</label><select id="pf-status"><option value="">Tous</option>
          ${meta.statuses.map((s) => `<option value="${SW.esc(s)}">${SW.esc(s)}</option>`).join("")}</select></div>` : "",
      ].join("") || `<span class="muted">Société et site : sélecteurs du bandeau.</span>`;
      const onInput = (key) => (e) => { clearTimeout(debounce); debounce = setTimeout(() => { filters[key] = e.target.value; page = 1; load(); }, 250); };
      document.querySelector("#pf-q")?.addEventListener("input", onInput("q"));
      document.querySelector("#pf-position")?.addEventListener("input", onInput("position"));
      document.querySelector("#pf-status")?.addEventListener("change", (e) => { filters.status = e.target.value; page = 1; load(); });
    }

    async function load() {
      const el = document.querySelector("#pf-list");
      try {
        const data = await SW.guardedApi("positions", "/site-workforce/positions", { params: { ...filters, page, page_size: 20 } });
        buildFilters(data.filters || {});
        if (!data.columns.length) { el.innerHTML = SW.emptyState("Aucun champ de la fiche de position n'est autorisé pour ce compte. Contactez l'administrateur."); return; }
        if (!data.items.length) { el.innerHTML = SW.emptyState("Aucun employé ne correspond."); return; }
        const cols = data.columns;
        const nameKeys = cols.filter((c) => c.key === "identity.last_name" || c.key === "identity.first_name").map((c) => c.key);
        const others = cols.filter((c) => !nameKeys.includes(c.key));
        el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
            ${nameKeys.length ? "<th>Employé</th>" : ""}${others.map((c) => `<th>${SW.esc(c.label)}</th>`).join("")}<th></th>
          </tr></thead><tbody>
          ${data.items.map((r) => `<tr>
            ${nameKeys.length ? `<td><b>${SW.esc(nameKeys.map((k) => r.fields[k] || "").join(" ").trim() || "—")}</b></td>` : ""}
            ${others.map((c) => `<td>${valueHTML(c, r.fields[c.key])}</td>`).join("")}
            <td class="actions"><a class="btn btn-sm" href="#/position/${encodeURIComponent(r.employee_id)}">Consulter</a></td>
          </tr>`).join("")}
        </tbody></table></div>`;
        el.appendChild(SW.paginationBar(data, (p) => { page = p; load(); }));
      } catch (err) { if (err.name !== "AbortError") el.innerHTML = SW.errorState(err); }
    }
    load();
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
          <h1 class="pf-name">${SW.esc(name || "Employé #" + data.employee_id)}</h1>
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
