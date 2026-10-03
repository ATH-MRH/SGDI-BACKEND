"""Correctif C1 — règle de cadrage du cercle de capture (tests déterministes, sans moteur).

L'image reçue est le carré du cercle : cercle inscrit, zone sûre = SAFE_RATIO × rayon. La tête
(estimée à partir de la boîte du visage) doit y être ENTIÈREMENT contenue."""
import pytest

from app.modules.biometrics import framing
from app.modules.biometrics.framing import HEAD_BOTTOM, HEAD_SIDE, HEAD_TOP, SAFE_RATIO, assess, head_box, is_guide_crop

S = 640
C = S / 2
R = SAFE_RATIO * S / 2            # rayon de la zone sûre


def face_for_head(cx, cy, head_h, aspect=0.66):
    """Boîte de VISAGE dont la tête estimée est l'ellipse (cx, cy, largeur = aspect × hauteur, head_h)."""
    head_w = aspect * head_h
    w = head_w / (1 + 2 * HEAD_SIDE)
    h = head_h / (1 + HEAD_TOP + HEAD_BOTTOM)
    return (cx - head_w / 2 + HEAD_SIDE * w, cy - head_h / 2 + HEAD_TOP * h, w, h)


def test_head_box_inverts_face_box():
    hx, hy, hw, hh = head_box(face_for_head(300, 280, 400))
    assert (round(hx + hw / 2), round(hy + hh / 2), round(hh), round(hw)) == (300, 280, 400, 264)


def test_perfectly_centered_head_is_accepted():
    assert assess(face_for_head(C, C, 1.3 * R), S, S).state == "OK"
    assert assess(face_for_head(C, C, 1.3 * R), S, S).instruction == "Position correcte — restez immobile"


@pytest.mark.parametrize("dx, dy, state, instruction", [
    (0, -0.45, "TOO_HIGH", "Descendez légèrement"),
    (0, 0.45, "TOO_LOW", "Montez légèrement"),
    # Image NON miroir, écran miroir : tête à droite dans l'image = à gauche pour la personne.
    (0.65, 0, "TOO_LEFT", "Déplacez-vous légèrement vers la droite"),
    (-0.65, 0, "TOO_RIGHT", "Déplacez-vous légèrement vers la gauche"),
])
def test_off_centre_head_gets_the_matching_instruction(dx, dy, state, instruction):
    result = assess(face_for_head(C + dx * R, C + dy * R, 1.3 * R), S, S)
    assert (result.state, result.instruction, result.ok) == (state, instruction, False)


def test_too_big_and_too_small():
    assert assess(face_for_head(C, C, 2.05 * R), S, S).state == "TOO_CLOSE"
    assert assess(face_for_head(C, C, 2.05 * R), S, S).instruction == "Reculez-vous"
    assert assess(face_for_head(C, C, 2 * R, aspect=1.05), S, S).state == "TOO_CLOSE"     # trop large
    assert assess(face_for_head(C, C, 0.9 * R), S, S).state == "TOO_FAR"
    assert assess(face_for_head(C, C, 0.9 * R), S, S).instruction == "Approchez-vous"
    assert assess(face_for_head(C, C, 1.02 * R), S, S).state == "OK"                       # juste au-dessus du seuil


def test_forehead_chin_or_side_outside_the_safe_zone_is_refused():
    head = 1.6 * R
    # Le centre reste DANS le cercle, mais un bord de la tête sort de la zone sûre.
    forehead_out = face_for_head(C, C - (R - head / 2) - 0.08 * R, head)
    chin_out = face_for_head(C, C + (R - head / 2) + 0.08 * R, head)
    left_out = face_for_head(C - (R - 0.33 * head) - 0.10 * R, C, head)
    right_out = face_for_head(C + (R - 0.33 * head) + 0.10 * R, C, head)
    for bbox, expected in ((forehead_out, "TOO_HIGH"), (chin_out, "TOO_LOW"), (left_out, "TOO_RIGHT"), (right_out, "TOO_LEFT")):
        x, y, w, h = bbox
        centre_x, centre_y = x + w / 2, y + h / 2
        assert (centre_x - C) ** 2 + (centre_y - C) ** 2 < R ** 2, "centre du visage dans le cercle"
        assert assess(bbox, S, S).state == expected


def test_centre_valid_but_head_box_invalid():
    """Un visage dont le CENTRE est au milieu mais dont la tête déborde n'est jamais accepté."""
    h, w = 1.2 * R, 0.8 * R
    bbox = (C - w / 2, C - h / 2, w, h)                            # visage exactement centré…
    hx, hy, hw, hh = head_box(bbox)
    assert hy < C - R                                              # …mais le haut de la tête sort de la zone sûre
    assert assess(bbox, S, S).state == "TOO_HIGH"


def test_face_box_cut_by_the_image_edge_is_refused():
    """Front coupé par le bord du carré : la boîte détectée commence à 0 ⇒ tête hors zone."""
    assert assess((C - 90, 0, 180, 240), S, S).state == "TOO_HIGH"
    assert assess((C - 90, S - 240, 180, 240), S, S).state == "TOO_LOW"


def test_only_the_guide_square_is_accepted():
    assert is_guide_crop(640, 640) and is_guide_crop(640, 638)
    assert not is_guide_crop(1280, 720) and not is_guide_crop(720, 1280) and not is_guide_crop(0, 0)


def test_every_state_has_an_instruction_without_score():
    for state, text in framing.INSTRUCTIONS.items():
        assert text and "%" not in text and "score" not in text.lower(), state
