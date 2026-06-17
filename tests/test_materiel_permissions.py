def _create_store(client, headers, name):
    resp = client.post(
        "/api/materiel/stores",
        json={"name": name, "code": name.upper().replace(" ", "-"), "society": "TEST_SOC"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_delete_store_requires_admin_system_token(client, auth_headers):
    store = _create_store(client, auth_headers, "Magasin permission normal")

    resp = client.delete(f"/api/materiel/stores/{store['id']}", headers=auth_headers)

    assert resp.status_code == 403
    assert "administration système" in resp.json()["detail"].lower()


def test_delete_store_accepts_admin_system_token(client, auth_headers):
    store = _create_store(client, auth_headers, "Magasin permission systeme")
    login = client.post("/api/auth/admin-system-login", json={"password": "test-admin-password"})
    assert login.status_code == 200, login.text
    admin_system_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    resp = client.delete(f"/api/materiel/stores/{store['id']}", headers=admin_system_headers)

    assert resp.status_code == 200, resp.text


def _create_article(client, headers, code):
    store = _create_store(client, headers, f"Store {code}")
    resp = client.post(
        "/api/materiel/articles",
        json={
            "code": code,
            "designation": f"Article {code}",
            "category": "Test",
            "society": "TEST_SOC",
            "store_id": store["id"],
            "unit": "Pièce",
            "quantity": 1,
            "unit_price": 10,
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_delete_article_requires_admin_system_token(client, auth_headers):
    article = _create_article(client, auth_headers, "ART-NORMAL")

    resp = client.delete(f"/api/materiel/articles/{article['id']}", headers=auth_headers)

    assert resp.status_code == 403
    assert "administration système" in resp.json()["detail"].lower()


def test_delete_article_accepts_admin_system_token(client, auth_headers):
    article = _create_article(client, auth_headers, "ART-SYSTEME")
    login = client.post("/api/auth/admin-system-login", json={"password": "test-admin-password"})
    assert login.status_code == 200, login.text
    admin_system_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    resp = client.delete(f"/api/materiel/articles/{article['id']}", headers=admin_system_headers)

    assert resp.status_code == 200, resp.text


def test_delete_article_removes_linked_movements(client, auth_headers):
    article = _create_article(client, auth_headers, "ART-MVTS")
    movement = client.post(
        "/api/materiel/movements",
        json={
            "article_id": article["id"],
            "movement_date": "2026-05-30",
            "movement_type": "entree",
            "quantity": 1,
            "unit_price": 10,
            "store_id": article["store_id"],
        },
        headers=auth_headers,
    )
    assert movement.status_code == 200, movement.text
    login = client.post("/api/auth/admin-system-login", json={"password": "test-admin-password"})
    assert login.status_code == 200, login.text
    admin_system_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    resp = client.delete(f"/api/materiel/articles/{article['id']}", headers=admin_system_headers)

    assert resp.status_code == 200, resp.text


def test_duplicate_stock_movement_same_voucher_is_idempotent_for_all_stores(client, auth_headers):
    articles = [
        _create_article(client, auth_headers, "ART-MVT-HAB"),
        _create_article(client, auth_headers, "ART-MVT-COM"),
        _create_article(client, auth_headers, "ART-MVT-BUR"),
    ]

    for index, article in enumerate(articles, start=1):
        payload = {
            "article_id": article["id"],
            "movement_date": "2026-05-31",
            "movement_type": "entree",
            "quantity": 50,
            "unit_price": 10,
            "store_id": article["store_id"],
            "voucher_number": f"BE/MT/2026/IDEMP-{index}",
        }

        first = client.post("/api/materiel/movements", json=payload, headers=auth_headers)
        second = client.post("/api/materiel/movements", json=payload, headers=auth_headers)

        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert second.json()["id"] == first.json()["id"]

    inventory = client.get("/api/materiel/inventory", headers=auth_headers)
    assert inventory.status_code == 200, inventory.text
    for article in articles:
        stored = next(row for row in inventory.json()["articles"] if row["id"] == article["id"])
        assert stored["quantity"] == 51


def test_site_dotation_deducts_stock_without_employee(client, auth_headers):
    article = _create_article(client, auth_headers, "ART-SITE-DOT")
    site_resp = client.post(
        "/api/ops/sites",
        json={"name": "Site dotation matériel", "indicatif": "SDM"},
        headers=auth_headers,
    )
    assert site_resp.status_code == 200, site_resp.text

    resp = client.post(
        "/api/materiel/dotations",
        json={
            "target_type": "site",
            "site_id": site_resp.json()["id"],
            "article_id": article["id"],
            "quantity": 1,
            "item_state": "neuf",
            "useful_life_months": 24,
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["target_type"] == "site"

    inventory = client.get("/api/materiel/inventory", headers=auth_headers)
    assert inventory.status_code == 200, inventory.text
    stored = next(row for row in inventory.json()["articles"] if row["id"] == article["id"])
    assert stored["quantity"] == 0


def test_structure_dotation_deducts_stock_without_employee(client, auth_headers):
    article = _create_article(client, auth_headers, "ART-STRUCT-DOT")

    resp = client.post(
        "/api/materiel/dotations",
        json={
            "target_type": "structure",
            "structure": "DIRECTION RH",
            "target_label": "DIRECTION RH",
            "article_id": article["id"],
            "quantity": 1,
            "item_state": "rénové",
            "size_breakdown": {"repartitionTailles": {"Taille XL": 1}, "raw": {"taille": "XL"}},
        },
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["target_type"] == "structure"
    movements = client.get(f"/api/materiel/movements?article_id={article['id']}", headers=auth_headers)
    assert movements.status_code == 200, movements.text
    dotation = next(row for row in movements.json() if row["movement_type"] == "nouvelle_dotation")
    assert dotation["size_breakdown"]["repartitionTailles"] == {"Taille XL": 1}


def test_employee_return_restores_original_size_breakdown(client, auth_headers):
    article = _create_article(client, auth_headers, "ART-SIZE-RET")
    employee = client.post(
        "/api/drh/employees",
        json={
            "code": "EMP-SIZE-RET",
            "first_name": "Retour",
            "last_name": "Taille",
            "society": "TEST_SOC",
            "status": "actif",
        },
        headers=auth_headers,
    )
    assert employee.status_code == 200, employee.text
    dotation = client.post(
        "/api/materiel/dotations",
        json={
            "target_type": "employee",
            "employee_id": employee.json()["id"],
            "article_id": article["id"],
            "quantity": 1,
            "item_state": "neuf",
            "size_breakdown": {"repartitionTailles": {"Pointure 42": 1}, "raw": {"pointure": "42"}},
        },
        headers=auth_headers,
    )
    assert dotation.status_code == 200, dotation.text

    returned = client.post(
        f"/api/materiel/equipment/{dotation.json()['id']}/return",
        json={"return_date": "2026-05-31", "return_reason": "Retour employé"},
        headers=auth_headers,
    )

    assert returned.status_code == 200, returned.text
    movements = client.get(f"/api/materiel/movements?article_id={article['id']}", headers=auth_headers)
    assert movements.status_code == 200, movements.text
    retour = next(row for row in movements.json() if row["movement_type"] == "retour_employe")
    assert retour["size_breakdown"]["repartitionTailles"] == {"Pointure 42": 1}
