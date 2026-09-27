# ATLAS Design System V1 — audit et matrice de migration

Référence : capture fournie `Capture d’écran 2026-09-27 à 17.32.51.png`.
Sidebar blanche flottante, textes/icônes bleus, sélection bleu clair, surfaces
blanches, fond gris bleuté. Aucun chiffre de la maquette n’est une donnée produit.
Le cahier des charges fourni se termine au §50 ; toutes ses exigences reçues
constituent le périmètre. Aucun moteur global, module, KPI ou route fictif ajouté.

## Matrice

A = proche ; B = adaptation légère ; C = adaptation importante ; D = legacy encapsulé.

| Frontend / modules réels | Classe | Migration V1 |
|---|---|---|
| Shell SGDI : Administration, DRH, OPS, Matériel, Commercial, Secrétariat, Agenda, Finances legacy, Stocks/Achats/Supervision selon navigation autorisée | D | Tokens/legacy adapter, coque partagée, marque et compte compacts, Outils natif, composants partagés ; calculs et routes inchangés |
| Administration Utilisateurs V2 | B | Sidebar navy remplacée par la coque blanche ; mêmes filtres, API, actions et pagination |
| Finance Platform | B | Coque blanche flottante, mêmes vues/colonnes et densité financière |
| BEO | C | Sidebar navy blanchie avec textes/icônes lisibles, périmètre N sites et sélecteurs conservés |
| Pointage contrôle | B | Header blanc, sidebar/cards et états communs ; navigation mobile horizontale conservée |
| Pointeur | B | Tokens, typographie et composants ; interface terminal/caméra/QR conservée sans sidebar |
| DRH NEXT et Core V3 | B | Adaptateurs préfixés et même palette ; états et responsive conservés |
| Portail client | B | Navigation existante et identité commune ; pas de menu administratif ajouté |
| Portail RH employé | B | Palette et composants, parcours salarié et RTL conservés |
| Recrutement interne, RH/commercial autonomes de compatibilité | C | Coques et navigation commune sans remplacement du runtime |
| Candidat public | B | Palette/champs/boutons partagés, aucune sidebar interne |
| Paie/Facturation autonomes | C | Enveloppes harmonisées ; modules et workflows existants conservés |
| Congés/Prêts/Supervision autonomes | B | Surface et composants ; aucune sidebar inventée |
| Chèque / documents générés / badge public | D | Dimensions et impression métier conservées ; chèque reçoit seulement socle écran non géométrique |
| `pointage-mockup.html` | Hors produit | Maquette non servie comme frontend opérationnel ; non migrée |

## Source canonique et compatibilité

`app/static/design-system/atlas.css` constitue l’unique entrée et charge
`tokens.css`, `components.css`, `legacy.css`, `specialized.css`.
Les 19 HTML autonomes chargent ce socle en dernier, exclusivement à l’écran.
Les classes `atlas-ui` et `data-atlas-surface` rendent les adaptations explicites.
Les anciens styles métier restent encapsulés ; ils ne sont pas recopiés dans
chaque module. Les nouvelles couleurs proviennent exclusivement des tokens.
La suppression complète des anciennes déclarations demanderait une migration
fonctionnelle plus risquée et n’est pas nécessaire à cette couche de présentation.

Composants communs : boutons primaires/secondaires/sensibles, champs, selects,
checkboxes, cards/KPI, filtres, tableaux, badges, modales/drawers, toasts,
états vide/erreur/loading, pagination, tabs et focus clavier.
La marque SGDI et le menu Outils réutilisent un seul générateur ; les contrôles
existants sont déplacés avec leurs nœuds et événements, jamais réimplémentés.
Les variantes de densité Finance/Pointage et les modes terminal/public sont conservés.
Les breadcrumbs existants restent visibles ; aucun chemin fictif n’est déduit de
textes arbitraires. Les assistants gardent leurs étapes et validations.

## Hosts et sources

Les sections détaillées ci-dessous décrivent les contraintes de la base avant
migration. Le résultat livré et les contrôles finaux sont documentés dans
[atlas-design-system-v1.md](atlas-design-system-v1.md).



Constat fondé sur le code, sans requête distante ni vérification DNS. Priorité : `app/main.py:1545–1638`; détection des domaines `app/main.py:775–883`. Tous les chemins ci-dessous sont relatifs à `app/static/`.

