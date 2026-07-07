import asyncio
import logging
import os
import smtplib
from datetime import date, datetime
from email.message import EmailMessage
from email.utils import formataddr

from sqlalchemy import Date, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.config import settings
from app.db.base import Base, TimestampMixin
from app.db.session import SessionLocal
from app.modules.auth.models import User
from app.modules.drh.models import Employee


logger = logging.getLogger("sgdi.contract_email_alerts")
_scheduler_task: asyncio.Task | None = None


class ContractEmailAlertLog(Base, TimestampMixin):
    __tablename__ = "contract_email_alert_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    alert_key: Mapped[str] = mapped_column(String(260), unique=True, index=True)
    employee_id: Mapped[int] = mapped_column(Integer, index=True)
    contract_end_date: Mapped[date] = mapped_column(Date, index=True)
    days_left: Mapped[int] = mapped_column(Integer, index=True)
    recipient: Mapped[str] = mapped_column(String(180), index=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="sent", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)


def _parse_recipients(value: str | None) -> list[str]:
    if not value:
        return []
    normalized = value.replace(";", ",").replace("\n", ",")
    return [part.strip() for part in normalized.split(",") if part.strip()]


def _parse_alert_days(value: str | None) -> set[int] | None:
    if not value:
        return None
    days: set[int] = set()
    for part in value.replace(";", ",").split(","):
        try:
            day = int(part.strip())
        except ValueError:
            continue
        if day >= 0:
            days.add(day)
    return days or None


def _admin_recipients(db: Session) -> list[str]:
    users = db.query(User).filter(User.is_active.is_(True), User.email.isnot(None)).all()
    recipients: list[str] = []
    for user in users:
        role = (user.role or "").strip().lower()
        if role in {"admin", "rh", "drh"} or "rh" in role:
            recipients.append(user.email.strip())
    return recipients


def _alert_recipients(db: Session) -> list[str]:
    recipients = _parse_recipients(settings.contract_email_alert_recipients)
    if not recipients:
        recipients = _admin_recipients(db)
    return sorted({email.lower(): email for email in recipients}.values())


def _smtp_ready() -> bool:
    return bool(settings.smtp_host and (settings.smtp_from_email or settings.smtp_username))


def _full_name(employee: Employee) -> str:
    return " ".join(part for part in [employee.first_name, employee.last_name] if part).strip() or employee.code


def _format_date(value: date) -> str:
    return value.strftime("%d/%m/%Y")


def _alert_key(employee: Employee, recipient: str, days_left: int) -> str:
    return f"contract-end:{employee.id}:{employee.contract_end_date.isoformat()}:{days_left}:{recipient.lower()}"


def _contracts_to_alert(
    db: Session,
    alert_days: set[int] | None,
    alert_window_days: int,
) -> list[tuple[Employee, int]]:
    today = date.today()
    employees = (
        db.query(Employee)
        .filter(Employee.contract_end_date.isnot(None))
        .filter(Employee.status != "archive")
        .all()
    )
    rows: list[tuple[Employee, int]] = []
    for employee in employees:
        days_left = (employee.contract_end_date - today).days
        if alert_days is not None and days_left in alert_days:
            rows.append((employee, days_left))
        elif alert_days is None and 0 <= days_left <= alert_window_days:
            rows.append((employee, days_left))
    return rows


def _message_body(rows: list[tuple[Employee, int]]) -> str:
    lines = [
        "Bonjour,",
        "",
        "Les contrats suivants arrivent a echeance :",
        "",
    ]
    for employee, days_left in rows:
        lines.append(
            "- {name} ({code}) : fin le {end_date}, dans {days} jour(s). Societe: {society}. Type: {contract_type}.".format(
                name=_full_name(employee),
                code=employee.code,
                end_date=_format_date(employee.contract_end_date),
                days=days_left,
                society=employee.society or "-",
                contract_type=employee.contract_type or "-",
            )
        )
    lines.extend(["", "Message automatique SGDI."])
    return "\n".join(lines)


def _send_email(recipient: str, rows: list[tuple[Employee, int]]) -> None:
    from_email = settings.smtp_from_email or settings.smtp_username
    message = EmailMessage()
    message["From"] = formataddr((settings.smtp_from_name, from_email))
    message["To"] = recipient
    message["Subject"] = f"SGDI - {len(rows)} contrat(s) a echeance"
    message.set_content(_message_body(rows))

    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            _login_and_send(smtp, message)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        _login_and_send(smtp, message)


def _login_and_send(smtp: smtplib.SMTP, message: EmailMessage) -> None:
    if settings.smtp_username and settings.smtp_password:
        smtp.login(settings.smtp_username, settings.smtp_password)
    smtp.send_message(message)


def run_contract_email_alert_check() -> int:
    if not settings.contract_email_alerts_enabled:
        return 0
    if not _smtp_ready():
        logger.info("Alertes email contrat inactives: SMTP non configure")
        return 0

    alert_days = _parse_alert_days(settings.contract_email_alert_days)
    alert_window_days = max(settings.contract_email_alert_window_days, 0)
    with SessionLocal() as db:
        recipients = _alert_recipients(db)
        if not recipients:
            logger.info("Alertes email contrat inactives: aucun destinataire configure")
            return 0

        candidates = _contracts_to_alert(db, alert_days, alert_window_days)
        if not candidates:
            return 0

        sent_count = 0
        for recipient in recipients:
            pending: list[tuple[Employee, int]] = []
            for employee, days_left in candidates:
                key = _alert_key(employee, recipient, days_left)
                already_sent = db.query(ContractEmailAlertLog).filter(ContractEmailAlertLog.alert_key == key).first()
                if already_sent is None:
                    pending.append((employee, days_left))

            if not pending:
                continue

            _send_email(recipient, pending)
            for employee, days_left in pending:
                db.add(
                    ContractEmailAlertLog(
                        alert_key=_alert_key(employee, recipient, days_left),
                        employee_id=employee.id,
                        contract_end_date=employee.contract_end_date,
                        days_left=days_left,
                        recipient=recipient,
                    )
                )
            db.commit()
            sent_count += len(pending)

        if sent_count:
            logger.info("Alertes email contrat envoyees: %s", sent_count)
        return sent_count


async def _contract_email_alert_loop() -> None:
    interval = max(settings.contract_email_alert_interval_hours, 1) * 3600
    while True:
        try:
            await asyncio.to_thread(run_contract_email_alert_check)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Verification alertes email contrat echouee: %s", exc)
        await asyncio.sleep(interval)


def start_contract_email_alert_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return
    worker_id = os.environ.get("GUNICORN_WORKER_ID")
    if worker_id is not None and worker_id != "1":
        logger.info("Planificateur alertes email inactif dans le worker %s (actif uniquement dans le worker 1)", worker_id)
        return
    _scheduler_task = asyncio.get_running_loop().create_task(_contract_email_alert_loop())
    logger.info("Planificateur alertes email contrat demarre")


def stop_contract_email_alert_scheduler() -> None:
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
