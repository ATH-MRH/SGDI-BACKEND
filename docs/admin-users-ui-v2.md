# ATLAS ADMINISTRATION — GESTION DES UTILISATEURS V2

## Git

Refonte initiale préparée sur `feat/admin-users-ui-v2` depuis `c94d710`,
avec les commits locaux `5d04ae1` et `1d40554`.

Intégration pour publication le 27 septembre 2026 sur
`fix/admin-users-ui-release`, depuis le nouveau `origin/main` `e1a9103`.
Les cinq commits BEO multi-sociétés / multi-sites déjà publiés sont conservés.
Les seuls conflits concernaient les versions de cache de `index.html` et du
registre des modules ; elles utilisent désormais `20260927-admin-users-v2`.
Les deux champs de périmètre de la refonte et les règles BEO du formulaire
sont conservés ensemble. Les autres worktrees restent intacts.

Validation de cette intégration : `npm test`, **605 réussis, aucun échec ni
test ignoré** (73,38 s). Backend ciblé (`test_auth`, `test_beo_host_login`,
`test_admin_site_workforce_module`, `test_site_workforce_multi`,
`test_site_workforce`) : **102 réussis, 1 ignoré** (19,35 s). Le seul test
ignoré concerne les fonctions PostgreSQL de `/health/db`, absentes de SQLite.
Les validations de la branche initiale ci-dessous restent identifiées comme telles.

## Architecture avant

Route `#/admin/users`, module lazy `administration-users.js`, cache `db.users` issu
de `GET /api/auth/users`, référentiels sociétés/sites existants. L'écran cumulait
header, barre d'outils générale, compteurs transversaux, sélecteur société volumineux,
KPI et tableau chargé. Deux normalisations globales traitaient le tableau comme un
en-tête ou des statuts d'employés.

## Architecture après

Même route, mêmes API et gardes d'accès. État de consultation dédié pour recherche,
filtres et pagination ; catalogues indexés une fois ; détail en lecture seule.
Deux feuilles CSS limitées à Utilisateurs. Le shell précédent et ses vrais nœuds
sont restaurés à la sortie de la page. Aucune modification backend ni migration.

## Header

Une seule barre : Administration Système, recherche globale existante, alertes et
identité connectée. Suppression sur cette page de la barre de compteurs transversaux
et de la seconde barre d'outils. Les autres pages retrouvent leurs commandes habituelles.
Aucune aide ou horloge fictive ajoutée.

## Breadcrumb

Administration système › Identités & accès › Utilisateurs, avec retour Administration
et état `aria-current` sur la page.

## Titre

Gestion des utilisateurs, icône compacte et sous-titre demandé. La page est exclue
du normaliseur global qui transformait tout son contenu en bloc d'en-tête.

## Actions

Trois actions seulement près du titre : Profils d'accès, Matrice des droits,
+ Nouvel utilisateur. Les deux premières sont secondaires, la création est bleue.

## KPI

Cinq indicateurs calculés à partir de la liste serveur complète : total, actifs,
bloqués, administrateurs (rôle normalisé ADM), à contrôler. Ce dernier conserve le
critère existant, désormais explicite : email absent ou profil absent hors ADM.
Aucun pourcentage, tendance, date ou chiffre de démonstration dans le produit.
Chargement initial affiché sans faux zéro.

## Filtres

Recherche nom/identifiant/email/rôle/profil avec debounce 180 ms. Société, site,
rôle/profil et statut se combinent. Les options du site suivent la société choisie ;
changer de société efface le site devenu incompatible. Le panneau avancé contient
module attribué, configuration à contrôler, accès global sociétés et remise à zéro.
Ces filtres de consultation ne changent ni contexte de création ni permissions.

## Tableau utilisateurs

