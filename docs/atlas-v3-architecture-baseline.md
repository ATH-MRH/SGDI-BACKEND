# ATLAS V3 — Baseline architecturale (audit initial)

Base : `origin/main` = `d3886a548083112441016d5c06f7ba3ff9884b58`. Méthode : lecture directe du
code, chaque affirmation citée par fichier/ligne — pas d'hypothèse. Beaucoup de constats
ci-dessous proviennent d'investigations déjà menées et vérifiées en direct lors des missions
DRH PERFORMANCE V2 et EMPLOYEES PAYLOAD HOTFIX (voir `docs/drh-performance-v2-debt.md`) ; ce
document les consolide dans une vue d'ensemble, ne les refait pas.

## sgdi-app.js — le monolithe

- **20 593 lignes**, **1 435 fonctions top-level**, aucun module ES (chargé en `<script defer>`
  classique, portée globale unique).
- État global : `let db=null, session=null, ...` (`sgdi-app.js:183`) — une trentaine de flags/
  compteurs mutables au niveau module, en plus de `db`/`session` eux-mêmes.
- **7** `window.addEventListener` globaux, **4** `setInterval` globaux permanents (purge congés
  différée, archivage pointage auto/heure, rafraîchissement demandes personnel/60s, montage
  assistant IA/2s).
