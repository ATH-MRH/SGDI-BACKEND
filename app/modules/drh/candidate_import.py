"""Import Excel de candidats (recrute.irongs.com).

Chaîne : lecture du classeur en mémoire → correspondance des colonnes → vérification
(validation + doublons) → confirmation. Aucune fiche n'est créée avant la confirmation ;
celle-ci revalide tout, recontrôle les doublons et passe par les services métier existants
(`service.create_candidate` / `service.update_candidate`).

Aucun fichier n'est écrit sur disque : le contenu des cellules vit dans la session d'import
(table candidate_import_sessions) et en est effacé dès la fin du traitement. Aucune macro ni
formule n'est exécutée : seules les valeurs enregistrées dans le classeur sont lues."""
from __future__ import annotations

import hashlib
import io
import logging
import re
import secrets
import zipfile
from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, select, text, update
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.core.scope_policy import ScopeKind, authorized_society_values, society_scope
from app.modules.drh import service
from app.modules.drh.candidate_import_models import CandidateImportSession
from app.modules.drh.candidate_import_reference import (
    FIELD_BY_KEY, FIELDS, REQUIRED_KEYS, WILAYAS, ImportField, communes_by_wilaya_code, field_for_header,
    norm_key, resolve_choice, resolve_commune, resolve_wilaya,
)
from app.modules.drh.models import Candidate, Employee
from app.modules.drh.schemas import _UPPERCASE_FIELDS, CandidateCreate, CandidateUpdate
from app.modules.irongs.models import Position

logger = logging.getLogger("sgdi.drh.candidate_import")

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024
MAX_ROWS = 1000
MAX_COLUMNS = 60
MAX_SHEETS = 10
HEADER_SCAN_ROWS = 20
SESSION_TTL_MINUTES = 30
RESULT_RETENTION_DAYS = 30
ALLOWED_EXTENSIONS = (".xlsx", ".xls")
NOT_IMPORTABLE_MARKER = "ne pas importer"
_ADVISORY_LOCK_KEY = 74202610100001
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_ENCRYPTED_STREAM = "EncryptedPackage".encode("utf-16-le")
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
_FRENCH_MONTHS = {"janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7, "aout": 8,
                  "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12}


def limits() -> dict[str, Any]:
    return {"max_file_bytes": MAX_FILE_BYTES, "max_file_mb": MAX_FILE_BYTES // (1024 * 1024), "max_rows": MAX_ROWS,
            "max_columns": MAX_COLUMNS, "max_sheets": MAX_SHEETS, "extensions": list(ALLOWED_EXTENSIONS),
            "session_minutes": SESSION_TTL_MINUTES}


class ImportFileError(Exception):
    """Fichier refusé : message destiné à l'utilisateur."""


class _FieldError(Exception):
    pass


# ── Lecture du classeur ──────────────────────────────────────────────────────────────────
def _encode_value(value: Any) -> Any:
    """Cellule → valeur JSON typée : texte, {"n": nombre}, {"d": "AAAA-MM-JJ"}, {"b": bool}."""
    if value is None:
        return None
    if isinstance(value, bool):
        return {"b": value}
    if isinstance(value, datetime):
        return {"d": value.date().isoformat()}
    if isinstance(value, date):
        return {"d": value.isoformat()}
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, timedelta):
        return str(value)
    if isinstance(value, (int, float)):
        return {"n": value}
    text_value = str(value)
    return text_value if text_value.strip() else None


def _trim(row: list[Any]) -> list[Any]:
    while row and row[-1] is None:
        row.pop()
    return row


def _read_xlsx(content: bytes) -> list[dict[str, Any]]:
    from openpyxl import load_workbook

    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = archive.namelist()
            if sum(info.file_size for info in archive.infolist()) > MAX_UNCOMPRESSED_BYTES:
                raise ImportFileError("Classeur trop volumineux une fois décompressé.")
            if "xl/workbook.xml" not in names:
                raise ImportFileError("Ce fichier n'est pas un classeur Excel (.xlsx) valide.")
    except zipfile.BadZipFile as exc:
        raise ImportFileError("Fichier Excel corrompu ou illisible.") from exc
    try:
        values_book = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        formulas_book = load_workbook(io.BytesIO(content), read_only=True, data_only=False)
    except ImportFileError:
        raise
    except Exception as exc:  # openpyxl lève des types variés selon la corruption
        raise ImportFileError("Fichier Excel corrompu ou illisible.") from exc
    try:
        if len(values_book.sheetnames) > MAX_SHEETS:
            raise ImportFileError(f"Le classeur contient trop de feuilles (maximum {MAX_SHEETS}).")
        sheets = []
        for name in values_book.sheetnames:
            sheet = values_book[name]
            if getattr(sheet, "sheet_state", "visible") != "visible" or not hasattr(sheet, "iter_rows"):
                continue
            formula_cells: set[tuple[int, int]] = set()
            for r_index, row in enumerate(formulas_book[name].iter_rows(), start=1):
                if r_index > HEADER_SCAN_ROWS + MAX_ROWS + 1:
                    break
                for c_index, cell in enumerate(row):
                    if getattr(cell, "data_type", None) == "f":
                        formula_cells.add((r_index, c_index))
            rows: list[list[Any]] = []
            overflow = False
            for r_index, row in enumerate(sheet.iter_rows(), start=1):
                if r_index > HEADER_SCAN_ROWS + MAX_ROWS + 1:
                    overflow = any(cell.value is not None for cell in row) or overflow
                    if overflow:
                        break
                    continue
                encoded = []
                for c_index, cell in enumerate(row):
                    value = cell.value
                    if getattr(cell, "data_type", None) == "e":
                        encoded.append({"e": f"erreur Excel {value}"})
                    elif (r_index, c_index) in formula_cells and value is None:
                        encoded.append({"e": "formule sans valeur enregistrée"})
                    else:
                        encoded.append(_encode_value(value))
                rows.append(_trim(encoded))
            sheets.append({"name": name, "rows": _trim_rows(rows), "overflow": overflow})
        return sheets
    except ImportFileError:
        raise
    except Exception as exc:
        raise ImportFileError("Fichier Excel corrompu ou illisible.") from exc
    finally:
        values_book.close()
        formulas_book.close()


def _read_xls(content: bytes) -> list[dict[str, Any]]:
    try:
        import xlrd
    except ImportError as exc:
        raise ImportFileError("Lecture des fichiers .xls indisponible sur ce déploiement : enregistrez le classeur en .xlsx.") from exc
    if _ENCRYPTED_STREAM in content:
        raise ImportFileError("Classeur protégé par mot de passe : retirez la protection avant l'import.")
    try:
        book = xlrd.open_workbook(file_contents=content, on_demand=True)
    except xlrd.XLRDError as exc:
        if "encrypt" in str(exc).lower() or "password" in str(exc).lower():
            raise ImportFileError("Classeur protégé par mot de passe : retirez la protection avant l'import.") from exc
        raise ImportFileError("Fichier Excel (.xls) corrompu ou illisible.") from exc
    except Exception as exc:
        raise ImportFileError("Fichier Excel (.xls) corrompu ou illisible.") from exc
    try:
        if book.nsheets > MAX_SHEETS:
            raise ImportFileError(f"Le classeur contient trop de feuilles (maximum {MAX_SHEETS}).")
        sheets = []
        for index in range(book.nsheets):
            sheet = book.sheet_by_index(index)
            if getattr(sheet, "visibility", 0) != 0:
                continue
            rows: list[list[Any]] = []
            limit = HEADER_SCAN_ROWS + MAX_ROWS + 1
            for r_index in range(min(sheet.nrows, limit)):
                encoded = []
                for c_index in range(sheet.ncols):
                    cell = sheet.cell(r_index, c_index)
                    if cell.ctype == xlrd.XL_CELL_ERROR:
                        encoded.append({"e": "erreur Excel " + xlrd.error_text_from_code.get(cell.value, "#ERR")})
                    elif cell.ctype == xlrd.XL_CELL_DATE:
                        try:
                            encoded.append(_encode_value(xlrd.xldate_as_datetime(cell.value, book.datemode)))
                        except Exception:
                            encoded.append({"e": "date Excel illisible"})
                    elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                        encoded.append({"b": bool(cell.value)})
                    elif cell.ctype == xlrd.XL_CELL_NUMBER:
                        encoded.append({"n": cell.value})
                    elif cell.ctype == xlrd.XL_CELL_TEXT:
                        encoded.append(_encode_value(cell.value))
                    else:
                        encoded.append(None)
                rows.append(_trim(encoded))
            overflow = any(
                sheet.cell(r_index, c_index).ctype not in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK)
                for r_index in range(limit, sheet.nrows) for c_index in range(sheet.ncols)
            )
            sheets.append({"name": sheet.name, "rows": _trim_rows(rows), "overflow": overflow})
        return sheets
    finally:
        book.release_resources()


