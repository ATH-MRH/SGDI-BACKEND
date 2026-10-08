"""Validation des CV et conservation privée dans les données du candidat."""
import base64
import binascii
from pathlib import PurePath

MAX_CV_BYTES = 5 * 1024 * 1024
CV_TYPES = {'application/pdf': ('.pdf', b'%PDF-'), 'image/jpeg': ('.jpg', b'\xff\xd8\xff'), 'image/png': ('.png', b'\x89PNG\r\n\x1a\n')}


def validate_cv(value: dict) -> tuple[dict, str]:
    if not isinstance(value, dict):
        raise ValueError('CV invalide')
    mime = value.get('mime_type')
    if mime not in CV_TYPES:
        raise ValueError('Le CV doit être un PDF, JPG ou PNG')
    encoded = value.get('data_base64')
    if not isinstance(encoded, str) or len(encoded) > ((MAX_CV_BYTES + 2) // 3) * 4:
        raise ValueError('Le CV doit faire au maximum 5 Mo')
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError('Le contenu du CV est invalide') from exc
    if not content or len(content) > MAX_CV_BYTES:
        raise ValueError('Le CV est vide ou dépasse 5 Mo')
    extension, signature = CV_TYPES[mime]
    if not content.startswith(signature):
        raise ValueError('Le contenu du CV ne correspond pas à son format')
    name = PurePath(str(value.get('name') or 'CV').replace('\\', '/')).name[:180]
    if not name.lower().endswith((extension, '.jpeg' if mime == 'image/jpeg' else extension)):
        name = 'CV' + extension
    return {'name': name, 'mime_type': mime, 'size': len(content)}, encoded


def apply_cv(data: dict, persisted: dict | None = None) -> dict:
    data = dict(data)
    persisted = persisted or {}
    # Les clients ne peuvent ni remplacer le contenu privé ni fabriquer sa métadonnée.
    data.pop('_cv_content', None)
    data.pop('cv', None)
    if 'cvUpload' in data:
        upload = data.pop('cvUpload')
        if upload is not None:
            data['cv'], data['_cv_content'] = validate_cv(upload)
    else:
        for key in ('cv', '_cv_content'):
            if key in persisted:
                data[key] = persisted[key]
    return data
