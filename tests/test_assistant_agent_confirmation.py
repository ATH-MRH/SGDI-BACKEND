"""LOT — CONFIRMATION HUMAINE OBLIGATOIRE AVANT ÉCRITURE PAR L'ASSISTANT IA.

_dispatch() est le point de passage unique de TOUS les outils, pour les deux
backends (Claude et le repli Ollama) — voir app/modules/assistant/agent.py,
_run_claude_agent et _run_ollama_agent appellent tous deux _dispatch(...).
Ce fichier vérifie que :

- les 6 outils d'écriture métier (create_candidate, create_event,
  update_employee_status, create_leave, create_assignment, schedule_task)
  n'écrivent JAMAIS rien au premier appel (confirmed absent ou false) — la
  porte est vérifiée AVANT même l'appel du handler, donc même avec des
  paramètres incomplets/invalides, aucune tentative d'écriture n'a lieu ;
- un second appel avec confirmed=true exécute réellement l'action (mêmes
  effets qu'avant ce lot) ;
- remember/add_knowledge (mémoire de l'assistant, sans impact métier) et les
  outils de lecture ne sont pas concernés par cette porte.
"""
from app.modules.assistant import agent
from app.modules.auth.models import User
from app.modules.drh.models import Employee


def _admin_user(db):
    return db.query(User).filter(User.username == "testadmin").first()


def test_all_write_tools_require_confirmation_before_touching_the_database(db):
    """Appelés SANS confirmed, avec des paramètres même vides/incomplets, les 6
    outils d'écriture ne doivent jamais atteindre leur handler réel — la porte
    de _dispatch() s'applique avant toute validation métier."""
    user = _admin_user(db)
    assert agent._WRITE_TOOLS_REQUIRE_CONFIRMATION == {
        "create_candidate", "create_event", "update_employee_status",
        "create_leave", "create_assignment", "schedule_task",
    }
    for name in agent._WRITE_TOOLS_REQUIRE_CONFIRMATION:
        raw = agent._dispatch(name, {}, db, user)
        assert '"pending_confirmation": true' in raw, f"{name} doit renvoyer pending_confirmation sans confirmed"
        assert '"ok": false' in raw
        assert f'"action": "{name}"' in raw


def test_confirmed_false_still_blocks(db):
    user = _admin_user(db)
    raw = agent._dispatch("update_employee_status", {"reference": "X", "statut": "actif", "confirmed": False}, db, user)
    assert '"pending_confirmation": true' in raw


def test_update_employee_status_full_round_trip(db):
    emp = Employee(code="ASSIST01", first_name="Test", last_name="Assistant",
                    society="Iron Global Securite", status="actif", contract_type="CDD")
    db.add(emp)
    db.commit()
    db.refresh(emp)
    user = _admin_user(db)

    # 1) Sans confirmation : aucune écriture, statut inchangé en base.
    pending = agent._dispatch("update_employee_status", {"reference": "ASSIST01", "statut": "suspendu"}, db, user)
    assert '"pending_confirmation": true' in pending
    db.refresh(emp)
    assert emp.status == "actif", "le statut ne doit pas changer tant que confirmed n'est pas True"

    # 2) Avec confirmation explicite : l'écriture a réellement lieu, comme avant ce lot.
    done = agent._dispatch("update_employee_status", {"reference": "ASSIST01", "statut": "suspendu", "confirmed": True}, db, user)
    assert '"ok": true' in done
    assert "pending_confirmation" not in done
    db.refresh(emp)
    assert emp.status == "suspendu"


def test_create_candidate_full_round_trip(db):
    from app.modules.drh.models import Candidate
    user = _admin_user(db)
    before = db.query(Candidate).count()

    pending = agent._dispatch("create_candidate", {
        "nom": "Dupont", "prenom": "Jean", "societe": "Iron Global Securite",
    }, db, user)
    assert '"pending_confirmation": true' in pending
    assert db.query(Candidate).count() == before, "aucun candidat ne doit être créé sans confirmation"

    done = agent._dispatch("create_candidate", {
        "nom": "Dupont", "prenom": "Jean", "societe": "Iron Global Securite", "confirmed": True,
    }, db, user)
    assert '"ok": true' in done
    assert db.query(Candidate).count() == before + 1


def test_remember_and_add_knowledge_are_not_gated(db):
    """La mémoire propre de l'assistant (sans impact sur les données métier) reste
    immédiate — geler ces outils casserait la fonctionnalité « mémoire » attendue."""
    user = _admin_user(db)
    assert "remember" not in agent._WRITE_TOOLS_REQUIRE_CONFIRMATION
    assert "add_knowledge" not in agent._WRITE_TOOLS_REQUIRE_CONFIRMATION
    raw = agent._dispatch("remember", {"note": "Test mémoire assistant"}, db, user)
    assert '"pending_confirmation"' not in raw
    assert '"ok": true' in raw


def test_read_tools_and_generate_report_are_not_gated(db):
    user = _admin_user(db)
    assert "dashboard_counts" not in agent._WRITE_TOOLS_REQUIRE_CONFIRMATION
    assert "generate_report" not in agent._WRITE_TOOLS_REQUIRE_CONFIRMATION
    raw = agent._dispatch("dashboard_counts", {}, db, user)
    assert '"pending_confirmation"' not in raw


def test_confirmed_key_never_leaks_into_the_handler_kwargs(db):
    """confirmed doit être retiré de tool_input avant l'appel du handler, jamais
    passé tel quel (sinon TypeError: unexpected keyword argument 'confirmed')."""
    user = _admin_user(db)
    raw = agent._dispatch("remember", {"note": "sans confirmed, ne doit jamais planter"}, db, user)
    assert "unexpected keyword argument" not in raw
    assert '"error"' not in raw


def test_tools_schema_exposes_confirmed_parameter_on_write_tools_only():
    by_name = {t["name"]: t for t in agent.TOOLS}
    for name in agent._WRITE_TOOLS_REQUIRE_CONFIRMATION:
        assert "confirmed" in by_name[name]["input_schema"]["properties"], f"{name} doit exposer confirmed dans son schéma"
        assert "confirmed" not in by_name[name]["input_schema"].get("required", []), \
            f"{name} : confirmed ne doit jamais être obligatoire (sinon Claude devrait le deviner dès le premier appel)"
    for name in ("remember", "add_knowledge", "dashboard_counts", "generate_report"):
        assert "confirmed" not in by_name[name]["input_schema"]["properties"]
