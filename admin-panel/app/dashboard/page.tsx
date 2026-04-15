'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
    Zap,
    Flame,
    MessageSquare,
    Play,
    Loader2,
    AlertCircle,
    Layers,
    Users,
    Activity,
    CheckCircle2,
    XCircle,
    Clock,
} from 'lucide-react'
import {
    simulationApi,
    multibetsApi,
    type RunSummary,
    type SuperclusterSummary,
    type MultibetRow,
} from '@/lib/api'

function cn(...classes: (string | boolean | undefined)[]) {
    return classes.filter(Boolean).join(' ')
}

function timeAgo(iso: string | null | undefined) {
    if (!iso) return '—'
    const then = new Date(iso).getTime()
    const now = Date.now()
    const s = Math.max(0, Math.floor((now - then) / 1000))
    if (s < 60) return `${s}s ago`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    return `${d}d ago`
}

function StatusBadge({ status }: { status: RunSummary['status'] }) {
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

function ClusterRow({
    cluster,
    onRun,
    pending,
}: {
    cluster: SuperclusterSummary
    onRun: (c: SuperclusterSummary) => void
    pending: boolean
}) {
    const initials = (cluster.name || `c${cluster.id}`).slice(0, 2).toUpperCase()
    const hashHue = (cluster.id * 47) % 360
    return (
        <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-orange-50 rounded-md transition-colors group">
            <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: `hsl(${hashHue}, 70%, 45%)` }}
            >
                {initials}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                    r/{cluster.name || `cluster-${cluster.id}`}
                </div>
                <div className="text-xs text-gray-500">{cluster.market_count} markets</div>
            </div>
            <button
                onClick={() => onRun(cluster)}
                disabled={pending || !cluster.has_graph}
                title={!cluster.has_graph ? 'No graph built yet' : 'Run simulation on this cluster'}
                className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-all',
                    cluster.has_graph
                        ? 'border-orange-500 text-orange-600 hover:bg-orange-500 hover:text-white'
                        : 'border-gray-200 text-gray-300 cursor-not-allowed',
                    pending && 'opacity-50 cursor-wait'
                )}
            >
                {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Run
            </button>
        </div>
    )
}

