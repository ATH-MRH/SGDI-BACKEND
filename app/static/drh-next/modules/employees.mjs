// DRH NEXT — modules/employees.mjs
//
// LOT 2 : liste employés en pagination SERVEUR exclusive + fiche minimale.
// INTERDICTION ABSOLUE respectée : jamais d'appel à /api/drh/employees (collection
// complète) — uniquement /api/drh/employees/page (paginé) et /api/drh/employees/{id}
// (fiche, sur clic uniquement). Aucun découpage de liste en mémoire côté client.
//
// Audit API (LOT 2 §2, avant tout code) — app/modules/drh/service.py::list_employees_page :
// - pagination : page, page_size (backend borne 5-100) — réels, SQL OFFSET/LIMIT sans texte
//   de recherche.
// - recherche (q) : texte libre sur nom/prénom/code/société/poste/matricule/fonction/site.
//   AVEC recherche, le backend charge en mémoire (côté SERVEUR) le sous-ensemble préfiltré
//   SQL puis pagine en Python (commentaire du code source lui-même le documente) — ce n'est
//   pas un vrai OFFSET/LIMIT SQL dans ce cas. Mesuré au LOT 2 (voir rapport) ; non corrigé
//   ici car aucune preuve que ça dépasse le budget à l'échelle testée — documenté comme
//   piste d'optimisation backend future, pas fabriqué côté client.
// - filtres : UNIQUEMENT "mode" (statut : actifs/absents/suspension/sortants/tous). Aucun
//   filtre site/fonction/type de contrat côté backend actuellement — donc AUCUN de ces
//   filtres n'est affiché ici (interdiction de fabriquer un filtre qui téléchargerait toute
//   la population pour le simuler côté client).
// - tri : AUCUN paramètre de tri exposé par le backend (ordre fixe nom/prénom/id). Donc
//   aucune UI de tri dans ce lot — un tri fabriqué côté client nécessiterait la collection
//   complète, exactement ce qui est interdit.
// - payload liste : EmployeePage.items utilise EmployeeOut (même schéma que la fiche
//   détail complète, pas un ListItem allégé) — mesuré au LOT 2, documenté dans le rapport.
//   Pas de N+1 : affectation/site actuel déjà joints serveur (_attach_current_assignments,
//   une seule requête SQL supplémentaire pour toute la page, jamais par ligne).
// - RBAC/scope : current_user requis ; société effective (_effective_society_filter) ou
//   liste de sociétés autorisées appliquée AVANT toute requête SQL — jamais de fuite
//   société, y compris sur l'accès direct par ID (_ensure_employee_allowed).
import { api } from "../core/api.mjs";
import { loadData, invalidate } from "../core/data-loader.mjs";
import { captureRaceContext, raceContextStillValid } from "../core/race-guard.mjs";
import { skeletonHTML, errorStateHTML, emptyStateHTML, paginationHTML, initialsAvatarHTML, mount, escapeHTML } from "../core/ui.mjs";
import { navigate } from "../core/router.mjs";
import { getSessionGeneration } from "../core/session.mjs";

const VIEW_SELECTOR = "#dn-view";
const DEFAULT_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

// État LOCAL à cet écran uniquement (pas un state global façon db={}) : la page/recherche/
// mode courants, pour reconstruire la vue après une action (page suivante, changement de
// filtre) sans perdre le contexte.
// LOT 12 (finalisation, §18) — dette DRH-NEXT-LIST-STATE fermée : préservé (plus jamais
// réinitialisé inconditionnellement à chaque entrée sur l'écran) pour que "ouvrir un
// employé -> Retour" restaure page/recherche/mode. Solution volontairement minimale : pas
// de nouveau store, juste ce même objet local qui survit déjà entre les appels tant que le
// module reste chargé (aucun code supplémentaire nécessaire pour ça). Seule garde ajoutée :
// un changement de SESSION (logout/login) réinitialise explicitement, pour ne jamais laisser
// une recherche tapée par un compte apparaître comme état de départ pour un autre.
let state = { page: 1, pageSize: DEFAULT_PAGE_SIZE, q: "", mode: "actifs", sessionGen: getSessionGeneration() };
let searchDebounceTimer = null;
// Protection course recherche/pagination (LOT 2 §13) : changer de page ou de recherche NE
// change PAS la route (#/employees reste #/employees), donc navigationGeneration ne bouge
// pas — un compteur local dédié est nécessaire en plus du race-guard global (qui protège
// lui la navigation ENTRE écrans et les changements de session, toujours actifs ici aussi).
let listRequestSeq = 0;
let currentListPromise = null;

function employeesListKey() {
  return `drh:employees:page=${state.page}:size=${state.pageSize}:q=${state.q}:mode=${state.mode}`;
}

export function invalidateEmployeesList() { invalidate(/^drh:employees:/); }

