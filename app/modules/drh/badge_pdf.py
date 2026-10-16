"""Studio Badges DRH — rendu PDF d'impression (ReportLab).

Le PDF ne contient que le badge lui-même : le porte-badge et le cordon de l'aperçu réaliste
sont un habillage d'écran, jamais imprimés. Deux sorties : une page par face au format exact de
la carte (imprimante à cartes), ou une planche A4 avec traits de coupe.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Any

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as pdf_canvas

from app.modules.drh import badge_text
from app.modules.drh.badge_design import cover_box, decode_image, fill_fields, split_runs

PT_TO_MM = 25.4 / 72
_FONT_NAMES = {
    "Helvetica": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"),
    "Times": ("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"),
    "Courier": ("Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"),
}


@dataclass
class BadgeItem:
    design: dict[str, Any]
    values: dict[str, Any]
    photo: bytes | None = None
    crop: dict[str, Any] | None = None
    qr: list[str] = field(default_factory=list)


def _font(element: dict[str, Any], bold: bool) -> str:
    names = _FONT_NAMES.get(element.get("font"), _FONT_NAMES["Helvetica"])
    return names[(1 if bold else 0) + (2 if element.get("italic") else 0)]


def _prepared(element: dict[str, Any], text: str, bold: bool) -> tuple[str, str]:
    """(texte à dessiner, police) : un texte hors latin passe par la police embarquée, lettres
    liées et ordre d'affichage calculés (arabe de droite à gauche, latin de gauche à droite)."""
    unicode_font = badge_text.font_for(text, bold)
    if unicode_font is None:
        return text, _font(element, bold)
    return badge_text.visual(text), unicode_font


def _rounded(c, x: float, y: float, w: float, h: float, radius: float):
    path = c.beginPath()
    radius = max(0.0, min(radius, w / 2, h / 2))
    if radius:
        path.roundRect(x, y, w, h, radius)
    else:
        path.rect(x, y, w, h)
    return path


def _paint(c, path, element: dict[str, Any], *, fill_key: str = "fill") -> None:
    fill, stroke = element.get(fill_key), element.get("stroke")
    width = float(element.get("strokeWidth") or 0) * mm
    if fill:
        c.setFillColor(HexColor(fill))
    if stroke and width:
        c.setStrokeColor(HexColor(stroke))
        c.setLineWidth(width)
    if fill or (stroke and width):
        c.drawPath(path, stroke=1 if stroke and width else 0, fill=1 if fill else 0)


def _draw_text(c, element: dict[str, Any], w: float, h: float, values: dict[str, Any]) -> None:
    size = float(element["size"])
    c.setFillColor(HexColor(element["color"]))
    upper = element.get("uppercase")
    if element.get("wrap"):
        bold = bool(element.get("bold"))
        text = fill_fields(element["text"].replace("**", ""), values, uppercase=upper)
        lines: list[tuple[str, str]] = []
        for paragraph in text.split("\n"):
            current = ""
            for word in paragraph.split():                  # coupure sur le texte logique, mise en forme par ligne
                trial = f"{current} {word}".strip()
                shown, font = _prepared(element, trial, bold)
                if current and stringWidth(shown, font, size) > w:
                    lines.append(_prepared(element, current, bold))
                    current = word
                else:
                    current = trial
            lines.append(_prepared(element, current, bold))
        leading = size * 1.2
        top = len(lines) * leading / 2
        for index, (line, font) in enumerate(lines):
            c.setFont(font, size)
            width = stringWidth(line, font, size)
            x = {"center": -width / 2, "right": w / 2 - width}.get(element["align"], -w / 2)
            c.drawString(x, top - index * leading - leading / 2 - size * 0.35, line)
        return
    runs = [_prepared(element, fill_fields(text, values, uppercase=upper), bold) for text, bold in split_runs(element["text"], bool(element.get("bold")))]
    total = sum(stringWidth(text, font, size) for text, font in runs)
    if element.get("autoFit") and total > w > 0:
        size = max(3.0, size * w / total)
        total = sum(stringWidth(text, font, size) for text, font in runs)
    x = {"center": -total / 2, "right": w / 2 - total}.get(element["align"], -w / 2)
    for text, font in runs:
        c.setFont(font, size)
        c.drawString(x, -size * 0.35, text)
        x += stringWidth(text, font, size)


def _draw_shape(c, element: dict[str, Any], w: float, h: float) -> None:
    def local(nx: float, ny: float) -> tuple[float, float]:
        return -w / 2 + nx * w, h / 2 - ny * h

    shape = element["shape"]
    path = c.beginPath()
    if shape == "rect":
        path = _rounded(c, -w / 2, -h / 2, w, h, float(element.get("radius") or 0) * mm)
    elif shape == "ellipse":
        path.ellipse(-w / 2, -h / 2, w, h)
    elif shape in ("triangle", "polygon"):
        points = element.get("points") if shape == "polygon" else [[0.5, 0], [1, 1], [0, 1]]
        path.moveTo(*local(*points[0]))
        for point in points[1:]:
            path.lineTo(*local(*point))
        path.close()
    else:
        for command in element["path"]:
            if command[0] == "M":
                path.moveTo(*local(command[1], command[2]))
            elif command[0] == "L":
                path.lineTo(*local(command[1], command[2]))
            elif command[0] == "C":
                path.curveTo(*local(command[1], command[2]), *local(command[3], command[4]), *local(command[5], command[6]))
            else:
                path.close()
    _paint(c, path, element)


