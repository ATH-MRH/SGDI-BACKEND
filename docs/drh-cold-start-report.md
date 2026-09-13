# DRH — validation du cold start

**La régression 1,23 → 2,41 s n’est pas reproduite. Les trois corrections sont conservées.** Sur cinq parcours par état, la branche atteint **1,097 s à froid**, **1,033 s sur Employés** et **3,271 Mo de payload API**. Ces trois médianes respectent les cibles demandées. Aucun nouveau changement applicatif n’a été introduit pour corriger une cause non démontrée.

## État et protocole

- Branche `perf/drh-loading`, HEAD initial `e532aca`, worktree propre au début de ce lot. Produit final déjà à `a8aa982`.
- Vingt parcours réels : cinq pour chacun des états `7041c27` (base), `3b16a2a` (correction 1), `a35aebc` (correction 2) et `a8aa982` (correction 3). Les commits de documentation intermédiaires ne changent pas le produit.
- Archives Git isolées dans `/private/tmp/drh-cold-recheck/{base,c1,c2,c3}` ; aucune modification produit avant ou après les mesures. Les trois fichiers du harnais ont été copiés à l’identique dans chaque archive.
- Même fichier SQLite synthétique : `/private/tmp/atlas-drh-bench-v2-reset-server/synthetic.sqlite`, fixture v2, 1 000 employés, 500 candidats. Aucune donnée de production.
- Même Chrome 152, même onglet, route initiale `#/drh/dashboard`, puis `effectif/actifs`, puis retour DRH. Taille de fenêtre inchangée. Pas de suite de tests ni d’autre campagne de mesures en parallèle.
- Même observateur SHA-256 `efc806ea2a214e179a7b68eef03dbd4894b900eacc33643d0a6c869047252497`. Caches snapshot/sidebar/signature remis à zéro avant chaque ouverture ; stockage navigateur de benchmark effacé ; réponses proxy `no-store`. Caches OS/SQLite conservés, comme dans le protocole initial.
- Ordre des cinq séries : `base,c3,c1,c2` ; `c3,c2,base,c1` ; `c1,base,c2,c3` ; `c2,c1,c3,base` ; `base,c2,c3,c1`. L’alternance limite le biais temporel de deux campagnes séparées, sans éliminer toute variation de la machine.
- Les 20 parcours sont complets, sans erreur, avec toutes les API en HTTP 200. Chaque phase conserve 1 000 employés / 500 candidats ; Employés conserve 572 lignes / 9 797 éléments. Aucun parcours terminé n’est exclu.

Les [20 traces compressées et la synthèse](drh-performance/cold-recheck/summary.json) sont archivées. La médiane est le p50 ; les publier séparément ferait doublon.

## Mesures répétées et bissection

| État produit | Cold p50, ms | Cold min–max | Employés p50, ms | Employés min–max | Payload API, octets | Requêtes |
|---|---:|---:|---:|---:|---:|---:|
| Base `7041c27` | 1 168,9 | 995,2–2 311,8 | 1 814,8 | 1 689,7–1 875,0 | 5 081 011 | 13 |
| Correction 1 `3b16a2a` | 1 182,6 | 1 041,4–1 312,7 | 1 077,0 | 970,5–1 210,9 | 5 081 011 | 13 |
| Correction 2 `a35aebc` | 1 202,8 | 1 024,7–1 259,2 | 1 042,9 | 925,3–1 139,0 | 3 270 944 | 10 |
| Correction 3 `a8aa982` | **1 096,9** | **1 031,1–1 267,0** | **1 032,9** | **961,7–1 326,3** | **3 270 944** | **10** |

| Série | Base cold | C1 cold | C2 cold | C3 cold |
|---|---:|---:|---:|---:|
| 1 | 2 311,8 | 1 312,7 | 1 259,2 | 1 267,0 |
| 2 | 995,2 | 1 164,1 | 1 216,0 | 1 218,4 |
| 3 | 1 023,7 | 1 311,8 | 1 024,7 | 1 096,9 |
| 4 | 1 168,9 | 1 182,6 | 1 115,5 | 1 088,2 |
| 5 | 1 299,5 | 1 041,4 | 1 202,8 | 1 031,1 |

Comparaison avec la campagne historique :

