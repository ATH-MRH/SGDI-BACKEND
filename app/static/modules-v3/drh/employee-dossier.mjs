// ATLAS V3 — modules-v3/drh/employee-dossier.mjs
//
// Shell du Dossier Employé 360°, adapté depuis app/static/drh-next/modules/employee-dossier.mjs
// (LOT 3 + LOT 6/7/8/11B, déjà audité et testé). Un seul appel GET /drh/employees/{id} pour
// l'identité/affectation ; chaque onglet lourd (contrats/congés/discipline/documents/
// historique/pointage/matériel/blacklist) est chargé PARESSEUSEMENT, uniquement à l'ouverture
// — un onglet jamais ouvert = 0 requête (§9 de la mission). Chaque section vit désormais dans
// son propre fichier (contracts.mjs/leaves.mjs/discipline.mjs/documents.mjs/attendance.mjs/
// blacklist.mjs) plutôt que dans ce seul fichier — seule différence structurelle avec DRH
// Next, logique et garde-fous inchangés.
import { captureRaceContext, isStillValid } from "../../core-v3/race-guard.mjs";
import { skeletonHTML, errorStateHTML, escapeHTML } from "../../core-v3/ui.mjs";
import { loadEmployeeById } from "./employees.mjs";
import * as contracts from "./contracts.mjs";
import * as leaves from "./leaves.mjs";
import * as discipline from "./discipline.mjs";
import * as documents from "./documents.mjs";
import * as attendance from "./attendance.mjs";
import * as blacklist from "./blacklist.mjs";

const TABS = [
  { key: "identite", label: "Identité" },
  { key: "affectation", label: "Affectation" },
  { key: "contrats", label: "Contrats" },
  { key: "conges", label: "Congés" },
  { key: "discipline", label: "Discipline" },
  { key: "documents", label: "Documents" },
  { key: "historique", label: "Historique" },
  { key: "pointage", label: "Pointage" },
  { key: "materiel", label: "Matériel" },
  { key: "blacklist", label: "Blacklist" },
];

// Sections avec mutation (formulaires) reçoivent un onRefresh() qui re-rend l'onglet courant
// (et, pour blacklist, l'en-tête). Sections en lecture seule n'ont pas de wire().
const SECTION_MODULES = {
  contrats: contracts,
  conges: leaves,
  discipline: discipline,
  documents: documents,
  blacklist: blacklist,
};

let root = null;
let state = { employeeId: null, activeTab: "identite", employee: null };
let tabRequestSeq = 0;

export async function mountEmployeeDossier(container, params) {
  root = container;
  const id = params?.id;
  state = { employeeId: id, activeTab: "identite", employee: null };
  root.innerHTML = `<div class="dn-page-head"><a class="dn-btn" href="#/drh/employees" style="margin-bottom:14px;display:inline-flex">← Retour aux employés</a></div><div class="dn-card dn-panel">${skeletonHTML("block")}</div>`;
  const raceCtx = captureRaceContext();
  try {
    const employee = await loadEmployeeById(id);
    if (!root || !isStillValid(raceCtx)) return; // navigation ailleurs, ou session changée, pendant l'attente
    state.employee = employee;
    renderShell(employee);
  } catch (err) {
    if (!root || !isStillValid(raceCtx)) return;
    root.innerHTML = `<div class="dn-page-head"><a class="dn-btn" href="#/drh/employees">← Retour aux employés</a></div><div class="dn-card dn-panel">${errorStateHTML(err, 'data-dn-retry-dossier')}</div>`;
    root.querySelector("[data-dn-retry-dossier]")?.addEventListener("click", () => mountEmployeeDossier(container, params));
  }
}

export function unmountEmployeeDossier() {
  root = null;
  state = { employeeId: null, activeTab: "identite", employee: null };
}

function blacklistBadgeHTML(e) {
  return blacklist.blacklistBadgeHTML(e);
}

function renderShell(employee) {
  if (!root) return;
  const name = `${employee.last_name || ""} ${employee.first_name || ""}`.trim();
  root.innerHTML = `
    <div class="dn-page-head"><a class="dn-btn" href="#/drh/employees" style="margin-bottom:14px;display:inline-flex">← Retour aux employés</a></div>
    <div class="dn-card dn-panel" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="dn-avatar" style="width:56px;height:56px;font-size:18px">${escapeHTML((((employee.first_name||"")[0]||"")+((employee.last_name||"")[0]||"")).toUpperCase() || "?")}</div>
        <div>
          <div style="font-weight:800;font-size:16px;display:flex;align-items:center;gap:8px">${escapeHTML(name || "—")}${blacklistBadgeHTML(employee)}</div>
          <div class="dn-error-state-text" style="margin:0">${escapeHTML(employee.code || "")} · ${escapeHTML(employee.position || "—")}</div>
        </div>
      </div>
    </div>
    <div class="dn-tabs" id="dn-dossier-tabs" role="tablist">
      ${TABS.map(t => `<button type="button" class="dn-tab" role="tab" aria-selected="${t.key === state.activeTab}" data-dn-tab="${t.key}">${escapeHTML(t.label)}</button>`).join("")}
    </div>
    <div class="dn-card dn-panel" id="dn-dossier-panel"></div>
  `;
  root.querySelectorAll("[data-dn-tab]").forEach(btn => {
    btn.addEventListener("click", () => selectTab(employee, btn.getAttribute("data-dn-tab")));
  });
  renderTab(employee, state.activeTab);
}

