"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import {
  Bot,
  ChevronRight,
  Clock3,
  Database,
  FileCode2,
  FolderTree,
  LoaderCircle,
  MemoryStick,
  MessageSquare,
  Network,
  Plus,
  RefreshCw,
  Save,
  Search,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type {
  MemoryItem,
  MemoryScope,
  SessionDetail,
  SessionMessage,
  SessionSummary,
  SkillItem,
  TraceViewMode,
} from "@/lib/hermes-types";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "会话", icon: MessageSquare, description: "聊天工作台" },
  { href: "/skills", label: "技能", icon: FileCode2, description: "技能管理" },
  { href: "/memory", label: "记忆", icon: Database, description: "记忆管理" },
] as const;

const roleTone: Record<SessionMessage["role"], string> = {
  user: "border-sky-500/30 bg-sky-500/8",
  assistant: "border-violet-500/30 bg-violet-500/8",
  tool: "border-emerald-500/30 bg-emerald-500/8",
  system: "border-amber-500/30 bg-amber-500/8",
};

const viewModes: Array<{ id: TraceViewMode; label: string }> = [
  { id: "chat", label: "对话" },
  { id: "trace", label: "完整链路" },
  { id: "raw", label: "原始 JSON" },
];

type SessionFilter = "all" | "active" | "roots" | "children" | "interactive" | "agentic" | "empty";

