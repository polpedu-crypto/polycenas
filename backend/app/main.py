from contextlib import asynccontextmanager
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.db.prisma_client import connect_db, disconnect_db
from app.services.clustering_service import GraphRebuildService


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


@app.get("/health")
async def health():
    return {"status": "ok"}


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
