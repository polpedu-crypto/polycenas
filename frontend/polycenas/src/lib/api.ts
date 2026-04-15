import axios from 'axios'

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:8000'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed'
export type AgentActionType = 'post' | 'reply' | 'stance_change' | 'skip'
export type AgentStance = 'bullish' | 'bearish' | 'neutral'
export type HedgeStatus = 'pending' | 'approved' | 'rejected'

export interface SuperclusterSummary {
  id: number
  name: string | null
  market_count: number
  has_graph: boolean
  graph_id: number | null
}

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
    const response = await api.get('/oasis-simulation/superclusters')
    return response.data.superclusters
  },

  async listRunsForSupercluster(superClusterId: number, limit = 100): Promise<RunSummary[]> {
    const response = await api.get(`/oasis-simulation/superclusters/${superClusterId}/runs`, {
      params: { limit },
    })
    return response.data.runs
  },

  async listAllRuns(limit = 100): Promise<RunSummary[]> {
    const response = await api.get('/oasis-simulation/runs', { params: { limit } })
    return response.data.runs
  },

  async getRun(runId: string): Promise<RunDetail> {
    const response = await api.get(`/oasis-simulation/runs/${runId}`)
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
      synthesis_model: string
    }> = {},
  ): Promise<{ status: string; super_cluster_id: number; supercluster_name: string }> {
    const response = await api.post(`/oasis-simulation/superclusters/${superClusterId}/run`, overrides)
    return response.data
  },
}

export function simulationFeedUrl(runId: string): string {
  const base = API_BASE_URL.startsWith('http') ? API_BASE_URL : `http://${API_BASE_URL}`
  return `${base.replace(/^http/, 'ws')}/ws/simulation/${runId}`
}
