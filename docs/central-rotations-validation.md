# Rapport de validation — rotations centrales ATLAS

**Candidat à la fusion**, sous réserve de la CI verte du SHA publié et du GO DG. Aucune fusion, aucun déploiement, aucune migration de production à ce stade.

## Périmètre

Branche `feat/central-rotations-local`, intégrant `main` à `5182212bc9151954913c53aab8aa85550a00fd31` (PR 74, 75 et 77). Les protections de matricules et l'import Excel des employés apportés par la PR 77 sont conservés : aucun fichier `app/modules/drh` ne diffère de `main`.

Moteur backend commun : 3X8, 24H48, 1/2, 1/3 ; configuration versionnée par site, simulation préalable, publication datée sous verrous, snapshots historiques, intégrations Attendance Core/BEO/DRH/BRQ. NORMAL/CUSTOM restent des extensions non publiables. Voir [architecture](central-rotations-local.md) et [chemins de migration](migration-central-rotations.md).

## Pointeur : « 0 attendu au lieu de 2 »

Cause : le poste de contrôle ne retenait que les affectations en régime `POSTE_CONTINU` du modèle officiel. Sur un site en planning central, les affectations sans régime explicite ou en régime `NORMAL` (cas réel), ou datées du jour de travail d'une nuit qui traverse minuit, donnaient 0 attendu.

Correction : une seule population attendue canonique, `rotations.service.expected_population` (site, groupe de l'occurrence, affectation valide au jour de travail, employé actif), utilisée par la simulation, les points critiques, le Pointeur et la couverture BEO. Chaque vacation porte un identifiant d'occurrence stable (`site:configuration:début`), ainsi que le régime, la version et l'effectif requis. Le chemin historique (`POSTE_CONTINU`) des sites hors planning central est inchangé.

Preuve : sur PostgreSQL réel, publication par le parcours OPS (brouillon, simulation, publication), puis moteur = simulation = Pointeur = API Pointeur = BEO = API BEO = 2, avec le même identifiant d'occurrence (`tests/test_central_rotation_expected_pg.py`).

## Arbitrage DG du 24/10/2026

- **Week-end et jours fériés (1/3) :** la vacation de jour existe ; A ne travaille jamais la nuit, le week-end ni les jours fériés ; le Jour revient au groupe B, C ou D libre selon le cycle et le repos, sans décaler le cycle de nuit B → C → D. Sans groupe admissible : VACATION NON COUVERTE ; effectif insuffisant : SOUS-EFFECTIF.
- **Rythme :** occurrences quotidiennes Jour / Nuit / repos ; l'aperçu de configuration les montre telles que le moteur les calcule.
- **Horaires :** aucun horaire global. Une nouvelle configuration ne pré-remplit ni horaire, ni début de semaine, ni jours ouvrés ; l'enregistrement est refusé tant qu'ils ne sont pas saisis. Une configuration versionnée existante est reprise. Référence de démonstration des tests et maquettes : Jour A 08:00 → 16:30.
- **Début de semaine :** champ obligatoire (`week_start`), persisté et versionné avec la configuration, validé et utilisé par le moteur (semaine du site sur chaque occurrence), repris dans la simulation (`calendar`), affiché dans le planning (ordre des colonnes, résumé) et dans l'historique. Exemple : ouvrés dimanche → jeudi, week-end vendredi-samedi.
- **Variations « vs mois dernier / vs hier » :** non affichées faute de données comparatives ; aucune valeur fictive.
- **BEO :** sans date ni vacation choisies, la Couverture terrain ouvre sur la vacation en cours, celle du Pointeur (une nuit commencée la veille reste rattachée à la veille).

## Recette des quatre écrans

Recette dans Chrome réel par le vrai routeur de l'application, avec des données synthétiques sur une base jetable, à 1920, 1440, 1280, 1024, 768 et 390 px. Aucun débordement horizontal de page, aucune erreur JavaScript. Les mesures sont dans `validation/central-rotations/chrome-recette.json`, les captures (1440 et 390) à côté.

| Écran | Conformité à la référence |
|---|---|
| OPS — Configuration du régime du site | Quatre indicateurs colorés, paramètres, type de rotation segmenté, groupes A/B/C/D en couleurs avec position dans le cycle, règles contextuelles au régime, aperçu mensuel calculé par le serveur, Enregistrer / Simuler / Publier / Annuler |
| OPS — Planning des rotations | Calendrier mensuel Jour/Nuit par groupe, OFF, week-ends, points critiques, résumé du cycle (légende, cycle, couverture du mois, règles et contrôles), vue détaillée, historique |
| Pointeur — Pointage temps réel | Contexte du poste (site, vacation, groupe, régime et version), indicateurs avec proportions, badges « En poste » / « Maintenu » |
| BEO — Couverture terrain | Filtres groupe/vacation/date, six indicateurs, couverture par site avec statuts Couvert / Attention / Sous-effectif / Non couvert / Critique, points critiques, employés à surveiller |

Les maquettes font foi pour la composition, la hiérarchie, les couleurs et la densité ; les règles métier de l'arbitrage priment (Jour du week-end couvert par B/C/D, occurrences quotidiennes, horaires du site). Autres écarts de présentation : Structure et Site du BEO restent dans la barre du portail ; le Pointeur garde sa barre supérieure intégrée V7.

Cohérence vérifiée sur la recette : pour la vacation en cours de chaque site, même occurrence, même groupe, mêmes attendus et mêmes présents dans OPS, le Pointeur et BEO (`validation/central-rotations/coherence-ops-pointeur-beo.txt`). Capture « nouvelle configuration » : `ops-configuration-nouvelle-*.png`.

## Tests

| Suite | Résultat |
|---|---|
| Backend complet, PostgreSQL compris | 3099 réussis, 127 ignorés, 0 échec |
| Migrations (pré-V7 = état de production, ancienne V7 appliquée, restauration) et parcours PostgreSQL des rotations | 41 réussis |
| Frontend (pretest + suite) | 41 + 1352 réussis |
| Mobile (tests, typecheck, lint) | 41 réussis, typecheck et lint OK |
| Recette Chrome des quatre écrans, six largeurs | 24 mesures, 0 défaut, 0 erreur JavaScript |
| `git diff --check` | OK |

Les tests de rotations centrales suppriment désormais les sites synthétiques qu'ils créent : la base SQLite des tests est partagée, et ces sites faussaient le tableau de bord DRH et le volume de `/api/drh/employees` dans les tests suivants. Le test de publication par l'API ne dépend plus de la date du jour (il échouait certains jours sur une transition historique sans rapport avec son objet).

## Conditions avant mise en production

- CI verte sur le SHA final et GO DG distinct pour la fusion, puis pour la production.
- Le déploiement de `main` livre ensemble les PR 74, 75, 77 et 78 : la recette de production les couvre toutes.
- Sauvegarde réelle, restauration isolée, migration et essai applicatif sur la copie restaurée, plan de retour arrière.
- Déploiement manuel du SHA exact ; Auto Deploy reste désactivé.
- Aucune activation de régime sur un site réel sans calendrier, horaires, effectifs et repos validés par OPS/DRH, ni date de transition explicite par site.
