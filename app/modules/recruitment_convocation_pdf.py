"""IRON Emploi — PDF A4 de la convocation à un entretien.

Texte réel (sélectionnable), polices embarquées : Helvetica pour le latin, DejaVu Sans (déjà livrée pour les
badges) pour tout autre alphabet, mis en forme sans service externe. Le QR est dessiné module par module, net à
toute taille d'impression. Rien n'est inventé : sans logo réel de la société, aucun logo ; ni signature, ni cachet.
"""
from __future__ import annotations

from datetime import datetime
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import Flowable, Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.modules.drh import badge_text

STATIC_DIR = Path(__file__).resolve().parents[1] / 'static'
NAVY, MUTED, LINE = colors.HexColor('#14243B'), colors.HexColor('#5B6676'), colors.HexColor('#D9DEE6')
DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

BODY = ParagraphStyle('body', fontName='Helvetica', fontSize=10.5, leading=14.5, textColor=NAVY, alignment=TA_LEFT)
SMALL = ParagraphStyle('small', parent=BODY, fontSize=9, leading=12.5, textColor=MUTED)
LABEL = ParagraphStyle('label', parent=BODY, fontName='Helvetica-Bold', fontSize=9.5, leading=13, textColor=MUTED)
TITLE = ParagraphStyle('title', parent=BODY, fontName='Helvetica-Bold', fontSize=20, leading=25)
SOCIETY = ParagraphStyle('society', parent=BODY, fontName='Helvetica-Bold', fontSize=13, leading=17)
STRONG = ParagraphStyle('strong', parent=BODY, fontName='Helvetica-Bold', fontSize=12, leading=16)


def long_date(value: datetime) -> str:
    return f'{DAYS[value.weekday()]} {value.day} {MONTHS[value.month - 1]} {value.year}'


def _text(value: str, *, bold: bool = False) -> str:
    """Texte prêt pour un paragraphe : échappé, et dans la police embarquée s'il sort du latin."""
    value = str(value or '')
    font = badge_text.font_for(value, bold)
    if font is None:
        return escape(value)
    return f'<font name="{font}">{escape(badge_text.visual(value))}</font>'


def _lines(value: str) -> str:
    return '<br/>'.join(_text(line) for line in str(value or '').splitlines() if line.strip())


class QrCode(Flowable):
    def __init__(self, matrix: list[str], size: float):
        super().__init__()
        self.matrix, self.size = matrix, size
        self.width = self.height = size

    def draw(self):
        count = len(self.matrix)
        cell = self.size / (count + 8)                    # zone blanche de 4 modules autour du code
        c = self.canv
        c.setFillColor(colors.white)
        c.rect(0, 0, self.size, self.size, stroke=0, fill=1)
        c.setFillColor(colors.black)
        for row, line in enumerate(self.matrix):
            for column, bit in enumerate(line):
                if bit == '1':
                    c.rect((column + 4) * cell, self.size - (row + 5) * cell, cell, cell, stroke=0, fill=1)


class _Numbered(pdf_canvas.Canvas):
    """Pied de page « page x / y » : le total n'est connu qu'à la fin, d'où les pages mises de côté."""
    footer = ''

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._pages = []

    def showPage(self):
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._pages)
        for state in self._pages:
            self.__dict__.update(state)
            self.setFont('Helvetica', 8.5)
            self.setFillColor(MUTED)
            self.drawString(18 * mm, 11 * mm, self.footer)
            self.drawRightString(A4[0] - 18 * mm, 11 * mm, f'Page {self._pageNumber} / {total}')
            super().showPage()
        super().save()


