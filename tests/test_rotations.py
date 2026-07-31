from datetime import date


def _rotation_payload(code: str, work_day: int = 0):
    days = []
    for index in range(7):
        days.append({
            "status": "travail" if index == work_day else "repos",
            "start_time": "08:00",
            "end_time": "16:00",
            "label": "Jour" if index == work_day else "Repos",
        })
    return {
        "code": code, "name": f"Rotation {code}", "description": "Test",
        "cycle_length": 7, "cycle_days": days, "group_offsets": {"A": 0, "B": 1}, "active": 1,
    }


def test_multiple_rotations_can_be_linked_to_same_site(client, auth_headers):
    site = client.post("/api/ops/sites", headers=auth_headers, json={"name": "Site multi rotation", "active": 1}).json()
    r1 = client.post("/api/ops/rotations", headers=auth_headers, json=_rotation_payload("ROT-T1"))
    r2 = client.post("/api/ops/rotations", headers=auth_headers, json=_rotation_payload("ROT-T2", 1))
    assert r1.status_code == 201, r1.text
    assert r2.status_code == 201, r2.text
    for rotation in (r1.json(), r2.json()):
        linked = client.post("/api/ops/site-rotations", headers=auth_headers, json={
            "site_id": site["id"], "rotation_id": rotation["id"],
            "start_date": date.today().isoformat(), "active": 1,
        })
        assert linked.status_code == 201, linked.text
    links = client.get(f"/api/ops/site-rotations?site_id={site['id']}", headers=auth_headers)
    assert links.status_code == 200
    assert len(links.json()) == 2


def test_rotation_requires_complete_cycle(client, auth_headers):
    payload = _rotation_payload("ROT-BAD")
    payload["cycle_days"] = payload["cycle_days"][:-1]
    response = client.post("/api/ops/rotations", headers=auth_headers, json=payload)
    assert response.status_code == 400
