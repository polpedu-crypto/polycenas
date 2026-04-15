'use client'

import { Zap, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default function DashboardPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                    <h1 className="text-2xl font-bold text-gray-900">
                        polycenas Admin
                    </h1>
                </div>
            </header>

            {/* Main Content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="bg-white rounded-lg shadow p-6">
                    <h2 className="text-xl font-semibold mb-4">Agents Network Dashboard</h2>
                    <p className="text-gray-600 mb-6">
                        Observe and control the agents network powering the demo.
                    </p>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div className="bg-blue-50 rounded-lg p-6">
                            <h3 className="text-sm font-medium text-blue-900 mb-2">Active Agents</h3>
                            <p className="text-3xl font-bold text-blue-600">0</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-6">
                            <h3 className="text-sm font-medium text-green-900 mb-2">Active Markets</h3>
                            <p className="text-3xl font-bold text-green-600">0</p>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-6">
                            <h3 className="text-sm font-medium text-purple-900 mb-2">Total Volume</h3>
                            <p className="text-3xl font-bold text-purple-600">$0</p>
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="border-t pt-6">
                        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Link
                                href="/multibets"
                                className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg hover:shadow-md transition-all group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-100 rounded-lg">
                                        <Zap className="w-5 h-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <h4 className="font-medium text-gray-900">Multibets</h4>
                                        <p className="text-sm text-gray-600">Agents-discussion results across events</p>
                                    </div>
                                </div>
                                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                            </Link>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}
