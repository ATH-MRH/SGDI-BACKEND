"""P0 sécurité — fermeture DRH-NEXT-DOC-URL-AUTH.

GET /api/drh/documents/{id}/content : accès authentifié et scopé au contenu réel d'un
document employé, remplaçant l'exposition anonyme via /uploads/photos/docs/*.
"""
from datetime import date

from app.core.photo_storage import DOCS_DIR, PUBLIC_DOC_PREFIX


def _emp(client, h, code, society="Iron Global Securite"):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": f"E{code}", "last_name": "Test", "society": society,
        "status": "actif", "contract_type": "CDD",
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def _write_real_doc_file(name: str, content: bytes = b"CONTENU-CONFIDENTIEL-RH") -> str:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    (DOCS_DIR / name).write_bytes(content)
    return f"{PUBLIC_DOC_PREFIX}/{name}"


def _create_scoped_rh_user(client, auth_headers, username, *, actions=None, society="Iron Global Securite"):
    r = client.post("/api/auth/users", headers=auth_headers, json={
        "username": username, "email": f"{username}@test.com", "password": "testpass123",
        "validation_password": "validation123", "role": "rh",
        "authorized_societies": [society], "authorized_modules": ["drh"],
        "authorized_actions": actions or [],
    })
    assert r.status_code in (200, 201), r.text
    login = client.post("/api/auth/login", json={"username": username, "password": "testpass123"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_no_token_is_401(client, auth_headers):
    emp_id = _emp(client, auth_headers, "DOC401")
    file_path = _write_real_doc_file("doc401.pdf")
    doc = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Test", "file_name": "doc401.pdf",
        "file_path": file_path, "mime_type": "application/pdf",
    })
    assert doc.status_code in (200, 201), doc.text
    doc_id = doc.json()["id"]
    r = client.get(f"/api/drh/documents/{doc_id}/content")
    assert r.status_code == 401


def test_no_drh_module_is_403(client, auth_headers):
    emp_id = _emp(client, auth_headers, "DOC403A")
    file_path = _write_real_doc_file("doc403a.pdf")
    doc = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Test", "file_path": file_path,
    }).json()
    # testops : authorized_modules=["ops","dc"], pas "drh"
    login = client.post("/api/auth/login", json={"username": "testops", "password": "testpass123"})
    ops_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    r = client.get(f"/api/drh/documents/{doc['id']}/content", headers=ops_headers)
    assert r.status_code == 403


def test_correct_society_is_200_and_serves_real_content(client, auth_headers):
    emp_id = _emp(client, auth_headers, "DOC200")
    file_path = _write_real_doc_file("doc200.pdf", b"%PDF-CONTENU-REEL")
    doc = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Test", "file_name": "doc200.pdf",
        "file_path": file_path, "mime_type": "application/pdf",
    }).json()
    r = client.get(f"/api/drh/documents/{doc['id']}/content", headers=auth_headers)
    assert r.status_code == 200
    assert r.content == b"%PDF-CONTENU-REEL"
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert "no-store" in r.headers.get("cache-control", "")


def test_other_society_is_403(client, auth_headers):
    emp_id = _emp(client, auth_headers, "DOC403B", society="Iron Global Securite")
    file_path = _write_real_doc_file("doc403b.pdf")
    doc = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Test", "file_path": file_path,
    }).json()
    other = _create_scoped_rh_user(client, auth_headers, "rh_doc_autre_societe", society="Autre Société SARL")
    r = client.get(f"/api/drh/documents/{doc['id']}/content", headers=other)
    assert r.status_code == 403


def test_nonexistent_document_id_is_404(client, auth_headers):
    r = client.get("/api/drh/documents/999999/content", headers=auth_headers)
    assert r.status_code == 404


def test_path_traversal_via_forged_file_path_is_refused(client, auth_headers):
    emp_id = _emp(client, auth_headers, "DOCTRAV")
    # file_path est un champ texte libre non validé à la création (audit) : un document
    # créé avec un chemin qui tente de sortir de DOCS_DIR ne doit jamais être servi.
    doc = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Test",
        "file_path": "/uploads/photos/docs/../../../../etc/passwd",
    }).json()
    r = client.get(f"/api/drh/documents/{doc['id']}/content", headers=auth_headers)
    assert r.status_code == 404


