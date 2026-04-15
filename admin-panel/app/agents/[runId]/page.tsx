'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
    ArrowLeft,
    Flame,
    MessageSquare,
    Activity,
    TrendingUp,
    TrendingDown,
    Minus,
    CheckCircle2,
    XCircle,
    Clock,
    AlertCircle,
    Loader2,
    Users,
    Layers,
    Zap,
    RefreshCw,
    ArrowUp,
    ArrowDown,
} from 'lucide-react'
import {
    simulationApi,
    type AgentAction,
    type RunDetail,
    type RunSummary,
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

function agentColor(name: string) {
    let h = 0
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
    return `hsl(${h}, 65%, 45%)`
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

function StanceFlair({ stance }: { stance: AgentAction['stance'] }) {
    if (!stance) return null
    const map = {
        bullish: { cls: 'bg-emerald-100 text-emerald-700', Icon: TrendingUp, label: 'Bullish' },
        bearish: { cls: 'bg-red-100 text-red-700', Icon: TrendingDown, label: 'Bearish' },
        neutral: { cls: 'bg-gray-100 text-gray-700', Icon: Minus, label: 'Neutral' },
    } as const
    const { cls, Icon, label } = map[stance]
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold',
                cls
            )}
        >
            <Icon className="w-3 h-3" />
            {label}
        </span>
    )
}

function ActionTypeTag({ type }: { type: AgentAction['action_type'] }) {
    if (type === 'post') return null
    const map = {
        reply: { label: 'replied', cls: 'text-gray-500' },
        stance_change: { label: 'changed stance', cls: 'text-blue-600' },
        skip: { label: 'skipped', cls: 'text-gray-400 italic' },
    } as const
    const m = (map as any)[type]
    if (!m) return null
    return <span className={cn('text-[11px]', m.cls)}>{m.label}</span>
}

type ThreadNode = {
    action: AgentAction
    children: ThreadNode[]
}

function buildThreads(actions: AgentAction[]): ThreadNode[] {
    const byId = new Map<number, ThreadNode>()
    const roots: ThreadNode[] = []
    const sorted = [...actions].sort((a, b) => a.sequence - b.sequence)
    for (const a of sorted) {
        byId.set(a.id, { action: a, children: [] })
    }
    for (const a of sorted) {
        const node = byId.get(a.id)!
        if (a.parent_action_id !== null && byId.has(a.parent_action_id)) {
            byId.get(a.parent_action_id)!.children.push(node)
        } else {
            roots.push(node)
        }
    }
    return roots
}

