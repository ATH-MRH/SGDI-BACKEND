from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


class StoreBase(BaseModel):
    name: str
    code: str | None = None
    society: str | None = None
    address: str | None = None
    manager_name: str | None = None
    phone: str | None = None
    email: str | None = None
    icon_path: str | None = None
    notes: str | None = None
    config: dict[str, Any] | None = None


class StoreCreate(StoreBase):
    pass


class StoreOut(StoreBase):
    id: int

    model_config = {"from_attributes": True}


class SupplierBase(BaseModel):
    name: str
    society: str | None = None
    contact_name: str | None = None
    rc: str | None = None
    nif: str | None = None
    nis: str | None = None
    ai: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    products: str | None = None
    payment_terms: str | None = None
    rating: int = 0
    notes: str | None = None


class SupplierCreate(SupplierBase):
    pass


class SupplierOut(SupplierBase):
    id: int

    model_config = {"from_attributes": True}


class ArticleBase(BaseModel):
    code: str
    designation: str
    category: str | None = None
    sub_category: str | None = None
    society: str | None = None
    store_id: int | None = None
    supplier_id: int | None = None
    unit: str = "Pièce"
    quantity: float = 0
    unit_price: float = 0
    min_quantity: float = 0
    color: str | None = None
    size: str | None = None
    shoe_size: str | None = None
    shirt_size: str | None = None
    pants_size: str | None = None
    barcode: str | None = None
    brand: str | None = None
    model: str | None = None
    attributes: dict[str, Any] | None = None
    active: int = 1


class ArticleCreate(ArticleBase):
    pass


class ArticleOut(ArticleBase):
    id: int

    model_config = {"from_attributes": True}


class MovementCreate(BaseModel):
    article_id: int
    movement_date: date = Field(default_factory=date.today)
    movement_type: str
    quantity: float
    unit_price: float = 0
    store_id: int | None = None
    supplier_id: int | None = None
    employee_id: int | None = None
    recipient: str | None = None
    reason: str | None = None
    renewal_reason: str | None = None
    voucher_number: str | None = None
    notes: str | None = None
    size_breakdown: dict[str, Any] | None = None


class MovementOut(MovementCreate):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class DotationCreate(BaseModel):
    employee_id: int
    article_id: int
    quantity: float = 1
    dotation_date: date = Field(default_factory=date.today)
    dotation_reason: str | None = "Nouvelle dotation"
    voucher_number: str | None = None
    unit_price: float | None = None


class EquipmentOut(BaseModel):
    id: int
    employee_id: int
    article_id: int
    quantity: float
    unit_price: float
    dotation_date: date
    dotation_reason: str | None = None
    voucher_number: str | None = None
    return_date: date | None = None
    return_reason: str | None = None
    status: str

    model_config = {"from_attributes": True}


class ReturnEquipmentIn(BaseModel):
    return_date: date = Field(default_factory=date.today)
    return_reason: str | None = None
