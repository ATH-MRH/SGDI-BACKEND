# OPS — Photos canoniques des employés

Revue locale du 27 septembre 2026. Base de validation initiale : `026f827`.
Intégration sur `aab220e` (`origin/main`) avant publication : les changements
Attendance/Biométrie déjà présents sont conservés, ainsi que leurs suites de tests.

## Problème et résultat

Le DTO OPS supprimait la référence photo lors de la projection du dossier ATLAS.
La liste EFFECTIFS travaillait aussi sur la collection complète côté navigateur.

Chaque résultat reçoit désormais `has_photo` et une URL protégée liée à son
identifiant SQL. La source canonique est `Employee.extra.photo`, puis la première
clé `photo` dans l'historique `_legacy` (60 niveaux maximum, comme la lecture RH).
Une valeur vide/null plus récente annule une ancienne photo. Aucun identifiant
d'employé de production n'est codé en dur.

La liste utilise une pagination SQL de 25 employés, avec recherche, filtres et
tri avant pagination. Les options de poste sont calculées sur le périmètre entier.
Les images sont demandées à proximité du viewport, avec au plus six chargements
simultanés. Les initiales restent visibles jusqu'au décodage réussi et en cas
d'absence, erreur réseau, interdiction ou corruption.

## Droits, identité et mises à jour

- L'endpoint photo vérifie l'authentification, le module OPS et les mêmes droits
  société/site que la liste. Une affectation future, terminée ou inactive ne donne
  pas accès à la photo. Aucun rôle ni périmètre n'est modifié.
- La photo est rattachée à `employee_id`, jamais au code salarié ou à l'ordre des
  résultats. Les réponses tardives d'une autre page/société/session sont ignorées.
- Le navigateur transmet le jeton dans l'en-tête Authorization, jamais dans l'URL.
  Les blobs sont libérés quand leurs éléments disparaissent ou que le contexte change.
- Les références locales sont confinées au dossier des photos; documents,
  traversées de chemin, liens symboliques sortants et URL distantes sont refusés.
  Les anciennes images base64 restent lisibles à la demande, hors réponse de liste.
- La date de modification versionne l'URL. L'ETag dépend des octets réels et
  l'autorisation est revérifiée avant un éventuel 304. Une photo remplacée au même
  chemin est donc revalidée. Suppression et remplacement sont testés.
- Les photos legacy DRH restent compatibles. Les champs RH privés ne sont pas
  ajoutés au DTO OPS. Aucune migration ni modification des dossiers n'est nécessaire.

## Validation automatique

Tests permanents ajoutés dans `tests/test_ops_employee_photos.py`,
`tests_frontend/ops-employee-photos.test.js` et `tests_frontend/ops.test.js`.

- Population API : 600 employés, 3 sociétés, 6 sites, 24 pages, 400 photos distinctes
  et 200 absences. Chaque résultat est contrôlé; les octets de chacune des 400 images
  sont comparés à l'identifiant attendu.
- Recherche, filtres société/site/statut/poste, tris, pages suivantes, droits,
  affectations historiques, corruption et remplacement sont couverts.
- Frontend : 2 000 avatars contrôlés par identifiant; aucune requête hors viewport;
  concurrence bornée à six; nouveaux employés, suppression/remplacement de photo,
  changement de société/session et réponses en retard couverts.
- 121 tests backend ciblés réussis (photos OPS, OPS, droits temps réel, accès module,
  fermeture des scopes, pointage RH/OPS et règles de périmètre).
- Suite backend complète : 906 réussis, 18 ignorés, en 83,22 secondes.
- 117 tests frontend ciblés réussis (OPS/photos, DRH, chargement DRH, badges).
- Après versionnement des assets : 58 tests OPS/photos, registre de modules et
  bootstrap/fichiers partagés réussis.
- Suite frontend complète sur la base initiale : 545 réussis sur 546. Seul échec : test intermittent
  préexistant `alerts-menu.test.js`, callback exécuté après fermeture de sa fenêtre
  JSDOM (`_location`/`querySelectorAll`). Ce comportement avait aussi été reproduit
  sur la base précédente; il n'est pas modifié dans ce correctif.

Commandes ciblées :

```sh
python3 -m pytest -q -s --tb=short tests/test_ops_employee_photos.py tests/test_ops.py tests/test_ops_realtime_permissions.py tests/test_lot_04_module_access.py tests/test_lot_03_scope_closure.py tests/test_rh_ops_pointage.py tests/test_scope_rules.py
node --test tests_frontend/ops.test.js tests_frontend/ops-employee-photos.test.js tests_frontend/drh.test.js tests_frontend/drh-performance-loading.test.js tests_frontend/effectifs-status-badge.test.js
npm test
```

