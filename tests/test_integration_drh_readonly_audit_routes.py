"""Candidat intégré : les écritures ajoutées par l'audit Pointeur (PR #10) après l'inventaire du
contrat « DRH lecture seule » obéissent à la même règle — module propriétaire exigé — et les
capacités annoncées restent celles que les routes acceptent."""
import pytest

from tests.test_drh_attendance_readonly_contract import (  # noqa: F401 (fixtures du contrat)
    _granted, control_center_headers, drh_pointage_headers, drh_wide_headers, ops_headers,
)

REGULARIZE_EXIT = "/api/attendance/events/999999/regularize-exit"
BODY = {"exit_at": "2026-10-01T14:00:00+01:00", "reason": "Oubli de sortie — contrat d'intégration"}


def test_drh_alone_cannot_regularize_an_exit(client, drh_wide_headers):
    """DRH seul, même avec toutes les actions : arrêté par la porte de module, avant toute lecture."""
    response = client.post(REGULARIZE_EXIT, headers=drh_wide_headers, json=BODY)
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("profile", ["control_center_headers", "ops_headers", "drh_pointage_headers"])
def test_owner_modules_reach_the_exit_regularization_route(client, request, profile):
    """Modules propriétaires : la route répond sur le fond (arrivée inconnue), pas par un refus."""
    response = client.post(REGULARIZE_EXIT, headers=request.getfixturevalue(profile), json=BODY)
    assert response.status_code == 404, response.text


def test_capabilities_use_the_combined_write_rules(client, drh_wide_headers, ops_headers):
    """Les capacités passent par les règles d'écriture combinées (module propriétaire par route
    ET préfixes d'écriture du terminal terrain) : mêmes fonctions que le contrôle d'accès."""
    from app.modules.attendance.routes import WRITE_CAPABILITIES
    from app.modules.auth.dependencies import request_module_keys, route_module_keys

    class _Request:
        def __init__(self, method, path):
            self.method, self.url = method, type("U", (), {"path": path})()

    for method, path, _action in WRITE_CAPABILITIES.values():
        assert request_module_keys(_Request(method, path)) == route_module_keys(method, path)
    # Terminal terrain : lecture des présences OPS, jamais d'écriture par ces routes (audit P0).
    assert "pointeur" in route_module_keys("GET", "/api/ops/pointage")
    assert "pointeur" not in route_module_keys("POST", "/api/ops/pointage")
    assert _granted(client, drh_wide_headers) == set() and _granted(client, ops_headers)
