// ATLAS V3 — modules-v3/drh/discipline.mjs
//
// Adapté depuis employee-dossier.mjs DRH Next (sectionSanctions/wireSanctionsSection),
// déjà audité (LOT 7). Audit backend (SanctionBase) : AUCUN champ "status", ni modèle
// incident/convocation/commission/décision — un SEUL enregistrement plat (date, motif,
// type, jours de suspension, site, reprise). La mission décrit un processus plus riche qui
// N'EXISTE PAS dans ce schéma : le fabriquer serait inventer un workflow métier que le
// backend ne modélise pas — interdit. Reste fidèle aux seuls champs réels : liste +
// création, rien de plus. GET /drh/sanctions?employee_id=X, jamais appelé au chargement du
// dossier ni depuis l'annuaire — paresseux par onglet, seule protection nécessaire (§12).
import { api } from "../../core-v3/api.mjs";
import { loadData, invalidate } from "../../core-v3/data-loader.mjs";
import { escapeHTML, emptyStateHTML } from "../../core-v3/ui.mjs";

export async function render(e) {
  const rows = await loadData(`drh:employee:${e.id}:sanctions`, (signal) => api.get(`/drh/sanctions?employee_id=${encodeURIComponent(e.id)}`, { signal }), { ttlMs: 10000 });
  const list = Array.isArray(rows) ? rows : [];
  const table = list.length
    ? `<table class="dn-table"><thead><tr><th>Date</th><th>Motif</th><th>Type</th><th>Suspension (j)</th><th>Site</th></tr></thead><tbody>
        ${list.map(s => `<tr><td>${escapeHTML(s.infraction_date || "—")}</td><td>${escapeHTML(s.fault || "—")}</td><td>${escapeHTML(s.sanction_type || "—")}</td><td>${escapeHTML(s.suspension_days ?? "—")}</td><td>${escapeHTML(s.site_name || "—")}</td></tr>`).join("")}
      </tbody></table>`
    : emptyStateHTML("Aucune sanction enregistrée.");
  return `${table}
    <div style="margin-top:14px">
      <button type="button" class="dn-btn dn-btn-primary" id="dn-sanction-new-toggle">+ Nouvelle sanction</button>
      <form id="dn-sanction-new-form" hidden style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div><label for="dn-sanction-date" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Date infraction</label><input class="dn-input" id="dn-sanction-date" type="date" name="infraction_date" required></div>
        <div style="flex:1;min-width:180px"><label for="dn-sanction-fault" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Motif</label><input class="dn-input" id="dn-sanction-fault" name="fault" required></div>
        <div><label for="dn-sanction-type" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Type</label><input class="dn-input" id="dn-sanction-type" name="sanction_type" required style="width:160px"></div>
        <div><label for="dn-sanction-days" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Suspension (j)</label><input class="dn-input" id="dn-sanction-days" type="number" min="0" name="suspension_days" style="width:110px"></div>
        <button type="submit" class="dn-btn dn-btn-primary">Enregistrer</button>
        <span id="dn-sanction-new-error" class="dn-error-state-text" style="margin:0"></span>
      </form>
    </div>`;
}

export function wire(employee, onRefresh) {
  const toggle = document.querySelector("#dn-sanction-new-toggle");
  const form = document.querySelector("#dn-sanction-new-form");
  toggle?.addEventListener("click", () => { form.hidden = !form.hidden; });
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const errEl = document.querySelector("#dn-sanction-new-error");
    if (errEl) errEl.textContent = "";
    try {
      await api.post("/drh/sanctions", {
        employee_id: employee.id,
        infraction_date: fd.get("infraction_date"),
        fault: fd.get("fault"),
        sanction_type: fd.get("sanction_type"),
        suspension_days: fd.get("suspension_days") ? Number(fd.get("suspension_days")) : 0,
      });
      invalidate(`drh:employee:${employee.id}:sanctions`);
      onRefresh();
    } catch (err) {
      if (errEl) errEl.textContent = err?.message || "Enregistrement impossible.";
    }
  });
}
