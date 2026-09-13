# DRH performance — inventaire préalable

## Base et isolation

- Base demandée et HEAD initial : `7041c27f477b5e24d8bb5509ca8d6bbf45c8edab`.
- Branche : `perf/drh-loading`.
- Worktree : `/private/tmp/ATLAS-drh-performance`, initialement propre.
- `origin/main` local et distant vérifiés en lecture seule : `bf9954e1922ae7c961dcc2e789a1a67ea2002abb`, 60 commits après la base demandée. Aucun déplacement de `main`, aucun rebase.
- Le répertoire utilisateur `ATLAS 1` contient des modifications préexistantes et reste intact.
- Mesures sur SQLite synthétique jetable ; aucune connexion à une base de production. Les performances SQLite/loopback ne représentent pas PostgreSQL/réseau de production.
- Certains GET legacy exécutent un audit avec commit et peuvent appeler une maintenance de schéma. Ils ne sont donc pas exécutés sur une base existante.

## Référence fonctionnelle avant correction

- Frontend complet : 230 tests réussis, 0 échec.
- Backend complet : 550 tests réussis, 14 ignorés, 0 échec.
- Journaux initiaux : `/private/tmp/drh-frontend-baseline.log` et `/private/tmp/drh-backend-baseline.log`.

## Chaîne de chargement à mesurer

1. `bootApp` / connexion appelle `sgdiPullState` avec `deferSql:true`.
2. `/api/irongs/db?light=1` fournit le snapshot legacy ; les collections SQL sont vides dans cette réponse.
3. Hydratation, autorisations, positions, compteurs et synchronisation SQL différée.
4. En contexte DRH, `sgdiSqlSyncTasks` charge les employés complets et les candidats complets.
5. `renderView` attend `sgdiFullDataReady` avant même le téléchargement du module de route.
6. `drh` télécharge aussi `drh-dashboard` et `leaves` comme dépendances.
7. Le tableau de bord appelle ses statistiques et `sgdiEnsureEmployeesForDisplay({force:true})`. Les statistiques sidebar appellent aussi `sgdiEnsureEmployeesForDisplay`.

Les durées et le classement des goulots figurent dans les résultats de mesure ; cet inventaire statique ne démontre pas leur impact relatif.

## Équivalence de la pagination : obstacles démontrés

Une suppression du garde `isDrhModuleContext()` dans `renderEffectif` ne suffit pas et serait régressive.

| Sujet | Liste DRH actuelle | Pagination existante |
|---|---|---|
| Statut | Fusion colonnes, `extra`, `_legacy`, résolution du statut/sortie | Filtrage initial sur statut SQL |
| Absences | Statut absent ou événement Absence actif | Statut SQL absent uniquement |
| Blacklist | Booléen métier `blacklist` | Statut SQL blacklist |
| Société | Société de l'agent après transformation | Société canonique ou affectation active à un site de la société |
| Recherche | Texte de toute la ligne affichée | Aucun `q` transmis par le rendu paginé ; filtrage DOM limité à la page |
| Tri | Valeurs affichées, collation française, choix de colonnes | Ordre nom/prénom/id fixe ; handlers frontend encore locaux |
| Suspension | Compteurs sur toute la population filtrée | Compteurs calculés seulement sur les éléments de la page |

Le référentiel `db.agents` complet alimente aussi les recherches des actions RH, les fiches par ID (sans rechargement individuel automatique), les listes des formulaires, le tableau de bord et ses séries mensuelles, les congés, les contrôles NIN, les matricules et les contrats. Le remplacer par une page ou une projection partielle modifierait ces comportements et pourrait provoquer des sauvegardes incomplètes.

Références : `app/static/js/modules/employees.js`, `app/static/js/modules/drh-dashboard.js`, `sgdiPullEmployees`, `renderAgentForm`, `rhEffectifActionTargets` dans `app/static/sgdi-app.js`, `list_employees_page` dans `app/modules/drh/service.py`.

Toute pagination réelle devra démontrer l'équivalence des filtres, tris, agrégats, fiches et actions. Aucun changement de ces règles n'est autorisé dans ce lot de performance.
