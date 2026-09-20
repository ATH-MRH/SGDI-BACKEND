// DRH NEXT — modules/recruitment.mjs
//
// LOT 11B (finalisation) : parité recrutement, fermant les écarts P1 identifiés dans
// docs/drh-next-v1-parity.md (#22-25). Audit backend AVANT tout code
// (app/modules/drh/routes.py + service.py) :
// - GET /drh/candidates/page → RÉELLEMENT paginé/recherché/trié côté serveur (page,
//   page_size, q, mode, society, desired_position, recruiter_opinion, sort_key/direction).
//   RBAC dédié : _ensure_recruitment_access(user) — distinct de l'accès DRH générique,
//   géré ici comme n'importe quelle erreur (403 → état d'erreur, jamais un vide silencieux).
// - AUCUN GET /candidates/{id} : pas de fiche détail isolée côté backend. La ligne cliquée
//   dans la liste porte déjà TOUTES les données (CandidateOut complet) — le détail est donc
//   affiché depuis les données DÉJÀ EN MÉMOIRE, sans second appel réseau (zéro N+1, et
//   surtout : inventer un second fetch redondant aurait été le vrai gaspillage ici). Limite
//   assumée : pas de deep link direct sur une fiche candidat précise ce lot (aucune route
//   backend ne le permettrait proprement) — un rafraîchissement en détail revient à la liste,
//   même logique déjà acceptée pour la liste employés (DRH-NEXT-LIST-STATE).
// - Actions réelles disponibles, aucune fabriquée : convocation (email), marquer à
//   contractualiser, validation finale (mot de passe de validation, symétrique à Legacy),
//   recrutement (transforme le candidat en employé — la période d'essai qui suit est déjà
//   couverte par EmployeeOut.trial_end_date, LOT 3/9, aucun nouveau code nécessaire).
// - Dette pré-existante NON corrigée ici (hors périmètre, même nature que
//   DRH-NEXT-SEARCH-SQL) : list_candidates_page charge le vivier scope avant de paginer en
//   Python — mesuré négligeable au volume réel de candidatures (voir rapport de mission).
import { api } from "../core/api.mjs";
import { loadData, invalidate } from "../core/data-loader.mjs";
import { captureRaceContext, raceContextStillValid } from "../core/race-guard.mjs";
import { skeletonHTML, errorStateHTML, emptyStateHTML, paginationHTML, mount, escapeHTML } from "../core/ui.mjs";

const VIEW_SELECTOR = "#dn-view";
const DEFAULT_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const LIST_CACHE_KEY = () => `drh:recruitment:page=${state.page}:size=${state.pageSize}:q=${state.q}:mode=${state.mode}`;

let state = { page: 1, pageSize: DEFAULT_PAGE_SIZE, q: "", mode: "new", selected: null };
let searchDebounceTimer = null;
let listRequestSeq = 0;

export async function renderRecruitment() {
  state = { page: 1, pageSize: DEFAULT_PAGE_SIZE, q: "", mode: "new", selected: null };
  mount(VIEW_SELECTOR, listShellHTML());
  wireListControls();
  await loadList();
}

function listShellHTML() {
  return `<div class="dn-page-head"><h1>Recrutement</h1><p class="dn-error-state-text" style="text-align:left;margin:2px 0 0">Candidatures (recherche et filtre serveur — jamais la collection complète).</p></div>
  <div class="dn-search-row">
    <input type="search" class="dn-input" id="dn-rec-search" aria-label="Rechercher un candidat" placeholder="Nom, prénom, poste souhaité…">
    <select class="dn-select" id="dn-rec-mode" aria-label="Filtrer par statut">
      <option value="new">Nouvelles candidatures</option>
      <option value="reserve">Réserve</option>
      <option value="recruited">Recrutés</option>
      <option value="archive">Archivées</option>
    </select>
  </div>
  <div class="dn-card dn-panel" id="dn-rec-results">${skeletonHTML("table")}</div>`;
}

function wireListControls() {
  const search = document.querySelector("#dn-rec-search");
  search?.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => { state.q = search.value.trim(); state.page = 1; loadList(); }, SEARCH_DEBOUNCE_MS);
  });
  const mode = document.querySelector("#dn-rec-mode");
  mode.value = state.mode;
  mode?.addEventListener("change", () => { state.mode = mode.value; state.page = 1; loadList(); });
}

