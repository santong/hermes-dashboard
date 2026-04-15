"""Load hermes configuration and resolve runtime credentials."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

HERMES_HOME = Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser()
HERMES_AGENT_DIR = HERMES_HOME / "hermes-agent"

# Add hermes-agent to sys.path so we can import its modules.
_agent_path = str(HERMES_AGENT_DIR)
if _agent_path not in sys.path:
    sys.path.insert(0, _agent_path)

# Load hermes .env (contains ANTHROPIC_TOKEN, etc.)
try:
    from dotenv import load_dotenv

    load_dotenv(HERMES_HOME / ".env")
except ImportError:
    pass


def load_hermes_config() -> dict[str, Any]:
    """Load ~/.hermes/config.yaml and return the raw dict."""
    from hermes_cli.config import load_config

    return load_config()


def resolve_runtime() -> dict[str, Any]:
    """Resolve the active model/provider/base_url/api_key bundle.

    Returns a dict with keys: provider, base_url, api_key, api_mode, model, max_turns.
    """
    cfg = load_hermes_config()
    model_cfg = cfg.get("model", {})
    agent_cfg = cfg.get("agent", {})

    from hermes_cli.runtime_provider import resolve_runtime_provider

    runtime = resolve_runtime_provider(requested=model_cfg.get("provider"))

    return {
        "model": model_cfg.get("default", "claude-sonnet-4-6"),
        "provider": runtime.get("provider", ""),
        "base_url": runtime.get("base_url", ""),
        "api_key": runtime.get("api_key", ""),
        "api_mode": runtime.get("api_mode", ""),
        "max_turns": int(agent_cfg.get("max_turns", 60)),
    }
