// ATLAS Finance Platform V2 — client API partagé + utilitaires (formatage, confirmation
// d'action sensible, drawer, skeleton, race-guards). Aucun framework, pas de build : chargé
// en <script> classique, expose tout sur window.FP.
(function () {
  "use strict";

  const API = "/api";
  const STORAGE_KEY = "fp_token";

  const state = {
    token: localStorage.getItem(STORAGE_KEY) || null,
    user: null, // { username, full_name, role, authorized_societies, effective_modules, module_access_global }
    society: sessionStorage.getItem("fp_society") || null,
    period: sessionStorage.getItem("fp_period") || defaultPeriod(),
  };

  function defaultPeriod() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // money(v) : formate un montant Decimal (toujours reçu en chaîne depuis l'API — jamais un
  // float côté serveur, voir la revue d'intégrité) SANS jamais passer par Number() pour le
  // calcul, uniquement pour l'AFFICHAGE (séparateur de milliers) — la valeur affichée reste
  // celle de la chaîne serveur, jamais recalculée.
  function money(v, currency) {
    if (v === null || v === undefined || v === "") return "—";
    const s = String(v);
    const neg = s.startsWith("-");
    const [intPart, decPart = "00"] = (neg ? s.slice(1) : s).split(".");
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${neg ? "-" : ""}${grouped},${decPart.padEnd(2, "0").slice(0, 2)}${currency ? " " + esc(currency) : ""}`;
  }

  function pct(v) {
    if (v === null || v === undefined) return "—";
    return `${Number(v).toFixed(1)}%`;
  }

  function dateFr(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (isNaN(d.getTime())) return esc(v);
    return d.toLocaleDateString("fr-FR");
  }

  function daysUntil(v) {
    if (!v) return null;
    const target = new Date(v + "T00:00:00");
    if (isNaN(target.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  class ApiError extends Error {
    constructor(message, status, detail) {
      super(message);
      this.status = status;
      this.detail = detail;
    }
  }

  async function api(path, { method = "GET", body, formData, signal, params } = {}) {
    const headers = {};
    if (state.token) headers.Authorization = "Bearer " + state.token;
    let payload;
    if (formData) {
      payload = formData;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
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
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* réponse non-JSON */ }
    if (!res.ok) {
      const message = (data && (data.detail || data.error)) || `Erreur ${res.status}`;
      throw new ApiError(typeof message === "string" ? message : JSON.stringify(message), res.status, data);
    }
    return data;
  }

  // ── Race-guard : annule la requête précédente d'un même "slot" (ex. re-cliquer vite sur
  // un onglet/filtre) — évite qu'une réponse lente et périmée n'écrase un rendu plus récent.
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

  // ── Auth ────────────────────────────────────────────────────────────────────────────
  async function login(username, password) {
    const data = await api("/auth/login", { method: "POST", body: { username, password } });
    state.token = data.access_token;
    localStorage.setItem(STORAGE_KEY, state.token);
    await loadMe();
    return data;
  }

  async function loadMe() {
    state.user = await api("/auth/me");
    if (!state.society) {
      const authorized = state.user.authorized_societies;
      if (Array.isArray(authorized) && authorized.length) setSociety(authorized[0]);
    }
    return state.user;
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    state.token = null;
    state.user = null;
  }

  function hasModule(mod) {
    return !!(state.user && (state.user.module_access_global || (state.user.effective_modules || []).includes(mod)));
  }
  function hasFinanceAccess() { return hasModule("finances"); }
  function isAdmin() { return !!(state.user && state.user.module_access_global); }

  function setSociety(s) {
    state.society = s || null;
    if (s) sessionStorage.setItem("fp_society", s); else sessionStorage.removeItem("fp_society");
  }
  function setPeriod(p) {
    state.period = p;
    sessionStorage.setItem("fp_period", p);
  }

  // ── UI helpers réutilisés par toutes les vues ──────────────────────────────────────
  function statusBadge(status, map) {
    const cfg = (map || {})[status] || {};
    const cls = cfg.tone || "neutral";
    const label = cfg.label || status;
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  const OBLIGATION_STATUS = {
    open: { tone: "neutral", label: "ouverte" },
    partially_settled: { tone: "warn", label: "partielle" },
    settled: { tone: "success", label: "réglée" },
    cancelled: { tone: "danger", label: "annulée" },
  };
  const RECONCILE_STATUS = {
    unmatched: { tone: "warn", label: "non rapproché" },
    matched: { tone: "success", label: "rapproché" },
  };
  const REGULATORY_STATUS = {
    active: { tone: "success", label: "vérifiée" },
    unverified: { tone: "warn", label: "non vérifiée" },
    superseded: { tone: "neutral", label: "remplacée" },
    draft: { tone: "neutral", label: "brouillon" },
  };
  const BUDGET_STATUS = {
    draft: { tone: "neutral", label: "brouillon" },
    submitted: { tone: "info", label: "soumis" },
    approved: { tone: "success", label: "approuvé" },
    locked: { tone: "success", label: "verrouillé" },
    rejected: { tone: "danger", label: "rejeté" },
  };
  const FISCAL_STATUS = {
    pending: { tone: "neutral", label: "à venir" },
    declared: { tone: "warn", label: "déclarée" },
    paid: { tone: "success", label: "payée" },
    late: { tone: "danger", label: "en retard" },
  };
  const ACCOUNTING_STATUS = {
    pending: { tone: "neutral", label: "en attente" },
    posted: { tone: "success", label: "comptabilisée" },
    skipped: { tone: "neutral", label: "déjà postée ailleurs" },
    failed: { tone: "danger", label: "échec" },
  };

  function skeletonKpis(n) {
    return `<div class="skeleton-kpis">${Array.from({ length: n || 4 }).map(() => '<div class="skeleton skeleton-kpi"></div>').join("")}</div>`;
  }
  function skeletonRows(n) {
    return Array.from({ length: n || 5 }).map(() => '<div class="skeleton skeleton-row"></div>').join("");
  }
  function emptyState(text) {
    return `<div class="empty-state">${esc(text)}</div>`;
  }
  function errorState(err, retryLabel) {
    const msg = err instanceof ApiError ? err.message : (err && err.message) || "Erreur inconnue";
    return `<div class="error-state"><div class="error-state-title">Impossible de charger ces données</div>
      <div class="error-state-text">${esc(msg)}</div>
      ${retryLabel ? `<button class="btn btn-sm" data-retry>${esc(retryLabel)}</button>` : ""}</div>`;
  }
  function noAccessNotice(action) {
    return `<div class="empty-state">Lecture seule — module "Finances" non autorisé pour ce compte${action ? ` (${esc(action)} désactivé)` : ""}.</div>`;
  }

  // ── Drawer (détail latéral) ─────────────────────────────────────────────────────────
  function openDrawer(title, bodyHtml) {
    closeDrawer();
    const scrim = document.createElement("div");
    scrim.className = "drawer-scrim";
    scrim.id = "fp-drawer-scrim";
    scrim.innerHTML = `<div class="drawer"><div class="drawer-head"><h3>${esc(title)}</h3><button class="btn btn-ghost btn-sm" data-close-drawer>✕</button></div><div class="drawer-body">${bodyHtml}</div></div>`;
    scrim.addEventListener("click", (e) => { if (e.target === scrim || e.target.closest("[data-close-drawer]")) closeDrawer(); });
    document.body.appendChild(scrim);
    document.addEventListener("keydown", drawerEscHandler);
  }
  function drawerEscHandler(e) { if (e.key === "Escape") closeDrawer(); }
  function closeDrawer() {
    const el = document.getElementById("fp-drawer-scrim");
    if (el) el.remove();
    document.removeEventListener("keydown", drawerEscHandler);
  }
  function kvRow(label, value) {
    return `<div class="kv-row"><span>${esc(label)}</span><b>${value}</b></div>`;
  }

  // ── Confirmation d'action sensible (§16 : montant/contrepartie/société/source/impact) ─
  function confirmAction({ title, impact, confirmLabel, danger }) {
    return new Promise((resolve) => {
      const scrim = document.createElement("div");
      scrim.className = "confirm-scrim";
      scrim.innerHTML = `<div class="confirm-box">
        <h3>${esc(title)}</h3>
        <p>Cette action a un effet financier réel. Vérifiez les éléments ci-dessous avant de confirmer.</p>
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

  // ── Pagination (barre réutilisable) ─────────────────────────────────────────────────
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

  window.FP = {
    state, api, guardedApi, esc, money, pct, dateFr, daysUntil, ApiError,
    login, loadMe, logout, hasModule, hasFinanceAccess, isAdmin, setSociety, setPeriod,
    statusBadge, OBLIGATION_STATUS, RECONCILE_STATUS, REGULATORY_STATUS, BUDGET_STATUS, FISCAL_STATUS, ACCOUNTING_STATUS,
    skeletonKpis, skeletonRows, emptyState, errorState, noAccessNotice,
    openDrawer, closeDrawer, kvRow, confirmAction, paginationBar,
  };
})();
