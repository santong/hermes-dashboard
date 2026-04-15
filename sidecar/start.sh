#!/bin/bash
# Start the Hermes Dashboard sidecar server.
# Uses hermes's own Python venv to ensure all dependencies are available.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENV="${HERMES_HOME:-$HOME/.hermes}/hermes-agent/venv"
PYTHON="$VENV/bin/python"
PORT="${SIDECAR_PORT:-9710}"

if [ ! -x "$PYTHON" ]; then
    echo "[sidecar] hermes venv not found at $VENV — sidecar disabled" >&2
    exit 0
fi

# Install FastAPI + uvicorn if missing (one-time).
if ! "$PYTHON" -c "import uvicorn" 2>/dev/null; then
    if command -v uv >/dev/null 2>&1; then
        uv pip install --python "$PYTHON" fastapi uvicorn 2>/dev/null || true
    else
        "$PYTHON" -m pip install -q fastapi uvicorn 2>/dev/null || true
    fi
fi

cd "$PROJECT_DIR"
exec "$PYTHON" -m uvicorn sidecar.server:app \
    --host 127.0.0.1 \
    --port "$PORT" \
    --log-level warning
