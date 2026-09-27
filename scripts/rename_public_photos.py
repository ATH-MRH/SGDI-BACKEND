"""Renomme les photos à nom prévisible (/uploads/photos/<MATRICULE>.jpg) en noms imprévisibles
et met à jour toutes les références (voir app/core/photo_migration.py).

    python scripts/rename_public_photos.py            # SIMULATION (aucune modification)
    python scripts/rename_public_photos.py --apply    # après sauvegarde de la base ET du dossier uploads

Avec --apply, la correspondance ancien → nouveau nom est écrite AVANT tout renommage dans
./photo_migration_journal_<horodatage>.json (répertoire courant, jamais dans uploads) : c'est
la table de retour arrière. En cas d'erreur, les fichiers déjà renommés sont restaurés.

Ensuite seulement : PHOTOS_REQUIRE_UNGUESSABLE_NAMES=true (les anciens noms ne sont plus servis).
"""
import json
import sys
import time
from pathlib import Path

from app.db.session import SessionLocal
from app.core.photo_migration import migrate_public_photos

if __name__ == "__main__":
    apply = "--apply" in sys.argv
    with SessionLocal() as db:
        journal = Path.cwd() / f"photo_migration_journal_{time.strftime('%Y%m%d-%H%M%S')}.json" if apply else None
        print(json.dumps(migrate_public_photos(db, apply=apply, journal_path=journal), ensure_ascii=False, indent=2))
        if journal:
            print(f"Journal de retour arrière : {journal}")
    if not apply:
        print("Simulation uniquement. Relancer avec --apply après sauvegarde.")
