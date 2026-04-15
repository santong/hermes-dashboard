"""Hermes Dashboard sidecar — thin FastAPI wrapper around AIAgent."""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import sys
from contextlib import contextmanager
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from sidecar.agent_pool import AgentPool
from sidecar.config import resolve_runtime

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logger = logging.getLogger("sidecar")

app = FastAPI(title="Hermes Dashboard Sidecar")

_pool: Optional[AgentPool] = None


def get_pool() -> AgentPool:
    global _pool
    if _pool is None:
        logger.info("Initializing agent pool...")
        runtime = resolve_runtime()
        logger.info(
            "Runtime resolved: model=%s provider=%s base_url=%s",
            runtime["model"],
            runtime["provider"],
            runtime["base_url"][:40] if runtime["base_url"] else "(empty)",
        )
        _pool = AgentPool(runtime=runtime)
    return _pool


@contextmanager
def suppress_stdout():
    """Redirect stdout to /dev/null during agent execution.

    Hermes prints TUI spinners, tool previews, and progress bars to stdout
    even in quiet_mode. This keeps the sidecar console clean.
    """
    devnull = open(os.devnull, "w")
    old_stdout = sys.stdout
    sys.stdout = devnull
    try:
        yield
    finally:
        sys.stdout = old_stdout
        devnull.close()


# ── Health check ──────────────────────────────────────────────────────


@app.get("/health")
async def health():
    pool = get_pool()
    return {"status": "ok", "pool_size": pool.size}


# ── Chat SSE endpoint ─────────────────────────────────────────────────


class ChatRequest(BaseModel):
    prompt: str
    sessionId: Optional[str] = None


@app.post("/chat")
async def chat(body: ChatRequest, request: Request):
    pool = get_pool()

    prompt = body.prompt.strip()
    if not prompt:
        return {"error": "Prompt is required"}

    queue: asyncio.Queue[dict] = asyncio.Queue()

    def stream_cb(token: str):
        """Called synchronously from the agent thread with each text delta."""
        queue.put_nowait({"event": "token", "data": token})

    def tool_progress_cb(tool_name: str, detail: str):
        """Called synchronously when a tool reports progress."""
        queue.put_nowait({
            "event": "status",
            "data": json.dumps({"tool": tool_name, "detail": detail}, ensure_ascii=False),
        })

    async def run_agent():
        session_id = ""
        try:
            agent = pool.get_or_create(body.sessionId)

            # Wire per-request callbacks onto the agent instance.
            agent.tool_progress_callback = tool_progress_cb

            session_id = getattr(agent, "session_id", "") or ""
            if session_id:
                await queue.put({"event": "session_id", "data": session_id})

            def _run_chat():
                with suppress_stdout():
                    return agent.chat(prompt, stream_callback=stream_cb)

            result = await asyncio.to_thread(_run_chat)

            session_id = getattr(agent, "session_id", "") or session_id

            if not body.sessionId and session_id:
                pool.register(session_id, agent)

            await queue.put(
                {"event": "done", "data": json.dumps({"sessionId": session_id})}
            )
        except Exception as e:
            logger.exception("Agent error")
            # Always send the error so the frontend can display it.
            await queue.put({"event": "error", "data": str(e)})
            # Also send done with session_id if available, so frontend can
            # load any partial results the agent persisted before failing.
            if session_id:
                await queue.put(
                    {"event": "done", "data": json.dumps({"sessionId": session_id})}
                )
        finally:
            await queue.put({"event": "_sentinel", "data": ""})

    task = asyncio.create_task(run_agent())

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    task.cancel()
                    break

                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue

                if item["event"] == "_sentinel":
                    break

                yield f"event: {item['event']}\ndata: {item['data']}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
