"""Rechiffrement des contenus protégés par la clé biométrique, après ajout d'une nouvelle clé.

Colonnes concernées : gabarits, identifiants de caméra, photo candidate d'une prise distante.
Sans `apply`, la passe ne fait que lire et compter. Avec `apply`, chaque lot est une transaction
(lignes verrouillées) : une ligne déjà lisible par la clé active n'est jamais retouchée, donc
l'outil peut être interrompu puis relancé sans risque.

Ne journalise que des identifiants techniques et des compteurs : jamais de clé, de gabarit ni
de contenu déchiffré. Procédure complète : docs/biometric-key-rotation.md."""
from __future__ import annotations

from typing import Any, Callable

from cryptography.fernet import InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.modules.biometrics import crypto
from app.modules.biometrics.models import BiometricRemoteCaptureSession, BiometricTemplate, Camera

TARGETS: tuple[tuple[str, Any, str], ...] = (
    ("biometric_templates", BiometricTemplate, "embedding_encrypted"),
    ("cameras", Camera, "credentials_encrypted"),
    ("biometric_remote_capture_sessions", BiometricRemoteCaptureSession, "photo_encrypted"),
)

EXIT_OK, EXIT_PENDING, EXIT_UNREADABLE = 0, 1, 2
MAX_REPORTED_IDS = 50


def _process_batch(db: Session, model: Any, column: str, ids: list[int], apply: bool, stats: dict) -> None:
    rows = db.execute(select(model).where(model.id.in_(ids)).order_by(model.id).with_for_update()).scalars().all()
    for row in rows:
        token = getattr(row, column)
        if not token:
            continue   # vidée entre la sélection et le verrou
        if crypto.readable_with_active_key(token):
            stats["current"] += 1
            continue
        try:
            renewed = crypto.reencrypt(token)
        except InvalidToken:
            stats["unreadable"] += 1
            if len(stats["unreadable_ids"]) < MAX_REPORTED_IDS:
                stats["unreadable_ids"].append(row.id)
            continue
        if not apply:
            stats["pending"] += 1
            continue
        # Contrôle avant écriture : la clé active seule relit le nouveau contenu.
        if not crypto.readable_with_active_key(renewed):
            raise RuntimeError(f"contrôle de rechiffrement en échec (table {model.__tablename__}, id {row.id})")
        setattr(row, column, renewed)
        stats["rotated"] += 1


def run(session_factory: Callable[[], Session], *, apply: bool = False, batch_size: int = 200,
        log: Callable[[str], None] = print) -> dict:
    """Parcourt les colonnes chiffrées. Lève HTTPException (503) si la clé active est absente
    ou si une clé est invalide — avant toute lecture de ligne."""
    report: dict[str, Any] = {
        "mode": "apply" if apply else "dry-run",
        "active_key_id": crypto.key_id("active"),
        "previous_key_id": crypto.key_id("previous") if crypto.previous_key_configured() else None,
        "targets": {},
    }
    crypto._fernet()   # valide la configuration des clés une fois pour toutes
    for name, model, column in TARGETS:
        stats = {"current": 0, "pending": 0, "rotated": 0, "unreadable": 0, "unreadable_ids": []}
        last_id = 0
        while True:
            with session_factory() as db:
                ids = list(db.execute(select(model.id).where(getattr(model, column).isnot(None), model.id > last_id)
                                      .order_by(model.id).limit(batch_size)).scalars())
                if not ids:
                    break
                _process_batch(db, model, column, ids, apply, stats)
                if apply:
                    db.commit()
                else:
                    db.rollback()
                last_id = ids[-1]
        report["targets"][name] = {"column": column, **stats}
        log(f"[rotation] {name}.{column} : à jour={stats['current']} à rechiffrer={stats['pending']} "
            f"rechiffrées={stats['rotated']} illisibles={stats['unreadable']}")
    totals = {k: sum(t[k] for t in report["targets"].values()) for k in ("current", "pending", "rotated", "unreadable")}
    report["totals"] = totals
    # Une ligne rechiffrée dans cette passe n'est déclarée sûre qu'après relecture : relancer sans --apply.
    report["safe_to_remove_previous_key"] = totals["pending"] == 0 and totals["unreadable"] == 0 and totals["rotated"] == 0
    report["exit_code"] = EXIT_UNREADABLE if totals["unreadable"] else EXIT_PENDING if totals["pending"] else EXIT_OK
    if apply and totals["rotated"]:
        with session_factory() as db:
            append_audit(db, action="biometrics.key_rotation", resource="biometric_template_key", result="success",
                         new_state={"rotated": {n: t["rotated"] for n, t in report["targets"].items()},
                                    "unreadable": totals["unreadable"], "active_key_id": report["active_key_id"]})
            db.commit()
    return report
