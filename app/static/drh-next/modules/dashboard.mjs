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

// LOT 9 : cockpit DRH. Audit avant tout ajout — /drh/dashboard (service.dashboard,
// app/modules/drh/routes.py) renvoie exactement : employees_total, employees_by_status
// (répartition COMPLÈTE, déjà agrégée serveur sur le périmètre entier de l'utilisateur —
// pas un échantillon), candidates_by_status (idem), leaves_pending (compteur), et
// trial_periods (liste des fins de période d'essai, employés actifs). Le LOT 1 n'exploitait
// que employees_by_status.actif et le TOTAL des candidats, jetant le reste de la
// répartition déjà reçue — ce lot l'affiche intégralement, SANS aucun nouvel appel réseau.
//
// Demandé par la mission mais VOLONTAIREMENT NON CONSTRUIT, faute de capacité backend
// réelle (pas de faux KPI, pas de calcul reconstruit à partir d'un échantillon paginé) :
// - entrées/sorties (aucun compteur d'embauches/départs sur une période dans la réponse)
// - contrats à échéance (seule la période d'ESSAI est agrégée ; aucune échéance de
//   contrat général n'est calculée côté serveur — voir aussi le badge "Expiré" du LOT 4,
//   qui reste employé-par-employé, jamais un compteur global)
// - absences (distinct de "congés en attente" : aucun compteur d'absences n'existe)
// - alertes RH (aucun concept d'alerte agrégée dans la réponse)
// - répartition par société / par site (non agrégée côté serveur ; la calculer côté
//   client obligerait soit à parcourir la population paginée par société — un échantillon
//   explicitement interdit pour un KPI — soit à multiplier les téléchargements complets
//   pour un compte multi-société, l'exact inverse de la discipline "aucun full" tenue
//   depuis le LOT 2)
// Dette documentée : DRH-NEXT-DASHBOARD-AGGREGATES (nécessiterait de nouveaux agrégats
// côté backend : entrées/sorties par période, échéances de contrats, répartition
// société/site — hors périmètre d'un lot frontend).
function statusLabel(key) {
  const known = { actif: "Actif", absent: "Absent", suspendu: "Suspendu", sortant: "Sortant", non_defini: "Non défini", nouvelle: "Nouvelle", a_contractualiser: "À contractualiser", refuse: "Refusée", recrute: "Recrutée" };
  return known[key] || key;
}

function breakdownHTML(title, byStatus) {
  const entries = Object.entries(byStatus || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "";
  return `<div class="dn-card dn-panel">
    <div class="dn-panel-head">${escapeHTML(title)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${entries.map(([key, n]) => `<span class="dn-badge">${escapeHTML(statusLabel(key))} · ${escapeHTML(n)}</span>`).join("")}
    </div>
  </div>`;
}

function dashboardHTML(data) {
  const actifs = data?.employees_by_status?.actif || 0;
  const total = data?.employees_total || 0;
  const candidatsTotal = Object.values(data?.candidates_by_status || {}).reduce((a, b) => a + b, 0);
  // LOT 10 (revue d'intégration §14) : trial_periods (service.dashboard) liste TOUT employé
  // actif ayant une trial_end_date renseignée, SANS filtre de date — ni "à venir", ni "en
  // cours" au sens strict (une date déjà passée y figure aussi si jamais nettoyée côté
  // donnée). Libellés corrigés en conséquence : aucun mot n'affirme une imminence que le
  // backend ne garantit pas. Donnée inchangée, seul le texte l'était.
  const trialCount = (data?.trial_periods || []).length;
  const kpis = [
    { label: "Effectif actif", value: actifs, sub: `${total} au total` },
    { label: "Congés en attente", value: data?.leaves_pending || 0, sub: "à valider ou refuser" },
    { label: "Candidats en cours", value: candidatsTotal, sub: "toutes phases confondues" },
    { label: "Fins de période d'essai enregistrées", value: trialCount, sub: "employés actifs concernés" },
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
  ${breakdownHTML("Répartition des employés par statut", data?.employees_by_status)}
  ${breakdownHTML("Répartition des candidats par statut", data?.candidates_by_status)}
  <div class="dn-card dn-panel">
    <div class="dn-panel-head">Employés actifs avec une date de fin de période d'essai enregistrée</div>
    ${trialList.length ? `<table class="dn-table"><thead><tr><th>Code</th><th>Nom</th><th>Fin d'essai</th></tr></thead><tbody>
      ${trialList.map(e => `<tr><td>${escapeHTML(e.code)}</td><td>${escapeHTML(e.name)}</td><td>${escapeHTML(e.trial_end_date || "—")}</td></tr>`).join("")}
    </tbody></table>` : `<div class="dn-empty-state">Aucun employé actif n'a de date de fin de période d'essai enregistrée.</div>`}
  </div>`;
}
