from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.commercial.models import Client
from app.modules.drh.models import Candidate, Contract, Employee
from app.modules.finance_models import Advance, CashEntry, CreditNote, Invoice, Payment
from app.modules.irongs.models import SgdiRecord
from app.modules.materiel.models import StockArticle, StockMovement, Store, Supplier
from app.modules.ops.models import Assignment, DailyPresence, Incident, OpsMovement, Site
from app.core.photo_storage import normalize_photo_fields

def _strip_embedded_base64(item: dict[str, Any]) -> dict[str, Any]:
    """Remove base64-encoded blobs from bulk list responses — served as file URLs after first save."""
    for key, val in list(item.items()):
        if isinstance(val, str) and len(val) > 500 and (val.startswith("data:") or (not val.startswith(("/", "http")) and "base64" in val[:100])):
            item[key] = ""
    return item


SQL_COLLECTIONS = {
    "candidats", "agents", "employees", "sites", "assignments", "affectations", "feuillePresence",
    "clients", "magasins", "fournisseurs", "stockArticles", "stockMouvements",
    "factures", "paiements", "avances", "avoirs", "caisse",
    "opsMouvements", "incidents",
    "contrats",
}
SQL_SKIP_EMPTY_ON_DB_REPLACE = {"sites", "clients", "magasins", "fournisseurs", "stockArticles", "stockMouvements", "opsMouvements", "incidents"}
FINANCE_MODELS = {"factures": Invoice, "paiements": Payment, "avances": Advance, "avoirs": CreditNote, "caisse": CashEntry}
STOCK_MODELS = {"stockArticles": StockArticle, "stockMouvements": StockMovement, "magasins": Store, "fournisseurs": Supplier}


