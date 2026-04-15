"""Wires the simulation pipeline end-to-end for one supercluster."""

from __future__ import annotations

import logging
from typing import Any, Dict

from app.db.prisma_client import prisma
from app.services.llm_service import LLMService

from . import agent_factory, hedge_extractor, runner
from .store import SimulationRunState
from .types import SimulationConfig

logger = logging.getLogger(__name__)


async def run_pipeline(run: SimulationRunState, config: SimulationConfig, llm: LLMService) -> None:
    run.status = "running"
    await run.set_step("loading supercluster")

    sc = await prisma.supercluster.find_unique(where={"id": config.super_cluster_id})
    if not sc:
        await run.mark_failed(f"SuperCluster {config.super_cluster_id} not found")
        return

    try:
        await run.set_step("fetching markets")
        contexts = await agent_factory.fetch_contexts(config.super_cluster_id)
        if not contexts:
            await run.mark_failed("Supercluster contains no markets")
            return

        selected, diag = agent_factory.select_markets(contexts, cap=config.agent_cap)
        await run.set_step("generating personas", {"selected": len(selected), **diag})

        agents = await agent_factory.build_agents(selected, llm=llm, model=config.cheap_model)
        await run.set_agents(agents)
        await run.set_step("simulation starting", {"agent_count": len(agents)})

        await runner.run_simulation(agents=agents, config=config, run=run, llm=llm)

        await run.set_step("extracting hedge candidates")
        candidates = hedge_extractor.extract_raw_candidates(
            run.actions, top_n=config.synthesize_top_n
        )
        await run.set_step("synthesizing hedges", {"candidates": len(candidates)})

        agents_by_id = {a.market_id: a for a in agents}
        hedges = await hedge_extractor.synthesize_hedges(
            candidates,
            agents_by_market_id=agents_by_id,
            actions=run.actions,
            llm=llm,
            model=config.premium_model,
        )
        for h in hedges:
            await run.push_hedge(h)

        await run.mark_completed()

    except Exception as exc:
        logger.exception("simulation.failed run_id=%s", run.run_id)
        await run.mark_failed(str(exc)[:500])


def build_config(super_cluster_id: int, overrides: Dict[str, Any]) -> SimulationConfig:
    defaults = SimulationConfig(super_cluster_id=super_cluster_id)
    for k, v in overrides.items():
        if v is None:
            continue
        if hasattr(defaults, k):
            setattr(defaults, k, v)
    return defaults
