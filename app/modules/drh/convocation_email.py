import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import settings


def send_candidate_convocation_email(
    *, recipient: str, candidate_name: str, date: str, time: str, location: str, purpose: str
) -> None:
    if not settings.smtp_host:
        raise RuntimeError("Serveur SMTP non configuré")
    message = EmailMessage()
    message["From"] = formataddr((settings.convocation_from_name, settings.convocation_from_email))
    message["To"] = recipient
    message["Reply-To"] = settings.convocation_from_email
    message["Subject"] = "Convocation à un entretien de recrutement — IRONGS"
    message.set_content(
        f"Bonjour {candidate_name},\n\n"
        "Nous vous invitons à un entretien de recrutement selon les informations suivantes :\n\n"
        f"Date : {date}\n"
        f"Heure : {time}\n"
        f"Lieu : {location}\n"
        f"Objet : {purpose}\n\n"
        "Merci de vous présenter à l'heure indiquée avec les documents utiles à votre candidature.\n\n"
        "Service recrutement IRONGS\n"
        f"{settings.convocation_from_email}"
    )
    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            _authenticate_and_send(smtp, message)
        return
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        _authenticate_and_send(smtp, message)


def _authenticate_and_send(smtp: smtplib.SMTP, message: EmailMessage) -> None:
    if settings.smtp_username and settings.smtp_password:
        smtp.login(settings.smtp_username, settings.smtp_password)
    smtp.send_message(message)
