"""Revue finale bloquante V2, item 7 (RBAC) — profil "C. read-only" explicitement demandé par
la mission, jamais testé jusqu'ici pour le périmètre Finance. Le modèle le permet déjà
(User.authorized_actions, AUTHORIZED_ACTIONS incluant "read" — voir
app/modules/auth/dependencies.py, enforce_module_access + le filtre sur request_action) :
un compte avec le module "finances" ET authorized_actions=["read"] doit pouvoir LIRE tout le
périmètre Finance mais aucune mutation ne doit jamais aboutir, backend compris (jamais
seulement une garde d'interface).

Un utilisateur DÉDIÉ est créé ici plutôt que de muter le compte partagé "testops" (fixture
`restricted_headers`) : TROUVÉ EN CONSTRUISANT CE TEST — un premier essai mutait testops.
authorized_actions puis commitait (db.commit()), ce qui persiste au-delà du rollback de fin
de test (le rollback de la fixture `db` n'annule que ce qui n'a pas encore été commité) et
polluait durablement la base de test pour TOUTE la session pytest : des tests plus tard dans
la même session (tests/test_ops.py::test_site_and_employee_404_before_403,
tests/test_secretariat_pointage.py::test_unlock_pointage_allowed_for_ops_role) se sont mis à
échouer parce que testops n'avait plus que "read". Un nouvel utilisateur, jamais réutilisé
ailleurs, élimine ce risque à la racine — même convention que tests/test_loans_module.py."""
from app.core.security import hash_password
from app.modules.auth.models import User

SOC = "Iron Global Securite"


def _read_only_headers(client, db):
    if not db.query(User).filter(User.username == "finro01").first():
        db.add(User(
            username="finro01", full_name="Lecture Seule Finance", role="finances",
            access_level="H2", authorized_societies=[SOC], authorized_structures=[],
            authorized_modules=["finances"], authorized_actions=["read"],
            password_hash=hash_password("finro01pass"),
            validation_password_hash=hash_password("x"), is_active=True,
        ))
        db.commit()
    resp = client.post("/api/auth/login", json={"username": "finro01", "password": "finro01pass"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def test_read_only_account_can_read_finance_data(client, db):
    headers = _read_only_headers(client, db)
    assert client.get("/api/finance-core/obligations", headers=headers, params={"society": SOC}).status_code == 200
    assert client.get("/api/banking/accounts", headers=headers, params={"society": SOC}).status_code == 200
    assert client.get("/api/payroll/runs", headers=headers, params={"society": SOC}).status_code == 200
    assert client.get("/api/budget/lines", headers=headers, params={"society": SOC}).status_code == 200
    assert client.get("/api/fiscalite/calendar", headers=headers, params={"society": SOC}).status_code == 200
    assert client.get("/api/cockpit/summary", headers=headers, params={"society": SOC, "period": "2026-09"}).status_code == 200


def test_read_only_account_cannot_mutate_finance_data(client, auth_headers, db):
    """Chaque mutation doit être refusée CÔTÉ SERVEUR (403) — jamais seulement masquée côté
    interface — pour un compte dont authorized_actions ne contient QUE "read"."""
    headers = _read_only_headers(client, db)

    create_obl = client.post("/api/finance-core/obligations", headers=headers, json={
        "society": SOC, "direction": "receivable", "source_type": "manual", "source_id": "RO-1",
        "amount_total": "10.00", "idempotency_key": "ro:obl:1",
    })
    assert create_obl.status_code == 403

    # Créée par un compte admin pour ensuite prouver que le compte read-only ne peut pas la
    # régler, même en lecture seule sur une ressource qu'il peut par ailleurs consulter.
    obl = client.post("/api/finance-core/obligations", headers=auth_headers, json={
        "society": SOC, "direction": "receivable", "source_type": "manual", "source_id": "RO-2",
        "amount_total": "10.00", "idempotency_key": "ro:obl:2",
    }).json()
    settle = client.post(f"/api/finance-core/obligations/{obl['id']}/settle", headers=headers, json={
        "amount": "10.00", "idempotency_key": "ro:stl:1",
    })
    assert settle.status_code == 403

    create_account = client.post("/api/banking/accounts", headers=headers, json={
        "society": SOC, "bank_name": "BNA", "account_number": "RO-ACC-1",
    })
    assert create_account.status_code == 403

    create_budget = client.post("/api/budget/lines", headers=headers, json={
        "society": SOC, "period": "2026-09", "montant_budgete": "100.00",
    })
    assert create_budget.status_code == 403

    declare_fiscal = client.post("/api/fiscalite/declare", headers=headers, json={
        "society": SOC, "obligation_type": "g50_tva", "period": "2026-09", "montant": "10.00",
        "echeance": "2026-10-20", "idempotency_key": "ro:fisc:1",
    })
    assert declare_fiscal.status_code == 403

    # Confirme que rien n'a été créé malgré les refus (pas d'effet partiel).
    obligations_after = client.get("/api/finance-core/obligations", headers=auth_headers, params={"society": SOC}).json()["items"]
    assert not any(o["source_id"] == "RO-1" for o in obligations_after)
