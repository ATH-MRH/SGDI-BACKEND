from typing import Any

from pydantic import BaseModel, Field


class CollectionOut(BaseModel):
    name: str
    data: list[Any] | dict[str, Any]


class CollectionReplace(BaseModel):
    data: list[Any] | dict[str, Any]


class ItemPayload(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class DbReplace(BaseModel):
    data: dict[str, list[Any] | dict[str, Any]]


class LegacyActionPayload(BaseModel):
    collection: str | None = None
    item_id: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
