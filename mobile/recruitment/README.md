# IRON Emploi — application mobile

Portail emploi iOS et Android du groupe IRON GLOBAL, relié au backend ATLAS et à recrute.irongs.com.
Application React Native / Expo (SDK 57, Expo Router), écrans natifs, aucun WebView.

Elle remplace « IRON Recrutement » en conservant son identifiant (`com.irongs.recruitment`) : c'est une mise à jour, pas une nouvelle application.

## Ce que fait l'application

| Écran | Contenu |
|---|---|
| Accueil | Recherche, offres récentes, candidature spontanée, conseils. « Accès adm. » discret en bas. |
| Offres | Liste, recherche, filtres par wilaya, métier, société et type de contrat. |
| Détail d'une offre | Société, poste, lieu, contrat, missions, profil recherché, date limite, bouton Postuler. |
| Société | Présentation et offres publiées. |
| Favoris | Offres enregistrées sur le téléphone, sans compte. |
| Identification | Nom, prénom, téléphone, puis code reçu par SMS (parcours SMSGate existant). |
| Candidature | Formulaire existant, prérempli depuis le profil ; à une offre ou spontanée ; CV PDF, JPG ou PNG. |
| Confirmation | Référence du dossier. |
| Suivi | Candidatures du candidat et leur état, tel qu'enregistré par le recrutement. |
| Profil | Informations et documents, réutilisés aux candidatures suivantes. |
| Conseils | Contenu éditorial embarqué, distinct des annonces. |
| Paramètres | Session, favoris, suppression de l'espace candidat. |

Les offres se consultent sans connexion. L'identification par SMS n'est demandée que pour postuler et pour les données personnelles.

Ne font **pas** partie de cette version : messagerie, alertes automatiques, gestion des entretiens, notifications push. Aucun écran ne les simule.

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

- L'état affiché dans « Suivi » est celui du dossier du candidat, commun à toutes ses candidatures.
- Un même numéro de téléphone ne peut ouvrir qu'un espace, sous le nom utilisé à la première inscription.
- Les dates se saisissent au format AAAA-MM-JJ.
- L'aperçu web (`npx expo start --web`) sert à la revue d'interface ; il n'est pas un produit distribué.
