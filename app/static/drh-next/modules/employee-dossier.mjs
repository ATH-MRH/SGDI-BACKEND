// DRH NEXT — modules/employee-dossier.mjs
//
// LOT 3 : Dossier Employé 360°, accessible depuis l'annuaire LOT 2 (clic sur une ligne
// ou lien "Voir") et par deep link direct #/employees/{id}. Remplace l'écran de détail
// minimal de renderEmployeeDetail (LOT 2, conservé intact dans employees.mjs — voir son
// commentaire) sans dupliquer le chargement de l'employé (employees.mjs::loadEmployeeById).
//
// Audit backend (avant tout code, app/modules/drh/routes.py + service.py) :
// - GET /drh/employees/{id} → identité + poste + affectation ACTIVE courante (current_*,
//   jointure serveur déjà faite, voir commentaire EmployeeOut dans schemas.py). Un seul
//   appel, déjà fait par la liste LOT 2 au clic — réutilisé tel quel ici.
// - GET /drh/contracts?employee_id=X   → RBAC via _ensure_employee_allowed (403 si hors scope)
// - GET /drh/leaves?employee_id=X      → idem
// - GET /drh/sanctions?employee_id=X   → idem
// - GET /drh/documents?owner_type=employee&owner_id=X → RBAC via _ensure_document_allowed
// - service.fiche_position(employee_id) agrège TOUT (contrats+congés+sanctions+documents+
//   affectations+pointage+événements+matériel) en UN SEUL appel — DÉLIBÉRÉMENT NON UTILISÉ
//   ici : la mission LOT 3 interdit explicitement "une requête massive regroupant
//   inutilement tout le dossier" et exige de "charger les sections lourdes qu'au besoin".
//   Chaque onglet appelle donc son propre endpoint filtré, uniquement à l'ouverture.
// - AUCUN endpoint DRH n'expose l'historique des affectations (seule l'affectation ACTIVE
//   est dans EmployeeOut). Le seul historique d'affectations existant est sous
//   /api/ops/assignments, un module DIFFÉRENT dont l'accès est gated séparément
//   (enforce_module_access : prefix /api/ops → permission "ops", indépendante de "drh" —
//   voir app/modules/auth/dependencies.py). L'appeler depuis DRH Next romprait la
//   séparation de modules déjà actée (mission DATA-1) et échouerait en 403 pour tout RH
//   sans permission OPS. L'onglet "Historique" affiche donc un état honnête d'indisponibilité
//   plutôt que d'inventer une donnée ou de contourner cette frontière — dette documentée :
//   DRH-NEXT-ASSIGNMENT-HISTORY.
import { api } from "../core/api.mjs";
import { loadData } from "../core/data-loader.mjs";
import { captureRaceContext, raceContextStillValid } from "../core/race-guard.mjs";
import { skeletonHTML, errorStateHTML, emptyStateHTML, initialsAvatarHTML, mount, escapeHTML } from "../core/ui.mjs";
import { loadEmployeeById } from "./employees.mjs";

const VIEW_SELECTOR = "#dn-view";

const TABS = [
  { key: "identite", label: "Identité" },
  { key: "affectation", label: "Affectation" },
  { key: "contrats", label: "Contrats" },
  { key: "conges", label: "Congés" },
  { key: "discipline", label: "Discipline" },
  { key: "documents", label: "Documents" },
  { key: "historique", label: "Historique" },
];

// État module-local (LOT 3) : quel employé/onglet est affiché, remis à zéro à chaque
// entrée dans renderEmployeeDossier — même principe que employees.mjs (state module-local,
// pas de variable globale partagée entre écrans).
let state = { employeeId: null, activeTab: "identite" };
let tabRequestSeq = 0;

export async function renderEmployeeDossier(params) {
  const id = params?.id;
  state = { employeeId: id, activeTab: "identite" };
  mount(VIEW_SELECTOR, `<div class="dn-page-head"><a class="dn-btn" href="#/employees" style="margin-bottom:14px;display:inline-flex">← Retour aux employés</a></div><div class="dn-card dn-panel">${skeletonHTML("block")}</div>`);
  const raceCtx = captureRaceContext();
  try {
    const employee = await loadEmployeeById(id);
    if (!raceContextStillValid(raceCtx)) return; // navigation ailleurs, ou session changée, pendant l'attente
    renderShell(employee);
  } catch (err) {
    if (!raceContextStillValid(raceCtx)) return;
    mount(VIEW_SELECTOR, `<div class="dn-page-head"><a class="dn-btn" href="#/employees">← Retour aux employés</a></div><div class="dn-card dn-panel">${errorStateHTML(err, 'data-dn-retry-dossier')}</div>`);
    document.querySelector("[data-dn-retry-dossier]")?.addEventListener("click", () => renderEmployeeDossier(params));
  }
}

