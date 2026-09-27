# ATLAS Design System V1 — baseline avant modification

Base réelle récupérée par `git fetch origin` le 27 septembre 2026 :
`d0a39f590ef9a05113a66c9ce1a93f309c7545b9`.
Branche `feat/atlas-design-system-v1`, worktree isolé. Le worktree initial,
sur `backup/local-work-20260920`, contient deux modifications utilisateur
(`sgdi-app.css`, `sgdi-app.js`) qui restent intactes.
Aucun push ni déploiement autorisé dans ce chantier.

## Frontend complet

Exécuté avant toute modification produit, avec Node et les dépendances existantes :

```sh
NODE_PATH='/Users/ath/Downloads/ATLAS 1/node_modules' npm test
NODE_PATH='/Users/ath/Downloads/ATLAS 1/node_modules' npm run test:drh-next
NODE_PATH='/Users/ath/Downloads/ATLAS 1/node_modules' npm run test:core-v3
```

- Suite principale : **605 réussis, 0 échec, 0 ignoré**, 75,52 s.
- DRH NEXT : **114 réussis**, 3,94 s.
- Core V3 : **45 réussis**, 1,43 s.
- `git diff --check` : propre sur la base non modifiée.

La suite principale couvre Administration, DRH/Employé 360, OPS/photos,
Pointage/Pointeur, BEO, Finance, Commercial, Matériel, Facturation, Paie,
Recrutement, Secrétariat, portails, navigation et courses de chargement.
Logs locaux `/tmp/atlas-ds-baseline-{frontend,drh-next,core-v3}.log`.

# ATLAS Design System V1 — baseline backend et cartographie de routage

Audit local du 27 septembre 2026, avant modification produit.

- Worktree : `/Users/ath/Downloads/ATLAS 1/.worktrees/atlas-design-system-v1`.
- Branche : `feat/atlas-design-system-v1`.
- Base vérifiée propre : `d0a39f590ef9a05113a66c9ce1a93f309c7545b9`.
- Aucun push, déploiement, accès production, changement produit ou git effectué par cet audit.
- Consigne lue : `/Users/ath/.codex/attachments/456f220b-8e2d-4a01-aee4-13efb89d92c8/Texte collé.txt` (le fichier fourni finit au §50 « Créer un Design System compatible »).

## Isolation des tests

`tests/conftest.py` impose, avant les imports applicatifs :

- `DATABASE_URL=sqlite:///./test_sgdi.db` (ligne 5), soit un fichier dans ce worktree ;
- `APP_ENV=test` (ligne 11) ;
- `SGDI_UPLOADS_DIR=tempfile.mkdtemp()` (lignes 4, 13), fichiers de test temporaires ;
- moteur/session de test substitués à `app.db.session` (lignes 31–45) ;
- dépendance FastAPI `get_db` remplacée pour TestClient (lignes 119–129) ;
- teardown : tables supprimées, pool fermé puis fichier SQLite supprimé (lignes 54–66).

Pas de base PostgreSQL ni de fichiers production utilisés. Les tests de caméra Dahua ouvrent uniquement un serveur HTTP factice sur `127.0.0.1` avec port éphémère.

## Exécution initiale : environnement incomplet

Commande : `/Users/ath/sgdi-venv/bin/python -m pytest -q -ra`.

Résultat : interruption pendant la collecte, **1 erreur, aucun test exécuté** : `ModuleNotFoundError: No module named 'PIL'` dans `tests/test_biometrics_engine_real.py:20`. Ce venv n'a pas Pillow ; ce n'est pas une régression applicative. Aucun paquet n'a été installé.

Log complet : `/tmp/atlas-ds-baseline-backend.log`.

## Exécution de référence

Python système existant : `/Library/Frameworks/Python.framework/Versions/3.13/bin/python3` (Pillow, pytest, FastAPI et SQLAlchemy présents).

Commande : `python3 -m pytest -q -ra`.

Log complet : `/tmp/atlas-ds-baseline-backend-system-python.log`.

