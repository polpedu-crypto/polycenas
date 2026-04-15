import axios from './axios'

// Types
export interface MultibetInference {
    id: number
    clusterId: number
    clusterName: string | null
    status: 'pending' | 'approved' | 'rejected' | 'no_cross_events'
    confidenceScore: number
    direction: 'positive' | 'negative'
    marketAId: number
    marketATitle: string
    marketAEventTitle: string
    marketBId: number
    marketBTitle: string
    marketBEventTitle: string
    correlationR: number | null
    newsOverlap: number | null
    featureOverlap: number | null
    keyFactors: string[]
    reasoning: string
    createdAt: string
    reviewedAt: string | null
    reviewedBy: string | null
    adminNotes: string | null
    inputSnapshot?: any
}

export interface ClusterAnalysisInfo {
    id: number
    name: string | null
    keywords: string[]
    totalVolume: number | null
    marketCount: number
    hasCorrelation: boolean
    correlationSource: string | null
    hasNews: boolean
    newsCount: number
    multibetStatus: string | null
    multibetScore: number | null
    isAnalysisRunning: boolean
    analysisProgress: string | null
}

export interface FullAnalysisStatus {
    status: 'not_running' | 'running' | 'completed' | 'failed'
    progress?: string
    error?: string
    result?: any
}

export interface PaginationResponse<T> {
    data: T[]
    pagination: {
        skip: number
        limit: number
        total: number
        hasMore: boolean
    }
}

export interface Agent {
    id: string
    name: string
    role: string
    status: 'idle' | 'thinking' | 'speaking' | 'offline'
    colorHex?: string
}

export interface AgentMessage {
    id: string
    agentId: string
    agentName: string
    agentRole: string
    content: string
    timestamp: string
    type: 'message' | 'decision' | 'tool_call'
    metadata?: Record<string, any>
}

export const agentsApi = {
    async list(): Promise<Agent[]> {
        const response = await axios.get('/api/agents')
        return response.data
    },
    async messages(since?: string, limit: number = 100): Promise<AgentMessage[]> {
        const params: any = { limit }
        if (since) params.since = since
        const response = await axios.get('/api/agents/messages', { params })
        return response.data
    },
}

// API Methods
export const multibetsApi = {
    admin: {
        // Get all clusters with their analysis status
        async getClusters(
            skip: number = 0,
            limit: number = 50,
            search?: string
        ): Promise<PaginationResponse<ClusterAnalysisInfo>> {
            const params: any = { skip, limit }
            if (search) params.search = search
            const response = await axios.get('/api/multibets/admin/clusters', { params })
            return response.data
        },

        // Get pending inferences
        async getPending(
            skip: number = 0,
            limit: number = 20
        ): Promise<PaginationResponse<MultibetInference>> {
            const response = await axios.get('/api/multibets/admin/pending', {
                params: { skip, limit }
            })
            return response.data
        },

        // Get all inferences with optional status filter
        async getAll(
            status: string | null,
            skip: number = 0,
            limit: number = 20
        ): Promise<PaginationResponse<MultibetInference>> {
            const params: any = { skip, limit }
            if (status) params.status = status
            const response = await axios.get('/api/multibets/admin/all', { params })
            return response.data
        },

        // Get inference details
        async getDetails(clusterId: number): Promise<MultibetInference> {
            const response = await axios.get(`/api/multibets/admin/${clusterId}/details`)
            return response.data
        },

        // Run full analysis for a cluster
        async runFullAnalysis(clusterId: number, force: boolean = false): Promise<any> {
            const response = await axios.post(
                `/api/multibets/admin/clusters/${clusterId}/full-analysis`,
                null,
                { params: { force } }
            )
            return response.data
        },

        // Get analysis status
        async getAnalysisStatus(clusterId: number): Promise<FullAnalysisStatus> {
            const response = await axios.get(
                `/api/multibets/admin/clusters/${clusterId}/analysis-status`
            )
            return response.data
        },

        // Review inference
        async review(
            clusterId: number,
            action: 'approve' | 'reject',
            adminNotes?: string,
            reviewedBy?: string
        ): Promise<MultibetInference> {
            const response = await axios.post(`/api/multibets/admin/${clusterId}/review`, {
                action,
                admin_notes: adminNotes,
                reviewed_by: reviewedBy
            })
            return response.data
        }
    }
}

export const marketsApi = {
    // Get processing status
    async getProcessingStatus(): Promise<{ enabled: boolean }> {
        const response = await axios.get('/api/markets/processing/status')
        return response.data
    },

    // Toggle processing
    async toggleProcessing(): Promise<{ enabled: boolean; message: string }> {
        const response = await axios.post('/api/markets/processing/toggle')
        return response.data
    }
}

export const mapApi = {
    // Trigger reclustering
    async recluster(): Promise<{ message: string }> {
        const response = await axios.post('/api/map/recluster')
        return response.data
    }
}
