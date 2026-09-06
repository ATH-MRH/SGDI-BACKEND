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


def test_favorable_candidate_gets_direct_green_recruit_action():
    assert 'const favorable=item.data?.avisDecision==="Favorable"' in HTML
    assert 'class="row-recruit" onclick="openCandidateRecruitment(${item.id})">Recruter</button>' in HTML
    assert ".row-recruit{background:#15803d" in HTML


def test_recruitment_society_is_selected_and_transmitted():
    assert 'name="societeRecrutement" required' in HTML
    assert 'name="society" required' in HTML
    assert 'societeRecrutement:society' in HTML
    assert 'body:JSON.stringify({society,data:' in HTML


def test_candidate_pool_is_shared_until_favorable_interview():
    assert '<option value="__unassigned__">Non affectés</option>' in HTML
    assert 'society:existing?.society||null' in HTML
    assert 'society:null,status:"nouvelle"' in HTML
    assert 'if(valide&&entretien.recommandation==="Favorable")payload.society=' in HTML
