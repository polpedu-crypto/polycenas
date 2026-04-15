"""Heuristic pair scoring + LLM synthesis for final hedges."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from app.services.llm_service import LLMService

from .store import store
from .types import AgentAction, AgentSpec, RawHedgeCandidate, SynthesizedHedge


HEDGE_SCORE_WEIGHTS = {
    "contradiction": 0.50,
    "co_movement": 0.30,
    "interaction": 0.20,
}


def _canonical_pair(a: int, b: int) -> Optional[Tuple[int, int]]:
    if a == b:
        return None
    return (a, b) if a < b else (b, a)


def extract_raw_candidates(
    actions: List[AgentAction],
    top_n: int,
) -> List[RawHedgeCandidate]:
    if not actions:
        return []

    stance_by_agent_round: Dict[int, Dict[int, str]] = defaultdict(dict)
    interactions: Dict[Tuple[int, int], int] = defaultdict(int)

    for a in actions:
        if a.stance:
            stance_by_agent_round[a.agent_market_id][a.round_number] = a.stance
        if a.target_market_id is not None and a.action_type == "reply":
            pair = _canonical_pair(a.agent_market_id, a.target_market_id)
            if pair:
                interactions[pair] += 1

    agent_ids = sorted(stance_by_agent_round.keys())
    candidates: List[RawHedgeCandidate] = []

    for i, x in enumerate(agent_ids):
        for y in agent_ids[i + 1:]:
            x_rounds = stance_by_agent_round[x]
            y_rounds = stance_by_agent_round[y]
            shared = sorted(set(x_rounds.keys()) & set(y_rounds.keys()))
            if not shared:
                continue
            same, opp = 0, 0
            for r in shared:
                sx, sy = x_rounds[r], y_rounds[r]
                if sx == "neutral" or sy == "neutral":
                    continue
                if sx == sy:
                    same += 1
                else:
                    opp += 1
            denom = same + opp
            if denom == 0:
                continue
            co_move = same / denom
            contra = opp / denom
            inter = float(interactions.get(_canonical_pair(x, y) or (x, y), 0))
            inter_norm = min(inter, 5.0) / 5.0
            score = (
                HEDGE_SCORE_WEIGHTS["contradiction"] * contra
                + HEDGE_SCORE_WEIGHTS["co_movement"] * co_move
                + HEDGE_SCORE_WEIGHTS["interaction"] * inter_norm
            )
            candidates.append(RawHedgeCandidate(
                market_a_id=x,
                market_b_id=y,
                co_movement_score=co_move,
                interaction_score=inter,
                contradiction_score=contra,
                hedge_score=score,
            ))

    candidates.sort(key=lambda c: c.hedge_score, reverse=True)
    return candidates[:top_n]


async def synthesize_hedges(
    candidates: List[RawHedgeCandidate],
    agents_by_market_id: Dict[int, AgentSpec],
    actions: List[AgentAction],
    llm: LLMService,
    model: str,
    concurrency: int = 3,
) -> List[SynthesizedHedge]:
    if not candidates:
        return []

    sem = asyncio.Semaphore(concurrency)
    out: List[Optional[SynthesizedHedge]] = [None] * len(candidates)

    async def _one(rank: int, c: RawHedgeCandidate):
        async with sem:
            a = agents_by_market_id.get(c.market_a_id)
            b = agents_by_market_id.get(c.market_b_id)
            if not a or not b:
                return
            exchanges = _sample_exchanges(actions, c.market_a_id, c.market_b_id)
            resp = await llm.synthesize_hedge(
                market_a={
                    "id": a.market_id,
                    "title": a.market_title,
                    "cluster_name": a.cluster_name,
                },
                market_b={
                    "id": b.market_id,
                    "title": b.market_title,
                    "cluster_name": b.cluster_name,
                },
                scores={
                    "co_movement": c.co_movement_score,
                    "contradiction": c.contradiction_score,
                    "interaction": c.interaction_score,
                    "hedge_score": c.hedge_score,
                },
                sample_exchanges=exchanges,
                model=model,
            )
            resp = resp or {}
            out[rank - 1] = SynthesizedHedge(
                id=store.next_hedge_id(),
                rank=rank,
                market_a_id=a.market_id,
                market_b_id=b.market_id,
                market_a_title=a.market_title,
                market_b_title=b.market_title,
                market_a_event_title=a.event_title,
                market_b_event_title=b.event_title,
                market_a_cluster_id=a.cluster_id,
                market_b_cluster_id=b.cluster_id,
                confidence_score=_clamp_num(resp.get("confidence_score"), 0, 100, 50.0),
                direction=_pick_direction(resp.get("direction"), c),
                reasoning=str(resp.get("reasoning") or "No reasoning generated.")[:3000],
                key_factors=[str(x)[:120] for x in (resp.get("key_factors") or [])][:6],
                co_movement_score=c.co_movement_score,
                interaction_score=c.interaction_score,
                contradiction_score=c.contradiction_score,
                hedge_score=c.hedge_score,
                recommended_combo=(str(resp.get("recommended_combo") or "")[:80] or None),
            )

    await asyncio.gather(*[_one(i + 1, c) for i, c in enumerate(candidates)])
    return [h for h in out if h is not None]


def _sample_exchanges(actions: List[AgentAction], a: int, b: int, limit: int = 8) -> List[str]:
    out: List[str] = []
    for act in actions:
        if act.agent_market_id not in (a, b):
            continue
        if not (act.content or act.title):
            continue
        out.append(
            f"r{act.round_number} {act.agent_name} [{act.stance or '-'}] "
            f"{act.action_type}: {(act.title or act.content or '')[:140]}"
        )
        if len(out) >= limit:
            break
    return out


def _clamp_num(v, lo: float, hi: float, default: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, x))


def _pick_direction(v, c: RawHedgeCandidate) -> str:
    if isinstance(v, str):
        v = v.strip().lower()
        if v in ("positive", "negative"):
            return v
    return "negative" if c.contradiction_score >= c.co_movement_score else "positive"