def _trim_rows(rows: list[list[Any]]) -> list[list[Any]]:
    while rows and not rows[-1]:
        rows.pop()
    return rows


def read_workbook(file_name: str, content: bytes) -> dict[str, Any]:
    """Lit le classeur et renvoie {"sheets": [...]}. Lève ImportFileError avec un message clair."""
    lowered = str(file_name or "").lower()
    if not lowered.endswith(ALLOWED_EXTENSIONS):
        raise ImportFileError("Format non pris en charge : sélectionnez un fichier .xlsx ou .xls.")
    if not content:
        raise ImportFileError("Le fichier est vide.")
    if len(content) > MAX_FILE_BYTES:
        raise ImportFileError(f"Fichier trop volumineux (maximum {MAX_FILE_BYTES // (1024 * 1024)} Mo).")
    if content[:4] == b"PK\x03\x04":
        sheets = _read_xlsx(content)
    elif content[:8] == _OLE_MAGIC:
        if lowered.endswith(".xlsx") or _ENCRYPTED_STREAM in content:
            # Un .xlsx chiffré est un conteneur OLE : le contenu n'est pas lisible sans mot de passe.
            raise ImportFileError("Classeur protégé par mot de passe : retirez la protection avant l'import.")
        sheets = _read_xls(content)
    else:
        raise ImportFileError("Format incorrect : le contenu n'est pas celui d'un classeur Excel (.xlsx ou .xls).")
    if not sheets:
        raise ImportFileError("Le classeur ne contient aucune feuille visible.")
    return {"sheets": sheets}


# ── Structure des feuilles : en-têtes, colonnes, correspondance automatique ─────────────────
def column_letter(index: int) -> str:
    letters = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


def cell_display(cell: Any) -> str:
    if cell is None:
        return ""
    if isinstance(cell, dict):
        if "d" in cell:
            year, month, day = str(cell["d"]).split("-")
            return f"{day}/{month}/{year}"
        if "n" in cell:
            number = cell["n"]
            return str(int(number)) if float(number).is_integer() else repr(float(number))
        if "b" in cell:
            return "Oui" if cell["b"] else "Non"
        if "e" in cell:
            return f"[{cell['e']}]"
        return ""
    return str(cell).strip()


def _row_empty(row: list[Any]) -> bool:
    return not any(cell_display(cell) for cell in row)


def sheet_layout(sheet: dict[str, Any]) -> dict[str, Any]:
    """Ligne d'en-têtes (la plus riche en libellés reconnus parmi les premières lignes), colonnes
    et lignes de données. Une feuille marquée « ne pas importer » (feuilles d'aide du modèle)
    n'est jamais proposée."""
    rows = sheet["rows"]
    first_text = next((cell_display(cell) for row in rows for cell in row if cell_display(cell)), "")
    if NOT_IMPORTABLE_MARKER in norm_key(first_text):
        return {"importable": False, "reason": "Feuille d'aide du modèle", "header_row": None, "columns": [], "data_rows": []}
    best_index, best_score = None, -1
    for index, row in enumerate(rows[:HEADER_SCAN_ROWS]):
        if _row_empty(row):
            continue
        score = sum(1 for cell in row if isinstance(cell, str) and field_for_header(cell))
        if score > best_score:
            best_index, best_score = index, score
    if best_index is None:
        return {"importable": False, "reason": "Feuille vide", "header_row": None, "columns": [], "data_rows": []}
    header = rows[best_index]
    data_rows = [(index + 1, row) for index, row in enumerate(rows) if index > best_index and not _row_empty(row)]
    empty_rows = sum(1 for index, row in enumerate(rows) if index > best_index and _row_empty(row))
    width = max([len(header)] + [len(row) for _, row in data_rows])
    columns = []
    for c_index in range(width):
        label = cell_display(header[c_index]) if c_index < len(header) else ""
        samples = [cell_display(row[c_index]) for _, row in data_rows if c_index < len(row) and cell_display(row[c_index])]
        if not label and not samples:
            continue
        columns.append({"index": c_index, "letter": column_letter(c_index), "header": label, "samples": [value[:60] for value in samples[:3]]})
    reason = None
    if sheet.get("overflow") or len(data_rows) > MAX_ROWS:
        reason = f"Plus de {MAX_ROWS} lignes : scindez le fichier."
    elif len(columns) > MAX_COLUMNS:
        reason = f"Plus de {MAX_COLUMNS} colonnes."
    elif not data_rows:
        reason = "Aucune ligne de données sous les en-têtes"
    return {"importable": reason is None, "reason": reason, "header_row": best_index + 1, "columns": columns,
            "data_rows": data_rows, "empty_rows": empty_rows, "recognized": best_score}


def suggest_mapping(columns: list[dict[str, Any]]) -> dict[str, str | None]:
    """Correspondance automatique : un champ n'est proposé qu'une fois (première colonne)."""
    mapping: dict[str, str | None] = {}
    used: set[str] = set()
    for column in columns:
        key = field_for_header(column["header"])
        if key and key not in used:
            mapping[str(column["index"])] = key
            used.add(key)
        else:
            mapping[str(column["index"])] = None
    return mapping


def describe_workbook(workbook: dict[str, Any]) -> dict[str, Any]:
    sheets = []
    for index, sheet in enumerate(workbook["sheets"]):
        layout = sheet_layout(sheet)
        mapping = suggest_mapping(layout["columns"])
        sheets.append({
            "index": index, "name": sheet["name"], "importable": layout["importable"], "reason": layout["reason"],
            "header_row": layout["header_row"], "row_count": len(layout["data_rows"]),
            "columns": [{**column, "suggested": mapping.get(str(column["index"])),
                         "duplicate_of": _duplicate_header(column, layout["columns"], mapping)} for column in layout["columns"]],
        })
    importable = [sheet for sheet in sheets if sheet["importable"]]
    default = max(importable, key=lambda sheet: sum(1 for column in sheet["columns"] if column["suggested"]), default=None)
    return {"sheets": sheets, "default_sheet": default["index"] if default else None}


def _duplicate_header(column: dict[str, Any], columns: list[dict[str, Any]], mapping: dict[str, str | None]) -> str | None:
    key = field_for_header(column["header"])
    if not key or mapping.get(str(column["index"])):
        return None
    owner = next((other for other in columns if mapping.get(str(other["index"])) == key), None)
    return owner["letter"] if owner else None


def validate_mapping(layout: dict[str, Any], mapping: dict[str, Any]) -> dict[int, str]:
    """Correspondance choisie par l'utilisateur → {index de colonne: champ}. Refuse les
    correspondances contradictoires (un champ sur plusieurs colonnes) et l'absence d'un champ
    obligatoire."""
    known = {column["index"]: column for column in layout["columns"]}
    resolved: dict[int, str] = {}
    owners: dict[str, int] = {}
    for raw_index, key in (mapping or {}).items():
        if key in (None, "", "__ignore__"):
            continue
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Correspondance invalide : colonne inconnue.")
        if index not in known:
            raise HTTPException(status_code=422, detail="Correspondance invalide : colonne inconnue.")
        if key not in FIELD_BY_KEY:
            raise HTTPException(status_code=422, detail="Correspondance invalide : champ inconnu.")
        if key in owners:
            raise HTTPException(status_code=422, detail=(
                f"Correspondance contradictoire : le champ « {FIELD_BY_KEY[key].label} » est associé aux colonnes "
                f"{known[owners[key]]['letter']} et {known[index]['letter']}."))
        owners[key] = index
        resolved[index] = key
    missing = [FIELD_BY_KEY[key].label for key in REQUIRED_KEYS if key not in owners]
    if missing:
        raise HTTPException(status_code=422, detail="Champs obligatoires sans colonne associée : " + ", ".join(missing) + ".")
    return resolved