def render(content: dict, *, version: int, issued_at: datetime | None, qr: list[str] | None, draft: bool = False) -> bytes:
    """PDF d'une version de convocation. `qr` absent (brouillon) : un cadre explique que le QR naît à l'envoi."""
    starts_at = datetime.fromisoformat(content['starts_at'])
    reference = content['reference'] + (f' · version {version}' if version else '')
    story = []

    head = []
    logo = content.get('logo_path')
    if logo:
        path = STATIC_DIR / Path(logo).name
        if path.is_file():
            image = Image(str(path))
            ratio = image.imageHeight / float(image.imageWidth or 1)
            image.drawWidth, image.drawHeight = 34 * mm, 34 * mm * ratio
            if image.drawHeight > 22 * mm:
                image.drawHeight, image.drawWidth = 22 * mm, 22 * mm / ratio
            head.append(image)
    society = Paragraph(_text(content.get('society') or 'Service recrutement', bold=True), SOCIETY)
    story.append(Table([[head[0] if head else '', society]], colWidths=[40 * mm, None],
                       style=TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 0)])))
    story += [Spacer(1, 6 * mm), Paragraph('Convocation à un entretien', TITLE), Spacer(1, 2 * mm),
              Paragraph(f'Référence <b>{escape(reference)}</b>', BODY),
              Paragraph(f'Émise le {issued_at.strftime("%d/%m/%Y") if issued_at else "—"}'
                        + (' · <b>BROUILLON — non envoyée au candidat</b>' if draft else ''), SMALL),
              Spacer(1, 6 * mm)]

    name = f"{content['candidate']['last_name'].upper()} {content['candidate']['first_name']}".strip()
    story += [Paragraph('À l’attention de', LABEL), Paragraph(_text(name, bold=True), STRONG), Spacer(1, 4 * mm)]

    rows = [('Candidature', content.get('application_reference')), ('Dossier', content.get('dossier_reference'))]
    if content.get('offer'):
        offer = content['offer']
        rows.append(('Annonce', offer['title'] + (f" (réf. {offer['reference']})" if offer.get('reference') else '')))
    rows += [('Poste', content.get('position')), ('Objet', content.get('purpose')),
             ('Date', long_date(starts_at)), ('Heure', f'{starts_at:%H h %M} — heure d’Alger ({content.get("timezone", "Africa/Algiers")}, UTC+1)'),
             ('Lieu', content.get('location')), ('Adresse', content.get('address')),
             ('Interlocuteur', content.get('contact')), ('Coordonnées', content.get('contact_details'))]
    facts = [[Paragraph(label, LABEL), Paragraph(_lines(value), BODY)] for label, value in rows if value]
    info = Table(facts, colWidths=[32 * mm, 86 * mm], style=TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LINEBELOW', (0, 0), (-1, -2), 0.4, LINE)]))
    if qr:
        code = [QrCode(qr, 52 * mm), Spacer(1, 2 * mm), Paragraph(f'<b>{escape(reference)}</b>', SMALL)]
    else:
        code = [Table([[Paragraph('Le QR code est créé à l’envoi de la convocation.', SMALL)]], colWidths=[52 * mm], rowHeights=[52 * mm],
                      style=TableStyle([('BOX', (0, 0), (-1, -1), 0.8, LINE), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE')]))]
    story.append(Table([[info, code]], colWidths=[122 * mm, None],
                       style=TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0)])))
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph('<b>Présentez cette convocation à votre arrivée.</b>', STRONG))
    story.append(Paragraph('Sur papier ou sur l’écran de votre téléphone. Le QR code permet au recruteur d’ouvrir votre convocation ; '
                           'il ne contient aucune information personnelle lisible.', SMALL))
    for label, value in (('Pièces à apporter', content.get('documents_to_bring')), ('Consignes', content.get('instructions'))):
        if value:
            story.append(KeepTogether([Spacer(1, 5 * mm), Paragraph(label, LABEL), Paragraph(_lines(value), BODY)]))
    story += [Spacer(1, 6 * mm), Paragraph('En cas de report ou d’annulation, une nouvelle version est envoyée dans l’application ; '
                                           'seule la dernière version est valable le jour de l’entretien.', SMALL)]

    buffer = BytesIO()
    canvas_class = type('ConvocationCanvas', (_Numbered,), {'footer': f'{content["reference"]} · convocation transmise via l’application IRON Emploi'})
    document = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm,
                                 title=f'Convocation {reference}', author=content.get('society') or 'Service recrutement',
                                 subject='Convocation à un entretien')
    document.build(story, canvasmaker=canvas_class)
    return buffer.getvalue()
