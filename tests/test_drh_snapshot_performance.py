"""Snapshot DRH : les anciennes lignes SQL ignorées ne doivent pas être chargées.

Base SQLite privée par test ; vrais modèles, SQL bridge et règles de périmètre.
Les écritures de fixture n'utilisent ni les données ni les routes de production.
"""
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

import app.db.session as database_session
from app.db.base import Base
from app.modules.drh.models import Employee
from app.modules.irongs import service, sql_bridge
from app.modules.irongs.models import SgdiRecord
from app.modules.ops.models import Site


SOC = "Iron Global Securite"
OTHER_SOC = "Sword Corporation"


def snapshot_user(*, restricted=False):
    return SimpleNamespace(
        username="snapshot-performance-restricted" if restricted else "snapshot-performance-admin",
        role="drh" if restricted else "admin",
        global_society_access=not restricted,
        authorized_societies=[SOC] if restricted else [],
        authorized_modules=["rh", "ops", "secretariat"],
        authorized_structures=[],
    )


@pytest.fixture
def snapshot_store(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'snapshot.sqlite'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    # Le bridge full ouvre une session par collection : toutes utilisent cette même base privée.
    monkeypatch.setattr(database_session, "SessionLocal", sessions)
    service._snapshot_cache_invalidate()
    with sessions() as db:
        db.add_all([
            Employee(id=1, code="PERF01", first_name="ALICE", last_name="SOURCE SQL", society=SOC, status="actif"),
            Employee(id=2, code="PERF02", first_name="BOB", last_name="SOURCE SQL", society=OTHER_SOC, status="actif"),
            Site(id=1, name="Site SQL A", equipment_plan={"societe": SOC}),
            Site(id=2, name="Site SQL B", equipment_plan={"societe": OTHER_SOC}),
        ])

        def add(collection, item_id, data, position=0, kind="item"):
            db.add(SgdiRecord(collection=collection, item_id=item_id, data=data, position=position, kind=kind))

        # Une ancienne ligne pour CHAQUE collection ignorée, y compris celles côté serveur.
        for collection in sorted(sql_bridge.SQL_COLLECTIONS | service.SERVER_ONLY_COLLECTIONS):
            add(collection, "obsolete", {"id": "obsolete", "societe": SOC, "source": "legacy à ignorer"})
        for item_id, position in [("last", 20), ("tie-first", 1), ("tie-second", 1), ("first", 0)]:
            add("notifications", item_id, {"id": item_id}, position)
        add("settings", service.OBJECT_ITEM_ID, {"theme": "navy", "nested": {"enabled": True}}, kind="object")
        add("societesConfig", service.OBJECT_ITEM_ID, ["pas un objet"], kind="object")
        add("messages", service.OBJECT_ITEM_ID, {"ignored": True}, kind="object")
        add("messages", "item", {"id": "message-item"}, 1)
        for collection, count in [("activityLog", 210), ("notificationLog", 205)]:
            for index in range(count):
                add(collection, f"log-{index}", {"id": f"log-{index}", "index": index}, index)
        add("pointages", "month", {"id": "month", "societe": SOC, "periode": "2026-02", "valide": True,
                                    "valideBy": "historique", "valideAt": "2026-03-01T10:00:00",
                                    "validatedDays": {"01": {"by": "original", "at": "2026-02-01T18:00:00"}}})
        for item_id, data in [
            ("allowed", {"societe": SOC}), ("foreign", {"societe": OTHER_SOC}),
            ("by-agent", {"agentId": "1"}), ("by-foreign-agent", {"agentId": "2"}),
            ("by-site", {"siteId": "1"}), ("unscoped", {}),
        ]:
            add("conges", item_id, {"id": item_id, **data})
        add("secretariatNotes", "hidden-module", {"id": "hidden-module"})
        db.commit()
    try:
        yield sessions
    finally:
        service._snapshot_cache_invalidate()
        engine.dispose()


@pytest.mark.parametrize("include_sql", [False, True], ids=["light", "full"])
def test_snapshot_does_not_materialize_ignored_legacy_collections(snapshot_store, include_sql):
    loaded = []

    def observe(_session, instance):
        if isinstance(instance, SgdiRecord):
            loaded.append(instance.collection)

    event.listen(snapshot_store, "loaded_as_persistent", observe)
    try:
        with snapshot_store() as db:
            result = service.get_database(db, snapshot_user(), include_sql=include_sql)
    finally:
        event.remove(snapshot_store, "loaded_as_persistent", observe)
    assert loaded, "Le contrôle doit observer de vraies lignes legacy chargées"
    assert not set(loaded) & (sql_bridge.SQL_COLLECTIONS | service.SERVER_ONLY_COLLECTIONS)
    assert [row["id"] for row in result["notifications"]] == ["first", "tie-first", "tie-second", "last"]
    assert "portalAccounts" not in result
    assert sql_bridge.SQL_COLLECTIONS <= result.keys()
    if include_sql:
        assert {row["matricule"] for row in result["agents"]} == {"PERF01", "PERF02"}
    else:
        assert all(result[name] == [] for name in sql_bridge.SQL_COLLECTIONS)


@pytest.mark.parametrize("include_sql", [False, True], ids=["light", "full"])
def test_snapshot_keeps_legacy_objects_order_limits_and_read_only_backfill(snapshot_store, include_sql):
    with snapshot_store() as db:
        result = service.get_database(db, snapshot_user(), include_sql=include_sql)
        assert result["settings"] == {"theme": "navy", "nested": {"enabled": True}}
        assert result["societesConfig"] == {}
        assert result["messages"] == [{"id": "message-item"}]
        assert [row["id"] for row in result["notifications"]] == ["first", "tie-first", "tie-second", "last"]
        assert [row["index"] for row in result["activityLog"]] == list(range(10, 210))
        assert [row["index"] for row in result["notificationLog"]] == list(range(5, 205))
        sheet = result["pointages"][0]
        assert sheet["valide"] is True
        assert set(sheet["validatedDays"]) == {f"{day:02d}" for day in range(1, 29)}
        assert sheet["validatedDays"]["01"] == {"by": "original", "at": "2026-02-01T18:00:00"}
        assert sheet["validatedDays"]["28"] == {"by": "historique", "at": "2026-03-01T10:00:00"}
        original = db.scalar(select(SgdiRecord).where(SgdiRecord.collection == "pointages"))
        assert set(original.data["validatedDays"]) == {"01"}, "Le backfill reste une transformation de lecture"
        assert not db.dirty


@pytest.mark.parametrize("include_sql", [False, True], ids=["light", "full"])
def test_snapshot_keeps_society_and_reference_scope(snapshot_store, include_sql):
    user = snapshot_user(restricted=True)
    # Ne pas accorder le secrétariat : la collection étrangère au module doit rester absente.
    user.authorized_modules = ["rh", "ops"]
    with snapshot_store() as db:
        result = service.get_database(db, user, include_sql=include_sql)
    assert "secretariatNotes" not in result
    assert "settings" not in result
    assert {row["id"] for row in result["conges"]} == ({"allowed", "by-agent", "by-site"} if include_sql else {"allowed"})
    assert all(row["societe"] == SOC for row in result["agents"])
    assert all(row["societe"] == SOC for row in result["sites"])
    if include_sql:
        assert {row["matricule"] for row in result["agents"]} == {"PERF01"}
        assert {row["nom"] for row in result["sites"]} == {"Site SQL A"}


def test_full_snapshot_still_builds_every_sql_collection_after_light(snapshot_store):
    user = snapshot_user()
    with snapshot_store() as db:
        light = service.get_database(db, user, include_sql=False)
        full = service.get_database(db, user, include_sql=True)
        # Le snapshot full restitue exactement les données des convertisseurs SQL existants.
        for name in sql_bridge.SQL_COLLECTIONS:
            assert full[name] == sql_bridge.list_collection(db, name), name
            assert light[name] == [], name
        for name in full.keys() - sql_bridge.SQL_COLLECTIONS:
            assert full[name] == light[name], name
        assert {row["matricule"] for row in full["agents"]} == {"PERF01", "PERF02"}
        assert {row["nom"] for row in full["sites"]} == {"Site SQL A", "Site SQL B"}
