# FRONTEND PHASES 2B–2G

État stable avec extractions partielles. Toutes les phases ont un résultat testé et
committé, mais le minimum de moins de 20 000 lignes n’est pas atteint : 27 192 lignes.
Les dépendances synchrones partagées ont été conservées plutôt que déplacées de force.

## Git

- Branche : `refactor/frontend-phase2b-2g`.
- HEAD initial : `31795cc79a4cdbbb3f24e3f341f8096cfc0f5c58`.
- HEAD final du code validé : `5ef4c3c71db6e2093160d54b2b432d81f253d3a6`.
- Le commit documentaire contenant ce rapport suit ce HEAD ; son hash est donné
  dans le rapport de livraison, sans modifier le code validé.
- Worktree : `/private/tmp/ATLAS-phase2b-2g`, propre à la livraison.
- Le worktree `main` conserve son HEAD `cdcdf73f16d84e767fe698b1753406d08d58d9f3`
  et ses 13 modifications/suppressions préexistantes. Il n’a pas été modifié.
- Aucun push, merge, rebase, squash ou déploiement.

Commits de code et validation :

```text
86c25a7  refactor(frontend): lazy load isolated payroll views
d7431e5  refactor(frontend): extract pointage views and scope route timers
44fda7f  refactor(frontend): extract OPS views with scoped resources
17e4454  refactor(frontend): split lazy material inventory stores and movements
5834483  refactor(frontend): lazy load recruitment views and workflows
8a19f95  refactor(frontend): extract contract views and preserve shared render helpers
5785a14  refactor(frontend): extract employee list views
b7a6cdb  refactor(frontend): split lazy DRH dashboards and leave views
2f5fabe  refactor(frontend): lazy load administration user views
932b3b6  refactor(frontend): extract administration permission views
a7ae6c4  refactor(frontend): split administration settings and workflows
5ef4c3c  test(frontend): verify history navigation and registry fallback
```

## Phase 2B

VALIDÉ : `paie.js`, vues/actions Paie. 650 lignes de fonctions déplacées ; réduction
nette de 644 lignes dans le monolithe. Suite frontend : 185/185.

REPORTÉ : blacklist/unlock/impressions, fiches de position/badges, helpers photo et
documents. Leurs appels synchrones depuis les fiches agents, Administration, Matériel
et la vérification publique de badge demandent un découplage supplémentaire.
Les calculs et réglages Paie partagés restent dans le core.

## Phase 2C Pointage

`pointage.js` et `pointage-1.js` : 1 675 lignes de fonctions déplacées, réduction nette
1 626 lignes. Relève 30 s liée à init/destroy ; arrêt QR tablette, présence live,
planning, saisie automatique et scanner. La réouverture attend la fermeture du
scanner. Les démarrages différés et la reprise après chargement des employés sont gardés.

Tests : frontend 186/186 ; QR/planning/saisie/feuille, retours répétés et nettoyage
immédiat/après callback différé. Caméra physique non testée.

## Phase 2D OPS

`ops.js` et `ops-1.js` : 1 229 lignes de fonctions déplacées, réduction nette 1 213.
Callbacks différés suivis et annulés, listener de menu missions unique et retiré au
destroy, arrêt de l’intervalle alertes et du QR. API inchangées.
Les formulaires Sites et opérations partagées restent synchrones dans le core.

Tests : frontend 187/187, ciblés 24/24 ; backend 550 réussis, 14 ignorés.

## Phase 2E Matériel

`material.js`, `material-stores.js`, `material-inventory.js`,
`material-movements.js` : 3 901 lignes de fonctions déplacées, réduction nette 3 869.
Aucun fichier de 5 000 lignes. Helpers de stock/dotation utilisés par les autres
écrans conservés dans le core.

Tests : frontend 188/188, ciblés 10/10 ; listes, formulaires, magasins, catalogue,
mouvements, fermeture/réouverture et chargement unique.

## Phase 2F DRH

Recrutement (`recruitment.js`, `recruitment-actions.js`), contrats (`contracts.js`),
effectif (`employees.js`), DRH/congés (`drh.js`, `drh-dashboard.js`, `leaves.js`).
4 464 lignes de fonctions déplacées au total après restauration des helpers partagés ;
réduction nette de 4 378 lignes. Fiches agents, documents contractuels et positions
partagés conservés dans le core. Aucun changement de backend DRH.

