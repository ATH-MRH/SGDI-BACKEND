"""Sessions d'import Excel de candidats — table créée par la migration additive 20261010_0001."""
from datetime import datetime

from sqlalchemy import DateTime, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class CandidateImportSession(Base, TimestampMixin):
    """Session courte reliant l'analyse d'un classeur à sa confirmation.

    Liée à l'utilisateur et à son périmètre au moment de l'analyse. `workbook` (contenu des
    cellules) n'existe que le temps de la session : il est effacé à la confirmation, à
    l'annulation et à l'expiration. `result` ne conserve que des compteurs et, par ligne, le
    numéro, le résultat et le motif — jamais le contenu personnel du fichier.
    `none_as_null` : un contenu effacé est un vrai NULL SQL, pas la valeur JSON « null »."""
    __tablename__ = "candidate_import_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    username: Mapped[str | None] = mapped_column(String(120))
    scope_key: Mapped[str | None] = mapped_column(String(64))       # empreinte du périmètre société
    scope_label: Mapped[str | None] = mapped_column(String(150))
    file_name: Mapped[str] = mapped_column(String(255))
    file_sha256: Mapped[str] = mapped_column(String(64))
    file_size: Mapped[int] = mapped_column(Integer)
    # uploaded → previewed → processing → completed | failed ; cancelled ; expired
    status: Mapped[str] = mapped_column(String(20), index=True)
    workbook: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    plan: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    result: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
