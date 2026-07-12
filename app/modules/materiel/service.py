import unicodedata
from datetime import date, timedelta
from typing import Any, Type

from fastapi import HTTPException
from sqlalchemy import delete, func, inspect, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.modules.drh.models import Employee
from app.modules.materiel.models import EmployeeEquipment, MaterialAssignment, StockArticle, StockMovement, Store, Supplier
from app.modules.materiel.schemas import DotationCreate, MovementCreate, ReturnEquipmentIn
from app.modules.ops.models import Site


ENTRY_TYPES = {"entree", "achat", "retour_employe", "retour_site", "regularisation_entree"}
EXIT_TYPES = {
    "sortie",
    "nouvelle_dotation",
    "renouvellement_dotation",
    "dotation_pret_mission",
    "reformer",
    "perte",
    "casse",
}
DOTATION_TYPES = {"nouvelle_dotation", "renouvellement_dotation", "dotation_pret_mission"}


_store_schema_ok = False
_material_schema_ok = False


def _society_key(value: Any) -> str:
    """Clé de comparaison société : majuscules, espaces normalisés, sans accents.
    Même règle que irongs/ops. Indispensable ici car le DRH met la société employé en
    MAJUSCULES (_UpperMixin) alors que le matériel la garde telle quelle : une
    comparaison brute rejetait à tort une dotation pourtant de la même société."""
    text = " ".join(str(value or "").strip().upper().split())
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def _same_society(a: Any, b: Any) -> bool:
    """Vrai si a et b désignent la même société (ou si l'une est vide = pas de contrainte)."""
    if not a or not b:
        return True
    return _society_key(a) == _society_key(b)


def ensure_store_schema(db: Session) -> None:
    global _store_schema_ok
    if _store_schema_ok:
        return
    try:
        bind = db.get_bind()
        columns = {column["name"] for column in inspect(bind).get_columns("stores")}
        if "config" not in columns:
            db.execute(text("ALTER TABLE stores ADD COLUMN config JSON"))
            db.commit()
        _store_schema_ok = True
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Migration magasin PostgreSQL impossible: {exc}") from exc


def ensure_material_schema(db: Session) -> None:
    global _material_schema_ok
    if _material_schema_ok:
        return
    try:
        bind = db.get_bind()
        article_columns = {column["name"] for column in inspect(bind).get_columns("stock_articles")}
        movement_columns = {column["name"] for column in inspect(bind).get_columns("stock_movements")}
        equipment_columns = {column["name"] for column in inspect(bind).get_columns("employee_equipment")}
        article_additions = {
            "purchase_cost": "FLOAT DEFAULT 0",
            "useful_life_months": "FLOAT DEFAULT 0",
            "item_state": "VARCHAR(40) DEFAULT 'neuf'",
        }
        movement_additions = {
            "site_id": "INTEGER",
            "target_type": "VARCHAR(40)",
            "target_id": "INTEGER",
            "target_label": "VARCHAR(180)",
            "structure": "VARCHAR(150)",
            "item_state": "VARCHAR(40)",
            "useful_life_months": "FLOAT DEFAULT 0",
        }
        equipment_additions = {
            "item_state": "VARCHAR(40) DEFAULT 'neuf'",
            "useful_life_months": "FLOAT DEFAULT 0",
        }
        for column, ddl in article_additions.items():
            if column not in article_columns:
                db.execute(text(f"ALTER TABLE stock_articles ADD COLUMN {column} {ddl}"))
        for column, ddl in movement_additions.items():
            if column not in movement_columns:
                db.execute(text(f"ALTER TABLE stock_movements ADD COLUMN {column} {ddl}"))
        for column, ddl in equipment_additions.items():
            if column not in equipment_columns:
                db.execute(text(f"ALTER TABLE employee_equipment ADD COLUMN {column} {ddl}"))
        MaterialAssignment.__table__.create(bind=bind, checkfirst=True)
        db.commit()
        _material_schema_ok = True
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Migration matériel PostgreSQL impossible: {exc}") from exc