| Host / famille | HTML servi par `/` | Runtime / présentation | Source |
|---|---|---|---|
| `sgdi.irongs.com`, `atlas.irongs.com`, `www`, domaine principal | `index.html` | Shell legacy partagé `sgdi-app.js`, `sgdi-app.css`, modules lazy ; contexte selon session | main.py:1637 ; sgdi-app.js:4960–4968 |
| `drh.irongs.com` | `index.html` | Même shell ; config `drh`, accueil `drh/dashboard` | main.py:847–852,1637 ; sgdi-app.js:4768–4781 |
| `ops.irongs.com` | `index.html` | Même shell ; config `ops`, accueil `ops/dashboard` | main.py:1637 ; sgdi-app.js:4783–4802 |
| `materiel.irongs.com` | `index.html` | Même shell ; config `materiel`, accueil `materiel/dashboard` | main.py:1637 ; sgdi-app.js:4815–4827 |
| `dc.irongs.com` | `index.html` | Même shell ; alias `dc → commercial` ; `commercial.html` n'est plus le frontend canonique | main.py:1616–1618 ; sgdi-app.js:4957 |
| `commercial.irongs.com` | redirection 301 vers `https://dc.irongs.com/` | Alias retiré | main.py:855–858,1548–1549 |
| `secretariat.irongs.com`, `sg.irongs.com` | `index.html` | Shell partagé, config/alias `secretariat` | sgdi-app.js:4845–4863,4957 |
| `agenda.irongs.com` | `index.html` | Shell partagé, config `agenda` | sgdi-app.js:4917–4927 |
| `superviseur`, `sup`, `supervisor` comme premier label | `index.html` | Shell partagé, config `superviseur` ; pas un frontend indépendant | sgdi-app.js:4803–4814,4957 |
| `admin`, `administrateur`, `general` comme premier label | `index.html` | Administration du shell partagé ; UI Utilisateurs V2, CSS dédiés | sgdi-app.js:4929–4962,8384–8418 |
| `finance.irongs.com` | `finance-platform/index.html` | Frontend séparé ; `app.css`, `api.js`, `shell.js`, vues métier | main.py:835–839,1598–1603 |
| `finances`, `facturation`, `comptabilite`, `compta` comme premier label | `index.html` | Ancien shell Finances/Facturation ; distinct de Finance Platform singulier | sgdi-app.js:4864–4880,4957 |
| `fac.irongs.com` | `facturation.html` | Enveloppe dédiée mais charge le même runtime/CSS `sgdi-app` et modules lazy ; styles inline en plus | main.py:803–804,1592–1597 |
| `paie.irongs.com` | `paie.html` | Enveloppe dédiée réutilisant `sgdi-app`, styles inline | main.py:811–812,1574–1579 |
| `conges.irongs.com` | `conges.html` | Enveloppe dédiée réutilisant `sgdi-app` | main.py:815–816,1580–1585 |
| `pret.irongs.com`, `caisse.irongs.com` | `prets.html` | Même frontend autonome HTML/CSS/JS inline | main.py:819–824,1586–1591 |
| `pointage.irongs.com` | `pointage/index.html` | Centre de contrôle autonome, CSS/JS inline | main.py:788–792,1556–1561 |
| `pointeur.irongs.com` | `pointeur.html` | Terminal terrain autonome ; CSS/JS inline, QR et `pointeur-facial.js` ; pas de sidebar desktop à imposer | main.py:783–785,1550–1555 |
| `beo.irongs.com` | `site-workforce/index.html` | Frontend séparé : `app.css`, `api.js`, `shell.js`, neuf vues ; logique multi-sociétés/multi-sites | main.py:842–844,1604–1609 |
| `recrute.irongs.com` | `recrute.html` | Frontend autonome recrutement ; CSS/JS inline, `login-standalone.css` | main.py:795–796,1562–1567 |
| `fr.irongs.com` | `candidat.html` | Candidature publique autonome ; CSS/JS inline | main.py:799–800,1568–1573 |
| `rh.irongs.com` | `rh.html` | Ancien frontend RH autonome ; ne pas confondre avec `drh` | main.py:831–832,1619–1624 |
| `portail-rh.irongs.com` par défaut ; autres hosts configurés par `PORTAL_HOSTNAMES` | `portail-rh-bilingue.html` | Portail salarié mobile autonome ; CSS/JS inline + QR | config.py:20 ; main.py:775–780,1625–1630 |
| `cheque.irongs.com` | `cheque.html` | Application chèque autonome HTML/CSS/JS inline | main.py:807–808,1610–1615 |
| Host client dynamique (`Client.portal_slug`, `portal_enabled=True`) | `client-portail.html` | Portail client autonome HTML/CSS/JS inline | main.py:865–883,1631–1636 |

Le mapping client dynamique est évalué après tous les hosts dédiés et avant le fallback legacy ; il requiert une correspondance en base, avec cache 60 secondes. La ligne de catalogue `ADMIN_LOGIN_MODULES` n'est pas la source du HTML réellement servi : `finance` et `finances`, `rh` et `drh` illustrent cette distinction.

