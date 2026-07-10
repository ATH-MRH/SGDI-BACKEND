"""Couverture backend de la PAIE — vrais endpoints, vraie base, sans mock.

La paie n'a pas de module backend : bulletins, éléments, clôtures et config vivent
dans le store JSON legacy (`sgdi_records`), servis par /api/irongs. Ce que le
backend doit garantir ici :
  - les données de paie survivent aux sauvegardes (une perte = salaires perdus) ;
  - un utilisateur ne voit QUE les bulletins de sa société (données sensibles).
"""

SOC_IGS = "Iron Global Securite"
SOC_SWORD = "Sword Corporation"


def _put(client, headers, data):
    r = client.put("/api/irongs/db", headers=headers, json={"data": data})
    assert r.status_code == 200, r.text
    return r


def _collection(client, headers, name):
    r = client.get(f"/api/irongs/collections/{name}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json().get("data", [])


def _bulletin(bid, societe, net):
    return {"id": bid, "ym": "2026-03", "agentId": f"ag_{bid}", "societe": societe,
            "matricule": bid.upper(), "calcul": {"netAPayer": net, "brutCotisable": 50000}}


# ── Persistance ──────────────────────────────────────────────────────────────

def test_paie_collections_persist(client, auth_headers):
    _put(client, auth_headers, {
        "paieBulletins": [_bulletin("b_p1", SOC_IGS, 40915)],
        "paieElements": [{"id": "e_p1", "agentId": "ag1", "ym": "2026-03", "rubriqueId": "rub_avance", "montant": 5000}],
        "paieClotures": [{"id": "c_p1", "ym": "2026-03", "societe": SOC_IGS, "bulletins": 1}],
        "paieGrilles": [{"id": "g_p1", "fonction": "AGENT DE SECURITE", "min": 24000, "max": 60000}],
    })

    bulletins = _collection(client, auth_headers, "paieBulletins")
    mine = next(b for b in bulletins if b["id"] == "b_p1")
    assert mine["calcul"]["netAPayer"] == 40915, "le calcul figé doit être conservé tel quel"

    assert any(e["id"] == "e_p1" for e in _collection(client, auth_headers, "paieElements"))
    assert any(c["id"] == "c_p1" for c in _collection(client, auth_headers, "paieClotures"))
    assert any(g["id"] == "g_p1" for g in _collection(client, auth_headers, "paieGrilles"))


def test_paie_config_persists_as_object(client, auth_headers):
    _put(client, auth_headers, {"paieConfig": {"snmg": 24000, "tauxCnasSalarie": 9, "abattementIRG": 40}})
    snap = client.get("/api/irongs/db", headers=auth_headers).json()
    cfg = snap.get("paieConfig") or {}
    assert cfg.get("snmg") == 24000 and cfg.get("tauxCnasSalarie") == 9


def test_empty_save_never_wipes_payslips(client, auth_headers):
    """CRITIQUE : une sauvegarde vide ne doit JAMAIS effacer les bulletins de paie."""
    _put(client, auth_headers, {"paieBulletins": [_bulletin("b_keep1", SOC_IGS, 1000), _bulletin("b_keep2", SOC_IGS, 2000)]})
    _put(client, auth_headers, {"paieBulletins": []})  # client non chargé / multi-PC

    ids = {b["id"] for b in _collection(client, auth_headers, "paieBulletins")}
    assert {"b_keep1", "b_keep2"} <= ids, "Bulletins de paie effacés par une sauvegarde vide !"


def test_absent_collection_never_wipes_payslips(client, auth_headers):
    _put(client, auth_headers, {"paieBulletins": [_bulletin("b_abs", SOC_IGS, 3000)],
                                "paieElements": [{"id": "e_abs", "agentId": "ag1", "ym": "2026-03"}]})
    # Sauvegarde qui n'inclut QUE paieElements
    _put(client, auth_headers, {"paieElements": [{"id": "e_abs", "agentId": "ag1", "ym": "2026-03"}]})

    ids = {b["id"] for b in _collection(client, auth_headers, "paieBulletins")}
    assert "b_abs" in ids, "Une collection absente du payload a effacé les bulletins"


def test_closed_payslip_is_not_altered_by_a_later_save(client, auth_headers):
    """Un bulletin clôturé garde son calcul figé même si l'agent change ensuite."""
    _put(client, auth_headers, {"paieBulletins": [_bulletin("b_fige", SOC_IGS, 40915)],
                                "paieClotures": [{"id": "c_fige", "ym": "2026-03", "societe": SOC_IGS}]})
    # Une sauvegarde ultérieure sur une AUTRE collection ne touche pas au bulletin
    _put(client, auth_headers, {"notifications": [{"id": "n_paie"}]})

    b = next(x for x in _collection(client, auth_headers, "paieBulletins") if x["id"] == "b_fige")
    assert b["calcul"]["netAPayer"] == 40915
    assert any(c["id"] == "c_fige" for c in _collection(client, auth_headers, "paieClotures"))


# ── Confidentialité : les salaires ne franchissent pas la frontière société ──

def test_snapshot_hides_foreign_society_payslips(client, auth_headers, restricted_headers):
    """GET /api/irongs/db : un utilisateur restreint ne voit pas les bulletins d'une autre société."""
    _put(client, auth_headers, {"paieBulletins": [
        _bulletin("b_snap_igs", SOC_IGS, 40915),
        _bulletin("b_snap_swd", SOC_SWORD, 99999),
    ]})
    snap = client.get("/api/irongs/db", headers=restricted_headers).json()
    ids = {b["id"] for b in (snap.get("paieBulletins") or [])}
    assert "b_snap_igs" in ids
    assert "b_snap_swd" not in ids, "Le snapshot expose les salaires d'une autre société !"


def test_collection_endpoint_hides_foreign_society_payslips(client, auth_headers, restricted_headers):
    """GET /api/irongs/collections/paieBulletins doit filtrer comme le snapshot."""
    _put(client, auth_headers, {"paieBulletins": [
        _bulletin("b_col_igs", SOC_IGS, 40915),
        _bulletin("b_col_swd", SOC_SWORD, 99999),
    ]})
    ids = {b["id"] for b in _collection(client, restricted_headers, "paieBulletins")}
    assert "b_col_igs" in ids
    assert "b_col_swd" not in ids, \
        "FUITE : les bulletins de salaire d'une autre société sont lisibles via /collections"


def test_global_grille_and_cloture_stay_visible_to_restricted_user(client, auth_headers, restricted_headers):
    """Le cloisonnement ne doit PAS emporter les références globales de la paie.

    Le métier s'appuie dessus : paieGrilleForAgent accepte une grille sans société,
    et paieIsClosed traite societe == "" comme une clôture « toutes sociétés ».
    Les jeter ferait perdre le plancher/plafond de grille (base de salaire fausse)
    et rouvrirait un mois pourtant clôturé.
    """
    _put(client, auth_headers, {
        "paieGrilles": [
            {"id": "g_global", "fonction": "AGENT DE SECURITE", "min": 40000, "max": 80000},
            {"id": "g_igs", "fonction": "CHEF", "societe": SOC_IGS, "min": 50000},
            {"id": "g_swd", "fonction": "CHEF", "societe": SOC_SWORD, "min": 90000},
        ],
        "paieClotures": [
            {"id": "c_global", "ym": "2026-03", "societe": ""},
            {"id": "c_swd", "ym": "2026-04", "societe": SOC_SWORD},
        ],
    })
    snap = client.get("/api/irongs/db", headers=restricted_headers).json()
    grilles = {g["id"] for g in (snap.get("paieGrilles") or [])}
    clotures = {c["id"] for c in (snap.get("paieClotures") or [])}

    assert "g_global" in grilles, "La grille GLOBALE a disparu pour un utilisateur restreint"
    assert "g_igs" in grilles, "La grille de sa propre société a disparu"
    assert "g_swd" not in grilles, "La grille d'une autre société est visible"
    assert "c_global" in clotures, "La clôture GLOBALE a disparu pour un utilisateur restreint"
    assert "c_swd" not in clotures, "La clôture d'une autre société est visible"

    # Même règle sur l'endpoint mono-collection
    ids = {g["id"] for g in _collection(client, restricted_headers, "paieGrilles")}
    assert "g_global" in ids and "g_igs" in ids and "g_swd" not in ids


def test_restricted_user_cannot_replace_the_database(client, auth_headers, restricted_headers):
    """La sauvegarde globale est réservée à l'administrateur : un utilisateur restreint
    ne peut donc jamais écraser les bulletins d'une autre société."""
    _put(client, auth_headers, {"paieBulletins": [
        _bulletin("b_w_igs", SOC_IGS, 40915),
        _bulletin("b_w_swd", SOC_SWORD, 99999),
    ]})
    refus = client.put("/api/irongs/db", headers=restricted_headers, json={
        "data": {"paieBulletins": [_bulletin("b_w_igs", SOC_IGS, 41000)]}
    })
    assert refus.status_code == 403, refus.text

    # Les bulletins des deux sociétés sont intacts
    ids = {b["id"] for b in _collection(client, auth_headers, "paieBulletins")}
    assert {"b_w_igs", "b_w_swd"} <= ids


def test_restricted_user_cannot_replace_a_payslip_collection(client, auth_headers, restricted_headers):
    """Le remplacement d'une collection de paie est lui aussi réservé à l'administrateur."""
    _put(client, auth_headers, {"paieBulletins": [_bulletin("b_rc", SOC_IGS, 40915)]})
    refus = client.put("/api/irongs/collections/paieBulletins", headers=restricted_headers,
                       json={"data": []})
    assert refus.status_code == 403, refus.text
    assert any(b["id"] == "b_rc" for b in _collection(client, auth_headers, "paieBulletins"))
