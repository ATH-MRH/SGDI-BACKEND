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

## Risques résiduels (mis à jour à chaque priorité)

- Documents de `photos/docs/` sans ligne `Document` : servis sans authentification, sous un nom
  prévisible. Les fermer casserait les pièces jointes du portail client ; à traiter avec ce module.
- La permission fine `qr_scanning` n'est toujours lue par aucune route (voir P2).
- Le comportement du proxy de production (normalisation des chemins, en-tête
  `X-Forwarded-For`) n'a pas pu être vérifié depuis le dépôt.
