# ATLAS V3 — Audit de parité DRH V3 ↔ Legacy

Mis à jour par la mission "ATLAS V3 — Phase finale DRH : parité UX/fonctionnelle" (voir
§Phase finale DRH ci-dessous, qui ferme la dette CSS documentée initialement comme
REPORTÉ NON BLOQUANT et enrichit le cockpit). Section d'origine (mission "Phase 3 : migration
complète du domaine DRH", §22) conservée ci-dessous sans changement de fond.

Mission "ATLAS V3 — Phase 3 : migration complète du domaine DRH" (§22). Complète, ne
remplace pas, [`docs/drh-next-v1-parity.md`](./drh-next-v1-parity.md) (audit fonction par
fonction Legacy ↔ DRH Next, 35 lignes, déjà validé) : `modules-v3/drh/**` adapte la logique
métier de DRH Next **verbatim** (mêmes endpoints, mêmes garde-fous RBAC, même absence de
workflow fabriqué) — la parité fonctionnelle Legacy ↔ DRH Next documentée là-bas s'applique
donc telle quelle à DRH V3, sauf mention contraire explicite ci-dessous. Ce document couvre
ce qui **change réellement** entre DRH Next et DRH V3 (runtime, shell visuel, dashboard,
mode de montage) et classe chaque écran DRH V3 face à Legacy selon la légende du §22 :
**PARITÉ** / **V3 SUPÉRIEUR** / **REPORTÉ NON BLOQUANT**.

## Ce qui change entre DRH Next et DRH V3 (architecture, pas logique métier)

