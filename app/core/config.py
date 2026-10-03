from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SGDI FastAPI Backend"
    app_env: str = "production"
    app_debug: bool = False
    log_level: str = "INFO"
    api_prefix: str = "/api"
    allow_public_registration: bool = False
    # Anti brute-force : nombre d'échecs autorisés par IP avant blocage temporaire.
    login_max_attempts: int = 8
    login_window_seconds: int = 300
    cors_allowed_origins: str | None = None
    # Noms d'hôte qui servent le Portail RH mobile (séparés par des virgules).
    # Permet d'ajouter un domaine de test (ex. portail-rh-test.irongs.com) sans toucher au code.
    portal_hostnames: str = "portail-rh.irongs.com"
    startup_maintenance_enabled: bool = False
    public_employee_pages_require_token: bool = True
    max_photo_upload_bytes: int = 5_000_000
    # Attendance Core — anti-rebond : un nouvel événement du même employé moins de N secondes
    # après le précédent (double scan, visage resté devant la caméra, retry réseau) est rendu
    # comme « déjà enregistré », sans effet. Un vrai départ reste possible au-delà.
    attendance_min_event_gap_seconds: int = 300
    # Tolérance métier avant qu'une arrivée soit signalée en retard par rapport à l'horaire
    # prévu du planning (rotation). Réglage d'exploitation, pas une règle légale.
    attendance_late_tolerance_minutes: int = 15
    # Feuilles de présence par rotation (lot 1) — valeurs INITIALES proposées à la configuration
    # d'un site (le moteur ne code en dur ni 8 h ni 4 groupes ; chaque site a ses paramètres).
    attendance_rotation_default_shift_minutes: int = 480
    attendance_rotation_default_groups: int = 4
    # Une ARRIVÉE moins de N minutes avant le début d'une rotation appartient à cette rotation
    # (prise de poste anticipée), pas à la rotation en cours.
    attendance_sheet_early_margin_minutes: int = 60
    # Une feuille CLOSED reste modifiable par les SORTIES de ses propres entrées jusqu'à son
    # archivage ; au-delà du plus long cycle ouvert (30 h), un départ manquant est constaté.
    attendance_sheet_archive_after_hours: int = 36
    # Interrupteurs par lot du Planning intelligent (activation progressive, jamais implicite).
    # Feuilles : coupe-circuit global (chaque site reste soumis à sa propre configuration).
    rotation_sheets_enabled: bool = True
    # Apprentissage des groupes / cycles : désactivé par défaut ; il faut ce drapeau ET un mode
    # LEARNING ou ACTIVE posé explicitement sur le site.
    rotation_learning_enabled: bool = False
    # Apprentissage — valeurs INITIALES, surchargées site par site (paramètres d'exploitation,
    # non calibrés sur la production ; voir docs/attendance-rotation-learning.md).
    rotation_learning_window_sheets: int = 180          # fenêtre glissante de feuilles clôturées
    rotation_learning_link_threshold: float = 0.6       # recouvrement minimal feuille ↔ groupe
    rotation_learning_core_share: float = 0.5           # présence minimale pour être « noyau » d'un groupe
    rotation_learning_min_group_sheets: int = 3         # feuilles avant qu'un groupe soit consolidé
    rotation_learning_min_observations: int = 6         # rotations observées avant de proposer un groupe
    rotation_learning_probable_threshold: float = 0.7   # confiance à partir de laquelle l'appartenance est PROBABLE
    rotation_learning_recent_observations: int = 5      # profondeur de la composante « récence »
    rotation_learning_arrival_tolerance_minutes: int = 60
    rotation_learning_weight_share: float = 0.6
    rotation_learning_weight_time: float = 0.2
    rotation_learning_weight_recency: float = 0.2
    rotation_learning_min_site_sheets: int = 12         # rotations observées avant de quitter LEARNING
    rotation_learning_stable_member_ratio: float = 0.8  # part des salariés suivis devant être PROBABLE
    rotation_learning_stable_sheet_ratio: float = 0.8   # part des feuilles rattachées à un groupe consolidé
    rotation_learning_cycle_threshold: float = 0.9      # concordance minimale d'un cycle
    rotation_learning_min_cycle_comparisons: int = 12
    rotation_learning_max_cycle_slots: int = 120
    # Comparaison prévu / réel (lot 3) : un groupe APPRIS ne sert de référence attendue qu'à
    # partir de cette confiance ; N écarts consécutifs vers le même groupe ⇒ changement durable possible.
    rotation_learning_alert_confidence: float = 0.8
    rotation_learning_persistent_deviations: int = 3
    # Biométrie faciale — DÉSACTIVÉE par défaut (jamais d'activation implicite en production).
    # Activation = décision explicite : BIOMETRIC_ENABLED=true + clé de chiffrement dédiée des
    # gabarits (Fernet, générée hors dépôt) + modèles présents et vérifiés (empreintes SHA-256,
    # voir docs/biometrics.md). Sans clé, aucun gabarit ne peut être enregistré.
    biometric_enabled: bool = False
    biometric_template_key: str | None = None
    biometric_models_dir: str = "/app/models/biometrics"
    # Mode Test biométrique (caméra du navigateur : Mac, PC, tablette, smartphone) — DÉSACTIVÉ
    # par défaut et INDÉPENDANT de biometric_enabled : il peut fonctionner sans activer le vrai
    # pointage facial et n'écrit JAMAIS de présence (voir docs/biometrics.md, § Mode Test).
    biometric_test_mode_enabled: bool = False
    # Enrôlement supervisé (aperçu + confirmation humaine) SANS activer le pointage facial :
    # prépare un pilote. Faux par défaut ; BIOMETRIC_ENABLED l'autorise aussi.
    biometric_enrollment_enabled: bool = False
    biometric_test_mode_max_per_minute: int = 30
    # LOT B — DRH → Fiche de position → Photo employé : préparation automatique de la référence
    # faciale lorsqu'une photo est ajoutée/actualisée (caméra ou import) depuis la fiche. FAUX par
    # défaut : comportement inchangé. N'active PAS le pointage facial (biometric_enabled) et ne
    # traite jamais les photos déjà présentes. Exige aussi l'enrôlement autorisé et la clé.
    drh_facial_reference_auto_sync_enabled: bool = False
    # Règle de consentement pour cette préparation : "explicit" (défaut, accord admissible exigé)
    # ou "no_objection" (aucun accord manuel exigé ; un REFUS ou un RETRAIT enregistré bloque).
    facial_reference_consent_mode: str = "explicit"
    # LOT C1 — DRH → Fiche de position → « Prendre la photo » avec une tablette / un smartphone
    # de pointage autorisé comme caméra distante (session courte, supervisée, auditée). FAUX par
    # défaut : seule la caméra de l'ordinateur est proposée et la borne n'interroge aucune commande.
    # Exige la clé de chiffrement (photo candidate chiffrée). N'active PAS le pointage facial.
    drh_remote_photo_capture_enabled: bool = False
    # À activer SEULEMENT après scripts/rename_public_photos.py --apply : refuse les photos dont
    # le nom est prévisible (ex. matricule.jpg). Désactivé par défaut pour ne casser aucune photo.
    photos_require_unguessable_names: bool = False
    # Les candidatures du portail public arrivent dans cette file de recrutement.
    public_candidate_default_society: str = "IRON GLOBAL SÉCURITÉ"
    admin_system_password: str | None = None
    admin_system_username: str | None = None
    admin_initial_username: str | None = None
    admin_initial_password: str | None = None
    # Procédure exceptionnelle uniquement. Le secret n'est jamais appliqué au démarrage.
    admin_recovery_enabled: bool = False
    admin_recovery_secret: str | None = None
    portal_password_reset_ttl_minutes: int = 15
    # Compte module Facturation : créé UNIQUEMENT si un mot de passe fort est fourni ici.
    fac_initial_password: str | None = None
    # LOT 12A (finalisation DRH Next, §16 observabilité) : hash du commit déployé, injecté
    # par la plateforme de déploiement (convention Coolify : variable SOURCE_COMMIT). Aucune
    # valeur fabriquée si absent — exposé tel quel (None) par /api/version, jamais une chaîne
    # inventée qui ferait croire à une valeur réelle.
    source_commit: str | None = None

    database_url: str

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 720

    anthropic_api_key: str | None = None
    assistant_paid_ai_enabled: bool = False
    # Agent IA ATLAS. Nécessite ANTHROPIC_API_KEY.
    assistant_agent_enabled: bool = False
    assistant_agent_model: str = "claude-opus-4-8"
    # Repli automatique sur un modèle local (Ollama) si Claude échoue / pour éviter les coûts.
    assistant_fallback_enabled: bool = True
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "gpt-oss:120b"

    contract_email_alerts_enabled: bool = True
    contract_email_alert_window_days: int = 30
    contract_email_alert_days: str | None = None
    contract_email_alert_recipients: str | None = None
    contract_email_alert_interval_hours: int = 24

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_from_name: str = "SGDI"
    convocation_from_email: str = "adm.conv@irongs.com"
    convocation_from_name: str = "Service recrutement IRONGS"
    convocation_copy_email: str = "adm.conv@irongs.com"
    convocation_smtp_host: str = "king.o2switch.net"
    convocation_smtp_port: int = 465
    convocation_smtp_username: str = "adm.conv@irongs.com"
    convocation_smtp_password: str | None = None
    convocation_smtp_use_ssl: bool = True
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @model_validator(mode="after")
    def require_postgresql_in_production(self) -> "Settings":
        if self.app_env.strip().lower() in {"production", "prod"}:
            database_url = self.database_url.strip().lower()
            if not database_url.startswith(("postgresql://", "postgresql+psycopg2://", "postgres://")):
                raise ValueError("DATABASE_URL doit cibler PostgreSQL en production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