def as_int(value: Any) -> int | None:
    try:
        if value in (None, "", "None", "undefined", "null"):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def as_float(value: Any) -> float:
    try:
        if value in (None, "", "None", "undefined", "null"):
            return 0.0
        return float(str(value).replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def as_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def date_out(value: Any) -> str:
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    return str(value or "")


def legacy_id(item: dict[str, Any]) -> str:
    for key in ("id", "external_id", "numero", "number", "code", "matricule"):
        value = item.get(key)
        if value not in (None, "", "None", "undefined", "null"):
            return str(value)
    return f"row-{abs(hash(str(item))) % 10_000_000}"


def employee_by_ref(db: Session, value: Any):
    row_id = as_int(value)
    if row_id:
        row = db.get(Employee, row_id)
        if row:
            return row
    if value not in (None, "", "None", "undefined", "null"):
        text = str(value)
        row = db.execute(select(Employee).where(Employee.code == text)).scalar_one_or_none()
        if row:
            return row
        for employee in db.execute(select(Employee)).scalars().all():
            extra = employee.extra if isinstance(employee.extra, dict) else {}
            legacy = extra.get("_legacy") if isinstance(extra.get("_legacy"), dict) else {}
            refs = [
                legacy.get("id"),
                legacy.get("backendId"),
                legacy.get("matricule"),
                legacy.get("code"),
                extra.get("id"),
                extra.get("matricule"),
                extra.get("code"),
            ]
            if any(str(ref) == text for ref in refs if ref not in (None, "", "None", "undefined", "null")):
                return employee
        # Fallback : chercher dans sgdi_records (agents du store JSON legacy)
        rec = db.execute(
            select(SgdiRecord).where(SgdiRecord.collection == "agents")
        ).scalars().all()
        for r in rec:
            d = r.data if isinstance(r.data, dict) else {}
            refs = [d.get("matricule"), d.get("code"), d.get("id"), d.get("backendId")]
            if any(str(ref) == text for ref in refs if ref not in (None, "", "None", "undefined", "null")):
                # Créer l'employé dans la table employees à la volée
                new_emp = Employee(
                    code=d.get("matricule") or d.get("code") or text,
                    first_name=(d.get("prenom") or "").upper(),
                    last_name=(d.get("nom") or "").upper(),
                    society=d.get("societe") or "",
                    status=d.get("statut") or "actif",
                    extra={"_legacy": d},
                )
                db.add(new_emp)
                db.flush()
                return new_emp
    return None


def site_by_ref(db: Session, value: Any):
    row_id = as_int(value)
    if row_id:
        row = db.get(Site, row_id)
        if row:
            return row
    if value not in (None, "", "None", "undefined", "null"):
        text = str(value)
        row = db.execute(select(Site).where((Site.indicatif == text) | (Site.name == text))).scalar_one_or_none()
        if row:
            return row
        for site in db.execute(select(Site)).scalars().all():
            plan = site.equipment_plan if isinstance(site.equipment_plan, dict) else {}
            legacy = plan.get("_legacy") if isinstance(plan.get("_legacy"), dict) else {}
            refs = [legacy.get("id"), legacy.get("backendId"), legacy.get("indicatif"), plan.get("id"), plan.get("backendId"), plan.get("indicatif")]
            if any(str(ref) == text for ref in refs if ref not in (None, "", "None", "undefined", "null")):
                return site
    return None



def candidate_to_item(row: Candidate) -> dict[str, Any]:
    data = row.data if isinstance(row.data, dict) else {}
    item = _strip_embedded_base64(dict(data or {}))
    item.update({
        "id": item.get("id") or str(row.id),
        "backendId": row.id,
        "nom": item.get("nom") or row.last_name or "",
        "prenom": item.get("prenom") or row.first_name or "",
        "telephone": item.get("telephone") or row.phone or "",
        "email": item.get("email") or row.email or "",
        "posteSouhaite": item.get("posteSouhaite") or row.desired_position or "",
        "societe": item.get("societe") or row.society or "",
        "salairePrevu": item.get("salairePrevu") if item.get("salairePrevu") not in (None, "") else row.expected_salary,
        "avisCommentaire": item.get("avisCommentaire") or row.recruiter_opinion or "",
        "statut": item.get("statut") or row.status or "nouvelle",
        "createdAt": item.get("createdAt") or date_out(getattr(row, "created_at", None)),
    })
    return item


def upsert_candidate(db: Session, item: dict[str, Any]) -> dict[str, Any]:
    item = normalize_photo_fields(item, fallback=str(item.get("backendId") or item.get("id") or "candidate"))
    row = db.get(Candidate, as_int(item.get("backendId")) or 0)
    first_name = str(item.get("prenom") or item.get("first_name") or "").strip()
    last_name = str(item.get("nom") or item.get("last_name") or "").strip()
    if len(first_name) < 2 or len(last_name) < 2:
        raise HTTPException(status_code=422, detail="Candidat refusé: nom et prénom obligatoires")
    if not row:
        row = Candidate(first_name=first_name, last_name=last_name)
        db.add(row)
    row.first_name = first_name
    row.last_name = last_name
    row.phone = item.get("telephone") or item.get("phone")
    row.email = item.get("email")
    row.desired_position = item.get("posteSouhaite") or item.get("poste") or item.get("desired_position")
    row.society = item.get("societe") or item.get("society")
    raw_salary = item.get("salairePrevu") if item.get("salairePrevu") not in (None, "") else item.get("expected_salary")
    row.expected_salary = None if raw_salary in (None, "") else as_float(raw_salary)
    row.recruiter_opinion = item.get("avisCommentaire") or item.get("avisRecruteur") or item.get("recruiter_opinion")
    row.status = item.get("statut") or item.get("status") or row.status or "nouvelle"
    row.data = deepcopy(item)
    db.flush()
    return candidate_to_item(row)

def employee_to_item(row: Employee) -> dict[str, Any]:
    extra = row.extra if isinstance(row.extra, dict) else {}
    item = _strip_embedded_base64(dict(extra.get("_legacy") or {}))
    item.update({key: deepcopy(value) for key, value in extra.items() if key != "_legacy"})
    item.update({
        "id": item.get("id") or str(row.id), "backendId": row.id,
        "matricule": row.code, "code": row.code, "nom": row.last_name, "prenom": row.first_name,
        "telephone": row.phone, "phone": row.phone, "email": row.email, "adresse": row.address,
        "commune": row.commune, "wilaya": row.wilaya, "poste": row.position,
        "fonction": extra.get("fonction") or row.position, "societe": row.society, "statut": row.status,
        "typeContrat": row.contract_type, "salaireNet": row.salary_net,
        "dateNaissance": date_out(row.birth_date),
        "dateRecrutement": date_out(row.recruit_date), "dateFinEssai": date_out(row.trial_end_date),
        "dateFinContrat": date_out(row.contract_end_date), "locked": bool(row.locked),
    })
    return item


def upsert_employee(db: Session, item: dict[str, Any]) -> dict[str, Any]:
    item = normalize_photo_fields(item, fallback=str(item.get("matricule") or item.get("code") or item.get("backendId") or "employee"))
    backend_id = as_int(item.get("backendId"))
    row = db.get(Employee, backend_id or 0)
    if backend_id and not row:
        return dict(item)
    code = str(item.get("matricule") or item.get("code") or item.get("id") or "").strip()[:30]
    if not row and code:
        row = db.execute(select(Employee).where(Employee.code == code)).scalar_one_or_none()
    if not row:
        row = Employee(code=code or legacy_id(item)[:30], first_name=" ", last_name=" ")
        db.add(row)
    row.code = code or row.code
    row.first_name = str(item.get("prenom") or row.first_name or " ").strip() or " "
    row.last_name = str(item.get("nom") or item.get("name") or row.last_name or row.code).strip() or row.code
    row.nin = item.get("nin") or item.get("NIN") or row.nin
    row.birth_date = as_date(item.get("dateNaissance"))
    row.birth_place = item.get("lieuNaissance")
    row.phone = item.get("telephone") or item.get("phone")
    row.email = item.get("email")
    row.address = item.get("adresse") or item.get("address")
    row.commune = item.get("commune")
    row.wilaya = item.get("wilaya")
    row.position = item.get("poste") or item.get("fonction") or item.get("position")
    row.society = item.get("societe") or item.get("society")
    row.status = item.get("statut") or item.get("status") or "actif"
    row.contract_type = item.get("typeContrat") or item.get("contract_type")
    row.salary_net = as_float(item.get("salaireNet") or item.get("salary_net"))
    row.recruit_date = as_date(item.get("dateRecrutement") or item.get("recruit_date"))
    row.trial_end_date = as_date(item.get("dateFinEssai"))
    row.contract_end_date = as_date(item.get("dateFinContrat"))
    row.locked = 1 if item.get("locked", False) else 0
    row.extra = {**(row.extra or {}), "fonction": item.get("fonction") or item.get("poste"), "_legacy": deepcopy(item)}
    db.flush()
    sync_assignment_from_agent(db, row, item)
    return employee_to_item(row)


def sync_assignment_from_agent(db: Session, employee: Employee, item: dict[str, Any]) -> None:
    aff = item.get("affectationCourante") if isinstance(item.get("affectationCourante"), dict) else None
    if not aff:
        return
    site = site_by_ref(db, aff.get("siteBackendId") or aff.get("site_id") or aff.get("siteId") or aff.get("site"))
    if not site:
        return
    current = db.execute(select(Assignment).where(Assignment.employee_id == employee.id, Assignment.active == 1).order_by(Assignment.id.desc())).scalars().first()
    if not current or current.site_id != site.id:
        if current:
            current.active = 0
            current.end_date = as_date(aff.get("date")) or date.today()
        current = Assignment(employee_id=employee.id, site_id=site.id, start_date=as_date(aff.get("date")) or date.today())
        db.add(current)
    current.group_code = str(aff.get("groupe") or aff.get("group_code") or "A")[:20]
    current.position = aff.get("poste") or employee.position
    current.change_reason = aff.get("motif")
    current.active = 1


def assignment_to_item(row: Assignment) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "backendId": row.id,
        "employee_id": row.employee_id,
        "site_id": row.site_id,
        "agentId": row.employee_id,
        "siteId": row.site_id,
        "groupe": row.group_code,
        "poste": row.position,
        "date": date_out(row.start_date),
        "dateDebut": date_out(row.start_date),
        "dateFin": date_out(row.end_date),
        "motifChangement": row.change_reason or "",
        "active": bool(row.active),
    }