### Validation après intégration sur main

Les changements de `aab220e` sont conservés. Le seul conflit, dans `package.json`,
est résolu en conservant toutes les suites de main et en ajoutant les tests photos OPS.

- Backend : 972 réussis, 26 ignorés; deux tests caméra n'ont initialement pas pu
  ouvrir leur serveur local à cause de la sandbox. Leur fichier a été rejoué avec
  l'autorisation d'écoute locale : 2 réussis, 3 ignorés (moteurs réels optionnels).
  Les 974 tests exécutables sont donc validés; aucune erreur applicative restante.
- Frontend : 562/562 réussis, en 73,16 secondes. Le test Alertes est désormais
  corrigé par le commit `995ffdb` déjà présent sur main.
- Aucun changement du schéma, des données ou des permissions ajouté par ce hotfix.

## Mesures

Mesures locales, pas un engagement de latence en production. Les tests inspectent
les colonnes SQL effectivement retournées : pas de `extra` complet, pas de documents,
pas d'octets photo dans la liste; la projection photo renvoie seulement un indicateur.
Les lectures d'employés utilisent LIMIT/OFFSET. La résolution des références se fait
en une requête groupée pour les identifiants de la page, sans N+1 de liste.
Chaque image visible est ensuite un chargement authentifié indépendant.

| Base / population | Taille page | Requêtes liste | Réponse JSON | Temps local | Pic mémoire Python |
| --- | ---: | ---: | ---: | ---: | ---: |
| SQLite / 620 | 5 | 5 | 2 903 o | 31,1 ms | 464 057 o |
| SQLite / 620 | 100 | 5 | 57 382 o | 67,4 ms | 882 966 o |
| SQLite / 3 620 | 5 | 5 | 2 904 o | 39,3 ms | 464 948 o |
| SQLite / 3 620 | 100 | 5 | 57 384 o | 58,4 ms | 880 064 o |
| PostgreSQL 16.13 / 2 000 | 5 | 5 | 2 134 o | 20,6 ms | non mesuré |
| PostgreSQL 16.13 / 2 000 | 25 | 5 | 10 479 o | 13,2 ms | non mesuré |
| PostgreSQL 16.13 / 2 000 | 100 | 5 | 41 947 o | 16,5 ms | non mesuré |

Le test SQLite ajoute 3 000 dossiers comprenant chacun 64 Kio de documents privés.
Le test PostgreSQL utilise une instance temporaire isolée, avec 16 Kio privés par
employé, photos au premier niveau et dans `_legacy`. Présence, ordre numérique des
codes et correspondance des octets/identifiants sont vérifiés automatiquement.
Les jeux de données et sérialisations diffèrent entre les deux mesures.

## Vérification dans Chrome

Application réelle locale, avec 90 employés synthétiques sur deux sociétés/quatre
sites : photos décodées, initiales sans photo, fichier corrompu, chargement différé,
page suivante, recherche d'un salarié hors première page, filtre site et tri vérifiés.
Le dernier parcours manuel « Changer société » a été interrompu par un blocage du
dialogue de l'extension Chrome; ce cas reste validé par les tests API/frontend.
Des erreurs préexistantes du portail local (rendu dashboard asynchrone et collection
`demandesPersonnel` interdite au compte OPS) ont été observées; aucune erreur du
chargeur de photos n'a été observée lors des parcours EFFECTIFS.

Les 164 dossiers de production n'ont pas été modifiés ni validés individuellement
en ligne. Cette validation locale ne constitue pas une validation après déploiement.

## Livraison et limites de périmètre

Le cache du registre et des modules est versionné
`20260927-ops-canonical-photos`, pour éviter de réutiliser les anciens modules
marqués `immutable` après publication.

EFFECTIFS n'effectue plus de chargement complet de la collection. L'ancienne route
non paginée reste disponible pour les autres écrans existants, avec une projection
légère; leurs préchargements globaux ne sont pas refondus ici. Les champs RH privés
déjà absents du DTO (date de naissance, situation familiale, métadonnées PV) restent
absents. Les filtres correspondants conservent leur comportement de données vides.

La branche du correctif est isolée des travaux locaux DRH enfants et des autres
modifications en cours. Le déploiement doit prendre uniquement ce correctif OPS.
