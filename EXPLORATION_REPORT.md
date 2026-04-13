# Hermes Dashboard - Deep Exploration Report
**Date:** April 13, 2026
**Project:** `/Users/santong/Desktop/repos/hermes-dashboard`

---

## 1. HERMES CLI OUTPUT FORMAT & FLAGS

### 1.1 Main Hermes Command Help
```
usage: hermes [-h] [--version] [--resume SESSION] [--continue [SESSION_NAME]]
              [--worktree] [--skills SKILLS] [--yolo] [--pass-session-id]
              {chat,model,gateway,setup,...}
```

**Key Global Flags:**
- `-h, --help` - Show help message and exit
- `--version, -V` - Show version and exit
- `--resume SESSION, -r SESSION` - Resume a previous session by ID or title
- `--continue [SESSION_NAME], -c [SESSION_NAME]` - Resume a session by name, or most recent if no name given
- `--worktree, -w` - Run in an isolated git worktree (for parallel agents)
- `--skills SKILLS, -s SKILLS` - Preload one or more skills (repeat flag or comma-separate)
- `--yolo` - Bypass all dangerous command approval prompts
- `--pass-session-id` - Include the session ID in the agent's system prompt

### 1.2 Hermes Chat Command Help
```
usage: hermes chat [-h] [-q QUERY] [--image IMAGE] [-m MODEL] [-t TOOLSETS]
                   [-s SKILLS] [--provider PROVIDER]
                   [-v] [-Q] [--resume SESSION_ID] [--continue [SESSION_NAME]]
                   [--worktree] [--checkpoints] [--max-turns N] [--yolo]
                   [--pass-session-id] [--source SOURCE]
```

**Key Chat Flags:**

| Flag | Type | Purpose |
|------|------|---------|
| `-q, --query QUERY` | string | Single query (non-interactive mode) |
| `--image IMAGE` | path | Optional local image path to attach to single query |
| `-m, --model MODEL` | string | Model to use (e.g., `anthropic/claude-sonnet-4`) |
| `-t, --toolsets TOOLSETS` | string | Comma-separated toolsets to enable |
| `-s, --skills SKILLS` | string | Preload one or more skills (repeat or comma-separate) |
| `--provider PROVIDER` | enum | Inference provider (auto, openrouter, nous, openai-codex, copilot-acp, copilot, anthropic, gemini, huggingface, zai, kimi-coding, minimax, minimax-cn, kilocode, xiaomi) |
| `-v, --verbose` | flag | Verbose output |
| `-Q, --quiet` | flag | **Quiet mode for programmatic use**: suppress banner, spinner, tool previews. Only output final response and session info |
| `--resume SESSION_ID, -r SESSION_ID` | string | Resume a previous session by ID |
| `--continue [SESSION_NAME], -c [SESSION_NAME]` | string | Resume a session by name, or most recent if no name given |
| `-w, --worktree` | flag | Run in isolated git worktree (parallel agents on same repo) |
| `--checkpoints` | flag | Enable filesystem checkpoints before destructive file operations |
| `--max-turns N` | integer | Maximum tool-calling iterations per conversation turn (default: 90) |
| `--yolo` | flag | Bypass dangerous command approval prompts |
| `--pass-session-id` | flag | Include session ID in agent's system prompt |
| `--source SOURCE` | string | Session source tag for filtering (default: 'cli'). Use 'tool' for third-party integrations that shouldn't appear in user session lists |

**Key Observations:**
- **Quiet Mode (`-Q`)** is critical for programmatic use - suppresses all UI elements
- **Non-interactive Mode** (`-q "prompt"`) allows running single queries without interactive session
- **Session Management** supports resuming/continuing previous sessions
- **Worktree Support** allows parallel agents on the same repo
- **Source Tagging** enables filtering which sessions appear where (cli vs tool)

### 1.3 CLI Output Format

When running with `-Q` (quiet mode), the stdout format is:
- Session ID line: `session_id: <uuid>`
- Response content: Plain text
- Errors: Written to stderr

The dashboard's `sanitizeChatStdout()` function (line 340 in hermes-sessions.ts) filters out:
- Lines starting with `╭─ ⚕ Hermes` (banner)
- Lines starting with `╰` (box drawing)
- Lines starting with `session_id:` (extracted separately)

---

## 2. API ROUTE HANDLERS - COMPLETE MAPPING

All API routes follow the pattern: Request → API handler → Library function → Response

### 2.1 Chat Endpoint

**Route:** `POST /api/chat`
**File:** `src/app/api/chat/route.ts`