def list_rows(db: Session, model: Type, filters: dict[str, Any] | None = None):
    stmt = select(model)
    for key, value in (filters or {}).items():
        if value not in (None, "") and hasattr(model, key):
            stmt = stmt.where(getattr(model, key) == value)
    return db.execute(stmt.order_by(model.id.desc())).scalars().all()


def get_or_404(db: Session, model: Type, row_id: int):
    row = db.get(model, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    return row


def store_type(store: Store | None) -> str | None:
    if not store:
        return None
    config = store.config if isinstance(store.config, dict) else {}
    value = config.get("typeMagasin") or config.get("type_magasin") or config.get("theme")
    return str(value).strip() if value else None


def _payload_dict(payload: Any) -> dict[str, Any]:
    return payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else dict(payload)


def _article_payload_with_store_rules(db: Session, payload: Any, current: StockArticle | None = None) -> dict[str, Any]:
    data = _payload_dict(payload)
    store_id = data.get("store_id", current.store_id if current else None)
    if store_id is None:
        raise HTTPException(status_code=422, detail="Magasin obligatoire pour chaque article")
    store = get_or_404(db, Store, store_id)
    if not _same_society(store.society, data.get("society")):
        raise HTTPException(status_code=422, detail="Magasin et article de sociétés différentes")
    data["store_id"] = store.id
    data["society"] = data.get("society") or store.society
    data["category"] = store_type(store) or data.get("category") or store.name
    if not data.get("designation"):
        raise HTTPException(status_code=422, detail="Désignation article obligatoire")
    if not data.get("code"):
        raise HTTPException(status_code=422, detail="Code article obligatoire")
    if float(data.get("quantity") or 0) < 0:
        raise HTTPException(status_code=422, detail="Quantité article invalide")
    if float(data.get("min_quantity") or 0) < 0:
        raise HTTPException(status_code=422, detail="Seuil minimum invalide")
    return data


def create_article(db: Session, payload: Any):
    ensure_material_schema(db)
    try:
        row = StockArticle(**_article_payload_with_store_rules(db, payload))
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Article déjà existant ou code déjà utilisé") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Sauvegarde article PostgreSQL échouée: {exc}") from exc


def update_article(db: Session, article_id: int, payload: Any):
    ensure_material_schema(db)
    try:
        row = get_or_404(db, StockArticle, article_id)
        data = _article_payload_with_store_rules(db, payload, row)
        for key, value in data.items():
            setattr(row, key, value)
        db.commit()
        db.refresh(row)
        return row
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Article déjà existant ou code déjà utilisé") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Sauvegarde article PostgreSQL échouée: {exc}") from exc


def create_row(db: Session, model: Type, payload: Any):
    try:
        row = model(**payload.model_dump(exclude_unset=True))
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Enregistrement déjà existant ou code déjà utilisé") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Sauvegarde PostgreSQL échouée: {exc}") from exc


def update_row(db: Session, model: Type, row_id: int, payload: Any):
    try:
        row = get_or_404(db, model, row_id)
        for key, value in payload.model_dump(exclude_unset=True).items():
            setattr(row, key, value)
        db.commit()
        db.refresh(row)
        return row
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Enregistrement déjà existant ou code déjà utilisé") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Sauvegarde PostgreSQL échouée: {exc}") from exc



def delete_row(db: Session, model: Type, row_id: int):
    row = get_or_404(db, model, row_id)
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": row_id}


def delete_article(db: Session, article_id: int):
    ensure_material_schema(db)
    row = get_or_404(db, StockArticle, article_id)
    try:
        db.execute(delete(EmployeeEquipment).where(EmployeeEquipment.article_id == article_id))
        db.execute(delete(MaterialAssignment).where(MaterialAssignment.article_id == article_id))
        db.execute(delete(StockMovement).where(StockMovement.article_id == article_id))
        db.delete(row)
        db.commit()
        return {"deleted": True, "id": article_id}
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Suppression article PostgreSQL échouée: {exc}") from exc