| Aspect | DRH Next | DRH V3 | Raison |
|---|---|---|---|
| Runtime | `drh-next/core/*.mjs` (session/api/router/data-loader/permissions/ui, propre au domaine) | `core-v3/*.mjs` (même code, généralisé pour être partagé par tous les domaines migrés) | §17 de la mission |
| Découpage fichiers | `employee-dossier.mjs` unique (594 lignes) portant TOUTES les sections onglets | `employee-dossier.mjs` (orchestration seule) + `contracts.mjs`/`leaves.mjs`/`discipline.mjs`/`documents.mjs`/`attendance.mjs`/`blacklist.mjs` | §3 de la mission, exige explicitement ce découpage |
| Montage | cible un sélecteur fixe `#dn-view` (singleton implicite) | reçoit un conteneur DOM explicite (contrat `core-v3/module-registry.mjs`), mount/unmount/dispose par écran | §5, cohérence avec les autres domaines migrés (dashboard général) |
| Interactivité section mutable | `wire*Section(employee)` rappelle directement `loadSection()` de la closure partagée | `wire(employee, onRefresh)` — callback explicite fourni par le shell parent | conséquence directe du découpage fichiers ci-dessus |
| RBAC domaine | `canAccessDrh()` (propre à drh-next) | `canAccessDrhV3()` (même critère, copié à l'identique — rôles rh/drh/recruteur, préfixe REC, modules/structures) enregistré comme prédicat dans `module-registry.mjs::canEnterModule` | §19, nécessitait d'étendre `canEnterModule` pour accepter une fonction en plus d'une clé de module (voir commit `refactor(v3-drh): add drh shell and dashboard`) |
| Dashboard | `GET /drh/dashboard`, classes CSS `dn-*` | même endpoint `GET /drh/dashboard`, reskinné avec les classes CSS **Legacy** (`dash-kpi`/`dash-panel`, mêmes classes que `modules-v3/dashboard/index.mjs`) | §5/§6 : rester visuellement familier |
| Onglets dossier | classes `dn-*` + `drh-next/styles/*.css` | classes `dn-*` conservées, stylées par `modules-v3/drh/drh-v3.css` (nouveau, Phase finale DRH) | voir §Phase finale DRH ci-dessous |

## Classification par écran

Légende : **PARITÉ** (équivalent fonctionnel à Legacy) · **V3 SUPÉRIEUR** (dépasse Legacy) ·
**REPORTÉ NON BLOQUANT** (écart assumé, documenté, sans perte de fonction critique).

| Écran | Legacy | DRH V3 | Statut | Note |
|---|---|---|---|---|
| Shell/navigation DRH | `sgdi-app.js` (menu latéral, sections DRH intégrées au monolithe) | `modules-v3/drh/index.mjs`, 4 modules indépendants (dashboard/employees/dossier/recrutement), routes `drh`, `drh/employees`, `drh/employees/:id`, `drh/recrutement` | **PARITÉ** | Deep link direct sur un dossier employé conservé (`#/drh/employees/{id}`), comme Legacy. |
| Dashboard DRH | `renderDashboard` (KPI + répartitions + comparaison effectif contrat/réel) | `dashboard.mjs`, `GET /drh/dashboard` + `GET /ui/sidebar-stats`, KPI + Santé des effectifs (effectif contrat/réel/écart) + File de travail DRH + Répartition par site + répartitions employés/candidats + fins de période d'essai, classes `dash-kpi`/`dash-panel` | **V3 SUPÉRIEUR** | Cockpit enrichi Phase finale DRH (voir §Phase finale DRH) : reprend le staffing déjà audité du Dashboard V3 général et ajoute un agrégat serveur ciblé zéro-coût (`employees_by_site`, calculé sur des lignes déjà chargées côté serveur). "Évolution des effectifs" reste différée (aucun agrégat serveur entrées/sorties). |
| Employés (annuaire) | rendu depuis `db.agents` complet en mémoire | `employees.mjs`, **exclusivement** `GET /drh/employees/page` (pagination/recherche/filtre serveur) | **V3 SUPÉRIEUR** | Vérifié en direct (Chrome réel, voir §Performance) : 0 appel à la collection complète sur toute la session observée. |
| Dossier employé (identité/affectation) | `renderDossiers` | `employee-dossier.mjs`, un seul `GET /drh/employees/{id}` | **PARITÉ** | Chargement paresseux des onglets en plus (Legacy charge tout au clic sur la fiche). |
| Contrats | formulaire Legacy → `db.contratsPersonnel` | `contracts.mjs`, `GET/POST /drh/contracts`, `PUT .../{id}` | **PARITÉ** | Identique à DRH Next (déjà PARITÉ face à Legacy). |
| Congés | `renderAgentCongesPanel` | `leaves.mjs`, `GET/POST /drh/leaves`, approve/refuse | **V3 SUPÉRIEUR** | RBAC de validation hérité de DRH Next (absent côté Legacy). |
| Discipline | `renderSanctions` | `discipline.mjs`, `GET/POST /drh/sanctions` | **PARITÉ** | Le schéma backend reste un enregistrement plat (pas de workflow incident→décision) — fidèle à la réalité serveur, comme DRH Next. |
| Documents | `renderDocumentsArchives` | `documents.mjs`, métadonnées + contenu via fetch authentifié → Blob → URL objet locale | **PARITÉ** (métadonnées/aperçu) | Le dépôt de documents reste **BACKEND MANQUANT** (dette `DRH-NEXT-DOC-UPLOAD`, non aggravée, non résolue ici — hors périmètre DRH V3, transverse à `/uploads/*`, voir doc référencée §Documents). |
| Historique / Pointage / Matériel | `renderAffectationsHistorique`, `renderAgentPointageSituation`, `renderAgentMateriel` | `attendance.mjs`, trois vues composées read-only | **PARITÉ** | Lecture seule, sources canoniques ops/materiel, jamais dupliquées (§12/§9 de la mission). |
| Blacklist | `db.agents[].blacklist` (booléen + JSON libre) | `blacklist.mjs`, `EmployeeBlacklistEntry` (enregistrement réversible, motif/auteur/date) | **V3 SUPÉRIEUR** | Décision de schéma déjà tranchée côté DRH Next (voir doc référencée) — reprise à l'identique. |
| Recrutement (liste/recherche) | `db.candidats` en mémoire | `recruitment.mjs`, `GET /drh/candidates/page` | **V3 SUPÉRIEUR** | Paginé/recherché serveur, jamais le vivier complet. |
| Recrutement (détail/actions) | Legacy | convocation, contractualisation, validation finale, recrutement — détail depuis les données déjà reçues (0 appel réseau supplémentaire) | **PARITÉ** | `validate-section` (validation section par section) reste **non branché**, hérité identique de DRH Next (P2, non bloquant). |

## Phase finale DRH — parité UX/fonctionnelle (finition visuelle)

Mission de suite : le moteur V3 était validé (réseau/RBAC/tests), mais la finition visuelle
ne tenait pas la comparaison avec Legacy en production. Cause racine trouvée par lecture de
code puis confirmée par capture Chrome réelle : **les classes `.dn-*` utilisées par tout le
HTML de `modules-v3/drh/**` (tables, badges, onglets, boutons, formulaires...) n'étaient
définies par AUCUN fichier CSS chargé sur `/atlas-v3`** — `drh-next/styles/*.css` (où ces
classes sont réellement définies) n'y a jamais été lié. Le markup était toujours correct,
seul le style manquait — d'où des onglets "collés" (aucune séparation visuelle, aucun état
actif visible) et plus généralement des tableaux/formulaires sans aucune mise en forme.

