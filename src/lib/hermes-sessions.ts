import type {
  SessionDetail,
  SessionKind,
  SessionLink,
  SessionMessage,
  SessionSummary,
  SessionToolCall,
} from "@/lib/hermes-types";
import { getDb } from "@/lib/db";

// ─── Internal row type (matches the SQL SELECT) ──────────────────────

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

// ─── Pure helper functions (unchanged) ────────────────────────────────

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

// ─── SQLite queries (replaced inline Python) ──────────────────────────

const LIST_SESSIONS_SQL = `
  SELECT
    s.id,
    s.title,
    s.source,
    s.model,
    s.parent_session_id,
    s.started_at,
    coalesce(s.ended_at, s.started_at) AS updated_at,
    s.ended_at,
    s.end_reason,
    s.message_count,
    s.tool_call_count,
    s.input_tokens,
    s.output_tokens,
    s.reasoning_tokens,
    s.estimated_cost_usd AS estimated_cost,
    s.actual_cost_usd AS actual_cost,
    (
      SELECT m.content
      FROM messages m
      WHERE m.session_id = s.id
        AND m.role IN ('assistant', 'user', 'tool')
        AND length(trim(coalesce(m.content, ''))) > 0
      ORDER BY m.id DESC
      LIMIT 1
    ) AS preview,
    coalesce(sum(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0)      AS user_msgs,
    coalesce(sum(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END), 0)  AS assistant_msgs,
    coalesce(sum(CASE WHEN m.role = 'tool' THEN 1 ELSE 0 END), 0)       AS tool_msgs,
    coalesce(sum(CASE WHEN m.role = 'system' THEN 1 ELSE 0 END), 0)     AS system_msgs,
    coalesce(sum(coalesce(m.token_count, 0)), 0)                         AS total_tokens
  FROM sessions s
  LEFT JOIN messages m ON m.session_id = s.id
  GROUP BY s.id
  ORDER BY s.started_at DESC
`;

const GET_SESSION_SQL = "SELECT * FROM sessions WHERE id = ?";
const GET_MESSAGES_SQL = "SELECT * FROM messages WHERE session_id = ? ORDER BY id";

const DELETE_TREE_SQL = `
  WITH RECURSIVE tree(id, depth) AS (
    SELECT id, 0 FROM sessions WHERE id = ?
    UNION ALL
    SELECT s.id, tree.depth + 1
    FROM sessions s
    JOIN tree ON s.parent_session_id = tree.id
  )
  SELECT id FROM tree ORDER BY depth DESC
`;

function fetchSessionRows(): SessionRow[] {
  return getDb().prepare(LIST_SESSIONS_SQL).all() as SessionRow[];
}

// ─── Normalization logic (unchanged) ──────────────────────────────────

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

// ─── Public API ───────────────────────────────────────────────────────

export async function listSessions(): Promise<SessionSummary[]> {
  const rows = fetchSessionRows();
  const { sessions } = normalizeSessionRows(rows);
  return sessions;
}

export async function getSession(sessionId: string): Promise<SessionDetail | null> {
  const db = getDb();

  const sessionRow = db.prepare(GET_SESSION_SQL).get(sessionId) as
    Record<string, string | number | null> | undefined;
  if (!sessionRow) return null;

  const messageRows = db.prepare(GET_MESSAGES_SQL).all(sessionId) as
    Array<Record<string, string | number | null>>;

  const allRows = fetchSessionRows();
  const { sessions, idsBySession } = normalizeSessionRows(allRows);
  const sessionBase = sessions.find((item) => item.id === sessionId);
  if (!sessionBase) return null;

  const messages: SessionMessage[] = messageRows.map((message) => ({
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

export async function deleteSessionTree(sessionId: string): Promise<{ deletedIds: string[] }> {
  const db = getDb();

  const findTree = db.prepare(DELETE_TREE_SQL);
  const deleteMessages = db.prepare("DELETE FROM messages WHERE session_id = ?");
  const deleteSessions = db.prepare("DELETE FROM sessions WHERE id = ?");

  // SELECT + DELETE inside a single transaction to avoid orphan window
  const runDelete = db.transaction((rootId: string) => {
    const rows = findTree.all(rootId) as Array<{ id: string }>;
    const ids = rows.map((r) => String(r.id));

    if (ids.length === 0) return { deletedIds: [] as string[] };

    for (const id of ids) {
      deleteMessages.run(id);
      deleteSessions.run(id);
    }

    return { deletedIds: ids };
  });

  return runDelete(sessionId);
}