def dashboard(db: Session, allowed_societies: list[str] | None = None):
    ensure_material_schema(db)
    allowed = [s for s in (allowed_societies or []) if s]
    articles_stmt = select(StockArticle).where(StockArticle.active == 1)
    stores_stmt = select(Store)
    suppliers_stmt = select(Supplier)
    if allowed:
        articles_stmt = articles_stmt.where(StockArticle.society.in_(allowed))
        stores_stmt = stores_stmt.where((Store.society.in_(allowed)) | (Store.society.is_(None)) | (Store.society == ""))
        suppliers_stmt = suppliers_stmt.where(Supplier.society.in_(allowed))
    articles = db.execute(articles_stmt).scalars().all()
    article_ids = [a.id for a in articles]
    active_dotations = 0
    if article_ids:
        active_dotations = db.execute(
            select(func.count(EmployeeEquipment.id)).where(
                EmployeeEquipment.status == "attribue",
                EmployeeEquipment.article_id.in_(article_ids),
            )
        ).scalar() or 0
    low_stock_alerts = sum(1 for a in articles if (a.quantity or 0) <= 0 or ((a.min_quantity or 0) > 0 and (a.quantity or 0) <= (a.min_quantity or 0)))
    return {
        "articles": len(articles),
        "stores": db.execute(select(func.count()).select_from(stores_stmt.subquery())).scalar() or 0,
        "suppliers": db.execute(select(func.count()).select_from(suppliers_stmt.subquery())).scalar() or 0,
        "low_stock_alerts": low_stock_alerts,
        "active_employee_dotations": active_dotations,
    }


def _article_raw(article: StockArticle) -> dict[str, Any]:
    attrs = article.attributes if isinstance(article.attributes, dict) else {}
    raw = attrs.get("raw") if isinstance(attrs.get("raw"), dict) else {}
    return raw or {}


def _article_thresholds(article: StockArticle) -> tuple[float, float, float]:
    raw = _article_raw(article)

    def num(*values: Any) -> float:
        for value in values:
            try:
                if value not in (None, "", "None", "undefined", "null"):
                    return float(str(value).replace(" ", "").replace(",", "."))
            except (TypeError, ValueError):
                continue
        return 0.0

    seuil = num(raw.get("seuilAlerte"), raw.get("seuil_stock_bas"), raw.get("alert_threshold"))
    minimum = num(article.min_quantity, raw.get("stockMin"), raw.get("min_quantity"))
    maximum = num(raw.get("stockMax"), raw.get("max_quantity"), raw.get("stock_max"))
    return seuil, minimum, maximum


def _stock_alert_state(article: StockArticle) -> dict[str, str]:
    quantity = float(article.quantity or 0)
    seuil, minimum, _maximum = _article_thresholds(article)
    if quantity <= 0:
        return {"code": "rupture", "label": "Rupture", "severity": "critical", "color": "#dc2626", "bg": "#fef2f2"}
    if seuil > 0 and quantity <= seuil:
        return {"code": "alerte", "label": "Stock bas", "severity": "warn", "color": "#b45309", "bg": "#fffbeb"}
    if minimum > 0 and quantity <= minimum:
        return {"code": "min", "label": "Sous minimum", "severity": "warn", "color": "#ca8a04", "bg": "#fefce8"}
    return {"code": "ok", "label": "OK", "severity": "info", "color": "#16a34a", "bg": "#f0fdf4"}


def _stock_alert_item(article: StockArticle, stores_by_id: dict[int, Store], last_movement: date | None = None) -> dict[str, Any]:
    raw = _article_raw(article)
    seuil, minimum, maximum = _article_thresholds(article)
    store = stores_by_id.get(article.store_id or 0)
    state = _stock_alert_state(article)
    return {
        "id": str(article.id),
        "backendId": article.id,
        "code": article.code or "",
        "designation": article.designation or "",
        "categorie": article.category or raw.get("categorie") or "",
        "sousCategorie": article.sub_category or raw.get("sousCategorie") or "",
        "societe": article.society or raw.get("societe") or "",
        "magasin": store.name if store else "",
        "magasinId": str(article.store_id or ""),
        "unite": article.unit or "Pièce",
        "stock": float(article.quantity or 0),
        "prixUnitaire": float(article.unit_price or article.purchase_cost or 0),
        "seuilAlerte": seuil,
        "stockMin": minimum,
        "stockMax": maximum,
        "etat": state,
        "lastMovementDate": last_movement.isoformat() if last_movement else "",
    }


