"""Portrait de présentation de la Fiche de position (visage agrandi, fond blanc).

La PHOTO SOURCE n'est jamais modifiée et reste celle de la biométrie et de l'« Aperçu » ; le
portrait est un dérivé d'affichage, mis en cache par empreinte, servi par une route protégée.
Les tests « moteur réel » utilisent les vrais modèles (OpenCV Zoo) et de vrais portraits ; ils
sont ignorés explicitement si OpenCV, les modèles ou les visages de test sont absents."""
import hashlib
import io
import os
import uuid
from datetime import date
from pathlib import Path

import pytest
from PIL import Image, ImageDraw
from sqlalchemy import func, select

from app.core.config import settings
from app.core.photo_storage import PHOTOS_DIR, ensure_upload_dirs
from app.core.security import hash_password
from app.modules.auth.models import AuditEvent, User
from app.modules.biometrics import crypto
from app.modules.biometrics.models import BiometricPhotoSync, BiometricTemplate
from app.modules.drh import portrait
from app.modules.drh.models import Employee
from app.modules.drh.portrait_models import EmployeePortrait
from app.modules.ops.models import Assignment, Site
from tests.biometric_fakes import _vector
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_biometrics import TEST_KEY

SOC = "Iron Global Securite"
OTHER = "Sword Corporation"
MODELS = os.environ.get("BIOMETRIC_MODELS_DIR", "")
FACES = os.environ.get("BIOMETRIC_TEST_FACES", "")


def _tag():
    return uuid.uuid4().hex[:6].upper()


def _jpeg(img):
    out = io.BytesIO(); img.save(out, "JPEG", quality=92); return out.getvalue()


def _employee(db, *, society=SOC, image=None):
    emp = Employee(code=f"PT{_tag()}", first_name="Portrait", last_name=f"Fiche{_tag()}", society=society, status="actif")
    db.add(emp); db.flush()
    site = Site(name=f"PT {_tag()}", active=1, equipment_plan={"societe": society}); db.add(site); db.flush()
    db.add(Assignment(employee_id=emp.id, site_id=site.id, group_code="A", start_date=date(2026, 1, 1), active=1))
    if image is not None:
        ensure_upload_dirs()
        path = PHOTOS_DIR / f"{emp.code}-{_tag()}.jpg"
        path.write_bytes(image)
        emp.extra = {"photo": f"/uploads/photos/{path.name}"}
    db.commit()
    return emp


def _photo_path(emp):
    return PHOTOS_DIR / emp.extra["photo"].rsplit("/", 1)[1]