def upsert_assignment(db: Session, item: dict[str, Any]) -> dict[str, Any] | None:
    row = db.get(Assignment, as_int(item.get("backendId")) or as_int(item.get("id")) or 0)
    employee = employee_by_ref(db, item.get("employee_id") or item.get("employeeId") or item.get("agentBackendId") or item.get("agentId") or item.get("matricule"))
    site = site_by_ref(db, item.get("site_id") or item.get("siteBackendId") or item.get("siteId") or item.get("site") or item.get("siteName"))
    if not employee or not site:
        return assignment_to_item(row) if row else None
    if not row:
        row = Assignment(
            employee_id=employee.id,
            site_id=site.id,
            start_date=as_date(item.get("dateDebut") or item.get("date") or item.get("start_date")) or date.today(),
        )
        db.add(row)
    row.employee_id = employee.id
    row.site_id = site.id
    row.group_code = str(item.get("groupe") or item.get("group_code") or row.group_code or "A")[:20]
    row.position = item.get("poste") or item.get("position")
    row.start_date = as_date(item.get("dateDebut") or item.get("date") or item.get("start_date")) or row.start_date or date.today()
    row.end_date = as_date(item.get("dateFin") or item.get("end_date"))
    row.change_reason = item.get("motifChangement") or item.get("motif") or item.get("change_reason")
    row.active = 1 if item.get("active", True) else 0
    db.flush()
    return assignment_to_item(row)


def site_to_item(row: Site) -> dict[str, Any]:
    plan = row.equipment_plan if isinstance(row.equipment_plan, dict) else {}
    raw = plan.get("_legacy") if isinstance(plan.get("_legacy"), dict) else {}
    item = {**dict(raw or {}), **{k: v for k, v in plan.items() if k != "_legacy"}}
    item.update({"id": item.get("id") or str(row.id), "backendId": row.id, "nom": row.name, "name": row.name, "indicatif": row.indicatif, "client": row.client_name, "adresse": row.address, "commune": row.commune, "wilaya": row.wilaya, "type": row.site_type, "rotationSystem": row.rotation_system, "actif": bool(row.active), "effectifs": {"totalContractuel": row.contractual_staff, "jour": row.day_staff, "nuit": row.night_staff, "weekend": row.weekend_staff, "feries": row.holiday_staff, "groupes": row.groups_count}})
    return item


