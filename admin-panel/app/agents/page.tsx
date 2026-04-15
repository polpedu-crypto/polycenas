'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
    Activity,
    Flame,
    Users,
    MessageSquare,
    CheckCircle2,
    Clock,
    XCircle,
    Loader2,
    AlertCircle,
} from 'lucide-react'
import { simulationApi, type RunSummary } from '@/lib/api'

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

type Filter = 'all' | 'live' | 'completed' | 'failed'

export default function AgentsListPage() {
    const [runs, setRuns] = useState<RunSummary[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [filter, setFilter] = useState<Filter>('all')

    const load = useCallback(async () => {
        try {
            const r = await simulationApi.listAllRuns()
            setRuns(r)
            setError(null)
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || 'Failed to load runs')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load()
        const t = setInterval(load, 3000)
        return () => clearInterval(t)
    }, [load])

    const shown = runs.filter((r) => {
        if (filter === 'all') return true
        if (filter === 'live') return r.status === 'running' || r.status === 'pending'
        if (filter === 'completed') return r.status === 'completed'
        if (filter === 'failed') return r.status === 'failed'
        return true
    })

    return (
        <div className="min-h-screen bg-neutral-100">
            <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
                <div className="max-w-5xl mx-auto px-4 h-12 flex items-center gap-4">
                    <Link href="/dashboard" className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center">
                            <Flame className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-bold text-gray-900">polycenas</span>
                    </Link>
                    <nav className="flex items-center gap-1 text-sm">
                        <Link href="/dashboard" className="px-3 py-1.5 rounded-full hover:bg-neutral-100 text-gray-700">
                            Home
                        </Link>
                        <Link
                            href="/agents"
                            className="px-3 py-1.5 rounded-full bg-neutral-100 text-gray-900 font-medium"
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
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-orange-500" />
                            Agent Runs
                        </h1>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Pick a run to watch agents debate live in a Reddit-style thread.
                        </p>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                        {(['all', 'live', 'completed', 'failed'] as Filter[]).map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={cn(
                                    'px-3 py-1.5 rounded-full font-medium capitalize transition-colors',
                                    filter === f
                                        ? 'bg-orange-500 text-white'
                                        : 'bg-white border border-gray-200 text-gray-600 hover:bg-neutral-50'
                                )}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                </div>

                {error && (
                    <div className="mb-3 flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                )}

                {loading && runs.length === 0 ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                    </div>
                ) : shown.length === 0 ? (
                    <div className="bg-white border border-gray-200 rounded-md p-10 text-center text-sm text-gray-500">
                        No runs{filter !== 'all' ? ` matching "${filter}"` : ''}. Launch one from{' '}
                        <Link href="/dashboard" className="text-orange-600 hover:underline font-medium">
                            the dashboard
                        </Link>
                        .
                    </div>
                ) : (
                    <div className="space-y-2">
                        {shown.map((run) => (
                            <Link
                                key={run.id}
                                href={`/agents/${run.id}`}
                                className="block bg-white border border-gray-200 rounded-md hover:border-orange-300 transition-all overflow-hidden group"
                            >
                                <div className="flex">
                                    <div className="w-12 bg-neutral-50 border-r border-gray-100 flex flex-col items-center justify-center py-2 group-hover:bg-orange-50">
                                        <Users className="w-3.5 h-3.5 text-gray-400" />
                                        <div className="text-sm font-bold text-gray-700 mt-0.5">{run.agent_count}</div>
                                    </div>
                                    <div className="flex-1 p-3">
                                        <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
                                            <span className="font-medium text-gray-700">
                                                r/cluster-{run.super_cluster_id}
                                            </span>
                                            <span>·</span>
                                            <span>{timeAgo(run.started_at)}</span>
                                            <StatusBadge status={run.status} />
                                        </div>
                                        <div className="text-sm font-semibold text-gray-900 font-mono">
                                            {run.id.slice(0, 12)}…
                                        </div>
                                        <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-500">
                                            <span className="inline-flex items-center gap-1">
                                                <MessageSquare className="w-3 h-3" />
                                                {run.total_llm_calls ?? 0} calls
                                            </span>
                                            <span>{run.rounds} rounds</span>
                                            <span>{run.market_count} markets</span>
                                            {run.total_cost_usd !== null && <span>${run.total_cost_usd.toFixed(3)}</span>}
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>
        </div>
    )
}
