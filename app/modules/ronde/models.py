import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class RondeCircuit(Base, TimestampMixin):
    """Définit un circuit de ronde : séquence ordonnée de checkpoints sur un site."""
    __tablename__ = "ronde_circuits"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    site: Mapped[str | None] = mapped_column(String(180), index=True)
    societe: Mapped[str | None] = mapped_column(String(180))
    description: Mapped[str | None] = mapped_column(Text)
    duree_prevue_min: Mapped[int] = mapped_column(Integer, default=60)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    checkpoints: Mapped[list["RondeCheckpoint"]] = relationship(
        "RondeCheckpoint",
        back_populates="circuit",
        order_by="RondeCheckpoint.position",
        cascade="all, delete-orphan",
    )
    executions: Mapped[list["RondeExecution"]] = relationship(
        "RondeExecution", back_populates="circuit"
    )


class RondeCheckpoint(Base, TimestampMixin):
    """Point de contrôle à scanner lors d'une ronde."""
    __tablename__ = "ronde_checkpoints"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    circuit_id: Mapped[int] = mapped_column(
        ForeignKey("ronde_circuits.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(180))
    position: Mapped[int] = mapped_column(Integer, default=1)
    qr_token: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, default=lambda: uuid.uuid4().hex
    )
    gps_lat: Mapped[float | None] = mapped_column(Float)
    gps_lng: Mapped[float | None] = mapped_column(Float)
    gps_radius_m: Mapped[int] = mapped_column(Integer, default=50)
    description: Mapped[str | None] = mapped_column(Text)

    circuit: Mapped["RondeCircuit"] = relationship("RondeCircuit", back_populates="checkpoints")
    scans: Mapped[list["RondeScan"]] = relationship("RondeScan", back_populates="checkpoint")


class RondeExecution(Base, TimestampMixin):
    """Instance d'une ronde effectuée par un garde."""
    __tablename__ = "ronde_executions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    circuit_id: Mapped[int] = mapped_column(ForeignKey("ronde_circuits.id"), index=True)
    circuit_name: Mapped[str | None] = mapped_column(String(180))
    guard_matricule: Mapped[str] = mapped_column(String(50), index=True)
    guard_name: Mapped[str | None] = mapped_column(String(180))
    site: Mapped[str | None] = mapped_column(String(180))
    societe: Mapped[str | None] = mapped_column(String(180))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    statut: Mapped[str] = mapped_column(String(30), default="en_cours")
    # en_cours | terminee | incomplete
    total_checkpoints: Mapped[int] = mapped_column(Integer, default=0)
    scanned_checkpoints: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(Text)

    circuit: Mapped["RondeCircuit"] = relationship("RondeCircuit", back_populates="executions")
    scans: Mapped[list["RondeScan"]] = relationship(
        "RondeScan", back_populates="execution", cascade="all, delete-orphan"
    )


class RondeScan(Base, TimestampMixin):
    """Enregistrement d'un scan de checkpoint lors d'une exécution."""
    __tablename__ = "ronde_scans"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    execution_id: Mapped[int] = mapped_column(
        ForeignKey("ronde_executions.id", ondelete="CASCADE"), index=True
    )
    checkpoint_id: Mapped[int] = mapped_column(
        ForeignKey("ronde_checkpoints.id"), index=True
    )
    checkpoint_name: Mapped[str | None] = mapped_column(String(180))
    checkpoint_position: Mapped[int] = mapped_column(Integer, default=0)
    scanned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    scan_method: Mapped[str] = mapped_column(String(20), default="qr")  # qr | gps | both
    gps_lat: Mapped[float | None] = mapped_column(Float)
    gps_lng: Mapped[float | None] = mapped_column(Float)
    gps_accuracy: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(Text)

    execution: Mapped["RondeExecution"] = relationship("RondeExecution", back_populates="scans")
    checkpoint: Mapped["RondeCheckpoint"] = relationship("RondeCheckpoint", back_populates="scans")
