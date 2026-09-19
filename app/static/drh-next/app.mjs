// DRH NEXT — app.js
//
// Bootstrap (§11) : HTML -> core JS -> auth/session -> permissions minimales
// -> shell -> dashboard. INTERDIT ici : liste complète employés, contrats
// complets, documents, sanctions, pointages, matériel, candidats complets —
// aucun de ces appels n'existe dans ce fichier ni dans dashboard.js.
import { restoreSession, login, logout } from "./core/auth.mjs";
import { getUser } from "./core/session.mjs";
import { canAccessDrh } from "./core/permissions.mjs";
import { registerRoute, registerNotFound, startRouter, navigate, getCurrentParams } from "./core/router.mjs";
import { escapeHTML } from "./core/ui.mjs";
import { renderDashboard } from "./modules/dashboard.mjs";
import { renderEmployees, renderEmployeeDetail } from "./modules/employees.mjs";

const NAV_ITEMS = [
  { route: "dashboard", label: "Tableau de bord" },
  { route: "employees", label: "Employés" },
  { route: "contracts", label: "Contrats" },
  { route: "attendance", label: "Pointage" },
  { route: "leaves", label: "Congés" },
  { route: "discipline", label: "Discipline" },
  { route: "recruitment", label: "Recrutement" },
  { route: "documents", label: "Documents" },
  { route: "alerts", label: "Alertes" },
];

// LOT 2 : dashboard (LOT 1) et employees (liste paginée + fiche minimale, LOT 2) sont
// désormais de vrais modules. Le reste est un squelette de route explicite ("arrive au
// LOT n") — §24 (LOT 1) documente le calendrier réel, on ne fait jamais semblant qu'un
// écran existe déjà.
const COMING_SOON_LOT = { contracts: 4, attendance: 8, leaves: 5, discipline: 6, recruitment: 7, documents: 9, alerts: 10 };

function renderComingSoon(route) {
  const item = NAV_ITEMS.find(n => n.route === route);
  document.querySelector("#dn-view").innerHTML = `<div class="dn-page-head"><h1>${escapeHTML(item?.label || route)}</h1></div>
    <div class="dn-card dn-panel"><div class="dn-empty-state">Cet écran arrive au LOT ${COMING_SOON_LOT[route] || "?"}.</div></div>`;
}

function shellHTML(user) {
  return `<div class="dn-app" id="dn-app">
    <aside class="dn-sidebar">
      <div class="dn-sidebar-brand">DRH NEXT</div>
      <nav class="dn-sidebar-nav" id="dn-nav">
        ${NAV_ITEMS.map(n => `<a class="dn-nav-link" href="#/${n.route}" data-route="${n.route}">${escapeHTML(n.label)}</a>`).join("")}
      </nav>
    </aside>
    <div class="dn-main">
      <header class="dn-header">
        <button type="button" class="dn-btn dn-sidebar-toggle" id="dn-sidebar-toggle" aria-label="Menu">☰</button>
        <div></div>
        <div class="dn-header-user">
          <span>${escapeHTML(user?.fullName || user?.username || "")}</span>
          <button type="button" class="dn-btn" id="dn-logout-btn">Déconnexion</button>
        </div>
      </header>
      <main class="dn-content"><div id="dn-view"></div></main>
    </div>
  </div>`;
}

function highlightActiveNav(route) {
  document.querySelectorAll(".dn-nav-link").forEach(a => a.classList.toggle("active", a.dataset.route === route));
}

function mountShell() {
  const root = document.querySelector("#dn-root");
  root.innerHTML = shellHTML(getUser());
  document.querySelector("#dn-logout-btn")?.addEventListener("click", () => { logout(); renderApp(); });
  document.querySelector("#dn-sidebar-toggle")?.addEventListener("click", () => {
    document.querySelector("#dn-app")?.classList.toggle("dn-sidebar-open");
  });
  // LOT 2 (trouvé en testant la navigation mobile réelle) : sans ça, choisir un écran dans
  // le menu mobile laissait le menu ouvert par-dessus le contenu fraîchement affiché — le
  // clic doit fermer le menu, pas seulement changer d'écran derrière lui.
  document.querySelectorAll(".dn-nav-link").forEach(a => a.addEventListener("click", () => {
    document.querySelector("#dn-app")?.classList.remove("dn-sidebar-open");
  }));
}

function registerRoutes() {
  registerRoute("dashboard", async () => { highlightActiveNav("dashboard"); await renderDashboard(); });
  registerRoute("employees", async () => { highlightActiveNav("employees"); await renderEmployees(); });
  registerRoute("employees/:id", async () => { highlightActiveNav("employees"); await renderEmployeeDetail(getCurrentParams()); });
  for (const route of Object.keys(COMING_SOON_LOT)) {
    registerRoute(route, async () => { highlightActiveNav(route); renderComingSoon(route); });
  }
  registerNotFound(() => {
    document.querySelector("#dn-view").innerHTML = `<div class="dn-card dn-panel"><div class="dn-empty-state">Page introuvable. <a href="#/dashboard">Retour au tableau de bord</a>.</div></div>`;
  });
}

function loginScreenHTML(error) {
  return `<div style="max-width:360px;margin:80px auto" class="dn-card">
    <div style="padding:28px">
      <h1 style="font-size:18px;margin:0 0 18px">DRH NEXT</h1>
      <form id="dn-login-form">
        <label style="font-size:12px;font-weight:700;color:var(--dn-text-muted)">Identifiant</label>
        <input class="dn-input" style="margin:4px 0 12px" name="username" autocomplete="username" required>
        <label style="font-size:12px;font-weight:700;color:var(--dn-text-muted)">Mot de passe</label>
        <input class="dn-input" style="margin:4px 0 16px" name="password" type="password" autocomplete="current-password" required>
        ${error ? `<div class="dn-error-state-text" style="color:var(--dn-danger);margin-bottom:12px">${escapeHTML(error)}</div>` : ""}
        <button type="submit" class="dn-btn dn-btn-primary" style="width:100%;justify-content:center">Se connecter</button>
      </form>
    </div>
  </div>`;
}

function mountLoginScreen(error) {
  const root = document.querySelector("#dn-root");
  root.innerHTML = loginScreenHTML(error);
  document.querySelector("#dn-login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      await login(form.get("username"), form.get("password"));
      renderApp();
    } catch (err) {
      mountLoginScreen(err?.message || "Connexion impossible.");
    }
  });
}

function mountForbiddenScreen() {
  document.querySelector("#dn-root").innerHTML = `<div style="max-width:420px;margin:80px auto" class="dn-card dn-panel">
    <div class="dn-error-state-title">Accès refusé</div>
    <div class="dn-error-state-text">Votre compte n'a pas accès au module DRH.</div>
  </div>`;
}

let routerStarted = false;
let routesRegistered = false;

async function renderApp() {
  const user = getUser();
  if (!user) { mountLoginScreen(); return; }
  if (!canAccessDrh()) { mountForbiddenScreen(); return; }
  mountShell();
  if (!routesRegistered) { routesRegistered = true; registerRoutes(); }
  if (!routerStarted) { routerStarted = true; startRouter(); }
  else navigate(location.hash.replace(/^#\/?/, "") || "dashboard");
}

(async function bootstrap() {
  await restoreSession();
  await renderApp();
})();
