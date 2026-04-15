import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { OasisRunsPage } from './pages/OasisRunsPage'
import { OasisRunDetailPage } from './pages/OasisRunDetailPage'
import './App.css'

function HomePage() {
  return (
    <main className="page-shell home-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Polymarket dashboard demo</p>
          <h1>Frontend OASIS Console</h1>
        </div>
      </header>
      <section className="card">
        <h2>Ready to explore simulations</h2>
        <p className="muted">
          This frontend consumes the same backend OASIS endpoints used by the admin panel.
        </p>
        <div className="row">
          <Link className="primary-btn" to="/oasis-simulation/runs">
            Open runs dashboard
          </Link>
        </div>
      </section>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/oasis-simulation/runs" element={<OasisRunsPage />} />
      <Route path="/oasis-simulation/runs/:runId" element={<OasisRunDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
