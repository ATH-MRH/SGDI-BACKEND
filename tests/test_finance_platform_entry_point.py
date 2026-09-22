def test_finance_platform_entry_serves_html(client):
    r = client.get("/finance-platform")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "ATLAS Finance Platform" in r.text
    assert "/banking/accounts" in r.text
    assert "/reconciliation/cases" in r.text
    assert 'const API = "/api"' in r.text


def test_legacy_still_served_unaffected(client):
    r = client.get("/static/sgdi-app.js")
    assert r.status_code == 200
