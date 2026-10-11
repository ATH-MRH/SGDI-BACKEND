# IRON Emploi — mise en production

Procédure pour mettre en service le serveur (PR 12) puis l'application (PR 13). Elle ne contient
aucun secret : les valeurs restent dans le panneau de l'hébergeur.

État vérifié le 11 octobre 2026 : la production sert le commit `ad76687d` de `main`, dont la tête
Alembic est `20261013_0002`.

## 1. Ce que change la mise en production

- **Serveur** : nouvelles routes `/api/public/emploi/…` et `/api/drh/job-offers/…`, section
  « Traitement IRON Emploi » dans recrute.irongs.com.
- **Variables** : aucune nouvelle variable obligatoire. `RECRUITMENT_PUSH_ENABLED` reste absente ou
  à `false`. Les réglages SMSGate ne changent pas.
- **Pièces jointes** : CV, photos de profil et pièces de candidature d'IRON Emploi sont enregistrés
  **dans la base PostgreSQL** (texte en base64). Les photos et documents des autres modules restent
  dans le dossier des fichiers monté sous `/app/uploads/photos`. Une sauvegarde complète couvre donc
  la base **et** ce dossier.

### Migrations attendues

`start.sh` exécute `alembic upgrade head` à chaque démarrage. En partant de `20261013_0002`, la
fusion de la PR 12 applique quatre révisions, dans cet ordre :

| Révision | Effet |
| --- | --- |
| `20261014_0001` | Crée 5 tables : `recruitment_companies`, `recruitment_job_offers`, `recruitment_candidate_accounts`, `recruitment_candidate_sessions`, `recruitment_applications`. |
| `20261014_0002` | Crée 11 tables (`recruitment_messages`, `recruitment_interviews`, `recruitment_job_alerts`, `recruitment_notifications`, `recruitment_push_devices`, `recruitment_application_documents`, `recruitment_document_requests`, `recruitment_application_notes`, `recruitment_application_events`, `recruitment_application_contracts`, `recruitment_tips`) et ajoute des colonnes aux tables créées par la révision précédente. |
| `20261015_0001` | Ajoute `salary_amount` et `salary_period` à `recruitment_job_offers`. |
| `20261016_0001` | Ajoute `last_activity_at` et son index à `recruitment_candidate_accounts`, et y reporte la dernière date connue des espaces existants. |

Soit 16 tables nouvelles (129 → 145 sur une base à jour) et **aucune modification d'une table
existante**. Les quatre révisions sont rejouables : elles ne créent que ce qui manque.

La PR 13 ne contient aucune migration : elle n'ajoute que `mobile/recruitment/` et une tâche de CI.

## 2. Conditions préalables

1. PR 12 à jour avec `main`, CI verte.
2. PR 13 remise à jour avec `main` **après** la fusion de la PR 12, CI verte.
3. `GET https://recrute.irongs.com/api/public/mobile/config` répond `"sms_available": true` :
   l'identification des candidats dépend de SMSGate.
4. Une sauvegarde datée du jour, **vérifiée et copiée hors du serveur** (§ 3).
5. Les deux informations encore attendues au § 8 fournies et la notice relue par un juriste, si la
   mise en service s'adresse à de vrais candidats.
6. Une fenêtre calme : le démarrage applique les migrations avant d'accepter le trafic.

## 3. Sauvegarde avant fusion

La production tourne sous Coolify : PostgreSQL est un conteneur distinct de l'application, et les
fichiers sont un dossier de l'hôte monté dans l'application. `scripts/backup.sh` (docker compose,
volume `sgdi_uploads`) ne s'y applique pas ; utiliser `scripts/backup-coolify.sh`.

1. **Repérer les deux cibles** sur le serveur, sans afficher de variables d'environnement :
   - le conteneur PostgreSQL : c'est l'hôte de `DATABASE_URL` de l'application ;
   - le dossier des fichiers : la source du montage `/app/uploads/photos`, lue par
     `docker inspect <conteneur_application> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'`.