def test_symlink_escaping_docs_dir_is_refused(client, auth_headers, tmp_path):
    # Un symlink PHYSIQUEMENT présent sous DOCS_DIR mais dont la cible réelle résout en
    # dehors : Path.resolve() suit le lien, donc le même contrôle de confinement canonique
    # que le path traversal (test ci-dessus) doit aussi refuser ce cas — vérifié empiriquement
    # ici plutôt que supposé depuis la seule lecture du code (§5 intégration finale).
    import os
    outside_secret = tmp_path / "secret-hors-docs-dir.txt"
    outside_secret.write_bytes(b"SECRET-HORS-DOCS-DIR")
    link_name = "lien-symbolique-vers-exterieur.pdf"
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    link_path = DOCS_DIR / link_name
    if link_path.exists() or link_path.is_symlink():
        link_path.unlink()
    os.symlink(outside_secret, link_path)
    try:
        emp_id = _emp(client, auth_headers, "DOCSYMLINK")
        doc = client.post("/api/drh/documents", headers=auth_headers, json={
            "owner_type": "employee", "owner_id": emp_id, "label": "Test",
            "file_path": f"{PUBLIC_DOC_PREFIX}/{link_name}",
        }).json()
        r = client.get(f"/api/drh/documents/{doc['id']}/content", headers=auth_headers)
        assert r.status_code == 404
        assert b"SECRET-HORS-DOCS-DIR" not in r.content
    finally:
        link_path.unlink()


def test_file_path_outside_docs_dir_is_refused(client, auth_headers):
    emp_id = _emp(client, auth_headers, "DOCOUT")
    # Un file_path pointant ailleurs sous /uploads (photos, rapports IA...) ne doit jamais
    # être servi par CETTE route, même s'il "a l'air" valide.
    doc = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Test",
        "file_path": "/uploads/photos/some_employee_photo.jpg",
    }).json()
    r = client.get(f"/api/drh/documents/{doc['id']}/content", headers=auth_headers)
    assert r.status_code == 404


def test_missing_physical_file_is_404(client, auth_headers):
    emp_id = _emp(client, auth_headers, "DOCMISS")
    doc = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Test",
        "file_path": "/uploads/photos/docs/fichier-jamais-cree.pdf",
    }).json()
    r = client.get(f"/api/drh/documents/{doc['id']}/content", headers=auth_headers)
    assert r.status_code == 404


def test_image_preview_uses_inline_disposition_by_default(client, auth_headers):
    emp_id = _emp(client, auth_headers, "DOCIMG")
    file_path = _write_real_doc_file("photo.jpg", b"\xff\xd8\xff-jpeg-content")
    doc = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Photo", "file_name": "photo.jpg",
        "file_path": file_path, "mime_type": "image/jpeg",
    }).json()
    r = client.get(f"/api/drh/documents/{doc['id']}/content", headers=auth_headers)
    assert r.status_code == 200
    assert "inline" in r.headers.get("content-disposition", "")


def test_download_query_param_uses_attachment_disposition(client, auth_headers):
    emp_id = _emp(client, auth_headers, "DOCDL")
    file_path = _write_real_doc_file("rapport.pdf")
    doc = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Rapport", "file_name": "rapport.pdf",
        "file_path": file_path, "mime_type": "application/pdf",
    }).json()
    r = client.get(f"/api/drh/documents/{doc['id']}/content?download=true", headers=auth_headers)
    assert r.status_code == 200
    assert "attachment" in r.headers.get("content-disposition", "")
    assert "rapport.pdf" in r.headers.get("content-disposition", "")


