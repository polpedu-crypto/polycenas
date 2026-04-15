'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Zap, ArrowRight, Activity, Loader2, AlertCircle } from 'lucide-react'
import { simulationApi, type RunSummary } from '@/lib/api'

function Stat({
    label,
    value,
    accent,
    loading,
    error,
}: {
    label: string
    value: number | string
    accent: 'blue' | 'green' | 'purple'
    loading: boolean
    error: string | null
}) {
    const colors = {
        blue: { bg: 'bg-blue-50', title: 'text-blue-900', num: 'text-blue-600' },
        green: { bg: 'bg-green-50', title: 'text-green-900', num: 'text-green-600' },
        purple: { bg: 'bg-purple-50', title: 'text-purple-900', num: 'text-purple-600' },
    }[accent]

    return (
        <div className={`${colors.bg} rounded-lg p-6`}>
            <h3 className={`text-sm font-medium ${colors.title} mb-2`}>{label}</h3>
            {loading ? (
                <Loader2 className={`w-7 h-7 animate-spin ${colors.num}`} />
            ) : error ? (
                <div className="flex items-center gap-2 text-red-600 text-sm">
                    <AlertCircle className="w-4 h-4" />
                    <span>—</span>
                </div>
            ) : (
                <p className={`text-3xl font-bold ${colors.num}`}>{value}</p>
            )}
        </div>
    )
}

export default function DashboardPage() {
    const [runs, setRuns] = useState<RunSummary[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const load = async () => {
            try {
                const data = await simulationApi.listRuns()
                setRuns(data)
                setError(null)
            } catch (e: any) {
                setError(e?.response?.data?.detail || e?.message || 'Failed to load runs')
            } finally {
                setLoading(false)
            }
        }
        load()
        const interval = setInterval(load, 5000)
        return () => clearInterval(interval)
    }, [])

    const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'pending').length
    const totalActions = runs.reduce((sum, r) => sum + r.action_count, 0)
    const totalHedges = runs.reduce((sum, r) => sum + r.hedge_count, 0)

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                            <Activity className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-gray-900">polycenas</h1>
                            <p className="text-xs text-gray-500">OASIS agent simulation — admin</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-xl font-semibold mb-1">Agents Network</h2>
                    <p className="text-gray-600 mb-6">
                        Observe the multi-agent Reddit-style debate surfacing cross-market hedges.
                    </p>

                    {error && (
                        <div className="mb-6 flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span>Backend unreachable — {error}. Retrying…</span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <Stat label="Active Runs" value={activeRuns} accent="blue" loading={loading} error={error} />
                        <Stat label="Total Actions" value={totalActions} accent="green" loading={loading} error={error} />
                        <Stat label="Multibets" value={totalHedges} accent="purple" loading={loading} error={error} />
                    </div>

                    <div className="border-t pt-6">
                        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Link
                                href="/multibets"
                                className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg hover:shadow-md transition-all group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-purple-100 rounded-lg">
                                        <Zap className="w-5 h-5 text-purple-600" />
                                    </div>
                                    <div>
                                        <h4 className="font-medium text-gray-900">Multibets</h4>
                                        <p className="text-sm text-gray-600">Hedges synthesized by the agent debate</p>
                                    </div>
                                </div>
                                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-purple-600 group-hover:translate-x-1 transition-all" />
                            </Link>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}
