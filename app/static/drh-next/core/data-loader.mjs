// DRH NEXT — core/data-loader.js
//
// Primitive commune pour toute lecture de données depuis un module : requête
// par clé, coalescing (deux appelants simultanés partagent la même requête
// réseau), cache court optionnel, invalidation, AbortController, retry sur
// échec transitoire uniquement. Le contrôle de fraîcheur (session/navigation)
// pour la DÉCISION DE RENDU reste délibérément laissé au CONSOMMATEUR via
// race-guard.js — data-loader.js ne décide jamais lui-même qu'une réponse
// doit être jetée du DOM, il fournit la donnée et laisse l'appelant vérifier
// avant d'écrire dans le DOM/état, exactement le patron déjà établi côté
// Legacy (LOT REFACTOR V1).
//
// LOT 2 §7 (revue) — trou réel trouvé et corrigé ICI, pas dans un module
// appelant : deux clés LOGIQUEMENT identiques (ex. "drh:employees:page=1:
// size=50:q=:mode=actifs", le cas le plus courant — page 1 par défaut) sous
// DEUX SESSIONS DIFFÉRENTES partageaient la même entrée inFlight/cache tant
// qu'aucun module appelant n'incluait explicitement l'identité de session
// dans sa clé — un oubli dans un futur module (LOT 3+) aurait suffi à faire
// fuiter les données d'une société vers une autre. La génération de session
// est donc préfixée AUTOMATIQUEMENT ici, en un seul endroit, pour TOUS les
// appelants présents et futurs, sans qu'aucun n'ait à y penser.
import { ApiError } from "./api.mjs";
import { getSessionGeneration } from "./session.mjs";

const inFlight = new Map(); // internalKey (préfixée session) -> Promise
const cache = new Map(); // internalKey (préfixée session) -> { value, expiresAt }

function internalKey(key) {
  return `s${getSessionGeneration()}:${key}`;
}

function isRetryable(err) {
  if (!(err instanceof ApiError)) return true;
  return err.code === "NETWORK_ERROR" || err.code === "TIMEOUT" || err.code === "SERVER_ERROR";
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/**
 * @param {string} key clé de cache/coalescing (ex: "drh:dashboard:SOCIETE_X")
 * @param {(signal: AbortSignal) => Promise<any>} loaderFn
 * @param {object} [options]
 * @param {number} [options.ttlMs=0] durée de fraîcheur du cache court (0 = pas de cache)
 * @param {number} [options.retry=1] tentatives supplémentaires sur échec transitoire
 * @param {number} [options.retryDelayMs=400]
 */
export function loadData(key, loaderFn, options = {}) {
  const { ttlMs = 0, retry = 1, retryDelayMs = 400 } = options;
  const ikey = internalKey(key);

  if (ttlMs > 0) {
    const cached = cache.get(ikey);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  }
  if (inFlight.has(ikey)) return inFlight.get(ikey);

  const controller = new AbortController();
  const run = async (attempt) => {
    try {
      const value = await loaderFn(controller.signal);
      // Une session différente au moment où la réponse arrive ne doit jamais alimenter le
      // cache de la nouvelle session (ikey a changé de préfixe entre-temps ; on écrit alors
      // dans une entrée que plus personne ne relira jamais — inoffensif mais volontairement
      // évité pour ne pas laisser grossir la Map indéfiniment).
      if (ttlMs > 0 && internalKey(key) === ikey) cache.set(ikey, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } catch (err) {
      if (attempt < retry && isRetryable(err) && !controller.signal.aborted) {
        await sleep(retryDelayMs * (attempt + 1));
        return run(attempt + 1);
      }
      throw err;
    }
  };

  const promise = run(0).finally(() => { inFlight.delete(ikey); });
  promise.abort = () => controller.abort();
  inFlight.set(ikey, promise);
  return promise;
}

/** @param {string|RegExp} keyOrPrefix une clé exacte, ou un préfixe si un RegExp est fourni —
 *  toujours relatif à la clé LOGIQUE fournie par l'appelant (sans le préfixe de génération de
 *  session, ajouté et retiré ici de façon transparente). */
export function invalidate(keyOrPrefix) {
  const currentPrefix = `s${getSessionGeneration()}:`;
  if (keyOrPrefix instanceof RegExp) {
    for (const k of cache.keys()) {
      if (!k.startsWith(currentPrefix)) continue;
      if (keyOrPrefix.test(k.slice(currentPrefix.length))) cache.delete(k);
    }
    return;
  }
  cache.delete(currentPrefix + keyOrPrefix);
}

export function clearAllCache() { cache.clear(); }

// Réservé aux tests — voir session.js pour la même remarque sur les singletons réels.
export function _resetForTests() { inFlight.clear(); cache.clear(); }
