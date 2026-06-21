from datetime import date

from app.modules.commercial.models import Client
from app.modules.irongs import sql_bridge


def test_client_snapshot_keeps_full_sql_data(db):
    client = Client(
        name="DHL FORWARDING ALGERIE",
        society="IRON GLOBAL SECURITE",
        status="actif",
        contact_name="Contact principal",
        phone="0770000000",
        address="Alger",
        services="PRESTATION DE GARDIENNAGE",
        contract_start=date(2026, 1, 1),
        contract_duration="12 mois",
        contract_end=date(2026, 12, 31),
        data={
            "id": "cl_dhl",
            "wilaya": "ALGER",
            "tech_nbrSite": 3,
            "tech_sites": [{"totalEffectif": 29}, {"totalEffectif": 10}, {"totalEffectif": 8}],
        },
    )
    db.add(client)
    db.flush()

    item = sql_bridge.client_to_item(client)

    assert item["id"] == "cl_dhl"
    assert item["backendId"] == client.id
    assert item["contact"] == "Contact principal"
    assert item["prestationsServices"] == "PRESTATION DE GARDIENNAGE"
    assert item["wilaya"] == "ALGER"
    assert item["tech_nbrSite"] == 3
    assert len(item["tech_sites"]) == 3


def test_sparse_client_snapshot_update_does_not_erase_sql_fields(db):
    client = Client(
        name="Client complet",
        contact_name="Contact conservé",
        phone="0550000000",
        services="Gardiennage",
        status="actif",
        data={"id": "cl_complet", "wilaya": "ALGER"},
    )
    db.add(client)
    db.flush()

    sql_bridge.upsert_client(db, {"backendId": client.id, "nom": "Client complet"})

    assert client.contact_name == "Contact conservé"
    assert client.phone == "0550000000"
    assert client.services == "Gardiennage"
    assert sql_bridge.client_to_item(client)["wilaya"] == "ALGER"