| Campagne | Base cold p50 | Branche cold p50 | Nombre par état |
|---|---:|---:|---:|
| Historique, campagnes séparées | 1 234,2 ms | 2 411,8 ms | 3 |
| Reproduction alternée, produit inchangé | 1 168,9 ms | 1 096,9 ms | 5 |

Il n’existe pas ici de nouveau « code après correction » : la branche avant ce lot et la branche finale sont applicativement identiques. La correction retenue porte sur la validation de la mesure : répéter, alterner les états et conserver les extrêmes. Il serait incorrect d’attribuer le nouveau résultat à un patch inexistant.

## Où se trouvaient les 1 178 ms supplémentaires ?

La comparaison ci-dessous utilise **deux passages réels**, ceux correspondant exactement aux anciennes médianes : `browser-before-3.json` et `browser-after-2.json`. Les intervalles sont contigus et non superposés ; leur somme restitue le temps froid.

| Segment du chemin critique | Ancienne base | Ancienne branche | Surcoût |
|---|---:|---:|---:|
| Navigation → départ du snapshot | 199,3 ms | 290,1 ms | +90,8 ms |
| Départ → réception du snapshot léger | 258,7 ms | 940,5 ms | **+681,8 ms** |
| Snapshot reçu → début sync SQL | 104,0 ms | 181,0 ms | +77,0 ms |
| Sync SQL (API/transformation/attente incluses) | 304,4 ms | 415,4 ms | +111,0 ms |
| Fin sync SQL → premier affichage | 367,8 ms | 584,8 ms | +217,0 ms |
| **Total** | **1 234,2 ms** | **2 411,8 ms** | **+1 177,6 ms** |

Le snapshot explique donc **57,9 %** du surcoût observé. Dans le même ancien passage, ticket et version durent environ 823 ms, contre 193 ms dans le passage de base, alors que ces routes ne sont pas modifiées par les corrections. Le premier ancien passage de la **base** montrait déjà un snapshot de 867 ms et une ouverture de 1 977 ms.

L’observation exacte est une attente accrue des premières réponses, accompagnée de délais de démarrage et de rendu. **La cause physique de ces délais historiques (charge CPU, ordonnanceur, proxy ou serveur) n’est pas identifiable rétrospectivement à partir de ces traces.** Le chronométrage navigateur ne sépare pas l’attente réseau/serveur de la disponibilité du thread JS ; il ne permet pas de nommer honnêtement une cause plus précise. La nouvelle campagne ne permet donc pas de désigner un commit responsable du +1,18 s.

[Timeline graphique](drh-performance/cold-recheck/timeline.svg) · [Intervalles détaillés](drh-performance/cold-recheck/timeline.md).

### Décomposition complémentaire

Ces valeurs sont imbriquées dans les segments ci-dessus : ne pas les additionner au total.

| Mesure | Ancienne base médiane réelle | Ancienne branche médiane réelle |
|---|---:|---:|
| Réception HTML | 92,0 ms après navigation | 139,5 ms |
| Début téléchargement DRH | 990,8 ms | 1 963,8 ms |
| Téléchargements DRH/dashboard/congés cumulés | 35,8 ms | 22,1 ms |
| Init des modules | <0,1 ms | 0,1 ms |
| Parsing JSON, phase froide | 15,6 ms | 10,2 ms |
| `hydrateDB` | 4,4 ms | 8,0 ms |
| Copie de référence `sgdiCaptureBaseline` | 4,9 ms | 2,5 ms |
| Premier `renderDRHDashboard` | 38,3 ms | 55,9 ms |
| Écritures DOM, phase froide | 16,2 ms | 1,8 ms |
| Évaluation scripts instrumentée | 6,0 ms | 127,7 ms |
| Images / documents | 0 / 0 | 0 / 0 |

Les timings de chaque autre API, des transformations JS et des écritures DOM figurent dans la timeline et les traces. La forte hausse de l’évaluation des scripts est également conservée : elle n’est pas expliquée par le téléchargement des sous-modules, qui diminue. L’ouverture dépend toujours du même snapshot léger et de la synchronisation SQL ; ce lot ne supprime pas ce portillon métier.

## Analyse des corrections : conserver / corriger / retirer

