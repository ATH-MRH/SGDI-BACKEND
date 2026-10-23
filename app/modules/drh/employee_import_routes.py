"""API de l'import Excel des employés (Administration système › Recrutement groupé).

Chemins sous /api/drh/employee-import. Ils évitent les mots-clés de `request_action`
(« /export », « /download », « /validate »…) : téléverser, vérifier, corriger, confirmer et
annuler relèvent de l'action « create » ; le modèle, le résultat et le rapport de « read »."""
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.audit import append_audit
from app.db.session import get_db
from app.modules.auth.dependencies import current_token_payload, current_user, user_holds_action
from app.modules.auth.models import User
from app.modules.drh import candidate_import as excel, employee_import as importer
from app.modules.drh.routes import _effective_society_filter, _is_admin_system_user

router = APIRouter(prefix="/employee-import", dependencies=[Depends(current_user)])
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _has_drh_module(user: User) -> bool:
    from app.modules.auth.dependencies import _normalized_module_keys
    from app.modules.auth.routes import is_admin_role

    if is_admin_role(user.role):
        return True
    if user.authorized_modules is not None:
        return "drh" in _normalized_module_keys(user.authorized_modules)
    return str(user.role or "").strip().lower() in {"rh", "drh"}


def ensure_import_access(db: Session, user: User, token_payload: dict, request: Request) -> None:
    """Administration système + module DRH + action « create ». Point de contrôle unique : il
    passera au droit dédié « création directe d'employé » quand celui-ci sera fusionné. Le
    périmètre société est contrôlé en plus sur chaque ligne, côté serveur."""
    if not _is_admin_system_user(user, token_payload):
        reason = "Import réservé au compte Administration système"
    elif not _has_drh_module(user):
        reason = "Import réservé aux comptes disposant du module DRH"
    elif not user_holds_action(user, "create"):
        reason = "Import réservé aux comptes autorisés à créer"
    else:
        return
    append_audit(db, action="authorization.drh.employees.import", resource="employee_import", result="refused", user=user,
                 request=request, new_state={"reason": reason})
    db.commit()
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)


def guard(request: Request, db: Session = Depends(get_db), user: User = Depends(current_user),
          token_payload: dict = Depends(current_token_payload)) -> User:
    ensure_import_access(db, user, token_payload, request)
    return user


class PreviewIn(BaseModel):
    sheet: int = Field(ge=0, le=excel.MAX_SHEETS)
    mapping: dict[str, str | None] = Field(default_factory=dict)


class CorrectionIn(BaseModel):
    row: int = Field(ge=1, le=excel.HEADER_SCAN_ROWS + excel.MAX_ROWS + 1)
    # {champ: texte} ; None = revenir à la valeur du fichier.
    values: dict[str, str | None] = Field(default_factory=dict, max_length=len(importer.FIELDS))
    # Validations explicites des constats « à vérifier » de la ligne (remplacent les précédentes).
    accept: list[str] | None = Field(default=None, max_length=20)
    exclude: bool | None = None


def _attachment(content: bytes, filename: str) -> Response:
    return Response(content=content, media_type=XLSX_MIME, headers={
        "Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


def _active_society(user: User, society: str | None) -> str | None:
    return _effective_society_filter(user, society.strip()) if society and society.strip() else None


@router.get("/config")
def config(db: Session = Depends(get_db), user: User = Depends(guard)) -> dict[str, Any]:
    ctx = importer._Context(db, user, None)
    return {"limits": excel.limits(), "groups": list(importer.GROUPS), "contract_types": list(importer.CONTRACT_TYPES),
            "societies": sorted(ctx.allowed.values()),
            "fields": [{"key": item.key, "label": item.label, "hint": item.hint,
                        "required": item.key in ("full_name", "last_name", "first_name", "society")} for item in importer.FIELDS]}


@router.get("/template")
def template(society: str | None = Query(None, max_length=150), db: Session = Depends(get_db), user: User = Depends(guard)) -> Response:
    return _attachment(importer.build_template(db, user, _active_society(user, society)), "modele-import-employes.xlsx")


@router.post("")
async def upload(request: Request, file: UploadFile = File(...), society: str | None = Query(None, max_length=150),
                 db: Session = Depends(get_db), user: User = Depends(guard)) -> dict[str, Any]:
    """Analyse le classeur : aucun employé n'est créé avant la confirmation."""
    active = _active_society(user, society)
    content = await file.read(excel.MAX_FILE_BYTES + 1)
    return importer.upload(db, user, file_name=file.filename or "", content=content, society=active, request=request)


@router.post("/{session_id}/preview")
def preview(session_id: str, payload: PreviewIn, db: Session = Depends(get_db), user: User = Depends(guard)) -> dict[str, Any]:
    session = importer.get_session(db, user, session_id, ("uploaded", "previewed"))
    return {"session_id": session.public_id, **importer.preview(db, user, session, payload.sheet, payload.mapping)}


@router.post("/{session_id}/corrections")
def corrections(session_id: str, payload: CorrectionIn, db: Session = Depends(get_db), user: User = Depends(guard)) -> dict[str, Any]:
    session = importer.get_session(db, user, session_id, ("previewed",))
    return {"session_id": session.public_id,
            **importer.correct(db, user, session, payload.row, payload.values, payload.accept, payload.exclude)}


@router.post("/{session_id}/confirm")
def confirm(session_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(guard)) -> dict[str, Any]:
    return importer.confirm(db, user, session_id, request=request)


@router.get("/{session_id}/result")
def result(session_id: str, db: Session = Depends(get_db), user: User = Depends(guard)) -> dict[str, Any]:
    return importer.result_of(importer.get_session(db, user, session_id, ("processing", "completed", "failed")))


@router.post("/{session_id}/cancel")
def cancel(session_id: str, db: Session = Depends(get_db), user: User = Depends(guard)) -> dict[str, str]:
    importer.cancel(db, importer.get_session(db, user, session_id, ("uploaded", "previewed")))
    return {"status": "cancelled"}


@router.get("/{session_id}/report")
def report(session_id: str, db: Session = Depends(get_db), user: User = Depends(guard)) -> Response:
    session = importer.get_session(db, user, session_id, ("previewed", "processing", "completed", "failed"))
    counts, rows = importer.report_content(db, user, session)
    return _attachment(importer.build_report(session, counts, rows), "rapport-import-employes.xlsx")
