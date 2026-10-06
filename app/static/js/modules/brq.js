/* BRQ V1 — reporting views backed exclusively by the read-only BRQ API. */
let brqRequestGeneration = 0;
let brqFilters = { date: "", society: "", wilaya: "", site_id: "" };

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
    .brq-page{--brq-ink:#10243d;--brq-muted:#64748b;color:var(--brq-ink);display:grid;gap:18px}
    .brq-head,.brq-panel{background:#fff;border:1px solid #dbe4ee;border-radius:16px;box-shadow:0 8px 24px #0f172a0a}
    .brq-head{padding:22px;display:grid;gap:18px}
    .brq-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
    .brq-heading h1{font-size:clamp(22px,3vw,30px);line-height:1.15;margin:0;font-weight:900}
    .brq-heading p{margin:6px 0 0;color:var(--brq-muted);font-size:13px}
    .brq-actions{display:flex;gap:8px;flex-wrap:wrap}
    .brq-button{border:1px solid #cbd5e1;border-radius:9px;padding:9px 13px;background:#fff;color:#173453;font-weight:800;cursor:pointer}
    .brq-button--primary{background:#0f766e;color:#fff;border-color:#0f766e}
    .brq-filters{display:grid;grid-template-columns:repeat(4,minmax(135px,1fr)) auto;gap:10px;align-items:end}
    .brq-field{display:grid;gap:5px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
    .brq-field input{min-width:0;width:100%;height:39px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;color:#10243d;font-size:13px;letter-spacing:normal;text-transform:none}
    .brq-tabs{display:flex;gap:7px;flex-wrap:wrap}
    .brq-tab{border:1px solid #d5dee8;border-radius:999px;padding:8px 12px;background:#f8fafc;color:#475569;font-size:12px;font-weight:850;text-decoration:none}
    .brq-tab[aria-current=page]{background:#0f766e;border-color:#0f766e;color:#fff}
    .brq-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}
    .brq-kpi{border:1px solid #dbe4ee;border-radius:12px;padding:14px;background:linear-gradient(145deg,#fff,#f7fafc)}
    .brq-kpi span{display:block;color:var(--brq-muted);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
    .brq-kpi strong{display:block;margin-top:6px;font-size:23px;font-weight:950}
    .brq-panel{overflow:hidden}
    .brq-panel-head{padding:15px 18px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:12px;align-items:center}
    .brq-panel-head h2{font-size:15px;font-weight:900;margin:0}
    .brq-panel-head span{font-size:12px;color:var(--brq-muted)}
    .brq-table-wrap{overflow:auto}
    .brq-table{width:100%;border-collapse:collapse;min-width:760px;font-size:12px}
    .brq-table th{background:#f8fafc;color:#64748b;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;padding:11px 13px;white-space:nowrap}
    .brq-table td{padding:12px 13px;border-top:1px solid #edf1f5;vertical-align:top}
    .brq-table tr:hover td{background:#fbfdff}
    .brq-state{display:inline-flex;border-radius:999px;background:#eef2f7;padding:4px 8px;font-size:10px;font-weight:900;white-space:nowrap}
    .brq-state--present{background:#dcfce7;color:#166534}.brq-state--absent,.brq-state--abandon_poste{background:#fee2e2;color:#991b1b}
    .brq-empty,.brq-error{padding:28px;text-align:center;color:var(--brq-muted);font-size:13px}
    .brq-error{color:#b91c1c}
    @media(max-width:820px){.brq-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.brq-filters .brq-button{grid-column:span 2}}
    @media(max-width:480px){.brq-head{padding:16px}.brq-filters{grid-template-columns:1fr}.brq-filters .brq-button{grid-column:auto}.brq-heading{display:grid}}
  `;
  document.head.appendChild(style);
}

function brqQuery(filters = brqFilters) {
  const params = new URLSearchParams();
  for (const key of ["date", "society", "wilaya", "site_id"]) {
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
    <label class="brq-field">Site ID<input name="site_id" type="number" min="1" step="1" value="${brqEscape(brqFilters.site_id)}" placeholder="Tous les sites"></label>
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
  if (!items.length) return `<tr><td colspan="8"><div class="brq-empty">Aucune donnée pour ces filtres.</div></td></tr>`;
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
    ["sortants", "Sortants du jour"],
    ["couverture_pct", "Couverture"],
    ["ecart", "Écart"],
  ];
  return `<div class="brq-kpis">${labels.map(([key, label]) =>
    `<div class="brq-kpi"><span>${brqEscape(label)}</span><strong>${kpis[key] == null ? "—" : brqEscape(key === "couverture_pct" ? `${kpis[key]} %` : kpis[key])}</strong></div>`
  ).join("")}</div>`;
}

function brqPageHTML(view, data) {
  const config = BRQ_VIEWS[view];
  const items = Array.isArray(data.items) ? data.items : [];
  const kpis = view === "situation" ? brqKpisHTML(data.kpis) : "";
  const notes = view === "situation" && Array.isArray(data.notes)
    ? `<p class="brq-empty">${data.notes.map(brqEscape).join("<br>")}</p>` : "";
  return `<div class="brq-page">
    <section class="brq-head">
      <div class="brq-heading"><div><h1>${brqEscape(config.label)}</h1><p>Rapport en lecture seule · Données issues des modules RH, OPS et Pointage.</p></div>
        <div class="brq-actions"><button type="button" class="brq-button" onclick="brqExport('${brqEscape(view)}')">Exporter CSV</button></div>
      </div>
      <nav class="brq-tabs" aria-label="Rubriques BRQ">${brqNavHTML(view)}</nav>
      ${brqFilterHTML()}
    </section>
    ${kpis}
    <section class="brq-panel">
      <div class="brq-panel-head"><h2>${brqEscape(config.label)}</h2><span>${brqEscape(data.total ?? items.length)} ligne(s) · ${brqEscape(data.date || brqFilters.date)}</span></div>
      <div class="brq-table-wrap"><table class="brq-table"><thead><tr>
        <th>Employé</th><th>Société</th><th>Site / Wilaya</th><th>Fonction</th><th>État</th><th>Vacation</th><th>Arrivée</th><th>Départ</th>
      </tr></thead><tbody>${brqRowsHTML(items)}</tbody></table></div>
    </section>${notes}
  </div>`;
}

function brqApplyFilters(form) {
  brqFilters = {
    date: form.elements.date.value || brqDefaultDate(),
    society: form.elements.society.value.trim(),
    wilaya: form.elements.wilaya.value.trim(),
    site_id: form.elements.site_id.value.trim(),
  };
  if (typeof renderView === "function") renderView();
}

async function renderBrqPage(viewElement, requestedView = "situation") {
  brqEnsureStyles();
  const view = brqCurrentViewName(requestedView);
  if (!brqFilters.date) brqFilters.date = brqDefaultDate();
  const generation = ++brqRequestGeneration;
  viewElement.innerHTML = `<div class="brq-page"><div class="brq-head"><h1>${brqEscape(BRQ_VIEWS[view].label)}</h1>${brqFilterHTML()}<div class="brq-empty" role="status">Chargement des données BRQ…</div></div></div>`;
  try {
    if (!window.SGDI_API || typeof window.SGDI_API.request !== "function") {
      throw new Error("Le client API central n'est pas disponible.");
    }
    const query = brqQuery();
    const data = await window.SGDI_API.request(`/api/brq/${BRQ_VIEWS[view].endpoint}${query ? `?${query}` : ""}`, { method: "GET" });
    if (generation !== brqRequestGeneration || !viewElement.isConnected) return;
    viewElement.innerHTML = brqPageHTML(view, data || {});
  } catch (error) {
    if (generation !== brqRequestGeneration || !viewElement.isConnected) return;
    const message = error?.message || String(error);
    viewElement.innerHTML = `<div class="brq-page"><div class="brq-head"><h1>${brqEscape(BRQ_VIEWS[view].label)}</h1>${brqFilterHTML()}<div class="brq-error" role="alert">Chargement impossible : ${brqEscape(message)}<br><button type="button" class="brq-button" onclick="renderView()">Réessayer</button></div></div></div>`;
  }
}

async function brqExport(view) {
  const selected = brqCurrentViewName(view);
  try {
    const query = new URLSearchParams({ view: selected });
    const filters = brqQuery();
    if (filters) new URLSearchParams(filters).forEach((value, key) => query.set(key, value));
    const result = await window.SGDI_API.request(`/api/brq/export?${query}`, { method: "GET" });
    const rows = Array.isArray(result?.items) ? result.items : [];
    const columns = ["matricule", "nom", "fonction", "society", "site", "wilaya", "state", "expected", "date_sortie", "arrival", "departure"];
    const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [columns, ...rows.map(row => columns.map(key => row[key]))]
      .map(row => row.map(csvCell).join(";")).join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `brq-${selected}-${brqFilters.date}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    const message = error?.message || String(error);
    if (typeof toast === "function") toast(`Export BRQ impossible : ${message}`, "error");
    else console.error("Export BRQ impossible", error);
  }
}

window.SGDIModules.registerModule({
  key: "brq",
  routes: ["brq"],
  init() {
    brqFilters.date = brqFilters.date || brqDefaultDate();
  },
  destroy() {
    brqRequestGeneration += 1;
  },
});
