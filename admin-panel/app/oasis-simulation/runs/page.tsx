'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
    Flame,
    Play,
    RefreshCw,
    Loader2,
    AlertCircle,
    Activity,
    Clock,
    CheckCircle2,
    XCircle,
    Layers,
    ChevronRight,
    ArrowLeft,
} from 'lucide-react'
import {
    simulationApi,
    type RunSummary,
    type SuperclusterSummary,
    type RunStatus,
} from '@/lib/api'

function cn(...classes: (string | boolean | undefined)[]) {
    return classes.filter(Boolean).join(' ')
}

function StatusBadge({ status }: { status: RunStatus }) {
    const map = {
        running: { label: 'LIVE', cls: 'bg-orange-500 text-white', Icon: Activity },
        pending: { label: 'PENDING', cls: 'bg-yellow-400 text-yellow-900', Icon: Clock },
        completed: { label: 'DONE', cls: 'bg-emerald-500 text-white', Icon: CheckCircle2 },
        failed: { label: 'FAILED', cls: 'bg-red-500 text-white', Icon: XCircle },
    } as const
    const { label, cls, Icon } = map[status]
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider',
                cls
            )}
        >
            <Icon className={cn('w-3 h-3', status === 'running' && 'animate-pulse')} />
            {label}
        </span>
    )
}

