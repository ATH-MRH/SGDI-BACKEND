// ATLAS V3 — core-v3/bootstrap.mjs
//
// Orchestrateur de démarrage (§6 de la mission). Charge UNIQUEMENT : session, auth,
// permissions, router, shell, navigation, registre de modules, télémétrie minimale.
//
// INTERDIT ICI, SANS EXCEPTION : employees, contracts, leaves, sanctions, documents,
// assignments, equipment, candidates, movements, sites complets — aucune collection
// métier globale. Un test architectural (voir tests_frontend/core-v3/) échoue si ce
// fichier importe un jour un module dont le nom correspond à l'un de ces domaines.
import { restoreSession, logout as authLogout } from "./auth.mjs";
import { getUser, clearSession } from "./session.mjs";
import { startRouter, registerNotFound } from "./router.mjs";
import { deactivateIfChanged, disposeAll } from "./module-registry.mjs";
import { emit } from "./events.mjs";
import { recordBootstrap, recordError } from "./telemetry.mjs";

/**
 * @param {object} config
 * @param {() => void} config.renderLogin — écran de connexion, appelé si aucune session
 * @param {() => void} config.renderForbidden — écran d'accès refusé (§28, purement d'affichage)
 * @param {() => void} config.renderShell — coquille applicative (barre latérale, en-tête)
 * @param {(moduleKey:string) => boolean} [config.canAccessApp] — garde globale optionnelle
 *   (ex: au moins un module autorisé) avant même d'afficher la coquille.
 * @param {() => void} [config.registerRoutes] — enregistrement des routes V3, appelé une
 *   seule fois après la coquille montée, jamais avant (aucune route ne doit pouvoir se
 *   déclencher avant que la session soit connue).
 */
export async function bootstrap(config) {
  const t0 = performance.now();
  try {
    await restoreSession();
    const user = getUser();
    if (!user) {
      config.renderLogin();
      return;
    }
    if (config.canAccessApp && !config.canAccessApp()) {
      config.renderForbidden();
      return;
    }
    config.renderShell();
    registerNotFound(() => config.renderNotFound ? config.renderNotFound() : null);
    config.registerRoutes?.();
    startRouter();
    emit("session:changed", { user });
  } catch (e) {
    recordError("bootstrap", e?.message || e);
    throw e;
  } finally {
    recordBootstrap(performance.now() - t0);
  }
}

/** Déconnexion propre (§11) : purge modules + caches + session, dans cet ordre, avant de
 * revenir à l'écran de connexion. */
export async function logoutAndReset(renderLogin) {
  await disposeAll();
  authLogout();
  emit("session:changed", { user: null });
  renderLogin();
}

export { deactivateIfChanged };
