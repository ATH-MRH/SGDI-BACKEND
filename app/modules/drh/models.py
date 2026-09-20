from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, JSON, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100), index=True)
    last_name: Mapped[str] = mapped_column(String(100), index=True)
    father_name: Mapped[str | None] = mapped_column(String(120))
    mother_name: Mapped[str | None] = mapped_column(String(120))
    nin: Mapped[str | None] = mapped_column(String(30), unique=True)
    birth_date: Mapped[date | None] = mapped_column(Date)
    birth_place: Mapped[str | None] = mapped_column(String(120))
    family_status: Mapped[str | None] = mapped_column(String(80))
    children_count: Mapped[int] = mapped_column(Integer, default=0)
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(150))
    address: Mapped[str | None] = mapped_column(Text)
    commune: Mapped[str | None] = mapped_column(String(120))
    wilaya: Mapped[str | None] = mapped_column(String(120))
    position: Mapped[str | None] = mapped_column(String(150), index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    status: Mapped[str] = mapped_column(String(40), default="actif", index=True)
    contract_type: Mapped[str | None] = mapped_column(String(80))
    salary_net: Mapped[float] = mapped_column(Float, default=0)
    recruit_date: Mapped[date | None] = mapped_column(Date)
    trial_end_date: Mapped[date | None] = mapped_column(Date)
    contract_end_date: Mapped[date | None] = mapped_column(Date, index=True)
    locked: Mapped[int] = mapped_column(Integer, default=1)
    extra: Mapped[dict | None] = mapped_column(JSON)


class Candidate(Base, TimestampMixin):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100), index=True)
    last_name: Mapped[str] = mapped_column(String(100), index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(150))
    desired_position: Mapped[str | None] = mapped_column(String(150))
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    expected_salary: Mapped[float | None] = mapped_column(Float)
    recruiter_opinion: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="nouvelle", index=True)
    data: Mapped[dict | None] = mapped_column(JSON)


class Contract(Base, TimestampMixin):
    __tablename__ = "contracts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    contract_type: Mapped[str] = mapped_column(String(80), default="")
    position: Mapped[str | None] = mapped_column(String(150))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    trial_end_date: Mapped[date | None] = mapped_column(Date)
    salary_net: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(40), default="actif", index=True)
    template_code: Mapped[str | None] = mapped_column(String(80))
    content: Mapped[str | None] = mapped_column(Text)


class ContractTemplate(Base, TimestampMixin):
    __tablename__ = "contract_templates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(180), index=True)
    contract_type: Mapped[str] = mapped_column(String(80), index=True)
    position: Mapped[str | None] = mapped_column(String(150), index=True)
    function: Mapped[str | None] = mapped_column(String(150), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    file_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(120), default="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    docx_content: Mapped[bytes] = mapped_column(LargeBinary)
    placeholders: Mapped[dict | None] = mapped_column(JSON)
    active: Mapped[int] = mapped_column(Integer, default=1, index=True)
    uploaded_by: Mapped[str | None] = mapped_column(String(120))


class ContractConditionalClause(Base, TimestampMixin):
    __tablename__ = "contract_conditional_clauses"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("contract_templates.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(180))
    condition_field: Mapped[str] = mapped_column(String(100), default="function")
    condition_operator: Mapped[str] = mapped_column(String(40), default="equals")
    condition_value: Mapped[str] = mapped_column(String(180), index=True)
    placeholder: Mapped[str] = mapped_column(String(100), default="CLAUSES_CONDITIONNELLES")
    content: Mapped[str] = mapped_column(Text)
    active: Mapped[int] = mapped_column(Integer, default=1, index=True)


class GeneratedContract(Base, TimestampMixin):
    __tablename__ = "generated_contracts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("contract_templates.id", ondelete="SET NULL"), index=True)
    contract_id: Mapped[int | None] = mapped_column(ForeignKey("contracts.id", ondelete="SET NULL"), index=True)
    reference: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(180))
    contract_type: Mapped[str] = mapped_column(String(80), index=True)
    position: Mapped[str | None] = mapped_column(String(150))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    output_format: Mapped[str] = mapped_column(String(20), default="docx")
    file_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(120))
    file_content: Mapped[bytes] = mapped_column(LargeBinary)
    values: Mapped[dict | None] = mapped_column(JSON)
    generated_by: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(40), default="genere", index=True)


class Leave(Base, TimestampMixin):
    __tablename__ = "leaves"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    leave_type: Mapped[str] = mapped_column(String(80), default="conge")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="instance", index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)


class Sanction(Base, TimestampMixin):
    __tablename__ = "sanctions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    infraction_date: Mapped[date] = mapped_column(Date)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), index=True)
    site_name: Mapped[str | None] = mapped_column(String(180))
    fault: Mapped[str] = mapped_column(Text)
    sanction_type: Mapped[str] = mapped_column(String(100))
    suspension_days: Mapped[int] = mapped_column(Integer, default=0)
    sanction_start: Mapped[date | None] = mapped_column(Date)
    next_return_date: Mapped[date | None] = mapped_column(Date)


class Document(Base, TimestampMixin):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    owner_type: Mapped[str] = mapped_column(String(40), index=True)
    owner_id: Mapped[int] = mapped_column(Integer, index=True)
    label: Mapped[str] = mapped_column(String(150))
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_path: Mapped[str | None] = mapped_column(String(500))
    mime_type: Mapped[str | None] = mapped_column(String(120))
    uploaded_by: Mapped[str | None] = mapped_column(String(120))


# P1 finalisation DRH Next — décision produit : "un enregistrement RH audité et réversible,
# pas un simple booléen" (voir rapport de mission). Audit préalable : "blacklist" n'existait
# jusqu'ici QUE comme une valeur libre de Employee.status ("blackliste"/"blacklisté"/...,
# orthographes incohérentes selon les modules — ui/service.py, erp/service.py,
# client_portal/service.py, loans/routes.py), sans motif, sans auteur, sans historique, sans
# réversibilité tracée. Aucun modèle audité équivalent n'existe ailleurs dans le code ->
# nouvelle table dédiée, conforme au schéma proposé. "society" reste une COPIE dénormalisée
# en texte au moment du blacklistage (comme EmployeeLoanRequest.society) : Employee.society
# lui-même est un simple champ texte, aucune table Society/société avec ID n'existe dans ce
# backend — un society_id serait une FK vers rien.
class EmployeeBlacklistEntry(Base, TimestampMixin):
    __tablename__ = "employee_blacklist_entries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # "active" | "levee"
    created_by: Mapped[str | None] = mapped_column(String(120))
    lifted_at: Mapped[datetime | None] = mapped_column(DateTime)
    lifted_by: Mapped[str | None] = mapped_column(String(120))
    lift_reason: Mapped[str | None] = mapped_column(Text)
    # Non prévu dans le schéma proposé, ajouté pour que "réversible" soit réellement exact :
    # Employee.status est mis en miroir sur "blackliste" à la création (consommateurs
    # existants inchangés : ui/service.py, erp/service.py, client_portal/service.py,
    # loans/routes.py continuent de le lire tel quel) — sans cette colonne, lever le
    # blacklistage ne pourrait que DEVINER le statut antérieur (ex. toujours "actif"), ce qui
    # serait faux pour un employé qui était "suspendu" avant d'être blacklisté.
    previous_status: Mapped[str | None] = mapped_column(String(30))