Résultat de la suite complète : **981 réussis, 26 ignorés, 2 erreurs de setup**, en **95,62 s** (exit 1). Les deux erreurs sont `PermissionError: [Errno 1] Operation not permitted` à `socket.bind(("127.0.0.1", 0))`, fixture `dahua_server`, `tests/test_biometrics_engine_real.py:118`. Aucun test applicatif n'a échoué.

Rejeu limité, avec autorisation d'écoute locale du serveur factice :

```sh
python3 -m pytest -q -ra tests/test_biometrics_engine_real.py -k dahua
```

Résultat : **2 réussis, 3 désélectionnés en 1,67 s** (exit 0).
Log : `/tmp/atlas-ds-baseline-backend-dahua-local-network.log`.

Bilan des tests distincts : **983 réussis et 26 ignorés** après résolution de la restriction locale, sans changement de code. Il s'agit de la combinaison suite complète + rejeu ciblé, pas d'une nouvelle exécution complète verte. Aucun flake applicatif constaté ; les échecs préalables sont des limites d'environnement documentées. Le code distant du même commit a aussi passé la CI déjà contrôlée (`36332223607`, 983 passed / 26 skipped).

### 26 tests ignorés, sans les masquer

| Famille | Nombre | Cause de skip déclarée |
|---|---:|---|
| `test_alerts_postgresql_lock.py` | 4 | PostgreSQL local indisponible, test réservé à un PostgreSQL réel |
| `test_attendance_core_pg_race.py` | 5 | `ATTENDANCE_PG_URL` non défini, base PostgreSQL jetable requise |
| `test_auth.py::test_health_db_with_auth` | 1 | `/health/db` utilise des fonctions PostgreSQL absentes de SQLite |
| `test_biometrics_engine_real.py` | 3 | Dépendance optionnelle OpenCV `cv2` absente |
| `test_feature_permissions_migration.py` | 13 | `TEST_POSTGRES_ADMIN_URL` non défini |

Les tests PostgreSQL de concurrence/migration et les tests OpenCV ne sont donc pas certifiés par cette baseline locale. Aucun test ignoré n'a été artificiellement exclu par la commande complète. Aucun second pytest n'a été lancé en parallèle. Le teardown a supprimé `test_sgdi.db`.


# Baseline E2E — ATLAS Design System V1

Les quatre suites existantes terminent avec un code de sortie **0** sur la baseline **d0a39f590ef9a05113a66c9ce1a93f309c7545b9** : **28 tests réussis, 0 échec, 1 ignoré** (comptages TAP incluant les quatre tests parents).

| Suite | Tests TAP | Réussis | Échecs | Ignorés | Durée processus | Preuve |
|---|---:|---:|---:|---:|---:|---|
| Administration utilisateurs | 7 | 7 | 0 | 0 | 16.010 s | [log](/tmp/atlas-ds-baseline-e2e-artifacts/admin-users.log) |
| BEO / Site Workforce | 6 | 6 | 0 | 0 | 16.740 s | [log](/tmp/atlas-ds-baseline-e2e-artifacts/beo.log) |
| Finance Platform | 9 | 9 | 0 | 0 | 50.064 s | [log](/tmp/atlas-ds-baseline-e2e-artifacts/finance.log) |
| Attendance | 7 | 6 | 0 | 1 | 6.479 s | [log](/tmp/atlas-ds-baseline-e2e-artifacts/attendance.log) |

## Source et isolation

- Worktree de référence : `/Users/ath/Downloads/ATLAS 1/.worktrees/atlas-design-system-v1`.
- Archive locale créée avec `git archive d0a39f5`, exécutée depuis `/tmp/atlas-ds-baseline-e2e-source`. Les changements éventuels du worktree pendant le développement CSS ne peuvent pas contaminer cette baseline.
- Les quatre tests et les fichiers JS/CSS de référence restent identiques après exécution : [manifest SHA-256](/tmp/atlas-ds-baseline-e2e-artifacts/source-hashes.json).
- Serveurs exclusivement sur localhost, bases SQLite synthétiques et répertoires d'upload temporaires créés par les tests existants. Pour Attendance, les noms `pointage.irongs.com` et `pointeur.irongs.com` sont redirigés par Chrome vers localhost:8953.
- Chrome headless avec profils temporaires distincts ; aucun onglet/profil du navigateur utilisateur utilisé.
- Environnement externe réduit à PATH/HOME/TMPDIR/langue et paramètres de test ; aucun identifiant de production hérité, SMTP désactivé. Aucun accès à la base de production, aucun push ni déploiement.
- Aucun fichier produit, test ou Git du worktree n'a été modifié par cette tâche.

