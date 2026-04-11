import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

import type {
  ChatRunResult,
  SessionDetail,
  SessionKind,
  SessionLink,
  SessionMessage,
  SessionSummary,
  SessionToolCall,
} from "@/lib/hermes-types";

const execFileAsync = promisify(execFile);
const DEFAULT_HERMES_HOME = `${os.homedir()}/.hermes`;

type SessionRow = {
  id: string;
  title: string | null;
  source: string | null;
  model: string | null;
  parent_session_id: string | null;
  started_at: number | null;
  updated_at: number | null;
  ended_at: number | null;
  end_reason: string | null;
  message_count: number | null;
  tool_call_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  preview: string | null;
  user_msgs: number | null;
  assistant_msgs: number | null;
  tool_msgs: number | null;
  system_msgs: number | null;
  total_tokens: number | null;
};

function getHermesHome() {
  return process.env.HERMES_HOME?.trim() || DEFAULT_HERMES_HOME;
}

function getStateDbPath() {
  return `${getHermesHome()}/state.db`;
}

function formatTimestamp(value: number | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function splitReasoning(text: string | null | undefined) {
  if (!text) return [];
  return text
    .split(/\n{2,}|\r\n{2,}/)
    .map((part) => part.replace(/^#+\s*/g, "").trim())
    .filter(Boolean);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function extractReasoning(reasoning: string | null | undefined, reasoningDetails: string | null | undefined) {
  const items = [...splitReasoning(reasoning)];
  const details = parseJson<Array<{ summary?: string[]; text?: string }>>(reasoningDetails, []);

  for (const detail of details) {
    if (Array.isArray(detail.summary)) {
      items.push(...detail.summary.map((entry) => entry.trim()).filter(Boolean));
    }
    if (typeof detail.text === "string" && detail.text.trim()) {
      items.push(detail.text.trim());
    }
  }

  return Array.from(new Set(items));
}

function extractToolCalls(toolCallsValue: string | null | undefined): SessionToolCall[] {
  const raw = parseJson<Array<{ id?: string; function?: { name?: string; arguments?: string } }>>(toolCallsValue, []);
  return raw.map((item, index) => ({
    id: item.id ?? `tool-${index}`,
    name: item.function?.name ?? "tool",
    status: "planned",
    arguments: item.function?.arguments,
  }));
}

function summarizeContent(content: string) {
  const singleLine = content.replace(/\s+/g, " ").trim();
  if (!singleLine) return "No transcript yet";
  return singleLine.length > 180 ? `${singleLine.slice(0, 180)}…` : singleLine;
}

async function runPythonJson<T>(code: string, args: string[] = []) {
  const { stdout } = await execFileAsync("python3", ["-c", code, ...args], {
    maxBuffer: 1024 * 1024 * 20,
  });
  return JSON.parse(stdout) as T;
}

async function fetchSessionRows(): Promise<SessionRow[]> {
  const code = String.raw`
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
rows = conn.execute("""
select
  s.id,
  s.title,
  s.source,
  s.model,
  s.parent_session_id,
  s.started_at,
  coalesce(s.ended_at, s.started_at) as updated_at,
  s.ended_at,
  s.end_reason,
  s.message_count,
  s.tool_call_count,
  s.input_tokens,
  s.output_tokens,
  s.reasoning_tokens,
  s.estimated_cost_usd as estimated_cost,
  s.actual_cost_usd as actual_cost,
  (
    select m.content
    from messages m
    where m.session_id = s.id
      and m.role in ('assistant', 'user', 'tool')
      and length(trim(coalesce(m.content, ''))) > 0
    order by m.id desc
    limit 1
  ) as preview,
  coalesce(sum(case when m.role = 'user' then 1 else 0 end), 0) as user_msgs,
  coalesce(sum(case when m.role = 'assistant' then 1 else 0 end), 0) as assistant_msgs,
  coalesce(sum(case when m.role = 'tool' then 1 else 0 end), 0) as tool_msgs,
  coalesce(sum(case when m.role = 'system' then 1 else 0 end), 0) as system_msgs,
  coalesce(sum(coalesce(m.token_count, 0)), 0) as total_tokens
from sessions s
left join messages m on m.session_id = s.id
group by s.id
order by s.started_at desc
""").fetchall()
print(json.dumps([dict(row) for row in rows], ensure_ascii=False))
`;

  return runPythonJson<SessionRow[]>(code, [getStateDbPath()]);
}

function buildLineage(idsBySession: Map<string, SessionSummary>, startId: string) {
  const lineage: SessionSummary[] = [];
  const seen = new Set<string>();
  let current = idsBySession.get(startId) ?? null;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    lineage.unshift(current);
    current = current.parentSessionId ? (idsBySession.get(current.parentSessionId) ?? null) : null;
  }

  return lineage;
}

function toLink(session: SessionSummary): SessionLink {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    kind: session.kind,
    source: session.source,
    startedAt: session.startedAt,
    summary: session.summary,
  };
}

function deriveSessionKind(params: { parentSessionId: string | null; hasTranscript: boolean }): SessionKind {
  if (!params.hasTranscript) return "empty";
  if (params.parentSessionId) return "child";
  return "root";
}

function normalizeSessionRows(rows: SessionRow[]) {
  const childMap = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_session_id) continue;
    const current = childMap.get(row.parent_session_id) ?? [];
    current.push(String(row.id));
    childMap.set(row.parent_session_id, current);
  }

  const sessions: SessionSummary[] = rows.map((row) => {
    const messageCount = Number(row.message_count || 0);
    const userMessageCount = Number(row.user_msgs || 0);
    const assistantMessageCount = Number(row.assistant_msgs || 0);
    const toolMessageCount = Number(row.tool_msgs || 0);
    const systemMessageCount = Number(row.system_msgs || 0);
    const hasTranscript =
      messageCount > 0 || userMessageCount > 0 || assistantMessageCount > 0 || toolMessageCount > 0 || systemMessageCount > 0;
    const kind = deriveSessionKind({
      parentSessionId: row.parent_session_id ? String(row.parent_session_id) : null,
      hasTranscript,
    });
    const interactive = userMessageCount > 0;
    const toolHeavy = Number(row.tool_call_count || 0) > 0 || toolMessageCount > 0;
    const delegatedCandidate = Boolean(row.parent_session_id) && !interactive && toolHeavy;
    const preview = summarizeContent(String(row.preview || ""));

    return {
      id: String(row.id),
      title: String(row.title || summarizeContent(String(row.preview || "Untitled session"))),
      status: row.ended_at ? "done" : "active",
      source: String(row.source || "cli"),
      startedAt: formatTimestamp(Number(row.started_at || 0)),
      updatedAt: formatTimestamp(Number(row.updated_at || row.started_at || 0)),
      model: String(row.model || "default"),
      messageCount,
      toolCallCount: Number(row.tool_call_count || 0),
      summary: preview,
      parentSessionId: row.parent_session_id ? String(row.parent_session_id) : null,
      childSessionIds: childMap.get(String(row.id)) ?? [],
      lineageIds: [],
      kind,
      interactive,
      hasTranscript,
      toolHeavy,
      delegatedCandidate,
      userMessageCount,
      assistantMessageCount,
      toolMessageCount,
      systemMessageCount,
      totalTokens: Number(row.total_tokens || 0),
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      reasoningTokens: Number(row.reasoning_tokens || 0),
      estimatedCost: row.estimated_cost == null ? null : Number(row.estimated_cost),
      actualCost: row.actual_cost == null ? null : Number(row.actual_cost),
      endReason: row.end_reason ? String(row.end_reason) : null,
    } satisfies SessionSummary;
  });

  const idsBySession = new Map(sessions.map((session) => [session.id, session]));

  for (const session of sessions) {
    session.lineageIds = buildLineage(idsBySession, session.id).map((item) => item.id);
  }

  return { sessions, idsBySession };
}

