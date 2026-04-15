'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
    ArrowLeft,
    RefreshCw,
    Check,
    X,
    ChevronDown,
    ChevronUp,
    Clock,
    CheckCircle,
    XCircle,
    Filter,
    Loader2,
    TrendingUp,
    TrendingDown,
    Newspaper,
    Link2,
    Play,
    Search,
    Database,
    Zap,
    BarChart,
    AlertCircle,
    GitBranch,
    Power,
} from 'lucide-react'
import {
    multibetsApi,
    marketsApi,
    mapApi,
    type MultibetInference,
    type ClusterAnalysisInfo,
    type FullAnalysisStatus,
} from '@/lib/api'

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'no_cross_events'
type MainTab = 'clusters' | 'inferences'

function cn(...classes: (string | boolean | undefined)[]) {
    return classes.filter(Boolean).join(' ')
}

export default function MultibetsPage() {
    // Main tab state
    const [mainTab, setMainTab] = useState<MainTab>('clusters')

    // Processing and recluster state
    const [processingEnabled, setProcessingEnabled] = useState<boolean | null>(null)
    const [processingLoading, setProcessingLoading] = useState(false)
    const [reclusterLoading, setReclusterLoading] = useState(false)
    const [reclusterMessage, setReclusterMessage] = useState<string | null>(null)

    // Clusters state
    const [clusters, setClusters] = useState<ClusterAnalysisInfo[]>([])
    const [clustersLoading, setClustersLoading] = useState(true)
    const [clusterSearch, setClusterSearch] = useState('')
    const [clustersPagination, setClustersPagination] = useState({
        skip: 0,
        limit: 50,
        total: 0,
        hasMore: false,
    })
    const [runningAnalysis, setRunningAnalysis] = useState<Set<number>>(new Set())
    const [analysisStatuses, setAnalysisStatuses] = useState<Record<number, FullAnalysisStatus>>({})
    const [expandedClusterId, setExpandedClusterId] = useState<number | null>(null)
    const [clusterDiagnostics, setClusterDiagnostics] = useState<Record<number, any>>({})

    // Inferences state
    const [inferences, setInferences] = useState<MultibetInference[]>([])
    const [loading, setLoading] = useState(true)
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
    const [pagination, setPagination] = useState({
        skip: 0,
        limit: 20,
        total: 0,
        hasMore: false,
    })
    const [reviewingId, setReviewingId] = useState<number | null>(null)
    const [adminNotes, setAdminNotes] = useState('')

    const [clustersError, setClustersError] = useState<string | null>(null)
    const [inferencesError, setInferencesError] = useState<string | null>(null)

    // Fetch clusters
    const fetchClusters = useCallback(async () => {
        setClustersLoading(true)
        try {
            const result = await multibetsApi.admin.getClusters(
                clustersPagination.skip,
                clustersPagination.limit,
                clusterSearch || undefined
            )
            setClusters(result.data)
            setClustersPagination(result.pagination)
            setClustersError(null)
        } catch (error: any) {
            console.error('Failed to fetch clusters:', error)
            setClustersError(error?.response?.data?.detail || error?.message || 'Failed to fetch clusters')
        } finally {
            setClustersLoading(false)
        }
    }, [clustersPagination.skip, clustersPagination.limit, clusterSearch])

    // Fetch inferences
    const fetchInferences = useCallback(async () => {
        setLoading(true)
        try {
            const result =
                statusFilter === 'all'
                    ? await multibetsApi.admin.getAll(null, pagination.skip, pagination.limit)
                    : statusFilter === 'pending'
                        ? await multibetsApi.admin.getPending(pagination.skip, pagination.limit)
                        : await multibetsApi.admin.getAll(statusFilter, pagination.skip, pagination.limit)

            setInferences(result.data)
            setPagination(result.pagination)
            setInferencesError(null)
        } catch (error: any) {
            console.error('Failed to fetch inferences:', error)
            setInferencesError(error?.response?.data?.detail || error?.message || 'Failed to fetch inferences')
        } finally {
            setLoading(false)
        }
    }, [statusFilter, pagination.skip, pagination.limit])

    useEffect(() => {
        if (mainTab === 'clusters') {
            fetchClusters()
        } else {
            fetchInferences()
        }
    }, [mainTab, fetchClusters, fetchInferences])

    // Fetch processing status on mount
    useEffect(() => {
        const fetchProcessingStatus = async () => {
            try {
                const status = await marketsApi.getProcessingStatus()
                setProcessingEnabled(status.enabled)
            } catch (error) {
                console.error('Failed to fetch processing status:', error)
            }
        }
        fetchProcessingStatus()
    }, [])

    // Toggle auto processing
    const handleToggleProcessing = async () => {
        setProcessingLoading(true)
        try {
            const result = await marketsApi.toggleProcessing()
            setProcessingEnabled(result.enabled)
        } catch (error) {
            console.error('Failed to toggle processing:', error)
        } finally {
            setProcessingLoading(false)
        }
    }

    // Rebuild graph (recluster)
    const handleRecluster = async () => {
        setReclusterLoading(true)
        setReclusterMessage(null)
        try {
            const result = await mapApi.recluster()
            setReclusterMessage(result.message || 'Reclustering started')
            setTimeout(() => setReclusterMessage(null), 5000)
        } catch (error: any) {
            console.error('Failed to recluster:', error)
            setReclusterMessage(error.response?.data?.detail || 'Failed to start reclustering')
            setTimeout(() => setReclusterMessage(null), 5000)
        } finally {
            setReclusterLoading(false)
        }
    }

    // Poll for analysis status
    useEffect(() => {
        if (runningAnalysis.size === 0) return

        const interval = setInterval(async () => {
            for (const clusterId of runningAnalysis) {
                try {
                    const status = await multibetsApi.admin.getAnalysisStatus(clusterId)
                    setAnalysisStatuses((prev) => ({ ...prev, [clusterId]: status }))

                    if (status.status !== 'running') {
                        setRunningAnalysis((prev) => {
                            const next = new Set(prev)
                            next.delete(clusterId)
                            return next
                        })
                        fetchClusters()
                    }
                } catch (error) {
                    console.error(`Failed to get status for cluster ${clusterId}:`, error)
                }
            }
        }, 2000)

        return () => clearInterval(interval)
    }, [runningAnalysis, fetchClusters])

    // Run full analysis
    const handleRunAnalysis = async (clusterId: number) => {
        try {
            setRunningAnalysis((prev) => new Set(prev).add(clusterId))
            const result = await multibetsApi.admin.runFullAnalysis(clusterId)
            setAnalysisStatuses((prev) => ({
                ...prev,
                [clusterId]: { status: result.status, progress: result.progress },
            }))
        } catch (error: any) {
            console.error('Failed to run analysis:', error)
            setRunningAnalysis((prev) => {
                const next = new Set(prev)
                next.delete(clusterId)
                return next
            })
            setAnalysisStatuses((prev) => ({
                ...prev,
                [clusterId]: {
                    status: 'failed',
                    error: error.response?.data?.detail || error.message,
                },
            }))
        }
    }

    // Handle review action
    const handleReview = async (clusterId: number, action: 'approve' | 'reject') => {
        setReviewingId(clusterId)
        try {
            await multibetsApi.admin.review(clusterId, action, adminNotes || undefined, 'admin')
            setAdminNotes('')
            fetchInferences()
        } catch (error) {
            console.error('Failed to review inference:', error)
        } finally {
            setReviewingId(null)
        }
    }

    // Toggle expanded (inferences)
    const toggleExpanded = (id: number) => {
        setExpandedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    // Toggle cluster diagnostics view
    const toggleClusterExpanded = async (cluster: ClusterAnalysisInfo) => {
        if (expandedClusterId === cluster.id) {
            setExpandedClusterId(null)
            return
        }

        setExpandedClusterId(cluster.id)

        if (cluster.multibetStatus && !clusterDiagnostics[cluster.id]) {
            try {
                const inference = await multibetsApi.admin.getDetails(cluster.id)
                if (inference) {
                    setClusterDiagnostics((prev) => ({
                        ...prev,
                        [cluster.id]: inference,
                    }))
                }
            } catch (error) {
                console.error('Failed to fetch inference details:', error)
            }
        }
    }

    // Parse diagnostics from input snapshot
    const parseDiagnostics = (inference: MultibetInference | null) => {
        if (!inference?.inputSnapshot) return null
        const snapshot = inference.inputSnapshot as any
        return {
            uniqueEvents: snapshot.unique_event_titles ?? snapshot.uniqueEventTitles ?? 0,
            eventTitles: snapshot.event_titles ?? snapshot.eventTitles ?? [],
            totalCorrelations: snapshot.total_correlation_pairs ?? snapshot.totalCorrelationPairs ?? 0,
            highCorrelations: snapshot.correlations_above_50pct ?? snapshot.correlationsAbove50pct ?? 0,
            totalMarkets: snapshot.total_markets ?? snapshot.totalMarkets ?? 0,
            skippedLowCorr: snapshot.skipped_low_correlation ?? snapshot.skippedLowCorrelation ?? 0,
            skippedNoMarket: snapshot.skipped_no_market_match ?? snapshot.skippedNoMarketMatch ?? 0,
            skippedNoEvent: snapshot.skipped_no_event_title ?? snapshot.skippedNoEventTitle ?? 0,
            skippedSameEvent: snapshot.skipped_same_event ?? snapshot.skippedSameEvent ?? 0,
        }
    }

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    const formatVolume = (volume: number | null) => {
        if (!volume) return '$0'
        if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`
        if (volume >= 1000) return `$${(volume / 1000).toFixed(0)}K`
        return `$${volume.toFixed(0)}`
    }

    const getStatusBadge = (status: string, showLabel = true) => {
        switch (status) {
            case 'pending':
                return (
                    <span className="flex items-center gap-1 text-yellow-600 text-xs">
                        <Clock className="w-3 h-3" />
                        {showLabel && 'Pending'}
                    </span>
                )
            case 'approved':
                return (
                    <span className="flex items-center gap-1 text-green-600 text-xs">
                        <CheckCircle className="w-3 h-3" />
                        {showLabel && 'Approved'}
                    </span>
                )
            case 'rejected':
                return (
                    <span className="flex items-center gap-1 text-red-600 text-xs">
                        <XCircle className="w-3 h-3" />
                        {showLabel && 'Rejected'}
                    </span>
                )
            case 'no_cross_events':
                return (
                    <span className="flex items-center gap-1 text-gray-500 text-xs">
                        <AlertCircle className="w-3 h-3" />
                        {showLabel && 'No cross-events'}
                    </span>
                )
            default:
                return (
                    <span className="flex items-center gap-1 text-orange-600 text-xs">
                        <AlertCircle className="w-3 h-3" />
                        {showLabel && `Unknown: ${status}`}
                    </span>
                )
        }
    }

    const getConfidenceColor = (score: number) => {
        if (score >= 80) return 'text-green-600'
        if (score >= 60) return 'text-emerald-600'
        if (score >= 40) return 'text-yellow-600'
        return 'text-orange-600'
    }

    return (
        <>
            <div className="min-h-screen bg-gray-50">
                {/* Header */}
                <header className="bg-white shadow">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <Link
                                    href="/dashboard"
                                    className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
                                >
                                    <ArrowLeft className="w-5 h-5" />
                                    <span>Back to Dashboard</span>
                                </Link>
                                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                                    <Zap className="w-6 h-6 text-purple-600" />
                                    Multibets
                                </h1>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Main Content */}
                <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    {/* Control Bar */}
                    <div className="flex items-center justify-between mb-6 p-4 bg-white rounded-lg shadow">
                        {/* Left: Auto Processing Switch */}
                        <div className="flex items-center gap-4">
                            <span className="text-sm text-gray-600">Auto Processing</span>
                            <button
                                onClick={handleToggleProcessing}
                                disabled={processingLoading || processingEnabled === null}
                                className={cn(
                                    'relative w-14 h-7 rounded-full transition-colors duration-200',
                                    processingEnabled ? 'bg-green-500' : 'bg-gray-400',
                                    (processingLoading || processingEnabled === null) &&
                                        'opacity-50 cursor-not-allowed'
                                )}
                                title={
                                    processingEnabled
                                        ? 'Click to stop auto processing'
                                        : 'Click to start auto processing'
                                }
                            >
                                <span
                                    className={cn(
                                        'absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 flex items-center justify-center',
                                        processingEnabled ? 'translate-x-7' : undefined
                                    )}
                                >
                                    {processingLoading ? (
                                        <Loader2 className="w-3 h-3 animate-spin text-gray-600" />
                                    ) : (
                                        <Power
                                            className={cn(
                                                'w-3 h-3',
                                                processingEnabled ? 'text-green-500' : 'text-gray-400'
                                            )}
                                        />
                                    )}
                                </span>
                            </button>
                            <span
                                className={cn(
                                    'text-xs font-medium',
                                    processingEnabled ? 'text-green-600' : 'text-gray-500'
                                )}
                            >
                                {processingEnabled === null ? '...' : processingEnabled ? 'ON' : 'OFF'}
                            </span>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex items-center gap-3">
                            {/* Rebuild Graph Button */}
                            <button
                                onClick={handleRecluster}
                                disabled={reclusterLoading}
                                className={cn(
                                    'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm',
                                    'bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200',
                                    reclusterLoading && 'opacity-50 cursor-not-allowed'
                                )}
                                title="Rebuild the cluster graph"
                            >
                                {reclusterLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <GitBranch className="w-4 h-4" />
                                )}
                                <span>Rebuild Graph</span>
                            </button>

                            {/* Refresh Button */}
                            <button
                                onClick={() => (mainTab === 'clusters' ? fetchClusters() : fetchInferences())}
                                disabled={mainTab === 'clusters' ? clustersLoading : loading}
                                className={cn(
                                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm',
                                    'bg-white hover:bg-gray-50 transition-colors border border-gray-300',
                                    (mainTab === 'clusters' ? clustersLoading : loading) &&
                                        'opacity-50 cursor-not-allowed'
                                )}
                            >
                                <RefreshCw
                                    className={cn(
                                        'w-4 h-4',
                                        (mainTab === 'clusters' ? clustersLoading : loading) && 'animate-spin'
                                    )}
                                />
                                <span>Refresh</span>
                            </button>
                        </div>
                    </div>

                    {/* Recluster Message */}
                    {reclusterMessage && (
                        <div className="mb-4 px-4 py-2 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700">
                            {reclusterMessage}
                        </div>
                    )}

                    {/* Main Tabs */}
                    <div className="flex items-center gap-4 mb-6 border-b border-gray-200 pb-4">
                        <button
                            onClick={() => setMainTab('clusters')}
                            className={cn(
                                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                                mainTab === 'clusters'
                                    ? 'bg-blue-50 text-blue-600 border border-blue-200'
                                    : 'bg-white text-gray-600 hover:text-gray-900 border border-transparent'
                            )}
                        >
                            <Database className="w-4 h-4" />
                            Clusters
                        </button>
                        <button
                            onClick={() => setMainTab('inferences')}
                            className={cn(
                                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                                mainTab === 'inferences'
                                    ? 'bg-blue-50 text-blue-600 border border-blue-200'
                                    : 'bg-white text-gray-600 hover:text-gray-900 border border-transparent'
                            )}
                        >
                            <Zap className="w-4 h-4" />
                            Inferences
                            {pagination.total > 0 && (
                                <span className="ml-1 px-2 py-0.5 bg-gray-200 rounded-full text-xs">
                                    {pagination.total}
                                </span>
                            )}
                        </button>
                    </div>

                    {/* Clusters Tab */}
                    {mainTab === 'clusters' && (
                        <>
                            {/* Search */}
                            <div className="mb-6">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Search clusters by name or keywords..."
                                        value={clusterSearch}
                                        onChange={(e) => setClusterSearch(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="text-sm text-gray-600 mb-4">
                                Showing {clusters.length} of {clustersPagination.total} clusters (sorted by volume)
                            </div>

                            {clustersError && (
                                <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                    <span>{clustersError}</span>
                                </div>
                            )}

                            {/* Clusters List */}
                            {clustersLoading && clusters.length === 0 ? (
                                <div className="flex items-center justify-center py-20">
                                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                                </div>
                            ) : clusters.length === 0 ? (
                                <div className="text-center py-20 text-gray-500">No clusters found.</div>
                            ) : (
                                <div className="space-y-3">
                                    {clusters.map((cluster) => {
                                        const isRunning = runningAnalysis.has(cluster.id)
                                        const status = analysisStatuses[cluster.id]

                                        return (
                                            <div
                                                key={cluster.id}
                                                className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors shadow-sm"
                                            >
                                                <div className="flex items-center justify-between">
                                                    {/* Cluster Info */}
                                                    <div className="flex-1 min-w-0 mr-4">
                                                        <div className="flex items-center gap-3 mb-2">
                                                            <span className="text-sm font-medium text-gray-900">
                                                                {cluster.name || `Cluster #${cluster.id}`}
                                                            </span>
                                                            <span className="text-xs text-gray-500">
                                                                {cluster.marketCount} markets
                                                            </span>
                                                            <span className="text-xs text-gray-500">
                                                                {formatVolume(cluster.totalVolume)}
                                                            </span>
                                                        </div>

                                                        {/* Keywords */}
                                                        {cluster.keywords.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mb-2">
                                                                {cluster.keywords.map((kw, i) => (
                                                                    <span
                                                                        key={i}
                                                                        className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded"
                                                                    >
                                                                        {kw}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Status Icons */}
                                                        <div className="flex items-center gap-4 text-xs">
                                                            <div
                                                                className={cn(
                                                                    'flex items-center gap-1',
                                                                    cluster.hasCorrelation
                                                                        ? 'text-green-600'
                                                                        : 'text-gray-400'
                                                                )}
                                                            >
                                                                <BarChart className="w-3 h-3" />
                                                                <span>
                                                                    Correlation {cluster.hasCorrelation ? '✓' : '—'}
                                                                </span>
                                                            </div>
                                                            <div
                                                                className={cn(
                                                                    'flex items-center gap-1',
                                                                    cluster.hasNews ? 'text-green-600' : 'text-gray-400'
                                                                )}
                                                            >
                                                                <Newspaper className="w-3 h-3" />
                                                                <span>
                                                                    News{' '}
                                                                    {cluster.hasNews
                                                                        ? `✓ (${cluster.newsCount})`
                                                                        : '—'}
                                                                </span>
                                                            </div>
                                                            {cluster.multibetStatus && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        toggleClusterExpanded(cluster)
                                                                    }}
                                                                    className={cn(
                                                                        'flex items-center gap-1 px-2 py-0.5 rounded transition-colors',
                                                                        cluster.multibetStatus === 'no_cross_events'
                                                                            ? 'bg-gray-100 hover:bg-gray-200 cursor-pointer'
                                                                            : cluster.multibetStatus === 'approved'
                                                                                ? 'bg-green-50 hover:bg-green-100 cursor-pointer'
                                                                                : 'bg-yellow-50 hover:bg-yellow-100 cursor-pointer'
                                                                    )}
                                                                >
                                                                    <Zap className="w-3 h-3" />
                                                                    {getStatusBadge(cluster.multibetStatus)}
                                                                    {cluster.multibetScore !== null &&
                                                                        cluster.multibetStatus !== 'no_cross_events' && (
                                                                            <span
                                                                                className={cn(
                                                                                    'ml-1 font-medium',
                                                                                    getConfidenceColor(cluster.multibetScore)
                                                                                )}
                                                                            >
                                                                                {cluster.multibetScore.toFixed(0)}%
                                                                            </span>
                                                                        )}
                                                                    {expandedClusterId === cluster.id ? (
                                                                        <ChevronUp className="w-3 h-3 ml-1 text-gray-600" />
                                                                    ) : (
                                                                        <ChevronDown className="w-3 h-3 ml-1 text-gray-600" />
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* Analysis Progress */}
                                                        {(isRunning || status?.status === 'running') && (
                                                            <div className="mt-2 flex items-center gap-2 text-xs text-blue-600">
                                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                                <span>{status?.progress || 'Running analysis...'}</span>
                                                            </div>
                                                        )}

                                                        {status?.status === 'completed' && (
                                                            <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
                                                                <CheckCircle className="w-3 h-3" />
                                                                <span>{status.progress}</span>
                                                            </div>
                                                        )}

                                                        {status?.status === 'failed' && (
                                                            <div className="mt-2 flex items-center gap-2 text-xs text-red-600">
                                                                <AlertCircle className="w-3 h-3" />
                                                                <span>{status.error || 'Analysis failed'}</span>
                                                            </div>
                                                        )}

                                                        {/* Expanded Diagnostics Panel */}
                                                        {expandedClusterId === cluster.id && (
                                                            <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                                                {clusterDiagnostics[cluster.id] ? (
                                                                    (() => {
                                                                        const diag = parseDiagnostics(
                                                                            clusterDiagnostics[cluster.id]
                                                                        )
                                                                        const inference = clusterDiagnostics[cluster.id]
                                                                        return (
                                                                            <div className="space-y-3">
                                                                                {/* Quick Stats */}
                                                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                                                                    <div className="bg-white p-2 rounded shadow-sm">
                                                                                        <div className="text-gray-500">
                                                                                            Unique Events
                                                                                        </div>
                                                                                        <div className="text-lg font-semibold text-blue-600">
                                                                                            {diag?.uniqueEvents ?? 0}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="bg-white p-2 rounded shadow-sm">
                                                                                        <div className="text-gray-500">
                                                                                            High Correlations
                                                                                        </div>
                                                                                        <div className="text-lg font-semibold text-green-600">
                                                                                            {diag?.highCorrelations ?? 0}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="bg-white p-2 rounded shadow-sm">
                                                                                        <div className="text-gray-500">
                                                                                            Total Markets
                                                                                        </div>
                                                                                        <div className="text-lg font-semibold text-gray-700">
                                                                                            {diag?.totalMarkets ?? 0}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="bg-white p-2 rounded shadow-sm">
                                                                                        <div className="text-gray-500">
                                                                                            Same Event Skipped
                                                                                        </div>
                                                                                        <div className="text-lg font-semibold text-orange-600">
                                                                                            {diag?.skippedSameEvent ?? 0}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>

                                                                                {/* Event Titles */}
                                                                                {diag?.eventTitles &&
                                                                                    diag.eventTitles.length > 0 && (
                                                                                        <div>
                                                                                            <div className="text-xs text-gray-500 mb-1">
                                                                                                Event Titles:
                                                                                            </div>
                                                                                            <div className="flex flex-wrap gap-1">
                                                                                                {diag.eventTitles.map(
                                                                                                    (
                                                                                                        title: string,
                                                                                                        i: number
                                                                                                    ) => (
                                                                                                        <span
                                                                                                            key={i}
                                                                                                            className="text-xs px-2 py-0.5 bg-white text-gray-700 rounded shadow-sm"
                                                                                                        >
                                                                                                            {title}
                                                                                                        </span>
                                                                                                    )
                                                                                                )}
                                                                                            </div>
                                                                                        </div>
                                                                                    )}

                                                                                {/* Key Factors */}
                                                                                {inference?.keyFactors &&
                                                                                    inference.keyFactors.length > 0 && (
                                                                                        <div>
                                                                                            <div className="text-xs text-gray-500 mb-1">
                                                                                                Key Factors:
                                                                                            </div>
                                                                                            <ul className="space-y-0.5">
                                                                                                {inference.keyFactors.map(
                                                                                                    (
                                                                                                        factor: string,
                                                                                                        i: number
                                                                                                    ) => (
                                                                                                        <li
                                                                                                            key={i}
                                                                                                            className="text-xs text-gray-700 flex items-start gap-1"
                                                                                                        >
                                                                                                            <span className="text-blue-600">
                                                                                                                •
                                                                                                            </span>
                                                                                                            {factor}
                                                                                                        </li>
                                                                                                    )
                                                                                                )}
                                                                                            </ul>
                                                                                        </div>
                                                                                    )}

                                                                                {/* Full Reasoning */}
                                                                                {inference?.reasoning && (
                                                                                    <div>
                                                                                        <div className="text-xs text-gray-500 mb-1">
                                                                                            Analysis Details:
                                                                                        </div>
                                                                                        <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-white p-2 rounded max-h-40 overflow-y-auto shadow-sm">
                                                                                            {inference.reasoning}
                                                                                        </pre>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        )
                                                                    })()
                                                                ) : (
                                                                    <div className="flex items-center justify-center py-4">
                                                                        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                                                                        <span className="ml-2 text-xs text-gray-400">
                                                                            Loading diagnostics...
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Action Button */}
                                                    <button
                                                        onClick={() => handleRunAnalysis(cluster.id)}
                                                        disabled={isRunning || status?.status === 'running'}
                                                        className={cn(
                                                            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                                                            isRunning || status?.status === 'running'
                                                                ? 'bg-blue-50 text-blue-600 cursor-not-allowed'
                                                                : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200'
                                                        )}
                                                    >
                                                        {isRunning || status?.status === 'running' ? (
                                                            <>
                                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                                <span>Running...</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Play className="w-4 h-4" />
                                                                <span>Run Analysis</span>
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}

                            {/* Pagination */}
                            {clustersPagination.hasMore && (
                                <div className="flex justify-center mt-6">
                                    <button
                                        onClick={() =>
                                            setClustersPagination((p) => ({
                                                ...p,
                                                skip: p.skip + p.limit,
                                            }))
                                        }
                                        className="px-6 py-2 bg-white hover:bg-gray-50 rounded-lg text-sm transition-colors border border-gray-300 shadow-sm"
                                    >
                                        Load More
                                    </button>
                                </div>
                            )}
                        </>
                    )}

                    {/* Inferences Tab */}
                    {mainTab === 'inferences' && (
                        <>
                            {/* Filter Tabs */}
                            <div className="flex items-center gap-2 mb-6 flex-wrap">
                                <Filter className="w-4 h-4 text-gray-400" />
                                {(['pending', 'approved', 'rejected', 'no_cross_events', 'all'] as StatusFilter[]).map(
                                    (filter) => (
                                        <button
                                            key={filter}
                                            onClick={() => {
                                                setStatusFilter(filter)
                                                setPagination((p) => ({ ...p, skip: 0 }))
                                            }}
                                            className={cn(
                                                'px-4 py-2 rounded-lg text-sm transition-colors',
                                                statusFilter === filter
                                                    ? 'bg-blue-50 text-blue-600 border border-blue-200'
                                                    : 'bg-white text-gray-600 hover:text-gray-900 border border-gray-300'
                                            )}
                                        >
                                            {filter === 'no_cross_events'
                                                ? 'No Cross-Events'
                                                : filter.charAt(0).toUpperCase() + filter.slice(1)}
                                        </button>
                                    )
                                )}
                            </div>

                            {/* Stats */}
                            <div className="text-sm text-gray-600 mb-4">
                                Showing {inferences.length} of {pagination.total} inferences
                            </div>

                            {inferencesError && (
                                <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                    <span>{inferencesError}</span>
                                </div>
                            )}

                            {/* Inference List */}
                            {loading && inferences.length === 0 ? (
                                <div className="flex items-center justify-center py-20">
                                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                                </div>
                            ) : inferences.length === 0 ? (
                                <div className="text-center py-20 text-gray-500">
                                    No {statusFilter === 'all' ? '' : statusFilter} inferences found.
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {inferences.map((inference) => (
                                        <div
                                            key={inference.id}
                                            className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm"
                                        >
                                            {/* Card Header */}
                                            <div
                                                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                                                onClick={() => toggleExpanded(inference.id)}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        {/* Confidence */}
                                                        <div
                                                            className={cn(
                                                                'text-2xl font-bold',
                                                                getConfidenceColor(inference.confidenceScore)
                                                            )}
                                                        >
                                                            {inference.confidenceScore.toFixed(0)}%
                                                        </div>

                                                        {/* Direction */}
                                                        <div className="flex items-center gap-1">
                                                            {inference.direction === 'positive' ? (
                                                                <TrendingUp className="w-4 h-4 text-green-600" />
                                                            ) : (
                                                                <TrendingDown className="w-4 h-4 text-red-600" />
                                                            )}
                                                        </div>

                                                        {/* Cluster Info */}
                                                        <div>
                                                            <div className="text-sm text-gray-900">
                                                                {inference.clusterName || `Cluster #${inference.clusterId}`}
                                                            </div>
                                                            <div className="text-xs text-gray-500">
                                                                {formatDate(inference.createdAt)}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-4">
                                                        {getStatusBadge(inference.status)}
                                                        {expandedIds.has(inference.id) ? (
                                                            <ChevronUp className="w-5 h-5 text-gray-400" />
                                                        ) : (
                                                            <ChevronDown className="w-5 h-5 text-gray-400" />
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Markets Preview */}
                                                <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                                                    <div className="p-2 bg-gray-50 rounded truncate">
                                                        <span className="text-blue-600 text-xs mr-2">A:</span>
                                                        {inference.marketATitle}
                                                    </div>
                                                    <div className="p-2 bg-gray-50 rounded truncate">
                                                        <span className="text-purple-600 text-xs mr-2">B:</span>
                                                        {inference.marketBTitle}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Expanded Content */}
                                            {expandedIds.has(inference.id) && (
                                                <div className="border-t border-gray-200 p-4 space-y-4">
                                                    {/* Market Details */}
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="p-3 bg-gray-50 rounded-lg">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-600 rounded">
                                                                    Event A
                                                                </span>
                                                                <span className="text-xs text-gray-500">
                                                                    {inference.marketAEventTitle}
                                                                </span>
                                                            </div>
                                                            <p className="text-sm text-gray-900">
                                                                {inference.marketATitle}
                                                            </p>
                                                        </div>
                                                        <div className="p-3 bg-gray-50 rounded-lg">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-600 rounded">
                                                                    Event B
                                                                </span>
                                                                <span className="text-xs text-gray-500">
                                                                    {inference.marketBEventTitle}
                                                                </span>
                                                            </div>
                                                            <p className="text-sm text-gray-900">
                                                                {inference.marketBTitle}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Metrics */}
                                                    <div className="flex items-center gap-6 text-sm text-gray-600">
                                                        <div className="flex items-center gap-1">
                                                            <Link2 className="w-4 h-4" />
                                                            <span>
                                                                r = {inference.correlationR?.toFixed(2) || 'N/A'}
                                                            </span>
                                                        </div>
                                                        {inference.newsOverlap !== null && (
                                                            <div className="flex items-center gap-1">
                                                                <Newspaper className="w-4 h-4" />
                                                                <span>{inference.newsOverlap} shared news</span>
                                                            </div>
                                                        )}
                                                        {inference.featureOverlap !== null && (
                                                            <span>{inference.featureOverlap} synced features</span>
                                                        )}
                                                    </div>

                                                    {/* Key Factors */}
                                                    {inference.keyFactors && inference.keyFactors.length > 0 && (
                                                        <div>
                                                            <h4 className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">
                                                                Key Factors
                                                            </h4>
                                                            <ul className="space-y-1">
                                                                {inference.keyFactors.map((factor, i) => (
                                                                    <li
                                                                        key={i}
                                                                        className="text-sm text-gray-700 flex items-start gap-2"
                                                                    >
                                                                        <span className="text-blue-600">&#x2022;</span>
                                                                        {factor}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    )}

                                                    {/* AI Reasoning */}
                                                    <div>
                                                        <h4 className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">
                                                            AI Analysis
                                                        </h4>
                                                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 p-3 rounded-lg max-h-48 overflow-y-auto">
                                                            {inference.reasoning}
                                                        </p>
                                                    </div>

                                                    {/* Review Actions (for pending) */}
                                                    {inference.status === 'pending' && (
                                                        <div className="flex items-center gap-4 pt-4 border-t border-gray-200">
                                                            <input
                                                                type="text"
                                                                placeholder="Admin notes (optional)"
                                                                value={adminNotes}
                                                                onChange={(e) => setAdminNotes(e.target.value)}
                                                                className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                                            />
                                                            <button
                                                                onClick={() =>
                                                                    handleReview(inference.clusterId, 'approve')
                                                                }
                                                                disabled={reviewingId === inference.clusterId}
                                                                className={cn(
                                                                    'flex items-center gap-2 px-4 py-2 rounded-lg',
                                                                    'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200',
                                                                    'transition-colors',
                                                                    reviewingId === inference.clusterId &&
                                                                        'opacity-50 cursor-not-allowed'
                                                                )}
                                                            >
                                                                {reviewingId === inference.clusterId ? (
                                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                                ) : (
                                                                    <Check className="w-4 h-4" />
                                                                )}
                                                                <span>Approve</span>
                                                            </button>
                                                            <button
                                                                onClick={() =>
                                                                    handleReview(inference.clusterId, 'reject')
                                                                }
                                                                disabled={reviewingId === inference.clusterId}
                                                                className={cn(
                                                                    'flex items-center gap-2 px-4 py-2 rounded-lg',
                                                                    'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200',
                                                                    'transition-colors',
                                                                    reviewingId === inference.clusterId &&
                                                                        'opacity-50 cursor-not-allowed'
                                                                )}
                                                            >
                                                                {reviewingId === inference.clusterId ? (
                                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                                ) : (
                                                                    <X className="w-4 h-4" />
                                                                )}
                                                                <span>Reject</span>
                                                            </button>
                                                        </div>
                                                    )}

                                                    {/* Review Info (for reviewed) */}
                                                    {inference.status !== 'pending' && inference.reviewedAt && (
                                                        <div className="text-xs text-gray-500 pt-2 border-t border-gray-200">
                                                            <span>
                                                                Reviewed by {inference.reviewedBy || 'Unknown'} on{' '}
                                                                {formatDate(inference.reviewedAt)}
                                                            </span>
                                                            {inference.adminNotes && (
                                                                <div className="mt-1 text-gray-600">
                                                                    Notes: {inference.adminNotes}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Pagination */}
                            {pagination.hasMore && (
                                <div className="flex justify-center mt-6">
                                    <button
                                        onClick={() =>
                                            setPagination((p) => ({
                                                ...p,
                                                skip: p.skip + p.limit,
                                            }))
                                        }
                                        className="px-6 py-2 bg-white hover:bg-gray-50 rounded-lg text-sm transition-colors border border-gray-300 shadow-sm"
                                    >
                                        Load More
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </main>
            </div>
        </>
    )
}
