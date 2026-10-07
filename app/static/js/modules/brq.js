/* BRQ V1 — reporting views backed exclusively by the read-only BRQ API. */
let brqRequestGeneration = 0;
let brqFilterGeneration = 0;
let brqActiveRequest = null;
let brqFilters = {
  date: "", society: typeof session !== "undefined" ? String(session?.societe || "") : "",
  wilaya: "", client: "", site: "",
  fonction: "", vacation: "",
};

const BRQ_VIEWS = {
  situation: { label: "Situation des effectifs", endpoint: "situation" },
  presences: { label: "Présences", endpoint: "presences" },
  absences: { label: "Absences", endpoint: "absences" },
  "abandons-poste": { label: "Abandons de poste", endpoint: "abandons-poste" },
  sortants: { label: "Sortants", endpoint: "sortants" },
};

function brqEscape(value) {
  return typeof escapeHTML === "function"
    ? escapeHTML(String(value ?? ""))
    : String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
}

function brqDefaultDate() {
  if (typeof today === "function") return today();
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function brqEnsureStyles() {
  if (document.getElementById("brq-module-styles")) return;
  const style = document.createElement("style");
  style.id = "brq-module-styles";
  style.textContent = `
    .sgdi-shell:has(.brq-page) .sgdi-shell-body,
    .sgdi-shell:has(.brq-page) main,
    #view:has(.brq-page){width:100%;max-width:100%;min-width:0}
    .sgdi-shell:has(.brq-page) main{flex:1 1 auto}
    .brq-page,.brq-content,.brq-panel,.brq-head,.brq-results,.brq-summary-grid,
    .brq-summary-split,.brq-kpis,.brq-table-wrap,.brq-mini-table-wrap{
      width:100%;max-width:100%;min-width:0;box-sizing:border-box
    }
    .brq-page{--brq-ink:#10243d;--brq-muted:#64748b;color:var(--brq-ink);display:grid;gap:18px}
    .brq-results{min-height:320px;display:grid;align-content:start;gap:14px}
    .brq-results--loading{place-items:center}
    .brq-loading{min-height:320px;width:100%;display:grid;place-items:center;color:#64748b;font-size:13px}
    .brq-head,.brq-panel{background:#fff;border:1px solid #dbe4ee;border-radius:16px;box-shadow:0 8px 24px #0f172a0a}
    .brq-head{padding:22px;display:grid;gap:18px}
    .brq-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
    .brq-heading h1{font-size:clamp(22px,3vw,30px);line-height:1.15;margin:0;font-weight:900;overflow-wrap:anywhere}
    .brq-heading p{margin:6px 0 0;color:var(--brq-muted);font-size:13px;overflow-wrap:anywhere}
    .brq-actions{display:flex;gap:8px;flex-wrap:wrap}
    .brq-button{width:100%;min-width:0;max-width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:9px;padding:9px 13px;background:#fff;color:#173453;font-weight:800;cursor:pointer}
    .brq-button--primary{background:#0f766e;color:#fff;border-color:#0f766e}
    .brq-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;align-items:end;width:100%;min-width:0}
    .brq-field{display:grid;min-width:0;gap:5px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
    .brq-filters input,.brq-filters select,.brq-filters button{width:100%;min-width:0;max-width:100%;box-sizing:border-box}
    .brq-field input,.brq-field select{height:39px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;color:#10243d;font-size:13px;letter-spacing:normal;text-transform:none}
    .brq-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .brq-summary-grid>.brq-panel:first-child,.brq-summary-grid>.brq-panel:last-child{grid-column:1/-1}
    .brq-summary-split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
    .brq-summary-split>section{min-width:0}
    .brq-summary-split>section+section{border-left:1px solid #e2e8f0}
    .brq-mini-table{width:100%;min-width:620px;border-collapse:collapse;font-size:12px}
    .brq-mini-table th{background:#f8fafc;color:#64748b;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:10px 12px}
    .brq-mini-table td{padding:10px 12px;border-top:1px solid #edf1f5;vertical-align:top}
    .brq-mini-table-wrap{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-inline:contain}
    .brq-kpi small{display:block;margin-top:5px;font-size:10px;font-weight:700;color:#64748b}
    .brq-tabs{display:flex;flex-wrap:wrap;gap:8px;width:100%;min-width:0}
    .brq-tab{max-width:100%;box-sizing:border-box;border:1px solid #d5dee8;border-radius:999px;padding:8px 12px;background:#f8fafc;color:#475569;font-size:12px;font-weight:850;text-decoration:none;white-space:normal;overflow-wrap:anywhere}
    .brq-tab[aria-current=page]{background:#0f766e;border-color:#0f766e;color:#fff}
    .brq-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}
    .brq-kpi{border:1px solid #dbe4ee;border-radius:12px;padding:14px;background:linear-gradient(145deg,#fff,#f7fafc)}
    .brq-kpi span{display:block;color:var(--brq-muted);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
    .brq-kpi strong{display:block;margin-top:6px;font-size:23px;font-weight:950}
    .brq-panel{overflow:hidden}
    .brq-panel-head{min-width:0;padding:15px 18px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
    .brq-panel-head h2{min-width:0;font-size:15px;font-weight:900;margin:0;overflow-wrap:anywhere}
    .brq-panel-head span{font-size:12px;color:var(--brq-muted)}
    .brq-table-wrap{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-inline:contain}
    .brq-table{width:100%;border-collapse:collapse;min-width:900px;font-size:12px}
    .brq-table th{background:#f8fafc;color:#64748b;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;padding:11px 13px;white-space:nowrap}
    .brq-table td{padding:12px 13px;border-top:1px solid #edf1f5;vertical-align:top}
    .brq-table tr:hover td{background:#fbfdff}
    .brq-state{display:inline-flex;border-radius:999px;background:#eef2f7;padding:4px 8px;font-size:10px;font-weight:900;white-space:nowrap}
    .brq-state--present{background:#dcfce7;color:#166534}.brq-state--absent,.brq-state--abandon_poste{background:#fee2e2;color:#991b1b}
    .brq-empty,.brq-error{padding:28px;text-align:center;color:var(--brq-muted);font-size:13px}
    .brq-error{color:#b91c1c}
    @media(max-width:1399px){.brq-filters{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:899px){.brq-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:899px){.brq-summary-grid{grid-template-columns:1fr}.brq-summary-grid>.brq-panel:first-child,.brq-summary-grid>.brq-panel:last-child{grid-column:auto}}
    @media(max-width:560px){.brq-summary-split{grid-template-columns:1fr}.brq-summary-split>section+section{border-left:0;border-top:1px solid #e2e8f0}}
    @media(max-width:599px){.brq-filters{grid-template-columns:minmax(0,1fr)}}
    @media(max-width:480px){.brq-head{padding:16px}.brq-heading{display:grid}}
  `;
  document.head.appendChild(style);
}

function brqQuery(filters = brqFilters) {
  const params = new URLSearchParams();
  for (const key of ["date", "society", "wilaya", "client", "site", "fonction", "vacation"]) {
    const value = String(filters[key] || "").trim();
    if (value) params.set(key, value);
  }
  return params.toString();
}

function brqCurrentViewName(view) {
  return BRQ_VIEWS[view] ? view : "situation";
}

function brqNavHTML(active) {
  return Object.entries(BRQ_VIEWS).map(([key, item]) =>
    `<a class="brq-tab" href="#/brq${key === "situation" ? "" : `/${key}`}"${key === active ? ' aria-current="page"' : ""}>${brqEscape(item.label)}</a>`
  ).join("");
}

function brqFilterHTML() {
  return `<form class="brq-filters" onsubmit="event.preventDefault();brqApplyFilters(this)">
    <label class="brq-field">Date<input type="date" name="date" value="${brqEscape(brqFilters.date)}"></label>
    <label class="brq-field">Société<input name="society" maxlength="180" value="${brqEscape(brqFilters.society)}" placeholder="Toutes les sociétés"></label>
    <label class="brq-field">Wilaya<input name="wilaya" maxlength="120" value="${brqEscape(brqFilters.wilaya)}" placeholder="Toutes les wilayas"></label>
    <label class="brq-field">Client<input name="client" maxlength="180" value="${brqEscape(brqFilters.client)}" placeholder="Tous les clients"></label>
    <label class="brq-field">Site<input name="site" maxlength="180" value="${brqEscape(brqFilters.site)}" placeholder="Tous les sites"></label>
    <label class="brq-field">Fonction<input name="fonction" maxlength="150" value="${brqEscape(brqFilters.fonction)}" placeholder="Toutes les fonctions"></label>
    <label class="brq-field">Vacation<input name="vacation" maxlength="120" value="${brqEscape(brqFilters.vacation)}" placeholder="Toutes les vacations"></label>
    <button class="brq-button brq-button--primary" type="submit">Appliquer</button>
  </form>`;
}

function brqFormatState(value) {
  const labels = {
    present: "Présent", presence_hors_planning: "Présence hors planning",
    absent: "Absent", abandon_poste: "Abandon de poste",
    non_pointe: "Non pointé", planning_non_defini: "Planning non défini",
    repos_planifie: "Repos planifié", sortie_effective: "Sortie effective",
    incomplet: "Date de sortie manquante", conge: "Congé", maladie: "Maladie",
    repos: "Repos", mission: "Mission",
  };
  const key = String(value || "");
  return labels[key] || key.replaceAll("_", " ");
}

function brqRowsHTML(items) {
  if (!items.length) return `<tr><td colspan="9"><div class="brq-empty">Aucune donnée pour ces filtres.</div></td></tr>`;
  return items.map(item => {
    const planning = item.planning || {};
    const state = String(item.state || "");
    const departure = item.abandon?.actual_departure_at || item.departure || "";
    return `<tr>
      <td><strong>${brqEscape(item.nom || "—")}</strong><br><span>${brqEscape(item.matricule || "—")}</span></td>
      <td>${brqEscape(item.society || "—")}</td>
      <td>${brqEscape(item.site || "—")}<br><span>${brqEscape(item.wilaya || "")}</span></td>
      <td>${brqEscape(item.fonction || "—")}</td>
      <td><span class="brq-state brq-state--${brqEscape(state)}">${brqEscape(brqFormatState(state))}</span></td>
      <td>${item.available == null ? "—" : item.available ? "Disponible" : "Indisponible"}</td>
      <td>${brqEscape(planning.start_time || "—")} – ${brqEscape(planning.end_time || "—")}</td>
      <td>${brqEscape(item.arrival || "—")}</td>
      <td>${brqEscape(departure || "—")}</td>
    </tr>`;
  }).join("");
}

function brqKpisHTML(kpis = {}) {
  const labels = [
    ["effectif_prevu", "Effectif prévu"],
    ["presents", "Présents"],
    ["absents", "Absents"],
    ["abandons_poste", "Abandons de poste"],
    ["sortants", "Sortants"],
    ["couverture_pct", "Taux de couverture"],
    ["ecart", "Écart effectif"],
  ];
  return `<div class="brq-kpis">${labels.map(([key, label]) =>
    `<div class="brq-kpi"><span>${brqEscape(label)}</span><strong>${kpis[key] == null ? "—" : brqEscape(key === "couverture_pct" ? `${kpis[key]} %` : kpis[key])}${key === "couverture_pct" && kpis.effectif_disponible != null ? `<small>${brqEscape(kpis.effectif_disponible)} disponible(s) / ${brqEscape(kpis.effectif_prevu)} prévu(s)</small>` : ""}</strong></div>`
  ).join("")}</div>`;
}

function brqMiniRowsHTML(items, emptyMessage) {
  if (!items.length) return `<tr><td colspan="5"><div class="brq-empty">${brqEscape(emptyMessage)}</div></td></tr>`;
  return items.map(item => {
    const planning = item.planning || {};
    const sortie = item.date_sortie ? new Date(`${item.date_sortie}T00:00:00`).toLocaleDateString("fr-FR") : "";
    return `<tr>
      <td><strong>${brqEscape(item.nom || "—")}</strong><br><span>${brqEscape(item.matricule || "—")}</span></td>
      <td>${brqEscape(item.site || "—")}${item.wilaya ? `<br><span>${brqEscape(item.wilaya)}</span>` : ""}</td>
      <td>${brqEscape(item.fonction || "—")}</td>
      <td>${brqEscape(item.state ? brqFormatState(item.state) : "—")}</td>
      <td>${brqEscape(item.abandon?.actual_departure_at || sortie || [planning.start_time, planning.end_time].filter(Boolean).join(" – ") || "—")}</td>
    </tr>`;
  }).join("");
}

function brqMiniTable(items, emptyMessage) {
  return `<div class="brq-mini-table-wrap"><table class="brq-mini-table">
    <thead><tr><th>Employé</th><th>Site</th><th>Fonction</th><th>État</th><th>Vacation / date</th></tr></thead>
    <tbody>${brqMiniRowsHTML(items, emptyMessage)}</tbody>
  </table></div>`;
}

function brqSituationSectionsHTML(data) {
  const breakdown = Array.isArray(data.site_function) ? data.site_function : [];
  const absences = Array.isArray(data.absence_items) ? data.absence_items : [];
  const abandons = Array.isArray(data.abandon_items) ? data.abandon_items : [];
  const sortants = Array.isArray(data.sortant_items) ? data.sortant_items : [];
  const breakdownRows = breakdown.length ? breakdown.map(item => `<tr>
    <td><strong>${brqEscape(item.site || "—")}</strong>${item.wilaya ? `<br><span>${brqEscape(item.wilaya)}</span>` : ""}</td>
    <td>${brqEscape(item.fonction || "—")}</td>
    <td>${brqEscape(item.effectif_prevu ?? 0)}</td>
    <td>${brqEscape(item.presents ?? 0)}</td>
    <td>${brqEscape(item.absents ?? 0)}</td>
    <td>${brqEscape(item.abandons_poste ?? 0)}</td>
    <td>${brqEscape(item.effectif_disponible ?? 0)}</td>
  </tr>`).join("") : `<tr><td colspan="7"><div class="brq-empty">Aucune donnée pour ces filtres.</div></td></tr>`;
  return `<div class="brq-summary-grid">
    <section class="brq-panel">
      <div class="brq-panel-head"><h2>Répartition par site et fonction</h2><span>${breakdown.length} groupe(s)</span></div>
      <div class="brq-mini-table-wrap"><table class="brq-mini-table"><thead><tr><th>Site / Wilaya</th><th>Fonction</th><th>Prévu</th><th>Présents</th><th>Absents</th><th>Abandons</th><th>Disponibles</th></tr></thead><tbody>${breakdownRows}</tbody></table></div>
    </section>
    <section class="brq-panel">
      <div class="brq-panel-head"><h2>Absences / Abandons</h2></div>
      <div class="brq-summary-split">
        <section><div class="brq-panel-head"><h2>Absences</h2><span>${absences.length}</span></div>${brqMiniTable(absences, "Aucune absence pour ces filtres.")}</section>
        <section><div class="brq-panel-head"><h2>Abandons de poste</h2><span>${abandons.length}</span></div>${brqMiniTable(abandons, "Aucun abandon pour ces filtres.")}</section>
      </div>
    </section>
    <section class="brq-panel">
      <div class="brq-panel-head"><h2>Sortants</h2><span>${sortants.length} ligne(s)</span></div>
      ${brqMiniTable(sortants, "Aucun sortant pour ces filtres.")}
    </section>
  </div>`;
}

function brqPageShellHTML(view) {
  const config = BRQ_VIEWS[view];
  return `<div class="brq-page" data-brq-shell="1">
    <section class="brq-head">
      <div class="brq-heading"><div><h1 data-brq-title>${brqEscape(config.label)}</h1><p>Rapport en lecture seule · Données issues des modules RH, OPS et Pointage.</p></div>
      </div>
      <nav class="brq-tabs" data-brq-tabs aria-label="Rubriques BRQ">${brqNavHTML(view)}</nav>
      ${brqFilterHTML()}
    </section>
    <div class="brq-results" data-brq-results aria-live="polite" aria-busy="true"></div>
  </div>`;
}

function brqResultsHTML(view, data) {
  const config = BRQ_VIEWS[view];
  const items = Array.isArray(data.items) ? data.items : [];
  const kpis = view === "situation" ? brqKpisHTML(data.kpis) : "";
  const notes = view === "situation" && Array.isArray(data.notes)
    ? `<p class="brq-empty">${data.notes.map(brqEscape).join("<br>")}</p>` : "";
  return `${kpis}
    ${view === "situation" ? brqSituationSectionsHTML(data) : ""}
    <section class="brq-panel">
      <div class="brq-panel-head"><h2>${brqEscape(config.label)}</h2><span>${brqEscape(data.total ?? items.length)} ligne(s) · ${brqEscape(data.date || brqFilters.date)}</span></div>
      <div class="brq-table-wrap"><table class="brq-table"><thead><tr>
        <th>Employé</th><th>Société</th><th>Site / Wilaya</th><th>Fonction</th><th>État</th><th>Disponibilité</th><th>Vacation</th><th>Arrivée</th><th>Départ</th>
      </tr></thead><tbody>${brqRowsHTML(items)}</tbody></table></div>
    </section>${notes}
  `;
}

function brqEnsurePageShell(viewElement, view) {
  let shell = viewElement.querySelector('[data-brq-shell="1"]');
  if (!shell) {
    viewElement.innerHTML = brqPageShellHTML(view);
    shell = viewElement.querySelector('[data-brq-shell="1"]');
    return shell;
  }
  shell.querySelector("[data-brq-title]").textContent = BRQ_VIEWS[view].label;
  shell.querySelector("[data-brq-tabs]").innerHTML = brqNavHTML(view);
  return shell;
}

function brqApplyFilters(form) {
  brqFilters = {
    date: form.elements.date.value || brqDefaultDate(),
    society: form.elements.society.value.trim(),
    wilaya: form.elements.wilaya.value.trim(),
    client: form.elements.client.value.trim(),
    site: form.elements.site.value.trim(),
    fonction: form.elements.fonction.value.trim(),
    vacation: form.elements.vacation.value.trim(),
  };
  brqFilterGeneration += 1;
  if (typeof renderView === "function") renderView();
}

function brqRetry() {
  brqActiveRequest = null;
  if (typeof renderView === "function") renderView();
}

async function renderBrqPage(viewElement, requestedView = "situation") {
  brqEnsureStyles();
  const view = brqCurrentViewName(requestedView);
  if (!brqFilters.date) brqFilters.date = brqDefaultDate();
  const generation = ++brqRequestGeneration;
  const shell = brqEnsurePageShell(viewElement, view);
  const results = shell.querySelector("[data-brq-results]");
  results.classList.add("brq-results--loading");
  results.setAttribute("aria-busy", "true");
  results.innerHTML = `<div class="brq-loading" role="status">Chargement des données BRQ…</div>`;
  try {
    if (!window.SGDI_API || typeof window.SGDI_API.request !== "function") {
      throw new Error("Le client API central n'est pas disponible.");
    }
    const query = brqQuery();
    const navigation = typeof sgdiViewRenderGeneration === "number"
      ? sgdiViewRenderGeneration
      : String(location.hash || "");
    const key = `${navigation}|${location.hash}|${view}|${query}|${brqFilterGeneration}`;
    if (!brqActiveRequest || brqActiveRequest.key !== key) {
      brqActiveRequest?.controller.abort();
      const controller = new AbortController();
      const request = {
        key,
        controller,
        promise: window.SGDI_API.request(
          `/api/brq/${BRQ_VIEWS[view].endpoint}${query ? `?${query}` : ""}`,
          { method: "GET", signal: controller.signal },
        ),
        data: undefined,
        error: undefined,
        settled: false,
      };
      brqActiveRequest = request;
      request.promise.then(
        data => { request.data = data; request.settled = true; },
        error => { request.error = error; request.settled = true; },
      );
    }
    const request = brqActiveRequest;
    let data;
    if (request.settled) {
      if (request.error) throw request.error;
      data = request.data;
    } else {
      data = await request.promise;
    }
    if (generation !== brqRequestGeneration || !viewElement.isConnected) return;
    results.innerHTML = brqResultsHTML(view, data || {});
    results.classList.remove("brq-results--loading");
    results.setAttribute("aria-busy", "false");
  } catch (error) {
    if (generation !== brqRequestGeneration || !viewElement.isConnected) return;
    const message = error?.message || String(error);
    results.classList.remove("brq-results--loading");
    results.setAttribute("aria-busy", "false");
    results.innerHTML = `<section class="brq-panel"><div class="brq-error" role="alert">Chargement impossible : ${brqEscape(message)}<br><button type="button" class="brq-button" onclick="brqRetry()">Réessayer</button></div></section>`;
  }
}

window.SGDIModules.registerModule({
  key: "brq",
  routes: ["brq"],
  init() {
    if (!brqFilters.society && typeof session !== "undefined" && session?.societe) {
      brqFilters.society = String(session.societe);
    }
    brqFilters.date = brqFilters.date || brqDefaultDate();
  },
  destroy() {
    brqRequestGeneration += 1;
    brqActiveRequest?.controller.abort();
    brqActiveRequest = null;
  },
});
