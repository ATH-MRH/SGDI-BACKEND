// ATLAS V3 — modules-v3/drh/attendance.mjs
//
// Adapté depuis employee-dossier.mjs DRH Next (sectionAssignmentHistory/sectionAttendance/
// sectionEquipment), déjà audité (LOT 11B — dette DRH-NEXT-ASSIGNMENT-HISTORY fermée). Trois
// vues composées read-only, sources canoniques ops/materiel interrogées côté serveur,
// JAMAIS dupliquées ni réécrites depuis DRH : GET /drh/employees/{id}/assignments-history
// (historique), GET /drh/employees/{id}/attendance (pointage, source ops/DailyPresence),
// GET /drh/employees/{id}/equipment (matériel, source materiel/EmployeeEquipment). Bornées
// côté serveur (30 dernières entrées) — pas de "voir plus" ici, cohérent avec "consultation".
// §12 de la mission : lecture seule RH, aucune recréation du Pointeur, aucun pointage global.
import { api } from "../../core-v3/api.mjs";
import { loadData } from "../../core-v3/data-loader.mjs";
import { escapeHTML, emptyStateHTML } from "../../core-v3/ui.mjs";

export async function renderHistorique(e) {
  const rows = await loadData(`drh:employee:${e.id}:assignments-history`, (signal) => api.get(`/drh/employees/${encodeURIComponent(e.id)}/assignments-history`, { signal }), { ttlMs: 10000 });
  if (!Array.isArray(rows) || !rows.length) return emptyStateHTML("Aucun historique d'affectation enregistré.");
  return `<table class="dn-table"><thead><tr><th>Site</th><th>Groupe</th><th>Poste</th><th>Début</th><th>Fin</th><th>Statut</th></tr></thead><tbody>
    ${rows.map(a => `<tr><td>${escapeHTML(a.site_name || "—")}</td><td>${escapeHTML(a.group_code || "—")}</td><td>${escapeHTML(a.position || "—")}</td><td>${escapeHTML(a.start_date || "—")}</td><td>${escapeHTML(a.end_date || "—")}</td><td>${a.active ? `<span class="dn-badge dn-badge-success">Active</span>` : `<span class="dn-badge">Terminée</span>`}</td></tr>`).join("")}
  </tbody></table>`;
}

export async function renderPointage(e) {
  const rows = await loadData(`drh:employee:${e.id}:attendance`, (signal) => api.get(`/drh/employees/${encodeURIComponent(e.id)}/attendance`, { signal }), { ttlMs: 10000 });
  if (!Array.isArray(rows) || !rows.length) return emptyStateHTML("Aucun pointage enregistré.");
  return `<table class="dn-table"><thead><tr><th>Date</th><th>Site</th><th>Statut</th><th>Arrivée</th><th>Départ</th></tr></thead><tbody>
    ${rows.map(p => `<tr><td>${escapeHTML(p.presence_date || "—")}</td><td>${escapeHTML(p.site_name || "—")}</td><td><span class="dn-badge">${escapeHTML(p.status || "—")}</span></td><td>${escapeHTML(p.arrival_time || "—")}</td><td>${escapeHTML(p.departure_time || "—")}</td></tr>`).join("")}
  </tbody></table>`;
}

export async function renderMateriel(e) {
  const rows = await loadData(`drh:employee:${e.id}:equipment`, (signal) => api.get(`/drh/employees/${encodeURIComponent(e.id)}/equipment`, { signal }), { ttlMs: 10000 });
  if (!Array.isArray(rows) || !rows.length) return emptyStateHTML("Aucun matériel attribué enregistré.");
  return `<table class="dn-table"><thead><tr><th>Article</th><th>Qté</th><th>État</th><th>Attribué le</th><th>Restitué le</th><th>Statut</th></tr></thead><tbody>
    ${rows.map(eq => `<tr><td>${escapeHTML(eq.article_designation || "—")}</td><td>${escapeHTML(eq.quantity ?? "—")}</td><td>${escapeHTML(eq.item_state || "—")}</td><td>${escapeHTML(eq.dotation_date || "—")}</td><td>${escapeHTML(eq.return_date || "—")}</td><td><span class="dn-badge">${escapeHTML(eq.status || "—")}</span></td></tr>`).join("")}
  </tbody></table>`;
}
