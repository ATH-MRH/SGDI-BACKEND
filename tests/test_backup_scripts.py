"""Sauvegarde chiffrée, restauration d'essai et surveillance (scripts/backup*.sh).

Données, clés et phrases secrètes entièrement fictives. Exécuté uniquement si
TEST_POSTGRES_ADMIN_URL désigne un serveur PostgreSQL JETABLE (même convention que
tests/test_feature_permissions_migration.py) et si gpg et les outils PostgreSQL sont présents.
Chaque base créée ici porte un nom unique et est supprimée par le test qui l'a créée."""
import os
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

REPO = Path(__file__).resolve().parents[1]
BACKUP, RESTORE, CHECK = (str(REPO / "scripts" / name) for name in ("backup.sh", "backup_restore_test.sh", "backup_check.sh"))
MARKER = "DONNEE-FICTIVE-EN-CLAIR-7f3a"
TOOLS = ("gpg", "pg_dump", "pg_restore", "psql", "createdb", "dropdb")

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_POSTGRES_ADMIN_URL") or any(shutil.which(tool) is None for tool in TOOLS),
    reason="TEST_POSTGRES_ADMIN_URL non défini, ou gpg / outils PostgreSQL absents")


def _databases(admin):
    with admin.connect() as connection:
        return set(connection.execute(text("SELECT datname FROM pg_database")).scalars())


@pytest.fixture
def pg():
    """Base source fictive, avec contraintes, index et révision Alembic."""
    admin_url = make_url(os.environ["TEST_POSTGRES_ADMIN_URL"])
    name = f"atlas_backup_src_{uuid.uuid4().hex[:12]}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    source = create_engine(admin_url.set(database=name))
    with source.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY)"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('20261013_0002')"))
        connection.execute(text("CREATE TABLE employees (id serial PRIMARY KEY, code varchar(20) UNIQUE NOT NULL, name text)"))
        connection.execute(text("CREATE TABLE attendance_events (id serial PRIMARY KEY, employee_id int NOT NULL "
                                "REFERENCES employees(id), source varchar(10) CHECK (source IN ('MANUAL','FACIAL')), note text)"))
        connection.execute(text("CREATE INDEX ix_events_employee ON attendance_events (employee_id)"))
        connection.execute(text("CREATE TABLE empty_table (id int PRIMARY KEY)"))
        connection.execute(text("INSERT INTO employees (code, name) SELECT 'F' || g, :m || g FROM generate_series(1, 40) g"), {"m": MARKER})
        connection.execute(text("INSERT INTO attendance_events (employee_id, source, note) "
                                "SELECT 1 + g % 40, 'MANUAL', :m FROM generate_series(1, 250) g"), {"m": MARKER})
    env = {"PGHOST": admin_url.query.get("host") or admin_url.host or "", "PGPORT": str(admin_url.port or 5432),
           "PGUSER": admin_url.username or "", "PGPASSWORD": admin_url.password or ""}
    before = _databases(admin)
    try:
        yield {"name": name, "env": {k: v for k, v in env.items() if v}, "admin": admin, "source": source}
        assert _databases(admin) == before, "une base d'essai n'a pas été supprimée"
    finally:
        source.dispose()
        with admin.connect() as connection:
            for leftover in _databases(admin) - before:
                if leftover.startswith("atlas_restore_test_"):
                    connection.execute(text(f'DROP DATABASE "{leftover}"'))
            connection.execute(text(f'DROP DATABASE "{name}"'))
        admin.dispose()


@pytest.fixture(scope="module")
def gnupg():
    """Trousseau jetable et paire de clés fictive (chemin court : limite des sockets GnuPG)."""
    home = tempfile.mkdtemp(prefix="atlas-gpg-")
    os.chmod(home, 0o700)
    env = {**os.environ, "GNUPGHOME": home}
    subprocess.run(["gpg", "--batch", "--quiet", "--passphrase", "", "--quick-generate-key",
                    "ATLAS sauvegarde fictive <backup@example.invalid>", "default", "default", "never"], env=env, check=True,
                   capture_output=True)
    listing = subprocess.run(["gpg", "--batch", "--with-colons", "--list-keys"], env=env, check=True, capture_output=True, text=True)
    fingerprint = next(line.split(":")[9] for line in listing.stdout.splitlines() if line.startswith("fpr"))
    empty = tempfile.mkdtemp(prefix="atlas-gpg-empty-")
    os.chmod(empty, 0o700)
    yield {"home": home, "fingerprint": fingerprint, "empty_home": empty}
    for directory in (home, empty):
        subprocess.run(["gpgconf", "--kill", "all"], env={**os.environ, "GNUPGHOME": directory}, capture_output=True)
        shutil.rmtree(directory, ignore_errors=True)


