// ATLAS Site Workforce — coquille (sidebar bleu marine, header, routeur par hash). Les vues
// s'enregistrent dans window.SiteWorkforceViews.<clé> = async function(container, ctx).
// AUCUN sélecteur de société/site — imposé côté serveur (§B6), affiché seulement.
(function () {
  "use strict";
  const { state, esc } = window.SW;

  const NAV = [
    { key: "dashboard", label: "Tableau de bord", icon: "◆" },
    { key: "personnel", label: "Personnel du site", icon: "☺" },
    { key: "pointage", label: "Pointage", icon: "▤" },
    { key: "absences", label: "Absences", icon: "↘" },
    { key: "justificatifs", label: "Justificatifs", icon: "▣" },
    { key: "conges", label: "Congés", icon: "◈" },
    { key: "maladies", label: "Maladies", icon: "✚" },
    { key: "discipline", label: "Discipline", icon: "§" },
    { key: "reclamations", label: "Réclamations", icon: "✉" },
  ];
  const DEFAULT_ROUTE = "dashboard";
  const VALID_KEYS = new Set(NAV.map((i) => i.key));

  let currentKey = null;
  let currentCleanup = null;

  function currentRouteKey() {
    const h = (location.hash || "").replace(/^#\/?/, "");
    return VALID_KEYS.has(h) ? h : DEFAULT_ROUTE;
  }

  function renderNav() {
    return NAV.map((i) => `<button class="nav-link" data-nav="${i.key}"><span class="nav-link-icon">${i.icon}</span>${esc(i.label)}</button>`).join("");
  }
  function titleFor(key) { return (NAV.find((i) => i.key === key) || {}).label || ""; }

  async function renderShell() {
    // Le site vient du dashboard (seule route qui expose l'objet Site résolu côté serveur) —
    // jamais reconstruit/choisi côté client.
    let site = state.site;
    if (!site) {
      try { site = (await window.SW.api("/site-workforce/dashboard")).site; state.site = site; }
      catch (e) { site = null; }
    }

    document.querySelector("#root").innerHTML = `
      <div class="shell" id="shell">
        <div class="sidebar-scrim" data-close-sidebar></div>
        <aside class="shell-sidebar">
          <div class="shell-brand">
            <div class="shell-brand-mark">SW</div>
            <div class="shell-brand-text"><b>ATLAS</b><span>Iron Global</span></div>
          </div>
          <div class="shell-role-badge">
            <b>Chargé des effectifs</b>
            <span>Site : ${esc(site ? site.name : "—")}</span>
          </div>
          <nav class="shell-nav"><div class="shell-nav-group">${renderNav()}</div></nav>
        </aside>
        <div class="shell-main">
          <header class="shell-header">
            <div class="shell-header-left">
              <button class="sidebar-toggle" data-toggle-sidebar aria-label="Menu">☰</button>
              <span class="shell-header-title" id="view-title"></span>
            </div>
            <div class="shell-header-right">
              <span class="site-chip" title="Site imposé — non modifiable depuis ce compte">${esc(site ? site.name : "—")}</span>
              <span class="site-chip" title="Date du jour">${esc(new Date().toLocaleDateString("fr-FR"))}</span>
              <button class="btn btn-sm btn-ghost" id="notif-btn" title="Notifications">🔔<span id="notif-count"></span></button>
              <div class="user-chip">
                <div class="user-avatar">${esc((state.user?.full_name || state.user?.username || "?").slice(0, 2).toUpperCase())}</div>
                <span>${esc(state.user?.full_name || state.user?.username || "")}</span>
              </div>
              <button class="btn btn-sm btn-ghost" id="logout-btn">Déconnexion</button>
            </div>
          </header>
          <main class="shell-content" id="view"></main>
        </div>
      </div>`;

    document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => { location.hash = "#/" + b.dataset.nav; closeSidebar(); }));
    document.querySelector("[data-toggle-sidebar]").addEventListener("click", toggleSidebar);
    document.querySelector("[data-close-sidebar]").addEventListener("click", closeSidebar);
    document.querySelector("#logout-btn").addEventListener("click", () => { window.SW.logout(); location.hash = ""; renderLogin(); });
    document.querySelector("#notif-btn").addEventListener("click", openNotifications);
    refreshNotifCount();

    window.addEventListener("hashchange", renderRoute);
    renderRoute();
  }

  async function refreshNotifCount() {
    try {
      const rows = await window.SW.api("/site-workforce/notifications", { params: { status_filter: "nouvelle" } });
      const el = document.querySelector("#notif-count");
      if (el) el.textContent = rows.length ? ` ${rows.length}` : "";
    } catch (e) { /* silencieux — jamais bloquant pour le reste du shell */ }
  }

  async function openNotifications() {
    try {
      const rows = await window.SW.api("/site-workforce/notifications");
      const body = rows.length
        ? rows.map((n) => `<div class="kv-row" data-notif="${n.id}" style="cursor:${n.status === "nouvelle" ? "pointer" : "default"}">
            <span>${esc(n.notif_type)} — ${n.status === "nouvelle" ? "nouvelle" : "lue"}</span><b>${esc(n.message)}</b></div>`).join("")
        : window.SW.emptyState("Aucune notification.");
      window.SW.openDrawer("Notifications", `<div class="kv-list">${body}</div>`);
      document.querySelectorAll("[data-notif]").forEach((row) => row.addEventListener("click", async () => {
        try { await window.SW.api(`/site-workforce/notifications/${row.dataset.notif}/read`, { method: "POST" }); refreshNotifCount(); openNotifications(); }
        catch (e) { /* ignore */ }
      }));
    } catch (err) { window.SW.openDrawer("Notifications", window.SW.errorState(err)); }
  }

  function toggleSidebar() { document.querySelector("#shell")?.classList.toggle("sidebar-open"); }
  function closeSidebar() { document.querySelector("#shell")?.classList.remove("sidebar-open"); }

  async function renderRoute() {
    const key = currentRouteKey();
    currentKey = key;
    document.querySelectorAll(".nav-link").forEach((b) => b.classList.toggle("active", b.dataset.nav === key));
    const titleEl = document.querySelector("#view-title");
    if (titleEl) titleEl.textContent = titleFor(key);

    if (typeof currentCleanup === "function") { try { currentCleanup(); } catch (e) {} }
    currentCleanup = null;

    const container = document.querySelector("#view");
    const view = window.SiteWorkforceViews && window.SiteWorkforceViews[key];
    if (!view) { container.innerHTML = window.SW.emptyState("Écran non disponible."); return; }
    const ctx = { navigate: (k) => { location.hash = "#/" + k; } };
    try {
      const cleanup = await view(container, ctx);
      if (typeof cleanup === "function") currentCleanup = cleanup;
    } catch (err) {
      container.innerHTML = window.SW.errorState(err);
    }
  }

  function renderLogin(error) {
    document.querySelector("#root").innerHTML = `
      <div id="login-screen" class="card">
        <h2 style="margin-top:0">ATLAS Site Workforce</h2>
        <p class="section-sub" style="margin-top:-8px">Chargé des effectifs — Site</p>
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