2. **Lancer la sauvegarde**, depuis le poste de travail (le script est envoyé par SSH, rien n'est
   installé sur le serveur) :

   ```sh
   ssh <serveur> 'bash -s -- <conteneur_postgres> <dossier_fichiers>' < scripts/backup-coolify.sh
   ```

   Le script écrit dans `/root/backups/atlas/<date>/` : `db.dump` (`pg_dump -Fc`),
   `files.tar.gz`, `INVENTAIRE.txt` et `SHA256SUMS`. Il ne modifie ni la base ni les fichiers, et
   s'arrête en erreur si l'export ne contient pas toutes les tables de la base ou si l'archive ne
   contient pas tous les fichiers.
3. **Contrôler l'inventaire** affiché : `alembic_version=20261013_0002`, nombre de tables et de
   fichiers cohérent.
4. **Copier hors du serveur** puis recontrôler les empreintes sur la copie :

   ```sh
   scp -r <serveur>:/root/backups/atlas/<date> <dossier_local>/
   cd <dossier_local>/<date> && shasum -a 256 -c SHA256SUMS
   ```

5. **Essayer la restauration** de la copie dans une base PostgreSQL 17 neuve, hors production :

   ```sh
   createdb atlas_verif_<date>
   pg_restore --no-owner -d atlas_verif_<date> db.dump
   psql -d atlas_verif_<date> -Atc "select version_num from alembic_version"
   ```

   Une sauvegarde qui n'a pas été restaurée au moins une fois n'est pas considérée comme vérifiée.

La sauvegarde contient des données personnelles en clair : la conserver sur un support chiffré, et
supprimer la copie du serveur une fois la mise en production validée.

## 4. Ordre des opérations

1. Sauvegarde (§ 3).
2. Fusionner la **PR 12** dans `main`. Le déploiement automatique démarre.
3. Contrôles après déploiement (§ 5).
4. Saisir les contenus réels : présentation des sociétés, une première annonce **en brouillon**,
   relecture, publication.
5. Essai réel de bout en bout avec un numéro du personnel : identification par SMS, candidature
   avec CV, dossier visible côté recruteur, message, convocation. Retirer ensuite cette candidature
   d'essai.
6. Mettre la **PR 13** à jour avec `main`, attendre la CI, la fusionner (code de l'application ;
   elle ne change pas le serveur).
7. Construire l'application (§ 7), l'essayer sur un iPhone et un Android contre la production,
   puis la soumettre aux stores.

L'application déjà distribuée continue de fonctionner pendant toute l'opération : les routes
qu'elle utilise ne changent pas.

## 5. Contrôles après déploiement

Tous en lecture, depuis n'importe quel poste.

1. **Code servi** : `GET https://pointage.irongs.com/api/version` — `source_commit` égal au commit
   de fusion **et** `version` égal aux 12 premiers caractères de
   `git show <commit>:app/static/sgdi-app.js | md5`. `source_commit` seul ne prouve pas que l'image
   a été reconstruite.
2. **Démarrage** : `GET https://pointage.irongs.com/health` → 200. Si l'application ne démarre
   pas, lire le journal de déploiement dans Coolify avant toute autre action : une migration en
   échec arrête le conteneur avant qu'il n'accepte le trafic.
3. **Base** : `alembic_version` vaut `20261016_0001`.
4. **Nouvelles routes** :
   - `GET https://recrute.irongs.com/api/public/emploi/config` → 200 (404 avant la fusion) ;
   - `GET https://recrute.irongs.com/api/public/emploi/offers` → liste vide.
5. **Non-régression** :
   - `GET https://recrute.irongs.com/api/public/mobile/config` → `"sms_available": true` ;
   - recrute.irongs.com : connexion, Candidatures, Entretiens et Annonces comme avant ;
     « Traitement IRON Emploi » s'ouvre ;
   - drh, ops et pointage : connexion et une page de liste chacune ;
   - une photo d'employé s'affiche (le dossier des fichiers est toujours monté).

## 6. Retour arrière

