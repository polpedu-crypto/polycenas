"""Multi-round Reddit-style agent simulation loop.

Each round, every agent sees the most recent feed window and the list of peer
agents, then decides: post / reply / skip. Each action is pushed to the in-
memory run state and broadcast to SSE subscribers immediately — that is what
powers the live viewer.
"""

from __future__ import annotations

import asyncio
import random
from typing import Dict, List

from app.services.llm_service import LLMService

from .store import SimulationRunState
from .types import AgentAction, AgentSpec, SimulationConfig


VALID_STANCES = {"bullish", "bearish", "neutral"}
VALID_ACTIONS = {"post", "reply", "skip"}


async def run_simulation(
    *,
    agents: List[AgentSpec],
    config: SimulationConfig,
    run: SimulationRunState,
    llm: LLMService,
) -> None:
    if not agents:
        return

    peers_payload = [
        {"market_id": a.market_id, "name": a.name, "market_title": a.market_title}
        for a in agents
    ]
    action_id_by_market_last: Dict[int, int] = {}

    concurrency = min(6, len(agents))
    sem = asyncio.Semaphore(concurrency)

    for round_number in range(1, config.rounds + 1):
        await run.set_step(f"simulating round {round_number}/{config.rounds}", {"round": round_number})

        order = list(agents)
        random.shuffle(order)

        async def _turn(agent: AgentSpec):
            async with sem:
                feed = [
                    {
                        "seq": a.sequence,
                        "agent_name": a.agent_name,
                        "title": a.title,
                        "content": a.content,
                    }
                    for a in run.actions[-40:]
                ]
                peers_for_this = [p for p in peers_payload if p["market_id"] != agent.market_id]
                resp = await llm.agent_turn(
                    agent_name=agent.name,
                    persona=agent.persona,
                    market_title=agent.market_title,
                    event_title=agent.event_title,
                    cluster_name=agent.cluster_name,
                    feed=feed,
                    round_number=round_number,
                    peers=peers_for_this,
                    model=config.premium_model,
                )
                action = _coerce_action(
                    resp=resp or {},
                    agent=agent,
                    round_number=round_number,
                    run=run,
                    action_id_by_market_last=action_id_by_market_last,
                )
                await run.push_action(action)
                if action.action_type != "skip":
                    action_id_by_market_last[agent.market_id] = action.id

        # Run in small batches so the feed evolves during the round
        batch_size = 4
        for start in range(0, len(order), batch_size):
            batch = order[start:start + batch_size]
            await asyncio.gather(*[_turn(a) for a in batch])

        run.rounds_completed = round_number


def _coerce_action(
    *,
    resp: Dict,
    agent: AgentSpec,
    round_number: int,
    run: SimulationRunState,
    action_id_by_market_last: Dict[int, int],
) -> AgentAction:
    action_type = str(resp.get("action") or "skip").lower()
    if action_type not in VALID_ACTIONS:
        action_type = "post"

    stance = str(resp.get("stance") or "neutral").lower()
    if stance not in VALID_STANCES:
        stance = "neutral"

    title = (resp.get("title") or None)
    content = (resp.get("content") or None)
    if title:
        title = str(title)[:120]
    if content:
        content = str(content)[:400]

    target_market_id = resp.get("target_market_id")
    try:
        target_market_id = int(target_market_id) if target_market_id is not None else None
    except (TypeError, ValueError):
        target_market_id = None

    parent_action_id = None
    if action_type == "reply" and target_market_id is not None:
        parent_action_id = action_id_by_market_last.get(target_market_id)
        if parent_action_id is None:
            action_type = "post"
            target_market_id = None

    if action_type != "skip" and not content and not title:
        action_type = "skip"

    return AgentAction(
        id=run.next_action_id(),
        round_number=round_number,
        sequence=run.next_sequence(),
        agent_market_id=agent.market_id,
        agent_name=agent.name,
        action_type=action_type,
        target_market_id=target_market_id,
        parent_action_id=parent_action_id,
        title=title,
        content=content,
        stance=stance,
    )
