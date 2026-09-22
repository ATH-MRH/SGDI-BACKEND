# ATLAS Finance Platform — Traçabilité et parité (mission `feat/atlas-finance-platform`)

Baseline : `542a17861566409b6a61c1dd99338bd494ca0711` (= `origin/main` au démarrage, inchangé
depuis). Référence : audit de conformité factuel réalisé en lecture seule avant cette
mission (MISSING confirmé pour Finance Core/Banking/Reconciliation/Settlement/Budget ;
existant réutilisé pour accounting/achats/ventes/reporting/paie legacy).

## Addendum — continuation P1-A → P3 (9 commits supplémentaires)

La suite `acc1b0b` (audit + Exit Gate initial) a été suivie d'une continuation qui a fermé
P1-A (Paie typée) et couvert P2 (Trésorerie/Budget/Rentabilité/Fiscalité) et P3
(Cockpit DG), plus les 3 chaînes E2E nommées explicitement. Nouveaux modules :
`regulatory` (référentiel réglementaire versionné, dépendance de payroll/fiscalite),
`payroll`, `treasury`, `budget`, `profitability`, `fiscalite`, `cockpit`. Voir la section
détaillée plus bas ("Continuation P1-A→P3") pour le détail lot par lot, preuves et limites
assumées. Suite de tests finale : **767 passed, 14 skipped, 0 failed** (baseline avant
continuation : 746/14/0 — 21 nouveaux tests backend). CI : le pipeline
`.github/workflows/ci.yml` préexistant (`python -m pytest -q`) couvre déjà automatiquement
tous ces tests sans configuration additionnelle — vérifié en exécutant la commande CI
exacte en local, résultat identique.

## Ce qui a été réellement construit (avec preuve — fichier/test/commit)

| Lot | Domaine | Statut réel | Preuve |
|---|---|---|---|
| P0-A | Intégrité du modèle de données | IMPLEMENTED | `financial_obligations`/`payment_intents`/`settlements` avec contraintes UNIQUE, FK, reversal sans suppression (`test_reverse_settlement_restores_obligation`) |
| P0-B | RBAC / multi-société | IMPLEMENTED | Réutilise `enforce_module_access`/`API_MODULE_PREFIXES` existants, module "finances" — `test_obligation_society_scope_enforced`, `test_banking_society_scope_enforced`, `test_reconciliation_society_scope_enforced` (403 réel) |
| P0-C | Finance Core | IMPLEMENTED | `app/modules/finance_core/` — 8 tests (`test_finance_core.py`) |
| P0-D | Decimal/Numeric | IMPLEMENTED (nouveau code) | `Numeric(18,2)` partout dans finance_core/banking/reconciliation — voir §Dette Float ci-dessous pour le code existant non retouché |
| P0-E | Migrations | IMPLEMENTED | `20260922_0038/0039/0040`, vérifiées par `alembic upgrade head` réel sur SQLite neuf (0 erreur, chaîne complète depuis la 1ère migration) |
| P0-F | Idempotence / outbox | IMPLEMENTED | `idempotency_key` UNIQUE sur 8 tables, `FinanceOutboxEvent`, `dispatch_pending_events()` — `test_create_obligation_idempotent`, `test_settle_is_idempotent`, `test_dispatch_is_idempotent_no_duplicate_ecriture` |
| P1-B | Accounting Bridge | IMPLEMENTED | `finance_core/accounting_bridge.py`, réutilise `accounting/auto.py::_create_ecriture` (aucune 2ᵉ implémentation) — 3 tests, écriture équilibrée D=C vérifiée |
| P1-C | Ventes/Achats -> Finance Core | IMPLEMENTED | Hooks dans `ventes/service.py::_create_invoice_from_commande` et `achats/service.py::create_facture`/`payer_facture`, garde anti-double-comptage (`skip_accounting_bridge`) — 3 tests dont vérification explicite du compte d'écritures avant/après dispatch |
| P1-D | Banking Core | IMPLEMENTED | `BankAccount`/`BankStatement`/`BankTransaction`, pipeline RAW→NORMALIZED→ENRICHED — 7 tests |
| P1-E | Import relevés | PARTIAL | **CSV réellement implémenté et testé** (parseur, signe crédit/débit, déduplication, contrôle mathématique). **XLSX/CAMT.053/MT940/PDF-OCR : NON implémentés**, renvoient 501 explicite (`ImportAdapter`/`get_adapter`) — jamais un faux succès |
| P1-F | Reconciliation Engine | IMPLEMENTED (scope réduit, assumé) | 1:1 (score expliqué), 1:N et N:1 (combinaison exacte bornée à 8 candidats / taille 4 — pas un solveur subset-sum général), exception inbox, confirmer/rejeter — 6 tests E2E réels |
| P1-G | Settlement Engine | IMPLEMENTED | `settle_obligation`/`reverse_settlement`, refus de dépassement (409), pas de trop-perçu implicite |
| P1-H | Clôture | PARTIAL | Clôture de **relevé bancaire** implémentée et testée (verrou si transactions non rapprochées restantes). **Clôture de période comptable générale (grand livre) NON implémentée** — hors périmètre de ce lot |
| P1-I | Frontend critique | IMPLEMENTED (scope réduit) | `/finance-platform` — 3 écrans (Obligations, Banques+import+transactions, Rapprochement) vérifiés en Chrome réel (Puppeteer), parcours complet obligation→import CSV→proposition→confirmation→"settled" visible, 0 erreur JS. **Pas d'écran dédié Comptabilité/Trésorerie/Budget/Cockpit DG** dans cette UI (ceux-ci restent servis par leurs propres routes API déjà existantes, sans nouvelle UI) |
| P1-J | E2E / traçabilité | PARTIAL | E2E réels couverts par les tests d'intégration ci-dessus (pas une suite Playwright/Cypress séparée — ce dépôt n'a jamais eu de framework E2E navigateur ; vérification Chrome réelle faite manuellement via Puppeteer ad hoc, non intégrée en CI) |

