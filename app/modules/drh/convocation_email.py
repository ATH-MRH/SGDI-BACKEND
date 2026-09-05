import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import settings


def send_candidate_convocation_email(
    *, recipient: str, candidate_name: str, date: str, time: str, location: str, purpose: str
) -> None:
    smtp_host = settings.convocation_smtp_host or settings.smtp_host
    smtp_port = settings.convocation_smtp_port or settings.smtp_port
    smtp_username = settings.convocation_smtp_username or settings.smtp_username
    smtp_password = settings.convocation_smtp_password or settings.smtp_password
    if not smtp_host:
        raise RuntimeError("Serveur SMTP des convocations non configuré")
    if not smtp_username or not smtp_password:
        raise RuntimeError("Identifiants SMTP de adm.conv@irongs.com non configurés")
    message = EmailMessage()
    message["From"] = formataddr((settings.convocation_from_name, settings.convocation_from_email))
    message["To"] = recipient
    if settings.convocation_copy_email:
        message["Bcc"] = settings.convocation_copy_email
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
    if settings.convocation_smtp_use_ssl:
        with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20) as smtp:
            _authenticate_and_send(smtp, message, smtp_username, smtp_password)
        return
    with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        _authenticate_and_send(smtp, message, smtp_username, smtp_password)


def _authenticate_and_send(
    smtp: smtplib.SMTP, message: EmailMessage, smtp_username: str, smtp_password: str
) -> None:
    smtp.login(smtp_username, smtp_password)
    smtp.send_message(message)
