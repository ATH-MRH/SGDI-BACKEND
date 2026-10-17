"""Rechiffre les gabarits, identifiants de caméra et photos temporaires avec la clé active.

Par défaut : simulation en lecture seule (aucune écriture). Écriture uniquement avec
--apply ET --confirm-database <nom exact de la base connectée>.

    python3 -m scripts.rotate_biometric_key                      # simulation / vérification
    python3 -m scripts.rotate_biometric_key --apply --confirm-database <base>
    python3 -m scripts.rotate_biometric_key --report rapport.json

Codes de retour : 0 = tout est lisible par la clé active seule ; 1 = des lignes restent à
rechiffrer ; 2 = des lignes ne sont lisibles par aucune clé configurée ; 3 = configuration
refusée. N'affiche jamais de clé ni de contenu. Procédure : docs/biometric-key-rotation.md.
"""
import argparse
import json
import sys

from fastapi import HTTPException

EXIT_CONFIG = 3


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--apply", action="store_true", help="écrit les lignes rechiffrées (sinon simulation)")
    parser.add_argument("--confirm-database", default="", help="nom exact de la base connectée, exigé avec --apply")
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--report", default="", help="écrit le rapport JSON dans ce fichier")
    args = parser.parse_args(argv)

    from app.db import session as db_session
    from app.modules.biometrics import crypto, key_rotation

    database = db_session.engine.url.database or ""
    print(f"[rotation] base : {database} ; mode : {'ÉCRITURE' if args.apply else 'simulation (lecture seule)'}")
    if args.apply:
        if args.confirm_database != database:
            print("[rotation] REFUS : --confirm-database doit être le nom exact de la base connectée.", file=sys.stderr)
            return EXIT_CONFIG
        if not crypto.previous_key_configured():
            print("[rotation] REFUS : aucune ancienne clé configurée (BIOMETRIC_TEMPLATE_KEY_PREVIOUS), "
                  "rien à rechiffrer.", file=sys.stderr)
            return EXIT_CONFIG
    try:
        report = key_rotation.run(db_session.SessionLocal, apply=args.apply, batch_size=max(1, args.batch_size))
    except HTTPException as exc:
        print(f"[rotation] REFUS : {exc.detail}", file=sys.stderr)
        return EXIT_CONFIG
    report["database"] = database
    print(f"[rotation] clé active : id {report['active_key_id']} ; ancienne clé : id {report['previous_key_id'] or 'aucune'}")
    if report["totals"]["unreadable"]:
        for name, target in report["targets"].items():
            if target["unreadable_ids"]:
                print(f"[rotation] {name} : identifiants illisibles {target['unreadable_ids']}")
    if report["safe_to_remove_previous_key"]:
        print("[rotation] VÉRIFIÉ : tout est lisible avec la clé active seule.")
    elif args.apply and not report["totals"]["unreadable"]:
        print("[rotation] Rechiffrement écrit. Relancer SANS --apply pour vérifier avant de retirer l'ancienne clé.")
    else:
        print("[rotation] NE PAS retirer l'ancienne clé : des lignes en dépendent encore ou sont illisibles.")
    if args.report:
        with open(args.report, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2, ensure_ascii=False)
    return report["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
