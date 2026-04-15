'use client'

import Link from 'next/link'
import { ArrowLeft, Activity } from 'lucide-react'

export default function AgentsPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
                    <Link
                        href="/dashboard"
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Back to Dashboard</span>
                    </Link>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <Activity className="w-6 h-6 text-blue-600" />
                        Agents Network
                    </h1>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
                <div className="bg-white rounded-lg shadow p-10">
                    <Activity className="w-12 h-12 text-blue-400 mx-auto mb-4" />
                    <h2 className="text-lg font-semibold text-gray-900 mb-2">Live run viewer — coming next</h2>
                    <p className="text-sm text-gray-600">
                        This page will stream the simulation via SSE once wired to{' '}
                        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                            /oasis-simulation/runs/&#123;run_id&#125;/stream
                        </span>
                        .
                    </p>
                </div>
            </main>
        </div>
    )
}