Identité avec initiales, nom puis identifiant/email ; badge rôle/profil ; sociétés ;
sites ; statut textuel ; Voir, Modifier et menu secondaire. Pagination locale
10/25/50 avec total et boutons précédent/suivant. Détail des périmètres accessible.
États chargement, liste vide, aucun résultat, erreur et réessai présents.
Dernière connexion absente de l'API : colonne omise, sans « Jamais » inventé.
Pas de sélection multiple sans action collective disponible.

## Sociétés

Le booléen réel `global_society_access` est préservé dans les deux mappings frontend.
« Toutes » exige ce booléen ; une liste vide donne « Aucun périmètre ». Les périmètres
multiples sont compacts et consultables dans le détail.

## Sites

Un catalogue partagé via l'API existante, pas de requête par ligne. Le filtrage croise
société et sites autorisés. Aucun site BEO vide n'est transformé en accès global.
Une sélection multiple devient « N sites » avec détail accessible.

## Rôles

Rôles et profils réels conservés. Filtre Chargé des effectifs / BEO fondé sur la seule
clé canonique `site_workforce`, sans nouveau rôle ni nouvelle matrice. Les détails
présentent la configuration enregistrée : modules explicites ou configuration
historique, sans prétendre recalculer toutes les permissions effectives.

## Statuts

Actif / Bloqué, nomenclature existante, avec point et texte. Couleurs sobres.
Le normaliseur de statuts employés ne réécrit plus ces badges utilisateurs.

## Actions utilisateur

Voir est en lecture seule. Modifier appelle le formulaire existant. Permissions,
Suspendre/Réactiver et Supprimer restent les mêmes fonctions backend et frontend,
regroupées dans un popover natif. Protection du propre compte et confirmations existantes
conservées. Aucun reset de mot de passe fictif ajouté.

## Wizard

Le parcours réellement présent dans main est le formulaire administratif complet
avec récapitulatif de confirmation, pas un nouvel assistant en étapes. Il reste intact :
identité, profil, modules, sociétés, sites et actions. Seuls deux booléens déjà fournis
par l'API sont conservés dans son mapping de retour. Ouverture/annulation et modification
réelle vérifiées dans Chrome.

## Profils d'accès

Bouton et sidebar ouvrent `admin/niveaux`. Écran existant et fonctions conservés,
navigation aller-retour testée.

## Matrice des droits

Bouton et sidebar ouvrent `admin/droits`. Aucun droit métier ni matrice réécrit.
Navigation aller-retour testée.

## Sidebar

Identités & accès regroupe Utilisateurs, Profils, Matrice puis les fonctions disponibles.
Paramètres regroupe Modules, Accès sociétés, Sites, Sécurité et Journal ; les autres
entrées historiques restent accessibles. Aucune page Groupes/Sessions fictive créée.
Libellés et navigation clavier ajoutés aux liens Administration. Habillage navy limité
au shell Utilisateurs, identité connectée déplacée dans le header.

## Responsive

Chrome réel : 1440, 1024, 768 et 390 px. Cinq KPI sur desktop, grille adaptée sur mobile.
Actions et filtres se réorganisent ; défilement horizontal limité au tableau.
Mesures finales document/body : exactement 1440/1024/768/390 px, aucun overflow global.
Le détail Voir fonctionne aux quatre tailles. Sidebar mobile hors écran tant qu'elle
n'est pas ouverte. Comparaison visuelle effectuée avec la référence DG.

## Accessibilité

Labels de champs, boutons natifs, noms accessibles des icônes, focus visible, statut
textuel, breadcrumb, annonces de résultats/chargement, popover natif et région de
tableau accessible au clavier. Pas de dépendance à la couleur seule. Ces contrôles
ne constituent pas une certification WCAG exhaustive.

## Performance

