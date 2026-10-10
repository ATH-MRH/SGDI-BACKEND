# Confidentialité — éléments techniques pour App Store Privacy et Google Play Data Safety

Ce document décrit **ce que fait le code**. Ce n'est pas une déclaration légale : les réponses aux questionnaires Apple et Google, ainsi que la politique de confidentialité, doivent être validées par la personne responsable de la protection des données avant toute publication.

Il doit être mis à jour à chaque lot qui ajoute une donnée, une permission ou une bibliothèque tierce.

## 1. État au 8 octobre 2026

### Données traitées

| Donnée | Origine | Quitte le téléphone | Stockée sur le téléphone |
|---|---|---|---|
| Identifiant et mot de passe | Saisie | Oui, vers le backend ATLAS, en HTTPS, à la connexion | **Non** — le mot de passe n'est jamais conservé |
| Jeton de session, refresh token et leurs échéances | Backend | Oui, vers le backend ATLAS uniquement | Oui, dans le Keychain (iOS) ou le Keystore (Android), lié à l'appareil |
| Profil : nom, e-mail, rôle, sociétés et sites autorisés, modules | Backend | Non | En mémoire seulement, effacé à la fermeture |
| Version, numéro de build et plateforme de l'application | Application | Oui, en en-tête de chaque requête | Non |
| Langue de l'appareil | Système | Non | Non |
| Identifiant de requête (aléatoire, par appel) | Application | Oui, en en-tête, pour le journal d'audit | Non |
| Contexte de travail : société et site sélectionnés | Choix de l'utilisateur | Non | Oui, stockage sécurisé, effacé à la déconnexion |
| Choix d'activer le verrouillage biométrique | Choix de l'utilisateur | Non | Oui, stockage sécurisé, effacé à la déconnexion |
| Résultat de la vérification biométrique (réussi / échoué) | Système | Non | Non |
| Données métier consultées (employés, pointage, incidents, congés, BRQ) | Backend | Non | En mémoire seulement, effacées à la déconnexion |
| Déclaration d'incident saisie sans réseau (fonction `offline`) | Saisie | Oui, vers le backend ATLAS, au retour du réseau | Oui, stockage sécurisé, jusqu'à l'envoi ; liée au compte, effacée si un autre compte se connecte |
| Espace employé (fonction `employeePortal`) : identifiant et mot de passe du portail employé | Saisie | Oui, vers le backend ATLAS, à la connexion | **Non** — seul le jeton employé est conservé, dans le stockage sécurisé |
| Espace employé : profil, planning, pointage, congés, liste de documents, montants des bulletins validés | Backend | Non | En mémoire seulement, effacés à la déconnexion |
| Jeton d'appareil pour les notifications (fonction `push`) | Système, après autorisation de l'utilisateur | Oui, vers le backend ATLAS ; les notifications transitent par le service d'Expo (fournisseur retenu en V1), puis par Apple ou Google | Non |

### Ce que l'application ne fait pas

- Aucun traçage publicitaire, aucun identifiant publicitaire, aucun SDK d'analyse ou de publicité.
- Aucun service tiers : le seul destinataire des données est le backend ATLAS de l'entreprise.
- Aucun outil de rapport de plantage ou de diagnostic.
- Aucun accès aux contacts, au calendrier, aux photos, au micro, à la caméra ou à la position.
- **Aucune donnée biométrique** : la vérification est faite par le système (Face ID, Touch ID, biométrie Android). ATLAS ne lit, ne stocke et ne transmet ni empreinte ni visage.
- Aucune écriture de jeton, de mot de passe ou de donnée personnelle dans les journaux.
- Aucune donnée dans les sauvegardes : sauvegarde Android désactivée, jeton exclu des transferts d'appareil, Keychain non synchronisé.

### Permissions système

| Plateforme | Permission | Raison | Présente |
|---|---|---|---|
| Android | `INTERNET` | Communication avec le backend ATLAS | Toujours |
| Android | `USE_BIOMETRIC`, `USE_FINGERPRINT` | Verrouillage local de la session | Seulement si la fonction `biometrics` est activée au build |
| Android | `POST_NOTIFICATIONS` et permissions de réception | Notifications push | Seulement si la fonction `push` est activée au build |
| iOS | Capacité Push Notifications | Notifications push | Seulement si la fonction `push` est activée au build |
| iOS | `NSFaceIDUsageDescription` : « ATLAS MOBILE utilise Face ID pour déverrouiller votre session sur cet appareil. » | Verrouillage local de la session | Seulement si la fonction `biometrics` est activée au build |

Un build sans la fonction `biometrics` ne déclare aucune de ces permissions, bien que la bibliothèque soit embarquée : elles sont retirées explicitement.