def _draw_picture(c, content: bytes, w: float, h: float, radius: float, *, fit: str = "cover", crop: dict[str, Any] | None = None) -> None:
    image = ImageReader(io.BytesIO(content))
    image_w, image_h = image.getSize()
    c.saveState()
    c.clipPath(_rounded(c, -w / 2, -h / 2, w, h, radius), stroke=0, fill=0)
    if fit == "stretch":
        box = (0.0, 0.0, w, h)
    elif fit == "contain":
        scale = min(w / image_w, h / image_h)
        box = ((w - image_w * scale) / 2, (h - image_h * scale) / 2, image_w * scale, image_h * scale)
    else:
        box = cover_box(image_w, image_h, w, h, crop)
    # box est exprimé depuis le coin haut-gauche du cadre ; le PDF a son origine en bas.
    c.drawImage(image, -w / 2 + box[0], h / 2 - box[1] - box[3], box[2], box[3], mask="auto")
    c.restoreState()


def _fit(text: str, font: str, size: float, width: float) -> float:
    natural = stringWidth(text, font, size)
    return max(2.0, size * width / natural) if natural > width > 0 else size


def _draw_blood(c, element: dict[str, Any], w: float, h: float, value: str) -> None:
    """Groupe sanguin : cadre (fond, bordure), légende discrète en haut, valeur en grand. Le
    même police embarquée dessine les huit groupes (et le signe moins typographique)."""
    radius = float(element.get("radius") or 0) * mm
    _paint(c, _rounded(c, -w / 2, -h / 2, w, h, radius), {**element, "fill": element.get("background") or ""})
    if badge_text.font_for("\u2212", True):            # police embarquée disponible (cas normal)
        bold = badge_text.UNICODE_FONT_BOLD
    else:                                                # repli : polices standard, moins ASCII
        bold, value = "Helvetica-Bold", value.replace("\u2212", "-")
    pad = min(w, h) * 0.08
    caption = str(element.get("caption") or "").strip()
    c.setFillColor(HexColor(element["color"]))
    top = h / 2 - pad
    if caption:
        caption_font = badge_text.font_for(caption, True) or "Helvetica-Bold"
        shown = caption if caption_font == "Helvetica-Bold" else badge_text.visual(caption)
        csize = _fit(shown, caption_font, float(element.get("captionSize") or 4.6), w - 2 * pad)
        c.setFont(caption_font, csize)
        c.drawCentredString(0, top - csize * 0.8, shown)
        top -= csize * 1.15
    size = float(element["size"])
    size = min(_fit(value, bold, size, w - 2 * pad), (top + h / 2 - pad) / 0.75)
    c.setFont(bold, size)
    width = stringWidth(value, bold, size)
    x = {"left": -w / 2 + pad, "right": w / 2 - pad - width}.get(element.get("align"), -width / 2)
    c.drawString(x, (top + (-h / 2 + pad)) / 2 - size * 0.36, value)


def _draw_element(c, element: dict[str, Any], item: BadgeItem) -> None:
    w, h = element["w"] * mm, element["h"] * mm
    kind = element["type"]
    if kind == "text":
        _draw_text(c, element, w, h, item.values)
    elif kind == "shape":
        _draw_shape(c, element, w, h)
    elif kind == "line":
        c.setStrokeColor(HexColor(element["stroke"]))
        c.setLineWidth(element["strokeWidth"] * mm)
        if element.get("dash"):
            c.setDash(element["strokeWidth"] * mm * 3, element["strokeWidth"] * mm * 2)
        c.line(-w / 2, 0, w / 2, 0)
    elif kind == "photo":
        radius = float(element.get("radius") or 0) * mm
        if item.photo:
            _draw_picture(c, item.photo, w, h, radius, crop=item.crop)
        else:
            c.setFillColor(HexColor("#E5E7EB"))
            c.drawPath(_rounded(c, -w / 2, -h / 2, w, h, radius), stroke=0, fill=1)
            c.setFillColor(HexColor("#6B7280"))
            c.setFont("Helvetica-Bold", 7)
            c.drawCentredString(0, -2.5, "PHOTO")
        _paint(c, _rounded(c, -w / 2, -h / 2, w, h, radius), {**element, "fill": ""})
    elif kind == "image":
        _draw_picture(c, decode_image(element["src"]), w, h, float(element.get("radius") or 0) * mm, fit=element["fit"])
    elif kind == "blood":
        value = str(item.values.get("groupe_sanguin") or "")
        if value:                                          # absent ou non autorisé : rien n'est dessiné
            _draw_blood(c, element, w, h, value)
    elif kind == "qr":
        if element.get("background"):
            c.setFillColor(HexColor(element["background"]))
            c.rect(-w / 2, -h / 2, w, h, stroke=0, fill=1)
        size = len(item.qr)
        if size:
            cell_w, cell_h = w / size, h / size
            c.setFillColor(HexColor(element["color"]))
            path = c.beginPath()
            for row, line in enumerate(item.qr):
                for column, bit in enumerate(line):
                    if bit == "1":
                        path.rect(-w / 2 + column * cell_w, h / 2 - (row + 1) * cell_h, cell_w, cell_h)
            c.drawPath(path, stroke=0, fill=1)


