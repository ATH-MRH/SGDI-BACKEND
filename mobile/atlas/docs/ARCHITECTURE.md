# Architecture ATLAS MOBILE

```
ATLAS WEB ─────────┐
                   ├──► API ATLAS (FastAPI, /api/…) ──► PostgreSQL
ATLAS MOBILE ──────┘
 iOS / Android
```

Le backend est la seule source de vérité. Le téléphone affiche, saisit et transmet ; il ne calcule aucune règle métier et ne possède aucun référentiel.

## Choix techniques

| Sujet | Choix | Raison |
|---|---|---|
| Framework | React Native 0.86 + Expo SDK 57 | Technologie cible de la mission ; le seul existant (`mobile/pointeur`) est une WebView sans code réutilisable |
| Langage | TypeScript strict, `noUncheckedIndexedAccess` | Les contrats d'API sont lâches côté backend : le typage strict force à traiter les cas absents |
| Projets natifs | Générés (`expo prebuild`), non versionnés | Une seule source de configuration, `app.config.ts`, contrôlée par des tests |
| Navigation | Expo Router, routes protégées (`Stack.Protected`) | Liens profonds et garde d'authentification déclaratifs |
| Données serveur | TanStack Query | Cache, invalidation, déduplication des appels, reprise sur erreur réseau |
| Stockage du jeton | `expo-secure-store` (Keychain iOS, Keystore Android) | Jamais AsyncStorage |
| Builds et signature | EAS Build / EAS Submit | Pas de Mac ni de keystore à gérer à la main ; identifiants chiffrés hors Git |

Volontairement absents à ce stade : gestionnaire d'état global (des contextes dédiés suffisent : session, périmètre, verrouillage), bibliothèque i18n (un dictionnaire typé couvre le besoin), `expo-updates` (voir STORE-READINESS, § OTA).

## Couches

```
Écrans (src/app)
   │  n'appellent jamais fetch directement
   ▼
Fonctions d'API par domaine (src/api/*.ts)      ← contrats typés
   ▼
Client HTTP unique (src/api/client.ts)          ← jeton, délai, erreurs
   ▼
Backend ATLAS
```

### Client HTTP

- Une seule instance, `api`, créée dans `src/api/index.ts`.
- N'accepte que des chemins commençant par `/api/`. Une URL absolue ou un chemin contenant `..` est refusé avant tout appel, pour que le jeton ne parte jamais vers un autre hôte.
- Ajoute `Authorization: Bearer …` sauf pour les appels marqués publics (login).
- Délai par défaut de 20 secondes. Distingue panne réseau et dépassement de délai.
- Envoie `X-Atlas-Client`, `X-Atlas-App-Version` et `X-Atlas-App-Build` : le backend pourra s'en servir pour bloquer une version trop ancienne.
- Envoie un `X-Correlation-Id` par requête, repris par le journal d'audit du backend. Sur une erreur serveur, ses huit premiers caractères sont affichés comme référence pour le support.
- Signale les 401, 403 et 426 à la session (voir « Refus du backend »).

### Erreurs

`ApiError` porte un type (`network`, `timeout`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `validation`, `rate_limited`, `upgrade_required`, `invalid_response`, `server`, `config`, `unknown`), le message métier du backend quand il existe, et les erreurs par champ.

- Le champ `detail` du backend est normalisé quelle que soit sa forme (chaîne, liste Pydantic, objet).
- Le texte d'une erreur 5xx n'est jamais affiché : il peut contenir des détails internes.
- Chaque type a un message générique traduit et une action associée (`errorAction`) : réessayer, se reconnecter, revenir ou mettre à jour. `ErrorState` les applique partout de la même façon.

## Authentification et session

```
Démarrage ─► écran de restauration ─► session stockée et non expirée ?
                                          │ non ─► connexion
                                          ▼ oui
                                     GET /api/auth/me
                          401/403 ◄───────┼───────► réseau indisponible
                     session effacée      │ 200       écran « Réessayer / Se reconnecter »
                          ▼               ▼
                      connexion      verrou biométrique (si activé) ─► application
```

