# IRON Emploi — mise en production

Procédure pour mettre en service le serveur (PR 12) puis l'application (PR 13). Elle ne contient
aucun secret : les valeurs restent dans le panneau de l'hébergeur.

## 1. Ce que change la mise en production

- **Serveur** : nouvelles routes `/api/public/emploi/…` et `/api/drh/job-offers/…`, section
  « Traitement IRON Emploi » dans recrute.irongs.com.
- **Base** : deux révisions Alembic à la suite de `20261013_0002` — `20261014_0001` (annonces,
  espaces candidats, candidatures) puis `20261014_0002` (traitement des candidatures). Elles ne
  créent que des tables et des colonnes ; aucune table existante n'est vidée ni réécrite.
  `start.sh` les applique au démarrage (`alembic upgrade head`).
- **Pièces jointes** : CV, photos de profil et pièces de candidature d'IRON Emploi sont enregistrés
  **dans la base PostgreSQL**. Le volume `sgdi_uploads` continue de porter les fichiers des autres
  modules. Une sauvegarde complète couvre donc la base **et** ce volume.
- **Variables** : aucune nouvelle variable obligatoire. `RECRUITMENT_PUSH_ENABLED` reste absente ou
  à `false`. Les réglages SMSGate ne changent pas.

## 2. Conditions préalables

1. PR 12 et PR 13 à jour avec `main`, CI verte.
2. `GET https://recrute.irongs.com/api/public/mobile/config` répond `"sms_available": true` :
   l'identification des candidats dépend de SMSGate.
3. Une sauvegarde datée du jour, **vérifiée** (voir § 3).
4. Une fenêtre calme : le démarrage applique les migrations avant d'accepter le trafic.

## 3. Sauvegarde avant fusion

Sur le serveur, dans le dossier du projet (phrase de chiffrement fournie par l'environnement,
jamais écrite dans un fichier versionné) :

```sh
BACKUP_PASSPHRASE=… bash scripts/backup.sh
```

Le script produit `sgdi-backup_<date>.tar.gz.gpg` : export PostgreSQL (`pg_dump -Fc`) et archive
du volume `sgdi_uploads`, chiffrés. Avant de continuer :

- vérifier que le fichier existe, que sa taille est cohérente avec la veille ;
- le copier hors du serveur ;
- noter la révision en place : `select version_num from alembic_version;` doit donner
  `20261013_0002`.

Si la production tourne sous Coolify sans ce dossier de projet, utiliser la sauvegarde PostgreSQL
de Coolify (ou un `pg_dump -Fc` dans le conteneur de la base) et une archive du volume des
fichiers : l'important est d'avoir les deux, datés, hors du serveur.

## 4. Ordre des opérations

1. Sauvegarde (§ 3).
2. Fusionner la **PR 12** dans `main`. Le déploiement automatique démarre.
3. Attendre le déploiement, puis vérifier que le code servi est le bon :
   `GET https://pointage.irongs.com/api/version` — `source_commit` égal au commit de fusion.
4. Vérifier la base : `alembic_version` vaut `20261014_0002`.
5. Contrôles en lecture :
   - `GET https://recrute.irongs.com/api/public/emploi/config` → 200 ;
   - `GET https://recrute.irongs.com/api/public/emploi/offers` → liste vide ;
   - recrute.irongs.com → « Traitement IRON Emploi » s'ouvre ; les sections existantes
     (Candidatures, Entretiens, Annonces) fonctionnent comme avant.
6. Saisir les contenus réels : présentation des sociétés, une première annonce **en brouillon**,
   relecture, publication.
7. Essai réel de bout en bout avec un numéro du personnel : identification par SMS, candidature
   avec CV, dossier visible côté recruteur, message, convocation. Retirer ensuite cette candidature
   d'essai.
8. Fusionner la **PR 13** (code de l'application ; elle ne change pas le serveur).
9. Construire l'application (§ 6), l'essayer sur un iPhone et un Android contre la production,
   puis la soumettre aux stores.

L'application déjà distribuée continue de fonctionner pendant toute l'opération : les routes
qu'elle utilise ne changent pas.

## 5. Retour arrière

**Avant toute saisie réelle** (étapes 2 à 5) — retour complet :

1. Avec le code de la PR 12 encore en place, ramener le schéma :
   `python3 -m alembic downgrade 20261013_0002` dans le conteneur applicatif. Les tables IRON
   Emploi sont supprimées ; rien d'autre n'est touché.
2. Annuler le commit de fusion sur `main` (`git revert -m 1 <commit de fusion>`), ce qui redéploie
   le code précédent.

L'ordre compte : redéployer l'ancien code sur une base restée en `20261014_0002` empêche le
démarrage (« Can't locate revision »).

**Après des saisies réelles** (annonces publiées, candidatures reçues) — ne pas descendre le
schéma, cela effacerait ces données. Préférer :

- dépublier les annonces (les candidats ne peuvent plus postuler) ;
- corriger par un nouveau commit ;
- en dernier recours seulement, restaurer la sauvegarde du § 3, en acceptant de perdre ce qui a
  été saisi depuis dans **tous** les modules.

**Application** : une version publiée ne se retire pas des téléphones. Le retour arrière consiste
à dépublier les annonces côté serveur ; l'application affiche alors une liste vide et reste
utilisable pour la candidature spontanée.

## 6. Application : configuration pour le serveur réel

- Sans réglage, l'application appelle `https://recrute.irongs.com/api`. Une adresse sans HTTPS
  n'est acceptée qu'en développement : une version construite pour les stores l'ignore.
- Ne pas définir `EXPO_PUBLIC_API_URL` pour les profils `preview` et `production`.
- `scripts/test-env/` (base locale, passerelle SMS fictive) ne sert qu'aux essais sur le poste de
  développement et n'est pas embarqué dans l'application.
- Avant la première construction : `npx eas-cli@latest init` avec le compte Expo de l'éditeur
  (crée `extra.eas.projectId`), puis `eas build --profile production` pour chaque plateforme.

## 7. Limites à la mise en service

- **Notifications push** : préparées, non activées, jamais essayées en réel. Il manque le projet
  EAS, la clé FCM V1 et `google-services.json` (Android), la clé APNs (iOS), puis
  `RECRUITMENT_PUSH_ENABLED=true`. Les notifications dans l'application fonctionnent.
- **Aperçu Word du contrat** : demande un modèle de contrat validé par la DRH.
- **Convocation par e-mail** : dépend du canal `CONVOCATION_SMTP_*` déjà configuré.
- **Illustrations** : images générées par IA ; droits à faire valider par l'éditeur avant
  publication sur les stores.
