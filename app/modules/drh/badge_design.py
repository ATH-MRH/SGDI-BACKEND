"""Studio Badges DRH — maquette d'un badge : modèle de référence, validation, QR.

Une maquette est un document JSON en millimètres, indépendant du support : le navigateur la
dessine en SVG (studio, aperçus) et le serveur en PDF (badge_pdf.py) à partir des mêmes
coordonnées. Les textes peuvent contenir des champs {{nom}}, {{matricule}}… remplis depuis la
fiche employé, et du gras local entre **doubles astérisques**.
"""
from __future__ import annotations

import base64
import binascii
import io
import json
import re
from typing import Any

CARD_WIDTH_MM = 54.0                # CR80 vertical
CARD_HEIGHT_MM = 86.0
YELLOW = "#FFCB05"
BLACK = "#111111"

FIELDS = {
    "societe": "Société", "nom": "Nom", "prenom": "Prénom", "nom_complet": "Nom et prénom",
    "matricule": "Matricule", "fonction": "Fonction", "site": "Site", "site_code": "Code du site",
    "statut": "Statut professionnel", "numero": "Numéro du badge", "date_emission": "Date d'émission",
    "validite": "Fin de validité",
}
FONTS = ("Helvetica", "Times", "Courier")
ELEMENT_TYPES = ("text", "photo", "qr", "image", "shape", "line")
SHAPES = ("rect", "ellipse", "triangle", "polygon", "path")
MAX_ELEMENTS = 150
MAX_PAGES = 2
MAX_IMAGE_BYTES = 600_000
MAX_DESIGN_BYTES = 3_000_000

_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_IMAGE_RE = re.compile(r"^data:image/(png|jpeg);base64,", re.IGNORECASE)
_FIELD_RE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")


class DesignError(ValueError):
    pass


def reference_design() -> dict[str, Any]:
    """Modèle IRON GLOBAL de référence : bandeau noir du site, photo bordée de jaune, nom,
    prénom, matricule, QR et bandeau jaune de la fonction."""
    deco = [[0, 0], [0.4, 0], [1, 0.5], [0.4, 1], [0, 1], [0.6, 0.5]]
    elements = [
        {"id": "deco1", "type": "shape", "name": "Décor 1", "shape": "polygon", "points": deco,
         "x": -2, "y": 17, "w": 16, "h": 30, "fill": "#DDE3EC", "opacity": 0.4},
        {"id": "deco2", "type": "shape", "name": "Décor 2", "shape": "polygon", "points": deco,
         "x": -2, "y": 40, "w": 13, "h": 26, "fill": "#DDE3EC", "opacity": 0.28},
        {"id": "bandeau_haut", "type": "shape", "name": "Bandeau noir", "shape": "polygon",
         "points": [[0, 0], [1, 0], [1, 0.25], [0.815, 1], [0, 1]],
         "x": 0, "y": 0, "w": 54, "h": 16.2, "fill": BLACK},
        {"id": "angle_jaune", "type": "shape", "name": "Angle jaune", "shape": "polygon",
         "points": [[1, 0], [1, 1], [0, 1]], "x": 45.3, "y": 6.5, "w": 8.7, "h": 9.7, "fill": YELLOW},
        {"id": "site", "type": "text", "name": "Site", "text": "SITE : {{site_code}}",
         "x": 3, "y": 4.6, "w": 42, "h": 6.5, "size": 12, "bold": True, "color": "#FFFFFF",
         "align": "center", "uppercase": True, "autoFit": True},
        {"id": "photo", "type": "photo", "name": "Photo", "x": 16.35, "y": 18, "w": 21.3, "h": 24.5,
         "stroke": YELLOW, "strokeWidth": 0.45, "radius": 0.9},
        {"id": "nom", "type": "text", "name": "Nom", "text": "{{nom}}",
         "x": 3, "y": 43.6, "w": 48, "h": 5, "size": 11.5, "bold": True, "color": BLACK,
         "align": "center", "uppercase": True, "autoFit": True},
        {"id": "prenom", "type": "text", "name": "Prénom", "text": "{{prenom}}",
         "x": 3, "y": 47.9, "w": 48, "h": 3.6, "size": 8, "bold": True, "color": "#222222",
         "align": "center", "uppercase": True, "autoFit": True},
        {"id": "filet", "type": "line", "name": "Filet jaune", "x": 12.2, "y": 51.6, "w": 29.6, "h": 1,
         "stroke": YELLOW, "strokeWidth": 0.25},
        {"id": "code", "type": "text", "name": "Matricule", "text": "CODE : **{{matricule}}**",
         "x": 3, "y": 53.2, "w": 48, "h": 4.2, "size": 9, "color": BLACK,
         "align": "center", "uppercase": True, "autoFit": True},
        {"id": "qr", "type": "qr", "name": "QR code", "x": 19.65, "y": 58.6, "w": 14.7, "h": 14.7, "color": BLACK},
        {"id": "bandeau_bas", "type": "shape", "name": "Bandeau jaune", "shape": "path",
         "path": [["M", 0, 0.5], ["C", 0, 0.44, 0.03, 0.403, 0.07, 0.403], ["L", 0.66, 0.403],
                  ["C", 0.8, 0.403, 0.88, 0.1, 1, 0], ["L", 1, 1], ["L", 0, 1], ["Z"]],
         "x": 0, "y": 66.4, "w": 54, "h": 19.6, "fill": YELLOW},
        {"id": "globe", "type": "shape", "name": "Décor globe", "shape": "ellipse",
         "x": 40, "y": 71, "w": 22, "h": 22, "fill": "#E9B500", "opacity": 0.45},
        {"id": "globe_arc", "type": "shape", "name": "Décor arc", "shape": "ellipse",
         "x": 45, "y": 69, "w": 20, "h": 28, "fill": "", "stroke": "#FFE066", "strokeWidth": 0.5, "opacity": 0.7},
        {"id": "fonction", "type": "text", "name": "Fonction", "text": "{{fonction}}",
         "x": 6, "y": 76.4, "w": 36, "h": 7.4, "size": 16, "bold": True, "color": BLACK,
         "align": "left", "uppercase": True, "autoFit": True},
    ]
    return sanitize_design({
        "width": CARD_WIDTH_MM, "height": CARD_HEIGHT_MM,
        "pages": [{"name": "Recto", "background": "#FFFFFF", "elements": elements}],
    })


