# Audit pointeur.irongs.com — corrections

Branche `fix/pointeur-audit-remediation`, créée depuis `origin/main` (6b2aac3). Ce document
décrit, par priorité, ce qui a été corrigé, ce que cela change pour les utilisateurs, et ce
qu'il faut vérifier avant de déployer. Aucun pointage ni aucune paie existants ne sont modifiés
par ces corrections : elles ne s'appliquent qu'aux requêtes à venir.

## Constat déjà corrigé avant cette branche

La confusion des familles de jetons (un jeton du portail client accepté comme session interne)
était déjà corrigée sur `main` par le commit c2a7a2e (PR #8, `decode_staff_token`). L'audit avait
été mené sur une copie locale de `main` en retard. Rien n'est refait ici ;
`tests/test_auth_token_isolation.py` couvre ce point.

## P0 — sécurité

### Fichiers `/uploads`

- **Avant** : les routes protégées `/uploads/photos/{nom}` et `/uploads/photos/docs/{nom}` ne
  correspondaient qu'à la forme exacte du chemin. Une variante (barre oblique doublée ou finale)
  tombait sur le montage statique `/uploads`, qui servait le fichier sans contrôle.
- **Après** : le montage refuse tout ce qui se résout sous `photos/` (`_GuardedUploads`,
  `app/main.py`). Les autres dossiers (`reports/`, `tts/`) restent servis comme avant.
- **Non traité ici** : un fichier de `photos/docs/` sans ligne `Document` reste servi sans
  authentification par la route protégée (comportement existant, documenté dans `app/main.py`,
  nécessaire au portail client). Voir « Risques résiduels ».

### Porte de module sur les routes de pointage du portail

- **Avant** : seule `/api/portal/attendance-manual/*` exigeait une application de pointage.
  Les autres routes `attendance-*` (sites, feuille, relève, portrait, anomalies, flux, effectifs,
  alertes, statistiques, référentiel, validation de QR) étaient ouvertes à tout compte interne,
  dans son périmètre société. Le contrôle d'hôte ne jouait que sur `pointeur.irongs.com`.
- **Après** (`API_MODULE_PREFIXES`, `app/modules/auth/dependencies.py`) :
  - lectures : modules `pointage`, `pointeur`, `ops` ou `drh` ;
  - validation de QR (`attendance-qr/scan`) : `pointage`, `pointeur` ou `ops`.
- **Comptes historiques** (`authorized_modules` NULL) : leur rôle (`ops`, `superviseur`,
  `dispatch`, `pointeur`, `pointage`, `drh`, `rh`) continue d'ouvrir ces lectures, pour ne
  couper aucun superviseur existant. La saisie manuelle garde sa porte stricte.
- **À vérifier avant déploiement** : un compte à modules explicites qui consulte aujourd'hui
  ces routes sans détenir l'un de ces modules recevra un 403. Requête de contrôle :

  ```sql
  SELECT username, role, authorized_modules FROM users
  WHERE is_active AND authorized_modules IS NOT NULL
    AND NOT (authorized_modules::jsonb ?| array['pointage','pointeur','ops','drh']);
  ```

  Croiser le résultat avec les comptes qui utilisent `supervision.html`, `pointeur.html` ou
  l'écran Pointage d'ATLAS.

### Écritures `/api/ops/pointage/*`

- **Avant** : la clé `pointeur` ouvrait lecture ET écriture. Un pointeur pouvait créer une
  présence à une date et des heures libres, pour un employé d'une autre société.
- **Après** :
  - les écritures (POST, PATCH…) exigent le module `ops` ou `pointage`
    (`API_MODULE_WRITE_PREFIXES`) ; la lecture reste ouverte au pointeur ;
  - `POST /api/ops/pointage/daily` vérifie la société de l'employé, exige un site pour un compte
    restreint à des sites, et exige que l'employé soit affecté à l'un de ces sites.
- **Effet OPS** : un superviseur restreint à des sites ne peut plus saisir une présence pour un
  employé qui n'est affecté à aucun de ses sites (remplaçant venu d'ailleurs). Il faut d'abord
  l'affecter, ou faire saisir par un compte de périmètre société.

### Pont legacy `/api/irongs/collections/*`

- **Avant** : l'alias `pointeur → ops` donnait au terminal terrain l'écriture des collections
  OPS (présences antidatées, affectations). Le contrôle de société portait sur la société
  déclarée dans l'élément envoyé, pas sur l'employé.