def upsert_site(db: Session, item: dict[str, Any]) -> dict[str, Any]:
    row = db.get(Site, as_int(item.get("backendId")) or 0)
    indicatif = item.get("indicatif") or item.get("code")
    if not row and indicatif:
        row = db.execute(select(Site).where(Site.indicatif == str(indicatif))).scalar_one_or_none()
    if not row:
        row = Site(name=str(item.get("nom") or item.get("name") or "Site"))
        db.add(row)
    eff = item.get("effectifs") if isinstance(item.get("effectifs"), dict) else {}
    row.name = str(item.get("nom") or item.get("name") or row.name)
    row.indicatif = indicatif
    row.client_name = item.get("client") or item.get("client_name")
    row.address = item.get("adresse") or item.get("address")
    row.commune = item.get("commune")
    row.wilaya = item.get("wilaya")
    row.site_type = item.get("type") or item.get("site_type")
    row.rotation_system = item.get("rotationSystem") or item.get("rotation_system")
    row.contractual_staff = as_int(eff.get("totalContractuel")) or 0
    row.day_staff = as_int(eff.get("jour")) or 0
    row.night_staff = as_int(eff.get("nuit")) or 0
    row.weekend_staff = as_int(eff.get("weekend")) or 0
    row.holiday_staff = as_int(eff.get("feries")) or 0
    row.groups_count = as_int(eff.get("groupes")) or 0
    row.active = 1 if item.get("actif", item.get("active", True)) else 0
    row.equipment_plan = {**(row.equipment_plan or {}), **deepcopy(item), "_legacy": deepcopy(item)}
    db.flush()
    return site_to_item(row)


def simple_raw(row: Any) -> dict[str, Any]:
    item = dict((getattr(row, "data", None) or {}).get("_legacy") or {})
    item["id"] = item.get("id") or getattr(row, "external_id", None) or str(row.id)
    item["backendId"] = row.id
    return item


def client_to_item(row: Client) -> dict[str, Any]:
    raw = row.data if isinstance(row.data, dict) else {}
    legacy = raw.get("_legacy") if isinstance(raw.get("_legacy"), dict) else {}
    item = {**deepcopy(legacy), **{key: deepcopy(value) for key, value in raw.items() if key != "_legacy"}}
    item.update({
        "id": item.get("id") or str(row.id),
        "backendId": row.id,
        "nom": item.get("nom") or row.name or "",
        "raisonSociale": item.get("raisonSociale") or row.legal_name or "",
        "societe": item.get("societe") or row.society or "",
        "structure": item.get("structure") or row.structure or "",
        "statut": item.get("statut") or row.status or "actif",
        "contact": item.get("contact") or row.contact_name or "",
        "fonction": item.get("fonction") or row.contact_position or "",
        "tel": item.get("tel") or item.get("phone") or row.phone or "",
        "email": item.get("email") or row.email or "",
        "adresse": item.get("adresse") or row.address or "",
        "nif": item.get("nif") or row.nif or "",
        "rc": item.get("rc") or row.rc or "",
        "prestationsServices": item.get("prestationsServices") or row.services or "",
        "dateDebutContrat": item.get("dateDebutContrat") or date_out(row.contract_start),
        "dureeContrat": item.get("dureeContrat") or row.contract_duration or "",
        "dateFinContrat": item.get("dateFinContrat") or date_out(row.contract_end),
        "notes": item.get("notes") or row.notes or "",
    })
    return item


def upsert_client(db: Session, item: dict[str, Any]) -> dict[str, Any]:
    row = db.get(Client, as_int(item.get("backendId") or item.get("id")) or 0)
    if not row:
        row = Client(name=str(item.get("nom") or item.get("raisonSociale") or "Client"))
        db.add(row)
    row.name = str(item.get("nom") or item.get("raisonSociale") or row.name)
    row.legal_name = item.get("raisonSociale", row.legal_name)
    row.society = item.get("societe", row.society)
    row.structure = item.get("structure", row.structure)
    row.status = item.get("statut") or row.status or "actif"
    row.contact_name = item.get("contact", row.contact_name)
    row.contact_position = item.get("fonction", row.contact_position)
    row.phone = item.get("tel", item.get("phone", row.phone))
    row.email = item.get("email", row.email)
    row.address = item.get("adresse", row.address)
    row.nif = item.get("nif", row.nif)
    row.rc = item.get("rc", row.rc)
    row.services = item.get("prestationsServices", row.services)
    row.contract_start = as_date(item.get("dateDebutContrat")) if "dateDebutContrat" in item else row.contract_start
    row.contract_duration = item.get("dureeContrat", row.contract_duration)
    row.contract_end = as_date(item.get("dateFinContrat")) if "dateFinContrat" in item else row.contract_end
    row.notes = item.get("notes", row.notes)
    row.data = {**(row.data or {}), **deepcopy(item)}
    db.flush()
    return client_to_item(row)