Redéployer l'ancien code sans précaution **empêche le démarrage** : il ne connaît pas
`20261016_0001` (« Can't locate revision »). Il faut d'abord ramener `alembic_version`. Deux
méthodes, essayées toutes deux sur une base PostgreSQL 17 locale.

### A. Retour arrière qui conserve les données (à préférer)

1. Avec le code de la PR 12 encore en place, dans le conteneur applicatif :
   `python3 -m alembic stamp 20261013_0002`. Seul le numéro de version change ; les tables IRON
   Emploi et leur contenu restent en place.
2. Annuler le commit de fusion sur `main` (`git revert -m 1 <commit de fusion>`), ce qui redéploie
   le code précédent. Il démarre normalement et ignore les tables IRON Emploi.
3. Une fois le correctif prêt, le redéployer : `alembic upgrade head` rejoue les quatre révisions
   sans rien recréer ni effacer, et les annonces et candidatures déjà saisies sont retrouvées.

Pendant l'intervalle, l'application mobile IRON Emploi reçoit des erreurs sur les routes
`/api/public/emploi/…` ; la candidature spontanée continue de fonctionner.

### B. Retour complet (uniquement avant toute saisie réelle)

`python3 -m alembic downgrade 20261013_0002` avec le code de la PR 12, puis le `git revert`. Les
16 tables IRON Emploi sont **supprimées avec leur contenu** ; rien d'autre n'est touché.

### Sans retour arrière du code

Si le défaut ne touche qu'IRON Emploi, dépublier les annonces suffit (les candidats ne peuvent plus
postuler) et la correction passe par un nouveau commit.

### En dernier recours

Restaurer la sauvegarde du § 3 ramène **tous** les modules à l'heure de la sauvegarde : tout ce qui
a été saisi depuis (pointage, DRH, candidatures) est perdu. À ne décider qu'en cas de base
endommagée.

### Application

Une version publiée ne se retire pas des téléphones. Le retour arrière consiste à dépublier les
annonces côté serveur ; l'application affiche alors une liste vide et reste utilisable pour la
candidature spontanée.

## 7. Application : construction iOS et Android

L'application est dans `mobile/recruitment/` (Expo SDK 57, version 2.0.0, identifiant
`com.irongs.recruitment` sur les deux plateformes).

**Avant la première construction**

1. Comptes : compte Expo de l'éditeur, compte Apple Developer, compte Google Play Console. Si une
   version est déjà publiée sous `com.irongs.recruitment`, utiliser **les mêmes comptes et la même
   clé de signature Android** : sinon les stores refusent la mise à jour.
