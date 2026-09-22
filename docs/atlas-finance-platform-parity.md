# ATLAS Finance Platform — Traçabilité et parité (mission `feat/atlas-finance-platform`)

Baseline : `542a17861566409b6a61c1dd99338bd494ca0711` (= `origin/main` au démarrage, inchangé
depuis — 5 commits locaux, non poussés). Référence : audit de conformité factuel réalisé en
lecture seule avant cette mission (MISSING confirmé pour Finance Core/Banking/
Reconciliation/Settlement/Budget ; existant réutilisé pour accounting/achats/ventes/
reporting/paie legacy).

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

## EXIT GATE

**EXIT-2** (implémentation réelle et testée pour le socle P0 complet + une majorité des lots
P1, mais P1-A explicitement non tenté et P2/P3 non atteints — ne correspond ni à un socle
absent (EXIT-0/1) ni à une couverture P0/P1 complète (EXIT-4/5)). Le mapping exact des
libellés EXIT-0 à EXIT-5 du prompt maître n'est pas visible dans cette conversation ; cette
désignation reflète l'état réel constaté : **P0 entièrement couvert et testé, P1 couvert à
8/9 lots (P1-A Paie non tenté), P2/P3 non atteints.**