def upsert_finance(db: Session, model: type, item: dict[str, Any], collection: str) -> dict[str, Any]:
    external = legacy_id(item)
    row = db.get(model, as_int(item.get("backendId")) or 0)
    if not row:
        row = db.execute(select(model).where(model.external_id == external)).scalar_one_or_none()
    if not row:
        row = model(external_id=external)
        db.add(row)
    row.external_id = external
    if isinstance(row, Invoice):
        row.number = item.get("numero") or item.get("number")
        row.invoice_date = as_date(item.get("date"))
        row.society = item.get("societe")
        row.client_name = item.get("client")
        row.subject = item.get("objet")
        row.status = item.get("statut")
        row.total_ht = as_float(item.get("totalHT"))
        row.total_ttc = as_float(item.get("ttc") or item.get("total") or item.get("montant"))
    elif isinstance(row, Payment):
        row.invoice_external_id = str(item.get("factureId") or "") or None
        row.payment_date = as_date(item.get("date"))
        row.society = item.get("societe")
        row.client_name = item.get("client")
        row.payment_mode = item.get("mode")
        row.reference = item.get("reference")
        row.amount = as_float(item.get("montant"))
        row.notes = item.get("notes")
    elif isinstance(row, Advance):
        row.advance_date = as_date(item.get("date")); row.society = item.get("societe"); row.beneficiary = item.get("beneficiaire") or item.get("client"); row.amount = as_float(item.get("montant")); row.status = item.get("statut")
    elif isinstance(row, CreditNote):
        row.invoice_external_id = str(item.get("factureId") or "") or None; row.credit_date = as_date(item.get("date")); row.society = item.get("societe"); row.client_name = item.get("client"); row.amount = as_float(item.get("montant")); row.reason = item.get("motif")
    elif isinstance(row, CashEntry):
        row.entry_date = as_date(item.get("date")); row.society = item.get("societe"); row.category = item.get("categorie"); row.label = item.get("libelle") or item.get("label"); row.amount = as_float(item.get("montant")); row.entry_type = item.get("type")
    row.data = {"_legacy": deepcopy(item), "collection": collection}
    db.flush()
    return simple_raw(row)


def stock_raw(row: Any) -> dict[str, Any]:
    data = getattr(row, "attributes", None) or getattr(row, "size_breakdown", None) or {}
    item = dict((data or {}).get("_legacy") or {}) if isinstance(data, dict) else {}
    item["id"] = item.get("id") or str(row.id)
    item["backendId"] = row.id
    return item


def upsert_stock(db: Session, model: type, item: dict[str, Any], collection: str) -> dict[str, Any]:
    row = db.get(model, as_int(item.get("backendId")) or 0)
    if model is StockArticle:
        code = str(item.get("code") or legacy_id(item))[:60]
        if not row:
            row = db.execute(select(StockArticle).where(StockArticle.code == code)).scalar_one_or_none()
        if not row:
            row = StockArticle(code=code, designation=str(item.get("designation") or item.get("nom") or "Article")); db.add(row)
        row.designation = str(item.get("designation") or item.get("nom") or row.designation); row.category = item.get("categorie"); row.society = item.get("societe"); row.quantity = as_float(item.get("quantite")); row.unit_price = as_float(item.get("prixUnitaire")); row.attributes = {**(row.attributes or {}), "_legacy": deepcopy(item)}
    elif model is Store:
        if not row: row = Store(name=str(item.get("nom") or "Magasin")); db.add(row)
        row.name = str(item.get("nom") or row.name); row.code = item.get("code"); row.society = item.get("societe"); row.address = item.get("adresse")
    elif model is Supplier:
        if not row: row = Supplier(name=str(item.get("raisonSociale") or item.get("nom") or "Fournisseur")); db.add(row)
        row.name = str(item.get("raisonSociale") or item.get("nom") or row.name); row.society = item.get("societe"); row.phone = item.get("telephone"); row.email = item.get("email"); row.address = item.get("adresse")
    elif model is StockMovement:
        article_id = as_int(item.get("articleBackendId") or item.get("article_id"))
        article = db.get(StockArticle, article_id) if article_id else None
        if not article:
            article = StockArticle(code="AUTO", designation="Article auto"); db.add(article); db.flush()
        if not row: row = StockMovement(article_id=article.id, movement_date=date.today(), movement_type="mouvement", quantity=0); db.add(row)
        row.article_id = article.id; row.movement_date = as_date(item.get("date")) or row.movement_date; row.movement_type = str(item.get("type") or row.movement_type); row.quantity = as_float(item.get("quantite") or row.quantity); row.unit_price = as_float(item.get("prixUnitaire") or row.unit_price); row.notes = item.get("notes"); row.size_breakdown = {**(row.size_breakdown or {}), "_legacy": deepcopy(item)}
    db.flush()
    return stock_raw(row)


def presence_to_item(row: DailyPresence) -> dict[str, Any]:
    item = dict((row.data or {}).get("_legacy") or {})
    item.update({"id": item.get("id") or str(row.id), "backendId": row.id, "date": date_out(row.presence_date), "agentId": item.get("agentId") or row.employee_id, "agentBackendId": row.employee_id, "employee_id": row.employee_id, "siteId": item.get("siteId") or row.site_id, "siteBackendId": row.site_id, "heureArrivee": row.arrival_time, "heureDepart": row.departure_time, "heureReleve": row.relief_time, "statut": row.status, "observations": row.notes})
    return item


