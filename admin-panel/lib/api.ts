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

export interface HedgeMatrixCombo {
    label: string
    side_a: 'YES' | 'NO'
    side_b: 'YES' | 'NO'
    price_a: number
    price_b: number
    scenarios: Record<string, { profit_usd: number; return_pct?: number; indep_prob?: number }>
    expected_profit_usd: number
    worst_case_profit_usd: number
    best_case_profit_usd: number
}

export interface HedgeMatrix {
    prob_a: number
    prob_b: number
    stake_per_leg_usd: number
    total_stake_usd: number
    combos: HedgeMatrixCombo[]
    best_hedge_label: string
    best_hedge_worst_case_usd: number
}

export interface StructuredHedgePayload {
    context?: { real_world_summary?: string; correlation_mechanism?: string }
    hedge_rationale?: {
        why_hedge?: string
        profit_paths?: { scenario: string; profit_usd?: number; explanation: string }[]
        loss_paths?: { scenario: string; profit_usd?: number; explanation: string }[]
        impossible_outcomes?: { scenario: string; reason: string }[]
    }
    recommended_bet?: {
        combo: string
        leg_a: { market_id: number; side: 'YES' | 'NO'; price: number; stake_usd: number }
        leg_b: { market_id: number; side: 'YES' | 'NO'; price: number; stake_usd: number }
        total_stake_usd?: number
        expected_profit_usd?: number
        worst_case_usd?: number
        best_case_usd?: number
    }
    confidence_score?: number
    direction?: string
    key_factors?: string[]
}

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
    hedge_matrix: HedgeMatrix | null
    structured_payload: StructuredHedgePayload | null
    matrix_verified: boolean | null
    recommended_combo: string | null
    input_snapshot: Record<string, unknown> | null
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

    async listAllRuns(limit = 100): Promise<RunSummary[]> {
        try {
            const response = await axios.get('/oasis-simulation/runs', { params: { limit } })
            return response.data.runs
        } catch (error) {
            // Compatibility fallback:
            // Some backend variants expose only per-supercluster run listing.
            const isMissingGlobalRunsRoute =
                axios.isAxiosError(error) && error.response?.status === 404

            if (!isMissingGlobalRunsRoute) throw error

            const superclusters = await simulationApi.listSuperclusters()
            const perCluster = await Promise.all(
                superclusters.map((sc) =>
                    simulationApi
                        .listRunsForSupercluster(sc.id, limit)
                        .catch(() => [] as RunSummary[])
                )
            )

            const merged = perCluster.flat()
            const deduped = new Map<string, RunSummary>()
            for (const run of merged) deduped.set(run.id, run)

            const sorted = Array.from(deduped.values()).sort((a, b) => {
                const aTs = Date.parse(a.created_at || a.started_at || '')
                const bTs = Date.parse(b.created_at || b.started_at || '')
                return (Number.isNaN(bTs) ? 0 : bTs) - (Number.isNaN(aTs) ? 0 : aTs)
            })

            return sorted.slice(0, limit)
        }
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
            synthesis_model: string
        }> = {}
    ): Promise<{ status: string; super_cluster_id: number; supercluster_name: string }> {
        const response = await axios.post(
            `/oasis-simulation/superclusters/${superClusterId}/run`,
            overrides
        )
        return response.data
    },

    async reviewHedge(
        hedgeId: number,
        action: 'approve' | 'reject',
        adminNotes?: string,
        reviewedBy?: string
    ): Promise<SynthesizedHedge> {
        const response = await axios.post(`/oasis-simulation/hedges/${hedgeId}/review`, {
            action,
            admin_notes: adminNotes,
            reviewed_by: reviewedBy,
        })
        return response.data
    },

    async resynthesizeHedge(
        hedgeId: number,
        synthesisModel?: string
    ): Promise<SynthesizedHedge> {
        const response = await axios.post(
            `/oasis-simulation/hedges/${hedgeId}/resynthesize`,
            synthesisModel ? { synthesis_model: synthesisModel } : {}
        )
        return response.data
    },

    async patchHedgePayload(
        hedgeId: number,
        payload: Record<string, unknown>
    ): Promise<SynthesizedHedge> {
        const response = await axios.post(`/oasis-simulation/hedges/${hedgeId}/payload`, {
            structured_payload: payload,
        })
        return response.data
    },
}

/** Build the WebSocket URL for the live action stream. Protocol-aware. */
export function simulationFeedUrl(runId: string): string {
    const baseUrl = (axios.defaults.baseURL || 'http://localhost:8000') as string
    const httpUrl = baseUrl.startsWith('http') ? baseUrl : `http://${baseUrl}`
    const wsUrl = httpUrl.replace(/^http/, 'ws')
    return `${wsUrl}/ws/simulation/${runId}`
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