Tests frontend successifs : 189/189, 191/191, 192/192 puis 193/193 ; ciblés fin de 2F
26/26 ; backend 550 réussis, 14 ignorés. Formulaire candidat non enregistré conservé
après annulation de navigation, fiches employés/contrats et backendId vérifiés.

## Phase 2G Administration

Neuf scripts : entrée `administration.js`, `administration-users.js`,
`administration-user-forms.js`, `administration-permissions.js`,
`administration-access-settings.js`, `administration-rh-settings.js`,
`administration-pointage-settings.js`, `administration-maintenance.js`,
`administration-settings.js`. 2 681 lignes de fonctions déplacées ; réduction nette
2 656 lignes. Chaque fichier reste inférieur à 850 lignes.

Commits successifs utilisateurs, permissions, paramètres/workflows. Les contrôles
effectifs partagés, dont `userAllowedStructures` et `canAccessStructureKey`, restent
dans le core. Aucun changement de règle, scope, droit ou endpoint.

Tests : frontend 194/194 puis 195/195 ; ciblés 18/18 ; backend 550 réussis, 14 ignorés.
Deux utilisateurs ouverts six fois au total dans les permissions ; backendId 42/84
préservés, avertissement « Permissions préparées — non actives » présent, aucune
écriture de permission effectuée par ce parcours. Liens directs profils, postes,
menus, paramètres et modale utilisateur couverts.

## Mesures

| Mesure | Avant | Après |
|---|---:|---:|
| Lignes sgdi-app.js | 41 578 | 27 192 |
| Octets sgdi-app.js | 3 516 632 | 2 179 859 |
| Gzip niveau 9 sgdi-app.js | 900 419 | 592 992 |
| JS local au bootstrap, octets bruts | 3 590 032 | 2 253 667 |
| Scripts lazy | 1 | 26 |
| Domaines routés via registre | 1 | 10 |
| Timer Pointage 30 s au bootstrap | 1 | 0 |

Réduction nette : 14 386 lignes (34,6 %) et environ 37,2 % du JS local au bootstrap.
Gzip calculé localement à niveau constant, pas une mesure de transfert réseau.
Le total bootstrap additionne les fichiers locaux référencés par script[src] dans
index.html ; CDN et code inline inchangés exclus. Les autres timers bootstrap sont
conservés ; aucun nouveau polling, timer global ou appel API bootstrap ajouté.
Aucun module de domaine ajouté à index.html. Version commune : `20260908-phase2g-settings`.

Mesures après chaque commit de code :

| Commit | Lignes core | Octets core | Gzip 9 | JS bootstrap | Scripts lazy |
|---|---:|---:|---:|---:|---:|
| `31795cc` | 41,578 | 3,516,632 | 900,419 | 3,590,032 | 1 |
| `86c25a7` | 40,934 | 3,453,423 | 886,563 | 3,526,830 | 2 |
| `d7431e5` | 39,308 | 3,308,123 | 852,791 | 3,381,558 | 4 |
| `44fda7f` | 38,095 | 3,178,479 | 822,826 | 3,251,958 | 6 |
| `17e4454` | 34,226 | 2,865,567 | 753,657 | 2,939,074 | 10 |
| `5834483` | 32,842 | 2,747,757 | 726,269 | 2,821,381 | 12 |
| `8a19f95` | 31,918 | 2,669,854 | 707,275 | 2,743,505 | 13 |
| `5785a14` | 31,393 | 2,620,874 | 694,771 | 2,694,581 | 14 |
| `b7a6cdb` | 29,848 | 2,467,347 | 658,228 | 2,541,087 | 17 |
| `2f5fabe` | 29,721 | 2,452,650 | 654,556 | 2,526,455 | 19 |
| `932b3b6` | 29,509 | 2,423,745 | 647,941 | 2,497,556 | 20 |
| `a7ae6c4` | 27,192 | 2,179,859 | 592,992 | 2,253,667 | 26 |
| `5ef4c3c` | 27,192 | 2,179,859 | 592,992 | 2,253,667 | 26 |