async function loadList() {
  const mySeq = ++listRequestSeq;
  const raceCtx = captureRaceContext();
  mount("#dn-rec-results", skeletonHTML("table"));
  try {
    const data = await loadData(LIST_CACHE_KEY(), (signal) => api.get("/drh/candidates/page?" + new URLSearchParams({
      page: String(state.page), page_size: String(state.pageSize), q: state.q, mode: state.mode,
    }), { signal }));
    if (mySeq !== listRequestSeq || !raceContextStillValid(raceCtx)) return;
    renderResults(data);
  } catch (err) {
    if (err?.aborted) return;
    if (mySeq !== listRequestSeq || !raceContextStillValid(raceCtx)) return;
    mount("#dn-rec-results", errorStateHTML(err, 'data-dn-retry-recruitment'));
    document.querySelector("[data-dn-retry-recruitment]")?.addEventListener("click", () => loadList());
  }
}

function renderResults(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) { mount("#dn-rec-results", emptyStateHTML(state.q ? "Aucun candidat ne correspond à votre recherche." : "Aucune candidature dans ce filtre.")); return; }
  mount("#dn-rec-results", `<table class="dn-table"><thead><tr><th>Nom et prénom</th><th>Poste souhaité</th><th>Société</th><th></th></tr></thead><tbody>
    ${items.map(c => `<tr data-dn-rec-open="${c.id}"><td>${escapeHTML(`${c.last_name || ""} ${c.first_name || ""}`.trim())}</td><td>${escapeHTML(c.desired_position || "—")}</td><td>${escapeHTML(c.society || "—")}</td><td><a class="dn-btn" href="#" data-dn-rec-open="${c.id}">Voir</a></td></tr>`).join("")}
  </tbody></table>
  ${paginationHTML(data.page, data.pages, data.total, 'data-dn-rec-page')}`);
  document.querySelectorAll("[data-dn-rec-page]").forEach(btn => {
    btn.addEventListener("click", () => { if (btn.hasAttribute("disabled")) return; state.page = Number(btn.getAttribute("data-dn-rec-page")); loadList(); });
  });
  document.querySelectorAll("[data-dn-rec-open]").forEach(el => {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      const id = Number(el.getAttribute("data-dn-rec-open"));
      const candidate = items.find(c => c.id === id);
      if (candidate) openDetail(candidate);
    });
  });
}

// Détail depuis les données déjà en mémoire (voir audit en tête de fichier) — zéro appel
// réseau supplémentaire pour l'affichage lui-même.
function openDetail(candidate) {
  state.selected = candidate;
  mount(VIEW_SELECTOR, detailHTML(candidate));
  wireDetail(candidate);
}

function detailHTML(c) {
  const name = `${c.last_name || ""} ${c.first_name || ""}`.trim();
  const rows = [
    ["Téléphone", c.phone], ["Email", c.email], ["Poste souhaité", c.desired_position],
    ["Société", c.society], ["Salaire attendu", c.expected_salary], ["Avis recruteur", c.recruiter_opinion],
    ["Statut", c.status],
  ];
  return `<div class="dn-page-head"><button type="button" class="dn-btn" id="dn-rec-back" style="margin-bottom:14px">← Retour aux candidatures</button><h1 style="margin-top:10px">${escapeHTML(name || "Candidat")}</h1></div>
  <div class="dn-card dn-panel" style="margin-bottom:14px">
    <table class="dn-table">${rows.map(([label, value]) => `<tr><th style="width:200px">${escapeHTML(label)}</th><td>${escapeHTML(value ?? "—")}</td></tr>`).join("")}</table>
  </div>
  <div class="dn-card dn-panel">
    <div class="dn-panel-head">Actions</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">
      <div>
        <button type="button" class="dn-btn" id="dn-rec-convoke-toggle">Convoquer</button>
        <form id="dn-rec-convoke-form" hidden style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <div><label for="dn-rec-convoke-date" style="font-size:12px;font-weight:700;display:block">Date</label><input class="dn-input" id="dn-rec-convoke-date" type="date" name="date" required></div>
          <div><label for="dn-rec-convoke-heure" style="font-size:12px;font-weight:700;display:block">Heure</label><input class="dn-input" id="dn-rec-convoke-heure" type="time" name="heure" required></div>
          <div><label for="dn-rec-convoke-lieu" style="font-size:12px;font-weight:700;display:block">Lieu</label><input class="dn-input" id="dn-rec-convoke-lieu" name="lieu" required></div>
          <div><label for="dn-rec-convoke-motif" style="font-size:12px;font-weight:700;display:block">Motif</label><input class="dn-input" id="dn-rec-convoke-motif" name="motif" required></div>
          <button type="submit" class="dn-btn dn-btn-primary">Envoyer</button>
        </form>
      </div>
      <button type="button" class="dn-btn" id="dn-rec-contractualiser">Marquer à contractualiser</button>
      <div>
        <button type="button" class="dn-btn" id="dn-rec-validate-toggle">Validation finale</button>
        <form id="dn-rec-validate-form" hidden style="margin-top:10px;display:flex;gap:8px;align-items:flex-end">
          <div><label for="dn-rec-validate-pwd" style="font-size:12px;font-weight:700;display:block">Mot de passe de validation</label><input class="dn-input" id="dn-rec-validate-pwd" type="password" name="validation_password" required></div>
          <button type="submit" class="dn-btn dn-btn-primary">Valider</button>
        </form>
      </div>
      <button type="button" class="dn-btn dn-btn-primary" id="dn-rec-recruit">Recruter</button>
    </div>
    <div id="dn-rec-action-error" class="dn-error-state-text" style="margin-top:10px"></div>
    <div id="dn-rec-action-success" class="dn-error-state-text" style="margin-top:4px"></div>
  </div>`;
}