def stock_alerts(db: Session, allowed_societies: list[str] | None = None, society: str | None = None) -> dict[str, Any]:
    """Source serveur stable pour l'écran Matériel > Alertes."""
    ensure_material_schema(db)
    allowed = [s for s in (allowed_societies or []) if s]
    stmt = select(StockArticle).where(StockArticle.active == 1)
    if society:
        stmt = stmt.where(StockArticle.society == society)
    elif allowed:
        stmt = stmt.where(StockArticle.society.in_(allowed))
    articles = db.execute(stmt.order_by(StockArticle.designation.asc(), StockArticle.id.asc())).scalars().all()
    article_ids = [a.id for a in articles]
    stores_by_id = {
        store.id: store
        for store in db.execute(select(Store)).scalars().all()
    }
    last_movement_by_article: dict[int, date] = {}
    if article_ids:
        rows = db.execute(
            select(StockMovement.article_id, func.max(StockMovement.movement_date))
            .where(StockMovement.article_id.in_(article_ids))
            .group_by(StockMovement.article_id)
        ).all()
        last_movement_by_article = {int(article_id): last_date for article_id, last_date in rows if last_date}

    cutoff = date.today() - timedelta(days=90)
    ruptures: list[dict[str, Any]] = []
    alertes: list[dict[str, Any]] = []
    dormants: list[dict[str, Any]] = []
    surstock: list[dict[str, Any]] = []
    for article in articles:
        last_movement = last_movement_by_article.get(article.id)
        item = _stock_alert_item(article, stores_by_id, last_movement)
        state_code = item["etat"]["code"]
        if state_code == "rupture":
            ruptures.append(item)
        elif state_code in {"alerte", "min"}:
            alertes.append(item)
        if item["stock"] > 0 and (last_movement is None or last_movement < cutoff):
            dormants.append(item)
        if item["stockMax"] > 0 and item["stock"] > item["stockMax"]:
            surstock.append(item)

    return {
        "summary": {
            "totalArticles": len(articles),
            "ruptures": len(ruptures),
            "alertes": len(alertes),
            "dormants": len(dormants),
            "surstock": len(surstock),
            "ok": max(0, len(articles) - len(ruptures) - len(alertes)),
        },
        "ruptures": ruptures,
        "alertes": alertes,
        "dormants": dormants,
        "surstock": surstock,
    }


def inventory(db: Session, store_id: int | None = None, category: str | None = None, allowed_societies: list[str] | None = None):
    ensure_material_schema(db)
    stmt = select(StockArticle).where(StockArticle.active == 1)
    if store_id is not None:
        stmt = stmt.where(StockArticle.store_id == store_id)
    if category:
        stmt = stmt.where(StockArticle.category == category)
    allowed = [s for s in (allowed_societies or []) if s]
    if allowed:
        stmt = stmt.where(StockArticle.society.in_(allowed))
    articles = db.execute(stmt.order_by(StockArticle.id.desc())).scalars().all()
    return {
        "count": len(articles),
        "total_quantity": sum(a.quantity or 0 for a in articles),
        "articles": articles,
    }


