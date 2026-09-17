from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.pagination import paginate_statement
from app.db.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.auth.routes import require_admin
from app.modules.commercial import service
from app.modules.commercial.models import Client
from app.modules.irongs.models import Position
from app.modules.ops.models import Site
from app.modules.commercial.schemas import (
    ClientCreate,
    ClientOut,
    ClientUpdate,
    CommercialDcAccessRuleIn,
    CommercialDcAccessRuleOut,
    CommercialDcSettingsOut,
    CommercialDcSettingsUpdate,
    DcContractUpdate,
)


router = APIRouter(dependencies=[Depends(current_user)])


# Sous-domaines déjà utilisés par des modules internes ou réservés — un client ne peut
# pas se voir attribuer l'un de ces slugs pour son portail dédié.
RESERVED_PORTAL_SLUGS = {
    "drh", "rh", "ops", "materiel", "finances", "comptabilite", "compta", "facturation", "fac",
    "commercial", "dc", "agenda", "paie", "conges", "recrute", "pointage", "pointeur",
    "portail-rh", "cheque", "atlas", "www", "sgdi", "administrateur", "general",
    "sup", "superviseur", "supervisor", "finance", "secretariat", "admin",
}


def _validate_portal_slug(db: Session, slug: str | None, exclude_client_id: int | None = None) -> None:
    if not slug:
        return
    normalized = slug.strip().lower()
    if normalized != slug.strip():
        raise HTTPException(status_code=400, detail="Le sous-domaine doit être en minuscules")
    if not normalized or not all(c.isalnum() or c == "-" for c in normalized):
        raise HTTPException(status_code=400, detail="Sous-domaine invalide (lettres, chiffres, tirets uniquement)")
    if normalized in RESERVED_PORTAL_SLUGS:
        raise HTTPException(status_code=409, detail="Ce sous-domaine est réservé")
    stmt = select(Client).where(Client.portal_slug == normalized)
    if exclude_client_id:
        stmt = stmt.where(Client.id != exclude_client_id)
    if db.execute(stmt).scalars().first():
        raise HTTPException(status_code=409, detail="Ce sous-domaine est déjà utilisé par un autre client")


def _allowed_societies(user: User) -> list[str]:
    values = user.authorized_societies if isinstance(user.authorized_societies, list) else []
    return [str(v).strip() for v in values if str(v).strip()]


def _ensure_society_allowed(user: User, society: str | None) -> None:
    allowed = _allowed_societies(user)
    if allowed and (not society or society not in allowed):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Société non autorisée")


def _effective_society_filter(user: User, requested: str | None) -> str | None:
    allowed = _allowed_societies(user)
    if requested:
        _ensure_society_allowed(user, requested)
        return requested
    if len(allowed) == 1:
        return allowed[0]
    return None


def _ensure_client_allowed(db: Session, user: User, client_id: int) -> Client:
    row = db.get(Client, client_id)
    if not row:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    _ensure_society_allowed(user, row.society)
    return row


@router.get("/clients/page")
def clients_page(society: str | None = None, status: str | None = None, q: str | None = None, page: int = 1, page_size: int = 25, db: Session = Depends(get_db), user: User = Depends(current_user)):
    effective_society = _effective_society_filter(user, society)
    allowed = _allowed_societies(user)
    stmt = select(Client)
    if effective_society:
        stmt = stmt.where(Client.society == effective_society)
    elif allowed:
        stmt = stmt.where(Client.society.in_(allowed))
    if status:
        stmt = stmt.where(Client.status == status)
    result = paginate_statement(db, stmt, model=Client, search_fields=[Client.name, Client.legal_name, Client.society, Client.structure, Client.contact_name, Client.phone, Client.email, Client.services], q=q, page=page, page_size=page_size)
    result["items"] = [ClientOut.model_validate(item) for item in result["items"]]
    return result


