// ATLAS Site Workforce — coquille (sidebar bleu ATLAS fixe, barre supérieure bleue fixe, bandeau de
// page avec les sélecteurs, routeur par hash). Les vues s'enregistrent dans
// window.SiteWorkforceViews.<clé> = async function(container, ctx).
// Sélecteurs Structure / Site : ne proposent QUE le périmètre autorisé renvoyé par le serveur
// (/site-workforce/scope) ; « Toutes mes structures » / « Tous mes sites » = tout ce périmètre,
// jamais toutes les données ATLAS. Le périmètre consulté est affiché en permanence (bandeau).
// Route « #/clé/param?filtres » : ctx.param (ex. fiche) et ctx.query (filtres d'arrivée, ex.
// un compteur du tableau de bord qui ouvre EFFECTIF filtré).
(function () {
  "use strict";
  const { state, esc } = window.SW;

  // La clé « personnel » est conservée (liens, favoris, tests) ; le libellé est EFFECTIF.
  const NAV = [
    { key: "dashboard", label: "Tableau de bord", icon: "home" },
    { key: "personnel", label: "EFFECTIF", icon: "users" },
    { key: "position", label: "Fiche de position", icon: "idcard" },
    { key: "pointage", label: "Pointage", icon: "list" },
    { key: "absences", label: "Absences", icon: "userx" },
    { key: "justificatifs", label: "Justificatifs", icon: "filecheck" },
    { key: "conges", label: "Congés", icon: "calendar" },
    { key: "maladies", label: "Maladies", icon: "cross" },
    { key: "discipline", label: "Discipline", icon: "scale" },
    { key: "reclamations", label: "Réclamations", icon: "mail" },
  ];
  const ALIASES = { effectif: "personnel" };
  const DEFAULT_ROUTE = "dashboard";
  const VALID_KEYS = new Set(NAV.map((i) => i.key));
  // Bandeau de page : titre, icône et sous-titre (périmètre consulté toujours rappelé).
  const PAGE = {
    dashboard: { title: "Tableau de bord", icon: "chart", sub: (scope) => `Vue d'ensemble de la gestion des effectifs — ${scope}` },
    personnel: { title: "EFFECTIF", icon: "users", sub: (scope) => `Annuaire — lecture seule · ${scope}` },
    position: { title: "Fiches de position", icon: "idcard", sub: (scope) => `Accueil → Lecture seule → ${scope.replace(/ — /g, " → ")}` },
  };

  let currentKey = null;
  let currentCleanup = null;
  let renderToken = 0; // rendu courant : un rendu dépassé n'écrit plus jamais dans #view

  // « #/position/123 » : premier segment = écran, la suite = paramètre de l'écran (fiche) ;
  // « ?a=b » = filtres d'arrivée de l'écran.
  function routeParts() {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    const cut = raw.indexOf("?");
    const path = cut >= 0 ? raw.slice(0, cut) : raw;
    const query = new URLSearchParams(cut >= 0 ? raw.slice(cut + 1) : "");
    const [first, ...rest] = path.split("/");
    const head = ALIASES[first] || first;
    return VALID_KEYS.has(head) ? { key: head, param: rest.join("/"), query } : { key: DEFAULT_ROUTE, param: "", query: new URLSearchParams() };
  }
  function currentRouteKey() { return routeParts().key; }

  function renderNav() {
    return NAV.map((i) => `<button class="nav-link" data-nav="${i.key}"><span class="nav-link-icon">${window.SW.icon(i.icon)}</span><span class="nav-link-label">${esc(i.label)}</span></button>`).join("");
  }
  function titleFor(key) { return (NAV.find((i) => i.key === key) || {}).label || ""; }

  function scopeSelectorsHTML() {
    const info = state.scopeInfo || { societies: [], sites: [] };
    const sites = window.SW.scopeSites(state.scope.society);
    const socDisabled = info.societies.length <= 1 ? "disabled" : "";
    const siteDisabled = sites.length <= 1 ? "disabled" : "";
    return `<label class="scope-field"><span>Structure</span>
        <select id="society-select" ${socDisabled}>
          ${info.societies.length > 1 ? `<option value="">Toutes mes structures</option>` : ""}
          ${info.societies.map((soc) => `<option value="${esc(soc)}" ${soc === state.scope.society ? "selected" : ""}>${esc(soc)}</option>`).join("")}
        </select></label>
      <label class="scope-field"><span>Site</span>
        <select id="site-select" ${siteDisabled}>
          ${sites.length > 1 ? `<option value="">Tous mes sites</option>` : ""}
          ${sites.map((site) => `<option value="${site.id}" ${String(site.id) === state.scope.site_id ? "selected" : ""}>${esc(site.name)}</option>`).join("")}
        </select></label>`;
  }

  function renderScope() {
    const bar = document.querySelector("#scope-selectors");
    if (bar) bar.innerHTML = scopeSelectorsHTML();
    const label = window.SW.scopeLabel();
    document.querySelectorAll("[data-scope-label]").forEach((el) => { el.textContent = label; });
    document.querySelectorAll("[data-perimeter-label]").forEach((el) => { el.textContent = window.SW.perimeterLabel(); });
    renderPageBar();
    document.querySelector("#society-select")?.addEventListener("change", (e) => changeScope({ society: e.target.value, site_id: "" }));
    document.querySelector("#site-select")?.addEventListener("change", (e) => changeScope({ society: state.scope.society, site_id: e.target.value }));
  }

  // Changement de périmètre : requêtes en cours annulées (setScope), vue re-rendue depuis zéro.
  function changeScope(next) {
    if (window.SW.attendanceCanLeave && !window.SW.attendanceCanLeave()) { renderScope(); return; }
    window.SW.setScope(next);
    renderScope();
    renderRoute();
  }

  async function renderShell() {
    try { await window.SW.loadScope(); }
    catch (err) {
      document.querySelector("#root").innerHTML = `<div id="login-screen" class="card">${window.SW.errorState(err)}
        <button class="btn btn-sm" id="logout-btn" style="margin-top:12px">Déconnexion</button></div>`;
      document.querySelector("#logout-btn").addEventListener("click", () => { window.SW.logout(); location.hash = ""; renderLogin(); });
      return;
    }

    const userName = state.user?.full_name || state.user?.username || "";
    document.querySelector("#root").innerHTML = `
      <div class="shell beo-app" id="shell">
        <div class="sidebar-scrim" data-close-sidebar></div>
        <aside class="shell-sidebar">
          <div class="shell-brand">
            <div class="shell-brand-mark">SW</div>
            <div class="shell-brand-text"><b>ATLAS</b><span>Iron Global</span></div>
          </div>
          <div class="shell-role-badge">
            <b>Chargé des effectifs</b>
            <span>${esc(state.user?.full_name || "Chargé des effectifs")}</span>
            <span data-perimeter-label></span>
          </div>
          <nav class="shell-nav" aria-label="Menu BEO"><div class="shell-nav-group">${renderNav()}</div></nav>
        </aside>
        <div class="shell-main">
          <header class="shell-header beo-topbar">
            <div class="shell-header-left">
              <button class="sidebar-toggle" data-toggle-sidebar aria-label="Ouvrir ou fermer le menu">${window.SW.icon("menu")}</button>
              <input id="beo-quick-search" type="search" placeholder="Rechercher un agent, un matricule…" aria-label="Recherche rapide dans le pointage">
            </div>
            <div class="shell-header-right">
              <span class="beo-top-date" title="Date du jour">${window.SW.icon("calendar")}<span>${esc(new Date().toLocaleDateString("fr-FR"))}</span></span>
              <button class="beo-top-btn" id="notif-btn" title="Notifications" aria-label="Notifications">${window.SW.icon("bell")}<span id="notif-count"></span></button>
              <div class="user-chip" title="${esc(userName)}">
                <div class="user-avatar">${esc((userName || "?").slice(0, 2).toUpperCase())}</div>
                <span>${esc(userName)}</span>
              </div>
              <button class="beo-top-logout" id="logout-btn">${window.SW.icon("logout")}<span>Déconnexion</span></button>
            </div>
          </header>
          <section class="beo-pagebar" aria-label="En-tête de page">
            <div class="beo-pagebar-icon" id="view-icon"></div>
            <div class="beo-pagebar-text">
              <h1 class="beo-pagebar-title" id="view-title"></h1>
              <p class="beo-pagebar-sub" id="view-sub"></p>
            </div>
            <div class="beo-pagebar-scope" id="scope-slot"><div class="scope-bar" id="scope-selectors"></div></div>
          </section>
          <main class="shell-content" id="view"></main>
        </div>
      </div>`;

    document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => { if (!window.SW.attendanceCanLeave || window.SW.attendanceCanLeave()) { location.hash = "#/" + b.dataset.nav; closeSidebar(); } }));
    document.querySelector("[data-toggle-sidebar]").addEventListener("click", toggleSidebar);
    document.querySelector("[data-close-sidebar]").addEventListener("click", closeSidebar);
    document.querySelector("#logout-btn").addEventListener("click", () => { window.SW.logout(); location.hash = ""; renderLogin(); });
    document.querySelector("#notif-btn").addEventListener("click", openNotifications);
    renderScope();
    refreshNotifCount();

    window.addEventListener("hashchange", renderRoute);
    renderRoute();
  }

  async function refreshNotifCount() {
    try {
      // La cloche agrège TOUT le périmètre autorisé, quelle que soit la sélection (§14).
      const rows = await window.SW.api("/site-workforce/notifications", { params: { status_filter: "nouvelle" }, scope: false });
      const el = document.querySelector("#notif-count");
      if (el) { el.textContent = rows.length ? String(rows.length) : ""; el.classList.toggle("beo-notif-dot", !!rows.length); }
    } catch (e) { /* silencieux — jamais bloquant pour le reste du shell */ }
  }

  async function openNotifications() {
    try {
      const rows = await window.SW.api("/site-workforce/notifications", { scope: false });
      const body = rows.length
        ? rows.map((n) => `<div class="kv-row" data-notif="${n.id}" style="cursor:${n.status === "nouvelle" ? "pointer" : "default"}">
            <span>${esc(n.notif_type)} — ${n.status === "nouvelle" ? "nouvelle" : "lue"}<br><small class="muted">${esc(n.society || "—")} · ${esc(n.site_name || "—")}</small></span><b>${esc(n.message)}</b></div>`).join("")
        : window.SW.emptyState("Aucune notification.");
      window.SW.openDrawer("Notifications", `<div class="kv-list">${body}</div>`);
      document.querySelectorAll("[data-notif]").forEach((row) => row.addEventListener("click", async () => {
        try { await window.SW.api(`/site-workforce/notifications/${row.dataset.notif}/read`, { method: "POST", scope: false }); refreshNotifCount(); openNotifications(); }
        catch (e) { /* ignore */ }
      }));
    } catch (err) { window.SW.openDrawer("Notifications", window.SW.errorState(err)); }
  }

  function toggleSidebar() { document.querySelector("#shell")?.classList.toggle("sidebar-open"); }
  function closeSidebar() { document.querySelector("#shell")?.classList.remove("sidebar-open"); }

  // Bandeau : écrans refondus = titre + sous-titre dédiés ; autres écrans = libellé du menu et
  // périmètre consulté (leur propre titre interne est alors masqué, cf. app.css).
  function renderPageBar() {
    const { key, param } = routeParts();
    const nav = NAV.find((i) => i.key === key) || {};
    const page = PAGE[key] || { title: titleFor(key), icon: nav.icon, sub: (scope) => scope };
    const detail = key === "position" && param;
    const titleEl = document.querySelector("#view-title");
    if (titleEl) titleEl.textContent = detail ? "Fiche de position" : page.title;
    const subEl = document.querySelector("#view-sub");
    if (subEl) subEl.textContent = detail ? "Fiches de position → Fiche individuelle · lecture seule" : page.sub(window.SW.scopeLabel());
    const iconEl = document.querySelector("#view-icon");
    if (iconEl) iconEl.innerHTML = window.SW.icon(page.icon || "home");
  }

  async function renderRoute() {
    if (!document.querySelector("#view")) return;
    const token = ++renderToken;
    const key = currentRouteKey();
    // Les sélecteurs reviennent dans le bandeau avant chaque écran (Pointage les place ailleurs).
    const scopeBar = document.querySelector("#scope-selectors");
    if (scopeBar) document.querySelector("#scope-slot")?.appendChild(scopeBar);
    document.body.dataset.swRoute = key;
    currentKey = key;
    document.querySelectorAll(".nav-link").forEach((b) => {
      b.classList.toggle("active", b.dataset.nav === key);
      if (b.dataset.nav === key) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    renderPageBar();

    if (typeof currentCleanup === "function") { try { currentCleanup(); } catch (e) {} }
    currentCleanup = null;

    const container = document.querySelector("#view");
    const view = window.SiteWorkforceViews && window.SiteWorkforceViews[key];
    if (!view) { container.innerHTML = window.SW.emptyState("Écran non disponible."); return; }
    const parts = routeParts();
    const ctx = {
      param: parts.param,
      query: parts.query,
      navigate: (k) => { location.hash = "#/" + k; },
      // Ligne « Répartition par site » cliquable : consulte ce site (toujours dans le périmètre).
      selectSite: (siteId) => { const site = window.SW.scopeSites("").find((x) => String(x.id) === String(siteId)); if (site) changeScope({ society: site.society || "", site_id: String(site.id) }); },
    };
    try {
      const cleanup = await view(container, ctx);
      if (typeof cleanup === "function" && token === renderToken) currentCleanup = cleanup;
    } catch (err) {
      // Erreur d'un écran quitté entre-temps (réponse tardive) : jamais affichée sur le suivant.
      if (token === renderToken && err.name !== "AbortError") container.innerHTML = window.SW.errorState(err);
    }
  }

  function renderLogin(error) {
    ++renderToken;
    if (typeof currentCleanup === "function") currentCleanup();
    currentCleanup = null;
    delete document.body.dataset.swRoute;
    document.querySelector("#root").innerHTML = `
      <div id="login-screen" class="card">
        <h2 style="margin-top:0">Bureau des Effectifs Ouest</h2>
        <p class="section-sub" style="margin-top:-8px">ATLAS Site Workforce — Chargé des effectifs</p>
        <form id="login-form">
          <div class="field" style="margin-bottom:10px"><label>Identifiant</label><input name="username" required autocomplete="username"></div>
          <div class="field" style="margin-bottom:10px"><label>Mot de passe</label><input name="password" type="password" required autocomplete="current-password"></div>
          ${error ? `<div class="msg error">${esc(error)}</div>` : ""}
          <button class="btn btn-primary" style="width:100%;margin-top:6px;justify-content:center" type="submit">Se connecter</button>
        </form>
      </div>`;
    document.querySelector("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { await window.SW.login(fd.get("username"), fd.get("password")); renderShell(); }
      catch (err) { renderLogin(err.message); }
    });
  }

  window.SiteWorkforceShell = { renderShell, renderLogin, get currentKey() { return currentKey; } };

  if (state.token) {
    window.SW.api("/auth/me").then((u) => { state.user = u; renderShell(); }).catch(() => { window.SW.logout(); renderLogin(); });
  } else {
    renderLogin();
  }
})();