def upsert_presence(db: Session, item: dict[str, Any], collection: str) -> dict[str, Any]:
    employee = employee_by_ref(db, item.get("employee_id") or item.get("agentBackendId") or item.get("agentId") or item.get("matricule"))
    if not employee:
        raise HTTPException(status_code=422, detail="Pointage refusé: employé SQL introuvable")
    row = db.get(DailyPresence, as_int(item.get("backendId")) or 0)
    # Fiches mensuelles (pointages) ont un champ "periode" (YYYY-MM) mais pas "date" →
    # utiliser le 1er du mois pour éviter la collision avec les entrées journalières feuillePresence
    _raw_date = item.get("date") or item.get("presence_date")
    if not _raw_date and item.get("periode"):
        _raw_date = str(item["periode"]) + "-01"
    presence_date = as_date(_raw_date) or date.today()
    if not row:
        row = db.execute(
            select(DailyPresence).where(
                DailyPresence.presence_date == presence_date,
                DailyPresence.employee_id == employee.id,
            ).order_by(DailyPresence.id.desc())
        ).scalars().first()
    if not row:
        row = DailyPresence(presence_date=presence_date, employee_id=employee.id)
        db.add(row)
    site = site_by_ref(db, item.get("siteBackendId") or item.get("site_id") or item.get("siteId"))
    row.presence_date = presence_date
    row.employee_id = employee.id
    if site: row.site_id = site.id
    if item.get("heureArrivee") is not None or item.get("arrival_time") is not None:
        row.arrival_time = item.get("heureArrivee") or item.get("arrival_time")
    if item.get("heureDepart") is not None or item.get("departure_time") is not None:
        row.departure_time = item.get("heureDepart") or item.get("departure_time")
    if item.get("heureReleve") is not None or item.get("relief_time") is not None:
        row.relief_time = item.get("heureReleve") or item.get("relief_time")
    row.status = item.get("statut") or item.get("status") or row.status or "present"
    if item.get("observations") is not None or item.get("notes") is not None:
        row.notes = item.get("observations") or item.get("notes")
    previous_legacy = ((row.data or {}).get("_legacy") if isinstance(row.data, dict) else {}) or {}
    row.data = {**(row.data or {}), "_legacy": {**deepcopy(previous_legacy), **deepcopy(item)}, "collection": collection}
    db.flush()
    return presence_to_item(row)


def ops_movement_to_item(row: OpsMovement) -> dict[str, Any]:
    item = dict((row.data or {}).get("_legacy") or {})
    item.update({
        "id": item.get("id") or str(row.id),
        "backendId": row.id,
        "ordreMouvementNumero": row.movement_number or item.get("ordreMouvementNumero") or item.get("mouvementNumero") or "",
        "mouvementNumero": row.movement_number or item.get("mouvementNumero") or "",
        "date": date_out(row.movement_date) or item.get("date") or item.get("dateDebut") or "",
        "dateDebut": date_out(row.movement_date) or item.get("dateDebut") or "",
        "agentId": item.get("agentId") or row.employee_id,
        "agentBackendId": row.employee_id,
        "employee_id": row.employee_id,
        "siteId": item.get("siteId") or row.site_id,
        "siteBackendId": row.site_id,
        "site_id": row.site_id,
        "groupe": row.group_code or item.get("groupe") or "",
        "mouvementMotif": row.movement_reason or item.get("mouvementMotif") or "",
        "mouvementType": row.movement_type or item.get("mouvementType") or "",
        "societe": row.society or item.get("societe") or "",
    })
    return item


def upsert_ops_movement(db: Session, item: dict[str, Any]) -> dict[str, Any]:
    ext_id = str(item.get("id") or item.get("backendId") or "").strip()
    mvt_num = str(item.get("ordreMouvementNumero") or item.get("mouvementNumero") or "").strip()
    row = db.get(OpsMovement, as_int(item.get("backendId")) or 0)
    if not row and ext_id:
        row = db.execute(select(OpsMovement).where(OpsMovement.external_id == ext_id)).scalar_one_or_none()
    if not row and mvt_num:
        row = db.execute(select(OpsMovement).where(OpsMovement.movement_number == mvt_num)).scalar_one_or_none()
    if not row:
        row = OpsMovement()
        db.add(row)
    employee = employee_by_ref(db, item.get("agentBackendId") or item.get("employee_id") or item.get("agentId") or item.get("matricule"))
    site = site_by_ref(db, item.get("siteBackendId") or item.get("site_id") or item.get("siteId"))
    row.external_id = ext_id or row.external_id
    row.movement_number = mvt_num or row.movement_number
    row.movement_date = as_date(item.get("date") or item.get("dateDebut") or item.get("movement_date"))
    row.employee_id = employee.id if employee else (as_int(item.get("agentBackendId") or item.get("employee_id")) or row.employee_id)
    row.site_id = site.id if site else (as_int(item.get("siteBackendId") or item.get("site_id")) or row.site_id)
    row.group_code = str(item.get("groupe") or item.get("group_code") or row.group_code or "")[:20] or None
    row.movement_type = str(item.get("mouvementMotif") or item.get("mouvementType") or item.get("natureMouvement") or row.movement_type or "")[:120] or None
    row.movement_reason = str(item.get("mouvementMotif") or item.get("natureMouvement") or item.get("motif") or row.movement_reason or "") or None
    row.society = str(item.get("societe") or item.get("society") or row.society or "")[:120] or None
    row.data = {**(row.data or {}), "_legacy": deepcopy(item)}
    db.flush()
    return ops_movement_to_item(row)


