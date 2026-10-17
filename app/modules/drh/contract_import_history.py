"""Snapshots historiques de préparation, sans autorisation de nouvel import exceptionnel."""
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import DateTime, Integer, JSON, String, or_, select
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

VALUE_FIELDS = ('start_date', 'end_date', 'position', 'client_site', 'contract_type',
                'duration', 'trial', 'template_id', 'salary', 'payment', 'bank', 'iban')

class ContractImportOneoffGrant(Base):
    __tablename__ = 'drh_contract_import_oneoff_grants'
    batch_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    # Sans FK : le journal exceptionnel doit survivre à la purge des sessions Excel.
    session_id: Mapped[str] = mapped_column(String(64), unique=True)
    file_sha256: Mapped[str] = mapped_column(String(64))
    authorized_by_user_id: Mapped[int] = mapped_column(Integer)
    authorized_by_username: Mapped[str] = mapped_column(String(120))
    authorized_at: Mapped[datetime] = mapped_column(DateTime)
    candidate_ids: Mapped[list] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(String(180))
    preparation: Mapped[dict] = mapped_column(JSON)



def reject_archived_file(db, file_sha256):
    # La préparation historique ne doit jamais devenir un import créateur.
    if db.scalar(select(ContractImportOneoffGrant.batch_key).where(
            ContractImportOneoffGrant.file_sha256 == file_sha256).limit(1)):
        raise HTTPException(409, 'Fichier de préparation archivé : aucune nouvelle création autorisée')


def deny_creation(db, session):
    archived = db.scalar(select(ContractImportOneoffGrant.batch_key).where(or_(
        ContractImportOneoffGrant.session_id == session.public_id,
        ContractImportOneoffGrant.file_sha256 == session.file_sha256)).limit(1))
    if (archived or session.status == 'prepared'
            or (session.result or {}).get('preparation_only')
            or ((session.plan or {}).get('preview') or {}).get('preparation_only')):
        raise HTTPException(409, 'Préparation historique : création désactivée')
