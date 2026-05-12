from datetime import date, datetime
from io import BytesIO
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any, Type

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.drh.models import Candidate, Contract, ContractConditionalClause, ContractTemplate, Document, Employee, GeneratedContract, Leave, Sanction
from app.core.photo_storage import normalize_photo_fields


def list_rows(db: Session, model: Type, filters: dict[str, Any] | None = None):
    stmt = select(model)
    for key, value in (filters or {}).items():
        if value not in (None, "") and hasattr(model, key):
            stmt = stmt.where(getattr(model, key) == value)
    return db.execute(stmt.order_by(model.id.desc())).scalars().all()


def get_or_404(db: Session, model: Type, row_id: int):
    row = db.get(model, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    return row



def _employee_matches_text(row: Employee, query: str) -> bool:
    if not query:
        return True
    extra = row.extra if isinstance(row.extra, dict) else {}
    haystack = " ".join(
        str(value or "")
        for value in (
            row.code,
            row.first_name,
            row.last_name,
            row.phone,
            row.email,
            row.position,
            row.society,
            extra.get("matricule"),
            extra.get("fonction"),
            extra.get("poste"),
            extra.get("affectationCourante", {}).get("siteName") if isinstance(extra.get("affectationCourante"), dict) else "",
        )
    ).lower()
    return query.lower() in haystack


def list_employees_page(
    db: Session,
    *,
    society: str | None = None,
    allowed_societies: list[str] | None = None,
    mode: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> dict[str, Any]:
    stmt = select(Employee)
    if society:
        stmt = stmt.where(Employee.society == society)
    elif allowed_societies:
        stmt = stmt.where(Employee.society.in_(allowed_societies))

    selected_mode = (mode or "actifs").strip().lower()
    if selected_mode in {"actifs", "active", "actif"}:
        stmt = stmt.where(Employee.status.in_(["actif", "active"]))
    elif selected_mode in {"absents", "absence", "absent"}:
        stmt = stmt.where(Employee.status == "absent")
    elif selected_mode in {"suspension", "suspendu", "suspendus"}:
        stmt = stmt.where(Employee.status == "suspendu")
    elif selected_mode in {"sortant", "sortants"}:
        stmt = stmt.where(Employee.status.in_(["sortant", "demissionne", "licencie"]))
    elif selected_mode not in {"all", "tous", "recap"}:
        stmt = stmt.where(Employee.status == selected_mode)

    rows = db.execute(stmt.order_by(Employee.last_name.asc(), Employee.first_name.asc(), Employee.id.desc())).scalars().all()
    query = str(q or "").strip()
    if query:
        rows = [row for row in rows if _employee_matches_text(row, query)]

    page = max(int(page or 1), 1)
    page_size = min(max(int(page_size or 25), 5), 100)
    total = len(rows)
    pages = max((total + page_size - 1) // page_size, 1)
    if page > pages:
        page = pages
    start = (page - 1) * page_size
    return {"items": rows[start:start + page_size], "total": total, "page": page, "page_size": page_size, "pages": pages}


def _candidate_is_archived(row: Candidate) -> bool:
    data = row.data if isinstance(row.data, dict) else {}
    status = str(row.status or data.get("statut") or "").strip().lower()
    return status in {"archive", "archived", "archivé", "archivee", "archivée"} or bool(
        data.get("archivedAt") or data.get("motifArchive") or data.get("commentaireArchive")
    )


def _candidate_is_reserve(row: Candidate) -> bool:
    data = row.data if isinstance(row.data, dict) else {}
    status = str(row.status or data.get("statut") or "").strip().lower()
    return status == "reserve" and bool(data.get("fichePositionValidee"))


def _candidate_matches_text(row: Candidate, query: str) -> bool:
    if not query:
        return True
    data = row.data if isinstance(row.data, dict) else {}
    haystack = " ".join(
        str(value or "")
        for value in (
            row.first_name,
            row.last_name,
            row.phone,
            row.email,
            row.desired_position,
            row.society,
            data.get("nom"),
            data.get("prenom"),
            data.get("telephone"),
            data.get("posteSouhaite"),
            data.get("wilaya"),
        )
    ).lower()
    return query.lower() in haystack


def list_candidates_page(
    db: Session,
    *,
    society: str | None = None,
    allowed_societies: list[str] | None = None,
    mode: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> dict[str, Any]:
    stmt = select(Candidate)
    if society:
        stmt = stmt.where(Candidate.society == society)
    elif allowed_societies:
        stmt = stmt.where(Candidate.society.in_(allowed_societies))

    rows = db.execute(stmt.order_by(Candidate.id.desc())).scalars().all()
    selected_mode = (mode or "").strip().lower()
    if selected_mode in {"archive", "archived", "archives"}:
        rows = [row for row in rows if _candidate_is_archived(row)]
    elif selected_mode in {"reserve", "reserves"}:
        rows = [row for row in rows if _candidate_is_reserve(row) and not _candidate_is_archived(row)]
    elif selected_mode in {"new", "nouveau", "nouvelle", "recrutement"}:
        rows = [row for row in rows if not _candidate_is_reserve(row) and not _candidate_is_archived(row)]

    query = str(q or "").strip()
    if query:
        rows = [row for row in rows if _candidate_matches_text(row, query)]

    page = max(int(page or 1), 1)
    page_size = min(max(int(page_size or 25), 5), 100)
    total = len(rows)
    pages = max((total + page_size - 1) // page_size, 1)
    if page > pages:
        page = pages
    start = (page - 1) * page_size
    return {"items": rows[start:start + page_size], "total": total, "page": page, "page_size": page_size, "pages": pages}



def _candidate_text(value: Any) -> str:
    return str(value or "").strip()

def _candidate_data(values: dict[str, Any], existing: Candidate | None = None) -> dict[str, Any]:
    data = values.get("data")
    if isinstance(data, dict):
        return dict(data)
    if existing and isinstance(existing.data, dict):
        return dict(existing.data)
    return {}

def _candidate_status(value: Any) -> str:
    return str(value or "nouvelle").strip().lower()

def _candidate_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "oui", "yes", "on"}

def _candidate_sections(data: dict[str, Any]) -> dict[str, Any]:
    raw = data.get("sectionValidations")
    return raw if isinstance(raw, dict) else {}

def _candidate_required_fields(section: str) -> list[tuple[str, str]]:
    return {
        "identification": [
            ("nom", "Nom"),
            ("prenom", "Prénom"),
            ("dateNaissance", "Date de naissance"),
            ("lieuNaissance", "Lieu de naissance"),
            ("sexe", "Sexe"),
            ("nomPere", "Nom du père"),
            ("nomMere", "Nom de la mère"),
            ("nin", "NIN"),
            ("situation", "Situation familiale"),
            ("source", "Source"),
        ],
        "poste": [("posteSouhaite", "Poste souhaité"), ("telephone", "Téléphone")],
        "avis": [
            ("avisDecision", "Décision"),
            ("avisDate", "Date de l'avis"),
            ("avisRecruteur", "Recruteur"),
            ("avisCommentaire", "Commentaire"),
        ],
        "contact": [
            ("adresse", "Adresse"),
            ("commune", "Commune"),
            ("wilaya", "Wilaya"),
            ("contactUrgenceLien", "Lien contact urgence"),
            ("contactUrgenceNom", "Nom contact urgence"),
            ("contactUrgenceTel", "Téléphone urgence"),
        ],
    }.get(section, [])

def _candidate_age_on_save(date_naissance: Any) -> int | None:
    if not date_naissance:
        return None
    try:
        born = date.fromisoformat(str(date_naissance)[:10])
    except ValueError:
        raise HTTPException(status_code=422, detail="Date de naissance invalide")
    today = date.today()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))

def _validate_candidate_form_rules(values: dict[str, Any], existing: Candidate | None = None, section: str | None = None) -> None:
    data = _candidate_data(values, existing)
    first_name = _candidate_text(values.get("first_name", existing.first_name if existing else data.get("prenom")))
    last_name = _candidate_text(values.get("last_name", existing.last_name if existing else data.get("nom")))
    if len(first_name) < 2 or len(last_name) < 2:
        raise HTTPException(status_code=422, detail="Nom et prénom obligatoires pour créer une candidature.")

    nin = _candidate_text(data.get("nin"))
    if nin and not re.fullmatch(r"\d{10}", nin):
        raise HTTPException(status_code=422, detail="Le NIN doit contenir exactement 10 chiffres")
    age = _candidate_age_on_save(data.get("dateNaissance"))
    if age is not None and age < 20:
        raise HTTPException(status_code=422, detail="Le candidat doit avoir au moins 20 ans à la date d'enregistrement")

    if section:
        missing = [label for field, label in _candidate_required_fields(section) if not _candidate_text(data.get(field))]
        if missing:
            raise HTTPException(status_code=422, detail="Champs obligatoires manquants : " + ", ".join(missing))

def _validate_candidate_transition(values: dict[str, Any], existing: Candidate | None = None) -> None:
    data = _candidate_data(values, existing)
    status_value = values.get("status", existing.status if existing else "nouvelle")
    status_norm = _candidate_status(status_value)
    sections = _candidate_sections(data)
    all_sections = ["identification", "mensurations", "militaire", "poste", "avis", "contact", "habilitations", "experience"]
    etape1 = ["identification", "mensurations", "militaire", "poste", "avis"]

    if _candidate_bool(data.get("fichePositionValidee")) or status_norm in {"reserve", "a_contractualiser", "embauche"}:
        missing = [key for key in all_sections if not sections.get(key)]
        if missing:
            raise HTTPException(status_code=422, detail="Fiche de position refusée : sections non validées (" + ", ".join(missing) + ")")

    if status_norm == "reserve" and any(sections.get(key) for key in etape1):
        missing = [key for key in etape1 if not sections.get(key)]
        if missing:
            raise HTTPException(status_code=422, detail="Mise en réserve refusée : étape précédente non validée")

def _candidate_values(payload: Any, existing: Candidate | None = None, partial: bool = False) -> dict[str, Any]:
    values = payload.model_dump(exclude_unset=True)
    data = values.get("data")
    if isinstance(data, dict):
        raw_id = str(data.get("id") or "").strip()
        if raw_id.startswith("tmp_cd_"):
            raise HTTPException(status_code=422, detail="Candidature temporaire refusée. Enregistrez uniquement une fiche complète.")
        data.pop("isNew", None)
        values["data"] = normalize_photo_fields(data, fallback=raw_id or values.get("last_name") or "candidate")
    first_name = _candidate_text(values.get("first_name", existing.first_name if existing else ""))
    last_name = _candidate_text(values.get("last_name", existing.last_name if existing else ""))
    if len(first_name) < 2 or len(last_name) < 2:
        raise HTTPException(status_code=422, detail="Nom et prénom obligatoires pour créer une candidature.")
    if not partial or "first_name" in values:
        values["first_name"] = first_name
    if not partial or "last_name" in values:
        values["last_name"] = last_name
    _validate_candidate_form_rules(values, existing)
    _validate_candidate_transition(values, existing)
    return values

def validate_candidate_section(db: Session, payload: Any, section: str, existing_id: int | None = None, username: str | None = None):
    values = payload.model_dump(exclude_unset=True)
    existing = get_or_404(db, Candidate, existing_id) if existing_id else None
    data = _candidate_data(values, existing)
    order = ["identification", "mensurations", "militaire", "poste", "avis", "contact", "habilitations", "experience"]
    if section not in order:
        raise HTTPException(status_code=422, detail="Section inconnue")
    sections = dict(_candidate_sections(data))
    idx = order.index(section)
    previous_missing = [key for key in order[:idx] if not sections.get(key)]
    if previous_missing:
        raise HTTPException(status_code=422, detail="Validez d'abord la section précédente : " + ", ".join(previous_missing))
    _validate_candidate_form_rules(values, existing, section=section)
    sections[section] = {"by": username or "system", "at": datetime.utcnow().isoformat()}
    data["sectionValidations"] = sections
    values["data"] = data
    return {"status": "success", "data": {"section": section, "sectionValidations": sections, "next": order[idx + 1] if idx + 1 < len(order) else None}}

def create_candidate(db: Session, payload: Any):
    row = Candidate(**_candidate_values(payload))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

def update_candidate(db: Session, candidate_id: int, payload: Any):
    row = get_or_404(db, Candidate, candidate_id)
    for key, value in _candidate_values(payload, existing=row, partial=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row

def create_row(db: Session, model: Type, payload: Any):
    values = payload.model_dump(exclude_unset=True)
    if model is Employee and isinstance(values.get("extra"), dict):
        values["extra"] = normalize_photo_fields(values["extra"], fallback=values.get("code") or "employee")
    row = model(**values)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_row(db: Session, model: Type, row_id: int, payload: Any):
    row = get_or_404(db, model, row_id)
    values = payload.model_dump(exclude_unset=True)
    if model is Employee and isinstance(values.get("extra"), dict):
        values["extra"] = normalize_photo_fields(values["extra"], fallback=getattr(row, "code", None) or str(row_id))
    for key, value in values.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


def delete_row(db: Session, model: Type, row_id: int):
    row = get_or_404(db, model, row_id)
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": row_id}


def drh_dashboard(db: Session):
    total = db.scalar(select(func.count(Employee.id))) or 0
    by_status = dict(
        db.execute(select(Employee.status, func.count(Employee.id)).group_by(Employee.status)).all()
    )
    candidates = dict(
        db.execute(select(Candidate.status, func.count(Candidate.id)).group_by(Candidate.status)).all()
    )
    leaves_pending = db.scalar(select(func.count(Leave.id)).where(Leave.status == "instance")) or 0
    trial_alerts = db.execute(
        select(Employee).where(Employee.trial_end_date.is_not(None), Employee.status == "actif")
    ).scalars().all()
    return {
        "employees_total": total,
        "employees_by_status": by_status,
        "candidates_by_status": candidates,
        "leaves_pending": leaves_pending,
        "trial_periods": [
            {"id": e.id, "code": e.code, "name": f"{e.last_name} {e.first_name}", "trial_end_date": e.trial_end_date}
            for e in trial_alerts
        ],
    }


def recruit_candidate(db: Session, candidate_id: int):
    candidate = get_or_404(db, Candidate, candidate_id)
    _validate_candidate_transition({"status": "embauche", "data": candidate.data or {}}, candidate)
    next_code = f"A{(db.scalar(select(func.count(Employee.id))) or 0) + 1:02d}"
    employee = Employee(
        code=next_code,
        first_name=candidate.first_name,
        last_name=candidate.last_name,
        phone=candidate.phone,
        email=candidate.email,
        position=candidate.desired_position,
        society=candidate.society,
        salary_net=candidate.expected_salary or 0,
        status="actif",
        extra=candidate.data or {},
    )
    candidate.status = "embauche"
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


def approve_leave(db: Session, leave_id: int):
    leave = get_or_404(db, Leave, leave_id)
    leave.status = "approuve"
    leave.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(leave)
    return leave


def refuse_leave(db: Session, leave_id: int):
    leave = get_or_404(db, Leave, leave_id)
    leave.status = "refuse"
    leave.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(leave)
    return leave


def fiche_position(db: Session, employee_id: int):
    from app.modules.materiel.models import EmployeeEquipment
    from app.modules.ops.models import Assignment, DailyPresence, Event

    employee = get_or_404(db, Employee, employee_id)
    contracts = list_rows(db, Contract, {"employee_id": employee_id})
    leaves = list_rows(db, Leave, {"employee_id": employee_id})
    sanctions = list_rows(db, Sanction, {"employee_id": employee_id})
    documents = list_rows(db, Document, {"owner_type": "employee", "owner_id": employee_id})
    assignments = list_rows(db, Assignment, {"employee_id": employee_id})
    pointage = list_rows(db, DailyPresence, {"employee_id": employee_id})
    events = list_rows(db, Event, {"employee_id": employee_id})
    equipment = list_rows(db, EmployeeEquipment, {"employee_id": employee_id, "status": "attribue"})
    return {
        "employee": employee,
        "contracts": contracts,
        "leaves": leaves,
        "sanctions": sanctions,
        "documents": documents,
        "assignments": assignments,
        "pointage": pointage,
        "events": events,
        "equipment": equipment,
    }



DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PDF_MIME = "application/pdf"
PLACEHOLDER_RE = re.compile(r"{{\s*([A-Z0-9_]+)\s*}}")


def extract_docx_placeholders(content: bytes) -> list[str]:
    try:
        from docx import Document as WordDocument
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="Dépendance python-docx manquante") from exc
    try:
        doc = WordDocument(BytesIO(content))
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Modèle Word .docx invalide") from exc
    text_parts: list[str] = []
    text_parts.extend(p.text or "" for p in doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                text_parts.extend(p.text or "" for p in cell.paragraphs)
    found = sorted({m.group(1).upper() for m in PLACEHOLDER_RE.finditer("\n".join(text_parts))})
    return found


def _date_str(value: Any) -> str:
    if isinstance(value, (date, datetime)):
        return value.strftime("%d/%m/%Y")
    return str(value or "")


def contract_values(employee: Employee, request: Any | None = None) -> dict[str, str]:
    extra = employee.extra if isinstance(employee.extra, dict) else {}
    request_values = getattr(request, "values", None) if request is not None else None
    request_values = request_values if isinstance(request_values, dict) else {}
    start = getattr(request, "start_date", None) if request is not None else None
    end = getattr(request, "end_date", None) if request is not None else None
    salary = getattr(request, "salary_net", None) if request is not None else None
    position = getattr(request, "position", None) if request is not None else None
    function = getattr(request, "function", None) if request is not None else None
    values: dict[str, Any] = {
        "CODE": employee.code,
        "MATRICULE": employee.code,
        "NOM": employee.last_name,
        "PRENOM": employee.first_name,
        "NOM_PRENOM": f"{employee.last_name or ''} {employee.first_name or ''}".strip(),
        "ADRESSE": employee.address,
        "COMMUNE": employee.commune,
        "WILAYA": employee.wilaya,
        "NIN": employee.nin,
        "DATE_NAISSANCE": _date_str(employee.birth_date),
        "LIEU_NAISSANCE": employee.birth_place,
        "TELEPHONE": employee.phone,
        "EMAIL": employee.email,
        "POSTE": position or employee.position,
        "FONCTION": function or extra.get("fonction") or employee.position,
        "SOCIETE": employee.society,
        "TYPE_CONTRAT": getattr(request, "contract_type", None) if request is not None else employee.contract_type,
        "DATE_DEBUT": _date_str(start or employee.recruit_date),
        "DATE_FIN": _date_str(end or employee.contract_end_date),
        "DATE_RECRUTEMENT": _date_str(employee.recruit_date),
        "DATE_FIN_ESSAI": _date_str(employee.trial_end_date),
        "SALAIRE": salary if salary is not None else employee.salary_net,
        "SALAIRE_NET": salary if salary is not None else employee.salary_net,
        "CLAUSES_CONDITIONNELLES": "",
    }
    for key, value in extra.items():
        values.setdefault(str(key).upper(), value)
    for key, value in request_values.items():
        values[str(key).upper()] = value
    return {k: _date_str(v) for k, v in values.items()}


def _clause_matches(clause: ContractConditionalClause, values: dict[str, str]) -> bool:
    actual = values.get(str(clause.condition_field or "").upper(), "")
    expected = str(clause.condition_value or "")
    op = str(clause.condition_operator or "equals").lower()
    a = actual.lower().strip()
    e = expected.lower().strip()
    if op in {"equals", "=", "=="}:
        return a == e
    if op in {"contains", "contient"}:
        return e in a
    if op in {"not_equals", "!=", "different"}:
        return a != e
    return a == e


def matching_clauses(db: Session, template_id: int | None, values: dict[str, str]) -> dict[str, str]:
    stmt = select(ContractConditionalClause).where(ContractConditionalClause.active == 1)
    if template_id is not None:
        stmt = stmt.where(or_(ContractConditionalClause.template_id == template_id, ContractConditionalClause.template_id.is_(None)))
    clauses = db.execute(stmt.order_by(ContractConditionalClause.id)).scalars().all()
    grouped: dict[str, list[str]] = {}
    for clause in clauses:
        if _clause_matches(clause, values):
            key = str(clause.placeholder or "CLAUSES_CONDITIONNELLES").upper()
            grouped.setdefault(key, []).append(clause.content)
    return {key: "\n\n".join(parts) for key, parts in grouped.items()}


def find_contract_template(db: Session, request: Any, employee: Employee) -> ContractTemplate:
    if request.template_id:
        row = db.get(ContractTemplate, request.template_id)
        if not row or row.active != 1:
            raise HTTPException(status_code=404, detail="Modèle de contrat introuvable ou inactif")
        return row
    contract_type = request.contract_type or employee.contract_type or "CDI"
    position = request.position or employee.position or ""
    function = request.function or (employee.extra or {}).get("fonction") or position
    stmt = select(ContractTemplate).where(ContractTemplate.active == 1, ContractTemplate.contract_type == contract_type)
    candidates = db.execute(stmt.order_by(ContractTemplate.id.desc())).scalars().all()
    if not candidates:
        raise HTTPException(status_code=404, detail="Aucun modèle actif pour ce type de contrat")
    def score(t: ContractTemplate) -> int:
        points = 0
        if t.position and position and t.position.lower() == position.lower():
            points += 4
        if t.function and function and t.function.lower() == str(function).lower():
            points += 4
        if not t.position and not t.function:
            points += 1
        return points
    return sorted(candidates, key=score, reverse=True)[0]


def _replace_text_in_paragraph(paragraph, values: dict[str, str]) -> None:
    full_text = "".join(run.text for run in paragraph.runs)
    if "{{" not in full_text:
        return
    replaced = PLACEHOLDER_RE.sub(lambda m: values.get(m.group(1).upper(), ""), full_text)
    if paragraph.runs:
        paragraph.runs[0].text = replaced
        for run in paragraph.runs[1:]:
            run.text = ""


def render_docx(template: ContractTemplate, values: dict[str, str]) -> bytes:
    try:
        from docx import Document as WordDocument
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="Dépendance python-docx manquante") from exc
    doc = WordDocument(BytesIO(template.docx_content))
    for paragraph in doc.paragraphs:
        _replace_text_in_paragraph(paragraph, values)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    _replace_text_in_paragraph(paragraph, values)
    out = BytesIO()
    doc.save(out)
    return out.getvalue()


def convert_docx_to_pdf(docx_bytes: bytes) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        source = tmp_path / "contrat.docx"
        source.write_bytes(docx_bytes)
        try:
            subprocess.run(
                ["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(tmp_path), str(source)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=501, detail="Conversion PDF indisponible: LibreOffice/soffice non installé sur le serveur") from exc
        except subprocess.SubprocessError as exc:
            raise HTTPException(status_code=500, detail="Conversion PDF échouée") from exc
        pdf = tmp_path / "contrat.pdf"
        if not pdf.exists():
            raise HTTPException(status_code=500, detail="PDF non généré")
        return pdf.read_bytes()


def generate_contract(db: Session, request: Any, user: Any | None = None) -> GeneratedContract:
    employee = get_or_404(db, Employee, request.employee_id)
    template = find_contract_template(db, request, employee)
    values = contract_values(employee, request)
    values.update(matching_clauses(db, template.id, values))
    docx_bytes = render_docx(template, values)
    output_format = (request.output_format or "docx").lower()
    if output_format == "pdf":
        file_content = convert_docx_to_pdf(docx_bytes)
        mime_type = PDF_MIME
        ext = "pdf"
    else:
        output_format = "docx"
        file_content = docx_bytes
        mime_type = DOCX_MIME
        ext = "docx"
    now = datetime.utcnow()
    reference = f"CTR-{now:%Y%m%d}-{employee.code}-{int(now.timestamp())}"
    safe_name = f"{reference}-{template.contract_type}-{employee.last_name}-{employee.first_name}".replace(" ", "_")
    row = GeneratedContract(
        employee_id=employee.id,
        template_id=template.id,
        reference=reference,
        title=template.title,
        contract_type=request.contract_type or employee.contract_type or template.contract_type,
        position=request.position or employee.position,
        start_date=request.start_date or employee.recruit_date,
        end_date=request.end_date or employee.contract_end_date,
        output_format=output_format,
        file_name=f"{safe_name}.{ext}",
        mime_type=mime_type,
        file_content=file_content,
        values=values,
        generated_by=getattr(user, "username", None),
        status="genere",
    )
    db.add(row)
    contract = Contract(
        employee_id=employee.id,
        contract_type=row.contract_type,
        position=row.position,
        start_date=row.start_date,
        end_date=row.end_date,
        trial_end_date=employee.trial_end_date,
        salary_net=float(values.get("SALAIRE_NET") or employee.salary_net or 0),
        status="actif",
        template_code=template.code,
        content=f"Contrat généré automatiquement: {reference}",
    )
    db.add(contract)
    db.flush()
    row.contract_id = contract.id
    document = Document(
        owner_type="employee",
        owner_id=employee.id,
        label=f"Contrat généré - {row.contract_type}",
        file_name=row.file_name,
        file_path=f"generated_contract:{reference}",
        mime_type=row.mime_type,
        uploaded_by=getattr(user, "username", None),
    )
    db.add(document)
    db.commit()
    db.refresh(row)
    return row


def cleanup_base64_photos(db: Session) -> int:
    changed = 0
    for row in db.execute(select(Candidate)).scalars().all():
        if isinstance(row.data, dict):
            cleaned = normalize_photo_fields(row.data, fallback=str(row.id))
            if cleaned != row.data:
                row.data = cleaned
                changed += 1
    for row in db.execute(select(Employee)).scalars().all():
        if isinstance(row.extra, dict):
            cleaned = normalize_photo_fields(row.extra, fallback=row.code or str(row.id))
            if cleaned != row.extra:
                row.extra = cleaned
                changed += 1
    if changed:
        db.commit()
    return changed
