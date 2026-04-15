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

### `GET /clusters/{cluster_id}/correlation/stream`

Same analysis as `/correlation` but streamed as Server-Sent Events so the client can render progress while Polymarket fetches are in flight. Use this when latency matters or the cluster is large.

**Query params:** same as `/correlation` (`threshold`, `days_lookback`, `limit_to_top_n`).

**Event types:**
- `start` — `{ cluster_id, cluster_name, market_count, markets, threshold, days_lookback }`
- `market` — one per market as its history arrives: `{ market_id, title, raw_points, hourly_points, usable, completed, total }`
- `computing` — `{ usable_markets }` — fetches done, starting the matrix
- `result` — final payload matching the `/correlation` response shape
- `error` — `{ detail }` — cluster not found or fatal failure (sent instead of `result`)

**Curl example:**
```bash
curl -N "http://localhost:8000/clusters/1697/correlation/stream?days_lookback=30&threshold=0.5"
```

### `GET /clusters/{cluster_id}/correlation`

Compute a live Pearson correlation matrix for markets in the cluster. For each market we resolve the CLOB yes-token via Polymarket Gamma, fetch hourly price history from `clob.polymarket.com/prices-history`, bucket to hourly slots, and correlate with numpy. No cache.

**Path params:**
- `cluster_id` (int)

**Query params:**
- `threshold` (float, default `0.7`, range `0.0–1.0`) — minimum |r| for a pair to appear in `significant_pairs`
- `days_lookback` (int, default `90`, range `7–365`) — price history window
- `limit_to_top_n` (int, default `10`, range `2–50`) — cap the matrix to top N markets by volume

**Response** `200`
```json
{
  "matrix": [
    { "market_a_id": 501, "market_b_id": 502, "r_value": 0.83, "r_squared": 0.69 }
  ],
  "markets": {
    "501": { "title": "…", "polymarketId": "0x…", "eventTitle": "…" }
  },
  "significant_pairs": [
    {
      "market_a_id": 501,
      "market_a_title": "…",
      "market_a_event": "…",
      "market_b_id": 502,
      "market_b_title": "…",
      "market_b_event": "…",
      "r_value": 0.83,
      "r_squared": 0.69,
      "correlation_type": "positive"
    }
  ],
  "data_points": 1872,
  "date_range": { "start": "2026-01-15T00:00:00+00:00", "end": "2026-04-15T00:00:00+00:00" },
  "threshold": 0.7,
  "cluster_name": "Republican Primary Candidates",
  "analyzed_at": "2026-04-15T12:00:00+00:00"
}
```

Empty `matrix` + empty `significant_pairs` when fewer than 2 markets have usable price history.

**Response** `404`
```json
{ "detail": "Cluster 99 not found" }
```

---

## OASIS-style Simulation

Multi-agent Reddit-style simulation over one supercluster. Each market becomes an agent with an LLM-generated persona; agents post, reply, and adopt stances across multiple rounds. Heuristic scoring + LLM synthesis produce ranked hedge candidates.

All run state is in-memory (no DB tables); completed runs are flushed to `backend/runs/{run_id}.json` for replay. Use the SSE stream endpoint to power a live viewer.

Model resolution: primary is `gemini-2.5-pro` (premium) / `gemini-2.5-flash` (cheap). On transient errors (503, 429, 500) calls automatically fall back down the chain `2.5-pro → 2.5-flash → 2.0-flash → 1.5-flash`.

### `GET /oasis-simulation/superclusters`

Dropdown-friendly list of every supercluster with market count and a `has_graph` flag (true when the supercluster has any markets, i.e. is simulate-ready).

**Response** `200`
```json
{
  "superclusters": [
    { "id": 7, "name": "Business & Tech", "market_count": 1167, "has_graph": true }
  ]
}
```

### `POST /oasis-simulation/superclusters/{super_cluster_id}/run`

Trigger a new simulation run. Returns immediately with a `run_id`; the pipeline runs asynchronously in-process.

**Body** (all optional overrides):
```json
{
  "agent_cap": 30,
  "rounds": 5,
  "synthesize_top_n": 5,
  "cheap_model": "gemini-2.5-flash",
  "premium_model": "gemini-2.5-pro"
}
```

**Response** `200`
```json
{
  "status": "started",
  "run_id": "43eef8f0-e61b-45c8-8600-16a963df90c8",
  "super_cluster_id": 6,
  "supercluster_name": "Major Tech",
  "overrides": { "agent_cap": 6, "rounds": 2, "synthesize_top_n": 2 }
}
```

**Response** `404`
```json
{ "detail": "SuperCluster 99 not found" }
```

### `GET /oasis-simulation/runs`

List all runs in memory (newest first).

**Response** `200`
```json
{
  "runs": [
    {
      "run_id": "43eef8f0-e61b-45c8-8600-16a963df90c8",
      "super_cluster_id": 6,
      "status": "completed",
      "current_step": "synthesizing hedges",
      "started_at": "2026-04-15T13:26:11.123",
      "completed_at": "2026-04-15T13:26:45.987",
      "agent_count": 6,
      "action_count": 12,
      "hedge_count": 2
    }
  ]
}
```

