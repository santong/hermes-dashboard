import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

import type { SkillItem } from "@/lib/hermes-types";

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

const LIST_SKILLS_CODE = String.raw`
import json, os, re, sys

skills_root = os.path.join(sys.argv[1], 'skills')


def parse_frontmatter(content: str):
    match = re.match(r'^---\n([\s\S]*?)\n---', content)
    if not match:
        return {}
    values = {}
    for line in match.group(1).splitlines():
        parsed = re.match(r'^([A-Za-z0-9_-]+):\s*(.*)$', line)
        if not parsed:
            continue
        values[parsed.group(1)] = parsed.group(2).strip().strip('"\'')
    return values


skills = []
for root, _, files in os.walk(skills_root):
    if 'SKILL.md' not in files:
        continue
    file_path = os.path.join(root, 'SKILL.md')
    with open(file_path, 'r', encoding='utf-8') as fh:
        content = fh.read()
    stat = os.stat(file_path)
    relative_dir = os.path.relpath(root, skills_root)
    relative_parts = [] if relative_dir == '.' else relative_dir.split(os.sep)
    category = relative_parts[0] if len(relative_parts) > 1 else 'custom'
    frontmatter = parse_frontmatter(content)
    skills.append({
        'id': '/'.join(relative_parts),
        'name': frontmatter.get('name') or (relative_parts[-1] if relative_parts else 'skill'),
        'category': category,
        'description': frontmatter.get('description') or 'No description',
        'updatedAt': __import__('datetime').datetime.fromtimestamp(stat.st_mtime, tz=__import__('datetime').timezone.utc).isoformat().replace('+00:00', 'Z'),
        'content': content,
        'frontmatter': frontmatter,
    })

skills.sort(key=lambda item: item['updatedAt'], reverse=True)
print(json.dumps(skills, ensure_ascii=False))
`;

const UPDATE_SKILL_CODE = String.raw`
import json, os, sys

skills_root = os.path.join(sys.argv[1], 'skills')
skill_id = sys.argv[2]
content = sys.argv[3]

normalized = os.path.normpath(skill_id).lstrip('/\\')
full_path = os.path.join(skills_root, normalized, 'SKILL.md')
real_root = os.path.realpath(skills_root)
real_target = os.path.realpath(full_path)
if os.path.commonpath([real_root, real_target]) != real_root:
    raise RuntimeError('Invalid skill path')
if not os.path.exists(real_target):
    print('null')
    raise SystemExit(0)

with open(real_target, 'w', encoding='utf-8') as fh:
    fh.write(content)

print(json.dumps({'ok': True}, ensure_ascii=False))
`;

export async function listSkills(): Promise<SkillItem[]> {
  return runPythonJson<SkillItem[]>(LIST_SKILLS_CODE, [getHermesHome()]);
}

export async function updateSkill(skillId: string, content: string) {
  const result = await runPythonJson<{ ok: boolean } | null>(UPDATE_SKILL_CODE, [getHermesHome(), skillId, content]);
  if (!result) {
    return null;
  }

  const skills = await listSkills();
  return skills.find((skill) => skill.id === skillId) ?? null;
}