- **Après** :
  - l'alias ne vaut plus qu'en lecture (`user_legacy_modules(write=True)`) ;
  - pour `feuillePresence`, `pointages`, `assignments`, `affectations`, le périmètre est contrôlé
    sur l'employé et le site résolus en base (`ensure_item_refs_allowed_for_user`), y compris
    les sites autorisés du compte.

### Périmètre vide

- `attendance-employees` : un compte sans société ni site recevait tous les employés de toutes
  les sociétés ; il reçoit 403. Le périmètre utilisé est celui des routes voisines.
- `attendance-statistics` : même périmètre (intersection sociétés × sites).

### Page du poste (`pointeur.html`)

- `esc()` échappe désormais aussi les guillemets (valable en valeur d'attribut).
- `safePhotoSrc()` : une photo n'est affichée que si elle vient de `/uploads/`, `/api/`,
  `/static/`, d'un `blob:` ou d'une image `data:image/…`. Une photo stockée sous
  forme d'URL externe (`https://…`) n'est plus affichée : les initiales la remplacent.

### Tests P0

- `tests/test_pointeur_audit_p0.py` (35 tests) et `tests_frontend/pointeur-audit-p0.test.js` (4).

## P1 — calcul des vacations, paie, suivi en direct

Principe : aucun pointage existant, aucune journée clôturée et aucune paie ne sont réécrits.
Les règles ci-dessous s'appliquent aux passages enregistrés après le déploiement. Les journées
déjà mal rattachées (nuits commencées après minuit) restent telles quelles ; les corriger
relève d'une régularisation explicite, au cas par cas.

### Suivi en direct

- `live._last_scan_by_employee` reçoit une borne `since` : il ne relit plus tout l'historique
  des employés à chaque relève (toutes les 2 s par poste). Le résultat est identique, chaque
  appelant ne demandant que des employés qui ont un passage dans cette fenêtre.

### Journée de travail des postes de nuit (effet sur la paie)

- **Avant** : une arrivée après minuit était rattachée au jour civil. Deux nuits consécutives
  dont la première commencée en retard tombaient sur une seule journée de présence : la paie,
  qui compte les journées « present » clôturées, en perdait une. Le retard n'était pas signalé
  et le lendemain recevait une anomalie « hors planning » à tort.
- **Après** : l'arrivée est rattachée à la journée de travail de la vacation officielle
  (`work_date`). Le retard est mesuré sur le début réel de la vacation, date comprise.
- **Si cette journée de travail est déjà clôturée** : elle n'est pas modifiée. Le passage reste
  sur le jour civil et une anomalie `ARRIVAL_AFTER_CLOSURE` demande la régularisation.

### Numéro de vacation (`cycle`)

- **Avant** : nombre d'arrivées parmi les 40 derniers événements de l'employé ; il augmentait
  d'un jour à l'autre puis se déréglait (arrivée 21, départ 20) après 20 vacations.
- **Après** : rang de l'arrivée dans sa journée de présence (1, 2…) ; le départ reprend celui de
  son arrivée. Les événements déjà enregistrés gardent leur ancien numéro.

### Clôture et postes de nuit

- **Avant** : clôturer la journée d'arrivée bloquait la sortie du lendemain matin (409). La
  vacation restait ouverte, sans temps compté.
- **Après** : la sortie d'une vacation ouverte est enregistrée au journal avec son temps compté.
  La journée clôturée n'est pas modifiée (ni heure de départ, ni statut) ; une anomalie
  `DEPARTURE_AFTER_CLOSURE` le signale. Une arrivée sur une journée clôturée reste refusée.

### Reprise de poste (sortie ou abandon saisi par erreur)

- Nouvelle intention `REENTRY` sur `POST /api/portal/attendance-manual/scan` : réservée à la
  saisie manuelle habilitée (`manual_entry:create`), motif obligatoire, possible seulement tant
  que la vacation de la sortie précédente est en cours. Rien n'est effacé : la sortie reste au
  journal, la reprise ouvre une vacation de rang 2, et une anomalie `REENTRY` (information) la
  signale. Le poste propose le bouton « REPRISE DE POSTE » dans la saisie manuelle.
- Temps compté : la première vacation garde son temps (souvent 0 min) ; la seconde compte à
  partir de l'heure de reprise.

### Régularisation d'un oubli de sortie

- Nouvelle route `POST /api/attendance/events/{id}/regularize-exit` (`exit_at`, `reason`) :
  ajoute la sortie manquante d'une arrivée restée ouverte. Action `update` requise, et
  `validate` si la journée est clôturée. La sortie doit suivre l'arrivée, précéder le passage
  suivant, ne pas être dans le futur et rester dans la fenêtre d'une vacation.
- La vacation reçoit un temps compté borné par le planning officiel. Une journée ouverte reçoit
  l'heure de départ ; une journée clôturée n'est pas touchée. Anomalie `EXIT_REGULARIZED`
  (information) et audit `attendance.regularize_exit`.
- Aucun écran ne l'appelle encore : à brancher dans Gestion du pointage.

### Flux de suivi

- Résumé journalier : regroupé par journée de présence (une nuit = une ligne, et non une ligne
  « En poste » jamais refermée), trié du plus récent au plus ancien avant la coupe, plafond
  porté de 200 à 1000 lignes. Chaque événement expose `presence_date`.
- Vue sur plusieurs jours (planning) : plus de coupe à 2000 lignes (plafond serveur 20000),
  sans photos.

### Page du poste

- Le planning n'envoie plus la date du suivi : il reçoit bien 8 jours.
- La date du suivi et sa borne maximale suivent le jour opérationnel après minuit, sauf si
  l'opérateur a choisi un autre jour.

### Tests P1

- `tests/test_pointeur_audit_p1.py` (14), `tests/test_pointeur_audit_pg.py` (3, PostgreSQL
  réel, dont la concurrence sur la régularisation), `tests_frontend/pointeur-audit-p1.test.js` (4).

### À vérifier avant déploiement (P1)

- Informer OPS et la paie du changement de rattachement des nuits : à partir du déploiement, une
  arrivée après minuit compte pour la veille.
- Les libellés des nouvelles anomalies (`ARRIVAL_AFTER_CLOSURE`, `DEPARTURE_AFTER_CLOSURE`,
  `REENTRY`, `EXIT_REGULARIZED`) ne sont pas encore traduits dans Gestion du pointage : le code
  brut s'affiche.

## P2 — caméras, bornes, connexion, robustesse du poste

### Caméras (`/api/biometrics/cameras*`)

- **Inventaire** : un compte sans permission biométrique (pointeur, OPS, DRH) ne reçoit plus
  l'adresse, les ports, le numéro de série, le dernier test ni les profils de flux ; il garde ce
  dont l'écran du poste a besoin (nom, rôle, usage, état).
- **Destination** : l'adresse doit être un nom d'hôte ou une IPv4 simples. Refus de la boucle
  locale, des adresses de lien local, non routables ou réservées, et de tout séparateur d'URL.
  Les chemins de flux doivent rester relatifs à la caméra. Les redirections HTTP ne sont plus
  suivies.
- **Identifiants** : changer l'adresse ou un port sans ressaisir le mot de passe efface les
  identifiants enregistrés (`credentials_cleared` dans la réponse). Ils ne sont plus jamais
  présentés à une autre destination.
- **Débit** : 240 aperçus et 120 reconnaissances par minute, par compte et par caméra.
- **À vérifier avant déploiement** : une caméra déjà enregistrée avec une adresse désormais
  refusée (par exemple `127.0.0.1` pour un relais local) continue de fonctionner, mais ne pourra
  plus être modifiée avec cette adresse.

  ```sql
  SELECT id, name, host FROM cameras
  WHERE host ~ '[^A-Za-z0-9.-]' OR host IN ('localhost') OR host LIKE '127.%' OR host LIKE '169.254.%';
  ```

### Reconnaissance

- **Indice d'employé** : il ne réduit plus la comparaison à un seul gabarit. Le meilleur candidat
  du site doit être l'employé désigné, sinon aucun pointage ; l'ambiguïté entre deux employés
  reste détectée.
- **Seuils** : planchers et plafonds côté serveur (`CONFIG_BOUNDS`). Une valeur qui neutraliserait
  la reconnaissance ou le contrôle de présence réelle est refusée.

### Bornes (`/api/biometrics/terminal/*`)

- Le terminal est identifié avant toute lecture du corps : une requête anonyme ne fait plus
  tamponner jusqu'à 20 Mo.
- Le compteur par adresse ne bloque que les identifiants inconnus. Les signatures invalides sont
  comptées par terminal et par adresse. Une requête correctement signée n'est jamais bloquée :
  un tiers sur le même réseau ne peut plus couper les bornes d'un site.
- Un horodatage démesuré donne un refus propre (401) et non une erreur 500.
- Les scores de présence réelle et de similarité ne sont plus renvoyés à la borne ; ils restent
  dans l'audit.

### Connexion

- Compteur d'échecs par compte visé, en plus du compteur par adresse. Il ne s'efface que par la
  réussite de ce compte. Au-delà de `LOGIN_MAX_ATTEMPTS` échecs dans la fenêtre, le compte reçoit
  429, même avec le bon mot de passe.
- Les échecs sont journalisés (premier échec, puis blocage), sans le mot de passe.
- **Effet de bord assumé** : quelqu'un qui connaît un identifiant peut le bloquer pendant la
  fenêtre (5 minutes par défaut) en échouant volontairement.

### Employés non actifs

- Les statuts « retraité », « décédé », « fin de contrat », « radié » rejoignent la liste des
  situations non pointables (`_employee_portal_block_reason`). Cette règle sert aussi au portail
  salarié : ces personnes n'y ont plus accès.

### Page du poste et borne

- Délai d'expiration de 30 s sur toutes les requêtes (poste et borne) : plus d'écran figé.
- Coupure réseau pendant un scan ou une saisie : message « connexion perdue, vérifiez le dernier
  pointage », distinct d'un refus.
- Second badge pendant le traitement du premier : signalé (son et message), plus ignoré.
- Doublon renvoyé par le serveur : affiché « déjà enregistré ».
- Déconnexion : les données du compte précédent sont retirées de la mémoire et de l'écran.
- Fichiers versionnés (`pointeur-facial.js`, lecteur QR, feuille de style, `pointeur-borne.js`) :
  ils sont renouvelés à la livraison malgré le cache d'un an. **À refaire à chaque livraison qui
  modifie l'un de ces fichiers.**
- Service worker : les fichiers `/uploads/` ne sont plus mis en cache ; l'ancien cache est purgé.
- Borne : un QR dont le traitement a échoué (réseau, erreur serveur) peut être présenté de nouveau.

### Tests P2

- `tests/test_pointeur_audit_p2.py` (9), 28 tests ajoutés dans `tests/test_biometrics.py`,
  3 dans `tests/test_biometrics_terminals.py`, 2 dans `tests/test_biometrics_facial_pilot.py`,
  `tests_frontend/pointeur-audit-p2.test.js` (9).
- Deux tests existants adaptés : la caméra de test en `127.0.0.1` (désormais refusée par l'API)
  et l'assertion sur les scores renvoyés à la borne (désormais vérifiés dans l'audit).

## P3 — constats de faible gravité

- `site_id` mal typé sur la saisie manuelle : refus 422, plus d'erreur 500.
- Flux : `exit_type` n'est renseigné que pour les départs (il valait « Sortie » aussi pour les
  arrivées).
