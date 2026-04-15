# Polycenas API Reference

Base URL: `http://localhost:8000`

---

## Health

### `GET /health`

Quick liveness check.

**Response** `200`
```json
{ "status": "ok" }
```

---

## Graph Rebuild

### `POST /rebuild-graph`

Trigger a full graph rebuild (Layer 1 clusters + Layer 2 super-clusters). Runs in the background.

**Response** `200`
```json
{ "status": "started", "message": "Graph rebuild started in background" }
```

**Response** `409` — rebuild already in progress
```json
{ "detail": "Rebuild already in progress" }
```

### `GET /rebuild-graph/status`

Poll rebuild progress.

**Response** `200`
```json
{
  "running": false,
  "last_result": {
    "status": "completed",
    "markets_clustered": 4800,
    "clusters_created": 120
  }
}
```

---

## Super-clusters & Clusters

### `GET /superclusters`

Returns all super-clusters with their nested clusters and summary stats.

**Query params:** none

**Response** `200`
```json
[
  {
    "id": 0,
    "name": "US Presidential Election 2026",
    "metadata": { "cluster_count": 5 },
    "total_volume": 12500000.0,
    "cluster_count": 5,
    "market_count": 87,
    "clusters": [
      {
        "id": 142,
        "name": "Republican Primary Candidates",
        "keywords": ["trump", "desantis", "republican", "primary"],
        "total_volume": 3200000.0,
        "market_count": 18,
        "top_market": {
          "id": 501,
          "title": "Will Trump win the 2026 Republican nomination?",
          "volume": 1500000.0
        }
      }
    ]
  }
]
```

### `GET /superclusters/{supercluster_id}`

Returns a single super-cluster with full cluster + market details.

**Path params:**
- `supercluster_id` (int) — Super-cluster ID

**Response** `200`
```json
{
  "id": 0,
  "name": "US Presidential Election 2026",
  "metadata": { "cluster_count": 5 },
  "total_volume": 12500000.0,
  "cluster_count": 5,
  "market_count": 87,
  "clusters": [
    {
      "id": 142,
      "name": "Republican Primary Candidates",
      "keywords": ["trump", "desantis", "republican", "primary"],
      "total_volume": 3200000.0,
      "market_count": 18,
      "top_market": {
        "id": 501,
        "title": "Will Trump win the 2026 Republican nomination?",
        "volume": 1500000.0
      },
      "markets": [
        {
          "id": 501,
          "title": "Will Trump win the 2026 Republican nomination?",
          "event_title": "2026 Republican Primary",
          "volume": 1500000.0,
          "category": "Politics"
        }
      ]
    }
  ]
}
```

**Response** `404`
```json
{ "detail": "Super-cluster 99 not found" }
```

---

## Clusters

### `GET /clusters`

List clusters with pagination and optional filters.

**Query params:**
- `supercluster_id` (int, optional) — restrict to a single super-cluster
- `search` (string, optional) — case-insensitive match against cluster `name` or `keywords`
- `skip` (int, default `0`) — pagination offset
- `limit` (int, default `100`, max `500`) — page size

**Response** `200`
```json
{
  "data": [
    {
      "id": 142,
      "name": "Republican Primary Candidates",
      "keywords": ["trump", "desantis", "republican", "primary"],
      "total_volume": 3200000.0,
      "market_count": 18,
      "top_market": {
        "id": 501,
        "title": "Will Trump win the 2026 Republican nomination?",
        "volume": 1500000.0
      }
    }
  ],
  "pagination": { "skip": 0, "limit": 100, "total": 1, "hasMore": false }
}
```

### `GET /clusters/{cluster_id}`

Return a single cluster with its markets.

**Path params:**
- `cluster_id` (int) — Cluster ID

**Response** `200`
```json
{
  "id": 142,
  "name": "Republican Primary Candidates",
  "keywords": ["trump", "desantis", "republican", "primary"],
  "total_volume": 3200000.0,
  "market_count": 18,
  "top_market": {
    "id": 501,
    "title": "Will Trump win the 2026 Republican nomination?",
    "volume": 1500000.0
  },
  "markets": [
    {
      "id": 501,
      "title": "Will Trump win the 2026 Republican nomination?",
      "event_title": "2026 Republican Primary",
      "volume": 1500000.0,
      "category": "Politics"
    }
  ],
  "supercluster_id": 0,
  "centroid": { "x": 0.42, "y": -0.17 },
  "category": "Politics"
}
```

**Response** `404`
```json
{ "detail": "Cluster 99 not found" }
```
