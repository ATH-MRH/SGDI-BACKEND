# Sauvegardes chiffrées, restauration d'essai et surveillance

Trois scripts, sans dépendance à l'application :

| Script | Rôle |
|---|---|
| `scripts/backup.sh` | sauvegarde chiffrée de la base et des fichiers |
| `scripts/backup_restore_test.sh` | restauration d'essai dans une base jetable, avec contrôles |
| `scripts/backup_check.sh` | surveillance : dernière sauvegarde présente, récente, intacte |

Le dépôt ne planifie rien et ne connaît aucune destination : la planification
(`scripts/systemd/`) et la copie hors serveur s'activent à la main, après validation.

## 1. Ce qui est sauvegardé

- **PostgreSQL** : `pg_dump` au format custom — une seule transaction, donc cohérent même
  pendant l'exploitation. Le dump est relu (`pg_restore --list`) avant d'être chiffré.
- **Fichiers** : les dossiers listés dans `BACKUP_FILES_DIRS`, c'est-à-dire le dossier monté
  sur `/app/uploads` (photos de fiche et documents). Les motifs de `BACKUP_FILES_EXCLUDE`
  (fichiers temporaires, caches) sont écartés.
- **Relevés de contrôle** : nombre de lignes de chaque table avant et après le dump, nombre de
  tables, de contraintes et d'index, révision Alembic, somme SHA-256 de chaque fichier.

Ne sont **pas** dans la sauvegarde, et doivent être conservés séparément dans le coffre de
secrets : les variables d'environnement de l'application, dont `JWT_SECRET` et
`BIOMETRIC_TEMPLATE_KEY` (sans cette dernière, les gabarits restaurés sont illisibles), et la
clé privée de sauvegarde. Les modèles biométriques sont retéléchargés au build.

## 2. Chiffrement

GnuPG, avant tout stockage durable : le clair n'existe que dans un dossier de travail privé
(`700`), effacé en fin d'exécution, y compris après un échec ou une interruption.

**Mode recommandé — clé publique** (`BACKUP_GPG_RECIPIENT`). Le serveur ne détient que la clé
publique : il peut chiffrer, pas déchiffrer. Une compromission du serveur ne donne pas accès
aux sauvegardes passées.

```bash
# Sur un poste d'administration, PAS sur le serveur :
gpg --quick-generate-key "ATLAS sauvegardes <adresse>" ed25519 cert never
gpg --quick-add-key <empreinte> cv25519 encr never
gpg --armor --export <empreinte> > atlas-backup-public.asc      # à copier sur le serveur
gpg --armor --export-secret-keys <empreinte>                    # → coffre de secrets + copie hors ligne
# Sur le serveur :
gpg --import atlas-backup-public.asc
```

**Mode de repli — phrase secrète** (`BACKUP_PASSPHRASE_FILE`, fichier `600`). La phrase est lue
dans un fichier, jamais passée en argument ni en variable d'environnement. Le serveur peut alors
déchiffrer ses sauvegardes : à réserver aux cas où une clé publique n'est pas possible.

La clé de sauvegarde est **distincte** de `BIOMETRIC_TEMPLATE_KEY` et n'est jamais dans Git ni
dans un journal.

**Perte de la clé privée** : les sauvegardes existantes sont définitivement illisibles. Il faut
donc au moins deux exemplaires de la clé privée, dans deux lieux distincts (coffre de secrets
et support hors ligne scellé), détenus par deux personnes. En cas de perte : générer une
nouvelle paire, remplacer `BACKUP_GPG_RECIPIENT`, lancer aussitôt une sauvegarde et une
restauration d'essai ; les archives antérieures sont à considérer comme perdues.

## 3. Configuration

Fichier privé (`600`, propriétaire root), désigné par `BACKUP_ENV_FILE` ; modèle dans
`scripts/systemd/atlas-backup.env.example`. Les variables sont décrites en tête de chaque script.

Résultat dans `BACKUP_DIR` (`700`) :

```
atlas-backup_20261011T013000Z.tar.gpg          archive chiffrée (600)
atlas-backup_20261011T013000Z.tar.gpg.sha256   somme de contrôle
status/last_run.status                         résultat de la dernière exécution
status/last_success.status                     dernière réussite
status/history.log                             une ligne par exécution
```

## 4. Copie hors serveur

Une sauvegarde qui reste sur le serveur qu'elle protège ne couvre ni sa perte ni sa
compromission. Destination retenue : **OVHcloud Object Storage** (API compatible S3), via
`rclone`. Deux destinations, parce que leurs durées de conservation diffèrent :