## Frontends supplémentaires par chemin explicite

| Chemin | HTML / comportement | Source |
|---|---|---|
| `/drh-next` | `drh-next/index.html`, `app.mjs`, CSS `styles/tokens.css`, `layout.css`, `components.css`. Expérimental, ne remplace pas `/` sur drh. Version des assets calculée côté Python. | main.py:129–145 |
| `/atlas-v3` | `atlas-v3/index.html`, runtime `atlas-v3/app.mjs`/`core-v3`, modules `modules-v3`; charge aussi `sgdi-app.css`. | main.py:205–217 |
| `/finance-platform` | Finance Platform ; redirection 301 vers finance.irongs.com seulement si Host=drh.irongs.com | main.py:273–279 |
| `/site-workforce` | Même portail BEO, accessible par chemin sur un domaine partagé | main.py:286–289 |
| `/portail-rh` | `portail-rh-bilingue.html` | main.py:923–929 |
| `/pointeur` | `pointeur.html`, y compris compatibilité des anciens terminaux PWA | main.py:950–956 |
| `/supervision` | `supervision.html`, écran autonome HTML/CSS/JS inline | main.py:959–965 |
| `/recrute`, `/paie`, `/conges-app`, `/prets`, `/cheque` | respectivement `recrute.html`, `paie.html`, `conges.html`, `prets.html`, `cheque.html` | main.py:968–1009 |

Le mount statique général existe aussi à `/static` (`main.py:395`) : un HTML legacy présent sur disque peut rester directement accessible sans être le frontend canonique d'un host.

## Routeurs et frontières fonctionnelles

- `app/static/js/core/module-registry.js:47–74` mappe les racines du hash vers les modules lazy. `admin/parametres → administration`, `effectif/agents → employees`, `drh/conges → drh`, `ops/superviseur → ops`, `fiches/badge → positions`, puis modules Commercial, Facturation, Matériel, Pointage, Paie, Contrats, Recrutement, Sites, Incidents, Alertes, Agenda, Secrétariat et Portail.
- `app/main.py:1651` monte `api_router` avec le préfixe configurable `/api` (`app/core/config.py:12`).
- `app/api/router.py:39–71` expose Auth, DRH, OPS, Matériel, Commercial, IRONGS, Portail RH, Portail Client, Finance legacy, UI, ERP, Accounting, Achats, Ventes, Reporting, Assistant, Ronde, Public, Loans, Alerts, Finance Core, Banking, Reconciliation, Regulatory, Payroll, Treasury, Budget, Profitability, Fiscalité, Cockpit, Site Workforce, Attendance et Biometrics. Ce sont des routes backend, pas autant de frontends indépendants.
- Réutiliser un style partagé ne nécessite aucune modification de ces routes/API/scopes.

## Cache et points utiles au Design System

- `/` legacy est no-cache ; `_build_index_html` remplace par hash les versions de `sgdi-app.js`, `sgdi-app.css`, `erp-frontend.js`, `sgdi-inline-2.js` uniquement (`main.py:1524–1540`). Une nouvelle CSS canonique doit donc avoir son propre cache-buster déclaré.
- Les modules lazy utilisent `MODULE_VERSION` (`module-registry.js:41,168`). Garder les références registry/files/core alignées dans les enveloppes concernées.
- `paie.html`, `conges.html`, `facturation.html` chargent le core legacy mais conservent des versions historiques `20260914-alerts-menu-fix` dans leurs références ; une mise à jour uniquement d'`index.html` ne suffit pas pour un nouveau CSS commun.
- Finance Platform et BEO ont chacun des fichiers CSS/modules séparés ; Pointage, Pointeur, RH, Prêts/Caisse, recrutement et portails ont principalement du style inline. Une modification de `sgdi-app.css` seule ne couvre pas la suite.
- Ne pas confondre l'existence d'une route `fiches`/`positions` avec une entrée autorisée à réintroduire en navigation. Les routes demeurent utilisées par les fiches employé.
- Point de baseline navigation : `d0a39f5` conserve `FICHE DE POSITION` dans `sidebarByModule.ops` (`sgdi-app.js:7049`), le catalogue organizer OPS (:6797) et la config de portail DRH (:4777), alors que la sidebar principale DRH l'a retirée. Ne pas reconstruire de nouvelles entrées à partir de ces catalogues historiques ; toute décision sur la visibilité doit respecter la consigne utilisateur sans retirer les routes/RBAC des fiches. Aucun changement effectué par l'audit.

# Audit des frontends spécialisés — socle visuel ATLAS

