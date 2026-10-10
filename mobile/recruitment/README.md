# IRON Emploi — application mobile

Portail emploi iOS et Android du groupe IRON GLOBAL, relié au backend ATLAS et à recrute.irongs.com.
Application React Native / Expo (SDK 57, Expo Router), écrans natifs, aucun WebView.

Elle remplace « IRON Recrutement » en conservant son identifiant (`com.irongs.recruitment`) : c'est une mise à jour, pas une nouvelle application.

## Ce que fait l'application

Les douze écrans de la planche de référence, avec des données réelles :

| Écran | Contenu |
|---|---|
| Accueil | Bannière, recherche, filtres rapides tirés des offres publiées, offres à la une, candidature spontanée, « Accès adm. » en bas. |
| Offres | Recherche, filtres par wilaya, métier, société et contrat, chargement progressif. |
| Détail d'offre | Bannière, favori, missions, profil recherché, Postuler. Une offre clôturée ou expirée ne propose plus de candidature. |
| Entreprise | Présentation, activités et implantations renseignées par le recrutement, offres ouvertes. |
| Mes opportunités | Favoris (sur le téléphone) et alertes par critères (sur le serveur). |
| Identification | Nom, prénom, téléphone (+213), puis code SMS en six cases : collage et suggestion automatique. |
| Profil | Progression calculée, expériences, compétences, études, langues, disponibilité, documents. |
| CV et candidature | Renseignements (première fois), puis CV, message facultatif et envoi. |
| Mes candidatures | Un état par candidature à une annonce, avec sa progression ; dossier pour les spontanées. |
| Messages | Une conversation par candidature ; envoi avec nouvel essai sans doublon. |
| Entretiens | À venir et passés, confirmation de présence, lieu, calendrier des dates réelles. |
| Espace emploi | Notifications (candidature, message, entretien, offre) et conseils éditoriaux. |

La barre d'onglets (Accueil, Offres, Candidatures, Messages, Profil) reste visible sur les écrans secondaires : chaque onglet a sa propre pile de navigation.

Les offres et les entreprises se consultent sans connexion. L'identification par SMS est demandée pour postuler, pour les données personnelles et pour les échanges.

## Apparence

- **Polices embarquées** (licence SIL OFL) : Source Serif 4 pour les titres, Noto Sans pour le texte. Elles sont chargées au démarrage, identiques sur iOS et Android.
- **Styles partagés** : couleurs, typographies, cartes, boutons, pastilles et filtres sont définis dans `src/components/ui.tsx`.
- **Icônes** vectorielles dessinées pour l'application (`src/components/icon.tsx`), aucune police d'icônes, aucun emoji.
- **Photographies** : trois images d'illustration sous licence CC0, documentées dans `assets/photos/SOURCES.md`. Ce ne sont pas des bâtiments du groupe. La planche montre un agent de sécurité de dos ; faute de photographie libre équivalente, la bannière des offres montre des bâtiments.
- **Logos** : ceux des sociétés sont servis par le serveur ; à défaut, des initiales. Aucun logo n'est inventé.

## Notifications

Les notifications dans l'application sont réelles : elles sont créées par le serveur (réception, changement d'état, message, entretien, offre correspondant à une alerte) et relues à l'ouverture et toutes les minutes.

Les notifications **push** ne sont pas activées. Ce qui existe : l'enregistrement d'un appareil et les préférences par famille côté serveur, un relais vers le service push d'Expo désactivé par défaut (`RECRUITMENT_PUSH_ENABLED`), et l'écran de préférences. Ce qui manque pour les activer :

1. le module `expo-notifications` et une version installable de l'application (Expo Go ne reçoit pas de push distant sur Android) ;
2. un projet EAS (`projectId`) ;
3. les identifiants Firebase (Android) et APNs (iOS) du compte développeur ;
4. un essai réel sur iPhone et Samsung.

## Serveur

L'application appelle `https://recrute.irongs.com/api`.

- Les annonces et l'espace candidat demandent l'API IRON Emploi (`/api/public/emploi/…`), livrée dans le même dépôt (`app/modules/recruitment_jobs_*.py`).
- Tant que cette API n'est pas en production, l'application le détecte et reste utilisable : elle affiche « Offres bientôt disponibles » et la candidature spontanée passe par le parcours déjà en service (`/api/public/mobile/…`). Rien n'est simulé.

Pour pointer un serveur de recette **en développement uniquement** :

```sh
EXPO_PUBLIC_API_URL=http://<adresse-du-Mac>:8000/api npx expo start
```

Une adresse sans HTTPS est ignorée par une application compilée pour la distribution.

## Démarrer

```sh
cd mobile/recruitment
npm ci
npx expo start
```

Scanner le QR code avec Expo Go (SDK 57) sur iPhone ou Android. Voir « Tester sur un téléphone » plus bas.

## Vérifications

```sh
npm test            # contrat d'API, profil, filtres (Node, sans appareil)
npm run typecheck
npm run lint
npx expo-doctor
npx expo export --platform ios --platform android
```

## Données et sécurité

- Après déconnexion, aucun écran personnel n'affiche de donnée : le serveur refuse l'ancienne session.
- La session candidat (30 jours) est conservée dans le stockage sécurisé du téléphone (Keychain / Keystore) et supprimée à la déconnexion, à l'expiration ou si le serveur la refuse.
- Le code SMS et l'accès court qu'il délivre ne sont jamais écrits sur le téléphone.
- Les favoris restent sur l'appareil ; ils ne sont pas envoyés au serveur.
- Aucun secret n'est embarqué : l'adresse de l'API est publique, les identifiants SMSGate ne quittent pas le serveur.
- Un double appui ou une relance réseau n'envoie qu'une candidature : chaque envoi porte un identifiant que le serveur reconnaît.

## Tester sur un téléphone

### Sans installation (Expo Go)

1. Installer **Expo Go** depuis l'App Store (iPhone) ou le Play Store (Samsung).
2. Sur le Mac, dans `mobile/recruitment` : `npm ci` puis `npx expo start`.
3. Le téléphone et le Mac sur le même Wi-Fi : scanner le QR code (appareil photo sur iPhone, Expo Go sur Samsung).

Si Expo Go refuse le projet (version de SDK différente), utiliser une version installable.

### Version installable (EAS)

```sh
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview   # APK à installer sur le Samsung
npx eas-cli@latest build --platform ios --profile preview       # iPhone enregistré, compte Apple Developer requis
```

Aucun binaire n'a été produit ni publié par ce dépôt.

## Espace administration

« Accès adm. » ouvre l'espace RH existant (connexion, liste et fiche des candidats). Il n'a pas été modifié. La gestion des annonces se fait dans recrute.irongs.com.

## Limites connues

- Aucun essai n'a eu lieu sur un iPhone ou un Samsung : la revue visuelle s'est faite dans l'aperçu web (320, 375, 390 et 430 points de large).
- Notifications push non activées (voir plus haut). « En ligne » n'est jamais affiché dans les messages : la présence n'est pas mesurée.
- Les messages n'acceptent pas de pièce jointe ; les pièces demandées se déposent depuis le détail de la candidature.
- Un même numéro de téléphone ne peut ouvrir qu'un espace, sous le nom utilisé à la première inscription.
- Les dates se saisissent au format AAAA-MM-JJ.
- L'aperçu web (`npx expo start --web`) sert à la revue d'interface ; il n'est pas un produit distribué.
