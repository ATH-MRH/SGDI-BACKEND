# DRH PERFORMANCE

> Rapport historique. Le [contrôle cold start répété et la bissection](drh-cold-start-report.md), réalisés ensuite sur cinq parcours par état, ne reproduisent pas la régression et valident les trois cibles en médiane. Les chiffres ci-dessous restent conservés comme résultats de la première campagne.

Les trois corrections sont implémentées et commitées localement. Le résultat reste **partiel** : Employés et les volumes progressent, mais la médiane d’ouverture froide augmente dans cette campagne et la pagination réelle reste reportée.

Branche `perf/drh-loading`, worktree `/private/tmp/ATLAS-drh-performance`, base exacte `7041c27f477b5e24d8bb5509ca8d6bbf45c8edab`. Le worktree dédié était propre au départ. `origin/main` local et distant étaient alignés entre eux sur `bf9954e`, **60 commits après** la base demandée. Aucun déplacement de main ni rebase. Le répertoire utilisateur avec ses modifications préexistantes a été préservé.

## Mesures avant

Trois parcours Chrome réels, fixture locale de 1 000 employés / 500 candidats. Médianes ; détails des endpoints, appelants, SQL et traces dans les [mesures frontend avant](drh-performance/frontend-before.md) et [backend avant](drh-performance/backend-before.md).

| Mesure | Avant |
|---|---:|
| Première ouverture DRH | 1 234,2 ms |
| Ouverture chaude DRH | 156,5 ms |
| Ouverture Employés | 1 885,1 ms |
| Requêtes initiales fetch / XHR | 13 / 0 |
| Payload API initial | 5 081 011 octets |
| Endpoint le plus lourd | Employés : 1 805 093 octets |
| Construction innerHTML Employés | 30,1 ms |
| Traduction Employés | 887,1 ms |
| Employés en mémoire / lignes visibles | 1 000 / 572 |

## Top 3 goulots

1. Post-traitement de la table Employés : traductions répétées, tri du dictionnaire pour chaque texte et réécriture de 572 boutons inchangés. Le coût de traduction est le plus élevé parmi les traitements observés de cet écran.
2. Chargements initiaux répétés : employés téléchargés deux fois (1,805 Mo chacun), sidebar trois fois ; la fraîcheur du chargement initial n’était pas reconnue par le dashboard.
3. Lecture inutile du snapshot : 7 500 lignes legacy matérialisées avant d’ignorer les collections SQL/serveur. Le probe préalable démontre l’équivalence avec 6 000 lignes et environ 42 ms de lecture/filtrage évitables dans ce probe.

## Corrections

| Commit local | Fichiers produit | Détail et impact |
|---|---|---|
| `3b16a2a` | `app/static/sgdi-app.js` | Mode, tri et traductions réutilisés pendant un seul parcours ; pas de réécriture de bouton inchangé. Traductions FR/AR et contenu conservés. |
| `a35aebc` | `app/static/sgdi-app.js`, `app/static/js/modules/contracts.js` | Promises employés/sidebar partagées par token, société et révision ; fenêtres existantes de 10/60 s et 15 s conservées, invalidées après mutation, signal distant ou hydratation. Réponses obsolètes écartées ; bootstrap, NIN et Contrats attendent une lecture actuelle avec reprises bornées. Aucun cache persistant ajouté. |
| `a8aa982` | `app/modules/irongs/service.py` | Exclusion SQL des collections déjà ignorées, avant matérialisation. Ordre, réponse, droits et filtres conservés. Aucun index ni migration. |

Tests ajoutés : `tests_frontend/drh-performance-render.test.js`, `tests_frontend/drh-performance-loading.test.js`, `tests/test_drh_snapshot_performance.py`, avec inclusion frontend dans `package.json`. Le harnais local, les traces et les revues sont archivés dans `scripts/perf/` et `docs/drh-performance/`.

## Mesures après

Même fixture, navigateur, observateur SHA et politique de cache. Trois parcours valides conservés, tous sans erreur et en HTTP 200. Un onglet disparu a nécessité sa recréation pour les deux derniers parcours ; cet écart est documenté. Aucun résultat défavorable n’est éliminé.

| Mesure | Après (médiane) |
|---|---:|
| Première ouverture DRH | 2 411,8 ms (1 143,5–2 526,3) |
| Ouverture chaude DRH | 154,9 ms |
| Ouverture Employés | 1 034,9 ms |
| Requêtes initiales fetch / XHR | 11 / 0 (10–12 fetch) |
| Payload API initial | 3 273 431 octets |
| Endpoint le plus lourd | Employés : 1 805 093 octets |
| Construction innerHTML Employés | 30,6 ms |
| Traduction Employés | 109,4 ms |
| Employés en mémoire / lignes visibles | 1 000 / 572 |
| Snapshot léger backend froid | 46,65 ms, contre 55,40 ms |
| Lignes ORM du snapshot léger | 6 000, contre 7 500 |