Date : 27 septembre 2026. Référence demandée : worktree `atlas-design-system-v1`, base `d0a39f5`.
Audit de code en lecture seule : aucun fichier produit ni Git modifié. Ce document distingue les éléments observés des recommandations. Aucune capture navigateur n'a été produite dans cette sous-tâche.

## Conclusion exploitable

Le socle commun peut être introduit sans changer les routes, les événements ou les API : nouveaux tokens préfixés, adaptateurs CSS par surface, chargés après les styles de chaque entrée. Finance et BEO ont presque exactement le même DOM de coque. Pointage contrôle et Portail client ont déjà une sidebar blanche flottante, avec une autre disposition mobile. DRH NEXT possède une coque préfixée et un thème sombre natif. Pointeur, Portail RH et pages publiques n'ont pas de sidebar de navigation ; les y transformer dépasse une correction CSS et leur ferait perdre leurs dispositions terrain/formulaire.

Ne pas importer `sgdi-app.css` dans ces pages. Elles sont autonomes et leurs classes génériques (`.shell`, `.card`, `.btn`, `.top`, `.primary`, `.hidden`) se recoupent avec des sens différents. Le commentaire initial de `finance-platform/app.css` documente déjà ce choix d'isolation.

## Entrées et actifs

| Surface | Entrée produit | Styles chargés aujourd'hui | JS principal |
|---|---|---|---|
| Finance Platform | `app/static/finance-platform/index.html` | `finance-platform/app.css?v=2` | `api.js`, `views/*.js`, puis `shell.js` ; registre `window.FinanceViews` |
| BEO / Site Workforce | `app/static/site-workforce/index.html` | `site-workforce/app.css?v=2` | `api.js`, neuf `views/*.js`, puis `shell.js?v=5` ; registre `window.SiteWorkforceViews` |
| Centre de contrôle pointage | `app/static/pointage/index.html` | bloc `<style>` inline lignes 9–82 ; pas de CSS externe | scripts inline ; IIFE avec `state`, listeners attachés aux IDs |
| Terminal Pointeur | `app/static/pointeur.html` | `responsive-baseline.css`, gros bloc inline, puis `login-standalone.css` | JS inline, `html5-qrcode.min.js`, `pointeur-facial.js` |
| DRH NEXT | `app/static/drh-next/index.html` | `styles/tokens.css`, `layout.css`, `components.css`, dans cet ordre | `app.mjs`, core/modules ES |
| Portail employé RH | `app/static/portail-rh-bilingue.html` | `responsive-baseline.css`, bloc inline | JS inline, bibliothèques QR |
| Portail client | `app/static/client-portail.html` | `responsive-baseline.css`, bloc inline | JS inline |
| Candidature publique | `app/static/candidat.html` | `responsive-baseline.css`, bloc inline | JS inline, `algeria-communes.js` |
| QR d'accès au portail | HTML généré par `app/main.py:1013` | CSS inline dans la réponse | QR et sélection de lien inline |
| Badge public / dotation publique | HTML généré par `app/main.py:1154` et `:1199` | CSS inline propre à chaque document | surfaces documentaires, sans coque de navigation |

Routage observé dans `app/main.py` : Finance via `/finance-platform` et racine de `finance.irongs.com` ; BEO via `/site-workforce` et `beo.irongs.com` ; pointage contrôle à la racine de `pointage.irongs.com` ; Pointeur via `/pointeur` et `pointeur.irongs.com` ; DRH NEXT via `/drh-next` ; portail employé via `/portail-rh` et domaine portail configuré ; candidat sur `fr.irongs.com`. Les domaines clients sont résolus dynamiquement à partir du client, pas une liste fixe.

Attention : `pointage-mockup.html` existe mais n'est pas l'entrée active du centre de contrôle. Ne pas y limiter une modification de design.

## 1. Finance Platform

### Structure

`finance-platform/shell.js:62` construit :

```text
#root
└─ .shell#shell
   ├─ .sidebar-scrim[data-close-sidebar]
   ├─ aside.shell-sidebar
   │  ├─ .shell-brand > .shell-brand-mark + .shell-brand-text
   │  └─ nav.shell-nav > .shell-nav-group > .nav-link
   └─ .shell-main
      ├─ header.shell-header
      │  ├─ .shell-header-left > .sidebar-toggle + #view-title
      │  └─ .shell-header-right > société/période/utilisateur/déconnexion
      └─ main.shell-content#view
```

`#root` est aussi remplacé par l'écran de connexion `.card#login-screen`. Un adaptateur ciblant `.shell` évite donc d'affecter involontairement la connexion. Les événements d'ouverture/fermeture modifient exclusivement `.sidebar-open` sur `#shell` (`shell.js:105`). Conserver cette classe et les `data-toggle-sidebar`/`data-close-sidebar`.

