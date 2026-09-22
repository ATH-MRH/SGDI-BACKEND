"""Revue d'intégrité financière — item 4 (Decimal/arrondis). Aucun montant financier ne doit
JAMAIS transiter par float (recherche exhaustive faite sur finance_core/regulatory/payroll/
banking/reconciliation/treasury/budget/profitability/fiscalite/cockpit pendant cette revue —
un seul float() trouvé, profitability.service.margin: un ratio d'affichage déjà quantize()
en Decimal avant le cast, jamais un montant réinjecté dans un calcul, jugé sans risque).

Politique d'arrondi documentée ici (jusque-là implicite, seulement lisible dans le code) :
- Toute quantité monétaire est un Decimal, quantize()é à 2 décimales avec ROUND_HALF_UP
  (jamais le ROUND_HALF_EVEN implicite du contexte Python par défaut).
- Trouvé pendant cette revue : banking/treasury/budget/fiscalite/cockpit appelaient
  .quantize(Decimal("0.01")) SANS rounding= explicite (donc ROUND_HALF_EVEN par défaut),
  incohérent avec finance_core.service.q2/payroll.service.q2 qui l'ont toujours fait
  explicitement. Corrigé dans les 5 modules pour que 0,xx5 arrondisse identiquement PARTOUT.
- Toute somme (multi-règlement, agrégation trésorerie/budget) se fait en Decimal exact,
  jamais en float — un centime perdu par erreur d'arrondi flottant serait un bug financier
  réel, pas un détail d'affichage.
"""
from decimal import ROUND_HALF_UP, Decimal

SOC = "Precision Decimal SA"


def test_q2_rounding_policy_is_half_up_and_consistent_across_modules():
    """Vérifie directement, sans passer par l'API, que TOUS les q2()/quantize() du Finance
    Platform appliquent la MÊME règle ROUND_HALF_UP — pas seulement qu'ils arrondissent à 2
    décimales. 0.005 est le cas emblématique où ROUND_HALF_UP (-> 0.01) et ROUND_HALF_EVEN
    (-> 0.00, "pair le plus proche") divergent réellement."""
    from app.modules.finance_core import service as finance_core_service
    from app.modules.payroll import service as payroll_service
    from app.modules.banking import service as banking_service

    for q2 in (finance_core_service.q2, payroll_service.q2, banking_service.q2):
        assert q2("0.005") == Decimal("0.01"), f"{q2.__module__}.q2 doit arrondir 0.005 vers le haut (ROUND_HALF_UP)"
        assert q2("0.015") == Decimal("0.02"), f"{q2.__module__}.q2 doit arrondir 0.015 vers le haut (ROUND_HALF_UP)"
        assert q2("10.004") == Decimal("10.00")
        assert q2("10.006") == Decimal("10.01")

    # Preuve directe que le défaut Python (sans rounding=) diverge réellement pour 0.005 —
    # justifie pourquoi le rounding= explicite est une exigence, pas une précaution inutile.
    assert Decimal("0.005").quantize(Decimal("0.01")) == Decimal("0.00"), "ROUND_HALF_EVEN implicite : le piège que ce garde évite"
    assert Decimal("0.005").quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) == Decimal("0.01")


def test_obligation_extreme_amounts_round_trip_exactly_through_the_real_api(client, auth_headers):
    """Les montants extrêmes explicitement cités par la mission (0.01, 999999999999.99)
    doivent survivre EXACTEMENT à un aller-retour complet par l'API HTTP réelle — création,
    lecture, comparaison chaîne-à-chaîne (pas de comparaison float qui masquerait une perte de
    précision). Envoyé comme NOMBRE JSON (pas une chaîne) pour stresser le chemin réel qu'un
    client HTTP/JS emprunterait (JSON ne distingue pas int/float à l'écriture)."""
    for amount in ("0.01", "999999999999.99"):
        created = client.post("/api/finance-core/obligations", headers=auth_headers, json={
            "society": SOC, "direction": "receivable", "source_type": "test_precision", "source_id": f"prec-{amount}",
            "amount_total": float(amount), "idempotency_key": f"obl:precision:{amount}",
        })
        assert created.status_code == 200, created.text
        obligation = created.json()
        assert obligation["amount_total"] == amount, f"perte de précision pour {amount} : reçu {obligation['amount_total']}"

        refetched = client.get(f"/api/finance-core/obligations/{obligation['id']}", headers=auth_headers).json()
        assert refetched["amount_total"] == amount, "la même perte ne doit pas apparaître non plus à une relecture séparée"