- Observation d'une absence : bornée à 500 caractères, comme celle des scans.
- Poste : résultat de pointage et erreur de connexion annoncés aux lecteurs d'écran ; champ de
  recherche libellé ; résultats de recherche activables au clavier ; coller dans un champ ne
  déclenche plus une lecture de badge ; une erreur de connexion non textuelle ne s'affiche plus
  « [object Object] » ; vibration de succès rétablie.
- Borne : le verrou d'écran est redemandé au retour au premier plan.
- Tests : `tests/test_pointeur_audit_p3.py` (8), `tests_frontend/pointeur-audit-p3.test.js` (5).

## Constats de l'audit non corrigés, et pourquoi

Chacun demande une décision métier, une migration de données existantes ou une information
absente du dépôt. Ils sont laissés en l'état, volontairement.

| Constat | Raison | Ce qu'il faudrait |
|---|---|---|
| Présentation d'une photo à la borne (contrôle de présence réelle passif) | Choix de conception documenté (`docs/biometrics.md`) ; aucun correctif logiciel simple | Ne pas activer le pointage facial des bornes avant les essais physiques prévus, ou ajouter un défi actif |
| Permission fine `qr_scanning` lue par aucune route | L'exiger couperait le scan des comptes existants qui ne la détiennent pas | Migration qui l'accorde aux comptes actifs concernés, puis contrôle par route |
| Jeton du portail salarié délivré sans mot de passe (nom, prénom, matricule, date de naissance), qui permet de pointer à distance | Modifie le parcours du portail salarié | Décision produit : exiger le compte portail pour tout pointage, retirer `/pointage-qr` |
| Gabarits faciaux conservés après désactivation | Suppression irréversible, colonne non nullable, durée de conservation non définie | Politique de conservation, migration, purge planifiée |
| Aucune unicité (employé, jour) sur `daily_presence` | Une contrainte exige d'abord de dédoublonner des données existantes, dont des journées clôturées | Inventaire des doublons, régularisation, puis contrainte |
| Affectation résolue sans ses dates (future ou échue) | Dépend de la qualité des dates déjà saisies ; un filtre strict refuserait des agents réellement en poste | Contrôle des affectations `active=1` à date de fin passée, puis filtre |
| `attendance-staffing` : libellé de groupe calculé autrement que le planning officiel | Les quantités sont justes, seul le libellé diverge | Appeler `official.site_shift` |
| `attendance-statistics` : faux « sortie manquante » pour un agent en poste | Faible impact, vue non utilisée par le poste | Reprendre l'appariement des paires |
| Refus filtrés par site après une limite globale (multi-sites) | Demande une colonne ou une table dédiée | Colonne `site_id` sur les refus, filtrage en SQL |
| Seuils biométriques modifiables par un administrateur limité à une société | Les bornes limitent désormais l'effet ; restreindre davantage change les habilitations | Réserver `/config` aux administrateurs globaux |
| Jeton de session de 12 h, sans révocation ; déconnexion locale seulement | Demande un identifiant de jeton ou une version par utilisateur, donc une migration | Version de jeton par compte, révocation à la déconnexion |
| Accès bloquants en base dans des fonctions asynchrones des bornes | Refonte des dépendances, à mesurer en charge | Dépendances synchrones, file bornée sur le moteur |
| Documents de `photos/docs/` sans ligne `Document` servis sans authentification | Les fermer casserait les pièces jointes du portail client | À traiter avec le portail client |
| Mot de passe des comptes pointeur : 8 caractères, sans changement forcé | Règle de gestion des comptes | Changement à la première connexion |
| Une clé de chiffrement unique, sans rotation | Documenté ; la rotation impose un ré-enrôlement | Procédure de rotation |