### Tokens et composants

`app.css:6` : `--bg:#f3f4f6`, `--surface:#fff`, `--border:#d3d9e3`, `--text:#0f172a`, `--primary:#043970`, `--primary-strong:#032f5d`, `--primary-soft:#e8f0f8` ; états success/warn/danger/info avec fonds faibles. `--sidebar-w:236px`, `--header-h:56px`, `--radius:8px`, ombre discrète et `--shadow-lift`.

Composants représentatifs : `.card`, `.card-head`, `.section-title`, `.kpi-grid/.kpi-card/.kpi-value`, `table.data` dans `.table-wrap`, `.badge.*`, `.btn/.btn-primary/.btn-ghost/.btn-sm`, `.field`, `.form-row`, `.filters-row`, `.pagination`, `.subtabs/.subtab`, `.drawer-scrim/.drawer`, `.confirm-scrim/.confirm-box`, `.skeleton`, `.empty-state/.error-state`.

### Géométrie actuelle / adaptation

Sidebar déjà blanche mais collée à la fenêtre, `position:sticky;top:0;height:100vh`, flex-basis 236, bord droit ; header sticky top0 z10 ; sidebar z20. Main min-width0 ; contenu max1440 centré, padding20, overflow-x:auto.

Pour le rendu flottant : marges/gouttière sur la coque et sidebar, arrondi/bordure/ombre, hauteur `calc(100dvh - 2*gouttière)` et top correspondant ; garder largeur effective cohérente avec flex-basis. Ne pas ajouter simultanément un margin-left fixe sur le main : il est déjà dans le flux flex.

Mobile <=900 : sidebar fixed left0/top0, translateX(-100%), ouverte via `.shell.sidebar-open`; scrim z15 ; menu hamburger visible, contenu padding12, période masquée. <=480 : société max92px, nom utilisateur masqué, KPI une colonne. Les corrections de rétrécissement du header et des montants longs sont explicitement documentées : conserver min-width0, flex rétractable et overflow-wrap des KPI.

## 2. BEO / Site Workforce

### Structure

Même `.shell`, `.shell-sidebar`, `.shell-main`, `.shell-header`, `.shell-content#view` que Finance (`site-workforce/shell.js:81`). Sidebar ajoute `.shell-role-badge` entre marque et navigation. Header ajoute `.shell-header-heading/.shell-header-app` et surtout `.scope-bar/.scope-field` pour société/site, qui doivent rester visibles. Toggle et scrim identiques.

### Tokens / état visuel

Palette et composants globalement identiques à Finance. Différence actuelle volontairement concentrée sur la sidebar : `--navy:#0a2647`, `--navy-soft:rgba(255,255,255,.08)`, `--navy-text:#dce6f2`, `--navy-text-faint:#8fa6c2`. `.shell-sidebar` fond navy ; `.shell-brand-text b` et `.shell-role-badge b` couleurs blanches codées directement ; liens actifs/hover blancs.

Passer uniquement le fond de sidebar au blanc rendrait la marque, le rôle et l'entrée active illisibles. L'adaptateur doit couvrir simultanément : `.shell-brand-text b/span`, `.shell-role-badge b/span`, séparateurs, `.nav-link`, hover/active, `.shell-brand-mark`. Utiliser les mêmes tokens sidebar que Finance, sans changer le contenu ni le filtrage des entrées.

### Responsive

Largeur236, header hauteur minimale56 (pas fixe), wrapping et padding vertical6 ; cela permet la barre de périmètre sur plusieurs lignes. <=900, drawer de sidebar identique Finance ; `.scope-bar` passe order3/width100%, selects flexibles, `.scope-chip` masqué. <=480, `.shell-header-app` et nom utilisateur masqués. Ne pas imposer `height:56px` partagé au header BEO ni masquer `.scope-bar` pour gagner de la place.

KPI min170px, et composants de tables/actions/confirmations/drawers similaires Finance. Les champs de périmètre sont fonctionnels et les classes `hidden`/disabled/active doivent rester intactes.

## 3. Pointage contrôle

### Identité de l'entrée

Le produit parfois nommé « pointage-control » est `app/static/pointage/index.html`, pas un dossier de ce nom. DOM statique, fonctions inline. La page distingue explicitement le centre de contrôle navigateur du terminal PWA : en display-mode standalone elle redirige vers `/pointeur`. Préserver cette séparation.

```text
section#app.hidden
├─ header.top > .top-row > .brand + .top-actions (site/date/logout)
└─ .shell
   ├─ aside.side > .side-title + nav > button.nav-btn[data-view]
   └─ main
      ├─ section#view-board
      ├─ section#view-cameras.hidden
      ├─ section#view-duplicates.hidden
      └─ section#view-anomalies.hidden
#modal-host
```

