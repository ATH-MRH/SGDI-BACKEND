# ATLAS MOBILE

Application mobile officielle de l'ERP ATLAS pour iOS et Android. Elle consomme le backend ATLAS existant (FastAPI + PostgreSQL) : mêmes utilisateurs, mêmes permissions, mêmes données que le web. Aucune règle métier ni aucune base ne vit dans le téléphone.

Ce dossier est indépendant de `mobile/pointeur` (coquille Capacitor du Pointeur, `com.irongs.pointeur`), qui n'est pas modifié.

| | |
|---|---|
| Stack | Expo SDK 57, React Native 0.86, TypeScript strict, Expo Router |
| Identifiant iOS / Android | `com.irongs.atlas` (production) |
| Version | `package.json` → `version` ; numéros de build gérés par EAS |
| Environnements | `development`, `staging`, `production` (variable `APP_VARIANT`) |

## Démarrer

Prérequis : Node 22. Aucun Xcode ni Android Studio n'est nécessaire pour les contrôles ; ils le sont seulement pour compiler en local (sinon, EAS Build).

```bash
cd mobile/atlas
npm ci
cp .env.example .env        # renseigner EXPO_PUBLIC_API_URL
npm start
```

L'app utilise des modules natifs (stockage sécurisé) : elle se lance dans un **client de développement** (`eas build --profile development`), pas dans Expo Go.

### URL du backend en développement

Le backend filtre les comptes selon le sous-domaine de l'hôte appelé. Un compte non administrateur est refusé (403) si l'API est appelée par une adresse IP de réseau local ou par un hôte comme `api.…`. Sont acceptés : `localhost`, `127.0.0.1`, et tout hôte dont le premier label est `atlas`, `sgdi` ou `www`.

Sur un téléphone réel, utiliser donc un nom en `atlas.…` qui pointe vers le poste de développement (entrée DNS locale ou tunnel HTTPS), pas l'IP brute. Ce comportement est couvert par les tests d'intégration.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run typecheck` | Typage TypeScript |
| `npm run lint` | ESLint (configuration Expo) |
| `npm test` | Tests unitaires, UI et configuration de build |
| `npm run test:integration` | Tests contre le vrai backend du dépôt, sur SQLite jetable (`ATLAS_PYTHON` = Python avec les dépendances backend) |
| `npm run check:native [variante] [fonctions]` | Génère les projets iOS/Android et contrôle identifiants, permissions, ATS, sauvegardes (ex. `production biometrics,push`) |
| `npm run check:bundle` | Construit le bundle de production et y cherche secrets et URL codées en dur |
| `npm run verify` | Tout sauf l'intégration |

## Organisation

```
app.config.ts      Identité, variantes, permissions, configuration native
eas.json           Profils de build et de soumission
src/app/           Écrans (Expo Router) — un fichier = une route
src/api/           Client HTTP unique, erreurs normalisées, contrats backend
src/auth/          Session, stockage sécurisé, couche RBAC (refus par défaut)
src/scope/         Contexte de travail : société et site sélectionnés
src/lock/          Verrouillage biométrique local
src/offline/       File hors connexion des déclarations d'incident
src/push/          Notifications push : enregistrement de l'appareil, liens
src/employee/      Espace employé : client, session et jeton séparés de la session staff
src/features/      Règles d'accès par fonction, cockpit, tâches, modules
src/update/        Mise à jour requise
src/config/        Environnement, fonctions activables, version
src/components/ui/ Design system
src/i18n/          Textes (français, arabe)
src/theme/         Tokens alignés sur le design system web
tests/             Tests (hors de src/app pour ne pas créer de routes)
scripts/           Contrôles de build et banc d'intégration
docs/              Audit, architecture, stores, confidentialité, release
```

Les dossiers `ios/` et `android/` ne sont pas versionnés : ils sont générés à chaque build à partir de `app.config.ts`. Ne jamais les éditer à la main.

## Règles à ne pas enfreindre

- Aucun secret dans ce dossier, dans `eas.json`, ni dans une variable `EXPO_PUBLIC_*` (elles sont lisibles dans le binaire).
- Aucune URL d'API dans le code : elle vient de l'environnement de build.
- Tout appel réseau passe par `src/api`. Le jeton n'est stocké que par `src/auth/secureStorage.ts`.
- Masquer un bouton n'est pas une sécurité : le backend doit refuser l'action. Toute nouvelle action s'accompagne d'un test d'intégration du refus.
- Toute décision d'affichage liée aux droits passe par `src/auth/permissions.ts` ; toute donnée dépendante de la société ou du site utilise une clé de cache `queryKeys.scoped(...)`.
- Aucune permission système sans fonction livrée qui l'utilise (voir `docs/PRIVACY-DATA-SAFETY.md`).
- Aucun texte d'interface en dur : tout passe par `src/i18n`.

## Documentation

- [Audit du lot 0](docs/AUDIT-LOT0.md) — état du dépôt, du backend et des risques relevés
- [Architecture](docs/ARCHITECTURE.md)
- [Besoins backend](docs/BACKEND-NEEDS.md) — routes livrées sur la branche, endpoints manquants et écart RBAC assumé
- [Préparation stores, signature, CI/CD, versions, OTA](docs/STORE-READINESS.md)
- [Confidentialité : App Store Privacy et Google Play Data Safety](docs/PRIVACY-DATA-SAFETY.md)
- [Checklist de release](docs/RELEASE-CHECKLIST.md)
- [Premier build sur appareil](docs/DEVICE-BUILD.md)
