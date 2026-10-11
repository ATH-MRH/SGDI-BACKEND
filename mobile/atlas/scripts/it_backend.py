"""Backend ATLAS jetable pour les tests d'intégration mobile.

Démarre le vrai backend du dépôt sur une base SQLite temporaire (ou sur la base
PostgreSQL jetable désignée par IT_DATABASE_URL), avec des
comptes de test dont le mot de passe est fourni par l'appelant (IT_PASSWORD).
Ne touche à aucune base existante. Lancé par scripts/integration.mjs.

Usage : python it_backend.py <racine du dépôt> <port>
"""
import json
import os
import sys
import tempfile

repo_root, port = sys.argv[1], int(sys.argv[2])
password = os.environ["IT_PASSWORD"]
workdir = tempfile.mkdtemp(prefix="atlas-it-")
os.environ.update(
    # IT_DATABASE_URL : base PostgreSQL JETABLE déjà migrée (alembic upgrade head), pour
    # rejouer les mêmes tests sur le moteur de production. Jamais une base existante.
    DATABASE_URL=os.environ.get("IT_DATABASE_URL") or f"sqlite:///{workdir}/it.db",
    JWT_SECRET=os.urandom(32).hex(),
    ADMIN_SYSTEM_USERNAME="itsystem",
    ADMIN_SYSTEM_PASSWORD=os.urandom(16).hex(),
    ADMIN_INITIAL_USERNAME="itsystem",
    ADMIN_INITIAL_PASSWORD=os.urandom(16).hex(),
    APP_ENV="test",
    LOG_LEVEL="ERROR",
    SGDI_UPLOADS_DIR=workdir,
    LOGIN_MAX_ATTEMPTS="1000000",
)
os.chdir(workdir)
sys.path.insert(0, repo_root)

import uvicorn  # noqa: E402

import app.db.session as db_session  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.auth.models import User  # noqa: E402

Base.metadata.create_all(db_session.engine)
session = db_session.SessionLocal()


def add_user(username: str, **overrides) -> None:
    values = dict(
        username=username,
        email=f"{username.lower()}@it.test",
        full_name=username.title(),
        role="ops",
        access_level="H3",
        authorized_societies=["Societe A"],
        authorized_structures=[],
        authorized_modules=["ops"],
        password_hash=hash_password(password),
        is_active=True,
    )
    values.update(overrides)
    session.add(User(**values))


add_user("ITBOSS", role="admin", access_level="H5", authorized_societies=[], authorized_modules=None, global_society_access=True)
add_user("ITOPS")
add_user("ITNOSCOPE", authorized_societies=[])
add_user("ITNOMODULE", authorized_modules=[])
add_user("ITINACTIVE", is_active=False)

from app.modules.ops.models import Site  # noqa: E402


def add_site(name: str, society: str) -> Site:
    site = Site(name=name, indicatif=name[-2:], active=1, equipment_plan={"societe": society})
    session.add(site)
    session.flush()
    return site


site_a1 = add_site("IT Site A1", "Societe A")
site_a2 = add_site("IT Site A2", "Societe A")
site_b1 = add_site("IT Site B1", "Societe B")
add_user("ITONESITE", authorized_sites=[site_a1.id])
session.commit()

# Deux employés avec un compte du portail employé, pour l'accès mobile employé.
from datetime import date  # noqa: E402

from app.modules.drh.models import Employee, Leave  # noqa: E402
from app.modules.irongs import service as collections  # noqa: E402
from app.modules.ops.models import Assignment  # noqa: E402

# Photos de fiche, pour le portrait servi au mobile : ITEMP1 a un fichier réel, ITEMP2 référence
# un fichier absent du disque (cas d'une photo perdue côté serveur), ITEMP3 n'a aucune photo.
from app.core.photo_storage import PHOTOS_DIR, PUBLIC_PHOTO_PREFIX  # noqa: E402

portrait_supported = True
try:
    import io

    from PIL import Image

    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    Image.new("RGB", (600, 800), (176, 148, 122)).save(buffer, "JPEG")
    (PHOTOS_DIR / "itemp1.jpg").write_bytes(buffer.getvalue())
except ImportError:
    portrait_supported = False

photos = {"ITEMP1": {"photo": f"{PUBLIC_PHOTO_PREFIX}/itemp1.jpg"}, "ITEMP2": {"photo": f"{PUBLIC_PHOTO_PREFIX}/absent.jpg"}}
employee_ids: dict[str, int] = {}
plain = Employee(code="ITEMP3", first_name="Prenom", last_name="ITEMP3", society="Societe A", status="actif", position="Agent", extra={})
session.add(plain)
session.flush()
employee_ids["ITEMP3"] = plain.id

for code, reason in (("ITEMP1", "Motif un"), ("ITEMP2", "Motif deux")):
    employee = Employee(code=code, first_name="Prenom", last_name=code, society="Societe A", status="actif", position="Agent", extra=photos[code])
    session.add(employee)
    session.flush()
    employee_ids[code] = employee.id
    session.add(Assignment(employee_id=employee.id, site_id=site_a1.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    session.add(Leave(employee_id=employee.id, leave_type="conge", start_date=date(2026, 11, 1), end_date=date(2026, 11, 3), reason=reason, status="instance"))
    session.commit()
    collections.create_item(session, "portalAccounts", {
        "id": f"acc-{code}", "username": code.lower(), "matricule": code, "active": True, "passwordHash": hash_password(password),
    })
session.commit()
ops_id = session.query(User).filter(User.username == "ITOPS").one().id
other_site_id, foreign_site_id = site_a2.id, site_b1.id
session.close()

# Jetons des autres familles, tels que leurs portails les émettent, avec le MÊME
# identifiant numérique qu'un compte staff actif : ils doivent tous être refusés.
subject = str(ops_id)
print("ATLAS_IT " + json.dumps({
    "expired_token": create_access_token(subject, {"token_use": "staff"}, ttl_seconds=-5),
    "client_portal": create_access_token(subject, {"client_portal": True, "client_id": 1}),
    "employee_portal": create_access_token("AGT001", {"portal": True}),
    "attendance_qr": create_access_token(subject, {"attendance_qr": True, "employee_id": 1, "nonce": "n"}, ttl_seconds=120),
    "sse_ticket": create_access_token(subject, {"sse_ticket": True}, ttl_minutes=1),
    "other_site_id": other_site_id,
    "photo_employee_id": employee_ids["ITEMP1"] if portrait_supported else None,
    "lost_photo_employee_id": employee_ids["ITEMP2"],
    "no_photo_employee_id": employee_ids["ITEMP3"],
    "foreign_site_id": foreign_site_id,
}), flush=True)
uvicorn.run(app, host="127.0.0.1", port=port, log_level="error")
