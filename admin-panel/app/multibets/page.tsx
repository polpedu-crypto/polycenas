'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
    ArrowLeft,
    RefreshCw,
    ChevronRight,
    Loader2,
    AlertCircle,
    TrendingUp,
    TrendingDown,
    Minus,
    Zap,
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
        return <TrendingUp className="w-4 h-4 text-green-600" />
    if (d.includes('bear') || d.includes('negative') || d === 'short')
        return <TrendingDown className="w-4 h-4 text-red-600" />
    return <Minus className="w-4 h-4 text-gray-500" />
}

function formatDate(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

export default function MultibetsPage() {
    const [rows, setRows] = useState<MultibetRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchRows = useCallback(async () => {
        try {
            const data = await multibetsApi.listAll()
            setRows(data)
            setError(null)
        } catch (e: any) {
            setError(e?.response?.data?.detail || e?.message || 'Failed to load multibets')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchRows()
    }, [fetchRows])

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
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
                    <button
                        onClick={() => {
                            setLoading(true)
                            fetchRows()
                        }}
                        disabled={loading}
                        className={cn(
                            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-gray-300 bg-white hover:bg-gray-50 transition-colors',
                            loading && 'opacity-50 cursor-not-allowed'
                        )}
                    >
                        <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                        <span>Refresh</span>
                    </button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <p className="text-sm text-gray-600 mb-4">
                    Cross-market hedges synthesized from completed agent-debate runs, ranked by confidence.
                </p>

                {error && (
                    <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                )}

                {loading && rows.length === 0 ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="text-center py-20 text-gray-500">
                        No multibets yet — run a simulation to generate them.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {rows.map((row) => (
                            <Link
                                key={`${row.run_id}-${row.rank}`}
                                href={`/multibets/${row.run_id}/${row.rank}`}
                                className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-md transition-all group"
                            >
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4 flex-shrink-0">
                                        <div className={cn('text-3xl font-bold', confidenceColor(row.confidence_score))}>
                                            {row.confidence_score.toFixed(0)}%
                                        </div>
                                        <div className="flex items-center gap-1 text-xs text-gray-500">
                                            {directionIcon(row.direction)}
                                            <span className="uppercase tracking-wide">{row.direction}</span>
                                        </div>
                                    </div>

                                    <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="p-2 bg-blue-50 rounded border border-blue-100 truncate">
                                            <span className="text-xs text-blue-600 mr-2 font-medium">A:</span>
                                            <span className="text-sm text-gray-800">{row.market_a_title}</span>
                                        </div>
                                        <div className="p-2 bg-purple-50 rounded border border-purple-100 truncate">
                                            <span className="text-xs text-purple-600 mr-2 font-medium">B:</span>
                                            <span className="text-sm text-gray-800">{row.market_b_title}</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 flex-shrink-0">
                                        <div className="text-right">
                                            <div className="text-xs text-gray-400">Rank #{row.rank}</div>
                                            <div className="text-xs text-gray-400">{formatDate(row.run_completed_at)}</div>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                                    </div>
                                </div>

                                {row.key_factors.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        {row.key_factors.slice(0, 4).map((factor, i) => (
                                            <span
                                                key={i}
                                                className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded"
                                            >
                                                {factor}
                                            </span>
                                        ))}
                                        {row.key_factors.length > 4 && (
                                            <span className="text-xs px-2 py-0.5 text-gray-400">
                                                +{row.key_factors.length - 4}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </Link>
                        ))}
                    </div>
                )}
            </main>
        </div>
    )
}
