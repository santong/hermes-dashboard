import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";

import { getHermesBin } from "@/lib/hermes-env";
import { getSession } from "@/lib/hermes-sessions";
import type { ChatRunResult } from "@/lib/hermes-types";

// ─── Types for SSE events ─────────────────────────────────────────────

export type ChatStreamEvent =
  | { type: "token"; data: string }
  | { type: "session_id"; data: string }
  | { type: "status"; tool: string; detail: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; message: string };

export type StreamChatHandle = {
  generator: AsyncGenerator<ChatStreamEvent>;
  /** Kill the underlying process or abort the fetch. */
  kill: () => void;
};

// ─── Sidecar client ───────────────────────────────────────────────────

const SIDECAR_URL = process.env.SIDECAR_URL?.trim() || "http://127.0.0.1:9710";

async function isSidecarUp(): Promise<boolean> {
  try {
    const r = await fetch(`${SIDECAR_URL}/health`, {
      signal: AbortSignal.timeout(500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function createSidecarStream(prompt: string, sessionId?: string): StreamChatHandle {
  const controller = new AbortController();

  async function* generate(): AsyncGenerator<ChatStreamEvent> {
    const response = await fetch(`${SIDECAR_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, sessionId }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Sidecar request failed");
      throw new Error(text);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response stream from sidecar");

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          let eventType = "";
          let eventData = "";
          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            else if (line.startsWith("data: ")) eventData = line.slice(6);
          }

          switch (eventType) {
            case "token":
              yield { type: "token", data: eventData };
              break;
            case "session_id":
              yield { type: "session_id", data: eventData };
              break;
            case "status": {
              const s = JSON.parse(eventData) as { tool: string; detail: string };
              yield { type: "status", tool: s.tool, detail: s.detail };
              break;
            }
            case "done": {
              const parsed = JSON.parse(eventData) as { sessionId: string };
              yield { type: "done", sessionId: parsed.sessionId };
              break;
            }
            case "error":
              yield { type: "error", message: eventData };
              break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  return {
    generator: generate(),
    kill() {
      controller.abort();
    },
  };
}

// ─── CLI fallback (existing spawn logic) ──────────────────────────────

function classifyLine(line: string): { kind: "skip" | "session_id" | "text"; value: string } {
  const trimmed = line.trimEnd();
  if (!trimmed) return { kind: "skip", value: "" };
  if (trimmed.startsWith("╭─ ⚕ Hermes")) return { kind: "skip", value: "" };
  if (trimmed.startsWith("╰")) return { kind: "skip", value: "" };
  if (trimmed.startsWith("session_id:")) {
    return { kind: "session_id", value: trimmed.slice("session_id:".length).trim() };
  }
  return { kind: "text", value: trimmed };
}

function createCliStream(prompt: string, sessionId?: string): StreamChatHandle {
  const args = ["chat", "-Q", "-q", prompt, "--source", "dashboard"];
  if (sessionId) {
    args.push("--resume", sessionId);
  }

  const hermesBin = getHermesBin();
  const child: ChildProcess = spawn(hermesBin, args, {
    env: {
      ...process.env,
      PATH: [process.env.PATH, `${os.homedir()}/.local/bin`, "/usr/local/bin"]
        .filter(Boolean)
        .join(":"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let detectedSessionId: string | null = null;
  const stderrChunks: string[] = [];
  const events: ChatStreamEvent[] = [];
  let notifyReady: (() => void) | null = null;
  let streamDone = false;

  function push(event: ChatStreamEvent) {
    events.push(event);
    const fn = notifyReady;
    notifyReady = null;
    fn?.();
  }

  let lineBuffer = "";

  child.stdout!.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString("utf-8");
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const classified = classifyLine(line);
      if (classified.kind === "session_id") {
        detectedSessionId = classified.value;
        push({ type: "session_id", data: classified.value });
      } else if (classified.kind === "text") {
        push({ type: "token", data: classified.value + "\n" });
      }
    }
  });

  child.stderr!.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString("utf-8"));
  });

  child.on("close", (code) => {
    if (lineBuffer.trim()) {
      const classified = classifyLine(lineBuffer);
      if (classified.kind === "session_id") {
        detectedSessionId = classified.value;
        push({ type: "session_id", data: classified.value });
      } else if (classified.kind === "text") {
        push({ type: "token", data: classified.value });
      }
    }

    if (code !== 0 && !detectedSessionId) {
      const stderr = stderrChunks.join("");
      push({ type: "error", message: `Hermes exited with code ${code}: ${stderr.slice(0, 500)}` });
    } else {
      push({ type: "done", sessionId: detectedSessionId ?? "" });
    }

    streamDone = true;
    const fn = notifyReady;
    notifyReady = null;
    fn?.();
  });

  child.on("error", (err) => {
    push({ type: "error", message: `Failed to spawn hermes: ${err.message}` });
    streamDone = true;
    const fn = notifyReady;
    notifyReady = null;
    fn?.();
  });

  async function* generate(): AsyncGenerator<ChatStreamEvent> {
    while (true) {
      if (events.length > 0) {
        yield events.shift()!;
        if (streamDone && events.length === 0) break;
      } else if (streamDone) {
        break;
      } else {
        await new Promise<void>((resolve) => {
          notifyReady = resolve;
        });
      }
    }
  }

  return {
    generator: generate(),
    kill() {
      if (!child.killed) {
        child.kill();
      }
    },
  };
}

// ─── Public API: sidecar-first with CLI fallback ──────────────────────

/**
 * Create a chat stream, trying sidecar first, falling back to CLI spawn.
 *
 * The caller MUST call handle.kill() on disconnect to clean up resources.
 */
export async function createChatStream(prompt: string, sessionId?: string): Promise<StreamChatHandle> {
  if (await isSidecarUp()) {
    return createSidecarStream(prompt, sessionId);
  }
  return createCliStream(prompt, sessionId);
}

// ─── Convenience wrappers ─────────────────────────────────────────────

export async function* streamChat(
  prompt: string,
  sessionId?: string,
): AsyncGenerator<ChatStreamEvent> {
  const handle = await createChatStream(prompt, sessionId);
  try {
    yield* handle.generator;
  } finally {
    handle.kill();
  }
}

export async function runChat(prompt: string, sessionId?: string): Promise<ChatRunResult> {
  let finalSessionId = "";
  const textParts: string[] = [];

  for await (const event of streamChat(prompt, sessionId)) {
    switch (event.type) {
      case "token":
        textParts.push(event.data);
        break;
      case "session_id":
        finalSessionId = event.data;
        break;
      case "done":
        finalSessionId = event.sessionId || finalSessionId;
        break;
      case "error":
        throw new Error(event.message);
    }
  }

  if (!finalSessionId) {
    throw new Error("Hermes did not return a session_id");
  }

  const session = await getSession(finalSessionId);
  if (!session) {
    throw new Error(`Session ${finalSessionId} was created but could not be loaded`);
  }

  return {
    sessionId: finalSessionId,
    response: textParts.join("\n"),
    session,
  };
}
