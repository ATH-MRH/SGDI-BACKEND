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
  R.MODULE_VERSION = R.MODULE_VERSION || "20260910-ops-employee-read";
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

  // Injection réelle d'un <script>. Surcharge­able par les tests.
  R._injectScript = function (key) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = R.MODULE_BASE + key + ".js?v=" + R.MODULE_VERSION;
      el.async = true;
      el.onload = function () { resolve(); };
      el.onerror = function () {
        reject(new Error("Échec de chargement du module « " + key + " »"));
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
    // Chargement concurrent : on renvoie la MÊME promesse.
    if (loading[key]) return loading[key];

    var p = Promise.resolve()
      .then(function () { return R._injectScript(key); })
      .then(function () {
        var mod = registry[key];
        if (!mod) {
          throw new Error("Le module « " + key + " » ne s'est pas enregistré après chargement");
        }
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
    mod.initPromise = Promise.resolve().then(function () {
      return mod.init();
    }).then(function () {
      mod.initialized = true;
      mod.initPromise = null;
      return mod;
    }, function (err) {
      mod.initialized = false;
      mod.initPromise = null;
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
