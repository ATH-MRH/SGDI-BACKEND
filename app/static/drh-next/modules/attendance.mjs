// DRH NEXT — modules/attendance.mjs
//
// Entrée « Pointage » du menu (auparavant écran « pas encore planifié », voir
// docs/drh-next-unmerged-audit.md, commit c99e23a). Pas de second centre de pointage : la
// situation du jour vient de la source canonique Attendance Core (GET /attendance/board,
// KPI calculés côté serveur sur toute la population du périmètre — page_size=1, on ne lit
// que les KPI) ; la gestion (corrections, clôtures, anomalies) reste dans le centre de
// contrôle pointage.irongs.com, et le détail par employé dans l'onglet Pointage du dossier.
// Cette gestion n'est annoncée qu'aux comptes à qui le serveur l'accorde
// (GET /attendance/capabilities) : DRH seul consulte.
import { api } from "../core/api.mjs";
import { captureRaceContext, raceContextStillValid } from "../core/race-guard.mjs";
import { skeletonHTML, errorStateHTML, mount, escapeHTML } from "../core/ui.mjs";

const VIEW = "#dn-view";
const CONTROL_CENTER_URL = "https://pointage.irongs.com/";
const KPIS = [
  ["expected", "Effectif prévu"], ["present", "Présents"], ["absent", "Absents"], ["not_pointed", "Non pointés"],
  ["late", "Retards"], ["conge", "Congés"], ["maladie", "Maladies"], ["anomalies", "Anomalies ouvertes"],
];

export async function renderAttendance() {
  mount(VIEW, `<div class="dn-page-head"><h1>Pointage</h1></div><div class="dn-card dn-panel">${skeletonHTML("table")}</div>`);
  const raceCtx = captureRaceContext();
  try {
    const [board, caps] = await Promise.all([
      api.get("/attendance/board?page_size=1"),
      api.get("/attendance/capabilities").catch(() => null),
    ]);
    if (!raceContextStillValid(raceCtx)) return;
    const k = board.kpi || {};
    const canManage = Object.values((caps && caps.writes) || {}).some((allowed) => allowed === true);
    mount(VIEW, `<div class="dn-page-head"><h1>Pointage</h1></div>
      <div class="dn-card dn-panel" style="margin-bottom:14px">
        <div class="dn-error-state-text" style="margin:0 0 12px">Situation du ${escapeHTML(board.date || "")} sur votre périmètre — source : Attendance Core.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
          ${KPIS.map(([key, label]) => `<div class="dn-card" style="padding:12px"><div class="dn-error-state-text" style="margin:0">${escapeHTML(label)}</div><div style="font-size:24px;font-weight:800">${escapeHTML(k[key] ?? 0)}</div></div>`).join("")}
        </div>
      </div>
      <div class="dn-card dn-panel">${canManage
        ? `Corrections, clôtures et anomalies : <a class="dn-btn" href="${CONTROL_CENTER_URL}" target="_blank" rel="noopener">Ouvrir le centre de contrôle Pointage</a>`
        : `Consultation uniquement — corrections, clôtures et anomalies sont traitées par les équipes opérationnelles. <a class="dn-btn" href="${CONTROL_CENTER_URL}" target="_blank" rel="noopener">Consulter le centre de contrôle Pointage</a>`}
        <div class="dn-error-state-text">Le détail par employé est dans l'onglet « Pointage » de son dossier.</div></div>`);
  } catch (err) {
    if (!raceContextStillValid(raceCtx)) return;
    mount(VIEW, `<div class="dn-page-head"><h1>Pointage</h1></div><div class="dn-card dn-panel">${errorStateHTML(err, "data-dn-retry-attendance")}</div>`);
    document.querySelector("[data-dn-retry-attendance]")?.addEventListener("click", renderAttendance);
  }
}
