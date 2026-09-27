# ATLAS Design System V1 — livraison locale

La refonte applique la référence blanche et bleue aux 19 entrées HTML de la suite.
Elle repose sur une seule feuille d'entrée, des tokens canoniques et des adaptateurs
pour les DOM existants. Aucun framework supplémentaire, police distante ou paquet
de production n'est ajouté.

Travail isolé sur `feat/atlas-design-system-v1`, depuis `d0a39f5`.
**Aucun push, aucun déploiement, aucune modification de production.** Les bases,
comptes et documents des aperçus/tests sont des fixtures locales.

## Ce qui change

- Sidebar blanche flottante, liens/icônes bleus, sélection bleu clair et accent.
- Header blanc avec contexte et compte compacts ; les outils existants sont
  regroupés dans un menu natif accessible au clavier.
- Administration : réglages métier secondaires regroupés sous « Paramètres
  métier », ouverts automatiquement lorsqu'une de leurs routes est active.
  Les préférences personnalisées, destinations et autorisations restent intactes.
- Cartes, KPI, formulaires, filtres, tables, badges, boutons, états, modales et
  focus utilisent les mêmes tokens ; les tableaux financiers restent denses.
- Les libellés standard du menu passent en casse phrase, avec conservation des
  acronymes et traductions existantes ; les libellés personnalisés sont conservés.
- Le menu mobile legacy se ferme aussi lorsque l'on choisit la route déjà active.
  Le défaut était démontré dans le navigateur : `stopPropagation()` empêchait le
  listener document d'effectuer cette fermeture. Les clics modifiés restent libres.
- La recherche DRH sur mobile respecte de nouveau les lignes masquées : une règle
  historique `display:block!important` des cartes neutralisait le filtre. Le raccord
  CSS respecte maintenant la visibilité demandée par le handler existant.

## Architecture et utilisation

| Fichier | Responsabilité |
|---|---|
| `app/static/design-system/atlas.css` | Entrée unique ; imports locaux versionnés |
| `tokens.css` | Couleurs, typographie, espaces, rayons, ombres, dimensions de coque |
| `components.css` | Primitives partagées et alias des variables existantes |
| `legacy.css` | Coque SGDI et pont avec les sélecteurs historiques |
| `specialized.css` | Finance, BEO, DRH NEXT, Core V3, Pointage, terminaux et portails |

Chaque entrée charge le lien suivant après ses styles existants :

```html
<link rel="stylesheet" href="/static/design-system/atlas.css?v=20260927-atlas-ds-v1" media="screen">
<body class="atlas-ui" data-atlas-surface="legacy">
```

La valeur de `data-atlas-surface` identifie explicitement l'adaptateur, sans déduire
la présentation du nom de domaine. Pour une nouvelle surface, réutiliser les
primitives `atlas-card`, `atlas-kpi`, `atlas-button-primary`, `atlas-button-secondary`,
`atlas-table`, `atlas-badge-success`, `atlas-empty`, etc. Les variantes doivent
consommer `var(--atlas-...)`, jamais recopier une couleur littérale.

Les imports et leurs liens d'entrée partagent une version. Toute future publication
de changements CSS doit incrémenter les versions ensemble pour les caches statiques.
Le JS SGDI conserve également ses protections de cache existantes côté serveur.

## Frontières conservées

Le backend, les endpoints, modèles, migrations, calculs Finance/Paie, RBAC et scopes
société/site sont inchangés. Les sélecteurs BEO de société/site et les périmètres
réels sont conservés. Aucun indicateur, moteur de recherche ou module fictif ajouté.
Les photos employés continuent d'utiliser leur mécanisme existant.

Les portails public/salarié/client et le Pointeur gardent leur navigation propre.
Les zones caméra, QR et horloge ne sont pas redimensionnées par cette refonte.
Les thèmes sombres déjà disponibles sur DRH NEXT/RH/commercial restent disponibles.
Les classes de visibilité (`hidden`, `active`, etc.) restent sous contrôle du runtime.

