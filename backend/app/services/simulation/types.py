"""Dataclasses for the in-memory simulation pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class MarketContext:
    market_id: int
    market_title: str
    event_title: Optional[str]
    cluster_id: int
    cluster_name: Optional[str]
    volume: float


@dataclass
class AgentSpec:
    market_id: int
    cluster_id: int
    market_title: str
    event_title: Optional[str]
    cluster_name: Optional[str]
    name: str
    bio: str
    persona: str
    interests: List[str] = field(default_factory=list)


@dataclass
class AgentAction:
    id: int
    round_number: int
    sequence: int
    agent_market_id: int
    agent_name: str
    action_type: str            # post | reply | stance_change | skip
    target_market_id: Optional[int]
    parent_action_id: Optional[int]
    title: Optional[str]
    content: Optional[str]
    stance: Optional[str]       # bullish | bearish | neutral
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class RawHedgeCandidate:
    market_a_id: int
    market_b_id: int
    co_movement_score: float
    interaction_score: float
    contradiction_score: float
    hedge_score: float


@dataclass
class SynthesizedHedge:
    id: int
    rank: int
    market_a_id: int
    market_b_id: int
    market_a_title: str
    market_b_title: str
    market_a_event_title: Optional[str]
    market_b_event_title: Optional[str]
    market_a_cluster_id: Optional[int]
    market_b_cluster_id: Optional[int]
    confidence_score: float
    direction: str
    reasoning: str
    key_factors: List[str]
    co_movement_score: float
    interaction_score: float
    contradiction_score: float
    hedge_score: float
    correlation_r: Optional[float] = None
    recommended_combo: Optional[str] = None
    status: str = "pending"                  # pending | approved | rejected
    admin_notes: Optional[str] = None
    reviewed_at: Optional[str] = None
    reviewed_by: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    hedge_matrix: Optional[Dict[str, Any]] = None
    structured_payload: Optional[Dict[str, Any]] = None
    matrix_verified: Optional[bool] = None
    input_snapshot: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        d = self.__dict__.copy()
        return d


@dataclass
class SimulationConfig:
    super_cluster_id: int
    agent_cap: int = 30
    rounds: int = 5
    synthesize_top_n: int = 5
    platform_type: str = "reddit"
    cheap_model: str = "gemini-2.5-flash"
    premium_model: str = "gemini-2.5-pro"
    synthesis_model: str = "gemini-2.5-pro"
