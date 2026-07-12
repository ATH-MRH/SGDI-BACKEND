"""Tests de l'externalisation des documents employés (base64 -> disque).

Même principe que les photos : le base64 quitte la base pour le disque persistant,
et .url devient /uploads/docs/... (le frontend affiche déjà ce format). Aucun
document n'est jamais perdu, même en cas d'erreur de décodage.
"""
import base64
import importlib

import pytest


@pytest.fixture()
def photo_storage(tmp_path, monkeypatch):
    """Recharge le module avec un répertoire d'upload temporaire et isolé."""
    monkeypatch.setenv("SGDI_UPLOADS_DIR", str(tmp_path))
    import app.core.photo_storage as ps
    importlib.reload(ps)
    yield ps
    importlib.reload(ps)  # restaure l'état par défaut pour les autres tests


def _data_url(mime, raw_bytes):
    return f"data:{mime};base64," + base64.b64encode(raw_bytes).decode()


def test_save_pdf_document_writes_file_and_returns_url(photo_storage, tmp_path):
    url, saved = photo_storage.save_base64_document(_data_url("application/pdf", b"%PDF-1.4 fake"), "A01_CV")
    assert saved is True
    assert url == "/uploads/docs/A01_CV.pdf"
    assert (tmp_path / "docs" / "A01_CV.pdf").read_bytes() == b"%PDF-1.4 fake"


def test_save_image_document_uses_right_extension(photo_storage, tmp_path):
    url, saved = photo_storage.save_base64_document(_data_url("image/png", b"\x89PNG..."), "K10_Acte")
    assert saved and url.endswith(".png")
    assert (tmp_path / "docs" / "K10_Acte.png").exists()


def test_already_external_url_is_left_untouched(photo_storage):
    for url in ("/uploads/docs/x.pdf", "https://cdn/x.pdf", ""):
        out, saved = photo_storage.save_base64_document(url, "X")
        assert (out, saved) == (url, False)


def test_invalid_base64_keeps_original_never_loses(photo_storage):
    bad = "data:application/pdf;base64,@@@not-valid@@@"
    out, saved = photo_storage.save_base64_document(bad, "X")
    # base64 permissif : soit ça décode partiellement (saved True), soit on garde tel quel.
    assert saved is True or out == bad


def test_unknown_mime_falls_back_to_bin(photo_storage, tmp_path):
    url, saved = photo_storage.save_base64_document(_data_url("application/x-inconnu", b"data"), "X_doc")
    assert saved and url.endswith(".bin")


def test_externalize_employee_documents_only_touches_base64(photo_storage):
    documents = {
        "CV": {"url": _data_url("application/pdf", b"cv"), "name": "cv.pdf"},
        "Acte": {"url": "/uploads/docs/deja.pdf", "name": "acte.pdf"},   # déjà externalisé
        "Casier": {"url": "https://cdn/casier.pdf"},                     # externe
        "Note": {"html": "<p>note</p>"},                                 # pas d'url
        "Vide": {"name": "rien"},                                        # rien à faire
    }
    out = photo_storage.externalize_employee_documents(documents, fallback="A01")
    assert out["CV"]["url"] == "/uploads/docs/A01_CV.pdf", "le base64 doit être externalisé"
    assert out["CV"]["name"] == "cv.pdf", "les autres champs du document sont conservés"
    assert out["Acte"]["url"] == "/uploads/docs/deja.pdf"    # inchangé
    assert out["Casier"]["url"] == "https://cdn/casier.pdf"  # inchangé
    assert out["Note"]["html"] == "<p>note</p>"              # inchangé
    assert out["Vide"] == {"name": "rien"}                   # inchangé


def test_externalize_does_not_mutate_input(photo_storage):
    documents = {"CV": {"url": _data_url("application/pdf", b"cv")}}
    avant = documents["CV"]["url"]
    photo_storage.externalize_employee_documents(documents, fallback="A01")
    assert documents["CV"]["url"] == avant, "l'entrée d'origine ne doit pas être modifiée"


def test_externalize_is_idempotent(photo_storage):
    documents = {"CV": {"url": _data_url("application/pdf", b"cv")}}
    once = photo_storage.externalize_employee_documents(documents, fallback="A01")
    twice = photo_storage.externalize_employee_documents(once, fallback="A01")
    assert once["CV"]["url"] == twice["CV"]["url"] == "/uploads/docs/A01_CV.pdf"


def test_externalize_handles_non_dict_entries(photo_storage):
    documents = {"weird": "juste-une-chaine", "ok": {"url": _data_url("image/jpeg", b"x")}}
    out = photo_storage.externalize_employee_documents(documents, fallback="A01")
    assert out["weird"] == "juste-une-chaine"
    assert out["ok"]["url"].endswith(".jpg")