@pytest.fixture
def files(tmp_path):
    photos = tmp_path / "photos"
    (photos / "docs").mkdir(parents=True)
    for i in range(6):
        (photos / f"agent-{i}.jpg").write_bytes(f"{MARKER}-photo-{i}".encode() * 50)
    (photos / "docs" / "contrat.pdf").write_bytes(b"%PDF-fictif " + MARKER.encode())
    (photos / "envoi.tmp").write_bytes(b"temporaire")
    return photos


@pytest.fixture
def env(pg, gnupg, files, tmp_path):
    return {**os.environ, **pg["env"], "GNUPGHOME": gnupg["home"], "BACKUP_DIR": str(tmp_path / "backups"),
            "BACKUP_PG_DB": pg["name"], "BACKUP_FILES_DIRS": f"photos={files}", "BACKUP_GPG_RECIPIENT": gnupg["fingerprint"],
            "BACKUP_MIN_FREE_MB": "1", "RESTORE_WORK_DIR": str(tmp_path), "COPYFILE_DISABLE": "1"}


def _run(script, env, *args):
    return subprocess.run(["bash", script, *args], env=env, capture_output=True, text=True, timeout=180)


def _archives(env):
    return sorted(Path(env["BACKUP_DIR"]).glob("atlas-backup_*.tar.gpg"))


def _status(env, name="last_run.status"):
    lines = (Path(env["BACKUP_DIR"]) / "status" / name).read_text().splitlines()
    return dict(line.split("=", 1) for line in lines)


def _mode(path):
    return stat.S_IMODE(os.stat(path).st_mode)


def _no_cleartext_left(env):
    leftovers = [p.name for p in Path(env["BACKUP_DIR"]).iterdir() if p.name.startswith(".work") or p.suffix in (".partial", ".dump")]
    assert leftovers == [] and (Path(env["BACKUP_DIR"]) / ".lock").is_file()


# ── Cycle complet ────────────────────────────────────────────────────────────────────────
def test_backup_then_restore_test_round_trip(env, pg, tmp_path):
    result = _run(BACKUP, env)
    assert result.returncode == 0, result.stderr
    (archive,) = _archives(env)

    assert _mode(env["BACKUP_DIR"]) == 0o700 and _mode(archive) == 0o600
    _no_cleartext_left(env)
    assert MARKER.encode() not in archive.read_bytes()            # rien de lisible sans la clé
    status = _status(env)
    assert status["result"] == "OK" and status["file"] == archive.name and status["offsite"] == "non configurée"
    assert Path(f"{archive}.sha256").read_text().split()[0] == status["sha256"]
    assert "aucune copie hors serveur" in result.stderr

    report = tmp_path / "rapport.txt"
    restored = _run(RESTORE, {**env, "RESTORE_REPORT": str(report)}, str(archive))
    assert restored.returncode == 0, restored.stdout + restored.stderr
    text_report = report.read_text()
    assert "RESTAURATION D'ESSAI RÉUSSIE" in text_report and "ÉCHEC" not in text_report
    for expected in ("tables : 4", "constraints : 7", "indexes : 6", "révision Alembic : 20261013_0002",
                     "(4 tables, 291 lignes)", "fichiers « photos » : 7, tous vérifiés", "total des fichiers : 7"):
        assert expected in text_report, text_report
    assert MARKER not in restored.stdout + restored.stderr + text_report
    assert not list(tmp_path.glob("atlas-restore.*"))             # dossier de déchiffrement effacé
    with pg["source"].connect() as connection:                    # la source n'a pas été touchée
        assert connection.execute(text("SELECT count(*) FROM attendance_events")).scalar_one() == 250


