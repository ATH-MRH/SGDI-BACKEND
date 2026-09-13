# DRH — mesures backend avant corrections

Jeu synthétique de 1 000 employés, SQLite local, cinq échantillons par endpoint et état de cache. La médiane « total » inclut le client ASGI local ; aucune latence Internet. Les caches applicatifs sont vidés avant chaque mesure froide ; les caches SQLite/OS restent chauds. Les colonnes SQL et ORM sont des coûts distincts ; la matérialisation inclut lecture du curseur, décodage JSON et création des objets.

| Endpoint (cache froid) | Total ms | SQL ms | Requêtes SQL | Lignes ORM | Matérialisation ms | Sérialisation ms¹ | JSON brut | Gzip calculé |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/api/irongs/db?light=true` | 55.40 | 2.63 | 4 | 7500 | 38.58 | 1.48 | 934,436 | 52,295 |
| `/api/irongs/db` | 448.66 | 46.48 | 27 | 22154 | 1574.09 | 9.15 | 6,415,296 | 250,909 |
| `/api/ui/sidebar-stats` | 96.93 | 21.52 | 51 | 9202 | 44.52 | 0.14 | 2,487 | 880 |
| `/api/ui/sidebar-stats?society=PERF%20ALPHA` | 210.33 | 15.58 | 54 | 17551 | 133.99 | 0.13 | 2,460 | 900 |
| `/api/drh/employees` | 43.18 | 1.95 | 4 | 3000 | 21.18 | 2.17 | 1,805,093 | 73,749 |
| `/api/drh/employees/page?mode=all&page_size=25` | 3.62 | 0.45 | 4 | 50 | 0.39 | 0.41 | 40,871 | 2,263 |
| `/api/drh/employees/page?mode=all&page_size=25&q=Agent` | 28.36 | 0.22 | 3 | 1025 | 20.99 | 0.48 | 40,871 | 2,263 |
| `/api/drh/candidates/page?mode=recrutement&page_size=25` | 6.11 | 0.08 | 2 | 500 | 2.82 | 0.29 | 26,640 | 898 |
| `/api/drh/candidates` | 7.93 | 0.04 | 2 | 500 | 2.71 | 3.10 | 528,193 | 9,202 |
| `/api/drh/contracts` | 9.87 | 0.07 | 2 | 1000 | 3.47 | 4.34 | 289,787 | 10,700 |
| `/api/drh/generated-contracts` | 14.05 | 0.09 | 2 | 1000 | 5.81 | 5.14 | 402,680 | 18,825 |
| `/api/drh/leaves` | 2.22 | 0.05 | 2 | 100 | 0.28 | 0.35 | 19,282 | 1,199 |
| `/api/drh/dashboard` | 26.39 | 1.08 | 5 | 2500 | 18.18 | 0.03 | 247 | 172 |
| `/api/version` | 3.09 | 0.00 | 0 | 0 | 0.00 | 0.02 | 26 | 46 |
| `/api/auth/users` | 1.58 | 0.03 | 2 | 1 | 0.02 | 0.10 | 424 | 248 |
| `/api/auth/access-rules` | 1.44 | 0.03 | 2 | 0 | 0.00 | 0.08 | 2 | 22 |
| `/api/irongs/events/ticket` | 0.96 | 0.01 | 1 | 0 | 0.00 | 0.01 | 156 | 164 |
| `/api/irongs/positions` | 1.64 | 0.03 | 3 | 4 | 0.03 | 0.08 | 101 | 93 |

¹ Somme des spans de sérialisation instrumentés (orjson, réponse FastAPI et JSONResponse), hors certaines validations manuelles et allocations. Les médianes de composants ne recomposent pas nécessairement la médiane du total. Le snapshot complet exécute les collections SQL en parallèle : les temps cumulés ORM peuvent dépasser le temps total.

Les 13 endpoints DRH/snapshot/sidebar et les tailles 100/1 000 sont conservés dans `../drh-performance-backend-baseline.json`. Le complément des cinq endpoints auxiliaires réellement vus à l’ouverture est dans `backend-support-before.json`; il a été mesuré après le commit frontend de traduction, avant toute modification backend. Le code backend était donc toujours celui de `7041c27`.

## Conclusions mesurées

- Pas de N+1 par employé détecté : quatre requêtes pour `/employees` à 100 comme à 1 000 employés ; deux pour candidats et contrats générés. Les lectures sidebar multiplient les collections, avec 51 requêtes globales et 54 pour une société.
- L’ouverture réelle attend le snapshot léger de 934 436 octets (52 295 octets gzip calculé), pas le snapshot complet de 6,42 Mo. Les 448,7 ms du snapshot complet ne sont pas attribués au chemin initial.
- Le snapshot léger matérialise 7 500 lignes legacy avant de jeter les collections SQL et serveur. Le probe A/B préalable conserve un contenu identique (digest SHA-256) avec 6 000 lignes : médiane lecture + filtrage de 74,85 à 32,89 ms, soit environ 42 ms évitables. Le JSON lu baisse de 2,21 Mo à 0,93 Mo ; le payload HTTP reste inchangé.
- Une page de 25 employés pèse 40 871 octets contre 1 805 093 pour la liste complète. L’équivalence métier de la pagination existante est insuffisante : voir `../drh-performance-inventory.md`.
- La mémorisation des lectures legacy au sein d’un calcul sidebar a un gain sur le périmètre société (188,38 → 97,62 ms dans le probe), mais pas sur le cas global réellement ouvert (72,39 → 77,46 ms). Cette optimisation est reportée hors des trois corrections retenues.

## Limites

La fixture v2 ajoute uniquement dans SQLite une table synthétique `prospects` vide afin de mesurer la signature événementielle par UNION attendue par le code. Son existence en production n’est pas établie. La fixture ORM seule v1 prend un repli par table, documenté dans le JSON. Aucun index, schéma ou système de production n’a été modifié. Les GET du benchmark peuvent écrire leur audit dans la seule base jetable.