- **Connexion** : `POST /api/auth/mobile/login`, puis `GET /api/auth/me`. Le profil de `/me` fait foi, car lui seul contient les modules effectifs. Sur un backend antérieur à cette route (404), l'application retombe sur `POST /api/auth/login`, sans session renouvelable.
- **Contrôle de la réponse** : la session n'est ouverte que si la réponse contient un jeton Bearer typé `token_use = "staff"` avec une échéance future. Un jeton sans type est refusé.
- **Ce contrôle n'autorise rien.** Les claims lus localement servent à fermer la session à l'heure et à écarter une réponse inattendue. Chaque action reste décidée par le backend.
- **Stocké sur l'appareil** : le jeton d'accès, le refresh token et leurs échéances. Jamais le mot de passe, jamais le profil.
- **Restauration** : aucun écran protégé n'est monté tant que `/me` n'a pas répondu ; un écran de restauration est affiché. Une session qui n'est plus renouvelable est effacée sans appel réseau.
- **Déconnexion** : `POST /api/auth/logout` révoque la session côté serveur, puis l'application efface le jeton, la mémoire, le cache de données, le contexte société/site et le réglage de verrouillage. Hors ligne, la fermeture locale a lieu quand même ; la session serveur s'éteint alors à son échéance.

### Session renouvelable

| Élément | Durée par défaut | Rôle |
|---|---|---|
| Jeton d'accès | 30 minutes | Jeton staff envoyé à chaque requête, lié à la session par le claim `sid` |
| Refresh token | 30 jours sans activité | Opaque, à usage unique ; le backend n'en conserve qu'un condensat SHA-256 |
| Session | 90 jours au plus | Au-delà, reconnexion obligatoire |

- **Rotation** : chaque renouvellement (`POST /api/auth/refresh`) remplace le refresh token. Le nouveau est écrit aussitôt dans le stockage sécurisé.
- **Réutilisation** : présenter un refresh token déjà consommé révoque toute la session. C'est le signe d'une copie du jeton.
- **Un seul renouvellement à la fois** : les requêtes concurrentes partagent le même échange (`renewSession`), sinon elles révoqueraient la session entre elles.
- **Quand** : avant une requête si le jeton d'accès a expiré, ou après un 401. La requête est alors rejouée une seule fois.
- **Panne réseau pendant le renouvellement** : la session est conservée. Seul un refus du backend la ferme.
- **Révocation** : la déconnexion, un changement de mot de passe et la désactivation du compte révoquent les sessions ; leurs jetons d'accès sont refusés immédiatement.

### Retour au premier plan

Dans l'ordre : échéance de la session (fermée si elle n'est plus renouvelable), verrouillage biométrique si le délai est écoulé, puis rechargement de `/me` au plus une fois par minute. Le contexte société/site est recalculé à partir du nouveau profil. Si le réseau manque, le profil connu est conservé : le backend contrôle de toute façon chaque appel.

### Refus du backend

| Réponse | Effet |
|---|---|
| 401 sur un appel authentifié | Un renouvellement puis un nouvel essai ; si le refus persiste, session fermée une seule fois et retour à la connexion |
| 401 à la connexion | Message « identifiants incorrects », aucune session |
| 403 | Session conservée ; le profil est rechargé (au plus une fois par minute) car des droits ont pu être retirés |
| 426 | Écran « Mise à jour requise » |

## RBAC

Deux niveaux, aux rôles bien distincts :

1. **Backend — la sécurité.** Chaque requête est contrôlée (module, action, société, site).
2. **Mobile — l'affichage.** `src/auth/permissions.ts` est la seule source de décision d'affichage ; aucun écran ne refait ce calcul.

| Fonction | Règle |
|---|---|
| `canAccessModule(user, module)` | Module présent dans `effective_modules`, ou accès global. Sans modules effectifs : refus |
| `canPerform(user, module, action)` | Module accordé **et** action explicite. Sans action explicite : consultation seule |
| `canAccessSociety(user, society)` | Accès global, ou société dans la liste du compte (même normalisation que le backend) |
| `canAccessSite(user, site)` | Site dans la liste explicite du compte ; à défaut de liste, société du site autorisée |

