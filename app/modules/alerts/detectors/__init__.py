"""Interface commune des détecteurs 0.6-A.

Un détecteur est une fonction PURE côté écriture : il lit la base (DRH/OPS)
et retourne une liste de ``DetectorFinding`` indépendants de toute
persistance côté alertes. C'est le service (voir ../service.py) qui
transforme ensuite chaque finding en Alert/AlertEvidence, gère la
déduplication et l'historique. Cela permet de tester un détecteur seul,
sans jamais écrire dans les tables alerts_*.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DetectorFinding:
    rule_key: str
    source_type: str
    source_id: str
    society: str
    site_id: int | None
    title: str
    summary: str
    evidence: dict = field(default_factory=dict)
    # Paramètres transmis tels quels aux fonctions de app.modules.alerts.scoring
    # (ex. {"days_remaining": 4, "employee_status": "actif"}).
    score_context: dict = field(default_factory=dict)
    # Dimensions métier utilisées pour construire le dedup_key déterministe
    # (voir service.build_dedup_key) — PAS le dedup_key lui-même : le service
    # reste seul responsable de son format exact.
    dedup_dimensions: dict = field(default_factory=dict)