def test_passphrase_file_mode_round_trip_and_private_file_required(env, tmp_path):
    secret = tmp_path / "phrase"
    secret.write_text("phrase-fictive-de-test\n")
    secret.chmod(0o644)
    symmetric = {k: v for k, v in env.items() if k != "BACKUP_GPG_RECIPIENT"} | {"BACKUP_PASSPHRASE_FILE": str(secret)}

    refused = _run(BACKUP, symmetric)
    assert refused.returncode != 0 and "droits trop larges" in refused.stderr and not _archives(env)

    secret.chmod(0o600)
    assert _run(BACKUP, symmetric).returncode == 0
    (archive,) = _archives(env)
    restored = _run(RESTORE, {**symmetric, "RESTORE_PASSPHRASE_FILE": str(secret)}, str(archive))
    assert restored.returncode == 0, restored.stdout + restored.stderr
    assert "phrase-fictive-de-test" not in restored.stdout + restored.stderr


def test_backup_refuses_to_run_without_encryption(env):
    result = _run(BACKUP, {k: v for k, v in env.items() if k != "BACKUP_GPG_RECIPIENT"})
    assert result.returncode != 0 and "aucun chiffrement configuré" in result.stderr
    assert not Path(env["BACKUP_DIR"]).exists()


def test_config_file_must_be_private_and_does_not_override_the_caller(env, tmp_path):
    config = tmp_path / "atlas-backup.env"
    config.write_text(f"# essai\nBACKUP_DIR='{tmp_path / 'ailleurs'}'\nBACKUP_KEEP_MIN=3\n")
    config.chmod(0o640)
    assert "droits trop larges" in _run(BACKUP, {**env, "BACKUP_ENV_FILE": str(config)}).stderr

    config.chmod(0o600)
    from_file = {k: v for k, v in env.items() if k != "BACKUP_DIR"} | {"BACKUP_ENV_FILE": str(config)}
    assert _run(BACKUP, from_file).returncode == 0
    assert len(list((tmp_path / "ailleurs").glob("atlas-backup_*.tar.gpg"))) == 1
    assert _run(BACKUP, {**env, "BACKUP_ENV_FILE": str(config)}).returncode == 0   # BACKUP_DIR de l'appelant
    assert len(_archives(env)) == 1


def test_container_mode_runs_the_postgres_tools_through_docker_exec(env, tmp_path):
    """Docker simulé : vérifie la forme des appels (docker exec -i <conteneur> <outil> -U <rôle> …)."""
    calls = tmp_path / "docker-calls.log"
    stub_dir = tmp_path / "docker-bin"
    stub_dir.mkdir()
    (stub_dir / "docker").write_text(f'#!/bin/sh\necho "$1 $2 $3 $4 $5 $6" >> "{calls}"\n'
                                     '[ "$1 $2 $3" = "exec -i pg-fictif" ] || exit 64\nshift 3\nexec "$@"\n')
    (stub_dir / "docker").chmod(0o755)
    role = env.get("PGUSER") or os.environ.get("USER", "")
    container = {**env, "PATH": f"{stub_dir}:{env['PATH']}", "BACKUP_PG_CONTAINER": "pg-fictif", "BACKUP_PG_USER": role,
                 "RESTORE_PG_CONTAINER": "pg-fictif", "RESTORE_PG_USER": role}

    assert _run(BACKUP, container).returncode == 0
    (archive,) = _archives(env)
    restored = _run(RESTORE, container, str(archive))
    assert restored.returncode == 0, restored.stdout + restored.stderr
    logged = calls.read_text()
    for tool in ("psql", "pg_dump", "pg_restore", "createdb", "dropdb"):
        assert f"exec -i pg-fictif {tool} -U {role}" in logged


