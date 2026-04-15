"""
Live correlation analysis for markets in a cluster.

Fetches hourly price history for each market directly from Polymarket CLOB,
computes a Pearson correlation matrix with numpy, and surfaces significant
pairs. No caching, no DB writes, no LLM — pure on-demand.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

import httpx
import numpy as np

from app.db.prisma_client import prisma

logger = logging.getLogger(__name__)

POLYMARKET_CLOB_URL = "https://clob.polymarket.com"
MIN_DATA_POINTS = 10
RESAMPLE_FREQ_SECONDS = 3600  # hourly buckets


async def _fetch_market_history(
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
            logger.warning(f"prices-history {token_id[:8]}: HTTP {resp.status_code}")
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
    """Return a list of probabilities aligned to `hours`, forward-filling gaps."""
    out: List[Optional[float]] = []
    last: Optional[float] = None
    for h in hours:
        if h in series:
            last = series[h]
        out.append(last)
    return out


async def analyze_cluster_correlations(
    cluster_id: int,
    threshold: float = 0.7,
    days_lookback: int = 90,
    limit_to_top_n: int = 10,
) -> Dict:
    """Compute correlation matrix + significant pairs for a cluster.

    Returns the shape consumed by the correlation graph viz.
    """
    cluster = await prisma.cluster.find_unique(
        where={"id": cluster_id},
        include={"clusterMarkets": {"include": {"market": True}}},
    )
    if not cluster:
        raise ValueError(f"Cluster {cluster_id} not found")

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
    empty_response = {
        "matrix": [],
        "markets": market_metadata,
        "significant_pairs": [],
        "data_points": 0,
        "date_range": None,
        "threshold": threshold,
        "cluster_name": cluster.name or "Unnamed Cluster",
        "analyzed_at": analyzed_at,
    }

    if len(markets) < 2:
        return empty_response

    cutoff = datetime.now(timezone.utc) - timedelta(days=days_lookback)

    # Fetch all markets' histories concurrently
    async with httpx.AsyncClient() as client:
        tasks = []
        market_ids_ordered: List[int] = []
        for m in markets:
            token_id = m.clobTokenIds[0] if m.clobTokenIds else None
            if not token_id:
                continue
            market_ids_ordered.append(m.id)
            tasks.append(_fetch_market_history(client, token_id))
        histories = await asyncio.gather(*tasks, return_exceptions=True)

    # Bucket each market into hourly dicts
    market_series: Dict[int, Dict[int, float]] = {}
    for market_id, hist in zip(market_ids_ordered, histories):
        if isinstance(hist, Exception) or not hist:
            continue
        buckets = _bucket_to_hours(hist, cutoff)
        if len(buckets) >= MIN_DATA_POINTS:
            market_series[market_id] = buckets

    if len(market_series) < 2:
        return empty_response

    # Union of hours across all qualifying series
    all_hours = sorted(set().union(*(s.keys() for s in market_series.values())))

    # Align with forward-fill, then drop leading hours where any series is still None
    aligned: Dict[int, List[Optional[float]]] = {
        mid: _forward_fill(series, all_hours) for mid, series in market_series.items()
    }

    first_valid = 0
    for i in range(len(all_hours)):
        if all(aligned[mid][i] is not None for mid in aligned):
            first_valid = i
            break
    else:
        return empty_response

    trimmed_hours = all_hours[first_valid:]
    if len(trimmed_hours) < MIN_DATA_POINTS:
        return empty_response

    ids_sorted = sorted(aligned.keys())
    matrix_data = np.array(
        [[aligned[mid][i] for i in range(first_valid, len(all_hours))] for mid in ids_sorted],
        dtype=float,
    )

    # Drop markets with zero variance (constant series) — corrcoef returns NaN for them
    variances = matrix_data.var(axis=1)
    keep_mask = variances > 1e-12
    if keep_mask.sum() < 2:
        return {**empty_response, "data_points": len(trimmed_hours)}

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
        "cluster_name": cluster.name or "Unnamed Cluster",
        "analyzed_at": analyzed_at,
    }
