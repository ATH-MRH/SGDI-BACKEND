# Préparation à la publication — App Store et Google Play

Ce document décrit ce qui est en place et ce qui reste à fournir avant une première publication. **Rien n'a été publié, aucun compte n'a été créé, aucun identifiant de signature n'existe encore.**

## 1. Identité

| | iOS | Android |
|---|---|---|
| Production | bundle identifier `com.irongs.atlas` | applicationId `com.irongs.atlas` |
| Test | `com.irongs.atlas.staging` | `com.irongs.atlas.staging` |
| Développement | `com.irongs.atlas.dev` | `com.irongs.atlas.dev` |
| Nom public | ATLAS MOBILE | ATLAS MOBILE |
| Nom technique (slug Expo) | `atlas-mobile` | `atlas-mobile` |

Le préfixe `com.irongs` reprend la convention déjà utilisée par `com.irongs.pointeur` et le domaine `irongs.com`.

**À confirmer avant le premier envoi.** Un identifiant ne peut plus être changé une fois l'application créée sur un store. Si l'entité légale qui publie préfère `com.ironglobal.atlas`, il suffit de modifier `BASE_IDENTIFIER` dans `app.config.ts` tant qu'aucun build n'a été envoyé.

Icône et écran de lancement : des visuels provisoires sont fournis dans `assets/images`. Ils doivent être remplacés par les visuels officiels (icône 1024 × 1024 sans transparence, icône adaptative Android avec couche monochrome).

## 2. Versions

| Notion | iOS | Android | Source |
|---|---|---|---|
| Version publique | `CFBundleShortVersionString` | `versionName` | `version` dans `package.json` |
| Numéro de build | `CFBundleVersion` | `versionCode` | Compteur EAS, incrémenté à chaque build |

- Version au format `MAJEUR.MINEUR.CORRECTIF`. Elle est modifiée à la main, dans un commit, à chaque release.
- Les numéros de build ne sont pas dans le dépôt (`appVersionSource: remote`, `autoIncrement: true`). Deux builds ne peuvent pas porter le même numéro, et aucun commit n'est nécessaire pour un nouveau build.
- L'application affiche version et build sur l'écran de connexion et dans le profil, et les envoie au backend à chaque requête (`X-Atlas-App-Version`, `X-Atlas-App-Build`).

**Version minimale supportée et blocage d'une ancienne version.** Côté mobile, c'est en place depuis le lot 1 : l'écran « Mise à jour requise » se déclenche sur une réponse HTTP 426, ou sur la version minimale de `GET /api/mobile/config` quand la fonction `updateCheck` est activée. Côté backend, `GET /api/mobile/config` est écrit sur la branche mobile mais pas encore déployé (voir BACKEND-NEEDS) : tant qu'il ne l'est pas, et tant que les variables `MOBILE_MIN_VERSION_*` sont vides, aucune version n'est jamais bloquée.

## 3. Exigences techniques des plateformes

| Exigence | État |
|---|---|
| Android : SDK cible | 36 (Expo SDK 57). La règle Google Play en vigueur est à revérifier à chaque release |
| Android : SDK minimum | 24 (Android 7.0) |
| Android : format | Android App Bundle (`.aab`) pour les profils `staging` et `production` |
| Android : icône adaptative | Configurée, couche monochrome incluse |
| Android : trafic en clair | Interdit hors développement |
| Android : sauvegarde | `allowBackup` désactivé, jetons exclus des transferts d'appareil |
| iOS : version minimale | 16.4 (Expo SDK 57) |
| iOS : appareils | iPhone. L'iPad exécute l'app en mode compatibilité ; un support iPad natif demanderait des captures d'écran et une revue dédiées |
| iOS : App Transport Security | Chargements arbitraires interdits ; HTTP local fermé hors développement |
| iOS : chiffrement | `ITSAppUsesNonExemptEncryption = false` (HTTPS standard uniquement). **À valider** par le responsable de la publication |
| iOS : Face ID | Texte d'usage présent uniquement dans les builds incluant la fonction `biometrics` |
| iOS : manifeste de confidentialité | Généré, sans traçage. Les API déclarées sont celles du gabarit React Native ; à recouper avec le rapport de confidentialité Xcode du premier build |
| Langues | Français, arabe ; mise en page de droite à gauche activée |

