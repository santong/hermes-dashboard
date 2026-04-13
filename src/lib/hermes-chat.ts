import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";

import { getHermesBin } from "@/lib/hermes-env";
import { getSession } from "@/lib/hermes-sessions";
import type { ChatRunResult } from "@/lib/hermes-types";

// ─── Types for SSE events ─────────────────────────────────────────────

export type ChatStreamEvent =
  | { type: "token"; data: string }
  | { type: "session_id"; data: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; message: string };

// ─── Line classification (replaces sanitizeChatStdout) ────────────────

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

// ─── Streaming chat via AsyncGenerator ────────────────────────────────

export type StreamChatHandle = {
  generator: AsyncGenerator<ChatStreamEvent>;
  /** Kill the child process (e.g. when the client disconnects). */
  kill: () => void;
};

/**
 * Spawn hermes CLI and return an async generator of SSE events plus a kill handle.
 *
 * The caller MUST call handle.kill() if the consumer disconnects before the
 * stream ends, otherwise the hermes child process will keep running.
 *
 * Protocol:
 *   token      — each chunk of stdout text
 *   session_id — when the session_id line is detected
 *   done       — stream complete, includes session ID
 *   error      — on failure
 */
export function createChatStream(prompt: string, sessionId?: string): StreamChatHandle {
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

  // Event queue with promise-based signaling for the async generator
  const events: ChatStreamEvent[] = [];
  let notifyReady: (() => void) | null = null;
  let streamDone = false;

  function push(event: ChatStreamEvent) {
    events.push(event);
    // Clear notifyReady BEFORE calling to avoid stale resolver issues
    const fn = notifyReady;
    notifyReady = null;
    fn?.();
  }

  // Buffer for incomplete lines (stdout may chunk mid-line)
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
        push({ type: "token", data: classified.value });
      }
    }
  });

  child.stderr!.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString("utf-8"));
  });

  child.on("close", (code) => {
    // Flush remaining line buffer
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

// ─── Convenience wrapper for non-streaming use ────────────────────────

export async function* streamChat(
  prompt: string,
  sessionId?: string,
): AsyncGenerator<ChatStreamEvent> {
  const handle = createChatStream(prompt, sessionId);
  try {
    yield* handle.generator;
  } finally {
    handle.kill();
  }
}

// ─── Non-streaming fallback (consumes streamChat internally) ──────────

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