def _number(value: Any, low: float, high: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number:                                    # NaN
        return default
    return round(min(high, max(low, number)), 3)


def _color(value: Any, default: str, *, allow_none: bool = False) -> str:
    text = str(value or "").strip()
    if allow_none and not text:
        return ""
    return text.upper() if _COLOR_RE.match(text) else default


def decode_image(src: Any) -> bytes:
    """Octets d'une image embarquée (PNG ou JPEG réel, vérifié par Pillow)."""
    text = str(src or "")
    if not _IMAGE_RE.match(text):
        raise DesignError("Image non prise en charge : PNG ou JPEG uniquement.")
    try:
        content = base64.b64decode(text.split(",", 1)[1], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise DesignError("Image illisible.") from exc
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise DesignError(f"Image trop lourde : {MAX_IMAGE_BYTES // 1000} Ko au maximum.")
    from PIL import Image

    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.format not in {"PNG", "JPEG"}:
                raise DesignError("Image non prise en charge : PNG ou JPEG uniquement.")
            image.verify()
    except DesignError:
        raise
    except Exception as exc:
        raise DesignError("Image illisible.") from exc
    return content


def _points(raw: Any) -> list[list[float]]:
    points = []
    for item in (raw if isinstance(raw, list) else [])[:60]:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            points.append([_number(item[0], -2, 3, 0), _number(item[1], -2, 3, 0)])
    return points


def _path(raw: Any) -> list[list[Any]]:
    arity = {"M": 2, "L": 2, "C": 6, "Z": 0}
    commands: list[list[Any]] = []
    for item in (raw if isinstance(raw, list) else [])[:80]:
        if not isinstance(item, (list, tuple)) or not item or item[0] not in arity or len(item) != arity[item[0]] + 1:
            continue
        commands.append([item[0], *(_number(value, -2, 3, 0) for value in item[1:])])
    return commands


def _element(raw: Any, index: int, used: set[str]) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or raw.get("type") not in ELEMENT_TYPES:
        return None
    kind = raw["type"]
    identifier = str(raw.get("id") or "")
    if not _ID_RE.match(identifier) or identifier in used:
        identifier = f"el{index + 1}"
        while identifier in used:
            identifier += "x"
    used.add(identifier)
    element: dict[str, Any] = {
        "id": identifier, "type": kind, "name": str(raw.get("name") or "")[:80],
        "x": _number(raw.get("x"), -500, 500, 0), "y": _number(raw.get("y"), -500, 500, 0),
        "w": _number(raw.get("w"), 0.2, 500, 10), "h": _number(raw.get("h"), 0.2, 500, 10),
        "rotation": _number(raw.get("rotation"), -360, 360, 0),
        "opacity": _number(raw.get("opacity", 1), 0, 1, 1),
        "locked": bool(raw.get("locked")), "hidden": bool(raw.get("hidden")),
    }
    if kind == "text":
        element.update(
            text=str(raw.get("text") or "")[:500],
            font=raw.get("font") if raw.get("font") in FONTS else "Helvetica",
            size=_number(raw.get("size"), 3, 160, 10),
            bold=bool(raw.get("bold")), italic=bool(raw.get("italic")),
            color=_color(raw.get("color"), BLACK),
            align=raw.get("align") if raw.get("align") in ("left", "center", "right") else "left",
            uppercase=bool(raw.get("uppercase")), autoFit=bool(raw.get("autoFit")), wrap=bool(raw.get("wrap")),
        )
    elif kind == "shape":
        shape = raw.get("shape") if raw.get("shape") in SHAPES else "rect"
        element.update(
            shape=shape, fill=_color(raw.get("fill"), "#D1D5DB", allow_none="fill" in raw),
            stroke=_color(raw.get("stroke"), "", allow_none=True),
            strokeWidth=_number(raw.get("strokeWidth"), 0, 10, 0),
            radius=_number(raw.get("radius"), 0, 100, 0),
        )
        if shape == "polygon":
            element["points"] = _points(raw.get("points"))
            if len(element["points"]) < 3:
                element["shape"] = "rect"
                element.pop("points")
        elif shape == "path":
            element["path"] = _path(raw.get("path"))
            if len(element["path"]) < 2:
                element["shape"] = "rect"
                element.pop("path")
    elif kind == "line":
        element.update(stroke=_color(raw.get("stroke"), BLACK), strokeWidth=_number(raw.get("strokeWidth"), 0.05, 10, 0.3),
                       dash=bool(raw.get("dash")))
    elif kind == "photo":
        element.update(stroke=_color(raw.get("stroke"), "", allow_none=True),
                       strokeWidth=_number(raw.get("strokeWidth"), 0, 10, 0), radius=_number(raw.get("radius"), 0, 100, 0))
    elif kind == "image":
        decode_image(raw.get("src"))
        element.update(src=str(raw["src"]), fit=raw.get("fit") if raw.get("fit") in ("contain", "cover", "stretch") else "contain",
                       radius=_number(raw.get("radius"), 0, 100, 0))
    elif kind == "qr":
        element.update(color=_color(raw.get("color"), BLACK), background=_color(raw.get("background"), "", allow_none=True))
    return element


def sanitize_design(raw: Any) -> dict[str, Any]:
    """Maquette normalisée : seules les propriétés connues sont conservées, bornées et typées.
    Tout ce qui est enregistré ou imprimé passe par ici."""
    if not isinstance(raw, dict):
        raise DesignError("Maquette invalide.")
    pages_raw = raw.get("pages")
    if not isinstance(pages_raw, list) or not pages_raw:
        raise DesignError("La maquette doit contenir au moins une face.")
    pages = []
    for page_index, page in enumerate(pages_raw[:MAX_PAGES]):
        if not isinstance(page, dict):
            raise DesignError("Face de badge invalide.")
        items = page.get("elements") if isinstance(page.get("elements"), list) else []
        if len(items) > MAX_ELEMENTS:
            raise DesignError(f"Trop d'éléments sur une face : {MAX_ELEMENTS} au maximum.")
        used: set[str] = set()
        elements = [element for index, item in enumerate(items) if (element := _element(item, index, used))]
        pages.append({
            "name": str(page.get("name") or ("Recto" if page_index == 0 else "Verso"))[:40],
            "background": _color(page.get("background"), "#FFFFFF"),
            "elements": elements,
        })
    design = {
        "width": _number(raw.get("width"), 20, 300, CARD_WIDTH_MM),
        "height": _number(raw.get("height"), 20, 300, CARD_HEIGHT_MM),
        "pages": pages,
    }
    if len(json.dumps(design)) > MAX_DESIGN_BYTES:
        raise DesignError("Maquette trop lourde : réduisez le nombre ou le poids des images.")
    return design


def split_runs(text: str, bold: bool) -> list[tuple[str, bool]]:
    """Découpe « CODE : **K26** » en segments (texte, gras). Les champs sont remplis APRÈS ce
    découpage : une valeur de fiche contenant des astérisques ne change jamais la mise en forme."""
    parts = str(text or "").split("**")
    return [(part, bold or index % 2 == 1) for index, part in enumerate(parts) if part]


def fill_fields(text: str, values: dict[str, Any], *, uppercase: bool = False) -> str:
    result = _FIELD_RE.sub(lambda match: str(values.get(match.group(1)) or "—") if match.group(1) in FIELDS else match.group(0), text)
    result = re.sub(r"[ \t]+", " ", result)
    return result.upper() if uppercase else result


def qr_matrix(data: str) -> list[str]:
    """Matrice du QR (une chaîne de 0/1 par ligne), générée localement : l'adresse signée du
    badge n'est jamais envoyée à un service tiers."""
    from reportlab.graphics.barcode import qrencoder

    code = qrencoder.QRCode(None, qrencoder.QRErrorCorrectLevel.M)
    code.addData(str(data or ""))
    code.make()
    size = code.getModuleCount()
    return ["".join("1" if code.isDark(row, column) else "0" for column in range(size)) for row in range(size)]


def cover_box(image_w: float, image_h: float, frame_w: float, frame_h: float, crop: dict[str, Any] | None) -> tuple[float, float, float, float]:
    """Position (x, y, largeur, hauteur) d'une image qui REMPLIT son cadre, avec le zoom et le
    décalage choisis à l'émission. Même calcul côté navigateur (badgeCoverBox)."""
    crop = crop if isinstance(crop, dict) else {}
    zoom = _number(crop.get("zoom"), 1, 4, 1)
    dx = _number(crop.get("dx"), -0.5, 0.5, 0)
    dy = _number(crop.get("dy"), -0.5, 0.5, 0)
    scale = max(frame_w / image_w, frame_h / image_h) * zoom
    width, height = image_w * scale, image_h * scale
    return (frame_w - width) * (0.5 + dx), (frame_h - height) * (0.5 + dy), width, height


def clean_crop(raw: Any) -> dict[str, float]:
    raw = raw if isinstance(raw, dict) else {}
    return {"zoom": _number(raw.get("zoom"), 1, 4, 1), "dx": _number(raw.get("dx"), -0.5, 0.5, 0), "dy": _number(raw.get("dy"), -0.5, 0.5, 0)}


def qr_svg(data: str, *, color: str = "#000000") -> str:
    """QR en SVG autonome (pages publiques, écran historique) — toujours généré ici."""
    rows = qr_matrix(data)
    size = len(rows)
    path = "".join(f"M{column} {row}h1v1h-1z" for row, line in enumerate(rows) for column, bit in enumerate(line) if bit == "1")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 {size + 4} {size + 4}" width="100%" height="100%" '
            f'shape-rendering="crispEdges" role="img" aria-label="QR"><rect x="-2" y="-2" width="{size + 4}" height="{size + 4}" fill="#FFFFFF"/>'
            f'<path d="{path}" fill="{color}"/></svg>')


def unprintable(text: Any) -> str:
    """Caractères qu'aucune police du badge ne sait dessiner. Le latin accentué (polices
    standard) et l'arabe (police embarquée, voir badge_text) sont imprimables."""
    from app.modules.drh import badge_text

    return badge_text.unsupported(str(text or ""))


def _luminance(color: str) -> float:
    channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4 for value in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


QR_MIN_MM = 12.0
QR_MIN_CONTRAST = 4.0


def design_warnings(design: dict[str, Any]) -> list[str]:
    """Contrôles d'une maquette avant impression : QR lisible (taille, contraste, forme
    carrée, entièrement sur la carte), textes imprimables, photo présente."""
    warnings: list[str] = []
    width, height = design["width"], design["height"]
    kinds: set[str] = set()
    for page in design["pages"]:
        for element in page["elements"]:
            if element.get("hidden"):
                continue
            kinds.add(element["type"])
            label = element.get("name") or element["id"]
            if element["type"] == "qr":
                if min(element["w"], element["h"]) < QR_MIN_MM:
                    warnings.append(f"QR « {label} » : {min(element['w'], element['h']):g} mm de côté, {QR_MIN_MM:g} mm au minimum pour une lecture fiable.")
                if abs(element["w"] - element["h"]) > 0.5:
                    warnings.append(f"QR « {label} » : le cadre doit être carré.")
                if element["x"] < 0 or element["y"] < 0 or element["x"] + element["w"] > width or element["y"] + element["h"] > height:
                    warnings.append(f"QR « {label} » : il dépasse de la carte.")
                if element.get("opacity", 1) < 1:
                    warnings.append(f"QR « {label} » : il doit rester opaque.")
                light, dark = _luminance(element.get("background") or page["background"]), _luminance(element["color"])
                if dark > light or (light + 0.05) / (dark + 0.05) < QR_MIN_CONTRAST:
                    warnings.append(f"QR « {label} » : contraste insuffisant, utilisez un QR sombre sur fond clair.")
            elif element["type"] == "text":
                bad = unprintable(_FIELD_RE.sub("", element["text"]))
                if bad:
                    warnings.append(f"Texte « {label} » : caractères non imprimables ({bad[:12]}).")
    if "qr" not in kinds:
        warnings.append("Aucun QR code : le badge ne pourra pas être vérifié par scan.")
    if "photo" not in kinds:
        warnings.append("Aucune photo sur le badge.")
    return warnings