Tous les adaptateurs sont limités à l'écran. Le papier chèque garde ses dimensions
et coordonnées de calibration ; son aperçu dispose d'un défilement local sur mobile.
Les documents imprimables et les HTML documentaires générés dans `main.py` (badge,
dotation, QR d'accès) gardent leur rendu métier. Ils ne reçoivent pas de coque desktop.

Les anciennes déclarations CSS restent en place pour la compatibilité. Ce lot ajoute
une couche canonique de présentation ; il ne prétend pas supprimer tout le CSS
historique ni convertir toutes les pages en composants JavaScript nouveaux.

## Validation

La baseline complète et ses limites d'environnement sont détaillées dans
[atlas-design-system-baseline.md](atlas-design-system-baseline.md). La cartographie
des hosts, routes et risques de cascade se trouve dans
[atlas-design-system-audit.md](atlas-design-system-audit.md).

Commandes permanentes :

```sh
npm test
npm run test:drh-next
npm run test:core-v3
npm run test:atlas-design-system-e2e
npm run test:admin-users-e2e
npm run test:site-workforce-e2e
npm run test:finance-e2e
npm run test:attendance-e2e
git diff --check
```

Le nouveau banc navigateur démarre une API SQLite isolée et Chrome avec profil
temporaire. Les noms de domaine testés sont résolus vers localhost par Chrome.
Il vérifie styles réellement calculés, navigation, largeur utile, débordements,
menus mobiles, contraste, absence d'erreurs JavaScript, intégrité des scopes et
absence d'écriture métier pendant les contrôles visuels. Les captures contiennent
exclusivement des données synthétiques.

Les suites métier existantes complètent cette couverture. Les captures publiques
ne constituent pas une certification de chaque workflow authentifié de chaque
portail. Les tests PostgreSQL/OpenCV ignorés dans la baseline restent explicitement
hors certification locale ; aucun changement backend ne les contourne.

### Résultats finaux locaux

| Contrôle | Résultat |
|---|---|
| Frontend principal, incluant contrats DS/coque | 621/621, aucun échec ni test ignoré |
| DRH NEXT | 114/114 |
| Core V3 | 45/45 |
| Nouveau E2E DS, API et navigateur réels isolés | 25/25, aucun échec ni test ignoré |
| E2E existants Administration / BEO / Finance / Attendance | 28 réussis, aucun échec, 1 ignoré (modèles/portraits biométriques absents) |
| CSS | Analyse syntaxique, références de tokens, imports et contrastes AA validés |
| Documents chèque | Dimensions papier/champs et média print identiques avant/après |

Le nouveau E2E couvre à 1440 et 390 px Administration, DRH, OPS, Commercial,
Matériel, Finance, BEO, DRH NEXT, Pointage et Pointeur avec connexion réelle ; les
autres entrées sont contrôlées au niveau de leur accueil public/connexion.
Les scénarios vérifient notamment le filtrage, l'ouverture d'une fiche utilisateur,
les menus mobiles et le maintien des refus intersociétés/intersites.

Les mesures ciblées supplémentaires couvrent les breakpoints des coques spécialisées,
le thème sombre et les zones caméra/QR/horloge. La revue des titres de 17 entrées
(87 titres) a corrigé les contrastes sur fonds foncés des portails/candidat.
Ces mesures ciblées sur DOM réel/synthétique complètent les parcours authentifiés,
sans prétendre remplacer leurs tests métier.

Preuves locales : `/tmp/atlas-ds-final-frontend.log`,
`/tmp/atlas-ds-final-drh-next.log`, `/tmp/atlas-ds-final-core-v3.log`,
`/tmp/atlas-specialized-css-check.json`, `/tmp/atlas-specialized-headers-check.json`,
`/tmp/atlas-specialized-defects-check.json`, `/tmp/atlas-specialized-titles-check.json`,
`/tmp/atlas-specialized-portals-titles-check.json`.
Captures et mesures navigateur : `/tmp/atlas-design-system-e2e-verified/` ; logs des
quatre E2E existants : `/tmp/atlas-ds-final-e2e-artifacts/`.

Le backend est byte-identique à la baseline : ses 983 tests distincts validés et
26 exclusions documentées restent la référence. Aucune nouvelle exécution backend
complète n'est présentée comme ayant eu lieu après les modifications CSS/HTML/JS.
