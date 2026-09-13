from datetime import datetime

from pydantic import BaseModel


class AlertEvidenceOut(BaseModel):
    id: int
    evidence_type: str
    evidence_key: str
    evidence_value_json: dict | list | str | int | float | bool | None
    observed_at: datetime

    model_config = {"from_attributes": True}


class AlertHistoryOut(BaseModel):
    id: int
    action: str
    previous_status: str | None
    new_status: str | None
    actor_user_id: int | None
    reason: str | None
    metadata_json: dict | None
    correlation_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertOut(BaseModel):
    id: int
    rule_key: str
    rule_version: int
    source_type: str
    source_id: str
    society: str
    site_id: int | None
    status: str
    severity: str
    score: int
    confidence: int
    title: str
    summary: str | None
    first_detected_at: datetime
    last_detected_at: datetime
    occurrence_count: int
    assigned_user_id: int | None
    acknowledged_at: datetime | None
    treated_at: datetime | None
    ignored_at: datetime | None
    ignore_reason: str | None
    deferred_until: datetime | None
    dedup_key: str

    model_config = {"from_attributes": True}


class AlertDetailOut(AlertOut):
    evidence: list[AlertEvidenceOut]
    history: list[AlertHistoryOut]
    score_factors: list[dict] | None = None
    explanation: str | None = None


class AlertPage(BaseModel):
    items: list[AlertOut]
    total: int
    page: int
    page_size: int
    pages: int


class AlertStatsOut(BaseModel):
    total_open: int
    critical: int
    unacknowledged: int
    assigned_to_me: int


class AlertAssignIn(BaseModel):
    user_id: int | None = None


class AlertDeferIn(BaseModel):
    deferred_until: datetime


class AlertIgnoreIn(BaseModel):
    reason: str
