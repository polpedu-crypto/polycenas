'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
    Activity,
    AlertCircle,
    ArrowLeft,
    ArrowUpRight,
    Check,
    CheckCircle2,
    ChevronDown,
    Clock,
    Flame,
    Loader2,
    MessageSquare,
    RefreshCw,
    TrendingDown,
    TrendingUp,
    Minus,
    X,
    Wifi,
    WifiOff,
    ShieldCheck,
    ShieldX,
} from 'lucide-react'
import {
    simulationApi,
    simulationFeedUrl,
    type AgentAction,
    type RunDetail,
    type RunStatus,
    type SynthesizedHedge,
    type HedgeMatrix,
    type HedgeMatrixCombo,
} from '@/lib/api'

// ─────────────────────────── utils ───────────────────────────

function cn(...classes: (string | boolean | undefined)[]) {
    return classes.filter(Boolean).join(' ')
}

function fmtUsd(n: number | undefined | null): string {
    if (n === null || n === undefined || Number.isNaN(n)) return '—'
    const sign = n < 0 ? '-' : ''
    return `${sign}$${Math.abs(n).toFixed(2)}`
}

function fmtScore(n: number | null | undefined): string {
    if (n === null || n === undefined || Number.isNaN(n)) return '—'
    return n.toFixed(2)
}

// ─────────────────────────── small components ───────────────────────────

function StatusBadge({ status }: { status: RunStatus }) {
    const map = {
        running: { label: 'LIVE', cls: 'bg-orange-500 text-white', Icon: Activity },
        pending: { label: 'PENDING', cls: 'bg-yellow-400 text-yellow-900', Icon: Clock },
        completed: { label: 'DONE', cls: 'bg-emerald-500 text-white', Icon: CheckCircle2 },
        failed: { label: 'FAILED', cls: 'bg-red-500 text-white', Icon: X },
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

function StanceTag({ stance }: { stance: 'bullish' | 'bearish' | 'neutral' | null }) {
    if (!stance) return null
    const map = {
        bullish: { cls: 'text-emerald-700 bg-emerald-100', Icon: TrendingUp },
        bearish: { cls: 'text-red-700 bg-red-100', Icon: TrendingDown },
        neutral: { cls: 'text-gray-600 bg-gray-100', Icon: Minus },
    } as const
    const { cls, Icon } = map[stance]
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                cls
            )}
        >
            <Icon className="w-2.5 h-2.5" />
            {stance}
        </span>
    )
}

function WsBadge({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) {
    const map = {
        connecting: { cls: 'bg-yellow-100 text-yellow-800 border-yellow-300', Icon: Loader2, label: 'CONNECTING', spin: true },
        connected: { cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', Icon: Wifi, label: 'LIVE', spin: false },
        disconnected: { cls: 'bg-gray-100 text-gray-600 border-gray-300', Icon: WifiOff, label: 'OFFLINE', spin: false },
    } as const
    const { cls, Icon, label, spin } = map[status]
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider border',
                cls
            )}
        >
            <Icon className={cn('w-3 h-3', spin && 'animate-spin')} />
            {label}
        </span>
    )
}

function confColor(score: number): string {
    if (score >= 70) return 'text-emerald-700 bg-emerald-100'
    if (score >= 40) return 'text-yellow-800 bg-yellow-100'
    return 'text-gray-700 bg-gray-100'
}

// ─────────────────────────── action card ───────────────────────────

