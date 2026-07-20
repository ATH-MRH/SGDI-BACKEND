import argparse
import os
import unicodedata

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.modules.ops.models import Site


OLD_SOCIETE = "IRON GLOBAL SÉCURITÉ"
NEW_SOCIETE = "IRON GLOBAL SOLUTION"

# Sites DHL Forwarding à réaffecter à IRON GLOBAL SOLUTION (DHL FORWARDING / DG exclu
# volontairement : il reste rattaché à IRON GLOBAL SÉCURITÉ).
TARGET_SITE_NAMES = [
    "DHL FORWARDING / HAMOUL 01 (40K)",
    "DHL FORWARDING / HAMOUL 1",
    "DHL FORWARDING / HAMOUL 2",
    "DHL FORWARDING / HAMOUL 2 (17K)",
    "DHL FORWARDING / OUED TLILET",
    "DHL FORWARDING / TLILET (15K)",
]


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


def _norm(text: str) -> str:
    text = " ".join(str(text or "").strip().upper().split())
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def _site_societe(site: Site) -> str:
    plan = site.equipment_plan if isinstance(site.equipment_plan, dict) else {}
    legacy = plan.get("_legacy") if isinstance(plan.get("_legacy"), dict) else {}
    return plan.get("societe") or plan.get("society") or legacy.get("societe") or legacy.get("society") or ""


def fix_dhl_sites_societe(database_url: str | None = None, apply: bool = False) -> list[str]:
    database_url = database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit(
            "DATABASE_URL manquant. Lancez par exemple :\n"
            "DATABASE_URL='postgresql://user:motdepasse@hote:5432/base' "
            "python3 -m scripts.fix_dhl_sites_societe --apply"
        )

    SessionLocal = sessionmaker(
        bind=create_engine(normalize_database_url(database_url), future=True, pool_pre_ping=True),
        autoflush=False,
        autocommit=False,
        future=True,
    )
    db = SessionLocal()
    changed: list[str] = []
    target_keys = {_norm(name) for name in TARGET_SITE_NAMES}
    try:
        rows = db.query(Site).all()
        for site in rows:
            if _norm(site.name) not in target_keys:
                continue
            current = _site_societe(site)
            plan = dict(site.equipment_plan) if isinstance(site.equipment_plan, dict) else {}
            legacy = dict(plan.get("_legacy")) if isinstance(plan.get("_legacy"), dict) else {}
            plan["societe"] = NEW_SOCIETE
            plan["society"] = NEW_SOCIETE
            if legacy:
                legacy["societe"] = NEW_SOCIETE
                legacy["society"] = NEW_SOCIETE
                plan["_legacy"] = legacy
            label = f"#{site.id} {site.name} : {current or '(vide)'} -> {NEW_SOCIETE}"
            changed.append(label)
            if apply:
                site.equipment_plan = plan
        if apply and changed:
            db.commit()
        elif apply:
            db.rollback()
        else:
            db.rollback()
        return changed
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Réaffecte les sites DHL Forwarding (sauf DG) de IRON GLOBAL SÉCURITÉ vers IRON GLOBAL SOLUTION."
    )
    parser.add_argument("--database-url", default=None, help="URL PostgreSQL si DATABASE_URL n'est pas exporté")
    parser.add_argument("--apply", action="store_true", help="Applique réellement les changements (sinon: aperçu seul)")
    args = parser.parse_args()
    changed = fix_dhl_sites_societe(args.database_url, args.apply)
    if not changed:
        print("Aucun site correspondant trouvé.")
        return
    print(("Changements appliqués :" if args.apply else "Aperçu (aucun changement appliqué, relancez avec --apply) :"))
    for line in changed:
        print(" -", line)


if __name__ == "__main__":
    main()
