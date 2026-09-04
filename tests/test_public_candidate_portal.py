from pathlib import Path


def _payload(**updates):
    data = {
        "first_name": "Nadia",
        "last_name": "Portail",
        "phone": "0550001122",
        "email": "nadia.portal@example.com",
        "desired_position": "Agent de sécurité",
        "society": "IRON GLOBAL SÉCURITÉ",
        "children_count": 0,
        "languages": ["Arabe", "Français"],
        "consent": True,
    }
    data.update(updates)
    return data


def test_fr_domain_serves_external_candidate_portal(client):
    response = client.get("/", headers={"host": "fr.irongs.com"})
    assert response.status_code == 200
    assert "ESPACE CANDIDAT" in response.text
    assert "TRANSMETTRE MA CANDIDATURE" in response.text
    assert "Avis du recruteur" not in response.text


def test_public_submission_creates_candidate_not_employee(client, auth_headers):
    before_employees = client.get("/api/drh/employees", headers=auth_headers).json()
    response = client.post("/api/public/candidates", json=_payload())
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "received"
    assert response.json()["reference"].startswith("CAND-")

    candidates = client.get("/api/drh/candidates", headers=auth_headers).json()
    created = next(row for row in candidates if row["email"] == "nadia.portal@example.com")
    assert created["status"] == "nouvelle"
    assert created["data"]["moduleOrigine"] == "fr.irongs.com"
    assert created["data"]["ficheCandidatTransmise"] is True
    after_employees = client.get("/api/drh/employees", headers=auth_headers).json()
    assert len(after_employees) == len(before_employees)

    favorable = client.put(
        f"/api/drh/candidates/{created['id']}",
        headers=auth_headers,
        json={"data": {**created["data"], "avisDecision": "Favorable"}},
    )
    assert favorable.status_code == 200
    transmitted = client.post(
        f"/api/drh/candidates/{created['id']}/marquer-contractualisation",
        headers=auth_headers,
    )
    assert transmitted.status_code == 200, transmitted.text
    assert transmitted.json()["data"]["status"] == "a_contractualiser"
    final_employees = client.get("/api/drh/employees", headers=auth_headers).json()
    assert len(final_employees) == len(before_employees)


def test_public_submission_requires_consent_and_rejects_honeypot(client):
    no_consent = client.post("/api/public/candidates", json=_payload(email="other@example.com", consent=False))
    assert no_consent.status_code == 422
    bot = client.post("/api/public/candidates", json=_payload(email="bot@example.com", company="spam"))
    assert bot.status_code == 400


def test_candidate_portal_assets_are_repository_native():
    html = (Path(__file__).parents[1] / "app/static/candidat.html").read_text(encoding="utf-8")
    assert "iframe" not in html.lower()
    assert "'/api/public/candidates'" in html
