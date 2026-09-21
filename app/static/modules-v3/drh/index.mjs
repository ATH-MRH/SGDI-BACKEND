// ATLAS V3 — modules-v3/drh/index.mjs
//
// Point d'entrée du domaine DRH (§3/§4 de la mission). Enregistre QUATRE modules V3 distincts
// — drh-dashboard, drh-employees, drh-employee-dossier, drh-recruitment — plutôt qu'un seul
// gros module : chacun a son propre cycle mount/unmount, et surtout n'importe JAMAIS le JS
// des trois autres tant qu'il n'est pas visité (import() paresseux, §21 de la mission
// core-v3/module-registry.mjs). Routes : "drh" (tableau de bord), "drh/employees" (annuaire),
// "drh/employees/:id" (dossier 360°, deep link direct), "drh/recrutement" (recrutement).
//
// RBAC (§19) : canAccessDrhV3() reproduit à l'IDENTIQUE le critère déjà audité de
// drh-next/core/permissions.mjs::canAccessDrh (rôles rh/drh/recruteur, préfixe "REC" legacy,
// structures autorisées, module "drh"/"recrute") — pas une nouvelle règle inventée, le même
// miroir d'affichage. Le backend reste seul juge réel à chaque appel API (_ensure_*_allowed).
import { getUser } from "../../core-v3/session.mjs";
import { registerModule, deactivateIfChanged, getModule, markActive } from "../../core-v3/module-registry.mjs";
import { registerRoute } from "../../core-v3/router.mjs";

const DRH_ROLES = new Set(["admin", "adm", "adm1", "adm2", "rh", "drh", "recruteur"]);
const DRH_STRUCTURES = new Set(["drh", "recrutement", "recruteur", "gestionnaire_rh"]);

function normalizeModuleKeys(raw) {
  if (Array.isArray(raw)) return new Set(raw.map(k => String(k).toLowerCase()));
  if (raw && typeof raw === "object") return new Set(Object.keys(raw).map(k => k.toLowerCase()));
  return new Set();
}

export function canAccessDrhV3() {
  const user = getUser();
  if (!user) return false;
  if (user.authorizedModules != null) {
    const keys = normalizeModuleKeys(user.authorizedModules);
    if (keys.has("drh") || keys.has("recrute") || user.moduleAccessGlobal === true) return true;
  }
  const role = String(user.role || "").toLowerCase();
  if (DRH_ROLES.has(role)) return true;
  const username = String(user.username || "").toUpperCase();
  if (username.startsWith("REC")) return true;
  const structures = (user.authorizedStructures || []).map(s => String(s).toLowerCase());
  return structures.some(s => DRH_STRUCTURES.has(s));
}

const NAV_ITEMS = [
  { route: "drh", label: "Tableau de bord RH" },
  { route: "drh/employees", label: "Employés" },
  { route: "drh/recrutement", label: "Recrutement" },
];

export function drhNavItems() {
  return canAccessDrhV3() ? NAV_ITEMS : [];
}

function registerScreen(key, routePattern, implPath, mountFnName, unmountFnName, extraParams, onEnter) {
  registerModule({
    key,
    routes: [routePattern],
    permissions: canAccessDrhV3,
    load: () => import(implPath),
    mount: async (container, params) => {
      const impl = await import(implPath);
      await impl[mountFnName](container, ...(extraParams ? [params] : []));
    },
    unmount: async () => {
      const impl = await import(implPath);
      impl[unmountFnName]?.();
    },
  });
  registerRoute(routePattern, async (params) => {
    onEnter?.(routePattern);
    await deactivateIfChanged(key);
    const def = getModule(key);
    await def.mount(document.querySelector("#v3-module-root"), params);
    markActive(key);
  });
}

/**
 * @param {(routePattern: string) => void} [onEnter] — appelé à l'entrée de chaque route DRH
 *   (ex: surligner le lien de sidebar correspondant côté app.mjs) — optionnel, purement
 *   d'affichage, jamais requis pour le fonctionnement du module.
 */
export function registerDrhRoutes(onEnter) {
  registerScreen("drh-dashboard", "drh", "./dashboard.mjs", "mountDrhDashboard", "unmountDrhDashboard", false, onEnter);
  registerScreen("drh-employees", "drh/employees", "./employees.mjs", "mountEmployees", "unmountEmployees", false, onEnter);
  registerScreen("drh-employee-dossier", "drh/employees/:id", "./employee-dossier.mjs", "mountEmployeeDossier", "unmountEmployeeDossier", true, onEnter);
  registerScreen("drh-recruitment", "drh/recrutement", "./recruitment.mjs", "mountRecruitment", "unmountRecruitment", false, onEnter);
}