Les permissions que le gabarit natif ajoute par défaut (stockage externe, superposition d'écran, vibreur) sont explicitement retirées. `npm run check:native` échoue si une permission non prévue apparaît.

## 2. Permissions prévues, à n'ajouter qu'avec la fonction

Une permission n'entre dans la configuration que dans le lot qui livre la fonction, avec son texte explicatif et son test.

| Fonction (lot) | iOS | Android | Raison fonctionnelle | Limites |
|---|---|---|---|---|
| Photos d'incident, de BRQ, justificatifs (3, 5) | `NSCameraUsageDescription` | `CAMERA` | Joindre une photo prise sur le terrain | Sur action de l'utilisateur uniquement |
| Choix d'une photo existante (3, 5) | Sélecteur système, sans permission | Sélecteur système, sans permission | Joindre une image déjà prise | L'application ne voit que l'image choisie |
| Scan de QR de ronde (3) | `NSCameraUsageDescription` | `CAMERA` | Preuve de passage à un point de contrôle | Sur action de l'utilisateur |
| Position lors d'une ronde ou d'un pointage (3, 7) | `NSLocationWhenInUseUsageDescription` | `ACCESS_FINE_LOCATION` | Vérifier la présence au point de contrôle | À l'usage seulement, jamais en arrière-plan, jamais de suivi continu |
| Notifications push (8) | Autorisation de notification | `POST_NOTIFICATIONS` | Alerter d'un incident, d'une validation, d'un changement de planning | Aucune donnée sensible dans le texte de la notification |
| Lecture NFC de points de ronde (éventuel) | `NFCReaderUsageDescription` et droit NFC | `NFC` | Preuve de passage sans QR | Seulement si le backend le supporte |

La position en arrière-plan et l'accès complet à la photothèque ne sont pas prévus. Les demander compliquerait fortement les revues Apple et Google.

## 3. Catégories de données attendues en V1

Pour préparer les questionnaires, voici les catégories que l'application traitera quand les lots métier seront livrés. Dans tous les cas : données liées à l'identité de l'utilisateur, utilisées pour le fonctionnement de l'application, transmises au seul backend de l'entreprise, sans traçage.

| Catégorie | Exemples | Lots |
|---|---|---|
| Compte utilisateur | Identifiant, nom, e-mail professionnel, rôle | 0, 1 |
| Données professionnelles | Société, site, fonction, planning, affectations | 2 à 6 |
| Données RH | Fiche employé, contrat, absences, congés, sanctions | 4, 6 |
| Données de pointage | Présences, horaires, anomalies, abandons de poste | 3 |
| Données opérationnelles | Incidents, BRQ, rondes, effectifs | 3, 5 |
| Documents | Documents RH, justificatifs, bulletins de paie | 4, 6 |
| Photos | Photos d'incident, de BRQ, portrait d'employé | 3, 4, 5 |
| Position | Coordonnées ponctuelles d'un scan de ronde | 3, 7 |
| Identifiant d'appareil pour les notifications | Jeton push APNs ou FCM | 8 |
| Diagnostics | Seulement si un outil de rapport de plantage est ajouté | 9 |
| Biométrie | **Aucune donnée collectée** : la vérification reste dans le système | 1 (livré) |

Points qui demanderont une décision avant d'être déclarés :

- **Bulletins de paie et données RH** : données sensibles. Décider si elles peuvent être mises en cache sur l'appareil, et pour combien de temps.
- **Notifications push** : elles transitent par Apple (APNs) et Google (FCM), et éventuellement par le service de notification d'Expo. C'est un partage avec un tiers technique à déclarer.
- **Mode hors connexion** (lot 7) : il implique de stocker des données métier sur l'appareil ; le chiffrement et la durée de conservation devront être définis.
- **Rapport de plantage** : tout outil ajouté change les réponses aux questionnaires.

## 4. Correspondance avec les questionnaires

### App Store — étiquettes de confidentialité (état au 8 octobre 2026)

| Question | Élément technique |
|---|---|
| Données utilisées pour vous suivre | Aucune |
| Données liées à l'utilisateur | Coordonnées (nom, e-mail), identifiant de compte ; contenu saisi par l'utilisateur (déclarations d'incident et d'abandon de poste, demandes de congé) ; identifiant d'appareil si la fonction `push` est activée |
| Finalité | Fonctionnement de l'application |
| Manifeste de confidentialité | `NSPrivacyTracking = false`, aucun domaine de traçage |
| Face ID | Usage local uniquement ; ne constitue pas une collecte de données biométriques |

### Google Play — Sécurité des données (état au 8 octobre 2026)

| Question | Élément technique |
|---|---|
| Données collectées | Informations personnelles (nom, e-mail), identifiant de compte ; contenu saisi par l'utilisateur (déclarations, demandes) ; identifiant d'appareil si la fonction `push` est activée |
| Données partagées avec des tiers | Aucune sans la fonction `push` ; avec elle, le jeton d'appareil et le texte des notifications passent par Apple, Google et, selon le fournisseur retenu, Expo |
| Données biométriques | Aucune collectée ni partagée ; la permission sert à une vérification locale par le système |
| Chiffrement en transit | Oui, HTTPS obligatoire hors développement |
| Suppression des données | Les données sont celles de l'ERP de l'entreprise ; la procédure de suppression relève de l'employeur et doit être décrite dans la politique de confidentialité |

## 5. À valider avant publication

- [ ] Politique de confidentialité rédigée, validée juridiquement, publiée sur une URL stable.
- [ ] Base légale et information des salariés pour le pointage, la position et les photos.
- [ ] Réponses aux questionnaires Apple et Google relues à partir de ce document, à jour du dernier lot livré.
- [ ] Déclaration de chiffrement Apple confirmée.
- [ ] Rapport de confidentialité Xcode du build comparé au manifeste déclaré.
- [ ] Procédure de demande de suppression de compte ou de données définie.
