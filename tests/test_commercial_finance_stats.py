from datetime import date, timedelta

from app.modules.commercial.models import Client
from app.modules.finance_models import Invoice, Payment
from app.modules.ui.service import _commercial_stats, _finance_stats


def test_finance_summary_uses_sql_amounts_and_society_scope(db):
    for society, status, amount in [('SUMMARY A', 'emise', 100.10), ('SUMMARY A', 'payee', 20.20),
                                    ('SUMMARY A', 'brouillon', 900), ('SUMMARY A', 'annulee', 800),
                                    ('SUMMARY B', 'emise', 777)]:
        db.add(Invoice(society=society, status=status, total_ttc=amount))
    db.add_all([Payment(society='SUMMARY A', amount=10.10), Payment(society='SUMMARY A', amount=20.20),
                Payment(society='SUMMARY B', amount=500)])
    db.flush()
    result = _finance_stats(db, ['SUMMARY A'])
    assert result['invoices_issued'] == 2
    assert result['invoiced_ttc'] == 120.30
    assert result['payments_total'] == 2
    assert result['payments_amount'] == 30.30
    assert _finance_stats(db, [])['invoiced_ttc'] == 0
    assert _finance_stats(db, ['SUMMARY B'])['payments_amount'] == 500


def test_contract_summary_counts_valid_current_contracts_not_prospects(db):
    now = date.today()
    def add(name, status='actif', start=None, end=None, data=None, society='SUMMARY CONTRACTS'):
        db.add(Client(name=name, status=status, contract_start=start, contract_end=end, data=data, society=society))
    add('Legacy', start=now)
    add('Validated', data={'dc_contract_status': 'valide'})
    add('Draft', start=now, data={'dc_contract_status': 'brouillon'})
    add('Expired', start=now-timedelta(days=30), end=now-timedelta(days=1))
    add('Future', start=now+timedelta(days=1))
    add('Inactive', status='inactif', start=now)
    add('Prospect without contract')
    add('Other society', start=now, society='OTHER SUMMARY')
    db.flush()
    assert _commercial_stats(db, ['SUMMARY CONTRACTS'])['contracts_active'] == 2
    assert _commercial_stats(db, [])['contracts_active'] == 0