### `GET /oasis-simulation/superclusters/{super_cluster_id}/runs`

Same shape as above, filtered to one supercluster.

**Query params:**
- `limit` (int, default `20`, range `1–100`)

**Response** `200`
```json
{ "super_cluster_id": 6, "runs": [ /* run summaries */ ] }
```

### `GET /oasis-simulation/runs/{run_id}`

Fetch one run with agent list and synthesized hedges.

**Response** `200`
```json
{
  "run": {
    "run_id": "43eef8f0-…",
    "super_cluster_id": 6,
    "status": "completed",
    "current_step": "synthesizing hedges",
    "rounds_completed": 2,
    "started_at": "2026-04-15T13:26:11.123",
    "completed_at": "2026-04-15T13:26:45.987",
    "error": null,
    "config": { "agent_cap": 6, "rounds": 2, "synthesize_top_n": 2 },
    "agent_count": 6,
    "action_count": 12,
    "hedge_count": 2
  },
  "agents": [
    {
      "market_id": 66,
      "cluster_id": 2204,
      "market_title": "GTA VI released before June 2026?",
      "event_title": "GTA VI released before June 2026?",
      "cluster_name": "GTA VI",
      "name": "GTASixCopium",
      "bio": "Grinds release-window markets since 2012.",
      "persona": "Believes hype cycles always slip. Bets YES late when leaks land.",
      "interests": ["rockstar", "release-windows", "tech-leaks"]
    }
  ],
  "hedges": [
    {
      "rank": 1,
      "market_a_id": 66,
      "market_b_id": 1033,
      "market_a_title": "GTA VI released before June 2026?",
      "market_b_title": "Grok 5 released by March 31, 2026?",
      "market_a_cluster_id": 2204,
      "market_b_cluster_id": 2292,
      "confidence_score": 72,
      "direction": "negative",
      "reasoning": "Multi-paragraph explanation …",
      "key_factors": ["shared release-delay sentiment", "…"],
      "co_movement_score": 0.25,
      "interaction_score": 1.0,
      "contradiction_score": 0.75,
      "hedge_score": 0.525,
      "recommended_combo": "YES GTA VI + NO Grok 5"
    }
  ]
}
```

**Response** `404`
```json
{ "detail": "Run 7c32bc7e-… not found" }
```

### `GET /oasis-simulation/runs/{run_id}/actions`

Paginated action history. Used for backfill when the SSE connection drops mid-run, or to browse completed runs.

**Query params:**
- `after_sequence` (int, default `0`) — only actions with `sequence > after_sequence`
- `limit` (int, default `500`, range `1–2000`)

**Response** `200`
```json
{
  "run_id": "43eef8f0-…",
  "after_sequence": 0,
  "count": 12,
  "actions": [
    {
      "id": 1,
      "round_number": 1,
      "sequence": 1,
      "agent_market_id": 66,
      "agent_name": "GTASixCopium",
      "action_type": "post",
      "target_market_id": null,
      "parent_action_id": null,
      "title": "Another delay incoming?",
      "content": "Rockstar's quarterly has zero hard date commits…",
      "stance": "bearish",
      "created_at": "2026-04-15T13:26:12.484"
    }
  ]
}
```

### `GET /oasis-simulation/runs/{run_id}/stream`

**Server-Sent Events** stream for live viewers. Sends a backfill `snapshot` event first, then streams incremental events as they happen. Emits a keepalive comment every 15s. Connection terminates cleanly with an `end` event when the run finishes.

**Media type:** `text/event-stream`

**Event types:**

| Event        | When                                         | Data shape                                                                 |
| ------------ | -------------------------------------------- | -------------------------------------------------------------------------- |
| `snapshot`   | Immediately on connect                       | `{ run_id, status, current_step, rounds_completed, agents, actions, hedges }` |
| `status`     | Pipeline step change                         | `{ type, step, status, round? }`                                           |
| `agents`     | Personas generated                           | `{ type, data: AgentSpec[] }`                                              |
| `action`     | An agent just posted / replied / skipped     | `{ type, data: AgentAction }`                                              |
| `hedge`      | A synthesized hedge is ready                 | `{ type, data: SynthesizedHedge }`                                         |
| `completed`  | Pipeline finished successfully               | `{ type, run_id }`                                                         |
| `failed`     | Pipeline errored                             | `{ type, error }`                                                          |
| `end`        | Stream terminating (always the last event)   | `{ status }`                                                               |

**Example (JavaScript):**
```js
const es = new EventSource(`/oasis-simulation/runs/${runId}/stream`);
es.addEventListener("snapshot", (e) => hydrate(JSON.parse(e.data)));
es.addEventListener("action", (e) => appendAction(JSON.parse(e.data).data));
es.addEventListener("hedge", (e) => appendHedge(JSON.parse(e.data).data));
es.addEventListener("end", () => es.close());
```

**Example (curl):**
```bash
curl -N -H "Accept: text/event-stream" \
  http://localhost:8000/oasis-simulation/runs/$RUN_ID/stream
```

**Response** `404`
```json
{ "detail": "Run 7c32bc7e-… not found" }
```
