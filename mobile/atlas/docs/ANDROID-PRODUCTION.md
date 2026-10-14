# Android — de la validation à Google Play

Ce document décrit le chemin d'un build Android d'ATLAS MOBILE jusqu'à Google Play, et ce qui reste à faire par une personne. Il complète STORE-READINESS (comptes, signature, CI), PRIVACY-DATA-SAFETY (données et permissions) et DEVICE-BUILD (checklist de test sur appareil).

**Rien n'est publié par ces commandes.** La mise en production sur Google Play est une action manuelle dans la Play Console, sur instruction explicite.

## 1. Profils de build

| Profil | Résultat | Identifiant | Usage |
|---|---|---|---|
| `development` | APK avec client de développement | `com.irongs.atlas.dev` | Développement, code chargé depuis le poste |
| `production-apk` | APK autonome, identique à la production | `com.irongs.atlas` | Validation sur appareil avant l'envoi au store |
| `production` | Android App Bundle (`.aab`) | `com.irongs.atlas` | Google Play (test interne, test fermé, production) |

`production` et `production-apk` partagent la même configuration : API `https://atlas.irongs.com`, fonctions `biometrics,offline,updateCheck`, même clé d'envoi. Seuls le format et la distribution changent. `production` incrémente `versionCode` à chaque build ; `production-apk` ne le fait pas.

```bash
cd mobile/atlas
export EAS_PROJECT_ID=e89fd70e-c6dc-4bd4-982a-ed7f662a6563 EXPO_OWNER=irongs01
npx eas-cli@latest build --profile production-apk --platform android   # validation sur appareil
npx eas-cli@latest build --profile production --platform android       # bundle pour Google Play
```

### Installer l'APK de validation

Télécharger l'APK depuis la page du build, ou `adb install chemin/vers/le.apk`. Il s'installe à côté de « ATLAS MOBILE DEV ».

Cet APK est signé par la clé d'envoi. Une installation depuis Google Play est signée par la clé de Google (Play App Signing) : les deux signatures diffèrent, donc **désinstaller l'APK de validation avant d'installer la version du Play Store**.

### Ce qu'un build de production ne contient pas

- **Le client de développement.** `expo-dev-client` est une dépendance du projet, pour le profil `development`. `scripts/strip-dev-client.mjs`, lancé après `npm ci`, le retire de `node_modules` quand `APP_VARIANT` vaut `staging` ou `production`, avant la génération du projet natif. Si le paquet est encore là, `app.config.ts` refuse le build EAS.
- Trafic HTTP en clair, sauvegarde Android, URL locale, diagnostic de développement (affiché seulement quand la variante est `development`).

`npm run check:native` génère le projet de chaque variante dans le même état que la machine de build et le vérifie.

## 2. Permissions du build de production

Fonctions `biometrics,offline,updateCheck`, sans `push`.

