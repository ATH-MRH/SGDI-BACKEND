# PR #10 — décision de mise en production : NO-GO au 2026-10-08

La PR #10 (`fix/pointeur-audit-remediation`) ne doit pas être fusionnée pour l'instant.
Fusionner dans `main` déclenche le déploiement Coolify. Cinq contrôles obligatoires ne sont pas
satisfaits ; ils ne peuvent être faits que par une personne ayant accès à Coolify et à la base
de production.

Ce document sert de fiche de décision : chaque contrôle indique ce qu'il faut faire, la preuve
attendue et son état. Le GO n'est acquis que lorsque les sept lignes sont « fait ».

## État constaté

| Élément | Valeur |
|---|---|
| Production (lecture de `https://pointage.irongs.com/api/version`) | `source_commit` = `6b2aac3`, `version` = `fb3b87b38945` |
| Contrôle du code réellement servi | `version` = début du MD5 de `app/static/sgdi-app.js` sur `origin/main` : concordant |
| `origin/main` | `6b2aac3` |
| PR #10 | ouverte, non fusionnée, 0 commit de retard sur `main`, CI verte (pytest, tests frontend) |
| Migrations de base dans la PR | aucune |

## Contrôles avant GO

| # | Contrôle | État | Qui peut le faire |
|---|---|---|---|
| 1 | Tests backend, frontend, Chrome, PostgreSQL | fait (CI verte ; Chrome et PostgreSQL en local) | — |
| 2 | Sauvegarde de production restaurable | **non fait — bloquant** | accès serveur ou Coolify |
| 3 | Compatibilité des comptes | **non fait — bloquant** | accès base de production (lecture) |
| 4 | Adresses des caméras | **non fait — bloquant** | accès base de production (lecture) |
| 5 | Comportement du proxy | **non fait — bloquant** | accès au proxy de production |
| 6 | Pilote d'une nuit complète sur un site | **non fait — bloquant** | OPS, avec une instance de recette |
| 7 | Retour arrière répété | **non fait** | accès Coolify |

### 2. Sauvegarde restaurable

Une sauvegarde qui n'a pas été restaurée ne compte pas.

```bash
# Sur le serveur, dans le dossier du projet
BACKUP_PASSPHRASE='…' bash scripts/backup.sh
# Restauration d'essai dans une base JETABLE, jamais dans la base de production
mkdir -p /tmp/restore-essai
gpg --batch --passphrase '…' -d backups/sgdi-backup_<date>.tar.gz.gpg | tar xz -C /tmp/restore-essai
createdb atlas_restore_essai && pg_restore --no-owner -d atlas_restore_essai /tmp/restore-essai/db.dump
psql atlas_restore_essai -c "SELECT count(*) FROM attendance_events; SELECT max(occurred_at) FROM attendance_events;"
dropdb atlas_restore_essai
```

Preuve attendue : nom et taille du fichier, heure, nombre d'événements de pointage restaurés
et date du plus récent.

### 3. Compatibilité des comptes (lecture seule)

Comptes actifs à modules explicites qui ne détiennent aucune application de pointage. Après
déploiement, ils recevront un refus sur les routes de pointage du portail.

```sql
SELECT username, role, authorized_modules FROM users
WHERE is_active AND authorized_modules IS NOT NULL
  AND NOT (authorized_modules::jsonb ?| array['pointage','pointeur','ops','drh']);
```

Comptes de terrain qui écrivent aujourd'hui des présences OPS sans le module `ops` ni
`pointage` (ils ne pourront plus) :

```sql
SELECT username, role, authorized_modules FROM users
WHERE is_active AND authorized_modules::jsonb ? 'pointeur'
  AND NOT (authorized_modules::jsonb ?| array['ops','pointage']);
```

Preuve attendue : les deux listes, relues par un responsable OPS. Si un compte légitime y
figure, lui accorder le module voulu est une décision à prendre avant le déploiement : cette PR
ne modifie les permissions d'aucun compte.

### 4. Adresses des caméras (lecture seule)

```sql
SELECT id, name, host FROM cameras
WHERE host ~ '[^A-Za-z0-9.-]' OR host = 'localhost' OR host LIKE '127.%' OR host LIKE '169.254.%';
```

Une caméra listée continue de fonctionner, mais ne pourra plus être modifiée avec cette adresse.

### 5. Proxy

- L'en-tête `X-Forwarded-For` envoyé par un client doit être écrasé par le proxy, pas complété.
  Sinon les compteurs d'échecs par adresse sont contournables.
- Les barres obliques doublées dans un chemin doivent être normalisées ou transmises telles
  quelles ; dans les deux cas l'application refuse désormais l'accès, mais le vérifier en recette.

### 6. Pilote

Sur une instance de recette alimentée par une copie de la base, un site, une nuit :

1. Arrivée de nuit à l'heure, puis sortie le matin.
2. Arrivée de nuit après minuit : la journée de présence doit être celle de la veille.
3. Clôture de la journée d'arrivée pendant la vacation, puis sortie : acceptée, journée
   clôturée inchangée, anomalie `DEPARTURE_AFTER_CLOSURE`.
4. Double scan à la prise de poste, puis « Reprise de poste » avec motif.
5. Coupure réseau pendant un scan : message « connexion perdue ».
6. Un compte pointeur, un compte OPS et un compte DRH vérifient leurs écrans habituels.

Preuve attendue : compte rendu signé par OPS et par la paie.

### 7. Retour arrière

La PR ne contient aucune migration : revenir au commit `6b2aac3` suffit côté code.

1. Dans GitHub : « Revert » de la fusion de la PR #10, puis fusion du revert — ou redéploiement
   du commit `6b2aac3` depuis Coolify.
2. Vérifier `https://pointage.irongs.com/api/version` : `source_commit` et `version`
   (`fb3b87b38945` pour `6b2aac3`).
3. Les pointages enregistrés entre-temps restent valides. Ils portent la journée de travail et
   le numéro de vacation calculés par les nouvelles règles ; l'ancien code devrait les lire sans
   erreur, ce qui reste à constater pendant le pilote.

À répéter une fois en recette avant la mise en production.

## Après un GO

1. Fusionner la PR #10 (déclenche le déploiement).
2. Attendre la fin du build Coolify, puis vérifier `/api/version` : `source_commit` = commit de
   fusion, et `version` = début du MD5 de `app/static/sgdi-app.js` de ce commit. Le
   `source_commit` seul ne prouve pas que le bon code est servi.
3. Recharger un poste : la page doit demander `pointeur-facial.js?v=20261008-audit`.
4. Surveiller pendant la première relève : refus 403 inattendus sur `/api/portal/attendance-*`,
   anomalies `ARRIVAL_AFTER_CLOSURE` et `DEPARTURE_AFTER_CLOSURE`.
