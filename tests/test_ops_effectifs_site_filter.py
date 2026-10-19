"""Filtre SITE de Gestion des effectifs OPS : /api/ops/employees/page?site_id=...

Complète test_ops_employee_photos.py (site précis, affectation la plus récente) avec
« Sans affectation » (__none__), la combinaison recherche / tri / pagination et le
périmètre d'un compte limité à certains sites, y compris la liste des sites proposés.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import delete

from app.core.security import create_access_token
from app.modules.auth.models import User
from app.modules.drh.models import Employee
from app.modules.ops.models import Assignment, Site
from tests.conftest import TestSessionLocal

PREFIX = "OPS-SITE-FILTER"
HAMOUL = ["ABDELHAMID", "ABDELKADER", "BENALI", "CHAOUI", "DAHMANI", "ELHADI"]
SOC_A, SOC_B = f"{PREFIX} Alpha", f"{PREFIX} Beta"


@pytest.fixture(scope="module")
def world(create_tables):
    session = TestSessionLocal()
    sites, people = {}, {}
    try:
        for key, society in [("hamoul", SOC_A), ("x", SOC_A), ("beta", SOC_B)]:
            site = Site(name=f"{PREFIX}-{key}", active=1, equipment_plan={"societe": society})
            session.add(site)
            session.flush()
            sites[key] = site.id
        # nom, société, site actif (None = sans affectation), affectation terminée éventuelle
        rows = [("ABDELKADER", SOC_A, "hamoul", None), ("BENALI", SOC_A, "hamoul", None),
                ("ABDELHAMID", SOC_A, "hamoul", None), ("CHAOUI", SOC_A, "hamoul", None),
                ("DAHMANI", SOC_A, "hamoul", None), ("ELHADI", SOC_A, "hamoul", None),
                ("ABDELLAH", SOC_A, "x", None),
                ("ZOUAOUI", SOC_A, None, None), ("ABDELMALEK", SOC_A, None, "hamoul"),
                ("ABDELBETA", SOC_B, "beta", None)]
        for index, (name, society, site_key, ended_key) in enumerate(rows):
            employee = Employee(code=f"{PREFIX}-{index:02d}", first_name="P", last_name=name,
                                society=society, status="actif", position="APS")
            session.add(employee)
            session.flush()
            people[name] = employee.id
            if site_key:
                session.add(Assignment(employee_id=employee.id, site_id=sites[site_key], active=1,
                                       start_date=date(2024, 1, 1)))
            if ended_key:
                # Affectation passée : ne compte pas comme affectation active.
                session.add(Assignment(employee_id=employee.id, site_id=sites[ended_key], active=1,
                                       start_date=date(2023, 1, 1), end_date=date.today() - timedelta(days=1)))
        headers = {}
        for name, societies, site_ids in [("society", [SOC_A], []), ("supervisor", [SOC_A], [sites["hamoul"]])]:
            user = User(username=f"{PREFIX}-{name}", full_name="Site filter", role="ops", access_level="H2",
                        authorized_modules=["ops"], authorized_societies=societies, authorized_sites=site_ids,
                        authorized_structures=[], password_hash="unused", is_active=True, global_society_access=False)
            session.add(user)
            session.flush()
            headers[name] = {"Authorization": f"Bearer {create_access_token(str(user.id))}"}
        session.commit()
        yield {"sites": sites, "people": people, "headers": headers}
    finally:
        session.rollback()
        ids = list(people.values())
        if ids:
            session.execute(delete(Assignment).where(Assignment.employee_id.in_(ids)))
            session.execute(delete(Employee).where(Employee.id.in_(ids)))
        if sites:
            session.execute(delete(Site).where(Site.id.in_(list(sites.values()))))
        session.execute(delete(User).where(User.username.like(f"{PREFIX}-%")))
        session.commit()
        session.close()


def _page(client, headers, **params):
    response = client.get("/api/ops/employees/page", headers=headers,
                          params={"q": PREFIX, "mode": "actifs", "page_size": 25, **params})
    assert response.status_code == 200, response.text
    return response.json()


def _names(data):
    return [row["last_name"] for row in data["items"]]


def test_all_sites_specific_site_and_without_assignment(client, auth_headers, world):
    sites = world["sites"]
    assert _page(client, auth_headers, society=SOC_A)["total"] == 9
    hamoul = _page(client, auth_headers, society=SOC_A, site_id=sites["hamoul"])
    assert sorted(_names(hamoul)) == HAMOUL
    assert hamoul["total"] == 6
    assert _names(_page(client, auth_headers, society=SOC_A, site_id=sites["x"])) == ["ABDELLAH"]
    # Une affectation terminée hier ne retire pas l'employé de « Sans affectation ».
    none = _page(client, auth_headers, society=SOC_A, site_id="__none__")
    assert sorted(_names(none)) == ["ABDELMALEK", "ZOUAOUI"]
    assert all(row["extra"]["_legacy"]["affectationCourante"] == {} for row in none["items"])


def test_search_sort_and_pagination_keep_the_site_filter(client, auth_headers, world):
    hamoul = world["sites"]["hamoul"]
    found = _page(client, auth_headers, society=SOC_A, site_id=hamoul, q="ABDEL")
    assert sorted(_names(found)) == ["ABDELHAMID", "ABDELKADER"]
    assert _names(_page(client, auth_headers, site_id="__none__", q="ABDEL", society=SOC_A)) == ["ABDELMALEK"]
    assert _names(_page(client, auth_headers, society=SOC_A, site_id=hamoul, sort="nom_desc")) == HAMOUL[::-1]
    # 5 lignes par page au minimum (pagination existante) : 6 employés du site = 2 pages.
    first, second = (_page(client, auth_headers, society=SOC_A, site_id=hamoul, sort="nom_asc", page_size=5, page=n)
                     for n in (1, 2))
    assert (first["total"], first["pages"], second["page"]) == (6, 2, 2)
    assert _names(first) + _names(second) == HAMOUL


def test_invalid_site_id_is_rejected(client, auth_headers, world):
    response = client.get("/api/ops/employees/page", headers=auth_headers, params={"site_id": "abc"})
    assert response.status_code == 422


def test_society_scope_never_returns_another_society_site(client, world):
    headers, sites = world["headers"]["society"], world["sites"]
    assert _page(client, headers, site_id=sites["beta"])["items"] == []
    assert client.get("/api/ops/employees/page", headers=headers,
                      params={"society": SOC_B, "site_id": sites["beta"]}).status_code == 403
    listed = client.get("/api/ops/sites", headers=headers)
    assert listed.status_code == 200
    names = {row["name"] for row in listed.json() if row["name"].startswith(PREFIX)}
    assert names == {f"{PREFIX}-hamoul", f"{PREFIX}-x"}, "aucun site d'une autre société proposé"


def test_site_limited_supervisor_sees_only_authorized_sites(client, world):
    headers, sites = world["headers"]["supervisor"], world["sites"]
    assert sorted(_names(_page(client, headers))) == HAMOUL
    assert sorted(_names(_page(client, headers, site_id=sites["hamoul"]))) == HAMOUL
    assert _page(client, headers, site_id=sites["x"])["items"] == []
    # Les employés sans affectation ne sont pas dans le périmètre d'un compte limité par site.
    assert _page(client, headers, site_id="__none__")["items"] == []
    listed = client.get("/api/ops/sites", headers=headers)
    assert listed.status_code == 200
    assert {row["id"] for row in listed.json()} == {sites["hamoul"]}


def test_shortcut_counts_cover_the_whole_result_not_the_page(client, auth_headers, world):
    sites = world["sites"]

    def counts(headers=auth_headers, **params):
        return _page(client, headers, page_size=5, **params)["filters"]["counts"]

    base = counts(society=SOC_A)
    assert {row["site_id"]: row["count"] for row in base["sites"]} == {sites["hamoul"]: 6, sites["x"]: 1}
    assert (base["sites_none"], base["sites_total"]) == (2, 9)
    assert base["postes"] == [{"poste": "APS", "count": 9}] and base["postes_total"] == 9
    # SITE ne change pas ses propres compteurs ; POSTE devient contextuel au site.
    hamoul = counts(society=SOC_A, site_id=sites["hamoul"])
    assert hamoul["sites_total"] == 9 and hamoul["postes_total"] == 6
    assert counts(society=SOC_A, site_id="__none__")["postes_total"] == 2
    # Le filtre POSTE et la recherche n'alimentent pas les compteurs.
    assert counts(society=SOC_A, site_id=sites["hamoul"], poste="APS", q="ABDEL") == hamoul
    data = _page(client, auth_headers, society=SOC_A, poste="Cariste")
    assert data["total"] == 0 and data["filters"]["counts"]["postes_total"] == 9
    supervisor = counts(world["headers"]["supervisor"])
    assert [row["site_id"] for row in supervisor["sites"]] == [sites["hamoul"]]
    assert (supervisor["sites_none"], supervisor["sites_total"]) == (0, 6)


def test_shortcut_counts_stay_bounded_and_keep_the_selection(monkeypatch, client, auth_headers, world):
    from app.modules.ops import employee_photos
    monkeypatch.setattr(employee_photos, "SHORTCUT_COUNTS_LIMIT", 1)
    sites = world["sites"]
    top = _page(client, auth_headers, society=SOC_A)["filters"]["counts"]
    assert [row["site_id"] for row in top["sites"]] == [sites["hamoul"]] and top["sites_total"] == 9
    chosen = _page(client, auth_headers, society=SOC_A, site_id=sites["x"])["filters"]["counts"]
    assert [row["site_id"] for row in chosen["sites"]] == [sites["hamoul"], sites["x"]], "le site choisi reste compté"