## Points à connaître sur les tests

- `tests/test_biometrics_facial_pilot.py::test_entry_exit_double_scan_and_audit` échoue s'il est
  lancé juste après `tests/test_biometrics_terminals.py` : ce dernier laisse une fenêtre de
  non-répétition à zéro dans la configuration partagée. Défaut d'isolation antérieur à cette
  branche ; la suite complète, dans son ordre normal, passe.
- Les tests de concurrence (`*_pg_race.py`, `test_pointeur_audit_pg.py`) sont ignorés sans
  `ATTENDANCE_PG_URL`. Ils ont été exécutés ici sur une base PostgreSQL locale jetable.
- Aucun essai n'a été fait sur la production, ni avec de vraies caméras ou de vraies bornes.

## Avant tout déploiement

Rien n'est déployé ni fusionné. Avant de le faire :

1. **Sauvegarde** : sauvegarde complète de la base (aucune migration de schéma dans cette
   branche, mais les nouveaux pointages suivront les nouvelles règles dès la mise en service).
2. **Compatibilité des comptes** : exécuter la requête de la section P0 et vérifier qu'aucun
   compte légitime ne perd l'accès aux routes de pointage.
3. **Caméras** : exécuter la requête de la section P2.
4. **Proxy** : vérifier que le proxy de production écrase bien l'en-tête `X-Forwarded-For`
   fourni par le client et normalise les barres obliques doublées.
5. **Information** : prévenir OPS, la paie et les pointeurs (rattachement des nuits, reprise de
   poste, message « connexion perdue », blocage d'un compte après des échecs répétés).
6. **Essai** : valider sur un site pilote une nuit complète (arrivée avant et après minuit,
   sortie le matin, clôture) avant la généralisation.
7. **Retour arrière** : la branche ne contient aucune migration ; revenir au commit précédent
   suffit côté code. Les pointages enregistrés entre-temps restent valides mais portent les
   nouvelles valeurs (journée de travail, numéro de vacation dans la journée, nouvelles
   anomalies). Aucun format de donnée n'a changé, donc l'ancien code devrait les lire sans
   erreur ; ce retour arrière n'a toutefois pas été testé.