function renderShell(employee) {
  const name = `${employee.last_name || ""} ${employee.first_name || ""}`.trim();
  mount(VIEW_SELECTOR, `
    <div class="dn-page-head"><a class="dn-btn" href="#/employees" style="margin-bottom:14px;display:inline-flex">← Retour aux employés</a></div>
    <div class="dn-card dn-panel" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="dn-avatar" style="width:56px;height:56px;font-size:18px">${escapeHTML((((employee.first_name||"")[0]||"")+((employee.last_name||"")[0]||"")).toUpperCase() || "?")}</div>
        <div>
          <div style="font-weight:800;font-size:16px">${escapeHTML(name || "—")}</div>
          <div class="dn-error-state-text" style="margin:0">${escapeHTML(employee.code || "")} · ${escapeHTML(employee.position || "—")}</div>
        </div>
      </div>
    </div>
    <div class="dn-tabs" id="dn-dossier-tabs" role="tablist">
      ${TABS.map(t => `<button type="button" class="dn-tab" role="tab" aria-selected="${t.key === state.activeTab}" data-dn-tab="${t.key}">${escapeHTML(t.label)}</button>`).join("")}
    </div>
    <div class="dn-card dn-panel" id="dn-dossier-panel"></div>
  `);
  document.querySelectorAll("[data-dn-tab]").forEach(btn => {
    btn.addEventListener("click", () => selectTab(employee, btn.getAttribute("data-dn-tab")));
  });
  renderTab(employee, state.activeTab);
}

function selectTab(employee, tabKey) {
  state.activeTab = tabKey;
  document.querySelectorAll("[data-dn-tab]").forEach(btn => btn.setAttribute("aria-selected", String(btn.getAttribute("data-dn-tab") === tabKey)));
  renderTab(employee, tabKey);
}

function renderTab(employee, tabKey) {
  if (tabKey === "identite") return mount("#dn-dossier-panel", identiteHTML(employee));
  if (tabKey === "affectation") return mount("#dn-dossier-panel", affectationHTML(employee));
  if (tabKey === "historique") return mount("#dn-dossier-panel", emptyStateHTML("Historique des affectations non disponible pour le moment."));
  const section = { contrats: sectionContracts, conges: sectionLeaves, discipline: sectionSanctions, documents: sectionDocuments }[tabKey];
  if (section) loadSection(employee, tabKey, section);
}

// Chargement paresseux d'une section (LOT 3 §3 : uniquement à l'ouverture de l'onglet,
// jamais au chargement du dossier). Garde par séquence LOCALE (comme employees.mjs) : si
// l'utilisateur change d'onglet avant la résolution, la réponse tardive de l'ancien onglet
// ne doit jamais s'afficher par-dessus le nouveau. Garde par race-guard global en plus
// (session/navigation).
async function loadSection(employee, tabKey, sectionFn) {
  mount("#dn-dossier-panel", skeletonHTML("table"));
  const mySeq = ++tabRequestSeq;
  const raceCtx = captureRaceContext();
  try {
    const html = await sectionFn(employee);
    if (mySeq !== tabRequestSeq || state.activeTab !== tabKey || !raceContextStillValid(raceCtx)) return;
    mount("#dn-dossier-panel", html);
  } catch (err) {
    if (err?.aborted) return;
    if (mySeq !== tabRequestSeq || state.activeTab !== tabKey || !raceContextStillValid(raceCtx)) return;
    mount("#dn-dossier-panel", errorStateHTML(err, `data-dn-retry-tab="${tabKey}"`));
    document.querySelector(`[data-dn-retry-tab="${tabKey}"]`)?.addEventListener("click", () => loadSection(employee, tabKey, sectionFn));
  }
}

function identiteHTML(e) {
  const rows = [
    ["Matricule", e.code], ["Nom", e.last_name], ["Prénom", e.first_name],
    ["Date de naissance", e.birth_date], ["Lieu de naissance", e.birth_place],
    ["Situation familiale", e.family_status], ["Enfants", e.children_count],
    ["Téléphone", e.phone], ["Email", e.email],
    ["Adresse", e.address], ["Commune", e.commune], ["Wilaya", e.wilaya],
  ];
  return `<table class="dn-table">${rows.map(([label, value]) => `<tr><th style="width:220px">${escapeHTML(label)}</th><td>${escapeHTML(value ?? "—")}</td></tr>`).join("")}</table>`;
}

function affectationHTML(e) {
  const rows = [
    ["Société", e.society], ["Statut", e.status], ["Fonction", e.position],
    ["Site actuel", e.current_site_name], ["Client", e.current_client_name],
    ["Groupe", e.current_group_code], ["Poste (affectation)", e.current_position],
    ["Type de contrat", e.contract_type], ["Date de recrutement", e.recruit_date],
    ["Fin de période d'essai", e.trial_end_date],
  ];
  return `<table class="dn-table">${rows.map(([label, value]) => `<tr><th style="width:220px">${escapeHTML(label)}</th><td>${escapeHTML(value ?? "—")}</td></tr>`).join("")}</table>`;
}

