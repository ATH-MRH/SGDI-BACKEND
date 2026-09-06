from pathlib import Path


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
