# Rapport de validation — rotations centrales ATLAS

**Candidat à la fusion**, sous réserve de la CI verte du SHA publié et du GO DG. Aucune fusion, aucun déploiement, aucune migration de production à ce stade.

## Périmètre

Branche `feat/central-rotations-local`, intégrant `main` à `5182212bc9151954913c53aab8aa85550a00fd31` (PR 74, 75 et 77). Les protections de matricules et l'import Excel des employés apportés par la PR 77 sont conservés : aucun fichier `app/modules/drh` ne diffère de `main`.

Moteur backend commun : 3X8, 24H48, 1/2, 1/3 ; configuration versionnée par site, simulation préalable, publication datée sous verrous, snapshots historiques, intégrations Attendance Core/BEO/DRH/BRQ. NORMAL/CUSTOM restent des extensions non publiables. Voir [architecture](central-rotations-local.md) et [chemins de migration](migration-central-rotations.md).

## Pointeur : « 0 attendu au lieu de 2 »

Cause : le poste de contrôle ne retenait que les affectations en régime `POSTE_CONTINU` du modèle officiel. Sur un site en planning central, les affectations sans régime explicite ou en régime `NORMAL` (cas réel), ou datées du jour de travail d'une nuit qui traverse minuit, donnaient 0 attendu.

Correction : une seule population attendue canonique, `rotations.service.expected_population` (site, groupe de l'occurrence, affectation valide au jour de travail, employé actif), utilisée par la simulation, les points critiques, le Pointeur et la couverture BEO. Chaque vacation porte un identifiant d'occurrence stable (`site:configuration:début`), ainsi que le régime, la version et l'effectif requis. Le chemin historique (`POSTE_CONTINU`) des sites hors planning central est inchangé.

Preuve : sur PostgreSQL réel, publication par le parcours OPS (brouillon, simulation, publication), puis moteur = simulation = Pointeur = API Pointeur = BEO = API BEO = 2, avec le même identifiant d'occurrence (`tests/test_central_rotation_expected_pg.py`).

## Recette des quatre écrans

Recette dans Chrome réel par le vrai routeur de l'application, avec des données synthétiques sur une base jetable, à 1920, 1440, 1280, 1024, 768 et 390 px. Aucun débordement horizontal de page, aucune erreur JavaScript. Les mesures sont dans `validation/central-rotations/chrome-recette.json`, les captures (1440 et 390) à côté.

| Écran | Conformité à la référence |
|---|---|
| OPS — Configuration du régime du site | Quatre indicateurs colorés, paramètres, type de rotation segmenté, groupes A/B/C/D en couleurs avec position dans le cycle, règles contextuelles au régime, aperçu mensuel calculé par le serveur, Enregistrer / Simuler / Publier / Annuler |
| OPS — Planning des rotations | Calendrier mensuel Jour/Nuit par groupe, OFF, week-ends, points critiques, résumé du cycle (légende, cycle, couverture du mois, règles et contrôles), vue détaillée, historique |
| Pointeur — Pointage temps réel | Contexte du poste (site, vacation, groupe, régime et version), indicateurs avec proportions, badges « En poste » / « Maintenu » |
| BEO — Couverture terrain | Filtres groupe/vacation/date, six indicateurs, couverture par site avec statuts Couvert / Attention / Sous-effectif / Non couvert / Critique, points critiques, employés à surveiller |

Écarts acceptés et documentés :
- pas de variation « vs mois précédent » sur les indicateurs, faute d'historique comparable ;
- le week-end affiche le groupe de remplacement plutôt qu'« OFF » (règle métier 1/3 : B/C/D couvrent les week-ends) ;
- Structure et Site du BEO restent dans la barre du portail ;
- le Pointeur garde sa barre supérieure intégrée V7.

## Tests

| Suite | Résultat |
|---|---|
| Backend complet, PostgreSQL compris | 3096 réussis, 127 ignorés, 0 échec |
| Migrations : pré-V7 (état de production) et ancienne V7 appliquée, restauration | 35 réussis |
| Frontend (pretest + suite) | 39 + 1352 réussis |
| Mobile (tests, typecheck, lint) | 41 réussis, typecheck et lint OK |
| `git diff --check` | OK |

Les tests de rotations centrales suppriment désormais les sites synthétiques qu'ils créent : la base SQLite des tests est partagée, et ces sites faussaient le tableau de bord DRH et le volume de `/api/drh/employees` dans les tests suivants.

## Conditions avant mise en production

- CI verte sur le SHA final et GO DG distinct pour la fusion, puis pour la production.
- Le déploiement de `main` livre ensemble les PR 74, 75, 77 et 78 : la recette de production les couvre toutes.
- Sauvegarde réelle, restauration isolée, migration et essai applicatif sur la copie restaurée, plan de retour arrière.
- Déploiement manuel du SHA exact ; Auto Deploy reste désactivé.
- Aucune activation de régime sur un site réel sans calendrier, horaires, effectifs et repos validés par OPS/DRH, ni date de transition explicite par site.