# ── Conversion et validation des cellules ───────────────────────────────────────────────────
def _text_of(cell: Any) -> str:
    if isinstance(cell, dict) and "e" in cell:
        raise _FieldError(f"Cellule inexploitable ({cell['e']})")
    return " ".join(cell_display(cell).split())


def _parse_date(cell: Any) -> tuple[str, str | None]:
    warning = None
    if isinstance(cell, dict) and "d" in cell:
        parsed = date.fromisoformat(cell["d"])
    elif isinstance(cell, dict) and "n" in cell:
        number = cell["n"]
        if not float(number).is_integer() or not 367 <= int(number) <= 73050:
            raise _FieldError(f"Date invalide : « {cell_display(cell)} » n'est pas une date")
        parsed = date(1899, 12, 30) + timedelta(days=int(number))
        warning = f"Nombre Excel {int(number)} interprété comme la date {parsed.strftime('%d/%m/%Y')} : vérifiez"
    else:
        raw = _text_of(cell)
        lowered = norm_key(raw)
        iso = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$", raw)
        dmy = re.match(r"^(\d{1,2})[\s/.\-](\d{1,2})[\s/.\-](\d{2,4})$", raw)
        named = re.match(r"^(\d{1,2})(?:er)? ([a-z]+) (\d{4})$", lowered)
        try:
            if iso:
                parsed = date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
            elif dmy:
                first, second, year = int(dmy.group(1)), int(dmy.group(2)), dmy.group(3)
                if len(year) != 4:
                    raise _FieldError(f"Date ambiguë : « {raw} » — année sur deux chiffres, saisir JJ/MM/AAAA")
                if second > 12 >= first:
                    raise _FieldError(f"Date « {raw} » au format mois/jour : saisir JJ/MM/AAAA")
                parsed = date(int(year), second, first)
                if first <= 12 and second <= 12 and first != second:
                    warning = f"Date ambiguë « {raw} » interprétée JJ/MM/AAAA ({parsed.strftime('%d/%m/%Y')}) : vérifiez"
            elif named and named.group(2) in _FRENCH_MONTHS:
                parsed = date(int(named.group(3)), _FRENCH_MONTHS[named.group(2)], int(named.group(1)))
            else:
                raise _FieldError(f"Date invalide : « {raw} » (format attendu JJ/MM/AAAA)")
        except ValueError:
            raise _FieldError(f"Date invalide : « {raw} » n'existe pas dans le calendrier")
    if parsed > date.today():
        raise _FieldError(f"Date de naissance dans le futur ({parsed.strftime('%d/%m/%Y')})")
    if parsed.year < 1930:
        raise _FieldError(f"Date de naissance invraisemblable ({parsed.strftime('%d/%m/%Y')})")
    return parsed.isoformat(), warning


def _parse_phone(cell: Any) -> tuple[str, str | None]:
    """Numéro algérien normalisé « 0XXXXXXXXX » (texte), ou international « +… »."""
    numeric = isinstance(cell, dict) and "n" in cell
    if numeric:
        if not float(cell["n"]).is_integer() or cell["n"] < 0:
            raise _FieldError(f"Téléphone invalide : « {cell_display(cell)} »")
        raw = str(int(cell["n"]))
    else:
        raw = _text_of(cell)
        if not re.fullmatch(r"[\d\s().\-/+]+", raw):
            raise _FieldError(f"Téléphone invalide : « {raw} »")
    digits = re.sub(r"\D", "", raw)
    international = raw.startswith("+") or digits.startswith("00")
    if digits.startswith("00"):
        digits = digits[2:]
    warning = None
    if digits.startswith("213") and (international or len(digits) in (11, 12)):
        local = "0" + digits[3:].lstrip("0")
    elif international:
        if not 8 <= len(digits) <= 15:
            raise _FieldError(f"Téléphone invalide : « {raw} »")
        return "+" + digits, None
    elif re.fullmatch(r"[5-7]\d{8}|[2-4]\d{7}", digits):
        local = "0" + digits
        origin = "cellule numérique" if numeric else "zéro absent"
        warning = f"Zéro initial manquant ({origin}) : numéro interprété {local}"
    else:
        local = digits
    if not re.fullmatch(r"0[5-7]\d{8}|0[2-4]\d{7}", local):
        raise _FieldError(f"Téléphone invalide : « {raw} » (attendu 0XXXXXXXXX ou +213…)")
    return local, warning


