# ATLAS V3 — Matrice de dépendances par domaine

Complète `atlas-v3-architecture-baseline.md`. Méthode : lecture directe (routes déjà
enregistrées dans `module-registry.js`/`MODULE_ROUTES`, taille réelle des fichiers déjà
extraits, `db.*` identifiées par grep ciblé). Les domaines marqués "à approfondir" n'ont pas pu
être cartographiés avec la même précision dans le temps de cet audit — ne pas les migrer sans
un second passage dédié.

| Domaine | Route(s) | Lazy JS (module-registry) | Taille JS | `db.*` principaux | Notes |
|---|---|---|---:|---|---|
| Dashboard général | `dashboard` | ❌ non extrait (dans sgdi-app.js) | — | agents, conges, incidents, clients, stockArticles, feuillePresence, candidats, echanges | Cible du module pilote §13 — voir plus bas, déjà indépendant de `db.agents` pour ses KPI principaux (commit `b625ab2`/`397a378`) |
| DRH | `drh`, `conges` | ✅ `drh.js` (725 l.) + `drh-dashboard.js` (466 l.) + dépendance `leaves.js` (505 l.) | ~1 700 l. | agents, conges, contrats, contratsPersonnel, candidats | `sgdiEnsureEmployeesForDisplay(force:true)` en tête de `renderDRH()` — full fetch à CHAQUE sous-écran (voir baseline) |
| Effectif (liste employés) | `effectif`, `agents` | ✅ `employees.js` (604 l.) | 604 l. | agents | Table Legacy dense, photos inline avec repli avatar (déjà vérifié lors du hotfix payload) |
| Fiche de position / Badges | `fiches`, `badge` | ✅ `positions.js` (843 l.) | 843 l. | agents, sites | **Sensible** : impression de badge avec vraie photo, pas de repli — protégé par le garde-fou `cacheMayBeLight` du hotfix payload |
| Contrats | `contrats` | ✅ `contracts.js` (1 044 l.) | 1 044 l. | agents, contrats, contratsPersonnel, avenants, candidats | |
| Recrutement | `recrutement`, `reserve`, `candidats_archives` | ✅ `recruitment.js` (1 313 l.) + `recruitment-actions.js` (269 l.) | ~1 580 l. | candidats | |
| OPS | `ops` | ✅ `ops.js` (1 313 l.) + `ops-1.js` (36 l.) | ~1 350 l. | agents, sites, opsMouvements, incidents | Scope `sgdiSqlSyncTasks` dédié ; compteurs (Affectés, Taux d'affectation) calculés depuis les affectations, dépendance documentée (`LOT DATA-1 §3`) |
| Superviseur | `superviseur` | ✅ partage `ops.js` (même clé module `ops` dans `MODULE_ROUTES`) | — | agents (filtré société), sites | Lecture employés déjà scopée société (pas l'appel complet), scope `sgdiSqlSyncTasks` dédié |
| Matériel | `materiel` | ✅ `material.js` (1 246 l.) + `material-inventory.js` (1 256 l.) + `material-stores.js` (1 260 l.) + `material-movements.js` (371 l.) | ~4 130 l. | agents, stockArticles, stockMouvements, magasins, fournisseurs | Le plus volumineux des modules déjà extraits |
| Commercial | `commercial` | ✅ `commercial.js` (1 345 l.) + `commercial-1.js` (498 l.) | ~1 840 l. | clients, prospects, opportunites, visites, devis | |
| Facturation | `facturation` | ✅ `facturation.js` (1 418 l.) + `facturation-1.js` (461 l.) | ~1 880 l. | factures, paiements, avances, avoirs, caisse | |
| Finance / Comptabilité / Achats / Ventes / Reporting | `accounting`, `achats`, `ventes`, `reporting` | ❌ non extraits (inline `sgdi-app.js:8392-8395`) | — | factures, paiements, stockArticles, clients (partagés avec Commercial/Facturation) | **À approfondir** : périmètre exact non tracé finement, quatre domaines encore 100% monolithe |
| Secrétariat | `secretariat` | ✅ `secretariat.js` (180 l.) | 180 l. | missions, siteInspections | Backend `loans/secretariat` distinct (`API_MODULE_PREFIXES`), lien exact avec ce module frontend à vérifier |
| Prêts / Caisse | — | ❌ aucune route dédiée identifiée dans `sgdi-app.js` | — | caisse | **À approfondir** : présent côté backend (`/api/loans/cash`, module `caisse`) sans route frontend clairement isolée trouvée dans ce passage — possible sous-écran de Secrétariat ou de Facturation, non confirmé |
| Portail RH | `portail`, `demandes_personnel`, `demandes_structure` | ✅ `portal.js` (704 l.) | 704 l. | demandesPersonnel, demandesStructure | |
| Portail Client | — | ❌ hors `sgdi-app.js` | — | — | **Hors périmètre probable de ce refactoring** : `app/modules/client_portal/` est un module BACKEND séparé (audité lors de la mission P0 sécurité documents, session précédente) — vraisemblablement une interface distincte, pas une route de ce monolithe. À confirmer avant tout travail. |
| Rondes | — | ❌ non localisée avec certitude | — | — | **À approfondir** : aucune route "ronde"/"rondes" trouvée dans le switch principal lors de ce passage |
| Assistant (IA) | — | N/A — widget flottant | — | — | `setInterval(aiMount,2000)` (`sgdi-app.js:20516`) : composant global monté par polling, pas une route — nature différente des autres domaines, à traiter comme un cas à part |
| Cockpit | `admin` (Administration système) probable | ✅ `administration*.js` (7 fichiers, ~1 800 l. cumulés) | ~1 800 l. | variable selon section | **À approfondir** : "Cockpit" n'est nommé nulle part explicitement dans le code — hypothèse la plus probable est le tableau de bord Administration générale (`isAdminGeneralSession()`), non confirmée |
| Alertes | `alerts` | ✅ `alerts.js` (209 l.) | 209 l. | incidents, echanges | |
| Pointage | `pointage` | ✅ `pointage.js` (1 305 l.) + `pointage-1.js` (579 l.) | ~1 880 l. | pointages, feuillePresence, agents | |
| Sites | `sites` | ✅ `sites.js` (1 246 l.) + `sites-1.js` (1 260 l.) | ~2 510 l. | sites | |
| Incidents | `incidents` | ✅ `incidents.js` (168 l.) | 168 l. | incidents | |
| Agenda | `agenda` | ✅ `agenda.js` (226 l.) | 226 l. | agendaEvents | |
| Paie | `paie` | ✅ `paie.js` (701 l.) | 701 l. | paieBulletins, paieElements, paieClotures, paieGrilles, agents | |

## Constat transversal

- **~24 500 lignes** déjà extraites en modules lazy (`app/static/js/modules/*.js`), mais
  **aucune** ne respecte le contrat V3 (§5) : toutes lisent/écrivent `db`/`session` globaux
  directement, aucun `mount`/`unmount`/`dispose` formel au-delà du `init`/`destroy` déjà
  fourni par `module-registry.js`.
- 5 domaines nommés par la mission (Finance/Comptabilité/Achats/Ventes/Reporting) restent
  **entièrement dans le monolithe**, jamais extraits — un premier travail d'extraction (Phase
  2A-style, sans changer l'architecture de données) serait un préalable à toute migration V3
  pour ces cinq-là.
- 4 domaines (Prêts/Caisse, Portail Client, Rondes, Cockpit) n'ont **pas pu être localisés avec
  certitude** dans le temps de cet audit — les migrer sans un second passage de cartographie
  serait une "ambiguïté métier" au sens de la condition d'arrêt §32.

## Domaine pilote retenu pour ce lot

**Dashboard général** — déjà partiellement indépendant de `db.agents` (mission précédente),
routes/permissions simples, aucune ambiguïté de source canonique identifiée, KPI déjà
alimentés par un agrégat serveur réel (`sidebar-stats`). Voir rapport final, section
`## Dashboard`.
