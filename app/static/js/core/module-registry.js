/* ==========================================================================
   SGDI — Registre de modules frontend (Phase 2A)
   --------------------------------------------------------------------------
   Infrastructure MINIMALE, sans framework, pour préparer le découpage futur
   de sgdi-app.js. Ce fichier ne déplace aucun code métier : il fournit
   seulement de quoi déclarer, charger à la demande, initialiser et détruire
   des modules, et de quoi rendre le routeur compatible avec ces chargements.

   Espace de noms : window.SGDIModules
   (le monolithe réutilise déjà window.SGDI comme alias de son client d'API —
   voir « window.SGDI = window.SGDI_API » — on ne s'y superpose donc pas.)

   Contrat d'un module :
     SGDIModules.registerModule({
       key,                       // identifiant unique (ex. "secretariat")
       routes,                    // racines de route gérées (ex. ["secretariat"])
       init,                      // sync ou Promise ; une fois par cycle de vie
       destroy,                   // appelé au départ du module (nettoyage)
       dependencies               // clés d'autres modules à charger avant
     })

   Chargement :
     SGDIModules.loadModule("x")        -> Promise (dédupliquée, cache au succès,
                                          état libéré au échec -> retry possible)
     SGDIModules.loadAndInitModule("x") -> loadModule puis initModule

   Le fichier d'un module est un script classique (pas de module ES) : ses
   fonctions top-level restent globales (compatibilité onclick / legacy) et il
   se termine par un appel à SGDIModules.registerModule(...).
   ========================================================================== */
