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
| Terminal mobile autonome (page `/borne`) | `biometric_terminals` | code à usage unique (10 min) → clé P-256 créée sur l'appareil, jamais exportée | pointe seul, requêtes signées par l'appareil | **surveillance** : état en ligne / hors ligne, dernière communication, dernier pointage |
| Caméra IP lue par le serveur | `cameras` | enregistrement (modèle, adresse, identifiants chiffrés) | le serveur capture l'image | **activation** : une boucle d'essais par caméra, déclenchée par le poste |

Une borne autonome n'est jamais annoncée « activée » par le Pointeur : elle n'a pas de mécanisme
d'activation distante. L'interface l'affiche « Actif · autonome » ou « Hors ligne ».

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
| Supprimer | `DELETE /api/biometrics/terminals/{id}` | Administration Système |
| Enregistrer une caméra | `POST /api/biometrics/cameras` | Administration Système |
| Lister équipements et comptes autorisés | `GET /api/biometrics/facial-devices` (nouvelle) | Administration Système |
| Comptes éligibles d'un équipement | `GET /api/biometrics/facial-devices/users?key=` (nouvelle) | Administration Système |
| Enregistrer les comptes autorisés | `POST /api/biometrics/facial-devices/authorizations` (nouvelle) | Administration Système |
| Autoriser / couper le pointage facial, renommer | `PATCH /api/biometrics/terminals/{id}` | `biometric_admin × admin` (inchangé) |

« Administration Système » = administrateur global, ou permission explicite
`administration × security × admin`. La permission `biometric_admin × admin` (Gestion du
pointage) ne suffit plus pour enregistrer, appairer, révoquer ou supprimer.

L'appairage est conservé côté serveur (clé publique de l'appareil). Il n'est redemandé ni à la
connexion du Pointeur, ni à l'activation. Un remplacement de matériel génère un nouveau code :
l'ancienne clé reste valable jusqu'à l'association du nouvel appareil, les autorisations sont
conservées. Une révocation est définitive (créer un nouveau terminal).

### Autorisations

Table `facial_device_authorizations` (migration `20261012_0001`, additive) : une ligne = un compte
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

### Pannes

| Situation | Comportement |
|---|---|
| Aucun terminal autorisé | message dédié, aucune tentative |
| Aucun terminal disponible (désactivés, non appairés, révoqués) | message dédié |
| Terminal hors ligne | ligne « Hors ligne », compteur ; les autres continuent |
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
| Backend (SQLite) | `pytest tests/test_pointeur_multi_facial_terminals.py tests/test_facial_device_authorizations_migration.py` |
| Concurrence PostgreSQL (base **jetable**) | `ATTENDANCE_PG_URL=postgresql+psycopg2://…/base_jetable pytest tests/test_pointeur_multi_facial_pg_race.py` |
| Frontend jsdom | `npm test` (dont `pointeur-facial*.test.js`, `admin-facial-terminals.test.js`) |
| Mise en page Chrome réel | `npm run test:pointeur-v5-chrome` |
| Bout en bout Chrome réel | `npm run test:pointeur-multi-facial-e2e` (serveur isolé, moteur et caméras simulés) |

## 7. Audit pré-déploiement

Aucun déploiement n'est effectué par cette branche. Les points « à vérifier » exigent un accès à
Coolify ou au site et ne peuvent pas être constatés depuis le dépôt.

| Point | Constat |
|---|---|
| Migration | **Oui** : `20261012_0001` crée `facial_device_authorizations`. Additive, rejouable, aucune ligne existante modifiée. `start.sh` exécute `alembic upgrade head` au démarrage : elle s'applique dès le déploiement. |
| Compatibilité des terminaux existants | Les terminaux déjà appairés le restent (aucune colonne modifiée, clé conservée) et continuent de pointer seuls. |
| Changement de comportement à l'ouverture | Refus par défaut : tant que l'Administration Système n'a pas autorisé un compte sur un équipement, ce compte ne voit plus aucune caméra dans « Reconnaissance faciale ». Les autorisations sont à saisir **avant** l'ouverture aux postes. |
| Changement d'habilitation | Enregistrer / appairer / révoquer / supprimer un terminal et enregistrer une caméra exigent un compte Administration Système. Les comptes `biometric_admin × admin` non administrateurs perdent ces quatre actions. |
| Variables | Aucune nouvelle. `BIOMETRIC_ENABLED` et `BIOMETRIC_TEMPLATE_KEY` inchangées ; cette branche n'active aucun traitement biométrique. |
| Nouveaux traitements biométriques | Aucun : pas de nouvelle capture, pas de nouveau gabarit, pas de nouvelle caméra activée. `facial_attendance_enabled` reste une décision explicite par équipement. |
| État des caméras | À vérifier sur site (test de connexion de chaque caméra dans Gestion du pointage → Caméras). |
| Sauvegarde PostgreSQL récente | À vérifier (Coolify). |
| Restauration de test | À réaliser sur une base jetable à partir de la sauvegarde, puis `alembic upgrade head`. |
| Version réellement déployée | À relever avant déploiement : `GET /api/version` et comparaison de `version` au MD5 de `app/static/sgdi-app.js` du commit attendu (`source_commit` seul ne prouve rien). |
| Image Docker de rollback | À identifier dans Coolify (image du commit actuellement servi). Retour arrière applicatif possible sans retour arrière de schéma : l'ancienne version ignore la nouvelle table. |
| Épinglage du SHA dans Coolify | À vérifier (champ « Commit SHA » de la source Git). |
| Sécurité | Tests RBAC, périmètre 403, secrets absents des réponses : voir § 6. Des constats de sécurité backend ont été identifiés lors de l'audit et sont suivis séparément dans un rapport de sécurité privé. |
| Performance | Par poste : 1 essai par caméra activée toutes les ~0,9 s (comme aujourd'hui pour une caméra), 1 aperçu par seconde au total, 1 relevé d'état toutes les 10 s. Les limiteurs de débit restent en mémoire par processus. Aucun test de charge réalisé. |

**Décision : NO-GO production** tant que la migration n'a pas été validée sur une restauration de
test, que les points « à vérifier » ne sont pas constatés et qu'un GO écrit n'a pas été donné.

## 8. Limites connues

- Gestion du pointage affiche encore les boutons d'ajout, d'association, de révocation et de
  suppression d'un terminal ; le serveur les refuse aux comptes non Administration Système.
- Les caméras IP sont toujours saisies dans Gestion du pointage → Caméras (par un compte
  Administration Système) ; l'écran d'administration les liste et gère leurs comptes autorisés.
- Une borne armée et au repos communique peu : elle est considérée en ligne jusqu'à 120 s après
  sa dernière communication ; au-delà elle s'affiche hors ligne même si elle fonctionne.
- Les caméras n'ont pas de liaison permanente : leur disponibilité réelle n'est connue qu'à l'essai.
