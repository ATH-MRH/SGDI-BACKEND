from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from enum import Enum
from typing import Any


class ScopeKind(str, Enum):
    LIMITED = "limited"
    GLOBAL = "global"
    NONE = "none"


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
    has_site_scope = bool(getattr(user, "authorized_sites", None))
    return SocietyScope(ScopeKind.LIMITED if allowed or has_site_scope else ScopeKind.NONE, allowed)
