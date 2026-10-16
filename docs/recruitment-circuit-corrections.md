# Cohérence du circuit IRON Emploi / Recrutement

Les nouvelles candidatures conservent une copie du profil au moment de l'envoi, en plus des pièces déjà figées. Le dossier commun du vivier et ses décisions DRH ne sont pas écrasés par une nouvelle candidature. Lors du premier transfert DRH, les données personnelles et les pièces de la candidature retenue sont reprises dans le vivier ; les décisions et l'historique métier sont conservés. Si les informations personnelles ont changé, les anciennes validations de fiche sont remises à compléter. Un transfert déjà effectué ne réécrit rien. Les candidatures antérieures, sans instantané, utilisent leur dossier existant : leurs informations à la date d'envoi ne peuvent pas être reconstituées.

Les données de candidature retournées aux recruteurs n'incluent plus le journal transversal `candidaturesEmploi`. La liste des autres candidatures reste filtrée par les sociétés autorisées. Pour une spontanée, un état explicitement changé par son traitement est affiché au candidat ; sinon le suivi historique du dossier reste utilisé.

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

Une réponse perdue après acceptation par Expo peut produire une bannière en double lors d'une reprise : Expo ne fournit pas de clé d'idempotence pour cet envoi. La notification enregistrée dans l'espace conserve son identifiant unique. Les notifications expirent après 24 heures, pour éviter de relancer des événements anciens.

La file ne duplique ni texte ni jeton : elle référence notification et appareil. Les journaux n'affichent ni leurs contenus ni les erreurs textuelles retournées par le prestataire. La désactivation de la variable coupe envois et contrôles de reçus. Une notification créée pendant cette désactivation n'est pas rejouée automatiquement à la réactivation.

## Déploiement

Révision additive `20261016_0002`, parent `20261014_0005` : colonne JSON nullable `profile_snapshot` et table `recruitment_push_deliveries`. Aucun instantané historique inventé, aucune ligne existante réécrite. La descente de cette seule révision conserve ces additions et leurs données ; l'ancien code peut les ignorer. Vérifier la tête de migration avant toute fusion avec d'autres travaux.

Contrôles après déploiement : candidature de test autorisée, profil modifié puis seconde candidature (deux instantanés distincts), refus communiqué sur spontanée, isolation des sociétés, puis notification sur APK Android avec autorisation et Firebase configurés. La recette réelle sur téléphone reste nécessaire.

Référence technique : https://docs.expo.dev/push-notifications/sending-notifications/
