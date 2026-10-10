# Premier build sur appareil

État au 10 octobre 2026 : le projet EAS existe (`@irongs01/atlas-mobile`) et le backend mobile est en production. Le poste de développement n'a ni Xcode complet ni SDK Android : les binaires sont compilés par EAS Build.

## Projet EAS

| Élément | Valeur |
|---|---|
| Compte Expo | `irongs01` |
| Projet | `atlas-mobile`, identifiant `e89fd70e-c6dc-4bd4-982a-ed7f662a6563` (non secret) |
| Variables, environnements `development`, `preview`, `production` | `EAS_PROJECT_ID`, `EXPO_OWNER` |
| Variables, environnement `development` | `EXPO_PUBLIC_API_URL=https://atlas.irongs.com`, `ATLAS_FEATURES=biometrics,offline,updateCheck` |
| Production | `EXPO_PUBLIC_API_URL` fixée dans `eas.json` |
| Staging (`preview`) | `EXPO_PUBLIC_API_URL` non définie : il n'existe pas de backend de validation |

Ces variables vivent dans EAS, pas dans Git. En local, les commandes `eas` ont besoin de l'identifiant du projet :

```bash
cd mobile/atlas
export EAS_PROJECT_ID=e89fd70e-c6dc-4bd4-982a-ed7f662a6563 EXPO_OWNER=irongs01
npx eas-cli@latest whoami
```

## Build de développement Android

```bash
npx eas-cli@latest build --profile development --platform android
```

Le résultat est un APK signé par une clé de développement gardée par EAS, sous l'identifiant `com.irongs.atlas.dev` (« ATLAS MOBILE DEV »). Il s'installe à côté d'une future version de production.

Le build de développement vise la **production** (`atlas.irongs.com`), faute de backend de validation : ce qui est saisi pendant les tests est réel. Utiliser un compte de test et des données identifiables.

### Installer sur le téléphone

1. Sur le téléphone, ouvrir la page du build (lien ou QR code affichés par EAS) et télécharger l'APK.
2. Autoriser l'installation depuis le navigateur quand Android le demande (« Installer des applications inconnues »).
3. Installer, puis ouvrir « ATLAS MOBILE DEV ».

Avec un câble et le débogage USB activé : `adb install chemin/vers/le.apk`.

### Lancer l'application

Un build de développement charge son code JavaScript depuis le poste de développement. Le téléphone et le Mac doivent être sur le même réseau Wi-Fi.

```bash
cd mobile/atlas
cp .env.example .env    # une seule fois, puis renseigner :
#   APP_VARIANT=development
#   EXPO_PUBLIC_API_URL=https://atlas.irongs.com
#   ATLAS_FEATURES=biometrics,offline,updateCheck
npx expo start --dev-client
```

Scanner le QR code affiché avec l'appareil photo du téléphone, ou saisir l'adresse dans l'écran d'accueil du client de développement. Les fonctions natives (biométrie, notifications) sont fixées au build : changer `ATLAS_FEATURES` dans `.env` ne suffit pas à en ajouter une.

## Notifications push

La fonction `push` n'est pas incluse dans ce premier build. Sur Android, obtenir un jeton d'appareil exige un projet Firebase :

1. Créer un projet Firebase et une application Android `com.irongs.atlas.dev`.
2. Télécharger `google-services.json` et le fournir au build comme variable EAS de type fichier, jamais dans Git (`.gitignore` le refuse).
3. Déposer la clé de compte de service FCM V1 dans les identifiants EAS du projet.
4. Ajouter `push` à `ATLAS_FEATURES` et refaire un build.

## iOS

Un compte Apple Developer est obligatoire, même pour un appareil de test. Ensuite : `npx eas-cli@latest device:create` pour enregistrer l'iPhone, puis `npx eas-cli@latest build --profile development --platform ios`.

## Voie locale

