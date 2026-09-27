"""Benchmark Attendance V1 — chiffres réels, base PostgreSQL JETABLE.

Usage (jamais sur une base réelle) :
    BENCH_DATABASE_URL=postgresql+psycopg2://user@localhost/atlas_bench \\
    BIOMETRIC_MODELS_DIR=/chemin/modeles BIOMETRIC_TEST_FACES=/chemin/photos \\
    python scripts/bench_attendance.py

Mesure (médiane de N appels, nombre de requêtes SQL par appel) : centre de contrôle
(/attendance/board, pages et filtres), Employé 360 (/attendance/employees/{id}), écriture
Attendance Core (scan manuel), flux temps réel pointeur, reconnaissance faciale 1:N (moteur réel
si les modèles sont fournis).
"""
import os
import statistics
import sys
import time
from datetime import date, datetime, timedelta

URL = os.environ.get("BENCH_DATABASE_URL")
if not URL or "bench" not in URL:
    sys.exit("BENCH_DATABASE_URL doit pointer vers une base JETABLE dont le nom contient « bench »")
os.environ.update({"DATABASE_URL": URL, "JWT_SECRET": "bench-secret-0000000000000000000000", "APP_ENV": "test",
                   "LOG_LEVEL": "ERROR", "LOGIN_MAX_ATTEMPTS": "1000000"})
MODELS = os.environ.get("BIOMETRIC_MODELS_DIR", "")
FACES = os.environ.get("BIOMETRIC_TEST_FACES", "")
if MODELS:
    from cryptography.fernet import Fernet
    os.environ.update({"BIOMETRIC_ENABLED": "true", "BIOMETRIC_TEMPLATE_KEY": Fernet.generate_key().decode(),
                       "BIOMETRIC_MODELS_DIR": MODELS})
import tempfile  # noqa: E402
os.environ["SGDI_UPLOADS_DIR"] = tempfile.mkdtemp(prefix="atlas_bench_uploads_")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import event, select  # noqa: E402

import app.main  # noqa: E402,F401
from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.modules.attendance.models import AttendanceEvent  # noqa: E402
from app.modules.auth.models import User  # noqa: E402
from app.modules.drh.models import Employee  # noqa: E402
from app.modules.ops.models import Assignment, DailyPresence, Site  # noqa: E402

N_SITES, N_EMP, HISTORY_DAYS, HISTORY_EMP = 60, 3000, 30, 300
SOC = "Iron Global Securite"
QUERIES = {"n": 0}


@event.listens_for(engine, "before_cursor_execute")
def _count(*args, **kwargs):
    QUERIES["n"] += 1


def seed():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    s = SessionLocal()
    sites = [Site(name=f"Site {i:02d}", active=1, equipment_plan={"societe": SOC}, rotation_system="24/48") for i in range(N_SITES)]
    s.add_all(sites); s.flush()
    emps = [Employee(code=f"B{i:05d}", first_name=f"P{i}", last_name=f"N{i}", society=SOC, status="actif", position="AGENT") for i in range(N_EMP)]
    s.add_all(emps); s.flush()
    start = date.today() - timedelta(days=400)
    s.add_all([Assignment(employee_id=e.id, site_id=sites[i % N_SITES].id, group_code="ABCD"[i % 4], start_date=start, active=1) for i, e in enumerate(emps)])
    today = date.today()
    now = datetime.utcnow()
    presences, events = [], []
    for i, e in enumerate(emps):
        site = sites[i % N_SITES]
        days = range(HISTORY_DAYS) if i < HISTORY_EMP else ([0] if i % 3 else [])
        for d in days:
            day = today - timedelta(days=d)
            presences.append(DailyPresence(presence_date=day, employee_id=e.id, site_id=site.id, status="present", arrival_time="P"))
            events.append(AttendanceEvent(employee_id=e.id, society=SOC, site_id=site.id, presence_date=day,
                                          occurred_at=now - timedelta(days=d, hours=8), event_type="ARRIVAL", source="QR",
                                          idempotency_key=f"seed-{e.id}-{d}", cycle=1, data={"siteName": site.name}))
    s.add_all(presences); s.add_all(events)
    s.add(User(username="benchops", full_name="bench", role="ops", access_level="H3", authorized_societies=[SOC],
               authorized_sites=[x.id for x in sites], authorized_structures=[], authorized_modules=["pointage", "pointeur", "ops", "drh"],
               authorized_actions=[], password_hash=hash_password("benchpass1"), is_active=True))
    s.commit()
    site_ids = [x.id for x in sites]
    emp_hist, emp_new = emps[0].id, emps[-1].id
    s.close()
    return site_ids, emp_hist, emp_new, len(presences), len(events)


def measure(label, fn, repeat=7):
    timings, queries, size = [], [], 0
    for _ in range(repeat):
        QUERIES["n"] = 0
        t0 = time.perf_counter()
        resp = fn()
        timings.append((time.perf_counter() - t0) * 1000)
        queries.append(QUERIES["n"])
        assert resp.status_code in (200, 201), (label, resp.status_code, resp.text[:300])
        size = len(resp.content)
    print(f"| {label} | {statistics.median(timings):.0f} ms | {max(timings):.0f} ms | {statistics.median(queries):.0f} | {size / 1024:.1f} Ko |")


