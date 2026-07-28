"""Fiche candidat (reconstruction v2) — GET /candidates/{id} + flux validate-section."""

SOC = "Iron Global Securite"


def _create(client, headers, nom="Bensalah", prenom="Amine", society=SOC, data=None):
    body = {
        "first_name": prenom, "last_name": nom, "society": society,
        "data": {"nom": nom, "prenom": prenom, **(data or {})},
    }
    r = client.post("/api/drh/candidates", headers=headers, json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()["data"]


def test_get_candidate_by_id(client, auth_headers):
    c = _create(client, auth_headers, nom="GetById")
    r = client.get(f"/api/drh/candidates/{c['id']}", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == c["id"]
    assert r.json()["last_name"] == "GETBYID"


def test_get_candidate_autre_societe_refuse(client, auth_headers, restricted_headers):
    c = _create(client, auth_headers, nom="Foreigner", society="Sword Corporation")
    r = client.get(f"/api/drh/candidates/{c['id']}", headers=restricted_headers)
    assert r.status_code == 403, r.text


def test_nin_doit_faire_10_chiffres(client, auth_headers):
    r = client.post("/api/drh/candidates", headers=auth_headers, json={
        "first_name": "Nin", "last_name": "Court", "society": SOC,
        "data": {"nom": "Court", "prenom": "Nin", "nin": "12345"},
    })
    assert r.status_code == 422 and "NIN" in r.text


def test_validate_section_sequencing(client, auth_headers):
    """La validation d'une section exige que les précédentes soient validées (séquencement serveur)."""
    full = {
        "nom": "Sequence", "prenom": "Test", "dateNaissance": "1990-01-01",
        "lieuNaissance": "Alger", "sexe": "M", "situation": "Célibataire",
        "nomPere": "Ali", "nomMere": "Fatima", "nin": "1234567890", "source": "ANEM",
    }
    c = _create(client, auth_headers, nom="Sequence", prenom="Test", data=full)
    body = {"first_name": "Test", "last_name": "Sequence", "society": SOC, "data": c.get("data", full)}
    # 'militaire' avant 'identification'/'mensurations' -> refus séquencement (422).
    r = client.post("/api/drh/candidates/validate-section", headers=auth_headers,
                    params={"section": "militaire", "candidate_id": c["id"]}, json=body)
    assert r.status_code == 422, r.text
    # 'identification' passe (tous les champs requis + NIN 10 + âge ok).
    r2 = client.post("/api/drh/candidates/validate-section", headers=auth_headers,
                     params={"section": "identification", "candidate_id": c["id"]}, json=body)
    assert r2.status_code in (200, 201), r2.text
