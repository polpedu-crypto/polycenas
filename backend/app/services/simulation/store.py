"""In-memory simulation run store with WebSocket / SSE broadcast queues.

Events pushed onto subscriber queues use the same shape the frontend feed
already expects:

    {"type": "simulation_action", "action": <AgentAction dict>}
    {"type": "run_status", "status": "running"|"completed"|"failed"}

Completed runs are flushed to `backend/runs/{run_id}.json` for replay.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

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
        self.created_at = self.started_at
        self.current_step: str = "queued"
        self.rounds_completed: int = 0
        self.agents: List[AgentSpec] = []
        self.actions: List[AgentAction] = []
        self.hedges: List[SynthesizedHedge] = []
        self._seq: int = 0
        self._next_action_id: int = 1
        # Subscriber queues (both WS and SSE listeners consume from these).
        self._subscribers: List[asyncio.Queue] = []
        # Hold the pipeline task reference so it doesn't get GC'd mid-run.
        self.task: Optional[asyncio.Task] = None

    # ──────────────── sequencing ────────────────

    def next_sequence(self) -> int:
        self._seq += 1
        return self._seq

    def next_action_id(self) -> int:
        i = self._next_action_id
        self._next_action_id += 1
        return i

    # ──────────────── status transitions ────────────────

    async def set_status(self, status: str) -> None:
        if status == self.status:
            return
        self.status = status
        await self._broadcast({"type": "run_status", "status": status})

    async def set_step(self, step: str, extra: Optional[Dict[str, Any]] = None) -> None:
        self.current_step = step
        payload: Dict[str, Any] = {"type": "step", "step": step, "status": self.status}
        if extra:
            payload.update(extra)
        await self._broadcast(payload)

    # ──────────────── events ────────────────

    async def push_action(self, action: AgentAction) -> None:
        self.actions.append(action)
        await self._broadcast({"type": "simulation_action", "action": _action_to_ws(action)})

    async def set_agents(self, agents: List[AgentSpec]) -> None:
        self.agents = agents

    async def push_hedge(self, hedge: SynthesizedHedge) -> None:
        self.hedges.append(hedge)
        store.register_hedge(self.run_id, hedge)

    async def mark_completed(self) -> None:
        await self.set_status("completed")
        self.completed_at = datetime.utcnow().isoformat()
        self._flush_to_disk()
        await self._close_subscribers()

    async def mark_failed(self, error: str) -> None:
        self.error = error
        self.completed_at = datetime.utcnow().isoformat()
        await self.set_status("failed")
        await self._close_subscribers()

    # ──────────────── subscribers (WS + SSE share the queue protocol) ────────────────

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
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

    # ──────────────── disk flush ────────────────

    def _flush_to_disk(self) -> None:
        try:
            RUNS_DIR.mkdir(parents=True, exist_ok=True)
            out = RUNS_DIR / f"{self.run_id}.json"
            snapshot = {
                "run_id": self.run_id,
                "super_cluster_id": self.super_cluster_id,
                "status": self.status,
                "current_step": self.current_step,
                "rounds_completed": self.rounds_completed,
                "started_at": self.started_at,
                "completed_at": self.completed_at,
                "error": self.error,
                "config": self.config,
                "agents": [asdict(a) for a in self.agents],
                "actions": [a.to_dict() for a in self.actions],
                "hedges": [h.to_dict() for h in self.hedges],
            }
            with open(out, "w") as f:
                json.dump(snapshot, f, indent=2, default=str)
        except Exception as e:
            print(f"Failed to flush run {self.run_id} to disk: {e}", flush=True)


def _action_to_ws(action: AgentAction) -> Dict[str, Any]:
    """Serialize an action to the shape the live feed consumer expects."""
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


class SimulationStore:
    def __init__(self) -> None:
        self._runs: Dict[str, SimulationRunState] = {}
        self._hedge_id_counter: int = 0
        # Global lookup: hedge_id -> (run_id, SynthesizedHedge) so /review
        # /resynthesize /payload can resolve across runs.
        self._hedges_by_id: Dict[int, Dict[str, Any]] = {}

    def create(self, super_cluster_id: int, config: Dict[str, Any]) -> SimulationRunState:
        run_id = str(uuid.uuid4())
        run = SimulationRunState(run_id=run_id, super_cluster_id=super_cluster_id, config=config)
        self._runs[run_id] = run
        return run

    def get(self, run_id: str) -> Optional[SimulationRunState]:
        return self._runs.get(run_id)

    def list(self) -> List[SimulationRunState]:
        return sorted(self._runs.values(), key=lambda r: r.started_at, reverse=True)

    def next_hedge_id(self) -> int:
        self._hedge_id_counter += 1
        return self._hedge_id_counter

    def register_hedge(self, run_id: str, hedge: SynthesizedHedge) -> None:
        self._hedges_by_id[hedge.id] = {"run_id": run_id, "hedge": hedge}

    def find_hedge(self, hedge_id: int):
        entry = self._hedges_by_id.get(hedge_id)
        if not entry:
            return None, None
        return entry["run_id"], entry["hedge"]


store = SimulationStore()
