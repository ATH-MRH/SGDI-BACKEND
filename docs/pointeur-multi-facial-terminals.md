# Pointeur — plusieurs terminaux de reconnaissance faciale simultanés

Branche `feat/pointeur-multi-facial-terminals`. Référence technique du moteur et des circuits :
`docs/biometrics.md` ; gestes d'exploitation d'une borne : `docs/biometric-terminals.md`.

## 1. Principe

Un compte Pointeur sélectionne et utilise **plusieurs équipements faciaux à la fois**. Les
équipements sont enregistrés et appairés **une seule fois, dans l'Administration Système** ; le
Pointeur ne voit que ceux qui lui sont explicitement autorisés et ne règle rien.

Aucun second système : les deux circuits existants sont réutilisés tels quels.

| Circuit | Table | « Appairage » | Fonctionnement | Rôle du poste Pointeur |
|---|---|---|---|---|
| Terminal mobile autonome (page `/borne`) | `biometric_terminals` | code à usage unique (10 min) → clé P-256 créée sur l'appareil, jamais exportée | pointe seul, requêtes signées par l'appareil | **surveillance** : état de connexion, activité, dernière communication, dernier pointage |
| Caméra IP lue par le serveur | `cameras` | enregistrement (modèle, adresse, identifiants chiffrés) | le serveur capture l'image | **activation** : une boucle d'essais par caméra, déclenchée par le poste |

Une borne autonome n'est jamais annoncée « activée » par le Pointeur : elle n'a pas de mécanisme
d'activation distante. L'interface affiche son état de connexion et son activité (§ 4.1).

## 2. Matériel pris en charge

| Catégorie | Pris en charge | Remarque |
|---|---|---|
| Terminal mobile autonome (tablette / smartphone Android, iPad, iPhone) | oui | iPhone / iPad : non validés sur appareil réel (`docs/biometric-terminals.md` § 2) |
| Caméra IP (Dahua, RTSP générique) | oui | lue par le serveur uniquement |
| Terminal réseau autonome à reconnaissance embarquée | **non** | aucun protocole constructeur intégré |
| Caméra USB ou intégrée du poste Pointeur | **non** | une image fournie par un navigateur n'est jamais acceptée pour pointer (injection possible) ; `getUserMedia` n'est pas utilisé par le facial du poste |

La liste est renvoyée par `GET /api/biometrics/facial-devices` (`categories`) et affichée dans
l'écran d'administration.

## 3. Administration Système → Terminaux faciaux

Écran `#/admin/terminaux-faciaux` (module `administration-facial-terminals.js`). Pour chaque
équipement : identifiant, nom, type de matériel, société, site, équipement associé, état
(actif / inactif / hors ligne / révoqué), date d'appairage, dernière communication, comptes
autorisés.

| Action | Route (existante sauf mention) | Habilitation |
|---|---|---|
| Enregistrer un terminal | `POST /api/biometrics/terminals` | Administration Système |
| Appairer / remplacer le matériel | `POST /api/biometrics/terminals/{id}/pairing-code` | Administration Système |
| Révoquer | `POST /api/biometrics/terminals/{id}/revoke` | Administration Système |
| Supprimer (historique conservé) | `DELETE /api/biometrics/terminals/{id}` | Administration Système |
| Enregistrer une caméra | `POST /api/biometrics/cameras` | Administration Système |
| Lister équipements et comptes autorisés | `GET /api/biometrics/facial-devices` (nouvelle) | Administration Système |
| Comptes éligibles d'un équipement | `GET /api/biometrics/facial-devices/users?key=` (nouvelle) | Administration Système |
| Enregistrer les comptes autorisés | `POST /api/biometrics/facial-devices/authorizations` (nouvelle) | Administration Système |
| Autoriser / couper le pointage facial, renommer | `PATCH /api/biometrics/terminals/{id}` | `biometric_admin × admin` (inchangé) |

« Administration Système » = administrateur global, ou permission explicite
`administration × security × admin`. La permission `biometric_admin × admin` (Gestion du
pointage) ne suffit plus pour enregistrer, appairer, révoquer ou supprimer.

**Gestion du pointage ne propose plus aucune de ces commandes** : ni « Ajouter un terminal », ni
« Associer / Ré-associer », ni « Révoquer », ni « Supprimer ». Il y reste l'activation du facial,
l'activation du terminal, le renommage, l'audit d'un terminal et l'audit des terminaux supprimés.

