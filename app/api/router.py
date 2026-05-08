from fastapi import APIRouter

from app.modules.auth.routes import router as auth_router
from app.modules.drh.routes import router as drh_router
from app.modules.ops.routes import router as ops_router
from app.modules.materiel.routes import router as materiel_router
from app.modules.commercial.routes import router as commercial_router
from app.modules.irongs.routes import router as irongs_router
from app.modules.portal.routes import router as portal_router


api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["Auth"])
api_router.include_router(drh_router, prefix="/drh", tags=["DRH"])
api_router.include_router(ops_router, prefix="/ops", tags=["OPS"])
api_router.include_router(materiel_router, prefix="/materiel", tags=["Matériel & équipement"])
api_router.include_router(commercial_router, prefix="/commercial", tags=["Commercial"])
api_router.include_router(irongs_router, prefix="/irongs", tags=["IRONGS BASE"])
api_router.include_router(portal_router, prefix="/portal", tags=["Portail RH"])
