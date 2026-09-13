"""Domaine transverse Alertes (Lot 0.6-A) — moteur déterministe, sans IA.

Ce module ne dépend d'aucun autre domaine métier : DRH et OPS restent la
source de vérité pour leurs propres données (Employee, DailyPresence...),
les détecteurs ici se contentent de les LIRE. Rien dans DRH/OPS n'écrit ici,
et rien ici n'écrit dans DRH/OPS.
"""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class AlertRule(Base, TimestampMixin):
    """Catalogue des règles de détection — configuration système, pas des données
    métier. Une ligne par (rule_key, rule_version)."""

    __tablename__ = "alert_rules"
    __table_args__ = (UniqueConstraint("rule_key", "rule_version", name="uq_alert_rules_key_version"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    rule_key: Mapped[str] = mapped_column(String(120), index=True)
    rule_version: Mapped[int] = mapped_column(Integer, default=1)
    label: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    module_key: Mapped[str] = mapped_column(String(60), index=True)
    feature_key: Mapped[str | None] = mapped_column(String(80))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    severity_base: Mapped[str] = mapped_column(String(20), default="info")
    configuration_json: Mapped[dict | None] = mapped_column(JSON)


class Alert(Base, TimestampMixin):
    """Une occurrence active (ou passée) d'une règle sur une entité métier précise.
    dedup_key garantit qu'une même occurrence active ne produit qu'une seule ligne :
    les runs suivants mettent à jour cette même ligne au lieu d'en créer une autre."""

    __tablename__ = "alerts"
    __table_args__ = (UniqueConstraint("dedup_key", name="uq_alerts_dedup_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    rule_key: Mapped[str] = mapped_column(String(120), index=True)
    rule_version: Mapped[int] = mapped_column(Integer, default=1)
    source_type: Mapped[str] = mapped_column(String(60), index=True)
    source_id: Mapped[str] = mapped_column(String(60), index=True)
    society: Mapped[str] = mapped_column(String(150), index=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="open", index=True)
    severity: Mapped[str] = mapped_column(String(20), default="info", index=True)
    score: Mapped[int] = mapped_column(Integer, default=0)
    confidence: Mapped[int] = mapped_column(Integer, default=100)
    title: Mapped[str] = mapped_column(String(240))
    summary: Mapped[str | None] = mapped_column(Text)
    first_detected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_detected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    occurrence_count: Mapped[int] = mapped_column(Integer, default=1)
    assigned_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime)
    acknowledged_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    treated_at: Mapped[datetime | None] = mapped_column(DateTime)
    treated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    ignored_at: Mapped[datetime | None] = mapped_column(DateTime)
    ignored_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    ignore_reason: Mapped[str | None] = mapped_column(Text)
    deferred_until: Mapped[datetime | None] = mapped_column(DateTime)
    dedup_key: Mapped[str] = mapped_column(String(300), index=True)


class AlertEvidence(Base, TimestampMixin):
    """Preuves factuelles horodatées attachées à une alerte — jamais mutées, une
    nouvelle ligne par observation (permet de voir l'évolution dans le temps)."""

    __tablename__ = "alert_evidence"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    evidence_type: Mapped[str] = mapped_column(String(60))
    evidence_key: Mapped[str] = mapped_column(String(120))
    evidence_value_json: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)
    observed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AlertHistory(Base, TimestampMixin):
    """Piste d'audit : toute action utilisateur ou système sur une alerte produit une
    ligne. Jamais mutée, jamais supprimée."""

    __tablename__ = "alert_history"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(40), index=True)
    previous_status: Mapped[str | None] = mapped_column(String(30))
    new_status: Mapped[str | None] = mapped_column(String(30))
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reason: Mapped[str | None] = mapped_column(Text)
    metadata_json: Mapped[dict | None] = mapped_column(JSON)
    correlation_id: Mapped[str | None] = mapped_column(String(80), index=True)


class DetectionRun(Base, TimestampMixin):
    """Une exécution d'un détecteur — observabilité de l'orchestrateur, jamais de
    donnée métier ici."""

    __tablename__ = "detection_runs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    detector_key: Mapped[str] = mapped_column(String(120), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(30), default="running", index=True)
    scanned_count: Mapped[int] = mapped_column(Integer, default=0)
    detected_count: Mapped[int] = mapped_column(Integer, default=0)
    created_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    error_summary: Mapped[str | None] = mapped_column(Text)
