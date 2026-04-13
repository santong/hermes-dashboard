import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getHermesHome } from "@/lib/hermes-env";
import type { MemoryItem, MemoryScope } from "@/lib/hermes-types";

// ─── Constants ────────────────────────────────────────────────────────

const ENTRY_SEPARATOR = "\n§\n";

const SCOPE_FILES: Record<MemoryScope, string> = {
  user: "USER.md",
  memory: "MEMORY.md",
};

// ─── Path resolution ─────────────────────────────────────────────────

function getMemoriesDir(): string {
  return path.join(getHermesHome(), "memories");
}

function getMemoryFilePath(scope: MemoryScope): string {
  return path.join(getMemoriesDir(), SCOPE_FILES[scope]);
}

/** Ensure the memories directory and both scope files exist. */
function ensureMemoryFiles(): void {
  const dir = getMemoriesDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  for (const scope of Object.keys(SCOPE_FILES) as MemoryScope[]) {
    const filePath = getMemoryFilePath(scope);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, "", "utf-8");
    }
  }
}

// ─── Core read/write ─────────────────────────────────────────────────

function titleFor(content: string, scope: MemoryScope, index: number): string {
  const firstLine = content.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!firstLine) return `${scope} ${index + 1}`;
  return firstLine.length <= 56 ? firstLine : `${firstLine.slice(0, 56)}…`;
}

function readEntries(scope: MemoryScope): MemoryItem[] {
  ensureMemoryFiles();
  const filePath = getMemoryFilePath(scope);
  const raw = readFileSync(filePath, "utf-8");
  const fileStat = statSync(filePath);
  const updatedAt = fileStat.mtime.toISOString().replace(/\.\d{3}Z$/, "Z");

  const entries = raw.split(ENTRY_SEPARATOR).map((s) => s.trim()).filter(Boolean);

  return entries.map((content, index) => ({
    id: `${scope}:${index}`,
    scope,
    index,
    title: titleFor(content, scope, index),
    content,
    updatedAt,
  }));
}

function writeEntries(scope: MemoryScope, contents: string[]): void {
  ensureMemoryFiles();
  const filePath = getMemoryFilePath(scope);
  const filtered = contents.map((s) => s.trim()).filter(Boolean);
  const data = filtered.length > 0 ? filtered.join(ENTRY_SEPARATOR) + "\n" : "";
  writeFileSync(filePath, data, "utf-8");
}

// ─── Public API (same signatures as before) ───────────────────────────

export async function listMemories(): Promise<MemoryItem[]> {
  return [...readEntries("user"), ...readEntries("memory")];
}

export async function createMemory(scope: MemoryScope, content: string): Promise<MemoryItem | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const existing = readEntries(scope).map((item) => item.content);
  existing.push(trimmed);
  writeEntries(scope, existing);

  const updated = readEntries(scope);
  return updated.at(-1) ?? null;
}

export async function updateMemory(scope: MemoryScope, index: number, content: string): Promise<MemoryItem | null> {
  const items = readEntries(scope);
  if (index < 0 || index >= items.length) return null;

  const contents = items.map((item) => item.content);
  contents[index] = content.trim();
  writeEntries(scope, contents);

  const updated = readEntries(scope);
  return updated[index] ?? null;
}

export async function deleteMemory(scope: MemoryScope, index: number): Promise<boolean> {
  const items = readEntries(scope);
  if (index < 0 || index >= items.length) return false;

  const contents = items.map((item) => item.content);
  contents.splice(index, 1);
  writeEntries(scope, contents);
  return true;
}
