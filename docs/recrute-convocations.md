# Convocations à un entretien avec QR code (recrute.irongs.com ↔ IRON Emploi)

## Parcours

1. **Convocation.** Le recruteur convoque le candidat depuis le dossier de la candidature (onglet « Convocations et entretiens »). Il peut enregistrer un brouillon, sans prévenir personne, ou envoyer directement.
2. **Réception.** Le candidat reçoit la convocation dans son espace IRON Emploi, rubrique « Mes convocations » (Profil). Il la consulte, confirme sa présence et l'enregistre en PDF.
3. **Jour de l'entretien.** Il présente le PDF ou son téléphone. Le recruteur clique sur « Scanner une convocation » (Candidatures, Entretiens ou le dossier). Il peut utiliser la caméra, importer une image ou saisir la référence imprimée.
4. **Ouverture du dossier.** La candidature concernée s'ouvre sur le bon entretien, avec un résumé d'accueil.
5. **Arrivée et compte rendu.** Le recruteur confirme explicitement l'arrivée du candidat, puis remplit le compte rendu (grille d'entretien du vivier).

Le scan n'enregistre rien d'autre qu'une ligne d'audit. Ni présence, ni début d'entretien, ni décision, ni contrat, ni transfert DRH ne découlent d'un scan ou d'une arrivée.

## Modèle : l'entretien existant, sans second système

La convocation **est** l'entretien de la candidature (`recruitment_interviews`) :

- **Brouillon :** état `draft`, jamais visible du candidat, jamais notifié.
- **Champs ajoutés :** société qui convoque (candidature spontanée), adresse, lien cartographique (`https://`), coordonnées professionnelles, objet et pièces à apporter. Les consignes restent dans `note`.
- **Suivis distincts :**
  - la lecture : `viewed_version` ;
  - la réponse du candidat : `confirmed_at` ;
  - l'arrivée constatée : `arrived_at` / `arrived_by` ;
  - le résultat : `status` réalisé / absent, avec `report`, `appreciation` et `assessment`.
- **Grille (`assessment`) :** les huit critères de la fiche « Entretien du candidat » du vivier, notés de 0 à 10 et tous facultatifs. Elle est interne et ne fixe aucune décision.

`recruitment_convocation_versions` garde une ligne par envoi : le contenu imprimé figé, l'identifiant aléatoire du QR, la date d'émission et l'auteur. Un premier envoi, un report ou une modification du contenu imprimé crée une version. La précédente devient « remplacée ».

États affichés au candidat : nouvelle, consultée, présence confirmée, reportée, annulée, entretien réalisé, absence constatée. Ce n'est qu'un affichage : les données restent séparées. Personne n'est déclaré absent automatiquement quand l'heure est passée.

## QR code

- **Contenu :** `https://<origine publique>/#convocation=<32 caractères aléatoires>`.
  - L'origine vient de `RECRUITMENT_PUBLIC_ORIGIN` (`https://recrute.irongs.com` par défaut, `https` obligatoire, sans chemin), jamais de l'en-tête `Host`.
  - Le QR ne contient aucun identifiant interne et aucune donnée personnelle.
- **Pas d'accès sans session :** le QR ne donne accès à rien. Il désigne une version qu'un recruteur connecté et dans son périmètre peut ouvrir. Ce n'est ni un jeton de session, ni un lien public vers une pièce.
- **Rien dans les journaux :** l'identifiant est dans le fragment (après `#`), que le navigateur n'envoie jamais au serveur. La page le retire de l'adresse, le garde le temps de la connexion (`sessionStorage`, cet onglet seulement), puis l'envoie dans le **corps** de `POST /api/drh/job-offers/convocations/resolve`. L'audit enregistre la version, jamais l'identifiant.
- **Aucune redirection :** une adresse lue n'est jamais suivie. Seule une adresse https de l'origine configurée est acceptée.
- **Génération locale :** le QR est généré localement (reportlab, comme les badges). Les tests le relisent avec un vrai décodeur (zxing-cpp) sur le rendu du PDF.

