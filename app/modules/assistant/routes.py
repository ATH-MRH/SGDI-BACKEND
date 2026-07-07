from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.assistant.schemas import AgentRequest, AgentResponse, ChatRequest, ChatResponse
from app.modules.assistant import agent as agent_module
from app.modules.assistant import service

router = APIRouter(dependencies=[Depends(current_user)])


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, user: User = Depends(current_user)):
    # Mode local (par défaut, sans clé API)
    if not settings.assistant_paid_ai_enabled or not settings.anthropic_api_key:
        return ChatResponse(response=service.local_atlas_answer(payload.message, payload.context))

    # Mode IA payant (Claude)
    try:
        history = [{"role": m.role, "content": m.content} for m in payload.history]
        text = service.claude_answer(
            api_key=settings.anthropic_api_key,
            message=payload.message,
            history=history,
            context=payload.context,
        )
        return ChatResponse(response=text)

    except ModuleNotFoundError as exc:
        if exc.name == "anthropic":
            return ChatResponse(response=service.local_atlas_answer(payload.message, payload.context))
        raise HTTPException(status_code=500, detail=f"Erreur assistant : {exc}") from exc

    except Exception as exc:
        msg = str(exc).lower()
        if any(t in msg for t in ["credit", "billing", "purchase"]):
            return ChatResponse(response=service.local_atlas_answer(payload.message, payload.context))
        raise HTTPException(status_code=500, detail=f"Erreur assistant : {exc}") from exc


@router.post("/agent", response_model=AgentResponse)
def agent_endpoint(payload: AgentRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Agent IA ATLAS (Phase 1, lecture seule). Repli sur l'ATLAS local si désactivé/indisponible."""
    if not settings.assistant_agent_enabled or not settings.anthropic_api_key:
        return AgentResponse(response=service.local_atlas_answer(payload.message, None))
    history = [{"role": m.role, "content": m.content} for m in payload.history]
    try:
        text = agent_module.run_agent(db, user, payload.message, history)
        return AgentResponse(response=text)
    except ModuleNotFoundError as exc:
        if exc.name == "anthropic":
            return AgentResponse(response=service.local_atlas_answer(payload.message, None))
        raise HTTPException(status_code=500, detail=f"Erreur agent : {exc}") from exc
    except Exception as exc:
        msg = str(exc).lower()
        if any(t in msg for t in ["credit", "billing", "purchase"]):
            return AgentResponse(response=service.local_atlas_answer(payload.message, None))
        raise HTTPException(status_code=500, detail=f"Erreur agent : {exc}") from exc


@router.get("/tts")
def tts(text: str = Query(..., min_length=1, max_length=220), user: User = Depends(current_user)):
    try:
        audio = service.tts_audio_bytes(text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Voix ATLAS indisponible : {exc}") from exc
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store, max-age=0"},
    )
