import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

import type { MemoryItem, MemoryScope } from "@/lib/hermes-types";

const execFileAsync = promisify(execFile);
const DEFAULT_HERMES_HOME = `${os.homedir()}/.hermes`;

function getHermesHome() {
  return process.env.HERMES_HOME?.trim() || DEFAULT_HERMES_HOME;
}

async function runPythonJson<T>(code: string, args: string[] = []) {
  const { stdout } = await execFileAsync("python3", ["-c", code, ...args], {
    maxBuffer: 1024 * 1024 * 20,
  });
  return JSON.parse(stdout) as T;
}

const MEMORY_CODE = String.raw`
import json, os, sys
from datetime import datetime, timezone

hermes_home = sys.argv[1]
action = sys.argv[2]
scope = sys.argv[3]
index = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] != '' else None
content = sys.argv[5] if len(sys.argv) > 5 else ''

memories_root = os.path.join(hermes_home, 'memories')
files = {
    'user': os.path.join(memories_root, 'USER.md'),
    'memory': os.path.join(memories_root, 'MEMORY.md'),
}

file_path = files[scope]
os.makedirs(memories_root, exist_ok=True)
if not os.path.exists(file_path):
    with open(file_path, 'w', encoding='utf-8') as fh:
        fh.write('')


def read_entries(target_scope: str):
    target_path = files[target_scope]
    with open(target_path, 'r', encoding='utf-8') as fh:
        raw = fh.read()
    stat = os.stat(target_path)
    entries = [item.strip() for item in raw.split('\n§\n') if item.strip()]

    def title_for(entry: str, idx: int):
        first_line = next((line.strip() for line in entry.splitlines() if line.strip()), '')
        if not first_line:
            return f'{target_scope} {idx + 1}'
        return first_line if len(first_line) <= 56 else first_line[:56] + '…'

    return [
        {
            'id': f'{target_scope}:{idx}',
            'scope': target_scope,
            'index': idx,
            'title': title_for(entry, idx),
            'content': entry,
            'updatedAt': datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
        }
        for idx, entry in enumerate(entries)
    ]


def write_entries(target_scope: str, values):
    target_path = files[target_scope]
    next_content = ('\n§\n'.join(item.strip() for item in values if item.strip()) + '\n') if values else ''
    with open(target_path, 'w', encoding='utf-8') as fh:
        fh.write(next_content)


if action == 'list-all':
    result = read_entries('user') + read_entries('memory')
elif action == 'create':
    items = read_entries(scope)
    entries = [item['content'] for item in items]
    if content.strip():
        entries.append(content.strip())
    write_entries(scope, entries)
    updated = read_entries(scope)
    result = updated[-1] if updated else None
elif action == 'update':
    items = read_entries(scope)
    if index is None or index < 0 or index >= len(items):
        result = None
    else:
        entries = [item['content'] for item in items]
        entries[index] = content.strip()
        write_entries(scope, entries)
        updated = read_entries(scope)
        result = updated[index] if index < len(updated) else None
elif action == 'delete':
    items = read_entries(scope)
    if index is None or index < 0 or index >= len(items):
        result = False
    else:
        entries = [item['content'] for item in items]
        entries.pop(index)
        write_entries(scope, entries)
        result = True
else:
    raise RuntimeError(f'Unknown action: {action}')

print(json.dumps(result, ensure_ascii=False))
`;

export async function listMemories() {
  return runPythonJson<MemoryItem[]>(MEMORY_CODE, [getHermesHome(), "list-all", "user"]);
}

export async function createMemory(scope: MemoryScope, content: string) {
  return runPythonJson<MemoryItem | null>(MEMORY_CODE, [getHermesHome(), "create", scope, "", content]);
}

export async function updateMemory(scope: MemoryScope, index: number, content: string) {
  return runPythonJson<MemoryItem | null>(MEMORY_CODE, [getHermesHome(), "update", scope, String(index), content]);
}

export async function deleteMemory(scope: MemoryScope, index: number) {
  return runPythonJson<boolean>(MEMORY_CODE, [getHermesHome(), "delete", scope, String(index)]);
}
