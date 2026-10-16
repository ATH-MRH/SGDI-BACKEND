# Cohérence du circuit IRON Emploi / Recrutement

Les nouvelles candidatures conservent une copie du profil au moment de l'envoi, en plus des pièces déjà figées. Le dossier commun du vivier et ses décisions DRH ne sont pas écrasés par une nouvelle candidature. Lors du premier transfert DRH, les données personnelles et les pièces de la candidature retenue sont reprises dans le vivier ; les décisions et l'historique métier sont conservés. Si les informations personnelles ont changé, les anciennes validations de fiche sont remises à compléter. Un transfert déjà effectué ne réécrit rien. Les candidatures antérieures, sans instantané, utilisent leur dossier existant : leurs informations à la date d'envoi ne peuvent pas être reconstituées.

Les données de candidature retournées aux recruteurs n'incluent plus le journal transversal `candidaturesEmploi`. La liste des autres candidatures reste filtrée par les sociétés autorisées. Pour une spontanée, un état explicitement changé par son traitement est affiché au candidat ; sinon le suivi historique du dossier reste utilisé.

## Copies du profil et conservation

Supprimer un espace candidat ne supprime aucune candidature transmise : elles restent au service recrutement, détachées de l'espace, avec la copie du profil envoyée avec chacune d'elles. Aucune suppression implicite n'a lieu.

L'aperçu de conservation (lecture seule) le montre ainsi :

- **Candidature refusée arrivée à échéance** : la copie du profil est comptée parmi les éléments concernés (« Copie du profil envoyée »). Elle fait partie de la candidature.
- **Espace inactif** : les éléments concernés comptent aussi les envois push encore en file. Les éléments conservés comptent les candidatures détachées et les copies du profil qu'elles portent, avec l'explication affichée : leur conservation suit celle de la candidature (24 mois après un refus communiqué) ou du dossier de la personne recrutée.
- Une ancienne candidature sans copie (valeur absente ou JSON `null`) n'est pas comptée.
- L'aperçu ne renvoie que des décomptes, jamais le contenu d'une copie.

## Notifications

Avec `RECRUITMENT_PUSH_ENABLED=true`, les notifications et leurs destinataires sont enregistrés dans la même transaction. Une première tranche de 100 est envoyée après validation ; les suivantes, ou les reprises, sont traitées toutes les cinq secondes par les workers web. PostgreSQL sérialise les réservations avec `FOR UPDATE SKIP LOCKED`. SMSGate n'est pas modifié.

États techniques :

- `pending` : en attente ou reprise programmée ;
- `accepted` : ticket valide reçu d'Expo ;
- `provider_accepted` : reçu confirmant l'acceptation par FCM/APNs, pas la réception ni la lecture sur le téléphone ;
- `failed` : refus permanent, expiration ou quatre tentatives épuisées ;
- `unknown` : reçu indisponible pendant 23 heures ;
- `skipped` : appareil désinscrit, espace différent ou préférence désactivée.

Les pannes réseau/429/5xx et les limitations temporaires font l'objet de reprises après 15, 60 puis 300 secondes. Un ticket absent ou malformé ne compte jamais comme un succès. Les reçus sont demandés après 15 minutes, puis toutes les cinq minutes. Un appareil signalé `DeviceNotRegistered` est retiré. La notification dans l'espace candidat demeure.

Rien de ce qui est en file ne part après un de ces changements validés :

- **Suppression de l'espace** : notifications et lignes de file partent avec lui.
- **Désinscription d'un téléphone** (ou de tous) : la ligne est écartée (`skipped`).
- **Changement d'espace d'un téléphone** : les envois de l'ancien espace, en attente ou en reprise programmée, sont écartés.

Un envoi déjà en cours n'est pas rappelé. Le changement attend sa fin : les lignes de file sont verrouillées (`FOR UPDATE SKIP LOCKED`) et les appareils le sont en lecture (`FOR SHARE`) pendant l'envoi. La fermeture de session seule (`DELETE /session`) ne désinscrit pas le téléphone ; l'application le désinscrit à la déconnexion.

Workers concurrents et arrêt : une ligne réservée par un worker n'est jamais prise par un autre. Si un worker s'arrête avant de valider, sa transaction est annulée et ses lignes redeviennent disponibles sans tentative comptée. Un envoi déjà accepté par Expo mais non validé en base peut alors repartir (doublon possible, voir ci-dessous). Ces comportements sont vérifiés sur PostgreSQL par `tests/test_recruitment_push_pg_race.py` (base jetable `ATTENDANCE_PG_URL`). La CI n'a pas de PostgreSQL : ces tests y sont ignorés.

Un ticket ou un reçu Expo `ok` signifie seulement qu'Expo, puis FCM/APNs, ont accepté le message. Ce n'est pas une preuve d'affichage ni de réception sur le téléphone : seule la recette sur l'appareil le montre.

Une réponse perdue après acceptation par Expo peut produire une bannière en double lors d'une reprise : Expo ne fournit pas de clé d'idempotence pour cet envoi. La notification enregistrée dans l'espace conserve son identifiant unique. Les notifications expirent après 24 heures, pour éviter de relancer des événements anciens.

La file ne duplique ni texte ni jeton : elle référence notification et appareil. Les journaux n'affichent ni leurs contenus ni les erreurs textuelles retournées par le prestataire. La désactivation de la variable coupe envois et contrôles de reçus. Une notification créée pendant cette désactivation n'est pas rejouée automatiquement à la réactivation.

## Déploiement

Révision additive `20261016_0002`, parent `20261014_0005` : colonne JSON nullable `profile_snapshot` et table `recruitment_push_deliveries`. Aucun instantané historique inventé, aucune ligne existante réécrite. La descente de cette seule révision conserve ces additions et leurs données ; l'ancien code peut les ignorer. Vérifier la tête de migration avant toute fusion avec d'autres travaux.

Contrôles après déploiement : candidature de test autorisée, profil modifié puis seconde candidature (deux instantanés distincts), refus communiqué sur spontanée, isolation des sociétés, puis notification sur APK Android avec autorisation et Firebase configurés. La recette réelle sur téléphone reste nécessaire.

Référence technique : https://docs.expo.dev/push-notifications/sending-notifications/
