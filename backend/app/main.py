import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

from datetime import datetime, timezone
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.db.prisma_client import prisma, connect_db, disconnect_db
from app.services.clustering_service import GraphRebuildService
from app.services.correlation_service import (
    analyze_cluster_correlations,
    stream_cluster_correlations,
)
from app.services.llm_service import LLMService
from app.services.simulation import orchestrator as sim_orchestrator
from app.services.simulation import serializers as sim_serializers
from app.services.simulation.store import store as sim_store


_rebuild_status: dict = {"running": False, "last_result": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await disconnect_db()


app = FastAPI(
    title="Polycenas",
    description="OASIS Simulation MVP — Polymarket prediction-market clustering & agent simulation",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Graph Rebuild
# ---------------------------------------------------------------------------

async def _run_rebuild():
    _rebuild_status["running"] = True
    try:
        service = GraphRebuildService()
        result = await service.rebuild()
        _rebuild_status["last_result"] = result
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"REBUILD FAILED:\n{tb}", flush=True)
        _rebuild_status["last_result"] = {"status": "failed", "error": str(e), "traceback": tb}
    finally:
        _rebuild_status["running"] = False


@app.post("/rebuild-graph")
async def rebuild_graph(background_tasks: BackgroundTasks):
    """Trigger a full graph rebuild (Layer 1 clusters + Layer 2 super-clusters).

    Runs in the background. Poll /rebuild-graph/status for progress.
    """
    if _rebuild_status["running"]:
        raise HTTPException(status_code=409, detail="Rebuild already in progress")

    background_tasks.add_task(_run_rebuild)
    return {"status": "started", "message": "Graph rebuild started in background"}


@app.get("/rebuild-graph/status")
async def rebuild_graph_status():
    return {
        "running": _rebuild_status["running"],
        "last_result": _rebuild_status["last_result"],
    }


# ---------------------------------------------------------------------------
# Super-clusters & Clusters
# ---------------------------------------------------------------------------

def _format_cluster(cluster, include_markets: bool = False) -> dict:
    markets = [cm.market for cm in cluster.clusterMarkets] if cluster.clusterMarkets else []
    result = {
        "id": cluster.id,
        "name": cluster.name,
        "keywords": list(cluster.keywords) if cluster.keywords else [],
        "total_volume": cluster.totalVolume,
        "market_count": len(markets),
        "top_market": None,
    }
    if cluster.topMarketId and cluster.topMarketTitle:
        top_vol = None
        for m in markets:
            if m.id == cluster.topMarketId:
                top_vol = m.volume
                break
        result["top_market"] = {
            "id": cluster.topMarketId,
            "title": cluster.topMarketTitle,
            "volume": top_vol or cluster.totalVolume,
        }
    if include_markets:
        result["markets"] = [
            {
                "id": m.id,
                "title": m.title,
                "event_title": m.eventTitle,
                "volume": m.volume,
                "category": m.category,
            }
            for m in markets
        ]
    return result


@app.get("/superclusters")
async def list_superclusters():
    """Returns all super-clusters with nested clusters and summary stats."""
    superclusters = await prisma.supercluster.find_many(order={"id": "asc"})
    clusters = await prisma.cluster.find_many(
        where={"superClusterId": {"not": None}},
        include={"clusterMarkets": {"include": {"market": True}}},
        order={"totalVolume": "desc"},
    )

    sc_map: dict[int, list] = {sc.id: [] for sc in superclusters}
    for c in clusters:
        if c.superClusterId is not None and c.superClusterId in sc_map:
            sc_map[c.superClusterId].append(c)

    result = []
    for sc in superclusters:
        sc_clusters = sc_map.get(sc.id, [])
        formatted = [_format_cluster(c) for c in sc_clusters]
        total_vol = sum(c.totalVolume or 0 for c in sc_clusters)
        total_markets = sum(f["market_count"] for f in formatted)
        result.append({
            "id": sc.id,
            "name": sc.name,
            "metadata": sc.metadata,
            "total_volume": total_vol,
            "cluster_count": len(formatted),
            "market_count": total_markets,
            "clusters": formatted,
        })

    result.sort(key=lambda x: x["total_volume"], reverse=True)
    return result


# ---------------------------------------------------------------------------
# Simulation — trigger, read, review, live feed
# ---------------------------------------------------------------------------


class SimulationTriggerRequest(BaseModel):
    agent_cap: Optional[int] = None
    rounds: Optional[int] = None
    cheap_model: Optional[str] = None
    premium_model: Optional[str] = None
    synthesis_model: Optional[str] = None
    synthesize_top_n: Optional[int] = None


class HedgeReviewRequest(BaseModel):
    action: str
    admin_notes: Optional[str] = None
    reviewed_by: Optional[str] = None


class ResynthesizeRequest(BaseModel):
    synthesis_model: Optional[str] = None


class HedgePayloadRequest(BaseModel):
    structured_payload: Dict[str, Any]


@app.get("/oasis-simulation/superclusters")
async def sim_list_superclusters():
    superclusters = await prisma.supercluster.find_many()
    clusters = await prisma.cluster.find_many(
        where={"superClusterId": {"not": None}},
        include={"clusterMarkets": True},
    )
    counts: Dict[int, int] = {}
    for c in clusters:
        if c.superClusterId is not None:
            counts[c.superClusterId] = counts.get(c.superClusterId, 0) + len(c.clusterMarkets or [])
    items = [
        {
            "id": sc.id,
            "name": sc.name,
            "has_graph": counts.get(sc.id, 0) > 0,
            "graph_id": None,
            "market_count": counts.get(sc.id, 0),
        }
        for sc in superclusters
    ]
    items.sort(key=lambda x: (not x["has_graph"], -x["market_count"]))
    return {"superclusters": items}


@app.post("/oasis-simulation/superclusters/{super_cluster_id}/run")
async def sim_trigger(super_cluster_id: int, body: SimulationTriggerRequest):
    sc = await prisma.supercluster.find_unique(where={"id": super_cluster_id})
    if not sc:
        raise HTTPException(status_code=404, detail=f"SuperCluster {super_cluster_id} not found")

    overrides = body.model_dump(exclude_none=True)
    config = sim_orchestrator.build_config(super_cluster_id, overrides)

    persisted_config = {
        "agent_cap": config.agent_cap,
        "rounds": config.rounds,
        "synthesize_top_n": config.synthesize_top_n,
        "platform_type": config.platform_type,
        "cheap_model": config.cheap_model,
        "premium_model": config.premium_model,
        "synthesis_model": config.synthesis_model,
    }
    run = sim_store.create(super_cluster_id=super_cluster_id, config=persisted_config)

    llm = LLMService()
    run.task = asyncio.create_task(sim_orchestrator.run_pipeline(run, config, llm))

    return {
        "status": "started",
        "run_id": run.run_id,
        "super_cluster_id": super_cluster_id,
        "supercluster_name": sc.name,
    }


@app.get("/oasis-simulation/runs")
async def sim_list_all_runs(limit: int = Query(50, ge=1, le=200)):
    runs = sim_store.list()[:limit]
    return {"runs": [sim_serializers.serialize_run_summary(r) for r in runs]}


@app.get("/oasis-simulation/superclusters/{super_cluster_id}/runs")
async def sim_list_runs_for_sc(
    super_cluster_id: int,
    limit: int = Query(20, ge=1, le=100),
):
    runs = [r for r in sim_store.list() if r.super_cluster_id == super_cluster_id][:limit]
    return {"runs": [sim_serializers.serialize_run_summary(r) for r in runs]}


@app.get("/oasis-simulation/runs/{run_id}")
async def sim_get_run(run_id: str):
    run = sim_store.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return {
        "run": sim_serializers.serialize_run_detail(run),
        "agents": [sim_serializers.serialize_agent(a) for a in run.agents],
        "hedges": [sim_serializers.serialize_hedge(h, run.run_id) for h in run.hedges],
    }


@app.get("/oasis-simulation/runs/{run_id}/actions")
async def sim_get_actions(
    run_id: str,
    after_sequence: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
):
    run = sim_store.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    filtered = [a for a in run.actions if a.sequence > after_sequence][:limit]
    actions = [sim_serializers.serialize_action(a) for a in filtered]
    return {"actions": actions, "count": len(actions)}


@app.post("/oasis-simulation/hedges/{hedge_id}/review")
async def sim_review_hedge(hedge_id: int, body: HedgeReviewRequest):
    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")
    run_id, hedge = sim_store.find_hedge(hedge_id)
    if not hedge:
        raise HTTPException(status_code=404, detail=f"Hedge {hedge_id} not found")
    hedge.status = "approved" if body.action == "approve" else "rejected"
    hedge.admin_notes = body.admin_notes
    hedge.reviewed_by = body.reviewed_by
    hedge.reviewed_at = datetime.now(timezone.utc).isoformat()
    return sim_serializers.serialize_hedge(hedge, run_id)


@app.post("/oasis-simulation/hedges/{hedge_id}/resynthesize")
async def sim_resynthesize_hedge(hedge_id: int, body: ResynthesizeRequest):
    from app.services.simulation.hedge_extractor import synthesize_hedges
    from app.services.simulation.types import RawHedgeCandidate

    run_id, hedge = sim_store.find_hedge(hedge_id)
    if not hedge:
        raise HTTPException(status_code=404, detail=f"Hedge {hedge_id} not found")
    run = sim_store.get(run_id) if run_id else None
    if not run:
        raise HTTPException(status_code=404, detail=f"Run for hedge {hedge_id} not found")

    model = body.synthesis_model or run.config.get("synthesis_model") or "gemini-2.5-pro"
    agents_by_id = {a.market_id: a for a in run.agents}
    raw = RawHedgeCandidate(
        market_a_id=hedge.market_a_id,
        market_b_id=hedge.market_b_id,
        co_movement_score=hedge.co_movement_score,
        interaction_score=hedge.interaction_score,
        contradiction_score=hedge.contradiction_score,
        hedge_score=hedge.hedge_score,
    )
    llm = LLMService()
    fresh = await synthesize_hedges(
        [raw],
        agents_by_market_id=agents_by_id,
        actions=run.actions,
        llm=llm,
        model=model,
        concurrency=1,
    )
    if fresh:
        new = fresh[0]
        hedge.confidence_score = new.confidence_score
        hedge.direction = new.direction
        hedge.reasoning = new.reasoning
        hedge.key_factors = new.key_factors
        hedge.recommended_combo = new.recommended_combo
    return sim_serializers.serialize_hedge(hedge, run_id)


@app.post("/oasis-simulation/hedges/{hedge_id}/payload")
async def sim_patch_hedge_payload(hedge_id: int, body: HedgePayloadRequest):
    run_id, hedge = sim_store.find_hedge(hedge_id)
    if not hedge:
        raise HTTPException(status_code=404, detail=f"Hedge {hedge_id} not found")
    hedge.structured_payload = body.structured_payload
    return sim_serializers.serialize_hedge(hedge, run_id)


@app.websocket("/ws/simulation/{run_id}")
async def sim_ws(websocket: WebSocket, run_id: str):
    await websocket.accept()
    run = sim_store.get(run_id)
    if not run:
        await websocket.send_json({"type": "error", "error": f"Run {run_id} not found"})
        await websocket.close()
        return

    queue = run.subscribe()

    await websocket.send_json({
        "type": "backfill",
        "actions": [sim_serializers.serialize_action(a) for a in run.actions],
    })
    await websocket.send_json({"type": "run_status", "status": run.status})

    async def reader():
        try:
            while True:
                msg = await websocket.receive_text()
                try:
                    data = json.loads(msg)
                except Exception:
                    continue
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
        except WebSocketDisconnect:
            pass
        except Exception:
            pass

    reader_task = asyncio.create_task(reader())

    try:
        while True:
            if run.status in ("completed", "failed") and queue.empty():
                await websocket.send_json({"type": "run_status", "status": run.status})
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
            except asyncio.TimeoutError:
                try:
                    await websocket.send_json({"type": "heartbeat"})
                except Exception:
                    break
                continue
            etype = event.get("type")
            if etype in ("simulation_action", "run_status"):
                try:
                    await websocket.send_json(event)
                except Exception:
                    break
            elif etype == "end":
                break
    finally:
        reader_task.cancel()
        run.unsubscribe(queue)
        try:
            await websocket.close()
        except Exception:
            pass


@app.get("/superclusters/{supercluster_id}")
async def get_supercluster(supercluster_id: int):
    """Returns a single super-cluster with full cluster + market details."""
    sc = await prisma.supercluster.find_unique(where={"id": supercluster_id})
    if not sc:
        raise HTTPException(status_code=404, detail=f"Super-cluster {supercluster_id} not found")

    clusters = await prisma.cluster.find_many(
        where={"superClusterId": supercluster_id},
        include={"clusterMarkets": {"include": {"market": True}}},
        order={"totalVolume": "desc"},
    )

    formatted = [_format_cluster(c, include_markets=True) for c in clusters]
    total_vol = sum(c.totalVolume or 0 for c in clusters)
    total_markets = sum(f["market_count"] for f in formatted)

    return {
        "id": sc.id,
        "name": sc.name,
        "metadata": sc.metadata,
        "total_volume": total_vol,
        "cluster_count": len(formatted),
        "market_count": total_markets,
        "clusters": formatted,
    }


@app.get("/clusters")
async def list_clusters(
    supercluster_id: Optional[int] = Query(None, description="Filter to a single super-cluster"),
    search: Optional[str] = Query(None, description="Case-insensitive name/keyword match"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """List clusters with pagination and optional super-cluster / search filters."""
    where: dict = {}
    if supercluster_id is not None:
        where["superClusterId"] = supercluster_id
    if search:
        where["OR"] = [
            {"name": {"contains": search, "mode": "insensitive"}},
            {"keywords": {"has": search.lower()}},
        ]

    total = await prisma.cluster.count(where=where or None)
    clusters = await prisma.cluster.find_many(
        where=where or None,
        include={"clusterMarkets": {"include": {"market": True}}},
        skip=skip,
        take=limit,
        order={"totalVolume": "desc"},
    )

    data = [_format_cluster(c) for c in clusters]
    return {
        "data": data,
        "pagination": {
            "skip": skip,
            "limit": limit,
            "total": total,
            "hasMore": skip + limit < total,
        },
    }


@app.get("/clusters/{cluster_id}")
async def get_cluster(cluster_id: int):
    """Return a single cluster with its markets."""
    cluster = await prisma.cluster.find_unique(
        where={"id": cluster_id},
        include={"clusterMarkets": {"include": {"market": True}}},
    )
    if not cluster:
        raise HTTPException(status_code=404, detail=f"Cluster {cluster_id} not found")

    result = _format_cluster(cluster, include_markets=True)
    result["supercluster_id"] = cluster.superClusterId
    result["centroid"] = (
        {"x": cluster.centroidX, "y": cluster.centroidY}
        if cluster.centroidX is not None and cluster.centroidY is not None
        else None
    )
    result["category"] = cluster.category
    return result


@app.get("/clusters/{cluster_id}/correlation")
async def get_cluster_correlation(
    cluster_id: int,
    threshold: float = Query(0.7, ge=0.0, le=1.0, description="Minimum |r| for significant pairs"),
    days_lookback: int = Query(90, ge=7, le=365, description="Days of price history to analyze"),
    limit_to_top_n: int = Query(10, ge=2, le=50, description="Cap matrix to top N markets by volume"),
):
    """Compute a live Pearson correlation matrix for markets in a cluster.

    Fetches hourly price history from Polymarket CLOB on demand (no cache).
    """
    try:
        return await analyze_cluster_correlations(
            cluster_id=cluster_id,
            threshold=threshold,
            days_lookback=days_lookback,
            limit_to_top_n=limit_to_top_n,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/clusters/{cluster_id}/correlation/stream")
async def stream_cluster_correlation(
    cluster_id: int,
    threshold: float = Query(0.7, ge=0.0, le=1.0),
    days_lookback: int = Query(90, ge=7, le=365),
    limit_to_top_n: int = Query(10, ge=2, le=50),
):
    """Stream correlation progress as Server-Sent Events.

    Events emitted:
      - `start`:     cluster metadata + market list
      - `market`:    one per market as its history arrives (completed / total)
      - `computing`: all fetches finished, starting correlation
      - `result`:    final correlation payload (same shape as the non-stream route)
      - `error`:     cluster not found or fatal failure
    """
    stream = stream_cluster_correlations(
        cluster_id=cluster_id,
        threshold=threshold,
        days_lookback=days_lookback,
        limit_to_top_n=limit_to_top_n,
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
