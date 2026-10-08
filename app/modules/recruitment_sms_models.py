from sqlalchemy import Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class RecruitmentSMSChallenge(Base):
    __tablename__ = 'recruitment_sms_challenges'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), index=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    code_digest: Mapped[str] = mapped_column(String(64))
    sms_ciphertext: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[int] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default='queued', index=True)
    lease_digest: Mapped[str | None] = mapped_column(String(64))
    lease_until: Mapped[int] = mapped_column(Integer, default=0)
    send_attempts: Mapped[int] = mapped_column(Integer, default=0)
    token_digest: Mapped[str | None] = mapped_column(String(64), unique=True)
    token_expires_at: Mapped[int | None] = mapped_column(Integer)
    submitted_reference: Mapped[str | None] = mapped_column(String(40))
    # Suivi SMSGate, distinct de `status` (cycle de vie du code) : queued, sending, accepted
    # (pris en charge par la passerelle), processed, sent, delivered, failed, expired.
    gateway_message_id: Mapped[str | None] = mapped_column(String(36))
    delivery_status: Mapped[str] = mapped_column(String(20), default='queued', server_default='queued', index=True)
    delivery_error: Mapped[str | None] = mapped_column(String(120))
    next_attempt_at: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    status_checked_at: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    accepted_at: Mapped[int | None] = mapped_column(Integer)
    sent_at: Mapped[int | None] = mapped_column(Integer)
    delivered_at: Mapped[int | None] = mapped_column(Integer)
    __table_args__ = (Index('uq_recruitment_sms_challenges_gateway_message_id', 'gateway_message_id', unique=True),)


class RecruitmentSMSRate(Base):
    __tablename__ = 'recruitment_sms_rates'
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class RecruitmentSMSGateway(Base):
    __tablename__ = 'recruitment_sms_gateway'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_seen: Mapped[int] = mapped_column(Integer, default=0)
