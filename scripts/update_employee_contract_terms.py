from app.db.session import SessionLocal, safe_database_url
from app.modules.drh.contract_maintenance import build_arg_parser, update_all_employee_contract_terms


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    db = SessionLocal()
    try:
        result = update_all_employee_contract_terms(db, commit=args.apply)
    finally:
        db.close()

    mode = "APPLIQUE" if args.apply else "SIMULATION"
    print(f"{mode} - base: {safe_database_url()}")
    print(f"Employes lus: {result.employees_seen}")
    print(f"Employes mis a jour: {result.employees_updated}")
    print(f"Employes sans date debut: {result.employees_without_start_date}")
    print(f"Contrats lus: {result.contracts_seen}")
    print(f"Contrats mis a jour: {result.contracts_updated}")
    print(f"Enregistrements legacy agents lus: {result.legacy_records_seen}")
    print(f"Enregistrements legacy agents mis a jour: {result.legacy_records_updated}")
    if not args.apply:
        print("Aucun changement enregistre. Relance avec --apply pour appliquer.")


if __name__ == "__main__":
    main()

