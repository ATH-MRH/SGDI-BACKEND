# IRON Emploi — application mobile

Portail emploi iOS et Android du groupe IRON GLOBAL, relié au backend ATLAS et à recrute.irongs.com.
Application React Native / Expo (SDK 57, Expo Router), écrans natifs, aucun WebView.

Elle remplace « IRON Recrutement » en conservant son identifiant (`com.irongs.recruitment`) : c'est une mise à jour, pas une nouvelle application.

## Ce que fait l'application

Les écrans de l'application, au style de la maquette « IRON EMPLOI », avec des données réelles :

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

Le style suit la maquette « IRON EMPLOI — Un espace emploi pensé pour vous » et s'applique à tous les écrans.

- **Thème commun** (`src/components/ui.tsx`) : bleu nuit `#14243B`, doré `#B48C42` réservé aux accents, fond `#F5F6F8`, cartes blanches, texte secondaire `#667085`, bordures `#E4E7EC` ; titres 28, sections 19, texte 15–16, secondaire 12–14 ; cartes arrondies de 16, boutons de 50 points, zones tactiles d'au moins 44 points.
- **Composants partagés** : carte d'offre (`offer-card.tsx`), recherche avec localisation (`search-panel.tsx`), champs à liste, calendrier, montant et chiffres (`fields.tsx`, `date-field.tsx`), progression d'une candidature (`application-state.tsx`), en-tête des écrans secondaires (`tab-stack.tsx`).
- **Police** : Arial pour tous les textes. Sur iOS c'est l'Arial du système. Sur Android, où Arial n'existe pas et ne peut pas être embarquée sans licence, l'application affiche Arimo (licence libre, mêmes largeurs de caractères) — ce n'est pas Arial ; voir `assets/fonts/LISEZ-MOI.md`. Les dialogues et calendriers du système gardent la police du téléphone.
- **Icônes** vectorielles d'une même famille, dessinées pour l'application (`src/components/icon.tsx`) ; aucun emoji.
- **Illustrations** : images générées par IA, sans logo ni personne réelle ; origine et droits dans `assets/photos/SOURCES.md`.
- **Sociétés** : le logo servi par le serveur quand il existe, sinon un monogramme aux initiales. Aucun logo n'est inventé.
- **Données** : rien de fictif dans l'application. Les compteurs, salaires, états et étapes affichés viennent du serveur ; un salaire n'apparaît que s'il est renseigné, avec sa période seulement si elle est connue.

## Notifications

Les notifications dans l'application sont réelles : elles sont créées par le serveur (réception, changement d'état, message, entretien, nouvelle offre) et relues à l'ouverture et toutes les minutes. Chaque nouvelle offre publiée est envoyée à tous les téléphones enregistrés, sans alerte ni réglage ; les alertes ajoutent une notification dans l'application pour les offres qui leur correspondent.

Les listes d'offres (accueil et « Offres ») se relisent d'elles-mêmes au retour sur l'écran, au retour dans l'application et toutes les minutes, sans attente affichée. Si l'application a démarré avant l'ouverture des annonces ou sans réseau, elle réessaie de la même façon et passe en mode annonces sans redémarrage.

Dans « Votre espace emploi », chaque notification tient sur deux lignes ; la toucher ouvre son détail, avec un bouton vers l'écran concerné.

### Notifications push

Ce qui est en place :

- le module `expo-notifications` et son réglage dans `app.json` ; `app.config.js` y ajoute `android.googleServicesFile` quand EAS fournit la variable de type fichier `GOOGLE_SERVICES_JSON` ;
- `src/lib/push.tsx` : demande d'autorisation (une seule fois, à la première ouverture de l'espace candidat, puis depuis Paramètres), canal Android `iron-emploi` en importance haute (bannière et son, aussi application ouverte), enregistrement du jeton auprès du serveur, relecture des pastilles à la réception, ouverture de l'écran concerné quand la notification est touchée, désinscription de ce téléphone à la déconnexion ;
- côté serveur : appareils, préférences par famille, relais vers le service Expo, désactivé tant que `RECRUITMENT_PUSH_ENABLED` n'est pas à `true`.

Ce qui manque pour les activer — **aucun envoi réel n'a encore été essayé** :

| Élément | Où le créer | Où le déposer |
|---|---|---|
| Projet EAS (`projectId`) | `npx eas-cli@latest init`, avec le compte Expo de l'éditeur | `app.json` → `extra.eas.projectId` (ce n'est pas un secret) |
| Android — clé FCM V1 | Console Firebase : projet, application Android `com.irongs.recruitment`, puis compte de service | `google-services.json` en variable EAS de type fichier `GOOGLE_SERVICES_JSON` (`eas env:create`) ; clé du compte de service envoyée à Expo par `eas credentials` ; ni l'un ni l'autre dans Git |
| iOS — clé APNs | Compte Apple Developer (payant), identifiant `com.irongs.recruitment` avec « Push Notifications » | Gérée par `eas credentials` ; rien dans Git |
| Version installable | `eas build` (Expo Go ne reçoit pas de push distant) | Téléphones d'essai |
| Ouverture côté serveur | `RECRUITMENT_PUSH_ENABLED=true` sur le serveur de recette d'abord | Variables du serveur |

