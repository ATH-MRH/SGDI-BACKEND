import smtplib
from datetime import date as calendar_date
from html import escape
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
    appointment_date = calendar_date.fromisoformat(date)
    french_date = appointment_date.strftime("%d/%m/%Y")
    arabic_date = appointment_date.strftime("%Y/%m/%d")
    phone = "0770 112 034"
    arabic_location = "76 شارع أحمد سايح" if location.strip().casefold() == "76 rue ahmed sayeh" else location
    arabic_purpose = {"entretien de recrutement": "مقابلة توظيف", "entretien": "مقابلة"}.get(purpose.strip().casefold(), purpose)
    french_intro = "NOUS VOUS INVITONS À UN ENTRETIEN DE RECRUTEMENT SELON LES INFORMATIONS SUIVANTES :"
    french_documents = "MERCI DE VOUS PRÉSENTER À L’HEURE INDIQUÉE AVEC LES DOCUMENTS UTILES À VOTRE CANDIDATURE."
    french_contact = "EN CAS D’IMPOSSIBILITÉ DE VOUS PRÉSENTER, VEUILLEZ CONTACTER LE NUMÉRO SUIVANT :"
    arabic_intro = "ندعوكم لحضور مقابلة توظيف وفق التفاصيل التالية:"
    arabic_documents = "يرجى الحضور في الموعد المحدد مع الوثائق المتعلقة بترشحكم."
    arabic_contact = "في حال تعذّر الحضور، يرجى الاتصال بالرقم التالي:"
    french_fields = [("DATE", french_date), ("HEURE", time), ("LIEU", location.upper()), ("OBJET", purpose.upper())]
    arabic_fields = [("التاريخ", arabic_date), ("الوقت", time), ("المكان", arabic_location), ("الموضوع", arabic_purpose)]
    message.set_content(
        f"BONJOUR {candidate_name.upper()},\n\n{french_intro}\n\n"
        + "\n".join(f"{label} : {value}" for label, value in french_fields)
        + f"\n\n{french_documents}\n\n{french_contact} {phone}.\n\n"
        + f"مرحبًا {candidate_name}،\n\n{arabic_intro}\n\n"
        + "\n".join(f"{label}: \u2066{value}\u2069" for label, value in arabic_fields)
        + f"\n\n{arabic_documents}\n\n{arabic_contact} \u2066{phone}\u2069.\n\n"
        + f"SERVICE RECRUTEMENT IRONGS / مصلحة التوظيف\n{settings.convocation_from_email}"
    )
    french_details = "<br>".join(f"<strong>{label} : {escape(value)}</strong>" for label, value in french_fields)
    arabic_details = "<br>".join(f'<strong>{label}: <bdi dir="auto">{escape(value)}</bdi></strong>' for label, value in arabic_fields)
    rtl_paragraph = '<p align="right" dir="rtl" style="text-align:right;direction:rtl;margin:16px 0">'
    message.add_alternative(
        '<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;line-height:1.7">'
        f'<section lang="fr" dir="ltr"><p>BONJOUR {escape(candidate_name.upper())},</p><p>{french_intro}</p>'
        f'<p>{french_details}</p><p>{french_documents}</p><p>{french_contact} <strong style="white-space:nowrap">{phone}</strong>.</p></section><hr>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse"><tr>'
        '<td lang="ar" dir="rtl" align="right" style="width:100%;text-align:right;direction:rtl;font-family:Arial,sans-serif;line-height:1.7">'
        f'{rtl_paragraph}مرحبًا <span dir="ltr" style="unicode-bidi:embed">{escape(candidate_name)}</span>،</p>{rtl_paragraph}{arabic_intro}</p>'
        f'{rtl_paragraph}{arabic_details}</p>{rtl_paragraph}{arabic_documents}</p>{rtl_paragraph}{arabic_contact} <strong dir="ltr" style="display:inline-block;direction:ltr;unicode-bidi:embed;white-space:nowrap">{phone}</strong>.</p>'
        '</td></tr></table>'
        f'<p dir="ltr">SERVICE RECRUTEMENT IRONGS / مصلحة التوظيف<br>{escape(settings.convocation_from_email)}</p></body></html>',
        subtype="html",
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