Le mobile ne doit jamais être plus permissif que le backend (voir BACKEND-NEEDS, « Règle d'affichage des actions »).

Le menu des modules est construit à partir de `canAccessModule`. La route d'un module refait le contrôle : un lien direct vers un module non accordé affiche « Accès non autorisé ».

## Contexte société / site

`CurrentScope` (`src/scope`) porte la société et le site sélectionnés, les options proposables et la possibilité d'en changer.

- Les options viennent uniquement du backend : sociétés de `/me`, sites des listes déjà filtrées côté serveur, repassés par `canAccessSite`.
- Une seule société ou un seul site autorisé : sélection automatique, aucun écran de choix.
- Plusieurs : écran « Contexte de travail », avec l'option « tout ce qui m'est autorisé ».
- La sélection est mémorisée par utilisateur (identifiants seulement) et **revalidée à chaque calcul** : une société ou un site retiré disparaît de la sélection, sur l'écran comme sur le disque.
- Une valeur nulle signifie « tout mon périmètre », jamais « tout ATLAS » : c'est le backend qui filtre.
- Changer de contexte n'invalide que les données rangées sous la clé de cache `scoped`.

## Verrouillage biométrique local

Inclus seulement si la fonction `biometrics` est activée au build. Il protège une session déjà ouverte ; il ne remplace jamais la connexion ATLAS.

- La vérification est faite par le système (Face ID, Touch ID, biométrie Android), avec le code de l'appareil en secours. ATLAS ne reçoit que « réussi » ou « échoué ».
- Activation volontaire dans Profil → Sécurité, après une vérification réussie. Désactivation soumise à la même vérification.
- Seul le choix d'activation est mémorisé, par utilisateur.
- À froid, une session verrouillable démarre verrouillée et aucun écran protégé n'est monté avant le déverrouillage.
- En arrière-plan plus longtemps que le délai (120 secondes par défaut, `ATLAS_LOCK_TIMEOUT_SECONDS`), l'application se verrouille au retour.
- Une seule demande automatique par verrouillage ; ensuite l'utilisateur relance. La fenêtre système ne peut pas redéclencher un verrouillage.
- Cinq échecs consécutifs ferment la session. « Se reconnecter » est toujours proposé.

Aperçu dans le sélecteur de tâches : `PrivacyShield` masque le contenu dès que l'application quitte le premier plan. C'est efficace sur iOS. Sur Android, l'aperçu peut être capturé avant le masquage ; une protection complète demanderait le drapeau natif `FLAG_SECURE`, qui bloque aussi les captures d'écran. La fonction `secureScreen` le pose (via `expo-screen-capture`) ; elle est désactivée par défaut, car elle empêche aussi les captures utiles au support.

## Mise à jour requise

L'écran existe et se déclenche sur deux signaux serveur : une réponse HTTP 426, ou la version minimale de `GET /api/mobile/config` (fonction `updateCheck`). `GET /api/mobile/config` existe sur cette branche et renvoie aussi un mode maintenance et les liens des fiches store ; sans réglage côté serveur, rien n'est jamais bloqué. Le bouton « Mettre à jour » n'apparaît que si le lien de la fiche store est fourni au build.

## Environnements

| Variante | Nom affiché | Identifiant | API |
|---|---|---|---|
| `development` | ATLAS MOBILE DEV | `com.irongs.atlas.dev` | Backend local ; HTTP local autorisé |
| `staging` | ATLAS MOBILE TEST | `com.irongs.atlas.staging` | Environnement de validation, HTTPS obligatoire |
| `production` | ATLAS MOBILE | `com.irongs.atlas` | Production, HTTPS obligatoire |

- La variante est fixée au build par `APP_VARIANT` (profil EAS). Elle n'est pas modifiable dans l'application.
- L'URL vient de `EXPO_PUBLIC_API_URL` : fixée dans `eas.json` pour la production (`https://atlas.irongs.com`), définie dans l'environnement EAS pour le staging. Elle n'apparaît nulle part dans le code. `app.config.ts` fait échouer le build si elle manque ou n'est pas en HTTPS hors développement ; `src/config/env.ts` la revalide au lancement.
- Les trois variantes ont des identifiants distincts : elles s'installent côte à côte, et un build de test ne peut pas être promu en production par erreur.
- Hors production, un badge indique l'environnement à l'écran.

Il n'existe pas aujourd'hui d'environnement backend de staging identifié : c'est un prérequis avant les premiers tests TestFlight (voir STORE-READINESS).

## Fonctions activables

`biometrics`, `gps`, `nfc`, `ai`, `employeeCreation`, `offline`, `finance`, `push`, `updateCheck`, `employeePortal`, `secureScreen` : toutes désactivées par défaut, activées au build par `ATLAS_FEATURES`. Une valeur inconnue fait échouer le build. Un module métier peut être rattaché à une fonction (`src/features/modules.ts`).

Ces drapeaux masquent une fonction incomplète. Ils ne remplacent pas le contrôle de permission du backend.

## Espace employé

Derrière la fonction `employeePortal` (`src/employee`, écran `/employee`). Un employé n'est pas un utilisateur staff : il a son propre accès, limité à ses données, en lecture.

| | Session staff | Session employé |
|---|---|---|
| Connexion | `POST /api/auth/mobile/login` | `POST /api/employee-mobile/login` (compte du portail employé) |
| Famille de jeton | `token_use = "staff"` | `token_use = "employee_mobile"` |
| Client HTTP | `api` | `employeeApi` |
| Stockage | `atlas.session.v1` | `atlas.employee.v1` |
| Écrans | onglets, modules | `/employee` uniquement |

- **Aucun mélange** : chaque côté refuse le jeton de l'autre, sur le téléphone (contrôle de la réponse de connexion et du jeton stocké) comme sur le backend (chaque route n'accepte que sa famille).
- **Rattachement** : le compte du portail porte un matricule ; la fiche employé est celle dont le matricule est exactement celui-là. Jamais de rapprochement par nom, e-mail ou identifiant numérique.
- **Pas d'identifiant en paramètre** : les routes `/api/employee-mobile/me/…` ne prennent aucun identifiant d'employé. La fiche vient du jeton.
- **Contenu** : profil, planning (sans les collègues), pointage, absences, congés, liste des documents (sans fichier), bulletins de paie validés (montants de la paie ATLAS, sans PDF).
- **Révocation** : pas de refresh token. À chaque requête, le backend revérifie que le compte est actif, que le mot de passe n'a pas changé et que le salarié n'est pas suspendu. Jeton de 8 heures.
- **Non livré** : notifications de l'employé, dépôt de demande, téléchargement de document, verrouillage biométrique de cet espace.