def draw_face(c, item: BadgeItem, page_index: int, left: float, top: float) -> None:
    """Dessine une face du badge, coin haut-gauche placé en (left, top) points PDF."""
    design = item.design
    width, height = design["width"] * mm, design["height"] * mm
    page = design["pages"][page_index]
    c.saveState()
    clip = c.beginPath()
    clip.rect(left, top - height, width, height)
    c.clipPath(clip, stroke=0, fill=0)
    c.setFillColor(HexColor(page["background"]))
    c.rect(left, top - height, width, height, stroke=0, fill=1)
    for element in page["elements"]:
        if element.get("hidden"):
            continue
        c.saveState()
        c.translate(left + (element["x"] + element["w"] / 2) * mm, top - (element["y"] + element["h"] / 2) * mm)
        if element.get("rotation"):
            c.rotate(-element["rotation"])
        opacity = element.get("opacity", 1)
        if opacity < 1:
            c.setFillAlpha(opacity)
            c.setStrokeAlpha(opacity)
        _draw_element(c, element, item)
        c.restoreState()
    c.restoreState()


def _crop_marks(c, left: float, top: float, width: float, height: float) -> None:
    gap, length = 1 * mm, 3 * mm
    c.saveState()
    c.setStrokeColor(HexColor("#000000"))
    c.setLineWidth(0.25)
    for x in (left, left + width):
        direction = -1 if x == left else 1
        for y in (top, top - height):
            vertical = 1 if y == top else -1
            c.line(x + direction * gap, y, x + direction * (gap + length), y)
            c.line(x, y + vertical * gap, x, y + vertical * (gap + length))
    c.restoreState()


def render_cards(items: list[BadgeItem], *, title: str = "Badges") -> bytes:
    """Une page par face, au format exact de la carte."""
    buffer = io.BytesIO()
    c = pdf_canvas.Canvas(buffer, pageCompression=1)
    c.setViewerPreference("PrintScaling", "None")      # taille réelle : jamais « ajuster à la page »
    c.setTitle(title)
    c.setAuthor("IRON GLOBAL — Studio Badges DRH")
    for item in items:
        width, height = item.design["width"] * mm, item.design["height"] * mm
        for page_index in range(len(item.design["pages"])):
            c.setPageSize((width, height))
            draw_face(c, item, page_index, 0, height)
            c.showPage()
    c.save()
    return buffer.getvalue()


def render_sheets(items: list[BadgeItem], *, margin_mm: float = 10, gap_mm: float = 4, crop_marks: bool = True, title: str = "Badges") -> bytes:
    """Planches A4. Les versos suivent chaque planche de rectos, colonnes inversées, pour une
    impression recto verso retournée sur le bord long."""
    buffer = io.BytesIO()
    c = pdf_canvas.Canvas(buffer, pagesize=A4, pageCompression=1)
    c.setViewerPreference("PrintScaling", "None")
    c.setTitle(title)
    c.setAuthor("IRON GLOBAL — Studio Badges DRH")
    page_w, page_h = A4
    index = 0
    while index < len(items):
        width, height = items[index].design["width"] * mm, items[index].design["height"] * mm
        columns = max(1, int((page_w - 2 * margin_mm * mm + gap_mm * mm) // (width + gap_mm * mm)))
        rows = max(1, int((page_h - 2 * margin_mm * mm + gap_mm * mm) // (height + gap_mm * mm)))
        card_format = (items[index].design["width"], items[index].design["height"])
        sheet = [items[index]]
        index += 1
        # Une planche ne mélange pas deux formats de carte.
        while (index < len(items) and len(sheet) < columns * rows
               and (items[index].design["width"], items[index].design["height"]) == card_format):
            sheet.append(items[index])
            index += 1
        used_w = columns * width + (columns - 1) * gap_mm * mm
        origin_x = (page_w - used_w) / 2
        origin_top = page_h - margin_mm * mm
        for face in range(max(len(item.design["pages"]) for item in sheet)):
            for position, item in enumerate(sheet):
                if face >= len(item.design["pages"]):
                    continue
                row, column = divmod(position, columns)
                if face % 2 == 1:
                    column = columns - 1 - column
                left = origin_x + column * (width + gap_mm * mm)
                top = origin_top - row * (height + gap_mm * mm)
                draw_face(c, item, face, left, top)
                if crop_marks:
                    _crop_marks(c, left, top, width, height)
            c.showPage()
    c.save()
    return buffer.getvalue()
