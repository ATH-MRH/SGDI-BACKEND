# Audit — LOT MOBILE 0

> Des constats de sécurité backend ont été identifiés lors de l'audit et sont suivis séparément dans un rapport de sécurité privé. Ce document ne décrit que l'état fonctionnel et technique utile au projet mobile.

Audit réalisé le 7 octobre 2026 sur la branche `feat/atlas-mobile-v1`, à partir du commit `680b964` (identique à `origin/main`). Chaque constat indique s'il a été **vérifié par exécution** ou seulement **lu dans le code**.

## 1. Le dossier `/mobile` existant

`/mobile` ne contenait qu'un sous-projet, `mobile/pointeur` (116 fichiers, 2 commits).

| Élément | Constat |
|---|---|
| Nature | Coquille Capacitor 8.5 : une WebView qui charge `https://pointage.irongs.com` |
| Code applicatif | Aucun (`www/index.html` est un fichier vide de 226 octets) |
| Identifiants | iOS et Android : `com.irongs.pointeur`, nom « Pointeur ATLAS » |
| Version | 1.0 / build 1 |
| Cibles | Android min 24, cible 36 ; iOS 15.0 |
| Permissions | Caméra (scan QR) |
| Signature | Aucune configuration, aucun keystore, pas de `DEVELOPMENT_TEAM` |
| Tests, lockfile, documentation | Aucun |

**Décision.** Ce projet n'est pas une base pour l'ERP mobile : il n'a ni navigation, ni client API, ni authentification, et une WebView du site web ne répond pas à l'objectif d'une vraie application terrain. Il reste utile pour le Pointeur et **n'est pas modifié**. ATLAS MOBILE est créé à côté, dans `mobile/atlas`.

Point d'attention laissé en l'état : dans `mobile/pointeur/android/.gitignore`, les règles `*.jks`, `*.keystore` et `google-services.json` sont commentées. Un keystore déposé là pourrait être commité.

## 2. Backend

