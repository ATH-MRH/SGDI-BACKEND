// ATLAS Site Workforce — client API partagé + utilitaires. Même architecture que
// app/static/finance-platform/ (aucun framework, pas de build, window.SW) : PAS de
// sélecteur libre de société/site ici (§B6) — le site est imposé côté serveur
// (User.authorized_sites), l'écran l'affiche mais ne le laisse jamais choisir.
(function () {
  "use strict";

  const API = "/api";
  const STORAGE_KEY = "sw_token";

  const state = {
    token: localStorage.getItem(STORAGE_KEY) || null,
    user: null,
    site: null, // rempli par dashboard() au premier chargement — jamais choisi côté client
  };

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

  async function api(path, { method = "GET", body, formData, signal, params } = {}) {
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
  function guardedApi(slot, path, opts = {}) {
    const prev = inflight.get(slot);
    if (prev) prev.abort();
    const controller = new AbortController();
    inflight.set(slot, controller);
    return api(path, { ...opts, signal: controller.signal }).finally(() => {
      if (inflight.get(slot) === controller) inflight.delete(slot);
    });
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
    login, logout, hasModule, hasSiteWorkforceAccess,
    statusBadge, ATTENDANCE_STATUS, ABSENCE_DECISION_STATUS, DOCUMENT_STATUS, LEAVE_STATUS, DISCIPLINE_STATUS, RECLAMATION_STATUS,
    skeletonKpis, skeletonRows, emptyState, errorState,
    openDrawer, closeDrawer, kvRow, confirmAction, paginationBar, readFileAsDataUrl,
  };
})();
