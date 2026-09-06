from pathlib import Path


STATIC_DIR = Path(__file__).parents[1] / "app" / "static"
RESPONSIVE_ENTRYPOINTS = (
    "candidat.html",
    "cheque.html",
    "client-portail.html",
    "commercial.html",
    "conges.html",
    "facturation.html",
    "index.html",
    "paie.html",
    "pointage-mockup.html",
    "pointeur.html",
    "portail-rh-bilingue.html",
    "recrute.html",
    "rh.html",
    "supervision.html",
)


def test_all_frontends_load_the_shared_responsive_baseline():
    for filename in RESPONSIVE_ENTRYPOINTS:
        html = (STATIC_DIR / filename).read_text(encoding="utf-8")
        assert "viewport" in html, filename
        assert "/static/responsive-baseline.css" in html, filename


def test_responsive_baseline_covers_phone_tablet_touch_and_safe_areas():
    css = (STATIC_DIR / "responsive-baseline.css").read_text(encoding="utf-8")
    assert "@media(max-width:1024px)" in css
    assert "@media(max-width:767px)" in css
    assert "@media(max-width:480px)" in css
    assert "@media(hover:none) and (pointer:coarse)" in css
    assert "safe-area-inset-bottom" in css
    assert "font-size:16px!important" in css
    assert "overflow-x:auto" in css
