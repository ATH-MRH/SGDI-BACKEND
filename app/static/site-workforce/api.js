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
  // « Structure » = société au sens BEO (libellé validé DG) ; la donnée reste la société.
  function scopeLabel() {
    const { society, site_id: siteId } = state.scope;
    if (siteId && state.site) return `Site : ${state.site.name}${state.site.society ? " — " + state.site.society : ""}`;
    const n = scopeSites(society).length;
    return society ? `Structure : ${society} — Tous mes sites (${n})` : `Toutes mes structures — Tous mes sites (${n})`;
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

  // Statut métier EFFECTIF (calculé serveur, directory.py) -> ton du badge.
  const BUSINESS_STATUS = {
    actif: { tone: "success", label: "Actif" }, suspendu: { tone: "warn", label: "Suspendu" },
    blacklist: { tone: "danger", label: "Blacklist" }, non_pointe: { tone: "neutral", label: "Non pointé" },
    conge: { tone: "info", label: "Congé" }, maladie: { tone: "violet", label: "Malade" },
    absent: { tone: "rose", label: "Absent" },
  };

  // Icônes SVG en ligne (trait, 24 px) : aucune police d'icônes ni ressource externe.
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11.5h13V9"/><path d="M10 20.5v-6h4v6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.3c2.1.7 3.5 2.8 3.5 5.7"/>',
    idcard: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="9" cy="11" r="2.3"/><path d="M5.6 16.5c.6-1.7 1.9-2.6 3.4-2.6s2.8.9 3.4 2.6"/><path d="M14.5 9.5h4M14.5 13h4"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    userx: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="m16.5 8.5 4 4m0-4-4 4"/>',
    usercheck: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="m16 11 2 2 4-4"/>',
    filecheck: '<path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3v6h6"/><path d="m9 15 2 2 4-4"/>',
    filetext: '<path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    calendarx: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="m10 13 4 4m0-4-4 4"/>',
    medical: '<rect x="3" y="7" width="18" height="13.5" rx="2"/><path d="M9 7V4.5h6V7"/><path d="M12 10.5v6.5M8.75 13.75h6.5"/>',
    cross: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
    scale: '<path d="M12 3v18M7.5 21h9M5 7h14"/><path d="m5 7-3 6.5a3 3 0 0 0 6 0zM19 7l-3 6.5a3 3 0 0 0 6 0z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    message: '<path d="M20.5 15a2 2 0 0 1-2 2H8l-4.5 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/><path d="M8 8.5h8M8 12h5"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15.5 6 9"/><path d="M10.2 21a2 2 0 0 0 3.6 0"/>',
    logout: '<path d="M9 21H5.5A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3H9"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
    chart: '<path d="M3.5 3.5v17h17"/><path d="M8 16v-3.5M12.5 16V8M17 16v-6"/>',
    chevron: '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
    back: '<path d="M19 12H5.5M12 18.5 5.5 12 12 5.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    rows: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><rect x="3" y="4.5" width="3" height="3" rx=".6"/><rect x="3" y="10.5" width="3" height="3" rx=".6"/><rect x="3" y="16.5" width="3" height="3" rx=".6"/>',
    pin: '<path d="M12 21.5s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="9.5" r="2.5"/>',
    building: '<rect x="4.5" y="3" width="15" height="18" rx="1.5"/><path d="M9 7h1.5M13.5 7H15M9 11h1.5M13.5 11H15M9 15h1.5M13.5 15H15M10.5 21v-3h3v3"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5.5A2 2 0 0 1 11 3.5h2a2 2 0 0 1 2 2V7M3 12.5h18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M10.3 4 2 18.2A2 2 0 0 0 3.7 21h16.6a2 2 0 0 0 1.7-2.8L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    sort: '<path d="M7 4.5v15M3.5 8 7 4.5 10.5 8M17 19.5v-15M13.5 16l3.5 3.5 3.5-3.5"/>',
    reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
    plane: '<path d="M10.5 13.5 3 11l1.5-1.5 8 .5 4.5-4.5a2.1 2.1 0 0 1 3 3L15.5 13l.5 8L14.5 22.5 12 15l-3 3v2.5L7.5 22 6 18l-4-1.5L3.5 15H6z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5"/>',
  };
  function icon(name, cls) {
    return `<svg class="beo-ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
  }

  // Photos : l'API exige le jeton -> fetch authentifié puis blob (jamais d'URL publique).
  // Chargement paresseux (IntersectionObserver) : seules les fichettes visibles sont demandées.
  async function loadPhoto(img, url) {
    try {
      const res = await fetch(url, { headers: state.token ? { Authorization: "Bearer " + state.token } : {} });
      if (!res.ok) return false;
      const blobUrl = URL.createObjectURL(await res.blob());
      img.src = blobUrl;
      img.hidden = false;
      img.addEventListener("load", () => URL.revokeObjectURL(blobUrl), { once: true });
      return true;
    } catch (e) { return false; /* sans photo : initiales conservées */ }
  }
  function lazyPhotos(root) {
    const imgs = [...root.querySelectorAll("img[data-photo-src]")];
    const show = (img) => {
      const src = img.dataset.photoSrc;
      delete img.dataset.photoSrc;
      loadPhoto(img, src).then((ok) => { if (ok) img.parentElement?.classList.add("has-photo"); });
    };
    if (typeof IntersectionObserver !== "function") { imgs.forEach(show); return () => {}; }
    // On observe l'avatar visible : l'image reste [hidden] (display:none) jusqu'au chargement,
    // et un élément non affiché n'intersecte jamais.
    const byHost = new Map(imgs.map((img) => [img.parentElement, img]));
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      const img = byHost.get(e.target);
      if (e.isIntersecting && img) { io.unobserve(e.target); show(img); }
    }), { rootMargin: "200px" });
    byHost.forEach((_, host) => io.observe(host));
    return () => io.disconnect();
  }
  function initials(...parts) {
    return parts.filter(Boolean).join(" ").split(/\s+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";
  }
  // Vue (liste / mosaïque) mémorisée par écran — confort local, jamais une donnée métier.
  function storedPref(key, fallback) { try { return localStorage.getItem("sw_pref_" + key) || fallback; } catch (e) { return fallback; } }
  function storePref(key, value) { try { localStorage.setItem("sw_pref_" + key, value); } catch (e) { /* sans effet */ } }

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
    statusBadge, BUSINESS_STATUS, icon, loadPhoto, lazyPhotos, initials, storedPref, storePref, ATTENDANCE_STATUS, ABSENCE_DECISION_STATUS, DOCUMENT_STATUS, LEAVE_STATUS, DISCIPLINE_STATUS, RECLAMATION_STATUS,
    skeletonKpis, skeletonRows, emptyState, errorState,
    openDrawer, closeDrawer, kvRow, confirmAction, paginationBar, readFileAsDataUrl,
  };
})();
