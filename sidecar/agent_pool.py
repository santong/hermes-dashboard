"""LRU pool of AIAgent instances, keyed by session_id."""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Optional

logger = logging.getLogger("sidecar.pool")

# Lazy import — AIAgent is heavy, only load when first needed.
_AIAgent = None


def _get_agent_cls():
    global _AIAgent
    if _AIAgent is None:
        from run_agent import AIAgent

        _AIAgent = AIAgent
    return _AIAgent


class AgentPool:
    """Thread-safe LRU pool of AIAgent instances.

    - get_or_create(session_id) returns a cached agent or creates a new one.
    - Idle agents are evicted after ``ttl_seconds``.
    - Pool size is capped at ``max_size``; LRU entry is evicted on overflow.
    """

    def __init__(
        self,
        runtime: dict[str, Any],
        max_size: int = 5,
        ttl_seconds: float = 600.0,
    ):
        self._runtime = runtime
        self._max_size = max_size
        self._ttl = ttl_seconds
        self._lock = threading.Lock()
        # OrderedDict for LRU: most recently used at the end.
        self._agents: OrderedDict[str, _PoolEntry] = OrderedDict()

    # ── Public API ────────────────────────────────────────────────────

    def get_or_create(self, session_id: Optional[str]) -> "_AIAgent":
        """Return a cached agent for *session_id*, or create a fresh one.

        If *session_id* is None, a new agent (and session) is created.
        """
        self._evict_expired()

        if session_id:
            with self._lock:
                entry = self._agents.get(session_id)
                if entry is not None:
                    entry.last_used = time.monotonic()
                    self._agents.move_to_end(session_id)
                    logger.info("Pool hit: session=%s", session_id[:12])
                    return entry.agent

        # Cache miss or new session — build a fresh agent.
        agent = self._build_agent(session_id)
        resolved_id = getattr(agent, "session_id", None) or session_id

        if resolved_id:
            with self._lock:
                self._agents[resolved_id] = _PoolEntry(agent=agent)
                self._agents.move_to_end(resolved_id)
                self._enforce_max_size()
            logger.info("Pool add: session=%s (pool_size=%d)", resolved_id[:12], len(self._agents))

        return agent

    def register(self, session_id: str, agent: "_AIAgent") -> None:
        """Register an agent that was created without a session_id."""
        with self._lock:
            self._agents[session_id] = _PoolEntry(agent=agent)
            self._agents.move_to_end(session_id)
            self._enforce_max_size()

    def rekey(self, previous_session_id: str, new_session_id: str, agent: "_AIAgent") -> None:
        """Move a cached agent from one session key to another.

        Hermes can switch session IDs mid-run (for example after context
        compression). When that happens, the pool must follow the new ID or
        later lookups will either miss or, worse, reuse the agent under an
        outdated parent-session key.
        """
        if previous_session_id == new_session_id:
            self.register(new_session_id, agent)
            return

        with self._lock:
            entry = self._agents.get(previous_session_id)
            if entry is not None and entry.agent is agent:
                del self._agents[previous_session_id]
            else:
                entry = _PoolEntry(agent=agent)

            self._agents[new_session_id] = entry
            self._agents.move_to_end(new_session_id)
            self._enforce_max_size()

    @property
    def size(self) -> int:
        return len(self._agents)

    # ── Internals ─────────────────────────────────────────────────────

    def _build_agent(self, session_id: Optional[str]) -> "_AIAgent":
        AIAgent = _get_agent_cls()
        rt = self._runtime

        # SessionDB is required for persisting sessions to state.db.
        # Without it, the agent runs but never writes messages to disk,
        # so the dashboard's Node.js backend can't read them back.
        session_db = None
        try:
            from hermes_state import SessionDB
            session_db = SessionDB()
        except Exception as exc:
            logger.warning("SessionDB init failed: %s", exc)

        return AIAgent(
            model=rt["model"],
            api_key=rt["api_key"],
            base_url=rt["base_url"],
            provider=rt["provider"],
            api_mode=rt["api_mode"],
            max_iterations=rt["max_turns"],
            quiet_mode=True,
            session_id=session_id,
            session_db=session_db,
            platform="dashboard",
            tool_delay=0.0,
        )

    def _evict_expired(self) -> None:
        now = time.monotonic()
        with self._lock:
            expired = [
                sid
                for sid, entry in self._agents.items()
                if now - entry.last_used > self._ttl
            ]
            for sid in expired:
                del self._agents[sid]
                logger.info("Pool evict (ttl): session=%s", sid[:12])

    def _enforce_max_size(self) -> None:
        """Must be called with self._lock held."""
        while len(self._agents) > self._max_size:
            evicted_sid, _ = self._agents.popitem(last=False)
            logger.info("Pool evict (lru): session=%s", evicted_sid[:12])


class _PoolEntry:
    __slots__ = ("agent", "last_used")

    def __init__(self, agent: "_AIAgent"):
        self.agent = agent
        self.last_used = time.monotonic()