Aucun nouvel endpoint. `GET /api/auth/users` n'offre pas de pagination serveur :
la liste complète existante reste chargée, pagination et filtres côté client.
Cette dette est documentée, sans refonte backend hors mission. Le chargement auth
récent est réutilisé pendant 10 secondes ; réessai forcé possible. Catalogue sites
partagé avec cache 60 secondes et garde contre les réponses d'une session précédente.
Mesure sur 19 comptes : deux lectures sites au démarrage (bootstrap + catalogue complet
pour la vue), puis zéro requête liste/catalogue pendant recherche, filtres et pagination.
Les index sites/profils sont construits une fois par actualisation.

## RBAC

Backend et règles inchangés. Recette HTTP réelle : huit refus 403 pour le compte OPS
sans Administration (lister, créer, modifier, suspendre, sociétés, sites, modules,
actions) ; nombre d'utilisateurs et compte cible inchangés.
Tests d'isolation multi-société, scopes, BEO et site_workforce de main rejoués.

## Tests backend

181 tests réussis ; un test technique `/health/db` ignoré par la suite SQLite car
il utilise des fonctions PostgreSQL. Aucun test métier ignoré. Aucun backend modifié.

```sh
python3 -m pytest -q tests/test_auth.py tests/test_beo_host_login.py tests/test_admin_site_workforce_module.py tests/test_lot_05b_permission_administration.py tests/test_feature_permissions.py tests/test_lot_04_module_access.py tests/test_scope_rules.py tests/test_lot_03_scope_closure.py tests/test_multi_society_isolation.py tests/test_site_workforce.py tests/test_drh_society_permissions.py tests/test_finance_rbac_read_only.py
python3 -m pytest -q tests/test_lot_05a_permission_foundation.py
```

Logs : `/tmp/atlas-users-v2-baseline-backend.log`,
`/tmp/atlas-users-v2-baseline-rbac-foundation.log`,
`/tmp/atlas-users-v2-security-smoke.log`.

## Tests frontend

Suite finale `npm test` : **595 réussis, zéro échec, zéro ignoré**, 74,92 s.
Référence avant modification : 562 réussis. Ajouts : 23 tests page et 10 tests shell.
Le test historique de menu Alertes est adapté au libellé Tableau de bord.
Tests permanents : filtres combinés, périmètres, pagination, états, fonctions existantes,
races de session, cache, navigation, styles et restauration du shell.

Commande locale avec dépendances déjà présentes :

```sh
NODE_PATH='/Users/ath/Downloads/ATLAS 1/node_modules' npm test
```

Log : `/tmp/atlas-users-v2-final-frontend.log`. Syntaxe JS et `git diff --check` propres.

## Chrome

Nouvelle recette permanente : **7/7 réussis**, zéro skip, zéro erreur console ou page.
Vrais serveur FastAPI/base de test, vrai Chrome, aucune API simulée ni injection dans
l'état applicatif. Création ouverte puis annulée ; nom d'un compte de test modifié dans
l'UI puis relu via API. Données dédiées, SMTP désactivé. Base, serveur et profil Chrome
de cette recette nettoyés. Recette BEO existante également réussie : **5/5**.

```sh
NODE_PATH='/Users/ath/Downloads/ATLAS-admin-beo/node_modules' npm run test:admin-users-e2e
NODE_PATH='/Users/ath/Downloads/ATLAS-admin-beo/node_modules' npm run test:site-workforce-e2e
```

Log : `/tmp/atlas-users-v2-e2e-final.log`. Captures et mesures :
`/tmp/atlas-users-v2-e2e-artifacts-final/users-{1440,1024,768,390}.png`,
`measurements.json`, `network-filter-pagination.json`.
Une vérification visuelle complémentaire a été effectuée dans le Chrome de l'utilisateur.

Aperçu conservé : **http://127.0.0.1:8952/#/admin/users**, base locale isolée avec données
TEST, aucun accès à la production. Compte de recette `UIADMIN` ; identifiants de test
uniquement dans le script local `/tmp/atlas-users-v2-preview.py`.

## Fichiers

