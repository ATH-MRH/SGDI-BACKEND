"""Référentiels et catalogue des champs de l'import Excel de candidats.

Le catalogue reprend exactement les champs de la fiche candidat de recrute.irongs.com
(formulaire « Fiche de renseignement candidat ») : aucun champ n'est inventé pour une colonne
Excel. Les listes de valeurs sont celles des listes déroulantes du formulaire."""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field as dc_field
from functools import lru_cache
from pathlib import Path

STATIC_DIR = Path(__file__).resolve().parents[2] / "static"

# Même liste que RECRUTE_WILAYAS (app/static/recrute.html) — parité vérifiée par les tests.
WILAYAS: tuple[tuple[str, str], ...] = (
    ("01", "Adrar"), ("02", "Chlef"), ("03", "Laghouat"), ("04", "Oum El Bouaghi"), ("05", "Batna"),
    ("06", "Béjaïa"), ("07", "Biskra"), ("08", "Béchar"), ("09", "Blida"), ("10", "Bouira"),
    ("11", "Tamanrasset"), ("12", "Tébessa"), ("13", "Tlemcen"), ("14", "Tiaret"), ("15", "Tizi Ouzou"),
    ("16", "Alger"), ("17", "Djelfa"), ("18", "Jijel"), ("19", "Sétif"), ("20", "Saïda"),
    ("21", "Skikda"), ("22", "Sidi Bel Abbès"), ("23", "Annaba"), ("24", "Guelma"), ("25", "Constantine"),
    ("26", "Médéa"), ("27", "Mostaganem"), ("28", "M'Sila"), ("29", "Mascara"), ("30", "Ouargla"),
    ("31", "Oran"), ("32", "El Bayadh"), ("33", "Illizi"), ("34", "Bordj Bou Arreridj"), ("35", "Boumerdès"),
    ("36", "El Tarf"), ("37", "Tindouf"), ("38", "Tissemsilt"), ("39", "El Oued"), ("40", "Khenchela"),
    ("41", "Souk Ahras"), ("42", "Tipaza"), ("43", "Mila"), ("44", "Aïn Defla"), ("45", "Naâma"),
    ("46", "Aïn Témouchent"), ("47", "Ghardaïa"), ("48", "Relizane"), ("49", "Timimoun"),
    ("50", "Bordj Badji Mokhtar"), ("51", "Ouled Djellal"), ("52", "Béni Abbès"), ("53", "In Salah"),
    ("54", "In Guezzam"), ("55", "Touggourt"), ("56", "Djanet"), ("57", "El M'Ghair"), ("58", "El Meniaa"),
)

_ARABIC_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه", "ـ": ""})


def norm_key(value: object) -> str:
    """Clé de comparaison : sans accents ni diacritiques, minuscules, ponctuation ignorée.
    Les lettres arabes sont conservées (variantes d'alef, ta marbuta et tatweel unifiées)."""
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn").translate(_ARABIC_FOLD).lower()
    return " ".join("".join(ch if ch.isalnum() else " " for ch in text).split())


@lru_cache(maxsize=1)
def communes_by_wilaya_code() -> dict[str, list[str]]:
    """Communes servies au formulaire (app/static/algeria-communes.js) : source unique."""
    raw = (STATIC_DIR / "algeria-communes.js").read_text(encoding="utf-8")
    match = re.search(r"ALGERIA_COMMUNES_BY_WILAYA_CODE\s*=\s*(\{.*\})\s*;?\s*$", raw.strip(), re.S)
    return json.loads(match.group(1)) if match else {}


def resolve_wilaya(value: str) -> tuple[str, str] | None:
    """Accepte « Alger », « 16 », « 16 - Alger » ; renvoie (code, libellé du formulaire)."""
    text = str(value or "").strip()
    code_match = re.match(r"^(\d{1,2})(?:\s*[-–:.]?\s*(.*))?$", text)
    by_code = dict(WILAYAS)
    by_name = {norm_key(name): (code, name) for code, name in WILAYAS}
    if code_match:
        code = code_match.group(1).zfill(2)
        rest = (code_match.group(2) or "").strip()
        if code not in by_code:
            return None
        if rest and by_name.get(norm_key(rest), (None,))[0] != code:
            return None                      # code et libellé contradictoires : pas de devinette
        return code, by_code[code]
    return by_name.get(norm_key(text))


