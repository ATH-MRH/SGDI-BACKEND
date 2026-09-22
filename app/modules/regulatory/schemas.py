from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel


class SourceCreate(BaseModel):
    name: str
    reference: str | None = None
    reliability: str = "unverified"
    notes: str | None = None


class RuleCreate(BaseModel):
    rule_type: str
    society: str | None = None
    label: str


class VersionCreate(BaseModel):
    rule_id: int
    parameters: dict[str, Any]
    effective_from: date
    effective_to: date | None = None
    source_id: int | None = None
    status: str = "unverified"


class ProposalCreate(BaseModel):
    rule_id: int | None = None
    proposed_parameters: dict[str, Any]
    proposed_effective_from: date
    diff_summary: str | None = None
    source_id: int | None = None
    detected_from: str = "manual"


class ProposalApprove(BaseModel):
    mark_verified: bool = False


class ProposalReject(BaseModel):
    pass
