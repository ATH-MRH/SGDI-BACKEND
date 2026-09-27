"""Photos employés : noms imprévisibles (URL-capacités) et migration des anciens noms."""
import base64

from sqlalchemy import select

from app.core.config import settings
from app.core.photo_migration import migrate_public_photos
from app.core.photo_storage import PHOTOS_DIR, ensure_upload_dirs, save_base64_photo
from app.modules.drh.models import Employee
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)

JPEG = b"\xff\xd8\xff\xe0jpeg-content"


def test_new_photos_get_an_unguessable_name():
    url = save_base64_photo("data:image/jpeg;base64," + base64.b64encode(JPEG).decode(), {"matricule": "AGT777"})
    name = url.rsplit("/", 1)[1]
    assert name.startswith("AGT777-") and len(name) == len("AGT777-") + 32 + len(".jpg")
    assert url != "/uploads/photos/AGT777.jpg"
    assert save_base64_photo("data:image/jpeg;base64," + base64.b64encode(JPEG).decode(), {"matricule": "AGT777"}) != url


def test_legacy_guessable_names_are_refused_once_enabled(client, monkeypatch):
    ensure_upload_dirs()
    (PHOTOS_DIR / "AGT888.jpg").write_bytes(JPEG)
    capability = save_base64_photo("data:image/jpeg;base64," + base64.b64encode(JPEG).decode(), {"matricule": "AGT888"})
    assert client.get("/uploads/photos/AGT888.jpg").status_code == 200          # défaut : rien ne casse
    monkeypatch.setattr(settings, "photos_require_unguessable_names", True)
    assert client.get("/uploads/photos/AGT888.jpg").status_code == 404          # énumération par matricule impossible
    assert client.get(capability).status_code == 200
    assert client.get("/uploads/photos/..%2F..%2Fetc%2Fpasswd").status_code == 404


def test_migration_is_simulated_by_default_then_renames_and_updates_references(db):
    ensure_upload_dirs()
    (PHOTOS_DIR / "MIGR01.jpg").write_bytes(JPEG)
    emp = Employee(code="MIGR01", first_name="A", last_name="B", status="actif",
                   extra={"photo": "/uploads/photos/MIGR01.jpg", "_legacy": {"photoUrl": "/uploads/photos/MIGR01.jpg?v=2"}})
    db.add(emp); db.commit()
    plan = migrate_public_photos(db)
    assert plan["applied"] is False and plan["photos"] >= 1
    db.refresh(emp)
    assert emp.extra["photo"] == "/uploads/photos/MIGR01.jpg" and (PHOTOS_DIR / "MIGR01.jpg").is_file()
    migrate_public_photos(db, apply=True)
    db.expire_all()
    emp = db.execute(select(Employee).where(Employee.code == "MIGR01")).scalar_one()
    new = emp.extra["photo"].rsplit("/", 1)[1]
    assert new.startswith("MIGR01-") and (PHOTOS_DIR / new).is_file() and not (PHOTOS_DIR / "MIGR01.jpg").exists()
    assert emp.extra["_legacy"]["photoUrl"] == f"/uploads/photos/{new}?v=2"
    again = migrate_public_photos(db)                                            # idempotent
    assert not any(name.startswith("MIGR01") for name in again["renamed"])
