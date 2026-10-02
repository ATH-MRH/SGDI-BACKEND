"""Biométrie faciale et caméras — stockage spécialisé, séparé de la fiche employé.

- La photo administrative reste celle de la fiche (Employee.extra["photo"]) ; elle n'est
  jamais copiée ici. Un gabarit (embedding) n'est JAMAIS stocké dans Employee.extra, jamais
  renvoyé au frontend, jamais journalisé : colonne chiffrée (Fernet) accessible au seul
  backend.
- Le consentement est un état administratif tracé (source, date, référence, version du
  texte d'information, auteur) — pas un booléen frontend.
- Les secrets caméra sont chiffrés et ne sortent jamais du backend.
Voir docs/biometrics.md.
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin

# Consentement
CONSENT_CONTRACT = "contract_confirmed"     # accord général du contrat, confirmé par les RH
CONSENT_EXPLICIT = "explicit_confirmed"     # accord explicite (document RH, enrôlement numérique)
CONSENT_PENDING = "pending"
CONSENT_REFUSED = "refused"
CONSENT_WITHDRAWN = "withdrawn"
CONSENT_STATUSES = frozenset({CONSENT_CONTRACT, CONSENT_EXPLICIT, CONSENT_PENDING, CONSENT_REFUSED, CONSENT_WITHDRAWN})
CONSENT_ADMISSIBLE = frozenset({CONSENT_CONTRACT, CONSENT_EXPLICIT})
CONSENT_SOURCES = frozenset({"EMPLOYMENT_CONTRACT", "HR_DOCUMENT", "DIGITAL_ENROLLMENT", "OTHER_AUTHORIZED_PROCESS"})

# Gabarits
TEMPLATE_ACTIVE = "ACTIVE"
TEMPLATE_PENDING_REVIEW = "PENDING_REVIEW"   # doublon possible : décision humaine obligatoire
TEMPLATE_INACTIVE = "INACTIVE"               # désactivé, remplacé, consentement retiré, départ
TEMPLATE_REJECTED = "REJECTED"               # doublon confirmé / refus à la revue


class BiometricConsent(Base, TimestampMixin):
    """Historique append-only : la ligne la plus récente d'un employé fait foi."""
    __tablename__ = "biometric_consents"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30))
    source: Mapped[str] = mapped_column(String(40))
    consent_date: Mapped[datetime | None] = mapped_column(DateTime)
    proof_reference: Mapped[str | None] = mapped_column(String(200))
    notice_version: Mapped[str] = mapped_column(String(20))
    recorded_by: Mapped[str | None] = mapped_column(String(120))
    comment: Mapped[str | None] = mapped_column(Text)


class BiometricTemplate(Base, TimestampMixin):
    __tablename__ = "biometric_templates"
    __table_args__ = (Index("ix_biometric_templates_employee_status", "employee_id", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    embedding_encrypted: Mapped[bytes] = mapped_column(LargeBinary)   # jamais exposé
    engine: Mapped[str] = mapped_column(String(60))                   # moteur + version des modèles
    config_version: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(30))                   # EMPLOYEE_PHOTO | CAMERA
    source_ref: Mapped[str | None] = mapped_column(String(200))       # chemin photo / caméra, sans image
    quality: Mapped[dict | None] = mapped_column(JSON)                # scores (jamais l'image)
    consent_id: Mapped[int | None] = mapped_column(ForeignKey("biometric_consents.id", ondelete="SET NULL"))
    society: Mapped[str | None] = mapped_column(String(150), index=True)   # société de l'employé à l'enrôlement
    site_id: Mapped[int | None] = mapped_column(Integer, index=True)       # site d'affectation à l'enrôlement
    duplicate_of_employee_id: Mapped[int | None] = mapped_column(Integer)
    duplicate_score: Mapped[float | None] = mapped_column(Float)
    created_by: Mapped[str | None] = mapped_column(String(120))
    activated_at: Mapped[datetime | None] = mapped_column(DateTime)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime)
    status_reason: Mapped[str | None] = mapped_column(Text)