- Couplage : toute fonction peut appeler toute autre fonction top-level directement (pas
  d'import/export) — aucune frontière de module vérifiable statiquement.

## module-registry.js — lazy loading JS (déjà mature, Phase 2A)

`app/static/js/core/module-registry.js` : registre `window.SGDIModules`, `MODULE_ROUTES`
(racine de route → clé de module), `loadModule`/`initModule`/`destroyModule`, cycle de vie
piloté par le routeur (`sgdi-app.js:8281` et suivants, section "Phase 2A"). Modules déjà extraits
sous `app/static/js/modules/*.js` (drh, drh-dashboard, employees, ops, ops-1, material,
material-inventory, material-movements, material-stores, positions, contracts, leaves,
recruitment, recruitment-actions, administration*, agenda, alerts, commercial, commercial-1,
facturation, facturation-1, incidents, paie, pointage, pointage-1, portal, secretariat, sites,
sites-1). **Un module non visité ne télécharge effectivement pas son JS** — vérifié par
`tests_frontend/module-campaign.test.js`. Ce mécanisme répond déjà à une bonne partie de §21.

**Limite** : chaque fichier module reste un script classique (pas d'ESM), ses fonctions
restent globales (compatibilité `onclick=`), et il continue à lire/écrire `db`/`session`
directement — aucune frontière de contrat (§5) n'existe encore à ce niveau.

## Router

Pas de routeur dédié : `renderView()` (dans `sgdi-app.js`) fait le `switch(root)` après le
portillon lazy-module (Phase 2A). Pas de fichier séparé, pas de `router.mjs` — pas de garde de
permission déclarative par route (les vérifications sont dispersées dans chaque `case`/
fonction de rendu).

## Session / Auth

- Token : `sessionStorage.getItem("sgdi_api_token_v1")` (`sgdiAuthToken()`, `sgdi-app.js:382`).
- `session` (objet global) porte rôle/société/structures/transverse — lu directement par
  des centaines d'appelants (pas d'accesseur unique).
- `sgdiDrhReadContext(society)` (`sgdi-app.js:408`) fournit un contexte `{token,scope,revision,
  key}` réutilisé comme fondation de fraîcheur/anti-race pour plusieurs lectures (employés,
  stats) — un début de `sessionGeneration`, mais partiel (pas systématisé à toute requête).
- `sgdiSessionGeneration`/`sgdiViewRenderGeneration` existent déjà (incrémentés au logout/
  changement de route) et sont déjà la base des tests de race condition existants — **réutilisables
  tels quels** pour V3, pas à réinventer.

## API

Pas de client API structuré par domaine : `window.SGDI_API` (`sgdi-app.js:1643`) est un objet
plat avec des groupes (`employees`, `contracts`, `legacy`, `auth`, ...) construits à la main,
mélangés à des appels `sgdiApi(path, options)` directs dispersés dans tout le fichier (URLs
construites inline un peu partout, pas seulement via `SGDI_API`).

## db global — la dépendance transverse centrale

`db` est peuplé par `sgdiPullState()` → `GET /api/irongs/db` (`app/modules/irongs/routes.py:155`,
jusqu'à **~26 Mo** en snapshot complet, commenté explicitement dans le code source) ou sa
variante `?light=1` (collections lourdes SQL omises). Collections portées par `db.*` (confirmé
via `SENSITIVE_SOCIETY_COLLECTIONS`, `app/modules/irongs/service.py:34`) : `agents, employees,
sites, candidats, contrats, contratsPersonnel, avenants, conges, incidents, materiel,
demandesPersonnel, demandesStructure, pointages, pointageMensuel, feuillePresence, missions,
siteInspections, agendaEvents, clients, prospects, missionBillables, opportunites, visites,
devis, factures, paiements, avances, avoirs, caisse, stockArticles, stockMouvements, magasins,
fournisseurs, echanges, paieBulletins, paieElements, paieClotures, paieGrilles` — plus
`opsMouvements`. Deux natures coexistent : certaines sont adossées à de vraies tables SQL
(`sql_bridge.SQL_COLLECTIONS` — agents/employees, sites, assignments, contrats, incidents,
feuillePresence, clients, stock*, finance*), d'autres restent un blob JSON générique
(`SgdiRecord`) sans modèle typé (conges, demandesPersonnel, contratsPersonnel, etc.) —
**découverte critique de cette session** (voir `docs/drh-performance-v2-debt.md`,
ATLAS-LEAVES-DUAL-STORE) : `db.conges` (Legacy) et le modèle typé `Leave` (DRH Next) sont deux
sources **non synchronisées**.

## sgdiSqlSyncTasks — la synchronisation globale (§7 de cette mission)

`sgdi-app.js:2631` et suivants. `sgdiSqlSyncScope(options)` détermine, à partir de
`session.transverse`/route/config d'hôte, quels domaines (`drh, ops, superviseur, materiel,
commercial`) doivent être "prêts" — **dès la connexion**, indépendamment de l'écran réellement
visité, pour les comptes admin-système (`isAdminSystemSession()` → tous domaines) et pour tout
compte dont `session.transverse` correspond à un domaine. Chaque scope actif déclenche un
chargement bloquant de la collection employés (désormais `?light=1` depuis le hotfix précédent,
voir `docs/drh-performance-v2-debt.md`, ATLAS-EMPLOYEES-BOOTSTRAP) + ses collections associées
(sites, affectations, candidats, matériel...). C'est **exactement** le concept que §7 de cette
mission demande de supprimer — actuellement protégé par un test historique délibéré
(`tests_frontend/sgdi-app.test.js`, commit `3a1dc46`) qui encode ce comportement comme voulu
tant qu'aucun consommateur n'est rendu tolérant à une absence de préchargement.

## Employés — bloat de payload (déjà corrigé partiellement)

`GET /api/drh/employees` : historique de bloat massif via `Employee.extra._legacy` non aplati
(22,3 Mo compressés observés en production pour 242 employés) — corrigé par flatten +
`?light=1` (voir `docs/drh-performance-v2-debt.md`). `GET /drh/employees/page` reste
vulnérable au même défaut (dette `DRH-EMPLOYEES-PAGE-EXTRA-BLOAT`, non corrigée).

## DRH Next — la référence architecturale déjà existante

`app/static/drh-next/` contient DÉJÀ un runtime ES modules complet et testé :
`core/session.mjs`, `core/auth.mjs`, `core/api.mjs`, `core/router.mjs`, `core/data-loader.mjs`
(coalescing + TTL + invalidation), `core/permissions.mjs`, `core/ui.mjs`, plus des modules
métier (`modules/dashboard.mjs`, `employees.mjs` avec pagination serveur, `employee-dossier.mjs`
avec onglets lazy par section, `contracts.mjs`, `assignments.mjs`, `leaves.mjs`,
`discipline.mjs`, `documents.mjs`, `recruitment.mjs`). Bootstrap minimal déjà conforme à §6/§25
(mesuré cette session : shell + dashboard sans aucun fetch employés complet). **C'est la base
la plus directe pour `core-v3/`** — pas une inspiration à réécrire, une fondation à généraliser
et promouvoir hors du seul périmètre DRH.

## CSS

`sgdi-app.css` : **10 565 lignes**, un seul fichier global, aucun découpage par domaine.

## Service Worker

`app/static/sw.js` : stratégie déjà largement conforme à §23 — API (`/api/`, `/drh/`, `/ops/`,
etc.) toujours réseau (`cache:"no-store"`), assets versionnés (`?v=`) réseau-puis-cache,
navigation/HTML réseau-d'abord avec repli court (1,2s) sur cache, version de cache explicite
(`SGDI_CACHE`). Aucune réponse API volumineuse n'est mise en cache opaque — vérifié directement
dans le code, pas de correctif nécessaire pour satisfaire cette exigence spécifique.

## Ce qui est réutilisable tel quel pour V3 (ne pas réinventer)

- `core/session.mjs`, `core/router.mjs`, `core/data-loader.mjs`, `core/api.mjs`,
  `core/permissions.mjs` (DRH Next) — patterns déjà prouvés (race guards, sessionGeneration,
  coalescing, cache scopé société).
- `module-registry.js` — lazy loading JS déjà mature côté Legacy, complémentaire (pas
  concurrent) à l'`import()` ESM natif que V3 utilisera pour ses propres modules.
- Le Service Worker.
- `GET /api/ui/sidebar-stats` (`build_erp_counters`) — agrégat serveur déjà réel (SQL, pas de
  collection complète rapatriée) pour effectif actif/congé/maladie/absent/suspendu, déjà
  consommé par plusieurs écrans Legacy en priorité sur `db.agents`.

## Ce qui doit changer

- `db` global et son peuplement par snapshot large (`sgdiPullState`/`sgdiSqlSyncTasks`) —
  cœur du refactoring (§7/§8/§12).
- Absence de contrat de module explicite (§5) — actuellement implicite par convention
  (`registerModule({key, routes, init, destroy})` dans module-registry.js, à étendre).
- Absence de client API structuré (§9) — `SGDI_API` existe mais reste plat/incomplet, URLs
  construites à la main ailleurs dans le fichier.
- `db.conges` vs `Leave` (ATLAS-LEAVES-DUAL-STORE) : à traiter AVANT de migrer tout module qui
  affiche des congés, sous peine de migrer une V3 sur la mauvaise source — dette déjà identifiée,
  non résolue, doit rester un chantier séparé (voir §32 conditions d'arrêt : "source canonique
  inconnue").

Voir `docs/atlas-v3-dependency-matrix.md` pour la cartographie détaillée par domaine.