| Sujet | Constat |
|---|---|
| Framework | FastAPI 0.115, SQLAlchemy 2.0 synchrone, PostgreSQL, Alembic (59 révisions, une seule tête) |
| Routes | Toutes sous `/api/<module>/…`, sans version (`/api/v1` n'existe pas) |
| Frontend web | HTML et JavaScript statiques servis par le backend, variantes selon l'en-tête `Host` |
| Déploiement | Coolify, déclenché par `main` ; migrations exécutées au démarrage du conteneur |
| CI | `ci.yml` : pytest (SQLite) et tests frontend Node 22. Aucun job de déploiement |
| Docker | Aucun secret en `ARG`/`ENV` (pas d'alerte `SecretsUsedInArgOrEnv`). `mobile/` n'est pas copié dans l'image |
| Secrets versionnés | Aucun keystore, certificat ou `.env` réel dans l'arbre courant. Valeurs de test uniquement (`dev.sh`, `tests/conftest.py`, scripts de benchmark). L'historique Git n'a pas été analysé |

## 3. Authentification

- `POST /api/auth/login` (`{username, password}`) renvoie `{access_token, token_type, user}`.
- Jeton JWT transmis en `Authorization: Bearer`. Aucun cookie.
- `GET /api/auth/me` renvoie le profil avec les modules effectifs et le périmètre. La réponse de login ne contient pas ces valeurs calculées : il faut toujours appeler `/me`.
- L'utilisateur est relu en base à chaque requête : désactiver un compte prend effet immédiatement.
- Non disponibles à ce jour : refresh token, endpoint de logout, MFA. La déconnexion mobile est donc locale.

## 4. RBAC

- Les droits sont portés par le compte utilisateur : modules, actions, sociétés et sites autorisés, contrôlés par le backend à chaque requête.
- Un catalogue granulaire (modules × actions × fonctionnalités) existe côté backend.
- Aucun endpoint ne permet à un utilisateur de lire ses propres permissions granulaires. Le mobile masque donc par module et par action globale.
- Les vocabulaires diffèrent : les clés de modules appliquées sont `drh`, `ops`, `pointage`, `brq`, `site_workforce`, `recrute`, `conges`, `finances`… alors que le catalogue canonique parle de `attendance`, `finance`, `material`.

## 5. Multi-sociétés et multi-sites

- Pas de table des sociétés : une société est un libellé texte, comparé après normalisation.
- Les sites sont une table ; la société d'un site est rangée dans un champ JSON.
- Le périmètre d'un utilisateur : `authorized_societies`, `authorized_sites`, `global_society_access`.
- Le filtrage par périmètre est fait par le backend ; le mobile n'envoie jamais de périmètre « pour filtrer ».

## 6. Contrainte d'hôte — vérifiée par exécution

Le backend compare le premier label de l'en-tête `Host` aux modules du compte. Mesuré avec un compte non administrateur à modules explicites :

| Hôte appelé | Connexion |
|---|---|
| `atlas.…`, `localhost`, `127.0.0.1` | Acceptée |
| `api.…` | Refusée (403) |
| Adresse IP de réseau local | Refusée (403) |

Conséquence : l'API mobile doit être servie sur un hôte en `atlas.…`, en production comme en test. Les hôtes `pointeur.…` et `brq.…` sont recontrôlés à chaque requête.

## 7. API disponibles pour le mobile

**Réutilisables en l'état**

| Besoin | Endpoints |
|---|---|
| Connexion, profil | `POST /api/auth/login`, `GET /api/auth/me` |
| Indicateurs | `/api/ui/sidebar-stats`, `/api/attendance/board`, `/api/site-workforce/dashboard`, `/api/drh/dashboard`, `/api/alerts/stats` |
| Sites | `/api/ops/sites/page` (pagination et recherche), `/api/ops/sites/{id}` |
| Employés | `/api/drh/employees/page` (pagination, recherche), `/api/drh/employees/{id}`, portrait |
| Pointage | `/api/attendance/*` : consultation, correction, clôture, anomalies |
| Abandon de poste | `/api/portal/attendance-manual/abandon/context` et `/abandon` ; règle des 60 minutes recalculée côté serveur, idempotente |
| Alertes | `/api/alerts` et actions (acquitter, assigner, reporter, traiter) |
| BRQ | `/api/brq/situation`, `/presences`, `/absences`, `/abandons-poste`, `/sortants` (lecture seule) |
| Congés | `/api/drh/leaves`, approbation et refus |
| Rondes | `/api/ronde/portal/*` (jeton du portail employé) |

**Manquants côté backend**

| Besoin | Manque |
|---|---|
| Session | Refresh token, logout serveur |
| Mises à jour | Endpoint de version minimale supportée |
| Notifications push | Enregistrement de jeton d'appareil, envoi APNs/FCM. Seul le Web Push du portail employé existe |
| Mes tâches | Aucune boîte de réception unifiée des validations |
| Sociétés | Aucune ressource liste/détail |
| BRQ | Pas d'entité stockée : ni création, ni validation, ni transmission, ni PDF |
| Incidents | Pas d'API typée ; accès par le stockage générique historique, sans pagination ni pièces jointes |
| Documents | Pas d'envoi de fichier générique (multipart) |
| Portail employé | Pas de profil, contrat, planning ni bulletins pour le jeton employé |
| Consignes, NFC, synchronisation hors ligne | Absents |
| Pagination | Beaucoup de listes renvoient un tableau complet (congés, contrats, événements, BRQ, collections historiques) |

Les réponses d'erreur ont la forme `{"detail": …}`, où `detail` est une chaîne, une liste (validation Pydantic) ou un objet selon le module. Le client mobile normalise ces trois formes.

## 8. Sécurité backend

Des constats de sécurité backend ont été identifiés lors de l'audit et sont suivis séparément dans un rapport de sécurité privé.

## 9. Poste de développement

Xcode complet, Java et le SDK Android ne sont pas installés sur cette machine. Les binaires iOS et Android ne peuvent donc pas être compilés localement : ils passeront par EAS Build. Les contrôles de ce lot (typage, tests, génération des projets natifs, bundle JavaScript) ne nécessitent pas ces outils.