```typescript
// Request Body
{
  "prompt": string (required, trimmed),
  "sessionId"?: string (optional, trimmed)
}

// Response Success (200)
{
  "sessionId": string,
  "response": string,
  "session": SessionDetail
}

// Response Error (400 | 500)
{
  "error": string
}
```

**Lib Call:** `runChat(prompt, sessionId?)`
- Constructs args: `["chat", "-Q", "-q", prompt, "--source", "dashboard"]`
- Appends `["--resume", sessionId]` if session ID provided
- Executes: `hermes` command with these args
- Parses stdout/stderr using `sanitizeChatStdout()`
- Fetches full session detail from SQLite
- Returns: `ChatRunResult` with sessionId, response text, and full session detail

---

### 2.2 Sessions List Endpoint

**Route:** `GET /api/sessions`
**File:** `src/app/api/sessions/route.ts`

```typescript
// Request: None

// Response Success (200)
{
  "sessions": SessionSummary[]
}

// Response Error (500)
{
  "error": string
}
```

**Lib Call:** `listSessions()`
- Runs Python script that queries SQLite: `sessions` table with left join to `messages`
- Aggregates message counts by role (user, assistant, tool, system)
- Normalizes rows into `SessionSummary` objects
- Computes lineage (parent → child relationships)
- Derives session kind: "empty", "root", or "child"

---

### 2.3 Session Detail Endpoint

**Route:** `GET /api/sessions/[id]`
**File:** `src/app/api/sessions/[id]/route.ts`

```typescript
// Request Path Params
{ id: string }

// Response Success (200)
{
  "session": SessionDetail  // SessionSummary + messages + lineage + children
}

// Response Error (404 | 500)
{
  "error": string
}
```

**Lib Call:** `getSession(id)`
- Queries `sessions` table for specific ID
- Queries `messages` table ordered by ID
- Extracts and transforms:
  - Message role → display author (You/Hermes/Tool/System)
  - `reasoning` and `reasoning_details` → parsed reasoning array
  - `tool_calls` JSON → SessionToolCall array
- Builds lineage (parent chain) and children list
- Returns: `SessionDetail` with full message history

**Delete Handler:**
**Route:** `DELETE /api/sessions/[id]`

```typescript
// Response Success (200)
{
  "deletedIds": string[]
}

// Response Error (404 | 500)
{
  "error": string
}
```

**Lib Call:** `deleteSessionTree(id)`
- Uses recursive CTE to find all child sessions
- Deletes in depth-first order (children first)
- Removes from both `messages` and `sessions` tables
- Returns array of deleted IDs

---

### 2.4 Memory List Endpoint

**Route:** `GET /api/memory`
**File:** `src/app/api/memory/route.ts`

```typescript
// Request: None

// Response Success (200)
{
  "memories": MemoryItem[]
}

// Response Error (500)
{
  "error": string
}
```

**Lib Call:** `listMemories()`
- Reads from `~/.hermes/memories/USER.md` and `~/.hermes/memories/MEMORY.md`
- Splits entries by `\n§\n` delimiter
- Parses each entry:
  - `id`: `{scope}:{index}` (e.g., "user:0", "memory:1")
  - `title`: First line of content (max 56 chars with ellipsis)
  - `updatedAt`: File modification time (ISO 8601 with Z suffix)

---

### 2.5 Memory Create Endpoint

**Route:** `POST /api/memory`

```typescript
// Request Body
{
  "scope": "user" | "memory" (required),
  "content": string (required, trimmed)
}

// Response Success (200)
{
  "item": MemoryItem
}

// Response Error (400 | 500)
{
  "error": string
}
```

**Lib Call:** `createMemory(scope, content)`
- Appends content to target memory file
- Uses `\n§\n` separator between entries
- Returns newly created memory item

---

### 2.6 Memory Update/Delete Endpoint

**Route:** `PUT /api/memory/[scope]/[index]`
**File:** `src/app/api/memory/[scope]/[index]/route.ts`

```typescript
// Request Path Params
{ scope: "user" | "memory", index: number }

// Request Body (PUT)
{ "content": string (required) }

// Response Success (200)
{
  "item": MemoryItem
}

// Response Error (400 | 404 | 500)
{
  "error": string
}
```

**Lib Call:** `updateMemory(scope, index, content)`
- Reads all entries from memory file
- Validates index is within bounds
- Replaces entry at index
- Writes back to file

---

**Route:** `DELETE /api/memory/[scope]/[index]`

