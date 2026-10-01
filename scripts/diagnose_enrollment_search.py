"""Diagnostic LECTURE SEULE : pourquoi un matricule existant en DRH est-il introuvable dans
Gestion du pointage → Biométrie → Enrôlement ?

Usage (conteneur de production, même DATABASE_URL que l'application) :
    python -m scripts.diagnose_enrollment_search --username PTG01 K115 K04 K162

Pour chaque matricule : fiche(s) DRH correspondantes (code ou matricule historique
extra.matricule), affectations, périmètre du compte, et l'étape exacte qui l'écarte de la
recherche — règle avant le correctif (date de début, code seul, tri par nom puis 25) et règle
actuelle (alignée sur la DRH). Aucune écriture : transaction en lecture seule, annulée à la fin.
Aucune donnée biométrique n'est lue (ni gabarit, ni image).
"""
from __future__ import annotations

import argparse
from datetime import date

from sqlalchemy import func, or_, select, text

from app.db.session import SessionLocal
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from app.modules.ops.routes import _allowed_assignment_site_ids, _site_society

LIMIT = 25


def _matches(db, term: str, by_code_only: bool):
    like = f"%{term}%"
    cond = Employee.code.ilike(like) | Employee.last_name.ilike(like) | Employee.first_name.ilike(like)
    if not by_code_only:
        cond = cond | Employee.extra["matricule"].as_string().ilike(like)
    return db.execute(select(Employee).where(cond)).scalars().all()


def diagnose(db, user: User, matricule: str) -> None:
    today = date.today()
    term = matricule.strip()
    print(f"\n=== {term} ===")
    exact = db.execute(select(Employee).where(or_(func.upper(Employee.code) == term.upper(),
                                                  func.upper(Employee.extra["matricule"].as_string()) == term.upper()))).scalars().all()
    if not exact:
        print("EXISTE DRH : NON (ni code ni matricule historique égal ; vérifier la saisie / normalisation)")
        near = db.execute(select(Employee.code).where(Employee.code.ilike(f"%{term}%")).limit(10)).scalars().all()
        print("  codes voisins :", near)
        return
    allowed = _allowed_assignment_site_ids(db, user)
    print(f"PÉRIMÈTRE {user.username} : {'tous les sites' if allowed is None else sorted(allowed)}")
    for emp in exact:
        extra = emp.extra if isinstance(emp.extra, dict) else {}
        print(f"EXISTE DRH : OUI · id={emp.id} · code={emp.code!r} · matricule historique={extra.get('matricule')!r}")
        print(f"  {emp.last_name} {emp.first_name} · statut={emp.status!r} · société={emp.society!r} · fonction={emp.position!r}")
        rows = db.execute(select(Assignment, Site).join(Site, Site.id == Assignment.site_id, isouter=True)
                          .where(Assignment.employee_id == emp.id).order_by(Assignment.id)).all()
        if not rows:
            print("  AFFECTATIONS : aucune → ÉLIMINÉ : aucune affectation (la recherche part des affectations du périmètre)")
            continue
        for a, s in rows:
            print(f"  AFFECTATION id={a.id} site={a.site_id} ({s.name if s else '?'}, société {_site_society(s) if s else '?'}) "
                  f"active={a.active} début={a.start_date} fin={a.end_date}")
        drh_active = [a for a, _ in rows if a.active == 1 and (a.end_date is None or a.end_date >= today)]
        old_active = [a for a in drh_active if a.start_date is not None and a.start_date <= today]
        in_scope = [a for a in drh_active if allowed is None or a.site_id in set(allowed)]
        if not drh_active:
            print("  ÉLIMINÉ PAR : affectation (aucune active et non terminée) — comportement identique DRH (« sans site »)")
            continue
        if not in_scope:
            print("  ÉLIMINÉ PAR : PÉRIMÈTRE — site(s) hors des sites autorisés du compte (comportement CORRECT, ne pas élargir)")
            continue
        if not old_active:
            print("  ANCIENNE RÈGLE : ÉLIMINÉ (date de début à venir) — RÈGLE ACTUELLE : visible (alignée DRH)")
        code_match = term.lower() in (emp.code or "").lower()
        if not code_match:
            print("  ANCIENNE RÈGLE : ÉLIMINÉ (matricule seulement dans extra.matricule) — RÈGLE ACTUELLE : visible")
        # Position sous l'ancien tri (par nom, coupe à 25) parmi les correspondances du périmètre.
        scoped_ids = {a.employee_id for a in db.execute(select(Assignment).where(
            Assignment.active == 1, Assignment.start_date <= today,
            (Assignment.end_date.is_(None)) | (Assignment.end_date >= today),
            *( [Assignment.site_id.in_(allowed or [-1])] if allowed is not None else [] ))).scalars()}
        old = sorted([e for e in _matches(db, term, by_code_only=True) if e.id in scoped_ids],
                     key=lambda e: ((e.last_name or ""), (e.first_name or ""), e.id))
        pos = next((i for i, e in enumerate(old) if e.id == emp.id), None)
        if pos is not None and pos >= LIMIT:
            print(f"  ANCIENNE RÈGLE : ÉLIMINÉ PAR LA LIMITE — {len(old)} correspondances, rang {pos + 1} (> {LIMIT}) ; "
                  "RÈGLE ACTUELLE : correspondance exacte classée en premier")
        elif pos is not None:
            print(f"  ANCIENNE RÈGLE : trouvé (rang {pos + 1}/{len(old)})")
        print("  RÈGLE ACTUELLE : visible dans le périmètre du compte")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--username", required=True, help="compte dont on vérifie le périmètre (ex. PTG01)")
    parser.add_argument("matricules", nargs="+")
    args = parser.parse_args()
    db = SessionLocal()
    try:
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SET TRANSACTION READ ONLY"))
        user = db.execute(select(User).where(User.username == args.username)).scalar_one_or_none()
        if user is None:
            raise SystemExit(f"Compte {args.username} introuvable")
        for matricule in args.matricules:
            diagnose(db, user, matricule)
    finally:
        db.rollback()
        db.close()


if __name__ == "__main__":
    main()
