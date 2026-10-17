# Branche d'intégration technique `integration/pointeur-security-multifacial`

Candidat de validation de compatibilité, **pas une branche de livraison** : aucune fusion dans
`main`, aucun déploiement, aucune activation de la reconnaissance faciale réelle. Inventaire du
2026-10-10, à partir de `origin/main` = `71fa92b`.

**Mise à jour du 2026-10-11 : la branche est synchronisée avec `origin/main` = `1958d15`
(PR #14 ATLAS MOBILE) — § 8 —, contient la version finale du lot DRH/OPS (`9bb6331`) — § 9 — et
est resynchronisée avec `origin/main` = `311b45b` (PR #15) — § 10. Ces sections prévalent sur les
§ 1, 2, 4 et 6 ; les résultats à jour sont ceux du § 10.**

## 1. Contenu

| Étape | Branche intégrée | Tête intégrée | Résultat |
|---|---|---|---|
| A | `fix/pointeur-audit-remediation` (PR #10) | `7b1a7bd` | fusion sans conflit |
| B | `feat/pointeur-multi-facial-terminals` | `652cae8` | 4 conflits résolus à la main |
| C | `fix/drh-pointage-ops-readonly` | `f01b28a` (tête **poussée**) | 5 conflits résolus à la main |

Non intégrées (étape D, analyse seulement) : `feat/iron-emploi`, `feat/atlas-mobile-v1`,
`feat/admin-regularisation-employes`.

## 2. Matrice de compatibilité

| Branche | Tête (locale / poussée) | Base | Commits | Fichiers communs avec A ∪ B | Migrations | Risque | Décision |
|---|---|---|---|---|---|---|---|
| `fix/pointeur-audit-remediation` (PR #10) | `7b1a7bd` / idem | `6b2aac3` (6 commits derrière `main`) | 5 | — | aucune | faible | **intégrée (A)** |
| `feat/pointeur-multi-facial-terminals` | `652cae8` / idem | `71fa92b` | 17 | 7 avec A (`biometrics/routes.py`, `terminals.py`, `pointeur.html`, `pointeur-borne.html/.js`, `package.json`, `test_biometrics_terminals.py`) | `20261014_0001` | moyen | **intégrée (B)** |
| `fix/drh-pointage-ops-readonly` | `76a2980` / `f01b28a` | `dcfc8fc` | 6 poussés + 1 local non poussé ; **11 fichiers modifiés non commités** dans son worktree | 8 (`auth/dependencies.py`, `irongs/*`, `index.html`, `module-registry.js`, `sgdi-app.js`, `package.json`) | aucune | moyen : chantier encore en mouvement | **tête poussée intégrée (C)** ; à refaire quand le chantier sera commité et poussé |
| `feat/iron-emploi` (PR #12) | `0d860e7` / `8b4b1f7` (2 commits locaux non poussés, 1 fichier non commité) | `71fa92b` | 5 poussés + 2 | 4 (`auth/dependencies.py`, `package.json`, 2 tests de tête de migration) | `20261012_0001`, puis `20261013_0001` (local) | élevé (migrations) | non intégrée |
| `feat/atlas-mobile-v1` (PR #14) | `9527631` / idem | `71fa92b` | 6 | 6 (`main.py`, `auth/dependencies.py`, `auth/routes.py`, `portal/routes.py`, 2 tests de tête de migration) | `20261013_0001`, `20261013_0002` | élevé (migrations, authentification) | non intégrée |
| `feat/admin-regularisation-employes` | `d7fc1dd` / **jamais poussée** ; 5 fichiers non commités | `6b2aac3` | 3 | 10 (`permission_catalog.py`, `main.py`, `index.html`, `module-registry.js`, `administration*.js`, `sgdi-app.js`, `package.json`, …) | `20261011_0001` | élevé (identifiant de migration déjà pris par `main`) | non intégrée |

Autres branches actives sur les mêmes fichiers : `refactor/pointeur-compact-ui-v51`
(`tests_frontend/pointeur-facial-direct.test.js`), `main` local (2 commits non poussés du chantier
Candidatures DRH : `index.html`, `module-registry.js` — non touchés), `feat/drh-add-employee` (PR #9,
migrations filles de `20261010_0001`).

## 3. Résolution des conflits

Aucun conflit n'a été résolu en prenant une branche entière.

### Étape B

| Fichier | Résolution |
|---|---|
| `app/modules/biometrics/routes.py` — liste des caméras | Les deux protections sont **cumulées** : un compte sans permission biométrique ne reçoit que les caméras qui lui sont explicitement autorisées (multi-terminaux) **et** aucun champ réseau ni de liaison (audit). Un seul prédicat, `_has_biometric_feature`. |
| `app/static/pointeur.html`, `pointeur-borne.html` | Scripts réunissant les deux lots : version commune `20261010-integration-v1` ; version de l'audit conservée pour `html5-qrcode`. |
| `package.json` | Union des listes de tests. |

Fusionnés automatiquement puis relus : aperçu et reconnaissance caméra (autorisation de
l'équipement **avant** la limite de débit de l'audit), `terminals.py`, `pointeur-borne.js`.

Deux tests adaptés à la règle combinée :
- test de l'audit sur la liste des caméras : le compte doit d'abord être autorisé sur la caméra ;
- test multi-terminaux « journée clôturée » : la sortie d'une vacation ouverte après clôture est
  enregistrée sans modifier la journée, avec anomalie (règle P1 de l'audit) ; une nouvelle entrée
  reste refusée.

### Étape C

| Fichier | Résolution |
|---|---|
| `app/modules/auth/dependencies.py` | Les deux jeux de règles d'écriture sont conservés : module propriétaire par route (DRH lecture seule) et préfixes d'écriture du terminal terrain (audit). Si les deux visent une route, seuls les modules admis par **les deux** restent. |
| `app/modules/irongs/routes.py` | Lecture ouverte aux modules consultants ; écriture réservée aux modules propriétaires **et** aux capacités d'écriture du compte. |
| `index.html`, `module-registry.js` | Version commune `20261010-integration-v1`. |
| `package.json` | Union des listes de tests. |

Constat qui a motivé l'étape C : sans cette branche, le contrat « DRH lecture seule » échoue sur le
candidat A + B (écritures du centre de contrôle, clôture, déverrouillage, réglages de rotation,
reconnaissance caméra).

## 4. Migrations Alembic

Chaîne du candidat : 63 migrations, **tête unique `20261014_0001`** (fille de `20261011_0001`, tête
d'`origin/main`). Les étapes A et C n'ajoutent aucune migration.

Migrations concurrentes, non intégrées :

| Branche | Révision | `down_revision` | Constat |
|---|---|---|---|
| `feat/iron-emploi` | `20261012_0001` | `20261011_0001` | sœur de `20261014_0001` |
| `feat/iron-emploi` (local, non poussé) | `20261013_0001` | `20261012_0001` | **même identifiant** que la première migration d'`atlas-mobile` |
| `feat/atlas-mobile-v1` | `20261013_0001` | `20261011_0001` | sœur ; identifiant en double avec `iron-emploi` |
| `feat/atlas-mobile-v1` | `20261013_0002` | `20261013_0001` | — |
| `feat/admin-regularisation-employes` (local) | `20261011_0001` | `20261010_0001` | **même identifiant** que la migration SMS déjà dans `main` (donc appliquée en production) ; en retard de 2 migrations |
| `feat/drh-add-employee` (PR #9) | `20261007_0035`, `20261007_0036` | `20261010_0001` | filles d'une révision qui n'est plus la tête |

Fusionner tout tel quel donnerait deux identifiants en double (erreur Alembic) et au moins quatre
têtes.

Stratégie proposée, à décider par le propriétaire au moment de chaque intégration :
- Aucune de ces migrations n'est appliquée en production : **re-pointer le `down_revision`** de la
  branche fusionnée en second (chaîne linéaire) plutôt qu'une migration de fusion. Une migration de
  fusion ne se justifierait que si deux sœurs étaient déjà appliquées quelque part.
- Les deux identifiants en double doivent être levés **avant** fusion, dans la branche qui n'est pas
  encore partagée : `20261013_0001` côté `iron-emploi` (commit local non poussé) ;
  `20261011_0001` côté `admin-regularisation` (branche jamais poussée). `20261011_0001` de `main`
  ne se renomme pas : elle est en production.
- Les tables créées par ces migrations sont disjointes (recrutement, sessions d'authentification et
  appareils mobiles, régularisation, autorisations d'équipements) : l'ordre relatif est libre.

Le downgrade de `20261014_0001` refuse toujours de supprimer la table tant qu'il reste des
autorisations.

## 5. Reconnaissance faciale réelle

**NO-GO maintenu.** Ce candidat n'active rien : `BIOMETRIC_ENABLED` est inchangé (faux par défaut),
aucune caméra ni borne n'est activée par le code, et le pointage facial réel depuis le poste
Pointeur n'a pas été validé de bout en bout avec le moteur OpenCV ni sur matériel.

## 6. Résultats des tests sur le candidat (`A + B + C`), 2026-10-10

| Suite | Résultat |
|---|---|
| `python3 -m pytest -q` + PostgreSQL jetable (`ATTENDANCE_PG_URL`) | **2202 réussis, 0 échec**, 30 ignorés (OpenCV absent de l'environnement standard, `TEST_POSTGRES_ADMIN_URL` non défini) |
| `npm test` | **1044 / 1044** (+ 12 / 12 en pré-test) |
| `npm run test:drh-next`, `test:core-v3` | 115 / 115, 45 / 45 |
| Chrome réel (10 suites : poste Pointeur, borne, terminaux, multi-terminaux, photo distante, assistant utilisateur) | 60 / 60, dont la borne avec le moteur OpenCV réel (5 / 5) |

Groupes ciblés (backend) :

| Thème | Résultat |
|---|---|
| Jetons et authentification | 106 réussis |
| Fichiers `/uploads` et sécurité P0 | 35 |
| Vacations de nuit, paie, suivi en direct (P1), temps compté | 60 |
| Caméras, bornes, robustesse (P2, P3) | 17 |
| DRH lecture seule, écritures OPS | 351 |
| Abandon de poste | 69 |
| BRQ | 25 |
| Multi-terminaux, terminaux appairés, révocation | 42 |
| Société / Site, comptes Pointeur | 22 |
| PostgreSQL : courses (anti-doublons entre terminaux, audit) et chaîne de migrations | 26 |

Migration sur PostgreSQL 16 jetable, depuis le schéma d'`origin/main` peuplé (compte, site, terminal
appairé, caméra) : upgrade sans aucune modification du schéma existant ni perte de ligne ; aucun
écart modèle ↔ base sur la nouvelle table ; downgrade refusé avec une autorisation en base
(autorisation conservée), accepté table vide avec retour au schéma d'origine à l'identique.

### Tests de bout en bout à moteur réel qui ne passent pas

| Suite | `origin/main` | Candidat | Cause |
|---|---|---|---|
| `attendance-e2e` | 2 / 6 | 1 / 6 — échoue dès la préparation des données | La validation d'adresse de caméra de l'audit (étape A) refuse `127.0.0.1`, adresse de la caméra **simulée** de ce test. Les sous-tests 2, 4, 5, 6 échouaient déjà sur `main`. |
| `biometric-test-mode-real-e2e` | 4 / 5 | 1 / 5 — même cause | idem ; le sous-test 3 échouait déjà sur `main`. |
| `pointage-pointer-users-e2e` | échec | échec | préexistant |

Ces deux suites doivent être adaptées dans la PR #10 (caméra simulée sur une adresse non locale) ;
elles ne l'ont pas été ici, pour ne pas affaiblir la protection ni modifier un autre chantier.
Conséquence : **aucun** parcours « caméra IP → moteur réel → pointage » n'est validé de bout en bout
sur ce candidat.

## 7. Décision

- Branche d'intégration : **utilisable pour valider la compatibilité** des trois lots ; suites
  complètes vertes.
- Avant toute Pull Request vers `main` : refaire l'étape C sur la version finale de
  `fix/drh-pointage-ops-readonly`, lever les identifiants de migration en double (§ 4), adapter les
  deux suites à moteur réel (§ 6).
- Reconnaissance faciale réelle : **NO-GO**.

## 8. Synchronisation avec `origin/main` `1958d15` (PR #14 ATLAS MOBILE), 2026-10-11

### Ce qui a changé

- Fusion normale d'`origin/main` (7 commits) ; pas de rebase, historique conservé.
- Conflits : deux tests de tête de migration, résolus à la main en gardant les contrôles des deux
  côtés (tête attendue `20261014_0001` ; contrôle « une seule tête, quelle qu'elle soit » de `main`
  et tête en aval de la révision SMS).
- Migration `20261014_0001` : **identifiant inchangé**, `down_revision` déplacé de `20261011_0001`
  vers `20261013_0002`, tête de `main`. Vérifié avant modification : la révision est absente de
  `main` (donc de la production, qui n'exécute que `main`) et d'aucune base PostgreSQL locale.
  Elle existe aussi, avec l'ancienne dépendance, dans `feat/pointeur-multi-facial-terminals` :
  c'est la version de cette branche d'intégration qui doit être retenue.

Chaîne du candidat : 65 migrations, tête unique `20261014_0001`.

### Alembic sur PostgreSQL 16 jetable

Depuis le schéma de `main` (`20261013_0002`) peuplé — compte, site, terminal appairé, caméra, tables
de sessions et d'appareils mobiles présentes :

| Vérification | Résultat |
|---|---|
| Tête | unique : `20261014_0001` |
| `upgrade head` | table `facial_device_authorizations` créée ; 0 ligne du schéma existant modifiée |
| Données existantes | comptes, sites, terminaux, caméras inchangés ; terminal appairé identique (somme de contrôle) |
| Contraintes | clé primaire, 3 clés étrangères, 2 unicités, contrôle « un seul équipement » ; doublon et ligne sans équipement refusés |
| Index | compte, terminal, caméra |
| Modèles ↔ base | aucun écart sur les autorisations faciales, les sessions et les appareils mobiles |
| Downgrade avec autorisations | refusé, autorisations conservées |
| Downgrade table vide | retour à `20261013_0002`, schéma identique à celui de `main` |

### Tests sur le code combiné

| Suite | Résultat |
|---|---|
| `python3 -m pytest -q` + PostgreSQL jetable | **2291 réussis, 0 échec**, 30 ignorés (OpenCV absent, `TEST_POSTGRES_ADMIN_URL` non défini) |
| `npm test` | **1044 / 1044** (+ 12 / 12) ; `test:drh-next` 115 / 115 ; `test:core-v3` 45 / 45 |
| Chrome réel (10 suites) | 60 / 60, dont la borne avec le moteur OpenCV réel (5 / 5) |

| Groupe ciblé (backend) | Résultat |
|---|---|
| Authentification, types de jetons | 71 |
| ATLAS Mobile (PR #14) : sessions, appareils, notifications, courses PostgreSQL | 89 |
| RBAC : modules, périmètres, DRH lecture seule, écritures OPS | 358 |
| Pointeur : audit P0 à P3, poste, comptes | 105 |
| OPS | 85 |
| DRH | 449 |
| BRQ | 25 |
| Multi-terminaux, terminaux, biométrie | 125 |
| Abandon de poste | 18 |
| PostgreSQL et concurrence | 46 |

Non exécutés : les tests de l'application mobile elle-même (`mobile/`, Expo), dont les dépendances
ne sont pas installées sur ce poste ; ils relèvent de la CI mobile ajoutée par la PR #14.

### Toujours ouvert

- `attendance-e2e` (1 / 6) et `biometric-test-mode-real-e2e` (1 / 5) : leur caméra simulée est
  déclarée en `127.0.0.1`, adresse refusée par la protection de l'audit. La protection n'a pas été
  assouplie ; ce sont les fixtures qui doivent changer.
- Aucun parcours « caméra IP → moteur réel → pointage » validé de bout en bout.
- DRH/OPS : seule la version poussée `f01b28a` est intégrée ; le commit local `76a2980` et le
  travail non commité du chantier ne le sont pas.
- Identifiants de migration en double dans des branches non fusionnées : `20261013_0001`
  (`feat/iron-emploi`) et `20261011_0001` (`feat/admin-regularisation-employes`).

**Reconnaissance faciale réelle : NO-GO.**

## 9. Intégration de la version finale DRH/OPS (`9bb6331`), 2026-10-11

Merge normal d'`origin/fix/drh-pointage-ops-readonly` dans la branche d'intégration (qui n'en
contenait que la version `f01b28a`). `origin/main` était inchangé (`1958d15`).

Apports : enregistrement de l'ordre de mouvement dans la transaction de la ligne de présence ;
route `GET /api/attendance/capabilities` ; centre de contrôle et onglet Pointage DRH qui n'affichent
que les actions accordées par le serveur.

### Conflit et résolution

Un seul fichier en conflit, `app/modules/auth/dependencies.py`, résolu à la main :

| Fonction | Résolution |
|---|---|
| `route_module_keys` (nouvelle, DRH/OPS) | Porte les règles d'écriture **composées** de l'intégration : module propriétaire par route et préfixes d'écriture du terminal terrain (audit P0) ; si les deux visent une route, seuls les modules admis par les deux restent. `request_module_keys` l'appelle. |
| `user_holds_module` (nouvelle, DRH/OPS) | Reprend la tolérance de l'audit pour les comptes historiques (modules non renseignés) sur le pointage du portail, hors saisie manuelle. Elle reçoit le chemin de la route. L'exception administrateur existante est conservée. |
| `enforce_module_access` et calcul des capacités | Appellent tous deux `user_holds_module` avec le chemin : **une seule règle** pour le contrôle d'accès et pour l'affichage des actions. |

Fusionnés automatiquement et vérifiés par les tests : `attendance/routes.py`, `irongs/service.py`,
`pointage/index.html` (les commandes de cycle de vie des terminaux restent retirées), `package.json`.

La route de régularisation de sortie ajoutée par l'audit (`POST /api/attendance/events/{id}/regularize-exit`)
n'était pas dans l'inventaire du contrat DRH : un test du candidat (`tests/test_integration_drh_readonly_audit_routes.py`)
vérifie qu'elle est refusée à DRH seul et ouverte aux modules propriétaires. Aucun écran ne la propose.

### Résultats

| Suite | Résultat |
|---|---|
| `python3 -m pytest -q` + PostgreSQL jetable | **2308 réussis, 0 échec**, 30 ignorés (OpenCV absent, `TEST_POSTGRES_ADMIN_URL` non défini) |
| `npm test` | **1049 / 1049** (+ 12 / 12) ; `test:drh-next` 115 / 115 ; `test:core-v3` 45 / 45 |
| Chrome réel (11 suites, dont la lecture seule du centre de contrôle) | 65 / 65, dont la borne avec le moteur OpenCV réel (5 / 5) |
| Alembic, PostgreSQL 16 jetable | tête unique `20261014_0001`, `down_revision` `20261013_0002` ; `upgrade head` crée la table et ses 7 contraintes ; aucune migration modifiée par cette fusion |

| Groupe ciblé (backend) | Résultat |
|---|---|
| DRH lecture seule, capacités, contrat intégré (SQLite et PostgreSQL) | 279 |
| Mouvements du personnel (PostgreSQL, enregistrements simultanés) | 5 |
| RBAC : module absent, société et site non autorisés, permission absente | 94 |
| OPS : présent, absent, mouvements | 85 |
| Pointeur : audit P0 à P3, poste, comptes | 105 |
| Présence, abandon de poste, vacations de nuit, temps compté | 84 |
| BRQ | 25 |
| Multi-terminaux, révocation d'équipement, biométrie | 125 |
| Authentification, types de jetons, ATLAS Mobile | 160 |
| PostgreSQL et concurrence | 51 |

### Toujours ouvert

- `attendance-e2e` (1 / 6) et `biometric-test-mode-real-e2e` (1 / 5) : caméra simulée en `127.0.0.1`,
  refusée par la protection de l'audit, qui n'a pas été assouplie.
- Aucun parcours « caméra IP → moteur réel → pointage » validé de bout en bout.
- Identifiants de migration en double dans des branches non fusionnées : `20261013_0001`
  (`feat/iron-emploi`), `20261011_0001` (`feat/admin-regularisation-employes`).
- `feat/pointeur-multi-facial-terminals` porte encore l'ancienne dépendance de `20261014_0001` :
  c'est la version de cette branche d'intégration qui fait foi.

**Reconnaissance faciale réelle : NO-GO.**

## 10. Synchronisation avec `origin/main` `311b45b` (PR #15, ventilation des candidats), 2026-10-11

Merge normal, sans rebase. La PR #15 touche 8 fichiers (recrutement, `permission_catalog.py`,
`package.json`) et n'ajoute aucune migration.

Conflit : `package.json`, liste de `npm test`. Résolu à la main : la liste de l'intégration est
conservée et le test ajouté par `main` (`recrute-ventilation-flow`) y est inséré à sa place ; tous
les scripts des deux branches sont présents (94 fichiers de test). `permission_catalog.py`, modifié
des deux côtés, a fusionné automatiquement.

| Contrôle | Résultat |
|---|---|
| Alembic | 65 révisions, aucun identifiant en double, tête unique `20261014_0001`, `down_revision` `20261013_0002` |
| PostgreSQL 16 jetable, depuis le schéma de production (`20261013_0002`) peuplé | `upgrade head` : 0 ligne du schéma existant modifiée, données conservées, terminal appairé identique, 7 contraintes ; downgrade refusé tant qu'une autorisation existe |
| `python3 -m pytest -q` + PostgreSQL jetable | **2313 réussis, 0 échec**, 30 ignorés (OpenCV absent, `TEST_POSTGRES_ADMIN_URL` non défini) |
| `npm test` | **1060 / 1060** (+ 12 / 12) ; `test:drh-next` 115 / 115 ; `test:core-v3` 45 / 45 |
| Chrome réel (12 suites, dont le recrutement) | 70 / 70, dont la borne avec le moteur OpenCV réel (5 / 5) |

| Groupe ciblé (backend) | Résultat |
|---|---|
| DRH | 464 |
| OPS, mouvements du personnel | 92 |
| BRQ | 25 |
| Recrutement (dont la ventilation de la PR #15) | 64 |
| Pointeur, présence, abandon de poste | 146 |
| Multi-terminaux, biométrie | 125 |
| RBAC | 92 |
| Authentification, types de jetons | 71 |
| ATLAS Mobile | 89 |
| PostgreSQL et concurrence | 51 |

Toujours ouvert, inchangé : `attendance-e2e` (1 / 6) et `biometric-test-mode-real-e2e` (1 / 5),
dont la caméra simulée est en `127.0.0.1` ; aucun parcours « caméra IP → moteur réel → pointage »
validé ; identifiants de migration en double dans `feat/iron-emploi` et
`feat/admin-regularisation-employes`.

**Reconnaissance faciale réelle : NO-GO.**

## 11. Conflit d'identifiant Alembic, synchronisation avec `origin/main` `7bbb549` et intégration de la branche de sécurité, 2026-10-11

### Constat

La PR #19 a ajouté sur `main` la migration `20261014_0001_contract_dc_client_site`, appliquée en
production. La migration des autorisations faciales de cette branche portait le **même
identifiant et le même parent** (`20261013_0002`). Fusionnée telle quelle, elle aurait donné deux
fichiers pour une révision : au mieux un refus d'Alembic au démarrage, au pire une base déjà
marquée `20261014_0001`, considérée à jour, sans la table `facial_device_authorizations`.

### Correction

| Élément | Avant | Après |
|---|---|---|
| Fichier | `20261014_0001_facial_device_authorizations.py` | `20261017_0001_facial_device_authorizations.py` |
| `revision` | `20261014_0001` | `20261017_0001` |
| `down_revision` | `20261013_0002` | `20261014_0001` (tête de `main`, révision de production) |
| Contenu, protection du downgrade | — | inchangés |

La migration de `main` n'est ni renommée ni modifiée. L'identifiant `20261015_0001`, d'abord
envisagé, est déjà pris par `feat/drh-badge-studio` et `feat/iron-emploi` ; `20261016_0001` par
`feat/iron-emploi`. `20261017_0001` est absent de toutes les branches locales et distantes.

Vérifié avant de renommer, en lecture seule : la table `facial_device_authorizations` est absente
de la base de production et de la seconde base du même serveur ; l'ancienne révision n'a donc été
appliquée que sur des bases jetables.

### Opérations Git

1. Renommage de la révision (commit dédié).
2. Fusion normale d'`origin/main` `7bbb549` (PR #16, #17, #19, #21). Deux conflits, résolus à la
   main : `package.json` (liste de tests de l'intégration conservée, le test supprimé par `main`
   remplacé par celui qu'il ajoute : 94 fichiers, aucun perdu) et
   `tests/test_attendance_official_shift_migration.py` (tête de chaîne). Le `down_revision` de la
   migration faciale est déplacé dans ce même commit de fusion.
3. Fusion explicite de `security/pointeur-biometric-key-backups` (`a6c688a`), sans conflit et sans
   modifier cette branche : chiffrement biométrique à deux clés, outil de rechiffrement, verrou
   d'enrôlement, sauvegardes chiffrées, restauration d'essai, surveillance, contrôle indépendant
   des contraintes de permissions. Aucune migration.
4. Correctif du contrôle des contraintes : il signalait à tort un écart sur une base rechargée
   depuis une sauvegarde (PostgreSQL y réécrit les listes des contraintes).

### Alembic sur PostgreSQL 16 jetable

Base au schéma de production (`20261014_0001`, 129 tables), peuplée de données fictives (site,
compte, salariés, trois terminaux dont un révoqué, caméra, consentement, gabarits, pointages),
puis **sauvegardée, restaurée dans une seconde base, et migrée** :

| Contrôle | Résultat |
|---|---|
| Chaîne | 66 révisions, aucun identifiant en double, tête unique `20261017_0001` |
| Restauration | 129 tables, 315 contraintes, révision et nombre de lignes de chaque table conformes |
| `upgrade head` | une table créée, `facial_device_authorizations` ; 0 ligne du schéma existant retirée |
| Données existantes | identiques avant et après (empreinte de chaque table peuplée) |
| Nouvelle table | 7 contraintes, 6 index, aucune autorisation créée d'office ; doublon, ligne sans équipement, ligne à deux équipements et compte inexistant refusés |
| Modèles ↔ base | aucun écart sur la table ; aucune table manquante ni en trop |
| Contraintes de permissions | conformes aux modèles (`scripts/check_permission_constraints.py`) |
| Downgrade avec une autorisation | refusé, autorisation conservée |
| Downgrade table vide | retour à `20261014_0001`, schéma identique à celui de départ |
| Rejouabilité | `upgrade head` rejoué sans erreur |

### Tests sur le code combiné

| Suite | Résultat |
|---|---|
| `python3 -m pytest -q` + PostgreSQL jetable (`ATTENDANCE_PG_URL`, `TEST_POSTGRES_ADMIN_URL`) | **2422 réussis, 0 échec**, 17 ignorés, 1 échec attendu |
| `npm test` | **1063 / 1063** (+ 12 / 12), trois passes au repos ; `test:drh-next` 115 / 115 ; `test:core-v3` 45 / 45 |
| Chrome réel (poste Pointeur facial, multi-terminaux, terminaux, pointage lecture seule, poste V5, bi-écran, abandon de poste, recrutement) | 42 / 42 |

| Groupe ciblé (backend) | Résultat |
|---|---|
| Authentification, jetons, sessions | 166 |
| RBAC, permissions | 168 |
| Pointeur, présence, abandon de poste | 199 |
| DRH | 544 |
| OPS, mouvements du personnel | 82 |
| BRQ | 25 |
| Multi-terminaux, biométrie, clés | 200 |
| PostgreSQL, concurrence, migrations, sauvegardes | 157 |

Ignorés (17) : 16 exigent OpenCV, les modèles ou des portraits de test, absents de
l'environnement standard ; 1 est propre à PostgreSQL dans un contexte SQLite. Échec attendu (1) :
le cas connu du contrôle de la migration `20260908_0034`, figée, couvert par
`scripts/check_permission_constraints.py`.

Hors périmètre, à l'identique sur `origin/main` `7bbb549` : `admin-users-v2-e2e` (1 / 7 en Chrome
réel). Une exécution de `npm test` lancée pendant qu'une suite backend tournait a compté 1 échec
sur 1063, non reproduit au repos et non identifié.

### Toujours ouvert

- `feat/drh-badge-studio` porte une migration `20261015_0001`, elle aussi fille de
  `20261014_0001`. Si elle rejoint `main` avant cette branche, la chaîne aura deux têtes : il
  faudra de nouveau déplacer le `down_revision` de `20261017_0001` (sans changer son identifiant).
- `feat/pointeur-multi-facial-terminals` et `security/pointeur-biometric-key-backups` portent
  encore l'ancien nom de la migration : c'est la version de cette branche qui fait foi.
- Aucun parcours « caméra IP → moteur réel → pointage » validé ; `attendance-e2e` et
  `biometric-test-mode-real-e2e` inchangés.

**Reconnaissance faciale réelle : NO-GO pour toute nouvelle activation.**
