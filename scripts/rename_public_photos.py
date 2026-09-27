"""Renomme les photos à nom prévisible (/uploads/photos/<MATRICULE>.jpg) en noms imprévisibles
et met à jour toutes les références (voir app/core/photo_migration.py).

    python scripts/rename_public_photos.py            # SIMULATION (aucune modification)
    python scripts/rename_public_photos.py --apply    # après sauvegarde de la base ET du dossier uploads

Ensuite seulement : PHOTOS_REQUIRE_UNGUESSABLE_NAMES=true (les anciens noms ne sont plus servis).
"""
import json
import sys

from app.db.session import SessionLocal
from app.core.photo_migration import migrate_public_photos

if __name__ == "__main__":
    apply = "--apply" in sys.argv
    with SessionLocal() as db:
        print(json.dumps(migrate_public_photos(db, apply=apply), ensure_ascii=False, indent=2))
    if not apply:
        print("Simulation uniquement. Relancer avec --apply après sauvegarde.")
