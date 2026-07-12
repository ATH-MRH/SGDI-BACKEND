#!/usr/bin/env python3
"""Aplatit employees.extra (emboîtement _legacy) et externalise les documents base64.

Cause des lenteurs de chargement : la colonne extra avait gonflé (jusqu'à 65 Mo au
total) à cause d'un emboîtement récursif _legacy._legacy... qui dupliquait les
documents à chaque sauvegarde. Ce script résorbe ça SANS RIEN PERDRE : tous les
champs et documents sont préservés (fusion sans perte), le base64 des documents
part sur le disque persistant /uploads/docs (le frontend l'affiche déjà).

Usage (dans le conteneur) :
    python scripts/flatten_employee_extra.py            # APERÇU seul, ne modifie rien
    python scripts/flatten_employee_extra.py --apply    # applique en base

À faire d'abord sur STAGING avec une copie de la base, dump PostgreSQL à l'appui.
Le script est idempotent : le relancer ne change plus rien.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select

from app.db.session import SessionLocal, safe_database_url
from app.modules.drh.models import Employee
from app.modules.irongs.sql_bridge import shrink_employee_extra


def _size(extra) -> int:
    try:
        return len(json.dumps(extra, ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError):
        return 0


def _human(n: int) -> str:
    for unit in ("o", "Ko", "Mo", "Go"):
        if n < 1024:
            return f"{n:.0f} {unit}" if unit == "o" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} To"


def main() -> int:
    parser = argparse.ArgumentParser(description="Aplatit employees.extra et externalise les documents.")
    parser.add_argument("--apply", action="store_true", help="Appliquer en base (sinon aperçu seul).")
    args = parser.parse_args()

    print(f"Base: {safe_database_url()}")
    with SessionLocal() as db:
        rows = db.execute(select(Employee).order_by(Employee.id)).scalars().all()
        total_avant = sum(_size(r.extra) for r in rows)

        details = []  # (code, avant, apres)
        changed = 0
        for row in rows:
            avant = _size(row.extra)
            if shrink_employee_extra(row):  # mute row.extra en mémoire (documents écrits sur disque)
                changed += 1
                details.append((row.code, avant, _size(row.extra)))

        total_apres = sum(_size(r.extra) for r in rows)

        print(f"Employés analysés : {len(rows)}")
        print(f"Employés à alléger : {changed}")
        print(f"Taille extra totale : {_human(total_avant)} -> {_human(total_apres)} "
              f"(-{_human(max(0, total_avant - total_apres))})")
        details.sort(key=lambda d: d[1] - d[2], reverse=True)
        print("\nPlus gros gains (top 15) :")
        for code, av, ap in details[:15]:
            print(f"  {str(code):12s} {_human(av):>10s} -> {_human(ap):>9s}")

        if not args.apply:
            db.rollback()
            print("\nAPERÇU uniquement (aucune écriture en base). "
                  "Note : les fichiers documents ont pu être écrits sur /uploads/photos/docs "
                  "(inoffensif, ils seront référencés au --apply).")
            print("Relancez avec --apply pour appliquer.")
            return 0

        db.commit()
        print("\nMigration appliquée. Relancer le script doit désormais afficher 0 employé à alléger.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