function ActionCard({
    action,
    isNew,
    parentSummary,
}: {
    action: AgentAction
    isNew: boolean
    parentSummary?: string | null
}) {
    const bgCls = action.action_type === 'skip' ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200'
    return (
        <div
            className={cn(
                'rounded-lg border p-3 transition-all',
                bgCls,
                isNew && 'ring-2 ring-orange-400 bg-orange-50 border-orange-300'
            )}
        >
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 text-center">
                    <div className="text-[10px] font-bold text-gray-400 uppercase">r{action.round}</div>
                    <div className="text-[10px] text-gray-400">#{action.sequence}</div>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-gray-900">{action.agent_name}</span>
                        <span className="text-[10px] text-gray-400 font-mono">#{action.agent_market_id}</span>
                        <StanceTag stance={action.stance} />
                        <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                            {action.action_type}
                        </span>
                    </div>
                    {parentSummary && (
                        <div className="mt-1.5 text-xs text-gray-500 italic truncate">
                            ↳ replying to: {parentSummary}
                        </div>
                    )}
                    {action.title && (
                        <div className="mt-1.5 text-sm font-semibold text-gray-900">{action.title}</div>
                    )}
                    {action.content && (
                        <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">
                            {action.content}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─────────────────────────── hedge tile ───────────────────────────

function HedgeTile({
    hedge,
    onOpen,
    active,
}: {
    hedge: SynthesizedHedge
    onOpen: () => void
    active: boolean
}) {
    return (
        <button
            onClick={onOpen}
            className={cn(
                'w-full text-left p-3 rounded-lg border transition-all',
                active
                    ? 'border-orange-400 bg-orange-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50/40'
            )}
        >
            <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-gray-400">#{hedge.rank}</span>
                <span
                    className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded',
                        confColor(hedge.confidence_score)
                    )}
                >
                    {Math.round(hedge.confidence_score)}% conf
                </span>
                {hedge.matrix_verified === true && (
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                )}
                {hedge.matrix_verified === false && (
                    <ShieldX className="w-3.5 h-3.5 text-red-400" />
                )}
                {hedge.status === 'approved' && (
                    <span className="text-[10px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded">
                        APPROVED
                    </span>
                )}
                {hedge.status === 'rejected' && (
                    <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded">
                        REJECTED
                    </span>
                )}
            </div>
            <div className="text-xs text-gray-900 font-medium line-clamp-2 leading-snug">
                {hedge.market_a_title}
            </div>
            <div className="text-[10px] text-gray-400 my-1">⇅</div>
            <div className="text-xs text-gray-900 font-medium line-clamp-2 leading-snug">
                {hedge.market_b_title}
            </div>
            {hedge.recommended_combo && (
                <div className="mt-2 text-[10px] font-mono text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded inline-block">
                    {hedge.recommended_combo}
                </div>
            )}
        </button>
    )
}

// ─────────────────────────── matrix grid ───────────────────────────

function MatrixGrid({ matrix }: { matrix: HedgeMatrix }) {
    const combos: HedgeMatrixCombo[] = matrix.combos || []
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
                <thead>
                    <tr className="border-b border-gray-200">
                        <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Combo</th>
                        <th className="text-right px-2 py-1.5 font-semibold text-gray-600">Worst</th>
                        <th className="text-right px-2 py-1.5 font-semibold text-gray-600">Best</th>
                        <th className="text-right px-2 py-1.5 font-semibold text-gray-600">EV</th>
                    </tr>
                </thead>
                <tbody>
                    {combos.map((c) => {
                        const highlight = c.label === matrix.best_hedge_label
                        return (
                            <tr
                                key={c.label}
                                className={cn(
                                    'border-b border-gray-100',
                                    highlight && 'bg-orange-50'
                                )}
                            >
                                <td className="px-2 py-1.5 font-bold text-gray-900">
                                    {c.label}
                                    {highlight && (
                                        <span className="ml-2 text-[10px] text-orange-600 font-sans font-bold">
                                            BEST
                                        </span>
                                    )}
                                </td>
                                <td
                                    className={cn(
                                        'text-right px-2 py-1.5',
                                        c.worst_case_profit_usd < 0 ? 'text-red-600' : 'text-emerald-700'
                                    )}
                                >
                                    {fmtUsd(c.worst_case_profit_usd)}
                                </td>
                                <td className="text-right px-2 py-1.5 text-emerald-700">
                                    {fmtUsd(c.best_case_profit_usd)}
                                </td>
                                <td
                                    className={cn(
                                        'text-right px-2 py-1.5',
                                        c.expected_profit_usd < 0 ? 'text-red-600' : 'text-emerald-700'
                                    )}
                                >
                                    {fmtUsd(c.expected_profit_usd)}
                                </td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
            <div className="text-[10px] text-gray-500 mt-2 px-1">
                Stake per leg {fmtUsd(matrix.stake_per_leg_usd)} · prob A{' '}
                {(matrix.prob_a * 100).toFixed(0)}% · prob B {(matrix.prob_b * 100).toFixed(0)}%
            </div>
        </div>
    )
}

// ─────────────────────────── hedge popup ───────────────────────────

function HedgePopup({
    hedge,
    onClose,
    onUpdated,
}: {
    hedge: SynthesizedHedge
    onClose: () => void
    onUpdated: (h: SynthesizedHedge) => void
}) {
    const [busy, setBusy] = useState<string | null>(null)
    const [err, setErr] = useState<string | null>(null)

    const payload = hedge.structured_payload
    const recommendedBet = payload?.recommended_bet

    const runAction = async (label: string, fn: () => Promise<SynthesizedHedge>) => {
        setBusy(label)
        setErr(null)
        try {
            const fresh = await fn()
            onUpdated(fresh)
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        } finally {
            setBusy(null)
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-gray-400">Hedge #{hedge.rank}</span>
                            <span
                                className={cn(
                                    'text-[10px] font-bold px-1.5 py-0.5 rounded',
                                    confColor(hedge.confidence_score)
                                )}
                            >
                                {Math.round(hedge.confidence_score)}% CONFIDENCE
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                {hedge.direction}
                            </span>
                            {hedge.status !== 'pending' && (
                                <span
                                    className={cn(
                                        'text-[10px] font-bold px-1.5 py-0.5 rounded',
                                        hedge.status === 'approved'
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-red-500 text-white'
                                    )}
                                >
                                    {hedge.status.toUpperCase()}
                                </span>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center"
                    >
                        <X className="w-4 h-4 text-gray-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                    {/* Markets */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                Market A
                            </div>
                            <div className="text-sm font-semibold text-gray-900 leading-snug">
                                {hedge.market_a_title}
                            </div>
                            <div className="text-[10px] text-gray-500 mt-1">
                                {hedge.market_a_event_title}
                            </div>
                        </div>
                        <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                Market B
                            </div>
                            <div className="text-sm font-semibold text-gray-900 leading-snug">
                                {hedge.market_b_title}
                            </div>
                            <div className="text-[10px] text-gray-500 mt-1">
                                {hedge.market_b_event_title}
                            </div>
                        </div>
                    </div>

                    {/* Recommended bet (from structured_payload if present) */}
                    {recommendedBet && (
                        <div className="p-4 rounded-lg bg-orange-50 border border-orange-200">
                            <div className="text-[10px] font-bold text-orange-700 uppercase tracking-wider mb-2">
                                Recommended bet · {recommendedBet.combo}
                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div className="p-2 rounded bg-white border border-orange-100">
                                    <div className="text-[10px] text-gray-500 mb-0.5">
                                        Leg A · {recommendedBet.leg_a.side} @ {recommendedBet.leg_a.price.toFixed(2)}
                                    </div>
                                    <div className="text-sm font-bold text-gray-900">
                                        {fmtUsd(recommendedBet.leg_a.stake_usd)}
                                    </div>
                                </div>
                                <div className="p-2 rounded bg-white border border-orange-100">
                                    <div className="text-[10px] text-gray-500 mb-0.5">
                                        Leg B · {recommendedBet.leg_b.side} @ {recommendedBet.leg_b.price.toFixed(2)}
                                    </div>
                                    <div className="text-sm font-bold text-gray-900">
                                        {fmtUsd(recommendedBet.leg_b.stake_usd)}
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-4 gap-2 text-xs">
                                <Metric label="Stake" value={fmtUsd(recommendedBet.total_stake_usd)} />
                                <Metric label="EV" value={fmtUsd(recommendedBet.expected_profit_usd)} />
                                <Metric label="Worst" value={fmtUsd(recommendedBet.worst_case_usd)} />
                                <Metric label="Best" value={fmtUsd(recommendedBet.best_case_usd)} />
                            </div>
                        </div>
                    )}

                    {/* Matrix grid */}
                    {hedge.hedge_matrix && (
                        <div className="p-3 rounded-lg bg-white border border-gray-200">
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                Payoff matrix
                            </div>
                            <MatrixGrid matrix={hedge.hedge_matrix} />
                        </div>
                    )}

                    {/* Reasoning */}
                    <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                            Reasoning
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                            {hedge.reasoning}
                        </p>
                    </div>

                    {/* Key factors */}
                    {hedge.key_factors?.length > 0 && (
                        <div>
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                Key factors
                            </div>
                            <ul className="space-y-1.5">
                                {hedge.key_factors.map((f, i) => (
                                    <li
                                        key={i}
                                        className="flex items-start gap-2 text-sm text-gray-700"
                                    >
                                        <span className="text-orange-500 font-bold">·</span>
                                        <span>{f}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Scores */}
                    <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                            Simulation scores
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                            <Metric label="Co-move" value={fmtScore(hedge.co_movement_score)} />
                            <Metric label="Contradict" value={fmtScore(hedge.contradiction_score)} />
                            <Metric label="Interact" value={fmtScore(hedge.interaction_score)} />
                            <Metric label="Hedge" value={fmtScore(hedge.hedge_score)} />
                            <Metric label="Corr r" value={fmtScore(hedge.correlation_r)} />
                        </div>
                    </div>

                    {err && (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span className="break-all">{err}</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
                    <button
                        onClick={() =>
                            runAction('resynth', () => simulationApi.resynthesizeHedge(hedge.id))
                        }
                        disabled={!!busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        {busy === 'resynth' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        Reprompt LLM
                    </button>
                    <button
                        onClick={() =>
                            runAction('reject', () => simulationApi.reviewHedge(hedge.id, 'reject'))
                        }
                        disabled={!!busy || hedge.status === 'rejected'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                        <X className="w-3.5 h-3.5" />
                        Reject
                    </button>
                    <button
                        onClick={() =>
                            runAction('approve', () => simulationApi.reviewHedge(hedge.id, 'approve'))
                        }
                        disabled={!!busy || hedge.status === 'approved'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-600 text-xs font-bold text-white disabled:opacity-50"
                    >
                        <Check className="w-3.5 h-3.5" />
                        Approve
                    </button>
                </div>
            </div>
        </div>
    )
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="p-1.5 rounded bg-white border border-gray-100 text-center">
            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                {label}
            </div>
            <div className="text-xs font-mono font-bold text-gray-900">{value}</div>
        </div>
    )
}

// ─────────────────────────── page ───────────────────────────

export default function RunDetailPage() {
    const params = useParams<{ runId: string }>()
    const runId = params.runId
    const [detail, setDetail] = useState<RunDetail | null>(null)
    const [actions, setActions] = useState<AgentAction[]>([])
    const [newIds, setNewIds] = useState<Set<number>>(new Set())
    const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
        'connecting'
    )
    const [autoScroll, setAutoScroll] = useState(true)
    const [openHedgeId, setOpenHedgeId] = useState<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [lastActivityAt, setLastActivityAt] = useState<number>(Date.now())

    const feedRef = useRef<HTMLDivElement>(null)
    const seenIds = useRef<Set<number>>(new Set())

    // Initial detail fetch + polling while active
    useEffect(() => {
        if (!runId) return
        let cancelled = false
        const fetchDetail = async () => {
            try {
                const d = await simulationApi.getRun(runId)
                if (!cancelled) setDetail(d)
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : String(e))
            }
        }
        fetchDetail()
        const t = setInterval(() => {
            if (detail?.run.status === 'running' || detail?.run.status === 'pending') {
                fetchDetail()
            }
        }, 4000)
        return () => {
            cancelled = true
            clearInterval(t)
        }
    }, [runId, detail?.run.status])

    // WebSocket live feed
    useEffect(() => {
        if (!runId) return
        setWsStatus('connecting')
        const ws = new WebSocket(simulationFeedUrl(runId))
        let ping: ReturnType<typeof setInterval> | null = null

        ws.onopen = () => {
            setWsStatus('connected')
            ping = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }))
                }
            }, 30000)
        }
        ws.onclose = () => setWsStatus('disconnected')
        ws.onerror = () => setWsStatus('disconnected')
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data)
                if (msg.type === 'backfill' && Array.isArray(msg.actions)) {
                    setActions(msg.actions as AgentAction[])
                    ;(msg.actions as AgentAction[]).forEach((a) => seenIds.current.add(a.id))
                } else if (msg.type === 'simulation_action' && msg.action) {
                    const a = msg.action as AgentAction
                    if (seenIds.current.has(a.id)) return
                    seenIds.current.add(a.id)
                    setActions((prev) => [...prev, a])
                    setNewIds((prev) => new Set(prev).add(a.id))
                    setLastActivityAt(Date.now())
                    setTimeout(() => {
                        setNewIds((prev) => {
                            const next = new Set(prev)
                            next.delete(a.id)
                            return next
                        })
                    }, 2000)
                } else if (msg.type === 'run_status') {
                    setDetail((prev) =>
                        prev ? { ...prev, run: { ...prev.run, status: msg.status } } : prev
                    )
                    if (msg.status === 'completed' || msg.status === 'failed') {
                        simulationApi.getRun(runId).then(setDetail).catch(() => {})
                    }
                }
            } catch {
                /* ignore */
            }
        }
        return () => {
            if (ping) clearInterval(ping)
            try {
                ws.close()
            } catch {
                /* ignore */
            }
        }
    }, [runId])

    // Auto-scroll feed
    useEffect(() => {
        if (!autoScroll || !feedRef.current) return
        feedRef.current.scrollTop = feedRef.current.scrollHeight
    }, [actions, autoScroll])

    // Parent-action lookup for reply context
    const actionById = useMemo(() => {
        const m = new Map<number, AgentAction>()
        actions.forEach((a) => m.set(a.id, a))
        return m
    }, [actions])

    const updateHedge = useCallback((fresh: SynthesizedHedge) => {
        setDetail((prev) =>
            prev
                ? {
                      ...prev,
                      hedges: prev.hedges.map((h) => (h.id === fresh.id ? fresh : h)),
                  }
                : prev
        )
    }, [])

    const run = detail?.run
    const hedges = detail?.hedges || []
    const openHedge = hedges.find((h) => h.id === openHedgeId) || null

    // Stale activity detector: 120s+ without new action while running
    const isStale =
        run?.status === 'running' && Date.now() - lastActivityAt > 120_000 && actions.length > 0

    return (
        <div className="min-h-screen bg-neutral-50 flex flex-col">
            {/* Top bar */}
            <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
                    <Link
                        href="/oasis-simulation/runs"
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span className="text-sm font-medium">Runs</span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
                            <Flame className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-bold text-gray-900 tracking-tight">
                            Run <span className="font-mono text-gray-500">{runId.slice(0, 8)}</span>
                        </span>
                    </div>
                    {run && <StatusBadge status={run.status} />}
                    <WsBadge status={wsStatus} />
                    <label className="ml-auto inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={autoScroll}
                            onChange={(e) => setAutoScroll(e.target.checked)}
                            className="accent-orange-500"
                        />
                        Auto-scroll
                    </label>
                </div>
            </header>

            {/* Metadata strip */}
            {run && (
                <div className="max-w-7xl mx-auto w-full px-4 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <MetaCard label="Agents" value={run.agent_count.toString()} />
                        <MetaCard label="Markets" value={run.market_count.toString()} />
                        <MetaCard label="Rounds" value={run.rounds.toString()} />
                        <MetaCard label="Actions" value={actions.length.toString()} />
                        <MetaCard label="Run ID" value={runId.slice(0, 8)} />
                    </div>
                </div>
            )}

            {/* Error + stale banners */}
            <div className="max-w-7xl mx-auto w-full px-4 space-y-2">
                {error && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span className="break-all">{error}</span>
                    </div>
                )}
                {run?.error_message && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span className="break-all">{run.error_message}</span>
                    </div>
                )}
                {isStale && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-yellow-50 border border-yellow-200 text-sm text-yellow-800">
                        <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>
                            No new actions for 2+ minutes — Gemini or OpenRouter may be throttling.
                        </span>
                    </div>
                )}
            </div>

            {/* Body: feed + hedges */}
            <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Live feed */}
                    <section className="lg:col-span-2">
                        <div className="flex items-center justify-between mb-3 px-1">
                            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                                <MessageSquare className="inline w-4 h-4 mr-1.5 -mt-0.5" />
                                Live feed
                            </h2>
                            <span className="text-xs text-gray-500">
                                {actions.length} action{actions.length === 1 ? '' : 's'}
                            </span>
                        </div>
                        <div
                            ref={feedRef}
                            className="bg-white border border-gray-200 rounded-lg p-3 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto"
                        >
                            {actions.length === 0 ? (
                                <div className="py-16 text-center">
                                    {wsStatus === 'connecting' ? (
                                        <>
                                            <Loader2 className="w-6 h-6 text-gray-400 animate-spin mx-auto mb-2" />
                                            <p className="text-sm text-gray-500">Connecting to live feed…</p>
                                        </>
                                    ) : (
                                        <>
                                            <MessageSquare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                                            <p className="text-sm text-gray-500">
                                                Waiting for agents to start posting…
                                            </p>
                                        </>
                                    )}
                                </div>
                            ) : (
                                actions.map((a) => {
                                    const parent =
                                        a.parent_action_id !== null
                                            ? actionById.get(a.parent_action_id)
                                            : null
                                    const parentSummary = parent
                                        ? parent.title || parent.content?.slice(0, 80) || parent.agent_name
                                        : null
                                    return (
                                        <ActionCard
                                            key={a.id}
                                            action={a}
                                            isNew={newIds.has(a.id)}
                                            parentSummary={parentSummary}
                                        />
                                    )
                                })
                            )}
                        </div>
                    </section>

                    {/* Hedges sidebar */}
                    <aside>
                        <div className="flex items-center justify-between mb-3 px-1">
                            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                                <ArrowUpRight className="inline w-4 h-4 mr-1.5 -mt-0.5" />
                                Hedges
                            </h2>
                            <span className="text-xs text-gray-500">
                                {hedges.length} synthesized
                            </span>
                        </div>
                        <div className="space-y-2">
                            {hedges.length === 0 ? (
                                <div className="py-10 px-3 bg-white border border-gray-200 rounded-lg text-center">
                                    <ChevronDown className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                                    <p className="text-xs text-gray-500">
                                        Hedges appear after the synthesis step completes.
                                    </p>
                                </div>
                            ) : (
                                hedges.map((h) => (
                                    <HedgeTile
                                        key={h.id}
                                        hedge={h}
                                        active={openHedgeId === h.id}
                                        onOpen={() => setOpenHedgeId(h.id)}
                                    />
                                ))
                            )}
                        </div>
                    </aside>
                </div>
            </main>

            {openHedge && (
                <HedgePopup
                    hedge={openHedge}
                    onClose={() => setOpenHedgeId(null)}
                    onUpdated={(h) => {
                        updateHedge(h)
                        setOpenHedgeId(h.id)
                    }}
                />
            )}
        </div>
    )
}

function MetaCard({
    label,
    value,
    hint,
}: {
    label: string
    value: string
    hint?: string
}) {
    return (
        <div className="p-3 rounded-lg bg-white border border-gray-200">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                {label}
            </div>
            <div className="text-xl font-bold text-gray-900 mt-0.5">{value}</div>
            {hint && <div className="text-[10px] text-gray-500 mt-0.5">{hint}</div>}
        </div>
    )
}
