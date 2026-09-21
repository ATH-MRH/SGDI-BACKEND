// ATLAS V3 — modules-v3/dashboard/index.mjs
//
// Module pilote (§13 de la mission) : preuve d'architecture. Interface visuelle IDENTIQUE
// au tableau de bord général Legacy pour les sections dont la source est déjà vérifiée sûre
// (KPI effectif/congés/absence-maladie, comparaison effectif contrat/réel — mêmes classes
// CSS que sgdi-app.js::renderDashboard, réutilisation du design system existant, §22 de la
// mission : ne pas refaire le design). Données : UNIQUEMENT l'agrégat serveur déjà en place
// (GET /api/ui/sidebar-stats — build_erp_counters, SQL réel, jamais une collection complète
// rapatriée), déjà consommé par le dashboard DRH et la sidebar Legacy avec préséance
// identique. Aucun employee fetch, aucune collection complète, aucun état db.* global.
//
// Panneaux dont la source n'a pas encore été vérifiée sûre (situation détaillée par
// société, alertes secondaires, activité récente) : état honnête explicite plutôt qu'une
// donnée fabriquée — voir docs/atlas-v3-architecture-baseline.md pour le suivi de cette
// dette, non résolue par ce lot pilote (le module Legacy reste la référence complète
// pendant la coexistence strangler, §19).
import { api } from "../../core-v3/api.mjs";
import { loadData, invalidate } from "../../core-v3/data-loader.mjs";
import { escapeHTML, skeletonHTML, errorStateHTML, emptyStateHTML } from "../../core-v3/ui.mjs";
import { captureRaceContext, isStillValid } from "../../core-v3/race-guard.mjs";
import { currentSocietyScope } from "../../core-v3/permissions.mjs";
import { time as recordTiming } from "../../core-v3/telemetry.mjs";

const VIEW_SELECTOR = "#v3-view";

function counterValue(erpEmp, ...keys) {
  for (const key of keys) {
    const value = Number(erpEmp?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

async function fetchSidebarStats(society) {
  const context = captureRaceContext();
  const key = `dashboard:sidebar-stats:${society || "__all"}`;
  const stats = await recordTiming("api", "/ui/sidebar-stats", () =>
    loadData(key, (signal) => api.get(`/ui/sidebar-stats${society ? `?society=${encodeURIComponent(society)}` : ""}`, { signal }), { ttlMs: 15000, retry: 1 })
  );
  return { stats, context };
}

function kpiCardHTML(label, value, sub, route) {
  return `<a class="dash-kpi" href="#/${route}" data-searchable>
    <div class="flex items-center justify-between"><div class="label">${escapeHTML(label)}</div></div>
    <div class="value">${escapeHTML(value === null ? "…" : value)}</div>
    <div class="sub">${escapeHTML(sub || "")}</div>
  </a>`;
}

function renderReady(stats, societyLabel) {
  const erpEmp = stats?.erp?.employees || null;
  const staffing = stats?.staffing || null;
  const actifs = counterValue(erpEmp, "active");
  const total = counterValue(erpEmp, "total");
  const conge = counterValue(erpEmp, "leave_current");
  const maladie = counterValue(erpEmp, "sick_leave_current");
  const absent = counterValue(erpEmp, "absent");

  const view = document.querySelector(VIEW_SELECTOR);
  if (!view) return;
  view.innerHTML = `<div class="dash-shell">
    <section class="dash-kpi-grid">
      ${kpiCardHTML("Effectif actif", actifs, `${total === null ? "…" : total} total`, "effectif/actifs")}
      ${kpiCardHTML("Absence / maladie", (absent === null || maladie === null) ? null : absent + maladie, `${absent === null ? "…" : absent} absence · ${maladie === null ? "…" : maladie} maladie`, "effectif/absents")}
      ${kpiCardHTML("Congés", conge, "", "conges")}
    </section>
    <section class="dash-panel">
      <div class="dash-panel-head"><div class="dash-panel-title">Comparaison effectif</div><span class="text-xs text-slate-500">${escapeHTML(societyLabel || "Toutes sociétés autorisées")}</span></div>
      <div class="dash-panel-body dash-pilot-staffing">
        <article data-staffing="contract"><span>EFF CONTRAT</span><strong>${staffing?.contract ?? "—"}</strong><small>Contrats Commercial en vigueur</small></article>
        <article data-staffing="actual"><span>EFF RÉEL</span><strong>${staffing?.actual ?? "—"}</strong><small>Salariés DRH affectés par OPS</small></article>
        <article data-staffing="gap"><span>ÉCART</span><strong>${staffing ? (staffing.gap > 0 ? "+" : "") + staffing.gap : "—"}</strong><small>Réel − contrat</small></article>
      </div>
    </section>
    <section class="dash-panel">
      <div class="dash-panel-head"><div class="dash-panel-title">Situation par société</div></div>
      <div class="dash-panel-body">${emptyStateHTML("Répartition détaillée par société : en attente d'un agrégat serveur dédié (voir docs/atlas-v3-architecture-baseline.md). Disponible dans le tableau de bord Legacy en attendant.")}</div>
    </section>
    <section class="dash-panel">
      <div class="dash-panel-head"><div class="dash-panel-title">Activité récente</div></div>
      <div class="dash-panel-body">${emptyStateHTML("Fil d'activité : en attente d'un agrégat serveur dédié. Disponible dans le tableau de bord Legacy en attendant.")}</div>
    </section>
  </div>`;
}

async function render() {
  const view = document.querySelector(VIEW_SELECTOR);
  if (view) view.innerHTML = skeletonHTML("cards");
  const context = captureRaceContext();
  const society = (currentSocietyScope() || [])[0] || "";
  try {
    const { stats } = await fetchSidebarStats(society);
    if (!isStillValid(context)) return; // navigation/session devenue obsolète pendant l'attente
    await recordTiming("render", "dashboard", async () => renderReady(stats, society));
  } catch (err) {
    if (!isStillValid(context)) return;
    const v = document.querySelector(VIEW_SELECTOR);
    if (v) v.innerHTML = errorStateHTML(err, 'data-v3-retry="dashboard"');
  }
}

function onRetryClick(event) {
  if (event.target.closest("[data-v3-retry='dashboard']")) render();
}

export function mountDashboard(container) {
  // container est l'ÉLÉMENT DOM réel fourni par l'appelant (contrat de module V3, §5) —
  // distinct de ui.mjs::mount(selector, html), pensé pour un usage interne par sélecteur.
  if (container) container.innerHTML = `<div id="v3-view"></div>`;
  document.addEventListener("click", onRetryClick);
  return render();
}

export function unmountDashboard() {
  document.removeEventListener("click", onRetryClick);
}

export function invalidateDashboard() {
  invalidate(/^dashboard:sidebar-stats:/);
}