```typescript
// Response Success (200)
{
  "ok": true
}

// Response Error (400 | 404 | 500)
{
  "error": string
}
```

**Lib Call:** `deleteMemory(scope, index)`
- Reads all entries
- Validates index bounds
- Removes entry at index
- Writes back to file
- Returns boolean success

---

### 2.7 Skills List Endpoint

**Route:** `GET /api/skills`
**File:** `src/app/api/skills/route.ts`

```typescript
// Request: None

// Response Success (200)
{
  "skills": SkillItem[]
}

// Response Error (500)
{
  "error": string
}
```

**Lib Call:** `listSkills()`
- Walks `~/.hermes/skills/` directory
- For each directory with `SKILL.md`:
  - Parses frontmatter (YAML-like format between `---`)
  - Extracts: name, description, and other metadata
  - Returns full content and frontmatter
  - ID: relative path from skills root (e.g., "category/skill-name")
  - Category: first directory level or "custom"

---

### 2.8 Skill Update Endpoint

**Route:** `PUT /api/skills/[...skillPath]`
**File:** `src/app/api/skills/[...skillPath]/route.ts`

```typescript
// Request Path Params
{ skillPath: string[] }  // e.g., ["category", "skill-name"]

// Request Body
{ "content": string (required) }

// Response Success (200)
{
  "skill": SkillItem
}

// Response Error (404 | 500)
{
  "error": string
}
```

**Lib Call:** `updateSkill(skillPath, content)`
- Joins path with "/" to get skill ID
- Validates path doesn't escape skills root (path traversal check)
- Writes content to `{skillPath}/SKILL.md`
- Re-scans skills to return updated item

---

## 3. SQLITE DATABASE SCHEMA

### 3.1 Complete Schema

#### `schema_version` Table
```sql
CREATE TABLE schema_version (
    version INTEGER NOT NULL
);
```
Tracks database schema version for migrations.

---

#### `sessions` Table
```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    user_id TEXT,
    model TEXT,
    model_config TEXT,
    system_prompt TEXT,
    parent_session_id TEXT,
    started_at REAL NOT NULL,              -- Unix timestamp (seconds)
    ended_at REAL,
    end_reason TEXT,                       -- e.g., "stop", "length", "tool_use"
    message_count INTEGER DEFAULT 0,
    tool_call_count INTEGER DEFAULT 0,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    billing_provider TEXT,
    billing_base_url TEXT,
    billing_mode TEXT,
    estimated_cost_usd REAL,
    actual_cost_usd REAL,
    cost_status TEXT,
    cost_source TEXT,
    pricing_version TEXT,
    title TEXT,
    FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);
```

**Key Observations:**
- `id`: UUID string primary key
- `source`: "cli", "dashboard", "tool", etc. (filterable)
- `started_at` / `ended_at`: UNIX timestamps (seconds, not milliseconds)
- Denormalized counts: message_count, tool_call_count, token counts
- Cost tracking: Three cost fields (estimated vs actual) + status tracking
- Hierarchical: parent_session_id supports session trees
- `title`: Optional user-provided title

---

#### `messages` Table
```sql
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,                    -- "user", "assistant", "tool", "system"
    content TEXT,
    tool_call_id TEXT,                     -- Links to specific tool call
    tool_calls TEXT,                       -- JSON array of tool calls
    tool_name TEXT,                        -- Name of tool that produced this message
    timestamp REAL NOT NULL,               -- Unix timestamp (seconds)
    token_count INTEGER,
    finish_reason TEXT,                    -- "stop", "length", "tool_use", etc.
    reasoning TEXT,                        -- Extended thinking output (multiline text)
    reasoning_details TEXT,                -- JSON with structured reasoning details
    codex_reasoning_items TEXT             -- Codex-specific reasoning format (JSON)
);
```

**Key Observations:**
- Append-only: auto-incrementing integer ID
- `tool_calls`: JSON string array, format:
  ```json
  [
    {
      "id": "string",
      "function": {
        "name": "tool_name",
        "arguments": "{json string}"
      }
    }
  ]
  ```
- `reasoning_details`: JSON array of objects with:
  - `summary`: array of reasoning steps
  - `text`: full reasoning text
- `finish_reason`: Protocol-specific (OpenAI, Anthropic, etc.)

---

#### `messages_fts` (Full-Text Search Virtual Table)
```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content=messages,
    content_rowid=id
);
```
- Enables fast full-text search on message content
- Automatically maintained by SQLite FTS5
- Supporting tables: `messages_fts_data`, `messages_fts_idx`, `messages_fts_docsize`, `messages_fts_config`

