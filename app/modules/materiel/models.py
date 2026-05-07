from datetime import date

from sqlalchemy import Date, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Store(Base, TimestampMixin):
    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    code: Mapped[str | None] = mapped_column(String(40), unique=True)
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    address: Mapped[str | None] = mapped_column(Text)
    manager_name: Mapped[str | None] = mapped_column(String(150))
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(150))
    icon_path: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)


class Supplier(Base, TimestampMixin):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    contact_name: Mapped[str | None] = mapped_column(String(150))
    rc: Mapped[str | None] = mapped_column(String(80))
    nif: Mapped[str | None] = mapped_column(String(80))
    nis: Mapped[str | None] = mapped_column(String(80))
    ai: Mapped[str | None] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(150))
    address: Mapped[str | None] = mapped_column(Text)
    products: Mapped[str | None] = mapped_column(Text)
    payment_terms: Mapped[str | None] = mapped_column(String(150))
    rating: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text)


class StockArticle(Base, TimestampMixin):
    __tablename__ = "stock_articles"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    designation: Mapped[str] = mapped_column(String(200), index=True)
    category: Mapped[str | None] = mapped_column(String(120), index=True)
    sub_category: Mapped[str | None] = mapped_column(String(120))
    society: Mapped[str | None] = mapped_column(String(150), index=True)
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"), index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id", ondelete="SET NULL"), index=True)
    unit: Mapped[str] = mapped_column(String(40), default="Pièce")
    quantity: Mapped[float] = mapped_column(Float, default=0)
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    min_quantity: Mapped[float] = mapped_column(Float, default=0)
    color: Mapped[str | None] = mapped_column(String(80))
    size: Mapped[str | None] = mapped_column(String(80))
    shoe_size: Mapped[str | None] = mapped_column(String(80))
    shirt_size: Mapped[str | None] = mapped_column(String(80))
    pants_size: Mapped[str | None] = mapped_column(String(80))
    barcode: Mapped[str | None] = mapped_column(String(120))
    brand: Mapped[str | None] = mapped_column(String(120))
    model: Mapped[str | None] = mapped_column(String(120))
    attributes: Mapped[dict | None] = mapped_column(JSON)
    active: Mapped[int] = mapped_column(Integer, default=1)


class StockMovement(Base, TimestampMixin):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("stock_articles.id", ondelete="CASCADE"), index=True)
    movement_date: Mapped[date] = mapped_column(Date, index=True)
    movement_type: Mapped[str] = mapped_column(String(80), index=True)
    quantity: Mapped[float] = mapped_column(Float)
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"), index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id", ondelete="SET NULL"), index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    recipient: Mapped[str | None] = mapped_column(String(180))
    reason: Mapped[str | None] = mapped_column(Text)
    renewal_reason: Mapped[str | None] = mapped_column(Text)
    voucher_number: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    size_breakdown: Mapped[dict | None] = mapped_column(JSON)


class EmployeeEquipment(Base, TimestampMixin):
    __tablename__ = "employee_equipment"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("stock_articles.id", ondelete="CASCADE"), index=True)
    movement_id: Mapped[int | None] = mapped_column(ForeignKey("stock_movements.id", ondelete="SET NULL"))
    quantity: Mapped[float] = mapped_column(Float, default=1)
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    dotation_date: Mapped[date] = mapped_column(Date)
    dotation_reason: Mapped[str | None] = mapped_column(Text)
    voucher_number: Mapped[str | None] = mapped_column(String(120))
    return_date: Mapped[date | None] = mapped_column(Date)
    return_reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="attribue", index=True)