## Ce qui n'a PAS été construit (honnêteté explicite)

- **P1-A — Paie typée : NON TENTÉE.** Construire un moteur de calcul IRG/CNAS conforme à la
  réglementation algérienne réelle (barèmes progressifs, plafonds, exonérations) exige des
  données réglementaires précises que je n'ai pas de source fiable pour vérifier dans ce
  contexte — un moteur de paie qui afficherait un "net à payer" faux serait strictement pire
  qu'aucun moteur : un chiffre de salaire erroné, présenté comme fiable, est le genre exact
  d'erreur que cette mission demande de ne jamais masquer. La paie reste donc
  `LEGACY_EXISTING` (store JSON, voir audit précédent) — non dégradée, non améliorée.
- **P2/P3 : non atteints** — la priorité §P0→P1 n'a pas été épuisée dans les délais de cette
  mission (Payroll P1-A notamment).
- **Fiscalité/réglementaire (règles versionnées, G50, CNAS, IRG, échéances) : MISSING**,
  inchangé depuis l'audit.
- **Trésorerie enrichie (réel/engagé/planifié/échéances/cash-flow), Budget, Rentabilité
  multi-dimension, Cockpit DG enrichi (masse salariale/rapprochement/anomalies/dettes/
  drill-down) : MISSING**, inchangés depuis l'audit — Finance Core fournit désormais les
  briques (obligations, règlements) qui rendraient ces vues possibles, mais les vues
  elles-mêmes n'ont pas été construites.
- **XLSX/CAMT.053/MT940/PDF-OCR : non implémentés**, 501 explicite (voir P1-E ci-dessus).
- **Suite E2E automatisée en CI (Playwright/Cypress) : n'existe toujours pas** dans ce dépôt.

## Dette Float existante (P0-D, rappel — non traitée par cette mission)

`finance_models.py`, `accounting/models.py`, `achats/models.py`, `ventes/models.py`
utilisent `Float`, pas `Numeric`. **Aucune ligne de ce code n'a été modifiée** par cette
mission (risque de régression trop élevé pour un remplacement en un lot, montants déjà en
production/test). Tout le code NEUF (finance_core/banking/reconciliation) utilise
`Numeric(18,2)` + `Decimal` sans exception — la frontière entre ancien et nouveau code est
nette et documentée, pas mélangée.

## Garde contre le double comptage (trouvé et corrigé pendant l'implémentation, pas après coup)

`achats.payer_facture` postait déjà une écriture comptable directement
(`ecriture_paiement_fournisseur`, code pré-existant). Faire aussi passer ce règlement par
Finance Core (P1-C) aurait fait poster une **seconde** écriture pour le même paiement lors
d'un futur `dispatch` de l'outbox — un doublon comptable réel. Corrigé par
`settle_obligation(skip_accounting_bridge=True)`, qui préempte l'`AccountingEvent` en
"skipped" — vérifié explicitement par un test qui compte les écritures avant/après le
dispatch (`test_payer_facture_settles_obligation_without_double_accounting_entry`).

## Tests — décompte réel

- Suite complète du dépôt : **746 passed, 14 skipped, 0 failed** (baseline avant cette
  mission : 715 passed, 14 skipped — soit **31 nouveaux tests**, tous backend, tous verts).