async function getJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function formatUpdatedAt(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function formatCost(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `$${value.toFixed(4)}`;
}

function lineDiffPreview(original: string, draft: string) {
  const originalLines = original.split(/\r?\n/);
  const draftLines = draft.split(/\r?\n/);
  const maxLength = Math.max(originalLines.length, draftLines.length);
  const changes: string[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const before = originalLines[index];
    const after = draftLines[index];
    if (before === after) continue;
    if (before !== undefined) changes.push(`- ${before}`);
    if (after !== undefined) changes.push(`+ ${after}`);
    if (changes.length >= 80) break;
  }

  return changes.length ? changes.join("\n") : "暂无变更";
}

function sessionFilterMatch(session: SessionSummary, filter: SessionFilter) {
  switch (filter) {
    case "active":
      return session.status === "active";
    case "roots":
      return session.kind === "root";
    case "children":
      return session.kind === "child";
    case "interactive":
      return session.interactive;
    case "agentic":
      return session.toolHeavy;
    case "empty":
      return session.kind === "empty";
    default:
      return true;
  }
}

function SectionLabel({ icon: Icon, title, description }: { icon: typeof Sparkles; title: string; description: string }) {
  const hasDescription = description.trim().length > 0;

  return (
    <div className={cn("space-y-1.5", !hasDescription && "space-y-0")}>
      <div className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight">
        <span className="flex size-8 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/15">
          <Icon className="size-4 text-violet-500" />
        </span>
        {title}
      </div>
      {hasDescription ? <p className="max-w-xl text-sm leading-5 text-muted-foreground/95">{description}</p> : null}
    </div>
  );
}

function getSessionSourceMark(source: string) {
  const value = source.trim().toLowerCase();
  if (value.includes("weixin") || value.includes("wechat")) return { label: "微", tone: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/15" };
  if (value.includes("telegram")) return { label: "TG", tone: "bg-sky-500/12 text-sky-700 ring-sky-500/15" };
  if (value.includes("discord")) return { label: "DC", tone: "bg-indigo-500/12 text-indigo-700 ring-indigo-500/15" };
  if (value.includes("slack")) return { label: "SL", tone: "bg-fuchsia-500/12 text-fuchsia-700 ring-fuchsia-500/15" };
  if (value.includes("whatsapp")) return { label: "WA", tone: "bg-green-500/12 text-green-700 ring-green-500/15" };
  if (value.includes("signal")) return { label: "SI", tone: "bg-cyan-500/12 text-cyan-700 ring-cyan-500/15" };
  if (value.includes("imessage") || value.includes("sms")) return { label: "信", tone: "bg-blue-500/12 text-blue-700 ring-blue-500/15" };
  if (value.includes("feishu")) return { label: "飞", tone: "bg-sky-500/12 text-sky-700 ring-sky-500/15" };
  if (value.includes("wecom") || value.includes("work") || value.includes("qywx")) return { label: "企", tone: "bg-teal-500/12 text-teal-700 ring-teal-500/15" };
  if (value.includes("dingtalk") || value.includes("ding")) return { label: "钉", tone: "bg-orange-500/12 text-orange-700 ring-orange-500/15" };
  return null;
}

function EmptyState({ icon: Icon, title, description }: { icon: typeof Sparkles; title: string; description: string }) {
  return (
    <div className="flex min-h-[150px] flex-col items-center justify-center rounded-[24px] border border-dashed border-border/70 bg-muted/20 px-6 py-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-background shadow-sm ring-1 ring-border/60">
        <Icon className="size-4.5 text-violet-500" />
      </div>
      <div className="mt-3 text-[15px] font-semibold tracking-tight text-foreground">{title}</div>
      <p className="mt-1.5 max-w-md text-sm leading-5 text-muted-foreground/95">{description}</p>
    </div>
  );
}

function FloatingNotice({ kind, message, onClose }: { kind: "success" | "error"; message: string; onClose: () => void }) {
  return (
    <div className="fixed top-4 right-4 z-[70] max-w-[420px] animate-in fade-in slide-in-from-top-2">
      <div
        className={cn(
          "flex items-start gap-3 border px-3.5 py-3 shadow-lg backdrop-blur-xl",
          kind === "success"
            ? "border-emerald-500/20 bg-white/95 text-emerald-700 ring-1 ring-emerald-500/10"
            : "border-destructive/20 bg-white/95 text-destructive ring-1 ring-destructive/10"
        )}
      >
        <div className="min-w-0 flex-1 text-sm leading-5">{message}</div>
        <button type="button" onClick={onClose} className="shrink-0 p-0.5 text-current/70 transition hover:text-current" aria-label="关闭提示">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(120,119,198,0.12),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.08),_transparent_22%),linear-gradient(180deg,_#fcfcff,_#f5f7fb)] text-foreground">
      <div className="mx-auto max-w-[1760px] px-6 py-4 lg:px-10 lg:py-4.5">
        <header className="mb-3 rounded-[28px] border border-white/70 bg-white/75 px-4 py-3 shadow-[0_8px_40px_rgba(15,23,42,0.05)] ring-1 ring-slate-200/60 backdrop-blur-xl lg:px-5 lg:py-3">
          <div className="flex flex-row gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
                <span className="flex size-7 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/15">
                  <Sparkles className="size-3.5 text-violet-500" />
                </span>
                <span>Hermes Dashboard</span>
              </div>
            </div>

            <nav className="flex flex-wrap gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border text-sm transition-all duration-150",
                      "px-3 py-2",
                      active
                        ? "border-violet-500/25 bg-violet-500/12 text-foreground shadow-sm ring-1 ring-violet-500/10"
                        : "border-border/60 bg-white/70 text-muted-foreground hover:border-violet-300/30 hover:bg-white hover:text-foreground"
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span className="font-medium tracking-tight">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);

  async function copyCode(raw: string) {
    try {
      await navigator.clipboard.writeText(raw);
      setCopiedBlock(raw);
      window.setTimeout(() => setCopiedBlock((current) => (current === raw ? null : current)), 1400);
    } catch {
      setCopiedBlock(null);
    }
  }

  return (
    <div className="chat-markdown mt-3 text-sm leading-6 text-foreground/95">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ className, ...props }) => <h1 className={cn("mt-5 mb-2 text-[1.4rem] font-semibold tracking-tight text-foreground", className)} {...props} />,
          h2: ({ className, ...props }) => <h2 className={cn("mt-4 mb-2 text-[1.18rem] font-semibold tracking-tight text-foreground", className)} {...props} />,
          h3: ({ className, ...props }) => <h3 className={cn("mt-3 mb-1.5 text-[1.04rem] font-semibold tracking-tight text-foreground", className)} {...props} />,
          a: ({ className, ...props }) => <a className={cn("font-medium text-violet-700 underline underline-offset-4 hover:text-violet-900", className)} target="_blank" rel="noreferrer" {...props} />,
          p: ({ className, ...props }) => <p className={cn("my-0", className)} {...props} />,
          ul: ({ className, ...props }) => <ul className={cn("my-2 list-disc pl-5", className)} {...props} />,
          ol: ({ className, ...props }) => <ol className={cn("my-2 list-decimal pl-5", className)} {...props} />,
          li: ({ className, ...props }) => <li className={cn("my-1 marker:text-muted-foreground", className)} {...props} />,
          input: ({ className, type, checked, ...props }) =>
            type === "checkbox" ? (
              <input className={cn("mr-2 size-3.5 rounded-sm border-border/70 accent-violet-600", className)} type="checkbox" checked={checked} readOnly {...props} />
            ) : (
              <input className={className} type={type} checked={checked} {...props} />
            ),
          blockquote: ({ className, ...props }) => <blockquote className={cn("my-3 border-l-[3px] border-violet-400/70 bg-violet-500/5 px-3 py-2 text-foreground/85", className)} {...props} />,
          table: ({ className, ...props }) => <div className="my-3 overflow-x-auto rounded-xl border border-border/70"><table className={cn("min-w-full border-collapse text-xs", className)} {...props} /></div>,
          thead: ({ className, ...props }) => <thead className={cn("bg-muted/55", className)} {...props} />,
          tr: ({ className, ...props }) => <tr className={cn("transition-colors hover:bg-muted/30", className)} {...props} />,
          th: ({ className, ...props }) => <th className={cn("border-b border-border/70 px-3 py-2 text-left font-semibold", className)} {...props} />,
          td: ({ className, ...props }) => <td className={cn("border-t border-border/50 px-3 py-2 align-top", className)} {...props} />,
          hr: ({ className, ...props }) => <hr className={cn("my-4 border-border/70", className)} {...props} />,
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const raw = String(children).replace(/\n$/, "");
            if (match) {
              return (
                <div className="group/code my-3 overflow-hidden rounded-xl border border-slate-800/70 bg-slate-950 shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/80 px-3 py-1.5">
                    <div className="text-[11px] font-medium tracking-wide text-slate-300">{match[1]}</div>
                    <button
                      type="button"
                      onClick={() => void copyCode(raw)}
                      className="rounded-md border border-slate-700/80 px-2 py-0.5 text-[10px] font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white"
                    >
                      {copiedBlock === raw ? "已复制" : "复制"}
                    </button>
                  </div>
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{ margin: 0, padding: '14px 16px', background: 'transparent', fontSize: '12px', lineHeight: '1.6' }}
                    codeTagProps={{ style: { fontFamily: 'var(--font-geist-mono)' } }}
                  >
                    {raw}
                  </SyntaxHighlighter>
                </div>
              );
            }
            return (
              <code className="rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[0.9em]" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MessageCard({ message }: { message: SessionMessage }) {
  const hasReasoning = message.reasoning.length > 0;
  const hasToolCalls = message.toolCalls.length > 0;
  const hasRaw = Boolean(message.rawReasoning || message.rawReasoningDetails || message.rawToolCalls);

  return (
    <article className={cn("rounded-[20px] border px-4 py-3.5 shadow-sm", roleTone[message.role])}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="rounded-full capitalize">
          {message.role}
        </Badge>
        <span>{message.author}</span>
        <span>{message.timestamp}</span>
        {message.toolName ? <span>工具: {message.toolName}</span> : null}
        {message.tokenCount ? <span>{message.tokenCount} tokens</span> : null}
      </div>

      {message.content.trim() ? <MarkdownMessage content={message.content} /> : <div className="mt-3 text-sm text-muted-foreground">（空内容）</div>}

      {hasReasoning ? (
        <details className="mt-3 rounded-xl border border-border/70 bg-background/80 p-3">
          <summary className="cursor-pointer text-sm font-medium">推理摘要</summary>
          <ul className="mt-2.5 space-y-1.5 text-sm text-muted-foreground">
            {message.reasoning.map((item, index) => (
              <li key={`${message.id}-reasoning-${index}`} className="rounded-lg bg-muted/60 px-3 py-1.5">
                {item}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {hasToolCalls ? (
        <details className="mt-3 rounded-xl border border-border/70 bg-background/80 p-3">
          <summary className="cursor-pointer text-sm font-medium">计划中的工具调用（{message.toolCalls.length}）</summary>
          <div className="mt-2.5 space-y-2.5">
            {message.toolCalls.map((tool) => (
              <div key={tool.id} className="rounded-xl border border-border/70 bg-muted/40 p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{tool.name}</div>
                  <Badge variant="secondary" className="rounded-full">
                    {tool.status}
                  </Badge>
                </div>
                {tool.arguments ? (
                  <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-background p-2.5 text-xs leading-5">
                    {tool.arguments}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {hasRaw ? (
        <details className="mt-4 rounded-xl border border-dashed border-border/70 bg-background/80 p-3">
          <summary className="cursor-pointer text-sm font-medium">原始推理 / 工具载荷</summary>
          <div className="mt-2.5 space-y-2.5">
            {message.rawReasoning ? (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-xs leading-5">
                {message.rawReasoning}
              </pre>
            ) : null}
            {message.rawReasoningDetails ? (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-xs leading-5">
                {message.rawReasoningDetails}
              </pre>
            ) : null}
            {message.rawToolCalls ? (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-xs leading-5">
                {message.rawToolCalls}
              </pre>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

export function HermesSessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionFilter] = useState<SessionFilter>("all");
  const [sessionSourceFilter] = useState<string>("all");
  const [traceViewMode, setTraceViewMode] = useState<TraceViewMode>("chat");
  const [composerText, setComposerText] = useState("");
  const [expandedSessionIds, setExpandedSessionIds] = useState<string[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false);
  const [sendingChat, setSendingChat] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [confirmingDeleteSessionId, setConfirmingDeleteSessionId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const latestMessageAnchorRef = useRef<HTMLDivElement | null>(null);

  const loadSessions = useCallback(async (preferredSessionId?: string) => {
    setLoadingSessions(true);
    try {
      const data = await getJson<{ sessions: SessionSummary[] }>("/api/sessions");
      setSessions(data.sessions);
      setSelectedSessionId((current) => {
        const nextId = preferredSessionId ?? current;
        if (nextId && data.sessions.some((session) => session.id === nextId)) return nextId;
        return data.sessions[0]?.id ?? "";
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load sessions");
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    setLoadingSessionDetail(true);
    try {
      const data = await getJson<{ session: SessionDetail }>(`/api/sessions/${sessionId}`);
      setSessionDetail(data.session);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load session detail");
    } finally {
      setLoadingSessionDetail(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (selectedSessionId) void loadSessionDetail(selectedSessionId);
    else setSessionDetail(null);
  }, [loadSessionDetail, selectedSessionId]);

  const filteredSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase();
    return sessions.filter((session) => {
      const matchesQuery =
        !query || [session.title, session.summary, session.model, session.source, session.id].join(" ").toLowerCase().includes(query);
      const matchesFilter = sessionFilterMatch(session, sessionFilter);
      const matchesSource = sessionSourceFilter === "all" || session.source === sessionSourceFilter;
      return matchesQuery && matchesFilter && matchesSource;
    });
  }, [sessionFilter, sessionQuery, sessionSourceFilter, sessions]);

  const sessionsById = useMemo(() => new Map(filteredSessions.map((session) => [session.id, session])), [filteredSessions]);

  const rootSessions = useMemo(() => {
    return filteredSessions.filter((session) => !session.parentSessionId || !sessionsById.has(session.parentSessionId));
  }, [filteredSessions, sessionsById]);

  const treeChildrenByParent = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const session of filteredSessions) {
      if (!session.parentSessionId || !sessionsById.has(session.parentSessionId)) continue;
      const current = map.get(session.parentSessionId) ?? [];
      current.push(session);
      map.set(session.parentSessionId, current);
    }
    for (const children of map.values()) {
      children.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return map;
  }, [filteredSessions, sessionsById]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const selected = sessions.find((session) => session.id === selectedSessionId);
    if (!selected?.lineageIds?.length) return;
    setExpandedSessionIds((current) => {
      const next = new Set(current);
      for (const id of selected.lineageIds) next.add(id);
      return Array.from(next);
    });
  }, [selectedSessionId, sessions]);

  const traceMessages = useMemo(() => {
    if (!sessionDetail) return [];
    if (traceViewMode === "trace") return sessionDetail.messages;
    if (traceViewMode === "chat") return sessionDetail.messages.filter((m) => m.role === "user" || m.role === "assistant");
    return [];
  }, [sessionDetail, traceViewMode]);

  const activeSessionId = sessionDetail?.id ?? "";

  useEffect(() => {
    if (!activeSessionId || traceViewMode === "raw") return;
    const timer = window.setTimeout(() => {
      latestMessageAnchorRef.current?.scrollIntoView({ block: "end" });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, traceMessages.length, traceViewMode]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(""), 2400);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    if (!errorMessage) return;
    const timer = window.setTimeout(() => setErrorMessage(""), 4200);
    return () => window.clearTimeout(timer);
  }, [errorMessage]);

  async function deleteSession(sessionId: string) {
    setDeletingSessionId(sessionId);
    setErrorMessage("");
    try {
      const result = await getJson<{ deletedIds: string[] }>(`/api/sessions/${sessionId}`, { method: "DELETE" });
      setConfirmingDeleteSessionId(null);
      if (result.deletedIds.includes(selectedSessionId)) {
        setSelectedSessionId("");
        setSessionDetail(null);
      }
      await loadSessions();
      setStatusMessage(result.deletedIds.length > 1 ? `已删除会话分支（${result.deletedIds.length} 条）。` : "会话已删除。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete session");
    } finally {
      setDeletingSessionId(null);
    }
  }

  function startNewDraft() {
    setSelectedSessionId("");
    setSessionDetail(null);
    setTraceViewMode("chat");
    setComposerText("");
    setErrorMessage("");
    setStatusMessage("已进入新会话草稿。输入消息后点击发送即可创建。");
  }

  async function submitChat(mode: "new" | "reply") {
    const prompt = composerText.trim();
    if (!prompt) {
      if (mode === "new") {
        startNewDraft();
      }
      return;
    }

    setSendingChat(true);
    setErrorMessage("");
    setStatusMessage(mode === "new" ? "正在创建新会话..." : "正在继续当前会话...");

    try {
      const payload = { prompt, sessionId: mode === "reply" ? selectedSessionId : undefined };
      const result = await getJson<{ sessionId: string; response: string; session: SessionDetail }>("/api/chat", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setComposerText("");
      setSelectedSessionId(result.sessionId);
      setSessionDetail(result.session);
      await loadSessions(result.sessionId);
      setStatusMessage(mode === "new" ? "新会话已创建。" : "当前会话已继续。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "运行对话失败");
      setStatusMessage("");
    } finally {
      setSendingChat(false);
    }
  }

  return (
    <DashboardShell>
      {statusMessage ? <FloatingNotice kind="success" message={statusMessage} onClose={() => setStatusMessage("")} /> : null}
      {errorMessage ? <FloatingNotice kind="error" message={errorMessage} onClose={() => setErrorMessage("")} /> : null}

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
        <Card className="border-white/70 bg-white/85 xl:sticky xl:top-6 xl:h-[calc(100vh-8rem)]">
          <CardHeader className="flex items-start justify-between gap-2 pb-2">
            <SectionLabel icon={FolderTree} title="会话列表" description="" />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => void loadSessions(selectedSessionId || undefined)} disabled={loadingSessions}>
                {loadingSessions ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}刷新
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => void submitChat("new")}
                disabled={sendingChat}
              >
                {sendingChat ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}新建
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={sessionQuery} onChange={(e) => setSessionQuery(e.target.value)} className="h-8 pl-8 text-sm" placeholder="搜索会话..." />
            </div>


            <ScrollArea className="min-h-0 flex-1 pr-3">
              <div className="space-y-3">
                {loadingSessions ? (
                  <EmptyState icon={LoaderCircle} title="正在加载会话" description="正在读取本地 Hermes session 索引与摘要。" />
                ) : filteredSessions.length === 0 ? (
                  <EmptyState icon={Search} title="没有匹配的会话" description="当前筛选条件下没有命中结果，试试放宽搜索词或切换过滤器。" />
                ) : (
                  rootSessions.map((session) => {
                    const children = treeChildrenByParent.get(session.id) ?? [];
                    const expanded = expandedSessionIds.includes(session.id) || children.some((child) => child.id === selectedSessionId);
                    const rootDeleting = deletingSessionId === session.id;
                    const rootConfirming = confirmingDeleteSessionId === session.id;
                    const rootSourceMark = getSessionSourceMark(session.source);
                    return (
                      <div key={session.id} className="group/session space-y-1.5">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedSessionId(session.id);
                            if (children.length) {
                              setExpandedSessionIds((current) =>
                                current.includes(session.id) ? current : [...current, session.id]
                              );
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedSessionId(session.id);
                              if (children.length) {
                                setExpandedSessionIds((current) =>
                                  current.includes(session.id) ? current : [...current, session.id]
                                );
                              }
                            }
                          }}
                          className={cn(
                            "w-full overflow-hidden border px-1.5 py-1.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30",
                            selectedSessionId === session.id
                              ? "border-violet-500/30 bg-violet-500/10 shadow-sm ring-1 ring-violet-500/10"
                              : "border-border/60 bg-white/90 hover:border-violet-400/25 hover:bg-muted/20"
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            {children.length ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setExpandedSessionIds((current) =>
                                    current.includes(session.id)
                                      ? current.filter((id) => id !== session.id)
                                      : [...current, session.id]
                                  );
                                }}
                                className="rounded-sm p-0.5 text-muted-foreground/80 hover:bg-muted"
                                aria-label={expanded ? "折叠子会话" : "展开子会话"}
                              >
                                <ChevronRight className={cn("size-3 transition-transform", expanded ? "rotate-90" : "rotate-0")} />
                              </button>
                            ) : (
                              <span className="block w-3 shrink-0" />
                            )}
                            {rootSourceMark ? (
                              <span className={cn("inline-flex h-4 min-w-4 shrink-0 items-center justify-center border text-[9px] font-semibold leading-none ring-1", rootSourceMark.tone)}>
                                {rootSourceMark.label}
                              </span>
                            ) : null}
                            <div className="min-w-0 flex-1 truncate pr-2 text-[12px] font-semibold tracking-tight text-foreground/95">{session.title}</div>
                            <div className="flex shrink-0 items-center gap-1">
                              {!rootConfirming ? (
                                <>
                                  <div className="text-[10px] text-muted-foreground/70">{session.updatedAt}</div>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setConfirmingDeleteSessionId(session.id);
                                    }}
                                    className="pointer-events-none p-0.5 text-muted-foreground/70 opacity-0 transition group-hover/session:pointer-events-auto group-hover/session:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                                    aria-label="删除会话"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void deleteSession(session.id);
                                    }}
                                    disabled={rootDeleting}
                                    className="border border-destructive/25 bg-destructive/8 px-1.5 py-0.5 text-[10px] text-destructive transition hover:bg-destructive/12 disabled:opacity-60"
                                  >
                                    {rootDeleting ? "删除中" : "确认删除"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setConfirmingDeleteSessionId(null);
                                    }}
                                    className="p-0.5 text-muted-foreground/70 transition hover:bg-muted"
                                    aria-label="取消删除"
                                  >
                                    <X className="size-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {expanded && children.length ? (
                          <div className="relative ml-5 space-y-1.5 border-l border-border/60 pl-3.5">
                            {children.map((child) => {
                              const childDeleting = deletingSessionId === child.id;
                              const childConfirming = confirmingDeleteSessionId === child.id;
                              const childSourceMark = getSessionSourceMark(child.source);
                              return (
                                <div key={child.id} className="group/child relative">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedSessionId(child.id)}
                                    className={cn(
                                      "relative w-full overflow-hidden border px-1.5 py-1 text-left transition-all duration-150 before:absolute before:-left-[14px] before:top-1/2 before:h-px before:w-3 before:-translate-y-1/2 before:bg-border/70 before:content-['']",
                                      selectedSessionId === child.id
                                        ? "border-sky-500/25 bg-sky-500/10 shadow-sm ring-1 ring-sky-500/10"
                                        : "border-border/45 bg-muted/20 text-foreground/82 hover:border-sky-400/20 hover:bg-muted/35"
                                    )}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-2">
                                        {childSourceMark ? (
                                          <span className={cn("inline-flex h-4 min-w-4 shrink-0 items-center justify-center border text-[9px] font-semibold leading-none ring-1", childSourceMark.tone)}>
                                            {childSourceMark.label}
                                          </span>
                                        ) : null}
                                        <div className="min-w-0 flex-1 truncate text-[11px] font-normal">{child.title}</div>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-1">
                                        {!childConfirming ? (
                                          <>
                                            <div className="text-[10px] text-muted-foreground/60">{child.updatedAt}</div>
                                            <span className="pointer-events-none p-0.5 text-muted-foreground/70 opacity-0 transition group-hover/child:opacity-100">
                                              <Trash2 className="size-3.5" />
                                            </span>
                                          </>
                                        ) : null}
                                      </div>
                                    </div>
                                  </button>
                                  {!childConfirming ? (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setConfirmingDeleteSessionId(child.id);
                                      }}
                                      className="absolute top-1/2 right-1 -translate-y-1/2 p-0.5 text-muted-foreground/70 opacity-0 transition group-hover/child:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                                      aria-label="删除会话"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  ) : (
                                    <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-1 bg-white/95 px-1 py-0.5 shadow-sm ring-1 ring-border/60">
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void deleteSession(child.id);
                                        }}
                                        disabled={childDeleting}
                                        className="border border-destructive/25 bg-destructive/8 px-1.5 py-0.5 text-[10px] text-destructive transition hover:bg-destructive/12 disabled:opacity-60"
                                      >
                                        {childDeleting ? "删除中" : "确认"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setConfirmingDeleteSessionId(null);
                                        }}
                                        className="p-0.5 text-muted-foreground/70 transition hover:bg-muted"
                                        aria-label="取消删除"
                                      >
                                        <X className="size-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-3 xl:h-[calc(100vh-8rem)]">
          <Card className="border-white/70 bg-white/85 xl:min-h-0 xl:flex-1">
            <CardHeader className="gap-1 border-b pb-1.5">
              <div className="grid min-w-0 gap-0.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-2">
                <div className="min-w-0 overflow-hidden">
                  <CardTitle className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[15px] leading-5">{sessionDetail?.title ?? "未选择会话"}</CardTitle>
                  <CardDescription className="mt-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4">
                    <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{sessionDetail?.startedAt ?? "-"}</span>
                    <span className="inline-flex items-center gap-1"><Bot className="size-3" />{sessionDetail?.model ?? "-"}</span>
                    <span className="inline-flex items-center gap-1"><Network className="size-3" />{sessionDetail?.source ?? "-"}</span>
                  </CardDescription>
                </div>

                <div className="flex flex-wrap gap-1.5 lg:justify-end">
                  {viewModes.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setTraceViewMode(mode.id)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                        traceViewMode === mode.id ? "border-violet-500/30 bg-violet-500/10" : "border-border/70 bg-muted/40 hover:bg-background"
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col pt-1.5">
              {loadingSessionDetail ? (
                  <EmptyState icon={LoaderCircle} title="正在加载会话详情" description="正在整理对话内容、会话链路与元信息。" />
              ) : !sessionDetail ? (
                <EmptyState icon={MessageSquare} title="请选择一个会话" description="从左侧挑选一个会话，即可在这里查看对话内容、链路与上下文。" />
              ) : traceViewMode === "raw" ? (
                <ScrollArea className="min-h-0 flex-1 pr-3">
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-border/70 bg-muted/30 p-4 text-xs leading-5">
                    {JSON.stringify(sessionDetail, null, 2)}
                  </pre>
                </ScrollArea>
              ) : (
                <ScrollArea className="min-h-0 flex-1 pr-3">
                  <div className="space-y-3">
                    {traceMessages.map((message) => (
                      <MessageCard key={message.id} message={message} />
                    ))}
                    <div ref={latestMessageAnchorRef} />
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/70 bg-white/85 py-0">
            <CardContent className="grid gap-2 py-[5px]">
              {sessionDetail ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>消息 {sessionDetail.messageCount}</span>
                  <span>工具 {sessionDetail.toolCallCount}</span>
                  <span>输入 {sessionDetail.inputTokens}</span>
                  <span>输出 {sessionDetail.outputTokens}</span>
                  <span>reasoning {sessionDetail.reasoningTokens}</span>
                  <span>预估成本 {formatCost(sessionDetail.estimatedCost)}</span>
                </div>
              ) : null}
              <div className="grid gap-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <Textarea value={composerText} onChange={(e) => setComposerText(e.target.value)} placeholder="输入消息…" className="min-h-20 rounded-[22px] bg-white/70 text-sm leading-5" />
                <Button className="h-11 rounded-2xl px-4" onClick={() => void submitChat(selectedSessionId ? "reply" : "new")} disabled={sendingChat || !composerText.trim()}>
                  {sendingChat ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                  发送
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}

export function HermesSkillsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [skillQuery, setSkillQuery] = useState("");
  const [skillDrafts, setSkillDrafts] = useState<Record<string, string>>({});
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadSkills = useCallback(async () => {
    setLoadingSkills(true);
    try {
      const data = await getJson<{ skills: SkillItem[] }>("/api/skills");
      setSkills(data.skills);
      setSelectedSkillId((current) => current || data.skills[0]?.id || "");
      setSkillDrafts((current) => ({ ...Object.fromEntries(data.skills.map((skill) => [skill.id, skill.content])), ...current }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load skills");
    } finally {
      setLoadingSkills(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(""), 2400);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    if (!errorMessage) return;
    const timer = window.setTimeout(() => setErrorMessage(""), 4200);
    return () => window.clearTimeout(timer);
  }, [errorMessage]);

  const filteredSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    return skills.filter((skill) => !query || [skill.name, skill.category, skill.description, skill.id].join(" ").toLowerCase().includes(query));
  }, [skillQuery, skills]);

  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) ?? filteredSkills[0] ?? skills[0] ?? null;

  async function saveSkill(skill: SkillItem) {
    setSavingSkillId(skill.id);
    setErrorMessage("");
    try {
      const result = await getJson<{ skill: SkillItem }>(`/api/skills/${skill.id}`, {
        method: "PUT",
        body: JSON.stringify({ content: skillDrafts[skill.id] ?? skill.content }),
      });
      setSkills((current) => current.map((item) => (item.id === skill.id ? result.skill : item)));
      setSkillDrafts((current) => ({ ...current, [skill.id]: result.skill.content }));
      setStatusMessage(`Skill ${result.skill.name} 已保存。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save skill");
    } finally {
      setSavingSkillId(null);
    }
  }

  return (
    <DashboardShell>
      {statusMessage ? <FloatingNotice kind="success" message={statusMessage} onClose={() => setStatusMessage("")} /> : null}
      {errorMessage ? <FloatingNotice kind="error" message={errorMessage} onClose={() => setErrorMessage("")} /> : null}

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start">
        <Card className="border-white/70 bg-white/85 xl:sticky xl:top-6 xl:h-[calc(100vh-8rem)]">
          <CardHeader className="flex items-start justify-between gap-2 pb-2">
            <SectionLabel icon={FileCode2} title="技能列表" description="" />
            <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => void loadSkills()}>
              <RefreshCw className="size-4" />刷新
            </Button>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={skillQuery} onChange={(e) => setSkillQuery(e.target.value)} className="h-8 pl-8 text-sm" placeholder="搜索技能..." />
            </div>
            <ScrollArea className="min-h-0 flex-1 pr-3">
              <div className="space-y-2.5">
                {loadingSkills ? (
                  <EmptyState icon={LoaderCircle} title="正在加载技能" description="正在扫描 ~/.hermes/skills 目录并读取技能文件。" />
                ) : filteredSkills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => setSelectedSkillId(skill.id)}
                    className={cn(
                      "w-full rounded-[20px] border px-3.5 py-3 text-left transition-all duration-150",
                      selectedSkill?.id === skill.id ? "border-violet-500/25 bg-violet-500/10 shadow-sm ring-1 ring-violet-500/10" : "border-border/60 bg-white/80 hover:border-violet-400/25 hover:bg-muted/30"
                    )}
                  >
                    <div className="font-medium leading-5">{skill.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{skill.description}</div>
                    <div className="mt-2.5 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary" className="rounded-full">{skill.category}</Badge>
                    </div>
                    <div className="mt-2 truncate text-[11px] text-muted-foreground">{skill.id}</div>
                    <div className="mt-1.5 text-[11px] text-muted-foreground">更新于 {formatUpdatedAt(skill.updatedAt)}</div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-white/70 bg-white/85 xl:h-[calc(100vh-8rem)] xl:overflow-hidden">
          <CardHeader className="gap-2.5 border-b pb-3">
            {selectedSkill ? (
              <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                <div className="min-w-0">
                  <CardTitle className="text-[15px] leading-5">{selectedSkill.name}</CardTitle>
                  <CardDescription className="mt-0.5 max-w-3xl break-words text-sm leading-5">{selectedSkill.description}</CardDescription>
                </div>
                <div className="justify-self-start xl:justify-self-end">
                  <Button onClick={() => void saveSkill(selectedSkill)} disabled={savingSkillId === selectedSkill.id}>
                    {savingSkillId === selectedSkill.id ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存
                  </Button>
                </div>
              </div>
            ) : (
              <CardTitle>未选择技能</CardTitle>
            )}
          </CardHeader>
          <CardContent className="grid min-h-0 flex-1 gap-3.5 pt-3 xl:grid-cols-[minmax(0,1fr)_300px]">
            {selectedSkill ? (
              <>
                <div className="min-w-0 min-h-0">
                  <Textarea
                    value={skillDrafts[selectedSkill.id] ?? selectedSkill.content}
                    onChange={(e) => setSkillDrafts((current) => ({ ...current, [selectedSkill.id]: e.target.value }))}
                    className="h-[calc(100vh-14rem)] min-h-0 resize-none overflow-y-auto rounded-[24px] bg-white/70 pb-16 font-mono text-xs leading-6"
                  />
                </div>
                <div className="min-w-0 min-h-0 space-y-2.5 overflow-hidden">
                  <div className="rounded-2xl border border-border/70 p-3">
                    <div className="mb-1.5 font-medium">差异预览</div>
                    <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-3 text-xs leading-5">
                      {lineDiffPreview(selectedSkill.content, skillDrafts[selectedSkill.id] ?? selectedSkill.content)}
                    </pre>
                  </div>
                  <div className="rounded-2xl border border-border/70 p-3 text-sm text-muted-foreground">
                    <div className="mb-1.5 font-medium text-foreground">编辑说明</div>
                    <ul className="space-y-1">
                      <li>直接保存回 skill 目录下的 SKILL.md。</li>
                      <li>文件头摘要直接来自文件本身，不做额外推断。</li>
                      <li>这个页面专门给 skills，用更宽松的编辑区域。</li>
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState icon={FileCode2} title="请选择一个技能" description="从左侧选择一个技能开始编辑，右侧会显示完整内容、文件头摘要和差异预览。" />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

export function HermesMemoryPage() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [selectedMemoryId, setSelectedMemoryId] = useState("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [newMemoryScope, setNewMemoryScope] = useState<MemoryScope>("memory");
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [isCreateMemoryOpen, setIsCreateMemoryOpen] = useState(false);
  const [loadingMemories, setLoadingMemories] = useState(true);
  const [savingMemoryId, setSavingMemoryId] = useState<string | null>(null);
  const [creatingMemory, setCreatingMemory] = useState(false);
  const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadMemories = useCallback(async () => {
    setLoadingMemories(true);
    try {
      const data = await getJson<{ memories: MemoryItem[] }>("/api/memory");
      setMemories(data.memories);
      setSelectedMemoryId((current) => current || data.memories[0]?.id || "");
      setMemoryDrafts((current) => ({ ...Object.fromEntries(data.memories.map((item) => [item.id, item.content])), ...current }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load memories");
    } finally {
      setLoadingMemories(false);
    }
  }, []);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(""), 2400);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    if (!errorMessage) return;
    const timer = window.setTimeout(() => setErrorMessage(""), 4200);
    return () => window.clearTimeout(timer);
  }, [errorMessage]);

  const filteredMemories = useMemo(() => {
    const query = memoryQuery.trim().toLowerCase();
    return memories.filter((item) => !query || [item.title, item.content, item.scope].join(" ").toLowerCase().includes(query));
  }, [memories, memoryQuery]);

  const selectedMemory = memories.find((item) => item.id === selectedMemoryId) ?? filteredMemories[0] ?? memories[0] ?? null;

  async function saveMemory(item: MemoryItem) {
    setSavingMemoryId(item.id);
    setErrorMessage("");
    try {
      const result = await getJson<{ item: MemoryItem }>(`/api/memory/${item.scope}/${item.index}`, {
        method: "PUT",
        body: JSON.stringify({ content: memoryDrafts[item.id] ?? item.content }),
      });
      setMemories((current) => current.map((entry) => (entry.id === item.id ? result.item : entry)));
      setMemoryDrafts((current) => ({ ...current, [item.id]: result.item.content }));
      setStatusMessage(`Memory ${result.item.title} 已保存。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save memory");
    } finally {
      setSavingMemoryId(null);
    }
  }

  async function createMemoryEntry() {
    const content = newMemoryContent.trim();
    if (!content) return;
    setCreatingMemory(true);
    setErrorMessage("");
    try {
      const result = await getJson<{ item: MemoryItem }>("/api/memory", {
        method: "POST",
        body: JSON.stringify({ scope: newMemoryScope, content }),
      });
      setSelectedMemoryId(result.item.id);
      setNewMemoryContent("");
      setIsCreateMemoryOpen(false);
      setStatusMessage(`Memory ${result.item.title} 已新增。`);
      await loadMemories();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create memory");
    } finally {
      setCreatingMemory(false);
    }
  }

  async function removeMemory(item: MemoryItem) {
    setDeletingMemoryId(item.id);
    setErrorMessage("");
    try {
      await getJson<{ ok: boolean }>(`/api/memory/${item.scope}/${item.index}`, { method: "DELETE" });
      setStatusMessage(`Memory ${item.title} 已删除。`);
      await loadMemories();
      setSelectedMemoryId((current) => (current === item.id ? "" : current));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete memory");
    } finally {
      setDeletingMemoryId(null);
    }
  }

  return (
    <DashboardShell>
      {statusMessage ? <FloatingNotice kind="success" message={statusMessage} onClose={() => setStatusMessage("")} /> : null}
      {errorMessage ? <FloatingNotice kind="error" message={errorMessage} onClose={() => setErrorMessage("")} /> : null}

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start">
        <Card className="border-white/70 bg-white/85 xl:sticky xl:top-6 xl:h-[calc(100vh-8rem)]">
          <CardHeader className="flex items-start justify-between gap-2 pb-2">
            <SectionLabel icon={MemoryStick} title="记忆列表" description="" />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setIsCreateMemoryOpen(true)}>
                <Plus className="size-4" />新增
              </Button>
              <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => void loadMemories()}>
                <RefreshCw className="size-4" />刷新
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={memoryQuery} onChange={(e) => setMemoryQuery(e.target.value)} className="h-8 pl-8 text-sm" placeholder="搜索记忆..." />
            </div>

            <ScrollArea className="min-h-0 flex-1 pr-3">
              <div className="space-y-2.5">
                {loadingMemories ? (
                  <EmptyState icon={LoaderCircle} title="正在加载记忆" description="正在读取 USER.md 与 MEMORY.md 的持久条目。" />
                ) : filteredMemories.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedMemoryId(item.id)}
                    className={cn(
                      "w-full rounded-[20px] border px-3.5 py-3 text-left transition-all duration-150",
                      selectedMemory?.id === item.id ? "border-violet-500/25 bg-violet-500/10 shadow-sm ring-1 ring-violet-500/10" : "border-border/60 bg-white/80 hover:border-violet-400/25 hover:bg-muted/30"
                    )}
                  >
                    <div className="font-medium leading-5">{item.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.content}</div>
                    <div className="mt-2.5 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary" className="rounded-full">{item.scope}</Badge>
                      <Badge variant="secondary" className="rounded-full">序号 {item.index}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-white/70 bg-white/85 xl:h-[calc(100vh-8rem)] xl:overflow-hidden">
          <CardHeader className="gap-2.5 border-b pb-3">
            {selectedMemory ? (
              <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-[15px] leading-5">{selectedMemory.title}</CardTitle>
                  <CardDescription className="mt-0.5 break-words text-sm leading-5">{selectedMemory.scope} · 更新于 {formatUpdatedAt(selectedMemory.updatedAt)}</CardDescription>
                </div>
                <div className="flex shrink-0 gap-2 self-start">
                  <Button onClick={() => void saveMemory(selectedMemory)} disabled={savingMemoryId === selectedMemory.id}>
                    {savingMemoryId === selectedMemory.id ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}保存
                  </Button>
                  <Button variant="outline" onClick={() => void removeMemory(selectedMemory)} disabled={deletingMemoryId === selectedMemory.id}>
                    {deletingMemoryId === selectedMemory.id ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}删除
                  </Button>
                </div>
              </div>
            ) : (
              <CardTitle>未选择记忆</CardTitle>
            )}
          </CardHeader>
          <CardContent className="grid min-h-0 flex-1 gap-3.5 pt-3 xl:grid-cols-[minmax(0,1fr)_300px]">
            {selectedMemory ? (
              <>
                <div className="min-w-0 min-h-0">
                  <Textarea
                    value={memoryDrafts[selectedMemory.id] ?? selectedMemory.content}
                    onChange={(e) => setMemoryDrafts((current) => ({ ...current, [selectedMemory.id]: e.target.value }))}
                    className="h-[calc(100vh-14rem)] min-h-0 resize-none overflow-y-auto rounded-[24px] bg-white/70 pb-16 text-sm leading-7"
                  />
                </div>
                <div className="min-w-0 min-h-0 space-y-2.5 overflow-hidden">
                  <div className="rounded-2xl border border-border/70 p-3 text-sm text-muted-foreground">
                    <div className="mb-1.5 font-medium text-foreground">记忆范围说明</div>
                    <ul className="space-y-1">
                      <li>user: 用户画像、偏好、沟通习惯。</li>
                      <li>memory: 环境事实、稳定约定、工具经验。</li>
                      <li>当前页面提供直接的增删改查操作。</li>
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-border/70 p-3">
                    <div className="mb-1.5 font-medium">草稿预览</div>
                    <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-3 text-xs leading-5">
                      {memoryDrafts[selectedMemory.id] ?? selectedMemory.content}
                    </pre>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState icon={MemoryStick} title="请选择一条记忆" description="选择左侧条目后即可编辑内容，也可以点击左上角的新增按钮创建一条长期记忆。" />
            )}
          </CardContent>
        </Card>
      </div>

      {isCreateMemoryOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-6 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-[28px] border border-white/70 bg-white p-6 shadow-[0_20px_80px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-semibold tracking-tight">新增记忆</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">将新条目写入 USER.md 或 MEMORY.md，作为长期记忆保存。</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setIsCreateMemoryOpen(false)}>
                关闭
              </Button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {(["memory", "user"] as MemoryScope[]).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setNewMemoryScope(scope)}
                  className={cn(
                    "rounded-full border px-3.5 py-2 text-xs font-medium transition",
                    newMemoryScope === scope ? "border-violet-500/30 bg-violet-500/10" : "border-border/70 bg-muted/40 hover:bg-background"
                  )}
                >
                  {scope}
                </button>
              ))}
            </div>

            <Textarea value={newMemoryContent} onChange={(e) => setNewMemoryContent(e.target.value)} placeholder="输入一条需要长期保存的记忆..." className="mt-4 min-h-56 rounded-[24px] bg-white text-sm leading-6" />

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateMemoryOpen(false)}>
                取消
              </Button>
              <Button onClick={() => void createMemoryEntry()} disabled={creatingMemory}>
                {creatingMemory ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}创建记忆
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}
