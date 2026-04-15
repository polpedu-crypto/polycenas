# polycenas

Hackathon demo: OASIS Reddit-style multi-agent simulation surfacing cross-market hedges on Polymarket prediction markets.

## Repo layout

- `admin-panel/` — Next.js 16 + React 19 + Tailwind v4 admin UI (port 3001). No auth. Observes/controls the agents network.
- `backend/` — Python + FastAPI + Uvicorn + Prisma (Python client). Empty scaffold, to be built.

## Admin panel routes

- `/dashboard` — logo + live stats (active agents, messages, decisions) + quick actions
- `/agents` — **live view** of the agents network: roster (left) + conversation feed (right), polling every 2s
- `/multibets` — cross-event hedges surfaced by debate (clusters + inferences tabs)

## Backend contract the admin panel expects

### Agents (new, required for `/dashboard` + `/agents`)

```ts
GET  /api/agents                                 → Agent[]
GET  /api/agents/messages?since=<ISO>&limit=N    → AgentMessage[]

type Agent = {
  id: string
  name: string
  role: string
  status: 'idle' | 'thinking' | 'speaking' | 'offline'
  colorHex?: string
}

type AgentMessage = {
  id: string                                     // stable, used for dedup
  agentId: string
  agentName: string
  agentRole: string
  content: string
  timestamp: string                              // ISO
  type: 'message' | 'decision' | 'tool_call'
  metadata?: Record<string, any>
}
```

Polling: admin panel polls `/api/agents/messages` every 2s with the last-seen `timestamp` as `since`, dedupes by `id`. Initial fetch uses no `since`.

### Multibets / markets / map (required for `/multibets`)

Endpoints and exact response shapes are defined in `admin-panel/lib/api.ts` — types `MultibetInference`, `ClusterAnalysisInfo`, `FullAnalysisStatus`, `PaginationResponse<T>`. Backend must match 1:1.

```
GET   /api/multibets/admin/clusters?skip&limit&search
GET   /api/multibets/admin/pending?skip&limit
GET   /api/multibets/admin/all?status&skip&limit
GET   /api/multibets/admin/:clusterId/details
POST  /api/multibets/admin/clusters/:clusterId/full-analysis?force
GET   /api/multibets/admin/clusters/:clusterId/analysis-status
POST  /api/multibets/admin/:clusterId/review              body: { action, admin_notes, reviewed_by }

GET   /api/markets/processing/status                      → { enabled: boolean }
POST  /api/markets/processing/toggle                      → { enabled: boolean, message: string }

POST  /api/map/recluster                                  → { message: string }
```

## Configuration

- `admin-panel/.env.local` (copy from `.env.local.example`): `NEXT_PUBLIC_API_URL=http://localhost:8000`
- `admin-panel/lib/axios.ts` — baseURL only; no auth interceptors.

## TODO
  
### Backend (blocker for any live demo)
- [ ] Stand up FastAPI app on port 8000 (CORS allow `http://localhost:3001`)
- [ ] Implement `/api/agents` + `/api/agents/messages` — this is the demo's "wow" moment
- [ ] Implement multibets / markets / map endpoints matching `admin-panel/lib/api.ts` schemas 1:1
- [ ] Prisma schema for agents, messages, clusters, inferences, markets

### Admin panel (after backend is up)
- [ ] End-to-end wiring pass — hit each endpoint from the UI, verify payload shapes match the TypeScript types, fix any drift
- [ ] Smoke-test `/agents` with live messages flowing (polling cadence, auto-scroll, dedup under load)
- [ ] Verify error/loading states surface correctly when backend restarts mid-demo

### Nice-to-have (only if time permits)
- [ ] Swap agents polling to SSE or WebSocket for lower latency (small refactor in `app/agents/page.tsx` + `lib/api.ts`)
- [ ] Simple network-graph viz on `/agents` showing who's replying to whom
- [ ] Filter the feed by agent, message type, or keyword
- [ ] Persist feed scroll position / filter state across route changes

### Explicitly out of scope
- Auth — the admin panel is deliberately unprotected for the hackathon demo.
- Demo/mock mode — agents run live; no canned fixtures.
