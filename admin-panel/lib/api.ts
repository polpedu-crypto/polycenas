import axios from './axios'

// ───────────────────────── Superclusters ─────────────────────────

export interface SuperclusterSummary {
    id: number
    name: string | null
    market_count: number
    has_graph: boolean
}

// ───────────────────────── Simulation runs ───────────────────────

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface RunSummary {
    run_id: string
    super_cluster_id: number
    status: RunStatus
    current_step: string
    started_at: string
    completed_at: string | null
    agent_count: number
    action_count: number
    hedge_count: number
}

export interface AgentSpec {
    market_id: number
    cluster_id: number
    market_title: string
    event_title: string | null
    cluster_name: string | null
    name: string
    bio: string
    persona: string
    interests: string[]
}

export type AgentActionType = 'post' | 'reply' | 'stance_change' | 'skip'
export type AgentStance = 'bullish' | 'bearish' | 'neutral'

export interface AgentAction {
    id: number
    round_number: number
    sequence: number
    agent_market_id: number
    agent_name: string
    action_type: AgentActionType
    target_market_id: number | null
    parent_action_id: number | null
    title: string | null
    content: string | null
    stance: AgentStance | null
    created_at: string
}

export interface SynthesizedHedge {
    rank: number
    market_a_id: number
    market_b_id: number
    market_a_title: string
    market_b_title: string
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
    recommended_combo: string | null
}

export interface RunDetail {
    run: {
        run_id: string
        super_cluster_id: number
        status: RunStatus
        current_step: string
        rounds_completed: number
        started_at: string
        completed_at: string | null
        error: string | null
        config: Record<string, any>
        agent_count: number
        action_count: number
        hedge_count: number
    }
    agents: AgentSpec[]
    hedges: SynthesizedHedge[]
}

export const simulationApi = {
    async listSuperclusters(): Promise<SuperclusterSummary[]> {
        const response = await axios.get('/oasis-simulation/superclusters')
        return response.data.superclusters
    },

    async listRuns(): Promise<RunSummary[]> {
        const response = await axios.get('/oasis-simulation/runs')
        return response.data.runs
    },

    async getRun(runId: string): Promise<RunDetail> {
        const response = await axios.get(`/oasis-simulation/runs/${runId}`)
        return response.data
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
    ): Promise<{ status: string; run_id: string; super_cluster_id: number; supercluster_name: string }> {
        const response = await axios.post(
            `/oasis-simulation/superclusters/${superClusterId}/run`,
            overrides
        )
        return response.data
    },
}

// ───────────────────────── Multibets (hedge view) ─────────────────

/** A hedge joined with the run it came from — used for the cross-run multibets list. */
export interface MultibetRow extends SynthesizedHedge {
    run_id: string
    super_cluster_id: number
    run_completed_at: string | null
}

export const multibetsApi = {
    /** Flatten synthesized hedges from every completed run. */
    async listAll(): Promise<MultibetRow[]> {
        const runs = await simulationApi.listRuns()
        const completed = runs.filter((r) => r.status === 'completed' && r.hedge_count > 0)
        const details = await Promise.all(completed.map((r) => simulationApi.getRun(r.run_id)))
        const rows: MultibetRow[] = []
        details.forEach((d) => {
            d.hedges.forEach((h) => {
                rows.push({
                    ...h,
                    run_id: d.run.run_id,
                    super_cluster_id: d.run.super_cluster_id,
                    run_completed_at: d.run.completed_at,
                })
            })
        })
        rows.sort((a, b) => b.confidence_score - a.confidence_score)
        return rows
    },

    async getOne(runId: string, rank: number): Promise<MultibetRow | null> {
        const detail = await simulationApi.getRun(runId)
        const hedge = detail.hedges.find((h) => h.rank === rank)
        if (!hedge) return null
        return {
            ...hedge,
            run_id: detail.run.run_id,
            super_cluster_id: detail.run.super_cluster_id,
            run_completed_at: detail.run.completed_at,
        }
    },
}