export async function renderEmployees() {
  if (state.sessionGen !== getSessionGeneration()) {
    state = { page: 1, pageSize: DEFAULT_PAGE_SIZE, q: "", mode: "actifs", sessionGen: getSessionGeneration() };
  }
  mount(VIEW_SELECTOR, employeesShellHTML());
  // Trouvé pendant la revue LOT 2 : câbler les contrôles APRÈS le premier chargement les
  // rendait inertes tant que celui-ci n'était pas terminé (recherche/filtre injoignables si
  // la première page est lente) — câblés ICI, avant l'attente, pour rester interactifs dès
  // l'affichage du squelette.
  wireStaticControls();
  await loadList();
}

function employeesShellHTML() {
  return `<div class="dn-page-head"><h1>Employés</h1><p class="dn-error-state-text" style="text-align:left;margin:2px 0 0">Gestion du personnel de la société active</p></div>
  <div class="dn-search-row">
    <input type="search" class="dn-input" id="dn-emp-search" aria-label="Rechercher un employé" placeholder="Rechercher par code, nom, prénom, fonction…" value="${escapeHTML(state.q)}">
    <select class="dn-select" id="dn-emp-mode" aria-label="Filtrer par statut">
      <option value="actifs">Actifs</option>
      <option value="absents">Absents</option>
      <option value="suspension">Suspendus</option>
      <option value="sortants">Sortants</option>
      <option value="tous">Tous</option>
    </select>
    <span class="dn-loading-inline" id="dn-emp-loading-indicator" aria-live="polite"></span>
  </div>
  <div class="dn-card dn-panel" id="dn-emp-results">${skeletonHTML("table")}</div>`;
}

function wireStaticControls() {
  const search = document.querySelector("#dn-emp-search");
  search?.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.q = search.value.trim();
      state.page = 1; // §5 : nouvelle recherche -> retour page 1
      loadList();
    }, SEARCH_DEBOUNCE_MS);
  });
  const mode = document.querySelector("#dn-emp-mode");
  if (mode) mode.value = state.mode; // reflète l'état préservé (LOT 12 §18), pas toujours "actifs"
  mode?.addEventListener("change", () => {
    state.mode = mode.value;
    state.page = 1;
    loadList();
  });
}

async function loadList() {
  const mySeq = ++listRequestSeq;
  const raceCtx = captureRaceContext();
  const indicator = document.querySelector("#dn-emp-loading-indicator");
  if (indicator) indicator.textContent = "Actualisation…";
  // Une recherche/pagination encore en vol devient obsolète dès qu'une nouvelle requête de
  // liste démarre — abort explicite en plus du garde par séquence (défense en profondeur,
  // évite de garder une connexion réseau occupée pour rien).
  if (currentListPromise?.abort) currentListPromise.abort();
  const promise = loadData(employeesListKey(), (signal) => api.get("/drh/employees/page?" + new URLSearchParams({
    page: String(state.page), page_size: String(state.pageSize), q: state.q, mode: state.mode,
  }), { signal }));
  currentListPromise = promise;
  try {
    const data = await promise;
    if (mySeq !== listRequestSeq || !raceContextStillValid(raceCtx)) return; // réponse obsolète (recherche/page suivante, ou session/navigation a changé)
    renderResults(data);
  } catch (err) {
    if (err?.aborted) return; // annulation volontaire, pas une vraie erreur à afficher
    if (mySeq !== listRequestSeq || !raceContextStillValid(raceCtx)) return;
    mount("#dn-emp-results", errorStateHTML(err, 'data-dn-retry-employees'));
    document.querySelector("[data-dn-retry-employees]")?.addEventListener("click", () => loadList());
  } finally {
    if (mySeq === listRequestSeq && indicator) indicator.textContent = "";
  }
}

function renderResults(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) {
    mount("#dn-emp-results", emptyStateHTML(state.q ? "Aucun employé ne correspond à votre recherche." : "Aucun employé trouvé."));
    return;
  }
  const rows = items.map(rowHTML).join("");
  mount("#dn-emp-results", `<div style="overflow-x:auto"><table class="dn-table">
    <thead><tr><th></th><th>Code</th><th>Nom et prénom</th><th>Fonction</th><th>Site actuel</th><th>Contrat</th><th>Statut</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  ${paginationHTML(data.page, data.pages, data.total, 'data-dn-emp-page')}`);
  document.querySelectorAll("[data-dn-emp-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.hasAttribute("disabled")) return;
      state.page = Number(btn.getAttribute("data-dn-emp-page"));
      loadList();
    });
  });
  document.querySelectorAll("[data-dn-emp-open]").forEach(el => {
    el.addEventListener("click", () => navigate("employees/" + el.getAttribute("data-dn-emp-open")));
  });
}

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "actif" || s === "active") return "dn-badge-success";
  if (s === "suspendu") return "dn-badge-danger";
  if (s === "absent") return "dn-badge-warning";
  return "dn-badge";
}