| Variable | Contenu | Conservation |
|---|---|---|
| `BACKUP_OFFSITE_RCLONE_DEST` | chaque sauvegarde quotidienne | 30 jours |
| `BACKUP_OFFSITE_MONTHLY_RCLONE_DEST` | la première sauvegarde réussie de chaque mois | 12 mois |

Chaque copie est faite avec `--immutable` (jamais d'écrasement), puis vérifiée (`rclone check`).
Les données ne quittent le serveur que chiffrées.

### Préparation côté OVHcloud (à faire par le titulaire du compte, rien n'est créé par le dépôt)

1. **Région** : de préférence un autre centre de données que celui du serveur, à documenter.
2. **Deux compartiments privés**, créés avec **Object Lock activé** — il ne peut pas l'être
   après coup — et le versionnement :
   - quotidien : rétention par défaut de 30 jours ;
   - mensuel : rétention par défaut de 365 jours.
   Le mode *Governance* laisse un administrateur autorisé lever le verrou ; le mode
   *Compliance* l'interdit à tous, y compris en cas d'erreur : à choisir en connaissance de cause.
3. **Règles de cycle de vie** : expiration après 30 jours (quotidien) et 365 jours (mensuel),
   versions non courantes comprises. Vérifier dans la documentation OVHcloud la disponibilité
   d'Object Lock et du cycle de vie dans la région choisie, et leur comportement combiné.
4. **Deux utilisateurs S3 distincts** :
   - *sauvegarde* (sur le serveur) : `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` sur ces deux
     compartiments seulement ; ni `s3:DeleteObject`, ni `s3:BypassGovernanceRetention`, ni
     gestion du cycle de vie. La lecture est nécessaire à la vérification après copie ; les
     objets lus restent chiffrés avec une clé que le serveur ne détient pas ;
   - *restauration* (hors serveur) : lecture seule.
5. **Identifiants** : saisis directement sur la machine concernée, dans la configuration
   `rclone` (fichier `600`). Jamais dans Git, un ticket, un message ou une conversation.

Configuration `rclone` sur le serveur (`rclone config`, ou fichier équivalent) :

```ini
[atlas-backup]
type = s3
provider = Other
endpoint = https://s3.<région>.io.cloud.ovh.net
region = <région>
access_key_id = <saisi sur le serveur>
secret_access_key = <saisi sur le serveur>
acl = private
```

```bash
BACKUP_OFFSITE_RCLONE_DEST=atlas-backup:<compartiment quotidien>
BACKUP_OFFSITE_MONTHLY_RCLONE_DEST=atlas-backup:<compartiment mensuel>
BACKUP_OFFSITE_REQUIRED=1
```

Contrôles avant la première copie de données réelles :

```bash
rclone lsd atlas-backup:                                      # ne doit lister que les deux compartiments
echo essai > /tmp/essai.txt
rclone copyto /tmp/essai.txt atlas-backup:<quotidien>/essai.txt    # doit réussir
rclone deletefile atlas-backup:<quotidien>/essai.txt               # doit ÉCHOUER (verrou ou droits)
```

Tant que la destination n'est pas validée, laisser les variables vides : la sauvegarde signale
« aucune copie hors serveur configurée » à chaque exécution.

## 5. Rétention

| Emplacement | Règle | Appliquée par |
|---|---|---|
| Serveur | 14 jours (`BACKUP_KEEP_DAYS`), jamais moins de 7 archives (`BACKUP_KEEP_MIN`) | `backup.sh` |
| Hors serveur, quotidien | 30 sauvegardes quotidiennes | cycle de vie et verrou du compartiment |
| Hors serveur, mensuel | 12 sauvegardes mensuelles | cycle de vie et verrou du compartiment |

Le serveur ne supprime jamais rien hors de lui-même : la rétention externe est tenue par le
stockage, ce qui la met hors de portée d'un serveur compromis. Le minimum local protège d'une
purge totale si les sauvegardes cessent de tourner.

Une archive garde les gabarits biométriques et les données d'un employé parti jusqu'à son
expiration (12 mois au plus) : à rapprocher des durées de conservation applicables.

## 6. Planification et surveillance

Modèles dans `scripts/systemd/` (non installés, non activés) : sauvegarde chaque nuit à
01:30 UTC, contrôle à 06:00 UTC, rattrapage au démarrage si le serveur était éteint.

- **Deux sauvegardes simultanées** : impossibles (verrou ; la seconde sort avec le code 75).
- **Échec** : code de retour non nul, `status/last_run.status` à `FAILED` avec l'étape en cause,
  commande d'alerte (`BACKUP_ALERT_COMMAND`). Une archive incomplète n'est jamais laissée.
- **Sauvegarde manquante** : `backup_check.sh`, planifié à part, échoue si la dernière archive a
  plus de 26 heures, est altérée, ou si la dernière exécution a échoué.
- **Serveur muet** : `BACKUP_HEARTBEAT_URL` est appelée après chaque succès ; un service de
  surveillance externe alerte quand le signal manque. C'est le seul contrôle qui fonctionne
  encore si le serveur entier est arrêté.

## 7. Restauration d'essai

Une sauvegarde qui n'a jamais été restaurée n'est pas une sauvegarde.

```bash
RESTORE_REPORT=restauration-<date>.txt bash scripts/backup_restore_test.sh <archive>.tar.gpg
```

Le script crée une base neuve `atlas_restore_test_<date>_<pid>`, refuse de continuer si ce nom
existe, ne restaure jamais dans une base existante et ne supprime que la base qu'il a créée.
Il contrôle la somme de l'archive, celle de chaque élément, le nombre de tables, de contraintes
et d'index, la révision Alembic, le nombre de lignes de chaque table et chaque fichier.

À exécuter **hors du serveur de production**, sur une machine qui détient la clé privée
(poste d'administration ou serveur de recette), à partir de la copie hors serveur : c'est elle
qu'il faut savoir relire le jour d'un sinistre. Fréquence proposée : à la mise en service,
puis chaque mois, et avant toute migration de base.

La restauration réelle après sinistre (base de production recréée, fichiers remis en place,
secrets rechargés depuis le coffre) est une opération distincte, manuelle et décidée par le
responsable ; la restauration d'essai en valide la faisabilité.

## 8. Mise en service

Chaque étape a un critère. S'il n'est pas rempli : **STOP**.

1. **Destination externe** : compartiments, utilisateurs et protections du § 4 créés et relus.
   Critère : les trois contrôles du § 4 donnent le résultat attendu, dont l'échec de la suppression.
2. **Clé de sauvegarde** : paire générée hors serveur, clé privée en deux exemplaires, clé
   publique importée sur le serveur. Critère : `gpg --list-secret-keys` est **vide** sur le
   serveur.
3. **Configuration** : scripts copiés dans `/opt/atlas-backup/scripts`, `/etc/atlas-backup.env`
   en `600`, `rclone` configuré. Critère : `BACKUP_OFFSITE_REQUIRED=1`.
4. **Première sauvegarde**, lancée à la main :
   `BACKUP_ENV_FILE=/etc/atlas-backup.env bash /opt/atlas-backup/scripts/backup.sh`.
   Critère : code 0, « copie hors serveur vérifiée », aucun fichier en clair dans `BACKUP_DIR`.
5. **Restauration de validation**, hors production, depuis la copie externe (§ 7).
   Critère : « RESTAURATION D'ESSAI RÉUSSIE », rapport conservé comme preuve.
6. **Planification** : installer les quatre unités, `systemctl enable --now atlas-backup.timer
   atlas-backup-check.timer`. Critère : `systemctl list-timers` les affiche.
7. **Alertes** : provoquer un échec volontaire (`BACKUP_PG_DB` inexistante, lancement manuel)
   et vérifier que l'alerte arrive ; vérifier que le service de surveillance alerte quand le
   signal de vie manque. Critère : les deux alertes sont reçues par une personne.
8. **Suivi quotidien** : la première semaine, relire chaque matin `status/history.log`.

Critères de STOP à tout moment : une archive lisible sans la clé privée ; un fichier en clair
laissé sur le disque ; une restauration d'essai en échec ; une identité de sauvegarde capable
de supprimer ; une alerte qui n'arrive pas.

## 9. Ce qui a été vérifié, et ce qui ne l'a pas été

Vérifié par `tests/test_backup_scripts.py` sur PostgreSQL jetable et données fictives : cycle
complet en mode clé publique et en mode phrase secrète, refus sans chiffrement, droits des
fichiers, absence de clair résiduel, échec du dump, interruption, verrou, reprise après arrêt
brutal, archive altérée, clé absente, écart de nombre de lignes, rétention, copie externe
quotidienne et mensuelle (avec un `rclone` simulé), mode conteneur (avec un `docker` simulé), surveillance. Le cycle a aussi été déroulé sur le schéma complet de
l'application (130 tables).

Non vérifié : aucune sauvegarde de données réelles, aucune destination externe réelle, les
unités systemd (non installées), le mode conteneur contre un vrai conteneur PostgreSQL, et la
durée sur le volume réel.
