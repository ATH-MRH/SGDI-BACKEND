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
import { loadData, invalidate } from "../core/data-loader.mjs";
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
    // LOT 6 : seul l'onglet Congés a une interactivité propre (demande + validation) —
    // câblée après montage, comme le tableau de bord des onglets lui-même (renderShell).
    if (tabKey === "conges") wireLeavesSection(employee);
    if (tabKey === "discipline") wireSanctionsSection(employee);
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

// LOT 6 : congés — lecture (déjà LOT 3) + demande + validation.
// - POST /drh/leaves (création) et POST /drh/leaves/{id}/approve|refuse existent déjà
//   côté backend, RBAC via _ensure_employee_allowed (même garde que la lecture).
// - Audit précis (service.py::approve_leave/refuse_leave) : AUCUNE vérification
//   authorized_actions ("validate") n'existe backend-side pour ces deux routes — seul le
//   scope société/employé est vérifié, garantie déjà acquise puisque l'utilisateur voit
//   déjà cet onglet. Les boutons Approuver/Refuser sont donc affichés SANS condition
//   frontend supplémentaire : en ajouter une aurait fabriqué une distinction de permission
//   que le backend n'applique pas réellement (ni plus restrictive, ni plus permissive que
//   la réalité serveur — voir mission §6 "le frontend ne doit jamais devenir la frontière
//   de sécurité").
// - Aucun calcul métier (solde de congés, nombre de jours ouvrés...) n'est reconstruit ici
//   — les dates sont affichées telles que renvoyées, la validation de cohérence reste
//   backend (le formulaire n'impose que required/type=date, jamais une règle métier).
function leaveStatusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "approuve") return `<span class="dn-badge dn-badge-success">Approuvé</span>`;
  if (s === "refuse") return `<span class="dn-badge dn-badge-danger">Refusé</span>`;
  if (s === "instance") return `<span class="dn-badge dn-badge-warning">En attente</span>`;
  return `<span class="dn-badge">${escapeHTML(status || "—")}</span>`;
}

async function sectionLeaves(e) {
  const rows = await loadData(`drh:employee:${e.id}:leaves`, (signal) => api.get(`/drh/leaves?employee_id=${encodeURIComponent(e.id)}`, { signal }), { ttlMs: 10000 });
  const list = Array.isArray(rows) ? rows : [];
  const table = list.length
    ? `<table class="dn-table"><thead><tr><th>Type</th><th>Début</th><th>Fin</th><th>Statut</th><th></th></tr></thead><tbody>
        ${list.map(l => `<tr data-dn-leave-row="${l.id}"><td>${escapeHTML(l.leave_type || "—")}</td><td>${escapeHTML(l.start_date || "—")}</td><td>${escapeHTML(l.end_date || "—")}</td><td>${leaveStatusBadge(l.status)}</td>
          <td>${String(l.status || "").toLowerCase() === "instance" ? `<button type="button" class="dn-btn" data-dn-leave-approve="${l.id}">Approuver</button> <button type="button" class="dn-btn" data-dn-leave-refuse="${l.id}">Refuser</button>` : ""}</td></tr>`).join("")}
      </tbody></table>`
    : emptyStateHTML("Aucun congé/absence enregistré.");
  return `${table}
    <div style="margin-top:14px">
      <button type="button" class="dn-btn dn-btn-primary" id="dn-leave-new-toggle">+ Nouvelle demande</button>
      <form id="dn-leave-new-form" hidden style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div><label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Type</label><input class="dn-input" name="leave_type" required style="width:160px"></div>
        <div><label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Début</label><input class="dn-input" type="date" name="start_date" required></div>
        <div><label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Fin</label><input class="dn-input" type="date" name="end_date" required></div>
        <div style="flex:1;min-width:180px"><label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Motif</label><input class="dn-input" name="reason"></div>
        <button type="submit" class="dn-btn dn-btn-primary">Enregistrer</button>
        <span id="dn-leave-new-error" class="dn-error-state-text" style="margin:0"></span>
      </form>
    </div>`;
}

function wireLeavesSection(employee) {
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
      if (state.activeTab === "conges") loadSection(employee, "conges", sectionLeaves);
    } catch (err) {
      if (errEl) errEl.textContent = err?.message || "Enregistrement impossible.";
    }
  });
  document.querySelectorAll("[data-dn-leave-approve]").forEach(btn => {
    btn.addEventListener("click", () => decideLeave(employee, btn.getAttribute("data-dn-leave-approve"), "approve"));
  });
  document.querySelectorAll("[data-dn-leave-refuse]").forEach(btn => {
    btn.addEventListener("click", () => decideLeave(employee, btn.getAttribute("data-dn-leave-refuse"), "refuse"));
  });
}

