from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from enum import Enum
from typing import Any


class ScopeKind(str, Enum):
    LIMITED = "limited"
    GLOBAL = "global"
    NONE = "none"


class SocietyScopeError(PermissionError):
    """Raised when a society-scoped operation has no valid explicit scope."""


def society_key(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or "").strip())
    return " ".join("".join(c for c in text if unicodedata.category(c) != "Mn").upper().split())


@dataclass(frozen=True)
class SocietyScope:
    kind: ScopeKind
    societies: frozenset[str]

    def allows(self, society: Any) -> bool:
        key = society_key(society)
        return self.kind is ScopeKind.GLOBAL or (bool(key) and key in self.societies)


def society_scope(user: Any | None) -> SocietyScope:
    if user is None:
        return SocietyScope(ScopeKind.NONE, frozenset())
    if getattr(user, "global_society_access", False) is True:
        return SocietyScope(ScopeKind.GLOBAL, frozenset())
    values = getattr(user, "authorized_societies", None)
    allowed = frozenset(society_key(v) for v in values or [] if society_key(v))
    return SocietyScope(ScopeKind.LIMITED if allowed else ScopeKind.NONE, allowed)


def authorized_society_values(user: Any | None) -> list[str]:
    """Return the explicit society labels, de-duplicated by their canonical key."""
    values = getattr(user, "authorized_societies", None) if user is not None else None
    if not isinstance(values, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        label = str(value or "").strip()
        key = society_key(label)
        if label and key and key not in seen:
            result.append(label)
            seen.add(key)
    return result


def effective_society_values(user: Any | None, requested: Any = None) -> list[str] | None:
    """Resolve an optional requested society against the central explicit scope.

    ``None`` means an explicitly global scope, never a missing/empty scope.
    Limited scopes return the exact authorized labels. A spelling variant of an
    authorized label is accepted but is mapped back to that authorized label.
    """
    scope = society_scope(user)
    if scope.kind is ScopeKind.NONE:
        raise SocietyScopeError("Aucun périmètre société explicite")

    requested_label = str(requested or "").strip()
    if scope.kind is ScopeKind.GLOBAL:
        return [requested_label] if requested_label else None

    allowed = authorized_society_values(user)
    if not requested_label:
        return allowed
    requested_key = society_key(requested_label)
    for label in allowed:
        if society_key(label) == requested_key:
            return [label]
    raise SocietyScopeError("Société hors du périmètre autorisé")
