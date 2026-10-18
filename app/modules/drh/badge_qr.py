"""QR de pointage des badges, format « A1 » : lisible par une douchette quelle que soit la disposition
du clavier de l'ordinateur.

Pourquoi : une douchette émule un clavier. Configurée en « AZERTY PC » et branchée sur un Mac AZERTY,
la HENEX HC-866 tape « - » au lieu de « = » (et « ! » au lieu de « _ ») : l'adresse signée historique
`…/public/badge/<réf>?t=<signature>&b=<n>` arrive en `?t-…`, refusée à juste titre. Les touches qui
diffèrent entre les deux AZERTY sont surtout des symboles (= - _ + & § ! @ # …) ; lettres, chiffres
et « : / . » sont identiques, et ces trois derniers ont été vérifiés sur la HC-866 réelle (l'adresse
`https://…/public/badge/` lui parvient intacte).

Le format A1 n'utilise donc que :
- un préfixe d'adresse `https://<hôte>/p/` (lettres minuscules, « : », « / », « . ») ;
- un code de 25 caractères en MAJUSCULES et chiffres (base 32 de Crockford : ni I, L, O, U) :
      A1 <numéro de badge : 7 car.> <signature : 16 car.>
  ex. (signature factice) : https://badge.irongs.com/p/A10000042ZZZZZZZZZZZZZZZZ

Le même QR sert au pointage (douchette, caméra du poste) et à la vérification publique au téléphone
(la page /p/<code> est la page publique du badge). Aucune donnée personnelle n'y figure.

Règles :
- signature HMAC-SHA256 (80 bits) du numéro de badge, avec une clé dérivée du secret de l'application
  et propre à cet usage : ni un jeton de lien public, ni un jeton de session ne peuvent servir de A1 ;
- le code est insensible à la casse PAR DÉFINITION (base 32 de Crockford) : « Verr. Maj. » ou une
  douchette réglée en majuscules ne change pas sa valeur. Aucun autre caractère n'est réinterprété :
  I, L, O, U ou tout symbole sont refusés, jamais « corrigés » ;
- tout le reste (badge actif, remplacé, révoqué, expiré, employé, société, site, liste noire,
  vacation, clôture, doublons) est jugé par le Pointeur, exactement comme pour un badge Studio.
"""
from __future__ import annotations

import hashlib
import hmac
import re

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
PREFIX = "A1"
ID_CHARS, TAG_CHARS = 7, 16                      # 35 bits de numéro, 80 bits de signature
TOKEN_LENGTH = len(PREFIX) + ID_CHARS + TAG_CHARS
MAX_BADGE_ID = 32 ** ID_CHARS - 1
PATH = "/p/"

_SYMBOL = f"[{ALPHABET}]"
_TOKEN = re.compile(rf"^{PREFIX}{_SYMBOL}{{{ID_CHARS + TAG_CHARS}}}$")
# Adresse complète (schéma et hôte insensibles à la casse, comme toute URL) ou code seul (saisie).
_URL = re.compile(r"^https?://[a-z0-9.-]+(?::[0-9]{1,5})?/(?:api/)?p/([0-9a-z]{%d})/?$" % TOKEN_LENGTH, re.I)
_BARE = re.compile(r"^[0-9a-z]{%d}$" % TOKEN_LENGTH, re.I)
# Code A1 reconnaissable dans une lecture dont l'adresse a été abîmée : diagnostic seulement.
_DAMAGED = re.compile(rf"(?<![0-9A-Za-z]){PREFIX}{_SYMBOL}{{{ID_CHARS + TAG_CHARS}}}(?![0-9A-Za-z])")

OK, ABSENT, MALFORMED, BAD_SIGNATURE, DAMAGED = "ok", "absent", "format_invalide", "signature_invalide", "lecture_alteree"


def _key() -> bytes:
    from app.core.config import settings

    return hmac.new(settings.jwt_secret.encode("utf-8"), b"atlas:badge-pointage:A1", hashlib.sha256).digest()


def _encode(value: int, width: int) -> str:
    chars = []
    for _ in range(width):
        value, rest = divmod(value, 32)
        chars.append(ALPHABET[rest])
    if value:
        raise ValueError("valeur trop grande pour le format A1")
    return "".join(reversed(chars))


def _decode(text: str) -> int:
    value = 0
    for char in text:
        value = value * 32 + ALPHABET.index(char)
    return value


def _tag(badge_id: int) -> str:
    digest = hmac.new(_key(), f"{PREFIX}:{badge_id}".encode("ascii"), hashlib.sha256).digest()
    return _encode(int.from_bytes(digest[:TAG_CHARS * 5 // 8], "big"), TAG_CHARS)


def token_for(badge_id: int) -> str:
    badge_id = int(badge_id)
    if not 0 < badge_id <= MAX_BADGE_ID:
        raise ValueError("numéro de badge hors du format A1")
    return f"{PREFIX}{_encode(badge_id, ID_CHARS)}{_tag(badge_id)}"


def url_for(base_url: str, badge_id: int) -> str:
    """Adresse imprimée dans le QR : `https://<hôte>/p/<code>`, hôte en minuscules."""
    return f"{str(base_url).rstrip('/').lower()}{PATH}{token_for(badge_id)}"


def read(text: str) -> tuple[str, int | None]:
    """(état, numéro de badge) d'une lecture. `absent` : ce n'est pas un QR A1 (autre format, à
    traiter ailleurs). Seul l'état `ok` porte un numéro, et seulement si la signature est exacte."""
    raw = str(text or "").strip()
    match = _URL.match(raw) or _BARE.match(raw)
    if not match:
        # Code A1 entier, en majuscules, isolé dans une adresse abîmée (« : » ou « / » transformé) :
        # c'est un badge A1 mal lu — refusé, jamais reconstitué.
        return (DAMAGED, None) if _DAMAGED.search(raw) else (ABSENT, None)
    token = (match.group(1) if match.re is _URL else match.group(0)).upper()
    if not _TOKEN.match(token):
        # Bonne longueur, mais pas le préfixe A1 : un autre code (ou du texte) — pas un badge A1.
        if not token.startswith(PREFIX):
            return (ABSENT, None) if match.re is _BARE else (MALFORMED, None)
        return MALFORMED, None
    badge_id = _decode(token[len(PREFIX):len(PREFIX) + ID_CHARS])
    if badge_id <= 0 or not hmac.compare_digest(token[len(PREFIX) + ID_CHARS:], _tag(badge_id)):
        return BAD_SIGNATURE, None
    return OK, badge_id