def _parse_email(cell: Any) -> str:
    from email_validator import EmailNotValidError, validate_email

    raw = _text_of(cell)
    try:
        return validate_email(raw, check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise _FieldError(f"E-mail invalide : « {raw} »")


def _parse_int(item: ImportField, cell: Any) -> int:
    raw = _text_of(cell)
    if isinstance(cell, dict) and "n" in cell:
        if not float(cell["n"]).is_integer():
            raise _FieldError(f"{item.label} : nombre entier attendu (« {raw} »)")
        number = int(cell["n"])
    elif re.fullmatch(r"\d{1,4}", raw):
        number = int(raw)
    else:
        raise _FieldError(f"{item.label} : nombre entier attendu (« {raw} »)")
    low, high = item.bounds or (0, 10**9)
    if not low <= number <= high:
        raise _FieldError(f"{item.label} : valeur {number} hors limites ({low}–{high})")
    return number


def _parse_money(cell: Any) -> float:
    if isinstance(cell, dict) and "n" in cell:
        amount = float(cell["n"])
    else:
        raw = _text_of(cell)
        cleaned = re.sub(r"(?i)\s|dzd|da", "", raw)
        if "," in cleaned:
            cleaned = cleaned.replace(".", "").replace(",", ".")
        if not re.fullmatch(r"\d+(\.\d{1,2})?", cleaned):
            raise _FieldError(f"Salaire invalide : « {raw} »")
        amount = float(cleaned)
    if not 0 < amount <= 100_000_000:
        raise _FieldError(f"Salaire hors limites : « {cell_display(cell)} »")
    return amount


def _parse_digits(item: ImportField, cell: Any) -> str:
    if isinstance(cell, dict) and "n" in cell:
        number = cell["n"]
        if not float(number).is_integer() or abs(number) >= 10**15:
            # Au-delà de 15 chiffres Excel a déjà arrondi le nombre : la valeur n'est plus fiable.
            raise _FieldError(f"{item.label} enregistré comme nombre : chiffres perdus par Excel, saisir la cellule au format Texte")
        raw = str(int(number))
    else:
        raw = re.sub(r"[\s.\-]", "", _text_of(cell))
    if not raw.isdigit():
        raise _FieldError(f"{item.label} invalide : « {cell_display(cell)} » (chiffres uniquement)")
    if item.kind == "nin" and len(raw) not in (10, 18):
        raise _FieldError("Le NIN doit contenir 10 ou 18 chiffres")
    if len(raw) > item.max_len:
        raise _FieldError(f"{item.label} trop long")
    return raw


def position_reference(db: Session) -> dict[str, str]:
    """Référentiel des postes (table positions, actifs) : clé normalisée → libellé."""
    from app.modules.irongs.routes import _get_postes

    _get_postes(db)                                   # même amorçage que /api/irongs/positions
    rows = db.execute(select(Position.name).where(Position.active.is_(True)).order_by(Position.name)).scalars().all()
    reference: dict[str, str] = {}
    for name in rows:
        reference.setdefault(norm_key(name), name)
    return reference


def convert_row(row: list[Any], mapping: dict[int, str], positions: dict[str, str]) -> tuple[dict[str, Any], list[dict], list[dict]]:
    """Ligne Excel → valeurs normalisées par champ, erreurs et avertissements."""
    values: dict[str, Any] = {}
    errors: list[dict] = []
    warnings: list[dict] = []

    def issue(bucket: list[dict], item: ImportField, message: str) -> None:
        bucket.append({"field": item.key, "label": item.label, "message": message})

    cells = {key: (row[index] if index < len(row) else None) for index, key in mapping.items()}
    for item in FIELDS:
        if item.key not in cells:
            continue
        cell = cells[item.key]
        try:
            if isinstance(cell, dict) and "e" in cell:
                raise _FieldError(f"Cellule inexploitable ({cell['e']})")
            if not cell_display(cell):
                continue
            if item.kind == "date":
                values[item.key], warning = _parse_date(cell)
                if warning:
                    issue(warnings, item, warning)
            elif item.kind == "phone":
                values[item.key], warning = _parse_phone(cell)
                if warning:
                    issue(warnings, item, warning)
            elif item.kind == "email":
                values[item.key] = _parse_email(cell)
            elif item.kind == "int":
                values[item.key] = _parse_int(item, cell)
            elif item.kind == "money":
                values[item.key] = _parse_money(cell)
            elif item.kind in ("nin", "digits"):
                values[item.key] = _parse_digits(item, cell)
            elif item.kind == "choice":
                resolved = resolve_choice(item, _text_of(cell))
                if resolved is None:
                    raise _FieldError(f"Valeur non reconnue : « {_text_of(cell)} » (attendu : {', '.join(item.choice_values())})")
                values[item.key] = resolved
            elif item.kind == "position":
                resolved = positions.get(norm_key(_text_of(cell)))
                if resolved is None:
                    raise _FieldError(f"Poste absent du référentiel : « {_text_of(cell)} » (liste des postes dans le modèle Excel)")
                values[item.key] = resolved
            elif item.kind == "wilaya":
                resolved_wilaya = resolve_wilaya(_text_of(cell))
                if resolved_wilaya is None:
                    raise _FieldError(f"Wilaya non reconnue : « {_text_of(cell)} »")
                values[item.key] = resolved_wilaya[1]
            elif item.kind == "commune":
                wilaya = resolve_wilaya(values["wilaya"]) if values.get("wilaya") else None
                resolved = resolve_commune(_text_of(cell), wilaya[0] if wilaya else None)
                if resolved is None:
                    where = f" dans la wilaya {values['wilaya']}" if wilaya else ""
                    raise _FieldError(f"Commune non reconnue{where} : « {_text_of(cell)} »")
                values[item.key] = resolved
            elif item.kind == "list":
                entries = [part.strip() for part in re.split(r"[,;/]", _text_of(cell)) if part.strip()]
                if len(entries) > 12 or any(len(entry) > 60 for entry in entries):
                    raise _FieldError(f"{item.label} : liste trop longue")
                values[item.key] = entries
            else:
                value = _text_of(cell)
                if len(value) > item.max_len:
                    raise _FieldError(f"{item.label} : texte trop long ({len(value)} caractères, maximum {item.max_len})")
                if item.kind == "name" and len(value) < 2:
                    raise _FieldError(f"{item.label} : au moins 2 caractères")
                values[item.key] = value
        except _FieldError as exc:
            issue(errors, item, str(exc))
    failed = {error["field"] for error in errors}
    for key in REQUIRED_KEYS:
        if key not in values and key not in failed:
            issue(errors, FIELD_BY_KEY[key], "Champ obligatoire absent")
    if not errors and not values.get("phone") and not values.get("email"):
        issue(warnings, FIELD_BY_KEY["phone"], "Aucun téléphone ni e-mail : candidat difficile à recontacter")
    return values, errors, warnings


def build_payload(values: dict[str, Any], *, file_name: str, sheet_name: str, row_number: int, session_id: str) -> dict[str, Any]:
    """Valeurs normalisées → charge utile de `CandidateCreate`, avec les valeurs par défaut du
    recrutement : statut initial « nouvelle », dossier non ventilé (vivier Groupe)."""
    payload: dict[str, Any] = {"status": "nouvelle", "society": None}
    data: dict[str, Any] = {"importSource": file_name, "importSheet": sheet_name, "importRow": row_number, "importSessionId": session_id}
    for key, value in values.items():
        item = FIELD_BY_KEY[key]
        if item.column:
            payload[item.column] = value
        if item.data_key:
            data[item.data_key] = str(value) if key in ("height", "shoe_size") else value
    payload["data"] = data
    return payload


def _server_validation_error(payload: dict[str, Any]) -> dict | None:
    """Rejoue les règles serveur du formulaire candidat (nom/prénom, NIN, âge minimal)."""
    try:
        service._candidate_values(CandidateCreate(**{**payload, "data": dict(payload["data"])}))
    except HTTPException as exc:
        detail = str(exc.detail)
        key = "nin" if "NIN" in detail else "birth_date" if ("20 ans" in detail or "naissance" in detail) else "last_name"
        return {"field": key, "label": FIELD_BY_KEY[key].label, "message": detail}
    except Exception:  # validation Pydantic (types) : jamais attendu après conversion
        return {"field": "last_name", "label": "Fiche", "message": "Données refusées par la validation de la fiche candidat"}
    return None


# ── Doublons ────────────────────────────────────────────────────────────────────────────────
REASON_LABELS = {"telephone": "même téléphone", "email": "même e-mail", "identite": "même nom, prénom et date de naissance", "nin": "même NIN"}


def _candidate_state(row: Candidate) -> str:
    if service._candidate_is_recruited(row):
        return "Recruté"
    if service._candidate_is_transmitted(row):
        return "Transmis à la DRH"
    if service._candidate_is_archived(row):
        return "Archivé"
    if service._candidate_is_reserve(row):
        return "Réserve"
    return "Nouvelle candidature"


def _phone_key(value: Any) -> str:
    key = service._normalized_contact_phone(value)
    return key if len(key) >= 8 else ""


class DuplicateIndex:
    """Index des fiches existantes, construit une fois par analyse. Les candidats du vivier
    Recrutement sont visibles de tout recruteur (règle existante du vivier Groupe) ; un dossier
    sorti du recrutement ou un salarié n'est détaillé que dans le périmètre société du compte."""

    def __init__(self, db: Session, user: Any):
        self.scope = society_scope(user)
        self.by: dict[str, dict[str, list[tuple[str, int]]]] = {"telephone": {}, "email": {}, "identite": {}, "nin": {}}
        self.candidates: dict[int, Candidate] = {}
        self.employees: dict[int, Employee] = {}
        for row in db.execute(select(Candidate)).scalars().all():
            self.add_candidate(row)
        for row in db.execute(select(Employee)).scalars().all():
            self.employees[row.id] = row
            extra = row.extra if isinstance(row.extra, dict) else {}
            self._index(("salarie", row.id), phone=row.phone, email=row.email, nin=row.nin,
                        identity=service._candidate_identity_key(row.first_name, row.last_name, row.birth_date or extra.get("dateNaissance")))

    def add_candidate(self, row: Candidate) -> None:
        data = row.data if isinstance(row.data, dict) else {}
        self.candidates[row.id] = row
        self._index(("candidat", row.id), phone=row.phone, email=row.email, nin=data.get("nin"),
                    identity=service._candidate_identity_key(row.first_name, row.last_name, data.get("dateNaissance")))

    def _index(self, ref: tuple[str, int], *, phone: Any, email: Any, nin: Any, identity: tuple[str, str, str]) -> None:
        keys = {"telephone": _phone_key(phone), "email": str(email or "").strip().lower(), "nin": str(nin or "").strip(),
                "identite": "|".join(identity) if identity[2] and identity[0] and identity[1] else ""}
        for reason, key in keys.items():
            if key:
                self.by[reason].setdefault(key, []).append(ref)

    @staticmethod
    def keys_of(values: dict[str, Any]) -> dict[str, str]:
        identity = service._candidate_identity_key(values.get("first_name"), values.get("last_name"), values.get("birth_date"))
        return {"telephone": _phone_key(values.get("phone")), "email": str(values.get("email") or "").strip().lower(),
                "nin": str(values.get("nin") or "").strip(),
                "identite": "|".join(identity) if identity[2] and identity[0] and identity[1] else ""}

    def _in_scope(self, society: Any) -> bool:
        return self.scope.kind is ScopeKind.GLOBAL or not str(society or "").strip() or self.scope.allows(society)

    def matches(self, values: dict[str, Any]) -> list[dict[str, Any]]:
        found: dict[tuple[str, int], list[str]] = {}
        for reason, key in self.keys_of(values).items():
            for ref in self.by[reason].get(key, []) if key else []:
                found.setdefault(ref, []).append(reason)
        result = []
        for (kind, row_id), reasons in sorted(found.items()):
            if kind == "candidat":
                row = self.candidates[row_id]
                in_recruitment = not service._candidate_left_recruitment(row)
                visible = in_recruitment or self._in_scope(row.society)
                updatable = in_recruitment and not service._candidate_is_archived(row) and self._in_scope(row.society)
                state = _candidate_state(row)
            else:
                row = self.employees[row_id]
                visible = self.scope.kind is ScopeKind.GLOBAL or self.scope.allows(row.society)
                updatable, state = False, "Salarié"
            entry: dict[str, Any] = {"type": kind, "reasons": reasons, "visible": visible, "updatable": updatable, "_id": row_id}
            if visible:
                entry.update({"id": row_id, "name": f"{row.last_name or ''} {row.first_name or ''}".strip(),
                              "society": row.society or None, "state": state})
            result.append(entry)
        return result


def _signature(matches: list[dict[str, Any]], internal: list[int]) -> str:
    raw = ";".join(f"{match['type']}:{match['_id']}:{','.join(sorted(match['reasons']))}" for match in matches)
    raw += "|" + ",".join(str(number) for number in sorted(internal))
    return hashlib.sha1(raw.encode()).hexdigest()[:16] if (matches or internal) else ""


def _existing_value(row: Candidate, item: ImportField) -> Any:
    data = row.data if isinstance(row.data, dict) else {}
    if item.column:
        return getattr(row, item.column)
    return data.get(item.data_key)


def _same(item: ImportField, old: Any, new: Any) -> bool:
    if item.kind == "list":
        old_list = old if isinstance(old, list) else [part.strip() for part in str(old or "").split(",") if part.strip()]
        return [norm_key(value) for value in old_list] == [norm_key(value) for value in new]
    if item.kind == "money":
        try:
            return abs(float(old or 0) - float(new)) < 0.005
        except (TypeError, ValueError):
            return False
    if item.kind == "phone":
        return service._normalized_contact_phone(old) == service._normalized_contact_phone(new)
    return norm_key(old) == norm_key(new)


def update_changes(row: Candidate, values: dict[str, Any]) -> list[dict[str, Any]]:
    """Différences qu'apporterait la ligne à une fiche existante. Seules les cellules renseignées
    comptent : une cellule vide ne remplace jamais une valeur existante."""
    changes = []
    for key, new in values.items():
        item = FIELD_BY_KEY[key]
        old = _existing_value(row, item)
        if _same(item, old, new):
            continue
        show = lambda value: ", ".join(value) if isinstance(value, list) else ("" if value is None else str(value))
        if item.kind == "date":
            show = lambda value: "/".join(reversed(str(value)[:10].split("-"))) if value else ""
        changes.append({"field": key, "label": item.label, "old": show(old), "new": show(new)})
    return changes


# ── Analyse (prévisualisation et revalidation à la confirmation) ───────────────────────────
def user_can(user: Any, action: str) -> bool:
    """Même règle que `current_user` : une liste d'actions vide ne restreint pas le compte."""
    from app.modules.auth.routes import is_admin_role

    if is_admin_role(getattr(user, "role", None)):
        return True
    actions = {str(value).strip().lower() for value in (getattr(user, "authorized_actions", None) or [])}
    return not actions or action in actions or "admin" in actions


def analyze(db: Session, user: Any, session: CandidateImportSession, sheet_index: int, mapping: dict[str, Any]) -> dict[str, Any]:
    workbook = session.workbook or {}
    sheets = workbook.get("sheets") or []
    if not 0 <= int(sheet_index) < len(sheets):
        raise HTTPException(status_code=422, detail="Feuille inconnue.")
    sheet = sheets[int(sheet_index)]
    layout = sheet_layout(sheet)
    if not layout["importable"]:
        raise HTTPException(status_code=422, detail=f"Feuille « {sheet['name']} » non importable : {layout['reason']}.")
    resolved = validate_mapping(layout, mapping)
    positions = position_reference(db)
    index = DuplicateIndex(db, user)
    can_update = user_can(user, "update")
    rows: list[dict[str, Any]] = []
    seen: dict[str, dict[str, int]] = {"telephone": {}, "email": {}, "identite": {}, "nin": {}}
    for row_number, raw in layout["data_rows"]:
        values, errors, warnings = convert_row(raw, resolved, positions)
        payload = None
        if not errors:
            payload = build_payload(values, file_name=session.file_name, sheet_name=sheet["name"], row_number=row_number,
                                    session_id=session.public_id)
            server_error = _server_validation_error(payload)
            if server_error:
                errors.append(server_error)
        entry: dict[str, Any] = {"row": row_number, "values": _display_values(values), "errors": errors, "warnings": warnings,
                                 "matches": [], "internal": [], "changes": [], "update_target": None}
        if errors:
            entry.update({"status": "error", "actions": [], "default_action": None, "signature": "", "_values": values, "_payload": None})
            rows.append(entry)
            continue
        matches = index.matches(values)
        internal: dict[int, list[str]] = {}
        for reason, key in DuplicateIndex.keys_of(values).items():
            if not key:
                continue
            if key in seen[reason]:
                internal.setdefault(seen[reason][key], []).append(reason)
            else:
                seen[reason][key] = row_number
        entry["internal"] = [{"row": number, "reasons": reasons} for number, reasons in sorted(internal.items())]
        entry["matches"] = matches
        entry["signature"] = _signature(matches, list(internal))
        entry["_values"], entry["_payload"] = values, payload
        if matches or internal:
            actions = ["skip", "create"]
            if can_update and not internal and len(matches) == 1 and matches[0]["type"] == "candidat" and matches[0]["updatable"]:
                target = index.candidates[matches[0]["_id"]]
                changes = update_changes(target, values)
                if changes:
                    actions.append("update")
                    entry["changes"], entry["update_target"] = changes, target.id
            entry.update({"status": "duplicate", "actions": actions, "default_action": "skip",
                          "ambiguous": len(matches) + len(internal) > 1})
        else:
            entry.update({"status": "valid", "actions": ["create"], "default_action": "create"})
        rows.append(entry)
    counts = {"analyzed": len(rows), "valid": sum(row["status"] == "valid" for row in rows),
              "duplicates": sum(row["status"] == "duplicate" for row in rows),
              "errors": sum(row["status"] == "error" for row in rows),
              "warnings": sum(bool(row["warnings"]) for row in rows), "empty_rows": layout.get("empty_rows", 0)}
    return {"sheet": {"index": int(sheet_index), "name": sheet["name"], "header_row": layout["header_row"]},
            "mapping": {str(column): key for column, key in resolved.items()},
            "ignored_columns": [column["letter"] + (f" ({column['header']})" if column["header"] else "")
                                for column in layout["columns"] if column["index"] not in resolved],
            "counts": counts, "rows": rows, "can_update": can_update}


def _display_values(values: dict[str, Any]) -> dict[str, str]:
    shown = {}
    for key, value in values.items():
        if FIELD_BY_KEY[key].kind == "date":
            shown[key] = "/".join(reversed(str(value).split("-")))
        elif isinstance(value, list):
            shown[key] = ", ".join(value)
        elif isinstance(value, float):
            shown[key] = str(int(value)) if value.is_integer() else f"{value:.2f}"
        else:
            shown[key] = str(value)
    return shown


def public_analysis(analysis: dict[str, Any]) -> dict[str, Any]:
    """Analyse sans les champs internes (identifiants masqués des fiches hors périmètre)."""
    rows = []
    for row in analysis["rows"]:
        clean = {key: value for key, value in row.items() if not key.startswith("_") and key != "signature"}
        clean["matches"] = [{key: value for key, value in match.items() if not key.startswith("_")} for match in row["matches"]]
        rows.append(clean)
    return {**analysis, "rows": rows}


# ── Sessions ────────────────────────────────────────────────────────────────────────────────
def scope_fingerprint(user: Any) -> tuple[str, str]:
    scope = society_scope(user)
    if scope.kind is ScopeKind.GLOBAL:
        return hashlib.sha256(b"GLOBAL").hexdigest(), "Toutes sociétés"
    labels = authorized_society_values(user)
    return hashlib.sha256("|".join(sorted(scope.societies)).encode()).hexdigest(), ", ".join(labels)[:150]


def purge_sessions(db: Session, *, now: datetime | None = None) -> None:
    """Efface le contenu des sessions expirées et supprime les traces anciennes."""
    now = now or datetime.utcnow()
    db.execute(update(CandidateImportSession)
               .where(CandidateImportSession.status.in_(("uploaded", "previewed")), CandidateImportSession.expires_at < now)
               .values(status="expired", workbook=None, plan=None))
    # Une confirmation interrompue (processus arrêté) n'a rien créé : la session est close.
    db.execute(update(CandidateImportSession)
               .where(CandidateImportSession.status == "processing", CandidateImportSession.updated_at < now - timedelta(minutes=SESSION_TTL_MINUTES))
               .values(status="failed", workbook=None, plan=None))
    db.execute(delete(CandidateImportSession).where(CandidateImportSession.created_at < now - timedelta(days=RESULT_RETENTION_DAYS)))


def create_session(db: Session, user: Any, *, file_name: str, content: bytes, request: Any = None) -> CandidateImportSession:
    clean_name = re.sub(r"[\x00-\x1f]", "", str(file_name or "import.xlsx").replace("\\", "/").split("/")[-1])[:255] or "import.xlsx"
    scope_key, scope_label = scope_fingerprint(user)
    try:
        workbook = read_workbook(clean_name, content)
    except ImportFileError as exc:
        append_audit(db, action="recruitment.candidates.import.analyze", resource="candidate_import", result="refused", user=user,
                     request=request, society=scope_label, new_state={"file_name": clean_name, "size": len(content), "reason": str(exc)})
        db.commit()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    purge_sessions(db)
    # Une seule analyse en attente par utilisateur : la précédente est abandonnée et vidée.
    db.execute(update(CandidateImportSession)
               .where(CandidateImportSession.user_id == user.id, CandidateImportSession.status.in_(("uploaded", "previewed")))
               .values(status="cancelled", workbook=None, plan=None))
    session = CandidateImportSession(
        public_id=secrets.token_hex(24), user_id=user.id, username=user.username, scope_key=scope_key, scope_label=scope_label,
        file_name=clean_name, file_sha256=hashlib.sha256(content).hexdigest(), file_size=len(content), status="uploaded",
        workbook=workbook, expires_at=datetime.utcnow() + timedelta(minutes=SESSION_TTL_MINUTES))
    db.add(session)
    append_audit(db, action="recruitment.candidates.import.analyze", resource="candidate_import", resource_id=session.public_id,
                 result="success", user=user, request=request, society=scope_label,
                 new_state={"file_name": clean_name, "size": len(content), "sheets": len(workbook["sheets"])})
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, user: Any, public_id: str, *, statuses: tuple[str, ...] | None = None) -> CandidateImportSession:
    """Session de l'utilisateur courant uniquement, dans le périmètre de son analyse."""
    session = db.execute(select(CandidateImportSession).where(CandidateImportSession.public_id == str(public_id))).scalar_one_or_none()
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session d'import introuvable.")
    if session.scope_key != scope_fingerprint(user)[0]:
        raise HTTPException(status_code=409, detail="Votre périmètre a changé depuis l'analyse : relancez l'import.")
    if session.status in ("uploaded", "previewed") and session.expires_at < datetime.utcnow():
        session.status, session.workbook, session.plan = "expired", None, None
        db.commit()
    if statuses and session.status not in statuses:
        messages = {"expired": "Session d'import expirée : sélectionnez à nouveau le fichier.",
                    "cancelled": "Import annulé : sélectionnez à nouveau le fichier.",
                    "completed": "Cet import a déjà été confirmé.", "processing": "Import déjà en cours de traitement.",
                    "failed": "Cet import a échoué : sélectionnez à nouveau le fichier.",
                    "uploaded": "Vérifiez d'abord les données avant de confirmer."}
        raise HTTPException(status_code=410 if session.status in ("expired", "cancelled", "failed") else 409,
                            detail=messages.get(session.status, "Session d'import indisponible."))
    return session


