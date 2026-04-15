#!/usr/bin/env bash

set -euo pipefail

POLYCENAS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$POLYCENAS_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
ADMIN_DIR="$POLYCENAS_DIR/admin-panel"
PIDFILE="$POLYCENAS_DIR/.demo-pids"

log() {
  echo "[demo] $*"
}

cleanup() {
  if [[ -f "$PIDFILE" ]]; then
    while IFS= read -r pid; do
      kill "$pid" 2>/dev/null || true
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
}

start_backend() {
  (
    cd "$BACKEND_DIR"
    if [[ -d "venv" ]]; then
      source venv/bin/activate
    elif [[ -d ".venv" ]]; then
      source .venv/bin/activate
    fi
    exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
  ) &
  echo "$!" >> "$PIDFILE"
  log "Backend started at http://localhost:8000"
}

start_admin() {
  (
    cd "$ADMIN_DIR"
    export NEXT_PUBLIC_ADMIN_DEV_MODE=true
    exec npm run dev
  ) &
  echo "$!" >> "$PIDFILE"
  log "Admin panel started at http://localhost:3001"
}

if [[ "${1:-}" == "--stop" ]]; then
  cleanup
  log "Stopped demo services."
  exit 0
fi

rm -f "$PIDFILE"
trap cleanup EXIT INT TERM

log "Starting demo services from polycenas..."
start_backend
start_admin

log "Open:"
log "  - http://localhost:3001/oasis-simulation/runs"
log "Press Ctrl+C to stop."

wait
