// ATLAS V3 — modules-v3/drh/dashboard.mjs
//
// Centre de pilotage DRH (§4 de la mission "Phase finale DRH"), adapté depuis
// app/static/drh-next/modules/dashboard.mjs (LOT 9/10, déjà audité) — logique et
// garde-fous INCHANGÉS, reskinné avec les classes CSS Legacy (dash-kpi/dash-panel, comme
// modules-v3/dashboard/index.mjs) pour rester visuellement familier (§5 de la mission DRH
// initiale). DEUX sources, toutes deux des agrégats serveur déjà ciblés — JAMAIS une
// collection complète d'employés (§13/§21, critère réseau absolu) :
// - GET /drh/dashboard : compteurs employés/candidats/congés en attente/périodes d'essai,
//   et désormais employees_by_site (§4, agrégat ajouté ce lot — voir routes.py::dashboard,
//   coût zéro requête supplémentaire, calculé sur des lignes déjà chargées côté serveur pour
//   trial_periods).
// - GET /ui/sidebar-stats : staffing (effectif contrat vs réel, déjà utilisé et audité par
//   le Dashboard V3 général) et drh.effectifs/drh.recrutement (sans_contrat/sans_dotation/
//   sans_affectation, candidats en attente DRH) — réutilisé tel quel, pas une deuxième
//   implémentation.
//
// Panneaux demandés par la mission mais VOLONTAIREMENT NON CONSTRUITS, faute de capacité
// backend réelle (dette DRH-NEXT-DASHBOARD-AGGREGATES, non résolue par ce lot, préservée
// telle quelle) : "Évolution des effectifs" (aucun compteur d'entrées/sorties par période
// n'existe côté serveur) — état honnête différé plutôt qu'un graphique fabriqué à partir
// d'un échantillon (§6 de la mission DRH initiale, rappelé au §4 de cette mission).
import { api } from "../../core-v3/api.mjs";
import { loadData, invalidate } from "../../core-v3/data-loader.mjs";
import { captureRaceContext, isStillValid } from "../../core-v3/race-guard.mjs";
import { escapeHTML, skeletonHTML, errorStateHTML, emptyStateHTML } from "../../core-v3/ui.mjs";
import { currentSocietyScope } from "../../core-v3/permissions.mjs";
import { time as recordTiming } from "../../core-v3/telemetry.mjs";

const CACHE_KEY = "drh:dashboard";
let root = null;

export function invalidateDrhDashboard() {
  invalidate(CACHE_KEY);
  invalidate(/^drh:dashboard:sidebar-stats:/);
}