def resolve_commune(value: str, wilaya_code: str | None) -> str | None:
    wanted = norm_key(value)
    if not wanted:
        return None
    communes = communes_by_wilaya_code()
    codes = [wilaya_code] if wilaya_code else sorted(communes)
    for code in codes:
        for name in communes.get(code or "", []):
            if norm_key(name) == wanted:
                return name
    return None


@dataclass(frozen=True)
class ImportField:
    key: str
    label: str
    kind: str                       # name | text | date | choice | phone | email | int | money | nin | digits | wilaya | commune | position | list
    column: str | None = None       # colonne SQL de Candidate
    data_key: str | None = None     # clé de Candidate.data (fiche)
    required: bool = False
    max_len: int = 300
    choices: tuple[tuple[str, tuple[str, ...]], ...] = ()   # (valeur stockée, alias)
    bounds: tuple[int, int] | None = None
    aliases: tuple[str, ...] = ()
    hint: str = ""
    example: str = ""
    text_format: bool = False       # colonne au format Texte dans le modèle
    width: int = 18

    def choice_values(self) -> list[str]:
        return [value for value, _ in self.choices]


def _c(*pairs: tuple[str, tuple[str, ...]]) -> tuple[tuple[str, tuple[str, ...]], ...]:
    return tuple(pairs)


