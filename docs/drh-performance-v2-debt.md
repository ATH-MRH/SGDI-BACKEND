# DRH PERFORMANCE V2 — dette technique documentée

Mission "DRH PERFORMANCE V2" (branche `feat/drh-next-v1-finish`). Objectif initial : rapprocher
la sensation de rapidité de `drh.irongs.com` de `dfa.irongs.com` sans toucher au design, aux
fonctionnalités ni à la source canonique des données. Voir aussi le
[rapport de campagne antérieur](drh-performance-report.md) (branche `perf/drh-loading`,
antérieure à cette mission) qui avait déjà traité la déduplication des lectures employés/sidebar
et le snapshot backend allégé — cette mission part de cet état, ne le refait pas.

Clôturée volontairement après l'étape P1 : décision produit de ne pas engager une refonte
transversale de quatre domaines (DRH, OPS, Superviseur, Matériel) uniquement pour gagner du
temps de bootstrap. Voir `## Amélioration obtenue` pour ce qui a réellement été livré et commité.

## ATLAS-EMPLOYEES-BOOTSTRAP

**Cause.** À la connexion, dès que `session.transverse` correspond à un module dépendant des
employés (DRH, OPS, superviseur, matériel), `sgdiSqlSyncTasks()`
(`app/static/sgdi-app.js`) déclenche `ensureEmployees()` → `sgdiPullCurrentEmployees()` →
`window.SGDI_API.employees.list()` — la collection **complète, non paginée**
(`GET /api/drh/employees`, ou `/ops/employees` selon le contexte) — **avant que
l'utilisateur ait choisi un écran**, y compris s'il atterrit sur le tableau de bord général qui
n'en a pas besoin. Vérifié en direct (Puppeteer, Docker/Postgres réel) : la requête part dès
l'écran de sélection de société, avant tout choix de module.

