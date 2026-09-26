"""Nettoyage par module : la base de test est partagée par toute la session. Un module qui
crée beaucoup d'employés/sites fausserait les tests suivants qui lisent des agrégats globaux
(top des sites, première page d'employés). À la fin du module, tout ce qu'il a créé au-delà des
identifiants maximaux relevés au début est supprimé (cascades de la base : affectations,
présences, événements, anomalies, gabarits, caméras, permissions)."""
import pytest
from sqlalchemy import delete, func, select


@pytest.fixture(scope="module", autouse=True)
def purge_rows_created_by_this_module():
    from app.modules.auth.models import User
    from app.modules.drh.models import Employee
    from app.modules.ops.models import Site
    from tests.conftest import TestSessionLocal

    models = (Employee, Site, User)
    with TestSessionLocal() as session:
        marks = {model: session.scalar(select(func.max(model.id))) or 0 for model in models}
    yield
    with TestSessionLocal() as session:
        for model in models:
            session.execute(delete(model).where(model.id > marks[model]))
        session.commit()