## Mode hors connexion

Limité à la déclaration d'incident, derrière la fonction `offline` (`src/offline`).

```
saisie ─► envoi direct ─► accepté ─► incident enregistré
              │ réseau absent ou délai dépassé
              ▼
   file locale (stockage sécurisé) ── pending ─► syncing ─► accepté : retiré de la file
                                                    ├─► refus du backend : failed (affiché, à renvoyer ou supprimer)
                                                    └─► conflit : conflict (le backend fait foi)
```

- **Une saisie en attente n'est pas un incident.** Elle est affichée à part, avec son état, tant que le backend ne l'a pas acceptée.
- **Pas de doublon** : chaque déclaration porte un identifiant généré sur le téléphone, repris par l'envoi direct et par la file. Rejouer l'envoi met à jour la même ligne (vérifié contre un vrai backend).
- **Un refus n'est jamais mis en file ni rejoué en silence** : seules les pannes réseau le sont.
- **Stockage** : Keychain / Keystore, découpé en morceaux de 600 caractères avec bascule atomique ; dix saisies au plus.
- **Par utilisateur** : la file est liée au compte qui a saisi. Elle survit à une déconnexion, pour ne pas perdre un rapport de terrain, mais elle est effacée sans être lue dès qu'un autre compte se connecte.
- **Envoi** : à l'ouverture, au retour au premier plan, toutes les minutes tant qu'il reste une saisie, et sur demande. Dans l'ordre de saisie ; l'envoi s'arrête à la première panne réseau.
- **Conflits** : aucune modification hors connexion n'existe aujourd'hui, seulement des créations. Le jour où une modification sera mise en file, elle devra porter la version lue et le backend devra la refuser si elle a changé.

## Notifications push

Derrière la fonction `push` (`src/push`). Sans elle, ni la capacité iOS ni les permissions Android ne sont dans le binaire.

- **Autorisation** : demandée uniquement quand l'utilisateur appuie sur « Activer les notifications » dans son profil.
- **Enregistrement** : `POST /api/mobile/devices` avec le jeton de l'appareil, la plateforme, l'environnement et la version. Le backend lie l'appareil à la session ; une session révoquée ou expirée rend l'appareil inéligible.
- **Toucher une notification** : seule une route interne connue est ouverte (`src/push/links.ts`), jamais une URL. L'écran repasse par la session, les droits et le périmètre.
- **Envoi** : `app/modules/mobile/push.py`, `notify_user(db, user_id, catégorie, route)`. Désactivé par défaut (`PUSH_PROVIDER=disabled`) et appelé par aucun traitement métier à ce jour : rien n'est envoyé. Le texte vient d'une liste fixe par catégorie (`critical`, `incident`, `attendance`, `hr`, `system`) ; une notification ne porte aucune donnée métier, seulement une route interne.
- **Fournisseur** : Expo Push Service en V1 (`ExpoPushProvider`). Le fournisseur est une interface (`PushProvider`) : passer en APNs/FCM directs revient à en écrire un autre, sans toucher aux appelants ni au registre (`provider`). Un jeton que le fournisseur déclare invalide révoque l'appareil.

## Design system

Tokens (`src/theme/tokens.ts`) repris du design system web (`app/static/design-system/tokens.css`) : mêmes couleurs, mêmes espacements, mêmes rayons.

