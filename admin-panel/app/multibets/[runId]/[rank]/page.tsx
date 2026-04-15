'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
    ArrowLeft,
    Loader2,
    AlertCircle,
    TrendingUp,
    TrendingDown,
    Minus,
    Activity,
} from 'lucide-react'
import { multibetsApi, type MultibetRow } from '@/lib/api'

function cn(...classes: (string | boolean | undefined)[]) {
    return classes.filter(Boolean).join(' ')
}

function confidenceColor(score: number) {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-emerald-600'
    if (score >= 40) return 'text-yellow-600'
    return 'text-orange-600'
}

function directionIcon(direction: string) {
    const d = direction.toLowerCase()
    if (d.includes('bull') || d.includes('positive') || d === 'long')
        return <TrendingUp className="w-5 h-5 text-green-600" />
    if (d.includes('bear') || d.includes('negative') || d === 'short')
        return <TrendingDown className="w-5 h-5 text-red-600" />
    return <Minus className="w-5 h-5 text-gray-500" />
}

function ScorePill({ label, value }: { label: string; value: number }) {
    return (
        <div className="flex items-center justify-between px-3 py-2 bg-white border border-gray-200 rounded">
            <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
            <span className="text-sm font-semibold text-gray-900">{value.toFixed(2)}</span>
        </div>
    )
}

export default function MultibetDetailPage() {
    const params = useParams<{ runId: string; rank: string }>()
    const runId = params.runId
    const rank = parseInt(params.rank, 10)

    const [row, setRow] = useState<MultibetRow | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchRow = useCallback(async () => {
        try {
            const data = await multibetsApi.getOne(runId, rank)
            if (!data) {
                setError(`Multibet not found: run ${runId}, rank ${rank}`)
            } else {
                setRow(data)
                setError(null)
            }
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || 'Failed to load multibet')
        } finally {
            setLoading(false)
        }
    }, [runId, rank])

    useEffect(() => {
        fetchRow()
    }, [fetchRow])

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white shadow">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
                    <Link
                        href="/multibets"
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Back to Multibets</span>
                    </Link>
                    <h1 className="text-xl font-bold text-gray-900">Multibet Detail</h1>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : error ? (
                    <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                ) : row ? (
                    <div className="space-y-6">
                        {/* Headline */}
                        <div className="bg-white rounded-lg shadow p-6">
                            <div className="flex items-center gap-6">
                                <div className={cn('text-5xl font-bold', confidenceColor(row.confidence_score))}>
                                    {row.confidence_score.toFixed(0)}%
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        {directionIcon(row.direction)}
                                        <span className="text-sm font-medium uppercase tracking-wide text-gray-700">
                                            {row.direction}
                                        </span>
                                        <span className="text-xs text-gray-400">· Rank #{row.rank}</span>
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        From run{' '}
                                        <span className="font-mono text-gray-700">{row.simulation_run_id.slice(0, 8)}…</span>
                                    </div>
                                </div>
                                {row.recommended_combo && (
                                    <div className="text-right">
                                        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                                            Recommended Combo
                                        </div>
                                        <div className="text-sm font-medium text-gray-900">
                                            {row.recommended_combo}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Markets */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
                                <div className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-2">
                                    Market A · ID {row.market_a_id}
                                </div>
                                <p className="text-sm text-gray-900 leading-relaxed">{row.market_a_title}</p>
                                {row.market_a_cluster_id !== null && (
                                    <div className="mt-2 text-xs text-gray-400">
                                        Cluster {row.market_a_cluster_id}
                                    </div>
                                )}
                            </div>
                            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
                                <div className="text-xs font-medium text-purple-600 uppercase tracking-wide mb-2">
                                    Market B · ID {row.market_b_id}
                                </div>
                                <p className="text-sm text-gray-900 leading-relaxed">{row.market_b_title}</p>
                                {row.market_b_cluster_id !== null && (
                                    <div className="mt-2 text-xs text-gray-400">
                                        Cluster {row.market_b_cluster_id}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Scores */}
                        <div className="bg-white rounded-lg shadow p-6">
                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                                <Activity className="w-4 h-4" />
                                Signal Breakdown
                            </h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <ScorePill label="Hedge" value={row.hedge_score} />
                                <ScorePill label="Co-movement" value={row.co_movement_score} />
                                <ScorePill label="Interaction" value={row.interaction_score} />
                                <ScorePill label="Contradiction" value={row.contradiction_score} />
                            </div>
                        </div>

                        {/* Key Factors */}
                        {row.key_factors.length > 0 && (
                            <div className="bg-white rounded-lg shadow p-6">
                                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                                    Key Factors
                                </h3>
                                <ul className="space-y-2">
                                    {row.key_factors.map((factor, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                                            <span className="text-blue-600 mt-0.5">•</span>
                                            <span>{factor}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Reasoning */}
                        <div className="bg-white rounded-lg shadow p-6">
                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                                Reasoning
                            </h3>
                            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                                {row.reasoning}
                            </p>
                        </div>
                    </div>
                ) : null}
            </main>
        </div>
    )
}
