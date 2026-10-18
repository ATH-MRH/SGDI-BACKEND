"""« QR code non reconnu » au Pointeur : chaque refus d'une adresse de badge porte désormais sa cause.

Constat de production (2026-10-18) : un vrai scan refusé laissait dans l'audit `QR_UNRECOGNIZED`,
`qr=badge`, sans badge ni employé — la même trace pour un ancien badge imprimé sans signature, une
lecture altérée par la douchette (« ? », « = », « & ») ou une signature fausse. Le poste affichait le
même message pour tous. Aucun contrôle n'est relâché ici : tout ce qui était refusé l'est encore,
sans pointage ; seuls le message et la cause tracée (jamais l'adresse ni la signature) changent.
Données fictives uniquement."""
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.modules.auth.models import AuditEvent
from tests.module_cleanup import purge_rows_created_by_this_module  # noqa: F401 (fixture autouse)
from tests.test_pointeur_audit_p0 import POINTEUR, _account, _employee, _headers, _site
from tests.test_pointeur_badge_historique import _historical_qr
from tests.test_pointeur_badge_qr import _badge, _events, _qr, _refused, _scan

UNSIGNED = ("BADGE_UNSIGNED", "Ancien badge sans signature — à réimprimer depuis le Studio Badges", "error", 400)
MISREAD = ("QR_MISREAD", "QR mal lu par le lecteur — présentez-le à nouveau ou utilisez la caméra", "error", 400)
UNRECOGNIZED = ("QR_UNRECOGNIZED", "QR code non reconnu", "error", 400)


@pytest.fixture
def setup(client, db, auth_headers):
    site = _site(db)
    historical, studio_emp = _employee(db, site=site), _employee(db, site=site)
    badge = _badge(db, studio_emp)
    headers = _headers(client, _account(db, modules=("pointeur",), sites=(site,)), POINTEUR)
    return SimpleNamespace(site=site, historical=historical, studio_emp=studio_emp, badge=badge, headers=headers,
                           hqr=_historical_qr(client, auth_headers, historical), sqr=_qr(studio_emp, badge))


def _last_refusal(db):
    db.expire_all()
    row = db.execute(select(AuditEvent).where(AuditEvent.action == "attendance.qr_scan.refused")
                     .order_by(AuditEvent.id.desc())).scalars().first()
    return row, (json.loads(row.new_state) if isinstance(row.new_state, str) else row.new_state)


def _variants(s):
    sig_h = s.hqr.split("t=")[1]
    sig_s = s.sqr.split("t=")[1].split("&")[0]
    host = s.hqr.split("/public/")[0]
    return [
        # (libellé, QR, refus attendu, cause tracée)
        ("ancien badge sans signature (id)", f"{host}/public/badge/{s.historical.id}", UNSIGNED, "sans_signature"),
        ("ancien badge sans signature (matricule)", f"{host}/public/badge/{s.historical.code}", UNSIGNED, "sans_signature"),
        ("ancien badge sans signature, route /api", f"{host}/api/public/badge/{s.historical.id}", UNSIGNED, "sans_signature"),
        ("ancien badge sans signature, barre finale", f"{host}/public/badge/{s.historical.id}/", UNSIGNED, "sans_signature"),
        ("spécimen du Studio", "https://drh.irongs.com/public/badge/specimen", UNRECOGNIZED, "specimen"),
        ("« ? » transformé en « , »", s.hqr.replace("?", ","), MISREAD, "lecture_alteree"),
        ("« ? » perdu", s.hqr.replace("?", ""), MISREAD, "lecture_alteree"),
        ("« = » transformé en « + »", s.hqr.replace("t=", "t+"), MISREAD, "lecture_alteree"),
        ("« = » transformé en « ) »", s.hqr.replace("t=", "t)"), MISREAD, "lecture_alteree"),
        ("Studio : « & » transformé en « 1 »", s.sqr.replace("&", "1"), MISREAD, "lecture_alteree"),
        ("Studio : « & » perdu", s.sqr.replace("&", ""), MISREAD, "lecture_alteree"),
        ("Studio : « ? » perdu", s.sqr.replace("?", ""), MISREAD, "lecture_alteree"),
        ("signature tronquée", s.hqr.replace(sig_h, sig_h[:-1]), UNRECOGNIZED, "format_invalide"),
        ("signature en majuscules", s.hqr.replace(sig_h, sig_h.upper()), UNRECOGNIZED, "format_invalide"),
        ("matricule avec b= sans signature", f"{host}/public/badge/{s.studio_emp.code}?b={s.badge.id}", UNRECOGNIZED, "format_invalide"),
        ("historique : signature fausse", s.hqr.replace(sig_h, "0" * 32), UNRECOGNIZED, "signature_invalide"),
        ("Studio : signature fausse", s.sqr.replace(sig_s, "0" * 32), UNRECOGNIZED, "signature_invalide"),
        ("historique : employé inexistant bien formé", s.hqr.replace(f"/badge/{s.historical.id}?", "/badge/999999999?"),
         UNRECOGNIZED, "signature_invalide"),
    ]


def test_every_badge_refusal_names_its_cause_without_recording_or_leaking_anything(client, db, setup, caplog):
    for label, qr, expected, fault in _variants(setup):
        response = _scan(client, setup.headers, qr, setup.site)
        _refused(response, *expected)
        row, state = _last_refusal(db)
        assert state["fault"] == fault, label
        assert state["recorded"] is False and row.resource_id is None, label          # rien n'est révélé ni lié
        for secret in (setup.hqr.split("t=")[1], setup.sqr.split("t=")[1].split("&")[0]):
            assert secret not in response.text and secret not in str(state) and secret not in caplog.text, label
    assert _events(db, setup.historical) == [] and _events(db, setup.studio_emp) == []


def test_intact_badges_are_still_recognised_after_the_refusals(client, db, setup):
    for qr in (setup.hqr.replace("?", ","), setup.sqr.replace("&", "")):
        assert _scan(client, setup.headers, qr, setup.site).status_code == 400
    assert _scan(client, setup.headers, setup.hqr, setup.site).status_code == 201
    assert _scan(client, setup.headers, setup.sqr, setup.site).status_code == 201
    assert len(_events(db, setup.historical)) == 1 and len(_events(db, setup.studio_emp)) == 1


def test_a_misread_qr_cannot_be_rescued_into_a_valid_scan(client, db, setup):
    """La cause est un diagnostic, jamais une réparation : aucune adresse altérée n'est « corrigée »
    côté serveur pour être acceptée (sinon une signature déplacée deviendrait un contournement)."""
    sig = setup.hqr.split("t=")[1]
    for qr in (setup.hqr.replace("?", ","), setup.hqr.replace("t=", "t+"), f"{setup.hqr.split('?')[0]}t={sig}"):
        assert _scan(client, setup.headers, qr, setup.site).status_code == 400
    assert _events(db, setup.historical) == []


def test_unsigned_badge_on_another_employee_reveals_nothing(client, db, setup):
    """Un QR sans signature désigne une référence devinable : le refus ne dit pas si elle existe."""
    for ref in (setup.historical.id, 999999999):
        response = _scan(client, setup.headers, f"https://drh.irongs.com/public/badge/{ref}", setup.site)
        _refused(response, *UNSIGNED)
        assert setup.historical.last_name not in response.text and setup.historical.code not in response.text
