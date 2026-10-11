"""Vérifie que les contraintes CHECK des tables de permissions de la base connectée sont
exactement celles des modèles de l'application.

Contrôle indépendant des migrations : il ne lit pas le texte des contraintes avec un analyseur,
il laisse PostgreSQL normaliser la forme attendue (table temporaire de session, créée à partir
des modèles) puis compare les deux définitions. Seul l'ordre est ignoré : celui des termes
d'un OU, d'un ET, et des valeurs d'une liste. Tout le reste est comparé à l'identique ; une
forme inconnue n'est jamais « tolérée ». Une contrainte élargie, restreinte, absente ou en
trop est donc signalée, quelle que soit son écriture.

Aucune donnée ni table permanente n'est modifiée : la table temporaire n'existe que dans la
session et la transaction est annulée.

    python3 -m scripts.check_permission_constraints

Codes de retour : 0 conforme ; 1 écart ; 3 base non PostgreSQL ou table absente.
"""
import re
import sys

from sqlalchemy import CheckConstraint, Column, MetaData, Table, text

TABLES = ("user_module_permissions", "user_feature_permissions")
_DEFINITIONS = text("SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
                    "WHERE conrelid = to_regclass(:name) AND contype = 'c'")


def _split(expression: str, operator: str) -> list[str]:
    """Découpe sur un opérateur de premier niveau (hors parenthèses, crochets et chaînes)."""
    parts, depth, quoted, start, index = [], 0, False, 0, 0
    while index < len(expression):
        char = expression[index]
        if char == "'":
            quoted = not quoted
        elif not quoted:
            if char in "([":
                depth += 1
            elif char in ")]":
                depth -= 1
            elif depth == 0 and expression.startswith(operator, index):
                parts.append(expression[start:index])
                index += len(operator)
                start = index
                continue
        index += 1
    parts.append(expression[start:])
    return parts


def _unwrap(expression: str) -> str:
    expression = expression.strip()
    while expression.startswith("(") and expression.endswith(")") and _balanced(expression[1:-1]):
        expression = expression[1:-1].strip()
    return expression


def _balanced(expression: str) -> bool:
    depth, quoted = 0, False
    for char in expression:
        if char == "'":
            quoted = not quoted
        elif not quoted:
            depth += 1 if char in "([" else -1 if char in ")]" else 0
            if depth < 0:
                return False
    return depth == 0 and not quoted


_TEXT_CAST = re.compile(r"::(?:character varying|varchar|text)(?:\[\])?")
_WRAPPED_ARRAY = re.compile(r"\(\s*(ARRAY\[[^\[\]]*\])\s*\)")
_WRAPPED_ATOM = re.compile(r"\(\s*('(?:[^']|'')*'|[a-z_][a-z0-9_]*)\s*\)")


def _plain(expression: str) -> str:
    """Retire les conversions entre types texte et les parenthèses autour d'une valeur seule.
    PostgreSQL écrit la même contrainte de deux façons selon qu'elle vient d'être créée ou
    qu'elle a été rechargée depuis une sauvegarde (« ARRAY['a'::varchar]::text[] » ou
    « ARRAY[('a'::varchar)::text] ») : seule cette différence d'écriture est effacée."""
    expression = _TEXT_CAST.sub("", expression)
    previous = None
    while previous != expression:
        previous = expression
        expression = _WRAPPED_ARRAY.sub(r"\1", _WRAPPED_ATOM.sub(r"\1", expression))
    return expression


def canonical(expression: str):
    """Forme comparable d'une définition déjà normalisée par PostgreSQL, insensible à l'ordre."""
    return _canonical(_plain(expression))


def _canonical(expression: str):
    expression = _unwrap(expression)
    for operator, tag in ((" OR ", "or"), (" AND ", "and")):
        parts = _split(expression, operator)
        if len(parts) > 1:
            return (tag, tuple(sorted((_canonical(part) for part in parts), key=repr)))
    start = expression.find("ARRAY[")
    if start >= 0 and expression.count("ARRAY[") == 1:
        end = _closing_bracket(expression, start + 6)
        if end is not None:
            items = tuple(sorted(item.strip() for item in _split(expression[start + 6:end], ",")))
            return ("leaf", expression[:start], items, expression[end:])
    return ("leaf", expression)


def _closing_bracket(expression: str, index: int) -> int | None:
    """Position du « ] » qui ferme la liste commencée juste avant `index`."""
    depth, quoted = 0, False
    for position in range(index, len(expression)):
        char = expression[position]
        if char == "'":
            quoted = not quoted
        elif not quoted:
            if char == "]" and depth == 0:
                return position
            depth += 1 if char in "([" else -1 if char in ")]" else 0
    return None


def _checks(connection, name: str) -> dict:
    return {constraint: canonical(definition.removeprefix("CHECK "))
            for constraint, definition in connection.execute(_DEFINITIONS, {"name": name}).all()}


def differences(connection) -> list[str]:
    """Écarts entre la base et les modèles, par nom de table et de contrainte (jamais de donnée)."""
    import app.main  # noqa: F401 — enregistre tous les modèles
    from app.db.base import Base

    problems: list[str] = []
    for name in TABLES:
        model = Base.metadata.tables[name]
        if connection.execute(text("SELECT to_regclass(:name)"), {"name": name}).scalar() is None:
            problems.append(f"{name} : table absente")
            continue
        expected_name = f"expected_{name}"
        expected = Table(expected_name, MetaData(), *(Column(c.name, c.type) for c in model.columns),
                         *(CheckConstraint(str(c.sqltext), name=c.name) for c in model.constraints if isinstance(c, CheckConstraint)),
                         prefixes=["TEMPORARY"])
        expected.create(connection)
        wanted, actual = _checks(connection, f"pg_temp.{expected_name}"), _checks(connection, f"public.{name}")
        for constraint in sorted(set(wanted) | set(actual)):
            if constraint not in actual:
                problems.append(f"{name} : contrainte {constraint} absente")
            elif constraint not in wanted:
                problems.append(f"{name} : contrainte {constraint} inattendue")
            elif wanted[constraint] != actual[constraint]:
                problems.append(f"{name} : contrainte {constraint} différente du modèle")
    return problems


def main() -> int:
    from app.db import session as db_session

    engine = db_session.engine
    if engine.dialect.name != "postgresql":
        print("[contraintes] PostgreSQL requis.", file=sys.stderr)
        return 3
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            problems = differences(connection)
        finally:
            transaction.rollback()
    if any(problem.endswith("table absente") for problem in problems):
        print("\n".join(f"[contraintes] {problem}" for problem in problems), file=sys.stderr)
        return 3
    if problems:
        print("\n".join(f"[contraintes] ÉCART — {problem}" for problem in problems))
        return 1
    print(f"[contraintes] CONFORME : contraintes de {', '.join(TABLES)} identiques aux modèles.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
