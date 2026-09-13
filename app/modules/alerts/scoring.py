"""Scoring déterministe v1. Aucun modèle, aucune IA, aucune inférence : chaque
facteur est une fonction pure et documentée d'une valeur observée. La formule
n'est jamais cachée — ``factors`` liste exactement ce qui a été additionné.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

SEVERITY_CRITICAL = "critical"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"


@dataclass(frozen=True)
class ScoreFactor:
    key: str
    label: str
    value: Any
    weight: int
    contribution: int


@dataclass(frozen=True)
class ScoreResult:
    score: int
    severity: str
    confidence: int
    factors: list[ScoreFactor] = field(default_factory=list)
    explanation: str = ""

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "severity": self.severity,
            "confidence": self.confidence,
            "factors": [
                {
                    "key": f.key,
                    "label": f.label,
                    "value": f.value,
                    "weight": f.weight,
                    "contribution": f.contribution,
                }
                for f in self.factors
            ],
            "explanation": self.explanation,
        }


def severity_for_score(score: int) -> str:
    if score >= 80:
        return SEVERITY_CRITICAL
    if score >= 50:
        return SEVERITY_WARNING
    return SEVERITY_INFO


def _band_contribution(value: int, bands: tuple[tuple[int, int], ...]) -> int:
    """``bands`` est une suite (seuil, points) triée du seuil le plus strict au
    plus large. Retourne les points du premier seuil atteint (value <= seuil),
    0 si aucun seuil n'est atteint. Bandes explicites, pas de formule continue
    opaque. Utilisé quand une valeur PLUS PETITE est plus urgente (ex. jours
    restants avant échéance)."""
    for threshold, points in bands:
        if value <= threshold:
            return points
    return 0


def _band_contribution_at_least(value: int, bands: tuple[tuple[int, int], ...]) -> int:
    """Variante de ``_band_contribution`` pour une valeur PLUS GRANDE = plus
    urgente (ex. minutes écoulées sans sortie). ``bands`` triée du seuil le
    plus élevé au plus bas ; retourne les points du premier seuil atteint
    (value >= seuil), 0 si aucun n'est atteint."""
    for threshold, points in bands:
        if value >= threshold:
            return points
    return 0


def score_contract_expiring(*, days_remaining: int, employee_status: str) -> ScoreResult:
    # Bandes figées avec les seuils du cahier des charges (<=30/<=15/<=7/<=0).
    proximity_points = _band_contribution(
        days_remaining,
        bands=((0, 80), (7, 60), (15, 40), (30, 20)),
    )
    factors = [
        ScoreFactor(
            key="days_remaining_band",
            label=f"Contrat expire dans {days_remaining} jour(s)",
            value=days_remaining,
            weight=80,
            contribution=proximity_points,
        ),
        ScoreFactor(
            key="employee_active_status",
            label=f"Statut employé : {employee_status}",
            value=employee_status,
            weight=10,
            contribution=10,
        ),
    ]
    score = min(100, sum(f.contribution for f in factors))
    severity = severity_for_score(score)
    explanation = f"Score {score}/100 : proximité de l'échéance (+{proximity_points}), statut employé actif (+10)."
    return ScoreResult(score=score, severity=severity, confidence=100, factors=factors, explanation=explanation)


def score_missing_checkout(*, elapsed_minutes: int, threshold_minutes: int) -> ScoreResult:
    # Bandes exprimées en multiples explicites du seuil configuré (ex. 1x, 1.5x,
    # 2x, 3x le seuil) : plus le dépassement est important, plus le score monte.
    over_threshold_points = _band_contribution_at_least(
        elapsed_minutes,
        bands=(
            (threshold_minutes * 3, 80),
            (threshold_minutes * 2, 60),
            (int(threshold_minutes * 1.5), 40),
            (threshold_minutes, 20),
        ),
    )
    factors = [
        ScoreFactor(
            key="elapsed_minutes_band",
            label=f"Sans sortie depuis {elapsed_minutes} minute(s) (seuil {threshold_minutes})",
            value=elapsed_minutes,
            weight=80,
            contribution=over_threshold_points,
        ),
        ScoreFactor(
            key="arrival_recorded",
            label="Arrivée enregistrée",
            value=True,
            weight=10,
            contribution=10,
        ),
    ]
    score = min(100, sum(f.contribution for f in factors))
    severity = severity_for_score(score)
    explanation = f"Score {score}/100 : dépassement du seuil de sortie (+{over_threshold_points}), arrivée confirmée (+10)."
    return ScoreResult(score=score, severity=severity, confidence=100, factors=factors, explanation=explanation)
