# Besoins backend pour ATLAS MOBILE

État au 9 octobre 2026. La production (`https://atlas.irongs.com`, vérifiée ce jour : `/health` 200) sert `main` au commit `71fa92b`. Les routes mobiles ci-dessous y répondent encore 404 ; `POST /api/auth/login` et `GET /api/auth/me` y sont en service.

## Livré sur la branche mobile, pas encore déployé

Ces routes existent sur `feat/atlas-mobile-v1`. Le mobile fonctionne sans elles sur le backend actuel (connexion classique, pas de renouvellement, pas de blocage de version).

| Route | Rôle | Migration |
|---|---|---|
| `GET /api/mobile/config` | Version minimale et recommandée, maintenance, liens des fiches store | Aucune |
| `POST /api/auth/mobile/login`, `POST /api/auth/refresh`, `POST /api/auth/logout` | Session renouvelable, rotation du refresh token, révocation | `20261013_0001` (table `auth_sessions`) |
| `POST /api/mobile/devices`, `POST /api/mobile/devices/revoke` | Registre des appareils pour les notifications push | `20261013_0002` (table `mobile_devices`) |
| `POST /api/employee-mobile/login`, `GET /api/employee-mobile/me` et `/me/{planning,attendance,absences,leaves,documents,payslips}` | Libre-service de l'employé, jeton `employee_mobile` | Aucune |
| Service d'envoi push (`app/modules/mobile/push.py`) | Expo Push Service, désactivé par défaut | Aucune |

Les deux migrations suivent la tête actuelle de `main` (`20261011_0001`, suivi SMSGate). Elles ont été jouées sur PostgreSQL 16 : montée depuis le schéma de `main`, descente, remontée, base neuve, sans écart avec les modèles.

Réglages serveur associés : `MOBILE_*` dans `.env.production.example`. `POST /api/auth/login` et les jetons web ne changent pas.

## Encore manquant

| Besoin | Contrat proposé | Sans lui, aujourd'hui | Priorité |
|---|---|---|---|
| Environnement de validation | Un backend de staging avec sa base | Aucun build de test ne peut viser autre chose que la production | Bloquant pour TestFlight et les tests internes |
| Déclencheurs de notification | Appels à `notify_user` depuis les traitements métier (alerte critique, incident, congé à valider) | Le service d'envoi existe mais rien ne l'appelle | Haute — règles métier à définir |
| Session employé | Table de sessions employé (refresh token, révocation) | Jeton de 8 heures sans renouvellement ; l'employé se reconnecte | Moyenne |
| Demandes de l'employé | Dépôt authentifié d'une demande (congé, document) par l'employé | L'espace employé est en lecture seule | Moyenne |
| Bulletins de paie | Génération et téléchargement du PDF | L'employé voit la période et les montants validés, sans document | Haute |
| Envoi de fichiers | Envoi multipart validé (taille, type, extension) pour photos d'incident et justificatifs | Aucune photo ni pièce jointe depuis le mobile | Haute |
| Incidents | Détail, prise en charge, résolution, clôture, commentaires | Création et consultation seulement ; les états sont un texte libre | Moyenne |
| BRQ | Bulletin enregistré : création, validation, transmission, PDF | Le BRQ est calculé à la volée, en lecture seule | Moyenne |
| Congés | Commentaire de décision, solde, « mes demandes » | Approbation et refus sans motif | Moyenne |
| Rondes | Exécution et scan avec un compte autorisé, périmètre par site | L'exécution est réservée au portail employé ; les rondes ne sont pas ouvertes sur mobile | Moyenne |
| Consignes de site | Modèle et routes | Aucune consigne dans ATLAS | Basse |
| Tâches | Agrégateur `GET /api/mobile/tasks` | Les tâches sont composées sur le téléphone à partir des alertes, congés et abandons | Basse |
| Permissions de l'utilisateur | `GET /api/auth/permissions` : droits module × action du compte courant | Les droits fins se découvrent par un refus 403 | Moyenne |
| Périmètre | `GET /api/auth/scope` : sociétés et sites autorisés, avec leurs noms | Les noms de sites viennent de routes dépendant des modules du compte | Moyenne |
| Origine dans le journal d'audit | Colonne d'origine alimentée par l'en-tête `X-Atlas-Client` | Une action mobile ne se distingue que par son `User-Agent` et son identifiant de corrélation | Basse |

## Règle d'affichage des actions sur mobile

Le mobile applique un refus par défaut : sans action explicitement attribuée, un compte est en **consultation seule**. Les comptes qui doivent saisir, corriger ou valider depuis le téléphone doivent donc avoir des actions explicites dans l'administration ATLAS.

Des constats de sécurité backend ont été identifiés lors de l'audit et sont suivis séparément dans un rapport de sécurité privé.