def preview(db: Session, user: Any, session: CandidateImportSession, sheet_index: int, mapping: dict[str, Any]) -> dict[str, Any]:
    analysis = analyze(db, user, session, sheet_index, mapping)
    session.plan = {"sheet": analysis["sheet"]["index"], "sheet_name": analysis["sheet"]["name"], "mapping": analysis["mapping"],
                    "signatures": {str(row["row"]): ERROR_SIGNATURE if row["status"] == "error" else row["signature"] for row in analysis["rows"]},
                    "targets": {str(row["row"]): row["update_target"] for row in analysis["rows"] if row["update_target"]}}
    session.status = "previewed"
    session.expires_at = datetime.utcnow() + timedelta(minutes=SESSION_TTL_MINUTES)
    db.commit()
    return public_analysis(analysis)


def cancel(db: Session, session: CandidateImportSession) -> None:
    if session.status in ("uploaded", "previewed"):
        session.status, session.workbook, session.plan = "cancelled", None, None
        db.commit()


# ── Confirmation ────────────────────────────────────────────────────────────────────────────
ERROR_SIGNATURE = "!"            # ligne en erreur lors de la vérification
OUTCOME_LABELS = {"created": "Créé", "updated": "Mis à jour", "skipped": "Doublon ignoré", "error": "Erreur de données", "failed": "Échec"}


