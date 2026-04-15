"""Serializers that shape in-memory run state into the response bodies
the admin UI consumes. Field names and nullability mirror
`admin-panel/lib/api.ts` exactly.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict

from .store import SimulationRunState
from .types import AgentAction, SynthesizedHedge


def serialize_run_summary(run: SimulationRunState) -> Dict[str, Any]:
    return {
        "run_id": run.run_id,
        "super_cluster_id": run.super_cluster_id,
        "status": run.status,
        "current_step": run.current_step,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "agent_count": len(run.agents),
        "action_count": len(run.actions),
        "hedge_count": len(run.hedges),
    }


def serialize_run_detail(run: SimulationRunState) -> Dict[str, Any]:
    return {
        **serialize_run_summary(run),
        "rounds_completed": run.rounds_completed,
        "error": run.error,
        "config": run.config,
    }


def serialize_agent(agent) -> Dict[str, Any]:
    return asdict(agent)


def serialize_action(action: AgentAction) -> Dict[str, Any]:
    return {
        "id": action.id,
        "round_number": action.round_number,
        "sequence": action.sequence,
        "agent_market_id": action.agent_market_id,
        "agent_name": action.agent_name,
        "action_type": action.action_type,
        "target_market_id": action.target_market_id,
        "parent_action_id": action.parent_action_id,
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