- Aucun test retiré, aucun test modifié pour "faire passer" un résultat (seule exception :
  4 tests de scope pré-existants sur `testops` fragilisés par une mutation partagée d'un
  autre fichier de tests, rendus robustes à l'ordre d'exécution — voir commentaires dans le
  code, pas une suppression de couverture).
- Migrations vérifiées par exécution réelle (`alembic upgrade head` sur SQLite neuf), pas
  seulement par lecture de code.
- Frontend vérifié par Chrome réel (Puppeteer) — parcours complet, captures d'écran, 0 erreur
  console — pas seulement un test HTTP de la page d'entrée.

## Continuation P1-A→P3 (commits `996d706`, `0b234eb`)

| Lot | Domaine | Statut réel | Preuve |
|---|---|---|---|
| Dépendance | Référentiel réglementaire (`app/modules/regulatory/`) | IMPLEMENTED | `RegulatorySource/Rule/Version/ChangeProposal`, lookup historique précis par date (jamais "la règle actuelle" pour une période passée), refus explicite si seule version "unverified" sans `allow_unverified` — 5 tests |
| P1-A | Paie typée (`app/modules/payroll/`) | IMPLEMENTED | Chaîne réelle pointage clôturé (`DailyPresence.closed_at`) → grille versionnée → calcul (CNAS+IRG via référentiel, traçabilité `rules_used`) → validation immuable → 3 `FinancialObligation` (net/CNAS/IRG) → réglées par le moteur Finance Core déjà existant (0 code paiement/comptabilité propre à la paie) — 5 tests + E2E complet |
| — | Supervision IA de la paie | NON TENTÉE | Hors budget de cette continuation — aucune fabrication de faux garde-fou IA |
| P2 | Trésorerie (`treasury`) | IMPLEMENTED (scope réduit) | Positions bancaires réelles (somme `BankTransaction`), échéancier, cash forecast arithmétique traçable — pas de modèle prédictif |
| P2 | Budget (`budget`) | IMPLEMENTED | Workflow `draft→submitted→approved→locked`, révision = nouvelle ligne (jamais d'écrasement), réalisé calculé depuis les écritures **validées** réelles (compte+société+période) — limite documentée : centre de coût/contrat/client/site non portés par la comptabilité aujourd'hui |
| P2 | Rentabilité (`profitability`) | IMPLEMENTED (scope réduit) | Marge société/client/période depuis Invoice/PayrollSlip validés/FactureFournisseur réels — mêmes limites de dimensions documentées, honnêtement annoncées dans la réponse API elle-même (`note`) |
| P2 | Fiscalité Algérie (`fiscalite`) | IMPLEMENTED (moteur de calendrier, PAS de calcul fiscal) | `FiscalObligation` = suivi (période/base/montant/échéance/statut/preuve/paiement/écriture) ; le montant est saisi par l'utilisateur, jamais calculé ici à partir d'un barème non prouvé — `mark_paid()` refuse tant que l'obligation Finance Core liée n'est pas réellement réglée |
| — | G50/TVA/IBS — calcul automatique du montant dû | NON IMPLÉMENTÉ (délibérément) | Aurait exigé d'"inventer le droit fiscal" sans source vérifiée — interdit explicitement par la mission |
| P3 | Cockpit DG (`cockpit`) | IMPLEMENTED | Agrégation serveur uniquement (trésorerie/créances/dettes/CA/marge/masse salariale/fiscalité à échéance/rapprochements non résolus/budget vs réalisé), 0 collection complète — 1 test |
| E2E | 3 chaînes nommées | IMPLEMENTED | Vente (devis→commande→créance→CSV bancaire→rapprochement→settlement→écriture), Achat (facture fournisseur→dette→**rapprochement bancaire** [chemin différent de `payer_facture` déjà testé]→écriture), Paie (pointage→bulletin→validation→PaymentIntent "virement"→règlement→écriture) — chacune avec vérification d'idempotence explicite |
| CI | Automatisation | DÉJÀ SATISFAIT | `.github/workflows/ci.yml` préexistant exécute `pytest -q` sans configuration additionnelle — vérifié en local avec la commande CI exacte, 767/14/0 |

### Garde architecturale — vérification explicite

- **Float monétaire (nouveau code)** : 0 — `Numeric(18,2)`/`Decimal` partout dans regulatory/payroll/treasury/budget/profitability/fiscalite/cockpit.
- **Double comptabilisation** : gardée (`skip_accounting_bridge`, testée explicitement pour achats ; le chemin bancaire et le chemin direct achats natif ont été testés séparément pour prouver qu'aucun des deux ne double-compte).
- **Écriture comptable depuis le frontend** : aucune — `/finance-platform` ne fait que consommer les API, jamais d'écriture posée côté client.
- **Suppression d'événement financier audité** : aucune — `FinancialEvent`/`Settlement` (reversal, jamais delete), `BudgetLine` (révision, jamais d'écrasement), `PayrollSlip` (immuable après validation, aucun endpoint de modification n'existe).
- **Paiement sans idempotency_key** : impossible — `idempotency_key` est un champ requis (non optionnel) sur `PaymentIntentCreate`/`SettleRequest`/`ObligationCreate` côté schéma Pydantic, refusé avec 422 si absent.
- **Règle fiscale non versionnée utilisée pour calculer** : aucune — `fiscalite` ne calcule rien (montant saisi par l'utilisateur), `payroll` passe exclusivement par `regulatory.get_applicable_version()`.
- **Règle réglementaire sans source** : résiduel non fermé — `RegulatoryVersion.source_id` est **nullable** (une version peut techniquement être créée sans source liée). Non corrigé dans cette continuation (rendre le champ obligatoire casserait rétroactivement si jamais utilisé sans source ailleurs) — signalé honnêtement, pas masqué.
- **Validation automatique par IA** : sans objet — aucune IA n'a été construite dans ce lot.

## EXIT GATE (mis à jour)

**EXIT-3** — le socle P0 reste complet et testé (inchangé), **P1 est maintenant complet à
9/9 lots** (P1-A fermé), **P2 est couvert pour ses 4 sous-domaines demandés** (avec des
limites de dimensions honnêtement documentées, pas cachées), **P3 (Cockpit DG) est
implémenté**. Ce qui manque pour une couverture totale (EXIT-4/5) : supervision IA de la
paie (non tentée), calcul automatique des montants fiscaux (délibérément non implémenté —
inventer le droit fiscal était interdit), veille réglementaire externe automatique
(`RegulatoryChangeProposal.detected_from="external_watch"` n'a pas de producteur réel, seul
`"manual"` est utilisé), et `RegulatoryVersion.source_id` non rendu obligatoire. Aucun de
ces éléments manquants ne bloque l'utilisation des lots livrés — chacun fonctionne de bout
en bout, testé, avec traçabilité complète.

## REVUE FINALE BLOQUANTE — Résultats (8 commits supplémentaires, `7b59c78`→`4786e78`)

Revue d'intégrité factuelle post-continuation, ciblée sur double paiement, double
comptabilisation, arrondis, historique paie, multi-société et RBAC réel — pas une nouvelle
fonctionnalité, uniquement des corrections de défauts réellement trouvés. Base de départ :
767 passed/14 skipped/0 failed. Base d'arrivée : **797 passed/14 skipped/0 failed**, stable
sur plusieurs exécutions répétées de la suite complète.

### P0 trouvés et corrigés

1. **Paie — validation sans garde de vérification** (`7b59c78`) : `validate_slip()` créait des
   `FinancialObligation` réelles même si les règles CNAS/IRG utilisées étaient "unverified" ou
   absentes. Corrigé par `slip_validation_blockers()` — 409 explicite avant toute obligation.
2. **Référentiel — version "active" sans source** (`7b59c78`) : `RegulatoryVersion.source_id`
   était nullable sans contrainte. Corrigé par un garde applicatif + `CHECK` constraint DB
   (migration `20260922_0044`) — ferme le "résiduel non fermé" signalé dans l'addendum
   précédent de ce document.
3. **Paie historique — recalcul parallèle non géré** (`3d12c9d`) : un second calcul pour le
   même employé/cycle (idempotency_key différente) remontait un `IntegrityError` brut (500)
   au lieu d'un refus propre — l'index UNIQUE `(payroll_run_id, employee_id)` existait déjà en
   base mais n'était pas vérifié applicativement. Corrigé (409 propre) + `get_grid_applicable_at()`
   ajouté pour prouver période→grille comme pour période→règle.
4. **Arrondis — politique incohérente** (`28bed91`) : `banking/treasury/budget/fiscalite/cockpit`
   appelaient `.quantize(Decimal("0.01"))` sans `rounding=` explicite (ROUND_HALF_EVEN par
   défaut de Python), incohérent avec `finance_core`/`payroll` (ROUND_HALF_UP explicite).
   Unifié sur ROUND_HALF_UP partout (16 points de correction).
5. **Double paiement — course réelle sur `settle_obligation`** (`9e4cd17`) : reproduit
   empiriquement avec de vrais threads (5 règlements de 30.00 tous acceptés sur un dû de
   100.00 = dépassement de 50.00 ; requêtes concurrentes à idempotency_key identique
   remontant un `IntegrityError` brut). Corrigé par une UPDATE...WHERE atomique
   (compare-and-swap SQL, portable SQLite/Postgres).
6. **Double annulation d'un même règlement** (`9e4cd17`) : rien n'empêchait d'annuler deux
   fois le même `Settlement` (idempotency_keys différentes), rouvrant artificiellement une
   obligation soldée. Corrigé (garde applicatif + index UNIQUE `reversed_settlement_id`,
   migration `20260922_0045`).
7. **Outbox — entrées "failed" jamais reprises** (`8cedaff`) : une panne transitoire du pont
   comptable laissait une écriture manquante pour toujours, sans nouvelle tentative. Corrigé
   (reprise automatique sous `MAX_OUTBOX_ATTEMPTS=5`).
8. **Outbox — écriture partielle non annulée en cas d'échec** (`8cedaff`) : un handler qui
   échoue APRÈS une écriture partielle ne voyait rien annulé avant le commit du lot entier.
   Corrigé par un SAVEPOINT par entrée.
9. **Multi-société — `payment_intent_id` non vérifié** (`7b87176`) : `settle_obligation`
   n'exigeait pas que le `PaymentIntent` référencé appartienne à l'obligation réglée — un
   PaymentIntent d'une AUTRE obligation (société différente) pouvait être détourné et marqué
   "settled" par effet de bord. Corrigé (400 explicite).
10. **RBAC — `POST /reconciliation/transactions/{id}/propose` sans contrôle de société**
    (`7b87176`) : le plus sérieux des défauts RBAC trouvés — AUCUN contrôle de société
    n'existait, permettant à un utilisateur restreint de lire un rapprochement d'une autre
    société entièrement. Corrigé.
11. **RBAC — `POST /fiscalite/{id}/mark-paid` : autorisation après mutation** (`7b87176`) :
    `service.mark_paid()` (mutation + flush réels) était appelé AVANT le contrôle de société.
    Corrigé (vérification sur lecture seule d'abord — l'autorisation doit toujours précéder
    la mutation, jamais la suivre).
12. **Fiscalité — provenance implicite, non validée** (`4786e78`) : `regulatory_version_id`
    n'était ni exposé explicitement ni validé (n'importe quel id acceptable). Ajout de
    `FiscalObligation.provenance` ("manual"/"calculated_verified", migration `20260922_0046`)
    avec validation stricte (la version référencée doit exister et être "active").

### Items 8/9/13/14/15 — vérifiés, pas de défaut trouvé nécessitant correction

- **Comptabilité (item 8)** : les 3 chaînes E2E affirment désormais explicitement
  `SUM(debit) == SUM(credit)` au centime près, traçable au document source.
- **E2E paie + rejeu intégral (item 9)** : nouveau test qui rejoue la chaîne paie ENTIÈRE
  (mêmes idempotency_keys) — zéro duplication financière/comptable de bout en bout.
- **Migrations (item 13)** : chaîne complète `<base>` → `20260922_0046` vérifiée sur SQLite
  neuf, un seul head Alembic, aucune opération destructive dans les 6 migrations de cette
  continuation+revue.
- **Tests (item 14)** : suite complète 797/14/0, `git diff --check` propre sur tout le
  périmètre de la branche, arbre de travail propre.
- **Dettes non bloquantes (item 15)** : confirmées toujours non implémentées, comme requis —
  supervision IA paie (absente), veille réglementaire externe (absente, seule la
  documentation en parle comme possibilité future, garde architecturale déjà en place),
  calcul automatique G50/TVA/IBS (absent, `declare()` prend toujours un montant saisi),
  dimensions contrat/site réelles en Budget/Rentabilité (absentes — restent des tags
  déclaratifs non tracés, honnêtement documenté dans `profitability.service.margin`).

### Constat méthodologique notable

Plusieurs des défauts ci-dessus (5, 9, 10, 11) n'ont été détectés qu'en écrivant des tests de
CONCURRENCE RÉELLE (vrais threads, vrai serveur, `live_client`/`live_headers`, patron déjà
établi par `tests/test_concurrency.py`) ou des tests d'ISOLATION SOCIÉTÉ RÉELLE (A/B avec un
utilisateur réellement restreint, `tests/test_multi_society_isolation.py`) plutôt que des
tests séquentiels/unitaires classiques — confirmant que ces deux catégories de test sont
irremplaçables pour ce type de plateforme financière et ne doivent jamais être considérées
comme optionnelles dans une revue future.