### Géométrie / tokens

Déjà proche de la cible : `.shell` grille220px/minmax(0,1fr), gap22, padding20px 28px, max1680 ; `.side` blanche, bordure, rayon18, padding12, ombre, sticky top16, height:fit-content. Header bleu gradient et angles bas arrondis. Token namespace générique `--navy`, `--blue`, `--green`, `--red`, `--amber`, `--ink`, `--muted`, `--line`, `--bg`, `--card`.

Composants : `.primary/.secondary/.danger/.link`, `.nav-btn.active`, `.nav-count`, `.page-head`, `.kpis/.kpi`, `.card`, `.filters`, `.table-wrap`, `.pill` avec états `.st-*` et `.sev-*`, `.pager`, `.modal-bg/.modal`, `.toast`, `.state`, `.hidden`.

<=900, sidebar devient navigation horizontale dans le flux (`position:static;display:flex;overflow-x:auto`), titres cachés, grille une colonne. <=520, titres réduits et `.grid2` une colonne. Ne pas appliquer l'offcanvas Finance ici : aucun handler hamburger/scrim n'existe. Les IDs, `data-view`, `.active`, `.hidden` pilotent navigation et chargements ; CSS visuelle uniquement.

## 4. Terminal Pointeur

Aucune sidebar de navigation. L'`aside#liveFeedCard.scanner-card` est le flux d'événements de pointage, pas un menu.

DOM `#appView.app.hidden > header.top > .top-row` avec marque, horloge segments `.header-clock`, `.top-actions` (site, `nav.module-nav`, état scanner, connexion, logout), puis `main.main` avec `.status-row`, `.work-grid`, cartes scanner/résultat/flux, historique/planning. Le capteur USB utilise un input dédié, le lecteur vidéo/QR et le facial ont leurs zones spécifiques.

Tokens famille pointage (`--navy`, `--blue`, `--green`, `--red`, `--amber`, `--ink`, `--muted`, `--line`, `--bg`). Header sticky z1000 et safe-area top. Composants tactiles `.primary/.secondary`, `.scanner-card`, `.presence-summary`, `.employee-photo`, `.result`, `.live-feed-row`, `.conn-pill`, `.planning-*`, `.face-*`.

Responsive comporte plusieurs couches : 760px, 1100px, 1399px, 759px, 380px, plus `(orientation:portrait)`. À >=1100 disposition kiosque, puis règle 760–1399 remet `.work-grid` sur une colonne ; ne pas simplifier sans vérifier l'ordre de cascade. À <=1099 OU portrait, résultat devient feuille fixed en bas avec `.result.show`, transform et pointer-events. Mobile flux horizontal scroll-snap, site pleine largeur et horloge sur sa propre ligne. Inputs login52px, grands boutons scanner, clavier/wedge volontairement particuliers.

Adaptation recommandée : tokens et surfaces/cartes uniquement, conserver modèle plein écran et dimensions caméra/QR. Un sélecteur commun `aside`/`.top` ou une sidebar artificielle casserait cette surface.

## 5. DRH NEXT

DOM produit par `drh-next/app.mjs:42` : `#dn-root > .dn-app#dn-app > aside.dn-sidebar + .dn-main`; sidebar marque et `nav#dn-nav.dn-sidebar-nav`; main contient `header.dn-header` puis `main.dn-content > #dn-view`. Menu `.dn-sidebar-toggle`, état `.dn-sidebar-open`, liens `.dn-nav-link.active`.

Namespace complet `--dn-*`, excellente cible pour alias : fond/surface/bord/text/muted/accent/accent-weak/états/radius/radius-sm/shadow/font/sidebar-w/header-h. Largeur240, header56 ; sidebar sticky top0 height100vh, header sticky z5 ; contenu padding24 et overflow horizontal. <=860 sidebar fixed z20 hors écran, toggle visible, contenu16 ; clic lien ferme le menu. Pas de scrim défini ici.

Composants préfixés `.dn-card`, `.dn-kpi*`, `.dn-btn*`, `.dn-badge*`, `.dn-table`, `.dn-input/.dn-select`, `.dn-avatar`, `.dn-modal-backdrop/.dn-modal`, `.dn-drawer`, `.dn-pagination`, `.dn-tabs/.dn-tab`, `.dn-skeleton`, états empty/error. Modals/drawers z30. Animations skeleton respectent reduced-motion.

Point essentiel : `tokens.css` comporte dark mode automatique `prefers-color-scheme` sauf data-theme=light, et data-theme=dark explicite. Un alias final inconditionnel de `--dn-surface` au blanc supprime ce contrat. Soit conserver les états light/dark via tokens communs adaptés, soit limiter la sidebar blanche au thème clair. Ne pas imposer silencieusement un thème global à toutes les pages.

