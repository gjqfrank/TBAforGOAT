"""Pydantic validation models for upstream API responses.

Used by background workers to validate data BEFORE it touches Supabase.
If an upstream API returns garbage (error strings, mangled JSON, wrong
types), validation rejects the payload and the worker logs a warning
instead of corrupting the database.

Design: models are deliberately loose — Optional fields, permissive types —
because upstream APIs evolve.  We validate *shape*, not *business rules*.
"""
from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, field_validator


# ═══════════════════════════════════════════════════════════
# FRC / TBA Event Metadata
# ═══════════════════════════════════════════════════════════

class TBAEvent(BaseModel):
    key: str
    name: str = ""
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    event_type: int = -1
    city: Optional[str] = None
    state_prov: Optional[str] = None
    country: Optional[str] = None

    class Config:
        extra = "allow"


class TBATeam(BaseModel):
    key: str
    team_number: int
    nickname: Optional[str] = None
    school_name: Optional[str] = None
    city: Optional[str] = None
    state_prov: Optional[str] = None
    country: Optional[str] = None
    rookie_year: Optional[int] = None

    class Config:
        extra = "allow"


# ═══════════════════════════════════════════════════════════
# FRC Events API Match
# ═══════════════════════════════════════════════════════════

class FRCMatchTeam(BaseModel):
    teamNumber: int
    station: Optional[str] = None

    class Config:
        extra = "allow"


class FRCMatch(BaseModel):
    matchNumber: int = 0
    tournamentLevel: Optional[str] = None
    scoreRedFinal: Optional[int] = None
    scoreBlueFinal: Optional[int] = None
    actualStartTime: Optional[str] = None
    startTime: Optional[str] = None
    teams: list[FRCMatchTeam] = []

    class Config:
        extra = "allow"

    @field_validator("scoreRedFinal", "scoreBlueFinal", mode="before")
    @classmethod
    def coerce_scores(cls, v):
        """Reject non-numeric scores (e.g. error strings)."""
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return int(v)
        return None  # reject garbage


class FRCRanking(BaseModel):
    teamNumber: int
    rank: Optional[int] = None
    wins: int = 0
    losses: int = 0
    ties: int = 0
    matchesPlayed: int = 0
    dq: int = 0
    qualAverage: Optional[float] = None
    sortOrders: Optional[list] = None

    class Config:
        extra = "allow"


# ═══════════════════════════════════════════════════════════
# Batch validators — validate + filter a list, log rejects
# ═══════════════════════════════════════════════════════════

import logging

_log = logging.getLogger(__name__)


def validate_list(model_cls: type[BaseModel], items: Any, label: str = "") -> list:
    """Validate a list of dicts against *model_cls*.

    Returns only the items that pass validation.  Invalid items are
    logged and skipped — they never reach Supabase.
    """
    if not isinstance(items, list):
        _log.warning("Expected list for %s, got %s — rejecting entire payload",
                      label, type(items).__name__)
        return []

    valid = []
    for i, raw in enumerate(items):
        if not isinstance(raw, dict):
            _log.warning("[%s] Item %d is %s, not dict — skipping",
                          label, i, type(raw).__name__)
            continue
        try:
            obj = model_cls.model_validate(raw)
            valid.append(obj)
        except Exception as e:
            _log.warning("[%s] Item %d failed validation: %s", label, i, e)
    return valid