def create_movement(db: Session, payload: MovementCreate, *, allow_employee_dotation: bool = False):
    ensure_material_schema(db)
    article = get_or_404(db, StockArticle, payload.article_id)
    movement_type = payload.movement_type
    if movement_type in DOTATION_TYPES and not allow_employee_dotation:
        raise HTTPException(status_code=422, detail="Une dotation employé doit être créée via /materiel/dotations")
    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantité invalide")
    if article.active == 0:
        raise HTTPException(status_code=422, detail="Article inactif")
    sign = 1 if movement_type in ENTRY_TYPES else -1 if movement_type in EXIT_TYPES else 0
    if sign == 0:
        raise HTTPException(status_code=422, detail="Type de mouvement inconnu")
    store_id = payload.store_id or article.store_id
    if article.store_id is None:
        raise HTTPException(status_code=422, detail="Article sans magasin: rattachement obligatoire avant mouvement")
    if store_id != article.store_id:
        raise HTTPException(status_code=422, detail="Magasin incohérent avec l'article")
    if movement_type in DOTATION_TYPES and payload.employee_id is None and not payload.site_id and not payload.structure:
        raise HTTPException(status_code=422, detail="Cible obligatoire pour une dotation")
    voucher_number = str(payload.voucher_number or "").strip()
    if voucher_number:
        existing_stmt = select(StockMovement).where(
            StockMovement.article_id == payload.article_id,
            StockMovement.movement_date == payload.movement_date,
            StockMovement.movement_type == movement_type,
            StockMovement.quantity == payload.quantity,
            StockMovement.voucher_number == voucher_number,
        )
        if movement_type in DOTATION_TYPES:
            existing_stmt = existing_stmt.where(
                StockMovement.employee_id == payload.employee_id,
                StockMovement.site_id == payload.site_id,
                StockMovement.target_type == payload.target_type,
                StockMovement.target_id == payload.target_id,
                StockMovement.structure == payload.structure,
            )
        existing = db.execute(existing_stmt.order_by(StockMovement.id.desc())).scalars().first()
        if existing:
            return existing
    if sign == -1 and (article.quantity or 0) < payload.quantity:
        raise HTTPException(status_code=422, detail="Stock insuffisant")
    article.quantity = (article.quantity or 0) + sign * payload.quantity
    data = payload.model_dump(exclude_unset=True)
    # model_dump(exclude_unset=True) retire les champs non fournis MÊME s'ils ont un
    # défaut : sans ça, une date omise par le client tombe à NULL -> crash insert.
    data.setdefault("movement_date", payload.movement_date)
    data["store_id"] = store_id
    movement = StockMovement(**data)
    if not movement.unit_price:
        movement.unit_price = article.unit_price or 0
    db.add(movement)
    db.commit()
    db.refresh(movement)
    return movement


def create_dotation(db: Session, payload: DotationCreate):
    ensure_material_schema(db)
    article = get_or_404(db, StockArticle, payload.article_id)
    target_type = str(payload.target_type or "employee").strip().lower()
    if target_type not in {"employee", "site", "structure"}:
        raise HTTPException(status_code=422, detail="Cible dotation invalide")
    employee = get_or_404(db, Employee, payload.employee_id) if target_type == "employee" and payload.employee_id else None
    site = get_or_404(db, Site, payload.site_id) if target_type == "site" and payload.site_id else None
    if target_type == "employee" and not employee:
        raise HTTPException(status_code=422, detail="Employé obligatoire pour une dotation employé")
    if target_type == "site" and not site:
        raise HTTPException(status_code=422, detail="Site obligatoire pour une dotation site")
    if target_type == "structure" and not payload.structure:
        raise HTTPException(status_code=422, detail="Structure obligatoire pour une dotation structure")
    if employee and not _same_society(article.society, employee.society):
        raise HTTPException(status_code=422, detail="Article et employé de sociétés différentes")
    target_label = payload.target_label
    if employee:
        target_label = target_label or f"{employee.last_name} {employee.first_name}".strip()
    elif site:
        target_label = target_label or site.name
    else:
        target_label = target_label or payload.structure
    unit_price = payload.unit_price if payload.unit_price is not None else article.unit_price
    useful_life = payload.useful_life_months if payload.useful_life_months is not None else article.useful_life_months
    movement = create_movement(
        db,
        MovementCreate(
            article_id=payload.article_id,
            movement_date=payload.dotation_date,
            movement_type="nouvelle_dotation",
            quantity=payload.quantity,
            unit_price=unit_price or 0,
            employee_id=employee.id if employee else None,
            site_id=site.id if site else None,
            target_type=target_type,
            target_id=employee.id if employee else site.id if site else None,
            target_label=target_label,
            structure=payload.structure,
            recipient=target_label,
            reason=payload.dotation_reason,
            voucher_number=payload.voucher_number,
            store_id=article.store_id,
            item_state=payload.item_state or article.item_state or "neuf",
            useful_life_months=useful_life or 0,
            size_breakdown=payload.size_breakdown,
        ),
        allow_employee_dotation=True,
    )
    assignment = MaterialAssignment(
        article_id=payload.article_id,
        movement_id=movement.id,
        target_type=target_type,
        employee_id=employee.id if employee else None,
        site_id=site.id if site else None,
        structure=payload.structure,
        target_label=target_label,
        quantity=payload.quantity,
        unit_price=unit_price or 0,
        dotation_date=payload.dotation_date,
        dotation_reason=payload.dotation_reason,
        voucher_number=payload.voucher_number,
        item_state=payload.item_state or article.item_state or "neuf",
        useful_life_months=useful_life or 0,
        status="attribue",
    )
    db.add(assignment)
    if employee:
        equipment = EmployeeEquipment(
            employee_id=employee.id,
            article_id=payload.article_id,
            movement_id=movement.id,
            quantity=payload.quantity,
            unit_price=unit_price or 0,
            dotation_date=payload.dotation_date,
            dotation_reason=payload.dotation_reason,
            voucher_number=payload.voucher_number,
            item_state=payload.item_state or article.item_state or "neuf",
            useful_life_months=useful_life or 0,
            status="attribue",
        )
        db.add(equipment)
        db.commit()
        db.refresh(equipment)
        return equipment
    db.commit()
    db.refresh(assignment)
    return assignment