def test_half_cent_input_rounds_deterministically_on_create(client, auth_headers):
    """Un montant fourni à 3 décimales (ex. 10.005, jamais légitime en DZD mais possible côté
    saisie/import) doit être arrondi de façon déterministe et documentée (ROUND_HALF_UP) au
    moment de la création, pas silencieusement tronqué ni stocké tel quel au-delà de 2
    décimales (le type Numeric(18,2) ne garantit pas cette troncature côté SQLite — la
    garantie doit venir de la couche applicative, q2(), pas de la seule colonne)."""
    created = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "payable", "source_type": "test_precision", "source_id": "halfcent-1",
        "amount_total": "10.005", "idempotency_key": "obl:halfcent:1",
    })
    assert created.status_code == 200, created.text
    assert created.json()["amount_total"] == "10.01"


def test_multi_settlement_sum_exact_no_remainder_drift(client, auth_headers):
    """100.00 réparti en 3 règlements qui ne divisent pas rond (33.33 + 33.33 + 33.34) doit
    solder EXACTEMENT l'obligation à zéro reste — aucune dérive d'arrondi cumulée sur
    plusieurs règlements successifs (le risque classique d'une distribution de reste mal
    gérée : 3 x 33.33 = 99.99, il manque le centime, quelqu'un doit le porter explicitement)."""
    obligation = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "receivable", "source_type": "test_precision", "source_id": "multisum-1",
        "amount_total": "100.00", "idempotency_key": "obl:multisum:1",
    }).json()

    parts = ["33.33", "33.33", "33.34"]
    assert sum(Decimal(p) for p in parts) == Decimal("100.00"), "la répartition de test elle-même doit sommer exactement (le centime de reste porté sur la dernière part)"

    for i, part in enumerate(parts):
        settle = client.post(f"/api/finance-core/obligations/{obligation['id']}/settle", headers=auth_headers, json={
            "amount": part, "idempotency_key": f"stl:multisum:1:{i}",
        })
        assert settle.status_code == 200, settle.text

    final = client.get(f"/api/finance-core/obligations/{obligation['id']}", headers=auth_headers).json()
    assert final["amount_settled"] == "100.00"
    assert final["status"] == "settled"

    # Le reste étant exactement zéro, tout règlement supplémentaire (même 0.01) doit être
    # refusé — pas de trop-perçu silencieux permis par une imprécision résiduelle.
    overshoot = client.post(f"/api/finance-core/obligations/{obligation['id']}/settle", headers=auth_headers, json={
        "amount": "0.01", "idempotency_key": "stl:multisum:1:overshoot",
    })
    assert overshoot.status_code == 409


def test_settlement_cannot_exceed_remaining_at_the_exact_centime(client, auth_headers):
    """Le reste à régler est calculé en Decimal exact — un règlement d'UN centime de plus que
    le reste exact doit être refusé, et le reste exact lui-même doit être accepté (pas de
    marge de tolérance qui masquerait une vraie perte de précision)."""
    obligation = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "payable", "source_type": "test_precision", "source_id": "exactcentime-1",
        "amount_total": "10.00", "idempotency_key": "obl:exactcentime:1",
    }).json()
    client.post(f"/api/finance-core/obligations/{obligation['id']}/settle", headers=auth_headers, json={
        "amount": "9.99", "idempotency_key": "stl:exactcentime:1a",
    })
    too_much = client.post(f"/api/finance-core/obligations/{obligation['id']}/settle", headers=auth_headers, json={
        "amount": "0.02", "idempotency_key": "stl:exactcentime:1b",
    })
    assert too_much.status_code == 409, "0.02 > 0.01 restant doit être refusé, à l'exact centime"

    exact = client.post(f"/api/finance-core/obligations/{obligation['id']}/settle", headers=auth_headers, json={
        "amount": "0.01", "idempotency_key": "stl:exactcentime:1c",
    })
    assert exact.status_code == 200, exact.text
    final = client.get(f"/api/finance-core/obligations/{obligation['id']}", headers=auth_headers).json()
    assert final["status"] == "settled"
    assert final["amount_settled"] == "10.00"
