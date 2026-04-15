# Polycenas — OASIS Simulation MVP

Hackathon MVP of the OASIS Reddit-style multi-agent simulation for Polymarket prediction markets.

Agents (one per market) debate on a simulated Reddit platform across multiple rounds, surfacing cross-market hedges through emergent discussion patterns rather than pure statistical correlation.

## Architecture

```
polycenas/
├── backend/          # Python + Uvicorn (FastAPI)
│   ├── prisma/       # Local Prisma schema for this project
│   └── ...
└── README.md
```

**Standalone app** — everything lives inside `polycenas/`.

## Stack

| Layer    | Tech                                                |
| -------- | --------------------------------------------------- |
| Backend  | Python, FastAPI, Uvicorn                            |
| Database | PostgreSQL                                          |
| ORM      | Prisma Client Python (`prisma-client-py`)           |
| LLM      | Gemini 2.5 Flash (naming), TBD (agents, synthesis)  |

## Database & Prisma

We connect to the project PostgreSQL database for MVP.

The Prisma schema here only defines the models we actually query. Current candidates:

| Model              | Why we need it                                               |
| ------------------ | ------------------------------------------------------------ |
| `Market`           | Agent identity — each agent represents one market            |
| `SuperCluster`     | Scopes a simulation run to a group of related markets        |
| `Cluster`          | Market groupings within a supercluster                       |
| `ClusterMarket`    | Join table to resolve which markets belong to which clusters |
| `SimulationRun`    | Top-level run record (config, status, cost tracking)         |
| `SimulationAction` | Every post/reply/stance-change an agent makes                |
| `SimulationHedge`  | Ranked hedge pairs extracted after simulation                |
| `NewsArticle`      | Optional — seed stimulus for round-0 context                 |

Models like `PricePoint`, `PriceFeature`, `EmbeddingConfig`, `MultibetInference`, etc. can be dropped from our local schema since we won't query them.

> **Rule of thumb:** if a model you include has a `@relation` to another model, either include that model too or remove the relation field. The DB tables still exist either way — Prisma just won't generate client code for omitted models.

## MVP Scope

The goal is a working end-to-end loop:

1. **Pick a SuperCluster** — select a group of related markets
2. **Spawn agents** — one agent per market, each with a persona and market context
3. **Run rounds** — agents post and reply on a simulated Reddit-like forum
4. **Extract hedges** — analyze discussion patterns to surface cross-market hedge pairs
5. **Display results** — minimal UI or API response showing the simulation feed + ranked hedges

### Out of scope for MVP

- Admin approval workflow
- Zep graph integration (canonical/simulation graph diffs)
- Cost optimization / token budgeting
- Production deployment

## Getting Started

```bash
cd polycenas/backend

# Create venv and install deps
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Set up env
cp .env.example .env
# Edit .env with your DATABASE_URL and LLM API keys

# Generate Prisma client
prisma generate

# Run
uvicorn app.main:app --reload --port 8000
```

## Environment Variables

| Variable        | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `DATABASE_URL`  | PostgreSQL connection string |
| `VERTEX_API_KEY` | Gemini API key for cluster/super-cluster naming              |

## Reference

- [OASIS paper](https://arxiv.org/abs/2411.11581) — the multi-agent social simulation framework this is based on
