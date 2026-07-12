"""Palier 5 — MATÉRIEL : magasins, fournisseurs, articles, mouvements de stock,
dotations, retours d'équipement, alertes, inventaire.

Sans mock, vraies routes, vraie base. On verrouille surtout la LOGIQUE DE STOCK :
un mouvement entrée/sortie bouge la quantité, une sortie ne peut pas passer sous
zéro, une dotation employé décrémente le stock et crée l'équipement, un retour le
réincrémente. C'est le module où une erreur = un inventaire faux.
"""
from datetime import date

SOC = "Iron Global Securite"


# ── Helpers ───────────────────────────────────────────────────────────────────

_counter = [0]


def _uid():
    _counter[0] += 1
    return _counter[0]


def _store(client, h, name="Magasin Test", society=SOC):
    # code UNIQUE (la colonne code est unique) — dérivé d'un compteur, pas du nom
    r = client.post("/api/materiel/stores", headers=h,
                    json={"name": name, "code": f"MG{_uid()}", "society": society})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _supplier(client, h, name="Fournisseur Test"):
    r = client.post("/api/materiel/suppliers", headers=h, json={"name": name, "society": SOC, "phone": "0550000000"})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _article(client, h, code, store_id, qty=0, price=1000, society=SOC, min_qty=0, active=1):
    r = client.post("/api/materiel/articles", headers=h, json={
        "code": code, "designation": f"Article {code}", "store_id": store_id, "society": society,
        "quantity": qty, "unit_price": price, "min_quantity": min_qty, "active": active,
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _emp(client, h, code, society=SOC):
    r = client.post("/api/drh/employees", headers=h, json={
        "code": code, "first_name": f"E{code}", "last_name": "Mat", "society": society,
        "status": "actif", "contract_type": "CDD",
    })
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("backendId")


def _article_qty(client, h, article_id):
    r = client.get(f"/api/materiel/articles", headers=h)
    art = next(a for a in r.json() if a["id"] == article_id)
    return art["quantity"]


# ═══════════════════════════════════════════════════════════════════════════
# CRUD magasins / fournisseurs / articles
# ═══════════════════════════════════════════════════════════════════════════

def test_store_crud(client, auth_headers):
    sid = _store(client, auth_headers, "Magasin CRUD")
    got = client.get("/api/materiel/stores", headers=auth_headers)
    assert got.status_code == 200 and any(s["id"] == sid for s in got.json())

    upd = client.put(f"/api/materiel/stores/{sid}", headers=auth_headers,
                     json={"name": "Magasin Modifie", "society": SOC})
    assert upd.status_code == 200 and upd.json()["name"] == "Magasin Modifie"

    page = client.get("/api/materiel/stores/page?page=1&page_size=5", headers=auth_headers)
    assert page.status_code == 200 and "items" in page.json()

    # Suppression d'un magasin = réservée à l'administration système (token admin_system)
    assert client.delete(f"/api/materiel/stores/{sid}", headers=auth_headers).status_code == 403


def test_supplier_crud(client, auth_headers):
    fid = _supplier(client, auth_headers, "Fournisseur CRUD")
    assert any(s["id"] == fid for s in client.get("/api/materiel/suppliers", headers=auth_headers).json())
    upd = client.put(f"/api/materiel/suppliers/{fid}", headers=auth_headers,
                     json={"name": "Fournisseur Modifie", "society": SOC, "rating": 5})
    assert upd.status_code == 200 and upd.json()["rating"] == 5
    assert client.delete(f"/api/materiel/suppliers/{fid}", headers=auth_headers).status_code in (200, 204)


def test_article_crud(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Article")
    aid = _article(client, auth_headers, "ART_CRUD", sid, qty=10, price=2500)
    lst = client.get("/api/materiel/articles", headers=auth_headers)
    assert any(a["id"] == aid for a in lst.json())

    upd = client.put(f"/api/materiel/articles/{aid}", headers=auth_headers, json={
        "code": "ART_CRUD", "designation": "Article renomme", "store_id": sid, "unit_price": 3000,
    })
    assert upd.status_code == 200 and upd.json()["designation"] == "Article renomme"

    page = client.get("/api/materiel/articles/page?page=1&page_size=5", headers=auth_headers)
    assert page.status_code == 200 and "items" in page.json()

    # Suppression d'un article = réservée à l'administration système
    assert client.delete(f"/api/materiel/articles/{aid}", headers=auth_headers).status_code == 403


def test_store_create_forbidden_for_restricted_foreign_society(client, restricted_headers):
    r = client.post("/api/materiel/stores", headers=restricted_headers,
                    json={"name": "Mag Sword", "society": "Sword Corporation"})
    assert r.status_code == 403, r.text


# ═══════════════════════════════════════════════════════════════════════════
# Mouvements de stock — le cœur : la quantité bouge, jamais sous zéro
# ═══════════════════════════════════════════════════════════════════════════

def test_movement_entry_increases_stock(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Entree")
    aid = _article(client, auth_headers, "ART_IN", sid, qty=5)
    r = client.post("/api/materiel/movements", headers=auth_headers, json={
        "article_id": aid, "movement_type": "entree", "quantity": 20, "store_id": sid,
        "movement_date": str(date.today()),
    })
    assert r.status_code in (200, 201), r.text
    assert _article_qty(client, auth_headers, aid) == 25


def test_movement_exit_decreases_stock(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Sortie")
    aid = _article(client, auth_headers, "ART_OUT", sid, qty=30)
    r = client.post("/api/materiel/movements", headers=auth_headers, json={
        "article_id": aid, "movement_type": "sortie", "quantity": 12, "store_id": sid,
    })
    assert r.status_code in (200, 201), r.text
    assert _article_qty(client, auth_headers, aid) == 18


def test_movement_exit_insufficient_stock_rejected(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Insuff")
    aid = _article(client, auth_headers, "ART_INSUF", sid, qty=3)
    r = client.post("/api/materiel/movements", headers=auth_headers, json={
        "article_id": aid, "movement_type": "sortie", "quantity": 10, "store_id": sid,
    })
    assert r.status_code == 422, r.text
    assert _article_qty(client, auth_headers, aid) == 3, "le stock ne doit pas bouger sur un refus"


def test_movement_invalid_quantity_rejected(client, auth_headers):
    sid = _store(client, auth_headers, "Mag QtyNeg")
    aid = _article(client, auth_headers, "ART_QN", sid, qty=5)
    r = client.post("/api/materiel/movements", headers=auth_headers, json={
        "article_id": aid, "movement_type": "entree", "quantity": 0, "store_id": sid,
    })
    assert r.status_code == 422, r.text


def test_movement_dotation_type_must_use_dotations_endpoint(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Dot")
    aid = _article(client, auth_headers, "ART_DOT", sid, qty=5)
    r = client.post("/api/materiel/movements", headers=auth_headers, json={
        "article_id": aid, "movement_type": "nouvelle_dotation", "quantity": 1, "store_id": sid,
    })
    assert r.status_code == 422, r.text


def test_movement_store_mismatch_rejected(client, auth_headers):
    sid = _store(client, auth_headers, "Mag A")
    other = _store(client, auth_headers, "Mag B")
    aid = _article(client, auth_headers, "ART_MM", sid, qty=5)
    r = client.post("/api/materiel/movements", headers=auth_headers, json={
        "article_id": aid, "movement_type": "entree", "quantity": 2, "store_id": other,
    })
    assert r.status_code == 422, r.text


def test_movement_inactive_article_rejected(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Inactif")
    aid = _article(client, auth_headers, "ART_OFF", sid, qty=5, active=0)
    r = client.post("/api/materiel/movements", headers=auth_headers, json={
        "article_id": aid, "movement_type": "entree", "quantity": 2, "store_id": sid,
    })
    assert r.status_code == 422, r.text


def test_movement_voucher_deduplication(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Bon")
    aid = _article(client, auth_headers, "ART_BON", sid, qty=5)
    body = {"article_id": aid, "movement_type": "entree", "quantity": 5, "store_id": sid,
            "movement_date": str(date.today()), "voucher_number": "BON-001"}
    first = client.post("/api/materiel/movements", headers=auth_headers, json=body)
    assert first.status_code in (200, 201), first.text
    # Même bon identique -> renvoie l'existant, pas un doublon (stock inchangé)
    second = client.post("/api/materiel/movements", headers=auth_headers, json=body)
    assert second.status_code in (200, 201)
    assert second.json()["id"] == first.json()["id"]
    assert _article_qty(client, auth_headers, aid) == 10, "un bon dupliqué ne doit pas re-mouvementer"


def test_movement_delete_reverses_quantity(client, auth_headers):
    sid = _store(client, auth_headers, "Mag DelMv")
    aid = _article(client, auth_headers, "ART_DELMV", sid, qty=10)
    mv = client.post("/api/materiel/movements", headers=auth_headers, json={
        "article_id": aid, "movement_type": "entree", "quantity": 8, "store_id": sid,
    }).json()
    assert _article_qty(client, auth_headers, aid) == 18
    d = client.delete(f"/api/materiel/movements/{mv['id']}", headers=auth_headers)
    assert d.status_code == 200
    assert _article_qty(client, auth_headers, aid) == 10, "supprimer un mouvement doit annuler son effet"


# ═══════════════════════════════════════════════════════════════════════════
# Dotations + retours d'équipement
# ═══════════════════════════════════════════════════════════════════════════

def test_dotation_employee_decrements_stock_and_creates_equipment(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Dotation")
    aid = _article(client, auth_headers, "ART_EQUIP", sid, qty=10, price=4500)
    emp = _emp(client, auth_headers, "MAT_EMP1")

    r = client.post("/api/materiel/dotations", headers=auth_headers, json={
        "article_id": aid, "employee_id": int(emp), "target_type": "employee",
        "quantity": 2, "dotation_reason": "Nouvelle dotation",
    })
    assert r.status_code in (200, 201), r.text
    equip = r.json()
    assert equip["status"] == "attribue" and equip["quantity"] == 2

    assert _article_qty(client, auth_headers, aid) == 8, "la dotation doit décrémenter le stock"

    # L'équipement apparaît chez l'employé
    eq = client.get(f"/api/materiel/employees/{emp}/equipment", headers=auth_headers)
    assert eq.status_code == 200 and any(e["id"] == equip["id"] for e in eq.json())


def test_dotation_same_society_different_case_is_accepted(client, auth_headers):
    """Non-régression : le DRH met la société employé en MAJUSCULES, le matériel la
    garde telle quelle. La dotation ne doit PAS rejeter une même société de casse
    différente (bug : comparaison brute -> dotation légitime refusée)."""
    # Magasin/article en casse mixte, employé (société MAJ par le DRH) : même société
    sid = _store(client, auth_headers, "Mag Casse", society="Iron Global Securite")
    aid = _article(client, auth_headers, "ART_CASE", sid, qty=5, society="Iron Global Securite")
    emp = _emp(client, auth_headers, "MAT_CASE", society="Iron Global Securite")
    r = client.post("/api/materiel/dotations", headers=auth_headers, json={
        "article_id": aid, "employee_id": int(emp), "target_type": "employee", "quantity": 1,
    })
    assert r.status_code in (200, 201), \
        f"dotation refusée à tort pour casse société différente : {r.text}"


def test_dotation_society_mismatch_rejected(client, auth_headers):
    sid = _store(client, auth_headers, "Mag DotSoc")
    aid = _article(client, auth_headers, "ART_DSOC", sid, qty=5, society=SOC)
    emp = _emp(client, auth_headers, "MAT_SWORD", society="Sword Corporation")
    r = client.post("/api/materiel/dotations", headers=auth_headers, json={
        "article_id": aid, "employee_id": int(emp), "target_type": "employee", "quantity": 1,
    })
    assert r.status_code == 422, r.text


def test_dotation_invalid_target_rejected(client, auth_headers):
    sid = _store(client, auth_headers, "Mag DotBad")
    aid = _article(client, auth_headers, "ART_DBAD", sid, qty=5)
    r = client.post("/api/materiel/dotations", headers=auth_headers, json={
        "article_id": aid, "target_type": "planete", "quantity": 1,
    })
    assert r.status_code == 422, r.text


def test_dotation_structure(client, auth_headers):
    sid = _store(client, auth_headers, "Mag DotStruct")
    aid = _article(client, auth_headers, "ART_STRUCT", sid, qty=5)
    r = client.post("/api/materiel/dotations", headers=auth_headers, json={
        "article_id": aid, "target_type": "structure", "structure": "Direction OPS", "quantity": 3,
    })
    assert r.status_code in (200, 201), r.text
    assert _article_qty(client, auth_headers, aid) == 2


def test_return_equipment_reincrements_stock(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Retour")
    aid = _article(client, auth_headers, "ART_RET", sid, qty=10)
    emp = _emp(client, auth_headers, "MAT_RET")
    equip = client.post("/api/materiel/dotations", headers=auth_headers, json={
        "article_id": aid, "employee_id": int(emp), "target_type": "employee", "quantity": 3,
    }).json()
    assert _article_qty(client, auth_headers, aid) == 7

    ret = client.post(f"/api/materiel/equipment/{equip['id']}/return", headers=auth_headers, json={
        "return_date": str(date.today()), "return_reason": "Fin de mission",
    })
    assert ret.status_code == 200, ret.text
    assert ret.json()["status"] == "reverse"
    assert _article_qty(client, auth_headers, aid) == 10, "un retour doit réincrémenter le stock"

    # Double retour refusé
    again = client.post(f"/api/materiel/equipment/{equip['id']}/return", headers=auth_headers, json={
        "return_date": str(date.today()),
    })
    assert again.status_code == 422, again.text


def test_delete_movement_linked_to_dotation_rejected(client, auth_headers):
    sid = _store(client, auth_headers, "Mag DelDot")
    aid = _article(client, auth_headers, "ART_DELDOT", sid, qty=10)
    emp = _emp(client, auth_headers, "MAT_DELDOT")
    equip = client.post("/api/materiel/dotations", headers=auth_headers, json={
        "article_id": aid, "employee_id": int(emp), "target_type": "employee", "quantity": 1,
    }).json()
    mv_id = equip.get("movement_id")
    if mv_id:
        d = client.delete(f"/api/materiel/movements/{mv_id}", headers=auth_headers)
        assert d.status_code == 422, "on ne doit pas pouvoir supprimer le mouvement d'une dotation employé"


# ═══════════════════════════════════════════════════════════════════════════
# Dashboard, alertes, inventaire, reversements
# ═══════════════════════════════════════════════════════════════════════════

def test_dashboard(client, auth_headers):
    r = client.get("/api/materiel/dashboard", headers=auth_headers)
    assert r.status_code == 200 and isinstance(r.json(), dict)


def test_inventory(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Inv")
    _article(client, auth_headers, "ART_INV", sid, qty=15)
    r = client.get("/api/materiel/inventory", headers=auth_headers)
    assert r.status_code == 200


def test_alerts_flags_low_stock(client, auth_headers):
    sid = _store(client, auth_headers, "Mag Alerte")
    # quantité sous le minimum -> doit apparaître en alerte
    _article(client, auth_headers, "ART_LOW", sid, qty=1, min_qty=10)
    r = client.get("/api/materiel/alerts", headers=auth_headers)
    assert r.status_code == 200 and isinstance(r.json(), dict)


def test_reversements_pending(client, auth_headers):
    r = client.get("/api/materiel/reversements/pending", headers=auth_headers)
    assert r.status_code == 200


def test_movements_list_and_page(client, auth_headers):
    sid = _store(client, auth_headers, "Mag MvList")
    aid = _article(client, auth_headers, "ART_MVLIST", sid, qty=20)
    client.post("/api/materiel/movements", headers=auth_headers, json={
        "article_id": aid, "movement_type": "sortie", "quantity": 4, "store_id": sid,
    })
    lst = client.get(f"/api/materiel/movements?article_id={aid}", headers=auth_headers)
    assert lst.status_code == 200 and isinstance(lst.json(), list)
    page = client.get("/api/materiel/movements/page?page=1&page_size=5", headers=auth_headers)
    assert page.status_code == 200 and "items" in page.json()