| Permission | Origine | Raison |
|---|---|---|
| `INTERNET` | Plateforme | Communication avec le backend ATLAS |
| `USE_BIOMETRIC` | expo-local-authentication | Verrouillage local de la session |
| `USE_FINGERPRINT` | expo-local-authentication | Même fonction sur Android 7 à 8.1, où `USE_BIOMETRIC` n'existe pas (le SDK minimum est 24) |
| `DETECT_SCREEN_CAPTURE` | expo-screen-capture | Exigée au lancement par la bibliothèque à partir d'Android 14 ; ne donne accès à aucune image |
| `ACCESS_NETWORK_STATE` | Bibliothèques Google embarquées par expo-notifications | Permission normale, sans demande à l'utilisateur. Conservée : la retirer ferait échouer ces bibliothèques si elles consultent l'état du réseau |
| `com.irongs.atlas.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX | Permission interne à l'application, créée par la plateforme de build ; ne peut pas être retirée |

Retirées explicitement à la fusion des manifestes : stockage externe, lecture des photos (`READ_MEDIA_IMAGES`), superposition d'écran, vibreur, les permissions de notification tant que `push` n'est pas activé, les seize permissions de pastille de compteur des lanceurs (bibliothèque ShortcutBadger d'expo-notifications) et la lecture de la provenance d'installation (expo-application).

Les permissions apportées par les bibliothèques n'apparaissent qu'à la compilation. Après chaque build, le manifeste final est à relire dans la Play Console (« Explorateur d'app bundle » → « Autorisations »).

## 3. Notifications push — à faire par une personne

Le code est prêt (demande d'autorisation depuis le profil, enregistrement et révocation de l'appareil auprès du backend, ouverture de l'écran visé au toucher). Le build de production ne l'inclut pas : sur Android, un jeton d'appareil exige un projet Firebase, que seul le titulaire du compte Google peut créer.

1. [console.firebase.google.com](https://console.firebase.google.com) → créer un projet au nom de l'entreprise (Google Analytics n'est pas nécessaire).
2. Ajouter une application Android `com.irongs.atlas`, puis une seconde `com.irongs.atlas.dev` pour le build de développement.
3. Télécharger `google-services.json` (un seul fichier pour les deux applications). **Ne pas le mettre dans Git.**
4. Le fournir à EAS comme variable de type fichier, pour chaque environnement qui construit avec `push` :
   ```bash
   npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json \
     --environment production --environment development --visibility secret
   ```
5. Firebase → Paramètres du projet → Comptes de service → « Générer une nouvelle clé privée ». Déposer cette clé FCM V1 dans EAS : `npx eas-cli@latest credentials` → Android → `com.irongs.atlas` → « Google Service Account » → « Manage your Google Service Account Key for Push Notifications (FCM V1) ». Supprimer ensuite le fichier local.
6. Ajouter `push` à `ATLAS_FEATURES` du profil `production` dans `eas.json`, et activer l'envoi côté backend (voir BACKEND-NEEDS).
7. Refaire un build. Un build Android avec `push` et sans `GOOGLE_SERVICES_JSON` est refusé.
8. Mettre à jour le formulaire Sécurité des données : le jeton d'appareil et le texte des notifications passent par Expo et Google.

Avec `push`, le build déclare en plus `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK` et `com.google.android.c2dm.permission.RECEIVE`.

## 4. Google Play — à faire par une personne

Aucune de ces étapes n'est automatisable sans compte ni identifiants.

### Création de l'application

1. Compte Google Play Console au nom de l'organisation (voir STORE-READINESS, § 8).
2. « Créer une application » : nom « ATLAS MOBILE », langue par défaut français, type Application, gratuite.
3. **Play App Signing** : accepter à la création de la première release. Google détient la clé de signature finale ; EAS détient la clé d'envoi.
4. Conserver une copie de secours de la clé d'envoi dans le coffre de l'entreprise : `npx eas-cli@latest credentials` → Android → `com.irongs.atlas` → « Download existing keystore ».

### Fiche du store

Textes proposés, **à relire et valider** : ils ne décrivent que ce que l'application fait aujourd'hui.

- **Description courte** (80 caractères au plus) : « L'ERP ATLAS sur mobile : pointage, sites, équipes et incidents en temps réel. »
- **Description complète** :

  > ATLAS MOBILE est l'application mobile de l'ERP ATLAS, réservée aux collaborateurs disposant d'un compte ATLAS fourni par leur entreprise.
  >
  > Selon vos droits, elle donne accès à :
  > • un cockpit des indicateurs du jour, des alertes et des tâches ;
  > • les opérations : sites, effectifs, pointage, incidents, abandons de poste ;
  > • les ressources humaines : fiches employés, congés, candidats ;
  > • la déclaration d'incident sans réseau, envoyée au retour de la connexion.
  >
  > La session peut être protégée par l'empreinte ou le code de l'appareil. Les données affichées sont celles de l'ERP de votre entreprise ; l'application ne contient ni publicité ni traçage.
  >
  > Un compte ATLAS est indispensable : l'application ne permet pas d'en créer.

| Élément | État |
|---|---|
| Icône 512 × 512 | À exporter depuis l'icône officielle ; celle du dépôt est provisoire |
| Image de présentation 1024 × 500 | À créer |
| Captures d'écran téléphone (2 à 8) | À faire sur l'APK de validation, avec des données de démonstration : les écrans montrent des données personnelles réelles |
| Catégorie | Professionnel (proposition) |
| E-mail de contact, site web | À fournir |
| Politique de confidentialité | URL publique à fournir, document validé juridiquement |

### Contenu de l'application

| Rubrique | Élément technique | À décider |
|---|---|---|
| Accès à l'application | Connexion obligatoire | Fournir un compte de démonstration à Google |
| Annonces | Aucune | — |
| Classification du contenu | Application professionnelle, aucun contenu sensible | Remplir le questionnaire |
| Public cible | Adultes, usage professionnel | Confirmer « 18 ans et plus » |
| Sécurité des données | Voir PRIVACY-DATA-SAFETY, § 4 | Relecture par le responsable de la protection des données |
| Suppression de compte | Les comptes sont créés et supprimés par l'entreprise dans l'ERP | Décrire la procédure et fournir l'URL demandée par Google |
| Identifiant publicitaire | Non utilisé, permission absente | Déclarer « Non » |
| Applications gouvernementales, financières, santé | Non concerné | — |

### Test interne

1. Tests → Tests internes → créer une release, téléverser l'`.aab` du build `production`.
   Envoi automatisable une fois le compte de service Google Play déposé dans EAS : `npx eas-cli@latest submit --profile production --platform android --latest` (piste interne, brouillon).
2. Ajouter les testeurs (liste d'adresses Google), partager le lien d'adhésion.
3. Installer depuis le Play Store et dérouler la checklist de DEVICE-BUILD.
4. Relire le rapport de pré-lancement (plantages, ANR, accessibilité, appareils) et les avertissements de la console.

### Test fermé

Google impose aux comptes développeur **personnels** créés après le 13 novembre 2023 un test fermé d'au moins 12 testeurs pendant 14 jours avant la production ; les comptes d'organisation n'y sont pas soumis. L'exigence réelle s'affiche dans la Play Console (Tableau de bord → « Demander l'accès à la production ») : c'est elle qui fait foi.

### Production

Promotion manuelle de la release validée, en déploiement progressif, sur accord écrit. Voir RELEASE-CHECKLIST.

## 5. Points de décision

- **Protection contre les captures d'écran** (`secureScreen`, FLAG_SECURE) : non activée. Elle masque l'application dans le sélecteur d'applications et bloque les captures, y compris celles destinées à la fiche du store.
- **Réduction du code** (R8) : non activée. Elle allégerait le bundle mais modifie le binaire ; à n'activer qu'avec une passe complète de tests sur appareil.
- **Blocage d'une ancienne version** : `GET /api/mobile/config` répond en production sans version minimale. Une fois la fiche créée, renseigner côté backend `MOBILE_MIN_VERSION_ANDROID` et `MOBILE_STORE_URL_ANDROID`, et côté EAS `ATLAS_STORE_URL_ANDROID`.

## 6. Builds du 11 octobre 2026

Construits par EAS à partir du commit `56be9e76` (branche `feat/atlas-mobile-v1`), version 1.0.0.

| | APK de validation | Bundle Google Play |
|---|---|---|
| Profil | `production-apk` | `production` |
| Build EAS | `587f2c12-6290-4249-aa0d-bf451bcf7abb` | `1c47c204-994e-4f49-8751-9405e7bf92b7` |
| `versionCode` | 1 | 2 |
| Taille | 99 Mo (quatre architectures) | 71 Mo |
| SHA-256 | `149b4215bb243ec84ff83b439de7855f89b2474695b0f55ed6101d9eed40e8a9` | `3c60edda236c31cba588c1e3af60a49018d944919392d1294274cf59c029707c` |

Certificat de la clé d'envoi (les deux fichiers), SHA-256 : `B4:85:8B:93:47:51:24:64:D7:D1:F0:06:11:3D:3D:DC:D0:F0:13:6D:58:A5:B7:DA:71:9B:F2:05:2C:F9:A8:CF`. C'est l'empreinte que la Play Console affichera comme « certificat de la clé d'importation ».

Constaté dans les fichiers produits, et non dans le seul projet généré :

- permissions déclarées : les six du § 2, aucune autre ;
- aucune classe ni activité du client de développement, aucun schéma `exp+…` ; seul le schéma `atlas://` ouvre l'application ;
- configuration embarquée : variante `production`, API `https://atlas.irongs.com`, fonctions `biometrics`, `offline`, `updateCheck` ;
- code JavaScript compilé (Hermes), sans adresse de backend codée en dur ni adresse locale d'API ;
- application non débogable, trafic en clair interdit.

Ces deux builds précèdent la fusion de la branche. L'APK de validation a ensuite été validé sur appareil réel.

### Bundle à envoyer à Google Play

Construit depuis `main` après la fusion de la PR #17, commit `7ad2c2d1`.

| | |
|---|---|
| Profil | `production` |
| Build EAS | `358e22c8-2df5-4d05-8da5-90ed8920cf93` |
| Version | 1.0.0, `versionCode` 3 |
| Taille | 71 Mo |
| SHA-256 | `f44c1f911a42e759cd5824a9214d47aa9ec3b98e8a53d64581fcaa0df24d4b2b` |
| Certificat | Même clé d'envoi que ci-dessus |

Mêmes constats que pour les builds précédents : les six permissions du § 2, aucun client de développement, variante `production`, API `https://atlas.irongs.com`. Son code JavaScript compilé est identique, octet pour octet, à celui de l'APK validé sur appareil.