export async function listSessions(): Promise<SessionSummary[]> {
  const rows = await fetchSessionRows();
  const { sessions } = normalizeSessionRows(rows);
  return sessions;
}

export async function getSession(sessionId: string): Promise<SessionDetail | null> {
  const code = String.raw`
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
session = conn.execute("select * from sessions where id = ?", (sys.argv[2],)).fetchone()
if not session:
    print('null')
    raise SystemExit(0)
messages = conn.execute("select * from messages where session_id = ? order by id", (sys.argv[2],)).fetchall()
print(json.dumps({"session": dict(session), "messages": [dict(row) for row in messages]}, ensure_ascii=False))
`;

  const [data, rows] = await Promise.all([
    runPythonJson<{
      session: Record<string, string | number | null>;
      messages: Array<Record<string, string | number | null>>;
    } | null>(code, [getStateDbPath(), sessionId]),
    fetchSessionRows(),
  ]);

  if (!data) return null;

  const { sessions, idsBySession } = normalizeSessionRows(rows);
  const sessionBase = sessions.find((item) => item.id === sessionId);
  if (!sessionBase) return null;

  const messages: SessionMessage[] = data.messages.map((message) => ({
    id: String(message.id),
    role: (message.role as SessionMessage["role"]) ?? "assistant",
    author:
      message.role === "user"
        ? "You"
        : message.role === "assistant"
          ? "Hermes"
          : message.role === "tool"
            ? "Tool"
            : "System",
    timestamp: formatTimestamp(Number(message.timestamp || 0)),
    content: String(message.content || ""),
    toolName: typeof message.tool_name === "string" ? message.tool_name : null,
    toolCallId: typeof message.tool_call_id === "string" ? message.tool_call_id : null,
    tokenCount: typeof message.token_count === "number" ? message.token_count : null,
    reasoning: extractReasoning(
      typeof message.reasoning === "string" ? message.reasoning : null,
      typeof message.reasoning_details === "string" ? message.reasoning_details : null
    ),
    toolCalls: extractToolCalls(typeof message.tool_calls === "string" ? message.tool_calls : null),
    rawReasoning: typeof message.reasoning === "string" ? message.reasoning : null,
    rawReasoningDetails: typeof message.reasoning_details === "string" ? message.reasoning_details : null,
    rawToolCalls: typeof message.tool_calls === "string" ? message.tool_calls : null,
  }));

  const lineage = buildLineage(idsBySession, sessionId).map(toLink);
  const children = sessionBase.childSessionIds
    .map((childId) => idsBySession.get(childId))
    .filter((item): item is SessionSummary => Boolean(item))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map(toLink);

  return {
    ...sessionBase,
    messages,
    lineage,
    children,
  };
}