async function decideLeave(employee, leaveId, action) {
  const row = document.querySelector(`[data-dn-leave-row="${leaveId}"]`);
  row?.querySelectorAll("button").forEach(b => b.setAttribute("disabled", "disabled"));
  try {
    await api.post(`/drh/leaves/${encodeURIComponent(leaveId)}/${action}`);
    invalidate(`drh:employee:${employee.id}:leaves`);
    if (state.activeTab === "conges") loadSection(employee, "conges", sectionLeaves);
  } catch (err) {
    row?.querySelectorAll("button").forEach(b => b.removeAttribute("disabled"));
  }
}

// LOT 7 : discipline — lecture (LOT 3) + création.
// Audit backend (app/modules/drh/schemas.py::SanctionBase) : AUCUN champ "status", ni
// modèle séparé pour incident/convocation/commission/décision — un SEUL enregistrement
// plat (date d'infraction, motif, type, jours de suspension, site, date de reprise). La
// mission décrit un processus plus riche (incident → convocation → commission → décision
// → sanction) qui N'EXISTE PAS dans ce schéma : le construire serait fabriquer un
// workflow métier que le backend ne modélise pas — interdit explicitement ("changement
// métier ambigu"). Cet onglet reste donc fidèle aux seuls champs réels : liste + création
// d'un enregistrement de sanction, rien de plus. Pas de bouton "approuver/décider" (il
// n'y a pas de statut à faire évoluer, contrairement aux congés au LOT 6).
// Sensibilité (mission §12) : déjà respectée structurellement — /drh/sanctions n'est
// JAMAIS appelé par l'annuaire (LOT 2) ni par le chargement du dossier (LOT 3) ; ce
// paresseux par onglet, inchangé ici, est la seule protection nécessaire.
async function sectionSanctions(e) {
  const rows = await loadData(`drh:employee:${e.id}:sanctions`, (signal) => api.get(`/drh/sanctions?employee_id=${encodeURIComponent(e.id)}`, { signal }), { ttlMs: 10000 });
  const list = Array.isArray(rows) ? rows : [];
  const table = list.length
    ? `<table class="dn-table"><thead><tr><th>Date</th><th>Motif</th><th>Type</th><th>Suspension (j)</th><th>Site</th></tr></thead><tbody>
        ${list.map(s => `<tr><td>${escapeHTML(s.infraction_date || "—")}</td><td>${escapeHTML(s.fault || "—")}</td><td>${escapeHTML(s.sanction_type || "—")}</td><td>${escapeHTML(s.suspension_days ?? "—")}</td><td>${escapeHTML(s.site_name || "—")}</td></tr>`).join("")}
      </tbody></table>`
    : emptyStateHTML("Aucune sanction enregistrée.");
  return `${table}
    <div style="margin-top:14px">
      <button type="button" class="dn-btn dn-btn-primary" id="dn-sanction-new-toggle">+ Nouvelle sanction</button>
      <form id="dn-sanction-new-form" hidden style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div><label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Date infraction</label><input class="dn-input" type="date" name="infraction_date" required></div>
        <div style="flex:1;min-width:180px"><label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Motif</label><input class="dn-input" name="fault" required></div>
        <div><label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Type</label><input class="dn-input" name="sanction_type" required style="width:160px"></div>
        <div><label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Suspension (j)</label><input class="dn-input" type="number" min="0" name="suspension_days" style="width:110px"></div>
        <button type="submit" class="dn-btn dn-btn-primary">Enregistrer</button>
        <span id="dn-sanction-new-error" class="dn-error-state-text" style="margin:0"></span>
      </form>
    </div>`;
}

function wireSanctionsSection(employee) {
  const toggle = document.querySelector("#dn-sanction-new-toggle");
  const form = document.querySelector("#dn-sanction-new-form");
  toggle?.addEventListener("click", () => { form.hidden = !form.hidden; });
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const errEl = document.querySelector("#dn-sanction-new-error");
    if (errEl) errEl.textContent = "";
    try {
      await api.post("/drh/sanctions", {
        employee_id: employee.id,
        infraction_date: fd.get("infraction_date"),
        fault: fd.get("fault"),
        sanction_type: fd.get("sanction_type"),
        suspension_days: fd.get("suspension_days") ? Number(fd.get("suspension_days")) : 0,
      });
      invalidate(`drh:employee:${employee.id}:sanctions`);
      if (state.activeTab === "discipline") loadSection(employee, "discipline", sectionSanctions);
    } catch (err) {
      if (errEl) errEl.textContent = err?.message || "Enregistrement impossible.";
    }
  });
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