L’inventaire des fonctions, collections db, APIs, ressources et helpers retenus se
trouve dans `frontend-phase2b-2g-inventory.json`. `db` et l’hydratation restent globaux.

## Tests finaux

- Frontend complet : **197/197**, processus terminé normalement.
- Ciblés registre, routeur, Secrétariat, campagne et permissions : **59/59**.
- Backend complet après seconde revue : **550 réussis, 14 ignorés**.
- Syntaxe : **43 JS applicatifs et 17 JS de tests** conformes.
- `git diff 31795cc --check` conforme, incluant les fichiers ajoutés.
- Parcours répétés ×3, liens directs, navigation rapide, init/destroy, téléchargement
  unique et existence/version des assets, formulaires et backendId couverts.
- Précédent/suivant avec les vrais événements hashchange/popstate dans jsdom : vert.
- Registre absent : carte compréhensible avec bouton Recharger pour chaque nouvelle route.

Commandes principales (dépendances Node résolues depuis l’installation locale existante) :

```sh
npm test
node --test tests_frontend/module-registry.test.js tests_frontend/router-async.test.js tests_frontend/secretariat-module.test.js tests_frontend/module-campaign.test.js tests_frontend/lot-05b.test.js
python3 -B -m pytest -p no:cacheprovider -q /private/tmp/ATLAS-phase2b-2g/tests
git diff 31795cc --check
```

Pytest exécuté depuis un répertoire temporaire isolé, avec PYTHONPATH sur ce worktree ;
conftest force SQLite de test et des uploads temporaires. Aucune connexion production.

## Régressions

Revue 1 : comparaison intégrale des fonctions top-level et instructions globales à
la base. Aucune fonction historique perdue ou dupliquée (3 069 noms). Corps métier
conservés ; exceptions explicites limitées aux gardes/cycles de vie, fallback de route,
et suppression d’espaces sur une ligne blanche du HTML du bulletin Paie.
La seule instruction globale retirée est le timer Pointage déplacé dans son cycle.

Corrections pendant la campagne : restauration des helpers recrutement utilisés par
le post-rendu partagé et de renderElementsSortants utilisé par Effectif ; arrêt des
ressources Pointage/OPS et protection des callbacks différés. Les tests statiques
lisent désormais core + modules ; leurs assertions métier n’ont pas été supprimées.
Les fixtures de test ont été adaptées au DOM, aux rôles et aux réponses API attendus.

Revue 2 indépendante, en lecture seule : aucun défaut bloquant introduit confirmé dans
les parcours en ligne inspectés. Dépendances cachées, onclick, globals, cache et hooks
examinés ; 27/27 tests campagne + registre terminés normalement, puis validation
complète relancée par l’agent principal sur l’état final.

Limites restantes : première ouverture hors réseau d’un domaine jamais chargé non
garantie (les nouveaux scripts ne sont pas précachés) ; caméra, navigateur réel et
service worker non exercés ; réponses API simulées et courses métier après navigation
non exhaustivement couvertes. La revue ne vaut pas certification de tous les parcours.

## Sécurité

Aucun backend métier, migration, permission effective, activation feature-level,
current_user, scope_policy, enforce_module_access, AccessRule ou global_society_access
modifié. Aucun lot 0.6, IA métier, secret ou artefact local ajouté. Les seules modifications
Python concernent trois tests lisant la source frontend. Aucun accès production, Coolify,
push, merge ou déploiement. Les changements préexistants de main sont hors de cette branche.

## Reste à faire

Le seuil <20 000 lignes n’est pas atteint ; le seuil souhaité <15 000 non plus.
Restent notamment Sites/Incidents, Facturation/Commercial, Agenda, Portail/Demandes,
positions/badges, photos/documents, formulaires agents et helpers transverses.

Avant extraction supplémentaire : formaliser les dépendances synchrones communes,
conserver les appels legacy et les bridges, puis découper et tester par domaine.
Le chargement à la demande des collections db et une stratégie offline explicite
sont des optimisations ultérieures. Aucun déplacement massif au bootstrap pour
faire artificiellement baisser le nombre de lignes.

PHASES 2B–2G PARTIELLES — ARRÊT AU DERNIER ÉTAT STABLE