Les [mesures navigateur après](drh-performance/frontend-after.md) et la [comparaison backend complète](drh-performance/backend-comparison.md) conservent également les durées qui augmentent. Le backend Employés, inchangé, mesure notamment 43,18 → 96,55 ms ; le snapshot complet 448,66 → 614,69 ms. La cause de cette dérive entre campagnes n’est pas établie ; aucun gain global backend ou froid n’est affirmé.

## Gains

- Temps d’ouverture Employés : **−45,1 %**.
- Temps d’ouverture froide : **+95,4 %**, résultat défavorable non résolu ; retour chaud : −1,0 %, variation faible.
- Payload API initial : **−35,6 %**, cible >50 % non atteinte. API + scripts : −26,2 %, hors autres ressources.
- Requêtes initiales : **−15,4 %** en médiane ; employés 2 → 1, sidebar 3 → 1–2.
- Traduction Employés : **−87,7 %** ; écritures `innerHTML` 574 → 2 (−99,7 %). Durée de construction HTML : **+1,7 %**, donc pas de gain revendiqué sur cette durée. Même contenu et nombre de lignes.
- Snapshot léger : durée médiane −15,8 %, lignes ORM −20 %, payload inchangé.

Les cibles absolues <3 s à froid et <1,5 s à chaud sont observées dans cette fixture, déjà atteintes avant. Cela ne garantit pas ces durées en production.

## Tests

| État | DRH/navigation ciblés frontend | Frontend complet | Backend complet | Syntaxe JS | Diff |
|---|---:|---:|---:|---:|---|
| Référence | — | 230 réussis | 550 réussis, 14 ignorés | — | Worktree propre |
| Correction 1 | 72 réussis | 237 réussis | 550 réussis, 14 ignorés | 74 fichiers OK | OK |
| Correction 2 | 97 réussis | 262 réussis | 550 réussis, 14 ignorés | 75 fichiers OK | OK |
| Correction 3 | 97 réussis | 262 réussis | 557 réussis, 14 ignorés | 75 fichiers OK | OK |

Aucun échec. Les parcours ciblés couvrent navigation DRH, employés, contrats, documents, recrutement et congés. Tests dédiés : 7 rendu, 25 chargement, 7 snapshot. Les contrôles de traduction comparent aussi 2 778 résultats avec la base. Les deux revues ont fait corriger la conservation des effets du pull scoped et une fausse réussite du bootstrap après invalidation ; aucun constat bloquant restant dans le code revu. Voir [revues](drh-performance/reviews.md) et [résultats et journaux](drh-performance/validation.json).

Commandes : `NODE_PATH='/Users/ath/Downloads/ATLAS 1/node_modules' npm test`, `python3 -m pytest -q`, campagne frontend ciblée listée dans les journaux, `node --check` sur les JS produit/tests et `git diff --check`.

## Risques restants

- **Ouverture froide non améliorée dans les résultats** : forte dispersion réseau locale et dérive backend aussi sur des routes inchangées. Une campagne contrôlée supplémentaire sera nécessaire pour attribuer ces écarts ; aucun run favorable n’a remplacé les mesures demandées.
- **Pagination réelle reportée** : l’endpoint existant diverge sur statuts, absences, blacklist, société, recherche, tri et compteurs. `db.agents` complet alimente fiches, NIN, contrats, congés et actions. L’activer sans adaptation serait une modification métier. Preuves dans l’[inventaire](drh-performance-inventory.md).
- **Snapshot léger conservé** : 934 Ko ; plusieurs collections ne servent pas directement au dashboard, mais le shell, les notifications et les sauvegardes partagent cet état. Son retrait sûr n’est pas démontré. Le snapshot complet n’est pas chargé à l’ouverture étudiée.
- **Chargement différé partiel** : employés et candidats restent complets dès le bootstrap ; le script Congés reste une dépendance DRH. Contrats/documents/templates n’appellent pas leurs endpoints dédiés à cette ouverture. Un découplage plus large exige des contrats de données et des agrégats équivalents, hors des trois corrections.
- **Legacy et environnement** : sidebar conserve 51/54 requêtes par calcul ; endpoints version/ticket restent parfois répétés. SQLite synthétique, SSE permanent/polices/service worker exclus, fixture sans photos ; aucune conclusion globale sur les documents ou PostgreSQL de production. La branche part d’une base ancienne par rapport à origin/main et devra être intégrée/revalidée séparément.

Aucun accès production, aucune migration produit, aucun changement de droits, aucun lot 0.6, aucun push, merge ou déploiement.

DRH PERFORMANCE PARTIEL — ARRÊT CONSERVATEUR