Ces points sont contrôlés automatiquement par `npm run check:native` sur les projets natifs réellement générés.

## 4. Signature

**Principe : aucun identifiant de signature dans Git, ni dans GitHub.** Ils vivent dans le service d'identifiants d'EAS, chiffrés, et ne sont utilisés que par les machines de build.

### iOS

- Certificat de distribution et profils de provisionnement créés et renouvelés par EAS, à partir d'une clé d'API App Store Connect.
- Trois identifiants d'application à déclarer : production, test, développement.
- Le profil `development` est en distribution interne : les appareils de test doivent être enregistrés.

### Android

- Clé d'envoi (upload key) générée et conservée par EAS.
- **Google Play App Signing** activé à la création de l'application : Google détient la clé de signature finale. Une clé d'envoi perdue ou compromise peut alors être remplacée ; sans cela, la perte de la clé rend toute mise à jour impossible.
- Une copie de secours de la clé d'envoi est à conserver dans le coffre de l'entreprise, jamais dans un dépôt.

Le `.gitignore` du projet bloque `*.jks`, `*.keystore`, `*.p8`, `*.p12`, `*.mobileprovision`, `google-services.json`, `GoogleService-Info.plist` et les fichiers de compte de service.

## 5. Distribution

```
                    ┌─► TestFlight (testeurs internes) ───────────────┐
build staging ──────┤                                                 │  jamais promu
                    └─► Google Play — test interne ───────────────────┘  en production

                    ┌─► TestFlight interne ─► TestFlight externe ─► App Store
build production ───┤
                    └─► Play test interne ─► test fermé ─► production (déploiement progressif)
```

### TestFlight

1. Build `staging` (application « ATLAS MOBILE TEST ») : validation fonctionnelle sur l'environnement de test, testeurs internes uniquement.
2. Build `production` : version candidate, sur l'API de production, d'abord en test interne.
3. Test externe facultatif : il déclenche une revue Apple allégée et demande un compte de démonstration.

### Google Play

1. Test interne : jusqu'à 100 testeurs, disponible en quelques minutes.
2. Test fermé : groupe élargi. Pour un compte développeur personnel récent, Google impose un test fermé d'au moins 12 testeurs pendant 14 jours avant la production ; un compte d'organisation n'y est pas soumis. À vérifier selon le type de compte créé.
3. Production : déploiement progressif (par exemple 10 %, 50 %, 100 %).

`eas.json` est configuré pour n'envoyer que sur la piste de test interne, en brouillon. Le passage en test fermé puis en production se fait à la main dans les consoles.

### App Store — revue

À préparer : compte de démonstration avec un jeu de données réaliste, description de l'usage professionnel de l'application, captures d'écran, réponses au questionnaire de confidentialité (voir PRIVACY-DATA-SAFETY), coordonnées de support. Une application réservée aux employés d'une entreprise peut aussi être distribuée hors store public (Apple Business Manager, application non répertoriée) : c'est une décision à prendre avant la première soumission.

### Google Play — production

À préparer : fiche du store, classification du contenu, formulaire Sécurité des données, politique de confidentialité hébergée sur une URL publique, identifiants de test pour la revue.

## 6. CI/CD

| Workflow | Déclenchement | Contenu |
|---|---|---|
| `mobile-ci.yml` | Pull request ou push sur `main` touchant `mobile/atlas` ou l'authentification backend | Typage, lint, tests, compatibilité SDK, configuration native des trois variantes, bundle sans secret, intégration contre le backend |
| `mobile-build.yml` | **Manuel uniquement** | Contrôles, puis build EAS signé ; soumission optionnelle aux canaux de test |

Chaîne cible :

```
PR ─► mobile-ci ─► fusion ─► build manuel (staging) ─► TestFlight / test interne
                                    │
                            validation fonctionnelle
                                    ▼
              build manuel (production) ─► test interne ─► promotion manuelle
```

Aucun déploiement automatique en production n'est configuré, et aucun workflow ne publie sur un store public.

### Secrets et variables