export default function OasisRunsPage() {
    const router = useRouter()
    const [superclusters, setSuperclusters] = useState<SuperclusterSummary[]>([])
    const [superClusterId, setSuperClusterId] = useState<number | null>(null)
    const [runs, setRuns] = useState<RunSummary[]>([])
    const [loading, setLoading] = useState(false)
    const [triggering, setTriggering] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [agentCap, setAgentCap] = useState(20)
    const [rounds, setRounds] = useState(3)
    const [topN, setTopN] = useState(5)

    const fetchSuperclusters = useCallback(async () => {
        try {
            const list = await simulationApi.listSuperclusters()
            setSuperclusters(list)
            if (superClusterId === null) {
                const firstReady = list.find((s) => s.has_graph)
                if (firstReady) setSuperClusterId(firstReady.id)
            }
        } catch {
            // Superclusters failing shouldn't block the page —
            // it only affects the trigger form, not the runs list.
        }
    }, [superClusterId])

    const fetchRuns = useCallback(async (selectedId?: number | null) => {
        try {
            setLoading(true)
            const list = selectedId
                ? await simulationApi.listRunsForSupercluster(selectedId)
                : await simulationApi.listAllRuns()
            setRuns(list)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchSuperclusters()
    }, [fetchSuperclusters])

    useEffect(() => {
        fetchRuns(superClusterId)
    }, [fetchRuns, superClusterId])

    // Auto-refresh while any run is running/pending
    useEffect(() => {
        const hasActive = runs.some((r) => r.status === 'running' || r.status === 'pending')
        if (!hasActive) return
        const t = setInterval(() => fetchRuns(superClusterId), 3000)
        return () => clearInterval(t)
    }, [runs, fetchRuns, superClusterId])

    const handleTrigger = async () => {
        if (!superClusterId) return
        setTriggering(true)
        setError(null)
        try {
            await simulationApi.triggerRun(superClusterId, {
                agent_cap: agentCap,
                rounds,
                synthesize_top_n: topN,
            })
            setTimeout(() => fetchRuns(superClusterId), 800)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setTriggering(false)
        }
    }

    const scMap = useMemo(() => {
        const m = new Map<number, SuperclusterSummary>()
        superclusters.forEach((s) => m.set(s.id, s))
        return m
    }, [superclusters])

    const selectedSc = superClusterId !== null ? scMap.get(superClusterId) : undefined

    return (
        <div className="min-h-screen bg-neutral-50">
            {/* Top bar */}
            <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
                <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
                    <Link
                        href="/dashboard"
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span className="text-sm font-medium">Back</span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
                            <Flame className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-bold text-gray-900 tracking-tight">
                            OASIS Simulation
                        </span>
                    </div>
                    <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                            <Layers className="w-3.5 h-3.5" />
                            {superclusters.length} clusters
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <Activity className="w-3.5 h-3.5" />
                            {runs.length} runs
                        </span>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 py-6">
                {/* Trigger panel */}
                <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-5 mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Trigger a new run</h2>
                            <p className="text-xs text-gray-500 mt-0.5">
                                Pick a supercluster and configure the simulation parameters.
                            </p>
                        </div>
                        <button
                            onClick={() => fetchRuns(superClusterId)}
                            disabled={loading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
                            Refresh
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                        <div className="md:col-span-2">
                            <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                                Supercluster
                            </label>
                            <select
                                value={superClusterId ?? ''}
                                onChange={(e) => setSuperClusterId(Number(e.target.value))}
                                className="w-full px-3 py-2 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                            >
                                <option value="">Select…</option>
                                <optgroup label="Ready">
                                    {superclusters
                                        .filter((s) => s.has_graph)
                                        .map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name || `cluster-${s.id}`} · {s.market_count} markets
                                            </option>
                                        ))}
                                </optgroup>
                                <optgroup label="No graph yet">
                                    {superclusters
                                        .filter((s) => !s.has_graph)
                                        .map((s) => (
                                            <option key={s.id} value={s.id} disabled>
                                                {s.name || `cluster-${s.id}`}
                                            </option>
                                        ))}
                                </optgroup>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                                Agents
                            </label>
                            <input
                                type="number"
                                value={agentCap}
                                onChange={(e) => setAgentCap(Number(e.target.value))}
                                min={1}
                                max={200}
                                className="w-full px-3 py-2 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                                Rounds
                            </label>
                            <input
                                type="number"
                                value={rounds}
                                onChange={(e) => setRounds(Number(e.target.value))}
                                min={1}
                                max={20}
                                className="w-full px-3 py-2 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                                Top-N hedges
                            </label>
                            <input
                                type="number"
                                value={topN}
                                onChange={(e) => setTopN(Number(e.target.value))}
                                min={1}
                                max={20}
                                className="w-full px-3 py-2 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between mt-4">
                        <div className="text-xs text-gray-500">
                            {selectedSc
                                ? `Run on ${selectedSc.name || `cluster-${selectedSc.id}`} (${selectedSc.market_count} markets)`
                                : 'Pick a supercluster to enable the Run button.'}
                        </div>
                        <button
                            onClick={handleTrigger}
                            disabled={!superClusterId || !selectedSc?.has_graph || triggering}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {triggering ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Play className="w-4 h-4" />
                            )}
                            Run simulation
                        </button>
                    </div>

                    {error && (
                        <div className="mt-4 flex items-start gap-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
                            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span className="break-all">{error}</span>
                        </div>
                    )}
                </section>

                {/* Runs list */}
                <section>
                    <div className="flex items-center justify-between mb-3 px-1">
                        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                            Recent runs
                        </h2>
                        <span className="text-xs text-gray-500">{runs.length} total</span>
                    </div>

                    {loading && runs.length === 0 ? (
                        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
                            <Loader2 className="w-6 h-6 text-gray-400 animate-spin mx-auto mb-2" />
                            <p className="text-sm text-gray-500">Loading runs…</p>
                        </div>
                    ) : runs.length === 0 ? (
                        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
                            <Activity className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-500">No runs yet. Trigger one above.</p>
                        </div>
                    ) : (
                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            {runs.map((r) => {
                                const sc = scMap.get(r.super_cluster_id)
                                return (
                                    <button
                                        key={r.id}
                                        onClick={() => router.push(`/oasis-simulation/runs/${r.id}`)}
                                        className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-orange-50/60 transition-colors text-left group"
                                    >
                                        <StatusBadge status={r.status} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 truncate">
                                                {sc?.name || `cluster-${r.super_cluster_id}`}
                                                <span className="text-xs font-normal text-gray-400">
                                                    · {r.id.slice(0, 8)}
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3">
                                                <span>{r.agent_count} agents</span>
                                                <span>·</span>
                                                <span>{r.rounds} rounds</span>
                                                {r.error_message && (
                                                    <>
                                                        <span>·</span>
                                                        <span className="text-red-600 truncate">
                                                            {r.error_message}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-orange-500" />
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </section>
            </main>
        </div>
    )
}