;(function () {
  "use strict";

  var R = (window.SGDIModules = window.SGDIModules || {});

  // Déjà chargé (double inclusion du script) -> ne rien réinitialiser.
  if (R.__ready) return;
  R.__ready = true;

  // Version de cache-busting des fichiers de modules (alignée sur index.html).
  R.MODULE_VERSION = R.MODULE_VERSION || "20260914-alerts-menu-fix";
  R.MODULE_BASE = R.MODULE_BASE || "/static/js/modules/";

  // Carte statique racine-de-route -> clé de module, connue dès le bootstrap.
  // C'est elle qui permet au routeur de savoir qu'une route « appartient » à un
  // module encore non chargé. Une extraction future ajoute une entrée ici.
  R.MODULE_ROUTES = R.MODULE_ROUTES || {
    // Racine de route -> clé de module extrait, chargé à la demande.
    "secretariat": "secretariat",
    "fiches": "positions",
    "badge": "positions",
    "portail": "portal",
    "demandes_personnel": "portal",
    "demandes_structure": "portal",
    "agenda": "agenda",
    "commercial": "commercial",
    "facturation": "facturation",
    "incidents": "incidents",
    "sites": "sites",
    "admin": "administration", "parametres": "administration",
    "drh": "drh",
    "conges": "drh",
    "effectif": "employees",
    "agents": "employees",
    "contrats": "contracts",
    "recrutement": "recruitment",
    "reserve": "recruitment",
    "candidats_archives": "recruitment",
    "materiel": "material",
    "ops": "ops",
    "superviseur": "ops",
    "pointage": "pointage",
    "alerts": "alerts",
    "paie": "paie"
  };

  var registry = Object.create(null);   // key -> { key, init, destroy, routes, dependencies, initialized }
  var loading = Object.create(null);     // key -> Promise en cours
  var routeIndex = Object.create(null);  // route root -> key (rempli à l'enregistrement)

  function noop() {}

  R.registerModule = function registerModule(def) {
    if (!def || typeof def !== "object" || !def.key) {
      throw new Error("SGDIModules.registerModule: un objet { key, ... } est requis");
    }
    // Idempotent : un 2e enregistrement de la même clé est ignoré (on conserve
    // l'état initialized existant).
    if (registry[def.key]) return registry[def.key];

    var mod = {
      key: String(def.key),
      init: typeof def.init === "function" ? def.init : noop,
      destroy: typeof def.destroy === "function" ? def.destroy : noop,
      routes: Array.isArray(def.routes) ? def.routes.map(String) : [],
      dependencies: Array.isArray(def.dependencies) ? def.dependencies.map(String) : [],
      initialized: false,
      initPromise: null
    };
    registry[mod.key] = mod;
    mod.routes.forEach(function (r) { routeIndex[r] = mod.key; });
    return mod;
  };

  R.getModule = function (key) { return registry[key] || null; };
  R.isModuleRegistered = function (key) { return !!registry[key]; };
  R.isModuleInitialized = function (key) {
    return !!(registry[key] && registry[key].initialized);
  };
  R.isModuleInitializing = function (key) {
    return !!(registry[key] && registry[key].initPromise);
  };
  R.isModuleLoading = function (key) { return !!loading[key]; };

  // Clé de module responsable d'une racine de route (route déjà enregistrée OU
  // simplement déclarée dans MODULE_ROUTES pour un module pas encore chargé).
  R.moduleKeyForRoute = function (root) {
    return routeIndex[root] || R.MODULE_ROUTES[root] || null;
  };

  // Le routeur doit-il préparer un module avant de rendre cette racine de route ?
  // Une route modulaire n'est PRÊTE que si son module est à la fois enregistré
  // (script chargé) ET initialisé (init() terminé avec succès). Tant que l'un des
  // deux manque — script absent, ou init échoué / non retenté, ou module détruit
  // au départ puis ré-ouvert — le portillon doit repasser (retry init inclus).
  R.routeNeedsModuleLoad = function (root) {
    var key = R.moduleKeyForRoute(root);
    if (!key) return false;
    var mod = registry[key];
    return !mod || !mod.initialized;
  };

  // ── Cycle de vie « module actif » piloté par le routeur ────────────────────
  // Le routeur mémorise le module de la route courante. Au changement de module
  // (ou passage vers une route legacy), il détruit le précédent.
  R.activeModuleKey = null;

  // Détruit le module actif s'il diffère de la cible. no-op si identique, si
  // aucun module actif, ou si le module actif n'est pas initialisé (destroyModule
  // garde déjà ce cas).
  R.deactivateIfChanged = function (nextKey) {
    if (R.activeModuleKey && R.activeModuleKey !== nextKey) {
      return R.destroyModule(R.activeModuleKey);
    }
  };

  // Marque un module prêt comme actif, juste avant son rendu.
  R.markActiveModule = function (key) {
    if (R.isModuleInitialized(key)) R.activeModuleKey = key;
  };

  // 30s : même convention que le délai d'expiration réseau de sgdiApi (voir
  // sgdi-app.js) — un ordre de grandeur "manifestement bloqué", pas une limite
  // fine. Sans ce filet, un <script> dont ni onload ni onerror ne se déclenche
  // jamais (connexion qui reste ouverte sans jamais aboutir ni échouer — vu en
  // conditions réelles sur « Fiche de position ») laissait l'écran "Chargement
  // du module..." bloqué INDÉFINIMENT : aucun code de ce fichier n'avait de
  // filet de temps pour ce chemin, contrairement à la couche API. loadModule()
  // gère déjà le rejet (retire loading[key], permet une nouvelle tentative) et
  // renderView() affiche déjà un écran d'erreur avec bouton "Réessayer" sur
  // tout rejet — ce correctif branche seulement ce chemin d'échec déjà prévu.
  // C'est un filet ULTIME, pas l'UX normale : voir sgdi-app.js pour la
  // dégradation progressive affichée avant ce seuil (3s / 8s).
  R.MODULE_LOAD_TIMEOUT_MS = 30000;

  // Instrumentation légère, DEV UNIQUEMENT — no-op par défaut, donc aucun bruit
  // en production tant que rien ne l'active explicitement (à la console :
  // SGDIModules.DEBUG_LOG = true). Jamais de donnée sensible : uniquement clé
  // de module, URL publique, timestamps et code d'erreur.
  R.DEBUG_LOG = false;
  R._onModuleLoadEvent = function (event) {
    if (!R.DEBUG_LOG) return;
    try { console.debug("[SGDIModules]", event.key, event.phase, event.code || "", event.ms + "ms"); } catch (e) {}
  };

  // Codes d'erreur stables (section 10) — l'UI reste simple ("Module
  // indisponible" + Réessayer), mais err.code permet de savoir, en log, LAQUELLE
  // des étapes a échoué sans avoir à deviner depuis un message en français.
  R.ERROR_CODES = {
    SCRIPT_TIMEOUT: "MODULE_SCRIPT_TIMEOUT",
    SCRIPT_404: "MODULE_SCRIPT_404",
    SCRIPT_ERROR: "MODULE_SCRIPT_ERROR",
    NOT_REGISTERED: "MODULE_NOT_REGISTERED",
    INIT_ERROR: "MODULE_INIT_ERROR",
  };

  // Injection réelle d'un <script>. Surcharge­able par les tests.
  R._injectScript = function (key) {
    var url = R.MODULE_BASE + key + ".js?v=" + R.MODULE_VERSION;
    var startedAt = Date.now();
    return new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = url;
      el.async = true;
      var settled = false;

      function cleanupEl() {
        // Retire le <script> en échec du DOM (§6) : un retry en injecte un NEUF,
        // jamais deux scripts concurrents pour la même clé qui traînent en <head>.
        try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
      }

      var timer = setTimeout(function () {
        if (settled) return;
        settled = true; // bloque un onerror/onload tardif AVANT toute étape async
        cleanupEl();
        var err = new Error("Délai de chargement dépassé pour le module « " + key + " » — vérifiez votre connexion puis réessayez.");
        err.code = R.ERROR_CODES.SCRIPT_TIMEOUT;
        R._onModuleLoadEvent({ key: key, url: url, phase: "script", code: err.code, ms: Date.now() - startedAt });
        reject(err);
      }, R.MODULE_LOAD_TIMEOUT_MS);

      el.onload = function () {
        if (settled) return; // arrivé après l'expiration : le rejet est déjà parti, ne rien faire de plus
        settled = true;
        clearTimeout(timer);
        R._onModuleLoadEvent({ key: key, url: url, phase: "script", code: "OK", ms: Date.now() - startedAt });
        resolve();
      };

      el.onerror = function () {
        if (settled) return;
        settled = true; // verrouillé ICI, avant la sonde async, pour ne jamais courir avec le timer
        clearTimeout(timer);
        cleanupEl();
        // Un <script src> ne donne jamais le vrai code HTTP via onerror (limite du
        // navigateur, pas de ce code) — une sonde HEAD légère et bornée (3s, best-
        // effort) permet de distinguer un vrai 404 (build incohérent) d'un échec
        // réseau générique, UNIQUEMENT sur ce chemin d'échec déjà en cours — aucun
        // coût sur le chemin normal, qui ne passe jamais ici.
        var probeCtrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
        var probeTimer = probeCtrl ? setTimeout(function () { probeCtrl.abort(); }, 3000) : null;
        var probe = (typeof fetch === "function")
          ? fetch(url, { method: "HEAD", cache: "no-store", signal: probeCtrl ? probeCtrl.signal : undefined })
            .then(function (r) { return r.status; }).catch(function () { return null; })
          : Promise.resolve(null);
        probe.then(function (status) {
          if (probeTimer) clearTimeout(probeTimer);
          var is404 = status === 404;
          var err = new Error(is404
            ? "Module « " + key + " » introuvable (404) — build front/serveur probablement incohérent."
            : "Échec de chargement du module « " + key + " ».");
          err.code = is404 ? R.ERROR_CODES.SCRIPT_404 : R.ERROR_CODES.SCRIPT_ERROR;
          err.httpStatus = status;
          R._onModuleLoadEvent({ key: key, url: url, phase: "script", code: err.code, ms: Date.now() - startedAt });
          reject(err);
        });
      };

      (document.head || document.documentElement).appendChild(el);
    });
  };

  function loadDependencies(mod) {
    if (!mod || !mod.dependencies.length) return Promise.resolve();
    return Promise.all(mod.dependencies.map(function (dep) { return R.loadModule(dep); }));
  }

  R.loadModule = function loadModule(key) {
    if (!key) return Promise.reject(new Error("SGDIModules.loadModule: clé requise"));

    // Déjà enregistré : son script a déjà tourné (chargé, ou concaténé en test).
    if (registry[key]) {
      return loadDependencies(registry[key]).then(function () { return registry[key]; });
    }
    // Chargement concurrent : on renvoie la MÊME promesse (jamais deux <script>
    // pour la même clé en vol en même temps — couvre aussi le double-clic/double
    // navigation pendant un chargement, voir tests_frontend/module-races.test.js).
    if (loading[key]) return loading[key];

    var loadStartedAt = Date.now();
    var p = Promise.resolve()
      .then(function () { return R._injectScript(key); })
      .then(function () {
        var mod = registry[key];
        if (!mod) {
          var err = new Error("Le module « " + key + " » ne s'est pas enregistré après chargement");
          err.code = R.ERROR_CODES.NOT_REGISTERED;
          R._onModuleLoadEvent({ key: key, phase: "register", code: err.code, ms: Date.now() - loadStartedAt });
          throw err;
        }
        R._onModuleLoadEvent({ key: key, phase: "register", code: "OK", ms: Date.now() - loadStartedAt });
        return loadDependencies(mod).then(function () { return mod; });
      })
      .then(function (mod) {
        delete loading[key]; // succès : promesse retirée (registry sert de cache)
        return mod;
      })
      .catch(function (err) {
        delete loading[key]; // échec : état libéré -> nouvelle tentative possible
        throw err;
      });

    loading[key] = p;
    return p;
  };

  // loaded = enregistré ; initializing = initPromise ; initialized = succès ;
  // active = activeModuleKey. La Promise est publiée AVANT l'appel du hook,
  // y compris pour un hook synchrone, afin de dédupliquer les appels réentrants.
  R.initModule = function initModule(key) {
    var mod = registry[key];
    if (!mod) return Promise.reject(new Error("SGDIModules.initModule: module inconnu « " + key + " »"));
    if (mod.initialized) return Promise.resolve(mod);
    if (mod.initPromise) return mod.initPromise;
    var initStartedAt = Date.now();
    mod.initPromise = Promise.resolve().then(function () {
      return mod.init();
    }).then(function () {
      mod.initialized = true;
      mod.initPromise = null;
      R._onModuleLoadEvent({ key: key, phase: "init", code: "OK", ms: Date.now() - initStartedAt });
      return mod;
    }, function (err) {
      mod.initialized = false;
      mod.initPromise = null;
      if (!err || !err.code) {
        err = err instanceof Error ? err : new Error(String(err));
        err.code = R.ERROR_CODES.INIT_ERROR;
      }
      R._onModuleLoadEvent({ key: key, phase: "init", code: err.code, ms: Date.now() - initStartedAt });
      throw err;
    });
    return mod.initPromise;
  };

  // Le nettoyage d'un hook reste sa responsabilité (utiliser finally pour ses
  // ressources). Même s'il jette, libérer notre état et retourner l'erreur au
  // routeur pour diagnostic ; une erreur de nettoyage ne bloque pas la navigation.
  R.destroyModule = function destroyModule(key) {
    var mod = registry[key];
    try {
      if (mod && mod.initialized) mod.destroy();
    } catch (err) {
      return err;
    } finally {
      if (mod) mod.initialized = false;
      if (R.activeModuleKey === key) R.activeModuleKey = null;
    }
  };

  R.loadAndInitModule = function loadAndInitModule(key) {
    return R.loadModule(key).then(function () { return R.initModule(key); });
  };

  // Aide aux tests : remise à zéro complète (registre + files + index).
  R._resetModuleRegistry = function () {
    Object.keys(registry).forEach(function (k) { delete registry[k]; });
    Object.keys(loading).forEach(function (k) { delete loading[k]; });
    Object.keys(routeIndex).forEach(function (k) { delete routeIndex[k]; });
    R.activeModuleKey = null;
  };

  // Snapshot lisible pour diagnostic / tests.
  R.moduleRegistrySnapshot = function () {
    return Object.keys(registry).map(function (k) {
      return { key: k, routes: registry[k].routes.slice(), initialized: registry[k].initialized, initializing: !!registry[k].initPromise, active: R.activeModuleKey === k };
    });
  };
})();