function CommentNode({
    node,
    depth,
    isNew,
}: {
    node: ThreadNode
    depth: number
    isNew: boolean
}) {
    const [collapsed, setCollapsed] = useState(false)
    const { action } = node
    const color = agentColor(action.agent_name)
    const initials = action.agent_name.slice(0, 2).toUpperCase()

    return (
        <div
            className={cn(
                'relative',
                depth > 0 && 'pl-4 ml-3 border-l-2 border-gray-200 hover:border-orange-300 transition-colors'
            )}
        >
            <div
                className={cn(
                    'flex gap-2 py-1.5',
                    isNew && 'bg-orange-50 -mx-2 px-2 rounded animate-pulse-once'
                )}
            >
                <button
                    onClick={() => setCollapsed((c) => !c)}
                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold hover:ring-2 hover:ring-offset-1 hover:ring-orange-400 transition-all"
                    style={{ backgroundColor: color }}
                    title={collapsed ? 'expand' : 'collapse'}
                >
                    {collapsed ? '+' : initials}
                </button>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
                        <span className="font-bold text-gray-800" style={{ color }}>
                            u/{action.agent_name}
                        </span>
                        <StanceFlair stance={action.stance} />
                        <ActionTypeTag type={action.action_type} />
                        <span>·</span>
                        <span>r{action.round}</span>
                        <span>·</span>
                        <span>{timeAgo(action.created_at)}</span>
                        <span className="text-gray-300">#{action.sequence}</span>
                    </div>
                    {!collapsed && (
                        <>
                            {action.title && action.action_type === 'post' && (
                                <div className="mt-0.5 text-sm font-semibold text-gray-900">
                                    {action.title}
                                </div>
                            )}
                            {action.content ? (
                                <div className="mt-0.5 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                                    {action.content}
                                </div>
                            ) : action.action_type === 'skip' ? (
                                <div className="mt-0.5 text-xs text-gray-400 italic">(no-op)</div>
                            ) : null}
                            {action.target_market_id !== null && (
                                <div className="mt-1 text-[11px] text-gray-400">
                                    re: market #{action.target_market_id}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
            {!collapsed && node.children.length > 0 && (
                <div>
                    {node.children.map((child) => (
                        <CommentNode
                            key={child.action.id}
                            node={child}
                            depth={depth + 1}
                            isNew={isNew}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

function PostThread({ node, newIds }: { node: ThreadNode; newIds: Set<number> }) {
    const { action } = node
    const color = agentColor(action.agent_name)
    const initials = action.agent_name.slice(0, 2).toUpperCase()
    return (
        <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
            <div className="flex">
                {/* Vote gutter */}
                <div className="w-10 bg-neutral-50 border-r border-gray-100 flex flex-col items-center justify-start py-2 text-gray-400">
                    <ArrowUp className="w-4 h-4" />
                    <div className="text-xs font-bold text-gray-600 my-0.5">
                        {node.children.length}
                    </div>
                    <ArrowDown className="w-4 h-4" />
                </div>
                <div className="flex-1 p-3">
                    <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1 flex-wrap">
                        <div
                            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                            style={{ backgroundColor: color }}
                        >
                            {initials}
                        </div>
                        <span className="font-medium" style={{ color }}>
                            u/{action.agent_name}
                        </span>
                        <StanceFlair stance={action.stance} />
                        <span>·</span>
                        <span>round {action.round}</span>
                        <span>·</span>
                        <span>{timeAgo(action.created_at)}</span>
                    </div>
                    {action.title && (
                        <h3 className="text-base font-semibold text-gray-900 leading-snug">
                            {action.title}
                        </h3>
                    )}
                    {action.content && (
                        <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                            {action.content}
                        </p>
                    )}
                    {action.target_market_id !== null && (
                        <div className="mt-2 inline-block text-[11px] text-gray-500 bg-neutral-100 px-2 py-0.5 rounded">
                            re: market #{action.target_market_id}
                        </div>
                    )}
                    {node.children.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                {node.children.length} {node.children.length === 1 ? 'reply' : 'replies'}
                            </div>
                            {node.children.map((child) => (
                                <CommentNode
                                    key={child.action.id}
                                    node={child}
                                    depth={1}
                                    isNew={newIds.has(child.action.id)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default function RunThreadPage() {
    const params = useParams<{ runId: string }>()
    const runId = params.runId

    const [detail, setDetail] = useState<RunDetail | null>(null)
    const [actions, setActions] = useState<AgentAction[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [autoScroll, setAutoScroll] = useState(false)
    const [newIds, setNewIds] = useState<Set<number>>(new Set())

    const lastSeqRef = useRef(0)
    const feedEndRef = useRef<HTMLDivElement>(null)

    const fetchDetail = useCallback(async () => {
        try {
            const d = await simulationApi.getRun(runId)
            setDetail(d)
            setError(null)
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || 'Failed to load run')
        }
    }, [runId])

    const fetchActions = useCallback(async () => {
        try {
            const newActions = await simulationApi.getActions(runId, lastSeqRef.current, 500)
            if (newActions.length > 0) {
                const maxSeq = Math.max(...newActions.map((a) => a.sequence))
                lastSeqRef.current = Math.max(lastSeqRef.current, maxSeq)
                setActions((prev) => {
                    const seen = new Set(prev.map((a) => a.id))
                    const merged = [...prev]
                    for (const a of newActions) if (!seen.has(a.id)) merged.push(a)
                    return merged
                })
                setNewIds((prev) => {
                    const next = new Set(prev)
                    for (const a of newActions) next.add(a.id)
                    return next
                })
                setTimeout(() => {
                    setNewIds(new Set())
                }, 2500)
            }
            setError(null)
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || 'Failed to load actions')
        } finally {
            setLoading(false)
        }
    }, [runId])

    useEffect(() => {
        lastSeqRef.current = 0
        setActions([])
        fetchDetail()
        fetchActions()
    }, [runId, fetchDetail, fetchActions])

    useEffect(() => {
        const isLive = detail?.run.status === 'running' || detail?.run.status === 'pending'
        const delay = isLive ? 2000 : 10000
        const t = setInterval(() => {
            fetchDetail()
            fetchActions()
        }, delay)
        return () => clearInterval(t)
    }, [detail?.run.status, fetchDetail, fetchActions])

    useEffect(() => {
        if (autoScroll) feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [actions.length, autoScroll])

    const threads = useMemo(() => buildThreads(actions), [actions])
    const run = detail?.run

    const agentNames = useMemo(() => {
        const s = new Set<string>()
        for (const a of actions) s.add(a.agent_name)
        return Array.from(s).sort()
    }, [actions])

    return (
        <div className="min-h-screen bg-neutral-100">
            <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
                <div className="max-w-6xl mx-auto px-4 h-12 flex items-center gap-4">
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

            <main className="max-w-6xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
                <div className="space-y-3">
                    <Link
                        href="/agents"
                        className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-orange-600"
                    >
                        <ArrowLeft className="w-3 h-3" />
                        back to runs
                    </Link>

                    {/* Run header */}
                    <div className="bg-white border border-gray-200 rounded-md p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
                                    <span className="font-medium text-gray-700">
                                        r/cluster-{run?.super_cluster_id ?? '—'}
                                    </span>
                                    {run && <StatusBadge status={run.status} />}
                                </div>
                                <h1 className="text-lg font-bold text-gray-900 font-mono">
                                    sim {runId.slice(0, 12)}
                                </h1>
                                {run && (
                                    <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
                                        <span className="inline-flex items-center gap-1">
                                            <Users className="w-3 h-3" />
                                            {run.agent_count} agents
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                            <Layers className="w-3 h-3" />
                                            {run.market_count} markets
                                        </span>
                                        <span>{run.rounds} rounds</span>
                                        <span>
                                            started {timeAgo(run.started_at)}
                                            {run.completed_at && ` · finished ${timeAgo(run.completed_at)}`}
                                        </span>
                                        {run.total_llm_calls !== null && (
                                            <span>{run.total_llm_calls} llm calls</span>
                                        )}
                                        {run.total_cost_usd !== null && (
                                            <span>${run.total_cost_usd.toFixed(3)}</span>
                                        )}
                                    </div>
                                )}
                                {run?.error_message && (
                                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                                        {run.error_message}
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={autoScroll}
                                        onChange={(e) => setAutoScroll(e.target.checked)}
                                        className="accent-orange-500"
                                    />
                                    auto-scroll
                                </label>
                                <button
                                    onClick={() => {
                                        fetchDetail()
                                        fetchActions()
                                    }}
                                    className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-orange-600"
                                >
                                    <RefreshCw className="w-3 h-3" />
                                    refresh
                                </button>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
                            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Feed */}
                    {loading && actions.length === 0 ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                        </div>
                    ) : threads.length === 0 ? (
                        <div className="bg-white border border-gray-200 rounded-md p-10 text-center text-sm text-gray-500">
                            No posts yet. {run?.status === 'running' ? 'Waiting for agents to start chatting…' : 'This run produced no posts.'}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {threads.map((thread) => (
                                <PostThread
                                    key={thread.action.id}
                                    node={thread}
                                    newIds={newIds}
                                />
                            ))}
                            <div ref={feedEndRef} />
                        </div>
                    )}

                    {/* Hedges summary if completed */}
                    {detail && detail.hedges.length > 0 && (
                        <div className="bg-white border border-gray-200 rounded-md p-4">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1">
                                <Zap className="w-3 h-3 text-purple-500" />
                                Synthesized Multibets ({detail.hedges.length})
                            </h3>
                            <div className="space-y-1.5">
                                {detail.hedges.slice(0, 5).map((h) => (
                                    <Link
                                        key={h.id}
                                        href={`/multibets/${runId}/${h.rank}`}
                                        className="flex items-center gap-2 text-xs hover:bg-neutral-50 p-1.5 rounded"
                                    >
                                        <span className="font-bold text-purple-600 w-10">
                                            {h.confidence_score.toFixed(0)}%
                                        </span>
                                        <span className="flex-1 truncate text-gray-700">
                                            {h.market_a_title}
                                        </span>
                                        <span className="text-gray-300">×</span>
                                        <span className="flex-1 truncate text-gray-700">
                                            {h.market_b_title}
                                        </span>
                                    </Link>
                                ))}
                                {detail.hedges.length > 5 && (
                                    <Link
                                        href="/multibets"
                                        className="block text-xs text-orange-600 hover:underline pl-1.5"
                                    >
                                        +{detail.hedges.length - 5} more →
                                    </Link>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Sidebar: participants */}
                <aside className="space-y-3">
                    <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
                        <div className="px-4 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white">
                            <div className="text-xs font-bold uppercase tracking-wider opacity-90">
                                Participants
                            </div>
                            <div className="text-sm mt-0.5">
                                {agentNames.length} of {run?.agent_count ?? 0} active
                            </div>
                        </div>
                        <div className="max-h-[70vh] overflow-y-auto p-2">
                            {agentNames.length === 0 ? (
                                <div className="text-xs text-gray-400 text-center py-4">no posts yet</div>
                            ) : (
                                agentNames.map((name) => {
                                    const count = actions.filter((a) => a.agent_name === name).length
                                    return (
                                        <div
                                            key={name}
                                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-50 rounded"
                                        >
                                            <div
                                                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                                                style={{ backgroundColor: agentColor(name) }}
                                            >
                                                {name.slice(0, 2).toUpperCase()}
                                            </div>
                                            <span
                                                className="text-xs font-medium flex-1 truncate"
                                                style={{ color: agentColor(name) }}
                                            >
                                                u/{name}
                                            </span>
                                            <span className="text-[10px] text-gray-400">{count}</span>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </div>
                </aside>
            </main>
        </div>
    )
}