def confirm(db: Session, user: Any, public_id: str, decisions: dict[str, Any], *, request: Any = None) -> dict[str, Any]:
    """Confirme l'import. Idempotent : la session passe de « previewed » à « processing » par une
    mise à jour atomique ; un second appel (double clic, nouvelle tentative) ne crée rien et
    renvoie le résultat déjà enregistré."""
    session = get_session(db, user, public_id)
    if session.status == "completed":
        return {**(session.result or {}), "already_processed": True}
    get_session(db, user, public_id, statuses=("previewed",))
    session_id = session.id
    claimed = db.execute(update(CandidateImportSession)
                         .where(CandidateImportSession.id == session_id, CandidateImportSession.status == "previewed")
                         .values(status="processing", updated_at=datetime.utcnow())).rowcount
    db.commit()
    if not claimed:
        db.expire_all()
        current = db.get(CandidateImportSession, session_id)
        if current.status == "completed":
            return {**(current.result or {}), "already_processed": True}
        raise HTTPException(status_code=409, detail="Import déjà en cours de traitement.")
    db.expire_all()
    session = db.get(CandidateImportSession, session_id)
    try:
        result = _apply(db, user, session, decisions or {}, request=request)
        db.commit()
        return result
    except Exception:
        db.rollback()
        failed = db.get(CandidateImportSession, session_id)
        failed.status, failed.workbook, failed.plan = "failed", None, None
        append_audit(db, action="recruitment.candidates.import", resource="candidate_import", resource_id=failed.public_id,
                     result="failed", user=user, request=request, society=failed.scope_label, new_state={"file_name": failed.file_name})
        db.commit()
        logger.exception("candidate import failed session=%s", failed.public_id)
        raise HTTPException(status_code=500, detail="L'import a échoué : aucune fiche n'a été créée. Relancez l'import.")