# Synchronisation automatique photo DRH → référence faciale (LOT B)
SYNC_PROCESSING = "PROCESSING"                  # demande enregistrée, analyse en cours
SYNC_READY = "READY"                            # référence active issue de cette photo
SYNC_PHOTO_INVALID = "PHOTO_INVALID"            # photo inexploitable (visage, qualité)
SYNC_REVIEW_REQUIRED = "REVIEW_REQUIRED"        # visage différent / ambigu / doublon possible
SYNC_ENGINE_UNAVAILABLE = "ENGINE_UNAVAILABLE"  # moteur, clé ou erreur technique : à reprendre
SYNC_BLOCKED = "BLOCKED"                        # refus / retrait / accord requis / statut RH
SYNC_STATUSES = frozenset({SYNC_PROCESSING, SYNC_READY, SYNC_PHOTO_INVALID, SYNC_REVIEW_REQUIRED,
                           SYNC_ENGINE_UNAVAILABLE, SYNC_BLOCKED})


class BiometricPhotoSync(Base, TimestampMixin):
    """État de la DERNIÈRE synchronisation demandée pour un employé (une ligne par employé ;
    l'historique est dans l'audit). Ne contient ni image, ni gabarit, ni score : seulement
    l'empreinte SHA-256 de la photo traitée, l'état et un code de raison."""
    __tablename__ = "biometric_photo_syncs"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), unique=True, index=True)
    photo_fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(30), index=True)
    reason_code: Mapped[str | None] = mapped_column(String(40))
    reason_detail: Mapped[str | None] = mapped_column(String(200))    # motif lisible (ex. « Image floue »)
    source: Mapped[str] = mapped_column(String(30))                   # DRH_CAMERA | DRH_UPLOAD
    requested_by: Mapped[str | None] = mapped_column(String(120))
    requested_at: Mapped[datetime] = mapped_column(DateTime)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    template_id: Mapped[int | None] = mapped_column(Integer)          # référence produite (active ou en revue)
    previous_reference_kept: Mapped[bool] = mapped_column(Boolean, default=False)