Produit : `app/static/index.html`, `app/static/js/core/module-registry.js`,
`app/static/js/modules/administration-user-forms.js` (mapping uniquement),
`app/static/js/modules/administration-users.js`, `app/static/sgdi-app.js`,
`app/static/admin-users-v2.css`, `app/static/admin-users-shell.css`.

Validation : `package.json`, `tests_frontend/alerts-menu.test.js`,
`tests_frontend/admin-users-v2.test.js`, `tests_frontend/admin-users-shell.test.js`,
`tests_frontend/admin-users-v2-e2e.test.js`, ce rapport.

## Commits

1. `5d04ae1` — `feat(admin): reorganize users management UI`
2. `test(admin): cover users management UI v2` — tests, commandes et rapport de validation.

Commits repris sur le main actualisé : `9acc152` (interface) et `b9c5bbc` (tests).
Le résultat de la publication est à vérifier sur le SHA retourné par `/api/version`.

---

## Annexe — audit avant modification

Base : `origin/main` réel, récupéré le 27 septembre 2026, `c94d710`.
Branche dédiée : `feat/admin-users-ui-v2`. Les autres worktrees sont préservés.

| Zone | Existant | Décision |
|---|---|---|
| Route | `#/admin/users`, `administration-users.js`, module Administration chargé à la demande | Conserver route et garde Administration système |
| Shell | `sgdi-app.js` : header, barre workspace, compteurs transversaux, sidebar | Réorganiser le shell de cette page ; préserver les autres modules |
| Liste | `GET /api/auth/users` via `sgdiLoadAuthState`, cache `db.users`, sans pagination serveur | Réutiliser ; filtres et pagination locaux, aucune requête par ligne |
| Sociétés | `authorized_societies`, `global_society_access` et référentiel existant | Conserver le booléen serveur dans le mapping ; une liste vide ne prouve pas un accès global |
| Sites | `GET /api/ops/sites`, `syncSitesFromPostgres`, `siteFromApi` | Un catalogue partagé ; filtres combinables société/site sans changer les droits |
| KPI | Total, actif, bloqué, rôle ADM ; à contrôler = email absent ou profil absent hors ADM | Réutiliser ces calculs, expliciter le dernier critère ; aucune tendance inventée |
| Dernière connexion | Absente du modèle et de la réponse UserOut | Omettre la colonne, ne pas afficher de date ni « Jamais » fictif |
| Création / modification | `administration-user-forms.js`, formulaire complet et récapitulatif de confirmation | Conserver le parcours, les règles et les actions ; pas de reconstruction du Wizard |
| Profils / matrice | `admin/niveaux`, `admin/droits`, `administration-permissions.js` | Conserver fonctionnalités et navigation |
| Actions | Configuration, permissions granulaires, suspension/réactivation, suppression | Garder les fonctions existantes ; les actions secondaires passent dans un menu |
| CSS | `sgdi-app.css` contient styles users et normalisations globales | Ajouter une feuille dédiée et exclure la page de la normalisation destructive du header |
| Chargement | Rafraîchissement existant ; erreur liste actuellement avalée | Exposer le résultat de chargement au frontend pour un état erreur/réessayer honnête |

À supprimer visuellement sur Utilisateurs : barre de compteurs transversaux, bloc
« Société de configuration », droits détaillés dans chaque ligne, boutons sensibles
permanents, titres et espaces redondants. À ajouter : breadcrumb, filtres compacts,
tableau dense, pagination et états explicites.

À ne pas toucher : Auth, RBAC, règles métier, authorized_modules/societies/sites/actions,
profils, matrice, backend des actions, autres modules. Aucun nouveau backend nécessaire.

### Évolution de la base BEO

Lors de l’audit initial sur `c94d710`, le main utilisait encore un périmètre BEO
mono-société / mono-site. Les changements multi-sociétés / multi-sites ont depuis
été publiés jusqu’à `e1a9103` et constituent la base de cette intégration.
La liste Utilisateurs reste compatible avec les périmètres multiples ; la clé
canonique demeure `site_workforce`.
