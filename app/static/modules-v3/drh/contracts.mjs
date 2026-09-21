// ATLAS V3 — modules-v3/drh/contracts.mjs
//
// Adapté depuis app/static/drh-next/modules/employee-dossier.mjs (sections
// sectionContracts/wireContractsSection/endContract/contractStatusBadge), déjà audité et
// testé (LOT 4/11B) — logique métier et garde-fous INCHANGÉS, seuls les imports pointent
// désormais vers core-v3. Aucune règle contractuelle recalculée côté client (préavis,
// reconduction...) : seules les deux actions que le backend expose réellement (créer, fin
// de contrat). GET /drh/contracts?employee_id=X, jamais la collection complète.
import { api } from "../../core-v3/api.mjs";
import { loadData, invalidate } from "../../core-v3/data-loader.mjs";
import { escapeHTML, emptyStateHTML } from "../../core-v3/ui.mjs";

function contractStatusBadge(c) {
  const status = String(c.status || "").toLowerCase();
  if (status === "actif" && c.end_date && c.end_date < new Date().toISOString().slice(0, 10)) {
    return `<span class="dn-badge dn-badge-danger">Expiré</span>`;
  }
  if (status === "actif") return `<span class="dn-badge dn-badge-success">Actif</span>`;
  return `<span class="dn-badge">${escapeHTML(c.status || "—")}</span>`;
}

export async function render(e) {
  const rows = await loadData(`drh:employee:${e.id}:contracts`, (signal) => api.get(`/drh/contracts?employee_id=${encodeURIComponent(e.id)}`, { signal }), { ttlMs: 10000 });
  const list = Array.isArray(rows) ? rows : [];
  const table = list.length
    ? `<table class="dn-table"><thead><tr><th>Type</th><th>Poste</th><th>Début</th><th>Fin</th><th>Statut</th><th></th></tr></thead><tbody>
        ${list.map(c => `<tr data-dn-contract-row="${c.id}"><td>${escapeHTML(c.contract_type || "—")}</td><td>${escapeHTML(c.position || "—")}</td><td>${escapeHTML(c.start_date || "—")}</td><td>${escapeHTML(c.end_date || "—")}</td><td>${contractStatusBadge(c)}</td>
          <td>${String(c.status || "").toLowerCase() === "actif" ? `<button type="button" class="dn-btn" data-dn-contract-end="${c.id}">Terminer</button> <span class="dn-error-state-text" data-dn-contract-error="${c.id}" style="margin:0"></span>` : ""}</td></tr>`).join("")}
      </tbody></table>`
    : emptyStateHTML("Aucun contrat enregistré.");
  return `${table}
    <div style="margin-top:14px">
      <button type="button" class="dn-btn dn-btn-primary" id="dn-contract-new-toggle">+ Nouveau contrat</button>
      <form id="dn-contract-new-form" hidden style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div><label for="dn-contract-type" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Type</label><input class="dn-input" id="dn-contract-type" name="contract_type" required style="width:140px"></div>
        <div><label for="dn-contract-position" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Poste</label><input class="dn-input" id="dn-contract-position" name="position" style="width:160px"></div>
        <div><label for="dn-contract-start" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Début</label><input class="dn-input" id="dn-contract-start" type="date" name="start_date" required></div>
        <button type="submit" class="dn-btn dn-btn-primary">Enregistrer</button>
        <span id="dn-contract-new-error" class="dn-error-state-text" style="margin:0"></span>
      </form>
    </div>`;
}

export function wire(employee, onRefresh) {
  const toggle = document.querySelector("#dn-contract-new-toggle");
  const form = document.querySelector("#dn-contract-new-form");
  toggle?.addEventListener("click", () => { form.hidden = !form.hidden; });
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const errEl = document.querySelector("#dn-contract-new-error");
    if (errEl) errEl.textContent = "";
    try {
      await api.post("/drh/contracts", {
        employee_id: employee.id,
        contract_type: fd.get("contract_type"),
        position: fd.get("position") || null,
        start_date: fd.get("start_date"),
      });
      invalidate(`drh:employee:${employee.id}:contracts`);
      onRefresh();
    } catch (err) {
      if (errEl) errEl.textContent = err?.message || "Enregistrement impossible.";
    }
  });
  document.querySelectorAll("[data-dn-contract-end]").forEach(btn => {
    btn.addEventListener("click", () => endContract(employee, btn.getAttribute("data-dn-contract-end"), onRefresh));
  });
}

async function endContract(employee, contractId, onRefresh) {
  const row = document.querySelector(`[data-dn-contract-row="${contractId}"]`);
  const errEl = row?.querySelector(`[data-dn-contract-error="${contractId}"]`);
  if (errEl) errEl.textContent = "";
  row?.querySelectorAll("button").forEach(b => b.setAttribute("disabled", "disabled"));
  try {
    await api.put(`/drh/contracts/${encodeURIComponent(contractId)}`, {
      end_date: new Date().toISOString().slice(0, 10),
      status: "termine",
    });
    invalidate(`drh:employee:${employee.id}:contracts`);
    onRefresh();
  } catch (err) {
    row?.querySelectorAll("button").forEach(b => b.removeAttribute("disabled"));
    if (errEl) errEl.textContent = err?.code === "FORBIDDEN" ? "Permission requise." : (err?.message || "Action impossible.");
  }
}
