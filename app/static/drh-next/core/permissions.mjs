// DRH NEXT — core/permissions.js
//
// Miroir CÔTÉ AFFICHAGE des règles déjà appliquées côté backend (authorized_modules,
// structures). Ne remplace jamais la vérification serveur : masque une action non
// autorisée dans l'UI, mais chaque appel API reste protégé indépendamment côté
// FastAPI (voir app/modules/drh/routes.py, _ensure_recruitment_access notamment).
// Si ce module se trompe, le pire résultat est une erreur 403 affichée — jamais un
// accès réellement accordé à tort.
import { getUser } from "./session.mjs";

const DRH_ROLES = new Set(["admin", "adm", "adm1", "adm2", "rh", "drh", "recruteur"]);
const DRH_STRUCTURES = new Set(["drh", "recrutement", "recruteur", "gestionnaire_rh"]);

export function canAccessDrh() {
  const user = getUser();
  if (!user) return false;
  if (user.authorizedModules != null) {
    const keys = normalizeModuleKeys(user.authorizedModules);
    return keys.has("drh") || keys.has("recrute") || user.moduleAccessGlobal === true;
  }
  const role = String(user.role || "").toLowerCase();
  if (DRH_ROLES.has(role)) return true;
  const username = String(user.username || "").toUpperCase();
  if (username.startsWith("REC")) return true;
  const structures = (user.authorizedStructures || []).map(s => String(s).toLowerCase());
  return structures.some(s => DRH_STRUCTURES.has(s));
}

function normalizeModuleKeys(raw) {
  if (Array.isArray(raw)) return new Set(raw.map(k => String(k).toLowerCase()));
  if (raw && typeof raw === "object") return new Set(Object.keys(raw).map(k => k.toLowerCase()));
  return new Set();
}

export function currentSocietyScope() {
  const user = getUser();
  return user?.authorizedSocieties || [];
}