## 6. Portail client

`client-portail.html:319` : `#appView.app` contient `.top` puis `.shell`. Shell grille230px/minmax(0,1fr) et gap18. La colonne latérale est `.portal-sidebar-stack`, qui contient DEUX `aside.portal-sidebar` : recherche employé `#employeeSearchCard`, puis navigation `.portal-nav > .portal-nav-btn[data-tab]`. Main `.portal-main` contient les onglets existants. Deux sidebars ne signifient donc pas deux menus ni deux marges à ajouter.

Déjà blanc flottant : rayon18, bordure `--line`, ombre. Navigation active jaune#ffcc00 ; marque client spécifique, `body.iron-portal` modifie plusieurs composants (notamment langues FR/EN). Préserver les couleurs client sauf instruction de branding explicite. Écran connecté hauteur contrainte et scrolls internes séparés dans stack/main ; `--header-height` est recalculé par `syncHeaderHeightVar()` à entrée/resize. Ne pas remplacer par hauteur constante partagée.

<=900 la coque revient dans le flux avec une colonne ; sidebar stack et main overflow visible ; navigation horizontale scrollable. <=760 recherche globale prend une ligne complète. Plusieurs composants métier très denses : `.group-counters/.function-counters`, `.portal-alert-card`, `.employee-identity-panel`, `.employee-sidebar-search`, `.planning-*`, tables pointage ; éviter règles de grille globales.

Permissions : JS masque `.portal-nav-btn`, `#employeeSearchCard`, certains boutons via `.hidden`. L'adaptateur ne doit jamais forcer display sur un élément `.hidden`. Bouton actif FR/EN utilise aussi `[aria-pressed=true]` ; contraste déjà couvert par tests permanents.

## 7. Portail RH employé et candidature

Portail RH : `#appView` avec `header` sans classe (gradient, sticky z200) contenant `.container.header-content`, photo/identité/statut, FR/AR et déconnexion ; `main` contient home QR/historique, écran menu et onglets `.tabs/.tab/.tab-content`. Largeur container980, cartes et boutons. Aucune sidebar.

Tokens `--primary:#1e40af`, primary-dark/light, accent, success/warning/danger, bg/card/text/muted/border, shadow/shadow-lg/radius10. Styles tardifs remodèlent home, QR et header : respecter l'ordre. <=640 cartes/grilles une colonne, request-types2colonnes, colonne table masquée ; header relative, photo66, QR218, langue header masquée. `.home-mode`, `.portail-mode`, `.tab-content.active` pilotent la navigation.

Bilingue RTL via `body.lang-ar` (direction, alignements, champs et toasts adaptés). Print masque header/actions/boutons/tabs et cartes non imprimables. Le socle doit employer propriétés logiques et ne pas écraser `@media print`, ni afficher les onglets cachés par mode.

Candidat : `#welcomeScreen` puis header `.top`, `main.wrap` largeurmin1180, `.hero/.steps`, formulaire en `.card > .section-head + .fields`, tables répétables expérience/formation, `.photo-panel` et modal caméra. Tokens navy/blue/line/muted/bg/green. Responsive700/520/360/380, paysage courte hauteur pour caméra, reduced-motion pour accueil animé. Pas de sidebar ni session ERP ; adapter cartes/champs sans inventer navigation ni toucher noms/handlers du formulaire.

## 8. Pages publiques générées

`/portail-rh/acces` : main unique largeurmax560, choix URL et QR ; aucune sidebar. `/public/badge/{employee_ref}` : `.phone-badge`, photo, état, identité, QR, responsive380. `/public/dotation/{employee_ref}` : document/feuille matériel avec tables et signatures, styles print. Ces HTML vivent dans `app/main.py`, pas sous `app/static`.

Pour un premier socle CSS sans logique backend : laisser ces surfaces documentaires à part, ou ajouter uniquement un lien de thème/tokens explicitement ciblé lors d'un lot distinct. Ne pas greffer coque/sidebar sur un badge public ou un document imprimable. Leurs chemins/token d'accès restent strictement inchangés.

Autres pages autonomes repérées dans le routage (non auditées en détail dans cette sous-tâche) : `recrute.html`, `paie.html`, `conges.html`, `prets.html`, `facturation.html`, `rh.html`, `cheque.html`, `supervision.html`. Ces entrées ont ensuite été raccordées séparément : modifier uniquement `index.html` ne les aurait pas couvertes.

## Proposition de raccord CSS minimal

