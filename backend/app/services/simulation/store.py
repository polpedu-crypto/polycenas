"""In-memory simulation run store with SSE broadcast queues.

No DB tables are used — everything lives per-process. Optionally flushed to
`runs/{run_id}.json` on completion for replay.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from .types import AgentAction, AgentSpec, SynthesizedHedge


RUNS_DIR = Path(__file__).resolve().parents[3] / "runs"


class SimulationRunState:
    def __init__(self, run_id: str, super_cluster_id: int, config: Dict[str, Any]):
        self.run_id = run_id
        self.super_cluster_id = super_cluster_id
        self.config = config
        self.status: str = "pending"         # pending | running | completed | failed
        self.error: Optional[str] = None
        self.started_at = datetime.utcnow().isoformat()
        self.completed_at: Optional[str] = None
        self.current_step: str = "queued"
        self.rounds_completed: int = 0
        self.agents: List[AgentSpec] = []
        self.actions: List[AgentAction] = []
        self.hedges: List[SynthesizedHedge] = []
        self._seq: int = 0
        self._next_action_id: int = 1
        # Live subscribers (SSE). Each subscriber owns an asyncio.Queue.
        self._subscribers: List[asyncio.Queue] = []
        # Hold the pipeline task reference so it doesn't get GC'd mid-run.
        self.task: Optional[asyncio.Task] = None

    # ──────────────── mutation ────────────────

    def next_sequence(self) -> int:
        self._seq += 1
        return self._seq

    def next_action_id(self) -> int:
        i = self._next_action_id
        self._next_action_id += 1
        return i

    async def push_action(self, action: AgentAction) -> None:
        self.actions.append(action)
        await self._broadcast({"type": "action", "data": action.to_dict()})

    async def set_step(self, step: str, extra: Optional[Dict[str, Any]] = None) -> None:
        self.current_step = step
        payload: Dict[str, Any] = {"type": "status", "step": step, "status": self.status}
        if extra:
            payload.update(extra)
        await self._broadcast(payload)

    async def set_agents(self, agents: List[AgentSpec]) -> None:
        self.agents = agents
        await self._broadcast({
            "type": "agents",
            "data": [asdict(a) for a in agents],
        })

    async def push_hedge(self, hedge: SynthesizedHedge) -> None:
        self.hedges.append(hedge)
        await self._broadcast({"type": "hedge", "data": hedge.to_dict()})

    async def mark_completed(self) -> None:
        self.status = "completed"
        self.completed_at = datetime.utcnow().isoformat()
        self._flush_to_disk()
        await self._broadcast({"type": "completed", "run_id": self.run_id})
        await self._close_subscribers()

    async def mark_failed(self, error: str) -> None:
        self.status = "failed"
        self.error = error
        self.completed_at = datetime.utcnow().isoformat()
        await self._broadcast({"type": "failed", "error": error})
        await self._close_subscribers()

    # ──────────────── SSE subscription ────────────────

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subscribers.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._subscribers.remove(q)
        except ValueError:
            pass

    async def _broadcast(self, message: Dict[str, Any]) -> None:
        dead: List[asyncio.Queue] = []
        for q in self._subscribers:
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)

    async def _close_subscribers(self) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait({"type": "end"})
            except Exception:
                pass

    # ──────────────── serialization ────────────────

    def snapshot(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "super_cluster_id": self.super_cluster_id,
            "status": self.status,
            "current_step": self.current_step,
            "rounds_completed": self.rounds_completed,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "error": self.error,
            "config": self.config,
            "agent_count": len(self.agents),
            "action_count": len(self.actions),
            "hedge_count": len(self.hedges),
            "agents": [asdict(a) for a in self.agents],
            "actions": [a.to_dict() for a in self.actions],
            "hedges": [h.to_dict() for h in self.hedges],
        }

    def _flush_to_disk(self) -> None:
        try:
            RUNS_DIR.mkdir(parents=True, exist_ok=True)
            out = RUNS_DIR / f"{self.run_id}.json"
            with open(out, "w") as f:
                json.dump(self.snapshot(), f, indent=2, default=str)
        except Exception as e:
            print(f"Failed to flush run {self.run_id} to disk: {e}", flush=True)


class SimulationStore:
    def __init__(self) -> None:
        self._runs: Dict[str, SimulationRunState] = {}

    def create(self, super_cluster_id: int, config: Dict[str, Any]) -> SimulationRunState:
        run_id = str(uuid.uuid4())
        run = SimulationRunState(run_id=run_id, super_cluster_id=super_cluster_id, config=config)
        self._runs[run_id] = run
        return run

    def get(self, run_id: str) -> Optional[SimulationRunState]:
        return self._runs.get(run_id)

    def list(self) -> List[Dict[str, Any]]:
        return [
            {
                "run_id": r.run_id,
                "super_cluster_id": r.super_cluster_id,
                "status": r.status,
                "current_step": r.current_step,
                "started_at": r.started_at,
                "completed_at": r.completed_at,
                "agent_count": len(r.agents),
                "action_count": len(r.actions),
                "hedge_count": len(r.hedges),
            }
            for r in sorted(self._runs.values(), key=lambda x: x.started_at, reverse=True)
        ]


store = SimulationStore()
