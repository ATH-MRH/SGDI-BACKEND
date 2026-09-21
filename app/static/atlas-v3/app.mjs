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
import { escapeHTML } from "../core-v3/ui.mjs";
import { registerDrhRoutes, drhNavItems } from "../modules-v3/drh/index.mjs";

function navItems() {
  return [{ route: "dashboard", label: "Tableau de bord" }, ...drhNavItems()];
}

function shellHTML(user) {
  const items = navItems();
  return `<div class="sgdi-shell" style="display:flex;min-height:100vh">
    <aside class="sidebar" style="width:220px;flex:0 0 220px">
      <div style="padding:16px;font-weight:900;font-size:13px;letter-spacing:.04em">ATLAS V3 <span style="color:#64748b;font-weight:600">— expérimental</span></div>
      <nav>${items.map(n => `<a href="#/${n.route}" data-route="${n.route}" class="v3-nav-link" style="display:block;padding:10px 16px;color:#0f172a;text-decoration:none">${escapeHTML(n.label)}</a>`).join("")}</nav>
    </aside>
    <div style="flex:1;display:flex;flex-direction:column">
      <header style="display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #e2e8f0">
        <span style="font-size:12px;color:#64748b">${escapeHTML(user?.fullName || user?.username || "")}</span>
        <button type="button" class="v3-btn" id="v3-logout-btn">Déconnexion</button>
      </header>
      <main style="flex:1;padding:16px"><div id="v3-module-root"></div></main>
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