2. `npx eas-cli@latest login`, puis `npx eas-cli@latest init` dans `mobile/recruitment/` : crée
   `extra.eas.projectId` dans `app.json` (ce n'est pas un secret, à commiter).
3. Ne **pas** définir `EXPO_PUBLIC_API_URL` pour les profils `preview` et `production` : sans
   réglage, l'application appelle `https://recrute.irongs.com/api`, et une adresse sans HTTPS est
   ignorée hors développement.

**Version d'essai interne** (profil `preview`)

```sh
npx eas-cli@latest build --platform android --profile preview   # APK à installer directement
npx eas-cli@latest build --platform ios --profile preview       # iPhone enregistré par « eas device:create »
```

L'installer sur un iPhone et un Android, et refaire le parcours complet contre la production :
identification par SMS, consultation des annonces, candidature avec CV, suivi, déconnexion.

**Version des stores** (profil `production`, numéro de construction incrémenté par EAS)

```sh
npx eas-cli@latest build --platform android --profile production   # AAB
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform android
npx eas-cli@latest submit --platform ios
```

Passer par une diffusion restreinte (test interne Google Play, TestFlight) avant la publication.
Les fiches des stores demandent l'adresse d'une politique de confidentialité : elle dépend du § 8.

`scripts/test-env/` (base locale, passerelle SMS fictive) ne sert qu'aux essais sur le poste de
développement et n'est pas embarqué dans l'application.

## 8. Protection des données : informations à fournir par la direction

L'application demande un consentement au traitement des données (case non cochée par défaut) et le
serveur l'enregistre avec sa date et la version de la notice (`PRIVACY_NOTICE_VERSION`, à changer en
même temps que `PRIVACY_VERSION` dans l'application dès que le fond de la notice change). La notice
cite la loi n° 18-07 du 10 juin 2018, modifiée et complétée par la loi n° 25-11 du 24 juillet 2025,
et l'ANPDP. Elle ne présente l'application ni comme agréée ni comme validée par l'ANPDP.

### Informations confirmées par la direction (11 octobre 2026), portées dans la notice version `2026-10-11`

| Rubrique | Contenu de la notice |
| --- | --- |
| Responsable du traitement | SARL IRON GLOBAL SOLUTION, 76 Ahmed Sayeh, Les Sources, Bir Mourad Raïs — contact@irongs.com — +213 770 112 034 |
| Déléguée à la protection des données | Narimane ZOUBIR — bdm@irongs.com — +213 770 112 034 |
| Formalité ANPDP | La direction déclare qu'elle couvre les dossiers de recrutement. **Référence et date : à fournir** |
| Hébergement | OVHcloud, serveur situé en France (voir ci-dessous). **Fondement du transfert hors d'Algérie : à fournir** |
| Durées de conservation | Candidature non retenue : 24 mois à compter du refus. Espace inactif : 24 mois après la dernière activité. Dossier numérique d'une personne recrutée : 24 mois après son départ ; dossier papier : 10 ans après son départ |
| Exercice des droits | contact@irongs.com, à l'attention de la déléguée. Aucun délai de réponse n'est annoncé : il n'a pas été fourni |

La notice affiche encore deux rubriques « à préciser » (référence et date de la formalité ANPDP,
fondement du transfert). `npm test` échoue si cette liste change sans que le test soit mis à jour.

### Prestataires qui traitent les données

Constat du 11 octobre 2026, par lecture du code, du DNS et des registres d'adresses.

| Prestataire | Rôle | Localisation constatée | Dans la notice |
| --- | --- | --- | --- |
| OVHcloud | Serveur : application, base PostgreSQL, fichiers, SMSGate | Adresse du serveur enregistrée au nom d'OVH SAS, pays FR ; trafic acheminé par les centres OVH de France. À confirmer dans l'espace client OVH (centre exact) | Oui |
| o2switch | Messagerie du domaine irongs.com : e-mails de convocation, boîte contact@irongs.com | France | Oui |
| Opérateur mobile de la SIM de l'entreprise | Remise des SMS de vérification | Algérie ; nom de l'opérateur à fournir | Oui, sans le nommer |
| Service public SMSGate (`api.sms-gate.app`) | Réveil du téléphone passerelle par notification | Hors d'Algérie. Ne reçoit **aucune donnée de candidat** (voir ci-dessous) | Non : pas de donnée de candidat transmise ; à faire confirmer par le juriste |
| Expo, Google (FCM), Apple (APNs) | Notifications push | Hors d'Algérie. **Non activé** : aucune donnée transmise aujourd'hui | Non ; à ajouter avant toute activation |
| Apple App Store, Google Play | Distribution de l'application | Ne reçoivent pas les données de candidature | Non |

L'application n'embarque ni mesure d'audience ni outil de suivi tiers. Les sauvegardes (§ 3) sont
des copies des mêmes données : leur lieu de conservation relève de la même notice.

### Ce qui passe par `api.sms-gate.app`

Constat fait dans le code source public de SMSGate, version 1.49.0 (celle du serveur privé), sans
toucher à l'installation. Quand un code est déposé, le serveur privé envoie au relais public une
requête qui contient : le jeton de notification **du téléphone passerelle de l'entreprise** et le
type d'événement « message en file », sans autre donnée. Le relais la transmet au service de
notification de Google, qui réveille le téléphone ; celui-ci vient alors chercher le SMS sur le
serveur privé. Le numéro du candidat, son nom et le texte du SMS ne quittent donc pas le serveur
privé par cette voie ; ils ne vont qu'au téléphone passerelle, puis à l'opérateur mobile.

Ce constat vaut pour le mode privé décrit dans `docs/recruitment-smsgate.md`. Le relais voit
l'adresse du serveur et la fréquence des envois. SMSGate conserve par ailleurs les messages
(numéro et texte) dans sa propre base, sur le même serveur : leur durée de conservation dans
SMSGate reste à fixer.

### Durées annoncées et suppression réellement en place

Les durées de la notice sont des **engagements de la direction**. Le serveur ne supprime
automatiquement aucune candidature ni aucun espace candidat.

| Donnée | Durée annoncée | Ce que fait le serveur aujourd'hui |
| --- | --- | --- |
| Candidature non retenue | 24 mois à compter du refus | Aucune suppression automatique. La date du refus est connue (`outcome_communicated_at`, `status_updated_at`) |
| Espace candidat inactif | 24 mois après la dernière activité | Aucune suppression automatique. La dernière activité est enregistrée (`last_activity_at`, à un jour près) à chaque utilisation de l'espace |
| Dossier numérique d'une personne recrutée | 24 mois après son départ | Aucune suppression automatique. La date de départ relève du module DRH |
| Dossier papier d'une personne recrutée | 10 ans après son départ | Hors application |
| Session de l'espace candidat | — | Expire après 30 jours, puis supprimée |
| Code SMS de vérification | — | Valable 5 minutes, ligne supprimée après 24 heures |
| Suppression de l'espace par le candidat | Immédiate | Efface profil, CV, photo, alertes et notifications ; les candidatures transmises restent au service recrutement, sans lien avec l'espace |

**Aperçu des échéances.** `GET /api/drh/recruitment-retention` (administrateur ou recruteur à
périmètre global ; `?as_of=AAAA-MM-JJ` pour simuler une date) liste, sans rien modifier : les
candidatures refusées, les dossiers du vivier refusés, les espaces inactifs et les dossiers des
personnes recrutées puis parties qui ont dépassé 24 mois, avec pour chacun ce qu'une suppression
retirerait (pièces, messages, entretiens, notes, CV, photo…) et ce qui serait conservé. Les
dossiers sans date exploitable (avis défavorable non daté, départ non daté) sont listés à part,
à dater à la main. Aucune route de suppression n'existe : l'aperçu sert à décider.

Tant qu'une purge n'est pas développée, le respect des durées repose sur une suppression manuelle
par le service recrutement et la DRH, à organiser (qui, à quelle fréquence, avec quelle trace). Les
dossiers du vivier antérieurs à IRON Emploi sont concernés dès la mise en service : certains peuvent
déjà dépasser 24 mois.

### Points à faire valider par un juriste

1. Référence, date et périmètre exact de la formalité ANPDP : couvre-t-elle l'application mobile
   et l'hébergement hors d'Algérie ?
2. Fondement et formalités du transfert de données vers la France.
3. Qualité de la SARL IRON GLOBAL SOLUTION vis-à-vis des autres sociétés du groupe qui publient
   des annonces et accèdent aux dossiers.
4. Durées de conservation, en particulier celle du dossier d'une personne recrutée au regard des
   obligations de l'employeur.
5. Délai de réponse aux demandes d'exercice des droits, à annoncer ou non.
6. Texte du consentement et de la notice dans leur ensemble.

## 9. Limites à la mise en service

- **Notice de protection des données** : deux rubriques restent à fournir (référence ANPDP, fondement du
  transfert) et le texte n'a pas été relu par un juriste (§ 8).
- **Durées de conservation** : annoncées dans la notice, sans suppression automatique côté serveur (§ 8).
- **Police sur Android** : Arimo, et non Arial, faute de licence d'intégration (voir `mobile/recruitment/assets/fonts/LISEZ-MOI.md`).
- **Notifications push** : préparées, non activées, jamais essayées en réel. Il manque le projet
  EAS, la clé FCM V1 et `google-services.json` (Android), la clé APNs (iOS), puis
  `RECRUITMENT_PUSH_ENABLED=true`. Les notifications dans l'application fonctionnent.
- **Aperçu Word du contrat** : demande un modèle de contrat validé par la DRH.
- **Convocation par e-mail** : dépend du canal `CONVOCATION_SMTP_*` déjà configuré.
- **Illustrations** : images générées par IA ; droits à faire valider par l'éditeur avant
  publication sur les stores.
