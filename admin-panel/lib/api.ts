import axios from './axios'

// ───────────────────────── Superclusters ─────────────────────────

export interface SuperclusterSummary {
    id: number
    name: string | null
    market_count: number
    has_graph: boolean
    graph_id: number | null
}

// ───────────────────────── Simulation runs ───────────────────────

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed'

/** Matches `serialize_run` in backend/app/services/simulation/serializers.py. */
export interface RunSummary {
    id: string
    super_cluster_id: number
    status: RunStatus
    agent_count: number
    market_count: number
    rounds: number
    platform_type: string
    cheap_model: string
    premium_model: string
    synthesis_model: string
    canonical_graph_id: number | null
    simulation_graph_id: number | null
    started_at: string
    completed_at: string | null
    error_message: string | null
    total_llm_calls: number | null
    total_cost_usd: number | null
    created_at: string
}

export type AgentActionType = 'post' | 'reply' | 'stance_change' | 'skip'
export type AgentStance = 'bullish' | 'bearish' | 'neutral'

/** Matches `serialize_action`. */
export interface AgentAction {
    id: number
    sequence: number
    round: number
    agent_market_id: number
    agent_name: string
    action_type: AgentActionType
    parent_action_id: number | null
    target_market_id: number | null
    title: string | null
    content: string | null
    stance: AgentStance | null
    created_at: string
}

export type HedgeStatus = 'pending' | 'approved' | 'rejected'

/** Matches `serialize_hedge`. */
export interface SynthesizedHedge {
    id: number
    simulation_run_id: string
    rank: number
    market_a_id: number
    market_b_id: number
    market_a_title: string
    market_b_title: string
    market_a_event_title: string | null
    market_b_event_title: string | null
    market_a_cluster_id: number | null
    market_b_cluster_id: number | null
    confidence_score: number
    direction: string
    reasoning: string
    key_factors: string[]
    co_movement_score: number
    interaction_score: number
    contradiction_score: number
    hedge_score: number
    correlation_r: number | null
    status: HedgeStatus
    admin_notes: string | null
    reviewed_at: string | null
    reviewed_by: string | null
    created_at: string
    hedge_matrix: any | null
    structured_payload: any | null
    matrix_verified: boolean | null
    recommended_combo: string | null
    input_snapshot: any | null
}

export interface RunDetail {
    run: RunSummary
    hedges: SynthesizedHedge[]
}

export const simulationApi = {
    async listSuperclusters(): Promise<SuperclusterSummary[]> {
        const response = await axios.get('/oasis-simulation/superclusters')
        return response.data.superclusters
    },

    async listRunsForSupercluster(superClusterId: number, limit = 100): Promise<RunSummary[]> {
        const response = await axios.get(
            `/oasis-simulation/superclusters/${superClusterId}/runs`,
            { params: { limit } }
        )
        return response.data.runs
    },

    /** Fan-out: list every supercluster then aggregate their runs. */
    async listAllRuns(): Promise<RunSummary[]> {
        const superclusters = await simulationApi.listSuperclusters()
        const lists = await Promise.all(
            superclusters
                .filter((s) => s.has_graph)
                .map((s) => simulationApi.listRunsForSupercluster(s.id).catch(() => [] as RunSummary[]))
        )
        const all = lists.flat()
        all.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''))
        return all
    },

    async getRun(runId: string): Promise<RunDetail> {
        const response = await axios.get(`/oasis-simulation/runs/${runId}`)
        return response.data
    },

    async getActions(runId: string, afterSequence = 0, limit = 500): Promise<AgentAction[]> {
        const response = await axios.get(`/oasis-simulation/runs/${runId}/actions`, {
            params: { after_sequence: afterSequence, limit },
        })
        return response.data.actions
    },

    async triggerRun(
        superClusterId: number,
        overrides: Partial<{
            agent_cap: number
            rounds: number
            synthesize_top_n: number
            cheap_model: string
            premium_model: string
        }> = {}
    ): Promise<{ status: string; super_cluster_id: number; supercluster_name: string }> {
        const response = await axios.post(
            `/oasis-simulation/superclusters/${superClusterId}/run`,
            overrides
        )
        return response.data
    },
}

// ───────────────────────── Multibets (hedge view) ─────────────────

export type MultibetRow = SynthesizedHedge & { run_completed_at: string | null }

export const multibetsApi = {
    /** Flatten synthesized hedges from every completed run. */
    async listAll(): Promise<MultibetRow[]> {
        const runs = await simulationApi.listAllRuns()
        const completed = runs.filter((r) => r.status === 'completed')
        const details = await Promise.all(
            completed.map((r) => simulationApi.getRun(r.id).catch(() => null))
        )
        const rows: MultibetRow[] = []
        details.forEach((d) => {
            if (!d) return
            d.hedges.forEach((h) => {
                rows.push({ ...h, run_completed_at: d.run.completed_at })
            })
        })
        rows.sort((a, b) => b.confidence_score - a.confidence_score)
        return rows
    },

    async getOne(runId: string, rank: number): Promise<MultibetRow | null> {
        const detail = await simulationApi.getRun(runId)
        const hedge = detail.hedges.find((h) => h.rank === rank)
        if (!hedge) return null
        return { ...hedge, run_completed_at: detail.run.completed_at }
    },
}
