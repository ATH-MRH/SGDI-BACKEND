from pathlib import Path
import subprocess


HTML = (Path(__file__).parents[1] / "app/static/recrute.html").read_text(encoding="utf-8")


def test_interview_action_is_available_only_after_convocation():
    assert 'candidateConvocation(item)?`<button type="button" class="row-convoke"' in HTML
    assert '>Entretien</button>' in HTML


def test_interview_uses_ten_point_scale_and_draft_validation_workflow():
    assert "Array.from({length:11}" in HTML
    assert 'bareme:10' in HTML
    assert 'Enregistrer le brouillon' in HTML
    assert "Valider l’entretien" in HTML
    assert "Entretien validé — consultation uniquement." in HTML


def test_interview_contains_operational_decision_fields():
    for field in (
        'name="presence"',
        'name="dateSuivi"',
        'name="salaireSouhaite"',
        'name="salairePropose"',
        'name="pointsForts"',
        'name="pointsVigilance"',
        'name="recommandation"',
        'name="prochaineEtape"',
    ):
        assert field in HTML


def test_favorable_candidate_gets_direct_green_recruit_action():
    # Execute the real renderer and handler instead of depending on the spelling
    # of a local JavaScript condition. This test uses only Node built-ins.
    root = Path(__file__).parents[1]
    result = subprocess.run(
        ["node", "--test", "tests_frontend/recrute-favorable-action.test.js"],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_recruitment_society_is_proposed_in_interview_and_transfer_uses_the_ventilated_society():
    assert 'name="societeRecrutement" required' in HTML
    # « Recruter » transfère le dossier ventilé tel quel ; pour un dossier non ventilé, la société
    # vient des options du serveur et part dans le même appel de transfert.
    assert '/transfer-drh`,assignment?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(assignment)}:{method:"POST"}' in HTML
    assert '/transfer-options`' in HTML
    assert 'Choisissez la société destinataire.' in HTML
    assert 'body:JSON.stringify({society,data:' not in HTML
    assert '/ventilation`,{method:"POST"' in HTML


def test_candidate_pool_is_shared_until_favorable_interview():
    # V7 : le vivier est celui du Groupe ; « Non ventilés » est un filtre de portefeuille.
    assert "PORTFOLIO_UNASSIGNED+'\">Non ventilés</option>'" in HTML
    assert 'society:existing?.society||null' in HTML
    # L'import Excel est désormais traité par le serveur : fiche non ventilée, statut initial.
    importer = (Path(__file__).resolve().parents[1] / "app" / "modules" / "drh" / "candidate_import.py").read_text(encoding="utf-8")
    assert 'payload: dict[str, Any] = {"status": "nouvelle", "society": None}' in importer
    assert "importRecruitmentExcel" not in HTML
    assert 'if(valide&&entretien.recommandation==="Favorable"&&recruitmentCanVentilate())payload.society=' in HTML
