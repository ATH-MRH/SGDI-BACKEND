# ATLAS V3 — Audit de parité DRH V3 ↔ Legacy

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
| Onglets dossier | classes `dn-*` | classes `dn-*` conservées telles quelles | voir §Dette assumée ci-dessous |

## Classification par écran

Légende : **PARITÉ** (équivalent fonctionnel à Legacy) · **V3 SUPÉRIEUR** (dépasse Legacy) ·
**REPORTÉ NON BLOQUANT** (écart assumé, documenté, sans perte de fonction critique).

| Écran | Legacy | DRH V3 | Statut | Note |
|---|---|---|---|---|
| Shell/navigation DRH | `sgdi-app.js` (menu latéral, sections DRH intégrées au monolithe) | `modules-v3/drh/index.mjs`, 4 modules indépendants (dashboard/employees/dossier/recrutement), routes `drh`, `drh/employees`, `drh/employees/:id`, `drh/recrutement` | **PARITÉ** | Deep link direct sur un dossier employé conservé (`#/drh/employees/{id}`), comme Legacy. |
| Dashboard DRH | `renderDashboard` (KPI + répartitions) | `dashboard.mjs`, `GET /drh/dashboard`, KPI + répartitions employés/candidats + fins de période d'essai, classes `dash-kpi`/`dash-panel` | **V3 SUPÉRIEUR** | Même agrégat que DRH Next (déjà classé NEXT SUPÉRIEUR face à Legacy dans l'audit référencé — répartition complète affichée, jamais exploitée par Legacy sous cette forme), en plus visuellement aligné sur le design Legacy. |
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

## Dette assumée (documentée, pas silencieuse)

- **Classes CSS `dn-*` dans les onglets du dossier employé** : le shell/dashboard/annuaire ont
  été reskinnés avec les classes CSS Legacy (`dash-kpi`, `dash-panel`, `dn-table`/`dn-badge`
  restent utilisées dans les tableaux car Legacy n'a pas d'équivalent direct pour ces
  composants). Stratégie assumée (§25 : le travail restant n'est pas une cause d'arrêt, mais
  n'oblige pas non plus à tout refaire au pixel près en un seul lot) : prioriser le pixel-match
  sur les écrans à plus fort trafic (dashboard, annuaire), documenter honnêtement le reste
  plutôt que le prétendre identique. **REPORTÉ NON BLOQUANT** — aucune fonction perdue, lisible
  et cohérent en l'état.
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
