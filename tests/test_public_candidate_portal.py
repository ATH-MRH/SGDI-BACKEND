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
        "experience": [
            {
                "society": "Société Exemple",
                "start_date": "2022-01-01",
                "end_date": "2024-06-30",
                "position": "Agent",
                "departure_reason": "Fin de contrat",
            }
        ],
        "education": [
            {
                "institution": "Université d'Alger",
                "degree": "Licence",
                "specialty": "Droit",
                "start_date": "2018-09-01",
                "end_date": "2021-06-30",
            }
        ],
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
    assert created["data"]["experience"] == [
        {
            "societe": "Société Exemple",
            "du": "2022-01-01",
            "au": "2024-06-30",
            "poste": "Agent",
            "motif": "Fin de contrat",
        }
    ]
    assert created["data"]["formations"] == [
        {
            "etablissement": "Université d'Alger",
            "diplome": "Licence",
            "specialite": "Droit",
            "du": "2018-09-01",
            "au": "2021-06-30",
        }
    ]
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
    assert "Société souhaitée" not in html
    assert 'placeholder="00 000,00 DZD"' in html
    assert 'name="language" value="Arabe"' in html
    assert 'name="language" value="Espagnol"' in html
    assert "toggleOtherLanguage" in html
    assert "experienceRows" in html
    assert "collectExperiences" in html
    assert "Formation / Études" in html
    assert "educationRows" in html
    assert "collectEducation" in html
    assert "Coordonnées de contact" in html
    assert "candidateWilaya" in html
    assert "CANDIDATE_WILAYAS" in html
    assert "ALGERIA_COMMUNES_BY_WILAYA_CODE" in html
    assert "/static/algeria-communes.js" in html
    assert 'textarea name="experience"' not in html