États au scan : en vigueur, ancienne version (« ne validez pas l'ancienne date »), document à réémettre (date ou lieu modifiés sans nouvelle version), annulée, entretien clos, date dépassée. Les autres cas reçoivent un message distinct : QR invalide (422), inconnu (404), accès refusé hors périmètre (403, sans aucune identité) et connexion requise (401).

## Document PDF

- **Format :** A4, texte réel sélectionnable. La police est Helvetica, ou DejaVu Sans embarquée pour l'arabe et les autres alphabets, mis en forme localement.
- **QR :** vectoriel, dessiné module par module.
- **Pagination :** « page x / y ».
- **Logo :** seulement si la société a un logo réel enregistré. Aucune signature, aucun cachet, aucune donnée inutile (NIN, salaire, notes internes, décision).
- **Caractères non imprimables :** l'envoi est refusé et ces caractères sont nommés. Aucun carré illisible n'est produit silencieusement.
- **Accès :** le recruteur télécharge toutes les versions et l'aperçu du brouillon (sans QR). Le candidat télécharge la version en vigueur. Une convocation annulée n'a pas de document candidat.

## Application IRON Emploi

- **Accès :** « Profil → Mes convocations » (ex-« Mes entretiens »). Toucher une notification de convocation ouvre la convocation concernée.
- **Détail :**
  - les informations pratiques et un grand QR dessiné par l'application ;
  - « Confirmer ma présence » et « Enregistrer la convocation » (PDF dans l'espace privé de l'application, puis « Ouvrir ou partager ») ;
  - l'itinéraire et les échanges avec le recrutement ;
  - un bandeau de report ou d'annulation.
- **Hors connexion :** la dernière version enregistrée s'affiche avec « actualité non vérifiée ». Les copies internes sont effacées à la déconnexion volontaire. Un PDF déjà partagé hors de l'application ne peut pas être rappelé : son QR signale au recruteur qu'il est obsolète.

## API

Recruteur (`/api/drh/job-offers`, périmètre société côté serveur) :

| Route | Effet |
|---|---|
| `POST /applications/{id}/interviews` | Créer : `mode` `draft` ou `send` (défaut), `request_id` d'idempotence. |
| `PUT /interviews/{id}` | Modifier un brouillon (silencieux) ou une convocation envoyée (nouvelle version, candidat prévenu). |
| `POST /interviews/{id}/send` | Envoyer un brouillon, ou émettre le document d'un entretien antérieur. Rejouable sans effet. |
| `POST /interviews/{id}/cancel` | Annuler (candidat prévenu, versions annulées), ou supprimer un brouillon. |
| `GET /interviews/{id}/convocation?version=n` | PDF d'une version, ou aperçu du brouillon. |
| `POST /convocations/resolve` | Lire un QR ou une référence. Classé consultation (`read`), audité. |
| `POST /interviews/{id}/arrival` | Confirmer l'arrivée sur la version en vigueur, le jour même. Idempotent et audité. |
| `POST /interviews/{id}/outcome` | Compte rendu, inchangé : jamais avant l'heure, jamais « absent » après une arrivée. Ajoute `scores`. |

Candidat (`/api/public/emploi`, session de l'espace) :

- `GET /interviews` (brouillons exclus) ;
- `GET /interviews/{id}` (avec la matrice du QR) ;
- `POST /interviews/{id}/viewed` ;
- `POST /interviews/{id}/confirm` ;
- `GET /interviews/{id}/convocation` (PDF).

Une convocation d'un autre espace répond comme introuvable.

## Notifications

- **Canal :** la file persistante existante, avec ses reprises et le traitement des appareils désinscrits. Seuls les téléphones du candidat concerné sont visés, selon la préférence « Entretiens ».
- **Une seule notification par envoi :** l'état « Entretien » de la candidature change sans seconde notification.
- **Texte d'écran verrouillé :** « Convocation à un entretien », « Convocation reportée », « Convocation modifiée » ou « Entretien annulé », suivi de « Ouvrez IRON Emploi… ». Ni lieu, ni heure, ni société.
- **Push en échec :** la convocation reste envoyée et visible dans l'application.
- **Ce que prouve un reçu :** un reçu Expo / FCM accepté n'est pas une preuve de réception sur le téléphone.

Aucun SMS ni e-mail n'est envoyé sans demande. L'e-mail reste le canal existant, sur case à cocher. SMSGate n'est pas modifié.

## Conservation et suppression

Supprimer un espace candidat ne supprime ni candidature ni convocation : elles restent au service recrutement.

L'aperçu de conservation compte :

- les versions de convocation d'une candidature refusée arrivée à échéance ;
- les convocations envoyées des candidatures conservées d'un espace inactif.

Aucune purge n'est lancée. La validation ANPDP de la notice reste à obtenir.

## Migration `20261017_0002` (après `20261016_0002`)

- **Montée :** additive et rejouable. Elle ajoute des colonnes facultatives à `recruitment_interviews`, l'unicité `(application_id, request_id)` et la table `recruitment_convocation_versions`. Les entretiens existants restent inchangés, en version 0 (sans QR).
- **Descente d'une révision :** elle supprime **uniquement les brouillons** (jamais envoyés, jamais vus), car le code précédent les montrerait au candidat. Colonnes, versions, arrivées et grilles sont conservées ; le code précédent les ignore.
- **Descente complète :** sous `20261014_0003`, elle retire aussi la table des versions avec les entretiens.
- **Vérification :** testé sur PostgreSQL à partir du schéma de production d'avant la révision (montée, relance, descente, remontée, descente complète).

## Déploiement, vérification, retour arrière

1. **Sauvegarde :** sauvegarde PostgreSQL et des fichiers, copiée hors du serveur et restaurée à l'essai (procédure habituelle).
2. **Fusion :** fusionner la PR. `start.sh` applique `alembic upgrade head`. Aucune nouvelle variable n'est obligatoire. `RECRUITMENT_PUBLIC_ORIGIN` ne se règle que si l'espace recrutement change d'adresse.
3. **Vérifications :**
   - `alembic_version` vaut `20261017_0002` ;
   - `/api/version` sert le commit de fusion ;
   - `POST /api/drh/job-offers/convocations/resolve` répond 401 sans session ;
   - sur une candidature de test : brouillon, envoi, PDF, scan et arrivée. Retirer ensuite cette candidature de test.
4. **Retour arrière du code :**
   - avec le code de la PR, `python3 -m alembic downgrade 20261016_0002`, qui supprime les brouillons seulement ;
   - puis `git revert -m 1 <commit de fusion>` ;
   - un `stamp` n'est pas nécessaire et n'est pas recommandé ;
   - à la remise en service, un entretien reporté ou déplacé par le code précédent n'a pas de nouvelle version. Le scan le signale « Document à réémettre » ; le QR et le PDF candidat sont retirés et l'arrivée est refusée jusqu'à la réémission (bouton « Réémettre la convocation », candidat prévenu).
5. **Application :** un nouvel APK (profil `preview`, configuration Firebase existante) est nécessaire pour « Mes convocations », le détail, le QR et le PDF. L'APK actuel continue de fonctionner : il ignore les champs ajoutés et ne reçoit jamais de brouillon.

## Limites et essais restant à faire sur téléphone

- **Essais matériels :** l'enregistrement du PDF, son ouverture, son partage et l'affichage hors connexion n'ont été vérifiés que par les tests (types, lint, fonctions). Ils doivent être essayés sur un Android et un iPhone, de même que l'ouverture depuis une notification.
- **Lecture du QR :**
  - le scan par caméra utilise la bibliothèque déjà livrée (`html5-qrcode`). La caméra demande HTTPS et l'accord du navigateur ;
  - l'import d'image et la référence saisie restent possibles sans caméra ;
  - la lecture d'un QR affiché sur un écran de téléphone est à essayer sur place.
- **Heures :** l'heure d'Alger est fixe (UTC+1, sans heure d'été), comme le reste du recrutement.