function kpiCardHTML(label, value, sub, route) {
  const tag = route ? "a" : "div";
  const hrefAttr = route ? ` href="#/${route}"` : "";
  return `<${tag} class="dash-kpi"${hrefAttr}>
    <div class="flex items-center justify-between"><div class="label">${escapeHTML(label)}</div></div>
    <div class="value">${escapeHTML(value ?? "…")}</div>
    <div class="sub">${escapeHTML(sub || "")}</div>
  </${tag}>`;
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

// "File de travail DRH" / "Alertes prioritaires" (§4) : chaque ligne pointe vers un compteur
// RÉEL déjà renvoyé par un agrégat serveur (jamais une valeur recalculée côté client) — ne
// s'affiche que si le compteur est strictement positif, pour ne jamais afficher une alerte
// vide. currentSocietyScope() manquant/vide -> sidebar.drh peut être absent (compte sans
// scope résolu) : traité comme "aucune donnée", pas une erreur.
function workQueueHTML(sidebar) {
  const eff = sidebar?.drh?.effectifs || {};
  const rec = sidebar?.drh?.recrutement || {};
  const items = [
    { label: "Congés en attente de décision", value: eff.conge, route: "drh/employees" },
    { label: "Candidatures partagées en attente DRH", value: rec.shared_pending, route: "drh/recrutement" },
    { label: "Employés sans contrat actif", value: eff.sans_contrat, route: "drh/employees" },
    { label: "Employés sans dotation matériel", value: eff.sans_dotation, route: "drh/employees" },
    { label: "Employés sans affectation active", value: eff.sans_affectation, route: "drh/employees" },
    { label: "Contrats à établir (candidats transmis)", value: rec.contracts_pending, route: "drh/recrutement" },
  ].filter(item => Number(item.value) > 0);
  if (!items.length) return emptyStateHTML("Aucun élément en attente de traitement.");
  return `<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px">
    ${items.map(item => `<li><a href="#/${item.route}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;background:var(--dn-bg,#f3f4f6);text-decoration:none;color:inherit">
      <span style="font-size:13px;font-weight:600">${escapeHTML(item.label)}</span>
      <span class="dn-badge dn-badge-warning">${escapeHTML(item.value)}</span>
    </a></li>`).join("")}
  </ul>`;
}

function siteBreakdownHTML(bySite, withoutSite) {
  const rows = Array.isArray(bySite) ? bySite : [];
  if (!rows.length && !withoutSite) return emptyStateHTML("Aucune affectation active enregistrée.");
  const max = Math.max(1, ...rows.map(r => r.count));
  return `<div style="display:flex;flex-direction:column;gap:6px">
    ${rows.map(r => `<div style="display:flex;align-items:center;gap:10px">
      <span style="width:150px;font-size:12.5px;font-weight:600;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHTML(r.site)}">${escapeHTML(r.site)}</span>
      <span style="flex:1;background:var(--dn-bg,#f3f4f6);border-radius:6px;overflow:hidden;height:16px"><span style="display:block;height:100%;width:${Math.round((r.count / max) * 100)}%;background:var(--dn-accent,#043970)"></span></span>
      <span style="font-size:12.5px;font-weight:800;font-variant-numeric:tabular-nums;width:28px;text-align:right">${escapeHTML(r.count)}</span>
    </div>`).join("")}
    ${withoutSite ? `<div style="margin-top:4px;font-size:12px;color:var(--dn-text-muted,#475569)">+ ${escapeHTML(withoutSite)} employé(s) actif(s) sans affectation active</div>` : ""}
  </div>`;
}

function staffingHTML(staffing) {
  if (!staffing) return emptyStateHTML("Comparaison effectif contrat/réel indisponible.");
  const gap = staffing.gap ?? null;
  return `<div class="dash-pilot-staffing">
    <article data-staffing="contract"><span>EFF CONTRAT</span><strong>${staffing.contract ?? "—"}</strong><small>Contrats Commercial en vigueur</small></article>
    <article data-staffing="actual"><span>EFF RÉEL</span><strong>${staffing.actual ?? "—"}</strong><small>Salariés DRH affectés par OPS</small></article>
    <article data-staffing="gap"><span>ÉCART</span><strong>${gap === null ? "—" : (gap > 0 ? "+" : "") + gap}</strong><small>Réel − contrat</small></article>
  </div>`;
}

function renderReady(data, sidebar, societyLabel) {
  if (!root) return;
  const actifs = data?.employees_by_status?.actif || 0;
  const absents = data?.employees_by_status?.absent || 0;
  const total = data?.employees_total || 0;
  const candidatsTotal = Object.values(data?.candidates_by_status || {}).reduce((a, b) => a + b, 0);
  // trial_periods (service.dashboard) liste TOUT employé actif ayant une trial_end_date
  // renseignée, SANS filtre de date (ni "à venir" ni "en cours" au sens strict) — le libellé
  // n'affirme donc aucune imminence que le backend ne garantit pas.
  const trialList = (data?.trial_periods || []).slice(0, 8);
  const trialCount = (data?.trial_periods || []).length;

  root.innerHTML = `<div class="dash-shell">
    <div class="dn-page-head"><h1>Centre de pilotage RH</h1></div>
    <section class="dash-kpi-grid">
      ${kpiCardHTML("Effectif actif", actifs, `${total} au total`, "drh/employees")}
      ${kpiCardHTML("Absences", absents, "employés actuellement absents", "drh/employees")}
      ${kpiCardHTML("Congés en attente", data?.leaves_pending || 0, "à valider ou refuser", "drh/employees")}
      ${kpiCardHTML("Candidats en cours", candidatsTotal, "toutes phases confondues", "drh/recrutement")}
    </section>
    <section class="dash-panel">
      <div class="dash-panel-head"><div class="dash-panel-title">Santé des effectifs</div><span class="text-xs text-slate-500">${escapeHTML(societyLabel || "Toutes sociétés autorisées")}</span></div>
      <div class="dash-panel-body">${staffingHTML(sidebar?.staffing)}</div>
    </section>
    <section class="dash-panel">
      <div class="dash-panel-head"><div class="dash-panel-title">File de travail DRH</div></div>
      <div class="dash-panel-body">${workQueueHTML(sidebar)}</div>
    </section>
    <section class="dash-panel">
      <div class="dash-panel-head"><div class="dash-panel-title">Répartition opérationnelle par site</div></div>
      <div class="dash-panel-body">${siteBreakdownHTML(data?.employees_by_site, data?.employees_without_site)}</div>
    </section>
    ${breakdownHTML("Répartition des employés par statut", data?.employees_by_status)}
    ${breakdownHTML("Répartition des candidats par statut", data?.candidates_by_status)}
    <section class="dash-panel">
      <div class="dash-panel-head"><div class="dash-panel-title">Fins de période d'essai enregistrées</div><span class="text-xs text-slate-500">${trialCount} employé(s) actif(s) concerné(s)</span></div>
      <div class="dash-panel-body">${trialList.length ? `<table class="dn-table"><thead><tr><th>Code</th><th>Nom</th><th>Fin d'essai</th></tr></thead><tbody>
        ${trialList.map(e => `<tr><td>${escapeHTML(e.code)}</td><td>${escapeHTML(e.name)}</td><td>${escapeHTML(e.trial_end_date || "—")}</td></tr>`).join("")}
      </tbody></table>` : emptyStateHTML("Aucun employé actif n'a de date de fin de période d'essai enregistrée.")}</div>
    </section>
    <section class="dash-panel">
      <div class="dash-panel-head"><div class="dash-panel-title">Évolution des effectifs</div></div>
      <div class="dash-panel-body">${emptyStateHTML("Nécessite un agrégat serveur dédié (entrées/sorties par période) — aucune route ne l'expose aujourd'hui sans charger la collection complète, interdit par cette mission. Disponible dans le tableau de bord Legacy en attendant.")}</div>
    </section>
  </div>`;
}

async function render() {
  if (!root) return;
  root.innerHTML = skeletonHTML("cards");
  const raceCtx = captureRaceContext();
  const society = (currentSocietyScope() || [])[0] || "";
  try {
    const [data, sidebar] = await Promise.all([
      recordTiming("api", "/drh/dashboard", () => loadData(CACHE_KEY, (signal) => api.get("/drh/dashboard", { signal }), { ttlMs: 15000 })),
      recordTiming("api", "/ui/sidebar-stats", () => loadData(`drh:dashboard:sidebar-stats:${society || "__all"}`, (signal) => api.get(`/ui/sidebar-stats${society ? `?society=${encodeURIComponent(society)}` : ""}`, { signal }), { ttlMs: 15000, retry: 1 })),
    ]);
    if (!root || !isStillValid(raceCtx)) return; // navigation ou session a changé pendant l'attente
    await recordTiming("render", "drh-dashboard", async () => renderReady(data, sidebar, society));
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
