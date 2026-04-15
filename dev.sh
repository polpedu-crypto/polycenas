#!/bin/bash
# ============================================================================
# Polycenas — Dev Run Script
#
# Boots API, Vite frontend, and Next.js admin panel in parallel with
# colored, labeled output.
#
# Usage:
#   ./dev.sh              Start all services
#   ./dev.sh --no-front   Skip frontend (Vite)
#   ./dev.sh --no-admin   Skip admin panel
#   ./dev.sh --api-only   API only
#   ./dev.sh --stop       Kill all running dev processes
# ============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend/polycenas"
ADMIN_DIR="$ROOT_DIR/admin-panel"
PIDFILE="$ROOT_DIR/.dev-pids"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()      { echo -e "${GREEN}[dev]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[dev]${NC} $*"; }
log_err()  { echo -e "${RED}[dev]${NC} $*"; }

_kill_descendants() {
    local parent=$1
    local sig=$2
    local children
    children=$(pgrep -P "$parent" 2>/dev/null) || return 0
    for child in $children; do
        _kill_descendants "$child" "$sig"
        kill -"$sig" "$child" 2>/dev/null || true
    done
}

cleanup() {
    log "Shutting down all services..."
    _kill_descendants $$ TERM
    if [ -f "$PIDFILE" ]; then
        while IFS= read -r pid; do
            if kill -0 "$pid" 2>/dev/null; then
                _kill_descendants "$pid" TERM
                kill -TERM "$pid" 2>/dev/null || true
            fi
        done < "$PIDFILE"
    fi
    for port in 8000 3001 5173 5174; do
        local pids
        pids=$(lsof -ti :"$port" 2>/dev/null) || true
        for pid in $pids; do
            kill -TERM "$pid" 2>/dev/null || true
        done
    done
    sleep 2
    _kill_descendants $$ KILL
    if [ -f "$PIDFILE" ]; then
        while IFS= read -r pid; do
            kill -KILL "$pid" 2>/dev/null || true
        done < "$PIDFILE"
    fi
    for port in 8000 3001 5173 5174; do
        local pids
        pids=$(lsof -ti :"$port" 2>/dev/null) || true
        for pid in $pids; do
            kill -KILL "$pid" 2>/dev/null || true
        done
    done
    rm -f "$PIDFILE"
    wait 2>/dev/null || true
    log "All services stopped."
    if [ -n "${CLEANUP_ON_SIGNAL:-}" ]; then
        trap - EXIT INT TERM
        exit 0
    fi
}

stop_from_pidfile() {
    if [ ! -f "$PIDFILE" ]; then
        log "No running services found."
        return
    fi
    while IFS= read -r pid; do
        if kill -0 "$pid" 2>/dev/null; then
            _kill_descendants "$pid" TERM
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done < "$PIDFILE"
    sleep 2
    while IFS= read -r pid; do
        if kill -0 "$pid" 2>/dev/null; then
            _kill_descendants "$pid" KILL
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done < "$PIDFILE"
    rm -f "$PIDFILE"
    log "All services stopped."
}

trap 'CLEANUP_ON_SIGNAL=1; cleanup' INT TERM
trap cleanup EXIT

save_pid() { echo "$1" >> "$PIDFILE"; }

wait_for_port() {
    local port=$1
    local name=$2
    local max_wait=${3:-30}
    local waited=0
    while ! nc -z localhost "$port" 2>/dev/null; do
        sleep 1
        waited=$((waited + 1))
        if [ "$waited" -ge "$max_wait" ]; then
            log_warn "$name not ready after ${max_wait}s on port $port"
            return 1
        fi
    done
    log "$name ready on port $port"
    return 0
}

# ── pre-flight ────────────────────────────────────────────────────────