def incident_to_item(row: Incident) -> dict[str, Any]:
    item = dict((row.data or {}).get("_legacy") or {})
    item.update({
        "id": item.get("id") or str(row.id),
        "backendId": row.id,
        "date": date_out(row.incident_date) or item.get("date") or "",
        "heure": row.incident_time or item.get("heure") or "",
        "siteId": item.get("siteId") or row.site_id,
        "siteBackendId": row.site_id,
        "agentId": item.get("agentId") or row.employee_id,
        "agentBackendId": row.employee_id,
        "type": row.event_type or item.get("type") or "",
        "categorie": row.category or item.get("categorie") or "",
        "gravite": row.severity or item.get("gravite") or "",
        "sujet": row.subject or item.get("sujet") or "",
        "description": row.description or item.get("description") or "",
        "statut": row.status or item.get("statut") or "ouvert",
        "societe": row.society or item.get("societe") or "",
    })
    return item


def upsert_incident(db: Session, item: dict[str, Any]) -> dict[str, Any]:
    ext_id = str(item.get("id") or item.get("backendId") or "").strip()
    row = db.get(Incident, as_int(item.get("backendId")) or 0)
    if not row and ext_id:
        row = db.execute(select(Incident).where(Incident.external_id == ext_id)).scalar_one_or_none()
    if not row:
        row = Incident()
        db.add(row)
    employee = employee_by_ref(db, item.get("agentBackendId") or item.get("employee_id") or item.get("agentId"))
    site = site_by_ref(db, item.get("siteBackendId") or item.get("site_id") or item.get("siteId"))
    row.external_id = ext_id or row.external_id
    row.incident_date = as_date(item.get("date") or item.get("incident_date"))
    row.incident_time = str(item.get("heure") or "")[:10] or None
    row.employee_id = employee.id if employee else (as_int(item.get("agentBackendId") or item.get("employee_id")) or row.employee_id)
    row.site_id = site.id if site else (as_int(item.get("siteBackendId") or item.get("site_id")) or row.site_id)
    row.event_type = str(item.get("type") or row.event_type or "autre")[:80]
    row.category = str(item.get("categorie") or row.category or "")[:120] or None
    row.severity = str(item.get("gravite") or row.severity or "")[:40] or None
    row.subject = str(item.get("sujet") or row.subject or "")[:255] or None
    row.description = str(item.get("description") or row.description or "") or None
    row.status = str(item.get("statut") or row.status or "ouvert")[:40]
    row.society = str(item.get("societe") or item.get("society") or row.society or "")[:120] or None
    row.data = {**(row.data or {}), "_legacy": deepcopy(item)}
    db.flush()
    return incident_to_item(row)


def contract_to_item(row: Contract) -> dict[str, Any]:
    extra = row.data if isinstance(getattr(row, "data", None), dict) else {}
    return {
        **(extra.get("_legacy") or {}),
        "id": str(row.id),
        "backendId": row.id,
        "agentId": str(row.employee_id),
        "agent_id": row.employee_id,
        "typeContrat": row.contract_type or "",
        "poste": row.position or "",
        "dateDebut": date_out(row.start_date),
        "dateFin": date_out(row.end_date),
        "dateFinContrat": date_out(row.end_date),
        "dateFinEssai": date_out(row.trial_end_date),
        "salaireNet": row.salary_net or 0,
        "statut": row.status or "actif",
        "templateCode": row.template_code or "",
    }


def upsert_contract(db: Session, item: dict[str, Any]) -> dict[str, Any]:
    backend_id = as_int(item.get("backendId") or item.get("id"))
    row = db.get(Contract, backend_id or 0) if backend_id else None
    employee_id = as_int(item.get("agent_id") or item.get("agentId") or item.get("employee_id"))
    if not row:
        if not employee_id:
            raise HTTPException(status_code=422, detail="employee_id requis pour créer un contrat")
        row = Contract(employee_id=employee_id)
        db.add(row)
    row.employee_id = employee_id or row.employee_id
    row.contract_type = str(item.get("typeContrat") or item.get("contract_type") or row.contract_type or "CDD")
    row.position = item.get("poste") or item.get("position") or row.position
    row.start_date = as_date(item.get("dateDebut") or item.get("start_date"))
    row.end_date = as_date(item.get("dateFin") or item.get("dateFinContrat") or item.get("end_date"))
    row.trial_end_date = as_date(item.get("dateFinEssai") or item.get("trial_end_date"))
    row.salary_net = as_float(item.get("salaireNet") or item.get("salary_net")) or row.salary_net or 0
    row.status = str(item.get("statut") or item.get("status") or row.status or "actif")
    row.template_code = item.get("templateCode") or item.get("template_code") or row.template_code
    db.flush()
    return contract_to_item(row)