| Correction | Gain observé versus état précédent | Coût observé et analyse | Décision |
|---|---|---|---|
| C1 : traduction par parcours, boutons inchangés | Employés 1 814,8 → 1 077,0 ms ; 574 → 2 écritures HTML | Cold +13,7 ms entre médianes, sans saut de 1,18 s. Aucun nouveau fetch ou await. Le cache de textes disparaît après chaque parcours. | **CONSERVER** |
| C2 : déduplication employés/sidebar | Payload −35,6 %, requêtes 13 → 10 ; Employés 1 077,0 → 1 042,9 ms | Cold +20,2 ms entre médianes, dans la dispersion. Attente d’une lecture courante seulement si invalidation ; aucun retry dans les cinq parcours nominaux, une seule requête employés. | **CONSERVER** |
| C3 : exclusion SQL du snapshot | Cold 1 202,8 → 1 096,9 ms ; moins de lignes ORM | Aucun fetch ajouté, même payload, même chemin de chargement. Les fluctuations ne permettent pas d’attribuer tout ce gain de durée à ce seul prédicat. | **CONSERVER** |

Contrôles du chemin critique :

- Employés et candidats démarrent toujours en parallèle, à quelques dixièmes de milliseconde d’écart dans les traces ; aucune sérialisation de ces API n’est introduite.
- La sidebar reste lancée sans être attendue par le bootstrap. Elle peut concurrencer les autres requêtes et déclencher du rendu ; aucun nouvel await n’en fait une dépendance initiale.
- `sgdiPullCurrentEmployees` ajoute une continuation de promesse, pas un deuxième téléchargement nominal. Ses reprises bornées ne s’activent qu’après invalidation ; les mesures finales montrent un seul GET employés.
- Hydratation et capture de référence s’exécutent une seule fois par bootstrap dans les traces contrôlées ; aucun deuxième traitement du snapshot n’est observé.
- Le chargement DRH/dashboard/congés intervient après le portillon existant dans les quatre états. Son téléchargement n’est pas à l’origine de la hausse historique.
- Version reste appelée deux fois ; le ticket SSE une fois dans les cinq passages finaux. Ces appels ne sont pas rendus bloquants par les corrections.

Aucune correction n’est retirée. Aucun changement supplémentaire du shell, du métier, des filtres, des droits ou du lazy loading n’est justifié par cette bissection.

## Bilan et limites statistiques

Comparé à la base **rejouée dans cette campagne**, cold −6,2 %, Employés −43,1 %, payload API −35,6 %, requêtes −23,1 %. Le retour chaud final mesure 128,5 ms en médiane.

Les différences cold appariées par série sont −1 044,8 ; +223,2 ; +73,2 ; −80,7 ; −268,4 ms. Un test exploratoire exact par changement de signe des différences donne p=0,8125 pour l’hypothèse directionnelle « branche plus lente ». Avec cinq séries, cette absence de signal **n’est pas une preuve d’équivalence**. La décision s’appuie sur les cibles absolues atteintes en médiane et sur les gains mesurés, pas sur une garantie statistique de production.

Tous les cold de branche restent sous 1,50 s. La cible Employés de 1,10 s est atteinte **en médiane**, mais son premier passage atteint 1,326 s ; aucun maximum ou p95 ≤1,10 s n’est promis. Les mesures instrumentées sont locales, sur SQLite synthétique. Polices externes, flux SSE permanent et service worker restent exclus exactement comme avant. La fixture ne contient pas de photos.

## Tests, arbre et commits

Rejoués après les vingt mesures, hors campagne de chronométrage :

- **119 tests ciblés réussis** : DRH, employés, recrutement, documents partagés, routeur asynchrone, deep links, campagnes de navigation et courses entre modules, protections de chargement/rendu.
- **262 tests frontend complets réussis**, 0 échec.
- **557 tests backend complets réussis**, 14 ignorés comme précédemment, 0 échec.
- **75 fichiers JS** produit/tests passent `node --check` ; `git diff --check` passe.
- Les trois commits produit restent `3b16a2a`, `a35aebc`, `a8aa982`. Ce lot ajoute uniquement les preuves et outils d’analyse du cold start dans un commit documentaire local.
- Aucun push, merge, déploiement, migration ni accès production. Le worktree sera propre après ce commit de rapport.

[Validation des vingt profils](drh-performance/cold-recheck/summary.json) · [Commandes et provenance](drh-performance/cold-recheck/README.md).

DRH PERFORMANCE PRÊT POUR REVUE
