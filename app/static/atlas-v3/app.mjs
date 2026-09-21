// ATLAS V3 — point d'entrée expérimental (LOT V3.1 de la mission).
//
// Route de développement explicite, distincte de "/" (Legacy) et de "/drh-next" (DRH Next) :
// drh.irongs.com continue de servir sgdi-app.js sans aucune modification. MÊME backend,
// MÊME auth (/api/auth/login, /api/auth/me), MÊME session (sgdi_api_token_v1), MÊMES
// permissions — aucune application métier parallèle, uniquement un runtime frontend
// alternatif pointant sur la même API.
//
// Portée de cette phase (Phase 3) : Dashboard (§ LOT V3.2) + domaine DRH complet (§ mission
// "ATLAS V3 — PHASE 3", modules-v3/drh/index.mjs). OPS/Superviseur/Matériel/Finance restent
// Legacy ce lot (§26 de la mission DRH) — un lien de sidebar vers un domaine non migré
// n'existe simplement pas encore, plutôt que de pointer vers un module qui n'existerait pas.
import { bootstrap, logoutAndReset } from "../core-v3/bootstrap.mjs";
import { login } from "../core-v3/auth.mjs";
import { getUser } from "../core-v3/session.mjs";
import { registerRoute, registerNotFound } from "../core-v3/router.mjs";
import { registerModule, getModule, deactivateIfChanged, markActive } from "../core-v3/module-registry.mjs";
import { escapeHTML, initialsAvatarHTML } from "../core-v3/ui.mjs";
import { currentSocietyScope } from "../core-v3/permissions.mjs";
import { registerDrhRoutes, drhNavItems } from "../modules-v3/drh/index.mjs";

// Groupes de navigation (§3/§11 de la mission "Phase finale DRH") : uniquement des routes
// RÉELLEMENT enregistrées plus bas — aucun placeholder, aucun lien "à venir". drhNavItems()
// renvoie [] pour un compte sans accès DRH (§19 RBAC) : le groupe "Ressources humaines" ne
// s'affiche alors simplement pas, plutôt qu'un lien visible mais qui échouerait en 403.
function navGroups() {
  const drh = drhNavItems();
  const groups = [{ label: "Général", items: [{ route: "dashboard", label: "Tableau de bord" }] }];
  if (drh.length) groups.push({ label: "Ressources humaines", items: drh });
  return groups;
}

function activeSocietyLabel(user) {
  if (user?.moduleAccessGlobal || user?.globalSocietyAccess) return "Toutes sociétés";
  const societies = currentSocietyScope();
  if (!societies.length) return "";
  return societies.length === 1 ? societies[0] : `${societies[0]} +${societies.length - 1}`;
}

function shellHTML(user) {
  const groups = navGroups();
  const societyLabel = activeSocietyLabel(user);
  return `<div class="v3-shell" id="v3-shell">
    <aside class="v3-shell-sidebar" id="v3-shell-sidebar">
      <div class="v3-shell-brand">ATLAS V3 <span class="v3-shell-brand-tag">expérimental</span></div>
      <nav class="v3-shell-nav">
        ${groups.map(g => `<div><div class="v3-shell-nav-group-label">${escapeHTML(g.label)}</div>
          ${g.items.map(n => `<a href="#/${n.route}" data-route="${n.route}" class="v3-nav-link">${escapeHTML(n.label)}</a>`).join("")}
        </div>`).join("")}
      </nav>
    </aside>
    <div class="v3-shell-main">
      <header class="v3-shell-header">
        <button type="button" class="v3-sidebar-toggle" id="v3-sidebar-toggle" aria-label="Ouvrir le menu" aria-controls="v3-shell-sidebar">☰</button>
        <span></span>
        <div class="v3-shell-header-user">
          ${societyLabel ? `<span class="v3-shell-header-society">${escapeHTML(societyLabel)}</span>` : ""}
          ${initialsAvatarHTML(user?.fullName?.split(" ")[0], user?.fullName?.split(" ").slice(-1)[0])}
          <span>${escapeHTML(user?.fullName || user?.username || "")}</span>
          <button type="button" class="v3-btn" id="v3-logout-btn">Déconnexion</button>
        </div>
      </header>
      <main class="v3-shell-content"><div id="v3-module-root"></div></main>
    </div>
  </div>`;
}