def list_collection(db: Session, name: str) -> list[dict[str, Any]]:
    if name == "candidats": return [candidate_to_item(r) for r in db.execute(select(Candidate).order_by(Candidate.id)).scalars().all()]
    if name in {"agents", "employees"}: return [employee_to_item(r) for r in db.execute(select(Employee).order_by(Employee.id)).scalars().all()]
    if name == "sites": return [site_to_item(r) for r in db.execute(select(Site).order_by(Site.id)).scalars().all()]
    if name == "clients": return [client_to_item(r) for r in db.execute(select(Client).order_by(Client.id)).scalars().all()]
    if name == "feuillePresence":
        cutoff = date.today() - timedelta(days=90)
        return [presence_to_item(r) for r in db.execute(select(DailyPresence).where(DailyPresence.presence_date >= cutoff).order_by(DailyPresence.id)).scalars().all() if (r.data or {}).get("collection") != "pointages"]
    if name in FINANCE_MODELS: return [simple_raw(r) for r in db.execute(select(FINANCE_MODELS[name]).order_by(FINANCE_MODELS[name].id)).scalars().all()]
    if name in STOCK_MODELS: return [stock_raw(r) for r in db.execute(select(STOCK_MODELS[name]).order_by(STOCK_MODELS[name].id)).scalars().all()]
    if name in {"assignments", "affectations"}: return [assignment_to_item(r) for r in db.execute(select(Assignment).order_by(Assignment.id)).scalars().all()]
    if name == "opsMouvements":
        cutoff = date.today() - timedelta(days=180)
        return [ops_movement_to_item(r) for r in db.execute(select(OpsMovement).where(OpsMovement.movement_date >= cutoff).order_by(OpsMovement.movement_date.desc(), OpsMovement.id.desc())).scalars().all()]
    if name == "incidents":
        cutoff = date.today() - timedelta(days=180)
        return [incident_to_item(r) for r in db.execute(select(Incident).where(Incident.incident_date >= cutoff).order_by(Incident.incident_date.desc(), Incident.id.desc())).scalars().all()]
    if name == "contrats": return [contract_to_item(r) for r in db.execute(select(Contract).order_by(Contract.id)).scalars().all()]
    raise HTTPException(status_code=400, detail=f"Collection SQL non prise en charge: {name}")


def upsert_item(db: Session, name: str, item: dict[str, Any]) -> dict[str, Any]:
    if name == "candidats": return upsert_candidate(db, item)
    if name in {"agents", "employees"}: return upsert_employee(db, item)
    if name == "sites": return upsert_site(db, item)
    if name == "clients": return upsert_client(db, item)
    if name == "feuillePresence": return upsert_presence(db, item, name)
    if name in FINANCE_MODELS: return upsert_finance(db, FINANCE_MODELS[name], item, name)
    if name in STOCK_MODELS: return upsert_stock(db, STOCK_MODELS[name], item, name)
    if name in {"assignments", "affectations"}:
        saved = upsert_assignment(db, item)
        return saved or dict(item)
    if name == "opsMouvements": return upsert_ops_movement(db, item)
    if name == "incidents": return upsert_incident(db, item)
    if name == "contrats": return upsert_contract(db, item)
    raise HTTPException(status_code=400, detail=f"Ecriture SQL non prise en charge: {name}")


def replace_collection(db: Session, name: str, data: list[Any] | dict[str, Any] | Any) -> list[dict[str, Any]]:
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail=f"{name} doit être une liste")
    if not data:
        return list_collection(db, name)
    return [upsert_item(db, name, dict(item)) for item in data if isinstance(item, dict)]


def delete_item(db: Session, name: str, item_id: str) -> dict[str, str]:
    model = None
    if name == "candidats": model = Candidate
    elif name in {"agents", "employees"}: model = Employee
    elif name == "sites": model = Site
    elif name == "clients": model = Client
    elif name == "feuillePresence": model = DailyPresence
    elif name in FINANCE_MODELS: model = FINANCE_MODELS[name]
    elif name in STOCK_MODELS: model = STOCK_MODELS[name]
    elif name == "opsMouvements": model = OpsMovement
    elif name == "incidents": model = Incident
    elif name == "contrats": model = Contract
    if model is None:
        raise HTTPException(status_code=400, detail="Suppression SQL non prise en charge")
    row = db.get(model, as_int(item_id) or 0)
    if not row and hasattr(model, "external_id"):
        row = db.execute(select(model).where(model.external_id == str(item_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Élément SQL introuvable")
    db.delete(row); db.commit()
    return {"deleted": item_id, "storage": "sql"}
