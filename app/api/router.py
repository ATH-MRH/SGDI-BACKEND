from fastapi import APIRouter

from app.modules.auth.routes import router as auth_router
from app.modules.drh.routes import router as drh_router
from app.modules.ops.routes import router as ops_router
from app.modules.materiel.routes import router as materiel_router
from app.modules.commercial.routes import router as commercial_router
from app.modules.irongs.routes import router as irongs_router
from app.modules.portal.routes import router as portal_router
from app.modules.finance_routes import router as finance_router
from app.modules.ui.routes import router as ui_router
from app.modules.erp.routes import router as erp_router
from app.modules.accounting.routes import router as accounting_router
from app.modules.achats.routes import router as achats_router
from app.modules.ventes.routes import router as ventes_router
from app.modules.reporting.routes import router as reporting_router
from app.modules.assistant.routes import router as assistant_router
from app.modules.ronde.routes import router as ronde_router


api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["Auth"])
api_router.include_router(drh_router, prefix="/drh", tags=["DRH"])
api_router.include_router(ops_router, prefix="/ops", tags=["OPS"])
api_router.include_router(materiel_router, prefix="/materiel", tags=["Matériel & équipement"])
api_router.include_router(commercial_router, prefix="/commercial", tags=["Commercial"])
api_router.include_router(irongs_router, prefix="/irongs", tags=["IRONGS BASE"])
api_router.include_router(portal_router, prefix="/portal", tags=["Portail RH"])
api_router.include_router(finance_router, prefix="/finance", tags=["Finances"])
api_router.include_router(ui_router, prefix="/ui", tags=["Interface"])
api_router.include_router(erp_router, prefix="/erp", tags=["ERP"])
api_router.include_router(accounting_router, prefix="/accounting", tags=["Comptabilité"])
api_router.include_router(achats_router, prefix="/achats", tags=["Achats & Fournisseurs"])
api_router.include_router(ventes_router, prefix="/ventes", tags=["Ventes & Clients"])
api_router.include_router(reporting_router, prefix="/reporting", tags=["Reporting & Dashboard"])
api_router.include_router(assistant_router, prefix="/assistant", tags=["Assistant IA"])
api_router.include_router(ronde_router, prefix="/ronde", tags=["Contrôleur de Ronde"])