def test_generated_contract_document_streams_from_database_not_filesystem(client, auth_headers, db):
    from app.modules.drh.models import Document, GeneratedContract

    emp_id = _emp(client, auth_headers, "DOCGEN")
    gc = GeneratedContract(
        employee_id=emp_id, reference="REF-TEST-001", title="Contrat test",
        contract_type="CDI", output_format="pdf", file_name="contrat.pdf",
        mime_type="application/pdf", file_content=b"CONTENU-CONTRAT-EN-BASE", status="genere",
    )
    db.add(gc)
    db.flush()
    doc = Document(
        owner_type="employee", owner_id=emp_id, label="Contrat généré",
        file_name="contrat.pdf", file_path=f"generated_contract:{gc.reference}",
        mime_type="application/pdf",
    )
    db.add(doc)
    db.commit()
    r = client.get(f"/api/drh/documents/{doc.id}/content", headers=auth_headers)
    assert r.status_code == 200
    assert r.content == b"CONTENU-CONTRAT-EN-BASE"


def test_client_observation_document_is_never_served_by_this_route(client, auth_headers, db):
    from app.modules.drh.models import Document

    file_path = _write_real_doc_file("piece_jointe_client.pdf", b"PIECE-JOINTE-PORTAIL-CLIENT")
    doc = Document(
        owner_type="client_observation", owner_id=1, label="Pièce jointe client",
        file_path=file_path, mime_type="application/pdf",
    )
    db.add(doc)
    db.commit()
    r = client.get(f"/api/drh/documents/{doc.id}/content", headers=auth_headers)
    assert r.status_code == 404


def test_session_ab_no_cross_society_leak(client, auth_headers):
    emp_a = _emp(client, auth_headers, "DOCAB1", society="Iron Global Securite")
    file_path = _write_real_doc_file("secret_societe_a.pdf", b"DONNEES-SOCIETE-A")
    doc = client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_a, "label": "Confidentiel",
        "file_path": file_path,
    }).json()
    rhb = _create_scoped_rh_user(client, auth_headers, "rh_doc_session_b", society="Autre Société SARL")
    r = client.get(f"/api/drh/documents/{doc['id']}/content", headers=rhb)
    assert r.status_code == 403
    assert b"DONNEES-SOCIETE-A" not in r.content


def test_raw_uploads_url_for_an_employee_document_now_requires_auth(client, auth_headers):
    # LE scénario exact qui prouvait la vulnérabilité d'origine (voir rapport LOT 11/finish) :
    # avant cette correction, GET /uploads/photos/docs/<fichier> SANS AUCUN TOKEN renvoyait
    # 200 + le contenu intégral pour N'IMPORTE QUEL document, y compris un document employé.
    # La route explicite (app/main.py::serve_uploaded_document, enregistrée avant le mount
    # StaticFiles) intercepte désormais ce chemin précis : un fichier lié à un
    # Document.owner_type="employee" exige maintenant une authentification + le scope
    # société, exactement comme la nouvelle route API dédiée.
    emp_id = _emp(client, auth_headers, "DOCRAWPROOF")
    file_path = _write_real_doc_file("preuve_vulnerabilite_corrigee.pdf", b"DONNEES-CONFIDENTIELLES-RH")
    client.post("/api/drh/documents", headers=auth_headers, json={
        "owner_type": "employee", "owner_id": emp_id, "label": "Test", "file_path": file_path,
    })
    anonymous = client.get(file_path)
    assert anonymous.status_code == 401, "un document employé ne doit plus jamais être servi sans authentification"
    authenticated = client.get(file_path, headers=auth_headers)
    assert authenticated.status_code == 200
    assert authenticated.content == b"DONNEES-CONFIDENTIELLES-RH"


def test_raw_uploads_url_for_a_non_employee_file_stays_publicly_accessible(client, auth_headers):
    # Compromis assumé et documenté (§B/§G de la mission) : un fichier de DOCS_DIR qui ne
    # correspond À AUCUN document employé (pièce jointe portail client, photo, rapport IA,
    # fichier orphelin) continue d'être servi publiquement, comportement strictement
    # inchangé — protéger aveuglément tout DOCS_DIR casserait le portail client, hors
    # périmètre de cette correction.
    file_path = _write_real_doc_file("piece_jointe_portail_client.pdf", b"PIECE-JOINTE-NON-RH")
    r = client.get(file_path)
    assert r.status_code == 200
    assert r.content == b"PIECE-JOINTE-NON-RH"