function showActionError(err) {
  const el = document.querySelector("#dn-rec-action-error");
  if (el) el.textContent = err?.message || "Action impossible.";
}
function showActionSuccess(msg) {
  const el = document.querySelector("#dn-rec-action-success");
  if (el) el.textContent = msg;
}
function clearActionMessages() {
  document.querySelector("#dn-rec-action-error")?.replaceChildren();
  document.querySelector("#dn-rec-action-success")?.replaceChildren();
}

function wireDetail(candidate) {
  document.querySelector("#dn-rec-back")?.addEventListener("click", () => renderRecruitment());

  document.querySelector("#dn-rec-convoke-toggle")?.addEventListener("click", () => {
    const form = document.querySelector("#dn-rec-convoke-form"); form.hidden = !form.hidden;
  });
  document.querySelector("#dn-rec-convoke-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    clearActionMessages();
    const fd = new FormData(ev.target);
    try {
      const res = await api.post(`/drh/candidates/${candidate.id}/convocation-email`, {
        date: fd.get("date"), heure: fd.get("heure"), lieu: fd.get("lieu"), motif: fd.get("motif"),
      });
      // Trouvé en vérification live : le backend répond 200 MÊME quand l'envoi échoue
      // réellement (ex. candidat sans email) — le vrai résultat est dans
      // data.email_sent/data.delivery.error, jamais dans le code HTTP seul. Un succès
      // HTTP ne doit donc jamais être confondu avec un succès métier ici.
      if (res?.data?.email_sent) {
        showActionSuccess("Convocation envoyée.");
      } else {
        showActionError({ message: res?.data?.delivery?.error || "L'envoi de la convocation a échoué." });
      }
    } catch (err) { showActionError(err); }
  });

  document.querySelector("#dn-rec-contractualiser")?.addEventListener("click", async () => {
    clearActionMessages();
    try {
      await api.post(`/drh/candidates/${candidate.id}/marquer-contractualisation`);
      invalidate(/^drh:recruitment:/);
      showActionSuccess("Candidat marqué à contractualiser.");
    } catch (err) { showActionError(err); }
  });

  document.querySelector("#dn-rec-validate-toggle")?.addEventListener("click", () => {
    const form = document.querySelector("#dn-rec-validate-form"); form.hidden = !form.hidden;
  });
  document.querySelector("#dn-rec-validate-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    clearActionMessages();
    const fd = new FormData(ev.target);
    try {
      await api.post(`/drh/candidates/${candidate.id}/validate-final`, { validation_password: fd.get("validation_password") });
      invalidate(/^drh:recruitment:/);
      showActionSuccess("Dossier validé.");
    } catch (err) { showActionError(err); }
  });

  document.querySelector("#dn-rec-recruit")?.addEventListener("click", async () => {
    clearActionMessages();
    try {
      await api.post(`/drh/candidates/${candidate.id}/recruit`);
      invalidate(/^drh:recruitment:/);
      showActionSuccess("Candidat recruté : l'employé est désormais consultable dans l'annuaire.");
    } catch (err) { showActionError(err); }
  });
}
