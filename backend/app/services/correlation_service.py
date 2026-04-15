"""
Live correlation analysis for markets in a cluster.

Resolves each market's CLOB yes-token via Polymarket Gamma API, fetches
hourly price history from the CLOB `/prices-history` endpoint in parallel,
and computes a Pearson correlation matrix with numpy. Progress is streamed
as Server-Sent Events so clients can render per-market updates while long
network fetches are in flight.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import AsyncIterator, Dict, List, Optional, Tuple

import httpx
import numpy as np

from app.db.prisma_client import prisma

logger = logging.getLogger(__name__)

GAMMA_API_URL = "https://gamma-api.polymarket.com"
POLYMARKET_CLOB_URL = "https://clob.polymarket.com"
MIN_DATA_POINTS = 10
RESAMPLE_FREQ_SECONDS = 3600  # hourly buckets


def _sse(event: str, payload: dict) -> bytes:
    """Encode an SSE event frame."""
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n".encode("utf-8")


async def _fetch_yes_token(client: httpx.AsyncClient, polymarket_id: str) -> Optional[str]:
    """Resolve a Gamma market id to its CLOB yes-token."""
    try:
        resp = await client.get(f"{GAMMA_API_URL}/markets/{polymarket_id}", timeout=15.0)
        if resp.status_code != 200:
            return None
        market = resp.json()
        if isinstance(market, list) and market:
            market = market[0]
        if isinstance(market, dict) and "data" in market:
            market = market["data"]
        raw = market.get("clob_token_ids") or market.get("clobTokenIds")
        if isinstance(raw, str):
            raw = json.loads(raw)
        if not isinstance(raw, list) or not raw:
            return None
        return str(raw[0])
    except Exception as e:
        logger.warning(f"gamma {polymarket_id}: {e}")
        return None


async def _fetch_price_history(
    client: httpx.AsyncClient, token_id: str, fidelity: int = 60
) -> List[Tuple[datetime, float]]:
    """Fetch (timestamp, probability) points for a single CLOB token."""
    try:
        resp = await client.get(
            f"{POLYMARKET_CLOB_URL}/prices-history",
            params={"market": token_id, "interval": "max", "fidelity": fidelity},
            timeout=30.0,
        )
        if resp.status_code != 200:
            return []
        payload = resp.json()
        raw = payload if isinstance(payload, list) else payload.get("history", []) or payload.get("data", [])
    except Exception as e:
        logger.warning(f"prices-history {token_id[:8]}: {e}")
        return []

    points: List[Tuple[datetime, float]] = []
    for p in raw:
        ts_val = p.get("t") or p.get("timestamp")
        price = p.get("p") or p.get("close") or p.get("price")
        if ts_val is None or price is None:
            continue
        try:
            if isinstance(ts_val, (int, float)):
                if ts_val > 1e10:
                    ts_val = ts_val / 1000
                ts = datetime.fromtimestamp(int(ts_val), tz=timezone.utc)
            else:
                ts = datetime.fromisoformat(str(ts_val).replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
            points.append((ts, float(price)))
        except Exception:
            continue

    points.sort(key=lambda x: x[0])
    return points


async def _load_market_series(
    client: httpx.AsyncClient, market_id: int, polymarket_id: str
) -> Tuple[int, List[Tuple[datetime, float]]]:
    """Resolve token + fetch history for one market."""
    token = await _fetch_yes_token(client, polymarket_id)
    if not token:
        return market_id, []
    history = await _fetch_price_history(client, token)
    return market_id, history


def _bucket_to_hours(
    points: List[Tuple[datetime, float]], cutoff: datetime
) -> Dict[int, float]:
    """Collapse points into hourly buckets keyed by unix-hour; keep last value per hour."""
    bucketed: Dict[int, float] = {}
    for ts, prob in points:
        if ts < cutoff:
            continue
        hour_key = int(ts.timestamp()) // RESAMPLE_FREQ_SECONDS
        bucketed[hour_key] = prob
    return bucketed


def _forward_fill(series: Dict[int, float], hours: List[int]) -> List[Optional[float]]:
    out: List[Optional[float]] = []
    last: Optional[float] = None
    for h in hours:
        if h in series:
            last = series[h]
        out.append(last)
    return out


def _compute_correlation(
    market_series: Dict[int, Dict[int, float]],
    market_metadata: Dict[int, Dict],
    cluster_name: str,
    threshold: float,
    analyzed_at: str,
) -> Dict:
    empty = {
        "matrix": [],
        "markets": market_metadata,
        "significant_pairs": [],
        "data_points": 0,
        "date_range": None,
        "threshold": threshold,
        "cluster_name": cluster_name,
        "analyzed_at": analyzed_at,
    }

    if len(market_series) < 2:
        return empty

    all_hours = sorted(set().union(*(s.keys() for s in market_series.values())))
    aligned = {mid: _forward_fill(s, all_hours) for mid, s in market_series.items()}

    first_valid: Optional[int] = None
    for i in range(len(all_hours)):
        if all(aligned[mid][i] is not None for mid in aligned):
            first_valid = i
            break
    if first_valid is None:
        return empty

    trimmed_hours = all_hours[first_valid:]
    if len(trimmed_hours) < MIN_DATA_POINTS:
        return empty

    ids_sorted = sorted(aligned.keys())
    matrix_data = np.array(
        [[aligned[mid][i] for i in range(first_valid, len(all_hours))] for mid in ids_sorted],
        dtype=float,
    )

    variances = matrix_data.var(axis=1)
    keep_mask = variances > 1e-12
    if keep_mask.sum() < 2:
        return {**empty, "data_points": len(trimmed_hours)}

    ids_kept = [mid for mid, keep in zip(ids_sorted, keep_mask) if keep]
    matrix_data = matrix_data[keep_mask]
    corr = np.corrcoef(matrix_data)

    matrix: List[Dict] = []
    n = len(ids_kept)
    for i in range(n):
        for j in range(i + 1, n):
            r = corr[i, j]
            if not np.isfinite(r):
                continue
            matrix.append(
                {
                    "market_a_id": int(ids_kept[i]),
                    "market_b_id": int(ids_kept[j]),
                    "r_value": float(r),
                    "r_squared": float(r * r),
                }
            )
    matrix.sort(key=lambda x: abs(x["r_value"]), reverse=True)

    significant_pairs: List[Dict] = []
    for pair in matrix:
        if abs(pair["r_value"]) < threshold:
            continue
        a = market_metadata.get(pair["market_a_id"], {})
        b = market_metadata.get(pair["market_b_id"], {})
        significant_pairs.append(
            {
                "market_a_id": pair["market_a_id"],
                "market_a_title": a.get("title", "Unknown"),
                "market_a_event": a.get("eventTitle"),
                "market_b_id": pair["market_b_id"],
                "market_b_title": b.get("title", "Unknown"),
                "market_b_event": b.get("eventTitle"),
                "r_value": pair["r_value"],
                "r_squared": pair["r_squared"],
                "correlation_type": "positive" if pair["r_value"] > 0 else "negative",
            }
        )

    start_hour = trimmed_hours[0] * RESAMPLE_FREQ_SECONDS
    end_hour = trimmed_hours[-1] * RESAMPLE_FREQ_SECONDS

    return {
        "matrix": matrix,
        "markets": market_metadata,
        "significant_pairs": significant_pairs,
        "data_points": len(trimmed_hours),
        "date_range": {
            "start": datetime.fromtimestamp(start_hour, tz=timezone.utc).isoformat(),
            "end": datetime.fromtimestamp(end_hour, tz=timezone.utc).isoformat(),
        },
        "threshold": threshold,
        "cluster_name": cluster_name,
        "analyzed_at": analyzed_at,
    }


async def stream_cluster_correlations(
    cluster_id: int,
    threshold: float = 0.7,
    days_lookback: int = 90,
    limit_to_top_n: int = 10,
) -> AsyncIterator[bytes]:
    """Stream SSE events as we resolve tokens, fetch histories, and compute the matrix."""
    cluster = await prisma.cluster.find_unique(
        where={"id": cluster_id},
        include={"clusterMarkets": {"include": {"market": True}}},
    )
    if not cluster:
        yield _sse("error", {"detail": f"Cluster {cluster_id} not found"})
        return

    markets = [cm.market for cm in (cluster.clusterMarkets or [])]
    if len(markets) > limit_to_top_n:
        markets = sorted(markets, key=lambda m: m.volume or 0, reverse=True)[:limit_to_top_n]

    market_metadata = {
        m.id: {
            "title": m.title,
            "polymarketId": m.polymarketId,
            "eventTitle": m.eventTitle,
        }
        for m in markets
    }
    analyzed_at = datetime.now(timezone.utc).isoformat()
    cluster_name = cluster.name or "Unnamed Cluster"

    yield _sse(
        "start",
        {
            "cluster_id": cluster_id,
            "cluster_name": cluster_name,
            "market_count": len(markets),
            "markets": market_metadata,
            "threshold": threshold,
            "days_lookback": days_lookback,
        },
    )

    if len(markets) < 2:
        result = _compute_correlation({}, market_metadata, cluster_name, threshold, analyzed_at)
        yield _sse("result", result)
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=days_lookback)
    market_series: Dict[int, Dict[int, float]] = {}

    async with httpx.AsyncClient(
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10)
    ) as client:
        tasks = {
            asyncio.create_task(_load_market_series(client, m.id, m.polymarketId)): m.id
            for m in markets
            if m.polymarketId
        }

        completed = 0
        total = len(tasks)
        for coro in asyncio.as_completed(tasks):
            market_id, history = await coro
            completed += 1
            meta = market_metadata.get(market_id, {})
            buckets = _bucket_to_hours(history, cutoff) if history else {}
            usable = len(buckets) >= MIN_DATA_POINTS
            if usable:
                market_series[market_id] = buckets

            yield _sse(
                "market",
                {
                    "market_id": market_id,
                    "title": meta.get("title"),
                    "raw_points": len(history),
                    "hourly_points": len(buckets),
                    "usable": usable,
                    "completed": completed,
                    "total": total,
                },
            )

    yield _sse("computing", {"usable_markets": len(market_series)})
    result = _compute_correlation(market_series, market_metadata, cluster_name, threshold, analyzed_at)
    yield _sse("result", result)


async def analyze_cluster_correlations(
    cluster_id: int,
    threshold: float = 0.7,
    days_lookback: int = 90,
    limit_to_top_n: int = 10,
) -> Dict:
    """Non-streaming entry point — collects the final result from the streaming pipeline."""
    final: Optional[Dict] = None
    async for frame in stream_cluster_correlations(
        cluster_id, threshold, days_lookback, limit_to_top_n
    ):
        decoded = frame.decode("utf-8")
        if decoded.startswith("event: error"):
            _, _, data_line = decoded.partition("data: ")
            raise ValueError(json.loads(data_line.strip()).get("detail", "error"))
        if decoded.startswith("event: result"):
            _, _, data_line = decoded.partition("data: ")
            final = json.loads(data_line.strip())
    if final is None:
        raise RuntimeError("Correlation stream ended without a result event")
    return final