@router.get("/clients", response_model=list[ClientOut])
def clients(society: str | None = None, status: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    effective_society = _effective_society_filter(user, society)
    rows = service.list_rows(db, Client, {"society": effective_society, "status": status})
    allowed = _allowed_societies(user)
    if allowed and not effective_society:
        rows = [row for row in rows if row.society in allowed]
    return rows


@router.post("/clients", response_model=ClientOut)
def create_client(payload: ClientCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_society_allowed(user, payload.society)
    _validate_portal_slug(db, payload.portal_slug)
    return service.create_row(db, Client, payload)


@router.put("/clients/{client_id}", response_model=ClientOut)
def update_client(client_id: int, payload: ClientUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    existing = _ensure_client_allowed(db, user, client_id)
    _ensure_society_allowed(user, payload.society or existing.society)
    if payload.portal_slug is not None:
        _validate_portal_slug(db, payload.portal_slug, exclude_client_id=client_id)
    return service.update_row(db, Client, client_id, payload)


@router.delete("/clients/{client_id}")
def delete_client(client_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_client_allowed(db, user, client_id)
    return service.delete_row(db, Client, client_id)


# ── Module Commercial autonome (dc.irongs.com) : accès et réglages ────────────────────
# Endpoints dédiés, distincts de /clients ci-dessus : ils gèrent qui peut entrer dans
# commercial.html et ses réglages métier, pas les données commerciales elles-mêmes.

@router.get("/dc/settings", response_model=CommercialDcSettingsOut)
def dc_settings(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return service.dc_settings_out(db, user)


@router.put("/dc/settings", response_model=CommercialDcSettingsOut)
def update_dc_settings(payload: CommercialDcSettingsUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    return service.update_dc_settings(db, payload)


@router.get("/dc/access-rules", response_model=list[CommercialDcAccessRuleOut])
def dc_access_rules(db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    return service.list_dc_access_rules(db)


@router.put("/dc/access-rules", response_model=list[CommercialDcAccessRuleOut])
def set_dc_access_rule(payload: CommercialDcAccessRuleIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require_admin(user)
    return service.set_dc_access_rule(db, payload)


@router.put("/dc/clients/{client_id}/contract")
def update_dc_client_contract(
    client_id: int,
    payload: DcContractUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Enregistre le référentiel contractuel DC et publie sa projection vers OPS.

    DC reste propriétaire de ces valeurs. OPS reçoit une copie marquée en lecture seule,
    utilisée par le pointage, la DRH, la facturation, la DG et le SG.
    """
    if not service.dc_access_allowed(db, user):
        raise HTTPException(status_code=403, detail="Accès au référentiel contractuel DC refusé")
    client = _ensure_client_allowed(db, user, client_id)
    previous = client.data if isinstance(client.data, dict) else {}
    version = int(previous.get("dc_contract_version") or 0) + 1

    # Résolution du référentiel canonique — toujours, brouillon inclus (un brouillon
    # doit aussi référencer position_id, jamais un libellé libre ; voir écran DC).
    # Seule la VALIDATION STRICTE (poste manquant/inactif/ambigu -> refus) est
    # réservée à la publication (status == "valide") : un brouillon peut rester
    # incomplet, mais jamais halluciner un poste par un identifiant qui n'existe pas.
    all_position_ids = {req.position_id for item in payload.sites for req in item.requirements}
    positions_by_id = {
        p.id: p for p in db.execute(select(Position).where(Position.id.in_(all_position_ids))).scalars().all()
    } if all_position_ids else {}

    def _canonical_requirements(item) -> list[dict]:
        return [
            {
                "position_id": req.position_id,
                "position_code": None,  # le référentiel positions n'a pas encore de code distinct de l'ID
                "position_label": positions_by_id[req.position_id].name if req.position_id in positions_by_id else None,
                "quantity": req.quantity,
            }
            for req in item.requirements
        ]

    canonical_sites: list[dict] = [
        {
            "key": item.key, "name": item.name, "address": item.address,
            "first_shift_time": item.first_shift_time,
            "rotation_start_date": item.rotation_start_date.isoformat(),
            "requirements": _canonical_requirements(item),
        }
        for item in payload.sites
    ]
    client.data = {
        **previous,
        "dc_contract_status": payload.status,
        "dc_contract_version": version,
        "dc_contract_sites": canonical_sites,
        "dc_contract_source": "dc.irongs.com",
        "dc_contract_updated_by": user.username,
    }

    published_sites: list[int] = []
    if payload.status == "valide":
        if not payload.sites:
            raise HTTPException(status_code=422, detail="Un contrat validé doit comporter au moins un site")
        if not str(client.society or "").strip():
            raise HTTPException(status_code=422, detail="Mapping client/site incomplet : société du client non renseignée")

        # Validation stricte AVANT toute écriture de site : un contrat incomplet ne
        # doit jamais devenir partiellement source contractuelle.
        for item in payload.sites:
            for req in item.requirements:
                position = positions_by_id.get(req.position_id)
                if not position:
                    raise HTTPException(status_code=422, detail=f"Poste inconnu (position_id={req.position_id}) — sélectionnez un poste du référentiel Administration → Postes/Fonctions")
                if not position.active:
                    raise HTTPException(status_code=422, detail=f"Poste inactif : « {position.name} » ne peut plus être utilisé dans un nouveau contrat")
                if position.society and client.society and position.society != client.society:
                    raise HTTPException(status_code=422, detail=f"Mapping ambigu : le poste « {position.name} » appartient à une autre société ({position.society}) que le client ({client.society})")

        for item in payload.sites:
            client_sites = db.execute(select(Site).where(Site.client_id == client.id)).scalars().all()
            row = next((site for site in client_sites if isinstance(site.equipment_plan, dict) and site.equipment_plan.get("dcContractSiteKey") == item.key), None)
            if not row:
                # Mapping ambigu : cette clé de liaison est déjà utilisée par un site
                # d'un AUTRE client — refuser plutôt que de créer une correspondance
                # incorrecte (le site requis ne pourrait alors pas être relié proprement).
                foreign_sites = db.execute(select(Site).where(Site.client_id != client.id)).scalars().all()
                collision = next(
                    (site for site in foreign_sites if isinstance(site.equipment_plan, dict) and site.equipment_plan.get("dcContractSiteKey") == item.key),
                    None,
                )
                if collision:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Mapping ambigu : la clé de site « {item.key} » est déjà rattachée au client #{collision.client_id} (site « {collision.name} »)",
                    )
                row = Site(name=item.name, client_id=client.id, active=1)
                db.add(row)

            # Miroir OPS (historique/lecture seule uniquement, jamais relu comme
            # contractuel — voir portal.routes.attendance_staffing) : construit à
            # partir des libellés canoniques déjà résolus ci-dessus, jamais du texte
            # saisi (identité métier = position_id, le libellé n'est qu'un instantané).
            site_canonical = next(s for s in canonical_sites if s["key"] == item.key)
            legacy_mirror = {r["position_label"]: r["quantity"] for r in site_canonical["requirements"]}
            per_shift = sum(legacy_mirror.values())
            group_positions = {code: dict(legacy_mirror) for code in "ABCD"}
            existing_plan = row.equipment_plan if isinstance(row.equipment_plan, dict) else {}
            row.name = item.name
            row.client_id = client.id
            row.client_name = client.name
            row.address = item.address
            row.rotation_system = row.rotation_system or "3x8"
            row.contractual_staff = per_shift * 4
            row.groups_count = 4
            row.active = 1
            row.equipment_plan = {
                **existing_plan,
                "societe": client.society,
                "positionQuotas": {name: count * 4 for name, count in legacy_mirror.items()},
                "groupQuotas": {code: per_shift for code in "ABCD"},
                "groupPositionQuotas": group_positions,
                "clientPortalRotation": existing_plan.get("clientPortalRotation") or {
                    "system": "3x8", "first_shift_time": item.first_shift_time,
                    "start_date": item.rotation_start_date.isoformat(), "horizon_weeks": 52,
                },
                "contractualSource": "dc.irongs.com",
                "contractualReadOnly": True,
                "dcContractClientId": client.id,
                "dcContractSiteKey": item.key,
                "dcContractVersion": version,
            }
            db.flush()
            published_sites.append(row.id)
    db.commit()
    db.refresh(client)
    return {
        "client_id": client.id,
        "status": payload.status,
        "version": version,
        "sites_count": len(payload.sites),
        "published_site_ids": published_sites,
        "source": "dc.irongs.com",
    }
