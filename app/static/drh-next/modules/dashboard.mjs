// DRH NEXT — modules/dashboard.js
//
// Consomme UNIQUEMENT /api/drh/dashboard (agrégats déjà calculés côté serveur —
// endpoint pré-existant, réutilisé tel quel, aucun nouveau endpoint créé pour
// ce lot). Ne télécharge JAMAIS la collection complète des employés : cet
// endpoint renvoie des compteurs et une petite liste de fins de période
// d'essai, pas les fiches employé elles-mêmes.
import { api } from "../core/api.mjs";
import { loadData, invalidate } from "../core/data-loader.mjs";
import { captureRaceContext, raceContextStillValid } from "../core/race-guard.mjs";
import { skeletonHTML, errorStateHTML, mount, escapeHTML } from "../core/ui.mjs";

const VIEW_SELECTOR = "#dn-view";
const CACHE_KEY = "drh:dashboard";

export function invalidateDashboard() { invalidate(CACHE_KEY); }

export async function renderDashboard() {
  mount(VIEW_SELECTOR, skeletonHTML("cards"));
  await load();
}

async function load() {
  const raceCtx = captureRaceContext();
  try {
    const data = await loadData(CACHE_KEY, () => api.get("/drh/dashboard"), { ttlMs: 15000 });
    if (!raceContextStillValid(raceCtx)) return; // navigation ou session a changé pendant l'attente
    mount(VIEW_SELECTOR, dashboardHTML(data));
  } catch (err) {
    if (!raceContextStillValid(raceCtx)) return;
    mount(VIEW_SELECTOR, errorStateHTML(err, 'data-dn-retry-dashboard'));
    document.querySelector("[data-dn-retry-dashboard]")?.addEventListener("click", () => { invalidateDashboard(); load(); });
  }
}

function dashboardHTML(data) {
  const actifs = data?.employees_by_status?.actif || 0;
  const total = data?.employees_total || 0;
  const candidatsTotal = Object.values(data?.candidates_by_status || {}).reduce((a, b) => a + b, 0);
  const trialSoon = (data?.trial_periods || []).length;
  const kpis = [
    { label: "Effectif actif", value: actifs, sub: `${total} au total` },
    { label: "Congés en attente", value: data?.leaves_pending || 0, sub: "à valider ou refuser" },
    { label: "Candidats en cours", value: candidatsTotal, sub: "toutes phases confondues" },
    { label: "Fins de période d'essai", value: trialSoon, sub: "employés actifs concernés" },
  ];
  const trialList = (data?.trial_periods || []).slice(0, 8);
  return `<div class="dn-page-head"><h1>Tableau de bord RH</h1></div>
  <div class="dn-kpi-grid">
    ${kpis.map(k => `<div class="dn-card dn-kpi">
      <div class="dn-kpi-label">${escapeHTML(k.label)}</div>
      <div class="dn-kpi-value">${escapeHTML(k.value)}</div>
      <div class="dn-kpi-sub">${escapeHTML(k.sub)}</div>
    </div>`).join("")}
  </div>
  <div class="dn-card dn-panel">
    <div class="dn-panel-head">Fins de période d'essai à venir</div>
    ${trialList.length ? `<table class="dn-table"><thead><tr><th>Code</th><th>Nom</th><th>Fin d'essai</th></tr></thead><tbody>
      ${trialList.map(e => `<tr><td>${escapeHTML(e.code)}</td><td>${escapeHTML(e.name)}</td><td>${escapeHTML(e.trial_end_date || "—")}</td></tr>`).join("")}
    </tbody></table>` : `<div class="dn-empty-state">Aucune période d'essai en cours.</div>`}
  </div>`;
}
