from pathlib import Path


JS = (Path(__file__).parents[1] / "app/static/sgdi-app.js").read_text(encoding="utf-8")


def test_recruitment_unwraps_action_response_before_mapping_employee():
    assert "const savedEmployee=savedAction?.data||savedAction" in JS
    assert "candidateFromApi(revalidated?.data||revalidated)" in JS


def test_contract_preview_normalizes_employee_identity_for_html_and_word():
    assert 'nom:value("nom","last_name","lastName")' in JS
    assert 'prenom:value("prenom","first_name","firstName")' in JS
    assert 'dateNaissance:value("dateNaissance","birth_date","birthDate")' in JS
    assert 'lieuNaissance:value("lieuNaissance","birth_place","birthPlace")' in JS
    assert "function apsContractDocumentHTML(a,d){\n  a=contractEmployeeData(a);" in JS
    assert "function employeeNewContractPayload(draft){\n  const a=contractEmployeeData(draft.a);" in JS


def test_incomplete_contract_fields_are_highlighted_and_block_submission():
    css = (Path(__file__).parents[1] / "app/static/sgdi-app.css").read_text(encoding="utf-8")
    assert "function refreshNewContractRequiredFields(form)" in JS
    assert 'field.classList.toggle("nc-required-missing",missing)' in JS
    assert 'field.setAttribute("aria-invalid",missing?"true":"false")' in JS
    assert "if(!refreshNewContractRequiredFields(form))" in JS
    assert ".nc-field .nc-required-missing" in css
    assert "border:2px solid #dc2626!important" in css
