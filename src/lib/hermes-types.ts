export type SessionStatus = "active" | "done";

export type SessionKind = "root" | "child" | "empty";

export type TraceViewMode = "chat" | "trace" | "raw";

export type SessionToolCall = {
  id: string;
  name: string;
  status: "planned" | "completed";
  arguments?: string;
};

export type SessionMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  author: string;
  timestamp: string;
  content: string;
  toolName?: string | null;
  toolCallId?: string | null;
  tokenCount?: number | null;
  reasoning: string[];
  toolCalls: SessionToolCall[];
  rawReasoning?: string | null;
  rawReasoningDetails?: string | null;
  rawToolCalls?: string | null;
};

export type SessionLink = {
  id: string;
  title: string;
  status: SessionStatus;
  kind: SessionKind;
  source: string;
  startedAt: string;
  summary: string;
};

export type SessionSummary = {
  id: string;
  title: string;
  status: SessionStatus;
  source: string;
  startedAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  toolCallCount: number;
  summary: string;
  parentSessionId: string | null;
  childSessionIds: string[];
  lineageIds: string[];
  kind: SessionKind;
  interactive: boolean;
  hasTranscript: boolean;
  toolHeavy: boolean;
  delegatedCandidate: boolean;
  userMessageCount: number;
  assistantMessageCount: number;
  toolMessageCount: number;
  systemMessageCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estimatedCost: number | null;
  actualCost: number | null;
  endReason: string | null;
};

export type SessionDetail = SessionSummary & {
  messages: SessionMessage[];
  lineage: SessionLink[];
  children: SessionLink[];
};

export type SkillItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  updatedAt: string;
  content: string;
  frontmatter: Record<string, string>;
};

export type MemoryScope = "user" | "memory";

export type MemoryItem = {
  id: string;
  scope: MemoryScope;
  index: number;
  title: string;
  content: string;
  updatedAt: string;
};

export type ChatRunResult = {
  sessionId: string;
  response: string;
  session: SessionDetail;
};