**Ce n'est pas un oubli.** C'est une décision délibérée, déjà prise et testée AVANT cette
mission — commit `3a1dc46` (`test(drh): align performance tests with current employee loading
contract`, 2026-09-13), qui documente explicitement dans
`tests_frontend/sgdi-app.test.js` : *"Employés reste dans le chemin bloquant (DRH/OPS/
superviseur/matériel en ont besoin avant de rendre)"*. Ce test (`synchronisation bloquante :
maîtrise DRH ne charge que les données pertinentes`, entre autres scénarios) échouerait si ce
chargement était retiré sans remplacement.

**Consommateurs identifiés** (dépendent aujourd'hui de `db.agents` déjà peuplé avant leur
premier rendu, sans état de chargement local propre) :
- DRH Legacy : `renderDRHDashboard` (`app/static/js/modules/drh-dashboard.js`) et les écrans
  `renderDRHSocial`/`renderDRHMiseEnDemeure`/`renderDRHPeriodeEssai`/
  `renderDRHReversementEnAttente`/`renderDRHStats*` (`app/static/js/modules/drh.js`).
- OPS : tableau de bord OPS (plusieurs compteurs — Affectés, Taux d'affectation, Sites sans
  effectif — calculés directement depuis les affectations liées aux employés, voir commentaire
  `LOT DATA-1 §3` déjà présent dans `sgdiSqlSyncTasks`).
- Superviseur : lecture employés filtrée société avant rendu.
- Matériel : `syncMaterielFromPostgres` attend `ensureEmployees()` avant de démarrer.

**Ce qui a été fait cette mission (et suffit pour l'instant) :** le Tableau de bord général
(`renderDashboard`, distinct du dashboard DRH) a été rendu indépendant de `db.agents` — il ne
déclenche plus lui-même ce chargement et reste correct même s'il n'est pas encore arrivé
(agrégat serveur `sidebar-stats` en priorité, repli local uniquement si déjà présent, état
explicite "…" sinon — jamais un 0 trompeur). Commit `b625ab2c82bd8c1665c044ffd1af0336ca00b622`.

**Ce qui reste à faire (non engagé, refusé pour cette V1) :** pour retirer le chargement
bloquant dans `sgdiSqlSyncTasks()` sans régression, **chacun** des quatre consommateurs
ci-dessus doit d'abord être rendu tolérant à une collection employés vide au premier rendu —
un audit + correctif + tests par écran, du même ordre que le travail déjà fait sur le tableau
de bord général. Ordre suggéré pour un chantier futur : DRH (dashboard puis écrans
secondaires) → OPS → Superviseur → Matériel, chacun se terminant par la migration vers une
API paginée/agrégée/lazy déjà existante ou à créer, puis seulement alors suppression de
l'appel bloquant correspondant dans `sgdiSqlSyncTasks()`.

**Non bloquant pour la V1** — le comportement actuel est fonctionnel, juste plus lent au
premier chargement qu'un design entièrement paginé/agrégé.

## ATLAS-LEAVES-DUAL-STORE

**Constat.** Deux systèmes de congés distincts et **non synchronisés** coexistent :

| | Legacy | DRH Next |
|---|---|---|
| Stockage | `SgdiRecord` (collection `"conges"`, JSON brut) — absente de `sql_bridge.SQL_COLLECTIONS` | modèle SQL typé `Leave` (table `leaves`) |
| Écriture | `approuverConge()` (`sgdi-app.js`) mute `db.conges` puis sauvegarde via le mécanisme générique blob | `/drh/leaves/{id}/approve` (RBAC LOT11A) |
| Statuts observés | `"en_attente"`, `"approuve"`, `"refuse"` (et `"instance"` par endroits, cf. `sgdi-app.js:13232`) | `"instance"` (défaut), `"approuve"`, `"refuse"` |
| Lu par | `renderDashboard`, `renderCongesModule`, KPI "Congés"/"Congés en attente" du dashboard général | dashboard DRH (`erp.employees.leave_current`/`sick_leave_current`, via `build_erp_counters`), API DRH Next |

**Aucun pont trouvé.** `_upsert_sgdi_item` (le seul mécanisme de double-écriture existant dans
`app/modules/drh/service.py`) est utilisé uniquement pour `workflowTasks`, `echanges` et
`activityLog` — jamais pour `conges`. Un congé approuvé côté Legacy n'apparaît donc jamais
comme `Leave` approuvé côté typé, et inversement.

**Risque.** Le dashboard DRH (`renderDRHDashboard`, antérieur à cette mission) fait déjà
confiance à `erp.employees.leave_current`/`sick_leave_current` (source typée) au-dessus du
calcul local `db.conges` — un précédent déjà en production, non introduit par cette mission,
mais dont l'exactitude vis-à-vis des congés réellement saisis côté Legacy n'a pas été
vérifiée sur données réelles. Le tableau de bord général (`renderDashboard`, modifié cette
mission) suit délibérément la même préséance pour rester cohérent avec ce précédent, plutôt
que d'introduire une troisième interprétation.

**Décision : ne pas fusionner maintenant.** Nécessite un chantier dédié avec stratégie de
convergence explicite (laquelle des deux sources devient canonique, comment migrer l'historique
de l'autre, comment éviter une fenêtre où les deux divergent silencieusement pendant la
migration) — hors périmètre d'une mission performance.

## Amélioration réellement obtenue

- `renderDashboard()` (tableau de bord général) : KPI "Effectif actif", "Congés",
  "Absence / maladie" servis par l'agrégat serveur déjà existant (`sidebar-stats` →
  `erp.employees`), sans jamais nécessiter `db.agents` peuplé pour s'afficher correctement.
- KPI/alertes indépendants des employés (incidents, congés en attente, stock, présence,
  clients) inchangés — aucune régression fonctionnelle ni visuelle.
- Panneaux non encore migrés (alertes contrat, fin d'essai, répartition par société) restent en
  lecture opportuniste locale (jamais de fetch déclenché par cette fonction), avec état "…"
  honnête plutôt qu'un chiffre fabriqué.

## Limite restante

`GET /api/drh/employees` complet continue de se produire au bootstrap pour les comptes
DRH/OPS/superviseur/matériel — voir `ATLAS-EMPLOYEES-BOOTSTRAP` ci-dessus. Le critère
"0 requête avant navigation réelle" n'est donc pas atteint globalement ; il l'est uniquement
pour le chemin spécifique du tableau de bord général.

## Tests

- `tests_frontend/dashboard-perf.test.js` (6 tests, nouveaux) : agrégat serveur utilisé, état
  honnête sans donnée, repli local correct, isolation société A/B, aucun fetch déclenché par
  `renderDashboard()` elle-même, KPI non-employés inchangés.
- `tests_frontend/sgdi-app.test.js` : scénarios `sgdiSqlSyncTasks` (dont "maîtrise DRH")
  inchangés et toujours verts — confirmant que la dette documentée ici reste couverte par son
  test historique, non contournée.
- `tests_frontend/module-campaign.test.js` : test statique "aucun helper lazy appelé sans
  garde" toujours vert.

## Commit

`b625ab2c82bd8c1665c044ffd1af0336ca00b622` — `harden(dashboard): make general dashboard KPIs
independent of db.agents`.
