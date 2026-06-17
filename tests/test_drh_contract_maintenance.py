from datetime import date

from app.modules.drh.contract_maintenance import add_months, update_all_employee_contract_terms
from app.modules.drh.models import Contract, Employee
from app.modules.irongs.models import SgdiRecord


def test_add_months_keeps_calendar_month_end():
    assert add_months(date(2025, 1, 31), 12) == date(2026, 1, 31)
    assert add_months(date(2024, 2, 29), 12) == date(2025, 2, 28)


def test_update_all_employee_contract_terms_sets_cdd_12_months(db):
    employee = Employee(
        code="EMP-CONTRACT-TERMS",
        first_name="Contrat",
        last_name="Test",
        society="TEST_SOC",
        status="actif",
        contract_type="CDI",
        recruit_date=date(2026, 6, 1),
        contract_end_date=None,
        extra={"dureeContrat": "6m", "_legacy": {"typeContrat": "CDI", "dateRecrutement": "2026-06-01"}},
    )
    db.add(employee)
    db.flush()
    contract = Contract(
        employee_id=employee.id,
        contract_type="CDI",
        position="Agent",
        start_date=date(2026, 6, 1),
        end_date=None,
        salary_net=0,
        status="actif",
    )
    record = SgdiRecord(
        collection="agents",
        item_id="EMP-CONTRACT-TERMS",
        position=1,
        kind="item",
        data={"backendId": employee.id, "typeContrat": "CDI", "dateRecrutement": "2026-06-01"},
        label="Contrat Test",
    )
    db.add_all([contract, record])
    db.commit()

    result = update_all_employee_contract_terms(db)
    db.refresh(employee)
    db.refresh(contract)
    db.refresh(record)

    assert result.employees_updated >= 1
    assert employee.contract_type == "CDD"
    assert employee.contract_end_date == date(2027, 6, 1)
    assert employee.extra["dureeContrat"] == "12m"
    assert employee.extra["_legacy"]["dateFinContrat"] == "2027-06-01"
    assert contract.contract_type == "CDD"
    assert contract.end_date == date(2027, 6, 1)
    assert record.data["typeContrat"] == "CDD"
    assert record.data["dureeContrat"] == "12m"
    assert record.data["dateFinContrat"] == "2027-06-01"