L'appairage est conservé côté serveur (clé publique de l'appareil). Il n'est redemandé ni à la
connexion du Pointeur, ni à l'activation. Un remplacement de matériel génère un nouveau code :
l'ancienne clé reste valable jusqu'à l'association du nouvel appareil, les autorisations sont
conservées. Une révocation est définitive (créer un nouveau terminal).

### Autorisations

Table `facial_device_authorizations` (migration `20261014_0001`, additive) : une ligne = un compte
× un terminal **ou** une caméra. Refus par défaut. Un compte peut être autorisé sur plusieurs
équipements, un équipement peut avoir plusieurs comptes.

Une autorisation n'élargit jamais un périmètre : à l'enregistrement, un compte dont le périmètre
Société ∩ Site ne couvre pas l'équipement est refusé (422) ; à l'usage, société, site et
autorisation sont revérifiés à chaque appel. Les administrateurs globaux n'ont pas besoin de ligne.

## 4. Poste Pointeur

Au clic sur **Reconnaissance faciale** :

1. `GET /api/biometrics/pointer/terminals[?site_id=&society=]` — équipements appairés, actifs,
   autorisés pour le compte et du périmètre sélectionné (tous les sites autorisés si aucun site
   n'est choisi). La réponse ne contient ni adresse, ni identifiant de connexion, ni clé.
2. Tableau à cases à cocher : **Terminal | Site | État | Dernière activité**, « Sélectionner tout »,
   « Désélectionner tout », « Activer les terminaux sélectionnés », « Arrêter la surveillance ».
   Compteurs : sélectionnés, actifs, hors ligne, dernier événement. La sélection est mémorisée
   dans le navigateur ; elle est toujours recontrôlée par le serveur.
3. `POST /api/biometrics/pointer/terminals/activate` — **un résultat par équipement** :
   `ACTIVATED` (caméra), `MONITORED` (borne autonome, avec son état réel), `REFUSED` avec un code
   (`NOT_AUTHORIZED`, `REVOKED`, `NOT_PAIRED`, `DISABLED`, `FACIAL_OFF`, `ENGINE_UNAVAILABLE`).
4. Chaque caméra activée a **sa propre boucle** (`POST /api/biometrics/cameras/{id}/recognize`,
   route existante). La panne de l'une n'arrête pas les autres. Un seul aperçu vidéo à la fois.
5. Relevé d'état : la même route de liste, toutes les 10 s, un seul appel pour tous les
   équipements. Les pointages apparaissent dans le suivi existant (`/api/portal/attendance-live`,
   relève toutes les 2 s, inchangée) — aucune boucle supplémentaire.

Aucun bouton d'appairage, aucun appel d'administration, uniquement des `GET` et `POST`.

### 4.1 Connexion et activité d'une borne

Une borne en service relit son état toutes les 30 s, **même sans aucun passage**
(`GET /terminal/session?hb=1`, requête signée) et déclare ainsi qu'elle maintient ce battement.
Le serveur écrit la dernière communication au plus toutes les 20 s.

| État de connexion | Condition | Affichage Pointeur | Compté « hors ligne » |
|---|---|---|---|
| `ONLINE` | communication depuis moins de 90 s | « En ligne · au repos » ou « · en service » | non |
| `LOST` | la borne battait et s'est tue (trois battements manqués) | « Connexion perdue » | oui |
| `SILENT` | pas de communication récente d'une borne **sans** battement déclaré (page chargée avant cette version) | « Sans signal » — état inconnu | non |
| `NEVER` | jamais vue | « Jamais connecté » | oui |

L'**activité** est indépendante : « en service » si un pointage a été accepté sur l'équipement dans
les 10 dernières minutes, sinon « au repos ». Une borne au repos n'est donc jamais « hors ligne ».
Un remplacement de matériel efface la déclaration de battement : le nouvel appareil la refait.
Le battement apprend aussi à la borne, sans passage, une coupure du facial ou une révocation.

### 4.2 Mise en page

En mode facial, la barre d'actions, les compteurs, le bandeau de résultat et les lignes de
terminaux tiennent dans la zone de pointage sans défilement : trois lignes de 1024 à 1600 px, deux
lignes à 768, 430 et 390 px (mesuré en Chrome réel, fenêtre de 900 px de haut). Au-delà, la liste
défile dans son cadre, en-tête fixe. À partir de 1360 px les terminaux sont à gauche de la fiche du
dernier pointage. La ligne de recherche manuelle est masquée en mode facial (la carte « Saisie
manuelle » reste disponible).

### Pannes

| Situation | Comportement |
|---|---|
| Aucun terminal autorisé | message dédié, aucune tentative |
| Aucun terminal disponible (désactivés, non appairés, révoqués) | message dédié |
| Borne : connexion perdue | ligne « Connexion perdue », compteur « hors ligne » ; les autres continuent |
| Borne au repos (aucun passage) | « En ligne · au repos » : ce n'est pas une panne |
| Borne sans battement de cœur | « Sans signal » : état inconnu, à recharger sur l'appareil |
| Caméra inaccessible (502) | ligne « Caméra inaccessible », nouvel essai après 5 s |
| Terminal révoqué / autorisation retirée | sa boucle s'arrête (403), il disparaît au relevé suivant |
| Facial coupé par l'administration (409) | sa boucle s'arrête |
| Connexion interrompue | résultat **inconnu** : vérification par `GET …/pointer/terminals/attempt` avant tout nouvel essai ; jamais affiché comme un refus |
| Reconnaissance échouée | messages existants (visage inconnu, ambigu, présence réelle non confirmée…) |

## 5. Anti-doublons et règles de pointage

Aucune règle n'est dupliquée : toute reconnaissance aboutit dans `attendance_core.record_scan`.

- Verrou de ligne par employé (`SELECT … FOR UPDATE`) + anti-rebond de 300 s toutes sources
  confondues : deux équipements qui reconnaissent le même employé au même instant produisent
  **un** mouvement ; le second reçoit « déjà enregistré », jamais une sortie contradictoire.
- Idempotence : contrainte unique `(source, idempotency_key)` ; clé `cam{id}-{essai}` /
  `term{id}-ch{défi}`. Un essai rejoué ne crée rien.
- Écriture des autorisations : verrou de la ligne de l'équipement + contraintes uniques.
- Présent / Absent / Abandon de poste (seuil 60 min, motif obligatoire), vacations de nuit,
  reprise de poste, régularisation, clôture : inchangés. Une journée clôturée refuse tout
  pointage facial ; aucune reconnaissance ne modifie rétroactivement une journée.
- Consentement biométrique : revérifié au moment du pointage, quel que soit l'équipement.

Chaque événement conserve : équipement (`device_id` + `data.camera`, ou `data.terminal`),
société, site, employé, heure serveur, type (arrivée / départ), source `FACIAL`, score, résultat
du contrôle de présence réelle ; chaque tentative (acceptée ou refusée) est tracée dans l'audit
(`biometrics.recognize`, `biometrics.terminal.recognize`) avec son état de traitement.
L'activation et l'arrêt au poste sont tracés (`biometrics.pointer.activate` / `.stop`).

## 6. Tests

| Suite | Commande |
|---|---|
| Backend complet (SQLite) | `pytest` — un seul lancement à la fois par worktree (`tests/conftest.py` partage `test_sgdi.db`) |
| Concurrence PostgreSQL (base **jetable**) | `ATTENDANCE_PG_URL=postgresql+psycopg2://…/base_jetable pytest` |
| Frontend jsdom | `npm test` (dont `pointeur-facial*.test.js`, `pointeur-borne.test.js`, `pointage-terminals.test.js`, `admin-facial-terminals.test.js`) |
| Mise en page Chrome réel | `npm run test:pointeur-v5-chrome` |
| Bout en bout Chrome réel | `npm run test:pointeur-multi-facial-e2e` (serveur isolé, moteur et caméras simulés) |
| Terminaux de Gestion du pointage | `npm run test:pointage-terminals-e2e` |

### Tests qui exigent le moteur réel (OpenCV)

Ils ne s'exécutent que si `ATLAS_E2E_PYTHON` (python avec `requirements-biometric.txt`),
`BIOMETRIC_MODELS_DIR` (modèles vérifiés par `scripts/fetch_biometric_models.py`) et
`BIOMETRIC_TEST_FACES` (`obama1.jpg`, `obama2.jpg`, `biden1.jpg`) sont fournis ; sinon ils sont
**ignorés**, jamais comptés comme réussis. Les portraits ne sont pas dans le dépôt.

Constat du 2026-10-10, environnement isolé (OpenCV 5.0.0, modèles vérifiés par empreinte, portraits
publics téléchargés pour l'occasion — pas nécessairement ceux d'origine du projet) :

| Suite | Branche | `origin/main` (71fa92b), même environnement |
|---|---|---|
| `biometric-terminal-real-e2e` (borne, vrai moteur, vrai Chrome) | 5/5 | — |
| `tests/test_biometrics_engine_real.py` | réussi | réussi |
| `biometric-test-mode-real-e2e` | 4/5 — sous-test 3 en échec | 4/5 — même sous-test, même écart |
| `attendance-e2e` | 2/6 — sous-tests 2, 4, 5, 6 en échec | 2/6 — mêmes sous-tests, mêmes erreurs |
| `tests/test_drh_employee_portrait.py` (photos réelles) | 2 cas en échec | les 2 mêmes cas |

`tests/test_feature_permissions_migration.py` (exige `TEST_POSTGRES_ADMIN_URL`) : 14 réussis, 1 échec
(`test_postgresql_rejects_nonconforming_checks[or-true]`, migration `20260908_0034`), identique sur
`origin/main`.

Les échecs sont identiques sur `origin/main` : ils ne viennent pas de ce lot. Conséquence à
connaître : dans `attendance-e2e`, le sous-test 6 (pointage facial réel depuis le poste Pointeur)
échoue pendant l'enrôlement, **avant** les étapes adaptées par ce lot (autorisation du compte sur la
caméra, sélection, activation). Ces étapes-là ne sont donc **pas validées avec le moteur réel** ;
elles le sont avec le moteur simulé (`pointeur-multi-facial-e2e`).