| Plateforme | À installer | Commande |
|---|---|---|
| iOS (simulateur) | Xcode complet depuis l'App Store (environ 15 Go), puis `sudo xcode-select -s /Applications/Xcode.app` | `npx expo run:ios` |
| Android (émulateur) | Android Studio avec un SDK et une image système ; un JDK 17 | `npx expo run:android` |

## Checklist de test sur appareil

Noter le modèle, la version d'Android et le numéro de build. Aucun de ces points n'est couvert par un test automatisé.

### Authentification

- [ ] Connexion avec un compte staff ; identifiants faux refusés avec un message clair
- [ ] Session conservée après fermeture complète de l'application
- [ ] Après 30 minutes d'inactivité, l'application continue sans redemander le mot de passe (renouvellement)
- [ ] Déconnexion, puis retour à l'écran de connexion ; le bouton retour ne ramène pas dans l'application
- [ ] Reconnexion avec le même compte, puis avec un autre

### Biométrie

- [ ] Activation dans Profil → Sécurité, après une vérification réussie
- [ ] Application verrouillée au lancement à froid
- [ ] Verrouillage après plus de 2 minutes en arrière-plan ; pas de verrouillage avant
- [ ] Empreinte refusée : nouvel essai possible, code de l'appareil proposé
- [ ] Cinq échecs : session fermée ; « Se reconnecter » toujours disponible
- [ ] Désactivation soumise à la même vérification

### Contexte société / site

- [ ] Compte à une seule société : aucun écran de choix
- [ ] Compte à plusieurs sociétés ou sites : écran « Contexte de travail », choix mémorisé au relancement
- [ ] Après retrait d'un site côté administration : le site disparaît au retour au premier plan

### Cockpit

- [ ] Indicateurs affichés et cohérents avec le web pour le même compte
- [ ] Tâches et alertes listées ; ouverture d'une alerte et de ses actions
- [ ] Compte sans module : message d'accès, aucun écran vide

### OPS

- [ ] Sites : liste, recherche, pagination, détail (effectifs, pointage du jour, planning)
- [ ] Pointage : consultation, puis correction motivée d'une ligne ; refus sans motif
- [ ] Abandon de poste : déclaration, puis présence dans la liste
- [ ] Incident : déclaration, puis présence dans la liste

### DRH

- [ ] Employés : liste, recherche, fiche (pointage, congés, documents)
- [ ] Congés : validation ou refus d'une demande ; dépôt d'une demande
- [ ] Candidats : liste et recherche

### Hors connexion

- [ ] Mode avion, déclaration d'un incident : la saisie apparaît « en attente », à part des incidents
- [ ] Retour du réseau : envoi automatique, la saisie quitte la file
- [ ] Un seul incident créé côté web, même après plusieurs essais d'envoi
- [ ] Déconnexion puis connexion d'un autre compte : la file de l'ancien compte n'est pas visible

### Liens profonds

- [ ] `adb shell am start -a android.intent.action.VIEW -d "atlas-dev://alerts/1"` hors session : écran de connexion
- [ ] Le même lien en session : l'alerte s'ouvre, ou « Accès non autorisé » sans le module
- [ ] Un lien inconnu (`atlas-dev://inexistant`) n'ouvre rien de sensible

### Notifications (build avec `push` uniquement)

- [ ] Autorisation demandée seulement après « Activer les notifications » dans le profil
- [ ] Appareil enregistré ; désactivation et déconnexion le rendent muet
- [ ] Toucher une notification ouvre le bon écran

### Ergonomie

- [ ] Le clavier ne masque ni les champs ni le bouton de validation
- [ ] Zones sûres : rien sous la barre d'état ni sous la barre de gestes
- [ ] États de chargement, liste vide et erreur réseau avec « Réessayer »
- [ ] Bouton retour Android cohérent sur chaque écran
- [ ] L'application reste en portrait
- [ ] Aperçu masqué dans le sélecteur d'applications (complet seulement avec `secureScreen`)
- [ ] Téléphone verrouillé puis déverrouillé : l'application reprend correctement
- [ ] Arabe : mise en page de droite à gauche ; petit écran et grande taille de police
