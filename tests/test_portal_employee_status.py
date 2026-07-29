from types import SimpleNamespace

from app.modules.portal.routes import _employee_portal_block_reason


def employee(status: str = "actif", extra: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(status=status, extra=extra or {})


def test_portal_blocks_non_active_employment_statuses() -> None:
    for status in ("suspendu", "sortant", "inactif", "blacklisté", "licencié"):
        assert _employee_portal_block_reason(employee(status), "2026-07-29")


def test_portal_blocks_active_disciplinary_layoff() -> None:
    row = employee(
        extra={
            "_legacy": {
                "sanctions": [
                    {
                        "type": "Mise à pied",
                        "dateMiseAPiedDebut": "2026-07-28",
                        "dateMiseAPiedFin": "2026-07-31",
                    }
                ]
            }
        }
    )
    assert "mise à pied" in _employee_portal_block_reason(row, "2026-07-29")


def test_portal_allows_active_employee_outside_layoff_period() -> None:
    row = employee(
        extra={
            "sanctions": [
                {
                    "type": "Mise à pied",
                    "dateMiseAPiedDebut": "2026-07-20",
                    "dateMiseAPiedFin": "2026-07-22",
                }
            ]
        }
    )
    assert _employee_portal_block_reason(row, "2026-07-29") == ""
