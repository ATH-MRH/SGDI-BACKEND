// ATLAS V3 — modules-v3/drh/leaves.mjs
//
// Adapté depuis employee-dossier.mjs DRH Next (sectionLeaves/wireLeavesSection/decideLeave),
// déjà audité (LOT 6/11A) — logique et garde-fous inchangés. Approve/refuse SANS condition
// frontend supplémentaire (aucune vérification authorized_actions n'existe côté backend pour
// ces deux routes au-delà du scope société/employé déjà garanti) — ajouter une condition ici
// fabriquerait une distinction de permission que le backend n'applique pas réellement.
import { api } from "../../core-v3/api.mjs";
import { loadData, invalidate } from "../../core-v3/data-loader.mjs";
import { escapeHTML, emptyStateHTML } from "../../core-v3/ui.mjs";

function leaveStatusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "approuve") return `<span class="dn-badge dn-badge-success">Approuvé</span>`;
  if (s === "refuse") return `<span class="dn-badge dn-badge-danger">Refusé</span>`;
  if (s === "instance") return `<span class="dn-badge dn-badge-warning">En attente</span>`;
  return `<span class="dn-badge">${escapeHTML(status || "—")}</span>`;
}

export async function render(e) {
  const rows = await loadData(`drh:employee:${e.id}:leaves`, (signal) => api.get(`/drh/leaves?employee_id=${encodeURIComponent(e.id)}`, { signal }), { ttlMs: 10000 });
  const list = Array.isArray(rows) ? rows : [];
  const table = list.length
    ? `<table class="dn-table"><thead><tr><th>Type</th><th>Début</th><th>Fin</th><th>Statut</th><th></th></tr></thead><tbody>
        ${list.map(l => `<tr data-dn-leave-row="${l.id}"><td>${escapeHTML(l.leave_type || "—")}</td><td>${escapeHTML(l.start_date || "—")}</td><td>${escapeHTML(l.end_date || "—")}</td><td>${leaveStatusBadge(l.status)}</td>
          <td>${String(l.status || "").toLowerCase() === "instance" ? `<button type="button" class="dn-btn" data-dn-leave-approve="${l.id}">Approuver</button> <button type="button" class="dn-btn" data-dn-leave-refuse="${l.id}">Refuser</button> <span class="dn-error-state-text" data-dn-leave-error="${l.id}" style="margin:0"></span>` : ""}</td></tr>`).join("")}
      </tbody></table>`
    : emptyStateHTML("Aucun congé/absence enregistré.");
  return `${table}
    <div style="margin-top:14px">
      <button type="button" class="dn-btn dn-btn-primary" id="dn-leave-new-toggle">+ Nouvelle demande</button>
      <form id="dn-leave-new-form" hidden style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div><label for="dn-leave-type" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Type</label><input class="dn-input" id="dn-leave-type" name="leave_type" required style="width:160px"></div>
        <div><label for="dn-leave-start" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Début</label><input class="dn-input" id="dn-leave-start" type="date" name="start_date" required></div>
        <div><label for="dn-leave-end" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Fin</label><input class="dn-input" id="dn-leave-end" type="date" name="end_date" required></div>
        <div style="flex:1;min-width:180px"><label for="dn-leave-reason" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Motif</label><input class="dn-input" id="dn-leave-reason" name="reason"></div>
        <button type="submit" class="dn-btn dn-btn-primary">Enregistrer</button>
        <span id="dn-leave-new-error" class="dn-error-state-text" style="margin:0"></span>
      </form>
    </div>`;
}

export function wire(employee, onRefresh) {
  const toggle = document.querySelector("#dn-leave-new-toggle");
  const form = document.querySelector("#dn-leave-new-form");
  toggle?.addEventListener("click", () => { form.hidden = !form.hidden; });
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const errEl = document.querySelector("#dn-leave-new-error");
    if (errEl) errEl.textContent = "";
    try {
      await api.post("/drh/leaves", {
        employee_id: employee.id,
        leave_type: fd.get("leave_type"),
        start_date: fd.get("start_date"),
        end_date: fd.get("end_date"),
        reason: fd.get("reason") || null,
      });
      invalidate(`drh:employee:${employee.id}:leaves`);
      onRefresh();
    } catch (err) {
      if (errEl) errEl.textContent = err?.message || "Enregistrement impossible.";
    }
  });
  document.querySelectorAll("[data-dn-leave-approve]").forEach(btn => {
    btn.addEventListener("click", () => decideLeave(employee, btn.getAttribute("data-dn-leave-approve"), "approve", onRefresh));
  });
  document.querySelectorAll("[data-dn-leave-refuse]").forEach(btn => {
    btn.addEventListener("click", () => decideLeave(employee, btn.getAttribute("data-dn-leave-refuse"), "refuse", onRefresh));
  });
}

async function decideLeave(employee, leaveId, action, onRefresh) {
  const row = document.querySelector(`[data-dn-leave-row="${leaveId}"]`);
  const errEl = row?.querySelector(`[data-dn-leave-error="${leaveId}"]`);
  if (errEl) errEl.textContent = "";
  row?.querySelectorAll("button").forEach(b => b.setAttribute("disabled", "disabled"));
  try {
    await api.post(`/drh/leaves/${encodeURIComponent(leaveId)}/${action}`);
    invalidate(`drh:employee:${employee.id}:leaves`);
    onRefresh();
  } catch (err) {
    row?.querySelectorAll("button").forEach(b => b.removeAttribute("disabled"));
    if (errEl) errEl.textContent = err?.code === "FORBIDDEN" ? "Permission de validation requise." : (err?.message || "Action impossible.");
  }
}
