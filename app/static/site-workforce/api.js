// ATLAS Site Workforce — client API partagé + utilitaires. Même architecture que
// app/static/finance-platform/ (aucun framework, pas de build, window.SW).
// Périmètre : le serveur résout les sociétés/sites AUTORISÉS du compte (/site-workforce/scope).
// Le sélecteur Société/Site ne fait que RÉDUIRE la vue (?society= / ?site_id=, ajoutés à
// chaque appel du module) ; toute valeur hors périmètre est refusée par le serveur (403).
// Chaque changement de périmètre incrémente scopeEpoch : une réponse arrivée après un
// changement est ignorée (jamais de donnée périmée affichée sous le nouveau périmètre).
(function () {
  "use strict";

  const API = "/api";
  const STORAGE_KEY = "sw_token";
  const SCOPE_KEY = "sw_scope";

  const state = {
    token: localStorage.getItem(STORAGE_KEY) || null,
    user: null,
    site: null,        // site consulté quand la vue porte sur un site unique
    scopeInfo: null,   // { societies: [...], sites: [{id, name, society}] } — périmètre AUTORISÉ
    scope: { society: "", site_id: "" }, // sélection courante ("" = toutes / tous)
    scopeEpoch: 0,
  };

  // Sélection mémorisée PAR COMPTE : un autre utilisateur du même navigateur ne reprend
  // jamais la sélection du précédent (le serveur la revaliderait, mais l'écran s'ouvrirait
  // sur un périmètre que ce compte n'a pas choisi).
  function currentUsername() { return String((state.user && state.user.username) || "").toLowerCase(); }
  function readStoredScope() {
    try {
      const stored = JSON.parse(localStorage.getItem(SCOPE_KEY) || "null") || {};
      return stored.user && stored.user === currentUsername() ? stored : {};
    } catch (e) { return {}; }
  }
  function storeScope() {
    try { localStorage.setItem(SCOPE_KEY, JSON.stringify({ ...state.scope, user: currentUsername() })); } catch (e) { /* stockage indisponible : sans effet */ }
  }
  function scopeSites(society) {
    const sites = (state.scopeInfo && state.scopeInfo.sites) || [];
    return society ? sites.filter((s) => s.society === society) : sites;
  }
  // Fixe le périmètre consulté, toujours DANS le périmètre autorisé (valeur inconnue -> "tout").
  // Un compte à une seule société / un seul site est positionné automatiquement dessus.
  function setScope(next) {
    const info = state.scopeInfo || { societies: [], sites: [] };
    let society = String((next && next.society) || "");
    let siteId = String((next && next.site_id) || "");
    if (info.societies.length === 1) society = info.societies[0];
    if (society && !info.societies.includes(society)) society = "";
    const sites = scopeSites(society);
    if (sites.length === 1) siteId = String(sites[0].id);
    if (siteId && !sites.some((s) => String(s.id) === siteId)) siteId = "";
    const changed = society !== state.scope.society || siteId !== state.scope.site_id;
    state.scope = { society, site_id: siteId };
    state.site = siteId ? sites.find((s) => String(s.id) === siteId) || null : null;
    if (changed) { state.scopeEpoch += 1; abortAll(); }
    storeScope();
    return changed;
  }
  function scopeLabel() {
    const { society, site_id: siteId } = state.scope;
    if (siteId && state.site) return `Site : ${state.site.name}${state.site.society ? " — " + state.site.society : ""}`;
    const n = scopeSites(society).length;
    return society ? `Société : ${society} — tous mes sites (${n})` : `Toutes mes sociétés — tous mes sites (${n})`;
  }
  // Libellé du périmètre AUTORISÉ (sidebar) : le site s'il est unique, sinon le nombre de
  // sites — jamais « Site : — ». La sélection en cours est affichée dans le header.
  function perimeterLabel() {
    const sites = scopeSites("");
    if (sites.length === 1) return `Site : ${sites[0].name}`;
    return `Périmètre : ${sites.length} sites`;
  }
  function scopeParams() {
    const out = {};
    if (state.scope.society) out.society = state.scope.society;
    if (state.scope.site_id) out.site_id = state.scope.site_id;
    return out;
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function dateFr(v) {
    if (!v) return "—";
    const d = new Date(v + (String(v).length === 10 ? "T00:00:00" : ""));
    if (isNaN(d.getTime())) return esc(v);
    return d.toLocaleDateString("fr-FR");
  }

  class ApiError extends Error {
    constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
  }

  async function api(path, { method = "GET", body, formData, signal, params, scope = true } = {}) {
    // Périmètre consulté ajouté à chaque appel du module (le serveur le revalide) ; les
    // paramètres explicites de l'appelant priment, scope:false le désactive (ex. cloche).
    if (scope && path.startsWith("/site-workforce") && path !== "/site-workforce/scope") {
      params = { ...scopeParams(), ...(params || {}) };
    }
    const headers = {};
    if (state.token) headers.Authorization = "Bearer " + state.token;
    let payload;
    if (formData) payload = formData;
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    let url = API + path;
    if (params) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") qs.set(k, v); });
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }
    const res = await fetch(url, { method, headers, body: payload, signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      const message = (data && (data.detail || data.error)) || `Erreur ${res.status}`;
      throw new ApiError(typeof message === "string" ? message : JSON.stringify(message), res.status, data);
    }
    return data;
  }

  const inflight = new Map();
  function abortAll() {
    inflight.forEach((controller) => controller.abort());
    inflight.clear();
  }
  function staleError() {
    const err = new Error("Réponse d'un périmètre précédent ignorée");
    err.name = "AbortError";
    return err;
  }
  function guardedApi(slot, path, opts = {}) {
    const prev = inflight.get(slot);
    if (prev) prev.abort();
    const controller = new AbortController();
    inflight.set(slot, controller);
    const epoch = state.scopeEpoch;
    return api(path, { ...opts, signal: controller.signal }).then((data) => {
      if (epoch !== state.scopeEpoch) throw staleError();
      return data;
    }).finally(() => {
      if (inflight.get(slot) === controller) inflight.delete(slot);
    });
  }
  async function loadScope() {
    state.scopeInfo = await api("/site-workforce/scope");
    setScope(readStoredScope());
    return state.scopeInfo;
  }

  async function login(username, password) {
    const data = await api("/auth/login", { method: "POST", body: { username, password } });
    state.token = data.access_token;
    localStorage.setItem(STORAGE_KEY, state.token);
    state.user = await api("/auth/me");
    return data;
  }
  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    state.token = null;
    state.user = null;
    state.site = null;
    state.scopeInfo = null;
    state.scope = { society: "", site_id: "" };
    state.scopeEpoch += 1;
    abortAll();
    try { localStorage.removeItem(SCOPE_KEY); } catch (e) { /* sans effet */ }
  }
  function hasModule(mod) {
    return !!(state.user && (state.user.module_access_global || (state.user.effective_modules || []).includes(mod)));
  }
  function hasSiteWorkforceAccess() { return hasModule("site_workforce"); }

  function statusBadge(status, map) {
    const cfg = (map || {})[status] || {};
    return `<span class="badge ${cfg.tone || "neutral"}">${esc(cfg.label || status)}</span>`;
  }
  const ATTENDANCE_STATUS = {
    present: { tone: "success", label: "présent" }, absent: { tone: "danger", label: "absent" },
    conge: { tone: "info", label: "congé" }, maladie: { tone: "warn", label: "maladie" },
    repos: { tone: "neutral", label: "repos" }, mission: { tone: "info", label: "mission" },
    non_pointe: { tone: "neutral", label: "non pointé" },
  };
  const ABSENCE_DECISION_STATUS = {
    en_attente: { tone: "warn", label: "en attente" }, justifiee: { tone: "success", label: "justifiée" },
    injustifiee: { tone: "danger", label: "injustifiée" },
  };
  const DOCUMENT_STATUS = {
    en_attente: { tone: "warn", label: "à vérifier" }, conforme: { tone: "success", label: "conforme" },
    non_conforme: { tone: "danger", label: "non conforme" },
  };
  const LEAVE_STATUS = {
    instance: { tone: "warn", label: "en attente DRH" }, approuve: { tone: "success", label: "approuvé" },
    refuse: { tone: "danger", label: "refusé" },
  };
  const DISCIPLINE_STATUS = {
    brouillon: { tone: "neutral", label: "brouillon" }, signale: { tone: "warn", label: "signalé" },
    transmis: { tone: "info", label: "transmis" }, en_cours_drh: { tone: "info", label: "en cours DRH" },
    decision: { tone: "warn", label: "décision" }, cloture: { tone: "success", label: "clôturé" },
  };
  const RECLAMATION_STATUS = {
    nouvelle: { tone: "warn", label: "nouvelle" }, en_cours: { tone: "info", label: "en cours" },
    transmise: { tone: "info", label: "transmise" }, reponse_recue: { tone: "success", label: "réponse reçue" },
    cloturee: { tone: "neutral", label: "clôturée" },
  };

  function skeletonKpis(n) { return `<div class="skeleton-kpis">${Array.from({ length: n || 5 }).map(() => '<div class="skeleton skeleton-kpi"></div>').join("")}</div>`; }
  function skeletonRows(n) { return Array.from({ length: n || 5 }).map(() => '<div class="skeleton skeleton-row"></div>').join(""); }
  function emptyState(text) { return `<div class="empty-state">${esc(text)}</div>`; }
  function errorState(err) {
    const msg = err instanceof ApiError ? err.message : (err && err.message) || "Erreur inconnue";
    return `<div class="error-state"><div class="error-state-title">Impossible de charger ces données</div><div class="error-state-text">${esc(msg)}</div></div>`;
  }

  function openDrawer(title, bodyHtml) {
    closeDrawer();
    const scrim = document.createElement("div");
    scrim.className = "drawer-scrim";
    scrim.id = "sw-drawer-scrim";
    scrim.innerHTML = `<div class="drawer"><div class="drawer-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-sm" data-close-drawer>✕</button></div><div class="drawer-body">${bodyHtml}</div></div>`;
    scrim.addEventListener("click", (e) => { if (e.target === scrim || e.target.closest("[data-close-drawer]")) closeDrawer(); });
    document.body.appendChild(scrim);
    document.addEventListener("keydown", drawerEscHandler);
  }
  function drawerEscHandler(e) { if (e.key === "Escape") closeDrawer(); }
  function closeDrawer() {
    const el = document.getElementById("sw-drawer-scrim");
    if (el) el.remove();
    document.removeEventListener("keydown", drawerEscHandler);
  }
  function kvRow(label, value) { return `<div class="kv-row"><span>${esc(label)}</span><b>${value}</b></div>`; }
  // Colonnes de contexte d'une vue agrégée : jamais une ligne sans son site/sa société.
  function multiSite() { return !state.scope.site_id && scopeSites(state.scope.society).length > 1; }
  function siteHeaders() { return multiSite() ? "<th>Société</th><th>Site</th>" : ""; }
  function siteCells(row) { return multiSite() ? `<td>${esc(row.society || "—")}</td><td>${esc(row.site_name || "—")}</td>` : ""; }
  function employeeLabel(row) {
    const name = row.employee_name ? `${esc(row.employee_name)} ` : "";
    return row.employee_id ? `${name}<span class="muted">#${row.employee_id}${row.employee_code ? " · " + esc(row.employee_code) : ""}</span>` : "—";
  }
  // Choix du site pour une création : limité aux sites consultés (le serveur revérifie).
  function siteSelectHTML(name, { required } = {}) {
    const sites = state.scope.site_id ? scopeSites(state.scope.society).filter((s) => String(s.id) === state.scope.site_id) : scopeSites(state.scope.society);
    if (sites.length <= 1) return sites.length ? `<input type="hidden" name="${name}" value="${sites[0].id}">` : "";
    return `<div class="field"><label>Site${required ? "" : " (déduit de l'affectation si vide)"}</label><select name="${name}" ${required ? "required" : ""}>
      <option value="">${required ? "Choisir…" : "Affectation de l'employé"}</option>
      ${sites.map((s) => `<option value="${s.id}">${esc(s.name)}${s.society ? " — " + esc(s.society) : ""}</option>`).join("")}
    </select></div>`;
  }

  function confirmAction({ title, impact, confirmLabel, danger }) {
    return new Promise((resolve) => {
      const scrim = document.createElement("div");
      scrim.className = "confirm-scrim";
      scrim.innerHTML = `<div class="confirm-box">
        <h3>${esc(title)}</h3>
        <div class="confirm-impact">${impact.map(([k, v]) => kvRow(k, v)).join("")}</div>
        <div class="confirm-actions">
          <button class="btn btn-sm" data-cancel>Annuler</button>
          <button class="btn btn-sm ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${esc(confirmLabel || "Confirmer")}</button>
        </div>
      </div>`;
      function cleanup(result) { scrim.remove(); resolve(result); }
      scrim.addEventListener("click", (e) => {
        if (e.target === scrim || e.target.closest("[data-cancel]")) cleanup(false);
        if (e.target.closest("[data-confirm]")) cleanup(true);
      });
      document.body.appendChild(scrim);
    });
  }

  function paginationBar(pageInfo, onPage) {
    const { page, pages, total } = pageInfo;
    const el = document.createElement("div");
    el.className = "pagination";
    el.innerHTML = `<span>${total} résultat${total > 1 ? "s" : ""} — page ${page}/${pages}</span>
      <button class="btn btn-sm" ${page <= 1 ? "disabled" : ""} data-prev>Précédent</button>
      <button class="btn btn-sm" ${page >= pages ? "disabled" : ""} data-next>Suivant</button>`;
    el.querySelector("[data-prev]")?.addEventListener("click", () => onPage(page - 1));
    el.querySelector("[data-next]")?.addEventListener("click", () => onPage(page + 1));
    return el;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  window.SW = {
    state, api, guardedApi, esc, dateFr, ApiError,
    loadScope, setScope, scopeSites, scopeLabel, perimeterLabel, scopeParams, multiSite, siteHeaders, siteCells, employeeLabel, siteSelectHTML,
    login, logout, hasModule, hasSiteWorkforceAccess,
    statusBadge, ATTENDANCE_STATUS, ABSENCE_DECISION_STATUS, DOCUMENT_STATUS, LEAVE_STATUS, DISCIPLINE_STATUS, RECLAMATION_STATUS,
    skeletonKpis, skeletonRows, emptyState, errorState,
    openDrawer, closeDrawer, kvRow, confirmAction, paginationBar, readFileAsDataUrl,
  };
})();
