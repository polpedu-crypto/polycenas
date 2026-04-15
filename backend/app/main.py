from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.db.prisma_client import prisma, connect_db, disconnect_db
from app.services.clustering_service import GraphRebuildService
from app.services.correlation_service import analyze_cluster_correlations


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
        _rebuild_status["last_result"] = {"status": "failed", "error": str(e)}
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