preflight() {
    log "Running pre-flight checks..."

    if [ ! -f "$BACKEND_DIR/.env" ]; then
        log_err "backend/.env not found! Create it with DATABASE_URL, VERTEX_API_KEY, OPENROUTER_API_KEY."
        exit 1
    fi

    if [ -d "$BACKEND_DIR/.venv" ]; then
        log "Python venv found"
    else
        log_warn "No venv at backend/.venv — dependencies may be missing"
    fi

    if [ "$SKIP_FRONTEND" = false ] && [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        log_warn "frontend/polycenas/node_modules not found, running npm install..."
        (cd "$FRONTEND_DIR" && npm install)
    fi

    if [ "$SKIP_ADMIN" = false ] && [ ! -d "$ADMIN_DIR/node_modules" ]; then
        log_warn "admin-panel/node_modules not found, running npm install..."
        (cd "$ADMIN_DIR" && npm install)
    fi
}

# ── launchers ─────────────────────────────────────────────────────────

start_api() {
    log "Starting API (port 8000)..."
    (
        cd "$BACKEND_DIR"
        if [ -d ".venv" ]; then
            source .venv/bin/activate
        fi
        exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --log-level info
    ) 2>&1 | while IFS= read -r line; do
        echo -e "${CYAN}[api]${NC} ${line}"
    done &
    save_pid $!
}

start_frontend() {
    log "Starting frontend (Vite, port 5173)..."
    (
        cd "$FRONTEND_DIR"
        exec npm run dev
    ) 2>&1 | while IFS= read -r line; do
        echo -e "${BLUE}[front]${NC} ${line}"
    done &
    save_pid $!
}

start_admin() {
    log "Starting admin panel (Next.js, port 3001)..."
    (
        cd "$ADMIN_DIR"
        export NEXT_PUBLIC_ADMIN_DEV_MODE=true
        exec npm run dev
    ) 2>&1 | while IFS= read -r line; do
        echo -e "${RED}[admin]${NC} ${line}"
    done &
    save_pid $!
}

# ── main ──────────────────────────────────────────────────────────────

SKIP_FRONTEND=false
SKIP_ADMIN=false
API_ONLY=false

for arg in "$@"; do
    case $arg in
        --no-front)  SKIP_FRONTEND=true ;;
        --no-admin)  SKIP_ADMIN=true ;;
        --api-only)
            API_ONLY=true
            SKIP_FRONTEND=true
            SKIP_ADMIN=true
            ;;
        --stop)
            stop_from_pidfile
            exit 0
            ;;
        --help|-h)
            echo "Usage: ./dev.sh [OPTIONS]"
            echo ""
            echo "  --no-front   Skip Vite frontend (port 5173)"
            echo "  --no-admin   Skip Next.js admin panel (port 3001)"
            echo "  --api-only   Only start the API (port 8000)"
            echo "  --stop       Kill all running dev services"
            echo "  --help       Show this help"
            exit 0
            ;;
    esac
done

rm -f "$PIDFILE"

echo ""
echo "========================================"
echo "  Polycenas — Dev Mode"
echo "========================================"
echo ""

preflight
echo ""

start_api

if [ "$SKIP_FRONTEND" = false ]; then
    start_frontend
fi

if [ "$SKIP_ADMIN" = false ]; then
    start_admin
fi

echo ""
sleep 3
wait_for_port 8000 "API" 30 || true

echo ""
echo "========================================"
echo "  Services Running"
echo "========================================"
echo ""
echo -e "  ${CYAN}API${NC}       http://localhost:8000"
echo -e "  ${CYAN}Docs${NC}      http://localhost:8000/docs"
echo -e "  ${CYAN}Health${NC}    http://localhost:8000/health"

if [ "$SKIP_FRONTEND" = false ]; then
    echo -e "  ${BLUE}Frontend${NC}  http://localhost:5173"
fi

if [ "$SKIP_ADMIN" = false ]; then
    echo -e "  ${RED}Admin${NC}     http://localhost:3001"
    echo -e "  ${RED}OASIS Sim${NC} http://localhost:3001/oasis-simulation/runs"
fi

echo ""
echo "  Press Ctrl+C to stop all services"
echo "========================================"
echo ""

(
    sleep 8
    if command -v curl &> /dev/null; then
        HEALTH=$(curl -s http://localhost:8000/health 2>/dev/null || echo '{"status":"unreachable"}')
        echo ""
        echo -e "${GREEN}[health]${NC} GET /health → $HEALTH"
        echo ""
    fi
) &

wait