FIELDS: tuple[ImportField, ...] = (
    ImportField("last_name", "Nom", "name", column="last_name", data_key="nom", required=True, max_len=100,
                aliases=("nom", "nom de famille", "nom candidat", "nom du candidat", "last name", "surname", "اللقب", "لقب", "اسم العائله"),
                example="BENALI"),
    ImportField("first_name", "Prénom", "name", column="first_name", data_key="prenom", required=True, max_len=100,
                aliases=("prenom", "prenoms", "prenom candidat", "prenom du candidat", "first name", "الاسم", "اسم"),
                example="Karim"),
    ImportField("birth_date", "Date de naissance", "date", data_key="dateNaissance",
                aliases=("date de naissance", "date naissance", "ne le", "nee le", "ne e le", "naissance", "ddn", "date of birth", "تاريخ الميلاد", "تاريخ الازدياد"),
                hint="JJ/MM/AAAA", example="15/03/1990", width=20),
    ImportField("birth_place", "Lieu de naissance", "text", data_key="lieuNaissance", max_len=120,
                aliases=("lieu de naissance", "lieu naissance", "ne a", "nee a", "مكان الميلاد", "مكان الازدياد"), example="Alger"),
    ImportField("sex", "Sexe", "choice", data_key="sexe",
                choices=_c(("M", ("m", "masculin", "homme", "h", "male", "ذكر")), ("F", ("f", "feminin", "femme", "female", "انثي"))),
                aliases=("sexe", "genre", "civilite", "الجنس"), hint="M ou F", example="M", width=10),
    ImportField("family_status", "Situation familiale", "choice", data_key="situation",
                choices=_c(("Célibataire", ("celibataire", "اعزب", "عزباء")),
                           ("Marié(e)", ("marie e", "marie", "mariee", "متزوج", "متزوجه")),
                           ("Divorcé(e)", ("divorce e", "divorce", "divorcee", "مطلق", "مطلقه")),
                           ("Veuf(ve)", ("veuf ve", "veuf", "veuve", "ارمل", "ارمله"))),
                aliases=("situation familiale", "situation de famille", "etat civil", "etat matrimonial", "situation matrimoniale", "situation", "الحاله العائليه", "الحاله المدنيه"),
                example="Marié(e)", width=20),
    ImportField("children_count", "Nombre d'enfants", "int", data_key="nombreEnfants", bounds=(0, 20),
                aliases=("nombre d enfants", "nombre enfants", "nb enfants", "enfants", "عدد الاولاد", "عدد الاطفال"), example="2", width=16),
    ImportField("blood_group", "Groupe sanguin", "choice", data_key="groupeSanguin",
                choices=_c(*((value, ()) for value in ("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"))),
                aliases=("groupe sanguin", "groupage", "gs", "فصيله الدم", "زمره الدم"), example="O+", width=14),
    ImportField("father_name", "Nom du père", "text", data_key="nomPere", max_len=120,
                aliases=("nom du pere", "prenom du pere", "pere", "fils de", "اسم الاب"), example="Mohamed"),
    ImportField("mother_name", "Nom de la mère", "text", data_key="nomMere", max_len=120,
                aliases=("nom de la mere", "nom et prenom de la mere", "mere", "et de", "اسم الام", "لقب واسم الام"), example="HADDAD Fatima"),
    ImportField("nin", "NIN", "nin", data_key="nin", max_len=20,
                aliases=("nin", "numero d identification national", "numero identification national", "n nin", "رقم التعريف الوطني"),
                hint="10 ou 18 chiffres, format Texte", example="109900123456789012", text_format=True, width=24),
    ImportField("cnas", "N° CNAS", "digits", data_key="numeroCnas", max_len=20,
                aliases=("n cnas", "cnas", "numero cnas", "numero de securite sociale", "n securite sociale", "nss", "رقم الضمان الاجتماعي"),
                hint="Format Texte", example="900123456789", text_format=True, width=18),
    ImportField("phone", "Téléphone", "phone", column="phone", data_key="telephone", max_len=40,
                aliases=("telephone", "tel", "n telephone", "numero de telephone", "numero telephone", "mobile", "portable", "gsm", "phone", "الهاتف", "رقم الهاتف", "الجوال"),
                hint="Format Texte — 0555123456 ou +213 555 12 34 56", example="0555123456", text_format=True, width=20),
    ImportField("email", "E-mail", "email", column="email", data_key="email", max_len=150,
                aliases=("e mail", "email", "mail", "courriel", "adresse mail", "adresse e mail", "adresse email", "البريد الالكتروني", "الايميل"),
                example="karim.benali@example.com", width=28),
    ImportField("address", "Adresse", "text", data_key="adresse", max_len=500,
                aliases=("adresse", "adresse postale", "domicile", "adresse domicile", "العنوان"), example="12 rue Didouche Mourad", width=30),
    ImportField("wilaya", "Wilaya", "wilaya", data_key="wilaya",
                aliases=("wilaya", "wilaya de residence", "الولايه"), hint="Nom ou code (ex. Alger ou 16)", example="Alger"),
    ImportField("commune", "Commune", "commune", data_key="commune",
                aliases=("commune", "commune de residence", "ville", "البلديه"), hint="Commune de la wilaya indiquée", example="Alger Centre"),
    ImportField("emergency_name", "Contact d'urgence", "text", data_key="contactUrgenceNom", max_len=150,
                aliases=("contact d urgence", "contact urgence", "personne a contacter", "nom contact urgence", "personne a prevenir"), example="BENALI Nadia", width=22),
    ImportField("emergency_relation", "Lien avec le candidat", "text", data_key="contactUrgenceLien", max_len=80,
                aliases=("lien avec le candidat", "lien contact urgence", "lien de parente", "lien"), example="Épouse", width=20),
    ImportField("emergency_phone", "Téléphone d'urgence", "phone", data_key="contactUrgenceTel", max_len=40,
                aliases=("telephone d urgence", "telephone urgence", "tel urgence", "telephone contact urgence"),
                hint="Format Texte", example="0661123456", text_format=True, width=20),
    ImportField("desired_position", "Poste souhaité", "position", column="desired_position", data_key="posteSouhaite", max_len=150,
                aliases=("poste souhaite", "poste recherche", "poste", "poste demande", "fonction", "fonction souhaitee", "emploi", "المنصب", "الوظيفه", "المنصب المطلوب"),
                hint="Un poste du référentiel ATLAS", width=30),
    ImportField("expected_salary", "Salaire demandé (DA/mois)", "money", column="expected_salary", data_key="salairePrevu",
                aliases=("salaire demande da mois", "salaire demande", "salaire souhaite", "pretention salariale", "pretentions salariales", "salaire", "الراتب المطلوب"),
                example="45000", width=22),
    ImportField("availability", "Disponibilité", "choice", data_key="disponibilite",
                choices=_c(("Immédiatement", ("immediatement", "immediate", "immediat", "de suite", "tout de suite", "فوري", "فورا")),
                           ("01 mois", ("01 mois", "1 mois", "un mois")), ("02 mois", ("02 mois", "2 mois", "deux mois"))),
                aliases=("disponibilite", "disponible", "date de disponibilite", "التوفر"), example="Immédiatement"),
    ImportField("source", "Source de candidature", "text", data_key="source", max_len=150,
                aliases=("source de candidature", "source candidature", "source", "origine", "origine de la candidature", "canal", "المصدر"), example="ANEM", width=22),
    ImportField("military_service", "Service militaire", "choice", data_key="serviceMilitaire",
                choices=_c(("Oui", ("oui", "accompli", "effectue", "نعم")), ("Non", ("non", "non accompli", "لا")),
                           ("Exempté", ("exempte", "exempt", "dispense", "معفي")), ("Sursitaire", ("sursitaire", "sursis", "مؤجل"))),
                aliases=("service militaire", "service national", "situation militaire", "الخدمه الوطنيه", "الخدمه العسكريه"), example="Oui"),
    ImportField("height", "Taille (cm)", "int", data_key="taille", bounds=(100, 230),
                aliases=("taille cm", "taille", "الطول"), example="178", width=12),
    ImportField("shoe_size", "Pointure", "int", data_key="pointure", bounds=(30, 55),
                aliases=("pointure", "pointure chaussures", "مقاس الحذاء"), example="43", width=12),
    ImportField("shirt_size", "Taille chemise", "choice", data_key="tailleChemise",
                choices=_c(*((value, ()) for value in ("XS", "S", "M", "L", "XL", "XXL", "XXXL"))),
                aliases=("taille chemise", "taille de chemise", "taille tenue", "taille vetement"), example="L", width=14),
    ImportField("languages", "Langues parlées", "list", data_key="langues", max_len=300,
                aliases=("langues parlees", "langues", "langue", "اللغات"), hint="Séparées par des virgules", example="Arabe, Français", width=22),
    ImportField("experience", "Expérience professionnelle", "text", data_key="experienceTexte", max_len=2000,
                aliases=("experience professionnelle", "experience", "experiences", "annees d experience", "parcours", "الخبره", "الخبره المهنيه"),
                example="3 ans agent de sécurité", width=34),
    ImportField("notes", "Observations", "text", data_key="notes", max_len=2000,
                aliases=("observations", "observation", "notes", "notes du recruteur", "remarques", "remarque", "commentaire", "commentaires", "ملاحظات"),
                example="Disponible pour travail de nuit", width=34),
)

FIELD_BY_KEY: dict[str, ImportField] = {item.key: item for item in FIELDS}
REQUIRED_KEYS: tuple[str, ...] = tuple(item.key for item in FIELDS if item.required)


@lru_cache(maxsize=1)
def header_aliases() -> dict[str, str]:
    """Clé normalisée d'en-tête → champ. Le libellé du modèle fait toujours partie des alias."""
    table: dict[str, str] = {}
    for item in FIELDS:
        for alias in (item.label, *item.aliases):
            key = norm_key(alias)
            if key and key not in table:
                table[key] = item.key
    return table


def field_for_header(header: object) -> str | None:
    return header_aliases().get(norm_key(header))


def resolve_choice(item: ImportField, value: str) -> str | None:
    text = str(value or "").strip()
    wanted = norm_key(text)
    for stored, aliases in item.choices:
        # Les signes +/- distinguent les groupes sanguins : comparaison stricte d'abord.
        if text.upper().replace(" ", "") == stored.upper().replace(" ", ""):
            return stored
        if item.key != "blood_group" and wanted and (wanted == norm_key(stored) or wanted in {norm_key(alias) for alias in aliases}):
            return stored
    return None