# ── Erreurs et interruptions ─────────────────────────────────────────────────────────────
def test_failed_dump_leaves_no_archive_and_raises_an_alert(env, tmp_path):
    alert = tmp_path / "alerte.txt"
    result = _run(BACKUP, {**env, "BACKUP_PG_DB": "atlas_base_inexistante_xyz",
                           "BACKUP_ALERT_COMMAND": f'printf "%s" "$ATLAS_BACKUP_MESSAGE" > "{alert}"'})
    assert result.returncode not in (0, 75)
    assert not _archives(env)
    _no_cleartext_left(env)
    status = _status(env)
    assert status["result"] == "FAILED" and status["failed_step"] == "compteurs avant dump"
    assert "en échec" in alert.read_text() and "atlas_base_inexistante_xyz" in alert.read_text()
    assert not (Path(env["BACKUP_DIR"]) / "status" / "last_success.status").exists()


def test_interrupted_backup_cleans_up_and_the_next_one_succeeds(env, tmp_path):
    stub_dir = tmp_path / "bin"
    stub_dir.mkdir()
    (stub_dir / "pg_dump").write_text("#!/bin/sh\nsleep 60\n")
    (stub_dir / "pg_dump").chmod(0o755)
    process = subprocess.Popen(["bash", BACKUP], env={**env, "PATH": f"{stub_dir}:{env['PATH']}"}, start_new_session=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    work = None
    for _ in range(100):
        work = next(iter(Path(env["BACKUP_DIR"]).glob(".work.*/bundle/db.dump")), None) if Path(env["BACKUP_DIR"]).exists() else None
        if work:
            break
        time.sleep(0.1)
    assert work, "la sauvegarde n'a pas atteint l'étape du dump"
    os.killpg(process.pid, signal.SIGTERM)                        # arrêt du service : tout le groupe
    assert process.wait(timeout=20) != 0

    assert not _archives(env)
    _no_cleartext_left(env)
    assert _status(env)["result"] == "FAILED"
    assert _run(BACKUP, env).returncode == 0 and len(_archives(env)) == 1


def test_only_one_backup_at_a_time_and_crash_releases_kernel_lock(env):
    import fcntl

    lock = Path(env["BACKUP_DIR"]) / ".lock"
    lock.parent.mkdir(parents=True)
    with lock.open("w") as owner:
        fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        busy = _run(BACKUP, env)
        assert busy.returncode == 75 and "une autre sauvegarde est en cours" in busy.stderr
        assert lock.is_file() and not _archives(env)
        inode = lock.stat().st_ino
    recovered = _run(BACKUP, env)
    assert recovered.returncode == 0, recovered.stdout + recovered.stderr
    assert lock.stat().st_ino == inode and len(_archives(env)) == 1


def test_simultaneous_backups_have_one_owner_and_children_keep_the_lock(env, tmp_path):
    """The winner reaches pg_dump; every contender must refuse until ALL owners exit."""
    stub = tmp_path / "slow-bin"
    stub.mkdir()
    entered = tmp_path / "entered"
    real_dump = shutil.which("pg_dump")
    (stub / "pg_dump").write_text(f'#!/bin/sh\ntouch "{entered}"\nsleep 60\nexec "{real_dump}" "$@"\n')
    (stub / "pg_dump").chmod(0o755)
    slow = {**env, "PATH": f"{stub}:{env['PATH']}"}
    owner = subprocess.Popen(["bash", BACKUP], env=slow, start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if entered.exists():
                break
            time.sleep(0.1)
        assert entered.exists()
        contenders = [subprocess.Popen(["bash", BACKUP], env=slow, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True) for _ in range(8)]
        for contender in contenders:
            _, stderr = contender.communicate(timeout=20)
            assert contender.returncode == 75, stderr
        # Killing just bash must not release the lock while pg_dump is still alive.
        owner.kill()
        owner.wait(timeout=10)
        assert _run(BACKUP, env).returncode == 75
    finally:
        os.killpg(owner.pid, signal.SIGKILL)
        owner.wait(timeout=10)
    assert _run(BACKUP, env).returncode == 0
    assert len(_archives(env)) == 1
    _no_cleartext_left(env)


def test_leftovers_of_a_killed_run_are_removed(env):
    stale = Path(env["BACKUP_DIR"]) / ".work.ABC123" / "bundle"
    stale.mkdir(parents=True)
    (stale / "db.dump").write_text(MARKER)
    (Path(env["BACKUP_DIR"]) / "atlas-backup_20200101T000000Z.tar.gpg.partial").write_text("x")
    assert _run(BACKUP, env).returncode == 0
    _no_cleartext_left(env)
    assert len(_archives(env)) == 1


def test_tampered_archive_fails_the_restore_test_and_the_check(env):
    assert _run(BACKUP, env).returncode == 0
    (archive,) = _archives(env)
    data = bytearray(archive.read_bytes())
    data[len(data) // 2] ^= 0xFF
    archive.write_bytes(bytes(data))

    restored = _run(RESTORE, env, str(archive))
    assert restored.returncode != 0 and "ÉCHEC   somme de contrôle de l'archive chiffrée" in restored.stdout
    checked = _run(CHECK, env)
    assert checked.returncode == 1 and "ne correspond plus à sa somme de contrôle" in checked.stderr


def test_restore_test_without_the_private_key_fails_and_creates_no_database(env, gnupg):
    assert _run(BACKUP, env).returncode == 0
    (archive,) = _archives(env)
    result = _run(RESTORE, {**env, "GNUPGHOME": gnupg["empty_home"]}, str(archive))
    assert result.returncode != 0 and "déchiffrement impossible" in result.stderr


def test_restore_test_reports_a_row_count_mismatch(env, tmp_path):
    """Archive dont le relevé annonce plus de lignes que le dump n'en contient."""
    secret = tmp_path / "phrase"
    secret.write_text("phrase-fictive\n"); secret.chmod(0o600)
    symmetric = {k: v for k, v in env.items() if k != "BACKUP_GPG_RECIPIENT"} | {
        "BACKUP_PASSPHRASE_FILE": str(secret), "RESTORE_PASSPHRASE_FILE": str(secret)}
    assert _run(BACKUP, symmetric).returncode == 0
    (archive,) = _archives(env)
    forged = tmp_path / "forged"
    script = f'''set -euo pipefail
. "{REPO}/scripts/backup_lib.sh"
mkdir "{forged}" && gpg_decrypt "{archive}" | tar -xf - -C "{forged}"
cd "{forged}"
for f in row_counts_before.tsv row_counts_after.tsv; do sed 's/^public.employees\t40$/public.employees\t41/' "$f" > t && mv t "$f"; done
find . -type f ! -name SHA256SUMS | sort | while read -r f; do printf '%s  %s\\n' "$(sha256_of "$f")" "$f"; done > ../sums && mv ../sums SHA256SUMS
rm -f "{archive}.sha256"
tar -cf - -C "{forged}" . | gpg_encrypt_to "{archive}"
'''
    forging = subprocess.run(["bash", "-c", script], env=symmetric, capture_output=True, text=True)
    assert forging.returncode == 0, forging.stderr

    result = _run(RESTORE, symmetric, str(archive))
    assert result.returncode == 1
    assert "public.employees : 40 lignes, attendu 41" in result.stdout and "1 CONTRÔLE(S) EN ÉCHEC" in result.stdout


# ── Rétention, copie externe, surveillance ───────────────────────────────────────────────
def _old_archive(env, stamp, days):
    path = Path(env["BACKUP_DIR"]) / f"atlas-backup_{stamp}.tar.gpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"ancienne sauvegarde fictive")
    Path(f"{path}.sha256").write_text("0  x\n")
    age = time.time() - days * 86400
    os.utime(path, (age, age))
    return path


def test_retention_removes_old_archives_but_keeps_a_minimum(env):
    old = [_old_archive(env, f"2026090{i}T020000Z", 40 - i) for i in range(1, 6)]
    kept_env = {**env, "BACKUP_KEEP_DAYS": "14", "BACKUP_KEEP_MIN": "3"}

    assert _run(BACKUP, kept_env).returncode == 0
    names = [p.name for p in _archives(env)]
    assert len(names) == 3 and old[4].name in names and old[3].name in names     # la nouvelle + les 2 plus récentes
    assert not Path(f"{old[0]}.sha256").exists()

    time.sleep(1.1)                                               # nom d'archive à la seconde
    assert _run(BACKUP, {**env, "BACKUP_KEEP_DAYS": "14", "BACKUP_KEEP_MIN": "10"}).returncode == 0
    assert len(_archives(env)) == 4                               # sous le minimum : rien n'est supprimé


def _rclone_stub(tmp_path, body):
    stub_dir = tmp_path / "rclone-bin"
    stub_dir.mkdir(exist_ok=True)
    (stub_dir / "rclone").write_text("#!/bin/sh\n" + body)
    (stub_dir / "rclone").chmod(0o755)
    return str(stub_dir)


def test_offsite_copy_is_verified_and_its_failure_keeps_the_local_archive(env, tmp_path):
    remote = tmp_path / "remote"
    remote.mkdir()
    working = _rclone_stub(tmp_path, f'''case "$1" in
  copyto) shift; [ "$1" = --immutable ] && shift; cp "$1" "{remote}/$(basename "$2")" ;;
  check) for last; do :; done; name=$(printf '%s\\n' "$@" | sed -n '/^atlas-backup_/p'); cmp -s "{env["BACKUP_DIR"]}/$name" "{remote}/$name" ;;
esac
''')
    offsite = {**env, "PATH": f"{working}:{env['PATH']}", "BACKUP_OFFSITE_RCLONE_DEST": "coffre-fictif:atlas"}
    assert _run(BACKUP, offsite).returncode == 0
    (archive,) = _archives(env)
    assert _status(env)["offsite"] == "copiée et vérifiée"
    assert (remote / archive.name).read_bytes() == archive.read_bytes() and (remote / f"{archive.name}.sha256").exists()

    time.sleep(1.1)                                               # nom d'archive à la seconde
    _rclone_stub(tmp_path, "exit 1\n")
    failed = _run(BACKUP, offsite)
    assert failed.returncode != 0
    status = _status(env)
    assert status["result"] == "FAILED" and status["failed_step"] == "copie hors serveur"
    assert len(_archives(env)) == 2                               # l'archive locale achevée est conservée
    assert _status(env, "last_success.status")["file"] == archive.name


def test_a_second_run_in_the_same_second_never_overwrites_an_archive(env):
    existing = _old_archive(env, "20991231T235959Z", 0)
    stub = f'#!/bin/sh\ncase "$*" in *%Y%m%dT*) echo 20991231T235959Z ;; *) exec /bin/date "$@" ;; esac\n'
    stub_dir = Path(env["BACKUP_DIR"]).parent / "date-bin"
    stub_dir.mkdir()
    (stub_dir / "date").write_text(stub)
    (stub_dir / "date").chmod(0o755)
    result = _run(BACKUP, {**env, "PATH": f"{stub_dir}:{env['PATH']}"})
    assert result.returncode != 0 and "existe déjà" in result.stderr
    assert existing.read_bytes() == b"ancienne sauvegarde fictive"


def test_monthly_archive_is_the_first_successful_backup_of_each_month(env, tmp_path):
    daily, monthly = tmp_path / "daily", tmp_path / "monthly"
    daily.mkdir(); monthly.mkdir()
    stub = _rclone_stub(tmp_path, f'''dir() {{ case "$1" in fictif-quotidien:*) echo "{daily}" ;; fictif-mensuel:*) echo "{monthly}" ;; *) echo "$1" ;; esac; }}
case "$1" in
  copyto) shift; [ "$1" = --immutable ] && shift; cp "$1" "$(dir "$2")/$(basename "$2")" ;;
  check) name=$(printf '%s\\n' "$@" | sed -n '/^atlas-backup_/p'); for last; do :; done; cmp -s "{env["BACKUP_DIR"]}/$name" "$(dir "$last")/$name" ;;
  lsf) for last; do :; done; pattern=$(printf '%s\\n' "$@" | sed -n '/^atlas-backup_/p'); (cd "$(dir "$last")" && ls $pattern 2>/dev/null) || true ;;
esac
''')
    offsite = {**env, "PATH": f"{stub}:{env['PATH']}", "BACKUP_OFFSITE_RCLONE_DEST": "fictif-quotidien:atlas",
               "BACKUP_OFFSITE_MONTHLY_RCLONE_DEST": "fictif-mensuel:atlas"}

    first = _run(BACKUP, offsite)
    assert first.returncode == 0, first.stderr
    assert "archive mensuelle" in _status(env)["offsite"] and "créée" in _status(env)["offsite"]
    time.sleep(1.1)
    second = _run(BACKUP, offsite)
    assert second.returncode == 0 and "déjà présente" in second.stdout

    archives = [p.name for p in _archives(env)]
    assert sorted(p.name for p in daily.glob("*.tar.gpg")) == archives          # deux quotidiennes
    assert [p.name for p in monthly.glob("*.tar.gpg")] == archives[:1]          # une seule mensuelle
    assert (monthly / f"{archives[0]}.sha256").exists()

    refused = _run(BACKUP, {**env, "BACKUP_OFFSITE_MONTHLY_RCLONE_DEST": "fictif-mensuel:atlas"})
    assert refused.returncode != 0 and "exige BACKUP_OFFSITE_RCLONE_DEST" in refused.stderr


def test_offsite_required_without_destination_is_refused(env):
    result = _run(BACKUP, {**env, "BACKUP_OFFSITE_REQUIRED": "1"})
    assert result.returncode != 0 and "copie hors serveur exigée" in result.stderr


def test_failure_alert_is_sent_by_mail_without_exposing_the_smtp_password(env, tmp_path):
    """curl simulé : vérifie le message, le destinataire, et que le mot de passe n'est jamais en argument."""
    sent, args = tmp_path / "mail.txt", tmp_path / "curl-args.txt"
    stub_dir = tmp_path / "curl-bin"
    stub_dir.mkdir()
    (stub_dir / "curl").write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" > "{args}"\ncat > "{sent}"\n')
    (stub_dir / "curl").chmod(0o755)
    netrc = tmp_path / "smtp.netrc"
    netrc.write_text("machine smtp.example.invalid login alerte password mot-de-passe-fictif\n")
    netrc.chmod(0o600)
    mail = {**env, "PATH": f"{stub_dir}:{env['PATH']}", "BACKUP_PG_DB": "atlas_base_inexistante_xyz",
            "BACKUP_ALERT_COMMAND": f'bash "{REPO}/scripts/backup_alert_mail.sh"', "BACKUP_ALERT_EMAIL_TO": "alerte@example.invalid",
            "BACKUP_ALERT_EMAIL_FROM": "atlas@example.invalid", "BACKUP_ALERT_SMTP_URL": "smtps://smtp.example.invalid:465",
            "BACKUP_ALERT_SMTP_NETRC": str(netrc)}

    failed = _run(BACKUP, mail)

    assert failed.returncode != 0
    message, arguments = sent.read_text(), args.read_text().splitlines()
    assert "To: alerte@example.invalid" in message and "Subject: [ATLAS] Sauvegarde - alerte" in message
    assert "en échec" in message and "atlas_base_inexistante_xyz" in message
    assert "alerte@example.invalid" in arguments and "--ssl-reqd" in arguments and str(netrc) in arguments
    assert "mot-de-passe-fictif" not in message + "\n".join(arguments) + failed.stdout + failed.stderr

    netrc.chmod(0o644)                                            # identifiants lisibles par d'autres : refus
    sent.unlink()
    refused = _run(BACKUP, mail)
    assert "alerte non envoyée" in refused.stderr and not sent.exists()


def test_check_detects_missing_stale_and_failed_backups(env):
    Path(env["BACKUP_DIR"]).mkdir()
    missing = _run(CHECK, env)
    assert missing.returncode == 1 and "aucune sauvegarde" in missing.stderr

    assert _run(BACKUP, env).returncode == 0
    fine = _run(CHECK, env)
    assert fine.returncode == 0 and "Sauvegarde correcte" in fine.stdout

    assert _run(BACKUP, {**env, "BACKUP_PG_DB": "atlas_base_inexistante_xyz"}).returncode != 0
    assert "la dernière exécution a échoué" in _run(CHECK, env).stderr
    assert len(_archives(env)) == 1                               # un échec ne supprime pas l'archive précédente

    (archive,) = _archives(env)
    age = time.time() - 30 * 3600
    os.utime(archive, (age, age))
    stale = _run(CHECK, env)
    assert stale.returncode == 1 and "a plus de 26 h" in stale.stderr


@pytest.mark.parametrize("defect", ["payload_checksum", "nested_checksum", "nested_archive", "nested_gzip_crc", "outer_archive", "late_gpg_error"])
def test_restore_integrity_failure_never_creates_or_restores_a_database(env, tmp_path, defect):
    import hashlib
    import io
    import tarfile

    assert _run(BACKUP, env).returncode == 0
    (archive,) = _archives(env)
    clear = subprocess.run(["gpg", "--batch", "--decrypt", str(archive)], env=env,
                           capture_output=True, check=True).stdout
    bundle = tmp_path / "edited"
    bundle.mkdir()
    with tarfile.open(fileobj=io.BytesIO(clear)) as tar:
        tar.extractall(bundle, filter="data")
    if defect == "payload_checksum":
        (bundle / "db.dump").write_bytes(b"invalid dump")
    elif defect == "nested_checksum":
        (bundle / "files/photos.sha256").write_text("0" * 64 + "  ./agent-0.jpg\n")
    elif defect == "nested_archive":
        (bundle / "files/photos.tar.gz").write_bytes(b"invalid nested tar")
    elif defect == "nested_gzip_crc":
        nested = bundle / "files/photos.tar.gz"
        data = bytearray(nested.read_bytes())
        data[-8] ^= 0xFF
        nested.write_bytes(data)
    if defect in {"nested_checksum", "nested_archive", "nested_gzip_crc"}:
        sums = []
        for file in sorted(bundle.rglob("*")):
            if file.is_file() and file.name != "SHA256SUMS":
                sums.append(hashlib.sha256(file.read_bytes()).hexdigest() + "  ./" + file.relative_to(bundle).as_posix())
        (bundle / "SHA256SUMS").write_text("\n".join(sums) + "\n")
    if defect != "late_gpg_error":
        clear_tar = tmp_path / "edited.tar"
        with tarfile.open(clear_tar, "w") as tar:
            tar.add(bundle, arcname=".")
        if defect == "outer_archive":
            clear_tar.write_bytes(b"not a tar archive")
        archive.unlink()
        subprocess.run(["gpg", "--batch", "--yes", "--trust-model", "always", "--encrypt", "--recipient",
                        env["BACKUP_GPG_RECIPIENT"], "--output", str(archive), str(clear_tar)], env=env, check=True,
                       capture_output=True)
        Path(f"{archive}.sha256").write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + "  " + archive.name + "\n")
    spy = tmp_path / "spy-bin"
    spy.mkdir()
    calls = tmp_path / "restore-calls"
    for tool in ("createdb", "pg_restore"):
        (spy / tool).write_text(f'#!/bin/sh\necho {tool} >> "{calls}"\nexit 99\n')
        (spy / tool).chmod(0o755)
    if defect == "late_gpg_error":
        real_gpg = shutil.which("gpg")
        (spy / "gpg").write_text(f'#!/bin/sh\n"{real_gpg}" "$@"\nexit 1\n')
        (spy / "gpg").chmod(0o755)
    result = _run(RESTORE, {**env, "PATH": f"{spy}:{env['PATH']}"}, str(archive))
    assert result.returncode != 0, result.stdout + result.stderr
    assert not calls.exists(), "integrity failure reached a PostgreSQL restore command"
    assert not list(tmp_path.glob("atlas-restore.*"))


def test_backups_starting_together_produce_exactly_one_dump(env, tmp_path):
    gate, calls = tmp_path / 'start', tmp_path / 'dumps'
    stub = tmp_path / 'simultaneous-bin'
    stub.mkdir()
    real_dump = shutil.which('pg_dump')
    (stub / 'pg_dump').write_text(f'#!/bin/sh\necho dump >> "{calls}"\nsleep 2\nexec "{real_dump}" "$@"\n')
    (stub / 'pg_dump').chmod(0o755)
    command = 'while [ ! -f "$1" ]; do sleep 0.01; done; exec bash "$2"'
    contenders = [subprocess.Popen(['bash', '-c', command, 'start', str(gate), BACKUP],
                                  env={**env, 'PATH': f"{stub}:{env['PATH']}"},
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                  for _ in range(8)]
    gate.touch()
    for process in contenders:
        process.communicate(timeout=30)
    assert sorted(p.returncode for p in contenders) == [0] + [75] * 7
    assert calls.read_text().splitlines() == ['dump']
    assert len(_archives(env)) == 1
