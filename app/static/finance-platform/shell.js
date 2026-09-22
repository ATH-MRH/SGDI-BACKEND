// ATLAS Finance Platform V2 — coquille (sidebar, header, routeur par hash). Les vues
// s'enregistrent dans window.FinanceViews.<clé> = async function(container, ctx). Chaque
// clé correspond à une entrée du plan de navigation ci-dessous (§1 de la mission).
(function () {
  "use strict";
  const { state, esc, hasFinanceAccess, isAdmin } = window.FP;

  const NAV = [
    { group: "Général", items: [
      { key: "dashboard", label: "Tableau de bord", icon: "◆" },
    ] },
    { group: "Trésorerie & Banque", items: [
      { key: "tresorerie", label: "Trésorerie", icon: "◈" },
      { key: "banque", label: "Banque", icon: "▤" },
    ] },
    { group: "Obligations", items: [
      { key: "creances", label: "Clients / Créances", icon: "↘" },
      { key: "dettes", label: "Fournisseurs / Dettes", icon: "↗" },
    ] },
    { group: "Paie & Pilotage", items: [
      { key: "paie", label: "Paie", icon: "☰" },
      { key: "budget", label: "Budget", icon: "▦" },
      { key: "rentabilite", label: "Rentabilité", icon: "△" },
    ] },
    { group: "Conformité", items: [
      { key: "fiscalite", label: "Fiscalité", icon: "⚑" },
      { key: "comptabilite", label: "Comptabilité", icon: "≡" },
      { key: "reglementation", label: "Réglementation", icon: "§" },
    ] },
    { group: "Direction", items: [
      { key: "cockpit", label: "Cockpit DG", icon: "★" },
    ] },
  ];
  const DEFAULT_ROUTE = "dashboard";
  const VALID_KEYS = new Set(NAV.flatMap((g) => g.items.map((i) => i.key)));

  let currentKey = null;
  let currentCleanup = null;

  function currentRouteKey() {
    const h = (location.hash || "").replace(/^#\/?/, "");
    return VALID_KEYS.has(h) ? h : DEFAULT_ROUTE;
  }

  function renderNav() {
    return NAV.map((g) => `
      <div class="shell-nav-group">
        <div class="shell-nav-group-label">${esc(g.group)}</div>
        ${g.items.map((i) => `<button class="nav-link" data-nav="${i.key}"><span class="nav-link-icon">${i.icon}</span>${esc(i.label)}</button>`).join("")}
      </div>`).join("");
  }

  function titleFor(key) {
    for (const g of NAV) { const it = g.items.find((i) => i.key === key); if (it) return it.label; }
    return "";
  }

  async function renderShell() {
    const societies = await window.FP.api("/finance-core/societies").then((r) => r.items).catch(() => []);
    if (!state.society && societies.length) window.FP.setSociety(societies[0]);

    document.querySelector("#root").innerHTML = `
      <div class="shell" id="shell">
        <div class="sidebar-scrim" data-close-sidebar></div>
        <aside class="shell-sidebar">
          <div class="shell-brand">
            <div class="shell-brand-mark">AF</div>
            <div class="shell-brand-text"><b>ATLAS Finance</b><span>Platform</span></div>
          </div>
          <nav class="shell-nav">${renderNav()}</nav>
        </aside>
        <div class="shell-main">
          <header class="shell-header">
            <div class="shell-header-left">
              <button class="sidebar-toggle" data-toggle-sidebar aria-label="Menu">☰</button>
              <span class="shell-header-title" id="view-title"></span>
            </div>
            <div class="shell-header-right">
              <select class="society-select" id="society-select" title="Société active">
                ${societies.map((s) => `<option value="${esc(s)}" ${s === state.society ? "selected" : ""}>${esc(s)}</option>`).join("") || `<option>${esc(state.society || "—")}</option>`}
              </select>
              <input class="period-select" id="period-input" type="month" value="${esc(state.period)}" title="Période active (AAAA-MM)">
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
    document.querySelector("#logout-btn").addEventListener("click", () => { window.FP.logout(); location.hash = ""; renderLogin(); });
    document.querySelector("#society-select").addEventListener("change", (e) => { window.FP.setSociety(e.target.value); renderRoute(); });
    document.querySelector("#period-input").addEventListener("change", (e) => { if (e.target.value) { window.FP.setPeriod(e.target.value); renderRoute(); } });

    window.addEventListener("hashchange", renderRoute);
    renderRoute();
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
    const view = window.FinanceViews && window.FinanceViews[key];
    if (!view) { container.innerHTML = window.FP.emptyState("Module non disponible."); return; }
    const ctx = {
      society: state.society, period: state.period,
      canWrite: hasFinanceAccess(), isAdmin: isAdmin(),
      navigate: (k) => { location.hash = "#/" + k; },
    };
    try {
      const cleanup = await view(container, ctx);
      if (typeof cleanup === "function") currentCleanup = cleanup;
    } catch (err) {
      container.innerHTML = window.FP.errorState(err);
    }
  }

  function renderLogin(error) {
    document.querySelector("#root").innerHTML = `
      <div id="login-screen" class="card">
        <h2 style="margin-top:0">ATLAS Finance Platform</h2>
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
      try {
        await window.FP.login(fd.get("username"), fd.get("password"));
        renderShell();
      } catch (err) { renderLogin(err.message); }
    });
  }

  window.FinanceShell = { renderShell, renderLogin, get currentKey() { return currentKey; } };

  // ── Bootstrap ───────────────────────────────────────────────────────────────────────
  if (state.token) {
    window.FP.loadMe().then(renderShell).catch(() => { window.FP.logout(); renderLogin(); });
  } else {
    renderLogin();
  }
})();