| Nom | Où | Usage |
|---|---|---|
| `EXPO_TOKEN` | Secret GitHub | Seul secret côté GitHub : autorise le lancement des builds |
| `EAS_PROJECT_ID`, `EXPO_OWNER` | Variables GitHub et environnement EAS | Identifiants de projet, non secrets |
| `EXPO_PUBLIC_API_URL` | `eas.json` pour la production (`https://atlas.irongs.com`) ; environnements EAS `development` et `preview` pour les autres | URL du backend par variante (non secrète) |
| `ATLAS_FEATURES` | Environnements EAS | Fonctions incluses dans le build, par exemple `biometrics` |
| `ATLAS_LOCK_TIMEOUT_SECONDS` | Environnements EAS | Délai avant verrouillage biométrique (15 à 3600, défaut 120) |
| `ATLAS_STORE_URL_IOS`, `ATLAS_STORE_URL_ANDROID` | Environnements EAS | Liens des fiches store pour l'écran « Mise à jour requise », une fois l'application créée |
| Clé d'API App Store Connect | Identifiants EAS | Signature et envoi iOS |
| Certificat et profils iOS | Identifiants EAS | Signature iOS |
| Clé d'envoi Android et ses mots de passe | Identifiants EAS | Signature Android |
| Compte de service Google Play | Identifiants EAS | Envoi sur les pistes de test |

Les environnements GitHub `mobile-staging` et `mobile-production` sont à créer ; `mobile-production` doit exiger l'approbation d'un relecteur.

## 7. Mises à jour à distance (OTA)

`expo-updates` n'est pas installé dans ce lot. La politique de version d'exécution (`runtimeVersion: appVersion`) et les canaux (`staging`, `production`) sont déjà déclarés pour qu'il puisse l'être sans changer l'architecture.

| Peut passer en OTA | Exige un nouveau build store |
|---|---|
| Correction d'un bug JavaScript | Nouveau module natif ou mise à jour du SDK Expo |
| Ajustement de texte, de traduction, de mise en page | Nouvelle permission système |
| Correction d'un appel d'API existant | Changement d'icône, de nom, d'identifiant |
| | Nouvelle fonctionnalité significative ou changement d'objet de l'application |
| | Tout changement de la version publique |

Règles :

- Une mise à jour OTA ne sert jamais à introduire une fonction qui n'a pas été présentée à la revue Apple ou Google, ni à modifier le comportement décrit dans la fiche du store.
- Une mise à jour OTA n'est compatible qu'avec les builds de la même version publique.
- Publication d'abord sur le canal `staging`, puis `production`, avec possibilité de retour arrière.
- Les mises à jour sont signées (signature de code EAS) avant toute activation en production.

## 8. Prérequis à fournir par l'entreprise

Aucun de ces éléments n'a été créé ni demandé.

| Élément | Détail |
|---|---|
| Compte Apple Developer | Au nom de l'organisation (numéro D-U-N-S requis), 99 USD par an |
| App Store Connect | Rôle Administrateur ou Gestionnaire d'apps pour créer les applications et la clé d'API |
| Compte Google Play Console | Au nom de l'organisation, 25 USD une fois, vérification d'identité |
| Compte de service Google Play | Créé dans Google Cloud, avec le droit de publier sur les pistes de test |
| Compte Expo (organisation) | Propriétaire du projet EAS ; jeton d'accès pour la CI |
| Propriété | Les comptes doivent appartenir à l'entreprise, pas à une personne, avec au moins deux administrateurs |
| Environnement de test backend | Une instance ATLAS de validation, sur un hôte en `atlas.…`, en HTTPS |
| Nom de domaine de l'API | Hôte en `atlas.…` (voir AUDIT-LOT0, § 6) |
| Politique de confidentialité | Document public, rédigé et validé juridiquement |
| Visuels | Icône, écran de lancement, captures d'écran par taille d'appareil |
| Compte de démonstration | Pour les équipes de revue Apple et Google |

## 9. Première mise en route EAS

À faire une fois les comptes disponibles :

1. `npx eas-cli login`, puis `npx eas-cli init` dans `mobile/atlas` ; reporter l'identifiant de projet dans `EAS_PROJECT_ID` (variables GitHub et environnements EAS).
2. Définir `EXPO_PUBLIC_API_URL` dans les environnements EAS `development` et `preview` (la production est fixée dans `eas.json`).
3. `npx eas-cli credentials` pour créer les identifiants iOS et Android de chaque variante.
4. `npx eas-cli build --profile development` : premier client de développement, première exécution sur appareil.
5. Ajouter `EXPO_TOKEN` aux secrets GitHub et créer les environnements `mobile-staging` et `mobile-production`.