Composants livrés : `AppText`, `Button`, `Card`, `Badge`, `StatusBadge`, `Kpi`, `ListItem`, `OptionRow`, `Segmented`, `Avatar`, `FormField`, `SearchBar`, `PagedList`, `ConfirmDialog`, `Screen`, `ScreenHeader`, `Loader`, `Skeleton`, `EmptyState`, `ErrorState`.

À créer avec les écrans qui en auront besoin : `FilterSheet`, `BottomSheet`, `DatePicker` (les dates sont saisies au clavier), `FileUploader`, `PhotoUploader`.

Règles : cible tactile de 48 points minimum ; un statut est toujours écrit, la couleur ne fait que le renforcer ; chaque élément interactif a un libellé d'accessibilité ; thème clair uniquement. Le mode sombre n'est pas livré : les écrans lisent les couleurs comme des constantes, il faudra d'abord les faire passer par un thème.

## Internationalisation

Français (référence) et arabe. Un test vérifie que chaque langue couvre toutes les clés et les mêmes paramètres. La mise en page de droite à gauche est activée au niveau natif. Les textes arabes doivent être relus par un locuteur natif avant publication.

## Navigation

```
/login                   hors session
/(tabs)/                 Accueil : cockpit selon les droits et le contexte
/(tabs)/tasks            Tâches à traiter
/(tabs)/alerts           Alertes ; /alerts/[id] détail et actions
/(tabs)/modules          Modules accordés au profil
/(tabs)/profile          Profil, périmètre, sécurité, notifications, version, déconnexion
/scope                   Contexte de travail (société, site)
/module/[key]            Entrée d'un module, avec garde d'accès
/ops/sites               Sites ; /ops/sites/[id] effectifs, pointage du jour, planning
/attendance              Effectifs et pointage ; /attendance-correct correction motivée d'une ligne
/abandons                Abandons de poste ; /abandons/new déclaration
/incidents               Incidents et saisies en attente ; /incidents/new déclaration
/brq                     Bulletin de renseignement quotidien
/drh/employees           Employés ; /drh/employees/[id] fiche, pointage, congés, documents
/drh/leaves              Congés à valider ; /drh/leave-request dépôt d'une demande
/recruitment             Candidats
/employee                Espace employé (session employé uniquement)
```

Liens profonds : le schéma de l'application (`atlas://`, `atlas-staging://`, `atlas-dev://`) ouvre ces mêmes routes, par exemple `atlas://alerts/12`. Toutes sont sous la garde de session, et chaque écran applique sa garde de droits (`Gate`).

Au-dessus de la navigation, dans cet ordre : mise à jour requise, restauration de session, verrouillage biométrique.

## Tests

| Niveau | Contenu | Commande |
|---|---|---|
| Unitaires | Environnement, client HTTP et renouvellement du jeton, erreurs, permissions, stockage, jeton, périmètre, règle de verrouillage, versions, i18n, file hors connexion, cibles de notification, contrats par domaine | `npm test` |
| Intégration simulée | Session (connexion, restauration, expiration, refus, retour au premier plan, déconnexion), périmètre mémorisé et revalidé, verrouillage biométrique | `npm test` |
| UI | Connexion, restauration, cockpit, tâches, alertes, sites, pointage, abandons, incidents (dont hors connexion), BRQ, employés, congés, candidats, modules dynamiques, garde de module, contexte de travail, profil, verrouillage, mise à jour requise, navigation réelle | `npm test` |
| Build | Identifiants, versions, HTTPS, fonctions, permissions, secrets dans la configuration | `npm test` |
| Intégration réelle | Vrai backend du dépôt sur SQLite jetable : connexion, jeton typé staff, profil, jeton absent/invalide/expiré, jetons des autres familles (portail client, portail employé, QR, ticket SSE), module interdit, société interdite, site hors périmètre, payload invalide, contrainte d'hôte, session renouvelable (rotation, réutilisation, déconnexion), rejeu d'une déclaration d'incident sans doublon | `npm run test:integration` |
| Natif | Manifeste Android et Info.plist générés, pour les trois variantes et pour le build avec biométrie, notifications et hors connexion | `npm run check:native` |
| Bundle | Recherche de secrets et d'URL codées en dur | `npm run check:bundle` |

Les tests d'intégration réelle tournent aussi en CI à chaque modification de `mobile/atlas` ou des modules backend d'authentification et de configuration mobile : une évolution du backend qui casserait le contrat mobile est détectée avant la fusion.

Ce que ces tests ne couvrent pas : l'exécution sur un appareil ou un simulateur. Elle n'a pas été possible sur le poste de développement (pas de Xcode ni de SDK Android) et se fera avec le premier client de développement EAS.