Corrections apportées :

- **`app/static/modules-v3/drh/drh-v3.css`** (nouveau) : promeut — n'importe pas, adapte,
  même patron que core-v3/*.mjs depuis drh-next/core/*.mjs — les composants `.dn-*` déjà
  matures de DRH Next (card/kpi/badge/table/tabs/input/select/modal/drawer/skeleton/empty/
  error/pagination), jetons repris de `sgdi-app.css` déjà chargé (`var(--primary)`, etc.).
  Chargé sur `/atlas-v3` via `index.html` + versionné (`?v=`) dans `main.py::serve_atlas_v3`.
- **Bug additionnel trouvé par la même capture Chrome** (pas seulement les onglets) : les
  formulaires "+ Nouveau..." (contrats/congés/sanctions/blacklist/recrutement) portaient à la
  fois `hidden` et un style en ligne `display:flex` — l'inline bat toujours `[hidden]{display:
  none}`, donc le formulaire restait visible en permanence dès l'ouverture de l'onglet.
  Corrigé par une seule règle `[hidden]{display:none!important}` dans `drh-v3.css` (couvre
  les 7 occurrences sans toucher au markup de chaque fichier) — revérifié en Chrome réel
  (toggle testé : masqué par défaut, apparaît au clic, comme prévu).
- **`.dash-pilot-staffing` non stylé** (préexistant, partagé avec le Dashboard V3 général,
  trouvé en vérifiant le nouveau panneau "Santé des effectifs") : `span`/`strong`/`small`
  sont des éléments en ligne par défaut, donc "EFF CONTRAT150Contrats..." s'affichait collé
  sur une ligne. Corrigé dans `core-v3/atlas-v3.css` (générique, pas spécifique DRH).
- **Coquille applicative** (`atlas-v3/app.mjs` + `core-v3/atlas-v3.css`) : sidebar à groupes
  ("Général" / "Ressources humaines", jamais de lien vers une route non enregistrée), en-tête
  avec société active + avatar + nom, bascule mobile (sidebar hors-écran <860px avec bouton
  hamburger), navigation clavier ←/→ entre onglets du dossier.
- **Dossier employé** : résumé d'en-tête enrichi (statut, société, site actuel, type de
  contrat — déjà présents dans la réponse `GET /drh/employees/{id}`, aucun appel
  supplémentaire) ; onglets Identité/Affectation restructurés en sections thématiques (État
  civil / Situation familiale / Coordonnées, Affectation actuelle / Contrat) au lieu d'une
  table brute unique — mêmes données réelles, aucune inventée.
- **Dashboard DRH** : voir ligne "Dashboard DRH" ci-dessus — Santé des effectifs, File de
  travail DRH, Répartition par site ajoutés.

Vérifié en Chrome réel (Puppeteer, backend réel + sqlite seedé, 70 employés) à 1440/768/390px :
0 débordement horizontal sur les 18 écrans capturés (6 écrans × 3 largeurs), 0 appel à la
collection complète des employés sur 18 requêtes `/api/*` observées, budget de performance
respecté (Dashboard DRH +13 à +19 % vs baseline 238 ms — sous le seuil de 20 % malgré l'ajout
d'un second agrégat serveur ; Dossier plus rapide que la baseline, −27 à −29 %).

**Classes `.dn-*` : dette FERMÉE** (était REPORTÉ NON BLOQUANT dans la version précédente de
ce document — le pixel-match n'est plus limité au dashboard/annuaire, tous les écrans DRH V3
en bénéficient désormais).

## Dette assumée (documentée, pas silencieuse)

- **Pas d'agrégat "périodes d'essai à échéance" filtrées par date** : `GET /drh/dashboard`
  renvoie `trial_periods` sans filtre de date (voir doc DRH Next référencée, LOT 10) — hérité
  identique, pas une régression V3.
- **`docs/drh-next-v1-parity.md` reste la référence** pour tous les écarts déjà documentés et
  non modifiés par ce lot (avenant, convocation disciplinaire, mise en demeure, période
  E-N-C, habilitations, exports, impressions, portail RH, timeline) — non repris ici pour
  éviter une duplication qui pourrait diverger silencieusement de la source.

## Ce qui n'a PAS été migré cette phase (§26 de la mission)

OPS, Superviseur, Matériel, Finance restent servis par `sgdi-app.js` (Legacy) sans aucune
modification — aucun lien de sidebar DRH V3 ne pointe vers ces domaines.