## 7. Audit pré-déploiement

Aucun déploiement n'est effectué par cette branche. Les points « à vérifier » exigent un accès à
Coolify ou au site et ne peuvent pas être constatés depuis le dépôt.

### Migration `20261014_0001`

Analysée sur PostgreSQL 16 jetable, à partir du schéma `20261011_0001` (celui d'`origin/main`)
contenant déjà un site, un compte, un terminal appairé et une caméra :

| Vérification | Résultat |
|---|---|
| Upgrade | crée `facial_device_authorizations` ; **0 ligne** du schéma existant supprimée ou modifiée (comparaison `pg_dump -s`) |
| Données existantes | terminal appairé inchangé (somme de contrôle identique, `paired_at` conservé) ; aucune autorisation créée d'office |
| Modèle ↔ base | aucun écart sur la table (`alembic.autogenerate.compare_metadata`) |
| Contraintes | doublon compte × équipement refusé ; ligne sans équipement ou avec deux équipements refusée ; suppression d'un compte ⇒ ses autorisations supprimées (cascade) |
| Downgrade, table vide | table supprimée ; schéma **identique** à celui d'avant (comparaison `pg_dump -s`) |
| Downgrade, autorisations présentes | **refusé** (`RuntimeError`) : pas de perte silencieuse ; un retour arrière applicatif n'en a pas besoin, l'ancienne version ignore la table |
| Rejouabilité | upgrade rejoué sur une base où la table existe déjà : sans erreur |
| Chaîne | tête unique `20261014_0001` ; upgrade → downgrade → upgrade de toute la chaîne sur SQLite et PostgreSQL (`tests/test_attendance_official_shift_migration.py`) |

`start.sh` exécute `alembic upgrade head` au démarrage du conteneur : la migration s'applique dès
le déploiement.

### Autres branches en cours (fusions à blanc du 2026-10-10)

`origin/main` n'a pas bougé depuis la création de la branche (71fa92b) : fusion directe sans conflit.
Conflits que **ce lot** ajouterait avec des branches non fusionnées :

| Branche | Fichiers | Nature |
|---|---|---|
| `fix/pointeur-audit-remediation` (PR #10) | `biometrics/routes.py`, `pointeur.html`, `pointeur-borne.html`, `package.json` | même zone fonctionnelle (caméras, borne, poste) : la seconde branche intégrée devra arbitrer à la main |
| `feat/iron-emploi`, `feat/atlas-mobile-v1` | tests de tête de migration | chacune ajoute une migration fille de `20261011_0001` : **plusieurs têtes Alembic** dès que deux d'entre elles sont fusionnées — la seconde doit re-pointer son `down_revision` |
| `feat/admin-regularisation-employes` | `administration.js`, `administration-users.js`, `permission_catalog.py`, version frontend | ajouts voisins dans le module Administration |
| `main` local (2 commits non poussés), `fix/drh-pointage-ops-readonly` | `index.html`, `module-registry.js` | chaîne de version frontend |
| `refactor/pointeur-compact-ui-v51` | `tests_frontend/pointeur-facial-direct.test.js` | test du même écran |

L'identifiant `20261012_0001` est déjà utilisé par `feat/iron-emploi` : d'où `20261014_0001` ici.

### Autres points

| Point | Constat |
|---|---|
| Compatibilité des terminaux existants | Les terminaux déjà appairés le restent et continuent de pointer seuls. Tant que la page `/borne` d'un appareil n'a pas été rechargée, il n'envoie pas de battement : il s'affiche « Sans signal » au repos (jamais « hors ligne »). |
| Changement de comportement à l'ouverture | Refus par défaut : tant que l'Administration Système n'a pas autorisé un compte sur un équipement, ce compte ne voit aucun terminal dans « Reconnaissance faciale ». Les autorisations sont à saisir **avant** l'ouverture aux postes. |
| Changement d'habilitation | Enregistrer / appairer / révoquer / supprimer un terminal et enregistrer une caméra exigent un compte Administration Système ; ces commandes ont disparu de Gestion du pointage. |
| Liste des caméras | Un compte sans permission de gestion biométrique ne reçoit plus que ses caméras autorisées, sans paramètre de connexion. |
| Variables | Aucune nouvelle. `BIOMETRIC_ENABLED` et `BIOMETRIC_TEMPLATE_KEY` inchangées ; cette branche n'active aucun traitement biométrique. |
| Nouveaux traitements biométriques | Aucun : pas de nouvelle capture, pas de nouveau gabarit, pas de nouvelle caméra activée. Le battement de cœur ne transporte aucune image. |
| Charge | Par borne : une requête signée toutes les 30 s et une écriture de `last_seen_at` au plus toutes les 20 s. Par poste : 1 essai par caméra activée toutes les ~0,9 s (comme aujourd'hui), 1 aperçu par seconde au total, 1 relevé d'état toutes les 10 s. Aucun test de charge réalisé. |
| État des caméras | À vérifier sur site (test de connexion dans Gestion du pointage → Caméras). |
| Sauvegarde PostgreSQL récente | À vérifier (Coolify). |
| Restauration de test | À réaliser sur une copie de la sauvegarde de production, puis `alembic upgrade head`. L'analyse ci-dessus porte sur un schéma reconstruit, pas sur les données de production. |
| Version réellement déployée | À relever avant déploiement : `GET /api/version` et comparaison de `version` au MD5 de `app/static/sgdi-app.js` du commit attendu (`source_commit` seul ne prouve rien). |
| Image Docker de rollback | À identifier dans Coolify (image du commit actuellement servi). |
| Épinglage du SHA dans Coolify | À vérifier (champ « Commit SHA » de la source Git). |
| Sécurité | Tests RBAC, périmètre 403, secrets absents des réponses : voir § 6. Des constats de sécurité backend ont été identifiés lors de l'audit et sont suivis séparément dans un rapport de sécurité privé. |

**Décision : GO pour préparer le déploiement (revue, fusion planifiée, restauration de test) ;
NO-GO pour déployer** tant que la restauration de test, l'ordre d'intégration avec les branches
ci-dessus et les points « à vérifier » ne sont pas traités et qu'un GO écrit n'a pas été donné.

## 8. Limites connues

- Les caméras IP sont toujours saisies dans Gestion du pointage → Caméras (par un compte
  Administration Système) ; l'écran d'administration les liste et gère leurs comptes autorisés.
- Une borne dont la page n'a pas été rechargée depuis cette version n'a pas de battement de cœur :
  « Sans signal » au repos, tant qu'elle n'est pas rechargée.
- Les caméras n'ont pas de liaison permanente : leur disponibilité réelle n'est connue qu'à l'essai.
- Le pointage facial réel depuis le poste Pointeur n'a pas pu être validé avec le moteur OpenCV
  (§ 6) ; il l'est avec le moteur simulé.
- Les limiteurs de débit restent en mémoire par processus.
