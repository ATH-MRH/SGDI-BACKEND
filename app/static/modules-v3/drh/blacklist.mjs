// ATLAS V3 — modules-v3/drh/blacklist.mjs
//
// Adapté depuis employee-dossier.mjs DRH Next (sectionBlacklist/wireBlacklistSection/
// blacklistBadgeHTML/blacklistStatusBadge), déjà audité (P1 finalisation DRH Next). Décision
// produit préservée : un enregistrement RH réversible (EmployeeBlacklistEntry), pas un simple
// booléen. Le badge d'en-tête réutilise employee.status (déjà chargé, aucun appel
// supplémentaire) — le backend met ce champ en miroir sur "blackliste" à la création d'une
// entrée active (source de vérité unique, jamais dupliquée côté client). L'action reste
// visible seulement si canValidateSensitiveActions() côté frontend — le backend reste SEUL
// juge dans tous les cas (_require_blacklist_action), jamais contourné même en cas d'erreur
// de ce miroir d'affichage. window.confirm() avant toute création/levée (irréversible pour
// l'utilisateur métier). Après levée : jamais de statut deviné côté client (previous_status
// peut ne pas être "actif") — l'employé réel est rechargé via loadEmployeeById.
import { api } from "../../core-v3/api.mjs";
import { loadData, invalidate } from "../../core-v3/data-loader.mjs";
import { escapeHTML, emptyStateHTML } from "../../core-v3/ui.mjs";
import { canValidateSensitiveActions } from "../../core-v3/permissions.mjs";
import { loadEmployeeById } from "./employees.mjs";

export function blacklistBadgeHTML(e) {
  if (String(e.status || "").toLowerCase() !== "blackliste") return "";
  return `<span class="dn-badge dn-badge-danger">BLACKLISTÉ</span>`;
}

function blacklistStatusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "active") return `<span class="dn-badge dn-badge-danger">Active</span>`;
  if (s === "levee") return `<span class="dn-badge dn-badge-success">Levée</span>`;
  return `<span class="dn-badge">${escapeHTML(status || "—")}</span>`;
}

export async function render(e) {
  const rows = await loadData(`drh:employee:${e.id}:blacklist`, (signal) => api.get(`/drh/employees/${encodeURIComponent(e.id)}/blacklist`, { signal }), { ttlMs: 10000 });
  const list = Array.isArray(rows) ? rows : [];
  const activeEntry = list.find(entry => entry.status === "active") || null;
  const table = list.length
    ? `<table class="dn-table"><thead><tr><th>Date</th><th>Motif</th><th>Auteur</th><th>Statut</th><th>Date de levée</th><th>Motif de levée</th></tr></thead><tbody>
        ${list.map(entry => `<tr><td>${escapeHTML((entry.created_at || "").slice(0, 10) || "—")}</td><td>${escapeHTML(entry.reason || "—")}</td><td>${escapeHTML(entry.created_by || "—")}</td><td>${blacklistStatusBadge(entry.status)}</td><td>${escapeHTML((entry.lifted_at || "").slice(0, 10) || "—")}</td><td>${escapeHTML(entry.lift_reason || "—")}</td></tr>`).join("")}
      </tbody></table>`
    : emptyStateHTML("Aucune entrée de blacklist enregistrée.");
  const canAct = canValidateSensitiveActions();
  let actionsHTML = "";
  if (canAct && !activeEntry) {
    actionsHTML = `<div style="margin-top:14px">
      <button type="button" class="dn-btn dn-btn-primary" id="dn-blacklist-new-toggle">Blacklister</button>
      <form id="dn-blacklist-new-form" hidden style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:260px"><label for="dn-blacklist-reason" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Motif (obligatoire)</label><input class="dn-input" id="dn-blacklist-reason" name="reason" required></div>
        <button type="submit" class="dn-btn dn-btn-primary">Confirmer le blacklistage</button>
        <span id="dn-blacklist-new-error" class="dn-error-state-text" style="margin:0"></span>
      </form>
    </div>`;
  } else if (canAct && activeEntry) {
    actionsHTML = `<div style="margin-top:14px">
      <button type="button" class="dn-btn" id="dn-blacklist-lift-toggle">Lever le blacklistage</button>
      <form id="dn-blacklist-lift-form" hidden style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:260px"><label for="dn-blacklist-lift-reason" style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Motif de levée (obligatoire)</label><input class="dn-input" id="dn-blacklist-lift-reason" name="lift_reason" required></div>
        <button type="submit" class="dn-btn dn-btn-primary">Confirmer la levée</button>
        <span id="dn-blacklist-lift-error" class="dn-error-state-text" style="margin:0"></span>
      </form>
    </div>`;
  }
  return `${table}${actionsHTML}`;
}

// onRefresh(updatedEmployee?) : appelé par le shell parent (employee-dossier.mjs) pour
// re-rendre l'en-tête (badge) puis le contenu de cet onglet. Si un employé rafraîchi est
// fourni (cas "levée"), le shell doit l'utiliser à la place de l'ancien objet employee.
export function wire(employee, onRefresh) {
  const newToggle = document.querySelector("#dn-blacklist-new-toggle");
  const newForm = document.querySelector("#dn-blacklist-new-form");
  newToggle?.addEventListener("click", () => { newForm.hidden = !newForm.hidden; });
  newForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const reason = new FormData(newForm).get("reason");
    if (!window.confirm(`Confirmer le blacklistage de ${employee.first_name || ""} ${employee.last_name || ""} ?\nMotif : ${reason}`)) return;
    const errEl = document.querySelector("#dn-blacklist-new-error");
    if (errEl) errEl.textContent = "";
    try {
      await api.post(`/drh/employees/${employee.id}/blacklist`, { reason });
      invalidate(`drh:employee:${employee.id}:blacklist`);
      employee.status = "blackliste"; // reflète immédiatement le badge d'en-tête, sans recharger tout le dossier
      onRefresh();
    } catch (err) {
      if (errEl) errEl.textContent = err?.message || "Action impossible.";
    }
  });

  const liftToggle = document.querySelector("#dn-blacklist-lift-toggle");
  const liftForm = document.querySelector("#dn-blacklist-lift-form");
  liftToggle?.addEventListener("click", () => { liftForm.hidden = !liftForm.hidden; });
  liftForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const liftReason = new FormData(liftForm).get("lift_reason");
    if (!window.confirm(`Confirmer la levée du blacklistage de ${employee.first_name || ""} ${employee.last_name || ""} ?\nMotif de levée : ${liftReason}`)) return;
    const errEl = document.querySelector("#dn-blacklist-lift-error");
    if (errEl) errEl.textContent = "";
    try {
      await api.post(`/drh/employees/${employee.id}/blacklist/lift`, { lift_reason: liftReason });
      invalidate(`drh:employee:${employee.id}:blacklist`);
      // Le statut restauré par le backend n'est pas toujours "actif" (previous_status peut
      // être "suspendu", etc.) : jamais deviné côté client, on recharge l'employé réel.
      invalidate(`drh:employee:${employee.id}`);
      const refreshed = await loadEmployeeById(employee.id);
      Object.assign(employee, refreshed);
      onRefresh();
    } catch (err) {
      if (errEl) errEl.textContent = err?.message || "Action impossible.";
    }
  });
}
