# DRH — comparaison backend avant/après

Le snapshot léger à 1 000 employés passe de **55.40 à 46.65 ms** en médiane froide (**15.80 % de moins**). Il charge **7 500 → 6 000 lignes ORM**, avec une réponse toujours longue de **934 436 octets bruts / 52 295 octets gzip calculé**. Le gain démontré le plus stable est la suppression des 1 500 lignes inutiles ; il ne s’agit pas d’une réduction du contenu transmis.

À 100 employés, le même chemin passe de 7.25 à 7.18 ms, avec 750 → 600 lignes : la différence de durée est faible.

La campagne à 1 000 employés présente aussi une dérive importante des durées sur des endpoints backend **inchangés** : `/api/drh/employees` mesure 43.18 → 96.55 ms. Le snapshot complet mesure 448.66 → 614.69 ms malgré moins de lignes lues. Ces hausses sont conservées dans le rapport ; les campagnes non intercalées ne permettent pas d’en déterminer la cause. Aucun gain général de latence backend n’est affirmé.

## Protocole et provenance

- Après : `a8aa982d8d6c89ddcfff62df315cf6e31244d9f5` ; avant principal : `7041c27f477b5e24d8bb5509ca8d6bbf45c8edab`. Le complément auxiliaire avant est au commit frontend `3b16a2a`, avec le même code backend initial.
- Exécution séquentielle : 100 employés, 1 000 employés, puis les cinq endpoints auxiliaires à 1 000 employés ; cinq requêtes froides et cinq chaudes pour chaque endpoint. Aucune campagne navigateur ni suite de tests n’était demandée en parallèle.
- Les trois bases SQLite existantes ont été réutilisées, sans reseeding. Métadonnées de fixtures vérifiées identiques ; anciens rapports sauvegardés sous `backend-profile-before-correction3.json` dans leurs dossiers d’origine. Tous les cas après retournent HTTP 200, avec cinq échantillons.
- Froid = caches snapshot/sidebar/signature vidés ; cache SQLite/OS conservé. Chaud = une requête préalable. Le tout premier appel froid inclut une inspection de schéma propre au processus ; aucun changement de schéma produit ni migration n’a été exécuté.
- ASGI local, lifespan désactivé, données fictives et table `prospects` synthétique vide pour le chemin nominal UNION. Aucune base de production consultée.
- Les tailles gzip sont recalculées hors chronométrage avec le niveau 9. Les tailles brutes restent identiques pour tous les cas mesurés. Le snapshot complet peut changer l’ordre des clés selon la fin des requêtes parallèles, donc sa taille gzip peut varier sans changement métier.

Les cinq valeurs brutes, SQL représentatifs, compteurs, temps ORM et spans de sérialisation sont conservés dans [backend-after.json](backend-after.json). Références avant : [baseline principale](../drh-performance-backend-baseline.json), [auxiliaires](backend-support-before.json). L’égalité du contenu du snapshot est couverte par [les tests de non-régression](../../tests/test_drh_snapshot_performance.py) ; l’égalité des tailles seule ne la prouverait pas.

## 1 000 employés — médianes de chaque endpoint

Les écarts sont « après − avant » ; un pourcentage positif indique une durée mesurée plus élevée. La colonne SQL compte les requêtes, pas leur durée.