def _decision(decisions: dict[str, Any], row_number: int) -> str:
    raw = decisions.get(str(row_number))
    action = raw.get("action") if isinstance(raw, dict) else raw
    return action if action in ("create", "update", "skip") else "skip"


def _apply(db: Session, user: Any, session: CandidateImportSession, decisions: dict[str, Any], *, request: Any) -> dict[str, Any]:
    if db.get_bind().dialect.name == "postgresql":
        # Deux imports concurrents ne peuvent pas créer les mêmes personnes : sérialisation.
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _ADVISORY_LOCK_KEY})
    plan = session.plan or {}
    analysis = analyze(db, user, session, plan.get("sheet", 0), plan.get("mapping") or {})   # revalidation complète
    signatures, targets = plan.get("signatures") or {}, plan.get("targets") or {}
    can_create, can_update = user_can(user, "create"), user_can(user, "update")
    counts = {"analyzed": len(analysis["rows"]), "created": 0, "updated": 0, "skipped": 0, "errors": 0, "failed": 0,
              "empty_rows": analysis["counts"]["empty_rows"]}
    report: list[dict[str, Any]] = []
    updated_targets: dict[int, int] = {}

    def record(row: dict[str, Any], outcome: str, reason: str = "", field: str = "", candidate_id: int | None = None) -> None:
        key = "errors" if outcome == "error" else outcome
        counts[key] += 1
        report.append({"row": row["row"], "outcome": outcome, "field": field, "reason": reason, "candidate_id": candidate_id})

    for row in analysis["rows"]:
        if row["status"] == "error":
            for index, error in enumerate(row["errors"]):
                if index == 0:
                    record(row, "error", error["message"], error["label"])
                else:
                    report.append({"row": row["row"], "outcome": "error", "field": error["label"], "reason": error["message"], "candidate_id": None})
            continue
        decision = "create"
        if row["status"] == "duplicate":
            decision = _decision(decisions, row["row"])
            previous = signatures.get(str(row["row"]))
            reasons = _duplicate_reason(row)
            if previous == "":
                record(row, "skipped", "Doublon apparu depuis la vérification (création concurrente) : " + reasons)
                continue
            if decision != "skip" and previous != row["signature"]:
                record(row, "skipped", "Les correspondances ont changé depuis la vérification : ligne ignorée")
                continue
            if decision == "skip":
                record(row, "skipped", reasons)
                continue
        elif signatures.get(str(row["row"])) != "":
            # La ligne n'était pas « valide » lors de la vérification (erreur ou doublon disparu
            # depuis) : rien n'est créé sans que l'utilisateur l'ait vu tel quel.
            record(row, "skipped", "L'état de la ligne a changé depuis la vérification : relancez l'import pour cette ligne")
            continue
        try:
            with db.begin_nested():
                if decision == "update":
                    target_id = row.get("update_target")
                    if not can_update:
                        raise HTTPException(status_code=403, detail="Mise à jour non autorisée pour votre compte")
                    if not target_id or "update" not in row["actions"] or targets.get(str(row["row"])) != target_id:
                        raise HTTPException(status_code=409, detail="Mise à jour impossible : la fiche cible a changé ou la correspondance est ambiguë")
                    if target_id in updated_targets:
                        raise HTTPException(status_code=409, detail=f"Fiche déjà mise à jour par la ligne {updated_targets[target_id]}")
                    target = service._locked_candidate(db, target_id)
                    changes = update_changes(target, row["_values"])
                    # CandidateUpdate ne met pas en majuscules : même forme qu'à la création.
                    columns = {FIELD_BY_KEY[change["field"]].column: (
                                   row["_values"][change["field"]].upper() if FIELD_BY_KEY[change["field"]].column in _UPPERCASE_FIELDS
                                   else row["_values"][change["field"]])
                               for change in changes if FIELD_BY_KEY[change["field"]].column}
                    data = dict(target.data) if isinstance(target.data, dict) else {}
                    for change in changes:
                        item = FIELD_BY_KEY[change["field"]]
                        if item.data_key:
                            value = row["_values"][change["field"]]
                            data[item.data_key] = str(value) if change["field"] in ("height", "shoe_size") else value
                    data["lastImportUpdate"] = {"source": session.file_name, "row": row["row"], "sessionId": session.public_id}
                    service.update_candidate(db, target_id, CandidateUpdate(**columns, data=data), username=user.username, actor=user, commit=False)
                    updated_targets[target_id] = row["row"]
                    record(row, "updated", ", ".join(change["label"] for change in changes), candidate_id=target_id)
                else:
                    if not can_create:
                        raise HTTPException(status_code=403, detail="Création non autorisée pour votre compte")
                    payload = {**row["_payload"], "data": dict(row["_payload"]["data"])}
                    if row["status"] == "duplicate":
                        # Création malgré une correspondance : choix explicite, tracé sur la fiche
                        # (même marqueur que la fiche manuelle pour les enregistrements ultérieurs).
                        payload["data"]["allowDuplicate"] = True
                        payload["data"]["importDuplicateOverride"] = {"by": user.username, "reason": _duplicate_reason(row)[:300]}
                    created = service.create_candidate(db, CandidateCreate(**payload), username=user.username, commit=False, check_duplicates=False)
                    record(row, "created", "Création malgré correspondance" if row["status"] == "duplicate" else "", candidate_id=created.id)
        except HTTPException as exc:
            record(row, "failed", str(exc.detail))
        except Exception:
            logger.exception("candidate import row failed session=%s row=%s", session.public_id, row["row"])
            record(row, "failed", "Erreur interne lors de l'enregistrement")
    result = {"session_id": session.public_id, "file_name": session.file_name, "sheet": analysis["sheet"]["name"],
              "counts": counts, "rows": report, "completed_at": datetime.utcnow().isoformat(), "already_processed": False}
    session.status, session.result, session.completed_at = "completed", result, datetime.utcnow()
    session.workbook = None                                # contenu du fichier effacé dès la fin du traitement
    session.plan = {"sheet_name": analysis["sheet"]["name"]}
    append_audit(db, action="recruitment.candidates.import", resource="candidate_import", resource_id=session.public_id,
                 result="success", user=user, request=request, society=session.scope_label,
                 new_state={"file_name": session.file_name, "file_sha256": session.file_sha256, "sheet": analysis["sheet"]["name"], **counts})
    logger.info("candidate import session=%s user=%s created=%s updated=%s skipped=%s errors=%s failed=%s", session.public_id,
                user.username, counts["created"], counts["updated"], counts["skipped"], counts["errors"], counts["failed"])
    return result


def _duplicate_reason(row: dict[str, Any]) -> str:
    parts = []
    for match in row["matches"]:
        reasons = ", ".join(REASON_LABELS[reason] for reason in match["reasons"])
        if match["visible"]:
            kind = "salarié" if match["type"] == "salarie" else "dossier"
            parts.append(f"{kind} n° {match['id']} ({reasons})")
        else:
            parts.append(f"fiche hors de votre périmètre ({reasons})")
    for internal in row["internal"]:
        parts.append(f"ligne {internal['row']} du fichier ({', '.join(REASON_LABELS[reason] for reason in internal['reasons'])})")
    return "Doublon : " + " ; ".join(parts)