export default function DashboardPage() {
    const [clusters, setClusters] = useState<SuperclusterSummary[]>([])
    const [runs, setRuns] = useState<RunSummary[]>([])
    const [multibets, setMultibets] = useState<MultibetRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [clusterFilter, setClusterFilter] = useState('')
    const [pendingRun, setPendingRun] = useState<number | null>(null)
    const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

    const load = useCallback(async () => {
        try {
            const [c, r, m] = await Promise.all([
                simulationApi.listSuperclusters().catch(() => [] as SuperclusterSummary[]),
                simulationApi.listAllRuns().catch(() => [] as RunSummary[]),
                multibetsApi.listAll().catch(() => [] as MultibetRow[]),
            ])
            setClusters(c)
            setRuns(r)
            setMultibets(m)
            setError(null)
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || 'Failed to load')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load()
        const t = setInterval(load, 5000)
        return () => clearInterval(t)
    }, [load])

    async function handleRun(cluster: SuperclusterSummary) {
        setPendingRun(cluster.id)
        try {
            const res = await simulationApi.triggerRun(cluster.id)
            setToast({
                kind: 'ok',
                msg: `Launched sim on r/${res.supercluster_name || cluster.name || cluster.id}`,
            })
            load()
        } catch (e: any) {
            setToast({
                kind: 'err',
                msg: e?.response?.data?.detail || e?.message || 'Failed to launch',
            })
        } finally {
            setPendingRun(null)
            setTimeout(() => setToast(null), 4000)
        }
    }

    const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'pending')
    const recentRuns = runs.slice(0, 30)
    const filteredClusters = clusters.filter((c) =>
        !clusterFilter
            ? true
            : (c.name || `cluster-${c.id}`).toLowerCase().includes(clusterFilter.toLowerCase())
    )

    return (
        <div className="min-h-screen bg-neutral-100">
            {/* Top bar */}
            <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-4">
                    <Link href="/dashboard" className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center">
                            <Flame className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-bold text-gray-900">polycenas</span>
                    </Link>
                    <nav className="flex items-center gap-1 text-sm">
                        <Link
                            href="/dashboard"
                            className="px-3 py-1.5 rounded-full bg-neutral-100 text-gray-900 font-medium"
                        >
                            Home
                        </Link>
                        <Link
                            href="/agents"
                            className="px-3 py-1.5 rounded-full hover:bg-neutral-100 text-gray-700"
                        >
                            Runs
                        </Link>
                        <Link
                            href="/multibets"
                            className="px-3 py-1.5 rounded-full hover:bg-neutral-100 text-gray-700"
                        >
                            Multibets
                        </Link>
                    </nav>
                    <div className="ml-auto text-xs text-gray-500">
                        {loading && runs.length === 0 ? 'Loading…' : `${runs.length} runs · ${clusters.length} clusters`}
                    </div>
                </div>
            </header>

            {toast && (
                <div
                    className={cn(
                        'fixed top-16 right-4 z-30 px-4 py-2 rounded-lg shadow-lg text-sm font-medium',
                        toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                    )}
                >
                    {toast.msg}
                </div>
            )}

            <main className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                {/* Main feed */}
                <div className="space-y-3">
                    {error && (
                        <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
                            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span>Backend unreachable — {error}. Retrying…</span>
                        </div>
                    )}

                    {/* Stats ribbon */}
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-white border border-gray-200 rounded-md p-3 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-orange-500" />
                            <div>
                                <div className="text-lg font-bold text-gray-900 leading-none">{activeRuns.length}</div>
                                <div className="text-[11px] text-gray-500">live runs</div>
                            </div>
                        </div>
                        <div className="bg-white border border-gray-200 rounded-md p-3 flex items-center gap-2">
                            <Layers className="w-4 h-4 text-blue-500" />
                            <div>
                                <div className="text-lg font-bold text-gray-900 leading-none">{clusters.length}</div>
                                <div className="text-[11px] text-gray-500">clusters</div>
                            </div>
                        </div>
                        <div className="bg-white border border-gray-200 rounded-md p-3 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-purple-500" />
                            <div>
                                <div className="text-lg font-bold text-gray-900 leading-none">{multibets.length}</div>
                                <div className="text-[11px] text-gray-500">multibets</div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between px-1 pt-2">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">Recent Runs</h2>
                        <Link href="/agents" className="text-xs text-orange-600 hover:underline">
                            view all →
                        </Link>
                    </div>

                    {recentRuns.length === 0 && !loading ? (
                        <div className="bg-white border border-gray-200 rounded-md p-8 text-center text-sm text-gray-500">
                            No runs yet — pick a cluster from the sidebar and hit <span className="font-semibold text-orange-600">Run</span>.
                        </div>
                    ) : (
                        recentRuns.map((run) => (
                            <Link
                                key={run.id}
                                href={`/agents/${run.id}`}
                                className="block bg-white border border-gray-200 rounded-md hover:border-orange-300 transition-all overflow-hidden group"
                            >
                                <div className="flex">
                                    {/* Left rail (vote-style gutter, we use agent count as a "score") */}
                                    <div className="w-11 bg-neutral-50 border-r border-gray-100 flex flex-col items-center justify-center py-3 text-gray-500 group-hover:bg-orange-50">
                                        <Users className="w-3.5 h-3.5" />
                                        <div className="text-sm font-bold text-gray-700 mt-0.5">{run.agent_count}</div>
                                    </div>

                                    <div className="flex-1 p-3">
                                        <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
                                            <span className="font-medium text-gray-700">
                                                r/cluster-{run.super_cluster_id}
                                            </span>
                                            <span>·</span>
                                            <span>started {timeAgo(run.started_at)}</span>
                                            <StatusBadge status={run.status} />
                                        </div>
                                        <div className="text-sm font-semibold text-gray-900 mb-1">
                                            Sim {run.id.slice(0, 8)} · {run.rounds} rounds · {run.agent_count} agents
                                        </div>
                                        <div className="flex items-center gap-3 text-[11px] text-gray-500">
                                            <span className="inline-flex items-center gap-1">
                                                <MessageSquare className="w-3 h-3" />
                                                {run.total_llm_calls ?? 0} calls
                                            </span>
                                            <span>cheap: {run.cheap_model}</span>
                                            <span>premium: {run.premium_model}</span>
                                            {run.total_cost_usd !== null && (
                                                <span>${run.total_cost_usd.toFixed(3)}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))
                    )}
                </div>

                {/* Sidebar */}
                <aside className="space-y-3">
                    <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
                        <div className="px-4 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white">
                            <div className="text-xs font-bold uppercase tracking-wider opacity-90">
                                Clusters
                            </div>
                            <div className="text-sm mt-0.5">Pick one to launch a sim</div>
                        </div>
                        <div className="p-2 border-b border-gray-100">
                            <input
                                value={clusterFilter}
                                onChange={(e) => setClusterFilter(e.target.value)}
                                placeholder="search clusters…"
                                className="w-full px-3 py-1.5 text-sm bg-neutral-100 border border-transparent focus:border-orange-300 focus:bg-white rounded-md outline-none"
                            />
                        </div>
                        <div className="max-h-[70vh] overflow-y-auto p-1">
                            {filteredClusters.length === 0 ? (
                                <div className="px-3 py-6 text-center text-xs text-gray-400">
                                    {loading ? 'Loading…' : 'No clusters'}
                                </div>
                            ) : (
                                filteredClusters.map((c) => (
                                    <ClusterRow
                                        key={c.id}
                                        cluster={c}
                                        onRun={handleRun}
                                        pending={pendingRun === c.id}
                                    />
                                ))
                            )}
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-md p-4 text-xs text-gray-500 leading-relaxed">
                        <div className="font-bold uppercase tracking-wider text-gray-700 mb-1 text-[11px]">
                            about
                        </div>
                        OASIS Reddit-style multi-agent simulation surfacing cross-market hedges on Polymarket.
                        Each cluster is a supercluster of correlated markets.
                    </div>
                </aside>
            </main>
        </div>
    )
}