def return_equipment(db: Session, equipment_id: int, payload: ReturnEquipmentIn):
    equipment = get_or_404(db, EmployeeEquipment, equipment_id)
    article = db.get(StockArticle, equipment.article_id)
    original_movement = db.get(StockMovement, equipment.movement_id) if equipment.movement_id else None
    if equipment.status != "attribue":
        raise HTTPException(status_code=422, detail="Equipement déjà reversé")
    equipment.status = "reverse"
    equipment.return_date = payload.return_date
    equipment.return_reason = payload.return_reason
    create_movement(
        db,
        MovementCreate(
            article_id=equipment.article_id,
            movement_date=payload.return_date,
            movement_type="retour_employe",
            quantity=equipment.quantity,
            unit_price=equipment.unit_price,
            employee_id=equipment.employee_id,
            reason=payload.return_reason,
            store_id=article.store_id if article else None,
            size_breakdown=original_movement.size_breakdown if original_movement else None,
        ),
    )
    db.commit()
    db.refresh(equipment)
    return equipment



def delete_movement(db: Session, movement_id: int):
    movement = get_or_404(db, StockMovement, movement_id)
    linked_equipment = db.execute(select(EmployeeEquipment).where(EmployeeEquipment.movement_id == movement_id)).scalar_one_or_none()
    if linked_equipment:
        raise HTTPException(status_code=422, detail="Impossible de supprimer un mouvement lié à une dotation employé")
    article = db.get(StockArticle, movement.article_id)
    if article:
        sign = 1 if movement.movement_type in ENTRY_TYPES else -1 if movement.movement_type in EXIT_TYPES else 0
        article.quantity = (article.quantity or 0) - sign * (movement.quantity or 0)
    db.delete(movement)
    db.commit()
    return {"deleted": True, "id": movement_id}

def employee_equipment(db: Session, employee_id: int):
    return list_rows(db, EmployeeEquipment, {"employee_id": employee_id})


def reversement_pending(db: Session, allowed_societies: list[str] | None = None):
    stmt = select(Employee).where(Employee.status.in_(["sortant", "archive"]))
    allowed = [s for s in (allowed_societies or []) if s]
    if allowed:
        stmt = stmt.where(Employee.society.in_(allowed))
    employees = db.execute(stmt).scalars().all()
    rows = []
    for employee in employees:
        equipment = list_rows(db, EmployeeEquipment, {"employee_id": employee.id, "status": "attribue"})
        if equipment:
            rows.append(
                {
                    "employee_id": employee.id,
                    "code": employee.code,
                    "name": f"{employee.last_name} {employee.first_name}",
                    "articles_count": len(equipment),
                    "total_value": sum((e.quantity or 0) * (e.unit_price or 0) for e in equipment),
                    "equipment": equipment,
                }
            )
    return rows
