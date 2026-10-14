"""Studio Badges DRH — texte multilingue du PDF (français et arabe).

Les polices standard du PDF (Helvetica, Times, Courier) couvrent le latin de Windows-1252.
Dès qu'un texte en sort (arabe, par exemple), il est dessiné avec la police DejaVu Sans
embarquée dans l'application (app/static/fonts), après deux traitements faits ICI, sans aucun
service externe :

- mise en forme : chaque lettre arabe prend sa forme liée (isolée, initiale, médiane, finale) ;
- ordre d'affichage : algorithme bidirectionnel Unicode — l'arabe se lit de droite à gauche,
  les mots latins et les nombres restent de gauche à droite dans la même ligne.

Le navigateur fait ces deux traitements nativement pour l'aperçu, avec la même police.
"""
from __future__ import annotations

import threading
from pathlib import Path

FONT_DIR = Path(__file__).resolve().parents[2] / "static" / "fonts"
UNICODE_FONT = "BadgeUnicode"
UNICODE_FONT_BOLD = "BadgeUnicode-Bold"
_FILES = {UNICODE_FONT: "DejaVuSans.ttf", UNICODE_FONT_BOLD: "DejaVuSans-Bold.ttf"}

_lock = threading.Lock()
_state: dict = {}


def is_latin(text: str) -> bool:
    try:
        str(text or "").encode("cp1252")
        return True
    except UnicodeEncodeError:
        return False


def _load() -> dict:
    """Polices et outils de mise en forme, chargés une fois. Indisponibles (fichier ou
    bibliothèque absents) : `ready` reste faux et tout texte non latin est déclaré non imprimable."""
    with _lock:
        if _state:
            return _state
        state = {"ready": False, "glyphs": frozenset()}
        try:
            import arabic_reshaper
            from bidi.algorithm import get_display
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.ttfonts import TTFont

            glyphs = None
            for name, filename in _FILES.items():
                font = TTFont(name, str(FONT_DIR / filename))
                pdfmetrics.registerFont(font)
                codes = frozenset(font.face.charToGlyph)
                glyphs = codes if glyphs is None else glyphs & codes
            # Seule la ligature lam-alef (obligatoire) est gardée : les ligatures décoratives
            # (« الله » en un seul signe…) ne sont pas dans la police.
            reshaper = arabic_reshaper.ArabicReshaper(configuration={
                "delete_harakat": False, "support_ligatures": True, "ARABIC LIGATURE ALLAH": False,
            })
            state.update(ready=True, glyphs=glyphs, reshape=reshaper.reshape, display=get_display)
        except Exception:                                   # police ou bibliothèque absente
            import logging

            logging.getLogger("sgdi.drh.badges").exception("Texte non latin indisponible pour les badges")
        _state.update(state)
        return _state


def visual(text: str) -> str:
    """Texte prêt à dessiner de gauche à droite : lettres liées, ordre d'affichage. Le sens de
    la ligne est celui de son premier caractère directionnel (arabe ⇒ droite à gauche)."""
    state = _load()
    if not state["ready"] or is_latin(text):
        return text
    return state["display"](state["reshape"](text))


def unsupported(text: str) -> str:
    """Caractères qu'aucune police du badge ne sait dessiner (chaîne vide si tout est imprimable)."""
    text = str(text or "")
    if is_latin(text):
        return ""
    state = _load()
    shaped = visual(text) if state["ready"] else text
    seen: list[str] = []
    for char in shaped:
        if char.isspace() or char in seen or is_latin(char):
            continue
        # Marques invisibles de direction : sans dessin, jamais bloquantes.
        if char in "‌‍‎‏؜⁦⁧⁨⁩":
            continue
        if not state["ready"] or ord(char) not in state["glyphs"]:
            seen.append(char)
    return "".join(seen)


def font_for(text: str, bold: bool) -> str | None:
    """Police embarquée à utiliser pour ce texte, ou None s'il tient dans les polices standard."""
    if is_latin(text) or not _load()["ready"]:
        return None
    return UNICODE_FONT_BOLD if bold else UNICODE_FONT
