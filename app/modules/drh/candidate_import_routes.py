"""API de l'import Excel de candidats (recrute.irongs.com).

Les chemins évitent volontairement les mots-clés de `request_action` (« /export », « /download »,
« /validate »…) : téléverser, vérifier et confirmer relèvent de l'action « create », lire le
modèle ou le rapport de l'action « read ». La mise à jour d'une fiche existante exige en plus
l'action « update », contrôlée ligne à ligne à la confirmation."""
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.drh import candidate_import as importer
from app.modules.drh.candidate_import_reference import FIELDS
from app.modules.drh.routes import _ensure_recruitment_access

router = APIRouter(dependencies=[Depends(current_user)])
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _require_import(db: Session, user: User, request: Request) -> None:
    """Import = création de fiches : accès Recrutement et action « create »."""
    _ensure_recruitment_access(user)
    if not importer.user_can(user, "create"):
        append_audit(db, action="authorization.recruitment.import", resource="candidate_import", result="refused", user=user, request=request)
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Import réservé aux comptes autorisés à créer des candidatures")


class ImportPreviewIn(BaseModel):
    sheet: int = Field(ge=0, le=importer.MAX_SHEETS)
    mapping: dict[str, str | None] = Field(default_factory=dict)


class ImportConfirmIn(BaseModel):
    # {numéro de ligne Excel: "create" | "update" | "skip"} — uniquement pour les doublons.
    decisions: dict[str, str] = Field(default_factory=dict)


def _attachment(content: bytes, filename: str) -> Response:
    return Response(content=content, media_type=XLSX_MIME, headers={
        "Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/candidates/import/config")
def candidate_import_config(request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    _require_import(db, user, request)
    return {
        "limits": importer.limits(),
        "can_update": importer.user_can(user, "update"),
        "fields": [{"key": item.key, "label": item.label, "required": item.required, "hint": item.hint,
                    "values": item.choice_values()} for item in FIELDS],
    }


@router.get("/candidates/import/template")
def candidate_import_template(request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Response:
    _require_import(db, user, request)
    return _attachment(importer.build_template(db), "modele-import-candidats.xlsx")


@router.post("/candidates/import")
async def candidate_import_upload(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
                                  user: User = Depends(current_user)) -> dict[str, Any]:
    """Analyse le classeur (aucune fiche créée) et ouvre une session d'import liée au compte."""
    _require_import(db, user, request)
    content = await file.read(importer.MAX_FILE_BYTES + 1)
    session = importer.create_session(db, user, file_name=file.filename or "", content=content, request=request)
    return {"session_id": session.public_id, "file_name": session.file_name, "file_size": session.file_size,
            "expires_at": session.expires_at.isoformat(), "limits": importer.limits(), **importer.describe_workbook(session.workbook)}


@router.post("/candidates/import/{session_id}/preview")
def candidate_import_preview(session_id: str, payload: ImportPreviewIn, request: Request, db: Session = Depends(get_db),
                             user: User = Depends(current_user)) -> dict[str, Any]:
    _require_import(db, user, request)
    session = importer.get_session(db, user, session_id, statuses=("uploaded", "previewed"))
    return {"session_id": session.public_id, **importer.preview(db, user, session, payload.sheet, payload.mapping)}


@router.post("/candidates/import/{session_id}/confirm")
def candidate_import_confirm(session_id: str, payload: ImportConfirmIn, request: Request, db: Session = Depends(get_db),
                             user: User = Depends(current_user)) -> dict[str, Any]:
    _require_import(db, user, request)
    return importer.confirm(db, user, session_id, payload.decisions, request=request)


@router.post("/candidates/import/{session_id}/cancel")
def candidate_import_cancel(session_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict[str, str]:
    _require_import(db, user, request)
    importer.cancel(db, importer.get_session(db, user, session_id))
    return {"status": "cancelled"}


@router.get("/candidates/import/{session_id}/report")
def candidate_import_report(session_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Response:
    _require_import(db, user, request)
    session = importer.get_session(db, user, session_id, statuses=("previewed", "completed"))
    rows, counts = importer.report_rows(db, user, session)
    return _attachment(importer.build_report(session, rows, counts), "rapport-import-candidats.xlsx")
