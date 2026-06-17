"""
Dotation en masse — kit standard pour tous les employés actifs.

Usage sur le serveur :
  DATABASE_URL=postgresql://... python3 scripts/dotation_bulk.py

Ce script :
  1. Affiche les articles trouvés dans le catalogue pour chaque poste du kit
  2. Demande confirmation avant de continuer
  3. Efface toutes les dotations existantes (employee_equipment + material_assignments)
  4. Crée les nouvelles dotations pour chaque employé actif
"""

import os
import sys
from datetime import date

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    print("ERREUR : variable DATABASE_URL manquante.")
    sys.exit(1)

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
Session = sessionmaker(bind=engine)

# Kit à doter (designation partielle, quantité)
KIT = [
    ("tenue bleu chemise",  2),
    ("tenue bleu pantalon", 2),
    ("rangers",             1),
    ("parkas",              1),
    ("ceinture",            1),
    ("casquette",           1),
]

TODAY = date.today().isoformat()
REASON = "Dotation initiale"


def find_article(db, keyword):
    rows = db.execute(
        text("SELECT id, designation, category, quantity FROM stock_articles WHERE active = 1 AND LOWER(designation) LIKE :kw ORDER BY id"),
        {"kw": f"%{keyword.lower()}%"}
    ).fetchall()
    return rows


def main():
    with Session() as db:
        # 1. Résoudre les articles
        print("\n=== ARTICLES CATALOGUE ===")
        resolved = []
        for label, qty in KIT:
            matches = find_article(db, label)
            if not matches:
                print(f"  ✗ [{label}] — AUCUN article trouvé dans le catalogue")
                print("    → Créez d'abord cet article dans le catalogue matériel.")
                sys.exit(1)
            elif len(matches) > 1:
                print(f"  ? [{label}] — plusieurs articles correspondants :")
                for r in matches:
                    print(f"      id={r.id} | {r.designation} | stock={r.quantity}")
                chosen = matches[0]
                print(f"    → Utilisation du premier : id={chosen.id} | {chosen.designation}")
            else:
                chosen = matches[0]
                print(f"  ✓ [{label}] → id={chosen.id} | {chosen.designation} | stock={chosen.quantity}")
            resolved.append((chosen.id, chosen.designation, qty))

        # 2. Employés actifs
        employees = db.execute(
            text("SELECT id, first_name, last_name, code FROM employees WHERE LOWER(status) = 'actif' OR LOWER(status) = 'active' ORDER BY id")
        ).fetchall()
        print(f"\n=== EMPLOYÉS ACTIFS : {len(employees)} ===")

        total_lines = len(employees) * len(KIT)
        print(f"\nOpération : effacer toutes les dotations existantes puis créer {total_lines} nouvelles dotations.")
        confirm = input("Confirmer ? (oui/non) : ").strip().lower()
        if confirm not in ("oui", "o", "yes", "y"):
            print("Annulé.")
            sys.exit(0)

        # 3. Effacer dotations existantes
        print("\nSuppression des dotations existantes…")
        del_ee = db.execute(text("DELETE FROM employee_equipment")).rowcount
        del_ma = db.execute(text("DELETE FROM material_assignments")).rowcount
        print(f"  employee_equipment : {del_ee} lignes supprimées")
        print(f"  material_assignments : {del_ma} lignes supprimées")

        # 4. Créer nouvelles dotations
        print("\nCréation des nouvelles dotations…")
        done = 0
        errors = 0
        for emp in employees:
            emp_name = f"{emp.last_name or ''} {emp.first_name or ''}".strip() or emp.code or str(emp.id)
            for article_id, designation, qty in resolved:
                try:
                    db.execute(
                        text("""
                            INSERT INTO employee_equipment
                              (employee_id, article_id, quantity, dotation_date, dotation_reason, item_state, status, created_at, updated_at)
                            VALUES
                              (:emp_id, :art_id, :qty, :dt, :reason, 'neuf', 'attribue', NOW(), NOW())
                        """),
                        {"emp_id": emp.id, "art_id": article_id, "qty": qty, "dt": TODAY, "reason": REASON}
                    )
                    done += 1
                except Exception as e:
                    errors += 1
                    print(f"  ✗ {emp_name} | {designation} → {e}")

            if (employees.index(emp) + 1) % 20 == 0:
                print(f"  … {employees.index(emp) + 1}/{len(employees)} employés traités")

        db.commit()
        print(f"\n✓ Terminé : {done} dotations créées, {errors} erreurs.")
        print(f"  {len(employees)} employés × {len(KIT)} articles = {total_lines} lignes attendues.")


if __name__ == "__main__":
    main()