function rowHTML(e) {
  const name = `${e.last_name || ""} ${e.first_name || ""}`.trim();
  return `<tr class="dn-table-row-link" data-dn-emp-open="${e.id}">
    <td>${initialsAvatarHTML(e.first_name, e.last_name)}</td>
    <td>${escapeHTML(e.code)}</td>
    <td>${escapeHTML(name)}</td>
    <td>${escapeHTML(e.position || "—")}</td>
    <td>${escapeHTML(e.current_site_name || "—")}</td>
    <td>${escapeHTML(e.contract_type || "—")}</td>
    <td><span class="dn-badge ${statusBadgeClass(e.status)}">${escapeHTML(e.status || "—")}</span></td>
    <td><a class="dn-btn" href="#/employees/${e.id}">Voir</a></td>
  </tr>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chargement partagé d'un employé par ID (LOT 3 §8 : extrait ici pour que le Dossier
// 360° et cette fiche minimale utilisent le MÊME unique point d'appel — jamais deux
// implémentations qui dupliqueraient la clé de cache/TTL, avec le risque qu'elles
// divergent silencieusement. Comportement inchangé pour renderEmployeeDetail, revérifié
// par les tests LOT 2 existants sans modification.
export async function loadEmployeeById(id) {
  return loadData(`drh:employee:${id}`, (signal) => api.get(`/drh/employees/${encodeURIComponent(id)}`, { signal }), { ttlMs: 10000 });
}

// Fiche minimale (LOT 2 §11) — remplacée comme écran de détail par le Dossier 360°
// (LOT 3, modules/employee-dossier.mjs) mais conservée ici : fonction pure, toujours
// exportée et testée indépendamment, aucune raison de la supprimer.
export async function renderEmployeeDetail(params) {
  const id = params?.id;
  mount(VIEW_SELECTOR, `<div class="dn-page-head"><h1>Employé</h1></div><div class="dn-card dn-panel">${skeletonHTML("block")}</div>`);
  const raceCtx = captureRaceContext();
  try {
    const employee = await loadEmployeeById(id);
    if (!raceContextStillValid(raceCtx)) return; // navigation vers un autre employé/écran, ou session changée, pendant l'attente
    mount(VIEW_SELECTOR, employeeDetailHTML(employee));
  } catch (err) {
    if (!raceContextStillValid(raceCtx)) return;
    mount(VIEW_SELECTOR, `<div class="dn-page-head"><h1>Employé</h1></div><div class="dn-card dn-panel">${errorStateHTML(err, 'data-dn-retry-employee-detail')}</div>`);
    document.querySelector("[data-dn-retry-employee-detail]")?.addEventListener("click", () => renderEmployeeDetail(params));
  }
}

function employeeDetailHTML(e) {
  const name = `${e.last_name || ""} ${e.first_name || ""}`.trim();
  const rows = [
    ["Matricule", e.code],
    ["Fonction", e.position],
    ["Statut", e.status],
    ["Société", e.society],
    ["Site actuel", e.current_site_name],
    ["Type de contrat", e.contract_type],
    ["Date de recrutement", e.recruit_date],
    ["Fin de période d'essai", e.trial_end_date],
  ];
  return `<div class="dn-page-head"><a class="dn-btn" href="#/employees" style="margin-bottom:14px;display:inline-flex">← Retour aux employés</a><h1 style="margin-top:10px">${escapeHTML(name || "Employé")}</h1></div>
  <div class="dn-card dn-panel">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
      <div class="dn-avatar" style="width:56px;height:56px;font-size:18px">${escapeHTML((((e.first_name||"")[0]||"")+((e.last_name||"")[0]||"")).toUpperCase() || "?")}</div>
      <div><div style="font-weight:800;font-size:16px">${escapeHTML(name || "—")}</div><div class="dn-error-state-text" style="margin:0">${escapeHTML(e.code || "")}</div></div>
    </div>
    <table class="dn-table">${rows.map(([label, value]) => `<tr><th style="width:220px">${escapeHTML(label)}</th><td>${escapeHTML(value || "—")}</td></tr>`).join("")}</table>
  </div>`;
}

// Réservé aux tests — même remarque que les autres modules (core/session.js) : ce module
// est un singleton réel en exécution normale (state module-local, jamais réinitialisé
// entre deux appels de renderEmployees() depuis le LOT 12 §18 — voir plus haut). En
// environnement de test, freshEnv() (dom-env.mjs) l'appelle pour éviter qu'un test
// contamine le suivant avec une recherche/page laissée par le test précédent.
export function _resetForTests() { state = { page: 1, pageSize: DEFAULT_PAGE_SIZE, q: "", mode: "actifs", sessionGen: getSessionGeneration() }; listRequestSeq = 0; currentListPromise = null; }