---

### 3.2 Typical Data Flow

#### Timestamps
- Stored as UNIX epoch seconds (REAL type, float precision)
- Dashboard converts to ISO 8601 string with Chinese locale formatting
- Format: `YYYY-MM-DD HH:mm` (e.g., "2026-04-13 16:45")

#### Message History
```
Session 1 (root, 5 messages)
├─ Message 1: role=system
├─ Message 2: role=user, content="What is X?"
├─ Message 3: role=assistant, tool_calls=[{id: "call_1", ...}]
├─ Message 4: role=tool, tool_name="search", content="{...result}"
└─ Message 5: role=assistant, content="Based on search..."

Session 1.1 (child, continued with --resume Session1)
├─ Inherits parent_session_id=Session1
└─ New messages appended to messages table
```

#### Session Hierarchy
```
Root Session (no parent)
├─ Child Session (parent_session_id=Root)
│  └─ Child Child Session (parent_session_id=Child)
└─ Other Child Session (parent_session_id=Root)
```

---

### 3.3 Important Query Patterns Used by Dashboard

**Get all sessions with aggregates:**
```sql
SELECT s.*, 
       COUNT(CASE WHEN m.role='user' THEN 1 END) as user_msgs,
       COUNT(CASE WHEN m.role='assistant' THEN 1 END) as assistant_msgs,
       SUM(COALESCE(m.token_count, 0)) as total_tokens
FROM sessions s
LEFT JOIN messages m ON m.session_id = s.id
GROUP BY s.id
ORDER BY s.started_at DESC;
```

**Delete session tree (recursive):**
```sql
WITH RECURSIVE tree(id, depth) AS (
  SELECT id, 0 FROM sessions WHERE id = ?
  UNION ALL
  SELECT s.id, tree.depth + 1
  FROM sessions s
  JOIN tree ON s.parent_session_id = tree.id
)
DELETE FROM messages WHERE session_id IN (SELECT id FROM tree);
DELETE FROM sessions WHERE id IN (SELECT id FROM tree);
```

---

## Summary: Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js API Routes                        │
├─────────────────────────────────────────────────────────────┤
│  POST   /api/chat          → runChat()                       │
│  GET    /api/sessions      → listSessions()                  │
│  GET    /api/sessions/[id] → getSession()                    │
│  DELETE /api/sessions/[id] → deleteSessionTree()             │
│  GET    /api/memory        → listMemories()                  │
│  POST   /api/memory        → createMemory()                  │
│  PUT    /api/memory/[s]/[i]→ updateMemory()                  │
│  DELETE /api/memory/[s]/[i]→ deleteMemory()                  │
│  GET    /api/skills        → listSkills()                    │
│  PUT    /api/skills/[path] → updateSkill()                   │
└─────────────────────────────────────────────────────────────┘
          ↓ (via execFile + Python + hermes CLI)
┌─────────────────────────────────────────────────────────────┐
│            Hermes CLI & File System Layer                    │
├─────────────────────────────────────────────────────────────┤
│  $ hermes chat -Q -q "{prompt}" --source dashboard [options] │
│  ~/.hermes/memories/{USER,MEMORY}.md (entries sep. by §)     │
│  ~/.hermes/skills/*/SKILL.md (frontmatter + content)         │
└─────────────────────────────────────────────────────────────┘
          ↓ (SQLite queries & writes)
┌─────────────────────────────────────────────────────────────┐
│            SQLite Database (state.db)                        │
├─────────────────────────────────────────────────────────────┤
│  • sessions (id, parent_session_id, timestamps, costs, ...)  │
│  • messages (id, session_id, role, content, reasoning, ...)  │
│  • messages_fts (full-text search index)                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Technical Insights

1. **Programmatic CLI Usage**: `-Q` (quiet) flag is essential for non-interactive integration
2. **Session Source Tagging**: "dashboard" vs "cli" allows filtering sessions by origin
3. **Streaming Not Supported**: Current implementation runs full hermes chat and awaits completion (5-min timeout max)
4. **Memory Storage**: File-based with `§` separator (not SQLite)
5. **Skills Storage**: File-based (SKILL.md files with YAML frontmatter)
6. **Session Hierarchy**: Full parent-child relationships with recursive queries
7. **Message Annotation**: Rich metadata including reasoning details and tool calls
8. **No JSON Response Streaming**: API returns full response at once, no streaming support
9. **Cost Tracking**: Three-tier system (estimated, actual, status)
10. **Token Accounting**: Full token tracking (input, output, cache, reasoning)