# ── Modèle Excel et rapport ─────────────────────────────────────────────────────────────────
def neutralize(value: Any) -> Any:
    """Empêche qu'une valeur exportée soit interprétée comme une formule par le tableur."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def build_template(db: Session) -> bytes:
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation

    positions = sorted(position_reference(db).values(), key=norm_key)
    book = Workbook()
    sheet = book.active
    sheet.title = "Candidats"
    lists = book.create_sheet("Listes")
    example = book.create_sheet("Exemple")
    notes = book.create_sheet("Instructions")
    required_fill, header_fill = PatternFill("solid", fgColor="B45309"), PatternFill("solid", fgColor="043970")
    header_font = Font(bold=True, color="FFFFFF", size=10)

    lists["A1"] = "LISTES DE RÉFÉRENCE — ne pas importer cette feuille"
    lists["A1"].font = Font(bold=True, color="B45309")
    list_ranges: dict[str, str] = {}
    list_columns = [(item.key, item.label, item.choice_values()) for item in FIELDS if item.kind == "choice"]
    list_columns += [("wilaya", "Wilaya", [name for _, name in WILAYAS]), ("desired_position", "Poste souhaité", positions)]
    for column, (key, label, values) in enumerate(list_columns, start=1):
        letter = get_column_letter(column)
        lists.cell(row=3, column=column, value=label).font = Font(bold=True)
        for offset, value in enumerate(values, start=4):
            lists.cell(row=offset, column=column, value=value)
        lists.column_dimensions[letter].width = 28
        if values:
            list_ranges[key] = f"'Listes'!${letter}$4:${letter}${3 + len(values)}"

    def write_headers(target, row_index: int) -> None:
        for column, item in enumerate(FIELDS, start=1):
            cell = target.cell(row=row_index, column=column, value=item.label + (" *" if item.required else ""))
            cell.font, cell.fill = header_font, required_fill if item.required else header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            target.column_dimensions[get_column_letter(column)].width = item.width
            if item.hint or item.required:
                cell.comment = Comment(("Obligatoire. " if item.required else "") + item.hint, "ATLAS")
        target.row_dimensions[row_index].height = 30

    write_headers(sheet, 1)
    sheet.freeze_panes = "A2"
    for column, item in enumerate(FIELDS, start=1):
        letter = get_column_letter(column)
        if item.text_format:
            for row_index in range(2, MAX_ROWS + 2):
                sheet.cell(row=row_index, column=column).number_format = "@"
        if item.key == "birth_date":
            for row_index in range(2, MAX_ROWS + 2):
                sheet.cell(row=row_index, column=column).number_format = "DD/MM/YYYY"
        if item.key in list_ranges:
            validation = DataValidation(type="list", formula1=list_ranges[item.key], allow_blank=True, showErrorMessage=True,
                                        errorTitle="Valeur non autorisée", error="Choisissez une valeur de la liste.")
            sheet.add_data_validation(validation)
            validation.add(f"{letter}2:{letter}{MAX_ROWS + 1}")

    example["A1"] = "EXEMPLE — ne pas importer cette feuille. Saisissez vos candidats dans la feuille « Candidats »."
    example["A1"].font = Font(bold=True, color="B45309")
    write_headers(example, 3)
    for column, item in enumerate(FIELDS, start=1):
        value = positions[0] if item.key == "desired_position" and positions else item.example
        cell = example.cell(row=4, column=column, value=value)
        cell.number_format = "@"
        cell.font = Font(italic=True, color="64748B")

    lines = [
        "INSTRUCTIONS — ne pas importer cette feuille",
        "",
        "1. Saisissez un candidat par ligne dans la feuille « Candidats », à partir de la ligne 2.",
        "2. Les colonnes marquées * (en-tête orange) sont obligatoires : Nom et Prénom.",
        "3. Téléphones, NIN et N° CNAS : cellules au format Texte, pour conserver le zéro initial (0555123456 ou +213 555 12 34 56).",
        "4. Dates au format JJ/MM/AAAA (ex. 15/03/1990).",
        "5. Sexe, situation familiale, groupe sanguin, disponibilité, service militaire, taille de chemise, wilaya et poste : "
        "choisissez une valeur de la liste déroulante (feuille « Listes »).",
        "6. La commune doit appartenir à la wilaya indiquée.",
        "7. Vous pouvez supprimer les colonnes inutiles ; ne renommez pas les en-têtes.",
        f"8. Limites : {MAX_ROWS} lignes et {MAX_FILE_BYTES // (1024 * 1024)} Mo par fichier, formats .xlsx ou .xls.",
        "9. Les candidats importés arrivent dans « Nouvelles candidatures », non ventilés (vivier Groupe).",
        "10. Les doublons (même téléphone, e-mail ou nom + prénom + date de naissance) sont ignorés par défaut.",
    ]
    for row_index, line in enumerate(lines, start=1):
        notes.cell(row=row_index, column=1, value=line)
    notes["A1"].font = Font(bold=True, color="B45309")
    notes.column_dimensions["A"].width = 120
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def build_report(session: CandidateImportSession, rows: list[dict[str, Any]], counts: dict[str, Any]) -> bytes:
    """Rapport téléchargeable : numéros de lignes et motifs, sans contenu personnel du fichier."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    book = Workbook()
    sheet = book.active
    sheet.title = "Rapport d'import"
    summary = [("Fichier", session.file_name), ("Feuille", (session.plan or {}).get("sheet_name") or ""),
               ("Importé par", session.username or ""), ("Date", (session.completed_at or datetime.utcnow()).strftime("%d/%m/%Y %H:%M") + " UTC"),
               ("Lignes analysées", counts.get("analyzed", 0)), ("Candidats créés", counts.get("created", 0)),
               ("Fiches mises à jour", counts.get("updated", 0)), ("Doublons ignorés", counts.get("skipped", 0)),
               ("Lignes en erreur", counts.get("errors", 0)), ("Échecs d'enregistrement", counts.get("failed", 0))]
    for row_index, (label, value) in enumerate(summary, start=1):
        sheet.cell(row=row_index, column=1, value=label).font = Font(bold=True)
        cell = sheet.cell(row=row_index, column=2, value=neutralize(value))
        if isinstance(value, str):
            cell.data_type = "s"
    header_row = len(summary) + 2
    for column, label in enumerate(("Feuille", "Ligne Excel", "Résultat", "Champ", "Motif", "N° dossier"), start=1):
        cell = sheet.cell(row=header_row, column=column, value=label)
        cell.font, cell.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="043970")
    sheet_name = (session.plan or {}).get("sheet_name") or ""
    for offset, row in enumerate(rows, start=1):
        line = [sheet_name, row["row"], OUTCOME_LABELS.get(row["outcome"], row["outcome"]), row.get("field") or "",
                row.get("reason") or "", row.get("candidate_id") or ""]
        for column, value in enumerate(line, start=1):
            cell = sheet.cell(row=header_row + offset, column=column, value=neutralize(value))
            if isinstance(value, str):
                cell.data_type = "s"                    # jamais de formule, même si la valeur commence par « = »
    for letter, width in zip("ABCDEF", (22, 12, 18, 24, 90, 12)):
        sheet.column_dimensions[letter].width = width
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def report_rows(db: Session, user: Any, session: CandidateImportSession) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Après confirmation : résultat enregistré. Avant : anomalies de la vérification en cours."""
    if session.status == "completed":
        result = session.result or {}
        return result.get("rows") or [], result.get("counts") or {}
    if session.status != "previewed":
        raise HTTPException(status_code=409, detail="Aucun rapport disponible pour cet import.")
    plan = session.plan or {}
    analysis = analyze(db, user, session, plan.get("sheet", 0), plan.get("mapping") or {})
    rows = []
    for row in analysis["rows"]:
        for error in row["errors"]:
            rows.append({"row": row["row"], "outcome": "error", "field": error["label"], "reason": error["message"], "candidate_id": None})
        if row["status"] == "duplicate":
            rows.append({"row": row["row"], "outcome": "skipped", "field": "", "reason": _duplicate_reason(row), "candidate_id": None})
        for warning in row["warnings"]:
            rows.append({"row": row["row"], "outcome": "Avertissement", "field": warning["label"], "reason": warning["message"], "candidate_id": None})
    counts = {"analyzed": analysis["counts"]["analyzed"], "errors": analysis["counts"]["errors"], "skipped": analysis["counts"]["duplicates"]}
    return rows, counts
