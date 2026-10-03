"""Portrait de présentation DRH — table de cache (hors des modèles DRH importés par la migration
initiale `create_all` : seule la migration additive 20261004_0001 la crée et la retire)."""
from sqlalchemy import ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

class EmployeePortrait(Base, TimestampMixin):
    """Portrait de PRÉSENTATION (Fiche de position : visage agrandi, fond blanc), dérivé de la
    photo de la fiche. Cache régénérable : lié à l'empreinte SHA-256 de la photo source, il est
    recalculé dès que la photo change. La photo source n'est jamais modifiée ; ce portrait
    n'est jamais utilisé par la biométrie. Servi uniquement par une route authentifiée."""
    __tablename__ = "employee_portraits"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), unique=True, index=True)
    source_sha256: Mapped[str] = mapped_column(String(64))
    method: Mapped[str] = mapped_column(String(20))        # SEGMENTED | CROPPED | CENTERED
    image: Mapped[bytes] = mapped_column(LargeBinary)       # JPEG 300×400
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
