import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, Loader2, Wifi, WifiOff } from 'lucide-react'
import { simulationApi, simulationFeedUrl, type AgentAction, type RunDetail, type SynthesizedHedge } from '../lib/api'

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function OasisRunDetailPage() {
  const params = useParams<{ runId: string }>()
  const runId = params.runId || ''
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [actions, setActions] = useState<AgentAction[]>([])
  const [selectedHedgeId, setSelectedHedgeId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wsOnline, setWsOnline] = useState(false)
  const seenIdsRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!runId) return
    let cancelled = false

    const fetchRun = async () => {
      try {
        const payload = await simulationApi.getRun(runId)
        if (!cancelled) {
          setDetail(payload)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    fetchRun()

    const pollTimer = setInterval(() => {
      const status = detail?.run.status
      if (status === 'running' || status === 'pending') fetchRun()
    }, 4000)

    return () => {
      cancelled = true
      clearInterval(pollTimer)
    }
  }, [runId, detail?.run.status])

  useEffect(() => {
    if (!runId) return
    const ws = new WebSocket(simulationFeedUrl(runId))

    ws.onopen = () => setWsOnline(true)
    ws.onclose = () => setWsOnline(false)
    ws.onerror = () => setWsOnline(false)
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'backfill' && Array.isArray(msg.actions)) {
          const backfill = msg.actions as AgentAction[]
          setActions(backfill)
          backfill.forEach((action) => seenIdsRef.current.add(action.id))
        } else if (msg.type === 'simulation_action' && msg.action) {
          const action = msg.action as AgentAction
          if (seenIdsRef.current.has(action.id)) return
          seenIdsRef.current.add(action.id)
          setActions((prev) => [...prev, action])
        } else if (msg.type === 'run_status') {
          setDetail((prev) => (prev ? { ...prev, run: { ...prev.run, status: msg.status } } : prev))
        }
      } catch {
        // Ignore malformed websocket payloads.
      }
    }

    return () => ws.close()
  }, [runId])

  const selectedHedge = useMemo(() => {
    if (!detail || selectedHedgeId === null) return null
    return detail.hedges.find((hedge) => hedge.id === selectedHedgeId) || null
  }, [detail, selectedHedgeId])

  const run = detail?.run

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Live simulation stream</p>
          <h1>
            Run <code>{runId.slice(0, 8)}</code>
          </h1>
        </div>
        <div className="header-links">
          <span className={`ws-pill ${wsOnline ? 'ws-on' : 'ws-off'}`}>
            {wsOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
            {wsOnline ? 'Live' : 'Offline'}
          </span>
          <Link className="back-link" to="/oasis-simulation/runs">
            Back to runs
          </Link>
        </div>
      </header>

      {error && (
        <p className="error-banner">
          <AlertCircle size={14} /> {error}
        </p>
      )}

      {run && (
        <section className="meta-grid">
          <div className="meta-card">
            <small>Status</small>
            <strong>{run.status}</strong>
          </div>
          <div className="meta-card">
            <small>Agents</small>
            <strong>{run.agent_count}</strong>
          </div>
          <div className="meta-card">
            <small>Markets</small>
            <strong>{run.market_count}</strong>
          </div>
          <div className="meta-card">
            <small>Rounds</small>
            <strong>{run.rounds}</strong>
          </div>
          <div className="meta-card">
            <small>Started</small>
            <strong>{timeAgo(run.started_at)}</strong>
          </div>
        </section>
      )}

      <section className="detail-grid">
        <article className="card">
          <div className="card-head">
            <h2>Agent feed</h2>
            <p className="muted">{actions.length} actions</p>
          </div>
          {actions.length === 0 ? (
            <div className="empty-state">
              <Loader2 size={18} className="spin" />
              <span>Waiting for actions...</span>
            </div>
          ) : (
            <div className="feed">
              {actions.map((action) => (
                <div className="feed-item" key={action.id}>
                  <div className="feed-head">
                    <strong>{action.agent_name}</strong>
                    <small>
                      round {action.round} · #{action.sequence} · {timeAgo(action.created_at)}
                    </small>
                  </div>
                  {action.title && <p className="feed-title">{action.title}</p>}
                  {action.content && <p className="feed-content">{action.content}</p>}
                </div>
              ))}
            </div>
          )}
        </article>

        <aside className="card">
          <div className="card-head">
            <h2>Hedges</h2>
            <p className="muted">{detail?.hedges.length || 0}</p>
          </div>
          <div className="hedge-list">
            {(detail?.hedges || []).map((hedge) => (
              <button
                key={hedge.id}
                className={`hedge-item ${selectedHedgeId === hedge.id ? 'hedge-active' : ''}`}
                onClick={() => setSelectedHedgeId(hedge.id)}
              >
                <strong>#{hedge.rank}</strong>
                <small>{Math.round(hedge.confidence_score)}% confidence</small>
                <p>{hedge.market_a_title}</p>
                <p>{hedge.market_b_title}</p>
              </button>
            ))}
          </div>
        </aside>
      </section>

      {selectedHedge && <HedgeDetail hedge={selectedHedge} />}
    </main>
  )
}

function HedgeDetail({ hedge }: { hedge: SynthesizedHedge }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Selected hedge #{hedge.rank}</h2>
        <p className="muted">{Math.round(hedge.confidence_score)}% confidence</p>
      </div>
      <div className="hedge-detail-grid">
        <article>
          <h3>Market A</h3>
          <p>{hedge.market_a_title}</p>
          <small>{hedge.market_a_event_title || 'No event title'}</small>
        </article>
        <article>
          <h3>Market B</h3>
          <p>{hedge.market_b_title}</p>
          <small>{hedge.market_b_event_title || 'No event title'}</small>
        </article>
      </div>
      <h3>Reasoning</h3>
      <p className="feed-content">{hedge.reasoning}</p>
    </section>
  )
}
