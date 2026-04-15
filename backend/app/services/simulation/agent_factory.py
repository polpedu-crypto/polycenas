"""Market selection and persona generation for the simulation."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.db.prisma_client import prisma
from app.services.llm_service import LLMService

from .types import AgentSpec, MarketContext


async def fetch_contexts(super_cluster_id: int) -> List[MarketContext]:
    """Read every market in the supercluster with its cluster metadata."""
    clusters = await prisma.cluster.find_many(
        where={"superClusterId": super_cluster_id},
        include={"clusterMarkets": {"include": {"market": True}}},
    )
    contexts: List[MarketContext] = []
    for c in clusters:
        for cm in c.clusterMarkets or []:
            m = cm.market
            if not m:
                continue
            contexts.append(
                MarketContext(
                    market_id=m.id,
                    market_title=m.title,
                    event_title=m.eventTitle,
                    cluster_id=c.id,
                    cluster_name=c.name,
                    volume=float(m.volume or 0),
                )
            )
    return contexts


def select_markets(
    contexts: List[MarketContext],
    cap: int,
) -> Tuple[List[MarketContext], Dict[str, Any]]:
    """Volume-ranked selection with cluster diversity.

    Round-robins across clusters to ensure every cluster in the supercluster
    gets at least one representative before any cluster gets a second seat.
    """
    if not contexts:
        return [], {"selected": 0, "total": 0, "clusters_represented": 0}

    by_cluster: Dict[int, List[MarketContext]] = {}
    for ctx in contexts:
        by_cluster.setdefault(ctx.cluster_id, []).append(ctx)
    for cid in by_cluster:
        by_cluster[cid].sort(key=lambda c: c.volume, reverse=True)

    selected: List[MarketContext] = []
    cluster_order = sorted(by_cluster.keys(), key=lambda k: -sum(c.volume for c in by_cluster[k]))
    idx = 0
    while len(selected) < cap:
        progressed = False
        for cid in cluster_order:
            if by_cluster[cid] and len(selected) < cap:
                selected.append(by_cluster[cid].pop(0))
                progressed = True
        if not progressed:
            break
        idx += 1

    return selected, {
        "selected": len(selected),
        "total": len(contexts),
        "clusters_represented": len({c.cluster_id for c in selected}),
    }


async def build_agents(
    selected: List[MarketContext],
    llm: LLMService,
    model: str,
) -> List[AgentSpec]:
    tasks: List[Tuple[int, Dict[str, Any]]] = [
        (ctx.market_id, {
            "market_title": ctx.market_title,
            "event_title": ctx.event_title,
            "cluster_name": ctx.cluster_name,
        })
        for ctx in selected
    ]
    personas = await llm.generate_personas_batch(tasks, model=model)

    agents: List[AgentSpec] = []
    for ctx in selected:
        p = personas.get(ctx.market_id) or {}
        name = (p.get("name") or f"trader_{ctx.market_id}")[:40]
        bio = (p.get("bio") or f"Follows {ctx.cluster_name or 'prediction markets'}.")[:200]
        persona = (p.get("persona") or "Contrarian trader who bets on underdogs.")[:400]
        interests = p.get("interests") or []
        if isinstance(interests, str):
            interests = [interests]
        agents.append(
            AgentSpec(
                market_id=ctx.market_id,
                cluster_id=ctx.cluster_id,
                market_title=ctx.market_title,
                event_title=ctx.event_title,
                cluster_name=ctx.cluster_name,
                name=name,
                bio=bio,
                persona=persona,
                interests=[str(x)[:40] for x in interests][:5],
            )
        )
    return agents