function sanitizeChatStdout(stdout: string) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith("╭─ ⚕ Hermes") && !line.startsWith("╰"));
  const sessionLine = lines.find((line) => line.startsWith("session_id:"));
  const sessionId = sessionLine?.split(":")[1]?.trim();
  const response = lines.filter((line) => !line.startsWith("session_id:")).join("\n").trim();
  return { sessionId, response };
}

export async function deleteSessionTree(sessionId: string): Promise<{ deletedIds: string[] }> {
  const code = String.raw`
import json, sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
rows = conn.execute("""
with recursive tree(id, depth) as (
  select id, 0 from sessions where id = ?
  union all
  select s.id, tree.depth + 1
  from sessions s
  join tree on s.parent_session_id = tree.id
)
select id, depth from tree order by depth desc
""", (sys.argv[2],)).fetchall()
ids = [str(row["id"]) for row in rows]
if not ids:
    print(json.dumps({"deletedIds": []}, ensure_ascii=False))
    raise SystemExit(0)
conn.executemany("delete from messages where session_id = ?", [(item,) for item in ids])
conn.executemany("delete from sessions where id = ?", [(item,) for item in ids])
conn.commit()
print(json.dumps({"deletedIds": ids}, ensure_ascii=False))
`;

  return runPythonJson<{ deletedIds: string[] }>(code, [getStateDbPath(), sessionId]);
}

export async function runChat(prompt: string, sessionId?: string): Promise<ChatRunResult> {
  const args = ["chat", "-Q", "-q", prompt, "--source", "dashboard"];
  if (sessionId) {
    args.push("--resume", sessionId);
  }

  const { stdout, stderr } = await execFileAsync("hermes", args, {
    maxBuffer: 1024 * 1024 * 20,
    timeout: 1000 * 60 * 5,
  });

  const parsed = sanitizeChatStdout(`${stdout}\n${stderr}`);
  if (!parsed.sessionId) {
    throw new Error("Hermes did not return a session_id");
  }

  const session = await getSession(parsed.sessionId);
  if (!session) {
    throw new Error(`Session ${parsed.sessionId} was created but could not be loaded`);
  }

  return {
    sessionId: parsed.sessionId,
    response: parsed.response,
    session,
  };
}