class BiometricConfig(Base):
    """Seuils versionnés : chaque modification crée une nouvelle version (jamais d'écrasement)."""
    __tablename__ = "biometric_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(Integer, unique=True)
    recognition_threshold: Mapped[float] = mapped_column(Float)
    review_margin: Mapped[float] = mapped_column(Float)
    duplicate_threshold: Mapped[float] = mapped_column(Float)
    liveness_threshold: Mapped[float] = mapped_column(Float)
    quality_min_detection_score: Mapped[float] = mapped_column(Float)
    quality_min_face_px: Mapped[int] = mapped_column(Integer)
    quality_min_sharpness: Mapped[float] = mapped_column(Float)
    cooldown_seconds: Mapped[int] = mapped_column(Integer)
    provenance: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class CameraModel(Base, TimestampMixin):
    """Catalogue administrable (fabricant/modèle) — jamais de modèle inventé dans le code."""
    __tablename__ = "camera_models"
    __table_args__ = (UniqueConstraint("manufacturer", "model", name="uq_camera_models_manufacturer_model"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    manufacturer: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    adapter: Mapped[str] = mapped_column(String(40))   # DAHUA | GENERIC_RTSP
    resolution: Mapped[str | None] = mapped_column(String(40))
    capabilities: Mapped[dict | None] = mapped_column(JSON)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


CAMERA_USAGES = frozenset({"ATTENDANCE", "ENROLLMENT", "ATTENDANCE_AND_ENROLLMENT"})
CAMERA_ROLES = frozenset({"ENTRY", "EXIT", "ENROLLMENT", "SECONDARY"})


class Camera(Base, TimestampMixin):
    __tablename__ = "cameras"
    __table_args__ = (UniqueConstraint("site_id", "name", name="uq_cameras_site_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    camera_model_id: Mapped[int | None] = mapped_column(ForeignKey("camera_models.id", ondelete="SET NULL"))
    manufacturer: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    adapter: Mapped[str] = mapped_column(String(40))
    society: Mapped[str] = mapped_column(String(150), index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    location: Mapped[str | None] = mapped_column(String(120))
    serial_number: Mapped[str | None] = mapped_column(String(80))
    host: Mapped[str] = mapped_column(String(255))             # adresse réseau (LAN / passerelle)
    http_port: Mapped[int | None] = mapped_column(Integer)
    rtsp_port: Mapped[int | None] = mapped_column(Integer)
    connection_type: Mapped[str] = mapped_column(String(30), default="LAN")
    channel: Mapped[int] = mapped_column(Integer, default=1)
    resolution: Mapped[str | None] = mapped_column(String(40))
    fps: Mapped[int | None] = mapped_column(Integer)
    profiles: Mapped[dict | None] = mapped_column(JSON)       # CAPTURE_HIGH_QUALITY / RECOGNITION_REALTIME / PREVIEW_LOW_BANDWIDTH
    capabilities: Mapped[dict | None] = mapped_column(JSON)
    usage: Mapped[str] = mapped_column(String(40), default="ATTENDANCE")
    role: Mapped[str] = mapped_column(String(20), default="ENTRY")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Pilote : une caméra ne pointe QUE si elle est explicitement activée ici (en plus de
    # BIOMETRIC_ENABLED). Faux par défaut ; coupure immédiate par caméra ou par site.
    facial_attendance_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    credentials_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)   # jamais exposé
    last_check: Mapped[dict | None] = mapped_column(JSON)


# ── Terminaux faciaux autorisés (tablette / smartphone) ─────────────────────────────────────
# Circuit de production distinct du Mode Test et des caméras lues par le serveur : un
# navigateur ne devient un terminal qu'après association par un administrateur (code à usage
# unique) ; il s'authentifie ensuite par une clé de signature P-256 NON EXTRACTIBLE générée sur
# l'appareil (le serveur ne conserve que la clé publique : aucun secret stocké côté serveur).
TERMINAL_TYPES = frozenset({"TABLET_ANDROID", "SMARTPHONE_ANDROID", "IPHONE", "IPAD", "CAMERA_RTSP"})
MOBILE_TERMINAL_TYPES = frozenset({"TABLET_ANDROID", "SMARTPHONE_ANDROID", "IPHONE", "IPAD"})


class BiometricTerminal(Base, TimestampMixin):
    __tablename__ = "biometric_terminals"
    __table_args__ = (UniqueConstraint("site_id", "name", name="uq_biometric_terminals_site_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)   # identifiant immuable
    name: Mapped[str] = mapped_column(String(80))
    terminal_type: Mapped[str] = mapped_column(String(30))
    society: Mapped[str] = mapped_column(String(150), index=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    location: Mapped[str | None] = mapped_column(String(120))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Pointage facial du terminal : FAUX par défaut, activé explicitement (en plus de
    # BIOMETRIC_ENABLED) ; le QR du terminal n'en dépend pas.
    facial_attendance_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    public_key: Mapped[dict | None] = mapped_column(JSON)                  # JWK P-256 public (jamais secret)
    key_fingerprint: Mapped[str | None] = mapped_column(String(64))
    pairing_code_hash: Mapped[str | None] = mapped_column(String(64), index=True)   # SHA-256, jamais le code
    pairing_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    paired_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    revoked_reason: Mapped[str | None] = mapped_column(Text)
    config_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)   # incrémentée à chaque changement
    meta: Mapped[dict | None] = mapped_column(JSON)                        # non sensible (libellé appareil…)
    created_by: Mapped[str | None] = mapped_column(String(120))


class BiometricTerminalChallenge(Base):
    """Défi serveur à usage unique : une rafale n'est acceptée que liée à un défi frais de CE
    terminal, de CE site et de la configuration en vigueur ; consommé à la première utilisation."""
    __tablename__ = "biometric_terminal_challenges"

    id: Mapped[int] = mapped_column(primary_key=True)
    terminal_id: Mapped[int] = mapped_column(ForeignKey("biometric_terminals.id", ondelete="CASCADE"), index=True)
    site_id: Mapped[int] = mapped_column(Integer)
    config_version: Mapped[int] = mapped_column(Integer)
    terminal_config_version: Mapped[int] = mapped_column(Integer)
    nonce_hash: Mapped[str] = mapped_column(String(64), unique=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime)


class BiometricFrameDigest(Base):
    """Empreintes SHA-256 des images déjà reçues d'un terminal (jamais l'image) : une trame
    rejouée à l'octet près est refusée, quel que soit le défi. Purgées après quelques jours."""
    __tablename__ = "biometric_frame_digests"

    id: Mapped[int] = mapped_column(primary_key=True)
    digest: Mapped[str] = mapped_column(String(64), unique=True)
    terminal_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
