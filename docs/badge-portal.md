# Portail Studio Badges — badge.irongs.com

Interface dédiée à la gestion des badges du personnel IRON GLOBAL. Elle reprend le Studio Badges
de la DRH (voir `docs/drh-badge-studio.md`) sans le dupliquer : mêmes écrans, mêmes API, mêmes
données, mêmes droits.

## Architecture

| Élément | Choix |
|---|---|
| Application | La même application FastAPI et le même conteneur que les autres domaines ATLAS |
| Base | PostgreSQL `sgdi`, inchangée : ni table, ni migration, ni copie des employés |
| Page servie | Sur l'hôte `badge.irongs.com`, `/` sert le même `index.html` versionné qu'ATLAS (mêmes scripts, mêmes empreintes), marqué `window.__BADGE_AUTONOMOUS_APP__` (`app/main.py`, `_badge_portal_html`) |
| Interface | `renderBadgeStandaloneShell` (`sgdi-app.js`) : en-tête, menu des huit rubriques, société active, retour vers le Portail DRH, déconnexion. Le contenu est rendu par les écrans existants (`badges.js`, `badges-studio.js`) |
| Routes | Les huit écrans restent `#/drh/badges/<écran>`. Sur ce domaine, toute autre route ouvre le tableau de bord du portail |
| API | `/api/drh/badges/…`, identiques sur tous les domaines |

Aucun second service, aucune seconde instance FastAPI, aucun second processus de migration.

## Authentification et accès

- Les comptes ATLAS existants, sans second compte. La session est propre à chaque domaine (jeton
  dans le stockage du navigateur de ce domaine) : on se connecte sur `badge.irongs.com` avec ses
  identifiants ATLAS. Aucun jeton n'est jamais transmis dans une adresse.
- **Module dédié « Studio Badges »** (clé `badge`) : carte « Studio Badges — badge.irongs.com » à
  l'étape Modules de l'assistant utilisateur. Elle seule ouvre le portail : cocher DRH ne donne
  plus accès aux badges.
- Connexion sur ce sous-domaine (`app/modules/auth/routes.py`) : module `badge` exigé. Comptes
  historiques sans liste de modules : préfixe `DRH` exigé (`DEDICATED_LOGIN_RULES`).
- API `/api/drh/badges/…` (`API_MODULE_PREFIXES`, `auth/dependencies.py`) : module `badge` exigé,
  sur tous les domaines ; un compte « Studio Badges » sans module DRH y accède, un compte DRH seul
  reçoit 403. Le reste de `/api/drh` est inchangé.
- Droits fins : **Administration › Permissions › Studio Badges** (consultation, émission,
  révocation, impression, modèles et paramètres). Stockage inchangé (`drh` / `badges`) : aucune
  migration, les droits déjà attribués restent valables. Le périmètre société et les actions
  autorisées du compte s'appliquent toujours. Changer de domaine ne donne aucun droit.
- Après déploiement, cocher « Studio Badges » pour chaque compte qui gère les badges.

## Tableau de bord

Compteurs lus en base par `GET /api/drh/badges/dashboard` (filtres `society`, `site_id`) : badges
émis, actifs, expirés, à renouveler (expirés ou sous 30 jours), révoqués, perdus, employés sans
badge, sans photo, à imprimer ; dernières émissions et activité récente. Recherche rapide
(Entrée → Badges du personnel filtrés).

## Ce qui ne change pas

Studio graphique (dimensions, règles, guides, grille, zoom, calques, recto/verso), modèles et
versions, émission, révocation, épreuves SPÉCIMEN (permises en lecture seule), impression
individuelle et en lot, historique, paramètres, groupe sanguin (masqué par défaut, autorisation
avec référence, jamais public), QR et page publique de vérification `/public/badge/…` : les QR
déjà émis restent valides, leur adresse ne dépend pas du domaine du portail.

## DNS

`badge.irongs.com` résout déjà vers le serveur de production (même adresse que `drh` et `atlas`,
zone o2switch). Aucun enregistrement à créer.

## Coolify

Ajouter `https://badge.irongs.com` aux domaines de l'application ATLAS existante (dépôt
`ATH-MRH/SGDI-BACKEND`, branche `main`), puis redéployer : Traefik obtient le certificat
Let's Encrypt. Tant que ce domaine n'est pas déclaré, Traefik répond 503 avec son certificat par
défaut. Aucune autre configuration (pas de variable, pas de service supplémentaire).

## Déploiement en deux phases

1. **Phase A** (déployée) : le portail fonctionne sur `badge.irongs.com` ; la DRH garde sa
   rubrique Gestion des badges, ce qui laisse un retour immédiat.
2. **Phase B** (avec le module dédié) : la rubrique est retirée du menu DRH, le bouton
   « Créer / gérer le badge » de la fiche employé ouvre le portail, les anciennes routes
   `#/drh/badges/…` de la DRH y redirigent. Les API, données et QR ne bougent pas.

## Retour arrière

Aucune migration : redéployer l'image précédente suffit (phase A : la DRH retrouve sa rubrique
badges et l'accès par le module DRH). Pour couper seulement le portail, retirer le domaine
`badge.irongs.com` de Coolify. Ne jamais
utiliser une image antérieure à la révision Alembic en production.

## Maintenance

- Écrans : `app/static/js/modules/badges.js`, `badges-studio.js` (communs à DRH et au portail).
- Shell du portail : `renderBadgeStandaloneShell`, `ensureBadgePortalStyles` (`sgdi-app.js`).
- Tests : `tests/test_badge_portal.py`, `tests_frontend/badge-portal.test.js`.

## Guide utilisateur

1. Ouvrir `https://badge.irongs.com` (module « Studio Badges » requis), se connecter avec son compte ATLAS, choisir la société.
2. **Créer un badge** : rechercher l'employé (nom, matricule), vérifier les données de sa fiche
   et sa photo, choisir le modèle, ouvrir **Aperçu du badge** (badge seul ou réaliste, taille
   réelle), télécharger une **Épreuve PDF** (SPÉCIMEN, rien n'est émis).
3. **Émettre le badge** (droit d'émission), ou **Émettre puis imprimer**.
4. **Imprimer le badge** (droit d'impression) : carte au format exact ou planche A4 ; imprimer à
   100 %, sans « ajuster à la page ». Une réimpression est tracée sans nouvelle émission.
5. **Impression en lot** : filtrer, sélectionner, **Aperçu collectif**, puis imprimer.
6. **Studio de conception** et **Modèles** : personnaliser un modèle (droit de gestion des
   modèles), l'enregistrer, le définir par défaut.