@pytest.fixture
def drh(client, db):
    name = f"PTD{uuid.uuid4().int % 10**6:06d}"
    db.add(User(username=name, full_name=name, role="agent", access_level="H2", password_hash=hash_password("portrait-pass-1"), is_active=True,
                authorized_modules=["drh"], authorized_societies=[SOC]))
    db.commit()
    token = client.post("/api/auth/login", json={"username": name, "password": "portrait-pass-1"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _get(client, h, emp):
    return client.get(f"/api/drh/employees/{emp.id}/portrait", headers=h)


@pytest.fixture
def fake_render(monkeypatch):
    calls = []

    def render(source):
        calls.append(hashlib.sha256(source).hexdigest())
        return portrait.Portrait(_jpeg(Image.new("RGB", (300, 400), "white")), portrait.METHOD_SEGMENTED)

    monkeypatch.setattr(portrait, "render", render)
    return calls


# ── Photo source intacte, biométrie intacte ───────────────────────────────────────────────
def test_source_photo_and_biometrics_are_never_touched(client, db, drh, fake_render, monkeypatch):
    monkeypatch.setattr(settings, "biometric_template_key", TEST_KEY)
    emp = _employee(db, image=_jpeg(Image.new("RGB", (640, 640), (90, 120, 150))))
    path = _photo_path(emp)
    before_hash, before_mtime = hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns
    # Référence faciale « Prête » issue de cette photo, et état de synchronisation READY.
    db.add(BiometricTemplate(employee_id=emp.id, status="ACTIVE", embedding_encrypted=crypto.encrypt_vector(_vector("PT", 0.0, 0)),
                             engine="fake", config_version=1, source="EMPLOYEE_PHOTO", quality={"photo_sha256": before_hash}))
    db.add(BiometricPhotoSync(employee_id=emp.id, photo_fingerprint=before_hash, status="READY", source="DRH_REMOTE_TERMINAL",
                              requested_at=__import__("datetime").datetime.utcnow(), attempts=0, previous_reference_kept=False))
    db.commit()
    counts = lambda: (db.execute(select(func.count()).select_from(BiometricTemplate)).scalar_one(),  # noqa: E731
                      db.execute(select(func.count()).select_from(BiometricPhotoSync)).scalar_one(),
                      db.execute(select(func.count()).select_from(AuditEvent).where(AuditEvent.action.like("drh.facial_reference.%"))).scalar_one())
    uploads_before = sorted(p.name for p in PHOTOS_DIR.iterdir())
    snapshot = counts()
    assert client.get(f"/api/drh/employees/{emp.id}/facial-reference", headers=drh).json()["reference"]["label"] == "Prête"
    for _ in range(3):                                                    # consultations répétées de la fiche
        r = _get(client, drh, emp)
        assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert client.get(f"/api/drh/employees/{emp.id}/facial-reference", headers=drh).json()["reference"]["label"] == "Prête"
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before_hash and path.stat().st_mtime_ns == before_mtime
    assert counts() == snapshot, "aucun gabarit, aucune synchronisation, aucun audit de synchronisation"
    db.expire_all()
    assert [t.status for t in db.execute(select(BiometricTemplate).where(BiometricTemplate.employee_id == emp.id)).scalars()] == ["ACTIVE"]
    assert db.execute(select(BiometricPhotoSync.status).where(BiometricPhotoSync.employee_id == emp.id)).scalar_one() == "READY"
    assert sorted(p.name for p in PHOTOS_DIR.iterdir()) == uploads_before, "aucun fichier dérivé dans le dossier public"
    assert db.get(Employee, emp.id).extra == emp.extra


# ── Cache : calcul unique, invalidé quand la photo change ─────────────────────────────────
def test_portrait_is_computed_once_and_follows_the_source(client, db, drh, fake_render):
    emp = _employee(db, image=_jpeg(Image.new("RGB", (500, 700), (10, 20, 30))))
    for _ in range(4):
        r = _get(client, drh, emp)
        assert r.status_code == 200
        assert r.headers["cache-control"] == "private, no-store" and r.headers["x-portrait-method"] == "SEGMENTED"
    assert len(fake_render) == 1, "pas de traitement à chaque affichage"
    rows = db.execute(select(EmployeePortrait).where(EmployeePortrait.employee_id == emp.id)).scalars().all()
    assert len(rows) == 1 and rows[0].source_sha256 == fake_render[0] and (rows[0].width, rows[0].height) == (300, 400)
    # Nouvelle photo (nouveau fichier) : portrait recalculé, une seule ligne.
    ensure_upload_dirs()
    new = PHOTOS_DIR / f"{emp.code}-{_tag()}.jpg"
    new.write_bytes(_jpeg(Image.new("RGB", (640, 640), (200, 30, 30))))
    emp.extra = {"photo": f"/uploads/photos/{new.name}"}; db.commit()
    assert _get(client, drh, emp).status_code == 200
    assert len(fake_render) == 2 and fake_render[1] != fake_render[0]
    db.expire_all()
    rows = db.execute(select(EmployeePortrait).where(EmployeePortrait.employee_id == emp.id)).scalars().all()
    assert len(rows) == 1 and rows[0].source_sha256 == fake_render[1]


def test_no_photo_scope_and_permissions(client, db, drh, fake_render):
    assert _get(client, drh, _employee(db)).status_code == 404                    # pas de photo : 404, aucune erreur
    unreadable = _employee(db, image=b"pas une image")
    assert _get(client, drh, unreadable).status_code in (200, 404)
    foreign = _employee(db, society=OTHER, image=_jpeg(Image.new("RGB", (300, 300))))
    assert _get(client, drh, foreign).status_code in (403, 404)                  # autre société
    name = f"PTF{uuid.uuid4().int % 10**6:06d}"
    db.add(User(username=name, full_name=name, role="agent", access_level="H2", password_hash=hash_password("portrait-pass-1"), is_active=True,
                authorized_modules=["fac"], authorized_societies=[SOC]))
    db.commit()
    other = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": name, "password": "portrait-pass-1"}).json()["access_token"]}
    emp = _employee(db, image=_jpeg(Image.new("RGB", (300, 300))))
    assert _get(client, other, emp).status_code == 403                           # module DRH requis
    assert client.get(f"/api/drh/employees/{emp.id}/portrait").status_code == 401   # jamais d'URL publique


def test_render_without_opencv_falls_back_to_a_centred_crop(monkeypatch):
    """Sans OpenCV (ou modèles absents) : jamais d'erreur ni de faux détourage."""
    monkeypatch.setattr(portrait, "_models", {"_loaded": True})
    result = portrait.render(_jpeg(Image.new("RGB", (900, 600), (40, 80, 120))))
    assert result.method == portrait.METHOD_CENTERED
    with Image.open(io.BytesIO(result.image)) as img:
        assert img.size == (300, 400)


def test_segmentation_model_is_pinned_like_the_biometric_models():
    from scripts.fetch_biometric_models import MODELS, PORTRAIT_MODELS

    name, expected = portrait.SEGMENTATION_MODEL
    assert PORTRAIT_MODELS[name][1] == expected and "opencv_zoo/47534e2" in PORTRAIT_MODELS[name][0]
    assert name not in MODELS, "hors de la liste des modèles biométriques"
    from app.modules.biometrics.engine import MODEL_FILES
    assert name not in {n for n, _ in MODEL_FILES.values()}, "jamais chargé par le moteur facial"


# ── Moteur réel : cadrage d'identité et fond blanc sur de vraies photos ───────────────────
def _real_ready():
    try:
        import cv2  # noqa: F401
    except ImportError:
        return False
    return bool(MODELS and FACES and all((Path(MODELS) / n).is_file() for n in ("face_detection_yunet_2023mar.onnx", portrait.SEGMENTATION_MODEL[0]))
                and (Path(FACES) / "obama1.jpg").is_file())


real = pytest.mark.skipif(not _real_ready(), reason="OpenCV, BIOMETRIC_MODELS_DIR (avec PP-HumanSeg) ou BIOMETRIC_TEST_FACES absents")


@pytest.fixture
def real_models(monkeypatch):
    monkeypatch.setattr(settings, "biometric_models_dir", MODELS)
    portrait.reset_models()
    yield
    portrait.reset_models()


def _face(name):
    return Image.open(Path(FACES) / name).convert("RGB")


def _fixtures():
    o1, o2, b1 = _face("obama1.jpg"), _face("obama2.jpg"), _face("biden1.jpg")

    def pad(img, size, colour, at=(0.5, 0.5), scale=1.0):
        img = img.copy(); img.thumbnail((round(size[0] * scale), round(size[1] * scale)))
        canvas = Image.new("RGB", size, colour)
        canvas.paste(img, (round((size[0] - img.width) * at[0]), round((size[1] - img.height) * at[1])))
        return canvas

    def glasses(img):
        img = img.copy(); d = ImageDraw.Draw(img); w, h = img.size
        for cx in (0.43, 0.57):                                           # monture sombre sur les yeux (portrait obama2)
            d.ellipse((w * (cx - 0.075), h * 0.335, w * (cx + 0.075), h * 0.395), outline=(15, 15, 15), width=max(4, w // 120))
        d.line((w * 0.475, h * 0.36, w * 0.525, h * 0.36), fill=(15, 15, 15), width=max(4, w // 120))
        return img

    def square(img):                                                          # carré type tablette (cercle de capture)
        w, h = img.size; s = min(w, h)
        return img.crop(((w - s) // 2, 0, (w - s) // 2 + s, s)).resize((640, 640))

    return {
        "décor complexe (bureau, rideaux, drapeaux)": o1,
        "fond gris uni, cheveux noirs, costume sombre": o2,
        "cheveux clairs, fond gris et drapeau": b1,
        "photo carrée type tablette": square(o2),
        "photo paysage, personne décentrée": pad(b1, (1600, 900), (120, 110, 100), at=(0.15, 0.4), scale=0.9),
        "mur blanc autour de la photo": pad(o2, (900, 1200), (250, 250, 250), scale=0.7),
        "mur sombre autour de la photo": pad(o2, (900, 1200), (20, 20, 25), scale=0.7),
        "fond proche de la couleur de la peau": pad(o2, (900, 1200), (160, 110, 80), scale=0.7),
        "lunettes": glasses(o2),
        "photo verticale haute résolution": o1.resize((o1.width // 2, o1.height // 2)),
    }


@real
@pytest.mark.parametrize("label", [
    "décor complexe (bureau, rideaux, drapeaux)", "fond gris uni, cheveux noirs, costume sombre", "cheveux clairs, fond gris et drapeau",
    "photo carrée type tablette", "photo paysage, personne décentrée", "mur blanc autour de la photo", "mur sombre autour de la photo",
    "fond proche de la couleur de la peau", "lunettes", "photo verticale haute résolution"])
def test_identity_portrait_on_real_photos(real_models, label):
    import cv2
    import numpy as np

    source = _jpeg(_fixtures()[label])
    result = portrait.render(source)
    assert result.method == portrait.METHOD_SEGMENTED, label
    img = cv2.imdecode(np.frombuffer(result.image, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[:2] == (400, 300), label
    # Fond réellement blanc : coins hauts et bords latéraux à mi-hauteur (hors de la tête).
    for region in (img[:40, :40], img[:40, -40:], img[150:230, :12], img[150:230, -12:]):
        assert region.mean() >= 240, f"{label} : fond non blanc ({region.mean():.0f})"
    # Visage agrandi, centré : détecté sur le portrait lui-même.
    models = portrait._load_models()
    models["detector"].setInputSize((300, 400))
    _, faces = models["detector"].detect(img)
    assert faces is not None and len(faces) == 1, label
    x, y, w, h = faces[0][:4]
    assert 0.40 <= (x + w / 2) / 300 <= 0.60, f"{label} : visage décentré ({(x + w / 2) / 300:.2f})"
    assert 0.38 <= h / 400 <= 0.52, f"{label} : visage {(h / 400):.2f} de la hauteur"
    assert y > 400 * 0.08, f"{label} : tête coupée en haut"
    # La personne n'est pas effacée : visage et épaules gardent leurs couleurs.
    assert img[int(y + h * 0.3):int(y + h * 0.7), int(x + w * 0.3):int(x + w * 0.7)].mean() < 225, label
    assert img[-30:, 120:180].mean() < 200, f"{label} : épaules absentes"


@real
def test_real_render_never_modifies_the_source_bytes(real_models):
    source = _jpeg(_face("obama2.jpg"))
    digest = hashlib.sha256(source).hexdigest()
    portrait.render(source)
    assert hashlib.sha256(source).hexdigest() == digest


@real
def test_no_face_gives_a_centred_portrait_without_fake_segmentation(real_models):
    result = portrait.render(_jpeg(Image.new("RGB", (800, 600), (30, 140, 60))))
    assert result.method == portrait.METHOD_CENTERED


def test_migration_is_additive_and_reversible(tmp_path):
    import sqlite3
    import subprocess
    import sys

    repo = Path(__file__).resolve().parents[1]
    database = tmp_path / "portrait.sqlite"
    env = {**os.environ, "APP_ENV": "test", "DATABASE_URL": f"sqlite:///{database}", "JWT_SECRET": "portrait-migration-test-secret"}
    alembic = lambda *a: subprocess.run([sys.executable, "-m", "alembic", *a], cwd=repo, env=env, capture_output=True, text=True, check=False)  # noqa: E731
    assert alembic("upgrade", "20261003_0001").returncode == 0
    con = sqlite3.connect(database)
    tables = lambda: {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}  # noqa: E731
    existing = tables()
    up = alembic("upgrade", "head")
    assert up.returncode == 0, up.stderr
    assert tables() - existing == {"employee_portraits"}
    assert con.execute("SELECT COUNT(*) FROM employee_portraits").fetchone()[0] == 0
    con.execute("INSERT INTO employees (id, code, first_name, last_name, society, status, children_count, salary_net, locked, created_at) "
                "VALUES (4, 'PTM04', 'A', 'B', 'SOC', 'actif', 0, 0, 1, '2026-10-01')")
    con.commit()
    assert alembic("downgrade", "20261003_0001").returncode == 0
    assert tables() == existing
    assert con.execute("SELECT COUNT(*) FROM employees WHERE code = 'PTM04'").fetchone()[0] == 1          # aucune donnée touchée
    assert alembic("upgrade", "head").returncode == 0
    con.close()