| Endpoint | Froid avant ms | Froid après ms | Écart | Chaud avant ms | Chaud après ms | SQL froid avant → après | Lignes ORM avant → après |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/api/irongs/db?light=true` | 55.40 | 46.65 | -15.8% | 3.02 | 2.36 | 4 → 4 | 7 500 → 6 000 |
| `/api/irongs/db` | 448.66 | 614.69 | +37.0% | 3.44 | 6.07 | 27 → 27 | 22 154 → 20 654 |
| `/api/ui/sidebar-stats` | 96.93 | 175.26 | +80.8% | 1.53 | 2.47 | 51 → 51 | 9 202 → 9 202 |
| `/api/ui/sidebar-stats?society=PERF%20ALPHA` | 210.33 | 356.17 | +69.3% | 1.65 | 3.28 | 54 → 54 | 17 551 → 17 551 |
| `/api/drh/employees` | 43.18 | 96.55 | +123.6% | 41.12 | 96.23 | 4 → 4 | 3 000 → 3 000 |
| `/api/drh/employees/page?mode=all&page_size=25` | 3.62 | 9.71 | +168.4% | 2.90 | 7.19 | 4 → 4 | 50 → 50 |
| `/api/drh/employees/page?mode=all&page_size=25&q=Agent` | 28.36 | 34.75 | +22.5% | 13.77 | 36.82 | 3 → 3 | 1 025 → 1 025 |
| `/api/drh/candidates/page?mode=recrutement&page_size=25` | 6.11 | 13.81 | +126.2% | 5.42 | 15.62 | 2 → 2 | 500 → 500 |
| `/api/drh/candidates` | 7.93 | 13.66 | +72.2% | 8.02 | 14.00 | 2 → 2 | 500 → 500 |
| `/api/drh/contracts` | 9.87 | 15.49 | +56.9% | 9.68 | 14.17 | 2 → 2 | 1 000 → 1 000 |
| `/api/drh/generated-contracts` | 14.05 | 20.30 | +44.5% | 13.30 | 26.33 | 2 → 2 | 1 000 → 1 000 |
| `/api/drh/leaves` | 2.22 | 4.92 | +122.0% | 2.08 | 5.19 | 2 → 2 | 100 → 100 |
| `/api/drh/dashboard` | 26.39 | 48.08 | +82.2% | 25.55 | 46.75 | 5 → 5 | 2 500 → 2 500 |

## Décomposition du snapshot et volumes à 1 000 employés

| Chemin froid | Curseur SQL avant → après ms | Fetch/JSON/ORM avant → après ms | orjson avant → après ms | Octets bruts avant → après | Gzip avant → après |
|---|---:|---:|---:|---:|---:|
| `/api/irongs/db?light=true` | 2.63 → 3.06 | 38.58 → 30.27 | 1.48 → 1.68 | 934 436 → 934 436 | 52 295 → 52 295 |
| `/api/irongs/db` | 46.48 → 70.04 | 1574.09 → 2013.06 | 9.15 → 13.60 | 6 415 296 → 6 415 296 | 250 909 → 250 916 |

Les temps curseur excluent fetch et décodage ; le temps ORM les inclut. Les durées ORM et SQL des collections du snapshot complet s’additionnent entre threads et peuvent dépasser la durée HTTP. Les médianes des composants ne se recomposent pas en médiane totale. La sérialisation instrumentée n’inclut pas toutes les validations manuelles ni allocations.

Échantillons après du snapshot léger à 1 000 employés (ms) : 118.48, 136.48, 46.65, 45.87, 44.48.
Échantillons après du snapshot complet (ms) : 400.62, 475.41, 614.69, 739.17, 749.97.

## 100 employés — contrôle de volume

| Endpoint | Froid avant → après ms | Chaud avant → après ms | Lignes ORM avant → après |
|---|---:|---:|---:|
| `/api/irongs/db?light=true` | 7.25 → 7.18 | 1.89 → 2.27 | 750 → 600 |
| `/api/irongs/db` | 43.49 → 41.77 | 2.39 → 3.88 | 2 219 → 2 069 |
| `/api/ui/sidebar-stats` | 14.62 → 16.98 | 1.50 → 1.63 | 935 → 935 |
| `/api/ui/sidebar-stats?society=PERF%20ALPHA` | 22.75 → 28.34 | 2.14 → 1.91 | 1 950 → 1 950 |
| `/api/drh/employees` | 6.91 → 6.05 | 6.86 → 6.29 | 300 → 300 |
| `/api/drh/employees/page?mode=all&page_size=25` | 3.63 → 3.04 | 3.22 → 3.30 | 50 → 50 |
| `/api/drh/employees/page?mode=all&page_size=25&q=Agent` | 4.42 → 4.49 | 4.58 → 4.17 | 125 → 125 |
| `/api/drh/candidates/page?mode=recrutement&page_size=25` | 2.72 → 2.33 | 2.50 → 2.10 | 50 → 50 |
| `/api/drh/candidates` | 2.47 → 2.15 | 2.41 → 2.47 | 50 → 50 |
| `/api/drh/contracts` | 2.50 → 2.35 | 2.57 → 2.41 | 100 → 100 |
| `/api/drh/generated-contracts` | 3.38 → 2.81 | 3.05 → 2.76 | 100 → 100 |
| `/api/drh/leaves` | 1.76 → 1.93 | 1.74 → 1.79 | 10 → 10 |
| `/api/drh/dashboard` | 4.63 → 4.35 | 4.03 → 3.89 | 250 → 250 |

## Endpoints auxiliaires de l’ouverture

| Endpoint | Froid avant → après ms | Chaud avant → après ms | SQL avant → après | Octets bruts après |
|---|---:|---:|---:|---:|
| `/api/version` | 3.09 → 2.96 | 2.82 → 2.80 | 0 → 0 | 26 |
| `/api/auth/users` | 1.58 → 1.69 | 1.42 → 1.47 | 2 → 2 | 424 |
| `/api/auth/access-rules` | 1.44 → 1.68 | 1.43 → 1.55 | 2 → 2 | 2 |
| `/api/irongs/events/ticket` | 0.96 → 1.16 | 0.92 → 1.09 | 1 → 1 | 156 |
| `/api/irongs/positions` | 1.64 → 1.63 | 1.53 → 1.57 | 3 → 3 | 101 |

## SQL, N+1 et portée des conclusions

- Les nombres de requêtes SQL restent identiques avant/après pour tous les cas. La correction SQL réduit les lignes chargées, pas les allers-retours : le snapshot léger conserve quatre requêtes à froid ; le complet en conserve vingt-sept.
- Aucun N+1 par employé n’a été détecté sur ces cas : `/employees` conserve quatre requêtes à 100 comme à 1 000 employés ; candidats et contrats générés en conservent deux. Cette observation ne constitue pas un audit exhaustif des routes ou de la production.
- La sidebar multiplie les lectures par collection (51 SQL globales / 54 pour une société) et conserve ses chargements répétés. La mémorisation intrarequête étudiée dans le probe précédent n’a pas été livrée dans les trois corrections retenues.
- La comparaison backend ne mesure pas le nombre de requêtes évitées dans le navigateur par la déduplication frontend, ni le rendu ou les traductions. Ces effets sont évalués séparément dans la campagne navigateur ; les durées unitaires API ne doivent pas être présentées comme les gains d’ouverture UI.
- Les résultats portent sur SQLite et sur une instrumentation qui ajoute du coût. Pas de plan PostgreSQL, de mesures réseau, de CPU production ni d’extrapolation de capacité. Le snapshot complet n’est pas le chemin initial léger constaté à l’ouverture DRH.
