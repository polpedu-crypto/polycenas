"""Serializers that shape in-memory run state into the response bodies
the admin UI consumes. Field names and nullability mirror the existing
frontend TypeScript contract exactly.
"""

from __future__ import annotations

from typing import Any, Dict

from .store import SimulationRunState
from .types import AgentAction, SynthesizedHedge


def serialize_run(run: SimulationRunState) -> Dict[str, Any]:
    cfg = run.config or {}
    return {
        "id": run.run_id,
        "super_cluster_id": run.super_cluster_id,
        "status": run.status,
        "agent_count": len(run.agents),
        "market_count": len(run.agents),
        "rounds": cfg.get("rounds", 5),
        "platform_type": cfg.get("platform_type", "reddit"),
        "cheap_model": cfg.get("cheap_model", "gemini-2.5-flash"),
        "premium_model": cfg.get("premium_model", "gemini-2.5-pro"),
        "synthesis_model": cfg.get("synthesis_model", "gemini-2.5-pro"),
        "canonical_graph_id": None,
        "simulation_graph_id": None,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "error_message": run.error,
        "total_llm_calls": None,
        "total_cost_usd": None,
        "created_at": run.created_at,
    }


def serialize_action(action: AgentAction) -> Dict[str, Any]:
    return {
        "id": action.id,
        "sequence": action.sequence,
        "round": action.round_number,
        "agent_market_id": action.agent_market_id,
        "agent_name": action.agent_name,
        "action_type": action.action_type,
        "parent_action_id": action.parent_action_id,
        "target_market_id": action.target_market_id,
        "title": action.title,
        "content": action.content,
        "stance": action.stance,
        "created_at": action.created_at,
    }


def serialize_hedge(hedge: SynthesizedHedge, run_id: str) -> Dict[str, Any]:
    return {
        "id": hedge.id,
        "simulation_run_id": run_id,
        "rank": hedge.rank,
        "market_a_id": hedge.market_a_id,
        "market_b_id": hedge.market_b_id,
        "market_a_title": hedge.market_a_title,
        "market_b_title": hedge.market_b_title,
        "market_a_event_title": hedge.market_a_event_title,
        "market_b_event_title": hedge.market_b_event_title,
        "market_a_cluster_id": hedge.market_a_cluster_id,
        "market_b_cluster_id": hedge.market_b_cluster_id,
        "confidence_score": hedge.confidence_score,
        "direction": hedge.direction,
        "reasoning": hedge.reasoning,
        "key_factors": hedge.key_factors,
        "co_movement_score": hedge.co_movement_score,
        "interaction_score": hedge.interaction_score,
        "contradiction_score": hedge.contradiction_score,
        "hedge_score": hedge.hedge_score,
        "correlation_r": hedge.correlation_r,
        "status": hedge.status,
        "admin_notes": hedge.admin_notes,
        "reviewed_at": hedge.reviewed_at,
        "reviewed_by": hedge.reviewed_by,
        "created_at": hedge.created_at,
        "hedge_matrix": hedge.hedge_matrix,
        "structured_payload": hedge.structured_payload,
        "matrix_verified": hedge.matrix_verified,
        "recommended_combo": hedge.recommended_combo,
        "input_snapshot": hedge.input_snapshot,
    }