// LOT 4 : badge de statut contrat. contract.status est un texte libre côté backend
// (aucune énumération contrainte) — le badge affiche la valeur backend TELLE QUELLE,
// sauf un seul cas dérivé MÉCANIQUEMENT des données déjà présentes (end_date < date du
// jour), jamais une règle métier inventée : pas de seuil "à échéance" (30/60/90 jours)
// arbitraire côté frontend, ce choix appartient au backend s'il l'expose un jour.
function contractStatusBadge(c) {
  const status = String(c.status || "").toLowerCase();
  if (status === "actif" && c.end_date && c.end_date < new Date().toISOString().slice(0, 10)) {
    return `<span class="dn-badge dn-badge-danger">Expiré</span>`;
  }
  if (status === "actif") return `<span class="dn-badge dn-badge-success">Actif</span>`;
  return `<span class="dn-badge">${escapeHTML(c.status || "—")}</span>`;
}

async function sectionContracts(e) {
  const rows = await loadData(`drh:employee:${e.id}:contracts`, (signal) => api.get(`/drh/contracts?employee_id=${encodeURIComponent(e.id)}`, { signal }), { ttlMs: 10000 });
  if (!Array.isArray(rows) || !rows.length) return emptyStateHTML("Aucun contrat enregistré.");
  return `<table class="dn-table"><thead><tr><th>Type</th><th>Poste</th><th>Début</th><th>Fin</th><th>Statut</th></tr></thead><tbody>
    ${rows.map(c => `<tr><td>${escapeHTML(c.contract_type || "—")}</td><td>${escapeHTML(c.position || "—")}</td><td>${escapeHTML(c.start_date || "—")}</td><td>${escapeHTML(c.end_date || "—")}</td><td>${contractStatusBadge(c)}</td></tr>`).join("")}
  </tbody></table>`;
}

async function sectionLeaves(e) {
  const rows = await loadData(`drh:employee:${e.id}:leaves`, (signal) => api.get(`/drh/leaves?employee_id=${encodeURIComponent(e.id)}`, { signal }), { ttlMs: 10000 });
  if (!Array.isArray(rows) || !rows.length) return emptyStateHTML("Aucun congé/absence enregistré.");
  return `<table class="dn-table"><thead><tr><th>Type</th><th>Début</th><th>Fin</th><th>Statut</th></tr></thead><tbody>
    ${rows.map(l => `<tr><td>${escapeHTML(l.leave_type || "—")}</td><td>${escapeHTML(l.start_date || "—")}</td><td>${escapeHTML(l.end_date || "—")}</td><td><span class="dn-badge">${escapeHTML(l.status || "—")}</span></td></tr>`).join("")}
  </tbody></table>`;
}

async function sectionSanctions(e) {
  const rows = await loadData(`drh:employee:${e.id}:sanctions`, (signal) => api.get(`/drh/sanctions?employee_id=${encodeURIComponent(e.id)}`, { signal }), { ttlMs: 10000 });
  if (!Array.isArray(rows) || !rows.length) return emptyStateHTML("Aucune sanction enregistrée.");
  return `<table class="dn-table"><thead><tr><th>Date</th><th>Motif</th><th>Type</th><th>Suspension (j)</th></tr></thead><tbody>
    ${rows.map(s => `<tr><td>${escapeHTML(s.infraction_date || "—")}</td><td>${escapeHTML(s.fault || "—")}</td><td>${escapeHTML(s.sanction_type || "—")}</td><td>${escapeHTML(s.suspension_days ?? "—")}</td></tr>`).join("")}
  </tbody></table>`;
}

// Documents (LOT 3, lecture seule) : métadonnées via /drh/documents (RBAC), lien de
// téléchargement via file_path — SEULE voie existante pour récupérer le contenu réel
// (aucune route backend de téléchargement authentifiée n'existe pour ce modèle). Le mount
// statique /uploads/* (app/main.py) ne revérifie pas la session : dette pré-existante côté
// backend, hors périmètre d'un lot frontend — documentée, non contournée ni aggravée.
// Debt : DRH-NEXT-DOC-URL-AUTH.
async function sectionDocuments(e) {
  const rows = await loadData(`drh:employee:${e.id}:documents`, (signal) => api.get(`/drh/documents?owner_type=employee&owner_id=${encodeURIComponent(e.id)}`, { signal }), { ttlMs: 10000 });
  if (!Array.isArray(rows) || !rows.length) return emptyStateHTML("Aucun document enregistré.");
  return `<table class="dn-table"><thead><tr><th>Libellé</th><th>Fichier</th><th></th></tr></thead><tbody>
    ${rows.map(d => `<tr><td>${escapeHTML(d.label || "—")}</td><td>${escapeHTML(d.file_name || "—")}</td><td>${d.file_path ? `<a class="dn-btn" href="${escapeHTML(d.file_path)}" target="_blank" rel="noopener">Ouvrir</a>` : "—"}</td></tr>`).join("")}
  </tbody></table>`;
}

export function _resetForTests() { state = { employeeId: null, activeTab: "identite" }; tabRequestSeq = 0; }
