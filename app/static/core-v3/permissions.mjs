// ATLAS V3 — core-v3/permissions.mjs
//
// Miroir CÔTÉ AFFICHAGE des règles déjà appliquées côté backend (authorized_modules,
// authorized_actions, structures). Ne remplace JAMAIS la vérification serveur (§28 de la
// mission — "Backend reste autoritaire") : masque une action non autorisée dans l'UI, mais
// chaque appel API reste protégé indépendamment côté FastAPI. Si ce module se trompe, le
// pire résultat est une erreur 403/404 affichée — jamais un accès réellement accordé à tort.
//
// Généralisé depuis app/static/drh-next/core/permissions.mjs (qui exposait uniquement
// canAccessDrh() pour son propre domaine) : canAccessModule(key) accepte n'importe quelle
// clé de module V3, pour être partagé par tous les domaines migrés, pas réimplémenté par
// chacun.
import { getUser } from "./session.mjs";

const ADMIN_ROLES = new Set(["admin", "adm", "adm1", "adm2"]);

function normalizeModuleKeys(raw) {
  if (Array.isArray(raw)) return new Set(raw.map(k => String(k).toLowerCase()));
  if (raw && typeof raw === "object") return new Set(Object.keys(raw).map(k => k.toLowerCase()));
  return new Set();
}

/**
 * @param {string} moduleKey clé de module V3 (ex: "drh", "ops", "materiel")
 * @param {string[]} [aliases] autres clés legacy équivalentes acceptées côté backend
 *   (ex: canAccessModule("drh", ["recrute"]))
 */
export function canAccessModule(moduleKey, aliases = []) {
  const user = getUser();
  if (!user) return false;
  if (ADMIN_ROLES.has(String(user.role || "").toLowerCase())) return true;
  if (user.authorizedModules != null) {
    const keys = normalizeModuleKeys(user.authorizedModules);
    if (keys.has(String(moduleKey).toLowerCase())) return true;
    if (aliases.some(a => keys.has(String(a).toLowerCase()))) return true;
    return user.moduleAccessGlobal === true;
  }
  const structures = (user.authorizedStructures || []).map(s => String(s).toLowerCase());
  return structures.includes(String(moduleKey).toLowerCase()) || aliases.some(a => structures.includes(String(a).toLowerCase()));
}

export function currentSocietyScope() {
  const user = getUser();
  return user?.authorizedSocieties || [];
}

// Miroir d'affichage d'une action sensible (validation/décision) au-dessus du périmètre
// société déjà vérifié côté backend — même critère que _require_*_action() côté FastAPI
// (rôle admin global, ou action "validate"/"admin" explicite dans authorized_actions).
export function canValidateSensitiveActions() {
  const user = getUser();
  if (!user) return false;
  if (ADMIN_ROLES.has(String(user.role || "").toLowerCase())) return true;
  const actions = (user.authorizedActions || []).map(a => String(a).toLowerCase());
  return actions.includes("validate") || actions.includes("admin");
}