1. Nouveau fichier de tokens préfixés `--atlas-*`, sans reset global, puis adaptateurs ciblés sur une classe/attribut de surface à l'entrée (`finance`, `beo`, `pointage-control`, `drh-next`, `client-portal`, `employee-portal`, `pointeur`, `candidate`). Ajouter une classe statique au body/html est une modification présentation, indépendante des handlers.
2. Charger le raccord APRES CSS local et APRES les styles inline. Sur Pointeur, tenir compte de `login-standalone.css` chargé après son bloc inline. Ne pas appliquer des règles shell aux écrans login.
3. Alias des tokens actuels aux tokens communs par surface : `--surface`/`--card`/`--dn-surface` -> surface commune, `--border`/`--line`/`--dn-border` -> bordure, textes et accents de même. Garder états sémantiques et branding client.
4. Adaptateur shell commun Finance/BEO avec sidebar blanche flottante et overrides explicites des textes navy BEO. Adaptateurs séparés pour `.dn-sidebar`, `.side`, `.portal-sidebar`. Aucune règle générique `aside` ou `main` destinée au shell.
5. Pour les autres surfaces, appliquer seulement typographie, fonds, bordures, ombres, rayons et focus compatibles. Ne pas changer affichage/positionnement caméra, QR, résultat scanner, tableaux ni documents print.
6. Réutiliser les breakpoints propres à chaque coque au premier lot. La valeur900 n'est pas une vérité globale : DRH NEXT bascule860, Pointeur possède des règles orientation importantes. Préserver états ouverts/fermés et scrolls internes.

### Risques concrets de cascade

- `responsive-baseline.css` impose déjà `html/body overflow-x:hidden!important`, medias max-width!important, inputs16px!important sous767, min-height44 sur boutons, certains modals/grilles!important. Il est chargé par Pointeur/portails/candidat mais pas Finance/BEO/DRH NEXT/pointage contrôle. Ne pas l'ajouter partout comme solution universelle.
- Un drawer mobile avec marge gauche + `translateX(-100%)` peut laisser une bande visible : mesurer l'état fermé après ajout de marges flottantes. Garder drawer entièrement hors viewport et accessible une fois ouvert.
- Sticky+height100vh+margin peut créer débordement vertical ; recalculer hauteur utile et conserver scroll du nav. BEO rolebadge long et Finance nombreux groupes sont les cas de test.
- Header BEO et client variables ; ne pas standardiser une hauteur fixe qui masque sélecteurs de périmètre.
- Classes `.hidden`, `.active`, `.show`, `.sidebar-open`, `.dn-sidebar-open`, `.tab-content.active` et attributs data sont des contrats JS. Les adapter visuellement, pas les renommer ni les neutraliser.
- Cache : Finance/BEO référencent aujourd'hui CSS `?v=2`; static générique peut être servi immutable. Un nouveau lien CSS partagé doit être versionné et version changée à chaque publication ; DRH NEXT dispose d'un traitement assets spécifique dans `main.py`. Les HTML servis en no-cache ne suffisent pas à invalider une URL CSS immutable inchangée.

## Bancs et contrôles identifiés pendant l’audit

Audit seul : aucun test fonctionnel relancé ici, car aucun produit modifié. Bancs existants identifiés :

- Finance : `tests_frontend/finance-platform.test.js` et E2E `finance-platform-e2e.test.js` (vrai Chrome + serveur SQLite temporaire, script npm dédié, pas lancé par défaut).
- BEO : `site-workforce.test.js` et E2E `site-workforce-e2e.test.js` même patron.
- Pointage contrôle : `pointage-control-center.test.js`, jsdom sur le vrai HTML, vérifie filtres/pages/navigation et redirection PWA.
- Terminal : `pointeur.test.js`, `pointeur-shift-staffing.test.js`, `pointeur-idle-timeout.test.js`, `pointeur-facial.test.js`.
- Portail client : `client-portail-lang-toggle.test.js`, `client-portail-sidebar-pointage.test.js`, `client-portail-position-counters.test.js`, fixture `load-client-portail.js`.
- DRH NEXT : `tests_frontend/drh-next/lot*.test.mjs`, `attendance-v1.test.mjs` et fixture `dom-env.mjs`.

Contrôle visuel au minimum : 1440/1280/1024/900/860/768/390/320 ; sidebar ouverte/fermée, table large, navigation active, bouton iconographique, modal/drawer, login, intitulé société/site long, page vide/erreur/chargement. Inclure thème sombre DRH NEXT, FR/AR portailRH, FR/EN portailclient, orientation portrait Pointeur et impression reçu/dotation. Vérifier contraste texte BEO après blanc, absence chevauchement sidebar/main/header, absence clip des menus et conservation des champs de périmètre.