## Couverture exécutée

- Administration : connexion dédiée, 19 comptes, recherche/filtres/pagination, absence de N+1, lecture/menu/profils/matrice/formulaire, modification locale puis relecture API, largeurs 1440/1024/768/390 et console.
- BEO : parcours métier, contrôles intersites/intersociétés, sélecteurs multisites, 9 écrans aux quatre largeurs.
- Finance : 12 écrans fonctionnels, drawer/pagination/confirmation annulée, société/période, compte restreint, réponses tardives après changement de société, égalité débit/crédit, boucle responsive de 13 visites.
- Attendance : scénarios hostiles backend, pointage BEO, centre de contrôle (KPI/correction/clôture/réouverture/responsive), DRH Next Employé 360 et restriction biométrique.

## Limite explicite

Le scénario Attendance « biométrie réelle : consentement + enrôlement, terminal zéro clic, image figée refusée » est **ignoré par le test existant** : modèles et portraits biométriques de test non fournis. Il n'est pas compté comme réussi. Aucun matériel caméra réel n'a été utilisé.

Finance affiche toutes ses assertions réussies après environ 26,3 s puis se termine proprement après 50,1 s ; aucune interruption ni correction du teardown n'a été nécessaire.

## Environnement et reproduction

- Node `v22.22.2`, Python `/Library/Frameworks/Python.framework/Versions/3.13/bin/python3`.
- FastAPI `0.115.6`, SQLAlchemy `2.0.36`, Uvicorn `0.34.0`.
- Chrome `154.0.8037.57`, Puppeteer Core `23.11.1`, réutilisé via `NODE_PATH=/Users/ath/Downloads/ATLAS-admin-beo/node_modules`.
- Aucune installation dans le dépôt. Une préparation de dépendances temporaire dans `/tmp/atlas-ds-e2e-deps` a précédé la découverte du chemin existant ; cette copie n'a pas été utilisée pour les tests et aucun navigateur n'a été téléchargé.
- [Lanceur de reproduction](/tmp/atlas-ds-baseline-e2e-runner.py) : exécute sans modification les quatre commandes `node --test tests_frontend/<fichier>` de façon séquentielle, avec timeout de sécurité 300 s jamais atteint.

## Artifacts conservés

- [Résultats structurés](/tmp/atlas-ds-baseline-e2e-artifacts/results.json).
- [Logs et captures](/tmp/atlas-ds-baseline-e2e-artifacts).
- [Admin 1440 px](/tmp/atlas-ds-baseline-e2e-artifacts/admin-users/users-1440.png), [1024 px](/tmp/atlas-ds-baseline-e2e-artifacts/admin-users/users-1024.png), [768 px](/tmp/atlas-ds-baseline-e2e-artifacts/admin-users/users-768.png), [390 px](/tmp/atlas-ds-baseline-e2e-artifacts/admin-users/users-390.png).
- [Mesures responsive Admin](/tmp/atlas-ds-baseline-e2e-artifacts/admin-users/measurements.json), [réseau filtres/pagination](/tmp/atlas-ds-baseline-e2e-artifacts/admin-users/network-filter-pagination.json), [serveur Admin](/tmp/atlas-ds-baseline-e2e-artifacts/admin-users/server.log).
- Tous les logs produits par les commandes sont conservés. Les scripts BEO/Finance/Attendance existants ignorent eux-mêmes stdout/stderr de leur serveur uvicorn ; ces flux ne sont donc pas disponibles.
