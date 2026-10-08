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

## Risques résiduels (mis à jour à chaque priorité)

- Documents de `photos/docs/` sans ligne `Document` : servis sans authentification, sous un nom
  prévisible. Les fermer casserait les pièces jointes du portail client ; à traiter avec ce module.
- La permission fine `qr_scanning` n'est toujours lue par aucune route (voir P2).
- Le comportement du proxy de production (normalisation des chemins, en-tête
  `X-Forwarded-For`) n'a pas pu être vérifié depuis le dépôt.
