from pathlib import Path


JS = (Path(__file__).parents[1] / "app/static/sgdi-app.js").read_text(encoding="utf-8")


def test_recruitment_unwraps_action_response_before_mapping_employee():
    assert "const savedEmployee=savedAction?.data||savedAction" in JS


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
    assert "background:#fff1f2!important" not in css
    assert 'content:"Champ obligatoire"' not in css


def test_preview_before_validation_always_opens_html_window():
    preview = JS.split("async function printEmployeeNewContractFromForm(form){", 1)[1].split(
        "function employeeNewContractPayload", 1
    )[0]
    assert "openEmployeeContractReviewWindow(draft.a,draft)" in preview
    assert "sgdiDownloadPost" not in preview
    assert "preview-from-form" not in preview


def test_contract_form_does_not_repeat_candidate_emergency_banner():
    contractualisation = JS.split("function renderContractualisation(view,id){", 1)[1].split(
        "function updateNewContractSummary", 1
    )[0]
    assert "nc-candidate-contact-row" not in contractualisation
    assert 'name="candidateWilaya"' not in contractualisation
    assert 'name="contactUrgenceLien"' not in contractualisation


def test_identity_document_and_nin_are_persisted_separately():
    proxy = JS.split("function candidateContractAgentProxy(c){", 1)[1].split(
        "function upsertServerEmployee", 1
    )[0]
    assert "numeroPieceIdentite:c.numeroPieceIdentite||c.pieceIdentiteNumero||\"\"" in proxy
    assert "async function persistCandidateContractIdentity(id,field,value)" in JS
    assert '["numeroPieceIdentite","nin"].includes(field)' in JS
    contractualisation = JS.split("function renderContractualisation(view,id){", 1)[1].split(
        "function updateNewContractSummary", 1
    )[0]
    assert "persistCandidateContractIdentity" in contractualisation


def test_missing_emergency_contact_does_not_block_employee_creation():
    confirmation = JS.split("async function confirmCandidateNewContract(form,id){", 1)[1].split(
        "async function recruitContractCandidateToEmployee", 1
    )[0]
    assert "missingContact" not in confirmation
    assert "Complétez les informations obligatoires" not in confirmation


def test_recruitment_does_not_revalidate_all_candidate_sections():
    recruitment = JS.split("async function recruitContractCandidateToEmployee", 1)[1].split(
        "async function embaucherCandidat", 1
    )[0]
    assert "validateCandidateSection" not in recruitment
    assert "validateCandidateFinal" not in recruitment


def test_contract_window_reports_real_error_and_secondary_saves_do_not_block():
    saving = JS.split("async function saveAndArchiveEmployeeContractFromWindow", 1)[1].split(
        "function employeeDocumentSignatureControls", 1
    )[0]
    assert "SGDI_CONTRACT_SAVE_ERROR" in saving
    assert 'saveDBAndWaitToast("Synchronisation secondaire du contrat non confirmée").catch' in saving
    assert 'if(!(await saveDBAndWaitToast("Contrat non confirmé")))return false' not in saving
    assert 'state.textContent=window.SGDI_CONTRACT_SAVE_ERROR||' in JS
