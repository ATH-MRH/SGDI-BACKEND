// ATLAS V3 — modules-v3/drh/dashboard.mjs
//
// Tableau de bord DRH (§6 de la mission), adapté depuis app/static/drh-next/modules/
// dashboard.mjs (LOT 9/10, déjà audité) — logique et garde-fous INCHANGÉS, reskinné avec les
// classes CSS Legacy (dash-kpi/dash-panel, comme modules-v3/dashboard/index.mjs) plutôt que
// dn-kpi/dn-panel, pour rester visuellement familier (§5). Source unique : GET /drh/dashboard
// (service.dashboard, endpoint pré-existant déjà audité) — renvoie des compteurs déjà agrégés
// côté serveur (employees_total, employees_by_status, candidates_by_status, leaves_pending,
// trial_periods) et JAMAIS les fiches employé elles-mêmes. Aucun appel à /api/drh/employees ni
// /api/drh/employees?light=1 (§21, critère réseau absolu).
//
// Panneaux demandés par la mission mais VOLONTAIREMENT NON CONSTRUITS, faute de capacité
// backend réelle (dette DRH-NEXT-DASHBOARD-AGGREGATES, non résolue par ce lot, préservée
// telle quelle) : entrées/sorties par période, contrats à échéance (hors période d'essai),
// absences agrégées, alertes RH, répartition société/site. Un compteur reconstruit côté
// client à partir d'un échantillon paginé serait un chiffre fabriqué, pas une mesure réelle
// — état honnête différé plutôt que ce raccourci (§6 de la mission).
import { api } from "../../core-v3/api.mjs";
import { loadData, invalidate } from "../../core-v3/data-loader.mjs";
import { captureRaceContext, isStillValid } from "../../core-v3/race-guard.mjs";
import { escapeHTML, skeletonHTML, errorStateHTML, emptyStateHTML } from "../../core-v3/ui.mjs";
import { time as recordTiming } from "../../core-v3/telemetry.mjs";

const CACHE_KEY = "drh:dashboard";
let root = null;

export function invalidateDrhDashboard() { invalidate(CACHE_KEY); }

function kpiCardHTML(label, value, sub) {
  return `<div class="dash-kpi">
    <div class="flex items-center justify-between"><div class="label">${escapeHTML(label)}</div></div>
    <div class="value">${escapeHTML(value ?? "…")}</div>
    <div class="sub">${escapeHTML(sub || "")}</div>
  </div>`;
}

function statusLabel(key) {
  const known = { actif: "Actif", absent: "Absent", suspendu: "Suspendu", sortant: "Sortant", non_defini: "Non défini", nouvelle: "Nouvelle", a_contractualiser: "À contractualiser", refuse: "Refusée", recrute: "Recrutée" };
  return known[key] || key;
}

function breakdownHTML(title, byStatus) {
  const entries = Object.entries(byStatus || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return `<section class="dash-panel">
    <div class="dash-panel-head"><div class="dash-panel-title">${escapeHTML(title)}</div></div>
    <div class="dash-panel-body" style="display:flex;gap:8px;flex-wrap:wrap">
      ${entries.length ? entries.map(([key, n]) => `<span class="dn-badge">${escapeHTML(statusLabel(key))} · ${escapeHTML(n)}</span>`).join("") : emptyStateHTML("Aucune donnée.")}
    </div>
  </section>`;
}

function renderReady(data) {
  if (!root) return;
  const actifs = data?.employees_by_status?.actif || 0;
  const total = data?.employees_total || 0;
  const candidatsTotal = Object.values(data?.candidates_by_status || {}).reduce((a, b) => a + b, 0);
  // trial_periods (service.dashboard) liste TOUT employé actif ayant une trial_end_date
  // renseignée, SANS filtre de date (ni "à venir" ni "en cours" au sens strict) — le libellé
  // n'affirme donc aucune imminence que le backend ne garantit pas.
  const trialList = (data?.trial_periods || []).slice(0, 8);
  const trialCount = (data?.trial_periods || []).length;

  root.innerHTML = `<div class="dash-shell">
    <section class="dash-kpi-grid">
      ${kpiCardHTML("Effectif actif", actifs, `${total} au total`)}
      ${kpiCardHTML("Congés en attente", data?.leaves_pending || 0, "à valider ou refuser")}
      ${kpiCardHTML("Candidats en cours", candidatsTotal, "toutes phases confondues")}
      ${kpiCardHTML("Fins de période d'essai enregistrées", trialCount, "employés actifs concernés")}
    </section>
    ${breakdownHTML("Répartition des employés par statut", data?.employees_by_status)}
    ${breakdownHTML("Répartition des candidats par statut", data?.candidates_by_status)}
    <section class="dash-panel">
      <div class="dash-panel-head"><div class="dash-panel-title">Employés actifs avec une date de fin de période d'essai enregistrée</div></div>
      <div class="dash-panel-body">${trialList.length ? `<table class="dn-table"><thead><tr><th>Code</th><th>Nom</th><th>Fin d'essai</th></tr></thead><tbody>
        ${trialList.map(e => `<tr><td>${escapeHTML(e.code)}</td><td>${escapeHTML(e.name)}</td><td>${escapeHTML(e.trial_end_date || "—")}</td></tr>`).join("")}
      </tbody></table>` : emptyStateHTML("Aucun employé actif n'a de date de fin de période d'essai enregistrée.")}</div>
    </section>
  </div>`;
}

async function render() {
  if (!root) return;
  root.innerHTML = skeletonHTML("cards");
  const raceCtx = captureRaceContext();
  try {
    const data = await recordTiming("api", "/drh/dashboard", () => loadData(CACHE_KEY, (signal) => api.get("/drh/dashboard", { signal }), { ttlMs: 15000 }));
    if (!root || !isStillValid(raceCtx)) return; // navigation ou session a changé pendant l'attente
    await recordTiming("render", "drh-dashboard", async () => renderReady(data));
  } catch (err) {
    if (!root || !isStillValid(raceCtx)) return;
    root.innerHTML = errorStateHTML(err, 'data-v3-retry="drh-dashboard"');
  }
}

function onRetryClick(event) {
  if (event.target.closest("[data-v3-retry='drh-dashboard']")) { invalidateDrhDashboard(); render(); }
}

export function mountDrhDashboard(container) {
  root = container;
  document.addEventListener("click", onRetryClick);
  return render();
}

export function unmountDrhDashboard() {
  document.removeEventListener("click", onRetryClick);
  root = null;
}
