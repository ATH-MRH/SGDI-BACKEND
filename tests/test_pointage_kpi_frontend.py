from pathlib import Path


ROOT = Path(__file__).parents[1]
JS = (ROOT / "app/static/sgdi-app.js").read_text(encoding="utf-8")
CSS = (ROOT / "app/static/sgdi-app.css").read_text(encoding="utf-8")


def test_pointage_summary_counters_open_their_detail_filters():
    section = JS.split('const kpiCard=(lbl,val,sub,color,filter,alertCls)', 1)[1].split(
        "const legendCodes", 1
    )[0]
    assert "pt-auto-kpi-clickable" in section
    assert "onclick=\"setPtAutoChip('${filter}')\"" in section
    assert '"Effectif",effectif' in section and '"all"' in section
    assert '"Présents aujourd’hui"' in section and '"present"' in section
    assert '"Taux de présence — mois"' in section and '"gaps"' in section
    assert '"Absences paie"' in section and '"absences"' in section
    assert '"Alertes du jour"' in section and '"alert"' in section


def test_pointage_counter_filters_and_interaction_styles_exist():
    assert '["present","Présents aujourd’hui"' in JS
    assert '["absences","Absences paie"' in JS
    assert ".pt-auto-kpi-clickable:hover" in CSS
    assert ".pt-auto-kpi-clickable:focus-visible" in CSS