Tant qu'un élément manque, l'écran Paramètres dit lequel (Expo Go, simulateur, configuration absente, autorisation refusée) au lieu d'afficher un faux état actif.

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

### Environnement d'essai local (iPhone et Samsung, Expo Go)

Un serveur local, une base PostgreSQL isolée et des données fictives ; rien ne touche la production ni SMSGate. Il faut la copie de travail du serveur (branche `feat/iron-emploi`) à côté de celle-ci, ou son chemin dans `ATLAS_BACKEND`.

```sh
sh scripts/test-env/start-backend.sh   # base, migrations, annonces et candidat fictifs, serveur sur le Wi-Fi
sh scripts/test-env/start-app.sh       # application reliée à ce serveur, QR code à scanner
sh scripts/test-env/sms-code.sh        # affiche le code demandé dans l'application
sh scripts/test-env/stop.sh            # arrêt ; « --effacer » supprime aussi la base et les fichiers
```

1. Installer **Expo Go** (App Store, Play Store). Téléphones et Mac sur le même Wi-Fi.
2. Scanner le QR code : appareil photo sur iPhone, Expo Go sur Samsung.
3. Pour s'identifier, saisir n'importe quel numéro algérien fictif, par exemple `0770 12 34 56` (candidat déjà pourvu de candidatures, messages et entretien), puis lancer `sms-code.sh` sur le Mac et recopier le code.

**Pourquoi aucun SMS n'arrive** : dans cet environnement le serveur est réglé sur le fournisseur `poll`. Il ne contacte ni SMSGate ni un opérateur ; il met le message en file pour une passerelle. Une passerelle locale, lancée avec le serveur d'essai et munie d'une clé tirée au hasard pour cette base, reste à l'écoute (sans elle le serveur refuse d'émettre un code) et note chaque code dans `.test-env/codes.log` ; `sms-code.sh` affiche les derniers. Le code reste vérifié par le serveur, avec ses limites d'essais et de durée. En production le fournisseur est SMSGate : cette file n'y est pas servie et la clé locale n'y existe pas.

Les secrets locaux, les journaux et les pièces déposées vont dans `.test-env/`, ignoré par Git. L'espace recruteur de cet environnement est à `http://<adresse-du-Mac>:8765/static/recrute.html` (identifiants dans `.test-env/env`).

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

## Formulaires et protection des données

- **Dates** : choisies dans le calendrier du téléphone, affichées JJ/MM/AAAA, transmises AAAA-MM-JJ. La date de naissance ne peut être ni future ni celle d'un mineur de moins de 19 ans (règle du serveur).
- **Listes** : nombre d'enfants de 0 à 15 (« non renseigné » distinct de 0), taille en cm, pointure, taille de chemise, langues parlées et écrites (sélection multiple, Kabyle inclus). Une valeur déjà enregistrée hors liste reste proposée.
- **NIN** : clavier numérique, chiffres uniquement, conservé comme texte (zéros initiaux), 10 ou 18 chiffres comme dans le dossier de recrutement.
- **Adresse** : Wilaya → Commune → Adresse ; la commune est vidée si elle n'appartient pas à la nouvelle wilaya.
- **Poste souhaité** : liste avec recherche, et saisie libre d'un poste absent.
- **Salaire demandé** : « 50 000,00 DA » hors saisie ; transmis comme un nombre à deux décimales.
- **Profil et candidature** : « Enregistrer mon profil » n'envoie rien au recruteur. Une candidature part seulement par « Envoyer ma candidature », après vérification de l'offre, des informations et des pièces.
- **Consentement** : case non cochée par défaut près de l'enregistrement du profil, notice « Protection des données personnelles » (`src/lib/privacy.ts`, écran `/privacy`). Le serveur contrôle et enregistre la version de la notice et la date ; il ne le redemande pas tant que la notice ne change pas. Ce consentement est distinct des réglages de notifications.

La notice porte les informations confirmées par la direction le 11 octobre 2026 : responsable du traitement (SARL IRON GLOBAL SOLUTION) et contact, déléguée à la protection des données, hébergeur et prestataires, durées de conservation, adresse d'exercice des droits. Deux rubriques restent marquées « À préciser par IRON GLOBAL avant la mise en service » : la référence et la date de la formalité ANPDP, et le fondement du transfert hors d'Algérie (`pendingItems()`, contrôlé par `npm test`). Elles ne sont pas inventées ; l'application n'est présentée ni comme agréée ni comme validée par l'ANPDP. Les durées affichées sont des engagements : aucune suppression automatique n'existe côté serveur (voir `docs/iron-emploi-mise-en-production.md`).

## Limites connues

- Aucun essai n'a eu lieu sur un iPhone ou un Samsung : la revue visuelle s'est faite dans l'aperçu web (320, 375, 390 et 430 points de large).
- Notifications push préparées mais non activées et jamais essayées en réel (voir plus haut). « En ligne » n'est jamais affiché dans les messages : la présence n'est pas mesurée.
- Les messages n'acceptent pas de pièce jointe ; les pièces demandées se déposent depuis le détail de la candidature.
- Un même numéro de téléphone ne peut ouvrir qu'un espace, sous le nom utilisé à la première inscription.
- Les dates se saisissent au format AAAA-MM-JJ.
- L'aperçu web (`npx expo start --web`) sert à la revue d'interface ; il n'est pas un produit distribué.