function loginScreenHTML(error) {
  return `<div style="max-width:360px;margin:80px auto" class="card">
    <div style="padding:28px">
      <h1 style="font-size:18px;margin:0 0 18px">ATLAS V3 — expérimental</h1>
      <form id="v3-login-form">
        <label style="font-size:12px;font-weight:700;color:#64748b">Identifiant</label>
        <input class="input" style="margin:4px 0 12px;width:100%" name="username" autocomplete="username" required>
        <label style="font-size:12px;font-weight:700;color:#64748b">Mot de passe</label>
        <input class="input" style="margin:4px 0 16px;width:100%" name="password" type="password" autocomplete="current-password" required>
        ${error ? `<div style="color:#dc2626;margin-bottom:12px;font-size:13px">${escapeHTML(error)}</div>` : ""}
        <button type="submit" class="v3-btn v3-btn-primary" style="width:100%;justify-content:center">Se connecter</button>
      </form>
    </div>
  </div>`;
}

function renderLogin(error) {
  document.querySelector("#v3-root").innerHTML = loginScreenHTML(error);
  document.querySelector("#v3-login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await login(form.get("username"), form.get("password"));
      start();
    } catch (err) {
      renderLogin(err?.message || "Connexion impossible.");
    }
  });
}

function renderForbidden() {
  document.querySelector("#v3-root").innerHTML = `<div style="max-width:420px;margin:80px auto" class="card">
    <div style="padding:24px"><b>Accès refusé</b><p style="color:#64748b;font-size:13px;margin-top:6px">Votre compte n'a accès à aucun module.</p></div>
  </div>`;
}

function renderNotFound() {
  const el = document.querySelector("#v3-module-root");
  if (el) el.innerHTML = `<div class="card" style="padding:24px">Page introuvable. <a href="#/dashboard">Retour au tableau de bord</a>.</div>`;
}

function highlightActiveNav(route) {
  document.querySelectorAll(".v3-nav-link").forEach(a => a.classList.toggle("active", a.dataset.route === route));
}

function renderShell() {
  document.querySelector("#v3-root").innerHTML = shellHTML(getUser());
  document.querySelector("#v3-logout-btn")?.addEventListener("click", () => logoutAndReset(() => renderLogin()));
  // Bascule mobile (§14 : responsive 390/768px) : la sidebar reste hors écran en dessous de
  // 860px (voir core-v3/atlas-v3.css) tant que .v3-sidebar-open n'est pas posé sur le shell.
  document.querySelector("#v3-sidebar-toggle")?.addEventListener("click", () => {
    document.querySelector("#v3-shell")?.classList.toggle("v3-sidebar-open");
  });
  // Un clic sur un lien de navigation referme la sidebar mobile — évite qu'elle reste
  // ouverte par-dessus l'écran nouvellement affiché sur petit écran.
  document.querySelectorAll(".v3-nav-link").forEach(a => a.addEventListener("click", () => {
    document.querySelector("#v3-shell")?.classList.remove("v3-sidebar-open");
  }));
}

function registerRoutes() {
  // Contrat de module V3 (§5 core-v3/module-registry.mjs) : mount()/unmount() délèguent
  // directement à l'implémentation réelle, chargée paresseusement par load(). L'orchestration
  // (démonter le module PRÉCÉDENT avant de monter le nouveau, marquer le module actif) est la
  // responsabilité de l'appelant — ici, le gestionnaire de route ci-dessous — pas du module
  // lui-même, pour rester réutilisable identiquement par n'importe quel futur domaine.
  registerModule({
    key: "dashboard",
    routes: ["dashboard"],
    permissions: null, // le tableau de bord général reste accessible à tout compte authentifié, comme en Legacy
    load: () => import("../modules-v3/dashboard/index.mjs"),
    mount: async (container) => {
      const impl = await import("../modules-v3/dashboard/index.mjs");
      await impl.mountDashboard(container);
    },
    unmount: async () => {
      const impl = await import("../modules-v3/dashboard/index.mjs");
      impl.unmountDashboard();
    },
  });
  registerRoute("dashboard", async () => {
    highlightActiveNav("dashboard");
    await deactivateIfChanged("dashboard");
    const def = getModule("dashboard");
    await def.mount(document.querySelector("#v3-module-root"));
    markActive("dashboard");
  });
  // Domaine DRH (Phase 3) : enregistre ses propres modules/routes (drh, drh/employees,
  // drh/employees/:id, drh/recrutement) — l'orchestration deactivateIfChanged/markActive
  // est faite à l'identique DANS registerDrhRoutes (modules-v3/drh/index.mjs), même patron
  // que ci-dessus, pour rester cohérente entre TOUS les domaines migrés. onEnter surligne
  // le lien de sidebar exact ("drh" pour le tableau de bord, "drh/employees" pour
  // l'annuaire...) ; le dossier employé ("drh/employees/:id") n'a pas de lien de sidebar
  // propre, donc aucun surlignage ne correspond — comportement attendu, pas un bug.
  registerDrhRoutes((routePattern) => highlightActiveNav(routePattern));
  registerNotFound(renderNotFound);
}

function start() {
  bootstrap({ renderLogin: () => renderLogin(), renderForbidden, renderShell, registerRoutes });
}

start();
