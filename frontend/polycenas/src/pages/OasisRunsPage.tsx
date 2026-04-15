import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Activity, AlertCircle, Loader2, Play, RefreshCw } from 'lucide-react'
import { simulationApi, type RunStatus, type RunSummary, type SuperclusterSummary } from '../lib/api'

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

function statusTone(status: RunStatus): string {
  if (status === 'running') return 'tone-live'
  if (status === 'pending') return 'tone-pending'
  if (status === 'completed') return 'tone-done'
  return 'tone-fail'
}

export function OasisRunsPage() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [superclusters, setSuperclusters] = useState<SuperclusterSummary[]>([])
  const [selectedSupercluster, setSelectedSupercluster] = useState<number | null>(null)
  const [agentCap, setAgentCap] = useState(20)
  const [rounds, setRounds] = useState(3)
  const [topN, setTopN] = useState(5)
  const [loading, setLoading] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSuperclusters = useCallback(async () => {
    const list = await simulationApi.listSuperclusters()
    setSuperclusters(list)
    if (selectedSupercluster === null) {
      const first = list.find((cluster) => cluster.has_graph)
      if (first) setSelectedSupercluster(first.id)
    }
  }, [selectedSupercluster])

  const fetchRuns = useCallback(async (superClusterId?: number | null) => {
    setLoading(true)
    try {
      const list = superClusterId
        ? await simulationApi.listRunsForSupercluster(superClusterId)
        : await simulationApi.listAllRuns()
      setRuns(list)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSuperclusters().catch(() => {
      // If this fails we still want to render the page and runs list.
    })
  }, [fetchSuperclusters])

  useEffect(() => {
    fetchRuns(selectedSupercluster)
  }, [fetchRuns, selectedSupercluster])

  useEffect(() => {
    const hasActive = runs.some((run) => run.status === 'running' || run.status === 'pending')
    if (!hasActive) return
    const timer = setInterval(() => fetchRuns(selectedSupercluster), 3000)
    return () => clearInterval(timer)
  }, [runs, fetchRuns, selectedSupercluster])

  const selected = useMemo(() => {
    if (selectedSupercluster === null) return null
    return superclusters.find((cluster) => cluster.id === selectedSupercluster) || null
  }, [selectedSupercluster, superclusters])

  const onRun = async () => {
    if (!selectedSupercluster) return
    setTriggering(true)
    try {
      await simulationApi.triggerRun(selectedSupercluster, {
        agent_cap: agentCap,
        rounds,
        synthesize_top_n: topN,
      })
      setError(null)
      setTimeout(() => {
        fetchRuns(selectedSupercluster).catch(() => null)
      }, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTriggering(false)
    }
  }

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Polycenas frontend demo</p>
          <h1>OASIS Simulation Runs</h1>
        </div>
        <Link className="back-link" to="/">
          Home
        </Link>
      </header>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Trigger a new run</h2>
            <p className="muted">Same backend flow as admin with a cleaner dashboard style.</p>
          </div>
          <button className="ghost-btn" onClick={() => fetchRuns(selectedSupercluster)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="form-grid">
          <label>
            <span>Supercluster</span>
            <select
              value={selectedSupercluster ?? ''}
              onChange={(event) => setSelectedSupercluster(Number(event.target.value))}
            >
              <option value="">Select one...</option>
              {superclusters
                .filter((cluster) => cluster.has_graph)
                .map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>
                    {cluster.name || `cluster-${cluster.id}`} · {cluster.market_count} markets
                  </option>
                ))}
            </select>
          </label>

          <label>
            <span>Agents</span>
            <input
              type="number"
              value={agentCap}
              min={1}
              max={200}
              onChange={(event) => setAgentCap(Number(event.target.value))}
            />
          </label>

          <label>
            <span>Rounds</span>
            <input
              type="number"
              value={rounds}
              min={1}
              max={20}
              onChange={(event) => setRounds(Number(event.target.value))}
            />
          </label>

          <label>
            <span>Top-N Hedges</span>
            <input
              type="number"
              value={topN}
              min={1}
              max={20}
              onChange={(event) => setTopN(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="row">
          <p className="muted">
            {selected
              ? `Run on ${selected.name || `cluster-${selected.id}`} (${selected.market_count} markets)`
              : 'Pick a supercluster with graph data to run simulation.'}
          </p>
          <button
            className="primary-btn"
            onClick={onRun}
            disabled={!selectedSupercluster || !selected?.has_graph || triggering}
          >
            {triggering ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            Run simulation
          </button>
        </div>

        {error && (
          <p className="error-banner">
            <AlertCircle size={14} /> {error}
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Recent runs</h2>
          <p className="muted">{runs.length} total</p>
        </div>

        {loading && runs.length === 0 ? (
          <div className="empty-state">
            <Loader2 size={20} className="spin" />
            <span>Loading runs...</span>
          </div>
        ) : runs.length === 0 ? (
          <div className="empty-state">
            <Activity size={20} />
            <span>No runs yet. Trigger one above.</span>
          </div>
        ) : (
          <div className="run-list">
            {runs.map((run) => (
              <button
                key={run.id}
                className="run-item"
                onClick={() => navigate(`/oasis-simulation/runs/${run.id}`)}
              >
                <span className={`status-chip ${statusTone(run.status)}`}>{run.status}</span>
                <div className="run-main">
                  <strong>{run.id.slice(0, 8)}</strong>
                  <small>
                    {run.agent_count} agents · {run.rounds} rounds · started {timeAgo(run.started_at)}
                  </small>
                </div>
                <span className="run-arrow">→</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
