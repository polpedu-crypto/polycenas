'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
    ArrowLeft,
    RefreshCw,
    Loader2,
    Users,
    MessageSquare,
    CheckCircle2,
    Wrench,
    AlertCircle,
    Circle,
    Activity,
} from 'lucide-react'
import { agentsApi, type Agent, type AgentMessage } from '@/lib/api'

function cn(...classes: (string | boolean | undefined)[]) {
    return classes.filter(Boolean).join(' ')
}

const STATUS_DOT: Record<Agent['status'], string> = {
    idle: 'bg-gray-300',
    thinking: 'bg-yellow-400 animate-pulse',
    speaking: 'bg-green-500 animate-pulse',
    offline: 'bg-gray-400 opacity-50',
}

const STATUS_LABEL: Record<Agent['status'], string> = {
    idle: 'Idle',
    thinking: 'Thinking',
    speaking: 'Speaking',
    offline: 'Offline',
}

function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
}

function initials(name: string) {
    return name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
}

function MessageIcon({ type }: { type: AgentMessage['type'] }) {
    if (type === 'decision') return <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
    if (type === 'tool_call') return <Wrench className="w-3.5 h-3.5 text-purple-600" />
    return <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
}

export default function AgentsPage() {
    const [agents, setAgents] = useState<Agent[]>([])
    const [agentsLoading, setAgentsLoading] = useState(true)
    const [agentsError, setAgentsError] = useState<string | null>(null)

    const [messages, setMessages] = useState<AgentMessage[]>([])
    const [messagesLoading, setMessagesLoading] = useState(true)
    const [messagesError, setMessagesError] = useState<string | null>(null)

    const [autoScroll, setAutoScroll] = useState(true)
    const feedRef = useRef<HTMLDivElement>(null)
    const lastTimestampRef = useRef<string | undefined>(undefined)

    const fetchAgents = useCallback(async () => {
        try {
            const data = await agentsApi.list()
            setAgents(data)
            setAgentsError(null)
        } catch (e: any) {
            setAgentsError(e?.response?.data?.detail || e?.message || 'Failed to load agents')
        } finally {
            setAgentsLoading(false)
        }
    }, [])

    const fetchMessages = useCallback(async (initial: boolean) => {
        try {
            const since = initial ? undefined : lastTimestampRef.current
            const data = await agentsApi.messages(since, 100)
            setMessagesError(null)

            if (initial) {
                setMessages(data)
                if (data.length > 0) lastTimestampRef.current = data[data.length - 1].timestamp
            } else if (data.length > 0) {
                setMessages((prev) => {
                    const seen = new Set(prev.map((m) => m.id))
                    const fresh = data.filter((m) => !seen.has(m.id))
                    if (fresh.length === 0) return prev
                    lastTimestampRef.current = fresh[fresh.length - 1].timestamp
                    return [...prev, ...fresh]
                })
            }
        } catch (e: any) {
            setMessagesError(e?.response?.data?.detail || e?.message || 'Failed to load messages')
        } finally {
            if (initial) setMessagesLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchAgents()
        fetchMessages(true)
    }, [fetchAgents, fetchMessages])

    useEffect(() => {
        const interval = setInterval(() => {
            fetchMessages(false)
            fetchAgents()
        }, 2000)
        return () => clearInterval(interval)
    }, [fetchAgents, fetchMessages])

    useEffect(() => {
        if (!autoScroll || !feedRef.current) return
        feedRef.current.scrollTop = feedRef.current.scrollHeight
    }, [messages, autoScroll])

    const handleScroll = () => {
        if (!feedRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = feedRef.current
        const atBottom = scrollHeight - scrollTop - clientHeight < 80
        setAutoScroll(atBottom)
    }

    const agentById = (id: string) => agents.find((a) => a.id === id)

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
                            <Activity className="w-6 h-6 text-blue-600" />
                            Agents Network
                        </h1>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Circle className="w-2 h-2 fill-green-500 text-green-500 animate-pulse" />
                        <span>Live · polling every 2s</span>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
                {/* Agents roster */}
                <aside className="bg-white rounded-lg shadow p-4">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                            <Users className="w-4 h-4" />
                            Agents
                            <span className="text-xs font-normal text-gray-400">({agents.length})</span>
                        </h2>
                        <button
                            onClick={fetchAgents}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                            title="Refresh roster"
                        >
                            <RefreshCw className={cn('w-4 h-4', agentsLoading && 'animate-spin')} />
                        </button>
                    </div>

                    {agentsLoading && agents.length === 0 ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                        </div>
                    ) : agentsError && agents.length === 0 ? (
                        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span>{agentsError}</span>
                        </div>
                    ) : agents.length === 0 ? (
                        <div className="text-center py-10 text-xs text-gray-400">
                            No agents online yet.
                        </div>
                    ) : (
                        <ul className="space-y-2">
                            {agents.map((agent) => (
                                <li
                                    key={agent.id}
                                    className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 transition-colors"
                                >
                                    <div
                                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                                        style={{ backgroundColor: agent.colorHex || '#6366f1' }}
                                    >
                                        {initials(agent.name)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-gray-900 truncate">
                                            {agent.name}
                                        </div>
                                        <div className="text-xs text-gray-500 truncate">{agent.role}</div>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <span className={cn('w-2 h-2 rounded-full', STATUS_DOT[agent.status])} />
                                        <span className="text-xs text-gray-500">{STATUS_LABEL[agent.status]}</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </aside>

                {/* Live message feed */}
                <section className="bg-white rounded-lg shadow flex flex-col h-[calc(100vh-140px)]">
                    <div className="flex items-center justify-between p-4 border-b border-gray-200">
                        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                            <MessageSquare className="w-4 h-4" />
                            Conversation Feed
                            <span className="text-xs font-normal text-gray-400">({messages.length})</span>
                        </h2>
                        {!autoScroll && (
                            <button
                                onClick={() => {
                                    setAutoScroll(true)
                                    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700"
                            >
                                Jump to latest ↓
                            </button>
                        )}
                    </div>

                    <div
                        ref={feedRef}
                        onScroll={handleScroll}
                        className="flex-1 overflow-y-auto p-4 space-y-3"
                    >
                        {messagesLoading && messages.length === 0 ? (
                            <div className="flex items-center justify-center py-20">
                                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                            </div>
                        ) : messagesError && messages.length === 0 ? (
                            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                <span>{messagesError}</span>
                            </div>
                        ) : messages.length === 0 ? (
                            <div className="text-center py-20 text-sm text-gray-400">
                                No messages yet — agents are still warming up.
                            </div>
                        ) : (
                            messages.map((msg) => {
                                const agent = agentById(msg.agentId)
                                const color = agent?.colorHex || '#6366f1'
                                return (
                                    <div key={msg.id} className="flex gap-3">
                                        <div
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                                            style={{ backgroundColor: color }}
                                        >
                                            {initials(msg.agentName)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline gap-2 mb-0.5">
                                                <span className="text-sm font-semibold text-gray-900">
                                                    {msg.agentName}
                                                </span>
                                                <span className="text-xs text-gray-500">{msg.agentRole}</span>
                                                <span className="text-xs text-gray-400 ml-auto">
                                                    {formatTime(msg.timestamp)}
                                                </span>
                                            </div>
                                            <div
                                                className={cn(
                                                    'inline-block px-3 py-2 rounded-lg text-sm text-gray-800 max-w-full',
                                                    msg.type === 'decision' &&
                                                        'bg-green-50 border border-green-200',
                                                    msg.type === 'tool_call' &&
                                                        'bg-purple-50 border border-purple-200 font-mono text-xs',
                                                    msg.type === 'message' && 'bg-gray-50 border border-gray-200'
                                                )}
                                            >
                                                <div className="flex items-center gap-1.5 mb-1 text-xs text-gray-500">
                                                    <MessageIcon type={msg.type} />
                                                    <span className="uppercase tracking-wide">{msg.type}</span>
                                                </div>
                                                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>

                    {messagesError && messages.length > 0 && (
                        <div className="px-4 py-2 bg-yellow-50 border-t border-yellow-200 text-xs text-yellow-800 flex items-center gap-2">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Reconnecting… ({messagesError})</span>
                        </div>
                    )}
                </section>
            </main>
        </div>
    )
}