def main():
    site_ids, emp_hist, emp_new, n_presence, n_events = seed()
    print(f"Jeu de données : {N_SITES} sites, {N_EMP} employés affectés, {n_presence} journées, {n_events} événements (PostgreSQL)\n")
    client = TestClient(app.main.app)
    token = client.post("/api/auth/login", json={"username": "benchops", "password": "benchpass1"}).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    print("| Appel | Médiane | Max | Requêtes SQL | Réponse |\n|---|---|---|---|---|")
    measure("Centre de contrôle — board, tous sites (3 000 employés), page 1", lambda: client.get("/api/attendance/board?page_size=25", headers=h))
    measure("Centre de contrôle — board, page 60", lambda: client.get("/api/attendance/board?page_size=25&page=60", headers=h))
    measure("Centre de contrôle — board, 1 site", lambda: client.get(f"/api/attendance/board?site_id={site_ids[0]}", headers=h))
    measure("Centre de contrôle — board, filtre statut + recherche", lambda: client.get("/api/attendance/board?status=non_pointe&q=N12", headers=h))
    measure("Anomalies — page 1", lambda: client.get("/api/attendance/anomalies?page_size=25", headers=h))
    measure("Employé 360 — Pointages (30 j d'historique)", lambda: client.get(f"/api/attendance/employees/{emp_hist}?days=90", headers=h))
    measure("Pointeur — flux temps réel (48 h)", lambda: client.get("/api/portal/attendance-feed?limit=200", headers=h))
    counter = iter(range(10_000))
    measure("Attendance Core — scan manuel (écriture)", lambda: client.post("/api/portal/attendance-manual/scan", headers=h,
            json={"employee_id": emp_new - next(counter) % 50}), repeat=7)
    if MODELS and FACES:
        bench_recognition(client, h, site_ids)


def bench_recognition(client, h, site_ids):
    from unittest import mock

    from app.modules.biometrics import crypto
    from app.modules.biometrics.cameras import DahuaCameraAdapter
    from app.modules.biometrics.engine import get_engine
    from app.modules.biometrics.models import BiometricConsent, BiometricTemplate, Camera
    from app.modules.biometrics.service import NOTICE_VERSION
    from app.core.photo_storage import PHOTOS_DIR, ensure_upload_dirs

    engine_obj = get_engine()
    photo = open(os.path.join(FACES, "obama1.jpg"), "rb").read()
    t0 = time.perf_counter()
    for _ in range(3):
        analysis = engine_obj.analyze(photo)
    print(f"\nMoteur réel — analyse d'une image 1280 px (détection + gabarit + liveness) : {(time.perf_counter() - t0) / 3 * 1000:.0f} ms")
    ensure_upload_dirs()
    s = SessionLocal()
    site = s.get(Site, site_ids[0])
    emp_ids = [a.employee_id for a in s.execute(select(Assignment).where(Assignment.site_id == site.id)).scalars()]
    # 50 employés du site enrôlés depuis la photo de leur fiche (gabarits réels légèrement perturbés).
    import random
    base = analysis.faces[0].embedding
    for i, emp_id in enumerate(emp_ids):
        emp = s.get(Employee, emp_id)
        name = f"{emp.code}.jpg"
        (PHOTOS_DIR / name).write_bytes(photo)
        emp.extra = {"photo": f"/uploads/photos/{name}"}
        s.add(BiometricConsent(employee_id=emp_id, status="contract_confirmed", source="EMPLOYMENT_CONTRACT", proof_reference="bench", notice_version=NOTICE_VERSION))
        vec = base if i == 0 else [v + random.uniform(-0.6, 0.6) for v in base]
        import hashlib
        s.add(BiometricTemplate(employee_id=emp_id, status="ACTIVE", embedding_encrypted=crypto.encrypt_vector(vec), engine="bench", config_version=1,
                                source="EMPLOYEE_PHOTO", source_ref=name, quality={"photo_sha256": hashlib.sha256(photo).hexdigest()}))
    cam = Camera(name="CAM-BENCH", manufacturer="DAHUA", model="bench", adapter="DAHUA", society=SOC, site_id=site.id, host="127.0.0.1", usage="ATTENDANCE", role="ENTRY", active=True)
    s.add(cam); s.commit()
    cam_id, n = cam.id, len(emp_ids)
    s.close()
    frames = []
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(photo)).convert("RGB")
    for i in range(3):
        b = io.BytesIO(); img.crop((i * 3, i * 3, img.width - 12 + i * 3, img.height - 12 + i * 3)).save(b, "JPEG", quality=90); frames.append(b.getvalue())
    with mock.patch.object(DahuaCameraAdapter, "burst", lambda self, count=3, interval=0.25: list(frames)):
        print("\n| Appel | Médiane | Max | Requêtes SQL | Réponse |\n|---|---|---|---|---|")
        measure(f"Reconnaissance faciale 1:N ({n} gabarits du site, rafale de 3 images, moteur réel)",
                lambda: client.post(f"/api/biometrics/cameras/{cam_id}/recognize", headers=h, json={}), repeat=5)


if __name__ == "__main__":
    main()