function selectTab(employee, tabKey) {
  state.activeTab = tabKey;
  root?.querySelectorAll("[data-dn-tab]").forEach(btn => btn.setAttribute("aria-selected", String(btn.getAttribute("data-dn-tab") === tabKey)));
  renderTab(employee, tabKey);
}

function renderTab(employee, tabKey) {
  if (!root) return;
  const panel = root.querySelector("#dn-dossier-panel");
  if (tabKey === "identite") { panel.innerHTML = identiteHTML(employee); return; }
  if (tabKey === "affectation") { panel.innerHTML = affectationHTML(employee); return; }
  if (tabKey === "historique") return loadReadOnlySection(employee, tabKey, attendance.renderHistorique);
  if (tabKey === "pointage") return loadReadOnlySection(employee, tabKey, attendance.renderPointage);
  if (tabKey === "materiel") return loadReadOnlySection(employee, tabKey, attendance.renderMateriel);
  const mod = SECTION_MODULES[tabKey];
  if (mod) loadSection(employee, tabKey, mod);
}

async function loadReadOnlySection(employee, tabKey, renderFn) {
  const panel = root.querySelector("#dn-dossier-panel");
  panel.innerHTML = skeletonHTML("table");
  const mySeq = ++tabRequestSeq;
  const raceCtx = captureRaceContext();
  try {
    const html = await renderFn(employee);
    if (mySeq !== tabRequestSeq || state.activeTab !== tabKey || !root || !isStillValid(raceCtx)) return;
    root.querySelector("#dn-dossier-panel").innerHTML = html;
  } catch (err) {
    if (err?.aborted) return;
    if (mySeq !== tabRequestSeq || state.activeTab !== tabKey || !root || !isStillValid(raceCtx)) return;
    const p = root.querySelector("#dn-dossier-panel");
    p.innerHTML = errorStateHTML(err, `data-dn-retry-tab="${tabKey}"`);
    p.querySelector(`[data-dn-retry-tab="${tabKey}"]`)?.addEventListener("click", () => loadReadOnlySection(employee, tabKey, renderFn));
  }
}

// Chargement paresseux d'une section mutable, uniquement à l'ouverture de l'onglet. Triple
// garde : séquence LOCALE à cet onglet (une réponse tardive d'un onglet quitté ne doit
// jamais s'afficher par-dessus le nouveau), onglet toujours actif, et race-guard global
// (session/navigation).
async function loadSection(employee, tabKey, mod) {
  if (!root) return;
  root.querySelector("#dn-dossier-panel").innerHTML = skeletonHTML("table");
  const mySeq = ++tabRequestSeq;
  const raceCtx = captureRaceContext();
  try {
    const html = await mod.render(employee);
    if (mySeq !== tabRequestSeq || state.activeTab !== tabKey || !root || !isStillValid(raceCtx)) return;
    root.querySelector("#dn-dossier-panel").innerHTML = html;
    const onRefresh = (refreshedEmployee) => {
      if (refreshedEmployee) Object.assign(employee, refreshedEmployee);
      if (tabKey === "blacklist") { renderShell(employee); return; } // ré-affiche aussi le badge d'en-tête
      if (state.activeTab === tabKey) loadSection(employee, tabKey, mod);
    };
    mod.wire?.(employee, onRefresh);
  } catch (err) {
    if (err?.aborted) return;
    if (mySeq !== tabRequestSeq || state.activeTab !== tabKey || !root || !isStillValid(raceCtx)) return;
    const p = root.querySelector("#dn-dossier-panel");
    p.innerHTML = errorStateHTML(err, `data-dn-retry-tab="${tabKey}"`);
    p.querySelector(`[data-dn-retry-tab="${tabKey}"]`)?.addEventListener("click", () => loadSection(employee, tabKey, mod));
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

export function _resetForTests() { root = null; state = { employeeId: null, activeTab: "identite", employee: null }; tabRequestSeq = 0; }
